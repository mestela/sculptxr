import MeshStatic from '../../mesh/meshStatic/MeshStatic.js';
import Mesh from '../../mesh/Mesh.js';
import Utils from '../../misc/Utils.js';
import SculptBase from './SculptBase.js';

class DeleteFace extends SculptBase {
  constructor(main) {
    super(main);
    this._continuous = false; 
  }

  start(ctrl) {
    const picking = this._main.getPicking();
    const faceIdx = picking.getPickedFace();

    if (faceIdx < 0) {
      return false;
    }

    const mesh = this.getMesh();
    if (!mesh) return false;

    const activeMesh = mesh.getCurrentMesh ? mesh.getCurrentMesh() : mesh;
    const faces = activeMesh.getFaces();
    const facesTexCoord = activeMesh.getFacesTexCoord();

    const newFaces = new Uint32Array(faces.length - 4);
    const newFacesTexCoord = facesTexCoord ? new Uint32Array(facesTexCoord.length - 4) : null;
    // Keep per-face group ids in lockstep as we drop a face from the middle.
    const oldGroups = activeMesh.getFacesGroups ? activeMesh.getFacesGroups() : null;
    const newGroups = oldGroups ? new Int32Array(faces.length / 4 - 1) : null;
    let head = 0;
    let headT = 0;
    let headG = 0;

    for (let i = 0; i < faces.length; i += 4) {
      if (i === faceIdx * 4) continue;
      newFaces[head++] = faces[i];
      newFaces[head++] = faces[i+1];
      newFaces[head++] = faces[i+2];
      newFaces[head++] = faces[i+3];

      if (newFacesTexCoord) {
        newFacesTexCoord[headT++] = facesTexCoord[i];
        newFacesTexCoord[headT++] = facesTexCoord[i+1];
        newFacesTexCoord[headT++] = facesTexCoord[i+2];
        newFacesTexCoord[headT++] = facesTexCoord[i+3];
      }

      if (newGroups) newGroups[headG++] = oldGroups[i / 4];
    }

    console.log("[DeleteFace] Capturing undo snapshot...");
    const undoSnapshot = this.captureMeshSnapshot(activeMesh);

    // Set new state
    activeMesh.setFaces(newFaces);
    activeMesh.setNbFaces(newFaces.length / 4);

    if (newFacesTexCoord) {
      activeMesh.setFacesTexCoord(newFacesTexCoord);
    }

    activeMesh.allocateArrays();
    // allocateArrays reallocates _facesGroups by index; restore the correctly-shifted ids.
    if (newGroups) activeMesh.setFacesGroups(newGroups);
    activeMesh.initTopology();
    activeMesh.updateGeometry();
    activeMesh.updateCenter();
    
    if (activeMesh._renderData)
      activeMesh.updateDuplicateColorsAndMaterials();
    activeMesh.updateBuffers();

    const redoSnapshot = this.captureMeshSnapshot(activeMesh);

    this._main.getStateManager().pushStateCustom(
      () => this.applyMeshSnapshot(activeMesh, undoSnapshot),
      () => this.applyMeshSnapshot(activeMesh, redoSnapshot)
    );

    return true; // We did an edit
  }

  stroke(picking) {
    // No-op for continuous stroke
  }
}

export default DeleteFace;
