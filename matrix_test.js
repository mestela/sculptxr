const { mat4, vec3, quat } = require('gl-matrix');

// Mock state representing what the user sets as default
const defaultCameraState = {
  trans: [0.74928, -19.01296, 136.52619],
  quatRot: [0.00000, 0.00000, 0.00000, 1.00000]
};
const defaultWorldState = {
  vrScale: 0.01852,
  pos: [0.04139, 2.18596, -0.75498],
  rot: [-0.08611, -0.03591, -0.05106, 0.99433]
};
const bakedScale = 0.008;

// Assume baked starts at zero for simplicity
const bakedWorldOffset = [0, 0, 0];

// Reconstruct liveDesktopView (from Trackball)
const liveDesktopView = mat4.create();
mat4.fromRotationTranslation(liveDesktopView, defaultCameraState.quatRot, defaultCameraState.trans);

// In STATIONARY, camera doesn't move, so baked == live
const bakedDesktopView = mat4.clone(liveDesktopView);
const invBakedDesktopView = mat4.create();
mat4.invert(invBakedDesktopView, bakedDesktopView);

const vs = defaultWorldState.vrScale;
const invS = 1.0 / vs;

// panRot
const panRot = mat4.create();
mat4.fromQuat(panRot, defaultWorldState.rot);
const invPanRot = mat4.create();
mat4.invert(invPanRot, panRot);

// scaledPanPos
const scaledPanPos = mat4.create();
mat4.fromTranslation(scaledPanPos, [
  defaultWorldState.pos[0] * invS,
  defaultWorldState.pos[1] * invS,
  defaultWorldState.pos[2] * invS
]);
const invScaledPanPos = mat4.create();
mat4.invert(invScaledPanPos, scaledPanPos);

// relativeScaleMat
const relativeScaleMat = mat4.create();
const relScale = vs / bakedScale;
mat4.scale(relativeScaleMat, relativeScaleMat, [relScale, relScale, relScale]);

const specView1 = mat4.create();
mat4.multiply(specView1, liveDesktopView, scaledPanPos);
mat4.multiply(specView1, specView1, panRot);
mat4.multiply(specView1, specView1, relativeScaleMat);

const specView2 = mat4.create();
mat4.multiply(specView2, liveDesktopView, invScaledPanPos);
mat4.multiply(specView2, specView2, invPanRot);
mat4.multiply(specView2, specView2, relativeScaleMat);

console.log("Original virt pipeline trans:", [specView1[12].toFixed(2), specView1[13].toFixed(2), specView1[14].toFixed(2)]);
console.log("Inverted virt pipeline trans:", [specView2[12].toFixed(2), specView2[13].toFixed(2), specView2[14].toFixed(2)]);

