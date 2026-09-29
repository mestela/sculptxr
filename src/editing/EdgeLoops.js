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

// ── BEVEL ────────────────────────────────────────────────────────────────────────────────────
//
// A one-segment bevel (a chamfer) of the edge set `keys`. The topology is built ONCE, and every
// vertex it moves or creates is recorded as "original vertex + w * fixed direction", so a width
// drag is just place(w) -- no rebuild per frame.
//
// Per vertex v touched by the selection, the faces round v are walked in order and the selected
// edges cut that fan into SECTORS. Each sector gets its own vertex (the first reuses v, so no
// vertex is orphaned), which slides along the sector's one unselected edge; with none (a single
// face between two selected edges) it moves along both, to the point at width w from each; with
// several, along their average. Each selected edge becomes a quad between its two faces' new
// vertices. Where three or more selected edges meet (or two at a boundary), a CAP fills the hole.
//
// THE OPEN END (k == 1 on a closed fan -- a run that stops at v): v stays, the two faces on the
// selected edge get new vertices slid along their other edge at v, the neighbouring faces take
// that new vertex into their side (a quad becomes a pentagon, split into quad + triangle), and
// the bevel face itself runs through v at that end. NOT a separate [v, vL, vR] triangle: vL and
// vR lie on v's own edges, so that triangle lies flat across the neighbouring face and overlaps
// it. Only interior edges bevel; boundary edges in `keys` are ignored.
//
// Same data shape as cutRing (uvs/facesUV in OBJ form). Returns null when nothing can be
// bevelled, else { nbFaces, faces, facesUV, groups, nbVertices, colors, materials, wMax,
// moved (indices whose position depends on w), place(w) -> { vertices, uvs } }.
export function bevelEdges(data, keys) {
  const { faces, nbFaces, nbVertices } = data;
  const V = data.vertices;
  const adj = buildAdjacency(faces, nbFaces);
  const sel = new Set([...keys].filter((k) => (adj.edgeFaces.get(k) || []).length === 2));
  if (!sel.size) return null;
  const isSel = (a, b) => sel.has(edgeKey(a, b));
  const hasUV = !!(data.uvs && data.facesUV);

  const vf = new Map();
  for (let f = 0; f < nbFaces; ++f) for (const v of faceVerts(faces, f)) {
    const l = vf.get(v);
    if (l) l.push(f); else vf.set(v, [f]);
  }
  const touched = new Set();
  for (const k of sel) for (const v of keyVerts(k)) touched.add(v);

  const P = (i) => [V[i * 3], V[i * 3 + 1], V[i * 3 + 2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const len = (a) => Math.hypot(a[0], a[1], a[2]);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const sinAt = (v, a, b) => {
    const da = sub(P(a), P(v)), db = sub(P(b), P(v));
    return Math.max(0.25, len(cross(da, db)) / (len(da) * len(db) || 1));
  };
  const faceNormal = (f) => {
    const vs = faceVerts(faces, f);
    const n = [0, 0, 0];
    for (let i = 0; i < vs.length; ++i) {
      const a = P(vs[i]), b = P(vs[(i + 1) % vs.length]);
      n[0] += (a[1] - b[1]) * (a[2] + b[2]); n[1] += (a[2] - b[2]) * (a[0] + b[0]); n[2] += (a[0] - b[0]) * (a[1] + b[1]);
    }
    return n;
  };

  let nbV = nbVertices;
  const specs = new Map();   // vertex index -> { base, terms: [[j, coefPerW]] }
  const sv = new Map();      // "f:v" -> the vertex that replaces v in face f
  const inserts = [];        // { f, a, b, m }: put m between a and b in face f's cycle
  const caps = [];           // { verts: [...], ref: normal, uvFace: [face per corner] }
  const openEnds = new Set(); // vertices where a selected run stops

  const fanOf = (v) => {
    const info = vf.get(v).map((f) => {
      const vs = faceVerts(faces, f), i = vs.indexOf(v);
      return { f, prev: vs[(i + vs.length - 1) % vs.length], next: vs[(i + 1) % vs.length] };
    });
    const byPrev = new Map(info.map((x) => [x.prev, x]));
    const nexts = new Set(info.map((x) => x.next));
    let start = info.find((x) => !nexts.has(x.prev));
    const closed = !start;
    if (closed) start = info[0];
    const order = [];
    const seen = new Set();
    for (let cur = start; cur && !seen.has(cur.f); cur = byPrev.get(cur.next)) { seen.add(cur.f); order.push(cur); }
    return order.length === info.length && byPrev.size === info.length ? { order, closed } : null;
  };

  for (const v of touched) {
    const fan = fanOf(v);
    if (!fan) return null; // non-manifold vertex
    let { order, closed } = fan;
    const k = order.filter((x) => isSel(v, x.next)).length;
    const ref = order.reduce((n, x) => { const m = faceNormal(x.f); return [n[0] + m[0], n[1] + m[1], n[2] + m[2]]; }, [0, 0, 0]);

    if (closed && k === 1) {
      const i1 = order.findIndex((x) => isSel(v, x.next));
      const F1 = order[i1], F2 = order[(i1 + 1) % order.length];
      const a = F1.next, p1 = F1.prev, p2 = F2.next;
      const G1 = order[(i1 + order.length - 1) % order.length], G2 = order[(i1 + 2) % order.length];
      const vL = nbV++, vR = nbV++;
      specs.set(vL, { base: v, terms: [[p1, 1 / (len(sub(P(p1), P(v))) * sinAt(v, p1, a))]] });
      specs.set(vR, { base: v, terms: [[p2, 1 / (len(sub(P(p2), P(v))) * sinAt(v, p2, a))]] });
      sv.set(F1.f + ':' + v, vL);
      sv.set(F2.f + ':' + v, vR);
      if (G1.f !== F2.f) inserts.push({ f: G1.f, a: v, b: p1, m: vL, uvFace: G1.f });
      if (G2.f !== F1.f) inserts.push({ f: G2.f, a: v, b: p2, m: vR, uvFace: G2.f });
      openEnds.add(v);
      continue;
    }

    if (closed) {
      const r = order.findIndex((x) => isSel(v, x.prev));
      order = order.slice(r).concat(order.slice(0, r));
    }
    const sectors = [];
    let cur = [];
    for (const x of order) {
      cur.push(x);
      if (isSel(v, x.next)) { sectors.push(cur); cur = []; }
    }
    if (cur.length) sectors.push(cur);

    const capVerts = [], capFaces = [];
    sectors.forEach((sec, si) => {
      const s = sec[0].prev, e = sec[sec.length - 1].next;
      const cands = sec.slice(0, -1).map((x) => x.next);
      if (!isSel(v, s)) cands.push(s);
      if (!isSel(v, e)) cands.push(e);
      const bounds = [s, e].filter((b) => isSel(v, b));
      let terms;
      if (cands.length === 1) {
        const c = cands[0];
        const sn = bounds.reduce((t, b) => t + sinAt(v, c, b), 0) / (bounds.length || 1);
        terms = [[c, 1 / (len(sub(P(c), P(v))) * sn)]];
      } else if (cands.length === 0) {
        const sn = sinAt(v, s, e);
        terms = [[s, 1 / (len(sub(P(s), P(v))) * sn)], [e, 1 / (len(sub(P(e), P(v))) * sn)]];
      } else {
        terms = cands.map((c) => [c, 1 / (cands.length * len(sub(P(c), P(v))))]);
      }
      const idx = si === 0 ? v : nbV++;
      specs.set(idx, { base: v, terms });
      for (const x of sec) sv.set(x.f + ':' + v, idx);
      capVerts.push(idx); capFaces.push(sec[0].f);
    });
    if ((closed && k >= 3) || (!closed && k >= 2)) caps.push({ verts: capVerts, ref, uvFace: capFaces });
  }

  // ── positions and the width limit ──
  let wMax = Infinity;
  for (const { base, terms } of specs.values()) for (const [, c] of terms) wMax = Math.min(wMax, 0.45 / c);
  const moved = [...specs.keys()];
  const posAt = (w) => {
    const out = new Float32Array(nbV * 3);
    out.set(V.subarray(0, nbVertices * 3));
    for (const [i, { base, terms }] of specs) {
      for (let c = 0; c < 3; ++c) {
        let p = V[base * 3 + c];
        for (const [j, k] of terms) p += k * w * (V[j * 3 + c] - V[base * 3 + c]);
        out[i * 3 + c] = p;
      }
    }
    return out;
  };

  // ── uvs: one new entry per (face, replaced corner), shared where the source uvs agree ──
  const uvSpecs = [];
  const uvKey = new Map();
  const nbUV = hasUV ? data.uvs.length / 2 : 0;
  const cornerUV = (f, v) => {
    const vs = faceVerts(faces, f), i = vs.indexOf(v);
    return i < 0 ? -1 : data.facesUV[f * 4 + i];
  };
  const uvFor = (f, idx) => {
    if (!hasUV) return 0;
    const spec = specs.get(idx);
    if (!spec) return cornerUV(f, idx);
    const base = cornerUV(f, spec.base);
    const terms = spec.terms.map(([j, c]) => [cornerUV(f, j), c]).filter(([u]) => u >= 0);
    const key = base + '|' + terms.map((t) => t.join(':')).join(',');
    let u = uvKey.get(key);
    if (u === undefined) { u = nbUV + uvSpecs.length; uvKey.set(key, u); uvSpecs.push({ base, terms }); }
    return u;
  };

  // ── faces ──
  const out = [];  // { corners: [{v, uv}], group }
  const groupOf = (f) => (data.groups ? data.groups[f] : 0);
  const split = (cs) => {
    const res = [];
    while (cs.length > 4) { res.push(cs.slice(0, 4)); cs = [cs[0]].concat(cs.slice(3)); }
    res.push(cs);
    return res;
  };
  for (let f = 0; f < nbFaces; ++f) {
    const vs = faceVerts(faces, f);
    let cs = vs.map((v, i) => {
      const r = sv.get(f + ':' + v);
      return r === undefined ? { v, uv: hasUV ? data.facesUV[f * 4 + i] : 0 } : { v: r, uv: uvFor(f, r) };
    });
    for (const ins of inserts) {
      if (ins.f !== f) continue;
      for (let i = 0; i < cs.length; ++i) {
        const x = cs[i].v, y = cs[(i + 1) % cs.length].v;
        if ((x === ins.a && y === ins.b) || (x === ins.b && y === ins.a)) {
          cs.splice(i + 1, 0, { v: ins.m, uv: uvFor(f, ins.m) });
          break;
        }
      }
    }
    if (cs.length > 6) return null;
    for (const piece of split(cs)) out.push({ corners: piece, group: groupOf(f) });
  }
  for (const k of sel) {
    const [f1, f2] = adj.edgeFaces.get(k);
    let [u, v] = keyVerts(k);
    const vs = faceVerts(faces, f1), i = vs.indexOf(u);
    if (vs[(i + 1) % vs.length] !== v) [u, v] = [v, u]; // f1 runs u -> v
    const S = (x, f) => { const r = sv.get(f + ':' + x); return r === undefined ? x : r; };
    const q = [[S(v, f1), f1], [S(u, f1), f1]];
    if (openEnds.has(u)) q.push([u, f1]);
    q.push([S(u, f2), f2], [S(v, f2), f2]);
    if (openEnds.has(v)) q.push([v, f1]);
    for (const piece of split(q.map(([x, f]) => ({ v: x, uv: uvFor(f, x) })))) out.push({ corners: piece, group: groupOf(f1) });
  }
  const probe = posAt(Math.min(wMax, 1e9) * 0.5);
  for (const cap of caps) {
    let cs = cap.verts.map((x, i) => ({ v: x, uv: uvFor(cap.uvFace[i], x) }));
    const n = [0, 0, 0];
    for (let i = 0; i < cs.length; ++i) {
      const a = cs[i].v * 3, b = cs[(i + 1) % cs.length].v * 3;
      n[0] += (probe[a + 1] - probe[b + 1]) * (probe[a + 2] + probe[b + 2]);
      n[1] += (probe[a + 2] - probe[b + 2]) * (probe[a] + probe[b]);
      n[2] += (probe[a] - probe[b]) * (probe[a + 1] + probe[b + 1]);
    }
    if (n[0] * cap.ref[0] + n[1] * cap.ref[1] + n[2] * cap.ref[2] < 0) cs = cs.reverse();
    for (const piece of split(cs)) out.push({ corners: piece, group: 0 });
  }

  const nbF = out.length;
  const F = new Uint32Array(nbF * 4);
  const FU = hasUV ? new Uint32Array(nbF * 4) : null;
  const groups = data.groups ? new Int32Array(nbF) : null;
  out.forEach(({ corners, group }, f) => {
    for (let i = 0; i < 4; ++i) {
      F[f * 4 + i] = i < corners.length ? corners[i].v : TRI;
      if (FU) FU[f * 4 + i] = i < corners.length ? corners[i].uv : TRI;
    }
    if (groups) groups[f] = group;
  });

  const copyArr = (src) => {
    if (!src) return null;
    const o = new Float32Array(nbV * 3);
    o.set(src.subarray(0, nbVertices * 3));
    for (const [i, { base }] of specs) if (i >= nbVertices) for (let c = 0; c < 3; ++c) o[i * 3 + c] = src[base * 3 + c];
    return o;
  };

  return {
    faces: F, nbFaces: nbF, facesUV: FU, groups, nbVertices: nbV,
    colors: copyArr(data.colors), materials: copyArr(data.materials),
    wMax, moved,
    place(w) {
      w = Math.max(0, Math.min(w, wMax));
      let uvs = null;
      if (hasUV) {
        uvs = new Float32Array((nbUV + uvSpecs.length) * 2);
        uvs.set(data.uvs);
        uvSpecs.forEach(({ base, terms }, i) => {
          for (let c = 0; c < 2; ++c) {
            let t = data.uvs[base * 2 + c];
            for (const [u, k] of terms) t += k * w * (data.uvs[u * 2 + c] - data.uvs[base * 2 + c]);
            uvs[(nbUV + i) * 2 + c] = t;
          }
        });
      }
      return { vertices: posAt(w), uvs };
    },
  };
}
