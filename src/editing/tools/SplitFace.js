import Utils from '../../misc/Utils.js';
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

    activeMesh.setFaces(newFaces);
    activeMesh.setNbFaces(newFaces.length / 4);

    activeMesh.init();
    activeMesh.initRender();

    this._main.getStateManager().pushState(mesh);

    const undoFaces = faces;
    const redoFaces = newFaces;

    const undoSplit = () => {
      activeMesh.setFaces(undoFaces);
      activeMesh.setNbFaces(undoFaces.length / 4);
      activeMesh.init();
      activeMesh.initRender();
    };

    const redoSplit = () => {
      activeMesh.setFaces(redoFaces);
      activeMesh.setNbFaces(redoFaces.length / 4);
      activeMesh.init();
      activeMesh.initRender();
    };

    this._main.getStateManager().pushStateCustom(undoSplit, redoSplit);

    console.log("[SplitFace] Successfully split quad into two triangles.");
    return true;
  }

  stroke(picking) {
  }
}

export default SplitFace;
