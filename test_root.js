const R = 25.0;
const tx = 20.0;
const cx = 0;

function F(src_x) {
  let dist = Math.abs(src_x - cx) / R;
  if(dist >= 1.0) return 0.0;
  let f = dist*dist;
  return 3.0*f*f - 4.0*f*dist + 1.0;
}

function solve_sample(x) {
  let best_p = x;
  let min_err = Math.abs(x + tx * F(x) - x); 
  
  // Sweep from x-tx to x.
  // We want to find p such that p + F(p)*tx = x
  let n_samples = Math.max(5, Math.ceil(Math.abs(tx) / (R * 0.2)));
  
  for (let i = 0; i <= n_samples; i++) {
     let t_frac = i / n_samples;
     let p_guess = x - tx * t_frac;
     
     let p = p_guess;
     for(let iter=0; iter<5; iter++) {
        p = x - tx * F(p);
     }
     
     let err = Math.abs(p + tx * F(p) - x);
     if (err < min_err) {
        min_err = err;
        best_p = p;
     }
  }
  
  return best_p;
}

for(var s=0; s<=25; s+=1) {
  let t = s + tx*F(s);
  let sol = solve_sample(t);
  if (Math.abs(sol - s) > 0.01) {
     console.log(`FAILED for src=${s}: tgt=${t}, sol=${sol}`);
  }
}
console.log("Sweep complete");

