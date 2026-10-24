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
import { triangles } from './ShapeRetarget.js';
import { GNM_REGION_COLOURS, GNM_REGION_CODES } from './gnmRegionData.js';

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
