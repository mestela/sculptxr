import { vec3, mat4, quat } from 'gl-matrix';
import SculptBase from './SculptBase.js';
import Gizmo from '../Gizmo.js';

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
    this._axisMask = [true, false, false]; // [X, Y, Z] (Start with X-only)

    this._gizmo = new Gizmo(main);
  }

  start(ctrl) {
    var main = this._main;
    var picking = main.getPicking();

    // VR Interaction Only
    if (!main._xrSession) return false;

    // Check if we hit a mesh
    var mesh = picking.getMesh();
    if (!mesh && !this._allowAir) return false;

    // Set Selection
    if (!main.setOrUnsetMesh(mesh, ctrl))
      return false;

    // Init Logic handled in updateXR on first press
    this._initInput = false;

    return true; // Occupy the tool
  }

  end() {
    this._initInput = false;
  }

  updateXR(picking, isPressed, origin, dir) { // Added origin, dir arguments matching SculptManager
    // 1. Update Gizmo Scale & Matrices (ALWAYS, even if not pressed)
    if (this._gizmo) {
      this._gizmo.updateMatricesVR(this._main.getCamera());

      // 2. Hover Logic (Only if not dragging)
      if (!this._initInput) {
        // Use the controller ray provided by SculptManager or global
        const main = this._main;
        const controllerPos = main._vrControllerPos; // Or use origin argument?

        // Let's use the arguments if valid, else fallback
        const rayOrigin = origin || controllerPos;
        const rayDir = dir || [0, 0, -1]; // Fallback to Z-forward if missing

        if (rayOrigin && rayDir) {
          var hitType = this._gizmo.onVRHover(rayOrigin, rayDir);

          if (hitType !== -1) {
            // Use the Gizmo's last intersection point
            var hitPos = this._gizmo._selected._lastInter;
            // Visualize where the ray actually hit the Gizmo
            // We can reuse the "Pivot" debug sphere since it's blue/visible
            if (main.updateDebugPivot) {
              // hitPos is in Local Space (approx 0..1)
              // We need to transform it to World Space using the Selected Part's matrix
              var worldHit = vec3.create();
              // FIX: _selected is a wrapper, use _finalMatrix directly
              var mat = this._gizmo._selected._finalMatrix;
              if (mat) {
                vec3.transformMat4(worldHit, hitPos, mat);

                if (Math.random() < 0.01) {
                  console.log(`Gizmo Hit: Local[${hitPos[0].toFixed(2)},${hitPos[1].toFixed(2)},${hitPos[2].toFixed(2)}] World[${worldHit[0].toFixed(2)},${worldHit[1].toFixed(2)},${worldHit[2].toFixed(2)}]`);
                }

                main.updateDebugPivot(worldHit, true);
                window.debugPivotScale = 0.01; // Small marker
              }
            }
          } else {
            // Hide debug pivot if no hit
            if (main.updateDebugPivot) {
              main.updateDebugPivot([0, 0, 0], false);
            }
          }
        }
      }
    }

    if (!isPressed) {
      this._initInput = false;
      return;
    }



    const main = this._main;
    const mesh = this.getMesh();
    if (!mesh) return;

    const controllerPos = main._vrControllerPos;
    const controllerQuat = main._vrControllerQuat;

    if (!controllerPos || !controllerQuat) return;

    if (!this._initInput) {
      // START OF GESTURE
      this._initInput = true;

      // 1. Store Start Pos
      vec3.copy(this._startControllerPos, controllerPos);
      quat.copy(this._startControllerQuat, controllerQuat);

      // 2. Store Start Matrix
      mat4.copy(this._startMeshMatrix, mesh.getMatrix());

      // 3. Calculate Controller Axes in World Space
      const q = controllerQuat;
      this._controllerRight = vec3.fromValues(1, 0, 0);
      vec3.transformQuat(this._controllerRight, this._controllerRight, q);
      vec3.normalize(this._controllerRight, this._controllerRight);
    }

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
          localMove[0] = dist / s; // Remove Scale for Local Translate
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
      // vStart x vCurr gives axis perpendicular to the plane of movement
      const axis = vec3.create();
      vec3.cross(axis, vStart, vCurr);

      const len = vec3.length(axis);
      if (len < 0.0001) return; // No rotation

      vec3.scale(axis, axis, 1.0 / len); // Normalize Axis

      // Compute Angle
      // dot = cos(theta)
      let dot = vec3.dot(vStart, vCurr);
      dot = Math.min(1.0, Math.max(-1.0, dot)); // Clamp
      const angle = Math.acos(dot);

      if (Math.abs(angle) < 0.0001) return;

      // CONSTRAIN AXIS
      // We want to project the WORLD axis onto acceptable Local Axes

      // 1. Transform World Axis to Local Axis
      // L = inv(R) * W
      const qInv = quat.create();
      quat.conjugate(qInv, rot);

      const axisLocal = vec3.create();
      vec3.transformQuat(axisLocal, axis, qInv);

      // 2. Apply Mask
      // If we are strictly constrained to X, we only keep X component?
      // Wait. If we rotate around X, the axis IS X.
      // So yes, we just zero out forbidden axes.
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

        // 2. Compute Factors
        // We use projected lengths. 
        // Note: Sign matters! dot(v, axis) gives signed distance.
        // If we cross the center, sign flips -> negative scale -> mirroring.

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

  _applyMatrix(mesh, mat) {
    if (typeof mesh.setMatrix === 'function') {
      if (mDest) mat4.copy(mDest, mat);
    }
    this._main.render();
  }



  renderVR(scene, cam) {
    if (this._gizmo) {
      this._gizmo.renderVR(cam);
    }
  }
}

export default TransformVR;
