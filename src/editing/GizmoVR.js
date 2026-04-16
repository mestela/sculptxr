import { vec3, mat4, quat } from 'gl-matrix';
import Primitives from '../drawables/Primitives.js';
import Enums from '../misc/Enums.js';
import * as THREE from 'three';
import getOptionsURL from '../misc/getOptionsURL.js';


// Configuration constants
const COLOR_X = vec3.fromValues(1.0, 0.2, 0.2);
const COLOR_Y = vec3.fromValues(0.2, 1.0, 0.2);
const COLOR_Z = vec3.fromValues(0.2, 0.2, 1.0);
const COLOR_GREY = vec3.fromValues(0.5, 0.5, 0.5);
const COLOR_SW = vec3.fromValues(1.0, 0.5, 0.2);
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
      if (this._drawGeo) {
        mat4.copy(this._drawGeo.getMatrix(), this._finalMatrix);
        const tm = this._drawGeo.getThreeMesh();
        if (tm) {
          tm.matrix.fromArray(this._finalMatrix);
          tm.matrixWorldNeedsUpdate = true;
        }
      }
      if (this._pickGeo) {
        mat4.copy(this._pickGeo.getMatrix(), this._finalMatrix);
        const tm = this._pickGeo.getThreeMesh();
        if (tm) {
          tm.matrix.fromArray(this._finalMatrix);
          tm.matrixWorldNeedsUpdate = true;
        }
      }
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

    this._group = new THREE.Group();
    this._group.name = "Transform Gizmo Group";
    this._group.visible = false; // Hide by default

    let worldGroup = null;
    if (this._main._worldGroup) {
      worldGroup = this._main._worldGroup;
    } else if (this._main._scene && this._main._scene._worldGroup) {
      worldGroup = this._main._scene._worldGroup;
    } else if (this._main.getScene && this._main.getScene()._worldGroup) {
      worldGroup = this._main.getScene()._worldGroup;
    }

    if (worldGroup) {
      worldGroup.add(this._group);
    } else if (this._main._scene && this._main._scene._scene) {
      this._main._scene._scene.add(this._group);
    } else {
      console.error("GizmoVR: Could not find scene to add to!");
      if (this._main._scene && this._main._scene.add) {
         this._main._scene.add(this._group);
      }
    }

    // Attach debug tools to window
    window.debugGizmo = {
      show: () => { if (this._group) this._group.visible = true; },
      hide: () => { if (this._group) this._group.visible = false; },
      log: () => {
         console.log("Gizmo Group:", this._group);
         console.log("Gizmo Group Position:", this._group ? this._group.position : "N/A");
         console.log("Gizmo Group Scale:", this._group ? this._group.scale : "N/A");
         console.log("Gizmo Group Visible:", this._group ? this._group.visible : "N/A");
         console.log("vrScale:", (this._main._scene && this._main._scene._vrScale) || 1.0);
         const mesh = this._main.getMesh();
         console.log("Current Mesh:", mesh);
         if (mesh) {
            console.log("Mesh Center:", mesh.getCenter());
            const tm = mesh.getThreeMesh();
            if (tm) {
               console.log("Mesh Three Position:", tm.position);
               console.log("Mesh Three Scale:", tm.scale);
               console.log("Mesh Three MatrixWorld:", tm.matrixWorld);
            }
         }
      },
      testScale: (scale) => {
         this._resize(scale);
      }
    };

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
    this._lastScale = 1.0;
    this._resize(1.0);

    // Debug Hook
    window.debugGizmoVR = () => {
      console.log("=== GizmoVR Debug ===");
      console.log("Gizmo Instance:", this);
      console.log("Enabled Config:", this._activatedType);

      const components = [
        this._transX, this._transY, this._transZ,
        this._planeX, this._planeY, this._planeZ,
        this._rotX, this._rotY, this._rotZ, 
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
    if (this._group) this._group.clear();
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
    let meshes = this._main.getSelectedMeshes();
    if (meshes.length === 0 && this._main.getMesh()) {
      meshes = [this._main.getMesh()];
    }
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

    const baseSize = 0.25; // 25cm target size
    
    let worldScale = 1.0;
    const sceneApp = this._main.getScene ? this._main.getScene() : this._main._scene;
    if (sceneApp && sceneApp._worldGroup) {
      worldScale = sceneApp._worldGroup.scale.x;
    } else if (this._main._worldGroup) {
      worldScale = this._main._worldGroup.scale.x; // fallback for Scene
    }

    let scaleFactor = getOptionsURL().gizmoScale || 15.625; // Constant base size in sculpt space
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
    // Let's stick to baking for now to ensure visual consistency with what we had.
    if (Math.abs(scaleFactor - this._lastScale) > 0.0001) {
      this._resize(scaleFactor);
      this._lastScale = scaleFactor;
    }

    // 3. Build Final Components Matrix
    const baseMat = mat4.create();
    mat4.translate(baseMat, baseMat, center);

    // Sync Rotation with Mesh
    if (meshes.length > 0) {
      const m = meshes[0].getMatrix();
      const sx = Math.hypot(m[0], m[1], m[2]);
      const sy = Math.hypot(m[4], m[5], m[6]);
      const sz = Math.hypot(m[8], m[9], m[10]);

      const unscaledMat = mat4.clone(m);
      if (sx > 0.0001) { unscaledMat[0] /= sx; unscaledMat[1] /= sx; unscaledMat[2] /= sx; }
      if (sy > 0.0001) { unscaledMat[4] /= sy; unscaledMat[5] /= sy; unscaledMat[6] /= sy; }
      if (sz > 0.0001) { unscaledMat[8] /= sz; unscaledMat[9] /= sz; unscaledMat[10] /= sz; }

      const qRot = quat.create();
      mat4.getRotation(qRot, unscaledMat);
      
      const mRot = mat4.create();
      mat4.fromQuat(mRot, qRot);
      mat4.multiply(baseMat, baseMat, mRot);
    }

    // Update all components
    const components = [
      this._transX, this._transY, this._transZ,
      this._planeX, this._planeY, this._planeZ,
      this._rotX, this._rotY, this._rotZ, 
      this._scaleX, this._scaleY, this._scaleZ, this._scaleW
    ];

    for (let i = 0; i < components.length; ++i) {
      components[i].updateFinalMatrix(baseMat);
      
      const threeMesh = components[i]._drawGeo.getThreeMesh();
      if (threeMesh) {
        mat4.copy(threeMesh.matrix.elements, components[i]._finalMatrix);
      }
      
      if (components[i]._pickGeo) {
        mat4.copy(components[i]._pickGeo.getMatrix(), components[i]._finalMatrix);
      }
      
      const elt = components[i];
      if (elt._drawGeo) {
        const tm = elt._drawGeo.getThreeMesh();
        if (tm && tm.material) {
          const color = elt._isSelected ? COLOR_SELECT : elt._color;
          tm.material.color.setRGB(color[0], color[1], color[2]);
        }
      }
    }
  }

  intersect(origin, direction) {
    let worldScale = 1.0;
    const sceneApp = this._main.getScene ? this._main.getScene() : this._main._scene;
    if (sceneApp && sceneApp._worldGroup) {
      worldScale = sceneApp._worldGroup.scale.x;
    } else if (this._main._worldGroup) {
      worldScale = this._main._worldGroup.scale.x;
    }
    return this.intersectPhysical(origin, direction, (0.05 / worldScale), false);
  }

  intersectPhysical(origin, direction, radius, isPhysical = true) {
    const main = this._main;
    const pick = main.getPicking();

    // 1. Transform Gizmo Components to Intersection Space
    const components = [
      this._transX, this._transY, this._transZ,
      this._planeX, this._planeY, this._planeZ,
      this._rotX, this._rotY, this._rotZ, 
      this._scaleX, this._scaleY, this._scaleZ, this._scaleW
    ];

    const backups = new Array(components.length);
    if (isPhysical) {
      const engToPhys = mat4.create();
      main.computeEngineToPhysicalMatrix(engToPhys);

      for (let i = 0; i < components.length; ++i) {
        const elt = components[i];
        if (!elt._pickGeo) continue;
        const mesh = elt._pickGeo;
        backups[i] = mat4.clone(mesh.getMatrix());
        const physMat = mat4.create();
        mat4.mul(physMat, engToPhys, backups[i]);
        mat4.copy(mesh.getMatrix(), physMat);
      }
    }

    // 2. Perform Intersection
    // Backup state to prevent destructive clearing if we miss the gizmo
    const oldMesh = pick.getMesh();
    const oldFace = pick.getPickedFace();
    const oldPoint = vec3.clone(pick.getIntersectionPoint());
    const oldR2 = pick._rWorld2;
    const oldRL2 = pick._rLocal2;

    pick.intersectionRayMeshesVR(this._pickables, origin, direction, radius);

    const hitMesh = pick.getMesh();
    if (!hitMesh && oldMesh) {
      // Restore if we missed the gizmo but had a world hit
      pick._mesh = oldMesh;
      pick._pickedFace = oldFace;
      vec3.copy(pick._interPoint, oldPoint);
      pick._rWorld2 = oldR2;
      pick._rLocal2 = oldRL2;
    }

    // 3. Restore Matrices
    if (isPhysical) {
      for (let i = 0; i < components.length; ++i) {
        if (backups[i]) mat4.copy(components[i]._pickGeo.getMatrix(), backups[i]);
      }
    }

    if (this._selected) this._selected._isSelected = false;

    const mesh = pick.getMesh();

    // Visual Debugging
    if (window.debugGizmoIntersection) {
      if (!this._logThrottle) this._logThrottle = 0;
      const shouldLog = (this._logThrottle++ % 60 === 0);

      const pt = pick.getIntersectionPoint(); // Local Space of pickable
      const worldPt = vec3.create();

      if (mesh) {
        if (mesh._gizmo) {
          vec3.copy(mesh._gizmo._lastInter, pt);
        }
        vec3.transformMat4(worldPt, pt, mesh.getMatrix());
        if (shouldLog) console.log("Hit:", mesh._gizmo._type, "at", worldPt);
        main.updateDebugPivot(worldPt, true);
      } else {
        if (shouldLog) console.log("No Hit");
      }
    }

    if (!mesh || !mesh._gizmo) {
      this._selected = null;
      return -1;
    }

    this._selected = mesh._gizmo;
    this._selected._isSelected = true;
    vec3.copy(this._selected._lastInter, pick.getIntersectionPoint());

    return this._selected._type;
  }

  render(camera) {
    // Three.js handles rendering via the scene graph.
  }

  // --- Geometry Creation Helpers ---

  _createArrow(tra, axis, color, scale) {
    tra._baseMatrix = mat4.create();
    const mat = tra._baseMatrix;
    const up = vec3.fromValues(0.0, 1.0, 0.0);
    const q = quat.create();
    quat.rotationTo(q, up, axis);
    mat4.fromQuat(mat, q);
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

    const threeMesh = tra._drawGeo.getThreeMesh();
    if (threeMesh) {
      threeMesh.material = new THREE.MeshBasicMaterial({
        color: new THREE.Color(color[0], color[1], color[2]),
        transparent: true,
        opacity: 0.8,
        depthTest: false,
        depthWrite: false
      });
      threeMesh.matrixAutoUpdate = false;
      mat4.copy(threeMesh.matrix.elements, tra._baseMatrix);
      threeMesh.renderOrder = 100;
      if (this._group) this._group.add(threeMesh);
    }
  }

  _createPlane(pla, color, wx, wy, wz, hx, hy, hz, scale) {
    vec3.copy(pla._color, color);

    // Planes need to be scaled
    pla._pickGeo = Primitives.createPlane(this._gl, 0, 0, 0, wx * scale, wy * scale, wz * scale, hx * scale, hy * scale, hz * scale);
    pla._pickGeo._gizmo = pla;

    pla._drawGeo = Primitives.createPlane(this._gl, 0, 0, 0, wx * scale, wy * scale, wz * scale, hx * scale, hy * scale, hz * scale);
    pla._drawGeo.setShaderType(Enums.Shader.FLAT);

    const threeMesh = pla._drawGeo.getThreeMesh();
    if (threeMesh) {
      threeMesh.material = new THREE.MeshBasicMaterial({
        color: new THREE.Color(color[0], color[1], color[2]),
        transparent: true,
        opacity: 0.8,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide
      });
      threeMesh.matrixAutoUpdate = false;
      threeMesh.renderOrder = 100;
      if (this._group) this._group.add(threeMesh);
    }
  }

  _createCircle(rot, rad, axis, color, radius, mthick, scale) {
    if (!rot._baseMatrix) rot._baseMatrix = mat4.create();
    const mat = rot._baseMatrix;
    mat4.identity(mat);

    // Primitives.createTorus makes a torus lying on XZ plane (Normal = Y)
    // We need to rotate it to align with the desired 'axis'
    // axis is the Normal of the ring

    // Default Y-axis (0,1,0) -> No rotation
    if (axis[0] !== 0.0 || axis[1] !== 1.0 || axis[2] !== 0.0) {
      // Rotate from Y to target axis
      const up = vec3.fromValues(0.0, 1.0, 0.0);
      const q = quat.create();
      quat.rotationTo(q, up, axis);
      mat4.fromQuat(mat, q);
    }

    // Debug Log
    // if (window.debugGizmoVR) {
    //   console.log(`CreateCircle Axis: [${axis}], Matrix: [${mat}]`);
    // }

    vec3.copy(rot._color, color);

    rot._pickGeo = Primitives.createTorus(
      this._gl,
      radius * scale,
      THICKNESS * mthick * scale, // Revert to standard thickness (Tube Cast handles tolerance)
      rad,
      6,
      64
    );
    rot._pickGeo._gizmo = rot;

    rot._drawGeo = Primitives.createTorus(this._gl, radius * scale, THICKNESS * mthick * scale, rad, 6, 64);
    rot._drawGeo.setShaderType(Enums.Shader.FLAT);

    const threeMesh = rot._drawGeo.getThreeMesh();
    if (threeMesh) {
      threeMesh.material = new THREE.MeshBasicMaterial({
        color: new THREE.Color(color[0], color[1], color[2]),
        transparent: true,
        opacity: 0.8,
        depthTest: false,
        depthWrite: false
      });
      threeMesh.matrixAutoUpdate = false;
      mat4.copy(threeMesh.matrix.elements, rot._baseMatrix);
      threeMesh.renderOrder = 100;
      if (this._group) this._group.add(threeMesh);
    }
  }

  _createCube(sca, axis, color, scale) {
    sca._baseMatrix = mat4.create();
    const mat = sca._baseMatrix;
    const up = vec3.fromValues(0.0, 1.0, 0.0);
    const q = quat.create();
    quat.rotationTo(q, up, axis);
    mat4.fromQuat(mat, q);
    mat4.translate(mat, mat, [0.0, ROT_RADIUS * scale, 0.0]);
    vec3.copy(sca._color, color);

    sca._pickGeo = Primitives.createCube(this._gl, CUBE_SIDE_PICK * scale);
    sca._pickGeo._gizmo = sca;

    sca._drawGeo = Primitives.createCube(this._gl, CUBE_SIDE * scale);
    sca._drawGeo.setShaderType(Enums.Shader.FLAT);

    const threeMesh = sca._drawGeo.getThreeMesh();
    if (threeMesh) {
      threeMesh.material = new THREE.MeshBasicMaterial({
        color: new THREE.Color(color[0], color[1], color[2]),
        transparent: true,
        opacity: 0.8,
        depthTest: false,
        depthWrite: false
      });
      threeMesh.matrixAutoUpdate = false;
      mat4.copy(threeMesh.matrix.elements, sca._baseMatrix);
      threeMesh.renderOrder = 100;
      if (this._group) this._group.add(threeMesh);
    }
  }

  _initTranslate(scale) {
    const axis = [0.0, 0.0, 0.0];
    this._createArrow(this._transX, vec3.set(axis, 1.0, 0.0, 0.0), COLOR_X, scale);
    this._createArrow(this._transY, vec3.set(axis, 0.0, 1.0, 0.0), COLOR_Y, scale);
    this._createArrow(this._transZ, vec3.set(axis, 0.0, 0.0, 1.0), COLOR_Z, scale);

    const s = ARROW_LENGTH * 0.2;
    this._createPlane(this._planeX, COLOR_X, 0.0, s, 0.0, 0.0, 0.0, s, scale);
    this._createPlane(this._planeY, COLOR_Y, s, 0.0, 0.0, 0.0, 0.0, s, scale);
    this._createPlane(this._planeZ, COLOR_Z, s, 0.0, 0.0, 0.0, s, 0.0, scale);
  }

  _initRotate(scale) {
    const axis = vec3.create();
    this._createCircle(this._rotX, Math.PI, vec3.set(axis, 1.0, 0.0, 0.0), COLOR_X, ROT_RADIUS, 1.0, scale);
    this._createCircle(this._rotY, Math.PI, vec3.set(axis, 0.0, 1.0, 0.0), COLOR_Y, ROT_RADIUS, 1.0, scale);
    this._createCircle(this._rotZ, Math.PI, vec3.set(axis, 0.0, 0.0, 1.0), COLOR_Z, ROT_RADIUS, 1.0, scale);
    // this._createCircle( Math.PI * 2, vec3.set(axis, 0.0, 1.0, 0.0), COLOR_GREY, ROT_RADIUS, 1.0, scale);
  }

  _initScale(scale) {
    const axis = vec3.create();
    this._createCube(this._scaleX, vec3.set(axis, 1.0, 0.0, 0.0), COLOR_X, scale);
    this._createCube(this._scaleY, vec3.set(axis, 0.0, 1.0, 0.0), COLOR_Y, scale);
    this._createCube(this._scaleZ, vec3.set(axis, 0.0, 0.0, 1.0), COLOR_Z, scale);
    this._createCircle(this._scaleW, Math.PI * 2, vec3.set(axis, 0.0, 1.0, 0.0), COLOR_SW, SCALE_RADIUS, 2.0, scale);
  }
}

export default GizmoVR;
