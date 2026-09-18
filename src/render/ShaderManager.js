import * as THREE from 'three';
import ShaderLib from './ShaderLib.js';
import ShaderBase from './shaders/ShaderBase.js';
import Enums from '../misc/Enums.js';
import { mat3, mat4 } from 'gl-matrix';

var ShaderManager = {};

// Cache of compiled THREE.RawShaderMaterial instances
ShaderManager.materials = {};
const _meshWorldPos = new THREE.Vector3(); // Static for GC performance

/**
 * Extracts uniforms defined in the ShaderBase/Shader mapping
 * and converts them into the format THREE.RawShaderMaterial expects.
 */
ShaderManager.createUniforms = function(shaderDef) {
  var uniforms = {};
  
  // All shaders share common uniforms from ShaderBase
  var names = ShaderBase.uniformNames.commonUniforms.slice();
  // If the shader defines custom uniforms like uTexture0, append them
  if (shaderDef.uniformNames) {
      names = names.concat(shaderDef.uniformNames);
  }
  
  // Combine GLSL source to regex scan for uniform types
  var glsl = (shaderDef.vertex || '') + '\n' + (shaderDef.fragment || '');
  if (ShaderBase && ShaderBase.strings) {
    glsl += '\n' + (ShaderBase.strings.vertUniforms || '') + '\n' + (ShaderBase.strings.fragColorUniforms || '');
  }
  
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    
    var value = null;
    var regex = new RegExp('uniform\\s+(int|float|vec2|vec3|vec4|mat3|mat4|sampler2D)\\s+' + name + '\\b');
    var match = glsl.match(regex);
    if (match) {
        var type = match[1];
        if (type === 'int' || type === 'float') value = 0;
        else if (type === 'vec2') value = new THREE.Vector2();
        else if (type === 'vec3') value = new THREE.Vector3();
        else if (type === 'vec4') value = new THREE.Vector4();
        else if (type === 'mat3') value = new THREE.Matrix3();
        else if (type === 'mat4') value = new THREE.Matrix4();
    }
    
    uniforms[name] = { value: value };
  }
  
  return uniforms;
};

/**
 * Prepares the raw GLSL strings by injecting extensions and precision qualifiers
 * exactly as raw SculptXR WebGL did.
 */
ShaderManager.processShader = function(str) {
  var extensions = '';
  var matches = str.match(/^\s*(#extension).*/gm);
  if (matches) {
    var extMap = {};
    for (var i = 0, nb = matches.length; i < nb; ++i) {
      var ext = matches[i].substr(matches[i].indexOf('#extension'));
      str = str.replace(matches[i], '');
      if (extMap[ext]) continue;
      extMap[ext] = true;
      extensions += ext + '\n';
    }
  }

  // Three.js RawShaderMaterial will automatically inject its own #version and #define SHADER_NAME
  // Remove any existing #version tags from the raw code so Three.js's prefix is the first line.
  str = str.replace(/^\s*(#version).*/gm, '');
  
  // Three.js strictly uses `position` and `normal` for its BufferGeometry. 
  // It handles WebGL2 `in` automatically within ShaderMaterial.
  // Replace references to SculptXR aVertex and aNormal to match Three.js naming conventions.
  str = str.replace(/attribute vec3 aVertex;?/g, '');
  str = str.replace(/attribute vec3 aNormal;?/g, '');
  str = str.replace(/attribute vec2 aTexCoord;?/g, '');
  str = str.replace(/\baVertex\b/g, 'position');
  str = str.replace(/\baNormal\b/g, 'normal');
  str = str.replace(/\baTexCoord\b/g, 'uv');

  // Also map custom attributes to the actual Three.js BufferGeometry names we used in Mesh.js
  str = str.replace(/attribute vec3 aColor;?/g, ''); // Three.js injects `attribute vec3 color;` natively
  str = str.replace(/\baColor\b/g, 'color');
  
  // --- CRITICAL WEBXR SHADER MIGRATION ---
  // Legacy SculptXR manually calculates `uMVP` and `uMV` from the desktop camera
  // and manually injects it into every shader. This BREAKS WebXR, because WebXR
  // dynamically generates a stereoscopic projection matrix for each eye every frame!
  // By stripping the legacy declarations and mapping them to Three.js's native variables,
  // the shaders will automatically inherit stereoscopic VR tracking and distortions perfectly.
  str = str.replace(/uniform\s+mat4\s+uMVP;?/g, '');
  str = str.replace(/uniform\s+mat4\s+uMV;?/g, '');
  str = str.replace(/uniform\s+mat3\s+uN;?/g, '');
  str = str.replace(/\buMVP\b/g, '(projectionMatrix * modelViewMatrix)');
  str = str.replace(/\buMV\b/g, 'modelViewMatrix');
  str = str.replace(/\buN\b/g, 'normalMatrix');

  // Three.js heavily relies on the varying name `vColor` when `vertexColors: true` is on, 
  // overriding it with native `color` buffer data. SculptXR shaders have complex ternary 
  // operations over `vColor` (checking uAlbedo). Rename SculptXR's internal variable
  // to `vScColor` so they don't fight.
  str = str.replace(/\bvColor\b/g, 'vScColor');

  var precision = '';
  var regPrecision = /precision\s+(high|low|medium)p\s+float/;
  if (!regPrecision.test(str)) {
    precision += '#ifdef GL_FRAGMENT_PRECISION_HIGH\n  precision highp float;\n#else\n  precision mediump float;\n#endif\n';
  }

  return extensions + precision + str;
};

/**
 * Retrieves or compiles a THREE.ShaderMaterial for a specific SculptXR Shader ID.
 */
ShaderManager.getMaterial = function(shaderId) {
  if (this.materials[shaderId]) return this.materials[shaderId];
  
  var shaderDef = ShaderLib[shaderId];
  if (!shaderDef) {
    console.warn("ShaderManager: Unknown Shader ID " + shaderId);
    return null;
  }
  
  var mat = new THREE.ShaderMaterial({
    name: shaderDef.vertexName, // Three.js will use this to generate #define SHADER_NAME
    vertexShader: this.processShader(shaderDef.vertex),
    fragmentShader: this.processShader(shaderDef.fragment),
    uniforms: Object.assign(
      THREE.UniformsUtils.clone(THREE.UniformsLib.common),
      this.createUniforms(shaderDef)
    ),
    extensions: {
      derivatives: true // Required for dFdx, dFdy in WebGL1 fallback
    },
    side: THREE.DoubleSide,
    transparent: true, // Needed for SculptXR opacity handling
    depthTest: true,
    depthWrite: true,
    wireframe: false,
    vertexColors: true // Forces Three.js to inject `#define USE_COLOR` and map our color attribute
  });
  
  // Tag it so we can easily look up the original definition during rendering
  mat.userData.sculptShaderId = shaderId;
  mat.userData.sculptShaderDef = shaderDef;
  
  this.materials[shaderId] = mat;
  return mat;
};

/**
 * The material for THIS mesh: the shared one, unless the mesh carries something that cannot be
 * shared.
 *
 * WHY A CLONE. getMaterial caches ONE material per shader type and every mesh of that type uses
 * it -- which is fine while the per-mesh uniforms are recomputed into it before each draw, and
 * fatal for a TEXTURE. updateUniforms runs in a loop over every mesh BEFORE renderer.render(),
 * so with a shared material the last mesh to be visited wins and its image would appear on all
 * of them. A mesh with its own map gets its own material, and nothing else changes.
 */
ShaderManager.getMaterialFor = function(mesh, shaderId) {
  var shared = this.getMaterial(shaderId);
  if (!shared || !mesh) return shared;
  var needsOwn = (mesh.hasTextureMap && mesh.hasTextureMap()) ||
                 (mesh.getTransmission && mesh.getTransmission() > 0);
  if (!needsOwn) return shared;
  // ONLY THE SHADER THAT SAMPLES IT. PBR is the one with uAlbedoMap; every other mode (UV,
  // Matcap, Flat, Normal...) has no use for the map and every reason to keep the shared
  // material, whose uniforms the legacy path sets up by shader id. Cloning them too broke UV
  // display mode, which renders from uniforms that the clone had its own dead copy of.
  if (shaderId !== Enums.Shader.PBR) return shared;
  var per = mesh._albedoMaterials || (mesh._albedoMaterials = {});
  if (!per[shaderId]) {
    var m = shared.clone();
    // clone() copies the uniforms object but shares the texture references inside it, which is
    // what we want for the environment map -- only uAlbedoMap differs, and it is set per frame.
    m.userData.sculptShaderId = shared.userData.sculptShaderId;
    m.userData.sculptShaderDef = shared.userData.sculptShaderDef;
    m.userData.sculptPerMesh = true;
    per[shaderId] = m;
  }
  // A TRANSMISSIVE SURFACE MUST NOT WRITE DEPTH. Every sculpt material writes depth, which is
  // right for a solid; a glass eye that writes it hides the iris sitting inside it and punches
  // a hole in whatever else is behind.
  //
  // "Three sorts the transparent pass back to front already, so dropping the depth write is the
  // whole fix -- no render order to negotiate" is what used to be written here, and it is wrong
  // twice over. See the renderOrder rule in updateUniforms: three sorts by the OBJECT ORIGIN,
  // which for a nested eye is the same point as the thing inside it, and which for a skinned
  // mesh does not move at all.
  //
  // Written every time rather than only when transmissive: a mesh that keeps its own material
  // for another reason (it has a map) and whose transmission is later turned off would
  // otherwise keep the depth write switched off for good.
  per[shaderId].depthWrite = !(mesh.getTransmission && mesh.getTransmission() > 0);
  return per[shaderId];
};

/**
 * Updates uniforms just before Three.js renders the mesh.
 * This reads SculptXR's cached matrices (uMV, uMVP, uN, etc.) and textures.
 */
ShaderManager.updateUniforms = function(mesh, main) {
  var threeMesh = mesh.getThreeMesh();
  if (!threeMesh || !threeMesh.material) return;

  // GLASS DRAWS LAST, BECAUSE SORTING CANNOT DECIDE THIS ONE.
  //
  // matt: "lots of depth/transparency sorting issues with the eyes. they're nested spheres, an
  // outer transparent sphere, an inner solid one... as soon as its skinned and i start to move
  // the head around, the inner eye tends to go hidden."
  //
  // Three sorts the transparent pass by the z of each object's ORIGIN, and both of those
  // assumptions fail here at once:
  //
  //   NESTED OBJECTS SHARE AN ORIGIN. Measured on his camel: eyeouter and eyeinner both sit at
  //   [5.7, 5.6, 8.1] -- exactly equal z, so the comparison falls through to three's internal
  //   object id, i.e. the order the meshes happened to be created in. His two eyes were authored
  //   in opposite order, so one drew inner-then-outer (correct) and the other outer-then-inner
  //   (the iris painted over the glass). No amount of depth sorting can separate two spheres
  //   about the same centre; only an explicit order can.
  //
  //   AND A SKINNED MESH NEVER MOVES ITS ORIGIN. Skinning writes VERTICES; the object matrix
  //   stays at bind. Measured across one head rotation: the eye's origin did not move by a
  //   thousandth, while its geometry travelled from [3.9, -37.1, 52.9] to [32.9, -28.2, 11.3].
  //   The sort key stops describing where the mesh is the moment the rig is posed, which is
  //   exactly when matt sees it.
  //
  // So the transmissive surface is ordered explicitly, after every depth-writing mesh. It is
  // the one that needs it: not writing depth, it is the only mesh whose result depends on WHEN
  // it is drawn rather than on the depth test. 0.9 keeps it inside the documented band -- above
  // the base mesh (0) and the group overlay (0.5), below the wireframe (1) and the ground grid
  // (200). Depth TESTING still applies, so glass behind the head is still hidden by it.
  threeMesh.renderOrder = (mesh.getTransmission && mesh.getTransmission() > 0) ? 0.9 : 0;
  
  var material = threeMesh.material;
  if (!material.isShaderMaterial) return;
  
  var shaderDef = material.userData.sculptShaderDef;
  if (!shaderDef) return;
  
  var unifs = material.uniforms;
  
  // We need to use SculptXR's native updateUniforms function to calculate values,
  // but it expects a native WebGL context and `gl.uniform...` calls. 
  // We mock the `gl` context temporarily to intercept the values!
  var mockGL = {
    uniformMatrix4fv: function(loc, trans, val) { 
      if (!unifs[loc].value) unifs[loc].value = new THREE.Matrix4();
      unifs[loc].value.fromArray(val); 
    },
    uniformMatrix3fv: function(loc, trans, val) { 
      if (!unifs[loc].value) unifs[loc].value = new THREE.Matrix3();
      unifs[loc].value.fromArray(val); 
    },
    uniform3fv: function(loc, val) { 
      if (val.length > 3) {
        // This is an array of vec3s (like Spherical Harmonics)
        if (!Array.isArray(unifs[loc].value)) {
           var count = val.length / 3;
           unifs[loc].value = new Array(count);
           for (var k = 0; k < count; k++) unifs[loc].value[k] = new THREE.Vector3();
        }
        for (var i = 0, j = 0; i < val.length; i+=3, j++) {
           unifs[loc].value[j].fromArray(val, i);
        }
      } else {
        if (!unifs[loc].value || Array.isArray(unifs[loc].value)) unifs[loc].value = new THREE.Vector3();
        unifs[loc].value.fromArray(val); 
      }
    },
    uniform4fv: function(loc, val) { 
      if (val.length > 4) {
        if (!Array.isArray(unifs[loc].value)) {
           var count = val.length / 4;
           unifs[loc].value = new Array(count);
           for (var k = 0; k < count; k++) unifs[loc].value[k] = new THREE.Vector4();
        }
        for (var i = 0, j = 0; i < val.length; i+=4, j++) unifs[loc].value[j].fromArray(val, i);
      } else {
        if (!unifs[loc].value || Array.isArray(unifs[loc].value)) unifs[loc].value = new THREE.Vector4();
        unifs[loc].value.fromArray(val); 
      }
    },
    uniform2fv: function(loc, val) { 
      if (val.length > 2) {
        if (!Array.isArray(unifs[loc].value)) {
           var count = val.length / 2;
           unifs[loc].value = new Array(count);
           for (var k = 0; k < count; k++) unifs[loc].value[k] = new THREE.Vector2();
        }
        for (var i = 0, j = 0; i < val.length; i+=2, j++) unifs[loc].value[j].fromArray(val, i);
      } else {
        if (!unifs[loc].value || Array.isArray(unifs[loc].value)) unifs[loc].value = new THREE.Vector2();
        unifs[loc].value.fromArray(val); 
      }
    },
    uniform1f: function(loc, val) { unifs[loc].value = val; },
    // An ARRAY of floats, which the mock had no entry for at all -- and a missing entry here is
    // silent, exactly as the absent TEXTURE0 constant was. Copied rather than aliased: the
    // caller reuses its scratch buffer every frame.
    uniform1fv: function(loc, val) {
      if (!unifs[loc]) return;
      if (!Array.isArray(unifs[loc].value) || unifs[loc].value.length !== val.length) {
        unifs[loc].value = new Array(val.length);
      }
      for (var i = 0; i < val.length; i++) unifs[loc].value[i] = val[i];
    },
    uniform1i: function(loc, val) { 
      if (loc && loc.indexOf('uTexture') === 0) return; // Prevent overwriting THREE.Texture with 0
      unifs[loc].value = val; 
    },
    texImage2D: function() {},
    texParameteri: function() {},
    generateMipmap: function() {},
    pixelStorei: function() {}
  };
  
  // THE GL CONSTANTS THE SHADERS ASK THE MOCK FOR. Without them `gl.TEXTURE0` is undefined,
  // `undefined - 0x84C0` is NaN, and the bind below looks up `uTextureNaN` and quietly finds
  // nothing -- which is why the PBR environment map has been unbound since the Three.js port.
  // uTexture0 stayed null, computeIBL_UE4 had no panorama to sample, and the shader ran on its
  // 9-coefficient SH ambient alone: flat diffuse, no specular, and ROUGHNESS AND METALNESS WITH
  // NO VISIBLE EFFECT AT ALL. Measured before the fix: roughness 0.02 and 1.0 rendered
  // identically (mean 79.7, sd 13.79 both); after, 88.7/24.9 against 81.8/13.8.
  mockGL.TEXTURE0 = 0x84C0;
  mockGL.TEXTURE_2D = 0x0DE1;

  var activeTexUnit = 0;
  mockGL.activeTexture = function(unit) {
    // Falls back to unit 0 rather than NaN: a missing constant should cost the wrong texture
    // unit at worst, not silently drop the binding.
    var u = (typeof unit === 'number' && isFinite(unit)) ? unit - 0x84C0 : 0;  // gl.TEXTURE0 is 33984
    activeTexUnit = u;
  };
  mockGL.createTexture = function() { return {}; };
  mockGL.bindTexture = function(target, tex) { 
    var name = 'uTexture' + activeTexUnit;
    if (unifs[name]) {
        if (tex && tex.isTexture !== undefined) {
            unifs[name].value = tex;
        } else {
            // Prevent WebGL texture leaks (like the desktop GUI rendering into the sculpt meshes) 
            // by forcing Three.js to bind a plain white texture instead of a raw WebGLTexture
            if (!ShaderManager._dummyTex) {
                ShaderManager._dummyTex = new THREE.DataTexture(new Uint8Array([255,255,255,255]), 1, 1, THREE.RGBAFormat);
                ShaderManager._dummyTex.needsUpdate = true;
            }
            unifs[name].value = ShaderManager._dummyTex;
        }
    }
  };
  
  // The original shader definitions mapped names to integer locations once.
  // We'll pass the names as strings so our mockGL intercepts by name.
  var originalUniforms = shaderDef.uniforms;
  shaderDef.uniforms = {};
  var names = ShaderBase.uniformNames.commonUniforms.slice();
  if (shaderDef.uniformNames) {
      names = names.concat(shaderDef.uniformNames);
  }
  for (var i = 0; i < names.length; i++) shaderDef.uniforms[names[i]] = names[i];
  
  // Temporarily swap mesh GL context
  var realGL = mesh.getGL();
  mesh.getGL = function() { return mockGL; };
  
  try {
    // Let the original logic calculate curvature, symmetry origin, MVP, etc.
    shaderDef.updateUniforms.call(shaderDef, mesh, main);
    
    // Fail-safe fallback for texture uniforms if WebGL binding was lost or clobbered
    if (unifs.uTexture0) {
        if (material.userData.sculptShaderId === 5) { // Enums.Shader.MATCAP
             unifs.uTexture0.value = shaderDef.textures[mesh.getMatcap()];
        } else if (material.userData.sculptShaderId === 4 && !unifs.uTexture0.value) { // Enums.Shader.UV
             unifs.uTexture0.value = shaderDef.texture0;
        }
    }

    // THE ALBEDO MAP, bound here rather than through the mocked gl above: it belongs to the MESH
    // and the legacy updateUniforms has never known about it. Safe to write onto the material
    // because a mesh with a map has its OWN material -- see getMaterialFor.
    if (unifs.uAlbedoMap) {
      var amap = mesh.getAlbedoMap ? mesh.getAlbedoMap() : null;
      if (!ShaderManager._dummyTex) {
        ShaderManager._dummyTex = new THREE.DataTexture(new Uint8Array([255,255,255,255]), 1, 1, THREE.RGBAFormat);
        ShaderManager._dummyTex.needsUpdate = true;
      }
      unifs.uAlbedoMap.value = amap || ShaderManager._dummyTex;
      unifs.uHasAlbedo.value = amap ? 1 : 0;
    }
    if (unifs.uRoughMetalMap) {
      var rmap = mesh.getRoughMetalMap ? mesh.getRoughMetalMap() : null;
      unifs.uRoughMetalMap.value = rmap || ShaderManager._dummyTex;
      unifs.uHasRoughMetal.value = rmap ? 1 : 0;
      unifs.uRoughFactor.value = mesh.getRoughFactor ? mesh.getRoughFactor() : 1;
      unifs.uMetalFactor.value = mesh.getMetalFactor ? mesh.getMetalFactor() : 1;
    }
    if (unifs.uNormalMap) {
      var nmap = mesh.getNormalMap ? mesh.getNormalMap() : null;
      unifs.uNormalMap.value = nmap || ShaderManager._dummyTex;
      unifs.uHasNormalMap.value = nmap ? 1 : 0;
      unifs.uNormalScale.value = mesh.getNormalScale ? mesh.getNormalScale() : 1;
    }
    if (unifs.uTransmission) {
      unifs.uTransmission.value = mesh.getTransmission ? mesh.getTransmission() : 0;
    }

    material.uniformsNeedUpdate = true;
  } finally {
    // Restore
    mesh.getGL = function() { return realGL; };
    shaderDef.uniforms = originalUniforms;
  }
};

/**
 * Real-time eye correction for MatCap in WebXR.
 * Attached to Three.js onBeforeRender hook.
 */
ShaderManager.onBeforeRenderMatCap = function(mesh, camera) {
  var threeMesh = mesh.getThreeMesh();
  if (!threeMesh || !threeMesh.material) return;
  
  var mat = threeMesh.material;
  var unifs = mat.uniforms;
  var shaderDef = mat.userData.sculptShaderDef;
  
  if (!shaderDef || !shaderDef._cacheMats) return; // Wait for first frame of updateUniforms to init cache
  
  const mats = shaderDef._cacheMats;
  const view = camera.matrixWorldInverse.elements; // Three.js View Matrix (World -> View)
  
  // Inverse view is camera.matrixWorld elements (View -> World)
  const viewInv = camera.matrixWorld.elements;
  
  // Back = the camera's view direction (its +Z axis in world space), NOT the camera→mesh-origin
  // vector. The old mesh-relative aim swung wildly for an off-centre mesh (a long character) and
  // at high scale, spinning the stabilization frame as you grip-rotated the world → shading flip
  // + L/R shimmer. The view axis is mesh-position-independent, so the matcap frame stays stable.
  let bx = viewInv[8], by = viewInv[9], bz = viewInv[10];
  let len = Math.sqrt(bx * bx + by * by + bz * bz);
  if (len > 1e-6) { bx /= len; by /= len; bz /= len; }
  
  // Right = Cross(Up, Back)
  let srx = bz;
  let sry = 0.0;
  let srz = -bx;
  len = Math.sqrt(srx * srx + srz * srz);
  if (len < 0.001) {
    srx = viewInv[0]; sry = viewInv[1]; srz = viewInv[2];
  } else {
    srx /= len; srz /= len;
  }
  
  // Up = Cross(Back, Right)
  const sux = by * srz - bz * sry;
  const suy = bz * srx - bx * srz;
  const suz = bx * sry - by * srx;
  
  const C = mats.camBasis;
  C[0] = viewInv[0]; C[1] = viewInv[1]; C[2] = viewInv[2];
  C[3] = viewInv[4]; C[4] = viewInv[5]; C[5] = viewInv[6];
  C[6] = viewInv[8]; C[7] = viewInv[9]; C[8] = viewInv[10];
  
  const S = mats.stabBasis;
  S[0] = srx; S[1] = sry; S[2] = srz;
  S[3] = sux; S[4] = suy; S[5] = suz;
  S[6] = bx; S[7] = by; S[8] = bz;
  
  const ST = mat3.create();
  mat3.transpose(ST, S); // Safe transpose (not in place)
  mat3.mul(mats.corrMat, ST, C);

  // A/B diagnostic: window._matcapNoStable=true disables the billboard stabilization (identity
  // correction → plain view-space matcap that rolls with the head). Lets us tell whether any
  // residual shimmer comes from the stabilization or the base matcap.
  if (window._matcapNoStable) mat3.identity(mats.corrMat);

  if (unifs.uRotCorrection) {
      unifs.uRotCorrection.value.fromArray(mats.corrMat);
      // All matcap meshes share ONE cached material, so Three.js skips re-uploading its
      // uniforms for meshes drawn after the first with the same material id. Without this
      // flag every matcap mesh would render with the first-drawn mesh's rotation correction,
      // and because the material is transparent (depth-sorted), that "first" mesh changes as
      // you move — the whole scene's matcap orientation snaps. Force a per-draw re-upload.
      mat.uniformsNeedUpdate = true;
  }
};

window.ShaderManager = ShaderManager;

export default ShaderManager;
