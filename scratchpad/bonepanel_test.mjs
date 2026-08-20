// Structural checks on the shared bones panel markup: both dialects, the XR gating, and
// that the ids the wiring looks for are the ids the markup emits.
import fs from 'fs';
const SRC = fs.readFileSync('/Users/mattestela/sculptxr/src/gui/bonePanel.js', 'utf8');
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

// ── Display flags: defaults, one registry, and persistence ──────────────────────
{
  const OPTS = fs.readFileSync('/Users/mattestela/sculptxr/src/misc/getOptionsURL.js', 'utf8');

  // Capsules and weights are DIAGNOSTICS drawn over the sculpt. Neither is what you want to
  // be looking at the moment the tool opens.
  check('capsules are off by default', FLAG_DEFAULTS.capsules === false, FLAG_DEFAULTS.capsules);
  check('weight colours are off by default', FLAG_DEFAULTS.weights === false, FLAG_DEFAULTS.weights);
  // The rest keep the defaults they had; a registry that quietly flipped them would be worse
  // than the sentinel it replaced.
  for (const k of ['snapPlane', 'snapAxis', 'solid', 'wire', 'joints']) {
    check(`${k} is still on by default`, FLAG_DEFAULTS[k] === true, FLAG_DEFAULTS[k]);
  }
  check('lengths are still off by default', FLAG_DEFAULTS.lengths === false, FLAG_DEFAULTS.lengths);

  // THE DEFAULT IS WRITTEN TWICE — registry and option validator — so they must agree, or a
  // reload silently changes what the panel shows.
  const rows = [...FLAG_SRC.matchAll(/(\w+): \['(\w+)', '(\w+)', (true|false)\]/g)];
  check('every flag is declared as a saved option', rows.length === 8, rows.length);
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
