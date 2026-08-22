import * as glm from 'gl-matrix';
const { mat4 } = glm;

let failures = 0;
const check = (name, ok) => {
  console.log((ok ? '  ok   ' : '  FAIL ') + name);
  if (!ok) failures++;
};

globalThis.window = {
  _animFPS: 24,
  _animLoopStart: 1,
  _animLoopEnd: 2,
  _animMasterDuration: 10,
  _animPlaying: false,
  _animCurrentTime: 1,
  location: { search: '' },
  navigator: { language: 'en' },
  localStorage: { getItem: () => null, setItem: () => {} },
};
globalThis.self = globalThis;
window.glMatrix = glm;

const makeJoint = (id, name, parent, x, scale = 1) => {
  const local = mat4.create();
  mat4.scale(local, local, [scale, scale, scale]);
  local[12] = x;
  const joint = {
    _isBone: true,
    _permanentStaticLabel: name,
    _parentMesh: parent,
    getID: () => id,
    getMatrix: () => local,
    getModelSpaceMatrix: () => {
      if (!parent) return local;
      return mat4.multiply(mat4.create(), parent.getModelSpaceMatrix(), local);
    },
    getVertices: () => new Float32Array(),
    getTriangles: () => new Uint32Array(),
    getNbVertices: () => 0,
    getNbTriangles: () => 0,
    updateMatrices: () => {},
  };
  return joint;
};

const root = makeJoint(1, 'hips', null, 0, 0.04);
const child = makeJoint(2, 'head', root, 25);
const sceneMeshes = [root, child];
const main = { getMeshes: () => sceneMeshes, _meshes: sceneMeshes, _camera: {} };
const registry = {
  globalPlaybackTime: 1,
  tracks: new Map(),
  update(mesh) {
    if (mesh === child) child.getMatrix()[12] = this.globalPlaybackTime * 25;
  },
};
window._animationRegistry = registry;
window.app = main;

const { default: ExportGLTF } = await import('../src/files/ExportGLTF.js');
const blob = ExportGLTF.exportGLB(sceneMeshes, { bake: true, main });
const bytes = new Uint8Array(await blob.arrayBuffer());
const view = new DataView(bytes.buffer);
const jsonLen = view.getUint32(12, true);
const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLen)).trim());

const hipsNode = json.nodes.findIndex((n) => n.name === 'hips');
const headNode = json.nodes.findIndex((n) => n.name === 'head');
const solved = json.animations.find((a) => a.name === 'SolvedRig');
check('bone-only GLB contains named bone nodes', hipsNode >= 0 && headNode >= 0);
check('bone hierarchy is preserved', json.nodes[hipsNode].children?.includes(headNode));
check('one solved clip drives TRS on every bone', solved?.channels.length === 6);
check('rig controls do not leak locator meshes or source clips',
  json.animations.length === 1 && !json.meshes.some((m) => /^Mesh_/.test(m.name || '')));
check('exported skeleton strips viewport locator scale',
  json.nodes[hipsNode].scale.every((v) => Math.abs(v - 1) < 1e-5)
    && json.nodes[headNode].scale.every((v) => Math.abs(v - 1) < 1e-5));
const exportedY = glm.vec3.transformQuat(glm.vec3.create(), [0, 1, 0], json.nodes[hipsNode].rotation);
check('exported bone +Y axis aims from parent to child',
  Math.abs(exportedY[0] - 1) < 1e-5 && Math.abs(exportedY[1]) < 1e-5 && Math.abs(exportedY[2]) < 1e-5
    && Math.abs(json.nodes[headNode].translation[1] - 1) < 1e-5);
check('clip uses playback range at project FPS',
  json.accessors[solved.samplers[0].input].count === 25
    && json.accessors[solved.samplers[0].input].max[0] === 1);
check('bone-only GLB includes a visible skinned line preview',
  json.skins?.length === 1 && json.nodes.some((n) => n.name === 'SkeletonPreview' && n.skin === 0)
    && json.meshes.some((m) => m.name === 'SkeletonPreview' && m.primitives[0].mode === 1));
check('export restores the live scene pose and clock',
  child.getMatrix()[12] === 25 && registry.globalPlaybackTime === 1 && window._animCurrentTime === 1);

// Parse the finished binary through Three's production loader too. Structural JSON checks can
// miss accessor/skin relationships that only fail when a real importer resolves them.
globalThis.ProgressEvent = globalThis.ProgressEvent || class ProgressEvent {};
const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
const loaded = await new Promise((resolve, reject) => new GLTFLoader().parse(bytes.buffer, '', resolve, reject));
check('Three GLTFLoader accepts the complete binary',
  loaded.animations.length === 1 && loaded.scene.getObjectByName('hips') && loaded.scene.getObjectByName('head'));

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
