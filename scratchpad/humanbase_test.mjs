// Node harness for the bundled human base mesh.
//
// This is the first mesh SculptXR ships as DATA rather than as procedural code, so the checks
// are about the two things that go wrong with a shipped asset: the file not matching what the
// loader expects, and the provenance getting lost. The second is not paranoia — "where did this
// mesh come from" is exactly what a licence audit asks, and the answer should not need to be
// reconstructed from a commit message.
//
// Run: node scratchpad/humanbase_test.mjs   (from the repo root)
import fs from 'fs';
import path from 'path';

const REPO = '/Users/mattestela/sculptxr';
const R = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
const LOADER = R('src/drawables/HumanBase.js');
const TOOL = R('tools/make_humanbase.mjs');
const SCENE = R('src/Scene.js');
const PANEL = R('src/gui/htmlvr/MainMenuPanel.js');

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

// ── the asset decodes exactly the way the loader reads it ────────────────────
const buf = fs.readFileSync(path.join(REPO, 'public/humanbase.bin'));
const head = new Uint32Array(buf.buffer, buf.byteOffset, 4);
check('the asset is present and carries the magic', head[0] === 0x53584842,
  '0x' + head[0].toString(16));
check('...at the version the loader accepts', head[1] === 1);

const nv = head[2], nf = head[3];
check('vertex and quad counts are the body group, not the whole OBJ',
  nv === 13380 && nf === 13378,
  nv + ' verts, ' + nf + ' quads — the source OBJ has 19158 verts and 18486 faces, the '
    + 'difference being MakeHuman’s helper and joint cages');
check('the file is exactly the size those counts imply',
  buf.length === 16 + nv * 12 + nf * 16,
  buf.length + ' vs ' + (16 + nv * 12 + nf * 16));

const verts = new Float32Array(buf.buffer, buf.byteOffset + 16, nv * 3);
const faces = new Uint32Array(buf.buffer, buf.byteOffset + 16 + nv * 12, nf * 4);

let maxIdx = 0;
for (let i = 0; i < faces.length; i++) if (faces[i] > maxIdx) maxIdx = faces[i];
check('every index is in range', maxIdx === nv - 1, 'max index ' + maxIdx + ' of ' + nv);

const used = new Uint8Array(nv);
for (let i = 0; i < faces.length; i++) used[faces[i]] = 1;
let orphans = 0;
for (let i = 0; i < nv; i++) if (!used[i]) orphans++;
check('no orphaned vertices survived the reindex', orphans === 0, orphans + ' unused',
  'a vertex no face refers to is a leftover of the helper cages');

let bad = 0;
for (let i = 0; i < verts.length; i++) if (!Number.isFinite(verts[i])) bad++;
check('every coordinate is finite', bad === 0, bad + ' bad');

// CENTRED, because Scene calls normalizeSize() and a figure that arrives off-origin lands
// somewhere surprising relative to the gizmo and the symmetry plane.
const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) {
  const v = verts[i * 3 + k];
  if (v < lo[k]) lo[k] = v;
  if (v > hi[k]) hi[k] = v;
}
const mid = [0, 1, 2].map((k) => (lo[k] + hi[k]) * 0.5);
check('the mesh is centred on the origin',
  mid.every((m) => Math.abs(m) < 1e-3), mid.map((m) => m.toFixed(4)).join(','));
check('...and is taller than it is wide, so it is the right way up',
  (hi[1] - lo[1]) > (hi[0] - lo[0]),
  'y ' + (hi[1] - lo[1]).toFixed(2) + ' vs x ' + (hi[0] - lo[0]).toFixed(2));

// ── the loader agrees with the file ──────────────────────────────────────────
check('the loader checks the magic rather than trusting the bytes',
  /head\[0\] !== MAGIC/.test(LOADER) && /0x53584842/.test(LOADER));
check('...and the version, so a future format change fails loudly',
  /head\[1\] !== 1/.test(LOADER));
check('the arrays are COPIED out of the fetched buffer',
  /new Float32Array\(buf, 16, nv \* 3\)\.slice\(\)/.test(LOADER)
    && /nf \* 4\)\.slice\(\)/.test(LOADER),
  'a view into the shared buffer would make every added figure edit one set of vertices');
check('...and again per build, so two figures are independent',
  /_cache\.vertices\.slice\(\)/.test(LOADER) && /_cache\.faces\.slice\(\)/.test(LOADER));
check('the decode is cached, so a second add is free',
  /if \(_cache\) return _cache;/.test(LOADER));

// ── the wiring ───────────────────────────────────────────────────────────────
check('Scene marks it as a QUAD mesh',
  /mesh\.isQuad = true;/.test(SCENE.slice(SCENE.indexOf('async addHumanBase()'),
    SCENE.indexOf('addGrid3x3()'))),
  'authored quad topology is the entire reason for shipping it');
check('...normalises the size like every other primitive',
  /mesh\.normalizeSize\(\);/.test(SCENE.slice(SCENE.indexOf('async addHumanBase()'),
    SCENE.indexOf('addGrid3x3()'))));
check('...and survives a failed fetch without throwing into the click handler',
  /console\.error\('\[humanbase\] could not load the base mesh', e\)/.test(SCENE));
check('the button awaits the load before the shared add path runs',
  /await main\.addHumanBase\?\.\(\);/.test(PANEL),
  'addPrimitive expects make() to return the mesh synchronously');
check('...and says it is working while it fetches',
  /btn\.disabled = true; btn\.textContent = '\.\.\.';/.test(PANEL)
    && /finally \{/.test(PANEL),
  '366 KB on a cold cache is long enough to look broken; the finally is what stops a failed '
    + 'fetch leaving the button stuck');

// ── the provenance ───────────────────────────────────────────────────────────
//
// CC0 requires no attribution. This is recorded because provenance is worth more than the
// obligation: the question a licence audit asks is "where did this come from", and the answer
// should not have to be reconstructed from a commit message.
for (const [what, src] of [['the loader', LOADER], ['the conversion tool', TOOL]]) {
  check(what + ' records where the mesh came from',
    /makehumancommunity\/makehuman/.test(src) && /base\.obj/.test(src));
  check(what + ' records the licence and how it is evidenced',
    /CC0/.test(src) && /september 2020/.test(src),
    'the OBJ header states the CC0 release; LICENSE.md section C names the base mesh');
}
check('the conversion is reproducible from the tool in the repo',
  /node tools\/make_humanbase\.mjs/.test(TOOL) && fs.existsSync(path.join(REPO, 'tools/make_humanbase.mjs')),
  'a binary nobody can regenerate is a binary nobody can check');
check('...and it says WHY only the body group is kept',
  /helper-\*/.test(TOOL) && /joint-\*/.test(TOOL),
  'the cages are MakeHuman pipeline scaffolding and arrive as floating junk');

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
