import { SECTION_LABELS } from './htmlvr/MainMenuPanel.js';
import { TAB_ICONS } from './tabIcons.js';
import { ICON_DOCK } from './tabIcons.js';

// A SIDEBAR SECTION, FLOATING OVER THE CANVAS.
//
// The desktop twin of the VR tear-off. Same idea and the same reason: the sidebar shows one
// section at a time, so anything you need *while* working on something else costs a tab
// round-trip. Pinning takes the section out of the strip and leaves it on screen.
//
// Deliberately plain DOM. The VR version has to live in a 3D scene and be rasterised; this one
// is a fixed-position div, and pretending otherwise would buy nothing. What IS shared is the
// section's HTML and its wiring function -- a floating panel is the same section, in a
// different frame, and it must not become a second copy of one.
export class DesktopFloatPanel {
  constructor(opts) {
    this._id = opts.sectionId;
    this._build = opts.build;         // () => html
    this._wire = opts.wire;           // (el, rebuild) => void
    this._onRedock = opts.onRedock;
    this._onMoved = opts.onMoved;     // called when a drag ends, so the position can be saved
    this._el = null;
  }

  get sectionId() { return this._id; }

  // Where it currently is, for persistence. Read from the style rather than the bounding rect:
  // the rect is affected by any transform an ancestor happens to carry, and what has to be
  // saved is the number that will be written back into `left`/`top` on the next load.
  get position() {
    if (!this._el) return { x: 0, y: 0 };
    return { x: parseInt(this._el.style.left, 10) || 0, y: parseInt(this._el.style.top, 10) || 0 };
  }

  mount(x, y) {
    const el = document.createElement('div');
    el.className = 'dfp';
    el.dataset.section = this._id;
    // Stacked down-right from the sidebar so several pinned panels do not land on top of one
    // another; the caller passes the offset it wants.
    el.style.left = (x ?? 80) + 'px';
    el.style.top  = (y ?? 80) + 'px';
    el.innerHTML = `
      <div class="dfp-head">
        <span class="dfp-icon">${TAB_ICONS[this._id] ?? ''}</span>
        <span class="dfp-title">${SECTION_LABELS[this._id] ?? this._id}</span>
        <button class="dfp-dock" title="Return to the sidebar">${ICON_DOCK}</button>
      </div>
      <div class="dfp-body"></div>`;
    document.body.appendChild(el);
    this._el = el;

    el.querySelector('.dfp-dock').addEventListener('click', () => this._onRedock?.(this._id));
    this._wireDrag(el.querySelector('.dfp-head'));
    // Clicking anywhere on a panel raises it, so a stack of them stays workable.
    el.addEventListener('pointerdown', () => this.raise(), true);
    this.rebuild();
    return this;
  }

  rebuild() {
    if (!this._el) return;
    const body = this._el.querySelector('.dfp-body');
    body.innerHTML = this._build();
    this._wire?.(body, () => this.rebuild());
  }

  raise() {
    // One counter for every floating panel, so "most recently touched is on top" holds across
    // all of them rather than per panel.
    DesktopFloatPanel._z = (DesktopFloatPanel._z || 3000) + 1;
    if (this._el) this._el.style.zIndex = String(DesktopFloatPanel._z);
  }

  dispose() {
    this._el?.remove();
    this._el = null;
  }

  // Drag by the title bar, with pointer capture so a fast drag that leaves the header (or the
  // window) does not drop the panel mid-move.
  _wireDrag(head) {
    let ox = 0, oy = 0, dragging = false;
    head.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.dfp-dock')) return;
      dragging = true;
      const r = this._el.getBoundingClientRect();
      ox = e.clientX - r.left; oy = e.clientY - r.top;
      head.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    head.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      // Kept on screen: a panel dragged off the edge cannot be dragged back, and its dock
      // button goes with it.
      const w = this._el.offsetWidth, h = this._el.offsetHeight;
      const nx = Math.min(Math.max(0, e.clientX - ox), Math.max(0, window.innerWidth - 40));
      const ny = Math.min(Math.max(0, e.clientY - oy), Math.max(0, window.innerHeight - 30));
      void w; void h;
      this._el.style.left = nx + 'px';
      this._el.style.top  = ny + 'px';
    });
    const end = (e) => {
      if (!dragging) return;
      dragging = false;
      try { head.releasePointerCapture(e.pointerId); } catch (_) { /* already gone */ }
      // On drag END, not on every move: a pointermove save would write to localStorage a
      // hundred times a second for the whole drag.
      this._onMoved?.(this._id);
    };
    head.addEventListener('pointerup', end);
    head.addEventListener('pointercancel', end);
  }
}

export function injectFloatCSS() {
  if (document.getElementById('dfp-css')) return;
  const st = document.createElement('style');
  st.id = 'dfp-css';
  st.textContent = `
.dfp { position: fixed; z-index: 3000; width: 300px; max-height: 70vh;
  display: flex; flex-direction: column;
  background: #1e1e2e; border: 1px solid #45475a; border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.45); color: #cdd6f4;
  font: 12px/1.4 system-ui, -apple-system, sans-serif; }
.dfp-head { display: flex; align-items: center; gap: 8px; padding: 6px 8px;
  background: #313244; border-radius: 7px 7px 0 0; cursor: move; user-select: none;
  touch-action: none; }
.dfp-title { flex: 1; font-weight: 600; letter-spacing: 0.02em; }
/* THE ICON GOES ON THE PANEL THAT WAS PINNED, so you can tell at a glance which one it is.
   It used to be a row of chips on the main panel instead, which is a list of what is pinned --
   a different thing, and not what was asked for. matt: "i meant in the corner of the panel that
   has been pinned, so its easy to tell at a glance from the icon what panel it is". */
.dfp-icon { display: flex; align-items: center; font-size: 15px; opacity: 0.85; flex-shrink: 0; }
.dfp-dock { background: #45475a; border: 1px solid #585b70; color: #cdd6f4;
  border-radius: 4px; width: 22px; height: 22px; cursor: pointer; line-height: 1; padding: 0; }
.dfp-dock:hover { background: #585b70; }
.dfp-body { overflow-y: auto; padding: 8px; }
/* The section markup already carries its own header row; inside a float panel that repeats
   the title the title bar is already showing, and its pin would float an already-floating
   panel. */
.dfp-body .mm-section-header { display: none; }

/* The pinned strip: one chip per floating section, top left, above everything. */
  background: rgba(30,30,46,0.92); border: 1px solid #45475a; border-radius: 5px;
  color: #cdd6f4; cursor: pointer; }
/* A pinned section's tab: dimmed, because its contents are somewhere else -- but still
   clickable, since what it shows is the placeholder that brings the section back. Matches
   .mm-tab-btn.torn in the VR panel, minus the pointer-events lock. */
/* The ICON, not the host. Web Awesome's <wa-tab> refuses opacity on itself -- an inline
   an inline important opacity on the host still computes to 1 -- so the dimming goes on the span
   we put inside it, which is ordinary light DOM. That is also the more faithful thing to dim:
   what should read as "elsewhere" is the icon, not the tab's hit area. */
wa-tab.tab-pinned > span { opacity: 0.3; }
wa-tab.tab-pinned:hover > span { opacity: 0.65; }

.dfp-away { padding: 12px; color: #a6adc8; display: flex; flex-direction: column;
  gap: 10px; align-items: flex-start; }
`;
  document.head.appendChild(st);
}
