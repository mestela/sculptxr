// Node harness for LIGHTS AS OBJECTS — Scene.addLight and the point-light loop in ShaderPBR.
//
// matt: "lights should be a primitive, i choose to add and place them myself." So the thing
// under test is not "is there lighting" but "is a light an ordinary scene object" — because
// that is what makes it placeable, parentable, keyable and undoable without any of those
// features being taught about lights.
//
// THE LOAD-BEARING DECISION IS `_isNull`. Twenty-nine places in this codebase ask "is this real
// geometry" by checking that flag — the exporter, the shadow caster list, skinning, weight
// cages, bone draw, the rendering-option sweeps, the phantom scan. A light that carries it is
// correctly ignored by every one of them without being mentioned in any. It is the same trick a
// rig joint uses ("transform-only locator: reuses the null constraint/eval paths", Skeleton.js),
// so if a future light stops carrying `_isNull`, it starts leaking into all of those at once and
// the checks below are what should say so.
//
// Run: node scratchpad/lights_test.mjs
import fs from 'fs';
import path from 'path';

const REPO = new URL('..', import.meta.url).pathname;
const SCENE = fs.readFileSync(path.join(REPO, 'src/Scene.js'), 'utf8');
const PBR   = fs.readFileSync(path.join(REPO, 'src/render/shaders/ShaderPBR.js'), 'utf8');
const SHMGR = fs.readFileSync(path.join(REPO, 'src/render/ShaderManager.js'), 'utf8');
const PANEL = fs.readFileSync(path.join(REPO, 'src/gui/htmlvr/MainMenuPanel.js'), 'utf8');
const GLSL  = fs.readFileSync(path.join(REPO, 'src/render/shaders/glsl/pbr.glsl.js'), 'utf8');

let fails = 0;
function check(name, cond, why) {
  if (cond) { console.log('  ok   ' + name); return; }
  fails++;
  console.log('  FAIL ' + name + (why ? '  ' + why : ''));
}

// ── a light is an object ────────────────────────────────────────────────────────────
check('a light is added as a scene object, not a viewport setting',
  /addLight\(\) \{[\s\S]{0,200}this\.addNewMesh\(mesh\);/.test(SCENE),
  'going through addNewMesh is what buys the outliner row, selection, gizmo and undo');
check('...and is a locator, so everything that filters geometry already skips it',
  /mesh\._isLight   = true;/.test(SCENE) && /mesh\._isNull    = true;/.test(SCENE),
  'without _isNull a light leaks into the exporter, skinning, weight cages and the rest at once');
check('...the brush does not sculpt it',
  /mesh\.isPickable = false;/.test(SCENE));
check('...and it is offered next to the other primitives',
  /id="mm-add-light"/.test(PANEL) && /main\.addLight\?\.\(\)/.test(PANEL));

// A light whose range is a constant either lights nothing or everything, since scene units here
// are arbitrary and large. Scaling off the scene diagonal is the difference between "I added a
// light" and "I added a light and nothing happened".
//
// THE RULE, NOT THE MULTIPLIER. This used to assert the literal `d * 0.5 : 50`, and broke the
// moment the floor moved to 200 -- a number that had to move, because the falloff became
// physical inverse-square when PBR went onto three's lighting and half the diagonal stopped
// reaching anything. What must hold is that the range is DERIVED from the scene and has a
// floor for an empty one; the constants are a judgement that will move again.
check('a new light takes its range from the scene it lands in',
  /mesh\._lightRange = this\._lightRangeForScene\(\);/.test(SCENE)
    && /_lightRangeForScene\(\) \{[\s\S]{0,900}?vec3\.dist\(/.test(SCENE)
    && /_lightRangeForScene\(\) \{[\s\S]{0,1200}?return Math\.max\(MIN,/.test(SCENE));
check('...and carries its own colour and intensity',
  /mesh\._lightColor     = \[1\.0, 0\.98, 0\.95\];/.test(SCENE)
    && /mesh\._lightIntensity = 1\.0;/.test(SCENE));
check('...with a handle you can see, in the light\'s own colour',
  /rays\.name = 'light_rays';/.test(SCENE) && /refreshLightDecoration\(mesh\)/.test(SCENE));
check('only VISIBLE lights are collected, so hiding one turns it off',
  /if \(ms\[i\]\._isLight && ms\[i\]\.isVisible && ms\[i\]\.isVisible\(\)\) out\.push\(ms\[i\]\);/.test(SCENE));

// ── the shader side ─────────────────────────────────────────────────────────────────
//
// GLSL ES 1.0 will not size an array from a uniform, nor loop to one, so the array is fixed and
// the count is a separate uniform the loop breaks on.
check('the shader takes a fixed array of lights with a runtime count',
  /const int MAX_LIGHTS = ' \+ MAX_LIGHTS \+ ';/.test(PBR)
    && /uniform vec3 uLightPos\[MAX_LIGHTS\];/.test(PBR)
    && /if \(i >= uNbLights\) break;/.test(PBR));
// THE RULE IS THAT THE TWO AGREE, NOT THAT THEY BOTH SAY FOUR. This used to pin the literal in
// each place, which failed the moment the budget moved even though the budget moving is allowed
// and the two sides still matched. The shader now interpolates the JS constant, so they cannot
// disagree; what is worth asserting is that there is exactly ONE declaration to change.
check('...and the CPU side agrees about the budget, by construction',
  (PBR.match(/var MAX_LIGHTS = \d+;/g) || []).length === 1
    && !/const int MAX_LIGHTS = \d+;/.test(PBR),
  'two different maxima is a light that silently never renders');
check('...and the budget is a number the headset can afford',
  (() => {
    const m = /var MAX_LIGHTS = (\d+);/.exec(PBR);
    return !!m && +m[1] >= 4 && +m[1] <= 16;
  })(),
  'the fragment loop may be UNROLLED by a driver, in which case every pixel pays for the whole '
  + 'array whatever uNbLights says — raise this only against a measured headset frame time');
// A leftover position from a deleted light is a ghost nobody can find.
check('...with the unused tail zeroed rather than left stale',
  /for \(var lz = nb; lz < MAX_LIGHTS; lz\+\+\)/.test(PBR));

// THE LIGHT AND THE SURFACE MUST BE IN THE SAME SPACE, AND VR HAS TWO CAMERAS.
//
// This used to assert the opposite: that the position was converted to view space HERE, on the
// CPU, with main.getCamera().getView(). That is cheaper and it is correct with one camera --
// but ShaderManager rewrites `uMV` to three's `modelViewMatrix`, so vVertex is in the real
// per-eye view space while the light was in the desktop camera's, and the gap rotated with the
// head. matt: "i rotate my head, lighting shifts on surfaces... not just spec, diffuse too."
// The check encoded the bug, so it is replaced rather than repaired.
// Matched as CODE, not as prose: the comment explaining why this changed names getView() too,
// and a bare substring test would keep failing on the explanation for its own fix.
check('the light is uploaded in WORLD space, not pre-transformed by the desktop camera',
  !/var vm = main\.getCamera\(\)\.getView\(\);/.test(PBR)
    && /uLightPosTmp\[li \* 3\] = e\[12\]/.test(PBR),
  'a CPU view-space transform can only be right for one of the two eyes');

// THE SAME BUG LIVED TWICE. The environment's orientation was also the desktop camera's inverse
// rotation, and it drives sphericalHarmonics() as well as the reflection -- so the AMBIENT swam
// too, which is why the symptom was not confined to highlights and was in fact the larger half.
check('the environment orientation is derived per eye, not uploaded from the desktop camera',
  !/mat3\.fromMat4\(uIBLTmp, main\.getCamera\(\)\.getView\(\)\)/.test(PBR)
    && !/uniform mat3 uIblTransform;/.test(GLSL)
    && /mat3 iblTransform\(\) \{/.test(GLSL),
  'one camera cannot orient an environment for two eyes');
// BUILT ONCE PER FRAGMENT, and both lookups share it. This used to pin `iblTransform() * R`
// and `iblTransform() * N` literally, which failed the moment the matrix was hoisted into a
// local -- a pure win that changed nothing about the rule. What matters is that the reflection
// AND the SH ambient both use the per-eye transform, and that it is assembled once.
check('...and both lookups go through it, from one matrix',
  /mat3 iblM = iblTransform\(\);/.test(GLSL)
    && /sphericalHarmonics\(iblM \* N\)/.test(GLSL)
    && /texturePanoramaLod\(iblM \* R, rLinear\)/.test(GLSL)
    // COMMENTS STRIPPED FIRST. Counting raw occurrences caught the prose explaining the hoist
    // and reported three -- the second time today an assertion has been tripped by the comment
    // describing its own subject. Match code, or strip the comments before you count.
    && (GLSL.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
          .match(/iblTransform\(\)/g) || []).length === 2,   // the definition and one call
  'the SH one is the ambient — missing it would leave diffuse swimming');
// GLSL ES 1.0 has no transpose(), so the inverse rotation is written out by hand.
check('...transposing by hand rather than calling transpose()',
  /return mat3\(v\[0\]\[0\], v\[1\]\[0\], v\[2\]\[0\],/.test(GLSL));
check('...and the shader moves it with three\'s per-eye viewMatrix',
  /vec3 toL = \(viewMatrix \* vec4\(uLightPos\[i\], 1\.0\)\)\.xyz - vVertex;/.test(PBR),
  'this is the one matrix that differs between the eyes');
check('...which must NOT be declared in the shader',
  !/uniform mat4 viewMatrix/.test(PBR),
  "three injects it on a ShaderMaterial; redeclaring it fails to compile");
// _worldGroup carries a scale the app's own camera does not know about, so the three-side
// matrixWorld is the only position that is in the same space vVertex ends up in.
check('...read off the three-side matrixWorld, forced current',
  /ltm\.updateMatrixWorld\(true\);/.test(PBR)
    && /var e = ltm\.matrixWorld\.elements;/.test(PBR),
  'this runs before renderer.render(), so a light moved this frame would otherwise lag one');

// THE HANDLE SAYS WHICH KIND IT IS, and for the aimed types, WHERE IT POINTS. A marker that
// does not show direction makes you rotate the gizmo and guess. matt: "spotlights need a cone
// indicator to indicate direction and angle. sun needs 3 parallel lines with a thin arrow at
// one end to indicate direction."
check('the light handle is rebuilt, not added to, when the type changes',
  /const old = tm\.getObjectByName\('light_rays'\);/.test(SCENE)
    && /tm\.remove\(old\); old\.geometry\.dispose\(\); old\.material\.dispose\(\);/.test(SCENE),
  'without this every switch leaves the previous shape behind');
check('...a spot draws a cone at the angle you set',
  /Math\.tan\(Math\.max\(1, Math\.min\(89, mesh\._lightConeDeg \|\| 35\)\) \* Math\.PI \/ 180\)/.test(SCENE),
  'the rim IS the outer angle, or the handle is decoration rather than a readout');
check('...a sun draws parallel rays with one arrowhead',
  /const off = \[\[-0\.35, 0\], \[0, 0\], \[0\.35, 0\]\];/.test(SCENE)
    && /seg\(0, 0, -0\.7, h, 0, -0\.7 \+ h\);/.test(SCENE),
  'parallel is the statement — a sun has a direction and no position');
check('...and a point draws nothing directional',
  /ray\(1, 0, 0\); ray\(-1, 0, 0\);/.test(SCENE));
// The cone handle IS the angle readout, so it has to follow the slider.
check('the handle follows the type and cone controls',
  (PANEL.match(/main\.decorateLight\?\.\(L\);/g) || []).length >= 2,
  'a stale cone is a control that lies about what it set');

// ── light TYPES: one entity, a type property ────────────────────────────────────────
//
// Not three classes. A light is already an ordinary scene object, so the type is a property of
// it and changing your mind keeps the placement, the parenting and the keys.
check('a light has a type and a cone, defaulting to point',
  /mesh\._lightType   = 0;/.test(SCENE) && /mesh\._lightConeDeg = 35;/.test(SCENE));
check('...which duplicate carries across',
  /copy\._lightType      = src\._lightType;/.test(SCENE)
    && /copy\._lightConeDeg   = src\._lightConeDeg;/.test(SCENE));
// Aim is the locator's own -Z, the convention three's spot and directional lights use, so the
// ordinary transform gizmo aims a spot with no special mode.
check('aim is the local -Z, normalised against the locator\'s scale',
  /var dx = -e\[8\], dy = -e\[9\], dz = -e\[10\];/.test(PBR)
    && /var dl = Math\.hypot\(dx, dy, dz\) \|\| 1;/.test(PBR));
check('a directional light ignores position and distance',
  /if \(uLightType\[i\] > 1\.5\) \{/.test(PBR) && /      L = -Ldir;/.test(PBR)
    && /      att = 1\.0;/.test(PBR),
  'a sun does not get brighter as you walk towards it');
check('a spot multiplies the point falloff by a SOFT cone',
  /float cd = dot\(-L, Ldir\);/.test(PBR)
    && /att \*= smoothstep\(uLightCone\[i\]\.x, uLightCone\[i\]\.y, cd\);/.test(PBR),
  'a hard edge reads as a stencil, not a lamp');
// Degrees are a UI unit; the shader compares dot products.
check('...with the cone stored as cosines, converted once on upload',
  /uLightConeTmp\[li \* 2\] = Math\.cos\(_ca\);/.test(PBR)
    && /uLightConeTmp\[li \* 2 \+ 1\] = Math\.cos\(_ca \* 0\.75\);/.test(PBR));
// The direction is a DIRECTION: the view translation must not touch it.
check('...and the direction is rotated into view space, not transformed',
  /vec3 Ldir = normalize\(mat3\(viewMatrix\) \* uLightDir\[i\]\);/.test(PBR));
// The mock gl swallows what it does not implement, which is how the IBL binding was dead for
// months. Every array uniform the light block uploads needs an entry.
check('the mocked gl implements every array uniform the lights upload',
  /uniform3fv: function/.test(SHMGR) && /uniform2fv: function/.test(SHMGR)
    && /uniform1fv: function/.test(SHMGR),
  'a missing entry here is silent — see the TEXTURE0 story');
// Rows that cannot do anything are hidden, not dimmed.
check('the panel hides Falloff for a sun and shows Cone only for a spot',
  /\$\{\(_lit\._lightType \|\| 0\) !== 2 \? `/.test(PANEL)
    && /\$\{\(_lit\._lightType \|\| 0\) === 1 \? `/.test(PANEL));

// Added to the IBL, not replacing it: the ambient still fills the shadow side.
check('lights add to the environment rather than replacing it',
  /color \+= uExposure \* uLightCol\[i\] \* att \* NdL \* \(albedo \* 0\.31830989 \+ spec\);/.test(PBR));
check('...using GGX, the distribution the IBL already approximates',
  /float D = a2 \/ max\(3\.14159265 \* dd \* dd, 1e-6\);/.test(PBR),
  'a direct highlight and an environment reflection should describe one material');
// Raw inverse-square is correct and unusable at this scale: it would want intensities in the
// thousands and blow out the moment the light was nudged closer.
check('...with a falloff a person placing a light can predict',
  // `att` is declared before the type branch now, so this is an assignment rather than a
  // declaration -- the arithmetic is the thing being pinned, not the storage class.
  /\batt = 1\.0 \/ \(1\.0 \+ dist2 \/ \(r \* r\)\);/.test(PBR),
  'full at the light, half at its range, smooth everywhere, never zero');

// The mock gl swallows anything it does not implement — that is exactly how the environment map
// went unbound for the whole life of the Three.js port. uniform1fv had no entry at all.
check('the mocked gl can carry a float ARRAY, which it previously could not',
  /uniform1fv: function\(loc, val\)/.test(SHMGR),
  'a missing entry in this mock is silent, which is how the IBL stayed dark');

console.log(fails ? '\n' + fails + ' FAILURE(S)' : '\nall checks passed');
process.exit(fails ? 1 : 0);
