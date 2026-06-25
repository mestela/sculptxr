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

    // Cache for radius-drag edit mode — lets circle remain visible off-mesh
    this._lastLocalRadius = null;
    this._lastScreenRadius = null;

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
    // Parent-aware model-space matrix (== getMatrix unparented) so the surface
    // circle/dot is placed in MODEL space, correct for a parented child.
    var _mm = mesh.getModelSpaceMatrix();

    vec3.copy(_TMP_AXIS, picking.computePickedNormal());
    vec3.transformMat3(_TMP_AXIS, _TMP_AXIS, mat3.normalFromMat4(_TMP_MAT, _mm));
    vec3.normalize(_TMP_AXIS, _TMP_AXIS);
    var rad = Math.acos(vec3.dot(_BASE, _TMP_AXIS));
    vec3.cross(_TMP_AXIS, _BASE, _TMP_AXIS);

    mat4.identity(_TMP_MAT);
    mat4.translate(_TMP_MAT, _TMP_MAT, vec3.transformMat4(_TMP_VEC, picking.getIntersectionPoint(), _mm));
    mat4.rotate(_TMP_MAT, _TMP_MAT, rad, _TMP_AXIS);

    mat4.mul(_TMP_MATPV, camera.getProjection(), camera.getView());

    // circle mvp
    mat4.scale(this._cacheCircleMVP, _TMP_MAT, vec3.set(_TMP_VEC, worldRadius, worldRadius, worldRadius));
    mat4.mul(this._cacheCircleMVP, _TMP_MATPV, this._cacheCircleMVP);
    // dot mvp
    mat4.scale(this._cacheDotMVP, _TMP_MAT, vec3.set(_TMP_VEC, constRadius, constRadius, constRadius));
    mat4.mul(this._cacheDotMVP, _TMP_MATPV, this._cacheDotMVP);
    // symmetry mvp
    vec3.transformMat4(_TMP_VEC, pickingSym.getIntersectionPoint(), _mm);
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

    const inEditMode = this._isEditMode;
    var pickedMesh = !!main.getPicking().getMesh();

    if (main.getXRMode && main.getXRMode() && main.getPicking()._isVRHit) {
      pickedMesh = false;
    }

    // Hide brush indicator during playback or when using transform tool on desktop
    const sm = main.getSculptManager();
    const curIdx = sm ? sm.getToolIndex() : -1;
    const isTransform = curIdx === Enums.Tools.TRANSFORM || curIdx === Enums.Tools.TRANSFORM_VR;

    if (window._animPlaying || isTransform) {
      pickedMesh = false;
    }

    if (!this._threeCircle) {
      // LineLoop gives a true 1-px-wide circle outline, matching the original GL line look.
      // RingGeometry creates a filled disk that appears too thick at large radii.
      const pts = [];
      for (let i = 0; i <= 64; i++) {
        const a = (i / 64) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a), Math.sin(a), 0));
      }
      const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
      const lineMat = new THREE.LineBasicMaterial({ color: 0xff0000, linewidth: 2, depthTest: false, depthWrite: false, transparent: true });
      this._threeCircle = new THREE.LineLoop(lineGeo, lineMat);
      this._threeCircle.renderOrder = 10000;

      const dotGeo = new THREE.SphereGeometry(0.005, 8, 8);
      const dotMat = new THREE.MeshBasicMaterial({ color: 0xff0000, side: THREE.DoubleSide, depthTest: false, depthWrite: false, transparent: true });
      this._threeDot = new THREE.Mesh(dotGeo, dotMat);
      this._threeDot.renderOrder = 10000;
    }

    // Voxel brush is a 3D volume, so it gets a translucent sphere (radius 1, scaled
    // per-frame) instead of the flat surface circle. Separate guard so it's created
    // even on an existing Selection instance (e.g. after HMR) that already has the circle.
    if (!this._threeVoxelSphere) {
      const vsGeo = new THREE.SphereGeometry(1, 24, 16);
      // Fresnel "xray" material — same look as the VR volume cursor (additive rim glow).
      const vsMat = new THREE.ShaderMaterial({
        uniforms: { color: { value: new THREE.Color(0x4488ff) } },
        vertexShader: `
          varying vec3 vNormal;
          varying vec3 vPositionNormal;
          void main() {
            vNormal = normalize(normalMatrix * normal);
            vPositionNormal = normalize((modelViewMatrix * vec4(position, 1.0)).xyz);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: `
          uniform vec3 color;
          varying vec3 vNormal;
          varying vec3 vPositionNormal;
          void main() {
            float fresnel = pow(1.0 - abs(dot(vNormal, vPositionNormal)), 3.0);
            gl_FragColor = vec4(color * fresnel, fresnel);
          }`,
        transparent: true, depthTest: true, depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      });
      this._threeVoxelSphere = new THREE.Mesh(vsGeo, vsMat);
      this._threeVoxelSphere.renderOrder = 10000;
    }

    const _curTool = sm ? sm.getCurrentTool() : null;
    const _pkMesh = main.getPicking() ? main.getPicking().getMesh() : null;
    // Treat it as voxel context if the Voxel tool is active OR the hovered mesh is a
    // voxel object — so the volume cursor shows whenever you're over voxels.
    const isVoxel = (_pkMesh && _pkMesh._isVoxel) ||
                    curIdx === Enums.Tools.VOXEL ||
                    (_curTool && _curTool.constructor && _curTool.constructor.name === 'SculptVoxel');

    if (window._voxelCursorDebug && (this._dbgN = (this._dbgN || 0) + 1) % 30 === 0) {
      const pk = main.getPicking();
      console.log('[VoxelCursor] isVoxel=%s pickedMesh=%s sphereObj=%s curIdx=%s tool=%s interPt=%s',
        isVoxel, pickedMesh, !!this._threeVoxelSphere, curIdx,
        _curTool && _curTool.constructor && _curTool.constructor.name,
        pk && pk.getMesh && pk.getMesh() ? JSON.stringify(Array.from(pk.getIntersectionPoint()).map(n=>+n.toFixed(1))) : 'none');
    }

    if (pickedMesh && isVoxel && this._threeVoxelSphere) {
      // Voxel: show the volumetric sphere at the cursor, hide the flat circle/dot.
      var picking = main.getPicking();
      var mesh = picking.getMesh();
      var threeMesh = mesh.getThreeMesh();
      if (this._threeVoxelSphere.parent !== threeMesh) threeMesh.add(this._threeVoxelSphere);

      // Same size convention as the flat brush circle: the standard world radius
      // converted to the mesh's local/model space. SculptVoxel.stroke deposits at the
      // same world radius, so the indicator and the actual edit stay locked together.
      var worldRadius = Math.sqrt(picking.computeWorldRadius2(true));
      const m = threeMesh.matrixWorld.elements;
      const s = Math.sqrt(m[0] * m[0] + m[4] * m[4] + m[8] * m[8]) || 1;
      const localR = Math.max(1e-4, worldRadius / s);
      this._threeVoxelSphere.position.fromArray(picking.getIntersectionPoint());
      this._threeVoxelSphere.scale.set(localR, localR, localR);

      // Tint red for carve modes (Sub / Deflate / negative), blue otherwise.
      const vtool = (sm.getTool ? sm.getTool(Enums.Tools.VOXEL) : null) || sm.getCurrentTool();
      const isSub = !!(vtool && (vtool._negative || vtool._mode === 1));
      this._threeVoxelSphere.material.uniforms.color.value.setHex(isSub ? 0xff3030 : 0x4488ff);
      this._threeVoxelSphere.visible = true;

      if (this._threeCircle) this._threeCircle.visible = false;
      if (this._threeDot)   this._threeDot.visible    = false;
      return;
    }
    if (this._threeVoxelSphere) this._threeVoxelSphere.visible = false;

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
      if (normal) {
        this._threeCircle.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(normal[0], normal[1], normal[2]));
      }

      this._threeCircle.visible = true;
      this._threeDot.position.fromArray(interPoint);

      // Keep the dot a fixed screen-space size regardless of zoom level.
      // The sphere geometry has radius 0.005; we scale it so it always appears
      // as a small fixed number of pixels. Formula: world dot radius = dotPx * worldRadius / screenRadius.
      const screenRadius = sm ? sm.getCurrentTool().getScreenRadius() : localRadius;
      const dotPx = 5;
      const dotLocalRadius = (dotPx * localRadius) / (screenRadius * 0.005);
      this._threeDot.scale.set(dotLocalRadius, dotLocalRadius, dotLocalRadius);

      this._threeDot.visible = !inEditMode; // hide centre dot during radius drag

      // Cache position/radius so the circle can stay visible when cursor leaves the mesh
      this._lastLocalRadius  = localRadius;
      this._lastScreenRadius = sm ? sm.getCurrentTool().getScreenRadius() : localRadius;

    } else if (inEditMode && this._lastLocalRadius !== null && this._threeCircle.parent) {
      // Radius-drag mode but cursor not over mesh — keep circle at last 3D position and
      // scale it proportionally to the current screen radius so it grows/shrinks visually.
      const curScreenRadius = sm ? sm.getCurrentTool().getScreenRadius() : this._lastScreenRadius;
      if (curScreenRadius && this._lastScreenRadius) {
        const ratio = curScreenRadius / this._lastScreenRadius;
        const newLocalRadius = this._lastLocalRadius * ratio;
        this._threeCircle.scale.set(newLocalRadius, newLocalRadius, newLocalRadius);
        // Update cache so next frame diffs correctly
        this._lastLocalRadius  = newLocalRadius;
        this._lastScreenRadius = curScreenRadius;
      }
      this._threeCircle.visible = true;
      this._threeDot.visible = false;

    } else {
      if (this._threeCircle) this._threeCircle.visible = false;
      if (this._threeDot)   this._threeDot.visible    = false;
    }
    // _isEditMode is managed by GuiSculpting — do NOT reset it here
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
    // Parent-aware model-space matrix (== getMatrix unparented) — the local interPoint
    // must be lifted to MODEL space to place the surface circle/dot correctly; the raw
    // local matrix mis-places it (parent-local) for a parented child.
    var _mm = mesh.getModelSpaceMatrix();

    // 1. Get Surface Normal
    var pNormal = picking.getPickedNormal();
    if (pNormal && pNormal.length >= 3) {
      vec3.copy(_TMP_AXIS, pNormal);
    } else {
      vec3.set(_TMP_AXIS, 0, 1, 0); // Fallback
    }

    var nm = mat3.normalFromMat4(_TMP_MAT, _mm);
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
    mat4.translate(_TMP_MAT, _TMP_MAT, vec3.transformMat4(_TMP_VEC, picking.getIntersectionPoint(), _mm));
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
        vec3.transformMat3(_TMP_AXIS, _TMP_AXIS, mat3.normalFromMat4(_TMP_MAT, _mm));
        vec3.normalize(_TMP_AXIS, _TMP_AXIS);

        rad = Math.acos(vec3.dot(_BASE, _TMP_AXIS));
        vec3.cross(_TMP_AXIS, _BASE, _TMP_AXIS);
        if (vec3.length(_TMP_AXIS) < 0.00001) vec3.set(_TMP_AXIS, 1, 0, 0);

        // Sym Model
        mat4.identity(_TMP_MAT);
        mat4.translate(_TMP_MAT, _TMP_MAT, vec3.transformMat4(_TMP_VEC, pickingSym.getIntersectionPoint(), _mm));
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
