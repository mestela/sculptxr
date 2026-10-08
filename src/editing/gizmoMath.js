import { vec3, mat4 } from 'gl-matrix';

// THE DESKTOP GIZMO'S FRAME, AS ONE THING.
//
// The desktop gizmo used to be drawn in one frame and dragged in another: the handles took their
// orientation from the mesh's LOCAL matrix, while the edit matrices were built about a
// translate-only frame, i.e. the WORLD axes. For an unrotated top-level mesh the two agree,
// which is why it went unnoticed. For anything rotated, or anything with a parent -- every
// joint and pin in a rig -- the ring you grabbed turned some other axis, and which way it
// turned depended on the camera. These are the pieces that make the displayed frame and the
// dragged frame the same object.

// The rotation part of a model-space matrix, orthonormalised. Gram-Schmidt on the columns, so a
// scaled or slightly sheared parent chain still yields a clean frame (dividing each column by
// its length, as the display used to, leaves a shear in).
export function gizmoBasis(m, out) {
  out = out || mat4.create();
  const x = vec3.fromValues(m[0], m[1], m[2]);
  const y = vec3.fromValues(m[4], m[5], m[6]);
  if (vec3.length(x) < 1e-9) vec3.set(x, 1, 0, 0);
  vec3.normalize(x, x);
  // y made perpendicular to x, then z = x cross y: always right-handed, even for a mirrored
  // matrix (a mirrored joint has det < 0, and a left-handed frame would flip every rotation).
  vec3.scaleAndAdd(y, y, x, -vec3.dot(x, y));
  if (vec3.length(y) < 1e-9) {
    // x is degenerate with y: pick any perpendicular.
    vec3.set(y, 0, 1, 0);
    vec3.scaleAndAdd(y, y, x, -vec3.dot(x, y));
    if (vec3.length(y) < 1e-6) { vec3.set(y, 0, 0, 1); vec3.scaleAndAdd(y, y, x, -vec3.dot(x, y)); }
  }
  vec3.normalize(y, y);
  const z = vec3.cross(vec3.create(), x, y);
  mat4.identity(out);
  out[0] = x[0]; out[1] = x[1]; out[2] = x[2];
  out[4] = y[0]; out[5] = y[1]; out[6] = y[2];
  out[8] = z[0]; out[9] = z[1]; out[10] = z[2];
  return out;
}

// Axis n (0,1,2) of a basis, as a unit vector in the space the basis lives in.
export function basisAxis(B, n, out) {
  out = out || vec3.create();
  return vec3.set(out, B[n * 4], B[n * 4 + 1], B[n * 4 + 2]);
}

// WHICH WAY A DRAG ON A RING TURNS IT. The grabbed point P goes round the axis through c; its
// instantaneous direction is axis x (P - c) for a positive (right-handed) rotation. Projecting
// that to the screen gives the direction the cursor must travel to carry the point with it, so
// the sign is decided by the geometry of the point you grabbed and not by a per-axis constant --
// which is what made X/Y/Z feel opposite in different views.
export function ringTangent(axisW, P, c, out) {
  out = out || vec3.create();
  const r = vec3.sub(vec3.create(), P, c);
  vec3.scaleAndAdd(r, r, axisW, -vec3.dot(axisW, r));   // onto the ring's plane
  vec3.cross(out, axisW, r);
  const l = vec3.length(out);
  if (l < 1e-9) return vec3.set(out, 0, 0, 0);
  return vec3.scale(out, out, 1 / l);
}

// A rotation by `angle` about an arbitrary axis, as an edit matrix about the origin.
export function rotationEdit(axisW, angle, out) {
  out = out || mat4.create();
  mat4.identity(out);
  return mat4.rotate(out, out, angle, axisW);
}

// A scale along the basis axes: B S B^-1.
export function scaleEdit(B, s, out) {
  out = out || mat4.create();
  const Bi = mat4.invert(mat4.create(), B);
  mat4.identity(out);
  mat4.scale(out, out, s);
  mat4.mul(out, out, Bi);
  return mat4.mul(out, B, out);
}

// Closest point on the axis line (through the origin, direction a, unit) to the mouse ray
// (point `near`, unit direction `vec`) -- the parameter along the axis. Same algebra the
// translate drag always used, with the axis made a free vector instead of one of x, y, z.
export function axisParamFromRay(near, vec, a) {
  const a01 = -vec3.dot(vec, a);
  const b0 = vec3.dot(near, vec);
  const det = Math.max(1e-9, Math.abs(1.0 - a01 * a01));
  const b1 = -vec3.dot(near, a);
  return (a01 * b0 - b1) / det;
}
