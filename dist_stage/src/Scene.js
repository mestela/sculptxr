import { vec3, mat3, mat4, quat } from 'gl-matrix';
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
import GazeTooltip from './drawables/GazeTooltip.js';


console.log("Scene.js loaded v0.7.658");

class Scene {

  constructor() {
    this._gl = null; // webgl context

    this._vrDeviceRadius = 0.05;

    // Feature Toggle: Aim (Ray) vs Touch (Sphere) picking
    this._vrUseVolumeIntersect = true;
    window.debugPickRay = true;

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
    // Debug Commands
    window.setGizmoScale = function (s) { window.debugGizmoScale = s; console.log("Gizmo Scale Forced: " + s); };
    window.attachGizmoToController = function () { window.debugGizmoAttach = 'controller'; console.log("Gizmo Attached to Controller"); };
    window.attachGizmoToWorld = function () { window.debugGizmoAttach = 'world'; console.log("Gizmo Attached to World (0,1,0)"); };
    window.attachGizmoToMesh = function () { window.debugGizmoAttach = 'mesh'; window.debugGizmoScale = undefined; console.log("Gizmo Attached to Mesh (Default)"); };

    this._meshPreview = null;
    this._torusLength = 0.5;
    this._torusWidth = 0.1;
    this._torusRadius = Math.PI * 2;
    this._torusRadial = 32;
    this._torusTubular = 128;

    // Fuzzer API
    window.startFuzzing = function () {
      window.vrFuzzMode = true;
      console.log("VR Fuzzer Started! Make sure you are in VR.");
      if (window.screenLog) window.screenLog("FUZZER ENABLED", "red");
    };
    window.stopFuzzing = function () {
      window.vrFuzzMode = false;
      console.log("VR Fuzzer Stopped.");
      if (window.screenLog) window.screenLog("FUZZER DISABLED", "lime");
    };

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

    this._cachedExitVrScale = this._vrScale;
    // [CALIBRATED DEFAULTS] Trans[0.01, 1.09, -0.34] Scale[0.99]
    // We only set the offset here if XRRigidTransform is available, else null and init later.
    // XRRigidTransform is usually available in window if Secure Context.
    this._xrWorldOffset = (typeof XRRigidTransform !== 'undefined')
      ? new XRRigidTransform({ x: 0.01, y: 1.09, z: -0.34 })
      : null;

    this._isCalibratingSpectator = false; // "Move Me" Mode
    this._spectatorMode = Enums.SpectatorMode.DECOUPLED;

    // STATIONARY Mode variables
    this._desktopOffset = vec3.create();
    this._desktopRotation = mat4.create();

    this._desktopCameraCache = {
      view: mat4.create(),
      proj: mat4.create(),
      trans: vec3.create(),
      quatRot: quat.create(),
      center: vec3.create(),
      offset: vec3.create()
    };

    this._activeHandedness = 'right';
    this._vrScale = 0.008; // Scale 100-unit world to 0.8 meters (User Req: "25% too big")
    this._exposure = 1.0; // Reset to 1.0 after fixing ShaderMerge 5x boost

    this._exposure = 1.0; // Reset to 1.0 after fixing ShaderMerge 5x boost

    this._vrGrip = {
      left: { active: false, startPoint: vec3.create(), startRotation: quat.create() },
      right: { active: false, startPoint: vec3.create(), startRotation: quat.create() }
    };

    // Initial World Offset (Camera pulled back 55cm, Lifted 1.2m)
    // Fix: Y=0 put it on the floor. Y=1.2 should be chest/head height.
    this._xrWorldOffset = new XRRigidTransform({ x: 0, y: 1.2, z: -0.55 });

    window.debugSpectator = () => {
      console.log("=== SPECTATOR DEBUG ===");
      console.log("Desktop Mode:", this._spectatorMode);
      console.log("VR Scale:", this._vrScale);
      console.log("World Offset Pos:", this._xrWorldOffset ? `x:${this._xrWorldOffset.position.x.toFixed(2)} y:${this._xrWorldOffset.position.y.toFixed(2)} z:${this._xrWorldOffset.position.z.toFixed(2)}` : "null");
      console.log("Desktop Cache View:", Array.from(this._desktopCameraCache.view).map(n => parseFloat(n).toFixed(2)).join(", "));
      console.log("Desktop Cache Proj:", Array.from(this._desktopCameraCache.proj).map(n => parseFloat(n).toFixed(2)).join(", "));
      console.log("Current Camera View:", Array.from(this._camera._view).map(n => parseFloat(n).toFixed(2)).join(", "));
      console.log("Current Camera Proj:", Array.from(this._camera._proj).map(n => parseFloat(n).toFixed(2)).join(", "));
      console.log("Camera Trans:", Array.from(this._camera._trans).map(n => parseFloat(n).toFixed(2)).join(", "));
      console.log("Camera Rot:", Array.from(this._camera._quatRot).map(n => parseFloat(n).toFixed(2)).join(", "));
      console.log("Camera Center:", Array.from(this._camera._center).map(n => parseFloat(n).toFixed(2)).join(", "));
      console.log("Camera Offset:", Array.from(this._camera._offset).map(n => parseFloat(n).toFixed(2)).join(", "));
      return "Check console for matrix dump.";
    };

    window.forceDesktopCameraTrans = (x, y, z) => {
      this._camera._trans[0] = x;
      this._camera._trans[1] = y;
      this._camera._trans[2] = z;
      this._camera.updateView();
      // Update cache
      mat4.copy(this._desktopCameraCache.view, this._camera._view);
      mat4.copy(this._desktopCameraCache.proj, this._camera._proj);
      return `Forced Trans to: ${x}, ${y}, ${z}`;
    };

    window.testSpectatorScale = (s) => {
      window._debugSpectatorScale = s;
      return `Testing custom scale: ${s}`;
    };

    window.debugSpectatorRender = () => {
      window._triggerSpectatorLog = true;
      return "Dump triggered for next frame...";
    };
    this._vrTwoHanded = { active: false, prevMid: vec3.create(), prevDist: 0.0, prevVec: vec3.create() };

    // VR Menu State
    this._guiXR = null;
    this._vrMenu = null;
    this._vrPoseLeft = null;
    this._vrPoseRight = null;

    // Desktop 6DOF Offset (Spectator Camera)
    // Offset relative to HMD: [x, y, z] in meters.
    // User Request: "Move forward 50cm, up 50cm".
    // Note: If HMD is facing User, "Forward" is towards User.
    // If we Rotate 180, we are looking effectively "Standard Forward".

    // [Step 1] Hand Swap Feature
    this._dominantHand = 'right'; // 'right' or 'left'
    this._selectionLocked = false; // Lock Selection State
    this._vrIsNegative = false; // Universal Sub Mode State

    // VR Ergonomics: Hybrid Button Trackers
    this._vrButtonStates = {
      left: { Primary: { pressed: false, time: 0 }, Trigger: { pressed: false, time: 0 } },
      right: { Primary: { pressed: false, time: 0 }, Trigger: { pressed: false, time: 0 } }
    };
    this._vrSubtractActive = false;
    this._vrSmoothOverride = false;
  }

  start() {

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

    if (!this._guiXR) this._guiXR = new GuiXR(this);
    this._guiXR.init(this._gl);

    if (!this._guiMini) {
      // Create a much taller, narrower canvas for the Mini-HUD (e.g. 300x500)
      this._guiMini = new GuiXR(this, null, 300, 500);
      this._guiMini._isMiniHUD = true;
      this._guiMini._isVisible = true; // Always visible
    }
    this._guiMini.init(this._gl);

    if (!this._guiPopup) {
      this._guiPopup = new GuiXR(this, null, 660, 660);
      this._guiPopup._isPopupHUD = true;
      this._guiPopup._isVisible = true; // Managed by overlay presence
    }
    this._guiPopup.init(this._gl);

    // Create VRMenus if they don't exist
    if (!this._vrMenu) this._vrMenu = new VRMenu(this._gl, this._guiXR);
    if (!this._vrMiniHUD) {
      this._vrMiniHUD = new VRMenu(this._gl, this._guiMini);
      // Strip the baked-in Main Menu 15cm offset so we can control position precisely relative to grip
      this._vrMiniHUD.setOffset(0, 0, 0);
      this._vrMiniHUD.setRotation(0, 0, 0);
    }
    if (!this._vrPopup) {
      this._vrPopup = new VRMenu(this._gl, this._guiPopup);
      this._vrPopup.setOffset(0, 0, 0);
      this._vrPopup.setRotation(0, 0, 0);
    }

    // Global override for live tuning
    window.MINI_HUD_TRANSFORM = {
      x: 0,
      y: 0.05,
      z: 0.1,
      rx: 90,
      ry: 0,
      rz: 0
    };

    // Init Gaze Tooltips
    this._gazeTooltipLeft = new GazeTooltip(this._gl, "Hold X: Menu");
    this._gazeTooltipRight = new GazeTooltip(this._gl, "Hold A: Sub");

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

      // Force Voxel Start if Voxel Tool provided
      if (toolName === 'SculptVoxel' && tool.forceInit) {
        tool.forceInit();
      }
    }

    // [DEBUG] Pivot Sphere Helpers
    window.debugPivotScale = 0.02; // Default 2cm
    window.debugPivotAttach = false; // Default: World Pivot

    window.setPivotScale = (s) => {
      window.debugPivotScale = s;
      console.log(`Pivot Scale: ${s}`);
      if (window.screenLog) window.screenLog(`Pivot Scale: ${s}`, "lime");
    };

    window.attachPivotToController = (val) => {
      if (window.screenLog) window.screenLog(`Pivot Mode: ${val}`, "lime");
    };

    // window.debugGizmoScale = 0.0; // REMOVED: Caused initial visibility issue
    window.setGizmoScale = (s) => {
      window.debugGizmoScale = s;
      console.log(`Gizmo Scale Force: ${s}`);
      if (window.screenLog) window.screenLog(`Gizmo Scale: ${s}`, "cyan");
    };

    // [DEBUG] Hit Sphere Helpers (User Requested)
    window.debugHitScale = 0.02; // Default 2cm
    window.debugHitAttach = 'hit'; // 'hit', 'controller', 'origin', 'mesh'

    window.setDebugScale = (s) => {
      window.debugHitScale = s;
      console.log(`Debug Hit Scale: ${s}`);
      if (window.screenLog) window.screenLog(`Hit Scale: ${s}`, "lime");
    };

    window.setDebugAttach = (mode) => {
      // mode: 'hit' (default), 'controller', 'origin', 'mesh'
      window.debugHitAttach = mode;
      console.log(`Debug Attach Mode: ${mode}`);
      if (window.screenLog) window.screenLog(`Attach: ${mode}`, "lime");
    };

    window.debugQuerySpace = () => {
      const scale = this._vrScale || 50.0;
      const invScale = 1.0 / scale;
      console.log("=== Space Query ===");
      console.log("vrScale (World->Meters):", scale);
      console.log("1 Unit =", (scale).toFixed(4), "Meters");
      console.log("1 Meter =", (invScale).toFixed(4), "Units");

      const p = this._picking.getIntersectionPoint();
      if (p) {
        console.log("Last Hit (Local):", p);
        const m = this._picking.getMesh();
        if (m) {
          const worldPt = vec3.create();
          vec3.transformMat4(worldPt, p, m.getMatrix());
          console.log("Last Hit (World):", worldPt);
          console.log("Last Hit (Meters approx):", [worldPt[0] * scale, worldPt[1] * scale, worldPt[2] * scale]);
        }
      } else {
        console.log("No Last Hit");
      }

      if (this._debugHitSphere) {
        const mat = this._debugHitSphere.getMatrix();
        const pos = [mat[12], mat[13], mat[14]];
        const s = Math.hypot(mat[0], mat[1], mat[2]);
        console.log("Sphere Matrix Pos:", pos);
        console.log("Sphere Matrix Scale:", s);
        console.log("Sphere Matrix Scale (Meters):", s * scale);
      }
      return "Check Console";
    };

    // EXPOSE SCENE FOR DEBUGGING
    window.debugScene = this;

    window.debugCheckScale = () => {
      console.log("VR Scale:", this._vrScale);
      console.log("Debug Hit Scale:", window.debugHitScale || 0.02);
      return this._vrScale;
    };

    window.debugForceXYZ = (x, y, z, r) => {
      this._forceDebugXYZ = vec3.fromValues(x, y, z);
      this._forceDebugRadius = r || 0.05; // 5cm default
      return "Forcing Sphere to " + x + "," + y + "," + z;
    };

    window.debugTestSphere = () => {
      const cam = this._camera;
      if (!cam) return "No Camera";

      const pos = vec3.create();
      const fwd = vec3.fromValues(0, 0, -1);
      const q = cam._quatRot; // Use internal quat
      vec3.transformQuat(fwd, fwd, q);

      const scale = this._vrScale || 50.0;
      let dist = 0.5 / scale; // 0.5 Meters / Scale = World Units

      const camPos = cam.computePosition();
      vec3.scaleAndAdd(pos, camPos, fwd, dist);

      console.log("Camera Pos:", camPos);
      console.log("VR Scale:", scale);
      console.log("Sphere Dist (World):", dist);
      console.log("Sphere Pos:", pos);

      this._forceDebugRawScale = true; // FORCE VISIBILITY
      return window.debugForceXYZ(pos[0], pos[1], pos[2], 0.05);
    };

    window.getPivotInfo = () => {
      if (!this._debugPivotSphere) return "No Debug Sphere";
      const m = this._debugPivotSphere.getMatrix();
      const pos = [m[12], m[13], m[14]];
      const scale = [
        Math.hypot(m[0], m[1], m[2]),
        Math.hypot(m[4], m[5], m[6]),
        Math.hypot(m[8], m[9], m[10])
      ];
      console.log("Pivot Sphere Pos:", pos);
      console.log("Pivot Sphere Scale:", scale);

      if (this._mesh) {
        console.log("Mesh Center (Local):", this._mesh.getCenter());
        console.log("Mesh Matrix:", this._mesh.getMatrix());
      } else {
        console.log("No Mesh Selected");
      }
      return { pos, scale };
    };
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
    if (window.screenLog && window._debugCursorLog) {
      window.screenLog(`setCanvasCursor('${style}') HIDDEN=${window.isUIHiddenForVR}`, "orange");
    }

    if (window.isUIHiddenForVR && style !== 'none') {
      if (window.screenLog && window._debugCursorLog) window.screenLog(`Blocked style: ${style}`, "red");
      return;
    }

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
    if (this._preventRender === true)
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
    var targetFBO = (arg && typeof arg === 'object') ? arg : null;
    this._preventRender = false;
    this.updateMatricesAndSort();

    var gl = this._gl;
    if (!gl) return;

    // During XR, the canvas is rendered by onXRFrame (Spectator Camera)
    // We only want to update the DOM GUI, not WebGL canvas here.
    if (this._xrSession) {
      if (this._sculptManager) this._sculptManager.postRender();
      return;
    }

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
  _renderSceneVR(cam, viewMatrix, projMatrix, worldViewMatrixOverride = null) {
    const gl2 = this._gl;
    const meshes2 = this._meshes;

    // --- SETUP VIEW ---
    mat4.copy(cam._view, viewMatrix);
    mat4.copy(cam._proj, projMatrix);

    // --- PASS 1: REAL WORLD (Controllers/Debug) ---
    // (Rendered unscaled, purely relative to the camera lens)

    // Render Controllers
    if (this._vrControllerLeft) {
      this._vrControllerLeft.updateMatrices(cam);
      this._vrControllerLeft.render(this);
    }

    if (this._vrControllerRight) {
      this._vrControllerRight.updateMatrices(cam);
      this._vrControllerRight.render(this);
    }

    // VR Main Menu (Full Size)
    const menuAnchor = this._dominantHand === 'left' ? this._vrPoseRight : this._vrPoseLeft;
    if (this._vrMenu && menuAnchor) {
      const menuPose = mat4.clone(menuAnchor);
      const lift = mat4.create();
      const sideOffset = this._dominantHand === 'left' ? -0.35 : 0.0;
      mat4.fromTranslation(lift, [sideOffset, 0.03, 0.0]);
      mat4.multiply(menuPose, menuPose, lift);
      this._vrMenu.updateMatrices(cam, menuPose);
      this._vrMenu.render(this);
    }

    // VR Mini-HUD (Wrist Mounted)
    if (this._vrMiniHUD && menuAnchor && (!this._guiXR || !this._guiXR._isVisible)) {
      const hudPose = mat4.clone(menuAnchor);
      const liftHUD = mat4.create();

      const tform = window.MINI_HUD_TRANSFORM || { x: 0, y: 0.05, z: 0.1, rx: 90, ry: 0, rz: 0 };

      // Apply mirror logic for dominant hand if needed.
      // E.g. we want it on the inside of the controller.
      // A default of x:0 means perfectly centered on the handle.
      const signX = this._dominantHand === 'left' ? -1 : 1;

      mat4.fromTranslation(liftHUD, [tform.x * signX, tform.y, tform.z]);

      mat4.rotateX(liftHUD, liftHUD, tform.rx * Math.PI / 180.0);
      mat4.rotateY(liftHUD, liftHUD, (tform.ry * signX) * Math.PI / 180.0);
      mat4.rotateZ(liftHUD, liftHUD, tform.rz * Math.PI / 180.0);

      mat4.multiply(hudPose, hudPose, liftHUD);

      // Scale up slightly just for legibility if needed, but 1.0 is physically accurate
      const miniScale = 1.0;
      mat4.scale(hudPose, hudPose, [miniScale, miniScale, miniScale]);

      this._vrMiniHUD.updateMatrices(cam, hudPose);
      this._vrMiniHUD.render(this);

      // Render Popup slightly forward and above the MiniHUD center
      if (this._vrPopup && this._guiPopup && this._guiPopup._overlay) {
        let popupPose = mat4.clone(hudPose);
        let popupLift = mat4.create();

        // Default offsets
        let px = 0.0;
        let py = 0.032;
        let pz = -0.015;

        // Interactive overrides via PCVR DevTools console
        if (window.tpDebug) {
          if (window.tpDebug.x !== undefined) px = window.tpDebug.x;
          if (window.tpDebug.y !== undefined) py = window.tpDebug.y;
          if (window.tpDebug.z !== undefined) pz = window.tpDebug.z;
        }

        mat4.fromTranslation(popupLift, [px, py, pz]);
        mat4.multiply(popupPose, popupPose, popupLift);
        this._vrPopup.updateMatrices(cam, popupPose);
        this._vrPopup.render(this);
      }
    }

    // VRLaser (Pass 1)
    if (this._vrLaser && this._vrLaserMatrix && this._isPointingAtMenu) {
      const dist = this._vrLaserDistance || 1.0;
      this._vrLaser.updateMatrices(cam, this._vrLaserMatrix, dist, 0.01);
      this._vrLaser.render(this);
    }

    // Debug Pivot
    if (this._debugPivotMesh && this._debugPivotMesh.isVisible()) {
      gl2.disable(gl2.DEPTH_TEST);
      this._debugPivotMesh.updateMatrices(cam);
      this._debugPivotMesh.render(this);
      gl2.enable(gl2.DEPTH_TEST);
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
    if (worldViewMatrixOverride) {
      mat4.copy(cam._view, worldViewMatrixOverride);
    } else {
      // Apply standard physical VR Headset/Controller World Transforms
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
    }

    // Grid
    if (this._showGrid && this._grid) {
      this._grid.updateMatrices(cam);
      this._grid.render(this);
    }

    // Meshes (Opaque)
    for (let k = 0, l = meshes2.length; k < l; ++k) {
      if (!meshes2[k].isVisible()) continue;
      meshes2[k].updateMatrices(cam);
      meshes2[k].render(this);
    }

    // Meshes (Wireframe)
    gl2.enable(gl2.BLEND);
    gl2.depthFunc(gl2.LESS);
    for (let k = 0, l = meshes2.length; k < l; ++k) {
      if (meshes2[k].getShowWireframe()) meshes2[k].renderWireframe(this);
    }
    gl2.depthFunc(gl2.LEQUAL);
    gl2.disable(gl2.BLEND);

    // Brush Indicator (Pass 2 - World Space)
    var currentTool = this._sculptManager ? this._sculptManager.getCurrentTool() : null;
    var isVoxel = currentTool && currentTool.constructor.name === 'SculptVoxel';

    if (this._sculptManager && this._picking.getMesh() && !isVoxel) {
      let radius = this._picking._rWorld2 ? Math.sqrt(this._picking._rWorld2) : 0.05;

      // Force radius to 0.5 for Gizmo interactions
      const currentTool = this._sculptManager.getCurrentTool();
      if (currentTool && currentTool.constructor.name === 'TransformVR') {
        if (currentTool._gizmo && currentTool._gizmo._selected) {
          radius = 0.5;
        }
      }

      // Update Selection Color for Negative Mode
      const selection = this._sculptManager.getSelection();
      if (selection.setIsNegative) selection.setIsNegative(this._vrIsNegative);

      gl2.disable(gl2.DEPTH_TEST);
      gl2.enable(gl2.BLEND);
      gl2.blendFunc(gl2.SRC_ALPHA, gl2.ONE_MINUS_SRC_ALPHA);
      selection.renderVR(this, cam, radius);
      gl2.disable(gl2.BLEND);
      gl2.enable(gl2.DEPTH_TEST);
    }

    // [DEBUG] Pivot Sphere (World Space / Mesh Mode) - DISABLED (User: "hangover")
    if (false && this._debugPivotSphere && !window.debugPivotAttach && this._mesh) {
      const mPivot = this._debugPivotSphere.getMatrix();
      mat4.identity(mPivot);

      const center = vec3.create();
      vec3.transformMat4(center, this._mesh.getCenter(), this._mesh.getMatrix());
      mat4.translate(mPivot, mPivot, center);

      // Compensate for VR Scale so it remains "Physically 2cm"
      // If World has scale S, we need radius R/S.
      let r = window.debugPivotScale || 0.02;
      if (this._vrScale && this._vrScale > 0.0001) r /= this._vrScale;
      mat4.scale(mPivot, mPivot, [r, r, r]);

      this._debugPivotSphere.updateMatrices(cam);

      gl2.enable(gl2.BLEND);
      gl2.blendFunc(gl2.ONE, gl2.ONE);
      gl2.depthMask(false);
      gl2.disable(gl2.CULL_FACE);
      gl2.disable(gl2.DEPTH_TEST);
      this._debugPivotSphere.render(this);
      gl2.enable(gl2.DEPTH_TEST);
    }

    // Render Current Tool VR (Gizmo, etc.)
    if (this._sculptManager) {
      const tool = this._sculptManager.getCurrentTool();
      if (tool && tool.renderVR) {
        tool.renderVR(this, cam);
      }
    }

    // [DEBUG] Hit Sphere (Pass 2 - World Space)
    if (this._debugHitSphere) {
      // INTERACTIVE DEBUGGER: VR Raycaster Visuals (Rendered in Engine Space)
      if (window.debugRaycaster) {
        gl2.disable(gl2.DEPTH_TEST);

        if (this._debugRayOrigin) {
          this._debugRayOrigin.updateMatrices(cam);
          this._debugRayOrigin.render(this);
        }
        if (this._debugRayTarget) {
          this._debugRayTarget.updateMatrices(cam);
          this._debugRayTarget.render(this);
        }

        gl2.enable(gl2.DEPTH_TEST);
      }

      if (this._forceDebugXYZ) {
        const mHit = this._debugHitSphere.getMatrix();
        mat4.identity(mHit);
        mat4.translate(mHit, mHit, this._forceDebugXYZ);

        let s = this._forceDebugRadius;
        // Convert Meters to World Units (unless forced raw)
        if (!this._forceDebugRawScale && this._vrScale && this._vrScale > 0.0001) s /= this._vrScale;

        mat4.scale(mHit, mHit, [s, s, s]);
        console.log(`[ForceDebug] Pos: ${this._forceDebugXYZ} Scale: ${s}`);
        // this._debugHitSphere.render(this);

      } else if (window.debugHitAttach !== 'controller') {
        const mode = window.debugHitAttach || 'hit';
        const mHit = this._debugHitSphere.getMatrix();

        // If mode is 'hit', Picking.js/GizmoVR.js updates the matrix.
        // If mode is 'mesh' or 'origin', we update it here.
        if (mode === 'origin') {
          mat4.identity(mHit);
          let s = window.debugHitScale || 0.02;
          if (this._vrScale && this._vrScale > 0.0001) s /= this._vrScale;
          mat4.scale(mHit, mHit, [s, s, s]);
          this._debugHitSphere.setVisible(true);

        } else if (mode === 'mesh' && this._mesh) {
          mat4.identity(mHit);
          const center = vec3.create();
          vec3.transformMat4(center, this._mesh.getCenter(), this._mesh.getMatrix());
          mat4.translate(mHit, mHit, center);
          let s = window.debugHitScale || 0.02;
          if (this._vrScale && this._vrScale > 0.0001) s /= this._vrScale;
          mat4.scale(mHit, mHit, [s, s, s]);
          this._debugHitSphere.setVisible(true);
        }

        if (this._debugHitSphere.isVisible()) {
          // Backup Matrix (because updateMatrices might reset it if it thinks it's dirty from pos/rot/scale)
          const mBackup = mat4.clone(this._debugHitSphere.getMatrix());

          this._debugHitSphere.updateMatrices(cam);

          // RESTORE Matrix
          const m = this._debugHitSphere.getMatrix();
          mat4.copy(m, mBackup);

          // Debug Log
          if (window.debugGizmoIntersection && !this._logSphereThrottle) this._logSphereThrottle = 0;
          if (window.debugGizmoIntersection && this._logSphereThrottle++ % 120 === 0) {
            const pos = [m[12], m[13], m[14]];
            const s = Math.hypot(m[0], m[1], m[2]);
            const vrScale = this._vrScale || 50.0;
            console.log(`[Scene Pass 2] Sphere Pos: [${pos[0].toFixed(2)}, ${pos[1].toFixed(2)}, ${pos[2].toFixed(2)}] Scale: ${s.toFixed(4)} (Meters: ${(s * vrScale).toFixed(4)})`);
          }

          gl2.enable(gl2.BLEND);
          gl2.blendFunc(gl2.ONE, gl2.ONE);
          gl2.depthMask(false);
          gl2.disable(gl2.CULL_FACE);
          gl2.disable(gl2.DEPTH_TEST);
          // this._debugHitSphere.render(this);
          gl2.enable(gl2.DEPTH_TEST);
          gl2.disable(gl2.BLEND);
        }
      }
    }

    // --- PASS 3: OVERLAY (Reset View) ---
    // Reset View Matrix to Base
    mat4.copy(cam._view, viewMatrix);

    // [DEBUG] Pivot Sphere (Physical Space / Controller Mode)
    if (this._debugPivotSphere && window.debugPivotAttach) {
      const mPivot = this._debugPivotSphere.getMatrix();
      mat4.identity(mPivot);

      if (window.debugPivotAttach === true && this._vrDominantRayMatrix) {
        mat4.copy(mPivot, this._vrDominantRayMatrix);
        const offY = this._isQuestStandalone ? 0.10 : 0.05;
        mat4.rotateX(mPivot, mPivot, -Math.PI / 2);
        mat4.translate(mPivot, mPivot, [0, offY, 0]);
        mat4.translate(mPivot, mPivot, [0, 0.20, 0]); // 20cm
      } else if (window.debugPivotAttach === "origin") {
        // Origin 0,0,0
      }

      const r = window.debugPivotScale || 0.02;
      mat4.scale(mPivot, mPivot, [r, r, r]);

      this._debugPivotSphere.updateMatrices(cam);

      gl2.enable(gl2.BLEND);
      gl2.blendFunc(gl2.ONE, gl2.ONE);
      gl2.depthMask(false);
      gl2.disable(gl2.CULL_FACE);
      gl2.disable(gl2.DEPTH_TEST);
      this._debugPivotSphere.render(this);
      gl2.enable(gl2.DEPTH_TEST);
    }

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
      // We explicitly DO NOT multiply by any UI comp scale. This is a native 3D physical object.
      mat4.scale(mSphere, mSphere, [r, r, r]);

      // Tint the sphere based on positive/negative mode to match the radius circle.
      // Selection ring uses Red for negative, Blue for positive. 
      // Base color is [0.5, 0.5, 0.5], so we tint slightly towards red/blue.
      if (this._vrIsNegative) {
        this._vrBrushRadiusSphere.setFlatColor([0.7, 0.3, 0.3]); // Slightly Red
      } else {
        this._vrBrushRadiusSphere.setFlatColor([0.3, 0.3, 0.7]); // Slightly Blue
      }

      this._vrBrushRadiusSphere.updateMatrices(cam);

      gl2.enable(gl2.BLEND);
      gl2.blendFunc(gl2.ONE, gl2.ONE);
      gl2.depthMask(false);
      gl2.disable(gl2.CULL_FACE);
      gl2.enable(gl2.DEPTH_TEST);

      this._vrBrushRadiusSphere.render(this);

      gl2.enable(gl2.DEPTH_TEST);
      gl2.enable(gl2.CULL_FACE);
      gl2.depthMask(true);
      gl2.disable(gl2.BLEND);
    }

    // [DEBUG] Hit Sphere (Render Pass 3 - Physical/Overlay Space)
    if (this._debugHitSphere && window.debugHitAttach === 'controller') {
      const mHit = this._debugHitSphere.getMatrix();
      if (this._vrDominantRayMatrix) {
        mat4.copy(mHit, this._vrDominantRayMatrix);
        const offY = this._isQuestStandalone ? 0.075 : 0.025;
        mat4.rotateX(mHit, mHit, -Math.PI / 2);
        mat4.translate(mHit, mHit, [0, offY + 0.05, 0]); // 5cm past tip

        const s = window.debugHitScale || 0.02;
        mat4.scale(mHit, mHit, [s, s, s]);
        this._debugHitSphere.setVisible(true);

        this._debugHitSphere.updateMatrices(cam);

        gl2.enable(gl2.BLEND);
        gl2.blendFunc(gl2.ONE, gl2.ONE);
        gl2.depthMask(false);
        gl2.disable(gl2.CULL_FACE);
        gl2.disable(gl2.DEPTH_TEST); // Always on top
        // this._debugHitSphere.render(this);
        gl2.enable(gl2.DEPTH_TEST);
        gl2.disable(gl2.BLEND);
      }
    }

    // [DEBUG] Gizmo Test Sphere (Render Pass 3 Copy)
    if (this._debugGizmoSphere && this._vrDominantRayMatrix) {
      const mGizmo = this._debugGizmoSphere.getMatrix();
      mat4.copy(mGizmo, this._vrDominantRayMatrix);
      const offY = this._isQuestStandalone ? 0.10 : 0.05;

      // Rotate basic alignment (same as radius sphere)
      mat4.rotateX(mGizmo, mGizmo, -Math.PI / 2);
      mat4.translate(mGizmo, mGizmo, [0, offY, 0]);

      // OFFSET 10cm along -Z (Ray Direction)
      // Since we rotated -90 X, Local Z became World Y? 
      // Let's look at tip alignment: rotateX(-90). 
      // Original: Y=Up, Z=Forward.
      // Rotated: Y->Z (Forward), Z->-Y (Down).
      // Wait. Standard GL: Y=Up, -Z=Forward.
      // Controller Grip: -Z is usually "Forward" (pointing away from user).
      // If we rotate X -90...
      // Y axis becomes -Z axis.
      // So translating Y moves along -Z.

      // Let's ADD 0.10 to the Y translation to move it FURTHER out.
      mat4.translate(mGizmo, mGizmo, [0, 0.10, 0]); // Add 10cm offset

      // Normalize Scale (same logic)
      const sx = Math.hypot(mGizmo[0], mGizmo[1], mGizmo[2]);
      const sy = Math.hypot(mGizmo[4], mGizmo[5], mGizmo[6]);
      const sz = Math.hypot(mGizmo[8], mGizmo[9], mGizmo[10]);
      if (sx > 1e-6) { mGizmo[0] /= sx; mGizmo[1] /= sx; mGizmo[2] /= sx; }
      if (sy > 1e-6) { mGizmo[4] /= sy; mGizmo[5] /= sy; mGizmo[6] /= sy; }
      if (sz > 1e-6) { mGizmo[8] /= sz; mGizmo[9] /= sz; mGizmo[10] /= sz; }

      // Fixed tiny size for debug
      const r = 0.02; // 2cm radius
      mat4.scale(mGizmo, mGizmo, [r, r, r]);

      this._debugGizmoSphere.updateMatrices(cam);

      gl2.enable(gl2.BLEND);
      gl2.blendFunc(gl2.ONE, gl2.ONE);
      gl2.depthMask(false);
      gl2.disable(gl2.CULL_FACE);
      gl2.enable(gl2.DEPTH_TEST);

      // this._debugGizmoSphere.render(this);

      gl2.enable(gl2.DEPTH_TEST);
      gl2.enable(gl2.CULL_FACE);
      gl2.depthMask(true);
      gl2.disable(gl2.BLEND);
    }

    // --- GAZE TOOLTIPS (Pass 3) ---
    // Calculate Headset Forward Vector
    const headsetPos = cam.computePosition();
    const headsetFwd = vec3.transformQuat(vec3.create(), [0, 0, -1], cam._quatRot);

    // Helper for Ray-Point Distance calculation
    const distToRay = (rayOrigin, rayDir, point) => {
      const w = vec3.subtract(vec3.create(), point, rayOrigin);
      const projAngle = vec3.dot(w, rayDir);

      // If the point is behind the ray origin, it's not a match
      if (projAngle <= 0) return Infinity;

      const projVec = vec3.scale(vec3.create(), rayDir, projAngle);
      const closestPoint = vec3.add(vec3.create(), rayOrigin, projVec);
      return vec3.distance(point, closestPoint);
    };

    const GAZE_THRESHOLD = 0.20; // 20cm radius around controller

    // Left Controller Tooltip
    if (this._vrControllerLeft && this._gazeTooltipLeft && this._vrPoseLeft) {
      const ctlPos = [this._vrPoseLeft[12], this._vrPoseLeft[13], this._vrPoseLeft[14]];
      const dist = distToRay(headsetPos, headsetFwd, ctlPos);

      const targetOpacity = (dist < GAZE_THRESHOLD) ? 1.0 : 0.0;
      // Fade over time based on delta (assuming ~60fps, 0.1 delta = 6 frames to fade)
      this._gazeTooltipLeft._opacity += (targetOpacity - this._gazeTooltipLeft._opacity) * 0.15;
      this._gazeTooltipLeft.setOpacity(this._gazeTooltipLeft._opacity);

      if (this._gazeTooltipLeft._isVisible) {
        this._gazeTooltipLeft.updateMatrices(cam, ctlPos);
        this._gazeTooltipLeft.render();
      }
    }

    // Right Controller Tooltip
    if (this._vrControllerRight && this._gazeTooltipRight && this._vrPoseRight) {
      const ctlPos = [this._vrPoseRight[12], this._vrPoseRight[13], this._vrPoseRight[14]];
      const dist = distToRay(headsetPos, headsetFwd, ctlPos);

      const targetOpacity = (dist < GAZE_THRESHOLD) ? 1.0 : 0.0;
      this._gazeTooltipRight._opacity += (targetOpacity - this._gazeTooltipRight._opacity) * 0.15;
      this._gazeTooltipRight.setOpacity(this._gazeTooltipRight._opacity);

      if (this._gazeTooltipRight._isVisible) {
        this._gazeTooltipRight.updateMatrices(cam, ctlPos);
        this._gazeTooltipRight.render();
      }
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
    // if (this._vrControllerLeft) this._vrControllerLeft.render(this);
    // if (this._vrControllerRight) this._vrControllerRight.render(this);

    // Debug Cursor
    // if (this._debugCursor && this._debugCursor.isVisible()) this._debugCursor.render(this);

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

    // VR cursors are drawn via _vrBrushRadiusSphere on Pass 3.
    // Desktop cursors are drawn via SculptManager.postRender() on the null framebuffer.
    // We no longer call selection.renderVR here, avoiding duplicate cursors inside the headset.

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
      alpha: true, // Enable alpha for AR Passthrough
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

  // ... wait, removing keyboard completely? Let's keep toggleWireframe
  onKeyDown(event) {
    if (event.handled === true) return;
    event.handled = true;
    switch (event.which) {
      case 87: // W
        // this.getSculptManager().getTool(Enums.Tools.WIREFRAME).toggle();
        this.render();
        break;
    }
  }
  enterXR(session) {
    this._xrSession = session;
    session.addEventListener('end', this.onXREnd.bind(this));

    // Cache the standard desktop camera exactly ONCE before any VR resolutions
    // or matrices pollute the state.
    this._camera.updateView();
    this._camera.updateProjection();
    mat4.copy(this._desktopCameraCache.view, this._camera._view);
    mat4.copy(this._desktopCameraCache.proj, this._camera._proj);
    vec3.copy(this._desktopCameraCache.trans, this._camera._trans);
    quat.copy(this._desktopCameraCache.quatRot, this._camera._quatRot);
    vec3.copy(this._desktopCameraCache.center, this._camera._center);
    vec3.copy(this._desktopCameraCache.offset, this._camera._offset);

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
      // By default, XRWebGLLayer creates an opaque buffer even if the canvas has alpha: true.
      // We MUST explicitly request an alpha channel here or immersive-ar passthrough will be solid black.
      const baseLayer = new XRWebGLLayer(session, gl, { alpha: true });
      session.updateRenderState({ baseLayer, depthNear: 0.01, depthFar: 10000.0 });

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
    this._headHeightCalibrated = false;
  }

  computeEngineToPhysicalMatrix(out) {
    mat4.identity(out);
    if (this._xrWorldOffset) {
      const t = this._xrWorldOffset.position;
      const r = this._xrWorldOffset.orientation;
      mat4.fromRotationTranslation(out, [r.x, r.y, r.z, r.w], [t.x, t.y, t.z]);
    }
    if (this._vrScale !== 1.0) {
      mat4.scale(out, out, [this._vrScale, this._vrScale, this._vrScale]);
    }
    return out;
  }

  updateVROffsets() {
    if (!this._baseRefSpace) return;

    let valY = -1.2;
    const sliderY = document.getElementById('offsetY');
    if (sliderY) {
      valY = parseFloat(sliderY.value);
    } else if (this._guiXR && this._guiXR._uiSettings && this._guiXR._uiSettings.offsetY !== undefined) {
      valY = this._guiXR._uiSettings.offsetY;
    }

    const valZ = 0.4;
    const heightOffset = -valY; 

    if (this._prevOffsetY === undefined) {
      // INITIAL STARTUP: Overwrite the absolute Y height with the UI value.
      // (Preserving any Z offsets already present from the constructor)
      if (!this._xrWorldOffset) {
        this._xrWorldOffset = new XRRigidTransform({ x: 0, y: heightOffset, z: -valZ });
      } else {
        const p = this._xrWorldOffset.position;
        const o = this._xrWorldOffset.orientation;
        this._xrWorldOffset = new XRRigidTransform({ x: p.x, y: heightOffset, z: p.z }, o);
      }
    } else {
      // LIVE SLIDER: If slider is moved in VR, apply the delta to the current navigation state
      if (this._xrWorldOffset) {
        const deltaY = heightOffset - this._prevOffsetY;
        if (Math.abs(deltaY) > 0.001) {
          const p = this._xrWorldOffset.position;
          const o = this._xrWorldOffset.orientation;
          this._xrWorldOffset = new XRRigidTransform({ x: p.x, y: p.y + deltaY, z: p.z }, o);
        }
      }
    }

    this._prevOffsetY = heightOffset;

    // We intentionally DO NOT create `this._xrRefSpace` anymore because 
    // 6DoF mode requires raw headset poses from `_baseRefSpace`.
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

    // Restore the exact Desktop view from before VR
    vec3.copy(this._camera._trans, this._desktopCameraCache.trans);
    quat.copy(this._camera._quatRot, this._desktopCameraCache.quatRot);
    vec3.copy(this._camera._center, this._desktopCameraCache.center);

    this._camera.updateView();
    this._camera.updateProjection();

    // Prevent lingering tools from thinking they are active
    if (this._vrSculpting) {
      this._vrSculpting = false;
      if (this._sculptManager) this._sculptManager.end();
    }

    this._vrControllerLeft = null;
    this._vrControllerRight = null;
    this.initVRControllers();

    // 1. [v0.8.62 Fix] Force Mesh MVPs to flush the microscopic VR scale immediately.
    // If we don't do this, the very first desktop mouse clicks will raycast into tiny invisible VR bounds and fail to select anything.
    this.updateMatricesAndSort();

    // 2. [v0.8.62 Fix] Force the Desktop GUI to sync its highlighted tool with the VR SculptManager's active tool
    const guiSculpt = this._gui ? this._gui._ctrlSculpting : null;
    if (guiSculpt && guiSculpt._ctrlSculpt) {
      guiSculpt._ctrlSculpt.setValue(this._sculptManager.getToolIndex());
    }

    this._action = Enums.Action.NOTHING;
    this.render();
    console.log("VR Exit: Desktop camera & UI sync fully restored");
  }

  // Used by Desktop raycasting tools to synchronize the pivot with the spectator render pass
  getSpectatorTransform() {
    if (!this._xrSession || !this._xrWorldOffset) return null;
    const specMode = this._spectatorMode;
    if (specMode === Enums.SpectatorMode.DECOUPLED || specMode === Enums.SpectatorMode.GOPRO) return null;

    const t = this._xrWorldOffset.position;
    const r = this._xrWorldOffset.orientation;
    const mWorld = mat4.create();
    mat4.fromRotationTranslation(mWorld, [r.x, r.y, r.z, r.w], [t.x, t.y, t.z]);

    const mSpawn = mat4.create();
    mat4.fromRotationTranslation(mSpawn, [0, 0, 0, 1], [0, 1.2, -0.55]);

    const mSpawnInv = mat4.create();
    mat4.invert(mSpawnInv, mSpawn);

    const mPan = mat4.create();
    mat4.multiply(mPan, mSpawnInv, mWorld);

    const fullTrans = mat4.create();

    if (specMode === Enums.SpectatorMode.STATIONARY) {
      // Stationary applies desktop rotate and flip first
      mat4.translate(fullTrans, fullTrans, this._desktopOffset);
      mat4.rotateY(fullTrans, fullTrans, Math.PI); // 180 deg
      mat4.mul(fullTrans, fullTrans, this._desktopRotation);
    }

    mat4.multiply(fullTrans, fullTrans, mPan);

    const relativeScale = this._vrScale > 0.0001 ? (this._vrScale / 0.008) : 1.0;
    mat4.scale(fullTrans, fullTrans, [relativeScale, relativeScale, relativeScale]);

    return fullTrans;
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
      mesh.setVisible(false); // FORCED HIDDEN

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
    }

    // Init VR Menu System
    if (!this._guiXR) this._guiXR = new GuiXR(this);
    this._guiXR.init(this._gl);
    if (!this._vrMenu) this._vrMenu = new VRMenu(this._gl, this._guiXR);

    // Init VR Mini-HUD System
    if (!this._guiMini) {
      this._guiMini = new GuiXR(this);
      this._guiMini._isMiniHUD = true;
      this._guiMini._isVisible = true;
    }
    this._guiMini.init(this._gl);
    if (!this._vrMiniHUD) this._vrMiniHUD = new VRMenu(this._gl, this._guiMini);

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

    // [DEBUG] Raycaster Sphere (Origin)
    if (!this._debugRayOrigin) {
      var meshOrigin = Primitives.createSphere(this._gl, 1.0, 32, 32);
      meshOrigin.setShaderType(Enums.Shader.FLAT);
      meshOrigin.setFlatColor([0.0, 1.0, 1.0]); // Cyan
      meshOrigin.setOpacity(1.0);
      meshOrigin.init();
      meshOrigin.initRender();
      this._debugRayOrigin = meshOrigin;
    }

    // [DEBUG] Raycaster Sphere (Target)
    if (!this._debugRayTarget) {
      var meshTarget = Primitives.createSphere(this._gl, 1.0, 32, 32);
      meshTarget.setShaderType(Enums.Shader.FLAT);
      meshTarget.setFlatColor([1.0, 0.0, 1.0]); // Magenta
      meshTarget.setOpacity(1.0);
      meshTarget.init();
      meshTarget.initRender();
      this._debugRayTarget = meshTarget;
    }

    // [DEBUG] Gizmo Test Sphere (Duplicate of Radius Sphere)
    if (!this._debugGizmoSphere) {
      var meshG = Primitives.createSphere(this._gl, 1.0, 64, 64);
      meshG.setShaderType(Enums.Shader.FRESNEL);
      meshG.setFlatColor([0.2, 0.8, 0.2]); // Greenish to distinguish
      meshG.setOpacity(1.0);
      meshG.init();
      meshG.initRender();
      this._debugGizmoSphere = meshG;
    }

    // [DEBUG] Pivot Test Sphere (Blue)
    if (!this._debugPivotSphere) {
      var meshP = Primitives.createSphere(this._gl, 1.0, 64, 64);
      meshP.setShaderType(Enums.Shader.FRESNEL);
      meshP.setFlatColor([0.2, 0.2, 0.8]); // Blue
      meshP.setOpacity(1.0);
      meshP.init();
      meshP.initRender();
      this._debugPivotSphere = meshP;
    }

    // [DEBUG] Hit Sphere (Yellow - for Picking)
    if (!this._debugHitSphere) {
      var meshH = Primitives.createSphere(this._gl, 1.0, 64, 64);
      meshH.setShaderType(Enums.Shader.FLAT);
      meshH.setFlatColor([0.9, 0.9, 0.2]); // Yellow
      meshH.setOpacity(1.0);
      meshH.init();
      meshH.initRender();
      meshH.setVisible(false); // FORCED OFF
      this._debugHitSphere = meshH;
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
        // this._debugCursor.setVisible(true);
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
    if (!this._debugHitSphere) return;

    if (active && pos) {
      // if (!this._debugHitSphere.isVisible()) this._debugHitSphere.setVisible(true);

      // We only update the matrix here if mode is 'hit'
      // If mode is 'controller' etc, render loop handles it.
      if (window.debugHitAttach === 'hit') {
        const mat = this._debugHitSphere.getMatrix();
        mat4.identity(mat);
        mat4.translate(mat, mat, pos);

        let s = window.debugHitScale || 0.02;
        // Compensate for VR Scale to keep it "Physical Size"
        if (this._vrScale && this._vrScale > 0.0001) s *= this._vrScale;

        mat4.scale(mat, mat, [s, s, s]);
      }
    } else {
      // Only hide if we aren't forcing another attach mode
      if (window.debugHitAttach === 'hit') {
        if (this._debugHitSphere.isVisible()) this._debugHitSphere.setVisible(false);
      }
    }
  }

  onXRFrame(time, frame) {
    const session = frame.session;
    session.requestAnimationFrame(this.onXRFrame.bind(this));

    // Force use of Base Ref Space (Local Floor) to debug "Flying Cube"
    // The previous offset logic likely doubled up or inverted height.
    const refSpace = this._baseRefSpace;

    const pose = frame.getViewerPose(refSpace);
    if (pose) {
      if (!this._headHeightCalibrated) {
        this._headHeightCalibrated = true;
        const headY = pose.transform.position.y;
        if (!this._xrWorldOffset) {
          this._xrWorldOffset = new XRRigidTransform({ x: 0, y: headY, z: -0.4 });
        } else {
          const p = this._xrWorldOffset.position;
          const o = this._xrWorldOffset.orientation;
          this._xrWorldOffset = new XRRigidTransform({ x: p.x, y: headY, z: p.z }, o);
        }
        // Removed `this._prevOffsetY = headY;` to prevent UI slider from jumping on world grab
      }

      const gl = this._gl;
      const glLayer = session.renderState.baseLayer;
      gl.bindFramebuffer(gl.FRAMEBUFFER, glLayer.framebuffer);
      // BUGFIX: Desktop spectator pass overrides gl.clearColor. We MUST reset it to transparent here for AR Passthrough!
      gl.clearColor(0.0, 0.0, 0.0, 0.0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      // VR Menu Update (Sync with Frame and Upload to WebGL if dirty)
      if (this._guiXR) this._guiXR.update();
      if (this._guiMini) this._guiMini.update();
      if (this._guiPopup) this._guiPopup.update();

      // Handle Input (PoC placeholder)
      if (typeof this.handleXRInput === 'function') {
        try {
          this.handleXRInput(frame, refSpace);
        } catch (e) {
          console.error("XR Input Error:", e);
        }
      }

      // [DESKTOP CAMERA PRESERVATION]
      // We rebuild the pure desktop camera from its internal trans/rot state.
      // This allows mouse controls to work, while preventing the 'exponential tumbling'
      // that would occur if we read last frame's mutated _camera._view.
      this._camera.updateView();
      this._camera.updateProjection();
      const liveDesktopView = mat4.clone(this._camera._view);
      const liveDesktopProj = mat4.clone(this._camera._proj);

      // NOTE: We don't set _divertedView here yet, because the Spectator mode dictates the exact matrix the Desktop will see.
      // We will set _camera._divertedView down inside the Spectator blocks so picking aligns perfectly with the rendered frame.

      // Render to WebXR framebuffer
      this.renderVR(glLayer, pose, frame, refSpace);

      // Now that the Headset render is fully complete, we can enable diverted view unprojection
      // so that any asynchronous desktop mouse clicks process correctly using the spectator matrix.
      this._camera._unprojectDiverted = true;

      // [SPECTATOR MATRIX RENDERING]
      const specMode = this._spectatorMode;

      if (specMode === Enums.SpectatorMode.GOPRO && pose.views.length > 0) {
        const viewMat = mat4.create();
        const prob = mat4.create();

        // Track VR Headset (Perfect Mirror)
        const view = pose.views[0];
        const aspect = this._canvasWidth / this._canvasHeight;
        mat4.perspective(prob, 45 * Math.PI / 180, aspect, 0.1, 1000.0);
        mat4.copy(viewMat, view.transform.inverse.matrix);

        mat4.copy(this._camera._divertedView, viewMat);
        mat4.copy(this._camera._divertedProj, prob);

        // Draw directly to canvas here, because window RAF may be throttled/paused
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, this._canvasWidth, this._canvasHeight);
        gl.clearColor(0.2, 0.2, 0.2, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        // Render Shared Logic directly to canvas
        // We must call updateMatricesAndSort before rendering to apply tool positions
        this.updateMatricesAndSort();
        this._renderSceneVR(this._camera, viewMat, prob);

        // Force SculptManager post-render (gizmos/UI) to canvas
        if (this._sculptManager) {
          gl.disable(gl.DEPTH_TEST);
          this._sculptManager.postRender();
          gl.enable(gl.DEPTH_TEST);
        }
      } else {
        // Independent Desktop Camera Passes
        const cacheScale = this._vrScale;
        const cacheOffset = this._xrWorldOffset;

        // DECOUPLED blocks all VR transforms, freezing the world to the desktop screen context
        if (specMode === Enums.SpectatorMode.DECOUPLED) {
          this._vrScale = 1.0;
          this._xrWorldOffset = null;
        }

        // TRACKED and STATIONARY inherit the active _vrScale and _xrWorldOffset, mapping Grip pans/zooms to the UI
        // We calculate precisely what the view should be here.
        const specView = mat4.clone(liveDesktopView);
        const specProj = mat4.clone(liveDesktopProj);
        let bypassVRScale = false;

        const specViewPhys = mat4.create(); // MUST START OUTSIDE
        mat4.copy(specViewPhys, specView);

        if (specMode === Enums.SpectatorMode.TRACKED || specMode === Enums.SpectatorMode.STATIONARY) {
          bypassVRScale = true;

          // Wait until we have a valid _xrWorldOffset from WebXR before baking the initial state.
          // This prevents a race condition where the first frame captures a null offset (0,0,0),
          // permanently breaking the 'panPos' delta subtraction for the rest of the session.
          if (!this._bakedDesktopView && this._xrWorldOffset) {
            this._bakedDesktopView = mat4.create();

            // Check if the user has requested a custom ergonomic trackball initialization
            let targetState = window.defaultCameraState;

            // If the user hasn't overridden it, use the verified ergonomic trackball preset
            if (specMode === Enums.SpectatorMode.STATIONARY && !targetState) {
              targetState = {
                trans: [-4.03660, -35.40236, 145.00469],
                quatRot: [0.00000, 0.00000, 0.00000, 1.00000],
                center: [0.00000, 0.00000, 0.00000]
              };
            }

            if (specMode === Enums.SpectatorMode.STATIONARY && targetState) {
              vec3.copy(this._camera._trans, targetState.trans);
              quat.copy(this._camera._quatRot, targetState.quatRot);
              vec3.copy(this._camera._center, targetState.center);
              this._camera.updateView();
              mat4.copy(liveDesktopView, this._camera.getView());
              console.log("Applied custom ergonomic trackball offset for Stationary Mode.");
            }

            mat4.copy(this._bakedDesktopView, liveDesktopView);

            this._bakedWorldOffset = vec3.fromValues(
              this._xrWorldOffset.position.x,
              this._xrWorldOffset.position.y,
              this._xrWorldOffset.position.z
            );

            this._bakedVRScale = this._vrScale;

            // Console Command Helper to grab the perfect view state (Replaces previous 4x4 array output)
            window.getDesktopState = () => {
              const t = Array.from(this._camera._trans).map(n => n.toFixed(5)).join(', ');
              const q = Array.from(this._camera._quatRot).map(n => n.toFixed(5)).join(', ');
              const c = Array.from(this._camera._center).map(n => n.toFixed(5)).join(', ');
              console.log(`Copy this into your console to set your default view:`);
              console.log(`window.defaultCameraState = { trans: [${t}], quatRot: [${q}], center: [${c}] };`);
            };
          }

          if (!this._bakedDesktopView) {
            // Fallback: If WebXR hasn't provided the offset yet, just render using the live view
            // and skip matrix construction until the next frame.
            mat4.copy(this._camera._view, liveDesktopView);
            mat4.copy(this._camera._proj, liveDesktopProj);
            return;
          }

          const bakedDesktopView = this._bakedDesktopView;

          const invScaleMat = mat4.create();
          const scaleMat = mat4.create();
          if (this._vrScale !== 1.0 && this._vrScale > 0.0001) {
            const invS = 1.0 / this._vrScale;
            mat4.scale(invScaleMat, invScaleMat, [invS, invS, invS]);
            mat4.scale(scaleMat, scaleMat, [this._vrScale, this._vrScale, this._vrScale]);
          }

          const bakedInvScaleMat = mat4.create();
          const bakedScale = this._bakedVRScale || 0.008;
          if (bakedScale !== 1.0 && bakedScale > 0.0001) {
            const invS = 1.0 / bakedScale;
            mat4.scale(bakedInvScaleMat, bakedInvScaleMat, [invS, invS, invS]);
          }

          const relativeScaleMat = mat4.create();
          if (this._vrScale !== undefined && bakedScale > 0.0001) {
            const relScale = this._vrScale / bakedScale;
            mat4.scale(relativeScaleMat, relativeScaleMat, [relScale, relScale, relScale]);
          }

          const worldMat = mat4.create();
          const invWorldMat = mat4.create();

          const mSpawn = mat4.create();
          mat4.fromRotationTranslation(mSpawn, [0, 0, 0, 1], [0, 1.2, -0.55]);
          const mSpawnInv = mat4.create();
          mat4.invert(mSpawnInv, mSpawn);

          // Extract just the translation of the bakedDesktopView to understand the trackball "boom arm" distance
          const cameraOffset = mat4.create();
          const invCameraOffset = mat4.create();
          if (this._bakedDesktopView) {
            mat4.fromTranslation(cameraOffset, [this._bakedDesktopView[12], this._bakedDesktopView[13], this._bakedDesktopView[14]]);
            mat4.invert(invCameraOffset, cameraOffset);
          }

          const mPan = mat4.create();
          const invPan = mat4.create();

          const panPos = mat4.create();
          const invPanPos = mat4.create();

          const panRot = mat4.create();
          const invPanRot = mat4.create();

          const scaledPanPos = mat4.create();
          const invScaledPanPos = mat4.create();

          const bakedOffset = mat4.create();
          const invBakedOffset = mat4.create();

          if (this._xrWorldOffset) {
            const t = this._xrWorldOffset.position;
            const r = this._xrWorldOffset.orientation;

            // Full offset (Translation + Rotation)
            mat4.fromRotationTranslation(worldMat, [r.x, r.y, r.z, r.w], [t.x, t.y, t.z]);
            mat4.invert(invWorldMat, worldMat);

            // Pure Translation Delta (Subtracts dynamically captured physical room start position)
            const sx = this._bakedWorldOffset ? this._bakedWorldOffset[0] : 0;
            const sy = this._bakedWorldOffset ? this._bakedWorldOffset[1] : 0;
            const sz = this._bakedWorldOffset ? this._bakedWorldOffset[2] : 0;

            mat4.fromTranslation(bakedOffset, [sx, sy, sz]);
            mat4.invert(invBakedOffset, bakedOffset);

            mat4.fromTranslation(panPos, [t.x - sx, t.y - sy, t.z - sz]);
            mat4.invert(invPanPos, panPos);

            // Pure Rotation (No translation/offset)
            mat4.fromQuat(panRot, [r.x, r.y, r.z, r.w]);
            mat4.invert(invPanRot, panRot);

            // Scaled Translation Delta (Virtual Scale)
            const vs = this._vrScale || 1.0;
            let invS;
            if (specMode === Enums.SpectatorMode.STATIONARY && bakedScale > 0.0001) {
              // Stationary mode: Always map the physical hand movement to the trackball's fixed 
              // distance focal point (which is tied to the baked scale). This perfectly offsets
              // the translation, restoring 1:1 camera panning regardless of the current relScale zooming.
              invS = 1.0 / bakedScale;

              // We do calculate relScale for the *virtual* pipeling later.
              const relScale = vs / bakedScale;
            } else {
              // Tracked mode uses raw absolute physical scaling (e.g. 0.008 -> 0.004)
              invS = 1.0 / vs;
            }

            mat4.fromTranslation(scaledPanPos, [(t.x - sx) * invS, (t.y - sy) * invS, (t.z - sz) * invS]);
            mat4.invert(invScaledPanPos, scaledPanPos);
          }
          mat4.multiply(mPan, mSpawnInv, worldMat);
          mat4.invert(invPan, mPan);

          if (specMode === Enums.SpectatorMode.TRACKED) {
            // TRACKED MODE
            // 1. Pass 1 (Controllers): Panning to track the world

            mat4.copy(specViewPhys, liveDesktopView);
            mat4.multiply(specViewPhys, specViewPhys, invScaleMat); // Scale to meters using LIVE physical tracking
            mat4.multiply(specViewPhys, specViewPhys, mPan); // Track user movement

            // 2. Pass 2 (World): Perfectly tracks mPan and dynamically frames sculpt
            mat4.copy(specView, liveDesktopView);
            mat4.multiply(specView, specView, mPan);
            mat4.multiply(specView, specView, worldMat);

          } else if (specMode === Enums.SpectatorMode.STATIONARY) {
            // STATIONARY MODE (INTERACTIVE DEBUGGER)
            // Goal: Controllers locked to physical hands. Sculpt moves relative to user.
            window.debugForceNearClip = 0.001; // Force near clip to allow grab tools right in front of the camera using Desktop.

            // Build the catalog of available matrix components
            const invBakedDesktopView = mat4.create();
            if (this._bakedDesktopView) mat4.invert(invBakedDesktopView, this._bakedDesktopView);

            // This captures purely the manual panning/orbiting the user does with the mouse
            // since the trackball was first "baked".
            const liveOffset = mat4.create();
            if (this._bakedDesktopView) {
              mat4.multiply(liveOffset, liveDesktopView, invBakedDesktopView);
            } else {
              mat4.identity(liveOffset);
            }

            const invLiveOffset = mat4.create();
            mat4.invert(invLiveOffset, liveOffset);

            // Manual user tuning variables
            const manualOffset = mat4.create();
            // User calibrated values (v0.8.209)
            const manualT = window.debugStationaryOffset || [0, -30, 0];
            const manualS = window.debugStationaryScale !== undefined ? window.debugStationaryScale : 1.66949;
            mat4.fromTranslation(manualOffset, manualT);
            if (manualS !== 1.0) {
              mat4.scale(manualOffset, manualOffset, [manualS, manualS, manualS]);
            }

            const matrices = {
              liveDesktopView,
              bakedDesktopView,
              scaleMat,
              invScaleMat,
              worldMat,
              invWorldMat,
              panPos,
              invPanPos,
              panRot,
              invPanRot,
              scaledPanPos,
              invScaledPanPos,
              mPan,
              invPan,
              mSpawn,
              mSpawnInv,
              cameraOffset,
              invCameraOffset,
              bakedOffset,
              invBakedOffset,
              liveOffset,
              invLiveOffset,
              bakedInvScaleMat,
              relativeScaleMat,
              manualOffset
            };

            // Expose the global array pipelines for Chrome Console debugging
            // The user noted that 'liveDesktopView' is a trackball stuck looking at the origin. 
            // We must construct a completely clean, unconstrained VR-like initial state:
            // "bakedDesktopView" captures the trackball precisely once when VR starts, freezing it.
            if (!window.debugTripodPhys) window.debugTripodPhys = ['liveDesktopView', 'bakedInvScaleMat', 'invBakedOffset'];
            if (!window.debugTripodVirt) window.debugTripodVirt = ['liveDesktopView', 'scaledPanPos', 'panRot', 'relativeScaleMat', 'manualOffset'];

            window.captureStationaryCalibration = () => {
              console.log("=== SCULPTXR STATIONARY CALIBRATION ===");
              console.log("Your chosen grip offsets mapped into manual variables:");

              if (!this._xrWorldOffset || !this._bakedDesktopView) {
                console.log("Error: World offset or baked state not found.");
                return;
              }

              const invB = mat4.create();
              mat4.invert(invB, this._bakedDesktopView);
              const sx = invB[12];
              const sy = invB[13];
              const sz = invB[14];
              const t = this._xrWorldOffset.position;

              const vs = this._vrScale || 1.0;
              const bakedScale = this._bakedDesktopVRScale || 0.008;

              const tx = (t.x - sx).toFixed(5);
              const ty = (t.y - sy).toFixed(5);
              const tz = (t.z - sz).toFixed(5);
              const s = (vs / bakedScale).toFixed(5);
              console.log(`window.debugStationaryOffset = [${tx}, ${ty}, ${tz}];`);
              console.log(`window.debugStationaryScale = ${s};`);
            };

            if (!this._loggedTripodDebug) {
              // ... logs disabled for production clarity ...
              this._loggedTripodDebug = true;
            }

            const buildMatrix = (mat, instructions) => {
              mat4.identity(mat);
              if (Array.isArray(instructions)) {
                instructions.forEach(inst => {
                  if (matrices[inst]) {
                    mat4.multiply(mat, mat, matrices[inst]);
                  }
                });
              }
            };

            // 2. Pass 2 (World)
            buildMatrix(specView, window.debugTripodVirt);

            // 1. Pass 1 (Controllers)
            // GOLDEN RULE: For controllers (Pass 1) to perfectly align visually on the monitor
            buildMatrix(specViewPhys, window.debugTripodPhys);
          }

          // --- TELEMETRY / ANTI-NAN EXPLOSION CHECK ---
          const hasNaN = (mat) => Array.from(mat).some(Number.isNaN);
          if (hasNaN(specViewPhys) || hasNaN(specView)) {
            if (window.screenLog && !this._loggedNaN) {
              window.screenLog("CRITICAL: STATIONARY MATRICES EXPLODED", "red");
              this._loggedNaN = true;
            }
            mat4.identity(specViewPhys);
            mat4.identity(specView);
          }

          if (window.dumpSpectatorState) {
            console.log("=== Decoupled STATE DUMP (v0.8.91) ===");
            console.log("liveDesktopView:", Array.from(liveDesktopView));
            console.log("vrScale:", this._vrScale);
            console.log("specViewPhys:", Array.from(specViewPhys));
            console.log("specView:", Array.from(specView));
            if (this._xrWorldOffset) {
              console.log("World Offset Pos:", [this._xrWorldOffset.position.x, this._xrWorldOffset.position.y, this._xrWorldOffset.position.z]);
            }
            window.dumpSpectatorState = false;
          }
        }

        // Apply chosen matrix
        mat4.copy(this._camera._view, specView);
        mat4.copy(this._camera._proj, specProj);

        // Store active Spectator rendering matrices for cross-checking in Interaction (processVRSculpting)
        // These are required for optical alignment of raycasting when the virtual and physical matrices diverge.
        if (!this._camera._specView) this._camera._specView = mat4.create();
        if (!this._camera._specViewPhys) this._camera._specViewPhys = mat4.create();
        mat4.copy(this._camera._specView, specView);
        mat4.copy(this._camera._specViewPhys, specViewPhys);

        // To make Desktop mouse clicks (Picking) accurate, the _diverted matrix must match EXACTLY what _renderSceneVR produces!
        mat4.copy(this._camera._divertedView, specView);
        mat4.copy(this._camera._divertedProj, specProj);

        // Force update of all mesh matrices FIRST (so UI/Controllers build matrices with real VR scale)
        this.updateMatricesAndSort();

        // Render to Canvas Buffer directly using standard desktop pipeline
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, this._canvasWidth, this._canvasHeight);
        gl.clearColor(0.2, 0.2, 0.2, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        // Feed the physical camera to the VR pipeline. 
        // Pass 2 will still multiply the Virtual Camera by World/Scale matrices as needed.
        this._renderSceneVR(this._camera, specViewPhys, specProj, bypassVRScale ? specView : null);

        // Restore _camera._view just in case any postRender logic relies on the pure un-mutated Virtual camera
        mat4.copy(this._camera._view, specView);

        // Force SculptManager post-render (gizmos/UI) to canvas
        if (this._sculptManager) {
          gl.disable(gl.DEPTH_TEST);
          this._sculptManager.postRender();
          gl.enable(gl.DEPTH_TEST);
        }

        // Restore VR Environment for the next frame
        this._vrScale = cacheScale;
        this._xrWorldOffset = cacheOffset;
      }

      // [DESKTOP CAMERA RESTORATION]
      // Globally restore the pristine Desktop Camera state so the next frame begins clean
      // and async desktop UI/Mouse interactions act geometrically on the unscaled real-world camera.
      mat4.copy(this._camera._view, liveDesktopView);
      mat4.copy(this._camera._proj, liveDesktopProj);
    } else if (frame && this._camera._unprojectDiverted) {
      // If we are NOT in TRACKED or STATIONARY, and unproject is true:
      // We must have exited mode.
      this._camera._unprojectDiverted = false;
      this._bakedDesktopView = null;
      this._bakedWorldOffset = null;
      this._loggedTripodDebug = false;
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

    // VR Fuzzer Mode (Overrides input for stress testing)
    if (window.vrFuzzMode) {
      if (!this._fuzzState) {
        this._fuzzState = {
          lastFlip: 0,
          isTriggerPressed: false,
          posLeft: vec3.fromValues(0, 1.2, -0.3),
          posRight: vec3.fromValues(0, 1.2, -0.3),
        };
      }

      const now = performance.now();
      // Scramble states every 100ms
      if (now - this._fuzzState.lastFlip > 100) {
        this._fuzzState.lastFlip = now;
        this._fuzzState.isTriggerPressed = Math.random() > 0.5;
        this._fuzzState.isGripPressed = Math.random() > 0.8;
        this._fuzzState.undoPressed = Math.random() > 0.95;
        this._fuzzState.redoPressed = Math.random() > 0.95;

        // Randomize Positions within Sculptable Area
        const range = 0.5;
        vec3.set(this._fuzzState.posLeft, (Math.random() - 0.5) * range, 1.2 + (Math.random() - 0.5) * range, -0.5 + (Math.random() * range));
        vec3.set(this._fuzzState.posRight, (Math.random() - 0.5) * range, 1.2 + (Math.random() - 0.5) * range, -0.5 + (Math.random() * range));

        // Randomize Brush Radius (Axis 3)
        this._fuzzState.radiusAxis = (Math.random() - 0.5) * 2.0;

        // Optionally switch tools randomly
        if (Math.random() > 0.9 && this._sculptManager) {
          const tools = Object.keys(Enums.Tools);
          const randomToolKey = tools[Math.floor(Math.random() * tools.length)];
          this._sculptManager.setToolIndex(Enums.Tools[randomToolKey]);
          if (window.screenLog) window.screenLog(`Fuzzer switched tool to ${randomToolKey}`, "orange");
        }
      }
    }


    for (let source of sources) {
      // DEBUG: Scan Sources
      // if (window.screenLog && this._logThrottle % 120 === 0) {
      //   window.screenLog(`Src: ${source.handedness} Grip:${!!source.gripSpace} Ray:${!!source.targetRaySpace}`, "yellow");
      // }

      if (!source.gripSpace) continue;

      // VR Fuzzer Overrides
      if (window.vrFuzzMode && this._fuzzState) {
        // Clone source so we don't mutate the frozen WebXR object
        source = {
          handedness: source.handedness,
          targetRaySpace: source.targetRaySpace, // Keep original references for real polling if needed
          gripSpace: source.gripSpace,
          gamepad: {
            buttons: [
              { pressed: this._fuzzState.isTriggerPressed }, // Trigger
              { pressed: this._fuzzState.isGripPressed }     // Grip
            ],
            axes: [
              0, 0,
              source.handedness === 'left' ? (this._fuzzState.undoPressed ? -1 : (this._fuzzState.redoPressed ? 1 : 0)) : 0,
              source.handedness === 'right' ? this._fuzzState.radiusAxis : 0
            ]
          }
        };

        // Mock getPose on frame just for this iteration
        if (!frame._originalGetPose) frame._originalGetPose = frame.getPose;
        frame.getPose = (space, ref) => {
          const originalPose = frame._originalGetPose.call(frame, space, ref);
          const fpos = source.handedness === 'left' ? this._fuzzState.posLeft : this._fuzzState.posRight;
          return {
            transform: {
              position: { x: fpos[0], y: fpos[1], z: fpos[2] },
              orientation: { x: 0, y: 0, z: 0, w: 1 },
              matrix: mat4.fromTranslation(mat4.create(), fpos)
            }
          };
        };
      } else if (frame._originalGetPose) {
        // Restore original getPose if fuzz mode gets disabled mid-run
        frame.getPose = frame._originalGetPose;
        frame._originalGetPose = null;
      }

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


                tools.setRadius(newVal);

                // Update GuiXR and GuiMini Sliders if visible
                if (this._guiXR) {
                  this._guiXR.updateRadiusWidget(newVal);
                }
                if (this._guiMini) {
                  this._guiMini.updateRadiusWidget(newVal);
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

        // --- VR ERGONOMICS: HYBRID BUTTONS ---
        const btns = source.gamepad.buttons;
        if (btns.length > 4) {
          const now = performance.now();
          const HYBRID_THRESHOLD = 300; // ms

          // DOMINANT HAND: 'A' or 'X' Button (Button 4) -> Toggle Subtract
          if (isDom) {
            const btnA = btns[4];
            const tracker = this._vrButtonStates[this._dominantHand].Primary;
            if (btnA && btnA.pressed !== tracker.pressed) {
              if (btnA.pressed) {
                // Button Down: Activate INSTANTLY
                tracker.time = now;
                tracker.longPressActive = false;
                this._vrSubtractActive = !this._vrSubtractActive;
              } else {
                // Button Up
                if (tracker.longPressActive) {
                  // It was a momentary hold (transient mode) that is now releasing
                  // Revert the state back to what it was before pressing down
                  this._vrSubtractActive = !this._vrSubtractActive;
                }
                // If it was a quick tap (delta < HYBRID_THRESHOLD), do nothing on release
                // because we already toggled it on button down.
                tracker.longPressActive = false;
              }
              tracker.pressed = btnA.pressed;
            } else if (btnA && btnA.pressed && !tracker.longPressActive) {
              // Holding button down: Check if we crossed the threshold
              if (now - tracker.time >= HYBRID_THRESHOLD) {
                tracker.longPressActive = true;
                // We don't need to change _vrSubtractActive here because we did it on press-down
              }
            }
          }

          // NON-DOMINANT HAND: 'X' or 'A' Button (Button 4) -> Toggle Main Menu
          if (isNonDom) {
            const btnX = btns[4];
            const handKey = this._dominantHand === 'right' ? 'left' : 'right';
            const tracker = this._vrButtonStates[handKey].Primary;
            if (btnX && btnX.pressed !== tracker.pressed) {
              if (btnX.pressed) {
                // Button Down: Activate INSTANTLY
                tracker.time = now;
                tracker.longPressActive = false;
                if (this._guiXR) this._guiXR.toggleVisibility();
              } else {
                // Button Up
                if (tracker.longPressActive) {
                  // Momentary Release -> Revert menu visibility
                  if (this._guiXR) this._guiXR.toggleVisibility();
                }
                // If quick tap, do nothing on release
                tracker.longPressActive = false;
              }
              tracker.pressed = btnX.pressed;
            } else if (btnX && btnX.pressed && !tracker.longPressActive) {
              // Holding button down: Check if we crossed the threshold
              if (now - tracker.time >= HYBRID_THRESHOLD) {
                tracker.longPressActive = true;
                // Menu visibility was already toggled on press-down
              }
            }
          }
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

        if (rayPose) {
          const mat = rayPose.transform.matrix;

          let origin, dir;

          if (isFallback) {
            origin = vec3.fromValues(mat[12], mat[13], mat[14]);
            dir = vec3.fromValues(-mat[8], -mat[9], -mat[10]);
          } else {
            origin = vec3.fromValues(mat[12], mat[13], mat[14]);
            dir = vec3.fromValues(-mat[8], -mat[9], -mat[10]);
          }
          vec3.normalize(dir, dir);

          let hit = null;
          let targetGuiXR = null;

          // Check Main Menu First
          if (this._vrMenu && this._guiXR && this._guiXR._isVisible) {
            hit = this._vrMenu.intersect(origin, dir);
            if (hit) targetGuiXR = this._guiXR;
          }

          // Check Popup HUD (Highest priority when active, over Mini-HUD)
          if (!hit && this._vrPopup && this._guiPopup && this._guiPopup._isVisible && this._guiPopup._overlay) {
            hit = this._vrPopup.intersect(origin, dir);
            if (hit) targetGuiXR = this._guiPopup;
          }

          // If Missed Main Menu, Check Mini-HUD (Only if Main Menu is closed)
          if (!hit && this._vrMiniHUD && this._guiMini && this._guiMini._isVisible && (!this._guiXR || !this._guiXR._isVisible)) {
            hit = this._vrMiniHUD.intersect(origin, dir);
            if (hit) targetGuiXR = this._guiMini;
          }

          let pressed = false;
          if (source.gamepad && source.gamepad.buttons[0]) {
            // FIRE EARLY: Trigger UI hits at 10% depression instead of waiting for a full physical click
            pressed = source.gamepad.buttons[0].value > 0.1 || source.gamepad.buttons[0].pressed;
          }

          if (pressed && !this._globalGuiWasPressed) {
            this._activePressedGui = hit ? targetGuiXR : null;
          } else if (!pressed) {
            if (this._activePressedGui) {
              this._activePressedGui.onInteract(-1, -1, false);
            }
            this._activePressedGui = null;
          }
          this._globalGuiWasPressed = pressed;

          if (hit) {
            this._isPointingAtMenu = true;
            targetGuiXR.setCursor(hit.uv[0], hit.uv[1]);
            targetGuiXR._updateHover(); // CRITICAL: Actually trigger the hit test loop using the new cursor coordinates!

            if (this._activePressedGui && this._activePressedGui !== targetGuiXR) {
              targetGuiXR.onInteract(hit.uv[0], hit.uv[1], false);
            } else {
              targetGuiXR.onInteract(hit.uv[0], hit.uv[1], pressed);
            }

            // Calc Laser Distance (plus overshoot)
            if (this._vrLaser) {
              this._vrLaserDistance = hit.distance + 0.05; // +5cm
            }

          } else {
            if (this._guiXR) this._guiXR.setCursor(-1, -1);
            if (this._guiMini) this._guiMini.setCursor(-1, -1);
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

    // Buffer menu pointing state for exactly one frame to absorb trigger releases when menus close
    this._wasPointingAtMenu = this._isPointingAtMenu;
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
      // Pulling hands apart (dist > prevDist) stretches the object, so _vrScale increases (zooms IN)
      // This MUST be the same for all modes, otherwise the mesh shrinks away from the user's physical hands
      // and causes raycasting checks to immediately drop (cursor disappears).
      let ratio = dist / s.prevDist;

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
    vec3.scale(diff, diff, ratio);
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

    const p = pose.transform.position;
    const q = pose.transform.orientation;

    // [v0.8.212] Detect physical movement to trigger auto-hide of desktop UI
    const posVec = vec3.fromValues(p.x, p.y, p.z);
    let VRActivityDetected = false;

    if (source.handedness === 'left') {
      if (!this._vrLastPosLeft) this._vrLastPosLeft = vec3.create();
      if (vec3.distance(this._vrLastPosLeft, posVec) > 0.0005) VRActivityDetected = true;
      vec3.copy(this._vrLastPosLeft, posVec);
    } else {
      if (!this._vrLastPosRight) this._vrLastPosRight = vec3.create();
      if (vec3.distance(this._vrLastPosRight, posVec) > 0.0005) VRActivityDetected = true;
      vec3.copy(this._vrLastPosRight, posVec);
    }

    if (source.gamepad) {
      for (let i = 0; i < source.gamepad.buttons.length; i++) {
        if (source.gamepad.buttons[i].pressed) VRActivityDetected = true;
      }
    }

    if (VRActivityDetected) {
      // User Req: If physical mouse hasn't moved in 1000ms, hide the UI for VR
      if (!window._lastMouseTime || (performance.now() - window._lastMouseTime) > 1000) {
        window.isUIHiddenForVR = true;
        if (this.setCanvasCursor) {
          this.setCanvasCursor('none');
        }
      }
    }

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
    this._vrControllerPosPhys = physicalOrigin;
    const rayDirPhys = vec3.fromValues(0, 0, -1);
    vec3.transformQuat(rayDirPhys, rayDirPhys, [q.x, q.y, q.z, q.w]);
    this._vrControllerDirPhys = rayDirPhys;

    // const physicalOrigin = [pose.transform.position.x, pose.transform.position.y, pose.transform.position.z];

    // 2. Space Synchronization (Physical -> Model Space)
    // Mathematical Divergence: Desktop 6DOF Spectator hacks the View matrices so they don't match the physics tracking.
    const enginePos = vec3.create();
    const invScale = 1.0 / (this._vrScale || 1.0);

    if (this._spectatorMode === Enums.SpectatorMode.STATIONARY && this._camera._specView && this._camera._specViewPhys) {
    // OPTICAL UI MAPPING (Fixed 6DOF Mode):
    // The physical controllers (specViewPhys) visually diverge from the virtual world (specView) on the monitor.
    // We must mathematically trace where the optical pixel of the physical controller lands on the virtual world
    // so the physics raycast ("enginePos") fires exactly where the spectator sees the controller.      
      vec3.copy(enginePos, physicalOrigin);

      // 1. Where does the controller exist relative to the physical camera lens?
      vec3.transformMat4(enginePos, enginePos, this._camera._specViewPhys);

      // 2. Map that optical position *backwards* out of the virtual camera into true Virtual Model Space.
      const invHackedView = mat4.create();
      mat4.invert(invHackedView, this._camera._specView);
      vec3.transformMat4(enginePos, enginePos, invHackedView);

    } else {
      // STANDARD PCVR / STANDALONE MAPPING:
      // Physics tracking perfectly matches Virtual rendering. Native matrices apply.
      vec3.copy(enginePos, physicalOrigin);

      // Apply Inverse World Transform (Pan/Zoom/Orbit offsets)
      if (this._xrWorldOffset) {
        vec3.transformMat4(enginePos, enginePos, this._xrWorldOffset.inverse.matrix);
      }

      // 3. Inverse Scaling
      vec3.scale(enginePos, enginePos, invScale);
    }

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

    // LATCH TRIGGERS AFTER MENU INTERACTION
    // If the user was just pointing at a menu and clicked, the trigger is still pressed.
    // We must block ALL new strokes until that trigger is fully released to 0.
    const trigger = source.gamepad && source.gamepad.buttons ? source.gamepad.buttons[0] : { pressed: false, value: 0 };

    // Set the latch if we are pointing at a menu and the trigger goes down
    if (this._isPointingAtMenu && trigger.value > 0.1) {
      this._vrMenuTriggerLatch = true;
    }

    // Release the latch ONLY when the trigger is fully released
    if (this._vrMenuTriggerLatch && trigger.value <= 0.05) {
      this._vrMenuTriggerLatch = false;
    }

    // Only block if we are NOT already busy
    if ((this._isPointingAtMenu || this._wasPointingAtMenu || this._vrMenuTriggerLatch) && !isSculpting && !isToolActive) {
      // DEBUG: STICKY BRUSH DIAGNOSIS
      if (this._vrSculpting && window.screenLog && this._logThrottle % 30 === 0) {
        window.screenLog(`Stuck? Sc=${this._vrSculpting} Hand=${this._vrLockedHand} Src=${source.handedness} Btn=${trigger.pressed} Val=${trigger.value.toFixed(2)}`, trigger.pressed ? "lime" : "red");
      }

      // Phase 7: Still update the tool for Scale/Matrices so it doesn't "pop", 
      // but force isPressed=false so it doesn't sculpt/drag through the menu.
      const rayPose = frame.getPose(source.targetRaySpace, refSpace);
      const dir = vec3.create();
      if (rayPose) {
        vec3.set(dir, -rayPose.transform.matrix[8], -rayPose.transform.matrix[9], -rayPose.transform.matrix[10]);
      } else {
        vec3.set(dir, 0, 0, -1); // Fallback
      }
      vec3.normalize(dir, dir);
      this._sculptManager.updateXR(this._picking, false, enginePos, dir, {
        isNegative: false,
        controllers: [],
        triggerValue: 0.0,
        handedness: source.handedness,
        quat: engineQuat
      });
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

    if (this._spectatorMode === Enums.SpectatorMode.STATIONARY && this._camera._specView && this._camera._specViewPhys) {
      // OPTICAL UI MAPPING: Direction
      // 1. Convert physical controller heading into physical camera lens space
      // Direction vectors only need the 3x3 rotation portion of the matrix (mat3)
      const mat3Phys = mat3.create();
      mat3.fromMat4(mat3Phys, this._camera._specViewPhys);
      vec3.transformMat3(engineDir, engineDir, mat3Phys);

      // 2. Trace optical direction back into Virtual World space
      const invHackedView = mat4.create();
      mat4.invert(invHackedView, this._camera._specView);
      const mat3VirtInv = mat3.create();
      mat3.fromMat4(mat3VirtInv, invHackedView);
      vec3.transformMat3(engineDir, engineDir, mat3VirtInv);
    } else {
    // STANDARD MAPPING:
      // Transform Direction to Model Space (Inv Rotation only)
      if (this._xrWorldOffset) {
        const r = this._xrWorldOffset.orientation;
        const qInv = quat.create();
        const qRot = quat.fromValues(r.x, r.y, r.z, r.w);
        quat.invert(qInv, qRot);
        vec3.transformQuat(engineDir, engineDir, qInv);
      }
    }
    vec3.normalize(engineDir, engineDir);

    // B. Compute Ray Origin (Model Space) - Use Exact Controller Position
    // Removed 1cm offset to match Visual Laser alignment
    const rayOriginPhysical = [p.x, p.y, p.z];

    // Transform Ray Origin to Model Space
    const rayOrigin = vec3.create();

    if (this._spectatorMode === Enums.SpectatorMode.STATIONARY && this._camera._specView && this._camera._specViewPhys) {
      // OPTICAL UI MAPPING: Origin
      // This MUST perfectly mirror the enginePos optical translation logic
      vec3.copy(rayOrigin, rayOriginPhysical);
      vec3.transformMat4(rayOrigin, rayOrigin, this._camera._specViewPhys);

      const invHackedView = mat4.create();
      mat4.invert(invHackedView, this._camera._specView);
      vec3.transformMat4(rayOrigin, rayOrigin, invHackedView);
    } else {
    // STANDARD MAPPING:
      vec3.copy(rayOrigin, rayOriginPhysical);
      if (this._xrWorldOffset) {
        vec3.transformMat4(rayOrigin, rayOrigin, this._xrWorldOffset.inverse.matrix);
      }
      vec3.scale(rayOrigin, rayOrigin, invScale);
    }

    // C. Perform Intersection
    // Lock Selection Logic: If locked and we have a mesh, skip picking
    this._picking._rWorld2 = pickingRadius * pickingRadius;

    // GIZMO DRAG GUARD: If TransformVR is dragging, skip re-picking to keep cursor on handle
    const isTransformDrag = currentTool && currentTool.constructor.name === 'TransformVR' && currentTool._initInput;

    // CONTROLLER ISOLATION: 
    // If a Transform drag is active, ignore input from any hand other than the locked one.
    // This prevents the "other hand" from polluting global state (rayOrigin, enginePos, etc.) 
    // or triggering hover/selection events during a drag.
    if (isTransformDrag && this._vrLockedHand && source.handedness !== this._vrLockedHand) {
      return;
    }


    let picked = false;
    if (isTransformDrag) {
      // Skip picking, keep current intersection
      picked = true;
    } else if (this._selectionLocked && this._picking.getMesh()) {
      // Keep current mesh, but we might still need to update intersection point on THAT mesh?
      // actually intersectionRayMeshes does both selection AND intersection point update.
      // If we skip it, we don't update the cursor position!
      // We must force intersection ONLY on the current mesh.

      // Feature Toggle: Transform uses Ray/Aim intersect instead of volume
      let useVolume = this._vrUseVolumeIntersect;
      if (currentTool && (currentTool.constructor.name === 'TransformVR' || currentTool.constructor.name === 'SculptVoxel')) {
        useVolume = false;
      }

      if (useVolume) {
        picked = this._picking.intersectionSphereMeshes([this._picking.getMesh()], enginePos, pickingRadius);
      } else {
        const farPoint = vec3.create();
        vec3.scaleAndAdd(farPoint, rayOrigin, engineDir, 5000.0);
        picked = this._picking.intersectionRayMesh(this._picking.getMesh(), rayOrigin, farPoint);
      }
    } else {
      let useVolume = this._vrUseVolumeIntersect;
      if (currentTool && (currentTool.constructor.name === 'TransformVR' || currentTool.constructor.name === 'SculptVoxel')) {
        useVolume = false;
      }

      if (useVolume) {
        picked = this._picking.intersectionSphereMeshes(this._meshes, enginePos, pickingRadius);
      } else {
        picked = this._picking.intersectionRayMeshes(this._meshes, rayOrigin, engineDir);
      }
    }

    // DEBUG: Picking Trace
    // if (window.screenLog && this._logThrottle % 60 === 0) {
    //   const msg = `Pick:${picked ? 'YES' : 'NO'} Rad:${(pickingRadius * 100).toFixed(2)}cm`;
    //   window.screenLog(msg, picked ? "lime" : "red");
    // }

    // [DEBUG] Interactive Raycaster Debugger
    if (window.debugRaycaster) {
      if (this._debugRayOrigin) {
        const mOrigin = this._debugRayOrigin.getMatrix();
        mat4.identity(mOrigin);
        mat4.translate(mOrigin, mOrigin, rayOrigin);

        let s = window.debugRayScale || 0.05;
        if (this._vrScale && this._vrScale > 0.0001) s /= this._vrScale;
        mat4.scale(mOrigin, mOrigin, [s, s, s]);
      }
      if (this._debugRayTarget) {
        const mTarget = this._debugRayTarget.getMatrix();
        mat4.identity(mTarget);
        const targetPos = vec3.create();
        vec3.scaleAndAdd(targetPos, rayOrigin, engineDir, 50.0);
        mat4.translate(mTarget, mTarget, targetPos);

        let s = window.debugRayScale || 0.05;
        if (this._vrScale && this._vrScale > 0.0001) s /= this._vrScale;
        mat4.scale(mTarget, mTarget, [s, s, s]);
      }

      if (window.screenLog && this._logThrottle % 60 === 0 && source.handedness === this._dominantHand) {
        window.screenLog(`VRScale: ${this._vrScale.toFixed(3)} | RayOrigin(E): ${rayOrigin[0].toFixed(2)}, ${rayOrigin[1].toFixed(2)}, ${rayOrigin[2].toFixed(2)}`, 'cyan');
        window.screenLog(`Pick: ${picked ? 'YES' : 'NO'} | PhysRad: ${(physicalRadius * 100).toFixed(2)}cm`, picked ? "lime" : "red");
      }
    }

    // 5. Stroke Lifecycle (Corrected API)
    const buttons = source.gamepad.buttons;
    // PHASE 11 Fix: If we are already sculpting/dragging with this hand, it IS the trigger state that matters
    // regardless of global dominance.
    const isDominant = (source.handedness === this._dominantHand);
    const isTriggerPressed = (this._vrLockedHand === source.handedness) ? buttons[0].pressed : (isDominant && buttons[0].pressed);

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

        this._sculptManager.start(this._vrMultiSelect);
        this._action = Enums.Action.SCULPT_EDIT;
      }
      this._sculptManager.preUpdate(); // Sync position

      // ... existing code ...
    } else {
      if (this._vrSculpting) {
        const reason = !isTriggerPressed ? "Trigger Released" : "Logic Blocked";

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

        // Determine Effective Negative State
        const session = frame.session;
        const nonDomHand = this._dominantHand === 'left' ? 'right' : 'left';

        const currentTool = this._sculptManager.getCurrentTool();
        const origNegative = currentTool ? currentTool._negative : false;

        // Effective state: Tool's innate state XOR Physical Button Override
        const isNegative = this._vrSubtractActive ? !origNegative : origNegative;
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

        // Universal Sub Mode: Apply Effective Negative State to Tool
        const tool = currentTool;
        if (tool) tool._negative = isNegative;

        // VR Ergonomics: Temporary Smooth Modifier
        // If the non-dominant index trigger is held, force the active tool to Smooth temporarily.
        let isSmoothOverride = false;
        if (session && session.inputSources) {
          for (let src of session.inputSources) {
            if (src.handedness === nonDomHand && src.gamepad) {
              // Button 0 (Index Trigger)
              if (src.gamepad.buttons[0] && src.gamepad.buttons[0].pressed) {
                isSmoothOverride = true;
                break;
              }
            }
          }
        }

        let previousToolIndex = -1;
        if (isSmoothOverride) {
          // 2 is SCULPT_SMOOTH in Enums.Tools
          // Or we can just grab it by name if we don't know the Enum explicitly here.
          // Let's rely on sculptManager._tools[2] or similar, but safer to find it.
          const smoothToolIndex = this._sculptManager._tools.findIndex(t => t && t.constructor.name === 'Smooth');
          if (smoothToolIndex !== -1 && tool !== this._sculptManager._tools[smoothToolIndex]) {
            previousToolIndex = this._sculptManager._toolIndex;
            this._sculptManager._toolIndex = smoothToolIndex;
            // Sync radius from current tool to smooth tool so size feels consistent
            this._sculptManager.getCurrentTool()._radius = tool._radius;
          }
        }

        this._sculptManager.updateXR(this._picking, isTriggerPressed, enginePos, dir, {
          isNegative: isNegative,
          controllers: xrControllers,
          triggerValue: triggerValue,
          handedness: source.handedness,
          quat: engineQuat
        });

        // Restore original state immediately
        if (tool) tool._negative = origNegative;
        if (isSmoothOverride && previousToolIndex !== -1) {
          this._sculptManager._toolIndex = previousToolIndex;
        }
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
        this.updateDebugCursor(this._vrControllerPos, true, cursorSize);
        if (this._debugCursor) this._debugCursor.setFlatColor(picked ? [1.0, 1.0, 0.0] : [1.0, 0.0, 0.0]);
      }
    }
  }

  updateDebugCursor(pos, active, radius = 0.01) {
    if (!this._debugCursor) this.initDebugCursor();
    if (!this._debugCursor) return;

    if (active && pos && !window.isUIHiddenForVR) {
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

  toggleSpectatorCalibration() {
    this._isCalibratingSpectator = !this._isCalibratingSpectator;
    const label = this._isCalibratingSpectator ? "CALIBRATION MODE (Move Me)" : "Standard Mode";
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
