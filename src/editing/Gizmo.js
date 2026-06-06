import { vec2, vec3, mat4, quat } from 'gl-matrix';
import Primitives from '../drawables/Primitives.js';
import Enums from '../misc/Enums.js';
import * as THREE from 'three';

// configs colors
var COLOR_X = vec3.fromValues(0.7, 0.2, 0.2);
var COLOR_Y = vec3.fromValues(0.2, 0.7, 0.2);
var COLOR_Z = vec3.fromValues(0.2, 0.2, 0.7);
var COLOR_GREY = vec3.fromValues(0.4, 0.4, 0.4);
var COLOR_SW = vec3.fromValues(0.8, 0.4, 0.2);

// overall scale of the gizmo
var GIZMO_SIZE = 160.0;
// arrow
var ARROW_LENGTH = 2.5;
var ARROW_CONE_THICK = 6.0;
var ARROW_CONE_LENGTH = 0.25;
// thickness of tori and arrows
var THICKNESS = 0.02;
var THICKNESS_PICK = THICKNESS * 5.0;
// radius of tori
var ROT_RADIUS = 1.5;
var SCALE_RADIUS = ROT_RADIUS * 1.3;
// size of cubes
var CUBE_SIDE = 0.35;
var CUBE_SIDE_PICK = CUBE_SIDE * 1.2;

var _TMP_QUAT = quat.create();

var createGizmo = function (type, nbAxis = -1) {
  return {
    _finalMatrix: mat4.create(),
    _baseMatrix: mat4.create(),
    _color: vec3.create(),
    _colorSelect: vec3.fromValues(1.0, 1.0, 0.0),
    _drawGeo: null,
    _pickGeo: null,
    _isSelected: false,
    _type: type,
    _nbAxis: nbAxis,
    _lastInter: [0.0, 0.0, 0.0],
    updateMatrix() {
      mat4.copy(this._drawGeo.getMatrix(), this._finalMatrix);
      mat4.copy(this._pickGeo.getMatrix(), this._finalMatrix);
      var tm = this._drawGeo.getThreeMesh();
      if (tm) {
        mat4.copy(tm.matrix.elements, this._finalMatrix);
        tm.matrixWorldNeedsUpdate = true;
      }
      var tmp = this._pickGeo.getThreeMesh();
      if (tmp) {
        mat4.copy(tmp.matrix.elements, this._finalMatrix);
        tmp.matrixWorldNeedsUpdate = true;
      }
    },
    updateFinalMatrix(mat) {
      mat4.mul(this._finalMatrix, mat, this._baseMatrix);
    }
  };
};

// edit masks
var TRANS_X = 1 << 0;
var TRANS_Y = 1 << 1;
var TRANS_Z = 1 << 2;
var ROT_X = 1 << 3;
var ROT_Y = 1 << 4;
var ROT_Z = 1 << 5;
var ROT_W = 1 << 6;
var PLANE_X = 1 << 7;
var PLANE_Y = 1 << 8;
var PLANE_Z = 1 << 9;
var SCALE_X = 1 << 10;
var SCALE_Y = 1 << 11;
var SCALE_Z = 1 << 12;
var SCALE_W = 1 << 13;

var TRANS_XYZ = TRANS_X | TRANS_Y | TRANS_Z;
var ROT_XYZ = ROT_X | ROT_Y | ROT_Z;
var PLANE_XYZ = PLANE_X | PLANE_Y | PLANE_Z;
var SCALE_XYZW = SCALE_X | SCALE_Y | SCALE_Z | SCALE_W;

class Gizmo {
  static get TRANS_X() {
    return TRANS_X;
  }
  static get TRANS_Y() {
    return TRANS_Y;
  }
  static get TRANS_Z() {
    return TRANS_Z;
  }
  static get ROT_X() {
    return ROT_X;
  }
  static get ROT_Y() {
    return ROT_Y;
  }
  static get ROT_Z() {
    return ROT_Z;
  }
  static get ROT_W() {
    return ROT_W;
  }
  static get PLANE_X() {
    return PLANE_X;
  }
  static get PLANE_Y() {
    return PLANE_Y;
  }
  static get PLANE_Z() {
    return PLANE_Z;
  }
  static get SCALE_X() {
    return SCALE_X;
  }
  static get SCALE_Y() {
    return SCALE_Y;
  }
  static get SCALE_Z() {
    return SCALE_Z;
  }
  static get SCALE_W() {
    return SCALE_W;
  }

  static get TRANS_XYZ() {
    return TRANS_XYZ;
  }
  static get ROT_XYZ() {
    return ROT_XYZ;
  }
  static get PLANE_XYZ() {
    return PLANE_XYZ;
  }
  static get SCALE_XYZW() {
    return SCALE_XYZW;
  }

  constructor(main) {
    this._main = main;
    this._gl = main._gl;

    this._group = new THREE.Group();
    this._group.name = "Transform Gizmo Group";
    this._group.visible = false; // Hide by default!

    // SculptGL extends Scene, so _worldGroup lives on main directly.
    // At constructor time, _worldGroup may not exist yet (created in Scene.initScene()).
    // Transform.postRender() has a lazy-add that inserts _group once _worldGroup is ready.
    let worldGroup = this._main._worldGroup || null;

    // --- DEBUG ---
    console.log('[Gizmo constructor]',
      'main._worldGroup:', worldGroup ? worldGroup.type : 'NULL',
      'main._scene:', main._scene ? main._scene.type : 'NULL'
    );
    // --- END DEBUG ---

    if (worldGroup) {
      worldGroup.add(this._group);
      console.log('[Gizmo constructor] added _group to worldGroup');
    } else {
      // Fallback: add directly to THREE.js root scene if worldGroup isn't ready yet.
      // The gizmo matrices are in sculpt space; the root scene is also sculpt space.
      if (main._scene) {
        main._scene.add(this._group);
        console.log('[Gizmo constructor] added _group to root _scene (worldGroup was null)');
      } else {
        console.warn('[Gizmo constructor] NEITHER worldGroup NOR _scene available — group is parentless!');
      }
    }
    // If worldGroup is null here, Transform.postRender() will add it on the first frame.

    // activated gizmos
    this._activatedType =
      Gizmo.TRANS_XYZ | Gizmo.ROT_XYZ | Gizmo.PLANE_XYZ | Gizmo.SCALE_XYZW | Gizmo.ROT_W;

    // trans arrow 1 dim
    this._transX = createGizmo(Gizmo.TRANS_X, 0);
    this._transY = createGizmo(Gizmo.TRANS_Y, 1);
    this._transZ = createGizmo(Gizmo.TRANS_Z, 2);

    // trans plane 2 dim
    this._planeX = createGizmo(Gizmo.PLANE_X, 0);
    this._planeY = createGizmo(Gizmo.PLANE_Y, 1);
    this._planeZ = createGizmo(Gizmo.PLANE_Z, 2);

    // scale cube 1 dim
    this._scaleX = createGizmo(Gizmo.SCALE_X, 0);
    this._scaleY = createGizmo(Gizmo.SCALE_Y, 1);
    this._scaleZ = createGizmo(Gizmo.SCALE_Z, 2);
    // scale cube 3 dim
    this._scaleW = createGizmo(Gizmo.SCALE_W);

    // rot arc 1 dim
    this._rotX = createGizmo(Gizmo.ROT_X, 0);
    this._rotY = createGizmo(Gizmo.ROT_Y, 1);
    this._rotZ = createGizmo(Gizmo.ROT_Z, 2);
    // full arc display
    this._rotW = createGizmo(Gizmo.ROT_W);

    // line helper
    this._lineHelper = Primitives.createLine2D(this._gl);
    this._lineHelper.setShaderType(Enums.Shader.FLAT);

    this._lastDistToEye = 0.0;
    this._isEditing = false;

    this._selected = null;
    this._pickables = [];

    // editing lines stuffs
    this._editLineOrigin = [0.0, 0.0, 0.0];
    this._editLineDirection = [0.0, 0.0, 0.0];
    this._editOffset = [0.0, 0.0, 0.0];

    // cached matrices when starting the editing operations
    this._editLocal = [];
    this._editTrans = mat4.create();
    this._editScaleRot = [];
    // same for inv
    this._editLocalInv = [];
    this._editTransInv = mat4.create();
    this._editScaleRotInv = [];

    // this._initTranslate();
    // this._initRotate();
    // this._initScale();
    // this._initPickables();

    this._currentScale = -1.0; // Force init
    this._resize(1.0);
    this._currentScale = 1.0;
    this._resize(1.0);
  }

  _resize(scale) {
    if (Math.abs(this._currentScale - scale) < scale * 0.1) return; // Verify diff > 10%
    this._currentScale = scale;

    if (this._group) this._group.clear();

    // Use unit scale for geometry, matrix handles scaling!
    this._initTranslate(1.0);
    this._initRotate(1.0);
    this._initScale(1.0);
    this._initPickables();
  }

  setActivatedType(type) {
    this._activatedType = type;
    this._initPickables();
  }

  _initPickables() {
    var pickables = this._pickables;
    pickables.length = 0;
    var type = this._activatedType;

    if (type & TRANS_X) pickables.push(this._transX._pickGeo);
    if (type & TRANS_Y) pickables.push(this._transY._pickGeo);
    if (type & TRANS_Z) pickables.push(this._transZ._pickGeo);

    if (type & PLANE_X) pickables.push(this._planeX._pickGeo);
    if (type & PLANE_Y) pickables.push(this._planeY._pickGeo);
    if (type & PLANE_Z) pickables.push(this._planeZ._pickGeo);

    if (type & ROT_X) pickables.push(this._rotX._pickGeo);
    if (type & ROT_Y) pickables.push(this._rotY._pickGeo);
    if (type & ROT_Z) pickables.push(this._rotZ._pickGeo);

    if (type & SCALE_X) pickables.push(this._scaleX._pickGeo);
    if (type & SCALE_Y) pickables.push(this._scaleY._pickGeo);
    if (type & SCALE_Z) pickables.push(this._scaleZ._pickGeo);
    if (type & SCALE_W) pickables.push(this._scaleW._pickGeo);
  }

  _createArrow(tra, axis, color, scale = 1.0) {
    tra._baseMatrix = mat4.create(); // RESET base matrix!
    var mat = tra._baseMatrix;
    mat4.rotate(mat, mat, Math.PI * 0.5, axis);
    mat4.translate(mat, mat, [0.0, ARROW_LENGTH * 0.5 * scale, 0.0]);
    vec3.copy(tra._color, color);

    tra._pickGeo = Primitives.createArrow(
      this._gl,
      THICKNESS_PICK * scale,
      ARROW_LENGTH * scale,
      ARROW_CONE_THICK * 0.4 // FIXED: Do not scale Ratio
    );
    tra._pickGeo._gizmo = tra;
    tra._drawGeo = Primitives.createArrow(
      this._gl,
      THICKNESS * scale,
      ARROW_LENGTH * scale,
      ARROW_CONE_THICK, // FIXED: Do not scale Ratio
      ARROW_CONE_LENGTH // FIXED: Do not scale Ratio
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

    const pickThreeMesh = tra._pickGeo.getThreeMesh();
    if (pickThreeMesh) {
      pickThreeMesh.visible = false;
      pickThreeMesh.matrixAutoUpdate = false;
      mat4.copy(pickThreeMesh.matrix.elements, tra._baseMatrix);
      if (this._group) this._group.add(pickThreeMesh);
    }
  }

  _createPlane(pla, color, wx, wy, wz, hx, hy, hz, scale = 1.0) {
    vec3.copy(pla._color, color);

    pla._pickGeo = Primitives.createPlane(this._gl, 0.0, 0.0, 0.0, wx * scale, wy * scale, wz * scale, hx * scale, hy * scale, hz * scale);
    pla._pickGeo._gizmo = pla;
    pla._drawGeo = Primitives.createPlane(this._gl, 0.0, 0.0, 0.0, wx * scale, wy * scale, wz * scale, hx * scale, hy * scale, hz * scale);
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

    const pickThreeMesh = pla._pickGeo.getThreeMesh();
    if (pickThreeMesh) {
      pickThreeMesh.visible = false;
      pickThreeMesh.matrixAutoUpdate = false;
      if (this._group) this._group.add(pickThreeMesh);
    }
  }

  _initTranslate(scale = 1.0) {
    var axis = [0.0, 0.0, 0.0];
    this._createArrow(this._transX, vec3.set(axis, 0.0, 0.0, -1.0), COLOR_X, scale);
    this._createArrow(this._transY, vec3.set(axis, 0.0, 1.0, 0.0), COLOR_Y, scale);
    this._createArrow(this._transZ, vec3.set(axis, 1.0, 0.0, 0.0), COLOR_Z, scale);

    var s = ARROW_LENGTH * 0.2;
    this._createPlane(this._planeX, COLOR_X, 0.0, s, 0.0, 0.0, 0.0, s, scale);
    this._createPlane(this._planeY, COLOR_Y, s, 0.0, 0.0, 0.0, 0.0, s, scale);
    this._createPlane(this._planeZ, COLOR_Z, s, 0.0, 0.0, 0.0, s, 0.0, scale);
  }

  _createCircle(rot, rad, color, radius = ROT_RADIUS, mthick = 1.0, scale = 1.0) {
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
      threeMesh.renderOrder = 100;
      if (this._group) this._group.add(threeMesh);
    }

    const pickThreeMesh = rot._pickGeo.getThreeMesh();
    if (pickThreeMesh) {
      pickThreeMesh.visible = false;
      pickThreeMesh.matrixAutoUpdate = false;
      if (this._group) this._group.add(pickThreeMesh);
    }
  }

  _initRotate(scale = 1.0) {
    this._createCircle(this._rotX, Math.PI, COLOR_X, ROT_RADIUS, 1.0, scale);
    this._createCircle(this._rotY, Math.PI, COLOR_Y, ROT_RADIUS, 1.0, scale);
    this._createCircle(this._rotZ, Math.PI, COLOR_Z, ROT_RADIUS, 1.0, scale);
    this._createCircle(this._rotW, Math.PI * 2, COLOR_GREY, ROT_RADIUS, 1.0, scale);
  }

  _createCube(sca, axis, color, scale = 1.0) {
    sca._baseMatrix = mat4.create(); // RESET base matrix!
    var mat = sca._baseMatrix;
    mat4.rotate(mat, mat, Math.PI * 0.5, axis);
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

    const pickThreeMesh = sca._pickGeo.getThreeMesh();
    if (pickThreeMesh) {
      pickThreeMesh.visible = false;
      pickThreeMesh.matrixAutoUpdate = false;
      mat4.copy(pickThreeMesh.matrix.elements, sca._baseMatrix);
      if (this._group) this._group.add(pickThreeMesh);
    }
  }

  _initScale(scale = 1.0) {
    var axis = [0.0, 0.0, 0.0];
    this._createCube(this._scaleX, vec3.set(axis, 0.0, 0.0, -1.0), COLOR_X, scale);
    this._createCube(this._scaleY, vec3.set(axis, 0.0, 1.0, 0.0), COLOR_Y, scale);
    this._createCube(this._scaleZ, vec3.set(axis, 1.0, 0.0, 0.0), COLOR_Z, scale);
    this._createCircle(this._scaleW, Math.PI * 2, COLOR_SW, SCALE_RADIUS, 2.0, scale);
  }

  _updateArcRotation(eye) {
    // xyz arc
    _TMP_QUAT[0] = eye[2];
    _TMP_QUAT[1] = 0.0;
    _TMP_QUAT[2] = -eye[0];
    _TMP_QUAT[3] = 1.0 + eye[1];
    quat.normalize(_TMP_QUAT, _TMP_QUAT);
    mat4.fromQuat(this._rotW._baseMatrix, _TMP_QUAT);
    mat4.fromQuat(this._scaleW._baseMatrix, _TMP_QUAT);

    // x arc
    quat.rotateZ(_TMP_QUAT, quat.identity(_TMP_QUAT), Math.PI * 0.5);
    quat.rotateY(_TMP_QUAT, _TMP_QUAT, Math.atan2(-eye[1], -eye[2]));
    mat4.fromQuat(this._rotX._baseMatrix, _TMP_QUAT);

    // y arc
    quat.rotateY(_TMP_QUAT, quat.identity(_TMP_QUAT), Math.atan2(-eye[0], -eye[2]));
    mat4.fromQuat(this._rotY._baseMatrix, _TMP_QUAT);

    // z arc
    quat.rotateX(_TMP_QUAT, quat.identity(_TMP_QUAT), Math.PI * 0.5);
    quat.rotateY(_TMP_QUAT, _TMP_QUAT, Math.atan2(-eye[0], eye[1]));
    mat4.fromQuat(this._rotZ._baseMatrix, _TMP_QUAT);
  }

  _computeCenterGizmo(center = [0.0, 0.0, 0.0]) {
    var meshes = this._main.getSelectedMeshes();
    if (meshes.length === 0 && this._main.getMesh()) {
      meshes = [this._main.getMesh()];
    }

    var acc = [0.0, 0.0, 0.0];
    var icenter = [0.0, 0.0, 0.0];
    for (var i = 0; i < meshes.length; ++i) {
      var mesh = meshes[i];
      vec3.transformMat4(icenter, mesh.getCenter(), mesh.getEditMatrix());
      vec3.transformMat4(icenter, icenter, mesh.getMatrix());
      vec3.add(acc, acc, icenter);
    }
    if (meshes.length > 0) vec3.scale(center, acc, 1.0 / meshes.length);
    
    if (window._animationRegistry && window._animationRegistry.isRecording && window.screenLog && Math.random() < 0.05) {
      window.screenLog(`Gizmo Center: [${center[0].toFixed(2)}, ${center[1].toFixed(2)}, ${center[2].toFixed(2)}]`, "yellow");
    }
    return center;
  }

  _updateMatrices(camera) {
    camera = camera || this._main.getCamera();
    var trMesh = this._computeCenterGizmo();
    var eye = camera.computePosition();

    this._lastDistToEye = this._isEditing ? this._lastDistToEye : vec3.dist(eye, trMesh);
    var scaleFactor = (this._lastDistToEye * GIZMO_SIZE) / camera.getConstantScreen();

    var traScale = mat4.create();
    mat4.translate(traScale, traScale, trMesh);
    mat4.scale(traScale, traScale, [scaleFactor, scaleFactor, scaleFactor]);

    // manage arc stuffs
    this._updateArcRotation(vec3.normalize(eye, vec3.sub(eye, trMesh, eye)));

    this._transX.updateFinalMatrix(traScale);
    this._transY.updateFinalMatrix(traScale);
    this._transZ.updateFinalMatrix(traScale);

    this._planeX.updateFinalMatrix(traScale);
    this._planeY.updateFinalMatrix(traScale);
    this._planeZ.updateFinalMatrix(traScale);

    this._rotX.updateFinalMatrix(traScale);
    this._rotY.updateFinalMatrix(traScale);
    this._rotZ.updateFinalMatrix(traScale);
    this._rotW.updateFinalMatrix(traScale);

    this._scaleX.updateFinalMatrix(traScale);
    this._scaleY.updateFinalMatrix(traScale);
    this._scaleZ.updateFinalMatrix(traScale);
    this._scaleW.updateFinalMatrix(traScale);
    this._scaleW.updateFinalMatrix(traScale);
  }

  _updatePickGeometryMatrices() {
    // Copy _finalMatrix (Component) to _pickGeo (Mesh) matrix
    // Because Picking.js uses mesh.getMatrix()
    var comps = [
      this._transX, this._transY, this._transZ,
      this._planeX, this._planeY, this._planeZ,
      this._rotX, this._rotY, this._rotZ, this._rotW,
      this._scaleX, this._scaleY, this._scaleZ, this._scaleW
    ];

    for (var i = 0; i < comps.length; ++i) {
      if (comps[i] && comps[i]._pickGeo) {
        // Assuming _pickGeo is a Mesh-like object with _transformData
        var dest = comps[i]._pickGeo.getMatrix();
        mat4.copy(dest, comps[i].getMatrix()); // getMatrix() returns _finalMatrix
      }
    }
  }

  updateMatricesVR(camera) {
    camera = camera || this._main.getCamera();
    var trMesh = this._computeCenterGizmo();

    // Constant physical size in VR
    // Default GIZMO_SIZE is approx 0.1? No, let's check constants.
    // If we want 20cm (0.2m)
    // And _vrScale is WorldUnits/Meter.
    // We want scale = 0.2 / _vrScale.

    var vrScale = this._main._vrScale || 50.0;

    // Scale the gizmo to a comfortable physical size using the same matrix-scale
    // approach as the desktop _updateMatrices() — no vertex geometry resize needed.
    // Previously _resize(scaleFactor) baked scale into vertices AND the matrix was
    // [1,1,1], so the scale was applied once.  Now we skip _resize and apply via
    // matrix only, keeping vertex geometry at unit scale.
    //
    // Target: proportional to mesh AABB but clamped to a comfortable arm-reach range.
    //   vrScale ≈ 50 sculpt units per metre.
    //   min 20 cm (10 su) → always clearly visible
    //   max 60 cm (30 su) → never overwhelming
    var scaleFactor = 0.30 * vrScale; // default 30 cm
    var meshes = this._main.getSelectedMeshes();
    if (meshes.length > 0) {
      var mesh0 = meshes[0];
      if (mesh0.getOctree) {
        var octree = mesh0.getOctree();
        if (octree && octree._aabbLoose) {
          var aabb = octree._aabbLoose;
          var meshRadius = Math.max(aabb[3] - aabb[0], aabb[4] - aabb[1], aabb[5] - aabb[2]) * 0.5;
          scaleFactor = meshRadius * 0.6; // 60 % of mesh half-extent
        }
      }
    }
    scaleFactor = Math.max(0.20 * vrScale, Math.min(0.60 * vrScale, scaleFactor));

    if (window.debugGizmoScale !== undefined && window.debugGizmoScale !== 0)
      scaleFactor = window.debugGizmoScale;
    if (scaleFactor < 0.0001) scaleFactor = 0.0001;

    var traScale = mat4.create();
    mat4.translate(traScale, traScale, trMesh);

    // Debug Function (Exposed to Console)
    if (!window.debugQueryGizmoScale) {
      window.debugQueryGizmoScale = () => {
        console.log("=== Gizmo Scale Debug ===");
        console.log("Gizmo Instance:", this);
        console.log("Current Scale Factor (Base):", scaleFactor);
        console.log("Vertex Scale Multiplier:", VERTEX_SCALE);
        console.log("Total Resize Scale:", scaleFactor * VERTEX_SCALE);

        if (this._transX && this._transX._drawGeo) {
          var m = this._transX._drawGeo.getMatrix();
          var s = new Float32Array(3);
          mat4.getScaling(s, m);
          console.log("Actual Mesh Scale (TransX):", s);
          console.log("Actual Mesh Matrix:", m);
        } else {
          console.warn("Gizmo TransX or DrawGeo not ready");
        }
        return "Check Console";
      };
    }

    // If Controller, we might want rotation too?
    if (window.debugGizmoAttach === 'controller' && this._main._vrControllerQuat) {
      var q = this._main._vrControllerQuat;
      var matRot = mat4.create();
      mat4.fromQuat(matRot, q);
      mat4.multiply(traScale, traScale, matRot);
    }

    // Apply scaleFactor via matrix (same approach as desktop _updateMatrices).
    // The previous code had [1.0, 1.0, 1.0] here which discarded all sizing work.
    mat4.scale(traScale, traScale, [scaleFactor, scaleFactor, scaleFactor]);

    var eye = camera.computePosition();
    this._updateArcRotation(vec3.normalize(eye, vec3.sub(eye, trMesh, eye)));

    this._transX.updateFinalMatrix(traScale);
    this._transX.updateMatrix();
    this._transY.updateFinalMatrix(traScale);
    this._transY.updateMatrix();
    this._transZ.updateFinalMatrix(traScale);
    this._transZ.updateMatrix();

    this._planeX.updateFinalMatrix(traScale);
    this._planeX.updateMatrix();
    this._planeY.updateFinalMatrix(traScale);
    this._planeY.updateMatrix();
    this._planeZ.updateFinalMatrix(traScale);
    this._planeZ.updateMatrix();

    this._rotX.updateFinalMatrix(traScale);
    this._rotX.updateMatrix();
    this._rotY.updateFinalMatrix(traScale);
    this._rotY.updateMatrix();
    this._rotZ.updateFinalMatrix(traScale);
    this._rotZ.updateMatrix();
    this._rotW.updateFinalMatrix(traScale);
    this._rotW.updateMatrix();

    this._scaleX.updateFinalMatrix(traScale);
    this._scaleX.updateMatrix();
    this._scaleY.updateFinalMatrix(traScale);
    this._scaleY.updateMatrix();
    this._scaleZ.updateFinalMatrix(traScale);
    this._scaleZ.updateMatrix();
    this._scaleW.updateFinalMatrix(traScale);
    this._scaleW.updateMatrix();
  }

  onVRHover(origin, direction) {
    if (this._isEditing) return -1;

    var pick = this._main.getPicking();
    pick.intersectionRayMeshes(this._pickables, origin, direction);

    if (this._selected) this._selected._isSelected = false;

    var mesh = pick.getMesh();
    if (!mesh) {
      this._selected = null;
      return -1;
    }

    this._selected = mesh._gizmo;
    this._selected._isSelected = true;
    vec3.copy(this._selected._lastInter, pick.getIntersectionPoint());

    return this._selected._type;
  }

  _drawGizmo(elt, camera) {
    elt.updateMatrix();
    var drawGeo = elt._drawGeo;
    var threeMesh = drawGeo.getThreeMesh();
    if (threeMesh) {
      threeMesh.visible = true;
      // Matrix is already updated in elt.updateMatrix() via createGizmo's updateMatrix!
      var color = elt._isSelected ? elt._colorSelect : elt._color;
      if (threeMesh.material) {
        threeMesh.material.color.setRGB(color[0], color[1], color[2]);
      }
    }
  }

  _updateLineHelper(x1, y1, x2, y2) {
    var vAr = this._lineHelper.getVertices();
    var main = this._main;
    var width = main.getCanvasWidth();
    var height = main.getCanvasHeight();
    vAr[0] = (x1 / width) * 2.0 - 1.0;
    vAr[1] = ((height - y1) / height) * 2.0 - 1.0;
    vAr[3] = (x2 / width) * 2.0 - 1.0;
    vAr[4] = ((height - y2) / height) * 2.0 - 1.0;
    this._lineHelper.updateVertexBuffer();
  }

  _saveEditMatrices() {
    var meshes = this._main.getSelectedMeshes();

    // translation part
    var center = this._computeCenterGizmo();
    mat4.translate(this._editTrans, mat4.identity(this._editTrans), center);
    mat4.invert(this._editTransInv, this._editTrans);

    for (var i = 0; i < meshes.length; ++i) {
      this._editLocal[i] = mat4.create();
      this._editScaleRot[i] = mat4.create();
      this._editLocalInv[i] = mat4.create();
      this._editScaleRotInv[i] = mat4.create();

      // mesh local matrix
      mat4.copy(this._editLocal[i], meshes[i].getMatrix());

      // rotation + scale part
      mat4.copy(this._editScaleRot[i], this._editLocal[i]);
      this._editScaleRot[i][12] = this._editScaleRot[i][13] = this._editScaleRot[i][14] = 0.0;

      // precomputes the invert
      mat4.invert(this._editLocalInv[i], this._editLocal[i]);
      mat4.invert(this._editScaleRotInv[i], this._editScaleRot[i]);
    }
  }

  _startRotateEdit() {
    var main = this._main;
    var camera = main.getCamera();

    // 3d origin (center of gizmo)
    var projCenter = [0.0, 0.0, 0.0];
    this._computeCenterGizmo(projCenter);
    vec3.copy(projCenter, camera.project(projCenter));

    // compute tangent direction and project it on screen
    var dir = this._editLineDirection;
    var sign = this._selected._nbAxis === 0 ? -1.0 : 1.0;
    var lastInter = this._selected._lastInter;
    vec3.set(dir, -sign * lastInter[2], -sign * lastInter[1], sign * lastInter[0]);
    vec3.transformMat4(dir, dir, this._selected._finalMatrix);
    vec3.copy(dir, camera.project(dir));

    vec2.normalize(dir, vec2.sub(dir, dir, projCenter));

    vec2.set(this._editLineOrigin, main._mouseX, main._mouseY);
  }

  _startTranslateEdit() {
    var main = this._main;
    var camera = main.getCamera();

    var origin = this._editLineOrigin;
    var dir = this._editLineDirection;

    // 3d origin (center of gizmo)
    this._computeCenterGizmo(origin);

    // 3d direction
    var nbAxis = this._selected._nbAxis;
    if (nbAxis !== -1)
      // if -1, we don't care about dir vector
      vec3.set(dir, 0.0, 0.0, 0.0)[nbAxis] = 1.0;
    vec3.add(dir, origin, dir);

    // project on screen and get a 2D line
    vec3.copy(origin, camera.project(origin));
    vec3.copy(dir, camera.project(dir));

    vec2.normalize(dir, vec2.sub(dir, dir, origin));

    var offset = this._editOffset;
    offset[0] = main._mouseX - origin[0];
    offset[1] = main._mouseY - origin[1];
  }

  _startPlaneEdit() {
    var main = this._main;
    var camera = main.getCamera();

    var origin = this._editLineOrigin;

    // 3d origin (center of gizmo)
    this._computeCenterGizmo(origin);

    vec3.copy(origin, camera.project(origin));

    var offset = this._editOffset;
    offset[0] = main._mouseX - origin[0];
    offset[1] = main._mouseY - origin[1];
    vec2.set(this._editLineOrigin, main._mouseX, main._mouseY);
  }

  _startScaleEdit() {
    this._startTranslateEdit();
  }

  _updateRotateEdit() {
    var main = this._main;

    var origin = this._editLineOrigin;
    var dir = this._editLineDirection;

    var vec = [main._mouseX, main._mouseY, 0.0];
    vec2.sub(vec, vec, origin);
    var dist = vec2.dot(vec, dir);

    // helper line
    this._updateLineHelper(
      origin[0],
      origin[1],
      origin[0] + dir[0] * dist,
      origin[1] + dir[1] * dist
    );

    var angle = (7 * dist) / Math.min(main.getCanvasWidth(), main.getCanvasHeight());
    angle %= Math.PI * 2;
    var nbAxis = this._selected._nbAxis;

    var meshes = this._main.getSelectedMeshes();
    for (var i = 0; i < meshes.length; ++i) {
      var mrot = meshes[i].getEditMatrix();
      mat4.identity(mrot);
      if (nbAxis === 0) mat4.rotateX(mrot, mrot, -angle);
      else if (nbAxis === 1) mat4.rotateY(mrot, mrot, -angle);
      else if (nbAxis === 2) mat4.rotateZ(mrot, mrot, -angle);

      this._scaleRotateEditMatrix(mrot, i);
    }

    main.render();
  }

  _updateTranslateEdit() {
    var main = this._main;
    var camera = main.getCamera();

    var origin = this._editLineOrigin;
    var dir = this._editLineDirection;

    var vec = [main._mouseX, main._mouseY, 0.0];
    vec2.sub(vec, vec, origin);
    vec2.sub(vec, vec, this._editOffset);
    vec2.scaleAndAdd(vec, origin, dir, vec2.dot(vec, dir));

    // helper line
    this._updateLineHelper(origin[0], origin[1], vec[0], vec[1]);

    var near = camera.unproject(vec[0], vec[1], 0.0);
    var far = camera.unproject(vec[0], vec[1], 0.1);

    vec3.transformMat4(near, near, this._editTransInv);
    vec3.transformMat4(far, far, this._editTransInv);

    // intersection line line
    vec3.normalize(vec, vec3.sub(vec, far, near));

    var inter = [0.0, 0.0, 0.0];
    inter[this._selected._nbAxis] = 1.0;

    var a01 = -vec3.dot(vec, inter);
    var b0 = vec3.dot(near, vec);
    var det = Math.abs(1.0 - a01 * a01);

    var b1 = -vec3.dot(near, inter);
    inter[this._selected._nbAxis] = (a01 * b0 - b1) / det;

    this._updateMatrixTranslate(inter);

    main.render();
  }

  _updatePlaneEdit() {
    var main = this._main;
    var camera = main.getCamera();

    var vec = [main._mouseX, main._mouseY, 0.0];
    vec2.sub(vec, vec, this._editOffset);

    // helper line
    this._updateLineHelper(
      this._editLineOrigin[0],
      this._editLineOrigin[1],
      main._mouseX,
      main._mouseY
    );

    var near = camera.unproject(vec[0], vec[1], 0.0);
    var far = camera.unproject(vec[0], vec[1], 0.1);

    vec3.transformMat4(near, near, this._editTransInv);
    vec3.transformMat4(far, far, this._editTransInv);

    // intersection line plane
    var inter = [0.0, 0.0, 0.0];
    inter[this._selected._nbAxis] = 1.0;

    var dist1 = vec3.dot(near, inter);
    var dist2 = vec3.dot(far, inter);
    // ray copplanar to triangle
    if (dist1 === dist2) return false;

    // intersection between ray and triangle
    var val = -dist1 / (dist2 - dist1);
    inter[0] = near[0] + (far[0] - near[0]) * val;
    inter[1] = near[1] + (far[1] - near[1]) * val;
    inter[2] = near[2] + (far[2] - near[2]) * val;

    this._updateMatrixTranslate(inter);

    main.render();
  }

  _updateMatrixTranslate(inter) {
    var tmp = [0, 0, 0];

    var meshes = this._main.getSelectedMeshes();
    for (var i = 0; i < meshes.length; ++i) {
      vec3.transformMat4(tmp, inter, this._editScaleRotInv[i]);
      
      // Account for parent scale (_worldGroup)
      let S = 1.0;
      if (this._main._worldGroup) S = this._main._worldGroup.scale.x;
      vec3.scale(tmp, tmp, 1.0 / S);

      var edim = meshes[i].getEditMatrix();
      mat4.identity(edim);
      mat4.translate(edim, edim, tmp);
    }
  }

  _updateScaleEdit() {
    var main = this._main;
    var mesh = main.getMesh();

    var origin = this._editLineOrigin;
    var dir = this._editLineDirection;
    var nbAxis = this._selected._nbAxis;

    var vec = [main._mouseX, main._mouseY, 0.0];
    if (nbAxis !== -1) {
      vec2.sub(vec, vec, origin);
      vec2.scaleAndAdd(vec, origin, dir, vec2.dot(vec, dir));
    }

    // helper line
    this._updateLineHelper(origin[0], origin[1], vec[0], vec[1]);

    var distOffset = vec3.len(this._editOffset);
    var inter = [1.0, 1.0, 1.0];
    var scaleMult = Math.max(-0.99, (vec2.dist(origin, vec) - distOffset) / distOffset);
    if (nbAxis === -1) {
      inter[0] += scaleMult;
      inter[1] += scaleMult;
      inter[2] += scaleMult;
    } else {
      inter[nbAxis] += scaleMult;
    }

    var meshes = this._main.getSelectedMeshes();
    for (var i = 0; i < meshes.length; ++i) {
      var edim = meshes[i].getEditMatrix();
      mat4.identity(edim);
      mat4.scale(edim, edim, inter);

      this._scaleRotateEditMatrix(edim, i);
    }

    main.render();
  }

  _scaleRotateEditMatrix(edit, i) {
    mat4.mul(edit, this._editTrans, edit);
    mat4.mul(edit, edit, this._editTransInv);

    mat4.mul(edit, this._editLocalInv[i], edit);
    mat4.mul(edit, edit, this._editLocal[i]);
  }

  addGizmoToScene(scene) {
    scene.push(this._transX._drawGeo);
    scene.push(this._transY._drawGeo);
    scene.push(this._transZ._drawGeo);

    scene.push(this._planeX._drawGeo);
    scene.push(this._planeY._drawGeo);
    scene.push(this._planeZ._drawGeo);

    scene.push(this._rotX._drawGeo);
    scene.push(this._rotY._drawGeo);
    scene.push(this._rotZ._drawGeo);
    scene.push(this._rotW._drawGeo);

    scene.push(this._scaleX._drawGeo);
    scene.push(this._scaleY._drawGeo);
    scene.push(this._scaleZ._drawGeo);
    scene.push(this._scaleW._drawGeo);

    return scene;
  }

  render(camera) {
    this._updateMatrices(camera);

    // Hide all first, Three.js handles rendering via scene graph
    if (this._group) {
      this._group.visible = true;
      this._group.children.forEach(child => child.visible = false);
    }

    var type = this._isEditing && this._selected ? this._selected._type : this._activatedType;

    if (type & ROT_W) this._drawGizmo(this._rotW, camera);

    if (type & TRANS_X) this._drawGizmo(this._transX, camera);
    if (type & TRANS_Y) this._drawGizmo(this._transY, camera);
    if (type & TRANS_Z) this._drawGizmo(this._transZ, camera);

    if (type & PLANE_X) this._drawGizmo(this._planeX, camera);
    if (type & PLANE_Y) this._drawGizmo(this._planeY, camera);
    if (type & PLANE_Z) this._drawGizmo(this._planeZ, camera);

    if (type & ROT_X) this._drawGizmo(this._rotX, camera);
    if (type & ROT_Y) this._drawGizmo(this._rotY, camera);
    if (type & ROT_Z) this._drawGizmo(this._rotZ, camera);

    if (type & SCALE_X) this._drawGizmo(this._scaleX, camera);
    if (type & SCALE_Y) this._drawGizmo(this._scaleY, camera);
    if (type & SCALE_Z) this._drawGizmo(this._scaleZ, camera);
    if (type & SCALE_W) this._drawGizmo(this._scaleW, camera);

    // if (this._isEditing) this._lineHelper.render(this._main);
  }

  renderVR(camera) {
    // Skip _updateMatrices because updateMatricesVR is called in updateXR

    var type = this._isEditing && this._selected ? this._selected._type : this._activatedType;

    if (type & ROT_W) this._drawGizmo(this._rotW, camera);

    if (type & TRANS_X) this._drawGizmo(this._transX, camera);
    if (type & TRANS_Y) this._drawGizmo(this._transY, camera);
    if (type & TRANS_Z) this._drawGizmo(this._transZ, camera);

    if (type & PLANE_X) this._drawGizmo(this._planeX, camera);
    if (type & PLANE_Y) this._drawGizmo(this._planeY, camera);
    if (type & PLANE_Z) this._drawGizmo(this._planeZ, camera);

    if (type & ROT_X) this._drawGizmo(this._rotX, camera);
    if (type & ROT_Y) this._drawGizmo(this._rotY, camera);
    if (type & ROT_Z) this._drawGizmo(this._rotZ, camera);

    if (type & SCALE_X) this._drawGizmo(this._scaleX, camera);
    if (type & SCALE_Y) this._drawGizmo(this._scaleY, camera);
    if (type & SCALE_Z) this._drawGizmo(this._scaleZ, camera);
    if (type & SCALE_W) this._drawGizmo(this._scaleW, camera);

    // if (this._isEditing) this._lineHelper.render(this._main);
  }

  onMouseOver() {
    if (this._isEditing) {
      var type = this._selected._type;
      if (type & ROT_XYZ) this._updateRotateEdit();
      else if (type & TRANS_XYZ) this._updateTranslateEdit();
      else if (type & PLANE_XYZ) this._updatePlaneEdit();
      else if (type & SCALE_XYZW) this._updateScaleEdit();

      return true;
    }

    var main = this._main;
    var picking = main.getPicking();
    var mx = main._mouseX;
    var my = main._mouseY;
    var pickables = this._pickables;
    picking.intersectionMouseMeshes(pickables, mx, my);

    if (this._selected) this._selected._isSelected = false;
    var geo = picking.getMesh();
    if (!geo) {
      this._selected = null;
      return false;
    }

    this._selected = geo._gizmo;
    this._selected._isSelected = true;
    vec3.copy(this._selected._lastInter, picking.getIntersectionPoint());
    return true;
  }

  onMouseDown() {
    var sel = this._selected;
    if (!sel) return false;

    this._isEditing = true;
    var type = sel._type;
    this._saveEditMatrices();

    if (type & ROT_XYZ) this._startRotateEdit();
    else if (type & TRANS_XYZ) this._startTranslateEdit();
    else if (type & PLANE_XYZ) this._startPlaneEdit();
    else if (type & SCALE_XYZW) this._startScaleEdit();

    return true;
  }

  onMouseUp() {
    this._isEditing = false;
  }
}

export default Gizmo;
