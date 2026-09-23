import { vec3, mat3, mat4, quat } from 'gl-matrix';
import { guardedError } from './misc/LogGuard.js';
import * as THREE from 'three';
const XF_SETTLE_MS = 250;
// TIME TO STEADY STATE -- see _tickSteadyState. Quiet for this long means the app has stopped
// building pipelines; a frame this long is a hitch the user felt; and the ceiling makes a
// session that never settles report anyway rather than staying silent.
const SS_QUIET_MS = 1000;
const SS_HITCH_MS = 40;
const SS_CEILING_MS = 30000;
import { XRControllerModelFactory } from './XRControllerModelFactory_local.js';

// The ghost's opacity where the sculpt is in front of the grid. ABSOLUTE, not a fraction of the
// grid's own opacity -- as a fraction it multiplied an already-low default (0.5 * 0.35 = 0.175)
// and against bright passthrough that is invisible, which is exactly what "it disappears as I
// go higher" was: the ghost WAS drawing, at a strength you could not see. The rig's own
// GHOST_OPACITY is an absolute 0.35 for the same reason.
//
// Live-tunable, because the right number is a judgement made in AR against a real room and not
// one I can pick from here: set window._gridGhostOpacity and toggle the grid off and on.
// The occluded pass is a FRACTION of the visible one, so one slider moves both and the ghost is
// always the fainter of the two -- "more transparent where it is behind the mesh".
const GRID_GHOST_FRACTION = 0.4;
// Saccade smoothness at full strength, as a time constant in seconds — see the easing in the
// constraint tick. Long enough that a slow head drifts rather than steps; short enough that a
// half-way setting still reads as a flick.
const SAC_SMOOTH_TAU_MAX = 0.45;
import getOptionsURL from './misc/getOptionsURL.js';
import Enums from './misc/Enums.js';
import { VERSION } from './Version.js';
import Utils from './misc/Utils.js';
import SculptManager from './editing/SculptManager.js';
import { SCULPT_TOOLS, toolLabel } from './gui/htmlvr/toolLists.js';
import Subdivision from './editing/Subdivision.js';
import Import from './files/Import.js';
import Gui from './gui/Gui.js';
import ModifierButton from './gui/ModifierButton.js';
import Camera from './math3d/Camera.js';
import Picking from './math3d/Picking.js';
import Background from './drawables/Background.js';
import Mesh from './mesh/Mesh.js';
import Multimesh from './mesh/multiresolution/Multimesh.js';
import Skeleton from './editing/Skeleton.js';
import ShaderBusy from './gui/ShaderBusy.js';
import { renderPassToCanvas, exportRenderPass, autoRange } from './render/RenderPassExport.js';
import { fixXRLayerSize } from './render/nodes/ThreeXRPatches.js';
import BootOverlay from './gui/BootOverlay.js';
import TextureIO from './files/TextureIO.js';
import Skinning from './editing/Skinning.js';
import PanelTrace from './misc/PanelTrace.js';
import IKSolver from './editing/IKSolver.js';
import PhysicsBones from './editing/PhysicsBones.js';
import RigTopology from './editing/RigTopology.js';
import RigPlacing from './editing/RigPlacing.js';
import HumanBase from './drawables/HumanBase.js';
import Primitives from './drawables/Primitives.js';
import StateManager from './states/StateManager.js';
import RenderData from './mesh/RenderData.js';
import ShaderLib from './render/ShaderLib.js';
import ShaderManager from './render/ShaderManager.js';
import MeshStatic from './mesh/meshStatic/MeshStatic.js';
import WebGLCaps from './render/WebGLCaps.js';
import Remesh from './editing/Remesh.js';
import './editing/Geodesic.js'; // registers window._geoViz test harness; posing/rigging uses computeGeodesicField
import VRLaser from './drawables/VRLaser.js';
import GazeTooltip from './drawables/GazeTooltip.js';
// [HTMLVRPanel] rAF intercept + polyfill installed as a side-effect of this import.
// Must appear before any three-html-render usage.
import { drainRAF } from './gui/htmlvr/install.js';
import { HTMLVRPanel, registerGradeMaterial, wristPanelY, wristPanelYaw, VR_PANEL_RENDER_ORDER, wristPanelPitch} from './gui/htmlvr/HTMLVRPanel.js';
import { MiniPanel              } from './gui/htmlvr/MiniPanel.js';
import { ToolPickerPanel        } from './gui/htmlvr/ToolPickerPanel.js';
import { MainMenuPanel          } from './gui/htmlvr/MainMenuPanel.js';
import { TornOffPanel           } from './gui/htmlvr/TornOffPanel.js';
import { FilesPanel, openFilesDOMOverlay, openBrowserSavesDOMOverlay } from './gui/htmlvr/FilesPanel.js';
import { AnimationControlPanel  } from './gui/htmlvr/AnimationControlPanel.js';
import BlendshapeStackPanel from './gui/BlendshapeStackPanel.js';
import { VrNumpad               } from './gui/htmlvr/VrNumpad.js';
import { VrKeyboard             } from './gui/htmlvr/VrKeyboard.js';
import { VrConfirm              } from './gui/htmlvr/VrConfirm.js';
import { VrRadialMenu           } from './gui/htmlvr/VrRadialMenu.js';
import NomadLink                  from './link/NomadLink.js';
import NomadImport                from './link/NomadImport.js';
import { sampleVR } from './misc/vrDiag.js'; // once-a-second VR flight recorder (window._vrLog)
import ViewportMenu from './gui/ViewportMenu.js';
import SkinPreview from './editing/SkinPreview.js';
import MotionTrail from './editing/MotionTrail.js';
import SceneShadow from './render/SceneShadow.js';
import scanPhantoms from './misc/PhantomScan.js';
import probeXRLighting from './misc/XRLightProbe.js';
import NodeMaterials from './render/nodes/NodeMaterials.js';
import { stripGeometry } from './render/lineStrip.js';
import { installEnvironment } from './render/nodes/EnvIBL.js';
import { applyXRBackendPatches, makePCFFilter } from './render/nodes/ThreeXRPatches.js';

// Scratch vector reused by panel grip-drag code — avoids per-frame allocation.
const _v3tmp = new THREE.Vector3();
// Up vector for the look-at constraint.
const _SXR_UP = new THREE.Vector3(0, 1, 0);
// Identity quaternion (gl-matrix) — slerp target for rotational nav-glide decay (#19).
const QUAT_IDENTITY = quat.create();

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

// How far the thing that matrix describes is from the head, in metres. Decides whether a
// TOOLS THE OFFHAND TRIGGER ALREADY MEANS SOMETHING TO.
//
// Holding the non-dominant trigger swaps the active tool for Smooth — a modifier, so the
// dominant trigger has to be down too. That is right for a brush and wrong for any tool that has
// already claimed the same button, because the swap happens BEFORE dispatch: the tool you chose
// never runs at all, and what you get is Smooth.
//
// Grab claims it for independent pin manipulation. Select claims it as its multi-select
// modifier, which is the whole of what it was asked for — matt: "i chose the select tool in vr,
// if i hold down the other trigger, it smooths the meshes i select." Voxel and Extrude are here
// because smoothing means nothing to either.
//
// By CONSTRUCTOR NAME because that is what the check had, and the names are asserted in
// multiselect_test so a rename cannot quietly empty this set.
const NO_SMOOTH_OVERRIDE = new Set(['SculptVoxel', 'Extrude', 'Grab', 'SelectTool']);

// controller pose is one a human arm could have produced -- see the wrist anchor. MODULE SCOPE:
// a class body cannot hold a bare function declaration, and putting it there was a syntax error
// that took the whole app down.
function _wristReach(gripWorld, headWorld) {
  const g = gripWorld.elements, h = headWorld.elements;
  const dx = g[12] - h[12], dy = g[13] - h[13], dz = g[14] - h[14];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

class Scene {

  // THE WORLD GROUP'S RESTING SCALE. Model space -> three-world. The VR two-grip gesture drives
  // _worldGroup.scale away from this, and light falloff is calibrated relative to it -- see the
  // wscale note in _syncThreeLights.
  static WORLD_SCALE_DEFAULT = 0.701;


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


    // ui stuffs
    this._focusGui = false; // if the gui is being focused
    this._gui = new Gui(this);
    // The flat-screen secondary-action modifier. Built after the Gui so #viewport exists, and
    // it hides itself whenever the active tool has no secondary action.
    this._modifierButton = new ModifierButton(this);
    // The flat-screen skin of the VR marking menus — see ViewportMenu.
    this._viewportMenu = new ViewportMenu(this);

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

    // BLANK EVERYWHERE, AND NOT DECIDED FROM THE USER AGENT.
    //
    // 0=blank  1=mirror  2=desktop free camera  3=spectator (rotation-coupled)
    //
    // This used to be `_isQuestStandalone ? 0 : 3`, i.e. /OculusBrowser/ -- so a GalaxyXR took
    // the PC VR branch and rendered the WHOLE SCENE a second time, with a desktop
    // PerspectiveCamera, EVERY frame, to a canvas nobody can see, while the headset was already
    // drawing the same scene per eye.
    //
    // The frame cost is the obvious half. The other half is why it took a compile trace to find:
    // a pipeline is keyed per render object and the camera shape is in that key, so every object
    // needs a SECOND pipeline for the desktop camera, compiled the moment the spectator pass
    // first reaches it -- scattered through the session, one object at a time. That is the whole
    // PerspectiveCamera half of matt's report, taken inside a session.
    //
    // The first fix broadened the sniff to /Android/. matt's GalaxyXR reports
    //   Mozilla/5.0 (X11; Linux x86_64) ... Chrome/153
    // so that missed it too, and there is no honest way to ask a user agent whether a headset is
    // plugged into a monitor. So it does not ask: blank by default everywhere, and a PC VR user
    // who wants a desktop view calls setSpectatorMode(3). A spectator view is a nicety; paying
    // for it on a standalone headset is not.
    this._spectatorViewMode = 0;

    // How many VR frames to skip between spectator renders, once one is turned on.
    // 0=every frame, 1=every 2nd, 3=every 4th, 7=every 8th.
    this._spectatorFrameSkip = 3;

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

    // NULL, not 'right' — "no hand has been latched yet", which is the truth at construction
    // and lets the cursor fall back to `_dominantHand` (set below, and by the leftHandMode
    // option). Hard-coding it here gave a left-handed user no brush cursor from startup until
    // they happened to squeeze a trigger.
    this._activeHandedness = null;
    this._vrScale = 0.008; // Scale 100-unit world to 0.8 meters (User Req: "25% too big")
    this._exposure = 1.0; // Reset to 1.0 after fixing ShaderMerge 5x boost

    this._exposure = 1.0; // Reset to 1.0 after fixing ShaderMerge 5x boost

    this._vrGrip = {
      left: { active: false, startPoint: vec3.create(), startRotation: quat.create() },
      right: { active: false, startPoint: vec3.create(), startRotation: quat.create() }
    };

    // #19 Navigation inertia: after a single-grip world move is released, keep
    // gliding with decaying momentum. `vel` is the smoothed per-frame translation
    // (base-space metres) captured while gripping; `gliding` runs the decay.
    this._navGlide = { vel: vec3.create(), rotVel: quat.create(), pivot: vec3.create(), gliding: false, wasActive: false };

    // #29 Quick tool-swap (left thumbstick click) — toggles between the two most
    // recent non-Smooth tools (Alt-Tab style), with a floating tool-name toast.
    this._leftStickClickPrev = false;
    this._toolToast = null;      // lazy { mesh, canvas, ctx, tex }
    this._toolToastUntil = 0;    // performance.now() ms when the toast hides
    this._toolHistory = [];      // [mostRecent, prev] distinct non-Smooth tool ids
    this._lastSeenTool = -1;     // for change detection while tracking history

    // #23 Floating controller button labels (toggle: window._vrShowButtonLabels).
    this._btnLabels = null;      // lazy { left, right } text planes

    // Initial World Offset (Camera pulled back 55cm, Lifted 1.2m)
    // Fix: Y=0 put it on the floor. Y=1.2 should be chest/head height.
    this._xrWorldOffset = new XRRigidTransform({ x: 0, y: 1.2, z: -0.55 });

    console.log('[Spectator] blank (mode 0) — setSpectatorMode(1..3) for a desktop view. '
      + 'A spectator render costs a second full scene pass AND a second pipeline per object.');

    // Desktop spectator view control — usable from the browser console:
    //   window.setSpectatorMode(0)  → blank canvas (default)
    //   window.setSpectatorMode(1)  → mirror left eye to desktop canvas (~18fps throttled)
    //   window.setSpectatorMode(2)  → desktop free camera on canvas (~18fps throttled)
    window.setSpectatorMode = (n) => {
      this._spectatorViewMode = n;
      const names = ['blank', 'mirror', 'desktop free camera', 'spectator (rotation-coupled)'];
      console.log(`[Spectator] mode → ${names[n] ?? n}`);
    };

    // #23 Toggle the floating controller button labels (disables the entry auto-hide).
    window.toggleVrButtonLabels = () => {
      window._vrShowButtonLabels = !window._vrShowButtonLabels;
      this._btnLabelsAutoHideAt = 0;
      return window._vrShowButtonLabels;
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
    this._miniPanel       = null;   // [HTMLVRPanel] compact wrist HUD (replaces legacy canvas MiniHUD)
    this._toolPickerPanel = null;   // [HTMLVRPanel] tool-selection overlay
    this._mainMenuPanel   = null;   // [HTMLVRPanel] main menu (replaces GuiXR + VRMenu)
    this._tornOffPanels   = new Map(); // sectionId → TornOffPanel
    this._filesPanel      = null;   // [HTMLVRPanel] floating Files overlay
    this._animPanel       = null;   // [HTMLVRPanel] animation transport + keyframe controls
    this._vrNumpad        = null;   // [HTMLVRPanel] floating number-pad for VR value editing
    this._vrKeyboard      = null;   // [HTMLVRPanel] floating QWERTY keyboard for VR text editing
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
    this._nomadLiveSend = !!getOptionsURL().nomadLiveSend; // push each finished stroke to Nomad
    window._sculptLocked = !!getOptionsURL().sculptLocked;  // "do nothing" mode (SculptManager.start)
    this._nomadScale = getOptionsURL().nomadScale || 50; // Nomad units -> SculptXR units
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

  async start() {

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

    await this.initWebGL();
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
              if (Utils.isTypingTarget(e)) return; // 'n' belongs to the text field, not the panel
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
        if (!this._vrKeyboard && this._scene && this._renderer) {
          this._vrKeyboard = new VrKeyboard(this._scene, this._camera.getThreeCamera(), this._renderer);
          window._vrKeyboard = this._vrKeyboard;
        }
        if (!this._vrConfirm && this._scene && this._renderer) {
          this._vrConfirm = new VrConfirm(this._scene, this._camera.getThreeCamera(), this._renderer, this);
          window._vrConfirmPanel = this._vrConfirm;
        }
        if (!this._vrPinRadial && this._scene) {
          // A SECOND WHEEL, not a mode on the first. They are driven by different buttons and
          // can in principle be open at once; sharing one instance would make the second press
          // silently steal the first's state mid-gesture.
          this._vrPinRadial = new VrRadialMenu(this._scene);
          window._vrPinRadial = this._vrPinRadial;
        }
        if (!this._vrRadial && this._scene) {
          this._vrRadial = new VrRadialMenu(this._scene);
          window._vrRadial = this._vrRadial;
        }
      } catch (err) {
        console.error('[VrNumpad] early init failed:', err);
      }
    }, 500);

    this._sculptManager = new SculptManager(this);
    this._background = new Background(this._gl, this);


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
        // FRAME PACING, measured at the only place that knows what a frame is. `xrPerf()` is
        // for the symptom matt actually described — head movement arriving a frame late, with
        // no rig in the scene — which a solve counter cannot see at all.
        //
        // What it reports is deliberately about CONSISTENCY, not averages: dropped frames and
        // a long tail are what read as judder, and a mean frame time hides both. A steady
        // 13.9ms with a 40ms every half second feels far worse than a steady 20ms.
        const _t0 = window._xrPerf ? performance.now() : 0;
        if (window._cursorDiag) this._cursorDiagTick(frame);
        this.applyRender(null, frame);
        if (window._xrPerf) { this._mark(null); this._xrPerfSample(time, performance.now() - _t0); }
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
    return null;   // the canvas GUI is gone; every caller was already optional-chained
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

  // `keepTool` selects without running the tool-context switch below. The timeline uses it:
  // clicking a graph row or a key unifies timeline focus with the scene selection, and must
  // not be able to change the active tool as a side effect of looking at a curve.
  setMesh(mesh, keepTool) {
    return this.setOrUnsetMesh(mesh, false, keepTool);
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

  // THE FLOOR, IN MODEL SPACE — the one number every feature that says "ground" must agree on.
  //
  // There was no such number. `PhysicsBones.groundHeight` read `main._groundY`, and NOTHING IN
  // THE APP EVER SET IT, so the physics ground option has been clamping to y = 0 since it
  // shipped rather than to the floor the user can see.
  //
  // THERE ARE TWO GRIDS AND ONLY ONE OF THEM IS REAL. `this._grid` is the legacy SculptGL
  // drawable; its render call has been commented out (see the `_showGrid` line in the render
  // path), so it is an invisible object that still carries a matrix — and that matrix puts it
  // around y = -35, nowhere near anything anyone poses. Reading it produced a clamp that could
  // never fire, which looks exactly like the feature doing nothing. The grid the user actually
  // sees is `_groundGrid`, a THREE.GridHelper added to `_worldGroup`.
  //
  // `_worldGroup` IS MODEL SPACE — it is the group every mesh's three object is added to, so a
  // child's local transform is its model matrix. `_groundGrid.position.y` is therefore already
  // in the same space as Skeleton.jointPos, with no conversion, and the 0.701 scale on
  // `_worldGroup` must NOT be applied here: that scale is model -> three-world, and both the
  // joints and the grid sit on the model side of it. (This is the same two-spaces trap the
  // motion-path work hit — see docs/. Anything that measures the grid against a joint has to
  // pick one side and stay on it.)
  groundHeight() {
    const g = this._groundGrid;
    if (g && g.position) return g.position.y;
    return 0;
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

  // THE MULTI-SELECT MODIFIER — the secondary trigger, held, as Ctrl.
  //
  // matt: "holding down the secondary controller trigger, click select then supports multi
  // select, like holding control and selecting files on windows." The gesture already existed
  // and was already read every frame for other purposes; it just never reached the selection.
  //
  // SCOPE IS DELIBERATE AND MUST STAY NARROW. The same trigger is the SMOOTH/NEGATIVE override
  // during a sculpt stroke, so this is consulted only where selecting is the point — Transform,
  // Grab, the outliner and the dopesheet. Do not "unify" it into the brushes later; the two
  // meanings are not reconcilable on one button.
  //
  // Desktop passes the real Ctrl key down through `start(ctrl)` already, so this only has to
  // answer for VR.
  multiSelectHeld() {
    return !!this._vrSecondaryTriggerPressed;
  }

  // SMOOTH MODE: HOLD THE OFF-HAND TRIGGER AND EVERYTHING IS ABOUT SMOOTH.
  //
  // LATCHED ONCE A FRAME, READ EVERYWHERE. The first version of this was a function that each
  // consumer called when it happened to need an answer -- the thumbstick, the wrist panel, the
  // cursor, the panel-sync edge check -- and they ran at four different points in the frame,
  // against state that MUTATES DURING THE FRAME. Two of those inputs move under it:
  //
  //   - `_toolIndex` is temporarily swapped to Smooth by the stroke dispatch and restored at the
  //     end of it, so anything asking mid-dispatch saw the selected tool as Smooth. That made the
  //     Paint exclusion miss, which is why painting sometimes showed Smooth's radius.
  //   - `_isPointingAtMenu` is cleared at the top of the frame and recomputed two thousand lines
  //     later, so the same question had two different answers depending on who asked.
  //
  // The result was a mode that appeared to flicker at random. matt: "its a mess." A derived
  // predicate over mutating state is not a mode; a latch is. This is computed at exactly one
  // point -- beside `_vrSecondaryTriggerPressed`, which is before the thumbstick, before the
  // dispatch and before the cursor -- and every consumer reads the stored answer.
  //
  // WHY THE OFF-HAND TRIGGER ALONE, and not both: the gesture is hold the modifier, dial in the
  // strength, THEN pull the dominant trigger to smooth. Gating on both meant the stick only
  // retargeted once you were already mid-stroke, so in practice it never retargeted at all. The
  // stroke DISPATCH still requires both (see isSmoothOverride) -- a modifier qualifies an action
  // rather than being one, and on hands a lone pinch would otherwise start smoothing the moment
  // you closed your left hand. Two different questions, two different rules, one latch each.
  _updateSmoothModeLatch() {
    const sm = this._sculptManager;
    // ALWAYS RECORD THE SELECTED TOOL, mode or no mode. This is captured before the dispatch's
    // temporary swap, so it is the only reliable answer to "what tool did the user pick" for the
    // rest of the frame -- the wrist panel's extras block keys on it.
    const selIndex = sm?.getToolIndex?.() ?? -1;
    const activeTool = sm?.getCurrentTool?.() ?? null;
    const off = { on: false, colour: false, tool: null, index: selIndex, selIndex, selTool: activeTool };
    this._smoothMode = off;
    if (!this._xrSession || !this._vrSecondaryTriggerPressed || !activeTool) return;

    // THE OFF HAND'S RAY, NOT EITHER HAND'S. The off-hand trigger is also how you CLICK a panel,
    // so a trigger pulled while THAT hand aims at one is a click, not smooth mode. This used to
    // ask `_isPointingAtMenu`, a scene-wide flag with no handedness in it, so aiming the DOMINANT
    // controller at the wrist panel -- to drag the very sliders smooth mode had just put in front
    // of you -- cancelled the mode. matt: "it reset back to the primary tool only while i was
    // laser-pointering at the minipanel."
    //
    // Through the per-hand latch rather than the live hit, for the reason _panelGrabIntent uses
    // it: a ray leaves a panel for a frame at a time and a mode flickering with that is unusable.
    const offHand = (this._dominantHand || 'right') === 'left' ? 'right' : 'left';
    if (this._panelGrabIntent(offHand)) return;

    // Paint takes the COLOUR smooth override instead, which is not a tool swap at all -- but it
    // is still a mode the modifier turns on, so it is latched here with everything else rather
    // than being re-derived by the dispatch against state that has moved since.
    if (activeTool.constructor.name === 'Paint') {
      this._smoothMode = { ...off, colour: true };
      return;
    }
    const allowed = !NO_SMOOTH_OVERRIDE.has(activeTool.constructor.name);
    if (!allowed) return;

    const idx = this._smoothToolIndex();
    if (idx === -1) return;
    const smooth = sm._tools[idx];
    // Already ON Smooth: there is no second tool to point at, so the mode is a no-op rather than
    // a state. Everything still resolves to Smooth through selIndex/selTool below.
    if (!smooth || smooth === activeTool) return;

    this._smoothMode = { on: true, colour: false, tool: smooth, index: idx, selIndex,
                         selTool: activeTool };
  }

  // The tool the UI and the thumbstick should be talking about -- the one a stick nudge changes
  // right now. Both fall through to the selected tool whenever smooth mode is not held, so these
  // are the ordinary reads the rest of the time.
  effectiveToolIndex() {
    const m = this._smoothMode;
    if (m) return m.index;
    return this._sculptManager?.getToolIndex?.() ?? -1;
  }

  effectiveTool() {
    const m = this._smoothMode;
    if (m) return m.tool || m.selTool;
    return this._sculptManager?.getCurrentTool?.() ?? null;
  }

  // What the user actually PICKED, immune to the dispatch's temporary swap. The wrist panel keys
  // its tool-specific block on this so a stroke cannot make it rebuild.
  selectedToolIndex() {
    const m = this._smoothMode;
    if (m) return m.selIndex;
    return this._sculptManager?.getToolIndex?.() ?? -1;
  }

  selectedTool() {
    const m = this._smoothMode;
    if (m) return m.selTool;
    return this._sculptManager?.getCurrentTool?.() ?? null;
  }

  // A STROKE OWNS THE CONTROLLER. NOTHING ELSE GETS A LOOK IN.
  //
  // While a manipulation is live -- a sculpt stroke, a grabbed mesh, a pin or bone being
  // puppeteered -- the controller is describing a path through the scene, and that path will
  // sooner or later sweep across a panel. Every one of those frames used to be delivered to the
  // panel as hover and press: dragging a pin past the wrist menu fired buttons and moved sliders.
  // matt: "if the cursor happens to point at a panel during a manipulation, it will start firing
  // panel events. this absolutely should not happen."
  //
  // The rule is the one he stated: while the trigger is down on a manipulation, no panel receives
  // anything and the rays are not cast at all. Cheaper as well as safer -- the hit test against
  // every visible panel is the most expensive thing in the block.
  //
  // `blocksMiniHudInput` is the tool-side half and is deliberately broader than "is a stroke
  // open": a two-handed rig gesture spans the interval where one hand has released and the other
  // still owns a pin, and that interval is exactly when a hand is most likely to swing past the
  // wrist. It used to shield only the MiniHUD; the whole point of this is that every panel needs
  // the same shield.
  _strokeOwnsInput() {
    if (this._vrSculpting) return true;
    const tool = this._sculptManager?.getCurrentTool?.();
    if (!tool) return false;
    if (tool._grabbedMesh) return true;
    return !!tool.blocksMiniHudInput?.();
  }

  // Memoised against the tools array itself: tool identity is fixed after init, and this is now
  // asked several times a frame (thumbstick, wrist panel, cursor). Keyed on the array rather than
  // a boolean so a rebuilt SculptManager re-resolves instead of returning a stale index.
  _smoothToolIndex() {
    const tools = this._sculptManager?._tools;
    if (!tools) return -1;
    if (this._smoothIdxFor !== tools) {
      this._smoothIdxFor = tools;
      this._smoothIdx = tools.findIndex(t => t && t.constructor.name === 'Smooth');
    }
    return this._smoothIdx;
  }

  setOrUnsetMesh(mesh, multiSelect, keepTool) {
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
    if (selected.length > 0 && !keepTool) {
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

      }
    }

    // A GIZMO NEEDS SOMETHING TO MOVE, and only a selection change can say so.
    //
    // The gizmo group's visibility was decided once, at the tool switch, and nothing
    // re-evaluated it — so emptying the selection (newly reachable by clicking blank space in
    // the outliner) or locking everything in it left the gizmo floating at the world origin
    // offering to drag nothing. Gizmo.render guards itself the same way, but it runs from
    // postRender, which does not run while there is no mesh, so it can hide the gizmo and never
    // bring it back.
    this.getSculptManager?.()?.syncTransformGizmoVisibility?.();

    this.getGui().updateMesh();
    this.render();
    return mesh;
  }

  _requestRender() {
    // Redundant now that Three.js runs internally via setAnimationLoop 
    // We keep the method signature for backwards compatibility across UI files
    return true;
  }

  render() {
    this._drawFullScene = true;
  }

  // One line a second: how many frames arrived, how long our own work took, and how much of the
  // gap between frames we are actually responsible for. If the interval is erratic while our
  // work is short and steady, the time is going somewhere we do not control — which is a very
  // different problem from being too slow.
  // SECTION TIMING. The total said 11.5ms for a default sphere with 5 draw calls, which cannot
  // be rendering — so the question stopped being "how much" and became "where". Only live while
  // xrPerf is on, and one performance.now() per section is nothing next to what it is measuring.
  // ONE initialiser for both, because there are two entry points into this state and they
  // disagreed: _mark runs first, at the top of the frame, and was creating a bare {} that
  // _xrPerfSample then tried to push a frame gap into. Whichever runs first has to produce the
  // whole shape.
  _xrPerfState() {
    return this._xrPerf || (this._xrPerf = {
      n: 0, work: 0, worst: 0, late: 0, last: 0, at: 0, gaps: [],
      objs: 0, geo: 0, sec: null, _markAt: 0, _markLabel: null,
    });
  }

  _mark(label) {
    if (!window._xrPerf && !window._boneTrace) return;
    const p = this._xrPerfState();
    const now = performance.now();
    if (p._markAt && p._markLabel) {
      p.sec = p.sec || {};
      p.sec[p._markLabel] = (p.sec[p._markLabel] || 0) + (now - p._markAt);
      // ALSO PER FRAME, because the average is not what anyone feels. A 129ms frame is nine
      // frames in which the controller does not move, and an average of 6ms says nothing about
      // it — the median frame can be perfect while the tail is what makes the thing unusable.
      p.frame = p.frame || {};
      p.frame[p._markLabel] = (p.frame[p._markLabel] || 0) + (now - p._markAt);
    }
    p._markAt = label ? now : 0;
    p._markLabel = label;
  }

  // -------------------------------------------------------------------------------------------
  // boneTrace() -- WHAT THE FRAME AFTER A NEW JOINT ACTUALLY PAYS FOR.
  //
  // xrPerf() averages, and an average is the wrong shape for this: the stutter is ONE frame,
  // the one where a joint first appears, and it is gone by the time a per-second line is
  // printed. This arms a recorder instead. Each time a joint is created it captures that
  // creation's own CPU cost and then the next few frames in full -- section timings, and the
  // renderer's internal caches before and after the draw.
  //
  // Those caches are the point. Guessing at "a compile" from a frame time is how the last two
  // attempts at this went; three counts the real thing and will say so:
  //   pipelines  renderer._pipelines.caches      -- render pipelines built
  //   vs / fs    renderer._pipelines.programs    -- shader programs compiled, per stage
  //   graphs     renderer._nodes.nodeBuilderCache -- TSL node graphs built
  //   geo / tex  renderer.info.memory            -- GPU uploads
  // A frame that builds nothing and is still slow is a different bug from one that builds five
  // pipelines, and until now there was no way to tell those apart from the console.
  _boneTraceSnap() {
    const r = this._renderer;
    if (!r) return null;
    const pl = r._pipelines, nd = r._nodes, pr = pl && pl.programs;
    const size = (x) => (x && typeof x.size === 'number' ? x.size : 0);
    return {
      pipelines: size(pl && pl.caches),
      vs: size(pr && pr.vertex),
      fs: size(pr && pr.fragment),
      graphs: size(nd && nd.nodeBuilderCache),
      geo: (r.info && r.info.memory) ? r.info.memory.geometries : 0,
      tex: (r.info && r.info.memory) ? r.info.memory.textures : 0,
      draws: (r.info && r.info.render) ? r.info.render.drawCalls : 0,
    };
  }

  // Called by Skeleton.createJoint with its own cost, which is the half of the bill that does
  // not appear in any frame timing.
  _boneTraceJoint(createMs, nJoints) {
    const t = window._boneTrace;
    if (!t || t.left <= 0) return;
    // A capture still open means the frames it was waiting for never came -- the tab was in the
    // background, or the joints arrived faster than the renderer. Print what it has rather than
    // dropping it: a capture with no frames in it is itself the finding.
    if (t.pend) this._boneTracePrint(t.pend);
    t.left--;
    t.pend = { createMs: createMs, joints: nJoints, frames: [], conv: [] };
  }

  // Every material the sweep converts while a capture is open, named well enough to act on --
  // and flagged NEW or reused, which is the whole question. convertBasic caches per source
  // material, so it is called for every object every frame and mostly hands back something it
  // already had; only a NEW line costs a node graph and a pipeline. Logging the call rather
  // than the build reads as "a conversion per joint" even when nothing was built.
  _boneTraceConv(o, m, conv) {
    const t = window._boneTrace;
    if (!t || !t.pend || t.pend.conv.length >= 12) return;
    const fresh = conv && !conv.userData.__btSeen;
    if (conv) conv.userData.__btSeen = true;
    if (!fresh) return;
    const path = [];
    for (let p = o; p && path.length < 4; p = p.parent) path.unshift(p.name || p.type);
    t.pend.conv.push('NEW ' + m.type + ' -> ' + conv.type + ' on ' + path.join('/'));
  }

  _boneTraceFrame(workMs) {
    const t = window._boneTrace;
    if (!t) return;
    const p = t.pend;
    if (!p) { t.base = this._boneTraceSnap(); return; }
    const now = this._boneTraceSnap();
    const b = t.base || now;
    const d = {};
    for (const k in now) if (now[k] !== b[k]) d[k] = '+' + (now[k] - b[k]);
    const sec = this._xrPerf && this._xrPerf.frame;
    const where = [];
    if (sec) {
      for (const k in sec) if (sec[k] > 0.4) where.push(k + ' ' + sec[k].toFixed(1));
      where.sort((x, y) => parseFloat(y.split(' ')[1]) - parseFloat(x.split(' ')[1]));
    }
    p.frames.push({ ms: workMs, built: d, where: where.slice(0, 5) });
    t.base = now;
    if (p.frames.length < (t.depth || 3)) return;
    this._boneTracePrint(p);
    t.pend = null;
    if (t.left <= 0) console.log('[boneTrace] done — boneTrace() again for more');
  }

  _boneTracePrint(p) {
    console.log('[boneTrace] joint ' + p.joints + ': createJoint ' + p.createMs.toFixed(1) + 'ms');
    if (!p.frames.length) console.log('[boneTrace]   (no frames rendered before the next joint)');
    for (let i = 0; i < p.frames.length; i++) {
      const f = p.frames[i];
      const built = Object.keys(f.built).length
        ? '  built ' + Object.keys(f.built).map(k => k + f.built[k]).join(' ') : '';
      console.log('[boneTrace]   frame +' + i + '  ' + f.ms.toFixed(1) + 'ms' + built
        + (f.where.length ? '  | ' + f.where.join(', ') : ''));
    }
    for (const c of p.conv) console.log('[boneTrace]   ' + c);
  }

  _xrPerfSample(time, workMs) {
    const p = this._xrPerfState();
    if (p.last) {
      const gap = time - p.last;
      p.gaps.push(gap);
      // A frame that took more than 1.5 intervals to arrive is one the headset had to reproject
      // or repeat — that is the thing being felt.
      if (gap > 20) p.late++;
    }
    p.last = time;
    p.n++;
    p.work += workMs;
    // Keep the BREAKDOWN of the worst frame, not just its duration: "the worst frame was 129ms"
    // and "the worst frame was 129ms and 118 of it was one section" are different findings.
    if (workMs > p.worst) {
      p.worst = workMs;
      p.worstSec = p.frame;
    }
    p.frame = null;

    const now = performance.now();
    if (!p.at) { p.at = now; return; }
    if (now - p.at < 1000) return;
    p.gaps.sort((a, b) => a - b);
    const med = p.gaps[p.gaps.length >> 1] || 0;
    const p95 = p.gaps[Math.floor(p.gaps.length * 0.95)] || 0;

    // WHAT THE SCENE IS CARRYING, because the frame time was seen to CLIMB - 6.5ms to 16ms
    // over a few minutes with no rig in the scene. A cost that grows is not a slow function,
    // it is something accumulating, and these four numbers say what: objects drive the
    // matrix-update traversal, geometries and textures are what leaks when something is
    // rebuilt without being disposed, and draw calls say whether it reached the GPU.
    let objs = 0;
    if (this._scene) this._scene.traverse(() => { objs++; });
    const info = this._renderer ? this._renderer.info : null;
    const grew = p.objs ? (objs - p.objs) : 0;
    const geo = info ? info.memory.geometries : 0;
    const geoGrew = p.geo ? (geo - p.geo) : 0;
    p.objs = objs; p.geo = geo;

    // DRAW CALLS ARE NAMED DIFFERENTLY ON THE TWO RENDERERS -- `calls` on WebGLRenderer,
    // `drawCalls` on WebGPURenderer -- so a straight read reports 0 on the flagged path and
    // the comparison silently becomes "one of these draws nothing". Triangles are here for
    // the same reason: a perf comparison is only a comparison if both sides are carrying the
    // same load, and that has to be shown, not assumed.
    const _r = info ? info.render : null;
    // drawCalls FIRST. Both fields exist on WebGPURenderer, but they are not the same thing:
    // measured live, drawCalls was 4 while `calls` read 2640 -- `calls` is not the per-frame
    // count there. Preferring it would have put a meaningless number next to WebGL's real one
    // and made the whole comparison junk. WebGLRenderer has no drawCalls, so it falls through.
    const _calls = _r ? (_r.drawCalls !== undefined ? _r.drawCalls : _r.calls) : 0;
    const _tris = _r ? (_r.triangles || 0) : 0;
    console.log('[xrPerf] ' + (this._isNodeRenderer ? 'WebGPU(WebGL) ' : 'WebGL ')
      + p.n + ' frames/s | our work ' + (p.work / p.n).toFixed(2) +
      'ms avg, ' + p.worst.toFixed(1) + 'ms worst | frame gap ' + med.toFixed(1) +
      'ms median, ' + p95.toFixed(1) + 'ms p95 | ' + p.late + ' late' +
      ' | scene ' + objs + (grew ? ' (' + (grew > 0 ? '+' : '') + grew + ')' : '') +
      ', geom ' + geo + (geoGrew ? ' (' + (geoGrew > 0 ? '+' : '') + geoGrew + ')' : '') +
      ', tex ' + (info ? info.memory.textures : 0) +
      ', calls ' + _calls + ', tris ' + _tris +
      ' | panel paints ' + (window._panelPaints | 0) +
      ' | skeleton refreshes ' + ((window._skelVisCalls | 0) / Math.max(1, p.n)).toFixed(1) + '/frame');
    window._panelPaints = 0;
    window._skelVisCalls = 0;
    if (p.sec) {
      const parts = Object.keys(p.sec)
        .map((k) => [k, p.sec[k] / p.n])
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => k + ' ' + v.toFixed(2))
        .join(', ');
      console.log('[xrPerf]   where: ' + parts + ' (ms/frame)');
      p.sec = null;
    }
    if (p.worstSec) {
      const w = Object.keys(p.worstSec)
        .map((k) => [k, p.worstSec[k]])
        .sort((a, b) => b[1] - a[1])
        .filter(([, v]) => v > 0.5)
        .map(([k, v]) => k + ' ' + v.toFixed(1))
        .join(', ');
      console.log('[xrPerf]   worst frame: ' + (w || '(nothing over 0.5ms — the stall was outside our work)'));
      p.worstSec = null;
    }
    p.n = 0; p.work = 0; p.worst = 0; p.late = 0; p.at = now; p.gaps.length = 0;
  }

  applyRender(arg, xrFrame = null) {
    var targetFBO = (arg && typeof arg === 'object') ? arg : null;
    this._preventRender = false;
    // boneTrace starts its clock HERE rather than in the XR frame callback, because this is the
    // one entry both paths share -- the desktop is where an instrument gets debugged, the headset
    // is where the answer is. It is stopped in _drawScene, several calls down, so the start time
    // goes on `this` and not in a local: the first version of this put it in a local and read it
    // from the other function, which never ran at all and read as "no frames rendered".
    this._btAt = window._boneTrace ? performance.now() : 0;
    this._mark('matrices');
    this.updateMatricesAndSort();
    // XR frame setup only — getFrame, getReferenceSpace, a couple of counters.
    this._mark('xr-setup');

    var gl = this._gl;
    if (!gl) return;

    if (this._renderer && this._renderer.xr && this._renderer.xr.isPresenting) {
      const frame = this._renderer.xr.getFrame();
      if (!frame) return;
      const refSpace = this._renderer.xr.getReferenceSpace();

      // BEFORE ANYTHING IS DRAWN THIS FRAME. See fixXRLayerSize: on Safari the session is sized
      // 1x1 at setSession and stays that way, so every frame lands in one pixel.
      if (this._isNodeRenderer) fixXRLayerSize(this._renderer);

      if (!window._firstXRFrameLogged) {
        window._firstXRFrameLogged = true;
        // THE SECOND VOID STARTS HERE, and nothing could see it. The itemised timing below stops
        // at this line, so a session that enters in 43ms and then compiles for 2.2 seconds --
        // one frame of it 392ms, long enough for the compositor to take the session away and
        // show the lobby -- logged an untroubled "grey void 353ms" and said no more. matt saw a
        // grey void on a run whose entry metric was identical to a run where he saw none.
        this._armSteadyState();
        const elapsed = window._xrSessionStartT ? Math.round(performance.now() - window._xrSessionStartT) : '?';
        if (window.screenLog) window.screenLog(`[XR] First frame rendered (+${elapsed}ms from session start)`, "cyan");
        console.log(`[XR Timing] First frame at +${elapsed}ms`);
        // THE VOID, ITEMISED. Everything between the button press and this line is grey lobby,
        // and "it is still long" is not something anyone can act on. Each step is printed with
        // what it cost, so the next round argues about a number instead of a guess.
        try {
          if (window._xrMarks) {
            window._xrMarks.push(['first frame', performance.now()]);
            const m = window._xrMarks;
            const total = Math.round(m[m.length - 1][1] - m[0][1]);
            const parts = [];
            for (let i = 1; i < m.length; i++) parts.push(m[i][0] + ' ' + Math.round(m[i][1] - m[i - 1][1]));
            console.log('[XR Timing] grey void ' + total + 'ms = ' + parts.join(', ') + ' (ms)');
            window._xrMarks = null;
          }
        } catch (e) { /* a probe never costs a frame */ }
        // The session warm is armed here and runs on the NEXT frame -- see below. This block is
        // still inside the first frame's work, before anything has been submitted, so warming
        // here would land inside the grey void it is meant to stay out of.
        // (the session warm is gone -- see _startRevealWarm)
        // THE AUTHORITATIVE LAYER READING, TAKEN HERE AND NOT AT setSession.
        //
        // updateRenderState is asynchronous -- it applies at the start of the next frame -- so
        // the probe that runs the moment setSession resolves reads renderState.baseLayer as
        // null whatever three chose, and reports "projectionLayer" every time. It said exactly
        // that in matt's log on a build where the patch had already logged that it forced
        // XRWebGLLayer. A diagnostic that cannot be wrong about the thing it measures is worse
        // than none: this one is read on a frame that has actually been composited.
        try {
          const _s = this._renderer.xr.getSession && this._renderer.xr.getSession();
          const _bl = _s && _s.renderState && _s.renderState.baseLayer;
          const _layer = _bl ? 'baseLayer (XRWebGLLayer)' : 'projectionLayer';
          if (window._xrComposite) window._xrComposite.layer = _layer;
          console.log('[XR] layer in use: ' + _layer);
        } catch (e) { /* a probe never costs a frame */ }
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
      // THE PANELS' PER-FRAME UPDATE, labelled at last. This ran inside the stretch the timer
      // was calling `xr-input`, which is how "the menus are not the cost" was concluded from a
      // measurement that had them filed under input. They are the cost; the RASTERISATION is
      // not, and those are different things.
      // Split two ways, because they are two different technologies with two different costs
      // and lumping them would repeat the mistake that produced `xr-input`: gui-canvas is the
      // canvas-drawn GUI, panel-html is the DOM-backed one.
      this._mark('gui-canvas');
      if (!this._htmlPanelsHidden) {
      }
      this._mark('panel-html');

      // [HTMLVRPanel] Mark dirty panels, then drain once for all of them.
      // Skipped entirely when Y-button hide is active so the polyfill does
      // no rasterisation work and we can isolate its frame cost.
      if (!this._htmlPanelsHidden) {
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
            // update() must run every frame -- it is what mounts and unmounts the panel. The
            // SYNC is only worth doing for a panel someone can see: it walks the blendshape
            // rows and rewrites their sliders, and it was running every frame for a hidden
            // panel. The show paths (_swapHtmlPanels and the two callers below) sync
            // explicitly, so nothing is stale when it appears.
            if (this._animPanel.mesh?.visible) this._animPanel.syncFromState();
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
        if (this._vrKeyboard?.mesh) {
          // Per-frame update() flushes dirty repaints — this is what makes the typed
          // text appear live in the display (without it markDirty never flushes).
          try { this._vrKeyboard.update(true); } catch (_) {}
          if (this._vrKeyboard.mesh.visible) {
            try { this._vrKeyboard._repositionIfTracking(); } catch (_) {}
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
        // THE PANEL RASTERISATION, and it took three attempts to label it honestly.
        //
        // drainRAF executes the paint callbacks the panels queued above — DOM to SVG to
        // texture upload, 20-80ms for a complex panel. This was inside a bucket called
        // `xr-input`, which is how "the menus are not the cost" got concluded twice from
        // measurements that had the paint filed under input, while a bucket that WAS called
        // `panels` measured a region after handleXRInput containing no panel work at all.
        //
        // A label that names the wrong thing is worse than no label: it does not merely fail
        // to inform, it argues confidently for the wrong conclusion.
        this._mark('panel-paint');
        drainRAF();
        this._mark('post-paint');
      }
      // Keep the VR timeline texture fresh — GuiTimeline.draw() runs in its own rAF loop.
      if (this._vrBlendMesh?.visible && this._vrBlendTexture) {
        this._vrBlendTexture.needsUpdate = true;
      }
      if (this._vrTimelineMesh?.visible && this._vrTimelineTexture) {
        const timeline = this.getGui?.()?._ctrlTimeline;
        const revision = timeline?._drawRevision || 0;
        if (revision !== this._vrTimelineUploadedRevision) {
          this._vrTimelineTexture.needsUpdate = true;
          this._vrTimelineUploadedRevision = revision;
        }
        // The resize grip is a CHILD of the panel now, so it needs no per-frame placement and
        // no per-frame show: it inherits both. Re-placed only when the geometry changes.
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
          // NOT panels — this is whatever runs between input and the rig visuals. It was
          // called `panels` and measured 0.03ms, which is a large part of why the real panel
          // cost went unfound for so long.
          this._mark('post-input');
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
            // THE RECORDING MESH IS STILL PASSED TO update(), which suppresses its own
            // EVALUATION. Skipping the call outright also skipped the global transport clock
            // that lives inside it, so a single-mesh blendshape take had nothing left in the
            // scene able to advance the playhead — see the note by the clock in update().
            window._animationRegistry.update(m);
          }
          this._drawFullScene = true;
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
          // Same as the XR loop above: update() suppresses the recording mesh's own evaluation,
          // but it must still be CALLED or the global transport clock inside it never ticks.
          window._animationRegistry.update(m);
        }
        this._drawFullScene = true; // Ensure we redraw
      }
    }

    // AUDIO FOLLOWS THE TRANSPORT, RECONCILED ONCE PER FRAME.
    //
    // Deliberately OUTSIDE both playback blocks above and gated on nothing: this call is how a
    // PAUSE reaches the audio as much as a play. `_animPlaying` is written from around
    // twenty-five places -- panels, timeline, registry, MotionTrail, PhysicsBones, Skinning --
    // and hooking them individually would mean hooking the next one that appears, too. Reading
    // the state each frame and reconciling is level-triggered, so every one of those paths
    // works without knowing audio exists. See AudioTrack.sync.
    if (window._audioTrack && window._audioTrack.hasClip()) {
      const _reg = window._animationRegistry;
      window._audioTrack.sync(
        // The registry's own field, not the _animCurrentTime mirror: the mirror is only
        // written from inside update(), which is skipped entirely when the scene holds no
        // animatable mesh, and a clock that silently stops is worse than no clock.
        _reg && Number.isFinite(_reg.globalPlaybackTime)
          ? _reg.globalPlaybackTime : (window._animCurrentTime || 0),
        !!window._animPlaying,
        window._animPlaybackSpeed !== undefined ? window._animPlaybackSpeed : 1.0,
        _reg && _reg.playbackDirection !== undefined ? _reg.playbackDirection : 1);
    }

    // PHYSICS BONES, on the pose playback just wrote and before the pins are re-seated.
    //
    // LIVE ALL THE TIME, not only during playback. matt: "they should live sim in general grab
    // mode, not just during playback." Which is right, and obvious once said — the point of a
    // tail is that it swings when you drag the character around by hand, and a jiggle you can
    // only see by pressing play is a jiggle you cannot tune.
    //
    // A SCRUB IS THE ONE THING THAT RESETS IT. Dragging the playhead backwards has no defined
    // "previous frame", so the sim is snapped back to the animated pose there and settles again
    // from it, rather than carrying state that depends on how you arrived. That is also why bake
    // exists: it turns the motion into keys, which scrub exactly.
    //
    // ...EXCEPT WHILE THE RIG ITSELF IS BEING EDITED. Drawing or re-parenting bones moves joints
    // as a matter of course, and a chain settling under gravity on top of that is a chain
    // fighting the edit — the same reason the IK pin watcher stands down on this flag.
    //
    // ...AND AFTER THE PINS, NOT BEFORE THEM. See the note at the physics call below: running
    // first meant every frame's simulation was overwritten by the solve that followed it.
    // `window._physBeforeIK = true` restores the old placement, which is the A/B this was
    // decided by and the way back if the order turns out to matter somewhere else.
    if (this._rigRestEdit) PhysicsBones.reset(this);
    else if (window._physBeforeIK && window._physicsBonesLive !== false) {
      try { PhysicsBones.tick(this); } catch (e) { console.error('physics bones failed:', e); }
    }

    // Re-seat pinned joints against the pose playback just wrote.
    //
    // A keyed pose is INTERPOLATED, and interpolation does not preserve a pin: where a foot
    // ends up is a nonlinear function of the joint rotations above it, so slerping between two
    // poses that each sit on the pin sends the foot along the chord instead of the arc. It is
    // exact at the keys and drifts by about a quarter of a leg's length between them. Maya has
    // the same behaviour and says so — pinning "only affects your FBIK effectors during
    // interaction, not during playback" — and its answer is to solve the pins every frame.
    //
    // Once per frame, and only after every joint matrix has been written: the flag is set by
    // AnimationRegistry as it writes each bone, so a timeline SCRUB is covered by the same
    // path as playback without either having to know about this.
    //
    // Guarded like the rest of the loop: a fault here must never take rendering down with it.
    // A pin dragged with the gizmo has to re-solve the rig, and nothing tells the solver that
    // happened — so the pins are watched rather than the gizmo hooked. Undo, a keyed pin and a
    // console poke all count as a move without any of them knowing the solver exists.
    // ...UNLESS THE RIG ITSELF IS BEING EDITED. A tweak or an FK pose moves joints as a matter
    // of course, and to this watcher that is indistinguishable from a pin being dragged — so it
    // solved, which moved the children, which looked like another move. The tool raises this
    // flag for the duration of the edit and re-seeds the caches when it lets go.
    if (this._rigRestEdit) { window._ikPinsDirty = false; }
    else if (window._ikHoldPins !== false && IKSolver.pinsMoved(this)) {
      // Recorded separately from the registry's flag: "a pin genuinely moved" and "playback
      // wrote a bone" are the two reasons a solve happens, and which one is firing decides
      // what the fix is. With playback PAUSED only this one can fire, so if it is still
      // counting every frame then a solve's own output is being read back as a move.
      IKSolver.perfNote('byWatcher');
      window._ikPinsDirty = true;
    }

    // THE SAME TRICK FOR BONES, which is what makes the transform gizmo a posing tool. The
    // gizmo writes a joint's matrix directly; watching for that and re-solving to wherever it
    // was put means the chain and the pins rearrange around it, instead of the drag quietly
    // editing the rig's proportions. Watched rather than hooked, so the gizmo, an undo and a
    // console poke all behave identically and none of them needs to know the solver exists.
    // The solver refreshes this cache after every solve, so its own writes cannot feed back.
    if (window._ikGizmoPose === true && !window._animPlaying && !this._rigRestEdit) {
      const movedJoint = IKSolver.externallyMovedJoint(this);
      if (movedJoint && window._ikTrace) {
        console.log('[ikPose] external move on ' +
          (movedJoint._permanentStaticLabel || movedJoint.getID()) + ' -> re-solving');
      }
      if (movedJoint) {
        try {
          IKSolver.resolveToJoint(this, movedJoint);
          Skeleton.updateVisuals(this);
          this._mark('trail');
        } catch (e) {
          console.error('IK gizmo pose failed:', e);
        }
      }
    }

    IKSolver.perfTick();

    if (window._ikPinsDirty) {
      window._ikPinsDirty = false;
      if (window._ikHoldPins !== false) {
        try {
          IKSolver.holdPins(this);
        } catch (e) {
          console.error('IK pin hold failed:', e);
        }
      }
    }

    // PHYSICS RUNS LAST, AFTER THE PINS. It used to run first, and that is what made dragging a
    // pin flicker: both author the SAME joints every frame, so with physics first its whole
    // result was overwritten by the solve a few lines below it -- while its state kept
    // accumulating, and leaked back out as a jump-and-revert whenever the two answers drifted
    // apart. Traced on matt's puppet by hooking the matrix write itself: thirteen writes a
    // frame, five from stepXPBD and the same five from rotateJoint straight afterwards, on
    // quiet frames and spiking frames alike. matt: "it always looks like a tearing/vsync issue,
    // the animation appears to be flickering slightly, but if i record and playback, its fine."
    //
    // Last is also simply the right place. IK says where the pinned joints have to be; that is
    // the pose the chain then hangs off, exactly as a DCC evaluates constraints before dynamics.
    // Playback was never affected because the keys write the same pose on every pass, so there
    // was nothing for physics to disagree with.
    //
    // `window._physBeforeIK = true` puts the old order back, for an A/B.
    if (window._physicsBonesLive !== false && !this._rigRestEdit && !window._physBeforeIK) {
      try { PhysicsBones.tick(this); } catch (e) { console.error('physics bones failed:', e); }
    }

    // Frame-by-frame (cel) animation. When the timeline is playing OR being
    // scrubbed, drive the displayed frame from the shared playhead clock so cel
    // frames line up with the dopesheet. Otherwise fall back to the frame panel's
    // own Play clock (and idle = manual frame nav stays put).
    // Keep the outliner eye icons tracking keyframed visibility live during play/scrub
    // (cheap in-place recolour; skip when idle, plus one final update when play stops).
    {
      const tl = this.getGui && this.getGui() && this.getGui()._ctrlTimeline;
      const scrubbing = !!(tl && tl._isDraggingPlayhead);
      if (window._animPlaying || scrubbing) window._updateOutlinerVisIcons?.();
      else if (this._frameWasPlaying) window._updateOutlinerVisIcons?.();
      this._frameWasPlaying = !!window._animPlaying;

      // SR onion skin: ghost neighbour frames when parked/scrubbing, hide during play.
      if (this._frameGroup) {
        if (window._animPlaying) this._frameGroup.clearOnion();
        else {
          this._frameGroup.refreshOnion();
          // Keep the live voxel mesh (and thus the hover cursor + draw plane) tracking the
          // held frame as the playhead moves, so any frame is immediately editable.
          this._frameGroup.syncActiveVoxelFrame();
        }
      }

      // VR panels are 3D meshes; desktop uses DOM overlays, so their meshes must never
      // render on desktop. Some (MiniPanel, radial) aren't _startHidden, so they'd show at
      // the world origin. Hide them whenever we're not presenting (no effect in VR).
      // window._vrPanelsOnDesktop = 1 KEEPS THEM ON OUTSIDE A SESSION.
      //
      // The panels exist in the scene on the desktop -- matt: "i've frequently zoomed into the
      // centre of the world on desktop and found tiny vr menus visible there" -- they are just
      // force-hidden here. That makes them the one VR-only symptom that CAN be reproduced on a
      // desktop, which matters because "menus do not draw under WebGPURenderer" has now cost
      // several headset trips. window._showVrPanels() sets this and parks one in front of the
      // camera; _hideVrPanels() puts it back.
      if (!this._renderer?.xr?.isPresenting && !window._vrPanelsOnDesktop) {
        const _vrPanels = [this._miniPanel, this._mainMenuPanel,
          this._toolPickerPanel, this._vrRadial, this._vrRadialMenu, this._vrConfirm,
          this._vrNumpad, this._vrKeyboard];
        for (const p of _vrPanels) if (p && p.mesh && p.mesh.visible) p.mesh.visible = false;
      }
    }

    if (this._renderer && this._renderer.xr) {
      if (this._renderer.xr.isPresenting && !window._loggedXRRender) {
         // console.log("WebXR isPresenting - forcing _drawScene()");
         window._loggedXRRender = true;
         // if (window.screenLog) window.screenLog("WebXR Render Loop Started", "lime");

      }
    }

    this._mark('draw');
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
        const timeline = this.getGui?.()?._ctrlTimeline;
        const revision = timeline?._drawRevision || 0;
        if (revision !== this._vrTimelineUploadedRevision) {
          this._vrTimelineTexture.needsUpdate = true;
          this._vrTimelineUploadedRevision = revision;
        }
        this._drawFullScene = true;
      }
    }

    // Only alter global GL state if not in WebXR -- and never on the node path.
    //
    // This raw disable is a leftover of the legacy GL pipeline, which drew its own overlays
    // after three and wanted depth off. WebGLRenderer recovered from it because the app
    // called resetState() afterwards, which invalidates three's state cache. The node
    // backend has no resetState and CACHES state (setDepthTest only touches the context when
    // its cached value changes), so this disable sticks for the whole frame: three believes
    // DEPTH_TEST is on -- its cache literally holds `2929: true` -- while the context has it
    // off, and every mesh is then drawn with no depth test.
    //
    // Measured: DEPTH_TEST read false at the moment each sculpt mesh was drawn, with a
    // 24-bit depth buffer and depthMask true, so two opaque meshes resolved by submission
    // order instead. matt: "2 objects aren't proper depth tested against each other" -- a
    // 28-unit cube inside a 34-unit sphere was drawn in front of it.
    if (!(this._renderer && this._renderer.xr && this._renderer.xr.isPresenting)
        && !this._isNodeRenderer) {
        gl.disable(gl.DEPTH_TEST);
    }

    
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

  // The ground plane's opacity. The occluded pass — the part of the grid behind objects — has its
  // OWN number now rather than tracking this one by a fixed fraction.
  //
  // The fraction was there so the two could never drift into disagreeing about how strong the
  // grid is, which is a real hazard and the wrong answer to it: how visible a grid should be in
  // front of nothing and how much of it should read THROUGH the model are two different
  // judgements, and tying them means you cannot make the second one at all. matt: "the current
  // system of following the primary grid opacity by a set offset doesn't feel right."
  //
  // The old fraction survives as the DEFAULT for the new setting, so nothing looks different
  // until the second slider is touched.
  setGridOpacity(val) {
    const v = Math.min(1, Math.max(0, val));
    if (this._groundGrid) this._groundGrid.material.opacity = v;
    // Debounced, because this is written on every frame of a slider drag.
    getOptionsURL.saveOption?.('gridOpacity', v, 250);
    this.render();
  }

  getGridOpacity() {
    return this._groundGrid ? this._groundGrid.material.opacity : (getOptionsURL().gridOpacity ?? 0.5);
  }

  setGridOccludedOpacity(val) {
    const v = Math.min(1, Math.max(0, val));
    if (this._groundGridGhost) this._groundGridGhost.material.opacity = v;
    getOptionsURL.saveOption?.('gridOccludedOpacity', v, 250);
    this.render();
  }

  getGridOccludedOpacity() {
    if (this._groundGridGhost) return this._groundGridGhost.material.opacity;
    const saved = getOptionsURL().gridOccludedOpacity;
    // Falls back to what the fraction would have given, so a session that has never set it looks
    // exactly as it did before the slider existed.
    return saved != null ? saved : (this.getGridOpacity() * GRID_GHOST_FRACTION);
  }

  // Cast shadow — a thin pass-through to SceneShadow so the panels talk to `main` like they do
  // for every other viewport setting. There is no enable/disable: flagging a mesh as a catcher IS
  // the switch. See render/SceneShadow.js.
  setShadowOpacity(v)  { this._sceneShadow?.setOpacity(v); }
  getShadowOpacity()   { return this._sceneShadow ? this._sceneShadow.getOpacity() : 0.35; }
  setShadowSoftness(v) { this._sceneShadow?.setSoftness(v); }
  getShadowSoftness()  { return this._sceneShadow ? this._sceneShadow.getSoftness() : 2.5; }
  isShadowActive()     { return this._sceneShadow ? this._sceneShadow.isActive() : false; }
  // Per-object: turn the selection into shadow-catching proxies for real-world surfaces.
  setShadowCatcher(on) {
    const ms = this.getSelectedMeshes?.() || [];
    for (let i = 0; i < ms.length; ++i) this._sceneShadow?.setMeshCatcher(ms[i], on);
  }
  getShadowCatcher() {
    const ms = this.getSelectedMeshes?.() || [];
    return ms.length > 0 && ms.every(m => this._sceneShadow?.isMeshCatcher(m));
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

  // THE SPIKE IS NOT THE SAME TOOL IN A HAND AS IT IS IN A CONTROLLER.
  //
  // A controller is a rigid object you brace against: a long spike reads as an extension of it
  // and the extra reach is useful. A pinch has no shaft — the tip is a couple of centimetres
  // from your fingers and a long spike just amplifies tremor. matt: "with the controllers a
  // longer spike is better and the angle needs to be specific, with hands a shorter spike is
  // better with a different angle."
  //
  // So the three stylus settings split by input kind rather than being one global compromise.
  // The controller values are untouched — they were tuned against a controller and nothing about
  // adding a hand variant should move them.
  _handStylus(key, fallback) {
    const o = getOptionsURL()[key];   // called — see the note in getPinchOn
    return Number.isFinite(o) ? o : fallback;
  }

  getStylusLength() {
    if (this._spikeFreeze) return this._spikeFreeze.length;   // frozen while its own slider is dragged
    if (this._handsOnlyMode()) return this._handStylus('handStylusLength', 0.05);
    const v = getOptionsURL().stylusLength;
    if (Number.isFinite(v)) return v;
    return this._isQuestStandalone ? 0.15 : 0.10;
  }

  // Every spike in the registry, not the two currently-cached controllers -- see the note where
  // they are registered. A spike whose controller has gone stays in the set and is simply written
  // again next time, which costs two property writes and cannot go stale.
  _eachSpike(fn) {
    for (const spike of (this._spikeMeshes || [])) { if (spike) fn(spike); }
    // The cached pair as well, in case one was made before the registry existed.
    for (const ctrl of [this._vrControllerLeft, this._vrControllerRight]) {
      const spike = ctrl && ctrl.getObjectByName('stylus_spike');
      if (spike && !(this._spikeMeshes && this._spikeMeshes.has(spike))) fn(spike);
    }
  }

  updateStylusLength(val) {
    const scaleFactor = val / 0.10;
    this._eachSpike((spike) => { spike.scale.set(1, 1, scaleFactor); });
  }

  getStylusOffset() {
    if (this._spikeFreeze) return this._spikeFreeze.offset;   // frozen while its own slider is dragged
    if (this._handsOnlyMode()) return this._handStylus('handStylusOffset', 0.0);
    const v = getOptionsURL().stylusOffset;
    return Number.isFinite(v) ? v : 0.0;
  }

  updateStylusOffset(val) {
    // Negative to shift forward, Positive to shift backward.
    this._eachSpike((spike) => { spike.position.z = -val; });
    // THE RAY PIVOTS WHERE THE SPIKE DOES. The visual ray used to sit at the controller
    // origin while the spike sat at -offset, both tilted by the same angle about their own
    // origins -- two PARALLEL lines separated by offset * sin(tilt). At 9 degrees and a 30mm
    // offset that is 4.7mm, and low, which is exactly what matt saw once the laser became
    // visible again: "the laser pointer and the spike are misaligned by maybe 5mm".
    //
    // -offset is also where _controllerRay puts the PICKING ray's origin, so this makes the
    // drawn ray agree with the one that actually does the picking, rather than merely with
    // the spike.
    for (const ctrl of [this._vrControllerLeft, this._vrControllerRight]) {
      const rayRoot = ctrl && ctrl.getObjectByName('pointer_ray_root');
      if (rayRoot) rayRoot.position.z = -val;
    }
  }

  // PINCH DISTANCE — the skin-to-skin gap at which the fingers count as closed.
  //
  // Zero means the tips are actually touching; positive allows a gap, negative requires them to
  // be pressed together. Tightened from 5mm to 0 after that still misclicked: matt "i'd like the
  // detected distance between index and thumb to be even smaller, i still get too many
  // misclicks". His measured deliberate pinch reaches about -17mm, so contact-to-trigger leaves
  // a wide margin for a real pinch while a hand passing casually through a 5mm gap no longer
  // fires one.
  //
  // Radius-relative, so this number means the same thing on any runtime — it is a real distance
  // between finger surfaces, not between joint centres.
  getPinchOn() {
    if (Number.isFinite(window._pinchOn)) return window._pinchOn;
    // CALLED, not read as a property: the default export is a function and `getOptionsURL.x`
    // is a property on the function object — always undefined, so the saved value was never
    // read and the setting only appeared to work until the next reload.
    const o = getOptionsURL()[ 'pinchOn' ];
    // 0.022 m OF SKIN-TO-SKIN GAP, NOT CONTACT.
    //
    // This was 0 — tips touching — on the reasoning that subtracting the reported joint radii
    // turns the measurement into a real gap that means the same thing on every device. It does
    // not. Measured on a Quest 2 (radii 0.009/0.007): a deliberate pinch reads a gap of 0.011 to
    // 0.018 and never reaches contact, while a relaxed hand reads 0.045 to 0.072. The runtime's
    // own gesture button still fired, which is why sculpting worked at all there — but every
    // consumer of OUR pinch signal was reading "not pinching" throughout.
    //
    // ONE NUMBER FOR BOTH RUNTIMES WAS THE MISTAKE, and the arithmetic above says why even as it
    // argues for it: on a Quest 2 the nearest miss is 4mm, on a Vision Pro it is 18mm. Those are
    // not the same signal, and 0.022 was chosen to clear the WORSE of the two -- so the device
    // with the better hand tracking got a threshold set by the device with the poorer.
    //
    // On a Vision Pro that lands 0.022 in the middle of "fingers are near each other" rather
    // than "fingers are closed". matt: "the finger indicators turn green when the finger/thumb
    // get close, but previously thats never been a pinch, thats been 'a pinch is about to
    // happen'. in beta, green is being treated as a pinch... it means my finger and thumb get
    // about 3cm apart, it thinks i'm pinching, locking out interactions." And with no
    // hysteresis on the pinch (see the note at the latch, which is right for a well separated
    // signal) a threshold sitting on the boundary also has to be opened PAST to release, which
    // is the other half of it: "menus get stuck, strokes get stuck".
    //
    // So the default is per RUNTIME, on the same discriminator and for the same reason foveation
    // uses it: the browser is what the behaviour actually varies with, and a model string would
    // need a new entry for every headset released. Measured gaps:
    //   Quest 2       pinch 0.011..0.018, relaxed 0.045..0.072  ->  0.022, clearing pinch by 4mm
    //   Vision Pro    pinch -0.017,       relaxed  0.040        ->  0.005, clearing pinch by 22mm
    // matt confirmed 0.005 on the Vision Pro on the spot.
    //
    // The Quest value is left exactly as it was: it works there, its margin is narrow, and this
    // is a fix for the device it was hurting rather than a retune of the one it suited.
    if (Number.isFinite(o)) return o;
    return this._isQuestStandalone ? 0.022 : 0.005;
  }

  // Grab gain: 1.0 is 1:1 with your hand. Settings slider (Navigation), window._grabGain for a
  // quick trial without opening a menu.
  getGrabGain() {
    if (Number.isFinite(window._grabGain)) return window._grabGain;
    const v = getOptionsURL().grabGain;
    return Number.isFinite(v) ? v : 1.0;
  }

  getStylusTilt() {
    if (this._spikeFreeze) return this._spikeFreeze.tilt;   // frozen while its own slider is dragged
    // ZERO FOR HANDS, AND NOT AS A DEFAULT — AS A RULE.
    //
    // A hand's ray is already pitched by _applyHandRayCorrection (window._handRayPitch, -45 by
    // measurement), applied to the controller object itself so the drawn spike and the cast ray
    // stay identical. Letting the controller's stylus tilt through as well would apply a second
    // rotation to the same ray from a setting the user dialled in for a physical controller. It
    // reads as 0 today only because the controller default happens to be 0.
    if (this._handsOnlyMode()) return 0.0;
    const v = getOptionsURL().stylusTilt;
    return Number.isFinite(v) ? v : 0.0;
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
    // BEFORE ANY EARLY RETURN. This lived in the main render block, which every
    // _vrMinimalTest level returns before -- so during the very test meant to produce an
    // empty frame, nothing was being re-tagged and every late arrival reported as `unknown`.
    if (this._uboTag) this._uboTag();

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
    //   window._vrMinimalTest = 3  → render ONE node-material sphere and nothing else
    //
    // LEVEL 3 EXISTS TO SPLIT ONE QUESTION IN HALF. The TSL spike renders correct stereo on
    // this device; the app, same renderer, does not -- "as if a single view is just being
    // spread across the 2 displays". Every explanation for that has been eliminated against
    // device output (see spike/tsl/FINDINGS.md), so the remaining move is to bisect rather
    // than theorise again.
    //
    // This renders the spike's scene through the APP's renderer, canvas, pixel ratio and XR
    // session. Correct stereo here means the renderer setup is sound and the fault is in what
    // the app draws or the state it leaves behind. Broken stereo here means the fault is in
    // the setup itself -- canvas, size, pixel ratio, or how the session was entered -- and the
    // scene contents are irrelevant.
    // Undo whatever a previous level hid, the moment the flag goes back to 0.
    if (!window._vrMinimalTest && this._minimalHidden) {
      for (const [o, v] of this._minimalHidden) o.visible = v;
      this._minimalHidden = null;
      this._minimalSeen = null;
      console.log('[vrMinimalTest] restored');
    }
    if (window._vrMinimalTest && isVRPresenting) {
      const lvl = window._vrMinimalTest;
      if (lvl >= 2) {
        // Level 2: submit nothing at all — let the XR compositor decide what to show
        return;
      }
      if (lvl === 3) {
        this._renderer.setClearColor(0x101018, 1);
        this._renderer.render(this._stereoTestScene, this._camera.getThreeCamera());
        return;
      }
      // Level 1: hide every scene object, render only clear colour.
      // SAVED, so the flag is reversible. The first version set visible=false and never
      // recorded what it had changed, so window._vrMinimalTest = 0 restored the render path
      // and left the whole scene invisible -- a debug switch you cannot switch back is a
      // session lost, and it cost matt one.
      if (this._scene) {
        // ONE RECORDING PATH. There used to be a first-frame block here as well as the
        // per-frame traverse below, and between them every object was recorded TWICE: once
        // with its real visibility, then again -- by the traverse, moments later -- reading
        // the false the first block had just written. _bisectUBO applies the list in order,
        // so the false copy always won and revealing all 194 entries drew exactly one object.
        // That is the "no errors with EVERYTHING revealed" result, and it was measuring an
        // empty frame.
        if (!this._minimalHidden) { this._minimalHidden = []; this._minimalSeen = new Set(); }
        // A FULL TRAVERSE EVERY FRAME, not a replay of the saved list. Two things escape
        // a one-shot sweep: the cursors, which _updateVRCursors re-shows before every
        // _drawScene, and anything ADDED to the scene after the sweep ran -- which is what
        // the last trace's `obj=unknown` almost certainly was. A minimal test that is not
        // minimal is worse than none, because its quiet console means nothing.
        this._scene.traverse(o => {
          if (!o.isMesh && !o.isLine && !o.isPoints && !o.isSprite) return;
          if (!this._minimalSeen) this._minimalSeen = new Set();
          if (!this._minimalSeen.has(o)) { this._minimalSeen.add(o); this._minimalHidden.push([o, o.visible]); }
          o.visible = false;
        });
        // _bisectUBO reveals a PREFIX of the list; everything else stays hidden. Restoring the
        // object's original visibility, not forcing true, so revealing something that was
        // already hidden in normal use does not change what the frame draws.
        const rv = this._minimalReveal | 0;
        for (let i = 0; i < rv && i < this._minimalHidden.length; i++) {
          this._minimalHidden[i][0].visible = this._minimalHidden[i][1];
        }
        // ONE OBJECT HELD VISIBLE THROUGH THE HIDE, for the panel ladder: an empty frame plus
        // exactly the thing under test. Set after the sweep, because the sweep runs every
        // frame and would otherwise hide it again.
        if (this._minimalForceVisible) {
          for (let o = this._minimalForceVisible; o && o !== this._scene; o = o.parent) o.visible = true;
        }
      }
      // WHAT STILL DRAWS. The stack says _renderObjectDirect, i.e. a real object on the
      // ordinary path -- so something survives the hide, and counting is the only way to know
      // rather than assume. Once a second, because this is a headset and the console is the
      // only way anything gets out.
      {
        const r = this._renderer.info && this._renderer.info.render;
        const now = performance.now();
        if (r && (!this._minLogT || now - this._minLogT > 1000)) {
          this._minLogT = now;
          console.log('[vrMinimalTest] level 1 drawCalls=' + r.drawCalls + ' tris=' + r.triangles
            + ' hidden=' + (this._minimalHidden ? this._minimalHidden.length : 0));
        }
      }
      this._renderer.setClearColor(0x003300, 1); // deep green = "minimal mode active"
      // Its own expression, NOT the _renderCam below: that is declared in the main render
      // block further down, and this branch returns before reaching it. Referencing it here
      // is a temporal dead zone throw on every frame, which is the same trap `_hand` set in
      // this file once already -- and every static check passes right up until it runs.
      this._renderer.render(this._scene, this._camera.getThreeCamera());
      this._renderer.setClearColor(0x000000, 0);
      return;
    }
    // ─────────────────────────────────────────────────────────────────────────

    // --- THREE.JS MAIN RENDER ---
    // Instead of looping through custom meshes, we tell Three.js to render the scene
    if (this._renderer && this._scene && this._camera.getThreeCamera()) {
      const isVR = this._renderer.xr && this._renderer.xr.isPresenting;

      // RAW ShaderMaterials CANNOT BE DRAWN BY THIS RENDERER AT ALL -- its library registers
      // only the built-in material types, so each one throws `THREE.NodeMaterial: Material
      // "ShaderMaterial" is not compatible.` out of build(), every object, every frame. Five
      // sites still make them directly (the volume cube/sphere, the selection box, the voxel
      // density overlay, the line material) rather than going through ShaderManager, which is
      // already routed to NodeMaterials. Hiding them keeps the flagged path legible while
      // they are ported; without it the console flood makes every other signal unreadable and
      // the throw-per-draw dominates the frame.
      // The matcap's stabilisation uniform, refreshed from the head-centre view before the
      // draw -- see NodeMaterials.updateFrame.
      if (this._isNodeRenderer) NodeMaterials.updateFrame(this);
      // SHADOW MAPS ARE OFF INSIDE AN XR SESSION, for now.
      //
      // A shadow map is an extra render target, and an extra render target inside an XR
      // frame is the exact thing that has broken this renderer twice already (the spectator
      // canvas did it, and it is what "GL_INVALID_FRAMEBUFFER_OPERATION: Framebuffer is
      // incomplete: Attachments are not all the same size" reports -- a 2048x2048 shadow map
      // against the XR framebuffer). With shadows on, menus and controller models vanish and
      // the UBO flood returns: matt, first headset run after the shadow work, "menus and
      // controllers are missing again".
      //
      // This was the known risk before any of it was written -- "verify shadow-map passes
      // under WebGPURenderer IN XR, extra render targets are the risk item, check it early"
      // -- and it was not checked early. Desktop shadows are unaffected and stay on.
      //
      // window._xrShadows = 1 turns them back on in a session, to confirm the cause and to
      // retest once the framebuffer interaction is understood.
      //
      // DEFAULT ON IN A SESSION as of 2026-09-21. The workaround above outlived its evidence:
      // shadows have been exercised in a headset across the whole lights/shadows body of work
      // and the menus-and-controllers failure has not come back. Leaving a workaround switched
      // on by default is how it stops being retested at all, and matt has to remember a flag to
      // see the feature he asked for. `?xrshadows=0`, or window._xrShadows = false, restores it.
      // THE SESSION WARM, ON THE SECOND FRAME. By now one frame has been composited, so the
      // headset is showing the scene rather than the void, and xr.getCamera() carries its two
      // views -- warming at setSession compiles an ArrayCamera[0] set that nothing ever draws
      // with, and warming during the first frame just lengthens the void.
      //
      // It makes that one frame long. That is the deliberate trade: one hitch just after the
      // scene appears, instead of a compile every time something new is first drawn.
      // (no session warm; the first draw of each object compiles it, once)
      this._stepRevealWarm();
      if (this._isNodeRenderer) {
        if (/[?&]xrshadows=0/.test(window.location.search)) window._xrShadows = false;
        const want = isVR ? (window._xrShadows !== false) : true;
        if (this._renderer.shadowMap.enabled !== want) {
          this._renderer.shadowMap.enabled = want;
          console.log('[shadows] ' + (want ? 'on' : 'off (XR)'));
        }
      }
      // window._noThreeLights = 1 stops mirroring real three lights entirely, so a session
      // can be run with no Light objects in the scene at all. Between this and ?pbrbisect=,
      // the whole "PBR moved onto three's lighting" change can be bisected in ONE session
      // rather than one trip per question.
      if (this._isNodeRenderer && !window._noThreeLights) this._syncThreeLights();
      // CAST AND RECEIVE, set on the meshes rather than globally: three reads these per
      // object, and a light entity's own gizmo geometry casting a shadow of itself into the
      // scene is not something anyone wants to see.
      if (this._isNodeRenderer) {
        for (const mesh of (this.getMeshes ? this.getMeshes() : [])) {
          const tm = mesh.getThreeMesh && mesh.getThreeMesh();
          if (!tm || mesh._isLight) continue;
          // Both flags, checked independently. The old form was
          //     if (!tm.castShadow) { tm.castShadow = true; tm.receiveShadow = true; }
          // which silently does nothing to receiveShadow for any mesh whose castShadow was
          // already set by something else -- SceneShadow.js does exactly that for the AR
          // catcher work -- leaving it unable to receive a shadow for good.
          //
          // And NOT while a session owns the graph: receiveShadow is in the render object's
          // cache key, so flipping it mid-session recompiles that object in the wrong camera
          // layout. Meshes get both flags at birth now (Mesh.js), so this is only a sweep for
          // anything predating that.
          if (!this._xrGraphFrozen && (!tm.castShadow || !tm.receiveShadow)) {
            tm.castShadow = true;
            tm.receiveShadow = true;
          }
        }
      }

      // (The controller models used to be force-swapped to a flat material here. That was a
      // guess made before the cause was known -- their GLTF materials are MeshStandardMaterial,
      // which converts to MeshStandardNodeMaterial and measured ZERO errors on the ladder, so
      // they were never the problem and the swap only cost their real appearance.)

      if (!window._showVrPanels) {
        window._showVrPanels = (which) => {
          window._vrPanelsOnDesktop = 1;
          const cam = this._camera.getThreeCamera();
          cam.updateMatrixWorld(true);
          let n = 0;
          for (const p of HTMLVRPanel._live) {
            if (!p.mesh) continue;
            const want = !which || p.constructor.name.toLowerCase().includes(String(which).toLowerCase());
            p.mesh.visible = want;
            if (want) {
              // Parked half a metre in front of the camera, facing it, at a size the desktop
              // frustum can actually see -- their VR placement is wrist-relative and ends up
              // as a speck at the origin.
              p.mesh.position.set(0, 0, -0.5).applyMatrix4(cam.matrixWorld);
              p.mesh.quaternion.copy(cam.quaternion);
              p.mesh.scale.set(1, -1, 1);
              p.markDirty?.();
              n++;
            }
          }
          this._drawFullScene = true;
          this.render?.();
          console.log('[showVrPanels] showing ' + n);
          return n;
        };
        window._hideVrPanels = () => {
          window._vrPanelsOnDesktop = 0;
          for (const p of HTMLVRPanel._live) if (p.mesh) p.mesh.visible = false;
          this._drawFullScene = true; this.render?.();
        };
      }
      // window._drawInfo() — is the panel draw being ISSUED or issued-and-discarded?
      //
      // The panel is visible, in-scene, repainting, and absent from the headset. Those two
      // cases need opposite fixes and look identical from the outside, so count the draws:
      // if pbr issues one fewer draw call than matcap, the renderer is rejecting the object
      // before it reaches the GPU (a pipeline/material problem); if the counts match, it is
      // being drawn into something the compositor never shows (a framebuffer problem).
      // THE SCENE BACKGROUND / ENVIRONMENT, which are three's own and not our env quad.
      //
      // _panelDrawDelta says the panel IS drawn (delta 4) and the pixels go nowhere, and the
      // GL error is on glDrawArrays -- the panel draws INDEXED geometry, so that error belongs
      // to a fullscreen quad. three draws scene.background as exactly that, and
      // scene.environment makes it run PMREM into a chain of differently-sized render
      // targets, which is what "Attachments are not all the same size" describes.
      //
      // Runnable from inside the session so it costs no restart: _killSceneBg() nulls both and
      // the next frame shows whether the menus come back. _restoreSceneBg() puts them back.
      if (!window._sceneBgProbe) {
        window._sceneBgProbe = () => {
          const b = this._scene.background, e = this._scene.environment;
          const d = (x) => !x ? null : (x.isTexture ? ('Texture ' + (x.image ? x.image.width + 'x' + x.image.height : '?')) : (x.isColor ? 'Color' : x.type || typeof x));
          const out = { background: d(b), environment: d(e) };
          console.log('[sceneBg] ' + JSON.stringify(out));
          return out;
        };
        window._killSceneBg = () => {
          this._savedBg = this._scene.background;
          this._savedEnv = this._scene.environment;
          this._scene.background = null;
          this._scene.environment = null;
          console.log('[sceneBg] cleared — look at the menus now');
        };
        window._restoreSceneBg = () => {
          this._scene.background = this._savedBg || null;
          this._scene.environment = this._savedEnv || null;
          console.log('[sceneBg] restored');
        };
      }

      // window._bisectUBO() — which of the 198 objects starts the errors?
      //
      // An empty frame is silent: drawCalls=0 for seconds on end with no errors, while the
      // full scene floods. So the fault is in the CONTENT, and with the frame now genuinely
      // empty the list can be bisected instead of guessed at. 198 objects is ~8 rounds, and
      // asking a person to do 8 rounds by hand in a headset is not reasonable, so it runs
      // itself: reveal a prefix, wait for the errors to settle, read the counter, halve.
      //
      // Requires _traceUBO() and _vrMinimalTest = 1 first -- the counter comes from the
      // tracer and the hidden list from level 1.
      if (!window._bisectUBO) window._bisectUBO = async () => {
        if (!this._minimalHidden || !this._minimalHidden.length) {
          console.log('[bisectUBO] run window._traceUBO() then window._vrMinimalTest = 1 first');
          return null;
        }
        if (window.__uboErrCount === undefined) { console.log('[bisectUBO] tracer is not on'); return null; }
        const list = this._minimalHidden.map(([o]) => o);
        // WALL TIME, not requestAnimationFrame. Inside an immersive session the frame loop is
        // the XRSession's, and window.rAF is not it -- the first version of this ran all eight
        // rounds in 43ms and measured nothing, because every await resolved without a frame
        // ever being drawn. Sleeping real milliseconds is crude and it is correct.
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        // Reveal the first k, let it settle, then count errors over a fixed window.
        const test = async (k) => {
          this._minimalReveal = k;
          await sleep(250);
          const before = window.__uboErrCount;
          await sleep(400);
          return window.__uboErrCount - before;
        };
        if (await test(0) > 0) {
          console.log('[bisectUBO] errors with NOTHING revealed — not scene content after all');
          this._minimalReveal = 0;
          return null;
        }
        const allErrs = await test(list.length);
        const allDc = this._renderer.info && this._renderer.info.render.drawCalls;
        if (allErrs === 0) {
          console.log('[bisectUBO] no errors with EVERYTHING revealed (drawCalls=' + allDc
            + ') — if that count is 0, nothing was actually drawn and the run is void');
          this._minimalReveal = 0;
          return null;
        }
        let lo = 0, hi = list.length;          // lo is known-clean, hi is known-dirty
        while (hi - lo > 1) {
          const mid = (lo + hi) >> 1;
          const errs = await test(mid);
          const dc = this._renderer.info && this._renderer.info.render.drawCalls;
          console.log('[bisectUBO] first ' + mid + ' revealed -> ' + errs + ' errors, drawCalls=' + dc);
          if (errs > 0) hi = mid; else lo = mid;
        }
        const o = list[hi - 1];
        // A PARENT GETS THE BLAME FOR ITS CHILDREN. Revealing an object lets its whole
        // subtree draw, so the bisection attributes to the ancestor -- stylus_spike has a
        // child, stylus_spike_ghost, with an unusual GreaterDepth mode. Hide the descendants
        // one at a time and see whether the parent is innocent.
        const kids = [];
        o.traverse((c) => { if (c !== o && (c.isMesh || c.isLine || c.isPoints || c.isSprite)) kids.push(c); });
        {
          // MEASURED TWICE, TAKING THE WORST. The first version gated the whole refinement on
          // a single re-measure at the boundary -- and that re-measure came back 0 while the
          // binary search had just seen errors there, so nothing ran and the round was
          // wasted. The flood is not steady (the driver stops reporting after a few hundred,
          // and the errors come in bursts), so one sample is not enough to call a state clean.
          const probe = async () => Math.max(await test(hi), await test(hi));
          const base = await probe();
          console.log('[bisectUBO]   baseline at the boundary -> ' + base + ' errors');
          {
            for (const c of (kids || [])) {
              const was = c.visible;
              c.visible = false;
              const errs = await probe();
              c.visible = was;
              console.log('[bisectUBO]   without child ' + (c.name || c.type) + ' -> ' + errs + ' errors');
              if (errs === 0) {
                console.log('[bisectUBO] REAL CULPRIT is the child: ' + (c.name || c.type)
                  + ' mat=' + (c.material && c.material.type)
                  + ' depthFunc=' + (c.material && c.material.depthFunc)
                  + ' transparent=' + (c.material && c.material.transparent)
                  + ' order=' + c.renderOrder);
                this._minimalReveal = 0;
                return c;
              }
            }
            console.log('[bisectUBO]   no single child explains it — the parent itself draws badly');
            // TWO VARIABLES LEFT ON THIS OBJECT: its geometry and its material. Swap each for
            // something known-good and re-measure, so the answer is one of them rather than
            // another round of guessing. The spike is a CONE -- CylinderGeometry with
            // radiusTop 0 -- which is the kind of degenerate-at-the-tip shape worth suspecting
            // before anything subtler.
            const origGeo = o.geometry, origMat = o.material;
            if (!this._bisectBoxGeo) this._bisectBoxGeo = new THREE.BoxGeometry(0.01, 0.01, 0.05);
            o.geometry = this._bisectBoxGeo;
            const geoErrs = await probe();
            o.geometry = origGeo;
            console.log('[bisectUBO]   with a plain box geometry -> ' + geoErrs + ' errors');

            let matErrs = -1;
            if (NodeMaterials._solid) {
              o.material = NodeMaterials._solid;
              matErrs = await probe();
              o.material = origMat;
              console.log('[bisectUBO]   with the known-good solid material -> ' + matErrs + ' errors');
            }
            console.log('[bisectUBO]   => '
              + (geoErrs === 0 ? 'THE GEOMETRY'
                : matErrs === 0 ? 'THE MATERIAL'
                : 'NEITHER swap helped — it is the object or its place in the graph'));
          }
        }
        console.log('[bisectUBO] CULPRIT #' + (hi - 1) + ': ' + (o.name || o.type)
          + ' mat=' + (o.material && o.material.type)
          + ' order=' + o.renderOrder
          + ' geom=' + (o.geometry && o.geometry.type)
          + ' indexed=' + !!(o.geometry && o.geometry.index)
          + ' verts=' + (o.geometry && o.geometry.attributes.position
            ? o.geometry.attributes.position.count : '?'));
        this._minimalReveal = 0;
        return o;
      };

      // window._dumpShader([name]) — THE GENERATED SHADER, not a guess about it.
      //
      // matt: "these errors seem too vague, does three offer any better methods for
      // debugging than this?" It does, and I should have reached for it far sooner:
      // renderer.debug.getShaderAsync(scene, camera, object) returns the raw generated
      // vertex and fragment source for one object, uniform block declarations included.
      //
      // "GL_INVALID_OPERATION: uniform buffer that is too small" is a claim about a block
      // whose contents we have been inferring all evening. This prints it. Run it in a
      // session with a light placed, on the sculpt, and the block that overflows is
      // readable rather than deduced.
      if (!window._dumpShader) window._dumpShader = async (name) => {
        const cam = (this._renderer.xr && this._renderer.xr.isPresenting)
          ? this._renderer.xr.getCamera() : this._camera.getThreeCamera();
        let target = null;
        if (!name) {
          // THE SCULPT BY DEFAULT. The first visible mesh in the graph is the ground grid,
          // whose shader is 1179 characters and says nothing about the problem.
          const first = (this.getMeshes ? this.getMeshes() : [])
            .find((m) => !m._isLight && m.getThreeMesh && m.getThreeMesh());
          target = first && first.getThreeMesh();
        }
        if (!target) this._scene.traverse((o) => {
          if (target || !o.isMesh || !o.visible) return;
          if (!name || (o.name || '').toLowerCase().includes(String(name).toLowerCase())) target = o;
        });
        if (!target) { console.log('[dumpShader] no visible mesh matching ' + name); return null; }
        const src = await this._renderer.debug.getShaderAsync(this._scene, cam, target);
        console.log('[dumpShader] ' + (target.name || target.type)
          + ' mat=' + (target.material && target.material.type));
        console.log('--- VERTEX ---\n' + (src.vertexShader || '').slice(0, 4000));
        console.log('--- FRAGMENT ---\n' + (src.fragmentShader || '').slice(0, 8000));
        window.__lastShader = src;
        return src;
      };

      // window._traceUBO() — WHICH object's draw emits the error?
      //
      // Every theory I have formed about this has been wrong: the material class, the stock
      // conversion, the texture, the transform, the framebuffer, pipeline warming, uniform
      // padding, scene.background. The error message has been sitting there the whole time
      // naming a specific draw call, so stop inferring and ask the driver directly.
      //
      // Wraps drawElements/drawArrays on the real context, calls getError() immediately after
      // each, and reports the object that was being drawn (captured via onBeforeRender). That
      // is the one fact nothing so far has established: WHAT is too small for WHAT. Expensive
      // -- a synchronous getError per draw stalls the pipeline -- so it is opt-in and
      // self-limiting.
      if (!window._traceUBO) window._traceUBO = (maxReports) => {
        const gl = this._renderer.backend && this._renderer.backend.gl;
        if (!gl) { console.log('[traceUBO] no raw context'); return false; }
        if (gl.__uboTraced) { console.log('[traceUBO] already on'); return true; }
        gl.__uboTraced = true;
        const limit = maxReports || 12;
        let reports = 0;
        window.__uboErrCount = 0;
        const seen = new Set();
        let cur = null;
        // Tag every drawable so the wrapper knows what is on the GPU right now.
        //
        // RE-TAGGED EVERY FRAME, because tagging once names only what existed at the moment
        // tracing started. The previous run reported `obj=unknown mat=none` and I read that
        // as three drawing something anonymous -- but the backend has only four drawArrays
        // call sites and the object-draw one receives the object, so an untagged object is a
        // tagging failure, not an anonymous draw. Anything added after _traceUBO() ran was
        // invisible to it.
        const tag = (o) => {
          if (!o.isMesh && !o.isLine && !o.isPoints && !o.isSprite) return;
          if (o.userData.__uboTagged) return;
          o.userData.__uboTagged = true;
          const prev = o.onBeforeRender;
          o.onBeforeRender = function (...a) {
            cur = o;
            if (prev) prev.apply(this, a);
          };
        };
        this._uboTag = () => this._scene.traverse(tag);
        this._uboTag();
        const wrap = (name) => {
          const orig = gl[name].bind(gl);
          gl[name] = function (...args) {
            const r = orig(...args);
            if (true) {
              const e = gl.getError();
              if (e !== 0) {
                window.__uboErrCount++;
                const key = (cur && (cur.name || cur.type)) + ':' + e;
                if (!seen.has(key)) {
                  seen.add(key);
                  reports++;
                  const m = cur && cur.material;
                  console.log('[traceUBO] ' + name + ' err=0x' + e.toString(16)
                    + ' obj=' + (cur ? (cur.name || cur.type) : 'unknown')
                    + ' mat=' + (m ? (m.type + (m.userData && m.userData.isNodePanel ? '(panel)' : '')) : 'none')
                    + ' order=' + (cur ? cur.renderOrder : '?')
                    + ' visible=' + (cur ? cur.visible : '?'));
                  // AND THE STACK, when we cannot name the object. `cur` is null means the
                  // draw happened before any tagged object drew -- so no amount of better
                  // tagging will name it, and the only thing that can is three's own call
                  // path. Four frames is enough to see which backend function issued it.
                  if (!cur) {
                    const st = (new Error().stack || '').split('\n').slice(1, 6)
                      .map((l) => l.trim().replace(/^at\s+/, '')).join(' <- ');
                    console.log('[traceUBO]   via ' + st);
                  }
                }
              }
            }
            return r;
          };
        };
        wrap('drawElements');
        wrap('drawArrays');
        if (gl.drawElementsInstanced) wrap('drawElementsInstanced');
        console.log('[traceUBO] on — errors will be reported with the object that caused them');
        return true;
      };

      // window._panelVariant(n) — matt's method: start from what WORKS and add features.
      //
      // MeshNormalNodeMaterial drew on the panel even while a THREE.Line was poisoning the
      // frame, so it is immune to whatever this is. Walking forward from it finds the feature
      // that loses the immunity, which is a far better question than "what is wrong with the
      // broken material" -- the one the last dozen rounds asked, and got wrong every time.
      //
      // Every variant is pre-built and warmed, so the whole ladder can be walked in ONE
      // session: call it with 0..6 and watch when the panel vanishes and the errors start.
      //   0 normal material (known good)   4 texture, opaque
      //   1 flat colour, opaque            5 texture + transparent + alpha
      //   2 + transparent                  6 the real panel material (adds the grade)
      //   3 + opacityNode
      // and, once the ladder showed the break is at 1 -- MeshBasicNodeMaterial itself, with
      // no texture and no transparency -- the same flat colour on other base classes:
      //   7 normal + colorNode   8 lambert   9 phong   10 standard   11 matcap
      // A rung with ZERO errors that still draws is the base the panels should be built on.
      if (!window._panelVariant) window._panelVariant = (n, meshOnly) => {
        const vs = NodeMaterials._panelVariants;
        if (!vs) { console.log('[panelVariant] variants not built'); return null; }
        const i = Math.max(0, Math.min(vs.length - 1, n | 0));
        const mat = vs[i];
        let applied = 0;
        for (const p of HTMLVRPanel._live) {
          if (!p.mesh) continue;
          if (!p.mesh.userData._origVariantMat) p.mesh.userData._origVariantMat = p.mesh.material;
          if (meshOnly && p.mesh !== meshOnly) continue;
          if (mat.userData && mat.userData.setMap && p._texture) mat.userData.setMap(p._texture);
          p.mesh.material = mat;
          // VISIBLE, which _panelMat did and this did not -- so the first ladder run swapped
          // materials on eight hidden panels and measured the rest of the scene instead
          // (drawCalls=47 on every rung, the whole scene, with no panel on screen at all).
          p.mesh.visible = true;
          applied++;
        }
        const errBefore = window.__uboErrCount;
        console.log('[panelVariant] ' + i + ' applied to ' + applied
          + ' panels — watch the panel and the error count'
          + (errBefore === undefined ? ' (run _traceUBO() first to count errors)' : ''));
        return i;
      };
      if (!window._panelVariantRestore) window._panelVariantRestore = () => {
        for (const p of HTMLVRPanel._live) {
          if (p.mesh && p.mesh.userData._origVariantMat) {
            p.mesh.material = p.mesh.userData._origVariantMat;
            p.mesh.userData._origVariantMat = null;
          }
        }
      };
      // And the same walk, automated: step every variant, count errors on each, print a table.
      if (!window._panelLadder) window._panelLadder = async () => {
        if (window.__uboErrCount === undefined) { console.log('[panelLadder] run _traceUBO() first'); return null; }
        const vs = NodeMaterials._panelVariants || [];
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        // AN EMPTY FRAME PLUS ONE PANEL. The first run measured the whole scene -- 47 draw
        // calls and ~120 ambient errors on every rung -- which cannot show a panel-sized
        // signal. Level 1 empties the frame; _minimalForceVisible holds the one panel under
        // test through the per-frame sweep.
        const target = [...HTMLVRPanel._live].find((p) => p.mesh && p._texture) || [...HTMLVRPanel._live][0];
        if (!target || !target.mesh) { console.log('[panelLadder] no panel to test'); return null; }
        const restoreLevel = window._vrMinimalTest;
        window._vrMinimalTest = 1;
        this._minimalForceVisible = target.mesh;
        await sleep(600);
        const idle = await (async () => {
          const b = window.__uboErrCount; await sleep(400); return window.__uboErrCount - b;
        })();
        console.log('[panelLadder] empty frame + no panel material change -> ' + idle
          + ' errors, drawCalls=' + (this._renderer.info && this._renderer.info.render.drawCalls)
          + ' (panel: ' + target.constructor.name + ')');
        const rows = [];
        for (let i = 0; i < vs.length; i++) {
          window._panelVariant(i, target.mesh);
          await sleep(250);
          const before = window.__uboErrCount;
          await sleep(400);
          const errs = window.__uboErrCount - before;
          const dc = this._renderer.info && this._renderer.info.render.drawCalls;
          rows.push({ variant: i, errors: errs, drawCalls: dc });
          console.log('[panelLadder] variant ' + i + ' -> ' + errs + ' errors, drawCalls=' + dc);
        }
        console.log('[panelLadder] ' + JSON.stringify(rows));
        this._minimalForceVisible = null;
        window._vrMinimalTest = restoreLevel || 0;
        window._panelVariantRestore();
        return rows;
      };

      // window._panelMat('normal'|'restore') — the sharpest cut left.
      //
      // With 91 objects hidden and the panel alone in the frame, still nothing. So no other
      // draw is poisoning it: the panel's own draw fails. And the failing set now looks like
      // a material CLASS rather than a texture:
      //   MeshBasicNodeMaterial + canvas map   (panels)      invisible
      //   MeshBasicNodeMaterial, flat magenta, no map        invisible  (_panelSolid)
      //   MeshBasicNodeMaterial + matcap image (matcap mat)  invisible  (_meshMat matcap)
      //   MeshNormalNodeMaterial                             DRAWS
      //   GLTF controller materials                          DRAW
      // The awkward exception is that our PBR material is ALSO a MeshBasicNodeMaterial and it
      // draws -- so if the normal material makes the panel appear, the split is real and the
      // PBR one differs by having a colorNode that replaces the whole basic pipeline.
      if (!window._panelMat) {
        window._panelMat = (which) => {
          const mat = String(which) === 'restore' ? null : NodeMaterials.get(2); // NORMAL
          let n = 0;
          for (const p of HTMLVRPanel._live) {
            if (!p.mesh) continue;
            if (mat) {
              if (!p.mesh.userData._origMat2) p.mesh.userData._origMat2 = p.mesh.material;
              p.mesh.material = mat;
              p.mesh.visible = true;
              n++;
            } else if (p.mesh.userData._origMat2) {
              p.mesh.material = p.mesh.userData._origMat2;
              p.mesh.userData._origMat2 = null;
            }
          }
          console.log('[panelMat] ' + which + ' -> ' + n);
          return n;
        };
      }

      // window._soloPanels() — hide EVERYTHING except the panels. _unsolo() restores.
      //
      // Where the evidence now stands, all of it from inside one session: the sculpt is not
      // the cause (_hideMeshes left the menus gone), and the matcap material -- the very same
      // object that draws correctly in a matcap session -- DISAPPEARS when assigned here. So
      // a pbr session comes up in a state where some materials cannot draw at all, and the
      // panels are in that set while MeshNormalNodeMaterial and the controllers are not.
      //
      // Two possibilities left, and they need opposite fixes:
      //   panels appear alone -> some OTHER draw in the frame poisons them, and the fix is to
      //                          find which (the UBO error is that draw failing).
      //   still nothing       -> the panel pipeline itself cannot be built in this session,
      //                          and warming it on the desktop did not produce the variant XR
      //                          asks for.
      if (!window._soloPanels) {
        window._soloPanels = () => {
          const panelMeshes = new Set();
          for (const p of HTMLVRPanel._live) if (p.mesh) panelMeshes.add(p.mesh);
          this._soloSaved = [];
          this._scene.traverse((o) => {
            if (!o.isMesh && !o.isLine && !o.isPoints && !o.isSprite) return;
            let isPanel = false;
            for (let q = o; q; q = q.parent) if (panelMeshes.has(q)) { isPanel = true; break; }
            if (isPanel) return;
            this._soloSaved.push([o, o.visible]);
            o.visible = false;
          });
          // ...and make one panel visible, so there is something to look for.
          const first = [...panelMeshes][0];
          if (first) first.visible = true;
          console.log('[soloPanels] hid ' + this._soloSaved.length + ' — is a panel there now?');
          return this._soloSaved.length;
        };
        window._unsolo = () => {
          for (const [o, v] of (this._soloSaved || [])) o.visible = v;
          this._soloSaved = [];
          console.log('[soloPanels] restored');
        };
      }

      // window._meshMat('matcap'|'pbr'|'normal') — swap ONLY the sculpt's material, live.
      // window._hideMeshes() / _showMeshes()      — take the sculpt out of the frame entirely.
      //
      // matt's premise, and the only fact that has held up all the way through: it works in
      // matcap and fails in pbr. Everything else has been my theorising. So change exactly
      // that one thing inside ONE session -- same panels, same session, same framebuffer, same
      // controllers -- and watch the menus and the UBO errors.
      //   menus return on 'matcap'  -> the sculpt's MATERIAL takes the frame down, and the
      //                                panels are collateral. The UBO error is the mechanism.
      //   menus stay gone           -> the mesh material is not the variable either, and what
      //                                differs between the two sessions is something else the
      //                                shader id switches on.
      // Every material here was built at startup and warmed, so nothing is constructed inside
      // the session -- which is the one thing this renderer must not do.
      if (!window._meshMat) {
        window._meshMat = (name) => {
          const ids = { pbr: 0, flat: 1, normal: 2, matcap: 5 };
          const id = ids[String(name).toLowerCase()];
          if (id === undefined) { console.log('[meshMat] use pbr|flat|normal|matcap'); return 0; }
          const mat = NodeMaterials.get(id);
          if (!mat) { console.log('[meshMat] no material for ' + name); return 0; }
          let n = 0;
          for (const mesh of (this.getMeshes ? this.getMeshes() : [])) {
            const tm = mesh.getThreeMesh && mesh.getThreeMesh();
            if (tm) { tm.material = mat; n++; }
          }
          console.log('[meshMat] ' + name + ' -> ' + n + ' meshes');
          return n;
        };
        window._hideMeshes = () => {
          let n = 0;
          for (const mesh of (this.getMeshes ? this.getMeshes() : [])) {
            const tm = mesh.getThreeMesh && mesh.getThreeMesh();
            if (tm) { tm.visible = false; n++; }
          }
          console.log('[hideMeshes] hid ' + n + ' — menus back?');
          return n;
        };
        window._showMeshes = () => {
          for (const mesh of (this.getMeshes ? this.getMeshes() : [])) {
            const tm = mesh.getThreeMesh && mesh.getThreeMesh();
            if (tm) tm.visible = true;
          }
        };
      }

      // window._panelSolid() — is the panel invisible because its TEXTURE never arrived?
      //
      // A quad drawn with a texture that failed to upload is fully transparent, which looks
      // exactly like a quad that was never drawn -- and _panelDrawDelta already proved it IS
      // drawn. Swapping in a flat magenta material (pre-built at startup, so nothing is
      // constructed inside the session) tells the two apart:
      //   magenta rectangle appears -> the geometry and the framebuffer are fine, the TEXTURE
      //                                is the problem
      //   still nothing             -> the draw lands somewhere the compositor never shows
      if (!window._panelSolid) {
        window._panelSolid = () => {
          const solid = NodeMaterials._solid;
          if (!solid) { console.log('[panelSolid] no solid material'); return 0; }
          let n = 0;
          for (const p of HTMLVRPanel._live) {
            if (!p.mesh || !p.mesh.visible) continue;
            if (!p.mesh.userData._origMat) p.mesh.userData._origMat = p.mesh.material;
            p.mesh.material = solid;
            n++;
          }
          console.log('[panelSolid] swapped ' + n + ' — look where the menu should be');
          return n;
        };
        window._panelRestoreMat = () => {
          for (const p of HTMLVRPanel._live) {
            if (p.mesh && p.mesh.userData._origMat) {
              p.mesh.material = p.mesh.userData._origMat;
              p.mesh.userData._origMat = null;
            }
          }
          console.log('[panelSolid] restored');
        };
      }

      // window._bisectUBO() — which of the 198 objects starts the errors?
      //
      // An empty frame is silent: drawCalls=0 for seconds on end with no errors, while the
      // full scene floods. So the fault is in the CONTENT, and with the frame now genuinely
      // empty the list can be bisected instead of guessed at. 198 objects is ~8 rounds, and
      // asking a person to do 8 rounds by hand in a headset is not reasonable, so it runs
      // itself: reveal a prefix, wait for the errors to settle, read the counter, halve.
      //
      // Requires _traceUBO() and _vrMinimalTest = 1 first -- the counter comes from the
      // tracer and the hidden list from level 1.
      if (!window._bisectUBO) window._bisectUBO = async () => {
        if (!this._minimalHidden || !this._minimalHidden.length) {
          console.log('[bisectUBO] run window._traceUBO() then window._vrMinimalTest = 1 first');
          return null;
        }
        if (window.__uboErrCount === undefined) { console.log('[bisectUBO] tracer is not on'); return null; }
        const list = this._minimalHidden.map(([o]) => o);
        // WALL TIME, not requestAnimationFrame. Inside an immersive session the frame loop is
        // the XRSession's, and window.rAF is not it -- the first version of this ran all eight
        // rounds in 43ms and measured nothing, because every await resolved without a frame
        // ever being drawn. Sleeping real milliseconds is crude and it is correct.
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        // Reveal the first k, let it settle, then count errors over a fixed window.
        const test = async (k) => {
          this._minimalReveal = k;
          await sleep(250);
          const before = window.__uboErrCount;
          await sleep(400);
          return window.__uboErrCount - before;
        };
        if (await test(0) > 0) {
          console.log('[bisectUBO] errors with NOTHING revealed — not scene content after all');
          this._minimalReveal = 0;
          return null;
        }
        const allErrs = await test(list.length);
        const allDc = this._renderer.info && this._renderer.info.render.drawCalls;
        if (allErrs === 0) {
          console.log('[bisectUBO] no errors with EVERYTHING revealed (drawCalls=' + allDc
            + ') — if that count is 0, nothing was actually drawn and the run is void');
          this._minimalReveal = 0;
          return null;
        }
        let lo = 0, hi = list.length;          // lo is known-clean, hi is known-dirty
        while (hi - lo > 1) {
          const mid = (lo + hi) >> 1;
          const errs = await test(mid);
          const dc = this._renderer.info && this._renderer.info.render.drawCalls;
          console.log('[bisectUBO] first ' + mid + ' revealed -> ' + errs + ' errors, drawCalls=' + dc);
          if (errs > 0) hi = mid; else lo = mid;
        }
        const o = list[hi - 1];
        // A PARENT GETS THE BLAME FOR ITS CHILDREN. Revealing an object lets its whole
        // subtree draw, so the bisection attributes to the ancestor -- stylus_spike has a
        // child, stylus_spike_ghost, with an unusual GreaterDepth mode. Hide the descendants
        // one at a time and see whether the parent is innocent.
        const kids = [];
        o.traverse((c) => { if (c !== o && (c.isMesh || c.isLine || c.isPoints || c.isSprite)) kids.push(c); });
        {
          // MEASURED TWICE, TAKING THE WORST. The first version gated the whole refinement on
          // a single re-measure at the boundary -- and that re-measure came back 0 while the
          // binary search had just seen errors there, so nothing ran and the round was
          // wasted. The flood is not steady (the driver stops reporting after a few hundred,
          // and the errors come in bursts), so one sample is not enough to call a state clean.
          const probe = async () => Math.max(await test(hi), await test(hi));
          const base = await probe();
          console.log('[bisectUBO]   baseline at the boundary -> ' + base + ' errors');
          {
            for (const c of (kids || [])) {
              const was = c.visible;
              c.visible = false;
              const errs = await probe();
              c.visible = was;
              console.log('[bisectUBO]   without child ' + (c.name || c.type) + ' -> ' + errs + ' errors');
              if (errs === 0) {
                console.log('[bisectUBO] REAL CULPRIT is the child: ' + (c.name || c.type)
                  + ' mat=' + (c.material && c.material.type)
                  + ' depthFunc=' + (c.material && c.material.depthFunc)
                  + ' transparent=' + (c.material && c.material.transparent)
                  + ' order=' + c.renderOrder);
                this._minimalReveal = 0;
                return c;
              }
            }
            console.log('[bisectUBO]   no single child explains it — the parent itself draws badly');
            // TWO VARIABLES LEFT ON THIS OBJECT: its geometry and its material. Swap each for
            // something known-good and re-measure, so the answer is one of them rather than
            // another round of guessing. The spike is a CONE -- CylinderGeometry with
            // radiusTop 0 -- which is the kind of degenerate-at-the-tip shape worth suspecting
            // before anything subtler.
            const origGeo = o.geometry, origMat = o.material;
            if (!this._bisectBoxGeo) this._bisectBoxGeo = new THREE.BoxGeometry(0.01, 0.01, 0.05);
            o.geometry = this._bisectBoxGeo;
            const geoErrs = await probe();
            o.geometry = origGeo;
            console.log('[bisectUBO]   with a plain box geometry -> ' + geoErrs + ' errors');

            let matErrs = -1;
            if (NodeMaterials._solid) {
              o.material = NodeMaterials._solid;
              matErrs = await probe();
              o.material = origMat;
              console.log('[bisectUBO]   with the known-good solid material -> ' + matErrs + ' errors');
            }
            console.log('[bisectUBO]   => '
              + (geoErrs === 0 ? 'THE GEOMETRY'
                : matErrs === 0 ? 'THE MATERIAL'
                : 'NEITHER swap helped — it is the object or its place in the graph'));
          }
        }
        console.log('[bisectUBO] CULPRIT #' + (hi - 1) + ': ' + (o.name || o.type)
          + ' mat=' + (o.material && o.material.type)
          + ' order=' + o.renderOrder
          + ' geom=' + (o.geometry && o.geometry.type)
          + ' indexed=' + !!(o.geometry && o.geometry.index)
          + ' verts=' + (o.geometry && o.geometry.attributes.position
            ? o.geometry.attributes.position.count : '?'));
        this._minimalReveal = 0;
        return o;
      };

      // window._dumpShader([name]) — THE GENERATED SHADER, not a guess about it.
      //
      // matt: "these errors seem too vague, does three offer any better methods for
      // debugging than this?" It does, and I should have reached for it far sooner:
      // renderer.debug.getShaderAsync(scene, camera, object) returns the raw generated
      // vertex and fragment source for one object, uniform block declarations included.
      //
      // "GL_INVALID_OPERATION: uniform buffer that is too small" is a claim about a block
      // whose contents we have been inferring all evening. This prints it. Run it in a
      // session with a light placed, on the sculpt, and the block that overflows is
      // readable rather than deduced.
      if (!window._dumpShader) window._dumpShader = async (name) => {
        const cam = (this._renderer.xr && this._renderer.xr.isPresenting)
          ? this._renderer.xr.getCamera() : this._camera.getThreeCamera();
        let target = null;
        this._scene.traverse((o) => {
          if (target || !o.isMesh || !o.visible) return;
          if (!name || (o.name || '').toLowerCase().includes(String(name).toLowerCase())) target = o;
        });
        if (!target) { console.log('[dumpShader] no visible mesh matching ' + name); return null; }
        const src = await this._renderer.debug.getShaderAsync(this._scene, cam, target);
        console.log('[dumpShader] ' + (target.name || target.type)
          + ' mat=' + (target.material && target.material.type));
        console.log('--- VERTEX ---\n' + (src.vertexShader || '').slice(0, 4000));
        console.log('--- FRAGMENT ---\n' + (src.fragmentShader || '').slice(0, 8000));
        window.__lastShader = src;
        return src;
      };

      // window._traceUBO() — WHICH object's draw emits the error?
      //
      // Every theory I have formed about this has been wrong: the material class, the stock
      // conversion, the texture, the transform, the framebuffer, pipeline warming, uniform
      // padding, scene.background. The error message has been sitting there the whole time
      // naming a specific draw call, so stop inferring and ask the driver directly.
      //
      // Wraps drawElements/drawArrays on the real context, calls getError() immediately after
      // each, and reports the object that was being drawn (captured via onBeforeRender). That
      // is the one fact nothing so far has established: WHAT is too small for WHAT. Expensive
      // -- a synchronous getError per draw stalls the pipeline -- so it is opt-in and
      // self-limiting.
      if (!window._traceUBO) window._traceUBO = (maxReports) => {
        const gl = this._renderer.backend && this._renderer.backend.gl;
        if (!gl) { console.log('[traceUBO] no raw context'); return false; }
        if (gl.__uboTraced) { console.log('[traceUBO] already on'); return true; }
        gl.__uboTraced = true;
        const limit = maxReports || 12;
        let reports = 0;
        window.__uboErrCount = 0;
        const seen = new Set();
        let cur = null;
        // Tag every drawable so the wrapper knows what is on the GPU right now.
        //
        // RE-TAGGED EVERY FRAME, because tagging once names only what existed at the moment
        // tracing started. The previous run reported `obj=unknown mat=none` and I read that
        // as three drawing something anonymous -- but the backend has only four drawArrays
        // call sites and the object-draw one receives the object, so an untagged object is a
        // tagging failure, not an anonymous draw. Anything added after _traceUBO() ran was
        // invisible to it.
        const tag = (o) => {
          if (!o.isMesh && !o.isLine && !o.isPoints && !o.isSprite) return;
          if (o.userData.__uboTagged) return;
          o.userData.__uboTagged = true;
          const prev = o.onBeforeRender;
          o.onBeforeRender = function (...a) {
            cur = o;
            if (prev) prev.apply(this, a);
          };
        };
        this._uboTag = () => this._scene.traverse(tag);
        this._uboTag();
        const wrap = (name) => {
          const orig = gl[name].bind(gl);
          gl[name] = function (...args) {
            const r = orig(...args);
            if (true) {
              const e = gl.getError();
              if (e !== 0) {
                window.__uboErrCount++;
                const key = (cur && (cur.name || cur.type)) + ':' + e;
                if (!seen.has(key)) {
                  seen.add(key);
                  reports++;
                  const m = cur && cur.material;
                  console.log('[traceUBO] ' + name + ' err=0x' + e.toString(16)
                    + ' obj=' + (cur ? (cur.name || cur.type) : 'unknown')
                    + ' mat=' + (m ? (m.type + (m.userData && m.userData.isNodePanel ? '(panel)' : '')) : 'none')
                    + ' order=' + (cur ? cur.renderOrder : '?')
                    + ' visible=' + (cur ? cur.visible : '?'));
                  // AND THE STACK, when we cannot name the object. `cur` is null means the
                  // draw happened before any tagged object drew -- so no amount of better
                  // tagging will name it, and the only thing that can is three's own call
                  // path. Four frames is enough to see which backend function issued it.
                  if (!cur) {
                    const st = (new Error().stack || '').split('\n').slice(1, 6)
                      .map((l) => l.trim().replace(/^at\s+/, '')).join(' <- ');
                    console.log('[traceUBO]   via ' + st);
                  }
                }
              }
            }
            return r;
          };
        };
        wrap('drawElements');
        wrap('drawArrays');
        if (gl.drawElementsInstanced) wrap('drawElementsInstanced');
        console.log('[traceUBO] on — errors will be reported with the object that caused them');
        return true;
      };

      // window._panelVariant(n) — matt's method: start from what WORKS and add features.
      //
      // MeshNormalNodeMaterial drew on the panel even while a THREE.Line was poisoning the
      // frame, so it is immune to whatever this is. Walking forward from it finds the feature
      // that loses the immunity, which is a far better question than "what is wrong with the
      // broken material" -- the one the last dozen rounds asked, and got wrong every time.
      //
      // Every variant is pre-built and warmed, so the whole ladder can be walked in ONE
      // session: call it with 0..6 and watch when the panel vanishes and the errors start.
      //   0 normal material (known good)   4 texture, opaque
      //   1 flat colour, opaque            5 texture + transparent + alpha
      //   2 + transparent                  6 the real panel material (adds the grade)
      //   3 + opacityNode
      // and, once the ladder showed the break is at 1 -- MeshBasicNodeMaterial itself, with
      // no texture and no transparency -- the same flat colour on other base classes:
      //   7 normal + colorNode   8 lambert   9 phong   10 standard   11 matcap
      // A rung with ZERO errors that still draws is the base the panels should be built on.
      if (!window._panelVariant) window._panelVariant = (n, meshOnly) => {
        const vs = NodeMaterials._panelVariants;
        if (!vs) { console.log('[panelVariant] variants not built'); return null; }
        const i = Math.max(0, Math.min(vs.length - 1, n | 0));
        const mat = vs[i];
        let applied = 0;
        for (const p of HTMLVRPanel._live) {
          if (!p.mesh) continue;
          if (!p.mesh.userData._origVariantMat) p.mesh.userData._origVariantMat = p.mesh.material;
          if (meshOnly && p.mesh !== meshOnly) continue;
          if (mat.userData && mat.userData.setMap && p._texture) mat.userData.setMap(p._texture);
          p.mesh.material = mat;
          // VISIBLE, which _panelMat did and this did not -- so the first ladder run swapped
          // materials on eight hidden panels and measured the rest of the scene instead
          // (drawCalls=47 on every rung, the whole scene, with no panel on screen at all).
          p.mesh.visible = true;
          applied++;
        }
        const errBefore = window.__uboErrCount;
        console.log('[panelVariant] ' + i + ' applied to ' + applied
          + ' panels — watch the panel and the error count'
          + (errBefore === undefined ? ' (run _traceUBO() first to count errors)' : ''));
        return i;
      };
      if (!window._panelVariantRestore) window._panelVariantRestore = () => {
        for (const p of HTMLVRPanel._live) {
          if (p.mesh && p.mesh.userData._origVariantMat) {
            p.mesh.material = p.mesh.userData._origVariantMat;
            p.mesh.userData._origVariantMat = null;
          }
        }
      };
      // And the same walk, automated: step every variant, count errors on each, print a table.
      if (!window._panelLadder) window._panelLadder = async () => {
        if (window.__uboErrCount === undefined) { console.log('[panelLadder] run _traceUBO() first'); return null; }
        const vs = NodeMaterials._panelVariants || [];
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        // AN EMPTY FRAME PLUS ONE PANEL. The first run measured the whole scene -- 47 draw
        // calls and ~120 ambient errors on every rung -- which cannot show a panel-sized
        // signal. Level 1 empties the frame; _minimalForceVisible holds the one panel under
        // test through the per-frame sweep.
        const target = [...HTMLVRPanel._live].find((p) => p.mesh && p._texture) || [...HTMLVRPanel._live][0];
        if (!target || !target.mesh) { console.log('[panelLadder] no panel to test'); return null; }
        const restoreLevel = window._vrMinimalTest;
        window._vrMinimalTest = 1;
        this._minimalForceVisible = target.mesh;
        await sleep(600);
        const idle = await (async () => {
          const b = window.__uboErrCount; await sleep(400); return window.__uboErrCount - b;
        })();
        console.log('[panelLadder] empty frame + no panel material change -> ' + idle
          + ' errors, drawCalls=' + (this._renderer.info && this._renderer.info.render.drawCalls)
          + ' (panel: ' + target.constructor.name + ')');
        const rows = [];
        for (let i = 0; i < vs.length; i++) {
          window._panelVariant(i, target.mesh);
          await sleep(250);
          const before = window.__uboErrCount;
          await sleep(400);
          const errs = window.__uboErrCount - before;
          const dc = this._renderer.info && this._renderer.info.render.drawCalls;
          rows.push({ variant: i, errors: errs, drawCalls: dc });
          console.log('[panelLadder] variant ' + i + ' -> ' + errs + ' errors, drawCalls=' + dc);
        }
        console.log('[panelLadder] ' + JSON.stringify(rows));
        this._minimalForceVisible = null;
        window._vrMinimalTest = restoreLevel || 0;
        window._panelVariantRestore();
        return rows;
      };

      // window._panelMat('normal'|'restore') — the sharpest cut left.
      //
      // With 91 objects hidden and the panel alone in the frame, still nothing. So no other
      // draw is poisoning it: the panel's own draw fails. And the failing set now looks like
      // a material CLASS rather than a texture:
      //   MeshBasicNodeMaterial + canvas map   (panels)      invisible
      //   MeshBasicNodeMaterial, flat magenta, no map        invisible  (_panelSolid)
      //   MeshBasicNodeMaterial + matcap image (matcap mat)  invisible  (_meshMat matcap)
      //   MeshNormalNodeMaterial                             DRAWS
      //   GLTF controller materials                          DRAW
      // The awkward exception is that our PBR material is ALSO a MeshBasicNodeMaterial and it
      // draws -- so if the normal material makes the panel appear, the split is real and the
      // PBR one differs by having a colorNode that replaces the whole basic pipeline.
      if (!window._panelMat) {
        window._panelMat = (which) => {
          const mat = String(which) === 'restore' ? null : NodeMaterials.get(2); // NORMAL
          let n = 0;
          for (const p of HTMLVRPanel._live) {
            if (!p.mesh) continue;
            if (mat) {
              if (!p.mesh.userData._origMat2) p.mesh.userData._origMat2 = p.mesh.material;
              p.mesh.material = mat;
              p.mesh.visible = true;
              n++;
            } else if (p.mesh.userData._origMat2) {
              p.mesh.material = p.mesh.userData._origMat2;
              p.mesh.userData._origMat2 = null;
            }
          }
          console.log('[panelMat] ' + which + ' -> ' + n);
          return n;
        };
      }

      // window._soloPanels() — hide EVERYTHING except the panels. _unsolo() restores.
      //
      // Where the evidence now stands, all of it from inside one session: the sculpt is not
      // the cause (_hideMeshes left the menus gone), and the matcap material -- the very same
      // object that draws correctly in a matcap session -- DISAPPEARS when assigned here. So
      // a pbr session comes up in a state where some materials cannot draw at all, and the
      // panels are in that set while MeshNormalNodeMaterial and the controllers are not.
      //
      // Two possibilities left, and they need opposite fixes:
      //   panels appear alone -> some OTHER draw in the frame poisons them, and the fix is to
      //                          find which (the UBO error is that draw failing).
      //   still nothing       -> the panel pipeline itself cannot be built in this session,
      //                          and warming it on the desktop did not produce the variant XR
      //                          asks for.
      if (!window._soloPanels) {
        window._soloPanels = () => {
          const panelMeshes = new Set();
          for (const p of HTMLVRPanel._live) if (p.mesh) panelMeshes.add(p.mesh);
          this._soloSaved = [];
          this._scene.traverse((o) => {
            if (!o.isMesh && !o.isLine && !o.isPoints && !o.isSprite) return;
            let isPanel = false;
            for (let q = o; q; q = q.parent) if (panelMeshes.has(q)) { isPanel = true; break; }
            if (isPanel) return;
            this._soloSaved.push([o, o.visible]);
            o.visible = false;
          });
          // ...and make one panel visible, so there is something to look for.
          const first = [...panelMeshes][0];
          if (first) first.visible = true;
          console.log('[soloPanels] hid ' + this._soloSaved.length + ' — is a panel there now?');
          return this._soloSaved.length;
        };
        window._unsolo = () => {
          for (const [o, v] of (this._soloSaved || [])) o.visible = v;
          this._soloSaved = [];
          console.log('[soloPanels] restored');
        };
      }

      // window._meshMat('matcap'|'pbr'|'normal') — swap ONLY the sculpt's material, live.
      // window._hideMeshes() / _showMeshes()      — take the sculpt out of the frame entirely.
      //
      // matt's premise, and the only fact that has held up all the way through: it works in
      // matcap and fails in pbr. Everything else has been my theorising. So change exactly
      // that one thing inside ONE session -- same panels, same session, same framebuffer, same
      // controllers -- and watch the menus and the UBO errors.
      //   menus return on 'matcap'  -> the sculpt's MATERIAL takes the frame down, and the
      //                                panels are collateral. The UBO error is the mechanism.
      //   menus stay gone           -> the mesh material is not the variable either, and what
      //                                differs between the two sessions is something else the
      //                                shader id switches on.
      // Every material here was built at startup and warmed, so nothing is constructed inside
      // the session -- which is the one thing this renderer must not do.
      if (!window._meshMat) {
        window._meshMat = (name) => {
          const ids = { pbr: 0, flat: 1, normal: 2, matcap: 5 };
          const id = ids[String(name).toLowerCase()];
          if (id === undefined) { console.log('[meshMat] use pbr|flat|normal|matcap'); return 0; }
          const mat = NodeMaterials.get(id);
          if (!mat) { console.log('[meshMat] no material for ' + name); return 0; }
          let n = 0;
          for (const mesh of (this.getMeshes ? this.getMeshes() : [])) {
            const tm = mesh.getThreeMesh && mesh.getThreeMesh();
            if (tm) { tm.material = mat; n++; }
          }
          console.log('[meshMat] ' + name + ' -> ' + n + ' meshes');
          return n;
        };
        window._hideMeshes = () => {
          let n = 0;
          for (const mesh of (this.getMeshes ? this.getMeshes() : [])) {
            const tm = mesh.getThreeMesh && mesh.getThreeMesh();
            if (tm) { tm.visible = false; n++; }
          }
          console.log('[hideMeshes] hid ' + n + ' — menus back?');
          return n;
        };
        window._showMeshes = () => {
          for (const mesh of (this.getMeshes ? this.getMeshes() : [])) {
            const tm = mesh.getThreeMesh && mesh.getThreeMesh();
            if (tm) tm.visible = true;
          }
        };
      }

      // window._panelSolid() — is the panel invisible because its TEXTURE never arrived?
      //
      // A quad drawn with a texture that failed to upload is fully transparent, which looks
      // exactly like a quad that was never drawn -- and _panelDrawDelta already proved it IS
      // drawn. Swapping in a flat magenta material (pre-built at startup, so nothing is
      // constructed inside the session) tells the two apart:
      //   magenta rectangle appears -> the geometry and the framebuffer are fine, the TEXTURE
      //                                is the problem
      //   still nothing             -> the draw lands somewhere the compositor never shows
      if (!window._panelSolid) {
        window._panelSolid = () => {
          const solid = NodeMaterials._solid;
          if (!solid) { console.log('[panelSolid] no solid material'); return 0; }
          let n = 0;
          for (const p of HTMLVRPanel._live) {
            if (!p.mesh || !p.mesh.visible) continue;
            if (!p.mesh.userData._origMat) p.mesh.userData._origMat = p.mesh.material;
            p.mesh.material = solid;
            n++;
          }
          console.log('[panelSolid] swapped ' + n + ' — look where the menu should be');
          return n;
        };
        window._panelRestoreMat = () => {
          for (const p of HTMLVRPanel._live) {
            if (p.mesh && p.mesh.userData._origMat) {
              p.mesh.material = p.mesh.userData._origMat;
              p.mesh.userData._origMat = null;
            }
          }
          console.log('[panelSolid] restored');
        };
      }

      // window._panelDrawDelta() — how many draw calls does the visible panel ACTUALLY cost?
      //
      // Comparing total draws between two sessions was confounded: a controller model failed
      // to load in one of them (XRControllerModelFactory, 'assetUrl' of null), and a
      // controller model is several meshes and a few thousand triangles -- easily the whole
      // 27-vs-19 gap. So measure the panel against ITSELF inside one session: read the count,
      // hide it, read again, restore. A delta of 0 means the renderer never draws it even
      // though it is visible; a non-zero delta means it IS drawn and the pixels go nowhere.
      if (!window._panelDrawDelta) window._panelDrawDelta = async () => {
        const info = () => this._renderer.info.render.drawCalls;
        const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
        const shown = [];
        for (const p of HTMLVRPanel._live) if (p.mesh && p.mesh.visible) shown.push(p.mesh);
        if (!shown.length) { console.log('[panelDrawDelta] no visible panel'); return null; }
        await frame(); await frame();
        const withPanel = info();
        for (const m of shown) m.visible = false;
        await frame(); await frame();
        const without = info();
        for (const m of shown) m.visible = true;
        await frame();
        const out = { withPanel, without, delta: withPanel - without, panels: shown.length };
        console.log('[panelDrawDelta] ' + JSON.stringify(out));
        return out;
      };

      if (!window._drawInfo) window._drawInfo = () => {
        const r = this._renderer && this._renderer.info && this._renderer.info.render;
        let vis = 0, panels = 0;
        try {
          for (const p of HTMLVRPanel._live) { if (p.mesh) { panels++; if (p.mesh.visible) vis++; } }
        } catch (e) { /* registry is a convenience */ }
        const out = {
          drawCalls: r && r.drawCalls, triangles: r && r.triangles, frame: r && r.frame,
          panelsVisible: vis, panelsTotal: panels,
          xr: !!(this._renderer.xr && this._renderer.xr.isPresenting),
          shader: this._meshes && this._meshes[0] && this._meshes[0].getShaderType
            ? this._meshes[0].getShaderType() : null,
        };
        console.log('[drawInfo] ' + JSON.stringify(out));
        return out;
      };
      // The rig half of the warm, callable on its own -- this is what runs at session start, and
      // being able to fire it from the console is what makes it an A/B rather than a reload.

      if (this._isNodeRenderer && !window._warmNow) window._warmNow = () => {
        const pm = [];
        for (const p of HTMLVRPanel._live) if (p.mesh && p.mesh.material) pm.push(p.mesh.material);
        return NodeMaterials.warm(this._renderer, this._camera.getThreeCamera(), pm);
      };
      // WHAT THE SCULPT IS ACTUALLY DRAWN WITH. A material that is never fed and a material
      // that is never used look identical from the outside (a black mesh), so the probe has
      // to answer both halves.
      if (!window._meshMatProbe) window._meshMatProbe = () => {
        const r = [];
        (this.getMeshes ? this.getMeshes() : []).forEach((mesh) => {
          const tm = mesh.getThreeMesh && mesh.getThreeMesh();
          const mt = tm && tm.material;
          r.push({
            shaderId: mesh.getShaderType ? mesh.getShaderType() : null,
            matType: mt && mt.type,
            isNode: !!(mt && mt.isNodeMaterial),
            hasColorNode: !!(mt && mt.colorNode),
            visible: tm && tm.visible,
            hasColorAttr: !!(tm && tm.geometry && tm.geometry.getAttribute('color')),
            hasMaterialAttr: !!(tm && tm.geometry && tm.geometry.getAttribute('aMaterial')),
          });
        });
        console.log('[meshMatProbe] ' + JSON.stringify(r));
        return r;
      };

      
      // THE FLAT CAMERA, for both renderers. WebGPURenderer substitutes xr.getCamera() itself
      // exactly as WebGLRenderer does -- the earlier note here claimed otherwise and was
      // wrong; what it had actually found was this renderer running with xr.enabled unset.
      // Substituting by hand is worse than unnecessary: updateCamera() sits behind the same
      // flag, so a hand-passed ArrayCamera arrives without the frame's view matrices.
      const _renderCam = this._camera.getThreeCamera();

      let currentTarget = null;
      if (!isVR) {
        // Force Three.js to forget its cached WebGL state. This prevents 'uniformMatrix4fv: location is not from the associated program'
        // errors caused by legacy raw WebGL passes binding their own shaders just before Three.js renders.
        // CRITICAL FIX: We must save and restore the current Render Target, otherwise resetState() unbinds the WebXR baseLayer!
        currentTarget = this._renderer.getRenderTarget();
        // OPTIONAL-CHAINED FOR THE WEBGPU PATH. resetState() is a WebGLRenderer method and
        // WebGPURenderer has no equivalent: it is how three is told to forget its cached GL
        // state after the legacy raw-GL passes bind their own shaders behind its back. Under
        // the node renderer those passes are what the port is removing, so a no-op here is the
        // right shape -- and if state corruption does appear on that path, it is evidence
        // about the raw-GL layer rather than a bug in this line.
        this._renderer.resetState?.();
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
      // ...AND THE MASTER DECORATION SWITCH, which hides the plane without clearing the user's own
      // Ground Plane setting — turning decorations back on restores it. See
      // Skeleton.decorationsHidden.
      const _decor = !Skeleton.decorationsHidden();
      if (this._groundGrid) this._groundGrid.visible = !!this._showGrid && _decor;
      // The ghost follows the grid: one toggle, two passes.
      if (this._groundGridGhost) this._groundGridGhost.visible = !!this._showGrid && _decor;

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

      // Skeleton visuals are rebuilt from the joints' live model-space matrices rather
      // than parented to them, so posing, gizmo drags, undo and animation playback all
      // keep the bones correct without any of those paths knowing bones exist.
      // SECTIONED FOR xrPerf(). `draw` used to cover this whole block, which made it useless
      // for the one question worth asking in a headset -- is the frame going on drawing, or on
      // CPU work that has nothing to do with drawing. On a 40-joint rig the answer was the
      // latter, and `draw` could not say so.
      this._mark('rig-visuals');
      Skeleton.updateVisuals(this);

      // The motion trail, when it is switched on. It fingerprints the keys and the pins and
      // rebuilds only when one of them changes — a rebuild is a full evaluation per sample, so
      // it must not be a per-frame cost. Guarded: a fault in an overlay must never take the
      // render loop down with it.
      try {
        MotionTrail.update(this);
        // Alongside the trail and for the same reason: it reads the live rig every frame, and
        // the rig moves. Cheap while the flag is off — it does nothing but read one boolean.
        SkinPreview.update(this);
      } catch (e) {
        console.error('Motion trail failed:', e);
      }

      // Keeps the cast shadow's light fitted to the model and new meshes casting. Reads one
      // boolean and returns while shadows are off.
      if (this._sceneShadow) this._sceneShadow.update();

      // Skinning: last in the deformation stack, and a no-op when no joint has moved
      // since the previous frame (see Skinning.apply's pose stamp).
      Skinning.update(this);

      // Panel visibility tracing, when it is switched on in Settings. Wraps the panels' own
      // `visible` the first time it sees them, so a write from anywhere is reported with the
      // line that did it; the per-frame half catches the cases where the panel is not hidden at
      // all but detached or under something invisible. Costs three property reads when off.
      PanelTrace.tick(this);

      // The desktop transform gizmo (Gizmo.js) must never render in VR. Its visible
      // flag is sticky from desktop (set in the desktop-only postRender), and no VR
      // hook reliably hides it, so it lingers as a ghost gizmo overlapping the VR one.
      // Force it hidden every VR frame, right before the render. (TransformVR's own
      // GizmoVR group is separate and is shown when that tool is active.)
      if (isVR && this._sculptManager) {
        const _gT = this._sculptManager.getTool?.(Enums.Tools.TRANSFORM)?._gizmo?._group;
        if (_gT && _gT.visible) _gT.visible = false;
      }

      // THE DESKTOP TRANSFORM GIZMO IS DRIVEN FROM HERE ON THE NODE PATH (#84).
      //
      // Transform.postRender() is where it used to be updated, and postRender is part of the
      // legacy raw-GL tail below -- which does not run on this renderer. So nothing advanced
      // the gizmo's matrices: measured, zero calls per frame, every handle left at the scale
      // it was built with. That is the whole of "the desktop gizmo is a tiny speck at the
      // centre of the mesh", and it was never a sizing bug.
      if (!isVR && this._sculptManager) {
        const _dt = this._sculptManager.getCurrentTool?.();
        const _dg = _dt && _dt._gizmo;
        // Unconditional: the gizmo decides its own visibility inside update(), and gating the
        // call on it means that once hidden it can never run again to un-hide itself.
        if (_dg && _dg._desktop && _dg._group) _dg.update(this.getCamera());
      }

      // THE RAW-ShaderMaterial SWEEP, HERE AND NOT EARLIER.
      //
      // It used to run near the top of this block, which is before MotionTrail.update() and
      // SkinPreview.update() -- and those CREATE objects: LineSegments2 on three's
      // LineMaterial, which is a ShaderMaterial subclass this renderer cannot draw. Anything
      // they added during the frame was therefore never swept, and went straight into the
      // render as "THREE.NodeMaterial: Material LineMaterial is not compatible".
      //
      // Immediately before the draw is the only placement that can see everything the frame
      // built.
      this._mark('mat-sweep');
      if (this._isNodeRenderer && this._scene) {
        this._scene.traverse((o) => {
          const m = o.material;
          if (!m || Array.isArray(m)) {
            if (Array.isArray(m) && m.some(x => x && x.isShaderMaterial && !x.isNodeMaterial)) o.visible = false;
            return;
          }
          // A HIDDEN OBJECT DOES NOT NEED A NODE MATERIAL, because it never draws.
          //
          // Converting one costs a node graph and, the first time it IS drawn, a pipeline -- and
          // the rig creates six pin meshes per joint whether or not that joint is pinned. On a
          // six-joint rig that is 36 of the 83 converted materials, all of them invisible; on a
          // full-body rig it is most of what the first draw pays for.
          //
          // Safe because this sweep runs every frame and runs AFTER Skeleton.updateVisuals, so it
          // always sees the current visibility: an object that becomes visible is converted on
          // the same frame it turns on, before the render. That ordering is the whole reason this
          // is a deferral and not a hole -- a stock MeshBasicMaterial reaching the renderer would
          // become MeshBasicNodeMaterial, which is undrawable in XR and poisons the frame.
          if (o.visible === false && !o.userData._stockMat) return;
          // ALREADY CONVERTED: push its `.color`/`.opacity` into the uniforms that actually
          // draw it. Writes to those properties are how the rest of the app changes a colour,
          // and on the stand-in they reach nothing on their own. See NodeMaterials.syncConverted.
          if (m.userData && m.userData.sync) { NodeMaterials.syncConverted(m); return; }
          // CONVERTED, NOT HIDDEN. A stock MeshBasicMaterial becomes a MeshBasicNodeMaterial,
          // the one class this backend cannot draw in a session, and one of them anywhere in
          // the scene poisons the frame. Converting here catches every object, including the
          // ones nobody has thought to port.
          if ((m.isMeshBasicMaterial || m.isMeshStandardMaterial) && !m.isNodeMaterial) {
            const conv = NodeMaterials.convertBasic(m);
            if (conv) {
              if (window._boneTrace) this._boneTraceConv(o, m, conv);
              o.userData._stockMat = m; o.material = conv; return;
            }
          }
          // Anything still on a raw ShaderMaterial cannot be drawn at all, so it is hidden
          // rather than allowed to throw once per object per frame.
          if (m.isShaderMaterial && !m.isNodeMaterial) o.visible = false;
        });
      }

      // THE "COMPILING SHADERS" PLATE, placed before the draw that might show it. Only on the
      // node renderer: the legacy path compiles on a program cache keyed by shader structure and
      // does not stall like this. See gui/ShaderBusy.js for what it can and cannot cover.
      if (this._isNodeRenderer) {
        // THE STARTUP WARM, kicked off from the frame loop rather than from init: it needs the
        // VR panels to exist, and they are built asynchronously a second or so in. One frame of
        // the app having drawn itself is the simplest signal that everything is up.
        // AFTER THE LIGHT POOL, not just after the panels. The pipeline key is
        // _nodes.getCacheKey(scene, lightsNode) -- so anything warmed before the pool exists is
        // keyed to a scene with different lights and gets compiled again the moment the pool
        // lands. That is the x2 on every rig batch in matt's report: the same material, the same
        // version, the same camera, two pipelines, one on each side of `[lights] pool built`.
        // THE COVER GOES UP ON THE FIRST FRAME, before anything has been shown -- matt would
        // rather wait on a loading screen than watch the scene stutter through its own warm-up.
        // Only outside a session: in one, the compositor owns what the user sees.
        if (!this._renderer.xr.isPresenting && getOptionsURL().warm !== false) BootOverlay.show();
        // NO WARM PASS. See warmEverything, kept only as the note that explains its own removal.
        // The cover is lifted once the app has drawn a few frames and nothing new has been built
        // for a while -- which is the same condition as before, minus the warm it used to wait
        // for. Objects go on appearing through the boot (the env's PMREM, the panels' first
        // paint) and each compiles when first drawn, so a count is a manifest nobody maintains.
        if (this._framesDrawn === 3) BootOverlay.setTotal(this._warmableObjects().length);
        if (this._framesDrawn > 3) {
          BootOverlay.setProgress(this._renderer._pipelines
            ? this._renderer._pipelines.caches.size : 0);
        }
        BootOverlay.tick(this._renderer, this._framesDrawn > 3);
        this._framesDrawn = (this._framesDrawn || 0) + 1;
        // NOT IN A SESSION. matt: "turn off the popups in immersive that say 'compiling
        // material', its annoying and i think has served its purpose."
        //
        // It did serve it: the plate is how we learned the notices were firing on COUNT rather
        // than cost -- 84 builds at a 3.3ms median, each buying a 700ms notice -- which led to
        // the 40ms hitch threshold, and from there to the empty-rig fix that took entry from
        // 30-odd pipelines to 2. With entry compiling almost nothing there is little left to
        // explain, and a head-locked plate in a headset is worse than the pause it describes.
        //
        // Kept on the desktop, where it costs a sprite nobody is wearing and still answers
        // "why did that stutter". BootOverlay covers the boot case separately.
        if (!this._renderer.xr.isPresenting) {
          ShaderBusy.attach(this._scene);
          ShaderBusy.tick(this._renderer, _renderCam);
        }
        this._tickSteadyState();
      }

      // Three.js clears depth on its own, so we render over the top
      this._mark('gl-render');
      if (this._directPipeline) this._directPipeline.render(this._scene, _renderCam);
      else this._renderer.render(this._scene, _renderCam);
      this._mark(null);
      if (this._btAt) {
        this._boneTraceFrame(performance.now() - this._btAt);
        if (this._xrPerf) this._xrPerf.frame = null;
      }

      // THE LEGACY RAW-GL TAIL DOES NOT RUN ON THE NODE PATH.
      //
      // Everything below reaches past three and drives the context directly -- unbinding the
      // VAO, rebinding the framebuffer, toggling DEPTH_TEST, then the sculpt manager's own
      // raw passes for the gizmo and cursors. WebGLRenderer coped because resetState() told
      // it its state cache was stale afterwards. WebGPURenderer has no resetState, so the
      // optional chaining below silently skips it -- and its backend CACHES state
      // (setDepthTest only calls gl.enable when its cached value changes), so after a raw
      // pass leaves DEPTH_TEST off, three believes it is still on and never re-enables it.
      //
      // The result is a frame drawn with no depth test at all: measured, gl.DEPTH_TEST came
      // back false with a 24-bit depth buffer present and depthMask true, and two opaque
      // meshes then resolved by submission order. matt: "2 objects aren't proper depth tested
      // against each other" -- the cube is 28 units inside a 34-unit sphere and was drawn in
      // front of it.
      //
      // Known cost: the desktop gizmo and legacy cursor overlays are raw-GL passes and will
      // not draw under ?renderer=webgpu until they are ported. A missing gizmo is visible and
      // fixable; a silently broken depth buffer is neither.
      if (!isVR && !this._isNodeRenderer) {
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
        this._renderer.resetState?.();   // see the note above — absent on WebGPURenderer
        this._renderer.setRenderTarget(currentTargetPost);

        // Draw sculpting gizmo stuffs over Three.js render
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.enable(gl.DEPTH_TEST);
        if (this._sculptManager) this._sculptManager.postRender();
      }

      // THE OTHER HALF OF THE ABOVE. The node renderer skips the raw-GL postRender wholesale,
      // which took the brush radius circle with it -- it is three.js geometry and never needed
      // GL at all. See SculptManager.postRenderNode.
      if (!isVR && this._isNodeRenderer && this._sculptManager) {
        this._sculptManager.postRenderNode();
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
          // NOT UNDER THE NODE RENDERER. This is a SECOND full renderer.render() inside the
          // XR frame: it flips xr.enabled off, draws the scene mono to the same canvas, and
          // restores the flag in a finally. WebGLRenderer tolerates that -- the canvas and the
          // XR baseLayer are different framebuffers and it rebinds on the next frame.
          // WebGPURenderer does not: it comes back with the canvas target still bound at the
          // wrong size, which is what "GL_INVALID_FRAMEBUFFER_OPERATION: Framebuffer is
          // incomplete: Attachments are not all the same size" is reporting, once per frame.
          // It also doubles the scene cost inside an XR frame, which is most of "very slow".
          // Porting the spectator view is its own job; until then the flagged path goes
          // without it rather than corrupting every frame it draws.
          if (!this._isNodeRenderer) this._renderSpectatorCanvas();
          // ─────────────────────────────────────────────────────────────────────

          // --- CRITICAL ISOLATION FOR WEBXR ---
          // Do NOT execute ANY further legacy WebGL commands (like postRender, or depth disabling)
          // The XR Compositor requires the baseLayer framebuffer to remain bound and pristine.
          return;
      }
    }

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
    if (this._xfSyncTick % 4 === 0) {
      this._syncOutlinerTransformFields();
      // Same tick, same reason: the selection changes from more places than any one hook sees,
      // and this only does work when the set of ids actually moved.
      this._updateMeshSelectionBoxes();
    }
  }

  // ASYNC because WebGPURenderer demands it: its render() THROWS if the backend has not been
  // initialised, so there is no fire-and-forget version of this.
  async initWebGL() {
    var canvas = document.getElementById('canvas');

    // ?renderer=webgpu — THE MIGRATION FLAG (roadmap #2). The port is all-or-nothing at the
    // swap, because WebGPURenderer cannot render a THREE.ShaderMaterial and every one of our
    // shaders is one. A flag lets the two renderers live side by side so master stays
    // shippable and the new path can be tested on device shader by shader, instead of the app
    // being broken for the length of the port.
    //
    // forceWebGL is not a choice: in three 0.183.2 the WebGPU backend THROWS on entering XR
    // ("XR is currently not supported with a WebGPU backend"). The spike measured this path at
    // 72fps to ~1M triangles on a GalaxyXR — see spike/tsl/FINDINGS.md.
    // DYNAMICALLY IMPORTED, and that is not an optimisation. `three/webgpu` is a SEPARATE
    // BUILD carrying its own copy of the core -- it exports Mesh, Scene and ShaderMaterial as
    // well as WebGPURenderer, but NOT WebGLRenderer -- so there is no single copy of three
    // that can provide both renderers. A flagged parallel path therefore means two copies of
    // three in memory for the duration of the migration.
    //
    // Survivable, because three duck-types on `.isMesh` / `.isBufferGeometry` rather than
    // instanceof, so objects built by one copy are recognised by the other. And loading it
    // lazily means the default path never pays for it: no second copy, no bundle cost, nothing
    // changed for anyone not passing the flag.
    const useWebGPU = getOptionsURL().renderer === 'webgpu';
    if (useWebGPU) {
      const [WGPU, TSL] = await Promise.all([import('three/webgpu'), import('three/tsl')]);
      this._renderer = new WGPU.WebGPURenderer({ canvas, antialias: false, forceWebGL: true });
      // VISION PRO RENDERS THROUGH DirectRenderPipeline, EVERYTHING ELSE DOES NOT.
      //
      // three renders the scene to an intermediate target and blits it to the XR layer whenever
      // the output needs tone mapping OR a colour-space conversion -- `useToneMapping ||
      // useColorSpace`, and an sRGB output against a linear working space trips the second on
      // its own, so turning tone mapping off changes nothing. visionOS mishandles that blit:
      // stereo comes out warped, each object visible in only one eye depending on where it sits.
      // Reproduced with EIGHTY LINES OF RAW WebGL2 and no library at all -- tokeru.com/xrblit --
      // so it is a platform bug, not three's and not ours.
      //
      // DirectRenderPipeline (r186+) applies the output node INSIDE the material and draws
      // straight into the layer, so there is no blit to mishandle and colour management still
      // works. Verified on a Vision Pro and on a GalaxyXR.
      //
      // GATED, AND THE GATE IS LOAD-BEARING -- NOT A PRECAUTION.
      //
      // MEASURED 2026-09-23: forcing this on with ?direct=1 BREAKS THE GALAXYXR OUTRIGHT. Black
      // in VR, empty in AR, no controllers and no default mesh. ?direct=0 restores it. So this
      // is not "safe everywhere, enabled where needed" -- it is actively fatal on the device
      // that works today, and must never be the default.
      //
      // AND THE MINIMAL HARNESS DOES NOT PREDICT THAT. xrmin186.html?direct=1 -- seven opaque
      // cubes, one material -- renders correctly on the same GalaxyXR. The app does not. Which
      // is three's caveat coming true: DirectRenderPipeline "changes blending and is not
      // compatible with materials that sample the framebuffer", and in this app every mesh and
      // every VR panel is transparent with renderOrder as the only layering lever. A harness
      // that passes proves the pipeline runs, not that a real scene survives it.
      //
      // KEYED ON CAPABILITY AND BROWSER, NOT A MODEL STRING: visionOS Safari is the only WebKit
      // that exposes navigator.xr at all -- desktop Safari has none -- so this is specific
      // without naming a device that will be renamed.
      //
      // ?direct=1 / ?direct=0 forced it either way while that was being established. The
      // question is answered -- it is fatal on the GalaxyXR and required on visionOS -- so the
      // switches are gone and the capability test is the whole of the decision.
      this._directPipeline = null;
      {
        const ua = navigator.userAgent;
        const isVisionOS = /Macintosh/.test(ua) && !/Chrome|Chromium/i.test(ua) && ('xr' in navigator);
        if (isVisionOS && typeof WGPU.DirectRenderPipeline === 'function') {
          this._directPipeline = new WGPU.DirectRenderPipeline(this._renderer);
        }
        console.log('[renderer] DirectRenderPipeline '
          + (this._directPipeline ? 'ON' : 'off') + ' (visionOS=' + isVisionOS + ')');
      }
      await this._renderer.init();
      // TWO three 0.183.2 BUGS THAT ONLY BITE UNDER AN ArrayCamera, i.e. in a session: uniform
      // block binding points that collide between render objects, and a `cameraPosition` that
      // is always zero and throws while building. Between them they are the whole of "a lit
      // material does not draw in XR". Read ThreeXRPatches.js; reproduce with xrarray.html.
      // MUST be before any material compiles -- binding points are baked in at link time.
      applyXRBackendPatches(this._renderer, WGPU, TSL);
      // THE SAME SETUP THE WebGLRenderer GETS, because this renderer is not self-configuring
      // and the omission is silent. `xr.enabled` in particular is not a convenience flag: it
      // is what gates the per-eye path, in three.webgpu.js:
      //     if ( xr.enabled === true && xr.isPresenting === true ) {
      //       if ( xr.cameraAutoUpdate === true ) xr.updateCamera( camera );
      //       camera = xr.getCamera();
      //     }
      // With it false a session still starts, setSession still resolves and frames still
      // present -- so everything looks alive -- but render() takes the ordinary mono path and
      // paints ONE view across the whole XR framebuffer. matt: "as if a single view is just
      // being spread across the 2 displays". Handing render() the ArrayCamera by hand does not
      // rescue it either, because updateCamera() is behind the same gate, so the sub-cameras
      // are never given the frame's view matrices: "each camera sharing a view in the centre
      // of their displays". Two symptoms, one missing line.
      this._renderer.setPixelRatio(window.devicePixelRatio);
      this._renderer.setSize(window.innerWidth, window.innerHeight);
      this._renderer.xr.enabled = true;
      // ?xrlayers=0 -- PUT THE SESSION BACK ON THE CLASSIC XRWebGLLayer FRAMEBUFFER.
      //
      // With XRProjectionLayer (three's default when the browser supports it) the XR render
      // target's colour/depth are EXTERNAL textures handed over by the compositor each frame,
      // and `_setFramebuffer` re-attaches them with framebufferTexture2D. That is fine as long
      // as nothing else ever binds a different target mid-frame -- but a shadow map does
      // exactly that, and restoring the XR target afterwards re-attaches images whose handles
      // are no longer valid. matt's session, with one shadow pulse and no shadow drawn:
      //     GL_INVALID_OPERATION: invalid mailbox name
      //     GL_INVALID_OPERATION: texture is not a shared image
      //     GL_INVALID_OPERATION: glFramebufferTexture2D: No Texture is bound to the target
      // "mailbox" and "shared image" are Chrome's names for exactly those compositor images.
      //
      // On the XRWebGLLayer path `_hasExternalTextures` stays false and restoring the XR target
      // is a single bindFramebuffer of a framebuffer we own, which a shadow pass cannot spoil.
      // _supportsLayers is private and computed once, but it is an ordinary property.
      // The trade is multiview and layer-based foveation; neither is in use on this path.
      if (/[?&]xrlayers=0/.test(window.location.search)) {
        this._renderer.xr._supportsLayers = false;
        console.log('[xr] XRProjectionLayer disabled — classic XRWebGLLayer framebuffer');
      }
      const _fbsGpu = Number.isFinite(window._fbScale)
        ? window._fbScale
        : (Number.isFinite(getOptionsURL()['fbscale']) ? getOptionsURL()['fbscale'] : 1.0);
      this._renderer.xr.setFramebufferScaleFactor(Math.max(0.3, Math.min(2.0, _fbsGpu)));
      this._renderer.toneMapping = WGPU.LinearToneMapping;
      this._renderer.toneMappingExposure = 1.0;
      // SHADOWS. Real lights are mirrored onto our light entities (see _syncThreeLights), so
      // there is finally something that owns a shadow map. Soft by default: PCF is the cheap
      // one, and a hard edge on a sculpt reads as an artefact rather than a shadow.
      this._renderer.shadowMap.enabled = true;
      // PCF, NOT PCF_SOFT, BECAUSE SOFT IGNORES THE RADIUS.
      //
      // Both are in three's node path and only one of them reads shadow.radius:
      //   PCFShadowFilter      radiusScaled = radius * texelSize.x, 5-tap Vogel disk
      //   PCFSoftShadowFilter  a fixed texel kernel with bilinear weights, radius unused
      // So with PCF_SOFT the Softness slider was wired to a value nothing read. matt: "blur
      // doesn't work at all". SceneShadow.js already picks PCFShadowMap for exactly this
      // reason and its harness guards the choice with a `pcfsoft` injection; this path simply
      // disagreed with it.
      this._renderer.shadowMap.type = WGPU.PCFShadowMap;
      // The shadow-update mode is read here as well as at the session boundary, so ?xrshadows=
      // means the same thing on the desktop as it does in a session.
      const _shq0 = /[?&]xrshadows=(\w+)/.exec(window.location.search);
      this._xrShadowAlways = !!(_shq0 && _shq0[1] === 'always');
      const _tapq = /[?&]shadowtaps=(\d+)/.exec(window.location.search);
      this._shadowTaps = _tapq ? parseInt(_tapq[1], 10) : 16;
      this._TSL_GPU = TSL;     // the custom shadow filter is built from TSL, not from WGPU
      this._THREE_GPU = WGPU;   // node materials live here, not on the core THREE
      this._isNodeRenderer = true;
      // ONE LINE THAT ANSWERS "why are there no shadows / why is the lighting binary".
      // Console, not a screen overlay, because that is what can be read off the headset over
      // remote debugging. window.xrLightReport() -- safe to call any time, in or out of VR.
      // A TOGGLE, because the boundary read of window._xrShadows depends on setting the flag
      // before you press Enter VR, and getting that wrong looks identical to the bug it was
      // meant to test. This re-applies castShadow across the pool and rebuilds, so shadows can
      // be turned on and off DURING a session. It is a debug instrument: the rebuild is the
      // very recompile the fixed pool exists to avoid, so expect a hitch and do not ship a UI
      // control onto it.
      window.xrSetShadows = (on) => {
        window._xrShadows = !!on;
        const pool = this._lightPool;
        if (!pool) { console.warn('[xrSetShadows] no light pool yet'); return false; }
        for (const t of [0, 1, 2]) for (const L of pool[t]) L.castShadow = !!on;
        this._renderer.shadowMap.enabled = !!on;
        let n = 0;
        this._scene.traverse((o) => {
          const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
          for (const m of mats) if (m && m.isMaterial) { m.needsUpdate = true; n++; }
        });
        for (const m of (NodeMaterials.all ? NodeMaterials.all() : [])) if (m) { m.needsUpdate = true; n++; }
        console.log('[xrSetShadows] ' + (on ? 'on' : 'off') + ', rebuilt ' + n + ' materials');
        return true;
      };
      // Pulse every in-use shadow map once. In ?xrshadows=once mode this is the only thing
      // that renders them, so it is both the refresh button and the diagnostic trigger.
      // WHICH GL CALL FAILS, AND WHO MADE IT. The mailbox / shared-image errors arrive with no
      // stack, so they say nothing about which code path produced them. These five entry points
      // are rare enough to wrap without costing a frame, and each one drains the error queue
      // first so the error it reports is genuinely its own.
      // window.xrGlTrace() on, window.xrGlTrace(false) off.
      window.xrGlTrace = (on = true) => {
        const gl = this._renderer.backend && this._renderer.backend.gl;
        if (!gl) { console.warn('[xrGlTrace] no gl'); return false; }
        gl._xrTraceOrig = gl._xrTraceOrig || {};
        const names = ['framebufferTexture2D', 'framebufferTextureLayer',
          'framebufferRenderbuffer', 'bindFramebuffer', 'checkFramebufferStatus'];
        for (const n of names) {
          if (!gl[n]) continue;
          if (on) {
            gl._xrTraceOrig[n] = gl._xrTraceOrig[n] || gl[n];
            const orig = gl._xrTraceOrig[n];
            gl[n] = function () {
              while (gl.getError() !== gl.NO_ERROR) { /* drain: report only our own */ }
              const out = orig.apply(gl, arguments);
              const err = gl.getError();
              if (err !== gl.NO_ERROR) {
                console.warn('[xrGlTrace] ' + n + ' -> 0x' + err.toString(16),
                  Array.prototype.slice.call(arguments), new Error('call site').stack);
              }
              return out;
            };
          } else if (gl._xrTraceOrig[n]) {
            gl[n] = gl._xrTraceOrig[n];
          }
        }
        console.log('[xrGlTrace] ' + (on ? 'ON — expect a slower frame' : 'off'));
        return true;
      };
      // WHAT IS ACTUALLY IN THE SHADOW MAP. This is the measurement that cracked the desktop
      // half: turn the depth comparison OFF, sample the cube as an ordinary samplerCube onto a
      // small RGBA8 target and read it back. A face of all 255 is cleared-far, i.e. nothing was
      // rendered into it -- or rendered so close to the far plane that 8 bits cannot separate
      // it, which is what a bad near/far ratio looks like. A face with a spread of values has
      // a real occluder in it.
      //
      // Raw GL, so three's state cache is briefly out of step; a frame may flicker. Read-only
      // otherwise, and the texture parameters are put back.
      window.xrShadowProbe = () => {
        const gl = this._renderer.backend && this._renderer.backend.gl;
        const pool = this._lightPool;
        if (!gl || !pool) { console.warn('[xrShadowProbe] no gl or no pool'); return null; }
        let L = null;
        for (const t of [0, 1, 2]) for (const li of pool[t]) if (li.intensity > 0 && li.castShadow) L = L || li;
        if (!L || !L.shadow || !L.shadow.map) { console.warn('[xrShadowProbe] no casting light with a map'); return null; }
        const texData = this._renderer.backend.get(L.shadow.map.depthTexture);
        const texGPU = texData && texData.textureGPU;
        if (!texGPU) { console.warn('[xrShadowProbe] no GPU texture'); return null; }
        const isCube = !!L.shadow.map.depthTexture.isCubeTexture;

        const prev = {
          fb: gl.getParameter(gl.FRAMEBUFFER_BINDING), prog: gl.getParameter(gl.CURRENT_PROGRAM),
          vao: gl.getParameter(gl.VERTEX_ARRAY_BINDING), active: gl.getParameter(gl.ACTIVE_TEXTURE),
          vp: gl.getParameter(gl.VIEWPORT), depthTest: gl.getParameter(gl.DEPTH_TEST)
        };
        const VS = '#version 300 es\nvoid main(){ vec2 p = vec2(float((gl_VertexID<<1)&2), float(gl_VertexID&2)); gl_Position = vec4(p*2.0-1.0,0.0,1.0); }';
        const FS = '#version 300 es\nprecision highp float; precision highp samplerCube; precision highp sampler2D;\n'
          + 'uniform samplerCube uCube; uniform sampler2D uTex2D; uniform vec2 uRes; uniform int uFace; uniform int uIsCube;\n'
          + 'out vec4 o;\nvoid main(){ vec2 t=(gl_FragCoord.xy/uRes)*2.0-1.0; float v;\n'
          + ' if(uIsCube==1){ vec3 d;\n'
          + '  if(uFace==0) d=vec3( 1.0,-t.y,-t.x); else if(uFace==1) d=vec3(-1.0,-t.y, t.x);\n'
          + '  else if(uFace==2) d=vec3( t.x, 1.0, t.y); else if(uFace==3) d=vec3( t.x,-1.0,-t.y);\n'
          + '  else if(uFace==4) d=vec3( t.x,-t.y, 1.0); else d=vec3(-t.x,-t.y,-1.0);\n'
          + '  v=texture(uCube,d).r; } else { v=texture(uTex2D,(t*0.5)+0.5).r; }\n'
          + ' o=vec4(v,v,v,1.0); }';
        const mk = (type, src) => {
          const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh);
          if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
          return sh;
        };
        let out = null;
        try {
          const prog = gl.createProgram();
          gl.attachShader(prog, mk(gl.VERTEX_SHADER, VS));
          gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, FS));
          gl.linkProgram(prog);
          if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
          const N = 64;
          const colTex = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, colTex);
          gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, N, N);
          const fbo = gl.createFramebuffer();
          gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colTex, 0);
          const target = isCube ? gl.TEXTURE_CUBE_MAP : gl.TEXTURE_2D;
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(target, texGPU);
          gl.texParameteri(target, gl.TEXTURE_COMPARE_MODE, gl.NONE);
          gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
          gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
          gl.useProgram(prog); gl.bindVertexArray(null); gl.disable(gl.DEPTH_TEST);
          gl.viewport(0, 0, N, N);
          // BOTH samplers must be pointed somewhere, and NOT at the same unit: a samplerCube
          // and a sampler2D bound to one texture unit is invalid and the draw is silently
          // dropped, which reads back as a cleared target and looks exactly like an empty
          // shadow map. That cost one false result.
          gl.uniform1i(gl.getUniformLocation(prog, 'uCube'), isCube ? 0 : 1);
          gl.uniform1i(gl.getUniformLocation(prog, 'uTex2D'), isCube ? 1 : 0);
          gl.uniform1i(gl.getUniformLocation(prog, 'uIsCube'), isCube ? 1 : 0);
          gl.uniform2f(gl.getUniformLocation(prog, 'uRes'), N, N);
          const px = new Uint8Array(N * N * 4);
          const faces = [];
          for (let f = 0; f < (isCube ? 6 : 1); f++) {
            gl.uniform1i(gl.getUniformLocation(prog, 'uFace'), f);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            gl.readPixels(0, 0, N, N, gl.RGBA, gl.UNSIGNED_BYTE, px);
            let mn = 255, mx = 0, sum = 0, below = 0;
            for (let i = 0; i < N * N; i++) {
              const v = px[i * 4];
              if (v < mn) mn = v; if (v > mx) mx = v; sum += v; if (v < 250) below++;
            }
            faces.push({ face: f, min: mn, max: mx, mean: +(sum / (N * N)).toFixed(1), pxBelow250: below });
          }
          gl.texParameteri(target, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
          gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.deleteFramebuffer(fbo); gl.deleteTexture(colTex); gl.deleteProgram(prog);
          out = {
            lightType: L.type, isCube,
            shadowCamNear: +L.shadow.camera.near.toFixed(5),
            shadowCamFar: +L.shadow.camera.far.toFixed(4),
            ratio: +(L.shadow.camera.far / L.shadow.camera.near).toFixed(1),
            lightDistance: L.distance,
            nearFraction: +(L.shadow.camera.near / L.shadow.camera.far).toFixed(4),
            frustumValid: L.shadow.camera.near < L.shadow.camera.far,
            faces
          };
        } catch (e) {
          console.warn('[xrShadowProbe] failed: ' + e.message);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, prev.fb);
        gl.useProgram(prev.prog); gl.bindVertexArray(prev.vao);
        gl.activeTexture(prev.active);
        gl.viewport(prev.vp[0], prev.vp[1], prev.vp[2], prev.vp[3]);
        if (prev.depthTest) gl.enable(gl.DEPTH_TEST);
        this._renderer.backend.state && this._renderer.backend.state.reset && this._renderer.backend.state.reset();
        console.log('[xrShadowProbe]', JSON.stringify(out));
        return out;
      };
      window.xrShadowRefresh = () => {
        const pool = this._lightPool;
        if (!pool) return 0;
        let n = 0;
        for (const t of [0, 1, 2]) {
          for (const L of pool[t]) {
            if (L.castShadow && L.intensity > 0 && L.shadow) { L.shadow.needsUpdate = true; n++; }
          }
        }
        console.log('[xrShadowRefresh] pulsed ' + n + ' shadow map(s)');
        return n;
      };
      window.xrLightReport = () => {
        const r = this._renderer;
        const pool = this._lightPool;
        const rows = [];
        for (const type of [0, 1, 2]) {
          for (const L of (pool ? pool[type] : [])) {
            if (!L.intensity && !L.castShadow) continue;
            rows.push({ type: L.type, intensity: +L.intensity.toFixed(3), castShadow: L.castShadow,
              shadowIntensity: L.shadow ? L.shadow.intensity : null,
              distance: L.distance, decay: L.decay });
          }
        }
        const out = {
          presenting: !!(r.xr && r.xr.isPresenting),
          shadowMapEnabled: r.shadowMap.enabled,
          toneMappingExposure: r.toneMappingExposure,
          // THE ENVIRONMENT LIVES ON THE PBR MATERIAL, NOT ON THE SCENE (commit 04f1632a), so
          // reading scene.environment reported "false" while the sculpt was plainly lit by an
          // IBL -- which sent this hunt off in the wrong direction more than once.
          environment: !!this._scene.environment,
          environmentIntensity: this._scene.environmentIntensity,
          pbrEnvMap: (() => {
            const m = NodeMaterials.get(Enums.Shader.PBR);
            return m ? !!m.envMap : null;
          })(),
          pbrEnvIntensity: (() => {
            const m = NodeMaterials.get(Enums.Shader.PBR);
            return m ? m.envMapIntensity : null;
          })(),
          // EFFECTIVE, not truthy. Both are opt-OUT now, so an unset flag means ON -- and
          // `!!undefined` reported "off" for the default state, which is the instrument
          // agreeing with the bug rather than with the code.
          xrEnv: window._xrEnv !== false, xrShadows: window._xrShadows !== false,
          lights: rows,
          // WORLD SCALE, because it turns out to explain a lot: it drives light falloff, and a
          // heavily grip-scaled world makes the model narrower than the 64mm IPD, at which
          // point correct stereo looks broken.
          worldScale: this._worldGroup ? this._worldGroup.scale.x : null,
          worldScaleVsDefault: this._worldGroup
            ? +(this._worldGroup.scale.x / Scene.WORLD_SCALE_DEFAULT).toFixed(4) : null,
          // NEAR/FAR AND WHAT SETS THEM. matt has reported three times that making a light
          // brings on a "near clip is half a metre" feel. optimizeNearFar() is fed
          // computeBoundingBoxScene(), which folds in EVERY mesh including light hosts and
          // bones -- unlike the light calibration, which filters _isNull. A light's handle is
          // sized off _lightRange, whose floor is 200 units, so one light can enlarge the
          // scene box several-fold. Printing both boxes says whether that is what is happening
          // instead of another round of guessing.
          near: this._camera && this._camera._near,
          far: this._camera && this._camera._far,
          sceneDiag: (() => {
            const b = this.computeBoundingBoxScene();
            return Number.isFinite(b[0])
              ? +Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]).toFixed(2) : null;
          })(),
          realMeshDiag: (() => {
            const real = (this._meshes || []).filter((m) => !m._isNull && !m._isBone && m.getNbVertices);
            if (!real.length) return null;
            const b = this.computeBoundingBoxMeshes(real);
            return Number.isFinite(b[0])
              ? +Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]).toFixed(2) : null;
          })(),
          // DID ?xrlayers=0 ACTUALLY TAKE? _supportsLayers is private and set once in the
          // XRManager constructor; if forcing it false does not stick, the session is still on
          // XRProjectionLayer and its render target still holds compositor-owned external
          // textures -- which is what the mailbox/shared-image errors are about.
          xrSupportsLayers: this._renderer.xr ? this._renderer.xr._supportsLayers : null,
          xrSessionUsesLayers: this._renderer.xr ? this._renderer.xr._sessionUsesLayers : null,
          xrTargetExternalTextures: this._renderer.xr && this._renderer.xr._xrRenderTarget
            ? this._renderer.xr._xrRenderTarget._hasExternalTextures : null,
          xrMultiview: this._renderer.xr ? this._renderer.xr._useMultiview : null,
          // DID THE SHADOW PASS EVEN RUN? On the desktop a casting point light adds 6 draw
          // calls and ~6x the triangles (its cube map's six faces). If these look the same in
          // a session with shadows on as with them off, the pass is not running at all --
          // which is a different problem from the pass running and its output being lost.
          meshesReceivingShadow: (this.getMeshes ? this.getMeshes() : []).filter((m) => {
            const tm = m.getThreeMesh && m.getThreeMesh();
            return tm && !m._isLight && tm.receiveShadow;
          }).length,
          meshesTotal: (this.getMeshes ? this.getMeshes() : []).filter((m) => !m._isLight).length,
          // Is the nested-render guard actually firing? outer counts top-level renders, nested
          // counts renders that began inside another one (the shadow pass), guarded counts the
          // ones the guard shielded. nested > 0 with guarded === 0 means the guard is missing
          // them; nested === 0 means the shadow pass is not going through renderer.render at
          // all and the guard is looking in the wrong place.
          nestedRender: this._renderer._xrNestedStats
            ? Object.assign({}, this._renderer._xrNestedStats) : null,
          triangles: this._renderer.info.render.triangles,
          drawCalls: this._renderer.info.render.drawCalls,
          graphFrozen: !!this._xrGraphFrozen,
          poolSize: this._lightPool
            ? this._lightPool[0].length + this._lightPool[1].length + this._lightPool[2].length
            : 0,
          poolCasting: this._lightPool
            ? [0, 1, 2].reduce((n, t) => n + this._lightPool[t].filter((L) => L.castShadow).length, 0)
            : 0
        };
        console.log('[xrLightReport]', JSON.stringify(out));
        return out;
      };
      // BEFORE ANYTHING RENDERS, and before any session: every node material is built now,
      // because constructing one mid-session is the single real fault this renderer has.
      NodeMaterials.enable(WGPU, TSL);
      // The level-3 bisection scene, built HERE so its material exists before any session --
      // the one hard rule this renderer has. Three spheres at different depths, because a
      // stereo fault is easiest to see on something with parallax.
      {
        const sc = this._stereoTestScene = new WGPU.Scene();
        const geo = new WGPU.SphereGeometry(0.15, 32, 16);
        const mat = new WGPU.MeshNormalNodeMaterial();
        for (const z of [-0.6, -1.2, -2.4]) {
          const mesh = new WGPU.Mesh(geo, mat);
          mesh.position.set(z * 0.15, 1.4, z);
          sc.add(mesh);
        }
      }
      console.log('[renderer] WebGPURenderer, backend='
        + (this._renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL (forced)'));
    } else {
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
    //
    // ...AND IT IS THE FILL-RATE KNOB, so it is overridable for the same reason foveation is.
    //
    // Measured on matt's Vision Pro against prod: `draw` starts at 1.06ms and settles at a
    // sustained 18.3-19.5ms, every sample, while the budget at 90Hz is 11.1ms. The frame gap
    // then steps 11.1 -> 22.2 -> 44.4ms -- exact halvings, the compositor locking to 45 then 22
    // and reprojecting the rest. matt: "its like every event is somehow delayed. i point at a
    // menu, theres no laser pointer, i point away point back, now its there." Input is arriving
    // on time; it is being SHOWN two reprojected frames later.
    //
    // A Vision Pro's eye buffers are far larger than a Quest's, so a scene that is comfortable
    // on one can be fill-bound on the other with nothing else different. Scale is the direct
    // lever on that, and halving it quarters the pixels. Whether this scene is fill-bound is a
    // question only the device can answer, so the knob exists to ask it: `window._fbScale`, or
    // `?fbscale=`, exactly as `window._foveation` / `?foveation=` does below.
    const _fbs = Number.isFinite(window._fbScale)
      ? window._fbScale
      : (Number.isFinite(getOptionsURL()['fbscale']) ? getOptionsURL()['fbscale'] : 1.0);
    this._renderer.xr.setFramebufferScaleFactor(Math.max(0.3, Math.min(2.0, _fbs)));
    if (_fbs !== 1.0) console.log('[XR] framebuffer scale ' + _fbs);
    this._renderer.toneMapping = THREE.LinearToneMapping;
    this._renderer.toneMappingExposure = 1.0;

    // Initialize underlying GL context for legacy code compatibility (temporarily)
    }
    // THE RAW CONTEXT SURVIVES EITHER WAY. 45 files reach for `_gl` -- WebGLCaps, Rtt, the
    // Buffer/Attribute wrappers, every Mesh -- and under forceWebGL the WebGL backend still
    // holds a real context at backend.gl. Keeping them fed is what makes a parallel path
    // possible at all; they come out later, with the mock gl, not as a precondition.
    // THE SELECTED ENVIRONMENT MUST BE ONE THIS RENDERER CAN LOAD.
    //
    // The two paths read different assets and neither can read the other's: legacy samples
    // the LogLUV octahedral atlas (`path`), the node renderer takes an equirect `hdr`
    // through RGBELoader. The default option is a single number shared by both, so moving it
    // to an HDR environment silently left the legacy renderer -- still the default renderer,
    // and what prod ships -- with no environment at all. Clamp to the first one that works
    // rather than leave a mode quietly unlit.
    {
      const SPBR = ShaderLib[Enums.Shader.PBR];
      const wantHdr = !!this._isNodeRenderer;
      const usable = (e) => (wantHdr ? !!e.hdr : !!e.path);
      if (SPBR && SPBR.environments[SPBR.idEnv] && !usable(SPBR.environments[SPBR.idEnv])) {
        const i = SPBR.environments.findIndex(usable);
        if (i >= 0) {
          console.log('[env] "' + SPBR.environments[SPBR.idEnv].name + '" has no '
            + (wantHdr ? 'hdr' : 'atlas') + ' asset for this renderer — using "'
            + SPBR.environments[i].name + '"');
          SPBR.idEnv = i;
          SPBR.exposure = SPBR.environments[i].exposure;
        }
      }
    }

    this._gl = this._renderer.backend ? this._renderer.backend.gl : this._renderer.getContext();
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
    this._worldGroup.scale.set(Scene.WORLD_SCALE_DEFAULT, Scene.WORLD_SCALE_DEFAULT, Scene.WORLD_SCALE_DEFAULT);
    this._scene.add(this._worldGroup);
    // Exposed for Mesh.getModelSpaceMatrix() — picking composes the parent chain
    // relative to this group (meshes live under it).
    window._sxrWorldGroup = this._worldGroup;
    
    // NO DEFAULT LIGHTS. There were two here -- an AmbientLight and a DirectionalLight, added
    // long ago "since we are using MeshStandardMaterial" -- and until today they lit nothing:
    // every shader on the legacy path is custom and ignores three's lights entirely, so they
    // were inert decoration.
    //
    // Moving PBR onto MeshPhysicalNodeMaterial woke them up. They became the brightness floor
    // of every render, with no entity, no outliner row, and no way to select, move or switch
    // them off. matt: "is there a default light i can't see or edit? if so, remove it."
    //
    // KNOWN CONSEQUENCE: the GLTF controller models are MeshStandardMaterial and were being
    // lit by these. They will render dark under ?renderer=webgpu until they are given their
    // own lighting or an unlit material -- they are UI furniture, not scene content, so they
    // should not depend on the user's lighting rig either way.

    // Localized Geometry Base Grid (100 units wide, 25 divisions for massive 4-meter visual blocks)
    this._groundGrid = new THREE.GridHelper(100, 25, 0x888888, 0x444444);
    this._groundGrid.material.transparent = true;
    this._groundGrid.material.opacity = getOptionsURL().gridOpacity ?? 0.5;
    // ALPHA MUST ONLY EVER ACCUMULATE, NEVER DROP.
    //
    // In passthrough the framebuffer's ALPHA is what the compositor reads to decide how much of
    // the real room shows through. Ordinary SrcAlpha/OneMinusSrcAlpha blending applies to the
    // alpha channel as well as to colour, so a half-alpha grid line drawn over the mesh REDUCES
    // the destination alpha -- and lower alpha in an AR layer means the room comes through. The
    // grid was not darkening the sculpt, it was making it see-through: matt's "punching a hole
    // in the alpha". Over empty space there is no alpha to reduce, which is why only the half
    // over the mesh looked wrong, and that asymmetry is the whole diagnosis.
    //
    // So: keep the colour blend exactly as it was, and give the ALPHA channel its own factors
    // that can only add. The grid now reads as mixed into the mesh rather than cut through it.
    this._groundGrid.material.blending = THREE.CustomBlending;
    this._groundGrid.material.blendSrc = THREE.SrcAlphaFactor;
    this._groundGrid.material.blendDst = THREE.OneMinusSrcAlphaFactor;
    this._groundGrid.material.blendSrcAlpha = THREE.OneFactor;
    this._groundGrid.material.blendDstAlpha = THREE.OneFactor;
    // Depth WRITE stays off. It was set true with the note "must write depth so grid composites
    // correctly in VR", but a transparent surface that writes depth occludes whatever is sorted
    // after it -- and every mesh in this app is transparent, so the grid was competing with the
    // sculpt for the same pass. Depth TEST is untouched, so the grid is still properly hidden by
    // anything genuinely in front of it.
    this._groundGrid.material.depthWrite = false;
    // BOTH PASSES DRAW AFTER THE MESHES, and then DEPTH TESTING decides each one.
    //
    // Order has to be stated rather than left to the sort: at renderOrder 0 the grid ties with
    // every mesh, and the transparent pass falls back to bounding-sphere distance -- but the
    // grid and the default sculpt are BOTH centred on the origin, so that comparison is a
    // near-tie that flips as the view tumbles. matt saw the grid snap in and out at an angle
    // threshold while his distance never changed, and read it correctly as a draw-order problem.
    //
    // Ordering it BEFORE the meshes was the wrong correction, and swapped which half broke:
    // this pass writes no depth, so drawn first it cannot occlude anything, and the sculpt
    // painted over the grid even where the grid was NEARER than it -- "the part between the
    // sphere and the camera is invisible".
    //
    // After the meshes, with depth WRITE still off, the ordinary depth TEST does exactly the
    // right thing: this pass survives only where the grid is genuinely in front, and the ghost
    // below picks up precisely the fragments this one loses.
    // ...but UNDER the VR panels, which sit at 1000 (VRMenu.js) and must never be drawn
    // through: a menu you can see the floor through is worse than no grid at all.
    this._groundGrid.renderOrder = 200;
    this._groundGrid.position.y = -0.25;
    this._groundGrid.visible = !!this._showGrid;
    this._worldGroup.add(this._groundGrid);

    // THE GHOST PASS -- the grid where the sculpt is in front of it.
    //
    // Fixing the alpha hole took the grid's visibility with it, because the hole WAS the
    // visibility: punching through the mesh is what made the grid show from above. Composited
    // honestly, the sculpt simply occludes it, which is correct and is not what was asked for.
    // matt wants it "half mixed on the mesh".
    //
    // So: the same idiom the BONES have always used to stay readable inside a mesh -- a second
    // pass drawn only where something is nearer (`depthFunc: GreaterDepth`), at a fraction of
    // the opacity. In front of the sculpt the grid reads normally; behind it, it reads as a
    // faint wash. Nothing is punched through, because this pass carries the same
    // alpha-only-accumulates blending as the first.
    const ghostMat = this._groundGrid.material.clone();
    // Saved value first, then the old fraction as the default — see setGridOccludedOpacity.
    ghostMat.opacity = getOptionsURL().gridOccludedOpacity
      ?? (this._groundGrid.material.opacity * GRID_GHOST_FRACTION);
    ghostMat.depthFunc = THREE.GreaterDepth;
    ghostMat.depthWrite = false;
    // clone() copies the factors but not the custom-blending intent on every three version, so
    // they are restated rather than assumed -- a ghost that blends normally reinstates the hole
    // in the one place the fix exists to protect.
    ghostMat.blending = THREE.CustomBlending;
    ghostMat.blendSrc = THREE.SrcAlphaFactor;
    ghostMat.blendDst = THREE.OneMinusSrcAlphaFactor;
    ghostMat.blendSrcAlpha = THREE.OneFactor;
    ghostMat.blendDstAlpha = THREE.OneFactor;
    this._groundGridGhost = new THREE.GridHelper(100, 25, 0x888888, 0x444444);
    this._groundGridGhost.material = ghostMat;
    // The other half of the pair, one step later. `GreaterDepth` passes only where something
    // NEARER has ALREADY written depth, so a ghost that draws before the sculpt tests against a
    // depth buffer the sculpt has not written yet and is discarded every frame -- invisible,
    // not faint. That was the real fault; the opacity was never the problem. The rig's ghosts
    // have always sat at 9998 for exactly this reason. Kept just under them so a bone still
    // reads in front of the grid.
    this._groundGridGhost.renderOrder = 201;
    this._groundGridGhost.position.y = this._groundGrid.position.y;
    this._groundGridGhost.visible = !!this._showGrid;
    this._worldGroup.add(this._groundGridGhost);

    // The cast shadow. Constructed here because it lives in the world group, so a world grab
    // carries the light and the shadow along with the model; it builds nothing at all until a
    // mesh is flagged as a Shadow Catcher. See render/SceneShadow.js for why a light in this app
    // only casts and never lights.
    this._sceneShadow = new SceneShadow(this);

    // "What is that dot?" — see misc/PhantomScan.js. Costs an import; runs only when called.
    window.scanPhantoms = scanPhantoms;
    // "Can the headset estimate the room's lighting?" — a question only the device can answer.
    // See misc/XRLightProbe.js.
    window.probeXRLighting = probeXRLighting;

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


    this.render();
  }

  computeRadiusFromBoundingBox(box) {
    var dx = box[3] - box[0];
    var dy = box[4] - box[1];
    var dz = box[5] - box[2];
    var rad = 0.5 * Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (isNaN(rad)) {
        guardedError('computeRadiusFromBoundingBox produced NaN', 5000, 'Box:', Array.from(box));
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
           guardedError('computeBoundingBoxMeshes produced NaN', 5000,
             'meshes:', meshes.length, 'bounds:', Array.from(bound));
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
    this._addPrimitive(mesh);
    return mesh;
  }

  // [Eye rig Phase 1] A NULL / locator — a transform-only node (look-at target,
  // group parent). Implemented as a small non-sculptable locator mesh so it slots
  // into the existing selection / gizmo / outliner / transform-animation machinery
  // for free. isPickable=false makes the sculpt brush skip it (Picking.js:294) while
  // VR ray-select still picks it (Picking.js:229 ignores isPickable). Not a true
  // geometry-less node yet — fine for the rig; can be refined later.
  // Add or remove a mesh WITHOUT pushing an undo state of its own. For callers that wrap a
  // whole operation — create the object, link it, set its mode — in one undo step, so a single
  // button press is a single undo rather than two or three.
  addMeshSilent(mesh) {
    if (this.getIndexMesh(mesh) >= 0) return mesh;
    this._meshes.push(mesh);
    if (!mesh._permanentStaticLabel) {
      mesh._permanentStaticLabel = (mesh._typeName || 'Mesh') + ' ' + this._meshes.length;
    }
    this.attachMeshThree(mesh);
    return mesh;
  }

  removeMeshSilent(mesh) {
    const idx = this.getIndexMesh(mesh);
    if (idx < 0) return;
    this.removeMirror(mesh.getID());
    this.detachMeshThree(mesh);
    this._meshes.splice(idx, 1);
  }

  addNull() {
    const mesh = this.buildNull();
    this.addNewMesh(mesh);
    this.decorateNull(mesh);
    return mesh;
  }

  // The null's geometry and flags, with nothing added to the scene. Split out so a caller that
  // manages its own undo (the IK pins) can build one and attach it silently.
  buildNull() {
    // Pick/transform target: a tiny sphere (kept small so it's just a centre dot).
    var mesh = new Multimesh(Primitives.createSphere(this._gl, 0.5, 8, 8));
    mesh.normalizeSize();
    mat4.scale(mesh.getMatrix(), mesh.getMatrix(), [0.03, 0.03, 0.03]);
    mesh.setShaderType(Enums.Shader.FLAT);
    mesh._typeName    = "Null";
    mesh._isNull      = true;   // transform-only locator (rig nodes look for this)
    mesh.isPickable   = false;  // sculpt brush skips it; still VR-ray-selectable
    return mesh;
  }

  // The null's LOOK. Separate because it needs the Three mesh, which only exists once the
  // locator has been attached to the scene.
  decorateNull(mesh) {

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

  // ── LIGHTS ARE OBJECTS ────────────────────────────────────────────────────────────
  //
  // Not a viewport setting: you add one and you put it where you want it. Which means it wants
  // to be an ordinary scene object, and the cheapest way to be one here is to BE A LOCATOR --
  // `_isNull` on top of `_isLight`, exactly as a rig joint carries `_isBone` AND `_isNull`
  // ("transform-only locator: reuses the null constraint/eval paths", Skeleton.js).
  //
  // Carrying `_isNull` is what makes this small. Twenty-nine places already ask "is this a real
  // piece of geometry" by checking that flag -- the exporter, the shadow caster list, skinning,
  // weight cages, bone draw, the rendering-option sweeps, the phantom scan -- and every one of
  // them gets a light right without being told about lights. What comes with it for free is the
  // rest of the application: an outliner row, selection, the transform gizmo, parenting (so a
  // light can hang off a bone), keyframes, and undo.
  addLight() {
    const mesh = this.buildLight();
    this.addNewMesh(mesh);
    this.decorateLight(mesh);
    return mesh;
  }

  buildLight() {
    var mesh = new Multimesh(Primitives.createSphere(this._gl, 0.5, 8, 8));
    mesh.normalizeSize();
    mat4.scale(mesh.getMatrix(), mesh.getMatrix(), [0.05, 0.05, 0.05]);
    mesh.setShaderType(Enums.Shader.FLAT);
    mesh._typeName  = 'Light';
    mesh._isLight   = true;
    mesh._isNull    = true;    // see the note above: this is the flag that makes it harmless
    mesh.isPickable = false;   // the sculpt brush skips it; still selectable by ray and outliner
    mesh._lightColor     = [1.0, 0.98, 0.95];
    mesh._lightIntensity = 1.0;
    // 0 point, 1 spot, 2 directional. ONE ENTITY WITH A TYPE, not three classes: a light is
    // already an ordinary scene object and the type is a property of it, so changing your mind
    // keeps the placement, the parenting and the keys. Aim is the locator's local -Z, so the
    // ordinary gizmo aims a spot with no special mode.
    mesh._lightType   = 0;
    mesh._lightConeDeg = 35;   // outer half-angle; the inner edge is derived in the shader upload
    // RANGE FROM THE SCENE, not a constant. Units here are arbitrary and large -- the camel is
    // about 180 across -- so a fixed range would light either nothing or everything depending on
    // the model. Half the scene's diagonal puts the falloff somewhere useful on the first frame,
    // which is the difference between "I added a light" and "I added a light and nothing
    // happened".
    mesh._lightRange = this._lightRangeForScene();
    // The distance the slider is calibrated against — see the intensity note in
    // _syncThreeLights. Deliberately NOT derived from _lightRange: that carries a floor of
    // 200 because it is a falloff CUTOFF and wants to reach past the model, and using it as
    // a brightness reference is what made slider 1 read as white. This is the scene's own
    // half-diagonal — roughly where you stand to work on it.
    mesh._lightRefDist = this._lightRefDistForScene();
    return mesh;
  }

  // A FLOOR OF 200, because half the scene diagonal is not far enough in this app's units.
  //
  // matt: "the defautlt fallof should be at least 200 based on the scene units sculptxr
  // uses". The default sphere is 34 units across, so half its diagonal is about 29 -- a
  // light placed anywhere sensible to work by is already outside that, and with physical
  // inverse-square falloff it contributes almost nothing by the time it reaches the sculpt.
  // The old value predates three's lighting, when the falloff was our own
  // 1/(1 + d²/r²) and never actually reached zero.
  //
  // Still scaled off the scene for anything larger than the floor, so a big import gets a
  // light that reaches it.
  _lightRangeForScene() {
    const MIN = 200;
    const real = (this._meshes || []).filter((m) => !m._isNull && !m._isBone && m.getNbVertices);
    if (!real.length) return MIN;
    const box = this.computeBoundingBoxMeshes(real);
    if (!Number.isFinite(box[0]) || !Number.isFinite(box[3])) return MIN;
    const d = vec3.dist([box[0], box[1], box[2]], [box[3], box[4], box[5]]);
    return Math.max(MIN, d > 1e-6 ? d * 2 : MIN);
  }

  /** Half the scene's diagonal: the distance a light's brightness is calibrated against. */
  _lightRefDistForScene() {
    const real = (this._meshes || []).filter((m) => !m._isNull && !m._isBone && m.getNbVertices);
    if (!real.length) return 20;
    const box = this.computeBoundingBoxMeshes(real);
    if (!Number.isFinite(box[0]) || !Number.isFinite(box[3])) return 20;
    const d = vec3.dist([box[0], box[1], box[2]], [box[3], box[4], box[5]]);
    return Math.max(5, d * 0.5);
  }

  // The light's LOOK: a star of rays, in the light's own colour so a scene of several is
  // readable at a glance. Depth-write off and frustumCulled off for the same reason the null's
  // cruciform has them -- it is a handle, not geometry.
  decorateLight(mesh) {
    const tm = mesh.getThreeMesh();
    if (!tm) return mesh;
    // SHARED MATERIALS, MADE ONCE. Every material in this app is compiled the first time it
    // is drawn, and one compiled inside an XR session comes out with the desktop camera
    // layout -- which is what matt saw as "the light gizmo doubled up in my eyes" and, on a
    // type switch, as the whole render splitting into wrong left/right eyes. Adding a light
    // used to mint two fresh materials, and changing its type minted another.
    //
    // So neither is per-light any more: the host is one invisible material, and the handle
    // is one line material reading VERTEX COLOURS, which is how the per-light colour
    // survives being shared. Geometry is still rebuilt per type; geometry is not compiled.
    if (!Scene._lightHostMat) {
      Scene._lightHostMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
      Scene._lightRayMat = new THREE.LineBasicMaterial({ vertexColors: true, depthWrite: false });
    }
    tm.material = Scene._lightHostMat;

    // REBUILT, NOT ADDED TO. The handle is type-specific, so changing the type has to replace
    // it; without this every switch left the previous one behind.
    const old = tm.getObjectByName('light_rays');
    if (old) { tm.remove(old); old.geometry.dispose(); }   // material is shared, never disposed

    // THE HANDLE SAYS WHAT KIND OF LIGHT IT IS, and for the aimed types, WHERE IT POINTS.
    // A point light has no direction, so a symmetric asterisk is the honest shape for it; a
    // spot and a sun both have one, and a marker that does not show it makes you rotate the
    // gizmo and guess. matt: "spotlights need a cone indicator to indicate direction and
    // angle. sun needs 3 parallel lines with a thin arrow at one end."
    //
    // Everything is built down the local -Z, which is the aim (see the upload in ShaderPBR),
    // in unit space -- the scale is applied once at the end.
    const type = mesh._lightType || 0;
    const pts = [];
    const seg = (ax, ay, az, bx, by, bz) => pts.push(ax, ay, az, bx, by, bz);
    const ray = (x, y, z) => seg(0, 0, 0, x, y, z);

    if (type === 1) {
      // SPOT: a cone from the apex, its rim drawn at the OUTER angle so the circle is the
      // angle you set. Four ribs rather than a dense fan -- enough to read as a cone from any
      // side without becoming a solid object in the viewport.
      const rad = Math.tan(Math.max(1, Math.min(89, mesh._lightConeDeg || 35)) * Math.PI / 180);
      const L = 1.0;
      for (let k = 0; k < 4; k++) {
        const a = k * Math.PI / 2;
        seg(0, 0, 0, Math.cos(a) * rad, Math.sin(a) * rad, -L);
      }
      const N = 24;
      for (let k = 0; k < N; k++) {
        const a0 = (k / N) * Math.PI * 2, a1 = ((k + 1) / N) * Math.PI * 2;
        seg(Math.cos(a0) * rad, Math.sin(a0) * rad, -L,
            Math.cos(a1) * rad, Math.sin(a1) * rad, -L);
      }
    } else if (type === 2) {
      // SUN: three parallel rays with one arrowhead. Parallel IS the statement -- a sun has a
      // direction and no position -- and the arrow says which way along them.
      const off = [[-0.35, 0], [0, 0], [0.35, 0]];
      for (const [ox, oy] of off) seg(ox, oy, 0.7, ox, oy, -0.7);
      const h = 0.18;
      seg(0, 0, -0.7, h, 0, -0.7 + h);
      seg(0, 0, -0.7, -h, 0, -0.7 + h);
      seg(0, 0, -0.7, 0, h, -0.7 + h);
      seg(0, 0, -0.7, 0, -h, -0.7 + h);
    } else {
      // POINT: six axis rays. No direction to show, so nothing here should imply one.
      ray(1, 0, 0); ray(-1, 0, 0); ray(0, 1, 0); ray(0, -1, 0); ray(0, 0, 1); ray(0, 0, -1);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
    const c = mesh._lightColor;
    const col = new Float32Array(pts.length);
    for (let i = 0; i < col.length; i += 3) { col[i] = c[0]; col[i + 1] = c[1]; col[i + 2] = c[2]; }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const rays = new THREE.LineSegments(geo, Scene._lightRayMat);
    rays.name = 'light_rays';
    rays.frustumCulled = false;
    // Sized off the scene like the light's own range is, rather than a constant: scene units
    // here are arbitrary and large, so a fixed 4 was invisible in one scene and a nuisance in
    // the next. A twentieth of the range puts it at marker size in whatever it lands in.
    // A MARKER, NOT A DIAGRAM. A twentieth of the range was chosen so the icon stayed
    // visible whatever scene it landed in, but range now has a floor of 200, so the default
    // light arrives as a ten-unit star over a sculpt a few units across. matt: "the ray-star
    // gizmo is annoying at size; want something simpler/smaller." Scaled off the SCENE rather
    // than the light's falloff -- the falloff is a lighting decision and has no business
    // setting how big an icon is -- and capped, so a big import does not bring a big star.
    const _r = this._lightRefDistForScene ? this._lightRefDistForScene() : 20;
    rays.scale.setScalar(Math.max(0.35, Math.min(_r * 0.08, 3)));
    tm.add(rays);
    return mesh;
  }

  // Repaint the handle after a colour change, so the gizmo keeps telling the truth.
  refreshLightDecoration(mesh) {
    const tm = mesh && mesh.getThreeMesh && mesh.getThreeMesh();
    const rays = tm && tm.getObjectByName && tm.getObjectByName('light_rays');
    if (!rays || !mesh._lightColor) return;
    // Into the attribute, not the material: the material is shared by every light.
    const a = rays.geometry.getAttribute('color');
    if (!a) return;
    const c = mesh._lightColor;
    for (let i = 0; i < a.array.length; i += 3) {
      a.array[i] = c[0]; a.array[i + 1] = c[1]; a.array[i + 2] = c[2];
    }
    a.needsUpdate = true;
  }

  /** Every light in the scene, for the shader to read. */
  // REAL three.js LIGHTS, MIRRORED ONTO OUR LIGHT ENTITIES.
  //
  // Our lights have always been scene entities whose state we uploaded as uniform arrays and
  // summed in our own BRDF. three knew nothing about them -- which is exactly why there were
  // no shadows: a shadow map belongs to a Light object, and there were none.
  //
  // Each entity gets a real light PARENTED TO ITS OWN MESH, so it inherits that mesh's world
  // transform rather than having one copied onto it every frame. The two cannot drift, which
  // is the failure mode the uniform-array path had in VR (light positions derived from the
  // desktop camera while the geometry used the per-eye one).
  //
  // Type is ours: 0 point, 1 spot, 2 directional. A spot needs a target object; it is a child
  // at (0,0,-1), so "aim" is the light's own local -Z -- the same convention the gizmo and
  // the old uLightDir upload used.
  // A FIXED POOL OF LIGHTS, CREATED BEFORE ANY SESSION.
  //
  // matt's reproduction: in VR, adding a light makes the sculpt vanish and the new light's
  // gizmo render with broken stereo, while everything else stays correct; deleting it brings
  // the sculpt back; matcap is unaffected. Lights created BEFORE entering VR work fine.
  //
  // The trigger is the RECOMPILE. A node material's lighting graph is baked from the lights
  // present, so adding one rebuilds the shader -- inside the session -- and a material built
  // in there is what breaks. Matcap escapes it because it has no lights in its graph.
  //
  // So the graph must never change. The pool is built once, on the desktop, with a fixed
  // count of each type; user lights are mapped onto slots and unused slots sit at intensity
  // zero. Adding, deleting or retyping a light then moves numbers around in a shader that
  // was compiled once, before the session, and never rebuilt.
  //
  // The cost is honest: the shader always evaluates POOL lights, used or not. That is a real
  // per-fragment cost, and it is the price of a lighting rig that can be edited in VR at all.
  _ensureLightPool() {
    if (this._lightPool) return this._lightPool;
    const T = this._THREE_GPU || THREE;
    // SIZES ARE A KNOB, because the pool itself is now a suspect. matt: light added, PBR
    // sphere does not draw in VR at all, while matcap does -- and the pool is the thing that
    // changed. Seven lights is seven light structs in the bindings of every lit material, on
    // top of the per-eye camera array an XR session adds, so a limit is a real possibility.
    //
    // `?pool=P,S,D` set these counts, for the ladder that found out whether having lights in the
    // graph AT ALL was what an AR session could not draw. It was not; the fault was three's XR
    // camera layout. The counts are settled and the switch is gone.
    const POOL = { point: 4, spot: 2, dir: 1 };
    const mk = (L) => {
      L.intensity = 0;
      L.castShadow = false;
      if (L.isSpotLight || L.isDirectionalLight) {
        const t = new T.Object3D();
        t.position.set(0, 0, -1);
        L.add(t);
        L.target = t;
      }
      this._scene.add(L);
      return L;
    };
    this._lightPool = {
      0: Array.from({ length: POOL.point }, () => mk(new T.PointLight(0xffffff, 0))),
      1: Array.from({ length: POOL.spot }, () => mk(new T.SpotLight(0xffffff, 0))),
      2: Array.from({ length: POOL.dir }, () => mk(new T.DirectionalLight(0xffffff, 0))),
    };
    // AND THE GIZMO MATERIALS ARE WARMED HERE TOO, for the same reason the pool exists: a
    // material compiles when it is first DRAWN, and if that first draw happens inside an XR
    // session it comes out wrong. Creating them is not enough -- they have to be drawn on
    // the desktop. Two degenerate objects do it: the host material writes no colour at all,
    // and a zero-length line segment covers no pixels, so nothing appears.
    if (!Scene._lightHostMat) {
      Scene._lightHostMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
      Scene._lightRayMat = new THREE.LineBasicMaterial({ vertexColors: true, depthWrite: false });
    }
    if (!this._lightMatWarm) {
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(new Float32Array(6), 3));
      g.setAttribute('color', new T.BufferAttribute(new Float32Array(6), 3));
      const w = new T.Group();
      w.add(new T.LineSegments(g, Scene._lightRayMat));
      // A REAL BoxGeometry, not a bare position buffer. The host material converts to the
      // unlit Lambert base, whose graph still reads `normal`, so a geometry carrying only
      // positions fails to build with "Vertex attribute normal not found" -- the same class
      // of error the missing `uv` caused. Scaled to nothing, and it writes no colour anyway.
      const hostWarm = new T.Mesh(new T.BoxGeometry(1, 1, 1), Scene._lightHostMat);
      hostWarm.scale.setScalar(1e-6);
      w.add(hostWarm);
      w.traverse((o) => { o.frustumCulled = false; });
      this._scene.add(w);
      this._lightMatWarm = w;
    }
    console.log('[lights] pool built: ' + POOL.point + ' point, ' + POOL.spot + ' spot, '
      + POOL.dir + ' directional');
    return this._lightPool;
  }

  _syncThreeLights() {
    const THREE_ = this._THREE_GPU || THREE;
    const pool = this._ensureLightPool();
    const lights = this.getLights ? this.getLights() : [];
    const used = { 0: 0, 1: 0, 2: 0 };
    if (!this._lpTmp) {
      this._lpTmp = { p: new THREE_.Vector3(), q: new THREE_.Quaternion(), s: new THREE_.Vector3() };
    }

    // THE SCENE'S RADIUS IN WORLD UNITS, for the shadow cameras below. Note this is the RAW
    // worldGroup scale, not the wscale used for falloff -- that one is normalised against the
    // default so the exposure does not move, whereas a shadow camera wants true world metres.
    const _sAbs = (this._worldGroup && this._worldGroup.scale.x) || 1;
    const _realMeshes = (this._meshes || []).filter((m) => !m._isNull && !m._isBone && m.getNbVertices);
    let _rWorld = 1;
    const _cWorld = { x: 0, y: 0, z: 0 };
    if (_realMeshes.length) {
      const b = this.computeBoundingBoxMeshes(_realMeshes);
      if (Number.isFinite(b[0])) {
        _rWorld = Math.max(1e-4, 0.5 * Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) * _sAbs);
        _cWorld.x = (b[0] + b[3]) * 0.5 * _sAbs;
        _cWorld.y = (b[1] + b[4]) * 0.5 * _sAbs;
        _cWorld.z = (b[2] + b[5]) * 0.5 * _sAbs;
      }
    }

    // WHAT THE SHADOW MAPS DEPEND ON, AS ONE KEY. Built once per sync, compared per light.
    //
    // The point is which SPACE it is measured in. A single-hand grip translates and rotates
    // _worldGroup, and the lights live under it too -- so the light and the geometry move
    // TOGETHER and nothing about the shadow has actually changed. Keying on WORLD positions
    // said otherwise and re-rendered the map every frame of the gesture, and re-rasterising a
    // moving light's map makes its texel grid crawl across the geometry: matt, in a session,
    // "if i move my head the shadows stay static, but they shimmer if i use the world grip
    // handle like they're being recalculated". They were.
    //
    // LOCAL matrices are the relative ones, since everything here is a child of _worldGroup,
    // so a rigid world move leaves this key untouched. World SCALE is included because the
    // frustum and normalBias are in world units and genuinely do change with it.
    //
    // position.version is three's own BufferAttribute counter and is what catches a sculpt
    // stroke -- vertex count and matrix both stay put when you only move existing vertices.
    // World ROTATION goes in the key for one reason only: a point light's shadow cube has
    // WORLD-AXIS-ALIGNED faces, so turning the world turns the geometry relative to those axes
    // and the cube's contents really do go stale. A spot or directional light rotates WITH the
    // world -- its camera is placed and aimed from objects that are also under _worldGroup --
    // so its map stays valid and it is left out of this.
    const _wq = this._worldGroup ? this._worldGroup.quaternion : null;
    const _worldRotKey = _wq
      ? 'r' + _wq.x.toFixed(3) + ',' + _wq.y.toFixed(3) + ',' + _wq.z.toFixed(3) + ',' + _wq.w.toFixed(3)
      : 'r0';
    let _shadowSceneKey = 's' + _sAbs.toFixed(5);
    for (const m of (this.getMeshes ? this.getMeshes() : [])) {
      if (m._isLight) continue;
      const tm = m.getThreeMesh && m.getThreeMesh();
      if (!tm || !tm.visible) continue;
      const pa = tm.geometry && tm.geometry.attributes && tm.geometry.attributes.position;
      const me = tm.matrix.elements;
      _shadowSceneKey += '|' + tm.id + ',' + (pa ? pa.version + ',' + pa.count : '-')
        + ',' + me[12].toFixed(2) + ',' + me[13].toFixed(2) + ',' + me[14].toFixed(2)
        + ',' + me[0].toFixed(3) + ',' + me[5].toFixed(3) + ',' + me[10].toFixed(3)
        + ',' + me[1].toFixed(3) + ',' + me[2].toFixed(3) + ',' + me[6].toFixed(3);
    }

    // THE ONE-FRAME LAG. host.updateMatrixWorld(true) refreshes the host and its children, but
    // it composes against its PARENT's matrixWorld -- and _worldGroup has not been updated yet
    // this frame, because the renderer does that inside render(), after this runs. So every
    // light was positioned from the world transform of the PREVIOUS frame, and the shadow
    // trailed the sculpt by exactly one frame during a fast grip. matt: "why does it feel like
    // the shadow is on a tight spring rather than being directly parented to the worldspace...
    // i can see the shadow is lagging by a frame."
    //
    // Updating the group first costs one matrix compose; the renderer's own pass right
    // afterwards then finds nothing to do. (The deeper fix matt is pointing at -- parent the
    // pool lights instead of copying their transforms every frame -- is a real one, but the
    // copy exists to keep the host's scale out of the light's matrix, so it is not a one-liner.)
    if (this._worldGroup) this._worldGroup.updateMatrixWorld();

    for (const e of lights) {
      const host = e.getThreeMesh && e.getThreeMesh();
      if (!host) continue;
      const type = Math.max(0, Math.min(2, e._lightType || 0));
      const slots = pool[type];
      if (used[type] >= slots.length) continue;     // more lights than the pool holds
      const L = slots[used[type]++];

      // Position and orientation copied, never parented: the entity's mesh carries a scale
      // (measured 2.024) and a scale in a light's world matrix corrupts its shadow camera.
      host.updateMatrixWorld(true);
      host.matrixWorld.decompose(this._lpTmp.p, this._lpTmp.q, this._lpTmp.s);
      L.position.copy(this._lpTmp.p);
      L.quaternion.copy(this._lpTmp.q);
      L.scale.set(1, 1, 1);
      L.updateMatrixWorld(true);

      const c = e._lightColor || [1, 1, 1];
      L.color.setRGB(c[0], c[1], c[2]);
      const slider = (e._lightIntensity === undefined ? 1 : e._lightIntensity);
      // THE WORLD SCALE, because falloff is evaluated where the light ACTUALLY IS.
      //
      // Pool lights are added to the root scene and positioned from the host's WORLD matrix,
      // so they sit in three-world space -- which is model space times _worldGroup.scale
      // (0.701 by default, and the VR two-grip gesture drives it over a wide range). But
      // `distance` and the intensity reference below are both in MODEL units, so irradiance
      // came out as (ref/d_model)^2 / s^2: the same light, the same slider, a different
      // exposure for every world scale. matt found it from the symptom -- "it's vr scale
      // dependent, if I grip-scale the world smaller the shading looks correct".
      //
      // Converting both to world units makes irradiance at a given MODEL distance invariant:
      //   intensity/(d_world)^2 = slider*(ref*s)^2 / (s*d_model)^2 = slider*(ref/d_model)^2
      //
      // NORMALISED AGAINST THE DEFAULT SCALE, not used raw. The existing calibration was tuned
      // by eye at s = 0.701, so a raw conversion would be correct in principle and about 2x
      // darker than everything matt has already judged. Dividing by the default makes the
      // multiplier 1.0 there -- the look at rest is unchanged, and only the DEPENDENCE on
      // world scale goes away.
      const wscale = ((this._worldGroup && this._worldGroup.scale.x) || 1) / Scene.WORLD_SCALE_DEFAULT;
      if (L.isPointLight || L.isSpotLight) {
        const range = e._lightRange === undefined ? 50 : e._lightRange;
        L.distance = range * wscale;
        L.decay = 2;
        // SCALED BY THE WORKING DISTANCE, NOT BY THE RANGE.
        //
        // With decay 2 the irradiance is intensity/d², so the multiplier has to be d² for
        // slider 1 to mean "about right". It used to be range², and range defaults to twice
        // the scene diagonal with a floor of 200 -- so 40000 against an actual light-to-
        // subject distance nearer 17. That is ~5000x over, and matt saw exactly what that
        // looks like: white, with a sliver of slider at the bottom that is a flat clipped
        // grey rather than a shaded sphere.
        //
        // The reference is half the scene diagonal, fixed when the light is made, so moving
        // the light afterwards still falls off physically.
        const ref = (e._lightRefDist === undefined ? this._lightRefDistForScene() : e._lightRefDist) * wscale;
        L.intensity = slider * ref * ref;
      } else {
        L.intensity = slider;
      }
      if (L.isSpotLight) {
        const deg = e._lightConeDeg === undefined ? 35 : e._lightConeDeg;
        L.angle = Math.max(0.01, Math.min(1.55, deg * Math.PI / 180));
        L.penumbra = 0.25;
      }

      // Shadows stay off inside a session: a shadow map is an extra render target and that
      // is its own unresolved problem. castShadow also has to go false rather than just
      // renderer.shadowMap.enabled, because it is castShadow that puts shadow sampling into
      // the compiled graph -- and the graph is exactly what must not change.
      //
      // AND IT IS ONLY EVER WRITTEN OUTSIDE A SESSION. castShadow is itself part of the
      // graph, so flipping it on a frame inside VR is the same recompile the pool exists to
      // avoid. The session boundary sets it (see _setPoolShadows in enterXR), and in here it
      // is left alone while presenting.
      // THE GUARD IS A LATCH, NOT isPresenting.
      //
      // `xr.isPresenting` only becomes true once the session's frame loop has started, and
      // setSession resolves BEFORE that -- so there are frames after the boundary has set
      // castShadow where isPresenting still reads false. This loop then ran with the old
      // answer and put every pool light back to castShadow=false, inside the session, where
      // the boundary can no longer correct it. Measured: window._xrShadows=1,
      // shadowMap.enabled true, and every light reporting castShadow false.
      // POINT LIGHTS DO NOT CAST. Their shadow map is a cube rendered along fixed WORLD axes
      // and sampled by a world-space direction, so a world rotation invalidates its contents
      // and forces a re-render mid-gesture -- the shimmer matt chased for two sessions. Spot
      // and sun rotate WITH the world once the shadow camera's up follows it, so their maps are
      // invariant and never need re-rendering for a rigid grip. A point light is also six
      // renders against one. Enforced here as well as hidden in the UI, so a scene saved with a
      // casting point light does not bring the problem back.
      const wantCast = (e._castShadow !== false) && (e._lightType || 0) !== 0;
      if (!this._xrGraphFrozen) {
        L.castShadow = wantCast;
      }
      // WHETHER THE MAP IS RENDERED IS *NOT* GRAPH STATE, so unlike castShadow it can be
      // changed freely inside a session -- ShadowNode.updateBefore skips the whole shadow pass
      // when `shadow.autoUpdate` and `shadow.needsUpdate` are both false. That is the lever
      // that makes shadows affordable here: castShadow stays pinned for the whole session so
      // the compiled graph never moves, while the COST follows what is actually in use.
      // ?xrshadows=once -- render each map ON DEMAND instead of every frame. Two reasons.
      // PERF: a casting point light re-renders its whole cube map every frame even when
      // nothing has moved, which is six full scene renders per light per frame. DIAGNOSIS: the
      // shadow pass is a NESTED renderer.render inside the XR frame, which is the exact shape
      // that broke this renderer before (the spectator canvas did the same and left the canvas
      // target bound). If the frame is intact with one shadow pass and breaks when they run
      // every frame, that is the answer. window.xrShadowRefresh() pulses an update.
      // ON DEMAND BY DEFAULT NOW, not every frame. ?xrshadows=always restores per-frame
      // rendering if the change detection below ever misses something; window.xrShadowRefresh()
      // forces a one-off.
      L.shadow.autoUpdate = wantCast && this._renderer.shadowMap.enabled && this._xrShadowAlways;
      // A light that is pinned castShadow but should not cast would otherwise sample a stale
      // map; drop its contribution to nothing instead.
      L.shadow.intensity = wantCast ? (e._shadowIntensity === undefined ? 1 : e._shadowIntensity) : 0;
      // ON-DEMAND MEANS SOMETHING HAS TO ASK. The light's own contribution to the key is its
      // LOCAL matrix -- the host's transform under _worldGroup -- for the same reason as the
      // scene key: that is the part a world grip does not change.
      if (wantCast && !this._xrShadowAlways) {
        const he = host.matrix.elements;
        const key = _shadowSceneKey + (L.isPointLight ? _worldRotKey : '')
          // A DirectionalLight has no `distance` at all, so this cannot assume a number --
          // it threw the moment a sun was allowed to cast.
          + '#' + type + ',' + (L.distance === undefined ? 0 : L.distance).toFixed(4)
          + ',' + he[12].toFixed(3) + ',' + he[13].toFixed(3) + ',' + he[14].toFixed(3)
          + ',' + he[0].toFixed(3) + ',' + he[5].toFixed(3) + ',' + he[10].toFixed(3)
          + ',' + he[1].toFixed(3) + ',' + he[2].toFixed(3) + ',' + he[6].toFixed(3)
          + ',' + (e._lightConeDeg === undefined ? 35 : e._lightConeDeg)
          + ',' + (e._shadowNear === undefined ? 0 : e._shadowNear);
        if (L.userData._shadowKey !== key) {
          L.userData._shadowKey = key;
          L.shadow.needsUpdate = true;
        }
      }
      // THE SHADOW CAMERA'S NEAR PLANE IS 0.5 METRES BY DEFAULT, AND THAT IS WHY THERE WERE NO
      // SHADOWS. three builds a point light's shadow as PerspectiveCamera(90, 1, 0.5, 500) and
      // a spot's as PerspectiveCamera(50, 1, 0.5, 500). Those are sane defaults for a
      // room-sized scene in metres. They are nonsense here: the sculpt is grip-scaled, and
      // matt's session reported worldScale 0.0041 with the whole view inside far = 1.19m -- so
      // the ENTIRE model sat inside the shadow camera's near plane and the map came back empty.
      // It also explains "the near clip feels like at least 50cm", reported three times: 0.5 is
      // exactly that number.
      //
      // So size the shadow frustum off the geometry's own world-space radius, which follows the
      // grip scale like everything else should. Near is small but not zero -- depth precision is
      // governed by the far/near RATIO, so this keeps it near 100:1 rather than the default's
      // 1000:1 over a range nothing occupies.
      const _sc = L.shadow.camera;
      if (_sc) {
        // NEAR IS SET FROM THE LIGHT'S ACTUAL DISTANCE TO THE SCENE, not from a fraction of
        // its size, because a shadow map's usable precision is governed by the far/near RATIO.
        //
        // This was measured, not reasoned: reading the cube depth map back (compare mode off,
        // sampled as a plain samplerCube) with near 1 / far 1500 gave 255 on every face and
        // 254 on the one containing the occluder. The sphere WAS in the map -- one 8-bit step
        // below the cleared background, because a perspective depth at 1500:1 crushes
        // everything past the near plane into the last fraction of a percent. Nothing can be
        // separated from nothing, so the comparison never reported an occluder. Tightening to
        // near 280 / far 460 on the same scene made the shadow appear immediately.
        //
        // An earlier version of this code set near = _rWorld * 0.01, which fixed three's
        // much-too-large 0.5m default and replaced it with a much-too-small one -- a ~300:1
        // ratio that is exactly this failure.
        //
        // far is not really ours: PointShadowNode re-pins camera.far to light.distance on
        // every face, so the ratio is near vs the light's falloff range.
        // THE FAR PLANE IS NOT OURS AND MUST BE TREATED AS FIXED. LightShadow.updateMatrices
        // re-pins camera.far to light.distance on every update, so whatever we write is
        // overwritten -- and light.distance is the user's Falloff slider.
        //
        // Clamping near against a far WE computed, rather than the one three forces back, is
        // how this produced an INVERTED frustum in matt's session: near 0.948, far 0.516,
        // because the light sat further from the sculpt than the Falloff reached. Nothing can
        // be inside near > far, so the map rendered empty and every sweep of bias, opacity,
        // falloff and world scale did nothing -- there was no frustum to be inside.
        const _far = Math.max(1e-3, (L.distance > 0 ? L.distance : _rWorld * 4));
        const _dToScene = Math.hypot(
          L.position.x - _cWorld.x, L.position.y - _cWorld.y, L.position.z - _cWorld.z);
        // Start just in front of the nearest thing that can cast, but NEVER past half the far
        // plane, so near < far holds however the light is placed. The 64:1 floor keeps the
        // usable depth range wide for a light sitting inside the model, which is where a new
        // one is created and where there is no safe near plane at all.
        //
        // MANUAL OVERRIDE, as a FRACTION of the far plane. The far plane is not ours -- three
        // re-pins it to light.distance, i.e. the Falloff slider -- so the only knob that can be
        // handed over safely is near, and expressing it as a fraction is what makes it useful:
        // shadow map precision is governed by far/near, so this slider IS the precision
        // control. 0 means auto (the fit below). matt asked for this to get something usable
        // while the frustum stays married to Falloff.
        // DEFAULT IS 1% OF THE FAR PLANE, not the geometry fit. matt: "if i set the near clip
        // for shadow to anything basically non-zero, it seems to fit fine... can we just try a
        // default of 1%". The auto fit takes `_dToScene - _rWorld * 1.5`, which overshoots past
        // the caster whenever the light is close to the model and clips it out of the frustum
        // entirely -- the cliff at the top of the slider. A fixed fraction of far cannot do
        // that: it is always a 100:1 range ending at the far plane, wherever the light is.
        // 0 still means the geometry fit, for anyone who wants it.
        const _nearFrac = e._shadowNear === undefined ? 0.01 : e._shadowNear;
        const near = _nearFrac > 0
          ? Math.min(Math.max(_far * _nearFrac, 1e-5), _far * 0.9)
          : Math.min(
            Math.max(_far / 64, _dToScene - _rWorld * 1.5, 1e-5),
            _far * 0.5);
        const far = _far;
        // If the Falloff cannot reach past the model, the far plane cuts through it and the
        // far side simply cannot cast. Say so once rather than leaving it to be discovered.
        if (_dToScene + _rWorld > _far && !this._warnedShadowReach) {
          this._warnedShadowReach = true;
          console.warn('[shadows] Falloff (' + _far.toFixed(3) + ') is shorter than the light\'s'
            + ' distance to the model (' + (_dToScene + _rWorld).toFixed(3) + ') — the shadow'
            + ' frustum cuts through the sculpt. Raise Falloff.');
        }
        if (_sc.isOrthographicCamera) {
          const ext = _rWorld * 1.2;
          _sc.left = -ext; _sc.right = ext; _sc.top = ext; _sc.bottom = -ext;
        }
        if (_sc.near !== near || _sc.far !== far) { _sc.near = near; _sc.far = far; }
        _sc.updateProjectionMatrix();
      }
      L.shadow.bias = 0;
      // normalBias IS IN WORLD UNITS, so it has to follow the grip scale for the same reason
      // the falloff does. 0.15 was tuned at the default scale, where the model's world radius is
      // tens of units; at matt's measured 0.6% scale the model is centimetres across and an
      // unscaled 0.15 would shove every shadow clean off the surface.
      L.shadow.normalBias = (e._shadowNormalBias === undefined ? 0.15 : e._shadowNormalBias) * wscale;
      // RESOLUTION. mapSize reaches the shader as a uniform (reference('mapSize','vec2')), not
      // as compiled-in state, so unlike castShadow this one can change live -- the map is
      // re-allocated by shadowMap.setSize() on the next render. Pulse the map when it moves,
      // or the new size holds a stale render.
      const _mapWant = e._shadowMapSize === undefined ? 512 : e._shadowMapSize;
      if (L.shadow.mapSize.width !== _mapWant) {
        L.shadow.mapSize.width = L.shadow.mapSize.height = _mapWant;
        if (L.shadow.map) { L.shadow.map.dispose(); L.shadow.map = null; }
        L.shadow.needsUpdate = true;
      }
      // SOFTNESS IS IN TEXELS, so the same radius blurs LESS on a bigger map -- raising the
      // resolution would quietly sharpen every shadow in the scene and look like the slider
      // had moved. Scale by the map size so the setting means the same thing at any
      // resolution, with 512 as the reference the numbers were chosen at.
      const _rad = e._shadowRadius === undefined ? 4 : e._shadowRadius;
      L.shadow.radius = _rad * (_mapWant / 512);
      // AND ENOUGH TAPS THAT THE SOFTNESS IS A GRADIENT RATHER THAN A PATTERN. three's own PCF
      // filter takes five samples on a rotated Vogel disk, which is too few to hide the
      // rotation: the penumbra comes out as screen-space dither, worse the wider the radius.
      // filterNode is a supported per-shadow override, so this is not a patch. ?shadowtaps=N
      // to compare, 0 to fall back to three's five.
      if (this._shadowTaps !== 0 && !L.shadow.filterNode) {
        try {
          L.shadow.filterNode = makePCFFilter(this._TSL_GPU, this._shadowTaps || 16);
        } catch (err) {
          console.warn('[shadows] custom PCF filter unavailable, using three\'s 5-tap', err);
          this._shadowTaps = 0;
        }
      }
      // ...AND IT IS REFRESHED HERE, after near/far and the projection are settled: a spot's
      // shadow.matrix is derived from its projection, so refreshing it earlier would build the
      // lookup from the previous frame's frustum.
      // THE MAP'S CONTENTS AND THE WORLD->LIGHT TRANSFORM ARE TWO DIFFERENT THINGS.
      //
      // Suppressing the re-render on a rigid world move is right -- the geometry has not moved
      // relative to the light, so the depth in the map is still true. But `shadow.matrix` is
      // the transform the RECEIVER uses to look that depth up, and three only recomputes it
      // while rendering the map. Leave it alone and it stays pinned to where the light used to
      // be in world space, so the shadow sits still in the room while the sculpt slides
      // through it. matt: "the shadows feel stuck in worldspace relative to the 'real' world in
      // AR, while the single hand grip slides the objects through the shadow." Head movement
      // never touches _worldGroup, which is why that case always looked right.
      //
      // So refresh the lookup transform every frame -- it is matrix maths, not a render -- and
      // keep the expensive part on the change key.
      if (wantCast && L.shadow) {
        if (L.isPointLight) {
          // A point light's shadow matrix is just the translation to light space; the cube
          // lookup direction supplies the rest.
          L.shadow.matrix.makeTranslation(-L.position.x, -L.position.y, -L.position.z);
        } else {
          // THE SHADOW CAMERA'S UP VECTOR MUST FOLLOW THE WORLD, or the map is not invariant
          // under a world rotation and re-rendering is the only thing that hides it.
          //
          // SpotLightShadow.updateMatrices does camera.lookAt(target), and lookAt uses the
          // camera's `up` -- which is world (0,1,0) by default. Position and target both live
          // under _worldGroup and so rotate with it, but `up` does not, so the camera ROLLS
          // about the light axis relative to the geometry and the map's edges slide. matt:
          // "the core shadow felt like it was drifting slightly, but what i assume are the
          // edges of the shadowmap feel like they're misaligning... i should be able to single
          // grip rotate the entire world upside down, and the shadow not flicker, and stay
          // valid." With up rotated by the world, the camera is rigid with the geometry, the
          // map is genuinely invariant, and no re-render is needed for any rigid grip.
          // UP COMES FROM THE LIGHT'S OWN BASIS, not from world up.
          //
          // The aim is the light's local -Z (the target Object3D sits at (0,0,-1) as its
          // child), so the light's local +Y is perpendicular to the aim BY CONSTRUCTION and
          // can never be parallel to it. World up can: a spot rotated -90 on X points straight
          // down, lookAt then has no defined roll, and the camera spins about its own axis --
          // the map's orientation flips frame to frame and the shadow glitches while the world
          // moves. matt hit this immediately by setting the default light rotation to -90 on X:
          // "i'm guessing there's an N and up issue, probably both of those are pointing the
          // same way or are aligned with a world axis, and its spinning around its local axis".
          // Exactly that. Taking up from the light also keeps the rotation-invariance the world
          // up version was for, since the light is under _worldGroup and turns with it.
          L.shadow.camera.up.set(0, 1, 0).applyQuaternion(L.quaternion);
          L.shadow.updateMatrices(L);
        }
      }
    }

    // UNUSED SLOTS GO DARK, they do not leave the scene. Removing one would change the
    // lighting graph, which is the whole thing this pool exists to prevent.
    // An unused slot also stops casting, so the renderer is not drawing shadow maps for
    // seven lights that emit nothing -- but only outside a session, where a recompile costs
    // nothing but a hitch.
    for (const type of [0, 1, 2]) {
      for (let i = used[type]; i < pool[type].length; i++) {
        const L = pool[type][i];
        L.intensity = 0;
        // Same latch as above: intensity is just a number, but castShadow is part of the
        // compiled graph and must not move while a session owns it.
        if (!this._xrGraphFrozen) L.castShadow = false;
        // An UNUSED slot pinned castShadow for the session still renders its shadow map every
        // frame unless this is off -- and a point light's map is a CUBE, six scene renders. A
        // 4/2/1 pool all casting is ~27 shadow passes a frame for lights that emit nothing,
        // which is the real reason shadows looked unaffordable in a session.
        if (L.shadow) { L.shadow.autoUpdate = false; L.shadow.needsUpdate = false; L.shadow.intensity = 0; }
      }
    }

    // NO HIDDEN AMBIENT. There used to be an AmbientLight here, coloured by the
    // environment's SH average and scaled by the Env Intensity slider, as a stand-in until
    // scene.environment carries a real IBL. matt: "is there a default light i can't see or
    // edit? if so, remove it." He is right -- it was the only light in the scene that had no
    // entity, could not be selected, moved or switched off, and quietly set the floor
    // brightness of every render.
    //
    // The consequence is deliberate and should not be smoothed over: with no lights placed,
    // PBR now renders black, and the Env Intensity slider does nothing on this path until the
    // equirect + PMREM swap gives scene.environment something to hold. That is the honest
    // state of an unlit scene, and it makes the missing piece visible rather than disguised.
    if (this._nodeAmbient) {
      this._scene.remove(this._nodeAmbient);
      this._nodeAmbient.dispose && this._nodeAmbient.dispose();
      this._nodeAmbient = null;
    }

    // THE ENVIRONMENT, as a prefiltered IBL rather than a fake ambient. Built once per
    // environment (see EnvIBL) and re-installed when the selection changes; the Env Intensity
    // slider is three's own environmentIntensity, which is what that control should always
    // have been driving.
    // ?noenv=1 / window._noEnv — no scene.environment at all.
    //
    // The bisect put the regression in the environment commits, and the strongest suspect is
    // simply HAVING one: a2c2c032 made an HDR environment the DEFAULT, so from that commit
    // on scene.environment is set, PMREM runs, and every lit material compiles an IBL
    // lookup. Before it, the default was a LogLUV atlas the node renderer cannot read, so
    // scene.environment stayed null and none of that happened.
    //
    // Testing that by checking out old commits is slow and, as this evening proved, easy to
    // confound. This tests it on the CURRENT build instead: one session with it, one
    // without.
    const SPBR = ShaderLib[Enums.Shader.PBR];
    if (window._noEnv || getOptionsURL().noenv) {
      if (this._scene.environment) {
        this._scene.environment = null;
        console.log('[env] disabled (noenv)');
      }
      return;
    }
    // THE ENVIRONMENT GOES ON THE PBR MATERIAL, NOT ON THE SCENE.
    //
    // scene.environment is GLOBAL: three injects an IBL lookup into every material that
    // supports one, including the unlit UI materials, which have no use for it. In an XR
    // session that is fatal -- with it set, matt saw the sculpt and nothing else; setting
    // window._noEnv live in the same session brought the menus, controllers and cursor
    // straight back and only blacked out the sculpt. So the sculpt's own env lookup is
    // fine, and it is the one forced on everything else that breaks.
    //
    // envMap on the single material that wants it keeps the UI materials compiling exactly
    // as they do with no environment at all.
    const env = SPBR && SPBR.environments[SPBR.idEnv];
    if (env && this._nodeEnvId !== SPBR.idEnv) {
      this._nodeEnvId = SPBR.idEnv;
      // NO PLACEHOLDER ENVIRONMENT, AND THE GAP IS REAL AND STILL OPEN.
      //
      // Until this resolves the PBR material has no envMap, and in this app that means no light
      // source at all -- every sculpt shader is custom and three's lights only cast. So the
      // sculpt is black for as long as the .hdr takes to fetch and prefilter: about 70ms on a
      // desktop, a second or so on a headset.
      //
      // Filling it with a flat grey PMREM was tried and does not work: once the material has
      // sampled that texture, swapping in the real one leaves it black PERMANENTLY, with envMap
      // set, envMapIntensity 1 and the right texture bound. Measured as a same-session A/B --
      // without it the sphere lights on the third frame, with it it was still black seven frames
      // later and never recovered. Keeping the PMREMGenerator alive rather than disposing it
      // changed nothing. See EnvIBL.neutralEnvironment, which is kept and unwired.
      installEnvironment(this._THREE_GPU, this._renderer, this._scene, env, (tex) => {
        this._nodeEnvTex = tex;
      });
    }
    const ei = getOptionsURL().envIntensity;
    const gain = Number.isFinite(ei) ? ei : 1.0;
    // Never on the scene.
    if (this._scene.environment) this._scene.environment = null;
    // NO ENVIRONMENT INSIDE AN XR SESSION -- a known, unexplained limitation, not a fix.
    //
    // With the PMREM in use, an immersive session draws the sculpt and nothing else: no
    // menus, no controllers, no cursor, and the UBO flood. Removing it live (window._noEnv)
    // brings them all back. Moving it off scene.environment and onto the PBR material's own
    // envMap changed nothing, which rules out the obvious explanation -- that a scene-wide
    // environment was injecting an IBL lookup into the unlit UI materials. The failing
    // materials are the ones WITHOUT it; the one that samples it is the only thing that
    // draws. Something about that texture being bound at all breaks the rest of the frame,
    // and I have not found what.
    //
    // So VR gets lights and no IBL, desktop keeps the environment, and this is written down
    // rather than left as a mystery for whoever looks next. window._xrEnv = 1 turns it back
    // on in a session to retest.
    // EVERY PBR material, not just the shared one. A textured mesh gets its own variant
    // (NodeMaterials.getFor), and since the IBL lives on the material rather than on
    // scene.environment, a variant left out of this is lit by nothing at all.
    const pbrMats = NodeMaterials.allPBR ? NodeMaterials.allPBR() : [];
    const pbrMat = pbrMats[0] || NodeMaterials.get(Enums.Shader.PBR);
    const _xrNow = !!(this._renderer.xr && this._renderer.xr.isPresenting);
    // ?xrenv=1 as well as window._xrEnv, for the same reason as ?xrshadows: a console global
    // has to be set before the button is pressed, and getting that wrong is indistinguishable
    // from the workaround still being in place. The env being off in a session IS deliberate --
    // it is a workaround, not a bug -- and this is how it gets retested.
    // DEFAULT ON IN A SESSION as of 2026-09-21, for the reason above: a workaround that is on
    // by default is a workaround nobody retests, and the IBL is most of what makes the PBR
    // material look like anything. `?xrenv=0`, or window._xrEnv = false, restores it.
    if (/[?&]xrenv=1/.test(window.location.search)) window._xrEnv = true;
    if (/[?&]xrenv=0/.test(window.location.search)) window._xrEnv = false;
    const wantEnv = this._nodeEnvTex && (!_xrNow || window._xrEnv !== false);
    const nextEnv = wantEnv ? this._nodeEnvTex : null;
    for (let i = 0; i < pbrMats.length; i++) {
      const pm = pbrMats[i];
      if (pm.envMap !== nextEnv) {
        // CHANGING envMap NEEDS dispose(). NOTHING ELSE WORKS.
        //
        // `needsUpdate`, bumping `version`, `envMap.needsUpdate` -- none of them rebuild a node
        // material or rebind its textures. Only dispose() drops the cached build, and the next
        // render makes a new one.
        //
        // Two separate things both need it, and both were measured live rather than reasoned:
        //
        //   null -> texture changes the SHAPE of the graph. NodeMaterial.setupEnvironment only
        //   emits an IBL branch when envMap is set AT BUILD TIME, and a built graph does not grow
        //   a branch it was compiled without. The PMREM takes ~70ms to prefilter, so the PBR
        //   material is ALWAYS built before the environment exists -- it got no IBL branch and
        //   never regained one, which is why envMapIntensity swinging 0 -> 12 moved no pixels.
        //
        //   texture -> texture SHOULD have been free: setupEnvironment reads the map through
        //   materialReference('envMap','texture'), which is a live reference, and that is what I
        //   assumed. It is wrong. With the new PMREM assigned and pm.envMap === the new texture
        //   by uuid, the render did not change at all -- the binding is cached with the build.
        //
        // So: dispose on ANY change. That is a shader rebuild per environment swap, which is a
        // deliberate, occasional user action, and the alternative is a picker that does nothing.
        pm.envMap = nextEnv;
        pm.needsUpdate = true;
        pm.dispose();
        if (pm === pbrMat) console.log('[env] ' + (nextEnv ? 'on (rebuilt)' : 'off (XR)'));
      }
      pm.envMapIntensity = gain;
    }
  }

  getLights() {
    const out = [];
    const ms = this._meshes || [];
    for (let i = 0; i < ms.length; i++) {
      if (ms[i]._isLight && ms[i].isVisible && ms[i].isVisible()) out.push(ms[i]);
    }
    return out;
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
          m._sacGoal = new THREE.Vector3((Math.random() - 0.5) * a, (Math.random() - 0.5) * a, 0);
          m._sacNext = now + (150 + Math.random() * 500) / spd;
          if (!m._sacOff) m._sacOff = m._sacGoal.clone();   // first dart starts where it lands
        }

        // SMOOTHNESS: EASE TOWARD THE DART INSTEAD OF SNAPPING TO IT.
        //
        // An eye SHOULD snap — that is what a saccade is, and it stays the default at 0. But the
        // same primitive at low speed and low amplitude is exactly what an idle head wants, and
        // there the jump is the one thing giving it away. matt: "it could be great for applying
        // to the head itself at a low speed and low amplitude, it just needs to smoothly
        // interpolate rather than jump from pose to pose."
        //
        // SMOOTHNESS IS A TIME CONSTANT, not a per-frame lerp factor. A plain `lerp(x, goal, k)`
        // every frame means something different at 60Hz, 72Hz and 90Hz — the same slider would
        // read as a different amount of smoothing on each headset, and this codebase has paid for
        // that mistake before (see the spring rate note in PhysicsBones). Exponential decay
        // against real elapsed time is rate-independent: halve the frame rate and each step is
        // twice as large, so the motion is identical.
        //
        // At 0 the time constant is 0 and this collapses to an assignment — the old behaviour
        // exactly, not an approximation of it.
        const sm = m._saccadeSmooth ?? 0;
        if (m._sacGoal) {
          const tau = sm * SAC_SMOOTH_TAU_MAX;
          if (tau <= 1e-4) {
            m._sacOff.copy(m._sacGoal);
          } else {
            const dt = Math.min(0.1, (now - (m._sacLast || now)) / 1000);  // clamp a tab-switch
            m._sacOff.lerp(m._sacGoal, 1 - Math.exp(-dt / tau));
          }
        }
        m._sacLast = now;
      } else {
        m._sacOff = null;
        m._sacGoal = null;
        m._sacLast = 0;
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
  // THE SELECTION, MINUS WHAT IS LOCKED -- what may be MOVED, as distinct from what is selected.
  //
  // A locked mesh still selects, still shows its transform fields and still reads as selected in
  // the outliner; what it must not do is move. The padlock only ever gated PICKING, so a locked
  // mesh that was already the selection was dragged by the gizmo exactly as if it were not.
  //
  // A separate accessor rather than a filter inside getSelectedMeshes, because the selection is
  // read for a dozen other purposes -- delete, merge, duplicate, mirror, the outliner's own
  // highlight -- and "what is selected" and "what may move" are different questions. Only the
  // things that move objects ask this one, and they must ALL ask it: the gizmo keeps
  // index-parallel arrays (_startLocal, _editScaleRotInv) against this list, so a site left
  // reading the unfiltered selection would put every index one out.
  getTransformableMeshes() {
    return this._selectMeshes.filter((m) => !m._selectLocked);
  }

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

  // Saccade smoothness, 0..1, as a TIME CONSTANT in seconds at full strength. 0.45s is long
  // enough that a slow head drifts rather than steps, and short enough that an eye set part-way
  // still reads as a flick rather than a glide.
  setSaccadeSmooth(eyeId, v) {
    const eye = this._meshes.find((m) => m.getID() === eyeId);
    if (eye) eye._saccadeSmooth = Math.max(0, Math.min(1, v));
  }

  getSaccadeSmooth(eyeId) {
    const eye = this._meshes.find((m) => m.getID() === eyeId);
    return eye ? (eye._saccadeSmooth ?? 0) : 0;
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

  // ── The mesh outline layer: HOVER in yellow, SELECTION in cyan ──────────────
  //
  // A rig node has a preselection channel and a selection colour of its own. A plain mesh has
  // neither, and cannot easily be given them -- ShaderManager hands out ONE material per shader
  // TYPE, shared by every mesh using it, so there is no per-mesh colour to push a highlight into
  // without teaching all of this app's custom shaders about a tint they do not have.
  //
  // So both states are drawn BESIDE the mesh rather than in it: a wire box on the mesh's own
  // local bounds, parented to its render object so it rides the transform, the parent chain and
  // the pose for free. Depth test off so it reads through the model, and a render order under
  // the rig's (9996+) so it never covers a joint marker or the cursor.
  //
  // THE TWO COLOURS ARE THE RIG'S OWN, and mean the same things they mean there: yellow
  // (0xffd733) is preselection, "what the next press takes"; 0x00ffaa is confirmed selection.
  // matt: "it should maintain the bounding box wireframe, but turn cyan to indicate whats
  // selected." It was cyan then; it is Maya's highlight green now, for the reason recorded on
  // SELECT_COLOR in Skeleton -- and the box has to move with the rig or the two disagree about
  // what selection looks like."
  //
  // Yellow WINS on a mesh that is both, which is also the rig's rule: while you are pointing at
  // something, what the press would do outranks what is already true.
  _makeOutlineBox(color, name) {
    // ONE unit box geometry per outline, placed by its own matrix -- so a different mesh, or the
    // same mesh after a sculpt stroke changed its bounds, is a matrix write rather than a
    // geometry rebuild.
    const box = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color, depthTest: false, depthWrite: false, transparent: true, opacity: 0.9 }));
    box.name = name;
    box.matrixAutoUpdate = false;
    box.frustumCulled = false;
    box.renderOrder = 9995;
    box.isPickable = false;
    // AND ACTUALLY UNPICKABLE. `isPickable` is this app's flag and three has never heard of it;
    // three's own raycast walks children recursively regardless. These boxes hang off real
    // meshes, so the only reliable way to keep them out of every raycast is to give them no
    // raycast at all.
    box.raycast = function () {};
    return box;
  }

  // Fit `box` to `mesh`'s local bounds and hang it off the mesh's render object.
  _fitOutlineBox(box, mesh) {
    const tm = mesh && mesh.getThreeMesh && mesh.getThreeMesh();
    if (!tm) { box.visible = false; return false; }
    const b = mesh.getLocalBound();
    const sx = Math.max(b[3] - b[0], 1e-6);
    const sy = Math.max(b[4] - b[1], 1e-6);
    const sz = Math.max(b[5] - b[2], 1e-6);
    box.matrix.makeScale(sx, sy, sz);
    box.matrix.setPosition((b[0] + b[3]) * 0.5, (b[1] + b[4]) * 0.5, (b[2] + b[5]) * 0.5);
    box.matrixWorldNeedsUpdate = true;
    if (box.parent !== tm) tm.add(box);
    box.visible = true;
    return true;
  }

  setMeshHoverHighlight(id) {
    const next = (id == null) ? -1 : id;
    if (this._meshHoverId === next) return;   // no work unless the answer moved
    this._meshHoverId = next;
    this._updateMeshHoverHighlight();
    // The hovered mesh drops its cyan box while yellow is on it, and takes it back on the way
    // out — so the swap has to happen with the hover, not only on a selection change.
    this._updateMeshSelectionBoxes(true);
    this.render();
  }

  _updateMeshHoverHighlight() {
    const id = this._meshHoverId;
    const mesh = (id != null && id >= 0) ? this._meshes.find((m) => m.getID() === id) : null;
    if (!mesh) { if (this._meshHoverBox) this._meshHoverBox.visible = false; return; }
    if (!this._meshHoverBox) this._meshHoverBox = this._makeOutlineBox(0xffd733, 'mesh_hover_outline');
    this._fitOutlineBox(this._meshHoverBox, mesh);
  }

  // The cyan boxes, one per selected mesh.
  //
  // Driven off a SIGNATURE rather than a hook, because the selection is changed from more places
  // than any one of them knows about: setOrUnsetMesh, undo and redo, a delete, the frame groups,
  // and tests poking `_selectMeshes` directly. A cheap string compare once every few frames is
  // honest about that, where a hook on the one obvious caller would quietly miss the rest.
  // `force` re-reads even when the signature has not moved, for the hover swap above.
  _updateMeshSelectionBoxes(force) {
    if (!this._meshSelBoxes) this._meshSelBoxes = new Map();
    // THE OUTLINE IS A SELECTION AFFORDANCE, SO IT BELONGS TO THE SELECTION TOOLS. matt: "the box
    // highlight on meshes that is on by default, i think that should only be visible for the
    // select and grab tool, it should be hidden otherwise." Which is right: while you are
    // sculpting, a cyan box around the thing you are sculpting tells you nothing you did not
    // already know, and sits between your eye and the surface.
    //
    // The YELLOW hover box needs no gate of its own -- only Grab and Select ever set it, and
    // SculptManager already clears it on the way out of both. This is about the cyan one.
    //
    // NO HOOK ON THE TOOL CHANGE, deliberately, and none is needed: the signature below is built
    // from the boxes that should exist, so dropping the selection to empty when the tool is
    // wrong IS a signature change, and the every-fourth-frame pass picks it up like any other.
    const _tool = this._sculptManager ? this._sculptManager.getToolIndex() : -1;
    const _selTool = _tool === Enums.Tools.GRAB || _tool === Enums.Tools.SELECT;
    const on = Skeleton.displayFlag('meshHover') && _selTool;
    // Rig nodes are excluded: a selected joint or pin already turns cyan through the rig's own
    // markers, and a second cyan marker around the same thing says nothing extra.
    const sel = on ? (this._selectMeshes || []).filter(
      (m) => m && !m._isBone && !m._isPinTarget && m.getID() !== this._meshHoverId) : [];
    const sig = sel.map((m) => m.getID()).join(',');
    if (!force && sig === this._meshSelBoxSig) return;
    this._meshSelBoxSig = sig;

    const live = new Set();
    for (const mesh of sel) {
      const id = mesh.getID();
      live.add(id);
      let box = this._meshSelBoxes.get(id);
      if (!box) {
        box = this._makeOutlineBox(0x00ffaa, 'mesh_select_outline');
        this._meshSelBoxes.set(id, box);
      }
      this._fitOutlineBox(box, mesh);
    }
    for (const [id, box] of this._meshSelBoxes) {
      if (live.has(id)) continue;
      if (box.parent) box.parent.remove(box);
      this._meshSelBoxes.delete(id);
    }
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
  // `opts.silent` performs the reparent WITHOUT pushing its own undo entry, for callers that
  // wrap a whole topology edit — split, dissolve — in one step. A split that undid in three
  // presses would be worse than no undo at all, because the middle state is a rig nobody built.
  setMeshParent(childId, parentId, opts) {
    const child = this._meshes.find((m) => m.getID() === childId);
    if (!child) { console.warn('[parent] no child', childId); return; }
    const parent = (parentId == null) ? null : this._meshes.find((m) => m.getID() === parentId);
    // Reject cycles: walk parent's ancestor chain — if child is up there, refuse.
    for (let p = parent; p; p = p._parentMesh) {
      if (p === child) { console.warn('[parent] refused (would create a cycle)'); return; }
    }
    // ALREADY THERE means BOTH sides agree — the logical parent AND the three-side one.
    //
    // Checking only `_parentMesh` was wrong in exactly one case, and it is the case that
    // matters: `removeMeshSilent` does not clear `_parentMesh`, so a joint pulled out of the
    // scene still claims its old parent. Restoring it then hit this early return, the three
    // mesh was never re-attached to the parent's, and the saved LOCAL matrix was applied to a
    // mesh sitting under the world group — so the joint landed at its local coordinates read as
    // world ones. In a rig with no bound mesh the scene unit is the joint EXTENT, so one joint
    // in the wrong place resized every marker in the skeleton. matt measured it: the unit went
    // 60.52 to 164.75 across an undo while every joint's own matrix scale stayed identical.
    const _curTM = child.getThreeMesh && child.getThreeMesh();
    const _wantTM = parent ? parent.getThreeMesh() : this._worldGroup;
    if (child._parentMesh === (parent || null) && _curTM && _curTM.parent === _wantTM) return;

    // EVERYTHING THIS TOUCHES, CAPTURED FIRST, SO IT IS ONE UNDO.
    //
    // A reparent had no undo entry at all, which is most of why an accidental one "exploded":
    // there was no way back from it. matt: "i've accidentally tried it a few times and things
    // explode, it should be a stable operation."
    const before = {
      parent: child._parentMesh || null,
      matrix: mat4.clone(child.getMatrix()),
      rest: child._ikRest ? mat4.clone(child._ikRest) : null,
    };

    const apply = (toParent, localMatrix, restMatrix) => {
      const childTM = child.getThreeMesh();
      const dstTM   = toParent ? toParent.getThreeMesh() : this._worldGroup;
      childTM.updateWorldMatrix(true, false);
      dstTM.updateWorldMatrix(true, false);
      dstTM.attach(childTM);                       // reparent, preserve world transform
      childTM.matrixAutoUpdate = false;
      child._parentMesh = toParent || null;
      if (localMatrix) {
        // Undo path: restore the exact local matrix, since `attach` only preserves the world
        // transform and the world may have moved since.
        mat4.copy(child.getMatrix(), localMatrix);
        Skeleton.syncThree(child);
      } else {
        child.setMatrix(childTM.matrix.elements); // new local-to-parent → SculptXR matrix
      }
      child._ikRest = restMatrix ? mat4.clone(restMatrix) : null;
      // THE BEND REFERENCE IS A FACT ABOUT THE REST SHAPE, which just changed under it.
      child._boneBendRef = null;
      // The solver caches joint and pin transforms; a hierarchy change invalidates both, and a
      // stale cache is the difference between a reparent and a rig that tears itself apart on
      // the next solve.
      IKSolver.syncJointCache?.(this);
      IKSolver.syncPinCache?.(this);
      Skeleton.updateVisuals?.(this);
      Skeleton.refreshOutliner?.(this);
      this.render();
    };

    // THE REST POSE HAS TO MOVE WITH IT, and this is the bug that actually detonates.
    //
    // `_ikRest` is the joint's LOCAL matrix at rest — relative to its parent. `attach` rewrites
    // the local matrix to preserve the world transform, and left `_ikRest` expressed in the OLD
    // parent's space. Every solve calls seedFromRest, which copies `_ikRest` straight back into
    // the local matrix: the joint is slammed to a transform that meant something under a parent
    // it no longer has. That is the explosion, and it arrives on the next solve rather than on
    // the reparent, which is why it never looked like the reparent's fault.
    //
    // The same change is applied to rest as to the live matrix: D = inv(newParentWorld) *
    // oldParentWorld, the delta `attach` just applied. Exact while the rig is at rest, and
    // consistent either way — rest and current keep their relationship, which is the property
    // that stops the tearing.
    const restBefore = child._ikRest;
    let restAfter = null;
    if (restBefore) {
      const oldW = new THREE.Matrix4();
      const newW = new THREE.Matrix4();
      const oldP = child._parentMesh ? child._parentMesh.getThreeMesh() : this._worldGroup;
      const newP = parent ? parent.getThreeMesh() : this._worldGroup;
      oldP.updateWorldMatrix(true, false); newP.updateWorldMatrix(true, false);
      oldW.copy(oldP.matrixWorld);
      newW.copy(newP.matrixWorld).invert().multiply(oldW);
      const R = new THREE.Matrix4().fromArray(restBefore).premultiply(newW);
      restAfter = mat4.clone(R.elements);
    }

    apply(parent, null, restAfter);
    const after = {
      parent: parent || null,
      matrix: mat4.clone(child.getMatrix()),
      rest: child._ikRest ? mat4.clone(child._ikRest) : null,
    };
    if (!opts || !opts.silent) {
      this.getStateManager?.()?.pushStateCustom?.(
        () => apply(before.parent, before.matrix, before.rest),
        () => apply(after.parent, after.matrix, after.rest),
        false, 'Set Parent');
    }
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
  // How long the transform readouts must hold still before the panel is worth rasterising.
  // Long enough to cover a continuous drag, short enough that letting go feels immediate.
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
    // REPAINT ON SETTLE, NOT DURING THE DRAG.
    //
    // These readouts change on EVERY frame of a grab or a pose, so `changed` was true for the
    // whole gesture and the main panel was asked to repaint every fourth frame throughout it --
    // ~18 requests a second, rate-limited down to ~5 actual rasterises a second, each of them a
    // clone, a serialise, an encode and a decode of the whole panel. It was the most-named cause
    // in matt's trace, by a distance:
    //
    //   caused by: SculptGL._syncOutlinerTransformFields 1   (sampled 1 in 8)
    //
    // The DOM is still written every tick, so the numbers are correct the moment anything paints.
    // What is deferred is the RASTERISE, until the values have been still for a beat -- the same
    // bargain as the existing slider-drag suppression, which does not repaint mid-drag either.
    if (changed) {
      this._xfSettleAt = performance.now();
      this._xfRepaintPending = true;
    } else if (this._xfRepaintPending
               && performance.now() - (this._xfSettleAt || 0) > XF_SETTLE_MS) {
      this._xfRepaintPending = false;
      this._mainMenuPanel?.markDirty?.();
    }
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

  // A HUMAN FIGURE, from MakeHuman's CC0 base mesh. Async because the geometry is a fetched
  // asset rather than a procedural primitive — see drawables/HumanBase.js for the provenance.
  //
  // Marked `isQuad` like the grids: it is 13,378 quads of authored topology, and that is the
  // whole point of it. Sculpting it destroys nothing — the quads survive subdivision — so it
  // doubles as a retopology target for a head or body sculpted from a sphere.
  async addHumanBase() {
    try {
      await HumanBase.load();
    } catch (e) {
      console.error('[humanbase] could not load the base mesh', e);
      if (window.screenLog) window.screenLog('Base mesh failed to load', 'red');
      return null;
    }
    const mesh = new Multimesh(HumanBase.build(this._gl));
    mesh.normalizeSize();
    mesh._typeName = 'Human';
    mesh.isQuad = true;
    return this._addPrimitive(mesh);
  }

  // PRIMITIVES ARRIVE WITH A SCALE ALREADY ON THEM, AND SHOULD NOT.
  //
  // `normalizeSize` fits a new mesh to the scene by writing a scale into its MATRIX rather than
  // into its vertices, and several creators then multiply that by another 0.7 for good measure —
  // so every primitive starts life with an arbitrary non-unit scale showing in the transform
  // fields, and any later "scale to 1" moves it. matt: "i notice all the default primitives have
  // odd scales. make them all be baked to have a scale of 1 after being instantiated."
  //
  // Baked AFTER the add, because bakeScale finds its mesh by id in the scene list, and it folds
  // the scale into the geometry so nothing moves on screen — the object is identical and its
  // scale reads 1.
  //
  // NOT DONE IN addNewMesh, which is the tempting single point: that path also takes duplicates,
  // imports and the rig's joint locators, and a joint's scale is deliberate — createJoint writes
  // one to size the pick sphere. Baking there would flatten it.
  _addPrimitive(mesh) {
    const added = this.addNewMesh(mesh);
    this.bakeScale(mesh.getID());
    return added;
  }

  addGrid3x3() {
    var mesh = new Multimesh(Primitives.createPlaneGrid(this._gl, 3, 3));
    mesh.normalizeSize();
    mat4.scale(mesh.getMatrix(), mesh.getMatrix(), [0.7, 0.7, 0.7]);
    mesh._typeName = "Grid3x3";
    mesh.isQuad = true; 
    return this._addPrimitive(mesh);
  }

  addGrid() {
    var mesh = new Multimesh(Primitives.createPlaneGrid(this._gl, 4, 4));
    mesh.normalizeSize();
    mat4.scale(mesh.getMatrix(), mesh.getMatrix(), [0.7, 0.7, 0.7]);
    mesh._typeName = "Grid4x4";
    mesh.isQuad = true; 
    return this._addPrimitive(mesh);
  }

  addCube() {
    var mesh = new Multimesh(Primitives.createCube(this._gl));
    mesh.normalizeSize();
    mat4.scale(mesh.getMatrix(), mesh.getMatrix(), [0.7, 0.7, 0.7]);
    this.subdivideClamp(mesh, true);
    mesh._typeName = "Cube";
    mesh.isQuad = true; // Cube is quads
    return this._addPrimitive(mesh);
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

      // 1b: give the empty grid a real coordinate frame so we can sketch into it.
      // Grid CENTERED at the world origin (offset = -size/2) and the worker matches
      // (VoxelState uses _min = -size/2, step = size/(res-1)). With this, the worker
      // edit centre == the world point we project a stroke onto. mesh.getMatrix() is
      // the cell->world grid matrix (translate(offset) * scale(step)).
      const RES = 128, SIZE = 200;
      const stepW = SIZE / (RES - 1);
      const half  = SIZE * 0.5;
      voxelTool._res  = RES;
      voxelTool._size = SIZE;
      voxelTool._step = stepW;
      voxelTool._min  = vec3.fromValues(-half, -half, -half);
      voxelTool._max  = vec3.fromValues(half, half, half);
      mat4.identity(voxelTool._gridMatrix);
      voxelTool._gridMatrix[0] = stepW; voxelTool._gridMatrix[5] = stepW; voxelTool._gridMatrix[10] = stepW;
      voxelTool._gridMatrix[12] = -half; voxelTool._gridMatrix[13] = -half; voxelTool._gridMatrix[14] = -half;
      mat4.invert(voxelTool._invGridMatrix, voxelTool._gridMatrix);
      if (voxelTool._voxelMesh) mat4.copy(voxelTool._voxelMesh.getMatrix(), voxelTool._gridMatrix);

      if (voxelTool._worker) {
        voxelTool._worker.postMessage({ type: 'INIT', res: RES, size: SIZE, min: [-half, -half, -half] });
      }
    }
    
    window._activeToolTab = 2;
    
    return voxelTool ? voxelTool._voxelMesh : null;
  }

  // Built from the ALL-QUAD cylinder, not Primitives.createCylinder -- that one is triangles
  // with a pole at the centre of each cap, which Reverse (Reversion.computeReverse) can never
  // walk back down.
  //
  // ONE level, not subdivideClamp's ~50k faces like the cube and sphere: here the low-poly
  // base IS the shape, and Subdivide adds levels on demand. LINEAR, so the wall stays a true
  // cylinder instead of Catmull-Clark rounding the rims into a pill, and Reverse lands back
  // on the clean low-poly base.
  addCylinder() {
    var mesh = new Multimesh(Primitives.createCylinderQuad(this._gl, 0.5, 1.0, 32, 2));
    mesh.normalizeSize();
    mat4.scale(mesh.getMatrix(), mesh.getMatrix(), [0.7, 0.7, 0.7]);
    Subdivision.LINEAR = true;
    mesh.addLevel();
    Subdivision.LINEAR = false;
    mesh._typeName = "Cylinder";
    mesh.isQuad = true;
    return this._addPrimitive(mesh);
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
    this._addPrimitive(mesh);
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
  // PUT IT BACK WHERE IT CAME FROM, which for a parented mesh is not the world group.
  //
  // This added to `_worldGroup` unconditionally, the mirror image of the bug `detachMeshThree`
  // below was written to fix. A mesh's render object lives under its PARENT's render object and
  // its matrix is LOCAL TO THAT PARENT — so re-adding it to the world group leaves the matrix
  // being read as world coordinates, and the object turns up somewhere it has no business being.
  // Small local offset plus a head-sized parent usually means "inside the head", which from the
  // outside is indistinguishable from not being restored at all. matt: parented an eye under a
  // head, deleted it by accident, undid, "can see it in the outliner, but not in the viewport."
  //
  // This was KNOWN and fixed only for rigging — see Skeleton.healGraph, which repairs it for
  // joints and says so explicitly, on the reasoning that the parenting assumption lived in the
  // rig. It does not any more: parenting is an ordinary scene operation on ordinary meshes, so
  // the repair belongs in the shared add/remove path where every caller gets it.
  //
  // Falls back to the world group when the parent is gone — deleting a parent and a child
  // together and undoing must not attach the child to a detached object.
  attachMeshThree(mesh) {
    var t = mesh && mesh.getThreeMesh && mesh.getThreeMesh();
    if (!t) return;
    var p = mesh._parentMesh;
    var pt = p && this._meshes.includes(p) && p.getThreeMesh && p.getThreeMesh();
    var target = pt || this._worldGroup;
    if (target) target.add(t);
  }

  // TAKE IT OUT OF WHEREVER IT ACTUALLY IS.
  //
  // This removed from `_worldGroup` unconditionally -- but a PARENTED mesh's render object
  // lives under its PARENT's render object, and Object3D.remove() on something that is not a
  // child is a silent no-op. So nothing parented was ever detached: deleted joints, deleted
  // weight capsules and a reset scene all left their render objects in the graph, still
  // drawing. matt: "if i delete them they still draw in the viewport, if i reset the scene they
  // still draw."
  //
  // It went unnoticed for as long as it did because joint locators used to be `visible = false`,
  // which hid their whole subtree -- so the leaked objects were invisible leaks. Fixing that
  // (v3.20.231) is what made this one visible, not what caused it.
  detachMeshThree(mesh) {
    var t = mesh && mesh.getThreeMesh && mesh.getThreeMesh();
    if (!t) return;
    if (t.parent) { t.parent.remove(t); return; }
    var target = this._worldGroup || this._scene;
    if (target) target.remove(t);
  }

  // `skipUndoState` for a caller that is pushing its OWN combined entry covering this add.
  // The remesh is the case: it replaces one mesh with another, and two entries for one action
  // means two undos to get back -- matt: "to undo requires 2 steps; one to delete the remeshed
  // object, the other to restore the original mesh." See SculptVoxel.bakeToMesh.
  addNewMesh(mesh, skipUndoState) {
    if (mesh?.setShaderType && !mesh._isBone && !mesh._isNull && !mesh._isReference) {
      mesh.setShaderType(getOptionsURL().shader);
      mesh.setFlatShading?.(getOptionsURL().flatshading);
    }
    this._meshes.push(mesh);
    if (!mesh._permanentStaticLabel) {
      mesh._permanentStaticLabel = (mesh._typeName || "Mesh") + " " + this._meshes.length;
    }
    this.attachMeshThree(mesh);
    // Build/attach the overlay only after the Three.js mesh is in the scene graph. When this
    // happened earlier the saved flag was true, but the orphaned line object did not become
    // visible until a subdivision change rebuilt it.
    if (!mesh._isBone && !mesh._isNull && !mesh._isReference) {
      mesh.setShowWireframe?.(getOptionsURL().wireframe);
    }
    if (!skipUndoState) this._stateManager.pushStateAdd(mesh);
    this.setMesh(mesh);


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


    return newMesh;
  }

  loadScene(fileData, fileType) {
    // A LOAD DISMISSES THE FILES MENU. Opening a scene is the last thing you want from that menu,
    // and it stayed up over the thing it had just loaded. matt: "if i use the file menu to open a
    // file, it leaves the file menu open after load."
    //
    // HERE rather than on the button, because the button only opens an OS picker: closing there
    // would dismiss the menu before the picker resolves, and dismiss it for nothing when the
    // picker is cancelled. Every route in — Open, Import, a browser save, a drop — arrives at this
    // one function, so one line covers them all.
    try { this._mainMenuPanel?.closeMenu?.(); } catch (_) {}
    // GLB TAKES THE ASYNC ROUTE. Every other importer here is a synchronous parse of an array we
    // already hold; GLTFLoader is not, because a glb may carry Draco or quantized meshes whose
    // unpacking is the loader's job. So this branch finishes the load in a callback and returns
    // nothing, rather than joining the switch below.
    //
    // (This used to be a refusal: the app EXPORTS glb, so getFileType answered 'glb' for a file
    // nothing could open and the load ended in silence. matt: "i tried loading a glb and obj back
    // into sculptxr, both just silently return nothing, no error on the console.")
    if (fileType === 'glb' || fileType === 'gltf') {
      Import.importGLTF(fileData, this._gl, (meshes, stats) => {
        if (!meshes || !meshes.length) {
          const msg = 'Nothing to import from that ' + fileType.toUpperCase() + ' — no meshes in it.';
          console.warn('[load] ' + msg);
          if (window.screenLog) window.screenLog(msg, 'yellow');
          return;
        }
        // NOMAD'S UNITS ARE NOT OURS, and the live link has always known it: every mesh that
        // arrives over the wire is scaled by `_nomadScale` (50 by default) on its way in. A glb
        // exported from the same Nomad scene is in those same units, so it needs the same
        // conversion -- without it the character lands at a fiftieth of its size and everything
        // measured in scene units (brush radius, bone width, the grid) is wrong against it.
        // matt: "nomad link seems to bring things in at an appropriate scale, while the glb
        // import is tiny."
        //
        // Keyed on the GENERATOR, not applied to everything: a glb from Blender or Maya is in
        // metres and is nobody's business to rescale. One option (`nomadScale`) governs both
        // routes, so tuning it cannot make the link and the importer disagree.
        const nomad = /nomad/i.test(stats.generator || '');
        const s = nomad ? (this._nomadScale || 1) : 1;
        if (s !== 1) {
          // Pre-multiplied, exactly as _applyNomadMatrix does it: scale THEN the node's own
          // placement, so the conversion scales the positions as well as the geometry.
          const S = mat4.create();
          mat4.scale(S, S, [s, s, s]);
          for (let i = 0; i < meshes.length; i++) {
            const m = meshes[i].getMatrix();
            mat4.multiply(m, S, m);
          }
        }
        this.addImportedMeshes(meshes);
        // SAID OUT LOUD, because the interesting part of this import is what it RECOVERED, and
        // none of it is visible by looking: quads restored from a format with no quads, and
        // seam vertices welded back into one surface. Both are silent when they go wrong —
        // the model simply sculpts badly a week later.
        const msg = 'Imported ' + stats.meshes + ' object(s), ' + stats.verts + ' verts'
          + (s !== 1 ? ', x' + s + ' ' + (stats.generator || 'source') + ' units' : '')
          + (stats.quads ? ', ' + stats.quads + ' quads recovered'
              + (stats.ngon ? ' (FB_ngon declared)' : ' (fan-encoded)') : ' (all triangles)')
          + (stats.merged ? ', welded ' + stats.merged + ' split verts' : '')
          + (stats.uvs ? ', ' + stats.uvs + ' with UVs' : ', no UVs')
          + (stats.vertexColours ? ', ' + stats.vertexColours + ' with vertex colours' : '')
          + (stats.perVertexMaterial ? ', ' + stats.perVertexMaterial + ' with per-vertex rough/metal' : '')
          // Said because neither has anywhere to go yet and both change how the model looks:
          // a transmissive material is the glass eye, and a texture is the thing the UVs are for.
          + (stats.textured ? ', ' + stats.textured + ' with colour maps' : '')
          + (stats.roughMetalMapped ? ', ' + stats.roughMetalMapped + ' with metal/rough maps' : '')
          + (stats.normalMapped ? ', ' + stats.normalMapped + ' with normal maps' : '')
          + (stats.transmissive ? ', ' + stats.transmissive + ' transmissive' : '');
        console.log('[load] ' + msg);
        if (window.screenLog) window.screenLog(msg, 'lime');
        if (this._showToolToast) this._showToolToast('Imported ' + stats.meshes + ' object(s)');
        this.render();
      }, (err) => {
        const msg = 'Could not read that ' + fileType.toUpperCase() + ': ' + (err && err.message ? err.message : err);
        console.error('[load] ' + msg);
        if (window.screenLog) window.screenLog(msg, 'red');
        if (this._showToolToast) this._showToolToast('Could not read ' + fileType.toUpperCase());
      });
      return;
    }

    var newMeshes;
    if (fileType === 'obj') newMeshes = Import.importOBJ(fileData, this._gl);
    else if (fileType === 'sgl') newMeshes = Import.importSGL(fileData, this._gl, this);
    else if (fileType === 'stl') newMeshes = Import.importSTL(fileData, this._gl);
    else if (fileType === 'ply') newMeshes = Import.importPLY(fileData, this._gl);

    if (newMeshes.length === 0) {
      return;
    }

    return this.addImportedMeshes(newMeshes, (added) => {
      // Reconstruct frame-group structure (SR + voxel frames) now that the meshes are in
      // the scene — deserialize needs them in _meshes for setMeshParent/getMeshes.
      // Scene hierarchy + bones. Runs BEFORE the frame-group restore: this block covers
      // hand-built parenting (rigs, nulls) and deliberately skips FrameGroup's own
      // children, so the two never reparent the same mesh.
      if (fileType === 'sgl') Skeleton.deserialize(fileData, added, this);

      // Textures: the images and the material scalars. Last of the restores because it is the
      // only one that finishes ASYNCHRONOUSLY -- decoding an image is -- so the maps land a
      // frame or two after everything else is already standing.
      if (fileType === 'sgl') TextureIO.deserialize(fileData, added, THREE);

      if (fileType === 'sgl' && this._frameGroup) {
        try { this._frameGroup.deserialize(fileData, added); }
        catch (e) { console.error('[FrameGroup] import restore failed', e); }
      }
      if (fileType === 'sgl') this.getGui?.()?._ctrlTimeline?.framePlaybackRange?.();
    });
  }

  /**
   * Take freshly built meshes (from a file import or the Nomad link), wrap and
   * initialise them, put them in the scene, and commit one undo step.
   * `beforeCommit` runs after the meshes are in `_meshes` but before the undo
   * state is pushed, for importers that need to restore extra structure.
   */
  addImportedMeshes(newMeshes, beforeCommit, opts) {
    opts = opts || {};
    var nbNewMeshes = newMeshes.length;
    if (nbNewMeshes === 0) return;

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
      // The albedo map rides on the WRAPPER too: the renderer asks the Multimesh for it, and an
      // importer can only set it on the level it built. Same reason the label is copied here.
      if (innerMesh._albedoMap && mesh.setAlbedoMap) mesh.setAlbedoMap(innerMesh._albedoMap);
      if (innerMesh._transmission && mesh.setTransmission) mesh.setTransmission(innerMesh._transmission);
      if (innerMesh._normalMap && mesh.setNormalMap) {
        mesh.setNormalMap(innerMesh._normalMap, innerMesh._normalScale);
      }
      if (innerMesh._roughMetalMap && mesh.setRoughMetalMap) {
        mesh.setRoughMetalMap(innerMesh._roughMetalMap, innerMesh._roughFactor, innerMesh._metalFactor);
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

    // Linked meshes carry Nomad's own transforms and arrive ONE AT A TIME, so
    // normalising would fit each object to the view separately and scatter the
    // scene. Their placement is Nomad's to decide.
    if (this._autoMatrix && !opts.keepTransform) {
      this.normalizeAndCenterMeshes(newMeshes);
    }

    if (beforeCommit) beforeCommit(newMeshes);
    // Imported files may carry per-object shader choices from the old model. Shading is now a
    // viewport preference, so once hierarchy flags are restored, reapply the global mode to all
    // ordinary meshes while leaving bones, pins and reference images on their own shaders.
    getOptionsURL.setGlobalShader(this, getOptionsURL().shader);
    getOptionsURL.setGlobalFlatShading(this, getOptionsURL().flatshading);
    getOptionsURL.setGlobalWireframe(this, getOptionsURL().wireframe);

    this._stateManager.pushStateAdd(newMeshes);
    this.setMesh(meshes[meshes.length - 1]);
    // Keep the restored viewpoint if the file carried camera framing (v11+); otherwise
    // auto-frame the loaded meshes.
    // Live link updates must not move the view: a mesh refresh can arrive at any
    // moment, and re-framing mid-sculpt lurches the world (badly so in a headset).
    if (this._loadedCameraFraming) this._loadedCameraFraming = false;
    else if (!opts.keepCamera) this.resetCameraMeshes(newMeshes);
    this._camera.optimizeNearFar(this.computeBoundingBoxScene());
    this._refreshDesktopCameraProjection();
    return newMeshes;
  }

  /**
   * The Nomad Link client, created on first use. Meshes Nomad sends land in the
   * scene as ordinary objects, one undo step each.
   */
  getNomadLink() {
    if (!this._nomadLink) {
      this._nomadLink = new NomadLink();
      this._nomadLink.onMesh = (decoded) => {
        // A mesh we already pulled comes back as a REFRESH, not a second copy.
        // Remove-then-add is two undo steps rather than one; that is deliberate,
        // since the alternative is a custom state that has to re-attach the old
        // object's Three.js side by hand.
        var previous = this.findNomadMesh(decoded.meshId);
        if (previous) {
          this.removeMeshes([previous]);
          this._stateManager.pushStateRemove([previous]);
        }

        // Keep the view where it is, unless this is the first thing to arrive —
        // then framing it is the helpful thing to do.
        var isFirst = this._meshes.length === 0;
        var added = this.addImportedMeshes(
          [NomadImport.buildMesh(decoded, this._gl)], null,
          { keepTransform: true, keepCamera: !isFirst });
        if (added && added[0]) {
          // Nomad's placement, applied verbatim. Without this every object lands at
          // the origin unscaled — invisible on the head (its matrix is identity) but
          // obvious on anything positioned, like the eyes.
          this._applyNomadMatrix(added[0], decoded.worldMatrix);
          // Stamp the wrapper too — findNomadMesh searches _meshes, which holds
          // Multimeshes, and addImportedMeshes only carries the label across.
          added[0]._nomadMeshId = decoded.meshId;
          added[0]._nomadGeometryId = decoded.geometryId;
          // What Nomad believes the topology is; a later mismatch means our edits
          // changed it and a delta would be meaningless.
          added[0]._nomadVertexCount = decoded.nbVertices;
        }
        this.render();
      };

      this._nomadLink.onDelta = (delta) => this.applyNomadDelta(delta);

      this._nomadLink.onInstance = (header) => this.addNomadInstance(header);

      this._nomadLink.onObjectDelete = (nomadMeshId) => {
        var mesh = this.findNomadMesh(nomadMeshId);
        if (!mesh) return;
        this.removeMeshes([mesh]);
        this._stateManager.pushStateRemove([mesh]);
        this.render();
      };

      this._nomadPendingSends = {};
      this._nomadLink.onAck = (header) => {
        // Adopt the id Nomad filed the mesh under, so later edits address the same
        // object. Keyed by request id: with live sending on there can be several
        // sends outstanding, and a single slot would misfile the acks.
        var sent = this._nomadPendingSends[header.request_id];
        delete this._nomadPendingSends[header.request_id];
        if (sent && header.mesh_id) {
          sent._nomadMeshId = header.mesh_id;
          var inner = sent.getCurrentMesh ? sent.getCurrentMesh() : null;
          if (inner) inner._nomadMeshId = header.mesh_id;
        }
      };
    }
    return this._nomadLink;
  }

  /**
   * A second (third, …) placement of geometry we already hold — Nomad's eyes,
   * mirror-modifier halves and so on. Returns false when the geometry has not
   * arrived yet, which makes the link fetch it.
   *
   * Uses SculptXR's own linked instances (shareData): the occurrences share one
   * _meshData, so sculpting any of them updates them all, which is what being an
   * instance means on both sides.
   */
  addNomadInstance(header) {
    var geometryId = header.geometry_id;
    if (!geometryId) return false;

    var source = null;
    for (var i = 0; i < this._meshes.length; ++i) {
      if (this._meshes[i]._nomadGeometryId === geometryId) { source = this._meshes[i]; break; }
    }
    if (!source) return false;

    // Built exactly like instanceSelection(): a bare MeshStatic, NOT wrapped in a
    // Multimesh. shareData() already runs init()/initRender() on it, and wrapping
    // it again produced an object that never rendered.
    var inner = source.getCurrentMesh ? source.getCurrentMesh() : source;
    var instance = new MeshStatic(inner.getGL());
    instance.shareData(inner);
    instance._permanentStaticLabel = header.name || 'Instance';
    instance._nomadMeshId = header.mesh_id;
    instance._nomadGeometryId = geometryId;
    instance._nomadVertexCount = inner.getNbVertices();
    instance._nomadWorldMatrix = header.world_matrix;
    this._applyNomadMatrix(instance, header.world_matrix);

    this.addNewMesh(instance);
    this._refreshLinkOutliner?.();
    this.render();
    return true;
  }

  /**
   * Apply one Nomad stroke to the mesh it belongs to. Returns false when it
   * cannot be applied, which makes the link fetch the whole mesh instead:
   *  - we do not have that object (never pulled, or deleted since)
   *  - the vertex count disagrees, so our topology has diverged (a remesh, a
   *    weld, a subdivide) and the incoming indices no longer mean anything
   */
  applyNomadDelta(delta) {
    var wrapper = this.findNomadMesh(delta.meshId);
    if (!wrapper) return false;

    var mesh = wrapper.getCurrentMesh ? wrapper.getCurrentMesh() : wrapper;
    if (!mesh || mesh.getNbVertices() !== delta.vertexCount) return false;

    var indices = delta.indices;
    var count = delta.count;
    var vAr = mesh.getVertices();
    var cAr = delta.colors ? mesh.getColors() : null;
    var mAr = delta.mask ? mesh.getMaterials() : null;

    for (var i = 0; i < count; ++i) {
      var id = indices[i];
      if (id >= delta.vertexCount) continue; // defensive: a stray index would corrupt neighbours
      var k = id * 3;
      var j = i * 3;
      if (delta.positions) {
        vAr[k] = delta.positions[j];
        vAr[k + 1] = delta.positions[j + 1];
        vAr[k + 2] = delta.positions[j + 2];
      }
      if (cAr) {
        cAr[k] = delta.colors[j];
        cAr[k + 1] = delta.colors[j + 1];
        cAr[k + 2] = delta.colors[j + 2];
      }
      // Materials are [roughness, metalness, mask]; a delta only ever moves mask.
      if (mAr) mAr[k + 2] = delta.mask[i];
    }

    // Sparse refresh: only the touched vertices and the faces around them, the
    // same path a local brush stroke takes.
    var iVerts = new Uint32Array(indices.buffer, indices.byteOffset, count);
    var iFaces = mesh.getFacesFromVertices(iVerts);
    mesh.updateGeometry(iFaces, iVerts);
    if (cAr || mAr) mesh.updateDuplicateColorsAndMaterials(iVerts);
    mesh.updateBuffers();
    this.render();
    return true;
  }

  /**
   * Push the selected mesh to Nomad, replacing the object it came from.
   * One send is one undo step over there, so this is a deliberate action rather
   * than something that fires while sculpting.
   */
  sendMeshToNomad(wrapper) {
    var link = this.getNomadLink();
    if (!link.isConnected()) return false;

    wrapper = wrapper || this._mesh;
    if (!wrapper) return false;
    var mesh = wrapper.getCurrentMesh ? wrapper.getCurrentMesh() : wrapper;
    if (!mesh) return false;

    // Ids live on the wrapper (stamped after import) but the geometry is on the
    // inner mesh, so hand the encoder both.
    var requestId = link.sendMesh(mesh, {
      meshId: wrapper._nomadMeshId || mesh._nomadMeshId,
      geometryId: wrapper._nomadGeometryId || mesh._nomadGeometryId,
      name: wrapper._permanentStaticLabel || 'SculptXR',
      worldMatrix: mesh._nomadWorldMatrix
    });
    if (!requestId) return false;

    if (!this._nomadPendingSends) this._nomadPendingSends = {};
    this._nomadPendingSends[requestId] = wrapper;
    // Nomad now holds this topology, so the next stroke can go as a delta.
    wrapper._nomadVertexCount = mesh.getNbVertices();
    return true;
  }

  /**
   * Tell Nomad about meshes deleted here, so the link does not leave orphans
   * behind. Only for user-initiated deletes — the refresh path in onMesh also
   * removes a mesh, and must NOT delete the object it is about to replace.
   */
  notifyNomadDeleted(meshes) {
    // Gated on live sending like every other outbound edit, so "live off" keeps a
    // single meaning: SculptXR changes nothing in Nomad except via the Send button.
    if (!this._nomadLiveSend || !this._nomadLink || !this._nomadLink.isConnected()) return;
    for (var i = 0; i < meshes.length; ++i) {
      if (meshes[i]._nomadMeshId) this._nomadLink.sendDelete(meshes[i]._nomadMeshId);
    }
  }

  /**
   * Called when a local edit finishes (one completed stroke, one undo step).
   * Mirrors what the Blender bridge does on its dirty-flush: a sparse delta when
   * the topology still matches, a full mesh when it does not.
   *
   * SculptXR gets the touched-vertex set for free — the undo state already
   * recorded exactly which vertices the stroke moved — so unlike Blender there
   * is no snapshot to diff.
   */
  onNomadLocalEdit(state) {
    if (!this._nomadLiveSend) return;
    var link = this._nomadLink;
    if (!link || !link.isConnected()) return;

    // Undo/redo pass the state they applied: its mesh is the one that changed,
    // which is not necessarily the selected one.
    var wrapper = (state && state._mesh) || this.getMesh();
    if (!wrapper) return;
    var mesh = wrapper.getCurrentMesh ? wrapper.getCurrentMesh() : wrapper;
    if (!mesh) return;

    // A mesh made here has no Nomad id yet: send it whole and it appears in Nomad,
    // and the ack gives us the id that later strokes address. (This is what the
    // Blender bridge does for new objects.)
    //
    // A topology change (remesh, weld, subdivide) likewise invalidates every index
    // Nomad holds, so the whole mesh has to go.
    if (!wrapper._nomadMeshId || mesh.getNbVertices() !== wrapper._nomadVertexCount) {
      this.sendMeshToNomad(wrapper);
      return;
    }

    var source = state || this._stateManager.getCurrentState();
    var moved = source && source._idVertState;
    if (!moved || !moved.length) return;
    link.claimSync();
    link.sendDelta(mesh, moved, { meshId: wrapper._nomadMeshId });
  }

  /**
   * Place a linked mesh: Nomad's own transform, scaled up into SculptXR's working
   * units. Nomad's scene is roughly one unit tall, which lands about a centimetre
   * high here — hence the multiplier (Utils.SCALE, the same figure the file
   * importers normalise to).
   *
   * ONLY the object matrix is scaled. The vertices and Nomad's original
   * world_matrix are both left untouched (`_nomadWorldMatrix`), so a send back
   * needs no inverse and cannot accumulate scale drift.
   */
  _applyNomadMatrix(mesh, worldMatrix) {
    var s = this._nomadScale || 1.0;
    var m = mesh.getMatrix();
    mat4.identity(m);
    mat4.scale(m, m, [s, s, s]);
    if (worldMatrix) mat4.multiply(m, m, worldMatrix);
  }

  /** The scene object that came from a given Nomad mesh id, if it is still here. */
  findNomadMesh(nomadMeshId) {
    if (!nomadMeshId) return null;
    for (var i = 0; i < this._meshes.length; ++i) {
      if (this._meshes[i]._nomadMeshId === nomadMeshId) return this._meshes[i];
    }
    return null;
  }

  clearScene() {
    this.getStateManager().reset();
    
    // Through detachMeshThree, so a parented mesh is taken out of its real parent rather than
    // asked to leave a group it was never in.
    for (var i = 0; i < this._meshes.length; ++i) this.detachMeshThree(this._meshes[i]);
    
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

    // THE RIG'S VISUALS ARE NOT MESHES, so emptying `_meshes` does not remove them. Bones,
    // joints, capsules and volumes are batched objects living in the skeleton group, and they
    // are torn down by updateVisuals noticing there are no joints left — which only happens if
    // something asks it to look. Nothing here did, so a cleared scene kept a skeleton on screen
    // with an empty outliner beside it. matt: "if i clear the scene, the outliner looks empty,
    // but the skeleton is still in the 3d viewport."
    try {
      Skeleton.hidePlane(this);
      Skeleton.hidePreview(this);
      // The scale handles are a Group in the skeleton group, not a mesh, so emptying _meshes
      // leaves them floating over an empty scene — the same trap the volume handles fell into.
      if (this._jointHandles) {
        this._jointHandles.group.visible = false;
        this._jointHandles.joint = null;
      }
      Skeleton.updateVisuals(this);
    } catch (e) { console.error('rig teardown on clear failed:', e); }

  }

  // DELETE ONE JOINT AND EVERYTHING BELOW IT, as its own verb rather than through the selection.
  //
  // Not the same as Dissolve, which rejoins the neighbours and keeps the limb — this is the one
  // that takes the limb with it, which is what "delete this bone" means when you are pointing at
  // a finger you no longer want. `_withDescendants` is what makes it the subtree; removeMeshes
  // would cascade anyway, but the removal has to be RECORDED as the same set or undo brings back
  // a joint whose children are gone.
  deleteJointSubtree(joint) {
    if (!joint || this.getIndexMesh(joint) < 0) return false;
    const toRemove = this._withDescendants([joint]);
    this.notifyNomadDeleted?.(toRemove);
    this.removeMeshes(toRemove);
    this._stateManager.pushStateRemove(toRemove.slice());
    this._selectMeshes = (this._selectMeshes || []).filter((m) => !toRemove.includes(m));
    if (toRemove.includes(this._mesh)) {
      this.setOrUnsetMesh(this._meshes[this._meshes.length - 1] || null, false);
    }
    Skeleton.updateVisuals(this);
    Skeleton.refreshOutliner(this);
    this.render?.();
    return true;
  }

  deleteCurrentSelection() {
    if (!this._mesh)
      return;

    // Expand to include FrameGroup children so the whole animated unit is deleted (and
    // recorded for undo) — not just the group null, which would leave orphaned frames.
    const toRemove = this._withDescendants(this._selectMeshes);
    this.notifyNomadDeleted(toRemove);
    this.removeMeshes(toRemove);
    this._stateManager.pushStateRemove(toRemove.slice());
    this._selectMeshes.length = 0;
    // Re-select a remaining mesh so the outliner keeps showing its transform/rig controls —
    // an empty selection blanks most of the panel (those only render for a single selection).
    // Null when the scene is now empty.
    this.setOrUnsetMesh(this._meshes[this._meshes.length - 1] || null, false);
  }

  // Expand a removal list so deleting a FrameGroup (or any parent) also removes its
  // children. FrameGroup frames are real entries in `_meshes`; deleting just the group
  // null used to orphan them — they stayed in the scene list, kept rendering, and got
  // serialized into the .sxr (the "I deleted it but it came back on reload" bug).
  // Iterative so nested groups cascade. Deduped.
  _withDescendants(list) {
    const out = [];
    const seen = new Set();
    const stack = list.slice();
    while (stack.length) {
      const m = stack.pop();
      if (!m || seen.has(m)) continue;
      seen.add(m);
      out.push(m);
      for (var k = 0; k < this._meshes.length; ++k) {
        if (this._meshes[k]._parentMesh === m && !seen.has(this._meshes[k])) stack.push(this._meshes[k]);
      }
    }
    return out;
  }

  removeMeshes(rm, cascade = true) {
    if (cascade) rm = this._withDescendants(rm); // also remove FrameGroup (parent) children
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

  // REPLACING A BOUND MESH DROPS ITS BINDING, and says so.
  //
  // This swaps one mesh object for another and carries the matrix, shader and wireframe across.
  // It does NOT carry the skin weights, and it must not: a weight map is indexed by vertex, so
  // the remesh or voxel pass that produced `newMesh` has invalidated every index in it. Copying
  // them would deform with garbage.
  //
  // What was wrong is that it happened in silence. The bone panel hides its X-Ray and Mush rows
  // when nothing in the scene is bound, so the first sign was a control that had been there a
  // minute ago and now was not. matt: "the bone parameters are getting unreliable. after
  // editing a character i went back to the bone parameters to adjust delta mush, but that
  // slider was missing."
  replaceMesh(mesh, newMesh) {
    if (Skinning.isBound(mesh) && !Skinning.isBound(newMesh)) {
      const why = 'Bind lost: ' + (mesh._permanentStaticLabel || 'the mesh')
        + ' was rebuilt by an edit that changes topology. Bind it again to pose it.';
      if (window.screenLog) window.screenLog(why, '#f9e2af');
      console.warn('[Skinning] ' + why);
    }
    if (newMesh?.setShaderType && !newMesh._isBone && !newMesh._isNull && !newMesh._isReference) {
      newMesh.setShaderType(getOptionsURL().shader);
      newMesh.setFlatShading?.(getOptionsURL().flatshading);
    }
    // CARRY THE ANIMATION ACROSS THE ID CHANGE. Every topology edit lands here — a voxel remesh,
    // and the undo/redo swaps in SculptManager — and each one builds a mesh with a NEW id. Tracks
    // are keyed by id, so without this the blendshape panel reads the new id, finds nothing, and
    // the layers appear to have vanished; the next record arm's ghost sweep then deleted the
    // orphan for real. Done HERE rather than in each caller because this is the one place every
    // replacement passes through — the skin-bind warning above is here for the same reason.
    try { window._animationRegistry?.migrateTrack?.(mesh.getID(), newMesh.getID(), newMesh); }
    catch (e) { console.warn('[Animation] track migration failed', e); }

    var index = this.getIndexMesh(mesh);
    if (index >= 0) this._meshes[index] = newMesh;
    
    var selIndex = this.getIndexSelectMesh(mesh);
    if (selIndex >= 0) this._selectMeshes[selIndex] = newMesh;

    if (this._mesh === mesh) this.setMesh(newMesh);

    if (this._worldGroup && newMesh.getThreeMesh()) {
      this.detachMeshThree(mesh);
      this._worldGroup.add(newMesh.getThreeMesh());
    }
    if (!newMesh._isBone && !newMesh._isNull && !newMesh._isReference) {
      newMesh.setShowWireframe?.(getOptionsURL().wireframe);
    }
  }

  // A COPY BELONGS WHERE THE ORIGINAL BELONGS, and losing that is not a cosmetic difference.
  //
  // copyData carries the matrix, and a parented mesh's matrix is LOCAL TO ITS PARENT. Add the
  // copy to the world group instead and that local matrix is read as a world one -- so a part
  // parented under a joint, whose local scale is LARGE precisely because the joint's own scale
  // is small, comes out enormous. A joint is sized `unit * 0.036`, so the copy can be tens of
  // times the size of the thing it was copied from: it swallows the scene, and every pick after
  // that lands on it. matt: "i could duplicate it, but then once duplicated, it was
  // hard/impossible to choose other things."
  //
  // SILENT, so a copy is ONE undo step rather than an add and a reparent -- undoing the add
  // takes the copy and its parent link away together anyway. The matrix is rewritten AFTER the
  // reparent because setMeshParent's `attach` preserves the WORLD transform and overwrites
  // whatever local matrix was there; the copy wants its source's local matrix, exactly.
  _inheritParent(copy, source) {
    const p = source._parentMesh;
    if (!p) return copy;
    this.setMeshParent(copy.getID(), p.getID(), { silent: true });
    mat4.copy(copy.getMatrix(), source.getMatrix());
    Skeleton.syncThree(copy);
    return copy;
  }

  duplicateSelection() {
    var meshes = this._selectMeshes.slice();
    var mesh = null;
    for (var i = 0; i < meshes.length; ++i) {
      mesh = meshes[i];
      var copy = new MeshStatic(mesh.getGL());
      copy.copyData(mesh);

      // WHAT KIND OF THING IT IS, which copyData does not carry -- it copies geometry, and a
      // locator's geometry is the least interesting thing about it. Duplicating a light used to
      // hand you a small sphere: a real, sculptable, exportable mesh where a light should be.
      // matt: "i can't use the outliner -> duplicate on lights, it makes a mesh."
      //
      // BEFORE addNewMesh, not after. The outliner builds its row from what the mesh IS at the
      // moment it is added, and a copy flagged afterwards has already been filed as ordinary
      // geometry -- so the duplicate appeared in the scene and never in the outliner. matt:
      // "duplicating the light works in the 3d scene, but didn't make a new entry in the
      // outliner." addLight has always flagged first (buildLight sets _isLight before
      // addNewMesh), which is why it never had this problem. decorateLight needs only the
      // mesh's own three object, which is created on demand, so nothing here wants the scene.
      //
      // Rig nodes are absent on purpose. A joint duplicates its CHAIN through RigTopology
      // before this is ever reached, so copying _isBone here would make a second, broken one.
      this._copyEntityKind(copy, mesh);

      this.addNewMesh(copy);
      this._inheritParent(copy, mesh);
    }

    this.setMesh(mesh);
    // And rebuild the list regardless: the kind decides which SECTION a row belongs to, so
    // anything cached from before the copy existed is stale either way.
    Skeleton.refreshOutliner?.(this);
  }

  // The flags and decoration that make a copy the same KIND of object as its source.
  // Shared by duplicate and mirror, which had the same hole.
  _copyEntityKind(copy, src) {
    if (!src._isNull) return;            // only locators carry a kind that geometry cannot express
    copy._isNull    = true;
    copy.isPickable = src.isPickable;
    copy._typeName  = src._typeName;
    if (src._isLight) {
      copy._isLight = true;
      // Sliced, not shared: two lights pointing at one colour array means editing either edits
      // both, which is the sort of thing you only notice a week later.
      copy._lightColor     = (src._lightColor || [1, 1, 1]).slice();
      // _isNull IS THE IMPORTANT ONE. Twenty-nine places ask "is this real geometry" by
      // checking it -- the exporter, the shadow caster list, skinning, the rendering sweeps --
      // so a copy without it is half locator and half mesh, and every one of those treats it
      // as a sphere. It is also what the .sxr writer keys on, so the duplicate would not have
      // saved as a light either.
      copy._isNull         = true;
      copy.isPickable      = src.isPickable;
      copy._typeName       = src._typeName || 'Light';
      copy._lightIntensity = src._lightIntensity;
      copy._lightRange     = src._lightRange;
      copy._lightType      = src._lightType;
      copy._lightConeDeg   = src._lightConeDeg;
      copy._lightRefDist   = src._lightRefDist;
      // The shadow group, all of it. These are hand-tuned values and a duplicate that drops
      // them is a duplicate you have to re-tune -- the same complaint the .sxr writer was
      // fixed for one commit ago.
      copy._castShadow        = src._castShadow;
      copy._shadowNear        = src._shadowNear;
      copy._shadowMapSize     = src._shadowMapSize;
      copy._shadowNormalBias  = src._shadowNormalBias;
      copy._shadowIntensity   = src._shadowIntensity;
      copy._shadowRadius      = src._shadowRadius;
      this.decorateLight(copy);
    } else {
      this.decorateNull(copy);
    }
    return copy;
  }

  // A TRUE mirror of the selection across the parent-local `axis` plane (0 = X, the axis
  // everything else in the app treats as the symmetry axis), as new independent objects.
  //
  // NOT the eye-rig "Mirror Eye" toggle (toggleMirror, above), which is a live render-only
  // twin that reflects POSITION and then re-derives its OWN aim from the source's look-at
  // target -- deliberately, so a pair of eyes converges rather than staring parallel. It
  // never touches rotation, which is right for an eye and useless for anything placed at an
  // angle: matt built a robot out of hinges and servos and there was no way to get the far
  // side of it.
  //
  // The reflection of a placement M is S*M, with S = diag(-1,1,1). Its determinant is
  // NEGATIVE -- an inside-out transform that the picker, the sculpt tools and every one of
  // this app's custom shaders would have to be taught about. So it is split instead:
  //
  //     S*M = (S*M*S)*S
  //
  // The right-hand S reflects the GEOMETRY in local space (and reverses the winding, so the
  // normals still point out); S*M*S places it, and is a proper rigid transform. Both halves
  // have a positive determinant, so nothing downstream ever sees a mirrored matrix.
  //
  // Parent-local rather than world, matching the eye mirror: a part hung off the torso
  // mirrors across the TORSO's centreline and keeps doing so when the torso turns. An
  // unparented part has no parent frame, so that is world X = 0.
  mirrorSelection(axis = 0) {
    const meshes = this._selectMeshes.slice();
    if (!meshes.length) return null;
    let last = null;
    for (const mesh of meshes) {
      const copy = new MeshStatic(mesh.getGL());
      copy.copyData(mesh);
      copy._typeName = mesh._typeName;
      copy._permanentStaticLabel = (mesh._permanentStaticLabel || mesh._typeName || 'Mesh') + ' Mirror';
      this._mirrorGeometry(copy, axis);
      this.addNewMesh(copy);
      // Parent first and copy the source's local matrix, exactly as a duplicate does -- then
      // reflect that matrix in place. Doing it in this order matters: setMeshParent's `attach`
      // preserves the WORLD transform and overwrites the local matrix, so a reflection written
      // before the reparent would be thrown away.
      this._inheritParent(copy, mesh);
      this._reflectMatrix(copy.getMatrix(), axis);
      Skeleton.syncThree(copy);
      last = copy;
    }
    if (last) this.setMesh(last);
    this.render();
    return last;
  }

  // S*M*S for S = diag(-1,1,1) (axis 0), in place. Conjugating by a reflection is just
  // negating that row and that column: the position and every rotation out of the mirror
  // plane flip, and the element they share flips twice and so stays put.
  _reflectMatrix(m, axis) {
    for (let j = 0; j < 4; ++j) m[axis + 4 * j] = -m[axis + 4 * j]; // row
    for (let i = 0; i < 4; ++i) m[axis * 4 + i] = -m[axis * 4 + i]; // column
  }

  // The other half of the reflection: negate `axis` on every vertex in LOCAL space and
  // reverse every face's winding, so a chiral part (a bracket, a cut-away servo horn) comes
  // out actually mirrored rather than merely turned around. A symmetric part -- which is most
  // of what gets mirrored -- is unchanged by it.
  _mirrorGeometry(mesh, axis) {
    const v = mesh.getVertices();
    for (let i = axis, l = v.length; i < l; i += 3) v[i] = -v[i];

    // Faces are 4 slots wide; a triangle is [a, b, c, TRI_INDEX], so the separator has to stay
    // in slot 3 and only a and c swap.
    const flip = (f) => {
      if (!f) return;
      for (let i = 0, l = f.length; i < l; i += 4) {
        let t = f[i];
        if (f[i + 3] === Utils.TRI_INDEX) { f[i] = f[i + 2]; f[i + 2] = t; continue; }
        f[i] = f[i + 3]; f[i + 3] = t;
        t = f[i + 1]; f[i + 1] = f[i + 2]; f[i + 2] = t;
      }
    };
    flip(mesh.getFaces());
    // The UV face list runs parallel to the face list, so it has to be turned the same way or
    // the texture corners stop matching the vertices they belong to.
    if (mesh.hasUV && mesh.hasUV()) flip(mesh.getFacesTexCoord());

    mesh.init();
    mesh.initRender();
  }

  // Linked instance of the current selection: each new node SHARES its source's geometry
  // (_meshData) but has its own transform + render buffers. Editing any occurrence updates
  // them all (refreshLinkedSiblings). Break a link with makeUniqueSelection().
  instanceSelection() {
    const meshes = this._selectMeshes.slice();
    let last = null;
    for (const mesh of meshes) {
      const inst = new MeshStatic(mesh.getGL());
      inst.shareData(mesh);
      this.addNewMesh(inst);
      this._inheritParent(inst, mesh);
      last = inst;
    }
    if (last) this.setMesh(last);
    this._refreshLinkOutliner();
    this.render();
  }

  // Give each selected linked node its own private copy of the geometry (break the link).
  makeUniqueSelection() {
    const meshes = this._selectMeshes.slice();
    for (const mesh of meshes) {
      if (this.isLinked(mesh) && typeof mesh.makeUnique === 'function') mesh.makeUnique();
    }
    this._refreshLinkOutliner();
    this.render();
  }

  // Meshes that share this mesh's geometry data (its linked instances). Identity of the
  // shared _meshData object IS the link — no separate bookkeeping.
  _linkedSiblings(mesh) {
    const md = mesh && mesh.getMeshData && mesh.getMeshData();
    if (!md) return [];
    return this.getMeshes().filter(m => m !== mesh && m.getMeshData && m.getMeshData() === md);
  }

  isLinked(mesh) {
    return this._linkedSiblings(mesh).length > 0;
  }

  // After an edit to a linked node, re-sync every sibling's GPU buffers from the shared
  // data so the change shows on all occurrences.
  refreshLinkedSiblings(mesh) {
    const sibs = this._linkedSiblings(mesh);
    if (!sibs.length) return;
    // Re-upload the shared geometry AND colour/material so both sculpt and paint sync.
    for (const s of sibs) {
      if (s.isDynamic) { s.updateBuffers?.(); }
      else { s.updateGeometryBuffers?.(); s.updateColorBuffer?.(); s.updateMaterialBuffer?.(); }
    }
    this.render?.();
  }

  _refreshLinkOutliner() {
    const gui = this.getGui && this.getGui();
    if (gui && gui._desktopSceneEl && gui._buildDesktopScene) gui._buildDesktopScene(gui._desktopSceneEl);
    this._mainMenuPanel?.markDirty?.();
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

  _recoverXRTransientInput(reason = 'resume') {
    if (!this._xrSession) return;

    // System overlays (notably headset screen recording) can briefly blur the immersive
    // session without ending it. Poses/input disappear for a few frames, but the old stroke,
    // menu and hand latches survive; hover and brush-cursor updates then remain suppressed
    // until a completely new XR session is created. Treat resume as a clean input boundary.
    if (this._vrSculpting) this._sculptManager?.end?.();
    this._vrSculpting = false;
    this._vrLockedHand = null;
    // NOT `_activeHandedness`. It sat in this list with the genuinely transient things — the
    // stroke, the menu latch, the pointing flags — but it is a PREFERENCE, not input state: it
    // records which hand you sculpt with, and a system overlay stealing focus for a moment is
    // no reason to forget that. Clearing it dropped the brush cursor back to the fallback
    // above, and the cursor is the ONLY thing in the app gated on this latch — which is why
    // starting the GalaxyXR recorder made the radius sphere vanish while everything else
    // carried on. matt: "it hides some of the UI, but not all of it... strange that the rest of
    // the app is unaffected."
    //
    // The next trigger squeeze re-latches it either way, so keeping it costs nothing and the
    // stale value is the correct one.
    this._vrMenuTriggerLatch = false;
    this._isPointingAtMenu = false;
    this._wasPointingAtMenu = false;
    this._lastXRControllers = [];
    this._noSourceFrames = 0;
    this._noSourceWarned = false;

    // Make the first restored pose perform a fresh hover pick immediately.
    this._rigHoverAtVR = 0;
    this._skelHighlightIds = [];
    this._pinHighlightIds = [];
    this._skelHighlightId = -1;
    this._pinHighlightId = -1;
    this._rigHoverHands = {};
    Skeleton.updateVisuals?.(this);

    this._preventRender = false;
    this._drawFullScene = true;
    this.render?.();
    console.info(`[XR] Input state recovered after ${reason}`);
  }

  async enterXR(session) {
    window._lastLogTime = performance.now();
    // console.log("[Telemetry] WebXR Session entered");
    window._xrSessionStartT = performance.now();
    window._xrMark = (what) => {
      if (window._xrMarks) window._xrMarks.push([what, performance.now()]);
    };
    window._xrMark('enterXR');
    if (window.screenLog) window.screenLog("[XR] Session Start Triggered", "green");
    this._xrSession = session;

    // #23 Briefly show the controller button labels on session entry so the mapping
    // is discoverable, then auto-hide. Toggle anytime with window.toggleVrButtonLabels().
    window._vrShowButtonLabels = true;
    this._btnLabelsAutoHideAt = performance.now() + 5000;
    // #29 Reset the recent-tool history for this session.
    this._toolHistory = [];
    this._lastSeenTool = -1;

    session.addEventListener('end', this.onXREnd.bind(this));
    session.addEventListener('visibilitychange', () => {
      if (session.visibilityState === 'visible') this._recoverXRTransientInput('visibility restore');
    });
    // THE PLATFORM ALREADY DETECTS THE PINCH, AND IT IS BETTER AT IT THAN WE ARE.
    //
    // visionOS's transient-pointer input exists precisely to say "the user is clicking now": the
    // input array stays empty until a pinch, then a source is added and selectstart fires. That
    // is Apple's own detector, running on their tracking, tuned by them, and it needs no
    // hand-tracking permission. Our thumb-to-index measurement is the standard technique and it
    // is a REIMPLEMENTATION of something the runtime is already telling us.
    //
    // So the system pinch is OR'd into the dominant hand's trigger rather than replacing it —
    // the joint measurement still drives sculpting pressure and still works on runtimes with no
    // transient-pointer at all (Quest hands), while a click that our thresholds miss still lands
    // if the platform saw it.
    //
    // WHICH HAND IT BELONGS TO IS DECIDED BY OUR OWN JOINTS, not by the source. A
    // transient-pointer source reports handedness 'none', and crediting it to the dominant hand
    // unconditionally meant an offhand pinch read as a dominant-hand press — which is how
    // pinching the left hand alone started a smooth stroke on visionOS. The dispatch compares
    // the two hands' measured pinch gaps and declines the credit when the other hand is clearly
    // the closed one; with no measurement available it credits the dominant hand as before.
    // window._sysPinch = false disables it entirely; window._sysPinchMargin is the margin.
    session.addEventListener('selectstart', (e) => {
      if (e.inputSource?.targetRayMode === 'transient-pointer') this._sysPinchActive = true;
    });
    const _sysUp = (e) => {
      if (e.inputSource?.targetRayMode === 'transient-pointer') this._sysPinchActive = false;
    };
    session.addEventListener('selectend', _sysUp);
    session.addEventListener('select', _sysUp);

    session.addEventListener('inputsourceschange', (event) => {
      // A VISIONOS PINCH IS NOT A CONTROLLER BEING PLUGGED IN.
      //
      // Every gaze pinch ADDS a transient-pointer source and every release removes it, so this
      // fired several times a second — each time running a full recovery that clears hover
      // state and forces a whole-scene redraw, in the middle of the click the user was trying
      // to make. It looked like input churn because it WAS input churn, self-inflicted.
      //
      // Recovery exists for a controller that genuinely came back (a wake, a reconnect, a
      // session rebuild). A source that appears for the duration of a pinch is the opposite of
      // that: it is the input working normally.
      const real = [...(event.added || [])].filter(s => s.targetRayMode !== 'transient-pointer');
      if (real.length) this._recoverXRTransientInput('controller restore');
    });

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

    // THE PRE-SESSION WARM IS OFF BY DEFAULT -- it was the cause, not the cure.
    if (this._isNodeRenderer) {
      // NO PRE-SESSION WARM. ?warm=1 restores it for comparison.
      //
      // PROVEN by dumping the generated shader on both sides. In XR the camera matrices are
      // per-eye arrays in their own buffers:
      //   layout( std140 ) uniform cameraIndex { uint u_cameraIndex; };
      //   uniform NodeBuffer_8229 { mat4 buffer8229[2]; };
      // Compiled outside a session they are single matrices inside a large shared block:
      //   layout( std140 ) uniform render { mat4 cameraProjectionMatrix; mat4 cameraViewMatrix; ... };
      //
      // Two incompatible layouts for one material. Warming ran BEFORE setSession, so every
      // material was compiled with the desktop layout, and the session then bound per-eye
      // buffers to shaders built for single matrices -- "uniform buffer that is too small",
      // growing with the material, which is why a tiny one survived and the full Physical
      // material did not.
      //
      // Warming was added to avoid building pipelines inside a session, on the strength of
      // the spike's UBO flood. That flood was most likely THIS, misread: the spike warmed on
      // the desktop too. The warm was not protecting against the fault, it was causing it.
      // THE SESSION WARM DOES NOT HAPPEN HERE. It used to, and it was worthless: this runs
      // BEFORE setSession, and _rebuildAll('session start') a few lines down then discards every
      // shader it just built. It now runs immediately after that rebuild instead.
    }

    // Enable Three.js WebXR. setReferenceSpaceType must be called before setSession.
    this._renderer.xr.enabled = true;
    this._renderer.xr.setReferenceSpaceType('local-floor');

    this._renderer.resetState?.();   // see _drawScene — absent on WebGPURenderer

    // Call setSession as early as possible — the XR compositor starts its timeout
    // the moment requestSession resolves. Every ms before setSession is called is
    // time the compositor spends showing the default gray void environment.
    const t0 = performance.now();
    window._xrMark && window._xrMark('pre-session work');
    await this._renderer.xr.setSession(session);
    window._xrMark && window._xrMark('setSession');

    // REBUILD EVERY MATERIAL AT THE SESSION BOUNDARY.
    //
    // A node material's shader is compiled the first time it is DRAWN, and everything in
    // this app is drawn on the desktop long before anyone enters VR. So every material
    // already carries the non-XR camera layout -- single cameraProjectionMatrix and
    // cameraViewMatrix inside the shared `render` block -- while the session binds per-eye
    // arrays selected by u_cameraIndex. Removing the pre-session warm only stopped ADDING
    // to that set; it could never fix the materials the desktop had already compiled, which
    // is why the symptoms kept reshuffling: whichever materials happened to be drawn first
    // were the ones that broke.
    //
    // needsUpdate discards the compiled state, so each one is rebuilt on its next draw --
    // inside the session, with the layout the session actually uses. Done on the way out
    // too, for the same reason in reverse.
    const _rebuildAll = (why) => {
      let n = 0;
      const mark = (m) => { if (m && m.isMaterial) { m.needsUpdate = true; n++; } };
      this._scene.traverse((o) => {
        if (!o.material) return;
        if (Array.isArray(o.material)) o.material.forEach(mark); else mark(o.material);
      });
      for (const m of NodeMaterials.all ? NodeMaterials.all() : []) mark(m);
      console.log('[xr] rebuilt ' + n + ' materials (' + why + ')');
    };
    // Shadow casting is decided HERE, at the boundary, and not touched again until the next
    // one -- for the same reason the light pool is fixed: castShadow changes the compiled
    // graph, and a recompile inside a session is what breaks it.
    const _setPoolShadows = (on) => {
      const pool = this._lightPool;
      if (!pool) return;
      for (const t of [0, 1, 2]) for (const L of pool[t]) L.castShadow = on;
    };
    if (this._isNodeRenderer) {
      // EVERY MESH GETS ITS SHADOW FLAGS BEFORE THE GRAPH IS FROZEN, not after. receiveShadow
      // is compiled in, so a mesh entering the session without it can never receive a shadow
      // no matter what the lights do.
      for (const mesh of (this.getMeshes ? this.getMeshes() : [])) {
        const tm = mesh.getThreeMesh && mesh.getThreeMesh();
        if (!tm || mesh._isLight) continue;
        tm.castShadow = true;
        tm.receiveShadow = true;
      }
      // Freeze FIRST, then decide. The latch is what stops _syncThreeLights undoing this on
      // the frames between here and xr.isPresenting going true.
      this._xrGraphFrozen = true;
      // THE FLAG IS A URL PARAM AS WELL AS A GLOBAL. window._xrShadows has to be set BEFORE
      // the button is pressed, and forgetting that looks exactly like the bug it was meant to
      // test -- it cost a headset session. ?xrshadows=0 cannot be mistimed.
      //
      // THIS IS THE AUTHORITATIVE READ, and it is why making shadows the default did not take.
      // The boundary read here ran `!!window._xrShadows || !!_shq` -- opt-IN -- and then WROTE
      // the answer back to window._xrShadows. With no flag that stored an explicit `false`, so
      // the per-frame test I had changed to `!== false` saw a real false from then on and
      // turned shadows off anyway. Two places decided the same thing and the older one won.
      // matt: "if i take off the xrshadow=1 flag, i don't get shadows."
      //
      // Opt-OUT now, and it agrees with the per-frame read by construction: both ask only
      // whether the flag has been explicitly set to false.
      const _shq = /[?&]xrshadows=(\w+)/.exec(window.location.search);
      this._xrShadowOnce = !!(_shq && _shq[1] === 'once');
      this._xrShadowAlways = !!(_shq && _shq[1] === 'always');
      if (_shq && _shq[1] === '0') window._xrShadows = false;
      const _wantXrShadows = window._xrShadows !== false;
      window._xrShadows = _wantXrShadows;
      _setPoolShadows(_wantXrShadows);
      // THE REBUILD IS SKIPPED ON THIS BRANCH -- see the note above it.
      //
      // It discards every compiled shader because the desktop compiled them with the wrong
      // camera layout. The launch warm now compiles the PER-EYE layout too, against the real
      // scene, so there should be nothing left to invalidate. That is the experiment this branch
      // is for: if lit materials draw and the menus appear, this rebuild has been redundant
      // since the binding-point patch landed and entering VR can be nearly free.
      //
      // If they do NOT draw, the rebuild is doing something the stereo warm does not cover, and
      // this branch dies rather than becoming a flag.
      window._xrMark && window._xrMark('material rebuild (skipped)');
      // AND REBUILD THEM IN ONE PLACE, RATHER THAN OVER THE NEXT MINUTE -- BUT NOT HERE.
      //
      // The rebuild above discards every compiled shader, and what refills that cache is
      // whatever happens to be drawn next, one object at a time, whenever it first appears.
      // That is matt's "compiling shaders warning popping up regularly".
      //
      // Warming it back immediately looks right and is not: while a session is presenting, three
      // substitutes xr.getCamera() for whatever camera is passed to render(), and at this point
      // no XRFrame has arrived, so that camera is an ArrayCamera with ZERO sub-cameras. The
      // pipeline key hashes cameras.length, so a warm here compiles a whole third set --
      // `ArrayCamera[0]` in matt's report -- for a shape nothing will ever draw with again.
      //
      // So it waits for the first frame that has real views, which is where the reveal warm runs.
      // Nothing to warm in-session if the launch warm covered it. Left armed so the reveal pass
      // still runs and the compile trace can say whether it found anything to do -- if it
      // reports nothing, that IS the result this branch is testing for.

      if (_wantXrShadows && this._xrShadowOnce) {
        // A little after the boundary, so the pool has been synced and the sculpt is present.
        setTimeout(() => { try { window.xrShadowRefresh(); } catch (e) { /* never block VR */ } }, 1500);
      }
      session.addEventListener('end', () => {
        try {
          this._xrGraphFrozen = false;
          _setPoolShadows(true);
          _rebuildAll('session end');
        } catch (e) { /* never block leaving VR */ }
      });
    }

    const t1 = performance.now();
    if (window.screenLog) window.screenLog(`[XR] setSession Resolved (+${Math.round(t1 - window._xrSessionStartT)}ms total, setSession took ${Math.round(t1-t0)}ms)`, "lime");

    // FOVEATION IS OFF WHERE IT IS NOT GAZE-DRIVEN.
    //
    // three defaults the XR compositor's foveation to 1.0 — maximum — and nothing here ever
    // changed it. On a headset with eye tracking the reduction follows your gaze, so the sharp
    // region is wherever you happen to be looking and it is invisible; the Vision Pro and Galaxy
    // XR are both that. The Quest family is not: its foveation is FIXED, radial from the centre
    // of each eye buffer, and this app puts your hands, the spike and the wrist panels low in
    // the field — so you spend the session looking at pixels the compositor has written off as
    // peripheral. matt on a Quest 2: "the lower half or 1/3 of the display renders really
    // pixellated", and setFoveation(0) settled it on the spot.
    //
    // Keyed on the BROWSER, not on a headset model. Every runtime that reaches us through Oculus
    // Browser gets fixed foveation in WebXR — including the eye-tracked Quest Pro, whose gaze
    // foveation is not wired to this — so the model is the wrong thing to ask about and would
    // need a new string for every device released.
    //
    // Foveation exists to buy back fill rate, which is exactly what a Quest is short of, so this
    // is a trade rather than a free win. window._foveation, or ?foveation=, overrides it in
    // either direction.
    try {
      const _fov = Number.isFinite(window._foveation)
        ? window._foveation
        : (Number.isFinite(getOptionsURL()['foveation']) ? getOptionsURL()['foveation']
                                                         : (this._isQuestStandalone ? 0 : 1));
      this._renderer.xr.setFoveation(_fov);
      console.log('[XR] foveation ' + _fov + (this._isQuestStandalone ? ' (fixed-foveation runtime)' : ''));
    } catch (e) { console.warn('[XR] setting foveation failed', e); }

    // WHAT THE COMPOSITOR IS DOING WITH OUR FRAME, RECORDED AT SESSION START.
    //
    // visionOS composites the user's real hands into the frame ("punch-through"), and whether
    // our depth buffer has any say in that is `ignoreDepthValues` — measured true on visionOS
    // 2026-09-15, which means no material flag, render order or depth trick can put a menu in
    // front of a hand. It is worth knowing WHICH session that was: the behaviour was there on one
    // run and gone after a reload, and environmentBlendMode ('alpha-blend' for passthrough,
    // 'opaque' for fully immersive) is the state most likely to explain the difference.
    //
    // Recorded on window as well as logged, because the console in a headset is a 5-second
    // window and this is the line worth having when the symptom next appears.
    try {
      const _bl = session.renderState?.baseLayer;
      window._xrComposite = {
        blend: session.environmentBlendMode,
        mode: session.mode || (session.interactionMode ? 'interaction:' + session.interactionMode : null),
        ignoreDepthValues: _bl ? _bl.ignoreDepthValues : null,
        layer: _bl ? 'baseLayer' : 'projectionLayer',
        features: [...(session.enabledFeatures || [])],
      };
      console.log('[XR] compositor ' + JSON.stringify(window._xrComposite));
    } catch (e) { console.warn('[XR] reading the compositor state failed', e); }

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

  // ── CURSOR DIAGNOSTIC ────────────────────────────────────────────────────────
  //
  // Three theories about why the brush cursor vanishes when the GalaxyXR screen recorder is
  // started MID-SESSION, and three of them wrong. The fact that broke the last one: start the
  // recorder BEFORE entering immersive mode and everything works. That rules out anything about
  // the steady state — the extra observer view, the projection, the culling — because all of
  // those are the same either way. It is about something changing UNDER a running session.
  //
  // So this does not test a theory. It watches every value that could plausibly differ and
  // reports the ones that CHANGE, with the frame they changed on. Start it, start the recorder,
  // and whatever prints is the answer.
  _cursorDiagSnap(frame) {
    const xr = this._renderer && this._renderer.xr;
    const cam = xr && xr.getCamera && xr.getCamera(this._camera?.getThreeCamera?.());
    const session = (frame && frame.session) || this._xrSession;
    const layer = session && session.renderState && session.renderState.baseLayer;
    const tool = this.getSculptManager?.()?.getCurrentTool?.();
    const cur = this._vrCursorRight || this._vrCursorLeft;
    const sph = cur && cur.getObjectByName && cur.getObjectByName('volume_sphere');
    return {
      views: cam && cam.cameras ? cam.cameras.length : -1,
      fbW: layer ? layer.framebufferWidth : -1,
      fbH: layer ? layer.framebufferHeight : -1,
      vis: session ? session.visibilityState : 'none',
      sources: session && session.inputSources ? session.inputSources.length : -1,
      hand: this._activeHandedness || 'null',
      dom: this._dominantHand || 'null',
      playing: !!window._animPlaying,
      panels: !!this._htmlPanelsHidden,
      tool: tool && tool.constructor ? tool.constructor.name : 'none',
      curVis: cur ? !!cur.visible : null,
      sphVis: sph ? !!sph.visible : null,
      sphScale: sph ? +sph.scale.x.toFixed(4) : -1,
      sphPos: sph ? [sph.position.x, sph.position.y, sph.position.z]
        .map((v) => +v.toFixed(3)).join(',') : 'none',
      curParent: cur && cur.parent ? (cur.parent.name || cur.parent.type) : 'none',
      scale: +(this._vrScale || 0).toFixed(4),
      uiL: this._vrUIHitDistLeft === Infinity ? 'inf' : +(this._vrUIHitDistLeft || 0).toFixed(2),
      uiR: this._vrUIHitDistRight === Infinity ? 'inf' : +(this._vrUIHitDistRight || 0).toFixed(2),
    };
  }

  _cursorDiagTick(frame) {
    this._cursorDiagN = (this._cursorDiagN || 0) + 1;
    const now = this._cursorDiagSnap(frame);
    const was = this._cursorDiagPrev;
    this._cursorDiagPrev = now;
    if (!was) { console.log('[cursorDiag] frame 1 baseline', JSON.stringify(now)); return; }
    const moved = {};
    let any = false;
    for (const k of Object.keys(now)) {
      if (now[k] !== was[k]) { moved[k] = was[k] + ' -> ' + now[k]; any = true; }
    }
    // The sphere's POSITION changes every frame by design, so it is only interesting alongside
    // something else. Reporting it alone would bury the signal in a per-frame stream.
    if (any && Object.keys(moved).length === 1 && moved.sphPos) return;
    if (any) {
      delete moved.sphPos;
      console.log('[cursorDiag] frame ' + this._cursorDiagN + ' CHANGED', JSON.stringify(moved));
    }
  }

  // The switch. Prints a full baseline immediately — so a run that shows nothing afterwards is
  // still an answer, not a diagnostic that failed to arm — then one line per CHANGE.
  //
  // How to use it: enter immersive, run it, THEN start the recorder. Whatever prints between
  // those two moments is what the recorder did. Running it in the working order (recorder
  // first, then immersive) gives the control.
  cursorDiag(on) {
    window._cursorDiag = on !== false;
    this._cursorDiagPrev = null;
    this._cursorDiagN = 0;
    if (!window._cursorDiag) { console.log('[cursorDiag] off'); return false; }
    console.log('[cursorDiag] ' + VERSION + ' ON. Baseline next frame, then one line per change.');
    console.log('[cursorDiag] now: ' + JSON.stringify(this._cursorDiagSnap(null)));
    console.log('[cursorDiag] enter immersive, run this, THEN start the recorder. '
      + 'Nothing printing is itself an answer: it would mean none of these values moved.');
    return true;
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
    } else if (Number.isFinite(getOptionsURL().offsetY)) {
      valY = getOptionsURL().offsetY;
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
    this._ss = null;
    this._xrSession = null;
    this._xrRefSpace = null;
    this._preventRender = false;
    // The smooth-mode latch is only refreshed inside the XR frame loop, so leaving it set would
    // have every effectiveTool()/selectedTool() read on desktop answering with whatever was true
    // when the headset came off. Cleared, they fall back to the live manager.
    this._smoothMode = null;
    this._smoothModeShown = false;

    // Hide VR floaters (#23 labels, #29 toast) so they don't linger in the scene.
    if (this._toolToast) this._toolToast.mesh.visible = false;
    if (this._btnLabels) { this._btnLabels.left.mesh.visible = false; this._btnLabels.right.mesh.visible = false; }
    window._vrShowButtonLabels = false;

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

    // Prevent lingering tools from thinking they are active.
    // THE LOCKED HAND MUST GO WITH IT. Clearing _vrSculpting alone leaves _vrLockedHand set,
    // and the next session's first stroke then inherits a hand lock from the previous one —
    // the branch that would refresh it is guarded on the lock being empty. Switching VR to AR
    // runs exactly this path, with a session ending under whatever the hands were doing.
    if (this._vrSculpting) {
      this._vrSculpting = false;
      if (this._sculptManager) this._sculptManager.end();
    }
    this._vrLockedHand = null;

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

    // [HTMLVRPanel] Init HTML-based Brush/Tools panel
    {
      try {
        // THE BRUSH PANEL IS GONE (2026-08-28, matt: "i want it all gone"). It was the second,
        // half-finished wrist view — a Sculpting/Low Poly tabbed panel reachable only from a
        // "Low Poly & Full Menu" button at the bottom of the tool picker, and by accident from
        // a couple of other paths. The working route is MiniPanel for sculpting and
        // MainMenuPanel for low-poly, and two overlapping answers to "where are the tools" is
        // what made the low-poly menu read as buggy.
        //
        // `window._brushPanelEnabled` and its no-op toggle existed to keep the legacy canvas
        // menu dead. The canvas menu is deleted, so the flag guards nothing; the toggle stays
        // only so a stray caller does not throw.
        window.toggleBrushPanel = () => this._swapHtmlPanels('mini');
      } catch (err) {
        console.error('[HTMLVRPanel] legacy-menu retirement failed:', err);
      }
    }

    // [HTMLVRPanel] Init MiniPanel (compact wrist HUD — replaces legacy canvas MiniHUD)
    if (!this._miniPanel && this._scene && this._camera && this._renderer) {
      try {
        this._miniPanel = new MiniPanel(this, this._scene, this._camera.getThreeCamera(), this._renderer);
        this._miniPanel.bindDesktopPointers(this._renderer, this._camera.getThreeCamera());
        this._miniPanel._element.addEventListener('mp-show-tool-picker', () => {
          this._swapHtmlPanels('picker');
          this._toolPickerPanel?.syncFromState();
        });
        // NO X/A BUTTON MEANS THE SWAP HAS TO LIVE ON THE PANELS THEMSELVES. On a hands-only
        // runtime there is nothing to press to reach the main menu, so each panel carries a
        // corner button to the other one.
        this._miniPanel._element.addEventListener('mp-show-main-menu', () => {
          this._swapHtmlPanels('main');
        });
        this._miniPanel._element.addEventListener('mp-undo', (e) => this._doUndoRedo(!!e.detail?.redo));
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
        if (window.screenLog) window.screenLog('[HTMLVRPanel] ToolPickerPanel created', 'cyan');
      } catch (err) {
        console.error('[HTMLVRPanel] ToolPickerPanel init failed:', err);
      }
    }

    // [HTMLVRPanel] Init MainMenuPanel (replaces GuiXR + VRMenu main menu)
    if (!this._mainMenuPanel && this._scene && this._camera && this._renderer) {
      try {
        this._mainMenuPanel = new MainMenuPanel(this, this._scene, this._camera.getThreeCamera(), this._renderer);
        // Going back to the model closes whatever menu is up — see _wireViewportDismiss.
        this._mainMenuPanel._wireViewportDismiss?.(this);
        this._mainMenuPanel.bindDesktopPointers(this._renderer, this._camera.getThreeCamera());
        this._mainMenuPanel._element.addEventListener('mm-pin-change', (e) => {
          this._onMainMenuPanelPinChange(e.detail.pinned);
        });
        // The other half of the panel-to-panel swap (see mp-show-main-menu).
        this._mainMenuPanel._element.addEventListener('mm-show-mini', () => {
          this._swapHtmlPanels('mini');
        });
        this._mainMenuPanel._element.addEventListener('mm-undo', (e) => this._doUndoRedo(!!e.detail?.redo));
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
            if (Utils.isTypingTarget(e)) return; // ] [ and m belong to a focused field
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
      // RENDER PASSES (#2a). exportPass('depth'|'normal') saves a PNG; renderPass() hands back a
      // data URL instead, which is what makes the thing testable without a download dialog.
      window.exportPass = (mode = 'normal', size = 1024) => exportRenderPass(this, mode, size);
      window.renderPass = async (mode = 'normal', size = 256) => {
        const fitted = mode === 'depth' ? await autoRange(this, size) : null;
        const c = await renderPassToCanvas(this, mode, size, fitted);
        return c ? c.toDataURL('image/png') : null;
      };
      window.showPanel = (name) => {
        const panels = {
          mini:   this._miniPanel,
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
            if (Utils.isTypingTarget(e)) return; // 'n' belongs to the text field, not the panel
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
    if (!this._vrKeyboard && this._scene && this._camera && this._renderer) {
      try {
        this._vrKeyboard = new VrKeyboard(this._scene, this._camera.getThreeCamera(), this._renderer);
        window._vrKeyboard = this._vrKeyboard;
      } catch (err) {
        console.error('[VrKeyboard] init failed:', err);
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
            // Node material first: WebGPURenderer cannot draw a ShaderMaterial, so on the
            // flagged path the aim laser was hidden -- in every shader mode.
            const lineMaterial = NodeMaterials.laser() || new THREE.ShaderMaterial({
                vertexShader: `varying float vFade; void main() { vFade = 1.0 - clamp((uv.y - 0.5) * 2.0, 0.0, 1.0); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
                fragmentShader: `varying float vFade; void main() { gl_FragColor = vec4(1.0, 1.0, 1.0, vFade * 0.85); }`,
                transparent: true, depthTest: true, depthWrite: false,
                blending: THREE.NormalBlending, side: THREE.DoubleSide,
            });
            const rayRoot = new THREE.Group();
            rayRoot.name = 'pointer_ray_root';
            const rayMesh = new THREE.Mesh(lineGeometry, lineMaterial);
            // ABOVE THE PANELS. The ray does not write depth, so drawn before a panel it cannot
            // occlude one: the panel paints over it wherever the depth buffer still holds the
            // far scene. Drawn AFTER the panel it is depth-tested against the depth the panel
            // DOES write, so the section behind a panel is correctly hidden and the section in
            // front is visible. matt: the panels "appear above everything including the aim
            // 'lasers' that come out of the controllers, that isn't right."
            rayMesh.renderOrder = VR_PANEL_RENDER_ORDER + 5;
            rayRoot.add(rayMesh);
            controller.add(rayRoot);

            // Controller Stylus Spike
            const spikeGeo = new THREE.CylinderGeometry(0, 0.005, 0.10, 16);
            spikeGeo.rotateX(-Math.PI / 2);
            spikeGeo.translate(0, 0, -0.05); // Base at 0, Tip at -0.10
            
            // Node material first: bisection named this exact object as the one that starts
            // the drawElements flood under ?renderer=webgpu. See NodeMaterials.basic.
            const spikeMat = NodeMaterials.basic(0x4d4d4d)
              || new THREE.MeshBasicMaterial({ color: 0x4d4d4d });
            const spikeMesh = new THREE.Mesh(spikeGeo, spikeMat);
            spikeMesh.name = 'stylus_spike';
            controller.add(spikeMesh);
            // EVERY SPIKE EVER MADE, so a resize can reach all of them.
            //
            // updateStylusLength/Offset used to write to `_vrControllerLeft/Right` only, and those
            // two are REASSIGNED as sources come and go -- a real controller outranks a hand for
            // the same handedness, see the mapping below. So on a runtime where hands arrive after
            // controllers, the spike you are looking at was hanging off an object the resize no
            // longer named, and it kept the controller's 0.10/0.15 while picking used the hand's
            // 0.05. matt: "the spike in hands free mode seems offset from the actual pointer
            // selection position, its like the tip of the spike is too far forward." Exactly twice
            // too far, on Quest.
            (this._spikeMeshes = this._spikeMeshes || new Set()).add(spikeMesh);

            // Xray ghost of the spike — a child (inherits length/offset/tilt) that draws ONLY
            // where the spike is occluded (depthFunc GreaterDepth), revealing the tip through
            // the mesh when it dips under the surface. Hidden until the transform tool arms it.
            // TIP-ONLY geometry: just the top ~1/3 of the spike (the part that enters a mesh),
            // NOT the base that embeds in the controller — so the reveal never fires against the
            // controller. Made slightly FATTER than the spike so its surface sits OUTSIDE the
            // real spike instead of coincident with it → no z-fighting shimmer.
            const spikeGhostGeo = new THREE.CylinderGeometry(0, 0.004, 0.035, 16);
            spikeGhostGeo.rotateX(-Math.PI / 2);
            spikeGhostGeo.translate(0, 0, -0.0825); // top ~1/3, z −0.065 .. −0.10 (tip)
            const spikeGhostMat = NodeMaterials.basic(0x00e5ff, {
                transparent: true, opacity: 0.6, depthTest: true, depthWrite: false,
            }) || new THREE.MeshBasicMaterial({
                color: 0x00e5ff, transparent: true, opacity: 0.6,
                depthTest: true, depthFunc: THREE.GreaterDepth, depthWrite: false,
            });
            // GreaterDepth is the "show me where something is nearer" trick that makes the
            // ghost read as occluded; it survives the node material, so it is set either way.
            spikeGhostMat.depthFunc = THREE.GreaterDepth;
            const spikeGhost = new THREE.Mesh(spikeGhostGeo, spikeGhostMat);
            spikeGhost.name = 'stylus_spike_ghost';
            spikeGhost.renderOrder = 9999;
            spikeGhost.visible = false;
            spikeMesh.add(spikeGhost);

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
            // Same pivot as the spike and as _controllerRay's picking origin -- see
            // updateStylusOffset. Without this the two are parallel but offset by
            // offset * sin(tilt).
            rayRoot.position.z = -defOffset;

            // Keep the 'connected' listener purely for diagnostic logging, 
            // AND robust static mapping!
            // A REAL CONTROLLER OUTRANKS A HAND FOR THE SAME HANDEDNESS.
            //
            // On Galaxy XR with hand tracking permitted, FOUR sources connect: two controllers
            // and two hands, and both of the left ones say handedness 'left'. This assigned on
            // handedness alone, so the last to connect won — and when that was the hand, the
            // wrist panels spent the session hanging off the HAND's grip object while the user
            // held a controller. three poses that object itself, every frame, from the hand's
            // gripSpace, which is why the panels' own transform read perfectly correct in
            // _panelDbg and they still rendered through the controller facing the floor. matt:
            // "normaly the menus rest mostly flat to the back of the controllers. now they slice
            // right through them."
            //
            // A hand may still claim a slot nothing else wants — that is how hands-only runtimes
            // get a controller object at all — but it never displaces a controller.
            controller.addEventListener('connected', (event) => {
                if (event.data && event.data.handedness) {
                    const hand = event.data.handedness;
                    const profiles = event.data.profiles ? event.data.profiles.join(', ') : 'none';
                    // if (window.screenLog) window.screenLog(`[XR] ${hand} profiles: [${profiles}]`, "cyan");

                    const _isHand = this._isHandSource(event.data);
                    this._srcObjs = this._srcObjs || { hand: {}, ctl: {} };
                    this._srcObjs[_isHand ? 'hand' : 'ctl'][hand] =
                      { ctl: controller, grip: this._renderer.xr.getControllerGrip(i) };
                    this._applyActiveInputObjects();
                }
            });

            controller.addEventListener('disconnected', (event) => {
                const hand = event.data?.handedness;
                // console.log(`[SculptGL] Controller [${i}] Disconnected (${hand})`);
                // if (window.screenLog) window.screenLog(`[XR] Controller [${i}] Disconnected (${hand})`, "red");

                if (hand !== 'left' && hand !== 'right') return;
                // Forget the ENTRY this object was, whichever kind it was, and re-derive. A
                // controller that powers off when you put it down must leave the hand able to
                // take over, and a hand that stops being reported must not strand the panels on
                // a dead object.
                for (const kind of ['hand', 'ctl']) {
                    const e = this._srcObjs?.[kind]?.[hand];
                    if (e && e.ctl === controller) delete this._srcObjs[kind][hand];
                }
                this._applyActiveInputObjects();
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

            // The node build first: this is the VR volume cursor -- the "radius sphere" -- and
            // it is the raw ShaderMaterial matt saw drawn black under ?renderer=webgpu, with
            // "THREE.NodeMaterial: Material ShaderMaterial is not compatible" beside it. Same
            // fresnel as the desktop one in Selection.js, so the same ported material.
            const volMat = NodeMaterials.fresnelGlow(0x4488ff) || new THREE.ShaderMaterial({
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

            // SEGMENT PAIRS, NOT A STRIP -- see src/render/lineStrip.js. `top` was named by
            // bisection as the first object whose draw starts the UBO flood under
            // WebGPURenderer, and it is a non-indexed THREE.Line, which draws with drawArrays:
            // the call every unexplained error in this hunt was on.
            const geoTop = stripGeometry(pointsTop);
            const geoBottomLeft = stripGeometry(pointsBottomLeft);
            const geoBottomRight = stripGeometry(pointsBottomRight);

            // depthWrite OFF with depthTest off -- see the note on the cursor group below.
            const matTop = new THREE.LineBasicMaterial({ color: 0x4488ff, depthTest: false, depthWrite: false, transparent: true, opacity: 0.8, linewidth: 2 });
            const matBottomLeft = new THREE.LineBasicMaterial({ color: 0x4488ff, depthTest: false, depthWrite: false, transparent: true, opacity: 0.8, linewidth: 2 });
            const matBottomRight = new THREE.LineBasicMaterial({ color: 0x4488ff, depthTest: false, depthWrite: false, transparent: true, opacity: 0.8, linewidth: 2 });

            const lineTop = new THREE.LineSegments(geoTop, matTop);
            lineTop.name = "top";
            const lineBottomLeft = new THREE.LineSegments(geoBottomLeft, matBottomLeft);
            lineBottomLeft.name = "bottom_left";
            const lineBottomRight = new THREE.LineSegments(geoBottomRight, matBottomRight);
            lineBottomRight.name = "bottom_right";

            const ringLine = new THREE.Group();
            ringLine.name = "cursor_ring";
            ringLine.add(lineTop);
            ringLine.add(lineBottomLeft);
            ringLine.add(lineBottomRight);
            group.add(ringLine);

            const dotGeo = new THREE.BufferGeometry();
            dotGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3));
            const dotMat = new THREE.PointsMaterial({ color: 0x4488ff, size: 2, sizeAttenuation: false, depthTest: false, depthWrite: false, transparent: true, opacity: 0.8 });
            const centerDot = new THREE.Points(dotGeo, dotMat);
            centerDot.name = "cursor_dot";
            ringLine.add(centerDot);

            group.visible = false;
            // A MATERIAL THAT REFUSES TO TEST DEPTH MUST NOT WRITE IT.
            //
            // `depthTest: false` says "draw me whatever is in front"; leaving depthWrite at its
            // default (TRUE) then says "...and everything drawn after me must respect where I
            // am". The two together stamp this overlay's depth into the buffer while ignoring
            // the buffer, so anything later that DOES depth-test gets punched out behind it --
            // and the VR panels, at renderOrder 11000 with depth testing on, are exactly that.
            // The cursor rides the controller, so it passes in front of the wrist panels
            // constantly. matt: "in volume tweak, select a joint, go near a bbox handle, menu
            // disappears" -- the joint handles had the same pair, and so did the reticle and the
            // cut-tool highlight. The trace found it by naming the occluder: `MiniPanel:
            // OCCLUDED by "top"`, "top" being an arc of this ring.
            //
            // Everything already written to draw over the world -- the motion trail, the pending
            // link, GizmoVR, the background quad -- pairs the two correctly. These four did not.
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
          // NEVER FRUSTUM-CULLED — the one overlay in this app that was.
          //
          // Screen recording on the GalaxyXR adds a SECONDARY (first-person observer) view to
          // the frame, so three sees three views rather than two. Its WebXRManager then takes
          // this branch:
          //
          //     if ( cameras.length === 2 ) setProjectionFromUnion( cameraXR, cameraL, cameraR );
          //     else cameraXR.projectionMatrix.copy( cameraL.projectionMatrix );  // "AR"
          //
          // and `cameraXR.projectionMatrix` is what the CULLING frustum is built from. With a
          // recorder attached it silently becomes the LEFT EYE's projection instead of the
          // union of both, so culling runs against a narrower, off-centre frustum and starts
          // discarding things that are plainly on screen.
          //
          // Every other overlay here already opts out — the rig batches, the pin leader, the
          // motion trails, the pending link, the null cruciform. The cursor never did, which is
          // precisely why it was the ONE thing that vanished while the rest of the app carried
          // on. matt: "it does something to the state of the immersive mode that breaks only a
          // small section of the app, not all of it."
          //
          // Per CHILD, not just the group: three tests each drawable object, and a Group has no
          // geometry to test.
          for (const _c of [this._vrCursorLeft, this._vrCursorRight]) {
            _c.frustumCulled = false;
            _c.traverse((o) => { o.frustumCulled = false; });
          }
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

  // THE WRIST HIDE, AS ONE EPISODE WITH ONE OWNER.
  //
  // `mesh.visible` on these three panels has three writers -- the swap, each panel's own show(),
  // and this hide -- and it is also READ as "is the menu open" by the hit tests, the main-menu
  // toggle and VrConfirm. With no arbitration between them the panel state comes apart, which is
  // what matt hit: "the minipanel is getting very glitchy. it disappears randomly, reappears
  // randomly, i can see sometimes it gets in a confused halfway state."
  //
  // Three rules, and between them the writers cannot fight:
  //
  //  * IT IS AN EPISODE, not a per-frame state. It starts on the edge and ends on the release,
  //    so a condition that flickers for one frame -- and `_vrPinGrabs` does exactly that when a
  //    hand drops out of the input snapshot -- cannot strobe the panels.
  //  * IT ALWAYS ENDS. The restore runs whatever has happened in between: pinned, unparented,
  //    hand lost, panel swapped. The old restore was skipped for any panel not currently on the
  //    grip and lived inside `if (uiGrip)`, so losing tracking mid-grab hid the menu for good.
  //  * AN EXPLICIT CHANGE WINS. Swapping panels or toggling the main menu during an episode ends
  //    it WITHOUT restoring: the user has just said what they want to see, and replaying a
  //    remembered visibility over the top of that is where the half-swapped states came from.
  _updateWristHide(wantHidden) {
    const panels = [this._miniPanel, this._toolPickerPanel, this._mainMenuPanel];
    if (wantHidden && !this._wristHideEpisode) {
      this._wristHideEpisode = panels.map((p) => [p, p?.mesh ? p.mesh.visible : null]);
      for (const [p] of this._wristHideEpisode) if (p?.mesh) p.mesh.visible = false;
    } else if (!wantHidden && this._wristHideEpisode) {
      this._endWristHide(true);
    }
  }

  _endWristHide(restore) {
    const ep = this._wristHideEpisode;
    this._wristHideEpisode = null;
    if (!ep || !restore) return;
    for (const [p, was] of ep) {
      if (!p?.mesh || was === null) continue;
      p.mesh.visible = was;
      // RE-SYNCED AND REPAINTED ON THE WAY BACK, exactly as _swapHtmlPanels does for a panel it
      // is about to show. A panel restored with the texture it happened to hold when it went
      // down shows whatever tool was current THEN, while everything painted since reads as the
      // tool that is current NOW -- which is the "confused halfway state where the highlighting
      // thinks its the bones tool, but the display is the grab tool" matt described.
      if (was) { p._setHostMounted?.(true); p.syncFromState?.(); p.flushPaint?.(); }
    }
  }

  _swapHtmlPanels(show) {
    // An explicit choice outranks a hide in progress — see _updateWristHide.
    this._endWristHide(false);
    // Sync + flush the incoming panel's texture BEFORE making it visible so
    // the mesh never appears with stale content even for a single frame.
    // Mount it into the host canvas first (it may have been unmounted while
    // hidden) so the flush actually rasterises it.
    const _prep = (p) => { if (!p) return; p._setHostMounted?.(true); p.syncFromState?.(); p.flushPaint?.(); };
    if (show === 'mini')   _prep(this._miniPanel);
    if (show === 'main')   _prep(this._mainMenuPanel);
    if (show === 'picker') _prep(this._toolPickerPanel);

    const mini   = this._miniPanel?.mesh;
    const picker = this._toolPickerPanel?.mesh;
    const main   = this._mainMenuPanel?.mesh;
    if (mini)   mini.visible   = (show === 'mini');
    if (picker) picker.visible = (show === 'picker');
    if (main) {
      // Pinned panels are world-anchored — don't hide them when swapping to another panel.
      const keepMain = show === 'main' || !!this._mainMenuPanel?.pinned;
      this._mainMenuPanel.show(keepMain);
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

  // HOW FAR A MESH REACHES ALONG A WORLD AXIS, measured from its actual corners.
  //
  // Placing one panel beside another by adding half-widths assumes three things: that the pivot
  // is centred, that `geometry.parameters.width` is the real width, and that no scale has been
  // applied since. Any one of those being wrong puts the panels on top of each other, and the
  // arithmetic still looks correct — which is exactly what happened. matt, spelling out what it
  // should do instead: "work out what is left of the current mainpanel location, align the RIGHT
  // side of the animation panel to be at least 10 pixels to the left of that."
  //
  // So: transform the eight corners of the mesh's own bounding box into world space, project
  // each onto the axis, and take the range. Pivot, scale and orientation all fall out of it.
  _extentAlong(mesh, axis) {
    if (!mesh || !mesh.geometry) return null;
    mesh.updateWorldMatrix(true, false);
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox;
    if (!bb) return null;
    let min = Infinity, max = -Infinity;
    const c = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      c.set(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z);
      c.applyMatrix4(mesh.matrixWorld);
      const d = c.dot(axis);
      if (d < min) min = d;
      if (d > max) max = d;
    }
    return { min, max };
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
      // A CHILD OF THE PANEL, like the close button — NOT a scene sibling repositioned by hand
      // every frame. See _layoutTimelineResizeHandle for why.
      // A child of the panel, so it rides one above whatever the panel is on -- see
      // VR_PANEL_RENDER_ORDER. Left at a bare 1000 it sat under the rig overlay with everything
      // else that assumed 1000 was the top of the world.
      this._vrResizeHandle.renderOrder = VR_PANEL_RENDER_ORDER + 1;
      this._vrResizeHandle.frustumCulled = false;

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
    // A pose remembered from earlier in this session outranks the first-open placement.
    const _tlRestored = this._restorePanelPose('timeline', this._vrTimelineMesh);
    if (cam && !_tlRestored) {
      if (mm) {
        // BESIDE THE MENU, NOT ON TOP OF IT. This used to open at the menu's exact world
        // position — matt: "it appears over where the mainpanel, confusing."
        //
        // Placed by EDGES, not by half-widths: put the panel at the menu, face it the same way,
        // then measure where both actually reach along camera-right and slide this one until its
        // RIGHT edge clears the menu's LEFT edge by a gap. Nothing here assumes where the pivot
        // is or that the stored width is the drawn width, which is what the half-width version
        // got wrong.
        //
        // CAMERA-right, not the menu's own right, so "left of the menu" means left from where
        // you are standing whatever angle the menu is held at.
        const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
        const pos = new THREE.Vector3();
        mm.getWorldPosition(pos);
        this._vrTimelineMesh.position.copy(pos);
        this._vrTimelineMesh.quaternion.copy(cam.quaternion);
        const menuExt = this._extentAlong(mm, camRight);
        const tlExt   = this._extentAlong(this._vrTimelineMesh, camRight);
        if (menuExt && tlExt) {
          const GAP = 0.02;   // ~36px at 1800 px/m; matt asked for at least 10
          this._vrTimelineMesh.position.addScaledVector(
            camRight, (menuExt.min - GAP) - tlExt.max);
        } else {
          // No measurable box (a panel whose geometry has not been built yet). Fall back to the
          // half-width guess rather than dropping the panel on the menu.
          const menuHalfW = (mm.geometry?.parameters?.width ?? 0.30) * 0.5;
          this._vrTimelineMesh.position.addScaledVector(
            camRight, -(menuHalfW + _worldW / 2 + 0.02));
        }
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
    this._layoutTimelineResizeHandle();
    this._vrTimelineCloseBtn.visible = true;
    tl.draw();
    if (this._vrTimelineTexture) this._vrTimelineTexture.needsUpdate = true;
    this._mainMenuPanel?._element?.querySelector('#mm-tl-btn')?.classList.add('tl-on');
    if (window.screenLog) window.screenLog('[VR Timeline] open', 'lime');
  }

  // WHERE THE SIDE PANELS ACTUALLY ARE, along the axis that decides whether they overlap.
  // Run it with the menu and a side panel open: if `gap` is negative they are on top of each
  // other, and the numbers say by how much and which assumption was wrong.
  panelDiag() {
    const cam = this._camera?.getThreeCamera();
    const mm = this._mainMenuPanel?.mesh;
    if (!cam || !mm) { console.log('[panels] no camera or main menu'); return null; }
    const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const rows = { menu: mm, timeline: this._vrTimelineMesh, layers: this._vrBlendMesh };
    const out = {};
    for (const [name, mesh] of Object.entries(rows)) {
      if (!mesh) { console.log('[panels] ' + name + ': not created'); continue; }
      const e = this._extentAlong(mesh, camRight);
      out[name] = e;
      console.log('[panels] ' + name.padEnd(9) + ' visible=' + mesh.visible
        + '  left=' + e.min.toFixed(3) + '  right=' + e.max.toFixed(3)
        + '  width=' + (e.max - e.min).toFixed(3)
        + '  scaleX=' + mesh.scale.x.toFixed(3));
    }
    if (out.menu && out.timeline) {
      console.log('[panels] timeline right edge to menu left edge: '
        + (out.menu.min - out.timeline.max).toFixed(3) + 'm (negative = overlapping)');
    }
    if (out.menu && out.layers) {
      console.log('[panels] menu right edge to layers left edge: '
        + (out.layers.min - out.menu.max).toFixed(3) + 'm (negative = overlapping)');
    }
    console.log('[panels] NOTE the main menu is WRIST-PARENTED unless pinned, so it moves after '
      + 'a side panel is placed. A gap that is positive here and an overlap in the headset means '
      + 'the menu came to the panel, not that the placement was wrong.');
    return out;
  }

  // WHY CAN'T THIS CONTROLLER MANIPULATE ANYTHING.
  //
  // A controller that preselects but cannot grab is always a LATCH that was set and never
  // released — never a dead controller, because preselection and manipulation run on different
  // paths and only the second one is gated. There are eight such latches and they are spread
  // across three files, which is why this has been diagnosed wrongly before. This prints all of
  // them, per hand, so the answer is read rather than guessed.
  grabDiag() {
    const tool = this._sculptManager?.getCurrentTool?.();
    const isGrab = tool?.constructor?.name === 'Grab';
    const pins = tool?._vrPinGrabs;
    const rows = [
      ['tool', tool?.constructor?.name || 'none'],
      ['dominant hand', this._dominantHand],
      ['_activeHandedness', this._activeHandedness || 'null'],
      ['_vrSculpting', !!this._vrSculpting],
      ['_vrLockedHand', this._vrLockedHand || 'null'],
      // Read off the flag rather than through RigPending: Scene does not import it, and a
      // diagnostic is not worth an import just to ask one question. The flag IS the storage —
      // RigPending owns the transitions, not the state (see the note at the top of that file).
      ['RigPending armed', this._rigPendingMode || 'no'],
      ['  (armed blocks EVERY tool)', this._rigPendingMode ? 'YES — this is the cause' : '-'],
      ['  pending subject', this._rigPendingSubject != null ? ('#' + this._rigPendingSubject) : '-'],
      ['_sculptLocked', !!window._sculptLocked],
      ['_isPointingAtMenu', !!this._isPointingAtMenu],
      ['_vtlIsPointing', !!this._vtlIsPointing],
      ['_vtlDragActive', !!this._vtlDragActive],
      ['_vtlResizeActive', !!this._vtlResizeActive],
      ['_mmDragActive', !!this._mmDragActive],
      ['controllers seen', [this._vrControllerLeft ? 'left' : null,
        this._vrControllerRight ? 'right' : null].filter(Boolean).join(',') || 'NONE'],
    ];
    if (isGrab) {
      rows.push(['Grab._grabbedMesh', tool._grabbedMesh ? ('#' + tool._grabbedMesh.getID()) : 'null']);
      rows.push(['Grab._vrPinGesture', tool._vrPinGesture ? 'live' : 'null']);
      rows.push(['Grab._vrPinGrabs', pins && pins.size
        ? [...pins.entries()].map(([h, g]) => h + '->#' + g.pin.getID()).join(' ') : 'empty']);
      rows.push(['Grab._vrPinTriggerWas', JSON.stringify(tool._vrPinTriggerWas)]);
    }
    for (const [k, v] of rows) console.log('[grab] ' + String(k).padEnd(28) + v);
    console.log('[grab] A pin still listed for a hand you are NOT holding, or a triggerWas stuck '
      + 'true, means Grab.updateXR returns early every frame and that hand can never grab. '
      + '"RigPending armed" blocks every tool in BOTH hands. A _vrLockedHand naming the other '
      + 'hand blocks a Transform drag only.');
    return rows;
  }

  _closeVRTimeline() {
    // Remember where it was BEFORE hiding it, so re-showing puts it back rather than re-placing.
    if (this._vrTimelineMesh) this._stashPanelPose('timeline', this._vrTimelineMesh);
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
    // SIZE IS THE USER'S, and it persists — the corner grip resizes this panel exactly as it does
    // the timeline, and the choice survives a reload the same way.
    //
    // The old fixed 0.17x0.23m is 255x345 css px at 1500 px/m, and that is where "i can only see
    // 4" came from: 345px, minus a 38px toolbar, a 30px Base row and the pad's share, leaves room
    // for about four 46px rows and the rest run off the bottom with no way to reach them. The
    // default is bigger now and, more to the point, it is no longer a ceiling.
    const _opts = getOptionsURL();
    const _worldW = _opts.vrBlendW > 0 ? _opts.vrBlendW : 0.26;
    const _worldH = _opts.vrBlendH > 0 ? _opts.vrBlendH : 0.42;
    // 1500 px/m, the same ratio the world plane uses, so UI elements keep their physical size as
    // the panel grows — resizing shows MORE, it does not magnify.
    const _cssW   = Math.round(_worldW * 1500);
    const _cssH   = Math.round(_worldH * 1500);

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
      this._vrBlendPanel._vrMesh = this._vrBlendMesh; // so the panel can anchor the keyboard to itself
      this._scene.add(this._vrBlendMesh);
      // The corner grip, same one the timeline has. A long layer list was unreachable before this
      // — the panel was a fixed height and the rows simply ran off the bottom.
      this._vrBlendResizeHandle = this._makeVRResizeGrip();
      this._layoutVRResizeGrip(this._vrBlendResizeHandle, this._vrBlendMesh);
      if (window.screenLog) window.screenLog(`[VR Blendshapes] mesh created ${_worldW}×${_worldH}m`, 'cyan');
    }

    // Spawn beside the wrist menu (reachable) but ALWAYS orient to face the camera
    // — same as the VR timeline. Copying the menu's own quaternion span-flips the
    // panel 180° in-plane (upside-down + mirrored), because the menu's up/facing
    // convention differs from a camera-facing plane. Offset along camera-right so
    // it sits next to the menu from the user's viewpoint.
    const mm  = this._mainMenuPanel?.mesh;
    const cam = this._camera?.getThreeCamera();
    // As with the timeline: a pose remembered this session beats the first-open placement.
    const _bsRestored = this._restorePanelPose('blendshapes', this._vrBlendMesh);
    if (cam && !_bsRestored) {
      const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
      if (mm) {
        // By EDGES, the same rule the timeline uses — see _extentAlong. This one goes RIGHT, so
        // opening both puts one either side of the menu rather than two panels in one place.
        const mPos = new THREE.Vector3(); mm.getWorldPosition(mPos);
        this._vrBlendMesh.position.copy(mPos);
        this._vrBlendMesh.quaternion.copy(cam.quaternion);
        const menuExt = this._extentAlong(mm, camRight);
        const bsExt   = this._extentAlong(this._vrBlendMesh, camRight);
        if (menuExt && bsExt) {
          this._vrBlendMesh.position.addScaledVector(
            camRight, (menuExt.max + 0.02) - bsExt.min);
        } else {
          const menuHalfW = (mm.geometry?.parameters?.width ?? 0.30) * 0.5;
          this._vrBlendMesh.position.addScaledVector(camRight, menuHalfW + _worldW / 2 + 0.02);
        }
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
    // REOPEN AT THE PERSISTED SIZE. The mesh and canvas are built once and reused, so without
    // this a resized panel came back at whatever it was first created with.
    if (this._vrBlendMesh) {
      const gw = this._vrBlendMesh.geometry.parameters.width;
      const gh = this._vrBlendMesh.geometry.parameters.height;
      if (Math.abs(gw - _worldW) > 1e-4 || Math.abs(gh - _worldH) > 1e-4) {
        this._vrBlendMesh.geometry.dispose();
        this._vrBlendMesh.geometry = new THREE.PlaneGeometry(_worldW, _worldH);
        this._vrBlendMesh.scale.set(1, 1, 1);
        this._vrBlendPanel.resizeVRCanvas(_cssW, _cssH);
        if (this._vrBlendTexture) { this._vrBlendTexture.dispose(); this._vrBlendTexture.needsUpdate = true; }
      }
      this._layoutVRResizeGrip(this._vrBlendResizeHandle, this._vrBlendMesh);
    }
    this._vrBlendPanel.setVRVisible(true);
    if (this._vrBlendTexture) this._vrBlendTexture.needsUpdate = true;
    this._mainMenuPanel?._element?.querySelector('#mm-bs-btn')?.classList.add('tl-on');
    if (window.screenLog) window.screenLog('[VR Blendshapes] open', 'lime');
  }

  _closeVRBlendshapes() {
    if (this._vrBlendMesh) this._stashPanelPose('blendshapes', this._vrBlendMesh);
    if (this._vrBlendMesh) this._vrBlendMesh.visible = false;
    if (this._vrBlendCloseBtn) this._vrBlendCloseBtn.visible = false;
    this._vrBlendPanel?.setVRVisible(false);
    this._mainMenuPanel?._element?.querySelector('#mm-bs-btn')?.classList.remove('tl-on');
  }

  // Map a UV hit on the blend mesh to canvas coords and dispatch to the panel.
  _onVRBlendshapesHit(uv, phase, solo = false) {
    const panel = this._vrBlendPanel;
    if (!panel) return;
    // A resize drag is not a press on the panel's contents. Without this the grab that grows the
    // panel also lands on whatever row happens to be under the corner.
    if (this._vbsResizeActive) return;
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

  // ── RESIZABLE VR PANELS, ONE IMPLEMENTATION ──────────────────────────────────────────
  //
  // The timeline grew a corner grip first; the blendshape panel needs the identical gesture, and
  // the identical gesture written twice is how this codebase has repeatedly ended up with two
  // copies that disagree. So the mechanics live here once and each panel supplies a DESCRIPTOR
  // saying what to resize and within what bounds.
  //
  // The maths is worth stating because it is the part that looks arbitrary: the drag holds the
  // panel's TOP-LEFT corner fixed and moves the opposite one, so the panel grows away from you
  // rather than re-centring under your hand. That corner, the mesh's right/down axes and the
  // plane of its face are all captured ONCE on press — recomputing them per frame from a panel
  // that is itself moving is a feedback loop, and the panel chases the controller.

  // Build the grip quad. Same three-diagonal-lines glyph the timeline has always used.
  _makeVRResizeGrip() {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const x = c.getContext('2d');
    x.clearRect(0, 0, 64, 64);
    x.strokeStyle = '#89dceb'; x.lineWidth = 4; x.lineCap = 'round';
    for (const [x1, y1, x2, y2] of [[16, 56, 56, 16], [28, 56, 56, 28], [40, 56, 56, 40]]) {
      x.beginPath(); x.moveTo(x1, y1); x.lineTo(x2, y2); x.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true,
      side: THREE.DoubleSide, depthTest: true, depthWrite: false });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.028, 0.028), mat);
    m.renderOrder = VR_PANEL_RENDER_ORDER + 1;
    m.frustumCulled = false;
    m.visible = false;
    return m;
  }

  // Park the grip in the panel's own space, bottom-right. A CHILD, so it inherits transform and
  // visibility and cannot disagree with the panel about either — see the note below.
  _layoutVRResizeGrip(grip, panelMesh) {
    if (!grip || !panelMesh) return;
    if (grip.parent !== panelMesh) panelMesh.add(grip);
    const hw = panelMesh.geometry.parameters.width  * 0.5;
    const hh = panelMesh.geometry.parameters.height * 0.5;
    grip.position.set(hw - 0.014, -hh + 0.014, 0.002);
    grip.quaternion.identity();
    grip.visible = true;
  }

  // Capture the frame the drag happens in. Returns the state the apply step needs.
  _beginVRPanelResize(panelMesh) {
    const q = panelMesh.quaternion;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const down  = new THREE.Vector3(0, -1, 0).applyQuaternion(q);
    const w = panelMesh.geometry.parameters.width;
    const h = panelMesh.geometry.parameters.height;
    return {
      // Top-left = centre - right*(w/2) - down*(h/2). Held fixed for the whole drag.
      corner: panelMesh.position.clone()
        .addScaledVector(right, -w / 2).addScaledVector(down, -h / 2),
      right, down,
      plane: new THREE.Plane().setFromNormalAndCoplanarPoint(
        new THREE.Vector3(0, 0, 1).applyQuaternion(q), panelMesh.position),
    };
  }

  // One frame of the drag. `d` is the descriptor:
  //   mesh, texture, panel (anything with resizeVRCanvas), px  (css px per world metre),
  //   minW/maxW/minH/maxH (metres), optW/optH (saveOption keys), after() (re-place children)
  _applyVRPanelResize(ray, st, d) {
    const hit = new THREE.Vector3();
    if (!ray.intersectPlane(st.plane, hit)) return false;
    const delta = hit.sub(st.corner);
    const w = Math.max(d.minW, Math.min(d.maxW, delta.dot(st.right)));
    const h = Math.max(d.minH, Math.min(d.maxH, delta.dot(st.down)));
    if (!d.panel || !d.mesh) return false;

    d.panel.resizeVRCanvas(Math.round(w * d.px), Math.round(h * d.px));
    // dispose() clears three's cached GL texture size, so the re-upload uses the NEW canvas
    // dimensions instead of stretching the old allocation into the new quad.
    if (d.texture) { d.texture.dispose(); d.texture.needsUpdate = true; }
    d.mesh.geometry.dispose();
    d.mesh.geometry = new THREE.PlaneGeometry(w, h);
    d.mesh.scale.set(1, 1, 1);
    // Re-place the children AFTER the half-extents changed, or the close button and the grip
    // itself sit at the old corners.
    d.after?.();
    d.mesh.position.copy(st.corner)
      .addScaledVector(st.right, w / 2).addScaledVector(st.down, h / 2);
    if (d.optW) window.saveOption?.(d.optW, +w.toFixed(3), 400);
    if (d.optH) window.saveOption?.(d.optH, +h.toFixed(3), 400);
    return true;
  }

  // THE CORNER GRIP, PLACED IN THE PANEL'S OWN SPACE.
  //
  // It used to be a scene sibling whose world position and orientation were recomputed every
  // frame from the panel's, and re-shown every frame — the close button next to it is a CHILD
  // and does not flicker, which is the difference this removes. matt: "the corner grip/resize
  // indicator in the lower right of the animation panel frequently hides/unhides."
  //
  // I have not isolated the exact trigger, so this is a structural fix rather than a targeted
  // one, and it closes off all three candidates at once: a transform written after the frame
  // was culled (one frame stale, which reads as flicker), a visibility flag that could disagree
  // with the panel's, and independent frustum culling of a 28mm quad. As a child it inherits
  // transform and visibility, and cannot disagree with the panel about either.
  //
  // Safe to parent because a resize rebuilds the panel's GEOMETRY and holds scale at 1 — a
  // scaled parent would stretch the grip.
  _layoutTimelineResizeHandle() {
    const h = this._vrResizeHandle, tl = this._vrTimelineMesh;
    if (!h || !tl) return;
    if (h.parent !== tl) tl.add(h);
    const hw = tl.geometry.parameters.width  * 0.5;
    const hh = tl.geometry.parameters.height * 0.5;
    h.position.set(hw - 0.014, -hh + 0.014, 0.002);
    h.quaternion.identity();   // local to the panel
    h.visible = true;
  }

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
      const m = NodeMaterials.laser() || new THREE.ShaderMaterial({
        vertexShader: `varying float vFade; void main() { vFade = 1.0 - clamp((uv.y - 0.5) * 2.0, 0.0, 1.0); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `varying float vFade; void main() { gl_FragColor = vec4(1.0, 1.0, 1.0, vFade * 0.85); }`,
        transparent: true, depthTest: true, depthWrite: false,
        blending: THREE.NormalBlending, side: THREE.DoubleSide,
      });
      this._vtlSecLaser = new THREE.Mesh(g, m);
      this._vtlSecLaser.visible = false;
      this._vtlSecLaser.renderOrder = VR_PANEL_RENDER_ORDER + 5;  // see pointer_ray_root
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

  // Two-handed VR zoom: when BOTH controllers point at empty timeline space with
  // triggers held, horizontal separation zooms time in graph and dopesheet modes;
  // graph mode additionally uses vertical separation for value zoom. Runs before dispatch
  // so it can suppress the single-hand pan.
  _updateVRTimelineZoom(leftSrc, rightSrc) {
    // Keep the non-dominant controller's aim laser in sync every frame.
    this._updateSecondaryTimelineLaser();

    const tl = this.getGui()?._ctrlTimeline;
    const mesh = this._vrTimelineMesh;
    if (!tl || !mesh || !mesh.visible || this._vtlResizeActive) { this._endVtlZoom(tl); return; }

    const pressed = (s) => { const b = this._padOf(s)?.buttons?.[0]; return !!b && (b.pressed || b.value > 0.1); };
    if (!pressed(leftSrc) || !pressed(rightSrc)) { this._endVtlZoom(tl); return; }

    const hitL = this._raycastTimeline(this._controllerRay(this._vrControllerLeft),  mesh);
    const hitR = this._raycastTimeline(this._controllerRay(this._vrControllerRight), mesh);
    if (!hitL || !hitR) { this._endVtlZoom(tl); return; }

    const cssW = tl._cssWidth, cssH = tl._cssHeight;
    const pL = { cx: hitL.uv.x * cssW, cy: (1 - hitL.uv.y) * cssH };
    const pR = { cx: hitR.uv.x * cssW, cy: (1 - hitR.uv.y) * cssH };

    if (!this._vtlZoomActive) {
      // Both controllers must be over usable timeline space to START the gesture.
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
    // The top resize grip (canvas y < 5) is a desktop-only affordance — it sits right
    // under the transport bar and wedges the timeline if grabbed in VR (the resize needs
    // mouse-move deltas it never gets here). VR resizes via _vrResizeHandle instead.
    if (type === 'down' && clientY < 6) return;
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
    // So everything that marks the main panel dirty reaches this one too -- see registerTorn.
    this._mainMenuPanel?.registerTorn?.(panel);
    this._mainMenuPanel?.notifyTearOff(sectionId);
  }

  _reDockSection(sectionId) {
    const panel = this._tornOffPanels.get(sectionId);
    if (!panel) return;
    // Unregistered BEFORE it is disposed: a disposed panel left in the set would be asked to
    // rebuild itself on the next markDirty, which is a rebuild into nothing at best.
    this._mainMenuPanel?.unregisterTorn?.(panel);
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
        depthTest: false, depthWrite: false, side: THREE.DoubleSide,
      });
      this._bpReticle = new THREE.Mesh(geo, mat);
      // ABOVE THE PANELS, WHICH IS THE ONLY PLACE IT IS EVER USEFUL.
      //
      // It sat at 1001 against panels at 11000, so the one surface whose intersection you most
      // need to see painted straight over it — matt: "it might be being drawn just under the
      // menu". Everything here is transparent, so renderOrder is the only lever and a number
      // chosen in isolation is a guess; taken from the panel constant it cannot drift when that
      // constant moves.
      // ABOVE THE MODALS TOO (+5), or the hit dot is buried exactly when you are typing on a
      // keyboard — the moment precise aim matters most. The pointer is the top of the ladder:
      //   panels +0 | gaze button +3 | radius preview +4 | modal overlays +5 | dots +7 | ray +8
      this._bpReticle.renderOrder = VR_PANEL_RENDER_ORDER + 8;
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

  // Hand-puppetry (#28 v1): drive the active head's transform from the wrist pose, RELATIVE
  // to an anchor captured when puppet mode turns on (or the active mesh changes). Rotation =
  // the wrist's world-space rotation delta since the anchor, applied about the head's own
  // pivot; position = the head's anchor position + the wrist's translation delta. So the head
  // starts exactly where it was authored and rides your hand from there — no snapping.
  // window.recenterPuppet() re-grabs neutral; window._puppetRot/_puppetPos = false isolate one.
  _drivePuppetHead(mesh, wt) {
    const id = mesh.getID();
    const wQuat = new THREE.Quaternion(wt.orientation.x, wt.orientation.y, wt.orientation.z, wt.orientation.w);
    // Wrist position → the mesh's PARENT (_worldGroup) space. The mesh matrix lives under
    // _worldGroup (scale ~0.7, moved/zoomed by VR nav), while the wrist pose is raw refSpace
    // metres — worldToLocal reconciles the frames + scale, so hand motion tracks 1:1 in
    // physical space instead of being swamped by the world scale (the "position locked" bug).
    const wg = this._worldGroup;
    const wLocal = wg ? wg.worldToLocal(new THREE.Vector3(wt.position.x, wt.position.y, wt.position.z))
                      : new THREE.Vector3(wt.position.x, wt.position.y, wt.position.z);
    let A = this._puppetAnchor;
    if (!A || A.meshId !== id) {
      const t = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
      new THREE.Matrix4().fromArray(mesh.getMatrix()).decompose(t, q, s);
      this._puppetAnchor = { meshId: id, wLocal: wLocal.clone(), wQuat: wQuat.clone(), t, q, s };
      return; // first frame = neutral; drive from the next
    }
    // rotation: wrist world-delta (wQuat · wQuat0⁻¹), optionally twist-corrected, applied
    // onto the head's anchor orientation.
    let rot;
    if (window._puppetRot === false) {
      rot = A.q.clone();
    } else {
      const dq = wQuat.clone().multiply(A.wQuat.clone().invert());
      // Twist correction: the wrist tracking frame and the head's authored facing can sit
      // ~90° apart about vertical, which turns a hand-NOD into a head-ROLL (ears→shoulders).
      // Conjugating the delta about world-up rotates its axes so nod→nod, leaving yaw (which
      // is about that same up axis) untouched. -90 lines up matt's sock-puppet grip;
      // override _puppetTwistDeg (90 / -90 / 180 / 0) for a different pose or head facing.
      const twistDeg = window._puppetTwistDeg ?? -90;
      if (twistDeg) {
        const R = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), twistDeg * Math.PI / 180);
        dq.premultiply(R).multiply(R.clone().invert()); // R · dq · R⁻¹
      }
      rot = dq.multiply(A.q);
    }
    // position: head anchor + wrist translation delta (in parent space). _puppetPosScale
    // damps/exaggerates the follow (1 = 1:1 physical).
    const pos = A.t.clone();
    if (window._puppetPos !== false) {
      pos.add(wLocal.clone().sub(A.wLocal).multiplyScalar(window._puppetPosScale ?? 1));
    }
    const M = new THREE.Matrix4().compose(pos, rot, A.s);
    mesh.setMatrix(M.elements);
    if (mesh.updateMatrices) mesh.updateMatrices(this._camera);
  }

  // THE ONE PLACE THAT ANSWERS "WHAT BUTTONS DOES THIS SOURCE HAVE".
  //
  // Hands have no real buttons, so the hand-tracking branch synthesises a pad from the pinch
  // and fist gestures. That pad used to be a loop-local, which meant every OTHER trigger read
  // in this file went to `src.gamepad` and got whatever the runtime felt like providing —
  // nothing on Quest hands, and on Apple Vision Pro an object that is truthy with an EMPTY
  // buttons array, so `buttons[0]` is undefined and every `if (src.gamepad)` guard sails
  // straight past it. Route trigger reads through here so the synthesised pad wins everywhere
  // at once rather than at the handful of sites someone remembered to update.
  _padOf(src) {
    if (!src) return null;
    // `src.hand` is the expiry condition, not just a lookup key. The synthesised pad is cached
    // per handedness across frames, so if you put the hands down and pick the controllers back
    // up, a cached mock with a stale pinch state would answer for a real controller forever.
    // A controller source has no hand, so it can never reach the cache.
    // THE RUNTIME'S OWN RECOGNISER OUTRANKS OURS, WHEN IT HAS ONE.
    //
    // This used to prefer the synthesised pad for any source carrying joints, which was right
    // while the only jointed runtime (visionOS) reported an EMPTY gamepad. Galaxy XR now gives
    // BOTH — 25 joints and a working gesture pad — and preferring the mock there would throw
    // away the recogniser that finally made clicking reliable in favour of our own thresholds.
    //
    // So: a real pad with buttons wins; the mock is the fallback for a runtime that has none.
    // Joints stay useful either way — they draw the dots and pose the wrist; they just stop
    // being the source of truth for "is this a press" on a runtime that already answers that.
    // WHICH KIND OF INPUT THIS HAND IS HOLDING, recorded here because this is already the one
    // place that has the source in front of it. The button-label cards read it: a hand has no
    // trigger, grip button or stick to describe, whether or not the runtime brings its own
    // gesture recogniser. See _ensureButtonLabels.
    if (src.handedness === 'left' || src.handedness === 'right') {
      this._handInput = this._handInput || {};
      this._handInput[src.handedness] = !!src.hand;
    }
    const realHasButtons = !!(src.gamepad && src.gamepad.buttons && src.gamepad.buttons.length);
    const mock = src.hand && !realHasButtons && this._mockGamepads && this._mockGamepads[src.handedness];
    if (mock) return mock;
    // An empty buttons array is not a gamepad; report it as absent so callers take their
    // no-controller path instead of reading undefined out of it.
    const pad = src.gamepad;
    if (!pad || !pad.buttons || !pad.buttons.length) return null;

    // A GESTURE PAD HAS TWO SIGNALS, NOT SIX, AND THE EXTRA SLOTS ARE NOT FACE BUTTONS.
    //
    // Galaxy XR presents hands as controller-shaped sources with a 5-button pad, and puts GRASP
    // at an index this app had already bound to A/X. So a fist toggled add/subtract on the
    // dominant hand and opened the menu on the non-dominant one — matt found it by accident,
    // which is the tell that nobody chose it.
    //
    // The length is what did it: `btns.length > 4` is how the A/X handlers decide a pad has face
    // buttons, and a 5-button gesture pad passes that test while having none.
    //
    // So hands get a NORMALISED view: select at 0, grasp at 1, nothing above. That matches the
    // pad this app synthesises for visionOS hands, so both runtimes now mean the same thing by
    // the same index, and the face-button handlers correctly see a pad too short to act on.
    //
    // Grasp is taken as "any button above 0 that the runtime reports pressed" rather than a
    // guessed index. A gesture pad only has select and grasp to report, so whichever slot it
    // uses, that is what it means — and this cannot go stale if the runtime renumbers them.
    if (!this._isHandSource(src)) return pad;
    if (!this._handPadView) this._handPadView = {};
    const key = src.handedness || 'none';
    const view = this._handPadView[key] || (this._handPadView[key] = {
      buttons: [{ pressed: false, value: 0 }, { pressed: false, value: 0 }],
      axes: [0, 0, 0, 0],
    });
    // THE VALUE MUST BE BINARY TOO, NOT JUST THE FLAG.
    //
    // Passing the runtime's analog value through looks harmless and is not: a hand's value is a
    // continuous closure signal that idles around 0.3, and code elsewhere reads VALUE rather
    // than `pressed`. The post-menu latch is the one that bit — it blocks a new stroke until the
    // trigger is "fully released" at <= 0.05, which that signal never reaches, so the first
    // pinch after using a menu was swallowed and only an exaggerated unpinch cleared it. matt:
    // "the first pinch on the sculpt after i select a tool often gets lost... i seem to have to
    // do a really over exaggerated unpinch".
    //
    // A gesture has no travel to report. Derive the value FROM the decision, so every consumer
    // of either field agrees.
    const sel = pad.buttons[0];
    view.buttons[0].pressed = !!(sel && sel.pressed);
    view.buttons[0].value   = view.buttons[0].pressed ? 1 : 0;
    let grasp = false;
    for (let i = 1; i < pad.buttons.length; i++) {
      const b = pad.buttons[i];
      if (b && b.pressed) { grasp = true; break; }
    }
    // A RUNTIME THAT RECOGNISES A PINCH DOES NOT NECESSARILY RECOGNISE A FIST.
    //
    // The mock pad carries our own fist latch on this same index, and it is discarded the moment
    // a runtime reports any buttons of its own — which is right for the pinch, whose recogniser
    // beats ours, and silently wrong for the fist when the runtime has no grasp to report. A
    // Quest 2 is exactly that case, and its shape is why the first attempt at this missed:
    // measured on device, its hand pad is TEN buttons long with only index 0 ever pressed, so a
    // fallback gated on a short pad never fired. matt: "it doesn't recognise the fist gesture".
    //
    // BUTTON COUNT SAYS NOTHING. A pad's length is whatever the runtime pads it out to; what
    // matters is whether anything above select has EVER reported a press. So that is what is
    // remembered, per hand, for the life of the session: until the runtime demonstrates it has a
    // grasp signal, ours fills the gap; from the first real grasp onward it is the runtime's
    // question to answer and this stops arguing with it. Sticky, because "not pressed right now"
    // is exactly what a grasp button looks like when your hand is open.
    const _hk = src.handedness === 'left' ? 'L' : 'R';
    if (!this._rtGraspSeen) this._rtGraspSeen = {};
    if (grasp) this._rtGraspSeen[_hk] = true;
    const _ownFist = !grasp && !this._rtGraspSeen[_hk]
      && !!(this._pinchLatch && this._pinchLatch[_hk]?.fist);
    view.buttons[1].pressed = grasp || _ownFist;
    view.buttons[1].value   = view.buttons[1].pressed ? 1 : 0;
    return view;
  }

  // UNDO AND REDO, ROUTED THE SAME WAY THE THUMBSTICK ROUTES THEM.
  //
  // A tool gets first refusal (onUndo), because some of them hold state the global stack knows
  // nothing about; only if it declines does the stack unwind. Copied behaviour would drift from
  // the thumbstick path, so both now call this.
  _doUndoRedo(redo) {
    if (!this._stateManager) return;
    const tool = this._sculptManager?.getCurrentTool?.();
    const fn = redo ? 'onRedo' : 'onUndo';
    if (!(tool && tool[fn] && tool[fn]())) {
      redo ? this._stateManager.redo() : this._stateManager.undo();
    }
    this._main ? this._main.render() : this.render();
  }

  // HANDS-ONLY UI, APPLIED AS A CLASS RATHER THAN AS SEPARATE MARKUP.
  //
  // A controller runtime already has X/A to swap panels and a thumbstick to undo, so putting
  // those on the panels there is clutter that costs panel space and rasteriser time. On hands
  // there is no button at all and they are the only way to reach either.
  //
  // One class on each panel root, with the extra controls present in the markup and hidden by
  // CSS. That keeps it a STYLE change rather than a markup change — HTMLVR panels need a full
  // _rebuildContent plus a cache-key revision when markup changes, and markDirty alone would
  // silently show a stale texture. Hiding with CSS needs only the repaint.
  _syncHandsOnlyUI() {
    const want = this._handsOnlyMode();

    // ONE FLUSH IS NOT ENOUGH, BECAUSE THE RASTERISER IS ASYNCHRONOUS.
    //
    // flushPaint() drains the polyfill's rAF queue synchronously, but the polyfill's own update()
    // awaits buildSvg() and then an image decode, while captureElementImage() hands back the
    // canvas recorded SO FAR. So the capture taken immediately after a class change is the
    // bitmap from before it — and it clears _dirty on the way past, so nothing ever asks again.
    // The panel then sits with the correct DOM (which is why the hover quad was right) under the
    // previous layout's texture until something unrelated forces a rebuild: matt, "the minipanel
    // actual text/buttons only update once i select a tool and back again", with the state
    // reading cls:'hands-only', mounted:true, dirty:false.
    //
    // The main menu escaped it only because _rebuildContent() starts further dirty cycles of its
    // own; the wrist panel has no such method, so its single missed capture was permanent.
    //
    // AND IT HAS TO ASK IN MILLISECONDS, NOT IN FRAMES. Repaints are throttled to one per
    // PAINT_MIN_MS (200ms, the host canvas's ~5fps ceiling for ambient repaints), so the first
    // attempt at this — six FRAMES, about 70ms on this headset — expired before a single paint
    // was ever permitted. Worse, flushPaint() clears _dirty before requesting, so when that one
    // request is throttled away the panel is left not-dirty and never retries: exactly the
    // "texture never repaints until I open the tool selector" that started this.
    //
    // A second of asking covers several throttle windows and any decode that lands late. It
    // costs a handful of repaints of two panels, once per input switch.
    if (this._handsRepaintUntil && performance.now() < this._handsRepaintUntil) {
      for (const p of [this._miniPanel, this._mainMenuPanel]) {
        if (p && p._element) p.markDirty?.();
      }
    }

    if (want === this._handsUiClassApplied) return;

    // DO NOT LATCH BEFORE THE PANELS EXIST.
    //
    // This ran once, on the frame hands-only first became true, and latched. At session start
    // that frame can arrive before the panels have elements — so the class went nowhere, the
    // latch said "done", and the wrist panel kept its controller layout for the rest of the
    // session. It only corrected itself when something ELSE forced a rebuild, which is why
    // opening the tool selector fixed it: matt, "as soon as i bring up the tool selector, the
    // correct hand controller variant appears."
    //
    // So the latch is set only once there is something to apply the class to. Until then this
    // returns without latching and tries again next frame.
    const panels = [this._miniPanel, this._mainMenuPanel].filter((p) => p && p._element);
    if (!panels.length) return;
    this._handsUiClassApplied = want;
    // RE-ARM THE PANEL PRIMING ON THE WAY OUT, so each switch BACK into hands shows the wrist
    // panel again. Priming is once-per-entry rather than once-per-session: picking the
    // controllers up and putting them down again is exactly the moment there is no button to
    // summon a menu with, and a latch set at session start would only ever help the first time.
    // Only on the transition out, so closing the panel while in hands mode does not reopen it.
    if (!want) this._handsUiPrimed = false;

    // THE DRAWN SPIKE AND THE PICKING TIP ARE TWO DIFFERENT THINGS, AND THE MODE MOVES ONLY ONE.
    //
    // getStylusLength()/Offset() decide where the tip is computed. The spike you SEE is a mesh
    // whose scale and position are written by updateStylusLength()/Offset(), which historically
    // only ran when a slider moved. Switching between controller and hand values changes what
    // the accessors return and touches no mesh — so the drawn spike kept the controller length
    // while picking used the hand one. matt, after a hands-only session: "the tip of the
    // controller spike and the pivot for the sphere radius indicator are misaligned."
    //
    // The transition is the moment to re-apply it, which is exactly where we already are.
    try {
      this.updateStylusLength?.(this.getStylusLength());
      this.updateStylusOffset?.(this.getStylusOffset());
    } catch (e) { console.warn('[hands] re-applying the spike geometry failed', e); }
    for (const p of panels) {
      p._element.classList.toggle('hands-only', want);

      // REBUILD, NOT JUST REPAINT. This is the distinction the HTMLVR notes keep warning about
      // and it caught me anyway: the class change updates the DOM immediately — the hover quad
      // measures the live DOM and was correctly laid out for the hands panel — while the
      // RASTERISED TEXTURE stayed on the controller layout. matt saw exactly that split: a hover
      // highlight in the right places over a picture of the wrong panel.
      //
      // flushPaint re-rasterises, but the polyfill caches against content, and a class that only
      // changes which rules apply does not move that cache. Asking the panel to rebuild its own
      // content is what invalidates it — which is why selecting a tool fixed it, since the swap
      // rebuilds on the way back.
      try {
        p.syncFromState?.();
        p._rebuildContent?.();
      } catch (e) { console.warn('[hands] rebuilding the panel content failed', e); }
      // THE PANEL CHANGES SIZE, SO THIS IS A RESIZE — and that is the whole fix.
      //
      // Revealed by reproducing it on the desktop: toggling the class takes the wrist panel from
      // 203px tall to 245px, because the hands-only row is added to the flow. A size change needs
      // _needsResize for the MESH (the plane keeps the old aspect otherwise and the texture is
      // stretched onto it), and _needsResize is also the ONE path that bypasses the 200ms ambient
      // rate limiter via requestPaintForced. Without it the repaint is merely requested politely,
      // and the limiter is free to drop it.
      //
      // It is also why opening the tool selector has always fixed it: that rebuild sets this same
      // flag in syncFromState, so the forced paint it triggers is the one that finally lands.
      p._needsResize = true;
      // A DRAG CANNOT SURVIVE THE INPUT CHANGING UNDER IT, and update() refuses to repaint at all
      // while one is live (`if (this._dirty && !this._sliderDragTarget)`). Putting the controllers
      // down mid-drag would otherwise leave the panel frozen with no way to release it.
      p._sliderDragTarget = null;
      if (p.flushPaint) p.flushPaint(); else p.markDirty?.();
      // ...and keep asking, for the reason at the top of this function. markDirty AFTER the
      // flush, because the flush cleared the flag on its way past.
      p.markDirty?.();
      this._handsRepaintUntil = performance.now() + (window._handsRepaintMs ?? 1000);
    }
  }

  // ONE ANSWER TO "WHERE IS THIS SOURCE AIMING", because three places were asking separately.
  //
  // The hand ray is corrected onto the three.js controller object (see _applyHandRayCorrection).
  // Anything that instead reads frame.getPose(targetRaySpace) gets the RAW visionOS ray, which
  // runs along the index finger and 45 degrees high — so it disagrees with the spike that is
  // drawn and with everything else that has been corrected.
  //
  // That had already happened twice: sculpting was fixed when it was found, and the brush cursor
  // was not, which put the radius sphere back at the base of the index finger while the spike it
  // belongs on pointed somewhere else. matt: "it feels like its at the base of my index finger
  // rather than on the tip of the spike." A fourth caller would have made the same mistake, so
  // the question now has one place to be asked.
  _rayMatrixFor(source, frame, refSpace) {
    if (source.hand) {
      const c = source.handedness === 'left' ? this._vrControllerLeft
              : source.handedness === 'right' ? this._vrControllerRight : null;
      if (c) return c.matrixWorld.elements;
    }
    const pose = source.targetRaySpace ? frame.getPose(source.targetRaySpace, refSpace) : null;
    return pose ? pose.transform.matrix : null;
  }

  // ARE THE TWO HANDS' RAY FRAMES MIRRORED? MEASURE IT, ONCE, AND SAY SO.
  //
  // The pitch correction is a rotation about the ray frame's own X. If the left hand's frame is
  // a mirror of the right's, that axis points the opposite way anatomically and the same signed
  // pitch tilts one hand down and the other up — which is what a spike that is "misoriented, it
  // should be the same angle but mirrored" looks like. If the frames are NOT mirrored, the same
  // sign is right for both and any difference is a matter of degree.
  //
  // Those two need different fixes and I cannot tell them apart from outside a headset, so this
  // measures it: project the ray frame's X onto the anatomical thumb-to-pinky axis, taken from
  // the metacarpals. Same sign on both hands means the frames are NOT mirrored.
  //
  // Once per hand per session, unconditionally — it is two lines in the log and it answers a
  // question that has already cost several sessions of guessing.
  _reportRayFrame(source, frame, refSpace, ctrl) {
    if (!this._rayFrameSeen) this._rayFrameSeen = {};
    const key = source.handedness;
    if (this._rayFrameSeen[key] || window._rayFrameReport === false) return;
    const idx = source.hand.get('index-finger-metacarpal');
    const pnk = source.hand.get('pinky-finger-metacarpal');
    const pi = idx && frame.getJointPose(idx, refSpace);
    const pp = pnk && frame.getJointPose(pnk, refSpace);
    if (!pi || !pp) return;
    this._rayFrameSeen[key] = true;

    const a = pi.transform.position, b = pp.transform.position;
    const toPinky = vec3.normalize(vec3.create(), vec3.fromValues(b.x - a.x, b.y - a.y, b.z - a.z));
    const e = ctrl.matrixWorld.elements;
    const rayX = vec3.normalize(vec3.create(), vec3.fromValues(e[0], e[1], e[2]));
    const d = vec3.dot(rayX, toPinky);
    console.log('[rayframe] ' + key + ' rayX . (index->pinky) = ' + d.toFixed(3)
      + '  => frame X points ' + (d > 0 ? 'toward the PINKY' : 'toward the THUMB')
      + '   (same sign on both hands = frames NOT mirrored, one pitch sign is correct for both)');
  }

  // THE PREVIEW SPIKE — the value you are choosing, on a copy, drawn over everything.
  //
  // Cloned from the real spike so it IS the thing being previewed rather than an approximation
  // of it, and depth-tested off with a high render order so a shorter pending length cannot hide
  // inside the longer live one. matt: "it shows it on a copy of the spike, set to 100% draw on
  // top, so it cant be hidden under the real spike if the length is made shorter."
  //
  // Parented to the same controller object as the real spike, so it inherits the live aim and
  // only the property being edited differs — which is the whole point of a preview.
  _updateSpikePreview(pending) {
    if (!pending) {
      if (this._spikePreviewMesh) this._spikePreviewMesh.visible = false;
      return;
    }
    const dom = this._dominantHand || 'right';
    const ctrl = dom === 'left' ? this._vrControllerLeft : this._vrControllerRight;
    const real = ctrl?.getObjectByName?.('stylus_spike');
    if (!real) { if (this._spikePreviewMesh) this._spikePreviewMesh.visible = false; return; }

    if (!this._spikePreviewMesh || this._spikePreviewMesh.userData._srcId !== real.id) {
      if (this._spikePreviewMesh?.parent) this._spikePreviewMesh.parent.remove(this._spikePreviewMesh);
      const m = real.clone();
      m.name = 'stylus_spike_preview';
      m.userData._srcId = real.id;
      m.traverse((o) => {
        if (!o.material) return;
        o.material = o.material.clone();
        o.material.depthTest = false;
        o.material.depthWrite = false;
        o.material.transparent = true;
        if (o.material.opacity !== undefined) o.material.opacity = 0.9;
        o.renderOrder = VR_PANEL_RENDER_ORDER + 6;   // over the panel AND over the real spike
        o.frustumCulled = false;
      });
      m.renderOrder = VR_PANEL_RENDER_ORDER + 6;
      m.frustumCulled = false;
      real.parent.add(m);
      this._spikePreviewMesh = m;
    }

    const p = this._spikePreviewMesh;
    p.position.copy(real.position);
    p.quaternion.copy(real.quaternion);
    p.scale.copy(real.scale);

    // Only the property under the finger differs from the live spike.
    const v = pending.value;
    if (/len/.test(pending.id))      p.scale.z = (v / 100) / 0.10;
    else if (/off/.test(pending.id)) p.position.z = real.position.z - ((v / 100) - this.getStylusOffset());
    else if (/pitch|tilt/.test(pending.id)) {
      const cur = /pitch/.test(pending.id) ? 0 : this.getStylusTilt();
      p.rotation.x = real.rotation.x + ((v - cur) * Math.PI / 180);
    }
    p.visible = true;
    p.updateMatrixWorld(true);
  }

  // THE RAY, AS AN ANATOMICAL CONSTRUCTION.
  //
  //   origin    = the pinch point — where thumb and index tips meet. That IS the click, so it is
  //               where the ray should start.
  //   direction = from the midpoint of the two METACARPAL bases toward that pinch point. It is
  //               the axis your hand already makes when you pinch and point.
  //   up        = the palm normal, from two vectors lying in the palm, so the roll is defined
  //               and stable rather than left to whatever lookAt picks by default.
  //
  // Convention-free: no runtime frame is consulted, so nothing here needs a per-device constant.
  _handRayFromJoints(source, frame, refSpace) {
    const h = source.hand;
    if (!h || !frame.getJointPose) return null;
    const jp = (n) => { const j = h.get(n); return j ? frame.getJointPose(j, refSpace) : null; };
    const tTip = jp('thumb-tip'), iTip = jp('index-finger-tip');
    const tBase = jp('thumb-metacarpal'), iBase = jp('index-finger-metacarpal');
    const pBase = jp('pinky-finger-metacarpal'), wrist = jp('wrist');
    if (!tTip || !iTip || !tBase || !iBase || !pBase || !wrist) return null;

    if (!this._jrA) {
      this._jrA = new THREE.Vector3(); this._jrB = new THREE.Vector3();
      this._jrUp = new THREE.Vector3(); this._jrM = new THREE.Matrix4();
      this._jrQ = new THREE.Quaternion(); this._jrT = new THREE.Vector3();
      this._jrU = new THREE.Vector3(); this._jrV = new THREE.Vector3();
    }
    const P = (p) => [p.transform.position.x, p.transform.position.y, p.transform.position.z];
    const [tx, ty, tz] = P(tTip), [ix, iy, iz] = P(iTip);
    this._jrA.set((tx + ix) / 2, (ty + iy) / 2, (tz + iz) / 2);          // pinch point
    const [bx, by, bz] = P(tBase), [jx, jy, jz] = P(iBase);
    this._jrB.set((bx + jx) / 2, (by + jy) / 2, (bz + jz) / 2);          // base of the pinch

    // Palm normal, for a defined roll. Cross of two vectors lying in the palm.
    const [wx, wy, wz] = P(wrist), [px, py, pz] = P(pBase);
    this._jrU.set(jx - wx, jy - wy, jz - wz);
    this._jrV.set(px - wx, py - wy, pz - wz);
    this._jrUp.crossVectors(this._jrU, this._jrV).normalize();
    if (!Number.isFinite(this._jrUp.x) || this._jrUp.lengthSq() < 1e-8) this._jrUp.set(0, 1, 0);

    // Degenerate hands (joints coincident) would make lookAt produce NaN.
    if (this._jrA.distanceToSquared(this._jrB) < 1e-8) return null;

    // lookAt builds a rotation whose -Z faces the target, which is the ray convention here.
    this._jrM.lookAt(this._jrB, this._jrA, this._jrUp);
    this._jrQ.setFromRotationMatrix(this._jrM);

    // THE ORIGIN MUST NOT MOVE BECAUSE YOU PINCHED.
    //
    // It was the tip midpoint, and the tips are the part of the hand the gesture MOVES — so the
    // ray's origin travelled through the pinch, every time, and the spike went with it. On the
    // Vision Pro and Galaxy XR the two tips converge symmetrically enough that the midpoint
    // barely shifts and it does not show. On a Quest 2 it shows badly: the tips are noisier, and
    // the moment they touch they occlude each other from the cameras so the estimate snaps.
    // matt: "the spike jumps noticably when i pinch".
    //
    // So the DIRECTION is still the anatomical one (knuckle base toward the pinch, which is the
    // ray matt described and asked for), and the origin is placed along it at a REACH that is
    // smoothed hard — the hand's size does not change while you use it, so a slow filter loses
    // nothing real and rejects the whole of the gesture's travel. The knuckle base itself is
    // stable in a way the tips are not: it is a rigid landmark, not a moving one.
    const _reach = Math.sqrt(this._jrA.distanceToSquared(this._jrB));
    const _rk = window._handReachSmooth ?? 0.02;   // per-frame blend; 1 = follow the tips exactly
    if (!this._jrReach) this._jrReach = {};
    const _rkey = source.handedness === 'left' ? 'L' : 'R';
    const _prev = this._jrReach[_rkey];
    const _rsm = (_rk < 1 && Number.isFinite(_prev)) ? _prev + (_reach - _prev) * _rk : _reach;
    this._jrReach[_rkey] = _rsm;
    this._jrT.subVectors(this._jrA, this._jrB).normalize().multiplyScalar(_rsm).add(this._jrB);
    return { origin: this._jrT, quaternion: this._jrQ };
  }

  // SHOW THE FINGERTIPS, BECAUSE "IS IT EVEN SEEING MY HAND" IS UNANSWERABLE FROM INSIDE.
  //
  // matt: "can we show on screen dots for where the finger and thumb are, so i have a better
  // sense of if the system is detecting them being brought together". Right question — a failed
  // click has several indistinguishable causes from inside the headset, and "tracking dropped
  // the joints" and "the pinch never registered" are two of them. Two dots that follow the tips
  // and change colour on the latch separate all three at a glance, with no console.
  //
  // The colour is driven by the SAME latch the trigger reads, not by a second distance test —
  // an indicator that agrees with a reimplementation instead of with the real signal is worse
  // than none, because it confirms whatever it happens to compute.
  // Hiding them is its own entry point, because the dots are drawn from the hand-pose path and
  // that path stops running the moment controllers take over — so nothing would be left to turn
  // them off, and they hung in the air through a controller session.
  _hideHandDots() {
    if (this._handDots) for (const k in this._handDots) this._handDots[k].visible = false;
  }

  _updateHandDots(source, tp, ip) {
    const on = window._handDots !== false;
    if (!on) { this._hideHandDots(); return; }
    if (!this._handDots) this._handDots = {};
    const key = source.handedness === 'left' ? 'L' : 'R';
    const mk = (name) => {
      if (this._handDots[name]) return this._handDots[name];
      // TRANSLUCENT. These draw over everything, menus included, because a dot hidden behind a
      // panel cannot report tracking on the panel you are pointing at. Drawing on top at full
      // opacity makes them punch holes in whatever you are reading — matt asked for 50% or
      // lower. Low enough to read through, opaque enough to see against a bright panel.
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.008, 12, 8),
        new THREE.MeshBasicMaterial({
          color: 0xffffff, depthTest: false, transparent: true,
          opacity: window._handDotOpacity ?? 0.45,
        }));
      m.frustumCulled = false;
      m.renderOrder = VR_PANEL_RENDER_ORDER + 7;   // above modals too — see the ladder above
      this._scene.add(m);
      this._handDots[name] = m;
      return m;
    };
    const pinching = !!this._pinchLatch?.[key]?.pinch;
    for (const [suffix, pose] of [['thumb', tp], ['index', ip]]) {
      const m = mk(key + suffix);
      if (!pose) { m.visible = false; continue; }   // joint lost: the dot vanishes, which is the signal
      const p = pose.transform.position;
      m.position.set(p.x, p.y, p.z);
      m.visible = true;
      // Green the instant the latch says the app treats this as a press.
      m.material.color.setHex(pinching ? 0x35ff6a : 0xffffff);
      // Re-read each frame so the knob works without a reload, and so the pinch state does not
      // get its own opacity by accident — the colour carries that signal, not the alpha.
      m.material.opacity = window._handDotOpacity ?? 0.45;
      m.updateMatrixWorld(true);
    }
  }

  // A HAND'S POINTING RAY IS NOT A CONTROLLER'S, AND VISIONOS AIMS IT HIGH.
  //
  // Apple gives a tracked hand a targetRaySpace that runs along the INDEX FINGER. That is a
  // reasonable reading of "where is this hand pointing" and it is not where you think you are
  // aiming: matt measured it at about 30 degrees high, and described the fix exactly — the aim
  // should key off "where my index and thumb would meet when they pinch", not where the index
  // finger points. Which is right, because the pinch IS the click; aiming from anywhere else
  // means the thing you press is not the thing you were looking at.
  //
  // The controller path has a knob for this already (stylus tilt), but it defaults to 0 and was
  // dialled in against a physical controller, so it is the wrong place to fix a hand.
  //
  // APPLIED TO THE three.js CONTROLLER OBJECT, not at each use. The visual spike is a CHILD of
  // that object and the panel raycast reads its matrixWorld, so correcting the object keeps the
  // drawn ray and the cast ray identical by construction. Two separate corrections would drift,
  // and a ray that does not go where it is drawn is worse than one that is simply wrong.
  //
  // window._handRayPitch is degrees, negative aims lower.
  _applyHandRayCorrection(source, frame, refSpace) {
    const ctrl = source.handedness === 'left' ? this._vrControllerLeft
               : source.handedness === 'right' ? this._vrControllerRight : null;
    if (!ctrl || !source.hand) return;

    // Origin: the pinch point, midway between the tips that come together to click.
    const tj = source.hand.get('thumb-tip'), ij = source.hand.get('index-finger-tip');
    const tp = tj && frame.getJointPose(tj, refSpace);
    const ip = ij && frame.getJointPose(ij, refSpace);

    if (!this._hrQ) { this._hrQ = new THREE.Quaternion(); this._hrV = new THREE.Vector3(); this._hrS = new THREE.Vector3(); }
    ctrl.matrix.decompose(this._hrV, this._hrQ, this._hrS);

    // GRIP FIRST, BECAUSE SOME RUNTIMES' TARGET RAY DOES NOT TURN.
    //
    // The spike translated with the hand and refused to rotate, while the Move tool's 6DOF was
    // perfect — matt asked why they differ, which is the whole answer: Move reads gripSpace and
    // the spike read targetRaySpace.
    //
    // And the profile says so out loud. Galaxy XR hands advertise "generic-hand-select-grasp,
    // generic-hand-select, GENERIC-FIXED-HAND" — a fixed ray, one that does not track hand
    // orientation. Nothing was broken; we were reading the pose that is declared not to turn.
    //
    // So: gripSpace when the source has one (it is the hand's own tracked frame, and it is what
    // every working 6DOF path in this app already uses), targetRaySpace when it does not —
    // visionOS hands carry no gripSpace at all and their target ray tracks properly.
    //
    // NOTE for the pitch: a grip frame and a pointing frame do not share an orientation
    // convention, so the correction that suits one will not suit the other. That is why the
    // angle is a per-runtime measurement rather than one constant.
    // BUILD THE RAY FROM THE HAND, NOT FROM THE RUNTIME'S FRAME.
    //
    // Every orientation bug in this file has been the same shape: a runtime hands us a frame, we
    // guess its convention, and measure a correction per device. visionOS wants one number, the
    // Galaxy XR grip wants another, and at pitch 0 the grip's forward pointed ACROSS the palm —
    // matt: "its vector matches an arrow drawn from the base of my pinky to the base of my index
    // finger... not facing in the direction of my thumb and index pinch."
    //
    // With joints we do not have to guess at all. matt's own description of the ray he wanted is
    // a construction: "from the midpoint of the base of my index and thumb, pointing towards
    // where my index and thumb would meet if i click." Both ends are joints, so the direction is
    // theirs and needs no per-runtime constant — the same on any runtime that reports a skeleton.
    //
    // The pitch knob survives for taste, but it should now be a small adjustment rather than a
    // 45-degree correction for a frame nobody documented. window._handRayFromJoints = false
    // falls back to the runtime frame.
    const _jointRay = (window._handRayFromJoints !== false)
      ? this._handRayFromJoints(source, frame, refSpace) : null;
    if (_jointRay) {
      this._hrQ.copy(_jointRay.quaternion);
      this._hrV.copy(_jointRay.origin);
      this._handRaySpaceUsed = 'joints';
    }
    const _poseSpace = _jointRay ? null : (source.gripSpace || source.targetRaySpace);
    if (_poseSpace) {
      const _rp = frame.getPose(_poseSpace, refSpace);
      if (_rp) {
        const _m = _rp.transform.matrix;
        if (!this._hrM) this._hrM = new THREE.Matrix4();
        if (!this._hrTmpV) { this._hrTmpV = new THREE.Vector3(); this._hrTmpS = new THREE.Vector3(); }
        this._hrM.fromArray(_m).decompose(this._hrTmpV, this._hrQ, this._hrTmpS);
        this._hrV.copy(this._hrTmpV);   // base position too, until the joints override it below
        this._handRaySpaceUsed = source.gripSpace ? 'grip' : 'targetRay';
      }
    }

    // SIGNED BY HANDEDNESS, OR THE LEFT SPIKE IS A COPY OF THE RIGHT RATHER THAN ITS MIRROR.
    //
    // -30 estimated from the headset, -35 after using it, -45 measured as correct. Applying that
    // same signed pitch to both hands was wrong in a specific way: matt, holding both hands in
    // front of him with index and thumb mirrored, got a left spike that "is an exact copy of
    // this... instead of being a mirror of the spike."
    //
    // The pitch is a rotation about the ray frame's own X, and WebXR gives both hands the SAME
    // frame convention rather than mirrored ones — the same fact that made the wrist yaw need a
    // handedness sign. So the anatomical meaning of +X flips between hands, and one signed pitch
    // tilts both the same way in space instead of mirroring them. The same anatomical tilt on
    // both hands needs opposite signs.
    //
    // Per-hand overrides still win outright and are NOT signed, so a value dialled in from the
    // console means exactly what it says for that hand.
    const _perHand = source.handedness === 'left' ? window._handRayPitchL : window._handRayPitchR;
    const _mirror = (source.handedness === 'left' && window._handRayMirror !== false) ? -1 : 1;
    // Window override first (a console trial), then the saved setting, then the measurement.
    // Without the middle term the Angle slider would work until the next reload and then
    // silently revert, which is worse than not having the slider.
    // +20, MEASURED ON GALAXY XR AGAINST THE ANATOMICAL RAY (2026-09-14).
    //
    // The old -45 was measured against a completely different construction — visionOS's
    // targetRaySpace, before the ray was rebuilt from joints — so it is stale, not a second
    // device's value. Carrying a number measured against a construction that no longer exists
    // would be worse than carrying one measured against the current one on a single device.
    //
    // So both runtimes start from the measured value. If the Vision Pro turns out to want
    // something different NOW, it gets its own constant the way the panel placement did — keyed
    // on gripSpace presence, and measured rather than derived.
    const _base = Number.isFinite(window._handRayPitch)
      ? window._handRayPitch
      : this._handStylus('handRayPitch', 20);
    const deg = Number.isFinite(_perHand) ? _perHand : _base * _mirror;
    if (deg) {
      if (!this._hrFix) this._hrFix = new THREE.Quaternion();
      // About the ray's OWN x, so the correction is a pitch in the hand's frame rather than a
      // world-space tilt that changes meaning as you turn your wrist over.
      this._hrFix.setFromAxisAngle({ x: 1, y: 0, z: 0 }, deg * Math.PI / 180);
      this._hrQ.multiply(this._hrFix);
    }
    // ...AND ONLY WHEN THERE IS NO JOINT RAY TO OVERRIDE. This line put the origin back on the
    // raw tip midpoint AFTER the joint construction had already placed it, so the stabilised
    // origin above could never have taken effect: the fix and the bug were both present, and the
    // bug ran last. It stays for the fallback path, where tp/ip are the only positions there are.
    if (!_jointRay && tp && ip) {
      const a = tp.transform.position, b = ip.transform.position;
      this._hrV.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    }
    // A HAND IN MID-AIR HAS NO WRIST REST. Optical hand tracking jitters, nothing damps it,
    // and the target is a button a couple of centimetres across at arm's length — matt: "the
    // right hand controller spike drifts too much, it takes me several attempts to click
    // anything". So the ray is smoothed toward its raw pose rather than following it exactly.
    //
    // Deliberately light. This is the same object the BRUSH aims with, and a heavily damped
    // sculpting ray would feel like drawing through treacle; the heavy smoothing belongs on the
    // panel, which is the thing being aimed AT. window._handRaySmooth is the per-frame blend,
    // 1 = no smoothing.
    const k = window._handRaySmooth ?? 0.35;
    const key = source.handedness === 'left' ? 'L' : 'R';
    if (!this._hrSm) this._hrSm = {};
    const prev = this._hrSm[key];
    if (k < 1 && prev) {
      this._hrV.lerpVectors(prev.p, this._hrV, k);
      prev.q.slerp(this._hrQ, k);
      this._hrQ.copy(prev.q);
    }
    this._hrSm[key] = { p: this._hrV.clone(), q: this._hrQ.clone() };

    ctrl.matrix.compose(this._hrV, this._hrQ, this._hrS);
    ctrl.matrix.decompose(ctrl.position, ctrl.quaternion, ctrl.scale);
    ctrl.updateMatrixWorld(true);
    this._handRayCorrected = true;

    this._updateHandDots(source, tp, ip);
    this._reportRayFrame(source, frame, refSpace, ctrl);
  }

  // WHERE THE WRIST PANEL ACTUALLY GOES, MEASURED BY HAND ON DEVICE 2026-09-13.
  //
  // Not derived, not reasoned about from a description — matt grabbed the panel in placement
  // mode and put it where he wanted it, and this is what came back. Three attempts to compute
  // this from a verbal description got the rotation right and the position wrong every time,
  // at one headset session each; the numbers below took one grab.
  //
  // The frame is the wrist ANCHOR, which already carries the handedness-signed yaw and the
  // lateral push in _poseGripFromWrist. So this offset sits ON TOP of those, and the two must
  // be read together: changing either without re-measuring moves the panel.
  //
  // Only applies on a hands-only runtime. A controller keeps the shared slot (wristPanelY /
  // wristPanelYaw), because a controller in your hand fixes the wrist angle for you and that
  // slot was tuned against it.
  //
  // KNOWN LIMIT: measured on a LEFT wrist with a right-dominant user. The yaw that carries it
  // is handedness-signed, but this rotation is not mirrored, so a left-dominant user will need
  // their own grab. Re-run with window._wristPlace = true.
  // The grab measured the panel's PLANE correctly and its FACING backwards: matt landed it in
  // the right place and then read it upside down, looking at the back of it. Both symptoms at
  // once is the signature of a half turn about the panel's own X — that negates up and negates
  // facing while leaving the left-right axis alone, which is exactly "flipped and reversed".
  // A half turn about Z would have been upside down but still front-on; about Y, back-on but
  // still the right way up.
  //
  // So the correction is applied about the PANEL's x, not the anchor's, and folded into the
  // measurement here rather than layered on at use — one number, one place, no composition
  // order for the next reader to get wrong. Verified: +X unchanged, +Y and +Z both negated.
  //
  //   as grabbed: rotXYZ(-157.1,  2.8,  81.4)   upside down, back face
  //   corrected:  rotXYZ(  22.9, -2.8, -81.4)
  //
  // FROZEN SINGLETONS, not fresh literals. A getter that builds a new object each call is read
  // from the panel mount every frame, which is an allocation per frame for a constant — and it
  // makes the two indistinguishable by identity, so nothing can assert WHICH one is in use.
  // THE MIRROR SIGN IS PART OF THE MEASUREMENT, not a separate fact. An HTMLVRPanel is built at
  // scale.y = -1 (it compensates for flipY=false in the rasterised texture), while placement mode
  // decomposes a matrix and so hands the panel back at +1. A number grabbed in one state and
  // applied in the other renders flipped — which is why normalising every hand panel to +1 fixed
  // Galaxy XR and turned the Vision Pro's menus upside down in the same stroke. The visionOS
  // number already has the half-turn correction above folded in, so it is right at the panel's
  // natural -1; the Galaxy XR number was grabbed raw and is right at +1. One `sy` per constant,
  // read at the point of use, is the whole of it.
  static get HAND_WRIST_PANEL() {
    return Scene._HWP || (Scene._HWP = Object.freeze({ p: [0.0001, -0.0017, 0.0253], r: [22.9, -2.8, -81.4], sy: -1 }));
  }

  // ...AND THE SAME THING MEASURED IN THE OTHER RUNTIME'S FRAME, on Galaxy XR 2026-09-14.
  //
  // These two are not interchangeable and neither is derivable from the other. The visionOS
  // number sits in a WRIST JOINT frame that this app synthesises because Safari gives hands no
  // gripSpace; the Galaxy XR number sits in the runtime's own GRIP frame, because its hands are
  // controller-shaped sources that have one. Different origins, different axis conventions.
  //
  // Also measured by hand rather than derived, for the same reason as the first: matt grabbed it
  // and put it where he wanted it.
  static get HAND_GRIP_PANEL() {
    return Scene._HGP || (Scene._HGP = Object.freeze({ p: [-0.0135, -0.0421, -0.0713], r: [-1.4, 28.2, -15.2], sy: 1 }));
  }

  // Which of the two applies is decided by where the anchor's pose came from, not by guessing at
  // the device: the wrist-joint substitution sets a flag when it runs, and the panel hangs off
  // the NON-dominant grip.
  _handPanelPlacement() {
    const nonDom = this._dominantHand === 'left' ? 'Right' : 'Left';
    const fromWrist = nonDom === 'Left' ? this._gripSpaceIsWristLeft : this._gripSpaceIsWristRight;
    return fromWrist ? Scene.HAND_WRIST_PANEL : Scene.HAND_GRIP_PANEL;
  }

  // PLACEMENT MODE — STOP GUESSING WHERE THE PANEL GOES AND LET matt PUT IT THERE.
  //
  // Three rounds of me deriving the wrist transform from a verbal description got the rotation
  // right and the position wrong, and each round cost a headset session. A description of a
  // position in 3D is a lossy encoding of the thing itself; grabbing it is not. So: pinch with
  // the dominant hand and the wrist panel follows that hand rigidly, in six degrees of freedom,
  // until you let go. Release prints the resulting offset in the wrist's own frame, which is
  // exactly the numbers needed to bake it in as the default.
  //
  // Every button is suppressed while this is on, because a pinch aimed at a panel is otherwise
  // a click — matt: "just for now disable all the buttons, and let me pinch it to rotate and
  // place it where it should be."
  //
  // TEMPORARY. On by default only on a hands-only runtime, and only until the numbers are in.
  // OFF by default now the measurement is taken — it suppresses every button while on, so it
  // must never be the state a user lands in. window._wristPlace = true to re-measure.
  _wristPlaceActive() { return window._wristPlace === true; }

  _updateWristPlacement(frame, refSpace) {
    if (!this._wristPlaceActive()) { this._wpDrag = null; return; }
    if (!this._wristPlaceOffset) {
      const _hp = this._handPanelPlacement(), _D = Math.PI / 180;
      this._wristPlaceOffset = new THREE.Matrix4().compose(
        new THREE.Vector3(_hp.p[0], _hp.p[1], _hp.p[2]),
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(_hp.r[0] * _D, _hp.r[1] * _D, _hp.r[2] * _D, 'XYZ')),
        new THREE.Vector3(1, 1, 1));
      console.log('[wrist place] ON — pinch with your ' + (this._dominantHand || 'right')
        + ' hand to grab the wrist panel and move it. Buttons are disabled. '
        + 'window._wristPlace=false to turn this off.');
    }
    const anchor = this._wristAnchor;
    if (!anchor) return;

    // The grabbing hand is the DOMINANT one; the panel lives on the other wrist.
    const dom = this._dominantHand || 'right';
    let domSrc = null;
    for (const sc of (this._xrSession?.inputSources || [])) {
      if (sc.handedness === dom && this._isHandSource(sc)) domSrc = sc;
    }
    const pressed = !!this._padOf(domSrc)?.buttons?.[0]?.pressed;
    if (!domSrc) { this._wpDrag = null; return; }

    // WHICHEVER POSE THIS RUNTIME ACTUALLY HAS.
    //
    // Preferred: the WRIST JOINT, because the grip object carries the very offset being
    // calibrated and driving the drag with it would feed the correction back into itself.
    // But Galaxy XR hands have no joints at all — they are controller-shaped sources with a real
    // gripSpace — so requiring a joint meant the grab silently did nothing there, every frame.
    // The raw gripSpace pose is the fallback: it is not the offset we are measuring (that lives
    // on the panel's local transform), so it is safe to drag with.
    const wj = domSrc.hand && domSrc.hand.get('wrist');
    let wp = wj ? frame.getJointPose(wj, refSpace) : null;
    if (!wp && domSrc.gripSpace) wp = frame.getPose(domSrc.gripSpace, refSpace);
    if (!wp) { this._wpDrag = null; return; }
    if (!this._wpHandM) { this._wpHandM = new THREE.Matrix4(); this._wpTmp = new THREE.Matrix4(); }
    this._wpHandM.fromArray(wp.transform.matrix);

    // Work in the ANCHOR's frame so both hands stay free to move: what matters is the hand's
    // pose RELATIVE to the wrist wearing the panel, not either one's absolute pose.
    anchor.updateMatrixWorld(true);
    const handInAnchor = this._wpTmp.copy(anchor.matrixWorld).invert().multiply(this._wpHandM);

    if (pressed && !this._wpDrag) {
      this._wpDrag = {
        invH0: handInAnchor.clone().invert(),
        L0: this._wristPlaceOffset.clone(),
      };
    } else if (pressed && this._wpDrag) {
      this._wristPlaceOffset
        .copy(handInAnchor)
        .multiply(this._wpDrag.invH0)
        .multiply(this._wpDrag.L0);
    } else if (!pressed && this._wpDrag) {
      this._wpDrag = null;
      const p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
      this._wristPlaceOffset.decompose(p, q, sc);
      const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
      const d = (r) => (r * 180 / Math.PI).toFixed(1);
      const out = 'pos(' + p.x.toFixed(4) + ', ' + p.y.toFixed(4) + ', ' + p.z.toFixed(4) + ')'
        + '  rotXYZ(' + d(e.x) + ', ' + d(e.y) + ', ' + d(e.z) + ')';
      window._wristPlaceResult = out;
      console.log('[wrist place] PLACED  ' + out
        + '\n              (offset is in the wrist anchor frame; window._wristPlaceResult)');
    }
  }

  // THREE POSES THE GRIP FROM gripSpace, AND VISIONOS HANDS DO NOT HAVE ONE.
  //
  // Every wrist-mounted panel hangs off the three.js controller GRIP object, and three only
  // ever writes that object's matrix from `inputSource.gripSpace`. An AVP hand has none, so the
  // grip sat at the world origin, failed the arm's-length sanity check in the UI mount, and the
  // panels never reached the hand. Fixing the gripSpace fallback earlier fixed OUR reads; it
  // did nothing for three's, because three never saw it.
  //
  // So pose the grip ourselves from the wrist joint. This is safe to do here because the app's
  // frame callback runs AFTER three has updated its controllers, so this write lands last; and
  // because the joint pose is read in renderer.xr.getReferenceSpace(), which is the exact space
  // three itself uses to pose grips — so the matrix means the same thing to both of us.
  //
  // THE WRIST JOINT FRAME, MEASURED RATHER THAN ASSUMED.
  //
  // A first guess of -90 degrees put the panel growing out of the PALM with its base across the
  // base of the fingers. That single observation pins both axes, because the panel is a plane
  // on the anchor's XY with its +Y up and its +Z facing you:
  //
  //   anchor +Y at -90 = -Z of the wrist, and it pointed out of the palm  => +Z_wrist is DORSAL
  //   anchor +Z at -90 = +Y of the wrist, and the panel stood along the fingers
  //                                                                      => +Y_wrist is DISTAL
  //
  // So the wrist joint's own frame already is what we want: +Y toward the fingertips (the panel
  // reads upright) and +Z out of the back of the hand (the panel faces you when you look at the
  // back of your hand, lying flat across it like a watch). The correction is therefore ZERO,
  // and the knob stays only so the next runtime that disagrees can be dialled in from inside a
  // session rather than guessed from outside one.
  //
  // That settled the ORIENTATION of the frame. Which FACE of the hand to use turned out to be a
  // separate question with a different answer — see the yaw below.
  _poseGripFromWrist(source, frame, refSpace) {
    const grip = source.handedness === 'left' ? this._vrControllerLeftGrip
               : source.handedness === 'right' ? this._vrControllerRightGrip : null;
    if (!grip || !source.hand) return;
    const wj = source.hand.get('wrist');
    if (!wj) return;
    const wp = frame.getJointPose(wj, refSpace);
    if (!wp) return;

    grip.matrix.fromArray(wp.transform.matrix);

    // ROUND THE HAND TO THE THUMB SIDE. The back of the hand was geometrically correct and
    // ergonomically wrong: hands naturally angle outward, so reading a panel on the dorsal face
    // means twisting your forearm to square it up. matt described the face he wanted precisely
    // — rest a fist on a table pinky-side down, and the flat made by the index and thumb is the
    // surface the menu should lie on. That is the RADIAL face, and with +Y distal and +Z dorsal
    // already established, its normal is +/-X: a yaw about the wrist, not another pitch.
    //
    // Signed by handedness, because WebXR gives both hands the SAME joint frame rather than
    // mirrored ones — so the anatomical direction of +X flips between them, exactly as it did
    // for the palm normal earlier. +90 puts it on the thumb side of a left hand.
    const yaw = (window._wristGripYaw ?? 90) * (source.handedness === 'left' ? 1 : -1);
    const pitch = window._wristGripPitch ?? 0;
    if (yaw || pitch) {
      if (!this._wristGripFix) this._wristGripFix = new THREE.Matrix4();
      if (!this._wristGripFix2) this._wristGripFix2 = new THREE.Matrix4();
      this._wristGripFix.makeRotationY(yaw * Math.PI / 180);
      if (pitch) {
        this._wristGripFix2.makeRotationX(pitch * Math.PI / 180);
        this._wristGripFix.multiply(this._wristGripFix2);
      }
      grip.matrix.multiply(this._wristGripFix);
    }

    // ROTATING IT WAS NOT MOVING IT. The yaw alone spun the panel in place about the wrist
    // axis, so it still straddled the middle of the hand — matt: "as if it was pinned in the
    // center of the menu where it was, and you've just turned it 90 degrees". To sit ON the
    // index-finger side it has to be pushed out there as well as turned to face that way.
    //
    // The push is along the anchor's own +Z, which is the face the panel looks out of. That
    // couples the two deliberately: flipping the yaw sign moves the panel to the OTHER side of
    // the hand AND turns it to face out of that side, instead of leaving it floating off one
    // side while facing the other. One knob, one coherent result.
    const outDist = window._wristGripOut ?? 0.045;
    if (outDist) {
      if (!this._wristGripOutM) this._wristGripOutM = new THREE.Matrix4();
      this._wristGripOutM.makeTranslation(0, 0, outDist);
      grip.matrix.multiply(this._wristGripOutM);
    }
    grip.matrix.decompose(grip.position, grip.quaternion, grip.scale);
    grip.visible = true;
    grip.updateMatrixWorld(true);
    this._gripPosedFromWrist = true;
  }

  // Hands, and nothing with buttons on it. On such a runtime there is no way to TOGGLE a menu,
  // so the wrist panel cannot start hidden the way it does on a controller device.
  // PRESENT IS NOT THE SAME AS IN USE.
  //
  // The first version asked "does any source have buttons", which is the right question only on
  // a runtime that never had controllers. Put the controllers down on a Galaxy XR and hands take
  // over — but the controllers stay ENUMERATED in inputSources, asleep, so a buttons-exist test
  // says "controllers" forever and the hands-only menus never appear. matt: "on gxr when i put
  // the controllers down it shows wireframe spheres where my hands are... but i can't bring up
  // the menus."
  //
  // So the test is USE, not presence: hands tracked, and nothing with buttons touched recently.
  // A controller picked back up fails the idle test on its first press — before the button it is
  // pressing can be read, because the press itself is what resets the timer — so the hands-only
  // controls go away on the same frame the controller comes back.
  //
  // The idle clock starts when a buttoned source is first SEEN, not at zero, or a session that
  // opens with untouched controllers would flip to hands-only the moment the window elapsed.
  // The radius preview sphere. BORROWED FROM THE BRUSH CURSOR, not invented.
  //
  // The first version used a wireframe, which was a design decision I had no business making:
  // this app already has a way of drawing "here is the brush radius" — the fresnel x-ray shell
  // on the cursor — and a preview that does not look like the thing it previews teaches the user
  // that they are two different things. matt: "its drawing it with a wireframe material rather
  // than the usual xray/fresnel falloff material."
  //
  // So the material and geometry are taken from the live cursor's volume_sphere. Cloning the
  // MATERIAL rather than sharing it keeps the preview's depth settings independent — it needs to
  // draw over the panel being dragged, which the in-world cursor does not.
  _radiusPreviewMaterial() {
    const cur = this._vrCursorRight || this._vrCursorLeft;
    const src = cur?.getObjectByName?.('volume_sphere');
    if (src?.material?.clone) {
      const m = src.material.clone();
      m.depthTest = false;     // over the menu it is being set on
      m.depthWrite = false;
      return m;
    }
    return null;   // cursor not built yet — try again next time rather than bake a fallback in
  }

  _updateRadiusPreview(point, radiusPhys) {
    if (this._radiusPreview && !this._radiusPreviewBorrowed) {
      // Built before the cursor existed; replace it now that the real material is available.
      const better = this._radiusPreviewMaterial();
      if (better) {
        this._radiusPreview.material?.dispose?.();
        this._radiusPreview.material = better;
        this._radiusPreviewBorrowed = true;
      }
    }
    if (!this._radiusPreview) {
      const geo = new THREE.SphereGeometry(1, 32, 24);
      const mat = this._radiusPreviewMaterial();
      this._radiusPreviewBorrowed = !!mat;
      const m = new THREE.Mesh(geo, mat || new THREE.MeshBasicMaterial({
        color: 0x4488ff, transparent: true, opacity: 0.35,
        depthTest: false, depthWrite: false, side: THREE.DoubleSide,
      }));
      m.frustumCulled = false;
      m.renderOrder = VR_PANEL_RENDER_ORDER + 4;
      m.visible = false;
      this._scene.add(m);
      this._radiusPreview = m;
    }
    const r = Number.isFinite(radiusPhys) ? radiusPhys : 0;
    if (r <= 0) { this._radiusPreview.visible = false; return; }
    this._radiusPreview.position.copy(point);
    this._radiusPreview.scale.setScalar(r);
    this._radiusPreview.visible = true;
    this._radiusPreview.updateMatrixWorld(true);
  }

  // A TRACE YOU CANNOT READ IS NOT A TRACE.
  //
  // Every probe this project has written goes through console.log, and on the Galaxy XR that
  // output never reaches the remote console — this app wraps console.log (index.html), and
  // whatever else is in the way, the result is silence. Returned VALUES do arrive, so the same
  // lines are also kept in a capped ring buffer that can simply be evaluated:
  //
  //   window._menuTrace = true;  ...gesture...  JSON.stringify(window._menuLog)
  //
  // Capped, because this is written from the frame loop and an unbounded array would grow for
  // the life of the session.
  _traceOut(line) {
    const t = '[menu] ' + line;
    console.log(t);
    if (!window._menuLog) window._menuLog = [];
    window._menuLog.push(t);
    if (window._menuLog.length > 60) window._menuLog.shift();
  }

  // A HAND IS NOT ALWAYS AN XRHand. TWO RUNTIMES, TWO SHAPES.
  //
  // visionOS gives hands as XRHand: 25 joints, no gamepad, no gripSpace. Galaxy XR gives them as
  // CONTROLLER-SHAPED sources — measured on device: xrHand=false, joints=0, gripSpace=true, a
  // 5-button gamepad, and profiles "generic-hand-select-grasp, generic-hand-select,
  // generic-fixed-hand". The runtime does the gesture recognition itself and hands us buttons.
  //
  // So `!!source.hand` is not the question. It is the question for JOINTS — dots, wrist poses,
  // our own pinch measurement — but not for "is the user using their hands", and conflating the
  // two is why the Galaxy XR showed no menus: its hand sources carry five buttons, so the
  // controller test claimed them and the hands-only UI never appeared.
  //
  // The profile is the portable answer. Real controllers advertise hardware names
  // (meta-quest-touch-plus, oculus-touch) or generic-trigger-squeeze-thumbstick; none of them
  // begin "generic-hand".
  _isHandSource(src) {
    if (!src) return false;
    if (src.hand) return true;
    const profiles = src.profiles || [];
    for (const p of profiles) {
      if (p.startsWith('generic-hand') || p === 'generic-fixed-hand') return true;
    }
    return false;
  }

  // ONE OBJECT PER HAND, POINTED AT WHICHEVER INPUT IS ACTUALLY DRIVING.
  //
  // `_vrControllerLeft/Right` and their grips are the single surface the whole app reads: the
  // spike hangs off them, the hand ray is written onto them, the cursor rides them and the wrist
  // panels hang off the grip. three poses each of those objects from ONE input source — the one
  // at its index — so whichever source owns the slot decides the frame everything else sits in.
  //
  // On a runtime with only one kind of input that is nobody's decision. On Galaxy XR with hand
  // tracking permitted there are FOUR sources, two of them claiming 'left', and it very much is:
  // the panel PLACEMENT is chosen by _handsOnlyMode(), while the FRAME it is applied in was
  // decided by whichever source connected last. Two mechanisms answering the same question, free
  // to disagree — and when they did, the panels were placed with one input's offsets in the
  // other input's frame. That is every orientation report on this device: menus through the
  // controller facing the floor when the controller slot met a hand grip, and facing the sky
  // when the hand placement met a controller grip.
  //
  // So both kinds are remembered as they connect and the ACTIVE one is selected here, from the
  // same _handsOnlyMode() that picks the placement. The pair can no longer disagree. Falls back
  // to the other kind when there is only one, which is what visionOS (hands, never controllers)
  // and a controller-only session each need.
  _applyActiveInputObjects() {
    const S = this._srcObjs;
    if (!S) return;
    const wantHand = this._handsOnlyMode();
    // THE FALLBACK IS THE LEAK. Filtering `sources` cannot reach these objects: three poses
    // xr.getController(i) from session.inputSources itself, and the spike and the laser hang
    // off that object. With hands off but no controller mapped for this side, the `|| S.hand[h]`
    // below picked the hand anyway, three kept posing it, and the spike went on tracking the
    // fingers. matt: "the controller spikes still follow my fingers". Picking nothing leaves it
    // to the hide loop underneath, which is already the one place that hides what we did not pick.
    const noHands = window._handTracking === false;
    for (const h of ['left', 'right']) {
      const pick = (wantHand ? (S.hand[h] || S.ctl[h])
                             : (S.ctl[h] || (noHands ? null : S.hand[h]))) || null;
      // AND THE ONE NOT CHOSEN IS HIDDEN, because it is not an abstraction — it is a three
      // object with a spike and a pointer ray hanging off it, and the runtime keeps giving it a
      // pose. Both were drawing: the hand's spike carries the hand length and sits within a few
      // centimetres of the controller's, since the hand in question is holding the controller.
      // matt: "the radius indicator was in the right positions, but the controlle spike was
      // still in the hands only mode" — two spikes, and the one he could see was the stale one.
      //
      // Written here rather than left to three, which sets visible from pose presence every
      // frame; the app's frame callback runs after three's update, so this lands last.
      for (const other of [S.hand[h], S.ctl[h]]) {
        if (!other || other === pick) continue;
        if (other.ctl)  other.ctl.visible  = false;
        if (other.grip) other.grip.visible = false;
      }
      if (h === 'left') {
        this._vrControllerLeft     = pick ? pick.ctl  : null;
        this._vrControllerLeftGrip = pick ? pick.grip : null;
      } else {
        this._vrControllerRight     = pick ? pick.ctl  : null;
        this._vrControllerRightGrip = pick ? pick.grip : null;
      }
    }
  }

  _handsOnlyMode() {
    // HANDS SWITCHED OFF IS NOT A MODE HANDS CAN WIN. Asked in ten places -- stylus length and
    // offset, the wrist panel placement, the UI prime -- and every one of them should read the
    // switch, so it is answered once here rather than at each call.
    if (window._handTracking === false) return false;
    const srcs = this._xrSession?.inputSources;
    if (!srcs || !srcs.length) return false;
    const now = performance.now();
    let anyHand = false, anyController = false;
    for (const s of srcs) {
      if (this._isHandSource(s)) { anyHand = true; continue; }   // hands never count as controllers,
      const pad = s.gamepad;                                      // however many buttons they carry
      if (!pad || !pad.buttons || pad.buttons.length <= 4) continue;
      anyController = true;
      if (this._lastControllerUse === undefined) this._lastControllerUse = now;
      const pressed = pad.buttons.some((b) => b && (b.pressed || b.value > 0.1));
      const moved   = (pad.axes || []).some((a) => Math.abs(a) > 0.2);
      if (pressed || moved) this._lastControllerUse = now;
    }
    if (!anyHand) return false;
    if (!anyController) return true;       // nothing but hands present

    // WHICHEVER INPUT WAS USED MOST RECENTLY WINS.
    //
    // The first attempt returned true only WHILE a hand button was pressed, which oscillated:
    // true during a pinch, false between pinches, so the class and the panel placement latched
    // and unlatched at gesture rate. A moment of proof has to be remembered, not merely noticed.
    //
    // Recording both and comparing is symmetric and needs no special case in either direction:
    // pinch and the menus come to your hand, pick up a controller and press anything and they go
    // back, and neither can be stolen by the other merely sitting there.
    for (const s2 of srcs) {
      if (!this._isHandSource(s2)) continue;
      if (this._padOf(s2)?.buttons?.[0]?.pressed) { this._lastHandUse = now; break; }
    }
    if (Number.isFinite(this._lastHandUse) && this._lastHandUse >= this._lastControllerUse) return true;

    // NEITHER HAS BEEN USED YET, AND A PRESENT CONTROLLER WINS THAT TIE.
    //
    // This used to fall back to "the controllers have gone quiet for 3 seconds", which reads a
    // silence as a decision. It is not one: a session that opens with controllers in your hands
    // is silent for as long as you do not press anything, so the menus flipped to the hand
    // placement on their own a few seconds in, while you were still holding the controllers.
    // matt, setting up a recording on the Galaxy XR: "if i start in controllers mode the menus
    // are at the wrong orientation."
    //
    // A tracked hand is not evidence of anything on these runtimes — both report hands the whole
    // time, whether you are using them or not. A CONNECTED CONTROLLER is evidence: you picked it
    // up and turned it on. So it holds the session until a hand is actually used, which takes
    // one pinch and is detected above. Putting the controllers down is still covered without any
    // timer, and better: they power off, the source disappears, `anyController` goes false, and
    // the branch above returns true on its own.
    return false;
  }

  // A BUTTON YOU LOOK AT, BECAUSE APPLE OWNS EVERY GESTURE WORTH BINDING.
  //
  // On visionOS the index pinch is the system select, palm-up is the Home View, and the crown
  // is recenter. That leaves no posture to claim for "open the menu" without fighting the OS —
  // palm-up was tried on device and lost to Home View. So instead of inventing a gesture, this
  // gives gaze something to land on: a small button that follows your view, which you open with
  // the same look-and-pinch you use for everything else on the platform.
  //
  // It deliberately reuses the ordinary panel hit path rather than adding a second input route.
  // A transient-pointer source has handedness 'none', so the controller lookup upstream returns
  // null and the raycast falls through to the raw targetRaySpace pose — which IS Apple's gaze
  // ray, already calibrated, already accurate. The button is just another entry in _panelHits.
  //
  // Hidden unless the session is actually driving hands with no buttons (window._gazeMenu
  // forces it on for testing on a controller device).
  // OFF BY DEFAULT. Tested on device and it was the wrong shape: matt had to turn his pinching
  // hand a long way to aim at it, could highlight it but took several attempts to click it. A
  // target you must acquire is worse than a panel that is simply already on your wrist. Kept
  // behind a flag because it is the only menu route that survives losing wrist tracking.
  _gazeMenuWanted() { return window._gazeMenu === true; }

  _ensureGazeMenuButton() {
    if (this._gazeMenuBtn) return this._gazeMenuBtn;
    const c = document.createElement('canvas');
    c.width = 256; c.height = 128;
    const x = c.getContext('2d');
    const draw = (hot) => {
      x.clearRect(0, 0, 256, 128);
      x.fillStyle = hot ? 'rgba(40,90,140,0.95)' : 'rgba(0,0,0,0.72)';
      x.beginPath(); x.roundRect(4, 4, 248, 120, 22); x.fill();
      x.strokeStyle = hot ? '#7fd1ff' : '#6a6a6a';
      x.lineWidth = 4; x.stroke();
      // Plain text, not a glyph icon — see the no-emoji rule.
      x.fillStyle = '#fff';
      x.font = '600 54px -apple-system, Helvetica, Arial, sans-serif';
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText('MENU', 128, 68);
    };
    draw(false);
    const tex = new THREE.CanvasTexture(c);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.045), mat);
    mesh.frustumCulled = false;
    // EVERYTHING IN THIS APP IS TRANSPARENT, so layering is manual and renderOrder is the only
    // lever. This sits above the panels it opens, since a menu button behind its own menu is
    // unreachable. Kept in the same band as the other always-visible overlays.
    mesh.renderOrder = VR_PANEL_RENDER_ORDER + 3;
    mesh.visible = false;
    this._scene.add(mesh);
    this._gazeMenuBtn = mesh;
    this._gazeMenuBtn._redraw = (hot) => { draw(hot); tex.needsUpdate = true; };
    this._gazeMenuHot = false;
    return mesh;
  }

  _updateGazeMenuButton() {
    const want = this._gazeMenuWanted();
    if (!want) { if (this._gazeMenuBtn) this._gazeMenuBtn.visible = false; return; }
    const m = this._ensureGazeMenuButton();

    // THE HEAD POSE MUST COME FROM THE SAME SPACE THE BUTTON LIVES IN.
    //
    // frame.getViewerPose(refSpace) is the obvious source and it is the WRONG ONE here: it
    // reports the head in the reference space, while this mesh is parented into the three.js
    // scene, and three applies its own camera rig on top. Where those two disagree the button
    // is placed correctly in a space nobody is looking from — the same two-spaces trap that
    // cost four sessions on the motion-path work. The XR camera IS the three-side head, so it
    // needs no conversion and cannot drift from the mesh it positions.
    const xr = this._renderer && this._renderer.xr;
    const cam = xr && xr.getCamera && xr.getCamera(this._camera?.getThreeCamera?.());
    if (!cam) { m.visible = false; return; }
    cam.updateMatrixWorld(true);
    const H = cam.matrixWorld.elements;
    const right = [H[0], H[1], H[2]];
    const up    = [H[4], H[5], H[6]];
    const fwd   = [-H[8], -H[9], -H[10]];
    const hp    = [H[12], H[13], H[14]];

    // Parked below the line of sight and towards the NON-dominant side, so it is never in
    // front of what you are sculpting but is always a glance away.
    const D  = window._gazeMenuDist ?? 0.55;
    const DX = (window._gazeMenuX ?? 0.16) * (this._dominantHand === 'right' ? -1 : 1);
    const DY = window._gazeMenuY ?? -0.17;
    const target = [
      hp[0] + fwd[0] * D + right[0] * DX + up[0] * DY,
      hp[1] + fwd[1] * D + right[1] * DX + up[1] * DY,
      hp[2] + fwd[2] * D + right[2] * DX + up[2] * DY,
    ];

    // EASED, NOT HEAD-LOCKED. A button welded to the head moves with every micro-motion and
    // reads as dirt on the lens; letting it lag lets your eye treat it as an object in the
    // room that happens to keep up.
    if (!m.userData._placed) { m.position.set(target[0], target[1], target[2]); m.userData._placed = true; }
    else m.position.lerp(new THREE.Vector3(target[0], target[1], target[2]), window._gazeMenuLag ?? 0.12);
    m.lookAt(hp[0], hp[1], hp[2]);
    m.visible = true;
    m.updateMatrixWorld(true);
  }

  // Called from the panel dispatch when the gaze ray presses the button.
  _gazeMenuPressed() {
    const mainVisible = !!(this._mainMenuPanel?.mesh?.visible);
    this._swapHtmlPanels(mainVisible ? 'mini' : 'main');
    console.log('[gaze menu] ' + (mainVisible ? 'MainMenu -> MiniPanel' : 'MiniPanel -> MainMenu'));
  }

  handleXRInput(frame, refSpace) {
    // SPLIT, because this one section is 3,000 lines and it swung from 0.84ms to 8.71ms with a
    // menu open — which is a specific thing happening, not "input is slow". The labels here
    // replace the outer bucket for the part they cover; whatever is left over shows as
    // xr-pose, and that remainder is itself a useful number.
    this._mark('xr-pose');
    try {

    const xrInputNow = performance.now();
    if (this._lastXRInputFrameAt && xrInputNow - this._lastXRInputFrameAt > 500) {
      this._recoverXRTransientInput('frame interruption');
    }
    this._lastXRInputFrameAt = xrInputNow;

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

    this._isPointingAtMenu = false;
    if (this._bpCursorDot) this._bpCursorDot.visible = false; // legacy; kept for safety
    if (this._bpReticle) this._bpReticle.visible = false; // reset each frame; panel hit logic re-shows it
    this._vrUIHitDistLeft   = Infinity;  // reset each frame — prevents stale laser depth
    this._vrUIHitDistRight  = Infinity;  // from persisting when _isPointingAtMenu is set by another source
    this._vrUIHitSourceLeft  = null;     // debug: which panel set the left hit distance
    this._vrUIHitSourceRight = null;     // debug: which panel set the right hit distance
    // THE PANEL THE RAY WAS ON, AND WHEN — see _panelGrabIntent.
    this._panelRayLatch = { left: null, right: null };

    const session = frame.session;
    // HANDS CAN BE SWITCHED OFF, and this is the one place worth doing it.
    //
    // matt, testing with a keyboard in the headset: "when testing and i drop the controls to
    // type, its annoying that it starts to track my hands, interprets my typing hands as a fist,
    // and starts moving the world all over the place." A runtime that offers hand tracking
    // alongside controllers hands us BOTH, and typing looks enough like a grip gesture to drive
    // the world grip.
    //
    // Filtered out of `sources` rather than gated at the eleven places _isHandSource is asked,
    // because everything downstream -- grips, pinches, tools, panels, the laser -- reads this one
    // array. A source that is not in it cannot drive anything, and nothing else has to know.
    //
    // Settings > Input > Hand tracking, or window._handTracking = false from the console. ON by
    // default: this is a "put it down for a minute" switch, not a change of stance on hands.
    // The saved preference becomes the live flag once, so a console override still wins after.
    if (window._handTracking === undefined) {
      window._handTracking = getOptionsURL().handTracking !== false;
    }
    const _srcAll = session.inputSources;
    const sources = (window._handTracking === false)
      ? Array.prototype.filter.call(_srcAll, (s) => !this._isHandSource(s))
      : _srcAll;
    window._vrInputSources = sources;

    // BEFORE THE UI MOUNT READS uiGrip.matrixWorld, NOT DURING THE INPUT LOOP.
    //
    // The wrist-panel mount runs earlier in this function than the per-source loop does, so
    // posing the grips down there would hand the panels last frame's wrist. The existing note
    // on that mount already records what a one-frame lag costs on a hand-carried target:
    // a single-frame uv jump of 0.44 to 1.09, from a hand that was as still as a hand gets.
    // A PRESS THAT CANNOT BE RELEASED IS WORSE THAN ONE THAT CANNOT BE MADE.
    //
    // The system pinch is latched by selectstart and cleared by selectend/select. If either is
    // ever missed — a lost frame, a session blur, the source torn down mid-pinch — the trigger
    // stays down for the rest of the session and every stroke after it is a mis-stroke. matt:
    // "i'm sure i pull my fingers apart, but it seems to not detect this and will do a
    // mis-stroke."
    //
    // The transient-pointer source EXISTS only for the duration of a pinch, so its absence is an
    // independent statement that the pinch is over — one that cannot be missed, because it is a
    // state rather than an event. Checked every frame, so a dropped release self-heals.
    let _anyTransient = false;
    for (const _s of sources) if (_s.targetRayMode === 'transient-pointer') _anyTransient = true;
    if (!_anyTransient) this._sysPinchActive = false;

    // Re-derived every frame, because which input is driving changes mid-session and the objects
    // have to follow it there — not only at connect time.
    this._applyActiveInputObjects();

    // ONLY WHILE THE HANDS ARE THE INPUT. Both of these WRITE THE CONTROLLER OBJECT — the same
    // three object the wrist panels hang off and the spike is drawn from — and they were run for
    // any source carrying joints, every frame, whatever the user was actually holding.
    //
    // On visionOS that is harmless, because there is nothing else to hold. On Galaxy XR it is
    // not: its hands report joints AND a gripSpace, and the runtime keeps reporting them while
    // you hold the controllers. So the hand pose was overwriting the real controller pose every
    // frame, pitching the panels by the hand-ray angle and hanging them off the pinch point.
    // matt: "normaly the menus rest mostly flat to the back of the controllers. now they slice
    // right through them... the menu itself is facing towards the floor" — with the panel's own
    // local transform reading exactly right in _panelDbg, which is what pointed at the parent.
    //
    // The fingertip dots come from the same path, which is why they also stayed up in controller
    // mode; they now get turned off explicitly rather than by the path ceasing to run.
    const _handsDrive = this._handsOnlyMode();
    if (_handsDrive) {
      for (const _s of sources) {
        if (_s.hand && !_s.gripSpace) this._poseGripFromWrist(_s, frame, refSpace);
        if (_s.hand) this._applyHandRayCorrection(_s, frame, refSpace);
      }
    } else {
      this._hideHandDots();
    }

    this._syncHandsOnlyUI();
    this._updateWristPlacement(frame, refSpace);
    this._updateGazeMenuButton();

    // NO BUTTONS MEANS NO WAY TO SUMMON A MENU, so the wrist panel starts visible rather than
    // waiting for a press that can never come. Once only per session: after this the user is
    // free to swap or close panels like anyone else, and re-showing it every frame would fight
    // them. matt: "can the minimenu not be just on from the start, and parented to my left hand
    // like it currently gets parented to the left controller".
    if (!this._handsUiPrimed && this._handsOnlyMode()) {
      this._handsUiPrimed = true;
      try {
        this._swapHtmlPanels('mini');
        console.log('[hands] no buttons on this runtime — wrist MiniPanel shown by default');
      } catch (e) { console.error('[hands] priming the wrist panel failed', e); }
    }

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

        // THE MENU GETS OUT OF THE WAY WHILE THE HAND WEARING IT IS BUSY (roadmap #72).
        //
        // The wrist panels hang off the NON-DOMINANT grip, so reaching for something with that
        // hand puts the menu straight through whatever you are grabbing. matt asked for this
        // several turns ago: "in the grab tool, if the secondary controller is used to grab a
        // control, hide the menu for as long as the trigger is held."
        //
        // Keyed on that hand's own trigger, which is unambiguous: the menu is operated by
        // POINTING at it with the other hand, so its own trigger is never how you use it.
        // Pinned panels are world-anchored and stay — they are no longer on the hand.
        // ...BUT ONLY WHEN THE HAND IS BUSY WITH THE RIG. Keyed on the trigger alone this fired
        // on every pull of that trigger whatever the tool was doing, which is most of the time:
        // matt: "pulling secondary triggers hides the panel(s) at almost any time, thats not the
        // intent. it should only hide if the current tool is grab, AND if it is actually
        // selecting and grabbing a pin or joint." So the trigger is the trigger, not the
        // condition -- what hides the menu is a Grab tool that has actually taken hold of
        // something in the rig with that hand.
        let secondaryHeld = false;
        for (const src of sources) {
            if (src.handedness === this._dominantHand) continue;
            const t = this._padOf(src)?.buttons?.[0];
            if (t && (t.pressed || t.value > 0.5)) secondaryHeld = true;
        }
        const _grabTool = this._sculptManager?.getCurrentTool?.();
        const _isGrab = _grabTool?.constructor?.name === 'Grab';
        const _nonDom = this._dominantHand === 'right' ? 'left' : 'right';
        // A pin held BY THIS HAND, or a joint taken by the ordinary mesh grab (which is not
        // per-hand, so the trigger above is what says which hand it is).
        const _holdsRig = !!_isGrab && (
          !!_grabTool._vrPinGrabs?.has?.(_nonDom) ||
          !!(_grabTool._grabbedMesh && (_grabTool._grabbedMesh._isBone || _grabTool._grabbedMesh._isPinTarget)));
        secondaryHeld = secondaryHeld && _holdsRig;
        this._wristUIHidden = secondaryHeld;
        // ONE OWNER FOR THE HIDE, and it lives outside the uiGrip branch below on purpose --
        // see _updateWristHide. Losing the hand mid-grab used to leave the panels hidden for
        // ever, because every line that could have put them back was inside `if (uiGrip)`.
        this._updateWristHide(secondaryHeld);

        // THE PANELS RIDE THE HAND WITHOUT BEING CHILDREN OF IT.
        //
        // three sets `grip.visible = (gripPose !== null)` on EVERY frame -- see WebXRController
        // -- so a controller whose pose is unavailable for a moment turns its grip invisible,
        // and anything parented to it goes with it. The wrist panels were parented to it, so
        // every pose dropout blinked them: hand at your side, out of the tracking cameras,
        // occluded while the other hand works. matt: "it was flickering on and off", and the
        // trace named it exactly -- `MiniPanel: ancestor "Group" is invisible`, followed by
        // "[XR] Input state recovered after controller restore". The main menu looked immune
        // because a PINNED panel is world-anchored and not on the grip at all.
        //
        // So they hang off an anchor of our own that FOLLOWS the grip's world transform instead
        // of inheriting from it. A dropout now leaves the panels exactly where they were, which
        // is also the better behaviour: the menu you were reading does not vanish because you
        // turned your wrist away from the cameras for a frame.
        const uiAnchor = this._wristAnchor || (this._wristAnchor = (() => {
          const g = new THREE.Group();
          g.name = 'wrist_panel_anchor';
          g.matrixAutoUpdate = false;   // driven from the grip below, not from position/quaternion
          this._scene.add(g);
          return g;
        })());
        if (uiGrip) {
          // A LOST POSE MUST NOT PARK THE MENU IN THE WORLD.
          //
          // `grip.visible` IS three's answer to "did this frame have a grip pose" (it assigns
          // `grip.visible = (gripPose !== null)` every frame), and on a controller that is
          // resting rather than being waved about, the answer is no for seconds at a time. The
          // trace measured it: the anchor froze for 78, 110, 164, 166 and 249 frames in one
          // short session, with BOTH grips present the whole time. That is the menu hand sitting
          // still while the other hand works -- which is exactly what Tweak Joints looks like.
          //
          // Holding the last WORLD pose through that (v3.30.19) stops the panel blinking and
          // replaces it with something that reads the same: the panel stays where the hand was
          // while the head moves on, so it slides out of view and snaps back when tracking
          // returns. matt: "its flashing on and off still."
          //
          // So a stale pose holds the panel relative to the HEAD instead, at the offset it had
          // on the last good frame. It stays where you last saw it, in your view, and goes back
          // on the wrist the moment the controller is seen again. World-locking is the one
          // choice that cannot work here: the head is the thing that keeps moving.
          const xrCam = this._renderer?.xr?.getCamera?.();
          uiGrip.updateWorldMatrix(true, false);
          // A WRIST IS ALWAYS WITHIN ARM'S REACH. Anything else is a bad pose, not a hand.
          //
          // `grip.visible` catches the frames three KNOWS have no pose, and it is not enough: a
          // grip can report live and carry a STALE world matrix, left behind when the view jumps.
          // The trace caught exactly that -- the head and the panels together at y=9.46 for a
          // moment, then the head back at 1.2 with the panels still at 9.46, i.e. eight metres
          // up and behind, and back a moment later. From inside the headset that is the menu
          // vanishing and returning, with every property of it correct throughout.
          //
          // So the test is geometric rather than a flag: measure the pose the grip is offering
          // against the head, and if it is further than an arm could be, do not take it.
          const gripOK = !!xrCam && uiGrip.visible !== false
            && _wristReach(uiGrip.matrixWorld, xrCam.matrixWorld) < 1.0;
          if (gripOK || !this._wristHeadOffset || !xrCam) {
            uiAnchor.matrix.copy(uiGrip.matrixWorld);
            // Remember where that was RELATIVE TO THE HEAD, for the frames that have no pose.
            // Only from a pose we believed, or the fallback inherits the bad one.
            if (xrCam && gripOK) {
              this._wristHeadOffset = (this._wristHeadOffset || new THREE.Matrix4())
                .copy(xrCam.matrixWorld).invert().multiply(uiAnchor.matrix);
            }
          } else {
            uiAnchor.matrix.multiplyMatrices(xrCam.matrixWorld, this._wristHeadOffset);
          }
          // AND SMOOTH IT, because the thing being aimed at should hold still.
          //
          // On a controller the wrist is braced by the device and the panel is steady enough.
          // A hand has nothing holding it, so the panel inherits every tremor of the arm
          // WEARING it while the other arm is trying to hit a button on it — two independent
          // jitters multiplied together. matt: "the menu drifts too much".
          //
          // Heavier than the ray's smoothing on purpose. Lag on a target you are aiming at
          // reads as steadiness; lag on the pointer in your hand reads as broken. Hands only:
          // the controller path is already stable and its feel is not up for renegotiation.
          if (this._handsOnlyMode()) {
            // A BIG PANEL NEEDS MORE DAMPING THAN A SMALL ONE, FROM THE SAME JITTER.
            //
            // Every wrist panel hangs off this one anchor, so they share its smoothing exactly —
            // matt asked whether they do, and they do. What they do not share is LEVERAGE: the
            // anchor's angular wobble is multiplied by distance from it, so the main menu's far
            // edge swings several times as far as the mini panel's for the same tremor. Equal
            // damping is what makes the small one calm and the big one dance.
            //
            // So the constant is chosen by what is actually on screen. Only while a large panel
            // is up, so the mini panel keeps the responsiveness it has now.
            const _bigUp = !!(this._mainMenuPanel?.mesh?.visible || this._filesPanel?.mesh?.visible);
            const ks = _bigUp
              ? (window._wristSmoothBig ?? 0.05)
              : (window._wristSmooth ?? 0.12);
            if (ks < 1) {
              if (!this._wsP) { this._wsP = new THREE.Vector3(); this._wsQ = new THREE.Quaternion(); this._wsS = new THREE.Vector3(); }
              if (!this._wsCur) { this._wsCur = { p: new THREE.Vector3(), q: new THREE.Quaternion(), ok: false }; }
              uiAnchor.matrix.decompose(this._wsP, this._wsQ, this._wsS);
              if (this._wsCur.ok) {
                this._wsCur.p.lerp(this._wsP, ks);
                this._wsCur.q.slerp(this._wsQ, ks);
              } else {
                this._wsCur.p.copy(this._wsP); this._wsCur.q.copy(this._wsQ); this._wsCur.ok = true;
              }
              uiAnchor.matrix.compose(this._wsCur.p, this._wsCur.q, this._wsS);
            }
          }
          uiAnchor.matrixWorldNeedsUpdate = true;
        }
        if (uiGrip) {

            // [HTMLVRPanel] Attach MiniPanel to wrist (no pin button — always wrist-local).
            if (this._miniPanel && this._miniPanel.mesh && !this._miniPanel.pinned) {
              if (this._miniPanel.mesh.parent !== uiAnchor) uiAnchor.add(this._miniPanel.mesh);
            }
            // KEEP EVERY WRIST PANEL AT THE SHARED HEIGHT, re-read each frame so the Quest 2
            // lift can be dialled in from inside a session rather than guessed from outside
            // one. One number for all of them: they used to sit at different heights and
            // visibly jumped as they swapped. Pinned panels are world-anchored and exempt.
            {
              const _placing = this._wristPlaceActive() && this._wristPlaceOffset;
              const _handsSlot = !_placing && this._handsOnlyMode();
              // NOT _panelTrace — that name was already taken by misc/PanelTrace.js, which is a
              // whole paint-timing instrument. Turning this on turned that on too and buried the
              // one line wanted under a stream of paint logs.
              //
              // Readable without the console: window._panelPlace = true, then window._panelDbg.
              if (window._panelPlace) {
                const _m = this._miniPanel?.mesh;
                const _D = 180 / Math.PI;
                window._panelDbg = {
                  placing: !!_placing, handsSlot: !!_handsSlot,
                  usingWristConst: this._handPanelPlacement() === Scene.HAND_WRIST_PANEL,
                  gripIsWristL: this._gripSpaceIsWristLeft, gripIsWristR: this._gripSpaceIsWristRight,
                  miniPos: _m ? [+_m.position.x.toFixed(4), +_m.position.y.toFixed(4), +_m.position.z.toFixed(4)] : null,
                  miniRot: _m ? [+(_m.rotation.x*_D).toFixed(1), +(_m.rotation.y*_D).toFixed(1), +(_m.rotation.z*_D).toFixed(1)] : null,
                  miniScale: _m ? [+_m.scale.x.toFixed(3), +_m.scale.y.toFixed(3), +_m.scale.z.toFixed(3)] : null,
                  parentedToAnchor: _m ? (_m.parent === uiAnchor) : null,
                  // The keyboard flip is a SCALE-SIGN question on both the source panel and the
                  // keyboard itself, so report both rather than inferring from one.
                  kbScale: this._vrKeyboard?.mesh
                    ? [this._vrKeyboard.mesh.scale.x, this._vrKeyboard.mesh.scale.y, this._vrKeyboard.mesh.scale.z] : null,
                  kbVisible: !!this._vrKeyboard?.mesh?.visible,
                  mainScale: this._mainMenuPanel?.mesh
                    ? [this._mainMenuPanel.mesh.scale.x, this._mainMenuPanel.mesh.scale.y, this._mainMenuPanel.mesh.scale.z] : null,
                };
              }
              const _wy = wristPanelY(), _wYaw = wristPanelYaw();
              for (const _p of [this._miniPanel, this._toolPickerPanel, this._mainMenuPanel]) {
                if (!_p?.mesh || _p.pinned || _p.mesh.parent !== uiAnchor) continue;
                if (_placing) {
                  // Six degrees of freedom while placing — the whole point is that the fixed
                  // slot is what we are trying to replace, so it must not be re-imposed here.
                  this._wristPlaceOffset.decompose(_p.mesh.position, _p.mesh.quaternion, _p.mesh.scale);
                } else if (_handsSlot) {
                  const _hp = this._handPanelPlacement(), _D = Math.PI / 180;
                  _p.mesh.position.set(_hp.p[0], _hp.p[1], _hp.p[2]);
                  _p.mesh.rotation.set(_hp.r[0] * _D, _hp.r[1] * _D, _hp.r[2] * _D, 'XYZ');
                  // SCALE, TOO — and it comes from the SAME constant as the rotation.
                  //
                  // The placing branch decomposes a full matrix, which WRITES scale; this one
                  // sets position and rotation, so the mirror it leaves behind has to be stated.
                  // Normalising every hand panel to +1 here is what broke the Vision Pro: its
                  // number carries the half-turn correction and is right at the panel's natural
                  // -1, while the Galaxy XR number was grabbed raw and is right at +1. Applying
                  // one of them at the other's mirror is an upside-down, back-facing menu.
                  if (window._panelKeepScale !== true) _p.mesh.scale.set(1, _hp.sy, 1);
                } else {
                  // RESTORE THE NATURAL MIRROR ON THE WAY OUT.
                  //
                  // scale.y = -1 is what an HTMLVRPanel is built with — it compensates for
                  // flipY=false in the rasterised texture. The hands slot normalises it to 1
                  // because the placement was measured that way, and nothing put it back, so
                  // switching to controllers mid-session left the panel un-mirrored in a slot
                  // that assumes it is mirrored: the menus swapped and came up wrong.
                  if (_p.mesh.scale.y > 0) _p.mesh.scale.set(1, -1, 1);
                  // RESET EVERY COMPONENT THE HANDS SLOT WRITES, not just the ones this slot
                  // sets. The hands placement writes all three position and rotation components;
                  // this branch only ever set .y, so x and z kept the hand values and the panel
                  // came back at the hand's angle in a controller slot. That is the "menus swap
                  // but are oriented wrong" on the way out.
                  _p.mesh.position.set(0, _wy, 0);
                  // THE PITCH IS PART OF THE SLOT, not a leftover from construction. Writing the
                  // whole vector here is right — the hands slot writes all three and they have to
                  // be undone — but it must write the value the panel was BUILT with, and this
                  // wrote a bare 0. The -90 about X is what lies the panel back along the
                  // controller like a watch face; zeroing it every frame turned the menus to face
                  // the floor. Shared constant now, so the slot and the constructors cannot drift.
                  _p.mesh.rotation.set(wristPanelPitch(), _wYaw, 0);
                }
              }
            }
            if (this._toolPickerPanel && this._toolPickerPanel.mesh) {
              if (this._toolPickerPanel.mesh.parent !== uiAnchor) uiAnchor.add(this._toolPickerPanel.mesh);
            }

            // [HTMLVRPanel] Attach MainMenuPanel to wrist unless pinned in world space.
            if (this._mainMenuPanel && this._mainMenuPanel.mesh && !this._mainMenuPanel.pinned) {
              if (this._mainMenuPanel.mesh.parent !== uiAnchor) {
                uiAnchor.add(this._mainMenuPanel.mesh);
              }
            }
        } else {
        }
    } else {
        // A FRAME WITH NO INPUT SOURCES IS NOT A DISCONNECTION, and this used to treat it as
        // one — wiping the handedness mapping that ONLY the 'connected' listener can rebuild.
        //
        // Starting the GalaxyXR screen recorder blurs the session: `sources` goes 2 -> 0 for
        // about a second, then back to 2. The controllers were never really disconnected, so no
        // 'connected' event fires on the way back, so nothing re-assigns the mapping — and
        // `_vrControllerRight` stays null for the rest of the session. The cursor block's first
        // gate is `if (!controllerGroup) { cursorGroup.visible = false; continue; }`, which is
        // why the radius sphere vanished and stayed vanished while everything else carried on:
        // it is the only thing that asks. matt's diagnostic caught it exactly — `curVis` went
        // true -> false on the frame after "Input state recovered", with nothing else moving.
        //
        // The 'disconnected' listener is the real signal for this, and it already does the job
        // properly (it checks identity before clearing). Nothing to do here.
    }

    // AND REBUILD THE MAPPING IF IT IS MISSING. Belt and braces for the case above however it
    // arises — a runtime that really does drop sources without a 'disconnected', or a session
    // that has already been wiped by an older build. Only fills gaps, so it never fights the
    // 'connected' listener that normally owns this.
    if (sources && sources.length && this._renderer && this._renderer.xr) {
      for (let i = 0; i < sources.length; i++) {
        const h = sources[i] && sources[i].handedness;
        if (h !== 'left' && h !== 'right') continue;
        const _isHand = this._isHandSource(sources[i]);
        this._srcObjs = this._srcObjs || { hand: {}, ctl: {} };
        const known = this._srcObjs[_isHand ? 'hand' : 'ctl'][h];
        if (known) continue;
        const c = this._renderer.xr.getController(i);
        const g = this._renderer.xr.getControllerGrip(i);
        if (!c) continue;
        this._srcObjs[_isHand ? 'hand' : 'ctl'][h] = { ctl: c, grip: g };
        this._applyActiveInputObjects();
        console.info('[XR] re-mapped ' + h + ' ' + (_isHand ? 'hand' : 'controller')
          + ' (source ' + i + ')');
      }
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
    this._vrSecondaryTriggerPressed = !!this._padOf(nonDomSource)?.buttons?.[0]?.pressed;

    // THE ONE PLACE SMOOTH MODE IS DECIDED. Everything downstream reads `_smoothMode` -- see
    // _updateSmoothModeLatch for why it is a latch and not a function.
    this._updateSmoothModeLatch();

    // And it has to SHOW when you press the trigger, not up to a third of a second later: the
    // wrist panel's own sync runs every 30 frames, which is fine for state that drifts and
    // useless for a mode indicator you hold for a second at a time. Two syncs per press, against
    // the 30-frame poll that was happening anyway.
    const _smoothModeNow = !!this._smoothMode.on;
    if (_smoothModeNow !== this._smoothModeShown) {
      this._smoothModeShown = _smoothModeNow;
      try { this._miniPanel?.syncFromState?.(); } catch (_) {}
    }

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




      // NO gripSpace DOES NOT MEAN NO HAND (Apple Vision Pro).
      //
      // visionOS hands arrive as fully tracked sources — targetRayMode 'tracked-pointer',
      // profile 'generic-hand', 25 joints with real poses — but Safari hands up NO gripSpace
      // at all. This gate sits above everything, so every AVP hand was skipped before the
      // hand-tracking branch below could run even once: the controller spikes drew, the scene
      // animated, and not one input event ever landed. Measured on device 2026-09-12:
      //   left  gripSpace=false gripPose=NULL rayPose=YES
      //   right gripSpace=false gripPose=NULL rayPose=YES
      //
      // The wrist JOINT is the right stand-in: XRJointSpace is an XRSpace, so frame.getPose()
      // takes it, and it sits where a grip pose sits. Its ORIENTATION convention differs from
      // grip space (joint spaces point +Y down the bone), so anything mounted on this pose
      // needs a fixed rotation offset — see _gripSpaceIsWrist below.
      const gripSpace = source.gripSpace
        || (source.hand && source.hand.get('wrist'))
        || source.targetRaySpace;
      if (!gripSpace) continue;
      // Downstream pose consumers need to know they are reading a joint, not a grip.
      const gripIsWrist = !source.gripSpace && !!(source.hand && source.hand.get('wrist'));
      if (source.handedness === 'left') this._gripSpaceIsWristLeft = gripIsWrist;
      else if (source.handedness === 'right') this._gripSpaceIsWristRight = gripIsWrist;

      // VR Fuzzer Overrides
      // (Fuzzer has been suspended during migration since it relied on manual pose injection)


      // VR SHORTCUTS
      // Thumbsticks and face buttons only — _padOf reports an empty pad as absent, so an AVP
      // hand (gamepad truthy, buttons and axes both empty) skips this block instead of
      // indexing undefined out of it. Gesture input is handled in the hand branch below.
      const pad = this._padOf(source);
      if (pad) {
        // Unique Persistent State per Controller
        if (!this._vrStateLeft) this._vrStateLeft = { axes: [] };
        if (!this._vrStateRight) this._vrStateRight = { axes: [] };

        const state = source.handedness === 'left' ? this._vrStateLeft : this._vrStateRight;
        // [Step 3] Hand Swap: Shortcuts adhere to NON-DOMINANT hand
        // [Step 3] Hand Swap: Radius Control adheres to DOMINANT hand
        const isDom = source.handedness === this._dominantHand;
        const isNonDom = !isDom;
        const axes = pad.axes;

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
          const btns = pad.buttons;
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
            const isSlowMod = this._padOf(domSource)?.buttons?.[0]?.pressed ?? false;
            const scrollSpeed = isSlowMod ? 12 : 55; // px per frame at full push; hold trigger for fine scroll
            const delta = valY_NonDom * scrollSpeed; // proportional to stick deflection

            // Canvas BlendshapeStackPanel (ARKit picker) — when the ray is on it.
            if ((this._vbsPanelPointed || this._wasVbsPanelPointed) && this._vrBlendPanel) {
              this._vrBlendPanel.onVRScroll(delta);
            } else if (this._lastHtmlPanelHit) {
              this._lastHtmlPanelHit.onVRScroll(delta);   // scroll the panel the ray was on
            }
          }
        }

        // DOMINANT HAND: AXIS 3 (Up/Down) - Radius +/- 5%, AXIS 2 (Left/Right) - Intensity +/- 5%
        if (isDom) {
          const valY = axes[3];
          const valX = axes[2];
          const isPressedY = Math.abs(valY) > T_PRESS;
          const isPressedX = Math.abs(valX) > T_PRESS;

          const nonDomSource = this._dominantHand === 'left' ? right : left;

          // ONE SPEED, AND THE OFF-HAND TRIGGER NO LONGER CHANGES IT.
          //
          // It used to be 5% per 30ms normally and 0.5% per 15ms with the off-hand trigger held
          // -- 167%/s against 33%/s, and matt's verdict on both: "too fast in regular mode, and
          // too slow when the offhand trigger is pressed". STICK_STEP is the geometric middle of
          // those two rates (sqrt(167 x 33) = 74%/s, which is 2.24% on the 30ms tick), so the
          // one remaining speed is the one that was missing.
          //
          // The modifier had to go regardless of feel: the off-hand trigger is SMOOTH MODE now,
          // so holding it already changes which tool the stick is tuning. Having it also change
          // how fast meant the gesture did two things at once, and the slow-down was landing on
          // whichever tool you had just switched to.
          const STICK_STEP = 0.0224;
          const STICK_RATE = 30;

          // Timer for Repeat/Debounce
          const now = performance.now();
          const targetRateY = STICK_RATE;

          if ((this._isPointingAtMenu || this._wasPointingAtMenu) && isPressedY) {
            const isSlowMod = this._padOf(nonDomSource)?.buttons?.[0]?.pressed ?? false;
            const scrollSpeed = isSlowMod ? 12 : 55;
            const delta = valY * scrollSpeed; // proportional to stick deflection

            if ((this._vbsPanelPointed || this._wasVbsPanelPointed) && this._vrBlendPanel) {
              this._vrBlendPanel.onVRScroll(delta);
            } else if (this._lastHtmlPanelHit) {
              this._lastHtmlPanelHit.onVRScroll(delta);
            }
          } else if (isPressedY && this._sculptManager._toolIndex === Enums.Tools.TRANSFORM_VR) {
            // THE STICK RESIZES THE GIZMO WHILE TRANSFORM IS ACTIVE. Radius means nothing to a
            // gizmo, and the gizmo is sized for objects — on a bone it swamps the thing you are
            // trying to see. Same stick, same repeat rate and same slow-modifier as radius, so
            // the gesture is the one the hand already knows.
            //
            // gizmoSizeMul is a MATRIX scale (GizmoVR.update reads it every frame) and the
            // pick geometry rides the same matrix, so the handles stay grabbable where they
            // are drawn. Driving _resize() instead would rebuild all fifteen primitives per
            // tick — 33 times a second while the stick is held, and it disposes nothing.
            if (now - state.lastRadiusTime > targetRateY) {
              state.lastRadiusTime = now;

              // Geometric, not linear: this is a multiplier over an 8x span, so a fixed
              // PERCENTAGE per tick reads the same to the hand at either end. 5% matches the
              // step radius uses.
              // The gizmo keeps its own 5%: it spans 8x and matt has not complained about it.
              // It loses the off-hand slow-down with everything else.
              const step = 1.0 + 0.05;
              const cur = window._gizmoSizeMul != null
                ? window._gizmoSizeMul : (getOptionsURL().gizmoSizeMul || 1.0);
              const next = valY < -T_PRESS ? cur * step : cur / step; // UP -> bigger

              // Clamped to the same range the settings slider offers, so the two agree.
              window._gizmoSizeMul = Math.max(0.25, Math.min(2.0, next));
              getOptionsURL.saveOption('gizmoSizeMul', window._gizmoSizeMul, 500);
              this._main ? this._main.render() : this.render();
            }
            state.axes[3] = valY;
          } else if (isPressedY) {
            if (now - state.lastRadiusTime > targetRateY) { 
              state.lastRadiusTime = now;

              let change = 0.0;
              // THE TOOL DOING THE WORK, not the one that will be current again a frame from now.
              // See _smoothModeTool: while smooth mode is held, Smooth is what the
              // stick should be tuning.
              const smoothTool = this._smoothMode?.tool || null;
              const tools = smoothTool || this._sculptManager.getCurrentTool();
              const maxRadius = 250.0;
              if (valY < -T_PRESS) change = maxRadius * STICK_STEP;  // UP -> bigger
              if (valY > T_PRESS) change = -maxRadius * STICK_STEP;  // DOWN -> smaller

              if (change !== 0 && tools) {
                const oldVal = tools._radius;
                const newVal = Math.max(5.0, Math.min(maxRadius, oldVal + change));


                tools.setRadius(newVal);
                // AND REMEMBER IT. The panel sliders have always saved; this — the thumbstick,
                // which is how the radius actually gets set in VR — did not, so every session
                // started back at the constructor's default no matter what you had dialled in
                // last time. Same key the panels write, so the two cannot disagree.
                // Debounced at 500ms, because this fires on every tick of a held stick.
                // Under the same key the panels write -- and keyed to the tool that was actually
                // changed, so a radius dialled in while smoothing is saved as Smooth's.
                getOptionsURL.saveOption(
                  `tool_${smoothTool ? this._smoothToolIndex() : this._sculptManager.getToolIndex()}_radius`,
                  newVal, 500);

                // Update GuiXR and GuiMini Sliders if visible

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

          const targetRateX = STICK_RATE;

          if (isPressedX) {
            if (now - state.lastIntensityTime > targetRateX) {
              state.lastIntensityTime = now;

              let intChange = 0.0;
              const tools = this._smoothMode?.tool || this._sculptManager.getCurrentTool();

              if (valX < -T_PRESS) intChange = -STICK_STEP; // Left -> weaker
              if (valX > T_PRESS) intChange = STICK_STEP;   // Right -> stronger

              if (intChange !== 0 && tools) {
                const oldVal = tools._intensity;
                const newVal = Math.max(0.0, Math.min(1.0, oldVal + intChange));

                tools.setIntensity(newVal);

                // Update UI Widgets if active

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
        const btns = pad.buttons;
        if (btns.length > 4) {
          const now = performance.now();
          const HYBRID_THRESHOLD = 300; // ms

          // DOMINANT HAND: 'A' or 'X' Button (Button 4) -> Toggle Subtract
          if (isDom) {
            const btnA = btns[4];
            const tracker = this._vrButtonStates[this._dominantHand].Primary;
            const activeTool = this._sculptManager.getCurrentTool();
            const isPaint = activeTool && activeTool.constructor.name === 'Paint';
            // A ALREADY MEANS SOMETHING to these tools — it pins the joint under the ray, and
            // they bind it themselves (IKSolver.pinOnA). None of them sculpt, so the subtract
            // toggle below has nothing to act on; letting it run would silently flip Negative
            // for whatever brush you pick up next, from a press you made to place a pin.
            const idxA = this._sculptManager._toolIndex;
            const bindsA = idxA === Enums.Tools.TRANSFORM_VR || idxA === Enums.Tools.GRAB
                        || idxA === Enums.Tools.BONE_DRAW;

            if (btnA && btnA.pressed !== tracker.pressed) {
              if (btnA.pressed) {
                // Button Down: Activate INSTANTLY
                tracker.time = now;
                tracker.longPressActive = false;

                if (isPaint) {
                  activeTool.swapColors();
                  const targetMain = this._main || window.main;
                } else if (!bindsA) {
                  this._vrSubtractActive = !this._vrSubtractActive;
                }
              } else {
                // Button Up
                if (tracker.longPressActive && !isPaint && !bindsA) {
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
                // HTML panel mode: X toggles between MiniPanel and MainMenuPanel
                const mainVisible = !!(this._mainMenuPanel?.mesh?.visible);
                this._swapHtmlPanels(mainVisible ? 'mini' : 'main');
                console.log(`[VR X Button] ${mainVisible ? 'MainMenu → MiniPanel' : 'MiniPanel → MainMenu'}`);
                if (window.screenLog) window.screenLog(`[X] ${mainVisible ? 'MiniPanel' : 'MainMenu'}`, 'cyan');              } else {
                // Button Up
                if (tracker.longPressActive) {
                  // Momentary Release -> Revert swap in reverse
                    const mainVisible = !!(this._mainMenuPanel?.mesh?.visible);
                  this._swapHtmlPanels(mainVisible ? 'mini' : 'main');
                  console.log(`[VR X Button] Reverted: ${mainVisible ? 'MiniPanel' : 'MainMenu'} shown`);
                }                // If quick tap, do nothing on release
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

          // NON-DOMINANT HAND: Y/B Button (Button 5) — hide/show all HTML panels.
          // Debug-only (measures HTML-panel frame cost) and an easy fat-finger, so it's
          // gated off by default; set window._vrDebugPanelToggle=true to re-enable.
          if (isNonDom && window._vrDebugPanelToggle) {
            const btnY = btns[5];
            if (btnY && btnY.pressed && !this._btnYWasPressed) {
              this._htmlPanelsHidden = !this._htmlPanelsHidden;
              const hide = this._htmlPanelsHidden;
              const panels = [
                this._miniPanel, this._mainMenuPanel,
                this._toolPickerPanel, this._filesPanel, this._animPanel,
              ];
              if (hide) {
                // Snapshot current visibility so SHOW restores exactly. Naively setting every
                // panel visible=true brought back the mutually-exclusive Mini + Main menus at
                // once (the "Y shows both menus" bug).
                this._htmlPanelVisSnapshot = panels.map(p => !!p?.mesh?.visible);
                panels.forEach(p => { if (p?.mesh) p.mesh.visible = false; });
                this._tornOffPanels?.forEach(p => { if (p?.mesh) p.mesh.visible = false; });
              } else {
                const snap = this._htmlPanelVisSnapshot;
                panels.forEach((p, i) => { if (p?.mesh) p.mesh.visible = snap ? !!snap[i] : false; });
                this._tornOffPanels?.forEach(p => { if (p?.mesh) p.mesh.visible = true; });
              }
              if (window.screenLog) window.screenLog(`[Y] panels ${hide ? 'HIDDEN' : 'shown'}`, hide ? 'orange' : 'lime');
            }
            this._btnYWasPressed = !!(btnY?.pressed);
          }

          // #29 Quick tool-swap — click the NON-DOMINANT thumbstick to cycle sculpt tools.
          // Bound to the role (non-dominant), not a physical side, so it follows a dominant-
          // hand change (and matches the SECONDARY guide panel).
          if (isNonDom && btns[3]) {
            const stickDown = !!btns[3].pressed;
            if (stickDown && !this._nonDomStickClickPrev) this._quickSwapTool();
            this._nonDomStickClickPrev = stickDown;
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

          // MEASURE THE GAP BETWEEN THE FINGERS, NOT BETWEEN THE JOINT CENTRES.
          //
          // Touching fingertips do NOT read zero apart. A joint pose carries a RADIUS, and the
          // centres of two touching tips stay separated by roughly the sum of those radii. On
          // Apple Vision Pro the fingertip radius is 0.010, so fingers pressed together read
          // about 0.020 between centres — which is why the old bare `pinchDist < 0.02` sat
          // exactly on the boundary here and behaved like a coin flip, and why measured probe
          // data looked like two overlapping populations (a real pinch at 0.0176, a relaxed
          // hand at 0.0201) instead of two clearly separated ones. It was never overlap; it
          // was the finger thickness being counted as distance.
          //
          // Subtracting the radii turns this into an actual skin-to-skin gap that means the
          // same thing on every device, instead of a constant re-tuned per headset. Quest's
          // radii differ from Apple's; the formula absorbs that.
          //
          // Hysteresis on top, latched per hand: close to ENTER to start, open past EXIT to
          // stop, so a hand hovering near the boundary cannot chatter at frame rate.
          const rT = (thumbTip.radius || 0), rI = (indexTip.radius || 0);
          const pinchGap = pinchDist - rT - rI;   // <=0 means the tips are touching

          const hKey = source.handedness === 'left' ? 'L' : 'R';
          if (!this._pinchLatch) this._pinchLatch = {};
          const latch = this._pinchLatch[hKey] || (this._pinchLatch[hKey] = { pinch: false, fist: false });

          // RAW. ONE THRESHOLD, NO LATCH.
          //
          // Detecting the pinch was never the problem — a legacy suppression that zeroed it
          // within 25cm of the wrist was. Hysteresis was added while that was still undiagnosed
          // and it bought nothing except a release you had to mean: matt, after the real cause
          // was fixed, "pinch gesture is still sticky... i don't think detecting a pinch was ever
          // an issue". So the press follows the fingers directly.
          //
          // The measurement stays radius-relative, because that is what makes the signal clean
          // enough to need no filtering: measured on device, a pinch reads about -0.017 and a
          // relaxed hand about +0.040, so a 5mm threshold sits in open space with ~20mm of
          // clearance on both sides. Smoothing a signal that separated is smoothing noise that
          // is not there.
          //
          // The FIST keeps its hysteresis: it is a hold, not a click, and a chattering grip
          // drops the world mid-drag.
          const P_ON    = this.getPinchOn();           // skin-to-skin gap, metres
          const F_ENTER = window._fistEnter  ?? 0.045; // fist is tip-to-knuckle; no radius term
          const F_EXIT  = window._fistExit   ?? 0.065;

          isPinching = pinchGap < P_ON;
          // KEPT FOR THE SYSTEM-PINCH ATTRIBUTION BELOW. A transient-pointer source cannot say
          // which hand pinched; our own joints can, and the comparison between the two hands is
          // what decides who a platform pinch belongs to.
          if (!this._pinchGap) this._pinchGap = {};
          this._pinchGap[hKey] = pinchGap;
          latch.fist = latch.fist ? (fistDist < F_EXIT) : (fistDist < F_ENTER);
          isFist = latch.fist;
          latch.pinch = isPinching;   // recorded for the fingertip dots, not used as state

          // Live readout for threshold tuning on device: window._pinchTrace = true.
          if (window._pinchTrace) {
            this._pinchTraceN = (this._pinchTraceN || 0) + 1;
            if (this._pinchTraceN % 30 === 0) {
              console.log('[pinch] ' + hKey + ' dist=' + pinchDist.toFixed(4)
                + ' r=' + rT.toFixed(3) + '/' + rI.toFixed(3)
                + ' gap=' + pinchGap.toFixed(4) + (latch.pinch ? '  PINCH' : '')
                + ' fistDist=' + fistDist.toFixed(4) + (latch.fist ? '  FIST' : ''));
            }
          }

          // NO PINCH SUPPRESSION NEAR THE WRIST ANY MORE.
          //
          // A 25cm sphere around the non-dominant wrist used to kill the pinch, because the
          // legacy canvas MiniHUD was operated by POKING it and a pinch while reaching for the
          // menu would otherwise sculpt. It also made the HTML wrist panel unclickable: measured
          // ray-to-panel distances of 0.16-0.24m are entirely inside that sphere, so a whole
          // session of pinches produced no press edge while the fingertip dots went green
          // throughout (they read the raw latch; the suppression zeroed the value after it).
          // matt: "if i got my hand close to the menu, and did a slow pinch, the dots went
          // green, but a click was never detected."
          //
          // Deleting the canvas MiniHUD removes the only reason it existed, so the radius is
          // gone and the latch is simply never set. Kept as a field because other code reads it.
          this._isMiniHUDActive = false;
        }

        // --- HAND PUPPETRY (#28 v1): drive ARKit jawOpen from the thumb↔finger gap. ---
        // Sock-puppet grip: thumb = lower jaw, fingers = upper. The gap between thumb-tip
        // and middle-fingertip maps to the jawOpen weight (closed tips = 0, spread = 1).
        // Non-dominant hand only (dominant stays free to sculpt/menu). Janky-by-design v1;
        // toggle with window.togglePuppet() (or set window._puppetMode). Calibrate the
        // open/closed gap with window._puppetJawMin / _puppetJawMax (metres).
        if (window._puppetMode && source.handedness !== this._dominantHand) {
          const pm = this.getMesh && this.getMesh();
          // Jaw: thumb↔finger gap → jawOpen weight (closed tips = 0, spread = 1).
          // setBlendshapeWeight no-ops if the mesh has no 'jawOpen' shape, so it's safe on
          // any active object; on a rigged head it drives (and keys) the jaw live.
          if (pm && thumbTip && middleTip && window._animationRegistry) {
            const a = thumbTip.transform.position, b = middleTip.transform.position;
            const gap = vec3.distance([a.x, a.y, a.z], [b.x, b.y, b.z]);
            const lo = window._puppetJawMin ?? 0.025, hi = window._puppetJawMax ?? 0.09;
            const w = Math.max(0, Math.min(1, (gap - lo) / (hi - lo)));
            window._animationRegistry.setBlendshapeWeight(pm, 'jawOpen', w);
          }
          // Head: wrist pose → head transform, RELATIVE to an anchor captured on enable, so
          // the head rides your hand from where it sits (never snaps to the raw wrist pose).
          if (pm && wrist && wrist.transform) this._drivePuppetHead(pm, wrist.transform);
        }

        // The platform's own pinch counts as a press for the pointing hand (see enterXR) —
        // UNLESS OUR OWN JOINTS SAY IT WAS THE OTHER HAND.
        //
        // A transient-pointer source reports handedness 'none', so the platform cannot tell us
        // who pinched and this credited the dominant hand unconditionally. That is the documented
        // limitation in enterXR, and it is what made an offhand pinch read as a dominant-hand
        // press: matt, on visionOS, "pinching the left hand starts smooth straight away... its
        // still directly doing a smooth when only the left pinch is active". Gating the tool
        // swap on both triggers could not help, because this was fabricating the second one.
        //
        // We cannot name the pinching hand from the platform, but we can rule one out: if the
        // OTHER hand's measured gap is clearly smaller than this one's, the pinch is theirs. A
        // relative comparison rather than a threshold, so it carries across devices whose
        // absolute gaps differ by more than this margin does. With no measurement to go on
        // (no joints, no permission) it falls through to the old behaviour, which is the whole
        // point of the feature: catching a pinch our own thresholds missed.
        if (window._sysPinch !== false && this._sysPinchActive
            && source.handedness === this._dominantHand) {
          const _dk = this._dominantHand === 'left' ? 'L' : 'R';
          const _ok = _dk === 'L' ? 'R' : 'L';
          const _dg = this._pinchGap?.[_dk], _og = this._pinchGap?.[_ok];
          const _margin = window._sysPinchMargin ?? 0.010;
          const _otherOwnsIt = Number.isFinite(_dg) && Number.isFinite(_og) && _og < _dg - _margin;
          if (!_otherOwnsIt) isPinching = true;
        }

        mockGamepad = {
          buttons: [
            { pressed: isPinching, value: isPinching ? 1.0 : 0.0 }, // Trigger (Sculpt / UI Click)
            { pressed: isFist, value: isFist ? 1.0 : 0.0 },         // Grip (Move World)
            { pressed: false, value: 0 },
            { pressed: false, value: 0 },
            // X/A — no hand gesture is bound here on purpose. Palm-up was built and tested on
            // device and LOST to visionOS's own Home View gesture, which owns that posture; the
            // index pinch is the system select and the crown is recenter, so there is no posture
            // left to claim without fighting the OS. The menu is reached by looking at the gaze
            // button instead (see _updateGazeMenuButton), which needs no gesture at all.
            { pressed: false, value: 0 },
            { pressed: false, value: 0 }
          ],
          axes: [0, 0, 0, 0]
        };
        // Published for the button-list builder below, which runs in a different function and
        // so cannot see this loop-local. Without it that builder hands the sculpt manager the
        // hand's REAL gamepad — see the note there.
        if (!this._mockGamepads) this._mockGamepads = {};
        this._mockGamepads[source.handedness] = mockGamepad;
      } else {
        if (source.handedness === 'left') this._isHandTrackingLeft = false;
        if (source.handedness === 'right') this._isHandTrackingRight = false;
        if (this._mockGamepads) this._mockGamepads[source.handedness] = null;
      }
      
      const activeGamepad = mockGamepad || source.gamepad;

      // 1. Common Pose Gathering (for All Tasks)
      const worldPose = frame.getPose(gripSpace, refSpace);
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
        } else if (gripSpace) {
          // Fallback to Grip Space if Ray is missing (rare but possible)
          const gripPose = frame.getPose(gripSpace, refSpace);
          if (gripPose) {
            this._vrDominantRayMatrix = gripPose.transform.matrix;
          }
        }
      }

      // PLACE-IN-HAND — a freshly duplicated chain follows this controller until the trigger
      // confirms where it goes, or B backs out. Ahead of the radial and holding the same hand:
      // while a placement is running the B menu is suppressed below, so the one button cannot
      // both cancel this and open a wheel on top of it.
      if (source.handedness === this._dominantHand && RigPlacing.armed(this) && worldPose) {
        const _cancelBtn = activeGamepad?.buttons?.[5];
        // B CANCELS, and it is safe to read on this frame: the wheel commits its sector on the
        // button's RELEASE, so B is already up by the time the command that started the
        // placement has run. A press seen here is a new one, which is a request to back out.
        if (_cancelBtn && (_cancelBtn.pressed || _cancelBtn.value > 0.5)) {
          RigPlacing.cancel(this);
        } else {
          const _trigBtn = activeGamepad?.buttons?.[0];
          // THE WHOLE MATRIX, not the position: the copy is carried by the controller, so
          // turning your wrist has to turn it. `worldPose` is the grip pose, which is the one
          // that follows the hand rather than the aim.
          RigPlacing.update(this, worldPose.transform.matrix,
            !!(_trigBtn && (_trigBtn.pressed || _trigBtn.value > 0.5)));
        }
      }

      // Radial context menu — hold the dominant B button (btns[5]), move the
      // controller to pick a sector, release to commit; center dead-zone cancels.
      // Suppressed while a modal VR widget is up. See VrRadialMenu.
      if (source.handedness === this._dominantHand && this._vrRadial && worldPose
          && !RigPlacing.armed(this)) {
        const _modalUp = this._vrNumpad?.mesh?.visible
          || this._vrKeyboard?.mesh?.visible
          || window._vrConfirmPanel?.isBlockingOpen;
        const _bBtn = activeGamepad?.buttons?.[5];
        const _bDown = !_modalUp && !!(_bBtn && (_bBtn.pressed || _bBtn.value > 0.5));
        const _pp = worldPose.transform.position;
        this._vrRadial.handleInput(_bDown, [_pp.x, _pp.y, _pp.z], () => {
          // LATCH WHAT THE MENU IS ACTING ON, for as long as it is acting on it.
          //
          // The hand has to move to pick a sector, and the rig preselection follows the hand —
          // so the highlight crawled to whatever bone happened to be nearest while the menu was
          // open, behind the wheel, on an object the menu was not going to touch. matt: "i can
          // see behind the menu its changing the preselect highlight to whatever is the next
          // closest bone, which is confusing."
          //
          // So the subject is frozen at open and drawn as SELECTED — cyan, the colour for "this
          // is the one" — which is what he meant by "B should select". The freeze holds through
          // a pending submenu and lifts when the whole operation is done, not when the first
          // wheel closes: naming is two wheels, and going yellow between them would say the
          // subject had been let go.
          const cmds = this._resolveRadialCommands();
          const subj = Skeleton.hoveredJoint(this) || this.getMesh?.();
          this._rigMenuLatch = (subj && (subj._isBone || subj._isPinTarget))
            ? subj.getID() : null;
          // The BONE is latched for the same reason and on the same clock: Split acts on the
          // segment, so the segment is what has to stay lit while you choose. Without it the
          // highlight crawls to whatever the tip drifts past behind the wheel — the exact
          // complaint the joint latch above was written for.
          this._rigHoverBoneLatch = this._rigHoverBone || null;
          return cmds;
        });
        // Lifted only once nothing is open AND nothing is waiting for the next press.
        if (!this._vrRadial.isOpen && !this._vrRadial.hasPending
            && !(this._vrPinRadial && (this._vrPinRadial.isOpen || this._vrPinRadial.hasPending))
            && (this._rigMenuLatch != null || this._rigHoverBoneLatch)) {
          this._rigMenuLatch = null;
          this._rigHoverBoneLatch = null;
          Skeleton.updateVisuals(this);
        }
      }

      // THE PIN RING, on A (btns[4]) -- same gesture as B, different button and a different
      // list. A used to CYCLE the pin mode, so reaching one of five states meant counting
      // presses and reading the marker, and overshooting meant going all the way round again.
      if (source.handedness === this._dominantHand && this._vrPinRadial && worldPose) {
        const _modalUp2 = this._vrNumpad?.mesh?.visible
          || this._vrKeyboard?.mesh?.visible
          || window._vrConfirmPanel?.isBlockingOpen;
        const _aBtn = activeGamepad?.buttons?.[4];
        // Never both at once: B owns the gesture if it is already up, or the two wheels would
        // sit on top of each other reading the same hand.
        const _bBusy = this._vrRadial && (this._vrRadial.isOpen || this._vrRadial.hasPending);
        const _aDown = !_modalUp2 && !_bBusy
          && !!(_aBtn && (_aBtn.pressed || _aBtn.value > 0.5));
        const _pp2 = worldPose.transform.position;
        this._vrPinRadial.handleInput(_aDown, [_pp2.x, _pp2.y, _pp2.z], () => {
          // Same latch as the B menu, for the same reason: the hand has to move to choose, and
          // the preselection would otherwise crawl to whatever bone the tip drifted past behind
          // the wheel -- changing the joint the menu is about, mid-menu.
          const subj = this._resolvePinJoint();
          this._rigMenuLatch = subj ? subj.getID() : null;
          return this._resolvePinCommands();
        });
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
          if (!rayPose && gripSpace) {
             rayPose = frame.getPose(gripSpace, refSpace);
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

          this._mark('xr-panelhit');

          // THE PANEL HAS TO BE WHERE THE RAY THINKS IT IS.
          //
          // Wrist panels are parented to the controller grip, so their world matrix comes from
          // the controller. World matrices are recomputed inside renderer.render(), which runs
          // at the END of the frame — so here, before the draw, every panel's matrixWorld is
          // still from the PREVIOUS frame's render while the ray being cast is from this
          // frame's fresh pose.
          //
          // The error is therefore exactly one frame of the carrying hand's motion, and
          // because the panel sits ~30cm from that hand, a millimetre of drift swings the hit
          // point a long way across it. Measured: a single-frame uv jump of 0.44 to 1.09 in a
          // 0-1 space, from a hand that was as still as a hand gets. matt described it as
          // micromotions being translated into large motions, which is precisely what a
          // one-frame lag on a close, hand-carried target looks like.
          //
          // Updating the grips cascades to every panel hanging off them. Two matrix updates
          // against a hit test that was already running.
          for (const g of [this._vrControllerLeftGrip, this._vrControllerRightGrip]) {
            if (g) g.updateMatrixWorld(true);
          }

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
          // A rig manipulation captures both hands as one gesture. While it is live,
          // an incidental ray across the wrist-mounted MiniHUD must not change values.
          const _miniHudBlocked = !!this._sculptManager.getCurrentTool()?.blocksMiniHudInput?.();
          // See _strokeOwnsInput. Gated here rather than around the whole block on purpose: with
          // no hits collected, the phase below still walks _allVisible and sends LEAVE to every
          // panel, so a panel the ray was on when the stroke began is left un-hovered and
          // un-pressed rather than frozen mid-hover. Same shape as the modal numpad guard.
          // HOISTED, because `_hand` is declared ~130 lines below and a const read before its
          // declaration is a TDZ ReferenceError every frame -- which `node --check` and the build
          // both pass cleanly. Same trap undef_test exists for.
          const _handKey = source.targetRayMode === 'transient-pointer'
            ? 'G'
            : (source.handedness === 'left' ? 'L' : 'R');
          // `|| the press belongs to the scene` -- see the claim near the end of this block. Read
          // from the previous frame, which is correct: the down-edge frame is the one that
          // DECIDES ownership, and it decides it by whether a panel was under the ray then.
          const _strokeBusy = this._strokeOwnsInput() || this._vrPressOwner?.[_handKey] === 'scene';
          if (!_numpadOpen && !_strokeBusy) {
            if (!_miniHudBlocked && this._miniPanel?.mesh?.visible) {
              const h = _rc.intersectObject(this._miniPanel.mesh);
              if (h.length > 0) _panelHits.push({ name: 'MiniPanel', panel: this._miniPanel, hit: h[0], pressKey: '_mpWasPressed' });
            }
            if (this._toolPickerPanel?.mesh?.visible) {
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
          if (this._vrKeyboard?.mesh?.visible) {
            const h = _rc.intersectObject(this._vrKeyboard.mesh);
            if (h.length > 0) _panelHits.push({ name: 'VrKeyboard', panel: this._vrKeyboard, hit: h[0], pressKey: '_kbWasPressed' });
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
            // The panel's visibility as well as the grip's own: as a CHILD the grip keeps its
            // flag true while a hidden parent stops it being drawn, so `visible` alone would
            // leave an invisible grip hittable.
            if (this._vrBlendResizeHandle?.visible && this._vrBlendMesh?.visible) {
              const hb = _rc.intersectObject(this._vrBlendResizeHandle);
              if (hb.length > 0) _panelHits.push({ name: 'VRBlendResize', panel: null, hit: hb[0], pressKey: '_vbsResizeWasPressed', isBlendResize: true });
            }
            if (this._vrResizeHandle?.visible && this._vrTimelineMesh?.visible) {
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
            if (this._gazeMenuBtn?.visible) {
              const h = _rc.intersectObject(this._gazeMenuBtn, false);
              if (h.length > 0) _panelHits.push({ name: 'GazeMenu', panel: null, hit: h[0], pressKey: '_gmWasPressed', isGazeMenu: true });
            }
          }

          // Phase 2: nearest hit wins
          _panelHits.sort((a, b) => a.hit.distance - b.hit.distance);
          let _winner = _panelHits[0] ?? null;
          let _winnerName = _winner?.name ?? null;
          const _trigger = this._padOf(source)?.buttons?.[0];
          // A GAZE PINCH AND A RIGHT-HAND PINCH ARE THE SAME PHYSICAL ACT ON VISION PRO.
          //
          // Pinching your right hand produces BOTH a hand source (our synthesised trigger) and a
          // separate transient-pointer source carrying the gaze ray. Both arrive in this loop on
          // the same frame. Handedness 'none' would fall into the 'R' bucket below and the two
          // would then share one Schmitt latch and one press owner — so one pinch would look
          // like a press that had already been captured by something else, and the second source
          // to arrive would be ignored. The gaze ray gets its own key.
          const _hand = _handKey;   // computed above, where the gate needed it

          // A SCHMITT TRIGGER, NOT A THRESHOLD.
          //
          // UI presses deliberately fire at a very light squeeze — the trigger's travel is long
          // and a precise click at the bottom of it is genuinely hard, so a small depress counts.
          // The cost of a low line is that an analog axis SITS on it: a finger resting at the
          // bite point wanders either side of 0.1 and every crossing is another down-edge. One
          // physical press then arrives as several.
          //
          // So pressing and releasing use different levels: it takes 0.10 to go down and has to
          // fall below 0.04 to come back up. In between, whatever it was, it stays. That is the
          // standard answer to a noisy comparator and it costs nothing — the light press is
          // exactly as light as before, it just cannot flutter.
          //
          // Per hand: two controllers, two independent fingers.
          if (!this._vrTrigHeld) this._vrTrigHeld = { L: false, R: false, G: false };
          const _tv = _trigger ? _trigger.value : 0;
          // AN ANALOG THRESHOLD IS FOR AN ANALOG TRIGGER, AND A HAND DOES NOT HAVE ONE.
          //
          // The Schmitt below exists because a controller's trigger is a long physical travel
          // that rests at 0 and a light press must count. A Galaxy XR hand reports something
          // quite different: a CONTINUOUS "how closed is this hand" value that idles around
          // 0.2-0.5 and essentially never returns to 0. Measured, with the runtime's own pressed
          // flag reading UP the whole time:
          //
          //   trig=up/0.41 pressed=true     trig=up/0.30 pressed=true     trig=up/0.12 pressed=true
          //
          // Once such a signal crosses the 0.10 entry it can never fall under the 0.04 release,
          // so one real pinch latched the press on for good: clicks that fired with the fingers
          // 2cm apart, pinches that appeared to do nothing because it was already down, and no
          // hover, because hover is the branch that only runs between edges.
          //
          // A hand runtime has already DECIDED. `pressed` is its gesture recogniser's boolean
          // output, and it is strictly better than anything we can infer from a value whose
          // resting point is not zero. So hands use the flag and controllers keep the Schmitt.
          const _handSrc = this._isHandSource(source);
          const _pressed = (_trigger && !this._wristPlaceActive())
            ? (_handSrc
                ? !!_trigger.pressed
                : (_trigger.pressed || (this._vrTrigHeld[_hand] ? _tv > 0.04 : _tv > 0.10)))
            : false;
          this._vrTrigHeld[_hand] = _pressed;

          // EVERY PINCH, NOT JUST THE ONES THAT REACH A PANEL.
          //
          // The per-panel edge line only prints inside the winner branch, so a press made while
          // the ray is off the panel leaves no trace at all — and "I pinched ten times and one
          // worked" is indistinguishable from "I pinched once".
          if (window._menuTrace) {
            if (!this._mtPrev) this._mtPrev = {};
            if (this._mtPrev[_hand] !== _pressed) {
              this._mtPrev[_hand] = _pressed;
              this._traceOut('TRIGGER ' + _hand + (_pressed ? ' DOWN' : ' UP  ')
                + ' winner=' + (_winnerName || 'NONE')
                + ' hits=' + (_panelHits.length || 0));
            }
          }

          // HOISTED ABOVE ITS FIRST READER, AND IT HAS TO STAY THERE.
          //
          // Initialised further down once, next to _pressCaptured, which meant the first thing
          // to read it dereferenced undefined and threw — and because the throw came BEFORE the
          // initialiser, it threw again every frame after, killing the whole panel dispatch for
          // the life of the session. It presented as "100% not getting any of my clicks".
          // It was also deleted once by accident while removing unrelated code above it, and the
          // harness caught that, which is why the check exists.
          if (!this._vrPressOwner) this._vrPressOwner = { L: null, R: null, G: null };

          // NO CLICK ASSISTS. The press goes where the ray is pointing, at the moment the
          // fingers close, and nowhere else.
          //
          // There were two here — a lookback that clicked the last button the ray had been over,
          // and a sticky target that honoured a panel the press had just left. Both were written
          // to paper over a pinch that was being suppressed near the wrist. With the real cause
          // fixed they are guesses about intent standing between the user and the button, and a
          // click that lands somewhere you did not point is worse than one that misses.

          // ONE PRESS BELONGS TO ONE SURFACE, FOR AS LONG AS IT IS HELD. See the note at the
          // dispatch loop below. Hoisted to here so the branches that handle the timeline, the
          // blendshape panel and the resize grips can consult it too — they are equally plausible
          // things to be sitting behind a keyboard when its confirm button closes it.
          if (!_pressed) this._vrPressOwner[_hand] = null;
          // True when this press was captured by something that is no longer the winner — so a
          // still-held trigger must not open a NEW interaction anywhere else.
          const _pressCaptured = (name) =>
            _pressed && this._vrPressOwner[_hand] && this._vrPressOwner[_hand] !== name;

          // Phase 2b: Drag lock — keep routing to whichever panel has an active
          // slider drag even after the controller ray exits its bounds.
          // Project the ray onto the panel plane to get a (possibly out-of-bounds)
          // UV; _sliderValueFromAbsX clamps the result, so the slider pegs at its
          // min/max rather than jumping when the cursor strays off the edge.
          {
            const _dragCandidates = [
              { name: 'MainMenuPanel',   panel: this._mainMenuPanel,      pressKey: '_mmWasPressed' },
              { name: 'FilesPanel',      panel: this._filesPanel,         pressKey: '_fpWasPressed' },
              ...(!_miniHudBlocked ? [{ name: 'MiniPanel', panel: this._miniPanel, pressKey: '_mpWasPressed' }] : []),
              { name: 'ToolPickerPanel', panel: this._toolPickerPanel,    pressKey: '_tpWasPressed' },
              { name: 'VrNumpad',        panel: this._vrNumpad,           pressKey: '_npWasPressed' },
              { name: 'VrKeyboard',      panel: this._vrKeyboard,         pressKey: '_kbWasPressed' },
            ];
            this._tornOffPanels?.forEach((panel, sectionId) => {
              _dragCandidates.push({ name: 'TornOff:' + sectionId, panel, pressKey: '_topWasPressed_' + sectionId });
            });
            const _locked = _dragCandidates.find(v => v.panel?._sliderDragTarget && v.panel?.mesh);
            // SHOW THE RADIUS WHERE THE USER IS LOOKING, WHILE THEY SET IT.
            //
            // Dragging the radius slider changes a number whose meaning is a size in the scene,
            // and the only way to see that size was to let go, move the controller off the panel
            // and watch the cursor. matt: "it would be good to draw the sphere radius at the menu
            // intersection point during the menu drag, so the user can directly see what the
            // radius is, vs having to move the controller away to preview."
            //
            // Drawn at the ray's intersection with the panel, so it appears where you are already
            // looking. It is the same physical radius the brush cursor uses, so what you see here
            // is what you will get — not a second calculation that can disagree with the first.
            this._radiusPreviewOn = false;
            // YOU CANNOT AIM A TOOL WITH THE TOOL YOU ARE AIMING.
            //
            // Dragging a spike slider moved the spike, which moved the ray, which moved where the
            // ray met the panel, which moved the slider — a closed loop that accelerated to the
            // end of its range in under a second and left the app unusable until localStorage was
            // cleared by hand. matt: "its far too easy to get into a runaway process and end up
            // with an unusable value."
            //
            // So the live spike is FROZEN for the duration of the drag: the accessors return the
            // value the drag started with, no matter what the slider writes. The pending value is
            // shown on a separate preview spike instead, so you can see the setting you are
            // choosing without it being able to affect the aim you are choosing it with.
            const _spikeIds = /mm-hand-len|mm-hand-off|mm-hand-pitch|mm-stylus-len|mm-stylus-off|mm-stylus-tilt/;
            const _sliderId = _locked?.panel?._sliderDragTarget?.id || '';
            if (_locked && /radius/i.test(_sliderId)) this._radiusPreviewOn = true;
            if (_spikeIds.test(_sliderId)) {
              if (!this._spikeFreeze) {
                // Snapshot on the frame the drag begins, from the live accessors, so the freeze
                // holds exactly what was on screen a moment ago.
                this._spikeFreeze = {
                  length: this.getStylusLength(),
                  offset: this.getStylusOffset(),
                  tilt:   this.getStylusTilt(),
                };
              }
              this._spikePending = { id: _sliderId, value: parseFloat(_locked.panel._sliderDragTarget.value) };
            } else if (this._spikeFreeze) {
              // Released: the slider's value is now the committed one, so stop overriding.
              this._spikeFreeze = null;
              this._spikePending = null;
              this._updateSpikePreview(null);
              try {
                this.updateStylusLength?.(this.getStylusLength());
                this.updateStylusOffset?.(this.getStylusOffset());
              } catch (e) { /* geometry re-apply is best effort */ }
            }
            if (this._spikePending) this._updateSpikePreview(this._spikePending);
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
                // CARRY THE WORLD POINT, not just the UV.
                //
                // This synthesised hit had uv and distance only, so anything downstream that
                // wants to draw AT the intersection — the ray reticle, and now the radius
                // preview — had nothing to position against and silently drew nothing. _hit is
                // already the world-space plane intersection, so it costs one clone.
                _winner = { ..._locked, hit: { uv: {
                  x:       (_local.x + _hw) / (_hw * 2),
                  y: 1.0 - (_local.y + _hh) / (_hh * 2),
                }, distance: 0, point: _hit.clone() } };
                _winnerName = _locked.name;
              }
            }
          }

          // Hand the clock back: without this the panel-hit label would swallow everything
          // downstream of it and read as though hit-testing cost the whole frame.
          this._mark('xr-pose');
          // Phase 3: build full visible-panel list so non-hit panels also get leave calls
          const _allVisible = [];
          if (this._miniPanel?.mesh?.visible)
            _allVisible.push({ name: 'MiniPanel', panel: this._miniPanel, pressKey: '_mpWasPressed' });
          if (this._toolPickerPanel?.mesh?.visible)
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
          if (this._vrKeyboard?.mesh?.visible)
            _allVisible.push({ name: 'VrKeyboard', panel: this._vrKeyboard, pressKey: '_kbWasPressed' });
          if (this._vrConfirm?.mesh?.visible)
            _allVisible.push({ name: 'VrConfirm', panel: this._vrConfirm, pressKey: '_vcWasPressed' });

          // ONE PRESS BELONGS TO ONE PANEL, FOR AS LONG AS IT IS HELD.
          //
          // Panels are resolved nearest-first and only the winner is dispatched to, so two panels
          // never take the same press in the same FRAME. The leak is across frames: a button that
          // CLOSES its own panel — the keyboard's confirm — hides the mesh while the trigger is
          // still down, so on the very next frame that panel is gone from the hit list, whatever
          // was behind it becomes the winner, its own `wasPressed` is false, and the still-held
          // trigger reads as a brand-new press on it. matt renamed an object in the outliner and
          // the confirm press fell through onto the panel underneath and spawned a mesh.
          //
          // So the press is CAPTURED by whichever panel receives its down-edge, and no other
          // panel may take a down-edge until the trigger is released. Pointer-capture semantics,
          // the same rule the slider drag-lock above already applies to moves. If the owner
          // vanishes mid-press, the press simply goes nowhere — which is right: it was spent on
          // the button that closed it.
          //
          // Per hand, because the two controllers are independent pointers.
          // WHY DID MY CLICK NOT LAND? window._menuTrace = true.
          //
          // Every stage of a menu press is a local in this function, so from outside it the
          // whole thing is opaque: a ray that misses, a winner that loses to a nearer panel, a
          // trigger that reads unpressed, and a press captured by something else all look
          // identical from the headset -- nothing happens. This prints the chain so the failing
          // stage names itself, in the same shape as the input diag that found the stroke bug.
          if (window._menuTrace) {
            this._mtN = (this._mtN || 0) + 1;
            if (this._mtN % 20 === 0) {
              this._traceOut(source.handedness + '/' + _hand
                + ' hits=' + (_panelHits.length ? _panelHits.map(h => h.name + '@' + h.hit.distance.toFixed(2)).join(',') : 'NONE')
                + ' winner=' + (_winnerName || 'null')
                + ' trig=' + (_trigger ? (_trigger.pressed ? 'down' : 'up') + '/' + (_trigger.value ?? 0).toFixed(2) : 'NO-TRIGGER')
                + ' pressed=' + _pressed
                + ' owner=' + JSON.stringify(this._vrPressOwner)
                + ' placing=' + this._wristPlaceActive()
                + ' visible=[' + _allVisible.map(v => v.name).join(',') + ']');
            }
          }

          for (const v of _allVisible) {
            if (v.name === _winnerName) {
              // Blocked only for a NEW press. A panel that already owns this press keeps
              // receiving move and release as normal.
              const _blocked = !this[v.pressKey] && _pressCaptured(v.name);
              if (_blocked) {
                // Still count as pointing at UI, so the press cannot fall through to sculpting
                // either — and leave the press flag alone, or the release would arrive as a click.
                this._isPointingAtMenu = true;
                this._updateBPCursor?.(_winner.hit.point, true);
                continue;
              }
              const justDown = _pressed && !this[v.pressKey];
              const justUp   = !_pressed && this[v.pressKey];

              // THE PRESS DECISION, REPORTED WHERE IT IS ACTUALLY MADE.
              //
              // The previous trace stopped at "which panel", so three different outcomes all
              // looked like nothing happening: a press that never became a down-edge, a
              // down-edge blocked by another surface owning the press, and a down-edge that
              // landed cleanly between two buttons. Dots going green while hover kept working
              // says the latch is on and this branch is being reached, so the fault is one of
              // those three and the line below names which.
              if (window._menuTrace && (justDown || justUp || _pressed !== this[v.pressKey])) {
                let desc = 'n/a', btnTxt = 'NONE';
                try {
                  const hit = v.panel._uvToElement ? v.panel._uvToElement(_winner.hit.uv) : null;
                  const el = hit && hit.el;
                  if (el) {
                    desc = el.tagName.toLowerCase()
                      + (el.className ? '.' + String(el.className).split(' ').filter(Boolean).join('.') : '');
                    const b = el.closest ? el.closest('button') : null;
                    if (b) btnTxt = '"' + (b.textContent || '').trim().slice(0, 24) + '"';
                  }
                } catch (e) { desc = 'uvToElement threw: ' + e.message; }
                this._traceOut(v.name + ' justDown=' + justDown + ' justUp=' + justUp
                  + ' pressed=' + _pressed + ' wasPressed=' + !!this[v.pressKey]
                  + ' blocked=' + _blocked + ' owner=' + (this._vrPressOwner[_hand] || 'null')
                  + ' element=' + desc + ' button=' + btnTxt);
              }
              if (justDown) this._vrPressOwner[_hand] = v.name;
              if (justDown)    v.panel.onVRPress(_winner.hit.uv);
              else if (justUp) v.panel.onVRRelease(_winner.hit.uv);
              else             v.panel.onVRMove(_winner.hit.uv, source.handedness,
                                                  window._hoverTrace ? _rc.ray.origin : null);
              this[v.pressKey] = _pressed;
              this._isPointingAtMenu = true;
              if (source.handedness === 'left') { this._vrUIHitDistLeft  = _winner.hit.distance; this._vrUIHitSourceLeft  = _winnerName; this._panelRayLatch.left = { name: this._vrUIHitSourceLeft, t: performance.now() }; }
              else                              { this._vrUIHitDistRight = _winner.hit.distance; this._vrUIHitSourceRight = _winnerName; this._panelRayLatch.right = { name: this._vrUIHitSourceRight, t: performance.now() }; }
              this._updateBPCursor?.(_winner.hit.point, true);
            } else {
              if (this[v.pressKey]) {
                // When the numpad is open, drop the synthetic centre-UV release
                // rather than dispatching it — that click lands on whatever DOM
                // element happens to be at UV(0.5,0.5), which is exactly where
                // the FPS slider / play button live in the animation panel.
                // Always clear the flag so the panel doesn't stay "stuck" pressed.
                //
                // A manipulation taking over the controller is the same case as the numpad and
                // wants the same treatment: the flag has to be cleared or the eventual release
                // reads as a click, but the synthetic centre-UV release must not be DISPATCHED,
                // or grabbing a pin while the ray happened to rest on a panel presses whatever
                // sits at the middle of it. See _strokeOwnsInput.
                if (!_numpadOpen && !_strokeBusy) v.panel.onVRRelease({ x: 0.5, y: 0.5 });
                this[v.pressKey] = false;
              }
              // Named, so a panel can tell "the hand that was hovering me left" from "the
              // OTHER hand is pointing somewhere else", which happens every frame.
              v.panel.onVRLeave(source.handedness);
            }
          }

          // VRTimeline dispatch (separate interface, preserves _vtlDragActive gate)
          if (_winner?.isTimeline) {
            this._vtlIsPointing = true;
            this._isPointingAtMenu = true;
            if (source.handedness === 'left') { this._vrUIHitDistLeft  = _winner.hit.distance; this._vrUIHitSourceLeft  = 'VRTimeline'; this._panelRayLatch.left = { name: this._vrUIHitSourceLeft, t: performance.now() }; }
            else                              { this._vrUIHitDistRight = _winner.hit.distance; this._vrUIHitSourceRight = 'VRTimeline'; this._panelRayLatch.right = { name: this._vrUIHitSourceRight, t: performance.now() }; }
            this._updateBPCursor?.(_winner.hit.point, true);
            // While a gesture that OWNS the panel is running, don't also pan/select with the
            // dominant hand — just keep the press latch in sync so the release is not seen as
            // a fresh press afterwards.
            //
            // A RESIZE is one of those, and used not to be listed. Dragging the corner grip
            // outward grows the panel INTO the ray that is doing the dragging, so the timeline
            // starts receiving pointer-downs from the same held trigger and opens a marquee
            // behind the resize. matt: "while resizing larger it often draws the marquee select
            // region." The trigger is already committed to the grip; nothing else should read
            // it until it is released.
            if (this._vtlZoomActive || this._vtlResizeActive) {
              this._vtlWasPressed = _pressed;
            } else if (!this._vtlDragActive) {
              const justDown  = _pressed && !this._vtlWasPressed;
              const justUp    = !_pressed && this._vtlWasPressed;
              if (justDown) this._vrPressOwner[_hand] = 'VRTimeline';
              // Non-dominant trigger held = additive marquee (Shift-equivalent in VR)
              const _addShift = !!this._vrSecondaryTriggerPressed;
              if (justDown)    this._onVRTimelineHit(_winner.hit.uv, 'down', true,     _addShift);
              else if (justUp) this._onVRTimelineHit(_winner.hit.uv, 'up',   false,    _addShift);
              else             this._onVRTimelineHit(_winner.hit.uv, 'move', _pressed, _addShift);
              this._vtlLastDragUV = _winner.hit.uv;   // remember for off-panel release
              this._vtlWasPressed = _pressed;
            }
          } else if (this._vtlWasPressed && _pressed && !this._vtlZoomActive
                     && !this._vtlDragActive && !this._vtlResizeActive) {
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
            if (source.handedness === 'left') { this._vrUIHitDistLeft  = _winner.hit.distance; this._vrUIHitSourceLeft  = 'VRBlendshapes'; this._panelRayLatch.left = { name: this._vrUIHitSourceLeft, t: performance.now() }; }
            else                              { this._vrUIHitDistRight = _winner.hit.distance; this._vrUIHitSourceRight = 'VRBlendshapes'; this._panelRayLatch.right = { name: this._vrUIHitSourceRight, t: performance.now() }; }
            this._updateBPCursor?.(_winner.hit.point, true);
            const _solo     = !!this._vrSecondaryTriggerPressed;
            const _justDown = _pressed && !this._vbsWasPressed;
            const _justUp   = !_pressed && this._vbsWasPressed;
            if (_justDown) this._vrPressOwner[_hand] = 'VRBlendshapes';
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

          if (this._radiusPreviewOn && _winner?.hit?.point) {
            this._updateRadiusPreview(_winner.hit.point, this._vrBrushPhysicalRadius);
          } else if (this._radiusPreview && this._radiusPreview.visible) {
            this._radiusPreview.visible = false;
          }

          // Gaze menu button — the only way to open a menu on a runtime with no buttons.
          // Same press-edge shape as the close buttons above, plus a hover repaint so the
          // button acknowledges the ray; on Vision Pro that highlight is the ONLY feedback
          // available before you commit, because Apple gives no gaze direction until you pinch.
          if (_winner?.isGazeMenu) {
            this._isPointingAtMenu = true;
            this._updateBPCursor?.(_winner.hit.point, true);
            if (!this._gazeMenuHot) { this._gazeMenuHot = true; this._gazeMenuBtn._redraw(true); }
            if (_pressed && !this._gmWasPressed) this._gazeMenuPressed();
            this._gmWasPressed = _pressed;
          } else {
            if (this._gazeMenuHot) { this._gazeMenuHot = false; this._gazeMenuBtn?._redraw(false); }
            if (this._gmWasPressed) this._gmWasPressed = false;
          }

          // VRTimeline resize handle — trigger starts a resize drag tracked via ray-plane intersection
          // A press captured elsewhere must not start a resize, a scrub or a key drag either —
          // same rule as the panels below, applied to the surfaces that dispatch on their own.
          if (_winner && _pressCaptured(_winnerName) && !this[_winner.pressKey]) {
            _winner = null; _winnerName = null;
          }

          if (_winner?.isBlendResize) {
            this._isPointingAtMenu = true;
            this._updateBPCursor?.(_winner.hit.point, true);
            const justDown = _pressed && !this._vbsResizeWasPressed;
            if (justDown && !this._vbsResizeActive) {
              this._vrPressOwner[_hand] = 'VRBlendResize';
              this._vbsResizeState = this._beginVRPanelResize(this._vrBlendMesh);
              this._vbsResizeActive = true;
              this._vbsResizeHand = source.handedness;
            }
            if (!_pressed) { this._vbsResizeActive = false; this._vbsResizeHand = null; }
            this._vbsResizeWasPressed = _pressed;
          } else if (this._vbsResizeWasPressed) {
            this._vbsResizeWasPressed = false;
          }

          if (this._vbsResizeActive && this._vbsResizeHand === source.handedness && this._vbsResizeState) {
            this._applyVRPanelResize(_rc.ray, this._vbsResizeState, {
              mesh: this._vrBlendMesh, texture: this._vrBlendTexture, panel: this._vrBlendPanel,
              // px per metre, matching the panel's own mount ratio so the canvas keeps its scale
              // instead of the text growing as the panel does.
              px: 1500,
              minW: 0.16, maxW: 0.90, minH: 0.16, maxH: 1.10,
              optW: 'vrBlendW', optH: 'vrBlendH',
              after: () => {
                this._layoutVRResizeGrip(this._vrBlendResizeHandle, this._vrBlendMesh);
                if (this._vrBlendCloseBtn) this._layoutCloseBtn(this._vrBlendCloseBtn, this._vrBlendMesh);
              },
            });
          }

          if (_winner?.isTimelineResize) {
            this._vtlIsPointing = true;
            this._isPointingAtMenu = true;
            this._updateBPCursor?.(_winner.hit.point, true);
            const justDown = _pressed && !this._vtlResizeWasPressed;
            if (justDown && !this._vtlResizeActive) {
              this._vrPressOwner[_hand] = 'VRTimelineResize';
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
                this._layoutTimelineResizeHandle();

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

          // A PRESS THAT BEGAN OFF-PANEL NEVER REACHES A PANEL. This is the general form of the
          // rule, and the reason it is here rather than in a list of tools:
          //
          // _strokeOwnsInput asks the TOOL whether a manipulation is live, and a tool has to
          // implement the hook to be counted. Grab did; BoneDrawTool did not, so Tweak FK swept
          // the wrist menu and pressed it. matt: "if i am the controller at a panel during a
          // drag, it starts affecting the menu." Enumerating tools means the next tool with a
          // drag state is the next bug, and there are six drag states in BoneDrawTool alone.
          //
          // WHERE THE PRESS BEGAN is tool-agnostic and is what the rule is actually about. The
          // press-owner latch below already exists for exactly this shape -- one press belongs to
          // one surface for as long as it is held -- it simply had no name for "the scene". Now
          // it does, and a trigger closed anywhere that is not a panel owns itself until release,
          // whatever the tool does with it. The gate above then skips hit collection entirely, so
          // hover stops too, which is the half a press-capture alone would miss.
          if (_pressed && !this._vrPressOwner[_hand]) this._vrPressOwner[_hand] = 'scene';

          // No panel hit — hide panel cursor
          if (!_winner) this._updateBPCursor?.(null, false);

          // Track for next-frame thumbstick scroll routing
          if (_winner && !_winner.isTimeline && !_winner.isTimelineResize) this._lastHtmlPanelHit = _winner.panel;
          else if (!_winner) this._lastHtmlPanelHit = null;

          // Periodic state sync (independent of hit)
          this._mpSyncCounter = (this._mpSyncCounter || 0) + 1;
          if (this._mpSyncCounter % 30 === 0) this._miniPanel?.syncFromState?.();
          // ── end unified HTML panel raycast ────────────────────────────────

          // Periodic state sync for MainMenuPanel (keeps symmetry/tool highlight fresh).
          // Call _rebuildContent directly so the cache key still suppresses no-op repaints.
          this._mmSyncCounter = (this._mmSyncCounter || 0) + 1;
          if (this._mmSyncCounter % 30 === 0) this._mainMenuPanel?._rebuildContent?.();

          // THE LEGACY CANVAS RAYCAST STOOD HERE. Main menu, wrist MiniHUD and popup were all
          // VRMenu quads intersected by hand, with a drag-capture lock so a slider did not jump
          // when the ray slipped between them. All three are gone; the HTML panels claim the ray
          // above. The only part with anything left to do is the miss case below, which clears
          // this hand's laser distance. See docs/render_stack_audit.md.

          // A ray that hits no panel clears this hand's laser distance. Everything else that
          // stood here belonged to the canvas GUIs. `_isPointingAtMenu` is set by the HTML
          // panel raycast above, so this only fires on a genuine miss.
          if (!this._isPointingAtMenu) {
            if (source.handedness === 'left') this._vrUIHitDistLeft = Infinity;
            else this._vrUIHitDistRight = Infinity;
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
            // window.screenLog(`Ray Fail: RaySp:${hasRaySpace} GripSp:${hasGripSpace} Menu:${hasMenu}`, "red");
          }
        }
      }

      // 3. Navigation Data (Base Space - Stable coordinates)
      if (this._baseRefSpace) {
        const basePose = frame.getPose(gripSpace, this._baseRefSpace);
        if (basePose) {
          const originBase = [basePose.transform.position.x, basePose.transform.position.y, basePose.transform.position.z];

          // Grip Button (Button 1 or Trigger/Squeeze?)
          // Usually Button 1 is Squeeze. Button 0 is Trigger.
          const isGrip = !!this._padOf(source)?.buttons?.[1]?.pressed;

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
          const mmOnPanel  = _hitSrc === 'MainMenuPanel';

          // ── MainMenuPanel grip drag (pinned) ──────────────────────────────
          const mmCanStart    = this._mainMenuPanel?.pinned && mmOnPanel && isGrip && !this._mmDragActive && !this._vtlIsPointing && !_panelDragBusy && !_worldNavBusy;
          const mmCanContinue = this._mmDragActive && this._mmDragHand === source.handedness && isGrip;
          if (mmCanStart || mmCanContinue) {
            const refPose = frame.getPose(gripSpace, refSpace);
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
          // The live ray OR what it was on a moment ago — see _panelGrabIntent for why the
          // difference matters with a fist.
          const _vtlIntent = this._vtlIsPointing
            || this._panelGrabIntent(source.handedness)?.name === 'VRTimeline';
          const canStartVtlDrag  = this._vrTimelineMesh?.visible && _vtlIntent && isGrip && !this._vtlDragActive && !_panelDragBusy && !_worldNavBusy;
          const canContinueVtlDrag = this._vtlDragActive && this._vtlDragHand === source.handedness && isGrip;

          if (canStartVtlDrag || canContinueVtlDrag) {
            const refPose = frame.getPose(gripSpace, refSpace);
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
            const refPose = frame.getPose(gripSpace, refSpace);
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
            const refPose = isGrip ? frame.getPose(gripSpace, refSpace) : null;
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

          // A MISSED PANEL GRAB MUST COST NOTHING. This is the half that was actually punishing:
          // a fist that failed to land on the panel fell straight through to world navigation and
          // spun the entire scene, so every near-miss had to be undone before trying again. matt:
          // "i kept missing the grab and it would turn the world instead."
          //
          // If the ray is on a panel, or was a moment ago, the grip belongs to that panel whether
          // or not a drag actually started — so a miss does nothing at all and you simply close
          // your hand again. The world is still grabbable everywhere that is not a panel, which
          // is almost everywhere.
          //
          // window._panelGrabGuard = false restores the old fall-through in-session.
          if (isGrip && window._panelGrabGuard !== false
              && (this._isPointingAtMenu || this._panelGrabIntent(source.handedness))) {
            if (source.handedness === 'left') { leftGrip = false; }
            else                              { rightGrip = false; }
          }
        }
      }

      // 4. Stylus / Trigger Dominance
      if (this._padOf(source)?.buttons?.[0]?.pressed) {
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
      return !!this._padOf(src)?.buttons?.[0]?.pressed;
    };
    
    // We update this check to be more robust, delegating the actual evaluation to the specific activeSource later
    const rightPressed = false; 
    const leftPressed = false;

    // Helper: Specific Tool Override
    const tool = this._sculptManager.getCurrentTool();
    const isVoxel = tool && tool.constructor && tool.constructor.name === 'SculptVoxel';

    // Priority: Locked Hand (if sculpting) > Pressed Hand > Dominant Hand > Other Hand > First Found
    const domSource = this._dominantHand === 'left' ? left : right;

    // THE HAND LOCK IS A LATCH, AND A LATCH THAT CANNOT BE OPENED IS A DEADLOCK.
    //
    // While a stroke is in progress the active hand is pinned, so a stray reading from the
    // other controller cannot steal the stroke mid-drag. But the lock is only ever released
    // inside processVRSculpting — and processVRSculpting only runs when this block resolves
    // an activeSource. So if the locked hand is not among the current input sources, the old
    // code left activeSource null, processVRSculpting did not run, nothing cleared the lock,
    // and the next frame asked the same impossible question again. From that point on there
    // is no brush centre and no pick FOR THE REST OF THE SESSION: the radius indicator has
    // nothing to draw and grab has nothing to grab, while the menus (handled elsewhere) go on
    // working perfectly — which reads exactly like a half-broken build.
    //
    // A controller can leave inputSources for ordinary reasons: it sleeps, its battery dies,
    // it loses tracking, or the session was torn down and rebuilt around it (switching VR to
    // AR ends one session and starts another). None of those should cost the rest of the
    // session, so failing to resolve the locked hand now ENDS the stroke and falls through to
    // the normal choice rather than pinning on a hand that is not there.
    if (this._vrSculpting && this._vrLockedHand) {
      // Find the locked hand source
      const locked = (this._vrLockedHand === 'right') ? right : left;
      if (locked) {
        activeSource = locked;
      } else {
        this._vrSculpting = false;
        this._vrLockedHand = null;
        if (this._sculptManager) this._sculptManager.end();
        if (window.screenLog) window.screenLog('VR: sculpt hand lost, stroke ended', '#f9e2af');
      }
    }

    if (activeSource) {
      // already chosen by the lock above
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

    // NO ACTIVE SOURCE, SESSION LIVE — say so, unprompted.
    //
    // This is the state every "the build is half broken" report has looked like from inside
    // the headset: no brush centre, no pick, no grab, menus fine. It is worth a line on the
    // screen log rather than silence, because the alternative is noticing it mid-recording and
    // having no idea whether it is the app, the build, or the controller. Counted in frames
    // and announced once per episode, so a single dropped frame says nothing.
    if (!activeSource) {
      this._noSourceFrames = (this._noSourceFrames || 0) + 1;
      if (this._noSourceFrames === 120 && !this._noSourceWarned) {
        this._noSourceWarned = true;
        window._vrNoSourceAt = Date.now();
        const msg = 'VR: no active controller (sculpting=' + !!this._vrSculpting +
          ' locked=' + (this._vrLockedHand || 'none') + ' sources=' + sources.length + ')';
        console.warn('[Scene] ' + msg);
        if (window.screenLog) window.screenLog(msg, '#f38ba8');
      }
    } else {
      this._noSourceFrames = 0;
      this._noSourceWarned = false;
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



    // #19 Navigation inertia — continue any post-release world glide (after grip
    // dispatch so the per-hand active flags reflect this frame).
    this._updateNavGlide();

    // #29 — keep the recent-tool history current for quick-swap.
    this._trackToolHistory();

    // #23/#29 — position the floating button labels and tool-swap toast.
    this._updateVrFloaters();

    // Gizmo proprioception: when transforming, the controller often reaches inside the
    // (opaque) mesh at the gizmo centre. Render the stylus spike on top + bright so you can
    // always see where your hand is relative to the gizmo (which also draws on top).
    this._updateStylusXray();

    // Update Three.js Laser Pointer Visual Lengths and Cursors
    this._updateVRCursors(frame, refSpace, sources);
    sampleVR(this);

    // Buffer menu pointing state for exactly one frame to absorb trigger releases when menus close
    this._wasPointingAtMenu = this._isPointingAtMenu;
    this._wasVbsPanelPointed = this._vbsPanelPointed; // same one-frame buffer for the blend panel
  } catch (e) {
      if (Math.random() < 0.05) console.error("[SculptXR] XR Input Error:", e);
    }
  }

  // #19 Navigation inertia: called once per frame after grip dispatch. While a
  // single-grip world move (or two-handed nav) is active, the world is driven
  // directly and no glide runs. On release, if there was enough residual velocity,
  // keep moving the world with exponential decay until it slows to a stop. Any new
  // grip, two-handed nav, or a sculpt stroke cancels the glide.
  // 0 = the scene stops where you let go; 1 = the throw as it has always been. Live value first
  // so a console tweak takes effect on the next release, then the saved one -- the same order
  // every other persisted VR setting is read in.
  _navThrowScale() {
    const live = window._navThrow;
    if (live != null) return Math.max(0, Math.min(1, +live));
    const saved = getOptionsURL().navThrow;
    return saved != null ? Math.max(0, Math.min(1, +saved)) : 1;
  }

  _updateNavGlide() {
    const g = this._navGlide;
    const navActive = this._vrGrip.left.active || this._vrGrip.right.active || this._vrTwoHanded.active;
    const rotAngle = (q) => 2 * Math.acos(Math.min(1, Math.abs(q[3]))); // radians/frame
    if (navActive || this._vrSculpting) {
      g.gliding = false;
      if (navActive) {
        // Buffer recent velocities so the throw launches from motion just BEFORE release,
        // not the final frame — some runtimes (e.g. Galaxy XR) damp controller motion at
        // release, which otherwise zeroes the throw.
        (g.velHist = g.velHist || []).push([g.vel[0], g.vel[1], g.vel[2]]);
        (g.rotHist = g.rotHist || []).push([g.rotVel[0], g.rotVel[1], g.rotVel[2], g.rotVel[3]]);
        if (g.velHist.length > 6) { g.velHist.shift(); g.rotHist.shift(); }
      }
      g.wasActive = navActive;
      return;
    }
    if (g.wasActive) {
      g.wasActive = false;
      // Use the strongest recent sample (ignores a damped final frame at release).
      if (g.velHist) {
        let best = vec3.length(g.vel);
        for (const v of g.velHist) { const l = vec3.length(v); if (l > best) { best = l; vec3.set(g.vel, v[0], v[1], v[2]); } }
      }
      if (g.rotHist) {
        let bestA = rotAngle(g.rotVel);
        for (const q of g.rotHist) { const a = rotAngle(q); if (a > bestA) { bestA = a; quat.set(g.rotVel, q[0], q[1], q[2], q[3]); } }
      }
      // WAS THIS A THROW, AND HOW FAST -- TWO QUESTIONS, TWO ANSWERS.
      //
      // Both used to come from the same number: the STRONGEST sample in the window, tested
      // against the threshold. So a single noisy frame while letting go from rest was enough to
      // launch, and the scene drifted off the position you had just placed it at.
      // adurna35: "it always shifts away a little from my intended position when letting go."
      //
      // The magnitude still comes from the strongest sample, because that is what the Galaxy XR
      // fix above needs -- that runtime damps controller motion on the release frame, and taking
      // the last frame would zero a real throw. But the DECISION now asks whether you were moving
      // for the window rather than for an instant: at least half the buffered samples over the
      // threshold. Measured against the five cases that matter (speed per frame):
      //
      //   let go from rest, one noisy frame   .0003 .0004 .0002 .0030 .0004 .0003   was FLY, now --
      //   let go from rest, pure noise        .0004 .0003 .0005 .0004 .0002 .0006    --       --
      //   slow deliberate nudge               .0018 .0021 .0025 .0027 .0030 .0028   FLY      FLY
      //   deliberate throw, accelerating      .0010 .0020 .0040 .0070 .0100 .0120   FLY      FLY
      //   throw with damped final frame (GXR) .0080 .0090 .0100 .0110 .0120 .0010   FLY      FLY
      //
      // Half rather than all, because a throw ACCELERATES -- its first samples are slow, and
      // requiring every one of them would refuse the gesture it exists for.
      const _sustained = (hist, measure, thresh) => {
        if (!hist || !hist.length) return false;
        let n = 0;
        for (const e of hist) if (measure(e) > thresh) n++;
        return n >= Math.ceil(hist.length / 2);
      };
      const _flyT = _sustained(g.velHist, (v) => Math.hypot(v[0], v[1], v[2]), 0.002);
      const _flyR = _sustained(g.rotHist, (q) => rotAngle(q), 0.004);
      g.velHist = null; g.rotHist = null;

      // AND A WAY TO TURN IT DOWN. Inertia had no setting of any kind; the ask was for one.
      // Scales the launch speed, and 0 means the scene simply stops where you left it.
      const throwScale = this._navThrowScale();
      if (throwScale <= 0) {
        g.gliding = false;
      } else {
        if (throwScale !== 1) {
          vec3.scale(g.vel, g.vel, throwScale);
          quat.slerp(g.rotVel, QUAT_IDENTITY, g.rotVel, throwScale);
        }
        g.gliding = _flyT || _flyR;
      }
    }
    if (g.gliding) {
      this.moveWorld([g.vel[0], g.vel[1], g.vel[2]]);
      if (rotAngle(g.rotVel) > 1e-5) this.rotateWorld(g.rotVel, g.pivot);
      vec3.scale(g.vel, g.vel, 0.92);                       // translational friction
      quat.slerp(g.rotVel, g.rotVel, QUAT_IDENTITY, 0.08);  // rotational friction
      if (vec3.length(g.vel) < 0.0005 && rotAngle(g.rotVel) < 0.0008) g.gliding = false;
    }
  }

  // Per-frame placement/billboarding for the floating tool toast (#29) and the
  // controller button labels (#23). Both hover above their controller and face the head.
  // The real spike renders exactly as always (correctly occluded). Alongside it sits an
  // xray GHOST (depthFunc GreaterDepth) that draws ONLY where the spike is behind geometry —
  // so when the controller dips under the mesh surface at the gizmo centre you see it through,
  // and never as an always-on-top overlay. Just toggle the ghost on for the transform tool.
  _updateStylusXray() {
    const sm = this._sculptManager;
    const idx = sm && sm.getToolIndex ? sm.getToolIndex() : -1;
    // Bone draw needs the ghost even more than the gizmo does: joints are placed INSIDE
    // the mesh, so without the reveal you are aiming a tip you cannot see.
    // GRAB reaches inside a mesh for exactly the same reason the gizmo does — you take hold of
    // something at its centre — so it wants the same reveal. This is an explicit list rather
    // than a universal rule: the sculpt brushes work ON the surface, and revealing the spike
    // through the mesh for them would be an always-on blue tip with nothing to look at.
    //
    // MOVE AND SMOOTH JOIN THE LIST ONLY WHILE A MOTION PATH IS ON SCREEN. The rule above says
    // sculpt brushes are excluded because they work ON the surface — true while they are
    // sculpting, and false the moment they are editing a motion path, which hangs inside and
    // behind the model. So the condition is the STRAND, not the tool: with no path drawn they
    // behave exactly as before.
    const pathTool = idx === Enums.Tools.MOVE || idx === Enums.Tools.SMOOTH;
    const onPath = pathTool && !!this._trailStrand;
    const on = idx === Enums.Tools.TRANSFORM || idx === Enums.Tools.TRANSFORM_VR ||
               idx === Enums.Tools.BONE_DRAW || idx === Enums.Tools.GRAB || onPath;
    // Only the DOMINANT controller drives the gizmo, so only reveal its spike.
    //
    // THE STRAND HAS TO BE IN THE CACHE KEY. This function returns early when the key is
    // unchanged, and `onPath` can flip without the tool changing — select a pin and the path
    // appears under the same Move tool. Keying on the hand alone would latch whichever state
    // happened to be current when Move was selected, which is the exact shape of the bug this
    // cache caused for the transform tools before.
    const key = on ? this._dominantHand + (onPath ? ':path' : '') : 'off';
    if (key === this._stylusXrayKey) return;
    const dom = this._dominantHand === 'left' ? this._vrControllerLeft : this._vrControllerRight;
    const other = this._dominantHand === 'left' ? this._vrControllerRight : this._vrControllerLeft;
    const domGhost = dom && dom.getObjectByName && dom.getObjectByName('stylus_spike_ghost');
    const otherGhost = other && other.getObjectByName && other.getObjectByName('stylus_spike_ghost');
    // CACHE THE WRITE, NOT THE INTENT. The controller objects are assigned by the 'connected'
    // event and nulled again by the wiped-state branch, so this can run with no ghost to
    // write to — and recording the key anyway latched the failure in: the early return above
    // then skipped every retry for as long as the tool stayed selected. Entering VR with
    // Transform already active is enough to hit it, and because the key is the HAND (not the
    // tool) even switching Transform <-> TransformVR would not clear it.
    if (!domGhost) return;
    this._stylusXrayKey = key;
    domGhost.visible = on;
    if (otherGhost) otherGhost.visible = false;
  }

  _updateVrFloaters() {
    if (!this._toolToast && !window._vrShowButtonLabels && !this._btnLabels) return;
    const cam = this._renderer?.xr?.getCamera?.(this._camera.getThreeCamera());
    if (!cam) return;
    const tmp = this._fTmpVec || (this._fTmpVec = new THREE.Vector3());
    const headQ = this._fTmpQuat || (this._fTmpQuat = new THREE.Quaternion());
    cam.getWorldQuaternion(headQ);
    const now = performance.now();

    // #29 toast — above the right controller, auto-hide after its window.
    if (this._toolToast) {
      const m = this._toolToast.mesh;
      if (now > this._toolToastUntil || !this._vrControllerRightGrip) {
        m.visible = false;
      } else {
        this._vrControllerRightGrip.getWorldPosition(tmp);
        m.position.copy(tmp); m.position.y += 0.11;
        m.quaternion.copy(headQ);
        m.visible = true;
      }
    }

    // #23 button labels — auto-shown briefly on session entry, then off; toggle anytime.
    if (this._btnLabelsAutoHideAt && now > this._btnLabelsAutoHideAt) {
      window._vrShowButtonLabels = false;
      this._btnLabelsAutoHideAt = 0;
    }
    if (window._vrShowButtonLabels) {
      this._ensureButtonLabels();
      // Offset each label to the OUTSIDE of its controller along the head's right
      // axis (left label → left of left controller, right label → right of right).
      const right = this._fTmpVec2 || (this._fTmpVec2 = new THREE.Vector3());
      right.set(1, 0, 0).applyQuaternion(headQ);
      const place = (o, grip, sign) => {
        if (!o || !grip) { if (o) o.mesh.visible = false; return; }
        grip.getWorldPosition(tmp);
        tmp.addScaledVector(right, sign * 0.13); // sideways, clear of the controller
        tmp.y += 0.02;
        o.mesh.position.copy(tmp);
        o.mesh.quaternion.copy(headQ);
        o.mesh.visible = true;
      };
      place(this._btnLabels.left, this._vrControllerLeftGrip, -1);
      place(this._btnLabels.right, this._vrControllerRightGrip, +1);
    } else if (this._btnLabels) {
      this._btnLabels.left.mesh.visible = false;
      this._btnLabels.right.mesh.visible = false;
    }
  }

  // Shared VR text-on-plane helper (used by the tool-swap toast and button labels).
  // Returns a scene-added, billboard-positioned plane with a 2D canvas to draw into.
  _makeVrTextPlane(canvasW, canvasH, planeW) {
    const canvas = document.createElement('canvas');
    canvas.width = canvasW; canvas.height = canvasH;
    const ctx = canvas.getContext('2d');
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const planeH = planeW * canvasH / canvasW;
    const geo = new THREE.PlaneGeometry(planeW, planeH);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 1000;
    mesh.visible = false;
    this._scene.add(mesh);
    return { mesh, canvas, ctx, tex };
  }

  // Observe tool changes from any source (menu, picker, swap) to keep a 2-deep
  // history of distinct non-Smooth tools, so the quick-swap can Alt-Tab between them.
  _trackToolHistory() {
    const sm = this._sculptManager;
    if (!sm) return;
    const id = sm.getToolIndex();
    if (id === this._lastSeenTool) return;
    this._lastSeenTool = id;
    if (id === Enums.Tools.SMOOTH) return;          // Smooth is excluded from the pair
    if (this._toolHistory[0] === id) return;
    this._toolHistory.unshift(id);
    if (this._toolHistory.length > 2) this._toolHistory.length = 2;
  }

  // #29 Quick tool-swap: toggle to the OTHER of the two most-recent non-Smooth tools,
  // mirroring the ToolPicker side effects, and show a brief floating name toast.
  // The cross-platform context-menu command model — the single source consumed by BOTH
  // the VR radial (VrRadialMenu) and the flatscreen desktop/iPad "…" menu (MainMenuPanel).
  // Each entry is { label, icon, enabled, run }. The radial ignores `icon` and dims
  // `enabled === false`; the "…" menu renders the icon and disables the row.
  // THE PIN MENU, on A. It replaces a CYCLE: pressing A walked unpinned -> position -> 6DOF ->
  // rotation -> steer -> unpinned, so reaching a mode meant counting presses and watching the
  // marker, and getting there from the wrong end meant going all the way round. Five states is
  // two too many for a cycle. A ring shows all of them at once and costs one gesture whichever
  // you want.
  //
  // Acts on the preselected joint first and the selection second, which is the same rule the B
  // menu uses -- in the headset you are already pointing at the joint you mean.
  // ── IS THIS TRIGGER DOWN? ONE ANSWER ────────────────────────────────────────
  //
  // Press point (labelled "Trigger sensitivity" until v3.42.29) maps the slider (0 Hard .. 1
  // Light) onto a threshold of 0.9 .. 0.1 on
  // the ANALOG value. A light setting means a sculpt stroke starts well before the runtime
  // calls the button `pressed`.
  //
  // The offhand-Smooth override was asking `buttons[0].pressed` instead -- the runtime's own
  // boolean, which trips near a full pull. So with a light setting a small pull passed the
  // sculpt threshold and started a stroke, while the override never armed: you got the primary
  // tool where you had asked for Smooth. matt: "if i pull the primary trigger a small amount,
  // it lets the primary tool get through, causing nasty glitches when i expected it to be
  // smoothing." A full pull crossed both tests, which is why it worked sometimes.
  //
  // HANDS KEEP THE RUNTIME'S BOOLEAN, for the reason written at the sculpt test: a hand's
  // trigger value is a continuous closure signal that rests well above zero, so a travel
  // threshold on it either latches on for ever or fires on a relaxed hand. Sensitivity is a
  // setting about a physical trigger and has nothing to calibrate on a gesture.
  _triggerThreshold() {
    // slider is 0.0 (Hard) to 1.0 (Light) -> threshold 0.9 (Hard) to 0.1 (Light)
    const tc = getOptionsURL().triggerCurve;
    return Number.isFinite(tc) ? 0.9 - (tc * 0.8) : 0.5;
  }

  _isTriggerDown(source) {
    const b = this._padOf(source)?.buttons?.[0];
    if (!b) return false;
    if (this._isHandSource(source)) return !!b.pressed;
    return (b.value ?? 0) >= this._triggerThreshold();
  }

  _resolvePinJoint() {
    const hov = Skeleton.hoveredJoint(this);
    if (hov) return hov;
    const sel = this.getMesh && this.getMesh();
    if (!sel) return null;
    // A pin resolves to the joint it holds: reaching for a control and being told "not that" is
    // a worse answer than doing the obvious thing.
    if (sel._isPinTarget) return sel._pinnedJoint || null;
    return sel._isBone ? sel : null;
  }

  _resolvePinCommands() {
    const joint = this._resolvePinJoint();
    if (!joint) return [];
    const now = IKSolver.pinMode(joint);
    // Named for what the pin HOLDS, not for its DOF count -- "6DOF" is the implementation's
    // word for it and says nothing to someone deciding what they want the wrist to do.
    const modes = [
      [IKSolver.PIN_POS,  'Position'],
      [IKSolver.PIN_FULL, 'Position and Rotation'],
      [IKSolver.PIN_ROT,  'Rotation Only'],
      // "Aim" rather than "Steer" -- matt's word, and the better one: the pin points the limb
      // at something, it does not drive it there. Steering implies continuous control.
      [IKSolver.PIN_SOFT, 'Aim'],
      [IKSolver.PIN_NONE, 'Unpin'],
    ];
    const cmds = modes.map(([mode, label]) => ({
      label: label,
      icon: mode === IKSolver.PIN_NONE ? 'fa-link-slash' : 'fa-thumbtack',
      // THE MODE IT IS ALREADY IN IS DIMMED, which is both true and useful: choosing it does
      // nothing, and the dimming is the only thing in the ring that says which state you are
      // in. Without it the menu shows five equal options and no answer to "what is it now".
      enabled: mode !== now,
      run: () => { IKSolver.setPinMode(this, joint, mode); },
    }));
    // WEIGHT AS A SUBMENU, not four more wedges. The ring is already at five, and a marking
    // menu's accuracy falls off past about eight -- so the four weight commands go one level
    // down rather than pushing the root to nine. Only offered on a pin that exists: weighting
    // nothing is not a thing to offer.
    if (now) cmds.push({
      label: 'Weight', icon: 'fa-sliders', enabled: true,
      sub: () => this._resolvePinWeightCommands(joint), run: () => {},
    });
    // KEEP ABOVE GROUND — a TOGGLE at the root, not a mode wedge and not a submenu.
    //
    // Not a mode, because it composes with all four of them (see IKSolver.PIN_ABOVE_GROUND): as
    // a mode it would need spelling out four times over. Not a submenu either, despite the note
    // above about the ring's size — a submenu is right for Weight's four related commands and
    // wrong for a single boolean, where it would cost a second gesture to flip one bit. Gated on
    // `now` like Weight is, so an UNPINNED joint's ring stays at the five it has always been and
    // only the already-pinned case reaches seven, inside the eight the note allows for.
    //
    // The label carries the state rather than the dimming the modes use: dimming says "choosing
    // this does nothing", which is true of a mode you are already in and false of a toggle.
    if (now) cmds.push({
      label: IKSolver.keepsAboveGround(joint) ? 'Ground: On' : 'Ground: Off',
      icon: 'fa-arrows-down-to-line', enabled: true,
      run: () => { IKSolver.togglePinGround(this, joint); },
    });
    return cmds;
  }

  // ACTIVATE / DEACTIVATE, and the two blunt values. "Here" is the word doing the work in the
  // first two: both act AT THE PLAYHEAD, and activating also puts the pin where the joint
  // already is so the transition moves nothing -- see IKSolver.setPinActive.
  _resolvePinWeightCommands(joint) {
    const reg = window._animationRegistry;
    const pin = IKSolver.pinObject(joint);
    const w = pin && reg ? IKSolver.pinWeight(joint) : 1;
    return [
      // ALWAYS ENABLED. These were dimmed when the channel already read the value they write,
      // on the reasoning that keying 1 onto a pin already at 1 does nothing -- but at a playhead
      // with no key of its own it does the most important thing there is, which is to PUT A KEY
      // THERE. Dimmed, the command silently refused: matt, "if i try and key an activate frame,
      // sometimes it doesn't set a key".
      { label: 'Activate Here', icon: 'fa-play', enabled: true,
        run: () => { IKSolver.setPinActive(this, joint, true); } },
      { label: 'Deactivate Here', icon: 'fa-stop', enabled: true,
        run: () => { IKSolver.setPinActive(this, joint, false); } },
      // MATCH, on its own. Activate Here also matches, but re-running it rewrites the weight
      // keys -- and the reason to re-match is that the FK underneath was retimed, which is
      // exactly when those keys are the thing you want to keep.
      { label: 'Match Here', icon: 'fa-crosshairs', enabled: true,
        run: () => { IKSolver.matchPinHere(this, joint); } },
      { label: 'Half', icon: 'fa-sliders', enabled: true,
        run: () => { IKSolver.setPinWeightKey(this, joint, 0.5); } },
      // Removing the channel is not the same as keying 1: an unkeyed pin is fully on with no
      // curve at all, which is the state a rig starts in and the one to be able to get back to.
      { label: 'Clear Keys', icon: 'fa-eraser', enabled: !!(pin && reg
          && reg.scalarTrack && reg.scalarTrack(pin, IKSolver.PIN_WEIGHT, false)),
        run: () => { IKSolver.clearPinWeight(this, joint); } },
    ];
  }

  _resolveRadialCommands() {
    const tl = () => this.getGui && this.getGui() && this.getGui()._ctrlTimeline;
    const hasKeySel = !!(window._animSelectedKeys && window._animSelectedKeys.length);
    const canPaste  = !!(window._animKeyClipboard && window._animKeyClipboard.keys && window._animKeyClipboard.keys.length);
    const selMesh   = this.getMesh && this.getMesh();
    const linked    = !!(selMesh && this.isLinked && this.isLinked(selMesh));
    // #34: shape-layer multiselect commands (Combine when 2+ selected) — same source as the
    // desktop "…" menu, mapped to the radial's {label, icon, enabled, run} shape.
    const layerCmds = (tl()?._shapeLayerMenuCommands?.() || []).map(c => ({
      label: c.label, icon: 'fa-object-group', enabled: true, run: c.run,
    }));
    // NAME CHAIN — a submenu, because the presets are short but not one wedge. `run()` returns
    // a command list, which reopens the wheel on it (see VrRadialMenu._commit): two flicks of
    // one gesture rather than a trip to a panel, which is the whole point of doing this here
    // and not in the main menu. The flat-screen "…" menu gets it from the same array.
    //
    // Offered only on a JOINT, since that is what a chain starts from. A pin resolves to the
    // joint it holds — reaching for a control and being told "not that" is a worse answer than
    // just doing the obvious thing.
    // WHAT THE MENU ACTS ON: the preselected node first, then the selection.
    //
    // A bone lit yellow under the ray is the thing you are pointing at, and pressing B while
    // pointing at it means that one — matt: "if a bone is in a yellow preselect state and B is
    // pressed, treat it as a selection." Requiring a prior click made the command dead in the
    // one situation it is most obviously wanted.
    //
    // Preselect WINS over the selection when both exist, because it is the more recent and more
    // specific statement: the selection may be left over from something you did minutes ago,
    // the highlight is where your hand is now. `hoveredJoint` resolves a hovered pin to the
    // joint it holds, which is the chain root either way.
    //
    // It does not COMMIT the selection. Opening a menu is not a pick, and `getMesh()` is also
    // the animation target — reselecting as a side effect of pressing B would retarget the
    // timeline without anyone asking.
    const hoveredRoot = Skeleton.hoveredJoint(this);
    const nameRoot = hoveredRoot
      || (selMesh && selMesh._isPinTarget && selMesh._pinnedJoint)
      || (selMesh && selMesh._isBone ? selMesh : null);
    // FROZEN AT OPEN, both of them. The commands' run closures must not re-read live hover
    // state: picking a sector moves the hand, the preselection follows the hand, and the menu
    // would act on whatever the tip had drifted onto by the time you let go.
    //
    // Split takes the BONE — the segment you are pointing at, which is a different answer from
    // the joint at its nearer end. Dissolve takes the JOINT. Falling back to nameRoot keeps
    // Split usable from a selection when no bone is under the tip.
    //
    // A JOINT LIGHTS THE BONE BELOW IT. SPLIT CUTS THE BONE ABOVE ITS TARGET. Those are
    // opposite hands, and the mismatch is visible to anyone using it: select bone_01_L, it
    // turns cyan, right-click -> Split bone, and the bone that splits is bone_02 -> bone_01_L,
    // the one ABOVE the cyan one. matt, 2026-09-23, with screenshots: "this is not intuitive."
    //
    // Both conventions are deliberate and both stay -- see the note in Skeleton's bone tint,
    // which says so outright: a joint at the TOP of a chain owns no bone above it and would be
    // unable to paint itself, so the highlight looks down; an EDIT names a bone by the joint it
    // ends at, so a bone has exactly one owner. What was wrong is only that Split read a joint
    // with the edit hand when the thing the user had just LIT was chosen with the other.
    //
    // So a joint resolves to the bone that is lit: its sole child. The two cases with no single
    // lit bone keep the old answer, because it is the only unambiguous one left and refusing
    // would remove a verb outright:
    //   leaf   nothing is lit below; the bone above is the only bone it touches.
    //   fork   EVERY child bone is lit, so there is no "the" bone below -- and splitting an
    //          arbitrary one of three fingers is exactly the guess this avoids.
    // Pointing straight at a segment is unaffected and is still the precise way to say which.
    const litBelow = (j) => {
      if (!j) return null;
      const kids = Skeleton.childJoints(this, j).filter((k) => Skeleton.isJoint(k));
      return kids.length === 1 ? kids[0] : null;
    };
    const splitTarget = this._rigHoverBone || litBelow(nameRoot) || nameRoot;
    const dissolveTarget = nameRoot;
    // TOPOLOGY VERBS BELONG TO THE BONE TOOL. They need bone selection to know which bone you
    // mean, and bone selection is only on in that tool — see BONE_SELECT in Picking for why it
    // cannot be on in Grab. Offering them elsewhere would enable a command whose target the
    // pick cannot resolve. matt: "keep dissolve and split in the marking menu only for the
    // bones tool, not for grab."
    const inBoneTool = this._sculptManager?.getToolIndex?.() === Enums.Tools.BONE_DRAW;

    // WHAT DUPLICATE WOULD ACT ON, resolved once and frozen with everything else here — the
    // command must not re-read live hover state when the sector is committed, for the reason
    // written above Split: choosing a sector moves the hand and the preselection follows it.
    //
    // A JOINT WINS OVER THE SELECTION, the same rule the rest of this ring uses: in the headset
    // you are already pointing at the thing you mean. Meshes are the fallback, and there is no
    // key case yet — see _duplicateInPlace.
    const dupSubject = dissolveTarget
      ? { kind: 'chain', what: 'Chain', joint: dissolveTarget }
      : (this._selectMeshes && this._selectMeshes.length
          ? { kind: 'mesh', what: this._selectMeshes.length > 1 ? 'Meshes' : 'Mesh',
              meshes: this._selectMeshes.slice() }
          : null);

    const nameCmds = (which) => {
      const chain = Skeleton.chainFrom(this, nameRoot);
      const n = chain.length;
      // BOTH SETS ARE ALWAYS REACHABLE. Picking one by context keeps each wheel short, but a
      // rig drawn entirely with symmetry on has a mirror twin on every joint, so the centreline
      // names were never offered at all — matt: "its never showing me options for the central
      // axis types." Context now chooses which set you see FIRST; a wedge swaps to the other.
      const limb = which ? which === 'limb' : !!(nameRoot && nameRoot._boneMirror);
      const list = limb ? Skeleton.LIMB_NAMES : Skeleton.AXIS_NAMES;
      const cmds = list.map((nm) => ({
        label: nm, icon: 'fa-tag', enabled: true,
        run: () => { Skeleton.nameChain(this, nameRoot, nm); },
      }));
      // THE SET SWITCH, WHICH IS NOT A NAME. Labelled 'spine' / 'limbs' it sat among arm, leg
      // and hand looking exactly like one more suggestion -- and then carried the push-out
      // chevrons that no other name has, which is what matt spotted: "why is there a double
      // chevron next to 'spine'?" The chevrons were right; the label was lying about what the
      // wedge does. Named for the SET it switches to, in title case so it reads as a command
      // among a ring of lowercase names.
      cmds.push({
        label: limb ? 'Centre names' : 'Limb names', icon: 'fa-rotate', enabled: true,
        sub: () => nameCmds(limb ? 'axis' : 'limb'),
        run: () => {},
      });
      // The long tail. One wedge rather than a panel, and the keyboard already exists.
      cmds.push({
        // "Type..." read as a NOUN -- an object type, a kind of thing -- which is the wrong
        // sense entirely in a menu full of names. matt: "it's confusing." Every other wedge
        // here also enters a name, so naming the OUTCOME ("Enter name") would not tell them
        // apart; what makes this one different is that it opens the keyboard. So it says so,
        // and the label names the thing that appears. No ellipsis: the word is already the
        // promise.
        label: 'Keyboard', icon: 'fa-keyboard', enabled: true,
        run: () => {
          const kb = window._vrKeyboard;
          const cur = (nameRoot._permanentStaticLabel || '').replace(/_\d+(_[LR])?$/, '');
          if (kb && kb.shouldUse && kb.shouldUse()) {
            kb.open(cur, { label: 'Name chain (' + n + ' joints)', maxLength: 24 },
              (text) => { Skeleton.nameChain(this, nameRoot, text); });
          } else {
            const t = window.prompt('Name this chain of ' + n + ' joints', cur);
            if (t) Skeleton.nameChain(this, nameRoot, t);
          }
        },
      });
      return cmds;
    };

    return [
      ...layerCmds,
      // `sub` rather than `run`: the wheel needs to know a sector HAS children before running
      // anything, so it can open them when you push out past the rim.
      // NO ELLIPSIS on anything with a submenu: the chevrons at its rim already say there is
      // more behind it, and saying it twice in two languages is noise. The keyboard wedge does
      // not need dots either -- it is named for what it opens.
      { label: 'Name chain', icon: 'fa-tag', enabled: !!nameRoot,
        sub: () => nameCmds(), run: () => {} },
      // SPLIT AND DISSOLVE act on the joint under the controller first, the selection second —
      // the same rule Name chain uses, because in the headset you are already pointing at the
      // joint you mean and reaching for a list to say so again is the slow way round.
      // SPLIT ACTS ON THE BONE YOU ARE POINTING AT, which is a different answer from the joint
      // you are pointing at. A bone resolves to its nearer END for selection, so aiming at the
      // top of a bone selects the parent — and splitting the parent splits the bone ABOVE the
      // one under the cursor. `_rigHoverBone` is the segment itself. matt: "ensure whatever the
      // highlighted bone is, that is what gets split."
      // CAPTURED AT OPEN, like nameRoot — NOT read again when the sector is committed.
      //
      // Picking a sector means moving the hand, and the bone preselection follows the hand. So
      // by the time you released, `this._rigHoverBone` was whatever the tip had drifted onto —
      // usually nothing, which fell back to nameRoot and split the same joint every time. matt:
      // "if i preselect any other bone and split, it keeps trying to split the first bone."
      //
      // The whole point of a context menu is that it acts on what you opened it on.
      // WHICH BONE DID IT PICK, AND WHERE FROM. matt, 2026-09-23, with screenshots: the bone he
      // had selected was not the bone that split. The resolution above has three possible
      // sources -- the hovered SEGMENT, a hovered joint, or the selection -- and which one fired
      // is not recoverable from the result, so it says so. A bone is named by its CHILD end, so
      // the bone that will be cut is `parent -> target`.
      { label: 'Split bone', icon: 'fa-scissors',
        enabled: inBoneTool && RigTopology.canSplit(this, splitTarget),
        run: () => {
          const nm = (j) => (j && (j._permanentStaticLabel || j.getID?.())) || String(j);
          console.log('[rig] split ' + nm(splitTarget && splitTarget._parentMesh) + ' -> ' + nm(splitTarget)
            + ' (from ' + (this._rigHoverBone ? 'the bone under the cursor' : 'the bone lit below the joint') + ')');
          RigTopology.split(this, splitTarget);
        } },
      // Dissolve acts on the JOINT, which nameRoot already froze at open for the same reason.
      { label: 'Dissolve', icon: 'fa-compress',
        enabled: inBoneTool && RigTopology.canDissolve(this, dissolveTarget),
        run: () => { RigTopology.dissolve(this, dissolveTarget); } },
      // DUPLICATE A CHAIN — draw one finger, duplicate it three times. Acts on the joint under
      // the controller first and the selection second, the same rule as Name chain, and frozen
      // at open for the same reason the others are: picking a sector moves the hand, and the
      // preselection follows it.
      //
      // NOT gated on the Bone tool, unlike Split and Dissolve. Those need BONE selection to know
      // which segment you mean, which is only on in that tool. This one acts on a JOINT, and
      // `nameRoot` resolves one in any tool — so gating it would disable a command whose target
      // the pick can perfectly well find. Same reasoning that leaves Name chain ungated.
      // ONE DUPLICATE, WHICH ASKS WHAT YOU ARE POINTING AT. It used to be two wedges — 'Dup'
      // for the selected mesh object and 'Duplicate' for a bone chain — which said the same word
      // about two unrelated things and made you pick the right one yourself. matt: "shouldn't
      // duplicate be context aware? if a mesh is selected... if a joint is selected..."
      //
      // THE LABEL NAMES THE RESOLVED SUBJECT rather than saying 'Duplicate' and leaving you to
      // find out. A context-aware command that will not say what it is about to act on is a
      // guess with a button on it, and this ring is opened while pointing at a crowded rig.
      { label: dupSubject ? ('Duplicate ' + dupSubject.what) : 'Duplicate',
        icon: 'fa-clone', enabled: !!dupSubject,
        run: () => { this._duplicateInPlace(dupSubject); } },
      // ...AND THE SAME FOR THE CLIPBOARD THREE. They are the TIMELINE's clipboard — keys, not
      // objects — which the bare words did not say, so on a rig they read as a general Copy that
      // never did anything. Named for their subject, and only offered where that subject exists.
      { label: 'Copy Keys',  icon: 'fa-copy',        enabled: hasKeySel, run: () => tl()?.copySelectedKeys?.() },
      { label: 'Paste Keys', icon: 'fa-paste',       enabled: canPaste,  run: () => tl()?.pasteKeys?.(false) },    // at the playhead
      { label: 'Paste Linked', icon: 'fa-link',      enabled: canPaste,  run: () => tl()?.pasteKeys?.(true) },     // linked instance
      { label: 'Make Uniq',  icon: 'fa-link-slash',  enabled: linked,    run: () => this.makeUniqueSelection?.() },// break an instance link
      // DELETE SAYS WHAT IT WILL DELETE. One wedge, but it stood for one thing — selected
      // animation keys — so right-clicking a bone offered a Delete that was about the timeline
      // and, with no keys selected, was simply dead. matt: "if the r.click was on a bone and
      // we're in the bone tool, make it say 'delete bone', if its in the animation editor or in
      // grab mode, it says 'delete keyframe'."
      //
      // THE BONE READING WINS WHEN THERE IS A BONE UNDER THE POINTER AND THE BONE TOOL IS ACTIVE
      // — both, not either. Pointing at a joint while holding Grab means you are about to pose
      // it, not remove it, and a Delete that quietly meant "the limb" there would be the worst
      // kind of surprise. Outside the bone tool it stays the timeline's Delete.
      (inBoneTool && dissolveTarget)
        ? { label: 'Delete Bone', icon: 'fa-trash', enabled: true,
            run: () => { this.deleteJointSubtree(dissolveTarget); } }
        : { label: hasKeySel ? 'Delete Keyframes' : 'Delete', icon: 'fa-trash',
            enabled: hasKeySel, run: () => tl()?.deleteSelectedKeys?.() },
      // Reachable without leaving VR, which is the point: hand tracking grabbing a
      // stroke mid-reach is exactly when you need to switch sculpting off fast.
      { label: window._sculptLocked ? 'Unlock' : 'Sculpt Lock',
        icon: window._sculptLocked ? 'fa-lock' : 'fa-lock-open', enabled: true,
        run: () => { window._sculptLocked = !window._sculptLocked; } },
    ];
  }

  // DUPLICATE, THEN PLACE IT — one gesture, whatever the subject is. In the headset the copy
  // arrives following your controller and the trigger says where it goes, which is one motion
  // instead of duplicate, hunt for the copy, grab it, move it. On a flat screen there is no hand
  // to follow, so the command completes on its own and leaves the copy selected.
  //
  // NO KEY CASE YET, deliberately. matt asked for one — "if its a key or keys selected,
  // duplicate and drag the keys" — and it is the same word for a different gesture: keys live in
  // time and a track, not in space, so "drag with the controller" has to decide WHICH hand axis
  // means time and how far a metre of reach is in frames. That is a design decision rather than
  // a missing branch, and guessing it would ship a gesture nobody chose. Copy / Paste still
  // cover keys in the meantime.
  _duplicateInPlace(subject) {
    if (!subject) return null;
    const placing = !!this._xrSession;

    if (subject.kind === 'chain') {
      // Deferred so the whole gesture is ONE undo entry: undo after "duplicate, place it" must
      // remove the copy, not strand you on the intermediate state — a chain sitting at the
      // arbitrary offset nobody chose is a rig nobody built.
      if (!placing) return RigTopology.duplicate(this, subject.joint);
      const pend = RigTopology.duplicate(this, subject.joint, { defer: true });
      if (!pend) return null;
      // The mirrored subtree rides along as the copy's TWIN, so one gesture places both sides.
      RigPlacing.begin(this, [{ mesh: pend.root, twin: pend.twin }], {
        commit: (main) => RigTopology.commitDeferred(main, pend, 'Duplicate Chain'),
        cancel: (main) => RigTopology.cancelDeferred(main, pend),
      });
      return pend.root;
    }

    if (subject.kind !== 'mesh') return null;
    if (!placing) { this.duplicateSelection(); return this.getMesh(); }

    // The silent twin of duplicateSelection: the copies are made without an undo entry each, so
    // the single entry pushed on confirm covers both the copies and where they ended up.
    const copies = [];
    for (const mesh of subject.meshes) {
      const copy = new MeshStatic(mesh.getGL());
      copy.copyData(mesh);
      // addMeshSilent skips what addNewMesh does for a NEW mesh — shader and wireframe defaults
      // — which is right for a restore and wrong for a copy the user is about to look at.
      copy.setShaderType?.(getOptionsURL().shader);
      copy.setFlatShading?.(getOptionsURL().flatshading);
      this.addMeshSilent(copy);
      copy.setShowWireframe?.(getOptionsURL().wireframe);
      copies.push(copy);
    }
    if (!copies.length) return null;
    this.setMesh(copies[copies.length - 1]);

    RigPlacing.begin(this, copies.map((c) => ({ mesh: c, twin: null })), {
      commit: (main) => {
        // Captured at COMMIT, not at creation: the whole point of deferring is that the copies
        // have moved since, and redo has to put them back where they were left.
        const at = copies.map((c) => mat4.clone(c.getMatrix()));
        main.getStateManager?.()?.pushStateCustom?.(
          () => { for (const c of copies) main.removeMeshSilent(c); main.render?.(); },
          () => {
            for (let i = 0; i < copies.length; i++) {
              main.addMeshSilent(copies[i]);
              mat4.copy(copies[i].getMatrix(), at[i]);
            }
            main.render?.();
          }, false, copies.length > 1 ? 'Duplicate Meshes' : 'Duplicate Mesh');
      },
      cancel: (main) => { for (const c of copies) main.removeMeshSilent(c); main.render?.(); },
    });
    return copies[copies.length - 1];
  }

  // EVERY PANEL THAT SHOWS THE ACTIVE TOOL, TOLD IN ONE PLACE.
  //
  // The tool can be changed from about ten places — both menus, the tool picker, the quick-swap,
  // the radial, keyboard shortcuts, and the tool-context switching that fires on selection — and
  // each of them was responsible for refreshing whichever panels it happened to remember. Every
  // one of them remembered a different subset, so whichever panel the user was NOT acting in
  // kept showing the previous tool. matt: "i choose inflate in the mainpanel tools, swap to
  // minipanel, its correct, but then i swap to grab in the mainpanel, the minipanel looks like
  // its on inflate still... its all a little unstable."
  //
  // It reads as unstable rather than as plainly broken because the panels are not uniformly
  // stale: a panel re-syncs when it is shown, so the wrongness depends on which panel was
  // visible when, and anything drawn from live state each frame — the hover highlight — is right
  // while the selected state beside it is wrong.
  //
  // CALLED FROM setToolIndex, and only on a REAL change: that method is also called with the
  // current tool from routine places, and syncing there would rebuild panel HTML and its texture
  // on every selection change.
  //
  // VISIBLE PANELS ONLY. A hidden one re-syncs when it is shown (see _swapHtmlPanels), so
  // syncing it here would be work whose result is thrown away — and torn-off panels are exactly
  // the case that needs this, since they stay visible while you work in another panel.
  /**
   * THERE IS NO WARM PASS ANY MORE, AND THAT IS THE FIX.
   *
   * Five rounds of this: a blocking warm at session start, a queued one, a stereo-camera one on
   * a branch, then revealing three hidden objects per frame inside the ordinary draw, then one.
   * Each was measured and each was an improvement on the last. Measuring against NOT DOING IT
   * AT ALL is what settled it, on matt's GalaxyXR:
   *
   *   warm on    99 distinct, 183 total, 6952ms, median 31.1ms
   *   ?warm=0    64 distinct, 116 total, 2518ms, median 12.2ms
   *
   * The warm was costing four and a half seconds and sixty-seven extra compiles. In Pipelines:
   *
   *     pipeline.usedTimes --;
   *     if ( pipeline.usedTimes === 0 ) this._releasePipeline( pipeline );
   *
   * and RenderObject.dispose() runs when a render object is dropped. So revealing an object,
   * drawing it and hiding it again built a pipeline and then deleted it, programs and all -- and
   * the real draw later paid full price. Every warm here was a compile thrown away.
   *
   * The lesson worth keeping is not about warming. It is that five consecutive measurements can
   * all show improvement while the whole mechanism is a net loss, because none of them was
   * against the baseline of doing nothing.
   */
  _startRevealWarm() { return 0; }

  _stepRevealWarm() { /* see _startRevealWarm */ }

  /**
   * EVERY DRAWABLE OBJECT, hidden ones included -- the denominator matt asked for.
   *
   * "surely there's a way to tell in advance how many shaders need to be compiled." Not shaders:
   * how many a given object needs is three's business and some share while others build two. But
   * the OBJECTS are all knowable up front, and they are the units the work is actually done in.
   */
  // TIME TO STEADY STATE: first frame until the app stops building pipelines.
  //
  // ONE Map.size READ A FRAME, not four per render object, so this is independent of
  // window._pipeTrace and survives the trace being silenced -- the entry metric's blind spot is
  // not worth a second instrument that can itself be switched off. Counting only; nothing is
  // revealed, drawn or hidden, because an instrument that changes the frame it measures is how
  // five warm passes each measured better than the last while the whole direction was wrong.
  //
  // SETTLED MEANS "NOTHING NEW FOR A WHOLE SECOND". Compiles arrive in bursts a frame or two
  // apart, so a shorter quiet period would call steady state in the middle of one.
  _armSteadyState() {
    const now = performance.now();
    // installPipelineTrace owns the counter; without it there is nothing to measure.
    if (typeof window._pipeBuilt !== 'number') return;
    this._ss = { t0: now, lastGrowth: now, lastTick: now, base: window._pipeBuilt,
                 msBase: window._pipeBuiltMs || 0, added: 0, worst: 0, hitches: 0 };
  }

  _tickSteadyState() {
    const ss = this._ss;
    if (!ss) return;
    const now = performance.now();
    const frameMs = now - ss.lastTick;
    ss.lastTick = now;
    if (frameMs > ss.worst) ss.worst = frameMs;
    if (frameMs >= SS_HITCH_MS) ss.hitches++;
    const n = window._pipeBuilt;
    if (n > ss.base) { ss.added += n - ss.base; ss.base = n; ss.lastGrowth = now; }
    // A CEILING, so a session that never settles still reports something. Borrowed from
    // BootOverlay, which learned the same lesson: a metric that only fires on success is silent
    // in exactly the case worth hearing about.
    const expired = now - ss.t0 >= SS_CEILING_MS;
    if (now - ss.lastGrowth < SS_QUIET_MS && !expired) return;
    this._ss = null;
    const spent = Math.round((window._pipeBuiltMs || 0) - ss.msBase);
    console.log('[XR Timing] steady state at +' + Math.round(ss.lastGrowth - ss.t0)
      + 'ms from first frame — ' + ss.added + ' pipelines built in ' + spent
      + 'ms, worst frame ' + Math.round(ss.worst) + 'ms, ' + ss.hitches
      + ' frames over ' + SS_HITCH_MS + 'ms'
      + (expired ? ' — CEILING HIT, still building' : ''));
  }

  _warmableObjects() {
    const out = [];
    const seen = new Set();
    const add = (o) => { if (o && !seen.has(o)) { seen.add(o); out.push(o); } };
    try { for (const b of Skeleton.prewarmBatches(this)) add(b); } catch (e) { /* no rig yet */ }
    try { for (const p of HTMLVRPanel._live) if (p.mesh) add(p.mesh); } catch (e) { /* courtesy */ }
    if (this._scene) {
      this._scene.traverse((o) => {
        if (!o.material) return;
        const m = Array.isArray(o.material) ? o.material[0] : o.material;
        // Nothing this renderer cannot draw: a raw ShaderMaterial throws out of build(), and
        // warming is the one place that throw would be self-inflicted.
        if (!m || (m.isShaderMaterial && !m.isNodeMaterial)) return;
        add(o);
      });
    }
    return out;
  }

  _startRevealWarm() {
    if (getOptionsURL().warm === false) return 0;
    const list = [];
    try { list.push(...Skeleton.prewarmBatches(this)); } catch (e) { /* no rig, no batches */ }
    try {
      for (const p of HTMLVRPanel._live) if (p.mesh && !p.mesh.visible) list.push(p.mesh);
    } catch (e) { /* the registry is a convenience */ }
    this._revealWarm = list.filter(Boolean);
    this._revealAt = performance.now();
    this._revealFrames = 0;
    console.log('[warm] revealing ' + this._revealWarm.length
      + ' normally-hidden objects, ONE a frame, inside the ordinary render');
    return this._revealWarm.length;
  }

  // PER FRAME. Restores on the NEXT call rather than after the draw, because the compile happens
  // during the draw -- putting them back first would mean nothing was ever submitted.
  _stepRevealWarm() {
    if (this._revealRestore) {
      for (const r of this._revealRestore) {
        r.m.visible = r.visible;
        if (r.m.isInstancedMesh) r.m.count = r.count;
      }
      this._revealRestore = null;
    }
    const list = this._revealWarm;
    if (!list || !list.length) return;
    // ONE PER FRAME, NOT THREE.
    //
    // Three was chosen when a compile was assumed to be cheap. Measured on matt's GalaxyXR, one
    // is 40-120ms and the sculpt's own is 331ms -- so three of them made a 150-350ms frame, and
    // a compositor fed frames that slowly shows the lobby whatever is being submitted. The total
    // work is the same either way; what changes is whether it arrives as one hitch or three
    // stacked into a frame the runtime gives up on. matt: "just got the gray void again".
    const batch = list.splice(0, 1);
    const restore = [];
    for (const m of batch) {
      restore.push({ m, visible: m.visible, count: m.count });
      m.visible = true;
      if (m.isInstancedMesh && !m.count) m.count = 1;
    }
    this._revealRestore = restore;
    if (!list.length) {
      this._revealWarm = null;
      const ms = this._revealAt ? Math.round(performance.now() - this._revealAt) : 0;
      console.log('[warm] reveal pass done in ' + ms + 'ms across ' + (this._revealFrames || 0)
        + ' frames');
    }
    this._revealFrames = (this._revealFrames || 0) + 1;
  }

  /** Kept as a name the console and old notes reach for; see _startRevealWarm for why the
   *  warm is gone. `?warm=0` used to turn it off and now turns off only the boot cover. */
  warmEverything() { return 0; }

  syncToolPanels() {
    const shown = (p) => !!p && (!p.mesh || p.mesh.visible);
    const sync = (p) => { if (shown(p)) { try { p.syncFromState?.(); } catch (_) {} } };
    sync(this._miniPanel);
    sync(this._mainMenuPanel);
    sync(this._toolPickerPanel);
    this._tornOffPanels?.forEach(sync);
  }

  // WHAT THE FLAT-SCREEN MENU SHOWS: the B ring, plus the A ring's pin modes as a submenu when
  // the thing under the pointer has a pin to talk about.
  //
  // ONE MENU, NOT TWO. VR has two rings because it has two buttons; a pointer has one gesture, so
  // the second ring becomes a submenu — which is the shape the B ring already uses for Name chain
  // and for pin Weight, so it is a familiar depth rather than a new idea.
  _resolveViewportMenuCommands() {
    const cmds = this._resolveRadialCommands() || [];
    const pin = this._resolvePinCommands() || [];
    if (!pin.length) return cmds;
    return [{ label: 'Pin', icon: 'fa-thumbtack', enabled: true, sub: () => pin, run: () => {} }]
      .concat(cmds);
  }

  // Open it at the pointer. Returns false when there is nothing to show, so the caller can let
  // the gesture mean whatever it meant before.
  openViewportMenu(clientX, clientY) {
    if (!this._viewportMenu) return false;
    // FROZEN THE SAME WAY THE RING FREEZES. _resolveRadialCommands latches the preselected joint
    // into the closures it returns, so what the menu acts on is what was under the pointer when
    // it opened — not whatever the pointer has drifted onto by the time a row is clicked.
    const cmds = this._resolveViewportMenuCommands();
    return this._viewportMenu.open(cmds, clientX, clientY);
  }

  _quickSwapTool() {
    const sm = this._sculptManager;
    if (!sm) return;
    this._trackToolHistory();
    const h = this._toolHistory;
    const cur = sm.getToolIndex();
    // From the registry rather than by searching SCULPT_TOOLS: that search misses every
    // MESH_TOOLS entry, so swapping to Extrude or Weld toasted a bare "Tool". Same root cause
    // as the wrist panel's "Tool 35" -- a name looked up somewhere other than where names live.
    const labelOf = (id) => toolLabel(id);
    if (h.length < 2) { this._showToolToast(labelOf(cur)); return; } // nothing to swap to yet
    const target = (cur === h[0]) ? h[1] : h[0];
    sm.setToolIndex(target);
    try { this.getGui?.()._ctrlSculpting?._ctrlSculpt?.setValue(target); } catch (_) {}
    try { this._toolPickerPanel?.syncFromState?.(); } catch (_) {}
    this._showToolToast(labelOf(target));
  }

  _showToolToast(label) {
    // VR ONLY, and the reason is structural rather than stylistic. This toast is a world-space
    // plane that _updateVrFloaters parks above the right controller and hides again when its
    // window closes -- and that updater returns immediately when there is no XR camera. So on
    // desktop the line below turns the plane ON and NOTHING EVER TURNS IT OFF or puts it
    // anywhere: it sits at the world origin, 11cm wide, for the rest of the session.
    //
    // Invisible in practice only because the models are usually big enough to hide it, which is
    // exactly how it went unnoticed. matt, on a small imported character: "thats something i've
    // occasionally noticed where parts of the vr menus are still visible on desktop, usually too
    // small to see, but this character mesh is small enough that i can see the menu."
    //
    // Desktop already has somewhere to say things -- screenLog and the console -- so this is a
    // no-op there rather than a second notification surface.
    if (!this._renderer?.xr?.isPresenting) return;
    if (!this._toolToast) this._toolToast = this._makeVrTextPlane(384, 128, 0.11);
    const { ctx, canvas, tex } = this._toolToast;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(30,30,46,0.85)'; // Catppuccin base
    const rr = (x, y, w, h, r) => { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); };
    rr(6, 6, canvas.width - 12, canvas.height - 12, 18); ctx.fill();
    ctx.strokeStyle = '#89b4fa'; ctx.lineWidth = 3; ctx.stroke(); // blue accent
    ctx.fillStyle = '#cdd6f4'; ctx.font = '600 54px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, canvas.width / 2, canvas.height / 2 + 2);
    tex.needsUpdate = true;
    this._toolToast.mesh.visible = true;
    this._toolToastUntil = performance.now() + 1500;
  }

  // #23 Floating controller button labels — built once, content reflects the current
  // VR button map. Shown only while window._vrShowButtonLabels is true.
  _ensureButtonLabels() {
    // REBUILD WHEN THE INPUT KIND CHANGES. Put the controllers down mid-session and the cards
    // would otherwise keep describing a trigger and a thumbstick you are no longer holding.
    const _sig = (this._handInput?.left ? 'H' : 'C') + (this._handInput?.right ? 'H' : 'C')
      + (this._dominantHand === 'left' ? 'L' : 'R');
    if (this._btnLabels && this._btnLabelSig !== _sig) {
      this._btnLabels.left?.mesh?.removeFromParent?.();
      this._btnLabels.right?.mesh?.removeFromParent?.();
      this._btnLabels = null;
    }
    if (this._btnLabels) return;
    this._btnLabelSig = _sig;
    const make = (title, lines) => {
      const o = this._makeVrTextPlane(384, 384, 0.1);
      const { ctx, canvas, tex } = o;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'rgba(30,30,46,0.82)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // Title (which hand + role) — makes the two panels unmistakably per-controller.
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#f9e2af'; ctx.font = '700 30px sans-serif';
      ctx.fillText(title, canvas.width / 2, 26);
      ctx.strokeStyle = '#45475a'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(16, 48); ctx.lineTo(canvas.width - 16, 48); ctx.stroke();
      ctx.textAlign = 'left';
      let y = 78;
      for (const [key, desc] of lines) {
        // Flow desc right after key (key widths vary a lot: "Grip" vs "Stick Left/Right").
        ctx.font = '700 24px sans-serif'; ctx.fillStyle = '#89b4fa';
        ctx.fillText(key, 16, y);
        const kw = ctx.measureText(key).width;
        ctx.font = '400 22px sans-serif'; ctx.fillStyle = '#cdd6f4';
        ctx.fillText(desc, 16 + kw + 12, y);
        y += 38;
      }
      tex.needsUpdate = true;
      return o;
    };
    // Bindings traced from the live input handler (Scene.js ~5410–5785), NOT a cheat-sheet.
    // PRIMARY = dominant hand (sculpts); SECONDARY = non-dominant (owns meta: smooth, undo,
    // menu, tool-swap). Lower face button is physical: X (left) / A (right). The Y/B "hide UI"
    // toggle is debug-only, so it's left out of the guide.
    const dom = (face) => [
      ['Trigger', 'Sculpt'], ['Grip', 'Move world'],
      ['Stick Up/Down', 'Radius'], ['Stick Left/Right', 'Intensity'],
      [face, 'Subtract'],
    ];
    const non = (face) => [
      ['Trigger', 'Smooth'], ['Grip', 'Move world'],
      ['Stick Up/Down', 'Scroll menu'], ['Stick Left/Right', 'Undo / Redo'],
      ['Stick click', 'Tool swap'], [face, 'Menu'],
    ];
    // HANDS HAVE NONE OF THE ABOVE. On a hands-only session every line in those two lists names
    // a control that does not exist, which is worse than no card at all — it is the first thing
    // shown on entering immersive, and it was describing a controller nobody is holding.
    // matt gave the mapping verbatim; it is transcribed rather than re-derived.
    //
    // Still PRIMARY/SECONDARY rather than left/right, so left-handed mode reads correctly — the
    // hand that sculpts is the dominant one, not necessarily the right.
    const BOTH_FISTS = ['Both fists', 'Scale + rotate world'];
    const FIST = ['Fist', 'Move world, or nearest panel'];
    const domHand = [
      ['Pinch', 'Sculpt, press buttons'],
      FIST, BOTH_FISTS,
    ];
    const nonHand = [
      ['Pinch', 'Alt mode'],
      // BOTH hands pinching, which is what the code actually requires — see the offhand-Smooth
      // block further down, and matt's own report that fixed it: "it should be if both left AND
      // right pinch (ie trigger) are pressed that smooth should work." A modifier qualifies an
      // action rather than being one, so the dominant pinch has to be down as well.
      ['Both pinch', 'Smooth'],
      FIST, BOTH_FISTS,
    ];
    const domLeft = this._dominantHand === 'left';
    const handed = (h) => !!(this._handInput && this._handInput[h]);
    const forHand = (h, isDom, face) =>
      handed(h) ? (isDom ? domHand : nonHand) : (isDom ? dom(face) : non(face));
    this._btnLabels = {
      left:  make(domLeft ? 'PRIMARY' : 'SECONDARY', forHand('left', domLeft, 'X')),
      right: make(domLeft ? 'SECONDARY' : 'PRIMARY', forHand('right', !domLeft, 'A')),
    };
  }

  // WHAT THE HAND WAS AIMING AT JUST BEFORE IT CLOSED.
  //
  // Making a fist MOVES THE RAY. The grip pose and its direction come from the hand, and closing
  // it swings both — so the ray slides off the panel at the exact moment you commit to grabbing
  // it. That is why aiming more carefully does not help, and why a preselection highlight would
  // not have either: it would be correct right up until the instant it stopped being correct.
  //
  // This is the same shape as the v3.37.0 finding that a VR click had to move from the press to
  // the release because the drag had already moved the hand. Here the answer is a short memory
  // instead: the panel the ray was on a moment ago is the panel you meant.
  //
  // matt: "i kept missing the grab and it would turn the world instead ... an active laser
  // pointer hit on that panel IS a preselection event."
  _panelGrabIntent(handedness) {
    const l = this._panelRayLatch && this._panelRayLatch[handedness];
    if (!l || !l.name) return null;
    const grace = Number.isFinite(window._panelGrabGraceMs) ? window._panelGrabGraceMs : 350;
    return (performance.now() - l.t) <= grace ? l : null;
  }

  // WHERE A PANEL WAS WHEN YOU PUT IT AWAY, kept for the session only.
  //
  // Toggling a panel off and on from the icon bar re-ran its first-open placement, so any panel
  // you had positioned snapped back beside the main menu.
  //
  // ANCHORED TO HEAD POSITION, WITH HEAD ROTATION IGNORED ENTIRELY. The first attempt stored the
  // offset in a heading-aligned frame, which meant the panel SWUNG WITH YOUR HEADING — and the
  // way you re-show a panel is by looking down at the wrist menu, which turns your head. So it
  // came back facing wherever you had just turned to, every time. matt: "i looked down at my
  // wrist menu and turned it on again, the graph editor appears directly in my view a little down
  // and to the right. i would have expected it to restore to where i had it in world space."
  //
  // So the offset is kept in WORLD AXES and the orientation is kept as it was; only head POSITION
  // is used as the anchor. matt's own reading of it: "store and recall relative to the headset
  // position, but as if the headset rotation is zeroed out." Stand still and it is a world-space
  // restore, which is what you expect. Walk, and it comes with you rather than being stranded
  // behind — which is the concession to tracking drift, and the reason to anchor at all: "i dont
  // mind if they forget between sessions (honestly the state of world tracking in all headset is
  // terrible, i dont trust it)."
  _headPos() {
    const cam = this._camera && this._camera.getThreeCamera && this._camera.getThreeCamera();
    return cam ? cam.position.clone() : null;
  }

  _stashPanelPose(key, mesh) {
    const hp = this._headPos();
    if (!hp || !mesh) return false;
    this._panelPoseStash = this._panelPoseStash || {};
    this._panelPoseStash[key] = {
      pos: mesh.position.clone().sub(hp),   // world axes — deliberately NOT rotated into any frame
      quat: mesh.quaternion.clone(),        // the orientation you left it at, unmodified
    };
    return true;
  }

  _restorePanelPose(key, mesh) {
    const st = this._panelPoseStash && this._panelPoseStash[key];
    const hp = this._headPos();
    if (!st || !hp || !mesh) return false;
    mesh.position.copy(hp).add(st.pos);
    mesh.quaternion.copy(st.quat);
    return true;
  }

  _hasPanelDragActive(handedness) {
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
      vec3.set(this._navGlide.vel, 0, 0, 0); // fresh grab — drop any stale momentum
      quat.identity(this._navGlide.rotVel);
      vec3.copy(this._navGlide.pivot, origin);
    } else {
      // Delta in Base Space approx World Space delta if orientation aligned
      const delta = vec3.create();
      vec3.sub(delta, origin, gState.startPoint);

      // GRAB GAIN — how far the world moves per unit of hand movement.
      //
      // 1:1 is the honest default and it is not always the comfortable one. With a controller
      // your hand is braced and a grab is a deliberate haul; a fist gesture in mid-air is looser
      // and the same motion throws the scene. matt on the AVP: "if i use the fist gesture to
      // grip the world with a single hand, its too fast and aggressive."
      //
      // Applied to the DELTA rather than to the accumulated position, so the grab stays a pure
      // scaling of your movement with no drift: startPoint still advances to the real hand each
      // frame, so gain < 1 simply means the world lags your hand by a constant ratio rather than
      // accumulating an offset that has to be paid back on release.
      //
      // The rotation is left alone: a rotation gain makes your hand and the world disagree about
      // WHICH WAY IS UP, which is a different and much worse sensation than moving slowly.
      const gGain = this.getGrabGain();
      // Threshold for jitter (Translation)
      if (vec3.length(delta) > 0.0001) {
        this.moveWorld([delta[0] * gGain, delta[1] * gGain, delta[2] * gGain]);
        vec3.copy(gState.startPoint, origin);
        // #19: smooth the per-frame motion into the glide velocity (EMA).
        vec3.lerp(this._navGlide.vel, this._navGlide.vel, delta, 0.4);
      } else {
        // Stationary frame — bleed velocity gently so a real pause-then-release won't
        // fling, while the recent-velocity history still recovers a genuine throw even if
        // the runtime reports the last frame(s) as stationary.
        vec3.scale(this._navGlide.vel, this._navGlide.vel, 0.85);
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
          quat.slerp(this._navGlide.rotVel, this._navGlide.rotVel, qDelta, 0.4); // #19 angular EMA
        } else {
          quat.slerp(this._navGlide.rotVel, this._navGlide.rotVel, QUAT_IDENTITY, 0.4); // bleed when still
        }
      }
      vec3.copy(this._navGlide.pivot, origin); // glide pivot = latest hand position
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
    // Which hands reach the tool at all, and how often. If this fires for BOTH hands, every
    // tool's face-button edge detector is being written twice per frame — the dominant hand's
    // rising edge would be cleared by the other hand's "not pressed" before it could be acted
    // on a second time, which is the classic way a face button goes half-dead.
    if (window._boneATrace) {
      this._pvsCount = this._pvsCount || {};
      const h = source.handedness || '?';
      this._pvsCount[h] = (this._pvsCount[h] || 0) + 1;
      if ((this._pvsCount[h] % 90) === 1) {
        console.log(`[boneA] processVRSculpting hand=${h} n=${this._pvsCount[h]}` +
          ` (all: ${JSON.stringify(this._pvsCount)})` +
          ` tool=${this._sculptManager && this._sculptManager._toolIndex}`);
      }
    }
    const space = source.targetRaySpace || source.gripSpace;
    const pose = frame.getPose(space, refSpace);
    if (!pose) return;

    let p = pose.transform.position;
    let q = pose.transform.orientation;

    // SCULPTING MUST AIM WHERE THE MENUS AIM. This path reads the raw targetRaySpace pose,
    // which is the UNCORRECTED one — so without this the brush would keep the 30-degree-high
    // visionOS hand ray while the panels used the corrected one, and the drawn spike would
    // match neither. Read the same controller object _applyHandRayCorrection writes, so there
    // is exactly one aim in the session.
    if (source.hand) {
      const _m = this._rayMatrixFor(source, frame, refSpace);
      if (_m) {
        if (!this._hrPv) { this._hrPv = new THREE.Vector3(); this._hrPq = new THREE.Quaternion(); this._hrPs = new THREE.Vector3(); this._hrPm = new THREE.Matrix4(); }
        this._hrPm.fromArray(_m).decompose(this._hrPv, this._hrPq, this._hrPs);
        p = { x: this._hrPv.x, y: this._hrPv.y, z: this._hrPv.z };
        q = { x: this._hrPq.x, y: this._hrPq.y, z: this._hrPq.z, w: this._hrPq.w };
      }
    }

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

    const _actPad = this._padOf(source);
    if (_actPad) {
      for (let i = 0; i < _actPad.buttons.length; i++) {
        if (_actPad.buttons[i].pressed) VRActivityDetected = true;
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
    // Fallback default; the old GuiXR._radius slider is gone and the tool below overrides this
    // in every real case anyway.
    let sliderVal = 0.15;
    if (this._sculptManager) {
      // THE RADIUS THE STROKE USES MUST BE THE TOOL THE STROKE RUNS. This asked
      // getCurrentTool(), and the smooth override's tool swap happens ~450 lines BELOW here --
      // so a smooth ran with the clay brush's radius while the cursor and both sliders showed
      // Smooth's. matt: "the sphere radius indicator is matching my settings, the sliders match,
      // but if i actually try a smooth, its clearly using the original brush radius and
      // intensity." The radius is the picking radius too, so this is the whole feel of the
      // stroke, not just its footprint.
      const tool = this.effectiveTool();
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
    const trigger = this._padOf(source)?.buttons?.[0] || { pressed: false, value: 0 };

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
      // Face buttons still get through. `isPressed: false` is what stops a stroke starting
      // through the menu, and that is the whole job of this branch — but handing the tool an
      // EMPTY controller list also silently disabled every face-button binding it has, since
      // those are read out of `controllers`. A face button is not aimed at anything, so where
      // the ray happens to be pointing has no business swallowing it. Symptom this fixed: A
      // stopped ending a bone chain, but only sometimes — the menu-pointing state is sticky
      // (`_wasPointingAtMenu`) and this branch is skipped while a tool is mid-action, so the
      // trigger kept working and only the face button went dead.
      if (window._boneATrace) {
        this._menuGuardLog = (this._menuGuardLog || 0) + 1;
        if (this._menuGuardLog % 30 === 1) {
          console.log(`[boneA] MENU-GUARD path hand=${source.handedness}` +
            ` pointing=${this._isPointingAtMenu ? 1 : 0} wasPointing=${this._wasPointingAtMenu ? 1 : 0}` +
            ` latch=${this._vrMenuTriggerLatch ? 1 : 0} sculpting=${isSculpting ? 1 : 0}` +
            ` toolActive=${isToolActive ? 1 : 0} (n=${this._menuGuardLog})`);
        }
      }
      const btnControllers = [];
      const btnSession = this._xrSession;
      if (btnSession && btnSession.inputSources) {
        for (const src of btnSession.inputSources) {
          // `src.gamepad` IS TRUTHY ON HANDS, AND ITS BUTTONS ARRAY IS EMPTY.
          //
          // An AVP hand source reports gamepad=true with buttons.length===0, so the old
          // `if (src.gamepad)` test passed and then pushed a zero-length array: every button
          // the sculpt manager asked about came back undefined, silently, on a device where
          // pinch had already been detected perfectly well. The synthesised pad has to win
          // wherever one exists — a hand's real pad carries nothing worth reading.
          const mock = this._mockGamepads && this._mockGamepads[src.handedness];
          const pad = mock || src.gamepad;
          if (pad) btnControllers.push({ handedness: src.handedness, buttons: pad.buttons });
        }
      }
      this._lastXRControllers = btnControllers; // button-only: no matrix, by design
      this._sculptManager.updateXR(this._picking, false, enginePos, dir, {
        isNegative: false,
        controllers: btnControllers,
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


    // THE PER-FRAME MESH PICK, split out because xr-pose was seen spiking to 5ms and this is
    // the only thing in that stretch that scales with the sculpt. It runs whether or not the
    // trigger is down — the brush cursor needs a surface point to sit on — so on a dense mesh
    // it is paid every frame for a cursor.
    this._mark('xr-pick');
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
      } else if (toolIndex === Enums.Tools.TRANSFORM_VR || toolIndex === Enums.Tools.VOXEL ||
                 toolIndex === Enums.Tools.GEODESIC_POSE || toolIndex === Enums.Tools.BONE_DRAW) {
        useVolume = false; // pose tool aims A/B with the laser, like Transform.
        // Bone draw places joints at the controller TIP (options.tipOrigin) and never reads
        // the pick, so it just wants the cheap ray path, not a volume sphere query.
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

    this._mark('xr-pose');
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
    // Through _padOf, because a visionOS hand reports a gamepad whose buttons array is EMPTY.
    // Reading it directly left analogValue at 0, so isTriggerPressed was false, so canSculpt was
    // false, and no stroke ever opened — with the pinch detected perfectly at every earlier
    // stage. Measured: latch/mock/pad all fired 10 times, sculpting 0% of frames.

    const buttons = this._padOf(source)?.buttons || [];
    // PHASE 11 Fix: If we are already sculpting/dragging with this hand, it IS the trigger state that matters
    // regardless of global dominance.
    const isDominant = (source.handedness === this._dominantHand);
    
    // Evaluate custom trigger sensitivity threshold
    const triggerThreshold = this._triggerThreshold();
    
    // Safe extract analog value
    let analogValue = 0.0;
    if (buttons && buttons[0]) {
      analogValue = buttons[0].value;
    }
    
    // Evaluate if the trigger has crossed the user's defined physical threshold.
    //
    // SAME EXCEPTION AS THE PANEL PRESS: a hand's trigger value is a continuous hand-closure
    // signal that rests well above zero, so a threshold on it either latches on for ever or
    // fires while the hand is merely relaxed. The runtime's own `pressed` boolean is its gesture
    // recogniser's answer, and trigger sensitivity is a setting about a PHYSICAL trigger's
    // travel — it has nothing to calibrate on a gesture.
    const _handPress = this._isHandSource(source) && !!(buttons && buttons[0] && buttons[0].pressed);
    let isTriggerPressed = false;
    if (this._isHandSource(source)) {
      isTriggerPressed = (this._vrLockedHand === source.handedness || isDominant) && _handPress;
    } else if (this._vrLockedHand === source.handedness) {
       isTriggerPressed = analogValue >= triggerThreshold;
    } else {
       isTriggerPressed = (isDominant && analogValue >= triggerThreshold);
    }

    // THE PRESS, REPORTED BEFORE ANY TOOL GETS A SAY.
    //
    // Grab's own report fires on ITS press edge, which is inside a branch that a controller only
    // reaches if it arrived with a pose. So a pull that never reaches the tool produced no report
    // at all — matt: "its not reporting anything when i pull the right trigger... only on
    // successful grabs." A silent failure is the one case an instrument must not have, so this
    // one sits at the source: the frame where the trigger crosses, whatever happens afterwards.
    if (!this._trigWas) this._trigWas = {};
    {
      const raw = !!(buttons && buttons[0] && buttons[0].pressed);
      const hand = source.handedness;
      if (raw && !this._trigWas[hand] && window._grabTrace) {
        const tool = this._sculptManager?.getCurrentTool?.();
        console.log('[press ' + hand + '] digital=' + raw
          + '  analog=' + analogValue.toFixed(2) + '  threshold=' + triggerThreshold.toFixed(2)
          + '  -> isTriggerPressed=' + isTriggerPressed
          + '  dominant=' + isDominant + '  lockedHand=' + (this._vrLockedHand || '-')
          + '  tool=' + (tool?.constructor?.name || '-')
          + '  pointingAtMenu=' + !!this._isPointingAtMenu
          + '  uiHit=' + ((hand === 'left' ? this._vrUIHitSourceLeft : this._vrUIHitSourceRight) || '-'));
        // WHAT THE TOOLS WERE ACTUALLY HANDED. This is the list Grab iterates, and a hand that
        // is missing from it is invisible to every report inside the tool — which is the state
        // this hunt kept landing in: a clean press here, then silence there. Built later in this
        // same function, so it is one frame old; that is fine for a list that changes on
        // connect/disconnect rather than per frame.
        //
        // A source present in `inputSources` but absent here means the build dropped it, and
        // the build drops a source when `_vrControllerLeft/Right` has no object for that hand.
        const _ctls = this._lastXRControllers || [];
        console.log('[press ' + hand + '] toolsWereHanded=['
          + _ctls.map((c) => c.handedness + (c.matrix ? '' : '/noMatrix')).join(' ')
          + ']  inputSources=['
          + [...(frame.session?.inputSources || [])].map((sr) => sr.handedness).join(' ')
          + ']  mapping=[' + (this._vrControllerLeft ? 'left' : '-') + ' '
          + (this._vrControllerRight ? 'right' : '-') + ']');
        console.log('[press ' + hand + '] a press with isTriggerPressed=false never reaches the '
          + 'tool: the analog value did not cross the threshold, or the hand is not dominant '
          + 'and nothing has locked to it. A uiHit naming a panel means the ray was on UI and '
          + 'the controller is handed to tools WITHOUT a pose, which excludes it from the pin '
          + 'path entirely.');
      }
      // Remembered for the dispatch report below: the two decisions are ~100 lines apart and
      // the interesting thing is whether THIS press reached the tool.
      if (raw && !this._trigWas[hand]) { this._pressEdgeHand = hand; this._pressEdgeCall = hand; }
      this._trigWas[hand] = raw;
    }

    // THE OFF HAND ENDS A BONE CHAIN.
    //
    // Ending a chain was the A button, and a hand has no A button, so hands-only had no way out of
    // one at all. matt: "in vr with hands, i couldn't end a chain by a pinch tap with my left
    // hand."
    //
    // IT HAS TO READ THE OFF HAND ITSELF, which is the part I got wrong twice. A tool cannot do
    // it: updateXR is only ever called with the DOMINANT source (see the activeSource selection --
    // "FORCE DOMINANT HAND"), so a press from the other hand never reaches a tool. And THIS
    // function is per-source and also only ever called for the dominant hand, so the shared press
    // edge above (`_pressEdgeCall`) can only ever name that hand -- comparing it to the off hand
    // was comparing the dominant hand against itself. So the state is kept here, and the hand is
    // found in the session's own input list rather than assumed to be the one we were called for.
    //
    // NOT A MODIFIER. An earlier cut required the dominant trigger to be idle, on the grounds that
    // both-held already means the Smooth override. matt: "this shouldn't be treated as a modifier,
    // it should be just i pinch with my off-hand, doesn't matter what my on-hand is doing, it
    // should just end the chain." Which is right: Smooth is about a stroke, and there is no stroke
    // to modify while you are placing joints.
    {
      const offHand = this._dominantHand === 'left' ? 'right' : 'left';
      let offDown = false;
      for (const src of (frame.session?.inputSources || [])) {
        if (src.handedness === offHand && this._isTriggerDown(src)) { offDown = true; break; }
      }
      // Rising edge only, or a held pinch would end a chain, then the next, then the next.
      if (offDown && !this._offHandWas) {
        const t = this._sculptManager?.getCurrentTool?.();
        if (t && typeof t.endChainFromInput === 'function') t.endChainFromInput();
      }
      this._offHandWas = offDown;
    }

    // VR Ergonomics: Temporary Modifiers
    // Check if the non-dominant index trigger is held.
    // FIX v0.9.160: Evaluated BEFORE stroke initialization to prevent first-frame "dot" of primary tool
    const session = frame.session;
    const nonDomHand = this._dominantHand === 'left' ? 'right' : 'left';

    let isSmoothOverride = false;
    let isColorSmoothOverride = false;
    let previousToolIndex = -1;

    // BOTH TRIGGERS, NOT JUST THE OFFHAND ONE.
    //
    // This asked only whether the non-dominant trigger was held, and swapped the active tool to
    // Smooth on the spot. With controllers that is invisible: the swap sits there doing nothing
    // until you pull the dominant trigger, so "held the offhand trigger" and "held both" look
    // the same from inside. With hands on visionOS they do not — matt: "pinching the left hand
    // starts smooth straight away. it should be if both left AND right pinch (ie trigger) are
    // pressed that smooth should work."
    //
    // A modifier is a modifier: it qualifies an action rather than being one. So the dominant
    // trigger has to be down as well, and the override is armed by the pair.
    let _domPressed = false;
    if (session && session.inputSources) {
      for (let src of session.inputSources) {
        if (src.handedness === this._dominantHand && this._isTriggerDown(src)) {
          _domPressed = true; break;
        }
      }
    }
    // ONE RULE, PLUS THE TRIGGER. The mode was decided once at the top of the frame
    // (_updateSmoothModeLatch) and the stroke adds exactly one condition to it: the dominant
    // trigger, which is what turns a modifier into an action.
    //
    // This block used to re-derive the whole thing for itself -- re-scanning the input sources,
    // re-reading getCurrentTool(), and gating on `_isPointingAtMenu`, the scene-wide flag with no
    // handedness in it. So the UI and the stroke answered the same question separately and could
    // disagree: the wrist panel and the cursor would show Smooth while the stroke ran the clay
    // brush, because the dominant controller happened to be aimed at the panel. Two sources of
    // truth for one mode is the bug, and the only fix that stays fixed is having one.
    //
    // The tool-eligibility test it used to do lives in the latch now, expressed against the same
    // `activeTool` and the same NO_SMOOTH_OVERRIDE set.
    if (_domPressed && this._smoothMode) {
      if (this._smoothMode.on) isSmoothOverride = true;
      else if (this._smoothMode.colour) isColorSmoothOverride = true;
    }

    if (isSmoothOverride) {
      const smoothToolIndex = this._smoothToolIndex();
      if (smoothToolIndex !== -1 && this._sculptManager.getCurrentTool() !== this._sculptManager._tools[smoothToolIndex]) {
        previousToolIndex = this._sculptManager._toolIndex;
        // SMOOTH OWNS ITS RADIUS. NOTHING IS COPIED ONTO IT HERE.
        //
        // There used to be a line here syncing the active brush's radius onto Smooth "so the size
        // feels consistent". It has to go, and the reason is that smooth mode now lets you SET
        // that radius: you hold the off-hand trigger, dial Smooth to the size you want, then pull
        // the dominant trigger -- and this line fired on that pull and overwrote the number you
        // had just chosen with the clay brush's. Which looked exactly like the app randomly
        // forgetting the setting. matt: "sometimes if i smooth it keeps these settings, other
        // times it jumps back to the primary tool size/intensity."
        //
        // A value the user can adjust cannot also be a value something else assigns. Intensity was
        // never synced, so this makes the two consistent, and both now persist per tool through
        // the thumbstick's saveOption -- which is what adurna35 asked for to begin with: "Option
        // to have the smooth shortcut rely on the values of the actual smooth tool."
        this._sculptManager._toolIndex = smoothToolIndex;
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
    // DID THIS PRESS REACH THE TOOL. Every [grab] report lives inside Grab.updateXR, so a frame
    // that never dispatches produces total silence — which is what a failed pull looked like:
    // a clean press line, then nothing. This is the one link that was never instrumented.
    if (this._pressEdgeHand && window._grabTrace) {
      console.log('[press ' + this._pressEdgeHand + '] dispatch: canSculpt=' + canSculpt
        + '  (isTriggerPressed=' + isTriggerPressed + '  picked=' + !!picked
        + '  allowAir=' + allowAir + '  toolActive=' + !!isToolActive
        + '  alreadySculpting=' + !!this._vrSculpting
        + '  secondaryTrigger=' + !!this._vrSecondaryTriggerPressed + ')');
      console.log('[press ' + this._pressEdgeHand + '] canSculpt=false means NO tool dispatch '
        + 'this frame, so Grab never sees the press and reports nothing. canSculpt=true with no '
        + '[grab] line after it means the dispatch ran but the pin loop skipped this hand.');
      this._pressEdgeHand = null;
    }

    // A TOOL STILL HOLDING SOMETHING GETS end() EVEN IF NO STROKE WAS EVER OPEN.
    //
    // Grab ACQUIRES from the digital triggers inside `controllers[]`, but the stroke lifecycle
    // that ends it keys off `isTriggerPressed`. Those disagree, so a grab taken on a frame that
    // was not a stroke has no stroke to end — and `_grabbedMesh` sticks for ever. Because
    // `_updateXRPinGrabs` returns on its FIRST line when a mesh is held, the pin path then dies
    // for that hand: preselection still lights up, nothing is grabbable.
    //
    // Fixing it inside the tool did not work, and the reason is the point: updateXR is only
    // dispatched while canSculpt is true, so the tool never gets a frame with the trigger up in
    // which to notice. The release has to live where it is reached unconditionally, which is
    // here. matt: "i'm sure this is why i asked you to revert all the bone select code" — and he
    // was right that the two are connected. Re-enabling BONE_SELECT made Grab's rig-aware pick
    // return bone capsules, which are big and easy to hit, so the generic path started
    // swallowing rig nodes far more often. That turned a latent leak into a constant one.
    if (!canSculpt && !this._vrSculpting) {
      const _t = this._sculptManager?.getCurrentTool?.();
      if (_t && _t._grabbedMesh) {
        if (window._grabTrace) {
          console.log('[press] orphan release: tool was holding #' + _t._grabbedMesh.getID()
            + ' with no stroke open — acquired outside the stroke lifecycle');
        }
        try { _t.end(); } catch (e) { console.error('[grab] orphan end() failed', e); }
      }
    }

    if (this._lastCanSculpt !== canSculpt || (this._vrSculpting && !canSculpt)) {
      if (window.screenLog) {
        // window.screenLog(`Scene Logic Change: Can=${canSculpt} Trig=${isTriggerPressed} Pick=${!!picked} Active=${!!isToolActive} Sculpting=${this._vrSculpting}`, canSculpt ? "lime" : "red");
      }
      this._lastCanSculpt = canSculpt;
    }

    if (canSculpt) {
      if (!this._vrSculpting) {
        this._vrSculpting = true;
        // Starting a stroke dismisses the blendshape name picker (you've decided to sculpt
        // the pending default layer rather than pick a name first).
        this._vrBlendPanel?.notifySculptStarted?.();
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
        // A VR stroke never multi-selects: the secondary trigger means smooth/negative here,
        // not Ctrl. See Scene.multiSelectHeld for where it DOES mean Ctrl.
        this._sculptManager.start(false);
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
          // A RIG NODE IS AN ORDINARY KEYABLE OBJECT. The gate used to ask which TOOL was active,
          // so posing under the Bones tool fell through to the shape-key branch and keyed the skin.
          // Ask what MOVED instead: a bone and a pin both carry a transform and no shape, so a
          // transform key is the only kind that means anything for either.
          // THE TOOL'S REPORT BEATS THE SELECTION, and the order matters more than it looks.
          // _lastRigEdit is set SYNCHRONOUSLY the instant a tool takes hold of a rig node.
          // currentMesh comes from the selection, which is updated AFTER AutoKey has already
          // run — so it is reliably one gesture STALE. Preferring it keyed the previously
          // grabbed node every time: grab left pin, right pin, root and the keys land on
          // root, left, right — the whole sequence rotated by one, which is what the traces
          // showed (currentMesh at each key equalled lastRigEdit at the one before it).
          const _rigOf = (m) => (m && (m._isBone || m._isPinTarget)) ? m : null;
          const rigNode = _rigOf(this._lastRigEdit) || _rigOf(currentMesh);
          const _rigEditWas = this._lastRigEdit; // kept for the trace below
          this._lastRigEdit = null; // consumed: the next stroke must not inherit it
          const keyMesh = rigNode || currentMesh;
          const isMove = !!rigNode || (sm && (sm._toolIndex === Enums.Tools.TRANSFORM_VR || sm._toolIndex === Enums.Tools.GRAB));
          // WHAT DID AUTOKEY JUST KEY? (window._animKeyTrace = true)
          //
          // Prints every input to the decision, not just the outcome, because "it keyed the
          // wrong thing" has several distinct causes that look identical afterwards:
          //   currentMesh is the SCULPTING pick from stroke start (stale on a rig drag)
          //   _lastRigEdit is what the tool says it took (unset = the tool never reported)
          //   rigNode is which of those won; keyMesh is what actually receives the key
          //   isMove decides transform key vs SHAPE key — a shape key on a bone is a no-op
          const _nm = (m) => (m ? ((m._permanentStaticLabel || m._typeName || 'mesh') + '#' + m.getID()) : 'none');
          if (window._animKeyTrace) {
            console.log(`[autokey] tool=${sm && sm._toolIndex}`
              + ` currentMesh=${_nm(currentMesh)} lastRigEdit=${_nm(_rigEditWas)}`
              + ` -> rigNode=${_nm(rigNode)} keyMesh=${_nm(keyMesh)}`
              + ` isMove=${isMove ? 'transform' : 'SHAPE'}`
              + ` t=${(window._animCurrentTime || 0).toFixed(3)}`);
          }

          if (isMove) {
            const meshId = keyMesh.getID();
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
                const currMat = mat4.clone(keyMesh.getMatrix());
                keyMesh.setMatrix(tool._undoMatrix);
                window._animationRegistry.addTransformKey(keyMesh, 0.0);
                keyMesh.setMatrix(currMat);
              }
            }

            const tMat = keyMesh.getMatrix();
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
            window._animationRegistry.addTransformKey(keyMesh, targetTime);

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
                    window._animationRegistry.deleteTransformKey(keyMesh, targetTime);
                  }
                  window._animationRegistry.update(keyMesh, true);
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
                  window._animationRegistry.update(keyMesh, true);
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
            // A REAL GAMEPAD ALWAYS WINS OVER THE HAND-TRACKING STUB.
            //
            // This used to read `src.hand ? stub : src.gamepad`, so ANY source carrying hand
            // data was handed to the tools with a stub whose buttons are permanently
            // `pressed: false` — even when the same source had a perfectly good gamepad with
            // the trigger physically down. The runtime populates `hand` intermittently
            // alongside a controller, which is why this failed roughly three pulls in five and
            // looked like a picking problem.
            //
            // It was invisible from inside the tools because it is a SECOND SOURCE OF TRUTH:
            // Scene reads `source.gamepad.buttons` directly for its own input handling and saw
            // the real press, while Grab read the stub and saw nothing at all — not a wrong
            // answer, no answer, which is why every report inside Grab stayed silent. matt
            // tracked it down to exactly that pair: "canSculpt=true" and no [grab] line.
            //
            // The stub still exists for a genuine hand source, which has no gamepad, so the
            // downstream code that reads buttons does not have to check.
            // _padOf answers with the gesture-synthesised pad for a hand and rejects an empty
            // one, so the stub below is now only a last resort for a hand whose gestures have
            // not been evaluated yet this session — it is no longer the normal hand path, which
            // is what made every hand read as permanently unpressed.
            const _realPad = this._padOf(src);
            const gamepad = _realPad
              || (src.hand ? { buttons: [{ pressed: false }, { pressed: false }] } : null);
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

              // Grab is proximity-based, so its origin must be the VISIBLE STYLUS TIP rather
              // than the controller pivot or spike base. Offset places the base; length then
              // advances along the tilted spike to its tip.
              const stylusOff = this.getStylusOffset();
              const stylusLen = this.getStylusLength();
              const stylusTilt = this.getStylusTilt() * Math.PI / 180.0;
              const controllerRayOrigin = vec3.transformMat4(vec3.create(),
                [0, Math.sin(stylusTilt) * stylusLen,
                  -stylusOff - Math.cos(stylusTilt) * stylusLen], sceneMat);
              const controllerRayEnd = vec3.transformMat4(vec3.create(),
                [0, Math.sin(stylusTilt) * (stylusLen + 1),
                  -stylusOff - Math.cos(stylusTilt) * (stylusLen + 1)], sceneMat);
              const controllerRayDirection = vec3.normalize(vec3.create(),
                vec3.sub(vec3.create(), controllerRayEnd, controllerRayOrigin));

              xrControllers.push({
                handedness: src.handedness,
                buttons: gamepad.buttons, // resolved above; src.gamepad is empty on AVP hands
                matrix: sceneMat, // VIRTUAL SCENE MATRIX
                rayOrigin: controllerRayOrigin,
                rayDirection: controllerRayDirection,
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
        } else if (this._padOf(source)?.buttons?.[0]) {
          triggerValue = this._padOf(source).buttons[0].value;
        }

        // Universal Sub Mode: Apply Effective Negative State to Tool
        const toolParams = currentTool || tool; // handle variable changes via scope shift
        if (toolParams) toolParams._negative = isNegative;

        if (this._wasTriggerPressed !== isTriggerPressed) {
          this._wasTriggerPressed = isTriggerPressed;
        }

        // Stashed for the flight recorder: it must report the list the TOOLS were handed, not
        // a list rebuilt from the session — the difference between the two is exactly the
        // menu-guard case it exists to catch.
        this._lastXRControllers = xrControllers;
        // THE CALL ITSELF. Everything so far has measured either side of this line and assumed
        // the middle. If the press reaches here, the entry log inside Grab must follow it; if
        // there is no entry log, the call is not happening on this frame despite canSculpt.
        if (this._pressEdgeCall && window._grabTrace) {
          console.log('[press ' + this._pressEdgeCall + '] CALLING updateXR  activeSource='
            + source.handedness + '  isPressed=' + isTriggerPressed
            + '  srcHasHand=' + !!source.hand
            + '  xrControllers=[' + xrControllers.map((c) => c.handedness
              + (c.buttons?.[0]?.pressed ? '!' : '.')
              + (c.matrix ? '' : '/noMatrix')).join(' ') + ']');
          window._grabExpectEntry = this._pressEdgeCall;
          this._pressEdgeCall = null;
        }
        this._mark('xr-tools');
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


        // THE CURSOR DRAWS THE TOOL THAT WILL RUN, which in smooth mode is Smooth. The wrist
        // panel and the thumbstick already agreed about that; this did not, so the sphere kept
        // the clay brush's size and its intensity tint while both the sliders beside it moved.
        // matt: "i don't see the sphere radius indicator change size or colour to indicate the
        // intensity."
        //
        // The whole binding rather than just the two numbers, because _vrBrushPhysicalRadius
        // below is published as the PICK radius — the cursor and the pick have to be the same
        // sphere, which is the entire point of that line. Safe for the shape branches further
        // down: Smooth is never SculptVoxel or Paint, and both of those are excluded from smooth
        // mode anyway (NO_SMOOTH_OVERRIDE, and Paint takes the colour override instead).
        // effectiveTool falls through to getCurrentTool whenever smooth mode is not held.
        const tool = this.effectiveTool?.() ?? (this._sculptManager ? this._sculptManager.getCurrentTool() : null);
        let sliderVal = 0.15;
        if (tool && tool._radius !== undefined) {
          sliderVal = tool._radius / 100.0;
        }
        const physicalRadius = sliderVal * 0.1; // 0-10cm range
        // THE SPHERE IS THE PICK RADIUS. Published so the rig pick uses the same number the
        // cursor is drawing, rather than a constant of its own that nobody can see or adjust:
        // "use its radius as the proximity max dist".
        this._vrBrushPhysicalRadius = physicalRadius;

        const invScale = 1.0 / (this._vrScale || 1.0);

        for (let source of sources) {
            if (!source.targetRaySpace) continue;
            const isLeft = source.handedness === 'left';
            
            // Through the shared accessor: a hand's raw targetRaySpace is the uncorrected ray.
            const m = this._rayMatrixFor(source, frame, refSpace);
            if (!m) continue;

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
            // 'NOT LEFT' IS NOT THE SAME AS 'RIGHT'. A visionOS pinch ADDS a transient-pointer
            // source for the duration of the pinch, and its handedness is 'none' — so every
            // isLeft ternary in this loop handed it the RIGHT cursor. It is not the active hand,
            // so the offhand branch below hid that cursor, and the brush sphere vanished for as
            // long as the offhand pinch was held: matt, pinching left for alt-smooth, "the
            // sphere radius indicator goes invisible".
            //
            // An unhanded source owns no cursor, so it gets none and the guard below drops it
            // without touching anyone else's visibility. Deliberately NOT a `continue` at the
            // top of the loop: the gaze ray this source carries is the input route the gaze
            // menu button runs on, and that is upstream of here.
            const _handed = source.handedness === 'left' || source.handedness === 'right';
            const cursorGroup = !_handed ? null : (isLeft ? this._vrCursorLeft : this._vrCursorRight);
            const controllerGroup = !_handed ? null : (isLeft ? this._vrControllerLeft : this._vrControllerRight);
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
                    // uiHitDist is measured from the PICKING ray's origin, which is at
                    // -stylusOffset -- and the ray root now starts there too, so the
                    // `+ _stylusOff` that used to compensate for it starting at the
                    // controller origin would now overshoot by exactly that much.
                    pointerLine.scale.z = uiHitDist / 0.30;
                }
            }

            if (cursorGroup) {
                // Determine if this is the active sculpting hand
                let isActiveHand = true;
                if (this._activeHandedness) {
                    isActiveHand = (source.handedness === this._activeHandedness);
                } else {
                    // Before the first trigger squeeze there is no latch, so fall back to the
                    // DOMINANT hand — not to a hard-coded 'right'. The app has known which hand
                    // that is all along (`_dominantHand`, settable and driven by the
                    // leftHandMode option); this line ignored it, so a left-handed user had no
                    // brush cursor at all until they happened to squeeze a trigger.
                    isActiveHand = (source.handedness === (this._dominantHand || 'right'));
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
                // Transform uses the gizmo and Grab uses direct rig targets; neither has a
                // brush radius, so the surface ring/volume indicator is misleading.
                const isTransformTool = tool && tool.constructor
                  && (tool.constructor.name === 'TransformVR' || tool.constructor.name === 'Transform');
                // GRAB GETS ITS SPHERE BACK. It lost it when the rig pick was a RAY, where a
                // radius genuinely meant nothing. The pick is proximity again — everything
                // within the radius is a candidate — so the sphere is the literal shape of the
                // question being asked, and it is the radius the pick uses. What Grab still has
                // no use for is the surface RING: it is not a brush and does not act on a
                // surface.
                const isGrabTool = tool && tool.constructor && tool.constructor.name === 'Grab';

                if (volumeSphere) volumeSphere.visible = !isCubeShape && !isPicking;
                if (volumeCube) volumeCube.visible = isCubeShape && !isPicking;
                const activeVol = isCubeShape ? volumeCube : volumeSphere;

                // HIDDEN DURING PLAYBACK, NEVER DURING A RECORDING.
                //
                // `_animPlaying` means two different things: watching the animation back, and
                // performing one. The cursor should go away for the first — nobody wants a
                // brush ring over a playback — and must not for the second, because a
                // recording is when you are aiming.
                //
                // The exception used to be carved for SHAPE takes alone, on the reasoning that
                // those are the ones where you are sculpting while the loop runs. But a
                // TRANSFORM take is a performance too, and it is the ordinary one for posing —
                // so hitting record made the radius sphere vanish, which is exactly the point
                // at which you are demonstrating what the brush is about to do. matt, trying to
                // record tutorials on the GalaxyXR: "it hides some of the UI, but not all of
                // it; the sphere radius indicator disappears."
                //
                // Nothing to do with the headset or its screen recorder — the app's own record
                // button sets `_animPlaying` (see AnimationRegistry._executePunchIn), and this
                // is the only thing in the app that reads it for visibility. Which is also why
                // the rest of the UI was unaffected.
                //
                // Still always hidden for the transform TOOL (gizmo-driven, no brush cursor).
                const _rec = !!window._animationRegistry?.isRecording;
                cursorGroup.visible = !isTransformTool && (!window._animPlaying || _rec);
                cursorGroup.position.set(0, 0, 0);
                cursorGroup.quaternion.identity();
                cursorGroup.scale.set(1, 1, 1);

                // 1. Position Surface Ring (if hitting mesh) — not useful for voxels (and mis-sized),
                // so hide it entirely in voxel mode; the volume sphere/cube is the brush indicator there.
                if (!isVoxelTool && !isGrabTool && hitDist !== 5.0 && wInter && pickedMesh && (uiHitDist === undefined || uiHitDist === Infinity)) {
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

// Diagnostics, reachable the way the others are — `rigUnit()`, `pathDiag()`, `gnomonDiag()`.
// Both are Scene methods, so they need the live instance rather than a captured one: a Scene
// built after this module loaded would otherwise be invisible to them.
// A FRAME-BY-FRAME TRACE, because the resting state is not the interesting one.
//
// grabDiag() samples latches, and while you are not pressing they are all clear — correct, and
// no help. This records where each frame of Grab input actually ENDED: which hand was chosen,
// whether a controller arrived without a pose, which early return fired. Turn it on, reproduce
// the lock-up, turn it off and read.
window.grabTrace = function (on) {
  // NOT `_grabTrace` — that flag drives two console.log calls per frame, and logging at 72-90Hz
  // moves frame timing enough to change the behaviour being traced. This one only appends to an
  // array; nothing is printed until grabTraceDump().
  window._grabFrameTrace = on !== false;
  if (window._grabFrameTrace) window._grabTraceBuf = [];
  console.log('[grab] frame trace ' + (window._grabFrameTrace ? 'ON — silent, costs one array '
    + 'push per frame. Reproduce the lock-up, then grabTrace(false)' : 'off'));
  if (!window._grabFrameTrace) window.grabTraceDump();
  return window._grabFrameTrace;
};

// Collapsed: one line per RUN of identical outcomes, so a stuck frame reads as a count rather
// than nine hundred lines that scroll the answer away.
window.grabTraceDump = function () {
  const b = window._grabTraceBuf || [];
  if (!b.length) { console.log('[grab] nothing traced'); return []; }
  const out = [];
  for (const e of b) {
    const key = e.where + ' | ' + e.extra;
    const last = out[out.length - 1];
    if (last && last.key === key) { last.n++; last.to = e.t; continue; }
    out.push({ key: key, n: 1, from: e.t, to: e.t });
  }
  for (const r of out) {
    console.log('[grab] x' + String(r.n).padEnd(5) + r.key
      + (r.n > 1 ? '   (' + r.from + 's..' + r.to + 's)' : '   (' + r.from + 's)'));
  }
  console.log('[grab] WHAT TO LOOK FOR, in order:');
  console.log('[grab]  1. `pressed=false` while the same line shows `right!` — the digital '
    + 'button is down but the ANALOG value never crossed the trigger threshold. Scene derives '
    + '`pressed` from `value >= 0.9 - sensitivity*0.8`; the buttons list shows the raw pressed '
    + 'flag. A divergence there is the trigger threshold, not the grab code.');
  console.log('[grab]  2. `ACQUIRED #n` with no matching `released` — the held mesh stuck, so '
    + 'every later press moves that object instead of picking a new one.');
  console.log('[grab]  3. `RETURN active has no matrix` naming the dead hand — Scene sends a '
    + 'pose-less controller when a menu is under the ray, and the right hand wins the ternary '
    + 'that picks the active one.');
  console.log('[grab]  4. Long runs of `enter` with no branch line after them — the frame '
    + 'reached the tool and no branch claimed it.');
  return out;
};

window.grabDiag = function () {
  const app = window.app;
  if (!app?.grabDiag) { console.log('[grab] no scene yet'); return null; }
  return app.grabDiag();
};
window.panelDiag = function () {
  const app = window.app;
  if (!app?.panelDiag) { console.log('[panels] no scene yet'); return null; }
  return app.panelDiag();
};

export default Scene;
