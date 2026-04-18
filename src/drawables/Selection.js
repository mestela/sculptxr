import { mat3, mat4, vec3 } from 'gl-matrix';
import Buffer from '../render/Buffer.js';
import ShaderLib from '../render/ShaderLib.js';
import Enums from '../misc/Enums.js';
import * as THREE from 'three';

var _TMP_MATPV = mat4.create();
var _TMP_MAT = mat4.create();
var _TMP_VEC = [0.0, 0.0, 0.0];
var _TMP_AXIS = [0.0, 0.0, 0.0];
var _BASE = [0.0, 0.0, 1.0];

var DOT_RADIUS = 50.0;

class Selection {

  constructor(gl) {
    this._gl = gl;

    this._circleBuffer = new Buffer(gl, gl.ARRAY_BUFFER, gl.STATIC_DRAW);
    this._dotBuffer = new Buffer(gl, gl.ARRAY_BUFFER, gl.STATIC_DRAW);

    this._cacheDotMVP = mat4.create();
    this._cacheDotSymMVP = mat4.create();
    this._cacheCircleMVP = mat4.create();
    this._color = new Float32Array([0.8, 0.0, 0.0]);

    this._offsetX = 0.0; // horizontal offset (when editing the radius)
    this._isEditMode = false;

    this.init();
  }

  getGL() {
    return this._gl;
  }

  getCircleBuffer() {
    return this._circleBuffer;
  }

  getDotBuffer() {
    return this._dotBuffer;
  }

  getCircleMVP() {
    return this._cacheCircleMVP;
  }

  getDotMVP() {
    return this._cacheDotMVP;
  }

  getDotSymmetryMVP() {
    return this._cacheDotSymMVP;
  }

  getColor() {
    return this._color;
  }

  setIsEditMode(bool) {
    this._isEditMode = bool;
  }

  getIsEditMode() {
    return this._isEditMode;
  }

  setOffsetX(offset) {
    this._offsetX = offset;
  }

  getOffsetX() {
    return this._offsetX;
  }

  init() {
    this.getCircleBuffer().update(this._getCircleVertices(1.0));
    this.getDotBuffer().update(this._getDotVertices(0.05, 10));
  }

  release() {
    this.getCircleBuffer().release();
    this.getDotBuffer().release();
  }

  _getCircleVertices(radius = 1.0, nbVertices = 50, full = false) {
    var arc = Math.PI * 2;

    var start = full ? 1 : 0;
    var end = full ? nbVertices + 2 : nbVertices;
    var vertices = new Float32Array(end * 3);
    for (var i = start; i < end; ++i) {
      var j = i * 3;
      var segment = (arc * i) / nbVertices;
      vertices[j] = Math.cos(segment) * radius;
      vertices[j + 1] = Math.sin(segment) * radius;
    }
    return vertices;
  }

  _getDotVertices(r, nb) {
    return this._getCircleVertices(r, nb, true);
  }

  _updateMatricesBackground(camera, main) {

    var screenRadius = main.getSculptManager().getCurrentTool().getScreenRadius();

    var w = camera._width * 0.5;
    var h = camera._height * 0.5;
    // no need to recompute the ortho proj each time though
    mat4.ortho(_TMP_MATPV, -w, w, -h, h, -10.0, 10.0);

    mat4.identity(_TMP_MAT);
    mat4.translate(_TMP_MAT, _TMP_MAT, vec3.set(_TMP_VEC, -w + main._mouseX + this._offsetX, h - main._mouseY, 0.0));
    // circle mvp
    mat4.scale(this._cacheCircleMVP, _TMP_MAT, vec3.set(_TMP_VEC, screenRadius, screenRadius, screenRadius));
    mat4.mul(this._cacheCircleMVP, _TMP_MATPV, this._cacheCircleMVP);
    // dot mvp
    mat4.scale(this._cacheDotMVP, _TMP_MAT, vec3.set(_TMP_VEC, DOT_RADIUS, DOT_RADIUS, DOT_RADIUS));
    mat4.mul(this._cacheDotMVP, _TMP_MATPV, this._cacheDotMVP);
    // symmetry mvp
    mat4.scale(this._cacheDotSymMVP, this._cacheDotSymMVP, [0.0, 0.0, 0.0]);
  }

  _updateMatricesMesh(camera, main) {
    var picking = main.getPicking();
    var pickingSym = main.getPickingSymmetry();
    var worldRadius = Math.sqrt(picking.computeWorldRadius2(true));
    var screenRadius = main.getSculptManager().getCurrentTool().getScreenRadius();

    var mesh = picking.getMesh();
    var constRadius = DOT_RADIUS * (worldRadius / screenRadius);

    vec3.copy(_TMP_AXIS, picking.computePickedNormal());
    vec3.transformMat3(_TMP_AXIS, _TMP_AXIS, mat3.normalFromMat4(_TMP_MAT, mesh.getMatrix()));
    vec3.normalize(_TMP_AXIS, _TMP_AXIS);
    var rad = Math.acos(vec3.dot(_BASE, _TMP_AXIS));
    vec3.cross(_TMP_AXIS, _BASE, _TMP_AXIS);

    mat4.identity(_TMP_MAT);
    mat4.translate(_TMP_MAT, _TMP_MAT, vec3.transformMat4(_TMP_VEC, picking.getIntersectionPoint(), mesh.getMatrix()));
    mat4.rotate(_TMP_MAT, _TMP_MAT, rad, _TMP_AXIS);

    mat4.mul(_TMP_MATPV, camera.getProjection(), camera.getView());

    // circle mvp
    mat4.scale(this._cacheCircleMVP, _TMP_MAT, vec3.set(_TMP_VEC, worldRadius, worldRadius, worldRadius));
    mat4.mul(this._cacheCircleMVP, _TMP_MATPV, this._cacheCircleMVP);
    // dot mvp
    mat4.scale(this._cacheDotMVP, _TMP_MAT, vec3.set(_TMP_VEC, constRadius, constRadius, constRadius));
    mat4.mul(this._cacheDotMVP, _TMP_MATPV, this._cacheDotMVP);
    // symmetry mvp
    vec3.transformMat4(_TMP_VEC, pickingSym.getIntersectionPoint(), mesh.getMatrix());
    mat4.identity(_TMP_MAT);
    mat4.translate(_TMP_MAT, _TMP_MAT, _TMP_VEC);
    mat4.rotate(_TMP_MAT, _TMP_MAT, rad, _TMP_AXIS);

    mat4.scale(_TMP_MAT, _TMP_MAT, vec3.set(_TMP_VEC, constRadius, constRadius, constRadius));
    mat4.mul(this._cacheDotSymMVP, _TMP_MATPV, _TMP_MAT);
  }

  render(main) {
    // ABORT if we are in VR (VR uses renderVR), UNLESS we are rendering a decoupled desktop spectator view.
    if (main.getXRMode && main.getXRMode()) {
      const gl = this._gl;
      if (gl.getParameter(gl.FRAMEBUFFER_BINDING) !== null) {
        return; 
      }
      if (window.isUIHiddenForVR) {
        return;
      }
    }

    var pickedMesh = main.getPicking().getMesh() && !this._isEditMode;

    if (main.getXRMode && main.getXRMode() && main.getPicking()._isVRHit) {
      pickedMesh = false;
    }

    if (!this._threeCircle) {
      const geo = new THREE.RingGeometry(0.9, 1.0, 32);
      const mat = new THREE.MeshBasicMaterial({ color: 0xff0000, side: THREE.DoubleSide, depthTest: false, depthWrite: false, transparent: true });
      this._threeCircle = new THREE.Mesh(geo, mat);
      this._threeCircle.renderOrder = 10000; // Render on top
      
      const dotGeo = new THREE.SphereGeometry(0.005, 8, 8);
      this._threeDot = new THREE.Mesh(dotGeo, mat);
      this._threeDot.renderOrder = 10000; // Render on top
    }

    if (pickedMesh) {
      var picking = main.getPicking();
      var mesh = picking.getMesh();
      var threeMesh = mesh.getThreeMesh();
      
      // Attach to the mesh if not already, so it inherits local space transforms
      if (this._threeCircle.parent !== threeMesh) {
        threeMesh.add(this._threeCircle);
        threeMesh.add(this._threeDot);
      }
      
      var worldRadius = Math.sqrt(picking.computeWorldRadius2(true)); // Ignore pressure for indicator
      const m = threeMesh.matrixWorld.elements;
      const scale2 = m[0] * m[0] + m[4] * m[4] + m[8] * m[8];
      var localRadius = worldRadius / Math.sqrt(scale2);
      
      var interPoint = picking.getIntersectionPoint();
      
      this._threeCircle.position.fromArray(interPoint);
      this._threeCircle.scale.set(localRadius, localRadius, localRadius);
      
      // Align with local normal
      var normal = picking.computePickedNormal();
      this._threeCircle.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(normal[0], normal[1], normal[2]));
      
      this._threeCircle.visible = true;
      
      this._threeDot.position.fromArray(interPoint);
      this._threeDot.visible = true;
    } else {
      if (this._threeCircle) this._threeCircle.visible = false;
      if (this._threeDot) this._threeDot.visible = false;
    }

    this._isEditMode = false;
  }

  setIsNegative(bool) {
    this._isNegative = bool;
  }

  renderVR(main, camera, worldRadius) {
    if (!main.getPicking().getMesh()) {
      // if (window.screenLog && Math.random() < 0.01) window.screenLog("RenderVR: No Mesh", "red");
      return;
    }

    var useSym = main.getSculptManager().getSymmetry();

    // VR Specific Matrix Update
    this._updateMatricesMeshVR(camera, main, worldRadius, useSym);

    const currentTool = main.getSculptManager().getCurrentTool();
    const intensity = currentTool ? currentTool._intensity : 0.5;

    // Map intensity to saturation (mix with grey [0.6, 0.6, 0.6])
    const neutral = 0.6;
    const inv = 1.0 - intensity;

    const isActivelySampling = currentTool && currentTool.constructor.name === 'Paint' && currentTool._pickColor && currentTool._lastPickPressed;
    const isPaintTool = currentTool && currentTool.constructor.name === 'Paint';

    if (isActivelySampling) {
      vec3.copy(this._color, currentTool._color);
    } else if (isPaintTool) {
      // If we are painting, the cursor should ALWAYS match the current paint color
      // so we can see what color we are about to paint, and see flips instantly.
      // We still mix with grey based on intensity to show "brush pressure" visually.
      vec3.set(this._color,
        (currentTool._color[0] * intensity) + (neutral * inv),
        (currentTool._color[1] * intensity) + (neutral * inv),
        (currentTool._color[2] * intensity) + (neutral * inv)
      );
    } else if (this._isNegative) {
      vec3.set(this._color,
        (0.8 * intensity) + (neutral * inv),
        (0.0 * intensity) + (neutral * inv),
        (0.0 * intensity) + (neutral * inv)
      ); // RED mixed with grey
    } else {
      vec3.set(this._color,
        (0.0 * intensity) + (neutral * inv),
        (0.0 * intensity) + (neutral * inv),
        (0.8 * intensity) + (neutral * inv)
      ); // BLUE mixed with grey
    }
    const drawCircle = currentTool && currentTool.constructor.name !== 'Twist';

    ShaderLib[Enums.Shader.SELECTION].getOrCreate(this._gl).draw(this, drawCircle, useSym);

    // if (window.screenLog && Math.random() < 0.01) window.screenLog("RenderVR: DRAW", "lime");
  }

  _updateMatricesMeshVR(camera, main, worldRadius, useSym) {
    var picking = main.getPicking();
    var mesh = picking.getMesh();

    // 1. Get Surface Normal
    var pNormal = picking.getPickedNormal();
    if (pNormal && pNormal.length >= 3) {
      vec3.copy(_TMP_AXIS, pNormal);
    } else {
      vec3.set(_TMP_AXIS, 0, 1, 0); // Fallback
    }

    var nm = mat3.normalFromMat4(_TMP_MAT, mesh.getMatrix());
    if (nm) {
      vec3.transformMat3(_TMP_AXIS, _TMP_AXIS, nm);
    } else {
      // Fallback if matrix is singular
      vec3.set(_TMP_AXIS, 1, 0, 0);
    }
    vec3.normalize(_TMP_AXIS, _TMP_AXIS);

    // 2. Derive Orientation
    var rad = Math.acos(vec3.dot(_BASE, _TMP_AXIS));
    vec3.cross(_TMP_AXIS, _BASE, _TMP_AXIS);

    if (vec3.length(_TMP_AXIS) < 0.00001) {
      vec3.set(_TMP_AXIS, 1, 0, 0);
    }

    // 3. Build Model Matrix
    mat4.identity(_TMP_MAT);
    mat4.translate(_TMP_MAT, _TMP_MAT, vec3.transformMat4(_TMP_VEC, picking.getIntersectionPoint(), mesh.getMatrix()));
    mat4.rotate(_TMP_MAT, _TMP_MAT, rad, _TMP_AXIS);

    // 4. Compute MVP
    mat4.mul(_TMP_MATPV, camera.getProjection(), camera.getView());

    // Circle MVP
    mat4.scale(this._cacheCircleMVP, _TMP_MAT, [worldRadius, worldRadius, worldRadius]);
    mat4.mul(this._cacheCircleMVP, _TMP_MATPV, this._cacheCircleMVP);

    // Dot MVP (Restore Dot Visibility - 30% of brush)
    var dotRad = worldRadius * 0.3;
    mat4.scale(this._cacheDotMVP, _TMP_MAT, [dotRad, dotRad, dotRad]);
    mat4.mul(this._cacheDotMVP, _TMP_MATPV, this._cacheDotMVP);

    // Symmetry MVP
    if (useSym) {
      var pickingSym = main.getPickingSymmetry();
      if (pickingSym.getMesh()) {
        // Calculate Sym Normal
        var symNormal = pickingSym.computePickedNormal();
        if (symNormal && symNormal.length >= 3) {
          vec3.copy(_TMP_AXIS, symNormal);
        } else {
          vec3.set(_TMP_AXIS, 0, 1, 0); // Fallback
        }
        vec3.transformMat3(_TMP_AXIS, _TMP_AXIS, mat3.normalFromMat4(_TMP_MAT, mesh.getMatrix()));
        vec3.normalize(_TMP_AXIS, _TMP_AXIS);

        rad = Math.acos(vec3.dot(_BASE, _TMP_AXIS));
        vec3.cross(_TMP_AXIS, _BASE, _TMP_AXIS);
        if (vec3.length(_TMP_AXIS) < 0.00001) vec3.set(_TMP_AXIS, 1, 0, 0);

        // Sym Model
        mat4.identity(_TMP_MAT);
        mat4.translate(_TMP_MAT, _TMP_MAT, vec3.transformMat4(_TMP_VEC, pickingSym.getIntersectionPoint(), mesh.getMatrix()));
        mat4.rotate(_TMP_MAT, _TMP_MAT, rad, _TMP_AXIS);

        // Sym Dot MVP
        mat4.scale(this._cacheDotSymMVP, _TMP_MAT, [dotRad, dotRad, dotRad]);
        mat4.mul(this._cacheDotSymMVP, _TMP_MATPV, this._cacheDotSymMVP);
      } else {
        // Hide Sym Dot
        mat4.identity(this._cacheDotSymMVP);
        mat4.scale(this._cacheDotSymMVP, this._cacheDotSymMVP, [0, 0, 0]);
      }
    } else {
      mat4.identity(this._cacheDotSymMVP);
      mat4.scale(this._cacheDotSymMVP, this._cacheDotSymMVP, [0, 0, 0]);
    }
  }
}

export default Selection;
