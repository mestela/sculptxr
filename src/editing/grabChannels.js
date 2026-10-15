import getOptionsURL from '../misc/getOptionsURL.js';

// WHICH HALF OF A GRAB IS APPLIED — translation, rotation, or both.
//
// A 6DOF grab always produces both, because a hand cannot move without also turning a little.
// That is fine on a pin, where you want the whole gesture, and it is exactly wrong on a JOINT of
// an unpinned chain: any translation at all makes the joint an IK effector and starts the solver
// off, so there is no way to simply turn a bone. matt: "because grab does both position and
// rotation, it starts the ik solver solving."
//
// Same shape and the same wrist-panel dialect as Move's Path Move / Path Rotate, because it is
// the same question asked of a different tool, and answering it two different ways would be
// worse than either answer.
//
// With translation off, a grabbed joint stops being an effector: nothing asks the solve for a
// new position, and the rotation is a plain FK turn. That is the cheapest way to reach the FK
// case, and the reason it exists before any of #59's deeper tiers.
const GrabChannels = {};

GrabChannels.channels = function () {
  const opts = getOptionsURL();
  const t = window._grabTranslate != null ? !!window._grabTranslate
    : (opts.grabTranslate == null ? true : !!opts.grabTranslate);
  const r = window._grabRotate != null ? !!window._grabRotate
    : (opts.grabRotate == null ? true : !!opts.grabRotate);
  // BOTH OFF IS NOT A STATE. A grab that does nothing looks exactly like a broken grab, and
  // there is no feedback that would tell you which it was — so the last one turned off wins and
  // the other comes back on, the same rule the path channels use.
  if (!t && !r) return { translate: true, rotate: true };
  return { translate: t, rotate: r };
};

GrabChannels.setChannel = function (which, on) {
  const cur = GrabChannels.channels();
  const next = { translate: cur.translate, rotate: cur.rotate };
  next[which] = !!on;
  if (!next.translate && !next.rotate) {
    // Turning off the last one turns the other back on rather than leaving a dead tool.
    next[which === 'translate' ? 'rotate' : 'translate'] = true;
  }
  window._grabTranslate = next.translate;
  window._grabRotate = next.rotate;
  getOptionsURL.saveOption?.('grabTranslate', next.translate, 0);
  getOptionsURL.saveOption?.('grabRotate', next.rotate, 0);
  return next;
};

// AUTO: the per-target rule that replaces swapping Translate on and off while posing (matt,
// 2026-10-09: "pins behave in their best mode. bones default to rotate. if alt trigger is pressed,
// it goes into IK mode").
//
//   a PIN         -> the whole 6DOF gesture, always ('pin')
//   a BONE/JOINT  -> a plain FK turn by default ('fk'), and an IK effector drag while the
//                    OFF-HAND trigger is held as the gesture starts, or where FK is impossible --
//                    a joint the pins own is rewritten by the solver, so a turn would be thrown
//                    away ('ik')
//
// On by default. With Auto off the Translate / Rotate switches above apply to everything, as
// they always did.
GrabChannels.auto = function () {
  if (window._grabAuto != null) return !!window._grabAuto;
  const opts = getOptionsURL();
  return opts.grabAuto == null ? true : !!opts.grabAuto;
};

GrabChannels.setAuto = function (on) {
  window._grabAuto = !!on;
  getOptionsURL.saveOption?.('grabAuto', !!on, 0);
  return !!on;
};

// The channels for one gesture of `kind` ('pin' | 'fk' | 'ik'). With Auto off the switches rule.
GrabChannels.forGesture = function (kind) {
  if (!GrabChannels.auto()) return GrabChannels.channels();
  if (kind === 'fk') return { translate: false, rotate: true };
  return { translate: true, rotate: true };   // 'pin' and 'ik': the whole gesture
};

export default GrabChannels;
