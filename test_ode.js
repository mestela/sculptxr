const { vec3, quat } = require('./src/lib/gl-matrix.js');

const R = 25.0;
const tx = 20.0, ty=0, tz=0;
let rotation = quat.create();

let steps = 6;
let step_tx = tx / steps;
let step_ty = ty / steps;
let step_tz = tz / steps;

let step_quat = quat.create();
quat.slerp(step_quat, quat.create(), rotation, 1.0 / steps);

function F(dx, dy, dz) {
  let dist = Math.sqrt(dx*dx + dy*dy + dz*dz) / R;
  if(dist >= 1.0) return 0.0;
  let f = dist*dist;
  return 3.0*f*f - 4.0*f*dist + 1.0;
}

// Forward ODE (Proxy)
function forward(x, y, z) {
  let px = x, py = y, pz = z;
  let cx = 0, cy = 0, cz = 0;
  let vTemp = vec3.create();
  
  for(let i=0; i<steps; i++) {
     let dx = px - cx;
     let dy = py - cy;
     let dz = pz - cz;
     let f = F(dx, dy, dz);
     
     if (f > 0) {
         let offX = step_tx * f;
         let offY = step_ty * f;
         let offZ = step_tz * f;
         
         vTemp[0] = dx; vTemp[1] = dy; vTemp[2] = dz;
         vec3.transformQuat(vTemp, vTemp, step_quat);
         offX += (vTemp[0] - dx) * f;
         offY += (vTemp[1] - dy) * f;
         offZ += (vTemp[2] - dz) * f;
         
         px += offX;
         py += offY;
         pz += offZ;
     }

     cx += step_tx;
     cy += step_ty;
     cz += step_tz;  // Center moves DURING drag!
  }
  return px;
}

// Reverse ODE (Advection)
function reverse(x, y, z) {
  let px = x, py = y, pz = z;
  let cx = tx, cy = ty, cz = tz;
  
  let vTemp = vec3.create();
  
  for(let i=0; i<steps; i++) {
     let p_guess = px;
     for(let iter=0; iter<5; iter++) {
        let prev_cx = cx - step_tx;
        let prev_cy = cy - step_ty;
        let prev_cz = cz - step_tz;
        
        let dx = p_guess - prev_cx;
        let dy = p_guess - prev_cy;
        let dz = p_guess - prev_cz;
        let f = F(dx, dy, dz);
        
        let offX = step_tx * f;
        let offY = step_ty * f;
        let offZ = step_tz * f;
        
        vTemp[0] = dx; vTemp[1] = dy; vTemp[2] = dz;
        vec3.transformQuat(vTemp, vTemp, step_quat);
        offX += (vTemp[0] - dx) * f;
        offY += (vTemp[1] - dy) * f;
        offZ += (vTemp[2] - dz) * f;
        
        p_guess = px - offX; 
     }
     px = p_guess;
     
     cx -= step_tx;
     cy -= step_ty;
     cz -= step_tz;
  }
  return px;
}

for(var s=0; s<=25; s+=1) {
  let t = forward(s, 0, 0);
  let sol = reverse(t, 0, 0);
  let err = Math.abs(sol - s);
  if(err > 0.01) {
     console.log(`FAILED for src=${s}: tgt=${t.toFixed(2)}, sol=${sol.toFixed(2)} (err=${err.toFixed(5)})`);
  }
}
console.log("Sweep complete");
