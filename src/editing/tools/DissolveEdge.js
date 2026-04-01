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
    console.log("[DissolveEdge] Tool start() invoked! Attempting to dissolve edge.");
    
    const mesh = this.getMesh();
    if (!mesh) {
      console.log("[DissolveEdge] No mesh found extracted from getMesh()!");
      return false;
    }

    const picking = this._main.getPicking();
    const faceIdx = picking.getPickedFace();
    console.log(`[DissolveEdge] Picked face index: ${faceIdx}`);
    
    if (faceIdx === undefined || faceIdx < 0) {
      console.log("[DissolveEdge] Exit: No face picked or faceIdx is invalid (< 0)!");
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

    console.log(`[DissolveEdge] Face vertices: v0=${v0}, v1=${v1}, v2=${v2}, v3=${v3}`);

    // Find the closest edge of this face to the inter point
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
    if (edgeV1 === -1) {
      console.log("[DissolveEdge] Exit: No edge found on face close to intersection point!");
      return false;
    }

    console.log(`[DissolveEdge] Closest edge picked: ${edgeV1}-${edgeV2}. Distance squared: ${minDistSq}`);

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

      console.log(`[DissolveEdge] Vertex ${a} connected faces count: ${countA}`);
      console.log(`[DissolveEdge] Vertex ${b} connected faces count: ${countB}`);

      const sharing = listA.filter(f => listB.includes(f));
      return sharing;
    };

    const sharingFaces = findFacesSharingEdge(edgeV1, edgeV2);
    console.log(`[DissolveEdge] Shared faces count: ${sharingFaces.length}. Candidates: ${sharingFaces.join(", ")}`);

    if (sharingFaces.length !== 2) {
      console.log(`[DissolveEdge] Exit: Edge ${edgeV1}-${edgeV2} does not have exactly 2 sharing faces! (Found ${sharingFaces.length}). Boundary or non-manifold edge.`);
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

    console.log(`[DissolveEdge] Face 1 (${f1}) vertices: ${verts1.join(", ")}`);
    console.log(`[DissolveEdge] Face 2 (${f2}) vertices: ${verts2.join(", ")}`);

    const isShared = (v) => v === edgeV1 || v === edgeV2;

    const unshared1 = verts1.filter(v => v !== Utils.TRI_INDEX && !isShared(v));
    const unshared2 = verts2.filter(v => v !== Utils.TRI_INDEX && !isShared(v));

    console.log(`[DissolveEdge] Face 1 unshared count: ${unshared1.length} -> [${unshared1.join(", ")}]`);
    console.log(`[DissolveEdge] Face 2 unshared count: ${unshared2.length} -> [${unshared2.join(", ")}]`);

    if (unshared1.length !== 1 || unshared2.length !== 1) {
      console.log("[DissolveEdge] Exit: Expected exactly 1 unshared vertex per triangle for merging (can only merge two triangles into a quad)!");
      return false;
    }

    const vC = unshared1[0]; // Face 1 other vertex
    const vD = unshared2[0]; // Face 2 other vertex

    const quad1 = [vC, edgeV1, vD, edgeV2];
    const quad2 = [vC, edgeV2, vD, edgeV1];

    const getNormal = (q) => {
      const v1x = vertices[q[0] * 3], v1y = vertices[q[0] * 3 + 1], v1z = vertices[q[0] * 3 + 2];
      const v2x = vertices[q[1] * 3], v2y = vertices[q[1] * 3 + 1], v2z = vertices[q[1] * 3 + 2];
      const v3x = vertices[q[2] * 3], v3y = vertices[q[2] * 3 + 1], v3z = vertices[q[2] * 3 + 2];
      const v4x = vertices[q[3] * 3], v4y = vertices[q[3] * 3 + 1], v4z = vertices[q[3] * 3 + 2];

      const ax1 = v2x - v1x, ay1 = v2y - v1y, az1 = v2z - v1z;
      const bx1 = v3x - v1x, by1 = v3y - v1y, bz1 = v3z - v1z;
      const nx1 = ay1 * bz1 - az1 * by1, ny1 = az1 * bx1 - ax1 * bz1, nz1 = ax1 * by1 - ay1 * bx1;

      const ax2 = v3x - v4x, ay2 = v3y - v4y, az2 = v3z - v4z;
      const bx2 = v3x - v1x, by2 = v3y - v1y, bz2 = v3z - v1z;
      const nx2 = ay2 * bz2 - az2 * by2, ny2 = az2 * bx2 - ax2 * bz2, nz2 = ax2 * by2 - ay2 * bx2;

      return [nx1 + nx2, ny1 + ny2, nz1 + nz2];
    };

    const n1 = getNormal(quad1);
    const n2 = getNormal(quad2);

    // Since our sphere is centered at origin (0,0,0) or translated by context, we can use vertex vC as an approximation of the outward direction.
    const vCx = vertices[vC * 3], vCy = vertices[vC * 3 + 1], vCz = vertices[vC * 3 + 2];
    const dot1 = n1[0] * vCx + n1[1] * vCy + n1[2] * vCz;
    const dot2 = n2[0] * vCx + n2[1] * vCy + n2[2] * vCz;

    const quad = dot1 > dot2 ? quad1 : quad2;

    const getCoord = (v) => {
      return `[${vertices[v * 3].toFixed(3)}, ${vertices[v * 3 + 1].toFixed(3)}, ${vertices[v * 3 + 2].toFixed(3)}]`;
    };

    console.log(`[DissolveEdge] Dynamically picked quad sequence: ${quad.join(", ")} (dot1: ${dot1.toFixed(6)}, dot2: ${dot2.toFixed(6)})`);
    console.log(`[DissolveEdge] Quad Coordinates: vC=${getCoord(quad[0])}, edgeV1=${getCoord(quad[1])}, vD=${getCoord(quad[2])}, edgeV2=${getCoord(quad[3])}`);

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

    console.log(`[DissolveEdge] Face array shrunk from ${faces.length} to ${newFaces.length} indices.`);

    const prevMesh = this.getMesh();
    
    // Modify the active mesh in-place to prevent scene flashes during re-rendering!
    const activeMesh = prevMesh.getCurrentMesh ? prevMesh.getCurrentMesh() : prevMesh;

    activeMesh.setFaces(newFaces);
    activeMesh.setNbFaces(newFaces.length / 4);
    activeMesh.isQuad = true; // Mark as containing quads!

    activeMesh.init();
    activeMesh.initRender();

    // Push state for undo/redo before making changes!
    this._main.getStateManager().pushState(prevMesh);

    const undoFaces = faces;
    const redoFaces = newFaces;

    const undoDissolve = () => {
      activeMesh.setFaces(undoFaces);
      activeMesh.setNbFaces(undoFaces.length / 4);
      activeMesh.init();
      activeMesh.initRender();
    };

    const redoDissolve = () => {
      activeMesh.setFaces(redoFaces);
      activeMesh.setNbFaces(redoFaces.length / 4);
      activeMesh.init();
      activeMesh.initRender();
    };

    this._main.getStateManager().pushStateCustom(undoDissolve, redoDissolve);
    
    console.log("[DissolveEdge] Successfully applied dissolve operation!");
    return true; // We did an edit
  }

  stroke(picking) {
    // No-op for continuous stroke
  }
}

export default DissolveEdge;
