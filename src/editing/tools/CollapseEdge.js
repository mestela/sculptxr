import MeshStatic from '../../mesh/meshStatic/MeshStatic.js';
import Mesh from '../../mesh/Mesh.js';
import Utils from '../../misc/Utils.js';
import SculptBase from './SculptBase.js';
import Geometry from '../../math3d/Geometry.js';
import { vec3 } from 'gl-matrix';

class CollapseEdge extends SculptBase {
  constructor(main) {
    super(main);
    this._continuous = false;
  }

  start(ctrl) {
    console.log("[CollapseEdge] Tool start() invoked! Attempting to collapse picked edge.");
    
    const mesh = this.getMesh();
    if (!mesh) return false;

    const picking = this._main.getPicking();
    const faceIdx = picking.getPickedFace();
    
    if (faceIdx === undefined || faceIdx < 0) {
      console.log("[CollapseEdge] Exit: No face picked!");
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

    console.log(`[CollapseEdge] Picking edge ${edgeV1}-${edgeV2} closest to intersection.`);

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
    console.log(`[CollapseEdge] Found ${sharingFaces.length} sharing faces for edge ${edgeV1}-${edgeV2}.`);

    // Edge Collapse logic:
    // Move edgeV2 to the average of edgeV1 and edgeV2. Then replace all references to edgeV2 with edgeV1 (or vice versa).
    // We'll replace edgeV2 with edgeV1 in the remaining faces.
    
    // Average position
    const v1Idx = edgeV1 * 3;
    const v2Idx = edgeV2 * 3;
    const avgX = (vertices[v1Idx] + vertices[v2Idx]) * 0.5;
    const avgY = (vertices[v1Idx + 1] + vertices[v2Idx + 1]) * 0.5;
    const avgZ = (vertices[v1Idx + 2] + vertices[v2Idx + 2]) * 0.5;

    // Filter faces to remove degenerate ones (sharing faces)
    const newFaces = new Uint32Array(faces.length - sharingFaces.length * 4);
    let head = 0;

    for (let i = 0; i < faces.length; i += 4) {
      const idx = i / 4;
      if (sharingFaces.includes(idx)) continue; // Drop sharing faces
      
      let fv0 = faces[i];
      let fv1 = faces[i + 1];
      let fv2 = faces[i + 2];
      let fv3 = faces[i + 3];

      // Replace edgeV2 with edgeV1
      if (fv0 === edgeV2) fv0 = edgeV1;
      if (fv1 === edgeV2) fv1 = edgeV1;
      if (fv2 === edgeV2) fv2 = edgeV1;
      if (fv3 === edgeV2) fv3 = edgeV1;

      newFaces[head++] = fv0;
      newFaces[head++] = fv1;
      newFaces[head++] = fv2;
      newFaces[head++] = fv3;
    }

    const prevMesh = this.getMesh();
    const activeMesh = prevMesh.getCurrentMesh ? prevMesh.getCurrentMesh() : prevMesh;

    // Save old state
    const undoFaces = new Uint32Array(faces);
    const undoVerts = new Float32Array(vertices);

    // Set new state
    activeMesh.setFaces(newFaces);
    activeMesh.setNbFaces(newFaces.length / 4);

    // Apply average position to edgeV1
    vertices[v1Idx] = avgX;
    vertices[v1Idx + 1] = avgY;
    vertices[v1Idx + 2] = avgZ;

    activeMesh.init();
    activeMesh.initRender();

    const redoFaces = newFaces;
    const redoVerts = new Float32Array(vertices); // Wait, vertices are modified in place! Both undo and redo will point to same vertices if we don't save deep copies!
    // But since vertices are modified in-place, we should use our Wholistic object swap!
    // But for a tool, sometimes in-place is okay if we are careful!
    
    const undoCollapse = () => {
      console.log(`[CollapseEdge] undoCollapse EXECUTE`);
      const wasOptim = Mesh.OPTIMIZE;
      Mesh.OPTIMIZE = false;
      activeMesh.setFaces(undoFaces);
      activeMesh.setNbFaces(undoFaces.length / 4);
      activeMesh.setVertices(undoVerts); 
      activeMesh.init();
      Mesh.OPTIMIZE = wasOptim;
      activeMesh.initRender();
    };

    const redoCollapse = () => {
      console.log(`[CollapseEdge] redoCollapse EXECUTE`);
      const wasOptim = Mesh.OPTIMIZE;
      Mesh.OPTIMIZE = false;
      activeMesh.setFaces(redoFaces);
      activeMesh.setNbFaces(redoFaces.length / 4);
      activeMesh.setVertices(redoVerts);
      activeMesh.init();
      Mesh.OPTIMIZE = wasOptim;
      activeMesh.initRender();
    };

    this._main.getStateManager().pushStateCustom(undoCollapse, redoCollapse);
    
    return true;
  }

  stroke(picking) {
  }
}

export default CollapseEdge;
