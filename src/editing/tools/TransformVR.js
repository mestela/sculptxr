import { vec3, mat4, quat } from 'gl-matrix';
import SculptBase from './SculptBase.js';
import GizmoVR, { GIZMO_TYPE } from '../GizmoVR.js';

class TransformVR extends SculptBase {

  constructor(main) {
    super(main);

    this._startControllerPos = vec3.create();
    this._startControllerQuat = quat.create(); // Store Start Quat
    this._startMeshMatrix = mat4.create();
    this._controllerRight = vec3.create(); // Local X of controller at start
    this._initInput = false;

    // State
    this._mode = 0; // 0=Translate, 1=Rotate, 2=Scale
    this._axisMask = [true, true, true]; // [X, Y, Z]

    this._gizmo = new GizmoVR(main);

    // Robustness
    this._graceFrames = 0;
    this._vrActiveHand = null;
    this._lastHoverHand = null;
    this._dragMesh = null; // MESH LOCKING: Specific mesh being dragged
    this._isGizmoHovered = false;
  }

  start(ctrl) {
    var main = this._main;
    var mesh = this.getMesh();
    if (mesh && mesh._isVoxel) return false; // LOCK TRANSFORM
    var picking = main.getPicking();

    // VR Interaction Only
    if (!main._xrSession) return false;

    // SELECTION PROTECTION:
    // If we're already dragging, do NOT let start() proceed.
    // This prevents a second hand from changing the global selection mid-drag.
    if (this._initInput) {
      return false; 
    }

    // Check if we hit a mesh
    // var mesh = picking.getMesh(); // This line was moved up
    if (!mesh && !this._allowAir) return false;

    // Set Selection (This updates main.setMesh)
    if (!main.setOrUnsetMesh(mesh, ctrl))
      return false;

    return true; // Occupy the tool
  }

  end() {
    if (this._initInput && this._dragMesh && this._undoMatrix) {
      const mesh = this._dragMesh;
      const oldMat = mat4.clone(this._undoMatrix);
      const oldCen = vec3.clone(this._undoCenter);
      const newMat = mat4.clone(mesh.getMatrix());
      const newCen = vec3.clone(mesh.getCenter());
      const main = this._main;

      main.getStateManager().pushStateCustom(() => {
        // UNDO
        mat4.copy(mesh.getMatrix(), oldMat);
        vec3.copy(mesh.getCenter(), oldCen);
        main.render();
      }, () => {
        // REDO
        mat4.copy(mesh.getMatrix(), newMat);
        vec3.copy(mesh.getCenter(), newCen);
        main.render();
      });
    }

    this._initInput = false;
    this._undoMatrix = null;
    this._undoCenter = null;
    this._dragMesh = null;
    super.end();
  }

  updateXR(picking, isPressed, origin, dir, options) {
    if (this._wasPressed !== isPressed) {
      console.log(`[TransformVR] updateXR, isPressed: ${isPressed}, initInput: ${this._initInput}`);
      this._wasPressed = isPressed;
    }

    if (this._gizmo) {
      // Every VR frame this tool is active: hide BOTH transform gizmos (clears the
      // stale desktop Gizmo.js group that lingers in VR), then re-show only the VR
      // one. postRender() — the old place that set this visible — is desktop-only.
      this._main.getSculptManager?.()?._hideTransformGizmos?.();
      if (this._gizmo._group) this._gizmo._group.visible = true;
      this._gizmo.update(this._main.getCamera());

      // 1. Hover Logic (Only if not dragging AND not in grace period)
      if (!this._initInput && (!this._graceFrames || this._graceFrames === 0)) {
        this._isGizmoHovered = false;
        const main = this._main;
        const currentHand = options ? options.handedness : "unknown";

        // Handedness Isolation
        if (currentHand === main._dominantHand || !this._lastHoverHand || currentHand === this._lastHoverHand) {
          this._lastHoverHand = currentHand;

          const physOrigin = main._vrControllerPosPhys;
          const physDir = main._vrControllerDirPhys;

          if (physOrigin && physDir) {
            const radius = 0.02; 
            var hitType = this._gizmo.intersectPhysical(physOrigin, physDir, radius, true);
            if (hitType !== -1) {
              this._updateStateFromGizmo(hitType);
              this._isGizmoHovered = true;
            }
          } else {
            const rayOrigin = origin || main._vrControllerPos;
            const rayDir = dir || [0, 0, -1];
            if (rayOrigin && rayDir) {
              let worldScale = 1.0;
              const sceneApp = main.getScene ? main.getScene() : main._scene;
              if (sceneApp && sceneApp._worldGroup) {
                worldScale = sceneApp._worldGroup.scale.x;
              } else if (main._worldGroup) {
                worldScale = main._worldGroup.scale.x;
              }
              const radiusMeters = 0.02 * 31.25; // radius * scaleFactor (31.25)
              var vrHitType = this._gizmo.intersectPhysical(rayOrigin, rayDir, radiusMeters, false);
              if (vrHitType !== -1) {
                this._updateStateFromGizmo(vrHitType);
                this._isGizmoHovered = true;
              }
            }
          }
        }
      }
    }

    const currentHand = options ? options.handedness : "unknown";

    // 2. Trigger Sensitivity Protection (Grace Period)
    if (!isPressed) {
      if (this._vrActiveHand && currentHand === this._vrActiveHand) {
        this._graceFrames = (this._graceFrames || 0) + 1;
        if (this._graceFrames % 2 === 0) {
          console.log(`[TransformVR] Grace: ${this._graceFrames}`);
        }
        if (this._graceFrames > 5) {
          if (this._dragMesh && this._dragMesh._isVoxel) return; // LOCK TRANSFORM
          console.log(`[TransformVR] Reset! Trigger lost.`);
          this._initInput = false;
          this._vrActiveHand = null;
           this._lastHoverHand = null;
           this._dragMesh = null; // Clear Mesh Lock
           this._graceFrames = 0;
         }
      }
      return;
    }

    // Handedness isolation: Only follow the hand that started the drag
    if (this._initInput && currentHand !== this._vrActiveHand) {
      return;
    }

    this._graceFrames = 0; // Hand is back!

    const main = this._main;

    // START OF GESTURE
    if (!this._initInput) {
      // Find Mesh to Drag
      const mesh = this.getMesh();
      if (!mesh || mesh._isVoxel) return;

      this._initInput = true;
      this._vrActiveHand = currentHand;
      this._dragMesh = mesh; // MESH LOCKING: Cache the target mesh

      // UNDO SUPPORT: Capture state once at start of drag
      this._undoMatrix = mat4.clone(mesh.getMatrix());
      this._undoCenter = vec3.clone(mesh.getCenter());

      mat4.identity(mesh.getEditMatrix()); 

      vec3.copy(this._startControllerPos, main._vrControllerPos);
      quat.copy(this._startControllerQuat, main._vrControllerQuat);
      // Gizmo math runs in MODEL space (world-equivalent), so a parented child is
      // driven in the right frame; _applyMatrix() writes back via setModelSpaceMatrix.
      // For a top-level mesh this is exactly getMatrix() (no change).
      if (mesh.getModelSpaceMatrix) mesh.getModelSpaceMatrix(this._startMeshMatrix);
      else mat4.copy(this._startMeshMatrix, mesh.getMatrix());

      // Robust TRS extraction for non-uniform scale (Cached for all modes)
      this._startMeshPos = vec3.create();
      this._startMeshRot = quat.create();
      this._startMeshScale = vec3.create();

      const m = this._startMeshMatrix;
      mat4.getTranslation(this._startMeshPos, m);

      const sx = Math.hypot(m[0], m[1], m[2]);
      const sy = Math.hypot(m[4], m[5], m[6]);
      const sz = Math.hypot(m[8], m[9], m[10]);
      vec3.set(this._startMeshScale, sx, sy, sz);

      const unscaledMat = mat4.clone(m);
      if (sx > 0.0001) { unscaledMat[0] /= sx; unscaledMat[1] /= sx; unscaledMat[2] /= sx; }
      if (sy > 0.0001) { unscaledMat[4] /= sy; unscaledMat[5] /= sy; unscaledMat[6] /= sy; }
      if (sz > 0.0001) { unscaledMat[8] /= sz; unscaledMat[9] /= sz; unscaledMat[10] /= sz; }

      mat4.getRotation(this._startMeshRot, unscaledMat);

      const q = main._vrControllerQuat;
      this._controllerRight = vec3.fromValues(1, 0, 0);
      vec3.transformQuat(this._controllerRight, this._controllerRight, q);
    }

    // USE LOCKED MESH
    const mesh = this._dragMesh;
    if (!mesh) return;

    const controllerPos = main._vrControllerPos;
    const controllerQuat = main._vrControllerQuat;

    // UPDATE GESTURE

    // 1. Calculate Delta World
    const delta = vec3.create();
    vec3.sub(delta, controllerPos, this._startControllerPos);

    // Get Mesh Scale for LOCAL scaling correction
    const meshScale = vec3.create();
    mat4.getScaling(meshScale, this._startMeshMatrix);

    const translationMatrix = mat4.create();

    // MODE: TRANSLATE
    if (this._mode === 0) {
      const mask = this._axisMask;

      // Check for Free Move (All Axes True)
      if (mask[0] && mask[1] && mask[2]) {
        // FREE MOVE (Matches Hand Delta exactly, World Space)
        mat4.fromTranslation(translationMatrix, delta);

        const newMat = mat4.create();
        // Pre-multiply for World Translation (Matches Hand)
        mat4.multiply(newMat, translationMatrix, this._startMeshMatrix);

        this._applyMatrix(mesh, newMat);
        return;

      } else {
        // CONSTRAINED AXIS MOVEMENT (Mesh Local Axes)

        const qRot = this._startMeshRot;

        const vX = vec3.fromValues(1, 0, 0);
        const vY = vec3.fromValues(0, 1, 0);
        const vZ = vec3.fromValues(0, 0, 1);

        vec3.transformQuat(vX, vX, qRot);
        vec3.transformQuat(vY, vY, qRot);
        vec3.transformQuat(vZ, vZ, qRot);

        const localMove = vec3.create();

        if (mask[0]) {
          const dist = vec3.dot(delta, vX); // Project onto World X of Mesh
          const s = Math.abs(meshScale[0]) > 0.0001 ? meshScale[0] : 1.0;
          localMove[0] = dist / s;
        }
        if (mask[1]) {
          const dist = vec3.dot(delta, vY);
          const s = Math.abs(meshScale[1]) > 0.0001 ? meshScale[1] : 1.0;
          localMove[1] = dist / s;
        }
        if (mask[2]) {
          const dist = vec3.dot(delta, vZ);
          const s = Math.abs(meshScale[2]) > 0.0001 ? meshScale[2] : 1.0;
          localMove[2] = dist / s;
        }

        mat4.fromTranslation(translationMatrix, localMove);
        const newMat = mat4.create();
        // Post-multiply for Local Translation
        mat4.multiply(newMat, this._startMeshMatrix, translationMatrix);

        this._applyMatrix(mesh, newMat);
        return;
      }
    }

    // MODE: ROTATE (Stable Plane Projection for Single Axis)
    if (this._mode === 1) {
      const mask = this._axisMask;

      const pos = this._startMeshPos;
      const rot = this._startMeshRot;
      const scale = this._startMeshScale;

      const vStart = vec3.create();
      const vCurr = vec3.create();
      vec3.sub(vStart, this._startControllerPos, pos);
      vec3.sub(vCurr, controllerPos, pos);

      const qInv = quat.create();
      quat.conjugate(qInv, rot);

      const vStartLocal = vec3.create();
      const vCurrLocal = vec3.create();
      vec3.transformQuat(vStartLocal, vStart, qInv);
      vec3.transformQuat(vCurrLocal, vCurr, qInv);

      const axis = vec3.create();
      let deltaAngle = 0;

      // Single Axis Constraints via Plane Projection
      if (mask[0] && !mask[1] && !mask[2]) { // Local X Only (YZ Plane)
        const angleStart = Math.atan2(vStartLocal[2], vStartLocal[1]);
        const angleCurr = Math.atan2(vCurrLocal[2], vCurrLocal[1]);
        deltaAngle = angleCurr - angleStart; // Restored to standard subtraction
        vec3.set(axis, 1.0, 0.0, 0.0);
        vec3.transformQuat(axis, axis, rot); // To World!
      } else if (!mask[0] && mask[1] && !mask[2]) { // Local Y Only (XZ Plane)
        const angleStart = Math.atan2(vStartLocal[2], vStartLocal[0]); // Z, X
        const angleCurr = Math.atan2(vCurrLocal[2], vCurrLocal[0]);
        deltaAngle = angleStart - angleCurr; // Flipped to match gesture intuition
        vec3.set(axis, 0.0, 1.0, 0.0);
        vec3.transformQuat(axis, axis, rot); // To World!
      } else if (!mask[0] && !mask[1] && mask[2]) { // Local Z Only (XY Plane)
        const angleStart = Math.atan2(vStartLocal[1], vStartLocal[0]);
        const angleCurr = Math.atan2(vCurrLocal[1], vCurrLocal[0]);
        deltaAngle = angleCurr - angleStart; // Restored to standard subtraction
        vec3.set(axis, 0.0, 0.0, 1.0);
        vec3.transformQuat(axis, axis, rot); // To World!
      } else {
        // Free Rotation (Arcball)
        vec3.normalize(vStart, vStart);
        vec3.normalize(vCurr, vCurr);

        vec3.cross(axis, vStart, vCurr);
        const len = vec3.length(axis);
        if (len > 0.0001) {
          vec3.scale(axis, axis, 1.0 / len);

          let dot = vec3.dot(vStart, vCurr);
          dot = Math.min(1.0, Math.max(-1.0, dot));
          deltaAngle = Math.acos(dot);

          // Project to unmasked local space
          const axisLocal = vec3.create();
          vec3.transformQuat(axisLocal, axis, qInv);
          if (!mask[0]) axisLocal[0] = 0.0;
          if (!mask[1]) axisLocal[1] = 0.0;
          if (!mask[2]) axisLocal[2] = 0.0;
          if (vec3.length(axisLocal) > 0.0001) {
            vec3.normalize(axisLocal, axisLocal);
            vec3.transformQuat(axis, axisLocal, rot);
          } else {
            return; // No allowed axis
          }
        } else {
          return;
        }
      }

      if (Math.abs(deltaAngle) < 0.0001) return;

      // Apply Rotation Delta in World Space
      const qDelta = quat.create();
      quat.setAxisAngle(qDelta, axis, deltaAngle);

      const newRot = quat.create();
      quat.multiply(newRot, qDelta, rot);

      const newMat = mat4.create();
      mat4.fromRotationTranslationScale(newMat, newRot, pos, scale);

      this._applyMatrix(mesh, newMat);
      return;
    }

    // MODE: SCALE
    if (this._mode === 2) {
      const mask = this._axisMask;

      const pos = this._startMeshPos;
      const rot = this._startMeshRot;
      const scale = vec3.clone(this._startMeshScale); // Clone because we mutate scale in this mode!

      const vStart = vec3.create();
      const vCurr = vec3.create();
      vec3.sub(vStart, this._startControllerPos, pos);
      vec3.sub(vCurr, controllerPos, pos);

      // UNIFORM SCALE (All 3 axes)
      if (mask[0] && mask[1] && mask[2]) {
        const dStart = vec3.length(vStart);
        const dCurr = vec3.length(vCurr);

        if (dStart < 0.0001) return; // Prevent divide by zero

        const factor = dCurr / dStart;

        // Apply Uniform Scale
        vec3.scale(scale, scale, factor);

        const newMat = mat4.create();
        mat4.fromRotationTranslationScale(newMat, rot, pos, scale);

        this._applyMatrix(mesh, newMat);
        return;

      } else {
        // NON-UNIFORM SCALE (1 or 2 axes)
        // Project onto Local Axes

        // 1. Get World Axes
        const vX = vec3.fromValues(1, 0, 0);
        const vY = vec3.fromValues(0, 1, 0);
        const vZ = vec3.fromValues(0, 0, 1);
        vec3.transformQuat(vX, vX, rot);
        vec3.transformQuat(vY, vY, rot);
        vec3.transformQuat(vZ, vZ, rot);

        const factors = vec3.fromValues(1, 1, 1);

        if (mask[0]) {
          const s = vec3.dot(vStart, vX);
          const c = vec3.dot(vCurr, vX);
          if (Math.abs(s) > 0.0001) factors[0] = c / s;
        }

        if (mask[1]) {
          const s = vec3.dot(vStart, vY);
          const c = vec3.dot(vCurr, vY);
          if (Math.abs(s) > 0.0001) factors[1] = c / s;
        }

        if (mask[2]) {
          const s = vec3.dot(vStart, vZ);
          const c = vec3.dot(vCurr, vZ);
          if (Math.abs(s) > 0.0001) factors[2] = c / s;
        }

        // Apply Factors
        vec3.multiply(scale, scale, factors);

        const newMat = mat4.create();
        mat4.fromRotationTranslationScale(newMat, rot, pos, scale);

        this._applyMatrix(mesh, newMat);
        return;
      }
    }
  }

  _updateStateFromGizmo(type) {
    // Mode: 0=Translate, 1=Rotate, 2=Scale
    // Type bitmask mapping

    // Reset Defaults
    this._mode = 0;
    this._axisMask = [false, false, false];

    if (type & GIZMO_TYPE.TRANS_X) { this._mode = 0; this._axisMask = [true, false, false]; }
    else if (type & GIZMO_TYPE.TRANS_Y) { this._mode = 0; this._axisMask = [false, true, false]; }
    else if (type & GIZMO_TYPE.TRANS_Z) { this._mode = 0; this._axisMask = [false, false, true]; }

    // Plane Translation (Move in 2 axes)
    else if (type & GIZMO_TYPE.PLANE_X) { this._mode = 0; this._axisMask = [false, true, true]; }
    else if (type & GIZMO_TYPE.PLANE_Y) { this._mode = 0; this._axisMask = [true, false, true]; } 
    else if (type & GIZMO_TYPE.PLANE_Z) { this._mode = 0; this._axisMask = [true, true, false]; } 

    else if (type & GIZMO_TYPE.ROT_X) { this._mode = 1; this._axisMask = [true, false, false]; }
    else if (type & GIZMO_TYPE.ROT_Y) { this._mode = 1; this._axisMask = [false, true, false]; }
    else if (type & GIZMO_TYPE.ROT_Z) { this._mode = 1; this._axisMask = [false, false, true]; }
    else if (type & GIZMO_TYPE.ROT_W) { this._mode = 1; this._axisMask = [true, true, true]; } 

    else if (type & GIZMO_TYPE.SCALE_X) { this._mode = 2; this._axisMask = [true, false, false]; }
    else if (type & GIZMO_TYPE.SCALE_Y) { this._mode = 2; this._axisMask = [false, true, false]; }
    else if (type & GIZMO_TYPE.SCALE_Z) { this._mode = 2; this._axisMask = [false, false, true]; }
    else if (type & GIZMO_TYPE.SCALE_W) { this._mode = 2; this._axisMask = [true, true, true]; } 
  }

  _applyMatrix(mesh, mat) {
    if (!mesh) return;
    // `mat` is a MODEL-space transform; convert back to local-to-parent (== setMatrix
    // for a top-level mesh) so parented children transform correctly.
    if (mesh.setModelSpaceMatrix) mesh.setModelSpaceMatrix(mat);
    else mat4.copy(mesh.getMatrix(), mat);
    this._main.render();
  }

  renderVR(scene, cam) {
    if (this._gizmo) {
      this._gizmo.render(cam);
    }
  }

  postRender() {
    if (!this._gizmo) return;
    var main  = this._main;
    var g     = this._gizmo._group;

    // Lazy-add to worldGroup (SculptGL extends Scene, _worldGroup lives on main).
    if (g && !g.parent) {
      var wg = main._worldGroup || (main._scene && main._scene._worldGroup);
      if (wg) { wg.add(g); main.render(); }
    }

    // Update gizmo matrices and make it visible.
    if (g) g.visible = true;
    this._gizmo.update(main.getCamera());

    // Selection overlay (from SculptBase).
    super.postRender(main.getSculptManager().getSelection());
  }
}

export default TransformVR;
