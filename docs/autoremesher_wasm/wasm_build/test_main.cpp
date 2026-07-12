// Standalone smoke test: build a welded icosphere (manifold, no pole singularities),
// run remesh_autoremesher, and report whether a group seam attracts an edge loop.
// Guided by default (top/bottom hemisphere groups → equator seam); pass "unguided" to compare.
#include <array>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <map>
#include <string>
#include <vector>
#include <cmath>

struct MeshResult {
    float* vertices_ptr; size_t vertices_len;
    uint32_t* faces_ptr; size_t faces_len;
    uint32_t* colors_ptr; size_t colors_len;
    uint32_t* materials_ptr; size_t materials_len;
    uint32_t* normals_ptr; size_t normals_len;
};
extern "C" MeshResult* remesh_autoremesher(const float*, size_t, const uint32_t*, size_t,
    const uint32_t*, uint32_t, float);
extern "C" void free_mesh_result(MeshResult*);

static const uint32_t PAD = 0xFFFFFFFFu;
static const float R = 5.0f;

int main(int argc, char** argv) {
    // --- Icosphere: subdivided icosahedron, welded via midpoint cache, projected to sphere ---
    std::vector<float> verts;
    std::vector<uint32_t> idx; // triangle vertex indices
    auto addV = [&](float x, float y, float z) -> uint32_t {
        float l = std::sqrt(x*x+y*y+z*z); x/=l; y/=l; z/=l;
        verts.insert(verts.end(), { x*R, y*R, z*R });
        return (uint32_t)(verts.size()/3 - 1);
    };
    const float t = (1.0f + std::sqrt(5.0f)) / 2.0f;
    uint32_t v[12];
    int k = 0;
    float base[12][3] = {
        {-1,t,0},{1,t,0},{-1,-t,0},{1,-t,0},
        {0,-1,t},{0,1,t},{0,-1,-t},{0,1,-t},
        {t,0,-1},{t,0,1},{-t,0,-1},{-t,0,1} };
    for (auto& b : base) v[k++] = addV(b[0], b[1], b[2]);
    int tris0[20][3] = {
        {0,11,5},{0,5,1},{0,1,7},{0,7,10},{0,10,11},
        {1,5,9},{5,11,4},{11,10,2},{10,7,6},{7,1,8},
        {3,9,4},{3,4,2},{3,2,6},{3,6,8},{3,8,9},
        {4,9,5},{2,4,11},{6,2,10},{8,6,7},{9,8,1} };
    std::vector<std::array<uint32_t,3>> faces;
    for (auto& f : tris0) faces.push_back({ v[f[0]], v[f[1]], v[f[2]] });

    std::map<uint64_t,uint32_t> midCache;
    auto midpoint = [&](uint32_t a, uint32_t b) -> uint32_t {
        uint64_t key = a < b ? ((uint64_t)a<<32|b) : ((uint64_t)b<<32|a);
        auto it = midCache.find(key);
        if (it != midCache.end()) return it->second;
        float ax=verts[a*3],ay=verts[a*3+1],az=verts[a*3+2];
        float bx=verts[b*3],by=verts[b*3+1],bz=verts[b*3+2];
        uint32_t m = addV(ax+bx, ay+by, az+bz);
        midCache[key] = m; return m;
    };
    const int SUBDIV = 3; // 20*4^3 = 1280 faces
    for (int s = 0; s < SUBDIV; ++s) {
        std::vector<std::array<uint32_t,3>> next;
        for (auto& f : faces) {
            uint32_t a=midpoint(f[0],f[1]), b=midpoint(f[1],f[2]), c=midpoint(f[2],f[0]);
            next.push_back({f[0],a,c}); next.push_back({f[1],b,a});
            next.push_back({f[2],c,b}); next.push_back({a,b,c});
        }
        faces.swap(next);
    }

    // Flatten to 4-padded faces + per-face group (top/bottom hemisphere → equator seam).
    std::vector<uint32_t> f4, groups;
    for (auto& f : faces) {
        f4.insert(f4.end(), { f[0], f[1], f[2], PAD });
        float cy = (verts[f[0]*3+1]+verts[f[1]*3+1]+verts[f[2]*3+1]) / 3.0f;
        groups.push_back(cy >= 0.0f ? 1u : 2u);
    }
    printf("input: %zu verts, %zu faces (icosphere)\n", verts.size()/3, faces.size());

    // "jitter" arg: perturb vertices along random tangents to make the mesh irregular
    // (reproduces the real-mesh conditions that produced holes).
    bool jitter = false, guided = true;
    for (int i = 1; i < argc; ++i) {
        std::string a = argv[i];
        if (a == "unguided") guided = false;
        if (a == "jitter") jitter = true;
    }
    if (jitter) {
        srand(1234);
        for (size_t i = 0; i < verts.size(); i += 3) {
            float j = (R * 0.06f);
            verts[i]   += ((rand() / (float)RAND_MAX) - 0.5f) * j;
            verts[i+1] += ((rand() / (float)RAND_MAX) - 0.5f) * j;
            verts[i+2] += ((rand() / (float)RAND_MAX) - 0.5f) * j;
        }
    }
    printf("mode: %s%s\n", guided ? "GUIDED (equator seam)" : "unguided", jitter ? " +jitter" : "");
    MeshResult* r = remesh_autoremesher(verts.data(), verts.size(),
        f4.data(), f4.size(), guided ? groups.data() : nullptr, 600, 90.0f);
    if (!r) { printf("RESULT: null (remesh failed)\n"); return 1; }

    size_t nq=0, ntri=0, nv=r->vertices_len/3;
    for (size_t i=0; i+3<r->faces_len; i+=4) (r->faces_ptr[i+3]==PAD?ntri:nq)++;

    // Holes metric: count boundary edges (edges used by exactly one face). A watertight
    // quad mesh has 0; holes/cracks show up as boundary edges.
    std::map<std::pair<uint32_t,uint32_t>,int> ec;
    auto ae=[&](uint32_t a,uint32_t b){ ec[a<b?std::make_pair(a,b):std::make_pair(b,a)]++; };
    for (size_t i=0;i+3<r->faces_len;i+=4){
        uint32_t a=r->faces_ptr[i],b=r->faces_ptr[i+1],c=r->faces_ptr[i+2],d=r->faces_ptr[i+3];
        if(d==PAD){ ae(a,b);ae(b,c);ae(c,a);} else {ae(a,b);ae(b,c);ae(c,d);ae(d,a);}
    }
    size_t boundary=0; for(auto&e:ec) if(e.second==1) boundary++;
    printf("HOLES: %zu boundary edges\n", boundary);

    // Equator-loop check: fraction of output verts within a thin band |y|<band around y=0.
    float band = 0.25f * R * 0.1f; // ~0.125 world units
    size_t inBand = 0;
    for (size_t i=0;i<nv;++i) if (std::fabs(r->vertices_ptr[i*3+1]) < band) inBand++;
    printf("RESULT: %zu verts, %zu faces (%zu quads, %zu tris); band|y|<%.2f verts=%zu\n",
        nv, r->faces_len/4, nq, ntri, band, inBand);

    int hist[10]={0};
    for (size_t i=0;i<nv;++i){int b=(int)((r->vertices_ptr[i*3+1]+R)/(2*R/10));if(b<0)b=0;if(b>9)b=9;hist[b]++;}
    printf("y-hist(-5..5):"); for(int i=0;i<10;++i)printf(" %d",hist[i]); printf("\n");

    // "obj" arg: dump OBJ to stdout (prefixed OBJ|) for visual inspection.
    for (int i = 1; i < argc; ++i) if (std::string(argv[i]) == "obj") {
        for (size_t k = 0; k < nv; ++k)
            printf("OBJ|v %f %f %f\n", r->vertices_ptr[k*3], r->vertices_ptr[k*3+1], r->vertices_ptr[k*3+2]);
        for (size_t k = 0; k + 3 < r->faces_len; k += 4) {
            uint32_t a=r->faces_ptr[k],b=r->faces_ptr[k+1],c=r->faces_ptr[k+2],d=r->faces_ptr[k+3];
            if (d==PAD) printf("OBJ|f %u %u %u\n", a+1,b+1,c+1);
            else printf("OBJ|f %u %u %u %u\n", a+1,b+1,c+1,d+1);
        }
    }
    free_mesh_result(r);
    return 0;
}
