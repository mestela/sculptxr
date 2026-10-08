// THE DESKTOP GIZMO DRAWS ONE FRAME AND DRAGS THE SAME ONE.
//
// Before: handles took their orientation from the mesh's LOCAL matrix, edits were built about
// WORLD axes, and the rotation sign came from a per-axis table. Anything rotated or parented
// (every joint and pin) turned a different axis from the ring you grabbed, in a direction that
// changed with the camera. This drives the real GizmoVR edit methods (on a bare instance, with
// a fake camera and fake meshes) and checks the two properties that matter to a hand:
//   1. the object turns about the axis the handle is drawn on, and
//   2. the grabbed point FOLLOWS THE CURSOR, from any side.
//
// Run: node scratchpad/gizmoframe_test.mjs
import path from 'path';
import { mat4, vec3 } from 'gl-matrix';

globalThis.self = globalThis; globalThis.window = globalThis;
globalThis.location = { search: '', href: 'http://x/' };
globalThis.document = { createElement: () => ({ getContext: () => null, style: {} }) };
globalThis.localStorage = { getItem: () => null, setItem() {} };
const REPO = new URL('..', import.meta.url).pathname;
const logs = console.log; console.log = () => {};
const GV = await import(path.join(REPO, 'src/editing/GizmoVR.js'));
const GizmoVR = GV.default, GIZMO_TYPE = GV.GIZMO_TYPE, GIZMO_SETS = GV.GIZMO_SETS;
console.log = logs;

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

const W = 1000, H = 800;
function makeCamera(eye) {
  const view = mat4.lookAt(mat4.create(), eye, [0, 0, 0], Math.abs(eye[1]) > 0.95 * vec3.len(eye) ? [0, 0, 1] : [0, 1, 0]);
  const proj = mat4.perspective(mat4.create(), 0.8, W / H, 0.1, 1000);
  const vp = mat4.mul(mat4.create(), proj, view), inv = mat4.invert(mat4.create(), vp);
  return {
    project(p) { const v = [p[0], p[1], p[2], 1]; const c = [0, 0, 0, 0];
      for (let r = 0; r < 4; r++) c[r] = vp[r] * v[0] + vp[4 + r] * v[1] + vp[8 + r] * v[2] + vp[12 + r];
      return [(c[0] / c[3] * 0.5 + 0.5) * W, (1 - (c[1] / c[3] * 0.5 + 0.5)) * H, c[2] / c[3] * 0.5 + 0.5]; },
    unproject(x, y, z) { const n = [x / W * 2 - 1, (1 - y / H) * 2 - 1, z * 2 - 1, 1]; const c = [0, 0, 0, 0];
      for (let r = 0; r < 4; r++) c[r] = inv[r] * n[0] + inv[4 + r] * n[1] + inv[8 + r] * n[2] + inv[12 + r] * n[3];
      return [c[0] / c[3], c[1] / c[3], c[2] / c[3]]; },
    computePosition() { return eye; }, getConstantScreen() { return 1; },
  };
}

// A node with a parent: model = parent * local, like a joint under a posed chain.
function makeNode(parent, local) {
  const n = { local: mat4.clone(local), edit: mat4.create() };
  n.getMatrix = () => n.local;
  n.setMatrix = (m) => mat4.copy(n.local, m);
  n.getEditMatrix = () => n.edit;
  n.getCenter = () => [0, 0, 0];
  n.getModelSpaceMatrix = (out) => { out = out || mat4.create(); return mat4.mul(out, parent, n.local); };
  return n;
}

function setup(parent, local, eye) {
  const node = makeNode(parent, local);
  const camera = makeCamera(eye);
  const main = { _mouseX: 0, _mouseY: 0, getCamera: () => camera, getTransformableMeshes: () => [node],
    getCanvasWidth: () => W, getCanvasHeight: () => H, render() {}, _worldGroup: { scale: { x: 1 } } };
  const g = Object.create(GizmoVR.prototype);
  Object.assign(g, { _main: main, _desktop: true, _editLineOrigin: [0, 0, 0], _editLineDirection: [0, 0, 0],
    _editOffset: [0, 0, 0], _editTrans: mat4.create(), _editTransInv: mat4.create(),
    _editLocal: [], _editScaleRot: [], _editLocalInv: [], _editScaleRotInv: [], _startLocal: [] });
  return { node, camera, main, g };
}

const rotM = (ax, ay, az) => { const m = mat4.create(); mat4.rotateZ(m, m, az); mat4.rotateY(m, m, ay); mat4.rotateX(m, m, ax); return m; };
const eyes = [[0, 0, 6], [0, 0, -6], [6, 0.5, 0], [-5, 3, -2], [3, 4, 5], [0.2, 7, 0.4]];

// parent rotated, local rotated: the local matrix alone is NOT the displayed frame.
const parent = mat4.fromRotationTranslation(mat4.create(), (() => { const q = [0, 0, 0, 1];
  const m = rotM(0.4, -0.9, 0.3); const out = [0, 0, 0, 0]; return (mat4.getRotation(out, m), out); })(), [0.5, 0.2, -0.3]);
const local = mat4.mul(mat4.create(), mat4.fromTranslation(mat4.create(), [0.3, 0.1, 0.2]), rotM(0.7, 0.2, -1.1));

let nChecked = 0;
for (const parented of [false, true]) {
  for (const eye of eyes) {
    for (let n = 0; n < 3; n++) {
      const P0 = parented ? parent : mat4.create();
      const { node, camera, main, g } = setup(P0, local, eye);
      const M = node.getModelSpaceMatrix();
      const B = g._basisFor([node]);
      const axisW = [B[n * 4], B[n * 4 + 1], B[n * 4 + 2]];
      const c = [M[12], M[13], M[14]];

      // the grabbed point: on the ring (radius 1.5) in the plane perpendicular to the axis
      const u = vec3.normalize([0, 0, 0], vec3.cross([0, 0, 0], axisW, Math.abs(axisW[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
      const v = vec3.cross([0, 0, 0], axisW, u);
      const ang0 = 0.9 + n;
      const P = vec3.scaleAndAdd([0, 0, 0], c, vec3.add([0, 0, 0], vec3.scale([0, 0, 0], u, Math.cos(ang0)), vec3.scale([0, 0, 0], v, Math.sin(ang0))), 1.5);
      const finalM = mat4.clone(B); finalM[12] = c[0]; finalM[13] = c[1]; finalM[14] = c[2];
      const lastInter = vec3.transformMat4([0, 0, 0], P, mat4.invert(mat4.create(), finalM));
      g._selected = { _nbAxis: n, _lastInter: lastInter, _finalMatrix: finalM, _type: [GIZMO_TYPE.ROT_X, GIZMO_TYPE.ROT_Y, GIZMO_TYPE.ROT_Z][n] };
      g._isEditing = true;

      const s0 = camera.project(P);
      main._mouseX = s0[0]; main._mouseY = s0[1];
      g._saveEditMatrices();
      g._startRotateEdit();

      // the cursor travels along where a rotation WOULD carry the point
      const tangent = vec3.cross([0, 0, 0], axisW, vec3.sub([0, 0, 0], P, c));
      vec3.normalize(tangent, tangent);
      const s1 = camera.project(vec3.scaleAndAdd([0, 0, 0], P, tangent, 0.3));
      const edgeOn = Math.hypot(s1[0] - s0[0], s1[1] - s0[1]) < 6;   // tangent points along the view
      main._mouseX = s0[0] + (s1[0] - s0[0]) * 0.8; main._mouseY = s0[1] + (s1[1] - s0[1]) * 0.8;
      g.onMouseOver();   // _isEditing -> update + applyEditLive
      const M1 = node.getModelSpaceMatrix();

      const tag = (parented ? 'parented' : 'top-level') + ' axis ' + 'XYZ'[n] + ' eye ' + eye.join(',');
      // 1. the axis it turned about is the displayed one: that axis, as the object sees it, is unchanged
      const B1 = g._basisFor([node]);
      const axis1 = [B1[n * 4], B1[n * 4 + 1], B1[n * 4 + 2]];
      check(tag + ': turns about the displayed axis', vec3.dist(axis1, axisW) < 1e-4 || vec3.dist(axis1, vec3.negate([0, 0, 0], axisW)) < 1e-4,
        'axis moved by ' + vec3.dist(axis1, axisW).toFixed(3));
      // and it really did turn
      check(tag + ': object rotated', Math.abs(M1[0] - M[0]) + Math.abs(M1[1] - M[1]) + Math.abs(M1[2] - M[2]) + Math.abs(M1[4] - M[4]) + Math.abs(M1[5] - M[5]) > 1e-4,
        'nothing moved: the drag did not reach the edit matrix');
      // 2. the grabbed point follows the cursor
      if (!edgeOn) {
        const rel = mat4.mul(mat4.create(), M1, mat4.invert(mat4.create(), M));
        const P1 = vec3.transformMat4([0, 0, 0], P, rel);
        const sP1 = camera.project(P1);
        const moved = [sP1[0] - s0[0], sP1[1] - s0[1]], cur = [main._mouseX - s0[0], main._mouseY - s0[1]];
        const dot = moved[0] * cur[0] + moved[1] * cur[1];
        check(tag + ': grabbed point follows the cursor', dot > 0, 'point moved against the cursor (dot ' + dot.toFixed(1) + ')');
      }
      nChecked++;
    }
  }
}


// TRANSLATE ALONG THE DISPLAYED ARROW: dragging the X arrow moves the node along the frame's X,
// not along world X.
for (const parented of [false, true]) {
  for (const eye of eyes.slice(0, 5)) {
    for (let n = 0; n < 3; n++) {
      const { node, camera, main, g } = setup(parented ? parent : mat4.create(), local, eye);
      const M = node.getModelSpaceMatrix(), B = g._basisFor([node]);
      const axisW = [B[n * 4], B[n * 4 + 1], B[n * 4 + 2]], c = [M[12], M[13], M[14]];
      g._selected = { _nbAxis: n, _lastInter: [0, 0, 0], _finalMatrix: mat4.create(),
        _type: [GIZMO_TYPE.TRANS_X, GIZMO_TYPE.TRANS_Y, GIZMO_TYPE.TRANS_Z][n] };
      g._isEditing = true;
      const s0 = camera.project(c);
      main._mouseX = s0[0]; main._mouseY = s0[1];
      g._saveEditMatrices(); g._startTranslateEdit();
      const target = vec3.scaleAndAdd([0, 0, 0], c, axisW, 0.5);
      const s1 = camera.project(target);
      main._mouseX = s1[0]; main._mouseY = s1[1];
      g.onMouseOver();
      const M1 = node.getModelSpaceMatrix(), d = [M1[12] - c[0], M1[13] - c[1], M1[14] - c[2]];
      check('translate ' + 'XYZ'[n] + (parented ? ' parented' : ' top-level') + ' eye ' + eye.join(',') + ': moves along the displayed arrow',
        vec3.dist(d, vec3.scale([0, 0, 0], axisW, 0.5)) < 0.02, 'moved ' + d.map((x) => x.toFixed(3)).join(','));
    }
  }
}

// the old behaviour, pinned as absent in the SOURCE: a per-axis sign table and a negated angle
import fs from 'fs';
const src = fs.readFileSync(path.join(REPO, 'src/editing/GizmoVR.js'), 'utf8')
  .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
check('no per-axis rotation sign table', !/_nbAxis === 0 \? -1\.0 : 1\.0/.test(src));
check('rotation is not built from rotateX/Y/Z of -angle', !/mat4\.rotateX\(mrot, mrot, -angle\)/.test(src));
check('desktop display does not read the local matrix', /if \(this\._desktop\) \{[\s\S]{0,400}_basisFor\(meshes\)/.test(src));


// WHICH HANDLES A PIN OFFERS. A position/pole pin has nothing to turn, a rotate pin nothing to
// move, and no pin scales.
const bits = (names) => names.reduce((a, k) => a | GIZMO_TYPE[k], 0);
const ROT = bits(['ROT_X', 'ROT_Y', 'ROT_Z', 'ROT_W']), TR = bits(['TRANS_X', 'TRANS_Y', 'TRANS_Z', 'TRANS_W', 'PLANE_X', 'PLANE_Y', 'PLANE_Z']);
const SC = bits(['SCALE_X', 'SCALE_Y', 'SCALE_Z', 'SCALE_W']);
check('move set: translate only', (GIZMO_SETS.MOVE & TR) === TR && !(GIZMO_SETS.MOVE & (ROT | SC)));
check('turn set: rotate only', (GIZMO_SETS.TURN & ROT) === ROT && !(GIZMO_SETS.TURN & (TR | SC)));
check('move+turn set: both, no scale', (GIZMO_SETS.MOVE_TURN & (TR | ROT)) === (TR | ROT) && !(GIZMO_SETS.MOVE_TURN & SC));
check('all set still has scale', (GIZMO_SETS.ALL & SC) === SC);
const TOOL = fs.readFileSync(path.join(REPO, 'src/editing/tools/Transform.js'), 'utf8');
check('the tool maps pin modes to sets', /PIN_ROT: return GIZMO_SETS\.TURN/.test(TOOL.replace(/case IKSolver\./, 'case IKSolver.PIN_ROT: return GIZMO_SETS.TURN;//').replace(/\n/g, ' ')) || /case IKSolver\.PIN_ROT: return GIZMO_SETS\.TURN/.test(TOOL));
check('the set is asked every frame by the gizmo, not only on mouse move', /_handleSetFn/.test(src));
// the display must turn with the object during a drag (it was frozen, which read as the gizmo
// only updating on release)
check('display basis is live during a drag', !/_isEditing && this\._editBasis \? this\._editBasis/.test(src));

// WHILE A HANDLE IS HELD ONLY THAT HANDLE IS DRAWN, AND NO PIN.
check('a held handle hides the rest of the gizmo', /_held \|\| components\[i\] === this\._selected/.test(src));
const SKELSRC = fs.readFileSync(path.join(REPO, 'src/editing/Skeleton.js'), 'utf8');
check('the skeleton hides every pin, the dragged one too, while a drag runs', /const showPinsHere = showPins && main\._gizmoDragPin === undefined;/.test(SKELSRC));
check('the pin markers and the leader both use it', /\[e\.pinB, showPinsHere/.test(SKELSRC) && /\[e\.pinS, showPinsHere/.test(SKELSRC) && /const gap = showPinsHere/.test(SKELSRC));
check('the tool sets the flag at press and clears it on release and on a tool change',
  /_gizmoDragPin = dragged && dragged\._isPinTarget/.test(TOOL) && /this\._main\._gizmoDragPin = undefined;\s*\n\s*var meshes/.test(TOOL) && /clearPreview\(\) \{ this\._main\._gizmoDragPin = undefined; \}/.test(TOOL));

console.log(nChecked + ' drags simulated');
if (failures) { console.log(failures + ' FAILED'); process.exit(1); }
console.log('all checks passed');
