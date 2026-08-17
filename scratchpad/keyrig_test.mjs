// Node harness for transform keying in src/editing/AnimationRegistry.js.
//
// Same stubbed-import trick as the other harnesses. Two things under test: that splitting
// addTransformKey into a reusable insert did not change single-mesh keying, and that a
// rig-wide key writes every joint at one time as one undoable act.
//
// Run: node scratchpad/keyrig_test.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO = '/Users/mattestela/sculptxr';
const SRC = fs.readFileSync(path.join(REPO, 'src/editing/AnimationRegistry.js'), 'utf8');

const body = SRC.split('\n')
  .filter((l) => !/^import\s/.test(l))
  .filter((l) => !/^export default/.test(l))
  .join('\n');

// The registry reaches for `window` and for an app singleton throughout; give it both, with
// a state manager that records what was pushed so undo can be driven from here.
const undoStack = [];
globalThis.window = {
  _animCurrentTime: 0,
  _animMasterDuration: 0,
  app: {
    render() {},
    getMesh: () => null,
    getStateManager: () => ({
      pushStateCustom(undo, redo, squash, label) { undoStack.push({ undo, redo, label }); },
    }),
  },
};

const prelude = `
const quat = { slerp: () => {} };
const mat4 = {};
const arkitEntry = () => null, arkitSplitTargets = () => [], arkitUnifiedFor = () => null;
const Enums = { Action: {} };
const Skinning = { captureSource() {} };
`;

const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '_key_gen.mjs');
fs.writeFileSync(outPath, prelude + '\n' + body + '\nexport default AnimationRegistry;\n');

const { default: AnimationRegistry } = await import(outPath + '?v=' + Date.now());

let failures = 0;
function check(name, ok, detail) {
  if (ok) { console.log('  ok   ' + name); return; }
  failures++;
  console.log('  FAIL ' + name + (detail ? '  ' + detail : ''));
}

// A joint: an id and a local matrix, which is all the key writer reads.
let nextId = 1;
function joint(tx, ty, tz) {
  const m = [1,0,0,0, 0,1,0,0, 0,0,1,0, tx,ty,tz,1];
  const id = nextId++;
  return { getID: () => id, getMatrix: () => m, _isBone: true, _m: m };
}

// --- 1. a single key still behaves as before -------------------------------------
{
  const reg = new AnimationRegistry();
  const m = joint(1, 2, 3);
  reg.addTransformKey(m, 5);
  const tr = reg.tracks.get(m.getID());
  check('single: key written at the right time', tr.times.length === 1 && tr.times[0] === 5);
  check('single: position captured from the matrix',
    tr.positions[0] === 1 && tr.positions[1] === 2 && tr.positions[2] === 3);
  check('single: identity rotation captured', Math.abs(tr.quaternions[3] - 1) < 1e-6);
  check('single: unit scale captured', Math.abs(tr.scales[0] - 1) < 1e-6);
  check('single: one undo entry pushed', undoStack.length === 1);
  undoStack.length = 0;
}

// --- 2. a rig-wide key: every joint, one undo step ---------------------------------
{
  const reg = new AnimationRegistry();
  const joints = [joint(0, 0, 0), joint(0, 1, 0), joint(0, 2, 0)];
  const n = reg.keyTransforms(joints, 0, 'Key Pose');

  check('rig: reports every joint keyed', n === 3);
  check('rig: every joint has a key at 0',
    joints.every((j) => reg.tracks.get(j.getID()).times[0] === 0));
  check('rig: ONE undo entry for the whole pose', undoStack.length === 1,
    'got ' + undoStack.length);
  check('rig: undo entry is labelled', undoStack[0].label === 'Key Pose');

  // Move the rig and key a second pose.
  joints[1]._m[12] = 0.5;
  joints[2]._m[12] = 1.0;
  reg.keyTransforms(joints, 12, 'Key Pose');

  check('rig: second pose keyed on every joint',
    joints.every((j) => reg.tracks.get(j.getID()).times.length === 2));
  check('rig: key times shared across the rig',
    joints.every((j) => {
      const t = reg.tracks.get(j.getID()).times;
      return t[0] === 0 && t[1] === 12;
    }));
  check('rig: the moved joint recorded its new position',
    reg.tracks.get(joints[1].getID()).positions[3] === 0.5,
    'got ' + reg.tracks.get(joints[1].getID()).positions[3]);
  check('rig: a joint that did NOT move is still keyed at both times',
    reg.tracks.get(joints[0].getID()).times.length === 2);

  // Undo the second pose: back to one key each, on every joint.
  undoStack[undoStack.length - 1].undo();
  check('rig: undo removes the whole pose, not one joint',
    joints.every((j) => reg.tracks.get(j.getID()).times.length === 1));
  undoStack[undoStack.length - 1].redo();
  check('rig: redo puts the whole pose back',
    joints.every((j) => reg.tracks.get(j.getID()).times.length === 2));
  undoStack.length = 0;
}

// --- 3. keying twice at the same time overwrites rather than stacking --------------
{
  const reg = new AnimationRegistry();
  const joints = [joint(0, 0, 0), joint(0, 1, 0)];
  reg.keyTransforms(joints, 7, 'Key Pose');
  joints[0]._m[13] = 4;
  reg.keyTransforms(joints, 7, 'Key Pose');

  check('overwrite: still one key per joint',
    joints.every((j) => reg.tracks.get(j.getID()).times.length === 1));
  check('overwrite: the key holds the NEW value',
    reg.tracks.get(joints[0].getID()).positions[1] === 4);
  undoStack.length = 0;
}

// --- 4. keying out of order stays sorted ------------------------------------------
{
  const reg = new AnimationRegistry();
  const joints = [joint(0, 0, 0)];
  reg.keyTransforms(joints, 20, 'Key Pose');
  reg.keyTransforms(joints, 4, 'Key Pose');
  reg.keyTransforms(joints, 11, 'Key Pose');
  const t = reg.tracks.get(joints[0].getID()).times;
  check('order: keys inserted in time order', t.join(',') === '4,11,20', 'got ' + t.join(','));
  undoStack.length = 0;
}

// --- 5. an empty rig is a no-op ----------------------------------------------------
{
  const reg = new AnimationRegistry();
  check('empty: nothing keyed, nothing pushed',
    reg.keyTransforms([], 0, 'Key Pose') === 0 && undoStack.length === 0);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
