// POC #2a — single-anchor geodesic deform (desktop). Click the mesh to drop an anchor;
// drag horizontally to rotate the surrounding geodesic region around it, weighted by a
// geodesic falloff (full at the anchor → 0 at the radius). Proves the geodesic-field →
// weighted-vertex-deformation pipeline before the two-handed VR muscle (2b).
//
// Arm from the console: window._poseArm()  /  window._poseDisarm().
// window._poseRadius = fraction (of the field's max distance) the falloff spans (def 0.5).

import * as THREE from 'three';
import { computeGeodesicField, nearestVertexInFace } from './Geodesic.js';

let armed = false;
let active = false;
let mesh = null, field = null, rest = null;
let pivot = [0, 0, 0], radius = 1, axisLocal = new THREE.Vector3(0, 1, 0);
let startX = 0;

function canvas() { return document.getElementById('canvas'); }

function onDown(e) {
  if (!armed || e.button !== 0) return;
  const main = window.app;
  const picking = main && main.getPicking && main.getPicking();
  if (!picking) return;
  // Use SculptGL's own mouse coords (kept current by its move handler) so the hit-test
  // matches exactly.
  if (!picking.intersectionMouseMeshes()) return;

  mesh = picking.getMesh();
  const inter = picking.getIntersectionPoint(); // local/mesh space
  const f = picking.getPickedFace() * 4, fAr = mesh.getFaces(), nbV = mesh.getNbVertices();
  const fv = [fAr[f], fAr[f + 1], fAr[f + 2]];
  if (fAr[f + 3] < nbV) fv.push(fAr[f + 3]);
  const src = nearestVertexInFace(mesh, inter, fv);

  field = computeGeodesicField(mesh, [src]);
  let maxD = 0; for (let i = 0; i < field.length; i++) { const d = field[i]; if (isFinite(d) && d > maxD) maxD = d; }
  radius = (window._poseRadius || 0.5) * (maxD || 1);
  pivot = [inter[0], inter[1], inter[2]];
  rest = new Float32Array(mesh.getVertices().subarray(0, nbV * 3));

  // Rotation axis = world up, expressed in the mesh's local frame (parent-safe).
  const q = new THREE.Quaternion();
  if (mesh.getThreeMesh) mesh.getThreeMesh().getWorldQuaternion(q);
  axisLocal.set(0, 1, 0).applyQuaternion(q.invert()).normalize();

  startX = e.clientX;
  active = true;
  e.preventDefault(); e.stopImmediatePropagation();
}

function deform(angle) {
  const v = mesh.getVertices(), nbV = mesh.getNbVertices();
  const q = new THREE.Quaternion(), tmp = new THREE.Vector3();
  const px = pivot[0], py = pivot[1], pz = pivot[2];
  for (let i = 0; i < nbV; i++) {
    const d = field[i];
    if (!isFinite(d) || d >= radius) continue;
    const t = d / radius, w = 1 - t * t * (3 - 2 * t); // smoothstep: 1 at anchor → 0 at radius
    q.setFromAxisAngle(axisLocal, angle * w);
    tmp.set(rest[i * 3] - px, rest[i * 3 + 1] - py, rest[i * 3 + 2] - pz).applyQuaternion(q);
    v[i * 3] = px + tmp.x; v[i * 3 + 1] = py + tmp.y; v[i * 3 + 2] = pz + tmp.z;
  }
  mesh.updateGeometry();
  if (mesh.isDynamic) mesh.updateBuffers(); else mesh.updateGeometryBuffers();
}

function onMove(e) {
  if (!active) return;
  deform((e.clientX - startX) * 0.005);
  window.app.render();
  e.stopImmediatePropagation();
}

function onUp(e) {
  if (!active) return;
  active = false;
  const m = mesh, restSnap = rest, finalSnap = new Float32Array(m.getVertices().subarray(0, m.getNbVertices() * 3));
  const put = (data) => {
    m.getVertices().set(data);
    m.updateGeometry();
    if (m.isDynamic) m.updateBuffers(); else m.updateGeometryBuffers();
    window.app.render();
  };
  const sm = window.app.getStateManager && window.app.getStateManager();
  if (sm && sm.pushStateCustom) sm.pushStateCustom(() => put(restSnap), () => put(finalSnap), false, 'Geodesic Pose');
  e.stopImmediatePropagation();
}

if (typeof window !== 'undefined') {
  window._poseArm = () => {
    if (armed) return;
    armed = true;
    window._poseArmed = true; // SculptGL.onDeviceDown checks this to suppress sculpting
    const c = canvas();
    c.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    console.log('[pose] armed — click the mesh and drag horizontally. _poseDisarm() to stop.');
  };
  window._poseDisarm = () => {
    armed = false; active = false; window._poseArmed = false;
    const c = canvas();
    c.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    console.log('[pose] disarmed');
  };
}
