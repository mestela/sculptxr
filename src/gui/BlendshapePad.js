// THE KAOSPAD — four blendshapes from one gesture (roadmap #11).
//
// matt's framing: "a xy controller in space, (or xyz cube in vr), blendshapes get mapped to the
// corners, making it easy to control 4 blendshapes at once with a single gesture/controller."
//
// BIPOLAR AXES, NOT BILINEAR CORNERS, and the difference is the whole feel of the thing.
//
// Corner (bilinear) weights — (1-u)(1-v), u(1-v), (1-u)v, uv — always sum to exactly 1, which
// makes the pad a BLEND SPACE between four complete alternative poses. It has no neutral: the
// centre is all four shapes at 25% at once. That is the right model for four mutually exclusive
// things (four mouth shapes for a vowel space, say) and the wrong one for a face, where neutral
// has to be reachable and where brow-up PLUS smile is a real pose rather than a 50/50 blend of
// two.
//
// So each axis is bipolar and independent: X drives the right shape at +x and the left shape at
// -x, Y likewise, centre is everything at zero. Diagonals give two shapes partly on, additively.
// That is what the box controls on a hand-built face rig actually do, and it is why the centre of
// this pad is a rest pose you can always get back to.
//
// `window._padBilinear = true` switches to the corner model, because the argument above is a
// prediction about how it feels and matt is the one who can check it. One flag rather than a
// rebuild — see weightsFor.
//
// NOTHING HERE WRITES KEYS. Dragging drives AnimationRegistry's PREVIEW layer, which overrides
// the curve without touching it; the value returns to whatever the animation says the moment the
// pad is cleared. Committing is a separate press that writes ordinary keys at the playhead. A pad
// that keyed as it moved would bury the track under every experimental waggle and leave no way to
// try a pose and change your mind.

const SLOTS = ['right', 'left', 'up', 'down'];

// Slot -> the axis reading that drives it. Kept as data because both the weight function and the
// label drawing need the same answer, and two copies of "which corner is +x" would drift.
const SLOT_AXIS = {
  right: (x, y) => Math.max(0, x),
  left:  (x, y) => Math.max(0, -x),
  up:    (x, y) => Math.max(0, y),
  down:  (x, y) => Math.max(0, -y),
};

// Where each slot's label sits, in normalised pad coordinates.
const SLOT_POS = {
  right: [1, 0], left: [-1, 0], up: [0, 1], down: [0, -1],
};

// THE WEIGHTS, exported and pure so the harness can check the arithmetic rather than the drawing.
// `x` and `y` are the handle position in [-1, 1], centre at the origin.
export function weightsFor(x, y, assign, bilinear) {
  const out = {};
  if (bilinear) {
    // The corner model, for comparison: u and v back into [0,1], and the four products. Sums to
    // 1 everywhere, so there is no neutral — which is exactly the property being compared.
    const u = (x + 1) * 0.5, v = (y + 1) * 0.5;
    const w = { left: (1 - u) * (1 - v), right: u * (1 - v), down: (1 - u) * v, up: u * v };
    for (const s of SLOTS) if (assign[s]) out[assign[s]] = (out[assign[s]] || 0) + w[s];
    return out;
  }
  for (const s of SLOTS) {
    const name = assign[s];
    if (!name) continue;
    // ACCUMULATED, NOT ASSIGNED. The same shape can legitimately sit on two slots — putting one
    // shape on both up and down makes a fold-in-half control — and a plain assignment would let
    // whichever slot ran last silently win.
    out[name] = Math.min(1, (out[name] || 0) + SLOT_AXIS[s](x, y));
  }
  return out;
}

class BlendshapePad {
  constructor(main) {
    this._main = main;
    this._host = null;
    this._canvas = null;
    this._ctx = null;
    this._cssW = 280;
    this._cssH = 200;
    this._dpr = window.devicePixelRatio || 1;

    // Slot -> blendshape name. Empty slots simply contribute nothing.
    this._assign = { right: null, left: null, up: null, down: null };

    this._x = 0;         // handle, in [-1, 1]
    this._y = 0;
    this._dragging = false;
    this._slotHit = [];  // { slot, x, y, w, h } for click-to-assign
    this._btns = [];
  }

  mount(host) {
    this._host = host;
    const c = document.createElement('canvas');
    c.style.display = 'block';
    c.style.width = '100%';
    c.style.touchAction = 'none';   // block iPadOS Scribble, as the other canvases do
    host.appendChild(c);
    this._canvas = c;
    this._ctx = c.getContext('2d');

    c.addEventListener('pointerdown', (e) => this._onDown(e));
    window.addEventListener('pointermove', (e) => this._onMove(e));
    window.addEventListener('pointerup', () => this._onUp());
    window.addEventListener('pointercancel', () => this._onUp());
    c.addEventListener('contextmenu', (e) => e.preventDefault());

    this._ro = new ResizeObserver(() => this._relayout());
    this._ro.observe(host);

    window._blendshapePad = this;
    this._relayout();
    return this;
  }

  // IS THE PAD CURRENTLY OVERRIDING THE ANIMATION? Drawn, because it was invisible and that is
  // what made the bug expensive: a preview outranks the keyed curve, so a pad left holding a pose
  // makes those shapes' animation not play — and nothing on screen said so. It read as "playback
  // is broken", not as "the pad is still holding this".
  _holding() {
    const reg = this._reg(), mesh = this._mesh();
    if (!reg || !mesh) return 0;
    const track = reg.tracks.get(mesh.getID());
    return track && track.blendshapePreview ? track.blendshapePreview.size : 0;
  }

  _mesh() { return this._main && this._main.getMesh && this._main.getMesh(); }
  _reg() { return window._animationRegistry; }

  // The shapes on the current mesh, newest first — the same order the stack panel shows, so the
  // number you click in one matches the other.
  shapeNames() {
    const reg = this._reg(), mesh = this._mesh();
    if (!reg || !mesh) return [];
    const track = reg.tracks.get(mesh.getID());
    if (!track || !track.blendshapes) return [];
    return [...track.blendshapes.keys()].reverse();
  }

  assign(slot, name) {
    if (!SLOTS.includes(slot)) return false;
    this._assign[slot] = name || null;
    this._push();
    this.draw();
    return true;
  }

  // Fill the four slots from the first four shapes, so the pad is usable without any setup.
  autoAssign() {
    const names = this.shapeNames();
    SLOTS.forEach((s, i) => { this._assign[s] = names[i] || null; });
    this._push();
    this.draw();
    return this._assign;
  }

  // Drive the preview layer from the handle. ONE recomposite for all four, not one each: every
  // set is a full vertex pass plus a geometry update, and four of those per pointermove is the
  // difference between a pad that tracks your hand and one that lags behind it.
  _push() {
    const reg = this._reg(), mesh = this._mesh();
    if (!reg || !mesh || !reg.setBlendshapePreview) return;
    const w = weightsFor(this._x, this._y, this._assign, !!window._padBilinear);
    let changed = false;

    // RELEASE EVERY SHAPE THIS PAD HAS EVER DRIVEN AND NO LONGER DRIVES.
    //
    // This used to iterate `_assign` and clear the shapes still in it that were not in the new
    // weight set — which covers a slot emptied mid-drag and MISSES the important case entirely:
    // when a slot is REASSIGNED, the outgoing shape is no longer in `_assign`, so nothing ever
    // let go of it. Its preview entry simply stayed in the map for the rest of the session.
    //
    // Two consequences, and matt hit both. Its animation stayed masked (a preview outranks the
    // curve). And `_performedShapes` reads the preview map, so the NEXT take recorded it too —
    // frozen at whatever the pad had last left it at — writing a second flat pass of keys over an
    // already-good performance. matt: "i made 4 eye blendshapes... recorded them. looked great...
    // i then re-enabled the eye blendshapes, the keys have gone weird again. is the record process
    // trying to record extra keys on top of the existing blendshape keys, even when the pad isn't
    // driving them?" Yes, it was.
    //
    // Tracked on the pad rather than by reconciling the whole preview map, so this only ever
    // releases what the PAD put there and never something another caller is holding.
    if (!this._driven) this._driven = new Set();
    for (const n of this._driven) {
      if (!(n in w)) { changed = reg.setBlendshapePreview(mesh, n, null) || changed; }
    }
    this._driven = new Set(Object.keys(w));
    for (const name of Object.keys(w)) {
      changed = reg.setBlendshapePreview(mesh, name, w[name]) || changed;
    }
    if (changed) reg.applyBlendshapes(mesh);
  }

  // Write the previewed pose as ordinary keys at the playhead.
  commit() {
    const reg = this._reg(), mesh = this._mesh();
    if (!reg || !mesh || !reg.commitBlendshapePreview) return 0;
    const n = reg.commitBlendshapePreview(mesh);
    reg.applyBlendshapes(mesh);
    this.draw();
    return n;
  }

  // Back to centre AND out of preview — two different things, and doing only the first would
  // leave a zero override sitting on top of an animated curve, which reads as the animation
  // having broken.
  reset() {
    const reg = this._reg(), mesh = this._mesh();
    this._x = this._y = 0;
    if (reg && mesh && reg.clearBlendshapePreview) reg.clearBlendshapePreview(mesh);
    this.draw();
  }

  _relayout() {
    if (!this._host || !this._canvas) return;
    const w = Math.max(120, this._host.clientWidth || this._cssW);
    this._cssW = w;
    this._cssH = Math.round(w * 0.78);
    this._dpr = window.devicePixelRatio || 1;
    this._canvas.width = Math.round(this._cssW * this._dpr);
    this._canvas.height = Math.round(this._cssH * this._dpr);
    this._canvas.style.height = this._cssH + 'px';
    this.draw();
  }

  // EMBEDDED MODE: draw into someone else's canvas at a given rect, and hit-test in that same
  // canvas's coordinates. The VR blendshape panel is one canvas rasterised to one texture with
  // one hit map, so the pad has to live INSIDE it rather than beside it — a second VR panel
  // would mean a second texture, a second plane and a second hit path for one control.
  //
  // Same object either way. The desktop mount is just the embedded case with its own canvas and
  // an origin of (0, 0), which is what keeps the maths and the feel identical in VR and out.
  embed(ctx, x, y, w, h) {
    this._ctx = ctx;
    this._originX = x; this._originY = y;
    this._cssW = w; this._cssH = h;
    this._embedded = true;
    return this;
  }

  // The square the handle lives in, inset for the labels. In canvas coordinates, so the origin
  // is added here once and every hit test and every draw inherits it.
  //
  // THE INSETS ARE THE LABEL GUTTERS, and they were far too tight — matt: "text for hitzones on
  // all sides too small, too cramped". The side gutters have to hold a shape name and the top and
  // bottom ones a name plus the button row, so they are sized from the font rather than from a
  // number that looked right against one particular panel width.
  _padRect() {
    const g = this._gutter();
    const size = Math.min(this._cssW - g.side * 2, this._cssH - g.top - g.bot);
    return { x: (this._originX || 0) + (this._cssW - size) / 2,
             y: (this._originY || 0) + g.top, s: size };
  }

  // Label/button gutters, derived from the label font so they scale together.
  //
  // THE SIDE LABELS ARE ROTATED, so a side gutter costs the height of a line rather than the
  // width of a word. Horizontal side text meant the gutters had to be wide enough for the longest
  // shape name — which is unbounded, and which squeezed the square down to nothing on a VR panel.
  // matt: "now the label areas take up too much room, making the pad very small. maybe the left
  // and right labels can be rotated?"
  //
  // Left reads bottom-to-top and right reads top-to-bottom, which is his call and also the
  // convention that keeps both label baselines facing OUTWARD from the square — the text leans
  // away from the pad on each side rather than one of them reading upside down.
  _gutter() {
    const f = this._font();
    // The side gutters hold one rotated line, the top one label, the bottom a label plus the
    // button row — so they are not the same multiple. Tight on purpose: every pixel here is a
    // pixel the square does not get, and the square is the control.
    return { side: Math.round(f * 1.5), top: Math.round(f * 1.9), bot: Math.round(f * 2.9) };
  }

  // Label size — FROM THE WIDTH, never the height, and capped.
  //
  // It was min(width, height), which on an embedded pad means the STRIP HEIGHT — and that is a
  // feedback loop against itself: give the strip more room for a bigger square, the font grows,
  // the gutters are multiples of the font, and the gutters eat the room you just added. Measured:
  // raising the strip from 190 to 260 moved the square 115 -> 154 instead of 115 -> 185, with the
  // difference going straight into larger margins.
  //
  // The panel's WIDTH is the stable dimension — it does not change when the rows/pad split moves —
  // so the text size is tied to that, floored for headset legibility and capped so a wide desktop
  // panel does not end up with billboard labels around a small square.
  _font() { return Math.max(13, Math.min(18, Math.round(this._cssW * 0.042))); }

  _onDown(e) {
    const r = this._canvas.getBoundingClientRect();
    this.pointerDown(e.clientX - r.left, e.clientY - r.top);
  }

  // ── Point-based core, in CANVAS coordinates — shared by the mouse and the VR ray, exactly as
  // the stack panel's own core is. The DOM handlers above only convert client space into it.
  pointerDown(mx, my) {

    for (const b of this._btns) {
      if (mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h) {
        if (b.id === 'key') this.commit();
        else if (b.id === 'reset') this.reset();
        else if (b.id === 'auto') this.autoAssign();
        return;
      }
    }
    // NO CLICK-TO-CYCLE HERE ANY MORE. It was O(n) presses to reach one shape with no way back
    // a step, and the only control in this panel whose cost grew with the size of the rig. matt:
    // "fine if there's less than 6 blendshapes, awful if there's 30." Assignment moved to the
    // four side buttons in the stack panel's toolbar; these labels are now display only.
    //
    // `_slotHit` is still built by draw() because the rotated labels need their clip rects, and
    // keeping one source for "where does this label live" is what stops the two drifting.

    const p = this._padRect();
    if (mx < p.x || mx > p.x + p.s || my < p.y || my > p.y + p.s) return;
    this._dragging = true;
    this.pointerMove(mx, my);
  }

  _onMove(e) {
    if (!this._dragging || !this._canvas) return;
    const r = this._canvas.getBoundingClientRect();
    this.pointerMove(e.clientX - r.left, e.clientY - r.top);
  }

  pointerMove(mx, my) {
    if (!this._dragging) return;
    const p = this._padRect();
    // Screen y grows downward and the pad's grows up, which is the one place a VR ray and a
    // mouse could have disagreed — so the flip lives here, in the shared core, not per host.
    this._x = Math.max(-1, Math.min(1, (mx - p.x) / p.s * 2 - 1));
    this._y = Math.max(-1, Math.min(1, -((my - p.y) / p.s * 2 - 1)));
    this._push();
    this.draw();
  }

  _onUp() { this.pointerUp(); }

  pointerUp() {
    if (!this._dragging) return;
    this._dragging = false;
    this.draw();
  }

  // Does this canvas point belong to the pad at all? The host asks before routing, so a press
  // on the rows above never reaches the handle and vice versa.
  hits(mx, my) {
    const p = this._padRect();
    const bottom = (this._originY || 0) + this._cssH;
    return my >= (this._originY || 0) && my <= bottom
      && mx >= (this._originX || 0) && mx <= (this._originX || 0) + this._cssW;
  }

  draw() {
    const ctx = this._ctx;
    if (!ctx) return;
    const W = this._cssW, H = this._cssH, d = this._dpr;
    if (!this._embedded) {
      // Only when the canvas is ours. Embedded, the host owns the transform and the clear —
      // resetting it here would undo the host's own scaling and wipe the rows above.
      ctx.setTransform(d, 0, 0, d, 0, 0);
      ctx.clearRect(0, 0, W, H);
    }

    const p = this._padRect();
    const cx = p.x + p.s / 2, cy = p.y + p.s / 2;

    const holding = this._holding() > 0;
    ctx.fillStyle = '#1e1e2e';
    ctx.fillRect(p.x, p.y, p.s, p.s);
    // A held override gets a warm border — the same signal the handle uses while dragging, so
    // "the pad is driving these shapes" looks the same whether or not your hand is on it.
    ctx.strokeStyle = holding ? '#f9e2af' : '#45475a';
    ctx.lineWidth = holding ? 2 : 1;
    ctx.strokeRect(p.x + 0.5, p.y + 0.5, p.s - 1, p.s - 1);

    // The axes, drawn because the centre being NEUTRAL is the whole model and an unmarked square
    // does not say so.
    ctx.strokeStyle = '#313244';
    ctx.beginPath();
    ctx.moveTo(p.x, cy); ctx.lineTo(p.x + p.s, cy);
    ctx.moveTo(cx, p.y); ctx.lineTo(cx, p.y + p.s);
    ctx.stroke();

    this._slotHit = [];
    const f = this._font();
    const g = this._gutter();
    ctx.font = f + 'px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    for (const s of SLOTS) {
      const [sx, sy] = SLOT_POS[s];
      const name = this._assign[s];
      const gap = Math.round(f * 0.5);
      const lx = cx + sx * (p.s / 2 + gap), ly = cy - sy * (p.s / 2 + gap);
      const label = name || '+';

      // THE HIT ZONE IS THE GUTTER, NOT THE GLYPHS. It used to be the measured text plus three
      // pixels — a target sized to the word, which is hard with a mouse and hopeless with a ray
      // at arm's length. matt: "on desktop assign hitzones too small". Now each label owns the
      // whole strip of gutter on its side of the square, so the thing you aim at is the region
      // the label sits in rather than the letters themselves.
      let hx, hy, hw, hh;
      if (sx !== 0) {                       // left / right: the full side gutter, FULL square-tall
        // Full height now the gutter is narrow — the strip is thin, so it has to be long to stay
        // a realistic ray target.
        hw = g.side; hh = p.s;
        hx = sx > 0 ? p.x + p.s : p.x - g.side;
        hy = p.y;
      } else {                              // up / down: the full width, gutter-tall
        hw = p.s; hh = Math.max(f * 1.9, g.top);
        hx = p.x;
        hy = sy > 0 ? p.y - hh : p.y + p.s;
      }
      this._slotHit.push({ slot: s, x: hx, y: hy, w: hw, h: hh });

      // A faint plate behind an EMPTY slot, so "there is something to assign here" is visible
      // rather than being a lone '+' floating in space.
      if (!name) {
        ctx.fillStyle = 'rgba(88,91,112,0.18)';
        ctx.fillRect(hx, hy, hw, hh);
      }
      ctx.fillStyle = name ? '#cdd6f4' : '#7f849c';

      if (sx !== 0) {
        // ROTATED, running along the side. Centred on the square's midline and clipped to its
        // height, so a long shape name is cut off rather than growing the gutter — the gutter is
        // now a fixed line-height and must stay that way for the square to keep its size.
        ctx.save();
        ctx.beginPath();
        ctx.rect(hx, hy, hw, hh);
        ctx.clip();
        ctx.translate(sx > 0 ? p.x + p.s + hw / 2 : p.x - hw / 2, cy);
        ctx.rotate(sx > 0 ? Math.PI / 2 : -Math.PI / 2);
        ctx.textAlign = 'center';
        ctx.fillText(label, 0, 0);
        ctx.restore();
      } else {
        ctx.textAlign = 'center';
        const ty = sy > 0 ? p.y - Math.round(f * 0.7) : p.y + p.s + Math.round(f * 0.78);
        ctx.fillText(label, lx, ty);
      }
    }

    // The handle, with a line back to centre so the distance from neutral is readable at a glance.
    const hx = cx + this._x * p.s / 2, hy = cy - this._y * p.s / 2;
    ctx.strokeStyle = '#585b70';
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(hx, hy); ctx.stroke();
    ctx.beginPath();
    ctx.arc(hx, hy, this._dragging ? 8 : 6, 0, Math.PI * 2);
    ctx.fillStyle = this._dragging ? '#f9e2af' : '#89b4fa';
    ctx.fill();

    this._btns = [];
    // Sized from the font like everything else here, and tall enough to be a ray target rather
    // than a 16px sliver.
    // Sized so the row and the 'down' label SHARE the bottom gutter without touching, and so the
    // row keeps a margin off the canvas edge — measured, the previous numbers overlapped the label
    // by 4px and sat flush against the bottom of the panel.
    const bh = Math.round(f * 1.4);
    const bw = Math.max(Math.round(f * 3.6), Math.floor((p.s - 12) / 3));
    const by = p.y + p.s + Math.round(f * 1.3);
    let bx = p.x;
    // Reset names what it will actually do: while the pad holds an override it is the thing that
    // gives the animation back, and saying so is the difference between finding that and not.
    for (const [id, text] of [['key', 'Key'], ['reset', holding ? 'Release' : 'Reset'], ['auto', 'Auto']]) {
      ctx.fillStyle = (id === 'reset' && holding) ? '#45403a' : '#313244';
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = '#cdd6f4';
      ctx.textAlign = 'center';
      ctx.fillText(text, bx + bw / 2, by + bh / 2);
      this._btns.push({ id, x: bx, y: by, w: bw, h: bh });
      bx += bw + 6;   // three across, under the square
    }
  }
}

export default BlendshapePad;
