import Utils from '../../misc/Utils.js';
import Mesh from '../../mesh/Mesh.js';
import SculptBase from './SculptBase.js';

class SplitEdge extends SculptBase {
  constructor(main) {
    super(main);
    this._continuous = false;
  }

  start(ctrl) {
    console.log("[SplitEdge] start called");
    const mesh = this.getMesh();
    if (!mesh) {
      console.log("[SplitEdge] No mesh found!");
      return false;
    }

    const activeMesh = mesh.getCurrentMesh ? mesh.getCurrentMesh() : mesh;
    
    const picking = this._main.getPicking();
    const pickedFaceIdx = picking.getPickedFace();
    console.log("[SplitEdge] pickedFaceIdx:", pickedFaceIdx);
    if (pickedFaceIdx === undefined || pickedFaceIdx < 0) return false;

    const hitPoint = picking.getIntersectionPoint();
    console.log("[SplitEdge] hitPoint:", hitPoint);
    if (!hitPoint) return false;

    const faces = activeMesh.getFaces();
    const vertices = activeMesh.getVertices();
    const idf = pickedFaceIdx * 4;
    const vIdxs = [
      faces[idf],
      faces[idf + 1],
      faces[idf + 2],
      faces[idf + 3]
    ];

    // Find closest edge to hit point
    let closestEdge = -1;
    let minDistSq = Infinity;
    
    const getPointToSegmentDistSq = (p, a, b) => {
      const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
      const abLenSq = ab[0]*ab[0] + ab[1]*ab[1] + ab[2]*ab[2];
      if (abLenSq === 0) return ap[0]*ap[0] + ap[1]*ap[1] + ap[2]*ap[2];
      
      let t = (ap[0]*ab[0] + ap[1]*ab[1] + ap[2]*ab[2]) / abLenSq;
      t = Math.max(0, Math.min(1, t));
      
      const closest = [
        a[0] + t * ab[0],
        a[1] + t * ab[1],
        a[2] + t * ab[2]
      ];
      const dx = p[0] - closest[0];
      const dy = p[1] - closest[1];
      const dz = p[2] - closest[2];
      return dx*dx + dy*dy + dz*dz;
    };

    const getVert = (idx) => [
      vertices[idx * 3],
      vertices[idx * 3 + 1],
      vertices[idx * 3 + 2]
    ];

    const numVertsInFace = vIdxs[3] === Utils.TRI_INDEX ? 3 : 4;
    for (let i = 0; i < numVertsInFace; i++) {
      const vA = vIdxs[i];
      const vB = vIdxs[(i + 1) % numVertsInFace];
      const pA = getVert(vA);
      const pB = getVert(vB);
      const distSq = getPointToSegmentDistSq(hitPoint, pA, pB);
      if (distSq < minDistSq) {
        minDistSq = distSq;
        closestEdge = i;
      }
    }

    if (closestEdge === -1) return false;

    const vA = vIdxs[closestEdge];
    const vB = vIdxs[(closestEdge + 1) % numVertsInFace];

    // Midpoint C
    const pA = getVert(vA);
    const pB = getVert(vB);
    const pC = [
      (pA[0] + pB[0]) * 0.5,
      (pA[1] + pB[1]) * 0.5,
      (pA[2] + pB[2]) * 0.5
    ];

    // Find all faces sharing edge (vA, vB)
    const sharedFaces = [];
    for (let i = 0; i < faces.length / 4; i++) {
      const fIdx = i * 4;
      const fv = [faces[fIdx], faces[fIdx + 1], faces[fIdx + 2], faces[fIdx + 3]];
      const hasA = fv.includes(vA);
      const hasB = fv.includes(vB);
      if (hasA && hasB) {
        sharedFaces.push(i);
      }
    }

    // Capture snapshot for undo
    const undoSnapshot = this.captureMeshSnapshot(activeMesh);

    // Add new vertex C
    const newVIdx = activeMesh.getNbVertices();
    const newVertices = new Float32Array(vertices.length + 3);
    newVertices.set(vertices);
    newVertices[newVIdx * 3] = pC[0];
    newVertices[newVIdx * 3 + 1] = pC[1];
    newVertices[newVIdx * 3 + 2] = pC[2];

    activeMesh.setVertices(newVertices);
    activeMesh.setNbVertices(newVIdx + 1);

    // Defensive UV Resizing
    if (activeMesh.hasUV()) {
      const texCoordsST = activeMesh.getTexCoords();
      if (texCoordsST) {
        const newTexCoordsST = new Float32Array(texCoordsST.length + 2);
        newTexCoordsST.set(texCoordsST);
        newTexCoordsST[newVIdx * 2] = 0;
        newTexCoordsST[newVIdx * 2 + 1] = 0;
        activeMesh.setTexCoords(newTexCoordsST);

        const dupCW = activeMesh.getVerticesDuplicateStartCount();
        if (dupCW) {
          const newDupCW = new Uint32Array(dupCW.length + 2);
          newDupCW.set(dupCW);
          activeMesh.setVerticesDuplicateStartCount(newDupCW);
        }
      }
    }

    // Mutate faces
    const newFacesList = [];
    const newFacesUVList = [];
    const facesToRemove = new Set(sharedFaces);

    const hasUV = activeMesh.hasUV();
    const facesUV = hasUV ? activeMesh.getFacesTexCoord() : null;

    for (const fIdx of sharedFaces) {
      const idf = fIdx * 4;
      const fv = [faces[idf], faces[idf + 1], faces[idf + 2], faces[idf + 3]];
      const isTri = fv[3] === Utils.TRI_INDEX;
      const numVerts = isTri ? 3 : 4;

      // Find furthest vertex
      let furthestV = -1;
      let maxDistSq = -1;

      for (let i = 0; i < numVerts; i++) {
        const v = fv[i];
        if (v === vA || v === vB) continue;
        const pV = getVert(v);
        const dx = pV[0] - pC[0];
        const dy = pV[1] - pC[1];
        const dz = pV[2] - pC[2];
        const distSq = dx*dx + dy*dy + dz*dz;
        if (distSq > maxDistSq) {
          maxDistSq = distSq;
          furthestV = v;
        }
      }

      // Rebuild faces
      const idxA = fv.indexOf(vA);
      const idxB = fv.indexOf(vB);
      const isAB = (idxA + 1) % numVerts === idxB;

      // Extract UV indices if needed
      let uvA, uvB, uvNext, uvPrev, uvL;
      if (hasUV) {
        uvA = facesUV[idf + idxA];
        uvB = facesUV[idf + idxB];
        if (numVerts === 3) {
          const idxL = fv.findIndex(v => v !== vA && v !== vB);
          uvL = facesUV[idf + idxL];
        } else if (numVerts === 4) {
          if ((idxA + 1) % 4 === idxB) {
            uvNext = facesUV[idf + (idxA + 2) % 4];
            uvPrev = facesUV[idf + (idxA + 3) % 4];
          } else {
            uvNext = facesUV[idf + (idxB + 2) % 4];
            uvPrev = facesUV[idf + (idxB + 3) % 4];
          }
        }
      }

      if (numVerts === 3) {
        // Was triangle, now has 4 vertices (A, C, B, L)
        // Split into two triangles
        const others = fv.filter(v => v !== vA && v !== vB);
        const L = others[0];
        
        if (isAB) {
          newFacesList.push([vA, newVIdx, L, Utils.TRI_INDEX]);
          newFacesList.push([newVIdx, vB, L, Utils.TRI_INDEX]);
          if (hasUV) {
            newFacesUVList.push([uvA, newVIdx, uvL, Utils.TRI_INDEX]);
            newFacesUVList.push([newVIdx, uvB, uvL, Utils.TRI_INDEX]);
          }
        } else {
          newFacesList.push([vB, newVIdx, L, Utils.TRI_INDEX]);
          newFacesList.push([newVIdx, vA, L, Utils.TRI_INDEX]);
          if (hasUV) {
            newFacesUVList.push([uvB, newVIdx, uvL, Utils.TRI_INDEX]);
            newFacesUVList.push([newVIdx, uvA, uvL, Utils.TRI_INDEX]);
          }
        }
      } else if (numVerts === 4) {
        // Was quad, now has 5 vertices
        // Find vNext and vPrev relative to edge AB
        let vNext, vPrev;
        if ((idxA + 1) % 4 === idxB) {
          vNext = fv[(idxA + 2) % 4];
          vPrev = fv[(idxA + 3) % 4];
        } else {
          vNext = fv[(idxB + 2) % 4];
          vPrev = fv[(idxB + 3) % 4];
        }

        const useNext = (furthestV === vNext);

        if ((idxA + 1) % 4 === idxB) {
          if (useNext) {
            newFacesList.push([newVIdx, vB, vNext, Utils.TRI_INDEX]);
            newFacesList.push([vA, newVIdx, vNext, vPrev]);
            if (hasUV) {
              newFacesUVList.push([newVIdx, uvB, uvNext, Utils.TRI_INDEX]);
              newFacesUVList.push([uvA, newVIdx, uvNext, uvPrev]);
            }
          } else {
            newFacesList.push([vA, newVIdx, vPrev, Utils.TRI_INDEX]);
            newFacesList.push([newVIdx, vB, vNext, vPrev]);
            if (hasUV) {
              newFacesUVList.push([uvA, newVIdx, uvPrev, Utils.TRI_INDEX]);
              newFacesUVList.push([newVIdx, uvB, uvNext, uvPrev]);
            }
          }
        } else {
          if (useNext) {
            newFacesList.push([newVIdx, vA, vNext, Utils.TRI_INDEX]);
            newFacesList.push([vB, newVIdx, vNext, vPrev]);
            if (hasUV) {
              newFacesUVList.push([newVIdx, uvA, uvNext, Utils.TRI_INDEX]);
              newFacesUVList.push([uvB, newVIdx, uvNext, uvPrev]);
            }
          } else {
            newFacesList.push([vB, newVIdx, vPrev, Utils.TRI_INDEX]);
            newFacesList.push([newVIdx, vA, vNext, vPrev]);
            if (hasUV) {
              newFacesUVList.push([uvB, newVIdx, uvPrev, Utils.TRI_INDEX]);
              newFacesUVList.push([newVIdx, uvA, uvNext, uvPrev]);
            }
          }
        }
      }
    }

    // Rebuild faces array
    const numOldFaces = faces.length / 4;
    const newFaces = new Uint32Array((numOldFaces - facesToRemove.size + newFacesList.length) * 4);
    const newFacesUV = hasUV ? new Uint32Array(newFaces.length) : null;
    
    let nIdx = 0;
    for (let i = 0; i < numOldFaces; i++) {
      if (facesToRemove.has(i)) continue;
      newFaces[nIdx] = faces[i * 4];
      newFaces[nIdx + 1] = faces[i * 4 + 1];
      newFaces[nIdx + 2] = faces[i * 4 + 2];
      newFaces[nIdx + 3] = faces[i * 4 + 3];
      
      if (hasUV) {
        newFacesUV[nIdx] = facesUV[i * 4];
        newFacesUV[nIdx + 1] = facesUV[i * 4 + 1];
        newFacesUV[nIdx + 2] = facesUV[i * 4 + 2];
        newFacesUV[nIdx + 3] = facesUV[i * 4 + 3];
      }
      nIdx += 4;
    }

    for (let i = 0; i < newFacesList.length; i++) {
      const nf = newFacesList[i];
      newFaces[nIdx] = nf[0];
      newFaces[nIdx + 1] = nf[1];
      newFaces[nIdx + 2] = nf[2];
      newFaces[nIdx + 3] = nf[3];
      
      if (hasUV) {
        const nfUV = newFacesUVList[i];
        newFacesUV[nIdx] = nfUV[0];
        newFacesUV[nIdx + 1] = nfUV[1];
        newFacesUV[nIdx + 2] = nfUV[2];
        newFacesUV[nIdx + 3] = nfUV[3];
      }
      nIdx += 4;
    }
 
    activeMesh.setFaces(newFaces);
    if (hasUV) {
      activeMesh.setFacesTexCoord(newFacesUV);
    }
    activeMesh.setNbFaces(newFaces.length / 4);

    activeMesh.allocateArrays();
    activeMesh.initTopology();
    activeMesh.updateGeometry();
    activeMesh.updateCenter();
    
    if (activeMesh._renderData)
      activeMesh.updateDuplicateColorsAndMaterials();

    // Wireframe Cache Invalidation
    if (activeMesh._meshData) {
      activeMesh._meshData._drawElementsWireframe = null;
      activeMesh._meshData._drawArraysWireframe = null;
    }

    activeMesh.updateBuffers();
    activeMesh.initRender();
    
    // Log normals for debugging
    const normals = activeMesh.getNormals();
    const nx = normals[newVIdx * 3];
    const ny = normals[newVIdx * 3 + 1];
    const nz = normals[newVIdx * 3 + 2];
    console.log("[SplitEdge] New Vertex Normal:", nx, ny, nz);
    
    const redoSnapshot = this.captureMeshSnapshot(activeMesh);

    const undoSplit = () => {
      this.applyMeshSnapshot(activeMesh, undoSnapshot);
      if (activeMesh._meshData) {
        activeMesh._meshData._drawElementsWireframe = null;
        activeMesh._meshData._drawArraysWireframe = null;
      }
    };
    const redoSplit = () => {
      this.applyMeshSnapshot(activeMesh, redoSnapshot);
      if (activeMesh._meshData) {
        activeMesh._meshData._drawElementsWireframe = null;
        activeMesh._meshData._drawArraysWireframe = null;
      }
    };

    this._main.getStateManager().pushStateCustom(undoSplit, redoSplit);

    return true;
  }

  stroke(picking) {
  }
}

export default SplitEdge;
