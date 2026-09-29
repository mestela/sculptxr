import Utils from '../misc/Utils.js';

// EDGE LOOPS AND RINGS, as pure functions over the face array.
//
// Everything here reads (faces, nbFaces) in the SculptGL layout -- four indices per face, a
// triangle's fourth being Utils.TRI_INDEX -- and nothing else, so the walks can be run and
// checked in node without a Mesh. The tools (SelLoop, CutLoop, and Bevel after them) are thin
// shells around these.
//
// An edge is an unordered vertex pair, keyed by edgeKey. Pairs rather than the mesh's own edge
// ids because those are renumbered by every initTopology, and a selection has to outlive one.

const TRI = Utils.TRI_INDEX;

export const edgeKey = (a, b) => (a < b ? a + '_' + b : b + '_' + a);

export const keyVerts = (k) => k.split('_').map(Number);

export function faceVerts(faces, f) {
  const i = f * 4;
  return faces[i + 3] === TRI
    ? [faces[i], faces[i + 1], faces[i + 2]]
    : [faces[i], faces[i + 1], faces[i + 2], faces[i + 3]];
}

// Built per operation, from the faces alone. Low-poly meshes are small and a tap is rare, so
// this is cheaper than keeping a second topology in step with every tool that edits the mesh.
export function buildAdjacency(faces, nbFaces) {
  const edgeFaces = new Map();  // edgeKey -> [face, ...]
  const vertNbrs = new Map();   // vertex  -> Set(neighbour vertex)
  const vertFaces = new Map();  // vertex  -> number of faces using it
  const link = (a, b) => {
    let s = vertNbrs.get(a);
    if (!s) vertNbrs.set(a, s = new Set());
    s.add(b);
  };
  for (let f = 0; f < nbFaces; ++f) {
    const vs = faceVerts(faces, f);
    for (let i = 0; i < vs.length; ++i) {
      const a = vs[i], b = vs[(i + 1) % vs.length];
      const k = edgeKey(a, b);
      const l = edgeFaces.get(k);
      if (l) l.push(f); else edgeFaces.set(k, [f]);
      link(a, b); link(b, a);
      vertFaces.set(a, (vertFaces.get(a) || 0) + 1);
    }
  }
  return { faces, nbFaces, edgeFaces, vertNbrs, vertFaces };
}

export const isEdge = (adj, a, b) => adj.edgeFaces.has(edgeKey(a, b));
const isBoundary = (adj, a, b) => (adj.edgeFaces.get(edgeKey(a, b)) || []).length === 1;

// The edge of face f nearest to point p (local space): what a tap on a face means.
export function nearestFaceEdge(faces, vertices, f, p) {
  const vs = faceVerts(faces, f);
  let best = null, bestD = Infinity;
  for (let i = 0; i < vs.length; ++i) {
    const a = vs[i], b = vs[(i + 1) % vs.length];
    const d = distSqToSegment(p, vertices, a, b);
    if (d < bestD) { bestD = d; best = [a, b]; }
  }
  return best;
}

function distSqToSegment(p, v, a, b) {
  const ax = v[a * 3], ay = v[a * 3 + 1], az = v[a * 3 + 2];
  const abx = v[b * 3] - ax, aby = v[b * 3 + 1] - ay, abz = v[b * 3 + 2] - az;
  const apx = p[0] - ax, apy = p[1] - ay, apz = p[2] - az;
  const len = abx * abx + aby * aby + abz * abz;
  const t = len > 0 ? Math.max(0, Math.min(1, (apx * abx + apy * aby + apz * abz) / len)) : 0;
  const dx = apx - t * abx, dy = apy - t * aby, dz = apz - t * abz;
  return dx * dx + dy * dy + dz * dz;
}

// ── LOOP ─────────────────────────────────────────────────────────────────────────────────────
//
// Arriving at v along (u, v), the loop carries on through v along the one edge that shares no
// face with (u, v) -- "straight across" -- which only exists when v has exactly four edges and
// four faces. Anything else (a pole, a boundary vertex, a fan of triangles) ends the loop.
// A BOUNDARY edge instead follows the boundary, which is the loop you mean when you tap the rim
// of an open mesh.
function nextLoopVert(adj, u, v) {
  const nb = adj.vertNbrs.get(v);
  if (!nb) return -1;
  if (isBoundary(adj, u, v)) {
    const cands = [...nb].filter((w) => w !== u && isBoundary(adj, v, w));
    return cands.length === 1 ? cands[0] : -1;
  }
  if (nb.size !== 4 || adj.vertFaces.get(v) !== 4) return -1;
  const used = new Set();
  for (const f of adj.edgeFaces.get(edgeKey(u, v))) for (const x of faceVerts(adj.faces, f)) used.add(x);
  const cands = [...nb].filter((w) => !used.has(w));
  return cands.length === 1 ? cands[0] : -1;
}

// -> { edges: [[a,b], ...] in walk order, closed }
export function walkLoop(adj, a, b) {
  const startKey = edgeKey(a, b);
  const seen = new Set([startKey]);
  const edges = [[a, b]];
  const walk = (u, v, push) => {
    for (;;) {
      const w = nextLoopVert(adj, u, v);
      if (w < 0) return false;
      const k = edgeKey(v, w);
      if (k === startKey) return true;
      if (seen.has(k)) return false;
      seen.add(k);
      push([v, w]);
      u = v; v = w;
    }
  };
  const closed = walk(a, b, (e) => edges.push(e));
  if (!closed) walk(b, a, (e) => edges.unshift([e[1], e[0]]));
  return { edges, closed };
}

// ── RING ─────────────────────────────────────────────────────────────────────────────────────
//
// The edges a loop cut crosses: from an edge, step across its quad to the opposite edge, then
// into the next quad, until a triangle, a boundary, or back to the start. Edges come back
// ORIENTED -- every edge's first vertex is on the same side of the cut -- which is what lets
// the cut put its new vertex the same fraction along each of them.

// The edge of quad f opposite (a, b), as [a', b'] with a' joined to a and b' joined to b.
function oppositeEdge(faces, f, a, b) {
  const vs = faceVerts(faces, f);
  const i = vs.indexOf(a), j = vs.indexOf(b);
  if ((i + 1) % 4 === j) return [vs[(i + 3) % 4], vs[(j + 1) % 4]];
  return [vs[(i + 1) % 4], vs[(j + 3) % 4]];
}

// -> { edges: [[a,b],...], quads: [f,...] (quads[k] lies between edges[k] and edges[k+1],
//      the last one closing back to edges[0] when closed), caps: [f,...] triangles at the ends,
//      closed }  or null when the ring runs into itself (non-manifold or a twisted strip).
export function walkRing(adj, a, b) {
  const startKey = edgeKey(a, b);
  const startFaces = adj.edgeFaces.get(startKey);
  if (!startFaces || startFaces.length > 2) return null;
  const visited = new Set();
  const isTri = (f) => adj.faces[f * 4 + 3] === TRI;

  // One direction. Returns { edges, quads, cap, closed } or null.
  const walk = (a0, b0, f0) => {
    const edges = [], quads = [];
    let ca = a0, cb = b0, cf = f0;
    while (cf !== undefined) {
      if (isTri(cf)) return { edges, quads, cap: cf, closed: false };
      if (visited.has(cf)) return null;
      visited.add(cf);
      quads.push(cf);
      const [na, nb] = oppositeEdge(adj.faces, cf, ca, cb);
      if (edgeKey(na, nb) === startKey) return { edges, quads, cap: -1, closed: true };
      edges.push([na, nb]);
      const fs = adj.edgeFaces.get(edgeKey(na, nb));
      if (fs.length > 2) return null;
      cf = fs.find((x) => x !== cf);
      ca = na; cb = nb;
    }
    return { edges, quads, cap: -1, closed: false };
  };

  const fwd = walk(a, b, startFaces[0]);
  if (!fwd) return null;
  if (fwd.closed) return { edges: [[a, b], ...fwd.edges], quads: fwd.quads, caps: [], closed: true };
  const back = startFaces.length > 1 ? walk(a, b, startFaces[1]) : { edges: [], quads: [], cap: -1 };
  if (!back) return null;
  // Stitch: back runs away from the start the other way, so reverse it onto the front.
  return {
    edges: [...back.edges.slice().reverse(), [a, b], ...fwd.edges],
    quads: [...back.quads.slice().reverse(), ...fwd.quads],
    caps: [back.cap, fwd.cap].filter((f) => f >= 0),
    closed: false,
  };
}

// ── CUT ──────────────────────────────────────────────────────────────────────────────────────
//
// Put a vertex on every ring edge at fraction t (from its first, oriented vertex), split each
// quad the ring crosses into two, and give each end triangle the new vertex on its edge -- a
// triangle with a point on one side is a quad, so no T-junction is left anywhere.
//
// `data` is { faces, nbFaces, vertices, nbVertices, colors, materials, groups } holding at least
// the live ranges; the result has the same shape and exact lengths (it is fed straight to
// SculptBase.applyMeshSnapshot). Per-vertex arrays are interpolated, face groups inherited.
//
// UVs, when present, come in and go out in the plain OBJ form: `uvs` (u,v pairs) and `facesUV`
// (a uv index per face corner, parallel to `faces`). A new corner's uv is interpolated from THAT
// face's corners, and shared between faces only when they shared both ends -- so a cut across a
// seam gets one uv per side of it. The mesh repacks this itself (initTexCoordsDataFromOBJData).
//
// Null when the cut cannot be made cleanly.
export function cutRing(data, ring, t = 0.5) {
  const { nbFaces, nbVertices } = data;
  const nE = ring.edges.length;
  const nbV = nbVertices + nE;
  const nbF = nbFaces + ring.quads.length;

  const lerpArr = (src) => {
    if (!src) return null;
    const out = new Float32Array(nbV * 3);
    out.set(src.subarray(0, nbVertices * 3));
    ring.edges.forEach(([a, b], k) => {
      const m = nbVertices + k;
      for (let c = 0; c < 3; ++c) out[m * 3 + c] = src[a * 3 + c] * (1 - t) + src[b * 3 + c] * t;
    });
    return out;
  };

  const faces = new Uint32Array(nbF * 4);
  faces.set(data.faces.subarray(0, nbFaces * 4));
  const groups = data.groups ? new Int32Array(nbF) : null;
  if (groups) groups.set(data.groups.subarray(0, nbFaces));

  const hasUV = !!(data.uvs && data.facesUV);
  const facesUV = hasUV ? new Uint32Array(nbF * 4) : null;
  if (hasUV) facesUV.set(data.facesUV.subarray(0, nbFaces * 4));
  const newUV = [];            // appended u,v pairs
  const uvMid = new Map();     // "uvFirst_uvSecond" (ring-oriented) -> new uv index
  const nbUV = hasUV ? data.uvs.length / 2 : 0;

  const mid = new Map();       // edgeKey -> [new vertex, ring edge's first vertex]
  ring.edges.forEach(([a, b], k) => mid.set(edgeKey(a, b), [nbVertices + k, a]));

  const corners = (f) => faceVerts(data.faces, f).map((v, i) => ({ v, uv: hasUV ? data.facesUV[f * 4 + i] : 0 }));

  // Walk the face's cycle and drop the matching new vertex between every pair that crosses
  // the cut. Winding is untouched because the cycle's order is.
  const withMids = (cs) => {
    const out = [];
    for (let i = 0; i < cs.length; ++i) {
      const c0 = cs[i], c1 = cs[(i + 1) % cs.length];
      out.push(c0);
      const m = mid.get(edgeKey(c0.v, c1.v));
      if (m === undefined) continue;
      let uv = 0;
      if (hasUV) {
        // Orient by the ring, so both faces on an edge ask for the same fraction from the same end.
        const [p, q] = m[1] === c0.v ? [c0.uv, c1.uv] : [c1.uv, c0.uv];
        const key = p + '_' + q;
        uv = uvMid.get(key);
        if (uv === undefined) {
          uv = nbUV + newUV.length / 2;
          uvMid.set(key, uv);
          newUV.push(data.uvs[p * 2] * (1 - t) + data.uvs[q * 2] * t, data.uvs[p * 2 + 1] * (1 - t) + data.uvs[q * 2 + 1] * t);
        }
      }
      out.push({ v: m[0], uv });
    }
    return out;
  };
  const write = (f, cs) => {
    for (let i = 0; i < 4; ++i) {
      faces[f * 4 + i] = i < cs.length ? cs[i].v : TRI;
      if (hasUV) facesUV[f * 4 + i] = i < cs.length ? cs[i].uv : TRI;
    }
  };

  let next = nbFaces;
  for (const f of ring.quads) {
    const six = withMids(corners(f));
    // Two new vertices in a hexagon; the cut runs between them.
    const m0 = six.findIndex((c) => c.v >= nbVertices);
    const rot = six.slice(m0).concat(six.slice(0, m0)); // [m, s, s, m', s', s']
    write(f, rot.slice(0, 4));
    write(next, [rot[3], rot[4], rot[5], rot[0]]);
    if (groups) groups[next] = groups[f];
    ++next;
  }
  // Both ends of one ring landing on the SAME triangle would make it a pentagon.
  for (const f of new Set(ring.caps)) {
    const cs = withMids(corners(f));
    if (cs.length > 4) return null;
    write(f, cs);
  }

  let uvs = null;
  if (hasUV) {
    uvs = new Float32Array(data.uvs.length + newUV.length);
    uvs.set(data.uvs);
    uvs.set(newUV, data.uvs.length);
  }

  return {
    faces, nbFaces: nbF,
    vertices: lerpArr(data.vertices), nbVertices: nbV,
    colors: lerpArr(data.colors), materials: lerpArr(data.materials),
    groups, uvs, facesUV,
    newVerts: ring.edges.map((_, k) => nbVertices + k),
  };
}

// ── MIRROR ───────────────────────────────────────────────────────────────────────────────────
//
// The edge across the local X=0 plane from (a, b) -- the same plane Extrude's symmetry uses --
// or null. Tolerance is relative to the edge, so it holds at any mesh scale.
export function mirrorEdge(adj, vertices, nbVertices, a, b) {
  const ex = vertices[a * 3] - vertices[b * 3], ey = vertices[a * 3 + 1] - vertices[b * 3 + 1], ez = vertices[a * 3 + 2] - vertices[b * 3 + 2];
  const tol = (ex * ex + ey * ey + ez * ez) * 1e-4;
  const find = (v) => {
    const x = -vertices[v * 3], y = vertices[v * 3 + 1], z = vertices[v * 3 + 2];
    let best = -1, bestD = tol;
    for (let i = 0; i < nbVertices; ++i) {
      const dx = vertices[i * 3] - x, dy = vertices[i * 3 + 1] - y, dz = vertices[i * 3 + 2] - z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d <= bestD) { bestD = d; best = i; }
    }
    return best;
  };
  const ma = find(a), mb = find(b);
  if (ma < 0 || mb < 0 || !isEdge(adj, ma, mb)) return null;
  return [ma, mb];
}
