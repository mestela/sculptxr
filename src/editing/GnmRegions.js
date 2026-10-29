// GNM REGIONS: GNM's own face regions (lips, mouth bag, eye sockets, brows, cheeks...) coloured
// over a GNM-derived head, so a resculpt can be checked against the landmarks the shapes were
// made for. matt: "eg the lip corners haven't relaxed and drifted inside the mouth bag or out onto
// the cheek". The regions are per VERTEX, so a colour that has slid somewhere else on the face is
// the landmark having slid with it.
//
// An overlay child sharing the mesh's own position and index buffers, like the Face tool's
// heatmap: it follows sculpting, blendshapes and the skin for free, and only its colours are its
// own (fixed: the regions are topology, not shape). ADDITIVE, so skin in no region is untouched.
//
// Only for meshes with GNM's topology (EyeCollide.knownLids). Global, not per tool: it is for
// sculpting the Base, so it stays on through brush changes.
import * as THREE from 'three';
import { knownLids } from './EyeCollide.js';
import { triangles, components, similarity } from './ShapeRetarget.js';
import { GNM_REGION_COLOURS, GNM_REGION_CODES, GNM_REGION_NAMES } from './gnmRegionData.js';
import { GNM_LIDS } from './gnmLids.js';

export const regions = { show: false };

const GAIN = 0.2;             // additive strength of a region's colour (0.45 read as paint; matt: "a bit too prominent")
let codes = null;             // per skin vertex region index, 255 = none
const gnm = new WeakMap();    // mesh -> { key, ok }

export function isGnm(mesh) {
  const nv = mesh.getNbVertices(), key = nv + '|' + mesh.getNbFaces();
  let hit = gnm.get(mesh);
  if (!hit || hit.key !== key) {
    hit = { key, ok: !!knownLids(triangles(mesh.getFaces(), mesh.getNbFaces()), nv) };
    gnm.set(mesh, hit);
  }
  return hit.ok;
}

// Per skin vertex region index (gnmRegionData.js), 255 = none. Shared with Jiggle.js.
export function regionCodes() {
  if (!codes) codes = Uint8Array.from(atob(GNM_REGION_CODES), (ch) => ch.charCodeAt(0));
  return codes;
}

// THE LIP SEAM: the upper/lower lip vertex pairs that touch on the neutral `ref`, flat [u, l, ...].
// "Touching" = within 0.3% of the head's height (0.15 on GNM's 48.5-tall head).
export function lipSeam(ref) {
  regionCodes();
  const up = GNM_REGION_NAMES.indexOf('upper_lip'), lo = GNM_REGION_NAMES.indexOf('lower_lip'), nv = ref.length / 3;
  let ylo = Infinity, yhi = -Infinity;
  for (let i = 1; i < ref.length; i += 3) { ylo = Math.min(ylo, ref[i]); yhi = Math.max(yhi, ref[i]); }
  const near = 0.003 * (yhi - ylo), U = [], L = [], pairs = [];
  for (let v = 0; v < Math.min(nv, codes.length); v++) { if (codes[v] === up) U.push(v); else if (codes[v] === lo) L.push(v); }
  for (const u of U) {
    let best = near, bl = -1;
    for (const l of L) { const d = Math.hypot(ref[u * 3] - ref[l * 3], ref[u * 3 + 1] - ref[l * 3 + 1], ref[u * 3 + 2] - ref[l * 3 + 2]); if (d < best) { best = d; bl = l; } }
    if (bl >= 0) pairs.push(u, bl);
  }
  return pairs;
}

// THE EYELIDS: both sockets and `rings` rings of skin round them, as vertex indices. `nb` is
// TopoWrap.neighbours. Snap and Un-pose both keep this region in GNM's own shape.
export function lidRegion(nb, rings) {
  const lids = new Set(GNM_LIDS.flatMap((l) => l.socket));
  let front = [...lids];
  for (let r = 0; r < rings; r++) {
    const next = [];
    for (const u of front) for (let j = nb.start[u]; j < nb.start[u + 1]; j++) { const w = nb.list[j]; if (!lids.has(w)) { lids.add(w); next.push(w); } }
    front = next;
  }
  return [...lids];
}

// TEETH NO BIGGER THAN THEIR MOUTH BAG (Retarget Shapes, after fitParts). fitParts sizes each jaw
// by the skin round it, mostly the lips; a sculpt with a wide mouth on an ordinary jaw -- matt's
// spork: lips 1.24x GNM's, bag 1.14x -- made the teeth 1.15-1.17x, and they came through the bag
// at the back and the chin on a full smile (10 vertices, GNM none). So a jaw's scale is capped at
// the bag's, about its own centre; a roomier bag leaves it alone. Spork smile: 10 -> 1. Upper jaw =
// the pieces no shape moves, near the bag; lower = the ones jawOpen moves (teeth and tongue).
// Returns a new array, or null when nothing needed shrinking.
export function teethToBag(ref, P, tris, nv, shapes) {
  regionCodes();
  const jaw = shapes.get('jawOpen'), sock = GNM_REGION_NAMES.indexOf('mouth_sock');
  if (!jaw) return null;
  const bag = [];
  for (let v = 0; v < Math.min(nv, codes.length); v++) if (codes[v] === sock) bag.push(v);
  if (bag.length < 3) return null;
  const bagScale = similarity(ref, P, bag).s;
  const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const v of bag) for (let k = 0; k < 3; k++) { box[k] = Math.min(box[k], ref[v * 3 + k]); box[k + 3] = Math.max(box[k + 3], ref[v * 3 + k]); }
  const moves = (d, v) => d && (d[v * 3] !== 0 || d[v * 3 + 1] !== 0 || d[v * 3 + 2] !== 0);
  const all = [...shapes.values()], upper = [], lower = [];
  for (const c of components(tris, nv).slice(1)) {
    if (moves(jaw, c[0])) { lower.push(...c); continue; }
    if (all.some((d) => moves(d, c[0]))) continue;   // eyes, anything else a shape moves
    let cx = 0, cy = 0, cz = 0;
    for (const v of c) { cx += ref[v * 3]; cy += ref[v * 3 + 1]; cz += ref[v * 3 + 2]; }
    cx /= c.length; cy /= c.length; cz /= c.length;
    if (cx >= box[0] && cx <= box[3] && cy >= box[1] && cy <= box[4] && cz >= box[2] && cz <= box[5]) upper.push(...c);
  }
  const out = Float32Array.from(P);
  let changed = false;
  for (const part of [upper, lower]) {
    if (part.length < 3) continue;
    const k = bagScale / similarity(ref, out, part).s;
    if (k >= 1) continue;
    const c = [0, 0, 0];
    for (const v of part) for (let i = 0; i < 3; i++) c[i] += out[v * 3 + i] / part.length;
    for (const v of part) for (let i = 0; i < 3; i++) out[v * 3 + i] = c[i] + k * (out[v * 3 + i] - c[i]);
    changed = true;
  }
  return changed ? out : null;
}

function colours(count) {
  regionCodes();
  const col = new Float32Array(count * 3);   // black = adds nothing
  for (let v = 0; v < Math.min(count, codes.length); v++) {
    const c = GNM_REGION_COLOURS[codes[v]];
    if (c) for (let k = 0; k < 3; k++) col[v * 3 + k] = c[k] * GAIN;
  }
  return col;
}

// Every frame from Scene.applyRender. Nothing to do while off and nothing is showing.
export function tickRegions(main) {
  for (const mesh of main.getMeshes ? main.getMeshes() : []) {
    const tm = mesh.getThreeMesh && mesh.getThreeMesh();
    if (!tm) continue;
    let ov = tm.userData.gnmRegions;
    if (!regions.show || !isGnm(mesh)) { if (ov) ov.visible = false; continue; }
    const g = tm.geometry;
    if (!g.index) continue;   // draw-arrays layouts do not share vertices with the mesh data
    if (!ov) {
      ov = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({
        vertexColors: true, transparent: true, blending: THREE.AdditiveBlending,
        depthTest: true, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
      }));
      ov.frustumCulled = false;
      ov.renderOrder = 0.5;   // as the face-group overlay: over the skin, under the wireframe
      tm.add(ov);
      tm.userData.gnmRegions = ov;
    }
    const og = ov.geometry, pos = g.attributes.position;
    if (og.attributes.position !== pos || og.index !== g.index) {
      og.setAttribute('position', pos);
      og.setIndex(g.index);
      if (!og.attributes.color || og.attributes.color.count !== pos.count) og.setAttribute('color', new THREE.BufferAttribute(colours(pos.count), 3));
    }
    og.setDrawRange(g.drawRange.start, g.drawRange.count);
    ov.visible = true;
  }
}
