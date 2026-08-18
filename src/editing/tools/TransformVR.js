import * as THREE from 'three';
import { vec3, mat4, quat } from 'gl-matrix';
import SculptBase from './SculptBase.js';
import GizmoVR, { GIZMO_TYPE } from '../GizmoVR.js';
import Skeleton from '../Skeleton.js';
import IKSolver from '../IKSolver.js';

// Scratch for the joint solve. Reused rather than allocated: this runs on every frame of a
// drag at 90Hz.
const _poseM = new THREE.Matrix4();
const _poseT = new THREE.Vector3();
const _poseQ = new THREE.Quaternion();
const _poseS = new THREE.Vector3();

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
    this._pickConsumed = false; // one selection pick per trigger press, not one per frame
    this._dragIsJoint = false;  // the dragged node is a BONE: the gizmo poses, it does not move
    this._dragUndoRig = null;   // whole-skeleton snapshot, because a solve writes the chain
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
    // A POSED BONE MOVED THE WHOLE CHAIN, so one matrix is not the undo. Checked before the
    // mesh path and gated on the snapshot ALONE, not on _dragMesh: the grace-period recovery
    // clears _dragMesh when the trigger signal is lost, and a pose that cannot be undone is
    // worse than one that ends untidily.
    if (this._dragUndoRig) {
      const main = this._main;
      const before = this._dragUndoRig;
      const after = IKSolver.captureAll(main);
      const put = (snap) => {
        for (const [j, m] of snap) { mat4.copy(j.getMatrix(), m); Skeleton.syncThree(j); }
        Skeleton.updateVisuals(main); main.render();
      };
      main.getStateManager().pushStateCustom(() => put(before), () => put(after), false, 'Pose');

      this._initInput = false;
      this._dragUndoRig = null;
      this._dragIsJoint = false;
      this._undoMatrix = null;
      this._undoCenter = null;
      this._dragMesh = null;
      super.end();
      return;
    }

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
    this._dragIsJoint = false;
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

        // 1b. RIG PRESELECTION. Only when the ray is not already on a gizmo handle — while a
        //     handle is under the ray it owns the ray. hoverRigFromRay is the same helper Grab
        //     uses; it throttles itself and snapshots/restores the pick, which matters here
        //     because the gizmo reads picking._mesh/_interPoint/_pickedFace to decide which
        //     handle you took. origin/dir are the ENGINE-space ray Scene hands us.
        if (!this._isGizmoHovered && !isPressed && origin && dir) {
          Skeleton.hoverRigFromRay(main, picking, origin, dir);
        }
      }
    }

    const currentHand = options ? options.handedness : "unknown";

    // 2. Trigger Sensitivity Protection (Grace Period)
    if (!isPressed) {
      this._pickConsumed = false; // trigger released: the next press may pick again
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
      // RIG-AWARE PICK. Same rule as Transform.start on desktop: the gizmo is a SELECTION tool
      // before it is a transform tool, so a press that is not on a handle re-selects whatever
      // the ray is on — which is how a bone or a pin gets reached in VR at all. A press that
      // hits nothing falls through to the old behaviour and drags the current selection.
      if (!this._isGizmoHovered && !this._pickConsumed && origin && dir) {
        this._pickConsumed = true;
        const picked = this._pickRigOrMesh(picking, origin, dir);
        if (picked) {
          main.setOrUnsetMesh(picked, false);
          main.render();
          return; // a selection press, not a drag
        }
      }

      // Find Mesh to Drag
      const mesh = this.getMesh();
      if (!mesh || mesh._isVoxel) return;

      this._initInput = true;
      this._vrActiveHand = currentHand;
      this._dragMesh = mesh; // MESH LOCKING: Cache the target mesh

      // A DRAGGED BONE IS A POSE, NOT A TRANSFORM. Deciding this ONCE, here, is the whole
      // point: the handover's warning about gizmo posing was against a watcher that compared
      // every joint's matrix every frame for every tool. This is scoped to one gizmo drag,
      // press to release, so nothing is inferred and nothing else's writes are second-guessed.
      this._dragIsJoint = Skeleton.isJoint(mesh) && window._vrGizmoPose !== false;

      // UNDO SUPPORT: Capture state once at start of drag. A solve can reach anywhere in the
      // tree, so for a bone the honest snapshot is the whole skeleton, not one matrix.
      this._dragUndoRig = this._dragIsJoint ? IKSolver.captureAll(main) : null;
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

  // The VR twin of Transform's `picking.intersectionMouseMeshes(..., true)`. Both sides are
  // asserted together in scratchpad/rigpick_test.mjs precisely so they cannot drift apart
  // again. `origin`/`dir` MUST be the ray updateXR is handed (engine space); a ray rebuilt
  // from the controller matrix lives in the raw WebXR frame and misses everything, silently.
  _pickRigOrMesh(picking, origin, dir) {
    if (!picking) return null;
    const main = this._main;
    let targets = main.getMeshes().filter((m) => m.isVisible() && !m._isVoxelChunk);
    if (main._lockSelection) {
      const sel = main.getSelectedMeshes();
      targets = (sel && sel.length > 0) ? sel : (main.getMesh() ? [main.getMesh()] : targets);
    }
    // includeRig: in VR a bone or a pin is exactly what you reach out and take.
    return picking.intersectionRayMeshes(targets, origin, dir, true) ? picking.getMesh() : null;
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

    // Center handle → free translate (all axes, follows the controller)
    else if (type & GIZMO_TYPE.TRANS_W) { this._mode = 0; this._axisMask = [true, true, true]; }

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

    // A BONE IS POSED, NEVER WRITTEN. Every mode funnels through here, so this one branch
    // covers translate, rotate and free/arcball alike. `mat` is where the gizmo says the joint
    // should END UP; that is a REQUEST, which the solver answers by rotating the chain. Writing
    // it to the joint instead would set its local translation — and a joint's local translation
    // IS its bone length, so the rig would stretch a little more with every drag. Because the
    // matrix is never written, there is nothing to restore before solving (the step
    // IKSolver.resolveToJoint has to perform for the desktop watcher path).
    if (this._dragIsJoint) {
      _poseM.fromArray(mat);
      _poseM.decompose(_poseT, _poseQ, _poseS);
      // Position AND orientation. The solver takes a driven orientation as a constraint, not a
      // decoration — without it a posed bone slides but never turns, which is exactly the bug
      // the VR grab had.
      IKSolver.solve(this._main, mesh, _poseT, null, _poseQ);
      Skeleton.updateVisuals(this._main);
      this._main.render();
      return;
    }

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
