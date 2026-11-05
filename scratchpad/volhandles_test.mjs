// A bone volume's handles: the big ring scales, the quarter circle twists, the nearest handle wins the
// pick, and they're 1.5x a joint box's. The functions are lifted from the real source and run with real
// three; the mouse, the camera and the skin need the app.
// node scratchpad/volhandles_test.mjs
//   VH_INJECT=dotsfirst  any dot in reach beats the ring: the zoomed-out pick check must fail
//   VH_INJECT=arcoff     the arc's length isn't searched: the arc pick check must fail
//   VH_INJECT=swap       the ring twists and the arc scales: both drag checks must fail
//   VH_INJECT=nogap      the ring's fixed gap is scaled too: the follow-the-hand check must fail
//   VH_INJECT=small      volume handles stay at a box's size: the size check must fail
//   VH_INJECT=hotarc     lighting the arc shrinks it to a dot's scale: the highlight check must fail
import fs from 'node:fs';
import * as THREE from 'three';

let skel = fs.readFileSync(new URL('../src/editing/Skeleton.js', import.meta.url), 'utf8');
let tool = fs.readFileSync(new URL('../src/editing/tools/BoneDrawTool.js', import.meta.url), 'utf8');
const inject = (s, a, b) => { if (!s.includes(a)) throw new Error('anchor moved: ' + a); return s.replace(a, b); };
const I = process.env.VH_INJECT;
if (I === 'dotsfirst') skel = inject(skel, 'if (other < radius && other + radius * 0.25 < dotD) {', 'if (!best && other < radius) {');
if (I === 'arcoff') skel = inject(skel, 'const other = Math.min(arcD, ringD);', 'const other = ringD;');
if (I === 'swap') { tool = inject(tool, "if (v.grip.kind === 'twist') {", "if (v.grip.kind === 'ring') {"); }
if (I === 'nogap') tool = inject(tool, 'const k = (perp - v.ringGap) / Math.max(v.startPerp - v.ringGap, 1e-9);', 'const k = perp / v.startPerp;');
if (I === 'small') skel = inject(skel, 'const VOL_HANDLE_SIZE = 0.03375;', 'const VOL_HANDLE_SIZE = 0.0225;');
if (I === 'hotarc') skel = inject(skel, 'if (!(h.arcOn && i === ARC_INDEX)) f.scale.setScalar(', 'f.scale.setScalar(');

const braces = (src, at) => { let d = 0; for (let k = src.indexOf('{', at); k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}' && --d === 0) return k + 1; } };
const liftAssign = (name) => { const at = skel.indexOf('Skeleton.' + name + ' = function'); if (at < 0) throw new Error(name); return skel.slice(at, braces(skel, at)) + ';\n'; };
const constOf = (name) => { const m = skel.match(new RegExp('^const ' + name + ' = [^;]+;', 'm')); if (!m) throw new Error(name); return m[0] + '\n'; };

const Skeleton = { sceneUnit: () => 10, scaleHandleAxis: (i) => ({ axis: 0, sign: 1, i }), volumeActive: () => BONE, displayFlag: () => true };
const BONE = {};
const FRAME = { C0: new THREE.Vector3(0, 0, 0), C1: new THREE.Vector3(0, 10, 0), d: new THREE.Vector3(0, 1, 0), e1: new THREE.Vector3(1, 0, 0),
  e3: new THREE.Vector3(0, 0, 1), r: 2, W: 1, H: 1, o1: 0, o3: 0, len: 10, twist: 0, inset: 0, t0: 0, t1: 10, end0: 0, end1: 0, P: new THREE.Vector3(), B0: new THREE.Vector3() };
Skeleton.volumeFrame = () => FRAME;
const code = ['HANDLE_AXES', 'END_DOTS', 'RING_BASE', 'VOL_HANDLE_SIZE', 'ARC_INDEX'].map(constOf).join('')
  + 'const _vFace = new THREE.Vector3(), _zUp = new THREE.Vector3(0, 0, 1), _upY = new THREE.Vector3(0, 1, 0), HILITE_COLOR = 0xffff00;\n'
  + skel.slice(skel.indexOf('const _vfDir = new THREE.Vector3();'), skel.indexOf('Skeleton.scaleHandleAxis = function'))
  + ['updateScaleHandles', 'pickScaleHandle', 'ringHandle', 'arcHandle', 'highlightScaleHandle'].map(liftAssign).join('')
  + skel.slice(skel.indexOf('function scaleHandleGroup(main)'), braces(skel, skel.indexOf('function scaleHandleGroup(main)')));
new Function('Skeleton', 'THREE', 'skelGroup', code)(Skeleton, THREE, () => new THREE.Group());

let fails = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? 'ok  ' : '  FAIL'} ${name} ${info}`); if (!ok) fails++; };
const main = {};
const h = Skeleton.updateScaleHandles(main, {}, 1);

check('volume handles are 1.5x a box\'s, against the unit the Rig Scale sets', Math.abs(h.faces[0].scale.x - 10 * 0.0225 * 1.5) < 1e-6, 'dot ' + h.faces[0].scale.x);
check('...the end cones too', Math.abs(h.faces[7].scale.x - h.faces[0].scale.x) < 1e-6);
check('the ring is on, white, round the middle', h.ringOn[1] && h.rings[1].material.color.getHex() === 0xffffff && h.centrePos.y === 5);
check('the arc is a quarter circle in green', h.arcOn && Math.abs(h.faces[2].geometry.parameters.arc - Math.PI / 2) < 1e-6 && h.faces[2].material.color.getHex() === 0x6bff8f);
const a0 = new THREE.Vector3(1, 0, 0).applyQuaternion(h.faces[2].quaternion), a1 = new THREE.Vector3(0, 1, 0).applyQuaternion(h.faces[2].quaternion);
check('...running from the width axis to the height axis', a0.distanceTo(FRAME.e1) < 1e-5 && a1.distanceTo(FRAME.e3) < 1e-5);
check('...outside the dots', h.arcR > 2 + h.faces[0].scale.x);
check('...and its old dot can\'t be picked', h.pos[2].x === 1e9);

const R = 2;
const diag = new THREE.Vector3(Math.SQRT1_2, 0, Math.SQRT1_2).multiplyScalar(h.arcR);
check('a hand on the arc takes the twist', Skeleton.pickScaleHandle(main, diag, R)?.kind === 'twist');
const nearEnd = new THREE.Vector3(Math.cos(0.1), 0, Math.sin(0.1)).multiplyScalar(h.arcR);
check('...anywhere along it, not just its middle', Skeleton.pickScaleHandle(main, nearEnd, 0.2)?.kind === 'twist');
const offArc = new THREE.Vector3(-1, 0, 0).multiplyScalar(h.arcR);
check('...and not on the three quarters that aren\'t drawn', Skeleton.pickScaleHandle(main, offArc, 0.2) === null);
const onRing = new THREE.Vector3(-h.ringR, 5, 0);
check('a hand on the ring takes the scale', Skeleton.pickScaleHandle(main, onRing, R)?.kind === 'ring');
// Zoomed out: a dot within reach of the hand, which is right on the ring.
const dot7 = h.pos[7].clone();
const ringNearDot = new THREE.Vector3(h.ringR, 5, 0);
check('with a dot in reach too, the handle under the hand wins', Skeleton.pickScaleHandle(main, ringNearDot, 8)?.kind === 'ring', 'dot at ' + h.pos[0].distanceTo(ringNearDot).toFixed(2));
check('a hand on a dot still takes the dot', Skeleton.pickScaleHandle(main, h.pos[0].clone(), 8)?.kind === 'face');
check('...and an end cone its end', Skeleton.pickScaleHandle(main, dot7, 2)?.index === 7);

const arcScale = h.faces[2].scale.x;
Skeleton.highlightScaleHandle(main, Skeleton.arcHandle());
check('lighting the arc colours it without shrinking it', h.faces[2].scale.x === arcScale && h.faces[2].material.color.getHex() === 0xffff00);
Skeleton.highlightScaleHandle(main, null);
check('...and it goes back', h.faces[2].material.color.getHex() === 0x6bff8f);

// The drags, on the real _volTo.
const at = tool.indexOf('\n  _volTo(pos) {');
const body = tool.slice(tool.indexOf('{', at), braces(tool, at));
const beginAt = tool.indexOf('const ringGap = ');
const gapExpr = tool.slice(beginAt, tool.indexOf('\n', beginAt)).replace('this._main._jointHandles', 'main._jointHandles');
const twist = [];
const SkelForTool = { setVolumeTwist: (j, a) => twist.push([j, a]) };
const volTo = new Function('Skeleton', 'THREE', '_rv1', '_wA', 'pos', 'return (function (pos) ' + body + ').call(this, pos);');
const a = {}, b = {};
const run = (grip, positions) => {
  twist.length = 0;
  a._boneRadius = 2; b._boneRadius = 2;
  const f = FRAME;
  const ringGap = new Function('main', 'f', gapExpr + '; return ringGap;')(main, f);
  const self = { _vol: { joint: {}, bones: [a, b], grip, f, r0: 2, W0: 1, H0: 1, o10: 0, o30: 0, centreline: false, startPerp: 0, ringGap }, _liveWeights() {}, _refresh() {} };
  for (const p of positions) volTo.call(self, SkelForTool, THREE, new THREE.Vector3(), new THREE.Vector3(), p);
};
const ringGrip = Skeleton.ringHandle(1), arcGrip = Skeleton.arcHandle();
const ringR0 = h.ringR;
run(ringGrip, [new THREE.Vector3(ringR0, 5, 0), new THREE.Vector3(ringR0 + 3, 5, 0)]);
check('dragging the ring scales the volume, twin too', a._boneRadius > 2 && b._boneRadius === a._boneRadius && !twist.length, 'r ' + a._boneRadius.toFixed(3));
const ringAfter = a._boneRadius * 1.35 + (ringR0 - 2 * 1.35);
check('...with its edge staying under the hand', Math.abs(ringAfter - (ringR0 + 3)) < 1e-5, 'edge ' + ringAfter.toFixed(3) + ' hand ' + (ringR0 + 3).toFixed(3));
run(ringGrip, [new THREE.Vector3(ringR0, 5, 0)]);
check('...and the first frame only takes hold', a._boneRadius === 2);
run(arcGrip, [diag.clone(), new THREE.Vector3(-diag.z, 0, diag.x)]);
check('dragging the arc twists, the twin the other way, at the same size', twist.length === 2 && twist[0][1] === -twist[1][1] && Math.abs(Math.abs(twist[0][1]) - Math.PI / 2) < 1e-5 && a._boneRadius === 2, twist.length ? 'angle ' + twist[0][1].toFixed(3) : 'no twist');

// Back in a joint's box the handles are as they were.
const SRC = skel;
check('box mode gives back the dot, the size and the ring\'s colour',
  /h\.arcOn = false;\n  handleColor\(h\.rings\[1\], 0x6bff8f\);\n  handleDot\(h, 2, 0x6bff8f\);/.test(SRC) && /const r = Skeleton\.sceneUnit\(main\) \* 0\.0225;\n  h\.centrePos\.copy\(_pJH\);/.test(SRC));
check('a twist drag measures on the arc\'s plane, and neither one anchors like a dot',
  /v\.grip\.kind === 'twist' \? v\.f\.C0 : h\.centrePos/.test(tool) && /this\._vol && this\._vol\.grip\.kind !== 'face'/.test(tool) && /const hp = grip\.kind === 'face' &&/.test(tool));
check('the desktop pick is nearest-wins too', /other \+ px \* 0\.25 < dotD/.test(tool));

if (fails) { console.log(`${fails} FAILURE(S)`); process.exit(1); }
console.log('all checks passed');
