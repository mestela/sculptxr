import './misc/Polyfill.js';
import { VERSION } from './Version.js';
import { vec3, mat4, quat } from 'gl-matrix';
import { Manager as HammerManager, Pan, Pinch, Tap } from 'hammerjs';
import Tablet from './misc/Tablet.js';
import Enums from './misc/Enums.js';
import Utils from './misc/Utils.js';
import Scene from './Scene.js';
import Multimesh from './mesh/multiresolution/Multimesh.js';

var MOUSE_LEFT = 1;
var MOUSE_MIDDLE = 2;
var MOUSE_RIGHT = 3;

import ReferenceManager from './editing/ReferenceManager.js';

// Manage events
class SculptGL extends Scene {

  constructor() {
    super();

    // all x and y position are canvas based

    // controllers stuffs
    this._mouseX = 0;
    this._mouseY = 0;
    this._lastMouseX = 0;
    this._lastMouseY = 0;
    this._lastScale = 0;
    this._vrMultiSelect = false; // [VR] Multi-select Mode

    // NOTHING, MASK_EDIT, SCULPT_EDIT, CAMERA_ZOOM, CAMERA_ROTATE, CAMERA_PAN, CAMERA_PAN_ZOOM_ALT
    this._action = Enums.Action.NOTHING;
    this._lastNbPointers = 0;
    this._isWheelingIn = false;

    // masking
    this._maskX = 0;
    this._maskY = 0;
    this._hammer = new HammerManager(this._canvas);
    this.handleXRInput = this.handleXRInput.bind(this); // Wire up VR input
    this.onXRFrame = this.onXRFrame.bind(this);



    this._eventProxy = {};

    // NUCLEAR FIX: Expose instance globally to bypass scope hell
    window.sculptgl_instance = this;
    window.app = this; // Ensure 'app' is also set globally
    window.sculptgl = this; // Alias for user convenience
    this._referenceManager = new ReferenceManager(this);
    window.debugDoubleTap = () => {
      window._debugTapStats = true;
      console.log("=== DOUBLE TAP DEBUG ENABLED ===");
      console.log("- Run window.debugDoubleTap() again and it will just stay enabled -");
    };

    window.debugSpectator = () => {
      console.log("=== SPECTATOR DEBUG ===");
      console.log("Desktop Rotation Quat:", this._desktopRotation);
      console.log("Camera View Matrix:", this._camera._view);
      console.log("Active Zoom:", this._camera._trans[2]);
    };

    // Convenience for Console Debugging
    Object.defineProperty(this, 'guiXR', {
      get: function () { return this._guiXR; }
    });
    this.toggleMenu = () => { if (this._guiXR) this._guiXR.togglePreview(); };
    this.nextTab = () => { if (this._guiXR) this._guiXR.nextTab(); };

    this.initHammer();

    this.initHammer();

    this._shiftKey = false; // Track shift key globally

    this.initHammer();
    // this._gui.initGui(); // REMOVED: Called in Scene.start(), premature call caused crash

    // --- Version Checker ---
    /*
    window._updateAvailable = false;
    window._availableVersion = "";
    this._checkVersion = async () => { ... }
    setTimeout(() => this._checkVersion(), 1000);
    setInterval(() => this._checkVersion(), 5 * 60 * 1000);
    */

    // Debug Helpers for Desktop Testing
    window.debug = {
      main: this,
      setTool: (id) => {
        // Enums.Tools.VOXEL is 13.
        const tools = this._sculptManager._tools;
        if (!tools[id]) {
          console.error(`Tool ID ${id} not found. Available: VOXEL=${Enums.Tools.VOXEL}, BRUSH=${Enums.Tools.BRUSH}`);
          return;
        }
        this._sculptManager.setToolIndex(id);
        console.log("Tool set to", id, tools[id].constructor.name);
      },
      voxelStroke: () => {
        const tool = this._sculptManager.getTool(Enums.Tools.VOXEL);
        if (!tool) return console.error("Voxel tool not found");
        // tool.stroke(0, 0, 0, 1.0); // x, y, pressure, isLast
        // Actually, voxel stroke logic is complex.
        // Let's use the 'addSphere' direct call if possible, or simulate input.
        // But tool.stroke requires event pointers.
        // Let's call the logic directly:
        const vs = tool._voxelState;
        // Reset
        vs.clear();
        // Add Sphere
        // ix, iy, iz, radius, value
        // tool._edit(...) handles this.
        // Let's just emulate a stroke:
        if (tool._voxelState) {
          // VoxelState is centered at 0,0,0 (min=-50, max=50)
          // Radius should be in World Units (e.g. 25.0 = 1/4 of box)
          vs.addSphere([0, 0, 0], 25.0, 1.0);
          tool.updateMesh();
          window.screenLog("Voxel Stroke Applied (Sphere at 0,0,0 r=25)", "lime");
        } else {
          window.screenLog("Voxel State not ready", "red");
        }
      },
      grab: () => {
        const tool = this._sculptManager.getTool(Enums.Tools.GRAB);
        if (!tool) return "Grab tool not found";
        const active = tool._activeController;
        if (!active) return "No active controller in Grab tool";
        const m = active.matrix;
        return `Active Controller:\nPos: ${m[12]}, ${m[13]}, ${m[14]}\nMesh Grabbed: ${!!tool._grabbedMesh}`;
      },
      bake: () => {
        const tool = this._sculptManager.getTool(Enums.Tools.VOXEL);
        if (tool && tool.bakeToMesh) {
          tool.bakeToMesh();
          // window.screenLog("Debug Bake Triggered", "lime"); 
        } else {
          window.screenLog("Voxel Tool not available for bake", "red");
        }
      },
      checkMesh: () => {
        const mesh = this.getMesh();
        if (!mesh) return console.log("No Mesh");
        console.log("Mesh:", mesh);
        console.log("Verts:", mesh.getNbVertices());
        console.log("Faces:", mesh.getNbFaces());
        console.log("Opacity:", mesh.getOpacity());
        console.log("FlatShading:", mesh.getFlatShading());
        console.log("Shader:", mesh.getShaderType());
        // Check Normals
        const norms = mesh.getNormals();
        let zero = 0;
        if (norms) {
          for (let i = 0; i < Math.min(norms.length, 30); i += 3) {
            console.log(`N[${i / 3}]: ${norms[i].toFixed(2)}, ${norms[i + 1].toFixed(2)}, ${norms[i + 2].toFixed(2)}`);
          }
          // Count zero length
          for (let i = 0; i < norms.length; i += 3) {
            if (norms[i] === 0 && norms[i + 1] === 0 && norms[i + 2] === 0) zero++;
          }
        }
        console.log("Zero Len Normals:", zero);
      },
      setShader: (type) => {
        if (!this._mesh) return;
        type = type.toUpperCase();
        if (Enums.Shader[type] !== undefined) {
          this._mesh.setShaderType(Enums.Shader[type]);
          this.render();
          window.screenLog(`Shader set to ${type}`, "lime");
        } else {
          window.screenLog(`Unknown shader: ${type}`, "red");
        }
      },
      toggleCulling: () => {
        const gl = this._gl;
        if (!gl) return;
        if (gl.isEnabled(gl.CULL_FACE)) {
          gl.disable(gl.CULL_FACE);
          window.screenLog("Culling DISABLED", "lime");
        } else {
          gl.enable(gl.CULL_FACE);
          window.screenLog("Culling ENABLED", "red");
        }
        this.render();
      },
      flipVoxelWinding: () => {
        if (this._sculptManager.getCurrentTool().flipWinding) {
          this._sculptManager.getCurrentTool().flipWinding();
          window.screenLog("Voxel Winding FLIPPED", "lime");
          this.render();
        } else {
          window.screenLog("Current tool has no flipWinding", "red");
        }
      },
      toggleWireframe: () => {
        const mesh = this.getMesh();
        if (!mesh) return;
        const rd = mesh.getRenderData();
        rd._showWireframe = !rd._showWireframe;
        console.log(`Wireframe: ${rd._showWireframe}`);
        this.render();
      },
      sceneInfo: () => {
        // Fallback for lost context
        let scene = null;
        if (this && this.getMeshes) {
          scene = this; // 'this' is SculptGL
        } else if (window.sculptgl_instance) {
          scene = window.sculptgl_instance;
        }

        if (!scene) {
          console.error("SculptGL Instance missing");
          return;
        }

        const meshes = scene.getMeshes();
        window.screenLog(`Scene: ${meshes.length} Meshes`, "white");
        meshes.forEach((m, i) => {
          const v = m.getNbVertices();
          const f = m.getNbFaces();
          const vis = m.isVisible() ? "VISIBLE" : "HIDDEN";
          const world = m.getMatrix();
          const pos = `[${world[12].toFixed(1)},${world[13].toFixed(1)},${world[14].toFixed(1)}]`;
          const scale = world[0].toFixed(3);
          const rd = m.getRenderData();
          const mat = `Shd=${rd._shaderType} Wire=${rd._showWireframe} Op=${rd._alpha}`;
          window.screenLog(`#${i} ID=${m.getID()} ${vis} ${mat} V=${v} F=${f} Pos=${pos} S=${scale}`, "cyan");
        });
      },
      isolate: (id) => {
        const meshes = this.getMeshes();
        let found = false;
        meshes.forEach(m => {
          if (m.getID() === id) {
            m.setVisible(true);
            found = true;
          } else {
            m.setVisible(false);
          }
        });
        this.render();
        window.screenLog(found ? `Isolated Mesh ${id}` : `Mesh ${id} not found`, found ? "lime" : "red");
      },
      hide: (id) => {
        const meshes = this.getMeshes();
        meshes.forEach(m => {
          if (m.getID() === id) m.setVisible(false);
        });
        this.render();
      },
      show: (id) => {
        const meshes = this.getMeshes();
        meshes.forEach(m => {
          if (m.getID() === id) m.setVisible(true);
        });
        this.render();
      },
      forceVerify: () => {
        // Force all meshes to be visible and small opacity to see overlap
        const meshes = this.getMeshes();
        meshes.forEach(m => {
          m.setVisible(true);
          m.setOpacity(0.5);
        });
        this.render();
        window.screenLog("All Visible + Opacity 0.5", "lime");
      },
      // Force render
      render: () => { this.render(); },

      hideDefault: () => {
        // Hides all meshes except the last added one (assuming it's the bake)
        const meshes = this.getMeshes();
        if (meshes.length > 0) {
          meshes[0].setVisible(false); // Hide the sphere (usually index 0)
        }
        this.render();
        window.screenLog("Default Sphere Hidden", "lime");
      },

      analyzeTopology: () => {
        const mesh = this.getMesh();
        if (!mesh) return console.log("No Mesh");

        // Check Vertex Rings
        const vrfStartCount = mesh.getVerticesRingFaceStartCount();
        const vertRingFace = mesh.getVerticesRingFace();
        const nbVerts = mesh.getNbVertices();
        let orphans = 0;
        let badRings = 0;

        for (let i = 0; i < nbVerts; ++i) {
          const start = vrfStartCount[i * 2];
          const count = vrfStartCount[i * 2 + 1];
          if (count === 0) orphans++;
          // Optional: Check if ring is valid (sanity check indices)
          for (let j = start; j < start + count; ++j) {
            if (vertRingFace[j] >= mesh.getNbFaces()) badRings++;
          }
        }

        console.log(`Topology Analysis:`);
        console.log(`- Vertices: ${nbVerts}`);
        console.log(`- Faces: ${mesh.getNbFaces()}`);
        console.log(`- Orphans (No Face Ring): ${orphans}`);
        console.log(`- Bad Ring Indices: ${badRings}`);
        window.screenLog(`Topo: V=${nbVerts} Orphans=${orphans} BadRings=${badRings}`, orphans > 0 ? "red" : "lime");
      },

      analyzeDuplicates: () => {
        const mesh = this.getMesh();
        if (!mesh) return console.log("No Mesh");
        const verts = mesh.getVertices();
        const nbVerts = mesh.getNbVertices();
        const map = new Map();
        let dups = 0;

        // Simple 3D hash
        for (let i = 0; i < nbVerts; ++i) {
          const id = i * 3;
          const x = verts[id];
          const y = verts[id + 1];
          const z = verts[id + 2];
          // key precision 4 decimal places
          const key = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
          if (map.has(key)) {
            dups++;
          } else {
            map.set(key, i);
          }
        }
        console.log(`Duplicate Vertices Check: ${dups} duplicates found.`);
        window.screenLog(`Duplicates: ${dups} (Total V=${nbVerts})`, dups > 0 ? "red" : "lime");
      }
    };

    this.addEvents();
  }

  addEvents() {
    var canvas = this._canvas;

    var cbMouseWheel = this.onMouseWheel.bind(this);
    var cbOnPointer = this.onPointer.bind(this);

    // pointer
    canvas.addEventListener('pointerdown', cbOnPointer, false);
    canvas.addEventListener('pointermove', cbOnPointer, false);

    // mouse
    canvas.addEventListener('mousedown', this.onMouseDown.bind(this), false);
    canvas.addEventListener('mouseup', this.onMouseUp.bind(this), false);
    canvas.addEventListener('mouseout', this.onMouseOut.bind(this), false);
    canvas.addEventListener('mouseover', this.onMouseOver.bind(this), false);
    canvas.addEventListener('mousemove', Utils.throttle(this.onMouseMove.bind(this), 16.66), false);

    // [HOTFIX] Prevent Three.js WebXRManager from running heavy raycasts on hover
    canvas.addEventListener('pointerover', (e) => { e.stopPropagation(); }, true);

    canvas.addEventListener('mousewheel', cbMouseWheel, false);
    canvas.addEventListener('DOMMouseScroll', cbMouseWheel, false);
    // Add native double-click as fallback to Hammer.js
    canvas.addEventListener('dblclick', (e) => {
      this.onDoubleTap(e);
    }, false);

    //key
    window.addEventListener('keydown', this.onKeyDown.bind(this), false);
    window.addEventListener('keyup', this.onKeyUp.bind(this), false);

    var cbLoadFiles = this.loadFiles.bind(this);
    var cbStopAndPrevent = this.stopAndPrevent.bind(this);
    // misc
    canvas.addEventListener('webglcontextlost', this.onContextLost.bind(this), false);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored.bind(this), false);
    window.addEventListener('dragenter', cbStopAndPrevent, false);
    window.addEventListener('dragover', cbStopAndPrevent, false);
    window.addEventListener('drop', cbLoadFiles, false);
    document.getElementById('fileopen').addEventListener('change', cbLoadFiles, false);
  }

  onPointer(event) {
    Tablet.pressure = event.pressure;
  }

  initHammer() {
    this._hammer.options.enable = true;
    this._initHammerRecognizers();
    this._initHammerEvents();
  }

  _initHammerRecognizers() {
    var hm = this._hammer;
    // double tap
    hm.add(new Tap({
      event: 'doubletap',
      pointers: 1,
      taps: 2,
      time: 250, // def : 250.  Maximum press time in ms.
      interval: 450, // def : 300. Maximum time in ms between multiple taps.
      threshold: 5, // def : 2. While doing a tap some small movement is allowed.
      posThreshold: 50 // def : 30. The maximum position difference between multiple taps.
    }));

    // double tap 2 fingers
    hm.add(new Tap({
      event: 'doubletap2fingers',
      pointers: 2,
      taps: 2,
      time: 250,
      interval: 450,
      threshold: 5,
      posThreshold: 50
    }));

    // pan
    hm.add(new Pan({
      event: 'pan',
      pointers: 0,
      threshold: 0
    }));

    // pinch
    hm.add(new Pinch({
      event: 'pinch',
      pointers: 2,
      threshold: 0.1 // Set a minimal thresold on pinch event, to be detected after pan
    }));
    hm.get('pinch').recognizeWith(hm.get('pan'));
  }

  _initHammerEvents() {
    var hm = this._hammer;
    hm.on('panstart', this.onPanStart.bind(this));
    hm.on('panmove', this.onPanMove.bind(this));
    hm.on('panend pancancel', this.onPanEnd.bind(this));

    hm.on('doubletap', this.onDoubleTap.bind(this));
    hm.on('doubletap2fingers', this.onDoubleTap2Fingers.bind(this));
    hm.on('pinchstart', this.onPinchStart.bind(this));
    hm.on('pinchin pinchout', this.onPinchInOut.bind(this));
  }

  stopAndPrevent(event) {
    event.stopPropagation();
    event.preventDefault();
  }

  onContextLost() {
    window.alert('Oops... WebGL context lost.');
  }

  onContextRestored() {
    window.alert('Wow... Context is restored.');
  }

  ////////////////
  // KEY EVENTS
  ////////////////
  onKeyDown(e) {
    this._shiftKey = e.shiftKey;

    // [SPECTATOR MATRIX] Cycle Modes
    if (e.which === 68) { // 'D'
      this._spectatorMode = (this._spectatorMode + 1) % 4;
      const modeNames = ["VR View (Mirror)", "DESKTOP", "TRACKED", "STATIONARY (Desktop 6DOF)"];
      if (window.screenLog) window.screenLog(`Spectator Mode: ${modeNames[this._spectatorMode]}`, "lime");
      this.render();
    }

    // [CALIBRATION] Toggle Calibration Mode
    if (e.which === 67) { // 'C'
      if (this._spectatorMode !== Enums.SpectatorMode.STATIONARY) {
        if (window.screenLog) window.screenLog(`Calibration requires STATIONARY mode.`, "orange");
      } else {
        this._isCalibratingSpectator = !this._isCalibratingSpectator;
        if (window.screenLog) window.screenLog(this._isCalibratingSpectator ? `Calibration: ENABLED` : `Calibration: DISABLED`, "lime");
      }
    }

    this._gui.callFunc('onKeyDown', e);
  }

  onKeyUp(e) {
    this._shiftKey = e.shiftKey;
    this._gui.callFunc('onKeyUp', e);
  }

  ////////////////
  // MOBILE EVENTS
  ////////////////
  onPanStart(e) {
    if (e.pointerType === 'mouse')
      return;
    this._focusGui = false;
    var evProxy = this._eventProxy;
    evProxy.pageX = e.center.x;
    evProxy.pageY = e.center.y;
    this.onPanUpdateNbPointers(Math.min(3, e.pointers.length));
  }

  onPanMove(e) {
    if (e.pointerType === 'mouse')
      return;
    var evProxy = this._eventProxy;
    evProxy.pageX = e.center.x;
    evProxy.pageY = e.center.y;

    var nbPointers = Math.min(3, e.pointers.length);
    if (nbPointers !== this._lastNbPointers) {
      this.onDeviceUp();
      this.onPanUpdateNbPointers(nbPointers);
    }
    this.onDeviceMove(evProxy);

    if (this._isIOS()) {
      window.clearTimeout(this._timerResetPointer);
      this._timerResetPointer = window.setTimeout(function () {
        this._lastNbPointers = 0;
      }.bind(this), 60);
    }
  }

  _isIOS() {
    if (this._isIOS !== undefined) return this._isIOS;
    this._isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    return this._isIOS;
  }

  onPanUpdateNbPointers(nbPointers) {
    // called on panstart or panmove (not consistent)
    var evProxy = this._eventProxy;
    evProxy.which = nbPointers === 1 && this._lastNbPointers >= 1 ? 3 : nbPointers;
    this._lastNbPointers = nbPointers;
    this.onDeviceDown(evProxy);
  }

  onPanEnd(e) {
    if (e.pointerType === 'mouse')
      return;
    this.onDeviceUp();
    // we need to detect when all fingers are released
    window.setTimeout(function () {
      if (!e.pointers.length) this._lastNbPointers = 0;
    }.bind(this), 60);
  }

  onDoubleTap(e) {
    if (this._focusGui) {
      return;
    }

    var evProxy = this._eventProxy;

    // Handle both Hammer.js (e.center) and native dblclick (e.pageX)
    evProxy.pageX = e.center ? e.center.x : e.pageX;
    evProxy.pageY = e.center ? e.center.y : e.pageY;

    if (window._debugTapStats) {
      console.log(`[SculptGL.js:onDoubleTap] Fired! Hammer=${!!e.center} X=${evProxy.pageX} Y=${evProxy.pageY}`);
    }

    if (evProxy.pageX === undefined) return; // Prevent crash if completely blank event

    if (window.screenLog) window.screenLog(`onDoubleTap: Hammer=${!!e.center} X=${evProxy.pageX} Y=${evProxy.pageY}`, "cyan");

    this.setMousePosition(evProxy);

    var picking = this._picking;
    var res = picking.intersectionMouseMeshes();
    var cam = this._camera;
    var pivot = [0.0, 0.0, 0.0];
    if (!res) {
      return this.resetCameraMeshes();
    }

    vec3.transformMat4(pivot, picking.getIntersectionPoint(), picking.getMesh().getMatrix());

    // [v0.8.63 Fix] Synchronize framing with the Spectator Visual Offset
    var spectatorTransform = this.getSpectatorTransform();
    if (spectatorTransform) {
      vec3.transformMat4(pivot, pivot, spectatorTransform);
    }

    var zoom = cam._trans[2];
    if (!cam.isOrthographic()) {
      zoom = Math.min(zoom, vec3.dist(pivot, cam.computePosition()));
    }

    cam.setAndFocusOnPivot(pivot, zoom);
    this.render();
  }

  onDoubleTap2Fingers() {
    if (this._focusGui) return;
    this.resetCameraMeshes();
  }

  onPinchStart(e) {
    this._focusGui = false;
    this._lastScale = e.scale;
  }

  onPinchInOut(e) {
    var dir = (e.scale - this._lastScale) * 25;
    this._lastScale = e.scale;
    this.onDeviceWheel(dir);
  }

  resetCameraMeshes(meshes) {
    if (!meshes) meshes = this._meshes;

    if (meshes.length > 0) {
      var pivot = [0.0, 0.0, 0.0];
      var box = this.computeBoundingBoxMeshes(meshes);
      var zoom = 0.8 * this.computeRadiusFromBoundingBox(box);
      zoom *= this._camera.computeFrustumFit();
      vec3.set(pivot, (box[0] + box[3]) * 0.5, (box[1] + box[4]) * 0.5, (box[2] + box[5]) * 0.5);

      // [v0.8.63 Fix] Synchronize framing with the Spectator Visual Offset
      var spectatorTransform = this.getSpectatorTransform();
      if (spectatorTransform) {
        vec3.transformMat4(pivot, pivot, spectatorTransform);
      }

      this._camera.setAndFocusOnPivot(pivot, zoom);
    } else {
      this._camera.resetView();
    }

    this.render();
  }

  ////////////////
  // LOAD FILES
  ////////////////
  getFileType(name) {
    var lower = name.toLowerCase();
    if (lower.endsWith('.obj')) return 'obj';
    if (lower.endsWith('.sgl')) return 'sgl';
    if (lower.endsWith('.stl')) return 'stl';
    if (lower.endsWith('.ply')) return 'ply';
    return;
  }

  loadFiles(event) {
    event.stopPropagation();
    event.preventDefault();
    var files = event.dataTransfer ? event.dataTransfer.files : event.target.files;
    if (window.screenLog) window.screenLog(`Files detected: ${files.length}`, "yellow");
    for (var i = 0, nb = files.length; i < nb; ++i) {
      var file = files[i];
      var fileType = this.getFileType(file.name);
      if (window.screenLog) window.screenLog(`Reading: ${file.name} (${fileType})`, "yellow");
      this.readFile(file, fileType);
    }
  }

  readFile(file, ftype) {
    var fileType = ftype || this.getFileType(file.name);
    if (!fileType)
      return;

    var reader = new FileReader();
    var self = this;
    reader.onload = function (evt) {
      if (window.screenLog) window.screenLog(`File Read Complete: ${file.name.slice(0, 10)}...`, "lime");
      self.loadScene(evt.target.result, fileType);
      document.getElementById('fileopen').value = '';
    };

    if (fileType === 'obj')
      reader.readAsText(file);
    else
      reader.readAsArrayBuffer(file);
  }

  ////////////////
  // MOUSE EVENTS
  ////////////////
  onMouseDown(event) {
    event.stopPropagation();
    event.preventDefault();

    this._gui.callFunc('onMouseDown', event);
    this.onDeviceDown(event);
  }

  onMouseMove(event) {
    event.stopPropagation();
    event.preventDefault();

    this._gui.callFunc('onMouseMove', event);
    this.onDeviceMove(event);
  }

  onMouseOver(event) {
    this._focusGui = false;
    this._gui.callFunc('onMouseOver', event);
  }

  onMouseOut(event) {
    this._focusGui = true;
    this._gui.callFunc('onMouseOut', event);
    this.onMouseUp(event);
  }

  onMouseUp(event) {
    event.preventDefault();

    this._gui.callFunc('onMouseUp', event);
    this.onDeviceUp(event);
  }

  onMouseWheel(event) {
    event.stopPropagation();
    event.preventDefault();

    this._gui.callFunc('onMouseWheel', event);
    var dir = event.wheelDelta === undefined ? -event.detail : event.wheelDelta;
    this.onDeviceWheel(dir > 0 ? 1 : -1);
  }

  ////////////////
  // HANDLES EVENTS
  ////////////////
  onDeviceUp(event) {
    // Prevent mouse-up from killing an active VR stroke
    if (this._vrSculpting) {
      return;
    }

    window._lastMouseTime = performance.now();
    window.isUIHiddenForVR = false;
    this.setCanvasCursor('default');
    Multimesh.RENDER_HINT = Multimesh.NONE;
    if (this._sculptManager) this._sculptManager.end();

    if (this._action === Enums.Action.MASK_EDIT && this._mesh) {

      if (this._lastMouseX === this._maskX && this._lastMouseY === this._maskY)
        this.getSculptManager().getTool(Enums.Tools.MASKING).invert();
      else
        this.getSculptManager().getTool(Enums.Tools.MASKING).clear();

    }

    this._action = Enums.Action.NOTHING;
    this.render();
    this._stateManager.cleanNoop();
  }

  onDeviceWheel(dir) {

    if (dir > 0.0 && !this._isWheelingIn) {
      this._isWheelingIn = true;
      this._camera.start(this._mouseX, this._mouseY);
    }
    this._camera.zoom(dir * 0.02);
    Multimesh.RENDER_HINT = Multimesh.CAMERA;
    this.render();
    // workaround for "end mouse wheel" event
    if (this._timerEndWheel)
      window.clearTimeout(this._timerEndWheel);
    this._timerEndWheel = window.setTimeout(this._endWheel.bind(this), 300);
  }

  _endWheel() {
    Multimesh.RENDER_HINT = Multimesh.NONE;
    this._isWheelingIn = false;
    this.render();
  }

  setMousePosition(event) {
    this._mouseX = this._pixelRatio * (event.pageX - this._canvasOffsetLeft);
    this._mouseY = this._pixelRatio * (event.pageY - this._canvasOffsetTop);
  }

  onDeviceDown(event) {
    if (this._focusGui)
      return;

    // Prevent mouse-down from interfering with active VR stroke
    if (this._vrSculpting) return;

    this.setMousePosition(event);

    var mouseX = this._mouseX;
    var mouseY = this._mouseY;
    var button = event.which;

    var canEdit = false;
    if (button === MOUSE_LEFT && this._sculptManager) {
      canEdit = this._sculptManager.start(event.shiftKey || this._shiftKey); // Support both event and global shift
    }

    if (button === MOUSE_LEFT && canEdit)
      this.setCanvasCursor('none');

    if (button === MOUSE_RIGHT && event.ctrlKey)
      this._action = Enums.Action.CAMERA_ZOOM;
    else if (button === MOUSE_MIDDLE)
      this._action = Enums.Action.CAMERA_PAN;
    else if (!canEdit && event.ctrlKey) {
      this._maskX = mouseX;
      this._maskY = mouseY;
      this._action = Enums.Action.MASK_EDIT;
    } else if ((!canEdit || button === MOUSE_RIGHT) && event.altKey)
      this._action = Enums.Action.CAMERA_PAN_ZOOM_ALT;
    else if (button === MOUSE_RIGHT || (button === MOUSE_LEFT && !canEdit))
      this._action = Enums.Action.CAMERA_ROTATE;
    else
      this._action = Enums.Action.SCULPT_EDIT;

    if (this._action === Enums.Action.CAMERA_ROTATE || this._action === Enums.Action.CAMERA_ZOOM)
      this._camera.start(mouseX, mouseY);

    this._lastMouseX = mouseX;
    this._lastMouseY = mouseY;
  }

  getSpeedFactor() {
    return this._cameraSpeed / (this._canvasHeight * this.getPixelRatio());
  }

  onDeviceMove(event) {
    if (this._focusGui)
      return;

    this.setMousePosition(event);

    // Prevent mouse-move from interfering with active VR stroke
    if (this._vrSculpting) return;

    this.setCanvasCursor('default');

    window._lastMouseTime = performance.now();
    window.isUIHiddenForVR = false;
    this.setCanvasCursor('default');

    var mouseX = this._mouseX;
    var mouseY = this._mouseY;
    var action = this._action;
    var speedFactor = this.getSpeedFactor();

    if (action === Enums.Action.CAMERA_ZOOM || (action === Enums.Action.CAMERA_PAN_ZOOM_ALT && !event.altKey)) {

      Multimesh.RENDER_HINT = Multimesh.CAMERA;
      this._camera.zoom((mouseX - this._lastMouseX + mouseY - this._lastMouseY) * speedFactor);
      this.render();

    } else if (action === Enums.Action.CAMERA_PAN_ZOOM_ALT || action === Enums.Action.CAMERA_PAN) {

      Multimesh.RENDER_HINT = Multimesh.CAMERA;
      this._camera.translate((mouseX - this._lastMouseX) * speedFactor, (mouseY - this._lastMouseY) * speedFactor);
      this.render();

    } else if (action === Enums.Action.CAMERA_ROTATE) {

      Multimesh.RENDER_HINT = Multimesh.CAMERA;
      if (!event.shiftKey)
        this._camera.rotate(mouseX, mouseY);
      this.render();

    } else {

      Multimesh.RENDER_HINT = Multimesh.PICKING;
      if (this._sculptManager) this._sculptManager.preUpdate();

      if (action === Enums.Action.SCULPT_EDIT) {
        Multimesh.RENDER_HINT = Multimesh.SCULPT;
        this._sculptManager.update(this);
        if (this.getMesh() && this.getMesh().isDynamic)
          this._gui.updateMeshInfo();
      }
    }

    this._lastMouseX = mouseX;
    this._lastMouseY = mouseY;
    this.renderSelectOverRtt();
  }

  // WebXR Support
  async startXRSession(mode) {
    if (!navigator.xr) {
      console.error("WebXR not available");
      return;
    }

    // End existing session if any
    if (this._xrSession) {
      await this._xrSession.end();
    }

    try {
      const session = await navigator.xr.requestSession(mode, {
        optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking']
      });

      // TRUSTED EVENT LISTENER for File I/O
      session.addEventListener('select', (event) => {
        // Robust GuiXR Lookup: Try 'this' (inherited), then fallback to 'window.app'
        const gui = this._guiXR || (window.app && window.app._guiXR);

        if (gui) {
          gui.onClick();
        } else {
          console.error("VR Menu (GuiXR) Not Found.", this);
          // Attempt force init if GL is ready (Last Resort)
          if (this._gl && !this._guiXR) {
            console.warn("Attempting emergency GuiXR init...");
            this.initVRControllers();
            if (this._guiXR) this._guiXR.onClick();
          }
        }
      });

      this.enterXR(session);
      this._currentXRMode = mode;
      // console.log(`Started XR Session: ${mode}`);
    } catch (e) {
      console.error(`Failed to start ${mode} session:`, e);
      if (window.screenLog) window.screenLog(`SculptXR ${VERSION}`, "lime");
    }
  }

  async toggleXRSession() {
    const newMode = (this._currentXRMode === 'immersive-ar') ? 'immersive-vr' : 'immersive-ar';

    // Check support first
    try {
      const supported = await navigator.xr.isSessionSupported(newMode);
      if (supported) {
        await this.startXRSession(newMode);
      } else {
        console.warn(`${newMode} not supported`);
        if (window.screenLog) window.screenLog(`${newMode} not supported`, "orange");
      }
    } catch (e) {
      console.error("Error checking session support:", e);
    }
  }

  getXRMode() {
    return this._currentXRMode;
  }
}

export default SculptGL;
