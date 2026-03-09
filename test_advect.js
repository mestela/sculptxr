const radius = 25.0;
const tx = 10.0; const ty = 0.0; const tz = 0.0;

function falloff(dist) {
  if (dist >= 1.0) return 0.0;
  var f = dist * dist;
  f = 3.0 * f * f - 4.0 * f * dist + 1.0;
  return f; 
}

// grid coordinate
let px = 10; let py = 0; let pz = 0;
let cx = 0; let cy = 0; let cz = 0;

// current code (VoxelState.js):
var px_iter = px, py_iter = py, pz_iter = pz;
for (var iter = 0; iter < 5; iter++) {
  // WRONG: Evaluating distance from ITERATED coordinate to center.
  // The center also moved if we translated. Or did it?
  // cx,cy,cz is original center.
  var dx = px_iter - cx;
  var dy = py_iter - cy;
  var dz = pz_iter - cz;
  var dist = Math.sqrt(dx*dx + dy*dy + dz*dz) / radius;
  
  var f = falloff(dist);
  var offX = tx * f;
  
  // WRONG: It subtracts the newly evaluated offset from the ORIGINAL grid coord.
  // This is correct for Jacobi iteration: x_new = x_orig - F(x_guess)
  px_iter = px - offX;
}
console.log("Current code maps (10,0,0) -> ", px_iter);

// Wait, the current code in VoxelState:
// px = x - offX;  THIS IS CORRECT! 
// Let's re-read VoxelState.js

