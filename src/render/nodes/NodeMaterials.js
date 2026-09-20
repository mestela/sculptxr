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
