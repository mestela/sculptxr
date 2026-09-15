// Node harness for src/editing/AudioTrack.js.
//
// The audible behaviour cannot be tested here and is not the risky part. What IS risky is the
// state machine around it: `sync` is level-triggered, runs every frame, and its job is to decide
// between "leave the node alone", "start one" and "stop". Get the middle case wrong in the
// permissive direction and the clip restarts every frame — a buzz, not a voice. Get it wrong in
// the strict direction and a loop wrap never re-anchors, so the second pass plays the wrong
// words. Neither shows up in a screenshot, and both are decided by two numbers.
//
// The other half is `masterTime`, which hands the transport a clock it did not ask for. It has
// to correct slow drift and refuse a discontinuity, and the refusal is the load-bearing half:
// believing the audio one frame after a loop wrap drags the playhead back into the loop it just
// left, which reads as "playback jumps" and points at the transport, not at audio.
//
// Run: node scratchpad/audiotrack_test.mjs
//   AUDIO_INJECT=nostop          sync stops reconciling the inaudible case (audio over a pause)
//   AUDIO_INJECT=alwaysrestart   no drift threshold — re-anchors every frame
//   AUDIO_INJECT=notrustband     masterTime believes the audio clock unconditionally
//   AUDIO_INJECT=nospan          the clip plays outside its own span on the timeline
//   AUDIO_INJECT=peaksample      peaks take one sample per bucket instead of the envelope
import fs from 'fs';

const REPO = '/Users/mattestela/sculptxr';
let SRC = fs.readFileSync(`${REPO}/src/editing/AudioTrack.js`, 'utf8');

// Injections anchor on exact source lines and THROW when the anchor moves. A refactor that
// silently killed the injection would leave every case passing against undamaged code.
const inject = process.env.AUDIO_INJECT || '';
const cut = (anchor, replacement = '') => {
  if (!SRC.includes(anchor)) throw new Error(`inject ${inject}: anchor moved -> ${anchor.trim().slice(0, 60)}`);
  SRC = SRC.replace(anchor, replacement);
};
if (inject === 'nostop') {
  cut('    if (!audible) {\n      this._stop();', '    if (!audible) {');
} else if (inject === 'alwaysrestart') {
  cut('    if (Math.abs(this._audioSrcTime() - srcTime) > RESYNC_THRESHOLD) this._start(srcTime, rate);',
      '    this._start(srcTime, rate);');
} else if (inject === 'notrustband') {
  cut('    if (Math.abs(audioTransport - transportTime) > MASTER_TRUST_BAND) return null;');
} else if (inject === 'nospan') {
  cut(`    if (srcTime < 0 || srcTime >= this._buffer.duration) {
      this._stop();
      this._lastSyncTime = time;
      return;
    }`);
} else if (inject === 'noscrub') {
  cut('      if (!playing) this._maybeScrub(time);');
} else if (inject === 'nograinthrottle') {
  cut(`    if (this._ctx.currentTime - this._lastGrainAt
        < grainOpt('_audioGrainSpacing', GRAIN_THROTTLE)) return;`);
} else if (inject === 'nojumpguard') {
  cut('    if (Math.abs(time - prev) > GRAIN_MAX_JUMP) return;');
} else if (inject === 'rateafteranchor') {
  // Re-cut the anchor AFTER the rate changes, attributing the whole elapsed span to the new
  // rate. The seam this puts in the clock is exactly one speed change wide.
  cut(`    const at = this._audioSrcTime();
    this._anchorSrcTime = at;
    this._anchorCtxTime = this._ctx.currentTime;
    this._rate = rate;`,
      `    this._rate = rate;
    const at = this._audioSrcTime();
    this._anchorSrcTime = at;
    this._anchorCtxTime = this._ctx.currentTime;`);
} else if (inject === 'restartonrate') {
  cut('    this._setRate(rate);');
} else if (inject === 'nopressgrain') {
  cut(`    this._lastSyncTime = time;
    this._grain(srcTime);
  }

  // DECIDE WHETHER THIS FRAME WAS A SCRUB.`,
      `  }

  // DECIDE WHETHER THIS FRAME WAS A SCRUB.`);
} else if (inject === 'pressthrottled') {
  // Make the press respect the grain throttle, which is the bug that was there before: a press
  // that lands inside the tail of the previous grain makes no sound, so the first click after a
  // drag is silent and the whole thing feels laggy.
  cut(`    this._lastSyncTime = time;
    this._grain(srcTime);
  }

  // DECIDE WHETHER THIS FRAME WAS A SCRUB.`,
      `    this._lastSyncTime = time;
    if (this._ctx.currentTime - this._lastGrainAt < 0.05) return;
    this._grain(srcTime);
  }

  // DECIDE WHETHER THIS FRAME WAS A SCRUB.`);
} else if (inject === 'peaksample') {
  cut(`        for (let i = s0; i < s1; i++) {
          const v = data[i];
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }`,
      `        { const v = data[s0]; if (v < lo) lo = v; if (v > hi) hi = v; }`);
}

// --- environment the module expects -------------------------------------------------------

const events = [];
class MockSource {
  constructor(ctx) {
    this._ctx = ctx; this.buffer = null; this._stopped = false;
    this.playbackRate = { value: 1 };
  }
  connect() {}
  disconnect() {}
  start(when, offset, duration) {
    events.push({ op: 'start', offset: offset, duration: duration, rate: this.playbackRate.value });
  }
  stop() { if (this._stopped) throw new Error('already stopped'); this._stopped = true; events.push({ op: 'stop' }); }
}
class MockCtx {
  constructor() { this.currentTime = 0; this.state = 'running'; this.destination = {}; }
  createGain() {
    return { gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {} },
      connect() {}, disconnect() {} };
  }
  createBufferSource() { return new MockSource(this); }
  resume() { this.state = 'running'; events.push({ op: 'resume' }); }
}
globalThis.window = { AudioContext: MockCtx };
globalThis.document = { getElementById: () => null };

// The module is loaded from a data: URL, which has no base to resolve a relative import
// against, so the one import is stripped and replaced with a stub. The stub returns an EMPTY
// options object on purpose: every grain setting then falls through to its compiled default,
// which is the state a fresh install is in and the one the numbers below are written against.
// A stub that returned saved values would make these cases depend on whatever was last dragged.
const savedImport = SRC.match(/^import .*getOptionsURL.*$/m);
if (!savedImport) throw new Error('getOptionsURL import moved — the stub below is now dead');
SRC = SRC.replace(savedImport[0],
  'const getOptionsURL = () => ({}); getOptionsURL.saveOption = () => {};');

const mod = await import('data:text/javascript;base64,' +
  Buffer.from(SRC.replace(/^export default .*;\s*$/m, 'globalThis.__AudioTrack = AudioTrack;')).toString('base64'));
const AudioTrack = globalThis.__AudioTrack;

// A buffer whose sample value IS its index scaled, so a bucket's envelope is predictable.
function makeBuffer(duration, sampleRate = 100, fn = null) {
  const length = Math.round(duration * sampleRate);
  const data = new Float32Array(length);
  for (let i = 0; i < length; i++) data[i] = fn ? fn(i, length) : Math.sin(i * 0.5);
  return { duration, length, sampleRate, numberOfChannels: 1, getChannelData: () => data };
}

function track(duration = 4) {
  const at = new AudioTrack();
  at._ensureContext();
  at._buffer = makeBuffer(duration);
  at._name = 'test.wav';
  return at;
}
// Advance the mock audio hardware clock and the transport together, the way real time does.
function tick(at, seconds) { at._ctx.currentTime += seconds; }

// --- cases ---------------------------------------------------------------------------------

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' :: ' + detail : ''}`); }
};
const starts = () => events.filter(e => e.op === 'start');
const stops = () => events.filter(e => e.op === 'stop');
const reset = () => { events.length = 0; };

console.log('\nsync: when the clip is audible');
{
  const at = track();
  reset();
  at.sync(0, false, 1, 1);
  check('paused starts nothing', starts().length === 0);

  at.sync(1.0, true, 1, 1);
  check('playing starts at the transport position', starts().length === 1 && Math.abs(starts()[0].offset - 1.0) < 1e-9,
    JSON.stringify(starts()));

  reset();
  at.sync(1.0, true, 0.5, 1);
  check('half speed plays, at half rate', starts().length === 0 && at._source.playbackRate.value === 0.5,
    JSON.stringify(events) + ' rate=' + at._source.playbackRate.value);

  reset();
  at.sync(1.0, true, 1, -1);
  check('reverse is silent', starts().length === 0);

  reset();
  at.sync(1.0, true, 1, 1);
  at.sync(1.0, false, 1, 1);
  check('a pause stops the node', stops().length === 1, JSON.stringify(events));
}

console.log('\nsync: the clip has a span, and outside it there is silence');
{
  const at = track(4);
  at.setOffset(2);           // clip sits at t=2..6 on the timeline
  reset();
  at.sync(1.0, true, 1, 1);
  check('before the clip start: nothing plays', starts().length === 0);

  at.sync(3.0, true, 1, 1);
  check('inside the clip: starts one second in', starts().length === 1 && Math.abs(starts()[0].offset - 1.0) < 1e-9,
    JSON.stringify(starts()));

  reset();
  at.sync(7.0, true, 1, 1);
  check('past the clip end: stops', starts().length === 0 && stops().length === 1);
}

console.log('\nsync: a node already in the right place is left alone');
{
  const at = track();
  reset();
  at.sync(0, true, 1, 1);
  check('first frame starts once', starts().length === 1);

  // Twenty frames of ordinary playback: both clocks advance together.
  let t = 0;
  for (let i = 0; i < 20; i++) { tick(at, 1 / 60); t += 1 / 60; at.sync(t, true, 1, 1); }
  check('steady playback never re-anchors', starts().length === 1,
    `${starts().length} starts in 20 frames — the clip is restarting, which is a buzz`);

  // Sampling skew short of the threshold must not re-anchor either.
  at.sync(t + 0.04, true, 1, 1);
  check('40ms of skew is tolerated', starts().length === 1);
}

console.log('\nsync: a seek re-anchors');
{
  const at = track();
  reset();
  at.sync(0, true, 1, 1);
  tick(at, 0.5);
  at.sync(3.0, true, 1, 1);      // playhead dragged
  check('a jump re-anchors at the new position', starts().length === 2
    && Math.abs(starts()[1].offset - 3.0) < 1e-9, JSON.stringify(starts()));
}

console.log('\nmasterTime: correct drift, refuse a discontinuity');
{
  const at = track();
  reset();
  at.sync(0, true, 1, 1);
  tick(at, 1.0);

  // The transport thinks 1.02s has passed; the sound hardware says 1.0. Audio wins.
  const corrected = at.masterTime(1.02);
  check('small drift is corrected toward the audio clock',
    corrected !== null && Math.abs(corrected - 1.0) < 1e-9, String(corrected));

  // A loop wrap: the transport has just jumped to the top of the range and the node has not
  // been re-anchored yet. Believing the audio here drags the playhead back to the end.
  check('a loop wrap is refused', at.masterTime(0.01) === null, String(at.masterTime(0.01)));

  // Nothing playing: nothing to say.
  at.sync(0, false, 1, 1);
  check('silence offers no clock', at.masterTime(0.5) === null);

  const at2 = track();
  reset();
  at2.sync(0, true, 1, 1);
  at2.setMuted(true);
  check('muted offers no clock', at2.masterTime(0) === null);
}

console.log('\npeaks: an envelope, not a resampling');
{
  // A signal that is silent except for one spike per bucket. Sampling misses the spike;
  // taking the envelope cannot.
  const at = new AudioTrack();
  at._ensureContext();
  const N = 8192;
  const spikeAt = 7;  // a sample most bucket-strides will step straight over
  at._buffer = makeBuffer(4, N * 4 / 4, (i) => (i % 16 === spikeAt ? 1.0 : 0.0));
  const p = at.peaks();
  check('bucket count is the declared resolution', p.count === N, String(p.count));

  let maxSeen = 0;
  for (let b = 0; b < p.count; b++) maxSeen = Math.max(maxSeen, p.max[b]);
  check('the envelope finds the peaks between samples', maxSeen === 1.0,
    `max across all buckets was ${maxSeen} — a sampled waveform, which aliases under zoom`);

  check('peaks are cached, not recomputed', at.peaks() === p);
  at.clear();
  check('clear drops the cache', at._peaks === null && !at.hasClip());
}

console.log('\nspeed: the node is re-rated, not restarted');
{
  const at = track();
  reset();
  at.sync(0, true, 1, 1);
  check('1x starts at rate 1', starts().length === 1 && starts()[0].rate === 1);

  tick(at, 0.5);
  at.sync(0.5, true, 0.5, 1);
  check('a speed change does not restart the clip', starts().length === 1,
    `${starts().length} starts — a stop/start on every speed click is an audible seam`);
  check('the node carries the new rate', at._source.playbackRate.value === 0.5);
  check('the clock is continuous across the change', Math.abs(at._audioSrcTime() - 0.5) < 1e-9,
    String(at._audioSrcTime()));

  // Half speed: one second of context time is half a second of buffer.
  tick(at, 1.0);
  check('buffer time advances at the new rate', Math.abs(at._audioSrcTime() - 1.0) < 1e-9,
    String(at._audioSrcTime()));
  // ...and the transport, advancing at dt*speed, agrees, so nothing re-anchors.
  at.sync(1.0, true, 0.5, 1);
  check('half speed holds sync without re-anchoring', starts().length === 1,
    JSON.stringify(starts()));

  // Same instant, new rate -- the only thing that changed is the speed control. Advancing the
  // transport as well would make this a seek, which SHOULD restart, and would prove nothing
  // about re-rating.
  reset();
  at.sync(1.0, true, 2, 1);
  check('2x also re-rates rather than restarting', starts().length === 0
    && at._source.playbackRate.value === 2, JSON.stringify(starts()));
}

console.log('\nscrub: a paused playhead that moves makes a sound');
{
  const at = track();
  reset();
  at.sync(1.0, false, 1, 1);
  check('the first paused frame is silent (no previous position to move from)', starts().length === 0);

  tick(at, 1 / 60);
  at.sync(1.05, false, 1, 1);
  check('a dragged playhead fires a grain', starts().length === 1, JSON.stringify(starts()));
  check('the grain is short and bounded', starts()[0]?.duration > 0 && starts()[0]?.duration <= 0.09,
    String(starts()[0]?.duration));
  check('the grain is AT the playhead', Math.abs((starts()[0]?.offset ?? -99) - 1.05) < 1e-9);

  // A held playhead is not a scrub, however many frames go by.
  reset();
  for (let i = 0; i < 10; i++) { tick(at, 1 / 60); at.sync(1.05, false, 1, 1); }
  check('a stationary playhead stays silent', starts().length === 0);

  // Consecutive frames of a real drag must not each fire: grains overlap, and one per frame
  // at 90fps is a buzz rather than speech.
  reset();
  let t = 1.05;
  for (let i = 0; i < 12; i++) { tick(at, 1 / 90); t += 0.01; at.sync(t, false, 1, 1); }
  check('grains are throttled below frame rate', starts().length > 0 && starts().length <= 4,
    `${starts().length} grains in 12 frames`);

  // Throwing the playhead across the clip is navigation, not listening. The tick clears the
  // grain throttle first — without that the throttle is what makes this silent, the jump guard
  // is never consulted, and the case passes with the guard deleted.
  reset();
  tick(at, 0.5);
  at.sync(1.10, false, 1, 1);   // a normal step, to set a recent previous position
  reset();
  tick(at, 0.5);
  at.sync(3.9, false, 1, 1);
  check('a large jump is silent', starts().length === 0, JSON.stringify(starts()));

  // Scrubbing outside the clip's span is silent too.
  reset();
  at.setOffset(10);
  at.sync(0.5, false, 1, 1);
  tick(at, 1 / 60);
  at.sync(0.55, false, 1, 1);
  check('scrubbing outside the clip is silent', starts().length === 0);
}

console.log('\nscrub: the press itself always sounds');
{
  const at = track();
  reset();
  // Settle: the playhead is parked and sync has seen it, so there is no MOVE to report.
  at.sync(1.0, false, 1, 1);
  at.sync(1.0, false, 1, 1);
  check('a parked playhead is silent', starts().length === 0);

  at.scrubTouch(1.0);
  check('pressing on the parked playhead sounds', starts().length === 1, JSON.stringify(starts()));
  check('the press sounds AT the playhead', Math.abs(starts()[0]?.offset - 1.0) < 1e-9);

  // The frame after the press must not double up: the press claimed the position.
  reset();
  tick(at, 1 / 60);
  at.sync(1.0, false, 1, 1);
  check('the following sync does not double the grain', starts().length === 0);

  // A press immediately after a drag grain still sounds — the throttle is for drags, and a
  // press that lands in the tail of a previous grain going silent IS the lag complaint.
  reset();
  tick(at, 0.005);
  at.scrubTouch(1.2);
  check('a press ignores the drag throttle', starts().length === 1, JSON.stringify(starts()));

  // The usual guards still apply.
  reset();
  at.setMuted(true);
  at.scrubTouch(1.4);
  check('a press while muted is silent', starts().length === 0);
  at.setMuted(false);

  reset();
  window._audioScrub = false;
  at.scrubTouch(1.5);
  check('a press with scrub audio off is silent', starts().length === 0);
  window._audioScrub = true;

  reset();
  at.scrubTouch(99);
  check('a press outside the clip is silent', starts().length === 0);
}

console.log('\ngrain settings: the live values are what the engine uses');
{
  const at = track();
  reset();
  at.sync(1.0, false, 1, 1);
  window._audioGrainSec = 0.2;
  tick(at, 1);
  at.scrubTouch(1.0);
  check('grain length follows the setting', Math.abs(starts()[0]?.duration - 0.2) < 1e-9,
    String(starts()[0]?.duration));

  // A non-finite value falls through to the default rather than scheduling NaN, which would
  // silently schedule nothing at all and read as "scrubbing broke".
  reset();
  window._audioGrainSec = NaN;
  tick(at, 1);
  at.scrubTouch(1.0);
  check('a broken setting falls back to the default', Math.abs(starts()[0]?.duration - 0.09) < 1e-9,
    String(starts()[0]?.duration));
  delete window._audioGrainSec;

  // Spacing drives the drag throttle.
  const at2 = track();
  reset();
  window._audioGrainSpacing = 0.5;
  at2.sync(1.0, false, 1, 1);
  let t2 = 1.0;
  for (let i = 0; i < 10; i++) { tick(at2, 1 / 60); t2 += 0.01; at2.sync(t2, false, 1, 1); }
  check('a wide spacing thins the grains out', starts().length <= 1,
    `${starts().length} grains where spacing is 500ms`);
  delete window._audioGrainSpacing;
}

console.log('\nscrub: playback is not a scrub');
{
  const at = track();
  reset();
  at.sync(0, true, 1, 1);
  const before = starts().length;
  for (let i = 0; i < 10; i++) { tick(at, 1 / 60); at.sync((i + 1) / 60, true, 1, 1); }
  check('playing fires no grains', starts().length === before, JSON.stringify(starts()));

  // Reverse is silent rather than a stream of backwards grains.
  reset();
  at.sync(0.5, true, 1, -1);
  tick(at, 1 / 60);
  at.sync(0.48, true, 1, -1);
  check('reverse playback is silent', starts().length === 0);
}

console.log('\nimport routing: which files are audio');
{
  // Pulled out of the REAL SculptGL.js rather than restated here, so a change to the pattern
  // either shows up in these cases or fails the extraction outright. The import path is the one
  // that works on Vision Pro, so what it does and does not claim matters.
  const gl = fs.readFileSync(`${REPO}/src/SculptGL.js`, 'utf8');
  const m = gl.match(/static isAudioFile\(name\) \{\s*return ([^;]+);\s*\}/);
  if (!m) throw new Error('SculptGL.isAudioFile moved — this section is testing nothing');
  const isAudio = new Function('name', `return ${m[1]};`);

  for (const n of ['line.mp3', 'LINE.MP3', 'take.wav', 'a.ogg', 'a.oga', 'v.m4a', 'x.aac',
                   'y.flac', 'z.opus', 'old.aif', 'old.aiff']) {
    check(`${n} is audio`, isAudio(n) === true);
  }
  for (const n of ['head.obj', 'scene.sxr', 'a.glb', 'b.stl', 'c.ply', 'notes.txt', '']) {
    check(`${n || '(empty)'} is not audio`, isAudio(n) === false);
  }
  // getFileType matches with `includes`, so it would claim this one as an obj. The audio test
  // anchors on the END of the name and is checked first, which is the whole reason it can.
  check('take3.obj.mp3 is audio, not an obj', isAudio('take3.obj.mp3') === true);
  check('song.mp3.obj is NOT audio', isAudio('song.mp3.obj') === false);
}

console.log(`\n${pass} passed, ${fail} failed${inject ? `  [inject=${inject}]` : ''}`);
process.exit(fail ? 1 : 0);
