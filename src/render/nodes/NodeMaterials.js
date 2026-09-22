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
import { makePhysical } from './NodePhysical.js';

const NodeMaterials = {};

let gpu = null;              // the `three/webgpu` module — a SEPARATE build from the core three
let tsl = null;              // the `three/tsl` module — node expression helpers
let rotCorrectionUniform = null;  // mat3, head-centre, shared by every matcap mesh
let _MAT3_VIEW = null;           // scratch, desktop matcap correction
let _MAT4_VIEW = null;
let cache = null;            // shaderId -> material, built up front
let mapped = null;           // texture-set key -> per-mesh PBR material (see getFor)
// The OVERLAY materials -- rig capsules and trail dots. Keyed and pre-built for the same reason
// everything else in this file is: see buildOverlayVariants.
let overlay = null;          // key -> material
const matcapTextures = [];   // index -> Texture, shared by every mesh using that matcap

NodeMaterials.isActive = () => !!gpu;

/** Every material this module owns — the shader cache, the UI materials and the converted
 *  stock ones. Used to invalidate compiled shaders at an XR session boundary, where the
 *  camera uniform layout changes. */
NodeMaterials.all = function () {
  const out = [];
  for (const id in cache) if (cache[id]) out.push(cache[id]);
  // The per-mesh textured variants count as ours: they need the same session-boundary rebuild
  // and the same warm pass as everything else, and leaving them out is how one material comes
  // back compiled for the wrong camera.
  if (mapped) for (const m of mapped.values()) if (m) out.push(m);
  for (const m of basicCache.values()) out.push(m);
  if (overlay) for (const m of overlay.values()) if (m) out.push(m);
  for (const v of (NodeMaterials._panelVariants || [])) out.push(v);
  if (NodeMaterials._solid) out.push(NodeMaterials._solid);
  return out;
};

/** EVERY material on the PBR lit path — the shared one and every per-mesh textured variant.
 *  scene.environment is deliberately not used here (see Scene._syncThreeLights), so the IBL
 *  lives on each material's own envMap. That made "the PBR material" a single object, and the
 *  first textured import proved it is not: a variant built without the envMap renders BLACK in
 *  a scene lit only by the environment, which reads as "the texture broke the material". */
NodeMaterials.allPBR = function () {
  const out = [];
  const base = cache && cache[Enums.Shader.PBR];
  if (base) out.push(base);
  if (mapped) for (const m of mapped.values()) if (m) out.push(m);
  return out;
};

/**
 * Called once, right after the WebGPU renderer is initialised and before anything renders.
 * `mod` is the dynamically imported `three/webgpu`.
 */
NodeMaterials.enable = function (mod, tslMod) {
  gpu = mod;
  tsl = tslMod;
  if (!_MAT3_VIEW) { _MAT3_VIEW = new mod.Matrix3(); _MAT4_VIEW = new mod.Matrix4(); }
  cache = {};
  // A FLAT OPAQUE MATERIAL WITH NO TEXTURE, built up front so it can be swapped onto a panel
  // inside a session without constructing anything there (the one fault this renderer has).
  // It separates two invisibles that look identical: a quad drawn with a texture that never
  // uploaded is transparent, and a quad that is not drawn is also nothing. Swap this in and
  // a magenta rectangle either appears where the menu should be, or does not.
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
  NodeMaterials.buildOverlayVariants();
  return cache;
};

/**
 * THE RIG'S PLAIN INSTANCED BATCHES -- bone bodies, joint markers and their physics and ghost
 * variants. No taper, no sharpness, no shading: just an unlit surface whose colour comes from
 * the batch's per-instance colour.
 *
 * Built HERE rather than being converted from a stock MeshBasicMaterial by Scene's sweep, and
 * that is the whole point. A converted material is created on the frame the rig first appears,
 * and compiling a node material is expensive: measured on the desktop, the first frame after a
 * six-joint rig is drawn takes 1,653ms, of which 1,640ms is inside renderer.render -- about
 * 117ms per new material. matt on a GalaxyXR: "the first time i draw a bone there's a definite
 * stutter." Pre-built, they are in NodeMaterials.all() and the warm pass compiles them before
 * the session starts.
 *
 * The colour rides on instanceColor, which three multiplies into the DIFFUSE -- so colorNode is
 * white and the batch's setColorAt does the rest. Same arrangement convertBasic ends up with;
 * this just gets there before the frame that needs it.
 */
NodeMaterials.rigBatch = function (opts = {}) {
  if (!gpu) return null;
  overlay = overlay || new Map();
  // KEYED ON `ghost` ALONE, not on the batch key: bone, joint and their physics variants differ
  // only in GEOMETRY, and nothing mutates these materials per batch the way tuneCapsuleBatches
  // does to the capsules'. Two materials rather than eight, and two compiles in the warm pass.
  const ck = 'batch:' + (opts.ghost ? 'ghost' : 'solid');
  const hit = overlay.get(ck);
  if (hit) return hit;
  const { vec3 } = tsl;
  const ghost = !!opts.ghost;
  const m = unlit({
    side: gpu.DoubleSide,
    transparent: ghost,
    opacity: ghost ? 0.35 : 1.0,        // GHOST_OPACITY in Skeleton
    depthTest: true,
    depthWrite: !ghost,
    ...(ghost ? { depthFunc: gpu.GreaterDepth } : {}),
  });
  m.colorNode = vec3(1, 1, 1);
  m.userData.rigBatch = true;
  m.userData.nodeShared = true;
  overlay.set(ck, m);
  return m;
};

/**
 * THE OVERLAY MATERIALS, BUILT UP FRONT LIKE EVERYTHING ELSE IN THIS FILE.
 *
 * The rule at the top of this module is that every material is pre-created before anything
 * renders, because constructing one DURING a session floods the log with "uniform buffer that is
 * too small" and nothing measured afterwards is trustworthy. The rig capsules and the trail dots
 * were added later and broke that rule: they were built the first time a bone or a trail
 * appeared, which is mid-session, and each one compiles a shader on the frame it is born.
 *
 * matt, on a GalaxyXR: "the first time i draw a bone on gxr there's a definite stutter." Eight
 * capsule materials compiled inside one frame is what that is.
 *
 * Built here, they are in NodeMaterials.all(), which means the warm pass compiles them before the
 * session starts and the session-boundary rebuild keeps them right.
 *
 * The keys mirror Skeleton's batch keys and MotionTrail's three dot sizes. Duplicating those
 * constants is the cost of not importing either module into this one -- both already import IT,
 * and the cycle is not worth the tidiness. A key that drifts costs a lazily-built material and
 * the stutter back, not a fault, so it fails soft.
 */
NodeMaterials.buildOverlayVariants = function () {
  if (!gpu) return 0;
  let n = 0;
  for (const shaft of [true, false]) {
    for (const ghost of [false, true]) {
      for (const hi of [false, true]) {
        const key = (shaft ? 'capShaft' : 'capEnd') + (ghost ? 'G' : '') + (hi ? 'Hi' : '');
        if (NodeMaterials.rigCapsule({ shaft, ghost, key })) n++;
      }
    }
  }
  // The plain instanced batches. Eight of them -- bone and joint, each with a ghost and a
  // physics variant -- but only two materials, because they differ only in geometry.
  for (const ghost of [false, true]) if (NodeMaterials.rigBatch({ ghost })) n++;
  // DOT_PX, KEY_DOT_PX and DOT_PX * HOVER_GROW, from MotionTrail.
  for (const size of [4, 6, 4 * 1.9]) {
    if (NodeMaterials.dots({ size })) n++;
  }
  return n;
};

NodeMaterials.get = function (shaderId) {
  if (!cache) return null;
  return cache[shaderId] || cache[Enums.Shader.MATCAP] || null;
};

// ── A MESH WITH ITS OWN TEXTURES GETS ITS OWN MATERIAL ──────────────────────────────────
//
// Everything else shares: one material per shader id, built up front, handed to every mesh.
// A texture map cannot work that way -- it belongs to one mesh, and a shared material would
// wear the last import's image on everything. The legacy path already reached this conclusion
// and clones per mesh in ShaderManager.getMaterialFor; the node branch returned the shared
// material unconditionally, which is why an imported glb came in untextured.
//
// ONLY PBR, exactly as the legacy rule has it: no other mode samples a map, and every other
// mode has reason to keep the shared material. And only when there is something to carry --
// a map or transmission -- so an ordinary sculpt is untouched and still shares.
//
// THE HAZARD, written down rather than discovered later: this builds a material on demand, and
// a material first compiled INSIDE an XR session comes out with the wrong camera layout. In
// practice an import happens on the desktop, and the variant is built the first time the mesh
// is drawn, which is then. A glb imported while in a session is the case to watch.
NodeMaterials.getFor = function (mesh, shaderId) {
  if (!cache) return null;
  if (!mesh || shaderId !== Enums.Shader.PBR) return NodeMaterials.get(shaderId);
  const wantsOwn = (mesh.hasTextureMap && mesh.hasTextureMap())
    || (mesh.getTransmission && mesh.getTransmission() > 0)
    || (mesh.getOpacity && mesh.getOpacity() < 1);
  if (!wantsOwn) return NodeMaterials.get(shaderId);

  // Keyed on the maps themselves, not just on the mesh: swapping a texture has to rebuild,
  // and two meshes sharing one set of maps can share one material.
  const key = [
    mesh.getAlbedoMap && mesh.getAlbedoMap() ? mesh.getAlbedoMap().uuid : '-',
    mesh.getRoughMetalMap && mesh.getRoughMetalMap() ? mesh.getRoughMetalMap().uuid : '-',
    mesh.getNormalMap && mesh.getNormalMap() ? mesh.getNormalMap().uuid : '-',
    mesh.getTransmission ? mesh.getTransmission() : 0,
    mesh.getRoughFactor ? mesh.getRoughFactor() : 1,
    mesh.getMetalFactor ? mesh.getMetalFactor() : 1,
    mesh.getNormalScale ? mesh.getNormalScale() : 1,
    // The MESH's identity, not its opacity value -- keying on the number would build a new
    // material on every step of a slider drag, which is the one thing this renderer cannot
    // do safely inside a session. A translucent mesh simply gets a material of its own, and
    // the opacity on it is then a plain property that can move.
    (mesh.getOpacity && mesh.getOpacity() < 1) ? 'o' + (mesh.getID ? mesh.getID() : '?') : '-',
  ].join('|');

  mapped = mapped || new Map();
  const hit = mapped.get(key);
  // OPACITY IS NOT IN THE KEY (see above), so a cache hit carries whatever value it was built
  // with. Re-apply it, or a mesh taken to 1.0 and back comes back at its OLD opacity -- the
  // slider moves and nothing on screen changes.
  if (hit) { applyOpacity(hit, mesh); return hit; }
  const m = makePhysical(gpu, tsl, mesh);
  // Inherit the IBL immediately. _syncThreeLights will keep it in step from the next frame,
  // but the variant is handed straight to the mesh and would draw one unlit frame without it.
  const base = cache[Enums.Shader.PBR];
  if (base) { m.envMap = base.envMap || null; m.envMapIntensity = base.envMapIntensity; }
  mapped.set(key, m);
  return m;
};

function applyOpacity(mat, mesh) {
  const op = mesh.getOpacity ? mesh.getOpacity() : 1;
  mat.opacity = op;
  // The glass coat is transparent for a reason of its own (additive blending, transmission
  // left at 0), so it cannot be derived from transmission > 0 -- doing that put the coat back
  // in the OPAQUE pass, where its blending is ignored and it painted black over the scene.
  mat.transparent = op < 1 || mat.transmission > 0 || !!mat.userData.isGlassCoat;
}

// ── A CONVERTED MATERIAL'S `.color` AND `.opacity` HAVE TO KEEP WORKING ─────────────────
//
// The sweep in Scene swaps a stock MeshBasicMaterial for the stand-in above and then the
// object carries the stand-in. Code all over this app changes a colour by writing
// `obj.material.color.setRGB(...)` or `obj.material.opacity = x` -- and on the stand-in both
// of those land on properties nothing reads: `colorNode` is black and what you see is the
// `emissiveNode`/`opacityNode` uniforms.
//
// It fails SILENTLY and it fails LATE: the write succeeds, the property holds the new value,
// and only the picture disagrees. VR gizmo preselect is where matt found it -- the handles
// never light up on hover (#85) -- but the write is unremarkable and the same line appears in
// the bone and skin code, so the fix belongs here and not at any one call site.
//
// The stand-in's own properties are the source of truth once it has been seeded, so this is a
// compare-and-copy per converted object per frame: 34 of them in a desktop scene.
NodeMaterials.syncConverted = function (m) {
  const y = m && m.userData && m.userData.sync;
  if (!y) return false;
  if (!y.col.value.equals(m.color)) y.col.value.copy(m.color);
  if (y.opac.value !== m.opacity) y.opac.value = m.opacity;
  return true;
};

// ── THE RIG CAPSULES, AS NODE MATERIALS ─────────────────────────────────────────────────
//
// Skeleton builds these batches with three onBeforeCompile injections -- taperMaterialInstanced
// (the shaft's per-instance p-norm taper), sharpMaterialInstanced (the cap's exponent) and
// shadeMaterial (the unlit shading term). WebGPURenderer IGNORES onBeforeCompile entirely, so on
// this renderer the shafts drew as raw untapered cylinders in flat white and nothing was shaded.
// matt: "the capsule also wasn't shaded with colours, and the link tubes between them weren't
// visible" -- the tubes ARE there, they are just the wrong shape and the wrong colour.
//
// The GLSL read `instanceMatrix` for the orientation and scale, which TSL cannot reach from a
// material that must survive its InstancedMesh being replaced on every capacity doubling. So the
// orientation, scale and colour ride as instanced attributes instead (aQ/aS/aC, written in
// flushBatches) and everything here is expressed in terms of those.
//
// COLOUR COMES FROM aC, NOT instanceColor. The shading term straddles 1.0 so the lit side
// BRIGHTENS, and a plain multiply pushes channels past 1 one at a time -- an orange bone's red
// saturates first and the colour walks toward white, which is the "very pastel" look the legacy
// shader was fixed for. Capping the gain where the brightest channel would clip preserves the
// hue, and that cap needs the colour itself, which instanceColor does not hand us.
function qrot(tsl, q, v) {
  const t = q.xyz.cross(v).mul(2.0);
  return v.add(t.mul(q.w)).add(q.xyz.cross(t));
}

function rigShade(tsl, q, normalObj) {
  const { vec3, vec4, float, modelWorldMatrix } = tsl;
  const world = modelWorldMatrix.mul(vec4(qrot(tsl, q, normalObj), 0.0)).xyz.normalize();
  // One key from above and slightly front-left, with a floor rather than a black side: this says
  // WHICH WAY A SURFACE FACES, it is not lighting a scene. Centred on 1.0 so the lit side gains.
  return float(0.60).add(float(0.80).mul(world.dot(vec3(0.35, 1.0, 0.45).normalize()).clamp(0, 1)));
}

/**
 * `shaft` builds the tapered link tube between two joints; otherwise the end cap.
 * `ghost` is the xray pass: GreaterDepth, no depth write, low opacity.
 */
NodeMaterials.rigCapsule = function (opts = {}) {
  if (!gpu) return null;
  // KEYED AND CACHED, so the set can be built BEFORE a session rather than on the frame a bone
  // first appears -- see buildOverlayVariants. The Hi variants cannot share with their plain
  // twins: tuneCapsuleBatches sets a different opacity on each every pass.
  overlay = overlay || new Map();
  const ck = 'cap:' + (opts.key || ((opts.shaft ? 'shaft' : 'end') + (opts.ghost ? 'G' : '')));
  const hit = overlay.get(ck);
  if (hit) return hit;
  const { attribute, positionGeometry, vec3, vec4, float, mix, pow, abs, max, select,
    uniform } = tsl;
  const shaft = !!opts.shaft;

  const m = unlit({
    side: gpu.DoubleSide,
    transparent: true,
    opacity: opts.ghost ? 0.35 : 1.0,
    depthTest: true,
    depthWrite: !opts.ghost,
    ...(opts.ghost ? { depthFunc: gpu.GreaterDepth } : {}),
  });

  const q = attribute('aQ', 'vec4');
  const sc = attribute('aS', 'vec3');
  const col = attribute('aC', 'vec3');
  const pos = positionGeometry;

  // A p-norm of 2 IS the ellipsoid the direction already lies on, so dividing by the norm only
  // does anything above 2 -- and pow() three times is not free on a rig full of round joints.
  const pnorm = (v, p) => pow(
    pow(abs(v.x), p).add(pow(abs(v.y), p)).add(pow(abs(v.z), p)), float(1.0).div(p));

  let posNode;
  let normalObj;
  if (shaft) {
    // The cylinder spans y = -0.5 .. 0.5, and -0.5 is the end the bone STARTS at.
    const t = pos.y.add(0.5);
    const h = mix(attribute('aHA', 'vec3'), attribute('aHB', 'vec3'), t);
    const p = mix(attribute('aPA', 'float'), attribute('aPB', 'float'), t);
    const radial = vec3(pos.x, 0.0, pos.z);
    const w = qrot(tsl, q, radial);
    const shaped = select(p.greaterThan(2.001), w.div(max(pnorm(w, p), float(1e-6))), w);
    // ...and back into object space, where the instance matrix will pick it up.
    const b = qrot(tsl, vec4(q.xyz.negate(), q.w), shaped.mul(h));
    posNode = vec3(b.x, pos.y, b.z);
    normalObj = radial.normalize();
  } else {
    const p = attribute('aP', 'float');
    posNode = select(p.greaterThan(2.001), pos.div(max(pnorm(pos, p), float(1e-6))), pos);
    // AN ELLIPSOID'S NORMAL IS NOT ITS POSITION: a cap is a unit sphere scaled by the joint's
    // three half-extents, and a normal transforms by the INVERSE of that scale. Skipping the
    // divide lit a squashed joint as though it were round.
    normalObj = pos.div(max(sc, vec3(1e-6, 1e-6, 1e-6))).normalize();
  }
  m.positionNode = posNode;

  // THE SHADED TOGGLE, driven by tuneCapsuleBatches through userData.shadeMix exactly as the
  // legacy material's uniform was. Blended rather than compiled in or out: switching it must not
  // rebuild a program mid-session, and the flat look has to stay available.
  const shadeMix = uniform(1);
  const shade = mix(float(1.0), rigShade(tsl, q, normalObj), shadeMix);
  const brightest = max(max(col.r, col.g), col.b);
  const gain = select(brightest.greaterThan(1e-4),
    max(shade, float(0)).min(float(1.0).div(brightest)), shade);
  m.colorNode = col.mul(gain);
  m.userData.shadeMix = shadeMix;
  m.userData.rigCapsule = true;
  m.userData.nodeShared = true;
  overlay.set(ck, m);
  return m;
};

/**
 * THE TRAIL'S KEY DOTS. MotionTrail draws them as THREE.Points on a stock PointsMaterial with a
 * round sprite `map` and `alphaTest: 0.5` -- a cutout rather than a blend, so the dot keeps its
 * shape without a blended pass.
 *
 * ALPHATEST IS WHAT FAILS HERE, and it fails for the stock material AND the node one: measured
 * side by side in the viewport, points with map+alphaTest draw nothing at all while the same
 * points without them draw fine. So the round shape has to come from somewhere that is not a
 * discard.
 *
 * `pointUV` is the sprite's own coordinate, so the mask is a distance from its centre and needs
 * no texture at all. It rides on opacityNode, which means the pass has to BLEND -- the one thing
 * the legacy material went out of its way to avoid (see makeDots). The dots are a few pixels
 * across, so the blend is cheap; if it ever shows as judder in a headset, the fallback is
 * NoBlending and square dots, which also draw.
 */
NodeMaterials.dots = function (opts = {}) {
  if (!gpu || !gpu.PointsNodeMaterial) return null;
  overlay = overlay || new Map();
  const ck = 'dot:' + opts.size;
  const hit = overlay.get(ck);
  if (hit) return hit;
  const { pointUV, vec2, float } = tsl;
  const m = new gpu.PointsNodeMaterial({
    size: opts.size,
    sizeAttenuation: false,   // SCREEN pixels, which is what keeps these from becoming a wall
    vertexColors: true,
    transparent: true,
    blending: gpu.NormalBlending,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
  });
  m.opacityNode = pointUV.sub(vec2(0.5, 0.5)).length().lessThan(0.5).select(float(1), float(0));
  m.userData.trailDots = true;
  m.userData.nodeShared = true;
  overlay.set(ck, m);
  return m;
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
    const { uniform, texture, normalWorld, vec2, mat3, vertexColor } = tsl;
    if (!rotCorrectionUniform) rotCorrectionUniform = uniform(new gpu.Matrix3());
    const m = unlit({ vertexColors: true });
    // THE WORLD NORMAL, NOT `normalView`. This one line is the whole port bug.
    //
    // The legacy shader takes its normal through uN, the normal matrix of uMV built from the
    // LEGACY camera -- and that camera is frozen for the whole session (Camera.updateView:
    // "WE ARE IN VR. DO NOT TOUCH THE THREE.JS CAMERA!"). A frozen camera makes uN a fixed
    // rotation, so the legacy VR matcap is really a WORLD-SPACE lookup: it does not move when
    // you move, and both eyes read the same texel because nothing in it is per-eye.
    //
    // `normalView` is live and per-eye, and gave one symptom for each of those. Live: the
    // lookup follows your head, so "if i turn my head left, the matcap turns right" and "it
    // swims if i turn my head in little circles". Per-eye: the eyes are canted, so each looks
    // the texture up at a slightly different UV and the disparity fuses as false depth, which
    // is what the correction uniform was reintroduced to fix in the first place.
    //
    // A world normal has neither property, and the correction below then does the same job it
    // does on the desktop. See the note in updateFrame for why the head is not consulted at all.
    const n = mat3(rotCorrectionUniform).mul(normalWorld).normalize();
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
    //   1  stock placeholder (MeshNormalNodeMaterial), no PBR material at all
    //   2  our BRDF with NO uniform arrays -- deliberately flat albedo, no lighting. This is
    //      a uniform-buffer test, NOT a working renderer, and reads as "unlit" because it is.
    //   3  our BRDF in full: GGX, SH9, the panorama, the light loop. The pre-Physical path,
    //      and the one to reach for when asking "did the lit material break VR".
    if (b === 2) console.log('[NodeMaterials] pbrbisect=2 — flat albedo, no lighting (UBO test)');
    if (b === 3) console.log('[NodeMaterials] pbrbisect=3 — the full hand-written BRDF');
    if (b) return makePBR(gpu, tsl, { noArrays: b === 2 });
    // The hand-ported BRDF is still reachable with ?pbrbisect=, but the default is now
    // three's lit pipeline -- see NodePhysical.js for why.
    return makePhysical(gpu, tsl);
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
 * The voxel resolution preview: a world-space checker, triplanar-blended by the normal.
 * A transcription of VoxelDensityOverlay's GLSL, including `uniforms.uScale` so the one
 * call site that writes it keeps working unchanged.
 */
NodeMaterials.voxelDensity = function () {
  if (!gpu) return null;
  const { uniform, vec3, float, positionWorld, normalWorld, fract, step, abs, mod } = tsl;
  const m = unlit();
  const uScale = uniform(1.0);
  const checkX = step(0.5, fract(positionWorld.y.mul(uScale)));
  const checkY = step(0.5, fract(positionWorld.x.mul(uScale)));
  const checkZ = step(0.5, fract(positionWorld.z.mul(uScale)));
  const gridX = mod(checkY.add(checkZ), 2.0);
  const gridY = mod(checkX.add(checkZ), 2.0);
  const gridZ = mod(checkX.add(checkY), 2.0);
  const na = abs(normalWorld).toVar();
  const n = na.div(na.x.add(na.y).add(na.z));
  const c = gridX.mul(n.x).add(gridY.mul(n.y)).add(gridZ.mul(n.z));
  m.emissiveNode = vec3(c.mul(0.3).add(0.6));
  m.uniforms = { uScale };
  return m;
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

/**
 * CONVERT A STOCK MeshBasicMaterial INTO ONE THIS RENDERER CAN DRAW.
 *
 * three turns every MeshBasicMaterial into a MeshBasicNodeMaterial, which is the one class
 * this backend cannot draw in an XR session -- so a single unconverted one anywhere in the
 * scene poisons the whole frame, and that is what cost a day. Porting them one site at a
 * time only fixes the sites someone has found; this fixes the ones nobody has.
 *
 * Cached per source material, so a given material converts once and its pipeline lasts.
 * Colour, opacity and the map are followed EVERY frame through uniforms, so code that writes
 * `material.color.set(...)` or assigns `.map` later keeps working -- that write-path problem
 * has already bitten this port twice.
 */
const basicCache = new Map();
NodeMaterials.convertBasic = function (src) {
  // ALSO STOCK MeshStandardMaterial, which in this app means one thing: the GLTF controller
  // models. Nothing else uses it -- imported meshes become SculptXR meshes on our own
  // shader. They used to be lit by two default lights that lit nothing else (every legacy
  // shader ignores three's lights), and removing those left the controllers black.
  //
  // Unlit is the right answer rather than relighting them: they are UI furniture, and a
  // controller that dims when the user turns their key light down is a bug, not a feature.
  if (!gpu || !src || src.isNodeMaterial) return null;
  if (!src.isMeshBasicMaterial && !src.isMeshStandardMaterial) return null;
  let m = basicCache.get(src);
  if (!m) {
    const { texture, uniform, vec3, vertexColor, float, mix } = tsl;
    m = unlit({
      transparent: src.transparent, opacity: src.opacity, side: src.side,
      depthTest: src.depthTest, depthWrite: src.depthWrite, blending: src.blending,
      vertexColors: src.vertexColors, alphaTest: src.alphaTest, toneMapped: src.toneMapped,
      // colorWrite CARRIES, and leaving it out was a performance bug, not a cosmetic one.
      //
      // Skeleton's noDrawMaterial marks a mesh "present but not drawn" with
      // { colorWrite: false, depthWrite: false }, and recognises its own work next frame by
      // testing those two flags. The stand-in did not copy colorWrite, so on this renderer the
      // test never matched again: updateVisuals built a NEW MeshBasicMaterial for every such
      // mesh every frame, the sweep saw an unseen source material and built a NEW node material
      // for it, and three -- whose render objects are keyed on the material -- rebuilt the
      // render object and its whole node graph. Measured: 40 rig objects, 17 frames, 17
      // distinct materials each, and `_nodes.getForRender` at 8.6ms of a 10.9ms frame.
      //
      // On the legacy renderer the same code was free, because nothing replaced the material
      // it had just written and the guard matched on the second frame. That is the whole of
      // matt's "this was essentially free pre-tsl, whats happened?"
      //
      // It was also drawing meshes that had asked not to be drawn.
      colorWrite: src.colorWrite,
    });
    m.depthFunc = src.depthFunc;
    const col = uniform(new gpu.Color().copy(src.color));
    const opac = uniform(src.opacity);
    // A TEXTURE NODE ONLY WHEN THERE IS ACTUALLY A MAP.
    //
    // This used to build one unconditionally so the graph could grow a texture later -- and
    // a texture sampled with the default UV REQUIRES a `uv` attribute on the geometry. The
    // sculpt has position, normal, color and aMaterial, and NO uv. So every map-less object
    // whose geometry lacks uv produced
    //   THREE.AttributeNode: Vertex attribute "uv" not found on geometry.
    // out of the node builder, and did not draw. matt hit it the moment he added a light:
    // the recompile a new light forces is what made a latent bad graph actually build.
    //
    // The cost is that a map arriving LATER cannot be adopted. That is acceptable here --
    // panels do not come through this path (NodeMaterials.panel handles them, on a
    // PlaneGeometry that has uv) -- and the update below says so rather than failing quietly.
    let rgb = vec3(col);
    if (src.vertexColors) rgb = rgb.mul(vertexColor());
    let mapNode = null;
    if (src.map) {
      mapNode = texture(src.map);
      rgb = rgb.mul(mapNode.rgb);
    }
    // DIFFUSE, NOT EMISSIVE, AND THAT IS WHAT CARRIES PER-INSTANCE COLOUR.
    //
    // three applies an InstancedMesh's `instanceColor` to the DIFFUSE colour -- its InstanceNode
    // multiplies it in there and nowhere else. This stand-in rode on emissiveNode with the
    // diffuse pinned black, so every instance of a batch came out the material's one base
    // colour. matt, on the rig: "the bones in solid mode were all white, they should be the
    // same hue as the wireframe". The wireframe is a merged LineSegments with real per-vertex
    // colours, which is why that half was right and this half was not.
    //
    // Safe because `lights = false`: with no lighting graph the diffuse passes straight to the
    // output, so this is the same picture by a different route. Measured on a plain mesh across
    // three colours, emissive and diffuse give byte-identical pixels.
    //
    // Only here, not in unlit() itself -- panels, lasers and the solid placeholder build on
    // that helper and set emissiveNode themselves, and moving the carrier under them would
    // double up.
    m.colorNode = rgb;
    m.opacityNode = mapNode ? opac.mul(mapNode.a) : opac;
    m.userData.sync = { col, opac, mapNode, lastMap: src.map || null };
    // SEED THE STAND-IN'S OWN `.color`/`.opacity`, because from here on THEY are what the
    // rest of the app writes to -- see syncConverted.
    m.color.copy(src.color);
    m.opacity = src.opacity;
    basicCache.set(src, m);
  }
  const y = m.userData.sync;
  y.col.value.copy(src.color);
  y.opac.value = src.opacity;
  m.color.copy(src.color);
  m.opacity = src.opacity;
  if (src.map !== y.lastMap) {
    if (y.mapNode && src.map) { y.mapNode.value = src.map; }
    else if (src.map && !y.mapNode) {
      console.warn('[NodeMaterials] a converted material gained a map after conversion; it '
        + 'will not show. Give it a map before first render, or use NodeMaterials.panel.');
    }
    y.lastMap = src.map;
  }
  return m;
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
  // ACTUALLY UNLIT. MeshLambertNodeMaterial sets NodeMaterial's `lights` flag true, so every
  // one of these compiled a full lighting graph -- and once a light in the scene had
  // castShadow, that graph included shadow sampling. In an XR session that combination takes
  // the frame down: menus and controller models vanish and the UBO flood returns.
  //
  // Turning castShadow off in-session did not help, because the materials are compiled
  // during the warm pass BEFORE the session, while castShadow is still true, and nothing
  // rebuilds them afterwards. The real error was calling this helper "unlit" while building
  // it on a lit material: panels, lasers and cursors have no business responding to the
  // user's lighting rig at all. With the flag off there is no lighting graph to contain a
  // shadow node in the first place.
  m.lights = false;
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
/**
 * THE SAME WARM, SPREAD OVER FRAMES INSTEAD OF BLOCKING ONE.
 *
 * NodeMaterials.warm draws everything in a single render, which is fine on a desktop and is not
 * fine at the start of an XR session. Measured by matt on a GalaxyXR:
 *
 *   [NodeMaterials] warmed 29 pipelines (+20 rig batches, on their own geometry)   2164.7ms
 *   [Violation] 'requestAnimationFrame' handler took 2153ms
 *   [XR] First frame rendered (+4399ms from session start)
 *
 * Two seconds of that is one rAF handler, which is two seconds of the grey void before the scene
 * appears -- matt: "was in the gray void for about 3 seconds". The work is the same work either
 * way, and it has to happen INSIDE the session (session start rebuilds every material, so
 * anything compiled on the desktop is thrown away). What can change is whether it lands in one
 * frame or forty.
 *
 * So: enqueue at session start, and spend a few milliseconds a frame on it from then on. The
 * session comes up immediately, the first seconds are choppy rather than absent, and ShaderBusy
 * has something true to say while they are.
 *
 * A budget cannot split one compile -- a single pipeline is tens of milliseconds on this device
 * -- so in practice this is "one per frame, sometimes two". That is the point: one 45ms frame is
 * a stutter, forty-nine of them at once is a hang.
 */
let warmQueue = null;

/**
 * WARM BY DRAWING THE REAL SCENE, BECAUSE NOTHING ELSE COMPILES THE RIGHT PIPELINE.
 *
 * THE FINDING THAT MAKES EVERY EARLIER WARM IN THIS FILE A PLACEBO. three keys a render
 * pipeline on RenderObject.getCacheKey(), and getDynamicCacheKey() starts:
 *
 *     cacheKey = this._nodes.getCacheKey( this.scene, this.lightsNode );
 *
 * -- THE SCENE AND ITS LIGHTS. Every warm here rendered into a throwaway gpu.Scene with no
 * lights in it, so every pipeline it built was keyed to that scene and could never be the one
 * the real scene asks for. The stand-in PlaneGeometry made it worse again: the key is per
 * render object, so a material warmed on a 4-vertex quad compiles a pipeline for the quad.
 *
 * Measured on matt's GalaxyXR with the compile trace: 29 + 15 pipelines built on
 * `PlaneGeometry(4v)` during a session, none of which anything ever drew, at 30-40ms each.
 * That is about a second and a half of the grey void spent compiling nothing.
 *
 * So the warm draws THE ACTUAL SCENE, once, with the actual camera and the actual lights. The
 * only thing it changes is visibility: an instanced batch at count 0 draws nothing and compiles
 * nothing, and a hidden panel likewise, so those are turned on for the one frame and put back.
 * Nothing is reparented and no stand-in geometry exists, which also makes this much less code
 * than the thing it replaces.
 */
NodeMaterials.warmScene = function (renderer, scene, camera, meshes) {
  if (!gpu || !renderer || !scene || !camera) return 0;
  const restore = [];
  for (const m of (meshes || [])) {
    if (!m) continue;
    restore.push({ m, visible: m.visible, count: m.count });
    m.visible = true;
    if (m.isInstancedMesh && !m.count) m.count = 1;
  }
  let n = 0;
  try { renderer.render(scene, camera); n = restore.length; }
  catch (e) { console.warn('[NodeMaterials] warmScene failed', e); }
  for (const r of restore) {
    r.m.visible = r.visible;
    if (r.m.isInstancedMesh) r.m.count = r.count;
  }
  return n;
};

/**
 * A STAND-IN FOR THE SESSION'S CAMERA, SO THE SESSION'S PIPELINES CAN BE BUILT ON THE DESKTOP.
 *
 * Everything this renderer compiles is shaped by the camera it is first drawn with: a plain
 * PerspectiveCamera gives a single cameraProjectionMatrix in the shared `render` block, while a
 * session binds per-eye arrays selected by u_cameraIndex. Two different shaders, and a material
 * holds one at a time -- which is the whole reason Scene rebuilds every material at the session
 * boundary, and therefore the reason warming at launch has not been able to spare the session
 * anything.
 *
 * Everything the backend does differently in a session is gated on
 *     renderObject.camera.isArrayCamera && camera.cameras.length > 0 && !isMultiViewCamera
 * and nothing on that path asks whether a session is running -- which is what xrarray.html at
 * the repo root demonstrates. So a hand-made two-eye ArrayCamera compiles the session's shape,
 * on the desktop, at load, where matt wants the cost: "i want a long startup when the app
 * launches ... and no stuttering or compile shader warnings after that point."
 */
NodeMaterials.stereoWarmCamera = function () {
  if (!gpu) return null;
  if (NodeMaterials._stereoCam) return NodeMaterials._stereoCam;
  const W = 64, H = 64;
  const eyeL = new gpu.PerspectiveCamera(70, (W / 2) / H, 0.01, 20);
  const eyeR = new gpu.PerspectiveCamera(70, (W / 2) / H, 0.01, 20);
  eyeL.viewport = new gpu.Vector4(0, 0, W / 2, H);
  eyeR.viewport = new gpu.Vector4(W / 2, 0, W / 2, H);
  // A plausible IPD, and each eye's world matrix set outright, because that is what a session
  // does -- three does not derive the eyes from the head.
  eyeL.position.set(-0.032, 0, 1); eyeR.position.set(0.032, 0, 1);
  eyeL.updateMatrixWorld(true); eyeR.updateMatrixWorld(true);
  const cam = new gpu.ArrayCamera([eyeL, eyeR]);
  cam.position.z = 1;
  cam.updateMatrixWorld(true);
  NodeMaterials._stereoCam = cam;
  return cam;
};

NodeMaterials.warmEnqueue = function (materials, meshes) {
  if (!gpu) return 0;
  const mats = [];
  const seen = new Set();
  for (const m of (materials || [])) if (m && !seen.has(m)) { seen.add(m); mats.push(m); }
  const geo = new gpu.PlaneGeometry(0.001, 0.001);
  // The same colour and material attributes the one-shot warm gives its stand-in quad: a
  // material warmed without them compiles a different pipeline to the one that gets asked for.
  const n = geo.attributes.position.count;
  geo.setAttribute('color', new gpu.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  geo.setAttribute('aMaterial', new gpu.BufferAttribute(new Float32Array(n * 3), 3));
  // DRAINED FROM THE END, which decides the ORDER things become cheap in. prewarmBatches hands
  // these over as capsules, then bone and joint bodies, then wire -- so popping gives wire,
  // joint, bone, capsules, which is the order a first bone actually needs them. The variants
  // nobody has touched yet (preselect highlights, physics shapes) come last, by the time the
  // user is still deciding where to put the second joint.
  warmQueue = {
    mats,
    meshes: (meshes || []).filter(Boolean).slice(),
    geo,
    scene: new gpu.Scene(),
    total: mats.length + (meshes ? meshes.length : 0),
    done: 0,
    at: 0,
  };
  return warmQueue.total;
};

/** True while there is warming left to do — for ShaderBusy and for the console. */
NodeMaterials.warmPending = function () {
  return warmQueue ? (warmQueue.mats.length + warmQueue.meshes.length) : 0;
};

/**
 * Spend up to `budgetMs` on the queue. Called once a frame, before the real render.
 * Returns how many items are left.
 */
NodeMaterials.warmStep = function (renderer, camera, budgetMs) {
  const q = warmQueue;
  if (!q || !renderer || !camera) return 0;
  const budget = budgetMs > 0 ? budgetMs : 6;
  const t0 = performance.now();
  if (!q.at) q.at = t0;

  // BOTH CAMERA SHAPES. The mono one for the desktop, and a hand-made two-eye ArrayCamera for
  // the shape a session uses -- see NodeMaterials.stereoWarmCamera. Warming only the first is
  // why launch-time warming has never spared the session anything.
  const cams = [camera];
  const stereo = q.stereo === false ? null : NodeMaterials.stereoWarmCamera();
  if (stereo) cams.push(stereo);
  const draw = (sc) => {
    for (const c of cams) {
      try { renderer.render(sc, c); } catch (e) { /* one item is not worth a frame */ }
    }
  };

  do {
    const sc = q.scene;
    let drew = false;
    if (q.mats.length) {
      const mesh = new gpu.Mesh(q.geo, q.mats.pop());
      mesh.position.set(0, 0, -0.05);
      mesh.frustumCulled = false;
      sc.add(mesh);
      draw(sc);
      sc.clear();
      drew = true;
    } else if (q.meshes.length) {
      // A REAL BATCH, BORROWED AND PUT BACK INSIDE THIS STEP. Its pipeline is keyed on its own
      // geometry and instancing, which a stand-in quad cannot reproduce; and an instanced batch
      // at count 0 draws nothing, so it is nudged to 1 with its instance matrix still zeroed.
      const m = q.meshes.pop();
      const parent = m.parent, count = m.count;
      if (m.isInstancedMesh && !m.count) m.count = 1;
      sc.add(m);
      draw(sc);
      if (m.isInstancedMesh) m.count = count;
      if (parent) parent.add(m); else sc.remove(m);
      sc.clear();
      drew = true;
    }
    if (!drew) break;
    q.done++;
  } while (performance.now() - t0 < budget);

  const left = q.mats.length + q.meshes.length;
  if (!left) {
    console.log('[NodeMaterials] warmed ' + q.total + ' pipelines over '
      + Math.round(performance.now() - q.at) + 'ms, spread across frames');
    q.geo.dispose();
    warmQueue = null;
  }
  return left;
};

/**
 * EVERY MATERIAL WORTH WARMING: ours, the caller's, and everything already in the scene.
 *
 * Split out of warm() so the queued path warms exactly the same set. They used to build their
 * own lists, and the queue's was empty -- which is how "warm the rig" quietly also warmed 29 UI
 * materials in one blocking render, and how the queue then warmed none of them.
 */
NodeMaterials.collectWarmable = function (extraMaterials, scene) {
  const mats = [];
  const seen = new Set();
  const add = (m) => { if (m && !seen.has(m)) { seen.add(m); mats.push(m); } };
  for (const id in cache) add(cache[id]);
  if (mapped) for (const m of mapped.values()) add(m);
  for (const m of basicCache.values()) add(m);
  if (overlay) for (const m of overlay.values()) add(m);
  add(NodeMaterials._solid);
  for (const v of (NodeMaterials._panelVariants || [])) add(v);
  if (extraMaterials) for (const m of extraMaterials) add(m);
  // EVERY MATERIAL ALREADY IN THE SCENE, not just ours -- see the note in warm().
  if (scene) scene.traverse((o) => {
    const m = o.material;
    if (!m) return;
    const bad = (x) => !x || (x.isShaderMaterial && !x.isNodeMaterial);
    if (Array.isArray(m)) m.forEach((x) => { if (!bad(x)) add(x); });
    else if (!bad(m)) add(m);
  });
  return mats;
};

NodeMaterials.warm = function (renderer, camera, extraMaterials, scene, extraMeshes) {
  if (!gpu || !renderer) return 0;
  const mats = NodeMaterials.collectWarmable(extraMaterials, scene);
  const seen = new Set(mats);
  const add = () => {};
  // The scene sweep, the raw-ShaderMaterial exclusion and the reasoning for both now live in
  // collectWarmable above:
  //
  // Traced on device: the first failing draw in a session is L_body -- a GLTF CONTROLLER MODEL
  // on a stock MeshStandardMaterial -- and it emits 0x506 (INVALID_FRAMEBUFFER_OPERATION) as
  // well as the UBO error. stylus_spike follows, then the panel. So the panels were third in
  // line and collateral all along. The rule this renderer enforces is not "do not CREATE a
  // material in a session", it is "do not first DRAW one in a session" -- that is when the
  // pipeline is built.
  void seen; void add;
  const nExtra = extraMeshes ? extraMeshes.length : 0;
  if (!mats.length && !nExtra) return 0;

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
  // THE REAL MESHES, FOR THE ONES A PLANE CANNOT STAND IN FOR.
  //
  // A pipeline is keyed on the geometry as well as the material -- attribute layout and
  // instancing included -- so warming an InstancedMesh's material on a PlaneGeometry compiles a
  // pipeline nothing will ever ask for. The rig's batches are exactly that case, and they were
  // still compiling 29 pipelines inside the session on the first bone. These are the actual
  // objects, borrowed from the scene graph and put back below, so what is compiled here is what
  // is drawn later.
  //
  // An instanced batch sits at count 0 until a joint fills it, and a count of 0 draws nothing
  // and compiles nothing, so each is nudged to 1 for this pass. The instance matrix is still all
  // zeroes, which collapses it to a point -- it is submitted, and it is not visible.
  const borrowed = [];
  if (extraMeshes) {
    for (const m of extraMeshes) {
      if (!m) continue;
      borrowed.push({ mesh: m, parent: m.parent, count: m.count });
      if (m.isInstancedMesh && !m.count) m.count = 1;
      sc.add(m);
    }
  }
  try {
    renderer.render(sc, camera);
  } catch (e) {
    console.warn('[NodeMaterials] warm failed', e);
  }
  // PUT THEM BACK BEFORE sc.clear(), which would otherwise leave them parentless and gone from
  // the scene -- a rig that never draws is a worse bug than the one this is fixing.
  for (const b of borrowed) {
    if (b.mesh.isInstancedMesh) b.mesh.count = b.count;
    if (b.parent) b.parent.add(b.mesh);
    else sc.remove(b.mesh);
  }
  sc.clear();
  geo.dispose();
  console.log('[NodeMaterials] warmed ' + mats.length + ' pipelines'
    + (borrowed.length ? ' (+' + borrowed.length + ' rig batches, on their own geometry)' : ''));
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
  // THE UNIFORM IS WORLD -> A HEAD FRAME WITH THE ROLL TAKEN OUT.
  //
  // Camera.updateView refuses to touch the three camera while a session runs ("WE ARE IN VR.
  // DO NOT TOUCH THE THREE.JS CAMERA!"), so main.getCamera().getView() stays the DESKTOP ORBIT
  // view for the whole session and knows nothing about your head. The legacy shader got away
  // with feeding that to the stabiliser because it took its normal through uN, built from the
  // same frozen camera: both halves sat in one head-independent frame and cancelled exactly,
  // and the matcap did not respond to your head at all -- matt, on the A/B, "legacy stays
  // locked as expected". The port kept the frozen correction and took its normal from the live
  // per-eye XR camera, so nothing cancelled and it swam.
  //
  // ROLL IS WHAT WAS LEFT. Handing the whole head rotation through fixed the aim and kept the
  // motion: matt, "its facing the right way, but its still rocking and rolling". A head is
  // never level for long, and a matcap that rolls with it reads as the lighting sliding around
  // the model rather than the model turning. computeRotCorrection said as much in its own
  // comment -- "follows the viewer (yaw) but doesn't roll/pitch with the head" -- it just tried
  // to get there from the camera's POSITION, which is what put the aim at the sky.
  //
  // So: keep the head's own back vector (yaw AND pitch, both of which mean something), and
  // rebuild the other two axes against world up so the frame cannot roll. On the desktop the
  // orbit camera has no roll to remove, so this is exactly the camera rotation and nothing
  // changes -- asserted below by comparing the two.
  //
  // THE CORRECTION IS THE LEGACY ONE, IN A SESSION TOO, AND THE HEAD IS NOT CONSULTED.
  //
  // The whole port error was one line, and it was the NORMAL, not this matrix. The legacy
  // shader's normal comes through uN -- the normal matrix of uMV, built from the LEGACY camera
  // -- and Camera.updateView refuses to touch that camera while a session runs ("WE ARE IN VR.
  // DO NOT TOUCH THE THREE.JS CAMERA!"). A frozen camera makes uN a fixed rotation, so the
  // legacy VR matcap is a WORLD-SPACE normal lookup: it does not move when you move, and both
  // eyes read the same texel because there is nothing per-eye in it. matt: "legacy stays locked
  // as expected."
  //
  // The port replaced that with `normalView`, which is live AND per-eye. Live is why it swam;
  // per-eye is the stereo fault the uniform was reintroduced to fix. Everything I then did to
  // this matrix -- live head rotation, then a roll-free head frame -- was compensating for the
  // wrong normal, and each one only moved the motion around. Feeding the head in at all makes
  // the lookup view-relative, and a view-relative matcap in a headset is exactly "turn my head
  // left, the matcap turns right".
  //
  // So: the node multiplies the WORLD normal (that is the fix), and this stays the legacy
  // correction with the world -> view step folded in, because corr * mat3(view) on a world
  // normal is corr on a view normal -- the same product, so the desktop is bit-for-bit what it
  // always was, and a session inherits the frozen camera's constant exactly as the legacy
  // shader did.
  //
  // `?matcapstab=head` restored the head-tracked frame for an A/B. It is the one that reads as
  // the lighting sliding around the model, which is the fault this was fixed FROM, so it is gone.
  const view = cam.getView();
  const corr = ShaderMatcap.computeRotCorrection(view);
  const v = _MAT3_VIEW.setFromMatrix4(_MAT4_VIEW.fromArray(view));
  rotCorrectionUniform.value.fromArray(corr).multiply(v);
  return NodeMaterials._updateFrameRest(main);
};

/** Each material that needs per-frame state says so by hanging updateFrame on userData,
 *  rather than this file knowing what every shader wants. */
NodeMaterials._updateFrameRest = function (main) {
  for (const id in cache) {
    const f = cache[id] && cache[id].userData && cache[id].userData.updateFrame;
    if (f) f(main);
  }
};

export default NodeMaterials;
