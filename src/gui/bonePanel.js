import { mat4 } from 'gl-matrix';
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

  const f     = (k) => Skeleton.displayFlag(k);
  const snap  = f('snapPlane');
  const axis  = f('snapAxis');
  const lens  = f('lengths');
  const caps  = f('capsules');
  const wts   = f('weights');
  const solid = f('solid');
  const wire  = f('wire');
  const jnts  = f('joints');
  const trails = f('trails');
  const radPct = Math.round(Skeleton.radiusFraction() * 100);
  const pins = IKSolver.pinnedJoints(main).length;
  const bound = Skinning.isBound(main.getMesh?.());
  const anyBound = Skinning.anyBound(main);
  const mush = Skinning.mushIterations();

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
    <div class="${c.btnRow}">
      <button class="${c.action}" id="bone-mirror">Mirror Pose</button>
      <button class="${c.action}" id="bone-flip">Flip Pose</button>
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
      ${flag('joints', 'Joints', jnts)}
    </div>
    <div class="${c.toggles}">
      ${flag('trails', 'Trails', trails)}
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
    <div class="${c.row}">
      <span class="${c.lbl}">Mush</span>
      <input type="range" id="bone-mush" min="0" max="30" step="1" value="${mush}">
      <span class="${c.val}" id="bone-mush-val">${mush}</span>
    </div>
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
  // Defaults and persistence both live in Skeleton.DISPLAY_FLAGS — the toggle only has to
  // say which flag it is.
  const flag = (id, name) => {
    q(id)?.addEventListener('click', () => {
      Skeleton.setDisplayFlag(name, !Skeleton.displayFlag(name));
      refresh();
      // Snap Plane draws the plane, so the toggle has to reach the tool BEFORE the render —
      // the tool's own per-frame sync runs after the frame is drawn, which on a still screen
      // would leave the plane a click behind.
      sm?.getCurrentTool?.()?.syncPlane?.();
      main.render?.();
    });
  };
  flag('snap', 'snapPlane');
  flag('axis', 'snapAxis');
  flag('len', 'lengths');
  flag('caps', 'capsules');
  flag('solid', 'solid');
  flag('wire', 'wire');
  flag('joints', 'joints');
  flag('trails', 'trails');

  // Toggling the weight preview has to repaint or restore immediately — the flag alone
  // changes nothing until something re-solves.
  q('weights')?.addEventListener('click', () => {
    Skeleton.setDisplayFlag('weights', !Skeleton.displayFlag('weights'));
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
    // Clearing takes the pin nulls out of the scene; undo puts the SAME objects back at the
    // matrices they stood at, so the pins return where they were rather than to the rig.
    for (const p of IKSolver.clearPins(main)) main.removeMeshSilent?.(p);
    main.getStateManager?.()?.pushStateCustom?.(
      () => {
        for (const [, , pin] of had) if (pin) main.addMeshSilent?.(pin);
        IKSolver.restorePins(main, had);
        Skeleton.updateVisuals(main); main.render();
      },
      () => {
        for (const p of IKSolver.clearPins(main)) main.removeMeshSilent?.(p);
        Skeleton.updateVisuals(main); main.render();
      },
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
    // PINS ARE KEYED WITH THE POSE. A pin is an ordinary object with an ordinary transform, so
    // keying it needs no new key type and inherits every editor operation — drag to retime,
    // marquee, the transform box, copy and paste — because all of those are written against
    // `type === 'transform'` generically. It is also what makes a foot that plants at frame 10
    // and releases at 40 expressible at all: without keys, holdPins can only treat a pin as
    // constant for the whole timeline.
    const pins = IKSolver.pinnedJoints(main)
      .map((j) => IKSolver.pinObject(j))
      .filter(Boolean);
    const n = reg.keyTransforms(joints.concat(pins), t, 'Key Pose');
    say(`Bones: keyed ${n} joints at ${t.toFixed(1)}` + (pins.length ? ` (+${pins.length} pins)` : ''));
    main.render?.();
  });

  // MIRROR takes the side you are holding. Posing an arm leaves that arm's joint selected —
  // grabbing one selects it — so the selection is the best available statement of "this side is
  // the one I mean", and it needs no extra control to say it. With nothing suitable selected
  // it refuses and says so rather than picking a side and silently discarding an arm of work.
  //
  // FLIP swaps both sides and needs no selection at all.
  const doMirror = (side, label) => {
    // Mirroring can CREATE and DESTROY pins, not merely move them — a leg pinned on one side
    // and not the other is the ordinary case — so the undo record has to carry the pin
    // attachments and the scene membership, not just a pile of matrices.
    const beforePins = IKSolver.capturePins(main);
    const beforeMx = IKSolver.captureAll(main)
      .concat(beforePins.map(([, , p]) => p).filter(Boolean)
        .map((p) => [p, mat4.clone(p.getMatrix())]));

    const res = Skeleton.mirrorPose(main, side);
    if (!res.ok) { say('Bones: ' + res.why, false); return; }
    for (const p of res.removed) main.removeMeshSilent?.(p);
    say(`Bones: ${label} — ${res.joints} joints` + (res.pins ? `, ${res.pins} pins` : ''));

    const afterPins = IKSolver.capturePins(main);
    const afterMx = IKSolver.captureAll(main)
      .concat(afterPins.map(([, , p]) => p).filter(Boolean)
        .map((p) => [p, mat4.clone(p.getMatrix())]));

    // Undo puts THE SAME objects back rather than building new ones, so a pin that comes back
    // is the pin that was there — same id, same outliner row, same keys hanging off it.
    const apply = (mx, pins, put, take) => {
      for (const p of take) main.removeMeshSilent?.(p);
      for (const p of put) main.addMeshSilent?.(p);
      for (const j of Skeleton.joints(main)) { j._boneIKPinObj = null; j._boneIKPin = 0; }
      IKSolver.restorePins(main, pins);
      Skeleton.restoreLocal(mx);
      // The pose moved and the pins moved with it, so the rig has to settle onto them again.
      window._ikPinsDirty = true;
      Skeleton.updateVisuals(main);
      main.render();
    };
    window._ikPinsDirty = true;
    main.getStateManager?.()?.pushStateCustom?.(
      () => apply(beforeMx, beforePins, res.removed, res.added),
      () => apply(afterMx, afterPins, res.added, res.removed),
      false, label);
    Skeleton.updateVisuals(main);
    main.render?.();
  };

  q('mirror')?.addEventListener('click', () => {
    // The SELECTION, not the hover: pressing this button means pointing at a panel, so there
    // is no hover to read, and a stale one would be worse than none.
    const sel = main.getMesh?.();
    if (!sel || !sel._isBone) {
      say('Bones: select a joint on the side you want to copy FROM', false);
      return;
    }
    const plane = Skeleton.symmetryPlane(main);
    if (!plane) { say('Bones: symmetry is off — turn it on to mirror a pose', false); return; }
    const d = Skeleton.jointSide(sel, plane);
    if (Math.abs(d) < 1e-6) {
      say('Bones: that joint is on the centreline — pick one on the side to copy from', false);
      return;
    }
    doMirror(d > 0 ? 1 : -1, 'Mirror Pose');
  });

  q('flip')?.addEventListener('click', () => doMirror(0, 'Flip Pose'));

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
    Skeleton.setRadiusFraction(main, Skeleton.radiusFraction());
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
    Skeleton.setDisplayFlag('capsules', true); // an invisible edit is indistinguishable from a no-op
    refresh();
    main.render?.();
  });

  // Delta mush strength, in smoothing iterations — the radius, in edges, that the smoothing
  // reaches. Live on drag rather than on release: judging a mush is entirely a matter of
  // watching a bent limb while the number moves, and the pass is a post-process on positions,
  // so it costs a re-skin and nothing else. Unlike the capsule slider it has no "apply" step,
  // because it changes no per-vertex state that a hand edit could be overwriting.
  const mushInput = q('mush'), mushVal = q('mush-val');
  mushInput?.addEventListener('input', () => {
    const n = parseInt(mushInput.value, 10);
    Skinning.setMushIterations(n);
    if (mushVal) mushVal.textContent = String(n);
    // The skin pass only runs when the POSE changed, and this changed the deformer instead.
    // Without this the slider does nothing at all until the next time a joint moves.
    Skinning.markDirtyAll(main);
    main.render?.();
  });

  q('skin')?.addEventListener('click', () => {
    const res = SkinMesh.build(main);
    say(res.ok
      ? `Bones: skin built — ${res.boxes} joints, ${res.bones} bones, ${res.verts} verts, ${res.faces} faces, ${res.ms}ms`
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
  setFlag('snap', Skeleton.displayFlag('snapPlane'));
  setFlag('axis', Skeleton.displayFlag('snapAxis'));
  setFlag('len', Skeleton.displayFlag('lengths'));
  setFlag('caps', Skeleton.displayFlag('capsules'));
  setFlag('weights', Skeleton.displayFlag('weights'));
  setFlag('solid', Skeleton.displayFlag('solid'));
  setFlag('wire', Skeleton.displayFlag('wire'));
  setFlag('joints', Skeleton.displayFlag('joints'));
  setFlag('trails', Skeleton.displayFlag('trails'));

  const mushInput = q('mush'), mushVal = q('mush-val');
  if (mushInput) {
    const n = Skinning.mushIterations();
    mushInput.value = String(n);
    if (mushVal) mushVal.textContent = String(n);
  }

  // The pin count is rig state rather than panel state, so it has to be refreshed here or it
  // shows whatever was true when the markup was last built.
  const unpin = q('unpin');
  if (unpin) unpin.textContent = pinLabel(IKSolver.pinnedJoints(main).length);
}

export { Enums };
