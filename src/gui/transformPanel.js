// The Transform tool's options, in one place, for every panel that shows them.
//
// Built as a shared section for the same reason gui/bonePanel.js is: the wrist MiniPanel and
// the main menu both offer these controls, and this project's recurring bug is the same thing
// implemented twice with a fix landing in only one copy. One builder, one wiring function,
// two dialects of class name.
import getOptionsURL from '../misc/getOptionsURL.js';

// Only the class names differ between the panels; the markup and every handler are shared.
const DIALECT = {
  mp: { toggles: 'mp-toggles', toggle: 'mp-toggle-btn',
        divider: '<hr class="mp-divider">', title: '' },
  mm: { toggles: 'mm-choice-grid cols-1', toggle: 'mm-choice',
        divider: '', title: 'mm-section-title' },
};

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
  `;
}

export function wireTransformSection(root, main, opts) {
  // Wired for every tool, so bail when this panel is not currently showing the section.
  const btn = root && root.querySelector('#xf-freerot');
  if (!btn) return;
  opts = opts || {};
  const refresh = opts.refresh || (() => {});

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
}
