// Node harness for VrRadialMenu — the gesture, not the drawing.
//
// matt, on the first build: "if i choose the naming option, it brings up the next marking menu,
// but i can't select any options; dragging the controller into the sector doesn't choose it,
// and pressing B goes back to the original menu."
//
// That was a design error, not a slip. The gesture is HOLD -> DRAG -> RELEASE, and I reopened
// the wheel ON the release — leaving it with no held button to drive. Dragging could not select
// (that branch needs bDown) and the next press ran the root resolver over the top. So what is
// checked here is the STATE MACHINE across button edges, which is the part that cannot be seen
// by reading one function.
//
// Run: node scratchpad/radial_test.mjs   (from the repo root)
//
// Defect injections (standing lesson 1):
//   RD_INJECT=reopenonrelease  the submenu opens on the release again — the reported bug
//   RD_INJECT=nopushout        the submenu no longer opens mid-hold, so it needs a second press
//   RD_INJECT=basecam          the wheel is faced with the app's base camera, which during a
//                              session carries the desktop orbit view, not the head
//   RD_INJECT=localquat        the wheel is faced with the camera's LOCAL quaternion while the
//                              hand is measured in world axes — the needle-direction bug
//   RD_INJECT=keeppending      cancelling in a submenu keeps it pending, so B never gets you
//                              back to the root menu
//   RD_INJECT=upoffset         the wheel floats above the hand again, so the visual centre is
//                              not the origin the movement is measured from
import fs from 'fs';
import path from 'path';

const REPO = '/Users/mattestela/sculptxr';
let SRC = fs.readFileSync(path.join(REPO, 'src/gui/htmlvr/VrRadialMenu.js'), 'utf8');

{
  const inj = process.env.RD_INJECT || '';
  if (inj === 'reopenonrelease') {
    // The short-drag fallback reopens the wheel ON the release again, leaving it with no held
    // button to drive — the original report.
    const a = '        this._pending = sub;';
    if (!SRC.includes(a)) throw new Error('inject reopenonrelease: anchor moved');
    SRC = SRC.replace(a, '        this._isSub = true;\n        this._openAt(this._pNow.clone(), sub);');
  } else if (inj === 'nopushout') {
    // The submenu no longer opens mid-hold, so choosing it needs a second press again.
    const a = '    if (!this._isSub && active >= 0 && dist >= t.radiusM * t.subRadius) {';
    if (!SRC.includes(a)) throw new Error('inject nopushout: anchor moved');
    SRC = SRC.replace(a, '    if (false) {');
  } else if (inj === 'basecam') {
    // The wheel is faced with the app's BASE camera again, which during a session carries the
    // desktop orbit view rather than the head.
    const a = '    if (app?._xrSession && xr?.getCamera) {';
    if (!SRC.includes(a)) throw new Error('inject basecam: anchor moved');
    SRC = SRC.replace(a, '    if (false) {');
  } else if (inj === 'localquat') {
    // The wheel is faced with the camera's LOCAL quaternion again while the hand is measured
    // against world axes — right when the camera has no parent, mirrored when it does.
    const a = '      this.mesh.parent.getWorldQuaternion(this._qPar);\n      this.mesh.quaternion.copy(this._qPar.invert()).multiply(this._qTmp);';
    if (!SRC.includes(a)) throw new Error('inject localquat: anchor moved');
    SRC = SRC.replace(a, '      this.mesh.quaternion.copy(cam.quaternion);');
  } else if (inj === 'keeppending') {
    const a = '      const pend = this._pending;\n      this._pending = null;';
    if (!SRC.includes(a)) throw new Error('inject keeppending: anchor moved');
    SRC = SRC.replace(a, '      const pend = this._pending;');
  } else if (inj === 'upoffset') {
    const a = '  if (t.upOffset  == null) t.upOffset  = 0.0;';
    if (!SRC.includes(a)) throw new Error('inject upoffset: anchor moved');
    SRC = SRC.replace(a, '  if (t.upOffset  == null) t.upOffset  = 0.05;');
  }
}

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

// A THREE stub: only the vector maths the gesture uses, plus the objects _openAt touches.
const V3 = class {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { return this.set(v.x, v.y, v.z); }
  clone() { return new V3(this.x, this.y, this.z); }
  subVectors(a, b) { return this.set(a.x - b.x, a.y - b.y, a.z - b.z); }
  addScaledVector(v, s) { return this.set(this.x + v.x * s, this.y + v.y * s, this.z + v.z * s); }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  normalize() { const l = Math.hypot(this.x, this.y, this.z) || 1; return this.set(this.x / l, this.y / l, this.z / l); }
  setFromMatrixColumn(m, i) { return this.set(i === 0 ? 1 : 0, i === 1 ? 1 : 0, 0); }
};
// A YAW-ONLY quaternion is enough: the whole point is that the disk's axes are read back off
// the mesh, so the stub has to actually CARRY an orientation through place -> read rather than
// hand back a fixed basis. `_yaw` radians about world Y.
class Q {
  constructor(y = 0) { this._yaw = y; }
  copy(q) { this._yaw = q._yaw || 0; return this; }
  invert() { this._yaw = -this._yaw; return this; }
  multiply(q) { this._yaw += (q._yaw || 0); return this; }
}
const THREE = {
  Vector3: V3,
  Quaternion: Q,
  CanvasTexture: class { constructor() { this.needsUpdate = false; } },
  PlaneGeometry: class {}, MeshBasicMaterial: class {}, DoubleSide: 2,
  Mesh: class {
    constructor() { this.position = new V3(); this.quaternion = new Q();
      this.scale = { set() {} }; this.visible = false; this.renderOrder = 0;
      this.parent = null; this.matrixWorld = { _yaw: 0 }; }
    updateMatrixWorld() {
      // world yaw = parent yaw + local yaw, which is what a real matrixWorld composes.
      this.matrixWorld._yaw = (this.parent?._worldYaw || 0) + this.quaternion._yaw;
    }
  },
};
// ROLL, not yaw — rotation about the VIEW axis, which is the one that turns the disk's right
// and up within the plane you aim in. A yaw-only stub cannot catch a frame mismatch at all: it
// swings the axes out of the aiming plane, so `dy` stays zero and every displacement lands on
// the same wedge whatever the error. The first version of this file made that mistake and the
// injected defect passed.
V3.prototype.setFromMatrixColumn = function (m, i) {
  const r = m._yaw || 0;   // radians of roll
  return i === 0 ? this.set(Math.cos(r), Math.sin(r), 0)
    : this.set(-Math.sin(r), Math.cos(r), 0);
};
// THE CAMERA HAS A PARENT OF ITS OWN, which is the condition that separates its LOCAL
// quaternion from its WORLD one — and therefore the only condition under which the bug is
// visible at all. In XR three parents the camera; the spectator modes rewrite its matrices.
// A stub where cam.quaternion happens to equal the world orientation cannot catch this, which
// is how the first version of this check passed against the injected defect.
let CAM_WORLD_YAW = 0, PARENT_YAW = 0;
// Deliberately NOT equal to the wheel-parent yaw used in the checks below: if the two happen
// to cancel, the correct and the broken computation land on the same world orientation and the
// injection passes. They did, first time round.
const CAM_PARENT_YAW = Math.PI / 3;
globalThis.window = { app: { _camera: { getThreeCamera: () => ({
  updateMatrixWorld() {}, matrixWorld: {}, position: new V3(0, 0, 1),
  quaternion: new Q(CAM_WORLD_YAW - CAM_PARENT_YAW),   // LOCAL: differs from world
  getWorldQuaternion: (q) => { q._yaw = CAM_WORLD_YAW; return q; } }) } } };
globalThis.document = { createElement: () => ({ width: 0, height: 0,
  getContext: () => new Proxy({}, { get: () => () => {} }) }) };

const body = SRC.split('\n').filter((l) => !/^import\s/.test(l))
  .filter((l) => !/^export /.test(l) || l.includes('class VrRadialMenu')).join('\n')
  .replace('export class VrRadialMenu', 'class VrRadialMenu');
const VrRadialMenu = new Function('THREE', body + '\nreturn VrRadialMenu;')(THREE);

// Drive it the way Scene does: one handleInput per frame.
const P = (x, y) => new V3(x, y, 0);
function session(rootCmds, parentYaw = 0) {
  PARENT_YAW = parentYaw;
  const parent = { add() {}, _worldYaw: parentYaw,
    getWorldQuaternion: (q) => { q._yaw = parentYaw; return q; } };
  const m = new VrRadialMenu(parent);
  m.mesh.parent = parent;
  const ran = [];
  const root = () => rootCmds(ran);
  return {
    m, ran,
    press: (p) => m.handleInput(true, p || P(0, 0), root),
    drag: (p) => m.handleInput(true, p, root),
    release: (p) => m.handleInput(false, p || P(0, 0), root),
  };
}

// Sector 0 is at 12 o'clock; +y is up. Two commands => 0 is up, 1 is down.
const UP = P(0, 0.2), DOWN = P(0, -0.2), CENTRE = P(0, 0);
// Past the dead zone (0.03) but inside the submenu rim (radiusM 0.12 * 1.15 = 0.138).
const NEAR_UP = P(0, 0.06);

// ── the plain gesture ────────────────────────────────────────────────────────
{
  const s = session((ran) => [
    { label: 'A', run: () => ran.push('A') },
    { label: 'B', run: () => ran.push('B') },
  ]);
  s.press(CENTRE);
  check('a press opens the wheel', s.m.isOpen === true);
  s.drag(UP); s.release(UP);
  check('drag out and release runs that command', s.ran.join() === 'A', s.ran.join());
  check('...and closes', s.m.isOpen === false);

  const s2 = session((ran) => [
    { label: 'A', run: () => ran.push('A') },
    { label: 'B', run: () => ran.push('B') },
  ]);
  s2.press(CENTRE); s2.drag(DOWN); s2.release(DOWN);
  check('the opposite direction runs the opposite command', s2.ran.join() === 'B', s2.ran.join());

  const s3 = session((ran) => [{ label: 'A', run: () => ran.push('A') }]);
  s3.press(CENTRE); s3.release(CENTRE);
  check('releasing in the dead zone cancels', s3.ran.length === 0);
}

// ── the submenu, across button edges ─────────────────────────────────────────
//
// THE REPORTED BUG. Everything here is about what happens on the SECOND press.
{
  const mk = (ran) => [
    { label: 'Name chain', run: () => {}, sub: () => [
      { label: 'arm', run: () => ran.push('arm') },
      { label: 'leg', run: () => ran.push('leg') },
    ] },
    { label: 'Other', run: () => ran.push('other') },
  ];
  // PUSH OUT PAST THE RIM and the child ring takes over mid-hold — one gesture, which is what
  // matt asked for: "as soon as i choose the name option ... it should display the next
  // marking menu." UP is well past the rim; NEAR is past the dead zone but inside it.
  const FAR = P(0, 0.4);
  const s = session(mk);
  s.press(CENTRE); s.drag(NEAR_UP);
  check('a short drag just highlights the parent sector', s.m._isSub === false);
  s.drag(FAR);
  check('pushing out opens the submenu WITHOUT releasing', s.m._isSub === true
    && s.m._commands.map((c) => c.label).join() === 'arm,leg',
    s.m._commands.map((c) => c.label).join());
  check('...and it re-origins at the crossing point, not where the gesture began',
    Math.abs(s.m._p0.y - FAR.y) < 1e-9,
    'otherwise every child sector sits a rim off to one side');
  check('...with nothing run yet', s.ran.length === 0);

  // From the new origin, move to a child sector and release.
  s.drag(P(FAR.x, FAR.y + 0.2)); s.release(P(FAR.x, FAR.y + 0.2));
  check('releasing in the child runs the child command', s.ran.join() === 'arm', s.ran.join());
  check('...and closes', s.m.isOpen === false);

  // THE SHORT-DRAG FALLBACK. Released on a submenu sector without pushing out: rather than a
  // dead wedge, it arms for the next press.
  const s2 = session(mk);
  s2.press(CENTRE); s2.drag(NEAR_UP); s2.release(NEAR_UP);
  check('a short release on a submenu sector runs nothing', s2.ran.length === 0);
  check('...and arms it for the next press', s2.m.hasPending === true);
  s2.press(CENTRE);
  check('the next press opens the SUBMENU, not the root',
    s2.m._commands.map((c) => c.label).join() === 'arm,leg',
    s2.m._commands.map((c) => c.label).join());
  s2.drag(UP); s2.release(UP);
  check('and dragging in it selects', s2.ran.join() === 'arm', s2.ran.join());
  check('...leaving nothing pending', s2.m.hasPending === false);
  s2.press(CENTRE);
  check('the press after that is the root again',
    s2.m._commands.map((c) => c.label).join() === 'Name chain,Other');
}

// Cancelling inside a submenu must not strand you in it.
{
  const s = session((ran) => [
    { label: 'Sub', run: () => {}, sub: () => [{ label: 'x', run: () => ran.push('x') }] },
    { label: 'Other', run: () => ran.push('other') },
  ]);
  s.press(CENTRE); s.drag(NEAR_UP); s.release(NEAR_UP);
  s.press(CENTRE); s.release(CENTRE);            // open the submenu, cancel in the dead zone
  check('cancelling a submenu runs nothing', s.ran.length === 0);
  s.press(CENTRE);
  check('...and the next press is the ROOT, not the submenu again',
    s.m._commands.map((c) => c.label).join() === 'Sub,Other',
    'otherwise B never gets you out');
}

// Depth is capped: a submenu whose command returns a list must not nest.
{
  const s = session(() => [
    { label: 'Sub', run: () => {},
      sub: () => [{ label: 'deeper', run: () => {},
        sub: () => [{ label: 'no', run() {} }] }] },
  ]);
  s.press(CENTRE); s.drag(NEAR_UP); s.release(NEAR_UP);
  s.press(CENTRE); s.drag(UP); s.release(UP);
  check('a submenu cannot open a submenu', s.m.hasPending === false && s.m.isOpen === false,
    'a menu tree in mid-air is what a radial exists to avoid');
}

// ── the wheel is centred where the movement is measured from ─────────────────
{
  check('no vertical offset between the wheel and the hand',
    /if \(t\.upOffset  == null\) t\.upOffset  = 0\.0;/.test(SRC),
    'the visual centre must BE the selection origin, or every direction reads skewed');
  check('...while the toward-camera nudge survives',
    /t\.camOffset = 0\.04/.test(SRC),
    'that one is along the view axis and moves nothing in the aiming plane');
}

// ── the feedback that was missing ────────────────────────────────────────────
{
  check('a needle shows where the hand is', /showNeedle/.test(SRC) && /this\._nx \* rOuter/.test(SRC),
    'without it the mapping has to be inferred from the result');
  check('...drawn with canvas-y flipped against camUp', /C - this\._ny \* rOuter/.test(SRC),
    'getting that wrong picks the wedge opposite the one you point at');
  check('the dead zone is drawn at its real size',
    /\(t\.deadZone \/ t\.radiusM\) \* rOuter/.test(SRC),
    'the inner disc is a layout radius and says nothing about how far you must move');
  check('the centre says what to do next', /'move out' : 'release'/.test(SRC));
}


// ── ONE FRAME FOR THE DRAWING AND THE PICK ───────────────────────────────────
//
// matt, once the needle made it visible: "depending on if i drag the controller above or below
// the marking menu disk, the needle direction either goes in the same or opposite direction of
// the controller."
//
// The wheel was faced with `cam.quaternion` — the camera's LOCAL rotation — while the hand was
// measured against `cam.matrixWorld` columns, which are WORLD axes. Identical when the camera
// has no parent transform; mirrored when it does, which in XR and in the spectator modes it
// does. Two frames, one of them invisible.
//
// The fix is structural rather than a sign flip: face the wheel using the camera's WORLD
// orientation, then read the axes BACK OFF THE PLACED MESH. Whatever the camera or the parent
// is doing, the frame the hand is measured in is the frame that was drawn.
{
  // A parent with its own rotation is exactly the case that separated the two frames.
  for (const parentYaw of [0, Math.PI / 2, Math.PI]) {
    const s = session((ran) => [
      { label: 'A', run: () => ran.push('A') },
      { label: 'B', run: () => ran.push('B') },
    ], parentYaw);
    s.press(CENTRE); s.drag(UP); s.release(UP);
    check('up picks the top wedge with a parent yaw of ' + parentYaw.toFixed(2),
      s.ran.join() === 'A', s.ran.join() || '(nothing)');
  }

  // FOUR WEDGES, so left and right exist as distinct answers. A yaw error rotates the frame
  // about the vertical axis, so up/down alone cannot see it — which is what let the first
  // version of this section pass against the injected defect.
  const LEFT = P(-0.2, 0), RIGHT = P(0.2, 0);
  for (const [dir, want, pos] of [['up', 'N', UP], ['right', 'E', RIGHT],
    ['down', 'S', DOWN], ['left', 'W', LEFT]]) {
    const s4 = session((ran) => ['N', 'E', 'S', 'W'].map((l) =>
      ({ label: l, run: () => ran.push(l) })), Math.PI / 2);
    s4.press(CENTRE); s4.drag(pos); s4.release(pos);
    check('moving ' + dir + ' picks the ' + want + ' wedge', s4.ran.join() === want,
      'got ' + (s4.ran.join() || '(nothing)') + ' — a frame mismatch shows as a rotation here');
  }

  // And the needle agrees with the wedge, which is the thing the eye checks.
  const s = session(() => [{ label: 'A', run() {} }, { label: 'B', run() {} }], Math.PI / 2);
  s.press(CENTRE); s.drag(UP);
  check('the needle points the way the hand moved', s.m._ny > 0.5 && Math.abs(s.m._nx) < 0.01,
    'nx=' + s.m._nx.toFixed(3) + ' ny=' + s.m._ny.toFixed(3));
  s.drag(DOWN);
  check('...and follows it the other way too', s.m._ny < -0.5,
    'ny=' + s.m._ny.toFixed(3) + ' — a sign that flips with the parent frame is the bug');

  check('the pick reads the DISK axes, not the camera',
    /d\.dot\(this\._axX\)/.test(SRC) && /d\.dot\(this\._axY\)/.test(SRC)
      && !/_camRight|_camUp/.test(SRC),
    'two sources for one frame is how they came apart');
  check('...taken from the placed mesh after its world matrix is current',
    /this\.mesh\.updateMatrixWorld\(true\);[\s\S]{0,200}?setFromMatrixColumn\(this\.mesh\.matrixWorld, 0\)/.test(SRC),
    'reading them before the update gives last frame’s orientation');
  check('and the wheel is faced with the camera WORLD orientation',
    /getWorldQuaternion\(this\._qTmp\)/.test(SRC));
}


// ── THE WHEEL FACES THE HEAD, NOT THE DESKTOP CAMERA ─────────────────────────
//
// matt: "always tilted about 30 degrees away from me to the right." Consistently askew rather
// than randomly wrong, which points at a fixed wrong frame rather than a race. `app._camera`
// is the app's BASE camera, and Camera.js keeps writing its own orbit matrices to it every
// frame even during a session — the spectator modes depend on that — so in XR it carries the
// desktop view. The head is the XR camera.
{
  check('in a session the wheel is faced with the XR camera',
    /if \(app\?\._xrSession && xr\?\.getCamera\)/.test(SRC),
    'the base camera carries the desktop orbit view during XR');
  check('...falling back to the base camera outside one',
    /return app\?\._camera\?\.getThreeCamera\?\.\(\) \|\| null;/.test(SRC),
    'on a flat screen there is no XR camera and the base one IS the view');
  check('and the wheel asks for it rather than reaching past it',
    /const cam = this\._viewCamera\(\);/.test(SRC),
    'one accessor, so the two callers cannot pick different cameras');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
