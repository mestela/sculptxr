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
//   AVP_INJECT=noanatomy  the ray goes back to a runtime frame instead of joint anatomy, so its
//                          direction depends on a convention nobody documented
//   AVP_INJECT=staleraydir the ray orientation goes back to targetRaySpace only, which on a
//                          generic-fixed-hand runtime does not turn with the hand
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
//   AVP_INJECT=earlylatch  the hands-only class latches before the panels exist, so the wrist
//                          panel keeps its controller layout for the rest of the session
//   AVP_INJECT=norebuild  the class change repaints without rebuilding, so the DOM updates and
//                          the rasterised texture keeps the old layout
//   AVP_INJECT=queuedpaint the class change only queues a repaint, so the revealed controls stay
//                          invisible behind a stale texture
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
//   AVP_INJECT=numpadpush the numpad goes back to a fixed forward push, which a sideways offset
//                          on an angled panel beats, leaving it behind the panel
//   AVP_INJECT=partialreset the controller slot resets only .y again, so x and z keep the hand
//                          placement and the panel returns at the wrong angle
//   AVP_INJECT=pressonly   hands-only is true only WHILE a hand button is pressed, so it
//                          oscillates between pinches
//   AVP_INJECT=nomirrorback leaving hands mode stops restoring scale.y = -1, so the controller
//                          slot gets an un-mirrored panel
//   AVP_INJECT=kbnopose   the keyboard stops copying the parent pose, so it no longer starts
//                          where the panel it belongs to is
//   AVP_INJECT=hovercull  the hover quad goes back to single-sided, so a normalised parent
//                          back-face culls it and the highlight never appears
//   AVP_INJECT=modaldepth modals are depth-sorted again, so a keyboard positioned behind the
//                          dialog it serves stays hidden however high its render order
//   AVP_INJECT=modaltie   modal overlays go back to the panel render band, so a keyboard ties
//                          with the dialog it serves and can draw behind it
//   AVP_INJECT=kbmirror   the overlay stops matching its source panel's mirror sign, so the
//                          keyboard comes up flipped over a normalised panel
//   AVP_INJECT=optprop    an option is read as a property off the getOptionsURL function instead
//                          of calling it, so the saved value never loads
//   AVP_INJECT=opaquedots the fingertip dots go back to near-full opacity, punching holes in the
//                          menus they draw over
//   AVP_INJECT=stalepitch  the pitch default reverts to the -45 measured against a construction
//                          that no longer exists
//   AVP_INJECT=livedrag    the live spike follows its own slider again, closing the feedback loop
//                          that runs the value to its limit
//   AVP_INJECT=swapgroups  the hand spike rows go back to being hidden unless hands are in use
//   AVP_INJECT=spikedrift  a mode switch stops re-applying the spike geometry, so the drawn spike
//                          and the picking tip disagree
//   AVP_INJECT=wireframeprev the radius preview goes back to inventing a wireframe material
//                          instead of borrowing the brush cursor's fresnel shell
//   AVP_INJECT=nodragpoint the drag-lock hit drops its world point again, so nothing can draw at
//                          the intersection during a slider drag
//   AVP_INJECT=anysliderpreview the radius preview arms on ANY slider drag, not just radius
//   AVP_INJECT=onestylus   hands share the controller stylus length again, so the spike is tuned
//                          for a device that is not in use
//   AVP_INJECT=doubletilt  the controller's stylus tilt applies to hands too, rotating a ray that
//                          _applyHandRayCorrection has already pitched
//   AVP_INJECT=analogvalue the hand pad passes the raw closure value through, so the post-menu
//                          latch never releases and the first pinch after a menu is swallowed
//   AVP_INJECT=hardcodedrz  the keyboard's Rz180 undo is hardcoded again, flipping it whenever a
//                          panel has a normalised scale
//   AVP_INJECT=mockwins   the synthesised pad outranks the runtime's again, replacing a working
//                          gesture recogniser with our own thresholds on a runtime that has both
//   AVP_INJECT=rawhandpad the hand pad is passed through unnormalised, so grasp lands on the
//                          index bound to A/X and a fist toggles subtract or opens the menu
//   AVP_INJECT=flatslot        the controller slot zeroes the panel's built-in pitch every frame,
//                              so the menus lie facing the floor instead of along the controller
//   AVP_INJECT=noresizeflag    the class change does not declare its size change, so the paint
//                              stays subject to the ambient rate limiter and the plane keeps the
//                              old aspect
//   AVP_INJECT=stuckdrag       a slider drag survives the input switch and blocks every repaint
//   AVP_INJECT=oneflush        the class change asks for one synchronous repaint only, which
//                              captures the bitmap from before the change
//   AVP_INJECT=latereturn      the repaint countdown never runs
//   AVP_INJECT=dragfromcontrol the drag arms without cancelling the pending click, so a scroll
//                              also presses the button it started on
//   AVP_INJECT=movesdontreach  only a slider drag forwards its moves, so the scroll drag is
//                              created on press and never hears the movement
//   AVP_INJECT=clickonpress    the VR click fires on the press again, so every drag clicks
//   AVP_INJECT=tinyslop        the slop goes back inside the tremor of a held pinch, so every
//                              press becomes a scroll
//   AVP_INJECT=nodeadzone      no deadzone, so a held pinch creeps the panel
//   AVP_INJECT=stuckdragscroll the drag anchor survives the release
//   AVP_INJECT=twospikes       the unused input's objects stay visible, so its spike draws over
//                              the active one a few centimetres away
//   AVP_INJECT=handwinsslot    the hand's objects are used whatever is driving, so the panels
//                              ride the hand grip while you hold a controller
//   AVP_INJECT=staleclaim      the active objects are chosen at connect time only, so switching
//                              input mid-session leaves the panels in the old frame
//   AVP_INJECT=handposealways  the hand pose writes the controller object in controller mode too
//   AVP_INJECT=dotslinger      the fingertip dots are left up when the hands stop driving
//   AVP_INJECT=syspinchdom     a platform pinch is credited to the dominant hand whichever hand
//                              actually made it
//   AVP_INJECT=offhandsmooth   the offhand trigger alone arms Smooth, so a left pinch starts
//                              smoothing with nothing else held
//   AVP_INJECT=nocompositelog  the compositor state is computed and thrown away, so the next
//                              punch-through report has nothing to say which session it was
//   AVP_INJECT=foveateall      maximum foveation on every runtime, gaze-tracked or not
//   AVP_INJECT=nofistfill      a one-button hand pad drops the fist latch on the floor
//   AVP_INJECT=fistbeatsruntime the runtime's own grasp is never remembered, so our fist keeps
//                              overriding a runtime that answers this itself
//   AVP_INJECT=tipmidpoint     the raw tip midpoint overwrites the stabilised ray origin again
//   AVP_INJECT=contactpinch    the pinch threshold is contact, which a Quest 2 never reaches
//   AVP_INJECT=offsetbox       planes measured from the border box while the rasteriser uses the
//                              client box, so every bordered panel is stretched
//   AVP_INJECT=rootborder      a real border on the panel root, whose bottom and right fall
//                              outside the SVG viewport and take the content with them
//   AVP_INJECT=swapbacktoprow  the wrist panel's swap goes back beside the tool button
//   AVP_INJECT=nobtnshrink     menubar labels cannot shrink, so a wider-metric engine pushes the
//                              pin off the right edge instead of clipping a label
//   AVP_INJECT=minibtnback     the wrist-panel swap is back in the menubar, which has no room
//                              for it and loses the pin off the right edge
//   AVP_INJECT=unhandedcursor  a handedness-'none' pinch source drives the right hand's cursor
//                              and hides it for as long as the pinch is held
//   AVP_INJECT=onesign    both placement constants share one mirror sign, so the runtime whose
//                         number was measured at the other sign renders upside down
//   AVP_INJECT=keepscale   the hands slot stops normalising scale, so the panel's -1 y-scale
//                          mirrors it and the measured rotation renders flipped
//   AVP_INJECT=analoghand  a hand press goes back through the analog Schmitt, which its resting
//                          value latches on permanently
//   AVP_INJECT=onepanelnum  both runtimes share the visionOS placement, which means nothing in
//                          Galaxy XR's grip frame
//   AVP_INJECT=jointonlyplace  placement requires a wrist joint again, so the grab silently does
//                          nothing on a runtime whose hands have none
//   AVP_INJECT=logonlytrace the menu trace goes back to console-only, invisible on Galaxy XR
//   AVP_INJECT=xrhandonly  hand detection goes back to !!source.hand, so Galaxy XR hands — which
//                          have no joints and five buttons — read as controllers
//   AVP_INJECT=presencetest    quiet controllers hand the session to the hands on a timer, so a
//                              session started with controllers flips a few seconds in
//   AVP_INJECT=primeonce  the panel priming stops re-arming, so a second switch to hands shows
//                          no menu at all
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

const REPO = new URL('..', import.meta.url).pathname;
let SRC = fs.readFileSync(path.join(REPO, 'src/Scene.js'), 'utf8');
let MP    = fs.readFileSync(path.join(REPO, 'src/gui/htmlvr/MiniPanel.js'), 'utf8');
let OPT   = fs.readFileSync(path.join(REPO, 'src/misc/getOptionsURL.js'), 'utf8');
let INS   = fs.readFileSync(path.join(REPO, 'src/gui/htmlvr/install.js'), 'utf8');
let HVP   = fs.readFileSync(path.join(REPO, 'src/gui/htmlvr/HTMLVRPanel.js'), 'utf8');
const SGL = fs.readFileSync(path.join(REPO, 'src/SculptGL.js'), 'utf8');
let KBD   = fs.readFileSync(path.join(REPO, 'src/gui/htmlvr/VrKeyboard.js'), 'utf8');
let NUM   = fs.readFileSync(path.join(REPO, 'src/gui/htmlvr/VrNumpad.js'), 'utf8');
const CNF = fs.readFileSync(path.join(REPO, 'src/gui/htmlvr/VrConfirm.js'), 'utf8');
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
    sub('if (!pad || !pad.buttons || !pad.buttons.length) return null;', 'if (!pad) return null;', 'padOf');
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
    sub("          if (!_otherOwnsIt) isPinching = true;\n        }\n\n        mockGamepad = {", '\n        }\n\n        mockGamepad = {', 'system pinch');
  } else if (inj === 'nosysheal') {
    sub('    if (!_anyTransient) this._sysPinchActive = false;', '', 'pinch self-heal');
  } else if (inj === 'loosepinch') {
    sub('          const P_ON    = this.getPinchOn();           // skin-to-skin gap, metres',
        '          const P_ON    = 0.005;', 'pinch accessor');
  } else if (inj === 'numpadpush') {
    // Repointed 2026-09-17: the distance-from-the-head rule this cut is gone. Same defect in its
    // new form -- the numpad goes back to a fixed push along the panel's own +Z, which is "in
    // front" only when the panel happens to face you.
    const a = 'this.mesh.position.add(frontOfPanelOffset(';
    if (!NUM.includes(a)) throw new Error('inject numpadpush: anchor moved (numpad clearance)');
    NUM = NUM.replace(a, 'this.mesh.position.addScaledVector(new THREE.Vector3(0,0,1).applyQuaternion(panelQuat), 0.01); void ((');
  } else if (inj === 'partialreset') {
    sub('                  _p.mesh.rotation.set(wristPanelPitch(), _wYaw, 0);',
        '                  _p.mesh.rotation.y = _wYaw;', 'slot reset');
  } else if (inj === 'pressonly') {
    sub('      if (this._padOf(s2)?.buttons?.[0]?.pressed) { this._lastHandUse = now; break; }\n    }\n    if (Number.isFinite(this._lastHandUse) && this._lastHandUse >= this._lastControllerUse) return true;',
        '      if (this._padOf(s2)?.buttons?.[0]?.pressed) return true;\n    }', 'hand use memory');
  } else if (inj === 'nomirrorback') {
    sub('                  if (_p.mesh.scale.y > 0) _p.mesh.scale.set(1, -1, 1);', '', 'mirror restore');
  } else if (inj === 'kbnopose') {
    const a = '    this.mesh.position.copy(panelWorldPos);';
    if (!KBD.includes(a)) throw new Error('inject kbnopose: anchor moved (parent pose copy)');
    KBD = KBD.replace(a, '    this.mesh.position.set(0, 0, 0);');
  } else if (inj === 'hovercull') {
    const a = '        side: THREE.DoubleSide,';
    if (!HVP.includes(a)) throw new Error('inject hovercull: anchor moved (quad side)');
    HVP = HVP.replace(a, '');
  } else if (inj === 'modaldepth') {
    const a = '      depthTest: !_modal,   // z-sorted against the panel — no draw-order tricks';
    if (!HVP.includes(a)) throw new Error('inject modaldepth: anchor moved (modal depth)');
    HVP = HVP.replace(a, '      depthTest: true,');
  } else if (inj === 'modaltie') {
    const a = 'export const VR_MODAL_ORDER_BUMP = 2;';
    if (!HVP.includes(a)) throw new Error('inject modaltie: anchor moved (modal bump)');
    HVP = HVP.replace(a, 'export const VR_MODAL_ORDER_BUMP = 0;');
  } else if (inj === 'kbmirror') {
    // Repointed 2026-09-17: the scale.y sign-copy this cut is gone, replaced by the shared
    // matchPanelTransform. Same defect -- the overlay stops matching its source panel's mirror,
    // so a pinned or hands-normalised panel produces a reversed keyboard.
    const a = 'const panelQuat = matchPanelTransform(this.mesh, pMesh);';
    if (!KBD.includes(a)) throw new Error('inject kbmirror: anchor moved (mirror rule)');
    KBD = KBD.replace(a, 'const panelQuat = new THREE.Quaternion(); pMesh.getWorldQuaternion(panelQuat);');
  } else if (inj === 'optprop') {
    sub("    const o = getOptionsURL()[key];   // called — see the note in getPinchOn",
        '    const o = getOptionsURL[key];', 'option read');
  } else if (inj === 'opaquedots') {
    sub('          opacity: window._handDotOpacity ?? 0.45,', '          opacity: 0.95,', 'dot opacity');
  } else if (inj === 'stalepitch') {
    const a = "options.handRayPitch = queryNumber(getVal('handraypitch'), -80, 80, 20);";
    if (!OPT.includes(a)) throw new Error('inject stalepitch: anchor moved (pitch default)');
    OPT = OPT.replace(a, "options.handRayPitch = queryNumber(getVal('handraypitch'), -80, 20, -45);");
  } else if (inj === 'livedrag') {
    sub('    if (this._spikeFreeze) return this._spikeFreeze.length;   // frozen while its own slider is dragged', '', 'spike freeze');
  } else if (inj === 'swapgroups') {
    const a = '<div class="mm-section-title">Hand spike</div>';
    if (!MM.includes(a)) throw new Error('inject swapgroups: anchor moved (hand spike title)');
    MM = MM.replace(a, '<div class="mm-section-title mm-hands-only">Hand spike</div>');
  } else if (inj === 'spikedrift') {
    sub('      this.updateStylusLength?.(this.getStylusLength());', '', 'spike re-apply');
  } else if (inj === 'wireframeprev') {
    sub("      const m = src.material.clone();", '      const m = { wireframe: true };', 'borrowed material');
  } else if (inj === 'nodragpoint') {
    sub('}, distance: 0, point: _hit.clone() } };', '}, distance: 0 } };', 'drag hit point');
  } else if (inj === 'anysliderpreview') {
    sub("            if (_locked && /radius/i.test(_sliderId)) this._radiusPreviewOn = true;",
        '            if (_locked) this._radiusPreviewOn = true;', 'radius arm');
  } else if (inj === 'onestylus') {
    sub("    if (this._handsOnlyMode()) return this._handStylus('handStylusLength', 0.05);", '', 'hand stylus length');
  } else if (inj === 'doubletilt') {
    sub('    if (this._handsOnlyMode()) return 0.0;\n    if (this._guiXR && this._guiXR._uiSettings && this._guiXR._uiSettings.stylusTilt',
        '    if (this._guiXR && this._guiXR._uiSettings && this._guiXR._uiSettings.stylusTilt', 'hand tilt rule');
  } else if (inj === 'analogvalue') {
    sub('    view.buttons[0].value   = view.buttons[0].pressed ? 1 : 0;',
        '    view.buttons[0].value   = sel ? (sel.value || 0) : 0;', 'binary value');
  } else if (inj === 'hardcodedrz') {
    const a = '  if (sy < 0) q.multiply(new THREE.Quaternion(0, 0, 1, 0));';
    if (!HVP.includes(a)) throw new Error('inject hardcodedrz: anchor moved (panelWorldQuat)');
    HVP = HVP.replace(a, '  q.multiply(new THREE.Quaternion(0, 0, 1, 0));');
  } else if (inj === 'mockwins') {
    sub('    const mock = src.hand && !realHasButtons && this._mockGamepads && this._mockGamepads[src.handedness];',
        '    const mock = src.hand && this._mockGamepads && this._mockGamepads[src.handedness];', 'pad precedence');
  } else if (inj === 'rawhandpad') {
    sub('    if (!this._isHandSource(src)) return pad;', '    return pad;', 'hand pad normalise');
  } else if (inj === 'keepscale') {
    sub('                  if (window._panelKeepScale !== true) _p.mesh.scale.set(1, _hp.sy, 1);', '', 'scale normalise');
  } else if (inj === 'flatslot') {
    sub('                  _p.mesh.rotation.set(wristPanelPitch(), _wYaw, 0);',
        '                  _p.mesh.rotation.set(0, _wYaw, 0);', 'controller slot pitch');
  } else if (inj === 'noresizeflag') {
    sub('      p._needsResize = true;', '', 'transition resize flag');
  } else if (inj === 'stuckdrag') {
    sub('      p._sliderDragTarget = null;', '', 'drag release');
  } else if (inj === 'oneflush') {
    sub('      this._handsRepaintUntil = performance.now() + (window._handsRepaintMs ?? 1000);', '', 'repaint window');
  } else if (inj === 'latereturn') {
    sub('    if (this._handsRepaintUntil && performance.now() < this._handsRepaintUntil) {',
        '    if (false && this._handsRepaintUntil) {', 'countdown placement');
  } else if (inj === 'dragfromcontrol') {
    HVP = HVP.replace("        this._pendingClick = null;\n        return;\n      }", "        return;\n      }");
  } else if (inj === 'movesdontreach') {
    HVP = HVP.replace("    if (this._sliderDragTarget || this._dragScroll) {", "    if (this._sliderDragTarget) {");
  } else if (inj === 'clickonpress') {
    HVP = HVP.replace("        this._pendingClick = { target, x: absX, y: absY };",
                      "        target.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: absX, clientY: absY }));");
  } else if (inj === 'tinyslop') {
    HVP = HVP.replace('      const min = window._panelDragScrollMin ?? 18;',
                      '      const min = window._panelDragScrollMin ?? 6;');
  } else if (inj === 'nodeadzone') {
    HVP = HVP.replace("        if (Math.abs(dy) < min) return;", "        if (false) return;");
  } else if (inj === 'stuckdragscroll') {
    HVP = HVP.replace("    if (type === 'pointerup' && this._dragScroll) { this._dragScroll = null; this.markDirty(); }", "");
  } else if (inj === 'twospikes') {
    sub('        if (other.ctl)  other.ctl.visible  = false;', '', 'inactive input hide');
  } else if (inj === 'handwinsslot') {
    sub("      const pick = (wantHand ? (S.hand[h] || S.ctl[h]) : (S.ctl[h] || S.hand[h])) || null;",
        "      const pick = (S.hand[h] || S.ctl[h]) || null;", 'active input choice');
  } else if (inj === 'staleclaim') {
    sub('    this._applyActiveInputObjects();\n\n    // ONLY WHILE THE HANDS ARE THE INPUT', '\n    // ONLY WHILE THE HANDS ARE THE INPUT', 'per-frame re-derive');
  } else if (inj === 'handposealways') {
    sub('    const _handsDrive = this._handsOnlyMode();\n    if (_handsDrive) {', '    const _handsDrive = true;\n    if (_handsDrive) {', 'hand pose gate');
  } else if (inj === 'dotslinger') {
    sub('    } else {\n      this._hideHandDots();\n    }', '    }', 'dot hiding');
  } else if (inj === 'syspinchdom') {
    sub('          if (!_otherOwnsIt) isPinching = true;', '          isPinching = true;', 'system pinch attribution');
  } else if (inj === 'offhandsmooth') {
    // Anchor repointed 2026-09-17: the dispatch stopped re-deriving the mode and now reads the
    // per-frame latch, so the condition is `_domPressed && this._smoothMode`. Same defect being
    // injected -- drop the dominant-trigger half, so the off-hand trigger ALONE arms Smooth and a
    // lone left pinch starts smoothing on hands.
    sub('    if (_domPressed && this._smoothMode) {',
        '    if (this._smoothMode) {', 'both-trigger gate');
  } else if (inj === 'nocompositelog') {
    sub('      window._xrComposite = {', '      const _unused = {', 'compositor record');
  } else if (inj === 'foveateall') {
    sub('        : (Number.isFinite(getOptionsURL()[\'foveation\']) ? getOptionsURL()[\'foveation\']\n                                                         : (this._isQuestStandalone ? 0 : 1));',
        '        : 1;', 'foveation gate');
  } else if (inj === 'nofistfill') {
    sub('    view.buttons[1].pressed = grasp || _ownFist;', '    view.buttons[1].pressed = grasp;', 'fist fallback');
  } else if (inj === 'fistbeatsruntime') {
    sub('    if (grasp) this._rtGraspSeen[_hk] = true;', '', 'runtime grasp memory');
  } else if (inj === 'tipmidpoint') {
    sub('    if (!_jointRay && tp && ip) {', '    if (tp && ip) {', 'joint-ray origin gate');
  } else if (inj === 'contactpinch') {
    sub('    return this._isQuestStandalone ? 0.022 : 0.005;',
        '    return 0.022;', 'pinch default: one number for every runtime again');
  } else if (inj === 'offsetbox') {
    HVP = HVP.replace('  const w = el.clientWidth  || el.offsetWidth  || fallbackW;\n  const h = el.clientHeight || el.offsetHeight || fallbackH;',
                      '  const w = el.offsetWidth || fallbackW;\n  const h = el.offsetHeight || fallbackH;');
  } else if (inj === 'rootborder') {
    MM = MM.replace('  box-shadow: inset 0 0 0 2px #585b70;', '  border: 2px solid #585b70;');
  } else if (inj === 'swapbacktoprow') {
    MP = MP.replace('      <button id="mp-swap-btn" title="Open the main menu">Menu</button>\n', '')
           .replace('      </button>\n    </div>', '      </button>\n      <button id="mp-swap-btn" class="mp-hands-only" title="Open the main menu">Menu</button>\n    </div>');
  } else if (inj === 'nobtnshrink') {
    MM = MM.replace('  min-width: 0;\n  overflow: hidden;\n  padding: 5px 11px;', '  padding: 5px 11px;');
  } else if (inj === 'minibtnback') {
    MM = MM.replace('      <button class="mm-pin-btn" id="mm-pin-btn" title="Pin panel in world space">',
      '      <button class="mm-pin-btn mm-hands-only" id="mm-mini-btn" title="Back to the wrist panel">Mini</button>\n      <button class="mm-pin-btn" id="mm-pin-btn" title="Pin panel in world space">');
  } else if (inj === 'unhandedcursor') {
    sub("            const cursorGroup = !_handed ? null : (isLeft ? this._vrCursorLeft : this._vrCursorRight);\n            const controllerGroup = !_handed ? null : (isLeft ? this._vrControllerLeft : this._vrControllerRight);",
        "            const cursorGroup = isLeft ? this._vrCursorLeft : this._vrCursorRight;\n            const controllerGroup = isLeft ? this._vrControllerLeft : this._vrControllerRight;",
        'unhanded cursor guard');
  } else if (inj === 'onesign') {
    sub('r: [22.9, -2.8, -81.4], sy: -1', 'r: [22.9, -2.8, -81.4], sy: 1', 'wrist mirror sign');
  } else if (inj === 'analoghand') {
    sub('            ? (_handSrc\n                ? !!_trigger.pressed\n                : (_trigger.pressed',
        '            ? ((false)\n                ? !!_trigger.pressed\n                : (_trigger.pressed', 'hand press rule');
  } else if (inj === 'onepanelnum') {
    sub('                  const _hp = this._handPanelPlacement(), _D = Math.PI / 180;',
        '                  const _hp = Scene.HAND_WRIST_PANEL, _D = Math.PI / 180;', 'placement choice');
  } else if (inj === 'jointonlyplace') {
    sub('    if (!wp && domSrc.gripSpace) wp = frame.getPose(domSrc.gripSpace, refSpace);', '', 'grip fallback');
  } else if (inj === 'logonlytrace') {
    sub('    window._menuLog.push(t);', '', 'trace buffer');
  } else if (inj === 'xrhandonly') {
    sub("      if (this._isHandSource(s)) { anyHand = true; continue; }   // hands never count as controllers,",
        '      if (s.hand) { anyHand = true; continue; }', 'hand classification');
  } else if (inj === 'presencetest') {
    sub('    return false;\n  }\n\n  // A BUTTON YOU LOOK AT',
        '    return (now - this._lastControllerUse) > (window._handsOnlyIdleMs ?? 3000);\n  }\n\n  // A BUTTON YOU LOOK AT', 'idle test');
  } else if (inj === 'primeonce') {
    sub('    if (!want) this._handsUiPrimed = false;', '', 'priming re-arm');
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
  } else if (inj === 'earlylatch') {
    sub('    if (!panels.length) return;', '', 'panel readiness guard');
  } else if (inj === 'norebuild') {
    sub('        p.syncFromState?.();\n        p._rebuildContent?.();', '', 'panel rebuild');
  } else if (inj === 'queuedpaint') {
    sub('      if (p.flushPaint) p.flushPaint(); else p.markDirty?.();', '      p.markDirty?.();', 'forced repaint');
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
    sub("              this._traceOut('TRIGGER ' + _hand + (_pressed ? ' DOWN' : ' UP  ')", "              this._traceOut(('' + _hand", 'edge log');
  } else if (inj === 'dotsfrozen') {
    sub('      if (!pose) { m.visible = false; continue; }', '      if (!pose) { continue; }', 'dot hide');
  } else if (inj === 'reticleunder') {
    sub('      this._bpReticle.renderOrder = VR_PANEL_RENDER_ORDER + 8;',
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
    sub('              : (window._wristSmooth ?? 0.12);', '              : 1;', 'panel smoothing');
  } else if (inj === 'rayhigh') {
    sub('    const deg = Number.isFinite(_perHand) ? _perHand : _base * _mirror;',
        '    const deg = 0;', 'ray pitch');
  } else if (inj === 'noanatomy') {
    sub("    const _jointRay = (window._handRayFromJoints !== false)\n      ? this._handRayFromJoints(source, frame, refSpace) : null;",
        '    const _jointRay = null;', 'joint ray');
  } else if (inj === 'staleraydir') {
    sub('    const _poseSpace = _jointRay ? null : (source.gripSpace || source.targetRaySpace);',
        '    const _poseSpace = _jointRay ? null : source.targetRaySpace;', 'ray rotation source');
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
    // Read the drag from the GRIP — the object carrying the offset being calibrated — so the
    // correction feeds back into its own measurement.
    sub("    const wj = domSrc.hand && domSrc.hand.get('wrist');", '    const wj = null;', 'drag source');
  } else if (inj === 'gripcentred') {
    sub('const outDist = window._wristGripOut ?? 0.045;', 'const outDist = 0;', 'lateral offset');
  } else if (inj === 'gripunsigned') {
    sub("(window._wristGripYaw ?? 90) * (source.handedness === 'left' ? 1 : -1)",
        '(window._wristGripYaw ?? 90)', 'yaw sign');
  } else if (inj === 'gazeshared') {
    // Anchor repointed 2026-09-17: the transient-pointer branch moved up into `_handKey`, which
    // is hoisted above the stroke-owns-input gate that reads it; `_hand` is now an alias. Inject
    // the defect where the branch actually lives.
    sub("          const _handKey = source.targetRayMode === 'transient-pointer'\n            ? 'G'\n            : (source.handedness === 'left' ? 'L' : 'R');",
        "          const _handKey = source.handedness === 'left' ? 'L' : 'R';", 'gaze press key');
  } else if (inj === 'gazebehind') {
    sub('    mesh.renderOrder = VR_PANEL_RENDER_ORDER + 3;', '', 'render order');
  } else if (inj === 'stalemock') {
    sub('const mock = src.hand && !realHasButtons && this._mockGamepads && this._mockGamepads[src.handedness];',
        'const mock = this._mockGamepads && this._mockGamepads[src.handedness];', 'expiry');
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
    /if \(!pad \|\| !pad\.buttons \|\| !pad\.buttons\.length\) return null;/.test(SRC),
    'truthy-with-no-buttons is what slipped past every if (src.gamepad) guard');
  // A GESTURE PAD HAS TWO SIGNALS, NOT SIX. Galaxy XR gives hands a 5-button pad and puts GRASP
  // where this app had bound A/X — so a fist toggled add/subtract and opened the menu. The
  // length is what did it: the face-button handlers gate on `btns.length > 4`, which a 5-button
  // gesture pad passes while having no face buttons at all.
  check('a hand pad is normalised to select and grasp only',
    /view\.buttons\[1\]\.pressed = grasp \|\| _ownFist;/.test(SRC)
      && /buttons: \[\{ pressed: false, value: 0 \}, \{ pressed: false, value: 0 \}\]/.test(SRC),
    'a two-button view fails the length > 4 gate, which is what stops the A/X misfire');
  // The VALUE matters as much as the flag: the post-menu latch blocks a new stroke until the
  // trigger is "fully released" at <= 0.05, and a hand's analog closure value idles near 0.3 —
  // so the first pinch after using a menu was swallowed until an exaggerated unpinch.
  check('a hand pad reports a BINARY value, not the raw closure signal',
    /view\.buttons\[0\]\.value   = view\.buttons\[0\]\.pressed \? 1 : 0;/.test(SRC),
    'consumers that read value rather than pressed must agree with the ones that read pressed');

  check('...with grasp taken as any pressed button above select, not a guessed index',
    /for \(let i = 1; i < pad\.buttons\.length; i\+\+\) \{[\s\S]{0,140}?grasp = true; break;/.test(SRC),
    'a gesture pad has only select and grasp to report, so the slot it uses is what it means');
  check('...leaving a real controller pad untouched',
    /if \(!this\._isHandSource\(src\)\) return pad;/.test(SRC),
    'normalising a Touch controller would delete its face buttons and thumbstick');
  check('...and cached, since this is read every frame per source',
    /this\._handPadView\[key\] \|\| \(this\._handPadView\[key\] = \{/.test(SRC));

  // Preferring the mock for ANY jointed source was right while the only jointed runtime reported
  // an empty pad. Galaxy XR now gives BOTH joints and a working gesture pad, and the runtime's
  // recogniser is the one that made clicking reliable there.
  check('a runtime gesture pad outranks our synthesised one',
    /const realHasButtons = !!\(src\.gamepad && src\.gamepad\.buttons && src\.gamepad\.buttons\.length\);/.test(SRC)
      && /const mock = src\.hand && !realHasButtons &&/.test(SRC),
    'our thresholds are a reimplementation of a decision the runtime already publishes');

  check('...and a cached mock can never answer for a controller',
    /const mock = src\.hand && !realHasButtons && this\._mockGamepads/.test(SRC),
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
  // CONTACT WAS THE OLD DEFAULT, and it was wrong for a reason no amount of radius arithmetic
  // absorbs: a Quest 2 pinch reads a gap of 0.011-0.018 and never reaches contact at all, while
  // its relaxed hand reads 0.045-0.072.
  //
  // 0.022 CLEARED BOTH DEVICES AND SUITED ONLY ONE. The margins are not comparable -- 4mm on a
  // Quest 2, 18mm on a Vision Pro -- so a single number set by the poorer tracker put the
  // better one's threshold in the middle of "fingers are near each other". matt: "the finger
  // indicators turn green when the finger/thumb get close... in beta, green is being treated as
  // a pinch... menus get stuck, strokes get stuck." He confirmed 0.005 on the device.
  check('...defaulting per RUNTIME, because the two populations are not the same signal',
    /return this\._isQuestStandalone \? 0\.022 : 0\.005;/.test(SRC),
    'one threshold means the better tracker is tuned by the worse one');
  // The same discriminator foveation uses, and for the same stated reason: behaviour varies
  // with the BROWSER, and a model string needs a new entry per headset.
  check('...on the same discriminator foveation already keys off',
    /_isQuestStandalone \? 0 : 1/.test(SRC));
  // AND THE OPTION MUST NOT CARRY ONE. queryNumber's own default made getPinchOn's `o` always
  // finite, so the per-runtime branch behind it would be dead code -- the bug this check exists
  // to stop coming back.
  check('...with the URL option carrying NO default, or the runtime never gets asked',
    /options\.pinchOn = queryNumber\(getVal\('pinchOn'\), -0\.010, 0\.050, undefined\);/.test(OPT),
    'a default here shadows the per-runtime one completely');
  // The slider displays what is IN FORCE; a literal would show a Quest's number on a Vision Pro.
  check('...and the settings slider reads the accessor rather than a second copy',
    /ui\.pinchOn \?\? opts\.pinchOn \?\? \(main\.getPinchOn \? main\.getPinchOn\(\) : 0\.022\)/.test(MM));
  check('...with Number.isFinite, so a deliberate 0 is not treated as unset',
    /if \(Number\.isFinite\(window\._pinchOn\)\) return window\._pinchOn;/.test(SRC),
    'a truthiness test would silently ignore the default value itself');
  check('...exposed as a hands-only settings slider, in millimetres',
    /<span class="mm-lbl">Pinch distance<\/span>/.test(MM)
      && /<div class="mm-row mm-hands-only">/.test(MM),
    'a controller has a physical trigger and no pinch to calibrate');
  check('...over a range that spans the measured populations',
    /options\.pinchOn = queryNumber\(getVal\('pinchOn'\), -0\.010, 0\.050,/.test(OPT),
    'a range stopping at 0.015 cannot express a working threshold for a Quest 2');
  check('...and the slider itself reaches that far',
    /<input type="range" id="mm-pinch-on" min="-10" max="50" step="1"/.test(MM),
    'a setting the UI cannot express is a setting only the console has');
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
  // AN ANALOG THRESHOLD IS FOR AN ANALOG TRIGGER. Measured on Galaxy XR, a hand's trigger value
  // is a continuous hand-closure signal idling at 0.2-0.5 with the runtime's own pressed flag
  // reading UP throughout: "trig=up/0.41 pressed=true". The Schmitt latches at 0.10 and releases
  // at 0.04, which that signal never reaches — so one pinch latched the press on permanently.
  // Replaying matt's capture: the Schmitt fires on 14 of 18 frames, the flag on 1.
  check('a hand press uses the runtime\u2019s gesture boolean, not an analog threshold',
    /\? \(_handSrc\s*\n\s*\? !!_trigger\.pressed/.test(SRC),
    'a value that rests above the release threshold can never let go');
  check('...while a controller keeps its Schmitt trigger',
    /: \(_trigger\.pressed \|\| \(this\._vrTrigHeld\[_hand\] \? _tv > 0\.04 : _tv > 0\.10\)\)\)/.test(SRC),
    'a physical trigger rests at 0 and a light press must still count');
  check('...and sculpting applies the same exception',
    /const _handPress = this\._isHandSource\(source\) && !!\(buttons && buttons\[0\] && buttons\[0\]\.pressed\);/.test(SRC),
    'a stuck press on the sculpt path is a stroke that never ends');

  // A HAND IS NOT ALWAYS AN XRHand. Measured on Galaxy XR: xrHand=false, joints=0, gripSpace=true,
  // a 5-BUTTON gamepad, profiles "generic-hand-select-grasp, generic-hand-select,
  // generic-fixed-hand". The runtime recognises the gestures itself and hands us buttons — so
  // its hand sources were claimed by the controller test and the hands-only UI never appeared.
  check('a hand is identified by profile, not only by XRHand',
    /_isHandSource\(src\) \{/.test(SRC)
      && /p\.startsWith\('generic-hand'\) \|\| p === 'generic-fixed-hand'/.test(SRC),
    'Galaxy XR hands carry five buttons and no joints; !!source.hand misses them entirely');
  check('...and a hand never counts as a controller, however many buttons it carries',
    /if \(this\._isHandSource\(s\)\) \{ anyHand = true; continue; \}/.test(SRC),
    'counting its five buttons as a controller is exactly what kept the menus away');

  // PRESENT IS NOT IN USE — but SILENCE IS NOT USE EITHER, and that was the harder half. Hands
  // are reported the whole time on both runtimes, so their presence proves nothing; a connected
  // controller proves you picked one up. The tie therefore goes to the controller, and one pinch
  // takes it back.
  check('an unused controller holds the session against an unused hand',
    /return false;\s*\n  \}\s*\n\s*\/\/ A BUTTON YOU LOOK AT/.test(SRC)
      && !/_handsOnlyIdleMs/.test(SRC),
    'a timer read a silence as a decision and flipped the menus while matt held the controllers');
  check('...while a hand that IS used wins immediately',
    /if \(this\._padOf\(s2\)\?\.buttons\?\.\[0\]\?\.pressed\) \{ this\._lastHandUse = now; break; \}/.test(SRC),
    'without this the only way back to the hands UI is unplugging a controller');
  check('...and a controller that disappears stops holding anything',
    /if \(!anyController\) return true;/.test(SRC),
    'put-down controllers power off and leave the list, which is the real put-down signal');
  check('...counting both buttons and thumbsticks as use',
    /const moved   = \(pad\.axes \|\| \[\]\)\.some\(\(a\) => Math\.abs\(a\) > 0\.2\);/.test(SRC),
    'a stick-only interaction would otherwise look idle and steal the menus mid-use');
  check('...with the controller clock starting when a pad is first SEEN, not at zero',
    /if \(this\._lastControllerUse === undefined\) this\._lastControllerUse = now;/.test(SRC),
    'from zero, the most-recent-use comparison treats an untouched controller as ancient');
  check('...and never without hands, however idle the controllers are',
    /if \(!anyHand\) return false;/.test(SRC),
    'idle controllers and no hands is just a paused user');
  check('...while a session with no CONTROLLER at all qualifies immediately',
    /if \(!anyController\) return true;/.test(SRC),
    'visionOS has nothing to go idle, so waiting out a timer there would delay every menu');
  check('the panel priming re-arms on the way out, not once per session',
    /if \(!want\) this\._handsUiPrimed = false;/.test(SRC),
    'putting the controllers down a second time is equally a moment with no button to press');

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

  // ── drag the panel to scroll it ───────────────────────────────────────────
  // A hand has no thumbstick and the scrollbar is a few pixels wide.
  check('a drag on the panel body scrolls it',
    /this\._dragScroll = \{ el: sc, y0: absY, top0: sc\.scrollTop, armed: false \};/.test(HVP)
      && /d\.el\.scrollTop = Math\.max\(0, Math\.min\(span, d\.top0 - \(absY - d\.y0\)\)\);/.test(HVP),
    'the narrow scrollbar is the only scroll route a hand has without this');
  // FROM ANYWHERE, INCLUDING A BUTTON. Measured across the main panel: every sampled point
  // except the section headers is a button, so a drag that refuses to start on a control cannot
  // start at all. Which means the VR click can no longer fire on the press.
  check('a VR click waits for the release rather than firing on the press',
    /this\._pendingClick = \{ target, x: absX, y: absY \};/.test(HVP)
      && /if \(pc && !drag\) pc\.target\.dispatchEvent\(/.test(HVP),
    'a drag beginning on a button would otherwise have pressed it on the way down');
  // ONE ARBITER. The click had its own threshold, tested independently of whether the scroll had
  // engaged, so any drift past 6px killed the press while nothing scrolled — matt: "its
  // impossible to click any buttons, the tiniest drift is interpreted as a scroll". The tap now
  // dies only when the scroll WINS, which is the ordinary touch-slop arrangement.
  check('the click is cancelled by the scroll arming, not by a threshold of its own',
    !/Math\.abs\(absY - pc\.y\) >= min/.test(HVP)
      && /d\.armed = true;[\s\S]{0,400}?this\._pendingClick = null;/.test(HVP),
    'two independent thresholds means the stricter one silently owns the gesture');
  check('...with a slop an unbraced arm can actually hold',
    /const min = window\._panelDragScrollMin \?\? 18;/.test(HVP),
    'measured behaviour: 6px is inside a held pinch\u2019s tremor at arm\u2019s length');
  check('...measured vertically only, so sideways drift never costs a click',
    /const dy = absY - d\.y0;[\s\S]{0,400}?if \(Math\.abs\(dy\) < min\) return;/.test(HVP),
    'a scroll is a vertical gesture and horizontal wander is not evidence of one');
  check('...and cancelled INSIDE the scroll branch, which returns before that code',
    /d\.top0 = d\.el\.scrollTop;\s*\n(\s*\/\/[^\n]*\n)*\s*this\._pendingClick = null;/.test(HVP),
    'measured: the drag scrolled the panel and clicked the button, because the cancel was unreachable');
  check('...firing on the PRESS target, not wherever the release landed',
    /pc\.target\.dispatchEvent\(/.test(HVP),
    'a hand that slips onto the next button between press and release must not press that one');
  check('...with the old behaviour reachable in-session if it feels worse',
    /if \(window\._vrClickOnPress === true\) \{/.test(HVP),
    'this changes the feel of every button in VR and must be revertible without a reload');
  // THE MOVES HAVE TO REACH THE DISPATCH. onVRMove only forwarded a pointermove when a SLIDER
  // owned the press — everything else there is hover, deliberately, because a pointermove into
  // the offscreen DOM activates :hover and costs a full rasterisation. So drag-to-scroll passed
  // every desktop test (which called _vrDispatch directly) and did nothing whatever on device.
  check('a live scroll drag forwards its moves to the dispatch',
    /if \(this\._sliderDragTarget \|\| this\._dragScroll\) \{\s*\n\s*this\._vrDispatch\('pointermove', uv, 1, true\);/.test(HVP),
    'without this the drag state is created on press and never hears about the movement');
  check('...and hover-only moves still do NOT, which is the expensive path',
    /this\._showHover\(uv\);/.test(HVP)
      && !/this\._vrDispatch\('pointermove', uv, 0, true\);\s*\n\s*this\._hoverHand/.test(HVP),
    'a pointermove per frame into the DOM is a full rasterisation per frame');
  check('...with a trace that names which of the three stopped it',
    /if \(window\._dragTrace\) this\._dragTraceOut\(type, el, absX, absY\);/.test(HVP)
      && /scrollable=' \+ \(sc \? \(sc\.id \|\| sc\.className \|\| 'yes'\) : 'NONE'\)/.test(HVP),
    'move-never-arrived, nothing-scrollable and deadzone-never-crossed look identical from inside');
  check('...and only writes about a move once a drag is live',
    /if \(type === 'pointermove' && !this\._dragScroll\) return;   \/\/ hover noise/.test(HVP),
    'a line per hover frame at 70Hz is unreadable and changes the timing it reports');

  check('...and only where there is something to scroll',
    /if \(sc && sc\.scrollHeight > sc\.clientHeight \+ 1\) \{/.test(HVP),
    'a short panel would otherwise swallow every press on its background');
  check('...with a deadzone before it engages at all',
    /const min = window\._panelDragScrollMin \?\? 18;/.test(HVP)
      && /if \(Math\.abs\(dy\) < min\) return;/.test(HVP),
    'an unbraced hand wanders while it holds a pinch, and the panel creeps');
  check('...that re-bases rather than jumping when it does',
    /d\.armed = true;\s*\n\s*d\.y0 = absY;\s*\n\s*d\.top0 = d\.el\.scrollTop;/.test(HVP),
    'applying the deadzone as displacement makes the content leap on the first real frame');
  check('...released on pointerup and on a ray that leaves mid-drag',
    /if \(type === 'pointerup' && this\._dragScroll\) \{ this\._dragScroll = null; this\.markDirty\(\); \}/.test(HVP)
      && /if \(this\._dragScroll\) \{ this\._dragScroll = null; this\.markDirty\(\); \}/.test(HVP),
    'a stuck drag anchor jumps the content the moment the ray comes back');
  check('...and rate-limits the rasterisation, as the thumbstick path does',
    /if \(now - \(this\._scrollRasterTs \|\| 0\) > 120\) \{ this\._scrollRasterTs = now; this\.markDirty\(\); \}[\s\S]{0,200}?this\._scrollStopTimer = setTimeout/.test(HVP),
    'a full SVG rasterisation per frame of a continuous scroll is the framerate');

  // ── the frame and the offset are chosen by ONE decision ───────────────────
  // Galaxy XR with hand tracking permitted connects FOUR sources, two of them claiming 'left'.
  // three poses each controller object from the one source at its index, so whichever source
  // owned the slot decided the FRAME — while _handsOnlyMode() decided the PLACEMENT. Two
  // mechanisms answering the same question: the controller slot applied in a hand grip frame is
  // menus through the controller facing the floor, and the hand placement in a controller grip
  // frame is menus facing the sky.
  check('both input kinds are remembered rather than competing for one slot',
    /this\._srcObjs\[_isHand \? 'hand' : 'ctl'\]\[hand\] =\s*\n\s*\{ ctl: controller, grip: this\._renderer\.xr\.getControllerGrip\(i\) \};/.test(SRC),
    'last-to-connect-wins makes the frame a race, and the placement does not know who won');
  check('...and the active one is selected from the same decision as the placement',
    /const wantHand = this\._handsOnlyMode\(\);/.test(SRC)
      && /const pick = \(wantHand \? \(S\.hand\[h\] \|\| S\.ctl\[h\]\) : \(S\.ctl\[h\] \|\| S\.hand\[h\]\)\) \|\| null;/.test(SRC),
    'a placement measured in one frame and applied in another is wrong by whatever they differ by');
  check('...falling back to the other kind when there is only one',
    /S\.hand\[h\] \|\| S\.ctl\[h\]/.test(SRC) && /S\.ctl\[h\] \|\| S\.hand\[h\]/.test(SRC),
    'visionOS has no controllers and a controller session has no hands driving');
  check('...re-derived every frame, not only at connect time',
    /if \(!_anyTransient\) this\._sysPinchActive = false;\s*\n[\s\S]{0,220}?this\._applyActiveInputObjects\(\);/.test(SRC),
    'which input is driving changes mid-session and the objects have to follow it');
  check('...and the kind NOT chosen is hidden, not merely unreferenced',
    /for \(const other of \[S\.hand\[h\], S\.ctl\[h\]\]\) \{[\s\S]{0,200}?other\.ctl\.visible  = false;[\s\S]{0,80}?other\.grip\.visible = false;/.test(SRC),
    'the other object still has a spike and a ray on it, and the runtime still poses it');
  check('...and a disconnect forgets only the entry that object was',
    /if \(e && e\.ctl === controller\) delete this\._srcObjs\[kind\]\[hand\];/.test(SRC),
    'clearing by handedness alone drops the other kind with it');

  // ── the hand pose writes the CONTROLLER object, so it must not run in controller mode ──
  check('the hand pose runs only while the hands are the input',
    /const _handsDrive = this\._handsOnlyMode\(\);\s*\n\s*if \(_handsDrive\) \{[\s\S]{0,240}?this\._applyHandRayCorrection\(_s, frame, refSpace\);/.test(SRC),
    'Galaxy XR reports joints while you hold the controllers, so this overwrote the grip pose');
  check('...and the fingertip dots are turned off rather than merely abandoned',
    /\} else \{\s*\n\s*this\._hideHandDots\(\);\s*\n\s*\}/.test(SRC)
      && /_hideHandDots\(\) \{/.test(SRC),
    'a path that stops running leaves whatever it last drew hanging in the air');
  check('...through the same helper the visibility flag uses',
    /if \(!on\) \{ this\._hideHandDots\(\); return; \}/.test(SRC),
    'two ways to hide the same dots drift apart');

  // ── the smooth modifier qualifies an action rather than being one ─────────
  // REPOINTED 2026-09-17: the dispatch stopped re-deriving the mode and now reads the per-frame
  // latch (Scene._updateSmoothModeLatch), so the condition is `_domPressed && this._smoothMode`.
  // The INVARIANT is unchanged and is the thing asserted -- the stroke needs the dominant trigger
  // as well as the off-hand one, or a lone left pinch starts smoothing on hands. The menu guard
  // moved into the latch with the rest of the rule, and is per-hand there.
  check('the smooth override needs the dominant trigger as well as the offhand one',
    /if \(_domPressed && this\._smoothMode\) \{/.test(SRC),
    'on hands the offhand pinch alone swapped the tool to Smooth and started smoothing');
  check('...with the dominant press read through the same accessor as every other press',
    /if \(src\.handedness === this\._dominantHand && this\._padOf\(src\)\?\.buttons\?\.\[0\]\?\.pressed\) \{/.test(SRC),
    'src.gamepad directly is how hands got missed everywhere else in this file');

  // ...AND THE SECOND TRIGGER THE GATE WAS LOOKING FOR WAS BEING FABRICATED. A transient-pointer
  // source has handedness 'none', so a platform pinch was credited to the dominant hand whichever
  // hand made it — an offhand pinch arrived as a dominant press and armed the pair by itself.
  check('a platform pinch is refused when our own joints say the other hand made it',
    /const _otherOwnsIt = Number\.isFinite\(_dg\) && Number\.isFinite\(_og\) && _og < _dg - _margin;/.test(SRC)
      && /if \(!_otherOwnsIt\) isPinching = true;/.test(SRC),
    'crediting the dominant hand unconditionally turns an offhand pinch into a dominant press');
  check('...by comparing the two hands rather than thresholding one',
    /this\._pinchGap\[hKey\] = pinchGap;/.test(SRC),
    'absolute gaps differ per device by more than this margin does');
  check('...and falls through to the old behaviour with no measurement to go on',
    /Number\.isFinite\(_dg\) && Number\.isFinite\(_og\)/.test(SRC),
    'catching a pinch our own thresholds missed is the entire point of the feature');

  // ── foveation is off where it is not gaze-driven ──────────────────────────
  // three defaults it to maximum and this app never touched it. On an eye-tracked headset the
  // sharp region follows your gaze and you never see it; on a Quest it is fixed and radial, and
  // this app's hands and wrist panels live in the part of the field it throws away.
  // ── what the compositor does with our frame, recorded once ────────────────
  // ignoreDepthValues true (visionOS, 2026-09-15) means the hand punch-through ignores our depth
  // entirely, so no material flag can change the layering. The state is worth recording because
  // the symptom came and went between reloads.
  check('the compositor state is recorded at session start',
    /window\._xrComposite = \{[\s\S]{0,320}?ignoreDepthValues: _bl \? _bl\.ignoreDepthValues : null,/.test(SRC),
    'a headset console is a 5-second window; this is the line worth having afterwards');
  check('...including the blend mode, which is the state most likely to differ',
    /blend: session\.environmentBlendMode,/.test(SRC),
    "'alpha-blend' passthrough and 'opaque' immersive are the two runs that behaved differently");
  check('...on window as well as in the log, and never throwing into the session start',
    /window\._xrComposite = /.test(SRC)
      && /catch \(e\) \{ console\.warn\('\[XR\] reading the compositor state failed', e\); \}/.test(SRC),
    'a diagnostic that can break entering VR is worse than no diagnostic');

  check('the session sets foveation explicitly rather than taking the default',
    /this\._renderer\.xr\.setFoveation\(_fov\);/.test(SRC),
    "three's default is 1.0, which is maximum, which is the pixellated periphery");
  check('...off on a fixed-foveation runtime, unchanged elsewhere',
    /\(this\._isQuestStandalone \? 0 : 1\)/.test(SRC),
    'one value for every headset either wastes fill rate or blurs the part you look at');
  // The flag it keys on is a BROWSER test, not a model test — every runtime that reaches us
  // through Oculus Browser gets fixed foveation in WebXR, the eye-tracked Quest Pro included.
  check('...keyed on the browser, not on a headset model string',
    /this\._isQuestStandalone = \/OculusBrowser\/\.test\(navigator\.userAgent\);/.test(SRC),
    'a model list needs a new string per device and gets the Quest Pro wrong either way');
  check('...and overridable in both directions, since foveation buys back fill rate',
    /Number\.isFinite\(window\._foveation\)/.test(SRC)
      && /options\.foveation = queryNumber\(getVal\('foveation'\), 0, 1, undefined\);/.test(OPT),
    'a Quest is short of exactly the fill rate this spends, so it has to be a trade');

  // ── the fist reaches something on a pad that has no grasp ─────────────────
  check('our own fist fills in until the runtime shows it has a grasp of its own',
    /const _ownFist = !grasp && !this\._rtGraspSeen\[_hk\]\s*\n\s*&& !!\(this\._pinchLatch && this\._pinchLatch\[_hk\]\?\.fist\);/.test(SRC)
      && /view\.buttons\[1\]\.pressed = grasp \|\| _ownFist;/.test(SRC),
    'without it a fist that latches perfectly well reaches nothing at all');
  // MEASURED, after a first attempt gated on pad LENGTH missed: a Quest 2 hand pad is ten
  // buttons long with only index 0 ever pressed, so "short pad" is not the tell. Whether
  // anything above select has ever pressed is.
  check('...decided by what the pad has ever DONE, not how long it is',
    !/pad\.buttons\.length < \d/.test(SRC) && /if \(grasp\) this\._rtGraspSeen\[_hk\] = true;/.test(SRC),
    'a runtime pads its button list out to whatever length it likes');
  check('...and remembered, since an open hand looks exactly like an absent grasp',
    /if \(!this\._rtGraspSeen\) this\._rtGraspSeen = \{\};/.test(SRC),
    'deciding per frame hands the fist back to us every time the runtime relaxes its grip');
  check('...with the value derived from the decision, as the select is',
    /view\.buttons\[1\]\.value   = view\.buttons\[1\]\.pressed \? 1 : 0;/.test(SRC),
    'consumers read value as often as pressed and the two must agree');

  // ── the ray origin does not move because you pinched ───────────────────────
  check('the ray origin sits at a smoothed reach along the anatomical direction',
    /this\._jrT\.subVectors\(this\._jrA, this\._jrB\)\.normalize\(\)\.multiplyScalar\(_rsm\)\.add\(this\._jrB\);/.test(SRC)
      && /return \{ origin: this\._jrT, quaternion: this\._jrQ \};/.test(SRC),
    'the tips are what the gesture moves, so an origin on them travels through every pinch');
  check('...smoothed hard, since a hand does not change size while you use it',
    /const _rk = window\._handReachSmooth \?\? 0\.02;/.test(SRC),
    'a light filter passes most of the gesture travel straight through');
  check('...and the raw tip midpoint no longer overwrites it',
    /if \(!_jointRay && tp && ip\) \{/.test(SRC),
    'the override ran after the construction, so the stable origin could never take effect');

  // ...AND THE SAME 'none' HANDEDNESS REACHES THE CURSOR LOOP, where every `isLeft ? … : …`
  // silently means "left or right". The transient source took the RIGHT cursor, failed the
  // active-hand test, and hid it — so holding an offhand pinch for alt-smooth blanked the brush
  // sphere on the hand actually sculpting.
  check('an unhanded source owns no cursor group',
    /const _handed = source\.handedness === 'left' \|\| source\.handedness === 'right';/.test(SRC)
      && /const cursorGroup = !_handed \? null : \(isLeft \? this\._vrCursorLeft : this\._vrCursorRight\);/.test(SRC),
    "a transient pinch source is not the right hand, and hiding the right hand's sphere is the bug");
  check('...nor a controller group, which is what drops it from the loop',
    /const controllerGroup = !_handed \? null : \(isLeft \? this\._vrControllerLeft : this\._vrControllerRight\);/.test(SRC),
    'without this the source runs the whole cursor body against the right hand\u2019s objects');
  check('...and the guard still hides a cursor whose controller is genuinely unmapped',
    /if \(!controllerGroup\) \{ if \(cursorGroup\) cursorGroup\.visible = false; continue; \}/.test(SRC),
    'a handed source with no controller is a real unmapped-handedness case and must still hide');
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
  check('...found by profile, so a jointless hand still qualifies',
    /if \(sc\.handedness === dom && this\._isHandSource\(sc\)\) domSrc = sc;/.test(SRC),
    'requiring source.hand made the grab silently do nothing on Galaxy XR, every frame');
  check('...read from the wrist JOINT where one exists',
    /const wj = domSrc\.hand && domSrc\.hand\.get\('wrist'\);/.test(SRC),
    'driving the drag with the grip feeds the correction being measured back into itself');
  check('...and falling back to the grip pose where there are none',
    /if \(!wp && domSrc\.gripSpace\) wp = frame\.getPose\(domSrc\.gripSpace, refSpace\);/.test(SRC),
    'Galaxy XR hands have no joints at all — a joint-only read cannot place anything there');
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

  // console.log output never reaches the remote console on Galaxy XR, so every probe written
  // this session was invisible there. Returned values do arrive.
  check('the menu trace is also readable as a value, not only as a log',
    /_traceOut\(line\) \{/.test(SRC) && /window\._menuLog\.push\(t\);/.test(SRC),
    'a trace that can only be logged is no trace at all on a device that swallows logs');
  check('...capped, since it is written from the frame loop',
    /if \(window\._menuLog\.length > 60\) window\._menuLog\.shift\(\);/.test(SRC),
    'an unbounded array written per frame grows for the life of the session');
  check('...and every trace line goes through it',
    !/console\.log\('\[menu\] /.test(SRC),
    'one line left logging directly is the one line you need and cannot see');

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
      && /\{ p: \[0\.0001, -0\.0017, 0\.0253\], r: \[22\.9, -2\.8, -81\.4\], sy: -1 \}/.test(SRC),
    'measured on device 2026-09-13 — three derivations from a description failed first');

  // TWO frames, two measurements. visionOS hands have no gripSpace so the app synthesises a wrist
  // -joint anchor; Galaxy XR hands are controller-shaped and bring a real grip. Neither number is
  // derivable from the other, so both are measured and the runtime picks.
  check('the grip-frame placement is measured separately',
    /static get HAND_GRIP_PANEL\(\)/.test(SRC)
      && /\{ p: \[-0\.0135, -0\.0421, -0\.0713\], r: \[-1\.4, 28\.2, -15\.2\], sy: 1 \}/.test(SRC),
    'measured on Galaxy XR 2026-09-14; the wrist-joint number means nothing in a grip frame');
  check('...chosen by where the anchor pose came from, not by device sniffing',
    /const fromWrist = nonDom === 'Left' \? this\._gripSpaceIsWristLeft : this\._gripSpaceIsWristRight;/.test(SRC),
    'the wrist substitution already records when it ran — that is the honest signal');
  check('...off the NON-dominant hand, which is the one wearing the panel',
    /const nonDom = this\._dominantHand === 'left' \? 'Right' : 'Left';/.test(SRC));
  // Defining the chooser is not the same as using it: a mount that reads one constant directly
  // looks entirely correct and silently gives every runtime the visionOS number.
  // THE MIRROR SIGN TRAVELS WITH THE NUMBER. A panel mesh is built at scale.y=-1; placement mode
  // decomposes a matrix and hands it back at +1. The visionOS number has the half-turn correction
  // folded in and is right at -1; the Galaxy XR number was grabbed raw and is right at +1. A
  // single normalised sign here is correct for exactly one runtime and upside down in the other.
  check('the hands slot takes its mirror sign from the same constant as the rotation',
    /if \(window\._panelKeepScale !== true\) _p\.mesh\.scale\.set\(1, _hp\.sy, 1\);/.test(SRC),
    'one hardcoded sign renders one of the two runtimes flipped and back-facing');
  check('...and the two constants disagree about it, which is the point',
    /r: \[22\.9, -2\.8, -81\.4\], sy: -1/.test(SRC) && /r: \[-1\.4, 28\.2, -15\.2\], sy: 1/.test(SRC),
    'equal signs mean the field is decorative and one runtime is still wrong');
  // The controller slot now restores the mirror on the way out (see below), but must otherwise
  // keep the shared lift/yaw it was tuned with.
  // ...AND ITS PITCH, WHICH IS THE PART THAT WAS MISSED. Every wrist panel is constructed with
  // rotation (-90, yaw, 0); the -90 about X lies it back along the controller. The slot has to
  // write whole vectors (the hands slot writes all three components and they must be undone) and
  // it wrote a bare 0 for X, wiping that pitch every frame — menus facing the floor.
  check('...and the controller slot keeps its own lift, yaw AND pitch',
    /_p\.mesh\.position\.set\(0, _wy, 0\);[\s\S]{0,900}?_p\.mesh\.rotation\.set\(wristPanelPitch\(\), _wYaw, 0\);/.test(SRC),
    'a bare 0 for the X rotation is not "no pitch", it is the wrong pitch');
  check('...from the same constant the panels are built with',
    /export const WRIST_PANEL_PITCH = -Math\.PI \/ 2;/.test(HVP)
      && /this\.mesh\.rotation\.set\(wristPanelPitch\(\), wristPanelYaw\(\), 0\);/.test(MP)
      && /this\.mesh\.rotation\.set\(wristPanelPitch\(\), wristPanelYaw\(\), 0\);/.test(MM),
    'a number in three constructors that the code overwriting it has never heard of');
  check('...and no panel still hardcodes the raw literal',
    !/rotation\.set\(-Math\.PI \/ 2, wristPanelYaw\(\), 0\)/.test(MP + MM + HVP),
    'one panel left behind drifts the moment the constant changes');

  check('...and the panel mount actually asks it, rather than naming a constant',
    /const _hp = this\._handPanelPlacement\(\), _D = Math\.PI \/ 180;[\s\S]{0,200}?_p\.mesh\.rotation\.set/.test(SRC),
    'a hardcoded constant at the point of use makes the chooser decorative');
  check('...and both are frozen singletons, not rebuilt per frame',
    /Scene\._HWP \|\| \(Scene\._HWP = Object\.freeze\(/.test(SRC)
      && /Scene\._HGP \|\| \(Scene\._HGP = Object\.freeze\(/.test(SRC),
    'the mount reads these every frame, and identity is what lets a test assert which is in use');
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
  // Position was overwritten from the joints; rotation was inherited from whatever three last
  // wrote to the controller object. When three has not posed it this frame, only half the
  // transform is live — the spike translates with the hand and does not turn.
  // EVERY orientation bug in this file was the same shape: a runtime hands us a frame, we guess
  // its convention, and measure a correction per device. With joints there is nothing to guess —
  // matt's description of the ray he wanted is itself a construction from two joint positions.
  check('the ray is built from joint anatomy when joints exist',
    /_handRayFromJoints\(source, frame, refSpace\) \{/.test(SRC)
      && /const _jointRay = \(window\._handRayFromJoints !== false\)/.test(SRC),
    'a runtime frame needs a per-device constant; two joints need none');
  check('...origin at the pinch point, because that IS the click',
    /this\._jrA\.set\(\(tx \+ ix\) \/ 2, \(ty \+ iy\) \/ 2, \(tz \+ iz\) \/ 2\);/.test(SRC));
  check('...aimed from the metacarpal bases toward it',
    /this\._jrM\.lookAt\(this\._jrB, this\._jrA, this\._jrUp\);/.test(SRC),
    'the axis the hand already makes when you pinch and point');
  check('...with the roll defined by the palm normal rather than left to lookAt',
    /this\._jrUp\.crossVectors\(this\._jrU, this\._jrV\)\.normalize\(\);/.test(SRC),
    'an undefined up makes the spike roll unpredictably as the hand turns');
  check('...returning null on degenerate joints instead of NaN',
    /if \(this\._jrA\.distanceToSquared\(this\._jrB\) < 1e-8\) return null;/.test(SRC),
    'coincident joints would make lookAt produce a NaN quaternion');
  check('...and the runtime-frame path still runs when there are no joints',
    /const _poseSpace = _jointRay \? null : \(source\.gripSpace \|\| source\.targetRaySpace\);/.test(SRC),
    'a jointless runtime must still get a ray');

  // The spike translated and would not rotate while the Move tool's 6DOF was perfect. Move reads
  // gripSpace; the spike read targetRaySpace — and Galaxy XR hands advertise GENERIC-FIXED-HAND,
  // a ray that is declared not to track hand orientation. Nothing was broken; we read the pose
  // that does not turn.
  check('the runtime-frame fallback prefers the GRIP, as every working 6DOF path does',
    /source\.gripSpace \|\| source\.targetRaySpace\);/.test(SRC),
    'a fixed target ray does not turn with the hand, and says so in its profile');
  check('...falling back to the target ray where there is no grip',
    /if \(_poseSpace\) \{[\s\S]{0,140}?if \(_rp\) \{/.test(SRC),
    'visionOS hands carry no gripSpace and their target ray tracks properly');
  check('...read from the pose rather than inherited from the controller object',
    /this\._hrM\.fromArray\(_m\)\.decompose\(this\._hrTmpV, this\._hrQ, this\._hrTmpS\);/.test(SRC),
    'inheriting it assumes three posed that object this frame, and it may not have');

  check('...with the origin at the pinch point, not the fingertip',
    /this\._hrV\.set\(\(a\.x \+ b\.x\) \/ 2, \(a\.y \+ b\.y\) \/ 2, \(a\.z \+ b\.z\) \/ 2\);/.test(SRC),
    'aiming from anywhere but the click point means you press what you were not looking at');
  check('...pitched about the ray\u2019s own x, not a world axis',
    /this\._hrFix\.setFromAxisAngle\(\{ x: 1, y: 0, z: 0 \}, deg \* Math\.PI \/ 180\);/.test(SRC),
    'a world-space tilt changes meaning as you turn your wrist over');
  // +20 measured on Galaxy XR against the ANATOMICAL ray. The earlier -45 was measured against
  // visionOS's targetRaySpace, before the ray was rebuilt from joints — a construction that no
  // longer exists, so that number is stale rather than a second device's value.
  check('the pitch default is the value measured against the current construction',
    /options\.handRayPitch = queryNumber\(getVal\('handraypitch'\), -80, 80, 20\);/.test(OPT),
    'carrying a number measured against a construction that no longer exists is worse than one device');
  check('...with the option default owning it, not a call-site fallback',
    /this\._handStylus\('handRayPitch', 20\)/.test(SRC),
    'the option default outranks the fallback, so disagreeing values silently resolve to the option');
  check('...and range past it, since the measured value was its own old maximum',
    /min="-80" max="80"/.test(MM),
    'a setting whose correct value is its ceiling cannot be tuned in one direction');
  // The same signed pitch on both hands produced a left spike that was a COPY of the right
  // rather than its mirror: the pitch rotates about the ray frame's own X, and WebXR gives both
  // hands the SAME frame convention, so the anatomical meaning of +X flips and one sign tilts
  // both the same way in space. The same anatomical tilt needs opposite signs.
  check('the pitch is mirrored for the left hand',
    /const _mirror = \(source\.handedness === 'left' && window\._handRayMirror !== false\) \? -1 : 1;/.test(SRC),
    'one signed pitch copies the right spike onto the left instead of mirroring it');
  check('...applied to the shared default only, so an override stays literal',
    /const deg = Number\.isFinite\(_perHand\) \? _perHand : _base \* _mirror;/.test(SRC),
    'a signed override would mean the opposite of what was typed for one hand');
  check('each hand can override the shared pitch',
    /const _perHand = source\.handedness === 'left' \? window\._handRayPitchL : window\._handRayPitchR;/.test(SRC),
    'one number for both hands assumes a symmetry that has not been measured');
  check('...falling back to the shared default, so nothing changes until it is set',
    /Number\.isFinite\(_perHand\) \? _perHand : _base \* _mirror;/.test(SRC));
  check('...with the window override ranking above the saved setting',
    /Number\.isFinite\(window\._handRayPitch\)\s*\n\s*\? window\._handRayPitch\s*\n\s*: this\._handStylus\('handRayPitch', 20\);/.test(SRC),
    'a console trial must win, or tuning fights the slider silently');
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
    /if \(this\._handsOnlyMode\(\)\) \{[\s\S]{0,900}?const ks = _bigUp/.test(SRC),
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
    /if \(window\._sysPinch !== false && this\._sysPinchActive[\s\S]{0,520}?isPinching = true;/.test(SRC),
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
    /this\._traceOut\('TRIGGER ' \+ _hand/.test(SRC),
    'without it, pinches that miss entirely are invisible and the counts cannot be compared');

  // "Is it even seeing my hand" has to be answerable without a console.
  check('the fingertips are drawn',
    /_updateHandDots\(source, tp, ip\)/.test(SRC) && /_updateHandDots\(source, tp, ip\) \{/.test(SRC),
    'joint loss and a missed pinch are indistinguishable from inside the headset');
  check('...coloured from the SAME latch the trigger reads',
    /const pinching = !!this\._pinchLatch\?\.\[key\]\?\.pinch;/.test(SRC),
    'an indicator that recomputes the test confirms itself instead of the real signal');
  check('...drawn above the panels, or a dot inside a menu is invisible',
    /m\.renderOrder = VR_PANEL_RENDER_ORDER \+ 7;/.test(SRC));
  // Drawing on top at full opacity punches holes in whatever is being read underneath.
  check('...translucent, since they draw over menus',
    /opacity: window\._handDotOpacity \?\? 0\.45,/.test(SRC),
    'a dot that draws over a panel at full opacity hides the thing it is pointing at');
  check('...re-read each frame so the knob needs no reload',
    /m\.material\.opacity = window\._handDotOpacity \?\? 0\.45;/.test(SRC));
  check('...with the pinch state carried by COLOUR, not by alpha',
    /m\.material\.color\.setHex\(pinching \? 0x35ff6a : 0xffffff\);/.test(SRC),
    'two signals on one channel means neither can be read confidently');

  // The ray's intersection dot sat at 1001 against panels at 11000 — painted over by the one
  // surface whose intersection you most need to see.
  check('the ray reticle draws above the panels',
    /this\._bpReticle\.renderOrder = VR_PANEL_RENDER_ORDER \+ 8;/.test(SRC),
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
    /<button id="mm-mini-btn"/.test(MM) && /mm-show-mini/.test(MM),
    'a one-way swap strands you in the panel you swapped to');
  // IN THE HANDS-ONLY ROW, NOT THE MENUBAR. The menubar is six menu buttons and the pin, and at
  // 480px that already reaches the edge — a seventh button pushed the pin off the panel on
  // Vision Pro and half-covered it on Galaxy XR. The bottom row is hands-only already and has
  // the room, so the control lives there and the menubar is the same on both input kinds.
  check('...from the bottom row, which is where the room is',
    /<div id="mm-undo-row" class="mm-hands-only">[\s\S]{0,400}?<button id="mm-mini-btn"[\s\S]{0,80}?<\/div>/.test(MM),
    'the menubar has no space for it and the pin is what gets pushed out');
  // AND THE ROW MUST SURVIVE AN ENGINE THAT LAYS THE SAME LABELS OUT WIDER. matt: "it renders
  // differently on avp vs gxr". A flex item with nowrap text will not shrink below its content
  // unless min-width allows it, so without this the overflow goes to the one item that cannot
  // shrink — the pin — and pushes it off the panel.
  check('the menu buttons give up label width before the pin leaves the panel',
    /\.mm-menu-btn \{[\s\S]{0,700}?min-width: 0;\s*\n\s*overflow: hidden;/.test(MM),
    'nowrap text with auto min-width cannot shrink, so the fixed-width pin is what moves');
  check('...and the pin itself still refuses to shrink',
    /\.mm-pin-btn \{[\s\S]{0,400}?flex-shrink: 0;/.test(MM),
    'a squashed pin is a different bug, not a fix');

  // The wrist panel's swap made the same journey, and lands in the same corner: two swaps in
  // two panels should not be in two different places.
  check('the wrist panel swap sits in its hands-only bottom row',
    /<div id="mp-undo-row" class="mp-hands-only">[\s\S]{0,400}?<button id="mp-swap-btn"[\s\S]{0,80}?<\/div>/.test(MP),
    'beside the tool button it crowds the top of a panel that is mostly top');
  // The toprow BLOCK, not "anywhere between the toprow and a </div>" — a lazy [\s\S]*? happily
  // crosses the close tag and finds the button in the row below, which made this pass as a
  // false failure the first time it was written.
  check('...and no longer beside the tool button',
    !/mp-swap-btn/.test((MP.split('<div class="mp-toprow">')[1] || '').split('</div>')[0]),
    'two homes at once is two hit targets for the same action');

  // ── the rasteriser measures the CLIENT box ─────────────────────────────────
  // A real border is outside it, so the bottom and right of the content go with it.
  check('the plane is measured with the box the rasteriser rasterises',
    /export function panelPixelSize\(el, fallbackW, fallbackH\) \{\s*\n\s*const w = el\.clientWidth  \|\| el\.offsetWidth  \|\| fallbackW;/.test(HVP)
      && /const h = el\.clientHeight \|\| el\.offsetHeight \|\| fallbackH;/.test(HVP),
    'offsetHeight includes a border the SVG viewport does not, so plane and bitmap differ');
  check('...at creation, at resize, and in the aspect check alike',
    (HVP.match(/panelPixelSize\(el, /g) || []).length >= 3,
    'one of the three measuring a different box re-introduces the mismatch it fixes');
  check('the main panel frames itself with an inset shadow, not a border',
    /box-shadow: inset 0 0 0 2px #585b70;/.test(MM) && !/#mm-root \{[\s\S]{0,600}?\n  border: 2px solid/.test(MM),
    'a border puts content outside the client box, where the rasteriser cuts it off');
  check('...and its height is then exactly its content',
    /root\.style\.height = \(MM_MENUBAR_H \+ MM_BODY_H\) \+ 'px';/.test(MM),
    'the +4 was the border allowance; keeping it leaves 4px of dead panel below the content');
  check('the wrist panel frames itself the same way',
    /box-shadow: inset 0 0 0 1px #313244;/.test(MP) && !/#mp-root \{[\s\S]{0,400}?\n  border: 1px solid/.test(MP),
    'the same cut, one pixel at a time');

  check('...and the menubar is left with the pin as its only right-hand button',
    !/id="mm-menubar"[\s\S]*?id="mm-mini-btn"[\s\S]*?<div id="mm-body">/.test(MM),
    'a hands-only button back in the menubar re-crowds the row it was moved out of');
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
  // Leaving hands mode has to undo what entering it did, or the panel is left un-mirrored in a
  // slot that assumes it is mirrored — the menus swap and come up wrong.
  check('the panel mirror is restored when leaving hands mode',
    /if \(_p\.mesh\.scale\.y > 0\) _p\.mesh\.scale\.set\(1, -1, 1\);/.test(SRC),
    'scale.y = -1 is what a panel is built with; the hands slot normalises it and must put it back');
  // The hands slot writes all three components; this branch only ever set .y, so x and z kept
  // the hand values and the panel came back at the hand's angle in a controller slot.
  check('...along with every component the hands slot writes',
    /_p\.mesh\.position\.set\(0, _wy, 0\);[\s\S]{0,900}?_p\.mesh\.rotation\.set\(wristPanelPitch\(\), _wYaw, 0\);/.test(SRC),
    'resetting only the components this slot sets leaves the others carrying the hand placement');
  // The idle window stops a still controller stealing the UI; it should not make someone who has
  // visibly started using their hands wait it out.
  // Returning true only WHILE a hand button is pressed oscillated — true during a pinch, false
  // between pinches — so the class and the placement latched and unlatched at gesture rate.
  check('a moment of proof is REMEMBERED, not merely noticed',
    /\{ this\._lastHandUse = now; break; \}/.test(SRC),
    'a rule that is true only during the gesture flickers between gestures');
  check('...and whichever input was used most recently wins',
    /if \(Number\.isFinite\(this\._lastHandUse\) && this\._lastHandUse >= this\._lastControllerUse\) return true;/.test(SRC),
    'symmetric, so neither input can be stolen by the other merely sitting there');

  check('...and the class is only re-applied when it changes',
    /if \(want === this\._handsUiClassApplied\) return;/.test(SRC),
    'a markDirty every frame re-rasterises the panel for nothing');

  // The latch fired on the frame hands-only first became true, which at session start can be
  // before the panels have elements — so the class went nowhere and the latch said "done".
  check('...but does not latch before the panels exist to receive it',
    /const panels = \[this\._miniPanel, this\._mainMenuPanel\]\.filter\(\(p\) => p && p\._element\);\s*\n\s*if \(!panels\.length\) return;/.test(SRC),
    'latching on a frame with no panels leaves the controller layout for the whole session');
  check('...and flushes the repaint rather than queueing it',
    /if \(p\.flushPaint\) p\.flushPaint\(\); else p\.markDirty\?\.\(\);/.test(SRC),
    'a queued repaint superseded by the panel\u2019s own first paint leaves the stale texture up');
  // REPAINT IS NOT REBUILD. The class updates the DOM at once — the hover quad measured the live
  // DOM and was laid out for the hands panel — while the rasterised texture stayed on the
  // controller layout, because the polyfill caches against content and a class that only changes
  // which rules apply does not move that cache.
  check('...having asked the panel to rebuild its content first',
    /p\.syncFromState\?\.\(\);\s*\n\s*p\._rebuildContent\?\.\(\);/.test(SRC),
    'a hover highlight in the right places over a picture of the wrong panel');
  check('...before the flush, not after it',
    SRC.indexOf('p._rebuildContent?.();') < SRC.indexOf('if (p.flushPaint) p.flushPaint();'),
    'flushing a texture and then changing the content repaints the old one');
  // AND KEEPS ASKING. The rasteriser is async — the polyfill awaits an SVG build and an image
  // decode, while captureElementImage returns the canvas recorded so far — so the capture taken
  // straight after a class change is the bitmap from before it, and it clears _dirty on the way
  // past. Measured on device as cls:'hands-only', mounted:true, dirty:false, wrong texture.
  // THE CLASS CHANGES THE PANEL'S SIZE. Measured in a desktop repro: the wrist panel goes from
  // 203px tall to 245px when the hands-only row joins the flow. That needs _needsResize for the
  // MESH (the plane otherwise keeps the old aspect and stretches the new texture onto it), and
  // _needsResize is also the only path that bypasses the 200ms ambient rate limiter. It is why
  // opening the tool selector always fixed this and nothing else did — that rebuild sets the
  // same flag.
  check('the transition declares the resize it actually is',
    /p\._needsResize = true;/.test(SRC),
    'a politely-requested repaint is one the rate limiter may simply drop');
  check('...and drops any live slider drag, which blocks repaints outright',
    /p\._sliderDragTarget = null;/.test(SRC)
      && /if \(this\._dirty && !this\._sliderDragTarget\) \{/.test(HVP),
    'update() refuses to repaint while a drag is live, and the input just changed under it');
  check('...and the repaint is re-requested afterwards, in TIME not frames',
    /this\._handsRepaintUntil = performance\.now\(\) \+ \(window\._handsRepaintMs \?\? 1000\);/.test(SRC)
      && /if \(this\._handsRepaintUntil && performance\.now\(\) < this\._handsRepaintUntil\) \{[\s\S]{0,220}?p\.markDirty\?\.\(\);/.test(SRC),
    'repaints are throttled to one per 200ms, so a handful of frames expires before any paint');
  check('...long enough to outlast that throttle by several windows',
    /PAINT_MIN_MS = 200;/.test(INS) && (1000 > 200 * 3),
    'one window is a coin flip on whether the single permitted paint is the one that lands');
  check('...and dirty is re-set AFTER the flush, which clears it',
    /if \(p\.flushPaint\) p\.flushPaint\(\); else p\.markDirty\?\.\(\);[\s\S]{0,220}?p\.markDirty\?\.\(\);/.test(SRC),
    'flushPaint clears _dirty before requesting, so a throttled request leaves it never retrying');
  check('...from ABOVE the latch return, or the countdown never runs',
    SRC.indexOf('if (this._handsRepaintUntil && performance.now() < this._handsRepaintUntil) {')
      < SRC.indexOf('if (want === this._handsUiClassApplied) return;'),
    'the transition latches on its first frame and this function returns early ever after');
  check('...and a throwing rebuild still leaves the class and the flush intact',
    /\} catch \(e\) \{ console\.warn\('\[hands\] rebuilding the panel content failed', e\); \}/.test(SRC),
    'one panel failing to rebuild must not strand the other in the wrong layout');

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

// ── 4g3. a modal overlay draws in front of the panel that summoned it ────────
//
// Every panel shared VR_PANEL_RENDER_ORDER, so a keyboard and the browser-save dialog it exists
// to type into TIED — and three resolves a tie by traversal order. The keyboard came up behind.
// Everything here is transparent, so there is no depth to fall back on: renderOrder is the lever.
{
  check('modal overlays have their own band',
    /export const VR_MODAL_ORDER_BUMP = 2;/.test(HVP)
      && /VR_PANEL_RENDER_ORDER \+ \(this\._isModalOverlay \? VR_MODAL_ORDER_BUMP : 0\)/.test(HVP),
    'a tie is not an order — it resolves by whatever was added first');
  // Render order only decides between things that both survive the DEPTH test. The keyboard sits
  // below and slightly behind the dialog it serves, so raising its order alone changed nothing —
  // depth hid it either way. A modal is the one case where the answer is always "in front".
  // THE WHOLE RULE: same pose as the parent, then 1cm toward the headset. Three attempts got
  // this wrong by adding cleverness on top of a simple spec — a nudge along the panel normal
  // (only "in front" if the panel faces you), a push toward the head (which also threw it upward
  // from a panel below eye level), and a vertical offset from reading "above/below" as height
  // when stacking order was meant.
  check('the keyboard copies the parent panel pose exactly',
    /this\.mesh\.position\.copy\(panelWorldPos\);/.test(KBD)
      && /this\.mesh\.quaternion\.copy\(panelQuat\);/.test(KBD),
    'every offset beyond this was something invented rather than asked for');
  check('...with no vertical term at all',
    !/yField/.test(KBD) && !/_kbTopGap/.test(KBD),
    'the field position used to move it, so it landed differently per input touched');
  // REPOINTED 2026-09-17: "toward the head by a centimetre" is not CLEARANCE from the panel --
  // it yields gap x cos(angle), so it thinned to 1.5mm as the panel angled away. Concentric with
  // the panel that was invisible; beside it, as the numpad sits, it was the whole bug. Both
  // overlays use frontOfPanelOffset now, and panelmirror_test runs it across nine pitches.
  check('...stepping off the panel by a centimetre, toward you',
    /window\._kbFrontGap \?\? 0\.01/.test(KBD) && /frontOfPanelOffset\(/.test(KBD),
    'one centimetre is what was asked for; along the NORMAL is what makes it a centimetre');
  check('...and the viewer position is actually asked for',
    /this\._viewerPosition\(\)/.test(KBD),
    'the viewer decides the SIGN of the normal -- a wrist panel\'s +Z can point away from you');

  // REPOINTED 2026-09-17. The distance-from-the-head rule this asserted was itself a repair for a
  // fixed push along the panel normal -- and it traded one fault for another: distance from the
  // head is not clearance from the panel plane, so the gap ran 13.2 / 7.4 / 2.0 mm across pitch
  // where it should have been constant. matt: "between making the panel face me, to facing the
  // floor, the numpad is coplanar with the parent panel." The normal was right all along; only
  // its SIGN needed the viewer, which is what the original push was missing.
  check('the numpad stands off the panel PLANE, not off the head',
    /frontOfPanelOffset\(/.test(NUM) && !/panelDist - gap/.test(NUM),
    'distance from the head is not monotonic in clearance, which is what is actually wanted');
  check('...keeping the sideways placement that stops it covering the field',
    /addScaledVector\(right,  xFromFieldCentre \+ numW \/ 2 \+ GAP\)/.test(NUM),
    'a numpad on top of the number you are editing is worse than one that is hard to see');

  // The hover quad is a CHILD of the panel mesh, so the parent's mirror decides which way its
  // local +Y points. The existing comment in _showHover warns that negating cy "puts every
  // highlight on the mirrored row" — which is exactly what a normalised parent does to the
  // un-negated form, the same failure arriving from the other direction.
  // Found, positioned, marked visible — and invisible. Default FrontSide worked only because
  // every panel carried scale.y = -1, which flips the quad's winding toward the viewer.
  check('the hover quad is double-sided, so the parent mirror cannot cull it',
    /side: THREE\.DoubleSide,\s*\n\s*\}\)\);/.test(HVP),
    'a normalised parent back-face culled it: quadVisible true with nothing on screen');
  // The quad and the texture share the panel's local space, so a parent mirror flips BOTH and
  // the mapping needs no sign term. Adding one inverted every highlight on the hands panels.
  check('the hover mapping carries no parent-dependent sign term',
    !/ySign/.test(HVP)
      && /q\.position\.set\(\(cx - 0\.5\) \* this\._meshWidth, \(cy - 0\.5\) \* meshH, 0\.001\);/.test(HVP),
    'content and highlight mirror together; correcting for the parent double-corrects');

  // One helper, on the base class, rather than a copy per overlay to keep in step.
  check('the viewer position is shared by every panel',
    /_viewerPosition\(\) \{/.test(HVP) && !/_viewerPosition\(\) \{/.test(KBD),
    'three copies of "where is the head" is three places for it to drift');

  check('...and modals are not depth-sorted against the panel that summoned them',
    /depthWrite: !_modal,/.test(HVP) && /depthTest: !_modal,/.test(HVP),
    'a higher render order cannot rescue something the depth test has already discarded');
  check('...while ordinary panels keep depth, so geometry still occludes them',
    /const _modal = !!this\._isModalOverlay;/.test(HVP),
    'turning depth off for every panel would float menus through the model');

  check('...claimed by all three overlays',
    /this\._isModalOverlay = true;/.test(KBD) && /this\._isModalOverlay = true;/.test(NUM)
      && /this\._isModalOverlay = true;/.test(CNF));
  check('...set BEFORE init, or the bump is never applied',
    KBD.indexOf('this._isModalOverlay = true;') < KBD.indexOf('this.init(scene, camera, renderer);'),
    'init reads the flag; setting it afterwards leaves the mesh at the panel band');
  check('...and kept BELOW the pointer ray, which already sits at +5',
    /VR_MODAL_ORDER_BUMP = 2;/.test(HVP),
    'a modal above the ray hides the ray you aim with inside the keyboard you aim at');
  check('the pointer stays at the top of the ladder',
    /this\._bpReticle\.renderOrder = VR_PANEL_RENDER_ORDER \+ 8;/.test(SRC)
      && /m\.renderOrder = VR_PANEL_RENDER_ORDER \+ 7;/.test(SRC),
    'a hit dot buried under a keyboard vanishes exactly when precise aim matters most');
}

// ── 4g2. an overlay must mirror the way the panel it sits against mirrors ────
{
  // Measured: kbScale [1,-1,1] against mainScale [1,1,1]. Both carried -1 historically, so the
  // two mirrors cancelled; normalising the wrist panels left the keyboard mirrored alone.
  // Bind it to its guard: the assignment sitting inside an `if (false)` reads identically.
  // REPOINTED 2026-09-17 -- THESE RULES MOVED, AND SO DID THEIR HARNESS.
  //
  // This block asserted a scale.y mirror-sign copy on all three overlays. It was replaced, because
  // it was wrong in a way nobody had hit yet: the guards tested scale.y, and a panel PLACED BY A
  // DECOMPOSE carries its mirror on scale.x (three folds a negative determinant into sx). Pinning
  // does exactly that, so a pinned panel's keyboard came up reversed left to right.
  //
  // It is one shared rule now -- matchPanelTransform in HTMLVRPanel -- and
  // scratchpad/panelmirror_test.mjs owns it: that harness LIFTS AND RUNS the rule against every
  // scale convention a panel arrives in, which is strictly more than these text matches checked.
  // Restating it here would be two copies of one rule, which is what caused this in the first
  // place. What stays is the AVP-specific half: the hands slot normalises a panel's scale, so that
  // convention has to be one of the ones the shared rule handles.
  check('the overlays share one placement rule rather than three copies',
    /matchPanelTransform\(this\.mesh, pMesh\)/.test(KBD)
      && /matchPanelTransform\(this\.mesh, animMesh\)/.test(NUM)
      && /matchPanelTransform\(this\.mesh, panelMesh\)/.test(CNF),
    'three private copies is how all three came to test the wrong axis together');
  check('...with the hands-normalised convention still covered, in panelmirror_test',
    /a hands-slot panel, normalised \(1,1,1\)/
      .test(fs.readFileSync(path.join(REPO, 'scratchpad/panelmirror_test.mjs'), 'utf8')),
    'the hands slot sets scale to +1; if that case is dropped there, it is covered nowhere');
}

// ── 4g. the Rz(180) compensation, conditional on the scale that causes it ────
//
// Panel meshes normally carry scale.y = -1, which puts a spurious half turn into the world
// quaternion. Keyboard, numpad and confirm each undid that with a hardcoded multiply — correct
// exactly as long as EVERY panel always had that scale. The hands-only wrist slot normalises it,
// so the hardcoded undo introduced the very flip it exists to remove.
{
  check('the compensation is shared, not repeated per panel',
    /export function panelWorldQuat\(mesh, out\) \{/.test(HVP),
    'three copies of an assumption is three places for it to go stale');
  check('...and applied only when the scale actually calls for it',
    /const sy = mesh\.scale \? mesh\.scale\.y : 1;\s*\n\s*if \(sy < 0\) q\.multiply/.test(HVP),
    'assuming the scale is what broke the keyboard when one panel stopped having it');
  check('...with every hardcoded undo removed',
    !/multiply\(new THREE\.Quaternion\(0, 0, 1, 0\)\)/.test(KBD + NUM + CNF),
    'one left behind is one panel that still flips');
  check('...and all three panels using the helper',
    /matchPanelTransform\(this\.mesh, pMesh\)/.test(KBD)
      && /matchPanelTransform\(this\.mesh, animMesh\)/.test(NUM)
      && /matchPanelTransform\(this\.mesh, panelMesh\)/.test(CNF));
}

// ── 4h0. you cannot aim a tool with the tool you are aiming ──────────────────
//
// Dragging a spike slider moved the spike, which moved the ray, which moved where the ray met
// the panel, which moved the slider. A closed loop that reached the end of its range in under a
// second and left the app unusable until localStorage was cleared by hand.
{
  check('the live spike is frozen for the duration of its own drag',
    /if \(this\._spikeFreeze\) return this\._spikeFreeze\.length;/.test(SRC)
      && /if \(this\._spikeFreeze\) return this\._spikeFreeze\.offset;/.test(SRC)
      && /if \(this\._spikeFreeze\) return this\._spikeFreeze\.tilt;/.test(SRC),
    'a control that moves the instrument measuring it is a feedback loop, not a setting');
  check('...snapshotted from the live accessors when the drag begins',
    /this\._spikeFreeze = \{\s*\n\s*length: this\.getStylusLength\(\),/.test(SRC),
    'the freeze must hold what was on screen, not a stored value that may differ');
  check('...and released on drag end, so the new value commits',
    /this\._spikeFreeze = null;\s*\n\s*this\._spikePending = null;/.test(SRC));

  check('the pending value is shown on a COPY of the spike',
    /const m = real\.clone\(\);/.test(SRC) && /m\.name = 'stylus_spike_preview';/.test(SRC),
    'a preview that is not the thing previewed is an approximation of the answer');
  check('...drawn over everything, so a shorter pending length cannot hide inside the live one',
    /o\.material\.depthTest = false;[\s\S]{0,200}?o\.renderOrder = VR_PANEL_RENDER_ORDER \+ 6;/.test(SRC),
    'matt asked for 100% draw on top for exactly this reason');
  check('...parented alongside the real spike, so it inherits the live aim',
    /real\.parent\.add\(m\);/.test(SRC),
    'only the property being edited should differ between them');
  check('...and hidden when nothing is being dragged',
    /if \(!pending\) \{[\s\S]{0,140}?this\._spikePreviewMesh\.visible = false;/.test(SRC));
}

// ── 4h. the spike is a different tool in a hand than in a controller ─────────
//
// A controller is a rigid object you brace against, so a long spike reads as an extension of it.
// A pinch has no shaft: the tip is centimetres from your fingers and length only amplifies
// tremor. One global compromise served neither.
{
  check('the stylus settings split by input kind',
    /if \(this\._handsOnlyMode\(\)\) return this\._handStylus\('handStylusLength', 0\.05\);/.test(SRC)
      && /if \(this\._handsOnlyMode\(\)\) return this\._handStylus\('handStylusOffset', 0\.0\);/.test(SRC),
    'a spike tuned for a controller is the wrong spike for a pinch');
  check('...leaving the controller values untouched',
    /return this\._isQuestStandalone \? 0\.15 : 0\.10;/.test(SRC),
    'those were tuned against a controller; adding a hand variant must not move them');
  check('...and stylus tilt is forced to ZERO for hands, as a rule not a default',
    /if \(this\._handsOnlyMode\(\)\) return 0\.0;\s*\n\s*if \(this\._guiXR && this\._guiXR\._uiSettings && this\._guiXR\._uiSettings\.stylusTilt/.test(SRC),
    'the hand ray is already pitched by _applyHandRayCorrection; letting tilt through rotates it twice');
  check('...with the hand angle persisted, not only a console override',
    /this\._handStylus\('handRayPitch', 20\)/.test(SRC),
    'a slider that reverts on reload is worse than no slider');
  // BOTH SETS ALWAYS VISIBLE. Hiding one depending on what you are holding makes the controls
  // change identity silently — matt: "dont do the magical swap of parameters".
  check('...and both spike groups are always visible, never swapped by input kind',
    /<div class="mm-section-title">Hand spike<\/div>/.test(MM)
      && /<div class="mm-section-title">Controller spike<\/div>/.test(MM)
      && !/mm-row mm-hands-only">\s*\n\s*<span class="mm-lbl">Length/.test(MM),
    'a control whose meaning depends on what you are holding cannot be reasoned about');
  check('...and persisted like their neighbours',
    /opts\.saveOption\('handStylusLength', f, 500\);/.test(MM)
      && /opts\.saveOption\('handRayPitch', v, 500\);/.test(MM));

  // Measured on Galaxy XR: enabledFeatures lacked hand-tracking entirely — requested as OPTIONAL
  // and silently refused, leaving gesture-only sources with no joints.
  check('hand joints can be demanded as a required feature',
    /requiredFeatures: \['hand-tracking'\]/.test(SGL),
    'an optional feature may be dropped without explanation, and was');
  check('...opt-in, because a refused REQUIRED feature can stop VR starting at all',
    /if \(_wantHands\) \{/.test(SGL) && /_reqHandsOutcome = _wantHands \? 'attempting'/.test(SGL),
    'the retry may land after the user activation is spent; not a default worth risking');
  check('...and falling back to the optional request rather than failing',
    /falling back to the optional request/.test(SGL));
}

// ── 4i. the drawn spike and the picking tip, and a radius you can see ────────
{
  // getStylus*() decide where the TIP is computed; the spike you SEE is a mesh moved only by
  // updateStylus*(). Switching input kind changes the accessors and touches no mesh.
  // Bound to the mode-switch site specifically: the same two calls now also appear on the
  // drag-release path, so an unanchored match finds one while the other is gone.
  check('a mode switch re-applies the spike geometry',
    /if \(!want\) this\._handsUiPrimed = false;[\s\S]{0,1200}?this\.updateStylusLength\?\.\(this\.getStylusLength\(\)\);/.test(SRC),
    'otherwise the drawn spike keeps the controller length while picking uses the hand one');
  check('...and a drag release re-applies it too',
    /this\._updateSpikePreview\(null\);[\s\S]{0,300}?this\.updateStylusLength\?\.\(this\.getStylusLength\(\)\);/.test(SRC),
    'the frozen value is replaced by the committed one, and the mesh must follow it');
  check('...and the hand sliders move the mesh as the controller ones do',
    /main\.updateStylusLength\?\.\(f\);[\s\S]{0,200}?opts\.saveOption\('handStylusLength'/.test(MM),
    'writing the setting alone moves the tip and not the spike');

  // A radius is a size in the scene, and the only way to see it was to let go and move away.
  check('the radius is previewed at the menu intersection while dragging',
    /_updateRadiusPreview\(point, radiusPhys\) \{/.test(SRC)
      && /this\._updateRadiusPreview\(_winner\.hit\.point, this\._vrBrushPhysicalRadius\);/.test(SRC),
    'setting a size blind and checking it afterwards is two steps for one decision');
  check('...armed only by a radius slider, not any drag',
    /if \(_locked && \/radius\/i\.test\(_sliderId\)\) this\._radiusPreviewOn = true;/.test(SRC),
    'a sphere appearing while dragging intensity would be noise');
  check('...using the SAME radius the brush cursor uses',
    /this\._vrBrushPhysicalRadius\)/.test(SRC),
    'a second calculation is a second thing that can disagree with what you then paint');
  // The winner synthesised during a slider drag carried uv and distance only, so anything that
  // wants to draw AT the intersection had nothing to position against and silently drew nothing.
  check('the drag-lock hit carries a world point, not just a UV',
    /\}, distance: 0, point: _hit\.clone\(\) \} \};/.test(SRC),
    'the reticle and the radius preview both position from hit.point');
  check('...and hidden when there is no radius to show',
    /if \(r <= 0\) \{ this\._radiusPreview\.visible = false; return; \}/.test(SRC));
  check('...drawn above the panel it is dragged on',
    /m\.renderOrder = VR_PANEL_RENDER_ORDER \+ 4;/.test(SRC));

  // A preview that does not look like the thing it previews teaches the user they are two
  // different things. The app already draws "here is the brush radius" — borrow it.
  check('the preview borrows the cursor\u2019s own material rather than inventing one',
    /const src = cur\?\.getObjectByName\?\.\('volume_sphere'\);/.test(SRC)
      && /const m = src\.material\.clone\(\);/.test(SRC),
    'a wireframe was a design decision with no basis — the fresnel shell is the house style');
  check('...cloned, not shared, so depth can differ',
    /m\.depthTest = false;     \/\/ over the menu it is being set on/.test(SRC),
    'the preview draws over the panel being dragged; the in-world cursor must not');
  check('...and upgrades if it was built before the cursor existed',
    /if \(this\._radiusPreview && !this\._radiusPreviewBorrowed\) \{/.test(SRC),
    'baking in the fallback on first use would keep the wrong look for the whole session');
  check('...with no wireframe anywhere in the preview',
    !/wireframe: true/.test(SRC),
    'the fallback must not reintroduce the look being removed');

  // The hand-tracking grant is decided once at session start, where it is easy to miss.
  // A debug flag that collides with another instrument's flag turns BOTH on, and buries the one
  // line you wanted under the other's output. _panelTrace already belonged to misc/PanelTrace.js.
  check('the placement readout does not collide with PanelTrace\u2019s flag',
    /if \(window\._panelPlace\) \{/.test(SRC) && !/if \(window\._panelTrace\) \{/.test(SRC),
    'turning on one instrument must not turn on an unrelated one');

  // getOptionsURL's default export is a FUNCTION. Reading `getOptionsURL.x` is a property on the
  // function object — always undefined — so a setting read that way silently never loads and the
  // slider only appears to work until the next reload.
  check('option reads CALL getOptionsURL rather than reading properties off it',
    /getOptionsURL\(\)\[key\]/.test(SRC) && /getOptionsURL\(\)\[ 'pinchOn' \]/.test(SRC)
      && /getOptionsURL\(\)\.requireHands/.test(SGL),
    'a property on the function object is undefined, so the saved value never arrives');

  // A window flag must be set before the session starts and is lost on reload — which produced
  // "not attempted" three times running. A URL option cannot be mistimed.
  check('required hand-tracking can be asked for by URL, not only a window flag',
    /options\.requireHands = queryBool\(getVal\('requirehands'\), false\);/.test(OPT),
    'readUrlParameters lowercases every key, so a camelCase lookup never matches the URL');
  check('...with either source accepted',
    /\(window\._requireHands === true\) \|\| !!getOptionsURL\(\)\.requireHands/.test(SGL));

  check('the required-hands outcome is recorded, not only logged',
    /window\._reqHandsOutcome = 'refused: ' \+ e\.name/.test(SGL)
      && /window\._reqHandsOutcome = 'granted: '/.test(SGL),
    'the one answer that says whether joints are reachable must outlive the log line');
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
