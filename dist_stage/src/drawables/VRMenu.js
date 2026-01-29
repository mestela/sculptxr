import { mat4, vec3 } from 'gl-matrix';
import Buffer from 'render/Buffer';
import ShaderLib from 'render/ShaderLib';
import Enums from 'misc/Enums';

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
