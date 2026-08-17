import './misc/Polyfill.js';
import { VERSION } from './Version.js';
import { vec3, mat4, quat, mat3 } from 'gl-matrix';
import Tablet from './misc/Tablet.js';
import Enums from './misc/Enums.js';
import Utils from './misc/Utils.js';
import Scene from './Scene.js';
import Multimesh from './mesh/multiresolution/Multimesh.js';

var MOUSE_LEFT = 1;
var MOUSE_MIDDLE = 2;
var MOUSE_RIGHT = 3;

import ReferenceManager from './editing/ReferenceManager.js';
import { FrameGroup } from './editing/FrameGroup.js';

// Manage events
class SculptGL extends Scene {

  constructor() {
    super();

    // On iPad, Apple Pencil hover events fire with pressure=0 before a stroke begins,
    // which bleeds into the first touch and shrinks the radius to ~25% via the pressure
    // formula (1 + 0.75 * (0*2 - 1) = 0.25). Disable pressure scaling on touch devices.
    const isIPad = /iPad/.test(navigator.userAgent) ||
                   (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (isIPad) {
      Tablet.radiusFactor    = 0.0;
      Tablet.intensityFactor = 0.0;
    }

    // all x and y position are canvas based

    // controllers stuffs
    this._mouseX = 0;
    this._mouseY = 0;
    this._lastMouseX = 0;
    this._lastMouseY = 0;
    this._vrMultiSelect = false; // [VR] Multi-select Mode

    // NOTHING, MASK_EDIT, SCULPT_EDIT, CAMERA_ZOOM, CAMERA_ROTATE, CAMERA_PAN, CAMERA_PAN_ZOOM_ALT
    this._action = Enums.Action.NOTHING;
    this._isWheelingIn = false;

    // masking
    this._maskX = 0;
    this._maskY = 0;

    // Dedup guard: iPadOS Safari dispatches each pen PointerEvent twice as
    // separate objects with identical data. _seenPtrKeys is a Map from
    // (type+pointerId+roundedTimestamp) → time-seen, used to suppress
    // duplicates that arrive within a short window even if other events
    // arrive in between. _handledPtrEvents catches same-object re-routing.
    this._handledPtrEvents = new WeakSet();
    this._seenPtrKeys      = new Map();

    // Touch gesture state (replaces Hammer.js)
    this._fingerPointers       = new Map(); // pointerId -> {x, y}
    this._gestureActive        = false;
    this._gesturePinchInitDist    = 0; // finger distance at gesture start (scale reference)
    this._gesturePinchLastDist    = 0; // finger distance last frame (smoothed)
    this._gesturePinchSmoothed    = 0; // EMA-smoothed pinch distance
    this._gesturePanLastX         = 0; // 2-finger pan: center position last frame
    this._gesturePanLastY         = 0;
    this._doubleTapTrack       = { time: 0, x: 0, y: 0, n: 0, count: 0 };
    this._gestureStartTime     = 0;  // ms when current gesture began (for tap detection)
    this._gestureStartCenter   = { x: 0, y: 0 }; // finger-center at gesture start
    this._peakFingerCount      = 0;  // max simultaneous fingers since all-up (for tap detection)
    // Tap sequence tracking — NOT reset on mid-gesture restarts (e.g. 2→1 finger),
    // only reset when all fingers are off the screen.
    this._tapSeqStartTime      = 0;  // time of first finger-down in this sequence
    this._tapSeqPeakCenter     = { x: 0, y: 0 }; // multi-finger center when peak count first reached
    this._tapSeqLiftCenter     = { x: 0, y: 0 }; // multi-finger center when first finger lifted from peak
    this._tapSeqPeakPinchDist  = 0;  // finger spread when peak count first reached
    this._tapSeqLiftPinchDist  = 0;  // finger spread when first finger lifted from peak
    // Finger-sculpt disambiguation: defer starting a finger sculpt/edit briefly so
    // a 2nd finger (camera gesture) or a quick tap can cancel it before any geometry
    // changes — otherwise the 1st of two fingers misfires an extrude/inset etc.
    this._pendingSculpt        = null; // { x, y } landing point while deferred, else null
    this._pendingSculptTimer   = 0;    // setTimeout handle for the deferred start
    this.handleXRInput = this.handleXRInput.bind(this); // Wire up VR input

    this._eventProxy = {};

    // iPad multitouch routing flags — initialise from persisted opts
    const _ipadOpts = window.getOptionsURL?.() || {};
    if (window._ipadFingerView   === undefined) window._ipadFingerView   = _ipadOpts.ipadFingerView   ?? true;
    if (window._ipadFingerSculpt === undefined) window._ipadFingerSculpt = _ipadOpts.ipadFingerSculpt ?? false;
    if (window._ipadStylusView   === undefined) window._ipadStylusView   = _ipadOpts.ipadStylusView   ?? false;
    if (window._ipadStylusSculpt === undefined) window._ipadStylusSculpt = _ipadOpts.ipadStylusSculpt ?? true;

    // NUCLEAR FIX: Expose instance globally to bypass scope hell
    window.sculptgl_instance = this;
    window.app = this; // Ensure 'app' is also set globally
    window.sculptgl = this; // Alias for user convenience
    // Hand-puppetry (#28 v1) live toggle — drives ARKit jawOpen off the non-dominant
    // hand's thumb↔finger gap while in VR. Off by default; call before/inside a session.
    window.togglePuppet = () => {
      window._puppetMode = !window._puppetMode;
      this._puppetAnchor = null; // re-grab neutral on every enable/disable
      if (window.screenLog) window.screenLog(`🧦 Puppet mode ${window._puppetMode ? 'ON' : 'OFF'}`, window._puppetMode ? 'lime' : 'orange');
      return window._puppetMode;
    };
    // Re-anchor the head to your current hand pose (call if it drifts off).
    window.recenterPuppet = () => { this._puppetAnchor = null; if (window.screenLog) window.screenLog('🧦 Puppet re-centered', 'lime'); };
    this._referenceManager = new ReferenceManager(this);

    // Frame-by-frame animation as real outliner objects + keyframed visibility (voxel
    // frames own worker distance-field slots). Replaced the old FrameAnimation cel system.
    this._frameGroup = new FrameGroup(this);
    window._frameGroup = this._frameGroup;

    window.validateMesh = () => {
      var mesh = this.getMesh();
      if (!mesh) {
        console.warn('Validate: No active mesh found.');
        return;
      }
      var activeMesh = mesh.getCurrentMesh ? mesh.getCurrentMesh() : mesh;
      var fAr = activeMesh.getFaces();
      var nbFaces = activeMesh.getNbFaces();
      var degenerateFaces = 0;
      var nonManifoldEdges = 0;
      var inconsistentWinding = 0;
      var edgeMap = new Map();

      for (var i = 0; i < nbFaces; i++) {
        var id = i * 4;
        var v1 = fAr[id];
        var v2 = fAr[id + 1];
        var v3 = fAr[id + 2];
        var isQuad = fAr[id + 3] !== 4294967295;
        var v4 = isQuad ? fAr[id + 3] : -1;

        if (v1 === v2 || v2 === v3 || v3 === v1 || (isQuad && (v4 === v1 || v4 === v2 || v4 === v3))) {
          degenerateFaces++;
        }

        var edges = [[v1, v2], [v2, v3]];
        if (isQuad) edges.push([v3, v4], [v4, v1]);
        else edges.push([v3, v1]);

        for (var e = 0; e < edges.length; e++) {
          var a = edges[e][0];
          var b = edges[e][1];
          var key = a + '_' + b;
          if (edgeMap.has(key)) inconsistentWinding++;
          var undir = Math.min(a, b) + '_' + Math.max(a, b);
          var count = edgeMap.get(undir) || 0;
          if (count >= 2) nonManifoldEdges++;
          edgeMap.set(undir, count + 1);
          edgeMap.set(key, true);
        }
      }

      const logStr = 'Mesh Validation Results:\n' +
                     '- Degenerate Faces: ' + degenerateFaces + '\n' +
                     '- Inconsistent Windings: ' + inconsistentWinding + '\n' +
                     '- Non-Manifold Edges: ' + nonManifoldEdges;

      if (window.screenLog) window.screenLog(logStr, (degenerateFaces || inconsistentWinding || nonManifoldEdges) ? 'red' : 'lime');
      else console.log(logStr);
    };

    window.repairWindingOrders = () => {
      var mesh = this.getMesh();
      if (!mesh) {
        console.warn('Repair: No active mesh found.');
        return;
      }
      var activeMesh = mesh.getCurrentMesh ? mesh.getCurrentMesh() : mesh;
      var fAr = activeMesh.getFaces();
      var nbFaces = activeMesh.getNbFaces();

      // Map each undirected edge to its adjacent faces
      var edgeToFaces = new Map();
      for (var i = 0; i < nbFaces; i++) {
        var id = i * 4;
        var v1 = fAr[id], v2 = fAr[id + 1], v3 = fAr[id + 2];
        var isQuad = fAr[id + 3] !== 4294967295;
        var v4 = isQuad ? fAr[id + 3] : -1;

        var edges = [[v1, v2], [v2, v3]];
        if (isQuad) edges.push([v3, v4], [v4, v1]);
        else edges.push([v3, v1]);

        for (var e = 0; e < edges.length; e++) {
          var a = edges[e][0], b = edges[e][1];
          var key = Math.min(a, b) + '_' + Math.max(a, b);
          if (!edgeToFaces.has(key)) edgeToFaces.set(key, []);
          edgeToFaces.get(key).push(i);
        }
      }

      var visited = new Uint8Array(nbFaces);
      var queue = [0];
      visited[0] = 1;

      var getEdges = (faceIdx) => {
        var id = faceIdx * 4;
        var v1 = fAr[id], v2 = fAr[id + 1], v3 = fAr[id + 2];
        var isQuad = fAr[id + 3] !== 4294967295;
        var v4 = isQuad ? fAr[id + 3] : -1;
        if (isQuad) return [[v1, v2], [v2, v3], [v3, v4], [v4, v1]];
        return [[v1, v2], [v2, v3], [v3, v1]];
      };

      var flipsCount = 0;
      while (queue.length > 0) {
        var current = queue.shift();
        var curEdges = getEdges(current);

        // For each undirected edge of the current face
        for (var e = 0; e < curEdges.length; e++) {
          var a = curEdges[e][0], b = curEdges[e][1];
          var key = Math.min(a, b) + '_' + Math.max(a, b);
          var neighbors = edgeToFaces.get(key) || [];

          for (var n = 0; n < neighbors.length; n++) {
            var neighborIdx = neighbors[n];
            if (visited[neighborIdx]) continue;

            // Find the directed edge orientation on the adjacent face
            var adjEdges = getEdges(neighborIdx);
            var sameDir = false;
            for (var ae = 0; ae < adjEdges.length; ae++) {
              if (adjEdges[ae][0] === a && adjEdges[ae][1] === b) {
                sameDir = true;
                break;
              }
            }

            // If the adjacent face has the exact SAME winding direction (A -> B) instead of opposite, flip it!
            if (sameDir) {
              var nid = neighborIdx * 4;
              if (fAr[nid + 3] !== 4294967295) {
                // Invert Quad: [v1, v2, v3, v4] -> [v1, v4, v3, v2]
                var t = fAr[nid + 1];
                fAr[nid + 1] = fAr[nid + 3];
                fAr[nid + 3] = t;
              } else {
                // Invert Tri: [v1, v2, v3] -> [v1, v3, v2]
                var t = fAr[nid + 1];
                fAr[nid + 1] = fAr[nid + 2];
                fAr[nid + 2] = t;
              }
              flipsCount++;
            }

            visited[neighborIdx] = 1;
            queue.push(neighborIdx);
          }
        }
      }

      activeMesh.updateGeometry();
      activeMesh.updateGeometryBuffers();
      // if (window.screenLog) window.screenLog('Repaired ' + flipsCount + ' inconsistent faces!', 'lime');
      // else console.log('Repaired ' + flipsCount + ' inconsistent faces!');
    };
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

    window.debugVRPose = () => {
        console.log("=== VR TRACKING DUMP ===");
        if (!this._renderer || !this._renderer.xr || !this._renderer.xr.isPresenting) {
            console.warn("NOT IN VR.");
            return;
        }

        const lGrip = this._vrControllerLeftGrip;
        const lTarget = this._vrControllerLeft;
        
        console.log("--- Left Target Ray Space ---");
        if (lTarget) {
            lTarget.updateMatrixWorld(true);
            console.log("MatrixWorld Elements:", lTarget.matrixWorld.elements.slice(8, 15)); // Log mostly translation + -Z dir
            console.log(`Children (${lTarget.children.length}):`, lTarget.children.map(c => c.name || c.type));
        }

        console.log("--- Left Grip Space ---");
        if (lGrip) {
            lGrip.updateMatrixWorld(true);
            console.log("MatrixWorld Elements:", lGrip.matrixWorld.elements.slice(12, 15));
            console.log(`Children (${lGrip.children.length}):`, lGrip.children.map(c => c.name || c.type));
        }

        if (this._vrMenu && this._vrMenu.mesh) {
            console.log("--- Main Menu ---");
            console.log("Is Child of Grip:", lGrip.children.includes(this._vrMenu.mesh));
            console.log("Local Rotation:", this._vrMenu.mesh.rotation.x, this._vrMenu.mesh.rotation.y, this._vrMenu.mesh.rotation.z);
            console.log("Internal Rotation Arr:", this._vrMenu._rotation);
        }
        
        if (this._debugRayMesh) {
            console.log("--- Debug Green Ray ---");
            const pos = this._debugRayMesh.geometry.attributes.position.array;
            console.log(`Origin: ${pos[0].toFixed(3)}, ${pos[1].toFixed(3)}, ${pos[2].toFixed(3)}`);
            console.log(`End:    ${pos[3].toFixed(3)}, ${pos[4].toFixed(3)}, ${pos[5].toFixed(3)}`);
        } else {
            console.warn("--- Debug Green Ray MISSING (rayPose logic failed) ---");
        }
    };

    this._shiftKey = false; // Track shift key globally
    this._altKey = false;   // Track alt key globally (voxel add<->sub / inflate<->deflate invert)
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
        // console.log("Mesh:", mesh);
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

    // Prevent the browser from handling touch gestures (scroll, pinch-zoom) on
    // the canvas — we handle them ourselves via pointer events.
    canvas.style.touchAction = 'none';

    var cbMouseWheel = this.onMouseWheel.bind(this);
    var cbOnPointer = this.onPointer.bind(this);

    // pointer
    canvas.addEventListener('pointerdown',   cbOnPointer, false);
    canvas.addEventListener('pointermove',   cbOnPointer, false);
    canvas.addEventListener('pointerup',     cbOnPointer, false);
    canvas.addEventListener('pointercancel', cbOnPointer, false);

    // mouse
    // NOTE: on Safari/iPadOS, pen pointermove is also dispatched to mousemove/mousedown
    // listeners (PointerEvent extends MouseEvent, so it satisfies the listener type).
    // We filter those out here — pen and touch are handled entirely via onPointer().
    // Only real MouseEvents (desktop mouse) should reach these handlers.
    const mouseOnly = (fn) => (e) => { if (e.constructor === MouseEvent) fn(e); };
    canvas.addEventListener('mousedown', mouseOnly(this.onMouseDown.bind(this)), false);
    canvas.addEventListener('mouseup',   mouseOnly(this.onMouseUp.bind(this)),   false);
    // Suppress the browser context menu so right-click can orbit the camera (right-drag
    // → CAMERA_ROTATE in onDeviceDown). Needed especially for voxel plane drawing, where
    // left-click always lands on the infinite draw plane and never frees up to orbit.
    canvas.addEventListener('contextmenu', (e) => e.preventDefault(), false);
    canvas.addEventListener('mouseout',  mouseOnly(this.onMouseOut.bind(this)),  false);
    canvas.addEventListener('mouseover', mouseOnly(this.onMouseOver.bind(this)), false);
    canvas.addEventListener('mousemove', mouseOnly(Utils.throttle(this.onMouseMove.bind(this), 16.66)), false);

    // [HOTFIX] Prevent Three.js WebXRManager from running heavy raycasts on hover
    canvas.addEventListener('pointerover', (e) => {
      e.stopPropagation();
      // Safari/iPad doesn't fire compat mouseover for Apple Pencil hover entry, so
      // _focusGui (set by onMouseOut when pen left) would never clear via onMouseOver.
      // Clear it here on pen re-entry so sculpting can resume after the pen returns.
      if (e.pointerType === 'pen') this._focusGui = false;
    }, true);

    // Apple Pencil Touch Events fallback.
    //
    // Safari/iPadOS suppresses pointerdown (and all subsequent pointer events) for
    // some Apple Pencil hover→touch transitions, causing every N-th stroke to be
    // silently ignored. Touch Events run through a completely separate pipeline and
    // are not affected by this suppression. We use them here as a fallback: if the
    // first touchmove of a stylus stroke arrives while action is still NOTHING (i.e.
    // pointerdown was never dispatched), we synthesise the stroke start ourselves.
    //
    // Guard: check _action === SCULPT_EDIT in touchmove rather than touchstart, so
    // we don't race against the pointer event that may still arrive a frame later.
    let _touchFallbackPending = null; // {x,y,force} saved at touchstart
    let _touchFallbackActive  = false;

    canvas.addEventListener('touchstart', (e) => {
      for (const touch of e.changedTouches) {
        if (touch.touchType !== 'stylus') continue;
        _touchFallbackPending = { x: touch.clientX, y: touch.clientY, force: touch.force };
        // Only reset the "pointer events handled this" flag if a stroke hasn't already
        // started. On some iPadOS versions touchstart arrives AFTER pointerdown — if we
        // unconditionally reset here, the touch fallback sees ptrHandled:false and fires
        // a second onMouseDown, producing double extrudes/operations.
        if (this._action !== Enums.Action.SCULPT_EDIT) {
          this._ptrDownHandledThisTouch = false;
          if (window.screenLog) window.screenLog(`[dbl] touchstart stylus — ptrHandled→false (not sculpting)`, '#89dceb');
        } else {
          if (window.screenLog) window.screenLog(`[dbl] touchstart stylus — ptrHandled kept true (already sculpting)`, '#a6e3a1');
        }
      }
    }, { passive: true });

    canvas.addEventListener('touchmove', (e) => {
      for (const touch of e.changedTouches) {
        if (touch.touchType !== 'stylus') continue;

        if (_touchFallbackPending && !_touchFallbackActive) {
          // _ptrDownHandledThisTouch is set by onPointer when a real pointerdown
          // passes the bounce debounce. If it's still false by the time the first
          // touchmove arrives, the pointer events pipeline missed this stroke start.
          if (window.screenLog) window.screenLog(`[dbl] touchmove fallback check — ptrHandled:${this._ptrDownHandledThisTouch} action:${this._action}`, '#cba6f7');
          if (!this._ptrDownHandledThisTouch) {
            _touchFallbackActive = true;
            const pending = _touchFallbackPending;
            // Force-end any stuck previous stroke before starting this one.
            if (this._action === Enums.Action.SCULPT_EDIT && !this._vrSculpting)
              this.onDeviceUp();
            this._lastPenDownMs = performance.now();
            this._focusGui = false;
            const synthDown = {
              which: 1, pointerType: 'pen',
              clientX: pending.x, clientY: pending.y,
              pressure: pending.force || 0.5,
              stopPropagation: () => {}, preventDefault: () => {}
            };
            if (window.screenLog) window.screenLog(`[dbl] touchmove fallback FIRING onMouseDown`, '#f38ba8');
            if (window._ipadStylusSculpt !== false) this.onMouseDown(synthDown);
          }
          _touchFallbackPending = null;
        }

        if (_touchFallbackActive) {
          e.preventDefault();
          this._lastPenMoveMs = performance.now();
          const synthMove = {
            pointerType: 'pen',
            clientX: touch.clientX, clientY: touch.clientY,
            pressure: touch.force || 0.5,
            stopPropagation: () => {}, preventDefault: () => {}
          };
          if (window._ipadStylusSculpt !== false) this.onMouseMove(synthMove);
        }
      }
    }, { passive: false });

    const cbTouchEndCancel = (e) => {
      for (const touch of e.changedTouches) {
        if (touch.touchType !== 'stylus') continue;
        _touchFallbackPending = null;
        if (!_touchFallbackActive) continue;
        _touchFallbackActive = false;
        e.preventDefault();
        const synthUp = {
          which: 1, pointerType: 'pen',
          clientX: touch.clientX, clientY: touch.clientY,
          pressure: 0,
          stopPropagation: () => {}, preventDefault: () => {}
        };
        this.onMouseUp(synthUp);
      }
    };
    canvas.addEventListener('touchend',    cbTouchEndCancel, { passive: false });
    canvas.addEventListener('touchcancel', cbTouchEndCancel, { passive: false });


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
    // iPadOS Safari dispatches each pen PointerEvent TWICE — two different objects
    // with identical data (same pointerId, timeStamp, pressure, position).
    // Use a Map keyed by (type+pointerId+roundedTimestamp) to suppress duplicates
    // that arrive within 50ms, even if other events land in between.
    // Also catch same-object re-routing via WeakSet (belt-and-suspenders).
    if (this._handledPtrEvents.has(event)) {
      return;
    }
    // Include rounded pressure so hover events (pressure=0) don't collide with
    // touch events (pressure>0) that Safari fires at the same timestamp on pen down.
    const ptrKey = `${event.type}-${event.pointerId}-${Math.round(event.timeStamp)}-${Math.round(event.pressure * 1000)}`;
    const now = performance.now();
    const seenAt = this._seenPtrKeys.get(ptrKey);
    // Never dedup pointerup/pointercancel — missing them leaves stale entries in _fingerPointers
    const canDedup = event.type !== 'pointerup' && event.type !== 'pointercancel';
    if (canDedup && seenAt !== undefined && (now - seenAt) < 50) {
      return;
    }
    this._seenPtrKeys.set(ptrKey, now);
    this._handledPtrEvents.add(event);
    // Prune old entries to prevent unbounded growth
    if (this._seenPtrKeys.size > 50) {
      const cutoff = now - 200;
      for (const [k, t] of this._seenPtrKeys) { if (t < cutoff) this._seenPtrKeys.delete(k); }
    }

    Tablet.pressure = event.pressure;

    if (event.pointerType === 'pen') {
      if (this._fingerPointers.size > 0 && event.pressure < 0.05) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      if (event.type === 'pointerdown') {
        // Debounce: reject any pen pointerdown that arrives within 300ms of the
        // previous accepted one. This catches:
        //   - True simultaneous duplicates (0ms apart)
        //   - Pen-tip bounce sequences (pointerdown→pointerup→pointerdown in <5ms)
        //     which reset _action to NOTHING and bypass the onDeviceDown guard.
        //   - The synthesis→real pointerdown pair on iPadOS: Safari delivers a
        //     pressure>0 pointermove before the real pointerdown (15–80ms later).
        //     We synthesise a stroke-start from the pressure crossing; the real
        //     pointerdown arriving 15–80ms later must be treated as a duplicate,
        //     otherwise it force-ends and restarts the stroke (double extrude, double
        //     collapse, etc). 300ms matches the SculptManager single-action debounce
        //     and is safe because intentional rapid re-presses are > 300ms apart.
        const msSinceLastDown = performance.now() - (this._lastPenDownMs || 0);
        if (window.screenLog) window.screenLog(`[dbl] pen pointerdown ms:${Math.round(msSinceLastDown)} ptrHandled:${this._ptrDownHandledThisTouch} action:${this._action}`, '#cba6f7');
        if (msSinceLastDown < 300) {
          if (window.screenLog) window.screenLog(`[dbl] pen pointerdown DEBOUNCED (${Math.round(msSinceLastDown)}ms<300)`, '#f9e2af');
          return;
        }
        this._lastPenDownMs = performance.now();
        this._ptrDownHandledThisTouch = true; // tell touch fallback pointer events are live
        if (window.screenLog) window.screenLog(`[dbl] pen pointerdown ACCEPTED — ptrHandled→true`, '#a6e3a1');
        // Safety: if the previous stroke is still marked active (pointerup was suppressed
        // and more than 300ms have passed), end it cleanly so the new stroke can start.
        if (this._action === Enums.Action.SCULPT_EDIT && !this._vrSculpting) {
          if (window.screenLog && this._sculptManager?.getToolIndex?.() === Enums.Tools.CUT_TOOL)
            window.screenLog(`[Cut] pointerdown force-ending active stroke`, '#f38ba8');
          this.onDeviceUp();
        }
        // Safety: if the gesture engine is stuck (e.g. a finger pointerup was
        // dropped by the OS), force-reset it so the pen can sculpt normally.
        if (this._gestureActive || this._fingerPointers.size > 0) {
          this._fingerPointers.clear();
          this._peakFingerCount = 0;
          this._tapSeqStartTime = 0;
          if (this._gestureActive) {
            this._gestureActive = false;
            this.onDeviceUp();
          }
        }
        if (window._ipadStylusSculpt !== false) this.onMouseDown(event);
        if (window._ipadStylusView)             this._onTouchDown(event);
      } else if (event.type === 'pointermove') {
        this._lastPenMoveMs = performance.now();

        if (event.pressure === 0) {
          const rect = this._canvas.getBoundingClientRect();
          this._penHoverMouseX = this._pixelRatio * (event.clientX - rect.left);
          this._penHoverMouseY = this._pixelRatio * (event.clientY - rect.top);
        }

        // Safari on iPadOS sometimes skips `pointerdown` when the pen transitions
        // from hover to touch, delivering a pointermove with pressure > 0 instead.
        // Detect the pressure 0→positive crossing and synthesise the stroke start.
        const PRESSURE_THRESHOLD = 0.02;
        const prevPressure = this._lastPenPressure || 0;
        this._lastPenPressure = event.pressure;
        if (event.pressure >= PRESSURE_THRESHOLD && prevPressure < PRESSURE_THRESHOLD
            && this._action !== Enums.Action.SCULPT_EDIT) {
          // Treat this like a real pointerdown: set the bounce timestamp so any
          // real pointerdown that arrives late is ignored as a duplicate.
          // Also set _ptrDownHandledThisTouch so the touchmove fallback knows the
          // pointer-events pipeline handled this stroke start and doesn't fire again.
          if (window.screenLog && this._sculptManager?.getToolIndex?.() === Enums.Tools.CUT_TOOL)
            window.screenLog(`[Cut] pressure-synth down p:${event.pressure.toFixed(3)}`, '#cba6f7');
          this._lastPenDownMs = performance.now();
          this._ptrDownHandledThisTouch = true;
          if (window.screenLog) window.screenLog(`[dbl] pressure-synth FIRING — ptrHandled→true`, '#a6e3a1');
          // Plain object with the fields onMouseDown/onDeviceDown actually read.
          const synthDown = {
            which: 1, pointerType: 'pen',
            clientX: event.clientX, clientY: event.clientY,
            pressure: event.pressure,
            stopPropagation: () => {}, preventDefault: () => {}
          };
          if (window._ipadStylusSculpt !== false) this.onMouseDown(synthDown);
          if (window._ipadStylusView)             this._onTouchDown(synthDown);
        }

        if (window._ipadStylusSculpt !== false) this.onMouseMove(event);
        if (window._ipadStylusView)             this._onTouchMove(event);
      } else if (event.type === 'pointerup' || event.type === 'pointercancel') {
        this._lastPenPressure = 0; // reset so next stroke's hover reads as pressure=0
        if (window._ipadStylusSculpt !== false) this.onMouseUp(event);
        if (window._ipadStylusView)             this._onTouchUp(event);
      }

    } else if (event.pointerType === 'touch') {
      // Prevent Safari from generating synthetic MouseEvents from touch, which
      // would bypass the finger/stylus routing flags and land in onMouseDown.
      event.preventDefault();
      if (event.type === 'pointerdown') {
        if (window._ipadFingerView   !== false) this._onTouchDown(event);
        // Finger sculpt: DON'T start the sculpt immediately. Defer it so a quickly
        // following 2nd finger (camera gesture) or a quick tap can cancel it before
        // any geometry changes — otherwise the 1st of two fingers misfires a
        // sculpt/extrude. A 2nd finger already down means this is camera, not sculpt.
        if (window._ipadFingerSculpt) {
          if (this._fingerPointers.size >= 2) this._cancelDeferredSculpt();
          else                                this._scheduleDeferredSculpt(event.clientX, event.clientY);
        }
      } else if (event.type === 'pointermove') {
        if (window._ipadFingerView   !== false) this._onTouchMove(event);
        if (window._ipadFingerSculpt)           this.onMouseMove(event);
      } else if (event.type === 'pointerup' || event.type === 'pointercancel') {
        // onMouseUp FIRST: it ends any finger sculpt and resets _action to NOTHING.
        // _onTouchUp runs AFTER so its camera decision (e.g. the 2→1 rotate, which
        // sets _action) isn't immediately clobbered by onDeviceUp's reset.
        if (window._ipadFingerSculpt)           this.onMouseUp(event);
        if (window._ipadFingerView   !== false) this._onTouchUp(event);
      }
    }
  }

  ////////////////////////////
  // TOUCH GESTURE ENGINE
  // Raw Pointer Events replacement for Hammer.js.
  // Finger pointers only — pen is handled separately in onPointer().
  ////////////////////////////

  _onTouchDown(e) {
    // Stale-palm guard: a touch arriving while the PEN is actively sculpting would
    // add itself to _fingerPointers and block subsequent pen moves. Only reject when
    // Finger Sculpt is OFF (so any active SCULPT_EDIT must be pen-driven). With Finger
    // Sculpt ON a 2nd finger is legitimate (it switches to a camera gesture), so allow it.
    if (this._action === Enums.Action.SCULPT_EDIT && e.pointerType === 'touch' && !window._ipadFingerSculpt) {
      return;
    }
    try { this._canvas.setPointerCapture(e.pointerId); } catch (_) {}
    this._fingerPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this._focusGui = false;
    const n = this._fingerPointers.size;
    if (n === 1) {
      // First finger of a new sequence — start the tap clock
      this._tapSeqStartTime  = performance.now();
      this._peakFingerCount  = 1;
    } else if (n > this._peakFingerCount) {
      // Finger count just increased — record center at this new peak
      this._peakFingerCount      = n;
      this._tapSeqPeakCenter     = this._fingerCenter();
      this._tapSeqPeakPinchDist  = this._fingerPinchDist();
    }
    const center = this._fingerCenter();
    const wasActive = this._gestureActive;
    if (wasActive) {
      // Extra finger added mid-gesture — end it, then restart with new count.
      // Clear _gestureActive BEFORE calling _startGesture so n=1 re-entries don't
      // inherit wasActive=true (which would route a fresh single finger to camera pan).
      this._gestureActive = false;
      this.onDeviceUp();
    }
    this._startGesture(n, center, wasActive);
  }

  _onTouchMove(e) {
    if (!this._fingerPointers.has(e.pointerId)) return;
    this._fingerPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!this._gestureActive) return;

    const n = this._fingerPointers.size;
    const center = this._fingerCenter();

    if (n === 2) {
      // Direct 2-finger pan + zoom — bypasses onDeviceMove/Wheel to avoid
      // camera.start() jitter from frequent zoom-direction changes during pan.
      let dirty = false;

      // ── Pan ──────────────────────────────────────────────────────────────
      // dx/dy are in CSS pixels. _canvasHeight is physical (clientHeight×DPR),
      // so divide out the DPR to get a CSS-height-based speed that is consistent
      // regardless of device pixel ratio. The ×2 tuning factor brings touch pan
      // up to roughly 1:1 finger tracking (matches Nomad-style feel).
      const dx = center.x - this._gesturePanLastX;
      const dy = center.y - this._gesturePanLastY;
      this._gesturePanLastX = center.x;
      this._gesturePanLastY = center.y;
      if (dx !== 0 || dy !== 0) {
        const cssHeight = this._canvasHeight / this.getPixelRatio();
        const sf = (this._cameraSpeed * 2) / cssHeight;
        this._camera.translate(dx * sf, dy * sf);
        dirty = true;
      }

      // ── Zoom ─────────────────────────────────────────────────────────────
      // EMA-smooth the raw pinch distance to absorb the transient imbalance that
      // occurs when alternating finger events arrive: finger A updates → distance
      // spikes briefly → finger B catches up → distance normalises. Without
      // smoothing this produces oscillating false-zoom during any pure pan.
      // alpha=0.2 is deliberately low so a single out-of-order event barely moves
      // the smoothed value, but a sustained deliberate pinch registers quickly.
      if (this._gesturePinchInitDist > 0) {
        const rawDist = this._fingerPinchDist();
        const alpha   = 0.2;
        this._gesturePinchSmoothed =
          this._gesturePinchSmoothed * (1 - alpha) + rawDist * alpha;
        const distChange = this._gesturePinchSmoothed - this._gesturePinchLastDist;
        this._gesturePinchLastDist = this._gesturePinchSmoothed;
        if (Math.abs(distChange) >= 0.5) {
          const zoom = (distChange / this._gesturePinchInitDist) * 25 * 0.015;
          this._camera.zoom(zoom);
          dirty = true;
        }
      }

      if (dirty) {
        Multimesh.RENDER_HINT = Multimesh.CAMERA;
        this.render();
      }
      return;
    }

    // Deferred finger-sculpt: a real drag (>6px from the landing point) commits it
    // immediately so the stroke feels responsive; smaller jitter keeps waiting for
    // the timer / a possible 2nd finger.
    if (this._pendingSculpt) {
      const ddx = center.x - this._pendingSculpt.x;
      const ddy = center.y - this._pendingSculpt.y;
      if (ddx * ddx + ddy * ddy > 36) this._commitDeferredSculpt();
      else return;
    }

    const evProxy = this._eventProxy;
    evProxy.clientX = center.x;
    evProxy.clientY = center.y;
    this.onDeviceMove(evProxy);
  }

  _onTouchUp(e) {
    if (!this._fingerPointers.has(e.pointerId)) return;
    // Snapshot before removing so double-tap check sees the right count
    const center = this._fingerCenter();
    const pinchDist = this._fingerPinchDist(); // capture BEFORE delete (needs ≥2 fingers)
    const n = this._fingerPointers.size;
    this._fingerPointers.delete(e.pointerId);
    const remaining = this._fingerPointers.size;

    if (remaining === 0) {
      // Finger lifted before the safe window elapsed and no 2nd finger arrived → a
      // quick tap. Cancel the deferred sculpt so a tap never edits (matches the
      // finger-off model and avoids zero-height extrude/inset on a stray tap).
      this._cancelDeferredSculpt();
      if (this._gestureActive) {
        this._gestureActive = false;
        this.onDeviceUp();
      }
      // Multi-finger tap detection: 2 fingers = undo, 3 fingers = redo.
      // Fingers lift one at a time, so by the time remaining===0 the local `n`
      // is always 1. We use _peakFingerCount (max simultaneous fingers) and
      // _tapSeqStartTime / _tapSeqPeakCenter which are NOT reset on mid-gesture
      // restarts — only here when all fingers are up.
      // A tap = peak ≥ 2, total sequence < 250 ms, peak-center drift < 30 px.
      const peak = this._peakFingerCount;
      const tapDuration = performance.now() - this._tapSeqStartTime;
      // Compare multi-finger centers: where fingers were when peak started vs.
      // where they were when the first finger lifted. Both are averages of the
      // same set of fingers so finger-separation doesn't inflate the distance.
      const tapDrift    = Math.hypot(
        this._tapSeqLiftCenter.x - this._tapSeqPeakCenter.x,
        this._tapSeqLiftCenter.y - this._tapSeqPeakCenter.y
      );
      // Reset sequence state for the next gesture
      this._peakFingerCount = 0;
      this._tapSeqStartTime = 0;
      // Allow more time for 3-finger taps — placing 3 fingers takes longer.
      const tapWindow = (peak >= 3) ? 450 : 300;
      // A pinch/zoom gesture keeps finger-center stable (low drift) but spreads fingers.
      // Gate on pinch delta so a brief zoom doesn't misfire as undo.
      const pinchDelta = Math.abs(this._tapSeqLiftPinchDist - this._tapSeqPeakPinchDist);
      if (peak >= 2 && tapDuration < tapWindow && tapDrift < 40 && pinchDelta < 20) {
        if (peak === 2 && this._stateManager) {
          this.undo(); // canonical path — also re-renders + refreshes the GUI
          return; // don't also fall through to the double-tap reset-view path
        } else if (peak >= 3 && this._stateManager) {
          this.redo();
          return;
        }
      }
      this._checkDoubleTap(center, n);
    } else {
      // One finger lifted but others remain — restart gesture.
      // If this is the first finger off from the peak count, snapshot the
      // multi-finger center NOW (before deletion makes it single-finger).
      // This gives us an apples-to-apples comparison for the drift check.
      if (n === this._peakFingerCount) {
        this._tapSeqLiftCenter    = { x: center.x, y: center.y };
        this._tapSeqLiftPinchDist = pinchDist; // captured before delete, while both fingers still in map
      }
      if (this._gestureActive) this.onDeviceUp();
      if (remaining === 1) {
        // Nomad-style camera scheme: dropping from 2+ fingers down to 1 always
        // starts a CAMERA ROTATE — a reliable way to orbit even when zoomed in
        // with no empty space to grab, and regardless of the Finger Sculpt pref
        // or active tool. (Forced explicitly rather than via _startGesture's
        // ambiguous which=MOUSE_RIGHT mapping.)
        const c = this._fingerCenter();
        this._gestureActive      = true;
        this._gestureStartTime   = performance.now();
        this._gestureStartCenter = { x: c.x, y: c.y };
        const ev = this._eventProxy;
        ev.clientX = c.x;
        ev.clientY = c.y;
        this.setMousePosition(ev);
        this._action = Enums.Action.CAMERA_ROTATE;
        this._camera.start(this._mouseX, this._mouseY);
        this._lastMouseX = this._mouseX;
        this._lastMouseY = this._mouseY;
      } else {
        this._startGesture(remaining, this._fingerCenter(), true);
      }
    }
  }

  _startGesture(n, center, wasActive) {
    this._gestureActive = true;
    this._gestureStartTime   = performance.now();
    this._gestureStartCenter = { x: center.x, y: center.y };

    if (n === 2) {
      // 2-finger: handle pan+zoom directly without routing through the
      // device-action state machine. This avoids camera.start() being called
      // during pinch-while-panning, which was causing jitter.
      this._action = Enums.Action.CAMERA_PAN;
      this._focusGui = false;
      this._gesturePanLastX = center.x;
      this._gesturePanLastY = center.y;
      const d = this._fingerPinchDist();
      this._gesturePinchInitDist = d;
      this._gesturePinchLastDist = d;
      this._gesturePinchSmoothed = d; // EMA seed = raw dist at gesture start
      return;
    }

    const evProxy = this._eventProxy;
    evProxy.clientX = center.x;
    evProxy.clientY = center.y;
    // 1 finger (fresh)      → MOUSE_LEFT   = rotate (or forced RIGHT if finger sculpt disabled)
    // 1 finger (after 2+)   → MOUSE_RIGHT  = pan
    // 3+ fingers            → MOUSE_RIGHT  = pan
    if (n === 1 && wasActive)              evProxy.which = MOUSE_RIGHT;
    else if (n >= 3)                       evProxy.which = MOUSE_RIGHT;
    else if (!window._ipadFingerSculpt)    evProxy.which = MOUSE_RIGHT; // fingers view-only: always rotate, never sculpt
    else                                   evProxy.which = MOUSE_LEFT;
    if (window.screenLog) window.screenLog(`[gesture] n=${n} wasActive=${wasActive} which=${evProxy.which}`, 'yellow');

    // which===MOUSE_LEFT only happens for a fresh single finger with Finger Sculpt
    // ON — and the sculpt is driven by the deferred onMouse path (see the touch
    // dispatch). _onTouch* only handles the camera here, so don't also start a
    // sculpt. Camera actions (MOUSE_RIGHT) go through onDeviceDown as normal.
    if (evProxy.which === MOUSE_LEFT) return;
    this.onDeviceDown(evProxy);
  }

  // ── Deferred finger-sculpt (disambiguation "safe window") ──────────────────
  _scheduleDeferredSculpt(x, y) {
    this._cancelDeferredSculpt();
    this._pendingSculpt = { x, y };
    this._pendingSculptTimer = window.setTimeout(() => this._commitDeferredSculpt(), 90);
  }

  _commitDeferredSculpt() {
    if (!this._pendingSculpt) return;
    const p = this._pendingSculpt;
    this._cancelDeferredSculpt();
    // Start the sculpt at the landing point via the device path (single finger
    // confirmed — no 2nd finger arrived, and either the hold window elapsed or the
    // finger moved past the drag threshold).
    const ev = this._eventProxy;
    ev.clientX = p.x;
    ev.clientY = p.y;
    ev.which = MOUSE_LEFT;
    ev.pointerType = 'touch';
    ev.shiftKey = !!this._shiftKey;
    this.onDeviceDown(ev);
  }

  _cancelDeferredSculpt() {
    if (this._pendingSculptTimer) { clearTimeout(this._pendingSculptTimer); this._pendingSculptTimer = 0; }
    this._pendingSculpt = null;
  }

  _fingerCenter() {
    let cx = 0, cy = 0;
    for (const p of this._fingerPointers.values()) { cx += p.x; cy += p.y; }
    const n = this._fingerPointers.size;
    return n ? { x: cx / n, y: cy / n } : { x: 0, y: 0 };
  }

  _fingerPinchDist() {
    if (this._fingerPointers.size < 2) return 0;
    const [a, b] = this._fingerPointers.values();
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  _checkDoubleTap(center, n) {
    const now = performance.now();
    const t = this._doubleTapTrack;
    const dt = now - t.time;
    const dist = Math.hypot(center.x - t.x, center.y - t.y);

    if (dt < 450 && dist < 50 && n === t.n) {
      t.count++;
      if (t.count >= 2) {
        // Reset so a third tap doesn't re-trigger
        t.count = 0;
        t.time = 0;
        if (n === 1)      this.onDoubleTap({ clientX: center.x, clientY: center.y });
        else if (n >= 2)  this.onDoubleTap2Fingers();
        return;
      }
    } else {
      t.count = 1;
    }
    t.time = now;
    t.x = center.x;
    t.y = center.y;
    t.n = n;
  }

  stopAndPrevent(event) {
    event.stopPropagation();
    event.preventDefault();
  }

  onContextLost() {
    (window._vrAlert || window.alert)('Oops... WebGL context lost.');
  }

  onContextRestored() {
    (window._vrAlert || window.alert)('Wow... Context is restored.');
  }

  ////////////////
  // KEY EVENTS
  ////////////////
  onKeyDown(e) {
    this._shiftKey = e.shiftKey;
    this._altKey = e.altKey;

    // TYPING WINS. Every shortcut below this line — and everything callFunc fans out to — is
    // bound to a bare key, so a focused text field could not receive its own characters:
    // entering an IP address in the Nomad Link panel toggled the animation panel on 'n' and
    // the main menu on 'm'. Modifiers are still recorded above, since a field being focused
    // does not stop the user holding shift.
    const _typing = Utils.isTypingTarget(e);
    if (_typing) return;

    // The active tool gets first refusal. A tool with a modal state of its own — the Bones
    // chain, where Escape/Enter ends the chain and then leaves drawing — needs the key, and
    // routing that through the GUI would split the tool's state across two files. Returning
    // false (or having no handler at all) leaves every shortcut below untouched.
    const _tool = this._sculptManager?.getCurrentTool?.();
    if (_tool?.onKeyDown?.(e)) { e.preventDefault(); return; }

    // 'O' toggles orthographic/perspective. Rigging is done from flat front and side views,
    // and reaching into the Rendering menu for every switch is the wrong amount of friction
    // for something you flip constantly. Goes through setProjectionType so the camera, the
    // Three projection and the picking matrices all stay in step.
    if ((e.key === 'o' || e.key === 'O') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const cam = this._camera;
      const toOrtho = !cam.isOrthographic();
      cam.setProjectionType(toOrtho ? Enums.Projection.ORTHOGRAPHIC : Enums.Projection.PERSPECTIVE);
      // Keep the Rendering menu's own dropdown honest about what just happened, wherever it
      // happens to be mounted (sidebar, main menu, a torn-off panel).
      try {
        for (const sel of document.querySelectorAll('#mm-cam-proj')) {
          sel.value = String(cam.getProjectionType());
        }
      } catch (_) {}
      if (window.screenLog) window.screenLog('Camera: ' + (toOrtho ? 'Orthographic' : 'Perspective'), 'cyan');
      this.render();
      e.preventDefault();
      return;
    }

    // Timeline key clipboard (desktop): Ctrl/Cmd+C copy selected key(s), Ctrl/Cmd+V paste
    // at the playhead, +Shift = paste-linked (reserved for frame keys). Skipped while
    // typing in a field so it doesn't hijack normal text copy/paste.
    if (!_typing && (e.ctrlKey || e.metaKey)) {
      const _tl = this._gui?._ctrlTimeline;
      const _kc = (e.key || '').toLowerCase();
      if (_tl && _kc === 'c' && window._animSelectedKeys?.length) { e.preventDefault(); _tl.copySelectedKeys(); return; }
      if (_tl && _kc === 'x' && window._animSelectedKeys?.length) { e.preventDefault(); _tl.cutSelectedKeys(); return; }
      if (_tl && _kc === 'v' && window._animKeyClipboard?.keys?.length) { e.preventDefault(); _tl.pasteKeys(e.shiftKey); return; }
    }
    // Delete/Backspace removes the selected timeline key(s) when the timeline is open and
    // hovered — mirrors the KeyAction.DELETE gate, but routes to the complete delete (all
    // key types incl. shape layers). No selection → fall through to normal mesh handling.
    if (!_typing && (e.key === 'Delete' || e.key === 'Backspace')) {
      const _tl = this._gui?._ctrlTimeline;
      if (_tl && _tl._visible && _tl.isMouseOver() && window._animSelectedKeys?.length) {
        e.preventDefault(); _tl.deleteSelectedKeys(); return;
      }
    }

    // [SPECTATOR MATRIX] Cycle Modes
    if (e.which === 68) { // 'D'
      this._spectatorMode = (this._spectatorMode + 1) % 4;
      const modeNames = ["VR View (Mirror)", "DESKTOP", "TRACKED", "STATIONARY (Desktop 6DOF)"];
      if (window.screenLog) window.screenLog(`Spectator Mode: ${modeNames[this._spectatorMode]}`, "lime");
      this.render();
    }

    // [CALIBRATION] Toggle Calibration Mode
    if (e.which === 67 && !e.ctrlKey && !e.metaKey) { // 'C' (bare — Ctrl+C is key-copy)
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
    this._altKey = e.altKey;
    if (Utils.isTypingTarget(e)) return;
    this._gui.callFunc('onKeyUp', e);
  }

  onDoubleTap(e) {
    if (this._focusGui) {
      return;
    }

    var evProxy = this._eventProxy;

    // Handle both Hammer.js (e.center) and native dblclick (e.clientX)
    evProxy.clientX = e.center ? e.center.x : e.clientX;
    evProxy.clientY = e.center ? e.center.y : e.clientY;

    if (window._debugTapStats) {
      console.log(`[SculptGL.js:onDoubleTap] Fired! Hammer=${!!e.center} X=${evProxy.clientX} Y=${evProxy.clientY}`);
    }

    if (evProxy.clientX === undefined) return; // Prevent crash if completely blank event

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

  resetCameraMeshes(meshes) {
    if (this._isImmersiveAR || (this.isInVR && this.isInVR())) return;
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
    
    if (lower.includes('.sgl') || lower.includes('.sxr')) return 'sgl';
    if (lower.includes('.obj')) return 'obj';
    if (lower.includes('.stl')) return 'stl';
    if (lower.includes('.ply')) return 'ply';
    if (lower.includes('.glb')) return 'glb';
    
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

    const age = performance.now() - (this._lastPenDownMs || 0);
    const isCompatDup = event.constructor === MouseEvent && age < 50;
    if (isCompatDup) return;

    this._gui.callFunc('onMouseDown', event);
    this.onDeviceDown(event);
  }

  onMouseMove(event) {
    event.stopPropagation();
    event.preventDefault();

    // Suppress mouse moves while a finger gesture is active, but always let the pen
    // through — a stray palm touch must not freeze an active stylus stroke.
    if (this._fingerPointers.size > 0 && event.pointerType !== 'pen') {
      return;
    }

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

    const currentMesh = this.getMesh();
    if (window._animAutoKey && window._animationRegistry && currentMesh && this._action === Enums.Action.SCULPT_EDIT) {
      const sm = this._sculptManager;
      // Grab is a transform tool (moves the object matrix, stores _undoMatrix) just
      // like the gizmo — so it autokeys a transform key too. The VR path already
      // treats both TRANSFORM_VR and GRAB as a move.
      const isMove = sm && (sm._toolIndex === Enums.Tools.TRANSFORM || sm._toolIndex === Enums.Tools.GRAB);
      const fps = window._animFPS || 24;
      const targetTime = Math.round((window._animCurrentTime !== undefined ? window._animCurrentTime : 0) * fps) / fps;
      window._animCurrentTime = targetTime;
      window._animationRegistry.globalPlaybackTime = targetTime;
      const meshId = currentMesh.getID();

      if (isMove) {
        // Transform AutoKey
        if (!window._animationRegistry.tracks.has(meshId)) {
          window._animationRegistry.tracks.set(meshId, {
            times: [], positions: [], quaternions: [], scales: [],
            shapeTimes: [], shapes: [], playbackTime: 0, lastUpdate: performance.now()
          });
        }
        const track = window._animationRegistry.tracks.get(meshId);

        // Frame 0 fallback
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

        window._animationRegistry.addTransformKey(currentMesh, targetTime);
        
        const newData = {
          pos: [...pos],
          q: [q[0], q[1], q[2], q[3]],
          s: [sx, sy, sz]
        };

        if (this._stateManager) {
          this._stateManager.pushStateCustom(
            () => { // UNDO
              const tr = window._animationRegistry.tracks.get(meshId);
              if (!tr) return;
              if (wasUpdate) {
                let idx = 0;
                while (idx < tr.times.length && tr.times[idx] < targetTime) idx++;
                if (idx < tr.times.length && Math.abs(tr.times[idx] - targetTime) < 0.005) {
                  tr.positions.splice(idx*3, 3, ...oldData.pos);
                  tr.quaternions.splice(idx*4, 4, ...oldData.q);
                  tr.scales.splice(idx*3, 3, ...oldData.s);
                }
              } else {
                window._animationRegistry.deleteTransformKey(currentMesh, targetTime);
              }
              window._animationRegistry.update(currentMesh, true);
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
            }
          );
        }
      } else if (window._animKeyMode === 'shape' || window._animKeyMode === 0) {
        // Shape AutoKey
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
        
        if (this._stateManager) {
          this._stateManager.pushStateCustom(
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
    // In VR mirror mode, mousewheel zooms the mirror FOV instead of the desktop camera.
    if (this._renderer?.xr?.isPresenting && this._spectatorViewMode === 1) {
      this._mirrorFovScale = Math.max(0.1, Math.min(1.0, (this._mirrorFovScale ?? 0.5) - dir * 0.05));
      return;
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
    const rect = this._canvas.getBoundingClientRect();
    this._mouseX = this._pixelRatio * (event.clientX - rect.left);
    this._mouseY = this._pixelRatio * (event.clientY - rect.top);
    if (window._debugMouse) {
      console.log("Mouse:", this._mouseX, this._mouseY, "Rect:", rect.left, rect.top);
    }
  }

  onDeviceDown(event) {
    if (this._focusGui) {
      return;
    }

    // Prevent mouse-down from interfering with active VR stroke
    if (this._vrSculpting) return;

    // Guard: prevent duplicate pen events from re-starting an active sculpt.
    // Calling _sculptManager.start() while a stroke is already active picks up
    // a stale/deformed picking state and can stamp on the wrong (back) face.
    var button = event.which;
    if (button === MOUSE_LEFT && this._action === Enums.Action.SCULPT_EDIT) {
      return;
    }

    this.setMousePosition(event);

    var mouseX = this._mouseX;
    var mouseY = this._mouseY;

    var canEdit = false;
    if (button === MOUSE_LEFT && this._sculptManager) {
      canEdit = this._sculptManager.start(event.shiftKey || this._shiftKey); // Support both event and global shift
    }

    // The cursor is hidden because a sculpt brush draws its own ring in its place. A tool
    // with no brush cursor (Bones) must keep the real one, or a drag that is aimed at a
    // point on screen loses the thing doing the aiming.
    if (button === MOUSE_LEFT && canEdit
        && this._sculptManager?.getCurrentTool?.()?.drawsOwnCursor?.() !== false)
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
    else if (button === MOUSE_RIGHT || (button === MOUSE_LEFT && !canEdit && (event.pointerType !== 'pen' || window._ipadStylusView)))
      this._action = Enums.Action.CAMERA_ROTATE;
    else if (button === MOUSE_LEFT && !canEdit && event.pointerType === 'pen')
      this._action = Enums.Action.NOTHING; // pen missed mesh — cursor tracks freely, no camera rotate
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
    if (this._focusGui) {
      return;
    }

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
        // NOTE: do NOT add 'layers' here. Requesting the XRLayers feature causes
        // Three.js to use XRProjectionLayer instead of XRWebGLLayer, which triggers
        // a ~5-second compositor setup delay on Samsung GalaxyXR / Adreno devices.
        // 'hand-tracking' → XRHand joint data (Quest / Galaxy XR grant silently; AVP
        // needs the user to grant + flip the Safari experimental flag). Required for the
        // hand-puppetry driver (#28) and the existing pinch/fist gesture path.
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

      await this.enterXR(session);
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
