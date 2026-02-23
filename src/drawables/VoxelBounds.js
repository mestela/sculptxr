import { mat4, vec3, mat3 } from 'gl-matrix';
import Buffer from '../render/Buffer.js';
import ShaderLib from '../render/ShaderLib.js';
import Enums from '../misc/Enums.js';

class VoxelBounds {

  constructor(gl) {
    this._gl = gl;
    this._id = -1002; // Special ID for UI

    this._matrix = mat4.create();
    this._mv = mat4.create();
    this._mvp = mat4.create();
    this._n = mat3.create();
    this._en = mat3.create();
    this._editMat = mat4.create();

    // Wireframe Unit Cube [-0.5, 0.5] mapped as 12 lines (24 vertices)
    const v = [
      // Bottom face
      -0.5, -0.5, -0.5, 0.5, -0.5, -0.5,
      0.5, -0.5, -0.5, 0.5, -0.5, 0.5,
      0.5, -0.5, 0.5, -0.5, -0.5, 0.5,
      -0.5, -0.5, 0.5, -0.5, -0.5, -0.5,

      // Top face
      -0.5, 0.5, -0.5, 0.5, 0.5, -0.5,
      0.5, 0.5, -0.5, 0.5, 0.5, 0.5,
      0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
      -0.5, 0.5, 0.5, -0.5, 0.5, -0.5,

      // Vertical edges
      -0.5, -0.5, -0.5, -0.5, 0.5, -0.5,
      0.5, -0.5, -0.5, 0.5, 0.5, -0.5,
      0.5, -0.5, 0.5, 0.5, 0.5, 0.5,
      -0.5, -0.5, 0.5, -0.5, 0.5, 0.5
    ];

    this._vertexBuffer = new Buffer(gl, gl.ARRAY_BUFFER, gl.STATIC_DRAW);
    this._vertexBuffer.update(new Float32Array(v));
    this._vertexCount = v.length / 3;

    // We can animate the color
    this._color = new Float32Array([1.0, 0.4, 0.0]); // Voxel Orange
    this._pulseTime = 0;
  }

  updateMatrices(camera, size, matrix) {
    if (!size || !matrix) return false;

    // Apply scaling and translation in Local Space
    // Our unit cube is [-0.5, 0.5] so its size is 1.0. 
    // If the SculptVoxel size is 100, we scale it by 100.
    // However, the mesh itself is also often scaled by `Utils.SCALE` (usually 1/100 or 100) or similar.
    // Let's rely purely on the passed voxel size in local Voxel space.
    mat4.identity(this._matrix);
    mat4.scale(this._matrix, this._matrix, [size, size, size]);

    // Apply the world matrix of the voxel grid (so it rotates/scales correctly)
    mat4.mul(this._matrix, matrix, this._matrix);

    // Calculate MVP
    mat4.mul(this._mv, camera.getView(), this._matrix);
    mat4.mul(this._mvp, camera.getProjection(), this._mv);

    // Normal Matrix (Required by ShaderBase even if unlit)
    mat3.fromMat4(this._n, this._mv);
    mat3.invert(this._n, this._n);
    mat3.transpose(this._n, this._n);

    return true;
  }

  render(main, size, matrix) {
    const gl = this._gl;

    // Only render if we have a valid matrix update
    if (!this.updateMatrices(main.getCamera(), size, matrix)) return;

    // Static Dull Orange
    this._color[0] = 0.8;
    this._color[1] = 0.4;
    this._color[2] = 0.0;

    // Draw Unlit Wireframe
    const shader = ShaderLib[Enums.Shader.UNLIT].getOrCreate(gl);

    // Disable depth testing so the bounding box always renders over the mesh
    gl.disable(gl.DEPTH_TEST);
    shader.draw(this, main);
    gl.enable(gl.DEPTH_TEST);
  }

  // ==== ShaderBase Rigorous Interface Fake ====
  getGL() { return this._gl; }
  getID() { return this._id; }
  getEditMatrix() { return this._editMat; }
  getEN() { return this._en; }
  getMV() { return this._mv; }
  getMVP() { return this._mvp; }
  getN() { return this._n; }

  getFlatShading() { return true; }
  getSymmetryOrigin() { return [0, 0, 0]; }
  getSymmetryNormal() { return [1, 0, 0]; }
  getOpacity() { return 0.8; }
  getFlatColor() { return this._color; }

  // Vital missing buffers mapped to vertex fallback to prevent crashing checks
  getMaterialBuffer() { return this._vertexBuffer; }
  getNormalBuffer() { return this._vertexBuffer; }
  getColorBuffer() { return this._vertexBuffer; }

  getVertexBuffer() { return this._vertexBuffer; }
  getIndexBuffer() { return null; }
  getWireframeBuffer() { return null; }

  // CRITICAL for drawing lines
  isUsingDrawArrays() { return true; }
  getMode() { return this._gl.LINES; }
  getCount() { return this._vertexCount; }
}

export default VoxelBounds;
