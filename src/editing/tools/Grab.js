import * as THREE from 'three';
import { vec3, mat4, quat } from 'gl-matrix';
import SculptBase from './SculptBase.js';
import Utils from '../../misc/Utils.js';
import AnimationRegistry from '../AnimationRegistry.js';
import IKSolver from '../IKSolver.js';
import Skeleton from '../Skeleton.js';

const _gV = new THREE.Vector3();
const _grabM = new THREE.Matrix4();
const _grabQ = new THREE.Quaternion();
const _grabS = new THREE.Vector3();
const _grabTarget = [0, 0, 0];
const _grabTargetV = new THREE.Vector3();

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
    // Grab is a SELECTION-style tool — an immediate transform with no gizmo — so it opts into
    // rig picking: a joint or a pin is exactly the sort of thing you reach out and move with it.
    if (!picking.intersectionMouseMeshes(main.getMeshes(), mx, my, false, true)) {
      const lhx = main._penHoverMouseX;
      const lhy = main._penHoverMouseY;
      const dx = lhx !== undefined ? Math.abs(lhx - mx) : Infinity;
      const dy = lhy !== undefined ? Math.abs(lhy - my) : Infinity;
      if (dx < 30 && dy < 30 && picking.intersectionMouseMeshes(undefined, lhx, lhy, false, true)) {
        // pen hover fallback
      } else if (picking.intersectionMouseMeshes(undefined, mx, my, true, true)) {
        // backface fallback
      } else if (dx < 30 && dy < 30 && picking.intersectionMouseMeshes(undefined, lhx, lhy, true, true)) {
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
    // GRABBING A BONE IS AN IK OPERATION, not a transform. The skeleton is driven by the
    // solver, so dragging a joint states where that joint should END UP and the rest of the
    // rig rearranges around it and around the pins — dragging the bone itself would edit the
    // rig's proportions, which is Tweak's job and emphatically not what a grab means.
    this._grabIsJoint = Skeleton.isJoint(mesh);
    this._grabUndoRig = this._grabIsJoint ? IKSolver.captureAll(main) : null;

    // "Start on click" recording: armed-and-waiting → begin the take now that a desktop
    // grab has started (mirror of the VR grab hook in updateXR).
    if (window._animWaitingForGrab && window._animationRegistry) {
      window._animWaitingForGrab = false;
      window._animationRegistry.startRecording(mesh);
    }

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

    // The world group's transform is what separates RENDERED space (where the cursor ray
    // lives, since unproject works against the drawn projection) from MODEL space (where
    // hitWorld and the mesh matrices live). Cached at grab time so the drag maps the ray into
    // model space rather than compensating for the difference with a depth fudge.
    this._grabWorldInv = null;
    const wg = main._worldGroup;
    if (wg) {
      wg.updateMatrixWorld(true);
      this._grabWorldInv = new THREE.Matrix4().copy(wg.matrixWorld).invert();
    }

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

    // THE ANCHOR IS THE HIT POINT ITSELF — no reconstruction.
    //
    // This used to rebuild it as eye + rayDir * (depth / dot(rayDir, forward)), which is a
    // perspective-only formula: under orthographic the eye is not a point the rays pass
    // through. Worse, update() intersects the cursor ray with a plane, so start() and update()
    // were computing the same point two different ways — and where they disagree, the very
    // first mouse move jumps by the difference. That is the warp.
    //
    // The pick already gives the point under the cursor, on the surface, in world space. Using
    // it directly makes the anchor exact and identical under both projections, and the drag
    // starts with a delta of precisely zero.
    this._grabInitWorld = vec3.clone(hitWorld);
    // The drag plane, stated as a point and a normal rather than a depth from the eye. Under
    // ORTHOGRAPHIC projection every ray is parallel and the eye is not a real point the rays
    // pass through — only the unprojected NEAR point moves with the cursor — so a depth-from-eye
    // formula gives the same answer for every mouse position and the drag does nothing at all.
    this._grabPlanePt = vec3.clone(this._grabInitWorld);
    // Camera forward in MODEL space: a direction, so the translation is removed by mapping two
    // points and taking the difference.
    if (this._grabWorldInv) {
      const a = _gV.set(0, 0, 0).applyMatrix4(this._grabWorldInv).clone();
      const b = _gV.fromArray(this._grabCamForward).applyMatrix4(this._grabWorldInv);
      this._grabCamForwardModel = vec3.normalize(vec3.create(), [b.x - a.x, b.y - a.y, b.z - a.z]);
    } else {
      this._grabCamForwardModel = null;
    }

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
    // Into MODEL space, so the ray, the drag plane and the resulting delta are all one space
    // and the delta can be added to the mesh matrix untouched.
    if (this._grabWorldInv) {
      _gV.fromArray(vNear).applyMatrix4(this._grabWorldInv).toArray(vNear);
      _gV.fromArray(vFar).applyMatrix4(this._grabWorldInv).toArray(vFar);
    }
    var rayDir = vec3.normalize(vec3.create(), vec3.sub(vec3.create(), vFar, vNear));

    // The plane normal has to live in the same space as the ray now, so it is mapped too —
    // direction only, hence the w=0 transform via subtracting the mapped origin.
    var fwd = this._grabCamForwardModel || this._grabCamForward;
    var denom = vec3.dot(rayDir, fwd);
    if (Math.abs(denom) < 1e-6) return;

    // Intersect the cursor ray with the drag plane, from the ray's OWN origin. vNear is the
    // unprojected near point, which tracks the cursor under both projections; the eye only
    // does so under perspective.
    var toPlane = vec3.sub(vec3.create(), this._grabPlanePt, vNear);
    var t = vec3.dot(toPlane, fwd) / denom;
    var curWorld = vec3.scaleAndAdd(vec3.create(), vNear, rayDir, t);
    var delta    = vec3.sub(vec3.create(), curWorld, this._grabInitWorld);


    if (this._grabIsJoint) {
      // The dragged joint is the effector; every pin holds. The solve writes the whole chain,
      // so nothing is set on the joint directly.
      _grabTarget[0] = this._grabInitT[0] + delta[0];
      _grabTarget[1] = this._grabInitT[1] + delta[1];
      _grabTarget[2] = this._grabInitT[2] + delta[2];
      IKSolver.solve(main, this._grabbedMesh, _grabTargetV.fromArray(_grabTarget));
      Skeleton.updateVisuals(main);
      main.render();
      return;
    }

    var m = this._grabbedMesh.getMatrix();
    m[12] = this._grabInitT[0] + delta[0];
    m[13] = this._grabInitT[1] + delta[1];
    m[14] = this._grabInitT[2] + delta[2];

    this._grabbedMesh.updateMatrices(cam);
    main.render();
  }

  end() {
    // A solved grab moved the WHOLE chain, so one matrix is not the undo — the snapshot taken
    // at grab time is.
    if (this._grabbedMesh && this._grabIsJoint && this._grabUndoRig) {
      const main = this._main;
      const before = this._grabUndoRig;
      const after = IKSolver.captureAll(main);
      const put = (snap) => {
        for (const [j, m] of snap) { mat4.copy(j.getMatrix(), m); Skeleton.syncThree(j); }
        Skeleton.updateVisuals(main); main.render();
      };
      main.getStateManager().pushStateCustom(() => put(before), () => put(after), false, 'Pose');
      this._grabbedMesh = null;
      this._grabIsJoint = false;
      this._grabUndoRig = null;
      this._undoMatrix = null;
      this._isTwoHanded = false;
      return;
    }
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
    this._grabIsJoint = false;
    this._grabUndoRig = null;
    this._isTwoHanded = false;
    this._undoMatrix = null;
  }

  preUpdate(canBeContinuous) {
    super.preUpdate(canBeContinuous); // updates hover cache + cursor picking for desktop/iPad

    // PRESELECTION for the rig. Grab reaches bones and pins, so it has to say which one the
    // next press will take — they sit inside the sculpt and are small on screen, and without
    // the highlight you are aiming at something you cannot confirm you have. Skipped while a
    // grab is in flight: the answer is already settled, and re-picking every frame of a drag
    // would flicker the highlight onto whatever the cursor passes over.
    const m = this._main;
    if (!this._grabbedMesh && m && m.getPicking) {
      const pk = m.getPicking();
      const hit = pk && pk.intersectionMouseMeshes(m.getMeshes(), m._mouseX, m._mouseY, false, true)
        ? pk.getMesh() : null;
      const node = hit && (hit._isBone || hit._isPinTarget) ? hit : null;
      const wasJ = m._skelHighlightId ?? -1;
      const wasP = m._pinHighlightId ?? -1;
      Skeleton.setRigHighlight(m, node);
      if ((m._skelHighlightId ?? -1) !== wasJ || (m._pinHighlightId ?? -1) !== wasP) {
        Skeleton.updateVisuals(m);
        m.render();
      }
    }

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

    if (window._grabTrace) {
      console.log('[grabXR] ctrls=' + controllers.length + ' right=' + !!right + ' left=' + !!left);
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
    } else if (!this._grabbedMesh && !rightTrigger && !leftTrigger) {
      // HOVER. Everything below is gated on a trigger, so until now nothing in VR picked
      // anything until you had already committed to grabbing it — which is why there was no
      // preselection at all. One ray per frame from the dominant controller, highlight only.
      // THROTTLED, and that is not a nicety. A full ray pick against every mesh plus a skeleton
      // visual rebuild, ninety times a second, costs more frame than it is worth — and the
      // symptom was not slowness but the grab failing outright, with anything that changed the
      // frame timing (the trace, or merely attaching the remote console) appearing to "fix" it.
      // Preselection does not need 90Hz; a hand does not move that fast, and the highlight is
      // sticky between checks.
      const nowMs = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      const due = !this._lastHoverMs || (nowMs - this._lastHoverMs) >= (window._grabHoverMs || 66);
      if (window._grabTrace) {
        console.log('[grabXR] HOVER branch, controller=' + !!(right || left) + ' due=' + due);
      }
      const hoverC = right || left;
      if (due && (hoverC || (origin && dir))) {
        this._lastHoverMs = nowMs;
        // THE RAY SCENE ALREADY HANDED US. `origin`/`dir` arrive in ENGINE space, which is what
        // the pick works in; deriving one from the controller matrix instead puts it in the raw
        // WebXR frame, and the pick then misses everything in the scene on every frame — which
        // is exactly what the trace showed (hit=false, 12 meshes, forever). The trigger branch
        // below only falls back to the matrix when Scene does NOT supply a ray, and this must
        // do the same rather than always taking the fallback.
        let o = origin, d = dir;
        if (!o || !d) {
          o = vec3.create(); d = vec3.create();
          vec3.transformMat4(o, [0, 0, 0], hoverC.matrix);
          vec3.transformMat4(d, [0, 0, -1], hoverC.matrix);
          vec3.sub(d, d, o);
          vec3.normalize(d, d);
        }
        const vis = this._main.getMeshes().filter((m) => m.isVisible() && !m._isVoxelChunk);
        const got = picking.intersectionRayMeshes(vis, o, d, true);
        const hm = got ? picking.getMesh() : null;
        if (window._grabTrace) {
          console.log('[grabXR] hover pick: ray=' + (origin && dir ? 'scene' : 'derived') +
            ' meshes=' + vis.length + ' hit=' + !!got +
            ' name=' + (hm ? (hm._permanentStaticLabel || hm.getID()) : 'none') +
            ' rig=' + !!(hm && (hm._isBone || hm._isPinTarget)));
        }
        const node = hm && (hm._isBone || hm._isPinTarget) ? hm : null;
        const wasJ = this._main._skelHighlightId ?? -1;
        const wasP = this._main._pinHighlightId ?? -1;
        Skeleton.setRigHighlight(this._main, node);
        if ((this._main._skelHighlightId ?? -1) !== wasJ
            || (this._main._pinHighlightId ?? -1) !== wasP) {
          Skeleton.updateVisuals(this._main);
          // The hover's work has to reach the screen. render() only raises the redraw flag, so
          // this is one boolean — but tying it to an actual CHANGE keeps the idle case free.
          this._main.render();
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
        
        // Rig nodes included: in VR a bone or a pin is exactly what you reach out and take.
        const hit = picking.intersectionRayMeshes(targetMeshes, origin, direction, true);
        let mesh = hit ? picking.getMesh() : null;

        // Preselection, the same signal the desktop hover gives: the marker under the ray grows
        // and warms, so you can see what the trigger will take before you pull it.
        if (!this._grabbedMesh) {
          const node = mesh && (mesh._isBone || mesh._isPinTarget) ? mesh : null;
          const wasJ = this._main._skelHighlightId ?? -1;
          const wasP = this._main._pinHighlightId ?? -1;
          Skeleton.setRigHighlight(this._main, node);
          if ((this._main._skelHighlightId ?? -1) !== wasJ
              || (this._main._pinHighlightId ?? -1) !== wasP) {
            Skeleton.updateVisuals(this._main);
          }
        }

        if (!mesh && this._main.getMesh() && this._main.getMesh().isVisible()) {
          mesh = this._main.getMesh();
        }

        if (mesh) {
          if (mesh._isVoxel) return; // LOCK TRANSFORM
          this._grabbedMesh = mesh;
          this._undoMatrix = mat4.clone(mesh.getMatrix());
          // Same rule as the desktop grab: taking a BONE is an IK operation, not a transform.
          this._grabIsJoint = Skeleton.isJoint(mesh);
          this._grabUndoRig = this._grabIsJoint ? IKSolver.captureAll(this._main) : null;
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

            // A GRABBED BONE POSES THE RIG. The controller states where that joint should end
            // up and the solver rearranges the chain around it and around the pins; applying
            // the delta to the bone directly would edit the rig's proportions instead.
            if (this._grabIsJoint) {
              const jm = this._grabbedMesh.getModelSpaceMatrix
                ? this._grabbedMesh.getModelSpaceMatrix() : this._grabbedMesh.getMatrix();
              const nm = mat4.create();
              mat4.multiply(nm, delta, jm);
              // POSITION AND ORIENTATION BOTH. The controller carries 6DOF, and the solver
              // takes a driven orientation as a constraint rather than a decoration — the
              // joint's children are carried by it, so twisting the hand twists the limb and
              // the pins re-solve against where it lands. Passing position alone was why a
              // grabbed bone slid but never turned, while a pin (which receives the whole
              // delta matrix) did both.
              _grabM.fromArray(nm);
              _grabM.decompose(_grabTargetV, _grabQ, _grabS);
              IKSolver.solve(this._main, this._grabbedMesh, _grabTargetV, null, _grabQ);
              Skeleton.updateVisuals(this._main);
              mat4.copy(this._lastControllerMatrix, currentMat);
              this._main.render();
              return;
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
