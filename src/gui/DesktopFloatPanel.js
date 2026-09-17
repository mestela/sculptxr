import { SECTION_LABELS } from './htmlvr/MainMenuPanel.js';
import { groupSectionTitles, wireGroups, uiReorg } from './htmlvr/uiTokens.js';
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
// Small enough to tuck a panel away, large enough that the header, its dock button and the
// resize grip are all still reachable.
const MIN_W = 220;
const MIN_H = 120;

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

  // The size the user dragged it to, or null while it is still at its default. Null rather
  // than the measured rect on purpose: what gets saved has to be a size the user CHOSE, so a
  // panel never restores frozen at whatever height its content happened to need one session.
  get size() {
    if (!this._el) return null;
    const w = parseInt(this._el.style.width, 10);
    const h = parseInt(this._el.style.height, 10);
    return (w > 0 && h > 0) ? { w, h } : null;
  }

  // Width and height as an explicit size, which also lifts the default `max-height: 70vh`.
  // That cap is what keeps an UNSIZED panel from covering the window; once the user has said
  // how tall they want it, a cap silently overriding them reads as the drag not working.
  _applySize(w, h) {
    if (!(w > 0) || !(h > 0)) return;
    const el = this._el;
    el.style.width = Math.round(w) + 'px';
    el.style.height = Math.round(h) + 'px';
    el.style.maxHeight = 'none';
  }

  mount(x, y, size) {
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
      <div class="dfp-body"></div>
      <div class="dfp-grip" title="Drag to resize"></div>`;
    document.body.appendChild(el);
    this._el = el;
    if (size) this._applySize(size.w, size.h);

    el.querySelector('.dfp-dock').addEventListener('click', () => this._onRedock?.(this._id));
    this._wireDrag(el.querySelector('.dfp-head'));
    this._wireResize(el.querySelector('.dfp-grip'));
    // Clicking anywhere on a panel raises it, so a stack of them stays workable.
    el.addEventListener('pointerdown', () => this.raise(), true);
    this.rebuild();
    return this;
  }

  rebuild() {
    if (!this._el) return;
    const body = this._el.querySelector('.dfp-body');
    // KEEP THE SCROLL. A rebuild is somebody else's edit -- a selection, a rename, a rig change
    // -- arriving here; throwing the list back to the top on every one of them means the row you
    // are working on walks off screen as you work on it. The docked sidebar has done this since
    // it was written (see Gui._buildDesktopScene); the floating copy never did, which is why it
    // only jumped when pinned. matt: "the outliner still jumps its scroll when i do any
    // operations or change selection, it should never do this."
    const scrolls = [];
    body.querySelectorAll('.mm-outliner-list').forEach((el, i) => scrolls.push([i, el.scrollTop]));
    body.innerHTML = this._build();
    if (scrolls.length) {
      const lists = body.querySelectorAll('.mm-outliner-list');
      for (const [i, top] of scrolls) if (lists[i]) lists[i].scrollTop = top;
    }
    // Same two passes as every other host of these builders: a floated section must not lose
    // its collapsibles just for being floated. See TornOffPanel for the VR twin of this.
    if (uiReorg()) groupSectionTitles(body);
    wireGroups(body, () => {});
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

  // Drag the bottom-right corner to resize. A hand-built grip rather than CSS `resize: both`:
  // `resize` needs a scroll container, and .dfp is a flex column whose BODY is the scroller --
  // putting `resize` on the panel makes the panel the scroller too and the header scrolls away
  // with the content. It also gives us the pointerup the save hangs off, the same way the move
  // drag does. matt: "the scene panel when pinned should let me resize it."
  _wireResize(grip) {
    if (!grip) return;
    let sx = 0, sy = 0, sw = 0, sh = 0, sizing = false;
    grip.addEventListener('pointerdown', (e) => {
      sizing = true;
      const r = this._el.getBoundingClientRect();
      sx = e.clientX; sy = e.clientY; sw = r.width; sh = r.height;
      grip.setPointerCapture(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
    });
    grip.addEventListener('pointermove', (e) => {
      if (!sizing) return;
      // Floors, not just positives: a panel dragged down to nothing loses its header and with
      // it the only way to move or dock it again.
      this._applySize(Math.max(MIN_W, sw + (e.clientX - sx)), Math.max(MIN_H, sh + (e.clientY - sy)));
    });
    const end = (e) => {
      if (!sizing) return;
      sizing = false;
      try { grip.releasePointerCapture(e.pointerId); } catch (_) { /* already gone */ }
      this._onMoved?.(this._id);      // same debounced save as a move — position and size travel together
    };
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
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
/* FILLS THE PANEL. Without flex:1 the body is content-height, so dragging the panel taller
   just adds empty space under the content instead of showing more of it — which looks exactly
   like the resize doing nothing. min-height:0 is the flexbox part: a flex item will not shrink
   below its content without it, so the body would refuse to scroll and push the panel open. */
.dfp-body { overflow-y: auto; padding: 8px; flex: 1 1 auto; min-height: 0; }
/* THE OUTLINER GROWS WITH THE PANEL. In the sidebar the list is a fixed height the user drags
   (see the wa-tab-panel rule in MainMenuPanel); in a floating panel the PANEL is the thing being
   dragged, so the list should take the room that drag creates. Otherwise the panel gets taller
   and the list stays at its VR height, which looks like the resize not working.
   The body becomes a column and the list's wrapper takes the slack: the toolbar above and the
   add-row below keep their natural height, and everything left over is rows. That is what makes
   "make the pinned scene panel bigger" mean "show me more of the scene".
   SCOPED TO THE SCENE SECTION. Every section shares .dfp-body, and the others are ordinary
   stacked controls that a flex column would stretch.
   resize is OFF here on purpose: the list's own grabber and the panel's sit in the same corner,
   and a dragged height would fight the flex that fills the panel. The panel's grip is the one
   handle, and it does what the list's used to. */
.dfp[data-section="scene"] .dfp-body { display: flex; flex-direction: column; }
.dfp[data-section="scene"] .mm-outliner-wrap { flex: 1 1 auto; min-height: 60px; display: flex; }
.dfp[data-section="scene"] .mm-outliner-list {
  flex: 1 1 auto; height: auto; max-height: none; resize: none;
}
.dfp-grip {
  position: absolute; right: 0; bottom: 0; width: 16px; height: 16px;
  cursor: nwse-resize; touch-action: none;
  /* Two hairlines in the corner, the conventional grabber, drawn rather than imported. */
  background:
    linear-gradient(135deg, transparent 0 46%, #6c7086 46% 54%, transparent 54% 100%),
    linear-gradient(135deg, transparent 0 70%, #6c7086 70% 78%, transparent 78% 100%);
  border-radius: 0 0 7px 0;
}
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
