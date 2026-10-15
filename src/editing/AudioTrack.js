// AUDIO ON THE TIMELINE.
//
// One clip, decoded whole into memory, scheduled against the animation transport. Built for
// lipsync and timing reference, which is why it is a single track rather than a mixer: the
// question being asked of it is "what does the character say on frame 41", not "how does the
// mix sit".
//
// THE WHOLE FILE IS DECODED UP FRONT (decodeAudioData -> AudioBuffer, float32 PCM in RAM) and
// scrubbing is therefore NOT a seek. There is no such thing as seeking an AudioBuffer: you
// stop the node you had and start(when, offset) a new one at the sample you want. That is
// sample-accurate, which is roughly two thousand times finer than the frame grid the timeline
// snaps to, so "frame accurate audio scrubbing" costs nothing to get right. A minute of 44.1k
// stereo is ~21MB, so a lipsync-length clip is not worth streaming.
//
// THE ENGINE FOLLOWS THE TRANSPORT; IT DOES NOT HOOK IT. `window._animPlaying` is written from
// about twenty-five places across the registry, the panels, the timeline, MotionTrail,
// PhysicsBones and Skinning -- every one of them a play, pause, stop, scrub, bake or
// suppress-while-solving. Hooking that many call sites would mean hooking the next one too,
// and missing it. Instead `sync()` runs ONCE PER FRAME from Scene's render loop, looks at the
// transport state as it actually is, and reconciles: it is level-triggered, not edge-triggered,
// so a play path nobody remembered to tell us about still starts the audio.
//
// THREE WAYS TO HEAR IT, because the transport has three modes and only one of them is
// playback. Playing forward at any speed is the node running at that playbackRate (pitched, see
// _start). Dragging the playhead is granular scrubbing -- there is no rate during a drag, only a
// position, so the clip is played in short overlapping windows AT the playhead (see _grain).
// Reverse is silent: playbackRate cannot go negative and doing it properly means a reversed copy
// of the buffer, which nobody has asked for yet.

import getOptionsURL from '../misc/getOptionsURL.js';

// Peak buckets used for waveform display. 8192 over a 30-second clip is ~3.7ms per bucket,
// which still resolves individual consonants when the timeline is zoomed into a word.
const PEAK_BUCKETS = 8192;

// How far the audio clock may sit from the transport before we stop believing we are playing
// the same moment and re-anchor the node. A loop wrap or a playhead drag jumps by far more
// than this; ordinary frame-to-frame sampling skew is well under it (one frame at 30fps is
// 33ms, and the two clocks both advance in real time so the error does not accumulate within
// a frame). Re-anchoring is a stop/start, i.e. audible, so the threshold has to clear normal
// jitter with room to spare.
const RESYNC_THRESHOLD = 0.06;

// The band in which the audio clock is treated as a CORRECTION to the transport rather than a
// contradiction of it. Inside this, audio is right and the accumulated dt is drifting; outside
// it, something discontinuous happened (seek, wrap, speed change) and the transport is right.
const MASTER_TRUST_BAND = 0.25;

// SCRUB GRAINS. Dragging a playhead is not playback -- there is no rate, only a position that
// keeps changing -- so the only way to hear it is to repeatedly play a short window of the clip
// AT the playhead. That is what every NLE and DAW does, and the two numbers below are the whole
// design: a window long enough to carry a vowel, restarted often enough that consecutive windows
// overlap rather than gap. Overlap is what makes a drag sound continuous instead of stuttered,
// so the throttle MUST be shorter than the grain.
//
// THE THREE NUMBERS ARE TUNABLE AT RUNTIME, because what they should be depends on the material:
// dialogue wants a longer grain than a drum track, and a slow careful scrub wants different
// spacing from a fast one. Declared here as defaults and read through `grainOpt` -- live window
// value first, then the saved setting, then the default -- the same live/saved/default ladder
// the bone display flags use. EVERY KEY BELOW MUST ALSO BE DECLARED IN getOptionsURL.js or it
// silently stops persisting; the constructor seeds the window globals from there once.
const GRAIN_SEC = 0.09;
const GRAIN_THROTTLE = 0.05;
// Each grain is faded in and out. A buffer cut at an arbitrary sample starts and ends on a step,
// and a step is a click; at 4ms the ramp is inaudible as a ramp but removes the edge. Without
// this, scrubbing is a burst of clicks with the dialogue somewhere underneath it.
const GRAIN_FADE = 0.004;

// Live value, saved value, then the compiled default. Non-finite window values (a cleared
// setting, a typo in the console) fall through rather than poisoning the schedule with NaN --
// a NaN duration silently schedules nothing at all, which would read as "scrubbing broke".
const grainOpt = (winKey, dflt) => {
  const v = window[winKey];
  return Number.isFinite(v) ? v : dflt;
};
// A drag can cross a second of audio in a frame. Past this, consecutive grains have nothing to
// do with each other and the result is noise rather than speech, so we stay quiet -- a fast
// throw of the playhead is a navigation, not something anyone is listening to.
const GRAIN_MAX_JUMP = 0.5;

class AudioTrack {

  constructor() {
    this._ctx = null;
    this._buffer = null;
    this._gainNode = null;
    this._source = null;

    this._name = '';
    // Where the clip starts on the timeline, in seconds. Negative pre-rolls it.
    this._offset = 0;
    // A/V SYNC. `_lead` is how far AHEAD of the transport the sound is played, in seconds: the
    // output path's own delay (measured, see _updateLead) plus the user's manual advance
    // (`window._avOffsetMs`, saved). See sync().
    this._lat = null;
    this._lead = 0;
    try {
      const saved = parseFloat(localStorage.getItem('sxr_avOffsetMs'));
      if (window._avOffsetMs === undefined && Number.isFinite(saved)) window._avOffsetMs = saved;
    } catch (e) { /* storage blocked: the offset just starts at 0 */ }
    this._gain = 1.0;
    this._muted = false;

    // Anchor for the audio clock: the context time at which the node was started, the
    // position within the buffer it was started at, and the rate it has been running at
    // since. The rate belongs in the anchor because it is what converts elapsed context
    // time into elapsed BUFFER time, and it can change without the node restarting.
    this._anchorCtxTime = 0;
    this._anchorSrcTime = 0;
    this._rate = 1;

    // Scrub state: the transport time seen on the previous sync, and when the last grain
    // was fired. Both live here rather than at the call site because sync() is the only
    // thing that knows a scrub happened -- nobody reports one.
    this._lastSyncTime = null;
    this._lastGrainAt = -1;

    this._peaks = null;

    // Seed the live grain globals from the saved settings, once. Guarded so a value already
    // set -- by a settings panel built before this, or from the console -- is not stamped over.
    const _o = getOptionsURL();
    if (!Number.isFinite(window._audioGrainSec))     window._audioGrainSec     = _o.audioGrainSec     ?? GRAIN_SEC;
    if (!Number.isFinite(window._audioGrainSpacing)) window._audioGrainSpacing = _o.audioGrainSpacing ?? GRAIN_THROTTLE;
    if (!Number.isFinite(window._audioGrainFade))    window._audioGrainFade    = _o.audioGrainFade    ?? GRAIN_FADE;
    if (!Number.isFinite(window._audioWaveGain))     window._audioWaveGain     = _o.audioWaveGain     ?? 1;
    if (window._audioScrub === undefined)            window._audioScrub        = _o.audioScrub !== false;

    const input = document.getElementById('audioopen');
    if (input) {
      input.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
          this.loadFile(e.target.files[0]);
          input.value = ''; // reset so the same file can be picked twice
        }
      });
    }
  }

  // An AudioContext created before a user gesture is born suspended and stays that way. Every
  // entry point into this class is downstream of a click (the file picker, the play button),
  // so constructing it lazily here is enough -- there is no need for a document-wide
  // first-gesture listener.
  _ensureContext() {
    if (!this._ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      this._ctx = new Ctor();
      this._gainNode = this._ctx.createGain();
      this._gainNode.gain.value = this._muted ? 0 : this._gain;
      this._gainNode.connect(this._ctx.destination);
    }
    return this._ctx;
  }

  // RESUME FROM A REAL GESTURE. Safari will not start an AudioContext outside a user
  // activation, and `resume()` called from the render loop is not one -- on visionOS and iOS a
  // context created during a file load can sit suspended forever, so the waveform draws, the
  // playhead runs and nothing is heard. Deliberately does NOT create a context: a user who
  // never loads a clip should not pay for an audio thread just for clicking the timeline.
  unlock() {
    if (this._ctx && this._ctx.state === 'suspended') this._ctx.resume();
  }

  hasClip() { return !!this._buffer; }
  name() { return this._name; }
  duration() { return this._buffer ? this._buffer.duration : 0; }
  offset() { return this._offset; }
  gain() { return this._gain; }
  isMuted() { return this._muted; }

  setOffset(s) { this._offset = s || 0; this._stop(); }
  setMuted(m) {
    this._muted = !!m;
    if (this._gainNode) this._gainNode.gain.value = this._muted ? 0 : this._gain;
    if (this._muted) this._stop();
  }
  setGain(g) {
    this._gain = Math.max(0, Math.min(2, g));
    if (this._gainNode && !this._muted) this._gainNode.gain.value = this._gain;
  }

  loadFile(file) {
    if (!file) return Promise.resolve(false);
    const ctx = this._ensureContext();
    if (!ctx) {
      console.warn('[audio] no AudioContext available');
      return Promise.resolve(false);
    }
    return file.arrayBuffer()
      .then((arr) => ctx.decodeAudioData(arr))
      .then((buf) => {
        this._stop();
        this._buffer = buf;
        this._name = file.name;
        this._peaks = null;
        console.log(`[audio] loaded "${file.name}" ${buf.duration.toFixed(2)}s`
          + ` ${buf.numberOfChannels}ch @${buf.sampleRate}Hz`);
        window._mediaRef?.applyLoaded('audio', this, file);   // a scene saved with this file
        return true;
      })
      .catch((e) => {
        // A decode failure is almost always an unsupported container rather than a broken
        // file -- browsers decode what they can PLAY, so .ogg on Safari and some .wav
        // variants land here. Say which file, so the message is actionable.
        console.warn(`[audio] could not decode "${file.name}":`, e && e.message ? e.message : e);
        return false;
      });
  }

  clear() {
    this._stop();
    this._lastSyncTime = null;
    this._buffer = null;
    this._peaks = null;
    this._name = '';
    this._offset = 0;
  }

  _stop() {
    if (this._source) {
      try { this._source.stop(); } catch (e) { /* already ended */ }
      try { this._source.disconnect(); } catch (e) { /* already detached */ }
      this._source = null;
    }
  }

  // Start the clip at `srcTime` seconds into the buffer, now, running at `rate`.
  _start(srcTime, rate) {
    const ctx = this._ctx;
    if (!ctx || !this._buffer) return;
    this._stop();
    const src = ctx.createBufferSource();
    src.buffer = this._buffer;
    // PITCHED, NOT TIME-STRETCHED. playbackRate resamples, so half speed is an octave down --
    // a tape machine, which is also what Maya and Premiere do by default and what everyone
    // reading a performance at half speed already expects. Preserving pitch means a phase
    // vocoder or WSOLA (soundtouch / rubberband) running in an AudioWorklet; worth adding if
    // the pitch turns out to get in the way of the timing read, but it is a dependency and a
    // worklet, and this is one line.
    src.playbackRate.value = rate;
    src.connect(this._gainNode);
    // SCHEDULED AT A KNOWN CONTEXT TIME, not "now". start(0) begins at the next block the audio
    // thread renders, and on the Galaxy XR blocks are 107ms apart, so "now" was somewhere in a
    // 107ms window and the anchor below (ctx.currentTime, equally stale) could not say where. A
    // start a fixed beat ahead has an exact anchor; the clip is begun that far INTO itself so it
    // is where the transport wants it when it actually starts.
    // On the very first start the smoothed clock has not seen a block yet and can read up to one
    // block (107ms) behind; pad the lead by one so `when` cannot already be in the past.
    const now = this._ctxNow();
    const delta = 0.12 + (this._clockReady() ? 0 : 0.11);
    const when = now + delta;
    const startPos = Math.max(0, srcTime) + delta * rate;
    src.start(when, startPos);
    this._source = src;
    this._rate = rate;
    this._anchorCtxTime = when;
    this._anchorSrcTime = startPos;
  }

  // A SMOOTH AUDIO CLOCK. `AudioContext.currentTime` is a STAIRCASE: it moves once per hardware
  // block (measured on the Galaxy XR: 106.7ms steps, ~9Hz). The transport is slaved to the audio
  // clock (AnimationRegistry reads masterTime every frame), so a staircase there made the 3D
  // animation advance in ~9Hz hops -- the "choppy playback with audio".
  //
  // currentTime lags the true clock by anywhere from 0 to one block, never leads it. So the
  // true offset between the audio clock and performance.now() is the UPPER ENVELOPE of
  // (currentTime - now) over the readings: a reading taken just after a step is nearly exact.
  // The envelope decays very slowly to follow real drift between the two clocks.
  // The clock is `ready` once a full block has been seen.
  _ctxNow() {
    const c = this._ctx;
    const now = performance.now() / 1000;
    if (this._k === null || this._k === undefined) { this._k = null; this._kSince = now; }
    const obs = c.currentTime - now;
    if (this._k === null || obs > this._k) this._k = obs;
    else this._k -= 0.0002 * Math.max(0, now - (this._kT || now));
    this._kT = now;
    return now + this._k;
  }
  _clockReady() { return this._kSince !== undefined && performance.now() / 1000 - this._kSince > 0.2; }

  // CHANGE SPEED WITHOUT RESTARTING. Restarting to change rate is a stop and a start, which is
  // an audible seam every time you touch the speed control. Setting playbackRate live is
  // seamless, but it invalidates the clock anchor -- elapsed context time now converts to
  // buffer time at a different ratio -- so the anchor is re-cut at the current position first,
  // in that order. Re-cutting it afterwards would attribute the whole elapsed span to the NEW
  // rate and jump the reported position.
  _setRate(rate) {
    if (!this._source || rate === this._rate) return;
    const at = this._audioSrcTime();
    this._anchorSrcTime = at;
    this._anchorCtxTime = this._ctxNow();
    this._rate = rate;
    this._source.playbackRate.value = rate;
  }

  // Where the playing node believes it is, in buffer seconds. Null when nothing is playing.
  // THE DELAY BETWEEN "THE CONTEXT IS RENDERING THIS" AND "IT IS COMING OUT OF THE SPEAKER".
  //
  // The transport is a picture clock: the 3D scene and the video show the frame for transport
  // time T when T arrives. Audio scheduled at context time T is only HEARD a little later, by
  // the whole output path -- on the Galaxy XR measured at ~0.47s (baseLatency 0.107 + output
  // 0.368, and getOutputTimestamp agrees). Uncorrected, the voice trails the mouth by ~11 frames.
  //
  // getOutputTimestamp() is the measured figure (the context time the device is playing right
  // now); base+outputLatency is the fallback. Smoothed, because a source re-anchored on a
  // jittery target would restart for nothing.
  _updateLead() {
    const c = this._ctx;
    let auto = 0;
    if (c && window._avAutoLatency !== false) {
      let l = 0;
      try {
        const o = c.getOutputTimestamp && c.getOutputTimestamp();
        if (o && o.contextTime > 0) l = c.currentTime - o.contextTime;
      } catch (e) { /* not implemented */ }
      if (!(l > 0.001 && l < 1)) l = (c.baseLatency || 0) + (c.outputLatency || 0);
      l = Math.min(1, Math.max(0, l));
      this._lat = this._lat === null ? l : this._lat * 0.95 + l * 0.05;
      auto = this._lat;
    }
    this._lead = auto + (window._avOffsetMs || 0) / 1000;
    return this._lead;
  }
  // For the menu label: the automatic part, in ms.
  latencyMs() { return Math.round((this._lat || 0) * 1000); }
  setAdvanceMs(ms) {
    window._avOffsetMs = Number.isFinite(ms) ? ms : 0;
    try { localStorage.setItem('sxr_avOffsetMs', String(window._avOffsetMs)); } catch (e) { /* fine */ }
    this._stop();   // re-anchored on the next sync, at the new lead
  }

  _audioSrcTime() {
    if (!this._source || !this._ctx) return null;
    return this._anchorSrcTime + (this._ctxNow() - this._anchorCtxTime) * this._rate;
  }

  // ONE SCRUB GRAIN: a short window of the clip at the playhead, faded at both ends, fired and
  // forgotten. It runs on its own gain node rather than the master one so an overlapping pair
  // fade independently -- sharing a ramp would make the second grain's attack cancel the
  // first's release and put the click back.
  _grain(srcTime) {
    const ctx = this._ctx;
    if (!ctx || !this._buffer) return;
    if (ctx.state === 'suspended') ctx.resume();

    const fade = grainOpt('_audioGrainFade', GRAIN_FADE);
    const dur = Math.min(grainOpt('_audioGrainSec', GRAIN_SEC), this._buffer.duration - srcTime);
    if (dur <= fade * 2) return;

    const g = ctx.createGain();
    const t0 = ctx.currentTime;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(this._muted ? 0 : this._gain, t0 + fade);
    g.gain.setValueAtTime(this._muted ? 0 : this._gain, t0 + dur - fade);
    g.gain.linearRampToValueAtTime(0, t0 + dur);
    g.connect(ctx.destination);

    const src = ctx.createBufferSource();
    src.buffer = this._buffer;
    src.connect(g);
    // Disconnect on end. A grain fires up to twenty times a second while dragging, so leaving
    // the nodes attached grows the graph for as long as the drag lasts.
    src.onended = () => { try { src.disconnect(); g.disconnect(); } catch (e) { /* gone */ } };
    src.start(0, srcTime, dur);
    this._lastGrainAt = t0;
  }

  // A PRESS IS A REQUEST TO HEAR THE PLAYHEAD, and it is the one scrub event the level-
  // triggered path cannot see. `_maybeScrub` fires on the playhead MOVING, so pressing and
  // holding without moving -- or clicking on the frame the playhead is already on -- produced
  // no sound at all, and the first thing you heard came only once you had dragged far enough
  // for a frame to tick. matt: "if i click or click and hold in place nothing plays, it should
  // always play something on that first click ... i suspect that is where the lag impression
  // comes from." He is right: the latency was never in the audio path, it was silence waiting
  // for movement.
  //
  // Deliberately ignores the grain throttle. The throttle exists to stop a continuous drag
  // firing a grain per frame; a press is not a continuous anything, and "always plays" is the
  // entire point of this method.
  scrubTouch(time) {
    if (!this._buffer || !this._ctx || this._muted) return;
    if (window._audioScrub === false || window._animPlaying) return;
    const srcTime = time - this._offset;
    if (srcTime < 0 || srcTime >= this._buffer.duration) return;
    // Claim this position as the last one seen, so the sync that runs a frame later does not
    // read the press itself as a move and double up on it.
    this._lastSyncTime = time;
    this._grain(srcTime);
  }

  // DECIDE WHETHER THIS FRAME WAS A SCRUB. Nothing reports a scrub -- the playhead is dragged
  // by the desktop timeline, the VR timeline, the arrow keys and seek(), and none of them has
  // any reason to know audio exists. What they all have in common is that the transport time
  // changed while the transport was not playing, which is observable from here.
  _maybeScrub(time) {
    if (this._muted || window._audioScrub === false) return;
    const prev = this._lastSyncTime;
    if (prev === null || time === prev) return;
    if (Math.abs(time - prev) > GRAIN_MAX_JUMP) return;

    const srcTime = time - this._offset;
    if (srcTime < 0 || srcTime >= this._buffer.duration) return;
    if (this._ctx.currentTime - this._lastGrainAt
        < grainOpt('_audioGrainSpacing', GRAIN_THROTTLE)) return;
    this._grain(srcTime);
  }

  // RECONCILE THE NODE WITH THE TRANSPORT. Called once per frame, whatever the transport is
  // doing -- including when it is doing nothing, which is how a pause reaches the audio.
  sync(time, playing, speed, dir) {
    if (!this._buffer || !this._ctx) return;

    // Reverse is the one transport state with no rate: playbackRate cannot go negative, and
    // playing backwards properly means keeping a reversed copy of the buffer. Silent for now.
    const rate = dir === 1 ? speed : 0;
    const audible = playing && !this._muted && rate > 0;

    if (!audible) {
      this._stop();
      // A PAUSED PLAYHEAD THAT MOVED IS A SCRUB, and this is the only place that can tell.
      // Gated on `playing` rather than on the time change alone, so reverse playback stays
      // silent rather than turning into a stream of backwards grains nobody asked for.
      if (!playing) this._maybeScrub(time);
      this._lastSyncTime = time;
      return;
    }

    // An immersive session can suspend the context on entry; resume is a no-op when running.
    if (this._ctx.state === 'suspended') this._ctx.resume();

    // PLAYED AHEAD BY THE OUTPUT DELAY, so it is HEARD on the transport's beat. The first `lead`
    // seconds of playback from a standing start are therefore silent -- that sound would have had
    // to be heard before play was pressed.
    const lead = this._updateLead();
    const srcTime = time - this._offset + lead;
    // Outside the clip's span on the timeline. The transport carries on; there is simply
    // nothing to hear, which is the same answer as a gap in any NLE.
    if (srcTime < 0 || srcTime >= this._buffer.duration) {
      this._stop();
      this._lastSyncTime = time;
      return;
    }

    const now = this._audioSrcTime();
    if (now === null) { this._start(srcTime, rate); this._lastSyncTime = time; return; }
    // Rate first: a speed change moves the clock, so testing drift against the OLD rate would
    // read the change itself as drift and restart the clip -- a click on every speed click.
    this._setRate(rate);
    if (Math.abs(this._audioSrcTime() - srcTime) > RESYNC_THRESHOLD) this._start(srcTime, rate);
    this._lastSyncTime = time;
  }

  // THE AUDIO CLOCK AS TRANSPORT MASTER, offered as a correction rather than taken as one.
  //
  // `AudioContext.currentTime` and `performance.now()` are different clocks -- the audio one is
  // the sound hardware's -- and a transport that accumulates dt against the second will slide
  // against the first. On a dialogue take that slide is the whole problem: the mouth and the
  // voice separate over the length of the line, which is exactly the thing you loaded audio in
  // order to judge.
  //
  // Returns a corrected transport time, or null to leave the transport alone. Null is the
  // answer whenever the two disagree by more than MASTER_TRUST_BAND, because a disagreement
  // that large is not drift -- it is a seek, a loop wrap or a speed change that the transport
  // has just performed and the node has not been re-anchored to yet. Believing the audio there
  // would drag the playhead back to the end of the loop it just left.
  masterTime(transportTime) {
    const srcNow = this._audioSrcTime();
    // Not until the smoothed clock has seen a whole hardware block: before that it can be a
    // block (107ms) off, and the transport would be dragged to it.
    if (srcNow === null || this._muted || !this._clockReady()) return null;
    const audioTransport = srcNow + this._offset - this._lead;
    if (Math.abs(audioTransport - transportTime) > MASTER_TRUST_BAND) return null;
    return audioTransport;
  }

  // MIN/MAX PER BUCKET, computed once per clip. A waveform is not a resampling of the signal --
  // drawing every Nth sample of a 44.1kHz buffer into 900 pixels aliases into noise that
  // changes shape as you zoom. The envelope of each bucket is what reads as a waveform, and it
  // is stable under zoom because the buckets are finer than the pixels.
  peaks() {
    if (this._peaks) return this._peaks;
    if (!this._buffer) return null;

    const n = PEAK_BUCKETS;
    const min = new Float32Array(n);
    const max = new Float32Array(n);
    const chans = this._buffer.numberOfChannels;
    const len = this._buffer.length;
    const per = len / n;

    for (let c = 0; c < chans; c++) {
      const data = this._buffer.getChannelData(c);
      for (let b = 0; b < n; b++) {
        const s0 = Math.floor(b * per);
        const s1 = Math.min(len, Math.floor((b + 1) * per));
        let lo = c === 0 ? Infinity : min[b];
        let hi = c === 0 ? -Infinity : max[b];
        for (let i = s0; i < s1; i++) {
          const v = data[i];
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        min[b] = lo === Infinity ? 0 : lo;
        max[b] = hi === -Infinity ? 0 : hi;
      }
    }
    // NORMALISED FOR DISPLAY. A quiet clip drew as a flat line, so the envelope is scaled up
    // until its loudest peak fills the lane; the sound itself is untouched. Capped, so a clip
    // that is essentially silence is not blown up into noise.
    let top = 0;
    for (let b = 0; b < n; b++) top = Math.max(top, -min[b], max[b]);
    this._peaks = { min: min, max: max, count: n, norm: top > 1e-4 ? Math.min(50, 1 / top) : 1 };
    return this._peaks;
  }
}

export default AudioTrack;
