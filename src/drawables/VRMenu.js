import { mat4, vec3, mat3 } from 'gl-matrix';
import Buffer from 'render/Buffer';
import ShaderLib from 'render/ShaderLib';
import Enums from 'misc/Enums';

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
    // Simple Quad (centered)
    const w = 0.15; // 15cm width
    const h = 0.15; // 15cm height

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
    this._offset = vec3.fromValues(0.15, 0.0, 0.0); // 15cm right

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

    // Check bounds
    const w = 0.15;
    const h = 0.15;
    if (lx < -w || lx > w || ly < -h || ly > h) return null;

    // Map to UV [0,1]
    // -w -> 0, +w -> 1
    // u = (lx + w) / (2*w)
    // V calculation: Map 3D Top (+h) to Canvas Top (0)
    // V calculation: Map 3D Top (+h) to Canvas Top (0)
    const u = (lx + w) / (2 * w);
    const v = (ly + h) / (2 * h); // Re-Reverted (User says inverted)

    // Throttle logs
    // if (Math.random() < 0.05) {
    //   console.log(`[VRMenu] Hit! Local: ${lx.toFixed(2)},${ly.toFixed(2)} UV: ${u.toFixed(2)},${v.toFixed(2)}`);
    // }

    return {
      uv: [u, v],
      distance: t
    };
  }


  render(main) {
    if (this._guiXR) this._guiXR.updateTexture();

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
    const isCull = gl.getParameter(gl.CULL_FACE);
    const isDepth = gl.getParameter(gl.DEPTH_TEST);
    const isBlend = gl.getParameter(gl.BLEND);

    // FIX: Enable Depth Test so Menu sorts correctly with Controllers and Mesh
    // if (isCull) gl.disable(gl.CULL_FACE); // Keep Culling disabled (Double Sided)
    // if (isDepth) gl.disable(gl.DEPTH_TEST); // REMOVED: We WANT Depth Test!

    if (isCull) gl.disable(gl.CULL_FACE);
    if (!isDepth) gl.enable(gl.DEPTH_TEST); // Ensure Depth is ON
    if (!isBlend) gl.enable(gl.BLEND); // Ensure Blending is ON for Menu
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); // Standard Alpha Blend

    ShaderLib[Enums.Shader.TEXTURE].getOrCreate(this._gl).draw(this, main);

    if (isCull) gl.enable(gl.CULL_FACE);
    if (!isDepth) gl.disable(gl.DEPTH_TEST); // Restore OFF if it was OFF
    if (!isBlend) gl.disable(gl.BLEND); // Restore OFF if it was OFF

    // --- DRAW 3D CURSOR ---
    const cursorUV = this._guiXR.getCursorUV();
    if (cursorUV) {
      // Calculate Local Position
      // Menu Quad is [-w, -h] to [w, h] with w=0.15, h=0.15
      const w = 0.15;
      const h = 0.15;
      // UV [0..1] -> [-w..w]
      // x = -w + u*2w
      // y = -h + (1-v)*2h (Canvas origin TL, GL origin BL?)
      // GuiXR.js uses ctx (TL origin). 
      // VRMenu constructor texCoords: TL=(0,1)? 
      // texCoords:
      // 0.0, 1.0 (BL in GL? No, texture coordinates usually 0,0 BL)
      // Canvas 0,0 is Top-Left.
      // Mesh:
      // -w, -h (Bottom Left) -> UV(0, 1) ??
      // Let's check VRMenu vertices/texcoords:
      // -w, -h -> 0.0, 1.0  (Bottom Left Vertex has UV 0,1)
      // This implies Texture T=1 is Bottom?
      // Canvas T=0 is Top.
      // Usually: GL 0,0 is Bottom Left.
      // Canvas to Textures usually flips Y unless PREMULTIPLY_ALPHA / UNPACK_FLIP_Y_WEBGL is set.
      // Scene.js: gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      // So Canvas(0,0 TL) -> Texture(0,0 BL) ?? No.
      // If FLIP_Y is true:
      // Canvas Row 0 (Top) -> Texture Row 0 (Bottom).
      // So Canvas Top -> Texture Bottom (V=0).
      // Vertices:
      // -w, -h (Bottom physical) has UV 0,1 ??
      // If Texture Bottom is V=0.
      // Then Bottom Physical should have V=0?
      // Code: -w, -h -> 0.0, 1.0.
      // Code: -w, h (Top Physical) -> 0.0, 0.0.
      // So Top Physical -> V=0.
      // Texture Bottom (V=0) is stored with Canvas Top?
      // If FLIP_Y=true, Canvas Top becomes Texture Bottom.
      // So Canvas(0,0) -> Texture(0,0).
      // So Top Physical (-w, h) maps to Texture(0,0).
      // So UV(0,0) is Top-Left of Canvas.
      // Correct.
      //
      // So:
      // u goes 0..1 (Left..Right) => -w..w
      // v goes 0..1 (Top..Bottom) => h..-h

      const lx = -w + cursorUV.u * (2.0 * w);
      const ly = h - cursorUV.v * (2.0 * h);

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

        // Restore State (VRMenu standard state usually has Cull OFF, but we respect isCull from above)
        if (isCull) gl.enable(gl.CULL_FACE);
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
