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
    // Existing pins may be owned independently by the two VR controllers. Ordinary
    // object/bone grabbing remains on the legacy single-owner path below.
    this._vrPinGrabs = new Map();
    this._vrPinTriggerWas = { left: false, right: false };
    this._vrPinGesture = null;
    this._vrPinSolveQueued = false;
  }

  // Wrist UI is easy to sweep through while either hand is puppeteering a rig.
  // Keep the MiniHUD inert for the full gesture, including the interval where one
  // hand has released but the other still owns a pin.
  blocksMiniHudInput() {
    return !!this._grabbedMesh || !!this._vrPinGesture || this._vrPinGrabs.size > 0;
  }

  _pinControllerRay(controller) {
    if (!controller?.matrix) return null;
    const origin = controller.rayOrigin ? vec3.clone(controller.rayOrigin) : vec3.create();
    const direction = controller.rayDirection ? vec3.clone(controller.rayDirection) : vec3.create();
    if (!controller.rayOrigin || !controller.rayDirection) {
      vec3.transformMat4(origin, [0, 0, 0], controller.matrix);
      vec3.transformMat4(direction, [0, 0, -1], controller.matrix);
      vec3.sub(direction, direction, origin);
      vec3.normalize(direction, direction);
    }
    return { origin, direction };
  }

  _pickPinForController(picking, controller) {
    const ray = this._pinControllerRay(controller);
    if (!ray) return null;
    const targets = this._main.getMeshes().filter(m => m?.isVisible?.() && m._isPinTarget);
    if (!targets.length) return null;
    if (!picking.intersectionRayMeshes(targets, ray.origin, ray.direction, true)) return null;
    const pin = picking.getMesh();
    if (!pin?._isPinTarget) return null;
    for (const held of this._vrPinGrabs.values()) {
      if (held.pin === pin) return null;
    }
    return pin;
  }

  _restorePinGesture(snapshot) {
    if (!snapshot) return;
    const main = this._main;
    for (const [joint, m] of snapshot.rig) { mat4.copy(joint.getMatrix(), m); Skeleton.syncThree(joint); }
    for (const [pin, m] of snapshot.pins) {
      if (pin.setModelSpaceMatrix) pin.setModelSpaceMatrix(m);
      else mat4.copy(pin.getMatrix(), m);
    }
    IKSolver.syncPinCache(main);
    Skeleton.updateVisuals(main);
    main.render();
  }

  _flushXRPinSolve() {
    if (!this._vrPinSolveQueued) return;
    this._vrPinSolveQueued = false;
    IKSolver.holdPins(this._main);
    IKSolver.syncJointCache(this._main);
    IKSolver.syncPinCache(this._main);
    // XR's render loop rebuilds skeleton visuals every frame. Doing it here as well causes
    // a second full rig-visual pass for every controller movement.
  }

  _queueXRPinSolve() {
    if (this._vrPinSolveQueued) return;
    this._vrPinSolveQueued = true;
    queueMicrotask(() => this._flushXRPinSolve());
  }

  // Publish which pins each controller is HOLDING. It used to drive a per-hand tint; the tint
  // is gone (held reads as selected now, see Skeleton), but the map is still what tells the
  // visuals a pin is in a hand rather than merely aimed at.
  _syncXRPinGrabs() {
    const handMap = {};
    for (const [hand, held] of this._vrPinGrabs) handMap[held.pin.getID()] = hand;
    const signature = JSON.stringify(handMap);
    if (signature === this._vrPinGrabSignature) return;
    this._vrPinGrabSignature = signature;
    this._main._rigGrabHands = handMap;
    Skeleton.updateVisuals(this._main);
    this._main.render?.();
  }

  _updateXRPinGrabs(picking, controllers) {
    if (this._grabbedMesh || !controllers.length) return false;
    const right = controllers.find(c => c.handedness === 'right' && c.matrix);
    const left = controllers.find(c => c.handedness === 'left' && c.matrix);
    // Scene dispatches tools through one dominant active source, but supplies a complete
    // controller snapshot in options.controllers. Read both snapshots here; filtering by
    // options.handedness would silently discard the non-dominant trigger.
    const activeControllers = [left, right].filter(Boolean);
    if (!activeControllers.length) return this._vrPinGrabs.size > 0;

    const hadGesture = this._vrPinGrabs.size > 0;
    for (const controller of activeControllers) {
      const hand = controller.handedness;
      const pressed = !!controller.buttons?.[0]?.pressed;
      const was = !!this._vrPinTriggerWas[hand];
      if (pressed && !was && !this._vrPinGrabs.has(hand)) {
        const pin = this._pickPinForController(picking, controller);
        if (pin) {
          if (!this._vrPinGesture) {
            this._vrPinGesture = {
              rig: IKSolver.captureAll(this._main),
              pins: IKSolver.pinnedJoints(this._main).map(j => {
                const p = IKSolver.pinObject(j);
                const m = p?.getModelSpaceMatrix ? p.getModelSpaceMatrix() : p?.getMatrix?.();
                return p && m ? [p, mat4.clone(m)] : null;
              }).filter(Boolean),
              recordMesh: pin,
            };
            const registry = window._animationRegistry;
            const startedRecording = registry?.beginInteraction?.(pin);
            // Immediate/count-in recording may already be live before the first controller
            // grabs. In that case beginInteraction deliberately does not restart the take,
            // but this first pin must still join its target set.
            if (!startedRecording && (registry?.isRecording || registry?.isCountingIn)) {
              registry.addInteractionTarget?.(pin);
            }
          } else {
            window._animationRegistry?.addInteractionTarget?.(pin);
          }
          // THE OFFSET IS CAPTURED ONCE, AT THE GRAB, AND NEVER RE-DERIVED.
          //
          // This used to accumulate: each frame took `controller * inv(lastController)` and
          // applied it to the pin's CURRENT matrix, then stored the controller pose as the new
          // baseline. That is only correct while nothing else touches the pin between frames —
          // and things do. The solver moves a joint that a pin is parented under, the visuals
          // re-seat a rotation-only pin onto its joint, a solve lands a frame late. Every one of
          // those displacements got folded into the next frame's baseline and KEPT, so the pin
          // slid out from under the hand holding it — worse the faster you moved, because a
          // faster drag is where the solve is most behind. matt: "if i move them too quickly it
          // will recalculate an offset of the pin vs where my controller is."
          //
          // Held in the controller's own frame instead, the pin is a rigid child of the hand for
          // the length of the gesture. Nothing accumulates, and anything that does write the pin
          // is overwritten on the next frame rather than inherited.
          const gm = pin.getModelSpaceMatrix ? pin.getModelSpaceMatrix() : pin.getMatrix();
          const invGrab = mat4.create();
          const offset = mat4.create();
          if (mat4.invert(invGrab, controller.matrix)) mat4.multiply(offset, invGrab, gm);
          else mat4.copy(offset, gm);
          this._vrPinGrabs.set(hand, { pin, offset });
          this._syncXRPinGrabs();
          this._main._lastRigEdit = pin;
          // AND SELECT IT. This is the one rig grab that never did: the ordinary path calls
          // setMesh on whatever it took, but pins have their own gesture here and it only
          // recorded the pin for AutoKey. So the pin was being dragged while the app's
          // selection sat on whatever was there before — usually the joint underneath — and
          // everything downstream that reads the selection was answering about the wrong
          // object. matt: "if i grab, its clearly grabbing and manipulating the pin."
          //
          // That is what made the motion trail depend on the route: the dopesheet row selects
          // the pin, this did not, and the trail reads the selection.
          //
          // keepTool, like the timeline's row click: taking hold of a pin must not switch the
          // active tool out from under the hand that is holding it.
          if (!this._main._lockSelection) this._main.setMesh?.(pin, true);
        }
      }
      this._vrPinTriggerWas[hand] = pressed;
    }

    if (!hadGesture && this._vrPinGrabs.size === 0) return false;

    // Release ownership independently; the other hand remains live.
    for (const controller of activeControllers) {
      if (!controller.buttons?.[0]?.pressed) this._vrPinGrabs.delete(controller.handedness);
    }
    this._syncXRPinGrabs();

    // A held pin must not suppress aim feedback for the free hand. The free controller can
    // continue preselecting its next target while the other controller moves its pin.
    const freeHoverRays = activeControllers
      .filter((controller) => !this._vrPinGrabs.has(controller.handedness)
        && !controller.buttons?.[0]?.pressed)
      .map((controller) => {
        const ray = this._pinControllerRay(controller);
        return ray && { handedness: controller.handedness, ...ray };
      }).filter(Boolean);
    if (freeHoverRays.length) {
      Skeleton.hoverRigFromRays(this._main, picking, freeHoverRays, freeHoverRays[0].handedness);
    }

    let moved = false;
    for (const controller of activeControllers) {
      const state = this._vrPinGrabs.get(controller.handedness);
      if (!state) continue;
      // Absolute: where the hand is now, times where the pin sat in the hand when it was
      // taken. The pin's current matrix is deliberately not read — reading it is what let
      // someone else's write become part of the answer.
      const next = mat4.create(); mat4.multiply(next, controller.matrix, state.offset);
      if (state.pin.setModelSpaceMatrix) state.pin.setModelSpaceMatrix(next);
      else mat4.copy(state.pin.getMatrix(), next);
      Skeleton.syncThree(state.pin);
      moved = true;
    }

    if (moved) this._queueXRPinSolve();

    if (this._vrPinGrabs.size === 0 && this._vrPinGesture) {
      // If release happened in the same frame as a final movement, solve before taking
      // the after-snapshot; the queued microtask becomes a harmless no-op.
      this._flushXRPinSolve();
      const before = this._vrPinGesture;
      const after = {
        rig: IKSolver.captureAll(this._main),
        pins: before.pins.map(([pin]) => {
          const m = pin.getModelSpaceMatrix ? pin.getModelSpaceMatrix() : pin.getMatrix();
          return [pin, mat4.clone(m)];
        }),
      };
      this._main.getStateManager().pushStateCustom(
        () => this._restorePinGesture(before), () => this._restorePinGesture(after), false, 'Two-hand pin pose');
      window._animationRegistry?.endInteraction?.(before.recordMesh);
      this._vrPinGesture = null;
    }
    return true;
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
    // See the note at the VR pick below: AutoKey reads the SCULPTING pick, not this one.
    main._lastRigEdit = (mesh._isBone || mesh._isPinTarget) ? mesh : null;
    this._undoMatrix  = mat4.clone(mesh.getMatrix());
    // GRABBING A BONE IS AN IK OPERATION, not a transform. The skeleton is driven by the
    // solver, so dragging a joint states where that joint should END UP and the rest of the
    // rig rearranges around it and around the pins — dragging the bone itself would edit the
    // rig's proportions, which is Tweak's job and emphatically not what a grab means.
    this._grabIsJoint = Skeleton.isJoint(mesh);
    this._grabUndoRig = this._grabIsJoint ? IKSolver.captureAll(main) : null;

    // "Start on click" recording: armed-and-waiting → begin the take now that a desktop
    // grab has started (mirror of the VR grab hook in updateXR).
    window._animationRegistry?.beginInteraction?.(mesh);

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
    // Shared with the Transform tool: Skeleton.hoverRigFromMouse. Two tools needing the same
    // preselection is exactly how the mouse and VR picks drifted apart earlier.
    if (!this._main._xrSession && !this._grabbedMesh) {
      Skeleton.hoverRigFromMouse(this._main, this._main.getPicking?.());
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
    // A PINS THE BONE YOU ARE POINTING AT — the same press, cycle and undo the bone tool and
    // Transform use. Read FIRST: the `controllers.length === 0` return just below would
    // otherwise swallow it, and a face button is not aimed at anything (that exact swallow is
    // the "A works, then doesn't" bug the reader in SculptBase was written for). Skipped while
    // a grab is in flight, so the press that takes hold of a joint does not also re-pin it.
    IKSolver.pinOnA(this, options, !!this._grabbedMesh);

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

    // Pins-only two-controller manipulation. If no pin was acquired this returns false and
    // the existing single-object Grab behaviour continues unchanged.
    if (this._updateXRPinGrabs(picking, controllers)) return;

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
      // preselection at all. Evaluate both supplied stylus rays so each controller can show
      // what it would acquire; the dominant ray remains the face-button action target.
      if (window._grabTrace) console.log('[grabXR] HOVER branch, controller=' + !!(right || left));
      const hoverRays = controllers.map((controller) => {
        const ray = this._pinControllerRay(controller);
        return ray && { handedness: controller.handedness, ...ray };
      }).filter(Boolean);
      Skeleton.hoverRigFromRays(this._main, picking, hoverRays, options?.handedness);
    } else if (rightTrigger || leftTrigger) {
      this._isTwoHanded = false;
      const active = rightTrigger ? right : left;

      // BUTTON-ONLY CONTROLLERS HAVE NO POSE. When a menu is under the ray, Scene takes the
      // menu-guard path and hands the tools `{handedness, buttons}` with no matrix and no ray
      // — deliberately, so face-button bindings keep working while pointing at a panel (the
      // path that once passed nothing at all and silently killed every face button).
      //
      // The trigger is read straight out of those buttons, so holding it while pointing at a
      // panel walked into this branch and dereferenced a matrix that was never sent, throwing
      // once per frame for the rest of the session. There is nothing to grab with here.
      if (!active || !active.matrix) return;

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
          // AUTOKEY KEYS WHAT THE TOOL TOOK, and only the tool knows what that was.
          // `currentMesh` at AutoKey time comes from _vrSculptMesh — the SCULPTING pick,
          // captured at stroke start, before this rig-aware pick has run — so on a grabbed
          // bone or pin it is still the skin. Same marker the bones tool sets; the AutoKey
          // block reads it and clears it.
          this._main._lastRigEdit = (mesh._isBone || mesh._isPinTarget) ? mesh : null;
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

          window._animationRegistry?.beginInteraction?.(mesh);


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
      const releasedMesh = this._grabbedMesh;
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
      window._animationRegistry?.endInteraction?.(releasedMesh);


    }
  }
}

export default Grab;
