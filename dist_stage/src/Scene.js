import { vec3, mat4, quat, mat3 } from 'gl-matrix';
import getOptionsURL from 'misc/getOptionsURL';
import Enums from 'misc/Enums';
import { VERSION } from './Version.js';
import Utils from 'misc/Utils';
import SculptManager from 'editing/SculptManager';
import Subdivision from 'editing/Subdivision';
import Import from 'files/Import';
import Gui from 'gui/Gui';
import Camera from 'math3d/Camera';
import Picking from 'math3d/Picking';
import Background from 'drawables/Background';
import Mesh from 'mesh/Mesh';
import Multimesh from 'mesh/multiresolution/Multimesh';
import Primitives from 'drawables/Primitives';
import StateManager from 'states/StateManager';
import RenderData from 'mesh/RenderData';
import Rtt from 'drawables/Rtt';
import ShaderLib from 'render/ShaderLib';
import MeshStatic from 'mesh/meshStatic/MeshStatic';
import WebGLCaps from 'render/WebGLCaps';
import GuiXR from 'gui/GuiXR';
import VRMenu from 'drawables/VRMenu';
import VRLaser from 'drawables/VRLaser';


class Scene {

  constructor() {
    this._gl = null; // webgl context

    this._cameraSpeed = 0.25;

    // cache canvas stuffs
    this._pixelRatio = 1.0;
    this._viewport = document.getElementById('viewport');

    // Detect Quest Standalone (OculusBrowser) for Offset Fix
    // Standalone WebXR implementation has a different Ray Origin vs Controller Model alignment than PCVR.
    this._isQuestStandalone = /OculusBrowser/.test(navigator.userAgent);
    if (this._isQuestStandalone && window.screenLog) window.screenLog("Detected: Oculus Browser (Standalone)", "lime");

    this._preventDefault = this._preventDefault.bind(this);
    this._canvas = document.getElementById('canvas');
    this._canvasWidth = 0;
    this._canvasHeight = 0;
    this._canvasOffsetLeft = 0;
    this._canvasOffsetTop = 0;

    // core of the app
    this._stateManager = new StateManager(this); // for undo-redo
    this._sculptManager = null;
    this._camera = new Camera(this);
    this._picking = new Picking(this); // the ray picking
    this._pickingSym = new Picking(this, true); // the symmetrical picking

    // TODO primitive builder
    this._meshPreview = null;
    this._torusLength = 0.5;
    this._torusWidth = 0.1;
    this._torusRadius = Math.PI * 2;
    this._torusRadial = 32;
    this._torusTubular = 128;

    // renderable stuffs
    var opts = getOptionsURL();
    this._showContour = opts.outline;
    this._showGrid = opts.grid;
    this._grid = null;
    this._background = null;
    this._meshes = []; // the meshes
    this._selectMeshes = []; // multi selection
    this._mesh = null; // the selected mesh
    this._debugPivotMesh = null; // Debug pink cube for VR pivot

    this._rttContour = null; // rtt for contour
    this._rttMerge = null; // rtt decode opaque + merge transparent
    this._rttOpaque = null; // rtt half float
    this._rttTransparent = null; // rtt rgbm

    // ui stuffs
    this._focusGui = false; // if the gui is being focused
    this._gui = new Gui(this);

    this._preventRender = false; // prevent multiple render per frame
    this._drawFullScene = false; // render everything on the rtt
    this._autoMatrix = opts.scalecenter; // scale and center the imported meshes
    this._vertexSRGB = true; // srgb vs linear colorspace for vertex color

    // VR Interaction State
    this._xrSession = null;
    this._baseRefSpace = null;
    this._xrRefSpace = null;
    // [CALIBRATED DEFAULTS] Trans[0.01, 1.09, -0.34] Scale[0.99]
    // We only set the offset here if XRRigidTransform is available, else null and init later.
    // XRRigidTransform is usually available in window if Secure Context.
    this._xrWorldOffset = (typeof XRRigidTransform !== 'undefined')
      ? new XRRigidTransform({ x: 0.01, y: 1.09, z: -0.34 })
      : null;

    this._activeHandedness = 'right';
    this._vrScale = 0.008; // Scale 100-unit world to 0.8 meters (User Req: "25% too big")
    this._exposure = 1.0; // Reset to 1.0 after fixing ShaderMerge 5x boost

    this._debugInput = false; // Toggle via console: app.scene._debugInput = true

    this._vrGrip = {
      left: { active: false, startPoint: vec3.create(), startRot: quat.create() },
      right: { active: false, startPoint: vec3.create(), startRot: quat.create() }
    };

    // Initial World Offset (Camera pulled back 55cm, Lifted 1.2m)
    // Fix: Y=0 put it on the floor. Y=1.2 should be chest/head height.
    this._xrWorldOffset = new XRRigidTransform({ x: 0, y: 1.2, z: -0.55 });
    this._vrTwoHanded = { active: false, prevMid: vec3.create(), prevDist: 0.0, prevVec: vec3.create() };

    // VR Menu State
    this._guiXR = null;
    this._vrMenu = null;
    this._vrPoseLeft = null;
    this._vrPoseRight = null;
  }

  start() {

    this.initWebGL();
    if (!this._gl)
      return;

    this._sculptManager = new SculptManager(this);
    this._background = new Background(this._gl, this);

    this._rttContour = new Rtt(this._gl, Enums.Shader.CONTOUR, null);
    this._rttMerge = new Rtt(this._gl, Enums.Shader.MERGE, null);
    this._rttOpaque = new Rtt(this._gl, Enums.Shader.FXAA);
    this._rttTransparent = new Rtt(this._gl, null, this._rttOpaque.getDepth(), true);

    this._grid = Primitives.createGrid(this._gl);
    this.initGrid();

    this.loadTextures();
    this._gui.initGui();
    this.loadTextures();
    this._gui.initGui();

    // EXPERIMENTAL: Desktop 6DOF Mode
    this._desktopInputMode = true; // Default ON for testing

    // Always Init GuiXR (Menu System)
    if (!this._guiXR) this._guiXR = new GuiXR(this);
    this._guiXR.init(this._gl);

    this.onCanvasResize();

    var modelURL = getOptionsURL().modelurl;
    if (modelURL) this.addModelURL(modelURL);
    else this.addSphere(); // [USER REQUEST] Default sphere re-enabled

    // [DEBUG] Visualize Sphere Lift Target
    // this.updateDebugPivot([0, 1.3, -0.5], true);

    // [DEBUG] Auto-Selection Check
    if (this._sculptManager) {
      const tool = this._sculptManager.getCurrentTool();
      const toolName = tool ? tool.constructor.name : "None";
      const toolIdx = this._sculptManager.getToolIndex();
      // if (window.screenLog) window.screenLog(`Auto-Selected Tool: ${toolName} (Idx: ${toolIdx})`, "lime");
      // console.log(`Auto-Selected Tool: ${toolName} (Idx: ${toolIdx})`);

      // Force Voxel Start if Voxel Tool provided
      if (toolName === 'SculptVoxel' && tool.forceInit) {
        tool.forceInit();
      }
    }
  }

  addModelURL(url) {
    var fileType = this.getFileType(url);
    if (!fileType)
      return;

    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);

    xhr.responseType = fileType === 'obj' ? 'text' : 'arraybuffer';

    xhr.onload = function () {
      if (xhr.status === 200)
        this.loadScene(xhr.response, fileType);
    }.bind(this);

    xhr.send(null);
  }

  getBackground() {
    return this._background;
  }

  getViewport() {
    return this._viewport;
  }

  getCanvas() {
    return this._canvas;
  }

  getPixelRatio() {
    return this._pixelRatio;
  }

  getCanvasWidth() {
    return this._canvasWidth;
  }

  getCanvasHeight() {
    return this._canvasHeight;
  }

  getCamera() {
    return this._camera;
  }

  getGui() {
    return this._gui;
  }

  getGuiXR() {
    return this._guiXR;
  }

  getMeshes() {
    return this._meshes;
  }

  getMesh() {
    return this._mesh;
  }

  getSelectedMeshes() {
    return this._selectMeshes;
  }

  getPicking() {
    return this._picking;
  }

  getPickingSymmetry() {
    return this._pickingSym;
  }

  getSculptManager() {
    return this._sculptManager;
  }

  getStateManager() {
    return this._stateManager;
  }

  setMesh(mesh) {
    return this.setOrUnsetMesh(mesh);
  }

  setCanvasCursor(style) {
    this._canvas.style.cursor = style;
  }

  initGrid() {
    var grid = this._grid;
    grid.normalizeSize();
    var gridm = grid.getMatrix();
    // mat4.translate(gridm, gridm, [0.0, -0.45, 0.0]); // Reset to 0 for VR
    mat4.translate(gridm, gridm, [0.0, -0.5, 0.0]); // Floor level (sphere is radius 0.25 (scaled 0.005 * 50?))
    var scale = 0.1; // Was 2.5, reduce for VR (1/25th size)
    mat4.scale(gridm, gridm, [scale, scale, scale]);
    this._grid.setShaderType(Enums.Shader.FLAT);
    grid.setFlatColor([0.04, 0.04, 0.04]);
  }

  setOrUnsetMesh(mesh, multiSelect) {
    if (!mesh) {
      this._selectMeshes.length = 0;
    } else if (!multiSelect) {
      this._selectMeshes.length = 0;
      this._selectMeshes.push(mesh);
    } else {
      var id = this.getIndexSelectMesh(mesh);
      if (id >= 0) {
        if (this._selectMeshes.length > 1) {
          this._selectMeshes.splice(id, 1);
          mesh = this._selectMeshes[0];
        }
      } else {
        this._selectMeshes.push(mesh);
      }
    }

    this._mesh = mesh;
    this.getGui().updateMesh();
    this.render();
    return mesh;
  }

  renderSelectOverRtt() {
    if (this._requestRender())
      this._drawFullScene = false;
  }

  _requestRender() {
    if (this._preventRender === true || this._xrSession)
      return false; // render already requested for the next frame

    window.requestAnimationFrame(this.applyRender.bind(this));
    this._preventRender = true;
    return true;
  }

  render() {
    this._drawFullScene = true;
    this._requestRender();
  }

  applyRender(arg) {
    // requestAnimationFrame passes a timestamp (number) as first argument
    // We only want a WebGLFramebuffer or null.
    var targetFBO = (arg && typeof arg === 'object') ? arg : null;

    this._preventRender = false;
    this.updateMatricesAndSort();

    var gl = this._gl;
    if (!gl) return;

    if (this._drawFullScene) this._drawScene();

    gl.disable(gl.DEPTH_TEST);

    if (this._rttMerge) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._rttMerge.getFramebuffer());
      this._rttMerge.render(this); // merge + decode
    }

    // render to screen (or target FBO)
    gl.bindFramebuffer(gl.FRAMEBUFFER, targetFBO);

    if (this._rttOpaque) {
      this._rttOpaque.render(this); // fxaa
    }

    gl.enable(gl.DEPTH_TEST);

    if (this._sculptManager) this._sculptManager.postRender(); // draw sculpting gizmo stuffs
  }

  getExposure() {
    return this._exposure;
  }

  // Simplified VR Render (Bypassing RTT/PostProc for now)
  renderVR(glLayer, pose, frame, refSpace) {
    var gl = this._gl;
    var cam = this._camera;
    var views = pose.views;

    // VR Exposure Override (Default 1.0 matches Desktop now)
    // var oldExposure = this._exposure;
    // this._exposure = 1.0; 

    // FBO is already bound by callee
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Lazy init controllers if missing (and GL is ready)
    if (!this._vrControllerLeft || !this._vrControllerRight) {
      this.initVRControllers();
    }

    var meshes = this._meshes;
    var grid = this._grid;

    // VR Controllers
    var ctrls = [];
    if (this._vrControllerLeft) ctrls.push(this._vrControllerLeft);
    if (this._vrControllerRight) ctrls.push(this._vrControllerRight);

    for (var i = 0; i < views.length; ++i) {
      var view = views[i];
      var viewport = glLayer.getViewport(view);
      gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);

      // --- PASS 1: REAL WORLD (Controllers/Debug) ---
      // Apply raw XR view matrix
      mat4.copy(cam._view, view.transform.inverse.matrix);
      mat4.copy(cam._proj, view.projectionMatrix);

      // Render Controllers (Real World)
      for (var j = 0; j < ctrls.length; ++j) {
        ctrls[j].updateMatrices(cam);
        ctrls[j].render(this);
      }

      // VR Menu (Attached to Left Controller) - Pass 1
      if (this._vrMenu && this._vrPoseLeft) {
        // [USER REQUEST] Lift menu 3cm to avoid Z-fighting with controller
        const menuPose = mat4.clone(this._vrPoseLeft);
        const lift = mat4.create();
        // [USER REQUEST] Lift menu 3cm (Y) and shift 3cm Right (X) to reveal buttons
        mat4.fromTranslation(lift, [0.03, 0.03, 0.0]);
        mat4.multiply(menuPose, menuPose, lift);

        this._vrMenu.updateMatrices(cam, menuPose);
        this._vrMenu.render(this);
      }

      // VRLaser (Pass 1) - Only if pointing at Menu
      if (this._vrLaser && this._vrLaserMatrix && this._isPointingAtMenu) {
        // Default to 1.0 if undefined
        const dist = this._vrLaserDistance || 1.0;
        // [USER REQUEST] Push laser start 1cm away to avoid intersecting controller
        this._vrLaser.updateMatrices(cam, this._vrLaserMatrix, dist, 0.01);
        this._vrLaser.render(this);
      }

      // Debug Pivot (Pink/Green Cube) - Pass 1
      if (this._debugPivotMesh && this._debugPivotMesh.isVisible()) {
        gl.disable(gl.DEPTH_TEST);
        this._debugPivotMesh.updateMatrices(cam);
        this._debugPivotMesh.render(this);
        gl.enable(gl.DEPTH_TEST);
      }

      // VR Brush Tip (Pencil) via Reliable Ray Matrix
      if (this._vrControllerTip) {
        // DEBUG: Throttle log every 180 frames (approx 2s at 90fps)
        if (this._logThrottle++ % 180 === 0) {
          if (window.screenLog) {
            const hasMatrix = !!this._vrRightRayMatrix;
            // const tipVis = this._vrControllerTip.isVisible();
            const poseStatus = this._vrRightRayMatrix ? `Pos=[${this._vrRightRayMatrix[12].toFixed(2)},${this._vrRightRayMatrix[13].toFixed(2)}]` : "NoMat";
            // window.screenLog(`Ptr: M=${hasMatrix ? 'OK' : 'NULL'} ${poseStatus}`, hasMatrix ? "lime" : "orange");
            // if (!hasMatrix && this._logThrottle % 360 === 0) window.screenLog("Wait: Ptr Matrix Missing", "orange");
          }
        }

        if (this._vrRightRayMatrix) {
          // 1. Update Tip Matrix
          const mTip = this._vrControllerTip.getMatrix();
          mat4.copy(mTip, this._vrRightRayMatrix);

          // Apply Local Transform (Rotate +Y to -Z, Offset Base)
          // Standalone (OculusBrowser) needs 7.5cm, PCVR needs 2.5cm
          const offY = this._isQuestStandalone ? 0.075 : 0.025;
          mat4.rotateX(mTip, mTip, -Math.PI / 2);
          mat4.translate(mTip, mTip, [0, offY, 0]);

          this._vrControllerTip.updateMatrices(cam);
          this._vrControllerTip.render(this);

          // 2. Update Radius Sphere code REMOVED (Moved to Pass 3 Overlay)
          // Storing matrix for Pass 3 use is handled by _vrRightRayMatrix existence.
        }
      }

      // Log Once
      if (window.screenLog && Math.random() < 0.005) {
        // if (window.screenLog && Math.random() < 0.01) window.screenLog(`VR Rendering: ${meshes.length} Meshes`, "grey");
      }

      // --- PASS 2: SCALED/TRANSFORMED WORLD (Content) ---
      // Apply World Transform to View Matrix
      // View = View * WorldMatrix

      if (this._xrWorldOffset) {
        // Apply Translation/Rotation
        const t = this._xrWorldOffset.position;
        const r = this._xrWorldOffset.orientation;

        const worldMat = mat4.create();
        mat4.fromRotationTranslation(worldMat, [r.x, r.y, r.z, r.w], [t.x, t.y, t.z]);
        mat4.multiply(cam._view, cam._view, worldMat);
      }

      if (this._vrScale !== 1.0) {
        mat4.scale(cam._view, cam._view, [this._vrScale, this._vrScale, this._vrScale]);
      }

      // Grid
      if (this._showGrid && grid) {
        grid.updateMatrices(cam);
        grid.render(this);
      }

      // Meshes
      for (let k = 0, l = meshes.length; k < l; ++k) {
        if (!meshes[k].isVisible()) continue;
        meshes[k].updateMatrices(cam);
        meshes[k].render(this);
      }

      // Wireframe (Pass 2)
      gl.enable(gl.BLEND);
      gl.depthFunc(gl.LESS);
      for (let k = 0, l = meshes.length; k < l; ++k) {
        if (meshes[k].getShowWireframe())
          meshes[k].renderWireframe(this);
      }
      gl.depthFunc(gl.LEQUAL);
      gl.disable(gl.BLEND);

      // Brush Indicator (NEW) - Pass 2 (World Scaled)
      // Rendered here to match Mesh Coordinates
      if (this._sculptManager && this._picking.getMesh()) {
        const radius = this._picking._rWorld2 ? Math.sqrt(this._picking._rWorld2) : 0.05;

        // Visuals: On Top + Blending
        gl.disable(gl.DEPTH_TEST);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        // Use 'cam' (current camera with World Scale applied)
        this._sculptManager.getSelection().renderVR(this, cam, radius);

        gl.disable(gl.BLEND);
        gl.enable(gl.DEPTH_TEST);
      }

      // --- PASS 3: OVERLAY (Real World, Always On Top) ---
      // Restore Real World Matrices (Inverse of View Transform)
      mat4.copy(cam._view, view.transform.inverse.matrix);
      mat4.copy(cam._proj, view.projectionMatrix);

      // Render VR Brush Radius Sphere (Moved from Pass 1)
      if (this._vrBrushRadiusSphere && this._vrRightRayMatrix && this._vrControllerTip) {
        // We reuse the Ray Matrix from Pass 1 (which tracks the controller)
        const mSphere = this._vrBrushRadiusSphere.getMatrix();
        mat4.copy(mSphere, this._vrRightRayMatrix);

        // Transform: Rotate X -90 (Align Y with Z), Translate Y (Tip Center)
        // Standalone: 10cm (7.5cm base + 2.5cm half-length), PCVR: 5cm (2.5cm base + 2.5cm half-length)
        const offY = this._isQuestStandalone ? 0.10 : 0.05;
        mat4.rotateX(mSphere, mSphere, -Math.PI / 2);
        mat4.translate(mSphere, mSphere, [0, offY, 0]);

        // FIX: Normalize rotation columns to remove existing scale (Double Scaling Bug Prevention)
        const sx = Math.hypot(mSphere[0], mSphere[1], mSphere[2]);
        const sy = Math.hypot(mSphere[4], mSphere[5], mSphere[6]);
        const sz = Math.hypot(mSphere[8], mSphere[9], mSphere[10]);

        // Inverse scale to normalize
        if (sx > 1e-6) { mSphere[0] /= sx; mSphere[1] /= sx; mSphere[2] /= sx; }
        if (sy > 1e-6) { mSphere[4] /= sy; mSphere[5] /= sy; mSphere[6] /= sy; }
        if (sz > 1e-6) { mSphere[8] /= sz; mSphere[9] /= sz; mSphere[10] /= sz; }

        // Scale by Radius
        const radius = (this._vrLastPhysicalRadius !== undefined) ? this._vrLastPhysicalRadius : 0.01;
        mat4.scale(mSphere, mSphere, [radius, radius, radius]);

        this._vrBrushRadiusSphere.updateMatrices(cam);

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);

        gl.depthMask(false); // No depth write
        gl.disable(gl.CULL_FACE); // Double sided
        gl.disable(gl.DEPTH_TEST); // Always visible (Ghost through mesh)

        this._vrBrushRadiusSphere.render(this);

        gl.enable(gl.DEPTH_TEST);
        gl.enable(gl.CULL_FACE);
        gl.depthMask(true);
        gl.disable(gl.BLEND);
      }

    }
  }


  _drawSceneVR() {
    var gl = this._gl;
    gl.enable(gl.DEPTH_TEST);

    // grid
    if (this._showGrid) this._grid.render(this);

    // VR Controllers (Pass 1: Real World)
    if (this._vrControllerLeft) this._vrControllerLeft.render(this);
    if (this._vrControllerRight) this._vrControllerRight.render(this);

    // Debug Cursor
    if (this._debugCursor && this._debugCursor.isVisible()) this._debugCursor.render(this);

    // Meshes (Pass 2: World Scaled)
    // See renderVR() logic for matrix scaling
    var meshes = this._meshes;
    for (var i = 0, l = meshes.length; i < l; ++i) {
      if (!meshes[i].isVisible()) continue;
      meshes[i].render(this);
    }

    // Brush Indicator (NEW)
    // Rendered in Pass 2 (World Scaled) to match Mesh Coordinates
    if (this._sculptManager && this._picking.getMesh()) {
      // rWorld2 is set in handleXRInput (picking logic)
      const radius = this._picking._rWorld2 ? Math.sqrt(this._picking._rWorld2) : 0.05;

      // Use 'this._camera' which is the active camera during _drawSceneVR (Pass 2)
      // Note: renderVR() calls _drawSceneVR() AFTER setting up the World Scaled Matrix on the camera.
      this._sculptManager.getSelection().renderVR(this, this._camera, radius);
    }
  }

  _renderVRToolOverlays(cam, convertToWorld = false) {
    if (!this._vrControllerLeft && !this._vrControllerRight && !this._vrControllerTip) return;

    // Helper for Conversion
    const convert = (mat) => {
      if (convertToWorld) {
        this._convertMatrixMetersToWorld(mat);
      }
    };

    // VR Menu (Attached to Left Controller)
    if (this._vrMenu && this._vrPoseLeft) {
      const menuPose = mat4.clone(this._vrPoseLeft);
      // Apply Lift First (Local to Hand)
      const lift = mat4.create();
      mat4.fromTranslation(lift, [0.03, 0.03, 0.0]);
      mat4.multiply(menuPose, menuPose, lift);

      // Convert Space if needed
      convert(menuPose);

      this._vrMenu.updateMatrices(cam, menuPose);
      this._vrMenu.render(this);
    }

    // VR Laser (Only if pointing at Menu)
    if (this._vrLaser && this._vrLaserMatrix && this._isPointingAtMenu) {
      const dist = this._vrLaserDistance || 1.0;
      // Laser Matrix is "TargetRay" (Meters)
      const laserMat = mat4.clone(this._vrLaserMatrix);
      convert(laserMat);

      this._vrLaser.updateMatrices(cam, laserMat, dist, 0.01);
      this._vrLaser.render(this);
    }

    // VR Brush Tip (Pencil)
    if (this._vrControllerTip && this._vrRightRayMatrix) {
      // Tip Local Matrix
      const mTip = this._vrControllerTip.getMatrix();
      mat4.copy(mTip, this._vrRightRayMatrix);

      // Convert Space FIRST (Transform the Raw Ray Matrix to World)
      // Because the subsequent offsets (Quest Standalone fix) are local to the controller?
      // Wait. The offsets (rotateX, translate) are to align the Cylinder Model to the Ray.
      // They should be applied BEFORE World Transform?
      // mTip = RayMatrix * Offsets.
      // We want WorldTip = InvWorld * RayMatrix * Offsets.
      // So Convert does `M = M_inv * M`.
      // If we convert `mTip` (which is RayMatrix), THEN apply offsets...
      // `mTip' = M_inv * RayMatrix`.
      // `mTipFinal = mTip' * Offsets` = `M_inv * RayMatrix * Offsets`.
      // Correct.
      convert(mTip);

      // Apply Local Transform (Rotate +Y to -Z, Offset Base)
      const offY = this._isQuestStandalone ? 0.075 : 0.025;
      const mOffset = mat4.create();
      mat4.rotateX(mOffset, mOffset, -Math.PI / 2);
      mat4.translate(mOffset, mOffset, [0, offY, 0]);
      mat4.multiply(mTip, mTip, mOffset);
      // Note: gl-matrix transform helpers (rotate/translate) act as POST-multiply if used on 'mTip' directly.
      // mat4.rotateX(mTip, mTip, ...) -> mTip * Rot.
      // So equivalent to `M_inv * Ray * Rot * Trans`.
      // Yes.

      this._vrControllerTip.updateMatrices(cam);
      this._vrControllerTip.render(this);
    }
  }

  _convertMatrixMetersToWorld(mat) {
    // Inverse World Transform: P_world = S^-1 * R^-1 * T^-1 * P_meters
    // Construction: M_inv = S_inv * R_inv * T_inv

    // Default to 1.0 scale if undefined, but usually it's ~0.008
    const scaleVal = (this._vrScale !== undefined) ? this._vrScale : 1.0;
    const invScale = 1.0 / scaleVal;

    const mInv = mat4.create();

    // 1. Scale
    mat4.scale(mInv, mInv, [invScale, invScale, invScale]);

    if (this._xrWorldOffset) {
      // 2. Rotate
      const r = this._xrWorldOffset.orientation;
      const qInv = quat.create();
      quat.invert(qInv, quat.fromValues(r.x, r.y, r.z, r.w));
      const mRot = mat4.create();
      mat4.fromQuat(mRot, qInv);
      mat4.multiply(mInv, mInv, mRot);

      // 3. Translate
      const t = this._xrWorldOffset.position;
      mat4.translate(mInv, mInv, [-t.x, -t.y, -t.z]);
    }

    // Apply to input matrix (Local-to-Meters -> Local-to-World)
    mat4.multiply(mat, mInv, mat);
  }

  _drawScene() {
    var gl = this._gl;
    var i = 0;
    var meshes = this._meshes;
    var nbMeshes = meshes.length;

    ///////////////
    // CONTOUR 1/2
    ///////////////
    gl.disable(gl.DEPTH_TEST);
    var showContour = this._selectMeshes.length > 0 && this._showContour && ShaderLib[Enums.Shader.CONTOUR].color[3] > 0.0;
    if (showContour && this._rttContour) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._rttContour.getFramebuffer());
      gl.clear(gl.COLOR_BUFFER_BIT);
      for (var s = 0, sel = this._selectMeshes, nbSel = sel.length; s < nbSel; ++s)
        sel[s].renderFlatColor(this);
    }
    gl.enable(gl.DEPTH_TEST);

    ///////////////
    // OPAQUE PASS
    ///////////////
    if (this._rttOpaque) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._rttOpaque.getFramebuffer());
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    }

    // grid
    if (this._showGrid && this._grid) this._grid.render(this);

    if (this._vrControllerLeft) {
      this._convertMatrixMetersToWorld(this._vrControllerLeft.getMatrix());
      this._vrControllerLeft.updateMatrices(this._camera);
      this._vrControllerLeft.render(this);
    }
    if (this._vrControllerRight) {
      this._convertMatrixMetersToWorld(this._vrControllerRight.getMatrix());
      this._vrControllerRight.updateMatrices(this._camera);
      this._vrControllerRight.render(this);
    }

    // VR Key Overlays (Menu, Laser, Tip) - Render them for Spectator too
    this._renderVRToolOverlays(this._camera, true);

    // Debug Cubes (Desktop View)
    // Force Opaque Rendering (Disable Blend, Disable Stencil, Disable Depth)
    if (this._debugCalibrationCube || this._debugHeadsetCube) {
      gl.disable(gl.BLEND);
      gl.disable(gl.STENCIL_TEST);
      gl.disable(gl.DEPTH_TEST);

      // CRITICAL: Must update matrices with the current camera to generate MVP!
      if (this._debugCalibrationCube) {
        this._debugCalibrationCube.updateMatrices(this._camera);
        this._debugCalibrationCube.render(this);
      }
      if (this._debugHeadsetCube) {
        this._debugHeadsetCube.updateMatrices(this._camera);
        this._debugHeadsetCube.render(this);
      }

      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND); // Restore Blend (Scene defaults usually expect it on?)
      // Actually _drawScene starts with no specific blend expectation but UI overlays might need it.
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); // Safe default
    }
    // VR Key Overlays (Menu, Laser, Tip) - Render them for Spectator too
    this._renderVRToolOverlays(this._camera, true);

    // DEBUG: Right Controller Matrix Analysis
    if (this._vrControllerRight && this._vrControllerRight.getMatrix()) {
      if (!this._debugFrameCount) this._debugFrameCount = 0;
      if (this._debugFrameCount++ % 120 === 0) {
        const m = this._vrControllerRight.getMatrix();
        const p = vec3.create();
        const q = quat.create();
        const s = vec3.create();
        mat4.getTranslation(p, m);
        mat4.getRotation(q, m);
        mat4.getScaling(s, m);
        const euler = vec3.create();
        // simple euler approx
        // console.log(`Right: P:[${p[0].toFixed(2)},${p[1].toFixed(2)},${p[2].toFixed(2)}] S:[${s[0].toFixed(2)}]`);
      }
    }

    // (post opaque pass)
    for (i = 0; i < nbMeshes; ++i) {
      if (meshes[i].isTransparent()) break;
      meshes[i].render(this);
    }
    var startTransparent = i;
    if (this._meshPreview) this._meshPreview.render(this);

    // background
    if (this._background) this._background.render();

    ///////////////
    // TRANSPARENT PASS
    ///////////////
    if (this._rttTransparent) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._rttTransparent.getFramebuffer());
      gl.clear(gl.COLOR_BUFFER_BIT);
    }

    gl.enable(gl.BLEND);

    // wireframe for dynamic mesh has duplicate edges
    gl.depthFunc(gl.LESS);
    for (i = 0; i < nbMeshes; ++i) {
      if (meshes[i].getShowWireframe())
        meshes[i].renderWireframe(this);
    }
    gl.depthFunc(gl.LEQUAL);

    gl.depthMask(false);
    gl.enable(gl.CULL_FACE);

    for (i = startTransparent; i < nbMeshes; ++i) {
      gl.cullFace(gl.FRONT); // draw back first
      meshes[i].render(this);
      gl.cullFace(gl.BACK); // ... and then front
      meshes[i].render(this);
    }

    gl.disable(gl.CULL_FACE);

    ///////////////
    // CONTOUR 2/2
    ///////////////
    if (showContour && this._rttContour) {
      this._rttContour.render(this);
    }

    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  /** Pre compute matrices and sort meshes */
  updateMatricesAndSort() {
    var meshes = this._meshes;
    var cam = this._camera;
    if (meshes.length > 0) {
      cam.optimizeNearFar(this.computeBoundingBoxScene());
    }

    for (var i = 0, nb = meshes.length; i < nb; ++i) {
      meshes[i].updateMatrices(cam);
    }

    meshes.sort(Mesh.sortFunction);

    if (this._meshPreview) this._meshPreview.updateMatrices(cam);
    if (this._grid) this._grid.updateMatrices(cam);
  }

  initWebGL() {
    var attributes = {
      antialias: true,
      stencil: true,
      alpha: false,
      xrCompatible: true // Enable WebXR compatibility
    };

    var canvas = document.getElementById('canvas');
    var gl = this._gl = canvas.getContext('webgl', attributes) || canvas.getContext('experimental-webgl', attributes);
    if (!gl) {
      window.alert('Could not initialise WebGL. No WebGL, no SculptGL. Sorry.');
      return;
    }

    WebGLCaps.initWebGLExtensions(gl);
    if (!WebGLCaps.getWebGLExtension('OES_element_index_uint'))
      RenderData.ONLY_DRAW_ARRAYS = true;

    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);

    gl.disable(gl.CULL_FACE);
    gl.frontFace(gl.CCW);
    gl.cullFace(gl.BACK);

    gl.disable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    gl.disable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);

    gl.clearColor(0.0, 0.0, 0.0, 0.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }

  /** Load textures (preload) */
  loadTextures() {
    var self = this;
    var gl = this._gl;
    var ShaderMatcap = ShaderLib[Enums.Shader.MATCAP];

    var loadTex = function (path, idMaterial) {
      var mat = new Image();
      mat.src = path;

      mat.onload = function () {
        ShaderMatcap.createTexture(gl, mat, idMaterial);
        self.render();
      };
    };

    for (var i = 0, mats = ShaderMatcap.matcaps, l = mats.length; i < l; ++i)
      loadTex(mats[i].path, i);

    this.initAlphaTextures();
  }

  initAlphaTextures() {
    var alphas = Picking.INIT_ALPHAS_PATHS;
    var names = Picking.INIT_ALPHAS_NAMES;
    for (var i = 0, nbA = alphas.length; i < nbA; ++i) {
      var am = new Image();
      am.src = 'resources/alpha/' + alphas[i];
      am.onload = this.onLoadAlphaImage.bind(this, am, names[i]);
    }
  }

  /** Called when the window is resized */
  onCanvasResize() {
    var viewport = this._viewport;
    var newWidth = viewport.clientWidth * this._pixelRatio;
    var newHeight = viewport.clientHeight * this._pixelRatio;

    this._canvasOffsetLeft = viewport.offsetLeft;
    this._canvasOffsetTop = viewport.offsetTop;
    this._canvasWidth = newWidth;
    this._canvasHeight = newHeight;

    this._canvas.width = newWidth;
    this._canvas.height = newHeight;

    this._gl.viewport(0, 0, newWidth, newHeight);
    this._camera.onResize(newWidth, newHeight);
    this._background.onResize(newWidth, newHeight);

    this._rttContour.onResize(newWidth, newHeight);
    this._rttMerge.onResize(newWidth, newHeight);
    this._rttOpaque.onResize(newWidth, newHeight);
    this._rttTransparent.onResize(newWidth, newHeight);

    this.render();
  }

  computeRadiusFromBoundingBox(box) {
    var dx = box[3] - box[0];
    var dy = box[4] - box[1];
    var dz = box[5] - box[2];
    return 0.5 * Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  computeBoundingBoxMeshes(meshes) {
    var bound = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (var i = 0, l = meshes.length; i < l; ++i) {
      if (!meshes[i].isVisible()) continue;
      var bi = meshes[i].computeWorldBound();
      if (bi[0] < bound[0]) bound[0] = bi[0];
      if (bi[1] < bound[1]) bound[1] = bi[1];
      if (bi[2] < bound[2]) bound[2] = bi[2];
      if (bi[3] > bound[3]) bound[3] = bi[3];
      if (bi[4] > bound[4]) bound[4] = bi[4];
      if (bi[5] > bound[5]) bound[5] = bi[5];
    }
    return bound;
  }

  computeBoundingBoxScene() {
    var scene = this._meshes.slice();
    if (this._grid) scene.push(this._grid);
    if (this._sculptManager) this._sculptManager.addSculptToScene(scene);
    return this.computeBoundingBoxMeshes(scene);
  }

  normalizeAndCenterMeshes(meshes) {
    var box = this.computeBoundingBoxMeshes(meshes);
    var scale = Utils.SCALE / vec3.dist([box[0], box[1], box[2]], [box[3], box[4], box[5]]);

    var mCen = mat4.create();
    mat4.scale(mCen, mCen, [scale, scale, scale]);
    mat4.translate(mCen, mCen, [-(box[0] + box[3]) * 0.5, -(box[1] + box[4]) * 0.5, -(box[2] + box[5]) * 0.5]);

    for (var i = 0, l = meshes.length; i < l; ++i) {
      var mat = meshes[i].getMatrix();
      mat4.mul(mat, mCen, mat);
    }
  }

  addSphere() {
    // make a cube and subdivide it
    var mesh = new Multimesh(Primitives.createCube(this._gl));
    mesh.normalizeSize();
    this.subdivideClamp(mesh);

    // Use Matcap (Better Performance on Mobile VR)
    mesh.setShaderType(Enums.Shader.MATCAP);

    this.addNewMesh(mesh);
    return mesh;
  }

  addCube() {
    var mesh = new Multimesh(Primitives.createCube(this._gl));
    mesh.normalizeSize();
    mat4.scale(mesh.getMatrix(), mesh.getMatrix(), [0.7, 0.7, 0.7]);
    this.subdivideClamp(mesh, true);
    return this.addNewMesh(mesh);
  }

  addCylinder() {
    var mesh = new Multimesh(Primitives.createCylinder(this._gl));
    mesh.normalizeSize();
    mat4.scale(mesh.getMatrix(), mesh.getMatrix(), [0.7, 0.7, 0.7]);
    this.subdivideClamp(mesh);
    return this.addNewMesh(mesh);
  }

  addTorus(preview) {
    var mesh = new Multimesh(Primitives.createTorus(this._gl, this._torusLength, this._torusWidth, this._torusRadius, this._torusRadial, this._torusTubular));
    if (preview) {
      mesh.setShowWireframe(true);
      var scale = 0.3 * Utils.SCALE;
      mat4.scale(mesh.getMatrix(), mesh.getMatrix(), [scale, scale, scale]);
      this._meshPreview = mesh;
      return;
    }
    mesh.normalizeSize();
    this.subdivideClamp(mesh);
    this.addNewMesh(mesh);
  }

  subdivideClamp(mesh, linear) {
    Subdivision.LINEAR = !!linear;
    while (mesh.getNbFaces() < 50000)
      mesh.addLevel();
    // keep at max 4 multires
    mesh._meshes.splice(0, Math.min(mesh._meshes.length - 4, 4));
    mesh._sel = mesh._meshes.length - 1;
    Subdivision.LINEAR = false;
  }

  addNewMesh(mesh) {
    this._meshes.push(mesh);
    this._stateManager.pushStateAdd(mesh);
    this.setMesh(mesh);
    return mesh;
  }

  loadScene(fileData, fileType) {
    var newMeshes;
    if (fileType === 'obj') newMeshes = Import.importOBJ(fileData, this._gl);
    else if (fileType === 'sgl') newMeshes = Import.importSGL(fileData, this._gl, this);
    else if (fileType === 'stl') newMeshes = Import.importSTL(fileData, this._gl);
    else if (fileType === 'ply') newMeshes = Import.importPLY(fileData, this._gl);

    var nbNewMeshes = newMeshes.length;
    if (nbNewMeshes === 0) {
      return;
    }

    var meshes = this._meshes;
    for (var i = 0; i < nbNewMeshes; ++i) {
      var mesh = newMeshes[i] = new Multimesh(newMeshes[i]);

      if (!this._vertexSRGB && mesh.getColors()) {
        Utils.convertArrayVec3toSRGB(mesh.getColors());
      }

      mesh.init();
      mesh.initRender();
      meshes.push(mesh);
    }

    if (this._autoMatrix) {
      this.normalizeAndCenterMeshes(newMeshes);
    }

    this._stateManager.pushStateAdd(newMeshes);
    this.setMesh(meshes[meshes.length - 1]);
    this.resetCameraMeshes(newMeshes);
    return newMeshes;
  }

  clearScene() {
    this.getStateManager().reset();
    this.getMeshes().length = 0;
    this.getCamera().resetView();
    this.setMesh(null);
    this._action = Enums.Action.NOTHING;
  }

  deleteCurrentSelection() {
    if (!this._mesh)
      return;

    this.removeMeshes(this._selectMeshes);
    this._stateManager.pushStateRemove(this._selectMeshes.slice());
    this._selectMeshes.length = 0;
    this.setMesh(null);
  }

  removeMeshes(rm) {
    var meshes = this._meshes;
    for (var i = 0; i < rm.length; ++i)
      meshes.splice(this.getIndexMesh(rm[i]), 1);
  }

  getIndexMesh(mesh, select) {
    var meshes = select ? this._selectMeshes : this._meshes;
    var id = mesh.getID();
    for (var i = 0, nbMeshes = meshes.length; i < nbMeshes; ++i) {
      var testMesh = meshes[i];
      if (testMesh === mesh || testMesh.getID() === id)
        return i;
    }
    return -1;
  }

  getIndexSelectMesh(mesh) {
    return this.getIndexMesh(mesh, true);
  }

  /** Replace a mesh in the scene */
  replaceMesh(mesh, newMesh) {
    var index = this.getIndexMesh(mesh);
    if (index >= 0) this._meshes[index] = newMesh;
    if (this._mesh === mesh) this.setMesh(newMesh);
  }

  duplicateSelection() {
    var meshes = this._selectMeshes.slice();
    var mesh = null;
    for (var i = 0; i < meshes.length; ++i) {
      mesh = meshes[i];
      var copy = new MeshStatic(mesh.getGL());
      copy.copyData(mesh);

      this.addNewMesh(copy);
    }

    this.setMesh(mesh);
  }

  onLoadAlphaImage(img, name, tool) {
    var can = document.createElement('canvas');
    can.width = img.width;
    can.height = img.height;

    var ctx = can.getContext('2d');
    ctx.drawImage(img, 0, 0);
    var u8rgba = ctx.getImageData(0, 0, img.width, img.height).data;
    var u8lum = u8rgba.subarray(0, u8rgba.length / 4);
    for (var i = 0, j = 0, n = u8lum.length; i < n; ++i, j += 4)
      u8lum[i] = Math.round((u8rgba[j] + u8rgba[j + 1] + u8rgba[j + 2]) / 3);

    name = Picking.addAlpha(u8lum, img.width, img.height, name)._name;

    var entry = {};
    entry[name] = name;
    this.getGui().addAlphaOptions(entry);
    if (tool && tool._ctrlAlpha)
      tool._ctrlAlpha.setValue(name);
  }

  enterXR(session) {
    this._xrSession = session;
    session.addEventListener('end', this.onXREnd.bind(this));

    // Force Init Controllers & Menu IMMEDIATELY
    this.initVRControllers();

    const gl = this._gl;

    // Helper to try spaces in order
    const requestRefSpace = (spaces) => {
      if (spaces.length === 0) return Promise.reject("No supported reference space found");
      const space = spaces[0];
      return session.requestReferenceSpace(space)
        .then(refSpace => {
          console.log(`XR: using reference space '${space}'`);
          return refSpace;
        })
        .catch(e => {
          console.warn(`XR: '${space}' failed, trying next...`);
          return requestRefSpace(spaces.slice(1));
        });
    };

    // Ensure context is compatible
    gl.makeXRCompatible().then(() => {
        const baseLayer = new XRWebGLLayer(session, gl);
        session.updateRenderState({ baseLayer });

      // Try 'local-floor' -> 'local' -> 'viewer'
      requestRefSpace(['local-floor', 'local', 'viewer'])
        .then((refSpace) => {
          this._baseRefSpace = refSpace;

          // If the slider has a value, apply it
          this.updateVROffsets();

          this._logThrottle = 0;
          session.requestAnimationFrame(this.onXRFrame.bind(this));
        })
        .catch((e) => {
          console.error("enterXR Critical Error: Failed to get reference space", e);
          if (window.screenLog) window.screenLog(`XR Error: ${e}`, "red");
          session.end(); // Exit session if we can't get a space
        });
    }).catch((err) => {
      console.error("enterXR: makeXRCompatible failed!", err);
      if (window.screenLog) window.screenLog(`XR Error: makeXRCompatible ${err}`, "red");
    });

    this._preventRender = true;
  }

  updateVROffsets() {
    if (!this._baseRefSpace) return;

    // Hardcoded offsets (cleaner UI)
    const valZ = 0.4;
    const valY = -1.2; // -1.2 puts floor 1.2m below (approx seated/standing)

    // We want to move the "origin" relative to the user.
    // Using simple offset on Y and Z.
    // XRRigidTransform(position, orientation)
    // To move scene UP, we shift reference space DOWN?
    // Or we shift origin... let's try direct translation.
    // If I want the scene to be HIGHER, I need the floor to be lower relative to me?
    // Actually, usually negative Y moves the reference space down (so I feel higher).
    // Positive Y moves reference space up (so I feel lower).
    // Let's assume Y slider = "Scene Height".
    // If I increase Y, scene goes up.

    // 1. View Reference Space Handling (Initial Pivot)   // "result = base * offset" ?
    // "viewer_in_base = viewer_in_offset * offset_inverse" ?
    // Documentation says: getOffsetReferenceSpace(originOffset)
    // "Creates a new reference space where the origin is offset from the created reference space by the specified transformation."
    // origin_new = origin_old * transform

    // Let's just try mapping directly.
    // offsetZ moves Forward/Back?
    // offsetY moves Up/Down.

    const offset = new XRRigidTransform({ x: 0, y: -valY, z: -valZ });
    // Negating because usually we think "Move Scene Back" (negative Z) or "Move Scene Down" (negative Y)
    // But let's verify behavior. Z=0.5 was "lift scene"?
    // User said "sphere is too low below me". So they want to lift scene (Y+).
    // If valY is positive, and we use -valY, origin moves DOWN.
    // Which means viewer (at 0) is relatively HIGHER.
    // Wait. If Origin moves DOWN, then content (at Origin) moves DOWN.
    // So to lift scene, we need Positive Y offset?
    // Let's stick to -valY and see. If slider is "Height", maybe we want +valY.
    // I'll assume slider is "Viewer Height".
    // If I increase "Viewer Height", I go UP, scene goes DOWN.
    // So -valY makes sense for "Viewer Height".

    this._xrRefSpace = this._baseRefSpace.getOffsetReferenceSpace(offset);

    // Apply accumulated world nav
    if (this._xrWorldOffset) {
      // Tracking Debug (Throttled)
      if (this._logThrottle % 60 === 0 && this._vrControllerPos) {
        const p = this._vrControllerPos; // Vec3
        // if (window.screenLog) window.screenLog(`Pos: ${p[0].toFixed(2)},${p[1].toFixed(2)},${p[2].toFixed(2)}`, "yellow");
      }
      // Compose offsets? 
      // We want: Base -> InitialOffset -> WorldNav
      // But getOffsetReferenceSpace takes an XRRigidTransform.
      // We can chain them.
      this._xrRefSpace = this._xrRefSpace.getOffsetReferenceSpace(this._xrWorldOffset);
    }
  }

  moveWorld(delta) {
    if (!this._baseRefSpace) return;

    // Delta is vec3 [dx, dy, dz] in World Space.
    // We want to move World by Delta.
    // E.g. pulling world towards me (+Z).
    // Means RefSpace Origin moves +Z.

    // We need to ACCUMULATE this delta into a transform.
    if (!this._xrWorldOffset) {
      this._xrWorldOffset = new XRRigidTransform({ x: 0, y: 0, z: 0 });
    }

    // Current position
    let pos = this._xrWorldOffset.position;

    // Create new position
    // NOTE: transform.position is ReadOnly usually.
    // We must create a new transform.

    let newPos = {
      x: pos.x + delta[0],
      y: pos.y + delta[1],
      z: pos.z + delta[2],
      w: 1.0 // not needed for dict
    };

    this._xrWorldOffset = new XRRigidTransform(newPos, this._xrWorldOffset.orientation);

    // Re-apply
    this.updateVROffsets();
  }

  onXREnd() {
    this._xrSession = null;
    this._xrRefSpace = null;
    this._preventRender = false;

    this._vrControllerLeft = null;
    this._vrControllerRight = null;
    this.initVRControllers();

    this.render();
  }

  initVRControllers() {
    // Simple 5cm cube for controllers (Placeholder)
    var gl = this._gl;
    if (!gl) return; // Wait for GL

    // Helper to make a mesh
    const makeCtrl = (color) => {
      var mesh = new Multimesh(Primitives.createCube(gl));
      mesh.normalizeSize();
      // Start Hidden (Scale 0)
      mat4.scale(mesh.getMatrix(), mat4.create(), [0.0, 0.0, 0.0]);

      mesh.setShaderType(Enums.Shader.FLAT);
      mesh.setFlatColor(color);
      mesh.isPlaceholder = true;
      mesh.init();
      mesh.initRender();
      return mesh;
    };

    if (Primitives) {
      if (!this._vrControllerLeft) {
        this._vrControllerLeft = makeCtrl([0.0, 1.0, 0.0]); // GREEN
        this.loadVRController('left');
      }
      if (!this._vrControllerRight) {
        this._vrControllerRight = makeCtrl([0.0, 0.0, 1.0]); // BLUE
        this.loadVRController('right');
      }
      // if (window.screenLog) window.screenLog("Created Controllers (Loading Models...)", "lime");
    }

    // Init VR Menu System
    if (!this._guiXR) this._guiXR = new GuiXR(this);
    this._guiXR.init(this._gl);
    if (!this._vrMenu) this._vrMenu = new VRMenu(this._gl, this._guiXR);
    if (!this._vrLaser) this._vrLaser = new VRLaser(this._gl);

    // Brush Tip (Pencil Cone)
    if (!this._vrControllerTip) {
      // Cylinder: Top=0 (Point), Bottom=5mm, Height=5cm
      var mesh = new Multimesh(Primitives.createCylinder(this._gl, 0.0, 0.005, 0.05, 16));
      // Do NOT normalize size, rely on explicit dimensions
      // mesh.normalizeSize(); 

      const mat = mesh.getMatrix();
      mat4.identity(mat);

      // 1. Rotate so +Y becomes -Z
      mat4.rotateX(mat, mat, -Math.PI / 2);

      // 2. Translate along Y (which maps to -Z) so Base moves to 0
      const offY = this._isQuestStandalone ? 0.075 : 0.025;
      mat4.translate(mat, mat, [0, offY, 0]);

      mesh.setShaderType(Enums.Shader.FLAT);
      mesh.setFlatColor([0.3, 0.3, 0.3]); // Dark Gray
      mesh.init();
      mesh.initRender();
      this._vrControllerTip = mesh;
    }

    // Brush Radius Sphere (Semi-transparent)
    // Brush Radius Sphere (Semi-transparent)
    if (!this._vrBrushRadiusSphere) {
      // High Res (64x64), Radius 1.0 (to match Selection Ring size)
      // Use MeshStatic directly (Primitives returns MeshStatic) - Avoid Multimesh overhead/issues
      // High Res (64x64), Radius 1.0 (to match Selection Ring size)
      var meshS = Primitives.createSphere(this._gl, 1.0, 64, 64);

      meshS.setShaderType(Enums.Shader.UNLIT);
      // For Additive Blending (ONE, ONE), the RGB values control brightness/opacity directly.
      // 0.2 = 20% Additive Glow
      meshS.setFlatColor([0.2, 0.2, 0.2]);
      meshS.setOpacity(1.0); // Opacity unused in additive logic with pre-dimmed color, but keep 1.0
      meshS.init();
      meshS.initRender();
      this._vrBrushRadiusSphere = meshS;
    }
  }

  loadVRController(handedness) {
    // URL must be relative to the page (root)
    // Files are in src/resources/controllers/
    // Switched to PLY for robustness/efficiency
    const url = `src/resources/controllers/controller_${handedness}.ply`;

    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'text'; // PLY is ASCII now

    xhr.onload = function () {
      if (xhr.status === 200) {
        // Ensure Import is defined
        if (typeof Import === 'undefined') {
          if (window.screenLog) window.screenLog("CRITICAL: Import module not found!", "red");
          return;
        }

        try {
          // Log header for debug
          var headerPreview = xhr.response ? xhr.response.substring(0, 50).replace(/\n/g, '\\n') : "null";
          // console.log(`PLY Header (${handedness}): ${headerPreview}`);

          var meshes = Import.importPLY(xhr.response, this._gl);
          if (meshes && meshes.length > 0) {
            // Validate mesh has vertices
            if (meshes[0].getNbVertices() > 0) {
              var mesh = meshes[0];

              mesh.init(); // Compute normals/topology first

              // [USER REQUEST] Matte/Lambert shading (PBR)
              mesh.setShaderType(Enums.Shader.PBR);
              mesh.setAlbedo([0.5, 0.5, 0.5]); // Lighter Gray
              mesh.setRoughness(0.8); // Matte
              mesh.setMetallic(0.0);  // Plastic/Rubber

              mesh.initRender();
              mesh.isPlaceholder = false;

              // Replace Reference
              if (handedness === 'left') this._vrControllerLeft = mesh;
              else this._vrControllerRight = mesh;

              // if (window.screenLog) window.screenLog(`Loaded ${handedness} Controller (PLY)`, "lime");
            } else {
              if (window.screenLog) window.screenLog(`Empty mesh for ${handedness}`, "orange");
            }
          } else {
            if (window.screenLog) window.screenLog(`ImportPLY returned no meshes for ${handedness}`, "orange");
          }
        } catch (e) {
          console.error(e);
          if (window.screenLog) {
            window.screenLog(`Error parsing ${handedness}: ${e.message}`, "red");
            window.screenLog(`Stack: ${e.stack}`, "orange");
          }
        }
      } else {
        console.warn(`Controller load failed: ${url}`);
        if (window.screenLog) window.screenLog(`Failed to load ${handedness} controller (404)`, "red");
      }
    }.bind(this);
    xhr.onerror = function () {
      if (window.screenLog) window.screenLog(`Network Error loading ${handedness} controller`, "red");
    };
    xhr.send(null);
  }

  // EXPERIMENTAL: Desktop 6DOF Mode (Manual Grip Control)
  // No auto-calibration. User grabs world to position camera.

  updateVRControllerPose(handedness, position, orientation) {
    var mesh = handedness === 'left' ? this._vrControllerLeft : this._vrControllerRight;
    if (!mesh) return;

    // Fix: gl-matrix expects Arrays, but WebXR gives DOMPoints.
    const pos = [position.x, position.y, position.z];
    const rot = [orientation.x, orientation.y, orientation.z, orientation.w];

    // --- DESKTOP 6DOF MAPPING (VISUALS ONLY) ---
    // In Desktop Mode, we might want to just show the controllers "as is" or relative to camera?
    // Actually, if we are moving the CAMERA, the controllers should just be where they are in world space.
    // The previous logic was re-mapping controllers to "Screen Space".
    // If we abandon that and just move the camera, we should probably just render controllers in World Space
    // (which might be usually out of view if camera is far?).
    // User said: "adjust the mesh to suit the updated pov".
    // So we assume the user finds the controllers with the camera or brings them into view.
    // However, to make it usable, we still need to see the controllers relative to the mesh.
    // Let's just render them normally for now. The "Desktop 6DOF" mapping was mostly for the "Cursor" anyway.

    var mat = mesh.getMatrix();
    mat4.fromRotationTranslation(mat, rot, pos);

    // Scale Logic
    const scale = mesh.isPlaceholder ? 0.02 : 1.0;
    mat4.scale(mat, mat, [scale, scale, scale]);
  }

  // ... (lines 1650-2160 unchanged) ...

  handleXRInput(frame, refSpace) {
  // ... (unchanged parts) ...
  // Note: I need to ensure I don't accidentally cut huge chunks.
  // I will use multi_replace for safety if I can't match big blocks.
  // But replace_file_content is requested.
  // I will try to target specific methods.
  }



  initDebugCursor() {
    var gl = this._gl;
    if (!gl) return;

    this._debugCursor = new Multimesh(Primitives.createCube(gl));
    this._debugCursor.normalizeSize();

    // Initialize "in the abyss" to prevent initial visual glitch
    mat4.translate(this._debugCursor.getMatrix(), mat4.create(), [0, -9999, 0]);
    this._debugCursor.setVisible(false);

    this._debugCursor.setShaderType(Enums.Shader.FLAT);
    this._debugCursor.setFlatColor([1.0, 1.0, 0.0]); // YELLOW

    this._debugCursor.init();
    this._debugCursor.initRender();

    // Calibration Cube (Green)
    this._debugCalibrationCube = Primitives.createCube(gl);
    this._debugCalibrationCube.normalizeSize(); // Size 1.0 (MeshStatic doesn't have normalizeSize? Wait, Check MeshStatic)
    // Actually Primitives.createCube returns MeshStatic, which inherits Mesh.
    // Mesh doesn't have normalizeSize. Multimesh has it?
    // Let's check Utils or just scale manually. Primitives.createCube(gl) returns unit cube (-0.5 to 0.5) by default.
    // So default size IS 1.0. No need to normalize.

    mat4.translate(this._debugCalibrationCube.getMatrix(), mat4.create(), [0, -9999, 0]); // Hide initially
    this._debugCalibrationCube.setShaderType(Enums.Shader.FLAT);
    this._debugCalibrationCube.setFlatColor([0.0, 1.0, 0.0]); // Green
    this._debugCalibrationCube.init();
    this._debugCalibrationCube.initRender();

    // Headset Cube (Orange)
    this._debugHeadsetCube = Primitives.createCube(gl);
    mat4.translate(this._debugHeadsetCube.getMatrix(), mat4.create(), [0, -9999, 0]);
    this._debugHeadsetCube.setShaderType(Enums.Shader.FLAT);
    this._debugHeadsetCube.setFlatColor([1.0, 0.5, 0.0]); // Orange
    this._debugHeadsetCube.init();
    this._debugHeadsetCube.initRender(); // Don't forget initRender!
  }

  updateDebugCursor(pos, active) {
    if (!this._debugCursor) this.initDebugCursor();
    if (!this._debugCursor) return;

    if (active && pos) {
      if (!this._debugCursor.isVisible()) {
        this._debugCursor.setVisible(true);
      }
      var mat = this._debugCursor.getMatrix();
      mat4.identity(mat);
      mat4.translate(mat, mat, pos);
      mat4.scale(mat, mat, [0.01, 0.01, 0.01]);
    } else {
      if (this._debugCursor.isVisible()) {
        this._debugCursor.setVisible(false);
      }
    }
  }

  updateDebugPivot(pos, active) {
    // NUKED
  }

  _drawSceneVR() {
    var gl = this._gl;
    gl.enable(gl.DEPTH_TEST);

    // grid
    if (this._showGrid) this._grid.render(this);

    // VR Controllers
    if (this._vrControllerLeft) this._vrControllerLeft.render(this);
    if (this._vrControllerRight) this._vrControllerRight.render(this);

    // Debug Cursor
    if (this._debugCursor && this._debugCursor.isVisible()) this._debugCursor.render(this);
    // Calibration Cube (Green) - Disable Depth Test to ensure visibility
    if (this._debugCalibrationCube) {
      gl.disable(gl.DEPTH_TEST);
      this._debugCalibrationCube.render(this);
      gl.enable(gl.DEPTH_TEST);
    }

    // Headset Cube (Orange)
    if (this._debugHeadsetCube) {
      gl.disable(gl.DEPTH_TEST);
      this._debugHeadsetCube.render(this);
      gl.enable(gl.DEPTH_TEST);
    }

    // Debug Pivot (Pink Cube)
    if (this._debugPivotMesh && this._debugPivotMesh.isVisible()) {
      gl.disable(gl.DEPTH_TEST);
      this._debugPivotMesh.render(this);
      gl.enable(gl.DEPTH_TEST);
    }

    // Meshes
    // Just render opaque meshes for now
    var meshes = this._meshes;
    for (var i = 0, l = meshes.length; i < l; ++i) {
      if (!meshes[i].isVisible()) continue;
      meshes[i].render(this);
    }
  }

  updateDebugPivot(pos, active) {
    // NUKED: Debug Cube Forbidden
  }

  onXRFrame(time, frame) {
    const session = frame.session;
    session.requestAnimationFrame(this.onXRFrame.bind(this));

    // Force use of Base Ref Space (Local Floor) to debug "Flying Cube"
    const refSpace = this._baseRefSpace;

    // EXPERIMENTAL: Desktop 6DOF Mode
    // RefSpace rotation removed. User should use Mouse Orbit to position camera.

    const pose = frame.getViewerPose(refSpace);
    this._latestViewerPose = pose; // Capture for updateVRControllerPose

    // Update Headset Cube (Orange)
    if (this._debugHeadsetCube && pose) {
      const mat = this._debugHeadsetCube.getMatrix();
      mat4.identity(mat);
      mat4.translate(mat, mat, [pose.transform.position.x, pose.transform.position.y, pose.transform.position.z]);
      mat4.scale(mat, mat, [0.01, 0.01, 0.01]); // 1cm Cube (Headset)
    }

    if (pose) {
      const gl = this._gl;
      const glLayer = session.renderState.baseLayer;
      gl.bindFramebuffer(gl.FRAMEBUFFER, glLayer.framebuffer);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      // VR Menu Update (Sync with Frame)
      if (this._guiXR) this._guiXR.update();

      // Handle Input (PoC placeholder)
      if (typeof this.handleXRInput === 'function') {
        try {
          this.handleXRInput(frame, refSpace);
        } catch (e) {
          console.error("XR Input Error:", e);
        }
      }

      // Render to WebXR framebuffer
      this.renderVR(glLayer, pose, frame, refSpace);

      // --- EXPERIMENTAL: Desktop 6DOF Mode (Spectator Mirror) ---
      // Render to Canvas (Desktop View) using the Orbit Camera

      // 1. Unbind VR Framebuffer
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      // 2. Reset Viewport
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);

      // 3. Render Desktop View (Synchronous)
      // FORCE RESET CAMERA to Desktop View (Undo VR overrides)
      this._camera.updateProjection();
      this._camera.updateView();

      // Use applyRender to ensure Post-Processing (FXAA, etc) composite to screen
      this.applyRender(null);

      // 4. Render VR Overlays (Brush Tip, Menu, etc) on top of Desktop View
      // Using desktop camera (this._camera)
      // ALREADY CALLED in applyRender() -> _drawScene() -> _renderVRToolOverlays(..., true)

      // Update Calibration Timer
      if (this._desktopInputPending) {
        if (this._desktopCalibrationTimer > 0) {
          this._desktopCalibrationTimer -= frame.predictedDisplayTime ? (frame.predictedDisplayTime.delta || 0.016) : 0.016; // Approx
          // Actually frame doesn't have delta easily, use raw time diff if available, 
          // but for now 60Hz approx decrement is fine or use this._time
          // Better: just decrement by roughly 1/60 or use passed `time` diff.
          // Let's rely on visual feedback in log.
          this._desktopCalibrationTimer -= 0.016;

          if (this._desktopCalibrationTimer <= 0) {
            this._generateDesktopOffset(frame, refSpace);
            this._desktopInputMode = true;
            this._desktopInputPending = false;
            if (window.screenLog) window.screenLog("Desktop 6DOF Mode: ON (Calibrated)", "lime");
          } else {
            // Feedback
            if (window.screenLog && Math.random() < 0.1) { // Throttle
              window.screenLog(`Calibrating in ${Math.ceil(this._desktopCalibrationTimer)}...`, "yellow");
            }
          }
        }
      }

      // -----------------------------------------------------------
    }
  }



  handleXRInput(frame, refSpace) {
    this._isPointingAtMenu = false;

    const session = frame.session;
    const sources = session.inputSources;
    let leftGrip = false, rightGrip = false;
    let leftOrigin = null, rightOrigin = null;
    let leftRot = null, rightRot = null;

    // Reset Menu Pointing State (Per Frame)
    this._isPointingAtMenu = false;



    for (const source of sources) {
      // DEBUG: Scan Sources
      // if (window.screenLog && this._logThrottle % 120 === 0) {
      //   window.screenLog(`Src: ${source.handedness} Grip:${!!source.gripSpace} Ray:${!!source.targetRaySpace}`, "yellow");
      // }

      if (!source.gripSpace) continue;

      if (!source.gripSpace) continue;

      // VR SHORTCUTS
      if (source.gamepad) {
        // Unique Persistent State per Controller
        if (!this._vrStateLeft) this._vrStateLeft = { axes: [] };
        if (!this._vrStateRight) this._vrStateRight = { axes: [] };

        const state = source.handedness === 'left' ? this._vrStateLeft : this._vrStateRight;
        const axes = source.gamepad.axes;

        // Thresholds
        const T_PRESS = 0.7;
        const T_RELEASE = 0.3;

        // LEFT HAND: AXIS 2 (Left/Right) - Undo/Redo
        if (source.handedness === 'left') {
          const valX = axes[2];
          const lastX = state.axes[2] || 0;

          // State Machine: Only fire if we were neutral
          const wasNeutralX = Math.abs(lastX) < T_RELEASE;
          const isPressedX = Math.abs(valX) > T_PRESS;

          if (wasNeutralX && isPressedX) {
            if (valX < -T_PRESS) {
              if (window.screenLog) window.screenLog("Shortcuts: Undo (Left Stick)", "lime");
              if (this._stateManager) {
                this._stateManager.undo();
                this._main ? this._main.render() : this.render();
              }
            } else if (valX > T_PRESS) {
              if (window.screenLog) window.screenLog("Shortcuts: Redo (Left Stick)", "lime");
              if (this._stateManager) {
                this._stateManager.redo();
                this._main ? this._main.render() : this.render();
              }
            }
          }
          state.axes[2] = valX;
        }

        // RIGHT HAND: AXIS 3 (Up/Down) - Radius +/- 5%
        if (source.handedness === 'right') {
          const valY = axes[3];
          const isPressedY = Math.abs(valY) > T_PRESS;

          // Timer for Repeat/Debounce
          const now = performance.now();
          if (!state.lastRadiusTime) state.lastRadiusTime = 0;

          if (isPressedY) {
            if (now - state.lastRadiusTime > 150) { // 150ms Repeat Rate
              state.lastRadiusTime = now;

              let change = 0.0;
              if (valY < -T_PRESS) change = 0.05; // UP -> +5%
              if (valY > T_PRESS) change = -0.05; // DOWN -> -5%

              if (change !== 0 && this._guiXR) {
                const oldVal = this._guiXR._radius;
                const newVal = Math.max(0.01, Math.min(1.0, oldVal + change));

                if (window.screenLog) window.screenLog(`Radius: ${(oldVal * 100).toFixed(0)}% -> ${(newVal * 100).toFixed(0)}%`, "yellow");

                // Use new helper to sync Widget + Texture
                this._guiXR.updateRadius(newVal);

                // Sync Tool
                if (this._sculptManager) this._sculptManager.getTool().setRadius(newVal * 100);

                // Force Render
                this._main ? this._main.render() : this.render();
              }
            }
          } else {
            // Reset timer on release (optional, allows immediate press again)
            state.lastRadiusTime = 0;
          }
          state.axes[3] = valY;
        }
      }

      // 1. Common Pose Gathering (for All Tasks)
      const worldPose = frame.getPose(source.gripSpace, refSpace);
      if (worldPose) {
        this.updateVRControllerPose(source.handedness, worldPose.transform.position, worldPose.transform.orientation);

        // Capture Unscaled Poses for Menu Attachment
        const p = worldPose.transform.position;
        const o = worldPose.transform.orientation;
        const mat = mat4.create();
        mat4.fromRotationTranslation(mat, [o.x, o.y, o.z, o.w], [p.x, p.y, p.z]);

        if (source.handedness === 'left') this._vrPoseLeft = mat;
        if (source.handedness === 'right') this._vrPoseRight = mat;
      }

      // RELIABLE POINTER MATRIX (TargetRay) for Visuals
      if (source.handedness === 'right' && source.targetRaySpace) {
        const ptrPose = frame.getPose(source.targetRaySpace, refSpace);
        if (ptrPose) {
          this._vrRightRayMatrix = ptrPose.transform.matrix;
        } else {
          this._vrRightRayMatrix = null;
        }
      }

      // 2. Menu Raycasting (Right Hand Only)
      if (source.handedness === 'right') {
        let rayPose = null;
        let isFallback = false;

        // Try Target Ray Space (Standard)
        if (source.targetRaySpace) {
          rayPose = frame.getPose(source.targetRaySpace, refSpace);
        }

        // Fallback to Grip Space (if Ray failed)
        if (!rayPose && source.gripSpace) {
          rayPose = frame.getPose(source.gripSpace, refSpace);
          isFallback = true;
        }

        if (rayPose && this._vrMenu) {
          const mat = rayPose.transform.matrix;

          let origin, dir;

          if (isFallback) {
            // Synthetic Ray from Grip (Approximate Pointing)
            // Grip usually points -Z (forward) or needs slight offset.
            // We'll use -Z for now.
            origin = vec3.fromValues(mat[12], mat[13], mat[14]);
            // Grip Z=0 is center of handle?
            // Direction: -Z column (8,9,10)
            dir = vec3.fromValues(-mat[8], -mat[9], -mat[10]);

            // Optional: Tilt ray down/up if needed? Start with straight -Z.
          } else {
            // Standard Ray
            origin = vec3.fromValues(mat[12], mat[13], mat[14]);
            dir = vec3.fromValues(-mat[8], -mat[9], -mat[10]);
          }
          vec3.normalize(dir, dir);

          const hit = this._vrMenu.intersect(origin, dir);

          // DEBUG: Log Intersection Attempts (Throttled but visible)
          // if (!this._logIntersect) this._logIntersect = 0;
          // if (this._logIntersect++ % 60 === 0 && window.screenLog) {
          // const originStr = `${origin[0].toFixed(2)},${origin[1].toFixed(2)},${origin[2].toFixed(2)}`;
          // window.screenLog(`Ray(${isFallback ? 'Grip' : 'Ray'}): [${originStr}] Hit:${!!hit}`, hit ? "lime" : "orange");
          // if (hit) window.screenLog(`Hit UV: ${hit.uv[0].toFixed(2)}, ${hit.uv[1].toFixed(2)}`, "lime");
          // }

          if (hit) {
            this._isPointingAtMenu = true;
            this._guiXR.setCursor(hit.uv[0], hit.uv[1]);

            // Interact if Trigger Pressed (Button 0)
            if (source.gamepad && source.gamepad.buttons[0]) {
              const pressed = source.gamepad.buttons[0].pressed;
              // if (pressed && window.screenLog) window.screenLog("Trigger Pressed", "cyan");
              this._guiXR.onInteract(hit.uv[0], hit.uv[1], pressed);
            }

            // Calc Laser Distance (plus overshoot)
            if (this._vrLaser) {
              this._vrLaserDistance = hit.distance + 0.05; // +5cm
            }

          } else {
            this._guiXR.setCursor(-1, -1);
            this._vrLaserDistance = 1.0; // Reset length (though invisible)
          }

        } else {
          // Log Failure
          if (window.screenLog && this._logThrottle % 120 === 0) {
            // const hasRaySpace = !!source.targetRaySpace;
            // const hasGripSpace = !!source.gripSpace;
            // const hasMenu = !!this._vrMenu;
            // window.screenLog(`Ray Fail: RaySp:${hasRaySpace} GripSp:${hasGripSpace} Menu:${hasMenu}`, "red");
          }
        }
      }

      // 3. Navigation Data (Base Space - Stable coordinates)
      // GRIP NAV: In Desktop Mode, we use this data for Camera Control.
      if (this._baseRefSpace) {
        const basePose = frame.getPose(source.gripSpace, this._baseRefSpace);
        if (basePose) {
          const originBase = [basePose.transform.position.x, basePose.transform.position.y, basePose.transform.position.z];

          // Grip Button (Button 1 or Trigger/Squeeze?)
          // Usually Button 1 is Squeeze. Button 0 is Trigger.
          const isGrip = source.gamepad && source.gamepad.buttons[1] && source.gamepad.buttons[1].pressed;

          const rot = basePose.transform.orientation; // Quaternion {x,y,z,w}
          const rotQuat = quat.fromValues(rot.x, rot.y, rot.z, rot.w);

          if (source.handedness === 'left') { leftGrip = isGrip; leftOrigin = originBase; leftRot = rotQuat; }
          if (source.handedness === 'right') { rightGrip = isGrip; rightOrigin = originBase; rightRot = rotQuat; }
        }
      }

      // 4. Stylus / Trigger Dominance
      if (source.gamepad && source.gamepad.buttons[0] && source.gamepad.buttons[0].pressed) {
        this._activeHandedness = source.handedness;
      }
    }

    // [DEBUG] Input Tracing
    if (this._debugInput && this._logThrottle % 60 === 0) {
      console.log(`[Input] Sources: ${sources.length} | DesktopMode: ${this._desktopInputMode}`);
      console.log(`[Input] Left: Grip=${leftGrip} Origin=${!!leftOrigin} Rot=${!!leftRot}`);
      console.log(`[Input] Right: Grip=${rightGrip} Origin=${!!rightOrigin} Rot=${!!rightRot}`);
    }

    // FORCE PIVOT INIT (Just in case)
    // if (!this._debugPivotMesh) this.updateDebugPivot([0, 0, 0], false);

    // 5. Dispatch Sculpting (Active Hand)
    // XRInputSourceArray is not a real array, so .find() fails.
    let activeSource = null;
    for (const s of sources) {
      if (s.handedness === 'right') { // Forced Right Hand for Stability
        activeSource = s;
        break;
      }
    }

    if (activeSource) this.processVRSculpting(activeSource, frame, refSpace);

    // Update VRLaser Matrix (Right Hand / Active Source)
    if (activeSource && this._vrLaser) {
      // Prioritize targetRaySpace (Pointer), fallback to gripSpace
      const space = activeSource.targetRaySpace || activeSource.gripSpace;
      if (space) {
        const pose = frame.getPose(space, refSpace);
        if (pose) {
          this._vrLaserMatrix = pose.transform.matrix;
        }
      }
    }

    // Sync Debug Cursor specific to Active Hand (or failing that, right hand?)
    // processVRSculpting calls updateDebugCursor internally? No.
    // Actually SculptManager calls picking.intersectionPoint which...
    // Let's check processVRSculpting in Scene.js (I need to read it or just patch it)
    // Wait, I haven't read processVRSculpting in this session.
    // It's likely near line 1300.
    // I will search for it first or just patch handleXRInput if I can.

    // 6. Dispatch Navigation (Logic Switch)
    // 6. Dispatch Navigation (Logic Switch)
    // DOUBLE GRIP LATCH: Enforce "Clean Exit"
    const bothGripped = leftGrip && rightGrip && leftOrigin && rightOrigin;

    if (bothGripped) {
      this._vrTwoHanded.latch = true;
      this.processVRTwoHanded(leftOrigin, rightOrigin);
    } else {
      this._vrTwoHanded.active = false;
      if (this.updateDebugPivot) this.updateDebugPivot(null, false);

      if (this._vrTwoHanded.latch) {
        // LATCH BUSY: Block single grip until both inputs are clearly released
        const anyGripped = leftGrip || rightGrip;
        if (!anyGripped) {
          this._vrTwoHanded.latch = false; // RELEASE LATCH
          // if (window.screenLog) window.screenLog("Double Grip Latch Released", "gray");
        }

        // Ensure single states are reset
        this._vrGrip.left.active = false;
        this._vrGrip.right.active = false;
      } else {
        // Standard Single Grip
        if (leftGrip && leftOrigin && leftRot) {
          this.processVRGripState('left', leftOrigin, leftRot);
        } else {
          this._vrGrip.left.active = false;
        }

        if (rightGrip && rightOrigin && rightRot) {
          this.processVRGripState('right', rightOrigin, rightRot);
        } else {
          this._vrGrip.right.active = false;
        }
      }
    }
  }

  processVRGripState(handedness, origin, rotation) {
    const gState = this._vrGrip[handedness];
    if (!gState.active) {
      gState.active = true;
      vec3.copy(gState.startPoint, origin);
      quat.copy(gState.startRot, rotation);
      // Capture Camera State for Desktop 6DOF
      if (this._desktopInputMode) {
        if (!gState.camTransStart) gState.camTransStart = vec3.create();
        vec3.copy(gState.camTransStart, this._camera._trans);

        gState.camRotStart = { x: this._camera._rotX, y: this._camera._rotY };
        // We might need to store view matrix too if we do fancy mapping
      }
    } else {
      // Delta in Base Space approx World Space delta if orientation aligned
      const delta = vec3.create();
      vec3.sub(delta, origin, gState.startPoint);

      if (this._desktopInputMode) {
        // --- DESKTOP 6DOF CAMERA CONTROL ---
        // Pan Camera based on Hand Delta
        // Hand moves X -> Camera moves -X (to keep object under hand)
        // OR Hand moves X -> Camera Target moves X?
        // If I grab the world and pull Right, the world moves Right.
        // The Camera stays still relative to me, but the world moves.
        // In Orbit Camera, we move the Target.
        // If World moves Right (+X), Target should move +X?
        // Let's try 1:1 mapping to Camera Target.

        // Transform Delta World -> View Space logic manually?
        // Actually Camera.translate moves Target.
        // But Camera.trans[0],[1] are technically Panning values relative to View Plane?
        // Let's look at Camera.updateView():
        // vec3.set(center, tx - off[0], ty - off[1], -off[2]);
        // tx is added to center X? No, it's set.
        // If we want to pan, we modify _trans[0], _trans[1].

        // We need to map world delta to camera plane X/Y.
        const view = this._camera.getView();
        const camRight = vec3.fromValues(view[0], view[4], view[8]);
        const camUp = vec3.fromValues(view[1], view[5], view[9]);

        // Project Delta onto Camera Basis
        const dx = vec3.dot(delta, camRight);
        const dy = vec3.dot(delta, camUp);
        // dz for zoom? 
        const dz = vec3.dot(delta, vec3.fromValues(view[2], view[6], view[10])); // View Forward is -Z column?
        // Camera Forward is -Z (row 2 of view matrix usually points BACK if LookAt)
        // gl-matrix LookAt: Z axis points from Center to Eye. (Backward)
        // So +Z in View Space is "Towards Camera".
        // If I pull hand towards me (+Z View), I want world to come closer.
        // "Zooming In" usually means decreasing distance (trans[2]).

        // Apply to Camera Trans
        // We use the start value to avoid drift?
        // Or incremental? Incremental is easier with 'delta'.
        // But gState tracks 'startPoint'.

        // Let's use incremental to avoid needing 'camTransStart' complexity if we don't restart it.
        // Wait, 'delta' is 'origin - startPoint'. That IS total delta since grab start.
        if (!gState.camTransStart) gState.camTransStart = vec3.create();

        // SCALING SENSITIVITY
        // Make sensitivity proportional to Distance (Z) to keep "screen feel" consistent.
        // If Z=100, we need larger movements. If Z=5, we need smaller.
        const dist = Math.abs(gState.camTransStart[2]);
        const S = Math.max(0.1, dist) * 2.5; // Tuned Multiplier (2.5x Distance)

        const tx = gState.camTransStart[0] - dx * S;
        const ty = gState.camTransStart[1] - dy * S;

        // Zoom: Hand +Z (Towards me/Camera) -> Zoom In?
        const tz = Math.max(0.1, gState.camTransStart[2] - dz * S);

        this._camera.setTrans([tx, ty, tz]);

        // --- ROTATION (ORBIT) ---
        // Map Hand Rotation to Camera Orbit
        if (rotation) {
          const qDelta = quat.create();
          const qInv = quat.create();
          quat.invert(qInv, gState.startRot);
          quat.multiply(qDelta, rotation, qInv); // Current * InvStart = Delta

          // WE WANT:
          // Rotate Wrist Y (Yaw) -> Orbit Camera Left/Right (RotY)
          // Rotate Wrist X (Pitch) -> Orbit Camera Up/Down (RotX)

          // Sensitivity
          const rotSensitivity = 0.55;

          // qDelta[1] -> Y Rotation (Yaw)
          // qDelta[0] -> X Rotation (Pitch)
          // Approx Angle ~= 2 * qComponent (small angles)

          const dRotY = qDelta[1] * 4.0 * rotSensitivity;
          const dRotX = qDelta[0] * 4.0 * rotSensitivity;

          // Apply to Camera using setOrbit to ensure Quaternion is updated!
          if (!gState.camRotStart) {
            gState.camRotStart = { x: this._camera._rotX, y: this._camera._rotY };
          }

          // Invert X? Usually VR pitch up -> Camera look up (or Orbit up?)
          // Orbit: dragging UP orbits DOWN? 
          // Let's try direct mapping first.
          this._camera.setOrbit(
            gState.camRotStart.x + dRotX,
            gState.camRotStart.y + dRotY
          );
        }

        this.render();

        return; // Skip standard moveWorld
      }


      // Threshold for jitter (Translation)
      if (vec3.length(delta) > 0.0001) {
        this.moveWorld([delta[0], delta[1], delta[2]]);
        vec3.copy(gState.startPoint, origin);
      }

      // Rotation Delta
      if (rotation) {
        const qDelta = quat.create();
        const qInv = quat.create();
        quat.invert(qInv, gState.startRot);
        quat.multiply(qDelta, rotation, qInv); // Current * InvStart = Delta

        // Threshold for jitter (Rotation) - ~0.1 degree
        if (Math.abs(qDelta[3] - 1.0) > 0.000001) {
          if (this._desktopInputMode) {
            // Optional: Orbit
            // Maybe simpler to just ignore rotation for now to avoid motion sickness/confusion?
            // User asked "adjust the updated pov". Usually Pan/Zoom is enough for "placing".
            // Let's stick to Pan/Zoom for single grip.
          } else {
            this.rotateWorld(qDelta, origin); // Pivot around HAND (origin)
          }
          quat.copy(gState.startRot, rotation);
        }
      }
    }
  }

  processVRTwoHanded(lOrig, rOrig) {
    const s = this._vrTwoHanded;
    const l = vec3.fromValues(...lOrig);
    const r = vec3.fromValues(...rOrig);

    const mid = vec3.create();
    vec3.lerp(mid, l, r, 0.5);

    const dist = vec3.distance(l, r);

    const vec = vec3.create();
    vec3.sub(vec, r, l);
    vec3.normalize(vec, vec);

    if (!s.active) {
      s.active = true;
      vec3.copy(s.prevMid, mid);
      s.prevDist = dist;
      vec3.copy(s.prevVec, vec);

      if (this._desktopInputMode) {
        if (!s.camTransStart) s.camTransStart = vec3.create();
        vec3.copy(s.camTransStart, this._camera._trans);
      }
      return;
    }

    if (this._desktopInputMode) {
      // --- DESKTOP 6DOF TWO-HANDED (ZOOM) ---
      // Scale -> Zoom
      if (s.prevDist > 0.05 && dist > 0.05) {
        const ratio = dist / s.prevDist;
        // Ratio > 1 (Hands moving apart) -> Zoom In? Or Scale Up?
        // Standard VR: Hands apart = Scale World Up (Object looks bigger).
        // Camera: Scale Object Up = Zoom In (Decrease Distance).
        // So Ratio > 1 -> Decrease Trans[2].
        // trans[2] = startZ / ratio?

        const currentZ = this._camera._trans[2];
        // We want to apply the ratio incrementally?
        // Or if we track from start?
        // s.prevDist is updated every frame in standard logic.
        // Let's stick to standard logic flow but apply to Camera.

        if (Math.abs(ratio - 1.0) > 0.0001) {
          const newZ = Math.max(0.1, currentZ / ratio);
          this._camera.setTrans([this._camera._trans[0], this._camera._trans[1], newZ]);
          this.render();
        }
      }

      // Pan with Midpoint?
      // Similar to single grip pan.
      // Let's implement midpoint pan for intuitive feel.
      const deltaT = vec3.create();
      vec3.sub(deltaT, mid, s.prevMid);

      if (vec3.length(deltaT) > 0.0001) {
        const view = this._camera.getView();
        const camRight = vec3.fromValues(view[0], view[4], view[8]);
        const camUp = vec3.fromValues(view[1], view[5], view[9]);
        const dx = vec3.dot(deltaT, camRight);
        const dy = vec3.dot(deltaT, camUp);
        const S = 2.0;
        const tx = this._camera._trans[0] - dx * S;
        const ty = this._camera._trans[1] - dy * S;
        this._camera.setTrans([tx, ty, this._camera._trans[2]]); // Use Updated Z here if needed
      }

      vec3.copy(s.prevMid, mid);
      s.prevDist = dist;
      vec3.copy(s.prevVec, vec);
      return;
    }

    // 1. Translation
    const deltaT = vec3.create();
    vec3.sub(deltaT, mid, s.prevMid);
    this.moveWorld([deltaT[0], deltaT[1], deltaT[2]]);

    // 2. Scaling
    // Threshold 5cm to prevent jitter when hands are too close
    if (s.prevDist > 0.05 && dist > 0.05) {
      const ratio = dist / s.prevDist;
      // Use Hand Midpoint (mid) as Pivot for Natural Zoom
      if (Math.abs(ratio - 1.0) > 0.0001) this.scaleWorld(ratio, mid);
    }

    // 3. Rotation
    const q = quat.create();
    quat.rotationTo(q, s.prevVec, vec);
    this.rotateWorld(q, mid);

    vec3.copy(s.prevMid, mid);
    s.prevDist = dist;
    vec3.copy(s.prevVec, vec);

    // Show Pink Pivot
    if (this.updateDebugPivot) {
      // if (window.screenLog && this._logThrottle % 60 === 0) {
      //   window.screenLog(`Pivot Update: ${mid[0].toFixed(2)},${mid[1].toFixed(2)},${mid[2].toFixed(2)}`, "magenta");
      // }
      this.updateDebugPivot(mid, true);
    }
  }

  scaleWorld(ratio, pivot) {
    if (this._vrScale === undefined) this._vrScale = 1.0;
    this._vrScale *= ratio;

    // Pivot Lock: If scaling around the origin (0,0,0), skip position math
    if (vec3.length(pivot) < 0.0001) return;

    if (!this._xrWorldOffset) this._xrWorldOffset = new XRRigidTransform({ x: 0, y: 1.2, z: -0.55 });

    let pos = vec3.fromValues(this._xrWorldOffset.position.x, this._xrWorldOffset.position.y, this._xrWorldOffset.position.z);
    let diff = vec3.create();
    vec3.sub(diff, pos, pivot);
    vec3.scale(diff, diff, 1.0 / ratio);
    vec3.add(pos, pivot, diff);

    this._xrWorldOffset = new XRRigidTransform({ x: pos[0], y: pos[1], z: pos[2] }, this._xrWorldOffset.orientation);
    this.updateVROffsets();
  }

  rotateWorld(qDelta, pivot) {
    if (!this._xrWorldOffset) this._xrWorldOffset = new XRRigidTransform({ x: 0, y: 1.2, z: -0.55 });

    let pos = vec3.fromValues(this._xrWorldOffset.position.x, this._xrWorldOffset.position.y, this._xrWorldOffset.position.z);
    let rot = quat.fromValues(this._xrWorldOffset.orientation.x, this._xrWorldOffset.orientation.y, this._xrWorldOffset.orientation.z, this._xrWorldOffset.orientation.w);

    // Rotate Position around Pivot
    let diff = vec3.create();
    vec3.sub(diff, pos, pivot);
    vec3.transformQuat(diff, diff, qDelta);
    vec3.add(pos, pivot, diff);

    // Rotate Orientation
    quat.multiply(rot, qDelta, rot); // Note: gl-matrix quat multiply order matters

    this._xrWorldOffset = new XRRigidTransform({ x: pos[0], y: pos[1], z: pos[2] }, { x: rot[0], y: rot[1], z: rot[2], w: rot[3] });
    this.updateVROffsets();
  }
  processVRSculpting(source, frame, refSpace) {
    const space = source.targetRaySpace || source.gripSpace;
    const pose = frame.getPose(space, refSpace);
    if (!pose) return;

    // 1. Array Strictness & Pose Extraction
    // Offset Logic: Move 'Physical Origin' 5cm forward (-Z) in Controller Space
    // We can do this by offsetting the position using orientation * offset
    const p = pose.transform.position;
    const q = pose.transform.orientation;

    // Offset Logic: Move 'Physical Origin' to the Visual Tip
    // Matches initVRControllers geometry: Center = -offY, Tip = -(offY + 0.025)
    // PCVR: -0.05 | Standalone: -0.10
    const offY = this._isQuestStandalone ? 0.075 : 0.025;
    const tipOffsetZ = -(offY + 0.025);

    // Offset Vector (0, 0, tipOffsetZ) rotated by Q
    const offset = vec3.fromValues(0, 0, tipOffsetZ);
    vec3.transformQuat(offset, offset, [q.x, q.y, q.z, q.w]);

    // physicalOrigin = p + offset
    const physicalOrigin = [
      p.x + offset[0],
      p.y + offset[1],
      p.z + offset[2]
    ];

    // const physicalOrigin = [pose.transform.position.x, pose.transform.position.y, pose.transform.position.z];

    // 2. Space Synchronization (Physical -> Model Space)
    // Model = Inv(Scale) * Inv(Rotation) * Inv(Translation) * Physical
    const vrScale = this._vrScale || 1.0;
    const invScale = 1.0 / vrScale;

    const enginePos = vec3.create();
    vec3.copy(enginePos, physicalOrigin);

    // Apply Inverse World Transform
    if (this._xrWorldOffset) {
      const t = this._xrWorldOffset.position;
      const r = this._xrWorldOffset.orientation;

      // 1. Inverse Translation (P - T)
      vec3.sub(enginePos, enginePos, [t.x, t.y, t.z]);

      // 2. Inverse Rotation (Apply Conjugate/Inverse Rotation)
      const qInv = quat.create();
      const qRot = quat.fromValues(r.x, r.y, r.z, r.w);
      quat.invert(qInv, qRot);
      vec3.transformQuat(enginePos, enginePos, qInv);
    }

    // 3. Inverse Scaling
    vec3.scale(enginePos, enginePos, invScale);

    // CRITICAL: Update shared state for SculptBase/SculptManager parity
    this._vrControllerPos = enginePos;

    // 3. Picking (Engine Space Units)
    // Radius: Prioritize Active Tool (0-100+ range) -> Normalize to 0-1+
    // Fallback to GuiXR._radius or default
    let sliderVal = (this._guiXR) ? this._guiXR._radius : 0.15;
    if (this._sculptManager) {
      const tool = this._sculptManager.getCurrentTool();
      if (tool && tool._radius !== undefined) {
        sliderVal = tool._radius / 100.0;
      }
    }
    const physicalRadius = sliderVal * 0.1; // Map to 0-10cm physical range
    const pickingRadius = physicalRadius * invScale;
    this._vrLastPhysicalRadius = physicalRadius; // Store for renderVR (Tracking Space / Meters)
    this._vrLastPickingRadius = pickingRadius; // Keep for debug/other uses

    // 2.5 Menu Guard: If pointing at menu, block sculpting
    // This requires handleXRInput to have run and set this._isPointingAtMenu

    // DEBUG LOG: Verify this logic
    if (this._isPointingAtMenu) {
      // if (window.screenLog && this._logThrottle % 60 === 0) window.screenLog("SCULPT BLOCKED (Menu Hit)", "lime");
      return;
    } else {
      // if (window.screenLog && source.gamepad.buttons[0].pressed) window.screenLog("SCULPT ALLOWED (No Menu Hit)", "red");
    }

    // 4. Picking State Synchronization (RAY CASTING)
    // Use Ray Casting for perfect alignment with Laser Pointer

    // A. Compute Ray Direction (Model Space)
    const engineDir = vec3.fromValues(0, 0, -1); // Standard Forward
    if (pose && pose.transform && pose.transform.orientation) {
      const q = pose.transform.orientation;
      const qRot = quat.fromValues(q.x, q.y, q.z, q.w);
      vec3.transformQuat(engineDir, engineDir, qRot);
    }
    // Transform Direction to Model Space (Inv Rotation only)
    if (this._xrWorldOffset) {
      const r = this._xrWorldOffset.orientation;
      const qInv = quat.create();
      const qRot = quat.fromValues(r.x, r.y, r.z, r.w);
      quat.invert(qInv, qRot);
      vec3.transformQuat(engineDir, engineDir, qInv);
    }
    vec3.normalize(engineDir, engineDir);

    // B. Compute Ray Origin (Model Space) - Start closer to controller (1cm) to avoid missing nearby surfaces
    const rayOffset = vec3.fromValues(0, 0, -0.01); // 1cm offset
    if (pose && pose.transform && pose.transform.orientation) {
      const q = pose.transform.orientation;
      vec3.transformQuat(rayOffset, rayOffset, [q.x, q.y, q.z, q.w]);
    }
    const rayOriginPhysical = [
      p.x + rayOffset[0],
      p.y + rayOffset[1],
      p.z + rayOffset[2]
    ];

    // Transform Ray Origin to Model Space
    const rayOrigin = vec3.create();
    vec3.copy(rayOrigin, rayOriginPhysical);
    if (this._xrWorldOffset) {
      const t = this._xrWorldOffset.position;
      const r = this._xrWorldOffset.orientation;
      vec3.sub(rayOrigin, rayOrigin, [t.x, t.y, t.z]);
      const qInv = quat.create();
      const qRot = quat.fromValues(r.x, r.y, r.z, r.w);
      quat.invert(qInv, qRot);
      vec3.transformQuat(rayOrigin, rayOrigin, qInv);
    }
    vec3.scale(rayOrigin, rayOrigin, invScale);

    // C. Perform Intersection
    this._picking._rWorld2 = pickingRadius * pickingRadius; // Pre-set radius squared for logic that might check it
    let picked = this._picking.intersectionRayMeshes(this._meshes, rayOrigin, engineDir);

    // DEBUG: Picking Trace
    // if (window.screenLog && this._logThrottle % 60 === 0) {
    //   const msg = `Pick:${picked ? 'YES' : 'NO'} Rad:${(pickingRadius * 100).toFixed(2)}cm`;
    //   window.screenLog(msg, picked ? "lime" : "red");
    // }

    // 5. Stroke Lifecycle (Corrected API)
    const buttons = source.gamepad.buttons;
    const isTriggerPressed = buttons[0].pressed;

    // Check if tool allows air (Voxel) to prevent snapping
    const tool = this._sculptManager.getCurrentTool();
    const allowAir = (tool && tool._allowAir === true);

    if (picked || allowAir) {
      // OVERRIDE: Ray picking usually uses screen-projected radius. We must force VR Physical Radius.
      this._picking._rWorld2 = pickingRadius * pickingRadius;

      // Sync local radius
      const mesh = this._picking.getMesh() || this.getMesh();
      if (mesh) {
        this._picking._rLocal2 = this._picking._rWorld2 / mesh.getScale2();
      }

      // DEBUG: Verify Mesh Hit
      // if (window.screenLog && this._logThrottle % 60 === 0) window.screenLog("Mesh Hit: " + mesh.getID(), "lime");

    } else {
      // Fallback: enginePos remains at the default "5cm in front" position (calculated above as physicalOrigin)
      // This allows Air Sculpting to work at a comfortable distance if enabled.
      // if (window.screenLog && this._logThrottle % 60 === 0 && source.gamepad.buttons[0].pressed) window.screenLog("No Mesh Hit (Too far?)", "grey");
    }



    // DEBUG: Cursor Drift
    // HIDDEN to prevent Red Sphere Artifacts
    if (this._debugCursor) {
    // Force Debug Cursor ON for diagnostics
      this.updateDebugCursor(enginePos, true);
    }



    // Allow Start ONLY if Picked OR Tool Allows Air (Voxel). Allow Continue ALWAYS if Trigger is held.
    const canSculpt = isTriggerPressed && (picked || this._vrSculpting || allowAir);

    if (isTriggerPressed && !canSculpt && this._logThrottle % 60 === 0 && window.screenLog) {
      // window.screenLog(`Blocked: Pick=${!!picked} Air=${allowAir} Tool=${tool ? tool.constructor.name : 'None'}`, "orange");
    }

    if (canSculpt) {
      if (!this._vrSculpting) {
        this._vrSculpting = true;

        // Deep Trace: Start Stroke
        if (window.screenLog && this._logThrottle++ % 60 === 0) {
          // window.screenLog("Sculpt: START STROKE (r=" + sliderVal.toFixed(2) + ")", "lime");
        }

        this._sculptManager.start(false);
        this._action = Enums.Action.SCULPT_EDIT;
      }
      this._sculptManager.preUpdate(); // Sync position

      // CRITICAL: pass picking to updateXR if supported, else standard update
      if (typeof this._sculptManager.updateXR === 'function') {
        // Calculate Model Direction (robustly)
        const dir = vec3.fromValues(0, 0, -1);
        if (pose && pose.transform && pose.transform.orientation) {
          const qGrip = quat.fromValues(pose.transform.orientation.x, pose.transform.orientation.y, pose.transform.orientation.z, pose.transform.orientation.w);
          vec3.transformQuat(dir, dir, qGrip);
        }

        if (this._xrWorldOffset) {
          const r2 = this._xrWorldOffset.orientation;
          const qInv2 = quat.create();
          quat.invert(qInv2, quat.fromValues(r2.x, r2.y, r2.z, r2.w));
          vec3.transformQuat(dir, dir, qInv2);
        }

        // Check for LEFT TRIGGER (Modifier)
        let isNegative = false;
        // Find left input source
        // FIX: 'sources' was undefined. Retrieve from current session.
        const session = frame.session;
        if (session && session.inputSources) {
          for (let src of session.inputSources) {
            if (src.handedness === 'left' && src.gamepad && src.gamepad.buttons[0] && src.gamepad.buttons[0].pressed) {
              isNegative = true;
              break;
            }
          }
        }

        if (isNegative && window.screenLog && this._logThrottle % 60 === 0) {
          // window.screenLog("VR: Negative Modifier!", "red");
        }

        // DEBUG: Trace Input
        if (window.screenLog && (this._logThrottle % 60 === 0)) {
          // window.screenLog(`VR Input: Src=${activeSource ? activeSource.handedness : 'null'} Trig=${isTriggerPressed} Neg=${isNegative}`, "cyan");
        }

        this._sculptManager.updateXR(this._picking, isTriggerPressed, enginePos, dir, { isNegative: isNegative });
      } else {
        if (window.screenLog) window.screenLog("Scene: No updateXR found!", "red");
        this._sculptManager.update();
      }

      // LOGS: Throttled Picking Logs (every 200ms)
      const now = performance.now();
      if (!this._lastLogTime) this._lastLogTime = 0;
      if (now - this._lastLogTime > 200 && window.screenLog) {
        this._lastLogTime = now;
        if (picked) {
          const rLocal = Math.sqrt(this._picking.getLocalRadius2());
          // window.screenLog(`PICK: YES | rLoc: ${rLocal.toFixed(3)}`, "green");
        } else {
          // window.screenLog(`PICK: NO | SearchRad: ${(pickingRadius * 4.0).toFixed(3)}`, "orange");
        }
      }

    } else {
      if (this._vrSculpting) {
        this._vrSculpting = false;
        // Deep Trace: End Stroke
        // if (window.screenLog) window.screenLog("Sculpt: END STROKE", "lime");

        this._sculptManager.end();
        this._action = Enums.Action.NOTHING;
      }
    }

    // 5. Debug Cursor (Visual Feedback)
    if (this.updateDebugCursor) {
      // Use pickingRadius (Model Space) for size
      // Default to 1cm (0.01) if undefined
      const cursorSize = (typeof pickingRadius !== 'undefined') ? pickingRadius : 0.01;

      if (picked && !allowAir) {
        const mesh = this._picking.getMesh();
        if (mesh) {
          const localInter = this._picking.getIntersectionPoint();
          const worldInter = vec3.create();
          vec3.transformMat4(worldInter, localInter, mesh.getMatrix());
          this.updateDebugCursor(worldInter, true, cursorSize);
          // Yellow for Hit
          if (this._debugCursor) this._debugCursor.setFlatColor([1.0, 1.0, 0.0]);
        }
      } else {
        // Show at Controller Tip (Red)
        this.updateDebugCursor(enginePos, true, cursorSize);
        if (this._debugCursor) this._debugCursor.setFlatColor(picked ? [1.0, 1.0, 0.0] : [1.0, 0.0, 0.0]);
      }
    }
  }

  updateDebugCursor(pos, active, radius = 0.01) {
    if (!this._debugCursor) this.initDebugCursor();
    if (!this._debugCursor) return;

    if (active && pos) {
      if (!this._debugCursor.isVisible()) {
        this._debugCursor.setVisible(true);
      }
      var mat = this._debugCursor.getMatrix();
      mat4.identity(mat);
      mat4.translate(mat, mat, pos);
      // Scale based on radius (radius is half-width, so *2 for Diameter? Or just use radius if Cube is 1.0?)
      // Let's assume we want Diameter to represent the Brush Size.
      // Brush Radius 5cm -> Diameter 10cm.
      // If Cube is 1.0 unit. We scale by 0.1.
      // So scale = radius * 2.0?
      // Let's try direct radius first, if it's too small/big we adjust.
      // The user complained it was "stuck" (maybe small?).
      // Let's use radius * 2.0 to show DIAMETER.
      const s = radius * 2.0;
      mat4.scale(mat, mat, [s, s, s]);
    } else {
      if (this._debugCursor.isVisible()) {
        this._debugCursor.setVisible(false);
      }
    }
  }

  _preventDefault(event) {
    event.preventDefault();
  }
}





export default Scene;
