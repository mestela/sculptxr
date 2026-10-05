// VIDEO ON THE TIMELINE.
//
// One clip, a timing reference: the question it answers is "what is on screen at frame 41",
// so the whole design is in service of that frame being exactly right, never of the video
// looking smooth. The transport owns time; this follows it.
//
// NOT AN <video> ELEMENT. currentTime seeks land on the nearest keyframe and decode forward by an
// amount the browser chooses, `requestVideoFrameCallback` reports the frame only after it is on
// screen, and reverse is not a thing. Instead the file is DEMUXED (mediabunny) into a sample
// table -- every frame's exact presentation timestamp and keyframe flag -- and decoded with
// WebCodecs. Frame N is then a known sample, not a time guess, and showing it is: find the
// keyframe at or before N, decode forward to N, draw it. Measured (spike/, 540p, desktop and
// GXR/AVP/Quest/PCVR confirmed usable by hand): H.264 all-intra ~2.5ms a seek, GOP 12 with no
// B-frames ~5ms, a default long-GOP encode ~50ms (frame-exact but too slow to scrub).
// Galaxy XR, flipping two adjacent frames: hardware decode of a GOP clip showed the wrong frame
// ~30% of the time, so GOP clips are decoded in software (see the VideoSampleSink below).
//
// SO IMPORTS ARE EXPECTED TO BE PRE-CONFORMED. For 3D animation work that is a fair ask of the
// user, and it is checked at load: constant frame rate, no B-frames, short GOP. A clip that
// fails still plays frame-exactly, just slower to scrub, so it warns (with the ffmpeg line that
// fixes it) rather than refusing:
//   ffmpeg -i in.mov -vf scale=-2:720 -r 24 -c:v libx264 -g 12 -bf 0 -pix_fmt yuv420p -crf 20 out.mp4
//
// THE ENGINE FOLLOWS THE TRANSPORT; IT DOES NOT HOOK IT. Same contract as AudioTrack: `sync()`
// runs once a frame from Scene's render loop and is level-triggered, so a play, pause, scrub,
// loop wrap or reverse that nobody told us about still lands on the right frame. The frame shown
// is a pure function of the transport time (`frameAt`), so there is no clock to drift and no
// state to resynchronise -- video has no equivalent of the audio node's anchor.
//
// DECODES ARE ASYNC AND LATEST-WINS. getSample() takes milliseconds, and a scrub drag asks for
// a new frame faster than that. Only one decode is ever in flight; whatever the transport wants
// when it finishes is what is decoded next, and the frames in between are skipped. Skipping is
// right for a reference: showing a stale frame late is worse than not showing it.

import { Input, ALL_FORMATS, BlobSource, VideoSampleSink, EncodedPacketSink } from 'mediabunny';

// Wider than this is drawn scaled down. A reference does not need 4K, and the canvas is
// re-uploaded to the GPU on every frame change.
const MAX_WIDTH = 1920;
// Above this a scrub has to decode more than a second of frames from the previous keyframe.
const GOOD_GOP = 30;
// ALL-INTRA (-g 1): every frame is a keyframe, so a seek decodes exactly one frame and nothing
// depends on a neighbour. Measured on the Galaxy XR (flipping 19<->20, pixels compared against a
// settled render): GOP 12 on the hardware decoder returned the WRONG PICTURE ~30% of the time
// (right timestamp, pixels from another frame of the GOP); GOP 12 in software and all-intra in
// either decoder were exact.
const FFMPEG_HINT = 'ffmpeg -i in.mov -vf scale=-2:720 -r 24 -c:v libx264 -g 1 -bf 0'
  + ' -pix_fmt yuv420p -crf 18 -c:a aac out.mp4';

class VideoTrack {

  constructor() {
    this._input = null;
    this._sink = null;
    this._ts = null;          // presentation timestamps, ascending; frame N is _ts[N]
    this._name = '';
    this._offset = 0;         // where frame 0 sits on the timeline, seconds
    this._fps = 0;
    this._warnings = [];
    this._gopMax = 0;

    this._canvas = null;
    this._ctx = null;
    this._shown = -1;         // frame currently on the canvas
    this._want = -1;          // frame the transport wants
    this._busy = false;
    this._iter = null;        // forward-playback decode pipeline (see _fetch); null when scrubbing
    this._iterAt = -1;        // index of the last frame the pipeline delivered
    this._playing = false;
    this._gen = 0;            // bumped on load/clear so a decode that outlives its clip is dropped

    // DECODE DIAGNOSTICS, read with `_videoTrack.stats()` from the console. Cheap enough to be
    // always on: a timestamp compare and a few counters per decoded frame.
    this._stats = { decodes: 0, mismatches: 0, skipped: 0, ms: [], maxMs: 0 };

    // Set by Scene: called after the canvas changed, so the texture can be re-uploaded.
    this.onFrame = null;
    // Set by Scene: called when a clip is loaded or cleared, so the plane can be made or hidden.
    this.onClipChange = null;

    const input = document.getElementById('videoopen');
    if (input) {
      input.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
          this.loadFile(e.target.files[0]);
          input.value = '';
        }
      });
    }
  }

  hasClip() { return !!this._sink; }
  name() { return this._name; }
  canvas() { return this._canvas; }
  aspect() { return this._canvas ? this._canvas.width / this._canvas.height : 16 / 9; }
  fps() { return this._fps; }
  frameCount() { return this._ts ? this._ts.length : 0; }
  duration() { return this._ts ? this._ts.length / this._fps : 0; }
  offset() { return this._offset; }
  warnings() { return this._warnings; }
  shownFrame() { return this._shown; }
  // `skipped` counts frames the transport asked for that were never decoded because a newer one
  // arrived first; `mismatches` counts decodes whose TIMESTAMP differs from the one asked for.
  // It cannot see a frame with the right timestamp and the wrong pixels, which is the failure a
  // hardware decoder showed on GOP clips -- 0 here does not prove the picture is right.
  stats() {
    const ms = this._stats.ms.slice().sort((a, b) => a - b);
    const q = (p) => (ms.length ? +ms[Math.min(ms.length - 1, Math.floor(p * ms.length))].toFixed(1) : 0);
    return { decodes: this._stats.decodes, mismatches: this._stats.mismatches,
      skipped: this._stats.skipped, p50: q(0.5), p95: q(0.95), max: +this._stats.maxMs.toFixed(1),
      hw: window._videoHW || (this._gopMax > 1 ? 'prefer-software (auto)' : 'default'), latency: window._videoLatency !== false };
  }
  setOffset(s) { this._offset = s || 0; this._want = -1; }

  async loadFile(file) {
    if (!file) return false;
    const gen = ++this._gen;
    try {
      const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
      const track = await input.getPrimaryVideoTrack();
      if (!track) throw new Error('no video track');
      if (!(await track.canDecode())) throw new Error(`cannot decode ${track.codec} here`);

      // The packet table is the clip: decode order, with the keyframe flag. Reading it is cheap
      // (no decoding), and it is what the conformance check and the frame index both come from.
      const keys = [], ts = [];
      let prev = -Infinity, reorder = false, i = 0;
      for await (const p of new EncodedPacketSink(track).packets()) {
        if (p.type === 'key') keys.push(i);
        if (p.timestamp < prev) reorder = true;
        prev = p.timestamp;
        ts.push(p.timestamp);
        i++;
      }
      if (gen !== this._gen) { input.dispose?.(); return false; } // superseded while reading
      if (ts.length < 1) throw new Error('no frames');
      ts.sort((a, b) => a - b);

      const n = ts.length;
      const frameDur = n > 1 ? (ts[n - 1] - ts[0]) / (n - 1) : 1 / 24;
      let dMin = Infinity, dMax = -Infinity;
      for (let k = 1; k < n; k++) {
        const d = ts[k] - ts[k - 1];
        if (d < dMin) dMin = d;
        if (d > dMax) dMax = d;
      }
      // Longest run of frames a seek can have to decode forward through.
      let gopMax = keys.length ? n - keys[keys.length - 1] : n;
      for (let k = 1; k < keys.length; k++) gopMax = Math.max(gopMax, keys[k] - keys[k - 1]);

      const warnings = [];
      // 1ms: WebM rounds timestamps to the millisecond, so 24fps wobbles by that much and is
      // still constant. Anything past it is a genuinely irregular frame spacing.
      if (n > 1 && dMax - dMin > 0.0015) {
        warnings.push('variable frame rate: frame numbers will not match the timeline (use -r)');
      }
      if (reorder) warnings.push('has B-frames: scrubbing will be slow (use -bf 0)');
      if (gopMax > GOOD_GOP) warnings.push(`keyframe every ${gopMax} frames: scrubbing will be slow (use -g 1)`);
      else if (gopMax > 1) warnings.push(`keyframe every ${gopMax} frames: decoded in software to stay frame-exact; all-intra (-g 1) is fastest`);

      const w0 = track.displayWidth, h0 = track.displayHeight;
      const scale = Math.min(1, MAX_WIDTH / w0);
      if (!this._canvas) {
        this._canvas = document.createElement('canvas');
        this._ctx = this._canvas.getContext('2d');
      }
      this._canvas.width = Math.round(w0 * scale);
      this._canvas.height = Math.round(h0 * scale);

      this._dropClip();
      this._input = input;
      // SOFTWARE DECODE UNLESS THE CLIP IS ALL-INTRA. A hardware decoder asked for a frame inside
      // a GOP returned the wrong picture under a correct timestamp (see FFMPEG_HINT), which is the
      // one thing a frame reference must not do -- and software was also the faster of the two on
      // the Galaxy XR (33ms vs 61ms at 540p). All-intra clips have nothing to get wrong, so they
      // keep the hardware default.
      //
      // A/B SWITCHES, read once per load (reload the clip after changing them): `_videoHW` =
      // 'prefer-software' | 'prefer-hardware' | 'no-preference' overrides the choice above;
      // `_videoLatency` = false to turn the low-latency hint off. Latency is ON
      // by default because this is decode-on-demand of one frame, never a stream: a hardware
      // decoder that holds output back waiting for more input shows up as a frame arriving late
      // or not at all.
      this._sink = new VideoSampleSink(track, {
        hardwareAcceleration: window._videoHW || (gopMax > 1 ? 'prefer-software' : undefined),
        optimizeForLatency: window._videoLatency !== false,
      });
      this._stats = { decodes: 0, mismatches: 0, skipped: 0, ms: [], maxMs: 0 };
      this._ts = Float64Array.from(ts);
      this._fps = 1 / frameDur;
      this._name = file.name;
      this._warnings = warnings;
      this._gopMax = gopMax;
      this._shown = -1; this._want = -1;

      console.log(`[video] loaded "${file.name}" ${w0}x${h0} ${track.codec} ${n} frames`
        + ` @${this._fps.toFixed(3)}fps, GOP<=${gopMax}`);
      for (const w of warnings) console.warn(`[video] ${w}`);
      if (warnings.length) console.warn(`[video] conform with: ${FFMPEG_HINT}`);

      this.onClipChange?.(true);
      this._request(0);
      return true;
    } catch (e) {
      console.warn(`[video] could not load "${file.name}":`, e && e.message ? e.message : e);
      return false;
    }
  }

  clear() {
    this._dropClip();
    this._name = '';
    this.onClipChange?.(false);
  }

  _closeIter() {
    const it = this._iter;
    this._iter = null; this._iterAt = -1;
    if (it) it.return?.().catch?.(() => {});
  }

  _dropClip() {
    this._gen++;
    this._closeIter();
    if (this._input) { try { this._input.dispose?.(); } catch (e) { /* gone */ } }
    this._input = null; this._sink = null; this._ts = null;
    this._shown = -1; this._want = -1; this._warnings = [];
  }

  // The frame the transport time falls in: the last frame whose timestamp is <= t. Clamped, so
  // outside the clip's span it holds the first or last frame -- an NLE holds the edge frame
  // rather than going black, and a reference that blinks out at the ends is distracting.
  frameAt(time) {
    const ts = this._ts;
    if (!ts) return -1;
    // 0.25ms of slack so a time that is exactly a frame boundary, minus float noise from the
    // transport's accumulated dt, still lands on that frame and not the one before it.
    const t = time - this._offset + ts[0] + 0.00025;
    let lo = 0, hi = ts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ts[mid] <= t) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  // Once per frame. Pure follow: whatever the transport time is, show that frame.
  sync(time, playing, dir) {
    if (!this._sink) return;
    // Only FORWARD playback uses the pipeline. Reverse and scrubbing ask for unrelated frames,
    // which is what a per-frame fetch is for.
    this._playing = !!playing && dir !== -1;
    const f = this.frameAt(time);
    if (f === this._shown && !this._busy) { this._want = f; return; }
    this._request(f);
  }

  _request(f) {
    this._want = f;
    if (this._busy) return;
    this._pump();
  }

  // Index of the frame with exactly this presentation timestamp (nearest, since a decoder may
  // hand back a float that is a hair off the demuxer's).
  _indexOf(t) {
    const ts = this._ts;
    let lo = 0, hi = ts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ts[mid] <= t + 0.25 / this._fps) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  // ONE FRAME, BY THE CHEAPEST ROUTE.
  //
  // SCRUBBING asks for unrelated frames, so each is its own request: getSample finds the keyframe
  // before it and decodes forward. That costs a full decoder round trip -- ~5ms on desktop, but
  // ~70ms on the Galaxy XR's hardware decoder (measured, and it is the same for all-intra, so
  // it is the round trip and not the GOP) -- which is fine for a scrub and far too slow to play at
  // 24fps (the frame budget is 41ms; it lagged ~3 frames and dropped the rest).
  //
  // FORWARD PLAYBACK instead holds ONE decode pipeline open (`samples(start)`) and pulls the
  // next frames from it, so the decoder is fed continuously and is never flushed per frame.
  // Frames the transport has already moved past are pulled and thrown away, which is what
  // keeps the picture on the playhead when decode is briefly slower than real time.
  // The pipeline is restarted whenever the request is not a short hop forward from where it is.
  async _fetch(f, gen) {
    if (!this._playing) {
      this._closeIter();
      // A quarter frame past the timestamp, so a float that lands a hair under the frame
      // boundary still resolves to THIS frame and not the one before it.
      return this._sink.getSample(this._ts[f] + 0.25 / this._fps);
    }
    let it = this._iter;
    if (!it || !(f > this._iterAt && f - this._iterAt <= 12)) {
      this._closeIter();
      it = this._iter = this._sink.samples(this._ts[f] + 0.25 / this._fps);
      this._iterAt = f - 1;
    }
    for (;;) {
      const r = await it.next();
      if (gen !== this._gen || it !== this._iter) { r.value?.close(); return undefined; } // superseded
      if (r.done) { this._closeIter(); return this._sink.getSample(this._ts[f] + 0.25 / this._fps); }
      const idx = this._indexOf(r.value.timestamp);
      this._iterAt = idx;
      if (idx < f) { r.value.close(); continue; } // already behind the playhead
      return r.value;
    }
  }

  async _pump() {
    this._busy = true;
    const gen = this._gen;
    try {
      while (this._sink && gen === this._gen && this._want !== this._shown && this._want >= 0) {
        const f = this._want;
        if (this._shown >= 0 && f - this._shown > 1 && f - this._shown <= 12) this._stats.skipped += f - this._shown - 1;
        const t0 = performance.now();
        const sample = await this._fetch(f, gen);
        const ms = performance.now() - t0;
        if (gen !== this._gen) { sample?.close(); return; }
        if (sample === undefined) continue; // the pipeline was replaced under us; re-ask
        const st = this._stats;
        st.decodes++; st.maxMs = Math.max(st.maxMs, ms);
        if (st.ms.length < 500) st.ms.push(ms); else st.ms[st.decodes % 500] = ms;
        if (sample && Math.abs(sample.timestamp - this._ts[f]) > 0.25 / this._fps) {
          st.mismatches++;
          if (st.mismatches <= 20) {
            console.warn(`[video] asked frame ${f} (t=${this._ts[f].toFixed(4)}) got t=${sample.timestamp.toFixed(4)}`
              + ` (frame ${this.frameAt(sample.timestamp - this._ts[0] + this._offset)}) in ${ms.toFixed(1)}ms`);
          }
        }
        if (sample) {
          sample.draw(this._ctx, 0, 0, this._canvas.width, this._canvas.height);
          sample.close();
          this._shown = f;
          this.onFrame?.(f);
        } else {
          this._shown = f; // nothing decodable there; do not spin on it
        }
      }
    } catch (e) {
      console.warn('[video] decode failed:', e && e.message ? e.message : e);
      this._shown = this._want; // give up on this frame, wait for the transport to move
    } finally {
      this._busy = false;
      // A clip swap while a decode was in flight: the request made meanwhile saw `_busy` and
      // returned, so nobody is left to serve it.
      if (this._sink && this._want >= 0 && this._want !== this._shown) this._pump();
    }
  }
}

export default VideoTrack;
