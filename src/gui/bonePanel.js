import { mat4 } from 'gl-matrix';
import Enums from '../misc/Enums.js';
import Skeleton from '../editing/Skeleton.js';
import Skinning from '../editing/Skinning.js';
import PhysicsBones from '../editing/PhysicsBones.js';
import SkinMesh from '../editing/SkinMesh.js';
import WeightCage from '../editing/WeightCage.js';
import IKSolver from '../editing/IKSolver.js';

// The Bones tool's controls, in ONE place, for every panel that shows them.
//
// They started life inside the VR wrist panel, which meant the whole rigging feature —
// bind, capsules, Make Skin, Rest Pose, every display toggle — did not exist on
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
  ['joint', 'Tweak Joint'],
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
  // The desktop sidebar's Animation tab. Its own vocabulary, and its buttons are bare <button>
  // inside a grid rather than a classed element, so `toggle` is deliberately empty — the
  // `active` state class flagButton adds is the same one ACP uses everywhere else.
  acp: { grid: 'acp-btn-grid', gridBtn: '', toggles: 'acp-btn-grid',
         toggle: '', row: 'acp-row', lbl: 'acp-lbl', val: 'acp-val',
         btnRow: 'acp-btn-grid', action: '', divider: '',
         title: 'acp-section-title', section: 'acp-section' },
};

function pinLabel(n) { return n ? `Clear Pins (${n})` : 'Clear Pins'; }

// `isXR` decides whether the controller-only modes are offered. It is asked of the app, not
// of the dialect: the `mm` markup is used by the desktop sidebar AND by the main menu inside
// a headset, so keying it to the class names would disable the modes in the one place they
// actually work.
function sectionTitle(c, label) {
  const rule = c.divider ? `<hr class="${c.divider}">` : '';
  const title = c.title ? `<div class="${c.title}">${label}</div>` : '';
  return `${rule}${title}`;
}

function flagButton(c, id, label, val) {
  return `<button class="${c.toggle}${val ? ' active' : ''}" id="bone-${id}">${label}</button>`;
}

// Rig construction and bind diagnostics. This is the only block tied to Bone Draw: the modes,
// radius and skin/bind operations edit the rig definition rather than a pose.
export function buildBoneAuthoringHTML(main, style) {
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

  const f     = (k) => Skeleton.displayFlag(k);
  const snap  = f('snapPlane');
  const axis  = f('snapAxis');
  const bound = Skinning.isBound(main.getMesh?.());
  const hasCages = WeightCage.cages(main).length > 0;
  const anyBound = Skinning.anyBound(main);
  const mush = Skinning.mushIterations();
  // BONE SHAPE, for the selected joints (roadmap #60).
  //
  // Physics is a property of the selected joint, so the button reads its state — same pattern as
  // the mode buttons above it.
  const physSel = (main.getSelectedMeshes?.() || []).filter((m) => Skeleton.isJoint(m));
  const physOn = physSel.length === 1 && PhysicsBones.isRoot(physSel[0]);
  // THE SLIDERS STICK TO A JOINT; THEY DO NOT FOLLOW THE SELECTION.
  //
  // Tuning a jiggle means shaking the rig and watching, and shaking it means SELECTING the hips —
  // which used to take the physics joint out of the selection and the sliders off the panel. So
  // tuning and testing were fighting over the same channel. matt: "i can only jiggle the hips in
  // ik mode... but i can only adjust the physics bones values by selecting the physics bone in
  // the bone tool. it's a lot of back and forth."
  //
  // Selecting a physics joint aims the sliders at it, and they STAY there while you select
  // anything else. The flag button still acts on the current selection, because that is how a
  // new joint gets flagged at all — one control reads the selection, the other reads the target,
  // and the panel says which joint it is editing so the two can never be confused.
  const physTarget = PhysicsBones.panelTarget(main, physSel);
  const physP = physTarget ? PhysicsBones.params(physTarget) : PhysicsBones.DEFAULTS;
  // BOTH NAMES WHEN THERE ARE TWO. A drag writes to the mirror twin as well, so a header naming
  // one joint would be telling half the truth about what the sliders are about to change.
  const jointName = (j) => (j && (j._permanentStaticLabel || ('joint ' + j.getID()))) || '';
  const physTwin = physTarget && physTarget._boneMirror
    && main.getMeshes?.().includes(physTarget._boneMirror) && physTarget._boneMirror !== physTarget
    ? physTarget._boneMirror : null;
  // The blend weight is a KEYABLE channel, so the slider shows what it evaluates to at the
  // playhead rather than a stored number — scrub onto a keyed fade and the slider follows it.
  const physW = physTarget ? PhysicsBones.weight(physTarget) : 1;
  const physName = physTarget
    ? jointName(physTarget) + (physTwin ? ' + ' + jointName(physTwin) : '') : '';
  const xray = Math.round(Skinning.skinOpacity() * 100);
  const rule = c.divider ? `<hr class="${c.divider}">` : '';

  // THE WRIST PANEL IS A WRIST PANEL AGAIN. matt: "the bones minipanel is hardly a minipanel
  // anymore, its massive." The cure he picked is fewer things rather than better folding, and it
  // sorts cleanly: what you touch CONSTANTLY while rigging stays on the wrist — the mode, the
  // snaps, the physics you are tuning by watching — and what you do ONCE goes to the main menu,
  // where you are already stopped and reading. Make Skin, Bake Capsules, Reset Radii, Bind and
  // the two skin sliders are all once-a-session operations.
  //
  // Nothing is removed, only placed. The main menu still shows every control.
  const full = style !== 'mp';

  return `
    ${sectionTitle(c, 'Rig Authoring')}
    <div class="${c.grid}">${modeBtns}</div>
    <div class="${c.toggles}">
      ${flagButton(c, 'snap', 'Snap Plane', snap)}
      ${flagButton(c, 'axis', 'Snap Axis', axis)}
    </div>
    ${full ? `
    <div class="${c.btnRow}">
      <button class="${c.action}" id="bone-rad-all">Reset Radii</button>
      <button class="${c.action}" id="bone-skin">Make Skin</button>
    </div>
    <div class="${c.btnRow}">
      <button class="${c.action}" id="bone-cages">${hasCages ? 'Delete Capsules' : 'Bake Capsules'}</button>
    </div>
    ` : ''}
    <div class="${c.btnRow}">
      <button class="${c.action}${physOn ? ' active' : ''}" id="bone-phys"
        title="Make the selected joint a physics bone: everything below it swings and lags behind the animation. Only simulates while the timeline PLAYS — scrub shows the plain pose. Bake to turn it into keys.">${physOn ? 'Physics On' : 'Physics Bone'}</button>
      <button class="${c.action}" id="bone-phys-bake"
        title="Step the loop range, run the sim, and write the result as ordinary rotation keys on the joints it moves. Undoable.">Bake Physics</button>
    </div>
    ${physTarget ? `
    ${sectionTitle(c, 'Physics: ' + physName)}
    <div class="${c.row}">
      <span class="${c.lbl}">Weight</span>
      <input type="range" id="bone-phys-weight" min="0" max="100" step="1" value="${Math.round(physW * 100)}">
      <span class="${c.val}" id="bone-phys-weight-val">${Math.round(physW * 100)}</span>
    </div>
    <div class="${c.btnRow}">
      <button class="${c.action}" id="bone-phys-key"
        title="Key the blend weight at the playhead, so a chain can be floppy through a shot and locked for the beat where it has to hit a mark. Undoable.">Key Weight</button>
    </div>
    <div class="${c.row}">
      <span class="${c.lbl}">Stiffness</span>
      <input type="range" id="bone-phys-stiff" min="1" max="99" step="1" value="${Math.round(physP.stiffness * 100)}">
      <span class="${c.val}" id="bone-phys-stiff-val">${Math.round(physP.stiffness * 100)}</span>
    </div>
    <div class="${c.row}">
      <span class="${c.lbl}">Gravity</span>
      <input type="range" id="bone-phys-grav" min="0" max="300" step="5" value="${Math.round(physP.gravity * 100)}">
      <span class="${c.val}" id="bone-phys-grav-val">${physP.gravity.toFixed(2)}g</span>
    </div>
    <div class="${c.row}">
      <span class="${c.lbl}">Damping</span>
      <input type="range" id="bone-phys-damp" min="0" max="99" step="1" value="${Math.round(physP.damping * 100)}">
      <span class="${c.val}" id="bone-phys-damp-val">${Math.round(physP.damping * 100)}</span>
    </div>
    <div class="${c.row}">
      <span class="${c.lbl}">Follow</span>
      <input type="range" id="bone-phys-inert" min="0" max="100" step="1" value="${Math.round(physP.inertia * 100)}">
      <span class="${c.val}" id="bone-phys-inert-val">${Math.round(physP.inertia * 100)}</span>
    </div>
    <div class="${c.row}">
      <span class="${c.lbl}">Drag</span>
      <input type="range" id="bone-phys-drag" min="0" max="100" step="1" value="${Math.round(physP.drag * 100)}">
      <span class="${c.val}" id="bone-phys-drag-val">${Math.round(physP.drag * 100)}</span>
    </div>
    <div class="${c.toggles}">
      ${flagButton(c, 'phys-ground', 'Ground Collision', physP.ground)}
    </div>
    ` : ''}
    ${full ? `
    ${rule}
    <div class="${c.btnRow}">
      <button class="${c.action}" id="bone-bind">${bound ? 'Rebind' : 'Bind Mesh'}</button>
      ${bound ? '<button class="' + c.action + '" id="bone-unbind">Unbind</button>' : ''}
    </div>
    ${anyBound ? `
    <div class="${c.row}">
      <span class="${c.lbl}">X-Ray</span>
      <input type="range" id="bone-xray" min="5" max="100" step="1" value="${xray}">
      <span class="${c.val}" id="bone-xray-val">${xray}%</span>
    </div>
    <div class="${c.row}">
      <span class="${c.lbl}">Mush</span>
      <input type="range" id="bone-mush" min="0" max="60" step="1" value="${mush}">
      <span class="${c.val}" id="bone-mush-val">${mush}</span>
    </div>
    ` : ''}
    ` : ''}
  `;
}

// Pose operations are useful anywhere a rig node can be held. Bone Draw, Grab and TransformVR
// all bind the same A-button pin cycle, so their menus all expose this same block.
export function buildBonePoseHTML(main, style) {
  const c = DIALECT[style] || DIALECT.mm;
  const pins = IKSolver.pinnedJoints(main).length;
  const bound = Skinning.anyBound(main);
  return `
    ${sectionTitle(c, 'Pose')}
    <div class="${c.btnRow}">
      <button class="${c.action}" id="bone-unpin">${pinLabel(pins)}</button>
      <button class="${c.action}" id="bone-restpose"
        title="Put every joint back to the skeleton as it was built. Recorded when you draw a bone and updated by Tweak, so it exists from the first bone \u2014 posing, grabbing and IK never change it.">Rest Pose</button>
    </div>
    <div class="${c.btnRow}">
      <button class="${c.action}" id="bone-mirror">Mirror Pose</button>
      <button class="${c.action}" id="bone-flip">Copy Side</button>
    </div>
  `;
}

export function buildBoneDisplayHTML(main, style) {
  const c = DIALECT[style] || DIALECT.mm;
  return `
    ${sectionTitle(c, 'Rig Display')}
    <div class="${c.toggles}">
      ${flagButton(c, 'solid', 'Solid', Skeleton.displayFlag('solid'))}
      ${flagButton(c, 'wire', 'Wire', Skeleton.displayFlag('wire'))}
      ${flagButton(c, 'joints', 'Joints', Skeleton.displayFlag('joints'))}
      ${flagButton(c, 'caps', 'Capsules', Skeleton.displayFlag('capsules'))}
      ${flagButton(c, 'weights', 'Weights', Skeleton.displayFlag('weights'))}
      ${flagButton(c, 'len', 'Lengths', Skeleton.displayFlag('lengths'))}
      ${flagButton(c, 'names', 'Names', Skeleton.displayFlag('names'))}
      ${flagButton(c, 'pins', 'Pins', Skeleton.displayFlag('pins'))}
      ${flagButton(c, 'trails', 'Trails', Skeleton.displayFlag('trails'))}
      ${flagButton(c, 'gnomons', 'Rotation', Skeleton.displayFlag('gnomons'))}
      ${flagButton(c, 'gnomons-all', 'All Keys', Skeleton.displayFlag('gnomonsAll'))}
    </div>
  `;
}

// THE FOUR YOU REACH FOR WHILE RIGGING, for the wrist panel — which renders authoring and pose
// and has no Rig Display section, so swapping how the rig draws meant going to the main menu and
// back. matt: "i currently find i have to keep jumping between the display options and the bone
// tool to swap display modes."
//
// Five rather than the whole display block on purpose: the wrist panel is already too tall (its
// own problem), and these are the ones that change what you can SEE to work on. The rest —
// names, lengths, trails, rotation — are read-outs you set once and leave.
//
// The same ids as the main menu's, which is safe because each panel wires its own root: the two
// never share a document, and both already emit `bone-draw` and the rest.
export function buildBoneQuickDisplayHTML(main, style) {
  const c = DIALECT[style] || DIALECT.mm;
  return `
    <div class="${c.toggles}">
      ${flagButton(c, 'solid', 'Solid', Skeleton.displayFlag('solid'))}
      ${flagButton(c, 'wire', 'Wire', Skeleton.displayFlag('wire'))}
      ${flagButton(c, 'joints', 'Joints', Skeleton.displayFlag('joints'))}
      ${flagButton(c, 'caps', 'Capsules', Skeleton.displayFlag('capsules'))}
      ${flagButton(c, 'pins', 'Pins', Skeleton.displayFlag('pins'))}
    </div>
  `;
}

// Trails used to live in a block of its own under Animation, on the grounds that a motion trail
// is an animation aid. In use it is simply another thing the rig can draw, and it belongs next
// to the rest of them — you reach for it while looking at the rig, not while setting up a take.
// The block is gone rather than left empty: an empty section is a heading with nothing under it.
export function buildBoneAnimationHTML() { return ''; }

// Compatibility composition for the places/tests that mean "everything relevant while the
// Bones tool is active". Display and animation deliberately are not part of it any more.
export function buildBoneSectionHTML(main, style) {
  return buildBoneAuthoringHTML(main, style) + buildBonePoseHTML(main, style);
}

// Attach behaviour. `refresh` is called after anything that changes panel state; `rebuild`
// after anything that changes which BUTTONS exist (binding swaps Bind for Rebind/Unbind, and
// Make Skin changes the selection), since a panel that only syncs classes would keep showing
// the old set.
export function wireBoneSection(root, main, opts) {
  // This one wire function services four composable blocks. Bail only when NONE is present;
  // checking #bone-draw made pose/display/animation controls inert outside Bone Draw.
  if (!root || !root.querySelector('[id^="bone-"]')) return;
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
  if (q('draw')) main._boneSectionRebuild = rebuild;

  // Two flag flavours, and they must not share a toggle: the snaps and the display flags
  // Defaults and persistence both live in Skeleton.DISPLAY_FLAGS — the toggle only has to
  // say which flag it is.
  const flag = (id, name) => {
    q(id)?.addEventListener('click', () => {
      const on = !Skeleton.displayFlag(name);
      Skeleton.setDisplayFlag(name, on);
      // Capsules means BOTH kinds. The drawn overlay reads the flag every frame; the baked
      // meshes are real scene objects and have to be told.
      if (name === 'capsules') WeightCage.setVisible(main, on);
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
  flag('names', 'names');
  flag('caps', 'capsules');
  flag('solid', 'solid');
  flag('wire', 'wire');
  flag('joints', 'joints');
  flag('pins', 'pins');
  flag('trails', 'trails');
  flag('gnomons', 'gnomons');
  flag('gnomons-all', 'gnomonsAll');

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

  // MIRROR is the complete reflected pin pose and needs no selection. COPY SIDE takes the side
  // you are holding; selection is the best available statement of which side is the source.
  const doMirror = (side, label) => {
    const reg = window._animationRegistry;
    const joints = Skeleton.joints(main);
    const livePins = IKSolver.pinnedJoints(main);
    const animatedJoints = reg ? joints.filter((j) => {
      const tr = reg.tracks.get(j.getID());
      return tr && tr.times && tr.times.length;
    }) : [];
    const animatedPins = reg ? livePins.filter((j) => {
      const p = IKSolver.pinObject(j), tr = p && reg.tracks.get(p.getID());
      return tr && tr.times && tr.times.length;
    }) : [];
    // A timeline pose mirrors authored bone controls plus every active IK control. With no
    // transform animation this is the original static command and mirrors the whole pose.
    const timed = animatedJoints.length || animatedPins.length;
    // Pins are the pose controls. Bones are evaluated solver output here, even when an older
    // clip still contains bone tracks; mirror/flip must not bake or rewrite the rig itself.
    const controls = new Set();

    // Track snapshots join the matrix/pin snapshots below so the button is still one undo.
    // Snapshot every possible existing participant before mirrorPose can create a twin pin.
    const existingTracks = new Map();
    if (reg && timed) {
      for (const m of joints.concat(livePins.map((j) => IKSolver.pinObject(j)).filter(Boolean))) {
        const tr = reg.tracks.get(m.getID());
        existingTracks.set(m.getID(), tr ? reg._snapshotTrack(tr) : null);
      }
    }
    // Mirroring can CREATE and DESTROY pins, not merely move them — a leg pinned on one side
    // and not the other is the ordinary case — so the undo record has to carry the pin
    // attachments and the scene membership, not just a pile of matrices.
    const beforePins = IKSolver.capturePins(main);
    const beforeMx = IKSolver.captureAll(main)
      .concat(beforePins.map(([, , p]) => p).filter(Boolean)
        .map((p) => [p, mat4.clone(p.getMatrix())]));

    const res = Skeleton.mirrorPose(main, side, controls);
    if (!res.ok) { say('Bones: ' + res.why, false); return; }
    for (const p of res.removed) main.removeMeshSilent?.(p);

    const keyed = timed && reg ? Array.from(new Set(res.controls.concat(res.pinObjects))) : [];
    if (keyed.length) {
      reg.keyTransforms(keyed, window._animCurrentTime || 0, label, false);
      // These are the controls for this evaluation. holdPins restores every other active
      // joint from rest, then reconstructs the limbs against the reflected pins.
      window._ikWritten = new Set(res.controls.map((j) => j.getID()));
      IKSolver.holdPins(main);
    }
    say(`Bones: ${label} — ${res.joints} joints` + (res.pins ? `, ${res.pins} pins` : ''));

    const afterPins = IKSolver.capturePins(main);
    const afterMx = IKSolver.captureAll(main)
      .concat(afterPins.map(([, , p]) => p).filter(Boolean)
        .map((p) => [p, mat4.clone(p.getMatrix())]));
    const trackBefore = new Map();
    const trackAfter = new Map();
    if (reg && timed) {
      for (const m of keyed) {
        trackBefore.set(m.getID(), existingTracks.get(m.getID()) || null);
        trackAfter.set(m.getID(), reg._snapshotTrack(reg.tracks.get(m.getID())));
      }
    }

    // Undo puts THE SAME objects back rather than building new ones, so a pin that comes back
    // is the pin that was there — same id, same outliner row, same keys hanging off it.
    const applyTracks = (snaps) => {
      if (!reg || !timed) return;
      const ids = new Set([...trackBefore.keys(), ...trackAfter.keys()]);
      for (const id of ids) {
        const snap = snaps.get(id);
        if (!snap) reg.tracks.delete(id);
        else reg._restoreTrack(reg._ensureTransformTrack(id), snap, null);
      }
    };
    const apply = (mx, pins, put, take, tracks) => {
      for (const p of take) main.removeMeshSilent?.(p);
      for (const p of put) main.addMeshSilent?.(p);
      for (const j of Skeleton.joints(main)) { j._boneIKPinObj = null; j._boneIKPin = 0; }
      IKSolver.restorePins(main, pins);
      applyTracks(tracks);
      Skeleton.restoreLocal(mx);
      // The pose moved and the pins moved with it, so the rig has to settle onto them again.
      window._ikPinsDirty = true;
      Skeleton.updateVisuals(main);
      main.render();
    };
    window._ikPinsDirty = true;
    main.getStateManager?.()?.pushStateCustom?.(
      () => apply(beforeMx, beforePins, res.removed, res.added, trackBefore),
      () => apply(afterMx, afterPins, res.added, res.removed, trackAfter),
      false, label);
    Skeleton.updateVisuals(main);
    main.render?.();
  };

  q('mirror')?.addEventListener('click', () => doMirror(0, 'Mirror Pose'));

  q('flip')?.addEventListener('click', () => {
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
    doMirror(d > 0 ? 1 : -1, 'Copy Side');
  });

  // THE DEFAULT IS THE SIZE. There used to be a slider here setting the fraction of a bone's
  // length a capsule takes, and it was the first range control in the panel -- which is what
  // made it the one a mis-aimed press grabbed. matt: "i think the defualt size is pretty good,
  // whatever the default is, leave it at that, and remove the slider."
  //
  // The button stays, doing what it always did, now with the only value there is: push the
  // default onto every bone. That is a reset -- the way back from radii hand-tuned in Radius
  // mode, or from a rig imported with odd ones -- so it is labelled as one.
  // A JOINT AND ITS MIRROR TWIN, like every other edit in this tool. matt: "if i make a left
  // antenna be physics, its right mirror should also do that. same for adjusting physics
  // properties." The parameters are all scalars — a stiffness has no handedness — so they copy
  // across rather than reflecting, unlike a joint offset.
  const withTwin = (j) => {
    const out = [j];
    const t = j._boneMirror;
    if (t && main.getMeshes?.().includes(t) && t !== j) out.push(t);
    return out;
  };

  q('phys')?.addEventListener('click', () => {
    const js = (main.getSelectedMeshes?.() || []).filter((m) => Skeleton.isJoint(m));
    if (js.length !== 1) { say('Bones: select ONE joint to flag as a physics bone', false); return; }
    const pair = withTwin(js[0]);
    const on = !PhysicsBones.isRoot(js[0]);
    const snap = () => pair.map((j) => [j, !!j._physicsRoot, j._physicsParams ? { ...j._physicsParams } : null]);
    const before = snap();
    const apply = (rows) => {
      for (const [j, root, params] of rows) {
        if (root) { j._physicsRoot = true; j._physicsParams = params ? { ...params } : { ...PhysicsBones.DEFAULTS }; }
        else delete j._physicsRoot;
      }
      PhysicsBones.reset(main);
      Skeleton.updateVisuals(main);
      main.render?.();
      rebuild();
    };
    for (const j of pair) PhysicsBones.setRoot(main, j, on);
    const after = snap();
    main.getStateManager?.()?.pushStateCustom?.(
      () => apply(before), () => apply(after), false, 'Physics Bone');
    const mirrored = pair.length > 1 ? ' (mirrored)' : '';
    say(on
      ? `Bones: physics on${mirrored} — everything below this joint swings and lags`
      : `Bones: physics off${mirrored}`, true);
    // REBUILD, not refresh. The sliders are conditional MARKUP — they only exist while a flagged
    // joint is selected — and refresh only syncs the DOM that is already there, so flagging a
    // bone left the panel showing no controls until something else happened to rebuild it. matt:
    // "i have to do a bit of a dance to get out of the bone tool, back into it, select a
    // different mode, then select the bone, and then the controls appear."
    rebuild();
  });

  // The three parameters, live on drag: this is a LOOK, and the whole reason the sim runs
  // outside playback is so it can be judged by watching rather than by argument. No undo step
  // per drag — a slider that pushed one would bury the history.
  const physParam = (id, key, scale, fmt) => {
    const input = q('phys-' + id), val = q('phys-' + id + '-val');
    input?.addEventListener('input', () => {
      // The joint the sliders are AIMED at — see PhysicsBones.panelTarget. Reading the selection
      // here instead would write to whatever you had grabbed to shake the rig with.
      const t = PhysicsBones.panelTarget(main,
        (main.getSelectedMeshes?.() || []).filter((m) => Skeleton.isJoint(m)));
      if (!t) return;
      const v = parseInt(input.value, 10) / scale;
      for (const j of withTwin(t)) PhysicsBones.setParams(j, { [key]: v });
      if (val) val.textContent = fmt(v);
      main.render?.();
    });
  };
  physParam('stiff', 'stiffness', 100, (v) => String(Math.round(v * 100)));
  physParam('grav', 'gravity', 100, (v) => v.toFixed(2) + 'g');
  physParam('damp', 'damping', 100, (v) => String(Math.round(v * 100)));
  physParam('drag', 'drag', 100, (v) => String(Math.round(v * 100)));
  // "Follow" rather than "Inertia": the slider says how much the chain comes ALONG with the
  // thing it hangs off, and at 0 it is a free point on a string that the rig can travel right
  // past. Named for what you see rather than for the term in the integrator.
  physParam('inert', 'inertia', 100, (v) => String(Math.round(v * 100)));

  // WEIGHT IS NOT ONE OF THE OTHERS. The four above are properties of the chain, stored on the
  // joint; this one is a keyable channel evaluated at the playhead, so dragging it has to write
  // a key or it would be overwritten by the next evaluation. It writes on RELEASE rather than on
  // every input event — one key per drag, not sixty.
  const wInput = q('phys-weight'), wVal = q('phys-weight-val');
  const wTarget = () => PhysicsBones.panelTarget(main,
    (main.getSelectedMeshes?.() || []).filter((m) => Skeleton.isJoint(m)));
  wInput?.addEventListener('input', () => {
    if (wVal) wVal.textContent = String(parseInt(wInput.value, 10));
  });
  const commitWeight = () => {
    const t = wTarget();
    if (!t) return;
    const v = parseInt(wInput.value, 10) / 100;
    for (const j of withTwin(t)) PhysicsBones.setWeightKey(main, j, v);
    say(`Bones: physics weight ${Math.round(v * 100)}% keyed here`, true);
  };
  wInput?.addEventListener('change', commitWeight);

  q('phys-key')?.addEventListener('click', () => {
    const t = wTarget();
    if (!t) { say('Bones: no physics joint selected', false); return; }
    const v = wInput ? parseInt(wInput.value, 10) / 100 : PhysicsBones.weight(t);
    for (const j of withTwin(t)) PhysicsBones.setWeightKey(main, j, v);
    say(`Bones: physics weight ${Math.round(v * 100)}% keyed here`, true);
  });

  q('phys-ground')?.addEventListener('click', () => {
    const t = PhysicsBones.panelTarget(main,
      (main.getSelectedMeshes?.() || []).filter((m) => Skeleton.isJoint(m)));
    if (!t) return;
    const on = !PhysicsBones.params(t).ground;
    for (const j of withTwin(t)) {
      PhysicsBones.setParams(j, { ground: on, groundY: PhysicsBones.groundHeight(main) });
    }
    rebuild();
    main.render?.();
  });

  q('phys-bake')?.addEventListener('click', () => {
    const res = PhysicsBones.bake(main);
    say(res.baked
      ? `Bones: baked physics on ${res.baked} joint(s), ${res.frames} frames`
      : `Bones: nothing baked — ${res.reason}`, !!res.baked);
    refresh();
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

  // See-through skin, so the capsules inside it can be seen while they are sculpted. Live on
  // drag like the mush slider — it is a look, and a look is judged by watching it move.
  const xrayInput = q('xray'), xrayVal = q('xray-val');
  xrayInput?.addEventListener('input', () => {
    const pct = parseInt(xrayInput.value, 10);
    Skinning.setSkinOpacity(main, pct / 100);
    if (xrayVal) xrayVal.textContent = pct + '%';
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
      ? `Bones: skin built — ${res.boxes} joints, `
        + `${res.bones} bones, ${res.verts} verts, ${res.faces} faces, ${res.ms}ms`
      : `Bones: ${res.why}`, res.ok);
    rebuild(); // the new mesh becomes the selection, so the panel changes
    main.render?.();
  });

  // BAKE THE CAPSULES TO SCULPTABLE CAGES, or delete them again. One button, because they are
  // one state: either the rig weights from capsules or it weights from cages.
  q('cages')?.addEventListener('click', () => {
    if (WeightCage.cages(main).length) {
      const n = WeightCage.deleteAll(main);
      say(`Bones: deleted ${n} baked capsule(s) — binding is back to the drawn capsules`, true);
    } else {
      const res = WeightCage.bake(main);
      // PAY FOR THE FIRST FULL SOLVE HERE, where a pause is expected.
      //
      // A rig bound to the drawn capsules has weights, but it has no per-vertex distances to
      // any CAGE — so the first cage edit had to measure every vertex against every cage before
      // the incremental path had anything to work from, and that one stroke took seconds while
      // every stroke after it was instant. matt: "the first capsule weight adjust takes a long
      // time to update... i don't understand why that first one takes so long."
      //
      // Doing it at bake time does not make the work smaller, it puts it where the user is
      // already waiting for a button, and leaves the first sculpt as fast as the rest.
      let solveMs = 0;
      if (res.ok) {
        const t0 = performance.now();
        Skinning.resolveWeightsAll(main);
        solveMs = Math.round(performance.now() - t0);
      }
      say(res.ok
        ? `Bones: baked ${res.cages} capsule(s) — sculpt them, weights follow on each stroke`
          + (solveMs ? ` (weights re-solved in ${solveMs}ms)` : '')
          // Which capsules will mirror. An unpaired one is not a failure — a centreline bone
          // mirrors onto itself and pairs, so what is left over is a bone whose twin is missing
          // or not actually a mirror of it, and sculpting THAT one simply will not carry across.
          // Better said once here than discovered later as "symmetry doesn't work on the hand".
          + (res.unpaired ? `, ${res.paired} mirrored / ${res.unpaired} unpaired` : '')
        : `Bones: ${res.why}`, res.ok);
      // Baking into a scene with capsules switched off would produce twenty invisible meshes
      // and look like nothing happened — the same reason a radius edit turns them on.
      if (res.ok) { Skeleton.setDisplayFlag('capsules', true); WeightCage.setVisible(main, true); }
    }
    rebuild();
    main.render?.();
  });

  q('bind')?.addEventListener('click', () => {
    const res = Skinning.bind(main, main.getMesh?.());
    say(res.ok
      ? `Bones: bound ${res.name} — ${res.joints} joints, ${res.verts} verts, ${res.ms}ms`
        + (res.cages ? `, from ${res.cages} baked capsule(s)` : ', from drawn capsules')
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

  // Back to the skeleton as built. Undoable in one step like any other pose edit — it is a big
  // change, and "I only wanted to see what it looked like" has to be free.
  //
  // THE REST POSE, NOT THE BIND POSE. Bind only exists once a mesh is attached, so this button
  // used to be absent for the whole authoring phase — which is exactly when you want it. Rest is
  // recorded when a bone is drawn, so it is there from the first one.
  q('restpose')?.addEventListener('click', () => {
    const before = IKSolver.captureAll(main);
    const n = IKSolver.restoreRest(main);
    say(n ? `Bones: ${n} joints returned to the rest pose` : 'Bones: no rest pose recorded', !!n);
    if (n) {
      const after = IKSolver.captureAll(main);
      const apply = (snap) => { Skeleton.restoreLocal(snap); Skeleton.updateVisuals(main); main.render(); };
      main.getStateManager?.()?.pushStateCustom?.(
        () => apply(before), () => apply(after), false, 'Rest Pose');
    }
    Skeleton.updateVisuals(main);
    main.render?.();
  });

  // Only the authoring block owns the weight diagnostic. Rendering/animation/pose sections
  // must not repaint bind colours merely because their unrelated controls were wired.
  if (q('caps')) Skinning.refreshWeightColorsAll(main);
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
  setFlag('names', Skeleton.displayFlag('names'));
  setFlag('caps', Skeleton.displayFlag('capsules'));
  setFlag('weights', Skeleton.displayFlag('weights'));
  setFlag('solid', Skeleton.displayFlag('solid'));
  setFlag('wire', Skeleton.displayFlag('wire'));
  setFlag('joints', Skeleton.displayFlag('joints'));
  setFlag('pins', Skeleton.displayFlag('pins'));
  setFlag('trails', Skeleton.displayFlag('trails'));
  setFlag('gnomons', Skeleton.displayFlag('gnomons'));
  setFlag('gnomons-all', Skeleton.displayFlag('gnomonsAll'));

  const xrayInput2 = q('xray'), xrayVal2 = q('xray-val');
  if (xrayInput2) {
    const pct = Math.round(Skinning.skinOpacity() * 100);
    xrayInput2.value = String(pct);
    if (xrayVal2) xrayVal2.textContent = pct + '%';
  }

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
