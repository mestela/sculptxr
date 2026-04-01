import Utils from '../misc/Utils.js';

export default function fillHoles(mesh) {
    const vertices = mesh.getVertices();
    const faces = mesh.getFaces(); // 4-padded array mixture of quads/tris

    console.log(`[HoleFilling] Reading native mesh topology...`);
    const feAr = mesh.getFaceEdges ? mesh.getFaceEdges() : null;
    const eAr = mesh.getEdges ? mesh.getEdges() : null;

    if (!feAr || !eAr) {
        console.error("[HoleFilling] Native topology arrays missing!");
        return null;
    }

    const boundEdges = [];
    const adj = new Map();

    const addBoundEdge = (v1, v2) => {
        adj.set(v1, v2); // Winding should be correct if it's open edge and we want to loop it!
    };

    for (let i = 0; i < faces.length; i += 4) {
        const v0 = faces[i];
        const v1 = faces[i+1];
        const v2 = faces[i+2];
        const v3 = faces[i+3];

        if (eAr[feAr[i]] === 1) addBoundEdge(v1, v0); // Inverse winding of face is the hole!
        if (eAr[feAr[i+1]] === 1) addBoundEdge(v2, v1);
        
        if (v3 === Utils.TRI_INDEX) {
            if (eAr[feAr[i+2]] === 1) addBoundEdge(v0, v2);
        } else {
            if (eAr[feAr[i+2]] === 1) addBoundEdge(v3, v2);
            if (eAr[feAr[i+3]] === 1) addBoundEdge(v0, v3);
        }
    }

    if (adj.size === 0) {
        console.log("[HoleFilling] Found 0 open edges natively.");
        return null;
    }

    console.log(`[HoleFilling] Found ${adj.size} open edges natively.`);

    // 3. Chain loops
    const visited = new Set();
    const loops = [];

    for (const start of adj.keys()) {
        if (visited.has(start)) continue;

        const loop = [];
        let curr = start;
        loop.push(curr);
        visited.add(curr);

        let maxIterations = 50000; // Safeguard against infinite loops
        while (adj.has(curr) && maxIterations-- > 0) {
            const next = adj.get(curr);
            if (next === start) {
                loops.push(loop);
                break;
            }
            if (!next || visited.has(next)) {
                // Intersecting/Self-intersecting hole or non-manifold branch! 
                loops.push(loop); // Close it anyway
                break;
            }
            loop.push(next);
            visited.add(next);
            curr = next;
        }
    }

    console.log(`[HoleFilling] Resolved ${loops.length} separate loops.`);

    if (loops.length === 0) return null;

    // 4. Create new faces (fan fill)
    const newVertices = new Float32Array(vertices.length + loops.length * 3);
    newVertices.set(vertices);

    const newFaces = [];
    for (let i = 0; i < faces.length; i++) {
        newFaces.push(faces[i]);
    }

    let nextVertIdx = vertices.length / 3;

    for (const loop of loops) {
        if (loop.length < 3) continue;

        // Calculate center of loop
        let cx = 0, cy = 0, cz = 0;
        for (const vIdx of loop) {
            cx += vertices[vIdx * 3];
            cy += vertices[vIdx * 3 + 1];
            cz += vertices[vIdx * 3 + 2];
        }
        cx /= loop.length;
        cy /= loop.length;
        cz /= loop.length;

        newVertices[nextVertIdx * 3] = cx;
        newVertices[nextVertIdx * 3 + 1] = cy;
        newVertices[nextVertIdx * 3 + 2] = cz;

        const centerId = nextVertIdx++;

        for (let i = 0; i < loop.length; i++) {
            const v1 = loop[i];
            const v2 = loop[(i + 1) % loop.length];

            newFaces.push(v1);
            newFaces.push(v2);
            newFaces.push(centerId);
            newFaces.push(Utils.TRI_INDEX); // Pad to 4
        }
    }

    const typedFaces = new Uint32Array(newFaces);
    return { vertices: newVertices, faces: typedFaces };
}
