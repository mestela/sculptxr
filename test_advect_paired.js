const R = 25.0;
const tx = 20.0;
const cx = 0;

function F(src_x) {
  let dist = Math.abs(src_x - cx) / R;
  if(dist >= 1.0) return 0.0;
  let f = dist*dist;
  return 3.0*f*f - 4.0*f*dist + 1.0;
}

function forward(s, steps) {
  let p = s;
  let step_tx = tx / steps;
  for(let i=0; i<steps; i++) {
     p = p + step_tx * F(p);
  }
  return p;
}

function reverse(x, steps) {
  let p = x;
  let step_tx = tx / steps;
  for(let s=0; s<steps; s++) {
      let p_guess = p;
      for (let i = 0; i < 5; i++) {
         p_guess = p - step_tx * F(p_guess);
      }
      p = p_guess;
  }
  return p;
}

for(let steps of [1, 2, 4, 8]) {
  console.log(`\n--- Steps: ${steps} ---`);
  let max_err = 0;
  for(var s=0; s<=25; s+=1) {
    let t = forward(s, steps);
    let sol = reverse(t, steps);
    let err = Math.abs(sol - s);
    if(err > max_err) max_err = err;
    if (err > 0.01) {
       console.log(`FAILED for src=${s}: tgt=${t.toFixed(2)}, sol=${sol.toFixed(2)} (err=${err.toFixed(3)})`);
    }
  }
  console.log(`Max Error: ${max_err.toFixed(5)}`);
}

