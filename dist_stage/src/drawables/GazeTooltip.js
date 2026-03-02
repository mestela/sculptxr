import { mat4, vec3, mat3 } from 'gl-matrix';
import Buffer from '../render/Buffer.js';
import ShaderLib from '../render/ShaderLib.js';
import Enums from '../misc/Enums.js';

export default class GazeTooltip {
  constructor(gl, text) {
    this._gl = gl;
    this._text = text;
    this._isVisible = false;
    this._opacity = 0.0;

    // Geometry
    this._vertexBuffer = new Buffer(gl, gl.ARRAY_BUFFER, gl.STATIC_DRAW);
    this._texCoordBuffer = new Buffer(gl, gl.ARRAY_BUFFER, gl.STATIC_DRAW);

    this._matrix = mat4.create();
    this._cacheMVP = mat4.create();

    this._texture = gl.createTexture();

    this._init();
    this._buildTexture();
  }

  _init() {
    // 10cm x 3cm tooltip quad
    const w = 0.05;
    const h = 0.015;

    const vertices = new Float32Array([
      -w, -h, 0.0,
      w, -h, 0.0,
      -w, h, 0.0,
      -w, h, 0.0,
      w, -h, 0.0,
      w, h, 0.0
    ]);

    const texCoords = new Float32Array([
      0.0, 1.0,
      1.0, 1.0,
      0.0, 0.0,
      0.0, 0.0,
      1.0, 1.0,
      1.0, 0.0
    ]);

    this._vertexBuffer.update(vertices);
    this._texCoordBuffer.update(texCoords);
  }

  _buildTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.beginPath();
    ctx.roundRect(0, 0, canvas.width, canvas.height, 10);
    ctx.fill();

    // Border
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 4;
    ctx.stroke();

    // Text
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 28px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this._text, canvas.width / 2, canvas.height / 2 + 2);

    // Upload to WebGL
    const gl = this._gl;
    gl.bindTexture(gl.TEXTURE_2D, this._texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  updateMatrices(camera, targetPos) {
    // Billboard towards camera
    const camPos = camera.computePosition();
    const up = vec3.fromValues(0, 1, 0);

    // LookAt matrix creates a view transform, we want the inverse (model object transform)
    mat4.lookAt(this._matrix, targetPos, camPos, up);
    mat4.invert(this._matrix, this._matrix);

    // Apply offset (e.g., float slightly above the controller)
    mat4.translate(this._matrix, this._matrix, [0, 0.08, 0]);

    // MVP
    mat4.mul(this._cacheMVP, camera.getProjection(), camera.getView());
    mat4.mul(this._cacheMVP, this._cacheMVP, this._matrix);
  }

  setOpacity(val) {
    this._opacity = Math.max(0, Math.min(1, val));
    this._isVisible = this._opacity > 0;
  }

  render() {
    if (!this._isVisible) return;

    const gl = this._gl;

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST); // Render over everything

    const shader = ShaderLib[Enums.Shader.BACKGROUND];
    gl.useProgram(shader.program);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._texture);
    gl.uniform1i(shader.uniforms.uTex, 0);

    // Use Alpha uniform if available, otherwise it renders full opacity
    // Assuming Background shader doesn't have opacity, so we might need a custom draw
    // If we just inject a color vector or rely on the base shader.
    // Let's use standard Background drawing.

    this._vertexBuffer.bind();
    gl.vertexAttribPointer(shader.attributes.aVertex, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(shader.attributes.aVertex);

    this._texCoordBuffer.bind();
    gl.vertexAttribPointer(shader.attributes.aTexCoord, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(shader.attributes.aTexCoord);

    gl.uniformMatrix4fv(shader.uniforms.uMVP, false, this._cacheMVP);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.disableVertexAttribArray(shader.attributes.aVertex);
    gl.disableVertexAttribArray(shader.attributes.aTexCoord);

    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
  }
}
