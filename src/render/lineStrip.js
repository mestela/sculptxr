// LINE STRIPS AS SEGMENT PAIRS.
//
// WebGPURenderer cannot draw THREE.Line. It rejects LineLoop outright with a message, and
// LINE_STRIP it accepts and then fails on: bisecting the scene object by object inside a live
// session named `top` -- one of the three arcs of the VR cursor ring, a non-indexed
// THREE.Line of 33 points -- as the first object whose draw starts the
//   GL_INVALID_OPERATION: ... uniform buffer that is too small
// flood, followed by GL_INVALID_FRAMEBUFFER_OPERATION. Both errors were always on drawArrays,
// which is what a non-indexed line draws with, and that is the detail that went unexplained
// for hours: the panels, the sculpt and the controller models were all downstream of a
// poisoned frame, not causes.
//
// LineSegments is fine -- the ground grid is one and has drawn correctly throughout -- so a
// strip becomes pairs: [p0,p1, p1,p2, p2,p3, ...]. Visually identical on both renderers, at
// the cost of doubling a few dozen vertices, so it is applied unconditionally rather than
// behind the flag. One code path is worth more than the vertices.
import * as THREE from 'three';

/**
 * Build a LineSegments-ready geometry from a strip of points.
 * @param {Array<THREE.Vector3>} points in strip order
 * @param {boolean} [close] repeat the first point at the end
 */
export function stripGeometry(points, close) {
  const pts = close && points.length ? points.concat([points[0]]) : points;
  const out = [];
  for (let i = 0; i + 1 < pts.length; i++) out.push(pts[i], pts[i + 1]);
  return new THREE.BufferGeometry().setFromPoints(out);
}

export default stripGeometry;
