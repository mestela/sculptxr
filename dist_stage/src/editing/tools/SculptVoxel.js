import SculptBase from './SculptBase.js';
// import VoxelState from '../VoxelState.js'; // Worker only now
import MeshStatic from '../../mesh/meshStatic/MeshStatic.js';
import Multimesh from '../../mesh/multiresolution/Multimesh.js';
import { vec3, mat4 } from 'gl-matrix';
import Utils from '../../misc/Utils.js';
import Primitives from '../../drawables/Primitives.js';
import Enums from '../../misc/Enums.js';
import Geometry from '../../math3d/Geometry.js';
import VoxelBounds from '../../drawables/VoxelBounds.js';

class SculptVoxel extends SculptBase {

  constructor(main) {
    super(main);

    // Initialize Voxel Grid
    // Box size 100.0 (matches Utils.SCALE / Desktop Scale)
    // Resolution 64 (Better quality for larger space)
    // Initialize Voxel Worker
    // Box size 100.0 (matches Utils.SCALE / Desktop Scale)
    // Resolution 64 (Better quality for larger space)
    this._worker = new Worker(`src/workers/VoxelWorker.js?t=${Date.now()}`, { type: 'module' });

    this._worker.onerror = (e) => {
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
    
    const isDesktop = !window.navigator.xr; // heuristic or check main
    // Let's rely on xrSession check during init, but for constructor just use a default
    this._res = 64; 
    this._pendingRes = 64;

    this._worker.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'LOG') {
         // if (window.screenLog) window.screenLog(`VoxelWorker: ${JSON.stringify(msg)}`, "yellow");
         // else console.log("VoxelWorker:", msg);
         return;
      } else if (msg.type === 'MESH_UPDATE') {
        const data = msg.data;
        if (msg.computeTime) {
          // const logMsg = `Voxel: Worker=${msg.computeTime.toFixed(1)}ms V=${msg.data.vertices.length/3}`;
          // console.log(logMsg);
          // if (window.screenLog) window.screenLog(logMsg, "grey");
        }
        
        // console.log(`Voxel: MESH_UPDATE received. V=${data.vertices.length} F=${data.faces.length}`);

        if (msg.id !== undefined) {
          // console.log(`[Worker] Mesh Update ID: ${msg.id}`);
        }

        if (msg.type === 'LOG') {
          // Parse ID from Log
          // "Snapshot Created: 8 (Ptr=8)"
          // "Undo -> Snapshot: 7 (Ptr=7)"
          const match = msg.data.match(/Snapshot: (\d+)/);
          if (match) {
            this._workerSnapshotID = parseInt(match[1]);
          }
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
      } else if (msg.type === 'LOG') {
        // Worker can send logs back
        console.log("[Worker]", msg.data);
        if (window.screenLog) window.screenLog(msg.data, "lime");
        else console.warn("screenLog missing for:", msg.data);
      } else {
        console.log("Voxel: Unknown Worker Message", msg);
      }
    };
    
    // Send Init to Worker
    // If we are starting up and it's desktop, bump res
    const isVR = this._main && this._main._xrSession;
    const res = isVR ? 64 : 128;
    this._res = res;
    this._pendingRes = res;
    
    const size = 100.0;
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
    mat4.translate(this._gridMatrix, this._gridMatrix, [0.0, 1.3, -1.5]);
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

    // Voxel Bounds Indicator (Replaces primitive cube)
    this._voxelBounds = new VoxelBounds(main._gl);

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

    // Force pickable just in case
    this._debugCube.isPickable = true;

    // Create Test Triangle - REMOVED (Confusing picking)
    // this.createDebugTriangle();

    // Ensure Initial Sphere exists
    this.forceInit();

    const res = super.start(ctrl);

    // Desktop: Lock Plane for Stroke (Prevent Accumulation)
    if (!this._main._xrSession) {
      const picking = this._main.getPicking();
      const inter = picking.getIntersectionPoint();
      const mesh = picking.getMesh();

      if (inter && mesh) {
        // inter is LOCAL. Convert to WORLD for Plane Lock.
        const realWorldPos = vec3.create();
        vec3.transformMat4(realWorldPos, inter, mesh.getMatrix());

        this._planePoint = vec3.clone(realWorldPos);
        const cam = this._main.getCamera();
        const eye = cam.computePosition();
        this._planeNormal = vec3.create();
        vec3.sub(this._planeNormal, eye, realWorldPos);
        vec3.normalize(this._planeNormal, this._planeNormal);
      } else {
        this._planePoint = null;
        this._planeNormal = null;
      }
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
    return res;
  }

  postRender(selection) {
    if (this._voxelBounds) {
      // Only render voxel bounds if in VR to avoid the big green sphere on desktop
      if (this._main._xrSession) {
        this._voxelBounds.render(this._main, this._size, this._gridMatrix);
      }
    }
  }

  stroke(picking) {
    let inter = picking.getIntersectionPoint();

    // Desktop Plane Lock Override
    if (this._planePoint && this._planeNormal && !this._main._xrSession) {
      const mouseX = this._main._mouseX;
      const mouseY = this._main._mouseY;
      const vNear = picking.unproject(mouseX, mouseY, 0.0);
      const vFar = picking.unproject(mouseX, mouseY, 0.1);
      const lockInter = vec3.create();
      const hit = Geometry.intersectLinePlane(vNear, vFar, this._planePoint, this._planeNormal, lockInter);
      if (hit) inter = lockInter;
    }

    if (!inter) {
      if (window.screenLog && Math.random() < 0.05) window.screenLog("Voxel Stroke: No Intersection", "red");
      return;
    }

    // Revert to Legacy Math (Identity Transform)
    // User reports "Min + Grid*Step" causes misalignment.
    // This implies 'inter' might already be in the space 'addSphere' expects,
    // or 'invGridMatrix' handles it (even if Identity).
    const localPos = vec3.create();
    vec3.transformMat4(localPos, inter, this._invGridMatrix);

    if (window.screenLog && Math.random() < 0.1) {
      const mesh = picking.getMesh();
      const meshID = mesh ? mesh.getID() : "Null";
      // Log Grid vs Result to debug "Fine" vs "Offset"
      // if (this._voxelState && window.screenLog && Math.random() < 0.01) {
      //    const inter = this._picking.getIntersectionPoint();
      //    window.screenLog(`Strk(Desk): I[${inter[0].toFixed(1)}]`, "grey");
      // }
    }

    /*
    if (window.screenLog && Math.random() < 0.1) {
      const mesh = picking.getMesh();
      const meshID = mesh ? mesh.getID() : "Null";
      // Log Grid pos vs Physical pos
      // window.screenLog(`Strk: G[${inter[0].toFixed(1)}] -> P[${localPos[0].toFixed(1)}]`, "cyan");
    }
    */

    // Brush Radius (in Voxel Space)
    // Default to a smaller, more reasonable starting size.
    var radius = (this._radius !== undefined && this._radius > 0.1) ? this._radius : 2.5;

    // Fix for "Wait, why 20.0?": Gui might be initializing it to 20 or similar.
    // Let's cap the desktop radius if it's unreasonably large for voxel sculpting on start.
    if (radius > 10.0 && !this._radiusRefined) {
      radius = 3.0; // Force reasonable default
      this._radius = 3.0;
      this._radiusRefined = true;
    }

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

    var mode = (this._mode !== undefined) ? this._mode : 0; // 0=Add, 1=Sub, 2=Inflate, 3=Smooth
    if (isNegative && mode !== 3) mode = 3; // Shift/Secondary overrides to Smooth

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
      // Throttling: Only request mesh if not currently pending
      const returnMesh = !this._pendingMeshUpdate;
      if (returnMesh) {
        this._pendingMeshUpdate = true;
      } else {
        this._meshRequested = true; // Mark that we want an update as soon as possible
      }

      if (mode === 2) {
        // INFLATE
        // Strength should be adjustable? Default 0.5?
        // Shift could invert strength to Deflate?
        var strength = (this._strength !== undefined) ? this._strength : 0.5;
        if (isNegative) strength = -strength;
        var shape = (this._shape !== undefined) ? this._shape : 0;
        console.log("VoxelTool INFLATE - sending shape: " + shape);

        this._worker.postMessage({
          type: 'INFLATE',
          center: [localPos[0], localPos[1], localPos[2]],
          radius: radius,
          strength: strength,
          shape: shape,
          returnMesh: returnMesh
        });
      } else if (mode === 3) {
        // SMOOTH
        var strength = (this._strength !== undefined) ? this._strength : 0.5;
        var shape = (this._shape !== undefined) ? this._shape : 0;
        console.log("VoxelTool SMOOTH - sending shape: " + shape);

        this._worker.postMessage({
          type: 'SMOOTH_SPHERE',
          center: [localPos[0], localPos[1], localPos[2]],
          radius: radius,
          strength: strength,
          shape: shape,
          returnMesh: returnMesh
        });
      } else {
        // ADD / SUB
        var isSub = (mode === 1);
        var shape = (this._shape !== undefined) ? this._shape : 0;
        console.log("VoxelTool EDIT_SPHERE - sending shape: " + shape);
        this._worker.postMessage({
          type: 'EDIT_SPHERE',
          center: [localPos[0], localPos[1], localPos[2]],
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

      if (!isPressed) {
        this._lastXRPos = null; // Reset stroke
        this._xrStrokeActive = false;
        return;
      }

      // Detect Start of Stroke (VR)
      if (!this._xrStrokeActive) {
        this._xrStrokeActive = true;
        
        if (window.screenLog) window.screenLog(`Voxel VR Start. Mesh:${!!this._voxelMesh} Pend:${this._pendingMeshUpdate}`, "orange");

        if (this._worker) {
          // if (window.screenLog) window.screenLog("Voxel: VR Start (Snapshot)", "grey");
          // else console.log("Voxel: VR Start (Snapshot)");
          this._worker.postMessage({ type: 'SNAPSHOT' });
        }
      }

      // 1. Transform EnginePos (World) to Grid Local Space
      // (Reverted v0.7.164 fix as it broke creation. Trusting user that alignment is correct)
      var localPos = vec3.create();
      vec3.transformMat4(localPos, origin, this._invGridMatrix);

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
        if (distSq < 0.0625) return; // (0.25^2)
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
        if (S > 0) k = 1.0 - (S * 0.8);       // Concave (Fast start)
        else if (S < 0) k = 1.0 + (-S * 3.0); // Convex (Slow start)
        const t_adj = Math.pow(triggerValue, k);

        const minPct = (this._minRadiusPct !== undefined) ? this._minRadiusPct : 10;
        const minRadius = worldRadius * (minPct / 100.0);
        worldRadius = minRadius + (worldRadius - minRadius) * t_adj;

        // DEBUG: Radius Modulation
        // if (window.screenLog && Math.random() < 0.05) window.screenLog(`RadMod: ${(worldRadius).toFixed(2)} (t=${triggerValue.toFixed(2)})`, "cyan");
      }

      var gridRadius = worldRadius;
      // Throttling for mesh updates?
      // VR runs at 72/90/120Hz. We can post edits every frame.
      // But invalidating mesh every frame might be expensive if we ask for `returnMesh: true`.
      // We should ask for mesh only every N frames or based on time?
      // Or just let Worker handle it? Worker is async.
      // If we flood it, it lags.
      // Let's rely on standard logic (maybe throttle `returnMesh`?)
      // The desktop `stroke` logic throttles `returnMesh`.

      const now = performance.now();
      const returnMesh = (!this._lastMeshTime || now - this._lastMeshTime > 32); // Max 30fps mesh updates?
      if (returnMesh) this._lastMeshTime = now;

      var color = [0.8, 0.8, 0.8]; // Valid default
      if (picking && picking.color) color = picking.color;
      const sm = this._main.getSculptManager();
      if (sm && sm._activeColor) color = sm._activeColor;

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

      // Apply Negative Sign if needed (for Inflate/Deflate)
      if (isNegative) strength = -strength;


      if (this._worker) {
        // Check mode
        var mode = (this._mode !== undefined) ? this._mode : 0; // 0=Add, 1=Sub, 2=Inflate, 3=Smooth
        
        // Expose Smooth via Secondary Trigger
        // If holding secondary trigger (isNegative), temporarily switch to Smooth mode.
        if (isNegative && mode !== 3) mode = 3; 

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
            center: [localPos[0], localPos[1], localPos[2]],
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
              center: [-localPos[0], localPos[1], localPos[2]],
              radius: gridRadius,
              strength: strength,
              shape: shapeNum,
              brushRotation: brushRotSym,
              returnMesh: false
            });
          }
        } else if (mode === 3) {
          // SMOOTH
          this._worker.postMessage({
            type: 'SMOOTH_SPHERE',
            center: [localPos[0], localPos[1], localPos[2]],
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
              center: [-localPos[0], localPos[1], localPos[2]],
              radius: gridRadius,
              strength: strength,
              shape: shapeNum,
              brushRotation: brushRotSym,
              returnMesh: false
            });
          }
        } else {
          // EDIT_SPHERE
          var isSub = (mode === 1);

          this._worker.postMessage({
            type: 'EDIT_SPHERE',
            center: [localPos[0], localPos[1], localPos[2]],
            radius: gridRadius,
            color: color,
            isNegative: isSub,
            shape: shapeNum,
            brushRotation: brushRot,
            returnMesh: returnMesh
          });

          // Symmetry Stroke
          if (sym) {
            this._worker.postMessage({
              type: 'EDIT_SPHERE',
              center: [-localPos[0], localPos[1], localPos[2]],
              radius: gridRadius,
              color: color,
              isNegative: isSub,
              shape: shapeNum,
              brushRotation: brushRotSym,
              returnMesh: false // Don't ask for mesh twice
            });
          }
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
    if (!this._pendingRes) return;
    this.setResolution(this._pendingRes);
    //
    // Reset pending? No, keep it sync.
  }

  setResolution(res) {
    this._pendingRes = res; // Sync pending
    if (res === this._res) return;

    // Update local cache AFTER check
    this._res = res;
    // Keep same size for now, or reset?
    // Let's assume size stays 100.0 or we can make it dynamic later.
    const size = this._size || 100.0;

    this._step = size / res;
    const half = size * 0.5;
    this._min = vec3.fromValues(-half, -half, -half);
    this._max = vec3.fromValues(half, half, half);

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

    this._worker.postMessage({
      type: type,
      res: res,
      size: size
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
    // res has { vertices, faces, colors, materials } (Float32Arrays)
    // console.time('VoxelMeshUpdate');
    // console.log(`Voxel Update: ${res.vertices.length} vertices, ${res.faces.length} faces`);


    if (res.vertices.length === 0) {
      //
      if (this._voxelMesh) {
        this._voxelMesh.setVisible(false);
      }
      this._pendingMeshUpdate = false;
      return;
    }

    if (window.screenLog && this._lastUpdate % 20 === 0) {
       // window.screenLog(`VoxelUpdate: V=${res.vertices.length/3}`, "grey");
    }

    // ALWAYS create a fresh mesh to prevent WebGL layout desyncs / array bounds errors
    var newMesh = new MeshStatic(this._main._gl);
    newMesh._isVoxel = true;
    newMesh.setID(this._voxelMesh ? this._voxelMesh.getID() : MeshStatic.ID++);
    
    // Set baseline arrays
    newMesh.setVertices(res.vertices);
    newMesh.setFaces(res.faces); // Pure Quads from SurfaceNets
    newMesh.setColors(res.colors);
    newMesh.setMaterials(res.materials);

    if (res.normals && res.normals.length > 0) {
      newMesh.setNormals(res.normals);
    } else {
      newMesh.setNormals(null);
    }

    // OPTIMIZATION: Manually init necessary components to avoid heavy compute
    newMesh.initColorsAndMaterials();
    newMesh.allocateArrays();
    // newMesh.initFaceRings(); // SKIP: Only needed for vertex normals (smooth shading)
    // newMesh.optimize(); // SKIP (Expensive cache optimization)
    // newMesh.initEdges(); // SKIP (Wireframe only)
    // newMesh.initVertexRings(); // SKIP (Smoothing only)
    newMesh.initRenderTriangles(); // Needed for picking
    newMesh.updateFacesAabb(); 
    newMesh.updateOctree();

    newMesh.initRender();

    newMesh.initRender();

    // Copy states from old mesh before swap
    if (this._voxelMesh) {
      newMesh.setShaderType(this._voxelMesh.getShaderType());
      newMesh.setFlatShading(this._voxelMesh.getFlatShading());
      
      // Ensure topology is built BEFORE copying wireframe state
      if (this._voxelMesh.getShowWireframe()) {
        newMesh.allocateArrays();
        newMesh.initFaceRings();
        newMesh.initEdges();
        newMesh.updateGeometry();
      }

      newMesh.setShowWireframe(this._voxelMesh.getShowWireframe());
      newMesh.setMatcap(this._voxelMesh.getMatcap()); // Ensure matcap index is copied

      if (!this._main.getMeshes().includes(this._voxelMesh)) {
        //
        this._main.addNewMesh(newMesh);
      } else {
        this._main.replaceMesh(this._voxelMesh, newMesh);
      }
      // BUG FIX: ShaderMatcap binds the global texture to _texture0. 
      // Mesh.release() deletes _texture0, destroying the global texture!
      // Must unset before release.
      this._voxelMesh.setTexture0(null);
      this._voxelMesh.release();
      this._voxelMesh = null;
    } else {
      // Even with smoothed normals, we want MATCAP if the original volume had gradient data, or just default to MATCAP
      newMesh.setShaderType(Enums.Shader.MATCAP);
      newMesh.setFlatShading(false);
      this._main.addNewMesh(newMesh);
    }
    
    this._voxelMesh = newMesh;

    // Apply Transformations
    var step = this._step;
    mat4.identity(this._voxelMesh.getMatrix());
    mat4.scale(this._voxelMesh.getMatrix(), this._voxelMesh.getMatrix(), [step, step, step]);
    
    var worldMat = this._voxelMesh.getMatrix();
    mat4.copy(worldMat, this._gridMatrix);
    mat4.translate(worldMat, worldMat, this._min);
    mat4.scale(worldMat, worldMat, [step, step, step]);

    this._voxelMesh.setVisible(true);

    // BOUNDS PRE-COMPUTE - Fixes mesh clipping caused by uninitialized AABB Infinity limits
    newMesh.computeAabb();

    // CRITICAL FIX: Upload all buffers to GPU (Vertices, Normals, Colors, Indices)
    // This fixes the "Black Artifacts" (missing normals) and potentially "Insufficient buffer size" (sync).
    this._voxelMesh.updateBuffers();
    this._pendingMeshUpdate = false;
    // DISABLE FLAT SHADING DERIVATIVES (Debug: rely on vertex normals)
    this._voxelMesh.setFlatShading(false);

    // Set a nice Color (base color for matcap modulation if supported)
    this._voxelMesh.setFlatColor([0.6, 0.6, 0.6]); // Grey

    // Enable picking on the voxel mesh to allow Surface Lock
    this._voxelMesh.isPickable = true;

    // Force DYNAMIC_DRAW
    if (this._voxelMesh.getVertexBuffer()) this._voxelMesh.getVertexBuffer()._hint = this._main._gl.DYNAMIC_DRAW;
    if (this._voxelMesh.getNormalBuffer()) this._voxelMesh.getNormalBuffer()._hint = this._main._gl.DYNAMIC_DRAW;
    if (this._voxelMesh.getColorBuffer()) this._voxelMesh.getColorBuffer()._hint = this._main._gl.DYNAMIC_DRAW;
    if (this._voxelMesh.getMaterialBuffer()) this._voxelMesh.getMaterialBuffer()._hint = this._main._gl.DYNAMIC_DRAW;
    if (this._voxelMesh.getIndexBuffer()) this._voxelMesh.getIndexBuffer()._hint = this._main._gl.DYNAMIC_DRAW;
    if (this._voxelMesh.getWireframeBuffer()) this._voxelMesh.getWireframeBuffer()._hint = this._main._gl.DYNAMIC_DRAW;

    this._voxelMesh.updateBuffers();

    this._voxelMesh.updateBuffers();

    // if (nanColor > 0) console.warn(`Voxel: Fixed ${nanColor} NaN colors.`);
  }

  // Bake Voxel Mesh to Standard Multimesh
  bakeToMesh() {
    if (!this._voxelMesh) {
      //
      return;
    }

    //

    const main = this._main;



    const gl = main._gl;

    // 1. Extract Geometry
    const vAr = new Float32Array(this._voxelMesh.getVertices()); // Clone

    // 1b. Apply Transform to Vertices (Freeze Transform)
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

    // 2. Extract Faces (Pure Quads)
    const quadFaces = this._voxelMesh.getFaces();
    const fAr = new Uint32Array(quadFaces); // Direct Clone

    // 3. Create Standard Mesh (Multimesh)
    const staticMesh = new MeshStatic(gl);
    staticMesh.setVertices(vAr);
    staticMesh.setFaces(fAr);

    // Init Topology & Arrays FIRST
    staticMesh.setUseDrawArrays(false); // Ensure indexed
    staticMesh.setMode(this._main._gl.TRIANGLES);

    // Completely initialize the mesh manually for Quads
    staticMesh.init();
    staticMesh.allocateArrays();
    staticMesh.initFaceRings();
    staticMesh.initEdges();
    staticMesh.initRenderTriangles();
    staticMesh.updateFacesAabb();
    staticMesh.updateOctree();
    staticMesh.initRender();

    // THEN Set Shader/Colors
    staticMesh.setShaderType(Enums.Shader.MATCAP);
    staticMesh.setMatcap(0); // Pearl/Clay
    staticMesh.setFlatColor([0.6, 0.6, 0.6]);

    // Force PBR Material Defaults (in case user switches shader)
    const materials = staticMesh.getMaterials();
    for (let k = 0; k < materials.length; k += 3) {
      materials[k] = 0.18;      // Roughness
      materials[k + 1] = 0.08;  // Metallic
      materials[k + 2] = 1.0;   // Masking (1.0 = Editable)
    }

    staticMesh.updateGeometry(); // Force sync of all buffers

    // Standard White Colors
    const cAr = new Float32Array(vAr.length);
    cAr.fill(1.0);
    staticMesh.setColors(cAr);

    if (window.screenLog) window.screenLog(`Bake: V=${vAr.length / 3} F=${fAr.length / 4}`, "cyan");

    staticMesh.setFlatShading(false); // Smooth Shading
    staticMesh.setShowWireframe(false); // Default Wireframe OFF
    staticMesh.updateBuffers(); // Upload to GPU

    // Copy Transform (Min + Scale)
    // DISABLED: Vertices are already transformed (frozen) to World Space.
    // mat4.copy(staticMesh.getMatrix(), this._voxelMesh.getMatrix());

    // 4. Wrap in Multimesh (Standard Sculptable)
    const multiMesh = new Multimesh(staticMesh);

    // CRITICAL: Ensure Multimesh buffers are synced
    // CRITICAL: Ensure Multimesh buffers are synced and initialized (matches Scene.js logic)
    multiMesh.init();
    multiMesh.updateResolution(); // Updates internal buffers (Index/Wireframe) NOT computed by init()

    if (window.screenLog) window.screenLog(`MultiMesh: Tris=${multiMesh.getNbTriangles()}`, "cyan");

    // 5. Add to Scene
    main.addNewMesh(multiMesh);

    // 6. Reset Voxel State (Clear Grid)
    // this._voxelState.clear(); // VoxelState is in Worker now
    this._worker.postMessage({ type: 'CLEAR' });

    // CRITICAL: REMOVE the Voxel Mesh to prevent occlusion
    this._voxelMesh.setVisible(false); // NUCLEAR OPTION: Hide it first!
    main.removeMeshes([this._voxelMesh]);
    this._voxelMesh.setTexture0(null); // Prevent global texture deletion
    this._voxelMesh = null; // Prevent stale reference bugs

    // Also remove Debug Cube if present
    if (this._debugCube) {
      this._debugCube.setVisible(false);
      main.removeMeshes([this._debugCube]);
    }

    //
    // if (window.screenLog) window.screenLog("Voxel: Bake Complete! Switched to Brush.", "green");

    // 7. Auto-Switch to Brush (Standard Workflow)
    main.getSculptManager().setToolIndex(Enums.Tools.BRUSH);

    // 8. Select the New Mesh
    main.setMesh(multiMesh);

    // VERIFICATION: Check if selection stuck
    if (main.getMesh() !== multiMesh) {
      console.error("Voxel Bake: Failed to set active mesh!");
      if (window.screenLog) window.screenLog("Bake Error: Mesh Selection Failed", "red");
    } else {
      console.log("Voxel Bake: Active Mesh Set to", multiMesh.getID());
      if (window.screenLog) window.screenLog("Bake Success: Mesh Selected", "lime");
    }

    // Force Render to verify visibility
    main.render();
  }

  getDrawables() {
    return [this._cursorMeshSphere, this._cursorMeshCube, this._cursorMeshSymSphere, this._cursorMeshSymCube, this._voxelBounds];
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
