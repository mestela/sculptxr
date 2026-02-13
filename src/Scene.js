import { vec3, mat4, quat } from 'gl-matrix';
import getOptionsURL from './misc/getOptionsURL.js';
import Enums from './misc/Enums.js';
import { VERSION } from './Version.js';
import Utils from './misc/Utils.js';
import SculptManager from './editing/SculptManager.js';
import Subdivision from './editing/Subdivision.js';
import Import from './files/Import.js';
import Gui from './gui/Gui.js';
import Camera from './math3d/Camera.js';
import Picking from './math3d/Picking.js';
import Background from './drawables/Background.js';
import Mesh from './mesh/Mesh.js';
import Multimesh from './mesh/multiresolution/Multimesh.js';
import Primitives from './drawables/Primitives.js';
import StateManager from './states/StateManager.js';
import RenderData from './mesh/RenderData.js';
import Rtt from './drawables/Rtt.js';
import ShaderLib from './render/ShaderLib.js';
import MeshStatic from './mesh/meshStatic/MeshStatic.js';
import WebGLCaps from './render/WebGLCaps.js';
import GuiXR from './gui/GuiXR.js';
import VRMenu from './drawables/VRMenu.js';
import VRLaser from './drawables/VRLaser.js';


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

    // [DESKTOP 6DOF] Spectator Camera State
    this._desktopOffsetMode = true; // Default ON (Zero Offset)
    this._desktopOffset = [0.0, 0.0, 0.0]; // Fixed Offset (0,0,0)
    this._desktopRotation = quat.create(); // Rotation
    this._isCalibratingSpectator = false; // "Move Me" Mode

    this._activeHandedness = 'right';
    this._vrScale = 0.008; // Scale 100-unit world to 0.8 meters (User Req: "25% too big")
    this._exposure = 1.0; // Reset to 1.0 after fixing ShaderMerge 5x boost

    this._vrGrip = {
      left: { active: false, startPoint: vec3.create(), startRotation: quat.create() },
      right: { active: false, startPoint: vec3.create(), startRotation: quat.create() }
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

    // Desktop 6DOF Offset (Spectator Camera)
    this._desktopOffsetMode = false;
    // Offset relative to HMD: [x, y, z] in meters.
    // User Request: "Move forward 50cm, up 50cm".
    // Note: If HMD is facing User, "Forward" is towards User.
    // If we Rotate 180, we are looking effectively "Standard Forward".
    this._desktopOffset = vec3.fromValues(0.0, 0.0, 0.0);

    // [Step 1] Hand Swap Feature
    this._dominantHand = 'right'; // 'right' or 'left'
    this._selectionLocked = false; // Lock Selection State
    this._vrIsNegative = false; // Universal Sub Mode State
  }

  start() {
    // [DESKTOP 6DOF] Console Tuning Helper (Standard X, Y, Z)
    window.setSpectatorOffset = (x, y, z) => {
      this._desktopOffset[0] = x;
      this._desktopOffset[1] = y;
      this._desktopOffset[2] = z;
      console.log(`Spectator Offset Set: [${x}, ${y}, ${z}]`);
      this.render();
    };

    // [Step 1] Hand Swap Helper
    window.setDominantHand = (hand) => {
      this.setDominantHand(hand);
    };

    // [DEBUG] Grab Tool Helper
    window.debug = window.debug || {};
    window.debug.grab = () => {
      if (!this._sculptManager) return "No SculptManager";
      const tool = this._sculptManager.getCurrentTool();
      if (!tool || tool.constructor.name !== 'Grab') return "Current tool is not Grab";

      const active = tool._activeController;
      const mesh = tool._grabbedMesh;

      let msg = `Grab Tool State:\n`;
      msg += `  Active Controller: ${active ? (active.handedness || 'Unknown') : 'None'}\n`;
      if (active && active.matrix) {
        const m = active.matrix;
        msg += `  Ctl Mat: [${m[12].toFixed(2)}, ${m[13].toFixed(2)}, ${m[14].toFixed(2)}]\n`;
        // check scale
        const sx = Math.hypot(m[0], m[1], m[2]);
        msg += `  Ctl Scale: ${sx.toFixed(4)}\n`;
      }

      msg += `  Grabbed Mesh: ${mesh ? mesh.getID() : 'None'}\n`;
      if (mesh) {
        const m = mesh.getMatrix();
        msg += `  Mesh Mat: [${m[12].toFixed(2)}, ${m[13].toFixed(2)}, ${m[14].toFixed(2)}]\n`;
      }


      console.log(msg);
      if (window.screenLog) {
        window.screenLog(msg, "lime");
        if (!active) window.screenLog("Hint: Hold Trigger to see Active Controller", "yellow");
      }
      return msg;
    };

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
    var scale = 0.4; // Was 0.1, User requested 4x bigger
    mat4.scale(gridm, gridm, [scale, scale, scale]);
    this._grid.setShaderType(Enums.Shader.FLAT);
    grid.setFlatColor([0.3, 0.3, 0.3]);
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

  setDominantHand(hand) {
    if (hand !== 'left' && hand !== 'right') {
      console.warn("setDominantHand: Invalid handedness (use 'left' or 'right')");
      return;
    }
    this._dominantHand = hand;
    console.log(`Dominant Hand set to: ${this._dominantHand}`);
    if (window.screenLog) window.screenLog(`Dominant Hand: ${this._dominantHand}`, "lime");
  }

  // Simplified VR Render (Bypassing RTT/PostProc for now)
  // Shared Render Logic (Parity for Spectator)
  _renderSceneVR(cam, viewMatrix, projMatrix) {
    const gl = this._gl;
    const meshes = this._meshes;

    // --- SETUP VIEW ---
    mat4.copy(cam._view, viewMatrix);
    mat4.copy(cam._proj, projMatrix);

    // --- PASS 1: REAL WORLD (Controllers/Debug) ---
    // Render Controllers
    if (this._vrControllerLeft) {
      this._vrControllerLeft.updateMatrices(cam);
      this._vrControllerLeft.render(this);
    }
    if (this._vrControllerRight) {
      this._vrControllerRight.updateMatrices(cam);
      this._vrControllerRight.render(this);
    }

    // VR Menu (Pass 1)
    // [Step 4] Hand Swap: Menu attaches to NON-DOMINANT hand
    const menuAnchor = this._dominantHand === 'left' ? this._vrPoseRight : this._vrPoseLeft;
    if (this._vrMenu && menuAnchor) {
      const menuPose = mat4.clone(menuAnchor);
      const lift = mat4.create();
      // [Step 5 Fix] Menu Offset
      // VRMenu has internal offset of +0.15 (Right). Width is 0.30.
      // Left Hand (Right Dom): We want it on Right. Internal +0.15 puts it at 0.0->0.30.
      // Right Hand (Left Dom): We want it on Left. Center should be at -0.15 - gap.
      // Target Center: -0.20?
      // Internal is +0.15. We need: Lift + 0.15 = -0.20 => Lift = -0.35.

      const sideOffset = this._dominantHand === 'left' ? -0.35 : 0.0;
      mat4.fromTranslation(lift, [sideOffset, 0.03, 0.0]);
      mat4.multiply(menuPose, menuPose, lift);

      this._vrMenu.updateMatrices(cam, menuPose);
      this._vrMenu.render(this);
    }

    // VRLaser (Pass 1)
    if (this._vrLaser && this._vrLaserMatrix && this._isPointingAtMenu) {
      const dist = this._vrLaserDistance || 1.0;
      this._vrLaser.updateMatrices(cam, this._vrLaserMatrix, dist, 0.01);
      this._vrLaser.render(this);
    }

    // Debug Pivot
    if (this._debugPivotMesh && this._debugPivotMesh.isVisible()) {
      gl.disable(gl.DEPTH_TEST);
      this._debugPivotMesh.updateMatrices(cam);
      this._debugPivotMesh.render(this);
      gl.enable(gl.DEPTH_TEST);
    }

    // VR Brush Tip (Pass 1)
    // [Step 2] Hand Swap: Use Dominant Hand for Brush Tip
    const domHand = this._dominantHand === 'left' ? this._vrControllerLeft : this._vrControllerRight;
    // We need the Matrix of the "Pointer" (Ray or Grip).
    // Currently _vrRightRayMatrix is hardcoded to Right Hand.
    // We should rename _vrRightRayMatrix to _vrDominantRayMatrix in Step 3,
    // For now, let's just grab the matrix from the dominant controller mesh?
    // No, controller mesh is Grip Space. Brush Tip needs Ray Space if possible.
    // Let's use _vrDominantRayMatrix if available (we will add it in Step 3),
    // Or fallback to _vrRightRayMatrix for now if we haven't renamed it?
    // Actually, Step 2 is Visuals. Step 3 is Input.
    // If I change Visuals to use "Dominant Hand", I need the Matrix for the Dominant Hand.
    // Scene.js updateVRControllerPose updates the Mesh Matrix.
    // Let's use the Mesh Matrix for now?
    // Wait, Brush Tip attaches to "TargetRay" usually.
    // Let's look at `updateXR` or `onXRFrame`.
    // We need `_vrDominantRayMatrix`.
    // Let's stick to modifying `handleXRInput` in Step 3 to provide `_vrDominantRayMatrix`.
    // BUT Step 2 is supposed to be Visuals.
    // I can't render the visual at the right place if I don't have the matrix.
    // So Step 2 might need a tiny bit of Input Logic (capturing the matrix).

    // Let's patch `handleXRInput` locally here to capture `_vrDominantRayMatrix`.
    // See `handleXRInput` changes below.

    if (this._vrControllerTip && this._vrDominantRayMatrix) {
      const mTip = this._vrControllerTip.getMatrix();
      mat4.copy(mTip, this._vrDominantRayMatrix);
      const offY = this._isQuestStandalone ? 0.075 : 0.025;
      mat4.rotateX(mTip, mTip, -Math.PI / 2);
      mat4.translate(mTip, mTip, [0, offY, 0]);

      this._vrControllerTip.updateMatrices(cam);
      this._vrControllerTip.render(this);
    }

    // --- PASS 2: SCALED WORLD (Meshes/Grid) ---
    // Apply World Transforms
    if (this._xrWorldOffset) {
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
    if (this._showGrid && this._grid) {
      this._grid.updateMatrices(cam);
      this._grid.render(this);
    }

    // Meshes (Opaque)
    for (let k = 0, l = meshes.length; k < l; ++k) {
      if (!meshes[k].isVisible()) continue;
      meshes[k].updateMatrices(cam);
      meshes[k].render(this);
    }

    // Meshes (Wireframe)
    gl.enable(gl.BLEND);
    gl.depthFunc(gl.LESS);
    for (let k = 0, l = meshes.length; k < l; ++k) {
      if (meshes[k].getShowWireframe()) meshes[k].renderWireframe(this);
    }
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.BLEND);

    // Brush Indicator (Pass 2 - World Space)
    var currentTool = this._sculptManager ? this._sculptManager.getCurrentTool() : null;
    var isVoxel = currentTool && currentTool.constructor.name === 'SculptVoxel';

    if (this._sculptManager && this._picking.getMesh() && !isVoxel) {
      const radius = this._picking._rWorld2 ? Math.sqrt(this._picking._rWorld2) : 0.05;

      // Update Selection Color for Negative Mode
      const selection = this._sculptManager.getSelection();
      if (selection.setIsNegative) selection.setIsNegative(this._vrIsNegative);

      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      selection.renderVR(this, cam, radius);
      gl.disable(gl.BLEND);
      gl.enable(gl.DEPTH_TEST);
    }

    // --- PASS 3: OVERLAY (Reset View) ---
    // Reset View Matrix to Base
    mat4.copy(cam._view, viewMatrix);

    // Proj is same.

    // Render VR Brush Radius Sphere (Pass 3)
    if (this._vrBrushRadiusSphere && this._vrDominantRayMatrix && this._vrControllerTip) {
      const mSphere = this._vrBrushRadiusSphere.getMatrix();
      mat4.copy(mSphere, this._vrDominantRayMatrix);
      const offY = this._isQuestStandalone ? 0.10 : 0.05;
      mat4.rotateX(mSphere, mSphere, -Math.PI / 2);
      mat4.translate(mSphere, mSphere, [0, offY, 0]);

      // Normalize Scale logic...
      // Simply Reset Scale to 1, then apply radius
      // Extract translation/rotation?
      // Or just normalize columns as before
      const sx = Math.hypot(mSphere[0], mSphere[1], mSphere[2]);
      const sy = Math.hypot(mSphere[4], mSphere[5], mSphere[6]);
      const sz = Math.hypot(mSphere[8], mSphere[9], mSphere[10]);
      if (sx > 1e-6) { mSphere[0] /= sx; mSphere[1] /= sx; mSphere[2] /= sx; }
      if (sy > 1e-6) { mSphere[4] /= sy; mSphere[5] /= sy; mSphere[6] /= sy; }
      if (sz > 1e-6) { mSphere[8] /= sz; mSphere[9] /= sz; mSphere[10] /= sz; }

      const r = (this._vrLastPhysicalRadius !== undefined) ? this._vrLastPhysicalRadius : 0.01;
      mat4.scale(mSphere, mSphere, [r, r, r]);

      this._vrBrushRadiusSphere.updateMatrices(cam);

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.depthMask(false);
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.DEPTH_TEST);

      this._vrBrushRadiusSphere.render(this);

      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.CULL_FACE);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }
  }

  // Simplified VR Render (Delegates to _renderSceneVR)
  renderVR(glLayer, pose, frame, refSpace) {
    var gl = this._gl;
    var cam = this._camera;
    var views = pose.views;

    // Lazy init controllers if missing (and GL is ready)
    if (!this._vrControllerLeft || !this._vrControllerRight) {
      this.initVRControllers();
    }

    // FBO is already bound by callee (usually glLayer.framebuffer)
    // Clear once for the whole VR buffer (Left+Right)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    for (var i = 0; i < views.length; ++i) {
      var view = views[i];
      var viewport = glLayer.getViewport(view);
      gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);

      this._renderSceneVR(cam, view.transform.inverse.matrix, view.projectionMatrix);
    }
  }


  _drawSceneVR() {
    var gl = this._gl;

    ///////////////
    // CONTOUR 1/2
    ///////////////
    gl.disable(gl.DEPTH_TEST);
    var showContour = this._selectMeshes.length > 0 && this._showContour && ShaderLib[Enums.Shader.CONTOUR].color[3] > 0.0;

    // VR RTT Handling (Hack)
    // We bind the Contour RTT, render flat color, then MUST restore the WebXR framebuffer.
    // However, WebXR framebuffer is NOT exposed easily here unless we pass it down or query it.
    // gl.getParameter(gl.FRAMEBUFFER_BINDING) works in Chrome for WebXR usually.

    let previousFBO = null;
    if (showContour && this._rttContour) {
      previousFBO = gl.getParameter(gl.FRAMEBUFFER_BINDING);

      gl.bindFramebuffer(gl.FRAMEBUFFER, this._rttContour.getFramebuffer());
      gl.clear(gl.COLOR_BUFFER_BIT);
      for (var s = 0, sel = this._selectMeshes, nbSel = sel.length; s < nbSel; ++s) {
        sel[s].renderFlatColor(this);
      }

      // RESTORE VR FBO
      gl.bindFramebuffer(gl.FRAMEBUFFER, previousFBO);
    }

    gl.enable(gl.DEPTH_TEST);

    // grid
    if (this._showGrid) this._grid.render(this);

    // VR Controllers (Pass 1: Real World)
    if (this._vrControllerLeft) this._vrControllerLeft.render(this);
    if (this._vrControllerRight) this._vrControllerRight.render(this);

    // Debug Cursor
    if (this._debugCursor && this._debugCursor.isVisible()) this._debugCursor.render(this);

    // Meshes (Pass 2: World Scaled)
    // HIDE SCULPT during Calibration (Focus on Controllers/World alignment)
    if (!this._isCalibratingSpectator) {
      var meshes = this._meshes;
      for (var i = 0, l = meshes.length; i < l; ++i) {
        if (!meshes[i].isVisible()) continue;
        meshes[i].render(this);
      }
    }

    // Brush Indicator (NEW)
    // Rendered in Pass 2 (World Scaled) to match Mesh Coordinates
      // Use 'this._camera' which is the active camera during _drawSceneVR (Pass 2)
      // Note: renderVR() calls _drawSceneVR() AFTER setting up the World Scaled Matrix on the camera.

    // Update Selection Color for Negative Mode
    const selection = this._sculptManager.getSelection();
    if (selection.setIsNegative) selection.setIsNegative(this._vrIsNegative);

    selection.renderVR(this, this._camera, radius);

    ///////////////
    // CONTOUR 2/2
    ///////////////
    if (showContour && this._rttContour) {
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      // Rtt.render() draws a fullscreen quad.
      // In VR, "fullscreen" means the current viewport (one eye).
      // Since _rttContour texture contains the FULL screen capture from 1/2,
      // If we render it back, it might be stretched if RTT size != Viewport size?
      // RTT is resized to Canvas Size usually.
      // VR Viewport is usually smaller/different.
      // However, since we rendered the flat color using the VR Viewport (implicitly?),
      // Wait, when we bound RTT, we didn't change viewport.
      // If RTT is huge (Canvas Size) and VR Viewport is small, we rendered into a corner of the RTT.
      // Then if we render the RTT quad, we need to sample that corner.
      // Rtt.render() uses standard UVs (0..1).
      // This might look incorrect if UVs don't match.
      // But let's try.
      this._rttContour.render(this);
      gl.disable(gl.BLEND);
      gl.enable(gl.DEPTH_TEST);
    }
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

    // VR Controllers
    if (this._vrControllerLeft) this._vrControllerLeft.render(this);
    if (this._vrControllerRight) this._vrControllerRight.render(this);

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
      window.alert('Values: WebGL context could not be retrieved.');
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
    for (var i = 0; i < rm.length; ++i) {
      var idx = this.getIndexMesh(rm[i]);
      if (idx >= 0) meshes.splice(idx, 1);
    }
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
    this._vrIsNegative = false;
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

      meshS.setShaderType(Enums.Shader.FRESNEL);
      // For Additive Blending (ONE, ONE), the RGB values control brightness/opacity directly.
      // FRESNEL dims center, so boost base color: 0.2 -> 0.5
      meshS.setFlatColor([0.5, 0.5, 0.5]);
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

  updateVRControllerPose(handedness, position, orientation) {
    var mesh = handedness === 'left' ? this._vrControllerLeft : this._vrControllerRight;
    if (!mesh) return;

    if (window.screenLog && !this._hasLoggedCtrl) {
      // window.screenLog(`First Controller Update: ${handedness}`, 'lime');
      this._hasLoggedCtrl = true;
    }

    // Fix: gl-matrix expects Arrays, but WebXR gives DOMPoints.
    // We must convert them manually.
    const pos = [position.x, position.y, position.z];
    const rot = [orientation.x, orientation.y, orientation.z, orientation.w];

    var mat = mesh.getMatrix();
    mat4.fromRotationTranslation(mat, rot, pos);

    // Apply Scale (Controllers are 1.0 size cubes, we want 0.02m = 2cm)
    // Real Models (OBJ) are in Meters (~0.15), so we scale by 1.0 (no change) or adjustment
    const scale = mesh.isPlaceholder ? 0.02 : 1.0;
    mat4.scale(mat, mat, [scale, scale, scale]);

    // DEBUG: Verify Right Controller Position (Fixed)
    // if (handedness === 'right' && window.screenLog && this._logThrottle % 200 === 0) {
    //    window.screenLog("Right Pos: " + vec3.str(pos), "cyan");
    // }
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



  updateDebugPivot(pos, active) {
    // NUKED: Debug Cube Forbidden
  }

  onXRFrame(time, frame) {
    const session = frame.session;
    session.requestAnimationFrame(this.onXRFrame.bind(this));

    // Force use of Base Ref Space (Local Floor) to debug "Flying Cube"
    // The previous offset logic likely doubled up or inverted height.
    const refSpace = this._baseRefSpace;

    const pose = frame.getViewerPose(refSpace);
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

      // [DESKTOP 6DOF] Spectator Render (Parity Strategy)
      if (this._desktopOffsetMode) {

        const gl = this._gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, this._canvasWidth, this._canvasHeight);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        if (pose.views.length > 0) {
          const view = pose.views[0];
          // Use Desktop Aspect Ratio for Projection
          // Note: We use a temporary projection matrix to match desktop window
          const aspect = this._canvasWidth / this._canvasHeight;
          const prob = mat4.create();
          mat4.perspective(prob, 45 * Math.PI / 180, aspect, 0.1, 1000.0);

          // Apply Offset (Here, for Spectator ONLY)
          const viewMat = mat4.clone(view.transform.inverse.matrix);
          mat4.rotateY(viewMat, viewMat, Math.PI);
          mat4.translate(viewMat, viewMat, [
            -this._desktopOffset[0],
            -this._desktopOffset[1],
            -this._desktopOffset[2]
          ]);

          // Apply Rotation
          const matRot = mat4.create();
          mat4.fromQuat(matRot, this._desktopRotation);
          mat4.multiply(viewMat, viewMat, matRot);

          // Render Shared Logic
          this._renderSceneVR(this._camera, viewMat, prob);
        }
      }
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
        // [Step 3] Hand Swap: Shortcuts adhere to NON-DOMINANT hand
        // [Step 3] Hand Swap: Radius Control adheres to DOMINANT hand
        const isDom = source.handedness === this._dominantHand;
        const isNonDom = !isDom;
        const axes = source.gamepad.axes;

        // Thresholds
        const T_PRESS = 0.7;
        const T_RELEASE = 0.3;

        // NON-DOMINANT HAND: AXIS 2 (Left/Right) - Undo/Redo
        if (isNonDom) {
          // THUMBSTICK UNDO DISABLED (Moved to Buttons X/Y)
          // LEFT HAND: AXIS 2 (Left/Right) - Undo/Redo
          const valX = axes[2];
          const lastX = state.axes[2] || 0;

          // State Machine: Only fire if we were neutral
          // State Machine: Explicit "Wait for Neutral" to avoid bounce/repeat issues
          if (state.waitingForNeutral) {
            if (Math.abs(valX) < T_RELEASE) {
              state.waitingForNeutral = false;
              // if (window.screenLog) window.screenLog("Shortcuts: Reset", "gray");
            }
          } else {
            // Ready to fire
            if (Math.abs(valX) > T_PRESS) {
              const now = performance.now();
              // Double Check Debounce (just in case)
              if (now - (state.lastUndoRedoTime || 0) > 300) {
                state.lastUndoRedoTime = now;
                state.waitingForNeutral = true;

                 if (valX < -T_PRESS) {
                   if (window.screenLog) window.screenLog(`Shortcuts: Undo (Val=${valX.toFixed(2)})`, "lime");
                   else console.log("Shortcuts: Undo");

                   if (this._stateManager) {
                     this._stateManager.undo();
                     this._main ? this._main.render() : this.render();
                   }
                 } else if (valX > T_PRESS) {
                   if (window.screenLog) window.screenLog(`Shortcuts: Redo (Val=${valX.toFixed(2)})`, "lime");
                   else console.log("Shortcuts: Redo");

                   if (this._stateManager) {
                     this._stateManager.redo();
                     this._main ? this._main.render() : this.render();
                   }
                 }
               }
            }
          }
          state.axes[2] = valX;

          /*
          // BUTTONS: X (4) = Undo, Y (5) = Redo
          const btns = source.gamepad.buttons;
          if (btns.length > 5) {
            const now = performance.now();
            const DEBOUNCE = 300; // 300ms debounce

            // Button 4 (X) - Undo
            const btnX = btns[4];
            const isPressedX = btnX.pressed;
            const wasPressedX = state.btnX || false;

            if (isPressedX && !wasPressedX) {
              if (now - (state.lastUndoTime || 0) > DEBOUNCE) {
                if (window.screenLog) window.screenLog("Shortcuts: Undo (X Button)", "lime");
                if (this._stateManager) {
                  this._stateManager.undo();
                  this._main ? this._main.render() : this.render();
                }
                state.lastUndoTime = now;
              }
            }
            state.btnX = isPressedX;

            // Button 5 (Y) - Redo
            const btnY = btns[5];
            const isPressedY = btnY.pressed;
            const wasPressedY = state.btnY || false;

            if (isPressedY && !wasPressedY) {
              if (now - (state.lastRedoTime || 0) > DEBOUNCE) {
                if (window.screenLog) window.screenLog("Shortcuts: Redo (Y Button)", "lime");
                if (this._stateManager) {
                  this._stateManager.redo();
                  this._main ? this._main.render() : this.render();
                }
                state.lastRedoTime = now;
              }
            }
            state.btnY = isPressedY;
          }
          */
        }

        // DOMINANT HAND: AXIS 3 (Up/Down) - Radius +/- 5%
        if (isDom) {
          const valY = axes[3];
          const isPressedY = Math.abs(valY) > T_PRESS;

          // Timer for Repeat/Debounce
          const now = performance.now();
          if (!state.lastRadiusTime) state.lastRadiusTime = 0;

          if (isPressedY) {
            if (now - state.lastRadiusTime > 150) { // 150ms Repeat Rate
              state.lastRadiusTime = now;

              let change = 0.0;
              const tools = this._sculptManager.getCurrentTool();
              const maxRadius = 250.0;
              if (valY < -T_PRESS) change = maxRadius * 0.05; // UP -> +5% of max
              if (valY > T_PRESS) change = -maxRadius * 0.05; // DOWN -> -5% of max

              if (change !== 0 && tools) {
                const oldVal = tools._radius;
                const newVal = Math.max(5.0, Math.min(maxRadius, oldVal + change));

                // if (window.screenLog) window.screenLog(`Radius: ${newVal.toFixed(0)}`, "yellow");

                tools.setRadius(newVal);

                // Update GuiXR Slider if visible
                if (this._guiXR) {
                  this._guiXR.updateRadiusWidget(newVal);
                }

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
      // [Step 2 Fix] Capture Dominant Ray Matrix
      if (source.handedness === this._dominantHand) {
        // Try Target Ray first
        if (source.targetRaySpace) {
          const ptrPose = frame.getPose(source.targetRaySpace, refSpace);
          if (ptrPose) {
            this._vrDominantRayMatrix = ptrPose.transform.matrix;
          } else {
            this._vrDominantRayMatrix = null;
          }
        } else if (source.gripSpace) {
          // Fallback to Grip Space if Ray is missing (rare but possible)
          const gripPose = frame.getPose(source.gripSpace, refSpace);
          if (gripPose) {
            this._vrDominantRayMatrix = gripPose.transform.matrix;
          }
        }
      }

      // Keep Legacy _vrRightRayMatrix for now (for old Menu Logic, until Step 4)

      // Keep Legacy _vrRightRayMatrix for now if needed?
      if (source.handedness === 'right' && source.targetRaySpace) {
        const ptrPose = frame.getPose(source.targetRaySpace, refSpace);
        if (ptrPose) {
          this._vrRightRayMatrix = ptrPose.transform.matrix;
        } else {
          this._vrRightRayMatrix = null;
        }
      }

      // 2. Menu Raycasting (Dominant Hand Only)
      if (source.handedness === this._dominantHand) {
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

    // FORCE PIVOT INIT (Just in case)
    // if (!this._debugPivotMesh) this.updateDebugPivot([0, 0, 0], false);

    // 5. Dispatch Sculpting (Active Hand)
    // XRInputSourceArray is not a real array, so .find() fails.
    let activeSource = null;


    // Smart Source Selection: Prioritize Trigger Press
    // Loop manually to be safe on all browsers
    let right = null;
    let left = null;
    for (const s of sources) {
      if (s.handedness === 'right') right = s;
      if (s.handedness === 'left') left = s;
    }

    // Check Triggers & Log
    const rightPressed = right && right.gamepad && right.gamepad.buttons[0] && right.gamepad.buttons[0].pressed;
    const leftPressed = left && left.gamepad && left.gamepad.buttons[0] && left.gamepad.buttons[0].pressed;

    // Helper: Specific Tool Override
    const tool = this._sculptManager.getCurrentTool();
    const isVoxel = tool && tool.constructor && tool.constructor.name === 'SculptVoxel';

    // Priority: Locked Hand (if sculpting) > Pressed Hand > Dominant Hand > Other Hand > First Found
    const domSource = this._dominantHand === 'left' ? left : right;
    const nonDomSource = this._dominantHand === 'left' ? right : left;

    if (this._vrSculpting && this._vrLockedHand) {
      // Find the locked hand source
      const locked = (this._vrLockedHand === 'right') ? right : left;
      if (locked) {
        activeSource = locked;
      }
    } else if (isVoxel) {
      // PROPER VOXEL BEHAVIOR:
      // Dominant Hand = Sculpt/Carve (Action)
      // Non-Dominant Hand = Modifier (Negative or just ignored for pos)
      // ALWAYS use Dominant Hand for positioning/action if available.
      if (domSource) {
        activeSource = domSource;
      // Trigger action only if Dominant Trigger is pressed
      // Non-Dominant Trigger just modifies the state (passed via options below)
      } else {
        // Fallback to whatever is available
        activeSource = nonDomSource || sources[0];
      }
    } else {
      // Standard Logic for other tools
      // FORCE DOMINANT HAND (User Request: Disable Non-Dominant Hand Sculpting)
      if (domSource) activeSource = domSource;
      else if (rightPressed) activeSource = right;
      else if (leftPressed) activeSource = left;
      else if (nonDomSource) activeSource = nonDomSource;
      else {
        for (const s of sources) { activeSource = s; break; }
      }
    }

    // DEBUG: Source Selection
    if (window.screenLog && this._logThrottle % 60 === 0) {
      // window.screenLog(`VR Src: R=${right ? (rightPressed?'YES':'no') : 'miss'} L=${left ? (leftPressed?'YES':'no') : 'miss'} -> Active=${activeSource ? activeSource.handedness : 'NONE'}`, "yellow");
    }

    if (activeSource) {
      // If sculpting just started, lock the hand
      if (this._vrSculpting && !this._vrLockedHand) {
        this._vrLockedHand = activeSource.handedness;
      }
      this.processVRSculpting(activeSource, frame, refSpace);
    }

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
    } else if (this._isCalibratingSpectator) {
      // [CALIBRATION MODE] "Move Me"
      // World stays still, you move the Spectator Camera.
      this._vrTwoHanded.active = false;
      // Force Debug Pivot OFF
      if (this.updateDebugPivot) this.updateDebugPivot(null, false);

      if (leftGrip && leftOrigin && leftRot) {
        this.processSpectatorCalibration('left', leftOrigin, leftRot);
      } else {
        this._vrGrip.left.active = false;
      }

      if (rightGrip && rightOrigin && rightRot) {
        this.processSpectatorCalibration('right', rightOrigin, rightRot);
      } else {
        this._vrGrip.right.active = false;
      }

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
      quat.copy(gState.startRotation, rotation);
    } else {
      // Delta in Base Space approx World Space delta if orientation aligned
      const delta = vec3.create();
      vec3.sub(delta, origin, gState.startPoint);

      // Threshold for jitter (Translation)
      if (vec3.length(delta) > 0.0001) {
        this.moveWorld([delta[0], delta[1], delta[2]]);
        vec3.copy(gState.startPoint, origin);
      }

      // Rotation Delta
      if (rotation) {
        const qDelta = quat.create();
        const qInv = quat.create();
        quat.invert(qInv, gState.startRotation);
        quat.multiply(qDelta, rotation, qInv); // Current * InvStart = Delta

        // Threshold for jitter (Rotation) - ~0.1 degree
        if (Math.abs(qDelta[3] - 1.0) > 0.000001) {
          this.rotateWorld(qDelta, origin); // Pivot around HAND (origin)
          quat.copy(gState.startRotation, rotation);
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

    // Rotation Logic (World -> Engine)
    // EngineRot = Inv(WorldRot) * PhysRot
    const qPhys = quat.fromValues(q.x, q.y, q.z, q.w);
    const engineQuat = quat.create();

    if (this._xrWorldOffset) {
      const r = this._xrWorldOffset.orientation;
      const qRot = quat.fromValues(r.x, r.y, r.z, r.w);
      const qInv = quat.create();
      quat.invert(qInv, qRot);
      quat.multiply(engineQuat, qInv, qPhys);
    } else {
      quat.copy(engineQuat, qPhys);
    }
    this._vrControllerQuat = engineQuat;

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

    // FIX: Only block STARTING given we are not already sculpting/grabbing
    const currentTool = this._sculptManager.getCurrentTool();
    const isToolActive = currentTool && currentTool._grabbedMesh;
    const isSculpting = this._vrSculpting;

    // Only block if we are NOT already busy
    if (this._isPointingAtMenu && !isSculpting && !isToolActive) {
      // DEBUG: STICKY BRUSH DIAGNOSIS
      if (this._vrSculpting && window.screenLog && this._logThrottle % 30 === 0) {
        window.screenLog(`Stuck? Sc=${this._vrSculpting} Hand=${this._vrLockedHand} Src=${source.handedness} Btn=${buttons[0].pressed} Val=${buttons[0].value.toFixed(2)}`, buttons[0].pressed ? "lime" : "red");
      }
      return;
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
    // Lock Selection Logic: If locked and we have a mesh, skip picking
    this._picking._rWorld2 = pickingRadius * pickingRadius;

    let picked = false;
    if (this._selectionLocked && this._picking.getMesh()) {
      // Keep current mesh, but we might still need to update intersection point on THAT mesh?
      // actually intersectionRayMeshes does both selection AND intersection point update.
      // If we skip it, we don't update the cursor position!
      // We must force intersection ONLY on the current mesh.
      picked = this._picking.intersectionRayMesh(this._picking.getMesh(), rayOrigin, engineDir);
    } else {
      picked = this._picking.intersectionRayMeshes(this._meshes, rayOrigin, engineDir);
    }

    // DEBUG: Picking Trace
    // if (window.screenLog && this._logThrottle % 60 === 0) {
    //   const msg = `Pick:${picked ? 'YES' : 'NO'} Rad:${(pickingRadius * 100).toFixed(2)}cm`;
    //   window.screenLog(msg, picked ? "lime" : "red");
    // }

    // 5. Stroke Lifecycle (Corrected API)
    const buttons = source.gamepad.buttons;
    // FORCE DISABLE IF NOT DOMINANT HAND (Double Safety)
    const isDominant = (source.handedness === this._dominantHand);
    const isTriggerPressed = isDominant && buttons[0].pressed;

    // Log Removed

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



    // TRIGGER DEBOUNCE REMOVED

    /* 6. Dispatch Conditions */
    // Allow Start ONLY if Picked OR Tool Allows Air (Voxel). Allow Continue ALWAYS if Trigger is held.
    // FIX: If tool reports it is "active" (like Grab holding a mesh), we MUST NOT end the stroke.
    // (currentTool and isToolActive defined above at Menu Block)

    let canSculpt = isTriggerPressed && (picked || this._vrSculpting || allowAir || isToolActive);

    if (window.screenLog && this._logThrottle % 60 === 0) {
      // window.screenLog(`Scene: Trig=${isTriggerPressed} Pick=${!!picked} Sculpt=${this._vrSculpting} Air=${allowAir} Active=${!!isToolActive}`, "gray");
    }

    // if (isTriggerPressed && !canSculpt && this._logThrottle % 60 === 0 && window.screenLog) {
    //   if (window.screenLog) window.screenLog(`Blocked: Pick=${!!picked} Air=${allowAir} Active=${!!isToolActive}`, "orange");
    // }

    // Capture state for change detection
    if (this._lastCanSculpt !== canSculpt || (this._vrSculpting && !canSculpt)) {
      if (window.screenLog) {
        // window.screenLog(`Scene Logic Change: Can=${canSculpt} Trig=${isTriggerPressed} Pick=${!!picked} Active=${!!isToolActive} Sculpting=${this._vrSculpting}`, canSculpt ? "lime" : "red");
      }
      this._lastCanSculpt = canSculpt;
    }

    if (canSculpt) {
      if (!this._vrSculpting) {
        this._vrSculpting = true;
        this._vrLockedHand = source.handedness; // LOCK HAND
        this._vrTriggerReleaseTime = 0; // Reset Timer

        // Deep Trace: Start Stroke
        // if (window.screenLog) window.screenLog(`Scene: START STROKE (${source.handedness})`, "lime");

        this._sculptManager.start(this._vrMultiSelect);
        this._action = Enums.Action.SCULPT_EDIT;
      }
      this._sculptManager.preUpdate(); // Sync position

      // ... existing code ...
    } else {
      if (this._vrSculpting) {
        const reason = !isTriggerPressed ? "Trigger Released" : "Logic Blocked";
        // if (window.screenLog) window.screenLog(`Scene: END STROKE (${reason}) Trig=${isTriggerPressed} Pick=${!!picked} Active=${!!isToolActive}`, "red");

        this._vrSculpting = false;
        this._vrLockedHand = null; // UNLOCK HAND
        this._vrTriggerReleaseTime = 0;

        this._sculptManager.end();
        this._action = Enums.Action.NOTHING;
      }
    }

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

        // Check for NON-DOMINANT TRIGGER (Modifier) or SQUEEZE
        let isNegative = false;
        // Find non-dominant input source
        const session = frame.session;
        const nonDomHand = this._dominantHand === 'left' ? 'right' : 'left';

        if (session && session.inputSources) {
          for (let src of session.inputSources) {
            if (src.handedness === nonDomHand && src.gamepad) {
              // Button 0 (Trigger) or Button 1 (Squeeze)
              if ((src.gamepad.buttons[0] && src.gamepad.buttons[0].pressed) ||
                (src.gamepad.buttons[1] && src.gamepad.buttons[1].pressed)) {
                isNegative = true;
                break;
              }
            }
          }
        }

        this._vrIsNegative = isNegative; // Logic for Rendering

        // Universal Sub Mode: Override Tool Negative State
        // We only override if isNegative is TRUE.
        // If isNegative is FALSE, we respect the tool's original state.
        // To do this cleanly without trashing the GUI state:
        // We set a temporary flag or just manipulate it, BUT we must restore it?
        // Actually, if we just set tool._negative = true, the GUI logic might get confused if we don't revert it.
        // Let's use a "Force Negative" approach if possible, but simplest is to save/restore.




        // if (isNegative && window.screenLog && this._logThrottle % 60 === 0) {
        //   window.screenLog("VR: Negative Modifier!", "red");
        // }

        // DEBUG: Trace Input
        if (window.screenLog && (this._logThrottle % 60 === 0)) {
          // window.screenLog(`VR Input: Src=${activeSource ? activeSource.handedness : 'null'} Trig=${isTriggerPressed} Neg=${isNegative}`, "cyan");
        }

        // Collect Controllers for Grab Tool (TRANSFORMED TO SCENE SPACE)
        const xrControllers = [];
        if (session && session.inputSources) {

          // Pre-calc transforms
          if (this._vrScale === undefined || this._vrScale < 0.0001) this._vrScale = 1.0;
          const vrScale = this._vrScale;
          const invScale = 1.0 / vrScale;

          // World Offset Inverse
          let qInvWorld = quat.create();
          let posInvWorld = vec3.create();
          if (this._xrWorldOffset) {
            const r = this._xrWorldOffset.orientation;
            const t = this._xrWorldOffset.position;
            const qRot = quat.fromValues(r.x, r.y, r.z, r.w);
            quat.invert(qInvWorld, qRot);
            // Inverse Translation Vector
            vec3.set(posInvWorld, t.x, t.y, t.z);
          } else {
            quat.identity(qInvWorld);
          }

          for (let src of session.inputSources) {
            if (!src.gamepad) continue;

            // Get Physical Matrix (World Space)
            const ctl = (src.handedness === 'left') ? this._vrControllerLeft : this._vrControllerRight;
            if (ctl) {
              const physMat = ctl.getMatrix(); // This is Physical World Matrix (set (Pass 1))
              const sceneMat = mat4.create();
              mat4.copy(sceneMat, physMat);

              // TRANSFORM TO VIRTUAL SCENE SPACE
              // 1. Apply Inverse World Offset
              if (this._xrWorldOffset) {
                // The physical matrix M_phys transforms 0,0,0 to P_phys.
                // We want M_virt.
                // P_phys = T_world * P_virt
                // M_phys = T_world * M_virt
                // M_virt = inv(T_world) * M_phys

                // T_world matrix
                const tWorld = mat4.create();
                const r = this._xrWorldOffset.orientation;
                const t = this._xrWorldOffset.position;
                mat4.fromRotationTranslation(tWorld, [r.x, r.y, r.z, r.w], [t.x, t.y, t.z]);

                // Add Scale to T_world? 
                // Pass 2 renders with: View * WorldMat * ScaleMat
                // So P_phys = T_world * Scale * P_virt
                // M_phys = T_world * Scale * M_virt
                // M_virt = inv(Scale) * inv(T_world) * M_phys

                const invTWorld = mat4.create();
                mat4.invert(invTWorld, tWorld);

                mat4.multiply(sceneMat, invTWorld, sceneMat);
              }

              // 2. Apply Inverse Scale
              if (vrScale !== 1.0) {
                const invScaleMat = mat4.create();
                mat4.scale(invScaleMat, invScaleMat, [invScale, invScale, invScale]);
                mat4.multiply(sceneMat, invScaleMat, sceneMat);
              }

              xrControllers.push({
                handedness: src.handedness,
                buttons: src.gamepad.buttons,
                matrix: sceneMat, // VIRTUAL SCENE MATRIX
              });

              // DEBUG: MATRIX TRACE (Throttled)
              /*
              if (window.screenLog && this._logThrottle % 60 === 0 && src.handedness === 'right') {
                const pPos = vec3.create(); mat4.getTranslation(pPos, physMat);
                const sPos = vec3.create(); mat4.getTranslation(sPos, sceneMat);
                const wPos = this._xrWorldOffset ? this._xrWorldOffset.position : { x: 0, y: 0, z: 0 };
                window.screenLog(`Mat Debug: Scale=${vrScale.toFixed(4)} Phys=[${pPos[0].toFixed(2)},${pPos[1].toFixed(2)},${pPos[2].toFixed(2)}] Scene=[${sPos[0].toFixed(2)},${sPos[1].toFixed(2)},${sPos[2].toFixed(2)}]`, "yellow");
              }
              */
            }
          }
        }

        // EXTRACT ANALOG TRIGGER VALUE
        let triggerValue = 1.0;
        if (source && source.gamepad && source.gamepad.buttons[0]) {
          triggerValue = source.gamepad.buttons[0].value;
          // if (window.screenLog && this._logThrottle % 60 === 0) window.screenLog(`TrigVal: ${triggerValue.toFixed(2)}`, "cyan");
        }

        // Universal Sub Mode: Override Tool Negative State
        const tool = this._sculptManager.getCurrentTool();
        const origNegative = tool ? tool._negative : false;
        if (isNegative && tool) tool._negative = !origNegative;

        this._sculptManager.updateXR(this._picking, isTriggerPressed, enginePos, dir, { isNegative: isNegative, controllers: xrControllers, triggerValue: triggerValue });

        // Restore original state immediately
        if (isNegative && tool) tool._negative = origNegative;
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

  toggleDesktopOffset() {
    this._desktopOffsetMode = !this._desktopOffsetMode;
    this.render();
  }

  toggleSpectatorCalibration() {
    this._isCalibratingSpectator = !this._isCalibratingSpectator;
    const label = this._isCalibratingSpectator ? "CALIBRATION MODE (Move Me)" : "Standard Mode";
    // if (window.screenLog) window.screenLog(label, this._isCalibratingSpectator ? "magenta" : "lime");
    console.log(label);
    this.render();
  }

  processSpectatorCalibration(handedness, origin, rotation) {
    const gState = this._vrGrip[handedness];

    if (!gState.active) {
      // START DRAG
      gState.active = true;
      vec3.copy(gState.startPoint, origin);
      quat.copy(gState.startRotation, rotation);
    } else {
      // DRAG (Translation)
      const delta = vec3.create();
      vec3.sub(delta, origin, gState.startPoint);

      // DRAG (Rotation)
      const deltaRot = quat.create();
      const invStart = quat.create();
      quat.invert(invStart, gState.startRotation);
      quat.multiply(deltaRot, rotation, invStart); // diff = current * invStart

      // Normalize deltaRot to avoid drift?
      quat.normalize(deltaRot, deltaRot);

      // Thresholds
      const moved = vec3.length(delta) > 0.0001;
      // Check angle?
      const angle = quat.getAxisAngle(vec3.create(), deltaRot); // This is expensive/dummy, just check similarity?
      // Just apply always if active?

      if (moved || Math.abs(angle) > 0.0001) {
        // Apply Translation
        this._desktopOffset[0] -= delta[0];
        this._desktopOffset[1] -= delta[1];
        this._desktopOffset[2] -= delta[2];

        // Apply Rotation (Accumulate)
        // Order: View = View * Rot.
        // We want to Rotate the "Spectator Rig".
        // If I rotate hand RIGHT, I want World to rotate RIGHT?
        // Or "Move Me"? If I rotate hand RIGHT (Clockwise), I am "Twisting the world Clockwise".
        // So the Camera should rotate Clockwise?
        // Let's try direct multiplication.
        quat.multiply(this._desktopRotation, this._desktopRotation, deltaRot);
        quat.normalize(this._desktopRotation, this._desktopRotation);

        // Reset Start Points (Incremental)
        vec3.copy(gState.startPoint, origin);
        quat.copy(gState.startRotation, rotation);

        // Force Render (Not needed during VR Frame Loop)
        // this.render();


      }
    }
  }
}





export default Scene;
