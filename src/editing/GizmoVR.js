import { vec3, mat4, quat } from 'gl-matrix';
import Primitives from '../drawables/Primitives.js';
import Enums from '../misc/Enums.js';

// Configuration constants
const COLOR_X = vec3.fromValues(0.7, 0.2, 0.2);
const COLOR_Y = vec3.fromValues(0.2, 0.7, 0.2);
const COLOR_Z = vec3.fromValues(0.2, 0.2, 0.7);
const COLOR_GREY = vec3.fromValues(0.4, 0.4, 0.4);
const COLOR_SW = vec3.fromValues(0.8, 0.4, 0.2);
const COLOR_SELECT = vec3.fromValues(1.0, 1.0, 0.0);

// Geometry constants
const ARROW_LENGTH = 2.5;
const ARROW_CONE_THICK = 6.0;
const ARROW_CONE_LENGTH = 0.25;
const THICKNESS = 0.02;
const THICKNESS_PICK = THICKNESS * 5.0;
const ROT_RADIUS = 1.5;
const SCALE_RADIUS = ROT_RADIUS * 1.3;
const CUBE_SIDE = 0.35;
const CUBE_SIDE_PICK = CUBE_SIDE * 1.2;

// Bitmasks for Gizmo parts
export const GIZMO_TYPE = {
  TRANS_X: 1 << 0,
  TRANS_Y: 1 << 1,
  TRANS_Z: 1 << 2,
  ROT_X: 1 << 3,
  ROT_Y: 1 << 4,
  ROT_Z: 1 << 5,
  ROT_W: 1 << 6,
  PLANE_X: 1 << 7,
  PLANE_Y: 1 << 8,
  PLANE_Z: 1 << 9,
  SCALE_X: 1 << 10,
  SCALE_Y: 1 << 11,
  SCALE_Z: 1 << 12,
  SCALE_W: 1 << 13
};

const TRANS_XYZ = GIZMO_TYPE.TRANS_X | GIZMO_TYPE.TRANS_Y | GIZMO_TYPE.TRANS_Z;
const ROT_XYZ = GIZMO_TYPE.ROT_X | GIZMO_TYPE.ROT_Y | GIZMO_TYPE.ROT_Z;
const PLANE_XYZ = GIZMO_TYPE.PLANE_X | GIZMO_TYPE.PLANE_Y | GIZMO_TYPE.PLANE_Z;
const SCALE_XYZW = GIZMO_TYPE.SCALE_X | GIZMO_TYPE.SCALE_Y | GIZMO_TYPE.SCALE_Z | GIZMO_TYPE.SCALE_W;

const createGizmoPart = function (type, nbAxis = -1) {
  return {
    _finalMatrix: mat4.create(),
    _baseMatrix: mat4.create(),
    _color: vec3.create(),
    _drawGeo: null,
    _pickGeo: null,
    _isSelected: false,
    _type: type,
    _nbAxis: nbAxis,
    _lastInter: [0.0, 0.0, 0.0],
    updateMatrix() {
      if (this._drawGeo) mat4.copy(this._drawGeo.getMatrix(), this._finalMatrix);
      if (this._pickGeo) mat4.copy(this._pickGeo.getMatrix(), this._finalMatrix);
    },
    updateFinalMatrix(mat) {
      mat4.mul(this._finalMatrix, mat, this._baseMatrix);
    }
  };
};

class GizmoVR {

  constructor(main) {
    this._main = main;
    this._gl = main._gl;

    // Default active types
    this._activatedType = TRANS_XYZ | ROT_XYZ | PLANE_XYZ | SCALE_XYZW | GIZMO_TYPE.ROT_W;

    // Components
    this._transX = createGizmoPart(GIZMO_TYPE.TRANS_X, 0);
    this._transY = createGizmoPart(GIZMO_TYPE.TRANS_Y, 1);
    this._transZ = createGizmoPart(GIZMO_TYPE.TRANS_Z, 2);

    this._planeX = createGizmoPart(GIZMO_TYPE.PLANE_X, 0);
    this._planeY = createGizmoPart(GIZMO_TYPE.PLANE_Y, 1);
    this._planeZ = createGizmoPart(GIZMO_TYPE.PLANE_Z, 2);

    this._scaleX = createGizmoPart(GIZMO_TYPE.SCALE_X, 0);
    this._scaleY = createGizmoPart(GIZMO_TYPE.SCALE_Y, 1);
    this._scaleZ = createGizmoPart(GIZMO_TYPE.SCALE_Z, 2);
    this._scaleW = createGizmoPart(GIZMO_TYPE.SCALE_W);

    this._rotX = createGizmoPart(GIZMO_TYPE.ROT_X, 0);
    this._rotY = createGizmoPart(GIZMO_TYPE.ROT_Y, 1);
    this._rotZ = createGizmoPart(GIZMO_TYPE.ROT_Z, 2);
    this._rotW = createGizmoPart(GIZMO_TYPE.ROT_W);

    this._pickables = [];
    this._selected = null;

    // Initialize geometry
    this._resize(1.0);

    // Debug Hook
    window.debugGizmoVR = () => {
      console.log("=== GizmoVR Debug ===");
      console.log("Gizmo Instance:", this);
      console.log("Enabled Config:", this._activatedType);

      const components = [
        this._transX, this._transY, this._transZ,
        this._planeX, this._planeY, this._planeZ,
        this._rotX, this._rotY, this._rotZ, this._rotW,
        this._scaleX, this._scaleY, this._scaleZ, this._scaleW
      ];
      console.log("Components:", components);

      const sample = this._transX;
      console.log("TransX Matrix:", sample._finalMatrix);
      console.log("TransX DrawGeo:", sample._drawGeo);
      if (sample._drawGeo) {
        console.log("TransX ShaderType:", sample._drawGeo._shaderType);
      }
      console.log("vrScale:", this._main._vrScale);

      // Query Scale
      window.debugGizmoIntersection = true;
      console.log("Debug Gizmo Intersection ENABLED (window.debugGizmoIntersection = true)");
      // window.debugGizmoScale = scaleFactor; // ReferenceError: scaleFactor is not defined in this scope
      return "Check Console";
    };

    window.debugQueryGizmoScale = () => {
      return "Gizmo Scale: " + (this._transX._finalMatrix[0] / (this._main._vrScale || 50.0));
    };
  }

  _resize(scale) {
    // Re-create geometry with new scale
    // In VR we might want to just scale the matrix, but baking scale into geometry 
    // helps keep line thickness constant or controllable.
    this._initTranslate(scale);
    this._initRotate(scale);
    this._initScale(scale);
    this._initPickables();
  }

  _initPickables() {
    this._pickables.length = 0;
    const type = this._activatedType;

    const parts = [
      { mask: GIZMO_TYPE.TRANS_X, obj: this._transX },
      { mask: GIZMO_TYPE.TRANS_Y, obj: this._transY },
      { mask: GIZMO_TYPE.TRANS_Z, obj: this._transZ },
      { mask: GIZMO_TYPE.PLANE_X, obj: this._planeX },
      { mask: GIZMO_TYPE.PLANE_Y, obj: this._planeY },
      { mask: GIZMO_TYPE.PLANE_Z, obj: this._planeZ },
      { mask: GIZMO_TYPE.ROT_X, obj: this._rotX },
      { mask: GIZMO_TYPE.ROT_Y, obj: this._rotY },
      { mask: GIZMO_TYPE.ROT_Z, obj: this._rotZ },
      { mask: GIZMO_TYPE.SCALE_X, obj: this._scaleX },
      { mask: GIZMO_TYPE.SCALE_Y, obj: this._scaleY },
      { mask: GIZMO_TYPE.SCALE_Z, obj: this._scaleZ },
      { mask: GIZMO_TYPE.SCALE_W, obj: this._scaleW }
    ];

    for (let i = 0; i < parts.length; ++i) {
      if (type & parts[i].mask) this._pickables.push(parts[i].obj._pickGeo);
    }
  }

  update(camera) {
    // 1. Calculate Center
    const meshes = this._main.getSelectedMeshes();
    const center = [0.0, 0.0, 0.0];

    if (meshes.length > 0) {
      const acc = [0.0, 0.0, 0.0];
      const icenter = [0.0, 0.0, 0.0];
      for (let i = 0; i < meshes.length; ++i) {
        const mesh = meshes[i];
        vec3.transformMat4(icenter, mesh.getCenter(), mesh.getEditMatrix());
        vec3.transformMat4(icenter, icenter, mesh.getMatrix());
        vec3.add(acc, acc, icenter);
      }
      vec3.scale(center, acc, 1.0 / meshes.length);
    } else if (window.debugGizmoAttach === 'controller') {
      // Controller Attach Mode
      const main = this._main;
      if (main._vrControllerPos && main._vrControllerQuat) {
        vec3.copy(center, main._vrControllerPos);
        const fwd = vec3.fromValues(0, 0, -1);
        vec3.transformQuat(fwd, fwd, main._vrControllerQuat);
        vec3.scaleAndAdd(center, center, fwd, 0.2); // 20cm forward
      }
    }

    // 2. Calculate Scale
    // We want the Gizmo to be a consistent physical size in VR
    // typically around 25cm (0.25m) feels good for hand interaction.
    // However, the internal coordinate system might be scaled (vrScale).

    const vrScale = this._main._vrScale || 50.0; // World Units per Meter
    const baseSize = 0.25; // 25cm target size

    // Fallback scale logic
    let scaleFactor = baseSize * vrScale;

    // Enforce reasonable minimum (User confirmed 10.0 worked)
    if (scaleFactor < 5.0) scaleFactor = 10.0;

    if (window.debugGizmoScale) {
      scaleFactor = window.debugGizmoScale;
    }

    // Resize geometry if scale changed significantly
    // (Optimization: only resize if diff > 10%)
    // But for now, let's just do it if we are still validating.
    // Actually, generating geometry every frame is bad.
    // Let's cache it.

    // We used to call _resize(scaleFactor * VERTEX_SCALE)
    // Let's assume VERTEX_SCALE = 1.0

    // Let's check if we really need to re-generate geometry. 
    // We can just scale the matrix!
    // The only reason to bake scale is if thickness needs to be non-uniform?
    // Start with identifying if we need to resize.

    // NOTE: In the previous code, _resize RECREATED all geometry. That is heavy.
    // We should try to avoid it.
    // Let's just create geometry ONCE at unit size, and scale via Matrix.
    // BUT: Arrow thickness etc might get weird if we scale non-uniformly.
    // For uniform scale, Matrix is fine.

    // Let's initialize once with scale 1.0 * vrScale?
    // Or just 1.0 and scale the matrix by vrScale?
    // The primitives usage in `Gizmo.js` baked scale into vertices.
    // Let's stick to baking for now to ensure visual consistency with what we had.
    this._resize(scaleFactor);

    // 3. Build Final Components Matrix
    const baseMat = mat4.create();
    mat4.translate(baseMat, baseMat, center);

    // Update all components
    const components = [
      this._transX, this._transY, this._transZ,
      this._planeX, this._planeY, this._planeZ,
      this._rotX, this._rotY, this._rotZ, this._rotW,
      this._scaleX, this._scaleY, this._scaleZ, this._scaleW
    ];

    for (let i = 0; i < components.length; ++i) {
      components[i].updateFinalMatrix(baseMat);
      components[i].updateMatrix();
    }
  }

  intersect(origin, direction) {
    const pick = this._main.getPicking();

    // Debug Trace (Optional)
    if (window.debugGizmoIntersection) {
      console.log("GizmoVR.intersect called");
      console.log("Origin:", origin);
      console.log("Direction:", direction);
      console.log("Pickables:", this._pickables.length);
    }

    // Use VR Intersection logic (Bypasses Screen Projection)
    // Physical Radius 5cm (0.05) for easier grabbing
    pick.intersectionRayMeshesVR(this._pickables, origin, direction, 0.05);

    if (this._selected) this._selected._isSelected = false;

    const mesh = pick.getMesh();

    // Visual Debugging of Intersection
    if (window.debugGizmoIntersection) {
      const hit = !!mesh;
      const pt = pick.getIntersectionPoint(); // Local
      // If we hit, we need to show where.
      // Since Gizmo parts are Identity Matrix (mostly, except _finalMatrix), 
      // AND picking does transform back to world...
      // Wait, picking.getIntersectionPoint() is LOCAL to the mesh.
      // We need WORLD point for the debugger.
      const worldPt = vec3.create();
      if (mesh) {
        vec3.transformMat4(worldPt, pt, mesh.getMatrix());
        console.log("Hit:", mesh._gizmo._type, "at", worldPt);
        // Draw a green sphere at hit
        this._main.updateDebugPivot(worldPt, true);
        window.debugPivotScale = 0.02; // Small
      } else {
        // Draw red sphere at 'far' to show ray direction?
        const far = vec3.create();
        vec3.scaleAndAdd(far, origin, direction, 0.5); // 50cm out
        this._main.updateDebugPivot(far, true);
        // Force Red? Scene.js updateDebugPivot uses setFlatColor... getting complex.
        // Let's just trust logs.
        console.log("No Hit");
      }
    }

    if (!mesh) {
      this._selected = null;
      return -1;
    }

    this._selected = mesh._gizmo;
    this._selected._isSelected = true;
    vec3.copy(this._selected._lastInter, pick.getIntersectionPoint());

    return this._selected._type;
  }

  render(camera) {
    const gl = this._gl;
    gl.disable(gl.DEPTH_TEST);

    const components = [
      this._transX, this._transY, this._transZ,
      this._planeX, this._planeY, this._planeZ,
      this._rotX, this._rotY, this._rotZ, this._rotW,
      this._scaleX, this._scaleY, this._scaleZ, this._scaleW
    ];



    for (let i = 0; i < components.length; ++i) {
      const elt = components[i];
      // Only render if active (technically _pickables only added active ones, but we iterate all here)
      // Check if it has geometry
      if (elt._drawGeo) {
        elt.updateMatrix(); // Ensure up to date
        const drawGeo = elt._drawGeo;
        drawGeo.setFlatColor(elt._isSelected ? COLOR_SELECT : elt._color);
        drawGeo.updateMatrices(camera);
        drawGeo.render(this._main);
      }
    }
    gl.enable(gl.DEPTH_TEST);
  }

  // --- Geometry Creation Helpers ---

  _createArrow(tra, axis, color, scale) {
    tra._baseMatrix = mat4.create();
    const mat = tra._baseMatrix;
    mat4.rotate(mat, mat, Math.PI * 0.5, axis);
    mat4.translate(mat, mat, [0.0, ARROW_LENGTH * 0.5 * scale, 0.0]);
    vec3.copy(tra._color, color);

    tra._pickGeo = Primitives.createArrow(
      this._gl,
      THICKNESS_PICK * scale,
      ARROW_LENGTH * scale,
      ARROW_CONE_THICK * 0.4
    );
    tra._pickGeo._gizmo = tra;

    tra._drawGeo = Primitives.createArrow(
      this._gl,
      THICKNESS * scale,
      ARROW_LENGTH * scale,
      ARROW_CONE_THICK,
      ARROW_CONE_LENGTH
    );
    tra._drawGeo.setShaderType(Enums.Shader.FLAT);
  }

  _createPlane(pla, color, wx, wy, wz, hx, hy, hz, scale) {
    vec3.copy(pla._color, color);

    // Planes need to be scaled
    pla._pickGeo = Primitives.createPlane(this._gl, 0, 0, 0, wx * scale, wy * scale, wz * scale, hx * scale, hy * scale, hz * scale);
    pla._pickGeo._gizmo = pla;

    pla._drawGeo = Primitives.createPlane(this._gl, 0, 0, 0, wx * scale, wy * scale, wz * scale, hx * scale, hy * scale, hz * scale);
    pla._drawGeo.setShaderType(Enums.Shader.FLAT);
  }

  _createCircle(rot, rad, color, radius, mthick, scale) {
    vec3.copy(rot._color, color);

    rot._pickGeo = Primitives.createTorus(
      this._gl,
      radius * scale,
      THICKNESS_PICK * mthick * scale,
      rad,
      6,
      64
    );
    rot._pickGeo._gizmo = rot;

    rot._drawGeo = Primitives.createTorus(this._gl, radius * scale, THICKNESS * mthick * scale, rad, 6, 64);
    rot._drawGeo.setShaderType(Enums.Shader.FLAT);
  }

  _createCube(sca, axis, color, scale) {
    sca._baseMatrix = mat4.create();
    const mat = sca._baseMatrix;
    mat4.rotate(mat, mat, Math.PI * 0.5, axis);
    mat4.translate(mat, mat, [0.0, ROT_RADIUS * scale, 0.0]);
    vec3.copy(sca._color, color);

    sca._pickGeo = Primitives.createCube(this._gl, CUBE_SIDE_PICK * scale);
    sca._pickGeo._gizmo = sca;

    sca._drawGeo = Primitives.createCube(this._gl, CUBE_SIDE * scale);
    sca._drawGeo.setShaderType(Enums.Shader.FLAT);
  }

  _initTranslate(scale) {
    const axis = [0.0, 0.0, 0.0];
    this._createArrow(this._transX, vec3.set(axis, 0.0, 0.0, -1.0), COLOR_X, scale);
    this._createArrow(this._transY, vec3.set(axis, 0.0, 1.0, 0.0), COLOR_Y, scale);
    this._createArrow(this._transZ, vec3.set(axis, 1.0, 0.0, 0.0), COLOR_Z, scale);

    const s = ARROW_LENGTH * 0.2;
    this._createPlane(this._planeX, COLOR_X, 0.0, s, 0.0, 0.0, 0.0, s, scale);
    this._createPlane(this._planeY, COLOR_Y, s, 0.0, 0.0, 0.0, 0.0, s, scale);
    this._createPlane(this._planeZ, COLOR_Z, s, 0.0, 0.0, 0.0, s, 0.0, scale);
  }

  _initRotate(scale) {
    this._createCircle(this._rotX, Math.PI, COLOR_X, ROT_RADIUS, 1.0, scale);
    this._createCircle(this._rotY, Math.PI, COLOR_Y, ROT_RADIUS, 1.0, scale);
    this._createCircle(this._rotZ, Math.PI, COLOR_Z, ROT_RADIUS, 1.0, scale);
    this._createCircle(this._rotW, Math.PI * 2, COLOR_GREY, ROT_RADIUS, 1.0, scale);
  }

  _initScale(scale) {
    const axis = [0.0, 0.0, 0.0];
    this._createCube(this._scaleX, vec3.set(axis, 0.0, 0.0, -1.0), COLOR_X, scale);
    this._createCube(this._scaleY, vec3.set(axis, 0.0, 1.0, 0.0), COLOR_Y, scale);
    this._createCube(this._scaleZ, vec3.set(axis, 1.0, 0.0, 0.0), COLOR_Z, scale);
    this._createCircle(this._scaleW, Math.PI * 2, COLOR_SW, SCALE_RADIUS, 2.0, scale);
  }
}

export default GizmoVR;
