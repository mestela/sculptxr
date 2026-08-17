import Enums from '../misc/Enums.js';
import Skeleton from '../editing/Skeleton.js';
import Skinning from '../editing/Skinning.js';
import SkinMesh from '../editing/SkinMesh.js';
import IKSolver from '../editing/IKSolver.js';

// The Bones tool's controls, in ONE place, for every panel that shows them.
//
// They started life inside the VR wrist panel, which meant the whole rigging feature —
// bind, capsules, Make Skin, Bind Pose, Key Pose, every display toggle — did not exist on
// iPad or desktop at all. The two surfaces have different chrome (the wrist panel's `mp-`
// classes, the menu/sidebar's `mm-`) but identical behaviour, so the markup is generated in
// either dialect while the wiring and the state sync are shared outright.
//
// Element ids are the same in both, and every lookup is scoped to the panel root that owns
// it, so two panels can be live at once (the sidebar and the wrist panel, say) without
// fighting over each other's buttons.

// Modes with no 2D input path, shown DISABLED on a flat screen rather than left to look
// available and do nothing. Empty since every mode gained a mouse/touch path in BoneDrawTool
// (screen-plane drag for Tweak and IK, camera-axis sweep for Pose, distance-from-shaft for
// Radius) — kept as the one place to re-gate a mode if a future one is genuinely 6DOF-only.
const XR_ONLY_MODES = [];

const MODES = [
  ['draw', 'Draw'],
  ['fk', 'Tweak FK'],
  ['free', 'Tweak Free'],
  ['pose', 'Pose'],
  ['radius', 'Radius'],
  ['ik', 'IK'],
];

// Class dialects. `grid`/`toggle`/`action` are the three shapes the panel uses.
const DIALECT = {
  mp: { grid: 'mp-voxel-grid', gridBtn: 'mp-voxel-btn', toggles: 'mp-toggles',
        toggle: 'mp-toggle-btn', row: 'mp-row', lbl: 'mp-lbl', val: 'mp-val',
        btnRow: 'mp-btn-row', action: 'mp-action-btn', divider: 'mp-divider',
        title: '' },
  mm: { grid: 'mm-choice-grid cols-3', gridBtn: 'mm-choice', toggles: 'mm-choice-grid cols-3',
        toggle: 'mm-choice', row: 'mm-row', lbl: 'mm-lbl', val: 'mm-val',
        btnRow: 'mm-choice-grid cols-2', action: 'mm-choice', divider: '',
        title: 'mm-section-title' },
};

function pinLabel(n) { return n ? `Clear Pins (${n})` : 'Clear Pins'; }

// `isXR` decides whether the controller-only modes are offered. It is asked of the app, not
// of the dialect: the `mm` markup is used by the desktop sidebar AND by the main menu inside
// a headset, so keying it to the class names would disable the modes in the one place they
// actually work.
export function buildBoneSectionHTML(main, style) {
  const c = DIALECT[style] || DIALECT.mm;
  const sm = main.getSculptManager?.() ?? main._sculptManager;
  const tool = sm?.getCurrentTool?.();
  const mode = tool?.modeKey?.() ?? 'draw';
  const isXR = !!main._xrSession;

  const on = (k) => (mode === k ? ' active' : '');
  const modeBtns = MODES.map(([key, label]) => {
    const off = !isXR && XR_ONLY_MODES.indexOf(key) !== -1;
    const tip = off ? ' title="Needs a VR controller — grab a joint and move it in 6DOF"' : '';
    return `<button class="${c.gridBtn}${on(key)}${off ? ' mm-dim' : ''}" id="bone-${key}"` +
      `${off ? ' disabled' : ''}${tip}>${label}</button>`;
  }).join('');

  const flag = (id, label, val) =>
    `<button class="${c.toggle}${val ? ' active' : ''}" id="bone-${id}">${label}</button>`;

  const snap  = window._boneSnapPlane !== false;
  const axis  = window._boneSnapAxis !== false;
  const lens  = !!window._boneShowLengths;
  const caps  = window._boneShowCapsules !== false;
  const wts   = window._boneShowWeights !== false;
  const solid = window._boneShowSolid !== false;
  const wire  = window._boneShowWire !== false;
  const radPct = Math.round((window._boneRadiusFrac ?? 0.5) * 100);
  const pins = IKSolver.pinnedJoints(main).length;
  const bound = Skinning.isBound(main.getMesh?.());
  const anyBound = Skinning.anyBound(main);

  const titleOpen = c.title ? `<div class="${c.title}">` : '';
  const titleClose = c.title ? '</div>' : '';
  const rule = c.divider ? `<hr class="${c.divider}">` : '';

  return `
    ${rule}
    ${titleOpen}${c.title ? 'Bones' : ''}${titleClose}
    <div class="${c.grid}">${modeBtns}</div>
    <div class="${c.btnRow}">
      <button class="${c.action}" id="bone-unpin">${pinLabel(pins)}</button>
      <button class="${c.action}" id="bone-key">Key Pose</button>
    </div>
    <div class="${c.toggles}">
      ${flag('snap', 'Snap Plane', snap)}
      ${flag('axis', 'Snap Axis', axis)}
    </div>
    <div class="${c.toggles}">
      ${flag('len', 'Lengths', lens)}
      ${flag('caps', 'Capsules', caps)}
      ${flag('weights', 'Weights', wts)}
    </div>
    <div class="${c.toggles}">
      ${flag('solid', 'Solid', solid)}
      ${flag('wire', 'Wire', wire)}
    </div>
    <div class="${c.row}">
      <span class="${c.lbl}">Capsule</span>
      <input type="range" id="bone-rad" min="5" max="120" step="1" value="${radPct}">
      <span class="${c.val}" id="bone-rad-val">${radPct}%</span>
    </div>
    <div class="${c.btnRow}">
      <button class="${c.action}" id="bone-rad-all">Apply To All</button>
      <button class="${c.action}" id="bone-skin">Make Skin</button>
    </div>
    ${rule}
    <div class="${c.btnRow}">
      <button class="${c.action}" id="bone-bind">${bound ? 'Rebind' : 'Bind Mesh'}</button>
      ${bound ? '<button class="' + c.action + '" id="bone-unbind">Unbind</button>' : ''}
    </div>
    ${anyBound ? `
    <div class="${c.btnRow}">
      <button class="${c.action}" id="bone-restpose">Bind Pose</button>
    </div>` : ''}
  `;
}

// Attach behaviour. `refresh` is called after anything that changes panel state; `rebuild`
// after anything that changes which BUTTONS exist (binding swaps Bind for Rebind/Unbind, and
// Make Skin changes the selection), since a panel that only syncs classes would keep showing
// the old set.
export function wireBoneSection(root, main, opts) {
  // The sculpting section is wired for EVERY tool, so bail out when this panel is not
  // currently showing the bones controls. Without this the weight-colour refresh at the
  // bottom would run under the brush tool and paint bind colours over the mesh.
  if (!root || !root.querySelector('#bone-draw')) return;
  opts = opts || {};
  const sm = main.getSculptManager?.() ?? main._sculptManager;
  const refresh = opts.refresh || (() => {});
  const rebuild = opts.rebuild || refresh;
  const q = (id) => root.querySelector('#bone-' + id);
  const say = (msg, ok) => {
    console.log('[bone] ' + msg);
    if (window.screenLog) window.screenLog(msg, ok === false ? '#f38ba8' : 'cyan');
  };

  for (const [key] of MODES) {
    q(key)?.addEventListener('click', () => {
      sm?.getCurrentTool?.()?.setModeKey?.(key);
      refresh();
    });
  }

  // Published so a mode change that did NOT come from a click in here can bring the panel
  // back in step — Escape in Draw mode switches the tool to Pose, and without this the
  // buttons would go on showing Draw as the active one. A single slot rather than a list:
  // every panel re-wires on repaint, so a list would grow without bound, and the only
  // caller is the desktop keyboard, where the sidebar is the one panel in play.
  main._boneSectionRebuild = rebuild;

  // Two flag flavours, and they must not share a toggle: the snaps and the display flags
  // default ON (stored as "anything but false", so undefined reads as on), Lengths OFF.
  const flag = (id, key, defaultOn) => {
    q(id)?.addEventListener('click', () => {
      window[key] = defaultOn ? (window[key] === false) : !window[key];
      refresh();
      // Snap Plane draws the plane, so the toggle has to reach the tool BEFORE the render —
      // the tool's own per-frame sync runs after the frame is drawn, which on a still screen
      // would leave the plane a click behind.
      sm?.getCurrentTool?.()?.syncPlane?.();
      main.render?.();
    });
  };
  flag('snap', '_boneSnapPlane', true);
  flag('axis', '_boneSnapAxis', true);
  flag('len', '_boneShowLengths', false);
  flag('caps', '_boneShowCapsules', true);
  flag('solid', '_boneShowSolid', true);
  flag('wire', '_boneShowWire', true);

  // Toggling the weight preview has to repaint or restore immediately — the flag alone
  // changes nothing until something re-solves.
  q('weights')?.addEventListener('click', () => {
    window._boneShowWeights = window._boneShowWeights === false;
    Skinning.refreshWeightColorsAll(main);
    refresh();
    main.render?.();
  });

  // Clearing pins is undoable like every other rig edit: a lost set of pins is a lost pose
  // setup, and re-placing them by hand is exactly the tedium pinning exists to avoid.
  q('unpin')?.addEventListener('click', () => {
    // Snapshot WHICH KIND of pin each one was — undoing a clear has to give back the 6DOF
    // pins as 6DOF.
    const had = IKSolver.capturePins(main);
    if (!had.length) return;
    IKSolver.clearPins(main);
    main.getStateManager?.()?.pushStateCustom?.(
      () => { IKSolver.restorePins(main, had); Skeleton.updateVisuals(main); main.render(); },
      () => { IKSolver.clearPins(main); Skeleton.updateVisuals(main); main.render(); },
      false, 'Clear Pins');
    Skeleton.updateVisuals(main);
    refresh();
    main.render?.();
  });

  // Key the WHOLE rig at the playhead. Every joint, including the ones that did not move: a
  // joint left unkeyed holds its neighbouring keys' value and drifts out of the pose that
  // was just set, which reads as the rig coming apart between poses.
  q('key')?.addEventListener('click', () => {
    const reg = window._animationRegistry;
    const joints = Skeleton.joints(main);
    if (!reg || !joints.length) { say('Bones: no rig to key', false); return; }
    const t = window._animCurrentTime || 0;
    const n = reg.keyTransforms(joints, t, 'Key Pose');
    say(`Bones: keyed ${n} joints at ${t.toFixed(1)}`);
    main.render?.();
  });

  // The slider sets the DEFAULT fraction (used by every joint drawn from now on); the button
  // pushes it onto the bones that already exist. Split deliberately: applying live on every
  // drag frame would silently wipe radii that were hand-tuned in Radius mode.
  const radInput = q('rad'), radVal = q('rad-val');
  radInput?.addEventListener('input', () => {
    const pct = parseFloat(radInput.value);
    window._boneRadiusFrac = pct / 100;
    if (radVal) radVal.textContent = Math.round(pct) + '%';
  });

  q('rad-all')?.addEventListener('click', () => {
    const before = Skeleton.captureRadii(main);
    Skeleton.setRadiusFraction(main, window._boneRadiusFrac ?? 0.5);
    const after = Skeleton.captureRadii(main);
    const apply = (radii) => {
      Skeleton.restoreRadii(radii);
      Skinning.resolveWeightsAll(main);
      Skeleton.updateVisuals(main);
      main.render();
    };
    Skinning.resolveWeightsAll(main);
    main.getStateManager?.()?.pushStateCustom?.(
      () => apply(before), () => apply(after), false, 'Bone Radii');
    window._boneShowCapsules = true; // an invisible edit is indistinguishable from a no-op
    refresh();
    main.render?.();
  });

  q('skin')?.addEventListener('click', () => {
    const res = SkinMesh.build(main);
    say(res.ok
      ? `Bones: skin built — ${res.chains} chains, ${res.verts} verts, ${res.faces} faces, ${res.ms}ms`
      : `Bones: ${res.why}`, res.ok);
    rebuild(); // the new mesh becomes the selection, so the panel changes
    main.render?.();
  });

  q('bind')?.addEventListener('click', () => {
    const res = Skinning.bind(main, main.getMesh?.());
    say(res.ok
      ? `Bones: bound ${res.name} — ${res.joints} joints, ${res.verts} verts, ${res.ms}ms`
        + (res.outside ? `, ${res.outside} verts outside every capsule` : '')
      : `Bones: ${res.why}`, res.ok);
    rebuild(); // the button set itself changes once bound
    main.render?.();
  });

  q('unbind')?.addEventListener('click', () => {
    Skinning.unbind(main.getMesh?.());
    rebuild();
    main.render?.();
  });

  // Back to the pose the rig was bound in. Undoable in one step like any other pose edit —
  // it is a big change, and "I only wanted to see what it looked like" has to be free.
  q('restpose')?.addEventListener('click', () => {
    const before = IKSolver.captureAll(main);
    const n = Skinning.restoreBindPose(main);
    say(n ? `Bones: ${n} joints returned to bind pose` : 'Bones: nothing bound', !!n);
    if (n) {
      const after = IKSolver.captureAll(main);
      const apply = (snap) => { Skeleton.restoreLocal(snap); Skeleton.updateVisuals(main); main.render(); };
      main.getStateManager?.()?.pushStateCustom?.(
        () => apply(before), () => apply(after), false, 'Bind Pose');
    }
    Skeleton.updateVisuals(main);
    main.render?.();
  });

  // Re-entering the tool restores the preview that clearPreview() took down on the way out,
  // so the toggle state is what decides whether colours are shown, not tool history.
  Skinning.refreshWeightColorsAll(main);
}

// In-place state refresh, for panels that do not rebuild their markup on every change.
export function syncBoneSection(root, main) {
  if (!root) return;
  const sm = main.getSculptManager?.() ?? main._sculptManager;
  const mode = sm?.getCurrentTool?.()?.modeKey?.() ?? 'draw';
  const q = (id) => root.querySelector('#bone-' + id);
  for (const [key] of MODES) q(key)?.classList.toggle('active', mode === key);

  const setFlag = (id, val) => q(id)?.classList.toggle('active', val);
  setFlag('snap', window._boneSnapPlane !== false);
  setFlag('axis', window._boneSnapAxis !== false);
  setFlag('len', !!window._boneShowLengths);
  setFlag('caps', window._boneShowCapsules !== false);
  setFlag('weights', window._boneShowWeights !== false);
  setFlag('solid', window._boneShowSolid !== false);
  setFlag('wire', window._boneShowWire !== false);

  // The pin count is rig state rather than panel state, so it has to be refreshed here or it
  // shows whatever was true when the markup was last built.
  const unpin = q('unpin');
  if (unpin) unpin.textContent = pinLabel(IKSolver.pinnedJoints(main).length);
}

export { Enums };
