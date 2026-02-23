import { vec3 } from 'gl-matrix';
import Geometry from '../math3d/Geometry.js';
import Utils from '../misc/Utils.js';

class MeshSymmetry {

  constructor(mesh) {
    this._mesh = mesh;
    this._map = null; // Uint32Array: map[i] = pairedIndex (or -1)
    this._mapVersion = -1; // Mesh version when map was computed
    this._isTopo = false; // Flag to indicate if current map is topologically accurate
  }

  isTopo() {
    return this._isTopo;
  }

  getMap() {
    // If mesh version changed (picking/dyntopo), invalidate? 
    // For now, we assume this is called when we want to enforce symmetry.
    // If we want to support Dyntopo, we can't really use this map.
    // So this is strictly for Static topology.
    if (!this._map || this._mapVersion !== this._mesh.getNbVertices()) {
      this.computeSymmetryMap();
    }
    return this._map;
  }

  computeSymmetryMap() {
    // Check Cache
    if (this._map && this._mapVersion === this._mesh.getNbVertices()) {
      return;
    }

    // Initialize Sides buffer
    // 0: Center/Unknown, 1: Left, 2: Right
    if (!this._sides || this._sides.length !== this._mesh.getNbVertices()) {
      this._sides = new Uint8Array(this._mesh.getNbVertices());
    } else {
      this._sides.fill(0);
    }

    // 1. Try Topological Symmetry (Robust for deformed meshes)
    // 2. Fallback to Geometric Symmetry (Robust for Dyntopo / Asymmetric Topology)

    if (this.computeSymmetryMapTopo()) {
      this._isTopo = true;
      return;
    }

    this._isTopo = false;
    this.computeSymmetryMapGeo();
  }

  computeSymmetryMapTopo() {
    const mesh = this._mesh;
    const nbVertices = mesh.getNbVertices();
    const vAr = mesh.getVertices();
    const ptPlane = mesh.getSymmetryOrigin();
    const nPlane = mesh.getSymmetryNormal();

    // Ensure topology data is available
    if (!mesh.getVerticesRingVertStartCount()) {
      mesh.initFaceRings();
      mesh.initVertexRings();
    }
    const vrvStartCount = mesh.getVerticesRingVertStartCount();
    const vertRingVert = mesh.getVerticesRingVert();

    if (!vrvStartCount || !vertRingVert) {
      // console.warn("MeshSymmetry: Topology data not available."); // Removed per diff
      // console.timeEnd('MeshSymmetry: Topo'); // Removed per diff
      return false;
    }

    const map = new Int32Array(nbVertices).fill(-1);
    const visited = new Uint8Array(nbVertices); // 0: unvisited, 1: visited
    const sides = this._sides; // 0: Center, 1: Left, 2: Right

    // 1. Find Center Vertices (Seeds)
    // Vertices strictly ON the plane (or very close)
    const EPSILON = 0.0001;
    const queue = []; // Stores pairs [leftId, rightId]
    const tempV = [0.0, 0.0, 0.0];

    let centerCount = 0;

    for (let i = 0; i < nbVertices; ++i) {
      const i3 = i * 3;
      tempV[0] = vAr[i3];
      tempV[1] = vAr[i3 + 1];
      tempV[2] = vAr[i3 + 2];
      const dist = Geometry.pointPlaneDistance(tempV, ptPlane, nPlane);

      if (Math.abs(dist) < EPSILON) {
        map[i] = i;
        visited[i] = 1;
        sides[i] = 0; // Center
        // Push neighbors as initial seeds?
        // Actually, for "Center" vertices, they are their own pair.
        // We push their neighbors into the queue.
        // A neighbor could be Left or Right.
        // We need to pair neighbors.
        centerCount++;
      }
    }

    if (centerCount === 0) {
      // console.warn("MeshSymmetry: No center vertices found."); // Removed per diff
      // console.timeEnd('MeshSymmetry: Topo'); // Removed per diff
      return false;
    }

    // Seed queue from Center Vertices
    // For each center vertex, check its neighbors.
    // If neighbor A is Left and neighbor B is Right, and they are reflections, pair them.
    // Problem: How do we know which neighbor matches which?
    // We can use Geometric Hinting for the *first* step.

    // Only need one valid pair to start the traversal if the graph is connected.
    // But we might have multiple islands.
    // We should seed from ALL center vertices.

    const mirrorV = [0.0, 0.0, 0.0];

    for (let i = 0; i < nbVertices; ++i) {
      if (map[i] !== i) continue; // Only centers

      const start = vrvStartCount[i * 2];
      const end = start + vrvStartCount[i * 2 + 1];

      for (let j = start; j < end; ++j) {
        const nId = vertRingVert[j];
        if (visited[nId]) continue;

        // Check side
        const n3 = nId * 3;
        tempV[0] = vAr[n3];
        tempV[1] = vAr[n3 + 1];
        tempV[2] = vAr[n3 + 2];
        const dist = Geometry.pointPlaneDistance(tempV, ptPlane, nPlane);

        if (dist < -EPSILON) { // Found a Left neighbor
          // Look for a Right neighbor that matches geometrically
          // We use a lenient geometric match just for seeding
          vec3.copy(mirrorV, tempV);
          Geometry.mirrorPoint(mirrorV, ptPlane, nPlane);

          let bestMatch = -1;
          let bestDistSq = Infinity;

          for (let k = start; k < end; ++k) {
            const candidate = vertRingVert[k];
            if (visited[candidate]) continue; // Already mapped?
            if (candidate === nId) continue;

            const c3 = candidate * 3;
            const dx = vAr[c3] - mirrorV[0];
            const dy = vAr[c3 + 1] - mirrorV[1];
            const dz = vAr[c3 + 2] - mirrorV[2];
            const dSq = dx * dx + dy * dy + dz * dz;

            if (dSq < bestDistSq) {
              bestDistSq = dSq;
              bestMatch = candidate;
            }
          }

          // If we found a reasonable match, seed it
          // Note: The match might be geometrically "far" if deformed, 
          // but for neighbors of center, they are usually close to center.
          // Or maybe we can't assume that?
          // If the user moved a center neighbor far away?
          // Then topological sym might fail to *start*.
          // But usually center seam is preserved.

          if (bestMatch !== -1) { // Accept best match for now?
            // Only if it's on the Right side?
            const c3 = bestMatch * 3;
            tempV[0] = vAr[c3];
            tempV[1] = vAr[c3 + 1];
            tempV[2] = vAr[c3 + 2];
            if (Geometry.pointPlaneDistance(tempV, ptPlane, nPlane) > EPSILON) {
              map[nId] = bestMatch;
              map[bestMatch] = nId;
              visited[nId] = 1;
              visited[bestMatch] = 1;

              sides[nId] = 1; // Left
              sides[bestMatch] = 2; // Right

              queue.push(nId); // Only push Left (or one side) to queue?
              // Actually we queue the pair or just one?
              // We queue the 'Left' ID. We can retrieve the pair from map.
            }
          }
        }
      }
    }

    // BFS Traversal
    let qIndex = 0;
    while (qIndex < queue.length) {
      const uL = queue[qIndex++];
      const uR = map[uL];

      // Traverse neighbors of uL
      const startL = vrvStartCount[uL * 2];
      const endL = startL + vrvStartCount[uL * 2 + 1];

      const startR = vrvStartCount[uR * 2];
      const endR = startR + vrvStartCount[uR * 2 + 1];

      // Neighbors count must match for topology to be symmetric
      if ((endL - startL) !== (endR - startR)) {
        // Topology mismatch at this vertex
        // Proceed? Or abort?
        // If we abort, we fall back to Geo.
        // console.warn(`Topo Mismatch valence: ${uL}(${endL-startL}) vs ${uR}(${endR-startR})`);
        continue;
      }

      // Match neighbors
      // We need to pair neighbors of uL with neighbors of uR
      // We can sort them by some consistent metric?
      // e.g. Angle around the normal? Or distance to something?
      // Or simply "Geometrically closest" among the neighbors?
      // Since neighbors are local, geometric match is usually safe even if mesh is deformed globally.
      // (Unless local deformation is extreme)

      // We'll collect unvisited neighbors and match them
      const neighL = [];
      for (let i = startL; i < endL; ++i) {
        const n = vertRingVert[i];
        if (!visited[n]) neighL.push(n);
      }

      const neighR = [];
      for (let i = startR; i < endR; ++i) {
        const n = vertRingVert[i];
        if (!visited[n]) neighR.push(n);
      }

      // If counts don't match, we have a problem.
      if (neighL.length !== neighR.length) {
        // Already visited some?
        continue;
      }

      // Match lists
      for (let i = 0; i < neighL.length; ++i) {
        const vL = neighL[i];
        const vL3 = vL * 3;

        // Predict mirror
        tempV[0] = vAr[vL3];
        tempV[1] = vAr[vL3 + 1];
        tempV[2] = vAr[vL3 + 2];
        vec3.copy(mirrorV, tempV);
        Geometry.mirrorPoint(mirrorV, ptPlane, nPlane);

        let bestR = -1;
        let bestDistSq = Infinity;

        // Find best match in neighR
        let bestRIndex = -1;

        for (let j = 0; j < neighR.length; ++j) {
          const vR = neighR[j];
          if (vR === -1) continue; // taken

          const vR3 = vR * 3;
          const dx = vAr[vR3] - mirrorV[0];
          const dy = vAr[vR3 + 1] - mirrorV[1];
          const dz = vAr[vR3 + 2] - mirrorV[2];
          const dSq = dx * dx + dy * dy + dz * dz;

          if (dSq < bestDistSq) {
            bestDistSq = dSq;
            bestR = vR;
            bestRIndex = j;
          }
        }

        if (bestR !== -1) {
          map[vL] = bestR;
          map[bestR] = vL;
          visited[vL] = 1;
          visited[bestR] = 1;

          sides[vL] = 1; // Left
          sides[bestR] = 2; // Right

          neighR[bestRIndex] = -1; // Mark taken in this local set
          queue.push(vL);
        }
      }
    }



    // Validation: Check if we mapped enough vertices?
    // If we have unconnected islands, we won't reach them.
    // Count mapped vertices.
    let mapped = 0;
    for (let i = 0; i < nbVertices; ++i) {
      if (map[i] !== -1) mapped++;
    }


    if (mapped < nbVertices * 0.9) { // Threshold?
      return false;
    }

    this._map = map;
    this._mapVersion = nbVertices;
    return true;
  }

  computeSymmetryMapGeo() {
    const mesh = this._mesh;
    const nbVertices = mesh.getNbVertices();
    const vAr = mesh.getVertices();
    const map = new Int32Array(nbVertices).fill(-1);
    const sides = this._sides;

    const ptPlane = mesh.getSymmetryOrigin();
    const nPlane = mesh.getSymmetryNormal();

    // Correct Radius Calculation: 1% of the actual model radius
    // mesh.getScale() is often 1/radius for rendering, so it was unreliable for world-space distance
    const radius = mesh.computeLocalRadius();
    const SNAP_RADIUS = radius * 0.1; // 10% radius as requested (was 1%)

    const SNAP_RADIUS_SQ = SNAP_RADIUS * SNAP_RADIUS;

    // Partition Right Side
    // Use Int32Array to avoid GC
    const rightSide = new Int32Array(nbVertices);
    let rightCount = 0;
    const tempV = [0.0, 0.0, 0.0];

    for (let i = 0; i < nbVertices; ++i) {
      const i3 = i * 3;
      tempV[0] = vAr[i3];
      tempV[1] = vAr[i3 + 1];
      tempV[2] = vAr[i3 + 2];
      const dist = Geometry.pointPlaneDistance(tempV, ptPlane, nPlane);

      if (Math.abs(dist) < 0.0001) {
        map[i] = i;
        sides[i] = 0; // Center
      } else if (dist > 0.0) {
        rightSide[rightCount++] = i;
        sides[i] = 2; // Right
      } else {
        sides[i] = 1; // Left
      }
    }

    // Compute distances for sorting
    const rightDist = new Float32Array(rightCount);
    const sortIndices = new Uint32Array(rightCount);

    for (let k = 0; k < rightCount; ++k) {
      const id = rightSide[k];
      const i3 = id * 3;
      tempV[0] = vAr[i3];
      tempV[1] = vAr[i3 + 1];
      tempV[2] = vAr[i3 + 2];
      rightDist[k] = Geometry.pointPlaneDistance(tempV, ptPlane, nPlane);
      sortIndices[k] = k; // Indirect sort
    }

    sortIndices.sort((a, b) => rightDist[a] - rightDist[b]);

    // "Kickout" buffers to enforce 1-to-1 without massive arrays
    // takenRight stores the BEST (smallest) distance squared found so far for a Right vertex
    // takenOwner stores which Left vertex currently "claims" it
    const takenRightDistSq = new Float32Array(nbVertices).fill(Infinity);
    const takenOwner = new Int32Array(nbVertices).fill(-1);

    const mirrorV = [0.0, 0.0, 0.0];
    let matchedCount = 0;

    // Iterate Left Vertices
    for (let i = 0; i < nbVertices; ++i) {
      if (map[i] !== -1) continue; // Center or already matched

      const i3 = i * 3;
      tempV[0] = vAr[i3];
      tempV[1] = vAr[i3 + 1];
      tempV[2] = vAr[i3 + 2];

      const dist = Geometry.pointPlaneDistance(tempV, ptPlane, nPlane);
      if (dist >= 0) continue; // Skip Right side or Center (already handled)

      vec3.copy(mirrorV, tempV);
      Geometry.mirrorPoint(mirrorV, ptPlane, nPlane);
      const targetDist = -dist;

      // Binary Search
      let left = 0;
      let right = rightCount - 1;
      let startIdx = -1;

      const minSearch = targetDist - SNAP_RADIUS;
      const maxSearch = targetDist + SNAP_RADIUS;

      while (left <= right) {
        const mid = (left + right) >> 1;
        const d = rightDist[sortIndices[mid]];
        if (d >= minSearch) {
          startIdx = mid;
          right = mid - 1;
        } else {
          left = mid + 1;
        }
      }

      if (startIdx !== -1) {
        // Find CLOSEST match for this 'i'
        let bestLocalDistSq = SNAP_RADIUS_SQ;
        let bestLocalId = -1;

        for (let k = startIdx; k < rightCount; ++k) {
          const rSIdx = sortIndices[k];
          const d = rightDist[rSIdx];
          if (d > maxSearch) break;

          const rId = rightSide[rSIdx];
          if (map[rId] !== -1) continue; // Already matched

          const r3 = rId * 3;
          const dx = vAr[r3] - mirrorV[0];
          const dy = vAr[r3 + 1] - mirrorV[1];
          const dz = vAr[r3 + 2] - mirrorV[2];
          const dSq = dx * dx + dy * dy + dz * dz;

          if (dSq < bestLocalDistSq) {
            bestLocalDistSq = dSq;
            bestLocalId = rId;
          }
        }

        if (bestLocalId !== -1) {
          // We found a potential match: 'i' wants 'bestLocalId' with distance 'bestLocalDistSq'
          const rId = bestLocalId;

          // Check if rId is already taken by a BETTER match?
          if (bestLocalDistSq < takenRightDistSq[rId]) {
            // We are better! Kick out previous
            const prevOwner = takenOwner[rId];
            if (prevOwner !== -1) {
              map[prevOwner] = -1; // Orphan the previous owner
              matchedCount--;
            }

            takenRightDistSq[rId] = bestLocalDistSq;
            takenOwner[rId] = i;
            map[i] = rId;
            map[rId] = i;
            matchedCount++;
          }
        }
      }
    }

    this._map = map;
    this._mapVersion = nbVertices;
    this._map = map;
    this._mapVersion = nbVertices;
  }

  symmetrize(direction = 0, undoState = null) {
    this.computeSymmetryMap();

    const map = this._map;
    const sides = this._sides; // Might be undefined if old version?
    const mesh = this._mesh;
    const vAr = mesh.getVertices();
    const ptPlane = mesh.getSymmetryOrigin();
    const nPlane = mesh.getSymmetryNormal();
    const mirrorV = [0.0, 0.0, 0.0];
    const tempV = [0.0, 0.0, 0.0];

    const modifiedVerts = []; // For undo state

    for (let i = 0; i < map.length; ++i) {
      const pairId = map[i];
      if (pairId === -1) continue;

      let processed = false;
      let isSource = false;
      let destId = -1;

      if (pairId === i) {
        // Center vertex: Snap to plane
        destId = i;
        processed = true;
        // Check if actually needs snapping (epsilon check?)
        // Always snap center for robustness

        const i3 = destId * 3;
        tempV[0] = vAr[i3];
        tempV[1] = vAr[i3 + 1];
        tempV[2] = vAr[i3 + 2];
        const dist = Geometry.pointPlaneDistance(tempV, ptPlane, nPlane);

        // If already on plane, skip? 
        if (Math.abs(dist) < 1e-6) continue;

        if (undoState) modifiedVerts.push(destId);

        vAr[i3] -= nPlane[0] * dist;
        vAr[i3 + 1] -= nPlane[1] * dist;
        vAr[i3 + 2] -= nPlane[2] * dist;
        continue;
      }

      // Explicit side check
      const i3 = i * 3;
      if (sides) {
        // Trusted Topology Side
        // 1: Left, 2: Right
        if (direction === 0) { // L->R
          if (sides[i] === 1) isSource = true;
        } else { // R->L
          if (sides[i] === 2) isSource = true;
        }
      } else {
        // Fallback to geometric check
        const dist = Geometry.pointPlaneDistance([vAr[i3], vAr[i3 + 1], vAr[i3 + 2]], ptPlane, nPlane);
        if (direction === 0) { // L->R
          if (dist < 0) isSource = true;
        } else { // R->L
          if (dist > 0) isSource = true;
        }
      }

      if (isSource) {
        destId = pairId;
        const t3 = destId * 3;

        if (undoState) modifiedVerts.push(destId);

        mirrorV[0] = vAr[i3];
        mirrorV[1] = vAr[i3 + 1];
        mirrorV[2] = vAr[i3 + 2];
        Geometry.mirrorPoint(mirrorV, ptPlane, nPlane);

        vAr[t3] = mirrorV[0];
        vAr[t3 + 1] = mirrorV[1];
        vAr[t3 + 2] = mirrorV[2];
      }
    }

    // Push undo state if requested
    if (undoState && modifiedVerts.length > 0) {
      // We pushed change... wait.
      // StateGeometry captures CURRENT vertices.
      // If we modify vAr, then push vertices, StateGeometry captures MODIFIED vertices.
      // This is WRONG for undo.
      // We must push vertices BEFORE modification.
      // But we are modifying in the loop.

      // Solution: Two passes or restore?
      // Or undoState.pushVertices accepts values? No, it reads from mesh.

      // Correct approach:
      // 1. Identify all affected vertices (first pass).
      // 2. undoState.pushVertices(affected).
      // 3. Apply changes (second pass).
      // This is safer.

      // ...Actually, simpler:
      // pushVertices takes an array of indices.
      // StateManager.pushVertices calls getCurrentState().pushVertices(indices).
      // ST.pushVertices reads mesh.getVertices().

      // So we MUST call pushVertices BEFORE modifying mesh.
      console.error("UndoState must be handled before modification!");
    }

    mesh.updateGeometry();
    if (mesh.updateResolution) mesh.updateResolution();
  }

  // New method: getSymmetryDestinations(direction)
  // Returns list of vertex indices that WILL be modified
  getSymmetryDestinations(direction = 0) {
    this.computeSymmetryMap();

    const map = this._map;
    const sides = this._sides;
    const mesh = this._mesh;
    const vAr = mesh.getVertices();
    const ptPlane = mesh.getSymmetryOrigin();
    const nPlane = mesh.getSymmetryNormal();

    const dests = [];

    for (let i = 0; i < map.length; ++i) {
      const pairId = map[i];
      if (pairId === -1) continue;

      if (pairId === i) {
        // Center vertex
        // Check if needs snap
        const i3 = i * 3;
        const dist = Geometry.pointPlaneDistance([vAr[i3], vAr[i3 + 1], vAr[i3 + 2]], ptPlane, nPlane);
        if (Math.abs(dist) > 1e-6) dests.push(i);
        continue;
      }

      let isSource = false;
      if (sides) {
        if (direction === 0) { // L->R
          if (sides[i] === 1) isSource = true;
        } else { // R->L
          if (sides[i] === 2) isSource = true;
        }
      } else {
        const i3 = i * 3;
        const dist = Geometry.pointPlaneDistance([vAr[i3], vAr[i3 + 1], vAr[i3 + 2]], ptPlane, nPlane);
        if (direction === 0) { // L->R
          if (dist < 0) isSource = true;
        } else { // R->L
          if (dist > 0) isSource = true;
        }
      }

      if (isSource) {
        dests.push(pairId);
      }
    }
    return new Uint32Array(dests);
  }

}

export default MeshSymmetry;
