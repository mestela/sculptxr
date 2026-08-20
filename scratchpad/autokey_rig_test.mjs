// AutoKey on a rig node.
//
// A bone and a pin are ordinary objects with ordinary transform tracks — the Key Pose button
// has always keyed them through the generic path. What stopped AutoKey doing the same was not
// the registry but the two GATES in front of it, and both were wrong for a different reason:
//
//   1. The gate asked which TOOL was active. Posing under the Bones tool is not Transform and
//      not Grab, so it fell through to the SHAPE-key branch — which is why posing a joint with
//      AutoKey on keyed the skin.
//   2. It keyed the CURRENT SELECTION. The Bones tool selects what it posed through
//      _selectLater, a setTimeout(0) that deliberately leaves the XR frame, while AutoKey runs
//      inside end() in the same frame. So even once the gate passed, the mesh it keyed was
//      whatever had been selected before the drag.
//
// Run: node scratchpad/autokey_rig_test.mjs   (from the repo root)
import fs from 'fs';
import path from 'path';

const REPO = '/Users/mattestela/sculptxr';
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
const strip = (s) => s.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

const SCENE = read('src/Scene.js');
const DESKTOP = read('src/SculptGL.js');
const BONE = read('src/editing/tools/BoneDrawTool.js');
const REG = read('src/editing/AnimationRegistry.js');

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

// Both platforms carry their own AutoKey block. They are the classic pair that drifts, so
// every assertion below is made against BOTH.
const blocks = [['VR (Scene.js)', SCENE], ['desktop (SculptGL.js)', DESKTOP]];

for (const [name, src] of blocks) {
  const i = src.indexOf('window._animAutoKey && window._animationRegistry');
  check(`${name}: the AutoKey block is still there`, i !== -1);
  if (i === -1) continue;
  // Bounded by BRACES, not by a character count. A fixed window silently truncated the block
  // the moment a diagnostic was added to it, and two checks failed on code that was still
  // perfectly correct — a test reporting on its own slice rather than on the source.
  const from = src.slice(i);
  const iMove = from.indexOf('if (isMove)');
  let depth = 0, k = from.indexOf('{', iMove), end = k;
  for (; k < from.length; k++) {
    if (from[k] === '{') depth++;
    else if (from[k] === '}') { depth--; if (depth === 0) { end = k; break; } }
  }
  const B = strip(from.slice(0, end + 1));

  check(`${name}: the gate asks what MOVED, not which tool`,
    /const isMove = !!rigNode \|\|/.test(B),
    'a tool-only gate sends a posed joint to the shape-key branch');
  check(`${name}: a bone and a pin both count as a rig node`,
    /_isBone \|\| m\._isPinTarget/.test(B));
  // ORDER, not just presence. The tool's report is set synchronously when it takes hold; the
  // selection is updated after AutoKey has run and is reliably one gesture stale. Preferring
  // the selection keyed the PREVIOUS node every time — the whole sequence rotated by one.
  check(`${name}: the tool's report is preferred over the selection`,
    /_rigOf\(this\._lastRigEdit\) \|\| _rigOf\(currentMesh\)/.test(B),
    'the selection is stale by one gesture; preferring it keys the previously grabbed node');
  check(`${name}: it falls back to what the rig tool moved`,
    /_lastRigEdit/.test(B),
    'the selection is set on a timeout and is stale by the time AutoKey runs');
  check(`${name}: the fallback is consumed`,
    /_lastRigEdit = null;/.test(B),
    'left set, the next sculpt stroke would key the bone from the last pose');
  check(`${name}: the key is written to the node that moved`,
    /const keyMesh = rigNode \|\| currentMesh;/.test(B) && /keyMesh\.getID\(\)/.test(B),
    'still keying the stale selection');
  // The rig node must never take the shape-key branch: a bone has no vertices to key.
  check(`${name}: a rig node never reaches the shape branch`,
    B.indexOf('const isMove') < B.indexOf('if (isMove)'));
}

// The synchronous half of the fix lives in the tool, next to the deferred selection it exists
// to compensate for — so the two cannot be separated by someone reading only one of them.
{
  const i = BONE.indexOf('_selectLater(joint) {');
  const FN = i === -1 ? '' : BONE.slice(i, BONE.indexOf('\n  }', i));
  // BEFORE the timeout, not merely present in the function: recording it inside the callback
  // would be exactly as late as the selection it exists to compensate for, and the test would
  // still see the line. (It did, the first time this guard was written.)
  const iRec = FN.indexOf('_lastRigEdit = joint');
  const iDefer = FN.indexOf('setTimeout(');
  check('the bones tool records the moved node synchronously',
    iRec !== -1 && iDefer !== -1 && iRec < iDefer,
    'recording it inside the timeout is exactly as late as the selection');
  check('...and still defers the selection itself',
    /setTimeout\(/.test(FN),
    'selecting inside the XR frame re-enters render and cancels the grab');
  // Every mode that moves a rig node goes through it, or that mode silently will not key.
  const calls = (BONE.match(/this\._selectLater\(/g) || []).length;
  check('every rig-moving mode routes through it', calls >= 4, `${calls} call sites`);
}

// EVERY TOOL THAT CAN TAKE A RIG NODE HAS TO SAY SO. AutoKey's `currentMesh` comes from
// _vrSculptMesh — the SCULPTING pick, captured at stroke start, before Grab or Transform have
// run their own rig-aware pick — so on a grabbed bone or pin it is still the skin. The bones
// tool alone recording it was not enough: Grab kept keying the skin.
{
  const sites = [
    ['Grab (desktop)', 'src/editing/tools/Grab.js', 'this._grabbedMesh = mesh;\n    '],
    ['Grab (VR)', 'src/editing/tools/Grab.js', 'this._grabbedMesh = mesh;\n          '],
    ['TransformVR', 'src/editing/tools/TransformVR.js', 'this._dragMesh = mesh;'],
  ];
  for (const [name, file, anchor] of sites) {
    const src = read(file);
    const i = src.indexOf(anchor);
    // Within a few lines of taking hold, so the two cannot drift apart.
    const near = i === -1 ? '' : src.slice(i, i + 700);
    check(`${name} records the rig node it took`, /_lastRigEdit/.test(near),
      'AutoKey will key the sculpting pick instead — the skin');
    check(`${name} clears the marker on a non-rig grab`,
      /_lastRigEdit = \(mesh\._isBone \|\| mesh\._isPinTarget\) \? mesh : null;/.test(near),
      'left set, a bone from an earlier grab is keyed later');
  }
}

// The registry itself was never the problem, and this is what says so: the generic path keys
// any mesh, and playback already knows a keyed bone needs the pins re-solved after it.
check('the registry keys any mesh generically', /_writeTransformKey\(mesh, time\)/.test(REG));
// Bound to the PROPERTY rather than to one spelling of it: the branch used to be a single
// line and is now a block, and a guard pinned to the line reported the addition as the bug.
{
  const i = REG.indexOf('mesh._isBone');
  const near = i === -1 ? '' : REG.slice(i, i + 700);
  check('playback re-solves pins after a keyed bone is written',
    /_ikPinsDirty = true/.test(near),
    'without this a keyed pose interpolates off its pins');
  // The solver treats the joints it was handed as the frame's CONTROLS and puts the ones it
  // owns back to rest, which is what makes an evaluated frame independent of the route to it.
  // Flagging that SOMETHING moved is not enough — it has to say what.
  check('and names the joint it wrote, not just that one moved',
    /_ikWritten[\s\S]{0,80}?\.add\(mesh\.getID\(\)\)/.test(near),
    'unnamed, the solver cannot tell a keyed joint from its own output last frame');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
