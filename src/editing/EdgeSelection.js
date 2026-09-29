import * as THREE from 'three';
import { buildAdjacency, isEdge, keyVerts, nearestFaceEdge } from './EdgeLoops.js';

// THE EDGE SELECTION, shared by the edge tools (Sel Loop fills it; Bevel will consume it).
//
// It lives on the mesh at the level being edited (getCurrentMesh), as a Set of edgeKeys --
// vertex pairs, so it outlives the edge renumbering every initTopology does. A key whose
// vertices are no longer joined (another tool split or removed the edge) is dropped the next
// time the selection is read, so a stale entry can never be acted on.
//
// Highlights are thin square tubes parented to the mesh's own three object, so they follow the
// mesh when it moves. Not THREE.Line: lines are one pixel in a headset and LINE_STRIP poisons
// the WebGPU frame (see reference_webgpu_meshbasic_broken).

const activeOf = (mesh) => (mesh && mesh.getCurrentMesh ? mesh.getCurrentMesh() : mesh);
const threeOf = (mesh) => {
  const m = activeOf(mesh);
  return m && (m.getThreeMesh() || (mesh.getThreeMesh && mesh.getThreeMesh()));
};

// Adjacency for HOVER only, rebuilt when the face array is replaced (every topology tool here
// sets a new one). The tools' own start() builds fresh, so a stale cache can only ever mislead
// the preview, never an edit.
export function hoverAdjacency(m) {
  const faces = m.getFaces(), nbFaces = m.getNbFaces();
  const c = m._edgeAdjCache;
  if (c && c.faces === faces && c.nbFaces === nbFaces) return c.adj;
  const adj = buildAdjacency(faces, nbFaces);
  m._edgeAdjCache = { faces, nbFaces, adj };
  return adj;
}

export function getEdgeSelection(mesh) {
  const m = activeOf(mesh);
  if (!m) return new Set();
  if (!m._edgeSel) m._edgeSel = new Set();
  const adj = buildAdjacency(m.getFaces(), m.getNbFaces());
  for (const k of m._edgeSel) {
    const [a, b] = keyVerts(k);
    if (!isEdge(adj, a, b)) m._edgeSel.delete(k);
  }
  return m._edgeSel;
}

const _overlays = {};

// One overlay per name: tubes along `segs` ([[p, q], ...], local-space THREE.Vector3 pairs).
function drawTubes(name, tm, segs, r, color, order) {
  const pos = new Float32Array(segs.length * 24 * 3); // 4 sides x 2 tris x 3 verts
  const d = new THREE.Vector3(), p = new THREE.Vector3(), q = new THREE.Vector3(), up = new THREE.Vector3();
  const c = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const w = new THREE.Vector3();
  let o = 0;
  const put = (base, off) => { w.copy(base).add(off); pos[o++] = w.x; pos[o++] = w.y; pos[o++] = w.z; };
  for (const [A, B] of segs) {
    d.subVectors(B, A).normalize();
    const flat = Math.abs(d.y) < 0.9;
    up.set(flat ? 0 : 1, flat ? 1 : 0, 0);
    p.crossVectors(d, up).normalize().multiplyScalar(r);
    q.crossVectors(d, p).normalize().multiplyScalar(r);
    c[0].copy(p); c[1].copy(q); c[2].copy(p).negate(); c[3].copy(q).negate();
    for (let i = 0; i < 4; ++i) {
      const s = c[i], t = c[(i + 1) % 4];
      put(A, s); put(B, s); put(B, t);
      put(A, s); put(B, t); put(A, t);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  let ov = _overlays[name];
  if (!ov) {
    ov = _overlays[name] = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color, side: THREE.DoubleSide,
      // Transparent for the PASS (every sculpt mesh is transparent, so an opaque overlay would
      // be drawn before them and painted over), NoBlending to decline the blend itself. Depth
      // is TESTED, so the back half of a loop round a cylinder stays hidden.
      transparent: true, blending: THREE.NoBlending, depthWrite: false,
    }));
    ov.renderOrder = order; // after meshes (0) and their wireframe (1)
    ov.isPickable = false;
    ov.raycast = () => {}; // intersectObject is recursive by default
  } else {
    ov.geometry.dispose();
    ov.geometry = geo;
  }
  if (ov.parent !== tm) tm.add(ov);
  ov.visible = true;
}

function hide(name) {
  if (_overlays[name]) _overlays[name].visible = false;
}

export const vtx = (v, i) => new THREE.Vector3(v[i * 3], v[i * 3 + 1], v[i * 3 + 2]);

// A vertex lifted off the surface along its normal. A tube centred ON an edge is half buried,
// and wherever the surface is flatter than the tube is thick it shows through in dashes.
export const lifted = (m, i, h) => {
  const v = m.getVertices(), n = m.getNormals();
  return new THREE.Vector3(v[i * 3] + n[i * 3] * h, v[i * 3 + 1] + n[i * 3 + 1] * h, v[i * 3 + 2] + n[i * 3 + 2] * h);
};

// Draw the selection of `mesh`, or hide the highlight when there is nothing to draw.
export function showEdgeSelection(mesh) {
  const m = activeOf(mesh);
  const sel = m ? getEdgeSelection(mesh) : null;
  const tm = threeOf(mesh);
  if (!sel || sel.size === 0 || !tm) { hideEdgeSelection(); return; }
  const v = m.getVertices();
  const pairs = [...sel].map(keyVerts);
  // Thickness follows the edges themselves, so it reads the same on a cube and a dense head.
  const r = (pairs.reduce((s, [a, b]) => s + vtx(v, a).distanceTo(vtx(v, b)), 0) / pairs.length) * 0.03;
  drawTubes('sel', tm, pairs.map(([a, b]) => [lifted(m, a, r), lifted(m, b, r)]), r, 0xff9e3b, 2);
}

export function hideEdgeSelection() {
  hide('sel');
}

// The edge a tap would act on right now: the picked face's edge nearest the hit, on the
// SELECTED mesh only -- the tools edit getMesh(), so hovering anything else must promise nothing.
export function pickEdge(main) {
  const picking = main.getPicking();
  const mesh = picking.getMesh();
  const f = picking.getPickedFace();
  if (!mesh || mesh !== main.getMesh() || f === undefined || f < 0) return null;
  const hit = picking.getIntersectionPoint();
  if (!hit) return null;
  const m = activeOf(mesh);
  const edge = nearestFaceEdge(m.getFaces(), m.getVertices(), f, hit);
  return edge && { mesh, m, edge };
}

// The PRESELECT: the edge a tap would use (brighter and fatter than the selection, drawn over
// it), plus optional `paths` -- [{ pts: [Vector3...], closed }], e.g. where Cut Loop would cut;
// callers lift path points off the surface themselves (see `lifted`).
export function showEdgeHover(mesh, edge, paths) {
  const m = activeOf(mesh);
  const tm = threeOf(mesh);
  if (!m || !tm || !edge) { hideEdgeHover(); return; }
  const v = m.getVertices();
  const len = vtx(v, edge[0]).distanceTo(vtx(v, edge[1]));
  const r = len * 0.045;
  drawTubes('hover', tm, [[lifted(m, edge[0], r), lifted(m, edge[1], r)]], r, 0xf9e2af, 3);
  const segs = [];
  for (const { pts, closed } of paths || []) {
    for (let i = 0; i + 1 < pts.length; ++i) segs.push([pts[i], pts[i + 1]]);
    if (closed && pts.length > 2) segs.push([pts[pts.length - 1], pts[0]]);
  }
  if (segs.length) drawTubes('path', tm, segs, len * 0.02, 0x89dceb, 3);
  else hide('path');
}

export function hideEdgeHover() {
  hide('hover');
  hide('path');
}
