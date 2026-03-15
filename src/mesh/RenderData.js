import getOptionsURL from '../misc/getOptionsURL.js';
import * as THREE from 'three';
import ShaderMatcap from '../render/shaders/ShaderMatcap.js';

var RenderData = function (gl) {
  var opts = getOptionsURL();

  return {
    _gl: gl,

    _shaderType: opts.shader,
    _flatShading: opts.flatshading,
    _showWireframe: opts.wireframe,
    _wireframeType: (typeof navigator !== 'undefined' && /OculusBrowser|Mobile VR|Mobile|Android/i.test(navigator.userAgent)) ? 0 : 1, // 0: Fast L0, 1: Smooth L0, 2: Full
    _matcap: Math.min(opts.matcap, ShaderMatcap.matcaps.length - 1), // matcap id
    _curvature: Math.min(opts.curvature, 5.0),
    _texture0: null,

    // Three.js Integration
    _geometry: new THREE.BufferGeometry(),
    // Keep reference keys for legacy getters in Mesh.js until completely phased out
    _vertexBuffer: { release: () => {}, update: () => {} },
    _normalBuffer: { release: () => {}, update: () => {} },
    _colorBuffer: { release: () => {}, update: () => {} },
    _materialBuffer: { release: () => {}, update: () => {} },
    _texCoordBuffer: { release: () => {}, update: () => {} },
    _indexBuffer: { release: () => {}, update: () => {} },
    _wireframeBuffer: { release: () => {}, update: () => {} },

    // these material values overrides the vertex attributes
    // it's here for debug or preview
    _albedo: new Float32Array([-1.0, -1.0, -1.0]),
    _roughness: -0.18,
    _metallic: -0.78,
    _alpha: 1.0,

    _flatColor: new Float32Array([1.0, 0.0, 0.0]),
    _mode: gl.TRIANGLES
  };
};

RenderData.ONLY_DRAW_ARRAYS = false;

export default RenderData;
