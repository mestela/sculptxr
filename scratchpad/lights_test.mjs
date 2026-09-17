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
// are arbitrary and large. Half the scene diagonal is the difference between "I added a light"
// and "I added a light and nothing happened".
check('a new light takes its range from the scene it lands in',
  /mesh\._lightRange = this\._lightRangeForScene\(\);/.test(SCENE)
    && /return d > 1e-6 \? d \* 0\.5 : 50;/.test(SCENE));
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
  /const int MAX_LIGHTS = 4;/.test(PBR)
    && /uniform vec3 uLightPos\[MAX_LIGHTS\];/.test(PBR)
    && /if \(i >= uNbLights\) break;/.test(PBR));
check('...and the CPU side agrees about the budget',
  /var MAX_LIGHTS = 4;/.test(PBR),
  'two different maxima is a light that silently never renders');
// A leftover position from a deleted light is a ghost nobody can find.
check('...with the unused tail zeroed rather than left stale',
  /for \(var lz = nb; lz < MAX_LIGHTS; lz\+\+\)/.test(PBR));

// vVertex is a view-space position, so the light has to meet it there.
check('light positions are converted to view space on the CPU',
  /uLightPosTmp\[li \* 3\]     = vm\[0\] \* px \+ vm\[4\] \* py \+ vm\[8\]  \* pz \+ vm\[12\];/.test(PBR),
  'a position needs the translation too — unlike a direction');
check('...read from the model-space matrix, so parenting is already folded in',
  /getModelSpaceMatrix \? lights\[li\]\.getModelSpaceMatrix\(\) : lights\[li\]\.getMatrix\(\)/.test(PBR));

// Added to the IBL, not replacing it: the ambient still fills the shadow side.
check('lights add to the environment rather than replacing it',
  /color \+= uExposure \* uLightCol\[i\] \* att \* NdL \* \(albedo \* 0\.31830989 \+ spec\);/.test(PBR));
check('...using GGX, the distribution the IBL already approximates',
  /float D = a2 \/ max\(3\.14159265 \* dd \* dd, 1e-6\);/.test(PBR),
  'a direct highlight and an environment reflection should describe one material');
// Raw inverse-square is correct and unusable at this scale: it would want intensities in the
// thousands and blow out the moment the light was nudged closer.
check('...with a falloff a person placing a light can predict',
  /float att = 1\.0 \/ \(1\.0 \+ dist2 \/ \(r \* r\)\);/.test(PBR),
  'full at the light, half at its range, smooth everywhere, never zero');

// The mock gl swallows anything it does not implement — that is exactly how the environment map
// went unbound for the whole life of the Three.js port. uniform1fv had no entry at all.
check('the mocked gl can carry a float ARRAY, which it previously could not',
  /uniform1fv: function\(loc, val\)/.test(SHMGR),
  'a missing entry in this mock is silent, which is how the IBL stayed dark');

console.log(fails ? '\n' + fails + ' FAILURE(S)' : '\nall checks passed');
process.exit(fails ? 1 : 0);
