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

    const prevMesh = this.getMesh();
    const activeMesh = prevMesh.getCurrentMesh ? prevMesh.getCurrentMesh() : prevMesh;

    // Edge Collapse logic:
    // Move edgeV2 to the average of edgeV1 and edgeV2. Then replace all references to edgeV2 with edgeV1.
    
    // Average position
    const v1Idx = edgeV1 * 3;
    const v2Idx = edgeV2 * 3;
    const avgX = (vertices[v1Idx] + vertices[v2Idx]) * 0.5;
    const avgY = (vertices[v1Idx + 1] + vertices[v2Idx + 1]) * 0.5;
    const avgZ = (vertices[v1Idx + 2] + vertices[v2Idx + 2]) * 0.5;

    // Filter faces to remove degenerate ones
    const tempFaces = new Uint32Array(faces.length);
    const facesTexCoord = activeMesh.getFacesTexCoord();
    const tempFacesTexCoord = facesTexCoord ? new Uint32Array(facesTexCoord.length) : null;
    let head = 0;
    let headT = 0;
    let droppedCount = 0;

    for (let i = 0; i < faces.length; i += 4) {
      let fv0 = faces[i];
      let fv1 = faces[i + 1];
      let fv2 = faces[i + 2];
      let fv3 = faces[i + 3];

      // Replace edgeV2 with edgeV1
      if (fv0 === edgeV2) fv0 = edgeV1;
      if (fv1 === edgeV2) fv1 = edgeV1;
      if (fv2 === edgeV2) fv2 = edgeV1;
      if (fv3 === edgeV2) fv3 = edgeV1;

      // Filter duplicates to detect degeneracy
      const unique = [];
      if (!unique.includes(fv0)) unique.push(fv0);
      if (!unique.includes(fv1)) unique.push(fv1);
      if (!unique.includes(fv2)) unique.push(fv2);
      if (!unique.includes(fv3)) unique.push(fv3);

      // Remove TRI_INDEX from unique if present
      const triIdx = unique.indexOf(Utils.TRI_INDEX);
      if (triIdx !== -1) unique.splice(triIdx, 1);

      if (unique.length < 3) {
        // Drop face!
        droppedCount++;
        continue;
      }

      // Reconstruct face
      tempFaces[head++] = unique[0];
      tempFaces[head++] = unique[1];
      tempFaces[head++] = unique[2];
      tempFaces[head++] = unique.length > 3 ? unique[3] : Utils.TRI_INDEX;

      if (tempFacesTexCoord) {
        let fv0t = facesTexCoord[i];
        let fv1t = facesTexCoord[i + 1];
        let fv2t = facesTexCoord[i + 2];
        let fv3t = facesTexCoord[i + 3];

        if (faces[i] === edgeV2) fv0t = edgeV1;
        if (faces[i + 1] === edgeV2) fv1t = edgeV1;
        if (faces[i + 2] === edgeV2) fv2t = edgeV1;
        if (faces[i + 3] === edgeV2) fv3t = edgeV1;

        tempFacesTexCoord[headT++] = fv0t;
        tempFacesTexCoord[headT++] = fv1t;
        tempFacesTexCoord[headT++] = fv2t;
        tempFacesTexCoord[headT++] = fv3t;
      }
    }

    const newFaces = new Uint32Array(tempFaces.subarray(0, head));
    let newFacesTexCoord = null;
    if (tempFacesTexCoord) {
      newFacesTexCoord = new Uint32Array(tempFacesTexCoord.subarray(0, headT));
    }

    console.log(`[CollapseEdge] Dropped ${droppedCount} degenerate faces, new face count: ${newFaces.length / 4}`);

    console.log("[CollapseEdge] Capturing undo snapshot...");
    const undoSnapshot = this.captureMeshSnapshot(activeMesh);

    // Set new state
    activeMesh.setFaces(newFaces);
    activeMesh.setNbFaces(newFaces.length / 4);
    
    if (newFacesTexCoord) {
      activeMesh.setFacesTexCoord(newFacesTexCoord);
    }

    // Apply average position to edgeV1
    vertices[v1Idx] = avgX;
    vertices[v1Idx + 1] = avgY;
    vertices[v1Idx + 2] = avgZ;

    activeMesh.initTopology();
    activeMesh.updateGeometry();
    activeMesh.updateCenter();
    if (activeMesh._renderData)
      activeMesh.updateDuplicateColorsAndMaterials();
    activeMesh.updateBuffers();
    activeMesh.initRender();

    const redoSnapshot = this.captureMeshSnapshot(activeMesh);

    const pushState = () => {
      const undoOp = () => {
        this.applyMeshSnapshot(activeMesh, undoSnapshot);
      };
      const redoOp = () => {
        this.applyMeshSnapshot(activeMesh, redoSnapshot);
      };
      this._main.getStateManager().pushStateCustom(undoOp, redoOp);
    };

    pushState();
    
    return true;
  }

  stroke(picking) {
  }
}

export default CollapseEdge;
