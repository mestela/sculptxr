// Node harness for src/editing/EdgeLoops.js -- the loop/ring walks and the loop cut behind the
// Sel Loop and Cut Loop tools (and, later, Bevel).
//
// The module is pure (faces + vertices in, arrays out), so the shipped text runs here with only
// its Utils import swapped for the one constant it reads.
//
// What matters about a cut is structural, so that is what is checked: every edge still has one
// or two faces (no T-junction), winding is unchanged, and the counts are exact.
//
// Injections (each must make the suite FAIL):
//   EL_INJECT=flip     oppositeEdge pairs a' with b instead of a -- the ring loses its orientation
//   EL_INJECT=nocap    an end triangle is left alone, which leaves a T-junction
//   EL_INJECT=nopole   the loop walks through a pole instead of stopping at it
//   EL_INJECT=noseam   a new vertex gets ONE uv whichever side of a uv seam the face is on
//
// Run: node scratchpad/edgeloops_test.mjs
import fs from 'fs';

const SRC_PATH = new URL('../src/editing/EdgeLoops.js', import.meta.url).pathname;
let src = fs.readFileSync(SRC_PATH, 'utf8');
const inject = process.env.EL_INJECT;
const sub = (from, to) => {
  if (!src.includes(from)) throw new Error('injection anchor moved: ' + from);
  src = src.replace(from, to);
};
if (inject === 'flip') sub('return [vs[(i + 3) % 4], vs[(j + 1) % 4]];', 'return [vs[(j + 1) % 4], vs[(i + 3) % 4]];');
if (inject === 'nocap') sub('if (isTri(cf)) return { edges, quads, cap: cf, closed: false };', 'if (isTri(cf)) return { edges, quads, cap: -1, closed: false };');
if (inject === 'noseam') sub("const key = p + '_' + q;", 'const key = String(m[0]);');
if (inject === 'nopole') sub('if (nb.size !== 4 || adj.vertFaces.get(v) !== 4) return -1;', '');
src = src.replace(/^import Utils .*$/m, 'const Utils = { TRI_INDEX: 4294967295 };');
const EL = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
const TRI = 4294967295;

let fails = 0;
const check = (name, ok, extra) => {
  if (!ok) fails++;
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (ok || extra === undefined ? '' : '  — ' + extra));
};

// ── fixtures ───────────────────────────────────────────────────────────────────────────────
// Grid of nx*ny quads in the XY plane, centred on x=0, facing +Z.
function grid(nx, ny) {
  const v = [], f = [];
  const id = (i, j) => j * (nx + 1) + i;
  for (let j = 0; j <= ny; ++j) for (let i = 0; i <= nx; ++i) v.push(i - nx / 2, j, 0);
  for (let j = 0; j < ny; ++j) for (let i = 0; i < nx; ++i) f.push(id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1));
  return { vertices: new Float32Array(v), faces: new Uint32Array(f), id };
}
// Open-ended tube: s segments around, h quads tall.
function tube(s, h) {
  const v = [], f = [];
  const id = (i, j) => j * s + (i % s);
  for (let j = 0; j <= h; ++j) for (let i = 0; i < s; ++i) {
    const a = (i / s) * Math.PI * 2;
    v.push(Math.cos(a), j, Math.sin(a));
  }
  for (let j = 0; j < h; ++j) for (let i = 0; i < s; ++i) f.push(id(i, j), id(i, j + 1), id(i + 1, j + 1), id(i + 1, j));
  return { vertices: new Float32Array(v), faces: new Uint32Array(f), id };
}
const cube = () => ({
  vertices: new Float32Array([-1,-1,-1, 1,-1,-1, 1,1,-1, -1,1,-1, -1,-1,1, 1,-1,1, 1,1,1, -1,1,1]),
  faces: new Uint32Array([0,3,2,1, 4,5,6,7, 0,1,5,4, 2,3,7,6, 1,2,6,5, 0,4,7,3]),
});
const nbF = (m) => m.faces.length / 4;
const nbV = (m) => m.vertices.length / 3;
const adjOf = (m) => EL.buildAdjacency(m.faces, nbF(m));

// Edge census: key -> face count, and the boundary count.
function census(faces, n) {
  const c = new Map();
  for (let f = 0; f < n; ++f) {
    const vs = EL.faceVerts(faces, f);
    for (let i = 0; i < vs.length; ++i) {
      const k = EL.edgeKey(vs[i], vs[(i + 1) % vs.length]);
      c.set(k, (c.get(k) || 0) + 1);
    }
  }
  let boundary = 0, bad = 0;
  for (const n2 of c.values()) { if (n2 === 1) boundary++; else if (n2 !== 2) bad++; }
  return { boundary, bad };
}
function normal(faces, v, f) {
  const [a, b, c] = EL.faceVerts(faces, f);
  const u = [v[b*3]-v[a*3], v[b*3+1]-v[a*3+1], v[b*3+2]-v[a*3+2]];
  const w = [v[c*3]-v[a*3], v[c*3+1]-v[a*3+1], v[c*3+2]-v[a*3+2]];
  return [u[1]*w[2]-u[2]*w[1], u[2]*w[0]-u[0]*w[2], u[0]*w[1]-u[1]*w[0]];
}
const cut = (m, ring, extra = {}) => EL.cutRing({ faces: m.faces, nbFaces: nbF(m), vertices: m.vertices, nbVertices: nbV(m), colors: null, materials: null, groups: null, ...extra }, ring);

// ── LOOPS ─────────────────────────────────────────────────────────────────────────────────
{
  const g = grid(4, 3);
  const L = EL.walkLoop(adjOf(g), g.id(1, 1), g.id(2, 1));
  check('grid: an interior row loop runs boundary to boundary', L.edges.length === 4 && !L.closed, JSON.stringify(L));
  const chain = L.edges.every((e, i) => i === 0 || e[0] === L.edges[i - 1][1]);
  check('...as one connected chain in walk order', chain);
}
{
  const t = tube(6, 3);
  const L = EL.walkLoop(adjOf(t), t.id(0, 1), t.id(1, 1));
  check('tube: a loop around the middle closes with every segment', L.closed && L.edges.length === 6, JSON.stringify(L));
  const R = EL.walkLoop(adjOf(t), t.id(2, 0), t.id(3, 0));
  check('tube: tapping the rim selects the whole boundary loop', R.closed && R.edges.length === 6, JSON.stringify(R));
  const V = EL.walkLoop(adjOf(t), t.id(0, 1), t.id(0, 2));
  check('tube: a vertical loop runs rim to rim', !V.closed && V.edges.length === 3, JSON.stringify(V));
}
{
  // An L: a 2x2 grid missing its top-right quad. The centre vertex has four edges but only three
  // faces, and "straight across" from below would run out along the notch's boundary edge -- a
  // turn onto the rim, not a loop. Four edges alone is not enough; it needs four faces.
  const g = grid(2, 2);
  const m = { vertices: g.vertices, faces: g.faces.slice(0, 12) };
  const L = EL.walkLoop(adjOf(m), g.id(1, 0), g.id(1, 1));
  check('L-shape: a loop stops at a vertex with four edges but three faces', L.edges.length === 1, JSON.stringify(L));
}
{
  const c = cube();
  const L = EL.walkLoop(adjOf(c), 0, 1);
  check('cube: a loop stops at the valence-3 corners (poles)', L.edges.length === 1, JSON.stringify(L));
}

// ── RINGS ─────────────────────────────────────────────────────────────────────────────────
{
  const g = grid(4, 3);
  const r = EL.walkRing(adjOf(g), g.id(1, 1), g.id(1, 2));
  check('grid: a ring crosses the whole row', r && r.edges.length === 5 && r.quads.length === 4 && !r.closed, JSON.stringify(r));
  const ys = r.edges.map(([a]) => g.vertices[a * 3 + 1]);
  check('...with every edge oriented the same way (first vertex on one side)', ys.every((y) => y === ys[0]), ys.join(','));
}
{
  const t = tube(6, 2);
  const r = EL.walkRing(adjOf(t), t.id(0, 0), t.id(0, 1));
  check('tube: a ring around the tube closes', r && r.closed && r.edges.length === 6 && r.quads.length === 6, JSON.stringify(r));
}
{
  const c = cube();
  const r = EL.walkRing(adjOf(c), 0, 1);
  check('cube: a ring is the four faces around it', r && r.closed && r.quads.length === 4);
}

// ── CUTS ──────────────────────────────────────────────────────────────────────────────────
function cutChecks(label, m, ring, boundaryEnds) {
  const before = census(m.faces, nbF(m));
  const out = cut(m, ring);
  check(label + ': cut produced a mesh', !!out);
  if (!out) return null;
  const after = census(out.faces, out.nbFaces);
  check(label + ': counts are exact', out.nbVertices === nbV(m) + ring.edges.length && out.nbFaces === nbF(m) + ring.quads.length,
    `v ${out.nbVertices} f ${out.nbFaces}`);
  check(label + ': every edge still has one or two faces', after.bad === 0, after.bad + ' bad edges');
  check(label + ': no T-junction (only boundary edges the ring split are new)', after.boundary === before.boundary + boundaryEnds,
    `boundary ${before.boundary} -> ${after.boundary}`);
  const flipped = [];
  for (let f = 0; f < nbF(m); ++f) {
    const n0 = normal(m.faces, m.vertices, f), n1 = normal(out.faces, out.vertices, f);
    if (n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2] <= 0) flipped.push(f);
  }
  check(label + ': winding unchanged on every split face', flipped.length === 0, 'flipped ' + flipped.join(','));
  return out;
}
{
  const g = grid(4, 3);
  const r = EL.walkRing(adjOf(g), g.id(1, 1), g.id(1, 2));
  const out = cutChecks('grid', g, r, 2);
  const m = out.newVerts.map((v) => out.vertices[v * 3 + 1]);
  check('grid: new vertices sit halfway along their edges', m.every((y) => Math.abs(y - 1.5) < 1e-6), m.join(','));
}
{
  const t = tube(6, 2);
  cutChecks('tube', t, EL.walkRing(adjOf(t), t.id(0, 0), t.id(0, 1)), 0);
}
{
  const c = cube();
  cutChecks('cube', c, EL.walkRing(adjOf(c), 0, 1), 0);
}
{
  // A row of three quads whose last one is split into two triangles: the ring ends on a tri,
  // which must become a quad rather than be left with a vertex in its side.
  const g = grid(3, 1);
  const f = Array.from(g.faces.subarray(0, 8));
  const q = Array.from(g.faces.subarray(8, 12));
  f.push(q[0], q[1], q[2], TRI, q[0], q[2], q[3], TRI);
  const m = { vertices: g.vertices, faces: new Uint32Array(f) };
  const r = EL.walkRing(adjOf(m), g.id(0, 0), g.id(0, 1));
  check('tri: the ring stops at the triangle', r && r.caps.length === 1 && r.quads.length === 2, JSON.stringify(r));
  cutChecks('tri', m, r, 1);
}
{
  // Interpolation of the per-vertex arrays and inheritance of face groups.
  const g = grid(2, 1);
  const colors = new Float32Array(nbV(g) * 3);
  for (let i = 0; i < nbV(g); ++i) colors[i * 3] = g.vertices[i * 3 + 1]; // red = y
  const groups = new Int32Array([7, 9]);
  const r = EL.walkRing(adjOf(g), g.id(0, 0), g.id(0, 1));
  const out = cut(g, r, { colors, groups });
  check('colours are interpolated onto the new vertices', out.newVerts.every((v) => Math.abs(out.colors[v * 3] - 0.5) < 1e-6));
  check('each split face hands its group to its new half', out.groups[2] === 7 && out.groups[3] === 9, Array.from(out.groups).join(','));
}

{
  // UVs in OBJ form, with a SEAM down the middle of a 2x1 grid: the right quad's corners on the
  // centre column use their own uv entries. A cut across both quads crosses the seam, so the one
  // new vertex on the centre edge must get two uvs -- one per side -- and the outer ones one each.
  const g = grid(2, 1);
  const uvs = [];
  for (let i = 0; i < nbV(g); ++i) uvs.push(g.vertices[i * 3] + 1, g.vertices[i * 3 + 1]); // per-vertex
  const seamLo = uvs.length / 2; uvs.push(5, 0);   // centre column, bottom, as the right quad sees it
  const seamHi = uvs.length / 2; uvs.push(5, 1);   // ...top
  const facesUV = new Uint32Array(g.faces);
  // right quad = face 1: [id(1,0), id(2,0), id(2,1), id(1,1)]
  facesUV[4] = seamLo; facesUV[7] = seamHi;
  const r = EL.walkRing(adjOf(g), g.id(0, 0), g.id(0, 1));
  const out = cut(g, r, { uvs: new Float32Array(uvs), facesUV });
  const added = out.uvs.length / 2 - uvs.length / 2;
  check('uv: one new uv per edge, plus one more where the cut crosses the seam', added === 4, 'added ' + added);
  const used = new Set();
  for (let i = 0; i < out.nbFaces * 4; ++i) if (out.facesUV[i] >= uvs.length / 2) used.add(out.facesUV[i]);
  check('uv: every new uv is used by a face', used.size === added, used.size + ' used of ' + added);
  const vs = [...used].map((k) => [out.uvs[k * 2], out.uvs[k * 2 + 1]]);
  check('uv: new uvs sit halfway, and the seam side keeps its own u', vs.every(([, v]) => Math.abs(v - 0.5) < 1e-6) && vs.some(([u]) => u === 5),
    JSON.stringify(vs));
  check('uv: facesUV stays parallel to faces (TRI where faces has TRI)',
    out.facesUV.every((x, i) => (x === TRI) === (out.faces[i] === TRI)));
}

// ── MIRROR ────────────────────────────────────────────────────────────────────────────────
{
  const g = grid(4, 2);
  const e = EL.mirrorEdge(adjOf(g), g.vertices, nbV(g), g.id(0, 1), g.id(1, 1));
  check('mirror: finds the edge across x=0', e && EL.edgeKey(e[0], e[1]) === EL.edgeKey(g.id(4, 1), g.id(3, 1)), JSON.stringify(e));
  const c = EL.mirrorEdge(adjOf(g), g.vertices, nbV(g), g.id(2, 0), g.id(2, 1));
  check('mirror: an edge ON the plane is its own mirror', c && EL.edgeKey(c[0], c[1]) === EL.edgeKey(g.id(2, 0), g.id(2, 1)), JSON.stringify(c));
}

console.log(fails ? `\n${fails} FAILURE(S)` : '\nall checks passed');
process.exit(fails ? 1 : 0);
