// THE FLAT-SCREEN MARKING MENU — the desktop and iPad skin of the VR radial.
//
// The command model was cross-platform from the start: Scene._resolveRadialCommands and
// _resolvePinCommands return plain { label, icon, enabled, run, sub } lists, and the VR wheel is
// only one way of drawing them. What flat screens had was a canvas copy inside the TIMELINE
// toolbar, which is the wrong place for commands whose whole rule is "act on the thing you are
// pointing at" — a toolbar button points at nothing, so it could only ever use the selection.
// matt: "we now have a lot of functionality in marking menus that aren't exposed in desktop."
//
// So this opens AT THE POINTER, over the viewport, and the subject resolves exactly as it does in
// the headset: the preselected joint first, the selection second.
//
// A DOM OVERLAY, following ModifierButton — same reasoning, same z-order neighbourhood. The
// timeline's copy is canvas because it lives inside a canvas; nothing here does.
//
// SUBMENUS FLY OUT ON HOVER, beside the parent rather than replacing it. The radial replaces,
// because a wheel has one ring's worth of room and you push outward through it with a controller;
// a screen has space to the side and a pointer that can rest on a row without committing to it.
// matt: "can the submenus open up on hover rather than on click, we have enough space to show
// them." Clicking a parent opens it too, for anyone who clicks first.

const ID = 'viewport-menu';
const SUB_ID = 'viewport-menu-sub';

const CSS = `
#${ID}, #${SUB_ID} {
  /* ABOVE THE PANELS. It was 45, and the sidebar is 1050 with the topbar at 1100 -- so a menu
     opened near the right of the viewport was drawn UNDERNEATH them and simply disappeared.
     matt: "the r.click menu often draws offscreen, under the panel." Above all the chrome and
     still far below the modal overlays and toasts, which sit at 999999 and should cover this. */
  position: fixed; z-index: 1250; display: none;
  min-width: 168px; max-width: 260px; padding: 4px;
  background: rgba(30, 30, 46, 0.96);
  border: 1px solid rgba(205, 214, 244, 0.28); border-radius: 8px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.45);
  font: 500 13px/1 system-ui, sans-serif; color: #cdd6f4;
  user-select: none; -webkit-user-select: none;
}
#${SUB_ID} { z-index: 1251; }
.vm-item {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 9px; border-radius: 5px; cursor: pointer; white-space: nowrap;
}
.vm-item:hover { background: #313244; }
/* Dimmed rather than removed, the same rule the radial uses: a command that is not available
   right now is still a fact about the tool, and a list that changes length between openings is
   one you cannot learn the shape of. */
.vm-item.disabled { color: #6c7086; cursor: default; }
.vm-item.disabled:hover { background: none; }
.vm-chev { margin-left: auto; color: #7f849c; }
/* The open parent stays lit while its children are up, so it is clear which row they belong to. */
.vm-item.open { background: #313244; }
`;

export default class ViewportMenu {
  constructor(main) {
    this._main = main;
    this._el = null;
    this._sub = null;
    this._build();
  }

  _build() {
    if (!document.getElementById(ID + '-css')) {
      const style = document.createElement('style');
      style.id = ID + '-css';
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    const mk = (id) => {
      let e = document.getElementById(id);
      if (!e) { e = document.createElement('div'); e.id = id; document.body.appendChild(e); }
      return e;
    };
    this._el = mk(ID);
    // The flyout is a SECOND element sharing the panel styling, so a submenu is never clipped by
    // its parent's box and can be positioned against the window on its own.
    this._sub = mk(SUB_ID);

    // CLOSE ON ANY PRESS OUTSIDE, captured so it runs before the canvas can start a stroke with
    // the same press — dismissing a menu should not also sculpt.
    document.addEventListener('pointerdown', (e) => {
      if (!this.isOpen()) return;
      if (this._el.contains(e.target) || this._sub.contains(e.target)) return;
      this.close();
      e.preventDefault();
      e.stopPropagation();
    }, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.close(); });
  }

  isOpen() { return !!this._el && this._el.style.display === 'block'; }

  // `cmds` is the command list; x/y are client coordinates — the pointer that asked for it.
  open(cmds, x, y) {
    if (!cmds || !cmds.length) return false;
    this._closeSub();
    this._render(this._el, cmds);
    this._place(this._el, x, y);
    return true;
  }

  close() {
    if (this._el) this._el.style.display = 'none';
    this._closeSub();
  }

  _closeSub() {
    if (this._sub) this._sub.style.display = 'none';
    if (this._el) this._el.querySelectorAll('.vm-item.open').forEach((r) => r.classList.remove('open'));
  }

  // THE ROOM IS THE VIEWPORT, NOT THE WINDOW.
  //
  // The window is wider than the 3D view by the whole sidebar, so a menu opened near the right
  // of the viewport had "room" by this measure and was then covered by the panel sitting in it.
  // matt: "it should either draw on top of everything, or be aware of the right side edge, and
  // avoid it." Both, as it turns out: the z-index above puts it over the panels, and this keeps
  // it off them in the first place, which is the better of the two -- a menu ON the sidebar
  // still hides whatever you were reading there.
  //
  // Falls back to the window when there is no viewport element, and when the menu is simply
  // taller or wider than the viewport -- being clipped by the window is the lesser evil, and
  // clamping to a box it cannot fit in would push it off the other edge instead.
  _bounds() {
    const host = document.getElementById('viewport') || document.getElementById('canvas');
    const w = window.innerWidth, h = window.innerHeight;
    if (!host) return { left: 0, top: 0, right: w, bottom: h };
    const r = host.getBoundingClientRect();
    return {
      left: Math.max(0, r.left), top: Math.max(0, r.top),
      right: Math.min(w, r.right), bottom: Math.min(h, r.bottom),
    };
  }

  _place(el, x, y) {
    el.style.display = 'block';
    el.style.left = '0px';
    el.style.top = '0px';
    const r = el.getBoundingClientRect();
    const b = this._bounds();
    // Flipped rather than clamped when it would run off: a menu pinned to the edge covers the
    // thing you opened it on, which on a rig is the joint you were aiming at.
    let left = (x + r.width > b.right) ? x - r.width : x;
    let top = (y + r.height > b.bottom) ? y - r.height : y;
    // ...and clamped after the flip, because flipping past the near edge is the same problem
    // mirrored -- a press close to the left edge flips a wide menu off the screen entirely.
    left = Math.max(b.left, Math.min(left, Math.max(b.left, b.right - r.width)));
    top = Math.max(b.top, Math.min(top, Math.max(b.top, b.bottom - r.height)));
    el.style.left = Math.round(left) + 'px';
    el.style.top = Math.round(top) + 'px';
  }

  // Beside its row, flipped to the other side of the PARENT when there is no room — the parent's
  // width is what a flyout has to clear, not the pointer's position.
  _placeSub(row) {
    const sub = this._sub;
    sub.style.display = 'block';
    sub.style.left = '0px';
    sub.style.top = '0px';
    const pr = this._el.getBoundingClientRect();
    const rr = row.getBoundingClientRect();
    const sr = sub.getBoundingClientRect();
    const b = this._bounds();
    let left = pr.right - 2;
    if (left + sr.width > b.right) left = pr.left - sr.width + 2;
    left = Math.max(b.left, Math.min(left, Math.max(b.left, b.right - sr.width)));
    let top = rr.top - 4;
    if (top + sr.height > b.bottom) top = b.bottom - sr.height;
    top = Math.max(b.top, Math.min(top, Math.max(b.top, b.bottom - sr.height)));
    sub.style.left = Math.round(left) + 'px';
    sub.style.top = Math.round(top) + 'px';
  }

  _openSub(row, cmds) {
    if (!cmds || !cmds.length) { this._closeSub(); return; }
    this._closeSub();
    row.classList.add('open');
    this._render(this._sub, cmds);
    this._placeSub(row);
  }

  _render(el, cmds) {
    el.innerHTML = '';
    for (const c of cmds) {
      const row = document.createElement('div');
      row.className = 'vm-item' + (c.enabled === false ? ' disabled' : '');
      const label = document.createElement('span');
      label.textContent = c.label;
      row.appendChild(label);
      if (c.sub) {
        const chev = document.createElement('span');
        chev.className = 'vm-chev';
        chev.textContent = '›';
        row.appendChild(chev);
      }
      if (c.enabled !== false) {
        // HOVER OPENS, AND HOVERING ANY OTHER ROW CLOSES. Root rows only: the command model is
        // one level deep, and a flyout that spawned its own would have nowhere to put it.
        if (el === this._el) {
          row.addEventListener('mouseenter', () => {
            if (c.sub) this._openSub(row, c.sub());
            else this._closeSub();
          });
        }
        row.addEventListener('click', () => {
          // A SUBMENU IS NOT A COMMAND. The radial makes the same distinction: pushing past the
          // rim opens the children and does not run the wedge, so `run` on a parent is a no-op
          // there and must be one here too.
          if (c.sub) { this._openSub(row, c.sub()); return; }
          this.close();
          try { c.run?.(); } catch (err) { console.error('[viewport menu] command failed', err); }
        });
      }
      el.appendChild(row);
    }
  }
}
