// TSL SPIKE — does WebGPURenderer run WebXR on our devices, and at what cost?
//
// Standalone on purpose. WebGPURenderer cannot render a THREE.ShaderMaterial at all (its
// library registers only the built-in material types), so there is no incremental path where
// the app keeps working while shaders are ported one at a time -- the renderer swap is a single
// flip and everything must be ready on the far side of it. That makes "is it viable" a question
// worth answering for £0 rather than after porting seventeen shaders.
//
// WHAT THIS ANSWERS
//   1. Does WebGPURenderer enter an immersive session on the GalaxyXR and the Vision Pro?
//      In three 0.183.2 it THROWS on a WebGPU backend, so it must run forceWebGL -- verified
//      in three.webgpu.js: "XR is currently not supported with a WebGPU backend."
//   2. What does it cost per frame, against a poly count like a real sculpt?
//
// WHAT IT DOES NOT ANSWER: panel rasterisation cost (that is the app's HTML panels, and it is a
// PROD-build-only effect), and whether our exact BRDF ports cleanly. Those come after.
import * as THREE from 'three/webgpu';
import { Fn, positionLocal, normalLocal, uniform, vec3, float } from 'three/tsl';

const hud = (id) => document.getElementById(id);
const fail = (e) => { hud('err').textContent = String(e && e.stack || e); console.error(e); };

let renderer, scene, camera, group;
let frames = 0, acc = 0, last = performance.now();

async function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0b10);

  camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.01, 1000);
  camera.position.set(0, 1.5, 3);

  // forceWebGL because XR is the whole point and the WebGPU backend refuses it in this version.
  // If that restriction lifts, dropping this line is the entire change.
  renderer = new THREE.WebGPURenderer({ antialias: false, forceWebGL: true });
  renderer.setPixelRatio(1);
  renderer.setSize(innerWidth, innerHeight);
  renderer.xr.enabled = true;
  document.body.appendChild(renderer.domElement);
  await renderer.init();

  hud('backend').textContent = renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL (forced)';

  // Lights the node materials actually respond to — the point of the exercise is the shading
  // cost, so this is deliberately a working lighting rig rather than one lamp.
  scene.add(new THREE.HemisphereLight(0x8899ff, 0x202028, 0.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.0); key.position.set(3, 5, 2);
  scene.add(key);
  for (let i = 0; i < 3; i++) {
    const p = new THREE.PointLight(new THREE.Color().setHSL(i / 3, 0.7, 0.6), 30, 20);
    p.position.set(Math.cos(i * 2.1) * 2.5, 1.2 + i * 0.4, Math.sin(i * 2.1) * 2.5);
    scene.add(p);
  }

  group = new THREE.Group();
  scene.add(group);
  build(24, 64);   // ~200k tris, a modest sculpt

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  hud('xr').onclick = enterXR;
  hud('load').onclick = () => build(48, 96);   // ~1.3M tris

  // On the headset the only way in is the console over remote debugging, so the pieces worth
  // poking are reachable by name.
  window.__tsl = { renderer, scene, camera, group, build, THREE };
  renderer.setAnimationLoop(tick);
}

// A HAND-WRITTEN TSL MATERIAL, not just MeshStandardNodeMaterial: the question is what OUR
// shader would cost once ported, and a stock material would answer a different one. This is a
// stand-in for the per-vertex material channel work ShaderPBR does (COLOR_1 carries roughness
// and metalness per vertex), expressed as nodes rather than as GLSL.
function makeMaterial(hue) {
  const m = new THREE.MeshStandardNodeMaterial();
  const tint = uniform(new THREE.Color().setHSL(hue, 0.5, 0.55));
  // Cheap procedural variation so the fragment stage is doing real work rather than
  // returning a constant, which would flatter the measurement.
  m.colorNode = Fn(() => {
    const n = normalLocal.normalize();
    const band = positionLocal.y.mul(8.0).sin().mul(0.5).add(0.5);
    return vec3(tint).mul(float(0.65).add(band.mul(0.35))).mul(n.y.abs().mul(0.4).add(0.6));
  })();
  m.roughnessNode = positionLocal.y.mul(4.0).sin().mul(0.25).add(0.45);
  m.metalnessNode = float(0.1);
  return m;
}

function build(n, seg) {
  while (group.children.length) {
    const c = group.children.pop();
    c.geometry.dispose(); c.material.dispose(); group.remove(c);
  }
  const geo = new THREE.SphereGeometry(0.18, seg, seg / 2);
  for (let i = 0; i < n; i++) {
    const mesh = new THREE.Mesh(geo, makeMaterial(i / n));
    const a = (i / n) * Math.PI * 2, r = 1.1 + (i % 3) * 0.45;
    mesh.position.set(Math.cos(a) * r, 1.0 + Math.sin(i * 1.7) * 0.5, Math.sin(a) * r);
    group.add(mesh);
  }
}

async function enterXR() {
  try {
    if (!navigator.xr) throw new Error('navigator.xr missing — not an XR browser');
    const session = await navigator.xr.requestSession('immersive-vr', {
      optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'],
    });
    await renderer.xr.setSession(session);
    hud('err').textContent = '';
  } catch (e) { fail(e); }
}

// Frame time over a window, not instantaneous: a single frame says nothing and the number has
// to be comparable against xrPerf() in the app.
function tick() {
  const now = performance.now();
  acc += now - last; last = now; frames++;
  group.rotation.y += 0.002;
  renderer.render(scene, camera);

  // SAMPLED AFTER THE RENDER. info.autoReset clears the counters at the start of each render,
  // so reading first reports zeros -- which is a HUD that lies rather than one that is empty.
  if (frames >= 30) {
    const ms = acc / frames;
    hud('ms').textContent = ms.toFixed(2);
    hud('fps').textContent = (1000 / ms).toFixed(0);
    const info = renderer.info.render;
    hud('draws').textContent = info.drawCalls;
    hud('tris').textContent = info.triangles.toLocaleString();
    frames = 0; acc = 0;
  }
}

init().catch(fail);
