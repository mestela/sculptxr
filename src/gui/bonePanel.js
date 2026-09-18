import { mat4 } from 'gl-matrix';
import Enums from '../misc/Enums.js';
import Skeleton from '../editing/Skeleton.js';
import Skinning from '../editing/Skinning.js';
import PhysicsBones from '../editing/PhysicsBones.js';
import SkinMesh from '../editing/SkinMesh.js';
import WeightCage from '../editing/WeightCage.js';
import IKSolver from '../editing/IKSolver.js';
import RigTopology from '../editing/RigTopology.js';
import { collapsibleHTML, uiReorg, squeezeLabel } from './htmlvr/uiTokens.js';

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
  // SELECT IS A MODE NOW, AND THE NAMES GO BACK TO SAYING ONE THING EACH.
  //
  // There was no plain Select, so picking a joint without editing it meant choosing whichever
  // mode did the least harm — and the fix taken at the time was to say so in the label, hence
  // "Sel/Tweak FK". That is a signpost pointing at a missing mode. A tweak mode still moves the
  // joint if your hand moves while you press, which on a wrist-mounted panel in a headset it
  // always does a little, so "selecting" through one was never free.
  //
  // matt: "add a select mode that does only select, and you can shorten the labels for Sel/Tweak
  // FK and Sel/Tweak Free back to just Tweak FK and Tweak Free." Both halves of that are the same
  // change: once the mode exists, the labels have nothing left to apologise for.
  //
  // FIRST IN THE LIST, because it is the only mode that cannot damage the rig, which makes it the
  // right place to land and the right place to come back to.
  ['select', 'Select'],
  ['draw', 'Draw'],
  ['fk', 'Tweak FK'],
  ['free', 'Tweak Free'],
  ['pose', 'Pose'],
  ['radius', 'Radius'],
  ['joint', 'Tweak Joint'],
  ['ik', 'IK'],
  // GRAB, and it is the real Grab tool borrowed rather than a fifth way to drag a joint.
  //
  // matt: "my use case here is being able to test the physics, currently i have to keep jumping
  // between bone and grab because i can't manipulate pins in the bone tool." Every other mode in
  // this list picks through Skeleton.joints(), and a PIN is a null carrying _isPinTarget rather
  // than a joint -- so no mode here could reach one, and testing a physics chain meant leaving
  // the tool and coming back for every tug.
  //
  // LAST IN THE LIST for the opposite reason Select is first: it is the mode that moves the
  // character rather than editing the rig, so it sits at the far end from the modes that build.
  ['grab', 'Grab'],
];

// Class dialects. `grid`/`toggle`/`action` are the three shapes the panel uses.
const DIALECT = {
  // `chip` and `act` are CHARACTER BUDGETS, not a style: how much text one button can show at
  // three across and at two across in a 216px-wide wrist panel. Measured in the running panel,
  // not guessed. Only the wrist declares them -- the menu and the sidebar are wide enough that
  // nothing has ever needed shortening there, and a budget they do not need is a budget that
  // would quietly shorten labels on a 600px-wide sidebar.
  mp: { grid: 'mp-voxel-grid', gridBtn: 'mp-voxel-btn', toggles: 'mp-toggles cols-3',
        toggle: 'mp-toggle-btn', row: 'mp-row', lbl: 'mp-lbl', val: 'mp-val',
        chip: 11, act: 16,
        btnRow: 'mp-btn-row', action: 'mp-action-btn', divider: 'mp-divider',
        // A toggle that stands ALONE rather than sitting in the chip grid — for a switch that
        // governs the grid rather than belonging to it.
        wide: 'mp-toggle-btn',
        title: '' },
  mm: { grid: 'mm-choice-grid cols-3', gridBtn: 'mm-choice', toggles: 'mm-choice-grid cols-3',
        toggle: 'mm-choice', row: 'mm-row', lbl: 'mm-lbl', val: 'mm-val',
        btnRow: 'mm-choice-grid cols-2', action: 'mm-choice', divider: '',
        wide: 'mm-toggle',
        title: 'mm-section-title' },
  // The desktop sidebar's Animation tab. Its own vocabulary, and its buttons are bare <button>
  // inside a grid rather than a classed element, so `toggle` is deliberately empty — the
  // `active` state class flagButton adds is the same one ACP uses everywhere else.
  acp: { grid: 'acp-btn-grid', gridBtn: '', toggles: 'acp-btn-grid',
         toggle: '', row: 'acp-row', lbl: 'acp-lbl', val: 'acp-val',
         btnRow: 'acp-btn-grid', action: '', divider: '',
         wide: '',
         title: 'acp-section-title', section: 'acp-section' },
};

function pinLabel(n) { return n ? `Clear Pins (${n})` : 'Clear Pins'; }

// A joint's display name, for the places that have to SAY which joint. Module scope because both
// the builder and syncBoneSection need it -- the sync rewrites the physics readout every pass, so
// the two have to agree on the name or the row would change wording on its own.
// 0.01x .. 100x, readable at both ends.
function fmtMass(v) { return (v < 1 ? v.toFixed(2) : (v < 10 ? v.toFixed(1) : String(Math.round(v)))) + 'x'; }

function jointLabel(j) { return (j && (j._permanentStaticLabel || ('joint ' + j.getID()))) || ''; }

// WHAT THE PHYSICS SLIDERS ARE POINTED AT, in one place because TWO places need to say it and
// they must never disagree: the builder writes it into the markup, and syncBoneSection rewrites
// it every pass so it cannot go stale. Written separately at first, and they already differed --
// the builder named the mirror twin and the sync did not, so the row would have shortened itself
// one sync after it was drawn.
//
// It names BOTH joints when the edit is mirrored, because a drag writes to the twin too and
// naming one would be telling half the truth about what is about to change.
//
// NO PREFIX AND ONE LINE. It said "Editing <name>" in a two-cell row, and a row's label cell is
// the narrow left column -- so a mirrored pair wrapped onto a second line. matt: "there's no need
// to split over 2 lines, and the 'editing' prefix is useless." The word was carrying nothing the
// section heading above it does not already say, and the row is one full-width cell now.
// WHICH JOINT A PIN CONTROL ACTS ON.
//
// THE PANEL ACTS ON THE SELECTION; THE MARKING MENU KEEPS ACTING ON HOVER. That is the rule the
// whole pin plan hangs off: every command in the A ring resolves through Skeleton.hoveredJoint
// and freezes it at open, which a panel button cannot do -- there is nothing under the pointer
// when you reach for a panel. One function, two target resolvers.
//
// Resolves a PIN to the joint it holds, the same as the ring's _resolvePinJoint: a pin is the
// thing you grab in the viewport, so selecting one and then finding the pin controls dead would
// be the obvious bug.
//
// No memory. The physics sliders had a sticky target and it was cut for good reasons that apply
// here unchanged -- matt: "the stickiness is a UI hack, and means we run the risk of people
// modifying physics properties they didn't want."
function rigPanelTarget(main) {
  const sel = (main.getSelectedMeshes?.() || []).filter((m) => m && (m._isBone || m._isPinTarget));
  if (sel.length !== 1) return null;
  const one = sel[0];
  if (one._isPinTarget) return one._pinnedJoint || null;
  return one._isBone ? one : null;
}

// Clear Keys removes the weight CHANNEL, so it means nothing without one. The ring's own test,
// verbatim: an unkeyed pin is fully on with no curve at all, which is the state a rig starts in.
function pinHasKeys(joint) {
  const reg = window._animationRegistry;
  const pin = joint ? IKSolver.pinObject(joint) : null;
  return !!(pin && reg && reg.scalarTrack && reg.scalarTrack(pin, IKSolver.PIN_WEIGHT, false));
}

// The readout both rig sections use: which joint the panel resolved, or why it resolved none.
// One function because two sections say the same sentence, and they must not drift.
// The one joint below this one, or null at a fork or a leaf. Split Below has no unambiguous
// target at a fork -- which is the same rule chainFrom stops on, for the same reason.
function soleChild(main, joint) {
  if (!main || !joint) return null;
  const kids = Skeleton.childJoints(main, joint).filter((k) => Skeleton.isJoint(k));
  return kids.length === 1 ? kids[0] : null;
}

function pinTargetLabel(main) {
  const t = rigPanelTarget(main);
  return t ? jointLabel(t) : 'No joint selected';
}

function physAimLabel(main, t) {
  if (!t) return 'Defaults \u2014 no physics bone';
  const twin = Skeleton.mirrorEdits(main) && t._boneMirror
    && main.getMeshes?.().includes(t._boneMirror) && t._boneMirror !== t ? t._boneMirror : null;
  return jointLabel(t) + (twin ? ' + ' + jointLabel(twin) : '');
}

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
  return `<button class="${c.toggle}${val ? ' active' : ''}" id="bone-${id}">${
    squeezeLabel(label, c.chip)}</button>`;
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
      `${off ? ' disabled' : ''}${tip}>${squeezeLabel(label, c.chip)}</button>`;
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
  // SHARPNESS, WHERE THE JOINT SHAPE IS EDITED. Tweak Joint sizes a joint's three extents; this
  // says how boxy the shape spanning them is — 2 is the ellipsoid everything has always been,
  // higher squares it off. It acts on the SELECTED joint and names it, because a slider that
  // silently aims at "whichever joint" is the complaint the physics sliders above were rewritten
  // to fix.
  //
  // A JS COMMENT, NOT AN HTML ONE. Panel markup is serialised as XML to be rasterised, and
  // comments in it are the failure panelxml_test was written for — it will not have this.
  //
  // The joint the roundness slider edits: the single selected joint, or nothing.
  const roundSel = (main.getSelectedMeshes?.() || []).filter((m) => Skeleton.isJoint(m));
  const roundTarget = roundSel.length === 1 ? roundSel[0] : null;
  const roundVal = roundTarget ? Skeleton.jointRound(roundTarget) : 2;
  const roundName = roundTarget
    ? (roundTarget._permanentStaticLabel || ('joint ' + roundTarget.getID())) : '';
  const physP = physTarget ? PhysicsBones.params(physTarget) : PhysicsBones.DEFAULTS;
  // A SLIDER THAT DOES NOTHING IS WORSE THAN ONE THAT IS NOT THERE -- you drag it, the rig does
  // not change, and you are left wondering which of the two is broken. The constraint solver
  // couples a chain itself, so Follow has no job under it; say so on the control.
  const xpbd = !!window._physXPBD;
  // BOTH NAMES WHEN THERE ARE TWO. A drag writes to the mirror twin as well, so a header naming
  // one joint would be telling half the truth about what the sliders are about to change.
  const jointName = jointLabel;
  // ...AND ONLY WHEN SYMMETRY IS ON. A twin exists for the life of any joint drawn with symmetry,
  // so testing for one meant physics could never be flagged on a single side. See
  // Skeleton.mirrorEdits.
  const physTwin = Skeleton.mirrorEdits(main) && physTarget && physTarget._boneMirror
    && main.getMeshes?.().includes(physTarget._boneMirror) && physTarget._boneMirror !== physTarget
    ? physTarget._boneMirror : null;
  // The blend weight is a KEYABLE channel, so the slider shows what it evaluates to at the
  // playhead rather than a stored number — scrub onto a keyed fade and the slider follows it.
  const physW = physTarget ? PhysicsBones.weight(physTarget) : 1;
  const physName = physTarget
    ? jointName(physTarget) + (physTwin ? ' + ' + jointName(physTwin) : '') : '';
  // WHAT THE SLIDERS ARE POINTED AT, SAID OUT LOUD.
  //
  // A heading naming the joint was tried and rejected -- "it doesn't stay up to date, its just
  // confusing" -- and it deserved to be: a heading is built once and the selection moves on
  // without it. This is the same fact in a place that CANNOT go stale, because syncBoneSection
  // rewrites it on every sync, the way the pin count and the Hide Decorations label already work.
  //
  // It earns its row now in a way it did not then. With the sticky target gone the sliders act on
  // the selection, and with no chain selected they act on the DEFAULTS -- which is useful but is
  // the one state that would otherwise be silent: you would move a slider, see a number change,
  // and watch the rig do nothing.
  const physAim = physAimLabel(main, physTarget);
  const xray = Math.round(Skinning.skinOpacity() * 100);
  const cageOp = Math.round(WeightCage.opacity() * 100);
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
  // ...AND THEN FOLDING ARRIVED, WHICH IS THE BETTER ANSWER IT WAS DENIED AT THE TIME.
  //
  // `full` was the only tool available before there were collapsible sections, and it bought the
  // wrist panel's height by making the wrist and the Properties page DIFFERENT PANELS -- which is
  // a round trip rather than a saving. matt, on using it: "i found myself swapping between the
  // bones tool minipanel and the bones tool properties, i'm sure there's stuff in the bones panel
  // that isn't in the properties panel." There was, and it was Setup, and only Setup.
  //
  // So Setup is on the wrist too now, closed, costing the 27px of its heading instead of the
  // ~180px of the block. The two panels render the same controls again, and the once-a-session
  // operations sit behind a fold -- which is a better place for Make Skin and Bind than an inline
  // button on the panel strapped to your arm.
  //
  // `full` still gates the legacy branch below, which uiReorg() no longer reaches.

  // ── UI REORG MOCKUP: the same blocks, grouped by how often you touch them ──────────────
  //
  // The panel crams two orthogonal axes into one column -- pointer MODE (seven of them) and
  // lifecycle STAGE (author, skin, pose, physics, display) -- which is why it reads as a wall
  // rather than as a long list.
  //
  // So: the mode row and the snaps stay put, because they are what you touch every few
  // seconds. Setup and Physics become groups. Collapsed rather than tabbed, because you
  // genuinely do cross between these -- bind, pose, find the weights wrong, go back -- and a
  // tab punishes that while a collapse does not.
  //
  // SETUP DEFAULTS CLOSED; PHYSICS DEFAULTS OPEN, because they are folded for opposite reasons.
  // Setup is always there and is once-a-session work, so closed is its resting state. The
  // physics fold holds only the per-joint sliders and only EXISTS while a flagged joint is
  // selected -- and selecting one is how you say you are about to tune it, so it arrives open.
  //
  // The state is sticky per session (see groupOpen), so closing it once to get the rig back in
  // view keeps it closed for as long as that matters.
  if (uiReorg()) {
    // Capsules and Bind are PAIRED on one row. Each had a row of its own and stretched the full
    // width, which put three different button widths into four rows -- the same raggedness matt
    // objected to, arriving from the markup this time rather than from the layout. Unbind keeps a
    // row to itself: it is the destructive one, and it only exists once there is something to
    // undo.
    const setupBody = `
    <div class="${c.btnRow}">
      <button class="${c.action}" id="bone-rad-all">Reset Radii</button>
      <button class="${c.action}" id="bone-skin">Make Skin</button>
    </div>
    <div class="${c.btnRow}">
      ${/* "WEIGHT CAGES", NOT "CAPSULES". This button bakes editable cage GEOMETRY you sculpt to
           shape the skin weights -- WeightCage, nothing to do with the Capsules chip in View and
           Assist, which shows and hides the rig's drawn capsules. Sharing the word put a
           capsules-looking control next to Make Skin, which is exactly where someone hunting for
           the display toggle looks. adurna35: "was looking for turning capsules on/off in the
           same area that I can make skin." The word that disambiguates is the one the code has
           used all along. */ ''}
      <button class="${c.action}" id="bone-cages" title="${hasCages
        ? 'Delete the baked weight cages; binding returns to the drawn capsules'
        : 'Bake editable cage geometry you can sculpt to shape the skin weights'}">${
        hasCages ? 'Delete Weight Cages' : 'Bake Weight Cages'}</button>
      <button class="${c.action}" id="bone-bind">${bound ? 'Rebind' : 'Bind Mesh'}</button>
    </div>
    ${bound ? `<div class="${c.btnRow}">
      <button class="${c.action}" id="bone-unbind">Unbind</button>
    </div>` : ''}
    ${anyBound ? `
    <div class="${c.row}">
      <span class="${c.lbl}">X-Ray</span>
      <input type="range" id="bone-xray" min="5" max="100" step="1" value="${xray}">
      <span class="${c.val}" id="bone-xray-val">${xray}%</span>
    </div>
    ${/* THE OTHER HALF OF THE X-RAY, and it only appears once there are cages to dim. X-Ray
         fades the SKIN so you can find the capsule inside it; this fades the CAPSULES so you
         can watch the weights change on the skin underneath while you sculpt one. matt: "i'd
         need to set their opacity all at once, so i can verify that sculpting it is affecting
         the weights of the target geometry." All of them together -- a cage is never the thing
         you are looking at, and twenty outliner rows is not a thing anyone will do. */ ''}
    ${hasCages ? `
    <div class="${c.row}">
      <span class="${c.lbl}">Cages</span>
      <input type="range" id="bone-cage-op" min="5" max="100" step="1" value="${cageOp}">
      <span class="${c.val}" id="bone-cage-op-val">${cageOp}%</span>
    </div>
    <div class="${c.btnRow}">
      <button class="${c.action}" id="bone-select-cages" title="Select every weight cage, so they can be hidden, moved or deleted as a set">Select Cages</button>
    </div>` : ''}
    <div class="${c.row}">
      <span class="${c.lbl}">Mush</span>
      <input type="range" id="bone-mush" min="0" max="60" step="1" value="${mush}">
      <span class="${c.val}" id="bone-mush-val">${mush}</span>
    </div>` : `
    <div class="${c.row}" style="opacity:0.6">
      <span class="${c.lbl}">X-Ray / Mush</span>
      <span class="${c.val}" style="flex:1;text-align:left">need a bound mesh, press Bind</span>
    </div>`}`;

    const physButtons = `
    <div class="${c.btnRow}">
      <button class="${c.action}${physOn ? ' active' : ''}" id="bone-phys">${physOn ? 'Physics On' : 'Physics Bone'}</button>
      <button class="${c.action}" id="bone-phys-bake">Bake Physics</button>
    </div>`;

    // THE WHOLE SECTION EXISTS FROM THE START, AND IT IS LIVE FROM THE START.
    //
    // These rows used to be rendered only while a flagged joint was selected, on the reasoning
    // that "a panel that renders dead sliders the rest of the time is more things to read past".
    // That trades one cost for a worse one: the section's CONTENTS changed under your hand the
    // moment you flagged a joint, so its shape was never the same twice. matt: "all the options
    // for physics should be there from the start, not just built the first time i enable physics
    // on a bone" -- and the reading-past problem is answered by the fold, which is what a fold is
    // for.
    //
    // NOT DISABLED EITHER, which was the first answer and the wrong one. With no joint selected
    // the sliders edit PhysicsBones.DEFAULTS -- the values the next joint you flag will be given.
    // matt: "i think its valid for someone to setup the values to a state they know is good, then
    // enable physics." So the section always does something; what it acts on is the joint when
    // there is one and the defaults when there is not, which is the same selection-or-fallback
    // rule the rest of this panel runs on.
    const physParams = `
    <div class="${c.row}">
      <span class="${c.val}" id="bone-phys-aim"
        style="flex:1;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${physAim}</span>
    </div>
    <div class="${c.row}">
      <span class="${c.lbl}">Weight</span>
      <input type="range" id="bone-phys-weight" min="0" max="100" step="1" value="${Math.round(physW * 100)}">
      <span class="${c.val}" id="bone-phys-weight-val">${Math.round(physW * 100)}</span>
    </div>
    <div class="${c.btnRow}">
      <button class="${c.action}" id="bone-phys-key">Key Weight</button>
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
      <span class="${c.lbl}">Follow${xpbd ? ' (n/a)' : ''}</span>
      <input type="range" id="bone-phys-inert" min="0" max="100" step="1" value="${Math.round(physP.inertia * 100)}"${xpbd ? ' disabled' : ''}>
      <span class="${c.val}" id="bone-phys-inert-val">${Math.round(physP.inertia * 100)}</span>
    </div>
    <div class="${c.row}">
      <span class="${c.lbl}">Drag</span>
      <input type="range" id="bone-phys-drag" min="0" max="100" step="1" value="${Math.round(physP.drag * 100)}">
      <span class="${c.val}" id="bone-phys-drag-val">${Math.round(physP.drag * 100)}</span>
    </div>
    ${/* MASS IS THE AXIS STIFFNESS CANNOT REACH: a spring's frequency is sqrt(k/m), and with only
         k adjustable every setting was a stiff spring -- the other controls just chose whether it
         rang in a vacuum or in honey. matt: "it always feels like a very stiff spring... its very
         black and white." Measured on his puppet: stiffness alone spanned 2.0-6.7 Hz and not even
         monotonically, while mass spans 7.2 Hz down to 0.6.
         EXPONENTIAL, because a frequency knob is multiplicative and a linear one would put every
         useful value in the bottom tenth. 50 is 1x, each 25 is a decade, so the ends are 0.01x
         and 100x. */ ''}
    <div class="${c.row}">
      <span class="${c.lbl}">Mass</span>
      <input type="range" id="bone-phys-mass" min="0" max="100" step="1"
             value="${Math.round(50 + 25 * Math.log10(Math.max(0.01, physP.mass || 1)))}">
      <span class="${c.val}" id="bone-phys-mass-val">${fmtMass(physP.mass || 1)}</span>
    </div>
    ${/* Solver quality, and only safe to expose now that lambda accumulates: before it, more of
         either made the chain WORSE. Iterations changing nothing is the CORRECT reading -- it
         means the solve has already converged. */ ''}
    <div class="${c.row}">
      <span class="${c.lbl}">Substeps</span>
      <input type="range" id="bone-phys-sub" min="1" max="32" step="1" value="${physP.substeps || 8}">
      <span class="${c.val}" id="bone-phys-sub-val">${physP.substeps || 8}</span>
    </div>
    <div class="${c.row}">
      <span class="${c.lbl}">Iterations</span>
      <input type="range" id="bone-phys-iter" min="1" max="16" step="1" value="${physP.iterations || 1}">
      <span class="${c.val}" id="bone-phys-iter-val">${physP.iterations || 1}</span>
    </div>
    <div class="${c.toggles}">
      ${flagButton(c, 'phys-ground', 'Ground Collision', physP.ground)}
      ${flagButton(c, 'phys-collide', 'Self Collision', physP.collide)}
    </div>`;

    // EVERY BLOCK IS A SECTION, AND EVERY SECTION FOLDS. matt: "make all the sections
    // collapsible. so have a 'mode' section, a 'view and assist' where you can fold the view
    // modes and the snap/sym buttons, a 'pose' section for the last 4 buttons, and a 'physics'
    // section."
    //
    // The panel had one bare grid, one bare toggle row, two folds and a loose pair of buttons, so
    // there was no rule about what a heading meant -- some things had one, some did not, and the
    // ones that did were the long ones. Uniform folds give the column a single rhythm and make
    // the panel's shape a statement of what it contains rather than of what happened to be tall.
    //
    // VIEW AND ASSIST holds the two things that change what you SEE and what the pointer does to
    // it, which is why the display chips move in here from the wrist panel's own markup -- see
    // buildBoneQuickDisplayHTML. Both halves are set-and-forget within a task, which is what makes
    // the fold cheap.
    //
    // MODE DEFAULTS OPEN. It is the one block you touch between every other action, and a fold in
    // front of it would be a tax on all of them. The rest default closed; Physics opens itself
    // when there is a flagged joint selected, because selecting one is how you said you were
    // about to tune it.
    const modeBody = `
    <div class="${c.grid}">${modeBtns}</div>
    ${roundTarget ? `<div class="${c.row}">
      <span class="${c.lbl}">Sharpness (${roundName})</span>
      <input type="range" id="bone-round" min="20" max="120" step="5" value="${Math.round(roundVal*10)}">
      <span class="${c.val}" id="bone-round-val">${roundVal.toFixed(1)}</span>
    </div>` : ''}`;

    const viewBody = buildBoneQuickDisplayHTML(main, style) + `
    <div class="${c.toggles}">
      ${flagButton(c, 'snap', 'Snap Plane', snap)}
      ${flagButton(c, 'axis', 'Snap Axis', axis)}
      ${flagButton(c, 'sym', 'Symmetry', !!sm?._symmetry)}
    </div>`;

    // ── CHAIN (audit items A1, A2, A5) ────────────────────────────────────────────────
    //
    // Split, Dissolve and Name chain existed only in the VR marking menu. All three are per-bone
    // STRUCTURAL edits, which is the same question the Pins section answers, so they answer it the
    // same way: rigPanelTarget, and a row saying which joint it resolved to.
    //
    // NOT GATED ON THE BONE TOOL, unlike the ring's copies of Split and Dissolve. That gate is
    // about how the RING resolves its target: it takes the bone under the hand, and bone selection
    // is only on in Bone Draw (see BONE_SELECT in Picking for why it cannot be on in Grab). A
    // panel has no hover and resolves a selected JOINT, which every tool can give it -- so gating
    // here would disable a command whose target the pick can perfectly well find. The same
    // reasoning already leaves the ring's Name chain ungated.
    //
    // SPLIT IS TWO BUTTONS, because one was a guess. RigTopology.split takes a JOINT and cuts the
    // bone `parent -> joint` -- the same "a joint owns the bone that ends at it" convention the
    // capsule radius and the physics shapes use. That is unambiguous in the code and invisible in
    // the panel: with a joint selected, "Split" could mean either of the two bones touching it.
    // matt: "lets go 'split->parent' and 'split->child', so its unambiguous."
    //
    // ABOVE / BELOW rather than parent / child in the label, because that is what you are looking
    // at while you press it -- the bone on the far side of the joint from the tip you just drew.
    // Below asks the same function about the CHILD joint, so one implementation serves both.
    //
    // Split Below needs exactly ONE child: at a fork there is no "the" bone below, and splitting
    // an arbitrary one of three fingers is the kind of guess this pair of buttons exists to kill.
    const chainAim = rigPanelTarget(main);
    const chainBody = `
    <div class="${c.row}">
      <span class="${c.val}" id="bone-chain-aim"
        style="flex:1;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${
          pinTargetLabel(main)}</span>
    </div>
    <div class="${c.toggles}">
      <button class="${c.toggle}" id="bone-split-up"${
        RigTopology.canSplit(main, chainAim) ? '' : ' disabled'}>Split Above</button>
      <button class="${c.toggle}" id="bone-split-down"${
        RigTopology.canSplit(main, soleChild(main, chainAim)) ? '' : ' disabled'}>Split Below</button>
      <button class="${c.toggle}" id="bone-dissolve"${
        RigTopology.canDissolve(main, chainAim) ? '' : ' disabled'}>Dissolve</button>
    </div>
    <div class="${c.toggles}">
      <button class="${c.toggle}" id="bone-name-chain"${chainAim ? '' : ' disabled'}>Name</button>
    </div>`;

    return `
    ${collapsibleHTML('bone-mode', 'Mode', modeBody, true)}
    ${collapsibleHTML('bone-chain', 'Chain', chainBody, false)}
    ${collapsibleHTML('bone-view', 'View and Assist', viewBody, false)}
    ${collapsibleHTML('bone-setup', 'Setup', setupBody, false)}
    ${collapsibleHTML('bone-physics', 'Physics', physButtons + physParams, !!physTarget)}
  `;
  }

  return `
    ${sectionTitle(c, 'Rig Authoring')}
    <div class="${c.grid}">${modeBtns}</div>
    ${roundTarget ? `<div class="${c.row}">
      <span class="${c.lbl}">Sharpness (${roundName})</span>
      <input type="range" id="bone-round" min="20" max="120" step="5" value="${Math.round(roundVal*10)}">
      <span class="${c.val}" id="bone-round-val">${roundVal.toFixed(1)}</span>
    </div>` : ''}
    <div class="${c.toggles}">
      ${flagButton(c, 'snap', 'Snap Plane', snap)}
      ${flagButton(c, 'axis', 'Snap Axis', axis)}
      ${flagButton(c, 'sym', 'Symmetry', !!sm?._symmetry)}
    </div>
    ${full ? `
    <div class="${c.btnRow}">
      <button class="${c.action}" id="bone-rad-all">Reset Radii</button>
      <button class="${c.action}" id="bone-skin">Make Skin</button>
    </div>
    <div class="${c.btnRow}">
      ${/* "WEIGHT CAGES", NOT "CAPSULES". This button bakes editable cage GEOMETRY you sculpt to
           shape the skin weights -- WeightCage, nothing to do with the Capsules chip in View and
           Assist, which shows and hides the rig's drawn capsules. Sharing the word put a
           capsules-looking control next to Make Skin, which is exactly where someone hunting for
           the display toggle looks. adurna35: "was looking for turning capsules on/off in the
           same area that I can make skin." The word that disambiguates is the one the code has
           used all along. */ ''}
      <button class="${c.action}" id="bone-cages" title="${hasCages
        ? 'Delete the baked weight cages; binding returns to the drawn capsules'
        : 'Bake editable cage geometry you can sculpt to shape the skin weights'}">${
        hasCages ? 'Delete Weight Cages' : 'Bake Weight Cages'}</button>
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
    <div class="${c.row}"${xpbd ? ' inert aria-disabled="true" style="opacity:0.45"' : ''}
      title="${xpbd
        ? 'Not used by the constraint solver: it couples the chain itself, so Follow only fights it.'
        : 'How much the chain comes along with the thing it hangs off.'}">
      <span class="${c.lbl}">Follow${xpbd ? ' (n/a)' : ''}</span>
      <input type="range" id="bone-phys-inert" min="0" max="100" step="1" value="${Math.round(physP.inertia * 100)}"${xpbd ? ' disabled' : ''}>
      <span class="${c.val}" id="bone-phys-inert-val">${Math.round(physP.inertia * 100)}</span>
    </div>
    <div class="${c.row}">
      <span class="${c.lbl}">Drag</span>
      <input type="range" id="bone-phys-drag" min="0" max="100" step="1" value="${Math.round(physP.drag * 100)}">
      <span class="${c.val}" id="bone-phys-drag-val">${Math.round(physP.drag * 100)}</span>
    </div>
    ${/* MASS IS THE AXIS STIFFNESS CANNOT REACH: a spring's frequency is sqrt(k/m), and with only
         k adjustable every setting was a stiff spring -- the other controls just chose whether it
         rang in a vacuum or in honey. matt: "it always feels like a very stiff spring... its very
         black and white." Measured on his puppet: stiffness alone spanned 2.0-6.7 Hz and not even
         monotonically, while mass spans 7.2 Hz down to 0.6.
         EXPONENTIAL, because a frequency knob is multiplicative and a linear one would put every
         useful value in the bottom tenth. 50 is 1x, each 25 is a decade, so the ends are 0.01x
         and 100x. */ ''}
    <div class="${c.row}">
      <span class="${c.lbl}">Mass</span>
      <input type="range" id="bone-phys-mass" min="0" max="100" step="1"
             value="${Math.round(50 + 25 * Math.log10(Math.max(0.01, physP.mass || 1)))}">
      <span class="${c.val}" id="bone-phys-mass-val">${fmtMass(physP.mass || 1)}</span>
    </div>
    ${/* Solver quality, and only safe to expose now that lambda accumulates: before it, more of
         either made the chain WORSE. Iterations changing nothing is the CORRECT reading -- it
         means the solve has already converged. */ ''}
    <div class="${c.row}">
      <span class="${c.lbl}">Substeps</span>
      <input type="range" id="bone-phys-sub" min="1" max="32" step="1" value="${physP.substeps || 8}">
      <span class="${c.val}" id="bone-phys-sub-val">${physP.substeps || 8}</span>
    </div>
    <div class="${c.row}">
      <span class="${c.lbl}">Iterations</span>
      <input type="range" id="bone-phys-iter" min="1" max="16" step="1" value="${physP.iterations || 1}">
      <span class="${c.val}" id="bone-phys-iter-val">${physP.iterations || 1}</span>
    </div>
    <div class="${c.toggles}">
      ${flagButton(c, 'phys-ground', 'Ground Collision', physP.ground)}
      ${flagButton(c, 'phys-collide', 'Self Collision', physP.collide)}
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
    ${/* THE OTHER HALF OF THE X-RAY, and it only appears once there are cages to dim. X-Ray
         fades the SKIN so you can find the capsule inside it; this fades the CAPSULES so you
         can watch the weights change on the skin underneath while you sculpt one. matt: "i'd
         need to set their opacity all at once, so i can verify that sculpting it is affecting
         the weights of the target geometry." All of them together -- a cage is never the thing
         you are looking at, and twenty outliner rows is not a thing anyone will do. */ ''}
    ${hasCages ? `
    <div class="${c.row}">
      <span class="${c.lbl}">Cages</span>
      <input type="range" id="bone-cage-op" min="5" max="100" step="1" value="${cageOp}">
      <span class="${c.val}" id="bone-cage-op-val">${cageOp}%</span>
    </div>
    <div class="${c.btnRow}">
      <button class="${c.action}" id="bone-select-cages" title="Select every weight cage, so they can be hidden, moved or deleted as a set">Select Cages</button>
    </div>` : ''}
    <div class="${c.row}">
      <span class="${c.lbl}">Mush</span>
      <input type="range" id="bone-mush" min="0" max="60" step="1" value="${mush}">
      <span class="${c.val}" id="bone-mush-val">${mush}</span>
    </div>
    ` : `
    ${/* A CONTROL THAT VANISHES CANNOT BE TOLD FROM ONE THAT IS BROKEN.
         X-Ray and Mush need a bound mesh, and when there is not one these rows used to simply
         not exist, so a binding lost to a topology edit showed up as a slider that had been
         there a minute ago and now was not, with nothing saying why. The row stays and states
         its condition instead. matt: "the bone parameters are getting unreliable."

         Written as a JS comment inside the substitution, NOT as an HTML comment: panel markup is
         rasterised by serialising the DOM into an SVG, and XML forbids `--` inside a comment. An
         em dash in one of these froze the whole Bones properties page — see panelxml_test. */''}
    <div class="${c.row}" style="opacity:0.6">
      <span class="${c.lbl}">X-Ray / Mush</span>
      <span class="${c.val}" style="flex:1;text-align:left">need a bound mesh — press Bind</span>
    </div>
    `}
    ` : ''}
  `;
}

// Pose operations are useful anywhere a rig node can be held. Bone Draw, Grab and TransformVR
// all bind the same A-button pin cycle, so their menus all expose this same block.
export function buildBonePoseHTML(main, style) {
  const c = DIALECT[style] || DIALECT.mm;
  const pins = IKSolver.pinnedJoints(main).length;
  const bound = Skinning.anyBound(main);
  const poseBody = `
    <div class="${c.btnRow}">
      <button class="${c.action}" id="bone-unpin">${pinLabel(pins)}</button>
      <button class="${c.action}" id="bone-restpose"
        title="Put every joint back to the skeleton as it was built. Recorded when you draw a bone and updated by Tweak, so it exists from the first bone \u2014 posing, grabbing and IK never change it.">Rest Pose</button>
    </div>
    <div class="${c.btnRow}">
      <button class="${c.action}" id="bone-mirror">Mirror Pose</button>
      <button class="${c.action}" id="bone-flip">Copy Side</button>
    </div>
    ${bound ? `<div class="${c.btnRow}">
      <button class="${c.action}${Skinning.bindPoseHeld() ? ' active' : ''}" id="bone-bindpose"
        title="Jump to the pose the SKIN was bound in and hold it there, so you can sculpt the bind shape. Not the same as Rest Pose — that is the rig's rest, which can differ from the bind. Physics, playback and pin solves stand down while it is held; pressing it again puts the pose you left back exactly.">${
          Skinning.bindPoseHeld() ? 'Leave Bind Pose' : 'Sculpt Bind Pose'}</button>
      <button class="${c.action}" id="bone-revert"
        title="Throw away every sculpt made since the mesh was bound and put the bind shape back. Not an undo — it does not care how the shape got here, which is what makes it useful when a stroke went wrong in a way you cannot walk back. The rig, the weights and the pose are untouched.">Revert to Bind Shape</button>
    </div>` : ''}`;

  // ── PINS (audit groups B and C) ─────────────────────────────────────────────────────
  //
  // Eleven commands that existed ONLY in the VR marking menu, two of them -- Rotation Only and
  // Aim -- unreachable on iPad by any route at all. The main panel's Pose block had Clear Pins
  // and nothing else, which is an all-pins wipe rather than a per-joint mode.
  //
  // HERE, because buildBonePoseHTML is already rendered by the main panel AND the wrist panel,
  // and by all three tools that bind the A-button pin cycle -- Bone Draw, Grab and TransformVR.
  // One builder, every surface, including the hands-only runtime where the wrist panel is the
  // only menu there is.
  //
  // The mode you are in reads ACTIVE rather than dimmed. The ring dims it, because in a marking
  // menu dimming is the only channel available to say "you are already here"; a panel has the
  // active state every other mode row in this file already uses, and inverting that one row
  // would be the odd one out.
  const pinTarget = rigPanelTarget(main);
  const pinMode = pinTarget ? IKSolver.pinMode(pinTarget) : 0;
  const pinOn = (m) => (pinMode === m ? ' active' : '');
  const pinChip = (id, label, m) =>
    `<button class="${c.toggle}${pinOn(m)}" id="bone-${id}">${squeezeLabel(label, c.chip)}</button>`;

  // GROUND COMPOSES WITH ALL FOUR MODES rather than being a fifth one, so it is a flag and not a
  // chip in the mode set. Its label carries its state, as the ring's does: dimming would say
  // "choosing this does nothing", which is true of a mode you are in and false of a toggle.
  const ground = pinTarget && pinMode ? IKSolver.keepsAboveGround(pinTarget) : false;
  const pinWeightBody = `
    <div class="${c.toggles}">
      <button class="${c.toggle}" id="bone-pin-act">Activate</button>
      <button class="${c.toggle}" id="bone-pin-deact">Deactivate</button>
      <button class="${c.toggle}" id="bone-pin-match">Match</button>
    </div>
    <div class="${c.toggles}">
      <button class="${c.toggle}" id="bone-pin-half">Half</button>
      <button class="${c.toggle}" id="bone-pin-clear"${pinHasKeys(pinTarget) ? '' : ' disabled'}>Clear Keys</button>
    </div>`;

  // DIMMED WITH NO JOINT SELECTED, and deliberately NOT the answer the physics sliders got.
  //
  // Those stay live and edit DEFAULTS, because setting the values you want and then flagging a
  // joint is a real way to work. The same move was considered here -- the mode a NEW pin gets,
  // which the A-button cycle currently hardcodes -- and rejected once the layout was in front of
  // matt: "there's only one button to push, your choice of pin, so preselection options makes no
  // sense here."
  //
  // Which is the distinction, and it is worth keeping straight: physics is a flag you set and
  // then tune, so its parameters have a life before the flag exists. A pin is ONE act with the
  // mode chosen inside it, so there is no before to configure.
  const pinsBody = `
    <div class="${c.row}">
      <span class="${c.val}" id="bone-pin-aim"
        style="flex:1;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${
          pinTargetLabel(main)}</span>
    </div>
    <fieldset class="mm-disabled-group"${pinTarget ? '' : ' disabled'}>
    <div class="${c.toggles}">
      ${pinChip('pin-pos', 'Position', IKSolver.PIN_POS)}
      ${pinChip('pin-full', 'Pos + Rot', IKSolver.PIN_FULL)}
      ${pinChip('pin-rot', 'Rot Only', IKSolver.PIN_ROT)}
    </div>
    <div class="${c.toggles}">
      ${pinChip('pin-aimmode', 'Aim', IKSolver.PIN_SOFT)}
      <button class="${c.toggle}" id="bone-pin-none">Unpin</button>
      ${pinMode ? flagButton(c, 'pin-ground', ground ? 'Ground On' : 'Ground Off', ground) : ''}
    </div>
    ${pinMode ? pinWeightBody : ''}
    </fieldset>`;

  // A SECTION LIKE THE REST OF THEM. It was the one block left with a plain title, which on the
  // wrist panel means no title at all -- DIALECT.mp has no title class, so sectionTitle there
  // renders a divider and nothing else, and four unlabelled buttons simply appeared under the
  // physics ones. Open by default: posing is what you are doing when this panel is up.
  if (uiReorg()) return collapsibleHTML('bone-pose', 'Pose', poseBody, true)
    + collapsibleHTML('bone-pins', 'Pins', pinsBody, false);

  return `
    ${sectionTitle(c, 'Pose')}
    ${poseBody}
  `;
}

export function buildBoneDisplayHTML(main, style) {
  const c = DIALECT[style] || DIALECT.mm;
  return `
    ${sectionTitle(c, 'Rig Display')}
    <!-- ON ITS OWN, ABOVE THE GRID. It governs every chip below it rather than being one of them,
         and sitting in the row made it read as a fourteenth display flag — one that would turn
         something called "All" on. matt: "'hide all' should be a toggle, not part of all the
         buttons." -->
    <button class="${c.wide}${Skeleton.decorationsHidden() ? ' active' : ''}" id="bone-hide-decor">${
      Skeleton.decorationsHidden() ? 'Decorations Hidden' : 'Hide All Decorations'}</button>
    <div class="${c.toggles}">
      ${flagButton(c, 'solid', 'Solid', Skeleton.displayFlagRaw('solid'))}
      ${flagButton(c, 'wire', 'Wire', Skeleton.displayFlagRaw('wire'))}
      ${flagButton(c, 'joints', 'Joints', Skeleton.displayFlagRaw('joints'))}
      ${flagButton(c, 'caps', 'Capsules', Skeleton.displayFlagRaw('capsules'))}
      ${flagButton(c, 'caps-shade', 'Shaded', Skeleton.displayFlagRaw('capsuleShaded'))}
      ${flagButton(c, 'skin-claims', 'Attach', Skeleton.displayFlagRaw('skinClaims'))}
      ${flagButton(c, 'weights', 'Weights', Skeleton.displayFlagRaw('weights'))}
      ${flagButton(c, 'len', 'Lengths', Skeleton.displayFlagRaw('lengths'))}
      ${flagButton(c, 'names', 'Names', Skeleton.displayFlagRaw('names'))}
      ${flagButton(c, 'pins', 'Pins', Skeleton.displayFlagRaw('pins'))}
      ${flagButton(c, 'trails', 'Trails', Skeleton.displayFlagRaw('trails'))}
      ${flagButton(c, 'gnomons', 'Rotation', Skeleton.displayFlagRaw('gnomons'))}
      ${flagButton(c, 'gnomons-all', 'All Keys', Skeleton.displayFlagRaw('gnomonsAll'))}
      <!-- Not a rig layer, but this is the preselection panel and that is what it is: the wire
           box an ordinary mesh shows, yellow while pointed at and cyan while selected. Hide All
           Decorations deliberately leaves it alone; see the flag's note in Skeleton. The key is
           still meshHover, so nobody's saved setting resets over a rename. -->
      ${flagButton(c, 'mesh-hover', 'Mesh Box', Skeleton.displayFlagRaw('meshHover'))}
    </div>
    <div class="${c.row}">
      <span class="${c.lbl}">Capsule Opacity</span>
      <input type="range" id="bone-cap-op" min="5" max="100" step="5"
        value="${Math.round(Skeleton.capsuleOpacity() * 100)}">
      <span class="${c.val}" id="bone-cap-op-val">${Math.round(Skeleton.capsuleOpacity() * 100)}</span>
    </div>
    <div class="${c.row}">
      <span class="${c.lbl}">Capsule Detail</span>
      <input type="range" id="bone-cap-seg" min="8" max="56" step="4" value="${Skeleton.capsuleSegments()}">
      <span class="${c.val}" id="bone-cap-seg-val">${Skeleton.capsuleSegments()}</span>
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
      ${flagButton(c, 'solid', 'Solid', Skeleton.displayFlagRaw('solid'))}
      ${flagButton(c, 'wire', 'Wire', Skeleton.displayFlagRaw('wire'))}
      ${flagButton(c, 'joints', 'Joints', Skeleton.displayFlagRaw('joints'))}
      ${flagButton(c, 'caps', 'Capsules', Skeleton.displayFlagRaw('capsules'))}
      ${flagButton(c, 'pins', 'Pins', Skeleton.displayFlagRaw('pins'))}
      ${/* WEIGHTS BELONGS WITH THESE FIVE. It is the display mode you flip most while actually
           rigging -- bind, look at the falloff, sculpt, look again -- and it lived only in the
           main menu's Rig Display block, which is a section away in a different panel. matt:
           "i realised 'weights' should be in the 'view and assist' section of the bone properties
           too." Same id as the main menu's copy, which is safe for the same reason the other five
           already are: each panel wires its own root.
           It also makes six, which fills the three-column grid evenly -- the ragged fifth chip
           is what adurna35 saw pushed outside the wrist panel. */ ''}
      ${flagButton(c, 'weights', 'Weights', Skeleton.displayFlagRaw('weights'))}
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
  flag('caps-shade', 'capsuleShaded');
  // Where Make Skin will bridge each bone. Named 'Attach' rather than 'Claims': the lattice's
  // word for it says nothing to someone deciding whether their fingers will come out right.
  flag('skin-claims', 'skinClaims');

  // SYMMETRY, WHERE THE RIG WORK HAPPENS. The toggle already exists in the main menu and on the
  // wrist panel, and neither is where you are while drawing bones — so in practice symmetry was
  // whatever it had been left as, which reads as "always on". matt: "sym mirroring is a big one,
  // there's an option to enable it in the grab minipanel, but not elsewhere, its just on by
  // default."
  //
  // NOT a display flag, so it does not go through `flag()`: this one is the sculpt manager's own
  // `_symmetry`, the same field those other two write. One field, three places to reach it —
  // rather than a rig-only copy that would then have to be kept in step with it.
  // THE MASTER SWITCH. Not a display flag of its own — it gates how the others are READ, so it
  // has its own accessor and its own storage. See Skeleton.decorationsHidden.
  // CAPSULE TESSELLATION, next to the other capsule cost. It is the mobile-VR knob — 56 segments
  // are 566k triangles across the solid and ghost passes, 28 are 140k, and the sawtooth the high
  // count buys is mostly gone by 28. Changing it rebuilds the batches, so it is a press-and-see
  // control rather than a drag: the slider writes on CHANGE, not on input.
  {
    const segIn = q('cap-seg'), segVal = q('cap-seg-val');
    if (segIn) segIn.addEventListener('change', () => {
      const v = Skeleton.setCapsuleSegments(main, parseInt(segIn.value, 10));
      if (segVal) segVal.textContent = String(v);
    });
  }

  q('hide-decor')?.addEventListener('click', () => {
    Skeleton.setDecorationsHidden(main, !Skeleton.decorationsHidden());
    refresh();
  });

  // Tenths, because the useful range is narrow: 2 is round, 4 already reads as a soft box, and
  // past about 8 the difference stops being visible. An integer slider would have four usable
  // stops.
  {
    const rIn = q('round'), rVal = q('round-val');
    if (rIn) rIn.addEventListener('input', () => {
      const sel = (main.getSelectedMeshes?.() || []).filter((m) => Skeleton.isJoint(m));
      if (sel.length !== 1) return;
      const v = parseInt(rIn.value, 10) / 10;
      Skeleton.setJointRound(sel[0], v);
      // THE TWIN TAKES IT TOO, like every other joint-shape edit. Tweak Joint already writes the
      // twin's scale and offset when it drags a face — sharpness is the same kind of property and
      // was simply missed. matt: "the sharpness isn't copied to the other side of the hierarchy
      // if symmetry is enabled."
      //
      // SIZES COPY, POSITIONS REFLECT is the rule from the joint-shape work, and an exponent is a
      // size-like quantity: it is the same number on both sides, with nothing to negate.
      //
      // Gated on the symmetry toggle rather than on a twin existing, because a joint drawn
      // symmetrically keeps its twin for life — see Skeleton.mirrorEdits.
      const twin = Skeleton.mirrorEdits(main) ? sel[0]._boneMirror : null;
      if (twin && main.getMeshes?.().includes(twin)) Skeleton.setJointRound(twin, v);
      if (rVal) rVal.textContent = v.toFixed(1);
      Skeleton.updateVisuals(main);
      main.render?.();
    });
  }

  q('sym')?.addEventListener('click', () => {
    const sm = main.getSculptManager?.();
    if (!sm) return;
    sm._symmetry = !sm._symmetry;
    refresh();
    main.render?.();
  });
  flag('solid', 'solid');
  flag('wire', 'wire');
  flag('joints', 'joints');
  flag('pins', 'pins');
  flag('trails', 'trails');
  flag('gnomons', 'gnomons');
  flag('gnomons-all', 'gnomonsAll');
  flag('mesh-hover', 'meshHover');

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
  // ...AND ONLY WHILE THE SYMMETRY TOGGLE IS ON. This checked that a twin EXISTED and nothing
  // else, so every operation it backs -- the physics flag, all seven physics parameters, both
  // collision toggles and now Dissolve -- mirrored whatever the toggle said. A joint drawn with
  // symmetry on carries `_boneMirror` for the rest of its life, so "has a twin" is not an answer
  // to "should this edit mirror". matt: "it should have been clear that i mean it should respect
  // the symmetry toggle. if on, dissolve with symmetry. if off, don't... all bone operations
  // should respect the symmetry toggle."
  //
  // Skeleton.mirrorEdits is the app's one answer to that question, and the display side of this
  // panel already asked it (see physTwin) -- so the panel was NAMING one joint and EDITING two.
  const withTwin = (j) => {
    const out = [j];
    const t = j._boneMirror;
    if (Skeleton.mirrorEdits(main) && t && main.getMeshes?.().includes(t) && t !== j) out.push(t);
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
  // A VALUE YOU CAN TYPE INTO. matt: "our sliders should be clickable on the value so i can type
  // in values if needed" -- a slider cannot reach a specific number, and on this rig the sweet
  // spot is between two steps.
  //
  // It drives the SLIDER's own `input` event rather than writing the parameter itself, so every
  // handler already wired to that slider keeps working with no knowledge of typing: one place to
  // add it, and no second path that can disagree about clamping, formatting or what gets written.
  //
  // `toSlider` converts the number a person types back into the slider's units. Most of these
  // sliders display their own raw value, so identity is the default; the two that do not --
  // Gravity showing g, Mass showing a multiplier -- pass their own inverse.
  const makeTypable = (input, val, toSlider, applyExact, fmt) => {
    if (!input || !val) return;
    val.style.cursor = 'text';
    val.title = 'Click to type a value';
    val.addEventListener('click', () => {
      if (val.querySelector('input')) return;           // already editing
      const shown = val.textContent;
      const box = document.createElement('input');
      box.type = 'text';
      box.value = shown.replace(/[^0-9.\-]/g, '');
      box.style.cssText = 'width:100%;box-sizing:border-box;font:inherit;color:inherit;'
        + 'background:#1e1e2e;border:1px solid #89b4fa;border-radius:3px;text-align:inherit;padding:0 2px';
      val.textContent = '';
      val.appendChild(box);
      box.focus(); box.select();
      let done = false;
      const finish = (keep) => {
        if (done) return; done = true;
        const n = parseFloat(box.value);
        val.textContent = shown;
        if (!keep || !isFinite(n)) return;
        // THE TYPED NUMBER IS WRITTEN EXACTLY, and the slider only follows for show. Routing it
        // through the slider's own event would round it to a step -- on the exponential Mass
        // scale a step is 9.6%, so typing 35 landed on 36.3. Reaching a value the slider cannot
        // is the entire reason to type one.
        const lo = parseFloat(input.min), hi = parseFloat(input.max);
        const sv = Math.max(lo, Math.min(hi, Math.round(toSlider(n))));
        input.value = String(sv);
        applyExact(n);
      };
      // Keys are stopped here or the panel's own shortcuts eat them mid-word.
      box.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') finish(true);
        else if (e.key === 'Escape') finish(false);
        e.stopPropagation();
      });
      box.addEventListener('keyup', (e) => e.stopPropagation());
      box.addEventListener('blur', () => finish(true));
    });
  };

  const physParam = (id, key, scale, fmt, toSlider, toParam) => {
    const input = q('phys-' + id), val = q('phys-' + id + '-val');
    // ONE WRITE PATH for the slider and the typed value: the same clamping, the same target
    // resolution, the same readout. Two paths would be two chances to disagree.
    const write = (v) => {
      // The joint the sliders are AIMED at — see PhysicsBones.panelTarget. Reading the selection
      // here instead would write to whatever you had grabbed to shake the rig with.
      const t = PhysicsBones.panelTarget(main,
        (main.getSelectedMeshes?.() || []).filter((m) => Skeleton.isJoint(m)));
      // NO JOINT MEANS THE DEFAULTS, not nothing. Setting the values you want and THEN flagging a
      // joint is a real way to work, and setRoot copies the defaults into whatever it flags -- so
      // this slider does the same job either way round. See PhysicsBones.setDefaults.
      if (t) for (const j of withTwin(t)) PhysicsBones.setParams(j, { [key]: v });
      else PhysicsBones.setDefaults({ [key]: v });
      // Read BACK what was stored, so the readout shows the clamp rather than what was asked for.
      const stored = t ? PhysicsBones.params(t)[key] : v;
      if (val) val.textContent = fmt(stored === undefined ? v : stored);
      main.render?.();
    };
    // TWO CONVERSIONS, because the number on screen is not always the number in either place.
    // Stiffness shows 7 for a parameter of 0.07 on a slider at 7; Gravity shows 1.75g for a
    // parameter of 1.75 on a slider at 175. Assuming one conversion covered both wrote a
    // stiffness of 7 -- clamped to 1, the rigid limit -- from a typed 7.
    makeTypable(input, val, toSlider || ((n) => n), (n) =>
      write((toParam || ((x) => (typeof scale === 'function' ? x : x / scale)))(n)), fmt);
    input?.addEventListener('input', () => {
      // `scale` is a divisor for a linear control, or a function for one that is not -- Mass is
      // exponential, because a frequency knob is multiplicative.
      const raw = parseInt(input.value, 10);
      write(typeof scale === 'function' ? scale(raw) : raw / scale);
    });
  };
  // The last argument is only needed where the number SHOWN is not the slider's own units.
  physParam('stiff', 'stiffness', 100, (v) => String(Math.round(v * 100)));
  physParam('grav', 'gravity', 100, (v) => v.toFixed(2) + 'g', (n) => n * 100, (n) => n);
  physParam('damp', 'damping', 100, (v) => String(Math.round(v * 100)));
  physParam('drag', 'drag', 100, (v) => String(Math.round(v * 100)));
  physParam('mass', 'mass', (n) => Math.pow(10, (n - 50) / 25), fmtMass,
    (n) => 50 + 25 * Math.log10(Math.max(0.01, n)));
  physParam('sub', 'substeps', 1, (v) => String(v));
  physParam('iter', 'iterations', 1, (v) => String(v));

  // CAPSULE SOLIDITY. Live on drag like the physics sliders and for the same reason: it is a
  // look, judged by watching. Skeleton persists it and rebuilds the batches, so the change lands
  // on the frame you are looking at and survives a reload.
  {
    const input = q('cap-op'), val = q('cap-op-val');
    input?.addEventListener('input', () => {
      const v = Skeleton.setCapsuleOpacity(main, parseInt(input.value, 10) / 100);
      if (val) val.textContent = String(Math.round(v * 100));
      main.render?.();
    });
  }
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
    const on = !(t ? PhysicsBones.params(t) : PhysicsBones.DEFAULTS).ground;
    const patch = { ground: on, groundY: PhysicsBones.groundHeight(main) };
    if (t) for (const j of withTwin(t)) PhysicsBones.setParams(j, patch);
    else PhysicsBones.setDefaults(patch);
    rebuild();
    main.render?.();
  });

  // SELF COLLISION (#36). Same shape as Ground above, and mirrored to the twin for the same
  // reason: a left ear that collides and a right one that does not is never what was wanted.
  q('phys-collide')?.addEventListener('click', () => {
    const t = PhysicsBones.panelTarget(main,
      (main.getSelectedMeshes?.() || []).filter((m) => Skeleton.isJoint(m)));
    const on = !(t ? PhysicsBones.params(t) : PhysicsBones.DEFAULTS).collide;
    if (t) for (const j of withTwin(t)) PhysicsBones.setParams(j, { collide: on });
    else PhysicsBones.setDefaults({ collide: on });
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

  // See-through CAGES, the mirror of the X-Ray above. Live on drag for the same reason: it is a
  // look, and a look is judged by watching it move.
  const cageOpInput = q('cage-op'), cageOpVal = q('cage-op-val');
  cageOpInput?.addEventListener('input', () => {
    const pct = parseInt(cageOpInput.value, 10);
    WeightCage.setOpacity(main, pct / 100);
    if (cageOpVal) cageOpVal.textContent = pct + '%';
    main.render?.();
  });

  // SELECT THEM ALL AS A SET. matt: "there's no shortcut to select or change the vis properties
  // of these capsule meshes." With the selection made, every tool that already works on a
  // multi-selection -- hide, move, delete, the outliner -- reaches the cages without any of
  // them being taught what a cage is.
  q('select-cages')?.addEventListener('click', () => {
    const cages = WeightCage.cages(main);
    if (!cages.length) { say('no weight cages to select', false); return; }
    // First replaces the selection, the rest add to it -- the same two-argument call the
    // outliner's ctrl-click uses, so this lands in exactly the state a manual multi-select does.
    cages.forEach((c, i) => main.setOrUnsetMesh(c, i > 0));
    Skeleton.updateVisuals(main);
    main.render?.();
    refresh();
    say('selected ' + cages.length + ' weight cage' + (cages.length === 1 ? '' : 's'));
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

  // BUILD IT AND BIND IT. A skin that is not weighted to the skeleton it was generated from is
  // not a state anyone wants to be in for even one click: it was built from the capsules, the
  // bind reads those same capsules, and the alternative is a mesh that ignores the rig until
  // you notice a second button. matt: "make a skin, immediately weight it to the bones (we
  // should do this by default i think)". Unbind is still there for the rare case.
  //
  // One report, not two: the bind is part of building a skin, so its numbers join the same
  // line. If the bind fails the skin still exists, and saying so is the whole point.
  q('skin')?.addEventListener('click', () => {
    const res = SkinMesh.build(main);
    const bnd = res.ok ? Skinning.bind(main, res.mesh) : null;
    say(res.ok
      ? `Bones: skin built — ${res.boxes} joints, `
        + `${res.bones} bones, ${res.verts} verts, ${res.faces} faces, ${res.ms}ms`
        + (bnd && bnd.ok
            ? `, bound to ${bnd.joints} joints in ${bnd.ms}ms`
              + (bnd.outside ? ` (${bnd.outside} verts outside every capsule)` : '')
            : `, NOT bound: ${(bnd && bnd.why) || 'bind failed'}`)
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

  // BINDS THE WHOLE SELECTION, not just the active mesh. A character arrives as separate
  // objects -- body, teeth, eyes, lashes -- and binding them one at a time means walking the
  // outliner and pressing this button seven times, each one a full weight solve you then have
  // to check. matt: "i should be able to shift-select many meshes at once and choose bind mesh."
  //
  // The active mesh is the fallback, not a special case: with one row selected the selection IS
  // that row, and with none it is empty and getMesh() is all there is.
  q('bind')?.addEventListener('click', () => {
    const sel = main.getSelectedMeshes?.() ?? [];
    const targets = sel.length ? sel.slice() : [main.getMesh?.()].filter(Boolean);
    if (!targets.length) { say('Bones: select a mesh first', false); return; }

    const results = targets.map((m) => Skinning.bind(main, m));
    const ok = results.filter((r) => r.ok);
    const bad = results.filter((r) => !r.ok);

    // One mesh keeps the detailed line it always had -- the vertex count and the outside count
    // are what you read it for. Several would be a paragraph, so they collapse to totals, with
    // the failures named because "5 of 7 bound" without saying which two is not an answer.
    if (results.length === 1) {
      const res = results[0];
      say(res.ok
        ? `Bones: bound ${res.name} — ${res.joints} joints, ${res.verts} verts, ${res.ms}ms`
          + (res.cages ? `, from ${res.cages} baked capsule(s)` : ', from drawn capsules')
          + (res.outside ? `, ${res.outside} verts outside every capsule` : '')
        : `Bones: ${res.why}`, res.ok);
    } else {
      const verts   = ok.reduce((a, r) => a + (r.verts | 0), 0);
      const ms      = ok.reduce((a, r) => a + (r.ms | 0), 0);
      const outside = ok.reduce((a, r) => a + (r.outside | 0), 0);
      say(`Bones: bound ${ok.length}/${results.length} — ${verts} verts, ${ms}ms`
        + (outside ? `, ${outside} verts outside every capsule` : '')
        + (bad.length ? ` — failed: ${bad.map((r) => r.name || '?').join(', ')} (${bad[0].why})` : ''),
        ok.length > 0);
    }
    rebuild(); // the button set itself changes once bound
    main.render?.();
  });

  // UNBINDS THE WHOLE SELECTION, the mirror of Bind. Binding seven pieces in one press and then
  // unbinding them one at a time is the kind of asymmetry you only notice by having to do it.
  // matt: "in the same way i can select many objects and bind, i should be able to select many
  // objects and unbind them."
  q('unbind')?.addEventListener('click', () => {
    const sel = main.getSelectedMeshes?.() ?? [];
    const targets = (sel.length ? sel.slice() : [main.getMesh?.()].filter(Boolean))
      .filter((m) => Skinning.isBound(m));
    if (!targets.length) { say('Bones: nothing bound in the selection', false); return; }
    for (const m of targets) Skinning.unbind(m);
    say('Bones: unbound ' + targets.length
      + (targets.length === 1 ? ' — ' + (targets[0]._permanentStaticLabel || 'mesh') : ' meshes'), true);
    rebuild();
    main.render?.();
  });

  // Back to the skeleton as built. Undoable in one step like any other pose edit — it is a big
  // change, and "I only wanted to see what it looked like" has to be free.
  //
  // THE REST POSE, NOT THE BIND POSE. Bind only exists once a mesh is attached, so this button
  // used to be absent for the whole authoring phase — which is exactly when you want it. Rest is
  // recorded when a bone is drawn, so it is there from the first one.
  //
  // IT JUMPS TO REST NO MATTER WHAT IS DRIVING THE RIG. Restoring the joint matrices alone is
  // only a third of the job: the pins stay where they were, so the next frame's solve hauls the
  // arms straight back off rest, and the physics chains still hold the state and the adopted
  // rest of the pose they were mid-swing in, so they resume from it. With keys, pins and physics
  // all live at once the three disagreed and the rig knotted. matt: "i tried pressing rest pose
  // when the rig had keys and pins and physics joints and whatnot. that should jump to the rest
  // pose no matter what... instead it put the skeleton into a tangled mess which i couldn't
  // recover from."
  //
  // So every driver is put back, in the order that makes each one's reset stick:
  //   physics first, because its own reset restores joints from ITS remembered pose and would
  //     overwrite the rest pose if it ran second;
  //   then rig and pins together (resetRigAndPins), which is the existing shared reset — rest
  //     matrices, bend references cleared, pins moved onto the joints they hold;
  //   then the re-init flag, so the first step after this seeds from the rest pose rather than
  //     from particles still standing where the swing left them.
  // "the rest can take over control once i jump the timeline" — nothing here touches the keys.
  // ── PINS (audit groups B and C) ──────────────────────────────────────────────
  //
  // Each handler is the ring's `run` with one substitution: the target comes from
  // rigPanelTarget instead of from the hover. Same call, same arguments, same undo — a second
  // implementation of any of these would be a second thing to keep in step, and the ring is
  // the one that has been in use.
  //
  // `rebuild` rather than `refresh` throughout: a mode change decides which controls EXIST
  // (Ground and the whole weight block appear only on a pin), so a pass that only re-classed
  // would leave the panel showing the previous mode's set.
  // ── CHAIN (audit items A1, A2, A5) ───────────────────────────────────────────
  //
  // The ring's own calls, with the target coming from the selection instead of the hover. Split
  // and Dissolve take the JOINT and act on the bone above it; Name opens the keyboard that
  // already exists, with a window.prompt fallback for a flat screen -- copied from the ring's
  // Keyboard wedge rather than reimplemented, so both routes ask the same question the same way.
  {
    const aimedChain = () => rigPanelTarget(main);
    const chainCmd = (id, run) => q(id)?.addEventListener('click', () => {
      const j = aimedChain();
      if (!j) { say('Bones: select one joint first', false); return; }
      run(j);
      rebuild();
      main.render?.();
    });
    chainCmd('split-up',   (j) => RigTopology.split(main, j));
    // The child's OWN bone is the one below this joint, so Split Below is the same call asked
    // about a different joint -- see soleChild for why a fork offers nothing.
    chainCmd('split-down', (j) => { const k = soleChild(main, j); if (k) RigTopology.split(main, k); });
    // DISSOLVE FOLLOWS THE MIRROR, like every other rig edit in this tool. matt: "dissolve should
    // work with symmetry." withTwin is the same helper the physics flag and its sliders use, so
    // the twin is included on exactly the same terms -- only while mirrorEdits is on, and only
    // when the twin is a different live joint.
    chainCmd('dissolve', (j) => { for (const t of withTwin(j)) RigTopology.dissolve(main, t); });
    // A LIST FIRST, THE KEYBOARD LAST, IN A PANEL THAT FLOATS IN FRONT OF THIS ONE.
    //
    // It was the keyboard and nothing else, which is the wrong order of preference: the names
    // people use are the twelve the marking menu already suggests, and pinch-typing "spine" one
    // letter at a time is a lot of work for a word the app knows. Putting the list INLINE in this
    // section was worse again -- matt: "super ugly and a massive waste of space... i meant a
    // floating panel to give a list of names."
    //
    // `opts.panel` is how it knows what to float in front of: the keyboard positions itself
    // against a source panel when it is given one and falls back to 0.7m straight ahead when it
    // is not, which is the "far away in depth, drawn on top" that has been irritating matt.
    chainCmd('name-chain', (j) => {
      const n = Skeleton.chainFrom(main, j).length;
      // The number is stripped so renaming twice does not give you `arm_01_01`.
      const cur = (j._permanentStaticLabel || '').replace(/_\d+(_[LR])?$/, '');
      const apply = (text) => { if (text) { Skeleton.nameChain(main, j, text); rebuild(); main.render?.(); } };
      const kb = window._vrKeyboard;
      if (kb && kb.shouldUse && kb.shouldUse()) {
        kb.openChoices({
          label: 'Name chain (' + n + ' joints)',
          columns: [Skeleton.AXIS_NAMES, Skeleton.LIMB_NAMES],
          current: cur, maxLength: 24,
        }, apply, opts.panel || null);
        return;
      }
      apply(window.prompt('Name this chain of ' + n + ' joints', cur));
    });
  }

  {
    const aimed = () => rigPanelTarget(main);
    const pinCmd = (id, run) => q(id)?.addEventListener('click', () => {
      const j = aimed();
      if (!j) { say('Bones: select one joint to pin', false); return; }
      run(j);
      rebuild();
      main.render?.();
    });
    pinCmd('pin-pos',     (j) => IKSolver.setPinMode(main, j, IKSolver.PIN_POS));
    pinCmd('pin-full',    (j) => IKSolver.setPinMode(main, j, IKSolver.PIN_FULL));
    pinCmd('pin-rot',     (j) => IKSolver.setPinMode(main, j, IKSolver.PIN_ROT));
    pinCmd('pin-aimmode', (j) => IKSolver.setPinMode(main, j, IKSolver.PIN_SOFT));
    pinCmd('pin-none',    (j) => IKSolver.setPinMode(main, j, IKSolver.PIN_NONE));
    pinCmd('pin-ground',  (j) => IKSolver.togglePinGround(main, j));
    // WEIGHT. "Here" was doing the work in the ring's labels and the column is too narrow to
    // keep it -- but all four act AT THE PLAYHEAD, which is what the word was saying. The
    // section they sit in only exists on a pinned joint, so the context carries it.
    pinCmd('pin-act',   (j) => IKSolver.setPinActive(main, j, true));
    pinCmd('pin-deact', (j) => IKSolver.setPinActive(main, j, false));
    pinCmd('pin-match', (j) => IKSolver.matchPinHere(main, j));
    pinCmd('pin-half',  (j) => IKSolver.setPinWeightKey(main, j, 0.5));
    pinCmd('pin-clear', (j) => IKSolver.clearPinWeight(main, j));
  }

  q('restpose')?.addEventListener('click', () => {
    // FLUSH THE SPRING TARGET FIRST. Rest Pose put every joint back on its authored rest and the
    // next physics step pulled the chain straight off it again, toward a target adopted from
    // whatever last wrote the joint -- an IK drag, typically. Cleared here, the step re-derives
    // it from _ikRest. See PhysicsBones.clearRest.
    PhysicsBones.clearRest(main);
    PhysicsBones.reset(main);
    const n = IKSolver.resetRigAndPins(main, 'Rest Pose');
    window._physicsNeedsInit = true;
    say(n ? `Bones: ${n} joints returned to the rest pose` : 'Bones: no rest pose recorded', !!n);
    Skeleton.updateVisuals(main);
    main.render?.();
  });

  // SCULPT THE BIND SHAPE. Two things the rest of the app has never had: an exact way to REACH
  // the pose the skin was bound in (the rig's rest pose is a different pose and can differ from
  // it), and a way to STAY there while you work -- physics alone moved 16 of walkwave's 33
  // joints off it inside a single frame. Toggling it off puts the pose you left back exactly.
  // A STROKE WRITTEN INTO REST SPACE CANNOT BE WALKED BACK BY EYE.
  //
  // matt: "at one point when working on the thigh, the mirrored sculpting operation went strange,
  // and it inverted... if i went back to the rest pose, the damage was permanent." It is
  // permanent because it is not pose, it is the rest shape -- the posed write-back put it there
  // on purpose. So this is the way out, and it is also the A/B for the bug that caused it:
  // revert, repeat the stroke, compare.
  q('revert')?.addEventListener('click', () => {
    const mesh = (main.getMeshes() || []).find((m) => Skinning.isBound(m));
    if (!mesh) { say('Bones: nothing is bound to the skeleton', false); return; }
    // Bounded to the BIND SHAPE's length, not the level's: the level can carry more vertices
    // than the weights cover, and a snapshot longer than `_skinRest` cannot be written back.
    const nbF = mesh._skinBindShape ? mesh._skinBindShape.length : 0;
    const liveV = Skinning.boundVertices(main, mesh);
    const before = (nbF && liveV && liveV.length >= nbF)
      ? new Float32Array(liveV.subarray(0, nbF)) : null;
    const r = Skinning.revertToBindShape(main, mesh);
    if (!r.ok) { say('Bones: ' + r.why, false); return; }
    // Undoable, because "put it all back" is exactly the button someone presses by accident.
    const after = new Float32Array(Skinning.boundVertices(main, mesh).subarray(0, nbF));
    const put = (buf) => {
      const v = Skinning.boundVertices(main, mesh);
      if (!v || !buf || buf.length > v.length) return;
      v.set(buf);
      mesh._skinRest.set(buf); mesh._skinSrc.set(buf);
      mesh._skinMushDirty = mesh._skinDirty = true;
      mesh._skinAdj = mesh._skinMushPair = mesh._skinMushDelta = mesh._skinMushScratch = null;
      Skinning.apply?.(main, mesh);
      main.render?.();
    };
    if (before) {
      main.getStateManager?.()?.pushStateCustom?.(
        () => put(before), () => put(after), false, 'Revert to Bind Shape');
    }
    Skinning.apply?.(main, mesh);
    Skeleton.updateVisuals(main);
    main.render?.();
    say(r.moved > 1e-6
      ? `Bones: bind shape restored (largest edit undone: ${r.moved.toFixed(3)})`
      : 'Bones: already at the bind shape — nothing to undo', true);
    rebuild();
  });

  q('bindpose')?.addEventListener('click', () => {
    const mesh = Skinning.anyBound(main)
      ? (main.getMeshes() || []).find((m) => Skinning.isBound(m)) : null;
    if (!mesh) { say('Bones: nothing is bound to the skeleton', false); return; }
    if (Skinning.bindPoseHeld()) {
      Skinning.exitBindPose(main);
      say('Bones: back to the pose you left', true);
    } else {
      Skinning.enterBindPose(main, mesh);
      say('Bones: holding the bind pose \u2014 sculpt, then press again to return', true);
    }
    rebuild();
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
  setFlag('snap', Skeleton.displayFlagRaw('snapPlane'));
  setFlag('axis', Skeleton.displayFlagRaw('snapAxis'));
  // Not a display flag — the sculpt manager's own `_symmetry`, which the main menu and the wrist
  // panel also write. Synced here so a toggle in either of those is reflected the next time this
  // panel repaints, rather than the three going out of step with each other.
  setFlag('sym', !!main.getSculptManager?.()?._symmetry);
  {
    // Label AND state: the button says which way it will go, so it has to be rewritten rather
    // than only re-classed.
    const hd = Skeleton.decorationsHidden();
    setFlag('hide-decor', hd);
    const b = q('hide-decor');
    if (b) b.textContent = hd ? 'Decorations Hidden' : 'Hide All Decorations';
  }
  setFlag('len', Skeleton.displayFlagRaw('lengths'));
  setFlag('names', Skeleton.displayFlagRaw('names'));
  setFlag('caps', Skeleton.displayFlagRaw('capsules'));
  setFlag('caps-shade', Skeleton.displayFlagRaw('capsuleShaded'));
  setFlag('weights', Skeleton.displayFlagRaw('weights'));
  setFlag('solid', Skeleton.displayFlagRaw('solid'));
  setFlag('wire', Skeleton.displayFlagRaw('wire'));
  setFlag('joints', Skeleton.displayFlagRaw('joints'));
  setFlag('pins', Skeleton.displayFlagRaw('pins'));
  setFlag('trails', Skeleton.displayFlagRaw('trails'));
  setFlag('gnomons', Skeleton.displayFlagRaw('gnomons'));
  setFlag('gnomons-all', Skeleton.displayFlagRaw('gnomonsAll'));
  setFlag('mesh-hover', Skeleton.displayFlagRaw('meshHover'));

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

  // WHAT THE PHYSICS SLIDERS ARE POINTED AT. Rewritten every sync for the same reason as the pin
  // count, and it is the reason this readout is allowed to exist at all: the version of it that
  // lived in the section HEADING was built once and then lied. Here it cannot be older than the
  // last sync, and it says the defaults case out loud rather than leaving a live slider that
  // appears to do nothing.
  // WHICH JOINT THE PIN CONTROLS ACT ON, rewritten every sync for the same reason the physics
  // readout is: the markup is built once and the selection moves on without it.
  const chainAim = q('chain-aim');
  if (chainAim) chainAim.textContent = pinTargetLabel(main);

  const pinAim = q('pin-aim');
  if (pinAim) {
    const t = rigPanelTarget(main);
    pinAim.textContent = pinTargetLabel(main);
    // AND THE DIMMING WITH IT. The readout was synced and the fieldset was not, so a panel built
    // with a joint selected kept live-looking controls after the selection was dropped -- the
    // row said "No joint selected" directly above six chips that looked pressable. Whatever says
    // there is no target has to be the same thing that stops you acting on it.
    const fs = pinAim.closest('[data-group-body="bone-pins"]')?.querySelector('fieldset')
      || root.querySelector('#bone-pin-pos')?.closest('fieldset');
    if (fs) fs.disabled = !t;
  }

  const aim = q('phys-aim');
  if (aim) {
    aim.textContent = physAimLabel(main, PhysicsBones.panelTarget(main,
      (main.getSelectedMeshes?.() || []).filter((m) => Skeleton.isJoint(m))));
  }
}

export { Enums };
