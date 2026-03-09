const R = 25.0;
const tx = 20.0;
const cx = 0;

function F(src_x) {
  let dist = Math.abs(src_x - cx) / R;
  if(dist >= 1.0) return 0.0;
  let f = dist*dist;
  return 3.0*f*f - 4.0*f*dist + 1.0;
}

// Multi-step reverse map
function solve_multistep(x, steps) {
  let px = x;
  let step_tx = tx / steps;
  
  for (let s = 0; s < steps; s++) {
      let p_guess = px;
      for (let i = 0; i < 5; i++) {
         p_guess = px - step_tx * F(p_guess);
      }
      px = p_guess;
  }
  return px;
}

for(let step_count of [2, 4, 8, 16]) {
  console.log(`\n--- Steps: ${step_count} ---`);
  let max_err = 0;
  for(var s=0; s<=25; s+=1) {
    let t = s + tx*F(s);
    let sol = solve_multistep(t, step_count);
    let err = Math.abs(sol - s);
    if(err > max_err) max_err = err;
    if (err > 0.01) {
       console.log(`FAILED for src=${s}: tgt=${t}, sol=${sol} (err=${err.toFixed(3)})`);
    }
  }
  console.log(`Max Error: ${max_err.toFixed(5)}`);
}

