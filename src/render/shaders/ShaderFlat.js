import ShaderBase from 'render/shaders/ShaderBase';

var ShaderFlat = ShaderBase.getCopy();
ShaderFlat.vertexName = ShaderFlat.fragmentName = 'FlatColor';

ShaderFlat.uniforms = {};
ShaderFlat.attributes = {};
ShaderFlat.activeAttributes = {
  vertex: true,
  material: true
};

ShaderFlat.uniformNames = ['uColor', 'uAlpha', 'uLightDir'];
Array.prototype.push.apply(ShaderFlat.uniformNames, ShaderBase.uniformNames.commonUniforms);

ShaderFlat.vertex = [
  'attribute vec3 aVertex;',
  'attribute vec3 aMaterial;',
  ShaderBase.strings.vertUniforms,
  'varying vec3 vVertex;',
  'varying float vMasking;',
  'void main() {',
  '  vMasking = aMaterial.z;',
  '  vec4 vertex4 = vec4(aVertex, 1.0);',
  '  // DISABLE MASKING MIXING (Suspect uEM is bad)',
  '  // vertex4 = mix(vertex4, uEM * vertex4, vMasking);',
  '  gl_Position = uMVP * vertex4;',
  '  vVertex = vec3(uMV * vertex4);', 
  '}'
].join('\n');

ShaderFlat.fragment = [
  '#extension GL_OES_standard_derivatives : enable',
  'precision highp float;',
  'uniform vec3 uColor;',
  'uniform float uAlpha;',
  'varying vec3 vVertex;',
  'void main() {',
  '  vec3 n = normalize(cross(dFdx(vVertex), dFdy(vVertex)));',
  '  vec3 lDir = normalize(vec3(0.0, 0.0, 1.0));',
  '  float diffuse = max(0.0, dot(n, lDir));',
  '  diffuse = diffuse * 0.7 + 0.3; // Ambient + Diffuse',
  '  gl_FragColor = vec4(uColor * diffuse, uAlpha);',
  '}'
].join('\n');

ShaderFlat.updateUniforms = function (mesh, main) {
  mesh.getGL().uniform3fv(this.uniforms.uColor, mesh.getFlatColor());
  mesh.getGL().uniform1f(this.uniforms.uAlpha, mesh.getOpacity());
  ShaderBase.updateUniforms.call(this, mesh, main);
};

export default ShaderFlat;
