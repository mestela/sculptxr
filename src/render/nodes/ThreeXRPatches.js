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
 * NOT A BUG -- A DEVICE CHOICE. THE PROJECTION-LAYER COMPOSITOR PATH.
 *
 * three's WebGPU XRManager picks its XR layer type from a CAPABILITY check:
 *
 *     this._supportsLayers = this._supportsGlBinding
 *       && 'createProjectionLayer' in XRWebGLBinding.prototype;
 *
 * and nothing on that branch consults `session.enabledFeatures`. So NOT asking for the 'layers'
 * optional feature -- which is what fixed this on the legacy renderer, and is still correctly
 * commented in SculptGL's requestSession -- does not move it here. GalaxyXR's browser has
 * createProjectionLayer, so three builds an XRProjectionLayer either way, and its compositor
 * takes several seconds to come up: the grey "liminal space" void before the scene appears.
 * matt: "maybe 1 in 10" and getting worse.
 *
 * (`_sessionUsesLayers`, which DOES read enabledFeatures, only decides whether extra quad and
 * cylinder layers go native. It has no say in the projection layer itself.)
 *
 * So the choice is forced here instead: clearing the flag takes three's own XRWebGLLayer
 * fallback, which is the path the app ran on for its whole life before the port.
 *
 * WHAT IT COSTS: multiview lives inside the projection-layer branch, so this gives it up --
 * two passes rather than one where the device supports OVR_multiview2. That is a frame-rate
 * question; a five-second void on one launch in ten is a "did it crash" question. `?xrlayers=1`
 * restores three's choice so the two can be compared on the same build.
 */
function installXRLayerChoice(renderer) {
  const xr = renderer && renderer.xr;
  if (!xr) return;
  // NOT ON SAFARI / VISION PRO.
  //
  // This forces three's XRWebGLLayer fallback because the projection-layer compositor is slow to
  // come up on a GalaxyXR. It is a Chrome-on-Adreno problem, and the fallback is the less-used
  // path in three -- matt, after this landed: "webgpu doesn't seem to work on avp at all; when i
  // go into vr mode there, i just get black."
  //
  // That is not proven to be this patch, and I cannot test an AVP. But a black session on the one
  // runtime whose layer handling differs most, right after changing which layer gets built, is
  // not a coincidence worth defending. `?xrlayers=1` still forces three's own choice everywhere;
  // `?xrlayers=0` forces the fallback even here, which is how to test whether this is the cause.
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  const isSafari = /Safari/.test(ua) && !/Chrome|Chromium|OculusBrowser/.test(ua);
  const forced = /[?&]xrlayers=0/.test((typeof window !== 'undefined' && window.location.search) || '');
  if (isSafari && !forced) {
    console.log('[xrpatch] XR layer path: left to three (Safari/visionOS) — ?xrlayers=0 to force '
      + 'the XRWebGLLayer fallback here too');
    return;
  }
  if ('_supportsLayers' in xr) {
    const was = xr._supportsLayers;
    xr._supportsLayers = false;
    console.log('[xrpatch] XR layer path: XRWebGLLayer (three wanted '
      + (was ? 'XRProjectionLayer' : 'XRWebGLLayer') + '); ?xrlayers=1 to compare');
  } else {
    // three renamed or removed it. Say so rather than failing silently: the symptom is a slow
    // launch, which nobody would trace back to a patch that quietly stopped applying.
    console.warn('[xrpatch] XRManager has no _supportsLayers; the projection-layer delay is '
      + 'back in play. Check three\'s XRManager against this patch.');
  }
}

/**
 * WHAT IS COMPILING, NAMED, AT THE MOMENT IT COMPILES.
 *
 * Every attempt at the launch stutters so far has been inference from counters: the pipeline
 * cache grew by fourteen, so it must be the batches; it grew on the first bone, so it must be
 * the locator. That got two of them and missed the rest, and matt has now watched "Compiling
 * shaders" appear five separate times in one session with no way to tell what for. "surely when
 * the warning pops up in vr, log to the console what is being compiled."
 *
 * three builds a pipeline inside Pipelines.getForRender, and the renderObject it is handed knows
 * everything worth knowing: the object, its material, its geometry, and the camera whose shape
 * decides the shader. So this wraps that one method, notices when the caches actually GREW, and
 * prints the thing that caused it with how long it took.
 *
 * The camera matters most of all here. A line that says ArrayCamera[2] is a session-shaped
 * pipeline being built inside the session; PerspectiveCamera is the desktop shape. If the
 * launch-time stereo warm is working, nothing should print ArrayCamera after the session starts.
 *
 * On by default -- it costs four Map.size reads per render object per frame and answers the only
 * question anyone has been asking for three rounds. window._pipeTrace = false to silence it,
 * compileReport() for the tally.
 */
function installPipelineTrace(renderer) {
  const pl = renderer && renderer._pipelines;
  if (!pl || typeof pl.getForRender !== 'function' || pl.__traced) return;
  pl.__traced = true;

  const tally = new Map();
  const times = [];
  const size = (m) => (m && typeof m.size === 'number' ? m.size : 0);
  const counts = () => [size(pl.caches), size(pl.programs && pl.programs.vertex),
    size(pl.programs && pl.programs.fragment)];

  const describe = (renderObject) => {
    const ro = renderObject;
    const o = ro.object || {};
    const m = ro.material || {};
    const g = ro.geometry || {};
    const c = ro.camera || {};
    const cam = c.isArrayCamera ? ('ArrayCamera[' + ((c.cameras && c.cameras.length) || 0) + ']')
      : (c.type || 'camera');
    const pos = g.attributes && g.attributes.position;
    const geo = (g.type || 'geometry') + (pos ? '(' + pos.count + 'v)' : '')
      + (o.isInstancedMesh ? ' x' + o.count : '');
    const name = o.name || m.name || o.type || 'object';
    // MATERIAL ID AND VERSION, because the same description appearing twice is the question the
    // first version of this could not answer. A new id is a different material object; the same
    // id at a higher version is the SAME material recompiled after a needsUpdate -- which is what
    // the session boundary does to all of them at once.
    const tag = '#' + (m.id !== undefined ? m.id : '?') + 'v' + (m.version || 0);
    // THE RENDER OBJECT'S OWN IDENTITY, which is what the duplicates question comes down to.
    //
    // A pipeline is released the moment its usedTimes hits 0, so the same description compiling
    // four times means the render object was dropped and remade three times. `ro` is its uuid
    // (a new one = a new render object) and `key` is its cache key, which is what three compares
    // to decide whether to dispose and rebuild. Same uuid twice means one object recompiling;
    // different uuids mean the object itself is being churned.
    if (window._pipeTraceKeys) {
      let ro = '?', key = '?';
      try {
        ro = (renderObject.id !== undefined ? 'ro' + renderObject.id : '?');
        key = String(renderObject.getCacheKey ? renderObject.getCacheKey() : '?');
      } catch (e) { /* a probe never breaks a draw */ }
      return (m.type || 'material') + tag + ' on ' + name + ', ' + geo + ', ' + cam
        + '  [' + ro + ' key ' + key + ' objuuid ' + String(o.uuid).slice(0, 6) + ']';
    }
    return (m.type || 'material') + tag + ' on ' + name + ', ' + geo + ', ' + cam;
  };

  const orig = pl.getForRender.bind(pl);
  window._pipeBuilt = 0;
  window._pipeBuiltMs = 0;
  pl.getForRender = function (renderObject, promises) {
    // THE COUNT IS ALWAYS KEPT; ONLY THE LOG IS OPTIONAL. window._pipeTrace used to bypass the
    // whole wrapper, which meant silencing the console also silenced every tally built on it.
    // A BUILD COUNTER, NOT A CACHE SIZE. pl.caches.size goes DOWN as well as up -- three runs
    // usedTimes--/_releasePipeline, and a session transition disposes the desktop render objects
    // -- so anything watching the size for growth is watching a high-water mark and reports zero
    // while the app is busily rebuilding. That is what the first steady-state metric did.
    const before = counts();
    const t0 = performance.now();
    const out = orig(renderObject, promises);
    const after = counts();
    if (after[0] === before[0] && after[1] === before[1] && after[2] === before[2]) return out;
    const ms = performance.now() - t0;
    const what = describe(renderObject);
    tally.set(what, (tally.get(what) || 0) + 1);
    times.push(ms);
    window._pipeBuilt++;
    window._pipeBuiltMs += ms;
    if (window._pipeTrace === false) return out;
    const built = [];
    if (after[0] > before[0]) built.push('pipeline');
    if (after[1] > before[1]) built.push('vertex');
    if (after[2] > before[2]) built.push('fragment');
    // Guarded rather than raw: a burst of these is exactly when the frame can least afford the
    // console, and the tally below keeps what the log drops.
    console.log('[compile] ' + built.join('+') + ' ' + ms.toFixed(0) + 'ms — ' + what);
    return out;
  };

  window.compileReport = function () {
    const rows = [...tally.entries()].sort((a, b) => b[1] - a[1]);
    // TOTAL AND MEDIAN MILLISECONDS, not just counts.
    //
    // matt: "i'm also curious why its so intermittent? ... maybe 4 times it'll start
    // immediately, the 5th it will be slow. but there's no pattern to it."
    //
    // A count alone cannot tell the two apart, and the difference between them is the whole
    // question. If a slow launch builds the SAME number of pipelines but each takes ten times
    // as long, the work is identical and the driver's own program cache was cold -- which is
    // outside this app entirely and would explain the lack of pattern. If a slow launch builds
    // MORE, something here is making extra work and it is ours to find. One line settles it.
    const ms = times.slice().sort((a, b) => a - b);
    const sum = Math.round(ms.reduce((a, b) => a + b, 0));
    const med = ms.length ? ms[ms.length >> 1].toFixed(1) : '0';
    console.log('[compile] ' + rows.length + ' distinct, '
      + rows.reduce((n, r) => n + r[1], 0) + ' total, ' + sum + 'ms spent, median '
      + med + 'ms each');
    for (const [what, n] of rows) console.log('[compile]   x' + n + '  ' + what);
    return rows.length;
  };
  window.compileReportReset = function () { tally.clear(); times.length = 0; return 0; };
  console.log('[xrpatch] compile trace on — every pipeline build names itself; compileReport() '
    + 'for the tally, window._pipeTrace = false to silence');
}

/**
 * SAFARI REPORTS THE XR FRAMEBUFFER AS 1x1 UNTIL THE FIRST requestAnimationFrame.
 *
 * three sizes the whole session from inside setSession, which is async and runs before any
 * frame callback:
 *
 *     renderer._setXRLayerSize( glBaseLayer.framebufferWidth, glBaseLayer.framebufferHeight );
 *     this._xrRenderTarget = new XRRenderTarget( glBaseLayer.framebufferWidth, ... );
 *
 * WebKit refuses to answer that early and says so, once per query:
 *
 *     accurate framebufferWidth is unavailable until requestAnimationFrame processing;
 *     returning 1
 *
 * So the session renders into a ONE PIXEL target for its entire life. Every log line looks
 * healthy -- pipelines compile, cameras are ArrayCamera[2], steady state reports normally --
 * and the headset shows black. matt, on Vision Pro: "i just saw black, nothing else."
 *
 * Chromium answers the query immediately, which is why the GalaxyXR never showed this and why
 * it looked like a Vision Pro problem rather than a three one. three never re-reads the values:
 * _setXRLayerSize is called at setSession and at session end, and nowhere in between.
 *
 * Cheap enough to check every frame -- two property reads and a compare -- and a no-op the
 * moment they agree, which on a Chromium runtime is the first time it is ever called.
 */
export function fixXRLayerSize(renderer) {
  const xr = renderer && renderer.xr;
  const rt = xr && xr._xrRenderTarget;
  if (!rt) return false;
  // EITHER LAYER. Safari/visionOS takes the XRProjectionLayer branch, which sizes from
  // textureWidth/textureHeight and never sets _glBaseLayer; Chromium takes the XRWebGLLayer
  // branch and never sets _glProjLayer. Both read their size at setSession, so both are wrong
  // on a runtime that refuses to answer that early.
  const pl = xr._glProjLayer, bl = xr._glBaseLayer;
  const w = pl ? pl.textureWidth : (bl ? bl.framebufferWidth : 0);
  const h = pl ? pl.textureHeight : (bl ? bl.framebufferHeight : 0);
  // 1x1 IS THE SENTINEL, not a size to adopt: believing it is how we got here.
  if (!(w > 1 && h > 1)) return false;
  const wasW = rt.width, wasH = rt.height;      // CAPTURED BEFORE THE RESIZE, because reading
  if (wasW === w && wasH === h) return false;   // them afterwards reports the new size as the old
  renderer._setXRLayerSize(w, h);
  rt.setSize(w, h);
  console.log('[xrpatch] XR ' + (pl ? 'projection layer' : 'framebuffer') + ' was '
    + wasW + 'x' + wasH + ' at setSession; resized to ' + w + 'x' + h
    + ' once rAF could answer');
  return true;
}

/**
 * Both patches. Call once, straight after `renderer.init()` and before anything is drawn --
 * bug A rewrites binding points that get baked into programs at link time, so it has to be in
 * place before the first material compiles.
 */
export function applyXRBackendPatches(renderer, WGPU, TSL) {
  // A BISECTION SWITCH, TO BE DELETED THE MOMENT IT IS ANSWERED. Every patch in this file was
  // written against the GalaxyXR and none has ever been checked on Safari, where the uniform
  // binding budget is half the size (max 32 against 72). matt on Vision Pro, once the 1x1
  // framebuffer was fixed: "its rendering, but its really warped and distorted" -- and the
  // legacy renderer on the same headset is correct, so it is something on this path.
  //   ?xrbind=0   skip the binding-point rewrite
  //   ?xrbind=0    skip the binding-point rewrite alone
  //   ?xrpatch=0   skip ALL of them, which answers "is this file involved at all" in one trip
  const _q = window.location.search;
  const _skipAll = /[?&]xrpatch=0/.test(_q);
  const _skipBind = _skipAll || /[?&]xrbind=0/.test(_q);
  if (_skipAll) console.log('[xrpatch] ALL XR backend patches SKIPPED (?xrpatch=0) — trace only');
  else if (_skipBind) console.log('[xrpatch] binding-point rewrite SKIPPED (?xrbind=0)');
  if (!_skipBind && renderer.backend && renderer.backend.gl) installStableBindingPoints(renderer.backend);
  if (_skipAll) { installPipelineTrace(renderer); return; }
  installCameraPositionUpdate(WGPU, TSL);
  // ?perEyeLight=0 leaves three's head-space light vector in place, to A/B against the fault.
  {
    installPerEyeLightVector(WGPU, TSL, renderer);
  }
  // ?xrnested=0 leaves the nested render unguarded, to A/B against the fault.
  {
    installNestedRenderGuard(renderer);
  }
  // Names every pipeline as it is built. See installPipelineTrace.
  installPipelineTrace(renderer);
  // ?xrlayers=1 leaves three to pick the projection layer, to A/B against the slow launch.
  // Read from the URL the same way ?xrpatch=0 is, and for the same reason: this runs during
  // renderer init, and a window flag set afterwards would be read too late to matter.
  if (!/[?&]xrlayers=1/.test((typeof window !== 'undefined' && window.location.search) || '')) {
    installXRLayerChoice(renderer);
  }
}

export default { applyXRBackendPatches };

/**
 * A HIGHER-TAP PCF FILTER, because five samples read as dither.
 *
 * three's PCFShadowFilter takes exactly FIVE samples on a Vogel disk, rotated per pixel by
 * interleaved gradient noise. Five samples is too few to hide the rotation, so the penumbra
 * comes out as a structured screen-space pattern rather than a gradient, and it gets worse the
 * wider the radius -- matt: "there's clear dithering patterns on the softness".
 *
 * `LightShadow.filterNode` is a supported per-shadow override (ShadowNode: `shadow.filterNode ||
 * this.getShadowFilterFn(...)`), so this needs no patching of three at all: same Vogel disk,
 * same IGN rotation, just enough taps that the pattern averages out. 16 is the knee -- 5 is
 * visibly dithered, 16 reads smooth, and beyond that costs samples for very little.
 *
 * The alternative is VSM, which blurs the moments with a real separable Gaussian and has no
 * dither at all, but it leaks light through thin geometry and adds two blur passes per update.
 * Worth trying if 16 taps is still not smooth enough; this is the cheaper move first.
 */
export function makePCFFilter(TSL, taps = 16) {
  const { Fn, texture, reference, screenCoordinate, vogelDiskSample,
    interleavedGradientNoise, vec2, float } = TSL;

  return Fn(({ depthTexture, shadowCoord, shadow, depthLayer }) => {
    const compare = (uv) => {
      let d = texture(depthTexture, uv);
      if (depthTexture.isArrayTexture) d = d.depth(depthLayer);
      return d.compare(shadowCoord.z);
    };
    const mapSize = reference('mapSize', 'vec2', shadow);
    const radius = reference('radius', 'float', shadow);
    const radiusScaled = radius.mul(vec2(1).div(mapSize).x);
    const phi = interleavedGradientNoise(screenCoordinate.xy).mul(6.28318530718);

    let sum = compare(shadowCoord.xy.add(vogelDiskSample(0, taps, phi).mul(radiusScaled)));
    for (let i = 1; i < taps; i++) {
      sum = sum.add(compare(shadowCoord.xy.add(vogelDiskSample(i, taps, phi).mul(radiusScaled))));
    }
    return sum.mul(float(1 / taps));
  });
}
