import { mat3 } from 'gl-matrix';
import getOptionsURL from '../../misc/getOptionsURL.js';
import ShaderBase from './ShaderBase.js';
import pbrGLSL from './glsl/pbr.glsl.js';
import * as THREE from 'three';

var ShaderPBR = ShaderBase.getCopy();
ShaderPBR.vertexName = ShaderPBR.fragmentName = 'ShadingPBR';

// HOW MANY LAMPS A SCENE MAY HAVE. Declared once and interpolated into the GLSL below, because
// this number lives in two places that must agree -- the array size in the shader and the
// scratch arrays that fill it -- and a comment asking the next person to keep them in step is
// not a mechanism.
//
// WHY THIS IS NOT FREE, and why it is 8 rather than 16. The fragment loop is bounded by
// `uNbLights` with a break, so on a driver that keeps the branch an unused light costs nothing.
// A driver that UNROLLS pays for all MAX_LIGHTS every pixel whatever the count says, and this
// shader runs per pixel per eye on a standalone headset. Four was chosen as a headset budget;
// eight covers key/fill/rim plus a few practicals, which is the scene matt is actually lighting.
// Raise it further only with a measured GalaxyXR frame time, not on the argument that the loop
// breaks early.
var MAX_LIGHTS = 8;

ShaderPBR.textures = {};

var texPath = 'app/resources/environments/';
ShaderPBR.environments = [{
  // https://hdrihaven.com/hdri/?h=mpumalanga_veld
  path: texPath + 'mpumalanga_veld_1k.png',
  sph: [0.136819, 0.174125, 0.253762, 0.027778, 0.056838, 0.131221, 0.074356, 0.086793, 0.099181, -0.079040, -0.091269, -0.102346, -0.027550, -0.032300, -0.039217, 0.031822, 0.034773, 0.039945, 0.017235, 0.021044, 0.026136, -0.106608, -0.118640, -0.132761, 0.041000, 0.049794, 0.061183],
  exposure: 2.5,
  name: 'Mpumalanga veld'
}, {
  // https://hdrihaven.com/hdri/?h=venetian_crossroads
  path: texPath + 'venetian_crossroads_1k.png',
  sph: [0.200626, 0.198426, 0.209579, 0.090452, 0.127807, 0.188390, 0.093188, 0.103245, 0.106131, 0.033349, 0.054751, 0.067044, 0.074350, 0.081670, 0.079716, 0.063127, 0.085940, 0.101710, 0.007751, 0.005710, -0.000791, 0.104134, 0.103979, 0.094236, -0.022747, -0.028166, -0.037714],
  exposure: 2.5,
  name: 'Venetian crossroads'
}, {
  // https://hdrihaven.com/hdri/?h=studio_small_01
  path: texPath + 'studio_small_01_1k.png',
  sph: [0.534107, 0.589985, 0.617478, 0.119999, 0.130480, 0.128019, 0.089872, 0.088707, 0.088017, 0.099999, 0.151282, 0.138458, 0.005015, 0.035588, 0.027592, 0.114999, 0.116739, 0.120579, -0.057997, -0.069532, -0.070401, 0.385123, 0.411714, 0.454725, 0.303242, 0.333004, 0.350270],
  exposure: 0.5,
  name: 'Studio small 01'
}, {
  // https://hdrihaven.com/hdri/?h=moonless_golf
  path: texPath + 'moonless_golf_1k.png',
  sph: [0.137579, 0.112906, 0.093470, 0.070711, 0.066043, 0.065337, -0.029564, -0.020720, -0.007737, -0.037254, -0.033270, -0.028294, -0.023847, -0.021208, -0.018767, -0.007873, -0.002587, 0.003955, 0.009241, 0.007711, 0.006063, 0.017917, 0.011733, 0.007669, 0.036859, 0.026285, 0.014740],
  exposure: 1.0,
  name: 'Moonless golf'
}, {
  // https://hdrihaven.com/hdri/?h=winter_river
  path: texPath + 'winter_river_1k.png',
  sph: [0.560145, 0.554695, 0.513523, -0.213105, -0.155190, -0.063568, 0.135182, 0.114211, 0.069349, 0.172852, 0.151820, 0.105477, 0.065753, 0.064050, 0.052622, 0.096352, 0.086557, 0.063826, 0.021830, 0.016560, 0.008804, 0.186193, 0.163720, 0.119627, 0.025363, 0.022278, 0.014461],
  exposure: 0.5,
  name: 'Winter river'
}];

var opts = getOptionsURL();
ShaderPBR.idEnv = Math.min(opts.environment, ShaderPBR.environments.length - 1);
ShaderPBR.exposure = opts.exposure === undefined ? ShaderPBR.environments[ShaderPBR.idEnv].exposure : Math.min(opts.exposure, 5);

ShaderPBR.uniforms = {};
ShaderPBR.attributes = {};

ShaderPBR.uniformNames = ['uTexture0', 'uAlbedo', 'uRoughness', 'uMetallic', 'uExposure', 'uEnvIntensity', 'uSPH', 'uEnvSize',
  // The mesh's own base-colour map. uTexture0 is the ENVIRONMENT and always has been, so a
  // second sampler is the only place an imported albedo image can go. Bound per mesh by
  // ShaderManager.updateUniforms, onto a material that mesh owns -- see getMaterialFor.
  'uAlbedoMap', 'uHasAlbedo',
  // KHR_materials_transmission, as much of it as an IBL-only shader can honour. See the
  // fragment for what it does and what it deliberately does not.
  'uTransmission',
  // glTF's packed metallicRoughnessTexture and its two factors.
  'uRoughMetalMap', 'uHasRoughMetal', 'uRoughFactor', 'uMetalFactor',
  // Tangent-space normal map. No tangent ATTRIBUTE goes with it -- see cotangentFrame.
  'uNormalMap', 'uHasNormalMap', 'uNormalScale',
  // Scene point lights. Positions arrive in VIEW space; see updateUniforms.
  'uLightPos', 'uLightCol', 'uLightRange', 'uNbLights'];
Array.prototype.push.apply(ShaderPBR.uniformNames, ShaderBase.uniformNames.commonUniforms);

ShaderPBR.vertex = [
  'attribute vec3 aVertex;',
  'attribute vec3 aNormal;',
  'attribute vec3 aColor;',
  'attribute vec3 aMaterial;',
  // Rewritten to three's built-in `uv` by ShaderManager.processShader, and supplied by
  // Mesh.updateTexCoordBuffer once isUsingTexCoords() is true for this mesh.
  'attribute vec2 aTexCoord;',
  ShaderBase.strings.vertUniforms,
  'uniform float uRoughness;',
  'uniform float uMetallic;',
  'uniform vec3 uAlbedo;',
  'varying vec3 vVertex;',
  'varying vec3 vNormal;',
  'varying vec3 vAlbedo;',
  'varying float vRoughness;',
  'varying float vMetallic;',
  'varying float vMasking;',
  'varying vec2 vAlbedoUv;',
  'void main() {',
  '  vAlbedoUv = aTexCoord;',
  '  vAlbedo = uAlbedo.x >= 0.0 ? uAlbedo : aColor;',
  '  vRoughness = uRoughness >= 0.0 ? uRoughness : aMaterial.x;',
  '  vMetallic = uMetallic >= 0.0 ? uMetallic : aMaterial.y;',
  '  vMasking = aMaterial.z;',
  '  vNormal = mix(aNormal, uEN * aNormal, vMasking);',
  '  vNormal = normalize(uN * vNormal);', // uN = normalMatrix (inverse-transpose) — correct under non-uniform/world scale; mat3(uMV) skewed normals when scaled
  '  vec4 vertex4 = vec4(aVertex, 1.0);',
  '  vertex4 = mix(vertex4, uEM * vertex4, vMasking);',
  '  vVertex = vec3(uMV * vertex4);',
  '  gl_Position = uMVP * vertex4;',
  '}'
].join('\n');

ShaderPBR.fragment = [
  'varying vec3 vVertex;',
  'varying vec3 vNormal;',
  'varying vec3 vAlbedo;',
  'varying float vRoughness;',
  'varying float vMetallic;',
  'varying vec2 vAlbedoUv;',
  'uniform sampler2D uAlbedoMap;',
  'uniform float uHasAlbedo;',
  'uniform float uTransmission;',
  'uniform sampler2D uRoughMetalMap;',
  'uniform float uHasRoughMetal;',
  'uniform float uRoughFactor;',
  'uniform float uMetalFactor;',
  'uniform sampler2D uNormalMap;',
  'uniform float uHasNormalMap;',
  'uniform float uNormalScale;',
  // A FIXED-SIZE ARRAY with a runtime count, because GLSL ES 1.0 will not size an array from a
  // uniform and will not loop to one either. The budget itself is set in JS -- see MAX_LIGHTS.
  'const int MAX_LIGHTS = ' + MAX_LIGHTS + ';',
  'uniform vec3 uLightPos[MAX_LIGHTS];',
  'uniform vec3 uLightCol[MAX_LIGHTS];',
  'uniform float uLightRange[MAX_LIGHTS];',
  'uniform int uNbLights;',
  // SEPARATE FROM uExposure, WHICH SCALES THE LIGHTS TOO. Turning the environment down is the
  // only way to see what a point light is actually contributing, and exposure cannot do it --
  // it multiplies the IBL and the lamps together, so the ratio never changes.
  'uniform float uEnvIntensity;',
  'uniform float uAlpha;',
  ShaderBase.strings.fragColorUniforms,
  ShaderBase.strings.fragColorFunction,
  pbrGLSL,
  '',
  // TANGENTS FROM DERIVATIVES, NOT FROM AN ATTRIBUTE, and in a sculpting application that is
  // not a shortcut -- it is the correct call.
  //
  // A tangent attribute is derived from positions and uvs, so it is STALE the moment either
  // changes. Here the geometry changes under every brush stroke: a cached tangent would have to
  // be recomputed with the normals on every edit, on every level of the multires stack, or the
  // lighting would quietly drift away from the surface it is meant to describe. The frame below
  // is rebuilt per pixel from the derivatives of the position and uv that are ALREADY varying,
  // so it cannot go stale and costs no buffer, no upload, and no invalidation rule.
  //
  // (Christian Schuler's cotangent frame. It reconstructs the same basis a per-vertex tangent
  // would give, up to the handedness that dFdy's sign carries for us.)
  'mat3 cotangentFrame(vec3 N, vec3 p, vec2 uv) {',
  '  vec3 dp1 = dFdx(p);',
  '  vec3 dp2 = dFdy(p);',
  '  vec2 duv1 = dFdx(uv);',
  '  vec2 duv2 = dFdy(uv);',
  '  vec3 dp2perp = cross(dp2, N);',
  '  vec3 dp1perp = cross(N, dp1);',
  '  vec3 T = dp2perp * duv1.x + dp1perp * duv2.x;',
  '  vec3 B = dp2perp * duv1.y + dp1perp * duv2.y;',
  // The epsilon is load-bearing: a face with a degenerate uv triangle gives T = B = 0, and
  // inversesqrt(0) is infinity, which would paint that pixel with a NaN normal.
  '  float invmax = inversesqrt(max(max(dot(T, T), dot(B, B)), 1e-12));',
  '  return mat3(T * invmax, B * invmax, N);',
  '}',
  '',
  'void main(void) {',
  '  vec3 normal = getNormal();',
  // Both vVertex and the normal are in VIEW space (see the vertex shader), so the frame and the
  // perturbed normal stay in the one space computeIBL_UE4 expects.
  '  if (uHasNormalMap > 0.5) {',
  '    vec3 mapN = texture2D(uNormalMap, vAlbedoUv).xyz * 2.0 - 1.0;',
  '    mapN.xy *= uNormalScale;',
  '    normal = normalize(cotangentFrame(normal, vVertex, vAlbedoUv) * mapN);',
  '  }',
  '  float roughness = max( 0.0001, vRoughness );',
  '  float metallic = vMetallic;',
  // glTF packs ROUGHNESS IN GREEN and METALNESS IN BLUE of one texture, each scaled by its
  // factor. Sampled linearly -- this is data, not colour, and marking it sRGB would bend the
  // values on the way in.
  //
  // THE MAP REPLACES the per-vertex values rather than multiplying them, which is the opposite
  // of what the albedo map does and is deliberate. Nomad writes BOTH: a per-vertex roughness in
  // COLOR_1 and a texture, and for the camel's body they disagree (0.251 against a factor of 1
  // with all the variation in the image). glTF has no per-vertex roughness at all, so when a
  // file carries the texture the texture is what the author was looking at.
  '  if (uHasRoughMetal > 0.5) {',
  '    vec3 rm = texture2D(uRoughMetalMap, vAlbedoUv).rgb;',
  '    roughness = max( 0.0001, uRoughFactor * rm.g );',
  '    metallic = uMetalFactor * rm.b;',
  '  }',
  // THE MAP MULTIPLIES THE VERTEX COLOUR, it does not replace it. That is what glTF means by
  // baseColorFactor x baseColorTexture, and it is also what makes the two work together here:
  // a Nomad export puts flat colour in the vertex attribute and detail in the image, and a
  // model with only one of the two still comes out right.
  // Sampled in sRGB and converted with the same function the vertex colour uses, so the two
  // cannot drift apart.
  '  vec3 baseColor = vAlbedo;',
  '  if (uHasAlbedo > 0.5) baseColor *= texture2D(uAlbedoMap, vAlbedoUv).rgb;',
  '  vec3 linColor = sRGBToLinear(baseColor);',
  // TRANSMISSION REMOVES THE DIFFUSE AND KEEPS THE REFLECTION, which is the difference between
  // glass and fog. Fading the whole shaded result with opacity would take the highlights down
  // with it and the eye would read as a milky shell; a clear surface still has a bright rim.
  //
  // What this is NOT: refraction. Bending what is behind the surface needs the scene rendered
  // to a buffer first, which this pipeline has no pass for, so the glTF's ior is read and
  // ignored. For a thin eye shell there is nothing to bend anyway.
  '  vec3 albedo = linColor * (1.0 - metallic) * (1.0 - uTransmission);',
  '  vec3 specular = mix( vec3(0.04), linColor, metallic);',
  '',
  '  vec3 color = uExposure * uEnvIntensity * computeIBL_UE4( normal, -normalize(vVertex), albedo, roughness, specular );',
  '',
  // THE SCENE'S LIGHTS, added on top of the environment rather than replacing it: the ambient
  // still fills the shadow side, the lights give the form and the highlights.
  //
  // This is what the environment on its own cannot do. IBL lights from every direction at once
  // and is smooth by construction -- a 9-coefficient irradiance and a roughness-blurred
  // panorama -- so surface detail has nothing sharp to modulate. Measured while adding normal
  // maps: forcing the surface shiny made a normal map's effect NINE TIMES larger, which is the
  // same statement from the other side.
  '  vec3 V = -normalize(vVertex);',
  '  float NdV = max(dot(normal, V), 1e-4);',
  '  for (int i = 0; i < MAX_LIGHTS; i++) {',
  '    if (i >= uNbLights) break;',
  // viewMatrix is three's OWN uniform, injected per eye on a ShaderMaterial -- so it is not
  // declared above, and must not be: redeclaring it fails to compile.
  '    vec3 toL = (viewMatrix * vec4(uLightPos[i], 1.0)).xyz - vVertex;',
  '    float dist2 = dot(toL, toL);',
  '    vec3 L = toL * inversesqrt(max(dist2, 1e-12));',
  // Falloff that a person placing a light can predict: full at the light, half at its range,
  // smooth everywhere and never zero. Raw inverse-square is correct and unusable here -- scene
  // units are arbitrary and large (this camel is ~180 across), so it would want intensities in
  // the thousands and blow out the moment you nudged the light closer.
  '    float r = max(uLightRange[i], 1e-4);',
  '    float att = 1.0 / (1.0 + dist2 / (r * r));',
  '    float NdL = max(dot(normal, L), 0.0);',
  '    if (NdL <= 0.0) continue;',
  '    vec3 H = normalize(L + V);',
  '    float NdH = max(dot(normal, H), 0.0);',
  '    float VdH = max(dot(V, H), 0.0);',
  '    float a = roughness * roughness;',
  '    float a2 = a * a;',
  // GGX, the distribution computeIBL_UE4 already approximates, so a light's highlight and the
  // environment's reflection describe ONE material rather than two that disagree.
  '    float dd = NdH * NdH * (a2 - 1.0) + 1.0;',
  '    float D = a2 / max(3.14159265 * dd * dd, 1e-6);',
  '    float k = a * 0.5;',
  '    float G = (NdL / (NdL * (1.0 - k) + k)) * (NdV / (NdV * (1.0 - k) + k));',
  '    vec3 F = specular + (1.0 - specular) * pow(1.0 - VdH, 5.0);',
  '    vec3 spec = (D * G * 0.25 / max(NdL * NdV, 1e-4)) * F;',
  '    color += uExposure * uLightCol[i] * att * NdL * (albedo * 0.31830989 + spec);',
  '  }',
  // FRESNEL-WEIGHTED ALPHA: a glancing surface reflects and a head-on one lets you through,
  // which is what makes a curved clear object read as curved rather than as a flat hole. The
  // 0.12 keeps a little of the surface visible face-on so it never disappears entirely -- it
  // is the one number here worth tuning by eye.
  //
  // ...AND THEN THE REFLECTION IS ADDED BACK, because alpha was erasing it.
  //
  // The environment reflection and the GGX highlights were always being computed for a
  // transmissive surface -- roughness and `specular` are untouched by transmission, so the
  // glossy value has always fed both. What went wrong is what happened afterwards: ordinary
  // blending multiplies the WHOLE fragment by alpha, so at transmission 1 a head-on fragment
  // was scaled to 0.12 and took its highlight down with it. The maths was right and then 88% of
  // it was thrown away. matt: "transparent surfaces (like the outer eye) should read the glossy
  // value, and reflect the environment, do specular highlights."
  //
  // A REFLECTION IS LIGHT ARRIVING, not a property of how solid the surface is -- glass gets
  // MORE opaque where it catches a highlight, not less. So the luminance of what this surface
  // is emitting raises alpha: the clear body keeps its fresnel value, a highlight approaches
  // opaque, and the two coexist on one curved eye. Scaled by uTransmission so an opaque
  // surface's shading is untouched.
  //
  // Rec.709 luma rather than a flat average: a blue-grey environment reflection and a warm
  // highlight should raise alpha by what they actually look like, not by their channel sum.
  '  float alpha = uAlpha;',
  '  if (uTransmission > 0.0) {',
  '    float fres = pow(1.0 - clamp(dot(normal, V), 0.0, 1.0), 3.0);',
  '    float clearAlpha = mix(alpha, alpha * clamp(fres + 0.12, 0.0, 1.0), uTransmission);',
  '    float lum = dot(color, vec3(0.2126, 0.7152, 0.0722));',
  '    alpha = clamp(clearAlpha + lum * uTransmission, 0.0, 1.0);',
  '  }',
  '  gl_FragColor = encodeFragColor(color, alpha);',
  '}'
].join('\n');

var uLightPosTmp = new Float32Array(MAX_LIGHTS * 3);
var uLightColTmp = new Float32Array(MAX_LIGHTS * 3);
var uLightRangeTmp = new Float32Array(MAX_LIGHTS);
// ONCE PER FRAME, NOT ONCE PER MESH. updateUniforms runs in a loop over every mesh, and none of
// the light data depends on which mesh is being drawn -- so a scene with 30 meshes and 4 lights
// was doing 120 updateMatrixWorld calls a frame to compute the same four positions.
var _lightFrame = -1;
var _lightCount = 0;

ShaderPBR.getOrCreateEnvironment = function (gl, main, env) {
  if (env.texture !== undefined) return env.texture;

  env.texture = new THREE.TextureLoader().load(env.path, function (tex) {
    // uEnvSize IS THE PANORAMA'S DIMENSIONS, and the specular lookup needs them to pick a mip
    // for the roughness it is given. No environment here carries a `size`, so the guard in
    // updateUniforms (`if (env.size)`) never fired and the uniform sat at (0, 0). Taken from the
    // image, which is the only place the number honestly comes from and is not known until now.
    if (tex && tex.image) env.size = [tex.image.width, tex.image.height];
    if (main) main.render();
  });
  return env.texture;
};

ShaderPBR.updateUniforms = function (mesh, main) {
  var gl = mesh.getGL();
  var uniforms = this.uniforms;

  gl.uniform3fv(uniforms.uAlbedo, mesh.getAlbedo());
  gl.uniform1f(uniforms.uRoughness, mesh.getRoughness());
  gl.uniform1f(uniforms.uMetallic, mesh.getMetallic());
  gl.uniform1f(uniforms.uExposure, ShaderPBR.exposure);
  // Read live rather than cached: the slider writes the option and the next frame picks it up.
  var _envI = getOptionsURL().envIntensity;
  gl.uniform1f(uniforms.uEnvIntensity, Number.isFinite(_envI) ? _envI : 1.0);

  var env = ShaderPBR.environments[ShaderPBR.idEnv];
  gl.uniform3fv(uniforms.uSPH, env.sph);
  if (env.size) gl.uniform2fv(uniforms.uEnvSize, env.size);

  // THE SCENE'S LIGHTS, IN WORLD SPACE. The shader moves them to view space with three's own
  // `viewMatrix`, and that indirection is the entire point.
  //
  // IT USED TO BE DONE HERE, on the CPU, with `main.getCamera().getView()` -- cheaper, and
  // correct with exactly one camera. VR HAS TWO. ShaderManager rewrites `uMV` to three's
  // `modelViewMatrix`, so vVertex lands in the real per-eye view space while the light landed
  // in the desktop camera's, and the gap between them rotated with the head: lighting swam
  // across surfaces as you looked around. matt: "i rotate my head, lighting shifts on
  // surfaces... not just spec, diffuse too" -- and diffuse moving is the tell, because NdL
  // depends on where the light IS, not on where you are looking from.
  //
  // Read off the three-side `matrixWorld`, not the app-side model matrix: meshes hang under
  // _worldGroup (which carries a scale the app's own camera knows nothing about), so that is
  // the space vVertex is actually in. Taking it from three keeps the two in step by
  // construction instead of by agreement.
  var _fr = main._renderer && main._renderer.info && main._renderer.info.render
    ? main._renderer.info.render.frame : -1;
  // -1 means we could not read a frame number; recompute rather than serve something stale.
  if (_fr !== _lightFrame || _fr < 0) {
  _lightFrame = _fr;
  var lights = main.getLights ? main.getLights() : [];
  var nb = _lightCount = Math.min(lights.length, MAX_LIGHTS);
  for (var li = 0; li < nb; li++) {
    var ltm = lights[li].getThreeMesh && lights[li].getThreeMesh();
    if (ltm) {
      // Forced current: this runs before renderer.render(), so a light moved this frame would
      // otherwise light from where it was last frame.
      ltm.updateMatrixWorld(true);
      var e = ltm.matrixWorld.elements;
      uLightPosTmp[li * 3] = e[12]; uLightPosTmp[li * 3 + 1] = e[13]; uLightPosTmp[li * 3 + 2] = e[14];
    } else {
      var lm = lights[li].getModelSpaceMatrix ? lights[li].getModelSpaceMatrix() : lights[li].getMatrix();
      uLightPosTmp[li * 3] = lm[12]; uLightPosTmp[li * 3 + 1] = lm[13]; uLightPosTmp[li * 3 + 2] = lm[14];
    }
    var lc = lights[li]._lightColor || [1, 1, 1];
    var inten = lights[li]._lightIntensity === undefined ? 1 : lights[li]._lightIntensity;
    uLightColTmp[li * 3]     = lc[0] * inten;
    uLightColTmp[li * 3 + 1] = lc[1] * inten;
    uLightColTmp[li * 3 + 2] = lc[2] * inten;
    uLightRangeTmp[li] = lights[li]._lightRange === undefined ? 50 : lights[li]._lightRange;
  }
  // The tail is zeroed rather than left stale: the loop is bounded by uNbLights, but a driver
  // that unrolls it can still read past and a leftover position from a deleted light is a
  // ghost nobody can find.
  for (var lz = nb; lz < MAX_LIGHTS; lz++) {
    uLightPosTmp[lz * 3] = uLightPosTmp[lz * 3 + 1] = uLightPosTmp[lz * 3 + 2] = 0;
    uLightColTmp[lz * 3] = uLightColTmp[lz * 3 + 1] = uLightColTmp[lz * 3 + 2] = 0;
    uLightRangeTmp[lz] = 1;
  }
  }
  // The UPLOAD still happens for every mesh -- each one is a separate draw with its own
  // uniforms. It is only the arithmetic above that is shared.
  gl.uniform1i(uniforms.uNbLights, _lightCount);
  gl.uniform3fv(uniforms.uLightPos, uLightPosTmp);
  gl.uniform3fv(uniforms.uLightCol, uLightColTmp);
  gl.uniform1fv(uniforms.uLightRange, uLightRangeTmp);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, ShaderPBR.getOrCreateEnvironment(gl, main, env));
  gl.uniform1i(uniforms.uTexture0, 0);

  ShaderBase.updateUniforms.call(this, mesh, main);
};

export default ShaderPBR;
