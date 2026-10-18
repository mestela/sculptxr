import * as THREE from 'three';
import { vec3 } from 'gl-matrix';
import Skeleton from './Skeleton.js';
import { gizmoFrameFor } from './JointFrame.js';
import { gizmoBasis } from './gizmoMath.js';

// THE SELECTED JOINT'S (OR OBJECT'S) AXES AS STICKS: X red, Y green, Z blue. Drawn while Transform's Edit Axes is
// on, so what the rings are turning is on screen as the thing itself, live through the drag.
//
// Solid saturated bars, a little longer than the gizmo's rings so their tips show past them, and
// transparent with a top renderOrder -- every rig marker is transparent, and within that pass the
// order is the only thing that puts one in front of another (the selected-joint ball covered the
// first, thin version).
//
// Desktop only because stock materials become node materials under the WebGPU renderer, and those
// are not safe to draw in an immersive session (see reference_webgpu_meshbasic_broken).

const PAST_RING = 1.3;   // stick length / ring radius on screen
const THICK = 0.035;     // bar thickness as a fraction of its length

let _tripod = null;

function build() {
  const g = new THREE.Group();
  g.name = 'joint_axes';
  g.matrixAutoUpdate = false;
  const cols = [0xff2a2a, 0x22e04a, 0x2f7bff];
  for (let a = 0; a < 3; a++) {
    const size = [THICK, THICK, THICK];
    size[a] = 1;
    const geo = new THREE.BoxGeometry(size[0], size[1], size[2]);
    const off = [0, 0, 0]; off[a] = 0.5;
    geo.translate(off[0], off[1], off[2]);
    const mat = new THREE.MeshBasicMaterial({ color: cols[a], transparent: true, opacity: 1,
      depthTest: false, depthWrite: false });
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = 10000;
    m.frustumCulled = false;
    g.add(m);
  }
  return g;
}

// `tool` is the Transform tool: its gizmo's ring radius sets the length, and it says which nodes
// have axes to edit -- an object as well as a joint (matt, 2026-10-18). An object's sticks sit on
// its pivot, where the gizmo is too (Transform._pivotAt), in the frame the gizmo is drawn in, live
// through the drag (Transform._frameFor).
export function updateAxisTripod(main, show, tool) {
  const sel = main.getSelectedMeshes?.() || [];
  const node = sel.length === 1 && tool?._editAxesOn?.(sel[0]) ? sel[0] : null;
  if (!(show && node && !main._xrSession)) { if (_tripod) _tripod.visible = false; return; }
  const gizmo = tool._gizmo;
  const parent = main._worldGroup || main._scene;
  if (!_tripod) _tripod = build();
  if (_tripod.parent !== parent) parent.add(_tripod);
  const M = node.getModelSpaceMatrix();
  const F = Skeleton.isJoint(node) ? gizmoFrameFor(main, node, Skeleton)
    : (tool._frameFor(node) || gizmoBasis(M));
  const P = Skeleton.isJoint(node) ? [M[12], M[13], M[14]] : gizmo._computeCenterGizmo();
  // Pixels -> model units by the transform gizmo's own rule (GizmoVR.update).
  const cam = main.getCamera();
  const d = vec3.dist(cam.computePosition(), P);
  const wpp = cam.worldPerPixel ? cam.worldPerPixel(d) : (2 * d) / cam.getConstantScreen();
  let px = 80;
  try { px = gizmo._gizmoScreenRadius().r * PAST_RING || px; } catch (e) { /* no gizmo yet */ }
  const s = px * wpp;
  const e = _tripod.matrix.elements;
  for (let a = 0; a < 3; a++) {
    e[a * 4] = F[a * 4] * s; e[a * 4 + 1] = F[a * 4 + 1] * s; e[a * 4 + 2] = F[a * 4 + 2] * s; e[a * 4 + 3] = 0;
  }
  e[12] = P[0]; e[13] = P[1]; e[14] = P[2]; e[15] = 1;
  _tripod.matrixWorldNeedsUpdate = true;
  _tripod.visible = true;
}
