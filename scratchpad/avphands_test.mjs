// Node harness for HAND INPUT ON APPLE VISION PRO — the gripSpace gate, the empty gamepad,
// and the palm-up menu gesture.
//
// matt could enter immersive on the AVP, see the scene animate, and do NOTHING. Three separate
// faults, each of which alone was enough to produce exactly that symptom:
//
//   1. `if (!source.gripSpace) continue;` — visionOS hands carry 25 joints with real poses but
//      NO gripSpace at all, so every hand was skipped at the top of the loop and the
//      hand-tracking branch never executed once. Measured: gripSpace=false, rayPose=YES.
//   2. An AVP hand reports `gamepad` TRUTHY with `buttons.length === 0`. Every `if (src.gamepad)`
//      guard in the file sailed past it and then read undefined out of it. The last one standing
//      was the trigger read that feeds canSculpt, so pinch was detected at every stage and no
//      stroke ever opened (latch/mock/pad 10 edges each, sculpting 0% of frames).
//   3. The pinch test measured JOINT CENTRES. Touching fingertips stay ~the sum of their radii
//      apart (0.020 on AVP), so `pinchDist < 0.02` sat exactly on the touch point. Subtracting
//      the radii turns it into a skin-to-skin gap that means the same thing on every runtime.
//
// And the menu: hands have no X/A button, so button 4 was hardcoded false and the menu was
// unreachable. It is now synthesised from a palm-up posture, which reuses the existing tap/hold
// handler rather than adding a second menu path.
//
// Run: node scratchpad/avphands_test.mjs   (from the repo root)
//
// Defect injections (standing lesson 1):
//   AVP_INJECT=gripgate    the hard gripSpace gate returns, so AVP hands are skipped entirely
//   AVP_INJECT=emptypad    _padOf accepts a buttons-less pad again, so a hand reads as a
//                          controller that is present and permanently unpressed
//   AVP_INJECT=rawtrigger  the canSculpt trigger reads source.gamepad.buttons directly again —
//                          the fault that let pinch work everywhere except starting a stroke
//   AVP_INJECT=centres     the pinch test goes back to joint centres, ignoring tip radii
//   AVP_INJECT=deadmenu    the wrist panel is never primed, so a hands-only runtime opens with
//                          no menu and no way to ask for one
//   AVP_INJECT=nogrippose  three's unposed grip is left at the origin again, so every wrist
//                          panel sits in the middle of the world instead of on the hand
//   AVP_INJECT=griplate    the grip is posed after the UI mount reads it, putting the panels one
//                          frame behind a hand-carried target
//   AVP_INJECT=gripraw     the -90 first guess comes back, standing the panel out of the palm
//                          instead of lying it flat across the back of the hand
//   AVP_INJECT=gripnofix   the rotation multiply is deleted entirely, so the knob silently stops
//                          doing anything and no tuning can ever take effect
//   AVP_INJECT=gripdorsal  the yaw is dropped, putting the panel back on the BACK of the hand,
//                          which is geometrically fine and ergonomically wrong
//   AVP_INJECT=gripunsigned the handedness sign is dropped, so one hand gets the thumb face and
//                          the other gets the pinky face
//   AVP_INJECT=gripcentred the lateral offset is dropped, so the panel is turned to face the
//                          index side but still straddles the middle of the hand
//   AVP_INJECT=placeslot   the fixed lift/yaw is re-imposed every frame during placement, so the
//                          panel snaps back and cannot be moved at all
//   AVP_INJECT=placeclicks presses are no longer swallowed while placing, so the pinch that
//                          carries the panel also clicks everything it crosses
//   AVP_INJECT=placegrip   the drag reads the grip instead of the wrist joint, feeding the
//                          offset being calibrated back into its own measurement
//   AVP_INJECT=placedefault placement mode is on by default again, so every button is dead for
//                          anyone who simply puts the headset on
//   AVP_INJECT=unbaked     the measured placement is never applied, so the panel goes back to
//                          the controller slot and the measurement was for nothing
//   AVP_INJECT=rayhigh     the hand-ray pitch goes back to zero, restoring the 30-degree-high
//                          visionOS index-finger aim
//   AVP_INJECT=rayfinger   the ray origin stays at the targetRay pose instead of the pinch point
//   AVP_INJECT=raysplit    sculpting goes back to the raw uncorrected pose, so the brush and the
//                          menus aim differently and the drawn spike matches neither
//   AVP_INJECT=pinchchurn  a transient pinch source counts as a controller arriving again, so a
//                          full input recovery runs several times a second mid-click
//   AVP_INJECT=noedgelog   trigger edges that miss every panel stop being logged, so a pinch
//                          that never reached a panel is invisible
//   AVP_INJECT=suppress    the legacy 25cm wrist suppression applies in HTML panel mode again,
//                          killing every pinch made near the wrist panel — the root cause
//   AVP_INJECT=nosyspinch  the platform's own pinch stops counting as a press, leaving only our
//                          reimplementation of it
//   AVP_INJECT=stuckpinch  the system pinch is never released, latching the trigger down
//   AVP_INJECT=rawcursor  the brush cursor goes back to the raw targetRaySpace pose, putting
//                          the radius sphere at the index knuckle instead of the spike tip
//   AVP_INJECT=swapover   the swap button overlaps the tool button again, where the reverse
//                          DOM-order hit walk hands every press to the tool button
//   AVP_INJECT=nosysheal  a dropped selectend can latch the trigger down for the session again
//   AVP_INJECT=handsalways the hands-only controls show on every device, including ones with a
//                          button for them already
//   AVP_INJECT=undoflow   the main-menu undo row goes back into normal flow, where it draws over
//                          the menubar at the top of the panel
//   AVP_INJECT=gainrot    the grab gain is applied to rotation too, so hand and world disagree
//                          about which way is up
//   AVP_INJECT=onepitch   both hands share one pitch again, assuming a symmetry nobody measured
//   AVP_INJECT=copyspike  the left spike stops being mirrored and becomes a copy of the right
//   AVP_INJECT=rawpinch   the pinch latch comes back, so the release needs a deliberate gesture
//   AVP_INJECT=loosepinch the pinch threshold goes back to a loose literal in the loop, so it
//                          fires on a hand passing through and cannot be tuned in-headset
//   AVP_INJECT=classtie   the hands-only hide rule loses its id qualifier and ties with .mm-row,
//                          showing hands-only controls to controller users
//   AVP_INJECT=negmanager the Neg toggle goes back to writing sculptManager._negative, a property
//                          nothing defines or reads, so the button lights up and does nothing
//   AVP_INJECT=noframelog the ray-frame handedness is never reported, leaving the sign-versus-
//                          magnitude question unanswerable without another headset session
//   AVP_INJECT=dotsfrozen  a lost joint leaves its dot at the last known position, reporting
//                          tracking that is not happening
//   AVP_INJECT=dotsown     the dots recompute their own pinch test instead of reading the latch,
//                          so the indicator can agree with itself while the trigger disagrees
//   AVP_INJECT=reticleunder the ray's hit dot goes back under the panels, invisible exactly when
//                          it matters
//   AVP_INJECT=stiffpanel  the wrist panel smoothing is removed, restoring the drift
//   AVP_INJECT=lateinit    the press-owner init drops back below its first reader, so frame 1
//                          throws, never initialises, and the panel dispatch is dead for ever
//   AVP_INJECT=gazeshared  the gaze ray shares the right hand's press latch again, so one pinch
//                          arrives as two sources fighting over one press owner
//   AVP_INJECT=gazebehind  the menu button loses its renderOrder and sorts behind the panels it
//                          opens, which makes it unreachable exactly when you need it
//   AVP_INJECT=stalemock   _padOf stops checking src.hand, so a cached mock answers for a real
//                          controller after you put the hands down
import fs from 'fs';
import path from 'path';

const REPO = '/Users/mattestela/sculptxr';
let SRC = fs.readFileSync(path.join(REPO, 'src/Scene.js'), 'utf8');
let MP    = fs.readFileSync(path.join(REPO, 'src/gui/htmlvr/MiniPanel.js'), 'utf8');
const OPT = fs.readFileSync(path.join(REPO, 'src/misc/getOptionsURL.js'), 'utf8');
let MM    = fs.readFileSync(path.join(REPO, 'src/gui/htmlvr/MainMenuPanel.js'), 'utf8');

{
  const inj = process.env.AVP_INJECT || '';
  const sub = (a, b, why) => {
    if (!SRC.includes(a)) throw new Error('inject ' + inj + ': anchor moved (' + why + ')');
    SRC = SRC.replace(a, b);
  };
  if (inj === 'gripgate') {
    sub('      const gripSpace = source.gripSpace\n', '      const gripSpace = source.gripSpace;\n      if (!source.gripSpace) continue;\n      const _dead = source.gripSpace\n', 'gate');
  } else if (inj === 'emptypad') {
    sub('return (pad && pad.buttons && pad.buttons.length) ? pad : null;', 'return pad || null;', 'padOf');
  } else if (inj === 'rawtrigger') {
    sub('    const buttons = this._padOf(source)?.buttons || [];', '    const buttons = source.gamepad.buttons;', 'trigger');
  } else if (inj === 'centres') {
    sub('const pinchGap = pinchDist - rT - rI;', 'const pinchGap = pinchDist;', 'gap');
  } else if (inj === 'deadmenu') {
    sub('if (!this._handsUiPrimed && this._handsOnlyMode()) {', 'if (false) {', 'panel priming');
  } else if (inj === 'nogrippose') {
    sub('      if (_s.hand && !_s.gripSpace) this._poseGripFromWrist(_s, frame, refSpace);', '', 'grip pose call');
  } else if (inj === 'griplate') {
    // Move the call to AFTER the mount has READ the grip — still called every frame, just one
    // frame too late. Inserting it merely before `let uiGrip` would still be before the read,
    // which is why the first version of this injection never bit.
    sub('      if (_s.hand && !_s.gripSpace) this._poseGripFromWrist(_s, frame, refSpace);', '');
    sub('            uiAnchor.matrix.copy(uiGrip.matrixWorld);',
        '            uiAnchor.matrix.copy(uiGrip.matrixWorld);\n            for (const _s of sources) { if (_s.hand && !_s.gripSpace) this._poseGripFromWrist(_s, frame, refSpace); }', 'mount read');
  } else if (inj === 'gripraw') {
    sub('const pitch = window._wristGripPitch ?? 0;', 'const pitch = window._wristGripPitch ?? -90;', 'pitch');
  } else if (inj === 'gripnofix') {
    sub('      grip.matrix.multiply(this._wristGripFix);', '', 'rotation multiply');
  } else if (inj === 'gripdorsal') {
    sub("    const yaw = (window._wristGripYaw ?? 90) * (source.handedness === 'left' ? 1 : -1);",
        '    const yaw = 0;', 'yaw');
  } else if (inj === 'pinchchurn') {
    sub("      const real = [...(event.added || [])].filter(s => s.targetRayMode !== 'transient-pointer');\n      if (real.length) this._recoverXRTransientInput('controller restore');",
        "      if (event.added?.length) this._recoverXRTransientInput('controller restore');", 'recovery filter');
  } else if (inj === 'suppress') {
    sub('          if (_legacyMiniHud && source.handedness === this._dominantHand && this._nonDomWristMatrix) {',
        '          if (source.handedness === this._dominantHand && this._nonDomWristMatrix) {', 'suppression gate');
  } else if (inj === 'nosyspinch') {
    sub("          isPinching = true;\n        }\n\n        mockGamepad = {", '\n        }\n\n        mockGamepad = {', 'system pinch');
  } else if (inj === 'nosysheal') {
    sub('    if (!_anyTransient) this._sysPinchActive = false;', '', 'pinch self-heal');
  } else if (inj === 'loosepinch') {
    sub('          const P_ON    = this.getPinchOn();           // skin-to-skin gap, metres',
        '          const P_ON    = 0.005;', 'pinch accessor');
  } else if (inj === 'classtie') {
    const a = '#mm-root .mm-hands-only { display: none; }';
    if (!MM.includes(a)) throw new Error('inject classtie: anchor moved (hands-only hide)');
    MM = MM.replace(a, '.mm-hands-only { display: none; }');
  } else if (inj === 'rawpinch') {
    sub('          isPinching = pinchGap < P_ON;',
        '          isPinching = latch.pinch ? (pinchGap < 0.018) : (pinchGap < 0.004);', 'raw pinch');
  } else if (inj === 'negmanager') {
    const a = "        if (t && '_negative' in t) { t._negative = v; main.render?.(); }";
    if (!MP.includes(a)) throw new Error('inject negmanager: anchor moved (neg setter)');
    MP = MP.replace(a, "        if (t) { main.getSculptManager()._negative = v; main.render?.(); }");
  } else if (inj === 'copyspike') {
    sub("    const _mirror = (source.handedness === 'left' && window._handRayMirror !== false) ? -1 : 1;",
        '    const _mirror = 1;', 'mirror sign');
  } else if (inj === 'onepitch') {
    sub("    const _perHand = source.handedness === 'left' ? window._handRayPitchL : window._handRayPitchR;", '', 'per-hand pitch');
  } else if (inj === 'noframelog') {
    sub('    this._reportRayFrame(source, frame, refSpace, ctrl);', '', 'frame report');
  } else if (inj === 'undoflow') {
    const a = '#mm-undo-row {\n  position: absolute;\n  left: 0; right: 0; bottom: 0;';
    if (!MM.includes(a)) throw new Error('inject undoflow: anchor moved (undo row position)');
    MM = MM.replace(a, '#mm-undo-row {\n  position: static;');
  } else if (inj === 'gainrot') {
    sub('          this.rotateWorld(qDelta, origin); // Pivot around HAND (origin)',
        '          this.rotateWorld(qDelta, origin, gGain); // Pivot around HAND (origin)', 'rotate gain');
  } else if (inj === 'handsalways') {
    const a = '#mp-root.hands-only .mp-hands-only { display: flex; }';
    if (!MP.includes(a)) throw new Error('inject handsalways: anchor moved (hands css)');
    MP = MP.replace('.mp-hands-only { display: none; }', '.mp-hands-only { display: flex; }');
  } else if (inj === 'swapover') {
    // MiniPanel is read into MP, so patch that copy.
    const a = '#mp-tool-btn {\n  flex: 1;';
    if (!MP.includes(a)) throw new Error('inject swapover: anchor moved (tool flex)');
    MP = MP.replace(a, '#mp-tool-btn {\n  width: 100%;');
  } else if (inj === 'rawcursor') {
    sub('            const m = this._rayMatrixFor(source, frame, refSpace);\n            if (!m) continue;',
        '            const _p = frame.getPose(source.targetRaySpace, refSpace);\n            if (!_p) continue;\n            const m = _p.transform.matrix;', 'cursor ray');
  } else if (inj === 'stuckpinch') {
    sub("    session.addEventListener('selectend', _sysUp);", '', 'pinch release');
  } else if (inj === 'noedgelog') {
    // Remove the log itself. (Removing the _mtPrev assignment instead would make it log every
    // frame — spam, not silence — so it would not be the defect this injection claims.)
    sub("              console.log('[menu] TRIGGER ' + _hand + (_pressed ? ' DOWN' : ' UP  ')", "              console.log(('' + _hand", 'edge log');
  } else if (inj === 'dotsfrozen') {
    sub('      if (!pose) { m.visible = false; continue; }', '      if (!pose) { continue; }', 'dot hide');
  } else if (inj === 'reticleunder') {
    sub('      this._bpReticle.renderOrder = VR_PANEL_RENDER_ORDER + 2;',
        '      this._bpReticle.renderOrder = 1001;', 'reticle order');
  } else if (inj === 'dotsown') {
    sub('    const pinching = !!this._pinchLatch?.[key]?.pinch;',
        '    const pinching = !!(tp && ip && Math.hypot(tp.transform.position.x - ip.transform.position.x, 0, 0) < 0.02);', 'dot colour source');
  } else if (inj === 'lateinit') {
    // Move the initialiser back below the aim-assist block that reads it.
    // Move the initialiser back below its first reader, where the first frame throws before
    // ever reaching it and every frame after throws in the same place.
    sub('          if (!this._vrPressOwner) this._vrPressOwner = { L: null, R: null, G: null };\n', '');
    // AFTER its first reader, not merely adjacent to it: placing it one line earlier is still
    // correct code, so an injection that does that models nothing.
    sub('          if (!_pressed) this._vrPressOwner[_hand] = null;',
        '          if (!_pressed) this._vrPressOwner[_hand] = null;\n          if (!this._vrPressOwner) this._vrPressOwner = { L: null, R: null, G: null };', 'init');
  } else if (inj === 'stiffpanel') {
    sub('            const ks = window._wristSmooth ?? 0.12;', '            const ks = 1;', 'panel smoothing');
  } else if (inj === 'rayhigh') {
    sub('    const deg = Number.isFinite(_perHand)\n      ? _perHand\n      : (window._handRayPitch ?? -45) * _mirror;',
        '    const deg = 0;', 'ray pitch');
  } else if (inj === 'rayfinger') {
    sub('      this._hrV.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);', '', 'pinch origin');
  } else if (inj === 'raysplit') {
    sub('        this._hrPm.fromArray(_m).decompose(this._hrPv, this._hrPq, this._hrPs);', '', 'sculpt aim');
  } else if (inj === 'placedefault') {
    sub('_wristPlaceActive() { return window._wristPlace === true; }',
        '_wristPlaceActive() { return window._wristPlace !== false; }', 'placement default');
  } else if (inj === 'unbaked') {
    sub('                } else if (_handsSlot) {', '                } else if (false) {', 'baked slot');
  } else if (inj === 'placeslot') {
    sub('                if (_placing) {', '                if (false) {', 'placement branch');
  } else if (inj === 'placeclicks') {
    sub('          const _pressed = (_trigger && !this._wristPlaceActive())',
        '          const _pressed = (_trigger)', 'press gate');
  } else if (inj === 'placegrip') {
    sub("    const wj = domSrc.hand.get('wrist');", "    const wj = domSrc.hand.get('index-finger-metacarpal');", 'drag source');
  } else if (inj === 'gripcentred') {
    sub('const outDist = window._wristGripOut ?? 0.045;', 'const outDist = 0;', 'lateral offset');
  } else if (inj === 'gripunsigned') {
    sub("(window._wristGripYaw ?? 90) * (source.handedness === 'left' ? 1 : -1)",
        '(window._wristGripYaw ?? 90)', 'yaw sign');
  } else if (inj === 'gazeshared') {
    sub("          const _hand = source.targetRayMode === 'transient-pointer'\n            ? 'G'\n            : (source.handedness === 'left' ? 'L' : 'R');",
        "          const _hand = source.handedness === 'left' ? 'L' : 'R';", 'gaze press key');
  } else if (inj === 'gazebehind') {
    sub('    mesh.renderOrder = VR_PANEL_RENDER_ORDER + 3;', '', 'render order');
  } else if (inj === 'stalemock') {
    sub('const mock = src.hand && this._mockGamepads && this._mockGamepads[src.handedness];', 'const mock = this._mockGamepads && this._mockGamepads[src.handedness];', 'expiry');
  }
}

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

// ── 1. the gate that skipped every AVP hand ──────────────────────────────────
{
  check('no hard gripSpace gate survives in the input loop',
    !/if \(!source\.gripSpace\) continue;/.test(SRC),
    'visionOS hands have 25 tracked joints and no gripSpace; skipping them skips everything');
  check('...a missing gripSpace falls back to the wrist joint',
    /const gripSpace = source\.gripSpace\s*\n\s*\|\| \(source\.hand && source\.hand\.get\('wrist'\)\)/.test(SRC),
    'XRJointSpace is an XRSpace, and the wrist is where a grip pose belongs');
  check('...and only gives up when there is no space at all',
    /if \(!gripSpace\) continue;/.test(SRC));
  check('...with the substitution flagged for anything mounted on that pose',
    /_gripSpaceIsWrist(Left|Right)/.test(SRC),
    'joint spaces and grip spaces do not share an orientation convention');
}

// ── 2. the truthy-but-empty gamepad ──────────────────────────────────────────
{
  check('one helper answers "what buttons does this source have"',
    /_padOf\(src\) \{/.test(SRC),
    'the same bug appeared at nine sites because nine sites asked independently');
  check('...and an empty buttons array counts as NO gamepad',
    /return \(pad && pad\.buttons && pad\.buttons\.length\) \? pad : null;/.test(SRC),
    'truthy-with-no-buttons is what slipped past every if (src.gamepad) guard');
  check('...and a cached mock can never answer for a controller',
    /const mock = src\.hand && this\._mockGamepads/.test(SRC),
    'put the hands down, pick the controllers up, and a frozen pinch would answer forever');

  check('the canSculpt trigger reads through the helper',
    /const buttons = this\._padOf\(source\)\?\.buttons \|\| \[\];/.test(SRC),
    'this one site is the whole difference between "pinch detected" and "stroke started"');
  check('no direct gamepad.buttons reads remain in the input path',
    !/(source|src)\.gamepad\.buttons\[/.test(SRC.replace(/^\s*\/\/.*$/gm, '')),
    'a single missed site reproduces the entire bug and costs a headset session');
}

// ── 3. pinch measured skin-to-skin, not centre-to-centre ─────────────────────
{
  check('the pinch test subtracts the fingertip radii',
    /const pinchGap = pinchDist - rT - rI;/.test(SRC),
    'touching tips read ~0.020 apart on AVP, which is exactly where the old constant sat');
  check('...and the radii come from the joint poses, not a constant',
    /const rT = \(thumbTip\.radius \|\| 0\), rI = \(indexTip\.radius \|\| 0\);/.test(SRC),
    'hard-coding Apple’s radius just moves the per-device tuning somewhere less visible');
  // RAW. Detecting the pinch was never the problem — the 25cm wrist suppression was. Hysteresis
  // was added while that was still undiagnosed and bought nothing but a release you had to mean.
  check('the pinch is a single threshold with no latch',
    /isPinching = pinchGap < P_ON;/.test(SRC) && !/_pinchEnter|_pinchExit/.test(SRC),
    'a press that cannot be released is worse than one that cannot be made');
  check('...read through one accessor rather than a literal',
    /const P_ON    = this\.getPinchOn\(\);/.test(SRC) && /getPinchOn\(\) \{/.test(SRC),
    'a constant in the loop cannot be tuned from inside a headset');
  check('...defaulting to CONTACT, after 5mm still misclicked',
    /return Number\.isFinite\(o\) \? o : 0\.0;/.test(SRC),
    'a hand passing casually through a 5mm gap should not fire a click');
  check('...with Number.isFinite, so a deliberate 0 is not treated as unset',
    /if \(Number\.isFinite\(window\._pinchOn\)\) return window\._pinchOn;/.test(SRC),
    'a truthiness test would silently ignore the default value itself');
  check('...exposed as a hands-only settings slider, in millimetres',
    /<span class="mm-lbl">Pinch distance<\/span>/.test(MM)
      && /<div class="mm-row mm-hands-only">/.test(MM),
    'a controller has a physical trigger and no pinch to calibrate');
  check('...over a range that spans the measured populations',
    /options\.pinchOn = queryNumber\(getVal\('pinchOn'\), -0\.010, 0\.015, 0\.0\);/.test(OPT),
    'measured: a deliberate pinch reaches about -0.017, a relaxed hand about +0.040');
  check('...and persisted',
    /opts\.saveOption\('pinchOn', f, 500\);/.test(MM));

  // A bare class rule ties with .mm-row/.mp-row on specificity, so source order decides whether
  // it hides at all — and it did not, showing the control on the one device it is meant to skip.
  check('the hands-only rules outrank the row rules they compete with',
    /#mm-root \.mm-hands-only \{ display: none; \}/.test(MM)
      && /#mp-root \.mp-hands-only \{ display: none; \}/.test(MP),
    'equal specificity means source order decides, which is not a decision anyone made');
  check('...while the FIST keeps its hysteresis, being a hold rather than a click',
    /latch\.fist = latch\.fist \? \(fistDist < F_EXIT\) : \(fistDist < F_ENTER\);/.test(SRC),
    'a chattering grip drops the world mid-drag');
  check('...and the dots still report the live pinch',
    /latch\.pinch = isPinching;/.test(SRC),
    'the indicator must follow the same value the trigger uses');
  // selectend can be missed; the source's ABSENCE cannot be, because it is a state not an event.
  check('a stuck system pinch self-heals from the source list',
    /if \(!_anyTransient\) this\._sysPinchActive = false;/.test(SRC),
    'one dropped selectend would latch the trigger down for the rest of the session');
}

// ── 4. the menu, on a runtime that owns every gesture worth binding ──────────
//
// Palm-up was built, shipped to the device, and LOST: visionOS claims that posture for its Home
// View. The index pinch is the system select and the crown is recenter. A gaze/point button was
// then built and also lost, for a different reason — matt had to turn his pinching hand a long
// way to aim at it and it took several goes to click. The answer that stuck is his: put the
// wrist panel on the hand from the start, exactly as it already sits on the controller.
{
  check('no hand gesture is bound to the menu button',
    !/isPalmUp/.test(SRC),
    'every posture worth binding on visionOS is already owned by the system');

  // Three poses the grip ONLY from gripSpace, which visionOS hands do not have — so every
  // wrist-mounted panel hung off an object still sitting at the world origin.
  check('the grip is posed from the wrist joint when three cannot pose it',
    /_poseGripFromWrist\(source, frame, refSpace\) \{/.test(SRC),
    'fixing our own gripSpace reads did nothing for three\u2019s, because three never saw it');
  check('...and it is actually called',
    /this\._poseGripFromWrist\(_s, frame, refSpace\);/.test(SRC),
    'a defined-but-uncalled poser leaves the panels at the origin, looking exactly like before');
  check('...BEFORE the UI mount reads the grip, not in the per-source loop',
    SRC.indexOf('this._poseGripFromWrist(_s, frame, refSpace);')
      < SRC.indexOf('uiAnchor.matrix.copy(uiGrip.matrixWorld);'),
    'the mount runs first, so posing later hands the panels last frame\u2019s wrist');
  // MEASURED ON DEVICE, not assumed: a -90 first guess put the panel growing out of the PALM
  // with its base across the base of the fingers, which pins +Y_wrist as distal and +Z_wrist as
  // dorsal — i.e. the wrist joint frame is already the one we want, and the correction is zero.
  check('...with the measured wrist-to-panel rotation, which is zero',
    /_wristGripPitch \?\? 0;/.test(SRC),
    'the panel must lie flat across the back of the hand, not stand out of the palm');
  check('...and the knob survives, so the next runtime can be dialled in from inside a session',
    /grip\.matrix\.multiply\(this\._wristGripFix\);/.test(SRC),
    '"no rotation is needed" and "nobody thought about rotation" must stay distinguishable');

  // WHICH FACE OF THE HAND is a separate question from which way the frame points, and it has
  // an ergonomic answer rather than a geometric one: hands angle outward, so a panel on the
  // back of the hand has to be squared up by twisting the forearm. The radial face — the flat
  // made by index and thumb with the fist resting pinky-side down — needs no twist.
  check('the panel is yawed onto the thumb-side face',
    /makeRotationY\(yaw \* Math\.PI \/ 180\)/.test(SRC),
    'with +Y distal and +Z dorsal, the radial face is a yaw about the wrist, not a pitch');
  check('...signed by handedness, because both hands share one joint frame',
    /source\.handedness === 'left' \? 1 : -1/.test(SRC),
    'WebXR does not mirror the frames, so the anatomical direction of +X flips between hands');
  check('...and tunable live like every other wrist offset',
    /window\._wristGripYaw \?\? 90/.test(SRC));

  // Turning it is not the same as moving it: yaw alone spins the panel about the wrist axis and
  // leaves it straddling the middle of the hand, which is exactly what came back from device.
  check('the panel is pushed onto the side of the hand, not just turned to face it',
    /this\._wristGripOutM\.makeTranslation\(0, 0, outDist\);/.test(SRC),
    'a yaw with no offset spins it in place — "as if it was pinned in the center"');
  // Present-but-zero is the same panel in the same wrong place, so assert the VALUE, not just
  // that a translation is written somewhere.
  {
    const d = /_wristGripOut \?\? ([\d.]+)/.exec(SRC);
    check('...by a distance that actually clears the hand',
      !!d && parseFloat(d[1]) >= 0.02,
      'a zero offset leaves it straddling the middle of the hand while looking correct in code');
  }
  check('...along the face it looks out of, so the sign flip stays coherent',
    /makeTranslation\(0, 0, outDist\)/.test(SRC)
      && SRC.indexOf('makeTranslation(0, 0, outDist)') > SRC.indexOf('makeRotationY(yaw'),
    'offsetting on a fixed axis would strand it off one side while facing the other');
  check('...and the grip made visible, since three left it hidden',
    /grip\.visible = true;/.test(SRC));

  check('the wrist panel is shown by default when nothing has buttons',
    /if \(!this\._handsUiPrimed && this\._handsOnlyMode\(\)\)/.test(SRC),
    'a panel that must be summoned by a press is unreachable when there is no press to make');
  check('...once per session, not every frame',
    /this\._handsUiPrimed = true;/.test(SRC),
    're-showing it every frame would fight the user the moment they closed it');
  check('...and only when hands are present AND nothing carries buttons',
    /return anyHand && !anyButtons;/.test(SRC),
    'forcing it on for a controller user takes away a choice they already have');

  check('the gaze button still draws above the panels it opens',
    /mesh\.renderOrder = VR_PANEL_RENDER_ORDER \+ 3;/.test(SRC),
    'everything here is transparent, so layering is manual — a button behind its own menu is unreachable');
  check('the gaze button is opt-in after testing badly',
    /_gazeMenuWanted\(\) \{ return window\._gazeMenu === true; \}/.test(SRC),
    'a target you must acquire is worse than a panel already on your wrist');

  // The gaze ray and the right hand are the SAME pinch on Vision Pro, arriving as two sources.
  check('the gaze ray gets its own press state',
    /source\.targetRayMode === 'transient-pointer'\s*\n\s*\? 'G'/.test(SRC),
    'sharing a latch with the right hand makes one pinch look like a press captured elsewhere');
  check('...in both the Schmitt latch and the press owner',
    /_vrTrigHeld = \{ L: false, R: false, G: false \};/.test(SRC)
      && /_vrPressOwner = \{ L: null, R: null, G: null \};/.test(SRC));
}

// ── 4b. placement mode: stop describing the transform and grab it ────────────
//
// Three rounds of deriving the wrist transform from a verbal description got the rotation right
// and the position wrong, at one headset session each. A description of a pose is a lossy
// encoding of the pose; grabbing it is not.
{
  check('the wrist panel can be grabbed and placed by hand',
    /_updateWristPlacement\(frame, refSpace\) \{/.test(SRC)
      && /this\._updateWristPlacement\(frame, refSpace\);/.test(SRC),
    'defining the tool without calling it leaves the same guessing game');
  check('...driven by the DOMINANT hand, since the panel is on the other wrist',
    /const dom = this\._dominantHand \|\| 'right';/.test(SRC));
  check('...read from the wrist JOINT, not the grip it is calibrating',
    /const wj = domSrc\.hand\.get\('wrist'\);/.test(SRC),
    'driving the drag with the grip feeds the correction being measured back into itself');
  check('...in the anchor frame, so both hands stay free to move',
    /copy\(anchor\.matrixWorld\)\.invert\(\)\.multiply\(this\._wpHandM\)/.test(SRC),
    'absolute poses would drag the panel whenever the WEARING hand moved');
  // Bind the code to its CONDITION: the decompose sitting in an `if (false)` reads identically
  // to the working version, and the panel would snap back to the slot every frame.
  check('...with the fixed slot suspended while placing',
    /if \(_placing\) \{[\s\S]{0,400}?this\._wristPlaceOffset\.decompose\(_p\.mesh\.position, _p\.mesh\.quaternion, _p\.mesh\.scale\);/.test(SRC),
    're-imposing the lift and yaw every frame would fight the hand that is placing it');
  check('...and the flag that gates it is the placement flag',
    /const _placing = this\._wristPlaceActive\(\) && this\._wristPlaceOffset;/.test(SRC));
  check('...and the result printed in numbers that can be baked in',
    /window\._wristPlaceResult = out;/.test(SRC),
    'a placement you cannot read back has to be redone in the headset every time');

  // A pinch that carries the panel would otherwise also click whatever it is dragged across.
  check('every press is swallowed while placing',
    /const _pressed = \(_trigger && !this\._wristPlaceActive\(\)\)/.test(SRC),
    'matt asked for the buttons off precisely because the same pinch does both jobs');

  // ...which is exactly why placement must never be the state a user lands in.
  check('placement mode is opt-in, not a default',
    /_wristPlaceActive\(\) \{ return window\._wristPlace === true; \}/.test(SRC),
    'a mode that disables every button cannot be on by default');

  // The measurement is the deliverable: a placement nobody baked in has to be redone.
  check('the measured placement is baked in as the hands-only default',
    /static get HAND_WRIST_PANEL\(\)/.test(SRC)
      && /\{ p: \[0\.0001, -0\.0017, 0\.0253\], r: \[22\.9, -2\.8, -81\.4\] \}/.test(SRC),
    'measured on device 2026-09-13 — three derivations from a description failed first');
  // The grab got the plane right and the facing backwards; the half turn about the panel's own
  // X is folded INTO the constant, so there is no composition order to get wrong at use.
  check('...with the facing flip folded in, not layered on',
    /as grabbed: rotXYZ\(-157\.1,  2\.8,  81\.4\)/.test(SRC),
    'a correction applied somewhere else is a second number that can drift from the first');
  check('...applied on a hands-only runtime',
    /\} else if \(_handsSlot\) \{[\s\S]{0,300}?_p\.mesh\.rotation\.set\(_hp\.r\[0\] \* _D/.test(SRC),
    'baking a number nothing reads is the same as not having measured it');
  check('...and only there, leaving the controller slot alone',
    /const _handsSlot = !_placing && this\._handsOnlyMode\(\);/.test(SRC),
    'the shared slot was tuned against a controller, which fixes the wrist angle for you');
  check('...with placement mode seeded from it, so re-measuring starts where this left off',
    /this\._wristPlaceOffset = new THREE\.Matrix4\(\)\.compose\(/.test(SRC),
    'starting a re-measure from zero throws away the placement already paid for');
}

// ── 4c. the hand ray aims where you think you are aiming ─────────────────────
//
// visionOS runs a tracked hand's targetRaySpace along the INDEX FINGER. Measured on device that
// is ~30 degrees above where you believe you are pointing, and matt named the fix precisely:
// key the aim off where index and thumb MEET, because the pinch is the click.
{
  check('the hand ray is corrected',
    /_applyHandRayCorrection\(source, frame, refSpace\) \{/.test(SRC)
      && /this\._applyHandRayCorrection\(_s, frame, refSpace\);/.test(SRC),
    'defining the correction without calling it leaves the ray 30 degrees high');
  check('...at the three.js controller object, so the drawn ray cannot diverge from the cast one',
    /ctrl\.matrix\.compose\(this\._hrV, this\._hrQ, this\._hrS\);[\s\S]{0,200}?ctrl\.updateMatrixWorld\(true\);/.test(SRC),
    'the visual spike is a child of that object; correcting each use separately would drift');
  check('...with the origin at the pinch point, not the fingertip',
    /this\._hrV\.set\(\(a\.x \+ b\.x\) \/ 2, \(a\.y \+ b\.y\) \/ 2, \(a\.z \+ b\.z\) \/ 2\);/.test(SRC),
    'aiming from anywhere but the click point means you press what you were not looking at');
  check('...pitched about the ray\u2019s own x, not a world axis',
    /this\._hrFix\.setFromAxisAngle\(\{ x: 1, y: 0, z: 0 \}, deg \* Math\.PI \/ 180\);/.test(SRC),
    'a world-space tilt changes meaning as you turn your wrist over');
  {
    // -30 estimated, -35 after use, -45 measured as correct. A measurement, so pin it.
    const d = /_handRayPitch \?\? (-?[\d.]+)/.exec(SRC);
    check('...by the measured amount, downward',
      !!d && parseFloat(d[1]) === -45,
      'measured on device 2026-09-13; a zero default is the uncorrected visionOS ray');
  }
  // The same signed pitch on both hands produced a left spike that was a COPY of the right
  // rather than its mirror: the pitch rotates about the ray frame's own X, and WebXR gives both
  // hands the SAME frame convention, so the anatomical meaning of +X flips and one sign tilts
  // both the same way in space. The same anatomical tilt needs opposite signs.
  check('the pitch is mirrored for the left hand',
    /const _mirror = \(source\.handedness === 'left' && window\._handRayMirror !== false\) \? -1 : 1;/.test(SRC),
    'one signed pitch copies the right spike onto the left instead of mirroring it');
  check('...applied to the shared default only, so an override stays literal',
    /\(window\._handRayPitch \?\? -45\) \* _mirror;/.test(SRC),
    'a signed override would mean the opposite of what was typed for one hand');
  check('each hand can override the shared pitch',
    /const _perHand = source\.handedness === 'left' \? window\._handRayPitchL : window\._handRayPitchR;/.test(SRC),
    'one number for both hands assumes a symmetry that has not been measured');
  check('...falling back to the shared default, so nothing changes until it is set',
    /Number\.isFinite\(_perHand\)\s*\n?\s*\? _perHand\s*\n?\s*: \(window\._handRayPitch \?\? -45\) \* _mirror;/.test(SRC));
  check('...and the frames are measured rather than assumed',
    /_reportRayFrame\(source, frame, refSpace, ctrl\) \{/.test(SRC)
      && /this\._reportRayFrame\(source, frame, refSpace, ctrl\);/.test(SRC),
    'mirrored-or-not decides between a sign flip and a magnitude change');
  check('...once per hand, not every frame',
    /if \(this\._rayFrameSeen\[key\] \|\| window\._rayFrameReport === false\) return;/.test(SRC));
  // Sculpting reads the RAW pose from targetRaySpace, on a different code path entirely.
  check('sculpting aims where the menus aim',
    /if \(source\.hand\) \{[\s\S]{0,400}?this\._hrPm\.fromArray\(_m\)\.decompose\(this\._hrPv, this\._hrPq, this\._hrPs\);/.test(SRC),
    'two aims in one session is worse than one wrong aim, and the spike would match neither');
}

// ── 4d. making it usable: the drift, the churn, and the pinch that moves the hand ──
//
// The click chain traced perfectly — hits, winner, trigger down, press owner set — and matt
// still could not hit a button. Nothing was broken; the whole thing was just too precise a task
// for an unbraced hand aiming at a target held by the OTHER unbraced hand.
{
  // A pinch adds and removes a transient-pointer source. Treating that as a controller arriving
  // ran a full recovery several times a second, clearing hover and forcing a redraw mid-click.
  check('a transient pinch source does not trigger input recovery',
    /filter\(s => s\.targetRayMode !== 'transient-pointer'\);[\s\S]{0,120}?if \(real\.length\) this\._recoverXRTransientInput/.test(SRC),
    'recovery is for a controller that genuinely came back, not for every pinch');

  check('the ray is smoothed',
    /const k = window\._handRaySmooth \?\? 0\.35;/.test(SRC),
    'optical hand tracking jitters and nothing damps a hand in mid-air');
  check('the panel is smoothed HARDER than the ray',
    (() => {
      const ray = /_handRaySmooth \?\? ([\d.]+)/.exec(SRC);
      const wrist = /_wristSmooth \?\? ([\d.]+)/.exec(SRC);
      return !!ray && !!wrist && parseFloat(wrist[1]) < parseFloat(ray[1]);
    })(),
    'lag on the target reads as steadiness; lag on the pointer in your hand reads as broken');
  check('...and only on hands, leaving the controller feel alone',
    /if \(this\._handsOnlyMode\(\)\) \{[\s\S]{0,400}?const ks = window\._wristSmooth/.test(SRC),
    'a controller braces the wrist; its feel is not up for renegotiation');
  check('...without the brush inheriting the panel smoothing',
    !/_wristSmooth/.test(SRC.slice(SRC.indexOf('_applyHandRayCorrection'), SRC.indexOf('_applyHandRayCorrection') + 2500)),
    'a heavily damped sculpting ray would feel like drawing through treacle');

  // Closing thumb to index rotates the hand: the gesture IS the motion.
  check('...the down-edge only, so drags still track live',
    /else if \(justUp\) v\.panel\.onVRRelease\(_winner\.hit\.uv\);/.test(SRC),
    'correcting move and release too would make a slider lag behind the finger');
  // A LAZY INIT BELOW ITS FIRST READER IS A SESSION-LONG OUTAGE, NOT A FIRST-FRAME GLITCH.
  //
  // The aim-assist block read this._vrPressOwner[_hand] before the `if (!this._vrPressOwner)`
  // line that creates it. Frame 1 threw on the deref, so the initialiser was never reached, so
  // frame 2 threw in the same place, for the life of the session. The entire panel dispatch was
  // dead and it presented as "100% not getting any of my clicks".
  check('the press owner is initialised before anything reads it',
    SRC.indexOf('if (!this._vrPressOwner) this._vrPressOwner = { L: null, R: null, G: null };')
      < SRC.indexOf('if (!_pressed) this._vrPressOwner[_hand] = null;'),
    'an initialiser the thrower never reaches cannot recover on the next frame');
  check('...and it is initialised exactly once, not re-created per branch',
    (SRC.match(/this\._vrPressOwner = \{ L: null, R: null, G: null \};/g) || []).length === 1,
    'two initialisers drift, and the second one silently resets a live press');

  // THE ROOT CAUSE OF "CLICKS NEVER REGISTER", found in matt's own trace: no TRIGGER edge in a
  // whole session of pinches, while the fingertip dots went green throughout. The dots read the
  // raw latch; a legacy suppression zeroed the value AFTER it.
  check('the legacy wrist suppression only applies in legacy canvas mode',
    /const _legacyMiniHud = this\._legacyVrCanvasEnabled\(\) && this\._guiMini && this\._guiMini\._isVisible;/.test(SRC)
      && /if \(_legacyMiniHud && source\.handedness === this\._dominantHand/.test(SRC),
    'it killed the pinch within 25cm of the wrist — exactly where the wrist panel is clicked');
  check('...and never stays latched on outside it',
    /if \(!_legacyMiniHud\) this\._isMiniHUDActive = false;/.test(SRC),
    'a flag set only inside a branch that no longer runs can never be cleared');

  // visionOS transient-pointer exists to say "the user is clicking now" — Apple's own detector,
  // on their tracking, needing no hand-tracking permission. Ours is a reimplementation of it.
  check('the platform\u2019s own pinch is accepted as a press',
    /if \(e\.inputSource\?\.targetRayMode === 'transient-pointer'\) this\._sysPinchActive = true;/.test(SRC),
    'the runtime already detects the pinch and is better at it than our thresholds');
  check('...released on BOTH selectend and select',
    /session\.addEventListener\('selectend', _sysUp\);[\s\S]{0,80}?session\.addEventListener\('select', _sysUp\);/.test(SRC),
    'a missed release latches the trigger down for the rest of the session');
  check('...OR\u2019d into our detection, not replacing it',
    /if \(window\._sysPinch !== false && this\._sysPinchActive[\s\S]{0,120}?isPinching = true;/.test(SRC),
    'Quest hands have no transient-pointer, and sculpting still needs the joint measurement');

  // NO CLICK ASSISTS. Both were written to paper over a pinch that was being suppressed near
  // the wrist; with the real cause fixed they are guesses about intent standing between the user
  // and the button, and a click that lands somewhere you did not point is worse than a miss.
  check('the press goes to the live ray, with no lookback',
    /if \(justDown\)    v\.panel\.onVRPress\(_winner\.hit\.uv\);/.test(SRC),
    'clicking where the ray WAS means clicking something the user is no longer pointing at');
  check('...and no assist machinery survives to be re-enabled by accident',
    !/_pressUv|_uvOnButton|_uvHist|_aimStickyMs|_clickLagMs|_aimBtnMs/.test(SRC),
    'a disabled assist is a live one behind a flag nobody remembers setting');

  // The per-panel edge line only prints inside the winner branch, so presses made off-panel
  // left no trace: "I pinched ten times and one worked" looked like "I pinched once".
  check('every trigger edge is logged, not only the ones that reach a panel',
    /'\[menu\] TRIGGER ' \+ _hand/.test(SRC),
    'without it, pinches that miss entirely are invisible and the counts cannot be compared');

  // "Is it even seeing my hand" has to be answerable without a console.
  check('the fingertips are drawn',
    /_updateHandDots\(source, tp, ip\)/.test(SRC) && /_updateHandDots\(source, tp, ip\) \{/.test(SRC),
    'joint loss and a missed pinch are indistinguishable from inside the headset');
  check('...coloured from the SAME latch the trigger reads',
    /const pinching = !!this\._pinchLatch\?\.\[key\]\?\.pinch;/.test(SRC),
    'an indicator that recomputes the test confirms itself instead of the real signal');
  check('...drawn above the panels, or a dot inside a menu is invisible',
    /m\.renderOrder = VR_PANEL_RENDER_ORDER \+ 1;/.test(SRC));

  // The ray's intersection dot sat at 1001 against panels at 11000 — painted over by the one
  // surface whose intersection you most need to see.
  check('the ray reticle draws above the panels',
    /this\._bpReticle\.renderOrder = VR_PANEL_RENDER_ORDER \+ 2;/.test(SRC),
    'a hit indicator hidden by the thing it is indicating a hit on is worse than none');
  check('...and every overlay order is taken from the panel constant, not guessed',
    !/renderOrder = 1000[01];/.test(SRC) && !/_bpReticle\.renderOrder = 1001;/.test(SRC),
    'a number chosen in isolation drifts the moment the panel constant moves');
  check('...and a lost joint HIDES its dot rather than freezing it',
    /if \(!pose\) \{ m\.visible = false; continue; \}/.test(SRC),
    'a dot frozen at the last known position reports tracking that is not happening');

  // The trace named the panel and stopped there — a press between two buttons looked identical
  // to no press at all.
  check('the trace reports the press decision where it is made',
    /' justDown=' \+ justDown \+ ' justUp=' \+ justUp/.test(SRC)
      && /' blocked=' \+ _blocked/.test(SRC),
    'a press that never became a down-edge, one blocked by another owner, and one that landed '
    + 'between two buttons all look like nothing happening');

}

// ── 4e. one aim, and a way back to the main menu ─────────────────────────────
{
  // Three places asked "where is this source aiming" separately. Two were corrected when the
  // fault was found in them; the brush cursor was not, so the radius sphere sat at the base of
  // the index finger while the spike it belongs on pointed elsewhere.
  check('one accessor answers where a source is aiming',
    /_rayMatrixFor\(source, frame, refSpace\) \{/.test(SRC),
    'a fourth caller reading targetRaySpace directly repeats the same bug');
  check('...used by the brush cursor',
    /const m = this\._rayMatrixFor\(source, frame, refSpace\);/.test(SRC),
    'the cursor read the RAW visionOS ray: 45 degrees high, origin at the index knuckle');
  check('...and by sculpting, rather than its own copy',
    /const _m = this\._rayMatrixFor\(source, frame, refSpace\);/.test(SRC));
  check('...and no raw targetRaySpace pose survives in the cursor path',
    !/const pose = frame\.getPose\(source\.targetRaySpace, refSpace\);\s*\n\s*if \(!pose\) continue;\s*\n\s*\n\s*const m = pose\.transform\.matrix;/.test(SRC),
    'reading it directly is exactly what put the cursor on the wrong part of the hand');

  // With no X/A button there is nothing to summon the main menu with.
  check('the wrist panel carries a swap to the main menu',
    /<button id="mp-swap-btn"/.test(MP) && /mp-show-main-menu/.test(MP),
    'a hands-only runtime has no button to open the main panel with');
  check('...and the main menu carries one back',
    /<button class="mm-pin-btn mm-hands-only" id="mm-mini-btn"/.test(MM) && /mm-show-mini/.test(MM),
    'a one-way swap strands you in the panel you swapped to');
  check('...both announced as events, not direct Scene calls',
    /dispatchEvent\(new CustomEvent\('mp-show-main-menu'/.test(MP)
      && /dispatchEvent\(new CustomEvent\('mm-show-mini'/.test(MM),
    'the panel says what happened; Scene decides what it means — same as the tool picker');
  check('...and Scene listens for both',
    /addEventListener\('mp-show-main-menu'/.test(SRC) && /addEventListener\('mm-show-mini'/.test(SRC),
    'a dispatched event nobody hears is a button that does nothing');
  // _uvToElement walks children in REVERSE DOM ORDER and takes the first geometric match; it
  // never consults z-index. So a floating corner button loses every press to whatever full-width
  // control is later in the markup, however it is drawn. Reordering would hide that rather than
  // remove it, leaving two overlapping targets.
  check('the swap button does not overlap the tool button',
    /\.mp-toprow \{[\s\S]{0,120}?display: flex;/.test(MP)
      && /<div class="mp-toprow">/.test(MP),
    'overlapping targets are decided by DOM order, not by what is drawn on top');
  check('...so neither is positioned over the other',
    !/#mp-swap-btn \{[\s\S]{0,200}?position: absolute;/.test(MP),
    'absolute positioning is what put it on top of a full-width button in the first place');
  // A controller runtime already has X/A to swap and a thumbstick to undo; putting those on the
  // panels there costs space and rasteriser time for nothing.
  check('the hands-only controls are gated by a class, not built into every panel',
    /_syncHandsOnlyUI\(\) \{/.test(SRC) && /this\._syncHandsOnlyUI\(\);/.test(SRC),
    'an ungated control is clutter on the device that already has a button for it');
  check('...revealed by CSS, so it stays a style change',
    /#mp-root\.hands-only \.mp-hands-only \{ display: flex; \}/.test(MP)
      && /#mm-root\.hands-only \.mm-hands-only \{ display: flex; \}/.test(MM),
    'changing MARKUP needs _rebuildContent and a cache-key revision; markDirty alone shows a stale texture');
  // The reveal rule existing is not the same as the control being hidden by default — assert
  // BOTH halves, or a default of display:flex passes while showing on every device.
  check('...and hidden by default, on both panels',
    /\.mp-hands-only \{ display: none; \}/.test(MP) && /\.mm-hands-only \{ display: none; \}/.test(MM),
    'a controller user gets buttons they already have, taking panel space and rasteriser time');
  check('...and the class is only re-applied when it changes',
    /if \(want === this\._handsUiClassApplied\) return;/.test(SRC),
    'a markDirty every frame re-rasterises the panel for nothing');

  // With no thumbstick there is no other way to undo without leaving what you are doing.
  check('both panels carry undo and redo',
    /<button id="mp-undo">Undo<\/button>/.test(MP) && /<button id="mm-undo">Undo<\/button>/.test(MM),
    'undo was unreachable on a hands-only runtime');
  check('...routed through one implementation',
    /_doUndoRedo\(redo\) \{/.test(SRC)
      && /addEventListener\('mp-undo'/.test(SRC) && /addEventListener\('mm-undo'/.test(SRC));
  // #mm-body is position:absolute, so a static sibling after it does not land below it — it
  // lands straight after the menubar and draws across the top of the panel.
  check('the main menu undo row is pinned to the bottom, not left in flow',
    /#mm-undo-row \{[\s\S]{0,120}?position: absolute;[\s\S]{0,80}?bottom: 0;/.test(MM),
    'a static sibling of an absolutely-positioned body draws over the menubar');
  check('...and the body gives up exactly its height, so nothing is hidden under it',
    /#mm-root\.hands-only #mm-body \{ height: \$\{MM_BODY_H - MM_UNDO_H\}px; \}/.test(MM),
    'overlaying the row on content that is still there hides the last rows of every section');

  check('...that gives the active tool first refusal, as the thumbstick does',
    /if \(!\(tool && tool\[fn\] && tool\[fn\]\(\)\)\) \{/.test(SRC),
    'some tools hold state the global stack knows nothing about');

  check('...and the tool button shares the row rather than spanning it',
    /#mp-tool-btn \{\s*\n\s*flex: 1;/.test(MP),
    'a width:100% sibling reintroduces the overlap no matter where the swap button sits');
}

// ── 4e2. the Neg toggle wrote a property nothing reads ───────────────────────
//
// It set sculptManager._negative, which no file in the codebase defines or consults — every
// tool carries its own _negative, and the VR path reads currentTool._negative XOR the subtract
// override. The button then read that same invented property back to decide whether to look
// active, so it lit up correctly and changed nothing: self-consistent and inert.
{
  check('the Neg toggle writes the tool flag, not a manager one',
    /const t = main\.getSculptManager\?\.\(\)\?\.getCurrentTool\?\.\(\);/.test(MP)
      && /if \(t && '_negative' in t\) \{ t\._negative = v;/.test(MP),
    'sculptManager._negative is defined nowhere and read by nothing');
  check('...and reads the same flag it writes',
    /\(\) => !!main\.getSculptManager\?\.\(\)\?\.getCurrentTool\?\.\(\)\?\._negative,/.test(MP),
    'reading back its own invention is what made a dead button look like a working one');
  check('...including the active-state sync',
    /classList\.toggle\('active', !!sm\?\.getCurrentTool\?\.\(\)\?\._negative\)/.test(MP),
    'a highlight fed from a different source than the write is a lie about state');
  check('...and leaves a tool that has no such flag alone',
    /'_negative' in t/.test(MP),
    'inventing the property on a tool that never declared it repeats the original bug');
  // Symmetry beside it is NOT the same bug — the manager really does own _symmetry.
  check('the Symmetry toggle is left on the manager, which owns it',
    /\(\) => main\.getSculptManager\?\.\(\)\._symmetry,/.test(MP),
    'SculptManager declares _symmetry; moving it to the tool would break a working control');
}

// ── 4f. grab speed ───────────────────────────────────────────────────────────
//
// 1:1 is the honest default and not always the comfortable one: a controller braces your wrist,
// a fist gesture in mid-air does not, and the same motion throws the scene.
{
  check('the world grab has a tunable gain',
    /const gGain = this\.getGrabGain\(\);/.test(SRC) && /getGrabGain\(\) \{/.test(SRC));
  check('...applied to the delta, not the accumulated position',
    /this\.moveWorld\(\[delta\[0\] \* gGain, delta\[1\] \* gGain, delta\[2\] \* gGain\]\);/.test(SRC),
    'scaling an accumulated offset makes the grab drift and pay it back on release');
  check('...leaving rotation at 1:1',
    !/rotateWorld\([^)]*gGain/.test(SRC),
    'a rotation gain makes your hand and the world disagree about which way is up');
  check('...defaulting to 1:1, so nobody who liked it gets a changed grab',
    /return Number\.isFinite\(v\) \? v : 1\.0;/.test(SRC));
  check('...with a floor, so it can never become inert and look broken',
    /options\.grabGain = queryNumber\(getVal\('grabGain'\), 0\.25, 2\.0, 1\.0\);/.test(OPT));
  check('...exposed as a settings slider, not just a console global',
    /<span class="mm-lbl">Grab speed<\/span>/.test(MM) && /id="mm-grab-gain"/.test(MM),
    'matt asked for it in settings — a window global is not a setting');
  check('...and persisted like its neighbours',
    /opts\.saveOption\('grabGain', f, 500\);/.test(MM),
    'a setting that resets on reload is a slider, not a preference');
}

// ── 5. the button is placed in the space it actually lives in ────────────────
//
// The obvious head source is frame.getViewerPose(refSpace), and for a three.js mesh it is the
// wrong one: the mesh is parented into the three scene and three applies its own camera rig, so
// where the two disagree the button sits in a space nobody is looking from. That is the same
// two-spaces trap that cost four sessions on the motion-path work.
{
  check('the gaze button takes its head pose from the XR camera',
    /const cam = xr && xr\.getCamera && xr\.getCamera\(this\._camera\?\.getThreeCamera\?\.\(\)\);[\s\S]{0,200}?const H = cam\.matrixWorld\.elements;/.test(SRC),
    'the XR camera is the three-side head, so it cannot drift from the mesh it positions');
  check('...and the world matrix is synced before it is read',
    /cam\.updateMatrixWorld\(true\);/.test(SRC),
    'reading a stale matrix is the other half of the same trap');
  check('...and it eases rather than welding to the head',
    /m\.position\.lerp\(/.test(SRC),
    'a head-locked button moves with every micro-motion and reads as dirt on the lens');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
