/**
 * TWO BUGS IN three 0.183.2 THAT ONLY BITE UNDER AN ArrayCamera -- i.e. in an XR session.
 *
 * Between them they are the whole of "a lit node material does not draw in a session", which
 * cost several headset days. Neither has anything to do with lighting, with our material graph
 * or with WebXR: everything the WebGL backend does differently in a session is gated on
 *
 *     renderObject.camera.isArrayCamera && camera.cameras.length > 0 && !isMultiViewCamera
 *
 * and nothing on that path asks whether a session is running. So both reproduce on the desktop
 * with a hand-made two-eye ArrayCamera, which is what `xrarray.html` at the repo root does --
 * run it before touching any of this.
 *
 * Remove this file when three fixes them upstream.
 */

/**
 * BUG A -- UNIFORM BLOCK BINDING POINTS COLLIDE.
 *
 * WebGLBackend.createBindings numbers uniform-block binding points with a counter that runs
 * over ONE render object's bind groups, and _setupBindings bakes that number into that object's
 * program at link time. But SHARED bind groups (`render`, `cameraIndex`, and the per-eye
 * NodeBuffers holding the camera matrices) are a single object reused by every render object,
 * with a single `.index` slot between them -- and Bindings.getForRender skips createBindings
 * for a group it has already initialised. So the second render object renumbers only the groups
 * it owns, the shared ones keep the first object's numbers, and the two sets overlap.
 *
 * Measured, session layout, the two-box repro: the unlit box leaves the camera-matrix buffer at
 * point 0 and cameraIndex at 2; the lit box's `render` group then claims 0,1,2, so the 16-byte
 * cameraIndex buffer and a mat4[2] block are both bound at 2. Hence the
 * `GL_INVALID_OPERATION: ... uniform buffer that is too small` flood, and hence the lit object
 * drawing nothing at all -- its camera matrices are whatever else landed on its binding point.
 *
 * This is also the likely cause of MeshBasicNodeMaterial poisoning a whole frame: same
 * collision, reached through a different bind-group composition.
 *
 * Fix: give every uniform buffer a STABLE binding point. Shared groups take points upward from
 * 0 and keep them for the life of the renderer; per-object groups take points downward from the
 * top, which they may safely share between objects because the backend rebinds an object's own
 * buffers immediately before its own draw. Texture units run on a separate counter, untouched.
 */
function installStableBindingPoints(backend) {
  const gl = backend.gl;
  const MAX = gl.getParameter(gl.MAX_UNIFORM_BUFFER_BINDINGS);   // 32 on this mac, 24+ on Adreno
  // Shared groups take the bottom of the range and per-object groups the top, with a hard wall
  // between them. Without the wall a per-object binding assigned early can be claimed later by
  // a shared one, and a point baked into a program at link time can never be moved again.
  const WALL = MAX >> 1;

  const point = new Map();        // binding object -> its permanent binding point
  const nextPerArray = new WeakMap();   // bindings array -> its next descending point
  let sharedNext = 0;
  let warned = false;
  console.log('[xrpatch] binding points: max ' + MAX + ', shared 0..' + (WALL - 1) + ', per-object ' + (MAX - 1) + '..' + WALL);

  const exhausted = () => {
    if (warned) return;
    warned = true;
    console.error('[xrpatch] uniform binding points exhausted (max ' + MAX + ', wall ' + WALL + ')');
  };

  const stamp = (bindings) => {
    // A per-object bind group is CLONED for each render object, so every per-object binding
    // belongs to exactly one bindings array. Counting down per array is therefore what keeps
    // an object's own bindings distinct from each other -- a single global counter would run
    // out, and a counter restarted per CALL hands two of them the same point.
    let next = nextPerArray.get(bindings);
    if (next === undefined) next = MAX - 1;

    for (const group of bindings) {
      for (const bd of group.bindings) {
        if (!(bd.isUniformsGroup || bd.isUniformBuffer)) continue;
        // Read `shared` off THIS binding, not off the group's first one: a group can carry a
        // node uniform whose own groupNode differs, and getting that wrong puts a per-object
        // uniform in the shared region, on top of a camera buffer.
        const shared = !!(bd.groupNode && bd.groupNode.shared === true);
        let p = point.get(bd);
        if (p === undefined) {
          if (shared) {
            p = sharedNext++;
            if (p >= WALL) exhausted();
          } else {
            p = next--;
            if (p < WALL) exhausted();
          }
          point.set(bd, p);
          if (window._xrpatchTrace) console.log('[xrpatch] NEW ' + bd.name
            + ' shared=' + shared + ' groupNode=' + (bd.groupNode && bd.groupNode.name)
            + ' -> ' + p);
        } else if (window._xrpatchTrace) {
          console.log('[xrpatch] cached ' + bd.name + ' -> ' + p);
        }
        backend.get(bd).index = p;
      }
    }

    nextPerArray.set(bindings, next);
  };

  for (const method of ['createBindings', 'updateBindings']) {
    const orig = backend[method].bind(backend);
    backend[method] = (bindGroup, bindings, ...rest) => {
      const r = orig(bindGroup, bindings, ...rest);
      if (bindings) stamp(bindings);
      return r;
    };
  }
  const origSetup = backend._setupBindings.bind(backend);
  backend._setupBindings = (bindings, programGPU) => {
    stamp(bindings);                       // stamp BEFORE the numbers are baked into the program
    return origSetup(bindings, programGPU);
  };
}

/**
 * BUG B -- `cameraPosition` IS ALWAYS ZERO UNDER AN ArrayCamera, AND THROWS WHILE BUILDING.
 *
 * nodes/accessors/Camera.js builds the array variant as
 *
 *     uniformArray( positions ).setGroup( renderGroup )
 *       .onRenderUpdate( ( { camera }, self ) => { ...write self.array... } )
 *
 * and Node.onUpdate REPLACES `this.update` outright. Three defects follow from that one line:
 *
 *   1. UniformArrayNode.update -- the routine that copies `array` into the padded GPU buffer --
 *      is gone, so the buffer is never written and cameraPositions stays all zeros.
 *   2. NodeFrame calls `node.update( frame )` with ONE argument, so the callback's `self` is
 *      undefined and it throws on `self.array` at every render update.
 *   3. UniformArrayNode.setup calls `this.update()` with NO argument, so it throws on
 *      destructuring `{ camera }` while the material is still being built -- which is what
 *      leaves anything reading cameraPosition rendering black.
 *
 * Fix: run the callback with the arguments it expects, then run the base transfer it displaced.
 */
function installCameraPositionUpdate(WGPU, TSL) {
  const UniformArrayNode = TSL.uniformArray([new WGPU.Vector3()]).constructor;
  const baseUpdate = UniformArrayNode.prototype.update;
  const baseSetup = UniformArrayNode.prototype.setup;
  if (baseSetup._xrPatched) return;

  const patched = function (builder) {
    // An own `update` means onUpdate() overwrote the prototype's transfer; wrap it so both run.
    if (Object.prototype.hasOwnProperty.call(this, 'update')) {
      const custom = this.update;
      this.update = (frame) => {
        if (frame !== undefined) custom(frame, this);
        baseUpdate.call(this, frame);
      };
    }
    return baseSetup.call(this, builder);
  };
  patched._xrPatched = true;
  UniformArrayNode.prototype.setup = patched;
}

/**
 * BUG C -- A LIGHT IS POSITIONED FROM THE HEAD, WHILE THE SURFACE IS POSITIONED PER EYE.
 *
 * This is the one that makes a lit surface look wrong in stereo rather than simply absent, and
 * the generated GLSL states it plainly. The vertex shader builds the surface per eye:
 *
 *     cameraViewMatrix = buffer969[ v_cameraIndex ];                       // PER EYE
 *     modelViewMatrix  = cameraViewMatrix * nodeUniform8;                  // per eye
 *     v_positionView   = ( modelViewMatrix * vec4( positionLocal, 1 ) ).xyz;
 *     v_normalViewGeometry = normalize( ( cameraViewMatrix * vec4( ... ) ).xyz );
 *
 * and the fragment shader then subtracts a light position that is not:
 *
 *     nodeVar0 = ( nodeUniform7 - v_positionView );
 *
 * `nodeUniform7` comes from three's `lightViewPosition`, which is a **renderGroup** uniform --
 * one value per render call, shared by both eyes -- computed on the CPU as the light's world
 * position through `camera.matrixWorldInverse`. Under an ArrayCamera that `camera` is the ARRAY
 * camera, i.e. the head. So every light vector is a head-space light minus an eye-space
 * surface, and the residual is a fixed half-IPD offset, opposite in each eye.
 *
 * The error is a constant ~32mm in world units and does NOT shrink with the model, so its
 * angular size is 32mm / (light-to-surface distance). At a normal working scale that is a few
 * degrees; with `_worldGroup` grip-scaled down, where the sculpt is only centimetres across, it
 * is tens of degrees. That is why this reads as "the terminator is shifted, the specular is
 * misplaced" and why it gets worse as the world is scaled down.
 *
 * It is also why matcap is unaffected (no lights in its graph) and why the hand-written BRDF in
 * NodePBR.js was fine (it works in WORLD space).
 *
 * Fix: stop pre-transforming the light on the CPU. Take the light's WORLD position -- which is
 * camera-independent and therefore safe to share between eyes -- and transform it in the shader
 * with the per-eye `cameraViewMatrix`. One mat4 multiply, and both eyes get their own answer.
 */
function installPerEyeLightVector(WGPU, TSL, renderer) {
  const { cameraViewMatrix, lightPosition, positionView, vec4 } = TSL;

  // AnalyticLightNode is not exported, so reach it through a concrete subclass: the renderer's
  // node library maps a light CLASS to its node class, and PointLightNode extends
  // AnalyticLightNode directly -- so its prototype's prototype is the one to patch, and spot
  // lights inherit the fix. (Directional lights do not use getLightVector; they go through
  // lightTargetDirection, which is already built from world space and is per-eye correct.)
  const lib = renderer.library;
  if (!lib || !lib.getLightNodeClass) { console.warn('[xrpatch] no node library'); return false; }
  const PointLightNode = lib.getLightNodeClass(WGPU.PointLight);
  if (!PointLightNode) { console.warn('[xrpatch] no PointLightNode'); return false; }
  const AnalyticLightNode = Object.getPrototypeOf(PointLightNode.prototype);
  if (!AnalyticLightNode || typeof AnalyticLightNode.getLightVector !== 'function') {
    console.warn('[xrpatch] getLightVector not found');
    return false;
  }
  if (AnalyticLightNode.getLightVector._xrPatched) return true;

  const patched = function (builder) {
    // lightPosition() is the light's WORLD position: a renderGroup uniform, but a
    // camera-independent one, so one value for two eyes is correct. cameraViewMatrix is the
    // per-eye array indexed by cameraIndex, so this lands in the SAME space as positionView.
    const lightViewPerEye = cameraViewMatrix.mul(vec4(lightPosition(this.light), 1.0)).xyz;
    return lightViewPerEye.sub(builder.context.positionView || positionView);
  };
  patched._xrPatched = true;
  AnalyticLightNode.getLightVector = patched;
  return true;
}

/**
 * BUG D -- A NESTED RENDER INSIDE AN XR FRAME IS HIJACKED BY THE XR CAMERA.
 *
 * matt, from the headset, and he had the shape of it before I did: "is the shadow pass somehow
 * messing up the other render passes?" Yes. Renderer.render() begins with
 *
 *     if ( xr.enabled === true && xr.isPresenting === true ) {
 *         if ( xr.cameraAutoUpdate === true ) xr.updateCamera( camera );
 *         camera = xr.getCamera();
 *     }
 *
 * and ShadowNode.updateShadow renders the shadow map with a NESTED renderer.render( scene,
 * shadow.camera ) from inside the XR frame. Two things follow, both fatal:
 *
 *   1. xr.updateCamera( shadow.camera ) copies the SHADOW camera's near/far onto both eye
 *      cameras and pushes them to the compositor via session.updateRenderState({ depthNear,
 *      depthFar }). The whole view's clipping becomes whatever the shadow frustum wanted --
 *      which is why matt saw the near plane move as soon as a light existed, why it tracked
 *      world scale (the shadow near is derived from it), and why turning shadows off restored
 *      everything.
 *   2. `camera = xr.getCamera()` then REPLACES the shadow camera with the XR array camera, so
 *      the shadow map is rendered from the user's eyes instead of from the light. Hence a map
 *      that contains the wrong view, and no shadow.
 *
 * It also explains the GL_INVALID_OPERATION mailbox / shared-image flood: the nested render
 * re-binds and restores the XR render target, whose textures are compositor-owned.
 *
 * Fix: a nested render inside an XR frame is by definition an offscreen pass -- a shadow map,
 * a probe -- and must never be given the session's camera or framebuffer. Count the depth and
 * turn xr.enabled off for the inner one. The outer frame is untouched.
 */
function installNestedRenderGuard(renderer) {
  if (renderer._xrNestedGuard) return;
  renderer._xrNestedGuard = true;

  const orig = renderer.render.bind(renderer);
  let depth = 0;
  // COUNTERS, because this guard cannot be tested on the desktop at all -- isPresenting is
  // false there, so it never engages. One session with these in the report says whether it is
  // firing, instead of another round of inference.
  const stats = { outer: 0, nested: 0, guarded: 0, maxDepth: 0 };
  renderer._xrNestedStats = stats;

  renderer.render = function (scene, camera) {
    const xr = renderer.xr;
    const nested = depth > 0 && xr && xr.enabled === true && xr.isPresenting === true;

    depth++;
    if (depth > stats.maxDepth) stats.maxDepth = depth;
    if (depth === 1) stats.outer++; else stats.nested++;
    if (nested) stats.guarded++;

    // SURGICAL, NOT BLUNT. The first version of this guard cleared xr.enabled for the inner
    // render, which does stop the hijack -- matt confirmed the clipping and the mailbox errors
    // both went away -- but it also changes what the renderer thinks its drawing buffer and
    // output target are, and the shadow map came back EMPTY in a session while being correct
    // on the desktop (xrShadowProbe: 255 on every face, for a point AND a spot light).
    //
    // So disable only the two things that actually cause the hijack, and leave the rest of the
    // XR path exactly as it is:
    //   - cameraAutoUpdate off, so xr.updateCamera() cannot copy the shadow camera's near/far
    //     onto the eye cameras and the compositor;
    //   - getCamera() returns the camera this render was actually given, so the shadow map is
    //     rendered from the light rather than from the head.
    let savedAuto, savedGetCamera;
    if (nested) {
      savedAuto = xr.cameraAutoUpdate;
      savedGetCamera = xr.getCamera;
      xr.cameraAutoUpdate = false;
      xr.getCamera = () => camera;
    }
    try {
      return orig(scene, camera);
    } finally {
      if (nested) {
        xr.cameraAutoUpdate = savedAuto;
        xr.getCamera = savedGetCamera;
      }
      depth--;
    }
  };
}

/**
 * BUG F -- THE SHADOW FRUSTUM IS THE USER'S FALLOFF SLIDER, AND IT SHOULD NOT BE.
 *
 * Both shadow paths derive the shadow camera's far plane from `light.distance`:
 *
 *     SpotLightShadow.updateMatrices:   const far = light.distance || camera.far;
 *     PointShadowNode.renderShadow:     const far = light.distance || camera.far;
 *
 * `light.distance` is the Falloff control. So the depth range the shadow map has to resolve
 * is whatever reach the user dialled in, for a model that is usually a tiny fraction of it.
 * matt, once shadows finally appeared: "it's too tuned to falloff, I have to find the sweet
 * spot; falloff too large and the shadow disappears, same with it being too small... falloff
 * shouldn't be affecting this at all." His probe: near 2.53, far 162, and FIVE pixels out of
 * 4096 carrying any depth at all -- the sculpt was a sliver of a 162-unit range.
 *
 * Note the `||`: a distance of ZERO means three leaves `camera.far` alone. So the fix is to
 * hand it a fitted far for the duration of the shadow render and put the user's value back
 * immediately, which keeps Falloff driving the LIGHTING and nothing else. The fitted frustum
 * is set per light in Scene._syncThreeLights as `light.userData._shadowFit`.
 */
function installShadowFrustumFit(WGPU, renderer) {
  const lib = renderer.library;
  if (!lib || !lib.getLightNodeClass) return false;
  const PointLightNodeClass = lib.getLightNodeClass(WGPU.PointLight);
  if (!PointLightNodeClass) return false;

  let PointShadowNodeProto;
  try {
    const node = new PointLightNodeClass(new WGPU.PointLight());
    PointShadowNodeProto = Object.getPrototypeOf(node.setupShadowNode());
  } catch (e) {
    console.warn('[xrpatch] could not reach PointShadowNode: ' + e.message);
    return false;
  }
  const ShadowNodeProto = Object.getPrototypeOf(PointShadowNodeProto);

  const wrap = (proto, label) => {
    if (!proto || !Object.prototype.hasOwnProperty.call(proto, 'renderShadow')) return;
    if (proto.renderShadow._xrFit) return;
    const orig = proto.renderShadow;
    const patched = function (frame) {
      const light = this.light;
      const fit = light && light.userData && light.userData._shadowFit;
      const saved = light ? light.distance : undefined;
      if (fit) {
        // A distance of 0 is what makes three keep OUR camera.far, but the point path reads
        // `light.distance || camera.far` and then pins it, so hand it the fitted far directly.
        light.distance = fit.far;
        const cam = this.shadow && this.shadow.camera;
        if (cam) { cam.near = fit.near; cam.far = fit.far; cam.updateProjectionMatrix(); }
      }
      try {
        return orig.call(this, frame);
      } finally {
        if (fit) light.distance = saved;
      }
    };
    patched._xrFit = true;
    patched._label = label;
    proto.renderShadow = patched;
  };

  wrap(PointShadowNodeProto, 'point');
  wrap(ShadowNodeProto, 'base');
  return true;
}

/**
 * Both patches. Call once, straight after `renderer.init()` and before anything is drawn --
 * bug A rewrites binding points that get baked into programs at link time, so it has to be in
 * place before the first material compiles.
 */
export function applyXRBackendPatches(renderer, WGPU, TSL) {
  if (renderer.backend && renderer.backend.gl) installStableBindingPoints(renderer.backend);
  installCameraPositionUpdate(WGPU, TSL);
  // ?perEyeLight=0 leaves three's head-space light vector in place, to A/B against the fault.
  if (!/[?&]perEyeLight=0/.test(window.location.search)) {
    installPerEyeLightVector(WGPU, TSL, renderer);
  }
  // ?xrnested=0 leaves the nested render unguarded, to A/B against the fault.
  if (!/[?&]xrnested=0/.test(window.location.search)) {
    installNestedRenderGuard(renderer);
  }
  // ?shadowfit=0 gives the shadow frustum back to the Falloff slider, to A/B against it.
  if (!/[?&]shadowfit=0/.test(window.location.search)) {
    installShadowFrustumFit(WGPU, renderer);
  }
}

export default { applyXRBackendPatches };
