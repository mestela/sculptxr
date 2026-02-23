// Simple math test for the binary search logic in Geo Symmetry
const assert = require('assert');

// Mock Geometry pointPlaneDistance
const Geometry = {
    pointPlaneDistance: function(v, ptPlane, nPlane) {
        return (v[0] - ptPlane[0])*nPlane[0] + (v[1] - ptPlane[1])*nPlane[1] + (v[2] - ptPlane[2])*nPlane[2];
    },
    mirrorPoint: function(v, ptPlane, nPlane) {
        let dist = this.pointPlaneDistance(v, ptPlane, nPlane);
        v[0] -= 2 * dist * nPlane[0];
        v[1] -= 2 * dist * nPlane[1];
        v[2] -= 2 * dist * nPlane[2];
    }
};

const nbVertices = 6;
// Vertex Pairs:
// Center: [0, 0, 0] (0)
// Left 1: [-10, 0, 0] (1)
// Right 1: [10, 0, 0] (2)
// Left 2: [-5, 5, 0] (3)
// Right 2: [5, 5, 1]  (4) - slightly off Z to test geo snap
// Right Orphan: [20, 0, 0] (5)
const vAr = new Float32Array([
     0, 0, 0,
   -10, 0, 0,
    10, 0, 0,
    -5, 5, 0,
     5, 5, 1,
    20, 0, 0
]);

const ptPlane = [0, 0, 0];
const nPlane = [1, 0, 0];
const radius = 20.0;
const SNAP_RADIUS = radius * 0.1; // 2.0
const SNAP_RADIUS_SQ = SNAP_RADIUS * SNAP_RADIUS;

const map = new Int32Array(nbVertices).fill(-1);
const sides = new Uint8Array(nbVertices);

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

const takenRightDistSq = new Float32Array(nbVertices).fill(Infinity);
const takenOwner = new Int32Array(nbVertices).fill(-1);
const mirrorV = [0.0, 0.0, 0.0];

for (let i = 0; i < nbVertices; ++i) {
    if (map[i] !== -1) continue;

    const i3 = i * 3;
    tempV[0] = vAr[i3];
    tempV[1] = vAr[i3 + 1];
    tempV[2] = vAr[i3 + 2];

    const dist = Geometry.pointPlaneDistance(tempV, ptPlane, nPlane);
    if (dist >= 0) continue;

    mirrorV[0] = tempV[0]; mirrorV[1] = tempV[1]; mirrorV[2] = tempV[2];
    Geometry.mirrorPoint(mirrorV, ptPlane, nPlane);
    const targetDist = -dist;

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
        let bestLocalDistSq = SNAP_RADIUS_SQ;
        let bestLocalId = -1;

        for (let k = startIdx; k < rightCount; ++k) {
            const rSIdx = sortIndices[k];
            const d = rightDist[rSIdx];
            if (d > maxSearch) break;

            const rId = rightSide[rSIdx];
            if (map[rId] !== -1) continue;

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
            const rId = bestLocalId;
            if (bestLocalDistSq < takenRightDistSq[rId]) {
                const prevOwner = takenOwner[rId];
                if (prevOwner !== -1) {
                    map[prevOwner] = -1;
                }
                takenRightDistSq[rId] = bestLocalDistSq;
                takenOwner[rId] = i;
                map[i] = rId;
                map[rId] = i;
            }
        }
    }
}

console.log("Map:");
for (let i = 0; i < nbVertices; ++i) {
    console.log(`Vertex ${i} -> ${map[i]}`);
}
