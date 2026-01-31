import ShaderBase from 'render/shaders/ShaderBase';

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
  '  pos.z -= 0.005 * pos.w;', // Pull wireframe closer to camera
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

  gl.enable(gl.POLYGON_OFFSET_FILL); // Also affects lines/points? No, check specific flags.
  // Actually WebGL 1.0/2.0 polygonOffset only affects POLYGONS. 
  // Lines are not affected by polygonOffset usually!
  // So my manual Z offset WAS the right approach.
  // Maybe I just need MORE offset? or `gl.depthFunc(gl.LEQUAL)` is standard.
  // I will revert to Manual Offset but make it adaptive?
  // 0.005 should be visible.
  // Maybe `uEM` is wrong?
  // Let's force a color too.
  // Enable Blend for semi-transparent lines
  // Enable Blend for semi-transparent lines
  gl.enable(gl.BLEND);
  // Use blendFuncSeparate to blend RGB but KEEP Alpha unchanged (ZERO*Src + ONE*Dst)
  gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);

  // We don't strictly need colorMask(..., false) now, but it doesn't hurt.
  // Actually, let's remove colorMask reliance to test if blendFuncSeparate is enough.
  // gl.colorMask(true, true, true, false); 

  gl.drawElements(gl.LINES, mesh.getRenderNbEdges() * 2, gl.UNSIGNED_INT, 0);
  gl.disable(gl.POLYGON_OFFSET_FILL);

  // Restore State
  // gl.colorMask(true, true, true, true);
  gl.disable(gl.BLEND);
};
ShaderWireframe.updateUniforms = function (mesh) {
  var gl = mesh.getGL();
  gl.uniformMatrix4fv(this.uniforms.uMVP, false, mesh.getMVP());
  gl.uniformMatrix4fv(this.uniforms.uEM, false, mesh.getEditMatrix());
};

export default ShaderWireframe;
