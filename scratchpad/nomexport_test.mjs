// node scratchpad/nomexport_test.mjs [file.nom] -- the return trip: patch, don't re-encode
import fs from 'fs';
import NomFile from '../src/files/NomFile.js';
import ExportNOM from '../src/files/ExportNOM.js';
const f = process.argv[2] || process.env.HOME + '/Desktop/sphere_facegroups.nom';
if (!fs.existsSync(f)) { console.log('skip: no sample at ' + f); process.exit(0); }
let bad = 0; const ok = (n, c, d = '') => { console.log((c ? 'ok   ' : 'FAIL ') + n + ' ' + d); if (!c) bad++; };
const raw = fs.readFileSync(f);
const nom = new NomFile(raw);
// walk to the mesh nodes
const found = []; (function w(ns, p) { ns.forEach((n, i) => { if (n.mesh !== undefined) found.push(p.concat(i)); if (n.children) w(n.children, p.concat(i)); }); })(nom.scene.scene, []);
const path = found[0];
const node = (() => { let ns = nom.scene.scene, n; for (const i of path) { n = ns[i]; ns = n.children; } return n; })();
// the placement the app adds on import: x50 scale + a shift, as a column-major matrix
const G = [50, 0, 0, 0, 0, 50, 0, 0, 0, 0, 50, 0, 3, 4, 5, 1];
const mul = (a, b) => { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c*4+r] = a[r]*b[c*4]+a[4+r]*b[c*4+1]+a[8+r]*b[c*4+2]+a[12+r]*b[c*4+3]; return o; };
const load = mul(G, node.matrix);
const mk = (cur) => ({ _nomSource: { file: nom, path, mesh: node.mesh }, _nomLoadMatrix: Float32Array.from(load), getMatrix: () => Float32Array.from(cur) });

// 1. untouched -> nothing moves, and the file is the same sculpt
let r = ExportNOM.exportNOM([mk(load)]);
ok('unmoved: 0 nodes rewritten', r.moved === 0, r.moved);
const a = new NomFile(r.bytes);
ok('unmoved: JSON equal', JSON.stringify(a.scene) === JSON.stringify(nom.scene));
ok('unmoved: data block byte-identical', Buffer.compare(Buffer.from(r.bytes.subarray(a.dataOffset, a.dataOffset + a.dataLength)), Buffer.from(raw.subarray(nom.dataOffset, nom.dataOffset + nom.dataLength))) === 0);
ok('unmoved: thumbnail identical', Buffer.compare(Buffer.from(r.bytes.subarray(a.thumbOffset, a.jsonOffset)), Buffer.from(raw.subarray(nom.thumbOffset, nom.jsonOffset))) === 0);

// 2. move +1 in x in APP space -> 1/50 in Nomad space
const T = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1];
r = ExportNOM.exportNOM([mk(mul(T, load))]);
const b = new NomFile(r.bytes);
const nn = (() => { let ns = b.scene.scene, n; for (const i of path) { n = ns[i]; ns = n.children; } return n; })();
ok('moved: 1 node rewritten', r.moved === 1);
ok('moved: x translation +0.02 (1 app unit / x50)', Math.abs(nn.matrix[12] - (node.matrix[12] + 0.02)) < 1e-9, nn.matrix[12] + ' vs ' + node.matrix[12]);
ok('moved: y,z untouched', nn.matrix[13] === node.matrix[13] && nn.matrix[14] === node.matrix[14]);
ok('moved: only that node differs', (() => { const x = JSON.parse(JSON.stringify(b.scene)), y = JSON.parse(JSON.stringify(nom.scene)); const g = (s) => { let ns = s.scene, n; for (const i of path) { n = ns[i]; ns = n.children; } return n; }; g(x).matrix = g(y).matrix; return JSON.stringify(x) === JSON.stringify(y); })());
ok('moved: arrays still decode', b.f32(b.scene.meshes[0].vertices).length === nom.f32(nom.scene.meshes[0].vertices).length);
ok('moved: source file not mutated (repeatable)', JSON.stringify(nom.scene.scene) === JSON.stringify(new NomFile(raw).scene.scene));
ok('header sizes consistent', b.totalSize === r.bytes.length && b.dataOffset + b.dataLength === r.bytes.length);
// 3. vertices: unchanged -> untouched, changed -> only the vertex array differs
{
  const m0 = nom.scene.meshes[0], nb = m0.vertices.count;
  const orig = nom.f32(m0.vertices);
  const withDup = (v) => { const o = new Float32Array(v.length + 30); o.set(v); return o; };   // + seam duplicates
  const mv = (verts) => Object.assign(mk(load), { getVertices: () => verts });
  let q = ExportNOM.exportNOM([mv(withDup(orig))]);
  ok('verts unchanged: reshaped 0', q.reshaped === 0);
  ok('verts unchanged: file identical but for JSON layout', Buffer.compare(Buffer.from(q.bytes.subarray(new NomFile(q.bytes).dataOffset)), Buffer.from(raw.subarray(nom.dataOffset))) === 0);
  const lean = Float32Array.from(orig); for (let i = 0; i < nb; i++) lean[i * 3] += 0.5 * orig[i * 3 + 1];
  q = ExportNOM.exportNOM([mv(withDup(lean))]);
  const qn = new NomFile(q.bytes);
  ok('verts changed: reshaped 1', q.reshaped === 1);
  ok('verts changed: array reads back leaned', (() => { const g = qn.f32(qn.scene.meshes[0].vertices); for (let i = 0; i < nb * 3; i++) if (g[i] !== lean[i]) return false; return true; })());
  ok('verts changed: every other array identical', (() => { const a = Buffer.from(q.bytes.subarray(qn.dataOffset)), b = Buffer.from(raw.subarray(nom.dataOffset)); const o = m0.vertices.offset, n = m0.vertices.length; return Buffer.compare(a.subarray(0, o), b.subarray(0, o)) === 0 && Buffer.compare(a.subarray(o + n), b.subarray(o + n)) === 0; })());
  ok('too few verts -> skipped, not corrupted', ExportNOM.exportNOM([mv(orig.subarray(0, 30))]).mismatched === 1);
  if (process.env.LEAN_OUT) fs.writeFileSync(process.env.LEAN_OUT, q.bytes);
}
if (process.argv[3]) fs.writeFileSync(process.argv[3], r.bytes);
process.exit(bad ? 1 : 0);
