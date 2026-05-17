import { vec3, mat3, mat4, quat } from 'gl-matrix';
import * as THREE from 'three';
import { XRControllerModelFactory } from './XRControllerModelFactory_local.js';
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
import ShaderManager from './render/ShaderManager.js';
import MeshStatic from './mesh/meshStatic/MeshStatic.js';
import WebGLCaps from './render/WebGLCaps.js';
import GuiXR from './gui/GuiXR.js';
import Remesh from './editing/Remesh.js';
import VRMenu from './drawables/VRMenu.js';
import VRLaser from './drawables/VRLaser.js';
import GazeTooltip from './drawables/GazeTooltip.js';

if (typeof XRRigidTransform === 'undefined') {
    console.log('Polyfilling XRRigidTransform for iOS/Safari');
    window.XRRigidTransform = class XRRigidTransform {
        constructor(position = { x: 0, y: 0, z: 0 }, orientation = { x: 0, y: 0, z: 0, w: 1 }) {
            this.position = { x: position.x || 0, y: position.y || 0, z: position.z || 0 };
            this.orientation = { x: orientation.x || 0, y: orientation.y || 0, z: orientation.z || 0, w: orientation.w || 1 };
        }
    };
}

console.log(`Scene.js loaded ${VERSION}`);

window.dumpMeshTopology = function() {
    var mainApp = window.sculptgl_instance;
    if (!mainApp || !mainApp._meshes || mainApp._meshes.length === 0) {
        console.log("No active mesh found.");
        return;
    }
    var mm = mainApp._meshes[0];
    if (!mm || !mm._meshes) return;

    console.log(`--- [NATIVE TOPOLOGY DUMP] ---`);
    for (var L = 0; L < mm._meshes.length; L++) {
        var lvl = mm._meshes[L];
        var v = lvl.getVertices();
        var f = lvl.getFaces();
        var vStr = "";
        for (var i = 0; i < Math.min(v.length, 36); i += 3) {
            vStr += `[${v[i].toFixed(2)}, ${v[i+1].toFixed(2)}, ${v[i+2].toFixed(2)}] `;
        }
        var fStr = "";
        for (var i = 0; i < Math.min(f.length, 48); i += 4) {
            fStr += `(${f[i]}, ${f[i+1]}, ${f[i+2]}, ${f[i+3]}) `;
        }
        console.log(`Level ${L} Vertices: ${vStr}`);
        console.log(`Level ${L} Faces: ${fStr}`);
    }
};

class Scene {

  constructor() {
    this._gl = null; // webgl context

    const opts = getOptionsURL();
    this._vrDeviceRadius = 0.05;

    // Feature Toggle: Aim (Ray) vs Touch (Sphere) picking
    this._vrUseVolumeIntersect = !opts.aimPickingMode; // By default, use Contact Picking (true) instead of Laser Pointer Raycasting (false)
    this._vrAmbidextrousCursors = opts.ambidextrousCursors; // Disable offhand sculpting cursors by default to reduce visual clutter

    this._cameraSpeed = 0.25;
    this._vrSecondaryTriggerPressed = false;

    // cache canvas stuffs
    this._pixelRatio = window.devicePixelRatio || 1.0;
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
    // Already declared at top of constructor
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
    this._handJointSpheres = null;

    // Desktop 6DOF Offset (Spectator Camera)
    // Offset relative to HMD: [x, y, z] in meters.
    // User Request: "Move forward 50cm, up 50cm".
    // Note: If HMD is facing User, "Forward" is towards User.
    // If we Rotate 180, we are looking effectively "Standard Forward".

    // [Step 1] Hand Swap Feature
    this._dominantHand = getOptionsURL().leftHandMode ? 'left' : 'right'; // 'right' or 'left'
    this._lockSelection = false; // Lock Selection State
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

    var gridState = true;
    try {
      const stored = localStorage.getItem('sculptxr_settings');
      if (stored) {
        const settings = JSON.parse(stored);
        if (settings.grid !== undefined) gridState = settings.grid;
      }
    } catch (e) {}
    this._showGrid = gridState;

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
      // MiniHUD bounds relative to Left Grip
      this._vrMiniHUD.setOffset(0.0, 0.05, -0.05);
      this._vrMiniHUD.setRotation(-Math.PI / 2, Math.PI / 8, 0);
    }
    if (!this._vrPopup) {
      this._vrPopup = new VRMenu(this._gl, this._guiPopup);
      this._vrPopup.setOffset(0.0, 0.05, -0.05);
      this._vrPopup.setRotation(-Math.PI / 2, Math.PI / 8, 0);
    }

    // Global override for live tuning
    window.MINI_HUD_TRANSFORM = {
      x: 0,
      y: 0.05, 
      z: 0.09,
      rx: 90,
      ry: 0,
      rz: 0
    };

    window.TOOLCOMB_TRANSFORM = {
      x: 0.015,
      y: 0.03,
      z: -0.01,
      rx: 0,
      ry: 0,
      rz: 0
    };


    // Init Gaze Tooltips
    this._gazeTooltipLeft = new GazeTooltip(this._gl, "Hold X: Menu");
    this._gazeTooltipRight = new GazeTooltip(this._gl, "Hold A: Sub");

    this.onCanvasResize();

    var modelURL = getOptionsURL().modelurl;
    if (modelURL) this.addModelURL(modelURL);
    else this.addSphere(); // Return default mesh to multires sculpting sphere

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

    // [PROFILE] In-App Performance Profiler
    window.__sculptProfile = {
      active: true,
      logNextNumFrames: 0,
      frames: 0,
      lastFrameTime: 0,

      // Accumulators
      accFrameDelta: 0,
      accRenderTotal: 0,
      accMeshOpaque: 0,
      accMeshWire: 0,
      accUI: 0
    };

    window.debugProfile = (numFrames = 120) => {
      // Reset accumulators and set frames to capture
      window.__sculptProfile.frames = 0;
      window.__sculptProfile.accFrameDelta = 0;
      window.__sculptProfile.accRenderTotal = 0;
      window.__sculptProfile.accMeshOpaque = 0;
      window.__sculptProfile.accMeshWire = 0;
      window.__sculptProfile.accUI = 0;
      window.__sculptProfile.logNextNumFrames = numFrames;

      if (window.screenLog) {
        window.screenLog(`Profiling next ${numFrames} frames...`, "orange");
      }
      return `Profiling next ${numFrames} frames...`;
    };

    // [PROFILE] Deep Function Profiler
    window.__sculptDeepProfile = {
      active: false,
      logNextNumFrames: 0,
      frames: 0,
      records: {} // { "Mesh.updateGeometryBuffers": { time: 0, hits: 0 } }
    };

    window.initDeepProfiler = (targets) => {
      // e.g. targets = [{ name: "SculptManager", instance: this._sculptManager }, { name: "Mesh", instance: this._mesh }]
      let wrappedCount = 0;
      window.__sculptDeepProfile.records = {};

      const wrapMethods = (instance, className) => {
        if (!instance) return;
        const proto = Object.getPrototypeOf(instance);
        const methodNames = Object.getOwnPropertyNames(proto)
          .filter(name => typeof proto[name] === 'function' && name !== 'constructor');

        methodNames.forEach(methodName => {
          const originalMethod = instance[methodName];
          const recordKey = `${className}.${methodName}`;

          window.__sculptDeepProfile.records[recordKey] = { time: 0, hits: 0 };

          // Replace the instance method with a proxy-like wrapper that traces the prototype method
          instance[methodName] = function (...args) {

            // If armed but not recording, wait for a stroke event
            if (window.__sculptDeepProfile.armed && !window.__sculptDeepProfile.active) {
              if (methodName === 'start' || methodName === 'makeStroke' || methodName === 'makeStrokeXR') {
                window.__sculptDeepProfile.active = true;
                if (window.screenLog) window.screenLog("[Deep Profiler] Stroke detected! Recording...", "orange");
              }
            }

            if (window.__sculptDeepProfile.active && window.__sculptDeepProfile.frames < window.__sculptDeepProfile.logNextNumFrames) {
              const start = performance.now();
              const result = originalMethod.apply(this, args);
              const end = performance.now();

              const record = window.__sculptDeepProfile.records[recordKey];
              record.time += (end - start);
              record.hits++;
              return result;
            } else {
              return originalMethod.apply(this, args);
            }
          };
          wrappedCount++;
        });
      };

      targets.forEach(t => wrapMethods(t.instance, t.name));

      window.__sculptDeepProfile.frames = 0;
      window.__sculptDeepProfile.logNextNumFrames = 60; // Run for 60 frames
      window.__sculptDeepProfile.armed = true; // Wait for stroke
      window.__sculptDeepProfile.active = false; // Don't record yet

      const msg = `Deep Profiler Armed! Wrapped ${wrappedCount} functions. Make a stroke...`;
      console.log(msg);
      if (window.screenLog) window.screenLog(msg, "orange");

      return msg;
    };

    window.printDeepProfile = () => {
      const records = window.__sculptDeepProfile.records;
      const sorted = Object.entries(records)
        .filter(([_, data]) => data.time > 0.05) // Ignore micro traces
        .sort((a, b) => b[1].time - a[1].time)
        .slice(0, 15); // Top 15

      console.log("=== SCULPTXR DEEP FUNCTION PROFILE (Top 15 Heaviest) ===");
      let logStr = "DEEP PROF:\n";

      if (sorted.length === 0) {
        logStr += "No significant function spikes found.";
      } else {
        sorted.forEach(([name, data], i) => {
          const avg = (data.time / data.hits).toFixed(3);
          const total = data.time.toFixed(2);
          const line = `${i + 1}. ${name} -> ${total}ms (Avg: ${avg}ms over ${data.hits} calls)\n`;
          console.log(line);
          // Keep the full string for desktop log
          logStr += `${name}: ${total}ms\n`;
        });
      }

      logStr += "Profile Finished!";
      if (window.screenLog) window.screenLog(logStr, "lime");

      // Disarm
      window.__sculptDeepProfile.armed = false;
      window.__sculptDeepProfile.active = false;
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
      }
      return { pos, scale };
    };

    window.debugThreeState = () => {
      let logStr = "=== THREE.JS STATE ===\n";
      logStr += `Scene Children: ${this._scene ? this._scene.children.length : 'No Scene'}\n`;
      if (this._scene) {
        this._scene.children.forEach(c => {
          logStr += `- ${c.type} (Pos: ${c.position.x.toFixed(2)}, ${c.position.y.toFixed(2)}, ${c.position.z.toFixed(2)})\n`;
          if (c.geometry) {
             const posAttr = c.geometry.getAttribute('position');
             logStr += `  verts: ${posAttr ? posAttr.count : 0}\n`;
          }
        });
      }
      if (this._camera && this._camera.getThreeCamera()) {
         const tCam = this._camera.getThreeCamera();
         logStr += `Camera Pos: ${tCam.position.x.toFixed(2)}, ${tCam.position.y.toFixed(2)}, ${tCam.position.z.toFixed(2)}\n`;
         logStr += `Camera Near: ${tCam.near.toFixed(3)}, Far: ${tCam.far.toFixed(1)}, FOV: ${tCam.fov}\n`;
         logStr += `Camera Proj[0]: ${tCam.projectionMatrix.elements[0].toFixed(3)}\n`;
      }
      console.log(logStr);
      if (window.screenLog) window.screenLog(logStr, "cyan");
      return logStr;
    };
    
    // Auto-dump after 2 seconds
    // setTimeout(window.debugThreeState, 2000);


    // Pre-warm all VR controller/cursor/menu GPU resources now, while the user is
    // still on the desktop.  initVRControllers() has guards so every object is
    // created at most once.  Paying the ~300ms cost here means VR entry is instant.
    this.initVRControllers();

    // Start Three.js continuous render loop
    // This replaces manual window.requestAnimationFrame and session.requestAnimationFrame calls
    if (this._renderer) {
      this._renderer.setAnimationLoop((time, frame) => {
        this.applyRender(null, frame);
      });
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

    // --- TOOL CONTEXT SWITCHING ---
    const selected = this._selectMeshes;
    if (selected.length > 0) {
      let hasVoxel = false;
      let hasPoly = false;

      for (let m of selected) {
        if (m._isVoxel) hasVoxel = true;
        else hasPoly = true;
      }

      const sc = this.getSculptManager();
      if (sc) {
        if (!window._lastPolyTool) window._lastPolyTool = Enums.Tools.BRUSH;
        const curIdx = sc.getToolIndex();
        if (curIdx !== Enums.Tools.VOXEL && curIdx !== Enums.Tools.TRANSFORM_VR && curIdx !== Enums.Tools.TRANSFORM) {
          window._lastPolyTool = curIdx;
        }

        if (hasVoxel && hasPoly) {
          sc.setToolIndex(-1); // Explicit safety detachment
          window._activeToolTab = 0;
        } else if (hasVoxel) {
          sc.setToolIndex(Enums.Tools.VOXEL);
          window._activeToolTab = 2;
        } else if (hasPoly) {
          if (curIdx !== Enums.Tools.TRANSFORM_VR && curIdx !== Enums.Tools.TRANSFORM) {
            sc.setToolIndex(window._lastPolyTool || Enums.Tools.BRUSH);
          }
          window._activeToolTab = 0;
        }

        if (this._guiXR) {
          this._guiXR.refreshToolsWidget();
          this._guiXR._needsRedraw = true;
        }
        if (this._guiMini) {
          this._guiMini.refreshToolsWidget();
          this._guiMini._needsRedraw = true;
        }
      }
    }

    this.getGui().updateMesh();
    this.render();
    return mesh;
  }

  renderSelectOverRtt() {
    // Legacy RTT passes are disabled in Three.js migration.
    // Setting _drawFullScene = false here was causing the main render loop
    // to drop 100% of frames during mouse drag (camera tumbling), 
    // resulting in massive perceived lag.
    // this._drawFullScene = false; 
  }

  _requestRender() {
    // Redundant now that Three.js runs internally via setAnimationLoop 
    // We keep the method signature for backwards compatibility across UI files
    return true;
  }

  render() {
    this._drawFullScene = true;
  }

  applyRender(arg, xrFrame = null) {
    var targetFBO = (arg && typeof arg === 'object') ? arg : null;
    this._preventRender = false;
    this.updateMatricesAndSort();

    var gl = this._gl;
    if (!gl) return;

    if (this._renderer && this._renderer.xr && this._renderer.xr.isPresenting) {
      const frame = this._renderer.xr.getFrame();
      if (!frame) return;
      const refSpace = this._renderer.xr.getReferenceSpace();

      if (!window._firstXRFrameLogged) {
        window._firstXRFrameLogged = true;
        const elapsed = window._xrSessionStartT ? Math.round(performance.now() - window._xrSessionStartT) : '?';
        if (window.screenLog) window.screenLog(`[XR] First frame rendered (+${elapsed}ms from session start)`, "cyan");
        console.log(`[XR Timing] First frame at +${elapsed}ms`);
        // initVRControllers is deferred via Promise.resolve() below so this frame
        // is submitted to the compositor before we block for 200+ms.
      }

      if (!window._firstXRInputHandled && refSpace) {
        window._firstXRInputHandled = true;
        // console.log("[Telemetry] Reference Space obtained, first handleXRInput executed!");
      }

      this._xrFrameCount = (this._xrFrameCount || 0) + 1;
      if (this._xrFrameCount % 60 === 0 || this._xrFrameCount === 10 || this._xrFrameCount === 30) {
        // console.log(`[Telemetry] WebXR Render Active: Frame #${this._xrFrameCount}`);
      }

      this._logThrottle = (this._logThrottle || 0) + 1;

      // VR Menu Update (Sync with Frame and Upload to WebGL if dirty)
      if (this._guiXR) this._guiXR.update();
      if (this._guiMini) this._guiMini.update();
      if (this._guiPopup) this._guiPopup.update();

      if (frame && refSpace && typeof this.handleXRInput === 'function') {
        try {
          this.handleXRInput(frame, refSpace);
        } catch (e) {
          console.error("XR Input Error:", e);
        }
      }
      
      // --- PUPPETEER PLAYBACK ---
      if (window._animPlaying && window._animationRegistry) {
        // Drive ALL tracks continuously in parallel
        if (this._meshes) {
          for (let i = 0; i < this._meshes.length; i++) {
            const m = this._meshes[i];
            // Skip playback update for the mesh currently being recorded
            if (window._animationRegistry.isRecording && m.getID() === window._animationRegistry.activeRecordingId) {
              continue;
            }
            window._animationRegistry.update(m);
          }
          this._drawFullScene = true;
          if (this._guiXR) {
            this._guiXR._needsRedraw = true;
          }
        }
      }
    }

    // Desktop Animation Playback
    if (window._animPlaying && window._animationRegistry && !(this._renderer && this._renderer.xr && this._renderer.xr.isPresenting)) {
      if (this._vrCursorLeft) this._vrCursorLeft.visible = false;
      if (this._vrCursorRight) this._vrCursorRight.visible = false;

      if (this._meshes) {
        for (let i = 0; i < this._meshes.length; i++) {
          const m = this._meshes[i];
          // Skip playback update for the mesh currently being recorded
          if (window._animationRegistry.isRecording && m.getID() === window._animationRegistry.activeRecordingId) {
            if (window.screenLog && Math.random() < 0.05) {
              window.screenLog(`Skipping update for recording mesh: ${m.getID()}`, "cyan");
            }
            continue;
          }
          window._animationRegistry.update(m);
        }
        this._drawFullScene = true; // Ensure we redraw
      }
    }

    if (this._renderer && this._renderer.xr) {
      if (this._renderer.xr.isPresenting && !window._loggedXRRender) {
         // console.log("WebXR isPresenting - forcing _drawScene()");
         window._loggedXRRender = true;
         // if (window.screenLog) window.screenLog("WebXR Render Loop Started", "lime");

      }
    }

    if (this._drawFullScene || (this._renderer && this._renderer.xr && this._renderer.xr.isPresenting)) {
      this._drawScene();
    } else {
       if (this._renderer && this._renderer.xr && this._renderer.xr.isPresenting) {
           console.log("WARNING: isPresenting is true but not rendering!");
           if (window.screenLog) window.screenLog("WARNING: isPresenting true, draw stalled", "red");
       }
    }

    // Defer initVRControllers until AFTER _drawScene() so that frame 1 is committed
    // to the XR compositor before we block the JS thread for ~200ms.
    // Promise.resolve().then() is a microtask — it runs after this rAF callback
    // returns and the frame is handed off, but before the next rAF fires.
    if (this._vrControllersNeedInit) {
      this._vrControllersNeedInit = false;
      const self = this;
      Promise.resolve().then(() => {
        const t0 = performance.now();
        self.initVRControllers();
        const took = Math.round(performance.now() - t0);
        console.log(`[XR Timing] initVRControllers took ${took}ms (deferred post-frame)`);
        if (window.screenLog) window.screenLog(`[XR] Controllers init +${took}ms`, "lime");
      });
    }

    // Only alter global GL state if not in WebXR
    if (!(this._renderer && this._renderer.xr && this._renderer.xr.isPresenting)) {
        gl.disable(gl.DEPTH_TEST);
    }

    // --- LEGACY POST-PROCESSING (DISABLED FOR THREE.JS MIGRATION) ---
    /*
    if (this._rttMerge) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._rttMerge.getFramebuffer());
      this._rttMerge.render(this); // merge + decode
    }

    // render to screen (or target FBO)
    gl.bindFramebuffer(gl.FRAMEBUFFER, targetFBO);

    if (this._rttOpaque) {
      this._rttOpaque.render(this); // fxaa
    }
    */
    
    // (Legacy postRender moved to after Three.js render)
  }

  getExposure() {
    return this._exposure;
  }

  getToneMapping() {
    return this._renderer ? this._renderer.toneMapping : 1;
  }

  setExposure(val) {
    this._exposure = val;
    if (this._renderer) {
      this._renderer.toneMappingExposure = val;
    }
    this.render();
  }

  setToneMapping(val) {
    if (this._renderer) {
      this._renderer.toneMapping = val;
    }
    this.render();
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

  getStylusLength() {
    if (this._guiXR && this._guiXR._uiSettings && this._guiXR._uiSettings.stylusLength !== undefined) {
      return this._guiXR._uiSettings.stylusLength;
    }
    return this._isQuestStandalone ? 0.15 : 0.10;
  }

  updateStylusLength(val) {
    const scaleFactor = val / 0.10;
    const updateMesh = (ctrl) => {
      if (!ctrl) return;
      const spike = ctrl.getObjectByName('stylus_spike');
      if (spike) {
        spike.scale.set(1, 1, scaleFactor);
      }
    };
    updateMesh(this._vrControllerLeft);
    updateMesh(this._vrControllerRight);
  }

  getStylusOffset() {
    if (this._guiXR && this._guiXR._uiSettings && this._guiXR._uiSettings.stylusOffset !== undefined) {
      return this._guiXR._uiSettings.stylusOffset;
    }
    return 0.0;
  }

  updateStylusOffset(val) {
    const updateMesh = (ctrl) => {
      if (!ctrl) return;
      const spike = ctrl.getObjectByName('stylus_spike');
      if (spike) {
        spike.position.z = -val; // Negative to shift forward, Positive to shift backward
      }
    };
    updateMesh(this._vrControllerLeft);
    updateMesh(this._vrControllerRight);
  }

  getStylusTilt() {
    if (this._guiXR && this._guiXR._uiSettings && this._guiXR._uiSettings.stylusTilt !== undefined) {
      return this._guiXR._uiSettings.stylusTilt;
    }
    return 0.0;
  }

  updateStylusTilt(val) {
    const rad = val * Math.PI / 180.0;
    const updateMesh = (ctrl) => {
      if (!ctrl) return;
      const spike = ctrl.getObjectByName('stylus_spike');
      if (spike) {
        spike.rotation.x = rad;
      }
      const rayRoot = ctrl.getObjectByName('pointer_ray_root');
      if (rayRoot) {
        rayRoot.rotation.x = rad;
      }
    };
    updateMesh(this._vrControllerLeft);
    updateMesh(this._vrControllerRight);
  }

  // Simplified VR Render (Bypassing RTT/PostProc for now)
  // Shared Render Logic (Parity for Spectator)
  _renderSceneVR(cam, viewMatrix, projMatrix, worldViewMatrixOverride = null, frame = null) {
    // --- THREE.JS HANDLES VR RENDERING NATIVELY ---
    // The WebXRManager in renderer.xr automatically intercepts the render loop,
    // applies the headset poses to the camera, and renders the scene.
    // We no longer need this custom multi-pass manual implementation.
    return;
  }


  // `renderVR` and `_drawSceneVR` have been removed in the Three.js WebXR Migration.

  _drawScene() {
    var gl = this._gl;
    var i = 0;
    var meshes = this._meshes;
    var nbMeshes = meshes.length;

    // Hide brush cursors during playback or when using transform tool
    const sm = this._sculptManager;
    const curIdx = sm ? sm.getToolIndex() : -1;
    const isTransform = curIdx === Enums.Tools.TRANSFORM || curIdx === Enums.Tools.TRANSFORM_VR;

    // In VR, _updateVRCursors manages cursor visibility per-hand (offhand is hidden there).
    // Only force-set visibility on desktop where _updateVRCursors doesn't run.
    const isVRPresenting = this._renderer && this._renderer.xr && this._renderer.xr.isPresenting;
    if (!isVRPresenting) {
      if (this._vrCursorLeft) this._vrCursorLeft.visible = !window._animPlaying && !isTransform;
      if (this._vrCursorRight) this._vrCursorRight.visible = !window._animPlaying && !isTransform;
    }

    // ── MINIMAL VR TEST MODE ─────────────────────────────────────────────────
    // Set window._vrMinimalTest = true in the console before entering VR to hide
    // everything and render only the background colour.  This isolates whether
    // the startup delay / FBO errors are caused by our draw calls or by the XR
    // session itself.
    //   window._vrMinimalTest = 0  → normal rendering (default)
    //   window._vrMinimalTest = 1  → hide meshes + cursors + menus + controllers
    //   window._vrMinimalTest = 2  → skip renderer.render() entirely (raw empty frames)
    if (window._vrMinimalTest && isVRPresenting) {
      const lvl = window._vrMinimalTest;
      if (lvl >= 2) {
        // Level 2: submit nothing at all — let the XR compositor decide what to show
        return;
      }
      // Level 1: hide every scene object, render only clear colour
      if (this._scene) {
        this._scene.traverse(o => { if (o.isMesh || o.isLine || o.isPoints) o.visible = false; });
      }
      this._renderer.setClearColor(0x003300, 1); // deep green = "minimal mode active"
      this._renderer.render(this._scene, this._camera.getThreeCamera());
      this._renderer.setClearColor(0x000000, 0);
      return;
    }
    // ─────────────────────────────────────────────────────────────────────────

    // --- THREE.JS MAIN RENDER ---
    // Instead of looping through custom meshes, we tell Three.js to render the scene
    if (this._renderer && this._scene && this._camera.getThreeCamera()) {
      const isVR = this._renderer.xr && this._renderer.xr.isPresenting;
      
      let currentTarget = null;
      if (!isVR) {
        // Force Three.js to forget its cached WebGL state. This prevents 'uniformMatrix4fv: location is not from the associated program'
        // errors caused by legacy raw WebGL passes binding their own shaders just before Three.js renders.
        // CRITICAL FIX: We must save and restore the current Render Target, otherwise resetState() unbinds the WebXR baseLayer!
        currentTarget = this._renderer.getRenderTarget();
        this._renderer.resetState();
        this._renderer.setRenderTarget(currentTarget);
      }
      
      // Update custom shader uniforms and wireframe overlays before rendering
      for (var j = 0; j < nbMeshes; ++j) {
        if (meshes[j] && meshes[j].updateWireframeBuffer) {
            meshes[j].updateWireframeBuffer();
        }
        if (meshes[j] && meshes[j].getThreeMesh()) {
           ShaderManager.updateUniforms(meshes[j], this);
        }
      }

      // Sync Ground Plane Visibility with UI
      if (this._groundGrid) this._groundGrid.visible = !!this._showGrid;

      // GalaxyXR / Adreno: explicitly rebind the XR base layer framebuffer before
      // every render. The Adreno tile renderer occasionally drops the FBO binding
      // between frames, causing framebuffer-incomplete errors on glClear/glDraw.
      // This mirrors the per-eye rebind fix documented in docs/galaxyxr.md.
      if (isVR) {
        const xrSession = this._renderer.xr.getSession();
        const baseLayer = xrSession && xrSession.renderState && xrSession.renderState.baseLayer;
        if (baseLayer && baseLayer.framebuffer) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, baseLayer.framebuffer);
        }
      }

      // Three.js clears depth on its own, so we render over the top
      this._renderer.render(this._scene, this._camera.getThreeCamera());
      
      if (!isVR) {
        // CRITICAL FIX: Unbind the active WebGL VAO (Vertex Array Object).
        // Three.js leaves the sculpt mesh's VAO bound after rendering. 
        // The legacy raw WebGL passes (Gizmo, Cursors) that run during postRender() do NOT use VAOs.
        // If we don't unbind here, the legacy passes will accidentally mutate the sculpt mesh's VAO,
        // permanently hijacking its Attribute 0 buffer to point to a tiny 24-byte Gizmo line buffer,
        // crashing WebGL on the next frame when Three.js tries to draw millions of vertices.
        var ext = gl.getExtension('OES_vertex_array_object');
        if (ext && ext.bindVertexArrayOES) {
            ext.bindVertexArrayOES(null);
        } else if (gl.bindVertexArray) {
            gl.bindVertexArray(null);
        }
        
        // Also reset Three.js state tracker so it knows we messed with WebGL underneath it
        const currentTargetPost = this._renderer.getRenderTarget();
        this._renderer.resetState();
        this._renderer.setRenderTarget(currentTargetPost);

        // Draw sculpting gizmo stuffs over Three.js render
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.enable(gl.DEPTH_TEST);
        if (this._sculptManager) this._sculptManager.postRender();
      }
      
      if (isVR) {
          if (!window._xrFrameCount) window._xrFrameCount = 0;
          window._xrFrameCount++;
        //   if (window._xrFrameCount % 60 === 0 && window.screenLog) {
        //       window.screenLog("XR Frame Drawn: " + window._xrFrameCount, "cyan");
        //   }
          // --- CRITICAL ISOLATION FOR WEBXR ---
          // Do NOT execute ANY further legacy WebGL commands (like postRender, or depth disabling)
          // The XR Compositor requires the baseLayer framebuffer to remain bound and pristine.
          return;
      }
    }

    /* 
    // --- LEGACY WEBGL PASSES (DISABLED FOR THREE.JS MIGRATION) ---
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
    // if (this._showGrid && this._grid) this._grid.render(this);

    // VR Controllers are handled by Three.js Scene graph now. No custom WebGL rendering needed.

    // var startTransparent = nbMeshes;
    // if (this._meshPreview) this._meshPreview.render(this);

    // background
    // if (this._background) this._background.render();

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
      if (meshes[i].getShowWireframe()) {
         // meshes[i].renderWireframe(this); 
      }
    }
    gl.depthFunc(gl.LEQUAL);

    gl.depthMask(false);
    gl.enable(gl.CULL_FACE);

    gl.disable(gl.CULL_FACE);

    ///////////////
    // CONTOUR 2/2
    ///////////////
    if (showContour && this._rttContour) {
      this._rttContour.render(this);
    }

    gl.depthMask(true);
    gl.disable(gl.BLEND);
    */
  }

  /** Pre compute matrices and sort meshes */
  updateMatricesAndSort() {
    var meshes = this._meshes;
    var cam = this._camera;
    if (meshes.length > 0 && !window._disableOptimizeNearFar) {
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
    var canvas = document.getElementById('canvas');
    
    // Initialize Three.js Renderer
    this._renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      antialias: false  // MSAA causes glBlitFramebufferCHROMIUM errors on WebXR session start,
                        // dropping the first few frames and extending the gray void. Disabled.
    });
    this._renderer.setPixelRatio(window.devicePixelRatio);
    this._renderer.setSize(window.innerWidth, window.innerHeight);
    this._renderer.xr.enabled = true; // WebXR support is native in Three.js
    // Explicitly set framebuffer scale to 1.0. This prevents Three.js from creating
    // a mismatched MSAA FBO on session start, which causes glBlitFramebufferCHROMIUM
    // errors on the first few frames and makes the compositor show the gray void.
    this._renderer.xr.setFramebufferScaleFactor(1.0);
    this._renderer.toneMapping = THREE.LinearToneMapping;
    this._renderer.toneMappingExposure = 1.0;

    // Initialize underlying GL context for legacy code compatibility (temporarily)
    this._gl = this._renderer.getContext();
    if (!this._gl) {
      window.alert('Values: WebGL context could not be retrieved.');
      return;
    }

    // Initialize Three.js Scene Components
    this._scene = new THREE.Scene();
    
    // WebXR offset tracking container: WebXR forces physical poses relative to the `Scene` root.
    // If we want the mesh to be down in front of the user (like on a desk), we put meshes in a _worldGroup
    // and move/scale the _worldGroup, while the headset roams the root scene freely.
    this._worldGroup = new THREE.Group();
    this._worldGroup.position.set(0, 0, 0);
    this._worldGroup.quaternion.set(0, 0, 0, 1);
    this._worldGroup.scale.set(0.701, 0.701, 0.701);
    this._scene.add(this._worldGroup);
    
    // Add basic lighting since we are using MeshStandardMaterial
    this._scene.add(new THREE.AmbientLight(0x404040, 2.0)); // soft white light
    var dirLight = new THREE.DirectionalLight(0xffffff, 2.0);
    dirLight.position.set(1, 1, 1);
    this._scene.add(dirLight);

    // Localized Geometry Base Grid (100 units wide, 25 divisions for massive 4-meter visual blocks)
    this._groundGrid = new THREE.GridHelper(100, 25, 0x888888, 0x444444);
    this._groundGrid.material.transparent = true;
    this._groundGrid.material.opacity = 0.5;
    this._groundGrid.material.depthWrite = false;
    this._groundGrid.position.y = -0.25;
    this._groundGrid.visible = !!this._showGrid;
    this._worldGroup.add(this._groundGrid);

    // Fallback/Legacy Caps init
    WebGLCaps.initWebGLExtensions(this._gl);
    const isWebGL2 = (typeof WebGL2RenderingContext !== 'undefined' && this._gl instanceof WebGL2RenderingContext);
    if (!isWebGL2 && !WebGLCaps.getWebGLExtension('OES_element_index_uint')) {
      RenderData.ONLY_DRAW_ARRAYS = true;
    }

    // DEBUG: Inject Three.js objects into global scope for console debugging
    // this._scene.add(new THREE.AxesHelper(100)); // Large axes (100 units)
    
    window.threeScene = this._scene;
    window.threeCamera = this._camera.getThreeCamera();
    
    // Provide a default physical standing camera position so desktop preview isn't
    // locked inside the mesh origin. WebXR will override this locally when a headset connects.
    this._camera.getThreeCamera().position.set(0, 1.6, 3);
    this._scene.add(this._camera.getThreeCamera());

    // Intensive Diagnostic Script
    window.diagnoseGridMesh = () => {
        if (!this._meshes || this._meshes.length === 0) return "No meshes found.";
        const m = this._meshes[0].getThreeMesh();
        const scm = this._meshes[0];
        if (!m) return "No Three.js mesh found on main mesh";
        let out = `\n=== DIAGNOSE MESH ===\n`;
        out += `Three.js UserData: ${!!m.userData.sculptMesh}\n`;
        out += `Matrix AutoUpdate: ${m.matrixAutoUpdate}\n`;
        
        let mArr = m.matrixWorld.elements;
        out += `MatrixWorld Scale: (${Math.hypot(mArr[0], mArr[1], mArr[2]).toFixed(4)}, ${Math.hypot(mArr[4], mArr[5], mArr[6]).toFixed(4)}, ${Math.hypot(mArr[8], mArr[9], mArr[10]).toFixed(4)})\n`;
        out += `MatrixWorld Pos: (${mArr[12].toFixed(4)}, ${mArr[13].toFixed(4)}, ${mArr[14].toFixed(4)})\n`;
        
        const g = m.geometry;
        if (!g) { out += "NO GEOMETRY\n"; return out; }
        
        out += `\n--- GEOMETRY ---\n`;
        out += `DrawRange: ${g.drawRange.start} to ${g.drawRange.count}\n`;
        g.computeBoundingBox();
        out += `BoundingBox: [${g.boundingBox.min.x.toFixed(4)}, ${g.boundingBox.min.y.toFixed(4)}, ${g.boundingBox.min.z.toFixed(4)}] to [${g.boundingBox.max.x.toFixed(4)}, ${g.boundingBox.max.y.toFixed(4)}, ${g.boundingBox.max.z.toFixed(4)}]\n`;
        
        if (g.attributes.position) {
            let p = g.attributes.position.array;
            out += `Position Attr Count: ${g.attributes.position.count}\n`;
            out += `First 3 Verts: (${p[0]}, ${p[1]}, ${p[2]}), (${p[3]}, ${p[4]}, ${p[5]}), (${p[6]}, ${p[7]}, ${p[8]})\n`;
        } else {
            out += `NO POSITION ATTRIBUTE\n`;
        }
        
        if (g.attributes.normal) {
            let n = g.attributes.normal.array;
            out += `Normal Attr Count: ${g.attributes.normal.count}\n`;
            out += `First 3 Normals: (${n[0]}, ${n[1]}, ${n[2]}), (${n[3]}, ${n[4]}, ${n[5]}), (${n[6]}, ${n[7]}, ${n[8]})\n`;
        } else {
            out += `NO NORMAL ATTRIBUTE\n`;
        }
        
        if (g.index) {
            let i = g.index.array;
            out += `Index Attr Count: ${g.index.count}\n`;
            out += `First 9 Indices: ${i[0]}, ${i[1]}, ${i[2]}, ${i[3]}, ${i[4]}, ${i[5]}, ${i[6]}, ${i[7]}, ${i[8]}\n`;
        } else {
             out += `NO INDEX ATTRIBUTE (Using DrawArrays Triangle Soup)\n`;
        }
        
        out += `\n--- PARENT ---\n`;
        out += `Parent: ${m.parent ? m.parent.type : 'NONE'}\n`;
        out += `Visible: ${m.visible}\n`;
        
        out += `\n--- MATERIAL ---\n`;
        let mat = m.material;
        if (!mat) { out += "NO MATERIAL\n"; return out; }
        out += `Type: ${mat.type}\n`;
        out += `Color: ${mat.color ? '#' + mat.color.getHexString() : 'N/A (ShaderMaterial)'}\n`;
        out += `VertexColors: ${mat.vertexColors}\n`;
        out += `Transparent: ${mat.transparent}\n`;
        out += `Opacity: ${mat.opacity}\n`;
        out += `DepthTest: ${mat.depthTest}\n`;
        out += `DepthWrite: ${mat.depthWrite}\n`;
        
        console.log(out);
        return "Check console for output!";
    };

    // setTimeout(() => { if(window.diagnoseGridMesh) window.diagnoseGridMesh(); }, 2000);

    window.addEventListener('resize', this.onCanvasResize.bind(this));

    window.setAspect = (aspect) => {
      window._forcedAspect = aspect;
      this.onCanvasResize();
      console.log(`Forced Aspect to ${aspect}`);
    };

    window.setScaleX = (scaleX) => {
      if (this._camera && this._camera.getThreeCamera()) {
        const camera = this._camera;
        const threeCam = camera.getThreeCamera();
        
        // Directly modify the X scale in the projection matrix
        threeCam.projectionMatrix.elements[0] = (1.0 / Math.tan((threeCam.fov * Math.PI / 180.0) / 2.0)) / threeCam.aspect * scaleX;
        threeCam.projectionMatrixInverse.copy(threeCam.projectionMatrix).invert();
        
        // Also update custom projection matrix
        const proj = camera.getProjection();
        proj[0] = (1.0 / Math.tan((camera.getFov() * Math.PI / 180.0) / 2.0)) / threeCam.aspect * scaleX;
        
        console.log(`Forced ScaleX to ${scaleX}`);
        this.render();
      }
    };
  }

  /** Load textures (preload) */
  loadTextures() {
    var self = this;
    var gl = this._gl;
    var ShaderMatcap = ShaderLib[Enums.Shader.MATCAP];

    var loadTex = function (path, idMaterial) {
      new THREE.TextureLoader().load(path, function(tex) {
        ShaderMatcap.textures[idMaterial] = tex;
        self.render();
      });
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
    
    // Force viewport to fill the area excluding top bar and sidebar
    viewport.style.position = 'absolute';
    viewport.style.top = '40px';
    viewport.style.bottom = '0px';
    viewport.style.left = '0px';
    viewport.style.right = '380px';

    var newWidth = viewport.clientWidth * this._pixelRatio;
    var newHeight = viewport.clientHeight * this._pixelRatio;



    var aspect = window._forcedAspect || (viewport.clientWidth / viewport.clientHeight);
    
    if (this._camera && this._camera.getThreeCamera()) {
      const threeCam = this._camera.getThreeCamera();
      
      threeCam.aspect = aspect;
      
      if (window._forcedAspect) {
        // If aspect is forced, use a fixed base FOV to avoid compounding effects
        const baseFov = 45;
        this._camera.setFov(baseFov);
        threeCam.fov = baseFov;
      } else {
        // Calculate adjusted FOV to maintain constant horizontal FOV
        const baseFov = 45;
        const adjFov = 2 * Math.atan(Math.tan(baseFov * Math.PI / 360.0) / aspect) * 360.0 / Math.PI;
        
        // Update custom camera FOV (which updates its projection matrix)
        this._camera.setFov(adjFov);
        threeCam.fov = adjFov;
      }
      
      threeCam.updateProjectionMatrix();
      

    }

    this._canvasOffsetLeft = viewport.offsetLeft;
    this._canvasOffsetTop = viewport.offsetTop;
    this._canvasWidth = newWidth;
    this._canvasHeight = newHeight;

    this._canvas.width = newWidth;
    this._canvas.height = newHeight;

    // Force CSS size to match client size (prevent stretching)
    this._canvas.style.width = viewport.clientWidth + 'px';
    this._canvas.style.height = viewport.clientHeight + 'px';

    if (this._renderer) {
      this._renderer.setSize(viewport.clientWidth, viewport.clientHeight, false);
    }

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
    var rad = 0.5 * Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (isNaN(rad)) {
        console.error("🛑 computeRadiusFromBoundingBox produced NaN! Box:", box);
        if (window.screenLog) window.screenLog("NaN Radius From BB", "red");
    }
    return rad;
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
    
    // DEBUG: NaN Bounding Box Detector
    for(var j=0; j<6; j++) {
       if(isNaN(bound[j])) {
           console.error("🛑 computeBoundingBoxMeshes produced NaN array! Meshes count:", meshes.length);
           console.error("- Corrupted Bounds:", bound);
           if (window.screenLog) window.screenLog("NaN BoundingBoxMeshes", "red");
           break;
       }
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
    
    // If the scene has no valid bounding box (e.g. all empty meshes), prevent NaN scale
    var scale = 1.0;
    var tx = 0.0, ty = 0.0, tz = 0.0;
    if (Number.isFinite(box[0]) && Number.isFinite(box[3])) {
        scale = Utils.SCALE / vec3.dist([box[0], box[1], box[2]], [box[3], box[4], box[5]]);
        if(isNaN(scale) || scale === Infinity || scale === 0) scale = 1.0;
        
        tx = -(box[0] + box[3]) * 0.5;
        ty = -(box[1] + box[4]) * 0.5;
        tz = -(box[2] + box[5]) * 0.5;
    }

    var mCen = mat4.create();
    mat4.scale(mCen, mCen, [scale, scale, scale]);
    mat4.translate(mCen, mCen, [tx, ty, tz]);

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

    // Default to MATCAP with Pearl (or from settings)
    const opts = getOptionsURL();
    mesh.setShaderType(Enums.Shader.MATCAP);
    mesh.setMatcap(opts.matcap);

    mesh._typeName = "Sphere";
    mesh.isQuad = true; // Sphere is quads (subdivided cube)
    this.addNewMesh(mesh);
    return mesh;
  }

  addGrid3x3() {
    var mesh = new Multimesh(Primitives.createPlaneGrid(this._gl, 3, 3));
    mesh.normalizeSize();
    mat4.scale(mesh.getMatrix(), mesh.getMatrix(), [0.7, 0.7, 0.7]);
    mesh._typeName = "Grid3x3";
    mesh.isQuad = true; 
    return this.addNewMesh(mesh);
  }

  addGrid() {
    var mesh = new Multimesh(Primitives.createPlaneGrid(this._gl, 4, 4));
    mesh.normalizeSize();
    mat4.scale(mesh.getMatrix(), mesh.getMatrix(), [0.7, 0.7, 0.7]);
    mesh._typeName = "Grid4x4";
    mesh.isQuad = true; 
    return this.addNewMesh(mesh);
  }

  addCube() {
    var mesh = new Multimesh(Primitives.createCube(this._gl));
    mesh.normalizeSize();
    mat4.scale(mesh.getMatrix(), mesh.getMatrix(), [0.7, 0.7, 0.7]);
    this.subdivideClamp(mesh, true);
    mesh._typeName = "Cube";
    mesh.isQuad = true; // Cube is quads
    return this.addNewMesh(mesh);
  }

  addVoxelObject() {
    this.getSculptManager().setToolIndex(Enums.Tools.VOXEL);
    const voxelTool = this.getSculptManager().getTool(Enums.Tools.VOXEL);
    
    if (voxelTool) {
      if (!voxelTool._voxelMesh) {
        const newMesh = new MeshStatic(this._gl);
        newMesh._isVoxel = true;
        newMesh.setID(MeshStatic.ID++);
        newMesh._typeName = "Voxel";
        newMesh.isQuad = true;
        
        newMesh.allocateArrays();
        newMesh.initThreeMesh();
        
        voxelTool._voxelMesh = newMesh;
        this.addNewMesh(newMesh);
      }
      
      if (voxelTool._worker) {
        voxelTool._worker.postMessage({ type: 'CLEAR' });
      }
    }
    
    window._activeToolTab = 2;
    if (this._guiXR) {
      this._guiXR.refreshToolsWidget();
      this._guiXR._needsRedraw = true;
    }
    if (this._guiMini) {
      this._guiMini.refreshToolsWidget();
      this._guiMini._needsRedraw = true;
    }
    
    return voxelTool ? voxelTool._voxelMesh : null;
  }

  addCylinder() {
    var mesh = new Multimesh(Primitives.createCylinder(this._gl));
    mesh.normalizeSize();
    mat4.scale(mesh.getMatrix(), mesh.getMatrix(), [0.7, 0.7, 0.7]);
    this.subdivideClamp(mesh);
    mesh._typeName = "Cylinder";
    return this.addNewMesh(mesh);
  }

  addTorus(preview) {
    var mesh = new Multimesh(Primitives.createTorus(this._gl, this._torusLength, this._torusWidth, this._torusRadius, this._torusRadial, this._torusTubular));
    mesh._typeName = "Torus";
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
    if (!mesh._permanentStaticLabel) {
      mesh._permanentStaticLabel = (mesh._typeName || "Mesh") + " " + this._meshes.length;
    }
    if (this._worldGroup && mesh.getThreeMesh()) {
      this._worldGroup.add(mesh.getThreeMesh());
    }
    this._stateManager.pushStateAdd(mesh);
    this.setMesh(mesh);

    if (this._guiXR && this._guiXR.refreshSceneWidget) {
      this._guiXR.refreshSceneWidget();
    }

    return mesh;
  }

  mergeSelection() {
    var selMeshes = this.getSelectedMeshes().slice();
    if (selMeshes.length < 2) return;

    var baseMesh = this.getMesh() || selMeshes[0];
    var newMesh = Remesh.mergeMeshes(selMeshes, baseMesh);

    this.removeMeshes(selMeshes);

    this._meshes.push(newMesh);
    if (this._worldGroup && newMesh.getThreeMesh()) {
      this._worldGroup.add(newMesh.getThreeMesh());
    }

    this._stateManager.pushStateAddRemove(newMesh, selMeshes);
    this.setMesh(newMesh);

    if (this._guiXR && this._guiXR.refreshSceneWidget) {
      this._guiXR.refreshSceneWidget();
    }

    return newMesh;
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
      var innerMesh = newMeshes[i];
      
      // Fix: If the importer already returned a fully built Multimesh (like SXR format), do NOT wrap it again!
      var mesh;
      if (innerMesh && innerMesh._meshes) {
          mesh = newMeshes[i] = innerMesh;
      } else {
          mesh = newMeshes[i] = new Multimesh(innerMesh);
      }

      if (innerMesh._permanentStaticLabel) {
        mesh._permanentStaticLabel = innerMesh._permanentStaticLabel;
      }
      if (innerMesh._permanentStaticId) {
        mesh._permanentStaticId = innerMesh._permanentStaticId;
      }

      if (!this._vertexSRGB && mesh.getColors()) {
        Utils.convertArrayVec3toSRGB(mesh.getColors());
      }

      mesh.init();
      mesh.initRender();
      meshes.push(mesh);
      
      var actualThreeMesh = mesh.getThreeMesh();
      if (!actualThreeMesh && mesh.getCurrentMesh) {
          var innerMeshLevel = mesh.getCurrentMesh();
          if (innerMeshLevel && innerMeshLevel.getRenderData) {
              actualThreeMesh = innerMeshLevel.getRenderData()._threeMesh;
          }
      }
      
      if (this._worldGroup && actualThreeMesh) {
        this._worldGroup.add(actualThreeMesh);
        console.log("[SXR Scene Debug] Added loaded mesh to Three.js world group.");
      }
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
    
    // Remove all Three.js meshes from the scene
    for (var i = 0; i < this._meshes.length; ++i) {
      if (this._worldGroup && this._meshes[i].getThreeMesh()) {
        this._worldGroup.remove(this._meshes[i].getThreeMesh());
      }
    }
    
    this.getMeshes().length = 0;
    this.getCamera().resetView();
    this.setMesh(null);
    this._action = Enums.Action.NOTHING;

    if (this._guiXR && this._guiXR.refreshSceneWidget) {
      this._guiXR.refreshSceneWidget();
    }
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
      if (idx >= 0) {
        var target = this._worldGroup || this._scene;
        if (target && meshes[idx].getThreeMesh()) {
          target.remove(meshes[idx].getThreeMesh());
        }
        meshes.splice(idx, 1);
      }
    }

    if (this._meshes.length === 1) {
      this.setMesh(this._meshes[0]);
    }

    if (this._guiXR && this._guiXR.refreshSceneWidget) {
      this._guiXR.refreshSceneWidget();
    }
  }

  getIndexMesh(mesh, select) {
    var meshes = select ? this._selectMeshes : this._meshes;
    
    // 1. Strict object reference match first (safest)
    for (var i = 0, nbMeshes = meshes.length; i < nbMeshes; ++i) {
      if (meshes[i] === mesh) return i;
    }
    
    // 2. Fallback to ID match only if reference check failed
    var id = mesh.getID();
    for (var i = 0, nbMeshes = meshes.length; i < nbMeshes; ++i) {
      if (meshes[i].getID() === id) return i;
    }
    
    return -1;
  }

  getIndexSelectMesh(mesh) {
    return this.getIndexMesh(mesh, true);
  }

  replaceMesh(mesh, newMesh) {
    var index = this.getIndexMesh(mesh);
    if (index >= 0) this._meshes[index] = newMesh;
    
    var selIndex = this.getIndexSelectMesh(mesh);
    if (selIndex >= 0) this._selectMeshes[selIndex] = newMesh;

    if (this._mesh === mesh) this.setMesh(newMesh);

    if (this._worldGroup && newMesh.getThreeMesh()) {
      if (mesh.getThreeMesh()) {
        this._worldGroup.remove(mesh.getThreeMesh());
      }
      this._worldGroup.add(newMesh.getThreeMesh());
    }
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
  async enterXR(session) {
    window._lastLogTime = performance.now();
    // console.log("[Telemetry] WebXR Session entered");
    window._xrSessionStartT = performance.now();
    if (window.screenLog) window.screenLog("[XR] Session Start Triggered", "green");
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

    // Enable Three.js WebXR. setReferenceSpaceType must be called before setSession.
    this._renderer.xr.enabled = true;
    this._renderer.xr.setReferenceSpaceType('local-floor');

    this._renderer.resetState();

    // Call setSession as early as possible — the XR compositor starts its timeout
    // the moment requestSession resolves. Every ms before setSession is called is
    // time the compositor spends showing the default gray void environment.
    const t0 = performance.now();
    await this._renderer.xr.setSession(session);
    const t1 = performance.now();
    if (window.screenLog) window.screenLog(`[XR] setSession Resolved (+${Math.round(t1 - window._xrSessionStartT)}ms total, setSession took ${Math.round(t1-t0)}ms)`, "lime");

    // Reset per-session telemetry flags.
    window._firstXRFrameLogged = false;
    window._firstXRInputHandled = false;
    window._xrFrameCount = 0;

    // Force the render flag so the very next animation loop tick draws immediately.
    this._drawFullScene = true;
    this.render();

    // initVRControllers() was already called at startup (in start()), so all GPU
    // resources are pre-warmed.  Only set the flag if somehow init was skipped.
    if (!this._controllersInitialized) {
      this._vrControllersNeedInit = true;
    }

    // Try to get the reference space for our own internal tracking (like UI offsets)
    session.requestReferenceSpace('local-floor').then((refSpace) => {
      this._baseRefSpace = refSpace;
      this.updateVROffsets();
    }).catch(e => {
      console.warn("Failed to get local-floor for internal offset tracking", e);
      if (window.screenLog) window.screenLog("Failed RefSpace: " + e.message, "red");
    });
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

    // SYNC THREE.JS GRAPH TO MATH OFFSETS
    // This ensures the visual rendering of the WebGL mesh via Three.js
    // perfectly matches the mathematical offsets expected by SculptGL tools.
    if (this._worldGroup && this._xrWorldOffset) {
      const p = this._xrWorldOffset.position;
      const q = this._xrWorldOffset.orientation;
      this._worldGroup.position.set(p.x, p.y, p.z);
      this._worldGroup.quaternion.set(q.x, q.y, q.z, q.w);
      if (this._vrScale) {
        this._worldGroup.scale.set(this._vrScale, this._vrScale, this._vrScale);
      }
    }

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

    // Auto-restart: re-enter immersive mode when the XR device grants a session back
    // to this page (e.g. user puts headset back on after removing it).
    // 'sessiongranted' is the correct event for this — it fires when the XR runtime
    // decides this page should become the active XR app again, without requiring a
    // new user gesture. visibilitychange does NOT fire on GalaxyXR for headset removal.
    if (this._currentXRMode && navigator.xr) {
      const modeToRestore = this._currentXRMode;
      if (this._vrAutoRestartListener) {
        navigator.xr.removeEventListener('sessiongranted', this._vrAutoRestartListener);
      }
      this._vrAutoRestartListener = () => {
        navigator.xr.removeEventListener('sessiongranted', this._vrAutoRestartListener);
        this._vrAutoRestartListener = null;
        if (!this._xrSession) this.startXRSession(modeToRestore);
      };
      navigator.xr.addEventListener('sessiongranted', this._vrAutoRestartListener);
    }

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

    // this._vrControllerLeft = null;
    // this._vrControllerRight = null;
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
    // console.log("VR Exit: Desktop camera & UI sync fully restored");

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
    // Intercept fetch to debug controller asset loads
    if (!window._fetchIntercepted) {
      window._fetchIntercepted = true;
      const nativeFetch = window.fetch;
      window.fetch = function (...args) {
        const url = args[0];
        if (typeof url === 'string' && (url.includes('webxr-input-profiles') || url.endsWith('.glb') || url.endsWith('.gltf') || url.includes('/profiles/'))) {
          return new Promise((resolve, reject) => {
            if (window.caches) {
              window.caches.open('sculptxr-controller-assets').then(cache => {
                cache.match(url).then(cachedResponse => {
                  if (cachedResponse) {
                    // console.log(`[Cache API] Resolved from cache: ${url}`);
                    resolve(cachedResponse);
                    return;
                  }
                  
                  const timeoutId = setTimeout(() => {
                    reject(new Error("Fetch timeout for " + url));
                  }, 1500);

                  nativeFetch.apply(this, args).then(res => {
                    clearTimeout(timeoutId);
                    if (res.ok) {
                      cache.put(url, res.clone());
                    }
                    resolve(res);
                  }).catch(err => {
                    clearTimeout(timeoutId);
                    reject(err);
                  });
                }).catch(() => {
                  // Cache match failed
                  nativeFetch.apply(this, args).then(resolve).catch(reject);
                });
              }).catch(() => {
                // Cache open failed
                nativeFetch.apply(this, args).then(resolve).catch(reject);
              });
            } else {
              const timeoutId = setTimeout(() => {
                reject(new Error("Fetch timeout for " + url));
              }, 1500);

              nativeFetch.apply(this, args).then(res => {
                clearTimeout(timeoutId);
                resolve(res);
              }).catch(err => {
                clearTimeout(timeoutId);
                reject(err);
              });
            }
          });
        }
        return nativeFetch.apply(this, args);
      };
    }

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
    // Init VR Menu System (Global)
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

    // Init VR Popup System
    if (!this._guiPopup) {
      this._guiPopup = new GuiXR(this, null, 660, 660);
      this._guiPopup._isPopupHUD = true;
      this._guiPopup._isVisible = true;
    }
    this._guiPopup.init(this._gl);
    if (!this._vrPopup) {
      this._vrPopup = new VRMenu(this._gl, this._guiPopup);
      this._vrPopup.setOffset(0, 0, 0);
      this._vrPopup.setRotation(0, 0, 0);
    }


      // if (window.screenLog) window.screenLog(`[XR] initVRControllers check: Initialized=${!!this._controllersInitialized}`, "cyan");
      if (!this._controllersInitialized) {
        this._controllersInitialized = true;
        // if (window.screenLog) window.screenLog("[XR] Creating Dynamic Controller Groups", "cyan");
        if (this._renderer && this._scene) {

          this._vrControllerLeft = null;
          this._vrControllerRight = null;
          this._vrControllerLeftGrip = null;
          this._vrControllerRightGrip = null;

          const controllerModelFactory = new XRControllerModelFactory();
          this._controllerModelFactory = controllerModelFactory;

          for (let i = 0; i < 2; i++) {
            const controller = this._renderer.xr.getController(i);
            this._scene.add(controller);

            const grip = this._renderer.xr.getControllerGrip(i);

              // Intercept addEventListener to force custom profiles for the 3D models before Factory sees it
              const originalAddEventListener = grip.addEventListener;
              grip.addEventListener = function(type, listener) {
                  if (type === 'connected') {
                      const wrappedListener = function(event) {
                          grip._originalInputSource = event.data; // SAVE ORIGINAL INPUT SOURCE
                          
                          // Hide if it's hands (creepy hands)
                          const baseSource = event.data;
                          // console.log(`[WebXR] Connected inputSource: ${baseSource ? Object.keys(baseSource).join(", ") : "null"}, isHand=${baseSource && baseSource.hand ? "YES" : "NO"}`);
                          
                          if (baseSource && baseSource.hand) {
                              model.visible = false;
                          } else {
                              model.visible = true;
                          }

                          const override = window._xrControllerOverride;
                        
                         if (override && override !== 'Auto' && event.data) {
                             try {
                                const proxySource = new Proxy(baseSource, {
                                    get: function(target, prop) {
                                        if (prop === 'profiles') {
                                            // console.log(`[SculptGL] Proxy: Overriding profiles to [${override}]`);
                                            // if (window.screenLog) window.screenLog(`[Proxy] Overriding to [${override}]`, "orange");
                                            return [override];
                                        }
                                        const value = target[prop];
                                        return typeof value === 'function' ? value.bind(target) : value;
                                    }
                                });
                                grip._inputSource = proxySource;
                                const proxyEvent = Object.create(event);
                                Object.defineProperty(proxyEvent, 'data', { value: proxySource });
                                listener.call(this, proxyEvent);
                            } catch (e) {
                                grip._inputSource = baseSource;
                                listener.call(this, event);
                            }
                        } else {
                            grip._inputSource = baseSource;
                            listener.call(this, event);
                        }
                    };
                    originalAddEventListener.call(this, type, wrappedListener);
                } else {
                    originalAddEventListener.call(this, type, listener);
                }
            };

            let model = null;
            try {
                model = controllerModelFactory.createControllerModel(grip);
            } catch(e) {
                console.warn("Failed to create controller model", e);
            }
            if (model) grip.add(model);
            this._scene.add(grip);

            // Controller ray lines (attached to Target Ray Space)
            const lineGeometry = new THREE.CylinderGeometry(0.0015, 0.0015, 1.0, 8);
            lineGeometry.rotateX(-Math.PI / 2);
            lineGeometry.translate(0, 0, -0.5);
            const lineMaterial = new THREE.MeshBasicMaterial({ 
                color: 0xff0000, transparent: true, opacity: 0.8, depthTest: true, blending: THREE.NormalBlending 
            });
            const rayRoot = new THREE.Group();
            rayRoot.name = 'pointer_ray_root';
            rayRoot.add(new THREE.Mesh(lineGeometry, lineMaterial));
            controller.add(rayRoot);

            // Controller Stylus Spike
            const spikeGeo = new THREE.CylinderGeometry(0, 0.005, 0.10, 16);
            spikeGeo.rotateX(-Math.PI / 2);
            spikeGeo.translate(0, 0, -0.05); // Base at 0, Tip at -0.10
            
            const spikeMat = new THREE.MeshBasicMaterial({ color: 0x4d4d4d });
            const spikeMesh = new THREE.Mesh(spikeGeo, spikeMat);
            spikeMesh.name = 'stylus_spike';
            controller.add(spikeMesh);

            // Apply loaded settings immediately on creation
            const defLength = this.getStylusLength();
            const defOffset = this.getStylusOffset();
            const defTilt = this.getStylusTilt();
            // console.log(`[Scene] Applying defaults to spikeMesh: Length=${defLength}, Offset=${defOffset}, Tilt=${defTilt}`);
            const scaleFactor = defLength / 0.10;
            spikeMesh.scale.set(1, 1, scaleFactor);
            spikeMesh.position.z = -defOffset;
            spikeMesh.rotation.x = defTilt * Math.PI / 180.0;
            rayRoot.rotation.x = defTilt * Math.PI / 180.0;

            // Keep the 'connected' listener purely for diagnostic logging, 
            // AND robust static mapping!
            controller.addEventListener('connected', (event) => {
                if (event.data && event.data.handedness) {
                    const hand = event.data.handedness;
                    const profiles = event.data.profiles ? event.data.profiles.join(', ') : 'none';
                    // if (window.screenLog) window.screenLog(`[XR] ${hand} profiles: [${profiles}]`, "cyan");

                    if (hand === 'left') {
                        this._vrControllerLeft = controller;
                        this._vrControllerLeftGrip = this._renderer.xr.getControllerGrip(i);
                    } else if (hand === 'right') {
                        this._vrControllerRight = controller;
                        this._vrControllerRightGrip = this._renderer.xr.getControllerGrip(i);
                    }
                }
            });

            controller.addEventListener('disconnected', (event) => {
                const hand = event.data?.handedness;
                // console.log(`[SculptGL] Controller [${i}] Disconnected (${hand})`);
                // if (window.screenLog) window.screenLog(`[XR] Controller [${i}] Disconnected (${hand})`, "red");

                if (hand === 'left' && this._vrControllerLeft === controller) {
                    this._vrControllerLeft = null;
                    this._vrControllerLeftGrip = null;
                } else if (hand === 'right' && this._vrControllerRight === controller) {
                    this._vrControllerRight = null;
                    this._vrControllerRightGrip = null;
                }
            });
          }

          // Tool Cursors (Ring + Dot attached to World Space / Scene)
          const createVRCursor = () => {
            const group = new THREE.Group();
            
            // 1. Center Dot (Volume Sphere Indicator)
            const sphereGeo = new THREE.SphereGeometry(1.0, 32, 32); 
            const fresnelVertexShader = `
                varying vec3 vNormal;
                varying vec3 vPositionNormal;
                void main() {
                    vNormal = normalize(normalMatrix * normal);
                    vPositionNormal = normalize((modelViewMatrix * vec4(position, 1.0)).xyz);
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `;

            const fresnelFragmentShader = `
                uniform vec3 color;
                varying vec3 vNormal;
                varying vec3 vPositionNormal;
                void main() {
                    float dotProduct = dot(vNormal, vPositionNormal);
                    float fresnel = 1.0 - abs(dotProduct);
                    fresnel = pow(fresnel, 3.0);
                    gl_FragColor = vec4(color * fresnel, fresnel);
                }
            `;

            const volMat = new THREE.ShaderMaterial({
                uniforms: { color: { value: new THREE.Color(0x4488ff) } },
                vertexShader: fresnelVertexShader,
                fragmentShader: fresnelFragmentShader,
                transparent: true, depthTest: true, depthWrite: false, side: THREE.DoubleSide,
                blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
                blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor
            });
            const volumeSphere = new THREE.Mesh(sphereGeo, volMat);
            volumeSphere.name = "volume_sphere";
            group.add(volumeSphere);

            // 1b. Volume Cube Indicator (For Voxel Box tools)
            const cubeGeo = new THREE.BoxGeometry(2.0, 2.0, 2.0);
            const volumeCube = new THREE.Mesh(cubeGeo, volMat);
            volumeCube.name = "volume_cube";
            volumeCube.visible = false;
            group.add(volumeCube);

            // 2. Outer Ring (Surface Cursor) - Split into Top/Bottom arcs for color comparison
            const pointsTop = [];
            const pointsBottomLeft = [];
            const pointsBottomRight = [];
            const segments = 32;
            const qSegs = segments / 2;

            for (let i = 0; i <= segments; i++) {
                const thetaTop = (i / segments) * Math.PI; // 0 to PI
                pointsTop.push(new THREE.Vector3(Math.cos(thetaTop), Math.sin(thetaTop), 0));

                if (i <= qSegs) {
                    const thetaBL = Math.PI + (i / qSegs) * (Math.PI / 2); // PI to 1.5PI
                    pointsBottomLeft.push(new THREE.Vector3(Math.cos(thetaBL), Math.sin(thetaBL), 0));

                    const thetaBR = 1.5 * Math.PI + (i / qSegs) * (Math.PI / 2); // 1.5PI to 2PI
                    pointsBottomRight.push(new THREE.Vector3(Math.cos(thetaBR), Math.sin(thetaBR), 0));
                }
            }

            const geoTop = new THREE.BufferGeometry().setFromPoints(pointsTop);
            const geoBottomLeft = new THREE.BufferGeometry().setFromPoints(pointsBottomLeft);
            const geoBottomRight = new THREE.BufferGeometry().setFromPoints(pointsBottomRight);

            const matTop = new THREE.LineBasicMaterial({ color: 0x4488ff, depthTest: false, transparent: true, opacity: 0.8, linewidth: 2 });
            const matBottomLeft = new THREE.LineBasicMaterial({ color: 0x4488ff, depthTest: false, transparent: true, opacity: 0.8, linewidth: 2 });
            const matBottomRight = new THREE.LineBasicMaterial({ color: 0x4488ff, depthTest: false, transparent: true, opacity: 0.8, linewidth: 2 });

            const lineTop = new THREE.Line(geoTop, matTop);
            lineTop.name = "top";
            const lineBottomLeft = new THREE.Line(geoBottomLeft, matBottomLeft);
            lineBottomLeft.name = "bottom_left";
            const lineBottomRight = new THREE.Line(geoBottomRight, matBottomRight);
            lineBottomRight.name = "bottom_right";

            const ringLine = new THREE.Group();
            ringLine.name = "cursor_ring";
            ringLine.add(lineTop);
            ringLine.add(lineBottomLeft);
            ringLine.add(lineBottomRight);
            group.add(ringLine);

            const dotGeo = new THREE.BufferGeometry();
            dotGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3));
            const dotMat = new THREE.PointsMaterial({ color: 0x4488ff, size: 2, sizeAttenuation: false, depthTest: false, transparent: true, opacity: 0.8 });
            const centerDot = new THREE.Points(dotGeo, dotMat);
            centerDot.name = "cursor_dot";
            ringLine.add(centerDot);

            group.visible = false;
            return group;
          };

          this._vrCursorLeft = createVRCursor();
          this._vrCursorRight = createVRCursor();
          this._scene.add(this._vrCursorLeft);
          this._scene.add(this._vrCursorRight);
        }
      }


    // (Legacy static connection listener removed; handled generically in dynamic array loop)

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

    if (!this._vrBrushRadiusCube) {
      // Create a Cube with radius 1.0
      var meshCube = Primitives.createCube(this._gl, 1.0);

      meshCube.setShaderType(Enums.Shader.FRESNEL);
      meshCube.setFlatColor([0.5, 0.5, 0.5]);
      meshCube.setOpacity(1.0);
      meshCube.init();
      meshCube.initRender();
      this._vrBrushRadiusCube = meshCube;
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
          // console.log("[SculptGL] PLY Response received for " + handedness + ". Header preview: " + headerPreview);

          var meshes = Import.importPLY(xhr.response, this._gl);
          // console.log("[SculptGL] PLY Parsed meshes for " + handedness + ": " + (meshes ? meshes.length : 0));

          if (meshes && meshes.length > 0) {
            if (meshes[0].getNbVertices() > 0) {
              var mesh = meshes[0];

              mesh.init(); 

              mesh.setShaderType(Enums.Shader.PBR);
              mesh.setAlbedo([0.5, 0.5, 0.5]); 
              mesh.setRoughness(0.8); 
              mesh.setMetallic(0.0);  

              mesh.initRender();
              mesh.isPlaceholder = false;

              // Replace Reference
              if (handedness === 'left') {
                this._vrControllerLeftMesh = mesh;
                window.debugLeftControllerMesh = mesh;
                // console.log("[SculptGL] _vrControllerLeftMesh assigned!");
              } else {
                this._vrControllerRightMesh = mesh;
                window.debugRightControllerMesh = mesh;
                // console.log("[SculptGL] _vrControllerRightMesh assigned!");
              }

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

  // (Legacy onXRFrame loop removed in Three.js WebXR Migration)

  handleXRInput(frame, refSpace) {
    try {

    // Dynamic Material Override for Virtual Desktop (One-way)
    const forceGrey = !!window._forceGreyControllers;
    if (forceGrey) {
      [this._vrControllerLeftGrip, this._vrControllerRightGrip].forEach(grip => {
        if (!grip) return;
        grip.traverse((child) => {
          if (child.isMesh && child.material && !child.userData.isGreyOverridden) {
            const isArray = Array.isArray(child.material);
            const mats = isArray ? child.material : [child.material];
            
            // Create a completely new grey material list to avoid mutating shared GLTF materials
            const greyMats = mats.map(m => {
              const grey = new THREE.MeshStandardMaterial({ 
                color: 0x888888, 
                roughness: 0.5,
                depthWrite: true,
                depthTest: true
              });
              return grey;
            });

            child.material = isArray ? greyMats : greyMats[0];
            child.userData.isGreyOverridden = true;
          }
        });
      });
    }



    // 1. Synchronize UI Mesh Visibility with Application State
    if (this._vrMenu && this._guiXR) {
        this._vrMenu.mesh.visible = !!this._guiXR._isVisible;
    }
    if (this._vrPopup && this._guiPopup) {
        this._vrPopup.mesh.visible = !!this._guiPopup._isVisible && !!this._guiPopup._overlay;
    }
    if (this._vrMiniHUD && this._guiMini) {
        // Hide MiniHUD if Main Menu or Popup is visible to prevent physical overlap
        const isMainMenuVisible = this._guiXR && this._guiXR._isVisible;
        const isPopupVisible = this._guiPopup && this._guiPopup._isVisible && this._guiPopup._overlay;
        this._vrMiniHUD.mesh.visible = !!this._guiMini._isVisible && !isMainMenuVisible && !isPopupVisible;
    }

    this._isPointingAtMenu = false;

    const session = frame.session;
    const sources = session.inputSources;
    window._vrInputSources = sources;

    // Tick Diagnostic Log
    if (!this._tickLog) this._tickLog = 0;
    this._tickLog++;
    if (this._tickLog % 270 === 0) {
        if (!sources || sources.length === 0) {
            console.log(`[XR TICK] Missing! SrcLen: 0`);
            // if (window.screenLog) window.screenLog(`[XR TICK] Missing! SrcLen: 0`, "orange");
        }
    }

    // --- DOMINANT HAND UI MOUNT LOGIC ---
    // UI is dynamically mounted to the Non-Dominant hand GRIP. 
    // We use the static references cached during the 'connected' events.
    if (sources && sources.length > 0) {
        let uiGrip = null;
        if (this._dominantHand === 'right' && this._vrControllerLeftGrip) {
            uiGrip = this._vrControllerLeftGrip;
        } else if (this._dominantHand === 'left' && this._vrControllerRightGrip) {
            uiGrip = this._vrControllerRightGrip;
        }

        if (uiGrip) {
            if (this._vrMenu && this._vrMenu.mesh.parent !== uiGrip) uiGrip.add(this._vrMenu.mesh);
            if (this._vrMiniHUD && this._vrMiniHUD.mesh.parent !== uiGrip) uiGrip.add(this._vrMiniHUD.mesh);
            if (this._vrPopup && this._vrPopup.mesh.parent !== uiGrip) uiGrip.add(this._vrPopup.mesh);
        } else {
            if (this._vrMenu && this._vrMenu.mesh.parent) this._vrMenu.mesh.removeFromParent();
            if (this._vrMiniHUD && this._vrMiniHUD.mesh.parent) this._vrMiniHUD.mesh.removeFromParent();
            if (this._vrPopup && this._vrPopup.mesh.parent) this._vrPopup.mesh.removeFromParent();
        }
    } else {
        // Fallback or wiped state
        this._vrControllerLeft = null;
        this._vrControllerLeftGrip = null;
        this._vrControllerRight = null;
        this._vrControllerRightGrip = null;
    }

    let leftGrip = false, rightGrip = false;
    let leftOrigin = null, rightOrigin = null;
    let leftRot = null, rightRot = null;

    // Smart Source Selection: Prioritize Trigger Press
    // Loop manually to be safe on all browsers
    let right = null;
    let left = null;
    for (const s of sources) {
      if (s.handedness === 'right') right = s;
      if (s.handedness === 'left') left = s;
    }

    const nonDomSource = this._dominantHand === 'left' ? right : left;
    this._vrSecondaryTriggerPressed = !!(nonDomSource && nonDomSource.gamepad && nonDomSource.gamepad.buttons[0] && nonDomSource.gamepad.buttons[0].pressed);

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
      if (this._logThrottle % 60 === 0) {
        // console.log(`[XR Tracking] Src: ${source.handedness} Profile: ${source.profiles[0]} Grip:${!!source.gripSpace} Ray:${!!source.targetRaySpace}`);
      }




      if (!source.gripSpace) continue;

      // VR Fuzzer Overrides
      // (Fuzzer has been suspended during migration since it relied on manual pose injection)


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
                   const gNow = performance.now();
                   if (gNow - (this._lastGlobalUndoRedoTime || 0) > 50) {
                     this._lastGlobalUndoRedoTime = gNow;
                     if (this._stateManager) {
                       const activeTool = this._sculptManager.getCurrentTool();
                       if (activeTool && activeTool.onUndo && activeTool.onUndo()) {
                         this._main ? this._main.render() : this.render();
                       } else {
                         this._stateManager.undo();
                         this._main ? this._main.render() : this.render();
                       }
                     }
                   }
                 } else if (valX > T_PRESS) {
                   const gNow = performance.now();
                   if (gNow - (this._lastGlobalUndoRedoTime || 0) > 50) {
                     this._lastGlobalUndoRedoTime = gNow;
                     console.log("[Scene] Thumbstick Redo detected!");
                     if (this._stateManager) {
                       const activeTool = this._sculptManager.getCurrentTool();
                       if (activeTool && activeTool.onRedo && activeTool.onRedo()) {
                         this._main ? this._main.render() : this.render();
                       } else {
                         this._stateManager.redo();
                         this._main ? this._main.render() : this.render();
                       }
                     }
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
                if (this._stateManager) {
                  this._stateManager.redo();
                  this._main ? this._main.render() : this.render();
                }
                state.lastRedoTime = now;
              }
            }
            state.btnY = isPressedY;
          */
          // THUMBSTICK SCROLLING WHEN POINTING AT MENU
          const valY_NonDom = axes[3];
          if ((this._isPointingAtMenu || this._wasPointingAtMenu) && Math.abs(valY_NonDom) > T_PRESS && this._guiXR) {
            const domSource = this._dominantHand === 'left' ? left : right;
            const isScrollTriggerPressed = domSource && domSource.gamepad && domSource.gamepad.buttons[0] && domSource.gamepad.buttons[0].pressed;
            const scrollSpeed = isScrollTriggerPressed ? 4 : 24; // Default 24, slow-mo 4

            this._guiXR._scrollOffset += (valY_NonDom > 0 ? 1 : -1) * scrollSpeed;
            this._guiXR._scrollOffset = Math.max(0, Math.min(this._guiXR._scrollOffset, this._guiXR._maxScroll || 0));
            this._guiXR._needsRedraw = true;
          }
        }

        // DOMINANT HAND: AXIS 3 (Up/Down) - Radius +/- 5%, AXIS 2 (Left/Right) - Intensity +/- 5%
        if (isDom) {
          const valY = axes[3];
          const valX = axes[2];
          const isPressedY = Math.abs(valY) > T_PRESS;
          const isPressedX = Math.abs(valX) > T_PRESS;

          // Check Secondary Hand Trigger for slow-modifier
          const nonDomSource = this._dominantHand === 'left' ? right : left;
          const isSecondaryTriggerPressed = this._vrSecondaryTriggerPressed;
          const speedModifier = isSecondaryTriggerPressed ? 0.1 : 1.0;

          // Timer for Repeat/Debounce
          const now = performance.now();
          // Dynamic target rate: 30ms normally, 15ms (10x precision visually via speedModifier 0.1) when holding trigger
          const targetRateY = isSecondaryTriggerPressed ? 15 : 30;

          if ((this._isPointingAtMenu || this._wasPointingAtMenu) && isPressedY && this._guiXR) {
            const isScrollTriggerPressed = nonDomSource && nonDomSource.gamepad && nonDomSource.gamepad.buttons[0] && nonDomSource.gamepad.buttons[0].pressed;
            const scrollSpeed = isScrollTriggerPressed ? 4 : 24; // Default 24, slow-mo 4

            if (this._guiXR._overlay === 'menu') {
              this._guiXR._scrollOffsetOverlay += (valY > 0 ? 1 : -1) * scrollSpeed;
              this._guiXR._scrollOffsetOverlay = Math.max(0, Math.min(this._guiXR._scrollOffsetOverlay, this._guiXR._maxScrollOverlay || 0));
              if (this._guiXR._overlayData && (this._guiXR._overlayData.tabName === 'About & Help' || this._guiXR._overlayData.tabName === 'About')) {
                window._sculptAboutScroll = this._guiXR._scrollOffsetOverlay;
              }
            } else {
              this._guiXR._scrollOffset += (valY > 0 ? 1 : -1) * scrollSpeed;
              this._guiXR._scrollOffset = Math.max(0, Math.min(this._guiXR._scrollOffset, this._guiXR._maxScroll || 0));
            }
            this._guiXR._needsRedraw = true;
          } else if (isPressedY) {
            if (now - state.lastRadiusTime > targetRateY) { 
              state.lastRadiusTime = now;

              let change = 0.0;
              const tools = this._sculptManager.getCurrentTool();
              const maxRadius = 250.0;
              if (valY < -T_PRESS) change = maxRadius * 0.05 * speedModifier; // UP -> +5% of max
              if (valY > T_PRESS) change = -maxRadius * 0.05 * speedModifier; // DOWN -> -5% of max

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

          // INTENSITY CONTROL (X-Axis)
          if (!state.lastIntensityTime) state.lastIntensityTime = 0;

          const targetRateX = isSecondaryTriggerPressed ? 15 : 30;

          if (isPressedX) {
            if (now - state.lastIntensityTime > targetRateX) {
              state.lastIntensityTime = now;

              let intChange = 0.0;
              const tools = this._sculptManager.getCurrentTool();

              if (valX < -T_PRESS) intChange = -0.05 * speedModifier; // Left -> -5%
              if (valX > T_PRESS) intChange = 0.05 * speedModifier;   // Right -> +5%

              if (intChange !== 0 && tools) {
                const oldVal = tools._intensity;
                const newVal = Math.max(0.0, Math.min(1.0, oldVal + intChange));

                tools.setIntensity(newVal);

                // Update UI Widgets if active
                if (this._guiXR) {
                  this._guiXR.updateWidget('intensity', newVal);
                }
                if (this._guiMini) {
                  this._guiMini.updateWidget('intensity', newVal);
                }

                // Force Render
                this._main ? this._main.render() : this.render();
              }
            }
          } else {
            state.lastIntensityTime = 0;
          }
          state.axes[2] = valX;
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
            const activeTool = this._sculptManager.getCurrentTool();
            const isPaint = activeTool && activeTool.constructor.name === 'Paint';

            if (btnA && btnA.pressed !== tracker.pressed) {
              if (btnA.pressed) {
                // Button Down: Activate INSTANTLY
                tracker.time = now;
                tracker.longPressActive = false;

                if (isPaint) {
                  activeTool.swapColors();
                  const targetMain = this._main || window.main;
                  if (targetMain && targetMain.getGui() && targetMain.getGui()._guiXR) {
                    targetMain.getGui()._guiXR._needsRedraw = true;
                  }
                } else {
                  this._vrSubtractActive = !this._vrSubtractActive;
                }
              } else {
                // Button Up
                if (tracker.longPressActive && !isPaint) {
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
                if (this._guiXR) {
                  this._guiXR.toggleVisibility();
                  console.log(`[VR X Button] Toggled main menu visibility to ${this._guiXR._isVisible}`);
                  if (this._guiPopup) {
                    console.log('[VR X Button] Closing Mini-HUD tool overlay');
                    this._guiPopup.closeOverlay();
                  }
                }
              } else {
                // Button Up
                if (tracker.longPressActive) {
                  // Momentary Release -> Revert menu visibility
                  if (this._guiXR) {
                    this._guiXR.toggleVisibility();
                    console.log(`[VR X Button] Reverting main menu visibility to ${this._guiXR._isVisible}`);
                    if (this._guiPopup) {
                      this._guiPopup.closeOverlay();
                    }
                  }
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

      // --- NATIVE HAND TRACKING IMPLEMENTATION ---
      let mockGamepad = null;
      if (source.hand) {
        if (source.handedness === 'left') this._isHandTrackingLeft = true;
        if (source.handedness === 'right') this._isHandTrackingRight = true;

        const thumbTip = frame.getJointPose(source.hand.get('thumb-tip'), refSpace);
        const indexTip = frame.getJointPose(source.hand.get('index-finger-tip'), refSpace);
        const middleTip = frame.getJointPose(source.hand.get('middle-finger-tip'), refSpace);
        const middleKnuckle = frame.getJointPose(source.hand.get('middle-finger-phalanx-proximal'), refSpace);
        const wrist = frame.getJointPose(source.hand.get('wrist'), refSpace);

        let isPinching = false;
        let isFist = false;

        // Extract wrist matrix for HUD anchoring
        if (wrist) {
          if (source.handedness === 'left') this._nonDomWristMatrix = wrist.transform.matrix;
          if (source.handedness === 'right') this._domWristMatrix = wrist.transform.matrix;
        }

        if (thumbTip && indexTip && middleTip && middleKnuckle) {
          const pT = thumbTip.transform.position;
          const pI = indexTip.transform.position;
          const pM = middleTip.transform.position;
          const pK = middleKnuckle.transform.position;

          const pinchDist = vec3.distance([pT.x, pT.y, pT.z], [pI.x, pI.y, pI.z]);
          const fistDist = vec3.distance([pM.x, pM.y, pM.z], [pK.x, pK.y, pK.z]);

          isPinching = pinchDist < 0.02; // 2cm pinch threshold
          isFist = fistDist < 0.05;      // 5cm fist threshold

          // Grab Suppression: Check if Dom index tip is near Non-Dom wrist (25cm)
          if (source.handedness === this._dominantHand && this._nonDomWristMatrix) {
             const wristPos = { x: this._nonDomWristMatrix[12], y: this._nonDomWristMatrix[13], z: this._nonDomWristMatrix[14] };
             const dist = vec3.distance([pI.x, pI.y, pI.z], [wristPos.x, wristPos.y, wristPos.z]);
             
             const wasMiniHUDActive = this._isMiniHUDActive;
             this._isMiniHUDActive = (dist < 0.25);
             
             if (wasMiniHUDActive && !this._isMiniHUDActive && this._guiPopup) {
               this._guiPopup.closeOverlay();
             }

             if (this._isMiniHUDActive) {
                isPinching = false;
                isFist = false;

                // INDEX FINGER Z-DEPTH PUSH-TO-CLICK
                if (this._vrMiniHUD && this._guiMini && this._guiMini._isVisible) {
                  const hit = this._vrMiniHUD.intersectPoint([pI.x, pI.y, pI.z]);
                  if (hit && hit.distance <= 0.0) {
                    isPinching = true; // Emulate Trigger pull!
                  }
                }
             }
          }
        }

        mockGamepad = {
          buttons: [
            { pressed: isPinching, value: isPinching ? 1.0 : 0.0 }, // Trigger (Sculpt / UI Click)
            { pressed: isFist, value: isFist ? 1.0 : 0.0 },         // Grip (Move World)
            { pressed: false, value: 0 },
            { pressed: false, value: 0 },
            { pressed: false, value: 0 },
            { pressed: false, value: 0 }
          ],
          axes: [0, 0, 0, 0]
        };
      } else {
        if (source.handedness === 'left') this._isHandTrackingLeft = false;
        if (source.handedness === 'right') this._isHandTrackingRight = false;
      }
      
      const activeGamepad = mockGamepad || source.gamepad;

      // 1. Common Pose Gathering (for All Tasks)
      const worldPose = frame.getPose(source.gripSpace, refSpace);
      if (worldPose) {
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
        // if (Math.random() < 0.02) console.log(`[Raycast] Dominant:${this._dominantHand} Src:${source.handedness}`);
        let origin, dir;
        let isFallback = false;

        // CRITICAL FIX: To ensure the mathematical picking ray perfectly aligns with the
        // visual Three.js CylinderGeometry pointer, we MUST read the final computed
        // `matrixWorld` from the Three.js XRController Object3D, rather than the raw 
        // WebXR pose matrix, as Three.js may apply camera rig offsets or structural hierarchy.
        let ctrl3D = null;
        if (source.handedness === 'left') ctrl3D = this._vrControllerLeft;
        if (source.handedness === 'right') ctrl3D = this._vrControllerRight;

        if (ctrl3D) {
          ctrl3D.updateMatrixWorld(true);
          const off = this.getStylusOffset();
          const tilt = this.getStylusTilt() * Math.PI / 180.0;
          
          const rayOrigin = new THREE.Vector3(0, 0, -off);
          rayOrigin.applyMatrix4(ctrl3D.matrixWorld);
          
          const rayDir = new THREE.Vector3(0, Math.sin(tilt), -Math.cos(tilt));
          rayDir.transformDirection(ctrl3D.matrixWorld).normalize();

          origin = vec3.fromValues(rayOrigin.x, rayOrigin.y, rayOrigin.z);
          dir = vec3.fromValues(rayDir.x, rayDir.y, rayDir.z);
        } else {
          // Fallback to raw Frame Pos if Three.js objects are somehow missing
          let rayPose = source.targetRaySpace ? frame.getPose(source.targetRaySpace, refSpace) : null;
          if (!rayPose && source.gripSpace) {
             rayPose = frame.getPose(source.gripSpace, refSpace);
             isFallback = true;
          }
          if (rayPose) {
             const mat = rayPose.transform.matrix;
             const off = this.getStylusOffset();
             const tilt = this.getStylusTilt() * Math.PI / 180.0;
             
             const untiltedDir = vec3.fromValues(-mat[8], -mat[9], -mat[10]);
             vec3.normalize(untiltedDir, untiltedDir);
             
             origin = vec3.fromValues(mat[12], mat[13], mat[14]);
             vec3.scaleAndAdd(origin, origin, untiltedDir, off);
             
             const xAxis = vec3.fromValues(mat[0], mat[1], mat[2]);
             const qTilt = quat.create();
             quat.setAxisAngle(qTilt, xAxis, tilt);
             
             dir = vec3.clone(untiltedDir);
             vec3.transformQuat(dir, dir, qTilt);
          }
        }
        
        if (origin && dir) {
          // if (Math.random() < 0.02) console.log(`[Raycast] Origin/Dir Valid - Menu:${!!this._vrMenu} GuiXR:${!!this._guiXR} Vis:${this._guiXR ? this._guiXR._isVisible : false}`);
          let hit = null;
          let targetGuiXR = null;

          // PHYSICAL MATRIX SYNC: The visual Three.js meshes won't have their `matrixWorld` updated
          // until the renderer runs. But our `VRMenu.intersect` math requires the EXACT physical
          // location of the controller *right now*. 
          // Extract the non-dominant controller's world matrix for the menu attachments.
          let attachMatrix = (this._dominantHand === 'right') ? this._vrPoseLeft : this._vrPoseRight;
          
          if (attachMatrix) {
              if (this._vrMenu) this._vrMenu.updateMatrices(null, attachMatrix);
              if (this._vrPopup) this._vrPopup.updateMatrices(null, attachMatrix);
              if (this._vrMiniHUD) this._vrMiniHUD.updateMatrices(null, attachMatrix);
          }

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
          let bottomedOut = false;
          let depth = 0;
          if (source.gamepad && source.gamepad.buttons[0]) {
            // FIRE EARLY: Trigger UI hits at 10% depression instead of waiting for a full physical click
            depth = source.gamepad.buttons[0].value;
            pressed = depth > 0.1 || source.gamepad.buttons[0].pressed;
            bottomedOut = depth >= 0.99 || source.gamepad.buttons[0].pressed;
          }

          // DRAG CAPTURE LOCK
          // If we are currently holding down the trigger on a specific GUI, we MUST lock all input to that GUI.
          // This prevents the raycast from slipping off the MiniHUD and hitting the Main Menu behind it, which
          // causes sliders to violently teleport because `targetGuiXR` suddenly changes mid-drag.
          if (this._activePressedGui && pressed) {
            targetGuiXR = this._activePressedGui;
            
            // Re-verify the hit actually belongs to the locked GUI mesh.
            const lockedMenuObj = (targetGuiXR === this._guiXR) ? this._vrMenu : (targetGuiXR === this._guiMini ? this._vrMiniHUD : this._vrPopup);
            if (!hit || (lockedMenuObj && hit.object !== lockedMenuObj && hit.object !== lockedMenuObj.mesh)) {
                if (lockedMenuObj) {
                    const planeHit = lockedMenuObj.intersect(origin, dir, { allowOutside: true });
                    if (planeHit) hit = planeHit;
                }
            }
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

          // Dispatch Interaction
          if (hit || (this._activePressedGui && pressed)) {
            this._isPointingAtMenu = true;
            
            // FIX REVERTED: We are no longer using native Three.js raycasting. 
            // The raw Math plane intersection generates pure WebGL UVs (0 at bottom, 1 at top).
            // But HTML Canvas (and GuiXR) expects 0 at the top, 1 at the bottom.
            // Therefore, we MUST invert the V coordinate manually!
            const currU = hit ? hit.uv[0] : -1;
            const currV = hit ? (1.0 - hit.uv[1]) : -1;
            
            if (hit) {
              if (window.screenLog && Math.random() < 0.05) {
                // window.screenLog(`[UI Hit] U:${currU.toFixed(2)} V:${currV.toFixed(2)}`, 'cyan');
              }

              targetGuiXR.setCursor(currU, currV);
            }
            
            targetGuiXR._updateHover(); // Trigger UI loop (uses GuiXR's internal this._cursor)

            if (this._activePressedGui) {
              this._activePressedGui.onInteract(currU, currV, pressed, depth);
              if (this._activePressedGui !== targetGuiXR) {
                targetGuiXR.onInteract(currU, currV, false);
              }
            } else {
              targetGuiXR.onInteract(currU, currV, pressed, depth);
            }

            // Calc Laser Distance (visual clamping)
            if (this._vrLaser && hit) {
              if (source.handedness === 'left') this._vrUIHitDistLeft = hit.distance; 
              else this._vrUIHitDistRight = hit.distance; 
            }

          } else {
            if (this._guiXR) this._guiXR.setCursor(-1, -1);
            if (this._guiMini) this._guiMini.setCursor(-1, -1);
            if (source.handedness === 'left') this._vrUIHitDistLeft = Infinity;
            else this._vrUIHitDistRight = Infinity;
          }
        } else {
          // Log Failure
          if (window.screenLog && Math.random() < 0.01) {
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
        if (this._vrAmbidextrousCursors || source.handedness === this._dominantHand) {
          this._activeHandedness = source.handedness;
        }
      }
    }

    // FORCE PIVOT INIT (Just in case)
    // if (!this._debugPivotMesh) this.updateDebugPivot([0, 0, 0], false);

    // 5. Dispatch Sculpting (Active Hand)
    // XRInputSourceArray is not a real array, so .find() fails.
    let activeSource = null;


    // Check Triggers & Log
    // Read from the physical gamepad OR our mockGamepad generated from Hand Tracking gestures
    const getBtn = (src) => {
      if (!src) return false;
      if (src.hand) {
         // Re-evaluate pinch locally or just read the hand tracking state variables if we saved them...
         // Better: The mockGamepad logic above is local to the loop. Let's just use the physical gamepad 
         // logic on the activeSource later, or extract it cleanly.
         // For 'rightPressed' logic here, we just need to re-query the hardware.
         return false; // Handled below safely
      }
      return src.gamepad && src.gamepad.buttons[0] && src.gamepad.buttons[0].pressed;
    };
    
    // We update this check to be more robust, delegating the actual evaluation to the specific activeSource later
    const rightPressed = false; 
    const leftPressed = false;

    // Helper: Specific Tool Override
    const tool = this._sculptManager.getCurrentTool();
    const isVoxel = tool && tool.constructor && tool.constructor.name === 'SculptVoxel';

    // Priority: Locked Hand (if sculpting) > Pressed Hand > Dominant Hand > Other Hand > First Found
    const domSource = this._dominantHand === 'left' ? left : right;

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



    // Update Three.js Laser Pointer Visual Lengths and Cursors
    this._updateVRCursors(frame, refSpace, sources);

    // Buffer menu pointing state for exactly one frame to absorb trigger releases when menus close
    this._wasPointingAtMenu = this._isPointingAtMenu;
  } catch (e) {
      if (Math.random() < 0.05) console.error("[SculptXR] XR Input Error:", e);
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
    if (vec3.length(pivot) < 0.0001) {
      this.updateVROffsets();
      return;
    }

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

    // Refactored to use the pre-calculated physics vectors from handleXRInput
    // This ensures 100% parity between UI raycasting, Mesh raycasting, and Laser Rendering.
    const physicalOrigin = this._vrControllerPosPhys || [p.x, p.y, p.z];
    
    let rayDirPhys;
    if (this._vrControllerDirPhys) {
        rayDirPhys = vec3.clone(this._vrControllerDirPhys);
    } else {
        const tilt = this.getStylusTilt() * Math.PI / 180.0;
        rayDirPhys = vec3.fromValues(0, Math.sin(tilt), -Math.cos(tilt));
        vec3.transformQuat(rayDirPhys, rayDirPhys, [q.x, q.y, q.z, q.w]);
    }

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

    // [STYLUS PROP] Tip Position Calculation (Parity with live laser visual)
    const len = this.getStylusLength();
    const off = this.getStylusOffset();
    
    // Offset is along untilted Z axis
    const untiltedDir = vec3.fromValues(0, 0, -1);
    vec3.transformQuat(untiltedDir, untiltedDir, [q.x, q.y, q.z, q.w]);
    
    const basePhys = vec3.create();
    vec3.scaleAndAdd(basePhys, physicalOrigin, untiltedDir, off);
    
    const tipPhys = vec3.create();
    vec3.scaleAndAdd(tipPhys, basePhys, rayDirPhys, len);

    const tipModel = vec3.create();
    if (this._spectatorMode === Enums.SpectatorMode.STATIONARY && this._camera._specView && this._camera._specViewPhys) {
      vec3.copy(tipModel, tipPhys);
      vec3.transformMat4(tipModel, tipModel, this._camera._specViewPhys);
      const invHackedView = mat4.create();
      mat4.invert(invHackedView, this._camera._specView);
      vec3.transformMat4(tipModel, tipModel, invHackedView);
    } else {
      vec3.copy(tipModel, tipPhys);
      if (this._xrWorldOffset) {
        vec3.transformMat4(tipModel, tipModel, this._xrWorldOffset.inverse.matrix);
      }
      vec3.scale(tipModel, tipModel, invScale);
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
    const isToolActive = currentTool && (currentTool._grabbedMesh || currentTool._initInput || currentTool._isGizmoHovered);
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
        quat: engineQuat,
        tipOrigin: tipModel // Fix: pass exact tip
      });

      return;
    }

    // 4. Picking State Synchronization (RAY CASTING)
    // Use Ray Casting for perfect alignment with Laser Pointer

    // A. Compute Ray Direction (Model Space)
    const engineDir = vec3.clone(rayDirPhys);

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
    const rayOriginPhysical = this._vrControllerPosPhys || [p.x, p.y, p.z];

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
    
    const activeSceneMesh = this.getMesh();
    let targetMeshes = this._meshes;
    if (this._lockSelection) {
      const selectedGroup = this.getSelectedMeshes();
      targetMeshes = (selectedGroup && selectedGroup.length > 0) ? selectedGroup : (activeSceneMesh ? [activeSceneMesh] : this._meshes);
    }

    if (isTransformDrag) {
      picked = true;
    } else {
      let useVolume = this._vrUseVolumeIntersect;
      const toolIndex = this._sculptManager ? this._sculptManager._toolIndex : -1;
      if (toolIndex === Enums.Tools.MOVE) {
        useVolume = true;
      } else if (toolIndex === Enums.Tools.TRANSFORM_VR || toolIndex === Enums.Tools.VOXEL) {
        useVolume = false;
      }

      if (useVolume) {
        const len = this.getStylusLength();
        const off = this.getStylusOffset();
        const untiltedDir = vec3.fromValues(0, 0, -1);
        vec3.transformQuat(untiltedDir, untiltedDir, [q.x, q.y, q.z, q.w]);
        const basePhys = vec3.create();
        vec3.scaleAndAdd(basePhys, physicalOrigin, untiltedDir, off);
        const volumePhys = vec3.create();
        vec3.scaleAndAdd(volumePhys, basePhys, rayDirPhys, len);
        const volumeEnginePos = vec3.clone(volumePhys);
        if (this._xrWorldOffset) {
          vec3.transformMat4(volumeEnginePos, volumeEnginePos, this._xrWorldOffset.inverse.matrix);
        }
        vec3.scale(volumeEnginePos, volumeEnginePos, invScale);

        const paddedRadius = pickingRadius * (toolIndex === Enums.Tools.MOVE ? 1.25 : 1.0);
        picked = this._picking.intersectionSphereMeshes(targetMeshes, volumeEnginePos, paddedRadius);
      } else {
        picked = this._picking.intersectionRayMeshes(targetMeshes, rayOrigin, engineDir);
        this._picking._isVRHit = picked;
      }
    }

    // Capture Mesh Intersection Distance for Laser Visuals
    if (picked) {
      const hitPoint = this._picking.getIntersectionPoint(); // engine space
      // Convert engine distance back to physical distance (meters)
      const dist = vec3.distance(enginePos, hitPoint) * (this._vrScale || 1.0);
      this._vrLaserDistance = dist;
    } else {
      this._vrLaserDistance = 5.0; // Reset to infinity line if we slipped off the mesh
    }

    // Logs removed

    // [DEBUG] Interactive Raycaster Debugger (DISABLED)
    if (window.debugRaycaster) {
       // ... disabled by default to avoid clutter ...
    }

    // 5. Stroke Lifecycle (Corrected API)
    const buttons = source.gamepad.buttons;
    // PHASE 11 Fix: If we are already sculpting/dragging with this hand, it IS the trigger state that matters
    // regardless of global dominance.
    const isDominant = (source.handedness === this._dominantHand);
    
    // Evaluate custom trigger sensitivity threshold
    let triggerThreshold = 0.5; // Default middle
    if (this._guiXR && this._guiXR._uiSettings && this._guiXR._uiSettings.triggerCurve !== undefined) {
      // slider is 0.0 (Hard) to 1.0 (Light)
      // We map this to a threshold of 0.9 (Hard) to 0.1 (Light)
      const uiVal = this._guiXR._uiSettings.triggerCurve;
      triggerThreshold = 0.9 - (uiVal * 0.8);
    }
    
    // Safe extract analog value
    let analogValue = 0.0;
    if (buttons && buttons[0]) {
      analogValue = buttons[0].value;
    }
    
    // Evaluate if the trigger has crossed the user's defined physical threshold
    let isTriggerPressed = false;
    if (this._vrLockedHand === source.handedness) {
       isTriggerPressed = analogValue >= triggerThreshold;
    } else {
       isTriggerPressed = (isDominant && analogValue >= triggerThreshold);
    }

    // VR Ergonomics: Temporary Modifiers
    // Check if the non-dominant index trigger is held.
    // FIX v0.9.160: Evaluated BEFORE stroke initialization to prevent first-frame "dot" of primary tool
    const session = frame.session;
    const nonDomHand = this._dominantHand === 'left' ? 'right' : 'left';

    let isSmoothOverride = false;
    let isColorSmoothOverride = false;
    let previousToolIndex = -1;

    if (session && session.inputSources && !this._isPointingAtMenu && !this._wasPointingAtMenu) {
      for (let src of session.inputSources) {
        if (src.handedness === nonDomHand && src.gamepad) {
          // Button 0 (Index Trigger)
          if (src.gamepad.buttons[0] && src.gamepad.buttons[0].pressed) {
            // Apply contextual override based on the active tool
            const activeTool = this._sculptManager.getCurrentTool();
            if (activeTool && activeTool.constructor.name === 'Paint') {
              isColorSmoothOverride = true;
            } else if (activeTool && activeTool.constructor.name !== 'SculptVoxel' && activeTool.constructor.name !== 'Extrude') {
              // Disable Smooth toggle for Voxel tool as it does not fully support it yet
              isSmoothOverride = true;
            }
            break;
          }
        }
      }
    }

    if (isSmoothOverride) {
      const smoothToolIndex = this._sculptManager._tools.findIndex(t => t && t.constructor.name === 'Smooth');
      if (smoothToolIndex !== -1 && this._sculptManager.getCurrentTool() !== this._sculptManager._tools[smoothToolIndex]) {
        previousToolIndex = this._sculptManager._toolIndex;
        // Sync radius from current tool to smooth tool so size feels consistent
        const origRadius = this._sculptManager.getCurrentTool()._radius;
        this._sculptManager._toolIndex = smoothToolIndex;
        this._sculptManager.getCurrentTool()._radius = origRadius;
      }
    }

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

    let canSculpt = isTriggerPressed && (picked || this._vrSculpting || allowAir || isToolActive || this._vrSecondaryTriggerPressed);

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

        if (!window._firstSculptLogged) {
          window._firstSculptLogged = true;
          // console.log("[Telemetry] First Sculpt Stroke Started!");
        }

        const cTool = this._sculptManager.getCurrentTool();
        if (cTool && cTool._pickColor) {
            this._eyedropperStartColor = [cTool._color[0], cTool._color[1], cTool._color[2]];
        } else {
            this._eyedropperStartColor = null;
        }



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
        this._eyedropperStartColor = null;

        const currentMesh = this.getMesh();
        
        function captureTrackState(mesh) {
          if (!window._animationRegistry) return null;
          const id = mesh.getID();
          const tr = window._animationRegistry.tracks.get(id);
          if (!tr) return { shapeTimes: [], shapes: [], tangents: [], times: [], positions: [], quaternions: [], scales: [] };
          return {
            shapeTimes: (tr.shapeTimes || []).slice(),
            shapes: (tr.shapes || []).map(arr => new Float32Array(arr)),
            tangents: (tr.tangents || []).slice(),
            times: (tr.times || []).slice(),
            positions: (tr.positions || []).slice(),
            quaternions: (tr.quaternions || []).slice(),
            scales: (tr.scales || []).slice()
          };
        }
        
        this._sculptManager.end();
        this._action = Enums.Action.NOTHING;

        // AutoKey Feature
        if (window._animAutoKey && window._animationRegistry && currentMesh) {
          const sm = this._sculptManager;
          const isMove = sm && (sm._toolIndex === Enums.Tools.TRANSFORM_VR || sm._toolIndex === Enums.Tools.GRAB);

          if (isMove) {
            const meshId = currentMesh.getID();
            if (!window._animationRegistry.tracks.has(meshId)) {
              window._animationRegistry.tracks.set(meshId, {
                times: [], positions: [], quaternions: [], scales: [],
                shapeTimes: [], shapes: [], playbackTime: 0, lastUpdate: performance.now()
              });
            }
            const track = window._animationRegistry.tracks.get(meshId);
            const fps = window._animFPS || 24;
            const targetTime = Math.round((window._animCurrentTime !== undefined ? window._animCurrentTime : 0) * fps) / fps;
            window._animCurrentTime = targetTime;
            window._animationRegistry.globalPlaybackTime = targetTime;

            // If this is a new track or empty, and we are not at frame 0,
            // automatically add a key at frame 0 with the OLD position (before the move).
            if (track.times.length === 0 && targetTime > 0.005) {
              const tool = this._sculptManager.getCurrentTool();
              if (tool && tool._undoMatrix) {
                const currMat = mat4.clone(currentMesh.getMatrix());
                currentMesh.setMatrix(tool._undoMatrix);
                window._animationRegistry.addTransformKey(currentMesh, 0.0);
                currentMesh.setMatrix(currMat);
              }
            }

            const tMat = currentMesh.getMatrix();
            const pos = [tMat[12], tMat[13], tMat[14]];
            
            const sx = Math.hypot(tMat[0], tMat[1], tMat[2]);
            const sy = Math.hypot(tMat[4], tMat[5], tMat[6]);
            const sz = Math.hypot(tMat[8], tMat[9], tMat[10]);
            
            const m = mat3.fromValues(
              tMat[0]/sx, tMat[1]/sx, tMat[2]/sx,
              tMat[4]/sy, tMat[5]/sy, tMat[6]/sy,
              tMat[8]/sz, tMat[9]/sz, tMat[10]/sz
            );
            const q = quat.create();
            quat.fromMat3(q, m);

            // Check if keyframe already exists for update vs add
            let keyIdx = -1;
            if (track.times) {
              for (let i = 0; i < track.times.length; i++) {
                if (Math.abs(track.times[i] - targetTime) < 0.005) {
                  keyIdx = i;
                  break;
                }
              }
            }

            const wasUpdate = keyIdx >= 0;
            let oldData = null;
            if (wasUpdate) {
              oldData = {
                pos: track.positions.slice(keyIdx * 3, keyIdx * 3 + 3),
                q: track.quaternions.slice(keyIdx * 4, keyIdx * 4 + 4),
                s: track.scales.slice(keyIdx * 3, keyIdx * 3 + 3)
              };
            }

            // Use centralized method to add/update keyframe
            window._animationRegistry.addTransformKey(currentMesh, targetTime);
            if (this._guiXR) this._guiXR._needsRedraw = true;

            const newData = {
              pos: [...pos],
              q: [q[0], q[1], q[2], q[3]],
              s: [sx, sy, sz]
            };

            if (this.getStateManager) {
              this.getStateManager().pushStateCustom(
                () => { // UNDO
                  const tr = window._animationRegistry.tracks.get(meshId);
                  if (!tr) return;
                  if (wasUpdate) {
                    // Restore old values
                    let idx = 0;
                    while (idx < tr.times.length && tr.times[idx] < targetTime) idx++;
                    if (idx < tr.times.length && Math.abs(tr.times[idx] - targetTime) < 0.005) {
                      tr.positions.splice(idx*3, 3, ...oldData.pos);
                      tr.quaternions.splice(idx*4, 4, ...oldData.q);
                      tr.scales.splice(idx*3, 3, ...oldData.s);
                    }
                  } else {
                    // Remove the added key
                    window._animationRegistry.deleteTransformKey(currentMesh, targetTime);
                  }
                  window._animationRegistry.update(currentMesh, true);
                  if (this._guiXR) this._guiXR._needsRedraw = true;
                },
                () => { // REDO
                  const tr = window._animationRegistry.tracks.get(meshId);
                  if (!tr) return;
                  let idx = 0;
                  while (idx < tr.times.length && tr.times[idx] < targetTime) idx++;
                  
                  if (idx < tr.times.length && Math.abs(tr.times[idx] - targetTime) < 0.005) {
                    tr.positions.splice(idx*3, 3, ...newData.pos);
                    tr.quaternions.splice(idx*4, 4, ...newData.q);
                    tr.scales.splice(idx*3, 3, ...newData.s);
                  } else {
                    tr.times.splice(idx, 0, targetTime);
                    tr.positions.splice(idx*3, 0, ...newData.pos);
                    tr.quaternions.splice(idx*4, 0, ...newData.q);
                    tr.scales.splice(idx*3, 0, ...newData.s);
                  }
                  window._animationRegistry.update(currentMesh, true);
                  if (this._guiXR) this._guiXR._needsRedraw = true;
                }
              );
            }
          } else if (window._animKeyMode === 'shape' || window._animKeyMode === 0) {
            const fps = window._animFPS || 24;
            const targetTime = Math.round((window._animCurrentTime !== undefined ? window._animCurrentTime : 0) * fps) / fps;
            window._animCurrentTime = targetTime;
            window._animationRegistry.globalPlaybackTime = targetTime;
            const meshId = currentMesh.getID();
            
            if (!window._animationRegistry.tracks.has(meshId)) {
              window._animationRegistry.tracks.set(meshId, {
                times: [], positions: [], quaternions: [], scales: [],
                shapeTimes: [], shapes: [], playbackTime: 0, lastUpdate: performance.now()
              });
            }
            const track = window._animationRegistry.tracks.get(meshId);
            
            const v = currentMesh.getVertices();
            const copy = new Float32Array(v);
            
            let keyIdx = -1;
            if (track.shapeTimes) {
              for (let i = 0; i < track.shapeTimes.length; i++) {
                if (Math.abs(track.shapeTimes[i] - targetTime) < 0.005) {
                  keyIdx = i;
                  break;
                }
              }
            }
            
            const wasUpdate = keyIdx >= 0;
            let oldData = null;
            if (wasUpdate) {
              oldData = track.shapes[keyIdx];
            }
            
            window._animationRegistry.addShapeKey(currentMesh, targetTime);
            if (this._guiXR) this._guiXR._needsRedraw = true;
            
            if (this.getStateManager) {
              this.getStateManager().pushStateCustom(
                () => { // UNDO
                  const tr = window._animationRegistry.tracks.get(meshId);
                  if (!tr) return;
                  if (wasUpdate) {
                    let idx = 0;
                    while (idx < tr.shapeTimes.length && tr.shapeTimes[idx] < targetTime) idx++;
                    if (idx < tr.shapeTimes.length && Math.abs(tr.shapeTimes[idx] - targetTime) < 0.005) {
                      tr.shapes[idx] = oldData;
                    }
                  } else {
                    window._animationRegistry.deleteShapeKey(currentMesh, targetTime);
                  }
                  if (this._guiXR) this._guiXR._needsRedraw = true;
                },
                () => { // REDO
                  const tr = window._animationRegistry.tracks.get(meshId);
                  if (!tr) return;
                  let idx = 0;
                  while (idx < tr.shapeTimes.length && tr.shapeTimes[idx] < targetTime) idx++;
                  
                  if (idx < tr.shapeTimes.length && Math.abs(tr.shapeTimes[idx] - targetTime) < 0.005) {
                    tr.shapes[idx] = copy;
                  } else {
                    tr.shapeTimes.splice(idx, 0, targetTime);
                    tr.shapes.splice(idx, 0, copy);
                  }
                  if (this._guiXR) this._guiXR._needsRedraw = true;
                }
              );
            }
          }
        }
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
            // Support native hand tracking mock objects
            const gamepad = src.hand ? { buttons: [{pressed:false},{pressed:false}] } : src.gamepad;
            if (!gamepad) continue;

            // Get Physical Matrix (World Space)
            const ctl = (src.handedness === 'left') ? this._vrControllerLeft : this._vrControllerRight;
            if (ctl) {
              const physMat = ctl.matrixWorld.elements; // Native Three.js World Matrix
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
        // Re-calculate the mock trigger for Voxel Engine pass
        if (source && source.hand) {
           const thumbTip = frame.getJointPose(source.hand.get('thumb-tip'), refSpace);
           const indexTip = frame.getJointPose(source.hand.get('index-finger-tip'), refSpace);
           if (thumbTip && indexTip) {
              const pT = thumbTip.transform.position;
              const pI = indexTip.transform.position;
              triggerValue = (vec3.distance([pT.x, pT.y, pT.z], [pI.x, pI.y, pI.z]) < 0.02) ? 1.0 : 0.0;
           } else {
             triggerValue = 0.0;
           }
        } else if (source && source.gamepad && source.gamepad.buttons[0]) {
          triggerValue = source.gamepad.buttons[0].value;
        }

        // Universal Sub Mode: Apply Effective Negative State to Tool
        const toolParams = currentTool || tool; // handle variable changes via scope shift
        if (toolParams) toolParams._negative = isNegative;

        if (this._wasTriggerPressed !== isTriggerPressed) {
          this._wasTriggerPressed = isTriggerPressed;
        }

        this._sculptManager.updateXR(this._picking, isTriggerPressed, enginePos, dir, {
          isNegative: isNegative,
          controllers: xrControllers,
          triggerValue: triggerValue,
          handedness: source.handedness,
          quat: engineQuat,
          rayOrigin: rayOrigin, // Pass laser tip
          tipOrigin: tipModel, // Fix: pass exact tip
          isColorSmoothOverride: isColorSmoothOverride
        });


        // Restore original state immediately
        if (toolParams) {
          toolParams._negative = origNegative;
        }

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



    // (Visual Cursor Update moved to _updateVRCursors at end of frame to support both hands)
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

  _updateVRCursors(frame, refSpace, sources) {
    try {
        if (!sources || !this._camera || !this._picking) return;

        if (!window._logCursorThrottle) window._logCursorThrottle = 0;
        const doLog = (window._logCursorThrottle++ % 120 === 0);
        // if (doLog && window.screenLog) {
        //     window.screenLog(`[XR] Input Sources found: ${sources.length}`, "cyan");
        // }


        const tool = this._sculptManager ? this._sculptManager.getCurrentTool() : null;
        let sliderVal = (this._guiXR) ? this._guiXR._radius : 0.15;
        if (tool && tool._radius !== undefined) {
          sliderVal = tool._radius / 100.0;
        }
        const physicalRadius = sliderVal * 0.1; // 0-10cm range

        const invScale = 1.0 / (this._vrScale || 1.0);

        for (let source of sources) {
            if (!source.targetRaySpace) continue;
            const isLeft = source.handedness === 'left';
            
            const pose = frame.getPose(source.targetRaySpace, refSpace);
            if (!pose) continue;

            const m = pose.transform.matrix;
            const origin = [m[12], m[13], m[14]];
            const untiltedDir = vec3.fromValues(-m[8], -m[9], -m[10]);
            vec3.normalize(untiltedDir, untiltedDir);
            
            const xAxis = vec3.fromValues(m[0], m[1], m[2]);
            const tilt = this.getStylusTilt() * Math.PI / 180.0;
            const qTilt = quat.create();
            quat.setAxisAngle(qTilt, xAxis, tilt);
            
            const dir = vec3.clone(untiltedDir);
            vec3.transformQuat(dir, dir, qTilt);
            
            const off = this.getStylusOffset();
            const len = this.getStylusLength();
            
            const basePhys = vec3.create();
            vec3.scaleAndAdd(basePhys, origin, untiltedDir, off);
            
            const tipPhys = vec3.create();
            vec3.scaleAndAdd(tipPhys, basePhys, dir, len);

            // Ray Engine Raycast MUST originate from the Controller Root, 
            // otherwise the origin begins INSIDE the 3D mesh when the physical tip penetrates the clay, causing Raycast to hit erratic backfaces!
            const originEngine = vec3.clone(origin);
            const dirEngine = vec3.clone(dir);

            if (this._xrWorldOffset) {
                vec3.transformMat4(originEngine, originEngine, this._xrWorldOffset.inverse.matrix);
                
                const r = this._xrWorldOffset.orientation;
                const qInv = quat.create();
                quat.invert(qInv, quat.fromValues(r.x, r.y, r.z, r.w));
                vec3.transformQuat(dirEngine, dirEngine, qInv);
            }
            vec3.scale(originEngine, originEngine, invScale);
            vec3.normalize(dirEngine, dirEngine);

            const uiHitDist = isLeft ? this._vrUIHitDistLeft : this._vrUIHitDistRight;
            const cursorGroup = isLeft ? this._vrCursorLeft : this._vrCursorRight;
            const controllerGroup = isLeft ? this._vrControllerLeft : this._vrControllerRight;
            if (!controllerGroup) { if (cursorGroup) cursorGroup.visible = false; continue; } // Safe guard for unmapped handedness
            const pointerLine = controllerGroup.getObjectByName('pointer_ray_root');

            let hitDist = 5.0;
            let pickedMesh = null;
            let pNormal = null;
            let wInter = null;
            let sceneNormal = null;

            if (uiHitDist === undefined || uiHitDist === Infinity) {
                let didHit = false;
                
                // Backup picking states
                const oldMesh = this._picking._mesh;
                const oldFace = this._picking._pickedFace;
                const oldRLocal2 = this._picking._rLocal2;
                const oldRWorld2 = this._picking._rWorld2;
                const oldPickedVertices = this._picking._pickedVertices;
                const oldPickedNormal = vec3.clone(this._picking._pickedNormal);

                // Option A: Use fast iterative search while hovering (not sculpting)
                const pickingRadius = physicalRadius * invScale;
                const originTipEngine = vec3.clone(tipPhys);
                if (this._xrWorldOffset) {
                    vec3.transformMat4(originTipEngine, originTipEngine, this._xrWorldOffset.inverse.matrix);
                }
                vec3.scale(originTipEngine, originTipEngine, invScale);

                const app = this._main || this;
                const activeSceneMesh = app.getMesh();
                const targetMeshes = (app._lockSelection && activeSceneMesh) ? [activeSceneMesh] : this._meshes;

                if (this._vrUseVolumeIntersect) {
                    didHit = this._picking.intersectionSphereMeshes(targetMeshes, originTipEngine, pickingRadius);
                } else {
                    didHit = this._picking.intersectionRayMeshes(targetMeshes, originEngine, dirEngine);
                }

                // If the ray origin (controller root) penetrates the mesh, the ray will travel through the interior volume and hit the back wall ("opposite side").
                // To prevent the cursor from jumping to the opposite side, we hide the surface ring if the ray hits a backface.
                if (didHit) {
                    this._picking.computePickedNormal();
                    const nFace = this._picking.getPickedNormal();
                    
                    const pickedMesh = this._picking.getMesh();
                    if (pickedMesh) {
                        const nEngine = vec3.create();
                        const matMesh = pickedMesh.getMatrix();
                        const mat3Mesh = mat3.create();
                        mat3.fromMat4(mat3Mesh, matMesh);
                        vec3.transformMat3(nEngine, nFace, mat3Mesh);
                        vec3.normalize(nEngine, nEngine);

                        // If the normal is facing the same direction as the ray, it's a backface.
                        if (vec3.dot(nEngine, dirEngine) > 0.0) {
                            didHit = false; // Gracefully hide cursor instead of snapping to far side
                        }
                    }
                }

                // if (doLog) // console.log(`[${isLeft?'L':'R'}] didHit: ${didHit} uiH: ${uiHitDist} | origin: ${originEngine.map(x=>x.toFixed(2))} | dir: ${dirEngine.map(x=>x.toFixed(2))}`);

                if (didHit) {
                    pickedMesh = this._picking.getMesh() || this._meshes[0];
                    
                    // distance in engine space
                    const localHit = this._picking.getIntersectionPoint();
                    const engineHit = vec3.create();
                    vec3.transformMat4(engineHit, localHit, pickedMesh.getMatrix());
                    hitDist = vec3.distance(originEngine, engineHit) * (this._vrScale || 1.0);

                    // wInter in Scene Space is just origin + dir * hitDist
                    wInter = vec3.create();
                    vec3.scaleAndAdd(wInter, origin, dir, hitDist);

                    // // if (doLog) console.log(`  hitDist: ${hitDist.toFixed(3)} wInt: ${wInter.map(x=>x.toFixed(2))}`);

                    pNormal = this._picking.computePickedNormal();
                    sceneNormal = vec3.create();
                    
                    if (pNormal && pNormal.length >= 3) {
                        const nMat = mat3.create();
                        mat3.normalFromMat4(nMat, pickedMesh.getMatrix());
                        vec3.transformMat3(sceneNormal, pNormal, nMat); // Now in Engine Space
                        
                        if (this._xrWorldOffset) {
                            const r = this._xrWorldOffset.orientation;
                            const qRot = quat.fromValues(r.x, r.y, r.z, r.w);
                            vec3.transformQuat(sceneNormal, sceneNormal, qRot); // Now in Scene Space
                        }
                        vec3.normalize(sceneNormal, sceneNormal);
                    } else {
                        vec3.set(sceneNormal, 0, 1, 0);
                    }
                }

                // Restore picking states so active hand sculpt isn't polluted by non-dom hand raycast
                this._picking._mesh = oldMesh;
                this._picking._pickedFace = oldFace;
                this._picking._rLocal2 = oldRLocal2;
                this._picking._rWorld2 = oldRWorld2;
                this._picking._pickedVertices = oldPickedVertices;
                vec3.copy(this._picking._pickedNormal, oldPickedNormal);
            } else {
                hitDist = uiHitDist;
            }

            if (pointerLine) {
                if (uiHitDist !== undefined && uiHitDist !== Infinity) {
                    pointerLine.visible = true;
                    pointerLine.scale.set(1, 1, hitDist);
                    // // if (doLog) console.log(`  laser scale_z: ${hitDist.toFixed(2)} [UI VISIBLE]`);
                } else {
                    pointerLine.visible = false;
                }
            }

            if (cursorGroup) {
                // Determine if this is the active sculpting hand
                let isActiveHand = true;
                if (this._activeHandedness) {
                    isActiveHand = (source.handedness === this._activeHandedness);
                } else {
                    // Fallback to right hand if user hasn't squeezed trigger yet
                    isActiveHand = (source.handedness === 'right');
                }

                if (!isActiveHand && !this._vrAmbidextrousCursors) {
                    cursorGroup.visible = false;
                    continue; // Bypass cursor rendering entirely for the offhand, but continue loop!
                }

                const ringLine = cursorGroup.getObjectByName("cursor_ring");
                const volumeSphere = cursorGroup.getObjectByName("volume_sphere");
                const volumeCube = cursorGroup.getObjectByName("volume_cube");

                const isVoxelTool = tool && tool.constructor && tool.constructor.name === 'SculptVoxel';
                const isCubeShape = isVoxelTool && tool._shape === 1;
                const isPicking = tool && tool._pickColor;

                if (volumeSphere) volumeSphere.visible = !isCubeShape && !isPicking;
                if (volumeCube) volumeCube.visible = isCubeShape && !isPicking;
                const activeVol = isCubeShape ? volumeCube : volumeSphere;

                cursorGroup.visible = !window._animPlaying;
                cursorGroup.position.set(0, 0, 0);
                cursorGroup.quaternion.identity();
                cursorGroup.scale.set(1, 1, 1);

                // 1. Position Surface Ring (if hitting mesh)
                if (hitDist !== 5.0 && wInter && pickedMesh && (uiHitDist === undefined || uiHitDist === Infinity)) {
                    // // if (doLog) console.log(`  Mode: SURF, pos: ${wInter[0].toFixed(2)},${wInter[1].toFixed(2)},${wInter[2].toFixed(2)}`);
                    
                    if (ringLine) {
                        ringLine.visible = true;
                        ringLine.position.set(wInter[0], wInter[1], wInter[2]);
                        ringLine.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(sceneNormal[0], sceneNormal[1], sceneNormal[2]));
                        ringLine.scale.set(physicalRadius, physicalRadius, physicalRadius);
                    }
                } else {
                    // // if (doLog) console.log(`  Mode: AIR/UI, hiding surface ring`);
                    if (ringLine) ringLine.visible = false;
                }

                // 2. Position Volume Indicator (Fixed at controller tip)
                if (activeVol && (uiHitDist === undefined || uiHitDist === Infinity)) {
                    activeVol.position.set(tipPhys[0], tipPhys[1], tipPhys[2]);
                    
                    if (isCubeShape && tool._alignToController === false) {
                        activeVol.quaternion.identity(); // World aligned
                    } else {
                        // Inherit Controller Rotation natively (approximating from direction if needed, or simply copy VR controller orientation)
                        const ctrl3D = isLeft ? this._vrControllerLeft : this._vrControllerRight;
                        if (ctrl3D) activeVol.quaternion.copy(ctrl3D.quaternion);
                    }

                    activeVol.scale.set(physicalRadius, physicalRadius, physicalRadius);
                } else if (activeVol) {
                    // Hide volume if pointing at UI menu
                    activeVol.visible = false;
                }

                const toolName = tool ? tool.constructor.name : 'Unknown';
                const isPaint = toolName === 'Paint';
                const intensity = tool && tool._intensity !== undefined ? tool._intensity : 0.5;
                
                // Interpolate from 0.5 (Additive White/Grey) to 1.0 (Pure Color/Saturated) based on intensity
                const base = 0.5;
                const cMax = base + (intensity * (1.0 - base)); // 0.5 -> 1.0
                const cMin = base - (intensity * base);         // 0.5 -> 0.0
                
                const color = new THREE.Color();
                const sampledColor = new THREE.Color();
                let hasSampled = false;

                if (isPicking && pickedMesh && pickedMesh.getColors()) {
                    const tempColor = vec3.create();
                    this._picking.polyLerp(pickedMesh.getColors(), tempColor);
                    
                    // Un-correct Gamma space back to Linear space for Three.js rendering
                    tempColor[0] = Math.pow(tempColor[0], 2.2);
                    tempColor[1] = Math.pow(tempColor[1], 2.2);
                    tempColor[2] = Math.pow(tempColor[2], 2.2);

                    sampledColor.setRGB(tempColor[0], tempColor[1], tempColor[2]);
                    hasSampled = true;
                }

                if (this._vrIsNegative) {
                    color.setRGB(cMax, cMin, cMin); // Red
                } else if (isPaint && tool._color) {
                    const activeLowerColor = this._eyedropperStartColor ? this._eyedropperStartColor : tool._color;
                    color.setRGB(activeLowerColor[0], activeLowerColor[1], activeLowerColor[2]);
                } else {
                    color.setRGB(cMin, cMin, cMax); // Blue
                }

                if (volumeSphere) volumeSphere.material.uniforms.color.value.copy(color);
                if (volumeCube) volumeCube.material.uniforms.color.value.copy(color);
                
                if (ringLine) {
                    if (ringLine.isGroup) {
                        const topArc = ringLine.getObjectByName("top");
                        const bottomLArc = ringLine.getObjectByName("bottom_left");
                        const bottomRArc = ringLine.getObjectByName("bottom_right");
                        
                        // Active FG color (uses tool._oldColor captured when eyedropper was enabled)
                        const activeLowerLeftColor = tool._oldColor ? tool._oldColor : (tool._color ? tool._color : [color.r, color.g, color.b]);
                        const activeLowerRightColor = tool._colorSecondary ? tool._colorSecondary : (tool._color ? tool._color : [color.r, color.g, color.b]); // Fallback to primary or cursor color
                        
                        if (hasSampled) {
                            if (topArc && topArc.material) topArc.material.color.copy(sampledColor);
                            if (bottomLArc && bottomLArc.material) bottomLArc.material.color.setRGB(activeLowerLeftColor[0], activeLowerLeftColor[1], activeLowerLeftColor[2]);
                            if (bottomRArc && bottomRArc.material) bottomRArc.material.color.setRGB(activeLowerRightColor[0], activeLowerRightColor[1], activeLowerRightColor[2]);
                        } else {
                            if (topArc && topArc.material) topArc.material.color.copy(color);
                            if (bottomLArc && bottomLArc.material) bottomLArc.material.color.copy(color);
                            if (bottomRArc && bottomRArc.material) bottomRArc.material.color.setRGB(activeLowerRightColor[0], activeLowerRightColor[1], activeLowerRightColor[2]);
                        }
                    } else if (ringLine.material) {
                        ringLine.material.color.copy(hasSampled ? sampledColor : color);
                    }
                }
            } else if (cursorGroup) {
                cursorGroup.visible = false;
                // if (doLog) console.log(`  cursorGroup HIDDEN! cursorGroup missing?`);
            }
        }
    } catch (e) {
        console.log(`[CurErr] ${e.message}`);
        console.error('[SculptXR] Cursor Update Error', e);
    }
  }

  reloadControllerModels() {
    // console.log(`[SculptGL] reloadControllerModels executing!`);
    if (!this._renderer || !this._renderer.xr) {
        // console.log(`[SculptGL] reloadControllerModels: No renderer/xr context!`);
        return;
    }
    for (let i = 0; i < 2; i++) {
      const grip = this._renderer.xr.getControllerGrip(i);
      const baseSource = grip._originalInputSource || grip._inputSource;
      // console.log(`[SculptGL] Reloading controller [${i}], baseSource present: ${!!baseSource}`);
      if (grip && baseSource) {
        if (window.screenLog) window.screenLog(`[XR] Reloading controller [${i}]`, "orange");

        const override = window._xrControllerOverride;
        // console.log(`[SculptGL] Current override: ${override}`);
        if (override && override !== 'Auto') {
            const proxySource = new Proxy(baseSource, {
                get: function(target, prop) {
                    if (prop === 'profiles') {
                        // console.log(`[SculptGL] Proxy (reload): Overriding to [${override}]`);
                        // if (window.screenLog) window.screenLog(`[Proxy] Overriding to [${override}]`, "orange");
                        return [override];
                    }
                    const value = target[prop];
                    return typeof value === 'function' ? value.bind(target) : value;
                }
            });
            grip._inputSource = proxySource;
        } else {
            grip._inputSource = baseSource;
        }

        // Remove old models
        let removedCount = 0;
        grip.children.forEach(child => {
          if (child.isGroup && (child.name.includes('controller') || child.motionController)) {
            grip.remove(child);
            removedCount++;
          }
        });
        // console.log(`[SculptGL] Removed ${removedCount} old models/groups for controller [${i}]`);
        
        // Remove generic placeholders
        let placeholderCount = 0;
        grip.children.forEach(child => {
            if (child.isPlaceholder) {
                grip.remove(child);
                placeholderCount++;
            }
        });
        // console.log(`[SculptGL] Removed ${placeholderCount} generic placeholders for controller [${i}]`);

        // Re-create model
        // console.log(`[SculptGL] Re-creating model for controller [${i}]`);
        const model = this._controllerModelFactory.createControllerModel(grip);
        grip.add(model);

        // Re-fire connected event
        // console.log(`[SculptGL] Re-firing 'connected' event for controller [${i}]`);
        const event = new Event('connected');
        Object.defineProperty(event, 'data', { value: grip._inputSource });
        grip.dispatchEvent(event);
      } else {
        // console.log(`[SculptGL] Controller [${i}] or baseSource missing. Skipping reload.`);
      }
    }
  }
}
window._reloadControllerModels = function() {
    // console.log(`[SculptGL] reloadControllerModels executing (global via utils)!`);
    if (!this._renderer || !this._renderer.xr) {
        // console.log(`[SculptGL] reloadControllerModels: No renderer/xr context!`);
        return;
    }
    for (let i = 0; i < 2; i++) {
      const grip = this._renderer.xr.getControllerGrip(i);
      const baseSource = grip._originalInputSource || grip._inputSource;
      // console.log(`[SculptGL] Reloading controller [${i}], baseSource present: ${!!baseSource}`);
      if (grip && baseSource) {
        if (window.screenLog) window.screenLog(`[XR] Reloading controller [${i}]`, "orange");

        const override = window._xrControllerOverride;
        // console.log(`[SculptGL] Current override: ${override}`);
        
        // Always generate a fresh proxy if override is active!
        if (override && override !== 'Auto') {
            const proxySource = new Proxy(baseSource, {
                get: function(target, prop) {
                    if (prop === 'profiles') {
                        // console.log(`[SculptGL] Proxy (reload): Overriding to [${override}]`);
                        // if (window.screenLog) window.screenLog(`[Proxy] Overriding to [${override}]`, "orange");
                        return [override];
                    }
                    const value = target[prop];
                    return typeof value === 'function' ? value.bind(target) : value;
                }
            });
            grip._inputSource = proxySource;
        } else {
            grip._inputSource = baseSource; // Reset to original!
        }

        const activeSource = grip._inputSource; // This is the proxy or original!

        // Clear Grip children
        let removedCount = 0;
        while (grip.children.length > 0) {
            const child = grip.children[0];
            // console.log(`[SculptGL] Removing child: name=${child.name}, type=${child.type}`);
            grip.remove(child);
            removedCount++;
        }
        // console.log(`[SculptGL] Removed ${removedCount} children from controller [${i}]`);

        // Manual reload logic avoiding EventDispatcher
        const factory = this._controllerModelFactory;
        const utils = window._XRControllerModelFactory_utils;

        if (utils && utils.fetchProfile) {
            // console.log(`[SculptGL] Invoking fetchProfile directly for profile overwrite...`);
            utils.fetchProfile(activeSource, factory.path, 'generic-trigger').then( ({ profile, assetPath }) => {
                // console.log(`[SculptGL] fetchProfile resolved: ${profile.profileId}, Asset: ${assetPath}`);
                // if (window.screenLog) window.screenLog(`[Profile] Resolved: ${profile.profileId}`, "cyan");

                const controllerModel = new utils.XRControllerModel();
                controllerModel.motionController = new utils.MotionController(activeSource, profile, assetPath);

                const cachedAsset = factory._assetCache[ controllerModel.motionController.assetUrl ];
                if (cachedAsset) {
                    // console.log(`[SculptGL] Asset found in cache: ${controllerModel.motionController.assetUrl}`);
                    const scene = cachedAsset.scene.clone();
                    utils.addAssetSceneToControllerModel( controllerModel, scene );
                    grip.add(controllerModel);
                    if (factory.onLoad) factory.onLoad( scene );
                    if (this._main && this._main.render) this._main.render();
                } else {
                    if (!factory.gltfLoader) throw new Error('GLTFLoader missing.');
                    factory.gltfLoader.setPath('');
                    // console.log(`[SculptGL] Fetching network asset: ${controllerModel.motionController.assetUrl}`);
                    // if (window.screenLog) window.screenLog(`[GLTF] Loading: ${controllerModel.motionController.assetUrl}`, "yellow");
                    factory.gltfLoader.load(controllerModel.motionController.assetUrl, (asset) => {
                        // console.log(`[SculptGL] GLTF Loaded: ${controllerModel.motionController.assetUrl}`);
                        factory._assetCache[ controllerModel.motionController.assetUrl ] = asset;
                        const scene = asset.scene.clone();
                        utils.addAssetSceneToControllerModel( controllerModel, scene );
                        grip.add(controllerModel);
                        if (factory.onLoad) factory.onLoad( scene );
                        if (this._main && this._main.render) this._main.render();
                    }, null, (err) => {
                        console.error(`[SculptGL] Reload Asset Load Failed: ${err.message}`);
                    });
                }
            }).catch( (err) => {
                console.error(`[SculptGL] Error in direct fetchProfile: ${err.message}`);
            });
        } else {
            console.error(`[SculptGL] _XRControllerModelFactory_utils missing!`);
        }
      } else {
        // console.log(`[SculptGL] Controller [${i}] or baseSource missing. Skipping reload.`);
      }
    }
  };

Scene.prototype.reloadControllerModels = window._reloadControllerModels;

// console.log(`[SculptGL] Scene.prototype.reloadControllerModels attached: true`);

export default Scene;
