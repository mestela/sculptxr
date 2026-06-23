import * as THREE from 'three';
import SculptBase from './SculptBase.js';
import Geometry from '../../math3d/Geometry.js';
import { computeGeodesicField, nearestVertexInFace } from '../Geodesic.js';

// Geodesic pose tool. Click A (start of falloff), then click+drag B (end). Two geodesic
// fields give the corridor weight t = clamp((dA - dB + L)/(2L), 0, 1) — behind A locked,
// ramps A→B, beyond B full (candy-cane). Rotation axis is locked to the camera view axis
// and the pivot to A; the cursor's angular sweep around A's screen position is the amount.
// Undo is handled by SculptManager's pushStateGeometry. (Desktop POC; VR is the 2b muscle.)
const _camFwd = new THREE.Vector3();
const _qMesh = new THREE.Quaternion(), _qMeshInv = new THREE.Quaternion();
// VR scratch — reused per frame so the grab loop allocates nothing.
const _oneVec = new THREE.Vector3(1, 1, 1);
const _ctrlPos = new THREE.Vector3(), _ctrlQuat = new THREE.Quaternion();
const _mCtrlWorld = new THREE.Matrix4();
const _dPos = new THREE.Vector3(), _dQuat = new THREE.Quaternion(), _dScl = new THREE.Vector3();

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
    this._w = null;     // precomputed per-vertex corridor weight (shared desktop + VR)
    this._sym = null;   // mirror corridor { w, pivot, n(unit), reflect } when symmetry is on
    // VR (POC 2b muscle): trigger-edge place A→B, then 6DOF controller grab deforms the band.
    this._wasXRPressed = false;
    this._xrGrabbing = false;
    this._maintainLength = false; // A-button toggle: keep only the controller's rotation
    this._wasAPressed = false;
    this._invModel = new THREE.Matrix4(); // mesh engine→local, captured at grab start
    this._cl0Inv = new THREE.Matrix4();   // inverse of the controller's local frame at grab start
  }

  // While the anchor A is placed but B isn't yet, show a dot at A and a line to the
  // cursor (driven per-move by SculptManager.preUpdate).
  preUpdate() {
    // In VR the mouse pick below would clobber the controller ray pick that updateXR reads
    // this same frame — the VR guide is driven from updateXR instead.
    if (this._main._xrSession) return;
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
    if (this._main._xrSession) return false; // VR drives A/B + grab entirely from updateXR
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
    this._computeWeights();

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
    this._commitUndo();
  }

  // Custom undo: we edit getVertices() directly without marking changed verts, so
  // SculptGL's StateGeometry captures nothing — snapshot rest↔final ourselves.
  _commitUndo() {
    const m = this._mesh, rest = this._rest;
    if (!m || !rest) return;
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

  // Corridor weight per vertex — geodesic span t (smootherstep) × soft A-plane half-space.
  // Depends only on the geodesic fields, A/B and the rest pose, so it is computed once when
  // B is placed and reused every frame by the desktop bend and the VR grab. Pure given the
  // fields/anchors, so the mirror corridor reuses it verbatim.
  _corridorWeights(dA, dB, L, aPt, bPt) {
    const nbV = this._mesh.getNbVertices(), rest = this._rest;
    const inv2L = 1 / (2 * L);
    const ax = aPt[0], ay = aPt[1], az = aPt[2];
    const dx = bPt[0] - ax, dy = bPt[1] - ay, dz = bPt[2] - az; // A→B
    const dlen2 = Math.max(1e-12, dx * dx + dy * dy + dz * dz), invDlen2 = 1 / dlen2;
    const band = 0.18, inv2band = 1 / (2 * band); // soft half-space feather (frac of A→B)
    // Lateral tube limit: keep the influence on the A→B limb instead of letting "past B"
    // flood the whole side at a junction (e.g. a short shoulder corridor). Distance from the
    // A→B line; width auto-scales with the chord. Tune live: window._poseLatFull/_poseLatZero.
    const chord = Math.sqrt(dlen2);
    const latFull = chord * (window._poseLatFull ?? 1.5);
    const latZero = chord * (window._poseLatZero ?? 4.0);
    const invLatSpan = 1 / Math.max(1e-9, latZero - latFull);
    const w = new Float32Array(nbV);
    for (let i = 0; i < nbV; i++) {
      const a = dA[i], b = dB[i];
      if (!isFinite(a) || !isFinite(b)) continue;
      const rxA = rest[i * 3] - ax, ryA = rest[i * 3 + 1] - ay, rzA = rest[i * 3 + 2] - az;
      // Soft half-space: position along A→B, normalised (0 at A, 1 at B), feathered across
      // the A-plane so it can't crease where the flat plane and curved corridor disagree.
      const proj = (rxA * dx + ryA * dy + rzA * dz) * invDlen2;
      if (proj <= -band) continue; // fully behind A → locked
      let hs = (proj + band) * inv2band; if (hs > 1) hs = 1;
      hs = hs * hs * (3 - 2 * hs);
      let t = (a - b + L) * inv2L;
      if (t <= 0) continue; if (t > 1) t = 1;
      const ct = t * t * t * (t * (t * 6 - 15) + 10); // smootherstep (C2 — softer than smoothstep)
      // perpendicular distance from the A→B line (proj·d is the projection vector)
      const ppx = rxA - dx * proj, ppy = ryA - dy * proj, ppz = rzA - dz * proj;
      const perp = Math.sqrt(ppx * ppx + ppy * ppy + ppz * ppz);
      let lat = 1 - (perp - latFull) * invLatSpan;
      if (lat <= 0) continue; if (lat > 1) lat = 1;
      lat = lat * lat * (3 - 2 * lat); // smoothstep
      w[i] = ct * hs * lat;
    }
    return w;
  }

  // Build the primary corridor (sets _dA/_dB/_L/_pivot/_w) from two surface source verts.
  _computeWeights() {
    this._w = this._corridorWeights(this._dA, this._dB, this._L, this._aPoint, this._bPoint);
    this._buildSym();
  }

  // Brute-force nearest rest vertex to a local-space point (placement-time only).
  _nearestVertex(p) {
    const rest = this._rest, nbV = this._mesh.getNbVertices();
    let best = -1, bestD = Infinity;
    for (let i = 0; i < nbV; i++) {
      const dx = rest[i * 3] - p[0], dy = rest[i * 3 + 1] - p[1], dz = rest[i * 3 + 2] - p[2];
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  // Householder reflection across plane (p0, unit n) as a local-space 4x4. R = R^-1.
  _reflectionMatrix(p0, n) {
    const inv = 1 / Math.hypot(n[0], n[1], n[2]);
    const a = n[0] * inv, b = n[1] * inv, c = n[2] * inv;
    const d = -(a * p0[0] + b * p0[1] + c * p0[2]); // plane a x + b y + c z + d = 0
    return new THREE.Matrix4().set(
      1 - 2 * a * a, -2 * a * b, -2 * a * c, -2 * a * d,
      -2 * a * b, 1 - 2 * b * b, -2 * b * c, -2 * b * d,
      -2 * a * c, -2 * b * c, 1 - 2 * c * c, -2 * c * d,
      0, 0, 0, 1);
  }

  // When symmetry is enabled, mirror A/B across the mesh plane, build the matching corridor,
  // and cache the reflection so the live delta can be mirrored each frame. Same mesh + rest.
  _buildSym() {
    this._sym = null;
    if (!this._main.getSculptManager().getSymmetry()) return;
    const m = this._mesh, p0 = m.getSymmetryOrigin(), n = m.getSymmetryNormal();
    const aS = this._aPoint.slice(); Geometry.mirrorPoint(aS, p0, n);
    const bS = this._bPoint.slice(); Geometry.mirrorPoint(bS, p0, n);
    const srcA = this._nearestVertex(aS), srcB = this._nearestVertex(bS);
    if (srcA < 0 || srcB < 0) return;
    const dA = computeGeodesicField(m, [srcA]);
    const dB = computeGeodesicField(m, [srcB]);
    const L = dA[srcB];
    if (!(L > 1e-6)) return;
    const inv = 1 / Math.hypot(n[0], n[1], n[2]);
    this._sym = {
      w: this._corridorWeights(dA, dB, L, aS, bS),
      pivot: [(aS[0] + bS[0]) / 2, (aS[1] + bS[1]) / 2, (aS[2] + bS[2]) / 2],
      n: new THREE.Vector3(n[0] * inv, n[1] * inv, n[2] * inv),
      reflect: this._reflectionMatrix(p0, n),
    };
  }

  // Desktop: rotate the band about the A/B midpoint by qLocal, weighted per vertex. With
  // symmetry, a mirrored rotation (reflected axis, negated angle) is accumulated about the
  // mirror pivot — displacements add, so the seam near the plane sums cleanly.
  _deform(qLocal) {
    const mesh = this._mesh, v = mesh.getVertices(), nbV = mesh.getNbVertices();
    const rest = this._rest;
    const lanes = [{ w: this._w, q: qLocal, p: this._pivot }];
    if (this._sym) lanes.push({ w: this._sym.w, q: this._mirrorQuat(qLocal, this._sym.n), p: this._sym.pivot });
    const qi = new THREE.Quaternion(), tmp = new THREE.Vector3();
    for (let i = 0; i < nbV; i++) {
      const rx = rest[i * 3], ry = rest[i * 3 + 1], rz = rest[i * 3 + 2];
      let ox = 0, oy = 0, oz = 0, moved = false;
      for (let k = 0; k < lanes.length; k++) {
        const wi = lanes[k].w[i];
        if (wi <= 0) continue;
        moved = true;
        const p = lanes[k].p;
        qi.set(0, 0, 0, 1).slerp(lanes[k].q, wi);
        tmp.set(rx - p[0], ry - p[1], rz - p[2]).applyQuaternion(qi);
        ox += p[0] + tmp.x - rx; oy += p[1] + tmp.y - ry; oz += p[2] + tmp.z - rz;
      }
      if (!moved) continue;
      v[i * 3] = rx + ox; v[i * 3 + 1] = ry + oy; v[i * 3 + 2] = rz + oz;
    }
    mesh.updateGeometry();
    if (mesh.isDynamic) mesh.updateBuffers(); else mesh.updateGeometryBuffers();
  }

  // Reflect a local-space rotation across the symmetry plane (unit normal nHat): the mirrored
  // rotation has the axis reflected and the angle negated (R' = S R S, S improper).
  _mirrorQuat(q, nHat) {
    const ax = new THREE.Vector3(q.x, q.y, q.z);
    const s = ax.length();
    if (s < 1e-9) return q.clone(); // identity
    const angle = 2 * Math.atan2(s, q.w);
    ax.multiplyScalar(1 / s);
    ax.addScaledVector(nHat, -2 * ax.dot(nHat)); // reflect axis vector
    return new THREE.Quaternion().setFromAxisAngle(ax, -angle);
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

  // ---- VR (POC 2b muscle) -------------------------------------------------
  // Same two-anchor corridor as desktop, but the bend is a real 6DOF grab: place A and B
  // with trigger-press edges via the VR ray, then HOLD on B and move/twist the controller —
  // the band follows the controller's delta transform (LBS, one bone = the hand).
  updateXR(picking, isPressed, origin, dir, options) {
    const q = (options && options.quat) || this._main._vrControllerQuat;
    const down = isPressed && !this._wasXRPressed;
    const up = !isPressed && this._wasXRPressed;
    this._wasXRPressed = isPressed;

    // A button (dominant hand) toggles maintain-length: keep only the controller's rotation
    // about the anchor (no stretch), matching the desktop bend. Off = full 6DOF.
    const aPressed = this._readAButton(options);
    if (aPressed && !this._wasAPressed) {
      this._maintainLength = !this._maintainLength;
      console.log('[Pose] maintain-length:', this._maintainLength ? 'ON' : 'OFF');
      if (window.screenLog) window.screenLog('Pose: maintain length ' + (this._maintainLength ? 'ON' : 'OFF'), 'cyan');
    }
    this._wasAPressed = aPressed;

    if (down) {
      const hit = this._pickXR(picking);
      if (this._phase === 'A') {
        if (hit) {
          this._mesh = hit.mesh;
          this._aPoint = hit.inter;
          this._dA = computeGeodesicField(this._mesh, [hit.src]);
          this._phase = 'B';
        }
      } else if (this._phase === 'B' && hit && hit.mesh === this._mesh && origin && q) {
        this._dB = computeGeodesicField(this._mesh, [hit.src]);
        this._L = this._dA[hit.src]; // geodesic A→B
        if (this._L > 1e-6) {
          const b = hit.inter; this._bPoint = b;
          this._pivot = [(this._aPoint[0] + b[0]) / 2, (this._aPoint[1] + b[1]) / 2, (this._aPoint[2] + b[2]) / 2];
          this._rest = new Float32Array(this._mesh.getVertices().subarray(0, this._mesh.getNbVertices() * 3));
          this._computeWeights();
          // Capture the controller's rest frame in mesh-local space. Per frame we build the
          // live local frame and take delta = live · inv(rest) — one rigid "bone" transform.
          this._invModel.fromArray(this._mesh.getModelSpaceMatrix()).invert();
          this._cl0Inv.copy(this._controllerLocalMatrix(origin, q)).invert();
          this._xrGrabbing = true;
          this._hideGuide();
        }
      }
    }

    if (isPressed && this._xrGrabbing && origin && q) {
      // delta = controllerLocalNow · inv(controllerLocalRest)
      let delta = this._controllerLocalMatrix(origin, q).multiply(this._cl0Inv);
      if (this._maintainLength) delta = this._rotationAboutPivot(delta);
      this._deformXR(delta);
      this.updateRender();
    } else if (!isPressed && this._phase === 'B' && !this._xrGrabbing) {
      const hit = this._pickXR(picking); // A placed, choosing B — show the dot + reach line
      this._showGuide(hit && hit.mesh === this._mesh ? hit.inter : null);
    }

    if (up && this._xrGrabbing) {
      this._xrGrabbing = false;
      this._phase = 'A'; // ready for the next pose
      this._hideGuide();
      this._commitUndo();
    }
  }

  // Read the VR ray pick (already resolved into `picking` by Scene.handleXRInput this frame).
  // Mirrors _pick() but never mouse-picks. Returns the nearest face vertex as the geo source.
  _pickXR(picking) {
    const m = picking.getMesh();
    if (!m) return null;
    const inter = picking.getIntersectionPoint();
    const face = picking.getPickedFace();
    if (!inter || face === undefined || face < 0) return null;
    const f = face * 4, fAr = m.getFaces(), nbV = m.getNbVertices();
    const fv = [fAr[f], fAr[f + 1], fAr[f + 2]];
    if (fAr[f + 3] < nbV) fv.push(fAr[f + 3]);
    return { mesh: m, src: nearestVertexInFace(m, inter, fv), inter: [inter[0], inter[1], inter[2]] };
  }

  // Dominant-hand A button (buttons[4]) from the per-controller gamepad state in options.
  _readAButton(options) {
    const ctrls = options && options.controllers;
    if (!ctrls) return false;
    const hand = options.handedness;
    for (let i = 0; i < ctrls.length; i++) {
      const c = ctrls[i];
      if (c.handedness === hand && c.buttons && c.buttons[4]) return !!c.buttons[4].pressed;
    }
    return false;
  }

  // Strip the translation from a controller delta, keeping its rotation pivoted about the
  // A/B midpoint: T(p)·R·T(-p). Vertices stay at their rest distance from the pivot, so the
  // band bends without stretching (the desktop behaviour, driven by 6DOF wrist rotation).
  _rotationAboutPivot(m) {
    m.decompose(_dPos, _dQuat, _dScl);
    const r = new THREE.Matrix4().makeRotationFromQuaternion(_dQuat);
    const p = this._pivot;
    const rp = _dPos.set(p[0], p[1], p[2]).applyMatrix4(r); // R·p (reusing _dPos as scratch)
    r.setPosition(p[0] - rp.x, p[1] - rp.y, p[2] - rp.z);
    return r;
  }

  // Controller engine-space pose (origin + quat) expressed in mesh-local space.
  _controllerLocalMatrix(origin, q) {
    _ctrlPos.set(origin[0], origin[1], origin[2]);
    _ctrlQuat.set(q[0], q[1], q[2], q[3]);
    _mCtrlWorld.compose(_ctrlPos, _ctrlQuat, _oneVec);
    return new THREE.Matrix4().multiplyMatrices(this._invModel, _mCtrlWorld);
  }

  // VR deform: LBS with a single bone (the controller). v' = lerp(rest, delta·rest, w).
  // With symmetry the mirrored bone is delta' = R·delta·R (R = local reflection); each lane's
  // weighted displacement is summed so the mirror side moves with the matching motion.
  _deformXR(delta) {
    const mesh = this._mesh, v = mesh.getVertices(), nbV = mesh.getNbVertices();
    const rest = this._rest, p = new THREE.Vector3();
    const lanes = [{ w: this._w, m: delta }];
    if (this._sym) {
      const R = this._sym.reflect;
      lanes.push({ w: this._sym.w, m: new THREE.Matrix4().multiplyMatrices(R, delta).multiply(R) });
    }
    for (let i = 0; i < nbV; i++) {
      const rx = rest[i * 3], ry = rest[i * 3 + 1], rz = rest[i * 3 + 2];
      let ox = 0, oy = 0, oz = 0, moved = false;
      for (let k = 0; k < lanes.length; k++) {
        const wi = lanes[k].w[i];
        if (wi <= 0) continue;
        moved = true;
        p.set(rx, ry, rz).applyMatrix4(lanes[k].m);
        ox += (p.x - rx) * wi; oy += (p.y - ry) * wi; oz += (p.z - rz) * wi;
      }
      if (!moved) continue;
      v[i * 3] = rx + ox; v[i * 3 + 1] = ry + oy; v[i * 3 + 2] = rz + oz;
    }
    mesh.updateGeometry();
    if (mesh.isDynamic) mesh.updateBuffers(); else mesh.updateGeometryBuffers();
  }

  postRender() {} // no brush cursor; the axis arrow is managed in update/end
}

export default GeodesicPoseTool;
