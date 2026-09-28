// The Transform tool's options, in one place, for every panel that shows them.
//
// Built as a shared section for the same reason gui/bonePanel.js is: the wrist MiniPanel and
// the main menu both offer these controls, and this project's recurring bug is the same thing
// implemented twice with a fix landing in only one copy. One builder, one wiring function,
// two dialects of class name.
import getOptionsURL from '../misc/getOptionsURL.js';
import { gizmoSizeMul, GIZMO_MUL_MIN, GIZMO_MUL_MAX } from '../editing/GizmoVR.js';

// Only the class names differ between the panels; the markup and every handler are shared.
const DIALECT = {
  mp: { toggles: 'mp-toggles', toggle: 'mp-toggle-btn',
        row: 'mp-row', lbl: 'mp-lbl', val: 'mp-val',
        divider: '<hr class="mp-divider">', title: '' },
  mm: { toggles: 'mm-choice-grid cols-1', toggle: 'mm-choice',
        row: 'mm-row', lbl: 'mm-lbl', val: 'mm-val',
        divider: '', title: 'mm-section-title' },
};

// THE GIZMO'S SIZE, WHERE THE GIZMO IS.
//
// The multiplier has existed for a while -- the thumbstick drives it while Transform is active,
// and there is a slider for it in Settings -- but that slider is filed under "Controller spike",
// between the stylus length and the stylus tilt, which is nowhere near the thing it resizes.
// matt: "the gizmo definitely needs a size control, either in settings or directly on its
// minipanel options." So it goes in the shared Transform section, which is what both the wrist
// panel and the main menu put on screen when the gizmo is the tool in your hand.
//
// The range and the reader both come from GizmoVR, which is the thing being resized -- see the
// note there. A slider that offered a range the gizmo clamps away would be a control that lies.

// MOVE / ROTATE / SCALE ARE GONE, from both panels, and the audit item that asked for them here
// is answered by their removal.
//
// They lived privately in MiniPanel and the plan was to move them into this shared builder so the
// main panel had them too. Moved, they still did nothing, because TransformVR's `_mode` is DERIVED
// rather than chosen: _updateStateFromGizmo resets it at the top of every grab and sets it from
// which handle you took. A panel button wrote a value the next grab overwrote and that nothing
// read in between. matt: "what are these translate/rotate/scale buttons for? they don't seem to do
// anything useful with the transform gizmo."
//
// They were dead in the wrist panel too, which is why nobody missed them: the gizmo has never been
// modal, you pick the mode by picking a handle. Copying a dead control to a second surface would
// have doubled it rather than fixed it.

// Live value first, saved value second — the same order GizmoVR reads the size multiplier in,
// so a change takes effect this frame and survives the session.
export function freeRotateOn() {
  return window._xfFreeRotate != null
    ? !!window._xfFreeRotate : !!getOptionsURL().xfFreeRotate;
}

export function buildTransformSectionHTML(main, style) {
  const c = DIALECT[style] || DIALECT.mm;
  const on = freeRotateOn();
  const mul = gizmoSizeMul();
  const title = c.title
    ? `<div class="${c.title}">Transform</div>`
    : c.divider;
  return `
    ${title}
    <div class="${c.toggles}">
      <button class="${c.toggle}${on ? ' active' : ''}" id="xf-freerot"
        title="Centre handle carries rotation as well as position (6DOF), like grabbing the object">
        Free rotate ${on ? 'On' : 'Off'}
      </button>
    </div>
    <div class="${c.row}">
      <span class="${c.lbl}">Gizmo size</span>
      <input type="range" id="xf-gizmo-mul" min="${Math.round(GIZMO_MUL_MIN * 100)}"
        max="${Math.round(GIZMO_MUL_MAX * 100)}" step="5" value="${Math.round(mul * 100)}"
        title="How big the transform gizmo is drawn. Same number the thumbstick moves while Transform is active.">
      <span class="${c.val}" id="xf-gizmo-mul-val">${mul.toFixed(2)}x</span>
    </div>
  `;
}

export function wireTransformSection(root, main, opts) {
  // Wired for every tool, so bail when this panel is not currently showing the section.
  const btn = root && root.querySelector('#xf-freerot');
  if (!btn) return;
  opts = opts || {};
  const refresh = opts.refresh || (() => {});

  // ON INPUT, NOT ON CHANGE: GizmoVR reads the multiplier out of the matrix every frame, so the
  // gizmo resizes under your hand as the slider moves -- which is the only way to judge a size.
  //
  // The label is written here AND refresh() is called, because in a headset those are two
  // different jobs: the first changes the DOM, the second is what gets the panel re-rasterised so
  // the change reaches the texture you are looking at. refresh() lands on syncTransformSection,
  // which writes the slider back from the live value -- the same value we just set, so it cannot
  // fight the drag.
  {
    const sIn = root.querySelector('#xf-gizmo-mul');
    const sVal = root.querySelector('#xf-gizmo-mul-val');
    sIn?.addEventListener('input', () => {
      const f = Math.max(GIZMO_MUL_MIN,
        Math.min(GIZMO_MUL_MAX, (parseInt(sIn.value, 10) || 100) / 100));
      window._gizmoSizeMul = f;
      getOptionsURL.saveOption('gizmoSizeMul', f, 500);
      if (sVal) sVal.textContent = f.toFixed(2) + 'x';
      main.render?.();
      refresh();
    });
  }

  btn.addEventListener('click', () => {
    const next = !freeRotateOn();
    window._xfFreeRotate = next;
    getOptionsURL.saveOption('xfFreeRotate', next, 0);
    main.render?.();
    refresh();
  });
}

export function syncTransformSection(root, main) {
  const btn = root && root.querySelector('#xf-freerot');
  if (!btn) return;
  const on = freeRotateOn();
  btn.classList.toggle('active', on);
  btn.textContent = `Free rotate ${on ? 'On' : 'Off'}`;

  // The thumbstick writes the same number, so the slider has to follow it -- otherwise the panel
  // reports a size the gizmo stopped being two clicks ago.
  const sIn = root.querySelector('#xf-gizmo-mul');
  const sVal = root.querySelector('#xf-gizmo-mul-val');
  if (sIn) {
    const mul = gizmoSizeMul();
    sIn.value = String(Math.round(mul * 100));
    if (sVal) sVal.textContent = mul.toFixed(2) + 'x';
  }
}
