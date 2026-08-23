// Structural regression checks for the global, persistent viewport shader mode.
import fs from 'fs';

const root = '/Users/mattestela/sculptxr/src/';
const read = path => fs.readFileSync(root + path, 'utf8');
const options = read('misc/getOptionsURL.js');
const scene = read('Scene.js');
const desktop = read('gui/GuiRendering.js');
const legacyVR = read('gui/vr/GuiVRRendering.js');
const htmlVR = read('gui/htmlvr/MainMenuPanel.js');
const vrTools = read('gui/vr/GuiVRTools.js');
const sculptGL = read('SculptGL.js');
const meshSource = read('mesh/Mesh.js');
const multimeshSource = read('mesh/multiresolution/Multimesh.js');
const importSGL = read('files/ImportSGL.js');
const skin = read('editing/SkinMesh.js');

let fails = 0;
const check = (name, ok) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}`);
  if (!ok) fails++;
};

check('every user-facing shader mode has a persistent name',
  ['MATCAP', 'FLAT', 'NORMAL', 'UV'].every(mode =>
    options.includes(`shader === Enums.Shader.${mode}`)) && options.includes("return 'pbr'"));
check('global setter persists the mode and keeps the live value numeric',
  /saveOption\('shader', getOptionsURL\.shaderName\(shader\)\)/.test(options) &&
  /getOptionsURL\(\)\.shader = shader/.test(options));
check('global setter excludes rig and reference display helpers',
  /mesh\._isBone \|\| mesh\._isNull \|\| mesh\._isReference/.test(options));
check('desktop and both VR rendering panels use the global setter',
  desktop.includes('getOptionsURL.setGlobalShader(main, val)') &&
  legacyVR.includes('getOptionsURL.setGlobalShader(main, id)') &&
  htmlVR.includes('getOptionsURL.setGlobalShader(main, id)'));
check('rendering panels display the global mode rather than selected mesh state',
  desktop.includes('this._ctrlShaders.setValue(getOptionsURL().shader') &&
  legacyVR.includes('const shaderType = getOptionsURL().shader') &&
  htmlVR.includes('const shaderType   = getOptionsURL().shader'));
check('new, replacement and imported meshes receive the global mode',
  (scene.match(/setShaderType\(getOptionsURL\(\)\.shader\)/g) || []).length >= 2 &&
  scene.includes('getOptionsURL.setGlobalShader(this, getOptionsURL().shader)') &&
  scene.includes('getOptionsURL.setGlobalFlatShading(this, getOptionsURL().flatshading)') &&
  scene.includes('getOptionsURL.setGlobalWireframe(this, getOptionsURL().wireframe)'));
check('generated skins no longer force matcap',
  !/mesh\.setShaderType\(Enums\.Shader\.MATCAP\)/.test(skin));
check('flat shading and wireframe have persistent global setters',
  options.includes("saveOption('flatshading', enabled)") &&
  options.includes("saveOption('wireframe', enabled)") &&
  options.includes('mesh.setFlatShading(enabled)') &&
  options.includes('mesh.setShowWireframe(enabled)'));
check('desktop and both VR panels use global display toggles',
  desktop.includes('setGlobalFlatShading(this._main, bool)') &&
  desktop.includes('setGlobalWireframe(this._main, bool)') &&
  legacyVR.includes('setGlobalFlatShading(main, target)') &&
  legacyVR.includes('setGlobalWireframe(main, target)') &&
  htmlVR.includes('setGlobalFlatShading(main, t)') &&
  htmlVR.includes('setGlobalWireframe(main, t)'));
check('tool-panel and debug wireframe shortcuts also use the global setting',
  vrTools.includes('setGlobalFlatShading(main, !getOptionsURL().flatshading)') &&
  (vrTools.match(/setGlobalWireframe\(main, !getOptionsURL\(\)\.wireframe\)/g) || []).length >= 2 &&
  sculptGL.includes('setGlobalWireframe(this, !getOptionsURL().wireframe)'));
check('new and replacement meshes inherit global display toggles',
  (scene.match(/setFlatShading\?\.\(getOptionsURL\(\)\.flatshading\)/g) || []).length >= 2 &&
  (scene.match(/setShowWireframe\?\.\(getOptionsURL\(\)\.wireframe\)/g) || []).length >= 2);
check('wireframe overlays self-heal attachment after restore',
  meshSource.includes('wireMesh.parent !== solidMesh') &&
  meshSource.includes('solidMesh.add(wireMesh)'));
check('multires wireframes always use indices matching indexed positions',
  (multimeshSource.match(/getWireframe\(true\)/g) || []).length >= 3 &&
  !/indices = activeMesh\.getWireframe\(\)/.test(multimeshSource));
check('loaded multires levels share the visible render object',
  importSGL.includes('lvlN.setRenderData(mm.getRenderData())') &&
  importSGL.includes('lvlN.setTransformData(mm.getTransformData())') &&
  !/mm\._meshes\[L\]\.initThreeMesh/.test(importSGL));

if (fails) process.exit(1);
console.log('global shader tests passed');
