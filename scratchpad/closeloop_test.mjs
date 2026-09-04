// Node harness for CLOSE LOOP (roadmap #66) — the simple half of "auto crossfade loop".
//
// matt: "it could be as simple as ensuring the last keys for a recording match the first, or
// fancier like a proper crossfade with a distance falloff. i think the we try the first."
//
// So this pins the simple version AND measures what it leaves behind, because the difference
// between the two is not a matter of taste: matching the endpoints removes the POSITION
// discontinuity at the loop point and converts it into a VELOCITY one. The numbers below say how
// big each is, so the decision to stop here or build the falloff is made by looking rather than
// by argument.
//
// Run: node scratchpad/closeloop_test.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO = '/Users/mattestela/sculptxr';
const SRC = fs.readFileSync(path.join(REPO, 'src/editing/AnimationRegistry.js'), 'utf8');

// The method under test, lifted with the two helpers it leans on, rather than the whole registry
// — AnimationRegistry pulls in the app, the GUI and the state manager, and stubbing those would
// be a bigger fake than the thing being tested.
const slice = (from, to) => SRC.slice(SRC.indexOf(from), SRC.indexOf(to));
const body = slice('  closeLoop(targets) {', '  createBlendshape(mesh, name) {');

const mod = `
const window = { app: null };
class Reg {
  constructor() { this.tracks = new Map(); this.sorted = 0; }
  _snapshotTrack(t) {
    return { times: t.times.slice(), positions: t.positions.slice(),
      quaternions: t.quaternions.slice(), scales: t.scales.slice(),
      eulers: t.eulers ? t.eulers.slice() : null };
  }
  _restoreTrack(t, s) {
    t.times = s.times.slice(); t.positions = s.positions.slice();
    t.quaternions = s.quaternions.slice(); t.scales = s.scales.slice();
    t.eulers = s.eulers ? s.eulers.slice() : null;
  }
  sortTrack() { this.sorted++; }
  update() {}
${body}
}
export { Reg, window as win };
`;
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '_closeloop_gen.mjs');
fs.writeFileSync(out, mod);
const { Reg } = await import(out + '?v=' + Date.now());

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

// A take that drifts: it starts at the origin and ends somewhere else, which is what a hand-made
// recording always does.
const makeTake = () => {
  const times = [], positions = [], quaternions = [], scales = [];
  for (let i = 0; i < 11; i++) {
    times.push(i * 0.1);
    positions.push(i * 1.0, 0, 0);            // straight drift along x, 1 unit per key
    quaternions.push(0, 0, 0, 1);
    scales.push(1, 1, 1);
  }
  return { times, positions, quaternions, scales, eulers: null };
};
const mesh = { getID: () => 7 };
const reg = new Reg();
const track = makeTake();
reg.tracks.set(7, track);

const gap = (t) => Math.hypot(t.positions[(t.times.length - 1) * 3] - t.positions[0],
  t.positions[(t.times.length - 1) * 3 + 1] - t.positions[1],
  t.positions[(t.times.length - 1) * 3 + 2] - t.positions[2]);
// Speed across the final key interval, which is where the correction is spent.
const tailSpeed = (t) => {
  const n = t.times.length;
  const d = Math.abs(t.positions[(n - 1) * 3] - t.positions[(n - 2) * 3]);
  return d / (t.times[n - 1] - t.times[n - 2]);
};

const gapBefore = gap(track), speedBefore = tailSpeed(track);
const res = reg.closeLoop([mesh]);
const gapAfter = gap(track), speedAfter = tailSpeed(track);

check('a drifting take does not loop before this runs', gapBefore > 9,
  'ends ' + gapBefore.toFixed(2) + ' from where it started');
check('closing it makes the last key match the first', gapAfter < 1e-9,
  'gap is now ' + gapAfter.toFixed(6));
check('...and it reports what it touched', res.closed === 1, JSON.stringify(res));
check('...leaving the keys before the last one alone',
  track.positions[0] === 0 && track.positions[3] === 1 && track.positions[24] === 8,
  'only the final key may move');
check('...and the eulers dropped so they are rebuilt from the new quaternion',
  track.eulers === null,
  'a stale euler cache would put the old rotation back on the next read');

// THE COST, stated as a number rather than a worry.
check('the pop becomes a lurch, and here is how big',
  speedAfter > speedBefore * 5,
  'tail speed goes ' + speedBefore.toFixed(1) + ' -> ' + speedAfter.toFixed(1)
  + ' units/sec across the last interval. That is the velocity discontinuity the falloff '
  + 'version exists to spread out — expected, not a defect, and the reason to look at it '
  + 'in the headset before deciding this is enough');

// Undo has to put every key back, not just the one that moved.
{
  const reg2 = new Reg();
  const t2 = makeTake();
  reg2.tracks.set(7, t2);
  const snap = reg2._snapshotTrack(t2);
  reg2.closeLoop([mesh]);
  reg2._restoreTrack(t2, snap);
  check('undo restores the take exactly',
    t2.positions.every((v, i) => v === makeTake().positions[i]));
}

// Nothing to close is not an error.
{
  const reg3 = new Reg();
  reg3.tracks.set(7, { times: [0], positions: [0, 0, 0], quaternions: [0, 0, 0, 1], scales: [1, 1, 1] });
  const r = reg3.closeLoop([mesh]);
  check('a take with one key is left alone', r.closed === 0, JSON.stringify(r));
  const r2 = new Reg().closeLoop([mesh]);
  check('...and so is a mesh with no track at all', r2.closed === 0, JSON.stringify(r2));
}

// ── ONE DEFINITION OF "GO TO A TIME" ──────────────────────────────────────────────────
//
// The timeline's scrub evaluated every mesh AND refreshed the drawn rig; the animation panel's
// transport buttons evaluated every mesh and stopped. The rig is drawn from BATCHED INSTANCE
// BUFFERS rebuilt in Skeleton.updateVisuals, not from the joint objects — so the panel's rewind
// moved the playhead and the joint matrices while the skeleton on screen stayed exactly where it
// was. Measured: the whole instance buffer was byte-identical to the frame it had left. matt:
// "the timeline updates, but the rig doesn't."
//
// Source-anchored, and stated as such: this harness has no scene and no batches. What it can
// hold is that there is ONE seek and that both callers use it — which is the part that went
// wrong, twice over, since the same shape of bug hid the VR snap plane earlier the same day.
{
  const REG = fs.readFileSync(path.join(REPO, 'src/editing/AnimationRegistry.js'), 'utf8');
  const ACP = fs.readFileSync(path.join(REPO, 'src/gui/htmlvr/AnimationControlPanel.js'), 'utf8');
  const TL = fs.readFileSync(path.join(REPO, 'src/gui/GuiTimeline.js'), 'utf8');

  check('the registry owns a seek', /^  seek\(time\) \{/m.test(REG));
  check('...which refreshes the DRAWN rig, not just the data',
    /Skeleton\.updateVisuals\(main\);/.test(REG.slice(REG.indexOf('  seek(time) {'),
      REG.indexOf('  // ── CLOSE THE LOOP'))),
    'writing a joint matrix changes nothing on screen by itself');
  check('...and resets physics, because a jump has no previous frame',
    /PhysicsBones\.reset\(main\)/.test(REG.slice(REG.indexOf('  seek(time) {'),
      REG.indexOf('  // ── CLOSE THE LOOP'))));

  const transport = ['acp-to-start', 'acp-prev-frame', 'acp-next-frame', 'acp-to-end'];
  for (const id of transport) {
    const at = ACP.indexOf("'#" + id + "'");
    const body = ACP.slice(at, at + 320);
    check(id + ' goes through seek', /reg\(\)\?\.seek\(/.test(body),
      'evaluating the meshes by hand is how this drifted apart in the first place');
  }
  check('the timeline scrub uses the same one',
    /if \(reg\) window\._animationRegistry\.seek\(t\);|if \(reg\) reg\.seek\(t\);/.test(TL),
    'two implementations of one idea is the bug, not the symptom');
}

// ── ...AND NO UI SETS THE PLAYHEAD BY HAND ────────────────────────────────────────────
//
// Fixing the animation panel was not enough, because the same code had been written out by hand
// in six places. matt found the next one immediately: "if i load the graph editor, and use the
// 'rewind to first frame' button on that editor, it doesn't update the rig." The timeline
// toolbar's rewind was worse again — it re-evaluated only the ACTIVE mesh, so every other
// animated object stayed on the old frame too.
//
// So the rule is checked rather than the instances: no GUI file may write globalPlaybackTime.
// The places that legitimately still do are not UI — the playback clock, the GLTF exporter
// sampling every frame, the physics bake stepping the range, and MotionTrail — and all of them
// manage their own evaluation deliberately. A seek there would thrash the rig or the sim.
{
  const GUI = ['src/gui/GuiTimeline.js', 'src/gui/GuiAnimation.js', 'src/gui/GuiXR.js',
    'src/gui/vr/GuiVRAnimation.js', 'src/gui/htmlvr/AnimationControlPanel.js'];
  const offenders = [];
  for (const f of GUI) {
    const src = fs.readFileSync(path.join(REPO, f), 'utf8');
    // SEEK-EXEMPT marks a site that snaps the time to a frame boundary before writing a key.
    // Those must NOT seek: evaluating the tracks would overwrite the pose being keyed.
    const lines = src.split('\n');
    let n = 0;
    lines.forEach((l, i) => {
      if (!/globalPlaybackTime\s*=/.test(l)) return;
      const near = lines.slice(Math.max(0, i - 6), i).join('\n');
      if (!/SEEK-EXEMPT/.test(near)) n++;
    });
    if (n) offenders.push(f + ' (' + n + ')');
  }
  check('no GUI file moves the playhead by hand', offenders.length === 0,
    offenders.join(', ') + ' — go through AnimationRegistry.seek, which also refreshes the '
    + 'drawn rig and resets physics');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
