import * as THREE from 'three';
import ShaderLib from './ShaderLib.js';
import ShaderBase from './shaders/ShaderBase.js';
import Enums from '../misc/Enums.js';

var ShaderManager = {};

// Cache of compiled THREE.RawShaderMaterial instances
ShaderManager.materials = {};

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
  str = str.replace(/\baVertex\b/g, 'position');
  str = str.replace(/\baNormal\b/g, 'normal');

  // Also map custom attributes to the actual Three.js BufferGeometry names we used in Mesh.js
  str = str.replace(/attribute vec3 aColor;?/g, ''); // Three.js injects `attribute vec3 color;` natively
  str = str.replace(/\baColor\b/g, 'color');
  str = str.replace(/attribute vec3 aMaterial;?/g, 'attribute vec3 sculptMaterial;');
  str = str.replace(/\baMaterial\b/g, 'sculptMaterial');
  
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
 * Updates uniforms just before Three.js renders the mesh.
 * This reads SculptXR's cached matrices (uMV, uMVP, uN, etc.) and textures.
 */
ShaderManager.updateUniforms = function(mesh, main) {
  var threeMesh = mesh.getThreeMesh();
  if (!threeMesh || !threeMesh.material) return;
  
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
    uniform1i: function(loc, val) { unifs[loc].value = val; },
    texImage2D: function() {},
    texParameteri: function() {},
    generateMipmap: function() {},
    pixelStorei: function() {}
  };
  
  var activeTexUnit = 0;
  mockGL.activeTexture = function(unit) {
    activeTexUnit = unit - 0x84C0; // gl.TEXTURE0 is 33984 (0x84C0)
  };
  mockGL.createTexture = function() { return {}; };
  mockGL.bindTexture = function(target, tex) { 
    var name = 'uTexture' + activeTexUnit;
    if (unifs[name] && tex && tex.isTexture !== undefined) {
        unifs[name].value = tex;
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
  } finally {
    // Restore
    mesh.getGL = function() { return realGL; };
    shaderDef.uniforms = originalUniforms;
  }
};

export default ShaderManager;
