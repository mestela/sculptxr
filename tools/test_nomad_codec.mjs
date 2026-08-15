// Exercises NomadCodec against a real mesh_full captured from Nomad on an iPad.
//   node tools/test_nomad_codec.mjs <capture.json> <capture.bin>
import fs from 'node:fs';
import NomadCodec from '../src/link/NomadCodec.js';

const [, , jsonPath, binPath] = process.argv;
if (!jsonPath || !binPath) {
  console.error('usage: node tools/test_nomad_codec.mjs <capture.json> <capture.bin>');
  process.exit(2);
}

const header = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const file = fs.readFileSync(binPath);
const binary = new Uint8Array(file.buffer, file.byteOffset, file.byteLength);

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const t0 = Date.now();
const mesh = NomadCodec.decodeMesh(header, binary);
const ms = Date.now() - t0;

console.log(`decoded "${mesh.name}" in ${ms} ms — ${mesh.nbVertices} verts, ${mesh.nbFaces} faces\n`);

// ---- sizes ----
check('vertex array length', mesh.vertices.length === mesh.nbVertices * 3);
check('face array length', mesh.faces.length === mesh.nbFaces * 4);
check('binary fully accounted for', header.binary_size === file.byteLength,
  `header says ${header.binary_size}, file is ${file.byteLength}`);

// ---- positions: every component finite, and the bounding box is plausible ----
let minV = Infinity, maxV = -Infinity, nonFinite = 0;
for (const value of mesh.vertices) {
  if (!Number.isFinite(value)) nonFinite++;
  if (value < minV) minV = value;
  if (value > maxV) maxV = value;
}
check('all positions finite', nonFinite === 0, `${nonFinite} bad`);
check('bounding box non-degenerate', maxV > minV,
  `${minV.toFixed(4)} .. ${maxV.toFixed(4)}`);

// ---- faces: indices in range, triangles flagged with TRI_INDEX ----
let quads = 0, tris = 0, outOfRange = 0;
for (let f = 0; f < mesh.nbFaces; ++f) {
  const k = f * 4;
  const d = mesh.faces[k + 3];
  if (d === NomadCodec.TRI_INDEX) tris++; else quads++;
  for (let c = 0; c < 4; ++c) {
    const idx = mesh.faces[k + c];
    if (idx === NomadCodec.TRI_INDEX) continue;
    if (idx >= mesh.nbVertices) outOfRange++;
  }
}
check('face indices in range', outOfRange === 0, `${outOfRange} out of range`);
check('quads survived as quads', quads > 0, `${quads} quads, ${tris} tris`);

// ---- every vertex referenced at least once (a real closed mesh) ----
const used = new Uint8Array(mesh.nbVertices);
for (let i = 0; i < mesh.faces.length; ++i) {
  const idx = mesh.faces[i];
  if (idx !== NomadCodec.TRI_INDEX) used[idx] = 1;
}
let orphans = 0;
for (const u of used) if (!u) orphans++;
check('no orphan vertices', orphans === 0, `${orphans} unreferenced`);

// ---- colours / materials in range ----
if (mesh.colors) {
  let bad = 0;
  for (const c of mesh.colors) if (!(c >= 0 && c <= 1)) bad++;
  check('colours within 0..1', bad === 0, `${bad} outside`);
}
if (mesh.materials) {
  let bad = 0, maskedVerts = 0;
  for (let i = 0; i < mesh.nbVertices; ++i) {
    const j = i * 3;
    for (let c = 0; c < 3; ++c) if (!(mesh.materials[j + c] >= 0 && mesh.materials[j + c] <= 1)) bad++;
    if (mesh.materials[j + 2] < 0.999) maskedVerts++;
  }
  check('materials within 0..1', bad === 0, `${bad} outside`);
  // An unmasked Nomad mesh must arrive fully EDITABLE. Nomad and SculptXR agree
  // that 1 = unmasked, so a plain sculpt should show zero masked vertices here;
  // if this trips, the mask channel got inverted somewhere.
  check('unmasked sculpt arrives unmasked', maskedVerts === 0,
    `${maskedVerts} of ${mesh.nbVertices} verts masked`);
}

// ---- UVs ----
if (mesh.texCoords) {
  check('uv pool sized from header', mesh.texCoords.length === header.texcoord_count * 2);
  let uvOutOfRange = 0;
  if (mesh.faceUvs) {
    for (const idx of mesh.faceUvs) {
      if (idx === NomadCodec.TRI_INDEX) continue;
      if (idx >= header.texcoord_count) uvOutOfRange++;
    }
    check('uv face indices in range', uvOutOfRange === 0, `${uvOutOfRange} out of range`);
    check('uv face array matches face count', mesh.faceUvs.length === mesh.nbFaces * 4);
  }
}

// ---- face groups ----
if (mesh.faceGroups) {
  const seen = new Set(mesh.faceGroups);
  const declared = mesh.faceGroupDefs ? mesh.faceGroupDefs.length : 0;
  check('face group array matches face count', mesh.faceGroups.length === mesh.nbFaces);
  check('face group ids are declared', Math.max(...seen) <= Math.max(declared, 1),
    `ids ${[...seen].join(',')} vs ${declared} declared group(s): ${(mesh.faceGroupDefs || []).map((g) => g.name).join(', ')}`);
}

// ---- winding flip must be an exact reversal, not a reshuffle ----
const flipped = NomadCodec.decodeMesh(header, binary, true);
let flipOk = true;
for (let f = 0; f < Math.min(mesh.nbFaces, 1000); ++f) {
  const k = f * 4;
  const isQuad = mesh.faces[k + 3] !== NomadCodec.TRI_INDEX;
  if (isQuad) {
    if (flipped.faces[k] !== mesh.faces[k + 3] || flipped.faces[k + 3] !== mesh.faces[k]) flipOk = false;
  } else if (flipped.faces[k] !== mesh.faces[k + 2] || flipped.faces[k + 2] !== mesh.faces[k]) flipOk = false;
}
check('winding flip reverses corner order', flipOk);

// ---- encode round trip: decoded -> mesh_full -> decoded again ----
// A stand-in for a SculptXR mesh, exposing just what the encoder reads.
const fakeMesh = {
  getNbVertices: () => mesh.nbVertices,
  getNbFaces: () => mesh.nbFaces,
  getVertices: () => mesh.vertices,
  getFaces: () => mesh.faces,
  getColors: () => mesh.colors,
  getMaterials: () => mesh.materials,
  getFacesGroups: () => mesh.faceGroups,
  hasUV: () => !!(mesh.texCoords && mesh.faceUvs),
  getTexCoords: () => mesh.texCoords,
  getFacesTexCoord: () => mesh.faceUvs,
  getNbTexCoords: () => (mesh.texCoords ? mesh.texCoords.length / 2 : 0)
};

const packet = NomadCodec.encodeMesh(fakeMesh, {
  meshId: mesh.meshId,
  geometryId: mesh.geometryId,
  name: mesh.name,
  worldMatrix: mesh.worldMatrix,
  faceGroupDefs: mesh.faceGroupDefs
});
const again = NomadCodec.decodeMesh(packet.header, packet.binary);

console.log(`\nround trip: re-encoded to ${packet.binary.length} bytes (Nomad sent ${file.byteLength})`);
check('round trip: header binary_size matches payload', packet.header.binary_size === packet.binary.length);
check('round trip: vertex count', again.nbVertices === mesh.nbVertices);
check('round trip: face count', again.nbFaces === mesh.nbFaces);

let posDrift = 0;
for (let i = 0; i < mesh.vertices.length; ++i)
  posDrift = Math.max(posDrift, Math.abs(again.vertices[i] - mesh.vertices[i]));
check('round trip: positions exact', posDrift === 0, `max drift ${posDrift}`);

let faceDiff = 0;
for (let i = 0; i < mesh.faces.length; ++i)
  if (again.faces[i] !== mesh.faces[i]) faceDiff++;
check('round trip: faces identical (quads stay quads)', faceDiff === 0, `${faceDiff} differ`);

if (mesh.faceGroups) {
  let groupDiff = 0;
  for (let i = 0; i < mesh.faceGroups.length; ++i)
    if (again.faceGroups[i] !== mesh.faceGroups[i]) groupDiff++;
  check('round trip: face groups identical', groupDiff === 0, `${groupDiff} differ`);
}

if (mesh.texCoords) {
  let uvDrift = 0;
  for (let i = 0; i < mesh.texCoords.length; ++i)
    uvDrift = Math.max(uvDrift, Math.abs(again.texCoords[i] - mesh.texCoords[i]));
  check('round trip: uvs exact', uvDrift === 0, `max drift ${uvDrift}`);
}

if (mesh.materials) {
  // uint8 roughness/metalness cannot survive exactly; a quantisation step is 1/255.
  let matDrift = 0;
  for (let i = 0; i < mesh.materials.length; ++i)
    matDrift = Math.max(matDrift, Math.abs(again.materials[i] - mesh.materials[i]));
  check('round trip: materials within quantisation', matDrift <= 1 / 255,
    `max drift ${matDrift.toFixed(5)}`);
}

if (mesh.colors) {
  let colDrift = 0;
  for (let i = 0; i < mesh.colors.length; ++i)
    colDrift = Math.max(colDrift, Math.abs(again.colors[i] - mesh.colors[i]));
  check('round trip: colours within rgbm8 quantisation', colDrift <= 1 / 255,
    `max drift ${colDrift.toFixed(5)}`);
}

console.log(`\n${failures ? `${failures} FAILED` : 'all checks passed'}`);
process.exit(failures ? 1 : 0);
