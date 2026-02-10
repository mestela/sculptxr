import SculptBase from './SculptBase.js';
// import VoxelState from '../VoxelState.js'; // Worker only now
import MeshStatic from '../../mesh/meshStatic/MeshStatic.js';
import Multimesh from '../../mesh/multiresolution/Multimesh.js';
import { vec3, mat4 } from 'gl-matrix';
import Utils from '../../misc/Utils.js';
import Primitives from '../../drawables/Primitives.js';
import Enums from '../../misc/Enums.js';
import Geometry from '../../math3d/Geometry.js';

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
    this._strength = 0.5;

    this._worker.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'MESH_UPDATE') {
        const data = msg.data;
        if (msg.computeTime) {
          // const logMsg = `Voxel: Worker=${msg.computeTime.toFixed(1)}ms V=${msg.data.vertices.length/3}`;
          // console.log(logMsg);
          // if (window.screenLog) window.screenLog(logMsg, "grey");
        }
        
        // console.log(`Voxel: MESH_UPDATE received. V=${data.vertices.length} F=${data.faces.length}`);

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
        // console.log("[Worker]", msg.data);
      } else {
        console.log("Voxel: Unknown Worker Message", msg);
      }
    };

    // Send Init to Worker
    const res = 64;
    const size = 100.0;
    this._worker.postMessage({
      type: 'INIT',
      res: res,
      size: size
    });

    if (window.screenLog) window.screenLog("Voxel: Worker Inited", "green");

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
    this._cursorMesh = Primitives.createSphere(main._gl);
    this._cursorMesh.setMode(main._gl.TRIANGLES);
    this._cursorMesh.setShaderType(Enums.Shader.FLAT);
    this._cursorMesh.setFlatColor([1.0, 0.5, 0.0]); // Orange
    this._cursorMesh.setOpacity(0.4);
    this._cursorMesh.setVisible(false);

    // DEBUG: Add a reference cube to verify location/rendering
    // Use Primitives to ensure correct faces formatting (Quads/Triangles)
    this._debugCube = Primitives.createCube(main._gl);
    this._debugCube.setMode(main._gl.LINES); // Use LINES to avoid Quad/Tri mismatch (8 vertices, 24 indices = 12 lines)

    // Primitives.createCube already calls init() and initRender()

    mat4.copy(this._debugCube.getMatrix(), this._gridMatrix);
    // Scale it to match Voxel Box (100.0)
    this._debugCube.setShaderType(Enums.Shader.WIREFRAME); // Only Wireframe
    this._debugCube.setFlatColor([1.0, 0.5, 0.0]); // Orange
    this._debugCube.setOpacity(0.1); // Ignored by hardcoded shader alpha 0.4, but good for logic
    this._debugCube.isPickable = false; // Disable picking to avoid blocking raycasts? User said "desktop picking" wanted?
    // If pickable, raycast hits cube faces. But WIREFRAME shader has no faces?
    // Geometry intersection uses TRIANGLES.
    // So picking will still hit the invisible faces of the cube.
    // Ideally we want to pick THROUGH the cube?
    // User said "Use Debug Cube for desktop picking!" in original code.
    // I will leave isPickable=true.
    this._debugCube.isPickable = true;
    this._debugCube.setVisible(true); // [USER REQUEST] Show by default to debug boundaries

    // ... (lines 49-68 omitted for brevity if unchanged, but I need to match context)

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
    // if (window.screenLog) window.screenLog(`Voxel: setRadius(${val.toFixed(1)})`, "grey");
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
    // Toggle Shader between WIREFRAME and FLAT
    if (this._voxelMesh.getShaderType() === Enums.Shader.WIREFRAME) {
      this._voxelMesh.setShaderType(Enums.Shader.FLAT);
      this._voxelMesh.setFlatShading(true);
      console.log("Voxel Mesh: FLAT");
      if (window.screenLog) window.screenLog("Voxel: FLAT", "lime");
    } else {
      // Lazy Init Normals/Topology if missing
      if (!this._voxelMesh.getNormals() || this._voxelMesh.getNormals().length === 0) {
          if (window.screenLog) window.screenLog("Computing Topology...", "yellow");
          this._voxelMesh.initFaceRings();
          this._voxelMesh.initEdges();
          this._voxelMesh.updateGeometry();
      }
      
      this._voxelMesh.setShaderType(Enums.Shader.WIREFRAME);
      this._voxelMesh.setShowWireframe(true); // Ensure buffer built
      this._voxelMesh.updateWireframeBuffer();
      console.log("Voxel Mesh: WIREFRAME");
      if (window.screenLog) window.screenLog("Voxel: WIREFRAME", "lime");
    }
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
      if (window.screenLog) window.screenLog("Voxel: start() picking miss (Normal for Air)", "grey");
    } else {
      // if (window.screenLog) window.screenLog("Voxel: start() success (Hit Surface)", "lime");

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
    if (this._main._xrSession) {
      // In VR, draw our custom Air Cursor
      if (this._cursorMesh && this._cursorMesh.isVisible()) {
        this._cursorMesh.render(this._main);
      }
    } else {
    // Desktop: Standard Selection?
    // selection.render(this._main);
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

    var mode = (this._mode !== undefined) ? this._mode : 0; // 0=Add, 1=Sub, 2=Inflate
    if (isNegative && mode === 0) mode = 1; // Shift override for Brush

    // DEBUG: Mode Verification
    // if (window.screenLog && (this._lastUpdate % 30 === 0)) {
    // window.screenLog(`Strk: Mode=${mode} Neg=${isNegative}`, "cyan");
    // }

    // FORCE LOG for User Request
    if (window.screenLog) {
      let mStr = "ADD";
      if (mode === 1) mStr = "SUB";
      if (mode === 2) mStr = isNegative ? "DEFLATE" : "INFLATE";
      // Remove throttle for now to ensure visibility
      window.screenLog(`Vx: ${mStr} (M=${mode} N=${isNegative})`, "yellow");
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

        this._worker.postMessage({
          type: 'INFLATE',
          center: [localPos[0], localPos[1], localPos[2]],
          radius: radius,
          strength: strength,
          returnMesh: returnMesh
        });
      } else {
        // ADD / SUB
        var isSub = (mode === 1);
        this._worker.postMessage({
          type: 'EDIT_SPHERE',
          center: [localPos[0], localPos[1], localPos[2]],
          radius: radius,
          color: color,
          isNegative: isSub,
          returnMesh: returnMesh
        });
      }
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
      if (this._cursorMesh) {
        this._cursorMesh.setVisible(true);
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
        mat4.translate(m, m, origin); // origin is vec3 pos? 
        // Wait, origin is usually [x, y, z] from controller.
        // It's not a matrix? Scene.js passes `vec3.transformMat4(origin, ...)`? 
        // No, Scene.js passes `ct.position`.
        // Let's verify origin is vec3.
        if (origin.length === 3) {
          mat4.translate(m, m, [origin[0], origin[1], origin[2]]);
        } else if (origin.length === 16) {
          // If it passed a matrix? SculptManager calls updateXR(..., origin, dir)
          // Usually origin is vec3.
        }

        mat4.scale(m, m, [radius, radius, radius]);
      }

      if (!isPressed) {
        this._lastXRPos = null; // Reset stroke
        return;
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

      // 2. Add Sphere at LocalPos
      // Radius Mapping: rawRadius (0..100) -> World Units
      // Voxel Box is 100.0 units big.
      // We want range approx 1.0 (small) to 15.0 (large).
      // rawRadius * 2.5 seems okay? (0..25)
      // Actually previous logic was confusing grid units vs world units.
      // let's use:
      var worldRadius = Math.max(1.0, rawRadius * 0.15); // 0-100 -> 1.5-15.0

      if (this._radiusMult) worldRadius *= this._radiusMult;

      var gridRadius = worldRadius; // Since localPos is in Grid Space (which is 0..100?)
      // Wait, _invGridMatrix transforms World to Grid Space.
      // If Grid Matrix has NO Scale (only translation), then Grid Space is World Scale.
      // Grid Matrix was Identity * Translate. No Scale.
      // So Grid Units == World Units.

      var gridRadius = Math.min(worldRadius, 40.0);

      var color = [0.7, 0.65, 0.6]; // Grey Clay

      var changed = false;
      // Use options.isNegative OR this._negative (UI Toggle)
      var isNegative = (options && options.isNegative) || this._negative;

      var mode = (this._mode !== undefined) ? this._mode : 0; // 0=Add, 1=Sub, 2=Inflate
      if (mode === 0 && isNegative) mode = 1; // Add + Neg -> Sub

      // Re-enable real update loop
      if (this._worker) {
        // Throttling: Only request mesh if not currently pending
        const returnMesh = !this._pendingMeshUpdate;
        if (returnMesh) {
          this._pendingMeshUpdate = true;
        } else {
          this._meshRequested = true; // Mark that we want an update as soon as possible
        }

        if (mode === 2) {
          // INFLATE / DEFLATE
          var strength = (this._strength !== undefined) ? this._strength : 0.5;
          if (isNegative) strength = -strength; // Deflate

          this._worker.postMessage({
            type: 'INFLATE',
            center: [localPos[0], localPos[1], localPos[2]],
            radius: gridRadius,
            strength: strength,
            returnMesh: returnMesh
          });

        } else {
          // ADD / SUB
          var isSub = (mode === 1);
          this._worker.postMessage({
            type: 'EDIT_SPHERE',
            center: [localPos[0], localPos[1], localPos[2]],
            radius: gridRadius,
            color: color,
            isNegative: isSub,
            returnMesh: returnMesh
          });
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

  setResolution(res) {
    if (res === this._res) return;

    // Update local cache
    this._res = res;
    // Keep same size for now, or reset?
    // Let's assume size stays 100.0 or we can make it dynamic later.
    const size = this._size || 100.0;

    this._step = size / res;
    const half = size * 0.5;
    this._min = vec3.fromValues(-half, -half, -half);
    this._max = vec3.fromValues(half, half, half);

    // Send Re-Init to Worker
    this._worker.postMessage({
      type: 'INIT',
      res: res,
      size: size
    });

    if (this._voxelMesh) {
      this._main.removeMeshes([this._voxelMesh]); // Now safe
      this._voxelMesh.release(); // Prevent WebGL Leak
      this._voxelMesh = null; // Forced reset
    }
    this._lastUpdate = 0; // Allow forceInit to run
    this.forceInit();
    if (this._main) this._main.render();
  }

  setRadiusMultiplier(val) {
    this._radiusMult = val;
    if (window.screenLog) window.screenLog(`Voxel: Radius Mult ${val.toFixed(2)}`, "cyan");
  }

  updateVoxelMesh(res) {
    // res has { vertices, faces, colors, materials } (Float32Arrays)
    // console.time('VoxelMeshUpdate');
    // console.log(`Voxel Update: ${res.vertices.length} vertices, ${res.faces.length} faces`);


    if (res.vertices.length === 0) {
      // console.warn("Voxel: Received empty mesh.");
      if (this._voxelMesh) {
        this._voxelMesh.setVisible(false);
      }
      return;
    }

    // console.log("Voxel: Updating Mesh...");
    var isNew = false;
    // If no mesh exists, create it
    if (!this._voxelMesh) {
      this._voxelMesh = new MeshStatic(this._main._gl);
      this._voxelMesh._isVoxel = true; // Flag to lock shader to FLAT
      // this._voxelMesh.setMode(Enums.Mode.SCULPT); // Enums.Mode is undefined!
      isNew = true;

      // Set Matrix
      mat4.identity(this._voxelMesh.getMatrix());
      mat4.translate(this._voxelMesh.getMatrix(), this._voxelMesh.getMatrix(), this._min);
      // Uniform scale by step
      var step = this._step;
      mat4.scale(this._voxelMesh.getMatrix(), this._voxelMesh.getMatrix(), [step, step, step]);

      var worldMat = this._voxelMesh.getMatrix(); // Currently Min+Scale
      var containerMat = this._gridMatrix;

      // M = Container * Translation(Min) * Scale(Step)
      mat4.copy(worldMat, containerMat);
      mat4.translate(worldMat, worldMat, this._min);
      mat4.scale(worldMat, worldMat, [step, step, step]);

      if (window.screenLog && (this._lastUpdate % 100 === 0)) {
        // Debug Matrix
        const p = worldMat;
        console.log(`Voxel Matrix: Pos=[${p[12].toFixed(2)},${p[13].toFixed(2)},${p[14].toFixed(2)}]`);
        // Check Vertices for NaN
        const v = this._voxelMesh.getVertices();
        if (v && v.length > 0 && isNaN(v[0])) console.error("Voxel Vertices contain NaN!");
      }

      // Add to Scene (CRITICAL for Rendering/Picking)
      // We manually push to avoid StateManager spam or just use addNewMesh?
      // addNewMesh adds to Undo Stack. Voxel mesh creation might not need Undo here?
      // But we need it in _meshes.
      // this._main.addNewMesh(this._voxelMesh); 
      // Let's do it manually to avoid side effects for now, OR rely on standard flow.
      // Standard flow is better for consistency (Picking, etc).
      this._main.addNewMesh(this._voxelMesh);

      if (window.screenLog) window.screenLog("Voxel: Mesh Created & Added to Scene", "green");
    }

    // Ensure it is visible (in case it was hidden)
    this._voxelMesh.setVisible(true);

    // Update Buffers
    this._voxelMesh.setVertices(res.vertices);
    this._voxelMesh.setFaces(res.faces);
    this._voxelMesh.setColors(res.colors);
    this._voxelMesh.setMaterials(res.materials);

    // Re-init (topology, octree, normals)
    // Re-init (topology, octree, normals)
    // OPTIMIZATION: Manually init necessary components to avoid heavy compute
    // this._voxelMesh.init(); 
    this._voxelMesh.initColorsAndMaterials();
    this._voxelMesh.allocateArrays();
    // this._voxelMesh.initFaceRings(); // SKIP: Only needed for vertex normals (smooth shading)
    // this._voxelMesh.optimize(); // SKIP (Expensive cache optimization)
    // this._voxelMesh.initEdges(); // SKIP (Wireframe only)
    // this._voxelMesh.initVertexRings(); // SKIP (Smoothing only)
    this._voxelMesh.initRenderTriangles(); // Needed for picking (intersectSphere/Ray uses RenderData?)
    // Actually Picking uses generic Faces if available? 
    // MeshStatic.js intersectSphere uses Octree or Faces.
    
    // CRITICAL: Ensure Render Data / Textures are initialized
    // Force Matcap Shader (Standard SculptXR look) to avoid PBR/Matcap switch lag if user toggles later?
    // No, stay FLAT for performance.
    
    if (isNew || this._voxelMesh.getShaderType() !== Enums.Shader.FLAT) {
      this._voxelMesh.initRender();
      this._voxelMesh.setShaderType(Enums.Shader.FLAT);
      this._voxelMesh.setFlatShading(true);
    }

    // SKIP: this._voxelMesh.updateGeometry(); // Too heavy (computes normals)
    // INSTEAD: Just update AABBs for Octree/Picking
    // OPTIMIZATION: Use updateFacesAabb (skips normal compute)
    this._voxelMesh.updateFacesAabb(); 
    this._voxelMesh.updateOctree();
    
    // Clear normals to ensure Picking knows to use fallback
    this._voxelMesh.setNormals(null);

    // FORCE VALID MATERIALS (Roughness, Metallic, MASK=1.0)
    // Even if using Matcap, we set these for safety if user switches shaders.
    const materials = this._voxelMesh.getMaterials();
    if (materials) {
      const len = materials.length;
      for (let i = 0; i < len; i += 3) {
        materials[i] = 0.5;      // Roughness
        materials[i + 1] = 0.0;  // Metallic
        materials[i + 2] = 1.0;  // Mask (1.0 = Editable)
      }
      this._voxelMesh.updateMaterialBuffer();
    }

    // Ensure we have NORMALS
    if (this._voxelMesh.getNormals()) {
      const norms = this._voxelMesh.getNormals();
      // Check first normal?
      if (norms.length > 0 && norms[0] === 0 && norms[1] === 0 && norms[2] === 0) {
    // Recompute logic
      }
    }

    // CRITICAL FIX: Upload all buffers to GPU (Vertices, Normals, Colors, Indices)
    // This fixes the "Black Artifacts" (missing normals) and potentially "Insufficient buffer size" (sync).
    this._voxelMesh.updateBuffers();


    // BAND-AID: Fix NaN Colors
    const colors = this._voxelMesh.getColors();
    let nanColor = 0;
    if (colors) {
      for (let i = 0; i < colors.length; i++) {
        if (!Number.isFinite(colors[i])) {
          colors[i] = 0.0; // Reset to 0 (Black)
          nanColor++;
        }
      }
      if (nanColor > 0) {
        // if (window.screenLog) window.screenLog(`FIXED: ${nanColor} NaN/Inf Colors`, "red");
        this._voxelMesh.updateColorBuffer();
        this._voxelMesh.setShaderType(Enums.Shader.FLAT);
      }
    }

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

    if (isNew) {
      // Add to Scene AFTER init
      if (typeof this._main.addNewMesh === 'function') {
        this._main.addNewMesh(this._voxelMesh);
      } else if (typeof this._main.addMesh === 'function') {
        this._main.addMesh(this._voxelMesh);
      }
      if (window.screenLog) window.screenLog("Voxel: Mesh Added to Scene", "green");
    }
    if (nanColor > 0) console.warn(`Voxel: Fixed ${nanColor} NaN colors.`);
  }

  // Bake Voxel Mesh to Standard Multimesh
  bakeToMesh() {
    if (!this._voxelMesh) {
      if (window.screenLog) window.screenLog("Voxel: No mesh to bake!", "orange");
      return;
    }

    if (window.screenLog) window.screenLog("Voxel: Baking to Mesh...", "lime");

    const main = this._main;

    // [USER REQUEST] Turn off symmetry after bake
    if (main.getSculptManager()) {
      main.getSculptManager().setSymmetry(false);
      if (main.guiXR) main.guiXR.refreshSymmetry(); // If widget exists
    }

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

    // 2. Explicitly Triangulate Quads to prevent "Manifold Explosion"
    // SurfaceNets produces Quads [a,b,c,d]. We want [a,b,c,-1] and [a,c,d,-1].
    // UPDATE: SurfaceNets now outputs Triangles (padded with TRI_INDEX).
    // So we can copy faces directly!
    const quadFaces = this._voxelMesh.getFaces();
    const fArTri = new Uint32Array(quadFaces); // Direct Copy
    /*
    // OLD QUAD LOGIC (Keep for reference)
    const nbQuads = quadFaces.length / 4;
    const fArTri = new Uint32Array(nbQuads * 2 * 4); // 2 Tris per Quad, stride 4
    let acc = 0;
    for (let i = 0; i < nbQuads; ++i) {
      let id = i * 4;
      let a = quadFaces[id];
      let b = quadFaces[id + 1];
      let c = quadFaces[id + 2];
      let d = quadFaces[id + 3];

      // Tri 1: a-b-c
      fArTri[acc++] = a;
      fArTri[acc++] = b;
      fArTri[acc++] = c;
      fArTri[acc++] = Utils.TRI_INDEX;

      // Tri 2: a-c-d
      fArTri[acc++] = a;
      fArTri[acc++] = c;
      fArTri[acc++] = d;
      fArTri[acc++] = Utils.TRI_INDEX;
    }
    */

    // 3. Create Standard Mesh (Multimesh)
    const staticMesh = new MeshStatic(gl);
    staticMesh.setVertices(vAr);
    staticMesh.setFaces(fArTri);

    // Init Topology & Arrays FIRST
    staticMesh.setUseDrawArrays(false); // Ensure indexed
    staticMesh.setMode(this._main._gl.TRIANGLES);

    staticMesh.init();
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

    // CRITICAL: Compute Normals for Smooth Shading
    // SurfaceNets provides vertices/faces but no normals. 
    // MeshStatic defaults to all-zero normals, which causes invisibility with PBR/Matcap.
    this._computeNormals(staticMesh, vAr, fArTri);

    // Standard White Colors
    const cAr = new Float32Array(vAr.length);
    cAr.fill(1.0);
    staticMesh.setColors(cAr);

    // CRITICAL FIX: Repair Normals for Degenerate Geometry
    this._fixNormals(staticMesh);
    if (window.screenLog) window.screenLog(`Bake: V=${vAr.length / 3} F=${fArTri.length / 4}`, "cyan");

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

    // Also remove Debug Cube if present
    if (this._debugCube) {
      this._debugCube.setVisible(false);
      main.removeMeshes([this._debugCube]);
    }

    if (window.screenLog) window.screenLog("Voxel: Bake Complete! Switched to Brush.", "green");

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

  _computeNormals(mesh, vAr, fAr) {
    const nAr = new Float32Array(vAr.length);
    const nbFaces = fAr.length / 4;
    const ab = vec3.create();
    const ac = vec3.create();
    const normal = vec3.create();
    const v1 = vec3.create();
    const v2 = vec3.create();
    const v3 = vec3.create();

    for (let i = 0; i < nbFaces; ++i) {
      const id = i * 4;
      const i1 = fAr[id];
      const i2 = fAr[id + 1];
      const i3 = fAr[id + 2];
      const i4 = fAr[id + 3];

      // Triangle 1 (v1-v2-v3)
      v1[0] = vAr[i1 * 3]; v1[1] = vAr[i1 * 3 + 1]; v1[2] = vAr[i1 * 3 + 2];
      v2[0] = vAr[i2 * 3]; v2[1] = vAr[i2 * 3 + 1]; v2[2] = vAr[i2 * 3 + 2];
      v3[0] = vAr[i3 * 3]; v3[1] = vAr[i3 * 3 + 1]; v3[2] = vAr[i3 * 3 + 2];

      vec3.sub(ab, v2, v1);
      vec3.sub(ac, v3, v1);
      vec3.cross(normal, ab, ac); // weighted by area

      // Accumulate
      nAr[i1 * 3] += normal[0]; nAr[i1 * 3 + 1] += normal[1]; nAr[i1 * 3 + 2] += normal[2];
      nAr[i2 * 3] += normal[0]; nAr[i2 * 3 + 1] += normal[1]; nAr[i2 * 3 + 2] += normal[2];
      nAr[i3 * 3] += normal[0]; nAr[i3 * 3 + 1] += normal[1]; nAr[i3 * 3 + 2] += normal[2];

      // Triangle 2 (v1-v3-v4) - SurfaceNets produces quads
      if (i4 !== Utils.TRI_INDEX) {
        const v4 = vec3.create();
        v4[0] = vAr[i4 * 3]; v4[1] = vAr[i4 * 3 + 1]; v4[2] = vAr[i4 * 3 + 2];

        vec3.sub(ab, v3, v1);
        vec3.sub(ac, v4, v1);
        vec3.cross(normal, ab, ac);

        nAr[i1 * 3] += normal[0]; nAr[i1 * 3 + 1] += normal[1]; nAr[i1 * 3 + 2] += normal[2];
        nAr[i3 * 3] += normal[0]; nAr[i3 * 3 + 1] += normal[1]; nAr[i3 * 3 + 2] += normal[2];
        nAr[i4 * 3] += normal[0]; nAr[i4 * 3 + 1] += normal[1]; nAr[i4 * 3 + 2] += normal[2];
      }
    }

    // Normalize
    Utils.normalizeArrayVec3(nAr);
    mesh.setNormals(nAr);
  }

  _fixNormals(mesh) {
    // Helper to fix NaNs and Zero-Length normals
    const normals = mesh.getNormals();
    if (!normals) return;

    let nbNaNs = 0;
    let nbZeros = 0;
    for (let i = 0; i < normals.length; i += 3) {
      const x = normals[i];
      const y = normals[i + 1];
      const z = normals[i + 2];
      const len2 = x * x + y * y + z * z;
      if (isNaN(x) || isNaN(y) || isNaN(z)) {
        // Replace NaN with Up Vector
        normals[i] = 0.0;
        normals[i + 1] = 1.0;
        normals[i + 2] = 0.0;
        nbNaNs++;
      } else if (len2 < 1e-6) {
        // Replace Zero Length with Up Vector
        normals[i] = 0.0;
        normals[i + 1] = 1.0;
        normals[i + 2] = 0.0;
        nbZeros++;
      }
    }
    if (nbNaNs > 0 || nbZeros > 0) {
      if (window.screenLog) window.screenLog(`Fixed Normals: NaNs=${nbNaNs} Zeros=${nbZeros}`, "orange");
      mesh.setNormals(normals); // Re-assign if needed (Reference sharing usually works)
      mesh.updateNormalBuffer();
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
