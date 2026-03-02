import { mat4, vec3, mat3 } from 'gl-matrix';
import Buffer from '../render/Buffer.js';
import ShaderLib from '../render/ShaderLib.js';
import Enums from '../misc/Enums.js';

// Helper Class for 3D Cursor
class CursorMesh {
  constructor(gl) {
    this._gl = gl;
    this._id = -999; // Static ID
    this._matrix = mat4.create();
    this._mv = mat4.create();
    this._mvp = mat4.create();
    this._n = mat3.create(); // Normal Matrix
    this._en = mat3.create(); // Edit Normal Matrix
    this._editMat = mat4.create(); // Edit Matrix
    this._center = [0, 0, 0];
    this._origin = [0, 0, 0];
    this._normal = [0, 1, 0];

    // Geometry
    const cw = 0.005; // 5mm radius
    const cverts = new Float32Array([
      -cw, -cw, 0.01, cw, -cw, 0.01, -cw, cw, 0.01,
      -cw, cw, 0.01, cw, -cw, 0.01, cw, cw, 0.01
    ]);
    this._vertexBuffer = new Buffer(gl, gl.ARRAY_BUFFER, gl.STATIC_DRAW);
    this._vertexBuffer.update(cverts);
  }

  updateMatrices(camera, parentMatrix, lx, ly) {
    // Model Matrix
    mat4.copy(this._matrix, parentMatrix);
    mat4.translate(this._matrix, this._matrix, [lx, ly, 0.0]); // Z is in verts

    // MVP
    mat4.mul(this._mv, camera.getView(), this._matrix);
    mat4.mul(this._mvp, camera.getProjection(), this._mv);

    // Normal Matrix (approx identity for flat cursor is fine, but better to be correct)
    mat3.fromMat4(this._n, this._mv);
    mat3.invert(this._n, this._n);
    mat3.transpose(this._n, this._n);
  }

  // Interface for ShaderBase
  getGL() { return this._gl; }
  getID() { return this._id; }
  getEditMatrix() { return this._editMat; } // Identity
  getEN() { return this._en; } // Identity
  getMV() { return this._mv; }
  getMVP() { return this._mvp; }
  getN() { return this._n; }

  getFlatShading() { return true; } // Use flat shading (dFdx/dFdy) so we ignore bounds normals
  getSymmetryOrigin() { return this._origin; }
  getSymmetryNormal() { return this._normal; }
  getOpacity() { return 1.0; }
  getFlatColor() { return [1.0, 0.0, 0.0]; } // RED

  // Buffers (Return Vertex Buffer as fallback to prevents null bind crashes)
  getMaterialBuffer() { return this._vertexBuffer; }
  getNormalBuffer() { return this._vertexBuffer; }
  getColorBuffer() { return this._vertexBuffer; }
  getVertexBuffer() { return this._vertexBuffer; }
  getIndexBuffer() { return null; } // DrawArrays doesn't use IndexBuffer
  getWireframeBuffer() { return null; }

  // Draw Props
  isUsingDrawArrays() { return true; }
  getMode() { return this._gl.TRIANGLES; }
  getCount() { return 6; }
}

class VRMenu {

  constructor(gl, guiXR) {
    this._gl = gl;
    this._guiXR = guiXR; // Reference to the texture manager

    this._vertexBuffer = new Buffer(gl, gl.ARRAY_BUFFER, gl.STATIC_DRAW);
    this._texCoordBuffer = new Buffer(gl, gl.ARRAY_BUFFER, gl.STATIC_DRAW);

    this._cacheMVP = mat4.create();
    this._matrix = mat4.create(); // Local transform relative to controller

    this._init();
  }

  _init() {
    // We want the Quad size to match the Canvas aspect ratio, maintaining the 
    // physical pixel density of the 1024x1024 / 0.30m setup.
    // Total width is 2*w. Density = 1024 / 0.30 = 3413.33 px/meter.
    const DENSITY = 1024 / 0.30;

    const canvasWidth = this._guiXR._canvas ? this._guiXR._canvas.width : 1024;
    const canvasHeight = this._guiXR._canvas ? this._guiXR._canvas.height : 1024;

    const w = (canvasWidth / DENSITY) / 2.0;
    const h = (canvasHeight / DENSITY) / 2.0;

    this._w = w;
    this._h = h;

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

    this._texCoordBuffer.update(texCoords);

    // Initial State
    // Cursor Mesh (Small Quad/Cube)
    // We can use a simple small quad.
    // 3D Cursor Mesh
    this._cursorMesh = new CursorMesh(this._gl);

    this._rotation = vec3.fromValues(Math.PI / 2, 0, 0); // +90 deg X (Correct Face?)
    this._offset = vec3.fromValues(0.15, 0.0, 0.0); // 15cm right (clears controller)

    this.rebuildMatrix();
  }

  rebuildMatrix() {
    mat4.identity(this._matrix);
    mat4.translate(this._matrix, this._matrix, this._offset);
    mat4.rotateX(this._matrix, this._matrix, this._rotation[0]);
    mat4.rotateY(this._matrix, this._matrix, this._rotation[1]);
    mat4.rotateZ(this._matrix, this._matrix, this._rotation[2]);
  }

  // Adjust Rotation (Delta in Radians)
  adjustRotation(dx, dy, dz) {
    this._rotation[0] += dx;
    this._rotation[1] += dy;
    this._rotation[2] += dz;
    this.rebuildMatrix();

    // Log occasionally? Or let caller handle logging
    return this._rotation;
  }

  setRotation(x, y, z) {
    vec3.set(this._rotation, x, y, z);
    this.rebuildMatrix();
  }

  setOffset(x, y, z) {
    vec3.set(this._offset, x, y, z);
    this.rebuildMatrix();
  }

  updateMatrices(camera, controllerMatrix) {
    if (!controllerMatrix) return;

    // Model Matrix = Controller * LocalOffset
    const model = mat4.clone(controllerMatrix); // Use clone or temp
    mat4.mul(model, model, this._matrix);
    this._cacheWorld = model;

    // MVP
    mat4.mul(this._cacheMVP, camera.getProjection(), camera.getView());
    mat4.mul(this._cacheMVP, this._cacheMVP, model);
  }

  intersect(origin, direction) {
    if (!this._cacheWorld) return null;

    // Invert World Matrix to transform Ray to Local Space
    const invWorld = mat4.create();
    mat4.invert(invWorld, this._cacheWorld);

    // Transform Origin
    const localOrigin = vec3.create();
    vec3.transformMat4(localOrigin, origin, invWorld);

    // Transform Direction (as valid vector, ignoring translation)
    const localDir = vec3.create();
    // Direction is a vector, so w=0 for transform
    // vec3.transformMat4 treats it as point (w=1) if we aren't careful?
    // standard vec3.transformMat4 does: x*m00 + y*m10 + z*m20 + m30. That's for points.
    // For vectors, we want to ignore translation.
    // So we use mat3 from mat4, or just subtract transformed (0,0,0) from transformed (dir).
    // Or just:
    // v' = M * v
    // We want invWorld * direction.
    // Direction vector: (dx, dy, dz, 0).
    // gl-matrix doesn't have transformVec4 explicit for direction?
    // Actually: vec3.transformMat4 expects a point.
    // Correct way for direction:
    // let p1 = origin + dir;
    // localP1 = invWorld * p1;
    // localDir = normalize(localP1 - localOrigin);

    // Let's use the p1 method to be safe
    const p1 = vec3.create();
    vec3.add(p1, origin, direction);
    const localP1 = vec3.create();
    vec3.transformMat4(localP1, p1, invWorld);
    vec3.sub(localDir, localP1, localOrigin);
    vec3.normalize(localDir, localDir);

    // Intersect with Plane Z=0
    // P = O + tD
    // Pz = Oz + t*Dz = 0
    // t = -Oz / Dz
    if (Math.abs(localDir[2]) < 1e-6) return null; // Parallel

    const t = -localOrigin[2] / localDir[2];
    if (t < 0) return null; // Behind ray

    // Intersection Point
    const lx = localOrigin[0] + localDir[0] * t;
    const ly = localOrigin[1] + localDir[1] * t;

    // Check bounds using exact generated dimensions
    const w = this._w;
    const h = this._h;
    if (lx < -w || lx > w || ly < -h || ly > h) return null;

    // Map to UV [0,1]
    const u = (lx + w) / (2 * w);

    // UV Mapping:
    // Physical Quad bounds: -h (bottom/near) to h (top/away).
    // Canvas bounds: 0 (top of UI, "Brush") to 1 (bottom of UI).
    // GuiXR applies UNPACK_FLIP_Y_WEBGL=true, so texture V=0 matches canvas bottom, and V=1 matches canvas top!
    // But GuiXR.onInteract ignores OpenGL V and uses raw `v`.
    // We want physical bottom (-h) to map to the top of the UI (v = 0).
    const v = (ly + h) / (2 * h);

    // Throttle logs for debugging if you need to enable them later
    // if (Math.random() < 0.05) {
    //   console.log(`[VRMenu] Hit! Local: ${lx.toFixed(2)},${ly.toFixed(2)} UV: ${u.toFixed(2)},${v.toFixed(2)}`);
    // }

    return {
      uv: [u, v],
      distance: t
    };
  }


  render(main) {
    if (!this._guiXR || !this._guiXR._isVisible) return;
    this._guiXR.updateTexture();

    // Debug Log (Throttle)
    if (!this._logThrottle) this._logThrottle = 0;
    if (this._logThrottle++ > 180) { // ~3 seconds
      this._logThrottle = 0;
      // console.log("VRMenu Render:",
      //   "MVP Pos (XYZW):",
      //   this._cacheMVP[12].toFixed(3),
      //   this._cacheMVP[13].toFixed(3),
      //   this._cacheMVP[14].toFixed(3),
      //   this._cacheMVP[15].toFixed(3),
      //   "Texture:", this._guiXR.getTexture() ? "Valid" : "INT-NULL",
      //   "Cull:", this._gl.getParameter(this._gl.CULL_FACE),
      //   "Depth:", this._gl.getParameter(this._gl.DEPTH_TEST)
      // );
    }

    const gl = this._gl;
    // OPTIMIZATION: Removed gl.getParameter calls (Top Performance Bottleneck: ~1ms per call)
    // We just enforce the state we need.

    // 1. Culling: We want it OFF for the menu (Double Sided)
    gl.disable(gl.CULL_FACE);

    // 2. Depth Test: We want it ON to sort with controllers
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);

    // 3. Blending: We want it ON for transparency
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    ShaderLib[Enums.Shader.TEXTURE].getOrCreate(this._gl).draw(this, main);

    // RESTORE DEFAULTS (Approximation - to be safe for next pass)
    // Most opaque geometry needs Cull Face ON and Depth Test ON.
    // Blending usually OFF.
    gl.enable(gl.CULL_FACE);
    // gl.enable(gl.DEPTH_TEST); // Already ON
    gl.disable(gl.BLEND);

    // --- DRAW 3D CURSOR ---
    const cursorUV = this._guiXR.getCursorUV();
    if (cursorUV && !this._guiXR._isPopupHUD) {
      // Calculate Local Position
      const w = this._w;
      const h = this._h;
      // Reverse map the exact same formula:
      // u = (lx + w) / 2w  =>  lx = -w + u * 2w
      // v = (ly + h) / 2h  =>  ly = -h + v * 2h
      const lx = -w + cursorUV.u * (2.0 * w);
      const ly = -h + cursorUV.v * (2.0 * h);

      if (this._cacheWorld && this._cursorMesh) {
        this._cursorMesh.updateMatrices(main.getCamera(), this._cacheWorld, lx, ly);

        // Debug Log (Throttle)
        if (!this._cursorLog) this._cursorLog = 0;
        if (this._cursorLog++ > 60) { // ~0.6 sec
          this._cursorLog = 0;
          const mvp = this._cursorMesh.getMVP();
          const gl = this._gl;
          if (window.screenLog) {
            // window.screenLog(`CurUV:${cursorUV.u.toFixed(2)},${cursorUV.v.toFixed(2)} LX:${lx.toFixed(2)} LY:${ly.toFixed(2)}`, "cyan");
          }
        }

        // Ensure Cursor is Visible
        // 1. Disable Culling (in case winding is wrong)
        gl.disable(gl.CULL_FACE);
        // 2. Enable Depth Test (should be on, but double check)
        gl.enable(gl.DEPTH_TEST);

        const shader = ShaderLib[Enums.Shader.FLAT].getOrCreate(gl);
        shader.draw(this._cursorMesh, main);

        // Restore State (Assume Cull ON is default for rest of scene)
        gl.enable(gl.CULL_FACE);
      }
    }
  }


  getMVP() {
    return this._cacheMVP;
  }

  getTexture() {
    return this._guiXR.getTexture();
  }

  bindBuffer(attrib) {
    this._vertexBuffer.bind(attrib);
  }

  bindTexCoordBuffer(attrib) {
    this._texCoordBuffer.bind(attrib);
  }

  getCount() {
    return 6; // 2 triangles
  }

  getGL() {
    return this._gl;
  }

  getVertexBuffer() {
    return this._vertexBuffer;
  }

  getTexCoordBuffer() {
    return this._texCoordBuffer;
  }

  isUsingDrawArrays() {
    return true; // We use drawArrays, not drawElements
  }

  getMode() {
    return this._gl.TRIANGLES;
  }
}

export default VRMenu;
