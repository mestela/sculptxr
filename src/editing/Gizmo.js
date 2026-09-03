import { vec2, vec3, mat4, quat } from 'gl-matrix';
import Primitives from '../drawables/Primitives.js';
import Enums from '../misc/Enums.js';
import * as THREE from 'three';
import Skeleton from './Skeleton.js';

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
var _TMP_LIVE = mat4.create();
// Scratch for the mesh model-space matrix (parentChain * _matrix). The gizmo math
// works in model/world space, so parented meshes must use this rather than the raw
// local _matrix (getMatrix) — otherwise the gizmo anchors in parent-local space.
var _TMP_MAT = mat4.create();

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
var TRANS_W = 1 << 14; // center handle → free translate in the camera plane

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
  static get TRANS_W() {
    return TRANS_W;
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

    if (worldGroup) {
      worldGroup.add(this._group);
    } else {
      // Fallback: add directly to THREE.js root scene if worldGroup isn't ready yet.
      // The gizmo matrices are in sculpt space; the root scene is also sculpt space.
      if (main._scene) {
        main._scene.add(this._group);
      }
      // If neither is available, Transform.postRender() will lazy-add on first frame.
    }
    // If worldGroup is null here, Transform.postRender() will add it on the first frame.

    // activated gizmos
    this._activatedType =
      Gizmo.TRANS_XYZ | Gizmo.ROT_XYZ | Gizmo.PLANE_XYZ | Gizmo.SCALE_XYZW | Gizmo.ROT_W | Gizmo.TRANS_W;

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
    // full arc display (also the trackball region — see onMouseOver interior pick)
    this._rotW = createGizmo(Gizmo.ROT_W);

    // center handle — free translate in the camera plane
    this._transW = createGizmo(Gizmo.TRANS_W);

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

    // local _matrix of each mesh at drag start — the gizmo writes the real transform
    // live each frame (newLocal = startLocal * editMatrix), so children/wireframe
    // follow through the native scene graph instead of an editMatrix shader preview.
    this._startLocal = [];

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

    // Center handle first — it's a small sphere at the origin, so nearest-hit picking lets
    // central clicks grab it over the rings/arrows that also pass near the center.
    if (type & TRANS_W) pickables.push(this._transW._pickGeo);

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

    this._createCenter(this._transW, COLOR_SW, scale);
  }

  // Center sphere = free translate in the camera plane. Base matrix is identity (it sits at
  // the gizmo origin); the pick sphere is a touch larger so it's easy to grab.
  _createCenter(tra, color, scale = 1.0) {
    tra._baseMatrix = mat4.create();
    vec3.copy(tra._color, color);
    tra._pickGeo = Primitives.createSphere(this._gl, CUBE_SIDE * 0.75 * scale, 16, 16);
    tra._pickGeo._gizmo = tra;
    tra._drawGeo = Primitives.createSphere(this._gl, CUBE_SIDE * 0.5 * scale, 16, 16);
    tra._drawGeo.setShaderType(Enums.Shader.FLAT);

    const threeMesh = tra._drawGeo.getThreeMesh();
    if (threeMesh) {
      threeMesh.material = new THREE.MeshBasicMaterial({
        color: new THREE.Color(color[0], color[1], color[2]),
        transparent: true,
        opacity: 0.85,
        depthTest: false,
        depthWrite: false
      });
      threeMesh.matrixAutoUpdate = false;
      threeMesh.renderOrder = 101; // just above the rings so it's grabbable at center
      if (this._group) this._group.add(threeMesh);
    }

    const pickThreeMesh = tra._pickGeo.getThreeMesh();
    if (pickThreeMesh) {
      pickThreeMesh.visible = false;
      pickThreeMesh.matrixAutoUpdate = false;
      if (this._group) this._group.add(pickThreeMesh);
    }
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
      vec3.transformMat4(icenter, icenter, mesh.getModelSpaceMatrix(_TMP_MAT));
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
    this._transW.updateFinalMatrix(traScale);
  }

  _updatePickGeometryMatrices() {
    // Copy _finalMatrix (Component) to _pickGeo (Mesh) matrix
    // Because Picking.js uses mesh.getMatrix()
    var comps = [
      this._transX, this._transY, this._transZ,
      this._planeX, this._planeY, this._planeZ,
      this._rotX, this._rotY, this._rotZ, this._rotW,
      this._scaleX, this._scaleY, this._scaleZ, this._scaleW,
      this._transW
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
    this._transW.updateFinalMatrix(traScale);
    this._transW.updateMatrix();
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

      // Snapshot the LOCAL matrix at drag start; live writes are startLocal * editMatrix.
      this._startLocal[i] = mat4.clone(meshes[i].getMatrix());

      // mesh MODEL matrix (parentChain * _matrix). Using the model matrix as the
      // edit frame means the conjugation editLocalInv * worldEdit * editLocal yields
      // a mesh-LOCAL delta, so Transform.end's local commit (_matrix * editMatrix)
      // reproduces the world-space transform even for a parented child. Reduces to
      // getMatrix() for an unparented mesh.
      meshes[i].getModelSpaceMatrix(this._editLocal[i]);

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

  // ---- Center handle: free translate in the camera plane ----------------------------
  _startCameraPlaneEdit() {
    var main = this._main;
    var camera = main.getCamera();
    var origin = this._editLineOrigin;
    this._computeCenterGizmo(origin);
    vec3.copy(origin, camera.project(origin));
    var offset = this._editOffset;
    offset[0] = main._mouseX - origin[0];
    offset[1] = main._mouseY - origin[1];
    vec2.set(this._editLineOrigin, main._mouseX, main._mouseY);
    // Fixed screen-facing plane normal (camera forward) captured at drag start. editTransInv
    // is translation-only so the direction is unchanged in that frame.
    var c = this._computeCenterGizmo([0, 0, 0]);
    var cs = camera.project(c);
    var n0 = camera.unproject(cs[0], cs[1], 0.0);
    var n1 = camera.unproject(cs[0], cs[1], 0.5);
    this._camPlaneNormal = vec3.normalize([0, 0, 0], vec3.sub([0, 0, 0], n1, n0));
  }

  _updateCameraPlaneEdit() {
    var main = this._main;
    var camera = main.getCamera();
    var vec = [main._mouseX, main._mouseY, 0.0];
    vec2.sub(vec, vec, this._editOffset);
    this._updateLineHelper(this._editLineOrigin[0], this._editLineOrigin[1], main._mouseX, main._mouseY);

    var near = camera.unproject(vec[0], vec[1], 0.0);
    var far = camera.unproject(vec[0], vec[1], 0.1);
    vec3.transformMat4(near, near, this._editTransInv);
    vec3.transformMat4(far, far, this._editTransInv);

    var N = this._camPlaneNormal;
    var dist1 = vec3.dot(near, N);
    var dist2 = vec3.dot(far, N);
    if (dist1 === dist2) return false;
    var val = -dist1 / (dist2 - dist1);
    var inter = [
      near[0] + (far[0] - near[0]) * val,
      near[1] + (far[1] - near[1]) * val,
      near[2] + (far[2] - near[2]) * val
    ];
    this._updateMatrixTranslate(inter);
  }

  // ---- Trackball (arcball) free rotate inside the rotation sphere --------------------
  _gizmoScreenRadius() {
    var camera = this._main.getCamera();
    var c = this._computeCenterGizmo([0, 0, 0]);
    var cs = camera.project(c);
    // A point on the (camera-facing) rotation ring in world space → its screen distance
    // from the center is the sphere's on-screen radius.
    var edge = vec3.transformMat4([0, 0, 0], [ROT_RADIUS, 0.0, 0.0], this._rotW._finalMatrix);
    var es = camera.project(edge);
    var dx = es[0] - cs[0], dy = es[1] - cs[1];
    return { cx: cs[0], cy: cs[1], r: Math.max(1e-3, Math.sqrt(dx * dx + dy * dy)) };
  }

  _isInsideRotSphere(mx, my) {
    var s = this._gizmoScreenRadius();
    var dx = mx - s.cx, dy = my - s.cy;
    return (dx * dx + dy * dy) <= s.r * s.r;
  }

  // THE TRACKBALL IS THE WHOLE INTERIOR, and the centre exclusion that used to be here is gone.
  //
  // It was an annulus — inside the ring but outside 0.5r — on the reasoning that the trackball
  // must not steal the crowded centre where the centre sphere and the plane handles live. But
  // this is only ever consulted AFTER `_pickGizmoTiered` has returned nothing, and that pick
  // gives the centre sphere and the planes their own priority tiers ahead of everything else.
  // If the tiered pick missed them, there is nothing left in the middle to protect: the
  // exclusion was belt-and-braces over a rule that had already run.
  //
  // What it cost was the gesture every other app has — press inside the gizmo on empty space
  // and swing. matt: "usually click and drag within the transform gizmo in empty space is
  // treated as a trackball rotation", reporting that a click in there orbits the CAMERA
  // instead, which is what a click the gizmo declines falls through to.
  _inTrackballZone(mx, my) {
    return this._isInsideRotSphere(mx, my);
  }

  // Camera right / up / toward-viewer axes in world space, via unproject (no Camera
  // internals). Screen y grows downward, so screen-up is cy − 10.
  _cameraBasis() {
    var camera = this._main.getCamera();
    var c = this._computeCenterGizmo([0, 0, 0]);
    var cs = camera.project(c);
    var o = camera.unproject(cs[0], cs[1], 0.0);
    var oR = camera.unproject(cs[0] + 10, cs[1], 0.0);
    var oU = camera.unproject(cs[0], cs[1] - 10, 0.0);
    var oF = camera.unproject(cs[0], cs[1], 0.5);
    return {
      right: vec3.normalize([0, 0, 0], vec3.sub([0, 0, 0], oR, o)),
      up: vec3.normalize([0, 0, 0], vec3.sub([0, 0, 0], oU, o)),
      viewer: vec3.normalize([0, 0, 0], vec3.sub([0, 0, 0], o, oF)),
    };
  }

  // Map a screen point to a vector on the virtual arcball in camera space
  // (right = +x, up = +y, toward-viewer = +z).
  _arcballVec(mx, my) {
    var s = this._gizmoScreenRadius();
    var x = (mx - s.cx) / s.r;
    var y = (my - s.cy) / s.r;
    var d2 = x * x + y * y;
    var z;
    if (d2 <= 1.0) {
      z = Math.sqrt(1.0 - d2);
    } else {
      var inv = 1.0 / Math.sqrt(d2);
      x *= inv; y *= inv; z = 0.0;
    }
    return [x, -y, z];
  }

  _startTrackballEdit() {
    this._trackStartVec = this._arcballVec(this._main._mouseX, this._main._mouseY);
    this._trackBasis = this._cameraBasis();
  }

  _updateTrackballEdit() {
    var meshes = this._main.getSelectedMeshes();
    var v0 = this._trackStartVec;
    var v1 = this._arcballVec(this._main._mouseX, this._main._mouseY);

    var axisCam = vec3.cross([0, 0, 0], v0, v1);
    var lenAxis = vec3.length(axisCam);
    var dot = Math.max(-1.0, Math.min(1.0, vec3.dot(v0, v1)));
    var angle = Math.atan2(lenAxis, dot);

    if (lenAxis < 1e-6 || angle < 1e-6) {
      for (var k = 0; k < meshes.length; ++k) mat4.identity(meshes[k].getEditMatrix());
      return;
    }
    vec3.scale(axisCam, axisCam, 1.0 / lenAxis);

    // camera-space axis → world axis via the camera basis captured at drag start
    var b = this._trackBasis;
    var axisW = [
      b.right[0] * axisCam[0] + b.up[0] * axisCam[1] + b.viewer[0] * axisCam[2],
      b.right[1] * axisCam[0] + b.up[1] * axisCam[1] + b.viewer[1] * axisCam[2],
      b.right[2] * axisCam[0] + b.up[2] * axisCam[1] + b.viewer[2] * axisCam[2]
    ];
    vec3.normalize(axisW, axisW);

    for (var i = 0; i < meshes.length; ++i) {
      var mrot = meshes[i].getEditMatrix();
      mat4.identity(mrot);
      mat4.rotate(mrot, mrot, angle, axisW);
      this._scaleRotateEditMatrix(mrot, i);
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

    scene.push(this._transW._drawGeo);

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

    if (type & TRANS_W) this._drawGizmo(this._transW, camera);

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

    if (type & TRANS_W) this._drawGizmo(this._transW, camera);

    // if (this._isEditing) this._lineHelper.render(this._main);
  }

  // Consume each mesh's freshly-built editMatrix delta into its real _matrix
  // (newLocal = startLocal * editMatrix) and reset editMatrix to identity. The
  // object then moves through the scene graph natively — children and the
  // wireframe follow for free, and the shader's uEM preview is a no-op.
  _applyEditLive() {
    var meshes = this._main.getSelectedMeshes();
    for (var i = 0; i < meshes.length; ++i) {
      if (!this._startLocal[i]) continue;
      var em = meshes[i].getEditMatrix();
      mat4.mul(_TMP_LIVE, this._startLocal[i], em);
      meshes[i].setMatrix(_TMP_LIVE);
      mat4.identity(em);
    }
  }

  onMouseOver() {
    if (this._isEditing) {
      var type = this._selected._type;
      if (type & ROT_XYZ) this._updateRotateEdit();
      else if (type & TRANS_XYZ) this._updateTranslateEdit();
      else if (type & PLANE_XYZ) this._updatePlaneEdit();
      else if (type & SCALE_XYZW) this._updateScaleEdit();
      else if (type & TRANS_W) this._updateCameraPlaneEdit();
      else if (type & ROT_W) this._updateTrackballEdit();

      this._applyEditLive();   // editMatrix delta → real _matrix, live
      this._main.render();
      return true;
    }

    var main = this._main;
    var picking = main.getPicking();
    var mx = main._mouseX;
    var my = main._mouseY;

    if (this._selected) this._selected._isSelected = false;
    var sel = this._pickGizmoTiered(mx, my);
    if (!sel) {
      // No specific handle hit. If the cursor is in the trackball ZONE (an annulus — inside
      // the rotation sphere but OUTSIDE a center exclusion radius), arm the trackball. The
      // exclusion keeps the trackball from stealing the crowded center region where the
      // center sphere and the plane handles live, so those stay selectable.
      if ((this._activatedType & ROT_W) && this._inTrackballZone(mx, my)) {
        this._selected = this._rotW;
        this._rotW._isSelected = true;
        return true;
      }
      this._selected = null;
      return false;
    }

    this._selected = sel;
    this._selected._isSelected = true;
    vec3.copy(this._selected._lastInter, picking.getIntersectionPoint());
    return true;
  }

  // Priority-tiered pick. The handles draw as a depth-off overlay, but a raw nearest-hit
  // ray test lets the fat arrow bases (which meet at the center) and the rotation tori win
  // over the small center sphere / thin plane quads you're visually on. So test tier by
  // tier — center → planes → arrows/scale → rings — and take the nearest hit in the FIRST
  // tier that hits anything. Matches what you see (WYSIWYG for the overlay).
  _pickGizmoTiered(mx, my) {
    var picking = this._main.getPicking();
    var t = this._activatedType;
    var tiers = [
      [this._transW],
      [this._planeX, this._planeY, this._planeZ],
      [this._transX, this._transY, this._transZ,
       this._scaleX, this._scaleY, this._scaleZ, this._scaleW],
      [this._rotX, this._rotY, this._rotZ],
    ];
    for (var ti = 0; ti < tiers.length; ++ti) {
      var geos = [];
      for (var j = 0; j < tiers[ti].length; ++j) {
        var part = tiers[ti][j];
        if ((t & part._type) && part._pickGeo) geos.push(part._pickGeo);
      }
      if (geos.length === 0) continue;
      // twoSided ONLY for the plane tier (ti===1): a thin plane quad goes edge-on / back-facing
      // at some views and a one-sided test culls it (the green Y-plane problem). The rings must
      // stay ONE-sided, though — twoSided rings pick from their far/back arc, so a click well
      // OUTSIDE the gizmo grazing a ring's back was grabbing e.g. X-rotation with no visible
      // highlight (it landed on the hidden arc). Arrows/scale/center are solid → one-sided fine.
      picking.intersectionMouseMeshes(geos, mx, my, ti === 1);
      var geo = picking.getMesh();
      if (geo) return geo._gizmo;
    }
    return null;
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
    else if (type & TRANS_W) this._startCameraPlaneEdit();
    else if (type & ROT_W) this._startTrackballEdit();

    return true;
  }

  onMouseUp() {
    this._isEditing = false;
  }

  // WHY DID THAT CLICK ORBIT THE CAMERA INSTEAD OF THE GIZMO. A press inside the gizmo reaches
  // the camera only when Transform.start() returns false, and that has exactly three causes:
  // no selected mesh, no armed handle, or the cursor genuinely outside the ring. Reading the
  // code cannot tell them apart, because the answer depends on where the pointer was.
  //
  // Move the mouse to the spot that misbehaves, then run this WITHOUT clicking.
  diag() {
    const s = this._gizmoScreenRadius();
    const mx = this._main._mouseX, my = this._main._mouseY;
    const d = Math.hypot(mx - s.cx, my - s.cy);
    const sel = this._pickGizmoTiered(mx, my);
    console.log('[gizmo] cursor ' + mx.toFixed(0) + ',' + my.toFixed(0)
      + '  centre ' + s.cx.toFixed(0) + ',' + s.cy.toFixed(0)
      + '  ringRadius ' + s.r.toFixed(1) + '  distance ' + d.toFixed(1)
      + ' (' + (d / s.r).toFixed(2) + ' of the ring)');
    console.log('[gizmo] tieredPick=' + (sel ? '#' + sel._type : 'nothing')
      + '  insideRing=' + this._isInsideRotSphere(mx, my)
      + '  trackballWouldArm=' + (!sel && !!(this._activatedType & ROT_W)
        && this._inTrackballZone(mx, my))
      + '  ROT_W enabled=' + !!(this._activatedType & ROT_W)
      + '  selectedMesh=' + !!this._main.getMesh());
    console.log('[gizmo] a press orbits the camera when trackballWouldArm is false AND '
      + 'tieredPick is nothing — or when selectedMesh is false, because Transform.start() '
      + 'requires one before it consults the gizmo at all.');
    return { r: s.r, d: d, sel: sel && sel._type };
  }
}

// Reachable without holding the instance: the Transform tool owns it.
window.gizmoDiag = function () {
  const app = window.app || window.sculptgl;
  const sm = app && app.getSculptManager && app.getSculptManager();
  const t = sm && sm.getCurrentTool && sm.getCurrentTool();
  const g = t && t._gizmo;
  if (!g || !g.diag) {
    console.log('[gizmo] switch to the Transform tool first — the gizmo lives on it');
    return null;
  }
  return g.diag();
};

export default Gizmo;
