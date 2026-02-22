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
  }

  start(ctrl) {
    var main = this._main;
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
    var mesh = picking.getMesh();
    if (!mesh && !this._allowAir) return false;

    // Set Selection (This updates main.setMesh)
    if (!main.setOrUnsetMesh(mesh, ctrl))
      return false;

    return true; // Occupy the tool
  }

  end() {
  }

  updateXR(picking, isPressed, origin, dir, options) {
    if (this._gizmo) {
      this._gizmo.update(this._main.getCamera());

      // 1. Hover Logic (Only if not dragging AND not in grace period)
      if (!this._initInput && (!this._graceFrames || this._graceFrames === 0)) {
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
            }
          } else {
            const rayOrigin = origin || main._vrControllerPos;
            const rayDir = dir || [0, 0, -1];
            if (rayOrigin && rayDir) {
              const vrScale = main._vrScale || 50.0;
              const radius = 0.02 * vrScale;
              var vrHitType = this._gizmo.intersectPhysical(rayOrigin, rayDir, radius, false);
              if (vrHitType !== -1) {
                this._updateStateFromGizmo(vrHitType);
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
        if (this._graceFrames > 5) {
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
      if (!mesh) return;

      this._initInput = true;
      this._vrActiveHand = currentHand;
      this._dragMesh = mesh; // MESH LOCKING: Cache the target mesh

      vec3.copy(this._startControllerPos, main._vrControllerPos);
      quat.copy(this._startControllerQuat, main._vrControllerQuat);
      mat4.copy(this._startMeshMatrix, mesh.getMatrix());

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

        const qRot = quat.create();
        mat4.getRotation(qRot, this._startMeshMatrix);

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

    // MODE: ROTATE (Generalized Arcball / Lever)
    if (this._mode === 1) {
      const mask = this._axisMask;

      // Pivot is Mesh Center
      const pos = vec3.create();
      const rot = quat.create();
      const scale = vec3.create();
      mat4.getTranslation(pos, this._startMeshMatrix);
      mat4.getRotation(rot, this._startMeshMatrix);
      mat4.getScaling(scale, this._startMeshMatrix);

      // Vectors from Pivot to Controller (Start vs Current)
      const vStart = vec3.create();
      const vCurr = vec3.create();
      vec3.sub(vStart, this._startControllerPos, pos);
      vec3.sub(vCurr, controllerPos, pos);

      // Normalize
      vec3.normalize(vStart, vStart);
      vec3.normalize(vCurr, vCurr);

      // Compute Axis of Rotation (Cross Product)
      const axis = vec3.create();
      vec3.cross(axis, vStart, vCurr);

      const len = vec3.length(axis);
      if (len < 0.0001) return; // No rotation

      vec3.scale(axis, axis, 1.0 / len); // Normalize Axis

      // Compute Angle
      let dot = vec3.dot(vStart, vCurr);
      dot = Math.min(1.0, Math.max(-1.0, dot)); // Clamp
      const angle = Math.acos(dot);

      if (Math.abs(angle) < 0.0001) return;

      // CONSTRAIN AXIS
      const qInv = quat.create();
      quat.conjugate(qInv, rot);

      const axisLocal = vec3.create();
      vec3.transformQuat(axisLocal, axis, qInv);

      // 2. Apply Mask
      if (!mask[0]) axisLocal[0] = 0.0;
      if (!mask[1]) axisLocal[1] = 0.0;
      if (!mask[2]) axisLocal[2] = 0.0;

      if (vec3.length(axisLocal) < 0.0001) return; // No allowed rotation
      vec3.normalize(axisLocal, axisLocal);

      // 3. Transform Back to World
      vec3.transformQuat(axis, axisLocal, rot);
      vec3.normalize(axis, axis);

      // 4. Apply Rotation Delta
      const qDelta = quat.create();
      quat.setAxisAngle(qDelta, axis, angle);

      // Global Rotation
      const newRot = quat.create();
      quat.multiply(newRot, qDelta, rot);

      // Recompose
      const newMat = mat4.create();
      mat4.fromRotationTranslationScale(newMat, newRot, pos, scale);

      this._applyMatrix(mesh, newMat);
      return;
    }

    // MODE: SCALE
    if (this._mode === 2) {
      const mask = this._axisMask;

      const pos = vec3.create();
      const rot = quat.create();
      const scale = vec3.create();
      mat4.getTranslation(pos, this._startMeshMatrix);
      mat4.getRotation(rot, this._startMeshMatrix);
      mat4.getScaling(scale, this._startMeshMatrix);

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
    mat4.copy(mesh.getMatrix(), mat);
    this._main.render();
  }

  renderVR(scene, cam) {
    if (this._gizmo) {
      this._gizmo.render(cam);
    }
  }
}

export default TransformVR;
