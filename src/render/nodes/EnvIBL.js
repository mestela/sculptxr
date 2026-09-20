// THE ENVIRONMENT AS A REAL IBL, via PMREM.
//
// The five environments ship as LogLUV-encoded octahedral PNGs with a hand-packed mip
// pyramid -- a WebGL1-era format, chosen when float textures were not guaranteed. matt:
// "can't we just move to a generic low res latlong exr?" Yes, and this is that move without
// a download or a new asset pipeline: the existing PNG is decoded ONCE at load into a float
// equirect, and three's PMREMGenerator prefilters it for the PBR material to sample.
//
// What that buys: hardware trilinear filtering instead of two fetches plus a manual lerp,
// proper roughness prefiltering instead of five hand-packed levels, correct rough
// reflections on MeshPhysicalNodeMaterial for free -- and it deletes decodeLUV, toUVMipmap,
// directionToUV and integrateBRDFApprox from the shader, which were the most fragile code in
// the port.
//
// The decode is CPU-side and runs once per environment. A 512x512 octahedral level 0 into a
// 1024x512 equirect is about half a million samples -- a few tens of milliseconds, at load,
// off the render path.

// LogLUV, as the GLSL decoded it. The matrix is the same one, written row-wise here because
// GLSL's mat3(a,b,c) takes COLUMNS and transcribing it as rows is the classic way to get a
// colour transform subtly wrong.
const LUV_C0 = [6.0013, -2.700, -1.7995];
const LUV_C1 = [-1.332, 3.1029, -5.7720];
const LUV_C2 = [0.3007, -1.088, 5.6268];

function decodeLUV(r, g, b, a, out) {
  const Le = b * 255.0 + a;
  const y = Math.pow(2.0, (Le - 127.0) / 2.0);
  const z = y / Math.max(g, 1e-8);
  const x = r * z;
  out[0] = Math.max(LUV_C0[0] * x + LUV_C1[0] * y + LUV_C2[0] * z, 0);
  out[1] = Math.max(LUV_C0[1] * x + LUV_C1[1] * y + LUV_C2[1] * z, 0);
  out[2] = Math.max(LUV_C0[2] * x + LUV_C1[2] * y + LUV_C2[2] * z, 0);
}

// Direction -> octahedral UV. A transcription of directionToUV() in pbr.glsl, including the
// .yx swizzle on the lower hemisphere, which is easy to drop and produces a subtly folded
// environment rather than an obviously broken one.
function dirToOct(dx, dy, dz, out) {
  const sx = Math.sign(dx) || 1, sy = Math.sign(dy) || 1, sz = Math.sign(dz) || 1;
  const d = Math.abs(dx) + Math.abs(dy) + Math.abs(dz) || 1e-8;
  let ux = dx / d, uy = dy / d;
  const uz = dz / d;
  if (uz < 0) {
    const ax = Math.abs(ux), ay = Math.abs(uy);
    const nx = sx * (1 - ay);
    const ny = sy * (1 - ax);
    ux = nx; uy = ny;
  }
  out[0] = ux * 0.5 + 0.5;
  out[1] = uy * 0.5 + 0.5;
}

/**
 * Decode the packed panorama into a float equirect DataTexture.
 * Level 0 of the atlas is the top-left size x size block, inset by one pixel -- the same
 * arithmetic toUVMipmap() did on the GPU, evaluated here for lod 0.
 */
/**
 * RAW, UNPREMULTIPLIED PIXELS -- which a 2D canvas cannot give us.
 *
 * LogLUV packs the EXPONENT into the alpha channel. A canvas treats alpha as opacity and
 * premultiplies, so drawImage + getImageData silently destroys the data: measured on
 * studio_small_01, pixels came back (255, 255, 90, 34) with red and green saturated at 255,
 * and the decoded environment came out green. The decode maths was right; the pixels were
 * already ruined before it ran.
 *
 * ImageDecoder (WebCodecs) hands back the frame untouched. Chromium-only, which covers the
 * desktop and both headsets; the canvas path is kept as a fallback that SAYS it is wrong
 * rather than quietly producing a green room.
 */
async function loadPixels(path) {
  if (typeof ImageDecoder !== 'undefined') {
    const buf = await (await fetch(path)).arrayBuffer();
    const dec = new ImageDecoder({ data: buf, type: 'image/png' });
    const { image } = await dec.decode();
    const w = image.displayWidth, h = image.displayHeight;
    const out = new Uint8ClampedArray(w * h * 4);
    await image.copyTo(out, { format: 'RGBA' });
    image.close();
    return { data: out, width: w, height: h };
  }
  console.warn('[EnvIBL] no ImageDecoder — falling back to canvas, which premultiplies and '
    + 'WILL corrupt LogLUV alpha. The environment will be wrong.');
  const img = await new Promise((res, rej) => {
    const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = path;
  });
  const cv = document.createElement('canvas');
  cv.width = img.width; cv.height = img.height;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  return { data: ctx.getImageData(0, 0, img.width, img.height).data, width: img.width, height: img.height };
}

/**
 * Decode the packed panorama into a float equirect DataTexture.
 * Level 0 of the atlas is the top-left size x size block, inset by one pixel -- the same
 * arithmetic toUVMipmap() did on the GPU, evaluated here for lod 0.
 */
function toEquirect(gpu, px, outW, outH) {
  const src = px.data;
  const size = px.width;             // level 0 is width x width at the top of the atlas
  const data = new Float32Array(outW * outH * 4);
  const rgb = [0, 0, 0];
  const uv = [0, 0];

  for (let y = 0; y < outH; y++) {
    const theta = (y + 0.5) / outH * Math.PI;
    const sinT = Math.sin(theta), cosT = Math.cos(theta);
    for (let x = 0; x < outW; x++) {
      const phi = ((x + 0.5) / outW) * Math.PI * 2.0 - Math.PI;
      const dx = sinT * Math.sin(phi);
      const dy = cosT;
      const dz = -sinT * Math.cos(phi);
      dirToOct(dx, dy, dz, uv);
      const pxx = Math.min(size - 1, Math.max(0, Math.round(1 + uv[0] * (size - 2))));
      const pyy = Math.min(size - 1, Math.max(0, Math.round(1 + uv[1] * (size - 2))));
      const si = (pyy * px.width + pxx) * 4;
      decodeLUV(src[si] / 255, src[si + 1] / 255, src[si + 2] / 255, src[si + 3] / 255, rgb);
      const di = (y * outW + x) * 4;
      data[di] = rgb[0]; data[di + 1] = rgb[1]; data[di + 2] = rgb[2]; data[di + 3] = 1;
    }
  }

  const tex = new gpu.DataTexture(data, outW, outH, gpu.RGBAFormat, gpu.FloatType);
  tex.mapping = gpu.EquirectangularReflectionMapping;
  tex.colorSpace = gpu.NoColorSpace;   // already linear radiance, not colour
  tex.needsUpdate = true;
  return tex;
}

/**
 * Load `env`, prefilter it, and hand the PMREM texture back through `onDone`.
 * Deliberately does NOT touch scene.environment -- see the note at the assignment site.
 * Cached on the env record, so switching back and forth costs nothing.
 */
export function installEnvironment(gpu, renderer, scene, env, onDone) {
  if (!env) return;
  if (env._pmrem) { if (onDone) onDone(env._pmrem); return; }

  // AN .hdr EQUIRECT IF THE ENVIRONMENT HAS ONE. This is the path that should exist: an
  // ordinary equirect, RGBELoader, PMREM, done.
  if (env.hdr) { installHDR(gpu, renderer, scene, env, onDone); return; }

  // OTHERWISE: NOTHING, DELIBERATELY.
  //
  // Converting the legacy LogLUV octahedral atlas at runtime does not work yet and is not
  // worth more of anyone's evening. The decode below is a faithful transcription of the
  // GLSL, and it still produces values around 1e19 in green -- so the packed format differs
  // from what the shader comment describes in some way I have not found. Three diagnoses
  // were wrong on the way (canvas premultiplication, BGRA channel order, which half of the
  // atlas holds level 0), and the visible result each time was a green room.
  //
  // matt's original suggestion is the way out and is a small offline job: five equirect
  // .hdr files, which is where these environments came from in the first place (the paths in
  // ShaderPBR name them -- mpumalanga_veld, venetian_crossroads, studio_small_01,
  // moonless_golf, winter_river, all Poly Haven). Give each environment record an `hdr` path
  // and this function does the rest.
  //
  // Leaving scene.environment null until then, because a wrong environment that LOOKS
  // deliberate is worse than none: it silently mis-lights everything and invites tuning the
  // lights to compensate for it.
  if (!window._envConvertLegacy) {
    console.warn('[EnvIBL] ' + (env.name || env.path) + ': no .hdr equirect, and the legacy '
      + 'LogLUV atlas conversion is not trusted — leaving scene.environment unset. '
      + 'window._envConvertLegacy = 1 to try it anyway.');
    scene.environment = null;
    return;
  }
  loadPixels(env.path).then((px) => {
    const eq = toEquirect(gpu, px, 1024, 512);
    const pm = new gpu.PMREMGenerator(renderer);
    pm.compileEquirectangularShader();
    const rt = pm.fromEquirectangular(eq);
    env._pmrem = rt.texture;
    eq.dispose();
    pm.dispose();
    console.log('[EnvIBL] ' + env.name + ' prefiltered from ' + px.width + 'x' + px.height);
    if (onDone) onDone(rt.texture);
  }).catch((e) => console.error('[EnvIBL] failed for ' + env.path, e));
}

/** The path this should be on: an ordinary equirect HDR, loaded and prefiltered. */
function installHDR(gpu, renderer, scene, env, onDone) {
  // HDRLoader, not RGBELoader: same Radiance decoder, and RGBELoader now logs a deprecation
  // on every load.
  import('three/examples/jsm/loaders/HDRLoader.js').then(({ HDRLoader }) => {
    new HDRLoader().load(env.hdr, (tex) => {
      tex.mapping = gpu.EquirectangularReflectionMapping;
      const pm = new gpu.PMREMGenerator(renderer);
      const rt = pm.fromEquirectangular(tex);
      env._pmrem = rt.texture;
      // NOT scene.environment -- the caller puts it on the one material that wants it. See
      // the note in _syncThreeLights: a scene-wide environment injects an IBL lookup into
      // every material, including the unlit UI ones, and that combination does not survive
      // an XR session.
      tex.dispose();
      pm.dispose();
      console.log('[EnvIBL] ' + env.name + ' prefiltered from ' + env.hdr);
      if (onDone) onDone(rt.texture);
    }, undefined, (e) => console.error('[EnvIBL] hdr load failed ' + env.hdr, e));
  });
}

export default installEnvironment;
