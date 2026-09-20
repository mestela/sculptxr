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
  // THE CONTROLLER MODELS' MATERIAL, built here because theirs cannot be.
  //
  // XRControllerModelFactory fetches the GLTF when the controller connects, i.e. inside the
  // session, so its MeshStandardMaterials are first drawn there -- and the trace shows that
  // draw (L_body) is the first thing to fail, taking the rest of the frame with it. Nothing
  // can warm a material that does not exist yet, so the model is given one that already
  // has a pipeline instead.
  //
  // Shaded off the view normal so the model still reads as a three-dimensional object rather
  // than a silhouette; the real GLTF materials are a nicety and this is the flagged path.
  NodeMaterials._controller = (() => {
    const { normalView, vec3, float, dot } = tslMod;
    const m = new mod.MeshLambertNodeMaterial();
    const nl = dot(normalView.normalize(), vec3(0.0, 0.0, 1.0)).abs();
    m.colorNode = vec3(0, 0, 0);
    m.emissiveNode = vec3(0.32, 0.34, 0.38).mul(float(0.45).add(nl.mul(0.55)));
    return m;
  })();

  NodeMaterials._solid = (() => {
    const m = new mod.MeshLambertNodeMaterial({
      side: mod.DoubleSide, transparent: false, depthTest: false, depthWrite: false,
    });
    m.colorNode = tslMod.vec3(0, 0, 0);
    m.emissiveNode = tslMod.vec3(1, 0, 1);
    return m;
  })();
  // Every mode gets a material now, including the ones still unported — a placeholder draws
  // something and keeps the scene legible, where a missing material draws black and looks
  // like a crash.
  for (const id of Object.values(Enums.Shader)) {
    if (typeof id === 'number') cache[id] = build(id);
  }
  // Built here so they exist before any session and are covered by the warm pass.
  NodeMaterials.buildPanelVariants();
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
    // Built as an unlit material rather than the matcap node because the legacy shader is
    // unlit -- texture * vertex colour -- so that is the faithful shape, not a shortcut.
    // (See unlit(): the base is Lambert-with-black-diffuse, because MeshBasicNodeMaterial is
    // the class this backend cannot draw in XR.)
    const { uniform, texture, normalView, vec2, mat3, vertexColor } = tsl;
    if (!rotCorrectionUniform) rotCorrectionUniform = uniform(new gpu.Matrix3());
    const m = unlit({ vertexColors: true });
    const n = mat3(rotCorrectionUniform).mul(normalView).normalize();
    // normal.xy * 0.5 + 0.5, exactly as the GLSL does it.
    const uvNode = vec2(n.x, n.y).mul(0.5).add(0.5);
    m.emissiveNode = texture(matcapTexture(0), uvNode).rgb.mul(vertexColor());
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

/**
 * Give a freshly-loaded controller model a pipeline that already exists.
 * Returns how many materials were replaced.
 */
NodeMaterials.adoptController = function (root) {
  if (!gpu || !root || !NodeMaterials._controller) return 0;
  let n = 0;
  root.traverse((o) => {
    if (!o.material) return;
    if (o.material === NodeMaterials._controller) return;
    o.material = NodeMaterials._controller;
    n++;
  });
  return n;
};

/**
 * A FLAT UNLIT MATERIAL, as a node material rather than a stock MeshBasicMaterial.
 *
 * Bisection named `stylus_spike` -- `new THREE.MeshBasicMaterial({ color: 0x4d4d4d })` on an
 * indexed CylinderGeometry -- as the object that starts the drawElements flood, once the line
 * strips were gone. Nothing is unusual about it; it is as plain as a material gets. What it
 * has in common with the other failures is that it is a STOCK material left for the renderer
 * to convert, while everything that draws (our matcap, our PBR, MeshNormalNodeMaterial) carries
 * its own colorNode.
 *
 * That hypothesis was raised and dropped earlier, when giving the panels a colorNode did not
 * fix them -- but at that point the frame was already being poisoned by a THREE.Line, so the
 * test could not have succeeded. It deserves its second hearing.
 */
NodeMaterials.basic = function (hex, opts = {}) {
  if (!gpu) return null;
  const { uniform, vec3 } = tsl;
  const m = unlit({
    transparent: !!opts.transparent,
    opacity: opts.opacity === undefined ? 1 : opts.opacity,
    depthTest: opts.depthTest !== false,
    depthWrite: opts.depthWrite !== false,
    side: opts.side || gpu.FrontSide,
  });
  const col = uniform(new gpu.Color(hex));
  m.emissiveNode = vec3(col);
  if (opts.opacity !== undefined && opts.opacity !== 1) m.opacityNode = tsl.float(opts.opacity);
  // Legacy call sites set material.color.set(...); keep that working against the same object.
  m.color = col.value;
  m.uniforms = { color: col };
  return m;
};

/**
 * PANEL MATERIAL VARIANTS, from known-good to the real thing, one feature at a time.
 *
 * matt's method, and the right one: MeshNormalNodeMaterial drew on the panel even while the
 * frame was being poisoned by a THREE.Line, so it is immune to whatever this is. Start from
 * that and add features until the immunity breaks -- rather than starting from the broken
 * material and guessing at causes, which is what the last dozen rounds were.
 *
 * ALL BUILT AT STARTUP AND WARMED, so stepping through them costs one session rather than one
 * per variant -- and so nothing is constructed inside a session, which this renderer punishes.
 *
 *   0 MeshNormalNodeMaterial          the known-good baseline
 *   1 flat colour, opaque             the simplest possible node material
 *   2 flat colour, transparent        + the transparent flag and its blending
 *   3 flat colour, transparent, alpha + an opacityNode
 *   4 texture, opaque                 + sampling the panel's canvas
 *   5 texture, transparent, alpha     + both together
 *   6 the real panel material         + the brightness/saturation/gamma grade
 */
NodeMaterials.buildPanelVariants = function () {
  if (!gpu || NodeMaterials._panelVariants) return NodeMaterials._panelVariants;
  const { texture, vec3, float } = tsl;
  const list = [];
  const mk = (fn) => { const m = fn(); list.push(m); return m; };

  mk(() => new gpu.MeshNormalNodeMaterial());

  mk(() => { const m = new gpu.MeshBasicNodeMaterial(); m.colorNode = vec3(0.2, 0.8, 0.4); return m; });

  mk(() => {
    const m = new gpu.MeshBasicNodeMaterial({ transparent: true });
    m.colorNode = vec3(0.2, 0.8, 0.4); return m;
  });

  mk(() => {
    const m = new gpu.MeshBasicNodeMaterial({ transparent: true });
    m.colorNode = vec3(0.2, 0.8, 0.4); m.opacityNode = float(0.85); return m;
  });

  for (const withAlpha of [false, true]) {
    mk(() => {
      const m = new gpu.MeshBasicNodeMaterial({ transparent: withAlpha });
      const t = new gpu.Texture();
      const node = texture(t);
      m.colorNode = node.rgb;
      if (withAlpha) m.opacityNode = node.a;
      m.userData.setMap = (x) => { if (x) node.value = x; };
      return m;
    });
  }

  list.push(NodeMaterials.panel({ depthWrite: true, depthTest: true }));

  // ── 7..11: THE SAME FLAT COLOUR ON A DIFFERENT BASE CLASS ──────────────────
  // The ladder localised it: variant 0 (MeshNormalNodeMaterial) draws with ZERO errors, and
  // variant 1 -- the simplest possible MeshBasicNodeMaterial, flat colour, opaque, no texture
  // and no transparency -- produces 50. So it is not the texture, the alpha or the grade:
  // MeshBasicNodeMaterial itself is what this backend cannot draw in XR.
  //
  // Which retroactively explains every "culprit" found by bisection. stylus_spike was a stock
  // MeshBasicMaterial, and three converts that to MeshBasicNodeMaterial; volume_sphere and
  // the panels are the same class; and each time I "ported" one I moved it onto the broken
  // class and it stayed broken.
  //
  // So the question is which base class CAN carry a flat colour here. These are the
  // candidates, unlit-ish or cheap, each given the same flat colour by whatever route its
  // class provides.
  mk(() => { const m = new gpu.MeshNormalNodeMaterial(); m.colorNode = vec3(0.9, 0.4, 0.1); return m; });
  mk(() => {
    const m = new gpu.MeshLambertNodeMaterial();
    m.colorNode = vec3(0.0); m.emissiveNode = vec3(0.2, 0.8, 0.4); return m;
  });
  mk(() => {
    const m = new gpu.MeshPhongNodeMaterial();
    m.colorNode = vec3(0.0); m.emissiveNode = vec3(0.2, 0.8, 0.4); return m;
  });
  mk(() => {
    const m = new gpu.MeshStandardNodeMaterial();
    m.colorNode = vec3(0.0); m.emissiveNode = vec3(0.2, 0.8, 0.4); return m;
  });
  mk(() => {
    const m = new gpu.MeshMatcapNodeMaterial();
    m.colorNode = vec3(0.2, 0.8, 0.4); return m;
  });

  NodeMaterials._panelVariants = list;
  return list;
};

/** The controller ray: a white tube that fades out along its length. */
NodeMaterials.laser = function () {
  if (!gpu) return null;
  const { uv, float, vec3 } = tsl;
  const m = unlit({
    transparent: true, depthTest: true, depthWrite: false,
    blending: gpu.NormalBlending, side: gpu.DoubleSide,
  });
  const fade = float(1.0).sub(uv().y.sub(0.5).mul(2.0).clamp(0.0, 1.0));
  m.emissiveNode = vec3(1.0, 1.0, 1.0);
  m.opacityNode = fade.mul(0.85);
  return m;
};


// ── THE UNLIT BASE, AND WHY IT IS NOT MeshBasicNodeMaterial ──────────────────
//
// Measured on device with the panel ladder -- one panel, an otherwise empty frame, three draw
// calls, only the material changing between rungs:
//
//   MeshBasicNodeMaterial, flat colour, opaque, no texture   44-104 errors
//   MeshNormalNodeMaterial                                        0
//   MeshLambertNodeMaterial  + emissive                           0
//   MeshPhongNodeMaterial    + emissive                           0
//   MeshStandardNodeMaterial + emissive                           0
//   MeshMatcapNodeMaterial                                        0
//
// MeshBasicNodeMaterial is the one class this backend cannot draw in an XR session, and it is
// the class three converts every stock MeshBasicMaterial into. That is the whole bug, and it
// is why every earlier "fix" failed: the panels, the volume cursor, the stylus spike and the
// laser were all moved BETWEEN two names for the same broken class.
//
// MeshNormalNodeMaterial scores zero but ignores colorNode (verified on desktop: it draws
// normals whatever colour you give it), so the replacement is Lambert with the diffuse
// forced to black and the real output on emissiveNode -- emissive is added unlit, so the
// result is exactly the colour asked for, with no lighting response.
function unlit(opts = {}) {
  const m = new gpu.MeshLambertNodeMaterial(opts);
  m.colorNode = tsl.vec3(0, 0, 0);   // no diffuse response; everything rides on emissiveNode
  return m;
}

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

  const m = unlit({
    side: gpu.DoubleSide,
    transparent: true,
    depthWrite: opts.depthWrite !== false,
    depthTest: opts.depthTest !== false,
  });
  const rgb = mapNode.rgb.mul(bright).toVar();
  const lum = dot(rgb, vec3(0.299, 0.587, 0.114));
  const satd = vec3(lum).add(rgb.sub(vec3(lum)).mul(sat)).clamp(0.0, 1.0);
  m.emissiveNode = satd.pow(vec3(gamma));
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
  const m = unlit({
    transparent: true, depthTest: true, depthWrite: false, side: gpu.DoubleSide,
    // AdditiveBlending, not CustomBlending with explicit One/One factors. They are the same
    // equation, but the explicit form was copied literally from the GLSL material and it is
    // the less-travelled path through this backend -- and the trace has volume_sphere
    // emitting 0x502 AND 0x506 (INVALID_FRAMEBUFFER_OPERATION) right after the port put a
    // node material on it. Worth removing as a variable before anything else is read into
    // that draw.
    blending: gpu.AdditiveBlending,
  });
  const f = pow(float(1.0).sub(abs(dot(normalize(normalView), normalize(positionView)))), 3.0);
  // A UNIFORM, not a baked constant: _updateVRCursors recolours this every frame (blue, red
  // for negative, the paint colour while painting) through `material.uniforms.color.value`.
  // Baking the colour in threw "Cannot read properties of undefined (reading 'color')" out of
  // the cursor update, hundreds of times a second.
  const col = tsl.uniform(new gpu.Color(hex));
  m.emissiveNode = col.mul(f);
  m.opacityNode = f;
  // The legacy call sites write through material.uniforms.color.value, and a uniform node
  // holds its Color at exactly that path -- so the shim is the real object, not a copy, and
  // there is no second place for the colour to live.
  m.uniforms = { color: col };
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
NodeMaterials.warm = function (renderer, camera, extraMaterials, scene) {
  if (!gpu || !renderer) return 0;
  const mats = [];
  const seen = new Set();
  const add = (m) => { if (m && !seen.has(m)) { seen.add(m); mats.push(m); } };
  for (const id in cache) add(cache[id]);
  add(NodeMaterials._solid);
  add(NodeMaterials._controller);
  for (const v of (NodeMaterials._panelVariants || [])) add(v);
  if (extraMaterials) for (const m of extraMaterials) add(m);
  // EVERY MATERIAL ALREADY IN THE SCENE, not just ours.
  //
  // Traced on device: the first failing draw in a session is L_body -- a GLTF CONTROLLER
  // MODEL on a stock MeshStandardMaterial -- and it emits 0x506
  // (INVALID_FRAMEBUFFER_OPERATION) as well as the UBO error. stylus_spike follows, then the
  // panel. So the panels were third in line and collateral all along.
  //
  // The rule this renderer enforces is not "do not CREATE a material in a session", it is
  // "do not first DRAW one in a session" -- that is when the pipeline is built. Anything
  // VR-only is therefore drawn for the first time inside the session, which is every object
  // this trace named. Warming the node cache alone was too narrow.
  if (scene) scene.traverse((o) => {
    const m = o.material;
    if (!m) return;
    if (Array.isArray(m)) m.forEach(add); else add(m);
  });
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
