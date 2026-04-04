import Utils from '../../misc/Utils.js';
import Mesh from '../../mesh/Mesh.js';
import SculptBase from './SculptBase.js';

class SplitFace extends SculptBase {
  constructor(main) {
    super(main);
    this._continuous = false;
  }

  start(ctrl) {
    const mesh = this.getMesh();
    if (!mesh) return false;

    const picking = this._main.getPicking();
    const pickedFaceIdx = picking.getPickedFace();
    if (pickedFaceIdx === undefined || pickedFaceIdx < 0) return false;

    const faces = mesh.getFaces();
    const idf = pickedFaceIdx * 4;
    const v1 = faces[idf];
    const v2 = faces[idf + 1];
    const v3 = faces[idf + 2];
    const v4 = faces[idf + 3];

    if (v4 === Utils.TRI_INDEX) {
      console.log("[SplitFace] Picked face is already a triangle!");
      return false;
    }

    const vertices = mesh.getVertices();
    const getDistSq = (idA, idB) => {
      const ax = vertices[idA * 3], ay = vertices[idA * 3 + 1], az = vertices[idA * 3 + 2];
      const bx = vertices[idB * 3], by = vertices[idB * 3 + 1], bz = vertices[idB * 3 + 2];
      const dx = bx - ax, dy = by - ay, dz = bz - az;
      return dx * dx + dy * dy + dz * dz;
    };

    const d13 = getDistSq(v1, v3);
    const d24 = getDistSq(v2, v4);

    let tri1, tri2;
    if (d13 < d24) {
      tri1 = [v1, v2, v3, Utils.TRI_INDEX];
      tri2 = [v1, v3, v4, Utils.TRI_INDEX];
    } else {
      tri1 = [v2, v3, v4, Utils.TRI_INDEX];
      tri2 = [v4, v1, v2, Utils.TRI_INDEX];
    }

    const newFaces = new Uint32Array(faces.length + 4);
    newFaces.set(faces);

    newFaces[idf] = tri1[0];
    newFaces[idf + 1] = tri1[1];
    newFaces[idf + 2] = tri1[2];
    newFaces[idf + 3] = tri1[3];

    const lastIdx = faces.length;
    newFaces[lastIdx] = tri2[0];
    newFaces[lastIdx + 1] = tri2[1];
    newFaces[lastIdx + 2] = tri2[2];
    newFaces[lastIdx + 3] = tri2[3];

    const activeMesh = mesh.getCurrentMesh ? mesh.getCurrentMesh() : mesh;

    // Handle UV mapped meshes
    const facesTexCoord = activeMesh.getFacesTexCoord();
    let newFacesTexCoord = null;
    console.log("[SplitFace] facesTexCoord present?", facesTexCoord !== null);
    if (facesTexCoord) {
      newFacesTexCoord = new Uint32Array(facesTexCoord.length + 4);
      newFacesTexCoord.set(facesTexCoord);
      
      const v1t = facesTexCoord[idf];
      const v2t = facesTexCoord[idf + 1];
      const v3t = facesTexCoord[idf + 2];
      const v4t = facesTexCoord[idf + 3];
      
      let tri1t, tri2t;
      if (d13 < d24) {
        tri1t = [v1t, v2t, v3t, Utils.TRI_INDEX];
        tri2t = [v1t, v3t, v4t, Utils.TRI_INDEX];
      } else {
        tri1t = [v2t, v3t, v4t, Utils.TRI_INDEX];
        tri2t = [v4t, v1t, v2t, Utils.TRI_INDEX];
      }
      

      
      newFacesTexCoord[idf] = tri1t[0];
      newFacesTexCoord[idf + 1] = tri1t[1];
      newFacesTexCoord[idf + 2] = tri1t[2];
      newFacesTexCoord[idf + 3] = tri1t[3];
      
      newFacesTexCoord[lastIdx] = tri2t[0];
      newFacesTexCoord[lastIdx + 1] = tri2t[1];
      newFacesTexCoord[lastIdx + 2] = tri2t[2];
      newFacesTexCoord[lastIdx + 3] = tri2t[3];
    }

    const undoSnapshot = this.captureMeshSnapshot(activeMesh);

    activeMesh.setFaces(newFaces);
    activeMesh.setNbFaces(newFaces.length / 4);
    
    if (newFacesTexCoord) {
      activeMesh.setFacesTexCoord(newFacesTexCoord);
    }

    activeMesh.allocateArrays();

    activeMesh.initTopology();
    activeMesh.updateGeometry();
    activeMesh.updateCenter();
    
    if (activeMesh._renderData)
      activeMesh.updateDuplicateColorsAndMaterials();
    activeMesh.updateBuffers();
    activeMesh.initRender();
    const redoSnapshot = this.captureMeshSnapshot(activeMesh);

    console.log("[SplitFace] Pushing custom state...");
    const undoSplit = () => this.applyMeshSnapshot(activeMesh, undoSnapshot);
    const redoSplit = () => this.applyMeshSnapshot(activeMesh, redoSnapshot);

    this._main.getStateManager().pushStateCustom(undoSplit, redoSplit);

    console.log("[SplitFace] Successfully split quad into two triangles.");
    return true;
  }

  stroke(picking) {
  }
}

export default SplitFace;
