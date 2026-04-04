import MeshStatic from '../../mesh/meshStatic/MeshStatic.js';
import Mesh from '../../mesh/Mesh.js';
import Utils from '../../misc/Utils.js';
import SculptBase from './SculptBase.js';
import Geometry from '../../math3d/Geometry.js';
import { vec3 } from 'gl-matrix';

class SnapWeldCenter extends SculptBase {
  constructor(main) {
    super(main);
    this._continuous = false;
  }

  start(ctrl) {
    console.log("[SnapWeldCenter] Tool start() invoked! Attempting to collapse diamond to center.");
    
    const mesh = this.getMesh();
    if (!mesh) return false;

    const picking = this._main.getPicking();
    const faceIdx = picking.getPickedFace();
    
    if (faceIdx === undefined || faceIdx < 0) {
      console.log("[SnapWeldCenter] Exit: No face picked!");
      return false;
    }

    const inter = picking.getIntersectionPoint(); // local space
    const faces = mesh.getFaces();
    const vertices = mesh.getVertices();

    const fid = faceIdx * 4;
    const v0 = faces[fid];
    const v1 = faces[fid + 1];
    const v2 = faces[fid + 2];
    const v3 = faces[fid + 3];

    // Find closest edge to intersection
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

    console.log(`[SnapWeldCenter] Picking edge ${edgeV1}-${edgeV2} closest to intersection.`);

    // Check if edge is on centerline (X=0)
    const x1 = vertices[edgeV1 * 3];
    const x2 = vertices[edgeV2 * 3];
    const TOLERANCE = 0.05; // Accept slightly off center edges if they are intended to be center
    if (Math.abs(x1) > TOLERANCE || Math.abs(x2) > TOLERANCE) {
      console.warn("[SnapWeldCenter] Edge is not on the centerline!");
      return false;
    }

    // Find faces sharing this edge
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
    console.log(`[SnapWeldCenter] Found ${sharingFaces.length} sharing faces.`);

    if (sharingFaces.length !== 2) {
      console.warn("[SnapWeldCenter] Expected exactly 2 sharing faces (triangles), found " + sharingFaces.length);
      return false;
    }

    // Find the third vertex in each face (the opposites)
    const getOppositeVertex = (fIdx, a, b) => {
      const id = fIdx * 4;
      const fv = [faces[id], faces[id + 1], faces[id + 2]];
      if (faces[id + 3] !== Utils.TRI_INDEX) fv.push(faces[id + 3]);
      
      return fv.find(v => v !== a && v !== b);
    };

    const vA = getOppositeVertex(sharingFaces[0], edgeV1, edgeV2);
    const vB = getOppositeVertex(sharingFaces[1], edgeV1, edgeV2);

    if (vA === undefined || vB === undefined) {
      console.warn("[SnapWeldCenter] Could not find opposite vertices!");
      return false;
    }

    console.log(`[SnapWeldCenter] Opposites are ${vA} and ${vB}.`);

    // Calculate midpoint of vA and vB (projected to X=0)
    const vAIdx = vA * 3;
    const vBIdx = vB * 3;
    const midY = (vertices[vAIdx + 1] + vertices[vBIdx + 1]) * 0.5;
    const midZ = (vertices[vAIdx + 2] + vertices[vBIdx + 2]) * 0.5;

    // We will collapse vB into vA!
    // And move vA to (0, midY, midZ)!

    const prevMesh = this.getMesh();
    const activeMesh = prevMesh.getCurrentMesh ? prevMesh.getCurrentMesh() : prevMesh;

    console.log("[SnapWeldCenter] Capturing undo snapshot...");
    const undoSnapshot = this.captureMeshSnapshot(activeMesh);

    // Replace vB with vA in all faces
    const newFaces = new Uint32Array(faces.length);
    newFaces.set(faces);
    
    for (let i = 0; i < newFaces.length; i++) {
      if (newFaces[i] === vB) {
        newFaces[i] = vA;
      }
    }

    // Remove the two degenerate faces sharing the edge
    for (let i = 0; i < sharingFaces.length; i++) {
      const idx = sharingFaces[i] * 4;
      newFaces[idx] = Utils.TRI_INDEX;
      newFaces[idx + 1] = Utils.TRI_INDEX;
      newFaces[idx + 2] = Utils.TRI_INDEX;
      newFaces[idx + 3] = Utils.TRI_INDEX;
    }

    activeMesh.setFaces(newFaces);
    activeMesh.setNbFaces(newFaces.length / 4);

    // Apply midpoint position to vA (snapped to center)
    const newVertices = new Float32Array(vertices);
    newVertices[vAIdx] = 0;
    newVertices[vAIdx + 1] = midY;
    newVertices[vAIdx + 2] = midZ;
    
    activeMesh.setVertices(newVertices);

    // Safety check for texCoordsST
    if (activeMesh.hasUV()) {
      const nbVerts = activeMesh.getNbVertices();
      const nbTex = activeMesh.getTexCoords().length / 2;
      if (nbVerts > nbTex) {
        console.log(`[SnapWeldCenter] Safety resizing texCoordsST from ${nbTex} to ${nbVerts}`);
        const newTex = new Float32Array(nbVerts * 2);
        newTex.set(activeMesh.getTexCoords());
        activeMesh.setTexCoords(newTex);
      }
    }

    activeMesh.allocateArrays();
    activeMesh.initTopology();
    activeMesh.updateGeometry();
    if (activeMesh._renderData)
      activeMesh.updateDuplicateColorsAndMaterials();
    activeMesh.updateCenter();
    
    // Clear wireframe caches
    if (activeMesh._meshData) {
      activeMesh._meshData._drawElementsWireframe = null;
      activeMesh._meshData._drawArraysWireframe = null;
    }
    
    if (activeMesh.updateBuffers) activeMesh.updateBuffers();
    else if (activeMesh.initRender) activeMesh.initRender();

    const redoSnapshot = this.captureMeshSnapshot(activeMesh);

    const undoOp = () => {
      console.log(`[SnapWeldCenter] undoOp EXECUTE`);
      this.applyMeshSnapshot(activeMesh, undoSnapshot);
    };

    const redoOp = () => {
      console.log(`[SnapWeldCenter] redoOp EXECUTE`);
      this.applyMeshSnapshot(activeMesh, redoSnapshot);
    };

    this._main.getStateManager().pushStateCustom(undoOp, redoOp);
    
    return true;
  }

  stroke(picking) {
  }
}

SnapWeldCenter.uiName = 'sculptSnapWeldCenter';

export default SnapWeldCenter;
