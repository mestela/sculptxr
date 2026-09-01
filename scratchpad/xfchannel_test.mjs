// Node harness for the graph editor's transform-group accessors in src/gui/GuiTimeline.js.
//
// Same trick as the other harnesses: the REAL source is read and the three free functions are
// lifted out of it, so what is tested is the shipped code rather than a copy. The rest of
// GuiTimeline needs a canvas and a DOM, which these functions do not.
import fs from 'fs';
import path from 'path';
import * as THREE from '/Users/mattestela/sculptxr/node_modules/three/build/three.module.js';

const REPO = '/Users/mattestela/sculptxr';
const SRC = fs.readFileSync(path.join(REPO, 'src/gui/GuiTimeline.js'), 'utf8');
const XF = fs.readFileSync(path.join(REPO, 'src/editing/xfChannel.js'), 'utf8');

const grab = (name) => {
  const i = XF.indexOf(`export function ${name}(`);
  if (i < 0) throw new Error(`${name} not found — has it been renamed?`);
  let depth = 0, j = XF.indexOf('{', i);
  for (let k = j; k < XF.length; k++) {
    if (XF[k] === '{') depth++;
    else if (XF[k] === '}' && --depth === 0) return XF.slice(i, k + 1).replace('export function', 'function');
  }
  throw new Error(`${name} never closed`);
};

const gen = path.join(REPO, 'scratchpad', '_xfchannel_gen.mjs');
fs.writeFileSync(gen, `
import * as THREE from '${path.join(REPO, 'node_modules/three/build/three.module.js')}';
globalThis.window = globalThis.window || {};
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _rq = new THREE.Quaternion();
const _re = new THREE.Euler();
const R2D = 180 / Math.PI, D2R = Math.PI / 180;
// The group list the accessors now validate against. Lifted rather than restated, so adding a
// group to the module cannot leave this harness testing a shorter list than the app has.
const XF_GROUPS = ${JSON.stringify(
  (XF.match(/export const XF_GROUPS = \[([^\]]+)\]/) || [, ''])[1]
    .split(',').map((w) => w.trim().replace(/^'|'$/g, '')).filter(Boolean))};
${grab('xfGroup')}
${grab('xfRead')}
${grab('xfWrite')}
export { xfGroup, xfRead, xfWrite };
`);
// _xfSegRects is a class method but touches no instance state, so it lifts out the same way.
const segSrc = (() => {
  const i = SRC.indexOf('  _xfSegRects() {');
  if (i < 0) throw new Error('_xfSegRects not found — has it been renamed?');
  let depth = 0;
  for (let k = SRC.indexOf('{', i); k < SRC.length; k++) {
    if (SRC[k] === '{') depth++;
    else if (SRC[k] === '}' && --depth === 0) return SRC.slice(i, k + 1).trim();
  }
  throw new Error('_xfSegRects never closed');
})();
const HEADER_H = +(/const HEADER_H = (\d+);/.exec(SRC)?.[1]);
const XF_SEG_H = +(/const XF_SEG_H = (\d+);/.exec(SRC)?.[1]);
fs.appendFileSync(gen, `
const HEADER_H = ${HEADER_H}, XF_SEG_H = ${XF_SEG_H};
export function segRects() { const o = { ${segSrc.replace('_xfSegRects() {', '_xfSegRects() {')} }; return o._xfSegRects(); }
export const CONSTS = { HEADER_H, XF_SEG_H };
`);

fs.appendFileSync(gen, `
${grab('eulerFromQuat')}
${grab('unwrapTo')}
${grab('rotRebuild')}
${grab('rotSync')}
${grab('rotSetEuler')}
export { rotSync, rotRebuild, unwrapTo };
`);
const { xfGroup, xfRead, xfWrite, segRects, CONSTS, rotSync, rotRebuild, unwrapTo } =
  await import(gen + '?v=' + Date.now());

let failures = 0;
const check = (name, ok, detail) => {
  if (ok) { console.log('  ok   ' + name); return; }
  failures++; console.log('  FAIL ' + name + (detail ? '  ' + detail : ''));
};

const track = () => ({
  times: [0, 1],
  positions: [1, 2, 3, 4, 5, 6],
  scales: [1, 1, 1, 2, 2, 2],
  quaternions: [0, 0, 0, 1, 0, 0, 0, 1],
});

// --- the group selector -----------------------------------------------------------
window._animXfGroup = undefined;
check('group: defaults to translation', xfGroup() === 'pos');
window._animXfGroup = 'nonsense';
check('group: an unknown group falls back to translation', xfGroup() === 'pos');

// --- translation and scale read the arrays they always did ------------------------
window._animXfGroup = 'pos';
const t1 = track();
check('translation: reads the position array', xfRead(t1, 1, 0) === 4 && xfRead(t1, 1, 2) === 6);
xfWrite(t1, 1, 1, 99);
check('translation: writes the position array', t1.positions[4] === 99);

window._animXfGroup = 'scale';
const t2 = track();
check('scale: reads the scale array', xfRead(t2, 1, 0) === 2);
xfWrite(t2, 0, 2, 0.5);
check('scale: writes the scale array', t2.scales[2] === 0.5);
check('scale: does not disturb translation', t2.positions.join() === '1,2,3,4,5,6');

// --- rotation round-trips through the quaternion ----------------------------------
window._animXfGroup = 'rot';
const t3 = track();
check('rotation: an identity key reads as zero', Math.abs(xfRead(t3, 0, 0)) < 1e-9);
for (const deg of [30, -45, 90, 179]) {
  const t = track();
  xfWrite(t, 0, 0, deg);
  const back = xfRead(t, 0, 0);
  check(`rotation: ${deg} degrees survives the round trip`, Math.abs(back - deg) < 1e-6,
    'read back ' + back.toFixed(6));
}

// Writing ONE channel must leave the other two where they read.
const t4 = track();
xfWrite(t4, 0, 0, 20);
xfWrite(t4, 0, 2, -35);
check('rotation: channels are independent',
  Math.abs(xfRead(t4, 0, 0) - 20) < 1e-6 && Math.abs(xfRead(t4, 0, 1)) < 1e-6
  && Math.abs(xfRead(t4, 0, 2) + 35) < 1e-6,
  `[${xfRead(t4,0,0).toFixed(3)}, ${xfRead(t4,0,1).toFixed(3)}, ${xfRead(t4,0,2).toFixed(3)}]`);

// The whole point of the winding store: ten turns must stay ten turns. This test used to
// assert the OPPOSITE — that a quaternion loses it — and was written to fail once rotation
// gained real winding. It has, so here is the claim the other way round.
for (const deg of [3600, -720, 1080.5]) {
  const t5 = track();
  xfWrite(t5, 0, 0, deg);
  check(`rotation: ${deg} degrees keeps its winding`, Math.abs(xfRead(t5, 0, 0) - deg) < 1e-6,
    'read back ' + xfRead(t5, 0, 0));
}

// The quaternion is kept in step, so everything reading rotation the old way still agrees —
// modulo the turns it cannot represent, which is exactly what it should lose.
{
  const t = track();
  xfWrite(t, 0, 1, 45 + 720);
  const q = t.quaternions.slice(0, 4);
  const e = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(...q), 'XYZ');
  check('rotation: the quaternion stays in step, one turn folded away',
    Math.abs(e.y * 180 / Math.PI - 45) < 1e-6, (e.y * 180 / Math.PI).toFixed(4));
}

// --- winding survives, and repairs itself when it cannot -------------------------
{
  check('unwrap: picks the nearest equivalent turn',
    unwrapTo(350, -10) === 350 && unwrapTo(0, 359) === -1 && unwrapTo(720, 0) === 720,
    [unwrapTo(350, -10), unwrapTo(0, 359), unwrapTo(720, 0)].join());

  // A rebuild from quaternions cannot know about turns, but it MUST stay continuous rather
  // than sawtoothing at every half turn — that is what makes a recorded spin read as a spin.
  const spin = { times: [0, 1, 2, 3], quaternions: [], positions: [], scales: [] };
  for (let i = 0; i < 4; i++) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, i * 170 * Math.PI / 180, 0, 'XYZ'));
    spin.quaternions.push(q.x, q.y, q.z, q.w);
  }
  const e = rotRebuild(spin);
  const ys = [e[1], e[4], e[7], e[10]];
  let monotonic = true;
  for (let i = 1; i < 4; i++) if (ys[i] <= ys[i - 1]) monotonic = false;
  check('rebuild: a continuous spin stays continuous', monotonic,
    ys.map((v) => v.toFixed(1)).join(', '));

  // The safety net. A missed splice site leaves eulers the wrong length; rotSync must repair
  // rather than let rotation index against the wrong times.
  const t = { times: [0, 1], quaternions: [0, 0, 0, 1, 0, 0, 0, 1], eulers: [1, 2, 3] };
  const fixed = rotSync(t);
  check('rotSync: a length mismatch is repaired, not trusted', fixed.length === 6,
    'length ' + fixed.length);
}

// Rotation editing must not corrupt the neighbouring key.
const t6 = track();
xfWrite(t6, 0, 1, 60);
check('rotation: the other key is untouched', t6.quaternions.slice(4).join() === '0,0,0,1');

// --- the T|R|S strip geometry -----------------------------------------------------
// Drawing and hit-testing both read _xfSegRects, so the risk is not that they disagree with
// each other but that they disagree with the gutter: a segment wider than the gutter column
// would take clicks meant for the graph, and one overlapping row 0 would steal them from the
// first channel row.
{
  const r = segRects();
  // FOUR FILTERS AND A NORMALISE. The strip was a radio over three transform groups and is now
  // a set over four channels, plus a button that is not a channel at all.
  check('strip: four channel segments, in T R S W order',
    r.filter((x) => !x.norm).map((x) => x.g).join() === 'pos,rot,scale,weight',
    r.map((x) => x.g).join());
  check('strip: labels are T R S W',
    r.filter((x) => !x.norm).map((x) => x.label).join() === 'T,R,S,W');
  check('strip: with Normalise beside them, marked as not a channel',
    r.length === 5 && r[4].norm === true && r[4].g === null && r[4].label === 'N',
    'mixed units cannot share a Y axis, and matt chose an explicit toggle over the view '
      + 'silently changing mode when a second group is switched on');
  check('strip: stays inside the 200px gutter column',
    r.every((x) => x.x >= 0 && x.x + x.w <= 200),
    r.map((x) => `${x.x.toFixed(1)}..${(x.x + x.w).toFixed(1)}`).join(' '));
  check('strip: segments do not overlap',
    r[0].x + r[0].w <= r[1].x + 1e-9 && r[1].x + r[1].w <= r[2].x + 1e-9);
  check('strip: sits above the first channel row, inside its own band',
    r.every((x) => x.y >= CONSTS.HEADER_H && x.y + x.h <= CONSTS.HEADER_H + 4 + CONSTS.XF_SEG_H),
    `band ${CONSTS.HEADER_H}..${CONSTS.HEADER_H + 4 + CONSTS.XF_SEG_H}, seg ${r[0].y}..${r[0].y + r[0].h}`);
}

// --- no call site may go round the accessors ---------------------------------------
// The accessor tests above all passed while the graph editor was still BROKEN, because five
// call sites read `tr.positions[...]` directly. Rotation keys were drawn at their rotation
// values and hit-tested at their translation values, so clicking a visible key hit nothing and
// the drag fell through to the viewport and moved the object instead.
//
// Testing the accessors could never catch that. What catches it is asserting that nothing
// ELSE touches the arrays — so this walks the source and allows the three lines inside
// xfRead/xfWrite themselves, and nothing else.
{
  // THE GUARD THAT MATTERS, and it has to cover every file on the edit path.
  //
  // An earlier version scanned GuiTimeline alone and passed while the graph editor was still
  // broken, twice over: the vertical drag actually lands in AnimationRegistry, and the marquee
  // and transform box are in TimelineHelper. Per-key access BY CHANNEL is the edit path, and
  // all of it must go through the accessors — so any line naming a channel and indexing a
  // transform array directly is the bug, wherever it lives.
  //
  // Playback is deliberately not caught: it reads whole quaternions and slerps them, with no
  // channel index in sight, which is why the channel term is part of the test.
  const files = [
    'src/gui/GuiTimeline.js',
    'src/gui/TimelineHelper.js',
    'src/editing/AnimationRegistry.js',
  ];
  const offenders = [];
  for (const rel of files) {
    const src = fs.readFileSync(path.join(REPO, rel), 'utf8').split('\n');
    src.forEach((l, i) => {
      if (!/\.(positions|quaternions|scales)(\?\.)?\[/.test(l)) return;
      if (!/channel/i.test(l)) return; // whole-track copies and playback reads are fine
      offenders.push(`${rel}:${i + 1}  ${l.trim().slice(0, 64)}`);
    });
  }
  check('no channel-indexed transform access outside the accessors', offenders.length === 0,
    '\n      ' + offenders.join('\n      '));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
