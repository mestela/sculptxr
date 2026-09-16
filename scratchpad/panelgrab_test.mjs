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
//   GRAB_INJECT=controllercard hands are shown the controller card, naming a trigger and a stick
//   GRAB_INJECT=headingfollows the stash is heading-relative, so the panel swings round to face
//                              wherever you turned — the bug matt reported
//   GRAB_INJECT=foreverlatch the latch never expires, so a panel hit minutes ago still wins
import fs from 'fs';

const REPO = new URL('..', import.meta.url).pathname;
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
} else if (inject === 'controllercard') {
  // The shipped behaviour before this: hands are handed the CONTROLLER card, which names a
  // trigger, a grip button and a thumbstick that are not there.
  cut(`      handed(h) ? (isDom ? domHand : nonHand) : (isDom ? dom(face) : non(face));`,
      `      (isDom ? dom(face) : non(face));`);
} else if (inject === 'headingfollows') {
  // The first attempt: rotate the offset into a heading frame and back out, so the panel swings
  // round to face wherever you have turned. Looking at your wrist to re-show it is exactly that.
  const a = `      pos: mesh.position.clone().sub(hp),   // world axes — deliberately NOT rotated into any frame
      quat: mesh.quaternion.clone(),        // the orientation you left it at, unmodified`;
  if (!SRC.includes(a)) throw new Error('inject headingfollows: anchor moved');
  const q = "const _y = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, "
    + "new THREE.Euler().setFromQuaternion(this._camera.getThreeCamera().quaternion, 'YXZ').y, 0, 'YXZ'));";
  SRC = SRC.replace(a, `      pos: (() => { ${q} return mesh.position.clone().sub(hp).applyQuaternion(_y.clone().invert()); })(),
      quat: (() => { ${q} return _y.clone().invert().multiply(mesh.quaternion); })(),`);
  const b = `    mesh.position.copy(hp).add(st.pos);
    mesh.quaternion.copy(st.quat);`;
  if (!SRC.includes(b)) throw new Error('inject headingfollows: restore anchor moved');
  SRC = SRC.replace(b, `    ${q}
    mesh.position.copy(st.pos).applyQuaternion(_y).add(hp);
    mesh.quaternion.copy(_y).multiply(st.quat);`);
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
  // THE SHAPE THAT WAS WRONG FIRST TIME: storing the offset in a heading-aligned frame made the
  // panel swing with the head, and the way you re-show a panel is by looking down at the wrist
  // menu — which turns your head. So it arrived facing wherever you had just turned to.
  //
  // The rule now: anchored to head POSITION, head ROTATION ignored entirely. Stand still and it
  // is a world-space restore; walk, and it comes with you instead of being stranded behind.
  const THREE = await import(`${REPO}/node_modules/three/build/three.module.js`);
  const mk = (name) => {
    const src = SRC.match(new RegExp(`\\n  ${name} \\{\\n([\\s\\S]*?)\\n  \\}\\n`));
    if (!src) throw new Error(`${name} could not be extracted — this harness is testing nothing`);
    return src[1];
  };
  const api = new Function('THREE', `return {
    _headPos: function () {${mk('_headPos\\(\\)')}},
    _stashPanelPose: function (key, mesh) {${mk('_stashPanelPose\\(key, mesh\\)')}},
    _restorePanelPose: function (key, mesh) {${mk('_restorePanelPose\\(key, mesh\\)')}},
  };`)(THREE);

  const head = (x, y, z, yaw, pitch) => ({ _camera: { getThreeCamera: () => ({
    position: new THREE.Vector3(x, y, z),
    quaternion: new THREE.Quaternion().setFromEuler(
      new THREE.Euler(pitch || 0, yaw || 0, 0, 'YXZ')) }) } });
  const panel = (x, y, z) => ({ position: new THREE.Vector3(x, y, z),
    quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.4, 0, 'YXZ')) });

  const WHERE = new THREE.Vector3(0.3, 1.4, -0.6);
  const self = Object.assign(head(0, 1.6, 0, 0), api);
  const left = panel(WHERE.x, WHERE.y, WHERE.z);
  const leftQuat = left.quaternion.clone();
  check('stashing succeeds with a camera', self._stashPanelPose('timeline', left) === true);
  check('restoring an unknown key does nothing', self._restorePanelPose('nope', left) === false);

  const same = panel(0, 0, 0);
  self._restorePanelPose('timeline', same);
  check('an unmoved head puts it back in the same world spot',
    same.position.distanceTo(WHERE) < 1e-6, same.position.toArray().join(','));

  // THE REPORTED BUG. Look down at the wrist menu — which turns the head — and re-show. The
  // panel must NOT follow the heading round to face you.
  const atWrist = Object.assign(head(0, 1.6, 0, 1.1, -0.9), api);
  atWrist._panelPoseStash = self._panelPoseStash;
  const back = panel(0, 0, 0);
  atWrist._restorePanelPose('timeline', back);
  check('turning to look at the wrist does NOT drag the panel round',
    back.position.distanceTo(WHERE) < 1e-6,
    `${back.position.toArray().join(',')} — a heading-relative stash puts it in front of wherever you turned`);
  check('...and its orientation is the one you left it at',
    back.quaternion.angleTo(leftQuat) < 1e-6, String(back.quaternion.angleTo(leftQuat)));

  // Walking DOES carry it, which is the concession to tracking drift.
  const moved = Object.assign(head(2, 1.6, 2, 2.5), api);
  moved._panelPoseStash = self._panelPoseStash;
  const carried = panel(0, 0, 0);
  moved._restorePanelPose('timeline', carried);
  check('walking carries it by the same world offset',
    carried.position.distanceTo(new THREE.Vector3(WHERE.x + 2, WHERE.y, WHERE.z + 2)) < 1e-6,
    carried.position.toArray().join(','));
  check('...still without turning it', carried.quaternion.angleTo(leftQuat) < 1e-6);

  // Height: crouching carries it down with you, and only by how far you actually moved.
  const crouch = Object.assign(head(0, 1.1, 0, 0), api);
  crouch._panelPoseStash = self._panelPoseStash;
  const low = panel(0, 0, 0);
  crouch._restorePanelPose('timeline', low);
  check('height follows head height, one for one',
    Math.abs(low.position.y - (WHERE.y - 0.5)) < 1e-6, String(low.position.y));

  check('no camera means no stash and no crash',
    Object.assign({ _camera: null }, api)._stashPanelPose('x', left) === false);
  check('no camera means no restore either',
    Object.assign({ _camera: null, _panelPoseStash: self._panelPoseStash }, api)
      ._restorePanelPose('timeline', left) === false);
}

console.log('\nthe intro cards describe the input you are actually holding');
{
  // The cards are the first thing shown on entering immersive, and every line of the controller
  // version names something a hand does not have — no trigger, no grip button, no thumbstick. On
  // a hands-only session that is worse than no card at all.
  //
  // Checked structurally against the real source: these are canvas draws, so what can be asserted
  // is which list is chosen, that the hand list mentions no controller parts, and that the choice
  // is per HAND and by DOMINANCE rather than by left/right.
  // SRC is the injected copy, so GRAB_INJECT reaches this section too.
  const S = SRC;
  const defAt = S.indexOf('  _ensureButtonLabels() {');
  if (defAt < 0) throw new Error('_ensureButtonLabels moved — this section tests nothing');
  const block = S.slice(defAt, S.indexOf('\n  }\n', S.indexOf('this._btnLabels = {', defAt)));
  if (!block.includes('domLeft')) throw new Error('the card builder moved — this section tests nothing');

  const hasHandLists = block.includes('const BOTH_FISTS');
  const handLists = hasHandLists
    ? block.slice(block.indexOf('const BOTH_FISTS'), block.indexOf('const domLeft')) : '';
  check('a hands card exists at all', hasHandLists,
    'without one, a hands-only session is shown the controller mapping');
  for (const word of ['Trigger', 'Grip', 'Stick', 'Squeeze']) {
    check(`the hands card never mentions "${word}"`, !handLists.includes(word),
      'a hand has no such control, and the card is the first thing a new user reads');
  }
  for (const word of ['Pinch', 'Fist', 'Both fists']) {
    check(`the hands card names "${word}"`, handLists.includes(word));
  }
  check('Smooth is described as BOTH hands pinching, which is what the code requires',
    /Both pinch/.test(handLists) && /Smooth/.test(handLists), handLists.slice(0, 200));
  check('...and no ring finger is invented', !/ring/i.test(handLists),
    'there is no ring-finger gesture in this app; the only hand gestures are pinch and fist');

  check('hands are actually GIVEN that card',
    /handed\(h\) \? \(isDom \? domHand : nonHand\)/.test(block),
    'the lists can exist and still never be selected');
  check('the choice is made PER HAND, not once for the session',
    /forHand\('left'[\s\S]{0,120}?forHand\('right'/.test(block),
    'one hand can hold a controller while the other is bare');
  check('...and by dominance, so left-handed mode still reads correctly',
    /const domLeft = this\._dominantHand === 'left'/.test(block)
      && /forHand\('left', domLeft/.test(block));
  check('the cards rebuild when the input kind changes',
    /_btnLabelSig !== _sig/.test(block),
    'put the controllers down mid-session and the card must stop describing a trigger');
  check('the signature includes both hands and the dominant hand',
    /_handInput\?\.left[\s\S]{0,120}?_handInput\?\.right[\s\S]{0,80}?_dominantHand/.test(block));

  // The flag it reads has to be written somewhere that sees the source.
  check('_handInput is recorded where the source is in hand',
    /this\._handInput\[src\.handedness\] = !!src\.hand;/.test(S));
}

console.log(`\n${pass} passed, ${fail} failed${inject ? `  [inject=${inject}]` : ''}`
  + (fail ? '' : '  — all checks passed'));
process.exit(fail ? 1 : 0);
