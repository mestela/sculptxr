// ImportNOM insideOut: a closed mesh wound inward is flagged, the same mesh wound outward is not,
// and an open plane is never flagged whichever way it faces (every wrestler scene has a floor
// that read as "inward"). The function is lifted from the source: ImportNOM imports app modules.
// node scratchpad/nominsideout_test.mjs   (NI_INJECT=noopen drops the closed-shape test: the
//   floor check must fail)
import fs from 'node:fs';

let src = fs.readFileSync(new URL('../src/files/ImportNOM.js', import.meta.url), 'utf8');
let fn = src.slice(src.indexOf('function insideOut(v, f) {'), src.indexOf('// Corners reversed, face by face'));
if (process.env.NI_INJECT === 'noopen') {
  const anchor = 'open < 0.01 * edges.size && ';
  if (!fn.includes(anchor)) throw new Error('anchor moved');
  fn = fn.replace(anchor, '');
}
const insideOut = new Function(fn + '; return insideOut;')();

let fails = 0;
const check = (name, ok) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) fails++; };

// Unit cube, quads wound counter-clockwise seen from outside.
const V = Float32Array.of(0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1);
const F = Int32Array.of(0, 3, 2, 1, 4, 5, 6, 7, 0, 1, 5, 4, 2, 3, 7, 6, 1, 2, 6, 5, 0, 4, 7, 3);
const rev = (f) => { const o = new Int32Array(f.length); for (let k = 0; k < f.length; k += 4) { o[k] = f[k + 3]; o[k + 1] = f[k + 2]; o[k + 2] = f[k + 1]; o[k + 3] = f[k]; } return o; };
check('closed, wound outward: left alone', insideOut(V, F) === false);
check('closed, wound inward: flagged', insideOut(V, rev(F)) === true);

// A 10 x 10 floor of quads, slightly dished like the real ones, facing down and up.
const n = 11, PV = [], PF = [];
for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) PV.push(i, 0.05 * ((i - 5) ** 2 + (j - 5) ** 2), j);   // dished: flat has no volume to judge
for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) { const a = j * n + i; PF.push(a, a + 1, a + n + 1, a + n); }
const pv = Float32Array.from(PV), pf = Int32Array.from(PF);
check('open floor plane, either way up: never flagged', insideOut(pv, pf) === false && insideOut(pv, rev(pf)) === false);

if (!fails) console.log('all checks passed');
process.exit(fails ? 1 : 0);
