import * as THREE from 'three';
import SculptBase from './SculptBase.js';
import { computeGeodesicField, nearestVertexInFace } from '../Geodesic.js';

// Geodesic pose tool. Click A (start of falloff), then click+drag B (end). Two geodesic
// fields give the corridor weight t = clamp((dA - dB + L)/(2L), 0, 1) — behind A locked,
// ramps A→B, beyond B full (candy-cane). Rotation axis is locked to the camera view axis
// and the pivot to A; the cursor's angular sweep around A's screen position is the amount.
// Undo is handled by SculptManager's pushStateGeometry. (Desktop POC; VR is the 2b muscle.)
const _camFwd = new THREE.Vector3();
const _qMesh = new THREE.Quaternion(), _qMeshInv = new THREE.Quaternion();

class GeodesicPoseTool extends SculptBase {
  constructor(main) {
    super(main);
    this._continuous = true; // drag-based — skip the single-action debounce on A→B
    this._phase = 'A';       // 'A' = need the anchor click; 'B' = need the end click+drag
    this._mesh = null;
    this._dA = null; this._dB = null; this._L = 1;
    this._rest = null;
    this._aPoint = [0, 0, 0]; // A (falloff start) — marker + midpoint calc
    this._bPoint = [0, 0, 0]; // B (falloff end) — defines the A→B half-space
    this._pivot = [0, 0, 0];  // rotation pivot = midpoint(A, B) (ZBrush anchor style)
    this._aScreen = [0, 0];   // pivot projected to canvas device px (matches _mouseX/_mouseY)
    this._lastAngle = 0; this._total = 0;
    this._dragging = false;
    this._arrow = null;
    this._dot = null;   // marker at A
    this._line = null;  // A → cursor while choosing B
  }

  // While the anchor A is placed but B isn't yet, show a dot at A and a line to the
  // cursor (driven per-move by SculptManager.preUpdate).
  preUpdate() {
    if (this._phase !== 'B' || this._dragging) return;
    const picking = this._main.getPicking();
    const hit = picking.intersectionMouseMeshes() && picking.getMesh() === this._mesh;
    const inter = hit ? picking.getIntersectionPoint() : null;
    this._showGuide(inter && [inter[0], inter[1], inter[2]]);
    this._main.render();
  }

  _ensureGuides() {
    if (this._dot) return;
    let root = this._mesh.getThreeMesh(); while (root.parent) root = root.parent;
    this._dot = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0x33e0ff, depthTest: false, transparent: true, opacity: 0.9 }));
    // A thin cylinder, not THREE.Line — WebGL ignores line width (always 1px).
    this._line = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 8),
      new THREE.MeshBasicMaterial({ color: 0x88ccff, depthTest: false, transparent: true, opacity: 0.85 }));
    for (const o of [this._dot, this._line]) { o.renderOrder = 10000; o.isPickable = false; root.add(o); }
  }

  _showGuide(hoverLocal) {
    this._ensureGuides();
    const tm = this._mesh.getThreeMesh();
    const sc = new THREE.Vector3(); tm.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), sc);
    // World size of the mesh = local bounding radius × world scale — robust whether the
    // scale lives in the matrix or has been baked into the vertices.
    const g = tm.geometry; if (g && !g.boundingSphere) g.computeBoundingSphere();
    const worldR = ((g && g.boundingSphere && g.boundingSphere.radius) || 1) * sc.x;
    const aW = tm.localToWorld(new THREE.Vector3(this._aPoint[0], this._aPoint[1], this._aPoint[2]));
    this._dot.position.copy(aW); this._dot.scale.setScalar(worldR * 0.04); this._dot.visible = true;
    if (hoverLocal) {
      const hW = tm.localToWorld(new THREE.Vector3(hoverLocal[0], hoverLocal[1], hoverLocal[2]));
      const dir = new THREE.Vector3().subVectors(hW, aW), len = dir.length();
      if (len > 1e-6) {
        this._line.position.copy(aW).addScaledVector(dir, 0.5); // midpoint
        this._line.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
        this._line.scale.set(worldR * 0.006, len, worldR * 0.006); // X/Z = thickness, Y = length
        this._line.visible = true;
      } else this._line.visible = false;
    } else { this._line.visible = false; }
  }

  _hideGuide() { if (this._dot) this._dot.visible = false; if (this._line) this._line.visible = false; }

  _pick() {
    const picking = this._main.getPicking();
    if (!picking.intersectionMouseMeshes()) return null;
    const m = picking.getMesh();
    const inter = picking.getIntersectionPoint();
    const f = picking.getPickedFace() * 4, fAr = m.getFaces(), nbV = m.getNbVertices();
    const fv = [fAr[f], fAr[f + 1], fAr[f + 2]];
    if (fAr[f + 3] < nbV) fv.push(fAr[f + 3]);
    return { mesh: m, src: nearestVertexInFace(m, inter, fv), inter: [inter[0], inter[1], inter[2]] };
  }

  start() {
    const hit = this._pick();
    if (!hit) return false;

    if (this._phase === 'A') {
      this._mesh = hit.mesh;
      this._aPoint = hit.inter;
      this._dA = computeGeodesicField(this._mesh, [hit.src]);
      this._phase = 'B';
      return false; // anchor placed; not a deforming stroke yet
    }

    if (hit.mesh !== this._mesh) return false;
    this._dB = computeGeodesicField(this._mesh, [hit.src]);
    this._L = this._dA[hit.src]; // geodesic A→B
    if (!(this._L > 1e-6)) return false;
    const b = hit.inter; this._bPoint = b; // pivot = spatial midpoint of A and B
    this._pivot = [(this._aPoint[0] + b[0]) / 2, (this._aPoint[1] + b[1]) / 2, (this._aPoint[2] + b[2]) / 2];
    this._rest = new Float32Array(this._mesh.getVertices().subarray(0, this._mesh.getNbVertices() * 3));

    const tcam = this._main.getCamera().getThreeCamera();
    tcam.getWorldDirection(_camFwd); // fixed bend axis = view axis
    const tm = this._mesh.getThreeMesh();
    tm.getWorldQuaternion(_qMesh); _qMeshInv.copy(_qMesh).invert();

    const ndc = tm.localToWorld(new THREE.Vector3(this._pivot[0], this._pivot[1], this._pivot[2])).project(tcam);
    const cw = this._main._canvas.width, ch = this._main._canvas.height;
    this._aScreen = [(ndc.x * 0.5 + 0.5) * cw, (-ndc.y * 0.5 + 0.5) * ch];
    this._lastAngle = Math.atan2(this._main._mouseY - this._aScreen[1], this._main._mouseX - this._aScreen[0]);
    this._total = 0;
    this._dragging = true;
    this._hideGuide(); // the axis arrow at the midpoint pivot takes over
    return true;
  }

  update() {
    if (!this._dragging) return;
    const cur = Math.atan2(this._main._mouseY - this._aScreen[1], this._main._mouseX - this._aScreen[0]);
    let da = cur - this._lastAngle;
    if (da > Math.PI) da -= 2 * Math.PI; else if (da < -Math.PI) da += 2 * Math.PI;
    this._total += da; this._lastAngle = cur;

    const qWorld = new THREE.Quaternion().setFromAxisAngle(_camFwd, this._total);
    const qLocal = _qMeshInv.clone().multiply(qWorld).multiply(_qMesh);
    this._deform(qLocal);
    this._showAxis(qWorld);
    this._main.render();
  }

  end() {
    if (!this._dragging) return;
    this._dragging = false;
    this._phase = 'A'; // ready for the next pose
    this._hideAxis();
    this._hideGuide();

    // Custom undo: we edit getVertices() directly without marking changed verts, so
    // SculptGL's StateGeometry captures nothing — snapshot rest↔final ourselves.
    const m = this._mesh, rest = this._rest;
    const final = new Float32Array(m.getVertices().subarray(0, m.getNbVertices() * 3));
    const put = (data) => {
      m.getVertices().set(data);
      m.updateGeometry();
      if (m.isDynamic) m.updateBuffers(); else m.updateGeometryBuffers();
      this._main.render();
    };
    const sm = this._main.getStateManager && this._main.getStateManager();
    if (sm && sm.pushStateCustom) sm.pushStateCustom(() => put(rest), () => put(final), false, 'Geodesic Pose');
  }

  _deform(qLocal) {
    const mesh = this._mesh, v = mesh.getVertices(), nbV = mesh.getNbVertices();
    const dA = this._dA, dB = this._dB, rest = this._rest;
    const px = this._pivot[0], py = this._pivot[1], pz = this._pivot[2], inv2L = 1 / (2 * this._L);
    const ax = this._aPoint[0], ay = this._aPoint[1], az = this._aPoint[2];
    const dx = this._bPoint[0] - ax, dy = this._bPoint[1] - ay, dz = this._bPoint[2] - az; // A→B
    const invDlen2 = 1 / Math.max(1e-12, dx * dx + dy * dy + dz * dz);
    const band = 0.18, inv2band = 1 / (2 * band); // soft half-space feather (frac of A→B)
    const qi = new THREE.Quaternion(), tmp = new THREE.Vector3();
    for (let i = 0; i < nbV; i++) {
      const a = dA[i], b = dB[i];
      if (!isFinite(a) || !isFinite(b)) continue;
      // Soft half-space: position along A→B, normalised (0 at A, 1 at B), feathered across
      // the A-plane so it can't crease where the flat plane and curved corridor disagree.
      const proj = ((rest[i * 3] - ax) * dx + (rest[i * 3 + 1] - ay) * dy + (rest[i * 3 + 2] - az) * dz) * invDlen2;
      if (proj <= -band) continue; // fully behind A → locked
      let hs = (proj + band) * inv2band; if (hs > 1) hs = 1;
      hs = hs * hs * (3 - 2 * hs);
      let t = (a - b + this._L) * inv2L;
      if (t <= 0) continue; if (t > 1) t = 1;
      const ct = t * t * t * (t * (t * 6 - 15) + 10); // smootherstep (C2 — softer than smoothstep)
      const w = ct * hs;
      qi.set(0, 0, 0, 1).slerp(qLocal, w);
      tmp.set(rest[i * 3] - px, rest[i * 3 + 1] - py, rest[i * 3 + 2] - pz).applyQuaternion(qi);
      v[i * 3] = px + tmp.x; v[i * 3 + 1] = py + tmp.y; v[i * 3 + 2] = pz + tmp.z;
    }
    mesh.updateGeometry();
    if (mesh.isDynamic) mesh.updateBuffers(); else mesh.updateGeometryBuffers();
  }

  _showAxis(qWorld) {
    const tm = this._mesh.getThreeMesh();
    const pw = tm.localToWorld(new THREE.Vector3(this._pivot[0], this._pivot[1], this._pivot[2]));
    const ax = new THREE.Vector3(qWorld.x, qWorld.y, qWorld.z);
    if (ax.lengthSq() < 1e-9) ax.copy(_camFwd); else ax.normalize();
    const sc = new THREE.Vector3(); tm.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), sc);
    const len = this._L * sc.x * 1.5;
    if (!this._arrow) {
      this._arrow = new THREE.ArrowHelper(ax, pw, len, 0xffff00, len * 0.18, len * 0.1);
      let root = tm; while (root.parent) root = root.parent; root.add(this._arrow);
    } else {
      this._arrow.position.copy(pw); this._arrow.setDirection(ax); this._arrow.setLength(len, len * 0.18, len * 0.1);
    }
  }
  _hideAxis() { if (this._arrow && this._arrow.parent) this._arrow.parent.remove(this._arrow); this._arrow = null; }

  updateXR() {}   // VR pose is the 2b muscle
  postRender() {} // no brush cursor; the axis arrow is managed in update/end
}

export default GeodesicPoseTool;
