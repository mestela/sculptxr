import getOptionsURL from '../misc/getOptionsURL.js';

// PIN POSE: a mode of the desktop Transform tool for posing a rig directly.
//
// While it is on, Transform stops being "select an object, then transform it". The gizmo follows
// the cursor: hover the nearest pin, or a free (FK) joint, and the gizmo is on it and ready to
// drag -- no click to select first. Nothing else is selectable in the mode: not the skinned body,
// and not a joint the pins already control (see fkPick.js). The handles offered are the ones the
// thing can actually do: a position pin translates, a rotation pin rotates, a full pin does both,
// and a free joint rotates, in its hinge frame.
//
// A leaf module, read by the Transform tool, the pick (Picking) and the panel, so none of them
// has to import the others. Live value first, saved value second, like every Transform option.
export function pinPoseOn() {
  return window._xfPinPose != null ? !!window._xfPinPose : !!getOptionsURL().xfPinPose;
}
