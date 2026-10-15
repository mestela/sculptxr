// SHADOW HARNESS — paste into the app console (?renderer=webgpu) on the desktop.
//
// Ad-hoc console snippets produced three wrong conclusions in a row, because every run
// changed more than one thing. This builds the scene ONCE and exposes one-variable levers.
//
//   sh.build()            receiver plane (with the color + aMaterial attributes our material
//                         reads -- without them metalness is garbage and a metal surface has
//                         no diffuse for a shadow to darken), overhead point light, frozen sync
//   sh.pulse()            shadow.needsUpdate = true
//   sh.auto(true|false)   shadow.autoUpdate
//   sh.env(n)             envMapIntensity on the PBR material
//   sh.light(x,y,z)       move the light (and report whether the map follows)
//   sh.state()            every value that matters, in one line
//   sh.frames(n)          drive n frames -- applyRender + setTimeout, because requestAnimation-
//                         Frame does not fire while the browser pane is hidden
window.sh = (() => {
  const app = window.sculptgl_instance;
  const T = app._THREE_GPU;
  const frames = async (n = 12) => {
    for (let i = 0; i < n; i++) { app.applyRender(); await new Promise((r) => setTimeout(r, 16)); }
  };
  const L = () => app._lightPool && app._lightPool[0] && app._lightPool[0][0];

  const build = async () => {
    await frames(6);                       // the pool is built by _syncThreeLights, so let it run
    const sculpt = app.getMeshes().find((m) => !m._isLight).getThreeMesh();
    window._ourMat = sculpt.material;
    if (!window._plane) {
      const g = new T.PlaneGeometry(500, 500);
      const n = g.attributes.position.count;
      const col = new Float32Array(n * 3).fill(1);
      const mt = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { mt[i * 3] = 0.85; mt[i * 3 + 1] = 0; mt[i * 3 + 2] = 0; }
      g.setAttribute('color', new T.BufferAttribute(col, 3));
      g.setAttribute('aMaterial', new T.BufferAttribute(mt, 3));
      const p = new T.Mesh(g, window._ourMat);
      p.rotation.x = -Math.PI / 2;
      p.position.set(0, -95, 0);
      p.receiveShadow = true; p.castShadow = false; p.frustumCulled = false;
      window._sxrWorldGroup.add(p);
      window._plane = p;
    }
    window._noThreeLights = 1;             // freeze the sync so these values survive the frame
    const l = L();
    l.position.set(0, 320, 80); l.updateMatrixWorld(true);
    l.intensity = 400000; l.distance = 1500; l.decay = 2;
    l.castShadow = true; l.shadow.intensity = 1; l.shadow.autoUpdate = true;
    l.shadow.bias = 0; l.shadow.normalBias = 0.5;
    l.shadow.camera.near = 1; l.shadow.camera.far = 1500;
    l.shadow.camera.updateProjectionMatrix();
    l.shadow.needsUpdate = true;
    await frames(15);
    return state();
  };

  const state = () => {
    const l = L(); const s = l && l.shadow;
    return {
      lightPos: l ? l.position.toArray().map((v) => +v.toFixed(1)) : null,
      intensity: l && l.intensity, distance: l && l.distance,
      castShadow: l && l.castShadow,
      autoUpdate: s && s.autoUpdate, needsUpdate: s && s.needsUpdate,
      shadowIntensity: s && s.intensity,
      camNear: s && s.camera.near, camFar: s && s.camera.far,
      mapDepthVersion: s && s.map && s.map.depthTexture ? s.map.depthTexture.version : null,
      envI: window._ourMat && window._ourMat.envMapIntensity,
      planeReceive: window._plane && window._plane.receiveShadow,
      tris: app._renderer.info.render.triangles, dc: app._renderer.info.render.drawCalls
    };
  };

  return {
    frames, build, state,
    pulse: async (n = 10) => { L().shadow.needsUpdate = true; await frames(n); return state(); },
    auto: async (b, n = 20) => { L().shadow.autoUpdate = b; await frames(n); return state(); },
    env: async (v, n = 20) => { window._ourMat.envMapIntensity = v; window._ourMat.needsUpdate = true; await frames(n); return state(); },
    light: async (x, y, z, n = 20) => { const l = L(); l.position.set(x, y, z); l.updateMatrixWorld(true); await frames(n); return state(); },
    shader: async () => {
      const r = app._renderer;
      const sh = await r.debug.getShaderAsync(app._scene, app._camera.getThreeCamera(), window._plane);
      window._planeShader = sh;
      const f = sh.fragmentShader;
      return { len: f.length, shadowLines: f.split('\n').filter((x) => /shadow/i.test(x)).length };
    }
  };
})();
'shadow harness ready — sh.build() first'
