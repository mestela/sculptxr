// A .sxr saved below the top level keeps what was sculpted above it: Multimesh.synthesizeAbove on
// save, analyseAbove on load. The methods are lifted from the real source and run on a small sheet
// with a stubbed midpoint subdivision. The full round trip needs the app; this guards the logic.
// node scratchpad/levelsabove_test.mjs
//   LA_INJECT=nosynth    the save doesn't refresh the levels above: the edit-below check must fail
//   LA_INJECT=noanalyse  the load derives no details: the sculpt check must fail
//   LA_INJECT=nonormals  the load skips the normals: the edit-after-reload check must fail
//   LA_INJECT=rigstep    a bound mesh's step down copies into the skin's level: the rig step check must fail
//   LA_INJECT=rigload    a bound mesh derives no details on load: the rig load check must fail
//   LA_INJECT=nosettle   no extra pass when the joints stop: the settle check must fail
//   LA_INJECT=undo       a stroke above the bound level journals no details: the undo check must fail
//   LA_INJECT=keep       keepVertices doesn't keep them: the rig step check must fail
//   LA_INJECT=fixdraw    a level draws without its pose fixes: the fix check must fail
//   LA_INJECT=fixmeasure a level's measurement keeps the pose fixes in it: the base details check must fail
//   LA_INJECT=alias      setSelection leaves the attributes on the level arrays: the upload check must fail
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
let mm = read('../src/mesh/multiresolution/Multimesh.js');
let res = read('../src/mesh/multiresolution/MeshResolution.js');
let exp = read('../src/files/ExportSGL.js');
let imp = read('../src/files/ImportSGL.js');
let skel = read('../src/editing/Skeleton.js');
let skin = read('../src/editing/Skinning.js');

const inject = (s, a, b) => { if (!s.includes(a)) throw new Error('anchor moved: ' + a); return s.replace(a, b); };
const i = process.env.LA_INJECT;
if (i === 'nosynth') exp = inject(exp, 'mesh.synthesizeAbove();', '');
if (i === 'rigstep') mm = inject(mm, 'undefined, bound >= 0 && this._sel - 1 >= bound)', 'undefined, false)');
if (i === 'rigload') skel = inject(skel, 'if (stack) mesh.analyseAbove?.(stack.indexOf(level), mesh._sel);', '');
if (i === 'nosettle') skin = inject(skin, '!mesh._skinDirty && !mesh._skinSettle) return false;', '!mesh._skinDirty) return false;');
if (i === 'undo') skin = inject(skin, 'Skinning._lastRestEntry.details = details;', '');
if (i === 'keep') res = inject(res, 'if (!keepVertices) vArDown.set(', 'vArDown.set(');
if (i === 'noanalyse') imp = inject(imp, 'if (version >= 30) mm.analyseAbove();', '');
if (i === 'fixdraw') res = inject(res, 'dAr = shown;', '');
if (i === 'fixmeasure') res = inject(res, 'for (var f = 0; f < fix.length; ++f) dAr[f] -= fix[f];', ';');
if (i === 'nonormals') mm = inject(mm, 'this._meshes[i].updateVerticesNormal();', '');

function braces(src, at) {
  let d = 0;
  for (let k = src.indexOf('{', at); k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}' && --d === 0) return k + 1;
  }
}
const helperAt = res.indexOf('function tangentNeighbour(');
const helper = res.slice(helperAt, braces(res, helperAt));
function lift(src, name) {
  const at = src.indexOf('\n  ' + name + '(');
  if (at < 0) throw new Error('no method ' + name);
  return new Function('Utils', helper + '\nreturn function ' + src.slice(src.indexOf('(', at), braces(src, at)))({ getMemory: (n) => new ArrayBuffer(n) });
}

// A strip of n vertices along x; each level doubles it, even vertices first, like real subdivision.
class Level {
  constructor(n) {
    this.n = n;
    this.v = new Float32Array(n * 3); this.c = new Float32Array(n * 3).fill(0.5); this.m = new Float32Array(n * 3).fill(0.5);
    for (let k = 0; k < n; k++) this.v[k * 3] = k;
    this.nrm = new Float32Array(n * 3);
    this.ring = new Uint32Array(n * 2); this.sc = new Uint32Array(n * 2);
    for (let k = 0, r = 0; k < n; k++) {
      const nb = [k - 1, k + 1].filter((x) => x >= 0 && x < n);
      this.sc[k * 2] = r; this.sc[k * 2 + 1] = nb.length;
      nb.forEach((x, o) => { this.ring[r + o] = x; }); r += nb.length;
    }
  }
  getNbVertices() { return this.n; }
  getVertices() { return this.v; }
  getNormals() { return this.nrm; }
  getColors() { return this.c; }
  getMaterials() { return this.m; }
  getVerticesRingVertStartCount() { return this.sc; }
  getVerticesRingVert() { return this.ring; }
  getVerticesMapping() { return null; }
  // Stand-in normals that follow the positions, so a level with none is a degenerate frame.
  updateFacesAabbAndNormal() {}
  updateVerticesNormal() {
    for (let k = 0; k < this.n; k++) {
      this.nrm[k * 3] = 0; this.nrm[k * 3 + 1] = 1; this.nrm[k * 3 + 2] = 0.2 + 0.1 * Math.sin(this.v[k * 3 + 1]);
    }
  }
  computePartialSubdivision(v, c, m) {
    const a = this.v, n = this.n;
    v.set(a.subarray(0, n * 3));
    for (let k = 0; k < n; k++) {
      const p = Math.min(k, n - 2);
      for (let d = 0; d < 3; d++) v[(n + k) * 3 + d] = (a[p * 3 + d] + a[(p + 1) * 3 + d]) / 2 + (k === n - 1 ? 0.5 * (d === 0) : 0);
    }
    c.fill(0.5, 0, 2 * n * 3); m.fill(0.5, 0, 2 * n * 3);
  }
}
for (const [src, name] of [[res, 'computeDetails'], [res, 'applyDetails']]) Level.prototype[name] = lift(src, name);
Level.prototype.higherSynthesis = function (down) { down.computePartialSubdivision(this.v, this.c, this.m); this.applyDetails(); };
Level.prototype.analyseUp = function (up) {
  const n = up.n * 3, s = new Float32Array(n * 3);
  this.computePartialSubdivision(s.subarray(0, n), s.subarray(n, n * 2), s.subarray(n * 2));
  up.computeDetails(s.subarray(0, n), s.subarray(n, n * 2), s.subarray(n * 2), up.n);
};
const _boundIndex = lift(mm, '_boundIndex');
const synthesizeAbove = lift(mm, 'synthesizeAbove');
const analyseAbove = lift(mm, 'analyseAbove');
const saves = exp.includes('mesh.synthesizeAbove();');
const rigLoads = skel.includes('if (stack) mesh.analyseAbove?.(stack.indexOf(level), mesh._sel);');
const loads = /if \(version >= 30\) mm\.analyseAbove\(\);/.test(imp);

// three levels, a bump on each upper level, displayed `sel`, then a save and a load
function stack() {
  const m = [new Level(5), new Level(10), new Level(20)];
  const self = { _meshes: m, _sel: 2, synthesizeAbove, analyseAbove, _boundIndex };
  m[1].computePartialSubdivision(m[2].v, m[2].c, m[2].m); m[0].computePartialSubdivision(m[1].v, m[1].c, m[1].m);
  m[1].computePartialSubdivision(m[2].v, m[2].c, m[2].m);
  for (let k = 0; k < 20; k++) m[2].v[k * 3 + 1] += 0.5 * Math.sin(k);   // top-level sculpt
  return self;
}
const stepDown = (s) => {
  const lo = s._meshes[s._sel - 1], up = s._meshes[s._sel];
  lo.v.set(up.v.subarray(0, lo.n * 3));
  up.updateVerticesNormal();
  lo.analyseUp(up);
  s._sel--;
};
const stepUp = (s) => { s._meshes[s._sel + 1].higherSynthesis(s._meshes[s._sel]); s._sel++; };
function throughFile(s) {
  if (saves) s.synthesizeAbove();
  const out = { _meshes: s._meshes.map((l) => { const c = new Level(l.n); c.v.set(l.v); c.c.set(l.c); c.m.set(l.m); return c; }), _sel: s._sel, synthesizeAbove, analyseAbove, _boundIndex };
  if (loads) out.analyseAbove();
  return out;
}
const maxDiff = (a, b) => { let d = 0; for (let k = 0; k < a.length; k++) d = Math.max(d, Math.abs(a[k] - b[k])); return d; };

let fails = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? 'ok  ' : '  FAIL'} ${name} ${info}`); if (!ok) fails++; };

// A: in-session truth vs the same steps through a file, nothing edited below
{
  const s = stack(); stepDown(s); stepDown(s);
  const r = throughFile(s);
  stepUp(r); stepUp(r);
  const ref = stack();
  const d = maxDiff(r._meshes[2].v, ref._meshes[2].v);
  check('sculpt on the top level survives a save at level 0', d < 1e-3, `max ${d.toFixed(5)}`);
  check('it was really not plain subdivision', maxDiff(ref._meshes[2].v, (() => { const t = stack(); t._meshes[1].computePartialSubdivision(t._meshes[2].v, t._meshes[2].c, t._meshes[2].m); return t._meshes[2].v; })()) > 0.1);
}
// B: edit the displayed level after stepping down: it must carry through, as it does in session
{
  const a = stack(); stepDown(a); stepDown(a);
  const b = stack(); stepDown(b); stepDown(b);
  for (const s of [a, b]) for (let k = 0; k < 5; k++) s._meshes[0].v[k * 3 + 1] += 1;
  stepUp(a); stepUp(a);
  const r = throughFile(b);
  stepUp(r); stepUp(r);
  const d = maxDiff(r._meshes[2].v, a._meshes[2].v);
  check('an edit below the saved upper levels comes back as in session', d < 1e-3, `max ${d.toFixed(5)}`);
}
// B2: edit after the reload. The details have to ride the surface's frame: without normals they fall
// back to object space, which a first step up can't tell apart.
{
  const bend = (l) => { for (let k = 0; k < l.n; k++) { const x = l.v[k * 3]; l.v[k * 3 + 1] += 0.3 * x * x; } };
  const a = stack(); stepDown(a); stepDown(a);
  const b = stack(); stepDown(b); stepDown(b);
  const r = throughFile(b);
  bend(a._meshes[0]); bend(r._meshes[0]);
  stepUp(a); stepUp(a); stepUp(r); stepUp(r);
  const d = maxDiff(r._meshes[2].v, a._meshes[2].v);
  check('an edit after the reload moves the details as in session', d < 1e-3, `max ${d.toFixed(5)}`);
}
// C: saving doesn't touch what is displayed, or anything below
{
  const s = stack(); stepDown(s);
  const before = s._meshes.slice(0, 2).map((l) => l.v.slice());
  s.synthesizeAbove();
  check('the save leaves the displayed level and below alone', s._meshes.slice(0, 2).every((l, k) => maxDiff(l.v, before[k]) === 0));
}
// D: saved at the top nothing runs
{
  const s = stack(); const v = s._meshes[2].v.slice();
  s.synthesizeAbove(); s.analyseAbove();
  check('at the top level both are no-ops', maxDiff(s._meshes[2].v, v) === 0 && !s._meshes[2]._detailsXYZ);
}

// D2: a bound mesh. The step down leaves the skin's level alone, the skin pass rebuilds it, and the
// sculpt above comes back: the real copy and lowerLevel, lifted, with the pass stubbed.
{
  const copyData = lift(res, 'copyDataFromHigherRes');
  const lowerAnalysis = lift(res, 'lowerAnalysis');
  const lowerLevel = lift(mm, 'lowerLevel');
  const s = stack();
  s._meshes.forEach((l) => { l.copyDataFromHigherRes = copyData; l.lowerAnalysis = lowerAnalysis; l.getEvenMapping = () => false; });
  Object.assign(s, { _skinW: [1], _skinLevelMesh: s._meshes[1], lowerLevel, getCurrentMesh() { return this._meshes[this._sel]; },
    setSelection(k) { this._sel = k; }, updateResolution() { this.getCurrentMesh().updateVerticesNormal(); } });
  s._meshes[2].updateVerticesNormal();
  const skinDrew = s._meshes[1].v.slice();
  const top = s._meshes[2].v.slice();
  s.lowerLevel();
  check('a step down leaves the skin\'s level alone', maxDiff(s._meshes[1].v, skinDrew) === 0);
  s._meshes[1].v.set(skinDrew);                    // the skin pass redraws its level
  s._meshes[2].higherSynthesis(s._meshes[1]);
  check('the sculpt above it survives the pass', maxDiff(s._meshes[2].v, top) < 1e-3, `max ${maxDiff(s._meshes[2].v, top).toFixed(5)}`);
  const c = s._meshes[0].c.slice(); s._meshes[1].c.fill(0.25); s._meshes[1].updateVerticesNormal();
  s._meshes[0].lowerAnalysis(s._meshes[1], undefined, true);
  check('below it, colours still come down', maxDiff(s._meshes[0].c, c) > 0.1 && s._meshes[0].c[0] === 0.25);
  check('a bound mesh derives its details on load', rigLoads);
  check('a stroke above the bound level journals its details for undo', skin.includes('Skinning._lastRestEntry.details = details;'));
  check('a new level on a bound mesh queues the pass its snapshot comes from', /pushMesh\(mesh\) \{[\s\S]{0,420}?if \(this\._skinW\) this\._skinDirty = true;/.test(mm));
  check('the skin pass settles once when the joints stop', skin.includes('!mesh._skinDirty && !mesh._skinSettle) return false;'));
  check('...or a shape does', skin.includes('mesh._skinSettle = (posedNow || mesh._skinDirty) &&'));
  const unbound = { _meshes: s._meshes, _boundIndex };
  check('an unbound mesh has no skin level', unbound._boundIndex() === -1);
}

// E: showing a lower level must not write into the level the render attributes were made from
{
  if (i === 'alias') mm = inject(mm, 'this._detachRenderArrays();\n    this._sel = sel;', 'this._sel = sel;');
  const setSelection = lift(mm, 'setSelection');
  const m = [new Level(5), new Level(10)];
  m.forEach((l) => l.updateVerticesNormal());
  m.forEach((l) => { l.getMaterials = () => l.m; l.getMeshData = () => l; });
  const attrs = { position: { array: m[1].v }, normal: { array: m[1].nrm }, color: { array: m[1].c }, aMaterial: { array: m[1].m } };
  const self = { _meshes: m, _sel: 1, getRenderData: () => ({ _geometry: { getAttribute: (n) => attrs[n] } }),
    _detachRenderArrays: lift(mm, '_detachRenderArrays'), setSelection, getCurrentMesh() { return m[this._sel]; }, setMeshData() {}, getColors: () => null };
  const before = { n: m[1].nrm.slice(), c: m[1].c.slice() };
  m[0].nrm.fill(9); m[0].c.fill(0.25);
  self.setSelection(0);
  const upload = (a, d) => a.array.set(d);        // what Mesh.updateNormalBuffer and friends do
  upload(attrs.normal, m[0].nrm); upload(attrs.color, m[0].c);
  check('a lower level uploading leaves the upper arrays alone', maxDiff(m[1].nrm, before.n) === 0 && maxDiff(m[1].c, before.c) === 0);
  check('the attributes keep their size', attrs.position.array.length === m[1].v.length && attrs.normal.array !== m[1].nrm);
  const again = attrs.normal.array; self.setSelection(1);
  check('an attribute already detached is not copied again', attrs.normal.array === again);
}

// A pose's fix is drawn with the level's details and kept out of them when the level is measured.
{
  const s = stack(); stepDown(s);
  const top = s._meshes[2], low = s._meshes[1], base = top._detailsXYZ.slice();
  top.updateVerticesNormal();
  top.higherSynthesis(low);
  const plain = top.v.slice();
  top._detailsFix = new Float32Array(top.n * 3);
  for (let k = 12; k < 16; k++) top._detailsFix[k * 3] = 0.4;
  top.higherSynthesis(low);
  const d = maxDiff(top.v, plain);
  check('a level draws its pose fixes', d > 0.3 && d <= 0.4, `moved ${d.toFixed(4)}`);
  low.analyseUp(top);
  const e = maxDiff(top._detailsXYZ, base);
  check('...and they stay out of its own details when it is measured', e < 1e-3, `off by ${e.toFixed(5)}`);
  top._detailsFix = null;
  top.higherSynthesis(low);
  check('...so they come off cleanly', maxDiff(top.v, plain) < 1e-3);
  top._detailsFix = new Float32Array(3);
  top.higherSynthesis(low);
  check('a fix of the wrong size is ignored', maxDiff(top.v, plain) < 1e-3);
}

if (fails) { console.log(`${fails} FAILURE(S)`); process.exit(1); }
console.log('all checks passed');
