// TOPO TRANSFER, steps 1-2: put GNM's topology (and with it its shapes, eyes, teeth, tongue and
// mouth bag) onto someone else's head sculpt. The artist's sculpt is the TARGET: any mesh, any
// topology, used only as a surface. The SOURCE is the GNM head in the scene.
//
// 1. LANDMARKS: GNM_LANDMARKS are fixed GNM vertices; for each, the user clicks where it is on the
//    target (Face tool, Pick on). THE TARGET IS TAKEN AS SYMMETRIC across its own X = 0 (a Nomad
//    sculpt's symmetry plane; matt, 2026-10-26: assume symmetric characters for now). So only the
//    L and centreline landmarks are picked: an L pick also places its R partner, mirrored and
//    snapped to the surface, and a centreline pick is moved onto the plane. (An Auto-place that
//    guessed the rest from a few picks was removed: too prone to errors, too confusing.)
// 2. WRAP: similarity + thin-plate spline (TopoWrap.js) from GNM's landmarks to the picks, applied
//    to GNM's whole BASE. Its shapes are left as they were, and the Base before the wrap is kept as
//    `track.shapeRef` (unless one is already there), so Retarget Shapes rebuilds them for the new
//    face -- and refits the eyes, teeth and tongue -- the same as after any Base sculpt.
//
// Picks are stored in the TARGET's local space, so moving the target after picking is harmless;
// they are carried into GNM's space only when wrapping.
//
// WHILE PICKING (matt's first-pass notes): every placement is its own undo step; GNM shows its
// wireframe so the vertex a landmark names is unmistakable; the two heads usually overlap (the
// closer they are, the easier the correspondence is to read), so Tab / the Show button cycles
// Both -> Target only -> GNM only, and the dots stay on screen whichever mesh is hidden -- all of
// GNM's landmarks too, since where GNM's sits is the best guess at where the target's goes.
import * as THREE from 'three';
import { mat4, vec3 } from 'gl-matrix';
import { GNM_LANDMARKS } from './gnmLandmarks.js';
import { fitWarp, warpAll, closestPoint, buildGrid, snapSurface, neighbours, relaxRegion } from './TopoWrap.js';
import { triangles } from './ShapeRetarget.js';
import { isGnm, regionCodes } from './GnmRegions.js';
import { GNM_REGION_NAMES } from './gnmRegionData.js';

export const topo = { pick: false, cur: 0, targetId: null, picks: new Map(), view: 'both', lines: false, dots: true };   // picks: key -> { p }

// The R half of each pair is never picked: it follows its L partner (see the header).
export const isMirrored = (lm) => !!lm.mirror && lm.key.endsWith('R');
const nextToPick = (from) => {
  for (let k = 1; k <= GNM_LANDMARKS.length; k++) {
    const i = (from + k) % GNM_LANDMARKS.length;
    if (!isMirrored(GNM_LANDMARKS[i]) && !topo.picks.has(GNM_LANDMARKS[i].key)) return i;
  }
  return from;
};

const MIN_PICKS = 4;
const say = (msg, colour) => { console.log('[Topo] ' + msg); window.screenLog?.(msg, colour); };
const repaint = () => window._refreshTopo?.();
const reg = () => window._animationRegistry;
const byId = (main, id) => (id == null ? null : main.getMeshes().find((m) => m.getID() === id) || null);

export const meshLabel = (m) => (m ? m._permanentStaticLabel || 'Object ' + m.getID() : 'none');   // the outliner's name

export function targetMesh(main) { return byId(main, topo.targetId); }

// The GNM head to wrap: a GNM-topology mesh with shapes, other than the target.
export function sourceMesh(main) {
  const t = targetMesh(main);
  return main.getMeshes().find((m) => m !== t && isGnm(m) && reg()?.tracks.get(m.getID())?.baseShape) || null;
}

export function setTarget(main) {
  const m = main.getMesh();
  if (!m) return say('Select the sculpt to wrap onto first', 'yellow');
  setPick(main, false);
  setView(main, 'both');
  topo.targetId = m.getID();
  if (!sourceMesh(main)) { topo.targetId = null; return say('No GNM head in the scene besides the selection: load one first', 'yellow'); }
  topo.picks.clear();
  topo.cur = 0;
  setPick(main, true);
  say(`Wrapping ${meshLabel(sourceMesh(main))} onto ${meshLabel(m)}: click ${GNM_LANDMARKS[0].label} on it`);
}

// PICK MODE, and GNM's wireframe with it (put back as it was when picking ends).
let _wireWas = null;
export function setPick(main, on) {
  const s = sourceMesh(main);
  if (on && s && _wireWas === null) { _wireWas = { mesh: s, on: !!s.getShowWireframe() }; s.setShowWireframe(true); }
  if (!on && _wireWas) { _wireWas.mesh.setShowWireframe(_wireWas.on); _wireWas = null; }
  topo.pick = !!on && !!targetMesh(main);
  refreshMarkers(main);
  repaint();
}

// SHOW: both heads, the target only, or GNM only. Hides through the mesh's own visibility, so the
// outliner and the renderer agree; 'both' puts them back.
const VIEWS = ['both', 'target', 'source'];
export const VIEW_LABEL = { both: 'Both', target: 'Target only', source: 'GNM only' };
export function setView(main, view) {
  const s = sourceMesh(main), t = targetMesh(main);
  topo.view = view;
  // Both the flag and the three object, as the outliner's eye does: the flag alone draws nothing different.
  for (const [m, on] of [[s, view !== 'target'], [t, view !== 'source']]) {
    if (!m) continue;
    m.setVisible(on);
    const tm = m.getThreeMesh?.();
    if (tm) tm.visible = on;
  }
  refreshMarkers(main);
  repaint();
}
export function cycleView(main) {
  setView(main, VIEWS[(VIEWS.indexOf(topo.view) + 1) % VIEWS.length]);
  say('Showing ' + VIEW_LABEL[topo.view].toLowerCase() + ' (Tab)');
}

// EVERY CHANGE TO THE PICKS IS AN UNDO STEP: the picks and the current landmark, before and after.
const snapshot = () => ({ picks: new Map([...topo.picks].map(([k, q]) => [k, { p: q.p.slice() }])), cur: topo.cur });
function record(main, label, change) {
  const before = snapshot();
  if (change() === false) return;
  const after = snapshot();
  const put = (st) => { topo.picks = new Map(st.picks); topo.cur = st.cur; refreshMarkers(main); repaint(); };
  put(after);
  main.getStateManager?.()?.pushStateCustom(() => put(before), () => put(after), false, label);
}

export function clear(main) {
  record(main, 'Clear Landmarks', () => { topo.picks.clear(); topo.cur = 0; });
}

// FILE > NEW. The dot groups hang off the meshes' PARENT (so they show while a mesh is hidden), so
// emptying the scene left them floating there, along with picks for a target that no longer exists.
export function resetTopo(main) {
  for (const g of _groups) g.parent?.remove(g);
  _groups.clear();
  drawLines(main, null, null);
  Object.assign(topo, { pick: false, cur: 0, targetId: null, picks: new Map() });
  repaint();
}

export function select(main, i) {
  topo.cur = isMirrored(GNM_LANDMARKS[i]) ? GNM_LANDMARKS.findIndex((l) => l.key === GNM_LANDMARKS[i].mirror) : i;
  setPick(main, true);
}

// The target's triangles (cached by vertex/face count) and current vertices.
let _tris = null;
function surface(t) {
  const key = t.getID() + '|' + t.getNbVertices() + '|' + t.getNbFaces();
  if (!_tris || _tris.key !== key) _tris = { key, tris: triangles(t.getFaces(), t.getNbFaces()) };
  return { tris: _tris.tris, verts: t.getVertices() };
}
function snap(t, p) {
  const s = surface(t);
  return closestPoint(s.tris, s.verts, p);
}

// From `a`'s local space to `b`'s.
function between(a, b) {
  const m = mat4.create();
  mat4.invert(m, b.getMatrix());
  return mat4.multiply(m, m, a.getMatrix());
}

// A click on the target with Pick on (FacePuppet.start). True when it placed a landmark.
// `origin`/`dir` (world) is a controller ray; without them it is the mouse.
export function pickAt(main, origin = null, dir = null) {
  const t = targetMesh(main);
  if (!t || !topo.pick) return false;
  // A hidden target is still pickable, and a click "on GNM" would land on it unseen behind.
  if (!t.isVisible()) { say('The target is hidden: Tab to show it', 'yellow'); return false; }
  const picking = main.getPicking();
  const hit = origin ? picking.intersectionRayMeshes([t], origin, dir)
                     : picking.intersectionMouseMesh(t, main._mouseX, main._mouseY);
  if (!hit) return false;
  const p = Array.from(picking.getIntersectionPoint());
  const lm = GNM_LANDMARKS[topo.cur];
  record(main, 'Place ' + lm.label, () => {
    if (lm.mirror) {
      topo.picks.set(lm.key, { p });
      topo.picks.set(lm.mirror, { p: snap(t, [-p[0], p[1], p[2]]) });   // re-picking L moves R too
    } else {
      topo.picks.set(lm.key, { p: snap(t, [0, p[1], p[2]]) });            // onto the centreline
    }
    topo.cur = nextToPick(topo.cur);
  });
  return true;
}

// Source landmark positions (GNM rest shape) and target picks, both in `space`'s local frame.
function pairs(main, space) {
  const s = sourceMesh(main), t = targetMesh(main);
  const base = reg().tracks.get(s.getID()).baseShape;
  const toSpaceS = between(s, space), toSpaceT = between(t, space);
  const src = [], dst = [], v = vec3.create();
  for (const lm of GNM_LANDMARKS) {
    const q = topo.picks.get(lm.key);
    if (!q) continue;
    vec3.transformMat4(v, base.subarray(lm.v * 3, lm.v * 3 + 3), toSpaceS); src.push(v[0], v[1], v[2]);
    vec3.transformMat4(v, q.p, toSpaceT); dst.push(v[0], v[1], v[2]);
  }
  return { src: Float64Array.from(src), dst: Float64Array.from(dst) };
}

// Bend GNM's Base onto the target. One undo step.
export function wrap(main) {
  const s = sourceMesh(main), t = targetMesh(main);
  if (!s || !t) return say('Set a target first', 'yellow');
  if (topo.picks.size < MIN_PICKS) return say(`Place at least ${MIN_PICKS} landmarks first`, 'yellow');
  const track = reg().tracks.get(s.getID());
  let warp;
  const { src, dst } = pairs(main, s);
  try { warp = fitWarp(src, dst); } catch (e) { return say(e.message, 'yellow'); }
  const before = { base: track.baseShape.slice(), ref: track.shapeRef };
  const after = { base: warpAll(warp, track.baseShape), ref: track.shapeRef || before.base };
  const put = (st) => {
    track.baseShape.set(st.base);
    track.shapeRef = st.ref;
    track._bsRev = (track._bsRev | 0) + 1;
    reg().applyBlendshapes(s);
    refreshMarkers(main);
    main.render();
  };
  put(after);
  main.getStateManager?.()?.pushStateCustom(() => put(before), () => put(after), false, 'Topo Wrap');
  setPick(main, false);
  setView(main, 'both');
  say(`Wrapped onto ${topo.picks.size} landmarks (scale ${warp.sim.s.toFixed(3)}). Retarget Shapes next, to rebuild the shapes for the new face`);
}

// STEP 3: SNAP GNM's skin onto the target's surface (TopoWrap.snapSurface), after Wrap has put it
// roughly in place. The landmark wrap only bends space smoothly between ~30 points; a head far
// from GNM's proportions needs the surface itself. Skin only, minus the mouth bag and the eye
// sockets (they follow the skin round them); eyes, teeth and tongue stay where Wrap left them for
// Retarget Shapes to reseat. One undo step, and the pre-snap Base is kept the same way as Wrap's.
let _grid = null;
export function snapToSurface(main) {
  const s = sourceMesh(main), t = targetMesh(main);
  if (!s || !t) return say('Set a target first', 'yellow');
  const track = reg().tracks.get(s.getID()), base = track.baseShape, nv = base.length / 3;
  const t0 = performance.now();
  const gkey = t.getID() + '|' + t.getNbVertices() + '|' + t.getNbFaces();
  if (!_grid || _grid.key !== gkey) { const sf = surface(t); _grid = { key: gkey, g: buildGrid(sf.tris, Float32Array.from(sf.verts.subarray(0, t.getNbVertices() * 3))) }; }
  const codes = regionCodes(), skip = new Set(['mouth_sock', 'eye_sockets'].map((n) => GNM_REGION_NAMES.indexOf(n)));
  const include = new Uint8Array(nv);
  for (let i = 0; i < Math.min(nv, codes.length); i++) include[i] = skip.has(codes[i]) ? 0 : 1;
  const tris = triangles(s.getFaces(), s.getNbFaces());
  // Into the target's space and back.
  const toT = between(s, t), toS = between(t, s), v = vec3.create();
  const inT = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) { vec3.transformMat4(v, base.subarray(i * 3, i * 3 + 3), toT); inT.set(v, i * 3); }
  const nb = neighbours(tris, nv);
  let out = snapSurface(inT, tris, nb, include, _grid.g, { maxDist: radiusOf(t) * 0.3 });
  // LIPS KEEP GNM'S SHAPE (matt: "the lips often get a bit tangled"). The snap pulls neighbouring
  // lip rows toward different parts of a sculpt's fused lips and folds them; the lips and mouth
  // bag are re-solved to their pre-snap local shape, seated in the snapped skin round them.
  // Measured on a caricatured Lunk: lip triangles folded 7 of 464 -> 0, lip error 0.84 -> 0.92.
  // (A first try fitted GNM's identity basis before snapping instead: on a caricature 60
  // components cannot reach the proportions, and the lips came out worse, 17-41 folded.)
  const lipCodes = new Set(['upper_lip', 'lower_lip', 'mouth_sock'].map((n) => GNM_REGION_NAMES.indexOf(n)));
  const lips = [];
  for (let i = 0; i < Math.min(nv, codes.length); i++) if (lipCodes.has(codes[i])) lips.push(i);
  out = relaxRegion(out, inT, nb, lips, 100);
  const after = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) { vec3.transformMat4(v, out.subarray(i * 3, i * 3 + 3), toS); after.set(v, i * 3); }
  const before = { base: base.slice(), ref: track.shapeRef };
  const st1 = { base: after, ref: track.shapeRef || before.base };
  const put = (st) => {
    track.baseShape.set(st.base);
    track.shapeRef = st.ref;
    track._bsRev = (track._bsRev | 0) + 1;
    reg().applyBlendshapes(s);
    refreshMarkers(main);
    main.render();
  };
  put(st1);
  main.getStateManager?.()?.pushStateCustom(() => put(before), () => put(st1), false, 'Snap to Surface');
  setPick(main, false);
  say(`Snapped GNM's skin onto ${meshLabel(t)} in ${(performance.now() - t0).toFixed(0)} ms. Retarget Shapes next`);
}

// ── Markers ──────────────────────────────────────────────────────────────────────────────────
// COLOUR SAYS WHICH HEAD, SATURATION SAYS HOW FAR ALONG (matt): GNM's dots blue, the target's
// yellow; full saturation = placed, low = not done yet (GNM only: the target has no dot until
// there is a pick). The current landmark is cyan on both. GNM's
// dots at half the target's opacity, since all 30 are always up. SIBLINGS of each mesh's three
// object, carrying its matrix, so they stay up when the mesh is hidden; drawn over everything,
// small (a quarter of the first size, which covered most of an eye).
//
// LINES (button): a dashed line from each GNM landmark to its pick on the target, so a mis-click
// -- a skewed wrap with no obvious culprit -- shows up as the one line that crosses the others.

const _hsl = (h, sat, l) => new THREE.Color().setHSL(h, sat, l).getHex();
const BLUE = 0.6, YELLOW = 0.14;
const COL = {
  srcManual: _hsl(BLUE, 1, 0.55), srcNone: _hsl(BLUE, 0.12, 0.55),
  tgtManual: _hsl(YELLOW, 1, 0.55),
  current: 0x00e5ff,
};
const OPACITY = { srcManual: 0.45, srcNone: 0.45, tgtManual: 0.9, current: 1 };
const SIZE = 0.003;   // dot radius, as a fraction of the mesh's extent
let _geo = null;
const _mats = {};
function mat(kind) {
  return _mats[kind] || (_mats[kind] = new THREE.MeshBasicMaterial({ color: COL[kind], depthTest: false, depthWrite: false, transparent: true, opacity: OPACITY[kind] }));
}
function radiusOf(m) {
  const v = m.getVertices(), n = m.getNbVertices();
  let r = 0;
  for (let i = 0; i < n * 3; i += 3) r = Math.max(r, Math.abs(v[i]), Math.abs(v[i + 1]), Math.abs(v[i + 2]));
  return r || 1;
}
function group(m) {
  const tm = m.getThreeMesh && m.getThreeMesh();
  if (!tm || !tm.parent) return null;
  let g = tm.userData.topoMarks;
  if (!g) {
    g = new THREE.Group();
    g.name = 'topo_marks';
    g.matrixAutoUpdate = false;
    tm.userData.topoMarks = g;
  }
  if (g.parent !== tm.parent) tm.parent.add(g);
  g.userData.tm = tm;
  g.matrix.copy(tm.matrix);   // and kept in step by tickTopo, since a mesh can move while picking
  return g;
}
// The unit normal of the vertex of `m` nearest `p` (for a target dot; GNM's dots sit on vertices).
function normalNear(m, p) {
  const v = m.getVertices(), nr = m.getNormals(), n = m.getNbVertices();
  let best = Infinity, bi = 0;
  for (let i = 0; i < n; i++) {
    const d = (v[i * 3] - p[0]) ** 2 + (v[i * 3 + 1] - p[1]) ** 2 + (v[i * 3 + 2] - p[2]) ** 2;
    if (d < best) { best = d; bi = i; }
  }
  return [nr[bi * 3], nr[bi * 3 + 1], nr[bi * 3 + 2]];
}

const _groups = new Set();   // marker groups with dots, for tickTopo
function fill(g, dots, size) {
  if (!g) return;
  if (dots.length) _groups.add(g); else _groups.delete(g);
  if (!_geo) _geo = new THREE.SphereGeometry(1, 12, 8);
  while (g.children.length > dots.length) g.remove(g.children[g.children.length - 1]);
  dots.forEach((d, i) => {
    let o = g.children[i];
    if (!o) { o = new THREE.Mesh(_geo, mat('tgtManual')); o.renderOrder = 999; g.add(o); }
    o.material = mat(d.kind);
    o.renderOrder = d.kind === 'current' ? 1000 : 999;
    o.position.set(d.p[0], d.p[1], d.p[2]);
    o.scale.setScalar(size * (d.big ? 1.8 : 1));
    o.userData.n = d.big ? null : d.n;   // the current landmark shows from any side
  });
}

// FAR-SIDE DOTS HIDE (matt: looking at the face, a dot from the back of the head only confuses).
// They are drawn over everything, so depth cannot do it; a dot whose surface faces away from the
// camera is hidden instead. Once a frame from Scene.applyRender, a few dozen dot products.
const BACK = -0.6;   // cosine below which a dot counts as facing away (~127 deg)
const _inv = new THREE.Matrix4(), _cam = new THREE.Vector3();
export function tickTopo(main) {
  if (!_groups.size) return;
  const cam = main.getCamera?.()?.getThreeCamera?.();
  if (!cam) return;
  let moved = false;
  for (const g of _groups) {
    if (!g.parent) continue;
    const tm = g.userData.tm;
    if (tm && !g.matrix.equals(tm.matrix)) { g.matrix.copy(tm.matrix); moved = true; }
    g.updateMatrixWorld(true);
    _cam.setFromMatrixPosition(cam.matrixWorld).applyMatrix4(_inv.copy(g.matrixWorld).invert());
    for (const o of g.children) {
      const n = o.userData.n;
      if (!n) { o.visible = true; continue; }
      // Hidden only when it clearly faces away: a lid edge curls in toward the eye and a nostril
      // wing or ear faces sideways, and those still read from the front.
      const dx = _cam.x - o.position.x, dy = _cam.y - o.position.y, dz = _cam.z - o.position.z;
      o.visible = n[0] * dx + n[1] * dy + n[2] * dz > BACK * Math.hypot(dx, dy, dz);
    }
  }
  if (moved && topo.lines) drawLines(main, sourceMesh(main), targetMesh(main));
}

// Dashed lines, GNM landmark -> its pick, in the source's parent space (the target may hang off a
// different parent, so its end comes through world space). Built as short LineSegments: a dashed
// material is one more node material to trust in XR, and plain segments already work there.
let _lines = null;
const _w = new THREE.Vector3(), _toS = new THREE.Matrix4();
function drawLines(main, s, t) {
  if (_lines) { _lines.parent?.remove(_lines); _lines.geometry.dispose(); _lines = null; }
  if (!topo.lines || !s || !t || !topo.picks.size) return;
  const ts = s.getThreeMesh?.(), tt = t.getThreeMesh?.();
  if (!ts?.parent || !tt) return;
  ts.updateMatrixWorld(true); tt.updateMatrixWorld(true);
  ts.updateMatrix();
  _toS.copy(ts.parent.matrixWorld).invert().multiply(tt.matrixWorld);
  const b = reg().tracks.get(s.getID()).baseShape;
  const dash = radiusOf(s) * ts.matrix.getMaxScaleOnAxis() * 0.012;
  const pos = [], col = [], cur = GNM_LANDMARKS[topo.cur].key;
  const c = new THREE.Color();
  for (const lm of GNM_LANDMARKS) {
    const q = topo.picks.get(lm.key);
    if (!q) continue;
    const a = _w.set(b[lm.v * 3], b[lm.v * 3 + 1], b[lm.v * 3 + 2]).applyMatrix4(ts.matrix).clone();
    const e = new THREE.Vector3(q.p[0], q.p[1], q.p[2]).applyMatrix4(_toS);
    c.setHex(lm.key === cur && topo.pick ? COL.current : 0xffffff);
    const len = a.distanceTo(e), n = Math.max(1, Math.floor(len / (2 * dash)));
    for (let i = 0; i < n; i++) {
      const u0 = (2 * i) / (2 * n), u1 = (2 * i + 1) / (2 * n);
      for (const u of [u0, u1]) { pos.push(a.x + (e.x - a.x) * u, a.y + (e.y - a.y) * u, a.z + (e.z - a.z) * u); col.push(c.r, c.g, c.b); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  _lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, depthWrite: false, transparent: true, opacity: 0.8 }));
  _lines.name = 'topo_lines';
  _lines.renderOrder = 998;
  _lines.frustumCulled = false;
  ts.parent.add(_lines);
}

// DOTS off hides every landmark dot on both heads, to see the surfaces clean; picking still works
// and the lines (if on) still show which landmark goes where.
export function setDots(main, on) {
  topo.dots = !!on;
  refreshMarkers(main);
  repaint();
}

export function setLines(main, on) {
  topo.lines = !!on;
  refreshMarkers(main);
  repaint();
}

export function refreshMarkers(main) {
  for (const m of main.getMeshes()) {
    const g = m.getThreeMesh?.()?.userData.topoMarks;
    if (g) fill(g, [], 1);
  }
  const t = targetMesh(main), s = sourceMesh(main);
  if (!t) { drawLines(main, null, null); return main.render(); }
  if (!topo.dots) { drawLines(main, s, t); return main.render(); }
  const cur = GNM_LANDMARKS[topo.cur].key;
  const dots = [...topo.picks].map(([k, q]) => ({ p: q.p, n: q.n || (q.n = normalNear(t, q.p)), kind: k === cur && topo.pick ? 'current' : 'tgtManual', big: k === cur && topo.pick }));
  fill(group(t), dots, radiusOf(t) * SIZE);
  if (s && topo.pick) {
    const b = reg().tracks.get(s.getID()).baseShape, nr = s.getNormals();
    const state = (k) => (topo.picks.has(k) ? 'srcManual' : 'srcNone');
    fill(group(s), GNM_LANDMARKS.map((lm) => ({ p: b.subarray(lm.v * 3, lm.v * 3 + 3), n: nr.subarray(lm.v * 3, lm.v * 3 + 3), kind: lm.key === cur ? 'current' : state(lm.key), big: lm.key === cur })), radiusOf(s) * SIZE);
  }
  drawLines(main, s, t);
  main.render();
}
