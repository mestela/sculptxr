// ShaderPBR, AS TSL NODES — the PBR half of the WebGPURenderer port (roadmap #2).
//
// A TRANSCRIPTION, NOT AN IMPROVEMENT. The same GGX D, the same Schlick-Smith G with k = a/2,
// the same Schlick F, the same SH9 irradiance, the same octahedral LogLUV panorama, and the
// same DELIBERATELY NON-PHYSICAL falloff 1/(1 + d²/r²). Scene units here are arbitrary and
// large (a camel is ~180 across), so inverse-square would want intensities in the thousands
// and blow out the moment a light moved closer. Swapping any of these for the "correct" thing
// would change the look of every existing scene and make the Falloff slider mean something
// else, which is a design change wearing a port's clothes.
//
// WHAT IS NOT HERE YET, deliberately, because each needs per-mesh material plumbing that the
// node cache does not have (it builds ONE material per shader id, up front, and per-mesh
// textures need one material per mesh):
//   - the albedo map, the packed rough/metal map, the tangent-space normal map
//   - KHR transmission and its fresnel-weighted alpha
//   - the edit-matrix masking blend (uEM/uEN), used by posed sculpting
// Everything those touch falls back to the per-vertex channels, which is what a sculpt that
// has never been through glTF uses anyway.
//
// LIGHTS COME FROM ShaderPBR.getLightState so there is exactly one copy of that arithmetic.
import ShaderPBR from '../shaders/ShaderPBR.js';
import getOptionsURL from '../../misc/getOptionsURL.js';

const MAX_LIGHTS = 8;

export function makePBR(gpu, tsl, opts = {}) {
  // NO ARRAYS AT ALL (?pbrbisect=2): flat albedo times the scalar uniforms, no SH, no
  // panorama, no light loop. It looks wrong on purpose. The only question it answers is
  // whether this material's UNIFORM ARRAYS are what takes the menus down in an immersive
  // session -- packing the scalars into a vec4 did not, so the next cut has to remove them
  // rather than rearrange them.
  const noArrays = !!opts.noArrays;
  const {
    Fn, uniform, uniformArray, attribute, Loop, If, Break, vec2, vec3, vec4, float, mat3,
    positionView, normalView, normalize, dot, max, min, clamp, pow, mix, smoothstep, abs,
    sign, floor, ceil, fract, exp2, inversesqrt, texture, cameraViewMatrix, vertexColor,
    transpose, select,
  } = tsl;

  // ── uniforms, fed per frame by updateFrame() ───────────────────────────────
  const uExposure     = uniform(1.0);
  const uEnvIntensity = uniform(1.0);
  const uNbLights     = uniform(0, 'int');
  // BISECTION, not instrumentation: window._pbrDebug picks which term survives, so one look
  // says which third of this shader is wrong instead of five rounds of tracing.
  //   0 full   1 SH diffuse only   2 panorama specular only   3 lights only   4 albedo only
  const uDebug        = uniform(0, 'int');
  const uEnvSize      = uniform(new gpu.Vector2(1, 1));
  const uSPH        = uniformArray(new Array(9).fill(0).map(() => new gpu.Vector3()));
  const uLightPos   = uniformArray(new Array(MAX_LIGHTS).fill(0).map(() => new gpu.Vector3()));
  const uLightCol   = uniformArray(new Array(MAX_LIGHTS).fill(0).map(() => new gpu.Vector3()));
  const uLightDir   = uniformArray(new Array(MAX_LIGHTS).fill(0).map(() => new gpu.Vector3(0, 0, -1)));
  // ONE vec4 PER LIGHT: (range, type, coneOuter, coneInner).
  //
  // This was three separate arrays -- two of them arrays of plain NUMBERS. A uniform array of
  // scalars is the least-travelled path in three's std140 padding (every element pads to 16
  // bytes, so a float array is 4x its apparent size), and "GL_INVALID_OPERATION: it is
  // undefined behaviour to use a uniform buffer that is too small" showed up in XR on the PBR
  // material and on no other. Packing into vector types keeps every array on the well-trodden
  // path and makes the block smaller besides. SUSPECTED CAUSE, not a proven one: the error
  // only appears in an immersive session, which is the one place that cannot be checked from
  // the desktop.
  const uLightParams = uniformArray(new Array(MAX_LIGHTS).fill(0).map(() => new gpu.Vector4(1, 0, -1, -1)));

  // The environment panorama: an 8-bit PNG carrying HDR as LogLUV, with the mip pyramid
  // packed into the one image by hand. So NO colour-space conversion (these are encoded
  // numbers, not colours -- sRGB would bend them), NO generated mipmaps (the atlas is the
  // pyramid), and linear filtering to match what texture2D gave the GLSL.
  const env0 = ShaderPBR.environments[ShaderPBR.idEnv] || ShaderPBR.environments[0];
  const envTex = new gpu.TextureLoader().load(env0.path, (t) => {
    // uEnvSize is the ATLAS size and the GLSL reads it from the loaded image, so it cannot be
    // known before the load resolves; until then the panorama samples garbage.
    uEnvSize.value.set(t.image.width, t.image.height);
    if (!env0.size) env0.size = [t.image.width, t.image.height];
    console.log('[NodePBR] environment loaded ' + env0.path + ' ' + t.image.width + 'x' + t.image.height);
  }, undefined, (e) => {
    console.error('[NodePBR] environment FAILED to load: ' + env0.path, e);
  });
  envTex.colorSpace = gpu.NoColorSpace;
  envTex.generateMipmaps = false;
  envTex.minFilter = gpu.LinearFilter;
  envTex.magFilter = gpu.LinearFilter;
  envTex.wrapS = envTex.wrapT = gpu.ClampToEdgeWrapping;

  // ── the environment, exactly as the GLSL decodes it ────────────────────────
  // LogLUV, because the panorama is an 8-bit PNG carrying HDR. Same constants, same order.
  const LUVInverse = mat3(
    6.0013, -1.332, 0.3007,
    -2.700, 3.1029, -1.088,
    -1.7995, -5.7720, 5.6268);

  const decodeLUV = Fn(([logLuv]) => {
    const Le = logLuv.z.mul(255.0).add(logLuv.w);
    const y = exp2(Le.sub(127.0).div(2.0));
    // GUARDED, because the divisor is a texel. An environment that has not finished loading
    // -- or failed to -- is all zeros, so this divides by zero, and the NaN does not stay
    // local: it propagates through the IBL into the final colour and the whole mesh goes
    // black. That is what the first PBR device test showed, and a black mesh is a terrible
    // error message for "the panorama isn't there yet".
    const z = y.div(max(logLuv.y, float(1e-8)));
    const x = logLuv.x.mul(z);
    return LUVInverse.mul(vec3(x, y, z)).max(vec3(0.0));
  });

  // The mip pyramid is packed into one atlas by hand, so the LOD is arithmetic on the UV
  // rather than a sampler feature -- which is why this survives the move to nodes unchanged.
  const toUVMipmap = Fn(([lod, uv]) => {
    const widthForLevel = uEnvSize.x.div(exp2(lod));
    const local = vec2(1.0).add(uv.mul(widthForLevel.sub(2.0))).toVar();
    local.y.addAssign(uEnvSize.y.sub(widthForLevel.mul(2.0)));
    return local.div(uEnvSize);
  });

  const directionToUV = Fn(([dir]) => {
    const signOct = sign(dir);
    const uvOct = dir.div(dot(dir, signOct)).toVar();
    If(uvOct.z.lessThan(0.0), () => {
      uvOct.xy.assign(signOct.xy.mul(vec3(1.0).sub(abs(uvOct)).yx));
    });
    return uvOct.xy.mul(0.5).add(0.5);
  });

  const LIMIT_LOD = 5.0;
  const texturePanoramaLod = Fn(([direction, rLinear]) => {
    const lod = rLinear.mul(LIMIT_LOD - 1.0);
    const uvBase = directionToUV(direction);
    // Explicit level 0: the atlas IS the pyramid, so letting the sampler pick a mip would
    // read a blurred copy of the packed layout rather than the level we just addressed.
    const a = texture(envTex, toUVMipmap(floor(lod), uvBase)).level(0);
    const b = texture(envTex, toUVMipmap(ceil(lod), uvBase)).level(0);
    return decodeLUV(mix(a, b, fract(lod)));
  });

  const integrateBRDFApprox = Fn(([specular, roughness, NoV]) => {
    const c0 = vec4(-1, -0.0275, -0.572, 0.022);
    const c1 = vec4(1, 0.0425, 1.04, -0.04);
    const r = roughness.mul(c0).add(c1);
    const a004 = min(r.x.mul(r.x), exp2(NoV.mul(-9.28))).mul(r.x).add(r.y);
    const AB = vec2(-1.04, 1.04).mul(a004).add(r.zw);
    return specular.mul(AB.x).add(AB.y);
  });

  const getSpecularDominantDir = Fn(([N, R, realRoughness]) => {
    const smoothness = float(1.0).sub(realRoughness);
    return mix(N, R, smoothness.mul(smoothness.sqrt().add(realRoughness)));
  });

  const sphericalHarmonics = Fn(([N]) => {
    const x = N.x, y = N.y, z = N.z.negate();
    return uSPH.element(0)
      .add(uSPH.element(1).mul(y)).add(uSPH.element(2).mul(z)).add(uSPH.element(3).mul(x))
      .add(uSPH.element(4).mul(y).mul(x)).add(uSPH.element(5).mul(y).mul(z))
      .add(uSPH.element(6).mul(z.mul(z).mul(3.0).sub(1.0)))
      .add(uSPH.element(7).mul(z.mul(x)))
      .add(uSPH.element(8).mul(x.mul(x).sub(y.mul(y))))
      .max(vec3(0.0));
  });

  // THE ENVIRONMENT'S ORIENTATION, DERIVED PER EYE, for the same reason the GLSL derives it
  // there: a CPU-side uniform built from the desktop camera orients the whole environment by
  // a camera neither eye is using, and the error rotates with the head. It drives the SH as
  // well as the reflection, so the AMBIENT swims too -- which is why that bug did not look
  // like a highlight bug. cameraViewMatrix is per eye; a view matrix is rigid, so the inverse
  // rotation is the transpose.
  // (The GLSL writes the transpose out by hand only because GLSL ES 1.0 has no transpose();
  // TSL does, so here it is said plainly.)
  const iblTransform = () => transpose(mat3(cameraViewMatrix));

  // THE PIECEWISE CURVE, not pow(c, 2.2). They agree in the midtones and diverge in the
  // darks, which is exactly where a sculpt's shadow side lives, so the approximation would
  // have shown up as "the port looks slightly muddier" -- a report that is very hard to trace
  // back to a colour transform. Same constants as SRGB_LIN in colorSpace.glsl.
  const srgbChannel = Fn(([x]) => select(
    x.lessThan(0.04045), x.mul(1.0 / 12.92), pow(x.add(0.055).mul(1.0 / 1.055), 2.4)));
  const sRGBToLinear = Fn(([c]) =>
    vec3(srgbChannel(c.r), srgbChannel(c.g), srgbChannel(c.b)));

  // ── the shade ──────────────────────────────────────────────────────────────
  const shade = Fn(() => {
    const N = normalize(normalView);
    const V = normalize(positionView).negate();
    const NdV = max(dot(N, V), float(1e-4));

    // aMaterial is OUR per-vertex material vector: x roughness, y metalness, z masking. It is
    // not renamed by ShaderManager (only aVertex/aNormal/aColor/aTexCoord are), so it reaches
    // the node path under its own name.
    const mtl = attribute('aMaterial', 'vec3');
    const roughness = max(mtl.x, float(0.0001));
    const metallic = mtl.y;

    const linColor = sRGBToLinear(vertexColor());
    const albedo = linColor.mul(float(1.0).sub(metallic));
    const specular = mix(vec3(0.04), linColor, metallic);

    const iblM = iblTransform();
    const R0 = normalize(N.mul(NdV.mul(2.0)).sub(V));
    const R = getSpecularDominantDir(N, R0, roughness);
    const shTerm = albedo.mul(sphericalHarmonics(iblM.mul(N)));
    const panoTerm = texturePanoramaLod(iblM.mul(R), roughness)
      .mul(integrateBRDFApprox(specular, roughness, clamp(dot(N, V), 0.0, 1.0)));

    const ibl = vec3(0.0).toVar();
    If(uDebug.equal(0), () => { ibl.assign(shTerm.add(panoTerm)); })
      .ElseIf(uDebug.equal(1), () => { ibl.assign(shTerm); })
      .ElseIf(uDebug.equal(2), () => { ibl.assign(panoTerm); })
      .ElseIf(uDebug.equal(4), () => { ibl.assign(albedo); });

    const color = ibl.mul(uExposure).mul(uEnvIntensity).toVar();

    Loop({ start: 0, end: MAX_LIGHTS, type: 'int', condition: '<' }, ({ i }) => {
      If(i.greaterThanEqual(uNbLights), () => { Break(); });
      If(uDebug.greaterThan(0).and(uDebug.notEqual(3)), () => { Break(); });

      // Rotated, not transformed: it is a direction, so the view translation must not touch it.
      const prm = uLightParams.element(i);
      const Ldir = normalize(mat3(cameraViewMatrix).mul(uLightDir.element(i)));
      const L = vec3(0.0).toVar();
      const att = float(1.0).toVar();

      If(prm.y.greaterThan(1.5), () => {
        // DIRECTIONAL: no position and no distance. The sun does not get closer.
        L.assign(Ldir.negate());
        att.assign(1.0);
      }).Else(() => {
        const toL = cameraViewMatrix.mul(vec4(uLightPos.element(i), 1.0)).xyz.sub(positionView);
        const dist2 = dot(toL, toL);
        L.assign(toL.mul(inversesqrt(max(dist2, float(1e-12)))));
        const r = max(prm.x, float(1e-4));
        att.assign(float(1.0).div(float(1.0).add(dist2.div(r.mul(r)))));
        If(prm.y.greaterThan(0.5), () => {
          // SPOT: the same point light, scaled by how far inside the cone the surface sits.
          const cd = dot(L.negate(), Ldir);
          att.mulAssign(smoothstep(prm.z, prm.w, cd));
        });
      });

      const NdL = max(dot(N, L), float(0.0));
      const H = normalize(L.add(V));
      const NdH = max(dot(N, H), float(0.0));
      const VdH = max(dot(V, H), float(0.0));
      const a = roughness.mul(roughness);
      const a2 = a.mul(a);
      const dd = NdH.mul(NdH).mul(a2.sub(1.0)).add(1.0);
      const D = a2.div(max(dd.mul(dd).mul(3.14159265), float(1e-6)));
      const k = a.mul(0.5);
      const G = NdL.div(NdL.mul(float(1.0).sub(k)).add(k))
        .mul(NdV.div(NdV.mul(float(1.0).sub(k)).add(k)));
      const F = specular.add(vec3(1.0).sub(specular).mul(pow(float(1.0).sub(VdH), 5.0)));
      const spec = F.mul(D.mul(G).mul(0.25).div(max(NdL.mul(NdV), float(1e-4))));

      color.addAssign(uLightCol.element(i).mul(uExposure).mul(att).mul(NdL)
        .mul(albedo.mul(0.31830989).add(spec)));
    });

    return color;
  });

  const shadeFlat = Fn(() => {
    const mtl = attribute('aMaterial', 'vec3');
    const albedo = sRGBToLinear(vertexColor()).mul(float(1.0).sub(mtl.y));
    return albedo.mul(uExposure).mul(uEnvIntensity);
  });

  const m = new gpu.MeshBasicNodeMaterial({ vertexColors: true });
  m.colorNode = noArrays ? shadeFlat() : shade();

  /** Per frame: exposure, environment, and the shared light state. */
  m.userData.updateFrame = function (main) {
    m.userData.frames = (m.userData.frames || 0) + 1;
    uDebug.value = window._pbrDebug | 0;
    uExposure.value = ShaderPBR.exposure;
    const ei = getOptionsURL().envIntensity;
    uEnvIntensity.value = Number.isFinite(ei) ? ei : 1.0;

    const env = noArrays ? null : ShaderPBR.environments[ShaderPBR.idEnv];
    if (env) {
      for (let i = 0; i < 9; i++) {
        uSPH.array[i].set(env.sph[i * 3], env.sph[i * 3 + 1], env.sph[i * 3 + 2]);
      }
      if (env.size) uEnvSize.value.set(env.size[0], env.size[1]);
    }

    if (noArrays) return;
    const L = ShaderPBR.getLightState(main);
    uNbLights.value = L.count;
    for (let i = 0; i < MAX_LIGHTS; i++) {
      uLightPos.array[i].set(L.pos[i * 3], L.pos[i * 3 + 1], L.pos[i * 3 + 2]);
      uLightCol.array[i].set(L.col[i * 3], L.col[i * 3 + 1], L.col[i * 3 + 2]);
      uLightDir.array[i].set(L.dir[i * 3], L.dir[i * 3 + 1], L.dir[i * 3 + 2]);
      uLightParams.array[i].set(L.range[i], L.type[i], L.cone[i * 2], L.cone[i * 2 + 1]);
    }
  };

  m.userData.envTex = envTex;
  // window._pbrProbe() — is this material being fed at all?
  //
  // Every _pbrDebug value looked identical on device, which means either the uniform is not
  // reaching the shader or the mesh is not using this material. Those need opposite fixes, so
  // the probe reports which: `frames` counts updateFrame calls, the uniforms show what the
  // shader is actually reading, and meshMat says what the sculpt is drawn with.
  window._pbrProbe = function () {
    const sph0 = uSPH.array[0];
    const out = {
      frames: m.userData.frames || 0,
      debug: uDebug.value,
      nbLights: uNbLights.value,
      exposure: uExposure.value,
      envIntensity: uEnvIntensity.value,
      sph0: [+sph0.x.toFixed(4), +sph0.y.toFixed(4), +sph0.z.toFixed(4)],
      envSize: [uEnvSize.value.x, uEnvSize.value.y],
      envImage: envTex.image ? `${envTex.image.width}x${envTex.image.height}` : null,
      lightPos0: uLightPos.array[0].toArray(),
    };
    console.log('[pbrProbe] ' + JSON.stringify(out));
    return out;
  };
  return m;
}

export default makePBR;
