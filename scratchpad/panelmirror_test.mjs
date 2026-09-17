// Node harness for MATCHING A PANEL'S TRANSFORM, mirror included.
//
// The keyboard, numpad and confirm dialog are HTMLVRPanels positioned against another HTMLVRPanel.
// All three carried their own copy of "undo the half turn, then match the mirror sign", written
// against `scale.y` -- and three's Matrix4.decompose folds a negative determinant into *sx* by
// convention, so a panel PLACED by decomposing a matrix comes out (-1, 1, 1) rather than
// (1, -1, 1). Same mirror, different axis, and all four guards were blind to it.
//
// Measured on matt's repro (pin the main menu, Files > Save):
//   panelScale=[-1.0000000224, 0.9999999676, 0.9999999822]  and the "corrected" quaternion
//   identical to the raw one, because no branch fired. "keyboard is drawn facing the wrong way,
//   so its mirrored left to right."
//
// The rule is arithmetic, so it is LIFTED AND RUN against every convention a panel is known to
// arrive in. What matters visually is the 3x3 of the world matrix: get that right and the mirror
// is right, whatever combination of quaternion and scale produced it.
//
// Run: node scratchpad/panelmirror_test.mjs
//
// Defect injections:
//   PM_INJECT=yaxis      the rule goes back to testing scale.y, so the pinned convention breaks
//   PM_INJECT=quatonly   the scale signs stop being copied, leaving rotation right and mirror wrong
//   PM_INJECT=copies     a panel stops using the shared helper and keeps its own copy
//   PM_INJECT=tohead     the clearance rule steps toward the HEAD again, so the gap thins as the
//                        panel is angled away -- the keyboard's old rule
//   PM_INJECT=nosign     the normal's sign stops following the viewer, so on a panel whose +Z
//                        points away the overlay steps BEHIND it
import fs from 'fs';
import path from 'path';
import * as THREE from 'three';

const REPO = new URL('..', import.meta.url).pathname;
const R = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
const inj = process.env.PM_INJECT || '';

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

let PANEL = R('src/gui/htmlvr/HTMLVRPanel.js');

if (inj === 'yaxis') {
  PANEL = PANEL.replace('const sgn = (v) => (v < 0 ? -1 : 1);\n    mesh.scale.set(Math.abs(mesh.scale.x) * sgn(_mptS.x),\n                   Math.abs(mesh.scale.y) * sgn(_mptS.y),\n                   Math.abs(mesh.scale.z) * sgn(_mptS.z));',
    'mesh.scale.y = Math.abs(mesh.scale.y) * (panelMesh.scale.y < 0 ? -1 : 1);');
  if (!/mesh\.scale\.y = Math\.abs/.test(PANEL)) throw new Error('inject yaxis: anchor moved');
}
if (inj === 'tohead') {
  const a = '  _fopN.set(0, 0, 1).applyQuaternion(panelQuat);';
  if (!PANEL.includes(a)) throw new Error('inject tohead: anchor moved');
  PANEL = PANEL.replace(a, '  _fopN.copy(viewerPos).sub(panelWorldPos).normalize();');
}
if (inj === 'nosign') {
  const a = '    if (_fopN.dot(_fopV) < 0) _fopN.negate();';
  if (!PANEL.includes(a)) throw new Error('inject nosign: anchor moved');
  PANEL = PANEL.replace(a, '');
}
if (inj === 'quatonly') {
  const a = '  if (mesh && mesh.scale) {';
  if (!PANEL.includes(a)) throw new Error('inject quatonly: anchor moved');
  PANEL = PANEL.replace(a, '  if (false) {');
}

// ── lift matchPanelTransform and run it ─────────────────────────────────────
const src = PANEL.slice(PANEL.indexOf('const _mptQ = new THREE.Quaternion();'),
  PANEL.indexOf('// THE PITCH THAT LIES THE PANEL FLAT'));
if (!src) throw new Error('lift: the anchor moved');
const matchPanelTransform = new Function('THREE',
  src.replace(/^export /gm, '') + '\nreturn matchPanelTransform;')(THREE);

const basis = (o) => { o.updateMatrixWorld(true); const e = o.matrixWorld.elements;
  return [e[0], e[1], e[2], e[4], e[5], e[6], e[8], e[9], e[10]]
    .map((n) => (Math.abs(n) < 1e-9 ? 0 : n)); };
const close = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
const ROT = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, -0.8, 0.15));

// Every convention a source panel is known to arrive in. The middle one is matt's pinned panel
// and is the case that was broken; the other two are what the old rule DID get right, and they
// have to keep working or this trades one report for another.
const CONVENTIONS = [
  ['a panel at its natural mirror (1,-1,1)', new THREE.Vector3(1, -1, 1)],
  ['a pinned panel, placed by decompose (-1,1,1)', new THREE.Vector3(-1, 1, 1)],
  ['a hands-slot panel, normalised (1,1,1)', new THREE.Vector3(1, 1, 1)],
];
for (const [name, sc] of CONVENTIONS) {
  const panel = new THREE.Mesh(); panel.quaternion.copy(ROT); panel.scale.copy(sc);
  const kb = new THREE.Mesh(); kb.scale.set(1, -1, 1);   // what an HTMLVRPanel is built with
  kb.quaternion.copy(matchPanelTransform(kb, panel));
  check('sits the same way as ' + name, close(basis(kb), basis(panel)),
    'keyboard basis ' + basis(kb).map((n) => n.toFixed(2)).join(',')
      + ' vs panel ' + basis(panel).map((n) => n.toFixed(2)).join(','));
}

// ── AND ALL THREE PANELS USE IT ─────────────────────────────────────────────
//
// One rule in one place is the whole point: three copies were three chances to be wrong, and they
// were wrong together.
{
  const files = ['src/gui/htmlvr/VrKeyboard.js', 'src/gui/htmlvr/VrNumpad.js',
                 'src/gui/htmlvr/VrConfirm.js'];
  for (const f of files) {
    let src2 = R(f);
    if (inj === 'copies' && f.endsWith('VrNumpad.js')) {
      src2 = src2.replace('const panelQuat = matchPanelTransform(this.mesh, animMesh);',
        'const panelQuat = panelWorldQuat(animMesh);');
    }
    check(path.basename(f) + ' positions through the shared helper',
      /matchPanelTransform\(this\.mesh, \w+\)/.test(src2),
      'a private copy is how all three came to test the wrong axis');
    check('...and keeps no mirror-sign copy of its own',
      !/Math\.abs\(this\.mesh\.scale\.y\) \* \(\w+\.scale\.y < 0/.test(src2));
  }
}

// ── CLEARANCE IS CLEARANCE, AT EVERY PITCH ──────────────────────────────────
//
// An overlay floating over a panel wants a fixed gap from the panel's PLANE. Two rules preceded
// this one and neither measured that: the keyboard stepped toward the HEAD (clearance = gap x
// cos(angle), so it thins as the panel is angled away) and the numpad set an absolute
// distance-from-head, which is not monotonic in clearance at all. Concentric with the panel the
// error is invisible; beside it, as the numpad sits, it collapses to nothing.
//
// matt: "between making the panel face me, to facing the floor, the numpad is coplanar with the
// parent panel. between facing me to making it face the sky, the offset raises from 0 to a given,
// probably correct, offset" -- and that asymmetry is the old rule's signature: +70 gives 2.0mm
// where -70 gives 7.0mm.
{
  const src2 = PANEL.slice(PANEL.indexOf('const _fopN = new THREE.Vector3();'),
    PANEL.indexOf('// THE PITCH THAT LIES THE PANEL FLAT'));
  if (!src2) throw new Error('lift frontOfPanelOffset: the anchor moved');
  const frontOfPanelOffset = new Function('THREE',
    src2.replace(/^export /gm, '') + '\nreturn frontOfPanelOffset;')(THREE);

  const head = new THREE.Vector3(0, 1.6, 0);
  const C = new THREE.Vector3(0, 1.5, -0.5);
  const GAP = 0.01, SIDE = 0.06;
  const clearanceAt = (pitchDeg) => {
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(THREE.MathUtils.degToRad(pitchDeg), 0, 0));
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const n = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const P = C.clone().addScaledVector(right, SIDE)
      .add(frontOfPanelOffset(q, C, head, GAP));
    const sign = n.dot(head.clone().sub(C)) < 0 ? -1 : 1;
    return P.sub(C).dot(n) * sign;
  };
  const pitches = [0, 20, 45, 70, 90, -20, -45, -70, -90];
  const got = pitches.map(clearanceAt);
  check('the gap is the same at every panel pitch',
    got.every((v) => Math.abs(v - GAP) < 1e-6),
    pitches.map((p, i) => p + 'deg:' + (got[i] * 1000).toFixed(1) + 'mm').join(' '));
  check('...and always on the viewer\'s side of the panel',
    got.every((v) => v > 0),
    'a negative clearance is the overlay hiding behind the thing it belongs to');
  check('...however far to the side the overlay was placed',
    Math.abs(clearanceAt(45) - GAP) < 1e-6,
    'the numpad sits beside the field it edits, which is where distance-from-head fell apart');
}

// ── BOTH OVERLAYS USE IT ────────────────────────────────────────────────────
{
  for (const f of ['src/gui/htmlvr/VrKeyboard.js', 'src/gui/htmlvr/VrNumpad.js']) {
    check(path.basename(f) + ' steps off the panel through the shared rule',
      /frontOfPanelOffset\(\s*\n?\s*panelQuat, panelWorldPos/.test(R(f)),
      'two overlays solving one geometry problem separately is how they came to disagree');
  }
}

// ── A MODAL DOES NOT OUTLIVE ITS PARENT ─────────────────────────────────────
//
// These overlays float in world space rather than being parented to the panel that summoned
// them, so closing that panel left the keyboard or numpad hanging over nothing, still taking
// presses. matt: "if the user presses the X button to close the parent mainpanel, the popup
// keyboard/numpad should also close."
//
// Checked per frame rather than wired to the X, so every exit is covered -- the close button, a
// swap to the wrist panel, a torn-off section put away.
//
// NO DEBOUNCE, and that is worth asserting because the first version had one. Scene's restorable
// "wrist hide episode" fires only while the off-hand trigger is held AND Grab holds a pin or bone,
// which cannot coincide with a modal keyboard. A wait for a transient that cannot happen is cost
// with no benefit. matt: "why the delay? it serves no purpose i can see." 
{
  for (const f of ['src/gui/htmlvr/VrKeyboard.js', 'src/gui/htmlvr/VrNumpad.js',
                   'src/gui/htmlvr/VrConfirm.js']) {
    const src3 = R(f);
    const name = path.basename(f);
    check(name + ' closes when its parent goes away',
      /if \(_parent && !_parent\.visible\) \{ this\.close\(\); return; \}/.test(src3),
      'a modal with no parent is unreachable and still capturing presses');
    check('...on the first frame, with nothing to wait for',
      !/_orphanFrames/.test(src3),
      'the only transient hider cannot coincide with a modal; a delay here guards nothing');
    check('...and it bails before tracking when already hidden',
      /_repositionIfTracking\(\) \{\s*\n\s*if \(!this\.mesh\?\.visible\) return;/.test(src3),
      'without it close() re-fires every frame after the first');
  }

  // The rule itself, lifted from the keyboard and run: a hide that ends is not a close.
  const kbSrc = R('src/gui/htmlvr/VrKeyboard.js');
  const body = kbSrc.slice(kbSrc.indexOf('  _repositionIfTracking() {'), kbSrc.indexOf('  close() {'));
  const tick = new Function('return function(){'
    + body.slice(body.indexOf('{') + 1, body.lastIndexOf('}')) + '}')();
  const mk = (vis) => ({ mesh: { visible: true }, _sourcePanel: { mesh: { visible: vis } },
    _sourceEl: null, _anchorMesh: null, closed: 0,
    close() { this.closed++; this.mesh.visible = false; },
    _positionForSource() {}, _positionAtMesh() {} });

  const gone = mk(false);
  for (let i = 0; i < 40; i++) tick.call(gone);
  check('a hidden parent closes it at once, and only once', gone.closed === 1,
    'closed ' + gone.closed + ' times — the visible-check at the top short-circuits after the first');

  const live = mk(true);
  for (let i = 0; i < 40; i++) tick.call(live);
  check('...and a visible parent never does', live.closed === 0);
}

console.log(failures ? '\n' + failures + ' FAILURE(S)' : '\nall checks passed');
process.exit(failures ? 1 : 0);
