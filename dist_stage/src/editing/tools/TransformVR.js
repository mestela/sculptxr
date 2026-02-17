import { vec3, mat4, quat } from 'gl-matrix';
import SculptBase from './SculptBase.js';

class TransformVR extends SculptBase {

  constructor(main) {
    super(main);

    this._startControllerPos = vec3.create();
    this._startMeshMatrix = mat4.create();
    this._controllerRight = vec3.create(); // Local X of controller at start
    this._initInput = false;

    // State
    this._mode = 0; // 0=Translate, 1=Rotate, 2=Scale
    this._axisMask = [true, false, false]; // [X, Y, Z] (Start with X-only)
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
    // Apply final matrix?
    // In SculptXR, matrix changes are usually instant.
    // Undo history?
    // We should push state at start.
    this._initInput = false;
  }

  updateXR(picking, isPressed) {
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

      // 2. Store Start Matrix
      mat4.copy(this._startMeshMatrix, mesh.getMatrix());

      // 3. Calculate Controller Axes in World Space
      // (Used for projection if needed, though for now we project onto MESH axes)
      const q = controllerQuat;

      this._controllerRight = vec3.fromValues(1, 0, 0);
      vec3.transformQuat(this._controllerRight, this._controllerRight, q);
      vec3.normalize(this._controllerRight, this._controllerRight);

      // We might need Up/Forward for other constraints if we want "Controller Space" movement
      // But for now we project onto MESH axes, so we only need to know we started.
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

    // ROTATE / SCALE Placeholder
    if (this._mode > 0) {
      // Not implemented yet
      return;
    }
  }

  _applyMatrix(mesh, mat) {
    if (typeof mesh.setMatrix === 'function') {
      mesh.setMatrix(mat);
    } else {
      // Silenced Warning
      const mDest = mesh.getMatrix();
      if (mDest) mat4.copy(mDest, mat);
    }
    // Update Drawables?
    this._main.render();
  }
}

export default TransformVR;
