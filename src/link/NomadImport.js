// Decoded Nomad mesh -> a SculptXR MeshStatic, ready for Scene.addImportedMeshes().

import MeshStatic from '../mesh/meshStatic/MeshStatic.js';

var NomadImport = {};

/**
 * Build a mesh from NomadCodec.decodeMesh() output.
 *
 * The link ids are stamped onto the mesh so a later send can replace the same
 * object in Nomad instead of adding a duplicate.
 */
NomadImport.buildMesh = function (decoded, gl) {
  var mesh = new MeshStatic(gl);

  mesh.setVertices(decoded.vertices);
  mesh.setFaces(decoded.faces);
  if (decoded.colors) mesh.setColors(decoded.colors);
  if (decoded.materials) mesh.setMaterials(decoded.materials);
  if (decoded.faceGroups) mesh.setFacesGroups(decoded.faceGroups);

  // UVs travel as a texcoord pool plus per-corner indices, the same pair the OBJ
  // importer feeds this method. No v flip: Nomad follows glTF, as SculptXR does.
  if (decoded.texCoords && decoded.faceUvs)
    mesh.initTexCoordsDataFromOBJData(decoded.texCoords, decoded.faceUvs);

  // addImportedMeshes() copies this onto the Multimesh wrapper; it is what the
  // outliner shows.
  mesh._permanentStaticLabel = decoded.name;

  mesh._nomadMeshId = decoded.meshId;
  mesh._nomadGeometryId = decoded.geometryId;
  mesh._nomadFaceGroupDefs = decoded.faceGroupDefs;
  // Kept verbatim for the return journey. SculptXR's own matrix picks up the
  // import scale-and-centre (Scene.normalizeAndCenterMeshes multiplies it in),
  // so sending that back would move the object in Nomad.
  mesh._nomadWorldMatrix = decoded.worldMatrix;
  mesh._nomadSmoothShading = decoded.smoothShading;

  return mesh;
};

export default NomadImport;
