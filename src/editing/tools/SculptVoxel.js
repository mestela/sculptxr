import * as THREE from 'three';
import SculptBase from './SculptBase.js';
import GeometryWorker from '../../workers/GeometryWorker.js?worker';
import MeshStatic from '../../mesh/meshStatic/MeshStatic.js';
import Multimesh from '../../mesh/multiresolution/Multimesh.js';
import { vec3, mat4, quat } from 'gl-matrix';
import Utils from '../../misc/Utils.js';
import Primitives from '../../drawables/Primitives.js';
import Enums from '../../misc/Enums.js';
import Geometry from '../../math3d/Geometry.js';
import VoxelBounds from '../../drawables/VoxelBounds.js';

class SculptVoxel extends SculptBase {

  constructor(main) {
    super(main);

    this._identityMatrix = mat4.create(); // For un-shifted bounding boxes

    // Initialize Voxel Grid
    // Box size 100.0 (matches Utils.SCALE / Desktop Scale)
    // Resolution 64 (Better quality for larger space)
    // Initialize Voxel Worker
    // Box size 100.0 (matches Utils.SCALE / Desktop Scale)
    // Resolution 64 (Better quality for larger space)
    this._worker = new GeometryWorker();

    this._worker.onerror = (e) => {
      if (this._main && this._main.getSculptManager()) {
        this._main.getSculptManager()._isProcessingQuads = false;
      }
      window._topologyOpFailed = true;
      setTimeout(() => {
        window._topologyOpFailed = false;
        if (this._main && this._main.guiXR) this._main.guiXR._needsRedraw = true;
      }, 2000);
      if (this._main && this._main.guiXR) this._main.guiXR._needsRedraw = true;

      if (e.message) {
        console.error("Voxel Worker Error:", e);
        if (window.screenLog) window.screenLog(`Worker Error: ${e.message}`, "red");
      } else {
        console.warn("Voxel Worker Silent Error (ignored):", e);
      }
    };

    // Tool State
    this._mode = 0; // 0: Add, 1: Sub, 2: Inflate
    this._shape = 0; // 0: Sphere, 1: Cube
    this._alignToController = false; // World vs Controller alignment
    this._strength = 0.5;
    
    // Trigger Profile / Modulation Support
    this._modulateRadius = true;
    this._modulateIntensity = true;
    this._pressureBias = 0.0;
    this._buildUp = false; // Voxel build-up toggle
    this._strokeDistance = 0.0; // Distance traveled in meters during current stroke
    
    // Color Picker Support
    this._color = [1.0, 1.0, 1.0];
    this._colorSecondary = [0.0, 0.0, 0.0];
    this._pickColor = false;
    
    const isDesktop = !window.navigator.xr; // heuristic or check main
    // Let's rely on xrSession check during init, but for constructor just use a default
    this._res = 128; 
    this._pendingRes = 128;

    this._size = 100.0; // Revert to 100 to avoid clipping!
    this._min = [-50, -50, -50];
    this._max = [50, 50,  50];

    // constructor

    this._size = 100.0; // Keep simulation large
    this._min = [-50, -50, -50];
    this._max = [50, 50,  50];

    // constructor


    this._worker.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'WORKER_ERROR' || msg.type === 'ERROR') {
        if (this._main && this._main.getSculptManager()) {
          this._main.getSculptManager()._isProcessingQuads = false;
        }
        window._topologyOpFailed = true;
        setTimeout(() => {
          window._topologyOpFailed = false;
          if (this._main && this._main.guiXR) this._main.guiXR._needsRedraw = true;
        }, 2000);
        if (this._main && this._main.guiXR) this._main.guiXR._needsRedraw = true;
        return;
      }

      if (msg.type === 'LOG') {
        const logData = msg.data || '';
        // console.log("[VoxelWorker Telemetry]", logData);
        if (window.screenLog) {
          window.screenLog("VoxelWorker: " + logData, "cyan");
        }
        return;
      } else if (msg.type === 'CHUNK_UPDATE') {
        this._pendingMeshUpdate = false;
        
        if (this.updateVoxelChunks) {
            this.updateVoxelChunks(msg.chunks);
        } else {
            console.error("SculptVoxel: updateVoxelChunks method not implemented yet!");
        }

        // If an update was requested while we were busy, request it now
        if (this._meshRequested) {
          this._meshRequested = false;
          this._pendingMeshUpdate = true;
          this._worker.postMessage({ type: 'GET_MESH' });
        }
      } else if (msg.type === 'MESH_UPDATE') {
        const data = msg.data;
        if (msg.computeTime) {
          const prefix = data.isWASM ? "[WASM]" : "[JS]";
          const logMsg = `${prefix} SurfaceNets Compute: ${msg.computeTime.toFixed(1)}ms`;
        }
        
        this._pendingMeshUpdate = false;
        this.updateVoxelMesh(msg.data);

        // If an update was requested while we were busy, request it now
        if (this._meshRequested) {
          this._meshRequested = false;
          this._pendingMeshUpdate = true;
          this._worker.postMessage({ type: 'GET_MESH' });
        }
      } else if (msg.type === 'MESH_UNCHANGED') {
        this._pendingMeshUpdate = false;
        // If an update was requested while we were busy, request it now
        if (this._meshRequested) {
          this._meshRequested = false;
          this._pendingMeshUpdate = true;
          this._worker.postMessage({ type: 'GET_MESH' });
        }
      } else if (msg.type === 'MESH_UPDATE_QUAD') {
        this._main.getSculptManager().onQuadRemeshResult(msg.data);
      } else if (msg.type === 'SLICE_AND_CAP_RESULT') {
        this._main.getSculptManager().onSliceAndCapResult(msg);
      } else if (msg.type === 'SYMMETRY_MIRROR_RESULT') {
        this._main.getSculptManager().onSymmetryMirrorResult(msg);
      } else if (msg.type === 'SYMMETRY_MIRROR_FAULTS') {
        this._main.getSculptManager().onSymmetryMirrorFaults(msg);
      } else if (msg.type === 'VALIDATE_MANIFOLD_RESULT') {
        this._main.getSculptManager().onSymmetryMirrorFaults(msg); // Just reuse the faults painter for simplicity!
      } else if (msg.type === 'BOOLEAN_UNION_RESULT') {
        this._main.getSculptManager().onBooleanUnionResult(msg);
      } else if (msg.type === 'BOOLEAN_UNION_ERROR') {
        if (window.screenLog) window.screenLog("Boolean Union failed: " + msg.error, "red");
        this._main.getSculptManager()._isProcessingSlice = false; 
      } else if (msg.type === 'TRIANGULATE_RESULT') {
        this._main.getSculptManager().onTriangulateResult(msg);
      } else if (msg.type === 'QUADRANGULATE_RESULT') {
        this._main.getSculptManager().onQuadrangulateResult(msg);
      } else {
        console.log("Voxel: Unknown Worker Message", msg);
      }
    };

    window.debugVoxelColors = () => {
      if (!this._voxelMesh) {
        console.log("No Voxel Mesh found!");
        return;
      }
      const cAr = this._voxelMesh.getColors();
      if (cAr) {
        let min = [1,1,1], max = [0,0,0], hasNaN = false;
        for (let i = 0; i < cAr.length; i++) {
          if (isNaN(cAr[i])) { hasNaN = true; continue; }
          const comp = i % 3;
          min[comp] = Math.min(min[comp], cAr[i]);
          max[comp] = Math.max(max[comp], cAr[i]);
        }
        console.log(`[Diagnostic] Colors Length: ${cAr.length}, hasNaN: ${hasNaN}`);
        console.log(`[Diagnostic] Min: R=${min[0].toFixed(2)}, G=${min[1].toFixed(2)}, B=${min[2].toFixed(2)}`);
        console.log(`[Diagnostic] Max: R=${max[0].toFixed(2)}, G=${max[1].toFixed(2)}, B=${max[2].toFixed(2)}`);
        console.log(`[Diagnostic] First 3 Vertices Colors: [${cAr[0].toFixed(2)}, ${cAr[1].toFixed(2)}, ${cAr[2].toFixed(2)}]`);
      } else {
        console.log("[Diagnostic] No vertex colors on voxel mesh!");
      }
    };

    window.debugColorMismatch = () => {
      const toolColor = this._color;
      console.log("[Diagnostic] Tool Internal Color:", toolColor);

      if (this._voxelMesh) {
        const cAr = this._voxelMesh.getColors();
        if (cAr) {
          for (let i = 0; i < cAr.length; i += 3) {
            const r = cAr[i], g = cAr[i + 1], b = cAr[i + 2];
            if (r < 0.99 || g < 0.99 || b < 0.99) { // Non-white
              console.log(`[Diagnostic] First Non-White Vertex Color at index ${i/3}: [${r.toFixed(3)}, ${g.toFixed(3)}, ${b.toFixed(3)}]`);
              return;
            }
          }
          console.log("[Diagnostic] No non-white vertices found!");
        } else {
          console.log("[Diagnostic] No vertex colors on voxel mesh!");
        }
      } else {
        console.log("[Diagnostic] No Voxel Mesh active!");
      }
    };
    
    // Send Init to Worker
    // If we are starting up and it's desktop, bump res
    const isVR = this._main && this._main._xrSession;
    const res = isVR ? 64 : 128;
    this._res = res;
    this._pendingRes = res;
    
    const size = 150.0; // Restore to 150m to fit huge world height!
    this._worker.postMessage({
      type: 'INIT',
      res: res,
      size: size
    });

    // if (window.screenLog) window.screenLog("Voxel: Worker Inited", "green");

    // Cache Grid Info (simulating VoxelState metadata)
    this._res = res;
    this._size = size;
    this._step = size / res;
    // min is -size/2
    const half = size * 0.5;
    this._min = vec3.fromValues(-half, -half, -half);
    this._max = vec3.fromValues(half, half, half);

    this._allowAir = true; // Allow sculpting without surface picking

    // The mesh that represents the voxels
    this._voxelMesh = null;

    // "Canvas" location - Fixed in front of user
    this._gridMatrix = mat4.create();
    mat4.translate(this._gridMatrix, this._gridMatrix, this._min);
    mat4.scale(this._gridMatrix, this._gridMatrix, [this._step, this._step, this._step]);

    this._invGridMatrix = mat4.create();
    mat4.invert(this._invGridMatrix, this._gridMatrix);

    this._lastUpdate = 0;
    this._pendingMeshUpdate = false;

    // Air Cursor (Visual Feedback)
    this._cursorMeshSphere = Primitives.createSphere(main._gl);
    this._cursorMeshSphere.setMode(main._gl.TRIANGLES);
    this._cursorMeshSphere.setShaderType(Enums.Shader.FLAT);
    this._cursorMeshSphere.setFlatColor([1.0, 0.5, 0.0]); // Orange
    this._cursorMeshSphere.setOpacity(isVR ? 1.0 : 0.0); // Set to 0 to hide on desktop
    this._cursorMeshSphere.setVisible(false);

    this._cursorMeshCube = Primitives.createCube(main._gl);
    this._cursorMeshCube.setMode(main._gl.TRIANGLES);
    this._cursorMeshCube.setShaderType(Enums.Shader.FLAT);
    this._cursorMeshCube.setFlatColor([1.0, 0.5, 0.0]); // Orange
    this._cursorMeshCube.setOpacity(isVR ? 1.0 : 0.0); // Set to 0 to hide on desktop
    this._cursorMeshCube.setVisible(false);

    this._cursorMesh = this._cursorMeshSphere;

    // Symmetry Cursor (Visual Feedback)
    this._cursorMeshSymSphere = Primitives.createSphere(main._gl);
    this._cursorMeshSymSphere.setMode(main._gl.TRIANGLES);
    this._cursorMeshSymSphere.setShaderType(Enums.Shader.FLAT);
    this._cursorMeshSymSphere.setFlatColor([1.0, 0.5, 0.0]); 
    this._cursorMeshSymSphere.setOpacity(isVR ? 1.0 : 0.0); 
    this._cursorMeshSymSphere.setVisible(false);

    this._cursorMeshSymCube = Primitives.createCube(main._gl);
    this._cursorMeshSymCube.setMode(main._gl.TRIANGLES);
    this._cursorMeshSymCube.setShaderType(Enums.Shader.FLAT);
    this._cursorMeshSymCube.setFlatColor([1.0, 0.5, 0.0]); 
    this._cursorMeshSymCube.setOpacity(isVR ? 1.0 : 0.0); 
    this._cursorMeshSymCube.setVisible(false);

    this._cursorMeshSym = this._cursorMeshSymSphere;

    this._voxelBounds = new VoxelBounds(main);

    // [USER REQUEST] Show by default to debug boundaries
    // We use addNewMesh to ensure it is in the render loop.
    // if (this._main.addNewMesh) this._main.addNewMesh(this._debugCube);
    // else this._main.addMesh(this._debugCube);

    // Expose for Console Debugging
    window.voxelTool = this;
    window.helpVoxel = () => {
      console.log("window.voxelTool is available.");
      console.log("Try: window.voxelTool.centerCamera()");
      console.log("Try: window.voxelTool.toggleBox()");
      console.log("Try: window.voxelTool.toggleVoxelWireframe()");
      console.log("Try: window.voxelTool.toggleMatcap()");
      console.log("Try: window.voxelTool.fitToVoxel()");
      console.log("Try: window.voxelTool.flipWinding()");
      console.log("Try: window.voxelTool.logVoxelInfo()");
      console.log("Try: window.voxelTool.logInfo()");
      console.log("Try: window.voxelTool.bakeToMesh()");
    };

    // Ensure we have a default radius for distance check
    this._radius = 20.0; // Brush Size ~20% of world (User Request)
    this._negative = false; // Negative Mode Toggle
  }

  swapColors() {
    var tmp = this._color;
    this._color = this._colorSecondary;
    this._colorSecondary = tmp;
  }

  getMesh() {
    return this._voxelMesh || super.getMesh();
  }

  setRadius(val) {
    super.setRadius(val);
    //
  }

  toggleMatcap() {
    if (!this._voxelMesh) {
      console.warn("No voxel mesh exists yet.");
      return;
    }
    // Toggle Shader between FLAT and MATCAP
    if (this._voxelMesh.getShaderType() === Enums.Shader.MATCAP) {
      this._voxelMesh.setShaderType(Enums.Shader.FLAT);
      // console.log("Voxel Mesh: FLAT");
    } else {
      // Lazy Init Normals if missing
      if (!this._voxelMesh.getNormals() || this._voxelMesh.getNormals().length === 0) {
          if (window.screenLog) window.screenLog("Computing Normals...", "yellow");
          this._voxelMesh.initFaceRings();
          this._voxelMesh.updateGeometry();
      }
      this._voxelMesh.setShaderType(Enums.Shader.MATCAP);
      // console.log("Voxel Mesh: MATCAP");
    }
    this._main.render();
  }

  // sculptStroke override RESTORED to prevent SculptBase from
  // interpolating multiple strokes per frame (which triggers multiple full mesh rebuilds).
  sculptStroke() {
    // Single stroke per update to prevent "Choke"
    // SculptBase.sculptStroke interpolates steps (calling makeStroke multiple times).
    // For Voxels, this is fatal as each stroke triggers a full SurfaceNets rebuild.

    var main = this._main;
    var picking = main.getPicking();

    // Check minimum distance to avoid spamming zero-move updates
    var dx = main._mouseX - this._lastMouseX;
    var dy = main._mouseY - this._lastMouseY;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var minSpacing = 4.0; // Pixel spacing

    if (dist <= minSpacing && this._lastUpdate > 0) return;

    // Direct call to standard stroke logic
    // We bypass makeStroke because we don't need sophisticated picking/symmetry for basic Voxel sculpting yet?
    // Actually makeStroke handles picking update.
    // Let's call makeStroke ONCE.

    var pickingSym = main.getSculptManager().getSymmetry() ? main.getPickingSymmetry() : null;
    this.makeStroke(main._mouseX, main._mouseY, picking, pickingSym);

    // Update Last Mouse
    this._lastMouseX = main._mouseX;
    this._lastMouseY = main._mouseY;

    // Force Render
    this._main.render();
  }

  toggleVoxelWireframe() {
    if (!this._voxelMesh) {
      console.warn("No voxel mesh exists yet.");
      if (window.screenLog) window.screenLog("No Voxel Mesh!", "orange");
      return;
    }
    // Toggle Wireframe visibility natively
    const currentState = this._voxelMesh.getShowWireframe();
    this._voxelMesh.setShowWireframe(!currentState);
    console.log(`Voxel Mesh Wireframe: ${!currentState}`);
    if (window.screenLog) window.screenLog(`Voxel: WIREFRAME ${!currentState ? "ON" : "OFF"}`, "lime");
    this._main.render();
  }

  // Override SculptBase.pushState to use Voxel State
  pushState() {
    // this._main.getStateManager().pushStateVoxel(this._voxelState);
    console.warn("Voxel Undo temporarily disabled in Worker Mode");
  }



  logVoxelInfo() {
    if (!this._voxelMesh) {
      console.warn("No voxel mesh.");
      return;
    }
    const b = this._voxelMesh.computeWorldBound();
    console.log(`Voxel Mesh Bounds: [${b[0].toFixed(2)}, ${b[1].toFixed(2)}, ${b[2].toFixed(2)}] to [${b[3].toFixed(2)}, ${b[4].toFixed(2)}, ${b[5].toFixed(2)}]`);
    console.log(`Vertices: ${this._voxelMesh.getNbVertices()} Faces: ${this._voxelMesh.getNbFaces()}`);
    console.log(`Scale: ${this._voxelMesh.getScale()}`);
    console.log(`Center: ${this._voxelMesh.getCenter()}`);
  }

  centerCamera() {
    // Helper to look at the voxel box
    const main = this._main;
    if (main.getCamera()) {
      // Box is at [0, 1.0, -0.5]
      // Use setAndFocusOnPivot([x,y,z], zoom)
      // Zoom 25.0 to see the whole box
      const cam = main.getCamera();
      if (cam.setAndFocusOnPivot) {
        cam.setAndFocusOnPivot([0, 1.0, -0.5], 100.0); // Zoom out further (Box is size 50)
      } else {
        console.error("Camera.setAndFocusOnPivot missing!");
      }
      main.render();
      console.log("Camera centered on Voxel Box (Pivot: 0, 1.0, -0.5 | Zoom: 100)");
    }
  }

  fitToVoxel() {
    if (!this._voxelMesh) {
      console.warn("No voxel mesh to fit to.");
      return;
    }
    const main = this._main;
    const cam = main.getCamera();
    if (!cam.setAndFocusOnPivot) {
      console.error("Camera.setAndFocusOnPivot missing!");
      return;
    }

    // Compute World Bounds
    const b = this._voxelMesh.computeWorldBound();
    // Bounds: [minX, minY, minZ, maxX, maxY, maxZ]
    const center = [
      (b[0] + b[3]) * 0.5,
      (b[1] + b[4]) * 0.5,
      (b[2] + b[5]) * 0.5
    ];

    // Estimate Zoom (Radius)
    const dx = b[3] - b[0];
    const dy = b[4] - b[1];
    const dz = b[5] - b[2];
    const maxDim = Math.max(dx, Math.max(dy, dz));

    // In SculptGL, zoom ~ 100 is roughly 1 unit wide? 
    // Actually zoom is percentage or internal unit?
    // setAndFocusOnPivot(pivot, zoom)
    // Default start zoom is usually near 0?? Or 100?
    // centerCamera used 100.0 for box (size 1.0?)
    // If box size 1.0 needs 100.0 zoom.
    // Then zoom = 100.0 / maxDim? Or * maxDim?
    // Let's try constant zoom first or just keep current zoom?
    // Actually setAndFocusOnPivot moves camera to pivot + offset?

    // Let's try a safe Zoom value or 2.0 (closer)
    cam.setAndFocusOnPivot(center, 2.0);
    main.render();
    console.log(`Focused on Voxel: Center[${center[0].toFixed(2)},${center[1].toFixed(2)},${center[2].toFixed(2)}] Size[${maxDim.toFixed(2)}]`);
  }

  focusVoxel() {
    this.fitToVoxel();
  }

  toggleBox() {
    if (this._debugCube.getShaderType() === Enums.Shader.WIREFRAME) {
      this._debugCube.setShaderType(Enums.Shader.FLAT);
      this._debugCube.setFlatColor([1.0, 0.0, 0.0]); // Red
      this._debugCube.setOpacity(0.5); // Transparent?
      console.log("Box: FLAT (Red)");
    } else {
      this._debugCube.setShaderType(Enums.Shader.WIREFRAME);
      console.log("Box: WIREFRAME");
    }
    this._main.render();
  }

  toggleSmooth() {
    this._smooth = !this._smooth;
    if (this._worker) {
      this._worker.postMessage({ type: 'SMOOTH', value: this._smooth });
      if (window.screenLog) window.screenLog(`Voxel Smooth: ${this._smooth ? "ON" : "OFF"}`, this._smooth ? "lime" : "orange");
    }
  }

  logInfo() {
    console.log("Voxel Tool Info:");
    console.log(" - DebugCube:", this._debugCube);
    console.log(" - Visible:", this._debugCube.isVisible());
    console.log(" - Pickable:", this._debugCube.isPickable);
    console.log(" - Shader:", this._debugCube.getShaderType());
    console.log(" - Meshes in Scene:", this._main.getMeshes().length);
    console.log(" - Camera:", this._main.getCamera().computePosition());
  }

  forceInit() {
    // Force an initial sphere at the center so we have a mesh to see immediately
    if (this._lastUpdate === 0) {
      /* [USER REQUEST] Initial Sphere Disabled for Air Drawing
      if (window.screenLog) window.screenLog("Voxel: Initial Sphere...", "green");
      if (this._worker) {
        this._worker.postMessage({
          type: 'EDIT_SPHERE',
          center: [0, 0, 0],
          radius: 15.0,
          color: [0.2, 1.0, 0.2],
          isNegative: false
        });
        console.log("Voxel: forceInit sent EDIT_SPHERE");
      }
      */
      this._lastUpdate = 1;
    }
  }

  start(ctrl) {
    // IGNORE start() in VR (handled by updateXR)
    if (this._main._xrSession) return;

    // Refresh Global Reference
    window.voxelTool = this;

    // Ensure the voxel surface mesh is pickable so desktop ray-casts hit it.
    // (_debugCube is legacy/removed — its creation is commented out — so don't touch it.)
    if (this._voxelMesh) this._voxelMesh.isPickable = true;

    // Create Test Triangle - REMOVED (Confusing picking)
    // this.createDebugTriangle();

    // Ensure Initial Sphere exists
    this.forceInit();

    const res = super.start(ctrl);

    // Desktop: snapshot the pre-stroke voxel state so this stroke is undoable
    // (the VR path snapshots in updateXR; desktop never did, so Undo had nothing
    // to revert to). One SNAPSHOT per stroke start = one undo step per stroke.
    if (!this._main._xrSession && this._worker) {
      this._worker.postMessage({ type: 'SNAPSHOT' });
    }

    // Desktop 1b: every stroke draws on the camera-facing plane through the grid centre
    // (computed per-frame in getDesktopCursor). Just allow the stroke to engage without
    // a surface pick and reset the stroke-spacing tracker.
    let allowAir = false;
    if (!this._main._xrSession) {
      this._deskStrokeStarted = false;
      allowAir = true;
    }

    // Debug Picking Failure
    if (!res) {
      // If start failed, it means picking missed. 
      // But for Voxel tool, maybe we want to allow it anyway?
      // SculptBase.start return true if we hit something OR if this._allowAir?
      // Let's check SculptBase.js later.
      //
    } else {
      //

      // HIDE ALL OTHER MESHES
      /*
      var meshes = this._main.getMeshes();
      for (var i = 0; i < meshes.length; ++i) {
        if (meshes[i] !== this._voxelMesh && meshes[i] !== this._debugCube) {
          meshes[i].setVisible(false);
          // Also disable picking for them?
          // meshes[i].isVisible = () => false; // Hack if getter/setter exists
        }
      }
      */
    }
    // Allow the stroke to engage even with no surface pick, so we can draw into
    // empty space on the draw plane (1b). super.start returns false on a miss.
    return res || allowAir;
  }

  // Desktop stroke dispatch. The base makeStroke only fires on a surface pick, which
  // blocks drawing into empty space; so when there's no voxel surface under the cursor
  // we run our own throttled stroke that projects onto the draw plane (1b). Surface
  // hits fall through to the base behaviour (unchanged).
  update(continuous) {
    if (this._main._xrSession) return; // VR handled by updateXR
    const main = this._main;
    const picking = main.getPicking();
    picking.intersectionMouseMeshes(); // refresh pick (gives surface radius if over geometry)

    // 1b: always draw on the plane (no surface swap yet) — throttle by screen spacing.
    if (!this._voxelMesh) return;
    const minSpacing = Math.max(2, 0.15 * (this._radius || 25) * main.getPixelRatio());
    if (this._deskStrokeStarted) {
      const dx = main._mouseX - this._lastDeskX;
      const dy = main._mouseY - this._lastDeskY;
      if (Math.sqrt(dx * dx + dy * dy) < minSpacing) return;
    }
    this._deskStrokeStarted = true;
    this._lastDeskX = main._mouseX;
    this._lastDeskY = main._mouseY;
    this.stroke(picking);
  }

  postRender(selection) {
    if (this._voxelBounds) {
      // Only render voxel bounds if in VR to avoid the big green sphere on desktop
      if (this._main._xrSession) {
        this._voxelBounds.render(this._main, this._size, this._identityMatrix);
      }
    }
    // Base postRender draws the brush indicator each frame (the desktop voxel cursor
    // sphere lives in Selection.render). This override previously skipped it, so the
    // cursor never appeared on hover. Restore it.
    if (selection) selection.render(this._main);
  }

  // Compute the camera-facing draw plane (three-world): grid centre + a basis from the
  // screen centre (forward/right/up). Used live in camera-lock mode, and captured once
  // when switching to world-lock mode. All vec3 arrays.
  _computeCameraPlane(picking, mw) {
    const res = this._res || 128;
    const gc = vec3.fromValues(res * 0.5, res * 0.5, res * 0.5);
    vec3.transformMat4(gc, gc, mw);
    const cam = this._main.getCamera();
    const scx = cam._width * 0.5, scy = cam._height * 0.5;
    const cN = picking.unproject(scx, scy, 0.0);
    const cF = picking.unproject(scx, scy, 1.0);
    const normal = vec3.create(); vec3.sub(normal, cN, cF); vec3.normalize(normal, normal);
    const cR = picking.unproject(scx + 50, scy, 0.0);
    const cU = picking.unproject(scx, scy - 50, 0.0);
    const right = vec3.create(); vec3.sub(right, cR, cN); vec3.normalize(right, right);
    const up    = vec3.create(); vec3.sub(up, cU, cN);    vec3.normalize(up, up);
    return { point: [gc[0], gc[1], gc[2]], normal: [normal[0], normal[1], normal[2]],
             right: [right[0], right[1], right[2]], up: [up[0], up[1], up[2]] };
  }

  // Toggle the draw plane between camera-locked (always faces the view) and world-locked
  // (frozen in world space so you can orbit around your drawing). Capture the current
  // camera plane when freezing.
  setPlaneWorldLock(locked) {
    this._planeWorldLocked = !!locked;
    if (locked) {
      const tm = this._voxelMesh && this._voxelMesh.getThreeMesh ? this._voxelMesh.getThreeMesh() : null;
      if (tm) { tm.updateMatrixWorld(true); this._lockedPlane = this._computeCameraPlane(this._main.getPicking(), tm.matrixWorld.elements); }
      // Tilt carries over (it applies in both modes), so the plane looks continuous
      // across the toggle. Double-tap the tilt pad to reset.
    }
  }

  // Desktop 1b: project the current mouse onto the draw plane, all in THREE-WORLD
  // (threeMesh.matrixWorld, includes the worldGroup) to match unproject. Returns the hit
  // in mesh-local CELL coords + brush radius in CELLS (computeWorldRadius2-style) + the
  // plane basis for visualization. Shared by stroke() and the Selection hover indicator.
  getDesktopCursor(picking) {
    const tm = this._voxelMesh && this._voxelMesh.getThreeMesh ? this._voxelMesh.getThreeMesh() : null;
    if (!tm) return null;
    tm.updateMatrixWorld(true);
    const mw = tm.matrixWorld.elements;

    const ms = Math.sqrt(mw[0] * mw[0] + mw[4] * mw[4] + mw[8] * mw[8]) || 1.0; // cell→world scale
    const radiusCells = (this._radius || 25) * 0.1; // FIXED world brush size (cells)

    // Surface mode: raycast the voxel surface and place the cursor/deposit at the hit
    // (tracks the surface) instead of the draw plane. No deposit when off the surface.
    if (this._surfaceMode) {
      picking.intersectionMouseMeshes();
      const pm = picking.getMesh();
      if (!pm || !pm._isVoxel) return null;
      const ip = picking.getIntersectionPoint();
      const worldHit = vec3.create();
      vec3.transformMat4(worldHit, ip, mw);
      return { cellPos: [ip[0], ip[1], ip[2]], radiusCells, worldHit,
               surfaceMode: true, res: this._res || 128 };
    }

    // Plane: world-locked → frozen basis; else live camera-facing.
    const plane = (this._planeWorldLocked && this._lockedPlane)
      ? this._lockedPlane : this._computeCameraPlane(picking, mw);
    let normal = plane.normal, right = plane.right, up = plane.up;

    // Free tilt (both modes): rotate the plane basis — yaw about its up axis, pitch about
    // its right axis. In camera mode it angles the plane relative to the view (and stays
    // angled as you orbit); in world mode it angles the frozen plane.
    if (this._planeTiltYaw || this._planeTiltPitch) {
      const q = quat.create();
      quat.multiply(q,
        quat.setAxisAngle(quat.create(), up, this._planeTiltYaw || 0),
        quat.setAxisAngle(quat.create(), right, this._planeTiltPitch || 0));
      normal = vec3.transformQuat(vec3.create(), normal, q);
      right  = vec3.transformQuat(vec3.create(), right, q);
      up     = vec3.transformQuat(vec3.create(), up, q);
    }

    // Apply the depth offset: shift the plane centre along its normal. _planeDepthOffset
    // is in CELLS (grid-relative), converted to world via the cell→world scale.
    const depthW = (this._planeDepthOffset || 0) * ms;
    const gc = [plane.point[0] + normal[0] * depthW,
                plane.point[1] + normal[1] * depthW,
                plane.point[2] + normal[2] * depthW];

    // The mouse ray to intersect with that plane.
    const nP = picking.unproject(this._main._mouseX, this._main._mouseY, 0.0);
    const fP = picking.unproject(this._main._mouseX, this._main._mouseY, 1.0);
    const hit = vec3.create();
    if (!Geometry.intersectLinePlane(nP, fP, gc, normal, hit)) return null;

    const invMW = mat4.create();
    mat4.invert(invMW, mw);
    const cellPos = vec3.create();
    vec3.transformMat4(cellPos, hit, invMW);
    // Plane centre in cell space (for placing the grid coplanar with the deposits).
    const centerCell = vec3.create();
    vec3.transformMat4(centerCell, gc, invMW);

    return {
      cellPos, radiusCells, worldHit: hit,
      // For visualizing the draw plane: centre in CELL space + basis (three-world).
      planeCenterCell: [centerCell[0], centerCell[1], centerCell[2]],
      planeNormal: [normal[0], normal[1], normal[2]],
      planeRight: [right[0], right[1], right[2]],
      planeUp: [up[0], up[1], up[2]],
      gridWorldSize: (this._res || 128) * ms,
      res: this._res || 128,
    };
  }

  stroke(picking) {
    const cur = this.getDesktopCursor(picking);
    if (!cur) {
      if (window.screenLog && Math.random() < 0.05) window.screenLog("Voxel Stroke: No Intersection", "red");
      return;
    }
    const cellPos = cur.cellPos;

    // Convert cell -> the worker's centered-model space: model = cell*step - size/2
    // (worker grid is centered at origin; step = size/(res-1)).
    const _res  = this._res || 128;
    const _sw   = this._size / (_res - 1);
    const _half = this._size * 0.5;
    const worldPos = vec3.fromValues(
      cellPos[0] * _sw - _half,
      cellPos[1] * _sw - _half,
      cellPos[2] * _sw - _half
    );

    const radius = Math.max(_sw, cur.radiusCells * _sw);

    // Add Sphere
    const color = [0.7, 0.65, 0.6];

    // Desktop Shift -> Subtract
    // Check main._shiftKey (SculptGL usually tracks this?)
    // Actually SculptGL doesn't track shiftKey globally in 'main'. 
    // It's usually in 'main._event' or we need to look at 'SculptGL.js' handlers.
    // Standard approach: MouseEvent has shiftKey.
    // 'picking' doesn't have it.
    // Let's assume we can access it via a global or main property?
    // main._action usually ...
    // Let's rely on `main._inputAction` or similar if available?
    // Or just look at `sculptStroke` context.

    // SAFE FALLBACK: Check the standard DOM event if possible? 
    // No, that's messy.

    // Check Utils or Global?
    // Let's check if 'main' has a shift tracking.
    // If not, we'll try to guess or skip.

    // Actually, SculptGL.js usually handles events.
    // Let's blindly check `this._main._shiftKey` or try to wire it up later if this fails.
    // For now, let's just add the logs for VR mainly.
    // Wait, user ASKED for Desktop Shift.

    // Let's try:
    var isNegative = (this._main._shiftKey === true) || (this._negative === true);

    // Inflate Mode?
    // How do we toggle modes?
    // 1. GUI (we can add a 'mode' prop to SculptVoxel)
    // 2. Keyboard?
    // Let's add `this._mode` property (0=Add, 1=Sub, 2=Inflate)
    // Default to Add (0). If shift, force Sub (1).
    // If Inflate (2), then ignore shift? Or Shift=Deflate?

    // 0=Add, 1=Sub, 2=Inflate, 3=Smooth. The explicit mode (from the desktop voxel
    // UI) wins; Shift maps to "carve" (handled via isNegative in the ADD/SUB branch
    // below and as Deflate for Inflate), so don't override the chosen mode here.
    var mode = (this._mode !== undefined) ? this._mode : 0;

    // INTENSITY MODULATION
    // Base Strength (0..1)
    var strength = (this._strength !== undefined) ? this._strength : 0.5;

    // Modulate Intensity
    if (this._modulateIntensity) {
      // Extract Trigger Value (Need to pass it here or store it?)
      // updateXR stores it in `this._lastTriggerValue`? No.
      // We are in `stroke()`, called by `updateXR` (indirectly? No, updateXR calls stroke logic directly or via separate method?)
      // Wait, `SculptVoxel.js` has `updateXR` which calls `_lastXRPos` logic and `postMessage` directly?
      // Yes, `updateXR` (lines 680+) handles the VR stroke.
      // This `stroke()` method (lines 538+) seems to be for MOUSE/TABLET?
      // Let's check where `updateXR` calls `_worker.postMessage`.
      // It's at line 782+ (in my previous read).
      // Ah, I am editing `stroke()` which might be wrong if VR uses `updateXR`.
      // `updateXR` duplicates some logic or uses `stroke`?
      // `updateXR` has its own `postMessage` calls (lines 830+ in previous read).
      // I need to apply Intensity Modulation in `updateXR`, NOT here (unless `stroke` is used by VR too? Scene.js calls updateXR).
      // Let's abort this edit and apply it to `updateXR` instead.
    }

    // DEBUG: Mode Verification
    // if (this._lastUpdate % 30 === 0) {
    // window.screenLog(`Strk: Mode=${mode} Neg=${isNegative}`, "cyan");
    // }

    // FORCE LOG for User Request
    if (window.screenLog) {
      let mStr = "ADD";
      if (mode === 1) mStr = "SUB";
      if (mode === 2) mStr = isNegative ? "DEFLATE" : "INFLATE";
      //
    }

    var changed = false;
    if (this._worker) {
      const now = Date.now();
      const throttleMs = 50; // 20 FPS for mesh updates
      let returnMesh = !this._pendingMeshUpdate;
      
      if (returnMesh && (!this._lastMeshRequestTime || (now - this._lastMeshRequestTime > throttleMs))) {
        this._pendingMeshUpdate = true;
        this._lastMeshRequestTime = now;
      } else {
        returnMesh = false; // Override to false if throttled or pending
        this._meshRequested = true; // Mark that we want an update as soon as possible
      }

      if (mode === 2) {
        // INFLATE
        // Strength should be adjustable? Default 0.5?
        // Shift could invert strength to Deflate?
        var strength = (this._intensity !== undefined) ? this._intensity : ((this._strength !== undefined) ? this._strength : 0.5);
        if (isNegative) strength = -strength;
        var shape = (this._shape !== undefined) ? this._shape : 0;
        console.log("VoxelTool INFLATE - sending shape: " + shape);

        this._worker.postMessage({
          type: 'INFLATE',
          center: [worldPos[0], worldPos[1], worldPos[2]],
          radius: radius,
          strength: strength,
          shape: shape,
          returnMesh: returnMesh
        });
      } else if (mode === 3) {
        // SMOOTH
        var strength = (this._intensity !== undefined) ? this._intensity : ((this._strength !== undefined) ? this._strength : 0.5);
        var shape = (this._shape !== undefined) ? this._shape : 0;
        console.log("VoxelTool SMOOTH - sending shape: " + shape);

        this._worker.postMessage({
          type: 'SMOOTH_SPHERE',
          center: [worldPos[0], worldPos[1], worldPos[2]],
          radius: radius,
          strength: strength,
          shape: shape,
          returnMesh: returnMesh
        });
      } else {
        // ADD / SUB (Sub button, or Add + Shift/negative = carve)
        var isSub = (mode === 1) || (mode === 0 && isNegative);
        var shape = (this._shape !== undefined) ? this._shape : 0;
        console.log("VoxelTool EDIT_SPHERE - sending shape: " + shape);
        this._worker.postMessage({
          type: 'EDIT_SPHERE',
          center: [worldPos[0], worldPos[1], worldPos[2]],
          radius: radius,
          color: color,
          isNegative: isSub,
          shape: shape,
          returnMesh: returnMesh
        });
      }

      if (returnMesh && window.screenLog) {
         // window.screenLog(`Voxel: Sent stroke edit. ReqMesh=true`, "grey");
      }
    } else {
       if (window.screenLog) window.screenLog("Voxel FAIL: No Worker Alive!", "red");
    }
  }

  flipWinding() {
    if (!this._voxelMesh) return;
    const mesh = this._voxelMesh;
    const fAr = mesh.getFaces();
    // Swap 2nd and 3rd index of every triangle/quad
    for (let i = 0; i < fAr.length; i += 4) {
      if (fAr[i] === Utils.TRI_INDEX) continue; // Should not happen in 4-strided
      const tmp = fAr[i + 1];
      fAr[i + 1] = fAr[i + 2];
      fAr[i + 2] = tmp;
    }
    mesh.updateGeometry();
    mesh.updateBuffers();
    this._main.render();
    mesh.updateBuffers();
    this._main.render();
    console.log("Voxel Mesh Winding Flipped");
  }

  clear() {
    if (this._worker) {
      this._worker.postMessage({ type: 'CLEAR' });
    }
  }

  updateXR(picking, isPressed, origin, dir, options) {
    if (this._voxelBounds) {
      this._voxelBounds.render(this._main, this._size, this._identityMatrix);
    }

    try {
      // VoxelXR Update
      // Ensure we hide distracting meshes
      // this.hideOtherMeshes();

      // Show/Update Cursor
      var shapeCursor = (this._shape !== undefined) ? this._shape : 0;
      
      // Hide the inactive cursor meshes
      if (this._cursorMeshSphere) this._cursorMeshSphere.setVisible(false);
      if (this._cursorMeshCube) this._cursorMeshCube.setVisible(false);

      this._cursorMesh = (shapeCursor === 1) ? this._cursorMeshCube : this._cursorMeshSphere;

      if (this._cursorMesh) {
        // [PHASE 7] In VR, we use _vrBrushRadiusCube and _vrBrushRadiusSphere from Scene.js.
        // We MUST hide the desktop _cursorMeshes completely, otherwise they sit at world [0,0,0] and scale up massively.
        const isVR = this._main && this._main._xrSession;
        this._cursorMesh.setVisible(!isVR);
        
        var m = this._cursorMesh.getMatrix();
        mat4.identity(m);
        // Radius Source: this._radius (0..100) set by GuiXR
        var rawRadius = (this._radius !== undefined) ? this._radius : 25.0;
        // Radius Mapping for Cursor Visual
        // Match the logic in Edit Sphere
        var cursorRadius = Math.max(1.0, rawRadius * 0.15);
        var radius = cursorRadius; 

        // Support Voxel Mult Slider if set
        if (this._radiusMult) radius *= this._radiusMult;

        // Position at Controller Tip (origin)
        mat4.translate(m, m, origin);
        
        // Apply Orientation if required
        if (this._alignToController && shapeCursor === 1 && options && options.quat) {
            var qMat = mat4.create();
            mat4.fromQuat(qMat, options.quat);
            mat4.multiply(m, m, qMat);
        }

        // User reported visual is half the size of actual edit. Scaling by 2.0.
        const rVisual = radius * 2.0;
        mat4.scale(m, m, [rVisual, rVisual, rVisual]);
      }

      // Symmetry Visuals
      const sym = this._main.getSculptManager().getSymmetry();

      if (this._cursorMeshSym) {
        if (sym) {
          if (this._cursorMeshSymSphere) this._cursorMeshSymSphere.setVisible(false);
          if (this._cursorMeshSymCube) this._cursorMeshSymCube.setVisible(false);
          
          var shapeCursorSym = (this._shape !== undefined) ? this._shape : 0;
          this._cursorMeshSym = (shapeCursorSym === 1) ? this._cursorMeshSymCube : this._cursorMeshSymSphere;

          const isVR = this._main && this._main._xrSession;
          this._cursorMeshSym.setVisible(!isVR); 

          // Calculate Mirrored Position
          // 1. World -> Local (Grid)
          const symLocalPos = vec3.create();
          vec3.transformMat4(symLocalPos, origin, this._invGridMatrix);

          const mSym = this._cursorMeshSym.getMatrix();
          mat4.identity(mSym);

          // 2. Mirror X (Local)
          symLocalPos[0] = -symLocalPos[0];

          // 3. Local -> World
          const worldPosSym = vec3.create();
          vec3.transformMat4(worldPosSym, symLocalPos, this._gridMatrix);

          // 4. Position & Scale
          mat4.translate(mSym, mSym, worldPosSym);

          if (this._alignToController && shapeCursorSym === 1 && options && options.quat) {
             var qMatSym = mat4.create();
             var mirroredQuat = [options.quat[0], -options.quat[1], -options.quat[2], options.quat[3]];
             mat4.fromQuat(qMatSym, mirroredQuat);
             mat4.multiply(mSym, mSym, qMatSym);
          }

          // Use same radius as main cursor
          // Recalculate radius to be safe or reuse? Reusing logic for consistency.
          var rawRadius = (this._radius !== undefined) ? this._radius : 25.0;
          var cursorRadius = Math.max(1.0, rawRadius * 0.15);
          var radius = cursorRadius;
          if (this._radiusMult) radius *= this._radiusMult;

          mat4.scale(mSym, mSym, [radius, radius, radius]);

        } else {
          this._cursorMeshSym.setVisible(false);
        }
      }

      // Convert Absolute World Origin to Workspace Space
      const workspacePos = vec3.create();
      if (options && options.tipOrigin) {
        workspacePos[0] = options.tipOrigin[0];
        workspacePos[1] = options.tipOrigin[1];
        workspacePos[2] = options.tipOrigin[2];
      } else if (options && options.rayOrigin) {
        const gripDir = vec3.fromValues(0, 0, -1);
        if (options.quat) vec3.transformQuat(gripDir, gripDir, options.quat);
        const offsetDist = 0.20;
        workspacePos[0] = options.rayOrigin[0] + gripDir[0] * offsetDist;
        workspacePos[1] = options.rayOrigin[1] + gripDir[1] * offsetDist;
        workspacePos[2] = options.rayOrigin[2] + gripDir[2] * offsetDist;
      } else {
        workspacePos[0] = origin[0];
        workspacePos[1] = origin[1];
        workspacePos[2] = origin[2];
      }

      var localPos = vec3.create();
      localPos[0] = (workspacePos[0] - this._min[0]) / this._step;
      localPos[1] = (workspacePos[1] - this._min[1]) / this._step;
      localPos[2] = (workspacePos[2] - this._min[2]) / this._step;

      if (!isPressed) {
        if (this._mode === 4 && this._moveProxyActive) {
          if (this._worker) {
            
            var mRawRadius = (this._radius !== undefined) ? this._radius : 25.0;
            var mWorldRadius = Math.max(1.0, mRawRadius * 0.15); 
            if (this._radiusMult) mWorldRadius *= this._radiusMult;
            var pr = mWorldRadius;
            
            var tx = this._moveProxyLastTranslation[0];
            var ty = this._moveProxyLastTranslation[1];
            var tz = this._moveProxyLastTranslation[2];
            
            var steps = Math.ceil(Math.sqrt(tx*tx + ty*ty + tz*tz) / (pr * 0.15));
            if (steps < 1) steps = 1;
            if (steps > 20) steps = 20;

            if (sym) {
               // Mirrored Target Rotation Quarterion
               // If start was S, and move is T,  rot = T * inv(S).
               // Mirrored rot: mirror(T * inv(S)) = mirror(T) * mirror(inv(S))
               var startMR = [-this._moveStartXRQuat[0], this._moveStartXRQuat[1], this._moveStartXRQuat[2], -this._moveStartXRQuat[3]];
               var startRotSym = [-startMR[0], -startMR[1], -startMR[2], startMR[3]]; 
               // Above: Equivalent to manual flip of x. A mirror Quat in X is (qx, -qy, -qz, qw).
               var sRotSym = [this._moveStartXRQuat[0], -this._moveStartXRQuat[1], -this._moveStartXRQuat[2], this._moveStartXRQuat[3]];
               var invStartSym = quat.create();
               quat.invert(invStartSym, sRotSym);
               
               var cRot = this._moveProxyLastQuat; 
               // cRot is the total rotation. We can just mirror the total rotation!
               var rotSym = [this._moveProxyLastQuat[0], -this._moveProxyLastQuat[1], -this._moveProxyLastQuat[2], this._moveProxyLastQuat[3]];
               
               this._worker.postMessage({
                 type: 'WARP_SPHERE',
                 center: [-this._moveProxyCenter[0], this._moveProxyCenter[1], this._moveProxyCenter[2]],
                 radius: this._moveProxyRadius,
                 translation: [-tx, ty, tz],
                 rotation: rotSym,
                 steps: steps,
                 returnMesh: false // We only want one returned mesh!
               });
            }
            
            this._worker.postMessage({
              type: 'WARP_SPHERE',
              center: Array.from(this._moveProxyCenter),
              radius: this._moveProxyRadius,
              translation: Array.from(this._moveProxyLastTranslation),
              rotation: Array.from(this._moveProxyLastQuat),
              steps: steps,
              returnMesh: true // Bake it all in at the end
            });
          }
          this._moveProxyActive = false;
        }

        this._lastXRPos = null; // Reset stroke
        this._xrStrokeActive = false;
        return;
      }

      // Detect Start of Stroke (VR)
      if (!this._xrStrokeActive) {
        this._xrStrokeActive = true;
        this._strokeDistance = 0.0; 
        this._strokeStartTime = performance.now(); // Reset for temporal build-up
        this._lastFrameTime = null; // Reset for speed tracking
        this._lastWorkspacePos = null; // Reset for speed tracking
        
        if (this._worker) {
          this._worker.postMessage({ type: 'SNAPSHOT' });
        }

        // Initialize Move Proxy Start State
        if (this._mode === 4) {
          this._moveProxyActive = true;
          this._moveProxyCenter = vec3.clone(workspacePos);
          this._moveStartXRPos = vec3.clone(workspacePos);
          this._moveStartXRQuat = (options && options.quat) ? quat.clone(options.quat) : quat.create();
          
          this._moveProxyLastTranslation = vec3.create();
          this._moveProxyLastQuat = quat.create();

          // Radius setup
          var mRawRadius = (this._radius !== undefined) ? this._radius : 25.0;
          var mWorldRadius = Math.max(1.0, mRawRadius * 0.15); 
          if (this._radiusMult) mWorldRadius *= this._radiusMult;
          this._moveProxyRadius = mWorldRadius;
          
          this._moveProxyIVerts = [];
          this._moveProxyIVertsSym = [];
          
          if (this._voxelMesh) {
             var vAr = this._voxelMesh.getVertices();
             this._moveProxyVAr = new Float32Array(vAr); // Cache original
             
             // vAr coordinates are in Simulation Grid Space!
             // localPos is already the World Position mapped to Simulation Space.
             var cx = localPos[0];
             var cy = localPos[1];
             var cz = localPos[2];
             
             var rGrid = mWorldRadius / this._step;
             var r2 = rGrid * rGrid;
             
             // Symmetry coordinates
             var isSymProxy = sym;
             var cxSym = (-workspacePos[0] - this._min[0]) / this._step; // Mirror X World Pos to Grid Space
             
             for (var i = 0; i < vAr.length; i += 3) {
               var dy = vAr[i+1] - cy;
               var dz = vAr[i+2] - cz;
               var dSq = dy*dy + dz*dz;
               if (dSq > r2) continue; // Early exit on YZ
               
               var dx = vAr[i] - cx;
               if (dx*dx + dSq < r2) {
                 this._moveProxyIVerts.push(i);
               } else if (isSymProxy) {
                 var dxSym = vAr[i] - cxSym;
                 if (dxSym*dxSym + dSq < r2) {
                   this._moveProxyIVertsSym.push(i);
                 }
               }
             }
          }
        }
      }


      this._lastIsPressed = isPressed;

      // Guard: Check for NaN/Infinity
      if (isNaN(localPos[0]) || isNaN(localPos[1]) || isNaN(localPos[2])) {
        return;
      }

      // Throttle: Distance Check
      // We should only paint if we moved at least 0.25 unit (Sub-voxel resolution)
      // This prevents zero-delta updates but allows smooth curves.
      if (this._lastXRPos) {
        var dx = localPos[0] - this._lastXRPos[0];
        var dy = localPos[1] - this._lastXRPos[1];
        var dz = localPos[2] - this._lastXRPos[2];
        var distSq = dx * dx + dy * dy + dz * dz;
        
        const returnMeshReady = !this._pendingMeshUpdate;
        if (!this._buildUp) {
          if (distSq < 0.0625) return; // Standard distance throttle
        } else {
          // In Build Up mode, allow stationary falling through, but ONLY if we are ready to ask for a mesh!
          // This prevents worker flood while still allowing growth.
          if (distSq < 0.0625 && !returnMeshReady) return;
        }
        
        this._strokeDistance += Math.sqrt(distSq) * this._step; 
      }

      // Update Last Pos
      if (!this._lastXRPos) this._lastXRPos = vec3.create();
      vec3.copy(this._lastXRPos, localPos);

      // TRIGGER MODULATION LOGIC
      // Extract Trigger Value (0..1)
      let triggerValue = 1.0;
      if (options && options.triggerValue !== undefined) {
        triggerValue = options.triggerValue;
      } else {
        // Fallback: If not passed, assume 1.0 (Full Press) or 0.0?
        // If isPressed is true, we assume it's pressed.
        // But for modulation we need the value.
        // If Scene.js didn't pass it, we can't modulate.
      }

      // Radius Base
      var rawRadius = (this._radius !== undefined) ? this._radius : 25.0;
      var worldRadius = Math.max(1.0, rawRadius * 0.15); // 0-100 -> 1.5-15.0
      if (this._radiusMult) worldRadius *= this._radiusMult;

      // Modulate Radius
      if (this._modulateRadius) {
        // Bias Logic
        // S = Bias (-1.0 to 1.0)
        // t = triggerValue
        // k = S > 0 ? 1.0 - S * 0.8 : 1.0 + (-S * 3.0)
        // t_adj = pow(t, k)
        const S = (this._pressureBias !== undefined) ? this._pressureBias : 0.0;
        let k = 1.0;
        if (isNaN(worldRadius)) worldRadius = 3.0; // Fallback
        const t_adj = Math.pow(triggerValue, k);
        const minPct = (this._minRadiusPct !== undefined) ? this._minRadiusPct : 10;
        const minRadius = worldRadius * (minPct / 100.0);
        worldRadius = minRadius + (worldRadius - minRadius) * t_adj;
      }
      if (isNaN(worldRadius)) worldRadius = 3.0; // Fallback again

      var isNegative = (options && options.isNegative) || this._negative;
      var gridRadius = worldRadius;
      if (this._buildUp) {
        let t = 1.0;
        const rampTime = 0.8; // Time in seconds to reach full brush size
        const elapsed = (performance.now() - this._strokeStartTime) / 1000.0;
        
        if (isNegative) {
          t = 1.0 - (elapsed / rampTime); // Shrink from max to 0!
          if (t < 0.0) t = 0.0;
        } else {
          t = elapsed / rampTime; // Grow from 0 to max!
          if (t > 1.0) t = 1.0;
        }
        gridRadius = worldRadius * t;
      }
      // Throttling for mesh updates?
      // VR runs at 72/90/120Hz. We can post edits every frame.
      // But invalidating mesh every frame might be expensive if we ask for `returnMesh: true`.
      // We should ask for mesh only every N frames or based on time?
      // Or just let Worker handle it? Worker is async.
      // If we flood it, it lags.
      // Let's rely on standard logic (maybe throttle `returnMesh`?)
      // The desktop `stroke` logic throttles `returnMesh`.
      const now = performance.now();
      const returnMesh = !this._pendingMeshUpdate; // Adaptive Throttling!
      if (returnMesh) {
          this._pendingMeshUpdate = true; // Lock it!
          this._lastMeshTime = now;
      }


      var color = this._color || [1.0, 1.0, 1.0]; // Follow selected Color Picker
      if (picking && picking.color) color = picking.color;
      const sm = this._main.getSculptManager();
      if (sm && sm._activeColor) color = sm._activeColor;

      if (isNaN(color[0]) || isNaN(color[1]) || isNaN(color[2])) {
        color = [1.0, 1.0, 1.0]; // Fallback
      }

      // Use options.isNegative OR this._negative (UI Toggle)
      var isNegative = (options && options.isNegative) || this._negative;

      // INTENSITY MODULATION
      // We calculate 'strength' which is used for INFLATE.
      // For ADD/SUB (Edit Sphere), VoxelState currently doesn't support variable density/strength,
      // so we use strength only to determine sign (Add vs Sub) if we wanted to merge them,
      // but 'mode' already defines Add vs Sub.
      // "Intensity Modulation" for Add/Sub is effectively ignored until VoxelState supports it.

      var strength = (this._intensity !== undefined) ? this._intensity : 0.5;
      if (this._modulateIntensity) {
        // Reuse triggerValue (0..1)
        const S = (this._pressureBias !== undefined) ? this._pressureBias : 0.0;
        let k = 1.0;
        if (S > 0) k = 1.0 - (S * 0.8);
        else if (S < 0) k = 1.0 + (-S * 3.0);
        const t_adj = Math.pow(triggerValue, k);

        const minPct = (this._minIntensityPct !== undefined) ? this._minIntensityPct : 10;
        const minStrength = strength * (minPct / 100.0);
        strength = minStrength + (strength - minStrength) * t_adj;
      }
      if (isNaN(strength)) strength = 0.5; // Fallback

      // Apply Negative Sign if needed (for Inflate/Deflate)
      if (isNegative) strength = -strength;


      if (this._worker) {
        let cx = 0, cy = 0, cz = 0;
        if (this._gridMatrix) {
          const maxExtent = this._gridMatrix[0] * this._res;
          const halfExtent = maxExtent / 2.0;
          cx = this._gridMatrix[12] + halfExtent;
          cy = this._gridMatrix[13] + halfExtent;
          cz = this._gridMatrix[14] + halfExtent;
        }

        const sX = workspacePos[0] - cx;
        const sY = workspacePos[1] - cy;
        const sZ = workspacePos[2] - cz;

        // Check mode
        var mode = (this._mode !== undefined) ? this._mode : 0; // 0=Add, 1=Sub, 2=Inflate, 3=Smooth
        
        var shapeNum = (this._shape !== undefined) ? this._shape : 0;
        var brushRot = null;
        var brushRotSym = null;
        if (this._alignToController && shapeNum === 1 && options && options.quat) {
            brushRot = Array.from(options.quat);
            brushRotSym = [brushRot[0], -brushRot[1], -brushRot[2], brushRot[3]];
        }

        if (mode === 2) {
          // INFLATE
          this._worker.postMessage({
            type: 'INFLATE',
            center: [sX, sY, sZ],
            radius: gridRadius,
            strength: strength,
            shape: shapeNum,
            brushRotation: brushRot,
            returnMesh: returnMesh
          });

          // Symmetry Stroke
          if (sym) {
            this._worker.postMessage({
              type: 'INFLATE',
              center: [-sX, sY, sZ],
              radius: gridRadius,
              strength: strength,
              shape: shapeNum,
              brushRotation: brushRotSym,
              returnMesh: false
            });
          }
        } else if (mode === 3) {
          // SMOOTH_SPHERE
          this._worker.postMessage({
            type: 'SMOOTH_SPHERE',
            center: [sX, sY, sZ],
            radius: gridRadius,
            strength: strength,
            shape: shapeNum,
            brushRotation: brushRot,
            returnMesh: returnMesh
          });

          // Symmetry Stroke
          if (sym) {
            this._worker.postMessage({
              type: 'SMOOTH_SPHERE',
              center: [-sX, sY, sZ],
              radius: gridRadius,
              strength: strength,
              shape: shapeNum,
              brushRotation: brushRotSym,
              returnMesh: false
            });
          }
        } else if (this._buildUp && mode === 0 && isNegative) {
          // Hijack Add-Negative to become Deflate when Build Up is active!
          this._worker.postMessage({
            type: 'INFLATE',
            center: [sX, sY, sZ],
            radius: gridRadius,
            strength: -Math.abs(strength), // Ensure negative for deflate
            shape: shapeNum,
            brushRotation: brushRot,
            returnMesh: returnMesh
          });

          if (sym) {
            this._worker.postMessage({
              type: 'INFLATE',
              center: [-sX, sY, sZ],
              radius: gridRadius,
              strength: -Math.abs(strength),
              shape: shapeNum,
              brushRotation: brushRotSym,
              returnMesh: false
            });
          }
        } else if (mode === 0 || mode === 1) {
          // EDIT_SPHERE
          var isSub = (mode === 1) || isNegative;

          this._worker.postMessage({
            type: 'EDIT_SPHERE',
            center: [sX, sY, sZ],
            radius: gridRadius,
            color: [Math.pow(color[0], 1/2.2), Math.pow(color[1], 1/2.2), Math.pow(color[2], 1/2.2)],
            isNegative: isSub,
            shape: shapeNum,
            brushRotation: brushRot,
            returnMesh: returnMesh
          });

          // Symmetry Stroke
          if (sym) {
            this._worker.postMessage({
              type: 'EDIT_SPHERE',
              center: [-sX, sY, sZ],
              radius: gridRadius,
              color: [Math.pow(color[0], 1/2.2), Math.pow(color[1], 1/2.2), Math.pow(color[2], 1/2.2)],
              isNegative: isSub,
              shape: shapeNum,
              brushRotation: brushRotSym,
              returnMesh: false // Don't ask for mesh twice
            });
          }
        } else if (mode === 4 && this._moveProxyActive && this._voxelMesh) {
          // MOVE PROXY UPDATE (Visual Only)
          var translation = vec3.create();
          vec3.sub(translation, workspacePos, this._moveStartXRPos);
          vec3.copy(this._moveProxyLastTranslation, translation);

          var rotation = quat.create();
          var hasQuat = false;
          if (options && options.quat && this._moveStartXRQuat) {
             var invStart = quat.create();
             quat.invert(invStart, this._moveStartXRQuat);
             quat.multiply(rotation, options.quat, invStart); 
             vec3.copy(this._moveProxyLastQuat, rotation);
             hasQuat = true;
          }

          var vAr = this._voxelMesh.getVertices();
          var origVAr = this._moveProxyVAr;
          var step = this._step;
          var min = this._min;
          
          // Translation in Grid Space
          var tx = translation[0] / step;
          var ty = translation[1] / step;
          var tz = translation[2] / step;
          
          var cx_start = (this._moveStartXRPos[0] - min[0]) / step;
          var cy_start = (this._moveStartXRPos[1] - min[1]) / step;
          var cz_start = (this._moveStartXRPos[2] - min[2]) / step;
          var pr = this._moveProxyRadius / step;
          
          // Determine iterative steps to prevent spatial folding
          var trLen = Math.sqrt(tx*tx + ty*ty + tz*tz);
          var steps = Math.ceil(trLen / (pr * 0.15));
          if (steps < 1) steps = 1;
          if (steps > 20) steps = 20;
          
          var step_tx = tx / steps;
          var step_ty = ty / steps;
          var step_tz = tz / steps;
          
          var stepRot = null;
          if (hasQuat) {
            stepRot = quat.create();
            quat.slerp(stepRot, quat.create(), rotation, 1.0 / steps);
          }

          var vTemp = vec3.create();

          for (var i = 0; i < this._moveProxyIVerts.length; i++) {
             var idx = this._moveProxyIVerts[i];
             var px = origVAr[idx];
             var py = origVAr[idx+1];
             var pz = origVAr[idx+2];
             
             var cx_step = cx_start;
             var cy_step = cy_start;
             var cz_step = cz_start;
             
             for (var s = 0; s < steps; s++) {
               var dx = px - cx_step;
               var dy = py - cy_step;
               var dz = pz - cz_step;
               
               var dist = Math.sqrt(dx*dx + dy*dy + dz*dz) / pr;
               if (dist < 1.0) {
                 var fallOff = dist * dist;
                 fallOff = 3.0 * fallOff * fallOff - 4.0 * fallOff * dist + 1.0;
                 
                 var offX = step_tx * fallOff;
                 var offY = step_ty * fallOff;
                 var offZ = step_tz * fallOff;

                 if (hasQuat) {
                   vTemp[0] = dx; vTemp[1] = dy; vTemp[2] = dz;
                   vec3.transformQuat(vTemp, vTemp, stepRot);
                   offX += (vTemp[0] - dx) * fallOff;
                   offY += (vTemp[1] - dy) * fallOff;
                   offZ += (vTemp[2] - dz) * fallOff;
                 }
                 
                 px += offX;
                 py += offY;
                 pz += offZ;
               }
               cx_step += step_tx;
               cy_step += step_ty;
               cz_step += step_tz;
             }
             
             vAr[idx] = px;
             vAr[idx+1] = py;
             vAr[idx+2] = pz;
          }
          
          // Apply Symmetry Proxy
          if (sym && this._moveProxyIVertsSym.length > 0) {
            var stepRotSym = null;
            if (hasQuat && options && options.quat && this._moveStartXRQuat) {
              var curRotSym = [options.quat[0], -options.quat[1], -options.quat[2], options.quat[3]];
              var startRotSym = [this._moveStartXRQuat[0], -this._moveStartXRQuat[1], -this._moveStartXRQuat[2], this._moveStartXRQuat[3]];
              
              var invStartSym = quat.create();
              quat.invert(invStartSym, startRotSym);
              var rotationSym = quat.create();
              quat.multiply(rotationSym, curRotSym, invStartSym); 
              
              stepRotSym = quat.create();
              quat.slerp(stepRotSym, quat.create(), rotationSym, 1.0 / steps);
            }
            
            var cx_start_sym = (-this._moveStartXRPos[0] - min[0]) / step;
            var step_tx_sym = -tx / steps;
            
            for (var i = 0; i < this._moveProxyIVertsSym.length; i++) {
               var idx = this._moveProxyIVertsSym[i];
               var px = origVAr[idx];
               var py = origVAr[idx+1];
               var pz = origVAr[idx+2];
               
               var cx_step_sym = cx_start_sym;
               var cy_step = cy_start;
               var cz_step = cz_start;
               
               for (var s = 0; s < steps; s++) {
                 var dx = px - cx_step_sym;
                 var dy = py - cy_step;
                 var dz = pz - cz_step;
                 
                 var dist = Math.sqrt(dx*dx + dy*dy + dz*dz) / pr;
                 if (dist < 1.0) {
                   var fallOff = dist * dist;
                   fallOff = 3.0 * fallOff * fallOff - 4.0 * fallOff * dist + 1.0;
                   
                   var offX = step_tx_sym * fallOff;
                   var offY = step_ty * fallOff;
                   var offZ = step_tz * fallOff;

                   if (stepRotSym) {
                     vTemp[0] = dx; vTemp[1] = dy; vTemp[2] = dz;
                     vec3.transformQuat(vTemp, vTemp, stepRotSym);
                     offX += (vTemp[0] - dx) * fallOff;
                     offY += (vTemp[1] - dy) * fallOff;
                     offZ += (vTemp[2] - dz) * fallOff;
                   }
                   
                   px += offX;
                   py += offY;
                   pz += offZ;
                 }
                 cx_step_sym += step_tx_sym;
                 cy_step += step_ty;
                 cz_step += step_tz;
               }
               
               vAr[idx] = px;
               vAr[idx+1] = py;
               vAr[idx+2] = pz;
            }
          }

          // Throttled normal update to keep FPS high during drag
          const proxyNow = performance.now();
          // Update positions accurately based on DrawArrays topology
          if (this._voxelMesh.isUsingDrawArrays()) {
            this._voxelMesh.updateDrawArrays(); // Let the Mesh class map the mutated vAr to vArDA
          }
          
          this._voxelMesh.updateGeometryBuffers();
          this._main.render();
        }
      } else {
        // Worker not ready
      }
      // [DEBUG] Trace trace
      // if (Math.random() < 0.05) console.log("Voxel: updateXR stroke sent", localPos);

    } catch (e) {
      if (window.screenLog) window.screenLog(`Voxel XR Error: ${e.message}`, "red");
      console.error(e);
    }
  }

  setResolutionPreview(res) {
    this._pendingRes = res;
    //
  }

  applyResolution() {
    // console.log("[Voxel Debug] applyResolution called. _pendingRes =", this._pendingRes);
    if (!this._pendingRes) {
      // console.log("[Voxel Debug] applyResolution: No pending resolution! Returning.");
      return;
    }
    this.setResolution(this._pendingRes);
  }

  setResolution(res) {
    // console.log("[Voxel Debug] setResolution called with res =", res, "Current this._res =", this._res);
    this._pendingRes = res; // Sync pending
    if (res === this._res) {
      // console.log("[Voxel Debug] setResolution: No change in resolution! Returning.");
      return;
    }

    // Update local cache AFTER check
    this._res = res;
    
    let size = 1.0; // Fallback for empty scene
    const mesh = this._main.getMesh();
    
    if (mesh) {
      let w = 1.0, h = 1.0, d = 1.0;
      const threeMesh = mesh.getThreeMesh ? mesh.getThreeMesh() : null;

      if (threeMesh && threeMesh.geometry) {
        // Use LOCAL Geometry Bounding Box to ignore parent transforms and get true Simulation Size!
        threeMesh.geometry.computeBoundingBox();
        const box = threeMesh.geometry.boundingBox;
        
        w = box.max.x - box.min.x;
        h = box.max.y - box.min.y;
        d = box.max.z - box.min.z;
        
        // console.log("[Voxel Debug] Local Geometry Bounding Box Size:", w.toFixed(2), h.toFixed(2), d.toFixed(2));
      } else if (threeMesh) {
        // Fallback to visual size
        const box = new THREE.Box3().setFromObject(threeMesh);
        const sizeVec = new THREE.Vector3();
        box.getSize(sizeVec);
        w = sizeVec.x;
        h = sizeVec.y;
        d = sizeVec.z;
        console.log("[Voxel Debug] Visual Bounding Box Size:", w.toFixed(2), h.toFixed(2), d.toFixed(2));
      } else {
        // Fallback to SculptGL bounding box (if available)
        const bound = mesh.getLocalBound ? mesh.getLocalBound() : null;
        if (bound && bound._max && bound._min) {
          w = bound._max[0] - bound._min[0];
          h = bound._max[1] - bound._min[1];
          d = bound._max[2] - bound._min[2];
          console.log("[Voxel Debug] SculptGL Local Bound Size:", w.toFixed(2), h.toFixed(2), d.toFixed(2));
        } else {
          console.log("[Voxel Debug] Using constant size fallback (1.0)");
        }
      }

      const scale = (mesh.getScale) ? mesh.getScale() : 1.0; // getScale returns a scalar number!
      size = Math.max(w, h, d) * scale * 1.3; // Unify padding!
      
      if (size === 0 || isNaN(size)) {
        size = 1.0; // Default Unit Box
      }

      // Calculate the true world-space center of the mesh to center the box around it!
      const localCenter = mesh.getCenter ? mesh.getCenter() : [0.0, 0.0, 0.0];
      const worldCenter = vec3.create(); // Define OUTSIDE try block scope!
      try {
        const threeMesh = mesh.getThreeMesh ? mesh.getThreeMesh() : null;
        const mat = threeMesh ? threeMesh.matrixWorld.elements : (mesh.getMatrix ? mesh.getMatrix() : mat4.create()); // Fallback to identity
        
        console.log("[Voxel Debug] Computing worldCenter. threeMesh =", !!threeMesh);
        vec3.transformMat4(worldCenter, localCenter, mat); // Apply true world transform!
      } catch (err) {
        console.error("[Voxel Debug] Error inside worldCenter calculation!", err);
        // Fallback to local
        vec3.copy(worldCenter, localCenter);
      }

      this._size = size; // Cache it for reuse
      this._step = size / res;
      const half = size * 0.5;
      this._min = vec3.fromValues(worldCenter[0] - half, worldCenter[1] - half, worldCenter[2] - half);
      this._max = vec3.fromValues(worldCenter[0] + half, worldCenter[1] + half, worldCenter[2] + half);
    } else {
      size = 1.0; // Default Unit Box
      this._size = size;
      this._step = size / res;
      const half = size * 0.5;
      this._min = vec3.fromValues(-half, -half, -half);
      this._max = vec3.fromValues(half, half, half);
    }

    // Update Transform Matrices
    mat4.identity(this._gridMatrix);
    mat4.translate(this._gridMatrix, this._gridMatrix, this._min);
    mat4.scale(this._gridMatrix, this._gridMatrix, [this._step, this._step, this._step]);
    mat4.invert(this._invGridMatrix, this._gridMatrix);


    // Send Re-Init or Resample
    // If we already had a resolution, we are Resampling (preserving data)
    // If this._res was undefined/null before this call, it is an INIT.
    // Wait, we just set this._res = res above.
    // We need to check if we *had* a resolution before.
    // But we overwrite it immediately.
    // Let's check if this._voxelMesh exists? Or just rely on the fact that if we are calling this, we probably want to resample if it's not the first time.
    // Actually, `this._res` is initialized to something?
    // Let's trust that if the worker is running, we can RESAMPLE.
    // But `INIT` is safer for first run.

    // Better logic: Move `this._res = res` AFTER the check.

    const type = (this._voxelMesh) ? 'RESAMPLE' : 'INIT';

    console.log("Voxel Tool: postMessage " + type + " resolution=" + res + " size=" + size + " min=[" + this._min[0].toFixed(2) + ", " + this._min[1].toFixed(2) + ", " + this._min[2].toFixed(2) + "]");
    if (window.screenLog) window.screenLog("Voxel Tool: Sending " + type, "cyan");
    this._worker.postMessage({
      type: type,
      res: res,
      size: size,
      min: [this._min[0], this._min[1], this._min[2]] // Send world min to worker!
    });

    // if (this._voxelMesh) {
    //   this._main.removeMeshes([this._voxelMesh]); // Now safe
    //   this._voxelMesh.release(); // Prevent WebGL Leak
    //   this._voxelMesh = null; // Forced reset
    // }
    this._lastUpdate = 0; // Allow forceInit to run
    this.forceInit();


    if (this._main) this._main.render();
  }

  setRadiusMultiplier(val) {
    this._radiusMult = val;
    //
  }

  updateVoxelMesh(res) {
    // if (window.screenLog)
    //   window.screenLog(`Voxel Tool: updateVoxelMesh (Verts=${res.vertices.length / 3}, Faces=${res.faces.length / 4})`, "cyan");
    // console.log(`[SculptVoxel] updateVoxelMesh called with Verts=${res.vertices.length / 3}, Faces=${res.faces.length / 4}`);

    if (res.vertices.length === 0) {
      if (this._voxelMesh) {
        this._voxelMesh.setVisible(false);
      }
      this._pendingMeshUpdate = false;
      return;
    }


    // Diagnostic: Check for NaN in vertices
    let hasNaN = false;
    for (let i = 0; i < res.vertices.length; i++) {
      if (isNaN(res.vertices[i])) {
        hasNaN = true;
        break;
      }
    }
    if (hasNaN) {
      // Use fallback
      this._meshReplaceFallbackCount = (this._meshReplaceFallbackCount || 0) + 1;
    }

    if (window.screenLog && this._lastUpdate % 20 === 0) {
       // window.screenLog(`VoxelUpdate: V=${res.vertices.length/3}`, "grey");
    }

    const isFirstRun = !this._voxelMesh;
    var newMesh = this._voxelMesh;

    if (isFirstRun) {
      newMesh = new MeshStatic(this._main._gl);
      newMesh._isVoxel = true;
      newMesh.setID(MeshStatic.ID++);
      newMesh._typeName = "VoxelMesh"; // Name in UI Outliner
      
      const self = this;
      const originalSetVisible = newMesh.setVisible;
      newMesh.setVisible = function(val) {
        if (originalSetVisible) originalSetVisible.call(this, val);
        else newMesh._isVisible = val; // Direct fallback if base doesn't have it
        self.toggleChunksVisibility(val);
      };
    }
    
    if (this._pendingOffset && this._pendingSize) {
      if (window.screenLog) {
        // window.screenLog(`[SculptVoxel] consumeOffset [${this._pendingOffset[0].toFixed(3)}, ${this._pendingOffset[1].toFixed(3)}, ${this._pendingOffset[2].toFixed(3)}] size=${this._pendingSize.toFixed(3)}`, "cyan");
      }

      // Update gridMatrix to center the tight simulation box around the mesh
      this._gridMatrix[12] = this._pendingOffset[0];
      this._gridMatrix[13] = this._pendingOffset[1];
      this._gridMatrix[14] = this._pendingOffset[2];
      
      if (window.screenLog) {
        // window.screenLog(`[SculptVoxel] gridMatrix Translate [${this._gridMatrix[12].toFixed(3)}, ${this._gridMatrix[13].toFixed(3)}, ${this._gridMatrix[14].toFixed(3)}]`, "cyan");
      }
      
      const scale = this._pendingSize / ((this._pendingRes || 128) - 1);
      this._gridMatrix[0] = scale;
      this._gridMatrix[5] = scale;
      this._gridMatrix[10] = scale;
      
      if (this._pendingRes) this._res = this._pendingRes; // FIXED

      this._size = this._pendingSize; // Update tool size!
      
      const half = this._size / 2;
      this._min = vec3.fromValues(-half, -half, -half);
      this._max = vec3.fromValues(half, half, half);

      this._pendingOffset = null; // Consume
      this._pendingSize = null; // Consume
      this._pendingRes = null; // Consume
    }

    mat4.copy(newMesh.getMatrix(), this._gridMatrix);
    newMesh.setVertices(res.vertices); // Restore missing vertices
    newMesh.setFaces(res.faces); // Pure Quads from SurfaceNets
    newMesh.setColors(res.colors);
    const threeMesh = newMesh.getThreeMesh();
    if (threeMesh && threeMesh.geometry && threeMesh.geometry.attributes.color) {
        threeMesh.geometry.attributes.color.itemSize = 3; // Force size 3
    }
    newMesh.setMaterials(res.materials);
    newMesh.setNormals(res.normals); // Fix: Use pre-computed normals from worker!


    if (res.normals && res.normals.length > 0) {
      newMesh.setNormals(res.normals);
    } else {
      newMesh.setNormals(null);
    }

    // OPTIMIZATION: Manually init necessary components to avoid heavy compute
    newMesh.initColorsAndMaterials();
    newMesh.allocateArrays();
    newMesh.initFaceRings(); // Needed for edge computation
    // newMesh.initEdges(); // Commented out to restore 30fps+ during interaction!
    // newMesh.optimize(); // SKIP (Expensive cache optimization)
    // newMesh.initVertexRings(); // SKIP (Smoothing only)
    newMesh.initRenderTriangles(); // Needed for picking
    newMesh.updateFacesAabb(); 
    newMesh.updateOctree();

    if (isFirstRun) {
      newMesh.initThreeMesh();
    }

    newMesh.updateBuffers(); // PUSH TO GPU!
    newMesh.initRender();

    // Copy states from old mesh before swap
    if (!isFirstRun) {
      newMesh.setShaderType(this._voxelMesh.getShaderType());
      newMesh.setFlatShading(this._voxelMesh.getFlatShading());
      
      // Ensure topology is built BEFORE copying wireframe state
      if (this._voxelMesh.getShowWireframe()) {
        newMesh._wireframe = null; // Force rebuild!
        newMesh.allocateArrays();
        newMesh.initFaceRings();
        newMesh.initEdges();
        newMesh.updateGeometry();
        newMesh.updateWireframeBuffer(); // PUSH TO GPU AFTER EDGES BUILT!
      }

      newMesh.setShowWireframe(this._voxelMesh.getShowWireframe());
      newMesh.setMatcap(this._voxelMesh.getMatcap()); // Ensure matcap index is copied
      newMesh.setFlatColor(this._voxelMesh.getFlatColor());

      if (!this._main.getMeshes().includes(this._voxelMesh)) {
        this._main.addNewMesh(newMesh);
      } else {
        this._main.replaceMesh(this._voxelMesh, newMesh);
      }
      // Only release the OLD mesh if we actually created a NEW one!
      if (this._voxelMesh && this._voxelMesh !== newMesh) {
          this._voxelMesh.setTexture0(null);
          this._voxelMesh.release();
      }

      this._voxelMesh = null;
    } else {
      if (this._mesh) {
        newMesh.setShaderType(this._mesh.getShaderType());
        newMesh.setMatcap(this._mesh.getMatcap());
        newMesh.setFlatShading(this._mesh.getFlatShading());
        newMesh.setFlatColor(this._mesh.getFlatColor());
      } else {
        newMesh.setShaderType(Enums.Shader.MATCAP);
        newMesh.setFlatShading(false);
      }
      if (this._pendingSourceMesh) {
        const sourceMesh = this._pendingSourceMesh;
        const voxelMesh = newMesh;
        
        // Copy material and wireframe settings!
        newMesh.setShaderType(sourceMesh.getShaderType());
        newMesh.setMatcap(sourceMesh.getMatcap());
        newMesh.setFlatShading(sourceMesh.getFlatShading());
        newMesh.setFlatColor(sourceMesh.getFlatColor());
        if (sourceMesh.getShowWireframe && newMesh.setShowWireframe) {
          newMesh.setShowWireframe(sourceMesh.getShowWireframe());
        }
        
        const undoOp = () => {
          voxelMesh.setVisible(false);
          if (voxelMesh.getThreeMesh()) voxelMesh.getThreeMesh().visible = false;
          
          sourceMesh.setVisible(true);
          if (sourceMesh.getThreeMesh()) sourceMesh.getThreeMesh().visible = true;
          
          const idx = this._main.getMeshes().indexOf(voxelMesh);
          if (idx >= 0) this._main.getMeshes().splice(idx, 1);
          if (this._main._worldGroup && voxelMesh.getThreeMesh()) {
            this._main._worldGroup.remove(voxelMesh.getThreeMesh());
          }
          
          this._main.setMesh(sourceMesh);
          if (this._main.guiXR) this._main.guiXR.refreshSceneWidget();
          if (this._main.guiXR) this._main.guiXR._needsRedraw = true;
        };
        
        const redoOp = () => {
          sourceMesh.setVisible(false);
          if (sourceMesh.getThreeMesh()) sourceMesh.getThreeMesh().visible = false;
          
          voxelMesh.setVisible(true);
          if (voxelMesh.getThreeMesh()) voxelMesh.getThreeMesh().visible = true;
          
          if (!this._main.getMeshes().includes(voxelMesh)) {
            this._main.getMeshes().push(voxelMesh);
            if (this._main._worldGroup && voxelMesh.getThreeMesh()) {
              this._main._worldGroup.add(voxelMesh.getThreeMesh());
            }
          }
          
          this._main.setMesh(voxelMesh);
          if (this._main.guiXR) {
            this._main.guiXR.refreshSceneWidget();
            this._main.guiXR.refreshToolsWidget();
            this._main.guiXR._needsRedraw = true;
          }
          if (this._main._guiMini) {
            this._main._guiMini.refreshToolsWidget();
            this._main._guiMini._needsRedraw = true;
          }
        };
        
        redoOp();
        this._main.getStateManager().pushStateCustom(undoOp, redoOp);
        this._pendingSourceMesh = null;
      } else {
        this._main.addNewMesh(newMesh);
      }
      
      // CRITICAL: We ONLY execute this heavy operation on the strictly first instantiation.
      // Subsequent generic mesh update strokes will natively trigger `newMesh.updateBuffers()` below
      // which gracefully uses subData array patching.
      newMesh.initThreeMesh();
    }
    
    this._voxelMesh = newMesh;
// COMMENTED OUT TO PREVENT SCALE OVERWRITE
//     // Apply Transformations
//     var step = this._step;
//     var worldMat = this._voxelMesh.getMatrix();
//     mat4.identity(worldMat);
//     mat4.translate(worldMat, worldMat, this._min);
//     mat4.scale(worldMat, worldMat, [step, step, step]);

    this._voxelMesh.setVisible(true);

    // BOUNDS PRE-COMPUTE - Fixes mesh clipping caused by uninitialized AABB Infinity limits
    newMesh.computeAabb();

    // CRITICAL FIX: Upload all buffers to GPU (Vertices, Normals, Colors, Indices)
    // This fixes the "Black Artifacts" (missing normals) and potentially "Insufficient buffer size" (sync).
    this._voxelMesh.updateBuffers();
    // Keep the wireframe overlay in sync — the geometry is replaced each edit.
    if (this._voxelMesh.getShowWireframe && this._voxelMesh.getShowWireframe()) {
      this._voxelMesh.updateWireframeBuffer?.();
    }
    this._pendingMeshUpdate = false;

    // Ensure Proxy is visually active and selected
    if (this._main.getMesh() !== this._voxelMesh) {
      this._main.setMesh(this._voxelMesh);
    }

    // Enable picking on the voxel mesh to allow Surface Lock
    this._voxelMesh.isPickable = true;

    // Force DYNAMIC_DRAW
    if (this._voxelMesh.getVertexBuffer()) this._voxelMesh.getVertexBuffer()._hint = this._main._gl.DYNAMIC_DRAW;
    if (this._voxelMesh.getNormalBuffer()) this._voxelMesh.getNormalBuffer()._hint = this._main._gl.DYNAMIC_DRAW;
    if (this._voxelMesh.getColorBuffer()) this._voxelMesh.getColorBuffer()._hint = this._main._gl.DYNAMIC_DRAW;
    if (this._voxelMesh.getMaterialBuffer()) this._voxelMesh.getMaterialBuffer()._hint = this._main._gl.DYNAMIC_DRAW;
    if (this._voxelMesh.getIndexBuffer()) this._voxelMesh.getIndexBuffer()._hint = this._main._gl.DYNAMIC_DRAW;
    if (this._voxelMesh.getWireframeBuffer()) this._voxelMesh.getWireframeBuffer()._hint = this._main._gl.DYNAMIC_DRAW;
    // Removed duplicate calls

    if (this._autoBake) {
      this._autoBake = false;
      setTimeout(() => {
        this.bakeToMesh();
      }, 50);
    }
  }

  toggleChunksVisibility(val) {
    if (!this._chunkMap) return;
    
    // Convert Map values or object properties to an array if needed
    // In updateVoxelChunks we use `if (!this._chunkMap) this._chunkMap = new Map();`
    // Wait, let's verify if _chunkMap is a Map or a plain object!
    // At line 1618: `if (!this._chunkMap) this._chunkMap = new Map();`
    // So it is a Map!
    this._chunkMap.forEach((mesh) => {
      mesh.setVisible(val);
      if (mesh.getThreeMesh()) {
        mesh.getThreeMesh().visible = val;
      }
    });
  }

  updateVoxelChunks(chunks) {
    if (!this._chunkMap) this._chunkMap = new Map();

    // console.log(`[SculptVoxel] updateVoxelChunks received ${chunks.length} chunks.`);

    for (const chunk of chunks) {
      let mesh = this._chunkMap.get(chunk.id);
      
      if (chunk.vertices.length === 0) {
         if (mesh) mesh.setVisible(false);
         continue;
      }

      if (!mesh) {
        mesh = new MeshStatic(this._main._gl);
        mesh._isVoxel = true;
        mesh.setID(MeshStatic.ID++);
        this._chunkMap.set(chunk.id, mesh);

        // Pre-allocate 5k vertex capacity (Fast!)
        const capacity = 5000;
        mesh.setVertices(new Float32Array(capacity * 3)); // Tiny pool
        mesh.setFaces(new Uint32Array(capacity * 4));
        mesh.setColors(new Float32Array(capacity * 3));
        mesh.setMaterials(new Float32Array(capacity * 3));
        
        // World matrix sync
        var tmp = mat4.create();
        mat4.identity(tmp);
        mat4.translate(tmp, tmp, this._min);
        var step = this._step;
        mat4.scale(tmp, tmp, [step, step, step]);
        mat4.copy(mesh.getMatrix(), tmp);

        mesh.initColorsAndMaterials();
        mesh.allocateArrays();
        mesh.initRenderTriangles();
        mesh.updateFacesAabb();
        mesh.updateOctree();
        mesh.initRender();

        mesh.initThreeMesh(); // Create ThreeJS mesh handle BEFORE adding to scene!
        mesh._isVoxelChunk = true; // Use flag to hide from UI while keeping in scene
        this._main.getMeshes().push(mesh); // Add to main list for picking/uniforms
        
        if (this._main._worldGroup) {
          this._main._worldGroup.add(mesh.getThreeMesh());
        } else {
          this._main.addNewMesh(mesh); // Fallback if _worldGroup is missing
        }

        if (this._voxelMesh) {
           mesh.setShaderType(this._voxelMesh.getShaderType());
           mesh.setMatcap(this._voxelMesh.getMatcap());
           mesh.setFlatShading(this._voxelMesh.getFlatShading());
        }
      }

      mesh.setVertices(chunk.vertices);
      mesh.setFaces(chunk.faces);
      if (chunk.colors) mesh.setColors(chunk.colors);
      if (chunk.materials) mesh.setMaterials(chunk.materials);
      if (chunk.normals) mesh.setNormals(chunk.normals);

      if (this._voxelMesh && mesh.getShaderType() !== this._voxelMesh.getShaderType()) {
         mesh.setShaderType(this._voxelMesh.getShaderType());
         mesh.setMatcap(this._voxelMesh.getMatcap());
         mesh.setFlatShading(this._voxelMesh.getFlatShading());
      }

      mesh.setVisible(true);
      
      if (mesh.getVertexBuffer()) mesh.getVertexBuffer()._hint = this._main._gl.DYNAMIC_DRAW;
      if (mesh.getIndexBuffer()) mesh.getIndexBuffer()._hint = this._main._gl.DYNAMIC_DRAW;
      
      mesh.updateBuffers(); // Sync to GPU
      
      // Update wireframe if enabled!
      if (mesh.getShowWireframe && mesh.getShowWireframe()) {
        mesh._wireframe = null; // Force rebuild!
        mesh.updateWireframeBuffer();
        
        // Force Three.js to use the new array!
        const rd = mesh.getRenderData();
        if (rd && rd._wireframeMesh) {
          const wireGeom = rd._wireframeMesh.geometry;
          const indices = mesh.getWireframe();
          wireGeom.setIndex(new THREE.BufferAttribute(indices, 1));
          wireGeom.setDrawRange(0, indices.length);
        }
      }
    }
  }

  // Bake Voxel Mesh to Standard Multimesh
  bakeToMesh() {
    if (!this._voxelMesh) {
      if (window.screenLog) window.screenLog("Bake Error: No Voxel Mesh to Bake", "red");
      return;
    }

    const main = this._main;
    const gl = main._gl;

    if (this._voxelBounds) {
      this._voxelBounds.setVisible(false);
    }

    try {
      const vAr = new Float32Array(this._voxelMesh.getVertices());
      const mat = this._voxelMesh.getMatrix();
      const temp = vec3.create();
      for (let i = 0; i < vAr.length; i += 3) {
        temp[0] = vAr[i];
        temp[1] = vAr[i + 1];
        temp[2] = vAr[i + 2];
        vec3.transformMat4(temp, temp, mat);
        vAr[i] = temp[0];
        vAr[i + 1] = temp[1];
        vAr[i + 2] = temp[2];
      }

      const quadFaces = this._voxelMesh.getFaces();
      const fAr = new Uint32Array(quadFaces);

      const staticMesh = new MeshStatic(gl);
      staticMesh.setVertices(vAr);
      staticMesh.setFaces(fAr);

      const voxelColors = this._voxelMesh.getColors();
      const cAr = voxelColors ? new Float32Array(voxelColors) : new Float32Array(vAr.length).fill(1.0);
      staticMesh.setColors(cAr);

      // Fully initialize arrays and topology AFTER setting colors
      staticMesh.init();
      staticMesh.allocateArrays();
      staticMesh.initFaceRings();
      staticMesh.initEdges();
      staticMesh.initRenderTriangles();
      staticMesh.updateFacesAabb();
      staticMesh.updateOctree();

      staticMesh.initRender();

      // NOW safe to change render states
      staticMesh.setUseDrawArrays(false);
      staticMesh.setMode(this._main._gl.TRIANGLES);
      
      staticMesh.setShaderType(Enums.Shader.MATCAP);
      staticMesh.setMatcap(0);
      staticMesh.setFlatColor([0.6, 0.6, 0.6]);
      const materials = staticMesh.getMaterials();
      for (let k = 0; k < materials.length; k += 3) {
        materials[k] = 0.18;
        materials[k + 1] = 0.08;
        materials[k + 2] = 1.0;
      }

      staticMesh.updateGeometry();
      staticMesh.setFlatShading(false);
      staticMesh.setShowWireframe(false);
      staticMesh.updateBuffers();

      const multiMesh = new Multimesh(staticMesh);
      multiMesh.init();
      multiMesh.updateResolution();

      if (multiMesh.getThreeMesh()) {
        multiMesh.getThreeMesh().userData.sculptMesh = multiMesh;
      }

      if (window.screenLog) window.screenLog(`MultiMesh: Tris=${multiMesh.getNbTriangles()}`, "cyan");

      // Assign Unique Mesh Name
      let baseName = 'mesh';
      let counter = 1;
      let isUnique = false;
      
      while (!isUnique) {
        let match = false;
        const testName = baseName + counter;
        for (let m of main.getMeshes()) {
          const uiName = m.uiName || m._uiName || m._name;
          if (uiName === testName) {
            match = true;
            break;
          }
        }
        if (!match) {
          isUnique = true;
          multiMesh.uiName = testName;
          multiMesh._uiName = testName;
          multiMesh._permanentStaticLabel = testName;
        } else {
          counter++;
        }
      }

      // 5. Add to Scene
      main.addNewMesh(multiMesh);

      // 6. Reset Voxel State (Clear Grid)
      this._worker.postMessage({ type: 'CLEAR' });

      // CRITICAL: REMOVE the Voxel Mesh to prevent occlusion
      this._voxelMesh.setVisible(false); // NUCLEAR OPTION: Hide it first!
      this._main.removeMeshes([this._voxelMesh]);
      this._voxelMesh.setTexture0(null); // Prevent global texture deletion
      this._voxelMesh = null; // Prevent stale reference bugs

      // Also remove Debug Cube if present
      if (this._debugCube) {
        this._debugCube.setVisible(false);
        this._main.removeMeshes([this._debugCube]);
      }

      // 7. Auto-Switch to Brush (Standard Workflow)
      this._main.getSculptManager().setToolIndex(Enums.Tools.BRUSH);

      // Sync UI to Brush
      if (this._main.getGui() && this._main.getGui()._ctrlSculpt) {
        this._main.getGui()._ctrlSculpt.setValue(Enums.Tools.BRUSH);
      }
      window._activeToolTab = 0;
      const guiXR = this._main.getGuiXR();
      if (guiXR) {
        guiXR.refreshToolsWidget();
        guiXR._needsRedraw = true;
      }
      if (this._main._guiMini) {
        this._main._guiMini.refreshToolsWidget();
        this._main._guiMini._needsRedraw = true;
      }

      // 8. Select the New Mesh
      this._main.setMesh(multiMesh);

      // VERIFICATION: Check if selection stuck
      if (this._main.getMesh() !== multiMesh) {
        console.error("Voxel Bake: Failed to set active mesh!");
        if (window.screenLog) window.screenLog("Bake Error: Mesh Selection Failed", "red");
      } else {
        console.log("Voxel Bake: Active Mesh Set to", multiMesh.getID());
        if (window.screenLog) window.screenLog("Bake Success: Mesh Selected", "lime");
      }
    } catch (e) {
      console.error("BAKESH ERROR!", e);
      if (window.screenLog) window.screenLog(`Bake Exception: ${e.message}`, "red");
    }

    // Force Render to verify visibility
    this._main.render();
  }

  getDrawables() {
    return [this._cursorMeshSphere, this._cursorMeshCube, this._cursorMeshSymSphere, this._cursorMeshSymCube]; // Removed _voxelBounds
  }

  renderVR(main, camera) {
    if (this._voxelBounds) {
      this._voxelBounds.render(main, this._size, this._gridMatrix);
    }
  }

  hideOtherMeshes() {
    // Helper to hide everything except Voxel Mesh
    if (this._hiddenOthers) return;
    this._hiddenOthers = true;

    const meshes = this._main.getMeshes();
    for (let m of meshes) {
      if (m !== this._voxelMesh && m !== this._debugCube) {
        if (m.isVisible()) {
          m.setVisible(false);
          // Tag it so we know we hid it?
          m._autoHiddenByVoxel = true;
        }
      }
    }
    if (window.screenLog) window.screenLog("Voxel: Default Meshes Hidden", "grey");
  }

  unhideOtherMeshes() {
    // Helper to restore
    /*
    if (!this._hiddenOthers) return;
    this._hiddenOthers = false;
    const meshes = this._main.getMeshes();
    for (let m of meshes) {
      if (m._autoHiddenByVoxel) {
        m.setVisible(true);
        delete m._autoHiddenByVoxel;
      }
    }
    */
    // Decision: Do NOT unhide automatically. Let user manage scene.
  }

  bake() {
    this.bakeToMesh();
  }

  debugState() {
    return {
      worker: !!this._worker,
      mesh: !!this._voxelMesh,
      meshInScene: this._voxelMesh ? this._main.getMeshes().includes(this._voxelMesh) : false,
      pending: this._pendingMeshUpdate,
      requested: this._meshRequested,
      stroke: this._xrStrokeActive
    };
  }

  // Debug Helper: Check vertices for NaN
  checkNaN(arr) {
    for (let i = 0; i < arr.length; i++) {
      if (isNaN(arr[i])) {
        return true;
      }
    }
    return false;
  }
}

export default SculptVoxel;
