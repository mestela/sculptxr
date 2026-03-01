// Custom Math Fallback to test pipeline outputs
function s(mat, scale) {
  for (let i = 0; i < 12; i++) mat[i] *= scale;
  return mat;
}
function t(mat, vec) {
  mat[12] += mat[0]*vec[0] + mat[4]*vec[1] + mat[8]*vec[2];
  mat[13] += mat[1]*vec[0] + mat[5]*vec[1] + mat[9]*vec[2];
  mat[14] += mat[2]*vec[0] + mat[6]*vec[1] + mat[10]*vec[2];
  return mat;
}

// Function to multiply matrices (A * B) -> out
function mulMat(a, b) {
  const out = id();
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
  const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
  const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

  let b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
  out[0] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

  b0 = b[4]; b1 = b[5]; b2 = b[6]; b3 = b[7];
  out[4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[5] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[6] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[7] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

  b0 = b[8]; b1 = b[9]; b2 = b[10]; b3 = b[11];
  out[8] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[9] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[10] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[11] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

  b0 = b[12]; b1 = b[13]; b2 = b[14]; b3 = b[15];
  out[12] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[13] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[14] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[15] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  return out;
}

function id() { return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]; }

// liveDesktopView from defaultCameraState (only translation part)
const liveDesktopView = id();
liveDesktopView[12] = 0.74928;
liveDesktopView[13] = -19.01296;
liveDesktopView[14] = 136.52619;


const defaultWorldState = {
  vrScale: 0.01852,
  pos: [0.04139, 2.18596, -0.75498],
  rot: [-0.08611, -0.03591, -0.05106, 0.99433]
};
const bakedScale = 0.008;


const vs = defaultWorldState.vrScale;
const invS = 1.0 / vs;

const relScale = vs / bakedScale;
const relativeScaleMat = s(id(), relScale);

const scaledPanPos = t(id(), [defaultWorldState.pos[0]*invS, defaultWorldState.pos[1]*invS, defaultWorldState.pos[2]*invS]);
const invScaledPanPos = t(id(), [-defaultWorldState.pos[0]*invS, -defaultWorldState.pos[1]*invS, -defaultWorldState.pos[2]*invS]);

// What if the correct translation is invWorldMat for the world offsets?
// worldMat conceptually represents the absolute offset.
// So worldMat = Rotation * Translation.
// invWorldMat = invPan * invRot

// Currently, specView = liveDesktopView * invScaledPanPos * relativeScaleMat (Rotation ignored for this simple test)

// Let's test specView4: Desktop camera should just take the invWorldMat natively.
// We know `worldMat` in the codebase is derived as translation THEN rotation, then inverted.
// Let's print out what `invWorldMat` looks like purely using translations to see if they match the desired offset.
let specView4 = mulMat(liveDesktopView, invScaledPanPos);
specView4 = mulMat(specView4, relativeScaleMat);

console.log("Current SpecView:", [specView4[12].toFixed(2), specView4[13].toFixed(2), specView4[14].toFixed(2)]);

// If the sculpt is "too high and too small", maybe relScale is backwards.
const invRelScale = bakedScale / vs;
const relativeScaleMatInv = s(id(), invRelScale);

let specView5 = mulMat(liveDesktopView, invScaledPanPos);
specView5 = mulMat(specView5, relativeScaleMatInv);

console.log("Inverted Scale SpecView:", [specView5[12].toFixed(2), specView5[13].toFixed(2), specView5[14].toFixed(2)]);
