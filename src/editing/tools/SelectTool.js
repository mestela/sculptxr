import SculptBase from './SculptBase.js';
import Skeleton from '../Skeleton.js';

/**
 * SELECT — a tool that picks things and does nothing else.
 *
 * Every existing way to choose an object in the viewport also moves it. Grab takes hold on the
 * same press that selects, and the two transforms put a gizmo under your hand: aiming at a small
 * part and pressing means nudging it, and on a robot built out of placed hinges that is a
 * correction to undo every time you want to look at something. matt: "even with grab i found it
 * was too easy to nudge things out of place. maybe select would be good."
 *
 * So this tool has no verb. It never writes a matrix, never touches a vertex, never starts a
 * stroke — `start` returns false, so the manager marks no stroke active and `end` has nothing to
 * finish. The entire behaviour is: say what is under the pointer, and on a press make that the
 * selection.
 *
 * THE OTHER CONTROLLER'S TRIGGER IS THE MODIFIER. Held, a press adds to the selection instead of
 * replacing it — Ctrl-click, with the hand that is not pointing. It is the same gesture Transform
 * and the outliner already use (Scene.multiSelectHeld, the non-dominant trigger), asked here in a
 * symmetric form — "any hand that is not the one that pressed" — because either controller can be
 * the one doing the pointing in this tool.
 */
class SelectTool extends SculptBase {

  constructor(main) {
    super(main);
    // One press, one selection. Also opts this tool into the manager's single-action debounce,
    // which is exactly right for a click and harmless for anything else.
    this._continuous = false;
    // Per hand, for the press EDGE. A held trigger arrives at 90Hz and a selection per frame is
    // not a selection — the same reason the rig assignment reads an edge rather than a level.
    this._vrTriggerWas = {};
    // Same-target press guard — see isDragAction.
    this._lastHitId = null;
    this._lastHitMs = 0;
  }

  /**
   * OPTS OUT OF THE MANAGER'S 300ms SINGLE-ACTION DEBOUNCE, and guards itself instead.
   *
   * The hook is named for the case it was written for (a press-and-drag mode inside a
   * `_continuous === false` tool), but what it does is skip the blanket debounce, and the
   * blanket is wrong here: 300ms between selections is slower than anyone ctrl-clicks their way
   * round a rig, and a dropped click is silent. Measured — clicks 300ms apart were simply
   * ignored, leaving the selection stuck on the first thing pressed.
   *
   * What the debounce exists for still applies, though. On iPadOS the pressure-transition
   * synthesis and the real pointerdown can both reach start() 10-200ms apart, and for a plain
   * click a duplicate is harmless (you select the same thing twice) while for a ctrl-click it is
   * not: the second press TOGGLES the object back out and the gesture looks like it did nothing.
   *
   * So the guard is narrowed to the case that can actually go wrong — the SAME target twice in
   * quick succession — and a deliberate press on something else is never blocked.
   */
  isDragAction() { return true; }

  _repeatPress(hit) {
    const now = performance.now();
    const id = hit ? hit.getID() : -1;
    const repeat = id === this._lastHitId && (now - this._lastHitMs) < 250;
    this._lastHitId = id;
    this._lastHitMs = now;
    return repeat;
  }

  // NOTHING IS EDITED, EVER. These exist to make that structural rather than incidental: the
  // base class's versions run a sculpt stroke, and inheriting them is how a "selection" tool
  // would quietly acquire the ability to deform something.
  update() {}
  end() {}
  updateContinuous() {}
  addSculptToScene() {}

  // WHAT THE PRESS WOULD TAKE, on the desktop. Same call Grab makes, and deliberately the same
  // one: two tools computing their own preselection is how the mouse and VR picks drifted apart
  // before. It lights a rig node through the rig's channel and an ordinary mesh through the
  // bounds outline, and asks the question this tool exists to answer.
  preUpdate() {
    if (!this._main._xrSession) {
      Skeleton.hoverRigFromMouse(this._main, this._main.getPicking?.());
    }
  }

  /**
   * Desktop. Ctrl adds to the selection, the same modifier Transform takes.
   *
   * A CLICK ON NOTHING CLEARS THE SELECTION, which is the conventional half of "select" and the
   * viewport twin of clicking blank space in the outliner. Deliberately NOT done in VR — see
   * updateXR.
   */
  start(ctrl) {
    const main = this._main;
    // NOT IN VR. Scene calls the manager's start() on the trigger press as well as dispatching
    // updateXR, so without this a VR press would ALSO run the mouse pick below — against
    // `_mouseX`/`_mouseY`, which in a headset are wherever the desktop pointer was left. That is
    // a selection from a position nobody is looking at. The headset's press is handled on the
    // edge in updateXR, which is the only place that knows which hand pulled.
    if (main._xrSession) return false;
    const picking = main.getPicking();
    // includeRig: a joint or a pin is a thing you select, and this tool is the least dangerous
    // place in the app to select one — it cannot pose anything by accident.
    const hit = picking.intersectionMouseMeshes(
      main.getMeshes(), main._mouseX, main._mouseY, false, true) ? picking.getMesh() : null;
    if (this._repeatPress(hit)) return false;
    // keepTool, because a SELECT tool that switches you off itself is not a select tool.
    // setOrUnsetMesh does tool-context switching on every selection change (it is what puts you
    // in the Voxel tool when you click a voxel object), and landing somewhere else the moment
    // you pick something is exactly the surprise this tool exists to avoid.
    main.setOrUnsetMesh(hit, hit ? !!(ctrl || main.multiSelectHeld?.()) : false, true);
    main.render();
    return false;   // never a stroke: nothing to drag, nothing to end, nothing to undo
  }

  updateXR(picking, isPressed, origin, dir, options) {
    const main = this._main;
    const controllers = (options && options.controllers) || [];
    if (!controllers.length) return;

    // Preselection from BOTH rays, so each hand shows what it would take. Same helper Grab's
    // hover branch uses, so the rig highlight and the mesh outline behave identically in the
    // two tools rather than being two implementations of the same promise.
    const rays = controllers.map((c) => {
      const r = Skeleton.controllerRay(c);
      return r && { handedness: c.handedness, ...r };
    }).filter(Boolean);
    if (rays.length) Skeleton.hoverRigFromRays(main, picking, rays, options && options.handedness);

    // THE HAND THAT PRESSED, on the edge. Scene dispatches once per input source, so this runs
    // with `handedness` set to whichever controller is being serviced — either hand can select.
    const hand = options && options.handedness;
    const me = controllers.find((c) => c.handedness === hand) || controllers[0];
    const down = !!(me && me.buttons && me.buttons[0] && me.buttons[0].pressed);
    const was = !!this._vrTriggerWas[me && me.handedness];
    this._vrTriggerWas[me && me.handedness] = down;
    if (!down || was) return;

    // BUTTON-ONLY CONTROLLERS HAVE NO POSE. While the ray is on a menu, Scene takes its
    // menu-guard path and hands the tools `{handedness, buttons}` with no matrix — deliberately,
    // so face buttons keep working while pointing at a panel. That press belongs to the menu,
    // and selecting whatever happens to be behind it is not what it meant.
    if (!me || !me.matrix) return;

    // ...and any OTHER hand holding its trigger is the multi-select modifier.
    const multi = controllers.some((c) => c !== me && c.buttons && c.buttons[0] && c.buttons[0].pressed);

    // THE TIP, not the pivot. `origin` is the controller's own origin; the tip is a stylus-length
    // in front of it and is what you are actually aiming with — picking from the pivot is why
    // reaching for a small target used to feel offset by the length of the controller.
    const tip = (options && options.tipOrigin) || origin;
    if (!tip || !dir) return;
    const targets = main.getMeshes().filter((m) => m.isVisible() && !m._isVoxelChunk);
    const hit = picking.intersectionRayMeshes(targets, tip, dir, true) ? picking.getMesh() : null;

    // A MISS IN VR CHANGES NOTHING, and this is where it differs from the desktop click above.
    //
    // On a flat screen a click on empty space is a deliberate, visible gesture and clearing the
    // selection is what it means. In a headset the controller is pointing somewhere most of the
    // time, a stray trigger pull is ordinary, and wiping a multi-selection you spent a minute
    // building is a far worse outcome than not having the verb — which the outliner's own
    // blank-space click provides anyway.
    if (!hit) return;
    main.setOrUnsetMesh(hit, multi, true);   // keepTool — see the desktop path above
    main.render();
  }
}

export default SelectTool;
