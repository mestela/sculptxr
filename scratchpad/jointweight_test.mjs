// Node harness for THE BIND MEASURING THE SAME ENVELOPE THE SKIN DOES.
//
// The bind assigns each vertex to the nearest capsule, "nearest" measured in units of that
// capsule's own size. That was a uniform capsule of the BONE's radius between two JOINTS — and
// it stayed that way while the envelope everything else uses grew a per-joint radius, three
// per-axis extents and an offset. So the skin followed the new shape and the weights went on
// following the old one: shaping a joint changed what you saw and nothing about what moved.
// matt: "does the original capsule proximity system still control the weighting, especially
// interactively after binding? it doesn't seem to."
//
// Same stubbed-import trick as the other harnesses: the real boneSegments and the real
// nearest-capsule assignment run here, with THREE and a mock mesh underneath them.
//
// Run: node scratchpad/jointweight_test.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as THREE from '/Users/mattestela/sculptxr/node_modules/three/build/three.module.js';

const REPO = '/Users/mattestela/sculptxr';
const SRC = fs.readFileSync(path.join(REPO, 'src/editing/Skinning.js'), 'utf8');

// Lift the two functions under test plus the distance they share, rather than the whole module:
// Skinning pulls in WeightCage, Geodesic and the options URL, none of which the assignment
// touches, and stubbing them would be more fake than the thing being tested.
const grab = (from, to) => SRC.slice(SRC.indexOf(from), SRC.indexOf(to));
const body = grab('function envelopeT2', '// Laplacian smoothing over the weight field');

const SKEL_SRC = fs.readFileSync(path.join(REPO, 'src/editing/Skeleton.js'), 'utf8');
const skelBits = ['Skeleton.jointRadius = function', 'Skeleton.jointScale = function',
  'Skeleton.jointOffset = function', 'Skeleton.jointHalf = function']
  .map((sig) => {
    const i = SKEL_SRC.indexOf(sig);
    return SKEL_SRC.slice(i, SKEL_SRC.indexOf('\n};', i) + 3);
  }).join('\n');

const prelude = `
import * as THREE from '${path.join(REPO, 'node_modules/three/build/three.module.js')}';
const MAX_INFLUENCES = 4;
const UNIT_SCALE = [1, 1, 1];
const ZERO_OFF = [0, 0, 0];
const Skeleton = {};
${skelBits}
const _mMesh = new THREE.Matrix4(), _mInv = new THREE.Matrix4();
const _mInvSeg = new THREE.Matrix4();
const _m3Inv = new THREE.Matrix3();
const _vOff = new THREE.Vector3(), _vSeg = new THREE.Vector3();
`;

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '_jointweight_gen.mjs');
fs.writeFileSync(out, prelude + body
  + '\nexport { boneSegments, nearestCapsuleWeights, envelopeT2 };\n');
const M = await import(out + '?v=' + Date.now());

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

// A mesh at identity, so mesh space is model space and the numbers read directly.
const mesh = { getModelSpaceMatrix: () => new THREE.Matrix4().elements };
const J = (x, y, z, r, parent) => ({ p: [x, y, z], _boneRadius: r, _parentMesh: parent || null });
const posOf = (js) => js.map((j) => new THREE.Vector3(j.p[0], j.p[1], j.p[2]));

// Two bones up the Y axis. A vertex out to the side at the middle joint's height is owned by
// whichever envelope claims it — and the middle joint's shape is what this is about.
const build = (tweak) => {
  const a = J(0, -4, 0, 1);
  const b = J(0, 0, 0, 1, a);
  const c = J(0, 4, 0, 1, b);
  if (tweak) tweak(a, b, c);
  const js = [a, b, c];
  return { js, segs: M.boneSegments(mesh, js, posOf(js)) };
};

// ── THE JOINT'S RADIUS COUNTS ─────────────────────────────────────────────────────────
{
  const plain = build();
  const fat = build((a, b) => { b._jointRadius = 3; });
  const at = (segs, x, y, z) => Math.min(...segs.map((s) => M.envelopeT2(x, y, z, s)));
  // 2 units out at the middle joint: outside a radius-1 capsule, inside a radius-3 one.
  check('a vertex 2 out is OUTSIDE a bone-radius envelope', at(plain.segs, 2, 0, 0) > 1,
    't2 = ' + at(plain.segs, 2, 0, 0).toFixed(2));
  check('...and INSIDE once the joint carries a radius of 3', at(fat.segs, 2, 0, 0) < 1,
    't2 = ' + at(fat.segs, 2, 0, 0).toFixed(2)
    + ' — the bind was reading _boneRadius and ignoring the joint entirely');
}

// ── AND SO DO ITS THREE EXTENTS ───────────────────────────────────────────────────────
{
  const flat = build((a, b) => { b._jointRadius = 3; b._jointScale = [1, 1, 0.2]; });
  const t2x = Math.min(...flat.segs.map((s) => M.envelopeT2(2, 0, 0, s)));
  const t2z = Math.min(...flat.segs.map((s) => M.envelopeT2(0, 0, 2, s)));
  check('a joint squashed in z claims sideways but not front-to-back',
    t2x < 1 && t2z > 1, 'x ' + t2x.toFixed(2) + ' vs z ' + t2z.toFixed(2)
    + ' — a round measure cannot tell those two points apart');
}

// ── AND ITS OFFSET ────────────────────────────────────────────────────────────────────
{
  const shifted = build((a, b) => { b._jointRadius = 2; b._jointOffset = [3, 0, 0]; });
  const near = Math.min(...shifted.segs.map((s) => M.envelopeT2(3, 0, 0, s)));
  const far = Math.min(...shifted.segs.map((s) => M.envelopeT2(-3, 0, 0, s)));
  check('a shape moved off its joint takes its territory with it',
    near < far, 'at the shape ' + near.toFixed(2) + ', opposite it ' + far.toFixed(2));
}

// ── A RIG NOBODY HAS SHAPED IS UNCHANGED ──────────────────────────────────────────────
//
// The whole point of the fallback: every existing bind has to keep the weights it had.
{
  const { segs } = build();
  const t2 = M.envelopeT2(0.5, 0, 0, segs[0]);
  // Distance 0.5 in units of radius 1 is 0.25 squared — the round formula's exact answer.
  check('an unshaped joint measures exactly as the round capsule did',
    Math.abs(t2 - 0.25) < 1e-9, 't2 = ' + t2);
}

// ── OWNERSHIP ACTUALLY CHANGES HANDS ──────────────────────────────────────────────────
{
  // Out to the side and above the middle joint. In round terms the UPPER bone owns it: it runs
  // past that height, so its axis is nearer. Fattening the middle joint swells the end both
  // bones share, and the lower one — which reaches this point through its cap — claims it.
  const verts = new Float32Array([2.5, 1.5, 0]);
  const plain = build();
  const fat = build((a, b) => { b._jointRadius = 5; });
  const w1 = M.nearestCapsuleWeights(verts, 1, plain.segs);
  const w2 = M.nearestCapsuleWeights(verts, 1, fat.segs);
  check('shaping a joint reassigns the vertices around it',
    w1.idx[0] === 1 && w2.idx[0] === 0,
    'owner went from bone ' + w1.idx[0] + ' to bone ' + w2.idx[0]
    + ' (wanted 1 -> 0) — if it never moves, the weights are not reading the joint at all');
  check('...and they stop counting as outside every envelope',
    w1.outside === 1 && w2.outside === 0,
    'outside ' + w1.outside + ' -> ' + w2.outside);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
