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
      return false;
    }

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
    } else if (loop.length === 8) {
      // 8-vertex hole. We need to find the orientation to prevent degenerate quads!
      // A clean 2x2 hole has alternating angles: Corner (90 deg), Mid (180 deg).
      // We partition them into: Mid_A, Corner, Mid_B, Center to form a clean quad!
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

      // Let's analyze curvature along the loop to find corners.
      // angle between (v_i-1 - v_i) and (v_i+1 - v_i).
      const getAngle = (i) => {
        const iPrev = loop[(i + 7) % 8];
        const iCurr = loop[i];
        const iNext = loop[(i + 1) % 8];

        const v1x = vertices[iPrev * 3] - vertices[iCurr * 3];
        const v1y = vertices[iPrev * 3 + 1] - vertices[iCurr * 3 + 1];
        const v1z = vertices[iPrev * 3 + 2] - vertices[iCurr * 3 + 2];

        const v2x = vertices[iNext * 3] - vertices[iCurr * 3];
        const v2y = vertices[iNext * 3 + 1] - vertices[iCurr * 3 + 1];
        const v2z = vertices[iNext * 3 + 2] - vertices[iCurr * 3 + 2];

        const l1 = Math.sqrt(v1x * v1x + v1y * v1y + v1z * v1z);
        const l2 = Math.sqrt(v2x * v2x + v2y * v2y + v2z * v2z);

        if (l1 === 0 || l2 === 0) return 0; // Prevent div by zero

        const n1x = v1x / l1;
        const n1y = v1y / l1;
        const n1z = v1z / l1;

        const n2x = v2x / l2;
        const n2y = v2y / l2;
        const n2z = v2z / l2;

        const d = n1x * n2x + n1y * n2y + n1z * n2z;
        return Math.acos(Math.max(-1.0, Math.min(1.0, d)));
      };

      const angles = [];
      for (let i = 0; i < 8; ++i) {
        const a = getAngle(i);
        
        angles.push(a);
      }

      let firstCornerIdx = -1;
      for (let i = 0; i < 8; ++i) {
        if (angles[i] < 2.3) { 
          firstCornerIdx = i;
          break;
        }
      }

      if (firstCornerIdx === -1) firstCornerIdx = 0; // Fallback

      

      // 4-quad weave. A quad is (MidA, Corner, MidB, Center)
      // If firstCornerIdx is a corner, then firstCornerIdx+1 is a mid, firstCornerIdx+2 is a corner, etc.
      for (let i = 0; i < 4; ++i) {
        const cornerIdx = (firstCornerIdx + i * 2) % 8;
        const midA = (cornerIdx + 7) % 8;
        const midB = (cornerIdx + 1) % 8;

        newFaces.push(loop[midA]);
        newFaces.push(loop[cornerIdx]);
        newFaces.push(loop[midB]);
        newFaces.push(nextVertIdx);
      }

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
      let ux = 1, uy = 0, uz = 0;
      if (Math.abs(nx) > 0.9) {
        ux = 0; uy = 1; uz = 0;
      }
      // Orthonormalize u with n
      const dotUN = ux * nx + uy * ny + uz * nz;
      ux -= dotUN * nx;
      uy -= dotUN * ny;
      uz -= dotUN * nz;
      const lU = Math.sqrt(ux * ux + uy * uy + uz * uz);
      ux /= lU; uy /= lU; uz /= lU;

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

      // Find bboxes in 2D
      let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
      for (const pt of pts2D) {
        minU = Math.min(minU, pt.u);
        maxU = Math.max(maxU, pt.u);
        minV = Math.min(minV, pt.v);
        maxV = Math.max(maxV, pt.v);
      }

      const wU = maxU - minU;
      const wV = maxV - minV;

      

      // Determine dimensions (MxN). Perimeter P = loop.length. 
      const P = loop.length;
      let M = 1;
      let bestErr = Infinity;
      for (let m = 1; m < P / 2; ++m) {
        const n = P / 2 - m;
        const ratio = m / n;
        const targetRatio = wU / wV;
        const err = Math.abs(ratio - targetRatio);
        if (err < bestErr) {
          bestErr = err;
          M = m;
        }
      }
      let N = P / 2 - M;

      console.log(`[FillHole] Resolved grid dimensions: ${M} x ${N}`);

      if (M === 1 || N === 1) {
        console.log("[FillHole] Strip detected (1D), executing Strip-Slicing (bisecting opposite vertices)...");
        // For a strip of size K (Perimeter length P = 2K + 2), we can bisect it by connecting opposite vertices!
        // Opposite vertices live at index distance K + 1.
        // For M=2, P=6. Opposite of 1 is 4. Connected, we split into TWO quads.
        // Example: b0, b1, b2, b3, b4, b5. Connect b1-b4. 
        // Quad 1: b0, b1, b4, b5. Quad 2: b1, b2, b3, b4.
        const K = Math.max(M, N); // The length of the strip
        
        // Let's use the local angle analyzer to find corners just like we did for the grid!
        const getAngleLoop = (idx) => {
          const iPrev = loop[(idx + P - 1) % P];
          const iCurr = loop[idx];
          const iNext = loop[(idx + 1) % P];

          const v1x = vertices[iPrev * 3] - vertices[iCurr * 3];
          const v1y = vertices[iPrev * 3 + 1] - vertices[iCurr * 3 + 1];
          const v1z = vertices[iPrev * 3 + 2] - vertices[iCurr * 3 + 2];

          const v2x = vertices[iNext * 3] - vertices[iCurr * 3];
          const v2y = vertices[iNext * 3 + 1] - vertices[iCurr * 3 + 1];
          const v2z = vertices[iNext * 3 + 2] - vertices[iCurr * 3 + 2];

          const l1 = Math.sqrt(v1x * v1x + v1y * v1y + v1z * v1z);
          const l2 = Math.sqrt(v2x * v2x + v2y * v2y + v2z * v2z);

          if (l1 === 0 || l2 === 0) return 0;

          const n1x = v1x / l1; const n1y = v1y / l1; const n1z = v1z / l1;
          const n2x = v2x / l2; const n2y = v2y / l2; const n2z = v2z / l2;

          const d = n1x * n2x + n1y * n2y + n1z * n2z;
          return Math.acos(Math.max(-1.0, Math.min(1.0, d)));
        };

        const angles = [];
        for (let i = 0; i < P; ++i) angles.push(getAngleLoop(i));

        let firstCornerIdx = -1;
        for (let i = 0; i < P; ++i) {
          if (angles[i] < 2.3) {
            firstCornerIdx = i;
            break;
          }
        }
        if (firstCornerIdx === -1) firstCornerIdx = 0;

        const b = [];
        for (let i = 0; i < P; ++i) b.push(loop[(firstCornerIdx + i) % P]);

        // Now b0 is a corner. Side 1 is length K (segments before next corner) or 1.
        let side1Len = 0;
        for (let i = 1; i < P; ++i) {
          if (angles[(firstCornerIdx + i) % P] < 2.3) {
            side1Len = i;
            break;
          }
        }

        if (side1Len === 1) {
          // If first side is the short side (length 1), let's rotate by another corner to make sure b0 is the corner of the Long side!
          const rotateAmt = side1Len;
          const rotated = [];
          for (let i = 0; i < P; ++i) rotated.push(b[(i + rotateAmt) % P]);
          b.length = 0;
          for (let i = 0; i < P; ++i) b.push(rotated[i]);
        }

        // Now b traces the Long side (K segments to C2), then short side (1 segment to C3), then Long side (K segments to C4), then short side (1 segment to C1).
        // Total points = 2K + 2.
        // We can just iterate through i from 0 to K-1 (the quads!).
        // Quad i has vertices: b[i], b[i+1], b[P - 2 - i], b[P - 1 - i].
        // Let's see: for K=2, P=6. i=0. b0, b1, b4, b5. (Matches b[0], b[1], b[4], b[5]).
        // i=1. b1, b2, b3, b4. (Matches b[1], b[2], b[3], b[4]).
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

        // Curvature analysis to determine corners!
        const getAngleLoop = (idx) => {
          const iPrev = loop[(idx + P - 1) % P];
          const iCurr = loop[idx];
          const iNext = loop[(idx + 1) % P];

          const v1x = vertices[iPrev * 3] - vertices[iCurr * 3];
          const v1y = vertices[iPrev * 3 + 1] - vertices[iCurr * 3 + 1];
          const v1z = vertices[iPrev * 3 + 2] - vertices[iCurr * 3 + 2];

          const v2x = vertices[iNext * 3] - vertices[iCurr * 3];
          const v2y = vertices[iNext * 3 + 1] - vertices[iCurr * 3 + 1];
          const v2z = vertices[iNext * 3 + 2] - vertices[iCurr * 3 + 2];

          const l1 = Math.sqrt(v1x * v1x + v1y * v1y + v1z * v1z);
          const l2 = Math.sqrt(v2x * v2x + v2y * v2y + v2z * v2z);

          if (l1 === 0 || l2 === 0) return 0;

          const n1x = v1x / l1; const n1y = v1y / l1; const n1z = v1z / l1;
          const n2x = v2x / l2; const n2y = v2y / l2; const n2z = v2z / l2;

          const d = n1x * n2x + n1y * n2y + n1z * n2z;
          return Math.acos(Math.max(-1.0, Math.min(1.0, d)));
        };

        const angles = [];
        for (let i = 0; i < P; ++i) angles.push(getAngleLoop(i));

        // Let's find the vertex inpts2D that is closest to some fixed geometric position (e.g. min U, min V).
        // Since we projected into 2D, we can find the point that minimizes (u + v) to get the absolute bottom-left corner!
        let bestDist = Infinity;
        let bestIdx = -1;
        for (let i = 0; i < P; ++i) {
          const pt = pts2D.find(p => p.vIdx === loop[i]);
          if (pt) {
            // Find bottom-left (min u, min v).
            const d = pt.u + pt.v;
            if (d < bestDist) {
              bestDist = d;
              bestIdx = i;
            }
          }
        }
        const b = [];
        for (let i = 0; i < P; ++i) b.push(loop[(bestIdx + i) % P]);

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
    
    // Instantiate nextMesh ONCE during the initial tool execution!
    const prevMesh = this.getMesh();
    const nextMesh = new MeshStatic(this._main._gl);
    
    nextMesh.setVertices(newVertices);
    nextMesh.setNbVertices(newVertices.length / 3);
    nextMesh.setFaces(typedFaces);
    nextMesh.setNbFaces(typedFaces.length / 4);
    
    nextMesh.init();
    nextMesh.initRender();
    
    nextMesh.setMatrix(prevMesh.getMatrix());
    nextMesh.setShaderType(prevMesh.getShaderType());
    if (prevMesh.getShowWireframe) nextMesh.setShowWireframe(prevMesh.getShowWireframe());

    const undoHole = () => {
      this._main.replaceMesh(nextMesh, prevMesh);
    };

    const redoHole = () => {
      this._main.replaceMesh(prevMesh, nextMesh);
    };

    this._main.getStateManager().pushStateCustom(undoHole, redoHole);
    redoHole(); // Apply the edit first time

    return true;
  }

  stroke(picking) {
    // No-op for continuous stroke
  }
}

export default FillHole;
