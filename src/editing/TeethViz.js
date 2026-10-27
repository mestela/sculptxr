// THE TEETH HEELS ON SCREEN: what TeethCollide pushes the lips off, drawn while the Volumes display
// flag (the bone panel's Volumes button, `capsules`) and the jiggle are both on. One heel per jaw --
// its arch swept from the teeth's bottom to their top, with a wall's thickness so it reads as a
// solid. Each frame a heel takes its jaw's fit from the last push (`jaw.now`), so the lower one
// swings with the jaw.
//
// DRAWN LIKE THE BONE VOLUMES (Skeleton.tuneCapsuleBatches): the capsules' shading and checker
// (NodeMaterials.teethHeel), the Shaded toggle, the Cylinder Opacity slider (a heel is a swept tube,
// like the cylinders), and the same three passes -- a depth prepass so only the nearest wall blends,
// the colour pass, and the xray ghost faded by the skin's opacity -- with a fully solid heel drawn
// UNDER the skin and no ghost. Without node materials (the legacy renderer) it falls back to plain
// translucent ones.
import * as THREE from 'three';
import Skeleton from './Skeleton.js';
import NodeMaterials from '../render/nodes/NodeMaterials.js';
import { jiggle } from './Jiggle.js';
import { archRadius, ARCH_SAMPLES, ribbonStrip } from './TeethCollide.js';

const STEPS = 4;          // drawn columns per arch sample
const WALL = 0.15;        // the heel's drawn thickness, in jaw half-widths
const LEVELS = 8;         // drawn rows up the heel
const CHECKS = 3;         // checker cells up the heel's face (square along it)
const COLOURS = [0x66ccff, 0xffaa55, 0x8ce68c];   // upper, lower, lip ribbon -- NodeMaterials' HEEL_COLOURS
// Skeleton's capsule pass orders (GHOST_ORDER, PRE_ORDER, SOLID_ORDER, UNDER_*), so the heels sort
// with the volumes.
const GHOST_ORDER = 9995, PRE_ORDER = 9996, SOLID_ORDER = 9996.5, UNDER_PRE_ORDER = -10, UNDER_SOLID_ORDER = -9.5;

const built = new WeakMap();   // jaw -> { pre, solid, ghost }

function heelGeometry(jaw) {
  const { cx, cz, a0, da, y0, y1, r } = jaw, n = (ARCH_SAMPLES - 1) * STEPS + 1, w = WALL * r;
  const cell = (y1 - y0) / CHECKS || 1;
  // A closed section per column: the outer face bottom to top (it leans and tapers with the teeth),
  // then the inner face top to bottom, WALL in from it.
  const levels = [];
  for (let k = 0; k <= LEVELS; k++) levels.push(y0 + (y1 - y0) * k / LEVELS);
  const ring = levels.length * 2, pos = [], uvs = [], idx = [];
  let along = 0, prev = null;
  for (let c = 0; c < n; c++) {
    const b = c / STEPS, a = a0 + b * da, sa = Math.sin(a), ca = Math.cos(a);
    const out = levels.map((y) => [archRadius(jaw, b, y), y]);
    const sec = [...out, ...out.slice().reverse().map(([rad, y]) => [rad - w, y])];
    // u: arc length along the face's middle; v: distance round the section.
    const mid = out[LEVELS >> 1], px = cx + mid[0] * sa, pz = cz + mid[0] * ca;
    if (prev) along += Math.hypot(px - prev[0], pz - prev[1]);
    prev = [px, pz];
    let round = 0, last = null;
    for (const [rad, y] of sec) {
      const p = [cx + rad * sa, y, cz + rad * ca];
      if (last) round += Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]);
      last = p;
      pos.push(p[0], p[1], p[2]);
      uvs.push(along / cell, round / cell);
    }
  }
  for (let c = 0; c < n - 1; c++) for (let k = 0; k < ring; k++) {
    const a = c * ring + k, b = c * ring + (k + 1) % ring, d = a + ring, e = b + ring;
    idx.push(a, d, b, b, d, e);
  }
  for (const [c, flip] of [[0, true], [n - 1, false]]) for (let k = 1; k < ring - 1; k++) {   // end caps
    const o = c * ring;
    if (flip) idx.push(o, o + k + 1, o + k); else idx.push(o, o + k, o + k + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// THE LIP RIBBON: a strip through its stations, `ribbonStrip` front and back of each. Positions
// rewritten every frame (the ribbon is rebuilt from the lips each push); uv as the heels'.
function ribbonGeometry(n) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2 * 2), 2));
  const idx = [];
  for (let k = 0; k < n - 1; k++) { const a = k * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  g.setIndex(idx);
  return g;
}
function updateRibbon(g, lip) {
  const R = lip.now, n = R.length / 3, pos = g.attributes.position.array, uv = g.attributes.uv.array;
  const { depth } = ribbonStrip(lip), cell = depth;
  let along = 0;
  for (let k = 0; k < n; k++) {
    const x = R[k * 3], y = R[k * 3 + 1], z = R[k * 3 + 2];
    if (k) along += Math.hypot(x - R[k * 3 - 3], y - R[k * 3 - 2]);
    pos.set([x, y, z - depth, x, y, z + depth], k * 6);
    uv.set([along / cell, 0, along / cell, 2], k * 4);
  }
  g.attributes.position.needsUpdate = true;
  g.attributes.uv.needsUpdate = true;
  g.computeVertexNormals();
}

function make(jaw, j, g = heelGeometry(jaw)) {
  const node = NodeMaterials.isActive && NodeMaterials.isActive();
  const mat = (pass) => (node && NodeMaterials.teethHeel({ jaw: j, pass })) || new THREE.MeshBasicMaterial({
    color: COLOURS[j % COLOURS.length], side: pass === 'ghost' ? THREE.FrontSide : THREE.DoubleSide,
    transparent: true, depthTest: true, depthWrite: pass === 'pre', colorWrite: pass !== 'pre',
    ...(pass === 'ghost' ? { depthFunc: THREE.GreaterDepth } : {}),
  });
  const p = { pre: new THREE.Mesh(g, mat('pre')), solid: new THREE.Mesh(g, mat('solid')), ghost: new THREE.Mesh(g, mat('ghost')) };
  for (const o of Object.values(p)) { o.matrixAutoUpdate = false; o.frustumCulled = false; o.isPickable = false; }
  return p;
}

// The volumes' opacity rules (tuneCapsuleBatches), for heel materials shared by both jaws: solid at
// the slider's value, the ghost at it times what the skin lets through, a fully solid heel under
// the skin with its own depth and no ghost.
function tune(main, parts) {
  const base = Skeleton.shaftOpacity(), solid = base >= 0.999, shaded = Skeleton.displayFlag('capsuleShaded');
  let meshOp = 0;
  for (const ms of (main.getMeshes ? main.getMeshes() : [])) {
    if (ms._isLight || ms._isBone || ms._isNull || !ms.getOpacity) continue;
    if (ms.isVisible && !ms.isVisible()) continue;
    meshOp = Math.max(meshOp, ms.getOpacity() ?? 1);
  }
  for (const p of parts) {
    p.solid.material.opacity = solid ? 1 : base;
    p.solid.material.blending = solid ? THREE.NoBlending : THREE.NormalBlending;
    p.ghost.material.opacity = base * (1 - meshOp);
    for (const m of [p.solid.material, p.ghost.material]) if (m.userData.shadeMix) m.userData.shadeMix.value = shaded ? 1 : 0;
    p.ghost.visible = !solid && p.ghost.material.opacity >= 0.004;
    p.solid.visible = p.pre.visible = base > 0;
    p.pre.renderOrder = solid ? UNDER_PRE_ORDER : PRE_ORDER;
    p.solid.renderOrder = solid ? UNDER_SOLID_ORDER : SOLID_ORDER;
    p.ghost.renderOrder = GHOST_ORDER;
  }
}

const M = new THREE.Matrix4();

// Every frame from Scene.applyRender, after the jiggle. Nothing to do while nothing shows.
export function tickTeethViz(main) {
  const reg = window._animationRegistry;
  const show = jiggle.on && Skeleton.displayFlag('capsules');
  for (const mesh of main.getMeshes ? main.getMeshes() : []) {
    const tm = mesh.getThreeMesh && mesh.getThreeMesh();
    if (!tm) continue;
    const state = show && reg && reg.tracks.get(mesh.getID())?._teeth?.state;
    let group = tm.userData.teethViz;
    if (!state) { if (group) group.visible = false; continue; }
    if (!group || group.userData.state !== state) {
      // Geometry is ours to free; node materials are the shared, pre-built set.
      if (group) { tm.remove(group); group.traverse((o) => { o.geometry?.dispose(); if (o.material && !o.material.userData?.nodeShared) o.material.dispose(); }); }
      group = new THREE.Group();
      group.userData.state = state;
      state.jaws.forEach((jaw, j) => {
        const p = make(jaw, j);
        built.set(jaw, p);
        group.add(p.pre, p.solid, p.ghost);
      });
      if (state.lip) {
        const p = make(null, 2, ribbonGeometry(state.lip.now.length / 3));
        built.set(state.lip, p);
        group.add(p.pre, p.solid, p.ghost);
      }
      tm.add(group);
      tm.userData.teethViz = group;
    }
    group.visible = true;
    const parts = state.jaws.map((jaw) => built.get(jaw));
    if (state.lip) {
      const p = built.get(state.lip);
      updateRibbon(p.solid.geometry, state.lip);
      for (const o of [p.pre, p.solid, p.ghost]) o.matrix.identity();
      parts.push(p);
    }
    tune(main, parts);
    // Each heel where its jaw is now: p -> A (q - mr) + mc (identity before the first push).
    for (const jaw of state.jaws) {
      const p = built.get(jaw), f = jaw.now;
      if (f) {
        const { A, mr, mc } = f;
        const tx = mc[0] - (A[0] * mr[0] + A[1] * mr[1] + A[2] * mr[2]);
        const ty = mc[1] - (A[3] * mr[0] + A[4] * mr[1] + A[5] * mr[2]);
        const tz = mc[2] - (A[6] * mr[0] + A[7] * mr[1] + A[8] * mr[2]);
        M.set(A[0], A[1], A[2], tx, A[3], A[4], A[5], ty, A[6], A[7], A[8], tz, 0, 0, 0, 1);
      } else M.identity();
      for (const o of [p.pre, p.solid, p.ghost]) o.matrix.copy(M);
    }
  }
}
