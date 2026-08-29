// Turn MakeHuman's CC0 base mesh into the compact binary SculptXR ships.
//
// SOURCE: makehumancommunity/makehuman, makehuman/data/3dobjs/base.obj — the file's own header
// states "This asset was explicitly released as CC0 in september 2020", and LICENSE.md section C
// names "The base mesh and proxies" among the CC0 assets. Copyright holders at release:
// Data Collection AB, Joel Palmius, Jonas Hauquier.
//
// WHY ONLY THE `body` GROUP. The OBJ carries three kinds of geometry: the body (13378 quads),
// MakeHuman's `helper-*` cages used to fit clothes and proxies (4358), and `joint-*` cubes
// marking rig positions (750). The last two are scaffolding for MakeHuman's own pipeline and
// would arrive in a sculpting app as floating junk around the figure.
//
// Run: node tools/make_humanbase.mjs path/to/base.obj public/humanbase.bin
import fs from 'fs';

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error('usage: node tools/make_humanbase.mjs <base.obj> <out.bin>');
  process.exit(1);
}

const V = [];
const F = [];
let group = null;
for (const line of fs.readFileSync(inPath, 'utf8').split('\n')) {
  if (line.startsWith('v ')) {
    const p = line.split(/\s+/);
    V.push([+p[1], +p[2], +p[3]]);
  } else if (line.startsWith('g ')) {
    group = line.slice(2).trim();
  } else if (line.startsWith('f ') && group === 'body') {
    const idx = line.trim().split(/\s+/).slice(1).map((t) => parseInt(t.split('/')[0], 10) - 1);
    if (idx.length === 4) F.push(idx);   // quads only; the body group has no triangles
  }
}

// Drop the vertices the helper and joint cages owned, and reindex.
const used = [...new Set(F.flat())].sort((a, b) => a - b);
const remap = new Map(used.map((o, n) => [o, n]));
const verts = used.map((i) => V[i]);
const faces = F.map((f) => f.map((i) => remap.get(i)));

// Centre on the bounding box. Scale is left alone — Scene calls normalizeSize() on add, the
// same as every other primitive, so the figure arrives the size of a unit cube.
const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
for (const v of verts) for (let k = 0; k < 3; k++) {
  if (v[k] < lo[k]) lo[k] = v[k];
  if (v[k] > hi[k]) hi[k] = v[k];
}
const mid = [0, 1, 2].map((k) => (lo[k] + hi[k]) * 0.5);

const vf = new Float32Array(verts.length * 3);
verts.forEach((v, i) => { for (let k = 0; k < 3; k++) vf[i * 3 + k] = v[k] - mid[k]; });
const fi = new Uint32Array(faces.length * 4);
faces.forEach((f, i) => { for (let k = 0; k < 4; k++) fi[i * 4 + k] = f[k]; });

// magic 'SXHB', version, vertex count, quad count, then the two arrays.
const head = new Uint32Array([0x53584842, 1, verts.length, faces.length]);
fs.writeFileSync(outPath, Buffer.concat([
  Buffer.from(head.buffer), Buffer.from(vf.buffer), Buffer.from(fi.buffer)]));
console.log('wrote ' + outPath + ': ' + verts.length + ' verts, ' + faces.length + ' quads, '
  + (fs.statSync(outPath).size / 1024).toFixed(0) + ' KB'
  + '  (source bounds ' + (hi[1] - lo[1]).toFixed(2) + ' tall, centred on origin)');
