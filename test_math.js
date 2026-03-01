function s(mat, scale) {
  const out = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
  out[0]=mat[0]*scale; out[1]=mat[1]*scale; out[2]=mat[2]*scale; out[3]=mat[3]*scale;
  out[4]=mat[4]*scale; out[5]=mat[5]*scale; out[6]=mat[6]*scale; out[7]=mat[7]*scale;
  out[8]=mat[8]*scale; out[9]=mat[9]*scale; out[10]=mat[10]*scale; out[11]=mat[11]*scale;
  out[12]=mat[12]; out[13]=mat[13]; out[14]=mat[14]; out[15]=mat[15];
  return out;
}
function t(mat, vec) {
  const out = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
  for(let i=0;i<16;i++) out[i]=mat[i];
  out[12] += out[0]*vec[0] + out[4]*vec[1] + out[8]*vec[2];
  out[13] += out[1]*vec[0] + out[5]*vec[1] + out[9]*vec[2];
  out[14] += out[2]*vec[0] + out[6]*vec[1] + out[10]*vec[2];
  return out;
}

function mulMat(a, b) {
  const out = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
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

const liveDesktopView = id();
liveDesktopView[12] = 0.74928;
liveDesktopView[13] = -19.01296;
liveDesktopView[14] = 136.52619;

const physicalPan = [0.04139, 2.18596, -0.75498];
const bakedScale = 0.008;
const vs = 0.01852;
const relScale = vs / bakedScale;

const relativeScaleMat = s(id(), relScale);
const panPosMat = t(id(), [physicalPan[0], physicalPan[1], physicalPan[2]]);

let specv201 = mulMat(liveDesktopView, panPosMat);
specv201 = mulMat(specv201, relativeScaleMat);
console.log("v0.8.201 base (without 125x magnification!): Y=", specv201[13].toFixed(2));

