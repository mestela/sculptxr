import Utils from '../../misc/Utils.js';
import SculptBase from './SculptBase.js';

class DeleteFace extends SculptBase {
  constructor(main) {
    super(main);
    this._continuous = false; // Only run once per trigger click!
  }

  start(ctrl) {
    // Overriding start instead of stroke because we only want to do it on trigger-down!
    const picking = this._main.getPicking();
    const faceIdx = picking.getPickedFace();

    if (faceIdx < 0) {
      console.log("[DeleteFace] No face picked!");
      return false;
    }

    const mesh = this.getMesh();
    if (!mesh) return false;

    const faces = mesh.getFaces();
    if (!faces || faces.length === 0) return false;

    console.log(`[DeleteFace] Executing: faceIdx=${faceIdx}, totalFacesBefore=${faces.length / 4}`);
    if (!faces || faces.length === 0) return false;

    console.log(`[DeleteFace] Deleting face group index: ${faceIdx}`);

    const newFaces = new Uint32Array(faces.length - 4);
    let head = 0;
    
    // Copy all faces except the one at faceIdx
    for (let i = 0; i < faces.length; i += 4) {
      if (i === faceIdx * 4) continue;
      newFaces[head++] = faces[i];
      newFaces[head++] = faces[i+1];
      newFaces[head++] = faces[i+2];
      newFaces[head++] = faces[i+3];
    }

    const oldFaces = faces;
    const vertices = mesh.getVertices();

    const replaceMeshState = (prevMesh, fArr) => {
      import('../../mesh/meshStatic/MeshStatic.js').then((MeshStaticMod) => {
        const MeshStatic = MeshStaticMod.default;
        const nextMesh = new MeshStatic(this._main._gl);
        
        nextMesh.setVertices(vertices);
        nextMesh.setNbVertices(vertices.length / 3);
        nextMesh.setFaces(fArr);
        nextMesh.setNbFaces(fArr.length / 4);
        
        nextMesh.init();
        nextMesh.initRender();
        
        nextMesh.setMatrix(prevMesh.getMatrix());
        nextMesh.setShaderType(prevMesh.getShaderType());
        if (prevMesh.getShowWireframe) nextMesh.setShowWireframe(prevMesh.getShowWireframe());

        this._main.replaceMesh(prevMesh, nextMesh);
      });
    };

    const undoDelete = () => {
      replaceMeshState(this.getMesh(), oldFaces);
    };

    const redoDelete = () => {
      replaceMeshState(this.getMesh(), newFaces);
    };

    this._main.getStateManager().pushStateCustom(undoDelete, redoDelete);
    redoDelete();

    return true; // We did an edit
  }

  stroke(picking) {
    // No-op for continuous stroke
  }
}

export default DeleteFace;
