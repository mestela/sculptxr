// Node harness for src/render/SceneShadow.js — the AR cast shadow.
//
// THE DESIGN, because the checks only make sense against it: there is no enable toggle, no
// built-in floor and no button that makes a light. Flagging a mesh as a Shadow Catcher is the
// entire switch; the light appears as an ordinary scene object on the next frame. So the things
// at risk are (a) the switch being reintroduced as a control, (b) the cost being paid when nobody
// asked for it, (c) the AR alpha rule, and (d) the flags not surviving a save.
//
// Run: node scratchpad/shadow_test.mjs
//   SHADOW_INJECT=alphablend    alpha goes back onto the colour factors (the grid's old bug)
//   SHADOW_INJECT=noscale       shadow camera near/far in local units, ignoring the group scale
//   SHADOW_INJECT=pcfsoft       PCF_SOFT, so the softness slider stops doing anything
//   SHADOW_INJECT=softcap12     the softness ceiling goes back to 12
//   SHADOW_INJECT=fitcatchers   the fit counts catchers, so a proxy drags the light away
//   SHADOW_INJECT=oneshot       the per-frame sweep stops re-applying the proxy material
//   SHADOW_INJECT=catchercasts  a proxy casts as well as receives
//   SHADOW_INJECT=depthwrite    the transparent catcher writes depth again
//   SHADOW_INJECT=alwayson      the shadow map stays enabled with no catcher in the scene
//   SHADOW_INJECT=nodegenguard  a light sitting on its aim point builds a NaN shadow camera
//   SHADOW_INJECT=noorigin      the light spawns somewhere other than the origin
//   SHADOW_INJECT=nolightspawn  the first proxy no longer brings a light with it
//   SHADOW_INJECT=nohandleload  a light restored from a file never gets its handle back
//   SHADOW_INJECT=eyeignored    the outliner's eye stops hiding the light handle
//   SHADOW_INJECT=thinhandle    the handle goes back to unthickenable 1px lines
//   SHADOW_INJECT=raythroughmodel  the ray is drawn to the aim point, spearing the sculpt
//   SHADOW_INJECT=norestore     un-flagging a proxy leaves it holding the shadow material
//   SHADOW_INJECT=aimatfloor    the light aims low again instead of at the model centre
//   SHADOW_INJECT=nosaveflag    the shadow flags stop being written to the .sxr
//   SHADOW_INJECT=nosaverow     a catcher/light that is otherwise unremarkable gets no row
import fs from 'fs';
import path from 'path';

const REPO = new URL('..', import.meta.url).pathname;
let SRC   = fs.readFileSync(path.join(REPO, 'src/render/SceneShadow.js'), 'utf8');
let OPTS  = fs.readFileSync(path.join(REPO, 'src/misc/getOptionsURL.js'), 'utf8');
let PANEL = fs.readFileSync(path.join(REPO, 'src/gui/htmlvr/MainMenuPanel.js'), 'utf8');
const SCENE = fs.readFileSync(path.join(REPO, 'src/Scene.js'), 'utf8');
let SKEL  = fs.readFileSync(path.join(REPO, 'src/editing/Skeleton.js'), 'utf8');

const inject = process.env.SHADOW_INJECT || '';
const swap = (a, b, label, which) => {
  const target = which === 'skel' ? SKEL : SRC;
  if (!target.includes(a)) throw new Error('inject ' + label + ': anchor moved');
  if (which === 'skel') SKEL = SKEL.split(a).join(b); else SRC = SRC.split(a).join(b);
};
if (inject === 'alphablend') {
  swap('    mat.blendSrcAlpha = THREE.OneFactor;\n    mat.blendDstAlpha = THREE.OneFactor;',
       '    mat.blendSrcAlpha = THREE.SrcAlphaFactor;\n    mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;', inject);
} else if (inject === 'noscale') {
  swap('    const worldDist = dist * scale;', '    const worldDist = dist;', inject);
} else if (inject === 'pcfsoft') {
  swap('renderer.shadowMap.type = THREE.PCFShadowMap;', 'renderer.shadowMap.type = THREE.PCFSoftShadowMap;', inject);
} else if (inject === 'softcap12') {
  swap('const MAX_SOFTNESS = 24;', 'const MAX_SOFTNESS = 12;', inject);
} else if (inject === 'fitcatchers') {
  swap('    const list = this._casters();\n    if (!list.length', '    const list = this._main.getMeshes();\n    if (!list.length', inject);
} else if (inject === 'oneshot') {
  swap('      if (tm.material !== this._mat) tm.material = this._mat;', '', inject);
} else if (inject === 'catchercasts') {
  swap('      tm.castShadow = false;', '      tm.castShadow = true;', inject);
} else if (inject === 'depthwrite') {
  swap('    mat.depthWrite = false;', '    mat.depthWrite = true;', inject);
} else if (inject === 'alwayson') {
  swap('        if (renderer) renderer.shadowMap.enabled = false;', '', inject);
} else if (inject === 'nodegenguard') {
  swap('    if (!(dist > fit.reach * 1e-3)) return false;', '', inject);
} else if (inject === 'noorigin') {
  swap('    M[12] = M[13] = M[14] = 0;', '    M[12] = 10; M[13] = 20; M[14] = 30;', inject);
} else if (inject === 'nolightspawn') {
  swap('    if (!lm) lm = this.spawnLight();', '', inject);
} else if (inject === 'nohandleload') {
  swap('    if (lm) this._decorateLight(lm);', '', inject);
} else if (inject === 'eyeignored') {
  swap('    const shown = lm.isVisible ? lm.isVisible() : true;', '    const shown = true;', inject);
} else if (inject === 'thinhandle') {
  swap('    const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 16, 12), mat);',
       '    const ball = new THREE.Line(new THREE.BufferGeometry(), mat);', inject);
} else if (inject === 'raythroughmodel') {
  swap('        const len = Math.max(dist * 0.15, dist - fit.reach);', '        const len = dist;', inject);
} else if (inject === 'norestore') {
  swap('    if (!on) this._restoreMesh(mesh);', '', inject);
} else if (inject === 'aimatfloor') {
  swap('    const tgtY = fit.cy;', '    const tgtY = fit.cy - fit.reach;', inject);
} else if (inject === 'nosaveflag') {
  swap('        | (m._isShadowCatcher ? 256 : 0) | (m._isShadowLight ? 512 : 0),', ',', inject, 'skel');
} else if (inject === 'nosaverow') {
  swap('    if (!parented && !m._isBone && !m._selectLocked && !hidden && !shadow) return;',
       '    if (!parented && !m._isBone && !m._selectLocked && !hidden) return;', inject, 'skel');
}

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

// ── 1. THE AR ALPHA RULE ──────────────────────────────────────────────────────────────────────
// Not a grep for factor names: the factors are read out of the source and the blend equation is
// EVALUATED with them, so a plausible-but-wrong choice fails on the number it produces.
const read = (prop) => {
  const m = SRC.match(new RegExp('\\bmat\\.' + prop + ' = (?:THREE\\.)?(\\w+);'));
  return m ? m[1] : null;
};
const FACTOR = {
  OneFactor: () => 1, ZeroFactor: () => 0,
  SrcAlphaFactor: (s) => s, OneMinusSrcAlphaFactor: (s) => 1 - s,
  DstAlphaFactor: (s, d) => d, OneMinusDstAlphaFactor: (s, d) => 1 - d,
};
const blend = (srcF, dstF, s, d) =>
  Math.min(1, Math.max(0, s * FACTOR[srcF](s, d) + d * FACTOR[dstF](s, d)));

check('the catcher blends with explicit, custom factors',
  read('blending') === 'CustomBlending', read('blending'));
const sA = read('blendSrcAlpha'), dA = read('blendDstAlpha');
check('the alpha channel has factors of its own', !!FACTOR[sA] && !!FACTOR[dA], sA + ' / ' + dA);
if (FACTOR[sA] && FACTOR[dA]) {
  check('a shadow over bare passthrough adds opacity, so the room is hidden by it',
    blend(sA, dA, 0.35, 0.0) >= 0.35, 'alpha ' + blend(sA, dA, 0.35, 0.0).toFixed(3));
  check('a shadow crossing the sculpt does not punch a hole in it',
    blend(sA, dA, 0.35, 1.0) >= 1.0, 'alpha ' + blend(sA, dA, 0.35, 1.0).toFixed(3));
  const worst = [0.05, 0.25, 0.5, 0.75, 1].map((a) => blend(sA, dA, a, 1.0));
  check('...at any shadow opacity the slider allows', worst.every((a) => a >= 1.0),
    worst.map((a) => a.toFixed(2)).join(','));
  check('...and over a half-transparent sculpt, which must not get MORE transparent',
    blend(sA, dA, 0.35, 0.5) >= 0.5);
}
check('the colour channels still blend normally, or the shadow darkens nothing',
  read('blendSrc') === 'SrcAlphaFactor' && read('blendDst') === 'OneMinusSrcAlphaFactor');
check('the transparent catcher does not write depth', /mat\.depthWrite = false;/.test(SRC));

// ── 2. THE OBJECT IS THE SWITCH ───────────────────────────────────────────────────────────────
check('the shadow map follows whether anything is CATCHING a shadow',
  /const catchers = this\._catchers\(\);/.test(SRC)
    && /if \(!catchers\.length\) \{/.test(SRC)
    && /if \(renderer\) renderer\.shadowMap\.enabled = false;/.test(SRC),
  'the extra full-scene depth pass is the reason this was ever a toggle; tying it to the proxy '
    + 'means nobody pays it without having asked');
check('...and nothing at all is built until then',
  /_build\(\) \{\s*\n\s*if \(this\._built\) return;/.test(SRC)
    // _build is reached only AFTER the no-catcher early return, so its call site must come
    // later in update() than that return does.
    && SRC.indexOf('this._build();') > SRC.indexOf('if (!catchers.length) {'));
check('a hidden proxy stops catching, so the eye icon turns the shadow off',
  /if \(m\._isShadowCatcher && \(!m\.isVisible \|\| m\.isVisible\(\)\)\) out\.push\(m\);/.test(SRC));
check('there is no enable/disable API left to reintroduce the toggle',
  !/setEnabled\(/.test(SRC) && !/isEnabled\(/.test(SRC) && !/getShadowEnabled/.test(SCENE));
check('...no built-in floor',
  !/_catcher\b/.test(SRC) && !/autoFloor/i.test(SRC) && !/PlaneGeometry/.test(SRC));
check('...and no height, elevation or azimuth control anywhere',
  !/_elevation|_azimuth|_height/.test(SRC)
    && !/shadowElevation|shadowAzimuth|shadowHeight|shadowAutoFloor|shadowEnabled/.test(OPTS)
    && !/mm-shadow-(elev|azim|height|autofloor|toggle|lightgiz)/.test(PANEL),
  'the light is moved directly; angles that disagreed with its position are gone');

// ── 3. THE LIGHT ──────────────────────────────────────────────────────────────────────────────
check('the light is a NULL, so selection, the gizmo, VR grab, undo and keying come free',
  /_isShadowLight = true;/.test(SRC) && /buildNull\?\.\(\)/.test(SRC));
check('...spawned at the ORIGIN, not at a position computed from angles nobody set',
  /M\[12\] = M\[13\] = M\[14\] = 0;/.test(SRC));
check('...brought in by the first proxy, with no button of its own',
  /if \(!lm\) lm = this\.spawnLight\(\);/.test(SRC) && !/mm-shadow-lightgiz/.test(PANEL));
check('...and a light sitting ON its aim point is guarded, not fed to three',
  /if \(!\(dist > fit\.reach \* 1e-3\)\) return false;/.test(SRC),
  'it starts at the origin and the model is usually centred there, so this is the ordinary '
    + 'first frame — three would build a shadow camera from a zero-length look vector');
check('the handle is SOLID geometry, not lines, which cannot be thickened',
  /new THREE\.SphereGeometry\(BALL_R/.test(SRC) && /new THREE\.CylinderGeometry\(RAY_R \* 0\.35/.test(SRC));
check('...rebuilt for a light restored from a file, which carries no three.js at all',
  /if \(lm\) this\._decorateLight\(lm\);/.test(SRC)
    && /if \(tm\.getObjectByName && tm\.getObjectByName\('shadow_light_handle'\)\) return;/.test(SRC),
  'and idempotent, since it runs every frame');
check('...and the outliner eye owns it, without switching the light off',
  /const shown = lm\.isVisible \? lm\.isVisible\(\) : true;/.test(SRC)
    && /if \(ltm\) ltm\.visible = shown;/.test(SRC)
    && !/this\._light\.visible = shown/.test(SRC));
check('the ray is a tube that stops short of the model, not a stick through it',
  /const len = Math\.max\(dist \* 0\.15, dist - fit\.reach\);/.test(SRC));

// ── 4. AIM, FIT AND SCALE ─────────────────────────────────────────────────────────────────────
check("the light aims at the MODEL's centre",
  /const tgtY = fit\.cy;/.test(SRC) && /this\._target\.position\.set\(fit\.cx, tgtY, fit\.cz\);/.test(SRC));
check('the shadow camera converts local distance to world through the group scale',
  /const scale = main\._worldGroup \? main\._worldGroup\.scale\.x : 1;/.test(SRC)
    && /const worldDist = dist \* scale;/.test(SRC),
  'three builds the shadow camera from WORLD positions; the group is scaled 0.701');
check('...and near and far are both taken from it',
  /camera\.near = [^\n]*worldDist/.test(SRC) && /camera\.far = [^\n]*worldDist/.test(SRC));
check('the fit is taken from the CASTERS only',
  /const list = this\._casters\(\);\s*\n\s*if \(!list\.length/.test(SRC)
    && /if \(m\._isBone \|\| m\._isNull \|\| m\._isReference \|\| m\._isShadowCatcher\) continue;/.test(SRC),
  'a room-sized proxy in the fit would widen the cone and blur away the only thing the map is for');
// CALLED, not mentioned: the reason it is not used is written in a comment right above the fit,
// and a bare substring test fails on its own documentation.
check('...and not from computeBoundingBoxScene, which folds in the brush cursor',
  !/\bmain\.computeBoundingBoxScene\s*\(/.test(SRC) && !/this\.computeBoundingBoxScene\s*\(/.test(SRC));

// ── 5. PROXIES ────────────────────────────────────────────────────────────────────────────────
check('a proxy receives but does not cast — the real table already has its own shadow',
  /tm\.receiveShadow = true;/.test(SRC) && /tm\.castShadow = false;/.test(SRC));
check('the proxy material is re-applied every frame, not assigned once',
  /if \(tm\.material !== this\._mat\) tm\.material = this\._mat;/.test(SRC),
  'setShaderType and every global shader change rewrite threeMesh.material');
check('un-flagging a proxy puts its own material back',
  /if \(!on\) this\._restoreMesh\(mesh\);/.test(SRC)
    && /tm\.material = ShaderManager\.getMaterial\(mesh\.getShaderType\(\)\);/.test(SRC));
check('every proxy shares ONE material, so one slider moves them together',
  /this\._mat = new THREE\.ShadowMaterial/.test(SRC) && /this\._mat\.opacity = this\._opacity;/.test(SRC));

// ── 6. SOFTNESS ───────────────────────────────────────────────────────────────────────────────
check('the shadow map is plain PCF, the only kernel that reads shadow.radius',
  /shadowMap\.type = THREE\.PCFShadowMap;/.test(SRC),
  'PCF_SOFT ignores radius, so the slider would be inert');
check('...and the slider writes that radius', /shadow\.radius = this\._softness;/.test(SRC));
{
  const cap = Number((SRC.match(/const MAX_SOFTNESS = (\d+);/) || [])[1]);
  check('the softness ceiling is 24 — doubled, to match a real area light', cap === 24, 'cap ' + cap);
  check('...clamped to it, and the slider reaches it',
    new RegExp('Math\\.min\\(MAX_SOFTNESS').test(SRC)
      && /id="mm-shadow-soft" min="0" max="240"/.test(PANEL),
    'the slider is in tenths, so 240 is 24.0');
}

// ── 7. THE FLAGS SURVIVE A SAVE ───────────────────────────────────────────────────────────────
// They ride in the SKEL footer block, which is versioned on its own — no change to the fragile
// per-mesh binary layout of the SGL format itself.
check('the SKEL block version was bumped for the shadow flags',
  /const SKEL_VERSION = 16;/.test(SKEL));
check('...the two bits are written, above every existing flag',
  /\| \(m\._isShadowCatcher \? 256 : 0\) \| \(m\._isShadowLight \? 512 : 0\),/.test(SKEL),
  'so an older build reads neither and gets the pre-feature scene rather than a broken one');
check('...a catcher or light earns a row even when it is nothing else',
  /const shadow = !!\(m\._isShadowCatcher \|\| m\._isShadowLight\);/.test(SKEL)
    && /!hidden && !shadow\) return;/.test(SKEL),
  'neither is necessarily parented, a bone, locked or hidden — without this the flag has '
    + 'nowhere to be written');
check('...and both are restored, behind a version guard',
  /if \(ver >= 16\) \{/.test(SKEL)
    && /if \(row\.bone & 256\) row\.mesh\._isShadowCatcher = true;/.test(SKEL)
    && /if \(row\.bone & 512\) \{/.test(SKEL));

// ── 8. SETTINGS AND CONTROLS ──────────────────────────────────────────────────────────────────
for (const key of ['shadowOpacity', 'shadowSoftness']) {
  check('the ' + key + ' setting persists',
    SRC.includes("saveOption?.('" + key + "'") && new RegExp('options\\.' + key + '\\s*=').test(OPTS));
}
check('...debounced, since the sliders fire on every frame of a drag',
  (SRC.match(/saveOption\?\.\('shadow\w+', [^,]+, 250\)/g) || []).length === 2);
for (const id of ['mm-shadow-catcher', 'mm-shadow-opacity', 'mm-shadow-soft']) {
  check('the ' + id + ' control is both drawn and wired',
    PANEL.includes('id="' + id + '"') && PANEL.includes("'#" + id + "'"));
}
check('the two sliders go inert until something is actually catching a shadow',
  /id="mm-shadow-group"\$\{shadowLive \? '' : ' inert/.test(PANEL)
    && /isShadowActive/.test(SCENE));

console.log('');
console.log(failures ? failures + ' FAILURE(S)' : 'all ok');
process.exit(failures ? 1 : 0);
