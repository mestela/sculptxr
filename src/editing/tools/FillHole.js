import Utils from '../../misc/Utils.js';
import SculptBase from './SculptBase.js';
import MeshStatic from '../../mesh/meshStatic/MeshStatic.js';

class FillHole extends SculptBase {
  constructor(main) {
    super(main);
    this._continuous = false;
  }

  start(ctrl) {
    const mesh = this.getMesh();
    if (!mesh) return false;

    const picking = this._main.getPicking();
    const pickedFaceIdx = picking.getPickedFace();
    if (pickedFaceIdx === undefined || pickedFaceIdx < 0) {
      return false;
    }

    const faces = mesh.getFaces();
    const feAr = mesh.getFaceEdges();
    const eAr = mesh.getEdges();

    const idf = pickedFaceIdx * 4;
    const v0 = faces[idf];
    const v1 = faces[idf + 1];
    const v2 = faces[idf + 2];
    const v3 = faces[idf + 3];

    let startV1 = -1;
    let startV2 = -1;

    // Helper to add edge
    const checkEdge = (feIdx, a, b) => {
      if (eAr[feAr[feIdx]] === 1) {
        startV1 = b; // Inverse winding of face is the hole!
        startV2 = a;
        return true;
      }
      return false;
    };

    if (checkEdge(idf, v0, v1)) {}
    else if (checkEdge(idf + 1, v1, v2)) {}
    else if (v3 === Utils.TRI_INDEX) {
      if (checkEdge(idf + 2, v2, v0)) {}
    } else {
      if (checkEdge(idf + 2, v2, v3)) {}
      else if (checkEdge(idf + 3, v3, v0)) {}
    }

    if (startV1 === -1) {
      return;
    }

    const nbFaces = mesh.getNbFaces();
    const openEdgeMap = new Map(); // v1 -> v2 (or set of neighbors)

    for (let f = 0; f < nbFaces; ++f) {
      const fid = f * 4;
      const v0 = faces[fid];
      const v1 = faces[fid + 1];
      const v2 = faces[fid + 2];
      const v3 = faces[fid + 3];

      const addOpen = (feIdx, a, b) => {
        if (eAr[feAr[feIdx]] === 1) {
          if (!openEdgeMap.has(a)) openEdgeMap.set(a, []);
          if (!openEdgeMap.has(b)) openEdgeMap.set(b, []);
          openEdgeMap.get(a).push(b);
          openEdgeMap.get(b).push(a);
        }
      };

      addOpen(fid, v0, v1);
      addOpen(fid + 1, v1, v2);
      if (v3 === Utils.TRI_INDEX) {
        addOpen(fid + 2, v2, v0);
      } else {
        addOpen(fid + 2, v2, v3);
        addOpen(fid + 3, v3, v0);
      }
    }

    

    const loop = [];
    let curr = startV2;
    loop.push(startV1);
    loop.push(startV2);

    const visited = new Set();
    visited.add(startV1);
    visited.add(startV2);

    let maxIters = 5000;
    while (maxIters-- > 0) {
      const neighbors = openEdgeMap.get(curr);
      if (!neighbors) {
        break;
      }

      let foundNext = false;
      for (const nextV of neighbors) {
        if (!visited.has(nextV)) {
          loop.push(nextV);
          visited.add(nextV);
          curr = nextV;
          foundNext = true;
          break;
        }
      }

      // If we don't find unvisited, let's see if we touch startV1 to close the loop
      if (!foundNext) {
        for (const nextV of neighbors) {
          if (nextV === startV1 && loop.length > 2) {
            foundNext = true;
            maxIters = -1; // Force break while
            break;
          }
        }
      }

      if (maxIters === -1) break; // Closed loop

      if (!foundNext) {
        break;
      }
    }

    if (loop.length < 3) {
      console.log(`[FillHole] Traced loop too short: ${loop.length}`);
      return false;
    }

    console.log(`[FillHole] Traced loop length: ${loop.length}`);

    const vertices = mesh.getVertices();
    let newVertices = vertices;
    const newFaces = [];
    const oldFaces = mesh.getFaces();
    for (let i = 0; i < oldFaces.length; i++) {
        newFaces.push(oldFaces[i]);
    }

    if (loop.length === 3) {
      newFaces.push(loop[0]);
      newFaces.push(loop[1]);
      newFaces.push(loop[2]);
      newFaces.push(Utils.TRI_INDEX);
    } else if (loop.length === 4) {
      newFaces.push(loop[0]);
      newFaces.push(loop[1]);
      newFaces.push(loop[2]);
      newFaces.push(loop[3]);
    } else if (loop.length % 2 === 0) {
      // General Grid Splitting for even holes.
      // For any MxN grid missing (Perimeter P = 2M + 2N), we can determine dimensions and place interior vertices.
      // Let's project into the local best-fit 2D plane (using average normal).
      const nextVertIdx = vertices.length / 3;

      let cx = 0, cy = 0, cz = 0;
      for (const vIdx of loop) {
        cx += vertices[vIdx * 3];
        cy += vertices[vIdx * 3 + 1];
        cz += vertices[vIdx * 3 + 2];
      }
      cx /= loop.length;
      cy /= loop.length;
      cz /= loop.length;

      // Find average normal of loop (approximate)
      let nx = 0, ny = 0, nz = 0;
      for (let i = 0; i < loop.length; ++i) {
        const iNext = loop[(i + 1) % loop.length];
        const vCurr = loop[i];
        
        // Find adjacent face normals sharing this edge? No, just use cross product of vCurr-Center and vNext-Center
        const v1x = vertices[vCurr * 3] - cx;
        const v1y = vertices[vCurr * 3 + 1] - cy;
        const v1z = vertices[vCurr * 3 + 2] - cz;

        const v2x = vertices[iNext * 3] - cx;
        const v2y = vertices[iNext * 3 + 1] - cy;
        const v2z = vertices[iNext * 3 + 2] - cz;

        nx += v1y * v2z - v1z * v2y;
        ny += v1z * v2x - v1x * v2z;
        nz += v1x * v2y - v1y * v2x;
      }

      const lNormal = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (lNormal > 0) {
        nx /= lNormal;
        ny /= lNormal;
        nz /= lNormal;
      } else {
        nz = 1.0; // Fallback
      }

      // Find local basis tangent (u) and bitangent (v)
      // Use the first edge of the loop to align the tangent axis with the hole's grid!
      const v0Idx = loop[0];
      const v1Idx = loop[1];
      let ux = vertices[v1Idx * 3] - vertices[v0Idx * 3];
      let uy = vertices[v1Idx * 3 + 1] - vertices[v0Idx * 3 + 1];
      let uz = vertices[v1Idx * 3 + 2] - vertices[v0Idx * 3 + 2];
      
      // Orthonormalize u with n
      const dotUN = ux * nx + uy * ny + uz * nz;
      ux -= dotUN * nx;
      uy -= dotUN * ny;
      uz -= dotUN * nz;
      const lU = Math.sqrt(ux * ux + uy * uy + uz * uz);
      if (lU > 0) {
        ux /= lU; uy /= lU; uz /= lU;
      } else {
        ux = 1; uy = 0; uz = 0;
      }

      const vx = ny * uz - nz * uy;
      const vy = nz * ux - nx * uz;
      const vz = nx * uy - ny * ux;

      // Project boundary points into 2D (u, v)
      const pts2D = [];
      for (const vIdx of loop) {
        const dx = vertices[vIdx * 3] - cx;
        const dy = vertices[vIdx * 3 + 1] - cy;
        const dz = vertices[vIdx * 3 + 2] - cz;

        pts2D.push({
          u: dx * ux + dy * uy + dz * uz,
          v: dx * vx + dy * vy + dz * vz,
          vIdx: vIdx
        });
      }

      // Compute signed area to check orientation (we need counter-clockwise)
      let area = 0;
      for (let i = 0; i < loop.length; ++i) {
        const pt1 = pts2D.find(p => p.vIdx === loop[i]);
        const pt2 = pts2D.find(p => p.vIdx === loop[(i + 1) % loop.length]);
        if (pt1 && pt2) {
          area += pt1.u * pt2.v - pt2.u * pt1.v;
        }
      }

      if (area < 0) {
        console.log("[FillHole] Reversing loop to ensure counter-clockwise orientation");
        loop.reverse();
      }

      // Find bboxes in 2D
      let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
      for (const pt of pts2D) {
        minU = Math.min(minU, pt.u);
        maxU = Math.max(maxU, pt.u);
        minV = Math.min(minV, pt.v);
        maxV = Math.max(maxV, pt.v);
      }

      const P = loop.length;

      // Unified corner detection using 2D projection (absolute bottom-left)
      // We must re-eval after potential reverse!
      let bestDist = Infinity;
      let bestIdx = -1;
      for (let i = 0; i < P; ++i) {
        const pt = pts2D.find(p => p.vIdx === loop[i]);
        if (pt) {
          const d = pt.u + pt.v;
          if (d < bestDist) {
            bestDist = d;
            bestIdx = i;
          }
        }
      }
      if (bestIdx === -1) bestIdx = 0;

      const b = [];
      for (let i = 0; i < P; ++i) b.push(loop[(bestIdx + i) % P]);

      // Find corners by analyzing 2D angles in projection!
      // Dot product of edges pointing away from vertex.
      // Corners (~90 deg) will have dot product close to 0.
      // Straight edges (~180 deg) will have dot product close to -1.
      const getAngle2D = (idx) => {
        const ptPrev = pts2D.find(p => p.vIdx === b[(idx + P - 1) % P]);
        const ptCurr = pts2D.find(p => p.vIdx === b[idx]);
        const ptNext = pts2D.find(p => p.vIdx === b[(idx + 1) % P]);
        
        if (!ptPrev || !ptCurr || !ptNext) return -1;
        
        const v1u = ptPrev.u - ptCurr.u;
        const v1v = ptPrev.v - ptCurr.v;
        const v2u = ptNext.u - ptCurr.u;
        const v2v = ptNext.v - ptCurr.v;
        
        const l1 = Math.sqrt(v1u * v1u + v1v * v1v);
        const l2 = Math.sqrt(v2u * v2u + v2v * v2v);
        
        if (l1 === 0 || l2 === 0) return -1;
        
        return (v1u * v2u + v1v * v2v) / (l1 * l2);
      };

      const cornerIndices = [];
      for (let i = 0; i < P; ++i) {
        const dot = getAngle2D(i);
        if (dot > -0.5) { // Angle less than ~120 degrees
          cornerIndices.push(i);
        }
      }

      let M = 2; // Default fallbacks
      let N = P / 2 - M;

      if (cornerIndices.length === 4) {
        M = (cornerIndices[1] - cornerIndices[0] + P) % P;
        N = (cornerIndices[2] - cornerIndices[1] + P) % P;
        console.log(`[FillHole] Topologically detected grid dimensions via corners: ${M} x ${N}`);
      } else {
        console.log(`[FillHole] Failed to find 4 sharp corners (found ${cornerIndices.length}). Falling back to max U search.`);
        let maxUVal = -Infinity;
        let maxUIdx = -1;
        for (let i = 0; i < P; ++i) {
          const pt = pts2D.find(p => p.vIdx === b[i]);
          if (pt && pt.u > maxUVal) {
            maxUVal = pt.u;
            maxUIdx = i;
          }
        }
        M = maxUIdx;
        if (M < 1) M = 1;
        if (M >= P / 2) M = P / 2 - 1;
        N = P / 2 - M;
      }

      console.log(`[FillHole] Resolved grid dimensions: ${M} x ${N}`);

      if (M === 1 || N === 1) {
        console.log("[FillHole] Strip detected (1D), executing Strip-Slicing...");
        const K = Math.max(M, N); // The length of the strip
        
        // Ensure b starts with the LONG side!
        // If M=1, b starts with a short side (length 1). Rotate by 1 to start with long side.
        if (M === 1 && N > 1) {
          const rotated = [];
          for (let i = 0; i < P; ++i) rotated.push(b[(i + 1) % P]);
          b.length = 0;
          b.push(...rotated);
        }

        // Now b traces the Long side (K segments), then short side (1 segment), then Long side (K segments), then short side (1 segment).
        for (let i = 0; i < K; ++i) {
          const v00 = b[i];
          const v10 = b[i + 1];
          const v11 = b[P - 2 - i];
          const v01 = b[P - 1 - i];

          newFaces.push(v00, v10, v11, v01);
        }
      } else {
        const addVerticesCount = (M - 1) * (N - 1);
        newVertices = new Float32Array(vertices.length + addVerticesCount * 3);
        newVertices.set(vertices);

        // Compute bounding box dimensions in 2D to scale interior vertices!
        let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
        for (const pt of pts2D) {
          minU = Math.min(minU, pt.u);
          maxU = Math.max(maxU, pt.u);
          minV = Math.min(minV, pt.v);
          maxV = Math.max(maxV, pt.v);
        }
        const wU = maxU - minU;
        const wV = maxV - minV;

        // Int vertex index mapping: intVertices[j-1][i-1] is nextVertIdx + (j-1)*(M-1) + (i-1)
        const getIntVIdx = (i, j) => nextVertIdx + (j - 1) * (M - 1) + (i - 1);

        for (let j = 1; j < N; ++j) {
          for (let i = 1; i < M; ++i) {
            const vIdx = getIntVIdx(i, j);
            const uNorm = i / M - 0.5;
            const vNorm = j / N - 0.5;

            newVertices[vIdx * 3] = cx + uNorm * wU * ux + vNorm * wV * vx;
            newVertices[vIdx * 3 + 1] = cy + uNorm * wU * uy + vNorm * wV * vy;
            newVertices[vIdx * 3 + 2] = cz + uNorm * wU * uz + vNorm * wV * vz;
          }
        }

        const getVIdxAt = (i, j) => {
          if (i > 0 && i < M && j > 0 && j < N) return getIntVIdx(i, j); // Interior
          // Boundary
          if (j === 0) return b[i];
          if (i === M) return b[M + j];
          if (j === N) return b[M + N + (M - i)];
          if (i === 0) return b[M + N + M + (N - j)];
          return b[0];
        };

        // Wire M x N quads!
        for (let j = 0; j < N; ++j) {
          for (let i = 0; i < M; ++i) {
            const v00 = getVIdxAt(i, j);
            const v10 = getVIdxAt(i + 1, j);
            const v11 = getVIdxAt(i + 1, j + 1);
            const v01 = getVIdxAt(i, j + 1);

            newFaces.push(v00, v10, v11, v01);
          }
        }
      }
    } else {
      // Fan fill for odd-length large holes (5, 7, 9 vertices)
      const nextVertIdx = vertices.length / 3;
      
      let cx = 0, cy = 0, cz = 0;
      for (const vIdx of loop) {
        cx += vertices[vIdx * 3];
        cy += vertices[vIdx * 3 + 1];
        cz += vertices[vIdx * 3 + 2];
      }
      cx /= loop.length;
      cy /= loop.length;
      cz /= loop.length;

      newVertices = new Float32Array(vertices.length + 3);
      newVertices.set(vertices);
      newVertices[nextVertIdx * 3] = cx;
      newVertices[nextVertIdx * 3 + 1] = cy;
      newVertices[nextVertIdx * 3 + 2] = cz;

      for (let i = 0; i < loop.length; i++) {
        const vA = loop[i];
        const vB = loop[(i + 1) % loop.length];

        newFaces.push(vA);
        newFaces.push(vB);
        newFaces.push(nextVertIdx);
        newFaces.push(Utils.TRI_INDEX);
      }
    }

    const typedFaces = new Uint32Array(newFaces);
    
    const prevMesh = this.getMesh();
    const activeMesh = prevMesh.getCurrentMesh ? prevMesh.getCurrentMesh() : prevMesh;

    console.log("[FillHole] Capturing undo snapshot...");
    const undoSnapshot = this.captureMeshSnapshot(activeMesh);

    // Set new state
    activeMesh.setVertices(newVertices);
    activeMesh.setNbVertices(newVertices.length / 3);
    activeMesh.setFaces(typedFaces);
    activeMesh.setNbFaces(typedFaces.length / 4);
    
    if (activeMesh.getColors()) {
      const oldColors = activeMesh.getColors();
      if (newVertices.length > oldColors.length) {
        const newColors = new Float32Array(newVertices.length);
        newColors.set(oldColors);
        for (let i = oldColors.length; i < newColors.length; i += 3) {
          newColors[i] = 1.0;
          newColors[i + 1] = 1.0;
          newColors[i + 2] = 1.0;
        }
        activeMesh.setColors(newColors);
      }
    }
    if (activeMesh.getMaterials()) {
      const oldMats = activeMesh.getMaterials();
      if (newVertices.length > oldMats.length) {
        const newMats = new Float32Array(newVertices.length);
        newMats.set(oldMats);
        for (let i = oldMats.length; i < newMats.length; i += 3) {
          newMats[i] = 0.5; // Default roughness
          newMats[i + 1] = 0.5; // Default metalness
          newMats[i + 2] = 1.0;
        }
        activeMesh.setMaterials(newMats);
      }
    }

    // Handle UVs if present
    const facesTexCoord = activeMesh.getFacesTexCoord();
    if (facesTexCoord) {
      const newFacesTexCoord = new Uint32Array(typedFaces.length);
      newFacesTexCoord.set(facesTexCoord); // Copy old ones
      // Leave the rest as 0 (dummy UVs for new faces)
      activeMesh.setFacesTexCoord(newFacesTexCoord);

      // Also resize texCoordsST if we added vertices!
      // Otherwise allocateArrays will crash due to mismatch between nbTexCoords and nbVertices!
      const texCoordsST = activeMesh.getTexCoords();
      const numNewVerts = (newVertices.length - vertices.length) / 3;
      if (texCoordsST && numNewVerts > 0) {
        console.log(`[FillHole] Resizing texCoordsST by ${numNewVerts} elements`);
        const newTexCoordsST = new Float32Array(texCoordsST.length + numNewVerts * 2);
        newTexCoordsST.set(texCoordsST);
        activeMesh.setTexCoords(newTexCoordsST);
      }
    }

    activeMesh.allocateArrays();
    activeMesh.initTopology();
    activeMesh.updateGeometry();
    activeMesh.updateCenter();
    
    if (activeMesh._renderData)
      activeMesh.updateDuplicateColorsAndMaterials();
    activeMesh.updateBuffers();

    const redoSnapshot = this.captureMeshSnapshot(activeMesh);

    this._main.getStateManager().pushStateCustom(
      () => this.applyMeshSnapshot(activeMesh, undoSnapshot),
      () => this.applyMeshSnapshot(activeMesh, redoSnapshot)
    );

    return true;
  }

  stroke(picking) {
    // No-op for continuous stroke
  }
}

export default FillHole;
