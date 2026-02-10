import ShaderBase from './ShaderBase.js';

var ShaderUnlit = ShaderBase.getCopy();
ShaderUnlit.vertexName = ShaderUnlit.fragmentName = 'UnlitColor';

ShaderUnlit.uniforms = {};
ShaderUnlit.attributes = {};
ShaderUnlit.activeAttributes = {
  vertex: true,
  material: true // We reuse material for masking support if needed, or remove it.
  // Actually, VRLaser doesn't use masking. But let's keep it simple.
};

ShaderUnlit.uniformNames = ['uColor', 'uAlpha'];
Array.prototype.push.apply(ShaderUnlit.uniformNames, ShaderBase.uniformNames.commonUniforms);

ShaderUnlit.vertex = [
  'attribute vec3 aVertex;',
  'attribute vec3 aMaterial;', 
  ShaderBase.strings.vertUniforms,
  'void main() {',
  '  vec4 vertex4 = vec4(aVertex, 1.0);',
  '  gl_Position = uMVP * vertex4;',
  '}'
].join('\n');

ShaderUnlit.fragment = [
  'precision highp float;',
  'uniform vec3 uColor;',
  'uniform float uAlpha;',
  'void main() {',
  '  gl_FragColor = vec4(uColor, uAlpha);',
  '}'
].join('\n');

ShaderUnlit.updateUniforms = function (mesh, main) {
  mesh.getGL().uniform3fv(this.uniforms.uColor, mesh.getFlatColor());
  mesh.getGL().uniform1f(this.uniforms.uAlpha, mesh.getOpacity());
  ShaderBase.updateUniforms.call(this, mesh, main);
};

export default ShaderUnlit;
