// The selection lock through a save and a reload.
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

const REPO = '/Users/mattestela/sculptxr';
let SRC = fs.readFileSync(path.join(REPO, 'src/editing/Skeleton.js'), 'utf8');

// Defect injection (standing lesson 1):
//   SKEL_INJECT=nocagebit  a baked capsule is saved as an ordinary mesh, so a reload cannot
//                          recognise it -- the Capsules button stops reaching it and the drawn
//                          capsules come back over the top
//   SKEL_INJECT=nohidden    visibility is not written, so a hidden mesh reloads visible
//   SKEL_INJECT=nocagejoint the cage comes back without the joint it speaks for
//   SKEL_INJECT=novolsave  joint volumes are not written, so a saved rig reloads as bare capsules
//   SKEL_INJECT=volflags   the "fitted" flags are dropped, so an auto-fitted volume comes back
//                          frozen at the size it happened to have when saved
//   SKEL_INJECT=pinbits  the pin mode is written with its old two bits only, so the fourth
//                        mode saves as unpinned while everything about the live session still
//                        looks right — the classic bitfield bug that only shows up on reload.
{
  const _i = process.env.SKEL_INJECT;
  const _cut = (a, b) => {
    if (!SRC.includes(a)) throw new Error('inject ' + _i + ': anchor moved');
    SRC = SRC.replace(a, b);
  };
  if (_i === 'novolsave') _cut('  u[o++] = vols.length;', '  u[o++] = 0;');
  else if (_i === 'volflags') _cut('    u[o++] = v.shape | (d ? 16 : 0) | (off ? 32 : 0) | (rot ? 64 : 0);',
    '    u[o++] = v.shape | 16 | 32 | 64;');
  else if (_i === 'nocagebit') _cut('| (m._isWeightCage ? 32 : 0) | (hidden ? 64 : 0),', '| (hidden ? 64 : 0),');
  else if (_i === 'nohidden') _cut('| (m._isWeightCage ? 32 : 0) | (hidden ? 64 : 0),', '| (m._isWeightCage ? 32 : 0),');
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

const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '_skellock_gen.mjs');
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
  const fresh = meshes.map((m) => mk({ _id: m._id }));
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

{
  const skin = mk({ _selectLocked: true });          // bound character: locked, no parent, no bone
  const bone = mk({ _isBone: true, _boneRadius: 1 });
  const other = mk({});                               // ordinary object, untouched
  const out = roundTrip([skin, bone, other]);
  check('the file round-trips at all', !!out);
  if (out) {
    check('a locked mesh comes back locked', out[0]._selectLocked === true,
      'the lock is the thing that keeps the ray off a bound character');
    check('an unlocked mesh stays unlocked', !out[2]._selectLocked,
      'a blanket lock would make ordinary objects unpickable');
    check('the joint is still a joint', out[1]._isBone === true,
      'the lock bit must not disturb the flags it shares a word with');
  }
}

// EVERY PIN MODE SURVIVES THE ROUND TRIP, including the one that does not fit the two bits the
// field started with. PIN_ROT is 4 and bit 3 belongs to the selection lock, so its high bit had
// to go above the lock rather than beside its own low bits — an arrangement that works in every
// live session and fails only on reload, which is the kind of bug worth a check of its own. The
// lock is set on the same meshes on purpose: the two share a word and the whole risk is that
// one of them eats the other's bit.
{
  const modes = [1, 2, 3, 4];
  const bones = modes.map((m) => mk({ _isBone: true, _boneIKPin: m, _selectLocked: true }));
  const out = roundTrip(bones);
  check('every pin mode round-trips', !!out && modes.every((m, i) => out[i]._boneIKPin === m),
    out ? 'got ' + modes.map((m, i) => out[i]._boneIKPin).join(',') : 'no file');
  check('and the selection lock they share a word with survives too',
    !!out && modes.every((m, i) => out[i]._selectLocked === true));
  check('and they are all still joints', !!out && modes.every((m, i) => out[i]._isBone === true));
}

// A LOCKED MESH THAT IS NEITHER A BONE NOR PARENTED must still earn a row — that is exactly
// the bound-character case, and the entry filter used to drop it.
{
  const lone = mk({ _selectLocked: true });
  const bone = mk({ _isBone: true });
  const out = roundTrip([lone, bone]);
  check('a lone locked mesh is written at all', out && out[0]._selectLocked === true,
    'the entry filter dropped anything that was neither parented nor a bone');
}

// An explicit UNLOCK on a bound mesh has to stick. The loader re-derives the lock from the
// bind state for older files; if that ran on a v4 file it would override the unlock, and a
// mesh you deliberately unlocked would come back locked every single time you opened it.
{
  const code = SRC.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  check('the bind-derived lock is confined to pre-v4 files',
    /if \(ver < 4\) mesh\._selectLocked = true;/.test(code),
    'an unconditional re-derive silently overrides an explicit unlock');
  check('and v4 applies the stored value to every row, not just joints',
    /if \(ver >= 4\) \{[\s\S]{0,120}?row\.mesh\._selectLocked = !!\(row\.bone & 8\)/.test(code));
}

// THE REST POSE (v5). The solver evaluates a keyed frame by putting every joint it owns back
// to rest first, so a rest that does not survive the file makes the same frame evaluate
// differently after a reload — the rig adopts whatever pose it happened to be in at the first
// scrub. Round-tripped here rather than asserted from the source, because the writer and the
// reader agreeing is the whole property.
{
  const rest = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0.5,1.25,-2,1]);
  const bone = mk({ _isBone: true, _ikRest: rest });
  const posed = mk({ _isBone: true }); // no rest recorded: must not invent one
  const out = roundTrip([bone, posed]);
  check('the rest pose survives a save and a load', !!(out && out[0]._ikRest),
    'without it a reloaded rig evaluates a keyed frame differently');
  if (out && out[0]._ikRest) {
    let worst = 0;
    for (let k = 0; k < 16; k++) worst = Math.max(worst, Math.abs(out[0]._ikRest[k] - rest[k]));
    check('and comes back to the float, not approximately', worst === 0, 'worst ' + worst);
  }
  check('a joint with no rest recorded does not get one from the file',
    !!(out && !out[1]._ikRest), 'inventing a rest here would enshrine a posed rig');
}

// A v4 file has no rest section at all. Reading one must not walk off the end and corrupt the
// fields around it — the section is appended AFTER the skins precisely so that older files
// simply end where they always did.
{
  const bone = mk({ _isBone: true, _boneRadius: 3 });
  const buf = Skeleton.serialize([bone]);
  const u = new Uint32Array(buf);
  u[1] = 4; // claim v4
  const fresh = [mk({ _id: bone._id })];
  const main = { _skelAll: new Set(), getMeshes: () => fresh, render() {}, _scene: null };
  let threw = null;
  const err = console.error;
  console.error = (...a) => { threw = a.join(' '); };
  Skeleton.deserialize(buf, fresh, main);
  console.error = err;
  check('a v4 file loads without reading the rest section', !threw && fresh[0]._isBone === true,
    threw || 'bone flag ' + fresh[0]._isBone);
  check('and gains no rest pose from it', !fresh[0]._ikRest);
}

// ── BAKED CAPSULES, AND WHAT HIDDEN MEANS AFTER A RELOAD ──────────────────────────────
//
// matt: "i had capsules hidden, saved, reloaded, they were visible, and i couldn't hide them
// again." Two separate gaps behind one report. Nothing in the file said a mesh was a baked
// capsule, so a reloaded one was an ordinary mesh -- WeightCage.cages() found none, the
// Capsules button had nothing to act on, and the parametric capsules came back over the top of
// them. And visibility is not in the SGL format at all, so ANY hidden mesh reloaded visible.
{
  const joint = mk({ _isBone: true, _boneRadius: 1 });
  const cage = mk({ _isWeightCage: true, _parentMesh: joint, isVisible: () => false });
  const plain = mk({ _parentMesh: joint });        // parented, visible, not a cage
  const out = roundTrip([joint, cage, plain]);
  check('a baked capsule comes back as one', !!out && out[1]._isWeightCage === true,
    'otherwise the Capsules button cannot find it and Rebind falls back to the drawn shapes');
  check('...knowing which bone it speaks for',
    !!out && out[1]._cageJointId === joint._id,
    'taken from the parent link, which is the only place it was ever stored');
  check('...and an ordinary parented mesh is NOT mistaken for one',
    !!out && !out[2]._isWeightCage);
  check('a hidden mesh comes back hidden',
    !!out && out[1]._hiddenApplied === true,
    'visibility is not in the SGL format, so this block is the only thing carrying it');
  check('...and a visible one comes back visible',
    !!out && !out[2]._hiddenApplied && !out[0]._hiddenApplied);
  check('the joint it hangs from is still a joint',
    !!out && out[0]._isBone === true,
    'the two new bits share a word with the bone flag and the pin mode');
}

// A JOINT IS NEVER SAVED HIDDEN, however it was found. `visible = false` on a joint skips its
// whole subtree in three -- the capsules and cages parented under it vanish with it, which is
// the fault that took six versions to find. So the hidden bit is refused at BOTH ends.
{
  const joint = mk({ _isBone: true, _boneRadius: 1, isVisible: () => false });
  const cage = mk({ _isWeightCage: true, _parentMesh: joint, isVisible: () => false });
  const out = roundTrip([joint, cage]);
  check('a hidden JOINT does not come back hidden',
    !!out && !out[0]._hiddenApplied,
    'it would take every capsule and cage parented to it out of the scene with it');
  check('...while the capsule under it still does',
    !!out && out[1]._hiddenApplied === true);
}

// ── JOINT VOLUMES SURVIVE A SAVE (SKEL v7) ────────────────────────────────────────────
//
// They lived only in memory, so a rig saved with a pelvis dome and a ribcage egg came back as
// bare capsules — and the cage bake, Make Skin and the mirroring all quietly fell back with it.
// Found while probing matt's own skel02.sxr, which turned out not to contain the volumes he had
// just built.
{
  const joint = mk({ _isBone: true, _boneRadius: 1,
    _jointVolume: 'egg', _jointVolDims: [1, 2, 3], _jointVolRot: [0, 0, 0.3826, 0.9238] });
  const fitted = mk({ _isBone: true, _boneRadius: 1, _jointVolume: 'half' });   // nothing set
  const plain = mk({ _isBone: true, _boneRadius: 1 });
  const out = roundTrip([joint, fitted, plain]);

  check('a volume comes back with its shape', !!out && out[0]._jointVolume === 'egg');
  check('...its dimensions', !!out && !!out[0]._jointVolDims
    && Math.abs(out[0]._jointVolDims[2] - 3) < 1e-6,
    out && out[0]._jointVolDims ? out[0]._jointVolDims.join(',') : 'none');
  check('...and its rotation', !!out && !!out[0]._jointVolRot
    && Math.abs(out[0]._jointVolRot[3] - 0.9238) < 1e-4);
  check('a FITTED volume comes back still fitted', !!out && out[1]._jointVolume === 'half'
    && !out[1]._jointVolDims && !out[1]._jointVolOffset,
    'restoring it as hand-set would freeze it at whatever the skeleton looked like when saved, '
    + 'and it would stop following the rig');
  check('a joint with no volume gains none', !!out && !out[2]._jointVolume);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
