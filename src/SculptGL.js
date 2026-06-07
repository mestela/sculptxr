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
    this._gesturePinchInitDist = 0; // finger distance at gesture start (scale reference)
    this._gesturePinchLastDist = 0; // finger distance last frame
    this._gesturePanLastX      = 0; // 2-finger pan: center position last frame
    this._gesturePanLastY      = 0;
    this._doubleTapTrack       = { time: 0, x: 0, y: 0, n: 0, count: 0 };
    this.handleXRInput = this.handleXRInput.bind(this); // Wire up VR input

    this._eventProxy = {};

    // Enable touch debug logging via URL parameter ?dbgTouch
    if (new URLSearchParams(window.location.search).has('dbgTouch'))
      window._dbgTouch = true;

    // NUCLEAR FIX: Expose instance globally to bypass scope hell
    window.sculptgl_instance = this;
    window.app = this; // Ensure 'app' is also set globally
    window.sculptgl = this; // Alias for user convenience
    this._referenceManager = new ReferenceManager(this);
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
    canvas.addEventListener('mouseout',  mouseOnly(this.onMouseOut.bind(this)),  false);
    canvas.addEventListener('mouseover', mouseOnly(this.onMouseOver.bind(this)), false);
    canvas.addEventListener('mousemove', mouseOnly(Utils.throttle(this.onMouseMove.bind(this), 16.66)), false);

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
    // iPadOS Safari dispatches each pen PointerEvent TWICE — two different objects
    // with identical data (same pointerId, timeStamp, pressure, position).
    // Use a Map keyed by (type+pointerId+roundedTimestamp) to suppress duplicates
    // that arrive within 50ms, even if other events land in between.
    // Also catch same-object re-routing via WeakSet (belt-and-suspenders).
    if (this._handledPtrEvents.has(event)) {
      if (window._dbgTouch && window.screenLog) window.screenLog(`[DEDUP same-obj] type=${event.type}`, 'red');
      return;
    }
    const ptrKey = `${event.type}-${event.pointerId}-${Math.round(event.timeStamp)}`;
    const now = performance.now();
    const seenAt = this._seenPtrKeys.get(ptrKey);
    if (seenAt !== undefined && (now - seenAt) < 50) {
      if (window._dbgTouch && window.screenLog) window.screenLog(`[DEDUP data-dup] type=${event.type} ts=${event.timeStamp.toFixed(3)} age=${(now-seenAt).toFixed(1)}ms`, 'red');
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
    if (window._dbgTouch === true && !(event.pointerType === 'pen' && event.pressure === 0)) console.log(`[ptr] type=${event.type} ptrType=${event.pointerType} pressure=${event.pressure.toFixed(3)} id=${event.pointerId} ts=${event.timeStamp.toFixed(3)}`);

    if (event.pointerType === 'pen') {
      if (this._fingerPointers.size > 0 && event.pressure < 0.05) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      if (event.type === 'pointerdown') {
        // Debounce: reject any pen pointerdown that arrives within 50ms of the
        // previous accepted one. Catches both true simultaneous duplicates (0ms apart)
        // AND pen-tip bounce sequences (pointerdown→pointerup→pointerdown in <5ms)
        // which reset _action to NOTHING and bypass the onDeviceDown guard.
        const msSinceLastDown = performance.now() - (this._lastPenDownMs || 0);
        if (msSinceLastDown < 50) {
          if (window._dbgTouch && window.screenLog)
            window.screenLog(`[pen↓ BOUNCE] blocked after ${msSinceLastDown.toFixed(1)}ms`, 'orange');
          return;
        }
        this._lastPenDownMs = performance.now();
        if (window._dbgTouch && window.screenLog) window.screenLog(`[pen↓] p=${event.pressure.toFixed(2)} x=${event.clientX.toFixed(0)} y=${event.clientY.toFixed(0)} ts=${event.timeStamp.toFixed(3)}`, 'cyan');
        this.onMouseDown(event);
      } else if (event.type === 'pointermove') { this._lastPenMoveMs = performance.now(); this.onMouseMove(event); }
        else if (event.type === 'pointerup')   { this.onMouseUp(event); }

    } else if (event.pointerType === 'touch') {
      if (event.type === 'pointerdown')                                      { this._onTouchDown(event); }
      else if (event.type === 'pointermove')                                 { this._onTouchMove(event); }
      else if (event.type === 'pointerup' || event.type === 'pointercancel') { this._onTouchUp(event); }
    }
  }

  ////////////////////////////
  // TOUCH GESTURE ENGINE
  // Raw Pointer Events replacement for Hammer.js.
  // Finger pointers only — pen is handled separately in onPointer().
  ////////////////////////////

  _onTouchDown(e) {
    try { this._canvas.setPointerCapture(e.pointerId); } catch (_) {}
    this._fingerPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this._focusGui = false;
    const n = this._fingerPointers.size;
    const center = this._fingerCenter();
    if (this._gestureActive) {
      // Extra finger added mid-gesture — restart with new count
      this.onDeviceUp();
    }
    this._startGesture(n, center, this._gestureActive);
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
      const dx = center.x - this._gesturePanLastX;
      const dy = center.y - this._gesturePanLastY;
      this._gesturePanLastX = center.x;
      this._gesturePanLastY = center.y;

      if (dx !== 0 || dy !== 0) {
        const sf = this.getSpeedFactor() * 2.5;
        if (window._dbgTouch === true) console.log(`[2finger pan] dx=${dx.toFixed(1)} dy=${dy.toFixed(1)} sf=${sf.toFixed(5)}`);
        this._camera.translate(dx * sf, dy * sf);
        Multimesh.RENDER_HINT = Multimesh.CAMERA;
        this.render();
      }

      if (this._gesturePinchInitDist > 0) {
        const dist = this._fingerPinchDist();
        const distChange = dist - this._gesturePinchLastDist;
        this._gesturePinchLastDist = dist;
        if (Math.abs(distChange) >= 3) {
          // Hammer formula: (scale - lastScale) * 25 * camera zoom factor 0.02
          const zoom = (distChange / this._gesturePinchInitDist) * 25 * 0.02;
          this._camera.zoom(zoom);
          Multimesh.RENDER_HINT = Multimesh.CAMERA;
          this.render();
        }
      }
      return;
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
    const n = this._fingerPointers.size;
    this._fingerPointers.delete(e.pointerId);
    const remaining = this._fingerPointers.size;

    if (remaining === 0) {
      if (this._gestureActive) {
        this._gestureActive = false;
        this.onDeviceUp();
      }
      this._checkDoubleTap(center, n);
    } else {
      // One finger lifted but others remain — restart gesture
      if (this._gestureActive) this.onDeviceUp();
      this._startGesture(remaining, this._fingerCenter(), true);
    }
  }

  _startGesture(n, center, wasActive) {
    this._gestureActive = true;

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
      return;
    }

    const evProxy = this._eventProxy;
    evProxy.clientX = center.x;
    evProxy.clientY = center.y;
    // 1 finger (fresh)      → MOUSE_LEFT   = rotate
    // 1 finger (after 2+)   → MOUSE_RIGHT  = pan
    // 3+ fingers            → MOUSE_RIGHT  = pan
    if (n === 1 && wasActive)   evProxy.which = MOUSE_RIGHT;
    else if (n >= 3)            evProxy.which = MOUSE_RIGHT;
    else                        evProxy.which = MOUSE_LEFT;
    this.onDeviceDown(evProxy);
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
    if (window._dbgTouch && window.screenLog) window.screenLog(`[mousedown] cls=${event.constructor.name} age=${age.toFixed(0)}ms BLOCKED=${isCompatDup}`, isCompatDup ? 'orange' : 'red');
    if (isCompatDup) return;

    this._gui.callFunc('onMouseDown', event);
    this.onDeviceDown(event);
  }

  onMouseMove(event) {
    event.stopPropagation();
    event.preventDefault();

    // Suppress mouse/pen-hover moves while a finger gesture is active.
    if (this._fingerPointers.size > 0) return;

    const moveAge = performance.now() - (this._lastPenMoveMs || 0);
    const isCompatMove = event.constructor === MouseEvent && moveAge < 50;
    // Only log mousemove when it's NOT a routine blocked hover dup — reduces noise
    if (window._dbgTouch === true && !(isCompatMove && this._fingerPointers.size === 0)) console.log(`[mousemove] cls=${event.constructor.name} penAge=${moveAge.toFixed(1)}ms fingers=${this._fingerPointers.size} BLOCKED=${isCompatMove || this._fingerPointers.size > 0}`);
    if (isCompatMove) return;

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
      const isMove = sm && (sm._toolIndex === Enums.Tools.TRANSFORM);
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
    if (this._focusGui)
      return;

    // Prevent mouse-down from interfering with active VR stroke
    if (this._vrSculpting) return;

    // Guard: prevent duplicate pen events from re-starting an active sculpt.
    // Calling _sculptManager.start() while a stroke is already active picks up
    // a stale/deformed picking state and can stamp on the wrong (back) face.
    var button = event.which;
    if (button === MOUSE_LEFT && this._action === Enums.Action.SCULPT_EDIT) {
      if (window._dbgTouch && window.screenLog)
        window.screenLog(`[deviceDown SKIP] left+SCULPT_EDIT already active`, 'orange');
      return;
    }

    this.setMousePosition(event);

    var mouseX = this._mouseX;
    var mouseY = this._mouseY;

    var canEdit = false;
    if (button === MOUSE_LEFT && this._sculptManager) {
      canEdit = this._sculptManager.start(event.shiftKey || this._shiftKey); // Support both event and global shift
    }

    if (window._dbgTouch && window.screenLog)
      window.screenLog(`[deviceDown] btn=${button} canEdit=${canEdit} x=${mouseX.toFixed(0)} y=${mouseY.toFixed(0)} cls=${event.constructor?.name} ptrType=${event.pointerType}`, canEdit ? 'lime' : 'yellow');

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
        // NOTE: do NOT add 'layers' here. Requesting the XRLayers feature causes
        // Three.js to use XRProjectionLayer instead of XRWebGLLayer, which triggers
        // a ~5-second compositor setup delay on Samsung GalaxyXR / Adreno devices.
        optionalFeatures: ['local-floor', 'bounded-floor']
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
