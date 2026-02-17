import { vec3, mat4, quat } from 'gl-matrix';
import SculptBase from './SculptBase.js';

class TransformVR extends SculptBase {

  constructor(main) {
    super(main);

    this._startControllerPos = vec3.create();
    this._startMeshMatrix = mat4.create();
    this._controllerRight = vec3.create(); // Local X of controller at start
    this._initInput = false;
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

      // 3. Calculate Controller Right Vector (X-Axis) in World Space
      // Transform local X (1,0,0) by controller Quat
      vec3.set(this._controllerRight, 1.0, 0.0, 0.0);
      vec3.transformQuat(this._controllerRight, this._controllerRight, controllerQuat);
      vec3.normalize(this._controllerRight, this._controllerRight);

      // Push Undo State (Geometry state stores matrix too?)
      // StateGeometry usually stores vertices. StateCustom?
      // Actually Transform tool uses pushState() which pushes StateGeometry.
      // And applyEditMatrix modifies vertices directly in desktop Transform?
      // Wait, desktop transform modifies vertices?
      // "applyEditMatrix(iVerts) ... vec3.transformMat4(vTemp, vTemp, em)"
      // Yes, desktop transform bakes the matrix into vertices!
      // But for VR, we probably just want to move the "Mesh Object" (matrix) for now?
      // The user said "TransformVR... object should also move".
      // If we move the matrix, it's cheaper.
      // But if we want to bake it later, we can.
      // For now, let's just modify the matrix.
      // We should push a "Matrix State" ideally?
      // StateGeometry stores the matrix too?
      // Let's check StateGeometry.

      // For now, simple start:
      // Just matrix update.
    }

    // UPDATE GESTURE

    // 1. Calculate Delta World
    const delta = vec3.create();
    vec3.sub(delta, controllerPos, this._startControllerPos);

    // 2. Project Delta onto Controller Right Vector
    // scalar = dot(delta, controllerRight)
    let moveAmount = vec3.dot(delta, this._controllerRight);

    // FIX: Apply Inverse Mesh Scale ONLY (Delta is already in Scene Space)
    // 1. Delta is in Scene Space (Physical / _vrScale)
    // 2. We want Local Delta.
    //    LocalDelta = SceneDelta / MeshScale

    let scaleFactor = 1.0;

    // VR Scale (View Scale) - ALREADY APPLIED TO DELTA via Scene Logic
    // if (main._vrScale) {
    //   scaleFactor *= main._vrScale;
    // }

    // Mesh Scale (Model Scale)
    // We need the scale along the specific axis we are moving (Local X).
    // Or just uniform scale if we assume uniform.
    // Let's take the length of the Local X axis vector in World Space (from Start Matrix).
    // StartMatrix contains Rotation * Scale.
    // mat4.getScaling() extracts factors.
    const meshScale = vec3.create();
    mat4.getScaling(meshScale, this._startMeshMatrix);
    // Move is along Local X, so use X scale.
    // If scale is 0, avoid NaN.
    if (Math.abs(meshScale[0]) > 0.0001) {
      scaleFactor *= meshScale[0];
    }

    // Apply
    if (scaleFactor > 0.00001) {
      if (Math.random() < 0.01) {
        console.log(`[TransformVR] Delta:${vec3.length(delta).toFixed(4)} Move:${moveAmount.toFixed(4)} MeshScale:${meshScale[0].toFixed(4)} Factor:${scaleFactor.toFixed(4)} Result:${(moveAmount / scaleFactor).toFixed(4)}`);
      }
      moveAmount /= scaleFactor;
    }

    // 3. Construct Translation Matrix in LOCAL SPACE
    // Reuse variable or use new scope?
    // Let's use a new variable name or just reuse the logic cleanly.

    // Mat4.fromTranslation handles [x, y, z]
    const translationMatrix = mat4.create();
    mat4.fromTranslation(translationMatrix, [moveAmount, 0.0, 0.0]);

    const newMat = mat4.create();
    mat4.multiply(newMat, this._startMeshMatrix, translationMatrix);

    // 4. Apply
    // mesh.setMatrix(newMat);
    // Explicit Fallback/Debug if setMatrix is missing
    if (typeof mesh.setMatrix === 'function') {
      mesh.setMatrix(newMat);
    } else {
      console.warn("TransformVR: mesh.setMatrix missing on", mesh.constructor.name);
      const mDest = mesh.getMatrix();
      if (mDest) mat4.copy(mDest, newMat);
    }

    // Update Drawables?
    main.render();
  }
}

export default TransformVR;
