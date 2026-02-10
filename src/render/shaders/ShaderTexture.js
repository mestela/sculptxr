import ShaderBase from './ShaderBase.js';
import Attribute from '../Attribute.js';

var ShaderTexture = ShaderBase.getCopy();
ShaderTexture.vertexName = ShaderTexture.fragmentName = 'TextureUnlit';

ShaderTexture.uniforms = {};
ShaderTexture.attributes = {};
ShaderTexture.activeAttributes = {
  vertex: true,
  normal: false,
  material: false,
  color: false
};

ShaderTexture.uniformNames = ['uTexture', 'uMVP']; // uMVP is usually standard but we list explicitly if needed

ShaderTexture.vertex = [
  'attribute vec3 aVertex;',
  'attribute vec2 aTexCoord;',
  'varying vec2 vTexCoord;',
  'uniform mat4 uMVP;',
  'void main() {',
  '  vTexCoord = aTexCoord;',
  '  gl_Position = uMVP * vec4(aVertex, 1.0);',
  '}'
].join('\n');

ShaderTexture.fragment = [
  'precision mediump float;',
  'varying vec2 vTexCoord;',
  'uniform sampler2D uTexture;',
  'void main() {',
  '  gl_FragColor = texture2D(uTexture, vTexCoord);',
  '}'
].join('\n');

// Map Base Methods
ShaderTexture.draw = ShaderBase.draw;
ShaderTexture.drawBuffer = ShaderBase.drawBuffer;
ShaderTexture.getOrCreate = ShaderBase.getOrCreate;
ShaderTexture.initUniforms = ShaderBase.initUniforms;

// Custom Attribute Initialization
ShaderTexture.initAttributes = function (gl) {
  // We don't call ShaderBase.initAttributes because we only want specific ones
  // But ShaderBase.initAttributes might be useful for standard ones? 
  // Actually ShaderUV calls it. Let's stick to manual for simplicity or mimic ShaderUV.
  // ShaderUV calls ShaderBase.initAttributes.call(this, gl);
  // But we have custom aVertex here... let's just do it manual to be safe & simple.

  var program = ShaderTexture.program;
  ShaderTexture.attributes.aVertex = new Attribute(gl, program, 'aVertex', 3, gl.FLOAT);
  ShaderTexture.attributes.aTexCoord = new Attribute(gl, program, 'aTexCoord', 2, gl.FLOAT);
};

// Custom Bind Attributes
ShaderTexture.bindAttributes = function (mesh) {
  ShaderTexture.attributes.aVertex.bindToBuffer(mesh.getVertexBuffer());
  ShaderTexture.attributes.aTexCoord.bindToBuffer(mesh.getTexCoordBuffer());
};

// Custom Update Uniforms
ShaderTexture.updateUniforms = function (mesh, main) {
  var gl = mesh.getGL();
  var uniforms = this.uniforms;

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, mesh.getTexture());
  gl.uniform1i(uniforms.uTexture, 0);

  gl.uniformMatrix4fv(uniforms.uMVP, false, mesh.getMVP());
};


// Custom Unbind Attributes
ShaderTexture.unbindAttributes = function () {
  ShaderTexture.attributes.aVertex.unbind();
  ShaderTexture.attributes.aTexCoord.unbind();
};

export default ShaderTexture;
