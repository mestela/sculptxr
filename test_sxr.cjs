const fs = require('fs');

const buffer = fs.readFileSync('/Users/mattestela/Downloads/yourMesh_20260414_1637.sxr');
const u32a = new Uint32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4);
const f32a = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4);

let off = 0;
const version = u32a[off++];
console.log("VERSION:", version);

// skip global options
off += 3;
off += 4; // camera projection, mode, fov, usePivot
const nbMeshes = u32a[off++];
console.log("NB MESHES:", nbMeshes);

for (let i = 0; i < nbMeshes; i++) {
    const isMulti = u32a[off++];
    console.log("MESH " + i + " isMulti:", isMulti);
    
    let numLevels = 1;
    if (isMulti) {
        numLevels = u32a[off++];
        off++; // skip _sel
    }
    
    console.log("Num Levels:", numLevels);
    
    for (let L = 0; L < numLevels; L++) {
        console.log("\n--- Level", L, "---");
        off += 4; // shader, matcap, wireframe, flat
        off += 1; // opacity
        off += 3; // center
        off += 16; // matrix
        off += 1; // scale
        
        const nbVerts = u32a[off++];
        console.log("  nbVertices:", nbVerts);
        
        const verts = f32a.subarray(off, off + nbVerts * 3);
        off += nbVerts * 3;
        
        // Print first 4 verts
        console.log(`  V0: [${verts[0]}, ${verts[1]}, ${verts[2]}]`);
        console.log(`  V1: [${verts[3]}, ${verts[4]}, ${verts[5]}]`);

        const hasColors = u32a[off++];
        if (hasColors > 0) off += nbVerts * 3;

        const hasMats = u32a[off++];
        if (hasMats > 0) off += nbVerts * 3;

        const nbFaces = u32a[off++];
        console.log("  nbFaces:", nbFaces);
        
        const faces = u32a.subarray(off, off + nbFaces * 4);
        off += nbFaces * 4;

        // Print first 4 faces
        console.log(`  F0: (${faces[0]}, ${faces[1]}, ${faces[2]}, ${faces[3]})`);
        console.log(`  F1: (${faces[4]}, ${faces[5]}, ${faces[6]}, ${faces[7]})`);
        
        const nbTexCoords = u32a[off++];
        if (nbTexCoords > 0) {
            off += nbTexCoords * 2;
        }
        
        const nbFacesUV = u32a[off++]; // THIS WAS MISSING BEFORE!
        if (nbFacesUV > 0) {
            off += nbFacesUV * 4;
        }
        
        // skip label
        off += 16;
    }
}
