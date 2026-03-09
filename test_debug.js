const R = 25.0;
const radius = R;
const tx = 20.0, ty=0, tz=0;
const translation = [tx, ty, tz];

var stepsCount = 6;
var step = 1.0;
var step_tx = tx / stepsCount;
var step_ty = ty / stepsCount;
var step_tz = tz / stepsCount;
var hasQuat = false;
var stepRotation = null;
var cx = 0, cy = 0, cz = 0;

var px_original = 0;

for (var x_test = -25; x_test <= 25; x_test += 5) {
    let px = x_test;
    let py = 0, pz = 0;
    
    let cx_step = cx;
    let cy_step = cy;
    let cz_step = cz;
    
    for (var s = 0; s < stepsCount; s++) {
      let p_guess = px;
      let prev_cx = cx_step - step_tx;
      let prev_cy = cy_step - step_ty;
      let prev_cz = cz_step - step_tz;
      
      for (var iter = 0; iter < 5; iter++) {
        let dx = p_guess - prev_cx;
        let dy = py - prev_cy;
        let dz = pz - prev_cz;
        let dist = Math.sqrt(dx*dx + dy*dy + dz*dz) / radius;
        
        if (dist >= 1.0) {
           p_guess = px; // No falloff pull from here
        } else {
          let fallOff = dist * dist;
          fallOff = 3.0 * fallOff * fallOff - 4.0 * fallOff * dist + 1.0;
          let offX = step_tx * fallOff;
          p_guess = px - offX;
        }
      } 
      px = p_guess;
      cx_step -= step_tx;
    }
    console.log(`x=${x_test} => mapped source: ${px}`);
}
