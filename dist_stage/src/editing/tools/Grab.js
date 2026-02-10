import { vec3, mat4, quat } from 'gl-matrix';
import SculptBase from './SculptBase.js?v=fix_3';
import Utils from '../../misc/Utils.js?v=fix_3';

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

  start(main) {
    // We don't need standard stroke start
  }

  end() {
    this._grabbedMesh = null;
    this._isTwoHanded = false;
  }

  preUpdate() {
    // Check for VR Trigger inputs
    // We need to access inputs directly from main or scene
    const main = this._main;
    // const inputs = main.getPicking()._currWorld; // Controller inputs
    // Main is SculptGL instance. Scene is accessible via main? 
    // Usually controls are in Scene.js handles coordinates.
    // However, Tools usually get `main` which is `SculptGL`.
    // We need VR Gamepad data.

    // Actually, `SculptGL.js` calls `tool.update(main)`
    // We need to access the VR controllers.
    // `main` has `_scene`? No, `main` is `SculptGL`.
    // `Scene.js` has `_sculptgl` (main).
    // But `SculptGL` doesn't strictly know about VR controllers unless we pass them?
    // `Scene.js` handles `handleXRInput`. 
    // IT already passes picking data to tools?
    // Let's assume we can access `main.getScene().getGamepads()` if we add that accessor?
    // Or we rely on `Picking` which might have controller data?
    // `Picking.js` has `_controllers`.

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

        const hit = picking.intersectionRayMeshes(this._main.getMeshes(), origin, direction);
        let mesh = hit ? picking.getMesh() : null;

        // Fallback: Use Active Mesh (Relaxed Grabbing)
        if (!mesh && this._main.getMesh()) {
          mesh = this._main.getMesh();
          // if (shouldLog) window.screenLog(`Grab: Fallback to Active Mesh ${mesh.getID()}`, "cyan");
        }

        if (mesh) {
          this._grabbedMesh = mesh;
          this._activeController = active; // First assignment

          // if (window.screenLog) window.screenLog(`Grab: CAUGHT Mesh ${mesh.getID()}`, "green");

          // Calculate Offset (For Fallback/Init)
          this._grabOffsetMatrix = mat4.create();
          const invCtl = mat4.create();
          mat4.invert(invCtl, active.matrix);
          mat4.multiply(this._grabOffsetMatrix, invCtl, mesh.getMatrix());

          if (this._main.setMesh) this._main.setMesh(mesh);
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

            // Apply Delta to Mesh: New = Delta * Old
            const meshMat = this._grabbedMesh.getMatrix();
            const newMat = mat4.create();
            mat4.multiply(newMat, delta, meshMat);

            if (shouldLog) {
              // const t = newMat.subarray(12, 15);
              // window.screenLog(`Grab: Delta Applied`, "lime");
            }

            if (this._grabbedMesh.setMatrix) {
              this._grabbedMesh.setMatrix(newMat);
            } else {
              var tData = this._grabbedMesh.getTransformData();
              mat4.copy(tData._matrix, newMat);
            }

            // Update Last Matrix
            mat4.copy(this._lastControllerMatrix, currentMat);

            this._main.setMesh(this._grabbedMesh);
            this._main.render();
           }
        }
      }
    } else {
      // Released
      if (this._grabbedMesh) {
        if (window.screenLog) window.screenLog("Grab: RELEASED", "white");
      }
      this._grabbedMesh = null;
      this._activeController = null;
      this._isTwoHanded = false;
      this._lastControllerMatrix = null;
    }
  }
}

export default Grab;
