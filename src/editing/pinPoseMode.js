import getOptionsURL from '../misc/getOptionsURL.js';

// POSE MODE (was "Pin Pose"; the option keeps its old name): a mode of the desktop Transform tool
// for posing a rig directly.
//
// While it is on, Transform stops being "select an object, then transform it". The gizmo follows
// the cursor: hover the nearest pin, joint or animated prop, and the gizmo is on it and ready to
// drag -- no click to select first. The skinned body is never selectable (see fkPick.js). The
// handles offered are the ones the thing can actually do: a position pin translates, a rotation
// pin rotates, a full pin does both, a free joint rotates in its hinge frame, a joint the pins
// control moves (an IK drag, pins holding), and a prop gets the full gizmo.
//
// A leaf module, read by the Transform tool, the pick (Picking) and the panel, so none of them
// has to import the others. Live value first, saved value second, like every Transform option.
export function pinPoseOn() {
  return window._xfPinPose != null ? !!window._xfPinPose : !!getOptionsURL().xfPinPose;
}
