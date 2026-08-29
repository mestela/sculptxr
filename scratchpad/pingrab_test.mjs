// Node harness for A PIN THAT IS IN SOMEONE'S HAND.
//
// A held pin has two things arguing with it: the solver, which moves whatever the pin is
// parented under, and the visuals, which re-seat a rotation-only pin onto its joint every
// frame. Neither is wrong on its own. Both are wrong while a hand is holding the pin, and the
// old drag maths made the first one PERMANENT — it read the pin's current matrix each frame and
// folded whatever it found into the next baseline.
//
// matt: "if i move them too quickly it will recalculate an offset of the pin vs where my
// controller is" and "nothing should be able to move or rotate the pins but me."
//
// Run: node scratchpad/pingrab_test.mjs   (from the repo root)
//
// Defect injections (standing lesson 1):
//   PG_INJECT=accumulate   the drag goes back to controller*inv(last) applied to the pin's
//                          CURRENT matrix — the drift bug, exactly as it was
//   PG_INJECT=followheld   the rotation-only follow drops its held guard, so the visuals put a
//                          wrist pin back on its joint while it is being dragged
//   PG_INJECT=nosave       the VR thumbstick stops persisting the radius it just set
//   PG_INJECT=grabtiny     Grab gets its own radius default back
import fs from 'fs';
import path from 'path';
import { mat4 } from 'gl-matrix';

const REPO = '/Users/mattestela/sculptxr';
const R = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
let GRAB = R('src/editing/tools/Grab.js');
let SKEL = R('src/editing/Skeleton.js');
let SCENE = R('src/Scene.js');
const inj = process.env.PG_INJECT || '';

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

// ── the drag maths, LIFTED AND RUN ───────────────────────────────────────────
//
// Run rather than read. "Does the pin stay in the hand when something else writes it" is a
// question about arithmetic over four frames, and no amount of looking at three mat4 calls
// answers it — the old code looks perfectly reasonable, and was wrong for a whole session.
const cut = (src, from, to, what) => {
  const a = src.indexOf(from);
  if (a < 0) throw new Error('lift ' + what + ': the anchor moved (' + from.slice(0, 40) + ')');
  const b = src.indexOf(to, a);
  if (b < 0) throw new Error('lift ' + what + ': the end moved');
  return src.slice(a, b + to.length);
};

let capture = cut(GRAB, 'const gm = pin.getModelSpaceMatrix',
  'this._vrPinGrabs.set(hand, { pin, offset });', 'capture');
let drag = cut(GRAB, 'const next = mat4.create(); mat4.multiply(next, controller.matrix, state.offset);',
  'moved = true;', 'drag');

if (inj === 'accumulate') {
  capture = 'this._vrPinGrabs.set(hand, { pin, last: mat4.clone(controller.matrix) });';
  drag = `
      const invLast = mat4.create();
      if (!mat4.invert(invLast, state.last)) return;
      const delta = mat4.create(); mat4.multiply(delta, controller.matrix, invLast);
      const pm = state.pin.getModelSpaceMatrix();
      const next = mat4.create(); mat4.multiply(next, delta, pm);
      state.pin.setModelSpaceMatrix(next);
      mat4.copy(state.last, controller.matrix);
      moved = true;`;
}

const captureFn = new Function('mat4', 'Skeleton', 'pin', 'controller', 'hand', 'self',
  'const _m = new Map(); this._vrPinGrabs = _m;' + capture + '; return _m.get(hand);');
const dragFn = new Function('mat4', 'Skeleton', 'state', 'controller',
  'let moved = false;' + drag + '; return moved;');

const T = (x, y, z) => { const m = mat4.create(); m[12] = x; m[13] = y; m[14] = z; return m; };
const pos = (m) => [m[12], m[13], m[14]];
const near = (a, b, e = 1e-6) => a.every((v, i) => Math.abs(v - b[i]) < e);
const SK = { syncThree() {} };

const makePin = (m) => {
  const cur = mat4.clone(m);
  return { _m: cur,
    getModelSpaceMatrix: () => cur,
    getMatrix: () => cur,
    setModelSpaceMatrix: (n) => mat4.copy(cur, n),
    getID: () => 7 };
};

// The gesture: take a pin 10cm in front of the hand, then move the hand. Nothing else touches
// the pin. Both the old and the new maths get this right — it is the control, not the check.
{
  const pin = makePin(T(0, 0, -0.1));
  const st = captureFn(mat4, SK, pin, { matrix: T(0, 0, 0) }, 'right', {});
  dragFn(mat4, SK, st, { matrix: T(0.3, 0, 0) });
  check('the pin follows the hand', near(pos(pin.getModelSpaceMatrix()), [0.3, 0, -0.1]),
    pos(pin.getModelSpaceMatrix()).join());
}

// THE ONE THAT MATTERS. Something else writes the pin mid-gesture — a solve landing a frame
// late, a parent joint moving under it, the rotation-only follow. The hand has not moved. The
// pin must come straight back to where the hand is holding it.
{
  const pin = makePin(T(0, 0, -0.1));
  const st = captureFn(mat4, SK, pin, { matrix: T(0, 0, 0) }, 'right', {});
  dragFn(mat4, SK, st, { matrix: T(0.3, 0, 0) });
  pin.setModelSpaceMatrix(T(0.35, 0.02, -0.1)); // the interloper
  dragFn(mat4, SK, st, { matrix: T(0.3, 0, 0) }); // same hand pose, next frame
  check('a write by anything else is undone on the next frame',
    near(pos(pin.getModelSpaceMatrix()), [0.3, 0, -0.1]),
    pos(pin.getModelSpaceMatrix()).join()
      + ' — the pin is a rigid child of the hand for the length of the gesture');
}

// And it must not ACCUMULATE. Four frames of movement with a stray write before each one: the
// old maths banked every displacement, so the error grew with the drag rather than cancelling.
{
  const pin = makePin(T(0, 0, -0.1));
  const st = captureFn(mat4, SK, pin, { matrix: T(0, 0, 0) }, 'right', {});
  for (let i = 1; i <= 4; ++i) {
    const p = pin.getModelSpaceMatrix();
    pin.setModelSpaceMatrix(T(p[12] + 0.02, p[13] + 0.02, p[14])); // solver drags it along
    dragFn(mat4, SK, st, { matrix: T(i * 0.1, 0, 0) });
  }
  check('...and four frames of that leave no residue at all',
    near(pos(pin.getModelSpaceMatrix()), [0.4, 0, -0.1]),
    pos(pin.getModelSpaceMatrix()).join()
      + ' — a fast drag is exactly where the solve is furthest behind');
}

// The pin's own matrix is never READ during the drag. This is the structural half of the rule:
// as long as the current matrix is an input, some future writer becomes part of the answer.
{
  check('the next pose comes only from the hand and the captured offset',
    /mat4\.multiply\(next, controller\.matrix, state\.offset\)/.test(drag)
      && !/state\.last/.test(drag),
    'a running baseline is what let someone else’s write become part of the offset');
  check('...and the write is synced, so the next read of the world matrix is current',
    /Skeleton\.syncThree\(state\.pin\)/.test(GRAB),
    'setModelSpaceMatrix stores a LOCAL matrix; unsynced, the three side stays stale');
}

// ── the visuals stop writing a held pin ──────────────────────────────────────
{
  let src = SKEL;
  if (inj === 'followheld') {
    const a = "if (pinMode === 4 && pinObj.setModelSpaceMatrix && !held(pinObj.getID())) {";
    if (!src.includes(a)) throw new Error('inject followheld: anchor moved');
    src = src.replace(a, 'if (pinMode === 4 && pinObj.setModelSpaceMatrix) {');
  }
  check('the rotation-only follow skips a pin that is in a hand',
    /pinMode === 4 && pinObj\.setModelSpaceMatrix && !held\(pinObj\.getID\(\)\)/.test(src),
    'this ran every frame and put a dragged wrist pin straight back on its joint');
  check('...reading the SAME held map the visuals already colour by',
    /const held = \(id\) => !!grabHands\[id\];/.test(src),
    'a second notion of "held" is a second thing to get out of step');
  check('...which Grab publishes on every change of ownership',
    /this\._main\._rigGrabHands = handMap;/.test(GRAB));
}

// ── the radius: one default, and it is remembered ────────────────────────────
{
  const tools = fs.readdirSync(path.join(REPO, 'src/editing/tools'))
    .filter((f) => f.endsWith('.js'));
  const odd = [];
  for (const f of tools) {
    if (f === 'BoneDrawTool.js' || f === 'SculptBase.js') continue; // _radius means other things
    let t = R('src/editing/tools/' + f);
    if (inj === 'grabtiny' && f === 'Grab.js') {
      t = t.replace('    this._grabbedMesh = null;',
        '    this._radius = 0.5;\n    this._grabbedMesh = null;');
    }
    const m = t.match(/this\._radius = ([\d.]+)/);
    if (m && parseFloat(m[1]) !== 50) odd.push(f + '=' + m[1]);
  }
  // SculptVoxel is the one exception and it is a deliberate one: its radius is a percentage of
  // the world, not a brush width, and 20 there was matt's own earlier call.
  check('every tool takes the same radius default',
    odd.length === 1 && odd[0] === 'SculptVoxel.js=20.0',
    odd.join(' ') + ' — Grab’s was 0.5, which is a half-millimetre sphere in VR');
  check('...and that default is 50, stated once in SculptBase',
    /this\._radius = 50\.0;/.test(R('src/editing/tools/SculptBase.js')));

  let sc = SCENE;
  if (inj === 'nosave') {
    const a = 'getOptionsURL.saveOption(\n                  `tool_${this._sculptManager.getToolIndex()}_radius`, newVal, 500);';
    if (!sc.includes(a)) throw new Error('inject nosave: anchor moved');
    sc = sc.replace(a, '');
  }
  const blk = sc.slice(sc.indexOf('tools.setRadius(newVal);') - 900,
    sc.indexOf('tools.setRadius(newVal);') + 700);
  check('the VR thumbstick saves the radius it just set',
    /saveOption\(\s*`tool_\$\{this\._sculptManager\.getToolIndex\(\)\}_radius`, newVal, 500\)/.test(blk),
    'this is how the radius is actually set in VR; unsaved, every session started over');
  // Was BrushPanel, which was deleted 2026-08-28 — the wrist panel is the surviving slider.
  check('...under the same key the panels write',
    /saveOption\(`tool_\$\{idx\}_radius`/.test(R('src/gui/htmlvr/MiniPanel.js')),
    'two keys for one setting is two answers to "how big is the brush"');
  check('...and the same key startup restores from',
    /saved\[`tool_\$\{i\}_radius`\]/.test(R('src/editing/SculptManager.js')));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
