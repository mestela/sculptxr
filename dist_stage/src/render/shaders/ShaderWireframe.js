import ShaderBase from './ShaderBase.js';

var ShaderWireframe = ShaderBase.getCopy();
ShaderWireframe.vertexName = ShaderWireframe.fragmentName = 'Wireframe';

ShaderWireframe.uniforms = {};
ShaderWireframe.attributes = {};
ShaderWireframe.activeAttributes = {
  vertex: true,
  material: true
};

ShaderWireframe.uniformNames = ['uMVP', 'uEM'];

ShaderWireframe.vertex = [
  'attribute vec3 aVertex;',
  'attribute vec3 aMaterial;',
  'uniform mat4 uMVP;',
  'uniform mat4 uEM;',
  'void main() {',
  '  vec4 vertex4 = vec4(aVertex, 1.0);',
  '  vec4 pos = uMVP * mix(vertex4, uEM * vertex4, aMaterial.z);',
  '  pos.z -= 0.002 * pos.w;', // Pull wireframe closer to camera
  '  gl_Position = pos;',
  '}'
].join('\n');

ShaderWireframe.fragment = [
  'void main() {',
  '  gl_FragColor = vec4(0.0, 0.0, 0.0, 0.4);',
  '}'
].join('\n');

ShaderWireframe.getOrCreate = ShaderBase.getOrCreate;
ShaderWireframe.draw = function (mesh /*, main*/ ) {
  var gl = mesh.getGL();
  gl.useProgram(this.program);
  this.bindAttributes(mesh);
  this.updateUniforms(mesh);
  mesh.getWireframeBuffer().bind();

  gl.enable(gl.POLYGON_OFFSET_FILL);
  gl.polygonOffset(-1.0, -1.0); // Try standard offset

  gl.enable(gl.BLEND);
  gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);

  // gl.drawElements(gl.LINES, mesh.getRenderNbEdges() * 2, gl.UNSIGNED_INT, 0);
  gl.disable(gl.POLYGON_OFFSET_FILL);

  gl.disable(gl.BLEND);
};
ShaderWireframe.updateUniforms = function (mesh) {
  var gl = mesh.getGL();
  gl.uniformMatrix4fv(this.uniforms.uMVP, false, mesh.getMVP());
  gl.uniformMatrix4fv(this.uniforms.uEM, false, mesh.getEditMatrix());
};

export default ShaderWireframe;
