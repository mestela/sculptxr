import { vec3, mat4, quat } from 'gl-matrix';
import SculptBase from './SculptBase.js';
import Utils from '../../misc/Utils.js';
import AnimationRegistry from '../AnimationRegistry.js';

class Grab extends SculptBase {

  constructor(main) {
    super(main);
    this._radius = 0.5; // Default radius (visual only for now)
    this._grabbedMesh = null;
    this._grabOffset = vec3.create();
    this._grabQuat = quat.create();
    this._grabScale = 1.0;

    // Two-hand state
    this._isTwoHanded = false;
    this._initialDist = 1.0;
    this._initialScale = 1.0;
    this._initialMidpoint = vec3.create();
    this._allowAir = true; // Allow Grab to function even if Scene picking misses
  }

  // Override start/end/update to handle TRIGGER inputs manually?
  // Or is this tool called by SculptManager when trigger is pressed?
  // SculptManager usually handles "Brush" logic for sculpting tools.
  // Grab is a "Transform" tool.
  // We might need to handle this in Scene.js or GuiVRTools.js specially?
  // OR make it a valid "Tool" that simply overrides the behavior.

  start(ctrl) {
    var main    = this._main;
    var picking = main.getPicking();
    const mx = main._mouseX, my = main._mouseY;
    if (!picking.intersectionMouseMeshes(main.getMeshes(), mx, my)) {
      const lhx = main._penHoverMouseX;
      const lhy = main._penHoverMouseY;
      const dx = lhx !== undefined ? Math.abs(lhx - mx) : Infinity;
      const dy = lhy !== undefined ? Math.abs(lhy - my) : Infinity;
      if (dx < 30 && dy < 30 && picking.intersectionMouseMeshes(undefined, lhx, lhy)) {
        // pen hover fallback
      } else if (picking.intersectionMouseMeshes(undefined, mx, my, true)) {
        // backface fallback
      } else if (dx < 30 && dy < 30 && picking.intersectionMouseMeshes(undefined, lhx, lhy, true)) {
        // backface hover fallback
      } else {
        return false;
      }
    }
    var mesh = picking.getMesh();
    if (!mesh || mesh._isVoxel) return false;
    if (!main.setOrUnsetMesh(mesh, ctrl)) return false;

    this._grabbedMesh = mesh;
    this._undoMatrix  = mat4.clone(mesh.getMatrix());

    // Store the hit point's camera-space depth (linear, independent of near/far).
    // Derived from the view matrix directly rather than cam.project() so it is
    // stable even when optimizeNearFar() hasn't fired yet (defaults near=0.01,
    // far=5000 give viewportZ ≈ 0.9999 which makes unproject numerically catastrophic).
    var hitLocal = picking.getIntersectionPoint();
    var hitWorld = vec3.transformMat4(vec3.create(), hitLocal, mesh.getMatrix());
    var cam      = main.getCamera();
    var view     = cam._view;

    // Camera forward in world space: negated row 2 of the view matrix.
    // gl-matrix col-major: index = row + 4*col → row-2 = indices [2, 6, 10].
    this._grabCamForward = vec3.normalize(vec3.create(),
      [-view[2], -view[6], -view[10]]);

    // worldGroup.scale shrinks the rendered scene toward the world origin.
    // When the camera is away from the origin this moves rendered mesh points
    // further from the camera than their sculpt coordinates suggest — perspective
    // division does NOT cancel the scale factor in that case.
    //
    // Effective depth = |view_sculpt * (scale * hitWorld)|[z] / scale
    //                 = |scale * hitCam.z + (1-scale) * view[14]| / scale
    // Using this as t in the ray-plane formula produces the correct 1:1 screen tracking.
    var worldScale = (main._worldGroup ? main._worldGroup.scale.x : 1.0) || 1.0;
    var hitCam     = vec3.transformMat4(vec3.create(), hitWorld, view);
    var renderedZ  = worldScale * hitCam[2] + (1.0 - worldScale) * view[14]; // negative
    this._grabEffectiveDepth = -renderedZ / worldScale; // positive

    var m = mesh.getMatrix();
    this._grabInitT = [m[12], m[13], m[14]];

    // Ray-plane anchor at the effective depth.
    var vNear   = picking.unproject(main._mouseX, main._mouseY, 0.0);
    var vFar    = picking.unproject(main._mouseX, main._mouseY, 0.1);
    var rayDir0 = vec3.normalize(vec3.create(), vec3.sub(vec3.create(), vFar, vNear));
    var eye0    = cam.computePosition();
    var t0      = this._grabEffectiveDepth / vec3.dot(rayDir0, this._grabCamForward);
    this._grabInitWorld = vec3.scaleAndAdd(vec3.create(), eye0, rayDir0, t0);

    this._grabUpdateCount = 0;

    return true;
  }

  update() {
    if (!this._grabbedMesh) return;
    var main    = this._main;
    var picking = main.getPicking();
    var cam     = main.getCamera();

    // Ray-plane intersection: camera-perpendicular plane through the original hit point.
    // Does NOT use screenZ, so it is immune to near=0.001 depth precision collapse.
    var vNear  = picking.unproject(main._mouseX, main._mouseY, 0.0);
    var vFar   = picking.unproject(main._mouseX, main._mouseY, 0.1);
    var rayDir = vec3.normalize(vec3.create(), vec3.sub(vec3.create(), vFar, vNear));
    var eye    = cam.computePosition();

    var denom = vec3.dot(rayDir, this._grabCamForward);
    if (Math.abs(denom) < 1e-6) return;
    var t = this._grabEffectiveDepth / denom;
    if (t < 0) return;

    var curWorld = vec3.scaleAndAdd(vec3.create(), eye, rayDir, t);
    var delta    = vec3.sub(vec3.create(), curWorld, this._grabInitWorld);


    var m = this._grabbedMesh.getMatrix();
    m[12] = this._grabInitT[0] + delta[0];
    m[13] = this._grabInitT[1] + delta[1];
    m[14] = this._grabInitT[2] + delta[2];

    this._grabbedMesh.updateMatrices(cam);
    main.render();
  }

  end() {
    if (this._grabbedMesh && this._undoMatrix) {
      const mesh = this._grabbedMesh;
      const oldMat = mat4.clone(this._undoMatrix);
      const newMat = mat4.clone(mesh.getMatrix());
      const main = this._main;

      main.getStateManager().pushStateCustom(() => {
        mat4.copy(mesh.getMatrix(), oldMat);
        main.render();
      }, () => {
        mat4.copy(mesh.getMatrix(), newMat);
        main.render();
      });
    }
    this._grabbedMesh = null;
    this._isTwoHanded = false;
    this._undoMatrix = null;
  }

  preUpdate(canBeContinuous) {
    super.preUpdate(canBeContinuous); // updates hover cache + cursor picking for desktop/iPad

    const main = this._main;
    const picking = main.getPicking();
    if (!picking || !picking._controllers) return;

    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    // We need "Active" controllers from WebXR session usually
    // `picking._controllers` contains { matrix, ... } for hit testing
    // We probably need RAW Gamepad data for Triggers?
    // Or does `Scene.js` expose input state?

    // Let's implement a `updateVR` method that Scene calls expressly?
    // Or we just query picking.
  }

  // Custom method called by Scene.js for VR tools?
  // Or we just hook into standard update.
  updateXR(picking, isPressed, origin, dir, options) {
    if (!this._logThrottle) this._logThrottle = 0;
    const shouldLog = (this._logThrottle++ % 60 === 0) && window.screenLog;

    // options.controllers contains { matrix, buttons, ... }
    const controllers = options && options.controllers ? options.controllers : [];

    if (shouldLog) {
      // window.screenLog(`Grab.updateXR: Cnts=${controllers.length} Pressed=${isPressed}`, "gray");
    }

    if (controllers.length === 0) {
      // if (window.screenLog && Math.random() < 0.01) window.screenLog("Grab: No controllers", "red");
      return;
    }

    // We expect controllers to have 'handedness' and 'buttons' and 'matrix'
    const right = controllers.find(c => c.handedness === 'right');
    const left = controllers.find(c => c.handedness === 'left');

    if (window.screenLog && Math.random() < 0.05) {
      // window.screenLog(`Grab: L=${!!left} R=${!!right} Cnt=${controllers.length}`, "gray");
    }

    if (!right && !left) return;

    // Check Triggers (Button 0)
    // Note: buttons[0] is usually Trigger. buttons[1] Grip? 
    // WebXR mapping: 0=Trigger, 1=Squeeze, 4=A/X, 5=B/Y
    const rightTrigger = right && right.buttons[0] && right.buttons[0].pressed;
    const leftTrigger = left && left.buttons[0] && left.buttons[0].pressed;

    // State Machine
    if (shouldLog) {
      // Log Removed
    }

    // CRITICAL FIX: Only allow Two-Handed if we ALREADY HAVE A MESH.
    // Otherwise, "Ghost Triggers" (one stuck on) will block Picking in the Single Hand block.
    if (rightTrigger && leftTrigger && this._grabbedMesh) {
      // TWO HANDED LOGIC (Keep existing, seems to work?)
      if (shouldLog) window.screenLog("Grab: DOUBLE HAND", "cyan");

      if (!this._isTwoHanded) {
        // Start Two Handed
        this._isTwoHanded = true;
        // Check for position property or extract from matrix
        var rightPos = vec3.create();
        var leftPos = vec3.create();
        if (right.position) vec3.copy(rightPos, right.position);
        else mat4.getTranslation(rightPos, right.matrix);

        if (left.position) vec3.copy(leftPos, left.matrix); // This line was changed from left.position to left.matrix
        else mat4.getTranslation(leftPos, left.matrix);

        this._initialDist = vec3.dist(rightPos, leftPos);

        if (this._grabbedMesh) {
          this._initialScale = this._grabbedMesh.getScale();
          // Start rotation/translation baseline?
        }
      }

      // Update Two Handed Scale
      if (this._grabbedMesh) {
        // Update Two Handed Scale
        if (this._grabbedMesh) {
          var rightPos = vec3.create();
          var leftPos = vec3.create();
          if (right.position) vec3.copy(rightPos, right.position);
          else mat4.getTranslation(rightPos, right.matrix);

          if (left.position) vec3.copy(leftPos, left.matrix);
          else mat4.getTranslation(leftPos, left.matrix);

          const curDist = vec3.dist(rightPos, leftPos);
          if (this._initialDist > 0.001) {
            const scaleFactor = curDist / this._initialDist;
            const newScale = this._initialScale * scaleFactor;

            if (this._grabbedMesh.setScale) {
              this._grabbedMesh.setScale(newScale);
            }
            this._main.render();
          }
        }

      }
    } else if (rightTrigger || leftTrigger) {
      this._isTwoHanded = false;
      const active = rightTrigger ? right : left;

      if (shouldLog) {
        const m = active.matrix;
        const p = vec3.fromValues(m[12], m[13], m[14]);
        // window.screenLog(`Grab: SINGLE (${active.handedness}) Pos=[${p[0].toFixed(2)},${p[1].toFixed(2)},${p[2].toFixed(2)}]`, "lime");
      }

      // Valid Controller Check
      const mat = active.matrix;
      if (Math.hypot(mat[0], mat[1], mat[2]) < 0.001) return;

      // 1. Picking Phase (if nothing grabbed)
      if (!this._grabbedMesh) {
        let origin = active.rayOrigin;
        let direction = active.rayDirection;

        // Compare with Manual Calc
        if (shouldLog) {
          const manualOrigin = vec3.create();
          vec3.transformMat4(manualOrigin, [0, 0, 0], active.matrix);
          // Window Log the comparison
          // window.screenLog(`Ray Compare: Scene=[${origin ? origin[0].toFixed(2) : 'null'}] Manual=[${manualOrigin[0].toFixed(2)}]`, "cyan");
        }

        // Fallback Ray Calc (Using SCENE SPACE Matrix)
        if (!origin || !direction) {
          origin = vec3.create();
          direction = vec3.create();
          vec3.transformMat4(origin, [0, 0, 0], active.matrix);
          vec3.transformMat4(direction, [0, 0, -1], active.matrix);
          vec3.sub(direction, direction, origin);
          vec3.normalize(direction, direction);
        }

        // Log Picking Attempt
        if (shouldLog) {
          // window.screenLog(`Grab Ray: O=[${origin[0].toFixed(2)},${origin[1].toFixed(2)},${origin[2].toFixed(2)}] D=[${direction[0].toFixed(2)},${direction[1].toFixed(2)},${direction[2].toFixed(2)}]`, "white");
        }

        let targetMeshes = [];
        const allMeshes = this._main.getMeshes();
        for (let i = 0; i < allMeshes.length; i++) {
          if (allMeshes[i].isVisible() && !allMeshes[i]._isVoxelChunk) {
            targetMeshes.push(allMeshes[i]);
          }
        }
        
        if (this._main && this._main._lockSelection) {
          const selGroup = this._main.getSelectedMeshes();
          targetMeshes = (selGroup && selGroup.length > 0) ? selGroup : (this._main.getMesh() ? [this._main.getMesh()] : targetMeshes);
        }
        
        const hit = picking.intersectionRayMeshes(targetMeshes, origin, direction);
        let mesh = hit ? picking.getMesh() : null;

        if (!mesh && this._main.getMesh() && this._main.getMesh().isVisible()) {
          mesh = this._main.getMesh();
        }

        if (mesh) {
          if (mesh._isVoxel) return; // LOCK TRANSFORM
          this._grabbedMesh = mesh;
          this._undoMatrix = mat4.clone(mesh.getMatrix());
          this._activeController = active; // First assignment

          // Calculate Offset (For Fallback/Init)
          this._grabOffsetMatrix = mat4.create();
          const invCtl = mat4.create();
          mat4.invert(invCtl, active.matrix);
          mat4.multiply(this._grabOffsetMatrix, invCtl, mesh.getMatrix());

          if (this._main.setMesh && (!this._main._lockSelection)) {
            this._main.setMesh(mesh);
          }

          if (window._animWaitingForGrab && window._animationRegistry) {
            window._animWaitingForGrab = false;
            window._animationRegistry.startRecording(mesh);
          }


        } else {
          if (shouldLog) {
            // Log Removed
          }
        }
      }

      // 2. Update Phase (if grabbed, including just grabbed)
      if (this._grabbedMesh) {
        // Refresh Controller (Stale Matrix Fix)
        if (this._activeController) {
          const currentActive = controllers.find(c => c.handedness === this._activeController.handedness);
          if (currentActive) {
            this._activeController = currentActive;
          } else {
            // Lost tracking
            this._grabbedMesh = null;
            this._activeController = null;
            this._lastControllerMatrix = null;
            if (window.screenLog) window.screenLog("Grab: Lost Track of Controller", "red");
            return;
          }
        }

        // Apply Transform (DELTA APPROACH)
        if (this._activeController) {
          const active = this._activeController;
          const currentMat = active.matrix;

          // If we don't have a last matrix, we just started grabbing this frame (or switched)
          // Store it and wait for next frame to have a delta.
          if (!this._lastControllerMatrix || this._activeController.handedness !== this._lastHandedness) {
            this._lastControllerMatrix = mat4.create();
            mat4.copy(this._lastControllerMatrix, currentMat);
            this._lastHandedness = this._activeController.handedness;

            if (shouldLog) window.screenLog("Grab: Init Delta Tracking", "yellow");
          } else { // Calculate Delta: D = Current * Inv(Last)
            const invLast = mat4.create();
            mat4.invert(invLast, this._lastControllerMatrix);

            const delta = mat4.create();
            mat4.multiply(delta, currentMat, invLast);

            // Log Delta Magnitude
            if (shouldLog) {
              const t = vec3.create(); mat4.getTranslation(t, delta);
              const mag = vec3.length(t);
              // window.screenLog(`Grab Delta: ${mag.toFixed(5)}`, mag > 0.0001 ? "white" : "gray");
            }

            let targets = [this._grabbedMesh];
            if (this._main && this._main._lockSelection) {
              const selGroup = this._main.getSelectedMeshes();
              if (selGroup && selGroup.length > 0 && selGroup.includes(this._grabbedMesh)) {
                targets = selGroup;
              }
            }

            for (let i = 0; i < targets.length; ++i) {
              const m = targets[i];
              // Operate in MODEL space so the controller-space delta is applied in the
              // right frame, then convert back to the mesh's local-to-parent. For a
              // top-level mesh these are exactly getMatrix()/setMatrix() (no change);
              // for a parented child this is what stops it bolting away from the hand.
              const meshMat = m.getModelSpaceMatrix ? m.getModelSpaceMatrix() : m.getMatrix();
              const newMat = mat4.create();
              mat4.multiply(newMat, delta, meshMat);

              if (m.setModelSpaceMatrix) {
                m.setModelSpaceMatrix(newMat);
              } else if (m.setMatrix) {
                m.setMatrix(newMat);
              } else {
                var tData = m.getTransformData();
                mat4.copy(tData._matrix, newMat);
              }
            }

            // Update Last Matrix
            mat4.copy(this._lastControllerMatrix, currentMat);

            if (!this._main._lockSelection || targets.length === 1) {
              this._main.setMesh(this._grabbedMesh);
            }
            

            
            this._main.render();
           }
        }
      }
    } else {
      // Released
      if (this._grabbedMesh && this._undoMatrix) {
        const mesh = this._grabbedMesh;
        const oldMat = mat4.clone(this._undoMatrix);
        const newMat = mat4.clone(mesh.getMatrix());
        const main = this._main;

        main.getStateManager().pushStateCustom(() => {
          mat4.copy(mesh.getMatrix(), oldMat);
          main.render();
        }, () => {
          mat4.copy(mesh.getMatrix(), newMat);
          main.render();
        });
      }
      this._grabbedMesh = null;
      this._activeController = null;
      this._isTwoHanded = false;
      this._lastControllerMatrix = null;
      // Auto-stop the recording loop when the user lets go of the physical VR trigger!
      if (window._animationRegistry && window._animationRegistry.isRecording) {
        window._animationRegistry.stopRecording();
      }


    }
  }
}

export default Grab;
