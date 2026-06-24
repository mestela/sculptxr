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
import './editing/Geodesic.js'; // registers window._geoViz test harness; posing/rigging uses computeGeodesicField
import VRMenu from './drawables/VRMenu.js';
import VRLaser from './drawables/VRLaser.js';
import GazeTooltip from './drawables/GazeTooltip.js';
// [HTMLVRPanel] rAF intercept + polyfill installed as a side-effect of this import.
// Must appear before any three-html-render usage.
import { drainRAF } from './gui/htmlvr/install.js';
import { registerGradeMaterial } from './gui/htmlvr/HTMLVRPanel.js';
import { BrushPanel             } from './gui/htmlvr/BrushPanel.js';
import { MiniPanel              } from './gui/htmlvr/MiniPanel.js';
import { ToolPickerPanel        } from './gui/htmlvr/ToolPickerPanel.js';
import { MainMenuPanel          } from './gui/htmlvr/MainMenuPanel.js';
import { TornOffPanel           } from './gui/htmlvr/TornOffPanel.js';
import { FilesPanel, openFilesDOMOverlay, openBrowserSavesDOMOverlay } from './gui/htmlvr/FilesPanel.js';
import { AnimationControlPanel  } from './gui/htmlvr/AnimationControlPanel.js';
import BlendshapeStackPanel from './gui/BlendshapeStackPanel.js';
import { VrNumpad               } from './gui/htmlvr/VrNumpad.js';
import { VrConfirm              } from './gui/htmlvr/VrConfirm.js';

// Scratch vector reused by panel grip-drag code — avoids per-frame allocation.
const _v3tmp = new THREE.Vector3();
// Up vector for the look-at constraint.
const _SXR_UP = new THREE.Vector3(0, 1, 0);

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

    // Desktop canvas mode while VR is active.
    // 0=blank  1=mirror  2=desktop free camera
    // PC VR: default to spectator (rotation-coupled) — stable desktop view that
    // tracks which face of the sculpt the VR user is working on.
    // Standalone (mobile): blank to conserve the mobile GPU.
    this._spectatorViewMode = this._isQuestStandalone ? 0 : 3;

    // How many VR frames to skip between spectator renders.
    // 0=every frame, 1=every 2nd, 3=every 4th, 7=every 8th.
    // PC VR: full rate (desktop GPU has headroom). Standalone: every 4th.
    this._spectatorFrameSkip = this._isQuestStandalone ? 3 : 0;

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

    // Desktop spectator view control — usable from the browser console:
    //   window.setSpectatorMode(0)  → blank canvas (default)
    //   window.setSpectatorMode(1)  → mirror left eye to desktop canvas (~18fps throttled)
    //   window.setSpectatorMode(2)  → desktop free camera on canvas (~18fps throttled)
    window.setSpectatorMode = (n) => {
      this._spectatorViewMode = n;
      const names = ['blank', 'mirror', 'desktop free camera', 'spectator (rotation-coupled)'];
      console.log(`[Spectator] mode → ${names[n] ?? n}`);
    };

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
    this._brushPanel      = null;   // [HTMLVRPanel] new HTML-based tools panel
    this._miniPanel       = null;   // [HTMLVRPanel] compact wrist HUD (replaces legacy canvas MiniHUD)
    this._toolPickerPanel = null;   // [HTMLVRPanel] tool-selection overlay
    this._mainMenuPanel   = null;   // [HTMLVRPanel] main menu (replaces GuiXR + VRMenu)
    this._tornOffPanels   = new Map(); // sectionId → TornOffPanel
    this._filesPanel      = null;   // [HTMLVRPanel] floating Files overlay
    this._animPanel       = null;   // [HTMLVRPanel] animation transport + keyframe controls
    this._vrNumpad        = null;   // [HTMLVRPanel] floating number-pad for VR value editing
    this._vrTimelineMesh    = null;   // Three.js Mesh — GuiTimeline canvas rendered into VR
    this._vrTimelineTexture = null;   // THREE.CanvasTexture wrapping GuiTimeline._canvas
    this._vrBlendMesh       = null;   // Three.js Mesh — BlendshapeStackPanel canvas in VR
    this._vrBlendTexture    = null;   // THREE.CanvasTexture wrapping the VR blend canvas
    this._vrBlendPanel      = null;   // VR BlendshapeStackPanel instance
    this._vbsWasPressed     = false;  // dominant-hand trigger latch for the blend panel
    this._vbsIsPointing     = false;  // dominant hand currently aims at the blend panel
    this._vbsDragActive     = false;  // grip-drag (move) in progress
    this._vbsDragHand       = null;
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

    // Init FilesPanel early — same timing as AnimationControlPanel below.
    setTimeout(() => {
      try {
        if (!this._filesPanel && this._scene && this._renderer) {
          this._filesPanel = new FilesPanel();
          this._filesPanel.init(this._scene, this._camera.getThreeCamera(), this._renderer);
          this._filesPanel.bindDesktopPointers(this._renderer, this._camera.getThreeCamera());
          this._filesPanel._element.addEventListener('fp-close', () => {});
          window.openFilesPanel   = () => this._openFilesPanel();
          window.openBrowserSaves = () => openBrowserSavesDOMOverlay(this);
          window.openFilesMenu    = () => openFilesDOMOverlay(this);
          if (window.screenLog) window.screenLog('[HTMLVRPanel] FilesPanel created', 'cyan');
        }
      } catch (err) {
        console.error('[FilesPanel] init failed:', err);
      }
    }, 500);

    // Wire vtl-show event unconditionally — independent of AnimPanel creation timing.
    // The AnimPanel dispatches this when "Show Timeline" is toggled in VR mode.
    document.addEventListener('vtl-show', (e) => {
      if (window.screenLog) window.screenLog(`[VR Timeline] vtl-show received show=${e.detail?.show}`, 'yellow');
      try {
        if (e.detail?.show) this._openVRTimeline();
        else this._closeVRTimeline();
      } catch (err) {
        if (window.screenLog) window.screenLog(`[VR Timeline] listener err: ${err?.message}`, 'red');
        console.error('[VR Timeline] vtl-show handler error:', err);
      }
    });
    window.openVRTimeline  = () => this._openVRTimeline();
    window.closeVRTimeline = () => this._closeVRTimeline();

    // Blendshape layer-stack panel toggle (canvas → texture mesh in VR).
    document.addEventListener('vbs-show', (e) => {
      try {
        if (e.detail?.show) this._openVRBlendshapes();
        else this._closeVRBlendshapes();
      } catch (err) {
        if (window.screenLog) window.screenLog(`[VR Blendshapes] vbs-show err: ${err?.message}`, 'red');
        console.error('[VR Blendshapes] vbs-show handler error:', err);
      }
    });
    window.openVRBlendshapes  = () => this._openVRBlendshapes();
    window.closeVRBlendshapes = () => this._closeVRBlendshapes();

    // [Eye rig Phase 0/1] Parent one mesh under another (or null → back to worldGroup),
    // preserving its world position. THREE.attach() recomputes the local matrix to keep
    // the world transform; we copy that local back into SculptXR's _matrix (the source
    // of truth the render sync reads). Picking is parent-aware via getModelSpaceMatrix().
    //   window.setMeshParent(childId, parentId|null)  — delegates to the method.
    window.setMeshParent = (childId, parentId) => {
      this.setMeshParent(childId, parentId);
      console.log(`[parent] mesh ${childId} → ${parentId == null ? 'worldGroup' : 'mesh ' + parentId}`);
    };

    // [Eye rig Phase 1] Create a null/locator and select it. window.addNull()
    window.addNull = () => { const n = this.addNull(); console.log('[null] created id', n.getID()); return n.getID(); };

    // [Eye rig Phase 1] Look-at constraint: make a mesh aim its local -Z at a target.
    //   window.setLookAt(eyeId, targetId)   window.clearLookAt(eyeId)
    window.setLookAt = (eyeId, targetId) => {
      this.setLookAt(eyeId, targetId);
      console.log(`[lookAt] mesh ${eyeId} → target ${targetId}`);
    };
    window.clearLookAt = (eyeId) => this.clearLookAt(eyeId);

    // [Eye rig Phase 1] Live mirror across X=0. window.mirrorMesh(sourceId)
    window.mirrorMesh = (sourceId) => this.mirrorMesh(sourceId);

    // [Eye rig Phase 1] Procedural saccades on a look-at eye.
    //   window.saccades(eyeId, true/false, amplitude?)
    window.saccades = (eyeId, on = true, amp) => {
      this.setSaccades(eyeId, on, amp);
      console.log(`[saccades] mesh ${eyeId} → ${on}${amp != null ? ' amp ' + amp : ''}`);
    };

    // Init AnimationControlPanel early — scene/renderer guaranteed ready after initWebGL.
    // Using a short timeout so the DOM is settled before the polyfill host canvas is created.
    setTimeout(() => {
      try {
        if (!this._animPanel && this._scene && this._renderer) {
          this._animPanel = new AnimationControlPanel(this, this._scene, this._camera.getThreeCamera(), this._renderer);
          this._animPanel.bindDesktopPointers(this._renderer, this._camera.getThreeCamera());
          window._animPanel = this._animPanel; // expose for console debugging
          console.log('[AnimPanel] created');
          if (!window.toggleAnimPanel) {
            window.toggleAnimPanel = () => {
              const tabGroup = document.querySelector('.sidebar-tab-group');
              tabGroup?.show?.('animation');
              this._animPanel?.syncFromState();
            };
          }
          if (!window._animPanelKeyBound) {
            window._animPanelKeyBound = true;
            window.addEventListener('keydown', (e) => {
              if (e.key === 'n' && !e.ctrlKey && !e.metaKey && !e.shiftKey) window.toggleAnimPanel?.();
            });
          }
        }
      } catch (err) {
        console.error('[AnimPanel] init failed:', err);
      }

      // Init VrNumpad early so it's available for desktop click handlers.
      try {
        if (!this._vrNumpad && this._scene && this._renderer) {
          this._vrNumpad = new VrNumpad(this._scene, this._camera.getThreeCamera(), this._renderer);
          window._vrNumpad = this._vrNumpad;
        }
        if (!this._vrConfirm && this._scene && this._renderer) {
          this._vrConfirm = new VrConfirm(this._scene, this._camera.getThreeCamera(), this._renderer, this);
          window._vrConfirmPanel = this._vrConfirm;
        }
      } catch (err) {
        console.error('[VrNumpad] early init failed:', err);
      }
    }, 500);

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
    if (modelURL) {
      this.addModelURL(modelURL); // async — resets the undo stack itself via loadScene()
    } else {
      this.addSphere(); // Return default mesh to multires sculpting sphere
      // The startup mesh must not be undoable: undoing it empties the scene and
      // breaks sculpting (no mesh → no BVH). Clear the stack so it's the baseline,
      // mirroring loadScene() which resets after loading.
      this.getStateManager().reset();
    }

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

  getReferenceManager() {
    return this._referenceManager;
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

  // Canonical undo/redo — ends any in-progress stroke, applies the state, then
  // re-renders and refreshes the GUI. Single source of truth for the keyboard
  // shortcut, the on-screen buttons, and the iPad multi-finger-tap gesture
  // (which previously called _stateManager directly and skipped the refresh).
  undo() {
    this.getSculptManager?.()?.end?.();
    this.getStateManager().undo();
    this.render?.();
    this.getGui?.()?.updateMesh?.();
  }

  redo() {
    this.getStateManager().redo();
    this.render?.();
    this.getGui?.()?.updateMesh?.();
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
      if (!this._htmlPanelsHidden) {
        if (this._guiXR) this._guiXR.update();
        if (this._guiMini) this._guiMini.update();
        if (this._guiPopup) this._guiPopup.update();
      }

      // [HTMLVRPanel] Mark dirty panels, then drain once for all of them.
      // Skipped entirely when Y-button hide is active so the polyfill does
      // no rasterisation work and we can isolate its frame cost.
      if (!this._htmlPanelsHidden) {
        if (this._brushPanel) {
          try { this._brushPanel.update(true); } catch (e) {
            console.warn('[HTMLVRPanel] BrushPanel update error:', e);
          }
        }
        if (this._miniPanel) {
          try { this._miniPanel.update(true); } catch (_) {}
        }
        if (this._toolPickerPanel) {
          try { this._toolPickerPanel.update(true); } catch (_) {}
        }
        if (this._mainMenuPanel) {
          try { this._mainMenuPanel.update(true); } catch (_) {}
        }
        if (this._tornOffPanels.size > 0) {
          this._tornOffPanels.forEach(p => {
            try { p.update(true); } catch (_) {}
            if (p._pendingPlace && p.mesh) {
              p._pendingPlace();
              p._pendingPlace = null;
            }
          });
        }
        if (this._filesPanel) {
          try { this._filesPanel.update(true); } catch (_) {}
        }
        if (this._animPanel) {
          try {
            this._animPanel.update(true);
            this._animPanel.syncFromState();
          } catch (_) {}
        }
        if (this._vrNumpad?.mesh) {
          // Always call update() so the numpad unmounts itself from the host
          // canvas while closed (otherwise it keeps getting re-rasterised).
          try { this._vrNumpad.update(true); } catch (_) {}
          if (this._vrNumpad.mesh.visible) {
            // Keep numpad glued to its source panel (important when that panel
            // is moving with a VR controller — re-parenting to the controller
            // group caused orientation bugs with negative-scale decomposition,
            // so instead we update the world-space position every frame here.
            try { this._vrNumpad._repositionIfTracking(); } catch (_) {}
          }
        }
        if (this._vrConfirm?.mesh) {
          // Same as the numpad: update() unmounts it from the host canvas while
          // closed so it isn't re-rasterised every paint.
          try { this._vrConfirm.update(true); } catch (_) {}
          if (this._vrConfirm.mesh.visible) {
            // Follow the anchor panel (which may be attached to a moving controller).
            try { this._vrConfirm._repositionIfTracking(); } catch (_) {}
          }
        }
        // Single drain: executes the one requestPaint callback queued above.
        drainRAF();
      }
      // Keep the VR timeline texture fresh — GuiTimeline.draw() runs in its own rAF loop.
      if (this._vrBlendMesh?.visible && this._vrBlendTexture) {
        this._vrBlendTexture.needsUpdate = true;
      }
      if (this._vrTimelineMesh?.visible && this._vrTimelineTexture) {
        this._vrTimelineTexture.needsUpdate = true;
        // Keep resize handle anchored to bottom-right corner as mesh moves/scales.
        if (this._vrResizeHandle) {
          const tl = this._vrTimelineMesh;
          const hw = tl.geometry.parameters.width  * 0.5;
          const hh = tl.geometry.parameters.height * 0.5;
          this._vrResizeHandle.position.copy(tl.position)
            .add(new THREE.Vector3(hw - 0.014, -hh + 0.014, 0.002).applyQuaternion(tl.quaternion));
          // Coplanar with timeline — inherit its orientation so the flat icon faces forward.
          this._vrResizeHandle.quaternion.copy(tl.quaternion);
          this._vrResizeHandle.visible = true;
        }
      } else if (this._vrResizeHandle?.visible) {
        this._vrResizeHandle.visible = false;
      }
      // Close-button hover highlights (brighten + grow while pointed at).
      this._applyCloseBtnHover(this._vrTimelineCloseBtn, '_vtlClosePointed');
      this._applyCloseBtnHover(this._vrBlendCloseBtn, '_vbsClosePointed');
      // Clear the blendshape panel's row hover when the ray isn't on it this frame.
      if (this._vrBlendPanel && !this._vbsPanelPointed) this._vrBlendPanel.clearHover();
      this._vbsPanelPointed = false;

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

    // [HTMLVRPanel] Desktop texture updates — only needed when NOT in XR.
    // In XR the panel updates run inside the isPresenting block above.
    // On desktop, requestPaint() fires via natural window.rAF (no drainRAF needed).
    if (!(this._renderer && this._renderer.xr && this._renderer.xr.isPresenting)) {
      if (this._animPanel?.mesh?.visible) {
        try {
          this._animPanel.update(false);
          this._animPanel.syncFromState();
          this._drawFullScene = true; // keep rendering while panel is visible
        } catch (_) {}
      }
      if (this._filesPanel?.mesh?.visible) {
        try {
          this._filesPanel.update(false);
          this._drawFullScene = true;
        } catch (_) {}
      }
      if (this._vrBlendMesh?.visible && this._vrBlendTexture) {
        this._vrBlendTexture.needsUpdate = true;
      }
      if (this._vrTimelineMesh?.visible && this._vrTimelineTexture) {
        this._vrTimelineTexture.needsUpdate = true;
        this._drawFullScene = true;
      }
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

    // In VR, _updateVRCursors positions + shows these per-hand. On desktop they're
    // never positioned, so they'd just sit (full size) at the world origin — the
    // blue xray sphere that flashed at startup before the sculpt rendered over it.
    // Keep them hidden on desktop.
    const isVRPresenting = this._renderer && this._renderer.xr && this._renderer.xr.isPresenting;
    if (!isVRPresenting) {
      if (this._vrCursorLeft) this._vrCursorLeft.visible = false;
      if (this._vrCursorRight) this._vrCursorRight.visible = false;
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

      // Eye-rig constraints (look-at) — applied each frame before render.
      this._evaluateConstraints();

      // The desktop transform gizmo (Gizmo.js) must never render in VR. Its visible
      // flag is sticky from desktop (set in the desktop-only postRender), and no VR
      // hook reliably hides it, so it lingers as a ghost gizmo overlapping the VR one.
      // Force it hidden every VR frame, right before the render. (TransformVR's own
      // GizmoVR group is separate and is shown when that tool is active.)
      if (isVR && this._sculptManager) {
        const _gT = this._sculptManager.getTool?.(Enums.Tools.TRANSFORM)?._gizmo?._group;
        if (_gT && _gT.visible) _gT.visible = false;
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

          // ── Desktop spectator pass ────────────────────────────────────────────
          // Capture XR camera matrices NOW (while xr is still enabled + frame active)
          // so MIRROR mode can reuse them without re-entering the XR path.
          //
          // We use the ArrayCamera's own matrixWorld (headset centre pose) rather
          // than cameras[0] (left eye with IPD offset). The left-eye pose places the
          // virtual camera ~3 cm to the left of the headset centre, which pushes the
          // scene noticeably off-centre on the desktop display.  The ArrayCamera gives
          // a better-framed "what the user is looking at" view.
          // For the projection we still take the left-eye matrix (it has a realistic
          // single-eye FOV), then rebuild it for the canvas aspect anyway.
          const xrArrayCam = this._renderer.xr.getCamera(this._camera.getThreeCamera());
          if (xrArrayCam) {
            if (!this._spectatorLeftEyeMatrix) this._spectatorLeftEyeMatrix = new THREE.Matrix4();
            if (!this._spectatorLeftEyeProj)   this._spectatorLeftEyeProj   = new THREE.Matrix4();
            // Headset centre pose (no IPD offset — gives centred desktop view)
            this._spectatorLeftEyeMatrix.copy(xrArrayCam.matrixWorld);
            // Per-eye projection for realistic FOV extraction (left eye if available)
            const eyeCam = xrArrayCam.cameras?.[0] ?? xrArrayCam;
            this._spectatorLeftEyeProj.copy(eyeCam.projectionMatrix);
          }
          this._renderSpectatorCanvas();
          // ─────────────────────────────────────────────────────────────────────

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

    // Keep the outliner transform fields in sync with live manipulation (gizmo/grab),
    // throttled to every few frames to avoid per-frame DOM churn.
    this._xfSyncTick = (this._xfSyncTick || 0) + 1;
    if (this._xfSyncTick % 4 === 0) this._syncOutlinerTransformFields();
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
      (window._vrAlert || window.alert)('Values: WebGL context could not be retrieved.');
      return;
    }

    // Initialize Three.js Scene Components
    this._scene = new THREE.Scene();
    // Apply the default background (grey, or a previously-loaded image) now that the
    // three.js scene exists. Background was constructed earlier (no scene yet).
    if (this._background && this._background._applyBackground) this._background._applyBackground();

    // WebXR offset tracking container: WebXR forces physical poses relative to the `Scene` root.
    // If we want the mesh to be down in front of the user (like on a desk), we put meshes in a _worldGroup
    // and move/scale the _worldGroup, while the headset roams the root scene freely.
    this._worldGroup = new THREE.Group();
    this._worldGroup.position.set(0, 0, 0);
    this._worldGroup.quaternion.set(0, 0, 0, 1);
    this._worldGroup.scale.set(0.701, 0.701, 0.701);
    this._scene.add(this._worldGroup);
    // Exposed for Mesh.getModelSpaceMatrix() — picking composes the parent chain
    // relative to this group (meshes live under it).
    window._sxrWorldGroup = this._worldGroup;
    
    // Add basic lighting since we are using MeshStandardMaterial
    this._scene.add(new THREE.AmbientLight(0x404040, 2.0)); // soft white light
    var dirLight = new THREE.DirectionalLight(0xffffff, 2.0);
    dirLight.position.set(1, 1, 1);
    this._scene.add(dirLight);

    // Localized Geometry Base Grid (100 units wide, 25 divisions for massive 4-meter visual blocks)
    this._groundGrid = new THREE.GridHelper(100, 25, 0x888888, 0x444444);
    this._groundGrid.material.transparent = true;
    this._groundGrid.material.opacity = getOptionsURL().gridOpacity ?? 0.5;
    this._groundGrid.material.depthWrite = true;  // must write depth so grid composites correctly in VR
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
    
    // Force viewport to fill the area excluding top bar and sidebar.
    // Read sidebar width dynamically so resize drag stays in sync.
    const sidebarEl = document.getElementById('gui-sidebar');
    const sidebarW = sidebarEl ? sidebarEl.offsetWidth : 380;
    viewport.style.position = 'absolute';
    viewport.style.top = '36px';
    viewport.style.bottom = '0px';
    viewport.style.left = '0px';
    viewport.style.right = sidebarW + 'px';

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

  // [Eye rig Phase 1] A NULL / locator — a transform-only node (look-at target,
  // group parent). Implemented as a small non-sculptable locator mesh so it slots
  // into the existing selection / gizmo / outliner / transform-animation machinery
  // for free. isPickable=false makes the sculpt brush skip it (Picking.js:294) while
  // VR ray-select still picks it (Picking.js:229 ignores isPickable). Not a true
  // geometry-less node yet — fine for the rig; can be refined later.
  addNull() {
    // Pick/transform target: a tiny sphere (kept small so it's just a centre dot).
    var mesh = new Multimesh(Primitives.createSphere(this._gl, 0.5, 8, 8));
    mesh.normalizeSize();
    mat4.scale(mesh.getMatrix(), mesh.getMatrix(), [0.03, 0.03, 0.03]);
    mesh.setShaderType(Enums.Shader.FLAT);
    mesh._typeName    = "Null";
    mesh._isNull      = true;   // transform-only locator (rig nodes look for this)
    mesh.isPickable   = false;  // sculpt brush skips it; still VR-ray-selectable
    this.addNewMesh(mesh);

    // Standard null look: a 3D line cruciform (X/Y/Z) parented to the locator's
    // threeMesh, so it rides the transform. cross.scale enlarges it relative to the
    // tiny pick dot (dot ≈0.015, cross half-length ≈0.12 world).
    const tm = mesh.getThreeMesh();
    if (tm) {
      // The pick-sphere is only for ray-selection/transform (lines aren't
      // ray-pickable). Render it invisibly — a private no-draw material (colorWrite
      // off), so no centre dot and no effect on shared materials. CPU pick is
      // unaffected (it uses the mesh geometry, not the material).
      tm.material = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });

      // The visible null: a 3D line cruciform (X/Y/Z), child of the locator's
      // threeMesh so it rides the transform. cross.scale sets the world half-length.
      const pts = new Float32Array([-1,0,0, 1,0,0,  0,-1,0, 0,1,0,  0,0,-1, 0,0,1]);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
      const cross = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x66e0ff, depthWrite: false }));
      cross.name = 'null_cruciform';
      cross.frustumCulled = false;
      cross.scale.setScalar(4);
      tm.add(cross);
    }
    return mesh;
  }

  // [Eye rig Phase 1] Look-at constraint pass — runs every frame before render. For
  // each mesh carrying `_lookAtTargetId`, aim its local -Z at the target's position
  // (keeping its own position + scale). Works in MODEL space so parented eyes (under
  // a mirror group) aim correctly; writes back via setModelSpaceMatrix.
  // Up reference for a look-at eye: the PARENT (head) local +Y in model space, so the
  // eye rolls WITH the head when it tilts. World up only when the eye has no parent.
  _constraintUp(mesh) {
    const p = mesh._parentMesh;
    if (!p) return _SXR_UP;
    const pm = p.getModelSpaceMatrix();
    const up = new THREE.Vector3(pm[4], pm[5], pm[6]);
    return up.lengthSq() > 1e-12 ? up.normalize() : _SXR_UP;
  }

  _evaluateConstraints() {
    const ms = this._meshes;
    if (!ms || ms.length === 0) return;
    const now = performance.now();
    for (let i = 0; i < ms.length; i++) {
      const m = ms[i];
      const tid = m._lookAtTargetId;
      const hasAim = (tid != null);
      if (!hasAim && !m._saccades) continue; // nothing drives this mesh

      const em = m.getModelSpaceMatrix();
      const P = new THREE.Vector3(em[12], em[13], em[14]);
      const scale = Math.hypot(em[0], em[1], em[2]) || 1;

      // Advance the saccade offset on its timer (shared by both modes): a fast flick
      // with a hold, every (150–650ms)/speed. Toggle via m._saccades.
      if (m._saccades) {
        if (!m._sacNext || now > m._sacNext) {
          const a = (m._saccadeAmp ?? 5);
          const spd = (m._saccadeSpeed ?? 1); // higher → darts more often
          m._sacOff = new THREE.Vector3((Math.random() - 0.5) * a, (Math.random() - 0.5) * a, 0);
          m._sacNext = now + (150 + Math.random() * 500) / spd;
        }
      } else {
        m._sacOff = null;
      }

      if (hasAim) {
        const target = ms.find((x) => x.getID() === tid);
        if (!target || target === m) continue;
        const tm = target.getModelSpaceMatrix();
        const T = new THREE.Vector3(tm[12], tm[13], tm[14]);
        if (m._sacOff) T.add(m._sacOff); // saccade jitters the aim point
        if (P.distanceToSquared(T) < 1e-10) continue;
        // Aim the eye's +Z at the target (negated axis — THREE's lookAt points -Z).
        const _dir = new THREE.Vector3().subVectors(T, P).normalize();
        const _awayTarget = new THREE.Vector3().copy(P).sub(_dir);
        const lookM = new THREE.Matrix4().lookAt(P, _awayTarget, this._constraintUp(m));
        const q = new THREE.Quaternion().setFromRotationMatrix(lookM);
        const out = new THREE.Matrix4().compose(P, q, new THREE.Vector3(scale, scale, scale));
        m.setModelSpaceMatrix(out.elements);
      } else {
        // Saccade WITHOUT an aim: jitter the eye's REST orientation by a small random
        // yaw/pitch (offset components read as degrees). Rest captured once here and
        // restored + cleared on disable (in setSaccades) so the eye returns to rest.
        if (!m._sacRestQuat) {
          // decompose (NOT setFromRotationMatrix) so the model-space scale is removed
          // — otherwise a scaled matrix yields a non-unit quat that compose() squares
          // into a huge scale.
          const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
          new THREE.Matrix4().fromArray(em).decompose(_p, _q, _s);
          m._sacRestQuat = _q;
        }
        const q = m._sacRestQuat.clone();
        if (m._sacOff) {
          const e = new THREE.Euler(m._sacOff.y * Math.PI / 180, m._sacOff.x * Math.PI / 180, 0, 'YXZ');
          q.multiply(new THREE.Quaternion().setFromEuler(e));
        }
        const out = new THREE.Matrix4().compose(P, q, new THREE.Vector3(scale, scale, scale));
        m.setModelSpaceMatrix(out.elements);
      }
    }

    // Mirror instances (live): POSITIONAL mirror across X=0 (negate position.x), but
    // the mirror eye computes its OWN aim at the source's look-at target rather than
    // copying the source's rotation. So a near null makes the pair cross-eyed and a
    // far null makes them parallel — real convergence. (No look-at on the source →
    // fall back to copying its orientation.) Geometry is shared, so sculpting the
    // source updates the mirror for free.
    if (this._mirrors && this._mirrors.length) {
      for (let i = 0; i < this._mirrors.length; i++) {
        const mir = this._mirrors[i];
        const src = ms.find((x) => x.getID() === mir.sourceId);
        if (!src || !mir.mesh) continue;
        const sm = src.getModelSpaceMatrix();
        const M = new THREE.Matrix4().fromArray(sm);
        const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
        M.decompose(pos, quat, scl);
        // Mirror the socket position across the PARENT's centerline (head-local X=0),
        // not world X=0 — so the mirror tracks the head when it moves/rotates. Reflect
        // in parent-local space, then compose back to model space. (Unparented → world X=0.)
        const _mp = src._parentMesh;
        if (_mp) {
          const _pm = new THREE.Matrix4().fromArray(_mp.getModelSpaceMatrix());
          const _pmInv = new THREE.Matrix4().copy(_pm).invert();
          pos.applyMatrix4(_pmInv); // → head-local
          pos.x = -pos.x;           // reflect across head centerline
          pos.applyMatrix4(_pm);    // → back to model space
        } else {
          pos.x = -pos.x;
        }

        let mq = quat; // fallback: copy source orientation when it has no look-at
        const tid = src._lookAtTargetId;
        if (tid != null) {
          const target = ms.find((x) => x.getID() === tid);
          if (target) {
            const tmw = target.getModelSpaceMatrix();
            const T = new THREE.Vector3(tmw[12], tmw[13], tmw[14]);
            if (src._saccades && src._sacOff) T.add(src._sacOff); // conjugate (both eyes dart together)
            const _d = new THREE.Vector3().subVectors(T, pos).normalize();
            const _away = new THREE.Vector3().copy(pos).sub(_d); // aim +Z (negated, matches the eye)
            mq = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(pos, _away, this._constraintUp(src)));
          }
        }
        mir.mesh.matrixAutoUpdate = false;
        mir.mesh.matrix.copy(new THREE.Matrix4().compose(pos, mq, scl));
        mir.mesh.matrixWorldNeedsUpdate = true;
        mir.mesh.visible = src.isVisible ? src.isVisible() : true;
      }
    }
  }

  // [Eye rig Phase 1] Live mirror instance of a mesh across X=0. Shares the source's
  // geometry+material (so sculpting the source updates the mirror), positioned each
  // frame by _evaluateConstraints. Returns the THREE.Mesh.
  mirrorMesh(sourceId) {
    const src = this._meshes.find((m) => m.getID() === sourceId);
    const stm = src && src.getThreeMesh && src.getThreeMesh();
    if (!stm) { console.warn('[mirror] no source/threeMesh', sourceId); return null; }
    if (!this._mirrors) this._mirrors = [];
    const mesh = new THREE.Mesh(stm.geometry, stm.material); // SHARED geometry → live
    mesh.name = 'mirror_of_' + sourceId;
    mesh.frustumCulled = false;
    this._worldGroup.add(mesh);
    this._mirrors.push({ mesh, sourceId });
    console.log('[mirror] created mirror of mesh', sourceId);
    return mesh;
  }

  // ── [Eye rig] GUI-facing rig operations ─────────────────────────────────────
  // These are the single source of truth for look-at / saccades / mirror / parent;
  // the window.* console helpers (set up in the constructor) delegate to them.

  setLookAt(eyeId, targetId) {
    const eye = this._meshes.find((m) => m.getID() === eyeId);
    if (!eye) return;
    eye._lookAtTargetId = (targetId == null) ? null : targetId;
  }

  // Selection lock: a locked mesh can't be picked/selected/sculpted in the viewport
  // (the picking scans skip it); it can still be selected from the outliner.
  isSelectLocked(id) {
    const m = this._meshes.find((x) => x.getID() === id);
    return !!(m && m._selectLocked);
  }

  toggleSelectLock(id) {
    const m = this._meshes.find((x) => x.getID() === id);
    if (m) m._selectLocked = !m._selectLocked;
  }

  clearLookAt(eyeId) {
    const eye = this._meshes.find((m) => m.getID() === eyeId);
    if (eye) eye._lookAtTargetId = null;
  }

  getLookAt(eyeId) {
    const eye = this._meshes.find((m) => m.getID() === eyeId);
    return eye ? (eye._lookAtTargetId ?? null) : null;
  }

  setSaccades(eyeId, on = true, amp) {
    const eye = this._meshes.find((m) => m.getID() === eyeId);
    if (!eye) return;
    const wasOn = !!eye._saccades;
    eye._saccades = !!on;
    if (amp != null) eye._saccadeAmp = amp;
    // Turning OFF a no-aim saccade: restore the captured rest orientation so the eye
    // doesn't freeze mid-dart, then clear the cache so re-enabling recaptures.
    if (!on && wasOn && eye._sacRestQuat && eye._lookAtTargetId == null) {
      const em = eye.getModelSpaceMatrix();
      const P = new THREE.Vector3(em[12], em[13], em[14]);
      const s = Math.hypot(em[0], em[1], em[2]) || 1;
      const out = new THREE.Matrix4().compose(P, eye._sacRestQuat, new THREE.Vector3(s, s, s));
      eye.setModelSpaceMatrix(out.elements);
      eye.updateMatrices(this._camera);
      this.render();
    }
    if (!on) eye._sacRestQuat = null;
  }

  isSaccading(eyeId) {
    const eye = this._meshes.find((m) => m.getID() === eyeId);
    return !!(eye && eye._saccades);
  }

  getSaccadeAmp(eyeId) {
    const eye = this._meshes.find((m) => m.getID() === eyeId);
    return eye ? (eye._saccadeAmp ?? 5) : 5;
  }

  // Saccade speed: scales how often the eye darts (higher = more frequent flicks).
  setSaccadeSpeed(eyeId, speed) {
    const eye = this._meshes.find((m) => m.getID() === eyeId);
    if (eye) eye._saccadeSpeed = Math.max(0.01, speed);
  }

  getSaccadeSpeed(eyeId) {
    const eye = this._meshes.find((m) => m.getID() === eyeId);
    return eye ? (eye._saccadeSpeed ?? 1) : 1;
  }

  isMirrored(sourceId) {
    return !!(this._mirrors && this._mirrors.some((x) => x.sourceId === sourceId));
  }

  removeMirror(sourceId) {
    if (!this._mirrors) return;
    for (let i = this._mirrors.length - 1; i >= 0; i--) {
      if (this._mirrors[i].sourceId === sourceId) {
        const mir = this._mirrors[i];
        if (mir.mesh && mir.mesh.parent) mir.mesh.parent.remove(mir.mesh);
        this._mirrors.splice(i, 1);
      }
    }
  }

  // Toggle a live mirror on/off for a source mesh. Returns the new state.
  toggleMirror(sourceId) {
    if (this.isMirrored(sourceId)) { this.removeMirror(sourceId); return false; }
    this.mirrorMesh(sourceId);
    return true;
  }

  // Reparent childId under parentId (or null → worldGroup), preserving world transform.
  setMeshParent(childId, parentId) {
    const child = this._meshes.find((m) => m.getID() === childId);
    if (!child) { console.warn('[parent] no child', childId); return; }
    const parent = (parentId == null) ? null : this._meshes.find((m) => m.getID() === parentId);
    // Reject cycles: walk parent's ancestor chain — if child is up there, refuse.
    for (let p = parent; p; p = p._parentMesh) {
      if (p === child) { console.warn('[parent] refused (would create a cycle)'); return; }
    }
    const childTM = child.getThreeMesh();
    const dstTM   = parent ? parent.getThreeMesh() : this._worldGroup;
    childTM.updateWorldMatrix(true, false);
    dstTM.updateWorldMatrix(true, false);
    dstTM.attach(childTM);                       // reparent, preserve world transform
    child.setMatrix(childTM.matrix.elements);    // new local-to-parent → SculptXR matrix
    childTM.matrixAutoUpdate = false;
    child._parentMesh = parent || null;
    this.render();
  }

  getParentMesh(childId) {
    const child = this._meshes.find((m) => m.getID() === childId);
    return (child && child._parentMesh) || null;
  }

  // ── Outliner transform fields (LOCAL transform, relative to parent) ──────────
  // Returns the selected object's local Translate / Rotate(°) / Scale, or null.
  getTransformTRS(id) {
    const m = this._meshes.find((x) => x.getID() === id);
    if (!m) return null;
    const M = new THREE.Matrix4().fromArray(m.getMatrix());
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    M.decompose(p, q, s);
    const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
    const R2D = 180 / Math.PI;
    return { t: [p.x, p.y, p.z], r: [e.x * R2D, e.y * R2D, e.z * R2D], s: [s.x, s.y, s.z] };
  }

  // Live-refresh the outliner transform fields (.mm-xf) from the selected mesh, so they
  // track gizmo/grab manipulation. Skips a field being typed into; marks the VR panel
  // dirty only when a value actually changed. Throttled by the caller.
  _syncOutlinerTransformFields() {
    const inputs = document.querySelectorAll('.mm-xf');
    if (!inputs.length) return;
    const sel = this.getSelectedMeshes ? this.getSelectedMeshes() : [];
    if (sel.length !== 1) return;
    const trs = this.getTransformTRS(sel[0].getID());
    if (!trs) return;
    let changed = false;
    inputs.forEach((inp) => {
      if (inp === document.activeElement) return; // don't clobber typing
      const t = inp.dataset.xf, a = +inp.dataset.axis;
      if (!trs[t]) return;
      const val = Math.round(trs[t][a] * 1000) / 1000;
      if (parseFloat(inp.value) !== val) { inp.value = val; changed = true; }
    });
    if (changed && this._mainMenuPanel && this._mainMenuPanel.markDirty) this._mainMenuPanel.markDirty();
  }

  // Set one local-transform component. type: 't'|'r'|'s', axis: 0|1|2.
  setTransformComponent(id, type, axis, value) {
    const m = this._meshes.find((x) => x.getID() === id);
    if (!m) return;
    const trs = this.getTransformTRS(id);
    if (!trs) return;
    if (!(type in trs) || axis < 0 || axis > 2 || !Number.isFinite(value)) return;
    const Mold = m.getMatrix().slice(); // snapshot for undo before mutating
    trs[type][axis] = value;
    const D2R = Math.PI / 180;
    const p = new THREE.Vector3(trs.t[0], trs.t[1], trs.t[2]);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(trs.r[0] * D2R, trs.r[1] * D2R, trs.r[2] * D2R, 'XYZ'));
    const sx = trs.s[0] || 1e-4, sy = trs.s[1] || 1e-4, sz = trs.s[2] || 1e-4; // avoid zero scale (degenerate matrix)
    const M = new THREE.Matrix4().compose(p, q, new THREE.Vector3(sx, sy, sz));
    const Mnew = M.elements.slice();
    m.setMatrix(M.elements);
    m.updateMatrices(this._camera);
    this.render();

    // Typed-field (and VR numpad) edits weren't undoable — push a matrix snapshot. The outliner
    // fields re-sync from the matrix each frame (_syncOutlinerTransformFields), so undo/redo also
    // refreshes the displayed values.
    const sm = this.getStateManager && this.getStateManager();
    if (sm && sm.pushStateCustom) {
      const applyM = (elems) => { m.setMatrix(elems); m.updateMatrices(this._camera); this.render(); };
      sm.pushStateCustom(() => applyM(Mold), () => applyM(Mnew));
    }
  }

  // Bake (freeze) the LOCAL scale into the geometry: the mesh looks identical but its
  // Scale becomes 1 (translation + rotation kept in the matrix). Maya "freeze scale".
  bakeScale(id) {
    const mesh = this._meshes.find((x) => x.getID() === id);
    if (!mesh) return;
    const t = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    new THREE.Matrix4().fromArray(mesh.getMatrix()).decompose(t, q, s);
    if (Math.abs(s.x - 1) < 1e-6 && Math.abs(s.y - 1) < 1e-6 && Math.abs(s.z - 1) < 1e-6) return;
    const B = new THREE.Matrix4().compose(new THREE.Vector3(), new THREE.Quaternion(), s); // bake scale
    const K = new THREE.Matrix4().compose(t, q, new THREE.Vector3(1, 1, 1));               // keep T·R
    this._bakeTransform(mesh, B, K);
  }

  // Bake (freeze) the LOCAL translation into the geometry: the mesh looks identical but its
  // local position becomes 0 (rotation + scale kept). General rule: keep matrix K (the kept
  // components), bake B = K⁻¹·M into the verts so K·B == M (unchanged appearance).
  bakeTranslate(id) {
    const mesh = this._meshes.find((x) => x.getID() === id);
    if (!mesh) return;
    const M = new THREE.Matrix4().fromArray(mesh.getMatrix());
    const t = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    M.decompose(t, q, s);
    if (t.lengthSq() < 1e-12) return; // nothing to bake
    const K = new THREE.Matrix4().compose(new THREE.Vector3(), q, s); // drop translation
    const B = new THREE.Matrix4().copy(K).invert().multiply(M);       // K⁻¹·M
    this._bakeTransform(mesh, B, K);
  }

  // Bake (freeze) the LOCAL rotation into the geometry: local rotation becomes identity
  // (translation + scale kept). Caveat: this rotates the geometry, so the local symmetry
  // plane (stays at local x=0) can end up misaligned — bake while upright.
  bakeRotate(id) {
    const mesh = this._meshes.find((x) => x.getID() === id);
    if (!mesh) return;
    const M = new THREE.Matrix4().fromArray(mesh.getMatrix());
    const t = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    M.decompose(t, q, s);
    if (Math.abs(q.x) < 1e-7 && Math.abs(q.y) < 1e-7 && Math.abs(q.z) < 1e-7) return; // ~identity rotation
    const K = new THREE.Matrix4().compose(t, new THREE.Quaternion(), s); // drop rotation
    const B = new THREE.Matrix4().copy(K).invert().multiply(M);          // K⁻¹·M
    this._bakeTransform(mesh, B, K);
  }

  // Apply ALL local transforms (translation + rotation + scale) into the geometry,
  // leaving the matrix identity. Note: baking rotation can misalign the local
  // symmetry plane (it stays local x=0); bake while upright.
  bakeAllTransforms(id) {
    const mesh = this._meshes.find((x) => x.getID() === id);
    if (!mesh) return;
    const B = new THREE.Matrix4().fromArray(mesh.getMatrix());
    const ident = new THREE.Matrix4();
    if (B.equals(ident)) return;
    this._bakeTransform(mesh, B, ident);
  }

  // Bake matrix B into the geometry (all multires levels + blendshape base/deltas) and
  // set the LOCAL matrix to K (where K·B == the old matrix, so the mesh looks identical).
  // Undo applies B⁻¹ and restores the old matrix — no full vertex snapshot.
  _bakeTransform(mesh, B, K) {
    const Mold = mesh.getMatrix().slice();
    const Binv = new THREE.Matrix4().copy(B).invert();
    const cam = this._camera;

    const apply = (Bmat, matElems) => {
      const lin = new THREE.Matrix3().setFromMatrix4(Bmat); // linear part (for delta VECTORS)
      const v = new THREE.Vector3();
      const xformPositions = (arr) => {
        for (let i = 0; i < arr.length; i += 3) {
          v.set(arr[i], arr[i + 1], arr[i + 2]).applyMatrix4(Bmat);
          arr[i] = v.x; arr[i + 1] = v.y; arr[i + 2] = v.z;
        }
      };
      const xformVectors = (arr) => {
        for (let i = 0; i < arr.length; i += 3) {
          v.set(arr[i], arr[i + 1], arr[i + 2]).applyMatrix3(lin);
          arr[i] = v.x; arr[i + 1] = v.y; arr[i + 2] = v.z;
        }
      };

      const levels = mesh._meshes && mesh._meshes.length ? mesh._meshes : [mesh];
      for (const lvl of levels) xformPositions(lvl.getVertices());

      // Blendshapes: base is positions, deltas are vectors (translation cancels).
      const tr = window._animationRegistry && window._animationRegistry.tracks
        && window._animationRegistry.tracks.get(mesh.getID());
      if (tr) {
        if (tr.baseShape) xformPositions(tr.baseShape);
        if (tr.blendshapes) for (const d of tr.blendshapes.values()) xformVectors(d);
      }

      mesh.setMatrix(matElems);
      // Skip the updateGeometry blendshape interception — we handled the deltas above.
      const prevApplying = tr && tr._applyingBS;
      if (tr) tr._applyingBS = true;
      const lv = mesh._meshes && mesh._meshes.length ? mesh._meshes : [mesh];
      for (const lvl of lv) lvl.updateGeometry();
      if (tr) tr._applyingBS = prevApplying;

      // Recompute the center from the baked geometry bounds (don't transform it by hand
      // — the wrapper + level share the array, so manual baking double-applies). This is
      // the center the gizmo/picking anchor to.
      if (mesh.updateCenter) mesh.updateCenter();
      if (mesh.isDynamic) mesh.updateBuffers(); else mesh.updateGeometryBuffers();
      mesh.updateMatrices(cam);
    };

    apply(B, K.elements);
    this.render();

    const sm = this.getStateManager && this.getStateManager();
    if (sm && sm.pushStateCustom) {
      sm.pushStateCustom(
        () => { apply(Binv, Mold); this.render(); },
        () => { apply(B, K.elements); this.render(); }
      );
    }
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

  // Add/remove a mesh's three.js object to/from the render scene graph. Kept as
  // helpers so the add/remove paths AND undo/redo (StateAddRemove) stay in sync —
  // forgetting the scene-graph re-add on undo is why "delete → undo" did nothing.
  attachMeshThree(mesh) {
    var t = mesh && mesh.getThreeMesh && mesh.getThreeMesh();
    if (t && this._worldGroup) this._worldGroup.add(t);
  }

  detachMeshThree(mesh) {
    var t = mesh && mesh.getThreeMesh && mesh.getThreeMesh();
    if (!t) return;
    var target = this._worldGroup || this._scene;
    if (target) target.remove(t);
  }

  addNewMesh(mesh) {
    this._meshes.push(mesh);
    if (!mesh._permanentStaticLabel) {
      mesh._permanentStaticLabel = (mesh._typeName || "Mesh") + " " + this._meshes.length;
    }
    this.attachMeshThree(mesh);
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

      // SXR multimeshes are already fully initialized by the importer
      // (allocateArrays, initTopology, updateResolution, initRender).
      // Calling mesh.init() would invoke initColorsAndMaterials() which
      // resets _colorsRGB to all-white whenever its length != nbVertices*3
      // (which happens on UV meshes where the array is sized to nbTexCoords).
      if (!innerMesh._meshes) {
        mesh.init();
      }
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
    this._camera.optimizeNearFar(this.computeBoundingBoxScene());
    this._refreshDesktopCameraProjection();
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

    // Eye-rig mirrors are bare THREE.Meshes parented to _worldGroup (not in _meshes), so the
    // loop above misses them — remove them explicitly or a mirrored eye is left behind.
    if (this._mirrors) {
      for (var k = this._mirrors.length - 1; k >= 0; --k) {
        var mk = this._mirrors[k];
        if (mk.mesh && mk.mesh.parent) mk.mesh.parent.remove(mk.mesh);
      }
      this._mirrors.length = 0;
    }

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
    // Re-select a remaining mesh so the outliner keeps showing its transform/rig controls —
    // an empty selection blanks most of the panel (those only render for a single selection).
    // Null when the scene is now empty.
    this.setOrUnsetMesh(this._meshes[this._meshes.length - 1] || null, false);
  }

  removeMeshes(rm) {
    var meshes = this._meshes;
    for (var i = 0; i < rm.length; ++i) {
      var idx = this.getIndexMesh(rm[i]);
      if (idx >= 0) {
        // Drop any eye-rig mirror of this mesh — it lives in _worldGroup, not _meshes, so
        // deleting the source otherwise leaves the mirrored copy behind.
        this.removeMirror(meshes[idx].getID());
        this.detachMeshThree(meshes[idx]);
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
      case 221: // ]  — toggle main menu desktop overlay
        window.mmOverlay?.();
        break;
      case 77: // M  — toggle main menu in 3D scene (desktop + VR)
        window.toggleMainMenu?.();
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

    // Cache the worldGroup matrix as it stands at desktop time (scale=0.701, pos=0,0,0).
    // The spectator desktop-camera formula needs this to cancel out the scale change
    // that happens when VR starts (worldGroup gets set to vrScale=0.008 + xrWorldOffset).
    this._worldGroup.updateMatrixWorld(true);
    this._desktopCameraCache.worldGroupMatrix = this._worldGroup.matrixWorld.clone();

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

    // Restore the desktop background (and env backdrop quad) hidden during XR.
    if (this._background && this._background._applyBackground) this._background._applyBackground();

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

    // Restore worldGroup to desktop scale/position (it was left at VR micro-scale 0.008)
    const wgCache = this._desktopCameraCache.worldGroupMatrix;
    if (wgCache && this._worldGroup) {
      const _p = new THREE.Vector3();
      const _q = new THREE.Quaternion();
      const _s = new THREE.Vector3();
      wgCache.decompose(_p, _q, _s);
      this._worldGroup.position.copy(_p);
      this._worldGroup.quaternion.copy(_q);
      this._worldGroup.scale.copy(_s);
    } else if (this._worldGroup) {
      this._worldGroup.position.set(0, 0, 0);
      this._worldGroup.quaternion.identity();
      this._worldGroup.scale.set(0.701, 0.701, 0.701);
    }
    if (this._worldGroup) this._worldGroup.updateMatrixWorld(true);

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

  // ─── Desktop Spectator / Mirror Pass ──────────────────────────────────────
  //
  // Renders the desktop canvas during a VR session so the PC screen isn't blank.
  // Called every VR frame but does as little work as possible by default.
  //
  // Modes (set via window.setSpectatorMode(n) or this._spectatorViewMode):
  //   0 = BLANK    — clear canvas to black; obvious "VR active" indicator
  //   1 = MIRROR   — headset-centre view rendered to canvas
  //   2 = DESKTOP  — desktop free camera (stable orbit, ignores VR pose)
  //   3 = SPECTATOR — desktop orbit distance + headset orientation relative to
  //                   the worldGroup; tracks sculpt rotations/moves without
  //                   inheriting positional jitter from headset movement
  //
  // Recompute the desktop camera's near/far from the current scene bounds and
  // update _desktopCameraCache.proj. Safe to call any time — no-op if no cache yet.
  _refreshDesktopCameraProjection() {
    const cache = this._desktopCameraCache;
    if (!cache || !cache.view) return;

    const bb = this.computeBoundingBoxScene();
    if (!Number.isFinite(bb[0])) return;

    // Extract desktop eye position from the cached view matrix.
    const v = cache.view;
    const ex = -(v[0] * v[12] + v[1] * v[13] + v[2] * v[14]);
    const ey = -(v[4] * v[12] + v[5] * v[13] + v[6] * v[14]);
    const ez = -(v[8] * v[12] + v[9] * v[13] + v[10] * v[14]);

    const bcx = (bb[0] + bb[3]) * 0.5;
    const bcy = (bb[1] + bb[4]) * 0.5;
    const bcz = (bb[2] + bb[5]) * 0.5;
    const dx = ex - bcx, dy = ey - bcy, dz = ez - bcz;
    const distToBoxCenter = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const boxRadius = 0.5 * Math.sqrt(
      (bb[3] - bb[0]) ** 2 + (bb[4] - bb[1]) ** 2 + (bb[5] - bb[2]) ** 2
    );

    const near = Math.max(0.001, distToBoxCenter - boxRadius);
    const far  = Math.max(near + 0.1, distToBoxCenter + boxRadius);

    const cam = this._camera;
    const aspect = cam._width / cam._height;
    mat4.perspective(cache.proj, cam._fov * Math.PI / 180.0, aspect, near, far);
  }

  _renderSpectatorCanvas() {
    const mode = this._spectatorViewMode ?? 0;

    const renderer = this._renderer;
    if (!renderer) return;

    // Render modes (1 & 2) are throttled to limit GPU cost on the desktop pass.
    // _spectatorFrameSkip: 0=every frame, 3=every 4th (default), etc.
    // BLANK (0) is a single clear — no throttle needed.
    if (mode >= 1) {
      const skip = this._spectatorFrameSkip ?? 3;
      this._spectatorN = ((this._spectatorN || 0) + 1);
      if (skip > 0 && (this._spectatorN % (skip + 1)) !== 0) return;
    }

    const wasXR = renderer.xr.enabled;
    try {
      renderer.xr.enabled = false;  // bypass XR layer so we can write to the DOM canvas
      renderer.setRenderTarget(null);

      if (mode === 0) {
        // ── BLANK: just clear the canvas ──────────────────────────────────
        renderer.setClearColor(0x0d0d0d, 1);
        renderer.clear();
        renderer.setClearColor(0x000000, 0);

      } else if (mode === 1) {
        // ── MIRROR: render from the left-eye camera, corrected to canvas aspect ──
        if (this._spectatorLeftEyeMatrix && this._spectatorLeftEyeProj) {
          if (!this._spectatorMirrorCam) {
            this._spectatorMirrorCam = new THREE.PerspectiveCamera();
            this._spectatorMirrorCam.matrixAutoUpdate = false;
          }
          const cam    = this._spectatorMirrorCam;
          const canvas = renderer.domElement;

          // View from left eye (captured before this call, still valid)
          cam.matrixWorld.copy(this._spectatorLeftEyeMatrix);
          cam.matrixWorldInverse.copy(this._spectatorLeftEyeMatrix).invert();
          cam.matrix.copy(cam.matrixWorld);

          // Rebuild projection for the CSS display size of the canvas, not the XR
          // framebuffer resolution (canvas.width/height = per-eye XR resolution ≈ square;
          // canvas.clientWidth/Height = actual browser window = e.g. 16:9).
          // elements[5] of a column-major perspective matrix = cot(vFov/2).
          const m11        = this._spectatorLeftEyeProj.elements[5];
          const vFovDeg    = 2.0 * Math.atan(1.0 / m11) * (180 / Math.PI);
          const dispAspect = (canvas.clientWidth || canvas.width) /
                             (canvas.clientHeight || canvas.height) || 1;
          if (this._mirrorFovScale === undefined) this._mirrorFovScale = 0.5;
          cam.fov    = vFovDeg * this._mirrorFovScale;
          cam.aspect = dispAspect;
          cam.near   = 0.01;
          cam.far    = 50;
          cam.updateProjectionMatrix();

          renderer.render(this._scene, cam);
        }

      } else if (mode === 2) {
        // ── DESKTOP FREE CAMERA ─────────────────────────────────────────────────
        //
        // Strategy: temporarily restore the worldGroup to its desktop-time state
        // and render using the desktop SculptGL Three.js camera.  This is exactly
        // equivalent to "what the user saw on the desktop" without needing to
        // compute a complex spectator view matrix.
        //
        // Spacebar-to-frame also works because Camera.js updateView() always writes
        // cache.view during VR, and we apply that here before rendering.
        //
        const cache      = this._desktopCameraCache;
        const desktopCam = this._camera.getThreeCamera();

        // Sync the desktop Three.js camera to the latest SculptGL camera state.
        // Camera.js skips updating the Three.js camera matrices while in VR, so we
        // do it manually here to pick up any camera movement (e.g. spacebar reset).
        desktopCam.matrixWorldInverse.fromArray(cache.view);
        desktopCam.matrixWorld.copy(desktopCam.matrixWorldInverse).invert();
        desktopCam.matrix.copy(desktopCam.matrixWorld);

        // Restore the desktop projection matrix.
        // renderer.xr.getCamera() overwrites desktopCam.projectionMatrix with the
        // XR stereo combined projection every VR frame (different FOV + aspect).
        // We must restore the original desktop projection before rendering.
        desktopCam.projectionMatrix.fromArray(cache.proj);
        desktopCam.projectionMatrixInverse.copy(desktopCam.projectionMatrix).invert();

        // Save the current VR worldGroup transform.
        const savedPos   = this._worldGroup.position.clone();
        const savedQuat  = this._worldGroup.quaternion.clone();
        const savedScale = this._worldGroup.scale.clone();

        // Restore worldGroup to desktop-time state.  cache.worldGroupMatrix was
        // captured at VR-start (scale=0.701, pos/rot=(0,0,0)).
        const wgDesktop = cache.worldGroupMatrix;
        if (wgDesktop) {
          const _p = new THREE.Vector3();
          const _q = new THREE.Quaternion();
          const _s = new THREE.Vector3();
          wgDesktop.decompose(_p, _q, _s);
          this._worldGroup.position.copy(_p);
          this._worldGroup.quaternion.copy(_q);
          this._worldGroup.scale.copy(_s);
        } else {
          this._worldGroup.position.set(0, 0, 0);
          this._worldGroup.quaternion.identity();
          this._worldGroup.scale.set(0.701, 0.701, 0.701);
        }

        renderer.render(this._scene, desktopCam);

        // Restore VR worldGroup state so the next XR frame is correct.
        this._worldGroup.position.copy(savedPos);
        this._worldGroup.quaternion.copy(savedQuat);
        this._worldGroup.scale.copy(savedScale);
        this._worldGroup.updateMatrixWorld(true);

      } else if (mode === 3) {
        // ── SPECTATOR: rotation-coupled, position-stable ─────────────────────
        //
        // Inherits the headset's orientation relative to the worldGroup (sculpt
        // space), but keeps the desktop orbit distance.  This means:
        //   • Sculpt rotations/pans driven by dual-grip show on desktop ✓
        //   • Head positional jitter (sway, walking) is NOT inherited ✓
        //   • The desktop viewer always sees which "face" the VR person is
        //     working on, without the nausea of full VR mirror
        //
        // R_rel = R_wg⁻¹ × R_head   (headset orientation in sculpt space)
        // cam_pos = orbitCenter  −  headForward × orbitDist

        if (!this._spectatorLeftEyeMatrix) { /* wait for first headset frame */ } else {
        const cache      = this._desktopCameraCache;
        const desktopCam = this._camera.getThreeCamera();

        // wgInvMatrix: VR world → sculpt space.  Read before the worldGroup swap below.
        const wgInvMatrix = this._worldGroup.matrixWorld.clone().invert();

        // Desktop camera position and orbit centre (both in desktop world space).
        const desktopCamWorldPos = new THREE.Vector3().setFromMatrixPosition(
          new THREE.Matrix4().fromArray(cache.view).invert()
        );
        const orbitCenter = new THREE.Vector3(
          cache.center[0], cache.center[1], cache.center[2]
        );

        // Full 3-D orbit distance (replaces the old XZ-only horizRadius).
        const orbitDist = desktopCamWorldPos.distanceTo(orbitCenter);

        // --- Extract headset forward (-Z) and up (+Y) from the eye matrix ---
        // setFromMatrixColumn(m, n) returns column n = local axis n in world space.
        // Forward = local -Z;  Up = local +Y.
        const headVRForward = new THREE.Vector3()
          .setFromMatrixColumn(this._spectatorLeftEyeMatrix, 2).negate();
        const headVRUp = new THREE.Vector3()
          .setFromMatrixColumn(this._spectatorLeftEyeMatrix, 1);

        // Transform directions VR world → sculpt → desktop world.
        // cache.worldGroupMatrix has identity rotation (scale 0.701 only), so
        // transformDirection through it normalises — effectively a no-op for unit vecs.
        const headFwd = headVRForward.clone()
          .transformDirection(wgInvMatrix)
          .transformDirection(cache.worldGroupMatrix);
        const headUp = headVRUp.clone()
          .transformDirection(wgInvMatrix)
          .transformDirection(cache.worldGroupMatrix);

        // Safety: degenerate transform fallbacks.
        if (headFwd.lengthSq() < 0.001) headFwd.set(0, 0, -1);
        if (headUp.lengthSq()  < 0.001) headUp.set(0, 1, 0);
        headFwd.normalize();
        headUp.normalize();

        // Place spectator camera at orbitDist from orbit centre, opposite to the
        // headset's viewing direction.  lookAt with the headset's local Y as up
        // captures pitch (top-down, tilted) that the old world-Y up lost.
        const camPos = new THREE.Vector3().copy(orbitCenter)
          .addScaledVector(headFwd, -orbitDist);

        // lookAt sets rotation only — must set position separately.
        const camToWorld = new THREE.Matrix4().lookAt(camPos, orbitCenter, headUp);
        camToWorld.setPosition(camPos);
        desktopCam.matrixWorld.copy(camToWorld);
        desktopCam.matrixWorldInverse.copy(camToWorld).invert();
        desktopCam.matrix.copy(camToWorld);

        // Restore desktop projection (overwritten each frame by renderer.xr.getCamera)
        desktopCam.projectionMatrix.fromArray(cache.proj);
        desktopCam.projectionMatrixInverse.copy(desktopCam.projectionMatrix).invert();

        // --- Swap worldGroup to desktop state and render ---
        const savedPos3   = this._worldGroup.position.clone();
        const savedQuat3  = this._worldGroup.quaternion.clone();
        const savedScale3 = this._worldGroup.scale.clone();

        const wgDesktop3 = cache.worldGroupMatrix;
        if (wgDesktop3) {
          const _p = new THREE.Vector3();
          const _q = new THREE.Quaternion();
          const _s = new THREE.Vector3();
          wgDesktop3.decompose(_p, _q, _s);
          this._worldGroup.position.copy(_p);
          this._worldGroup.quaternion.copy(_q);
          this._worldGroup.scale.copy(_s);
        } else {
          this._worldGroup.position.set(0, 0, 0);
          this._worldGroup.quaternion.identity();
          this._worldGroup.scale.set(0.701, 0.701, 0.701);
        }

        renderer.render(this._scene, desktopCam);

        this._worldGroup.position.copy(savedPos3);
        this._worldGroup.quaternion.copy(savedQuat3);
        this._worldGroup.scale.copy(savedScale3);
        this._worldGroup.updateMatrixWorld(true);
        } // end else (spectatorLeftEyeMatrix available)
      }

    } catch (e) {
      // Never let a spectator error disrupt the VR loop
      console.warn('[Spectator] render error:', e);
    } finally {
      renderer.xr.enabled = wasXR;
    }
  }
  // ──────────────────────────────────────────────────────────────────────────

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

    // [HTMLVRPanel] Init HTML-based Brush/Tools panel
    if (!this._brushPanel && this._scene && this._camera && this._renderer) {
      try {
        this._brushPanel = new BrushPanel(this, this._scene, this._camera.getThreeCamera(), this._renderer);
        this._brushPanel.bindDesktopPointers(this._renderer, this._camera.getThreeCamera());
        // Listen for pin/unpin so we can move the mesh between world and wrist.
        this._brushPanel._element.addEventListener('bp-pin-change', (e) => {
          this._onBrushPanelPinChange(e.detail.pinned);
        });
        // Start visible, attached to wrist (parented in handleXRInput once grips are known).
        if (window.screenLog) window.screenLog('[HTMLVRPanel] BrushPanel created', 'cyan');

        // The legacy GuiXR main menu + mini-HUD are RETIRED (#40 Tier 1) — the HTML
        // panels (MainMenuPanel/MiniPanel/BrushPanel/ToolPicker) are the only path.
        // _brushPanelEnabled is now permanently true; the old toggle is kept as a no-op
        // so any stray caller can't resurface the canvas menu. (Popups — _guiPopup —
        // are a separate system and unaffected; their HTML migration is Tier 2.)
        window._brushPanelEnabled = true;
        window.toggleBrushPanel = () => {
          window._brushPanelEnabled = true;
          this._swapHtmlPanels('mini');
          console.log('[HTMLVRPanel] Legacy GuiXR menu is retired — HTML panels are always on.');
          if (window.screenLog) window.screenLog('Menu: HTML (legacy retired)', 'cyan');
        };
      } catch (err) {
        console.error('[HTMLVRPanel] BrushPanel init failed:', err);
      }
    }

    // [HTMLVRPanel] Init MiniPanel (compact wrist HUD — replaces legacy canvas MiniHUD)
    if (!this._miniPanel && this._scene && this._camera && this._renderer) {
      try {
        this._miniPanel = new MiniPanel(this, this._scene, this._camera.getThreeCamera(), this._renderer);
        this._miniPanel.bindDesktopPointers(this._renderer, this._camera.getThreeCamera());
        this._miniPanel._element.addEventListener('mp-show-brush-panel', () => {
          this._swapHtmlPanels('brush');
        });
        this._miniPanel._element.addEventListener('mp-show-tool-picker', () => {
          this._swapHtmlPanels('picker');
          this._toolPickerPanel?.syncFromState();
        });
        // BrushPanel starts hidden; MiniPanel is the default wrist view
        if (this._brushPanel?.mesh) this._brushPanel.mesh.visible = false;
        if (window.screenLog) window.screenLog('[HTMLVRPanel] MiniPanel created', 'cyan');
      } catch (err) {
        console.error('[HTMLVRPanel] MiniPanel init failed:', err);
      }
    }

    // [HTMLVRPanel] Init ToolPickerPanel (separate mesh — same wrist pos as MiniPanel)
    if (!this._toolPickerPanel && this._scene && this._camera && this._renderer) {
      try {
        this._toolPickerPanel = new ToolPickerPanel(this, this._scene, this._camera.getThreeCamera(), this._renderer);
        this._toolPickerPanel.bindDesktopPointers(this._renderer, this._camera.getThreeCamera());
        this._toolPickerPanel._element.addEventListener('tp-close', () => {
          this._swapHtmlPanels('mini');
        });
        this._toolPickerPanel._element.addEventListener('tp-tool-selected', (e) => {
          const id = e.detail.id;
          const sm = this.getSculptManager?.();
          if (sm) {
            sm.setToolIndex(id);
            try { this.getGui?.()._ctrlSculpting?._ctrlSculpt?.setValue(id); } catch (_) {}
          }
          this._swapHtmlPanels('mini'); // syncFromState() is called inside _swapHtmlPanels
        });
        this._toolPickerPanel._element.addEventListener('tp-show-brush', () => {
          this._swapHtmlPanels('brush');
        });
        if (window.screenLog) window.screenLog('[HTMLVRPanel] ToolPickerPanel created', 'cyan');
      } catch (err) {
        console.error('[HTMLVRPanel] ToolPickerPanel init failed:', err);
      }
    }

    // [HTMLVRPanel] Init MainMenuPanel (replaces GuiXR + VRMenu main menu)
    if (!this._mainMenuPanel && this._scene && this._camera && this._renderer) {
      try {
        this._mainMenuPanel = new MainMenuPanel(this, this._scene, this._camera.getThreeCamera(), this._renderer);
        this._mainMenuPanel.bindDesktopPointers(this._renderer, this._camera.getThreeCamera());
        this._mainMenuPanel._element.addEventListener('mm-pin-change', (e) => {
          this._onMainMenuPanelPinChange(e.detail.pinned);
        });
        this._mainMenuPanel._element.addEventListener('mm-browser-saves-open', () => {
          this._openFilesPanel();
        });
        this._mainMenuPanel._element.addEventListener('mm-section-tearoff', (e) => {
          this._tearOffSection(e.detail.section);
        });
        if (window.screenLog) window.screenLog('[HTMLVRPanel] MainMenuPanel created', 'cyan');

        // Console helper: window.toggleMainMenu() to show/hide
        window.toggleMainMenu = (visible) => {
          const isVR = !!this._renderer?.xr?.isPresenting;
          const show = visible ?? !this._mainMenuPanel?.mesh?.visible;
          if (isVR) {
            // In VR the panel is wrist-parented — just toggle via _swapHtmlPanels
            // so MiniPanel is hidden when the main menu shows and vice-versa.
            this._swapHtmlPanels(show ? 'main' : 'mini');
          } else {
            // Desktop: float the panel in front of the camera.
            if (show && this._mainMenuPanel?.mesh) {
              const cam = this._camera?.getThreeCamera();
              if (cam) {
                const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
                this._mainMenuPanel.mesh.position
                  .copy(cam.position)
                  .addScaledVector(fwd, 0.7);
                this._mainMenuPanel.mesh.position.y -= 0.05;
                this._mainMenuPanel.mesh.quaternion.copy(cam.quaternion);
              }
            }
            this._mainMenuPanel?.show(show);
          }
        };
        // Desktop overlay: window.mmOverlay(true/false) — shows a COPY of the panel
        // as a normal DOM element so you can inspect the HTML/CSS without VR.
        // The polyfill's host div has transform-style:preserve-3d which blocks
        // position:fixed on the original element in Chrome, so we clone it instead.
        window.mmOverlay = (show) => {
          const OVERLAY_ID = '_mm_debug_overlay';
          const existing = document.getElementById(OVERLAY_ID);
          if (existing) {
            // Restore #mm-root to the polyfill host before removing backdrop.
            const src = document.getElementById('mm-root');
            const host = document.getElementById('_htmlvr_host');
            if (src && host && src.parentElement !== host) {
              const saved = existing._savedStyle;
              if (saved) src.setAttribute('style', saved);
              else src.removeAttribute('style');
              host.appendChild(src);
            }
            existing.remove();
            this._mainMenuPanel?.markDirty();
            if (show !== true) return;
          }
          if (show === false) return;

          const src = document.getElementById('mm-root');
          if (!src) return console.warn('[mmOverlay] mm-root not found — panel not created yet');
          const host = src.parentElement; // polyfill host — we restore here on close

          // Dark backdrop
          const backdrop = document.createElement('div');
          backdrop.id = OVERLAY_ID;
          backdrop.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;pointer-events:none;';

          // Move the real #mm-root into the backdrop so all JS event listeners
          // are preserved (a clone loses them).  Canvas DOM children never paint
          // to screen in normal HTML rendering, so we must re-parent the element
          // into a regular div for it to be visible.
          const srcW = parseInt(src.style.width)  || 480;
          const srcH = parseInt(src.style.height) || 504;

          // The polyfill may stamp arbitrary inline styles (position, left, top,
          // visibility, transform) on the element.  Save and reset them all so
          // the element renders cleanly as a regular block inside the flex backdrop.
          const savedStyle = src.getAttribute('style') || '';
          backdrop._savedStyle = savedStyle;
          src.removeAttribute('style');
          src.style.width      = srcW + 'px';
          src.style.height     = srcH + 'px';
          src.style.position   = 'relative';
          src.style.visibility = 'visible';
          src.style.display    = 'block';
          src.style.boxShadow    = '0 16px 48px rgba(0,0,0,0.9)';
          src.style.pointerEvents = 'auto';

          // Scale to fit viewport
          const maxW = window.innerWidth  - 80;
          const maxH = window.innerHeight - 80;
          const scale = Math.min(1, maxW / srcW, maxH / srcH);
          src.style.transform       = `scale(${scale.toFixed(3)})`;
          src.style.transformOrigin = 'center center';

          backdrop.appendChild(src);
          document.body.appendChild(backdrop);

          const close = () => {
            // Restore exactly the inline styles the polyfill had stamped before.
            if (savedStyle) src.setAttribute('style', savedStyle);
            else src.removeAttribute('style');
            if (host) host.appendChild(src);
            backdrop.remove();
            // Re-sync so the polyfill texture reflects any changes made in the overlay.
            this._mainMenuPanel?.markDirty();
          };

          const _escClose = (e) => { if (e.key === 'Escape') { close(); window.removeEventListener('keydown', _escClose); } };
          window.addEventListener('keydown', _escClose);
          console.log('[mmOverlay] showing live panel — Esc or ] to dismiss, mmOverlay(false) in console');
        };
        // Texture peek: window.mmShowCanvas() — displays the raw polyfill canvas
        // so you can see exactly what the polyfill renders (independent of the mesh).
        window.mmShowCanvas = () => {
          const hc = document.getElementById('_htmlvr_host');
          const el = this._mainMenuPanel?._element;
          if (!hc || !el) return console.warn('[mmShowCanvas] panel not ready');
          try {
            const c = hc.captureElementImage(el);
            const existing = document.getElementById('_mm_canvas_dbg');
            if (existing) { existing.remove(); }
            const img = document.createElement('canvas');
            img.id = '_mm_canvas_dbg';
            img.width  = c.width;
            img.height = c.height;
            const scale = Math.min(1, (window.innerWidth - 40) / c.width,
                                      (window.innerHeight - 40) / c.height);
            img.style.cssText = `position:fixed;bottom:20px;right:20px;z-index:99999;`
              + `width:${Math.round(c.width*scale)}px;height:${Math.round(c.height*scale)}px;`
              + `border:3px solid #f38ba8;cursor:pointer;`;
            img.getContext('2d').drawImage(c, 0, 0);
            img.title = `Polyfill canvas: ${c.width}×${c.height}. Click to dismiss.`;
            img.onclick = () => img.remove();
            document.body.appendChild(img);
            const msg = `[mmShowCanvas] canvas: ${c.width}×${c.height}`;
            console.log(msg + '. Click overlay to dismiss.');
            // Also log via screenLog so it's visible in the VR mirror view.
            if (window.screenLog) window.screenLog(msg, '#f38ba8');
          } catch (e) {
            console.warn('[mmShowCanvas]', e.message);
            if (window.screenLog) window.screenLog(`[mmShowCanvas] ${e.message}`, 'red');
          }
        };
        // Diagnostic helper: window.mmDebug() — dumps panel state
        window.mmDebug = () => {
          const p  = this._mainMenuPanel;
          const el = document.getElementById('mm-root');
          const mb = document.getElementById('mm-menubar');
          const ts = document.getElementById('mm-tabstrip');
          const m  = p?.mesh;
          console.log('[mmDebug] visible:', m?.visible,
            '| section:', p?._activeSection, '| menu:', p?._activeMenu,
            '\n  DOM root:', el?.offsetWidth+'x'+el?.offsetHeight,
            '| menubar:', mb?.offsetWidth+'x'+mb?.offsetHeight,
            '| tabstrip:', ts?.offsetWidth+'x'+ts?.offsetHeight,
            '\n  mesh geo:', m?.geometry?.parameters?.width?.toFixed(3)+'x'+m?.geometry?.parameters?.height?.toFixed(3),
            '| mesh pos:', m?.position?.toArray?.()?.map(v=>v.toFixed(3)).join(','),
            '\n  texture:', p?._texture?.image?.width+'x'+p?._texture?.image?.height,
            '| contentKey:', p?._lastContentKey);
        };
        // Wire ']' → overlay, 'M' → 3D toggle (Scene.onKeyDown isn't on the global
        // key listener chain so we add our own one-time handler here).
        if (!window._mmKeyBound) {
          window._mmKeyBound = true;
          window.addEventListener('keydown', (e) => {
            if (e.which === 221) window.mmOverlay?.();      // ]  → desktop HTML clone
            if (e.which === 219) window.mmShowCanvas?.();   // [  → raw polyfill canvas
            if (e.which === 77  && !e.ctrlKey && !e.metaKey) window.toggleMainMenu?.(); // M
          });
        }
        console.log('[HTMLVRPanel] Main menu ready — ] HTML overlay, [ polyfill canvas, M 3D toggle | mmDebug() / mmShowCanvas() in console');
      } catch (err) {
        console.error('[HTMLVRPanel] MainMenuPanel init failed:', err);
      }
    }

    // Desktop panel preview helper — showPanel(name) floats any VR panel in front
    // of the camera so you can inspect layout without entering VR.
    // Usage: showPanel('mini'|'brush'|'picker'|'main')  /  showPanel() hides all.
    if (!window.showPanel) {
      window.showPanel = (name) => {
        const panels = {
          mini:   this._miniPanel,
          brush:  this._brushPanel,
          picker: this._toolPickerPanel,
          main:   this._mainMenuPanel,
        };
        // Hide all first
        Object.values(panels).forEach(p => { if (p?.mesh) p.mesh.visible = false; });
        if (!name) { console.log('[showPanel] all hidden'); return; }

        const p = panels[name];
        if (!p?.mesh) { console.warn('[showPanel] panel not ready:', name); return; }

        // Float 0.7 m in front of the camera, facing it.
        const cam = this._camera?.getThreeCamera();
        if (cam) {
          const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
          p.mesh.position.copy(cam.position).addScaledVector(fwd, 0.7);
          p.mesh.quaternion.copy(cam.quaternion);
        }
        // Re-parent to scene root so wrist-grip offset doesn't apply.
        if (p.mesh.parent && p.mesh.parent !== this._scene) {
          this._scene.add(p.mesh);
        } else if (!p.mesh.parent) {
          this._scene.add(p.mesh);
        }
        if (p.show) p.show(true);
        else { p.mesh.visible = true; p.syncFromState?.(); }
        // Polyfill paints in a rAF; trigger two renders so the texture
        // lands before the user sees the mesh.
        requestAnimationFrame(() => { this.render(); requestAnimationFrame(() => this.render()); });
        console.log(`[showPanel] showing '${name}' — showPanel() to hide all`);
      };
      console.log('[showPanel] ready — showPanel(\'mini\'|\'brush\'|\'picker\'|\'main\') / showPanel() to hide all');
    }

    // [HTMLVRPanel] Init FilesPanel (floating overlay triggered from VR Files button + desktop)
    if (!this._filesPanel && this._scene && this._camera && this._renderer) {
      try {
        this._filesPanel = new FilesPanel();
        this._filesPanel.init(this._scene, this._camera.getThreeCamera(), this._renderer);
        this._filesPanel.bindDesktopPointers(this._renderer, this._camera.getThreeCamera());
        // Desktop helper: window.openFilesPanel() — also called from GuiFiles
        window.openFilesPanel = () => this._openFilesPanel();

        if (window.screenLog) window.screenLog('[HTMLVRPanel] FilesPanel created', 'cyan');
      } catch (err) {
        console.error('[HTMLVRPanel] FilesPanel init failed:', err);
      }
    }

    // [HTMLVRPanel] Init AnimationControlPanel (also inited early in start() for desktop)
    if (!this._animPanel && this._scene && this._camera && this._renderer) {
      try {
        this._animPanel = new AnimationControlPanel(this, this._scene, this._camera.getThreeCamera(), this._renderer);
        this._animPanel.bindDesktopPointers(this._renderer, this._camera.getThreeCamera());
        window._animPanel = this._animPanel;
        if (window.screenLog) window.screenLog('[HTMLVRPanel] AnimationControlPanel created', 'cyan');

        // Embed #acp-root directly in the sidebar Animation tab.
        const slot = document.getElementById('_acp_sidebar_panel');
        const acpSrc = document.getElementById('acp-root');
        if (slot && acpSrc) {
          acpSrc.style.cssText = 'width:100%;box-sizing:border-box;border-radius:0;border:none;border-top:1px solid #313244;';
          slot.style.cssText = 'overflow-y:auto;padding:0;';
          slot.appendChild(acpSrc);
        }

        // On desktop the panel lives in the sidebar — toggle just activates the animation tab.
        window.toggleAnimPanel = () => {
          const tabGroup = document.querySelector('.sidebar-tab-group');
          tabGroup?.show?.('animation');
          this._animPanel?.syncFromState();
        };

        if (!window._animPanelKeyBound) {
          window._animPanelKeyBound = true;
          window.addEventListener('keydown', (e) => {
            if (e.key === 'n' && !e.ctrlKey && !e.metaKey && !e.shiftKey) window.toggleAnimPanel?.();
          });
        }
      } catch (err) {
        console.error('[AnimPanel] init failed:', err);
      }
    }

    // Init VR Numpad (floating number-pad for value editing in VR)
    if (!this._vrNumpad && this._scene && this._camera && this._renderer) {
      try {
        this._vrNumpad = new VrNumpad(this._scene, this._camera.getThreeCamera(), this._renderer);
        window._vrNumpad = this._vrNumpad;
      } catch (err) {
        console.error('[VrNumpad] init failed:', err);
      }
    }
    if (!this._vrConfirm && this._scene && this._camera && this._renderer) {
      try {
        this._vrConfirm = new VrConfirm(this._scene, this._camera.getThreeCamera(), this._renderer, this);
        window._vrConfirmPanel = this._vrConfirm;
      } catch (err) {
        console.error('[VrConfirm] init failed:', err);
      }
    }

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

            // Controller ray — 30 cm white tube, solid for first 15 cm then fades to transparent (Virtual Desktop style)
            const lineGeometry = new THREE.CylinderGeometry(0.001, 0.001, 0.30, 8, 1, true);
            lineGeometry.rotateX(-Math.PI / 2);
            lineGeometry.translate(0, 0, -0.15); // base at z=0, tip at z=-0.30
            const lineMaterial = new THREE.ShaderMaterial({
                vertexShader: `varying float vFade; void main() { vFade = 1.0 - clamp((uv.y - 0.5) * 2.0, 0.0, 1.0); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
                fragmentShader: `varying float vFade; void main() { gl_FragColor = vec4(1.0, 1.0, 1.0, vFade * 0.85); }`,
                transparent: true, depthTest: true, depthWrite: false,
                blending: THREE.NormalBlending, side: THREE.DoubleSide,
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
            // Pin the whole cursor to render AFTER the sculpt meshes. The sculpt material is
            // transparent, so it shares Three's depth-sorted transparent queue with the cursor;
            // as the camera moves their sort order swaps and the ring/volume flip between drawing
            // on top and being covered. renderOrder takes precedence over distance sorting, so a
            // high value keeps the cursor's draw order stable (ring/dot stay on top via their
            // depthTest:false; the volume sphere still depth-tests against the final mesh depth).
            group.traverse(function (o) { o.renderOrder = 999; });
            return group;
          };

          this._vrCursorLeft = createVRCursor();
          this._vrCursorRight = createVRCursor();
          // Start hidden — otherwise they sit (full size) at the world origin during
          // startup until the per-frame VR loop positions them. The loop re-enables
          // them once tracking a controller.
          this._vrCursorLeft.visible = false;
          this._vrCursorRight.visible = false;
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

  /**
   * [HTMLVRPanel] Called when the BrushPanel's pin button is toggled.
   * When pinning: capture the panel's current world matrix and re-parent to scene.
   * When unpinning: re-parent to wrist (handleXRInput will add it to uiGrip next frame).
   */
  /**
   * [HTMLVRPanel] Toggle which HTML panel is visible on the wrist.
   * @param {'mini'|'brush'} show  Which panel to show; the other is hidden.
   */
  _swapHtmlPanels(show) {
    // Sync + flush the incoming panel's texture BEFORE making it visible so
    // the mesh never appears with stale content even for a single frame.
    // Mount it into the host canvas first (it may have been unmounted while
    // hidden) so the flush actually rasterises it.
    const _prep = (p) => { if (!p) return; p._setHostMounted?.(true); p.syncFromState?.(); p.flushPaint?.(); };
    if (show === 'mini')   _prep(this._miniPanel);
    if (show === 'main')   _prep(this._mainMenuPanel);
    if (show === 'brush')  _prep(this._brushPanel);
    if (show === 'picker') _prep(this._toolPickerPanel);

    const mini   = this._miniPanel?.mesh;
    const brush  = this._brushPanel?.mesh;
    const picker = this._toolPickerPanel?.mesh;
    const main   = this._mainMenuPanel?.mesh;
    if (mini)   mini.visible   = (show === 'mini');
    // Pinned panels are world-anchored — don't hide them when swapping to another panel.
    if (brush)  brush.visible  = (show === 'brush') || !!this._brushPanel?.pinned;
    if (picker) picker.visible = (show === 'picker');
    if (main) {
      const keepMain = show === 'main' || !!this._mainMenuPanel?.pinned;
      if (keepMain) {
        this._mainMenuPanel.show(true);
      } else {
        this._mainMenuPanel.show(false);
      }
    }
  }

  _onBrushPanelPinChange(pinned) {
    if (!this._brushPanel || !this._brushPanel.mesh || !this._scene) return;
    // Cancel any in-progress grip drag when pin state changes
    this._bpDragActive = false;
    this._bpDragHand   = null;
    const mesh = this._brushPanel.mesh;
    if (pinned) {
      // Capture world position and re-parent to scene root.
      mesh.updateWorldMatrix(true, false);
      const worldMatrix = mesh.matrixWorld.clone();
      if (mesh.parent) mesh.parent.remove(mesh);
      this._scene.add(mesh);
      mesh.matrix.copy(worldMatrix);
      mesh.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
      mesh.matrixAutoUpdate = true;
    } else {
      // Remove from pinned parent.  Reset to wrist-local defaults so handleXRInput
      // can cleanly re-parent to uiGrip next frame without inheriting world-space values.
      // Hide it so it acts like a closed panel — user re-opens with the wrist button.
      if (mesh.parent) mesh.parent.remove(mesh);
      mesh.position.set(0.10, 0.10, -0.05);
      mesh.rotation.set(-Math.PI / 2, 0, 0);
      mesh.scale.set(1, -1, 1);   // preserve the flipY compensation set in _createMesh
      mesh.matrixAutoUpdate = true;
      mesh.visible = false;
    }
  }

  _openFilesPanel() {
    if (this._renderer?.xr?.isPresenting) {
      // VR: floating 3D panel
      const fp = this._filesPanel;
      if (!fp?.mesh) return;
      const cam = this._camera?.getThreeCamera();
      if (cam) {
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
        fp.mesh.position.copy(cam.position).addScaledVector(fwd, 0.55);
        fp.mesh.position.y -= 0.04;
        fp.mesh.quaternion.copy(cam.quaternion);
      }
      fp.open(this);
    } else {
      // Desktop: DOM overlay with full files menu
      openBrowserSavesDOMOverlay(this);
    }
  }

  _openVRTimeline() {
    if (window.screenLog) window.screenLog('[VR Timeline] _openVRTimeline start', 'yellow');
    const tl = this.getGui()?._ctrlTimeline;
    if (!tl) {
      if (window.screenLog) window.screenLog('[VR Timeline] no _ctrlTimeline', 'red');
      return;
    }

    // Resolve the persisted panel size (or defaults) and size the canvas to match
    // it BEFORE building/updating the mesh, so the texture is crisp and unstretched
    // on first open and reopen alike.
    const _opts   = window.getOptionsURL?.() || {};
    const _defAsp = 900 / 150;
    const _worldW = _opts.vrTimelineW > 0 ? _opts.vrTimelineW : 0.90;
    const _worldH = _opts.vrTimelineH > 0 ? _opts.vrTimelineH : _worldW / _defAsp;
    const _cssW   = Math.round(_worldW * 1500);
    const _cssH   = Math.round(_worldH * 1500);

    try { tl.openVRView(_cssW, _cssH); } catch (e) {
      if (window.screenLog) window.screenLog(`[VR Timeline] openVRView err: ${e?.message}`, 'red');
      console.error('[VR Timeline] openVRView error:', e);
      return;
    }

    // Always reset stale interaction flags from a previous session.
    this._vtlDragActive = false;   this._vtlDragHand = null;
    this._vtlWasPressed = false;   this._vtlLastDragUV = null;
    this._vtlResizeActive = false; this._vtlResizeHand = null;
    this._vtlResizeWasPressed = false;
    this._endVtlZoom(tl);

    if (!this._vrTimelineMesh) {
      const tex = new THREE.CanvasTexture(tl._canvas);
      // flipY=true (GL default): canvas top → UV y=1 → visual top. Display is correct.
      // Hit mapping: UV y=1 at visual top → need (1-uv.y) to get canvas y=0 (top). See _onVRTimelineHit.
      tex.flipY = true;
      this._vrTimelineTexture = tex;

      const geo = new THREE.PlaneGeometry(_worldW, _worldH);
      const mat = new THREE.MeshBasicMaterial({
        map: tex, transparent: true,
        side: THREE.DoubleSide, depthWrite: true, depthTest: true,
      });
      registerGradeMaterial(mat); // share the Settings menu brightness/saturation/gamma grade
      this._vrTimelineMesh = new THREE.Mesh(geo, mat);
      this._scene.add(this._vrTimelineMesh);

      // Resize handle: flat 2D corner-grip quad at the bottom-right corner.
      const hSize = 0.028; // 28mm square
      const hGeo = new THREE.PlaneGeometry(hSize, hSize);
      // Draw a corner-grip icon (3 diagonal tick lines) onto a canvas texture.
      const hCanvas = document.createElement('canvas');
      hCanvas.width = 64; hCanvas.height = 64;
      const hCtx = hCanvas.getContext('2d');
      hCtx.clearRect(0, 0, 64, 64);
      hCtx.strokeStyle = '#89dceb';
      hCtx.lineWidth = 4;
      hCtx.lineCap = 'round';
      // Three parallel diagonal lines from bottom-left to top-right of the corner area
      const lines = [[16, 56, 56, 16], [28, 56, 56, 28], [40, 56, 56, 40]];
      for (const [x1, y1, x2, y2] of lines) {
        hCtx.beginPath(); hCtx.moveTo(x1, y1); hCtx.lineTo(x2, y2); hCtx.stroke();
      }
      const hTex = new THREE.CanvasTexture(hCanvas);
      const hMat = new THREE.MeshBasicMaterial({
        map: hTex, transparent: true, side: THREE.DoubleSide,
        depthTest: true, depthWrite: false,
      });
      this._vrResizeHandle = new THREE.Mesh(hGeo, hMat);
      this._vrResizeHandle.visible = false;
      this._scene.add(this._vrResizeHandle);

      if (window.screenLog) window.screenLog(`[VR Timeline] mesh created ${_worldW.toFixed(2)}×${_worldH.toFixed(2)}m`, 'cyan');
    } else {
      // Reopen — apply the persisted size to geometry, clear any leftover scale,
      // and force the texture to re-upload at the new canvas resolution.
      this._vrTimelineMesh.scale.set(1, 1, 1);
      this._vrTimelineMesh.geometry.dispose();
      this._vrTimelineMesh.geometry = new THREE.PlaneGeometry(_worldW, _worldH);
      if (this._vrTimelineTexture) {
        this._vrTimelineTexture.dispose();
        this._vrTimelineTexture.needsUpdate = true;
      }
    }

    // Position at the main menu's world location, facing the camera (default
    // placement near the attached panel). Size is persisted; pose is not — a
    // saved world pose tended to reopen far from the user.
    const cam = this._camera?.getThreeCamera();
    const mm  = this._mainMenuPanel?.mesh;
    if (cam) {
      if (mm) {
        const pos = new THREE.Vector3();
        mm.getWorldPosition(pos);
        this._vrTimelineMesh.position.copy(pos);
      } else {
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
        this._vrTimelineMesh.position.copy(cam.position).addScaledVector(fwd, 0.50);
      }
      this._vrTimelineMesh.quaternion.copy(cam.quaternion);
    }
    this._vrTimelineMesh.visible = true;
    if (!this._vrTimelineCloseBtn) this._vrTimelineCloseBtn = this._makeVRCloseBtn();
    if (this._vrTimelineCloseBtn.parent !== this._vrTimelineMesh) this._vrTimelineMesh.add(this._vrTimelineCloseBtn);
    this._layoutTimelineCloseBtn();
    this._vrTimelineCloseBtn.visible = true;
    tl.draw();
    if (this._vrTimelineTexture) this._vrTimelineTexture.needsUpdate = true;
    this._mainMenuPanel?._element?.querySelector('#mm-tl-btn')?.classList.add('tl-on');
    if (window.screenLog) window.screenLog('[VR Timeline] open', 'lime');
  }

  _closeVRTimeline() {
    if (this._vrTimelineMesh) this._vrTimelineMesh.visible = false;
    if (this._vrTimelineCloseBtn) this._vrTimelineCloseBtn.visible = false;
    if (this._vrResizeHandle) this._vrResizeHandle.visible = false;
    if (this._vtlSecLaser) this._vtlSecLaser.visible = false;
    this.getGui()?._ctrlTimeline?.closeVRView();
    document.querySelectorAll('#acp-show-timeline').forEach(cb => { cb.checked = false; });
    this._mainMenuPanel?._element?.querySelector('#mm-tl-btn')?.classList.remove('tl-on');
  }

  // ── VR Blendshape layer-stack panel ───────────────────────────────────────────
  // Mounts the canvas BlendshapeStackPanel as a textured plane in VR (mirrors the
  // VR timeline canvas→texture pattern). Portrait panel; point + dominant trigger
  // to interact, secondary trigger + eye = solo.
  _openVRBlendshapes() {
    // Half the previous size. Both the canvas px AND the world plane shrink by the
    // same factor (1500 px/m kept), so UI elements stay the same physical size to
    // the user — the panel just shows less at once, it doesn't scale the content.
    const _worldW = 0.17, _worldH = 0.23;       // portrait layer stack (was 0.34×0.46)
    const _cssW   = Math.round(_worldW * 1500); // 255
    const _cssH   = Math.round(_worldH * 1500); // 345

    if (!this._vrBlendPanel) {
      // VR instance shares all state via window._animationRegistry; getMesh() comes
      // from the Scene so it tracks the active mesh.
      this._vrBlendPanel = new BlendshapeStackPanel({ getMesh: () => this.getMesh() });
      const canvas = this._vrBlendPanel.mountVR(_cssW, _cssH);

      const tex = new THREE.CanvasTexture(canvas);
      tex.flipY = true; // canvas top → UV y=1 → visual top (hit map inverts Y)
      this._vrBlendTexture = tex;

      const geo = new THREE.PlaneGeometry(_worldW, _worldH);
      const mat = new THREE.MeshBasicMaterial({
        map: tex, transparent: true,
        side: THREE.DoubleSide, depthWrite: true, depthTest: true,
      });
      registerGradeMaterial(mat); // share the Settings menu brightness/saturation/gamma grade
      this._vrBlendMesh = new THREE.Mesh(geo, mat);
      this._scene.add(this._vrBlendMesh);
      if (window.screenLog) window.screenLog(`[VR Blendshapes] mesh created ${_worldW}×${_worldH}m`, 'cyan');
    }

    // Spawn beside the wrist menu (reachable) but ALWAYS orient to face the camera
    // — same as the VR timeline. Copying the menu's own quaternion span-flips the
    // panel 180° in-plane (upside-down + mirrored), because the menu's up/facing
    // convention differs from a camera-facing plane. Offset along camera-right so
    // it sits next to the menu from the user's viewpoint.
    const mm  = this._mainMenuPanel?.mesh;
    const cam = this._camera?.getThreeCamera();
    if (cam) {
      const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
      if (mm) {
        const mPos = new THREE.Vector3(); mm.getWorldPosition(mPos);
        const menuHalfW = (mm.geometry?.parameters?.width ?? 0.30) * 0.5;
        mPos.addScaledVector(camRight, menuHalfW + _worldW / 2 + 0.02); // beside, small gap
        this._vrBlendMesh.position.copy(mPos);
      } else {
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
        this._vrBlendMesh.position.copy(cam.position).addScaledVector(fwd, 0.4);
      }
      this._vrBlendMesh.quaternion.copy(cam.quaternion);
    }
    this._vrBlendMesh.visible = true;
    // Corner close button (same style as the timeline), parented to the panel mesh.
    if (!this._vrBlendCloseBtn) this._vrBlendCloseBtn = this._makeVRCloseBtn();
    if (this._vrBlendCloseBtn.parent !== this._vrBlendMesh) this._vrBlendMesh.add(this._vrBlendCloseBtn);
    this._layoutCloseBtn(this._vrBlendCloseBtn, this._vrBlendMesh);
    this._vrBlendCloseBtn.visible = true;
    this._vrBlendPanel.setVRVisible(true);
    if (this._vrBlendTexture) this._vrBlendTexture.needsUpdate = true;
    this._mainMenuPanel?._element?.querySelector('#mm-bs-btn')?.classList.add('tl-on');
    if (window.screenLog) window.screenLog('[VR Blendshapes] open', 'lime');
  }

  _closeVRBlendshapes() {
    if (this._vrBlendMesh) this._vrBlendMesh.visible = false;
    if (this._vrBlendCloseBtn) this._vrBlendCloseBtn.visible = false;
    this._vrBlendPanel?.setVRVisible(false);
    this._mainMenuPanel?._element?.querySelector('#mm-bs-btn')?.classList.remove('tl-on');
  }

  // Map a UV hit on the blend mesh to canvas coords and dispatch to the panel.
  _onVRBlendshapesHit(uv, phase, solo = false) {
    const panel = this._vrBlendPanel;
    if (!panel) return;
    const x =        uv.x  * panel._cssW;
    const y = (1.0 - uv.y) * panel._cssH; // flipY=true → invert Y
    panel.vrPointer(x, y, phase, solo);
    if (this._vrBlendTexture) this._vrBlendTexture.needsUpdate = true;
  }

  // A small corner "X" close button mesh for a floating VR panel (the canvas blend
  // panel draws its own close icon; the timeline — whose canvas we don't touch —
  // uses this). Returned unparented; the caller adds it as a CHILD of the panel
  // mesh so it rides the panel's transform rigidly (no per-frame re-constraining,
  // no trailing when the panel is grip-dragged).
  _makeVRCloseBtn() {
    const size = 0.030;
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const x = c.getContext('2d');
    x.fillStyle = 'rgba(28,28,38,0.92)';
    x.beginPath(); x.arc(32, 32, 29, 0, Math.PI * 2); x.fill();
    x.strokeStyle = '#f38ba8'; x.lineWidth = 7; x.lineCap = 'round';
    x.beginPath(); x.moveTo(22, 22); x.lineTo(42, 42); x.moveTo(42, 22); x.lineTo(22, 42); x.stroke();
    const tex = new THREE.CanvasTexture(c);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthTest: true, depthWrite: false });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
    m.renderOrder = 1000;
    return m;
  }

  // Place a close button just OUTSIDE the top-right corner of its panel, in the
  // panel's LOCAL space (it's a child of the panel mesh). Re-run when the panel's
  // half-extents change. Sitting just past the edge keeps it off the content.
  _layoutCloseBtn(btn, panelMesh) {
    if (!btn || !panelMesh) return;
    const hw = panelMesh.geometry.parameters.width  * 0.5;
    const hh = panelMesh.geometry.parameters.height * 0.5;
    btn.position.set(hw + 0.012, hh + 0.012, 0.001);
    btn.quaternion.identity(); // local to parent
  }
  _layoutTimelineCloseBtn() { this._layoutCloseBtn(this._vrTimelineCloseBtn, this._vrTimelineMesh); }

  // Hover feedback for a corner close button: brighten + grow while pointed at.
  // `flagKey` is set true by the input dispatch and consumed (reset) here.
  _applyCloseBtnHover(btn, flagKey) {
    if (!btn) return;
    const hov = this[flagKey];
    btn.scale.setScalar(hov ? 1.25 : 1.0);
    btn.material.color.setHex(hov ? 0xffffff : 0xc8c8c8);
    this[flagKey] = false;
  }

  // Compute a controller's picking ray (origin/dir) from its Three.js object —
  // same offset/tilt convention as the dominant-hand panel raycast.
  _controllerRay(ctrl3D) {
    if (!ctrl3D) return null;
    ctrl3D.updateMatrixWorld(true);
    const off  = this.getStylusOffset();
    const tilt = this.getStylusTilt() * Math.PI / 180.0;
    const origin = new THREE.Vector3(0, 0, -off).applyMatrix4(ctrl3D.matrixWorld);
    const dir    = new THREE.Vector3(0, Math.sin(tilt), -Math.cos(tilt)).transformDirection(ctrl3D.matrixWorld).normalize();
    return { origin, dir };
  }

  _raycastTimeline(ray, mesh) {
    if (!ray || !mesh) return null;
    if (!this._vtlZoomRC) this._vtlZoomRC = new THREE.Raycaster();
    this._vtlZoomRC.set(ray.origin, ray.dir);
    const h = this._vtlZoomRC.intersectObject(mesh);
    return h.length ? h[0] : null;
  }

  _endVtlZoom(tl) {
    if (this._vtlZoomActive) { tl?.endTwoPointerZoom?.(); this._vtlZoomActive = false; }
  }


  // Show a white laser from the NON-dominant controller when it aims at the
  // timeline (the dominant hand already has VRLaser). Uses a dedicated cylinder
  // mesh we position from the controller to the hit point — independent of the
  // built-in per-controller ray, which may be hidden for the non-dominant hand.
  _updateSecondaryTimelineLaser() {
    const mesh = this._vrTimelineMesh;
    if (!this._vtlSecLaser) {
      // Match the primary controller ray (pointer_ray_root): a 1 m unit tube along
      // -Z with the same white fade shader, scaled to the hit distance each frame.
      const g = new THREE.CylinderGeometry(0.001, 0.001, 1, 8, 1, true);
      g.rotateX(-Math.PI / 2);   // cylinder Y-axis → -Z
      g.translate(0, 0, -0.5);   // base at z=0, tip at z=-1
      const m = new THREE.ShaderMaterial({
        vertexShader: `varying float vFade; void main() { vFade = 1.0 - clamp((uv.y - 0.5) * 2.0, 0.0, 1.0); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `varying float vFade; void main() { gl_FragColor = vec4(1.0, 1.0, 1.0, vFade * 0.85); }`,
        transparent: true, depthTest: true, depthWrite: false,
        blending: THREE.NormalBlending, side: THREE.DoubleSide,
      });
      this._vtlSecLaser = new THREE.Mesh(g, m);
      this._vtlSecLaser.visible = false;
      this._vtlSecLaser.renderOrder = 999;
      this._scene.add(this._vtlSecLaser);
    }
    const laser = this._vtlSecLaser;
    const nonDom = this._dominantHand === 'right' ? this._vrControllerLeft : this._vrControllerRight;
    if (!mesh || !mesh.visible || !nonDom) { laser.visible = false; return; }

    const ray = this._controllerRay(nonDom);
    const hit = this._raycastTimeline(ray, mesh);
    if (!ray || !hit) { laser.visible = false; return; }

    laser.position.copy(ray.origin);
    laser.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), ray.dir);
    laser.scale.set(1, 1, Math.max(0.01, hit.distance));
    laser.visible = true;
  }

  // Two-handed VR zoom: when BOTH controllers point at empty timeline graph space
  // with triggers held, controller separation drives non-linear zoom (horizontal →
  // time, vertical → value). Runs once per frame, before the dominant-hand dispatch
  // so it can suppress the single-hand pan.
  _updateVRTimelineZoom(leftSrc, rightSrc) {
    // Keep the non-dominant controller's aim laser in sync every frame.
    this._updateSecondaryTimelineLaser();

    const tl = this.getGui()?._ctrlTimeline;
    const mesh = this._vrTimelineMesh;
    if (!tl || !mesh || !mesh.visible || this._vtlResizeActive) { this._endVtlZoom(tl); return; }

    const pressed = (s) => !!(s?.gamepad?.buttons?.[0]) && (s.gamepad.buttons[0].pressed || s.gamepad.buttons[0].value > 0.1);
    if (!pressed(leftSrc) || !pressed(rightSrc)) { this._endVtlZoom(tl); return; }

    const hitL = this._raycastTimeline(this._controllerRay(this._vrControllerLeft),  mesh);
    const hitR = this._raycastTimeline(this._controllerRay(this._vrControllerRight), mesh);
    if (!hitL || !hitR) { this._endVtlZoom(tl); return; }

    const cssW = tl._cssWidth, cssH = tl._cssHeight;
    const pL = { cx: hitL.uv.x * cssW, cy: (1 - hitL.uv.y) * cssH };
    const pR = { cx: hitR.uv.x * cssW, cy: (1 - hitR.uv.y) * cssH };

    if (!this._vtlZoomActive) {
      // Both controllers must be over empty graph space to START the gesture.
      if (!tl.isEmptyGraphSpaceAt(pL.cx, pL.cy) || !tl.isEmptyGraphSpaceAt(pR.cx, pR.cy)) return;
      // Cancel any single-hand pan that may have begun, then capture the anchors.
      this._onVRTimelineHit({ x: 0.5, y: 0.5 }, 'up', false);
      tl._cancelActiveAction?.();
      tl.beginTwoPointerZoom(pL.cx, pL.cy, pR.cx, pR.cy);
      this._vtlZoomActive = true;
    } else {
      tl.updateTwoPointerZoom(pL.cx, pL.cy, pR.cx, pR.cy);
    }
  }

  _onVRTimelineHit(uv, type, pressed, shiftKey = false) {
    const tl = this.getGui()?._ctrlTimeline;
    if (!tl) return;
    const canvas = tl._canvas;
    // Mesh uses flipY=true (GL default): canvas top → UV y=1 → visual top.
    // So UV y=1 = canvas y=0, UV y=0 = canvas y=cssH → invert Y.
    // X is not inverted: UV x=0 = canvas left.
    // Container is display:none so rect={0,0}; clientX/Y are pixel offsets into the canvas.
    const cssW = tl._cssWidth  || 900;
    const cssH = tl._cssHeight || 150;
    const clientX =        uv.x  * cssW;
    const clientY = (1.0 - uv.y) * cssH;
    // GuiTimeline uses PointerEvents (pointerdown/move/up) not MouseEvents.
    // Use a fixed pointerId so setPointerCapture(1) on down routes move/up correctly.
    // shiftKey=true activates additive marquee mode (non-dominant trigger held).
    const buttons = pressed ? 1 : 0;
    if (type === 'down') {
      canvas.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, cancelable: true, clientX, clientY,
        button: 0, buttons: 1, pointerId: 1, isPrimary: true, pointerType: 'mouse',
        shiftKey,
      }));
    } else if (type === 'move') {
      window.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true, cancelable: true, clientX, clientY,
        button: -1, buttons, pointerId: 1, isPrimary: true, pointerType: 'mouse',
        shiftKey,
      }));
    } else if (type === 'up') {
      window.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true, cancelable: true, clientX, clientY,
        button: 0, buttons: 0, pointerId: 1, isPrimary: true, pointerType: 'mouse',
        shiftKey,
      }));
    }
  }

  _onMainMenuPanelPinChange(pinned) {
    if (!this._mainMenuPanel || !this._mainMenuPanel.mesh || !this._scene) return;
    this._mmDragActive = false;
    this._mmDragHand   = null;
    const mesh = this._mainMenuPanel.mesh;
    if (pinned) {
      mesh.updateWorldMatrix(true, false);
      const worldMatrix = mesh.matrixWorld.clone();
      if (mesh.parent) mesh.parent.remove(mesh);
      this._scene.add(mesh);
      mesh.matrix.copy(worldMatrix);
      mesh.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
      mesh.matrixAutoUpdate = true;
    } else {
      if (mesh.parent) mesh.parent.remove(mesh);
      mesh.position.set(0.10, 0.10, -0.05);
      mesh.rotation.set(-Math.PI / 2, 0, 0);
      mesh.scale.set(1, -1, 1);
      mesh.matrixAutoUpdate = true;
      mesh.visible = false;
    }
  }

  /**
   * [HTMLVRPanel] Update the billboard ring reticle shown when a controller
   * points at a UI panel.  Creates the mesh lazily on first call.
   *
   * @param {THREE.Vector3|null} hitPoint  World-space hit position, or null to hide.
   * @param {boolean}            visible
   */

  _tearOffSection(sectionId) {
    if (this._tornOffPanels.has(sectionId)) return;
    if (!this._scene || !this._camera || !this._renderer) return;

    const main  = this;
    const idx   = this._tornOffPanels.size;
    const panel = new TornOffPanel(sectionId, main, this._scene, this._camera.getThreeCamera(), this._renderer);

    panel._element.addEventListener('mm-section-redock', (e) => {
      this._reDockSection(e.detail.section);
    });

    panel.bindDesktopPointers(this._renderer, this._camera.getThreeCamera());

    drainRAF();
    drainRAF();

    const _placeTornPanel = () => {
      if (!panel.mesh) return;
      const cam = this._camera.getThreeCamera();
      // Position: use the main panel's world position so the panel appears
      // right where the user is already looking.
      const mmMesh = this._mainMenuPanel?.mesh;
      if (mmMesh) {
        mmMesh.updateWorldMatrix(true, false);
        const worldPos = new THREE.Vector3();
        mmMesh.getWorldPosition(worldPos);
        // Nudge toward the viewer slightly per panel index to avoid z-fighting.
        const towardCam = new THREE.Vector3(0, 0, 1).applyQuaternion(cam.quaternion);
        panel.mesh.position.copy(worldPos).addScaledVector(towardCam, 0.02 + idx * 0.015);
      } else {
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
        panel.mesh.position.copy(cam.position).addScaledVector(forward, 0.6);
      }
      // Orientation: use cam.quaternion directly — same as the VR timeline.
      // HTMLVRPanel uses flipY=false + scale.y=-1 which is net-equivalent to
      // flipY=true + scale.y=1, so cam.quaternion produces the correct facing.
      panel.mesh.quaternion.copy(cam.quaternion);
      // _createMesh already adds the mesh to this._scene. Ensure it stays there,
      // not in worldGroup (which has 125× sculpt-engine scale).
      if (panel.mesh.parent !== this._scene && this._scene) {
        this._scene.add(panel.mesh);
      }
    };
    _placeTornPanel();

    if (!panel.mesh) {
      console.log(`[TearOff] mesh not ready, storing _pendingPlace`);
      panel._pendingPlace = _placeTornPanel;
    }

    this._tornOffPanels.set(sectionId, panel);
    this._mainMenuPanel?.notifyTearOff(sectionId);
  }

  _reDockSection(sectionId) {
    const panel = this._tornOffPanels.get(sectionId);
    if (!panel) return;
    if (panel.mesh?.parent) panel.mesh.parent.remove(panel.mesh);
    panel.dispose();
    this._tornOffPanels.delete(sectionId);
    this._mainMenuPanel?.notifyReDock(sectionId);
  }

  _updateBPCursor(hitPoint, visible) {
    if (!this._scene) return;

    if (!this._bpReticle) {
      const geo = new THREE.CircleGeometry(0.0014, 16);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.8,
        depthTest: false, side: THREE.DoubleSide,
      });
      this._bpReticle = new THREE.Mesh(geo, mat);
      this._bpReticle.renderOrder = 1001;
      this._bpReticle.visible = false;
      this._scene.add(this._bpReticle);
    }

    if (!visible || !hitPoint) {
      this._bpReticle.visible = false;
      return;
    }

    this._bpReticle.position.copy(hitPoint);
    // Billboard: face the viewer camera
    const cam = this._camera && this._camera.getThreeCamera ? this._camera.getThreeCamera() : null;
    if (cam) this._bpReticle.quaternion.copy(cam.quaternion);
    this._bpReticle.visible = true;
  }

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



    // 1. Synchronize UI Mesh Visibility with Application State.
    // These are VR canvas menus parented near a controller — they must never show
    // on desktop/iPad (where they'd sit at the world origin). Gate on the XR session.
    const _xrOn = !!(this._renderer && this._renderer.xr && this._renderer.xr.isPresenting);
    if (this._vrMenu && this._guiXR) {
        // In HTML panel mode the old canvas VRMenu is always hidden; the
        // MainMenuPanel on the wrist replaces it.
        this._vrMenu.mesh.visible = _xrOn && (window._brushPanelEnabled !== false
          ? false
          : !!this._guiXR._isVisible);
    }
    if (this._vrPopup && this._guiPopup) {
        this._vrPopup.mesh.visible = _xrOn && !!this._guiPopup._isVisible && !!this._guiPopup._overlay;
    }
    if (this._vrMiniHUD && this._guiMini) {
        // Hide MiniHUD if the old legacy Main Menu or Popup is visible.
        const isLegacyMenuVisible = this._guiXR && this._guiXR._isVisible;
        const isPopupVisible = this._guiPopup && this._guiPopup._isVisible && this._guiPopup._overlay;
        // Suppress MiniHUD when HTML panel mode is enabled AND any HTML panel is
        // visible (MiniPanel, BrushPanel, MainMenuPanel, ToolPicker).
        const isHtmlPanelShowing = window._brushPanelEnabled !== false
          && (!!(this._brushPanel?.mesh?.visible)
           || !!(this._miniPanel?.mesh?.visible)
           || !!(this._toolPickerPanel?.mesh?.visible)
           || !!(this._mainMenuPanel?.mesh?.visible));
        this._vrMiniHUD.mesh.visible = _xrOn && !this._htmlPanelsHidden && !!this._guiMini._isVisible && !isLegacyMenuVisible && !isPopupVisible && !isHtmlPanelShowing;
    }

    this._isPointingAtMenu = false;
    if (this._bpCursorDot) this._bpCursorDot.visible = false; // legacy; kept for safety
    if (this._bpReticle) this._bpReticle.visible = false; // reset each frame; panel hit logic re-shows it
    this._vrUIHitDistLeft   = Infinity;  // reset each frame — prevents stale laser depth
    this._vrUIHitDistRight  = Infinity;  // from persisting when _isPointingAtMenu is set by another source
    this._vrUIHitSourceLeft  = null;     // debug: which panel set the left hit distance
    this._vrUIHitSourceRight = null;     // debug: which panel set the right hit distance

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

            // [HTMLVRPanel] Attach BrushPanel to wrist unless it's been pinned.
            if (this._brushPanel && this._brushPanel.mesh && !this._brushPanel.pinned) {
              if (this._brushPanel.mesh.parent !== uiGrip) {
                uiGrip.add(this._brushPanel.mesh);
              }
            }

            // [HTMLVRPanel] Attach MiniPanel to wrist (no pin button — always wrist-local).
            if (this._miniPanel && this._miniPanel.mesh && !this._miniPanel.pinned) {
              if (this._miniPanel.mesh.parent !== uiGrip) uiGrip.add(this._miniPanel.mesh);
            }
            if (this._toolPickerPanel && this._toolPickerPanel.mesh) {
              if (this._toolPickerPanel.mesh.parent !== uiGrip) uiGrip.add(this._toolPickerPanel.mesh);
            }
            // [HTMLVRPanel] Attach MainMenuPanel to wrist unless pinned in world space.
            if (this._mainMenuPanel && this._mainMenuPanel.mesh && !this._mainMenuPanel.pinned) {
              if (this._mainMenuPanel.mesh.parent !== uiGrip) {
                uiGrip.add(this._mainMenuPanel.mesh);
              }
            }
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

    // Two-handed VR timeline zoom — evaluated before the per-controller dispatch
    // so an active gesture suppresses the dominant hand's single-pointer pan.
    try { this._updateVRTimelineZoom(left, right); } catch (_) {}

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
          if ((this._isPointingAtMenu || this._wasPointingAtMenu) && Math.abs(valY_NonDom) > T_PRESS) {
            const domSource = this._dominantHand === 'left' ? left : right;
            const isSlowMod = domSource?.gamepad?.buttons[0]?.pressed ?? false;
            const scrollSpeed = isSlowMod ? 12 : 55; // px per frame at full push; hold trigger for fine scroll
            const delta = valY_NonDom * scrollSpeed; // proportional to stick deflection

            // Canvas BlendshapeStackPanel (ARKit picker) — when the ray is on it.
            if ((this._vbsPanelPointed || this._wasVbsPanelPointed) && this._vrBlendPanel) {
              this._vrBlendPanel.onVRScroll(delta);
            } else if (window._brushPanelEnabled !== false) {
              // HTML panel mode — scroll the panel the ray was on last frame
              if (this._lastHtmlPanelHit) this._lastHtmlPanelHit.onVRScroll(delta);
            } else if (this._guiXR) {
              // Legacy canvas menu
              this._guiXR._scrollOffset += delta;
              this._guiXR._scrollOffset = Math.max(0, Math.min(this._guiXR._scrollOffset, this._guiXR._maxScroll || 0));
              this._guiXR._needsRedraw = true;
            }
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

          if ((this._isPointingAtMenu || this._wasPointingAtMenu) && isPressedY) {
            const isSlowMod = nonDomSource?.gamepad?.buttons[0]?.pressed ?? false;
            const scrollSpeed = isSlowMod ? 12 : 55;
            const delta = valY * scrollSpeed; // proportional to stick deflection

            if ((this._vbsPanelPointed || this._wasVbsPanelPointed) && this._vrBlendPanel) {
              this._vrBlendPanel.onVRScroll(delta);
            } else if (window._brushPanelEnabled !== false) {
              if (this._lastHtmlPanelHit) this._lastHtmlPanelHit.onVRScroll(delta);
            } else if (this._guiXR) {
              if (this._guiXR._overlay === 'menu') {
                this._guiXR._scrollOffsetOverlay += delta;
                this._guiXR._scrollOffsetOverlay = Math.max(0, Math.min(this._guiXR._scrollOffsetOverlay, this._guiXR._maxScrollOverlay || 0));
                if (this._guiXR._overlayData && (this._guiXR._overlayData.tabName === 'About & Help' || this._guiXR._overlayData.tabName === 'About')) {
                  window._sculptAboutScroll = this._guiXR._scrollOffsetOverlay;
                }
              } else {
                this._guiXR._scrollOffset += delta;
                this._guiXR._scrollOffset = Math.max(0, Math.min(this._guiXR._scrollOffset, this._guiXR._maxScroll || 0));
              }
              this._guiXR._needsRedraw = true;
            }
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

          // NON-DOMINANT HAND: 'X' or 'A' Button (Button 4)
          // HTML panel mode  → toggle MainMenuPanel / MiniPanel
          // Legacy mode      → toggle main GuiXR canvas menu
          if (isNonDom) {
            const btnX = btns[4];
            const handKey = this._dominantHand === 'right' ? 'left' : 'right';
            const tracker = this._vrButtonStates[handKey].Primary;
            if (btnX && btnX.pressed !== tracker.pressed) {
              if (btnX.pressed) {
                // Button Down: Activate INSTANTLY
                tracker.time = now;
                tracker.longPressActive = false;
                if (window._brushPanelEnabled !== false) {
                  // HTML panel mode: X toggles between MiniPanel and MainMenuPanel
                  const mainVisible = !!(this._mainMenuPanel?.mesh?.visible);
                  this._swapHtmlPanels(mainVisible ? 'mini' : 'main');
                  console.log(`[VR X Button] ${mainVisible ? 'MainMenu → MiniPanel' : 'MiniPanel → MainMenu'}`);
                  if (window.screenLog) window.screenLog(`[X] ${mainVisible ? 'MiniPanel' : 'MainMenu'}`, 'cyan');
                  if (this._guiPopup) this._guiPopup.closeOverlay();
                } else if (this._guiXR) {
                  // Legacy mode: toggle the big canvas menu
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
                  // Momentary Release -> Revert swap in reverse
                  if (window._brushPanelEnabled !== false) {
                    const mainVisible = !!(this._mainMenuPanel?.mesh?.visible);
                    this._swapHtmlPanels(mainVisible ? 'mini' : 'main');
                    console.log(`[VR X Button] Reverted: ${mainVisible ? 'MiniPanel' : 'MainMenu'} shown`);
                    if (this._guiPopup) this._guiPopup.closeOverlay();
                  } else if (this._guiXR) {
                    this._guiXR.toggleVisibility();
                    console.log(`[VR X Button] Reverting main menu visibility to ${this._guiXR._isVisible}`);
                    if (this._guiPopup) this._guiPopup.closeOverlay();
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
                // Visibility was already toggled on press-down
              }
            }
          }

          // NON-DOMINANT HAND: Y/B Button (Button 5) — hide/show all HTML panels
          // Diagnostic toggle: lets us measure frame cost of the HTML panel system.
          if (isNonDom) {
            const btnY = btns[5];
            if (btnY && btnY.pressed && !this._btnYWasPressed) {
              this._htmlPanelsHidden = !this._htmlPanelsHidden;
              const hide = this._htmlPanelsHidden;
              const panels = [
                this._brushPanel, this._miniPanel, this._mainMenuPanel,
                this._toolPickerPanel, this._filesPanel, this._animPanel,
              ];
              panels.forEach(p => { if (p?.mesh) p.mesh.visible = !hide; });
              this._tornOffPanels?.forEach(p => { if (p?.mesh) p.mesh.visible = !hide; });
              if (window.screenLog) window.screenLog(`[Y] panels ${hide ? 'HIDDEN' : 'shown'}`, hide ? 'orange' : 'lime');
            }
            this._btnYWasPressed = !!(btnY?.pressed);
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
                // Guard: skip legacy MiniHUD poke when any HTML panel is visible
                const _htHtmlPanelVisible = window._brushPanelEnabled !== false
                  && (!!(this._brushPanel?.mesh?.visible)
                   || !!(this._miniPanel?.mesh?.visible)
                   || !!(this._toolPickerPanel?.mesh?.visible)
                   || !!(this._mainMenuPanel?.mesh?.visible));
                if (this._vrMiniHUD && this._guiMini && this._guiMini._isVisible && !_htHtmlPanelVisible) {
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

          // ── Unified HTML panel raycast: collect all hits, dispatch only to nearest ──
          // All panels share the same origin/dir — one raycaster suffices.
          if (!this._vrSharedRaycaster) {
            this._vrSharedRaycaster = new THREE.Raycaster();
            this._vrSharedRayOrigin = new THREE.Vector3();
            this._vrSharedRayDir    = new THREE.Vector3();
          }
          this._vrSharedRayOrigin.set(origin[0], origin[1], origin[2]);
          this._vrSharedRayDir.set(dir[0], dir[1], dir[2]).normalize();
          this._vrSharedRaycaster.set(this._vrSharedRayOrigin, this._vrSharedRayDir);
          const _rc = this._vrSharedRaycaster;

          // Phase 1: collect hits — { name, panel, hit, pressKey, isTimeline }
          const _panelHits = [];
          // When the VR numpad is open it is modal: skip all other panels in the
          // hit collection so they can never win while the numpad is visible.
          // They still appear in _allVisible and receive leave events, but no
          // press/release events can reach them through the numpad.
          // isBlockingOpen extends the guard for 400ms after close so that the
          // controller's trigger-release (and any residual hit on e.g. the FPS
          // slider behind the numpad) is absorbed during the cooldown window.
          const _numpadOpen = !!this._vrNumpad?.mesh?.visible || !!this._vrNumpad?.isBlockingOpen
                            || !!this._vrConfirm?.mesh?.visible || !!this._vrConfirm?.isBlockingOpen;
          if (!_numpadOpen) {
            if (this._brushPanel?.mesh?.visible && window._brushPanelEnabled !== false) {
              const h = _rc.intersectObject(this._brushPanel.mesh);
              if (h.length > 0) _panelHits.push({ name: 'BrushPanel', panel: this._brushPanel, hit: h[0], pressKey: '_bpWasPressed' });
            }
            if (this._miniPanel?.mesh?.visible && window._brushPanelEnabled !== false) {
              const h = _rc.intersectObject(this._miniPanel.mesh);
              if (h.length > 0) _panelHits.push({ name: 'MiniPanel', panel: this._miniPanel, hit: h[0], pressKey: '_mpWasPressed' });
            }
            if (this._toolPickerPanel?.mesh?.visible && window._brushPanelEnabled !== false) {
              const h = _rc.intersectObject(this._toolPickerPanel.mesh);
              if (h.length > 0) _panelHits.push({ name: 'ToolPickerPanel', panel: this._toolPickerPanel, hit: h[0], pressKey: '_tpWasPressed' });
            }
            if (this._mainMenuPanel?.mesh?.visible) {
              const h = _rc.intersectObject(this._mainMenuPanel.mesh);
              if (h.length > 0) _panelHits.push({ name: 'MainMenuPanel', panel: this._mainMenuPanel, hit: h[0], pressKey: '_mmWasPressed' });
            }
            if (this._tornOffPanels.size > 0) {
              this._tornOffPanels.forEach((panel, sectionId) => {
                if (!panel.mesh?.visible) return;
                const h = _rc.intersectObject(panel.mesh);
                if (h.length > 0) _panelHits.push({ name: 'TornOff:' + sectionId, panel, hit: h[0], pressKey: '_topWasPressed_' + sectionId });
              });
            }
            if (this._filesPanel?.mesh?.visible) {
              const h = _rc.intersectObject(this._filesPanel.mesh);
              if (h.length > 0) _panelHits.push({ name: 'FilesPanel', panel: this._filesPanel, hit: h[0], pressKey: '_fpWasPressed' });
            }
          }
          if (this._vrNumpad?.mesh?.visible) {
            const h = _rc.intersectObject(this._vrNumpad.mesh);
            if (h.length > 0) _panelHits.push({ name: 'VrNumpad', panel: this._vrNumpad, hit: h[0], pressKey: '_npWasPressed' });
          }
          if (this._vrConfirm?.mesh?.visible) {
            const h = _rc.intersectObject(this._vrConfirm.mesh);
            if (h.length > 0) _panelHits.push({ name: 'VrConfirm', panel: this._vrConfirm, hit: h[0], pressKey: '_vcWasPressed' });
          }
          // VRTimeline uses a different dispatch interface — included for nearest-hit ordering.
          // Skipped while the numpad is modal-open: the numpad floats just in front of
          // the timeline, so without this the ray could also strike the panel behind it.
          this._vtlIsPointing = false;
          this._vbsIsPointing = false;
          if (!_numpadOpen) {
            if (this._vrResizeHandle?.visible) {
              const h = _rc.intersectObject(this._vrResizeHandle);
              if (h.length > 0) _panelHits.push({ name: 'VRTimelineResize', panel: null, hit: h[0], pressKey: '_vtlResizeWasPressed', isTimelineResize: true });
            }
            if (this._vrTimelineMesh?.visible) {
              // NON-recursive: the close button is a child of this mesh; a recursive
              // raycast would also hit it and tag it as the timeline panel, stealing
              // the hit from its own dedicated close test below.
              const h = _rc.intersectObject(this._vrTimelineMesh, false);
              if (h.length > 0) _panelHits.push({ name: 'VRTimeline', panel: null, hit: h[0], pressKey: '_vtlWasPressed', isTimeline: true });
            }
            if (this._vrBlendMesh?.visible) {
              const h = _rc.intersectObject(this._vrBlendMesh, false);
              if (h.length > 0) _panelHits.push({ name: 'VRBlendshapes', panel: null, hit: h[0], pressKey: '_vbsWasPressed', isBlendshapes: true });
            }
            if (this._vrTimelineCloseBtn?.visible) {
              // Child of the timeline mesh — sync its world matrix so the collision
              // geometry matches where it's drawn (esp. after a grip-drag).
              this._vrTimelineCloseBtn.updateWorldMatrix(true, false);
              const h = _rc.intersectObject(this._vrTimelineCloseBtn, false);
              if (h.length > 0) _panelHits.push({ name: 'VRTimelineClose', panel: null, hit: h[0], pressKey: '_vtlCloseWasPressed', isTimelineClose: true });
            }
            if (this._vrBlendCloseBtn?.visible) {
              this._vrBlendCloseBtn.updateWorldMatrix(true, false);
              const h = _rc.intersectObject(this._vrBlendCloseBtn, false);
              if (h.length > 0) _panelHits.push({ name: 'VRBlendClose', panel: null, hit: h[0], pressKey: '_vbsCloseWasPressed', isBlendClose: true });
            }
          }

          // Phase 2: nearest hit wins
          _panelHits.sort((a, b) => a.hit.distance - b.hit.distance);
          let _winner = _panelHits[0] ?? null;
          let _winnerName = _winner?.name ?? null;
          const _trigger = source.gamepad?.buttons[0];
          const _pressed = _trigger ? (_trigger.value > 0.1 || _trigger.pressed) : false;

          // Phase 2b: Drag lock — keep routing to whichever panel has an active
          // slider drag even after the controller ray exits its bounds.
          // Project the ray onto the panel plane to get a (possibly out-of-bounds)
          // UV; _sliderValueFromAbsX clamps the result, so the slider pegs at its
          // min/max rather than jumping when the cursor strays off the edge.
          {
            const _dragCandidates = [
              { name: 'MainMenuPanel',   panel: this._mainMenuPanel,      pressKey: '_mmWasPressed' },
              { name: 'FilesPanel',      panel: this._filesPanel,         pressKey: '_fpWasPressed' },
              { name: 'BrushPanel',      panel: this._brushPanel,         pressKey: '_bpWasPressed' },
              { name: 'MiniPanel',       panel: this._miniPanel,          pressKey: '_mpWasPressed' },
              { name: 'ToolPickerPanel', panel: this._toolPickerPanel,    pressKey: '_tpWasPressed' },
              { name: 'VrNumpad',        panel: this._vrNumpad,           pressKey: '_npWasPressed' },
            ];
            this._tornOffPanels?.forEach((panel, sectionId) => {
              _dragCandidates.push({ name: 'TornOff:' + sectionId, panel, pressKey: '_topWasPressed_' + sectionId });
            });
            const _locked = _dragCandidates.find(v => v.panel?._sliderDragTarget && v.panel?.mesh);
            if (_locked) {
              const pm = _locked.panel.mesh;
              // Use the panel's WORLD transform — the wrist panels (mini/brush) are
              // parented to the controller grip, so pm.position/quaternion are local.
              // Building the plane from local coords put it in the wrong place and
              // froze the projected UV (sliders locked). worldToLocal() below already
              // uses matrixWorld, so it just needs a correctly-placed world plane.
              pm.updateWorldMatrix(true, false);
              const _pw = new THREE.Vector3();
              const _pq = new THREE.Quaternion();
              pm.getWorldPosition(_pw);
              pm.getWorldQuaternion(_pq);
              const _planeNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(_pq);
              const _plane = new THREE.Plane().setFromNormalAndCoplanarPoint(_planeNormal, _pw);
              const _hit = new THREE.Vector3();
              if (_rc.ray.intersectPlane(_plane, _hit)) {
                const _local = pm.worldToLocal(_hit.clone());
                const _hw = (pm.geometry.parameters?.width  ?? 0.3) * 0.5;
                const _hh = (pm.geometry.parameters?.height ?? 0.4) * 0.5;
                _winner = { ..._locked, hit: { uv: {
                  x:       (_local.x + _hw) / (_hw * 2),
                  y: 1.0 - (_local.y + _hh) / (_hh * 2),
                }, distance: 0 } };
                _winnerName = _locked.name;
              }
            }
          }

          // Phase 3: build full visible-panel list so non-hit panels also get leave calls
          const _allVisible = [];
          if (this._brushPanel?.mesh?.visible && window._brushPanelEnabled !== false)
            _allVisible.push({ name: 'BrushPanel', panel: this._brushPanel, pressKey: '_bpWasPressed' });
          if (this._miniPanel?.mesh?.visible && window._brushPanelEnabled !== false)
            _allVisible.push({ name: 'MiniPanel', panel: this._miniPanel, pressKey: '_mpWasPressed' });
          if (this._toolPickerPanel?.mesh?.visible && window._brushPanelEnabled !== false)
            _allVisible.push({ name: 'ToolPickerPanel', panel: this._toolPickerPanel, pressKey: '_tpWasPressed' });
          if (this._mainMenuPanel?.mesh?.visible)
            _allVisible.push({ name: 'MainMenuPanel', panel: this._mainMenuPanel, pressKey: '_mmWasPressed' });
          if (this._tornOffPanels.size > 0) {
            this._tornOffPanels.forEach((panel, sectionId) => {
              if (panel.mesh?.visible) _allVisible.push({ name: 'TornOff:' + sectionId, panel, pressKey: '_topWasPressed_' + sectionId });
            });
          }
          if (this._filesPanel?.mesh?.visible)
            _allVisible.push({ name: 'FilesPanel', panel: this._filesPanel, pressKey: '_fpWasPressed' });
          if (this._vrNumpad?.mesh?.visible)
            _allVisible.push({ name: 'VrNumpad', panel: this._vrNumpad, pressKey: '_npWasPressed' });
          if (this._vrConfirm?.mesh?.visible)
            _allVisible.push({ name: 'VrConfirm', panel: this._vrConfirm, pressKey: '_vcWasPressed' });

          for (const v of _allVisible) {
            if (v.name === _winnerName) {
              const justDown = _pressed && !this[v.pressKey];
              const justUp   = !_pressed && this[v.pressKey];
              if (justDown)    v.panel.onVRPress(_winner.hit.uv);
              else if (justUp) v.panel.onVRRelease(_winner.hit.uv);
              else             v.panel.onVRMove(_winner.hit.uv);
              this[v.pressKey] = _pressed;
              this._isPointingAtMenu = true;
              if (source.handedness === 'left') { this._vrUIHitDistLeft  = _winner.hit.distance; this._vrUIHitSourceLeft  = _winnerName; }
              else                              { this._vrUIHitDistRight = _winner.hit.distance; this._vrUIHitSourceRight = _winnerName; }
              this._updateBPCursor?.(_winner.hit.point, true);
            } else {
              if (this[v.pressKey]) {
                // When the numpad is open, drop the synthetic centre-UV release
                // rather than dispatching it — that click lands on whatever DOM
                // element happens to be at UV(0.5,0.5), which is exactly where
                // the FPS slider / play button live in the animation panel.
                // Always clear the flag so the panel doesn't stay "stuck" pressed.
                if (!_numpadOpen) v.panel.onVRRelease({ x: 0.5, y: 0.5 });
                this[v.pressKey] = false;
              }
              v.panel.onVRLeave();
            }
          }

          // VRTimeline dispatch (separate interface, preserves _vtlDragActive gate)
          if (_winner?.isTimeline) {
            this._vtlIsPointing = true;
            this._isPointingAtMenu = true;
            if (source.handedness === 'left') { this._vrUIHitDistLeft  = _winner.hit.distance; this._vrUIHitSourceLeft  = 'VRTimeline'; }
            else                              { this._vrUIHitDistRight = _winner.hit.distance; this._vrUIHitSourceRight = 'VRTimeline'; }
            this._updateBPCursor?.(_winner.hit.point, true);
            // While the two-handed zoom gesture owns input, don't also pan/select
            // with the dominant hand — just keep the press latch in sync.
            if (this._vtlZoomActive) {
              this._vtlWasPressed = _pressed;
            } else if (!this._vtlDragActive) {
              const justDown  = _pressed && !this._vtlWasPressed;
              const justUp    = !_pressed && this._vtlWasPressed;
              // Non-dominant trigger held = additive marquee (Shift-equivalent in VR)
              const _addShift = !!this._vrSecondaryTriggerPressed;
              if (justDown)    this._onVRTimelineHit(_winner.hit.uv, 'down', true,     _addShift);
              else if (justUp) this._onVRTimelineHit(_winner.hit.uv, 'up',   false,    _addShift);
              else             this._onVRTimelineHit(_winner.hit.uv, 'move', _pressed, _addShift);
              this._vtlLastDragUV = _winner.hit.uv;   // remember for off-panel release
              this._vtlWasPressed = _pressed;
            }
          } else if (this._vtlWasPressed && _pressed && !this._vtlZoomActive && !this._vtlDragActive) {
            // Edge-drag latch: the trigger is still held but the ray has left the
            // timeline mesh — easy to do when dragging a blendshape value toward 0
            // past the panel's left edge. Project the ray onto the timeline plane,
            // clamp to the panel, and keep feeding 'move' so the drag continues
            // off-panel (pointer-capture semantics). GuiTimeline dispatches
            // pointermove/up on window, so off-panel moves still apply.
            const tlm = this._vrTimelineMesh;
            let _luv = null;
            if (tlm) {
              tlm.updateWorldMatrix(true, false);
              const _pw = new THREE.Vector3(), _pq = new THREE.Quaternion();
              tlm.getWorldPosition(_pw); tlm.getWorldQuaternion(_pq);
              const _n = new THREE.Vector3(0, 0, 1).applyQuaternion(_pq);
              const _plane = new THREE.Plane().setFromNormalAndCoplanarPoint(_n, _pw);
              const _hit = new THREE.Vector3();
              if (_rc.ray.intersectPlane(_plane, _hit)) {
                const _local = tlm.worldToLocal(_hit.clone());
                const _hw = (tlm.geometry.parameters?.width  ?? 1) * 0.5;
                const _hh = (tlm.geometry.parameters?.height ?? 1) * 0.5;
                // Deliberately UNclamped: the gutter weight-scrub is relative
                // (newW = startW + dx/200), so the cursor must be allowed to run
                // past the panel edge for dx to grow enough to reach 0.0 / 1.0.
                // GuiTimeline clamps the resulting value itself.
                _luv = {
                  x: (_local.x + _hw) / (_hw * 2),
                  y: (_local.y + _hh) / (_hh * 2),
                };
              }
            }
            if (_luv) {
              this._vtlLastDragUV = _luv;
              this._onVRTimelineHit(_luv, 'move', true, !!this._vrSecondaryTriggerPressed);
              this._vtlIsPointing = true;
              this._isPointingAtMenu = true;
            }
          } else {
            if (this._vtlWasPressed) {
              // Release: use the last drag UV so an off-panel release commits at the
              // dragged position rather than the panel centre.
              this._onVRTimelineHit(this._vtlLastDragUV || { x: 0.5, y: 0.5 }, 'up', false);
              this._vtlWasPressed = false;
              this._vtlLastDragUV = null;
            }
          }

          // VRBlendshapes dispatch (canvas panel; secondary trigger = solo modifier)
          if (_winner?.isBlendshapes) {
            this._isPointingAtMenu = true;
            this._vbsIsPointing    = true;
            this._vbsPanelPointed  = true; // for hover-clear in the render loop
            if (source.handedness === 'left') { this._vrUIHitDistLeft  = _winner.hit.distance; this._vrUIHitSourceLeft  = 'VRBlendshapes'; }
            else                              { this._vrUIHitDistRight = _winner.hit.distance; this._vrUIHitSourceRight = 'VRBlendshapes'; }
            this._updateBPCursor?.(_winner.hit.point, true);
            const _solo     = !!this._vrSecondaryTriggerPressed;
            const _justDown = _pressed && !this._vbsWasPressed;
            const _justUp   = !_pressed && this._vbsWasPressed;
            if (_justDown)    this._onVRBlendshapesHit(_winner.hit.uv, 'down', _solo);
            else if (_justUp) this._onVRBlendshapesHit(_winner.hit.uv, 'up',   _solo);
            else              this._onVRBlendshapesHit(_winner.hit.uv, 'move', _solo);
            this._vbsLastUV     = _winner.hit.uv;
            this._vbsWasPressed = _pressed;
          } else if (this._vbsWasPressed && _pressed && this._vrBlendMesh?.visible) {
            // Edge-drag latch: trigger still held but the ray left the panel (dragging
            // a weight slider past its edge). Project onto the panel plane, unclamped,
            // and keep feeding 'move' — the panel clamps the resulting weight to [0,1].
            const bm = this._vrBlendMesh;
            bm.updateWorldMatrix(true, false);
            const _pw = new THREE.Vector3(), _pq = new THREE.Quaternion();
            bm.getWorldPosition(_pw); bm.getWorldQuaternion(_pq);
            const _n = new THREE.Vector3(0, 0, 1).applyQuaternion(_pq);
            const _plane = new THREE.Plane().setFromNormalAndCoplanarPoint(_n, _pw);
            const _hit = new THREE.Vector3();
            if (_rc.ray.intersectPlane(_plane, _hit)) {
              const _local = bm.worldToLocal(_hit.clone());
              const _hw = (bm.geometry.parameters?.width  ?? 1) * 0.5;
              const _hh = (bm.geometry.parameters?.height ?? 1) * 0.5;
              const _uv = { x: (_local.x + _hw) / (_hw * 2), y: (_local.y + _hh) / (_hh * 2) };
              this._vbsLastUV = _uv;
              this._onVRBlendshapesHit(_uv, 'move', !!this._vrSecondaryTriggerPressed);
              this._isPointingAtMenu = true;
              this._vbsIsPointing    = true;
            }
          } else if (this._vbsWasPressed) {
            this._onVRBlendshapesHit(this._vbsLastUV || { x: 0.5, y: 0.5 }, 'up', false);
            this._vbsWasPressed = false;
            this._vbsLastUV = null;
          }

          // VRTimeline corner close button — trigger press hides the timeline panel.
          if (_winner?.isTimelineClose) {
            this._isPointingAtMenu = true;
            this._vtlClosePointed  = true; // drives the hover highlight (applied in render loop)
            this._updateBPCursor?.(_winner.hit.point, true);
            if (_pressed && !this._vtlCloseWasPressed) {
              document.dispatchEvent(new CustomEvent('vtl-show', { detail: { show: false } }));
            }
            this._vtlCloseWasPressed = _pressed;
          } else if (this._vtlCloseWasPressed) {
            this._vtlCloseWasPressed = false;
          }

          // VRBlendshapes corner close button — same behaviour as the timeline's.
          if (_winner?.isBlendClose) {
            this._isPointingAtMenu = true;
            this._vbsClosePointed  = true;
            this._updateBPCursor?.(_winner.hit.point, true);
            if (_pressed && !this._vbsCloseWasPressed) {
              document.dispatchEvent(new CustomEvent('vbs-show', { detail: { show: false } }));
            }
            this._vbsCloseWasPressed = _pressed;
          } else if (this._vbsCloseWasPressed) {
            this._vbsCloseWasPressed = false;
          }

          // VRTimeline resize handle — trigger starts a resize drag tracked via ray-plane intersection
          if (_winner?.isTimelineResize) {
            this._vtlIsPointing = true;
            this._isPointingAtMenu = true;
            this._updateBPCursor?.(_winner.hit.point, true);
            const justDown = _pressed && !this._vtlResizeWasPressed;
            if (justDown && !this._vtlResizeActive) {
              const tl = this._vrTimelineMesh;
              const q  = tl.quaternion;
              // Mesh axes in world space (scale is always 1 for timeline mesh)
              const meshRight = new THREE.Vector3(1,  0, 0).applyQuaternion(q);
              const meshDown  = new THREE.Vector3(0, -1, 0).applyQuaternion(q);
              const geoW = tl.geometry.parameters.width;
              const geoH = tl.geometry.parameters.height;
              // Fixed corner = top-left = center - right*(w/2) - down*(h/2)
              this._vtlResizeFixedCorner = tl.position.clone()
                .addScaledVector(meshRight, -geoW / 2)
                .addScaledVector(meshDown,  -geoH / 2);
              this._vtlResizeMeshRight = meshRight;
              this._vtlResizeMeshDown  = meshDown;
              // Plane aligned with mesh face for ray intersection
              const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
              this._vtlResizePlane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, tl.position);
              this._vtlResizeActive = true;
              this._vtlResizeHand   = source.handedness;
            }
            if (!_pressed) { this._vtlResizeActive = false; this._vtlResizeHand = null; }
            this._vtlResizeWasPressed = _pressed;
          } else {
            if (this._vtlResizeWasPressed) this._vtlResizeWasPressed = false;
          }

          // Apply resize every frame while drag is active using ray-plane intersection
          if (this._vtlResizeActive && this._vtlResizeHand === source.handedness
              && this._vtlResizePlane && !this._vtlDragActive) {
            const hitPoint = new THREE.Vector3();
            if (_rc.ray.intersectPlane(this._vtlResizePlane, hitPoint)) {
              const delta   = hitPoint.clone().sub(this._vtlResizeFixedCorner);
              const newWorldW = Math.max(0.20, Math.min(1.60, delta.dot(this._vtlResizeMeshRight)));
              const newWorldH = Math.max(0.05, Math.min(0.40, delta.dot(this._vtlResizeMeshDown)));
              const newCssW   = Math.round(newWorldW * 1500);
              const newCssH   = Math.round(newWorldH * 1500);
              const timeline  = this.getGui()?._ctrlTimeline;
              const tl        = this._vrTimelineMesh;
              if (timeline && tl) {
                timeline.resizeVRCanvas(newCssW, newCssH);
                // dispose() clears Three.js's cached GL texture size so the re-upload
                // uses the new canvas dimensions rather than stretching the old allocation.
                if (this._vrTimelineTexture) {
                  this._vrTimelineTexture.dispose();
                  this._vrTimelineTexture.needsUpdate = true;
                }
                tl.geometry.dispose();
                tl.geometry = new THREE.PlaneGeometry(newWorldW, newWorldH);
                tl.scale.set(1, 1, 1);
                this._layoutTimelineCloseBtn(); // half-extents changed → re-place child

                // Reposition so the top-left corner stays fixed
                tl.position.copy(this._vtlResizeFixedCorner)
                  .addScaledVector(this._vtlResizeMeshRight, newWorldW / 2)
                  .addScaledVector(this._vtlResizeMeshDown,  newWorldH / 2);
                // Persist the chosen size so it survives reload; show a live
                // readout (throttled) so the ideal dimensions can be reported.
                window.saveOption?.('vrTimelineW', +newWorldW.toFixed(3), 400);
                window.saveOption?.('vrTimelineH', +newWorldH.toFixed(3), 400);

                this._vtlSizeLogCount = (this._vtlSizeLogCount || 0) + 1;
                if (window.screenLog && this._vtlSizeLogCount % 6 === 0) {
                  window.screenLog(`[VR Timeline] size ${newWorldW.toFixed(2)}×${newWorldH.toFixed(2)} m (${newCssW}×${newCssH}px)`, 'cyan');
                }
              }
            }
            if (!_pressed) { this._vtlResizeActive = false; this._vtlResizeHand = null; }
          }

          // No panel hit — hide panel cursor
          if (!_winner) this._updateBPCursor?.(null, false);

          // Track for next-frame thumbstick scroll routing
          if (_winner && !_winner.isTimeline && !_winner.isTimelineResize) this._lastHtmlPanelHit = _winner.panel;
          else if (!_winner) this._lastHtmlPanelHit = null;

          // Periodic state sync (independent of hit)
          this._bpSyncCounter = (this._bpSyncCounter || 0) + 1;
          if (this._bpSyncCounter % 30 === 0) this._brushPanel?.syncFromState?.();
          this._mpSyncCounter = (this._mpSyncCounter || 0) + 1;
          if (this._mpSyncCounter % 30 === 0) this._miniPanel?.syncFromState?.();
          // ── end unified HTML panel raycast ────────────────────────────────

          // Periodic state sync for MainMenuPanel (keeps symmetry/tool highlight fresh).
          // Call _rebuildContent directly so the cache key still suppresses no-op repaints.
          this._mmSyncCounter = (this._mmSyncCounter || 0) + 1;
          if (this._mmSyncCounter % 30 === 0) this._mainMenuPanel?._rebuildContent?.();

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

          // If Missed Main Menu, Check Mini-HUD (only when no HTML panel is visible)
          if (!hit && this._vrMiniHUD && this._guiMini && this._guiMini._isVisible
              && (!this._guiXR || !this._guiXR._isVisible)
              && !(window._brushPanelEnabled !== false
                && (!!(this._brushPanel?.mesh?.visible)
                 || !!(this._miniPanel?.mesh?.visible)
                 || !!(this._toolPickerPanel?.mesh?.visible)
                 || !!(this._mainMenuPanel?.mesh?.visible)))) {
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
              const legacyName = targetGuiXR === this._guiXR ? 'LegacyMenu' : targetGuiXR === this._guiMini ? 'LegacyMiniHUD' : 'LegacyPopup';
              if (source.handedness === 'left') { this._vrUIHitDistLeft  = hit.distance; this._vrUIHitSourceLeft  = legacyName; }
              else                              { this._vrUIHitDistRight = hit.distance; this._vrUIHitSourceRight = legacyName; }
            }

          } else {
            if (this._guiXR) this._guiXR.setCursor(-1, -1);
            if (this._guiMini) this._guiMini.setCursor(-1, -1);
            // Only reset if BrushPanel also didn't claim this ray — it sets _isPointingAtMenu
            // and pre-fills _vrUIHitDist to suppress the sculpt cursor.
            if (!this._isPointingAtMenu) {
              if (source.handedness === 'left') this._vrUIHitDistLeft = Infinity;
              else this._vrUIHitDistRight = Infinity;
            }
          }

          // ── Debug: log which panel (if any) is setting the laser hit distance ──
          if (window._vrHitDebug) {
            const isLeft = source.handedness === 'left';
            const dist   = isLeft ? this._vrUIHitDistLeft  : this._vrUIHitDistRight;
            const src    = isLeft ? this._vrUIHitSourceLeft : this._vrUIHitSourceRight;
            const hand   = isLeft ? 'L' : 'R';
            if (!this._vrHitDebugCounter) this._vrHitDebugCounter = 0;
            this._vrHitDebugCounter++;
            if (this._vrHitDebugCounter % 60 === 0) {
              if (dist !== Infinity) {
                console.log(`[VRHit] ${hand}: ${src} @ ${dist.toFixed(3)}m`);
              } else {
                console.log(`[VRHit] ${hand}: no hit`);
              }
            }
          }
          // ── end debug ─────────────────────────────────────────────────────────

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

          // ── Pinned-panel grip drag ─────────────────────────────────────────
          // Start: must be pointing at panel. Continue: latch until grip release
          // regardless of _isPointingAtMenu, so dragging over the sculpt doesn't drop the panel.
          const _panelDragBusy = this._hasPanelDragActive(source.handedness);
          const _worldNavBusy  = this._vrGrip[source.handedness]?.active ?? false;
          const _hitSrc = source.handedness === 'left' ? this._vrUIHitSourceLeft : this._vrUIHitSourceRight;
          const bpOnPanel  = _hitSrc === 'BrushPanel';
          const mmOnPanel  = _hitSrc === 'MainMenuPanel';
          const bpCanStart    = this._brushPanel?.pinned && bpOnPanel && isGrip && !this._bpDragActive && !this._vtlIsPointing && !_panelDragBusy && !_worldNavBusy;
          const bpCanContinue = this._bpDragActive && this._bpDragHand === source.handedness && isGrip;
          if (bpCanStart || bpCanContinue) {
            const refPose = frame.getPose(source.gripSpace, refSpace);
            if (refPose) {
              const p = refPose.transform.position;
              const q = refPose.transform.orientation;
              const curPos  = new THREE.Vector3(p.x, p.y, p.z);
              const curQuat = new THREE.Quaternion(q.x, q.y, q.z, q.w);
              if (!this._bpDragActive) {
                this._bpDragActive = true;
                this._bpDragHand   = source.handedness;
                const mesh = this._brushPanel.mesh;
                mesh.updateWorldMatrix(true, false);
                const invCtrlQuat = curQuat.clone().invert();
                this._bpDragRelPos  = mesh.position.clone().sub(curPos).applyQuaternion(invCtrlQuat);
                this._bpDragRelQuat = invCtrlQuat.clone().multiply(mesh.quaternion);
              } else {
                const mesh = this._brushPanel.mesh;
                mesh.position.copy(curPos).add(_v3tmp.copy(this._bpDragRelPos).applyQuaternion(curQuat));
                mesh.quaternion.copy(curQuat).multiply(this._bpDragRelQuat);
              }
            }
            if (source.handedness === 'left') { leftGrip = false; }
            else                              { rightGrip = false; }
          }
          if (this._bpDragActive && this._bpDragHand === source.handedness && !isGrip) {
            this._bpDragActive = false;
            this._bpDragHand   = null;
          }
          // ── end BrushPanel grip drag ──────────────────────────────────────

          // ── MainMenuPanel grip drag (pinned) ──────────────────────────────
          const mmCanStart    = this._mainMenuPanel?.pinned && mmOnPanel && isGrip && !this._mmDragActive && !this._vtlIsPointing && !_panelDragBusy && !_worldNavBusy;
          const mmCanContinue = this._mmDragActive && this._mmDragHand === source.handedness && isGrip;
          if (mmCanStart || mmCanContinue) {
            const refPose = frame.getPose(source.gripSpace, refSpace);
            if (refPose) {
              const p = refPose.transform.position;
              const q = refPose.transform.orientation;
              const curPos  = new THREE.Vector3(p.x, p.y, p.z);
              const curQuat = new THREE.Quaternion(q.x, q.y, q.z, q.w);
              if (!this._mmDragActive) {
                this._mmDragActive = true;
                this._mmDragHand   = source.handedness;
                const mesh = this._mainMenuPanel.mesh;
                mesh.updateWorldMatrix(true, false);
                const invCtrlQuat = curQuat.clone().invert();
                this._mmDragRelPos  = mesh.position.clone().sub(curPos).applyQuaternion(invCtrlQuat);
                this._mmDragRelQuat = invCtrlQuat.clone().multiply(mesh.quaternion);
              } else {
                const mesh = this._mainMenuPanel.mesh;
                mesh.position.copy(curPos).add(_v3tmp.copy(this._mmDragRelPos).applyQuaternion(curQuat));
                mesh.quaternion.copy(curQuat).multiply(this._mmDragRelQuat);
              }
            }
            if (source.handedness === 'left') { leftGrip = false; }
            else                              { rightGrip = false; }
          }
          if (this._mmDragActive && this._mmDragHand === source.handedness && !isGrip) {
            this._mmDragActive = false;
            this._mmDragHand   = null;
          }
          // ── end MainMenuPanel grip drag ───────────────────────────────────

          // ── VR Timeline grip drag ─────────────────────────────────────────
          // Start: laser must be specifically on the timeline (_vtlIsPointing).
          // Continue: keep dragging as long as grip is held, regardless of laser position.
          const canStartVtlDrag  = this._vrTimelineMesh?.visible && this._vtlIsPointing && isGrip && !this._vtlDragActive && !_panelDragBusy && !_worldNavBusy;
          const canContinueVtlDrag = this._vtlDragActive && this._vtlDragHand === source.handedness && isGrip;

          if (canStartVtlDrag || canContinueVtlDrag) {
            const refPose = frame.getPose(source.gripSpace, refSpace);
            if (refPose) {
              const p = refPose.transform.position;
              const q = refPose.transform.orientation;
              const curPos  = new THREE.Vector3(p.x, p.y, p.z);
              const curQuat = new THREE.Quaternion(q.x, q.y, q.z, q.w);

              if (!this._vtlDragActive) {
                this._vtlDragActive = true;
                this._vtlDragHand   = source.handedness;
                const tl = this._vrTimelineMesh;
                tl.updateWorldMatrix(true, false);
                const invCtrlQuat = curQuat.clone().invert();
                this._vtlDragRelPos  = tl.position.clone().sub(curPos).applyQuaternion(invCtrlQuat);
                this._vtlDragRelQuat = invCtrlQuat.clone().multiply(tl.quaternion);
              } else {
                const tl = this._vrTimelineMesh;
                tl.position.copy(curPos).add(_v3tmp.copy(this._vtlDragRelPos).applyQuaternion(curQuat));
                tl.quaternion.copy(curQuat).multiply(this._vtlDragRelQuat);
              }
            }
            // Suppress world navigation while dragging
            if (source.handedness === 'left') { leftGrip = false; }
            else                              { rightGrip = false; }

          } else if (this._vtlDragActive && this._vtlDragHand === source.handedness && !isGrip) {
            this._vtlDragActive = false;
            this._vtlDragHand   = null;
          }
          // ── end VR Timeline grip drag ─────────────────────────────────────

          // ── VR Blendshapes grip drag (point at panel + grip to move it) ───
          const canStartVbsDrag    = this._vrBlendMesh?.visible && this._vbsIsPointing && isGrip && !this._vbsDragActive && !_panelDragBusy && !_worldNavBusy;
          const canContinueVbsDrag = this._vbsDragActive && this._vbsDragHand === source.handedness && isGrip;
          if (canStartVbsDrag || canContinueVbsDrag) {
            const refPose = frame.getPose(source.gripSpace, refSpace);
            if (refPose) {
              const p = refPose.transform.position;
              const q = refPose.transform.orientation;
              const curPos  = new THREE.Vector3(p.x, p.y, p.z);
              const curQuat = new THREE.Quaternion(q.x, q.y, q.z, q.w);
              const bm = this._vrBlendMesh;
              if (!this._vbsDragActive) {
                this._vbsDragActive = true;
                this._vbsDragHand   = source.handedness;
                bm.updateWorldMatrix(true, false);
                const invCtrlQuat = curQuat.clone().invert();
                this._vbsDragRelPos  = bm.position.clone().sub(curPos).applyQuaternion(invCtrlQuat);
                this._vbsDragRelQuat = invCtrlQuat.clone().multiply(bm.quaternion);
              } else {
                bm.position.copy(curPos).add(_v3tmp.copy(this._vbsDragRelPos).applyQuaternion(curQuat));
                bm.quaternion.copy(curQuat).multiply(this._vbsDragRelQuat);
              }
            }
            if (source.handedness === 'left') { leftGrip = false; } else { rightGrip = false; }
          } else if (this._vbsDragActive && this._vbsDragHand === source.handedness && !isGrip) {
            this._vbsDragActive = false;
            this._vbsDragHand   = null;
          }
          // ── end VR Blendshapes grip drag ──────────────────────────────────

          // ── TornOffPanel grip drags ───────────────────────────────────────
          if (this._tornOffPanels.size > 0) {
            const refPose = isGrip ? frame.getPose(source.gripSpace, refSpace) : null;
            const curPos  = refPose ? new THREE.Vector3(refPose.transform.position.x, refPose.transform.position.y, refPose.transform.position.z) : null;
            const curQuat = refPose ? new THREE.Quaternion(refPose.transform.orientation.x, refPose.transform.orientation.y, refPose.transform.orientation.z, refPose.transform.orientation.w) : null;

            this._tornOffPanels.forEach((panel, sectionId) => {
              const dragKey   = '_topDragActive_' + sectionId;
              const handKey   = '_topDragHand_'   + sectionId;
              const startPKey = '_topDragStartP_' + sectionId;
              const startQKey = '_topDragStartQ_' + sectionId;

              const onThisPanel = this._isPointingAtMenu && (
                (source.handedness === 'left'  && this._vrUIHitSourceLeft  === 'TornOff:' + sectionId) ||
                (source.handedness === 'right' && this._vrUIHitSourceRight === 'TornOff:' + sectionId)
              );
              const topCanStart    = isGrip && onThisPanel && !this[dragKey] && !this._vtlIsPointing && !_panelDragBusy && !_worldNavBusy;
              const topCanContinue = this[dragKey] && this[handKey] === source.handedness && isGrip;

              if ((topCanStart || topCanContinue) && curPos) {
                if (!this[dragKey]) {
                  this[dragKey] = true;
                  this[handKey] = source.handedness;
                  panel.mesh.updateWorldMatrix(true, false);
                  const invCtrlQuat = curQuat.clone().invert();
                  this[startPKey] = panel.mesh.position.clone().sub(curPos).applyQuaternion(invCtrlQuat);
                  this[startQKey] = invCtrlQuat.clone().multiply(panel.mesh.quaternion);
                } else {
                  panel.mesh.position.copy(curPos).add(_v3tmp.copy(this[startPKey]).applyQuaternion(curQuat));
                  panel.mesh.quaternion.copy(curQuat).multiply(this[startQKey]);
                }
                if (source.handedness === 'left') leftGrip = false;
                else                              rightGrip = false;
              }
              if (this[dragKey] && this[handKey] === source.handedness && !isGrip) {
                this[dragKey] = false;
                this[handKey] = null;
              }
            });
          }
          // ── end TornOffPanel grip drags ───────────────────────────────────
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
    this._wasVbsPanelPointed = this._vbsPanelPointed; // same one-frame buffer for the blend panel
  } catch (e) {
      if (Math.random() < 0.05) console.error("[SculptXR] XR Input Error:", e);
    }
  }

  _hasPanelDragActive(handedness) {
    if (this._bpDragActive  && this._bpDragHand  === handedness) return true;
    if (this._mmDragActive  && this._mmDragHand  === handedness) return true;
    if (this._vtlDragActive && this._vtlDragHand === handedness) return true;
    if (this._tornOffPanels) {
      for (const sectionId of this._tornOffPanels.keys()) {
        if (this['_topDragActive_' + sectionId] && this['_topDragHand_' + sectionId] === handedness) return true;
      }
    }
    return false;
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
      } else if (toolIndex === Enums.Tools.TRANSFORM_VR || toolIndex === Enums.Tools.VOXEL || toolIndex === Enums.Tools.GEODESIC_POSE) {
        useVolume = false; // pose tool aims A/B with the laser, like Transform
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

        // SURFACE-WALKING ANCHOR (Crease only). Re-projecting the raw controller tip every
        // frame makes the brush centre jump when the tip drifts off-surface (gallop above,
        // waves below). Instead keep an on-surface anchor, advance it by the controller's
        // motion, and let the surface projection inside intersectionSphereMeshes discard the
        // depth (normal) component each frame -> the brush walks the surface laterally and
        // ignores how far above/below the tip is (the depth-independence desktop gets free
        // from screen-ray picking). _vrSculpting here is last frame's value: false on the
        // first stroke frame (anchor = contact point), true mid-stroke (walk).
        let pickCenter = volumeEnginePos;
        const isCreaseWalk = (toolIndex === Enums.Tools.CREASE);
        if (isCreaseWalk) {
          if (this._vrSculpting && this._vrCreaseAnchor) {
            const wDelta = vec3.create();
            vec3.subtract(wDelta, volumeEnginePos, this._vrCreaseLastTip);
            pickCenter = vec3.create();
            vec3.add(pickCenter, this._vrCreaseAnchor, wDelta); // advance; committed only if the pick succeeds
          } else {
            this._vrCreaseAnchor = vec3.clone(volumeEnginePos); // stroke start / hover: anchor at the tip
            pickCenter = this._vrCreaseAnchor;
          }
          this._vrCreaseLastTip = vec3.clone(volumeEnginePos);
        }

        picked = this._picking.intersectionSphereMeshes(targetMeshes, pickCenter, paddedRadius);

        if (isCreaseWalk && picked) {
          // Re-snap the anchor onto the surface so the depth component is dropped each frame.
          // Pure depth motion snaps back to ~the same point; lateral motion walks it along.
          const cMesh = this._picking.getMesh();
          if (cMesh) {
            const interEngine = vec3.create();
            vec3.transformMat4(interEngine, this._picking.getIntersectionPoint(), cMesh.getModelSpaceMatrix()); // parent-aware
            this._vrCreaseAnchor = interEngine;
          }
        }
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

      // Sync local radius — parent-aware: divide world radius by the composed MODEL
      // scale (parentChain * _matrix), not the raw local getScale2(). For a parented
      // child these differ by the parent's scale; using local blows the brush up by
      // ~scale² and it engulfs the whole mesh.
      const mesh = this._picking.getMesh() || this.getMesh();
      if (mesh) {
        const _msc = mesh.getModelSpaceScale ? mesh.getModelSpaceScale() : mesh.getScale();
        this._picking._rLocal2 = this._picking._rWorld2 / (_msc * _msc);
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



        this._vrSculptMesh = this._picking.getMesh() || this.getMesh(); // capture at stroke start
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

        // Prefer the mesh captured at stroke start (most reliable — picking may
        // already be cleared by the time the trigger releases).
        const currentMesh = this._vrSculptMesh || this._picking.getMesh() || this.getMesh();
        this._vrSculptMesh = null;

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
                        const matMesh = pickedMesh.getModelSpaceMatrix(); // parent-aware (== getMatrix unparented)
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
                    vec3.transformMat4(engineHit, localHit, pickedMesh.getModelSpaceMatrix()); // parent-aware
                    hitDist = vec3.distance(originEngine, engineHit) * (this._vrScale || 1.0);

                    // Surface point in scene space. The old reconstruction (origin + dir*hitDist)
                    // only landed on the surface for RAY picks; for contact/volume picks the hit
                    // is the nearest surface point (off the ray axis), so the ring floated above
                    // the surface and the gap grew with world scale. Transform the engine-space
                    // hit by the worldGroup matrix — it carries vrScale + the world offset (see
                    // updateVRWorldTransform), so the ring lands exactly on the surface at any scale.
                    wInter = vec3.create();
                    const _wg = window._sxrWorldGroup;
                    if (_wg) {
                        const _eh = new THREE.Vector3(engineHit[0], engineHit[1], engineHit[2]).applyMatrix4(_wg.matrixWorld);
                        vec3.set(wInter, _eh.x, _eh.y, _eh.z);
                    } else {
                        vec3.scaleAndAdd(wInter, origin, dir, hitDist); // fallback (no worldGroup)
                    }

                    // // if (doLog) console.log(`  hitDist: ${hitDist.toFixed(3)} wInt: ${wInter.map(x=>x.toFixed(2))}`);

                    pNormal = this._picking.computePickedNormal();
                    sceneNormal = vec3.create();
                    
                    if (pNormal && pNormal.length >= 3) {
                        const nMat = mat3.create();
                        mat3.normalFromMat4(nMat, pickedMesh.getModelSpaceMatrix()); // parent-aware
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
                const isUIHit = uiHitDist !== undefined && uiHitDist !== Infinity;
                pointerLine.visible = isUIHit;
                if (isUIHit) {
                    // uiHitDist is from ray origin (which is offset by getStylusOffset()
                    // from the controller base where the tube starts), so add the offset back.
                    const _stylusOff = this.getStylusOffset?.() ?? 0;
                    pointerLine.scale.z = (uiHitDist + _stylusOff) / 0.30;
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

                // 1. Position Surface Ring (if hitting mesh) — not useful for voxels (and mis-sized),
                // so hide it entirely in voxel mode; the volume sphere/cube is the brush indicator there.
                if (!isVoxelTool && hitDist !== 5.0 && wInter && pickedMesh && (uiHitDist === undefined || uiHitDist === Infinity)) {
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
                        // World-aligned stamp: brushRotation is null, so the box lands on the
                        // voxel grid (model) axes, not the tracking-space axes. The cursor shares
                        // the scene as its parent with _worldGroup, so copy the worldGroup
                        // orientation to match the grid (identity here would tilt by the world rotation).
                        activeVol.quaternion.copy(this._worldGroup.quaternion);
                    } else {
                        // Inherit Controller Rotation natively (approximating from direction if needed, or simply copy VR controller orientation)
                        const ctrl3D = isLeft ? this._vrControllerLeft : this._vrControllerRight;
                        if (ctrl3D) activeVol.quaternion.copy(ctrl3D.quaternion);
                    }

                    if (isVoxelTool) {
                        // Voxel stamps use a fixed model-space radius (grid units), so the stamp's
                        // physical size scales with the world (vrScale) while physicalRadius does not.
                        // Track vrScale, normalised to the default world scale where the preview is
                        // calibrated, so the cube/sphere matches the stamp at every grip-scale.
                        const refScale = 0.008; // default _vrScale (see init) — preview is correct here
                        const voxScale = physicalRadius * ((this._vrScale || refScale) / refScale);
                        activeVol.scale.set(voxScale, voxScale, voxScale);
                    } else {
                        activeVol.scale.set(physicalRadius, physicalRadius, physicalRadius);
                    }
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
