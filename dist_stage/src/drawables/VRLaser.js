import { mat4, vec3, mat3 } from 'gl-matrix';
import Buffer from 'render/Buffer';
import ShaderLib from 'render/ShaderLib';
import Enums from 'misc/Enums';
import Primitives from 'drawables/Primitives';

class VRLaser {

  constructor(gl) {
    this._gl = gl;
    this._id = -1001; // Special ID

    this._matrix = mat4.create();
    this._mv = mat4.create();
    this._mvp = mat4.create();
    this._n = mat3.create();
    this._en = mat3.create();
    this._editMat = mat4.create();

    this._origin = vec3.fromValues(0, 0, 0);
    this._normal = vec3.fromValues(0, 0, 1); // Z

    // Geometry: Thin Cylinder (8 segments)
    const w = 0.001; // 1mm radius
    const segments = 8;
    const l = 1.0; // Base length 1m

    // Vertices container
    const v = [];
    const pushV = (x, y, z) => v.push(x, y, z);

    // SIDES
    for (let i = 0; i < segments; i++) {
      const u1 = (i / segments) * Math.PI * 2;
      const u2 = ((i + 1) / segments) * Math.PI * 2;

      const c1 = Math.cos(u1) * w;
      const s1 = Math.sin(u1) * w;
      const c2 = Math.cos(u2) * w;
      const s2 = Math.sin(u2) * w;

      // Quad i: (c1,s1,0) -> (c2,s2,0) -> (c2,s2,-l) -> (c1,s1,-l)
      // Tri 1
      pushV(c1, s1, 0);
      pushV(c2, s2, 0);
      pushV(c2, s2, -l);

      // Tri 2
      pushV(c1, s1, 0);
      pushV(c2, s2, -l);
      pushV(c1, s1, -l);
    }

    // Front Cap (Near Hand, Z=0)
    for (let i = 0; i < segments; i++) {
      const u1 = (i / segments) * Math.PI * 2;
      const u2 = ((i + 1) / segments) * Math.PI * 2;
      pushV(0, 0, 0);
      pushV(Math.cos(u2) * w, Math.sin(u2) * w, 0);
      pushV(Math.cos(u1) * w, Math.sin(u1) * w, 0);
    }
    
    // Back Cap (Far End, Z=-l)
    for (let i = 0; i < segments; i++) {
      const u1 = (i / segments) * Math.PI * 2;
      const u2 = ((i + 1) / segments) * Math.PI * 2;
      pushV(0, 0, -l);
      pushV(Math.cos(u1) * w, Math.sin(u1) * w, -l);
      pushV(Math.cos(u2) * w, Math.sin(u2) * w, -l);
    }

    this._vertexBuffer = new Buffer(gl, gl.ARRAY_BUFFER, gl.STATIC_DRAW);
    this._vertexBuffer.update(new Float32Array(v));

    this._vertexCount = v.length / 3;
  }

  updateMatrices(camera, parentMatrix, length = 1.0) {
    if (!parentMatrix) return;

    // Model Matrix with Scale
    mat4.copy(this._matrix, parentMatrix);
    // Scale Z by length (geometry is Z=0 to Z=-1, so scale makes it shorter/longer)
    mat4.scale(this._matrix, this._matrix, [1, 1, length]);

    // MVP
    mat4.mul(this._mv, camera.getView(), this._matrix);
    mat4.mul(this._mvp, camera.getProjection(), this._mv);

    // Normal Matrix
    mat3.fromMat4(this._n, this._mv);
    mat3.invert(this._n, this._n);
    mat3.transpose(this._n, this._n);
  }

  render(main) {
    const gl = this._gl;
    const shader = ShaderLib[Enums.Shader.UNLIT].getOrCreate(gl);
    shader.draw(this, main);
  }

  // ShaderBase Interface
  getGL() { return this._gl; }
  getID() { return this._id; }
  getEditMatrix() { return this._editMat; }
  getEN() { return this._en; }
  getMV() { return this._mv; }
  getMVP() { return this._mvp; }
  getN() { return this._n; }

  getFlatShading() { return true; }
  getSymmetryOrigin() { return this._origin; }
  getSymmetryNormal() { return this._normal; }
  getOpacity() { return 1.0; }
  getFlatColor() { return [1.0, 0.0, 0.0]; } // RED Laser

  getMaterialBuffer() { return this._vertexBuffer; } // Fallback
  getNormalBuffer() { return this._vertexBuffer; }   // Fallback
  getColorBuffer() { return this._vertexBuffer; }    // Fallback
  getVertexBuffer() { return this._vertexBuffer; }
  getIndexBuffer() { return null; }
  getWireframeBuffer() { return null; }

  isUsingDrawArrays() { return true; }
  getMode() { return this._gl.TRIANGLES; }
  getCount() { return this._vertexCount; }
}

export default VRLaser;
