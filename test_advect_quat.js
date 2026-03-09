const radius = 25.0;
const tx = 0.0, ty=0.0, tz=0.0;
let rotation = [0, 0, 0.70710678, 0.70710678]; // 90 deg rotation around Z
let rx2 = -rotation[0], ry2 = -rotation[1], rz2 = -rotation[2], rw2 = rotation[3]; // INVERSE QUAT

let cx = 0, cy = 0, cz = 0;

function falloff(dist) {
  if (dist >= 1.0) return 0.0;
  var f = dist * dist;
  f = 3.0 * f * f - 4.0 * f * dist + 1.0;
  return f; 
}

// grid coordinate (rotated point)
let px = 0; let py = 10; let pz = 0;

var px_iter = px, py_iter = py, pz_iter = pz;
for (var iter = 0; iter < 5; iter++) {
  // src distance from center
  var dx = px_iter - cx;
  var dy = py_iter - cy;
  var dz = pz_iter - cz;
  var dist = Math.sqrt(dx*dx + dy*dy + dz*dz) / radius;
  
  if (dist >= 1.0) {
     px_iter = px; py_iter = py; pz_iter = pz;
  } else {
     var f = falloff(dist);
     var offX = 0, offY = 0, offZ = 0;
     
     // Inverse Rotation applied to offset:
     // If we rotate forward by Q, to find source we rotate backward by Q^-1
     var vTemp = [dx, dy, dz];
     
     var ix = rw2 * vTemp[0] + ry2 * vTemp[2] - rz2 * vTemp[1];
     var iy = rw2 * vTemp[1] + rz2 * vTemp[0] - rx2 * vTemp[2];
     var iz = rw2 * vTemp[2] + rx2 * vTemp[1] - ry2 * vTemp[0];
     var iw = -rx2 * vTemp[0] - ry2 * vTemp[1] - rz2 * vTemp[2];
     vTemp[0] = ix * rw2 + iw * -rx2 + iy * -rz2 - iz * -ry2;
     vTemp[1] = iy * rw2 + iw * -ry2 + iz * -rx2 - ix * -rz2;
     vTemp[2] = iz * rw2 + iw * -rz2 + ix * -ry2 - iy * -rx2;
     
     // We want the difference between original relative pos and rotated pos
     offX += (dx - vTemp[0]) * f;
     offY += (dy - vTemp[1]) * f;
     offZ += (dz - vTemp[2]) * f;
     
     // Inverse translation:
     offX += tx * f;
     offY += ty * f;
     offZ += tz * f;
     
     px_iter = px - offX;
     py_iter = py - offY;
     pz_iter = pz - offZ;
  }
}

console.log(`Original Grid point: ${px}, ${py}, ${pz}`);
console.log(`Computed Source point: ${px_iter}, ${py_iter}, ${pz_iter}`);
