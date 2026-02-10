import ShaderBase from './ShaderBase.js?v=fix_3';

var ShaderFresnel = ShaderBase.getCopy();
ShaderFresnel.vertexName = ShaderFresnel.fragmentName = 'FresnelColor';

ShaderFresnel.uniforms = {};
ShaderFresnel.attributes = {};
ShaderFresnel.activeAttributes = {
  vertex: true,
  normal: true // REQUIRED for Fresnel
};

ShaderFresnel.uniformNames = ['uColor', 'uAlpha'];
Array.prototype.push.apply(ShaderFresnel.uniformNames, ShaderBase.uniformNames.commonUniforms);

ShaderFresnel.vertex = [
  'attribute vec3 aVertex;',
  'attribute vec3 aNormal;', 
  ShaderBase.strings.vertUniforms,
  'varying vec3 vNormal;',
  'varying vec3 vViewVec;',
  'void main() {',
  '  vec4 vertex4 = vec4(aVertex, 1.0);',
  '  vNormal = uN * aNormal;', // View Space Normal
  '  vec4 viewPos = uMV * vertex4;',
  '  vViewVec = -viewPos.xyz;', // Vector from Vertex to Eye (0,0,0)
  '  gl_Position = uMVP * vertex4;',
  '}'
].join('\n');

ShaderFresnel.fragment = [
  'precision highp float;',
  'uniform vec3 uColor;',
  'uniform float uAlpha;',
  'varying vec3 vNormal;',
  'varying vec3 vViewVec;',
  'void main() {',
  '  vec3 N = normalize(vNormal);',
  '  vec3 V = normalize(vViewVec);',
  '  // Facing Ratio: Dot(N, V) is 1.0 when facing, 0.0 at edge.',
  '  // We want transparent at center (1.0) and opaque at edge (0.0).',
  '  // So we use (1.0 - dot).',
  '  float facing = 1.0 - abs(dot(N, V));',
  '  // Power for falloff',
  '  float f = pow(facing, 3.0);',
  '  // Additive Blending: RGB is multiplied by Factor too.',
  '  gl_FragColor = vec4(uColor * f, uAlpha * f);',
  '}'
].join('\n');

ShaderFresnel.updateUniforms = function (mesh, main) {
  mesh.getGL().uniform3fv(this.uniforms.uColor, mesh.getFlatColor());
  mesh.getGL().uniform1f(this.uniforms.uAlpha, mesh.getOpacity());
  ShaderBase.updateUniforms.call(this, mesh, main);
};

export default ShaderFresnel;
