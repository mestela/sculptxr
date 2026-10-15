// AN AUDIBLE METRONOME, LOCKED TO THE TRANSPORT.
//
// Beat k sits at k * 60/bpm seconds of TRANSPORT time, so frame 0 is always a downbeat and the
// grid is the same on every pass of a loop. Clicks are scheduled on the audio clock a little
// ahead of the playhead rather than fired from the frame loop: a frame callback is 16ms late
// at best and hitched at worst, a scheduled oscillator is sample-accurate.
//
// LIKE AudioTrack, IT FOLLOWS THE TRANSPORT RATHER THAN HOOKING IT. sync() runs once a frame
// from Scene and reads the transport as it is, so every play path (record, loop, the arrow
// keys) clicks without knowing the metronome exists. It shares AudioTrack's AudioContext --
// Safari caps the number of live contexts and each one is its own audio thread.
//
// Settings are live window globals seeded from the saved options once, the same ladder as the
// scrub grains. EVERY KEY MUST ALSO BE DECLARED IN getOptionsURL.js or it stops persisting.

import getOptionsURL from '../misc/getOptionsURL.js';

// How far ahead of the playhead, in audio seconds, clicks are scheduled. Long enough to ride
// out a dropped frame, short enough that a pause or a seek strands at most one queued click.
const LOOKAHEAD = 0.12;
// A playhead that moved by more than this between frames was moved, not played (seek, loop
// wrap, speed change): drop the schedule and re-derive the next beat from where it landed.
const JUMP = 0.25;

const num = (k, d) => (Number.isFinite(window[k]) ? window[k] : d);

class Metronome {
  constructor() {
    const o = getOptionsURL();
    if (window._metronomeOn === undefined)            window._metronomeOn    = !!o.metronome;
    if (!Number.isFinite(window._metronomeBpm))       window._metronomeBpm   = o.metronomeBpm   ?? 120;
    if (!Number.isFinite(window._metronomeBeats))     window._metronomeBeats = o.metronomeBeats ?? 4;
    if (!Number.isFinite(window._metronomeVol))       window._metronomeVol   = o.metronomeVol   ?? 0.5;
    this._nextBeat = null;
    this._lastTime = null;
    this._scrubLast = null;
  }

  enabled() { return !!window._metronomeOn; }
  bpm() { return Math.max(20, num('_metronomeBpm', 120)); }
  beatsPerBar() { return Math.max(1, Math.round(num('_metronomeBeats', 4))); }

  setEnabled(on) {
    window._metronomeOn = !!on;
    this._nextBeat = null;
    getOptionsURL.saveOption('metronome', !!on);
    // Turned on from a click: the one moment Safari lets the context start.
    if (on) this._ctx();
  }

  _ctx() {
    const ctx = window._audioTrack?._ensureContext?.();
    if (ctx && ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // One click at audio time `when`. Accent is higher and louder; the envelope is a 30ms
  // exponential decay, short enough to read as a tick and not a note.
  _tick(ctx, when, accent) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.value = accent ? 1500 : 1000;
    const peak = Math.max(0.0001, num('_metronomeVol', 0.5)) * (accent ? 1 : 0.7);
    g.gain.setValueAtTime(peak, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.03);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.onended = () => { try { osc.disconnect(); g.disconnect(); } catch (e) { /* gone */ } };
    osc.start(when);
    osc.stop(when + 0.04);
  }

  // Immediate click, for the record count-in (which runs on a wall-clock timer, not the transport).
  click(accent) {
    const ctx = this._ctx();
    if (ctx) this._tick(ctx, ctx.currentTime, accent);
  }

  sync(time, playing, speed, dir) {
    if (!this.enabled() || !playing || dir !== 1 || !(speed > 0)) {
      this._nextBeat = null;
      this._lastTime = null;
      // A paused playhead that moved is a scrub: click each beat line it crosses, in either
      // direction. Same rules as the audio grains -- off with Scrub audio, and a throw of more
      // than GRAIN_MAX_JUMP is a navigation, not something being listened to.
      const prev = this._scrubLast;
      this._scrubLast = time;
      if (!this.enabled() || playing || prev === null || prev === undefined || time === prev) return;
      if (window._audioScrub === false || Math.abs(time - prev) > 0.5) return;
      const spb = 60 / this.bpm();
      const a = Math.floor(prev / spb), b = Math.floor(time / spb);
      if (a === b) return;
      const ctx = this._ctx();
      if (ctx) this._tick(ctx, ctx.currentTime, Math.max(a, b) % this.beatsPerBar() === 0);
      return;
    }
    this._scrubLast = null;
    const ctx = this._ctx();
    if (!ctx) return;

    const spb = 60 / this.bpm();
    if (this._lastTime !== null && (time < this._lastTime || time - this._lastTime > JUMP)) {
      this._nextBeat = null;
    }
    this._lastTime = time;
    // The small epsilon keeps a beat the playhead is sitting exactly on (frame 0 at play).
    if (this._nextBeat === null) this._nextBeat = Math.ceil(time / spb - 1e-4);

    const lStart = window._animLoopStart ?? 0;
    const lEnd = window._animLoopEnd ?? window._animMasterDuration ?? 0;
    const looping = lEnd > lStart && window._animLoopEnabled !== false;
    const horizon = time + LOOKAHEAD * speed;
    const bpb = this.beatsPerBar();

    while (this._nextBeat * spb <= horizon) {
      const bt = this._nextBeat * spb;
      // A beat past the loop end will never be reached; the wrap re-derives from lStart.
      if (looping && bt > lEnd) break;
      this._tick(ctx, ctx.currentTime + Math.max(0, (bt - time) / speed), this._nextBeat % bpb === 0);
      this._nextBeat++;
    }
  }
}

export default Metronome;
