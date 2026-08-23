import Enums from '../misc/Enums.js';
import IKSolver from './IKSolver.js';
import Skeleton from './Skeleton.js';

// THE SECONDARY ACTION — the flat-screen equivalent of the VR A button.
//
// In VR, A is a UNIVERSAL modifier: it works from Grab, from TransformVR and from Bone Draw,
// and it means "do the other thing to whatever is under the pointer". Flat screens had no such
// channel, so the one binding that needed it — cycling an IK pin — was re-homed as a tap inside
// Bone Draw's IK mode, and Grab and Transform simply could not pin at all on desktop or iPad.
//
// That is this project's signature bug getting started: one rule, two implementations, one gap.
// So this is deliberately NOT a pin button. It is the missing input channel, and pinning is the
// first thing to use it. The next face-button binding gets a home here instead of inventing
// another bespoke gesture.
//
// ONE ARMED SHOT, AND NO TIMING ANYWHERE. Tap the modifier, it lights, the next click does the
// secondary action, it disarms. Hold-to-modify cannot work with a single pointer (you cannot
// hold an on-screen button AND click a joint with one mouse or one pencil), and long-press was
// rejected outright: it misfires, it is slow, and the misfire is silent. A latch may follow as
// a plain SECOND tap if using it proves that bulk pinning is common — but not on a guess.

const SecondaryAction = {};

// Prefer what the app already knows is under the pointer: in VR that is the hover highlight
// maintained per frame from the controller tip. A flat screen has no such highlight outside
// Bone Draw, so fall back to picking at click time.
//
// The pick clobbers the shared picking state, which per the preselection war story is fatal
// when done every frame on hover. It is safe here because this runs ONCE on a click that is
// then consumed — no sculpt starts, so nothing downstream reads the stale pick.
function pickJoint(main) {
  const picking = main.getPicking && main.getPicking();
  if (!picking) return null;
  if (!picking.intersectionMouseMeshes(main.getMeshes(), main._mouseX, main._mouseY, false, true))
    return null;
  const m = picking.getMesh();
  if (!m) return null;
  // A pin counts as its joint, exactly as the A-button path treats it: pins sit on the joint
  // they hold and win the pick, so reading only the bone would make a pinned joint unpinnable.
  if (m._isPinTarget) return m._pinnedJoint || null;
  return m._isBone ? m : null;
}

const PIN = {
  label: 'Pin',
  run(main) {
    const joint = Skeleton.hoveredJoint(main) || pickJoint(main);
    // togglePin CYCLES: unpinned -> position -> position + rotation. One press is one step,
    // which is the same thing the A button does, because it is the same call.
    return joint ? IKSolver.togglePin(main, joint) : false;
  },
};

// Which tools have a secondary action. Kept as one table rather than a method on each tool:
// the tools that would carry it are Grab and the transforms, which are the most fragile input
// code in the app, and a table needs no edit to any of them.
const BY_TOOL = {
  [Enums.Tools.GRAB]: PIN,
  [Enums.Tools.TRANSFORM]: PIN,
  [Enums.Tools.TRANSFORM_VR]: PIN,
  [Enums.Tools.BONE_DRAW]: PIN,
};

// The active tool's secondary action, or null when it has none — which is also what tells the
// on-screen button whether to show itself at all.
SecondaryAction.of = function (main) {
  const sm = main && main.getSculptManager && main.getSculptManager();
  const idx = sm && sm.getToolIndex && sm.getToolIndex();
  return (idx != null && BY_TOOL[idx]) || null;
};

SecondaryAction.label = function (main) {
  const a = SecondaryAction.of(main);
  return a ? a.label : null;
};

SecondaryAction.armed = function (main) {
  return !!(main && main._secondaryArmed && SecondaryAction.of(main));
};

SecondaryAction.disarm = function (main) {
  if (!main || !main._secondaryArmed) return false;
  main._secondaryArmed = false;
  return true;
};

// The flag is raw; `armed` is the question everyone actually asks, and it is the ONE place that
// knows a modifier is meaningless without an action behind it. Guarding it here as well looked
// safer and was untestable: with both guards in place, removing either one changed nothing
// observable, so neither could be shown to matter.
SecondaryAction.toggle = function (main) {
  if (!main) return false;
  main._secondaryArmed = !main._secondaryArmed;
  return SecondaryAction.armed(main);
};

// Fire it. Disarms either way: a click that found nothing has still been spent, and leaving the
// modifier armed after a miss is how you get a mystery pin three clicks later.
SecondaryAction.fire = function (main) {
  const a = SecondaryAction.of(main);
  SecondaryAction.disarm(main);
  return a ? !!a.run(main) : false;
};

export default SecondaryAction;
