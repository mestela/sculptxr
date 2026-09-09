import Utils from '../../misc/Utils.js';

// ── HSV colour wheel, as plain HTML divs ──────────────────────────────────────────────────────
//
// PURE DIVS AND CSS GRADIENTS, NOT A CANVAS. The VR panels are rasterised through an
// SVG-foreignObject polyfill, and canvas pixel content is not captured by foreignObject — so the
// hue ring is a conic-gradient with a radial mask, the SV square is three stacked linear
// gradients, and every indicator is an absolutely positioned div. That is what makes this the
// only colour control in the app that works in a headset; a native <input type="color"> opens an
// OS dialog, which cannot appear there at all.
//
// LIFTED OUT OF MiniPanel so it is not the paint tool's private widget. It was written for Paint
// and read `tool._color` directly, so when the wireframe needed a colour the apparent options
// were a native input (opens nothing in VR, and nothing on desktop either) or a row of presets.
// Both were wrong, and matt said so: "why? we have a colour picker in the paint tool." The colour
// it edits is now a get/set pair, and the paint-specific chrome — foreground/background swatches,
// swap, eyedropper — is an optional head row rather than part of the widget.
//
// THE GEOMETRY IS DERIVED FROM `size`, and at the paint panel's 216 every constant comes out to
// the number that was hard-coded before: margin 20, ring 176 across at top 40, centre (108, 128),
// outer radius 88, inner 68, ring mid 78, SV square 92 at (62, 82). Anything that was tuned
// against those is untouched.
const HEAD_H = 40;   // the swatch/eyedropper row, in 216-space
const MARGIN = 20;   // ring inset, in 216-space
const BASE   = 216;

function metrics(size, extras) {
  const k = size / BASE;
  const m = MARGIN * k;
  const D = size - 2 * m;              // ring diameter
  const head = extras ? HEAD_H * k : 0;
  const or = D / 2;
  const ir = or * (68 / 88);
  const ss = D * (92 / 176);
  const cx = size / 2, cy = head + D / 2;
  return { k, m, D, head, or: or, ir: ir, mr: (or + ir) / 2, ss,
           sx: cx - ss / 2, sy: cy - ss / 2, cx, cy, h: head + D };
}

// The markup. `prefix` namespaces every id so two wheels can be live at once — the paint panel
// and the settings panel are different panels, but nothing here should depend on that.
export function buildColorWheelHTML(opts) {
  const prefix = opts.prefix;
  const size   = opts.size ?? BASE;
  const extras = !!opts.extras;
  const M = metrics(size, extras);
  const px = (n) => `${n}px`;
  const head = extras ? `
    <div id="${prefix}-bg" style="position:absolute;left:${px(22 * M.k)};top:${px(22 * M.k)};width:${px(26 * M.k)};height:${px(26 * M.k)};border:1.5px solid #585b70;background:#000"></div>
    <div id="${prefix}-fg" style="position:absolute;left:${px(8 * M.k)};top:${px(8 * M.k)};width:${px(26 * M.k)};height:${px(26 * M.k)};border:2px solid #89b4fa;background:#fff"></div>
    <button id="${prefix}-swap" style="position:absolute;left:${px(46 * M.k)};top:${px(10 * M.k)};padding:2px 5px;background:#181825;border:1px solid #45475a;border-radius:4px;color:#a6adc8;font-size:13px;cursor:pointer;outline:none;line-height:1">&#8644;</button>
    <button id="${prefix}-eye" style="position:absolute;right:${px(8 * M.k)};top:${px(10 * M.k)};padding:2px 5px;background:#181825;border:1px solid #45475a;border-radius:4px;color:#6c7086;font-size:11px;cursor:pointer;outline:none;line-height:1">pick</button>` : '';
  return `
    <div id="${prefix}" style="position:relative;width:${px(size)};height:${px(M.h)};background:#1e1e2e;border-radius:8px;overflow:hidden;touch-action:none">
      ${head}
      <div id="${prefix}-ring" style="position:absolute;left:${px(M.m)};top:${px(M.head)};width:${px(M.D)};height:${px(M.D)};border-radius:50%;background:conic-gradient(from 90deg,#f00 0%,#ff0 16.67%,#0f0 33.33%,#0ff 50%,#00f 66.67%,#f0f 83.33%,#f00 100%);-webkit-mask:radial-gradient(circle closest-side,transparent 77%,black 78%);mask:radial-gradient(circle closest-side,transparent 77%,black 78%)"></div>
      <div id="${prefix}-sv" style="position:absolute;left:${px(M.sx)};top:${px(M.sy)};width:${px(M.ss)};height:${px(M.ss)};overflow:hidden">
        <div id="${prefix}-sv-bg" style="position:absolute;top:0;right:0;bottom:0;left:0;background:hsl(0deg,100%,50%)"></div>
        <div style="position:absolute;top:0;right:0;bottom:0;left:0;background:linear-gradient(to right,white,transparent)"></div>
        <div style="position:absolute;top:0;right:0;bottom:0;left:0;background:linear-gradient(to bottom,transparent,black)"></div>
        <div id="${prefix}-sv-i" style="position:absolute;width:${px(12 * M.k)};height:${px(12 * M.k)};border-radius:50%;border:2px solid white;box-sizing:border-box;transform:translate(-50%,-50%)"></div>
      </div>
      <div id="${prefix}-h-i" style="position:absolute;width:${px(14 * M.k)};height:${px(14 * M.k)};border-radius:50%;border:2px solid rgba(0,0,0,0.8);box-sizing:border-box;background:red;transform:translate(-50%,-50%)"></div>
    </div>`;
}

// `opts.get` returns [r,g,b] in 0..1 or null when there is nothing to edit; `opts.set` receives
// the same. Both are called fresh every time rather than captured, because what they read — the
// current tool, the current setting — can change under a live widget.
export class ColorWheel {
  constructor(rootEl, opts) {
    this._root     = rootEl;
    this._get      = opts.get;
    this._set      = opts.set;
    this._extras   = opts.extras || null;   // { secondary, swap, picking, togglePick } or null
    this._prefix   = opts.prefix;
    this._M        = metrics(opts.size ?? BASE, !!opts.extras);
    this._onchange = opts.onchange;
    this._render   = opts.render;           // called on every change, before onchange
    this._region    = null;                 // 'hue' | 'sv' | null
    this._cachedHue = null;
    this._lastSwap  = 0;
    this._lastEye   = 0;

    this._onDown = (e) => this._handleDown(e);
    this._onMove = (e) => { if (this._region) this._handleMove(e); };
    this._onUp   = ()  => { this._region = null; };

    rootEl.addEventListener('pointerdown', this._onDown);
    document.addEventListener('pointermove', this._onMove);
    document.addEventListener('pointerup',   this._onUp);

    this.draw();
  }

  dispose() {
    this._root.removeEventListener('pointerdown', this._onDown);
    document.removeEventListener('pointermove',   this._onMove);
    document.removeEventListener('pointerup',     this._onUp);
  }

  _el(id) { return this._root.querySelector('#' + this._prefix + id); }

  _localXY(e) {
    const r = this._root.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  // ── Draw: update inline styles only — no canvas, no encoding ─────────────────
  draw() {
    const col = this._get();
    if (!col) return;
    const M = this._M;

    const [h, s, v] = Utils.rgb2hsv(col[0], col[1], col[2]);
    const aHue = (this._region === 'sv' && this._cachedHue !== null) ? this._cachedHue : h;

    if (this._extras) {
      const elFg = this._el('-fg');
      if (elFg) elFg.style.background = `rgb(${col[0] * 255 | 0},${col[1] * 255 | 0},${col[2] * 255 | 0})`;
      const sec = this._extras.secondary?.() ?? [0, 0, 0];
      const elBg = this._el('-bg');
      if (elBg) elBg.style.background = `rgb(${sec[0] * 255 | 0},${sec[1] * 255 | 0},${sec[2] * 255 | 0})`;
      const elEye = this._el('-eye');
      if (elEye) elEye.style.color = this._extras.picking?.() ? '#89b4fa' : '#6c7086';
    }

    const elSvBg = this._el('-sv-bg');
    if (elSvBg) elSvBg.style.background = `hsl(${aHue * 360}deg,100%,50%)`;

    const elSvI = this._el('-sv-i');
    if (elSvI) {
      elSvI.style.left        = `${s * 100}%`;
      elSvI.style.top         = `${(1 - v) * 100}%`;
      elSvI.style.borderColor = (v > 0.5 && s < 0.5) ? 'black' : 'white';
    }

    const elHI = this._el('-h-i');
    if (elHI) {
      const ang = aHue * Math.PI * 2;
      elHI.style.left       = `${M.cx + Math.cos(ang) * M.mr}px`;
      elHI.style.top        = `${M.cy + Math.sin(ang) * M.mr}px`;
      elHI.style.background = `hsl(${aHue * 360}deg,100%,50%)`;
    }
  }

  // ── Interaction ───────────────────────────────────────────────────────────────
  _handleDown(e) {
    const [lx, ly] = this._localXY(e);
    const k = this._M.k;

    if (this._extras) {
      // Swap button region (left:46, top:10, ~38px wide, ~22px tall in 216-space)
      if (lx >= 44 * k && lx <= 86 * k && ly >= 8 * k && ly <= 32 * k) {
        const now = performance.now();
        if (now - this._lastSwap > 300) {
          this._lastSwap = now;
          this._extras.swap?.();
          this._render?.(); this.draw(); this._onchange?.();
        }
        return;
      }
      // Eyedropper region (right:8, top:10 -> left ~168 in 216-space)
      if (lx >= 166 * k && lx <= 210 * k && ly >= 8 * k && ly <= 32 * k) {
        const now = performance.now();
        if (now - this._lastEye > 300) {
          this._lastEye = now;
          this._extras.togglePick?.();
          this._render?.(); this.draw(); this._onchange?.();
        }
        return;
      }
    }

    this._handleInteraction(lx, ly);
  }

  _handleMove(e) {
    const [lx, ly] = this._localXY(e);
    this._handleInteraction(lx, ly);
  }

  _handleInteraction(lx, ly) {
    const col = this._get();
    if (!col) return;
    const M = this._M;

    const [h, s, v] = Utils.rgb2hsv(col[0], col[1], col[2]);
    const dx   = lx - M.cx, dy = ly - M.cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const slop = 10 * M.k;

    let inSV  = lx >= M.sx - slop && lx <= M.sx + M.ss + slop
             && ly >= M.sy - slop && ly <= M.sy + M.ss + slop;
    let inHue = dist >= M.ir - slop && dist <= M.or + slop;

    if (this._region === 'sv') {
      inSV = true; inHue = false;
      if (this._cachedHue === null) this._cachedHue = h;
    } else if (this._region === 'hue') {
      inSV = false; inHue = true;
      this._cachedHue = null;
    } else {
      this._cachedHue = null;
      // Overlap zone: prefer exact SV interior
      if (inHue && inSV) {
        if (lx >= M.sx && lx <= M.sx + M.ss
         && ly >= M.sy && ly <= M.sy + M.ss) inHue = false;
        else inSV = false;
      }
    }

    if (inSV) {
      this._region = 'sv';
      const newS = Math.max(0, Math.min(1, (lx - M.sx) / M.ss));
      const newV = Math.max(0, Math.min(1, 1 - (ly - M.sy) / M.ss));
      const aHue = this._cachedHue !== null ? this._cachedHue : h;
      this._set(Utils.hsv2rgb(aHue, newS, newV));
      this._render?.(); this.draw(); this._onchange?.();
    } else if (inHue) {
      this._region = 'hue';
      let ang = Math.atan2(dy, dx);
      if (ang < 0) ang += Math.PI * 2;
      this._set(Utils.hsv2rgb(ang / (Math.PI * 2), s, v));
      this._render?.(); this.draw(); this._onchange?.();
    }
  }
}
