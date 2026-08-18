// Structural checks on the shared bones panel markup: both dialects, the XR gating, and
// that the ids the wiring looks for are the ids the markup emits.
import fs from 'fs';
const SRC = fs.readFileSync('/Users/mattestela/sculptxr/src/gui/bonePanel.js', 'utf8');
const body = SRC.split('\n').filter(l => !/^import\s/.test(l)).filter(l => !/^export \{ Enums/.test(l)).join('\n');
globalThis.window = {};
const stub = `
const Enums = { Tools: { BONE_DRAW: 34 } };
const Skeleton = { joints: () => [], radiusFraction: () => 0.25, defaultRadiusFrac: () => 0.25 };
const Skinning = { isBound: () => !!globalThis.__bound, anyBound: () => true, refreshWeightColorsAll(){} };
const SkinMesh = {};
const IKSolver = { pinnedJoints: () => [{},{}] };
`;
const mod = await import('data:text/javascript,' + encodeURIComponent(stub + body));
const { buildBoneSectionHTML } = mod;

let fails = 0;
const check = (n, ok, got) => { console.log((ok ? '  ok   ' : '  FAIL ') + n + (ok ? '' : '  got: ' + got)); if (!ok) fails++; };

const main = { _xrSession: null, getSculptManager: () => ({ getCurrentTool: () => ({ modeKey: () => 'draw' }) }), getMesh: () => null };

const flat = buildBoneSectionHTML(main, 'mm');
const vr = buildBoneSectionHTML({ ...main, _xrSession: {} }, 'mm');
const wrist = buildBoneSectionHTML({ ...main, _xrSession: {} }, 'mp');

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
  ['bone-bind', 'bone-skin', 'bone-key', 'bone-unpin', 'bone-rad-all', 'bone-restpose']
    .every(id => flat.includes('id="' + id + '"')));
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
const all = vr + boundHTML;
const missing = [...new Set(wired)].filter(id => !all.includes('id="bone-' + id + '"') && id !== 'rad-val');
check('every wired id exists in the markup', missing.length === 0, missing.join(','));

// The three display toggles are one group to the eye and one group in the markup: the bone
// body, its edge overlay, and the joint markers with the IK pins that hang off them. Checked
// together because a toggle that renders but is never wired (or wired but never rendered) is
// exactly the failure the id sweep above cannot see on its own.
// Wired through the flag() helper rather than a literal q('id'), so the id sweep above cannot
// see them — the wiring call is what has to be looked for.
for (const id of ['solid', 'wire', 'joints']) {
  const drawn = flat.includes('id="bone-' + id + '"');
  const hooked = SRC.includes("flag('" + id + "'");
  check('display toggle "' + id + '" is drawn and wired', drawn && hooked,
    (drawn ? '' : 'not in markup ') + (hooked ? '' : 'not wired'));
}

// Default ON: a rig you have just drawn has to be visible without hunting for a switch.
check('the joint markers default to shown', /id="bone-joints"[^>]*class=|class="[^"]*active[^"]*"[^>]*id="bone-joints"/.test(flat)
  || /<button class="[^"]*active[^"]*" id="bone-joints"/.test(flat),
  'Joints button did not render active by default');

console.log(fails ? `\n${fails} FAILURE(S)` : '\nall checks passed');
process.exit(fails ? 1 : 0);
