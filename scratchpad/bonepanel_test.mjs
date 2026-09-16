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
let _hideDecor = false;
let _capSeg = null;
const DEFAULT_FLAGS = ${JSON.stringify(FLAG_DEFAULTS)};
const Skeleton = {
  joints: () => [], radiusFraction: () => 0.25, defaultRadiusFrac: () => 0.25,
  DISPLAY_FLAGS: ${JSON.stringify(FLAG_DEFAULTS)},
  displayFlag: (n) => (_flagState[n] != null ? _flagState[n] : !!${JSON.stringify(FLAG_DEFAULTS)}[n]),
  setDisplayFlag: (n, v) => { _flagState[n] = !!v; },
  // The master decoration switch gates how display flags are READ; the panel asks for both, so a
  // stub without them throws before a check runs. displayFlagRaw is what the toggles read, so
  // they keep showing their own value while everything is hidden. (No backticks in here: this
  // whole block is a template literal, and one closes it.)
  decorationsHidden: () => !!_hideDecor,
  setDecorationsHidden: (main, on) => { _hideDecor = !!on; return _hideDecor; },
  displayFlagRaw: (n) => (_flagState[n] != null ? _flagState[n] : !!DEFAULT_FLAGS[n]),
  // Capsule solidity is a slider in the Rig Display block, so the panel asks for it while
  // building — a stub without it throws before a single check runs.
  capsuleOpacity: () => (_capOp == null ? 0.16 : _capOp),
  setCapsuleOpacity: (main, v) => { _capOp = Math.max(0.05, Math.min(1, v)); return _capOp; },
  // Capsule tessellation is a setting now — the panel reads it to draw the Capsule Detail slider.
  capsuleSegments: () => (_capSeg == null ? 56 : _capSeg),
  setCapsuleSegments: (main, n) => { _capSeg = Math.max(8, Math.min(64, Math.round(n))); return _capSeg; },
  // Bone shapes (roadmap #60): the panel asks which meshes are joints and what shape each has.
  isJoint: (m) => !!(m && m._isBone),
  // The squircle exponent the Roundness slider edits — 2 is round. See Skeleton.jointRound.
  jointRound: (j) => ((j && typeof j._jointRound === 'number' && j._jointRound > 2) ? Math.min(j._jointRound, 12) : 2),
  setJointRound: (j, p) => { if (j) j._jointRound = p; },
  mirrorEdits: (main) => !!(main && main.getSculptManager && main.getSculptManager()
    && main.getSculptManager().getSymmetryFlag && main.getSculptManager().getSymmetryFlag()),
  // Whether a rig edit mirrors: the panel asks before offering a physics twin, so a stub without
  // it throws before a single check runs. Reads the mock's own symmetry flag, which is what makes
  // the "physics names both joints" check mean something either way.
  mirrorEdits: (main) => !!(main && main.getSculptManager
    && main.getSculptManager() && main.getSculptManager().getSymmetryFlag
    && main.getSculptManager().getSymmetryFlag()),
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
  // Resolves through the governing ROOT and remembers nothing, as the real one does: the answer
  // is a function of the selection it was handed. Behaviour is asserted in physicsbones_test
  // against the real module; this only has to agree with it.
  rootOf: (j) => { for (let n = j; n; n = n._parentMesh) if (n._physicsRoot) return n; return null; },
  panelTarget: (main, sel) => {
    const roots = [];
    for (const j of (sel || [])) {
      const r = PhysicsBones.rootOf(j);
      if (r && roots.indexOf(r) === -1) roots.push(r);
    }
    const t = roots.length === 1 ? roots[0] : null;
    main._physicsPanelTarget = t;
    return t;
  },
  setDefaults(patch) { Object.assign(this.DEFAULTS, patch || {}); return this.DEFAULTS; },
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
// UI REORG MOCKUP. The panel imports these two from uiTokens, and this harness strips every
// import line -- so without stubs here buildBoneAuthoringHTML throws ReferenceError on the
// first call and the whole file reports as one failure with no message.
//
// uiReorg() is driven by a global so the SAME harness can assert both layouts: set
// globalThis.__uiReorg to pick one. Defaults to the legacy layout, which is what every check
// written before this branch is describing.
const uiReorg = () => !!globalThis.__uiReorg;
// squeezeLabel, copied from uiTokens rather than approximated: the panel now runs every chip and
// mode label through it, so a stub that returned the label unchanged would make every width check
// below agree with itself and prove nothing.
const VOWELS = 'aeiouAEIOU';
const squeezeLabel = (label, maxChars) => {
  const t = String(label ?? '');
  if (!maxChars || t.length <= maxChars) return t;
  const ch = [...t];
  const startsWord = (i) => i === 0 || ch[i - 1] === ' ' || ch[i - 1] === '/';
  let len = ch.length;
  for (let i = ch.length - 1; i >= 0 && len > maxChars; i--) {
    if (ch[i] === null || startsWord(i) || !VOWELS.includes(ch[i])) continue;
    ch[i] = null;
    len--;
  }
  const out = ch.filter((c) => c !== null).join('');
  return out.length <= maxChars ? out : out.slice(0, maxChars);
};
// Published so the checks outside the stub can exercise the helper itself, not only its effect
// on the markup.
globalThis.__squeeze = squeezeLabel;
const groupOpen = (key, dflt = true) => {
  const g = (globalThis.__uiGroups = globalThis.__uiGroups || {});
  if (g[key] == null) g[key] = dflt;
  return !!g[key];
};
// Same markup the real helper emits, so a check can look for a group by name and can tell an
// open one from a collapsed one.
const collapsibleHTML = (key, label, bodyHTML, dflt = true) => {
  const open = groupOpen(key, dflt);
  return '<button class="mm-group-head" data-group="' + key + '">'
    + '<span class="mm-group-chev">' + (open ? '&#9662;' : '&#9656;') + '</span>' + label + '</button>'
    + '<div class="mm-group-body' + (open ? '' : ' collapsed') + '" data-group-body="' + key + '">'
    + bodyHTML + '</div>';
};
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

// SYMMETRY IS ON IN THE FIXTURE, because that is now the condition for a rig edit to mirror at
// all — a twin merely existing is no longer enough. `__sym` lets a check turn it off and assert
// the other half.
globalThis.__sym = true;
const main = { _xrSession: null, getSculptManager: () => ({ getCurrentTool: () => ({ modeKey: () => 'draw' }), getSymmetryFlag: () => globalThis.__sym }),
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

// ── A CONTROL THAT VANISHES CANNOT BE TOLD FROM ONE THAT IS BROKEN ────────────────────────
//
// X-Ray and Mush need a bound mesh, and when there was not one the rows simply did not exist.
// So a binding lost to a topology edit -- replaceMesh swaps the mesh object and cannot carry
// weights across, because the remesh invalidated every index -- showed up as a slider that had
// been there a minute ago and now was not, with nothing saying why. matt: "the bone parameters
// are getting unreliable. after editing a character i went back to the bone parameters to
// adjust delta mush, but that slider was missing."
{
  const SCN2 = fs.readFileSync('/Users/mattestela/sculptxr/src/Scene.js', 'utf8');
  check('losing a binding to a topology edit is announced',
    /if \(Skinning\.isBound\(mesh\) && !Skinning\.isBound\(newMesh\)\) \{/.test(SCN2)
      && /Bind lost: /.test(SCN2),
    'the weights CANNOT be carried across -- they are indexed by vertex and the rebuild '
      + 'invalidated every index -- so the fix is to say so, not to copy them');
  check('...and the panel states its condition rather than dropping the rows',
    /need a bound mesh — press Bind/.test(SRC),
    'a row that disappears reads as a bug in the panel; a row that explains itself reads as a '
      + 'state you can fix');
}

// ── TOOLS AND PROPERTIES ARE TWO PAGES ────────────────────────────────────────────────────
//
// The tool grids are a wall of buttons sitting ABOVE everything that describes the tool you
// just picked, so every radius change and every toggle was a scroll past the whole wall -- and
// the two are used at completely different rates. matt: "the huge amount of buttons at the top
// for all the tools for both sculpting and lowpoly gets in the way of all the tool related
// buttons and state at the bottom."
{
  const TORN = fs.readFileSync('/Users/mattestela/sculptxr/src/gui/htmlvr/TornOffPanel.js', 'utf8');
  const GUI  = fs.readFileSync('/Users/mattestela/sculptxr/src/gui/Gui.js', 'utf8');
  const ICONS = fs.readFileSync('/Users/mattestela/sculptxr/src/gui/tabIcons.js', 'utf8');

  check('one builder produces both pages',
    /function buildSculptingHTML\(main, part\)/.test(MAIN_SRC)
      && /if \(part === 'tools'\) \{/.test(MAIN_SRC)
      && /export function buildSectionHTML_sculpting\(main\) \{ return buildSculptingHTML\(main, 'tools'\); \}/.test(MAIN_SRC)
      && /export function buildSectionHTML_properties\(main\) \{ return buildSculptingHTML\(main, 'props'\); \}/.test(MAIN_SRC),
    'both pages read the same tool state, so two builders would be two things to keep in step');
  // ANCHORED ON THE INTENT, NOT ON ONE LITERAL. This counted the exact string
  // `mm-choice-grid cols-3">${sculptBtns}` and demanded exactly one, which said "the grid is
  // built in one place" when what it means is "the grid is on the TOOLS page and not the props
  // one". The ui-reorg branch renders the same grid twice inside `part === 'tools'` -- once
  // plain, once wrapped in a collapsible -- so the count went to two while the thing being
  // asserted stayed true. Split the function at the tools early-return and ask the real
  // question of each half.
  {
    const fn = MAIN_SRC.slice(MAIN_SRC.indexOf('function buildSculptingHTML(main, part)'));
    const toolsAt = fn.indexOf("if (part === 'tools')");
    // Everything from the tools branch to the brush section is the tools half; the props half
    // is what follows, and it must never mention the grids.
    const propsAt = fn.indexOf('Brush settings');
    const toolsHalf = fn.slice(toolsAt, propsAt);
    const propsHalf = fn.slice(propsAt);
    check('...and the tool grids are on exactly one of them',
      toolsAt > 0 && propsAt > toolsAt
        && /sculptBtns/.test(toolsHalf) && /meshBtns/.test(toolsHalf)
        && !/sculptBtns|meshBtns/.test(propsHalf),
      'the wall of buttons is the thing being moved out of the way');
  }

  // The tab strip used to be one array literal and this matched it whole. It is two arrays now
  // (the ui-reorg branch moves Rendering and Camera into the View menu and renders their tabs
  // from a second list), so match the STRIP rather than one spelling of its contents -- the
  // question is whether 'properties' is a tab at all, not how the list is punctuated.
  const TABSTRIP = MAIN_SRC.slice(MAIN_SRC.indexOf('<div id="mm-tabstrip">'),
                                  MAIN_SRC.indexOf('<div id="mm-content">'));
  check('Properties is a real section, not a special case',
    /'properties'/.test(TABSTRIP) && /'sculpting'/.test(TABSTRIP) && /'scene'/.test(TABSTRIP)
      && /case 'properties': html = buildSectionHTML_properties\(main\); break;/.test(MAIN_SRC)
      && /properties: 'Properties'/.test(MAIN_SRC)
      && /properties: _fa\(/.test(ICONS),
    'a section that is not in every registry is one that cannot be torn off, reopened after a '
      + 'tear-off, or reached from the tab strip');
  check('...so it gets the section header pin like the others',
    /mm-section-pin-btn/.test(MAIN_SRC),
    'the pin is what makes the split pay: two pages you can float independently');
  check('...and it can be torn off and rebuilt',
    /case 'properties': return buildSectionHTML_properties\(main\);/.test(TORN)
      && /case 'sculpting':\n\s*case 'properties':/.test(TORN),
    'a torn-off page that cannot rebuild itself is a dead panel');

  check('both pages wire through ONE function',
    /section === 'sculpting' \|\| section === 'properties'/.test(MAIN_SRC)
      && (MAIN_SRC.match(/wireSectionSculpting\(el, main, fullRepaint, lightRepaint, lightRepaint\);/g) || []).length === 1,
    'the ids are disjoint per page and querySelector returns null for the absent ones, so one '
      + 'pass is correct for either -- and there is no second copy to fall behind');

  check('the active tab is chosen by NAME, not by index',
    /s === DEFAULT_SECTION \? ' active' : ''/.test(MAIN_SRC)
      && !/i === 3 \? ' active'/.test(MAIN_SRC),
    'adding a tab to a positional list silently opens a different section');

  // THIS RULE USED TO SAY THE OPPOSITE. It pinned the desktop sidebar as one combined column,
  // reasoning that the split solved a VR/mobile scrolling problem and desktop had a mouse
  // wheel. matt disagreed, and was right: the split is not only about scrolling. Picking a
  // tool and adjusting it are different tasks at different rates on every platform. "i think
  // the split of tools vs properties is good. it should work well on desktop, please put it
  // there too."
  check('the desktop sidebar has its own Properties tab',
    /const propertiesTab = createTab\('properties', 'Properties'\);/.test(GUI)
      && /_buildDesktopProperties\(panelEl\) \{/.test(GUI)
      && !/buildSectionHTML_sculpting\(main\) \+ buildSectionHTML_properties\(main\)/.test(GUI),
    'the two halves are two tasks, and that is true with a mouse as well as a controller');
  check('...and every rebuild of one rebuilds the other',
    (GUI.match(/if \(this\._desktopPropertiesEl\) this\._buildDesktopProperties\(this\._desktopPropertiesEl\);/g) || []).length >= 4,
    'the properties page reads the CURRENT tool, so a tool change that refreshes only the '
      + 'tools tab leaves it describing the previous one');

  // ── PINNING, ON BOTH PLATFORMS ────────────────────────────────────────────────────────
  const DFP = fs.readFileSync('/Users/mattestela/sculptxr/src/gui/DesktopFloatPanel.js', 'utf8');
  check('a desktop section can be floated out of the sidebar',
    /floatSection\(sectionId, at\) \{/.test(GUI) && /redockSection\(sectionId\) \{/.test(GUI)
      && /class DesktopFloatPanel/.test(DFP));
  check('...through the SAME builder and wiring as the docked one',
    /_sectionSpec\(sectionId\) \{/.test(GUI)
      && /case 'properties': return \{ build: \(\) => buildSectionHTML_properties\(main\),/.test(GUI),
    'a float panel built from a different function than its docked twin is two panels that '
      + 'drift apart, which is the whole failure mode this project keeps hitting');
  check('...and the emptied tab says where it went',
    /_sectionIsFloating\(panelEl, sectionId\) \{/.test(GUI)
      && /Return it to the sidebar/.test(GUI),
    'a tab that goes blank when you pin its contents reads as a bug');
  // A FLOATING PANEL IS NOT IN THE TAB STRIP, so nothing that refreshes the sidebar reaches it.
  // The first version defined refreshFloatingSections and never called it: matt, "if i tear off
  // the scene/outliner it doesn't stay synced. i have to unpin then repin for it to update."
  // Counted at the CALL SITES -- the same mistake as the torn-strip rule, made twice in two
  // commits, so this one is written the other way round from the start.
  // THE CHOKE POINT. Refreshing floats from the places that rebuild the sidebar covered the
  // paths I knew about and missed Skeleton.refreshOutliner -- which every rig edit goes through
  // and which calls _buildDesktopScene directly. With the outliner pinned that redrew the
  // placeholder and stopped. matt: "scene/outliner still isn't updating on desktop if pinned."
  //
  // Asking a section to redraw while it is floating IS a request to redraw it, so the rebuild
  // belongs where that request arrives. Every caller then works, including ones not yet
  // written -- which is the difference between this and enumerating call sites.
  check('asking a floating section to redraw rebuilds the floating copy',
    /_sectionIsFloating\(panelEl, sectionId\) \{\n\s*const panel = this\._floatPanels\?\.get\(sectionId\);\n\s*if \(!panel\) return false;[\s\S]{0,900}?panel\.rebuild\(\);/.test(GUI),
    'the outliner is redrawn by callers that know nothing about pinning');

  check('floating panels are refreshed wherever the docked ones are',
    (GUI.match(/refreshFloatingSections\?\.\(\);/g) || []).length >= 5,
    'a pinned outliner that only updates when you unpin and repin it is a stale panel');

  check('every section builder checks first',
    (GUI.match(/if \(this\._sectionIsFloating\(panelEl, '[a-z]+'\)\) return;/g) || []).length === 6,
    'one that does not will redraw itself into a sidebar tab that is meant to be empty');
  check('...and every section builder offers the pin',
    (GUI.match(/this\._decorateDesktopSection\(panelEl, '[a-z]+'\);/g) || []).length === 6);

  // A WORKSPACE ARRANGEMENT, NOT A MOMENTARY ACTION. You pin panels once for how you work and
  // expect them back next session. matt: "pin states for panels on desktop should be
  // persistent, remember state and position."
  {
    const OPTS = fs.readFileSync('/Users/mattestela/sculptxr/src/misc/getOptionsURL.js', 'utf8');
    const DFP2 = fs.readFileSync('/Users/mattestela/sculptxr/src/gui/DesktopFloatPanel.js', 'utf8');
    check('pin state is saved through the shared option store',
      /getOptionsURL\.saveOption\('desktopPins', map, 250\);/.test(GUI)
        && /options\.desktopPins = \(dp && typeof dp === 'object'\) \? dp : null;/.test(OPTS),
      'a private localStorage key would not be cleared, exported or reasoned about with the '
        + 'rest of the preferences');
    check('...on pin, on unpin, and at the end of a drag',
      (GUI.match(/this\._savePinnedSections\(\);/g) || []).length >= 2
        && /onMoved: \(\) => this\._savePinnedSections\(\)/.test(GUI)
        && /this\._onMoved\?\.\(this\._id\);/.test(DFP2),
      'saving on pointermove would write to localStorage a hundred times a second for the '
        + 'whole drag');
    check('...and restored after the docked tabs exist',
      /this\._restorePinnedSections\(\);/.test(GUI)
        && GUI.indexOf('this._buildDesktopProperties(propertiesPanel);')
             < GUI.indexOf('this._restorePinnedSections();'),
      'floating a section rewrites its sidebar tab into a placeholder, and a tab that has not '
        + 'been built yet has nothing to rewrite');
    check('...clamped into the current window',
      /Math\.min\(Math\.max\(0, at\?\.x \?\? 90\), Math\.max\(0, window\.innerWidth - 60\)\)/.test(GUI),
      'a panel saved on a wider screen would restore off the edge with its dock button beyond '
        + 'reach');
  }

  // A PINNED SECTION'S TAB IS DIMMED. Its tab is still there and still switchable, but its
  // contents are elsewhere -- so without a mark the strip says "pinned" while the tab looks
  // exactly as it did when it held the controls. matt: "in the sidebar their icon should be
  // dimmed if they've been pinned."
  {
    const DFP3 = fs.readFileSync('/Users/mattestela/sculptxr/src/gui/DesktopFloatPanel.js', 'utf8');
    check('a pinned section dims its sidebar tab',
      /_updatePinnedTabStates\(\) \{/.test(GUI)
        && (GUI.match(/this\._updatePinnedTabStates\(\);/g) || []).length >= 2,
      'checked at the CALL SITES, twice bitten');
    check('...by styling the ICON, not the tab host',
      /wa-tab\.tab-pinned > span \{ opacity/.test(DFP3)
        && !/^wa-tab\.tab-pinned \{ opacity/m.test(DFP3),
      'Web Awesome\'s <wa-tab> refuses opacity on itself -- an inline important rule on the '
        + 'host still computes to 1, measured in the browser');
    check('...and stays clickable',
      !/wa-tab\.tab-pinned[^}]*pointer-events: none/.test(DFP3),
      'the tab still opens the placeholder that brings the section back; taking the click away '
        + 'would leave it unreachable');
    check('a tab is born dimmed when its section was pinned last session',
      /if \(\(getOptionsURL\(\)\.desktopPins \|\| \{\}\)\[panelName\]\) tab\.classList\.add\('tab-pinned'\);/.test(GUI),
      'the restore runs while the sidebar is still being built and the tab strip is not in the '
        + 'document yet -- marking after it finds nothing, and a frame later still did not. '
        + 'Measured: chips appeared and both tabs stayed bright.');
  }

  // THE SIDEBAR REMEMBERS WHICH TAB WAS OPEN, and refuses to open on a pinned one -- a pinned
  // section's tab shows only "this section is floating", so opening onto it spends the sidebar
  // on a placeholder while the panel it describes is already on screen. matt: "if i have the
  // tools and outliner pinned, its pointless to show the tools panel in the sidebar by
  // default, that currently just shows 'this panel has been pinned'."
  {
    check('the open tab is remembered',
      /getOptionsURL\.saveOption\('desktopTab', name, 400\);/.test(GUI),
      'the sidebar arrangement is one preference; the tab belongs with the pins');
    check('...except the timeline, which is a toggle not a panel',
      /if \(name !== 'timeline'\) \{[\s\S]{0,400}?saveOption\('desktopTab'/.test(GUI),
      'restoring onto it would open an empty sidebar');
    check('...and a pinned tab is skipped on restore',
      /const pick = order\.find\(\(n\) => n && tabsByName\[n\] && !pins\[n\]\)/.test(GUI),
      'opening onto a floating section shows a placeholder instead of controls');
    check('...falling through the rest in order, so something always opens',
      /const order = \[saved, DESKTOP_DEFAULT_TAB, 'sculpting', 'properties', 'scene',/.test(GUI)
        && /\|\| DESKTOP_DEFAULT_TAB;/.test(GUI),
      'a session with everything pinned must still open on a tab rather than none');
    check('...and the default is named, not positional',
      /const DESKTOP_DEFAULT_TAB = 'sculpting';/.test(GUI)
        && !/sculptingTab\.setAttribute\('active', ''\);/.test(GUI),
      'the same positional trap the VR tab strip had');
  }

  // A TORN-OFF SECTION IS STILL THE PANEL'S CONTENT, just elsewhere in the room. Seven places
  // across four files mark the main VR panel dirty and none knew about the torn copies, so a
  // pinned outliner stopped updating the moment it was pinned -- the VR twin of the desktop bug
  // fixed in v3.30.72. matt: "i notice in vr that the outliner isn't updating when pinned
  // either."
  {
    const SCN = fs.readFileSync('/Users/mattestela/sculptxr/src/Scene.js', 'utf8');
    const TORN2 = fs.readFileSync('/Users/mattestela/sculptxr/src/gui/htmlvr/TornOffPanel.js', 'utf8');
    check('marking the VR panel dirty reaches its torn-off sections',
      /markDirty\(\) \{\n\s*super\.markDirty\(\);[\s\S]{0,500}?for \(const p of this\._tornPanels\) p\.requestSync\?\.\(\);/.test(MAIN_SRC),
      'fixed where "this panel changed" ARRIVES, not at the seven call sites -- so callers that '
        + 'do not exist yet are covered');
    // AND ASKS RATHER THAN DOES. rebuild() regenerates the DOM, re-wires it and flushPaint()s --
    // a blocking rasterise. markDirty fires many times a second while a rig is handled, so
    // doing that inline made pinning a panel next to a skinned character unusably slow on
    // mobile. matt: "if i hide all the panels its fast again."
    check('...as a REQUEST, coalesced into the panel\'s own frame',
      /requestSync\(\) \{ this\._needsSync = true; \}/.test(TORN2)
        && /update\(xrIsPresenting\) \{\n\s*if \(this\._needsSync && this\._main\)/.test(TORN2)
        && !/for \(const p of this\._tornPanels\) p\.syncFromState\?\.\(\);/.test(MAIN_SRC),
      'a synchronous rebuild per markDirty is a DOM regeneration and an SVG rasterise per panel '
        + 'per call');
    check('...and throttled, since an outliner needs to be right soon, not at 90Hz',
      /now - \(this\._lastSyncAt \|\| 0\) >= SYNC_MIN_MS/.test(TORN2)
        && /const SYNC_MIN_MS = 200;/.test(TORN2));
    check('...with the blocking rasterise kept only for creation and show',
      /if \(immediate\) this\.flushPaint\(\);\n\s*else this\.markDirty\(\);/.test(TORN2),
      'an unpainted panel reads as a black quad when it first appears, which is why flushPaint '
        + 'exists at all -- but a periodic sync can go through the ordinary dirty path');
    check('...with tearing off registering and redocking unregistering',
      /this\._mainMenuPanel\?\.registerTorn\?\.\(panel\);/.test(SCN)
        && /this\._mainMenuPanel\?\.unregisterTorn\?\.\(panel\);/.test(SCN));
    check('...and unregistered BEFORE dispose',
      SCN.indexOf('this._mainMenuPanel?.unregisterTorn?.(panel);')
        < SCN.indexOf('panel.dispose();', SCN.indexOf('_reDockSection')),
      'a disposed panel left in the set is asked to rebuild itself on the next markDirty');
  }

  // THE ICON GOES ON THE PANEL THAT WAS PINNED — not in a list of pinned panels somewhere else.
  //
  // I built the second thing. matt asked for "an icon in the top left corner for pinned panels"
  // and I read it as an index of what is currently pinned, so both platforms grew a strip of
  // chips on the MAIN panel. He meant the panel itself should wear its own icon: "i meant in the
  // corner of the panel that has been pinned, so its easy to tell at a glance from the icon what
  // panel it is". A row of chips answers "what is pinned"; it does not answer "what is THIS".
  //
  // The strips are gone. The recall they also offered lives on each panel's own redock button.
  const TORN_SRC = fs.readFileSync('/Users/mattestela/sculptxr/src/gui/htmlvr/TornOffPanel.js', 'utf8');
  check('a torn-off VR panel wears its own section icon',
    /class="mm-torn-icon"[^]{0,200}?TAB_ICONS\[sectionId\]/.test(TORN_SRC),
    'nothing on the panel says which section it is except the word');
  check('...and so does a pinned desktop panel',
    /class="dfp-icon"[^]{0,120}?TAB_ICONS\[this\._id\]/.test(DFP),
    'desktop and VR have to conform');
  check('...from the same table the tabs draw from',
    /TAB_ICONS/.test(TORN_SRC) && /TAB_ICONS/.test(DFP),
    'an icon that disagrees with the tab it came from is worse than none');
  check('...and the chip strips it replaced are gone from both',
    !/dfp-strip/.test(DFP) && !/_refreshPinnedStrip/.test(GUI)
      && !/mm-torn-strip/.test(MAIN_SRC) && !/_updateTornStrip/.test(MAIN_SRC),
    'the thing that was asked to be removed is still being built')

  check('the section header is one piece of markup for both platforms',
    /export function sectionHeaderHTML\(sectionId\)/.test(MAIN_SRC)
      && /sectionHeaderHTML\(this\._activeSection\)/.test(MAIN_SRC)
      && /sectionHeaderHTML\(sectionId\)/.test(GUI),
    'two copies of the pin row is how VR and desktop pinning would come to look and behave '
      + 'differently');
}

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
// ...AND THE REORG LAYOUT, which is the only one that ships. Without it this check was comparing
// the wiring against markup the app never renders, so a control that exists ONLY in the shipping
// layout (the physics readout, say) read as wired to nothing — while a control that had quietly
// stopped being emitted there would have gone unnoticed, which is the failure this check is for.
globalThis.__uiReorg = true;
const reorgHTML = buildBoneAuthoringHTML(main, 'mm') + buildBonePoseHTML(main, 'mm');
globalThis.__uiReorg = false;
globalThis.__sel = [];
const all = vr + boundHTML + display + animation + physHTML + reorgHTML;
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
    && /setFlag\('joints', Skeleton\.displayFlagRaw\('joints'\)\);/.test(SRC),
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
// WHERE it sits is a layout choice — it moved to the END of the section, so a panel about how the
// model is drawn no longer opens on fourteen toggles about bones. THAT it sits here at all is
// not: this is the only place in the app that calls buildBoneDisplayHTML, so a tidy-up that drops
// it strands the rig display flags, the capsule slider, Attach and Hide All entirely. Hence a
// reference anywhere in the function rather than one near the top.
check('Rendering owns the rig display block',
  /function buildSectionHTML_rendering[\s\S]*?buildBoneDisplayHTML/.test(MAIN_SRC));
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
  // LEGACY LAYOUT ONLY -- this block runs with uiReorg() false, which the app no longer reaches.
  // The shipping layout builds the sliders always and DISABLES them instead; see the physics fold
  // block below for the checks that describe it.
  check('...but the sliders are not, until a physics joint has been picked',
    !virgin.includes('id="bone-phys-stiff"'),
    'with nothing ever targeted they would have nothing to edit');

  globalThis.__sel = [{ _isBone: true, getID: () => 1, _physicsRoot: true,
    _physicsParams: { stiffness: 0.2, damping: 0.5, gravity: 1.5 } }];
  const on = buildBoneAuthoringHTML(main, 'mm');
  check('a flagged joint grows stiffness, gravity and damping',
    on.includes('id="bone-phys-stiff"') && on.includes('id="bone-phys-grav"')
    && on.includes('id="bone-phys-damp"'));

  // PHYSICS IS ONE SECTION AGAIN, BUTTONS AND SLIDERS TOGETHER.
  //
  // It was briefly split -- buttons out, sliders folded -- because as one group it hid two
  // buttons and spent a heading to do it. That stopped being the right trade once EVERY block
  // became a section: a two-button section among five sections is a rhythm, where a two-button
  // fold among loose controls was an oddity. matt: "a 'physics' section (yes even though it has 2
  // buttons, i think if a bone has physics, we can now afford to put the sliders in that
  // section)."
  //
  // It opens itself when a flagged joint is selected, which is the one moment its contents grew
  // from two buttons to ten rows, and is also how you said you were about to tune it.
  {
    const wasReorg = globalThis.__uiReorg;
    const wasGroups = globalThis.__uiGroups;
    globalThis.__uiReorg = true;
    // The stub remembers the first default it is given for a key, exactly as the real store does,
    // so each of these two builds needs a clean one or the second inherits the first's answer.
    globalThis.__uiGroups = {};
    const foldOn = buildBoneAuthoringHTML(main, 'mm');
    const keep = globalThis.__sel;
    globalThis.__sel = [];
    const before = main._physicsPanelTarget;
    main._physicsPanelTarget = null;
    globalThis.__uiGroups = {};
    const foldNone = buildBoneAuthoringHTML(main, 'mm');
    globalThis.__sel = keep;
    main._physicsPanelTarget = before;
    globalThis.__uiReorg = wasReorg;
    globalThis.__uiGroups = wasGroups;

    check('physics is a section whether or not a joint is flagged',
      foldNone.includes('data-group="bone-physics"') && foldOn.includes('data-group="bone-physics"'));
    check('...holding the buttons and the sliders together',
      /data-group-body="bone-physics"[\s\S]*id="bone-phys"[\s\S]*id="bone-phys-stiff"/.test(foldOn),
      'splitting them put the heading between a control and the thing it turns on');
    // THE HEADING DOES NOT NAME THE JOINT. It used to, on the rule that a physics control should
    // say what it is about -- but a group heading is built when the panel is built and the
    // selection moves on without it, so it was a name that went stale and then lied. matt: "the
    // physics header section displays the name of physics bones, don't do this. it doesn't stay
    // up to date, its just confusing." Which joint is flagged is answered in the viewport and the
    // outliner instead, where it can be right every frame.
    check('...and does not carry a joint name that will go stale',
      !/data-group="bone-physics"[\s\S]{0,160}Physics: /.test(foldOn));
    check('...and open, because selecting the joint is how you asked to tune it',
      !/collapsed"\s+data-group-body="bone-physics"/.test(foldOn));
    check('...but closed while nothing is being tuned',
      /collapsed"\s+data-group-body="bone-physics"/.test(foldNone));

    // EVERY CONTROL EXISTS FROM THE START. Rendering the sliders only while a flagged joint was
    // selected meant the section's contents changed under your hand the moment you flagged one,
    // so its shape was never the same twice. matt: "all the options for physics should be there
    // from the start, not just built the first time i enable physics on a bone."
    check('the physics sliders are built whether or not a joint is flagged',
      ['weight', 'stiff', 'grav', 'damp', 'inert', 'drag']
        .every((k) => foldNone.includes('id="bone-phys-' + k + '"')),
      'a section that grows new controls when you use it is one you cannot learn the shape of');
    // AND LIVE, NOT DISABLED. Dimming them was the first answer and the wrong one: setting the
    // values you want and THEN flagging a joint is a real way to work, and setRoot copies the
    // defaults into whatever it flags, so the same slider does the same job either way round.
    // matt: "i think its valid for someone to setup the values to a state they know is good, then
    // enable physics."
    check('...and live rather than dimmed, because with no joint they edit the defaults',
      !/mm-disabled-group/.test(foldNone) && !/mm-disabled-group/.test(foldOn));
    check('...which the wiring actually does, rather than returning on no target',
      /else PhysicsBones\.setDefaults\(\{ \[key\]: v \}\);/.test(SRC)
        && /else PhysicsBones\.setDefaults\(patch\);/.test(SRC)
        && /else PhysicsBones\.setDefaults\(\{ collide: on \}\);/.test(SRC),
      'a live-looking slider that silently does nothing is worse than a dimmed one');
    check('...and the flags read the defaults too, or they would toggle from the wrong state',
      /!\(t \? PhysicsBones\.params\(t\) : PhysicsBones\.DEFAULTS\)\.ground/.test(SRC)
        && /!\(t \? PhysicsBones\.params\(t\) : PhysicsBones\.DEFAULTS\)\.collide/.test(SRC));
  }

// ── A PLAIN SELECT MODE, AND THE LABELS THAT WERE STANDING IN FOR IT ──────────────────
//
// "Sel/Tweak FK" was a label describing a missing feature: with no Select mode, picking a joint
// meant using whichever mode did the least harm, and a tweak mode still moves the joint when your
// hand drifts — which on a wrist panel in a headset it always does a little.
{
  const wasReorg = globalThis.__uiReorg;
  globalThis.__uiReorg = true;
  const auth = buildBoneAuthoringHTML(main, 'mm');
  const wrist = buildBoneAuthoringHTML(main, 'mp');
  globalThis.__uiReorg = wasReorg;

  check('there is a Select mode', auth.includes('id="bone-select"') && wrist.includes('id="bone-select"'));
  check('...so the tweak modes no longer apologise in their labels',
    !/Sel\/Tweak/.test(auth) && auth.includes('>Tweak FK<') && auth.includes('>Tweak Free<'),
    'the slash was standing in for the mode that now exists');
  check('...and it is first, being the only mode that cannot damage the rig',
    auth.indexOf('id="bone-select"') < auth.indexOf('id="bone-draw"'));
}

// ── VOWEL DECIMATION ──────────────────────────────────────────────────────────────────
//
// The fallback for a label too long for its column, once the column stopped resizing itself to
// fit (min-width:0 in the sweep). matt: "if text cant fit, try vowel decimation."
{
  check('a label too long for its column loses interior vowels from the right',
    globalThis.__squeeze('Tweak Joint', 9) === 'Tweak Jnt');
  check('...and never the first letter of a word',
    globalThis.__squeeze('Capsules', 5)[0] === 'C' && globalThis.__squeeze('Sel/Tweak Free', 10).includes('/T'),
    'the leading letter is what you scan for, so it is the last thing to give up');
  check('...leaving a label that already fits alone',
    globalThis.__squeeze('Wire', 11) === 'Wire' && globalThis.__squeeze('IK', 11) === 'IK');
  check('...and hard-truncating when there are no vowels left to give',
    globalThis.__squeeze('Strengths', 4).length === 4);

  // THE POINT OF THE BUDGET IS THAT IT NEVER FIRES. A panel whose labels all need decimating is a
  // panel with the wrong labels, so this asserts the current set FITS at three across on the
  // 216px wrist panel — 11 characters, measured in the running panel. A future label that busts
  // it should be renamed here, not silently compressed in the headset.
  const wasReorg = globalThis.__uiReorg;
  globalThis.__uiReorg = true;
  const wrist = buildBoneAuthoringHTML(main, 'mp');
  globalThis.__uiReorg = wasReorg;
  const chips = [...wrist.matchAll(/<button class="mp-(?:voxel|toggle)-btn[^"]*"[^>]*>([^<]*)</g)]
    .map((m) => m[1].trim());
  const over = chips.filter((t) => t.length > 11);
  check('every wrist chip label fits its column without being squeezed',
    chips.length > 0 && over.length === 0,
    'too long, rename rather than decimate: ' + over.join(', '));
}

// THE WRIST AND THE PROPERTIES PAGE RENDER THE SAME CONTROLS.
//
// They did not, and nothing said so: `full` dropped the Setup block on the wrist, which was the
// right trade before collapsible sections existed and a round trip afterwards. matt: "i found
// myself swapping between the bones tool minipanel and the bones tool properties, i'm sure
// there's stuff in the bones panel that isn't in the properties panel."
//
// Asserted as a SET OF IDS rather than as markup, because the two are deliberately different
// markup -- different dialect, different classes, different widths. What must not differ is which
// controls you can reach, and a divergence here is invisible until someone is in a headset
// swapping panels to find a button. Anything genuinely wrist-only should be added to the
// exceptions below WITH ITS REASON, not left to be discovered.
{
  const wasReorg = globalThis.__uiReorg;
  globalThis.__uiReorg = true;
  const ids = (html) => new Set([...html.matchAll(/id="(bone-[a-z0-9-]+)"/g)].map((m) => m[1]));
  const wrist = ids(buildBoneSectionHTML(main, 'mp'));
  const props = ids(buildBoneSectionHTML(main, 'mm'));
  globalThis.__uiReorg = wasReorg;

  const missing = [...props].filter((id) => !wrist.has(id));
  const extra   = [...wrist].filter((id) => !props.has(id));
  check('the wrist panel reaches every bone control the Properties page does',
    missing.length === 0,
    missing.length ? 'only on Properties: ' + missing.join(', ') : '');
  check('...and offers nothing the Properties page cannot',
    extra.length === 0,
    extra.length ? 'only on the wrist: ' + extra.join(', ') : '');
}
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

// ── THE WRIST PANEL IS A WRIST PANEL, AND STILL A WHOLE PANEL ─────────────────────────
//
// matt: "the bones minipanel is hardly a minipanel anymore, its massive... it needs a tidy up."
// Offered folding, columns or fewer things, he picked fewer things — so `full` dropped Make Skin,
// Bake Capsules, Reset Radii, Bind and the two skin sliders from the wrist entirely.
//
// THAT ANSWER WAS SUPERSEDED BY THE ONE HE WAS DENIED AT THE TIME. Once sections could fold, a
// control removed from the wrist was no longer buying height — it was buying a round trip.
// matt: "i found myself swapping between the bones tool minipanel and the bones tool properties,
// i'm sure there's stuff in the bones panel that isn't in the properties panel."
//
// So the split is now by DEPTH, not by presence: what you touch constantly is inline, what you do
// once a session is one heading away. Asserted by ORDER against the fold marker, since that is
// what "behind the fold" means in this markup.
{
  const wasReorg = globalThis.__uiReorg;
  globalThis.__uiReorg = true;
  const wristAuth = buildBoneAuthoringHTML(main, 'mp');
  const menuAuth = buildBoneAuthoringHTML(main, 'mm');
  globalThis.__uiReorg = wasReorg;

  const fold = wristAuth.indexOf('data-group-body="bone-setup"');
  const at = (k) => wristAuth.indexOf('id="bone-' + k + '"');

  check('the wrist keeps the mode buttons',
    ['draw', 'fk', 'free', 'pose', 'radius', 'joint', 'ik']
      .every((k) => at(k) >= 0));
  check('...and the snaps, which you toggle while drawing',
    at('snap') >= 0 && at('axis') >= 0);
  check('...and physics, which is tuned by watching',
    at('phys') >= 0 && at('phys-bake') >= 0);
  check('...all of them in front of the fold, where one press reaches them',
    fold > 0 && ['draw', 'pose', 'ik', 'snap', 'axis'].every((k) => at(k) < fold),
    'these are the controls you touch every few seconds; a heading in the way is a tax on each one');

  const onceAJob = ['skin', 'cages', 'rad-all', 'bind'];
  check('the once-a-session operations are BEHIND the fold, not missing from the wrist',
    onceAJob.every((k) => at(k) > fold),
    onceAJob.filter((k) => at(k) < 0).join(',') + ' not on the wrist at all');
  check('...and the fold is closed until asked for',
    /class="[^"]*collapsed"\s+data-group-body="bone-setup"/.test(wristAuth),
    'open, it is the tall panel matt complained about with an extra heading on top');
  check('...and every one of them is still in the main menu',
    onceAJob.every((k) => menuAuth.includes('id="bone-' + k + '"')),
    'this is a placement, not a removal — losing a control would be a worse bug than a tall panel');

  // The measurement behind the complaint, so a future addition that quietly re-inflates the wrist
  // panel shows up as a number rather than as a feeling. It is no longer wrist-vs-menu — those
  // render the same controls now, deliberately — but folded-vs-whole within the wrist itself.
  const rows = (html) => (html.match(/<div class="[^"]*"/g) || []).length;
  const visible = rows(wristAuth.slice(0, fold));
  check('the wrist panel shows meaningfully less than it holds',
    visible < rows(wristAuth) - 2,
    visible + ' rows in front of the fold vs ' + rows(wristAuth) + ' in the panel');
}

// ── WHAT THE SLIDERS ARE POINTED AT, SAID IN THE PANEL ────────────────────────────────
//
// This block used to describe a STICKY target: the sliders aimed at the last physics joint you
// picked and stayed there, so you could select the hips to shake the rig and go on tuning the
// tail. matt asked for that ("it's a lot of back and forth") and then, having been bitten by it,
// asked for it back out: "the stickiness is a UI hack, and means we run the risk of people
// modifying physics properties they didn't want... i think we drop the stickyness."
//
// So the aim is the selection, and the case the stickiness existed for is answered another way:
// with no chain selected the sliders edit the DEFAULTS, which is useful rather than dead, and the
// panel SAYS which of the two it is doing. That readout is the part worth checking here — a live
// slider whose target you cannot see is the fault both versions of this were trying to avoid.
{
  const wasReorg = globalThis.__uiReorg;
  globalThis.__uiReorg = true;
  const antenna = { _isBone: true, getID: () => 7, _permanentStaticLabel: 'antenna_L',
    _physicsRoot: true, _physicsParams: { stiffness: 0.3, damping: 0.5, gravity: 1, drag: 0.1 } };
  const hips = { _isBone: true, getID: () => 1, _permanentStaticLabel: 'hips' };
  main._physicsPanelTarget = null;

  globalThis.__sel = [antenna];
  const picked = buildBoneAuthoringHTML(main, 'mm');
  check('picking a physics joint aims the sliders at it, and the panel says so',
    picked.includes('id="bone-phys-stiff"') && />antenna_L</.test(picked),
    'a slider whose target is not on screen is one you cannot trust');

  // A drag writes to the mirror twin too, so naming one joint would be telling half the truth
  // about what is about to change. matt: "show above the physics sliders the name of the joint(s)
  // being adjusted?" -- plural, and rightly.
  const twinR = { _isBone: true, getID: () => 8, _permanentStaticLabel: 'antenna_R',
    _physicsRoot: true };
  antenna._boneMirror = twinR;
  twinR._boneMirror = antenna;
  globalThis.__meshes = [antenna, twinR];
  const pair = buildBoneAuthoringHTML(main, 'mm');
  check('...naming BOTH joints when the edit is mirrored',
    />antenna_L \+ antenna_R</.test(pair));

  // ...AND ONE JOINT WHEN IT IS NOT. A joint drawn with symmetry on keeps its twin for the rest
  // of its life, so testing for a twin meant physics could never be flagged on a single side
  // however the toggle was set. matt: "right now i don't think i can do that asymmetrically."
  globalThis.__sym = false;
  const solo = buildBoneAuthoringHTML(main, 'mm');
  globalThis.__sym = true;
  check('...and ONE joint when symmetry is off',
    solo.includes('antenna_L') && !solo.includes('antenna_R'),
    'a twin exists forever once drawn; the toggle is what decides whether an edit follows it');
  antenna._boneMirror = null;
  globalThis.__meshes = null;

  globalThis.__sel = [hips];
  const shaking = buildBoneAuthoringHTML(main, 'mm');
  check('the controls are still there once you select the hips to shake the rig',
    shaking.includes('id="bone-phys-stiff"'),
    'they are what you came to adjust; taking them away is the round trip this all started with');
  check('...but they are aimed at the DEFAULTS, and the panel says that too',
    /Defaults \u2014 no physics bone/.test(shaking) && !/>antenna_L</.test(shaking),
    'the old answer was to keep writing antenna_L from off screen, which is the hack matt cut');
  check('...while the FLAG button still reads the selection',
    /Physics Bone<\/button>/.test(shaking),
    'one control reads the aim and the other the selection -- flagging a NEW joint has to act on '
    + 'what is selected, or nothing could ever be flagged');

  // The readout is rewritten by the SYNC as well as by the builder, because the builder runs once
  // and the selection moves on without it -- which is exactly why the earlier version of this,
  // living in the section heading, was thrown out for going stale.
  check('...and the sync rewrites it, so it cannot go stale between rebuilds',
    /const aim = q\('phys-aim'\);/.test(SRC) && /aim\.textContent = physAimLabel\(/.test(SRC));
  check('...from the same helper the builder uses, so the two cannot drift',
    (SRC.match(/physAimLabel\(/g) || []).length >= 3,
    'written twice they already differed: one named the mirror twin and the other did not');

  globalThis.__sel = [];
  main._physicsPanelTarget = null;
  globalThis.__uiReorg = wasReorg;
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
// ANCHORED ON THE CLAIM, NOT ON ONE CALL SPELLING. This counted the exact text
// `buildDevToggles((id, label, on) =>` and demanded exactly two, which says "the VR page calls
// it twice with an inline arrow" when what it means is "both pages render from the shared
// list". The list is rendered in groups now (ui / trace / other) and the desktop page passes
// named helpers rather than inline arrows, so the count moved while the claim stayed true.
check('both panels build their toggles from that list',
  (() => {
    const vr = MAIN_SRC.slice(MAIN_SRC.indexOf('function buildMenuHTML_settings(main)'),
                              MAIN_SRC.indexOf('export function buildMenuHTML_desktopSettings'));
    const dk = MAIN_SRC.slice(MAIN_SRC.indexOf('export function buildMenuHTML_desktopSettings'));
    return /buildDevToggles\(/.test(vr) && /buildDevToggles\(/.test(dk);
  })(),
  'a second copy is how the two drifted apart in the first place');
// ...and every toggle in the list reaches a page. The groups partition the list, so a toggle
// that matched none of them would render nowhere and be invisible on both platforms.
check('...and the groups cover the whole list between them',
  (() => {
    const m = MAIN_SRC.match(/const want = \(t\) => group == null[\s\S]{0,400}?;/);
    if (!m) return false;
    const w = m[0];
    return /'ui'/.test(w) && /'trace'/.test(w) && /isTrace\(t\) && !isUi\(t\)/.test(w)
      && /!isTrace\(t\) && !isUi\(t\)/.test(w);
  })(),
  'a toggle matching no group renders on neither page');
check('...and both wire it from the same place',
  /wireDevToggles\(q, paint\);/.test(MAIN_SRC) && /wireDevToggles\(q, repaintFn\);/.test(MAIN_SRC),
  'the VR panel repaints through paint(), the sidebar through repaintFn');
// Every instrument in the app is read over remote debugging -- the OUTPUT is the console, but
// the SWITCH has to be reachable from inside a headset or it may as well not exist. matt: "use
// regular chrome console, i have remote debugging enabled" / "i don't see 'trace panel
// visibility' as an option in the settings panel when i'm in vr."
// THE PANEL HIT TEST IS A HAND-ROLLED BOUNDING-BOX WALK (HTMLVRPanel._uvToElement), so "I
// pressed Properties and got Topology" is a question about that walk and can only be asked from
// inside a headset.
{
  const HP = fs.readFileSync('/Users/mattestela/sculptxr/src/gui/htmlvr/HTMLVRPanel.js', 'utf8');
  // THE RAY-HIT TRACE HAS LEFT THE MENU, ON PURPOSE. It was added to answer one question -- "I
  // press Properties and get Topology" -- and that turned out to be a double hyphen in an HTML
  // comment breaking the SVG, not the bounding-box walk it was built to inspect. The instrument
  // is still in HTMLVRPanel and still reachable as hoverTrace(); what is gone is a permanent menu
  // entry for a question that is answered. matt: "should we keep them, or are they now no longer
  // required?" If the walk is ever suspect again, the toggle comes back with the question.
  check('the ray-hit trace still exists to be switched on',
    /window\._hoverTrace = on !== false;/.test(
      fs.readFileSync('/Users/mattestela/sculptxr/src/gui/htmlvr/HTMLVRPanel.js', 'utf8')),
    'removing the menu entry must not delete the instrument behind it');
  check('...and names the element it resolved to well enough to tell tabs apart',
    /t\.dataset\?\.section \|\| t\.dataset\?\.menu \|\| t\.id \|\| t\.className/.test(HP),
    'every tab shares the class mm-tab-btn and has no id, so an id-or-class label printed the '
      + 'same string for all eight -- useless for the one question it is most asked');
}

check('the skin frame trace is in the shared toggle list',
  /id: 'mm-skin-trace',[\s\S]{0,140}?window\._skinTrace = !!on/.test(MAIN_SRC),
  'a trace you can only turn on from a console you cannot open is not an instrument');
check('...and it reads the live flag',
  /get: \(\) => !!window\._skinTrace/.test(MAIN_SRC));
{
  const SKIN = fs.readFileSync('/Users/mattestela/sculptxr/src/editing/Skinning.js', 'utf8');
  check('...and the trace breaks the frame into the four phases',
    /'ms total \| lbs ' \+ ms\(_t0, _t1\)/.test(SKIN)
      && /' mush ' \+ ms\(_t1, _t2\) \+ ' synth ' \+ ms\(_t2, _t3\) \+ ' refresh ' \+ ms\(_t3, now\)/.test(SKIN)
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
  /id="bone-cap-op"/.test(SRC) && /Capsule Opacity/.test(SRC));
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

// ── NO "--" INSIDE AN HTML COMMENT: THE RULE MOVED, BECAUSE THIS ONE ENUMERATED ──────
//
// This check used to live here with a hardcoded list of three files -- MainMenuPanel, MiniPanel,
// AnimationControlPanel -- and it was green on the day the bug shipped again, because the
// offending comment was in bonePanel.js, which builds the markup for all of those and was not on
// the list. A whole headset session went into re-finding a fault this suite was written to catch.
//
// The same shape as every other bug of this kind here: enumerating the sites instead of covering
// the class. panelxml_test now sweeps ALL of src, so this file just makes sure that sweep is
// still there rather than keeping a narrower copy alive to disagree with it.
{
  const XMLT = fs.readFileSync('/Users/mattestela/sculptxr/scratchpad/panelxml_test.mjs', 'utf8');
  check('the "--" sweep exists and walks the whole tree',
    /<!--\(\[\\s\\S\]\*\?\)-->/.test(XMLT) && /function walk\(d\)/.test(XMLT),
    'panelxml_test no longer sweeps src, and nothing else does');
}

// ── CAPSULES CAN BE SHADED ────────────────────────────────────────────────────────────
//
// Unlit capsules read as one flat silhouette: a leg and the arm crossing it are the same shape in
// the same colour and you cannot tell which is nearer. matt: "they should have an option to be
// shaded, viewing them unlit is very hard to read."
check('the rig display offers a Shaded toggle for capsules',
  /flagButton\(c, 'caps-shade', 'Shaded', Skeleton\.displayFlagRaw\('capsuleShaded'\)\)/.test(SRC)
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
    /this\.mesh\.renderOrder = VR_PANEL_RENDER_ORDER \+ \(this\._isModalOverlay \? VR_MODAL_ORDER_BUMP : 0\);/.test(PANEL)
      && /renderOrder = VR_PANEL_RENDER_ORDER \+ 1;/.test(
        fs.readFileSync('/Users/mattestela/sculptxr/src/Scene.js', 'utf8')));
}

console.log(fails ? `\n${fails} FAILURE(S)` : '\nall checks passed');
process.exit(fails ? 1 : 0);
