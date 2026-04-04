import Utils from '../../misc/Utils.js';
import Mesh from '../../mesh/Mesh.js';
import SculptBase from './SculptBase.js';
import Geometry from '../../math3d/Geometry.js';

class SpinEdge extends SculptBase {
  constructor(main) {
    super(main);
    this._continuous = false;
  }

  start(ctrl) {
    const mesh = this.getMesh();
    if (!mesh) return false;

    const picking = this._main.getPicking();
    const faceIdx = picking.getPickedFace();
    if (faceIdx === undefined || faceIdx < 0) return false;

    const inter = picking.getIntersectionPoint(); // local space
    const faces = mesh.getFaces();
    const vertices = mesh.getVertices();

    const fid = faceIdx * 4;
    const v0 = faces[fid];
    const v1 = faces[fid + 1];
    const v2 = faces[fid + 2];
    const v3 = faces[fid + 3];

    const getEdgeDistSq = (a, b) => {
      const pA = vertices.subarray(a * 3, a * 3 + 3);
      const pB = vertices.subarray(b * 3, b * 3 + 3);
      return Geometry.distanceSqToSegment(inter, pA, pB);
    };

    let minDistSq = Infinity;
    let closestEdge = [-1, -1];

    const checkEdge = (a, b) => {
      const d = getEdgeDistSq(a, b);
      if (d < minDistSq) {
        minDistSq = d;
        closestEdge = [a, b];
      }
    };

    checkEdge(v0, v1);
    checkEdge(v1, v2);
    if (v3 === Utils.TRI_INDEX) {
      checkEdge(v2, v0);
    } else {
      checkEdge(v2, v3);
      checkEdge(v3, v0);
    }

    const [edgeV1, edgeV2] = closestEdge;
    if (edgeV1 === -1) return false;

    const vrfStartCount = mesh.getVerticesRingFaceStartCount();
    const vertRingFace = mesh.getVerticesRingFace();

    const findFacesSharingEdge = (a, b) => {
      const listA = [];
      const startCountIdxA = a * 2;
      const startIdxA = vrfStartCount[startCountIdxA];
      const countA = vrfStartCount[startCountIdxA + 1];
      for (let i = 0; i < countA; ++i) listA.push(vertRingFace[startIdxA + i]);

      const listB = [];
      const startCountIdxB = b * 2;
      const startIdxB = vrfStartCount[startCountIdxB];
      const countB = vrfStartCount[startCountIdxB + 1];
      for (let i = 0; i < countB; ++i) listB.push(vertRingFace[startIdxB + i]);

      return listA.filter(f => listB.includes(f));
    };

    const sharingFaces = findFacesSharingEdge(edgeV1, edgeV2);
    if (sharingFaces.length !== 2) {
      console.log("[SpinEdge] Edge does not have exactly two sharing faces. Boundary edge?");
      return false;
    }

    const [f1, f2] = sharingFaces;

    const getVertices = (f) => {
      const id = f * 4;
      return [faces[id], faces[id + 1], faces[id + 2], faces[id + 3]];
    };

    const verts1 = getVertices(f1);
    const verts2 = getVertices(f2);

    const isShared = (v) => v === edgeV1 || v === edgeV2;

    const unshared1 = verts1.filter(v => v !== Utils.TRI_INDEX && !isShared(v));
    const unshared2 = verts2.filter(v => v !== Utils.TRI_INDEX && !isShared(v));

    if (unshared1.length !== 1 || unshared2.length !== 1) {
      console.log("[SpinEdge] Can only spin edge between two triangles.");
      return false;
    }

    const vC = unshared1[0];
    const vD = unshared2[0];

    const activeMesh = mesh.getCurrentMesh ? mesh.getCurrentMesh() : mesh;
    
    console.log("[SpinEdge] Capturing undo snapshot...");
    const undoSnapshot = this.captureMeshSnapshot(activeMesh);

    const newFaces = new Uint32Array(faces);

    const f1Id = f1 * 4;
    newFaces[f1Id] = vC;
    newFaces[f1Id + 1] = edgeV1;
    newFaces[f1Id + 2] = vD;
    newFaces[f1Id + 3] = Utils.TRI_INDEX;

    const f2Id = f2 * 4;
    newFaces[f2Id] = vD;
    newFaces[f2Id + 1] = edgeV2;
    newFaces[f2Id + 2] = vC;
    newFaces[f2Id + 3] = Utils.TRI_INDEX;

    activeMesh.setFaces(newFaces);
    activeMesh.initTopology();
    
    // Clear wireframe caches
    if (activeMesh._meshData) {
      activeMesh._meshData._drawElementsWireframe = null;
      activeMesh._meshData._drawArraysWireframe = null;
    }
    
    // Update buffers if needed (initTopology doesn't do WebGL)
    if (activeMesh.updateBuffers) activeMesh.updateBuffers();
    else if (activeMesh.initRender) activeMesh.initRender();

    const redoSnapshot = this.captureMeshSnapshot(activeMesh);

    const undoSpin = () => {
      console.log(`[SpinEdge] undoSpin EXECUTE`);
      this.applyMeshSnapshot(activeMesh, undoSnapshot);
    };

    const redoSpin = () => {
      console.log(`[SpinEdge] redoSpin EXECUTE`);
      this.applyMeshSnapshot(activeMesh, redoSnapshot);
    };

    this._main.getStateManager().pushStateCustom(undoSpin, redoSpin);

    console.log("[SpinEdge] Successfully spun edge.");
    return true;
  }

  stroke(picking) {
  }
}

export default SpinEdge;
