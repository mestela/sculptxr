// ShapeLevel: which multires level a .sxr's blendshapes belong to, and what a v28 file's padded base
// and collapsed levels look like. The full round trip needs the app; this guards the decisions.
// node scratchpad/shapelevel_test.mjs
//   SL_INJECT=shown   always answers the displayed level: the save check must fail
//   SL_INJECT=nopad   never finds padding: the v28 checks must fail
//   SL_INJECT=noiseless  only exact zeros count as collapsed: the noisy-collapse check must fail
import fs from 'node:fs';

let src = fs.readFileSync(new URL('../src/files/ShapeLevel.js', import.meta.url), 'utf8');
const inject = (anchor, to) => { if (!src.includes(anchor)) throw new Error('anchor moved'); src = src.replace(anchor, to); };
const i = process.env.SL_INJECT;
if (i === 'shown') inject('return levelCounts.includes(nb) ? nb : shown;', 'return shown;');
if (i === 'nopad') inject('return fits.length ? Math.min(...fits) : nv;', 'return nv;');
if (i === 'noiseless') inject('const r = 1e-3 * Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]);', 'const r = 1e-30;');
const { shapeVertexCount, paddedShapeCount, isCollapsedLevel } = await import('data:text/javascript,' + encodeURIComponent(src));

let fails = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? 'ok  ' : '  FAIL'} ${name} ${info}`); if (!ok) fails++; };

const levels = [100, 400, 1600];
// Non-zero positions for the first n of nv vertices, zero padded after.
const padded = (n, nv) => { const a = new Float32Array(nv * 3); for (let k = 0; k < n * 3; k++) a[k] = 1 + k % 7; return a; };

// saving
check('saved subdivided: the shapes keep their own level',
  shapeVertexCount({ baseShape: padded(100, 100), _bsNbVertices: 100 }, levels, 1600) === 100);
check('the base array carries spare capacity: the vertex count decides',
  shapeVertexCount({ baseShape: new Float32Array(999), _bsNbVertices: 400 }, levels, 100) === 400);
check('shapes above the displayed level are not cut down to it',
  shapeVertexCount({ baseShape: padded(400, 400) }, levels, 100) === 400);
check('no stack: the mesh itself', shapeVertexCount({ baseShape: new Float32Array(999) }, [], 333) === 333);
check('no base, or nothing fits: the displayed level',
  shapeVertexCount(null, levels, 400) === 400 && shapeVertexCount({ baseShape: padded(7, 7) }, levels, 400) === 400);

// loading a v28 file
check('padded to the top from the cage', paddedShapeCount(padded(100, 1600), levels) === 100);
check('padded to the top from the middle', paddedShapeCount(padded(400, 1600), levels) === 400);
check('a real full base stays', paddedShapeCount(padded(1600, 1600), levels) === 1600);
const originLast = padded(1600, 1600); originLast.fill(0, 4797);
check('one real vertex at the origin is not padding', paddedShapeCount(originLast, levels) === 1600);
check('a mostly empty base with no level to fit stays', paddedShapeCount(padded(1000, 1600), levels) === 1600);
check('an all-zero base stays', paddedShapeCount(new Float32Array(4800), levels) === 1600);

// collapsed levels
const base = new Float32Array(300);
for (let k = 0; k < 100; k++) { base[k * 3] = Math.cos(k) * 25; base[k * 3 + 1] = Math.sin(k) * 25; base[k * 3 + 2] = k % 2 ? 15 : -15; }
const level = (fn) => { const v = new Float32Array(1200); v.set(base); for (let k = 100; k < 400; k++) { const p = fn(k); v[k * 3] = p[0]; v[k * 3 + 1] = p[1]; v[k * 3 + 2] = p[2]; } return v; };
check('exact zeros are collapsed', isCollapsedLevel(level(() => [0, 0, 0]), 100, 400, base));
// matt's file: 99% of the added vertices inside 0.0085 of the origin on a head 50 tall, the rest up to 0.97.
check('collapsed with float noise is still collapsed',
  isCollapsedLevel(level((k) => (k % 100 ? [1e-4, -2e-3, 8e-3] : [0.9, 0.3, 0.1])), 100, 400, base));
check('a healthy level is not', !isCollapsedLevel(level((k) => [Math.cos(k) * 24, Math.sin(k) * 24, k % 2 ? 14 : -14]), 100, 400, base));
check('a surface passing through the origin is not',
  !isCollapsedLevel(level((k) => (k % 5 ? [Math.cos(k) * 24, Math.sin(k) * 24, 3] : [0, 0, 0])), 100, 400, base));
check('a level that adds nothing is not', !isCollapsedLevel(new Float32Array(300), 100, 100, base));

if (fails) { console.log(`${fails} FAILURE(S)`); process.exit(1); }
console.log('all checks passed');
