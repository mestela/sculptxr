import ShaderBase from './ShaderBase.js';

var ShaderFlat = ShaderBase.getCopy();
ShaderFlat.vertexName = ShaderFlat.fragmentName = 'FlatColor';

ShaderFlat.uniforms = {};
ShaderFlat.attributes = {};
ShaderFlat.activeAttributes = {
  vertex: true,
  material: true,
  color: true
};

ShaderFlat.uniformNames = ['uColor', 'uAlpha', 'uLightDir'];
Array.prototype.push.apply(ShaderFlat.uniformNames, ShaderBase.uniformNames.commonUniforms);

ShaderFlat.vertex = [
  'attribute vec3 aVertex;',
  'attribute vec3 aColor;',
  'attribute vec3 aMaterial;',
  ShaderBase.strings.vertUniforms,
  'varying vec3 vVertex;',
  'varying vec3 vColor;',
  'varying float vMasking;',
  'void main() {',
  '  vMasking = aMaterial.z;',
  '  vColor = aColor;',
  '  vec4 vertex4 = vec4(aVertex, 1.0);',
  '  // DISABLE MASKING MIXING (Suspect uEM is bad)',
  '  // vertex4 = mix(vertex4, uEM * vertex4, vMasking);',
  '  gl_Position = uMVP * vertex4;',
  '  vVertex = vec3(uMV * vertex4);', 
  '}'
].join('\n');

ShaderFlat.fragment = [
  'precision highp float;',
  'uniform float uAlpha;',
  'varying vec3 vVertex;',
  'varying vec3 vColor;',
  'varying float vMasking;',
  'void main() {',
  '  vec3 n = normalize(cross(dFdx(vVertex), dFdy(vVertex)));',
  '  vec3 lDir = normalize(vec3(0.0, 0.0, 1.0));',
  '  float diffuse = max(0.0, dot(n, lDir));',
  '  diffuse = diffuse * 0.5 + 0.5; // Ambient + Diffuse',
  '  vec3 color = vColor * diffuse;',
  '  color *= (0.3 + 0.7 * vMasking);',
  '  gl_FragColor = vec4(color, uAlpha);',
  '}'
].join('\n');

ShaderFlat.updateUniforms = function (mesh, main) {
  mesh.getGL().uniform3fv(this.uniforms.uColor, mesh.getFlatColor());
  mesh.getGL().uniform1f(this.uniforms.uAlpha, mesh.getOpacity());
  ShaderBase.updateUniforms.call(this, mesh, main);
};

export default ShaderFlat;
