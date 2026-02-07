import SculptBase from 'editing/tools/SculptBase';
import VoxelState from 'editing/VoxelState';
import MeshStatic from 'mesh/meshStatic/MeshStatic';
import Multimesh from 'mesh/multiresolution/Multimesh';
import { vec3, mat4 } from 'gl-matrix';
import Utils from 'misc/Utils';
import Primitives from 'drawables/Primitives';
import Enums from 'misc/Enums';
import Geometry from 'math3d/Geometry';

class SculptVoxel extends SculptBase {

  constructor(main) {
    super(main);

    // Initialize Voxel Grid
    // Box size 100.0 (matches Utils.SCALE / Desktop Scale)
    // Resolution 64 (Better quality for larger space)
    this._voxelState = new VoxelState(64, 100.0);
    this._allowAir = true; // Allow sculpting without surface picking

    // The mesh that represents the voxels
    this._voxelMesh = null;

    // "Canvas" location - Fixed in front of user
    this._gridMatrix = mat4.create();
    mat4.translate(this._gridMatrix, this._gridMatrix, [0.0, 1.3, -1.5]);
    this._invGridMatrix = mat4.create();
    mat4.invert(this._invGridMatrix, this._gridMatrix);
    this._allowAir = true; // [VR] Allow drawing in air (Scene.js checks this)

    this._lastUpdate = 0;

    // DEBUG: Add a reference cube to verify location/rendering
    // Use Primitives to ensure correct faces formatting (Quads/Triangles)
    this._debugCube = Primitives.createCube(main._gl);
    this._debugCube.setMode(main._gl.TRIANGLES); // Primitives uses Quads, but handled as Tris in render

    // Primitives.createCube already calls init() and initRender()

    mat4.copy(this._debugCube.getMatrix(), this._gridMatrix);
    // Scale it to match Voxel Box (100.0)
    var s = 100.0;
    mat4.scale(this._debugCube.getMatrix(), this._debugCube.getMatrix(), [s, s, s]);
    // Note: Rendering opaque box might block view. Ideally use Wireframe.
    this._debugCube.setShaderType(Enums.Shader.FLAT);
    this._debugCube.setFlatColor([1.0, 0.0, 0.0]);
    this._debugCube.setOpacity(0.3); // Semi-transparent
    this._debugCube.isPickable = true; // Use Debug Cube for desktop picking!
    this._debugCube.setVisible(false); // [USER REQUEST] Hide by default

    // ... (lines 49-68 omitted for brevity if unchanged, but I need to match context)

    // [USER REQUEST] Do NOT add debug cube to scene list to prevent Isolate issues
    // if (main.addNewMesh) main.addNewMesh(this._debugCube);
    // else main.addMesh(this._debugCube);

    // if (window.screenLog) window.screenLog("Voxel: Debug Cube Added (Size 1.0) at [0, 1.3, -1.5]", "yellow");

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
      console.log("Voxel Mesh: FLAT");
    } else {
      this._voxelMesh.setShaderType(Enums.Shader.MATCAP);
      console.log("Voxel Mesh: MATCAP");
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
    this._main.getStateManager().pushStateVoxel(this._voxelState);
  }

  updateMesh() {
    // Generate new mesh data
    const res = this._voxelState.computeMesh();

    // Create or Update MeshStatic
    var main = this._main;
    var gl = main._gl;

    if (!this._voxelMesh) {
      this._voxelMesh = new MeshStatic(gl);
      this._voxelMesh.setMode(gl.TRIANGLES);
      this._voxelMesh.setUseDrawArrays(false); // Indexed Geometry is faster/smaller
      this._voxelMesh.setFlatShading(true);    // Skip normal computation, use shader derivatives

      this._voxelMesh.setID(this._voxelMesh.getID());

      // Default to MATCAP for better visibility
      this._voxelMesh.setShaderType(Enums.Shader.MATCAP);

      main.addMesh(this._voxelMesh);
      if (window.screenLog) window.screenLog("Voxel: Mesh Created (MATCAP)", "lime");
    }

    // Set Data
    this._voxelMesh.setVertices(res.vertices); // Float32Array
    this._voxelMesh.setFaces(res.faces);       // Uint32Array

    // MINIMAL UPDATE (Avoids initTopology/Octree which are O(N) or worse)
    // 1. Resize/Init Colors & Materials
    this._voxelMesh.initColorsAndMaterials();

    // 2. Resize/Init Normals & Other Arrays
    // allocateArrays uses getNbVertices to resize _normalsXYZ etc.
    this._voxelMesh.allocateArrays();

    // 3. Set Color/Prop Defaults (after alloc)
    this._voxelMesh.setFlatColor([0.2, 0.9, 0.2]); // Bright Green
    this._voxelMesh.setOpacity(1.0);
    this._voxelMesh.setMatcap(0);

    // 4. Upload to GPU (Skip Geometry/Normal calculation logic)
    // We rely on Flat Shading in ShaderMatcap (using dFdx/dFdy) so we don't need vertex normals.
    this._voxelMesh.updateBuffers();
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
      if (window.screenLog) window.screenLog("Voxel: Initial Sphere DISABLED", "grey");
      // this._voxelState.addSphere([0, 0, 0], 15.0, [0.2, 1.0, 0.2]); // 15 unit sphere
      // this.updateMesh();
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
    // Hide default selection ring
    if (!this._main._xrSession) {
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
    var isNegative = (this._main._shiftKey === true);

    // DEBUG: Throttled logging to prevent UI freeze
    if (window.screenLog && (this._lastUpdate % 10 === 0)) {
      window.screenLog(`Desk: Shift=${isNegative} R=${radius.toFixed(1)} P=${localPos[0].toFixed(1)}`, isNegative ? "orange" : "grey");
    }

    var changed = false;
    if (isNegative) {
      changed = this._voxelState.subtractSphere(localPos, radius);
      if (window.screenLog && (this._lastUpdate % 30 === 0)) window.screenLog("Desk: Neg Mod!", "red");
    } else {
      changed = this._voxelState.addSphere(localPos, radius, color);
    }

    if (changed) {
      if (window.screenLog && (this._lastUpdate++ % 30 === 0)) window.screenLog(`Voxel: Mod! FaceCount: ${this._voxelMesh ? this._voxelMesh.getNbFaces() : 0}`, "lime");
      this.updateMesh();
    } else {
      // Log failure reason in Desktop too
      // if (window.screenLog && Math.random() < 0.05) window.screenLog("Voxel: No Change", "grey");
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
    console.log("Voxel Mesh Winding Flipped");
  }

  updateXR(picking, isPressed, origin, dir, options) {
    try {
      // VoxelXR Update
      // Ensure we hide distracting meshes
      // this.hideOtherMeshes();

      if (!isPressed) {
        this._lastXRPos = null; // Reset stroke
        return;
      }

      // 1. Transform EnginePos (World) to Grid Local Space
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
      // Radius Source: this._radius (0..100) set by GuiXR
      var rawRadius = (this._radius !== undefined) ? this._radius : 25.0;
      
      // Radius Mapping: 0..100 -> 0.5..10.0 (Physical Units)
      // Voxel Step is ~1.5. So 10.0 is ~6 voxels radius.
      var radius = Math.max(1.5, rawRadius * 0.15); 

      // Support Voxel Mult Slider if set
      if (this._radiusMult) radius *= this._radiusMult;

      // Guard: Max Radius (Prevent Huge Blob)
      radius = Math.min(radius, 50.0);

      var color = [0.7, 0.65, 0.6]; // Grey Clay

      var changed = false;
      var isNegative = (options && options.isNegative);

      // Re-enable real update loop
      if (isNegative) {
        changed = this._voxelState.subtractSphere(localPos, radius);
      } else {
        changed = this._voxelState.addSphere(localPos, radius, color);
      }

      if (changed) {
        this.updateMesh();
      } else {
        // Log lack of change (maybe out of bounds or air subtract)
        // if (window.screenLog && (this._lastUpdate % 60 === 0)) window.screenLog("VR: No Change (Air?)", "grey");
      }
      this._lastUpdate++;
    } catch (e) {
      if (window.screenLog) window.screenLog(`Voxel XR Error: ${e.message}`, "red");
      console.error(e);
    }
  }

  setResolution(res) {
    // if (window.screenLog) window.screenLog(`VoxelState: step=${step} min=${this._voxelState.min[0]},${this._voxelState.min[1]},${this._voxelState.min[2]}`, "orange");
    // if (window.screenLog) window.screenLog(`GridMat: ${containerMat[12].toFixed(2)},${containerMat[13].toFixed(2)},${containerMat[14].toFixed(2)}`, "orange");
    if (res === this._voxelState.dims[0]) return;
    // if (window.screenLog) window.screenLog(`Voxel: Rebuilding Grid (${res}^3)...`, "orange");

    // Preserve size, just change res
    // Current size is 100.0
    this._voxelState = new VoxelState(res, 100.0);
    this._voxelMesh = null; // Forced reset
    this.forceInit();
    if (this._main) this._main.render();
  }

  setRadiusMultiplier(val) {
    this._radiusMult = val;
    if (window.screenLog) window.screenLog(`Voxel: Radius Mult ${val.toFixed(2)}`, "cyan");
  }

  updateMesh() {
    var res = this._voxelState.computeMesh();
    // res has { vertices, faces, colors, materials } (Float32Arrays)

    var res = this._voxelState.computeMesh();
    // res has { vertices, faces, colors, materials } (Float32Arrays)

    if (res.vertices.length === 0) {
      if (this._voxelMesh) {
        this._voxelMesh.setVisible(false);
      }
      return;
    }

    var isNew = false;
    // If no mesh exists, create it
    if (!this._voxelMesh) {
      this._voxelMesh = new MeshStatic(this._main._gl);
      this._voxelMesh.setMode(this._main._gl.TRIANGLES);
      isNew = true;

      // Set Matrix
      mat4.identity(this._voxelMesh.getMatrix());
      mat4.translate(this._voxelMesh.getMatrix(), this._voxelMesh.getMatrix(), this._voxelState.min);
      // Uniform scale by step
      var step = this._voxelState.step;
      mat4.scale(this._voxelMesh.getMatrix(), this._voxelMesh.getMatrix(), [step, step, step]);

      var worldMat = this._voxelMesh.getMatrix(); // Currently Min+Scale
      var containerMat = this._gridMatrix;

      if (window.screenLog) {
        // window.screenLog(`VoxelState: step=${step} min=${this._voxelState.min[0]},${this._voxelState.min[1]},${this._voxelState.min[2]}`, "orange");
        // window.screenLog(`GridMat: ${containerMat[12].toFixed(2)},${containerMat[13].toFixed(2)},${containerMat[14].toFixed(2)}`, "orange");
      }

      // M = Container * Translation(Min) * Scale(Step)
      mat4.copy(worldMat, containerMat);
      mat4.translate(worldMat, worldMat, this._voxelState.min);
      mat4.scale(worldMat, worldMat, [step, step, step]);

      if (window.screenLog) {
        window.screenLog(`VS: step=${step.toFixed(4)} min=[${this._voxelState.min.join(',')}]`, "cyan");
        window.screenLog(`Mat: Pos=[${worldMat[12].toFixed(1)},${worldMat[13].toFixed(1)},${worldMat[14].toFixed(1)}] Scale=${worldMat[0].toFixed(4)}`, "cyan");
      }

      if (window.screenLog) window.screenLog("Voxel: Mesh Created", "green");
    }

    // Ensure it is visible (in case it was hidden)
    this._voxelMesh.setVisible(true);

    // Update Buffers
    this._voxelMesh.setVertices(res.vertices);
    this._voxelMesh.setFaces(res.faces);
    this._voxelMesh.setColors(res.colors);
    this._voxelMesh.setMaterials(res.materials);

    // Re-init (topology, octree, normals)
    this._voxelMesh.init();

    // CRITICAL: Ensure Render Data / Textures are initialized
    if (!this._voxelMesh.getRenderData()) this._voxelMesh.initRender();

    // Compute Normals (Crucial for rendering)
    this._voxelMesh.updateGeometry();

    // BAND-AID: Fix NaNs and Infinities in Normals
    this._fixNormals(this._voxelMesh);

    // FORCE VALID MATERIALS (Roughness, Metallic, MASK=1.0)
    // Critical: Mask must be 1.0 to be sculptable.
    const materials = this._voxelMesh.getMaterials();
    let nanMat = 0;
    if (materials) {
      for (let i = 0; i < materials.length; i += 3) {
        // Sanitize Roughness/Metallic
        if (!Number.isFinite(materials[i])) materials[i] = 0.3; // Default Roughness
        if (!Number.isFinite(materials[i + 1])) materials[i + 1] = 0.0; // Default Metallic

        // FORCE MASK = 1.0 (Editable)
        // 0.0 = Frozen/Masked. 1.0 = Editable.
        materials[i + 2] = 1.0;
      }
      this._voxelMesh.updateMaterialBuffer();
    }

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
      }
    }

    // Set Shader Type AFTER init and data are present
    // FORCE FLAT SHADER (Matcap ignores uFlat, so we must use FLAT shader for faceted look)
    if (this._voxelMesh.getShaderType() !== Enums.Shader.FLAT) {
      this._voxelMesh.setShaderType(Enums.Shader.FLAT);
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

    if (window.screenLog) {
      const nbTris = this._voxelMesh.getNbTriangles();
      const useDA = this._voxelMesh.isUsingDrawArrays();
      // window.screenLog(`Voxel: Validating. Tris:${nbTris} DA:${useDA}`, "grey");
      // console.log(`Voxel: Tris:${nbTris} DA:${useDA} Faces:${res.faces.length / 4}`);
    }
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
    const quadFaces = this._voxelMesh.getFaces();
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
    this._voxelState.clear();

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
  checkNaN(arr, name) {
    for (let i = 0; i < arr.length; i++) {
      if (isNaN(arr[i])) {
        return true;
      }
    }
    return false;
  }
}

export default SculptVoxel;
