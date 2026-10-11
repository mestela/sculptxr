// Outliner order (SKEL v21) through a save and a reload, and the reorder helper.
//
// The lock is what stops the ray catching a bound character instead of the joints inside it,
// and it is set from the outliner on anything at all. It lived only in memory, so it did not
// survive a save — noticed the moment binding started setting it.
//
// This is a REAL ROUND TRIP, not a source guard: the shipped Skeleton.serialize writes a
// buffer and the shipped Skeleton.deserialize reads it back, so the two halves are checked
// against each other rather than against my description of them.
//
// Run: node scratchpad/skellock_test.mjs   (from the repo root)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO = new URL('..', import.meta.url).pathname;
let SRC = fs.readFileSync(path.join(REPO, 'src/editing/Skeleton.js'), 'utf8');

// Defect injection (standing lesson 1):
//   SKEL_INJECT=nocagebit  a baked capsule is saved as an ordinary mesh, so a reload cannot
//                          recognise it -- the Capsules button stops reaching it and the drawn
//                          capsules come back over the top
//   SKEL_INJECT=nohidden    visibility is not written, so a hidden mesh reloads visible
//   SKEL_INJECT=nocagejoint the cage comes back without the joint it speaks for
// (The two joint-volume injections that used to live here are gone: volumes were removed from
// the product, so `vols` is always empty -- one had become a silent no-op that proved nothing
// and the other's anchor had moved. A dead injection is worse than no injection, because the
// green tick still reads as coverage.)
//   SKEL_INJECT=nolevel  the file is written exactly as v11 wrote it, with no bound-level
//                        word -- the shape of every .sxr saved before today
//   SKEL_INJECT=pinbits  the pin mode is written with its old two bits only, so the fourth
//                        mode saves as unpinned while everything about the live session still
//                        looks right — the classic bitfield bug that only shows up on reload.
{
  const _i = process.env.SKEL_INJECT;
  const _cut = (a, b) => {
    if (!SRC.includes(a)) throw new Error('inject ' + _i + ': anchor moved');
    SRC = SRC.replace(a, b);
  };
  if (_i === 'nolevel') {
    // The v11 writer: no bound-level word at all. This is what every file saved before today
    // looks like, so the reader's fallback is measured against a real old file, not a mock one.
    _cut('const SKEL_VERSION = 12;', 'const SKEL_VERSION = 11;');
    _cut('    slots += 4 + s.j.length', '    slots += 3 + s.j.length');
    _cut('u[o++] = s.i; u[o++] = s.j.length; u[o++] = s.nbV; u[o++] = s.lvl;',
      'u[o++] = s.i; u[o++] = s.j.length; u[o++] = s.nbV;');
  }
  if (_i === 'nocagebit') _cut('| (m._isWeightCage ? 32 : 0) | (hidden ? 64 : 0)', '| (hidden ? 64 : 0)');
  else if (_i === 'nohidden') _cut('| (m._isWeightCage ? 32 : 0) | (hidden ? 64 : 0)', '| (m._isWeightCage ? 32 : 0)');
  else if (_i === 'nocagejoint') _cut('          if (row.parent && row.parent.getID) row.mesh._cageJointId = row.parent.getID();', '');
  if (process.env.SKEL_INJECT === 'pinbits') {
    const a = "\n        | (((m._boneIKPin | 0) & 4) << 2)\n";
    if (!SRC.includes(a)) throw new Error('inject pinbits: anchor moved');
    SRC = SRC.replace(a, "\n");
  }
}

// Same trick the other rig harnesses use: strip the imports, prepend just enough stubs, keep
// the code under test byte-identical to what ships.
const body = SRC.split('\n')
  .filter((l) => !/^import\s/.test(l))
  .filter((l) => !/^export default/.test(l))
  .join('\n');

const prelude = `
// Enough of three.js to EVALUATE and RUN. The serialiser touches none of it, but the module
// body builds materials at load time and the deserialiser ends in the visual rebuild — which
// its own try/catch would otherwise swallow, letting this harness pass on a half-done load.
// Every instance answers any method chainably and any vector component as 0.
const _inst = () => new Proxy({}, {
  get: (t, k) => {
    if (k === 'x' || k === 'y' || k === 'z' || k === 'w') return 0;
    if (k === 'elements') return new Float32Array(16);
    if (k === 'children' || k === 'geometry' || k === 'material') return _inst();
    if (k === 'visible') return true;
    if (typeof k === 'symbol') return undefined;
    return () => _inst();
  },
  set: () => true,
});
const _Any = new Proxy(function () {}, {
  construct: () => _inst(),
  apply: () => _inst(),
  get: () => _Any,
});
const THREE = new Proxy({}, { get: (t, k) => {
  if (k === 'DoubleSide' || k === 'GreaterDepth' || k === 'NormalBlending') return 0;
  return _Any;
} });
const Multimesh = class {};
const Primitives = { createSphere: () => ({}) };
const Enums = { Shader: { FLAT: 0 } };
const getOptionsURL = () => ({});
getOptionsURL.saveOption = () => {};
const mat4 = { clone: (m) => m.slice(), copy: (a, b) => { for (let i = 0; i < 16; i++) a[i] = b[i]; return a; } };
globalThis.window = globalThis.window || {};
`;

const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '_outlinerorder_gen.mjs');
fs.writeFileSync(outPath, prelude + '\n' + body + '\nexport default Skeleton;\n');
const Skeleton = (await import(outPath + '?v=' + Date.now())).default;

// The visual rebuild is NOT under test here — it wants a real three.js scene, and chasing a
// stub faithful enough to run it proves nothing about the file format. Stubbed out explicitly
// so the "did the load throw" check below covers the serialisation path and says so, rather
// than being quietly satisfied by deserialize's own try/catch.
Skeleton.updateVisuals = () => {};

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

let nextId = 1;
const mk = (over) => Object.assign({
  _id: nextId++,
  getID() { return this._id; },
  getMatrix() { return this._m || (this._m = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1])); },
  getModelSpaceMatrix() { return this.getMatrix(); },
  setModelSpaceMatrix() {},
  getThreeMesh() { return null; },
  isVisible() { return true; },
  // Records what the loader did, so a hidden mesh is observable in the reloaded copy — the
  // real one sets the SculptGL flag and the three-side flag together.
  setVisible(v) { this._isVisible = v; this._hiddenApplied = (v === false); },
}, over || {});

// The shape that made this matter: a bound character (not a bone, not parented) that binding
// locked, a joint, and an ordinary object left alone.
const roundTrip = (meshes) => {
  const buf = Skeleton.serialize(meshes);
  if (!buf) return null;
  // serialize returns the chunk; deserialize hunts for it from the END of the file.
  const withFooter = new ArrayBuffer(buf.byteLength);
  new Uint8Array(withFooter).set(new Uint8Array(buf));
  // The stack comes back from the SGL geometry, not from this block, so the fresh copies get
  // theirs the way the loader would already have built it -- the skin section then has a real
  // set of levels to resolve against.
  const fresh = meshes.map((m) => {
    const f = mk({ _id: m._id });
    if (m._levelSizes) {
      f._meshes = m._levelSizes.map((n) => ({ getNbVertices: () => n }));
      f._sel = m._sel | 0;
      f.getNbVertices = () => f._meshes[f._sel].getNbVertices();
    }
    return f;
  });
  // deserialize ends in healGraph/updateVisuals, and its own try/catch swallows anything that
  // throws in there. Give the mock what those need, or the load half-completes and the checks
  // below pass on whatever happened to be applied before the throw.
  const main = { _skelAll: new Set(), getMeshes: () => fresh, render() {}, _scene: null,
    // Restoring a PARENT link is a real part of the load — a baked capsule is parented to the
    // joint it speaks for, and that link is where the cage's joint comes from.
    setMeshParent(childId, parentId) {
      const c = fresh.find((m) => m._id === childId), p = fresh.find((m) => m._id === parentId);
      if (c) c._parentMesh = p || null;
    } };
  let threw = null;
  const err = console.error;
  console.error = (...a) => { threw = a.join(' '); };
  Skeleton.deserialize(withFooter, fresh, main);
  console.error = err;
  check('the load completes without throwing (visual rebuild aside)', !threw, threw || '');
  return fresh;
};


const idsOf = (arr) => arr.map((m) => m._id);
const byKey = (arr) => arr.slice().sort((a, b) => (a._outlinerKey ?? a._id) - (b._outlinerKey ?? b._id));

// an untouched scene writes no order and loads in creation order
{
  const ms = [mk({}), mk({}), mk({})];
  const out = roundTrip(ms);
  check('untouched scene: nothing written, no keys on reload', !out || out.every((m) => m._outlinerKey === undefined));
}
// a moved row survives: [a b c d] -> order c a d b
{
  const ms = [mk({}), mk({}), mk({}), mk({})];
  const [a, b, c, d] = ms;
  const want = [c, a, d, b];
  const keys = ms.map((m) => m._id);                  // permute the keys the way moveOutlinerRow does
  want.forEach((m, r) => { m._outlinerKey = keys[r]; });
  const out = roundTrip(ms);
  check('the file round-trips at all', !!out);
  if (out) {
    check('the reloaded order matches the saved order',
      JSON.stringify(idsOf(byKey(out))) === JSON.stringify(idsOf(want)), JSON.stringify(idsOf(byKey(out))));
    const later = mk({});                              // created after load: must sort last
    check('a mesh created after the load sorts last', byKey(out.concat([later])).pop() === later);
  }
}
// fresh copies get NEW ids on a real load; the rank is what must carry over
{
  const ms = [mk({}), mk({}), mk({})];
  const [a, b, c] = ms;
  [c, a, b].forEach((m, r) => { m._outlinerKey = ms[r]._id; });
  const buf = Skeleton.serialize(ms);
  const fresh = [mk({}), mk({}), mk({})];              // ids 10.. , same file order
  const main = { _skelAll: new Set(), getMeshes: () => fresh, render() {}, _scene: null, setMeshParent() {} };
  Skeleton.deserialize(buf, fresh, main);
  check('with new ids the same rank order comes back',
    JSON.stringify(idsOf(byKey(fresh))) === JSON.stringify([fresh[2]._id, fresh[0]._id, fresh[1]._id]));
}
// the reorder helper itself (same swap logic as MainMenuPanel.moveOutlinerRow)
{
  const src = fs.readFileSync(path.join(REPO, 'src/gui/htmlvr/MainMenuPanel.js'), 'utf8');
  const a = src.indexOf('export function outlinerKey'), b = src.indexOf('export function buildSectionHTML_scene');
  const code = src.slice(a, b).replace(/export /g, '');
  const { outlinerKey, moveOutlinerRow, placeOutlinerRow } = new Function(code + '; return { outlinerKey, moveOutlinerRow, placeOutlinerRow };')();
  const P = { getID: () => 99 };
  const ms = [mk({ _parentMesh: P }), mk({ _parentMesh: P }), mk({ _parentMesh: P }), mk({})];
  const main = { getMeshes: () => ms };
  check('move up swaps with the previous sibling', moveOutlinerRow(main, ms[1], -1)
    && outlinerKey(ms[1]) < outlinerKey(ms[0]) && outlinerKey(ms[0]) < outlinerKey(ms[2]));
  check('top row cannot move up', !moveOutlinerRow(main, ms[1], -1));
  check('bottom sibling cannot move down (other parent ignored)', !moveOutlinerRow(main, ms[2], 1));
  check('keys stay a permutation of the originals',
    JSON.stringify(ms.slice(0, 3).map(outlinerKey).sort()) === JSON.stringify([ms[0]._id, ms[1]._id, ms[2]._id].sort()));
  check('a different-parent mesh is untouched', ms[3]._outlinerKey === undefined);
}

{
  const src = fs.readFileSync(path.join(REPO, 'src/gui/htmlvr/MainMenuPanel.js'), 'utf8');
  const a = src.indexOf('export function outlinerKey'), b = src.indexOf('export function buildSectionHTML_scene');
  const { outlinerKey, placeOutlinerRow } = new Function(src.slice(a, b).replace(/export /g, '') + '; return { outlinerKey, placeOutlinerRow };')();
  const ms = [mk({}), mk({}), mk({}), mk({})];
  const main = { getMeshes: () => ms };
  const order = () => ms.slice().sort((x, y) => outlinerKey(x) - outlinerKey(y)).map((m) => ms.indexOf(m)).join('');
  check('drop a row before another', placeOutlinerRow(main, ms[3], ms[0], false) && order() === '3012', order());
  check('drop a row after another', placeOutlinerRow(main, ms[3], ms[1], true) && order() === '0132', order());
  check('drop after the last', placeOutlinerRow(main, ms[0], ms[2], true) && order() === '1320', order());
  check('keys remain unique', new Set(ms.map(outlinerKey)).size === 4);
}

{
  const ms = [mk({ _outlinerCollapsed: true }), mk({ _outlinerCollapsed: false }), mk({})];
  const out = roundTrip(ms);
  check('collapsed state round-trips', !!out && out[0]._outlinerCollapsed === true && out[1]._outlinerCollapsed === false);
  check('an unset branch stays unset (default expanded)', !!out && out[2]._outlinerCollapsed === undefined);
}

console.log(failures ? failures + ' FAILED' : 'all checks passed');
process.exit(failures ? 1 : 0);
