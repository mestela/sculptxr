// Structural checks on the shared bones panel markup: both dialects, the XR gating, and
// that the ids the wiring looks for are the ids the markup emits.
import fs from 'fs';
const SRC = fs.readFileSync('/Users/mattestela/sculptxr/src/gui/bonePanel.js', 'utf8');
const MINI_SRC = fs.readFileSync('/Users/mattestela/sculptxr/src/gui/htmlvr/MiniPanel.js', 'utf8');
const MAIN_SRC = fs.readFileSync('/Users/mattestela/sculptxr/src/gui/htmlvr/MainMenuPanel.js', 'utf8');
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
};
const _flagState = {};
const Skinning = { isBound: () => !!globalThis.__bound, anyBound: () => true, refreshWeightColorsAll(){},
  mushIterations: () => 10, setMushIterations(){}, markDirtyAll(){} };
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
  buildBoneAnimationHTML,
} = mod;

let fails = 0;
const check = (n, ok, got) => { console.log((ok ? '  ok   ' : '  FAIL ') + n + (ok ? '' : '  got: ' + got)); if (!ok) fails++; };

const main = { _xrSession: null, getSculptManager: () => ({ getCurrentTool: () => ({ modeKey: () => 'draw' }) }), getMesh: () => null };

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
check('flat screen disables nothing', (flat.match(/disabled/g) || []).length === 0,
  (flat.match(/disabled/g) || []).length);
check('flat screen leaves Draw enabled', /id="bone-draw"(?![^>]*disabled)/.test(flat));
check('in VR nothing is disabled', !/disabled/.test(vr));
check('every mode button reaches a flat screen',
  ['bone-draw', 'bone-fk', 'bone-free', 'bone-pose', 'bone-radius', 'bone-ik']
    .every(id => /id="/.test(flat) && flat.includes('id="' + id + '"')));
check('every command button is present on a flat screen',
  ['bone-bind', 'bone-skin', 'bone-rad-all'].every(id => authoring.includes('id="' + id + '"'))
    && ['bone-unpin', 'bone-restpose'].every(id => pose.includes('id="' + id + '"'))
    && display.includes('id="bone-trails"'));
check('pin count reaches the label', /Clear Pins \(2\)/.test(flat));
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
const all = vr + boundHTML + display + animation;
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
check('Ground Plane sits outside the mesh-disabled fieldset', (() => {
  const start = MAIN_SRC.indexOf('<fieldset class="mm-disabled-group"');
  const end = MAIN_SRC.indexOf('</fieldset>', start);
  const grid = MAIN_SRC.indexOf('id="mm-grid-toggle"');
  return start >= 0 && end > start && grid > end;
})());
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

console.log(fails ? `\n${fails} FAILURE(S)` : '\nall checks passed');
process.exit(fails ? 1 : 0);
