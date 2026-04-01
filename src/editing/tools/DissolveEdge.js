import MeshStatic from '../../mesh/meshStatic/MeshStatic.js';
import Utils from '../../misc/Utils.js';
import SculptBase from './SculptBase.js';
import Geometry from '../../math3d/Geometry.js';
import { vec3 } from 'gl-matrix';

class DissolveEdge extends SculptBase {
  constructor(main) {
    super(main);
    this._continuous = false;
  }

  start(ctrl) {
    const mesh = this.getMesh();
    if (!mesh) return false;

    const picking = this._main.getPicking();
    const faceIdx = picking.getPickedFace();
    if (faceIdx === undefined || faceIdx < 0) {
      console.log("[DissolveEdge] No face picked!");
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

    // Find the closest edge of this face to the inter point
    const getEdgeDistSq = (a, b) => {
      const pA = vertices.subarray(a * 3, a * 3 + 3);
      const pB = vertices.subarray(b * 3, b * 3 + 3);
      const out = [0, 0, 0];
      return Geometry.distance2PointSegment(inter, pA, pB, out);
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
    if (edgeV1 === -1) {
      console.log("[DissolveEdge] No edge found on face!");
      return false;
    }

    console.log(`[DissolveEdge] Closest edge picked: ${edgeV1}-${edgeV2}`);

    // Find the TWO faces sharing this edge
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

      const sharing = listA.filter(f => listB.includes(f));
      return sharing;
    };

    const sharingFaces = findFacesSharingEdge(edgeV1, edgeV2);
    if (sharingFaces.length !== 2) {
      console.log(`[DissolveEdge] Edge ${edgeV1}-${edgeV2} does not have exactly 2 sharing faces! (Found ${sharingFaces.length}). Might be boundary edge.`);
      return false;
    }

    const [f1, f2] = sharingFaces;
    console.log(`[DissolveEdge] Dissolving edge shared by faces ${f1} and ${f2}`);

    // Find the non-shared vertices of both faces to reconstruct the quad
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
      console.log("[DissolveEdge] Expected exactly 1 unshared vertex per triangle for merging!");
      return false;
    }

    const vC = unshared1[0]; // Face 1 other vertex
    const vD = unshared2[0]; // Face 2 other vertex

    // Reconstruct Quad: vC -> edgeV1 -> vD -> edgeV2
    const quad = [vC, edgeV1, vD, edgeV2];

    // Shrink face array
    const oldFaces = faces;
    const newFaces = new Uint32Array(faces.length - 4); // Replacing 2 faces with 1 quad (net -1 face group)
    let head = 0;

    for (let i = 0; i < faces.length; i += 4) {
      const currentFaceIdx = i / 4;
      if (currentFaceIdx === f1) continue;
      if (currentFaceIdx === f2) continue;
      newFaces[head++] = faces[i];
      newFaces[head++] = faces[i + 1];
      newFaces[head++] = faces[i + 2];
      newFaces[head++] = faces[i + 3];
    }

    // Append the new quad
    newFaces[head++] = quad[0];
    newFaces[head++] = quad[1];
    newFaces[head++] = quad[2];
    newFaces[head++] = quad[3];

    const replaceMeshState = (prevMesh, fArr) => {
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
    };

    const undoDissolve = () => {
      replaceMeshState(this.getMesh(), oldFaces);
    };

    const redoDissolve = () => {
      replaceMeshState(this.getMesh(), newFaces);
    };

    this._main.getStateManager().pushStateCustom(undoDissolve, redoDissolve);
    redoDissolve();

    return true; // We did an edit
  }

  stroke(picking) {
    // No-op for continuous stroke
  }
}

export default DissolveEdge;
