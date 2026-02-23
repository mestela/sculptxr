const { vec3, mat4, quat } = require('gl-matrix');

let vrScale = 1.0;
let pos = vec3.fromValues(0, 1.2, -0.55); // _xrWorldOffset position

// simulate engine mapping
function physicalToEngine(pPhysical) {
    let e = vec3.create();
    vec3.sub(e, pPhysical, pos);
    vec3.scale(e, e, 1.0 / vrScale);
    return e;
}

function engineToPhysical(e) {
    let p = vec3.create();
    vec3.scale(p, e, vrScale);
    vec3.add(p, p, pos);
    return p;
}

let pivot = vec3.fromValues(0, 1.5, -1.0); // some pivot in physical space

console.log("INITIAL:");
console.log("vrScale:", vrScale);
console.log("pos:", pos);
console.log("pivot physical:", pivot);
let ePivot = physicalToEngine(pivot);
console.log("pivot engine:", ePivot);

// scaling by ratio 2.0
let ratio = 2.0;

function scaleWorld_current(r, piv) {
    vrScale *= r;
    let diff = vec3.create();
    vec3.sub(diff, pos, piv);
    vec3.scale(diff, diff, 1.0 / r);
    vec3.add(pos, piv, diff);
}

function scaleWorld_fixed(r, piv) {
    vrScale *= r;
    let diff = vec3.create();
    vec3.sub(diff, pos, piv);
    vec3.scale(diff, diff, r);
    vec3.add(pos, piv, diff);
}

scaleWorld_current(ratio, pivot);
console.log("\nAFTER CURRENT SCALEWORLD (div by ratio):");
console.log("vrScale:", vrScale);
console.log("pos:", pos);
let newP_current = engineToPhysical(ePivot);
console.log("pivot physical (should be unchanged):", newP_current);

// reset and test fixed
vrScale = 1.0;
pos = vec3.fromValues(0, 1.2, -0.55);
scaleWorld_fixed(ratio, pivot);
console.log("\nAFTER FIXED SCALEWORLD (mul by ratio):");
console.log("vrScale:", vrScale);
console.log("pos:", pos);
let newP_fixed = engineToPhysical(ePivot);
console.log("pivot physical (should be unchanged):", newP_fixed);
