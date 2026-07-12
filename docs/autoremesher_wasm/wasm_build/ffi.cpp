// extern "C" FFI wrapping autoremesher's AutoRemesher module for the SculptXR
// GeometryWorker. Mirrors the shape of voxel_wasm's remesh_quads_wasm:
//   verts (f32, xyz) + faces (u32, 4-padded, 0xFFFFFFFF = triangle pad) in,
//   a MeshResult* out (10 x u32/ptr fields, read as a Uint32Array(10) meta block).
//
// Two paths:
//  - UNGUIDED (face_groups == null): full AutoRemesher::remesh() — isotropic resample,
//    island split, parametrize, extract. Best general quality.
//  - GUIDED (face_groups != null): "skip resample" proof of face-group steering —
//    parametrize the input mesh directly (group ids map 1:1) with the group-seam edges
//    fed to quad_cover as hard constraints, then extract. Rougher (no re-uniforming)
//    but the quad loops follow the painted group borders.
#include <AutoRemesher/AutoRemesher>
#include <AutoRemesher/IsotropicRemesher>
#include <AutoRemesher/Parameterizer>
#include <AutoRemesher/QuadExtractor>
#include <geogram/basic/common.h>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <map>
#include <utility>
#include <vector>

using AutoRemesher::Vector3;
using AutoRemesher::Vector2;
using AutoRemesher::Parameterizer;
using AutoRemesher::QuadExtractor;

static const uint32_t TRI_PAD = 0xFFFFFFFFu;

// Layout matches voxel_wasm's MeshResult (10 x 4-byte fields on wasm32).
struct MeshResult {
    float* vertices_ptr;
    size_t vertices_len;
    uint32_t* faces_ptr;
    size_t faces_len;
    uint32_t* colors_ptr;
    size_t colors_len;
    uint32_t* materials_ptr;
    size_t materials_len;
    uint32_t* normals_ptr;
    size_t normals_len;
};

static bool s_geoInitialized = false;

// Pack autoremesher output (verts + quad/tri polygons) into a heap MeshResult.
static MeshResult* packResult(const std::vector<Vector3>& outVerts,
    const std::vector<std::vector<size_t>>& outPolys)
{
    if (outVerts.empty() || outPolys.empty())
        return nullptr;

    size_t nfloats = outVerts.size() * 3;
    float* vout = (float*)std::malloc(nfloats * sizeof(float));
    for (size_t i = 0; i < outVerts.size(); ++i) {
        vout[i * 3 + 0] = (float)outVerts[i].x();
        vout[i * 3 + 1] = (float)outVerts[i].y();
        vout[i * 3 + 2] = (float)outVerts[i].z();
    }

    size_t nfaceU32 = outPolys.size() * 4;
    uint32_t* fout = (uint32_t*)std::malloc(nfaceU32 * sizeof(uint32_t));
    for (size_t i = 0; i < outPolys.size(); ++i) {
        const auto& q = outPolys[i];
        fout[i * 4 + 0] = (uint32_t)q[0];
        fout[i * 4 + 1] = (uint32_t)q[1];
        fout[i * 4 + 2] = (uint32_t)q[2];
        fout[i * 4 + 3] = q.size() >= 4 ? (uint32_t)q[3] : TRI_PAD;
    }

    MeshResult* res = (MeshResult*)std::malloc(sizeof(MeshResult));
    std::memset(res, 0, sizeof(MeshResult));
    res->vertices_ptr = vout;
    res->vertices_len = nfloats;
    res->faces_ptr = fout;
    res->faces_len = nfaceU32;
    return res;
}

extern "C" {

// One-time geogram init (Logger / CmdLine / numerics). Idempotent.
void autoremesher_init() {
    if (s_geoInitialized) return;
    GEO::initialize();
    s_geoInitialized = true;
}

// verts_len   = number of floats  (= 3 * nverts)
// faces_len   = number of u32s    (= 4 * nfaces_in, 4-padded)
// face_groups_ptr: one u32 group id per input face (nfaces_in entries), or null.
//   Non-null → guided (skip-resample) steering along group seams.
// target_faces: desired output quad count (0 = auto). sharp_edge_degrees: feature threshold.
MeshResult* remesh_autoremesher(
    const float* verts_ptr, size_t verts_len,
    const uint32_t* faces_ptr, size_t faces_len,
    const uint32_t* face_groups_ptr,
    uint32_t target_faces,
    float sharp_edge_degrees)
{
    if (!verts_ptr || !faces_ptr || verts_len < 9 || faces_len < 4)
        return nullptr;

    autoremesher_init();

    std::vector<Vector3> vertices;
    vertices.reserve(verts_len / 3);
    for (size_t i = 0; i + 2 < verts_len; i += 3)
        vertices.emplace_back(verts_ptr[i], verts_ptr[i + 1], verts_ptr[i + 2]);

    // Split (4-padded) quads/tris into triangles; track each triangle's source-face
    // group so we can find seams (edges between differently-grouped faces).
    std::vector<std::vector<size_t>> triangles;
    std::vector<uint32_t> triGroup; // parallel to triangles (only used when guided)
    size_t nfacesIn = faces_len / 4;
    triangles.reserve(nfacesIn * 2);
    for (size_t fi = 0; fi < nfacesIn; ++fi) {
        size_t i = fi * 4;
        size_t a = faces_ptr[i], b = faces_ptr[i + 1], c = faces_ptr[i + 2];
        uint32_t d = faces_ptr[i + 3];
        uint32_t g = face_groups_ptr ? face_groups_ptr[fi] : 0;
        triangles.push_back({ a, b, c });
        triGroup.push_back(g);
        if (d != TRI_PAD) {
            triangles.push_back({ a, c, (size_t)d });
            triGroup.push_back(g);
        }
    }

    const double sharpDeg = sharp_edge_degrees > 0.0f
        ? (double)sharp_edge_degrees
        : AutoRemesher::AutoRemesher::m_defaultSharpEdgeDegrees;

    // ---- GUIDED path: parametrize the input mesh directly (exact group seams map 1:1)
    // with the seams fed to quad_cover as first-class feature edges (via the geogram
    // "seam" facet-corner attribute → patched FrameField + get_edge_constraints). ----
    if (face_groups_ptr != nullptr) {
        // Seam edges = internal edges whose two triangles differ in group.
        std::map<std::pair<size_t, size_t>, std::pair<int, int>> edgeTris;
        auto addEdge = [&](size_t u, size_t v, size_t t) {
            auto key = u < v ? std::make_pair(u, v) : std::make_pair(v, u);
            auto it = edgeTris.find(key);
            if (it == edgeTris.end()) edgeTris[key] = { (int)t, -1 };
            else if (it->second.second < 0) it->second.second = (int)t;
        };
        for (size_t t = 0; t < triangles.size(); ++t) {
            const auto& tr = triangles[t];
            addEdge(tr[0], tr[1], t); addEdge(tr[1], tr[2], t); addEdge(tr[2], tr[0], t);
        }
        std::vector<std::pair<size_t, size_t>> seamEdges;
        for (const auto& e : edgeTris) {
            int t0 = e.second.first, t1 = e.second.second;
            if (t1 >= 0 && triGroup[t0] != triGroup[t1])
                seamEdges.push_back(e.first);
        }

        // Quad density: skipping the resample means quad size follows the input edge
        // length, so derive quad_cover's scaling from the target quad count.
        double scaling = 1.0;
        if (target_faces > 0) {
            double area = 0.0, edgeSum = 0.0; size_t edgeCount = 0;
            for (const auto& tr : triangles) {
                const Vector3& p0 = vertices[tr[0]];
                const Vector3& p1 = vertices[tr[1]];
                const Vector3& p2 = vertices[tr[2]];
                area += 0.5 * Vector3::crossProduct(p1 - p0, p2 - p0).length();
                edgeSum += (p1 - p0).length() + (p2 - p1).length() + (p0 - p2).length();
                edgeCount += 3;
            }
            double avgEdge = edgeCount ? edgeSum / edgeCount : 1.0;
            if (area > 0.0 && avgEdge > 0.0) {
                double quadEdge = std::sqrt(area / (double)target_faces);
                scaling = quadEdge / avgEdge;
                if (scaling < 0.05) scaling = 0.05;
                if (scaling > 20.0) scaling = 20.0;
            }
        }

        Parameterizer param(&vertices, &triangles, nullptr);
        param.setScaling(scaling);
        param.setSharpEdgeDegrees(sharpDeg);
        param.setSeamEdges(&seamEdges);
        param.parameterize();
        std::vector<std::vector<Vector2>>* uvs = param.takeTriangleUvs();

        QuadExtractor extractor(&vertices, &triangles, uvs);
        bool ok = extractor.extract();
        delete uvs;
        if (!ok)
            return nullptr;
        return packResult(extractor.remeshedVertices(), extractor.remeshedQuads());
    }

    // ---- UNGUIDED path: full AutoRemesher (resample + islands), best quality ----
    AutoRemesher::AutoRemesher remesher(vertices, triangles);
    if (target_faces > 0)
        remesher.setTargetTriangleCount(target_faces);
    // Edge/UV scaling. The CLI default (mainwindow: parameters.scaling = edgeScaling)
    // is 1.0; leaving it at 0 collapses the quad_cover UVs and yields zero quads.
    remesher.setScaling(1.0);
    remesher.setModelType(AutoRemesher::ModelType::Organic);
    remesher.setSharpEdgeDegrees(sharpDeg);

    if (!remesher.remesh())
        return nullptr;
    return packResult(remesher.remeshedVertices(), remesher.remeshedQuads());
}

void free_mesh_result(MeshResult* res) {
    if (!res) return;
    std::free(res->vertices_ptr);
    std::free(res->faces_ptr);
    std::free(res->colors_ptr);
    std::free(res->materials_ptr);
    std::free(res->normals_ptr);
    std::free(res);
}

} // extern "C"
