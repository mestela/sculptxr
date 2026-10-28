// NOMAD TEXTURES. A .nom keeps its images as encoded PNGs in the data block, listed in a top-level
// `images` array ({offset (data-block relative), length, type}), and a material points at them
// through `textures.{color, roughness, metalness, normal}.index`. Reverse-engineered from
// "alien_gnm tex.nom" (2026-10-28): four 1024 PNGs, the normal one 16-bit.
//
// UV ORIGIN IS TOP LEFT, as glTF's (measured: the neck's bottom row sits at v=0.96 and at the
// bottom of the colour image), so every map is flipY=false like ImportGLTF's.
//
// Nomad keeps roughness and metalness as two images; the app samples glTF's packed map (roughness
// in GREEN, metalness in BLUE), so they are merged on a canvas here. Both are LINEAR, used as
// stored. (Linearising them as sRGB was tried, on the grounds that the baked mesh's vertex
// roughness of 0.25 matched srgbToLinear(136/255); but 0.25 (u8 64) is simply Nomad's untouched
// default on every mesh of every sample file, so it said nothing about the bake, and the result
// was far shinier than Nomad. matt: "this loads very shiny compared to nomad".)
//
// A BAKE REPLACES THE PAINT. Nomad bakes the vertex colour into the colour map and resets the
// paint to white, while glTF (and this app) multiply the map onto the vertex colour -- so a bake
// on a mesh that still carries the paint came out twice as dark. Maps from a bake carry
// `replacesPaint`, and the shader then ignores the vertex colour under them.
//
// Also: loading a split-off bake onto the face group it came from (applyBakeToGroups).

import * as THREE from 'three';
import NomFile from './NomFile.js';

const NomTextures = {};

function imageBytes(nom, idx) {
  const im = nom.scene.images && nom.scene.images[idx];
  if (!im) return null;
  const start = nom.dataOffset + im.offset;
  return { bytes: new Uint8Array(nom.bytes.subarray(start, start + im.length)), mime: im.type || 'image/png' };
}

function toTexture(src, image, srgb) {
  const tex = new THREE.Texture(image);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  if (src) tex._sxrSrc = src;     // a .sxr save is then a copy of Nomad's own bytes (see TextureIO)
  return tex;
}

const bitmap = (src) => createImageBitmap(new Blob([src.bytes], { type: src.mime }));

// The maps of material `mi`, as Mesh.setGroupMaterial takes them, or null when it has none.
NomTextures.loadMaterial = async function (nom, mi) {
  const mat = nom.scene.materials && nom.scene.materials[mi];
  const t = mat && mat.textures;
  if (!t || !nom.scene.images) return null;
  const out = {
    roughFactor: mat.factorRoughness ?? 1,
    metalFactor: mat.factorMetalness ?? 1,
    normalScale: mat.factorNormal ?? 1,
  };
  const colour = t.color && imageBytes(nom, t.color.index);
  if (colour) out.albedo = toTexture(colour, await bitmap(colour), true);
  const normal = t.normal && imageBytes(nom, t.normal.index);
  if (normal) {
    out.normal = toTexture(normal, await bitmap(normal), false);
    if (mat.normal_neg_y) console.warn('[nom] normal map is -Y (DirectX); drawn as +Y');
  }
  const rough = t.roughness && imageBytes(nom, t.roughness.index);
  const metal = t.metalness && imageBytes(nom, t.metalness.index);
  if (rough || metal) {
    const r = rough && await bitmap(rough), m = metal && await bitmap(metal);
    const w = (r || m).width, h = (r || m).height;
    const read = (bmp) => {
      if (!bmp) return null;
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const cx = cv.getContext('2d');
      cx.drawImage(bmp, 0, 0, w, h);
      return cx.getImageData(0, 0, w, h).data;
    };
    const rd = read(r), md = read(m);
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const cx = cv.getContext('2d');
    const img = cx.createImageData(w, h);
    // no texture for a channel = its factor alone (Nomad's scalar), so the sample is 1
    for (let i = 0; i < w * h * 4; i += 4) {
      img.data[i] = 0;
      img.data[i + 1] = rd ? rd[i] : 255;
      img.data[i + 2] = md ? md[i] : 255;
      img.data[i + 3] = 255;
    }
    cx.putImageData(img, 0, 0);
    if (!rough) out.roughFactor = mat.roughness ?? 1;
    if (!metal) out.metalFactor = mat.metalness ?? 0;
    out.roughMetal = toTexture(null, cv, false);
  }
  return out.albedo || out.normal || out.roughMetal ? out : null;
};

// Every textured mesh of an imported .nom gets its maps as the OBJECT's own. `meshes` are the
// added meshes (wrappers), each with its _nomSource. Async: images decode after the scene is in.
NomTextures.applyImported = async function (meshes) {
  let n = 0;
  for (const m of meshes) {
    const src = m._nomSource;
    if (!src || !m.hasUV || !m.hasUV()) continue;
    const def = src.file.scene.meshes[src.mesh];
    const maps = def && await NomTextures.loadMaterial(src.file, def.material);
    if (!maps) continue;
    if (maps.albedo) m.setAlbedoMap(maps.albedo);
    if (maps.roughMetal) m.setRoughMetalMap(maps.roughMetal, maps.roughFactor, maps.metalFactor);
    if (maps.normal) m.setNormalMap(maps.normal, maps.normalScale);
    n++;
  }
  return n;
};

function uvBox(uv, fuv, faces, nbFaces, keep) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (let f = 0; f < nbFaces; f++) {
    if (keep && !keep(f)) continue;
    const quad = faces[f * 4 + 3] >= 0 && faces[f * 4 + 3] !== 4294967295;
    for (let k = 0; k < (quad ? 4 : 3); k++) {
      const t = fuv[f * 4 + k] * 2;
      if (uv[t] < b[0]) b[0] = uv[t];
      if (uv[t + 1] < b[1]) b[1] = uv[t + 1];
      if (uv[t] > b[2]) b[2] = uv[t];
      if (uv[t + 1] > b[3]) b[3] = uv[t + 1];
    }
  }
  return b;
}

// A BAKE MADE ON A PIECE OF THIS MESH. Nomad bakes overlapping UV islands into each other, so a
// head with skin, teeth and eyes sharing UV space is split by island there and each piece baked
// alone. Each textured mesh in the .nom is matched to the face group of `target` with the same
// face count and the same UV bounds, and its maps become that group's material. A piece matching
// the whole mesh sets the object's own maps instead.
// Returns [{ name, group }] (group -1 = whole object, null = no match).
NomTextures.applyBakeToGroups = async function (target, buffer) {
  const nom = new NomFile(buffer);
  const report = [];
  const groups = target.getFacesGroups && target.getFacesGroups();
  const nbF = target.getNbFaces();
  const tUV = target.hasUV() ? target.getTexCoords() : null;
  const tFUV = tUV ? target.getFacesTexCoord() : null;
  const tF = target.getFaces();
  const counts = new Map();
  if (groups) for (let f = 0; f < nbF; f++) counts.set(groups[f], (counts.get(groups[f]) || 0) + 1);
  const names = new Map();
  const walk = (nodes) => { for (const n of nodes || []) { if (n.mesh !== undefined) names.set(n.mesh, n.name); walk(n.children); } };
  walk(nom.scene.scene);

  for (let i = 0; i < nom.scene.meshes.length; i++) {
    const def = nom.scene.meshes[i];
    const name = names.get(i) || 'Mesh ' + i;
    const mat = nom.scene.materials[def.material];
    if (!mat || !mat.textures || !def.uvs || !def.faces_uv) continue;
    const nf = def.count_face;
    const sBox = uvBox(nom.f32(def.uvs), nom.i32(def.faces_uv), nom.i32(def.faces), nf);
    const near = (b) => tUV && b.every((x, k) => Math.abs(x - sBox[k]) < 1e-3);
    let group = null;
    if (nf === nbF && near(uvBox(tUV, tFUV, tF, nbF))) group = -1;
    else for (const [g, c] of counts) {
      if (c !== nf) continue;
      if (near(uvBox(tUV, tFUV, tF, nbF, (f) => groups[f] === g))) { group = g; break; }
    }
    report.push({ name, group });
    if (group === null) continue;
    const maps = await NomTextures.loadMaterial(nom, def.material);
    if (!maps) continue;
    maps.replacesPaint = true;
    if (group === -1) {
      target._albedoReplacesPaint = true;
      if (maps.albedo) target.setAlbedoMap(maps.albedo);
      if (maps.roughMetal) target.setRoughMetalMap(maps.roughMetal, maps.roughFactor, maps.metalFactor);
      if (maps.normal) target.setNormalMap(maps.normal, maps.normalScale);
    } else {
      target.setGroupMaterial(group, maps);
    }
  }
  return report;
};

export default NomTextures;
