// NODE MATERIALS — the WebGPURenderer half of the shader layer (roadmap #2).
//
// WebGPURenderer cannot render a THREE.ShaderMaterial: its library registers only the built-in
// material types, and anything else logs "Material is not compatible" and draws nothing. So
// every shader mode needs a node equivalent before the flag is worth anything, and this is
// where they accumulate. ShaderManager routes to it when `?renderer=webgpu` is on; the legacy
// path is untouched.
//
// PRE-CREATED, ALL OF THEM, AT STARTUP. The spike measured the one real fault in this renderer:
// constructing a material DURING an immersive session produces
//   GL_INVALID_OPERATION: ... uniform buffer that is too small
// hundreds of times a frame until WebGL stops reporting, and everything measured after that is
// undefined. Building each type once before a session starts avoids it entirely. See
// spike/tsl/FINDINGS.md. This is exactly the trap the legacy cache would walk into: it also
// caches one material per shader id, but LAZILY, so the first switch to a mode builds one.
import Enums from '../../misc/Enums.js';
import ShaderMatcap from '../shaders/ShaderMatcap.js';
import { makePBR } from './NodePBR.js';

const NodeMaterials = {};

let gpu = null;              // the `three/webgpu` module — a SEPARATE build from the core three
let tsl = null;              // the `three/tsl` module — node expression helpers
let rotCorrectionUniform = null;  // mat3, head-centre, shared by every matcap mesh
let cache = null;            // shaderId -> material, built up front
const matcapTextures = [];   // index -> Texture, shared by every mesh using that matcap

NodeMaterials.isActive = () => !!gpu;

/**
 * Called once, right after the WebGPU renderer is initialised and before anything renders.
 * `mod` is the dynamically imported `three/webgpu`.
 */
NodeMaterials.enable = function (mod, tslMod) {
  gpu = mod;
  tsl = tslMod;
  cache = {};
  // A FLAT OPAQUE MATERIAL WITH NO TEXTURE, built up front so it can be swapped onto a panel
  // inside a session without constructing anything there (the one fault this renderer has).
  // It separates two invisibles that look identical: a quad drawn with a texture that never
  // uploaded is transparent, and a quad that is not drawn is also nothing. Swap this in and
  // a magenta rectangle either appears where the menu should be, or does not.
  NodeMaterials._solid = new mod.MeshBasicNodeMaterial({
    color: new mod.Color(0xff00ff), side: mod.DoubleSide,
    transparent: false, depthTest: false, depthWrite: false,
  });
  // Every mode gets a material now, including the ones still unported — a placeholder draws
  // something and keeps the scene legible, where a missing material draws black and looks
  // like a crash.
  for (const id of Object.values(Enums.Shader)) {
    if (typeof id === 'number') cache[id] = build(id);
  }
  return cache;
};

NodeMaterials.get = function (shaderId) {
  if (!cache) return null;
  return cache[shaderId] || cache[Enums.Shader.MATCAP] || null;
};

/** The matcap image for a given index, loaded once and shared. */
function matcapTexture(index) {
  const entry = ShaderMatcap.matcaps[index] || ShaderMatcap.matcaps[0];
  if (!entry) return null;
  if (matcapTextures[index]) return matcapTextures[index];
  const tex = new gpu.TextureLoader().load(entry.path);
  // The matcap images are authored in sRGB; saying so is the difference between the port
  // matching the legacy look and coming out washed out.
  tex.colorSpace = gpu.SRGBColorSpace;
  matcapTextures[index] = tex;
  return tex;
}

function build(shaderId) {
  if (shaderId === Enums.Shader.MATCAP) {
    // NOT MeshMatcapNodeMaterial. The stock node takes its UV from the raw per-eye view
    // normal, and in a headset that is a bug you can see: the two eyes look the matcap up at
    // different UVs, the highlight lands in a different place in each, and the disparity
    // fuses as depth -- frequently inverted against the geometry. matt saw it immediately.
    //
    // The legacy shader never had that, because it rotates the normal by uRotCorrection
    // first: a stabilised basis built ONCE PER FRAME from the head-centre view, so both eyes
    // share one lookup. Porting that uniform is the whole difference, and the maths is
    // ShaderMatcap.computeRotCorrection so there is exactly one copy of it.
    //
    // Built from MeshBasicNodeMaterial rather than the matcap node because the legacy shader
    // is unlit -- texture * vertex colour -- so basic is the faithful base, not a shortcut.
    const { uniform, texture, normalView, vec2, mat3, vertexColor } = tsl;
    if (!rotCorrectionUniform) rotCorrectionUniform = uniform(new gpu.Matrix3());
    const m = new gpu.MeshBasicNodeMaterial({ vertexColors: true });
    const n = mat3(rotCorrectionUniform).mul(normalView).normalize();
    // normal.xy * 0.5 + 0.5, exactly as the GLSL does it.
    const uvNode = vec2(n.x, n.y).mul(0.5).add(0.5);
    m.colorNode = texture(matcapTexture(0), uvNode).rgb.mul(vertexColor());
    m.userData.sculptShaderId = shaderId;
    return m;
  }

  if (shaderId === Enums.Shader.PBR) {
    // ?pbrbisect= — the control experiment for "menus vanish in pbr and nowhere else".
    //   1  PBR mode gets the PLACEHOLDER material, so no PBR material exists at all. Menus
    //      back => this material is the cause. Menus still gone => it is innocent and the
    //      fault is elsewhere in what shader=pbr turns on, which is a different search.
    //   2  the PBR material with NO uniform arrays. Menus back => the arrays.
    // Read straight off the URL rather than through getOptionsURL, which only knows the
    // options it declares.
    const b = parseInt(new URLSearchParams(location.search).get('pbrbisect') || '0', 10);
    if (b === 1) {
      const ph = new gpu.MeshNormalNodeMaterial();
      ph.userData.sculptShaderId = shaderId;
      ph.userData.placeholder = true;
      console.log('[NodeMaterials] pbrbisect=1 — PBR is the placeholder material');
      return ph;
    }
    if (b === 2) console.log('[NodeMaterials] pbrbisect=2 — PBR built with no uniform arrays');
    return makePBR(gpu, tsl, { noArrays: b === 2 });
  }

  // EVERYTHING ELSE IS STILL A PLACEHOLDER, deliberately visible rather than silently black:
  // normals read as shaded geometry, so the scene stays navigable and it is obvious at a
  // glance which modes are ported and which are not.
  const p = new gpu.MeshNormalNodeMaterial();
  p.userData.sculptShaderId = shaderId;
  p.userData.placeholder = true;
  return p;
}

// ── SMALL UNLIT MATERIALS THE UI IS MADE OF ──────────────────────────────────
// These are raw ShaderMaterials in the legacy path, which this renderer cannot draw, so the
// flagged path was hiding them -- and hiding them is why matt saw "no laser pointing when
// aiming at menus, [no] radius sphere" in BOTH matcap and pbr. They are a handful of lines
// each, so they port rather than wait.
//
// Each returns null when the node renderer is not active, so a call site reads
//   NodeMaterials.laser() || new THREE.ShaderMaterial({ ... })
// and the legacy path is untouched.

/** The controller ray: a white tube that fades out along its length. */
NodeMaterials.laser = function () {
  if (!gpu) return null;
  const { uv, float, vec3 } = tsl;
  const m = new gpu.MeshBasicNodeMaterial({
    transparent: true, depthTest: true, depthWrite: false,
    blending: gpu.NormalBlending, side: gpu.DoubleSide,
  });
  const fade = float(1.0).sub(uv().y.sub(0.5).mul(2.0).clamp(0.0, 1.0));
  m.colorNode = vec3(1.0, 1.0, 1.0);
  m.opacityNode = fade.mul(0.85);
  return m;
};

/**
 * A VR PANEL: a canvas texture, with the brightness/saturation/gamma grade.
 *
 * WHY THIS EXISTS AT ALL, rather than letting the stock MeshBasicMaterial convert. Measured
 * on device, inside one session, with 91 other objects hidden: a panel carrying the stock
 * conversion does not draw, and the same panel carrying MeshNormalNodeMaterial does. So does
 * our matcap material in a matcap session -- but that same matcap material assigned inside a
 * pbr session vanishes too. The common factor is the STOCK basic pipeline, which is what
 * "GL_INVALID_OPERATION: ... uniform buffer that is too small" is describing; a node material
 * with its own colorNode replaces that pipeline instead of extending it, and those all draw.
 *
 * It also gets the colour grade back. The legacy grade rides on onBeforeCompile, which
 * WebGPURenderer ignores entirely, so panels on the flagged path were ungraded regardless.
 * Here it is three uniforms, updated through userData.grade.
 */
NodeMaterials.panel = function (opts = {}) {
  if (!gpu) return null;
  const { texture, uniform, vec3, float, dot } = tsl;
  const placeholder = new gpu.Texture();
  const mapNode = texture(placeholder);
  const bright = uniform(1.0), sat = uniform(1.0), gamma = uniform(1.0);

  const m = new gpu.MeshBasicNodeMaterial({
    side: gpu.DoubleSide,
    transparent: true,
    depthWrite: opts.depthWrite !== false,
    depthTest: opts.depthTest !== false,
  });
  const rgb = mapNode.rgb.mul(bright).toVar();
  const lum = dot(rgb, vec3(0.299, 0.587, 0.114));
  const satd = vec3(lum).add(rgb.sub(vec3(lum)).mul(sat)).clamp(0.0, 1.0);
  m.colorNode = satd.pow(vec3(gamma));
  m.opacityNode = mapNode.a;
  // The texture arrives later, on the panel's first paint. Swapping the NODE's value keeps
  // one pipeline for the life of the panel, which is the same rule the legacy path follows
  // ("Only the FIRST texture changes the material").
  m.userData.setMap = (t) => { if (t) mapNode.value = t; };
  m.userData.grade = { bright, sat, gamma };
  m.userData.isNodePanel = true;
  return m;
};

/** The voxel brush's volume cursor: an additive rim glow. */
NodeMaterials.fresnelGlow = function (hex) {
  if (!gpu) return null;
  const { normalView, positionView, normalize, dot, abs, pow, float, vec3 } = tsl;
  const m = new gpu.MeshBasicNodeMaterial({
    transparent: true, depthTest: true, depthWrite: false, side: gpu.DoubleSide,
    blending: gpu.CustomBlending, blendEquation: gpu.AddEquation,
    blendSrc: gpu.OneFactor, blendDst: gpu.OneFactor,
  });
  const f = pow(float(1.0).sub(abs(dot(normalize(normalView), normalize(positionView)))), 3.0);
  m.colorNode = vec3(new gpu.Color(hex)).mul(f);
  m.opacityNode = f;
  return m;
};

/**
 * WARM EVERY PIPELINE BEFORE THE SESSION STARTS.
 *
 * This renderer's one real fault, measured in the spike: building a material DURING an
 * immersive session floods
 *   GL_INVALID_OPERATION: ... uniform buffer that is too small
 * until WebGL stops reporting, and whatever was mid-draw is lost. Pre-CREATING avoids it only
 * if the pipeline is also COMPILED, and a pipeline is compiled the first time the material is
 * actually drawn -- which is why the spike rendered a throwaway mesh per material before
 * Enter VR rather than just constructing them.
 *
 * THE PANELS ARE THE ONES THAT MATTER, and the reason this was missed. Every other material
 * is drawn on the desktop long before anyone enters VR, so it warms itself. The VR panels are
 * never drawn outside a session, so their pipelines are always built INSIDE one -- they are
 * the first thing to hit the fault and the first thing to disappear. matt: menus present in
 * matcap, gone in pbr, and gone with the PBR material removed entirely, which is what finally
 * ruled the material out and pointed here.
 *
 * Cheap and idempotent: a 2-triangle quad per material, off-screen, once.
 */
NodeMaterials.warm = function (renderer, camera, extraMaterials) {
  if (!gpu || !renderer) return 0;
  const mats = [];
  for (const id in cache) if (cache[id]) mats.push(cache[id]);
  if (NodeMaterials._solid) mats.push(NodeMaterials._solid);
  if (extraMaterials) for (const m of extraMaterials) if (m) mats.push(m);
  if (!mats.length) return 0;

  const sc = new gpu.Scene();
  const geo = new gpu.PlaneGeometry(0.001, 0.001);
  // A colour attribute, because several of these read vertexColor() and a material warmed
  // without one compiles a DIFFERENT pipeline to the one the sculpt will ask for.
  const n = geo.attributes.position.count;
  geo.setAttribute('color', new gpu.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  geo.setAttribute('aMaterial', new gpu.BufferAttribute(new Float32Array(n * 3), 3));
  for (const m of mats) {
    const mesh = new gpu.Mesh(geo, m);
    mesh.position.set(0, 0, -0.05);
    mesh.frustumCulled = false;
    sc.add(mesh);
  }
  try {
    renderer.render(sc, camera);
  } catch (e) {
    console.warn('[NodeMaterials] warm failed', e);
  }
  sc.clear();
  geo.dispose();
  console.log('[NodeMaterials] warmed ' + mats.length + ' pipelines');
  return mats.length;
};

/**
 * Per frame, before rendering. Refreshes the one uniform the matcap needs from the
 * HEAD-CENTRE view -- deliberately not per eye, which is the entire point of it.
 */
NodeMaterials.updateFrame = function (main) {
  if (!rotCorrectionUniform || !main) return;
  const cam = main.getCamera && main.getCamera();
  if (!cam) return;
  const c = ShaderMatcap.computeRotCorrection(cam.getView());
  rotCorrectionUniform.value.fromArray(c);
  // Each material that needs per-frame state says so by hanging updateFrame on userData,
  // rather than this file knowing what every shader wants.
  for (const id in cache) {
    const f = cache[id] && cache[id].userData && cache[id].userData.updateFrame;
    if (f) f(main);
  }
};

export default NodeMaterials;
