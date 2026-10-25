// IdleFace.js core: blink count follows the rate, rate 0 never blinks, weights stay in 0..1, the
// eyes turn together (left OUT == right IN), a dart lands fast, the blink has the measured shape
// (Kwon 2013), some blinks stop short, and the micro layer moves the brows only when it is on.
// node scratchpad/idle_test.mjs   (ID_INJECT=eyes mirrors the eyes: the together check must fail)
import fs from 'node:fs';

const src = new URL('../src/editing/IdleFace.js', import.meta.url);
let code = fs.readFileSync(src, 'utf8');
if (process.env.ID_INJECT === 'eyes') {
  const anchor = "add('eyeLookInRight', Math.max(0, wx));";
  if (!code.includes(anchor)) throw new Error('anchor moved');
  code = code.replace(anchor, "add('eyeLookInRight', Math.max(0, -wx));");
}
const copy = new URL('../src/editing/_idle_test_copy.js', import.meta.url);
fs.writeFileSync(copy, code);
let I;
try { I = await import(copy.href); } finally { fs.rmSync(copy); }
const { makeIdle, stepIdle, blinkCurve, idle } = I;

let fails = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} ${info}`); if (!ok) fails++; };

// Seeded so a failure repeats.
function lcg(seed) { let x = seed >>> 0; return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296); }

function run(secs, rate, seed = 1, micro = 1) {
  idle.rate = rate; idle.range = 0.35; idle.pace = 1; idle.micro = micro;
  const s = makeIdle(0, lcg(seed)), out = new Map();
  let blinks = 0, partial = 0, wasShut = false, inRange = true, together = true, maxLand = 0, browMax = 0;
  for (let t = 0; t <= secs; t += 1 / 72) {
    stepIdle(s, t, out);
    for (const w of out.values()) if (!(w >= 0 && w <= 1)) inRange = false;
    if (s.blink0 < 0 && Math.abs((out.get('eyeLookOutLeft') || 0) - (out.get('eyeLookInRight') || 0)) > 1e-3) together = false;
    browMax = Math.max(browMax, out.get('browInnerUp') || 0);
    const shut = s.blink0 >= 0 && t - s.blink0 < 0.1;
    if (shut && !wasShut) { blinks++; if (s.bk.amp < 1) partial++; }
    wasShut = shut;
    maxLand = Math.max(maxLand, s.sacDur);
  }
  return { blinks, partial, inRange, together, maxLand, browMax };
}

const a = run(240, 15);
check('blink rate ~15/min over 4 min', a.blinks >= 45 && a.blinks <= 80, `(${a.blinks})`);
check('weights in 0..1', a.inRange);
check('eyes turn together', a.together);
check('a dart lands in under 0.1 s', a.maxLand < 0.1, `(${a.maxLand.toFixed(3)})`);
check('rate 0 never blinks', run(60, 0).blinks === 0);
check('some blinks stop short (10-35%)', a.partial / a.blinks > 0.1 && a.partial / a.blinks < 0.35, `(${a.partial}/${a.blinks})`);
check('micro on: brows move, with the odd flash', a.browMax > 0.1, `(${a.browMax.toFixed(2)})`);
check('micro off: brows still', run(120, 15, 3, 0).browMax === 0);

// The measured shape: shut at 76 ms, still shut through the closed phase, then FAST off the eye:
// a quarter of the opening time in, already a good way back (smoothstep was barely moving there).
const bk = { close: 0.076, shut: 0.05, open: 0.165, amp: 1 };
const o0 = bk.close + bk.shut;
check('closes in ~76 ms', blinkCurve(bk, 0.076) > 0.99 && blinkCurve(bk, 0.038) < 0.6);
check('opening is fastest at the start', 1 - blinkCurve(bk, o0 + bk.open / 4) > 0.4, `(${(1 - blinkCurve(bk, o0 + bk.open / 4)).toFixed(2)} open)`);
check('97% open at the end of the early opening', Math.abs(blinkCurve(bk, o0 + bk.open) - 0.03) < 1e-6);
check('the last 3% creeps', blinkCurve(bk, o0 + bk.open + 0.1) > 0.005);
const hi = run(240, 40).blinks, lo = run(240, 5).blinks;
check('higher rate blinks more', hi > lo * 3, `(${lo} -> ${hi})`);

// .sxr v27: the export writes the idle fields in the order the import reads them, and the size
// pass counts them (a mismatch shifts every field after it on load).
{
  const exp = fs.readFileSync(new URL('../src/files/ExportSGL.js', import.meta.url), 'utf8');
  const imp = fs.readFileSync(new URL('../src/files/ImportSGL.js', import.meta.url), 'utf8');
  const order = (src, re) => [...src.matchAll(re)].map((m) => m[1]).join(',');
  const w = order(exp, /f32a\[off\+\+\] = idle\.(\w+)/g), r = order(imp, /idle\.(\w+) = f32a\[off\+\+\]/g);
  check('.sxr idle fields written and read in one order', w && w === r, `(${w} / ${r})`);
  check('.sxr idle flag written and read', /u32a\[off\+\+\] = idle\.on/.test(exp) && /idle\.on = u32a\[off\+\+\]/.test(imp));
  check('.sxr size pass counts the idle block', /nbBytes \+= 20;\s*\/\/ v27 idle/.test(exp));
}

if (!fails) console.log('all checks passed');
process.exit(fails ? 1 : 0);
