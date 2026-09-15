// Node harness for the VR panel-grab intent latch (src/Scene.js).
//
// The gesture that grabs a panel is the one that moves the ray off it: closing a hand swings the
// grip pose, so the laser slides away at the exact instant you commit. Aiming harder cannot fix
// that, and a preselection highlight would not either — it would be correct right up until it
// stopped being. The answer is a short memory of what the ray was on.
//
// And the half that made it painful: a miss fell through to world navigation and spun the scene,
// so every near-miss had to be undone before the next attempt.
//
// Both methods are extracted from the real source rather than restated.
//
// Run: node scratchpad/panelgrab_test.mjs
//   GRAB_INJECT=nolatch     the grab needs a LIVE ray hit, so the fist's own motion loses it
//   GRAB_INJECT=noguard     a missed panel grab falls through and turns the world
//   GRAB_INJECT=fullheadrot  the stash takes the whole head rotation, not just the heading
//   GRAB_INJECT=foreverlatch the latch never expires, so a panel hit minutes ago still wins
import fs from 'fs';

const REPO = '/Users/mattestela/sculptxr';
let SRC = fs.readFileSync(`${REPO}/src/Scene.js`, 'utf8');

const inject = process.env.GRAB_INJECT || '';
const cut = (anchor, replacement = '') => {
  if (!SRC.includes(anchor)) throw new Error(`inject ${inject}: anchor moved -> ${anchor.trim().slice(0, 60)}`);
  SRC = SRC.replace(anchor, replacement);
};
if (inject === 'nolatch') {
  cut(`    const _vtlIntent = this._vtlIsPointing
            || this._panelGrabIntent(source.handedness)?.name === 'VRTimeline';`,
      '    const _vtlIntent = this._vtlIsPointing;');
} else if (inject === 'noguard') {
  cut(`          if (isGrip && window._panelGrabGuard !== false
              && (this._isPointingAtMenu || this._panelGrabIntent(source.handedness))) {
            if (source.handedness === 'left') { leftGrip = false; }
            else                              { rightGrip = false; }
          }`);
} else if (inject === 'fullheadrot') {
  // Take the whole head rotation instead of the heading: re-showing while looking up puts the
  // panel above you and tilted, which is not where you left it by any reading.
  const a = `  fwd.y = 0;`;
  if (!SRC.includes(a)) throw new Error('inject fullheadrot: anchor moved');
  SRC = SRC.replace(a, '');
} else if (inject === 'foreverlatch') {
  cut('    return (performance.now() - l.t) <= grace ? l : null;', '    return l;');
}

// --- extract ------------------------------------------------------------------------------
function grab(sig) {
  const re = new RegExp(`\\n  ${sig} \\{\\n([\\s\\S]*?)\\n  \\}\\n`);
  const m = SRC.match(re);
  if (!m) throw new Error(`${sig} could not be extracted — this harness is testing nothing`);
  return m[1];
}
const panelGrabIntent = new Function(`return function (handedness) {\n${grab('_panelGrabIntent\\(handedness\\)')}\n};`)();

// The world-nav guard is a fragment inside a long loop, so it is lifted verbatim rather than as a
// method — and the lift THROWS if the text moves, so it cannot quietly stop being the real code.
const guardSrc = SRC.match(/if \(isGrip && window\._panelGrabGuard[\s\S]*?\n          \}/);
if (!guardSrc && inject !== 'noguard') throw new Error('the world-nav guard could not be found');
const runGuard = guardSrc
  ? new Function('isGrip', 'source', 'self', `let leftGrip = true, rightGrip = true;
      const _panelGrabIntent = (h) => self._panelGrabIntent(h);
      const thisArg = { _isPointingAtMenu: self._isPointingAtMenu, _panelGrabIntent: _panelGrabIntent };
      ${guardSrc[0].replace(/this\./g, 'thisArg.')}
      return { leftGrip, rightGrip };`)
  : () => ({ leftGrip: true, rightGrip: true });

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' :: ' + detail : ''}`); }
};

globalThis.window = {};
const scene = (latch, pointing = false) => ({
  _panelRayLatch: latch, _isPointingAtMenu: pointing, _panelGrabIntent: panelGrabIntent,
});

console.log('\nthe latch remembers what the ray was on');
{
  const now = performance.now();
  const s = scene({ left: null, right: { name: 'VRTimeline', t: now } });
  check('a hit a moment ago still counts', s._panelGrabIntent('right')?.name === 'VRTimeline');
  check('the other hand is unaffected', s._panelGrabIntent('left') === null);

  const stale = scene({ right: { name: 'VRTimeline', t: now - 5000 } });
  check('a hit five seconds ago does NOT count', stale._panelGrabIntent('right') === null,
    'a latch that never expires means a panel you looked at once owns every later fist');

  const edge = scene({ right: { name: 'VRTimeline', t: now - 100 } });
  check('100ms is inside the window — a fist takes about that long to close',
    edge._panelGrabIntent('right')?.name === 'VRTimeline');

  globalThis.window._panelGrabGraceMs = 50;
  check('the window is tunable in-session', edge._panelGrabIntent('right') === null);
  delete globalThis.window._panelGrabGraceMs;

  check('no latch at all is null', scene({}).  _panelGrabIntent('right') === null);
  check('a latch with no name is null',
    scene({ right: { name: null, t: now } })._panelGrabIntent('right') === null);
}

console.log('\nthe timeline grab accepts the latch, not just a live ray');
{
  // Lifted verbatim from the drag gate, so this cannot drift from the shipped condition.
  const m = SRC.match(/const _vtlIntent = this\._vtlIsPointing[\s\S]*?;\n/);
  if (!m) throw new Error('the _vtlIntent expression could not be found');
  const vtlIntent = new Function('self', 'handedness',
    `const source = { handedness };
     const thisArg = self;
     ${m[0].replace(/this\./g, 'thisArg.')}
     return !!_vtlIntent;`);

  const now = performance.now();
  const live = Object.assign(scene({ right: null }), { _vtlIsPointing: true });
  check('a live ray on the timeline grabs it', vtlIntent(live, 'right') === true);

  // THE CASE THE WHOLE LATCH EXISTS FOR: the fist has already swung the ray off the panel.
  const slid = Object.assign(scene({ right: { name: 'VRTimeline', t: now - 80 } }),
    { _vtlIsPointing: false });
  check('a ray that slid off a moment ago still grabs it', vtlIntent(slid, 'right') === true,
    'without this the gesture destroys its own aim and the grab can never land');

  const other = Object.assign(scene({ right: { name: 'MainMenuPanel', t: now } }),
    { _vtlIsPointing: false });
  check('a latch on a DIFFERENT panel does not grab the timeline',
    vtlIntent(other, 'right') === false, 'otherwise any panel hit steals the timeline drag');

  const cold = Object.assign(scene({ right: { name: 'VRTimeline', t: now - 5000 } }),
    { _vtlIsPointing: false });
  check('a stale latch does not grab it', vtlIntent(cold, 'right') === false);
}

console.log('\na missed panel grab does not turn the world');
{
  const now = performance.now();
  const src = { handedness: 'right' };

  const onPanel = runGuard(true, src, scene({ right: { name: 'MainMenuPanel', t: now } }, true));
  check('pointing at a panel consumes the grip', onPanel.rightGrip === false,
    'otherwise the fist spins the scene and the miss has to be undone');
  check('...and only for that hand', onPanel.leftGrip === true);

  // THE CASE THAT WAS PAINFUL: the ray has already slid off, so nothing is "pointing at a menu"
  // any more, but the fist was plainly meant for the panel.
  const justOff = runGuard(true, src, scene({ right: { name: 'VRTimeline', t: now - 80 } }, false));
  check('a ray that just slid off still consumes the grip', justOff.rightGrip === false,
    'this is the exact miss being complained about');

  const away = runGuard(true, src, scene({ right: { name: 'VRTimeline', t: now - 5000 } }, false));
  check('away from any panel, the world is still grabbable', away.rightGrip === true,
    'the guard must not eat world navigation everywhere');

  const notGripping = runGuard(false, src, scene({ right: { name: 'VRTimeline', t: now } }, true));
  check('an open hand consumes nothing', notGripping.rightGrip === true);

  globalThis.window._panelGrabGuard = false;
  const off = runGuard(true, src, scene({ right: { name: 'VRTimeline', t: now } }, true));
  check('the guard has an in-session off switch', off.rightGrip === true);
  delete globalThis.window._panelGrabGuard;
}

// The wording matters: run_all.mjs tests for "all checks passed" or "tests passed", so a file
// that only says "N passed" is counted as a FAILURE by the suite while reporting green alone.
console.log('\na hidden panel comes back where you left it');
{
  // The round trip is what matters: stash a pose, move the head, restore, and the panel should be
  // in the same place RELATIVE TO THE HEAD rather than the same world spot. matt does not trust
  // headset world tracking, and a world pose restored after two steps puts the panel behind you.
  const THREE = await import(`${REPO}/node_modules/three/build/three.module.js`);
  const mk = (name) => {
    const src = SRC.match(new RegExp(`\\n  ${name} \\{\\n([\\s\\S]*?)\\n  \\}\\n`));
    if (!src) throw new Error(`${name} could not be extracted — this harness is testing nothing`);
    return src[1];
  };
  const api = new Function('THREE', `return {
    _headFrame: function () {${mk('_headFrame\\(\\)')}},
    _stashPanelPose: function (key, mesh) {${mk('_stashPanelPose\\(key, mesh\\)')}},
    _restorePanelPose: function (key, mesh) {${mk('_restorePanelPose\\(key, mesh\\)')}},
  };`)(THREE);

  const head = (x, z, yaw, pitch) => {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch || 0, yaw || 0, 0, 'YXZ'));
    return { _camera: { getThreeCamera: () => ({ position: new THREE.Vector3(x, 1.6, z), quaternion: q }) } };
  };
  const panel = (x, y, z) => ({ position: new THREE.Vector3(x, y, z), quaternion: new THREE.Quaternion() });

  const self = Object.assign(head(0, 0, 0), api);
  const p = panel(0.3, 1.4, -0.6);
  check('stashing succeeds with a camera', self._stashPanelPose('timeline', p) === true);
  check('restoring an unknown key does nothing', self._restorePanelPose('nope', p) === false);

  // Same head pose: the panel must come back exactly where it was.
  const p2 = panel(0, 0, 0);
  self._restorePanelPose('timeline', p2);
  check('an unmoved head puts it back in the same world spot',
    p2.position.distanceTo(new THREE.Vector3(0.3, 1.4, -0.6)) < 1e-6,
    p2.position.toArray().join(','));

  // Turned 90 degrees and stepped aside: it should be in front of the NEW heading, at the same
  // offset — not stranded where the world pose was.
  const turned = Object.assign(head(2, 2, Math.PI / 2), api);
  turned._panelPoseStash = self._panelPoseStash;
  const p3 = panel(0, 0, 0);
  turned._restorePanelPose('timeline', p3);
  check('after turning it follows the heading rather than the world',
    p3.position.distanceTo(new THREE.Vector3(0.3, 1.4, -0.6)) > 0.5,
    p3.position.toArray().join(','));
  check('...and keeps its distance from the head',
    Math.abs(p3.position.distanceTo(new THREE.Vector3(2, 1.6, 2))
      - new THREE.Vector3(0.3, 1.4, -0.6).distanceTo(new THREE.Vector3(0, 1.6, 0))) < 1e-6,
    String(p3.position.distanceTo(new THREE.Vector3(2, 1.6, 2))));

  // YAW ONLY. Looking up and re-showing must not put the panel above you and tilted.
  const lookingUp = Object.assign(head(0, 0, 0, -1.2), api);
  lookingUp._panelPoseStash = self._panelPoseStash;
  const p4 = panel(0, 0, 0);
  lookingUp._restorePanelPose('timeline', p4);
  check('pitch is ignored, so looking up does not lift the panel',
    Math.abs(p4.position.y - 1.4) < 1e-6,
    `${p4.position.y} — taking the full head rotation puts it overhead`);

  check('no camera means no stash and no crash',
    Object.assign({ _camera: null }, api)._stashPanelPose('x', p) === false);
}

console.log(`\n${pass} passed, ${fail} failed${inject ? `  [inject=${inject}]` : ''}`
  + (fail ? '' : '  — all checks passed'));
process.exit(fail ? 1 : 0);
