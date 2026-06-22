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
let phase = 'A'; // 'A' = waiting for the anchor click; 'B' = waiting for the end click+drag
let mesh = null, dA = null, dB = null, L = 1, rest = null;
let pivot = [0, 0, 0]; // A's surface point — the locked base + rotation pivot
let startX = 0, startY = 0;
let pScreenX = 0, pScreenY = 0, lastAngle = 0, totalAngle = 0;
const camFwd = new THREE.Vector3();
const qMesh = new THREE.Quaternion(), qMeshInv = new THREE.Quaternion();

function canvas() { return document.getElementById('canvas'); }

// Pick the surface vertex under the cursor → { mesh, src, inter(local point) } or null.
function pickSrc(picking) {
  if (!picking.intersectionMouseMeshes()) return null; // SculptGL's own mouse coords
  const m = picking.getMesh();
  const inter = picking.getIntersectionPoint();
  const f = picking.getPickedFace() * 4, fAr = m.getFaces(), nbV = m.getNbVertices();
  const fv = [fAr[f], fAr[f + 1], fAr[f + 2]];
  if (fAr[f + 3] < nbV) fv.push(fAr[f + 3]);
  return { mesh: m, src: nearestVertexInFace(m, inter, fv), inter: [inter[0], inter[1], inter[2]] };
}

function onDown(e) {
  if (!armed || e.button !== 0) return;
  const main = window.app;
  const picking = main && main.getPicking && main.getPicking();
  if (!picking) return;
  const hit = pickSrc(picking);
  if (!hit) return;
  e.preventDefault(); e.stopImmediatePropagation();

  if (phase === 'A') {
    mesh = hit.mesh;
    pivot = hit.inter;
    dA = computeGeodesicField(mesh, [hit.src]); // geodesic field from A
    phase = 'B';
    console.log('[pose] anchor A set — now click+drag the END point (B). Behind A locks; beyond B = full.');
    return;
  }

  // phase 'B': place the end point, then drag deforms.
  if (hit.mesh !== mesh) return;
  dB = computeGeodesicField(mesh, [hit.src]); // geodesic field from B
  L = dA[hit.src];                            // geodesic distance A→B
  if (!(L > 1e-6)) { console.warn('[pose] A and B too close'); return; }
  rest = new Float32Array(mesh.getVertices().subarray(0, mesh.getNbVertices() * 3));

  // Camera basis + mesh world rotation captured at grab → 2D drag becomes a
  // camera-relative rotation of the local-space verts.
  const tcam = main.getCamera().getThreeCamera();
  tcam.getWorldDirection(camFwd); // FIXED bend axis = view axis (into the screen)
  if (mesh.getThreeMesh) mesh.getThreeMesh().getWorldQuaternion(qMesh);
  qMeshInv.copy(qMesh).invert();

  // Project A to screen; the cursor's angular sweep around it drives the bend amount.
  const pw = mesh.getThreeMesh().localToWorld(new THREE.Vector3(pivot[0], pivot[1], pivot[2])).project(tcam);
  const rect = canvas().getBoundingClientRect();
  pScreenX = rect.left + (pw.x * 0.5 + 0.5) * rect.width;
  pScreenY = rect.top + (-pw.y * 0.5 + 0.5) * rect.height;
  startX = e.clientX; startY = e.clientY;
  lastAngle = Math.atan2(startY - pScreenY, startX - pScreenX);
  totalAngle = 0;
  active = true;
}

// Two-point corridor deform: t = clamp((dA - dB + L)/(2L), 0, 1) — 0 behind A, ramps
// A→B, 1 beyond B. Each vertex rotates by smoothstep(t)·qLocal around A.
function deform(qLocal) {
  const v = mesh.getVertices(), nbV = mesh.getNbVertices();
  const qi = new THREE.Quaternion(), tmp = new THREE.Vector3();
  const px = pivot[0], py = pivot[1], pz = pivot[2];
  const inv2L = 1 / (2 * L);
  for (let i = 0; i < nbV; i++) {
    const a = dA[i], b = dB[i];
    if (!isFinite(a) || !isFinite(b)) continue;
    let t = (a - b + L) * inv2L;
    if (t <= 0) continue;            // behind A → locked
    if (t > 1) t = 1;                // beyond B → full
    const w = t * t * (3 - 2 * t);
    qi.set(0, 0, 0, 1).slerp(qLocal, w);
    tmp.set(rest[i * 3] - px, rest[i * 3 + 1] - py, rest[i * 3 + 2] - pz).applyQuaternion(qi);
    v[i * 3] = px + tmp.x; v[i * 3 + 1] = py + tmp.y; v[i * 3 + 2] = pz + tmp.z;
  }
  mesh.updateGeometry();
  if (mesh.isDynamic) mesh.updateBuffers(); else mesh.updateGeometryBuffers();
}

// Debug: yellow arrow at the pivot (A) along the live world rotation axis.
let arrow = null;
function showAxis(qWorld) {
  const tm = mesh.getThreeMesh();
  const pw = tm.localToWorld(new THREE.Vector3(pivot[0], pivot[1], pivot[2]));
  const ax = new THREE.Vector3(qWorld.x, qWorld.y, qWorld.z);
  if (ax.lengthSq() < 1e-9) ax.copy(camFwd); else ax.normalize();
  const sc = new THREE.Vector3(); tm.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), sc);
  const len = L * sc.x * 1.5;
  if (!arrow) {
    arrow = new THREE.ArrowHelper(ax, pw, len, 0xffff00, len * 0.18, len * 0.1);
    let root = tm; while (root.parent) root = root.parent; root.add(arrow);
  } else {
    arrow.position.copy(pw); arrow.setDirection(ax); arrow.setLength(len, len * 0.18, len * 0.1);
  }
}
function hideAxis() { if (arrow && arrow.parent) arrow.parent.remove(arrow); arrow = null; }

function onMove(e) {
  if (!active) return;
  // Accumulate the cursor's angular sweep around A (handles wrap past ±180°). The fixed
  // view axis is the rotation axis; the swept angle is the amount.
  const cur = Math.atan2(e.clientY - pScreenY, e.clientX - pScreenX);
  let da = cur - lastAngle;
  if (da > Math.PI) da -= 2 * Math.PI; else if (da < -Math.PI) da += 2 * Math.PI;
  totalAngle += da; lastAngle = cur;

  const qWorld = new THREE.Quaternion().setFromAxisAngle(camFwd, totalAngle);
  const qLocal = qMeshInv.clone().multiply(qWorld).multiply(qMesh);
  deform(qLocal);
  showAxis(qWorld);
  window.app.render();
  e.stopImmediatePropagation();
}

function onUp(e) {
  if (!active) return;
  active = false;
  phase = 'A'; // ready for the next pose (click A, then click+drag B)
  hideAxis();
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
    armed = true; phase = 'A';
    window._poseArmed = true; // SculptGL.onDeviceDown checks this to suppress sculpting
    const c = canvas();
    c.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    console.log('[pose] armed — click A (falloff start), then click+drag B (end). _poseDisarm() to stop.');
  };
  window._poseDisarm = () => {
    armed = false; active = false; phase = 'A'; window._poseArmed = false;
    const c = canvas();
    c.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    console.log('[pose] disarmed');
  };
}
