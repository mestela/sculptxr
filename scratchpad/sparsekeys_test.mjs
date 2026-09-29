// Node harness for SPARSE TRANSFORM KEYS (xfChannel keyMask + the registry edit paths).
//
// matt: "sparse keys are how animators think, and this enforcing of glb style lockstep keys is
// stupid." Transform slots used to hold all nine channels; now each slot carries a 9-bit mask
// and a channel's curve passes only through its own keyed slots. What is pinned here:
//   - keying writes only the groups that changed (per-group keying), or the recorded ones
//   - a channel evaluates through ITS keys only; other slots hold its DERIVED value
//   - deleting a graph key removes that channel's key only; an empty slot disappears
//   - a time drag splits the dragged channel out of a shared slot, and a slot landing on
//     another's time merges into it
//   - Simplify works per channel, and leaves channels it was not asked about alone
//   - snapshot undo carries the mask
//
// Run: node scratchpad/sparsekeys_test.mjs
//
// Defect injections:
//   SK_INJECT=evalall     the evaluator walks every slot, not just the channel's keyed ones
//   SK_INJECT=keyall      per-group keying keys all nine channels every time (lockstep again)
//   SK_INJECT=delslot     deleting one channel's key deletes the whole slot
//   SK_INJECT=nodetach    a time drag moves the whole slot
//   SK_INJECT=nomerge     slots on the same time are not merged
//   SK_INJECT=snapmask    the undo snapshot drops the mask
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO = new URL('..', import.meta.url).pathname;
let REG = fs.readFileSync(path.join(REPO, 'src/editing/AnimationRegistry.js'), 'utf8');
let XFC = fs.readFileSync(path.join(REPO, 'src/editing/xfChannel.js'), 'utf8');

{
  const i = process.env.SK_INJECT || '';
  const cut = (src, a, b) => { if (!src.includes(a)) throw new Error(`inject ${i}: anchor moved`); return src.replace(a, b); };
  if (i === 'evalall') XFC = cut(XFC, 'const m = maskSync(tr), b = xfBit(group, c), out = [];\n  for (let i = 0; i < m.length; i++) if (m[i] & b) out.push(i);',
    'const m = maskSync(tr), out = [];\n  for (let i = 0; i < m.length; i++) out.push(i);');
  else if (i === 'keyall') REG = cut(REG, 'else bits = this._changedGroupBits(track, time,', 'else bits = XF_ALL || this._changedGroupBits(track, time,');
  else if (i === 'delslot') REG = cut(REG, "          else m[k.index] &= ~xfBit(k.group || 'pos', k.channel);\n        }\n        whole.forEach",
    "          else m[k.index] = 0;\n        }\n        whole.forEach");
  else if (i === 'nodetach') REG = cut(REG, 'if (!split.length) return;', 'return;');
  else if (i === 'nomerge') REG = cut(REG, '    this._mergeCoincidentSlots(track);\n', '');
  else if (i === 'snapmask') REG = cut(REG, "keyMask:          track.keyMask          ? track.keyMask.slice()                            : null,", 'keyMask: null,');
}

const strip = (src) => src.split('\n').filter((l) => !/^import\s/.test(l)).filter((l) => !/^export default/.test(l)).join('\n');
const undoStack = [];
globalThis.window = {
  _animCurrentTime: 0, _animMasterDuration: 0,
  app: { render() {}, getMesh: () => null, _meshes: [],
    getStateManager: () => ({ pushStateCustom(undo, redo, sq, label) { undoStack.push({ undo, redo, label }); } }) },
};
const prelude = `
import * as THREE from '${path.join(REPO, 'node_modules/three/build/three.module.js')}';
import { decimateKeys } from '${path.join(REPO, 'src/editing/curveSimplify.js')}';
${strip(XFC).replace(/^export /gm, '')}
const quat = { slerp: () => {} };
const mat4 = {};
const arkitEntry = () => null, arkitSplitTargets = () => [], arkitUnifiedFor = () => null;
const Enums = { Action: {} };
const Skinning = { captureSource() {} };
const Skeleton = {};
const PhysicsBones = {};
const getOptionsURL = () => ({});
export { maskSync, xfEval, xfBit, xfGroupBits, XF_ALL, xfKeyedSlots, rotSync };
`;
const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '_sparse_gen.mjs');
fs.writeFileSync(outPath, prelude + '\n' + strip(REG) + '\nexport default AnimationRegistry;\n');
const M = await import(outPath + '?v=' + Date.now());
const AnimationRegistry = M.default;
const { maskSync, xfEval, xfBit, xfGroupBits, XF_ALL } = M;

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

// A mesh whose matrix we set by hand: translation + a Y rotation in degrees + uniform scale.
let nextId = 1;
function mesh() {
  const id = nextId++;
  const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  return { getID: () => id, getMatrix: () => m,
    set(tx, ty, tz, ry = 0, s = 1) {
      const c = Math.cos(ry * Math.PI / 180) * s, sn = Math.sin(ry * Math.PI / 180) * s;
      m.splice(0, 16, c, 0, -sn, 0, 0, s, 0, 0, sn, 0, c, 0, tx, ty, tz, 1);
    } };
}
const POS = xfGroupBits('pos'), ROT = xfGroupBits('rot'), SCL = xfGroupBits('scale');

// ── per-group keying ───────────────────────────────────────────────────────────
{
  const reg = new AnimationRegistry();
  const m = mesh();
  m.set(0, 0, 0); reg.addTransformKey(m, 0);
  m.set(0, 0, 0); reg.addTransformKey(m, 2);
  const tr = reg.tracks.get(m.getID());
  check('the first key of a track keys everything', maskSync(tr)[0] === XF_ALL);
  m.set(5, 0, 0); reg.addTransformKey(m, 1);        // moved only
  check('moving the object keys TRANSLATE only', maskSync(tr)[1] === POS, maskSync(tr)[1].toString(2));
  m.set(5, 0, 0, 30); reg.addTransformKey(m, 1);    // now rotated at the same frame
  check('...and rotating it there adds ROTATE to the same slot', maskSync(tr)[1] === (POS | ROT));
  // Scale was never keyed at t=1, so its curve (1 -> 1) is untouched and the slot's scale value
  // is derived.
  check('an unkeyed group\'s value in that slot is derived from its curve', near(tr.scales[3], 1));
  m.set(5, 0, 0, 30); reg.addTransformKey(m, 1);    // pressed again, nothing changed
  check('keying an unchanged pose pins every group', maskSync(tr)[1] === XF_ALL);
}

// ── evaluation through each channel's own keys ─────────────────────────────────
{
  const reg = new AnimationRegistry();
  const tr = reg._ensureTransformTrack(99);
  // TX keyed at 0 and 2 only (0 -> 10); TY keyed at 0, 1, 2 with a bump at 1.
  const P = [0, 0, 0], Q = [0, 0, 0, 1], S = [1, 1, 1];
  reg._putKey(tr, 0, [0, 0, 0], Q, S, XF_ALL);
  reg._putKey(tr, 2, [10, 0, 0], Q, S, XF_ALL);
  reg._putKey(tr, 1, [999, 7, 0], Q, S, xfBit('pos', 1));
  check('a slot keyed on TY only does not bend TX', near(xfEval(tr, 'pos', 0, 1), 5, 1e-3),
    `TX(1) = ${xfEval(tr, 'pos', 0, 1)}`);
  check('...and its TX value is re-derived from the TX curve, not left at 999', near(tr.positions[3], 5, 1e-3));
  check('TY passes through its own key', near(xfEval(tr, 'pos', 1, 1), 7));
}

// ── delete one channel's key ───────────────────────────────────────────────────
{
  const reg = new AnimationRegistry();
  const tr = reg._ensureTransformTrack(7);
  reg.tracks.set(7, tr);
  for (let i = 0; i < 3; i++) reg._putKey(tr, i, [i, i * 2, 0], [0, 0, 0, 1], [1, 1, 1], XF_ALL);
  undoStack.length = 0;
  reg.deleteSelectedKeys([{ meshId: 7, type: 'transform', index: 1, channel: 0, group: 'pos' }]);
  check('deleting TX at a slot keeps the slot', tr.times.length === 3);
  check('...with every other channel still keyed there', maskSync(tr)[1] === (XF_ALL & ~xfBit('pos', 0)));
  undoStack.at(-1).undo();
  check('undo brings the TX key back', maskSync(reg.tracks.get(7))[1] === XF_ALL);
  undoStack.at(-1).redo();
  const m = maskSync(reg.tracks.get(7));
  m[1] = xfBit('pos', 1);
  reg.deleteSelectedKeys([{ meshId: 7, type: 'transform', index: 1, channel: 1, group: 'pos' }]);
  check('deleting the last channel keyed in a slot removes the slot', reg.tracks.get(7).times.length === 2);
}

// ── time drag: detach, then merge ──────────────────────────────────────────────
{
  const reg = new AnimationRegistry();
  const tr = reg._ensureTransformTrack(11);
  for (let i = 0; i < 3; i++) reg._putKey(tr, i, [i, 0, 0], [0, 0, 0, 1], [1, 1, 1], XF_ALL);
  const sel = [{ meshId: 11, type: 'transform', index: 1, channel: 0, group: 'pos' }];
  reg.detachChannelKeys([sel]);
  check('dragging TX splits it out of the shared slot', tr.times.length === 4 && maskSync(tr)[sel[0].index] === xfBit('pos', 0),
    `slots ${tr.times.length}, mask ${maskSync(tr)[sel[0].index]}`);
  check('...and the slot it left keeps everything else', maskSync(tr)[1] === (XF_ALL & ~xfBit('pos', 0)));
  tr.times[sel[0].index] = 1.5;               // the drag
  reg.sortTrack(tr);
  check('TX moved alone: TY still has its key at 1', maskSync(tr)[tr.times.indexOf(1)] & xfBit('pos', 1));
  const j = tr.times.indexOf(1.5);
  check('...and TX has its key at 1.5', j >= 0 && maskSync(tr)[j] === xfBit('pos', 0));
  tr.times[j] = 2;                            // drag it onto the key at 2
  reg.sortTrack(tr);
  check('a slot dropped on another\'s time merges into it', tr.times.filter((t) => t === 2).length === 1
    && tr.times.length === 3, tr.times.join(','));
}

// ── per-channel simplify ───────────────────────────────────────────────────────
{
  const reg = new AnimationRegistry();
  const tr = reg._ensureTransformTrack(21);
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
  for (let i = 0; i < 60; i++) {
    const t = i / 24, a = rnd() * 0.02;       // ~0.6 degree rotation jitter
    reg._putKey(tr, t, [t * 3, Math.sin(t * 4), 0], [0, Math.sin(a / 2), 0, Math.cos(a / 2)], [1, 1, 1], XF_ALL);
  }
  const rotKeysBefore = M.xfKeyedSlots(tr, 'rot', 1).length;
  const r = reg.simplifyTransformTrack(tr, { mode: 'tolerance', tolerance: 0.02, judge: { pos: [true, true, true] } });
  check('a straight TX comes down to its two ends', M.xfKeyedSlots(tr, 'pos', 0).length === 2,
    `${M.xfKeyedSlots(tr, 'pos', 0).length} keys`);
  check('...while the curving TY keeps what it needs', M.xfKeyedSlots(tr, 'pos', 1).length > 4
    && M.xfKeyedSlots(tr, 'pos', 1).length < 30);
  check('channels not on screen are untouched', M.xfKeyedSlots(tr, 'rot', 1).length === rotKeysBefore);
  check('the report counts channel keys', r.keysAfter < r.keysBefore);
}

// ── undo snapshots carry the mask ──────────────────────────────────────────────
{
  const reg = new AnimationRegistry();
  const tr = reg._ensureTransformTrack(31);
  reg._putKey(tr, 0, [0, 0, 0], [0, 0, 0, 1], [1, 1, 1], XF_ALL);
  reg._putKey(tr, 1, [1, 0, 0], [0, 0, 0, 1], [1, 1, 1], POS);
  const snap = reg._snapshotTrack(tr);
  maskSync(tr)[1] = XF_ALL;
  reg._restoreTrack(tr, snap, null);
  check('restoring a snapshot restores which channels were keyed', maskSync(tr)[1] === POS);
}

console.log(failures ? `\n${failures} FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
