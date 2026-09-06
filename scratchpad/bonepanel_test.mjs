// Structural checks on the shared bones panel markup: both dialects, the XR gating, and
// that the ids the wiring looks for are the ids the markup emits.
import fs from 'fs';
const SRC = fs.readFileSync('/Users/mattestela/sculptxr/src/gui/bonePanel.js', 'utf8');
const MINI_SRC = fs.readFileSync('/Users/mattestela/sculptxr/src/gui/htmlvr/MiniPanel.js', 'utf8');
const MAIN_SRC = fs.readFileSync('/Users/mattestela/sculptxr/src/gui/htmlvr/MainMenuPanel.js', 'utf8');
const SKEL_SRC = fs.readFileSync('/Users/mattestela/sculptxr/src/editing/Skeleton.js', 'utf8');
const body = SRC.split('\n').filter(l => !/^import\s/.test(l)).filter(l => !/^export \{ Enums/.test(l)).join('\n');
globalThis.window = {};

// The display flags are read through Skeleton now, so the stub below carries the SAME defaults
// the real registry does — PARSED OUT of the real source rather than retyped here, or this
// harness would happily pass while the shipped defaults said something else.
const FLAG_SRC = fs.readFileSync('/Users/mattestela/sculptxr/src/editing/Skeleton.js', 'utf8');
const FLAG_DEFAULTS = {};
{
  const block = /const DISPLAY_FLAGS = \{([\s\S]*?)\n\};/.exec(FLAG_SRC);
  for (const m of (block ? block[1] : '').matchAll(/(\w+): \['(\w+)', '(\w+)', (true|false)\]/g)) {
    FLAG_DEFAULTS[m[1]] = m[4] === 'true';
  }
}
const stub = `
const Enums = { Tools: { BONE_DRAW: 34 } };
const Skeleton = {
  joints: () => [], radiusFraction: () => 0.25, defaultRadiusFrac: () => 0.25,
  DISPLAY_FLAGS: ${JSON.stringify(FLAG_DEFAULTS)},
  displayFlag: (n) => (_flagState[n] != null ? _flagState[n] : !!${JSON.stringify(FLAG_DEFAULTS)}[n]),
  setDisplayFlag: (n, v) => { _flagState[n] = !!v; },
  // Capsule solidity is a slider in the Rig Display block, so the panel asks for it while
  // building — a stub without it throws before a single check runs.
  capsuleOpacity: () => (_capOp == null ? 0.16 : _capOp),
  setCapsuleOpacity: (main, v) => { _capOp = Math.max(0.05, Math.min(1, v)); return _capOp; },
  // Bone shapes (roadmap #60): the panel asks which meshes are joints and what shape each has.
  isJoint: (m) => !!(m && m._isBone),
  jointVolume: (j) => (j && j._jointVolume) || 'none',
};
const _flagState = {};
let _capOp = null;
// Physics bones read through the panel now: a flagged joint grows three sliders, so the stub has
// to answer both "is this one flagged" and "with what parameters".
const PhysicsBones = {
  DEFAULTS: { stiffness: 0.06, damping: 0.7, gravity: 1 },
  isRoot: (j) => !!(j && j._physicsRoot),
  params: (j) => (j && j._physicsParams) || { stiffness: 0.06, damping: 0.7, gravity: 1 },
  setParams: () => true,
  setRoot: () => true,
  // The sliders aim at a REMEMBERED joint rather than the selection — see panelTarget. The stub
  // keeps the same rule so the markup checks below exercise it.
  // The blend weight is a keyable channel evaluated at the playhead, not a stored property —
  // the slider shows what it reads THERE, so the stub answers the same way.
  WEIGHT: 'physicsWeight',
  weight: (j) => (globalThis.__physW == null ? 1 : globalThis.__physW),
  setWeightKey: () => true,
  panelTarget: (main, sel) => {
    const one = (sel || []).filter((j) => j && j._physicsRoot);
    if (one.length === 1) main._physicsPanelTarget = one[0];
    const t = main._physicsPanelTarget;
    return (t && t._physicsRoot) ? t : null;
  },
};
const Skinning = { isBound: () => !!globalThis.__bound, anyBound: () => !!globalThis.__bound, refreshWeightColorsAll(){},
  mushIterations: () => 10, setMushIterations(){}, markDirtyAll(){},
  // The x-ray slider: the panel reads the current skin opacity to fill it in.
  skinOpacity: () => 1, setSkinOpacity(){}, applySkinOpacity(){},
  // The bind-pose hold: the Pose block asks whether it is on, to name and light its button.
  bindPoseHeld: () => !!globalThis.__bindHeld, enterBindPose(){}, exitBindPose(){} };
const SkinMesh = {};
// The panel asks whether any weight cages exist so it can label one button Bake or Delete.
// Stubbed to "none", which is the state every existing rig is in.
const WeightCage = { cages: () => (globalThis.__cages || []) };
const IKSolver = { pinnedJoints: () => [{},{}] };
`;
const mod = await import('data:text/javascript,' + encodeURIComponent(stub + body));
const {
  buildBoneSectionHTML,
  buildBoneAuthoringHTML,
  buildBonePoseHTML,
  buildBoneDisplayHTML,
  buildBoneQuickDisplayHTML,
  buildBoneAnimationHTML,
} = mod;

let fails = 0;
const check = (n, ok, got) => { console.log((ok ? '  ok   ' : '  FAIL ') + n + (ok ? '' : '  got: ' + got)); if (!ok) fails++; };

const main = { _xrSession: null, getSculptManager: () => ({ getCurrentTool: () => ({ modeKey: () => 'draw' }) }),
  getMesh: () => null,
  // Bone-shape buttons act on the selected joints, so the panel now asks for them.
  getSelectedMeshes: () => (globalThis.__sel || []),
  // The mirror header checks that a twin is actually IN the scene before naming it.
  getMeshes: () => (globalThis.__meshes || globalThis.__sel || []) };

const flat = buildBoneSectionHTML(main, 'mm');
// The cage button is one control with two states, not two controls -- either the rig weights
// from capsules or it weights from sculpted cages, and both being offered at once would invite
// the question of what having both means.
{
  globalThis.__cages = [];
  const none = buildBoneSectionHTML(main, 'mm');
  globalThis.__cages = [{}];
  const some = buildBoneSectionHTML(main, 'mm');
  globalThis.__cages = [];
  check('the cage button offers Bake when there are none',
    /id="bone-cages">Bake Capsules</.test(none));
  check('...and Delete when there are some',
    /id="bone-cages">Delete Capsules</.test(some));
  check('...as ONE button either way',
    (none.match(/id="bone-cages"/g) || []).length === 1
      && (some.match(/id="bone-cages"/g) || []).length === 1);
}
const vr = buildBoneSectionHTML({ ...main, _xrSession: {} }, 'mm');
const wrist = buildBoneSectionHTML({ ...main, _xrSession: {} }, 'mp');
const authoring = buildBoneAuthoringHTML(main, 'mm');
const pose = buildBonePoseHTML(main, 'mm');
const display = buildBoneDisplayHTML(main, 'mm');
const animation = buildBoneAnimationHTML(main, 'mm');

// Every mode now has a mouse/touch path in BoneDrawTool, so nothing is gated to a controller
// on a flat screen any more. The gate itself (XR_ONLY_MODES) is still wired, so a future
// 6DOF-only mode re-disables by being named there — that is what the third check pins down.
const modeGrid = (html) => html.slice(html.indexOf('id="bone-draw"'), html.indexOf('id="bone-snap"'));
check('flat screen disables no MODE', (modeGrid(flat).match(/disabled/g) || []).length === 0,
  (modeGrid(flat).match(/disabled/g) || []).length);
check('flat screen leaves Draw enabled', /id="bone-draw"(?![^>]*disabled)/.test(flat));
check('in VR no MODE is disabled', !/disabled/.test(modeGrid(vr)));
check('every mode button reaches a flat screen',
  ['bone-draw', 'bone-fk', 'bone-free', 'bone-pose', 'bone-radius', 'bone-ik']
    .every(id => /id="/.test(flat) && flat.includes('id="' + id + '"')));
check('every command button is present on a flat screen',
  ['bone-bind', 'bone-skin', 'bone-rad-all'].every(id => authoring.includes('id="' + id + '"'))
    && ['bone-unpin', 'bone-restpose'].every(id => pose.includes('id="' + id + '"'))
    && display.includes('id="bone-trails"'));
check('pin count reaches the label', /Clear Pins \(2\)/.test(flat));

// MAKE SKIN BINDS. The skin is generated FROM the capsules and the bind measures those same
// capsules, so an unbound skin is a state with no use: the mesh sits there ignoring the rig
// until you find a second button. matt: "make a skin, immediately weight it to the bones (we
// should do this by default i think)".
check('Make Skin binds the mesh it just built',
  /const res = SkinMesh\.build\(main\);\n\s*const bnd = res\.ok \? Skinning\.bind\(main, res\.mesh\) : null;/.test(SRC),
  'a skin that ignores the skeleton it was generated from is not a state worth passing through');
check('...and says so on the same line, including when the bind fails',
  /NOT bound: \$\{\(bnd && bnd\.why\)/.test(SRC),
  'the skin still exists after a failed bind, and silence there reads as "binding is broken"');
{
  const SKINMESH = fs.readFileSync('/Users/mattestela/sculptxr/src/editing/SkinMesh.js', 'utf8');
  check('...which needs build() to hand the mesh back',
    /return \{ ok: true, mesh: mesh,/.test(SKINMESH),
    'the caller cannot bind what it cannot name');
}

check('wrist panel uses its own class dialect', wrist.includes('mp-voxel-btn') && !wrist.includes('mm-choice'));
check('menu panel uses its own class dialect', flat.includes('mm-choice') && !flat.includes('mp-voxel-btn'));

// The ids the wiring binds must be the ids the markup emits — a rename in one half is
// otherwise a silently dead button.
const wired = [...SRC.matchAll(/q\('([a-z-]+)'\)/g)].map(m => m[1]);
// Unbind only exists once something is bound, so both states have to be covered.
globalThis.__bound = true;
const boundHTML = buildBoneSectionHTML({ ...main, _xrSession: {} }, 'mm');
globalThis.__bound = false;
check('Unbind appears once a mesh is bound', boundHTML.includes('id="bone-unbind"') && boundHTML.includes('Rebind'));
// The physics controls only exist while a flagged joint is selected, so that state has to be in
// the set this checks against — otherwise every one of them reads as "wired to nothing".
globalThis.__sel = [{ _isBone: true, getID: () => 1, _physicsRoot: true,
  _physicsParams: { stiffness: 0.2, damping: 0.5, gravity: 1.5, drag: 0.1, ground: true } }];
const physHTML = buildBoneAuthoringHTML(main, 'mm');
globalThis.__sel = [];
const all = vr + boundHTML + display + animation + physHTML;
const missing = [...new Set(wired)].filter(id => !all.includes('id="bone-' + id + '"') && id !== 'rad-val');
check('every wired id exists in the markup', missing.length === 0, missing.join(','));

// The three display toggles are one group to the eye and one group in the markup: the bone
// body, its edge overlay, and the joint markers with the IK pins that hang off them. Checked
// together because a toggle that renders but is never wired (or wired but never rendered) is
// exactly the failure the id sweep above cannot see on its own.
// Wired through the flag() helper rather than a literal q('id'), so the id sweep above cannot
// see them — the wiring call is what has to be looked for.
for (const id of ['solid', 'wire', 'joints']) {
  const drawn = display.includes('id="bone-' + id + '"');
  const hooked = SRC.includes("flag('" + id + "'");
  check('display toggle "' + id + '" is drawn and wired', drawn && hooked,
    (drawn ? '' : 'not in markup ') + (hooked ? '' : 'not wired'));
}

// THE JOINTS TOGGLE IS BACK. It went when the bone became the pick target; bone selection is
// off again, so the dots are the marker and they need a switch of their own. The bone is the pick target now, so the
// dots mark nothing — and the flag was PERSISTED, which meant anyone who had ever seen the old
// default carried it forward and got the dots back on every launch. Defaulting it off fixed
// nothing for the only person who had reported the problem. A display toggle whose one honest
// setting is off should not be on the panel at all.
// The id is built as `bone-${id}` at runtime, so the literal never appears in source — assert
// on the call that makes it, and on the two wirings without which the button is decorative.
check('the Joints toggle is on the panel',
  /flagButton\(c, 'joints', 'Joints'/.test(SRC)
    && /flag\('joints', 'joints'\);/.test(SRC)
    && /setFlag\('joints', Skeleton\.displayFlag\('joints'\)\);/.test(SRC),
  'the dots came back without a way to turn them off, which is worse than either state');

// The split itself: each concern appears in exactly its intended block. This is the property
// the reorganisation is for; checking only that every id exists would pass with the old
// undifferentiated panel.
check('authoring keeps bind diagnostics', /bone-(caps|weights|skin|bind)/.test(authoring));
check('authoring contains no pose, display or animation commands',
  !/bone-(unpin|mirror|flip|restpose|len|solid|wire|joints|key|trails)/.test(authoring));
check('pose contains only pose operations',
  ['unpin', 'mirror', 'flip', 'restpose'].every(id => pose.includes('bone-' + id))
    && !/bone-(draw|caps|key|trails|solid)/.test(pose));
check('pose names the full and one-sided pin operations clearly',
  pose.includes('>Mirror Pose<') && pose.includes('>Copy Side<'));
// Trails moved out of an animation block of its own and in beside the other rig display flags:
// in use it is simply another thing the rig can draw, reached for while looking at the rig
// rather than while setting up a take. The block went with it — an empty section is a heading
// with nothing under it.
check('DISPLAY owns Trails, and it sits after Pins',
  display.indexOf('bone-trails') > display.indexOf('bone-pins'),
  'it was asked for next to the other things the rig draws');
check('...and the obsolete whole-rig Key Pose command is still gone',
  !display.includes('bone-key') && !animation.includes('bone-key'));
check('...and the empty animation block is not still emitting a heading',
  animation.trim() === '', JSON.stringify(animation));

// Caller-level routing. The shared blocks can be perfect and still be invisible if one panel
// forgets to compose or wire them — the same parallel-implementation failure this split is
// meant to prevent.
// Grab now shows its Translate/Rotate channels above Pose, so the two are composed rather than
// Pose being returned alone. What matters is that Pose is still there.
check('MiniPanel shows Pose for Grab',
  /idx === Enums\.Tools\.GRAB\) \{[\s\S]{0,300}?buildBonePoseHTML\(this\._main, 'mp'\)/.test(MINI_SRC));
check('...alongside the grab channel buttons',
  /grabChannelHTML\(\)/.test(MINI_SRC));
check('MiniPanel composes Pose with TransformVR controls',
  /idx === Enums\.Tools\.TRANSFORM_VR \? buildBonePoseHTML\(this\._main, 'mp'\)/.test(MINI_SRC));
check('MainMenu shows Pose for Grab and TransformVR',
  /cur === Enums\.Tools\.GRAB \|\| cur === Enums\.Tools\.TRANSFORM_VR[\s\S]{0,100}?buildBonePoseHTML/.test(MAIN_SRC));
check('Rendering owns the rig display block',
  /function buildSectionHTML_rendering[\s\S]{0,250}?buildBoneDisplayHTML/.test(MAIN_SRC));
// (The rig-animation block used to be asserted here, as MainMenuPanel referencing
// buildBoneAnimationHTML directly. That IS the divergence that hid Trails from the desktop
// sidebar — only this host appended it. The block is now composed once by the shared animation
// section, and that is asserted below under "reaches BOTH animation panels".)

// Rendering is a spatial menu: sections stay put and become unavailable rather than being
// removed. Ground Plane is scene state, so it remains usable even when the current selection
// is a bone or there is no mesh selected.
const renderStart = MAIN_SRC.indexOf('export function buildSectionHTML_rendering');
const renderEnd = MAIN_SRC.indexOf('\nexport function ', renderStart + 1);
const RENDER_SRC = MAIN_SRC.slice(renderStart, renderEnd);
check('Rendering does not disappear when no mesh is selected',
  !/if \(!mesh\) return/.test(RENDER_SRC));
// Assert the PROPERTY, not the expression: the fieldset must take its disabled state from a
// variable that can evaluate to ' disabled'. Pinning the exact source line failed once the
// condition was widened from "a mesh is selected" to "a mesh exists at all", which is correct
// behaviour the old check called a regression.
check('mesh-only Rendering controls use a disabled fieldset', (() => {
  const tag = MAIN_SRC.match(/<fieldset class="mm-disabled-group"\$\{(\w+)\}/);
  if (!tag) return 'no fieldset interpolating a disable flag';
  const decl = new RegExp('(?:const|let|var)\\s+' + tag[1] + "\\s*=[^;]*' disabled'");
  return decl.test(MAIN_SRC) || `${tag[1]} is never assigned ' disabled'`;
})() === true);
// OUTSIDE the fieldset, on either side of it: the ground plane is not a mesh control and must
// not grey out with them. It moved ABOVE the fieldset when Scene Display went to the top of the
// menu (it is the toggle reached most often and sat below everything), so the check asks what it
// means -- not inside -- rather than pinning which side.
check('Ground Plane sits outside the mesh-disabled fieldset', (() => {
  const start = MAIN_SRC.indexOf('<fieldset class="mm-disabled-group"');
  const end = MAIN_SRC.indexOf('</fieldset>', start);
  const grid = MAIN_SRC.indexOf('id="mm-grid-toggle"');
  return start >= 0 && end > start && grid >= 0 && (grid < start || grid > end);
})());
// ...and it is near the TOP of the menu, which is the point of having moved it.
check('...and above the shader block, where it is reachable',
  MAIN_SRC.indexOf('id="mm-grid-toggle"') < MAIN_SRC.indexOf('${shaderBtns}'),
  'a long scroll in a headset to flip one switch');
check('shader-specific groups mute instead of hiding',
  !/\.mm-if-pbr[^\n]*display:\s*none/.test(MAIN_SRC)
    && /mm-if-pbr[^\n]*inert/.test(MAIN_SRC));

// ── The rig-animation block reaches BOTH animation panels ──────────────────────
//
// Trails lived only in the main menu, because MainMenuPanel appended the block itself and the
// desktop sidebar's Animation tab (AnimationControlPanel) did not. Same control, one of the two
// places that show it — so on desktop the flag was simply unreachable.
//
// The fix is composition in ONE place: the shared animation section carries the block, and
// neither host appends it. Assert that, not the presence of a string in each file.
{
  const ACP = fs.readFileSync('/Users/mattestela/sculptxr/src/gui/htmlvr/AnimationControlPanel.js', 'utf8');
  const MM  = fs.readFileSync('/Users/mattestela/sculptxr/src/gui/htmlvr/MainMenuPanel.js', 'utf8');

  check('the shared animation section composes the rig-animation block',
    /buildBoneAnimationHTML\(main, style \|\| 'acp'\)/.test(ACP));
  check('...so no host appends it a second time',
    !/buildAnimationSectionHTML\([^)]*\) \+ buildBoneAnimationHTML/.test(MM),
    'appending it per host is what made the two panels disagree');
  check('both hosts pass main through, or the block cannot be built',
    /buildAnimationSectionHTML\(main, 'acp'\)/.test(ACP)
      && /buildAnimationSectionHTML\(main, 'mm'\)/.test(MM));
  // Markup without wiring is a button that lights up and does nothing.
  check('the sidebar wires the bone block it now renders',
    /wireBoneSection\(this\._element, main/.test(ACP) && /syncBoneSection\(this\._element, main\)/.test(ACP),
    'the Trails button would render inert');
  check('the acp dialect exists for it',
    /acp: \{ grid: 'acp-btn-grid'/.test(SRC));
}

// ── Display flags: defaults, one registry, and persistence ──────────────────────
{
  const OPTS = fs.readFileSync('/Users/mattestela/sculptxr/src/misc/getOptionsURL.js', 'utf8');

  // Capsules and weights are DIAGNOSTICS drawn over the sculpt. Neither is what you want to
  // be looking at the moment the tool opens.
  check('capsules are off by default', FLAG_DEFAULTS.capsules === false, FLAG_DEFAULTS.capsules);
  check('weight colours are off by default', FLAG_DEFAULTS.weights === false, FLAG_DEFAULTS.weights);
  // The rest keep the defaults they had; a registry that quietly flipped them would be worse
  // than the sentinel it replaced.
  // The joint dots are a toggle again. They were removed when the bone became the pick target
  // and came back when that was switched off — but with no way to turn them off, which is
  // worse than either state. Default TRUE because bone selection ships OFF, so the dot is the
  // marker for the thing you are aiming at.
  check('joint dots are a flag again', FLAG_DEFAULTS.joints === true, FLAG_DEFAULTS.joints);
  for (const k of ['snapPlane', 'snapAxis', 'solid', 'wire']) {
    check(`${k} is still on by default`, FLAG_DEFAULTS[k] === true, FLAG_DEFAULTS[k]);
  }
  check('lengths are still off by default', FLAG_DEFAULTS.lengths === false, FLAG_DEFAULTS.lengths);

  // THE DEFAULT IS WRITTEN TWICE — registry and option validator — so they must agree, or a
  // reload silently changes what the panel shows.
  const rows = [...FLAG_SRC.matchAll(/(\w+): \['(\w+)', '(\w+)', (true|false)\]/g)];
  // Bound to the PROPERTY, not a tally: "exactly 8" breaks the day a ninth legitimate flag
  // is added, and the useful assertion is that EVERY flag in the registry is declared and
  // persisted — which the per-flag loop below checks one at a time.
  check('every flag is declared as a saved option',
    rows.length === Object.keys(FLAG_DEFAULTS).length,
    rows.length + ' declared vs ' + Object.keys(FLAG_DEFAULTS).length + ' flags');
  for (const [, name, , opt, def] of rows) {
    const m = new RegExp(`options\\.${opt} = queryBool\\(getVal\\('${opt}'\\), (true|false)\\)`).exec(OPTS);
    check(`${name} is persisted and its two defaults agree`, !!m && m[1] === def,
      m ? `registry ${def} vs option ${m[1]}` : 'the option is not declared, so it is not restored');
  }

  // NO RAW SENTINEL READS LEFT. `window._boneShowX !== false` hard-codes "default on" into
  // every reader — the arrangement that made flipping a default an eight-file edit.
  for (const f of ['src/gui/bonePanel.js', 'src/editing/Skeleton.js', 'src/editing/Skinning.js',
                   'src/editing/tools/BoneDrawTool.js']) {
    const t = fs.readFileSync('/Users/mattestela/sculptxr/' + f, 'utf8')
      .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
      .replace(/const DISPLAY_FLAGS[\s\S]*?\n\};/, '');
    const raw = /window\._bone(Show|Snap)\w+\s*(!==|===|=[^=])/.test(t);
    check(`${f.split('/').pop()} reads flags through the registry`, !raw,
      'a raw window._boneShowX read is back: it carries its own copy of the default');
  }

  // The toggle has to SAVE, or the panel forgets it the moment you take the headset off.
  check('toggling a flag persists it',
    /setDisplayFlag = function[\s\S]{0,300}?saveOption\(/.test(FLAG_SRC), 'no saveOption');
}

// ── THE PHYSICS CONTROLS APPEAR WITH THE FLAG, NOT BEFORE ─────────────────────────────
//
// matt asked for "controls for stiffness and gravity". They are per-joint, so they only mean
// something when exactly one flagged joint is selected — and a panel that renders three dead
// sliders the rest of the time is three more things to read past.
{
  globalThis.__sel = [];
  const none = buildBoneAuthoringHTML(main, 'mm');
  check('the physics toggle is always there', none.includes('id="bone-phys"'));
  check('...and the bake button with it', none.includes('id="bone-phys-bake"'));
  main._physicsPanelTarget = null;
  const virgin = buildBoneAuthoringHTML(main, 'mm');
  check('...but the sliders are not, until a physics joint has been picked',
    !virgin.includes('id="bone-phys-stiff"'),
    'with nothing ever targeted they would have nothing to edit');

  globalThis.__sel = [{ _isBone: true, getID: () => 1, _physicsRoot: true,
    _physicsParams: { stiffness: 0.2, damping: 0.5, gravity: 1.5 } }];
  const on = buildBoneAuthoringHTML(main, 'mm');
  check('a flagged joint grows stiffness, gravity and damping',
    on.includes('id="bone-phys-stiff"') && on.includes('id="bone-phys-grav"')
    && on.includes('id="bone-phys-damp"'));
  check('...showing that joint\'s own values',
    on.includes('value="20"') && on.includes('value="150"') && on.includes('value="50"'),
    'a slider that always shows the default is a slider that lies about the state');
  check('...and gravity reads as a multiple of earth',
    /1\.50g/.test(on),
    'an absolute number means something different on every rig — that is why nothing draped');
  globalThis.__sel = [];
}

// ── THE REST POSE EXISTS FROM THE FIRST BONE ──────────────────────────────────────────
//
// matt: "i noticed that there's no rest pose/bind pose until a skeleton is bound to a mesh...
// meaning if required i could go back to the rest pose at any time. in this case i'd suggest
// renaming the 'bind pose' button to 'rest pose', so it makes sense in all contexts."
//
// The rig already recorded a rest pose when a bone was drawn (IKSolver.captureRest) and
// re-recorded it on a Tweak edit, while posing, grabbing and IK only ever wrote the POSE. What
// was missing was the way back: the button restored the BIND pose, which does not exist until a
// mesh is attached, so it was hidden for the whole authoring phase — exactly when it is wanted.
{
  globalThis.__bound = false;
  const unbound = buildBonePoseHTML(main, 'mm');
  check('the rest pose button is there with nothing bound',
    unbound.includes('id="bone-restpose"'),
    'a rest pose exists from the first bone, so the way back to it should too');
  // The button's own label, not the panel's whole markup: a bound rig now ALSO offers a
  // separate bind-pose control, and the two are different poses on purpose.
  check('...and it is called Rest Pose, not Bind Pose',
    /id="bone-restpose"[\s\S]{0,400}?>Rest Pose<\/button>/.test(unbound)
      && !/id="bone-restpose"[\s\S]{0,400}?>Bind Pose<\/button>/.test(unbound),
    'it means the same thing in every context now, which is why it is renamed');
  globalThis.__bound = true;
  const boundNow = buildBonePoseHTML(main, 'mm');
  check('...and it does not change once a mesh IS bound',
    boundNow.includes('id="bone-restpose"') && /Rest Pose<\/button>/.test(boundNow));
  globalThis.__bound = false;
  // THE BIND POSE IS NOT THE REST POSE. `_ikRest` is the rig's rest, authored by Bone Draw and
  // Tweak; `_skinInvBind` is the pose the MESH was bound in. Nothing keeps them in sync, and on
  // walkwave they differ by up to 0.47 in the basis and 16 units in translation -- so pressing
  // Rest Pose put the rig at rest and left the mesh deformed. A bound scene gets its own control.
  {
    globalThis.__bound = true;
    const b = buildBonePoseHTML(main, 'mm');
    check('a bound rig can sculpt at the bind pose',
      b.includes('id="bone-bindpose"') && /Sculpt Bind Pose/.test(b),
      'Rest Pose is the rig\'s rest and need not be the pose the skin was bound in');
    globalThis.__bindHeld = true;
    const held = buildBonePoseHTML(main, 'mm');
    check('...and says so while it is holding, since everything else stands down meanwhile',
      /Leave Bind Pose/.test(held) && /active/.test(held));
    globalThis.__bindHeld = false;
    globalThis.__bound = false;
    check('...and an unbound scene is not offered it',
      !buildBonePoseHTML(main, 'mm').includes('id="bone-bindpose"'),
      'there is no bind pose without a bind');
  }
  check('the handler restores the REST pose, not the bind pose',
    /IKSolver\.resetRigAndPins\(main, 'Rest Pose'\)/.test(SRC) && !/restoreBindPose/.test(SRC),
    'bind is a moment; rest is the skeleton as built');
  // A rig under keys, pins AND physics has three things holding it off rest, and putting back
  // only the joint matrices leaves the other two pulling. matt: pressing Rest Pose "put the
  // skeleton into a tangled mess which i couldn't recover from".
  {
    // The handler body: from the listener to the end of its own block. Brace-balanced rather
    // than a fixed slice, so an added comment cannot push a rule out of the window.
    const i0 = SRC.indexOf("q('restpose')");
    let d = 0, i = SRC.indexOf('{', i0), j = i;
    for (; j < SRC.length; j++) { if (SRC[j] === '{') d++; else if (SRC[j] === '}' && --d === 0) break; }
    const h = SRC.slice(i0, j + 1);
    check('Rest Pose resets the pins too, not just the joint matrices',
      /resetRigAndPins/.test(h),
      'pins left behind haul the rig straight back off rest on the next solve');
    check('...and the physics state, before the rest pose is written',
      /PhysicsBones\.reset\(main\)/.test(h)
      && h.indexOf('PhysicsBones.reset(main)') < h.indexOf('resetRigAndPins'),
      "physics reset restores joints from ITS remembered pose, so running it second would undo the rest pose");
    check('...and asks the solver to re-seed on the next step',
      /_physicsNeedsInit\s*=\s*true/.test(h),
      'otherwise the particles resume from wherever the swing left them');
  }
}

// ── PHYSICS FOLLOWS THE PANEL'S OWN CONVENTIONS ───────────────────────────────────────
//
// Two things matt hit, both of which every other control in this panel already gets right.
//
// SOURCE-ANCHORED, and stated as such: this harness builds MARKUP and has no DOM to click, so
// what a handler does on click cannot be measured here. The markup half above is functional; this
// half pins the two lines that were wrong.
{
  // The sliders are conditional markup — they exist only while a flagged joint is selected — and
  // `refresh` only syncs DOM that is already there. Flagging a bone therefore left the panel
  // showing no controls at all. matt: "i have to do a bit of a dance to get out of the bone tool,
  // back into it, select a different mode, then select the bone, and then the controls appear."
  const physHandler = SRC.slice(SRC.indexOf("q('phys')?"), SRC.indexOf("q('phys-bake')?"));
  check('flagging a bone REBUILDS the panel, not just syncs it',
    /rebuild\(\);/.test(physHandler) && !/[^_]refresh\(\);/.test(physHandler),
    'markup that appears and disappears cannot be brought up to date by a sync');
  check('...and so does the ground toggle, which also adds a row',
    /q\('phys-ground'\)[\s\S]{0,600}?rebuild\(\);/.test(SRC));

  // matt: "it doesn't seem to take into account symmetry. like most things, if i make a left
  // antenna be physics, its right mirror should also do that. same for adjusting physics
  // properties."
  check('a physics flag carries to the mirror twin',
    /const withTwin = \(j\) => \{/.test(SRC) && /for \(const j of pair\) PhysicsBones\.setRoot/.test(SRC));
  check('...and so does every parameter drag',
    /for \(const j of withTwin\(t\)\) PhysicsBones\.setParams/.test(SRC),
    'a stiffness has no handedness, so the value copies rather than reflecting');
  check('...and the undo step holds both sides',
    /const snap = \(\) => pair\.map/.test(SRC),
    'a snapshot of one joint would restore half the edit');
}

// ── THE DISPLAY TOGGLES ARE WHERE YOU NEED THEM ───────────────────────────────────────
//
// matt: "i currently find i have to keep jumping between the display options and the bone tool
// to swap display modes. can we put buttons for display modes on the bones minipanel? so solid,
// wireframe, joints. i think we should also put capsules on the main display options too."
//
// Two separate moves. Capsules and Weights were display toggles living in the AUTHORING section
// — they say how the rig draws, not what it is — so they move to Rig Display with the rest.
// And the wrist panel, which has no Rig Display section at all, gets a compact row of the four
// you actually swap while rigging.
{
  const disp = buildBoneDisplayHTML(main, 'mm');
  check('Rig Display carries capsules now', disp.includes('id="bone-caps"'));
  check('...and weights with it', disp.includes('id="bone-weights"'));
  check('...alongside solid, wire and joints',
    ['solid', 'wire', 'joints'].every((k) => disp.includes('id="bone-' + k + '"')));

  const auth = buildBoneAuthoringHTML(main, 'mm');
  check('...and authoring no longer duplicates them',
    !auth.includes('id="bone-caps"') && !auth.includes('id="bone-weights"'),
    'two buttons for one flag in one panel is a sync bug waiting to happen — querySelector '
    + 'finds the first and the second silently goes stale');

  const quick = buildBoneQuickDisplayHTML(main, 'mp');
  check('the wrist panel gets solid, wire, joints, capsules and pins',
    ['solid', 'wire', 'joints', 'caps', 'pins'].every((k) => quick.includes('id="bone-' + k + '"')));
  check('...and not the read-outs, which would only make it taller',
    !/bone-(names|len|trails|gnomons)/.test(quick),
    'names, lengths, trails and rotation are set once and left');
  check('...in the wrist dialect, not the menu one',
    quick.includes('mp-toggle-btn') && !quick.includes('mm-choice'));
}

// ── THE WRIST PANEL IS A WRIST PANEL AGAIN ────────────────────────────────────────────
//
// matt: "the bones minipanel is hardly a minipanel anymore, its massive... it needs a tidy up."
// Offered folding, columns or fewer things, he picked fewer things — so the split is by HOW
// OFTEN you reach for a control, not by what subsystem it belongs to. Constantly: the mode, the
// snaps, the physics you are tuning by watching. Once a session: Make Skin, Bake Capsules, Reset
// Radii, Bind, and the two skin sliders. The main menu still shows everything.
{
  const wristAuth = buildBoneAuthoringHTML(main, 'mp');
  const menuAuth = buildBoneAuthoringHTML(main, 'mm');

  check('the wrist keeps the mode buttons',
    ['draw', 'fk', 'free', 'pose', 'radius', 'joint', 'ik']
      .every((k) => wristAuth.includes('id="bone-' + k + '"')));
  check('...and the snaps, which you toggle while drawing',
    wristAuth.includes('id="bone-snap"') && wristAuth.includes('id="bone-axis"'));
  check('...and physics, which is tuned by watching',
    wristAuth.includes('id="bone-phys"') && wristAuth.includes('id="bone-phys-bake"'));

  const onceAJob = ['skin', 'cages', 'rad-all', 'bind'];
  check('the once-a-session operations are off the wrist',
    onceAJob.every((k) => !wristAuth.includes('id="bone-' + k + '"')),
    onceAJob.filter((k) => wristAuth.includes('id="bone-' + k + '"')).join(',') + ' still there');
  check('...and every one of them is still in the main menu',
    onceAJob.every((k) => menuAuth.includes('id="bone-' + k + '"')),
    'this is a placement, not a removal — losing a control would be a worse bug than a tall panel');

  // The measurement behind the complaint, so a future addition that quietly re-inflates the
  // wrist panel shows up as a number rather than as a feeling.
  const rows = (html) => (html.match(/<div class="[^"]*"/g) || []).length;
  check('the wrist panel is meaningfully shorter than the menu',
    rows(wristAuth) < rows(menuAuth) - 2,
    'wrist ' + rows(wristAuth) + ' rows vs menu ' + rows(menuAuth));
}

// ── THE SLIDERS STAY PUT WHILE YOU SHAKE THE RIG ──────────────────────────────────────
//
// matt: "to test i want to be able to jiggle the setup from the hips, while adjusting values.
// the issue is that i can only jiggle the hips in ik mode... but i can only adjust the physics
// bones values by selecting the physics bone while in the bone tool. it's a lot of back and
// forth."
//
// Tuning a jiggle means shaking the rig and watching, and shaking it means SELECTING the thing
// you shake — so controls that follow the selection remove themselves exactly when you go to use
// them. The sliders aim at the last physics joint you picked and stay there.
{
  const antenna = { _isBone: true, getID: () => 7, _permanentStaticLabel: 'antenna_L',
    _physicsRoot: true, _physicsParams: { stiffness: 0.3, damping: 0.5, gravity: 1, drag: 0.1 } };
  const hips = { _isBone: true, getID: () => 1, _permanentStaticLabel: 'hips' };
  main._physicsPanelTarget = null;

  globalThis.__sel = [antenna];
  const picked = buildBoneAuthoringHTML(main, 'mm');
  check('picking a physics joint aims the sliders at it',
    picked.includes('id="bone-phys-stiff"') && /Physics: antenna_L/.test(picked),
    'the panel names the joint it is editing, so it can never be mistaken for the selection');

  // matt: "maybe as a helper, show above the physics sliders the name of the joint(s) being
  // adjusted?" Plural, and rightly — a drag writes to the mirror twin too, so naming one joint
  // would be telling half the truth about what is about to change.
  const twinR = { _isBone: true, getID: () => 8, _permanentStaticLabel: 'antenna_R',
    _physicsRoot: true };
  antenna._boneMirror = twinR;
  twinR._boneMirror = antenna;
  globalThis.__meshes = [antenna, twinR];
  const pair = buildBoneAuthoringHTML(main, 'mm');
  check('...naming BOTH joints when the edit is mirrored',
    /Physics: antenna_L \+ antenna_R/.test(pair),
    'the header has to say everything the sliders will write to');
  antenna._boneMirror = null;
  globalThis.__meshes = null;

  globalThis.__sel = [hips];
  const shaking = buildBoneAuthoringHTML(main, 'mm');
  check('...and they are still there once you select the hips to shake it',
    shaking.includes('id="bone-phys-stiff"') && /Physics: antenna_L/.test(shaking),
    'this is the whole point: tune and test without swapping selection back and forth');
  check('...while the FLAG button still reads the selection',
    /Physics Bone<\/button>/.test(shaking),
    'one control reads the target and the other the selection — flagging a NEW joint has to '
    + 'act on what is selected, or nothing could ever be flagged');

  globalThis.__sel = [];
  main._physicsPanelTarget = null;
  globalThis.__sel = [];
}

// ── THE PHYSICS SOLVER IS A SETTING, NOT AN ENV VAR ───────────────────────────────────
//
// It lived only on `window`, which meant a console -- and there is no console in a headset.
// matt: "its a pain changing things like this with an envar in the console on the gxr."
// THE TWO SETTINGS PANELS RENDER ONE LIST. They had independent copies of these toggles, under
// different ids for the same setting, so a control added to one did not exist in the other --
// matt: "if i look in the DESKTOP settings panel, i see it. if i look in the VR settings panel,
// i don't see it." The list is declared once and each panel renders it in its own idiom.
check('the physics solver is in the shared toggle list',
  /id: 'mm-phys-xpbd',[\s\S]{0,160}?PhysicsBones\.setSolver\(on\)/.test(MAIN_SRC),
  'the only way to switch solver in a headset is a console that is not there');
check('...and it reads the live flag, so it cannot lie after a console switch',
  /get: \(\) => !!window\._physXPBD/.test(MAIN_SRC));
check('both panels build their toggles from that list',
  (MAIN_SRC.match(/buildDevToggles\(\(id, label, on\) =>/g) || []).length === 2,
  'a second copy is how the two drifted apart in the first place');
check('...and both wire it from the same place',
  /wireDevToggles\(q, paint\);/.test(MAIN_SRC) && /wireDevToggles\(q, repaintFn\);/.test(MAIN_SRC),
  'the VR panel repaints through paint(), the sidebar through repaintFn');
// Every instrument in the app is read over remote debugging -- the OUTPUT is the console, but
// the SWITCH has to be reachable from inside a headset or it may as well not exist. matt: "use
// regular chrome console, i have remote debugging enabled" / "i don't see 'trace panel
// visibility' as an option in the settings panel when i'm in vr."
check('the skin frame trace is in the shared toggle list',
  /id: 'mm-skin-trace',[\s\S]{0,140}?window\._skinTrace = !!on/.test(MAIN_SRC),
  'a trace you can only turn on from a console you cannot open is not an instrument');
check('...and it reads the live flag',
  /get: \(\) => !!window\._skinTrace/.test(MAIN_SRC));
{
  const SKIN = fs.readFileSync('/Users/mattestela/sculptxr/src/editing/Skinning.js', 'utf8');
  check('...and the trace breaks the frame into the four phases',
    /lbs %s mush %s synth %s refresh %s/.test(SKIN)
      && /const _synth = synthesiseUp\(mesh\);/.test(SKIN),
    'a single total cannot tell "the deformation is slow" from "rebuilding the display level '
      + 'is slow", which are different problems with different fixes');
}

check('no panel still carries its own solver toggle',
  !/q\('#mm-constraint-solver-xpbd'\)/.test(MAIN_SRC)
    && !/q\('#mm-phys-xpbd'\)\?\.addEventListener/.test(MAIN_SRC),
  'the duplicate ids for one setting are what this replaces');

// ── CAPSULE SOLIDITY, AND SET PARENT ON THE WRIST ─────────────────────────────────────
//
// Capsules at 0.16 are a diagnostic over the sculpt. Turned up they are a cheap stand-in for the
// skin -- a rig you can pose and play back with the mesh hidden. matt: "capsule mode, would be
// good to have a toggle or a slider to control opacity... it would be great to have it be fully
// opaque and animate with the skin turned off."
check('the rig display block has a capsule solidity slider',
  /id="bone-cap-op"/.test(SRC) && /Capsule Solidity/.test(SRC));
check('...live on drag, and persisted by Skeleton',
  /Skeleton\.setCapsuleOpacity\(main, parseInt\(input\.value, 10\) \/ 100\)/.test(SRC));
// A transparent capsule must not write depth or it punches holes in what is behind it; an opaque
// one must, or the rig sorts like glass and a near arm draws behind a far one.
check('...and an opaque capsule writes depth',
  /p\.solid\.material\.depthWrite = Skeleton\.capsuleOpacity\(\) >= 0\.99;/.test(SKEL_SRC));

// Parenting is a three-step gesture done while grabbing things about, and it lived only in the
// main menu. matt: "set parent is really useful. i think that should be put on the grab
// minipanel."
check('Set Parent is on the grab minipanel',
  /id="mp-set-parent"/.test(MINI_SRC)
    && /Enums\.Tools\.GRAB[\s\S]{0,160}?setParentHTML\(this\._main\)/.test(MINI_SRC));
check('...using the same RigPending entry point as the main menu, not a copy',
  /RigPending\.toggle\(this\._main, 'parent'\)/.test(MINI_SRC)
    && /const armed = main\?\._rigPendingMode === 'parent';/.test(MINI_SRC),
  'a local armed flag goes stale when the viewport finishes the gesture');

// ── NO "--" INSIDE AN HTML COMMENT IN A VR-RASTERISED TEMPLATE ────────────────────────
//
// The VR panel serialises its markup into an SVG, and an SVG is XML. XML forbids a double hyphen
// inside a comment, so one prose dash in a menu template made the whole panel fail to paint with
// nothing but "SVG image failed to load (error). cssW=835, cssH=877, svg.length=483606". Desktop
// showed it perfectly the whole time, because an HTML parser does not care -- which is precisely
// why this needs a check rather than care.
{
  const vrTemplates = [
    ['MainMenuPanel', MAIN_SRC],
    ['MiniPanel', MINI_SRC],
    ['AnimationControlPanel', fs.readFileSync(
      '/Users/mattestela/sculptxr/src/gui/htmlvr/AnimationControlPanel.js', 'utf8')],
  ];
  const offenders = [];
  for (const [name, src] of vrTemplates) {
    for (const m of src.matchAll(/<!--([\s\S]*?)-->/g)) {
      if (m[1].includes('--')) offenders.push(name + ': ' + m[0].slice(0, 60).replace(/\n/g, ' '));
    }
  }
  check('no VR template has "--" inside an HTML comment', offenders.length === 0,
    offenders.join(' | '));
}

// ── CAPSULES CAN BE SHADED ────────────────────────────────────────────────────────────
//
// Unlit capsules read as one flat silhouette: a leg and the arm crossing it are the same shape in
// the same colour and you cannot tell which is nearer. matt: "they should have an option to be
// shaded, viewing them unlit is very hard to read."
check('the rig display offers a Shaded toggle for capsules',
  /flagButton\(c, 'caps-shade', 'Shaded', Skeleton\.displayFlag\('capsuleShaded'\)\)/.test(SRC)
    && /flag\('caps-shade', 'capsuleShaded'\);/.test(SRC),
  'the only way to read a crossing limb is to turn the capsules off');
// Without lights: an overlay pass has none, and a capsule does not need one -- its object-space
// position IS its normal, radial on a cap and in xz on a shaft.
check('...shaded from the geometry itself, with no light added to an overlay pass',
  /vec3 _sn = normalize\(vec3\(transformed\.x, 0\.0, transformed\.z\)\);/.test(SKEL_SRC)
    && /vec3 _sn = normalize\(transformed \/ max\(_ssc, vec3\(1e-6\)\)\);/.test(SKEL_SRC));
// A cap is a unit sphere scaled by the joint's three half-extents, and a normal does not survive
// a non-uniform scale the way a point does -- it has to be divided by the scale before rotating,
// or a squashed joint lights as though it were round.
check('...with the cap normal corrected for its non-uniform scale',
  /vec3 _ssc = vec3\(length\(_sm\[0\]\), length\(_sm\[1\]\), length\(_sm\[2\]\)\);/.test(SKEL_SRC));
// A uniform, not a define: toggling a define recompiles a program mid-session.
// three's own customProgramCacheKey is `return this.onBeforeCompile.toString()`, so a saved
// reference invoked as a bare function loses `this` and throws INSIDE the renderer, on the first
// frame that compiles a capsule program.
check('...chaining the existing cache key ON the material, not detached',
  /return \(prevKey \? prevKey\.call\(this\) : ''\) \+ suffix;/.test(SKEL_SRC),
  'the renderer throws reading onBeforeCompile of undefined');
check('...blended by a uniform so the toggle costs no recompile',
  /float _sg = mix\(1\.0, vShade, uShadeMix\);/.test(SKEL_SRC)
    && /m\.userData\.shadeMix\.value = shaded \? 1 : 0;/.test(SKEL_SRC));
// The term straddles 1.0 so the lit side BRIGHTENS, and a plain multiply then pushes channels
// past 1.0 one at a time -- red saturates, green catches up, the hue walks to white. matt:
// capsules are "very pastel". Capping the gain where the brightest channel would clip keeps the
// authored hue exactly; a saturated colour simply spends its range on the shadow side.
check('...and the gain is capped so a lit capsule cannot clip toward white',
  /_sg = min\(_sg, 1\.0 \/ _smx\);/.test(SKEL_SRC)
    && /float _smx = max\(max\(diffuseColor\.r, diffuseColor\.g\), diffuseColor\.b\);/.test(SKEL_SRC),
  'clipping channels unevenly desaturates -- the pastel look');
// Instances inside one InstancedMesh draw in buffer order and are never sorted: three sorts
// objects. Without depth writes a forearm painted after an upper arm shows through it whichever
// is nearer. matt: capsules "don't seem to depth sort properly against each other".
// A GreaterDepth pass shows through whatever depth is already in the buffer when it runs, so
// sharing an order with the solid capsules meant it showed through THEM. matt: "when an arm goes
// behind a leg, i can still see the arm fully through the leg."
check('the capsule ghost draws BEFORE the solid pass, so it can only reveal through the sculpt',
  /b\.mesh\.renderOrder = ghost \? GHOST_ORDER : 9996;/.test(SKEL_SRC)
    && /const GHOST_ORDER = 9995;/.test(SKEL_SRC),
  'one order later and the rig has no depth culling against itself at all');
// The bone, joint and wireframe ghosts had the same job and the same bug -- they ran at 9998 and
// 9999, after the capsules, and revealed the rig through them.
check('...and every other xray pass shares that order',
  /m\.renderOrder = ghost \? GHOST_ORDER : 0;/.test(SKEL_SRC)
    && /m\.renderOrder = ghost \? GHOST_ORDER : 9999;/.test(SKEL_SRC),
  'one ghost left behind still draws the rig through itself');
// matt asked for the skin's rule -- "when the solidity is at 100%, all the xray/transparency
// code paths in the material should be skipped" -- and clearing `transparent` to get it moved
// the capsules into the OPAQUE pass, which three renders before every transparent object, so the
// ghost ran after them and revealed the rig through itself again (57,248 bleed pixels, measured).
// The blend is what a solid capsule can skip; the pass placement is what the ordering needs.
check('a fully solid capsule skips the blend but stays in the transparent pass',
  /m\.transparent = true;/.test(SKEL_SRC)
    && /m\.blending = \(!ghost && m\.opacity >= 0\.999\) \? THREE\.NoBlending : THREE\.NormalBlending;/.test(SKEL_SRC),
  'the opaque pass runs before the ghost, and that is what re-broke the sorting');
check('every solid-pass capsule writes depth, translucent or not',
  /m\.depthWrite = !ghost;/.test(SKEL_SRC),
  'no draw order can sort instances; only the depth buffer can');
// The ghost is the pass drawn THROUGH the mesh, so with a sculpt visible it is most of the
// capsule surface anyone looks at. Leaving it flat was most of why the toggle looked inert.
check('...and the ghost pass is shaded too, being the half you actually see',
  !/\(!ghost && shaded\)/.test(SKEL_SRC),
  'the toggle appears to do nothing whenever a sculpt is visible');

// ── A PANEL IS UI AND NOTHING IN THE SCENE PAINTS OVER IT ─────────────────────────────
//
// The rig overlay -- bones, joints, capsules, pins, labels -- lives at 9996..10002 and is drawn
// with depth test off so it reads through the sculpt. VR panels sat at 1000, a number chosen only
// to clear the ground grid, so every one of those painted straight through the menu you were
// reading. matt: "almost all the bones display options (bone solid, bone wireframe, joints,
// capsules, pins etc) draw over the vr panels."
{
  const PANEL = fs.readFileSync('/Users/mattestela/sculptxr/src/gui/htmlvr/HTMLVRPanel.js', 'utf8');
  const panelOrder = Number((PANEL.match(/VR_PANEL_RENDER_ORDER = (\d+);/) || [])[1]);
  const rigOrders = [...SKEL_SRC.matchAll(/renderOrder = (\d{3,});/g)].map((m) => Number(m[1]));
  check('the VR panels draw above every rig overlay',
    panelOrder > Math.max(...rigOrders),
    'panel ' + panelOrder + ' vs highest rig ' + Math.max(...rigOrders));
  // Named, because anything that must sit ON a panel has to say "one more than the panel"
  // without knowing the number -- the resize handle sat at a bare 1000 and went under the rig.
  check('...from one named constant the panel furniture can ride on',
    /this\.mesh\.renderOrder = VR_PANEL_RENDER_ORDER;/.test(PANEL)
      && /renderOrder = VR_PANEL_RENDER_ORDER \+ 1;/.test(
        fs.readFileSync('/Users/mattestela/sculptxr/src/Scene.js', 'utf8')));
}

console.log(fails ? `\n${fails} FAILURE(S)` : '\nall checks passed');
process.exit(fails ? 1 : 0);
