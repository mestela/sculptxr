import * as THREE from 'three';
import getOptionsURL from '../misc/getOptionsURL.js';
import ShaderManager from './ShaderManager.js';

// THE OBJECT IS THE SWITCH.
//
// There is no master Shadow toggle, no built-in floor, and no button that makes a light. Flag a
// mesh as a Shadow Catcher and it wears a material that is invisible except where the sculpt
// throws a shadow on it; the first time that happens a Shadow Light appears in the scene as an
// ordinary object you can grab. Want the shadow gone? Hide the proxy, delete it, or take the
// material off. matt: "assume its always going to have users create an object to shadowcast...
// if they want shadows, they'll make an object."
//
// That replaced an enable toggle, an Auto Floor toggle, a Light Gizmo button and three sliders
// for where the light was — four controls and a mode, for a feature whose entire state is "is
// there a proxy, and where is the light". The two settings left are the two that are genuinely
// about the LOOK of the shadow rather than about its existence: how dark, and how soft.
//
// WHY A LIGHT IN THIS APP ONLY CASTS. Every sculpt shader — matcap, PBR, flat, normal, UV —
// computes its own shading from the camera and its own environment map, and none of them reads a
// THREE.Light. What a light CAN do here is cast, because three renders the shadow map with its own
// depth material straight off the geometry and never consults the mesh's material. So this is a
// shadow caster that happens to be spelled as a light. Making the sculpt respond to it is a
// shader job and is deliberately not attempted here.
//
// WHY A SPOTLIGHT. A directional light's shadow camera is an orthographic box that has to be
// sized by hand, and every wrong size is either a clipped shadow or a blurry one. A spot's is a
// perspective frustum defined by the cone angle, so fitting it to the model is one atan().
//
// AR ALPHA: THE RULE THE GRID LEARNED, INVERTED. In passthrough the framebuffer's alpha is what
// the compositor reads to decide how much of the real room shows through, and ordinary
// SrcAlpha/OneMinusSrcAlpha blending applies to alpha as well as to colour — so drawing over the
// sculpt with it LOWERS destination alpha and the room comes through the model. A shadow is the
// opposite of a hole: it must HIDE the room. So the colour channels blend normally (darkening
// what is behind) and the alpha channels can only accumulate. Outside the shadow ShadowMaterial
// emits alpha 0, so a proxy adds nothing at all and stays invisible.

const DEFAULTS = {
  opacity:  0.35,
  softness: 2.5,    // PCF kernel radius in shadow-map texels
};

// Doubled from 12 on matt's evidence: "I happen to have a large area light in my room, I need the
// cast shadow to be more soft to match." A real room's light is an area source and a spot's shadow
// is not, so the only way to meet it is a wider kernel.
const MAX_SOFTNESS = 24;

const MAP_SIZE = 1024;
const FIT_EVERY = 15;   // frames between re-fits; a fit walks every mesh's world bound.

// Scratch, reused every frame by the ray's re-aim — this runs on the render path.
const _AXIS_Y = new THREE.Vector3();
const _DIR = new THREE.Vector3();

class SceneShadow {

  constructor(main) {
    this._main = main;
    this._built = false;
    this._light = null;
    this._target = null;
    this._gnomon = null;
    this._mat = null;
    this._tick = 0;
    this._active = false;

    const o = getOptionsURL();
    this._opacity  = o.shadowOpacity  ?? DEFAULTS.opacity;
    this._softness = o.shadowSoftness ?? DEFAULTS.softness;

    window._sxrShadow = this;
  }

  // ── construction ────────────────────────────────────────────────────────────
  // Built on the first frame a catcher exists; while there is none it costs a boolean.
  _build() {
    if (this._built) return;
    const main = this._main;
    const group = main._worldGroup;
    const renderer = main._renderer;
    if (!group || !renderer) return;

    // PCF, NOT PCF_SOFT. Only the plain PCF kernel reads `shadow.radius`; the "soft" variant uses
    // a fixed kernel sized off the map and ignores it, which would leave the softness slider
    // doing nothing at all.
    renderer.shadowMap.type = THREE.PCFShadowMap;

    this._target = new THREE.Object3D();
    group.add(this._target);

    const light = this._light = new THREE.SpotLight(0xffffff, 1.0);
    light.castShadow = true;
    light.penumbra = 1.0;
    light.decay = 0;              // the intensity never reaches a material; keep the falloff out
    light.shadow.mapSize.set(MAP_SIZE, MAP_SIZE);
    light.shadow.bias = -0.0005;
    // Measured along the surface normal, so it scales with the model rather than with the depth
    // range — the value that stops acne on a big sculpt would peter-pan a small one.
    light.shadow.normalBias = 0.01;
    light.target = this._target;
    group.add(light);

    // ONE material instance, shared by every proxy — so the opacity slider moves all of them
    // together, which is the only way a floor and a table proxy read as lit by the same light.
    const mat = this._mat = new THREE.ShadowMaterial({ color: 0x000000, opacity: this._opacity });
    mat.transparent = true;
    mat.depthWrite = false;       // a transparent proxy must not occlude what sorts after it
    mat.blending = THREE.CustomBlending;
    mat.blendSrc = THREE.SrcAlphaFactor;
    mat.blendDst = THREE.OneMinusSrcAlphaFactor;
    mat.blendSrcAlpha = THREE.OneFactor;
    mat.blendDstAlpha = THREE.OneFactor;

    this._ensureGnomon();
    this._built = true;
  }

  // ── settings ────────────────────────────────────────────────────────────────
  setOpacity(val) {
    this._opacity = Math.min(1, Math.max(0, val));
    if (this._mat) this._mat.opacity = this._opacity;
    getOptionsURL.saveOption?.('shadowOpacity', this._opacity, 250);
    this._main.render?.();
  }

  getOpacity() { return this._opacity; }

  setSoftness(val) {
    this._softness = Math.min(MAX_SOFTNESS, Math.max(0, val));
    if (this._light) this._light.shadow.radius = this._softness;
    getOptionsURL.saveOption?.('shadowSoftness', this._softness, 250);
    this._main.render?.();
  }

  getSoftness() { return this._softness; }

  static get MAX_SOFTNESS() { return MAX_SOFTNESS; }

  isActive() { return this._active; }

  // ── proxy catchers ──────────────────────────────────────────────────────────
  //
  // Block out the table the sculpt stands on, or the wall behind it, flag that geometry, and it
  // disappears except for what the model throws onto it.
  //
  // The flag lives on the SculptXR mesh and is saved into the .sxr's SKEL block (bit 8 — see
  // Skeleton.serialize). The material swap is re-applied by the per-frame sweep, because
  // `threeMesh.material` is also written by setShaderType and by every global shader change, and
  // a one-shot assignment here would be quietly undone by the next one.
  setMeshCatcher(mesh, on) {
    if (!mesh) return;
    mesh._isShadowCatcher = !!on;
    if (!on) this._restoreMesh(mesh);
    this._main.render?.();
  }

  isMeshCatcher(mesh) { return !!(mesh && mesh._isShadowCatcher); }

  _restoreMesh(mesh) {
    const tm = mesh.getThreeMesh?.();
    if (!tm || tm.material !== this._mat) return;
    tm.material = ShaderManager.getMaterial(mesh.getShaderType());
    tm.receiveShadow = false;
  }

  // Every mesh that could cast — bones, pins, reference images and the proxies themselves are all
  // excluded. A room-sized proxy in the fit would widen the cone and blur away the only thing the
  // shadow map is for.
  _casters() {
    const meshes = this._main.getMeshes?.() || [];
    const out = [];
    for (let i = 0; i < meshes.length; ++i) {
      const m = meshes[i];
      if (m._isBone || m._isNull || m._isReference || m._isShadowCatcher) continue;
      out.push(m);
    }
    return out;
  }

  _catchers() {
    const meshes = this._main.getMeshes?.() || [];
    const out = [];
    for (let i = 0; i < meshes.length; ++i) {
      const m = meshes[i];
      if (m._isShadowCatcher && (!m.isVisible || m.isVisible())) out.push(m);
    }
    return out;
  }

  // ── the light, as a scene object ────────────────────────────────────────────
  //
  // Not a bespoke gizmo: a NULL, the same transform-only locator the eye rig and the IK pins use.
  // That is not a shortcut, it is the better answer — a null already slots into selection, the
  // desktop gizmo, the VR grab, the outliner, undo and the animation registry, so dragging the
  // light works everywhere on the day it is added, and the light can be keyframed like anything
  // else. Its position IS the setting; there are no angle controls to disagree with it.
  _lightMesh() {
    const ms = this._main.getMeshes?.() || [];
    for (let i = 0; i < ms.length; ++i) if (ms[i]._isShadowLight) return ms[i];
    return null;
  }

  hasLight() { return !!this._lightMesh(); }

  // AT THE ORIGIN, not at a position computed from angles nobody set. matt: "start the light at
  // the origin... its better to just have users move it directly, and for it to start in a clear
  // position." The handle draws with depth-testing off, so it stays visible and grabbable even
  // when the model is centred around it.
  spawnLight() {
    const mesh = this._main.buildNull?.();
    if (!mesh) return null;
    mesh._typeName = 'Shadow Light';
    mesh._isShadowLight = true;
    this._main.addNewMesh?.(mesh);
    this._main.decorateNull?.(mesh);
    const M = mesh.getMatrix();
    M[12] = M[13] = M[14] = 0;
    this._decorateLight(mesh);
    this._main.render?.();
    return mesh;
  }

  // SOLID GEOMETRY, NOT LINES. A null is drawn as a three-line cruciform, and hardware 1px lines
  // cannot be thickened — at any distance the handle was a few stray pixels. matt: "it needs
  // thicker handles like the pins." The pins are built from real tubes and spheres for exactly
  // this reason, so this is too: a ball for the light and six stubby rays off it.
  //
  // Sized in the locator's own space, which already carries the 0.03 scale `buildNull` bakes in —
  // hence the large numbers.
  _decorateLight(mesh) {
    const tm = mesh.getThreeMesh?.();
    if (!tm) return;
    // Re-applied on LOAD as well as on create: the handle is three.js objects, and none of that
    // is in the file — a restored light would otherwise be an invisible null.
    if (tm.getObjectByName && tm.getObjectByName('shadow_light_handle')) return;
    const cross = tm.getObjectByName && tm.getObjectByName('null_cruciform');
    if (cross) cross.removeFromParent();

    const BALL_R = 9, RAY_LEN = 22, RAY_R = 2.6;
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffd166, transparent: true, opacity: 0.95,
      depthTest: false, depthWrite: false, toneMapped: false,
    });
    const g = new THREE.Group();
    g.name = 'shadow_light_handle';
    g.frustumCulled = false;

    const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 16, 12), mat);
    ball.frustumCulled = false;
    g.add(ball);

    // Six rays, so the handle reads as a light from any angle rather than as a bead.
    const rayGeo = new THREE.CylinderGeometry(RAY_R * 0.35, RAY_R, RAY_LEN, 8);
    for (const [ax, sgn] of [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]]) {
      const r = new THREE.Mesh(rayGeo, mat);
      r.frustumCulled = false;
      const d = BALL_R + RAY_LEN * 0.5;
      if (ax === 0) { r.position.x = sgn * d; r.rotation.z = -sgn * Math.PI / 2; }
      else if (ax === 1) { r.position.y = sgn * d; if (sgn < 0) r.rotation.z = Math.PI; }
      else { r.position.z = sgn * d; r.rotation.x = sgn * Math.PI / 2; }
      g.add(r);
    }
    // Above the rig's own overlays, like the joint handles: a handle you cannot see is a handle
    // you cannot grab.
    g.traverse((o) => { o.renderOrder = 10003; });
    tm.add(g);
  }

  // A TUBE from the light to what it is aimed at, for the same reason the handle is solid: a 1px
  // line is not a thing you can follow across a room. Built once as a unit cylinder along +Y and
  // re-aimed each frame, so there is no geometry rebuild on the render path.
  _ensureGnomon() {
    if (this._gnomon || !this._main._worldGroup) return;
    const g = this._gnomon = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 1, 8),
      new THREE.MeshBasicMaterial({
        color: 0xffd166, transparent: true, opacity: 0.5,
        depthTest: false, depthWrite: false, toneMapped: false,
      })
    );
    g.name = 'shadow_light_ray';
    g.frustumCulled = false;
    g.renderOrder = 10003;
    g.visible = false;
    this._main._worldGroup.add(g);
  }

  // ── placement ───────────────────────────────────────────────────────────────
  // Everything here is in _worldGroup LOCAL units — except the shadow camera's near/far, which
  // three builds from world positions. The group carries a scale (0.701 by default, and whatever
  // a world grab leaves it at), so those two are converted rather than assumed equal; a near/far
  // off by that factor clips the shadow away entirely.
  _place() {
    if (!this._built) return false;
    const main = this._main;
    const fit = this._fitCache || this._fit();
    const lm = this._lightMesh();
    if (!fit || !lm) return false;

    // The light aims at the MODEL's centre. It used to aim at the built-in floor, which meant the
    // Ground Height slider dragged the shadow camera with it and cropped the shadow — that floor
    // and that slider are both gone, and the aim point stays where it belongs.
    const tgtY = fit.cy;
    this._target.position.set(fit.cx, tgtY, fit.cz);

    const M = lm.getMatrix();
    this._light.position.set(M[12], M[13], M[14]);

    const dx = M[12] - fit.cx, dy = M[13] - tgtY, dz = M[14] - fit.cz;
    const dist = Math.hypot(dx, dy, dz);
    // A LIGHT SITTING ON ITS OWN AIM POINT HAS NO DIRECTION. It starts at the origin and the model
    // is usually centred there, so this is the ordinary first frame, not an error: three would
    // build a shadow camera from a zero-length look vector and fill the frame with NaN. No shadow
    // until it is dragged clear, which is one grab and is visibly what the handle is for.
    if (!(dist > fit.reach * 1e-3)) return false;

    // Half-angle of a cone that still contains the model when the light is off to one side; the
    // model's height counts because a tall sculpt lit from low down needs a wider cone than its
    // footprint suggests. Taken from the LIVE distance, so dragging the light in close widens the
    // cone to keep the model inside it instead of cropping the shadow.
    this._light.angle = Math.min(1.2, Math.max(0.08, Math.atan(fit.reach / dist)));

    const scale = main._worldGroup ? main._worldGroup.scale.x : 1;
    const worldDist = dist * scale;
    this._light.shadow.camera.near = Math.max(0.01, worldDist * 0.05);
    this._light.shadow.camera.far = worldDist * 3;
    this._light.shadow.camera.updateProjectionMatrix();
    this._light.distance = 0;

    // IT IS AN OBJECT, SO THE EYE ICON OWNS IT. Hiding it hides the HANDLE, never the light — a
    // light you cannot see still lights. The handle is a child of the locator's three mesh so it
    // follows for free; the ray lives in the world group and has to be told.
    const shown = lm.isVisible ? lm.isVisible() : true;
    const ltm = lm.getThreeMesh?.();
    if (ltm) ltm.visible = shown;
    if (this._gnomon) {
      this._gnomon.visible = shown;
      if (shown) {
        const ux = dx / dist, uy = dy / dist, uz = dz / dist;
        // STOPS SHORT OF THE MODEL. Drawn all the way to the aim point the ray spears the sculpt,
        // which reads as a stick through the middle of the work rather than as a light pointing
        // at it.
        const len = Math.max(dist * 0.15, dist - fit.reach);
        const midT = dist - len * 0.5;
        this._gnomon.position.set(fit.cx + ux * midT, tgtY + uy * midT, fit.cz + uz * midT);
        this._gnomon.scale.set(fit.reach * 0.012, len, fit.reach * 0.012);
        _AXIS_Y.set(0, 1, 0);
        _DIR.set(ux, uy, uz);
        this._gnomon.quaternion.setFromUnitVectors(_AXIS_Y, _DIR);
      }
    }
    return true;
  }

  // Where the casters are and how big, in world-group local units. Returns null while there is
  // nothing to cast (an infinite bound would put the light at NaN and blank the frame).
  //
  // NOT computeBoundingBoxScene(): that one folds in the brush cursor, so the fit — and with it
  // the light — would creep after the hand while sculpting and the shadow would swim.
  _fit() {
    const main = this._main;
    const list = this._casters();
    if (!list.length || !main.computeBoundingBoxMeshes) return null;
    const b = main.computeBoundingBoxMeshes(list);
    for (let i = 0; i < 6; ++i) if (!isFinite(b[i])) return null;

    const cx = 0.5 * (b[0] + b[3]);
    const cy = 0.5 * (b[1] + b[4]);
    const cz = 0.5 * (b[2] + b[5]);
    const dx = b[3] - b[0], dy = b[4] - b[1], dz = b[5] - b[2];
    const half = 0.5 * Math.max(Math.hypot(dx, dz), 0.001);
    const reach = half + 0.5 * Math.max(dy, 0);
    const fit = { cx: cx, cy: cy, cz: cz, reach: reach * 1.35 };
    this._fitCache = fit;
    return fit;
  }

  // ── per-frame ───────────────────────────────────────────────────────────────
  // Costs one array walk while there is no proxy in the scene.
  update() {
    const renderer = this._main._renderer;
    const catchers = this._catchers();

    if (!catchers.length) {
      // Nothing to catch a shadow, so there is no shadow. The extra depth pass over the whole
      // scene goes with it — that cost is the reason this was ever a toggle, and tying it to the
      // proxy means nobody pays it without having asked for it.
      if (this._active) {
        this._active = false;
        if (renderer) renderer.shadowMap.enabled = false;
        if (this._gnomon) this._gnomon.visible = false;
        if (this._mat) this._mat.needsUpdate = true;
      }
      return;
    }

    this._build();
    if (!this._built) return;

    // THE FIRST PROXY BRINGS THE LIGHT WITH IT. There is no button for it: a proxy with nothing
    // lighting it would be an invisible object that does nothing, which is the worst state this
    // feature has. Deleting the light and keeping the proxy asks for one back on the next frame,
    // which is the recovery story and needs no control either.
    let lm = this._lightMesh();
    if (!lm) lm = this.spawnLight();
    // A light restored from a .sxr carries the flag but none of its three.js handle — see
    // _decorateLight's early-out, which makes this idempotent.
    if (lm) this._decorateLight(lm);

    // A mesh only casts if it is told to, and meshes are REPLACED wholesale by every topology tool
    // and every undo of one — so this is a sweep rather than a flag set at construction, which the
    // next remesh would silently drop.
    const casters = this._casters();
    for (let i = 0; i < casters.length; ++i) {
      const tm = casters[i].getThreeMesh?.();
      if (tm && !tm.castShadow) tm.castShadow = true;
    }
    for (let i = 0; i < catchers.length; ++i) {
      const tm = catchers[i].getThreeMesh?.();
      if (!tm) continue;
      // A proxy stands in for something real, so it must not cast: the table's own shadow is
      // already in the room.
      if (tm.material !== this._mat) tm.material = this._mat;
      tm.receiveShadow = true;
      tm.castShadow = false;
    }

    // The FIT walks every mesh's world bound, so it stays on a throttle. PLACING is a handful of
    // vector ops against the cached fit, and has to run every frame: while the light is being
    // dragged, anything slower shows up as the shadow lagging behind the hand.
    if ((this._tick++ % FIT_EVERY) === 0) this._fit();
    const ok = this._place();

    if (this._active !== ok) {
      this._active = ok;
      if (renderer) renderer.shadowMap.enabled = ok;
      // Switching the shadow map on or off changes the DEFINES the receiving material compiled
      // with, and only a material asked to recompile picks that up.
      if (this._mat) this._mat.needsUpdate = true;
    }
  }
}

export default SceneShadow;
