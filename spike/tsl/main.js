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
import { makeOurPBR } from './ourpbr.js';

// THREE MATERIALS, because the question has three parts. "Our BRDF, ported" is the only one
// that answers what the migration costs; the stock physical material is what we would get if
// we adopted three's instead, and matcap is where matt says he spends most of his time
// ("i'd spend most of my time in matcap mode, and only drop into pbr/shadows occasionally"),
// which makes it the mode that actually has to stay fast.
let MODES = ['ourpbr', 'physical', 'matcap'];
// ?modes=physical,matcap RESTRICTS THE SET, which is the whole experiment for the UBO error:
// a session that never instantiates our hand-written TSL material tells us whether the
// "uniform buffer too small" flood is three's XR path or ours. Desktop cannot answer it --
// switching all three at the heaviest weight there produces zero GL errors -- so it has to be
// asked on the device, and asked without our material in the room.
{
  const want = new URLSearchParams(location.search).get('modes');
  if (want) {
    const pick = want.split(',').map((x) => x.trim()).filter((x) => MODES.includes(x));
    if (pick.length) MODES = pick;
  }
}
let mode = 0;

const hud = (id) => document.getElementById(id);

// THE FIRST ERROR, WITH ITS CONTEXT, rather than a flood you have to correlate by eye. WebGL
// stops reporting after a few hundred, so the interesting one -- which material and weight was
// live when it started -- is the one that scrolls away first.
let firstGlError = null;
for (const k of ['error', 'warn', 'log']) {
  const orig = console[k].bind(console);
  console[k] = (...a) => {
    const line = a.map(String).join(' ');
    if (!firstGlError && /GL_INVALID|uniform buffer/.test(line)) {
      firstGlError = line;
      orig(`[tsl] FIRST GL ERROR while mat=${MODES[mode]} w=${weight} `
        + `xr=${renderer && renderer.xr.isPresenting} :: ${line}`);
    }
    orig(...a);
  };
}
const fail = (e) => { hud('err').textContent = String(e && e.stack || e); console.error(e); };

let renderer, scene, camera, group;
let frames = 0, acc = 0, last = performance.now();
let readoutCtx = null, readoutTex = null, lastLog = 0;
// Spheres and segments. Roughly 200k / 420k / 1.3M triangles — a modest sculpt, a heavy one,
// and past anything matt works at, so the curve is visible rather than a single point.
// VSYNC HIDES THE ANSWER. 13.9ms on a 72Hz GalaxyXR means "fast enough at this load", not
// "cheap" -- the frame could be costing 4ms or 13ms and look identical. So the weights run well
// past anything matt sculpts at: the number we actually want is where it STOPS holding 72, and
// that is the only way to see headroom through a vsync cap.
const WEIGHTS = [[24, 64], [48, 64], [48, 96], [96, 128], [192, 128], [384, 160]];
let weight = 0;
let worst = 0, samples = [];
// ONE MATERIAL, SHARED, because that is what the app does -- ShaderPBR is a single material
// across every mesh. Giving each sphere its own was the first version and it measured the
// wrong thing: 384 unique node materials, each compiling the first time it entered the
// frustum, which is exactly the hitch-on-head-turn matt saw. Flip window.__perObject to
// measure that deliberately; it is a real cost, just not one the app pays.
let sharedMat = null;
// PRE-CREATED, ALL OF THEM, AT STARTUP. matt's question: "surely we define materials once up
// front, and thats it?" -- which is exactly the app's pattern (ShaderManager caches one
// material per shader id). If the UBO error is pipeline CREATION mid-session then this avoids
// it and the blocker evaporates; if it is the REASSIGNMENT of a different material type onto
// an existing mesh, it will not, and the app hits it on every shader-mode change.
// ?lazy=1 restores the old behaviour so the two can be compared on the same device.
const LAZY = new URLSearchParams(location.search).get('lazy') === '1';
let matCache = null;

// THE NUMBERS HAVE TO BE IN THE HEADSET. The HTML HUD is a DOM overlay and immersive mode does
// not composite it, so the first version of this page could only be read on the desktop -- for
// a test whose whole purpose is the device. matt: "i couldn't see any numbers when i went into
// vr." A canvas texture welded in front of the camera is the only readout that survives.
function makeReadout() {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 256;
  readoutCtx = cv.getContext('2d');
  readoutTex = new THREE.CanvasTexture(cv);
  readoutTex.colorSpace = THREE.SRGBColorSpace;
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(0.4, 0.2),
    // Basic, not a node material: this is instrumentation and must not be affected by the
    // thing being measured.
    new THREE.MeshBasicMaterial({ map: readoutTex, transparent: true, depthTest: false })
  );
  plane.position.set(0, -0.12, -0.6);   // below the eyeline, out of the way of the scene
  plane.renderOrder = 999;
  camera.add(plane);
  // Children of a camera only render if the camera is in the graph.
  scene.add(camera);
}

function drawReadout(lines) {
  if (!readoutCtx) return;
  const c = readoutCtx;
  c.clearRect(0, 0, 512, 256);
  c.fillStyle = 'rgba(10,10,18,0.82)';
  c.fillRect(0, 0, 512, 256);
  c.font = '600 30px ui-monospace, Menlo, monospace';
  c.fillStyle = '#9fd0ff';
  lines.forEach((t, i) => c.fillText(t, 18, 46 + i * 40));
  readoutTex.needsUpdate = true;
}

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
  hud('load').onclick = () => {
    weight = (weight + 1) % WEIGHTS.length;
    if (weight === 0) { mode = (mode + 1) % MODES.length; sharedMat = null; }
    build(...WEIGHTS[weight]);
  };

  // On the headset the only way in is the console over remote debugging, so the pieces worth
  // poking are reachable by name.
  if (!LAZY) {
    preCreateMaterials();
    // WARMED: build one throwaway mesh per material and render it, so each pipeline is
    // compiled on the desktop side of Enter VR rather than the first time it is switched to.
    const warm = new THREE.Group();
    for (const m of Object.values(matCache)) {
      const w = new THREE.Mesh(new THREE.SphereGeometry(0.01, 4, 2), m);
      w.position.set(0, -99, 0);
      warm.add(w);
    }
    scene.add(warm);
    renderer.render(scene, camera);
    scene.remove(warm);
    warm.children.forEach((c) => c.geometry.dispose());
  }
  makeReadout();
  // Driveable from the console, so the UBO error can be bisected without a controller:
  // which material, which weight, and whether a SWITCH is needed to trigger it.
  window.__tsl = {
    renderer, scene, camera, group, build, THREE, MODES, WEIGHTS,
    setMode: (i) => { mode = i; sharedMat = null; build(...WEIGHTS[weight]); },
    setWeight: (i) => { weight = i; build(...WEIGHTS[weight]); },
    state: () => ({ mode: MODES[mode], weight, tris: renderer.info.render.triangles }),
  };
  renderer.setAnimationLoop(tick);
}

// A HAND-WRITTEN TSL MATERIAL, not just MeshStandardNodeMaterial: the question is what OUR
// shader would cost once ported, and a stock material would answer a different one. This is a
// stand-in for the per-vertex material channel work ShaderPBR does (COLOR_1 carries roughness
// and metalness per vertex), expressed as nodes rather than as GLSL.
// Every material type built once, before the session starts, so no pipeline is created while
// immersive. Warmed by a render so compilation happens here rather than on first use.
function preCreateMaterials() {
  matCache = {};
  for (const m of ['ourpbr', 'physical', 'matcap']) matCache[m] = buildMaterial(m, 0.55);
}

function makeMaterial(hue) {
  if (!LAZY && matCache) return matCache[MODES[mode]];
  return buildMaterial(MODES[mode], hue);
}

function buildMaterial(which, hue) {
  if (which === 'ourpbr') return makeOurPBR();
  if (which === 'matcap') {
    const mm = new THREE.MeshMatcapNodeMaterial();
    mm.color = new THREE.Color().setHSL(hue, 0.4, 0.7);
    return mm;
  }
  const m = new THREE.MeshPhysicalNodeMaterial();
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
    c.geometry.dispose();
    // Nothing in the cache is ever disposed: they outlive every rebuild, which is the point.
    const cached = matCache && Object.values(matCache).includes(c.material);
    if (!cached && c.material !== sharedMat) c.material.dispose();
    group.remove(c);
  }
  const geo = new THREE.SphereGeometry(0.18, seg, seg / 2);
  if (!sharedMat) sharedMat = makeMaterial(0.55);
  for (let i = 0; i < n; i++) {
    const mesh = new THREE.Mesh(geo, window.__perObject ? makeMaterial(i / n) : sharedMat);
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
    // THE SCENE WEIGHT HAS TO BE CHANGEABLE FROM INSIDE. The Heavier button is DOM, so in
    // immersive mode it is as unreachable as the HUD was -- and a spike you cannot vary on the
    // device only measures whatever it happened to boot with. Trigger cycles the presets.
    session.addEventListener('selectstart', () => {
      weight = (weight + 1) % WEIGHTS.length;
      // Wrapping the weights advances the MATERIAL, so one controller can walk the whole
      // matrix without a keyboard: six weights x three materials, in order.
      if (weight === 0) { mode = (mode + 1) % MODES.length; sharedMat = null; }
      const [n, seg] = WEIGHTS[weight];
      build(n, seg);
    });
    await renderer.xr.setSession(session);
    hud('err').textContent = '';
  } catch (e) { fail(e); }
}

// Frame time over a window, not instantaneous: a single frame says nothing and the number has
// to be comparable against xrPerf() in the app.
function tick() {
  const now = performance.now();
  const dt = now - last;
  acc += dt; last = now; frames++;
  // THE MEDIAN, not the min and not the mean. Min was wrong: it catches spurious short frames
  // and reported 153 and 551 fps, which are not real. Mean is dragged by the compile hitch on
  // a rebuild. The median ignores both ends and is the number that matches what the headset
  // actually feels like.
  samples.push(dt);
  if (dt > worst) worst = dt;
  group.rotation.y += 0.002;
  renderer.render(scene, camera);

  // SAMPLED AFTER THE RENDER. info.autoReset clears the counters at the start of each render,
  // so reading first reports zeros -- which is a HUD that lies rather than one that is empty.
  if (frames >= 30) {
    const sorted = samples.slice().sort((a, b) => a - b);
    const med = sorted[sorted.length >> 1];
    const ms = acc / frames;
    hud('ms').textContent = ms.toFixed(2);
    hud('fps').textContent = (1000 / ms).toFixed(0);
    const info = renderer.info.render;
    hud('draws').textContent = info.drawCalls;
    hud('tris').textContent = info.triangles.toLocaleString();

    const xr = renderer.xr.isPresenting;
    drawReadout([
      `${med.toFixed(2)} ms   ${(1000 / med).toFixed(0)} fps`,
      `${info.drawCalls} draws`,
      `${(info.triangles / 1000).toFixed(0)}k tris   w${weight}`,
      MODES[mode] + (firstGlError ? '  [GL ERR]' : ''),
      xr ? 'XR  (trigger = next weight)' : 'desktop',
    ]);
    // Once a second to the console as well, because that is the one place a number can be
    // COPIED out of a headset -- see the diagnostics rule.
    if (now - lastLog > 1000) {
      lastLog = now;
      console.log(`[tsl] med=${med.toFixed(2)}ms (${(1000 / med).toFixed(0)}fps) `
        + `mean=${ms.toFixed(2)} worst=${worst.toFixed(2)} `
        + `draws=${info.drawCalls} tris=${info.triangles} w=${weight} `
        + `mat=${MODES[mode]} ${LAZY ? 'lazy' : 'pre-created'} xr=${xr}`);
      worst = 0; samples.length = 0;
    }
    frames = 0; acc = 0;
  }
}

init().catch(fail);
