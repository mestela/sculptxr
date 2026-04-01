import Selection from '../drawables/Selection.js';
import Tools from './tools/Tools.js';
import Enums from '../misc/Enums.js';
import HoleFilling from './HoleFilling.js';
import Utils from '../misc/Utils.js';
import Remesh from './Remesh.js';
import Mesh from '../mesh/Mesh.js';
import MeshStatic from '../mesh/meshStatic/MeshStatic.js';


class SculptManager {

  constructor(main) {
    this._main = main;

    this._toolIndex = Enums.Tools.BRUSH;
    this._tools = []; // the sculpting tools

    // symmetry stuffs
    this._symmetry = true; // if symmetric sculpting is enabled  

    // continuous stuffs
    this._continuous = false; // continuous sculpting
    this._sculptTimer = -1; // continuous interval timer

    this._selection = new Selection(main._gl); // the selection geometry (red hover circle)
    
    this._isProcessingQuads = false;
    this._quadRemeshTimeout = null;

    this.init();
  }

  setToolIndex(id) {
    this._toolIndex = id;
  }

  getToolIndex() {
    return this._toolIndex;
  }

  getCurrentTool() {
    return this._tools[this._toolIndex];
  }

  getSymmetry() {
    return this._symmetry;
  }

  setSymmetry(val) {
    this._symmetry = val;
  }

  getTool(index) {
    return this._tools[index];
  }

  getSelection() {
    return this._selection;
  }

  init() {
    var main = this._main;
    var tools = this._tools;
    for (var i = 0, nb = Tools.length; i < nb; ++i) {
      if (Tools[i]) tools[i] = new Tools[i](main);
    }
  }

  canBeContinuous() {
    switch (this._toolIndex) {
    case Enums.Tools.TWIST:
    case Enums.Tools.MOVE:
    case Enums.Tools.DRAG:
    case Enums.Tools.LOCALSCALE:
    case Enums.Tools.TRANSFORM:
      return false;
    default:
      return true;
    }
  }

  isUsingContinuous() {
    return this._continuous && this.canBeContinuous();
  }

  start(ctrl) {
    var tool = this.getCurrentTool();
    console.log(`[SculptManager] Invoking tool.start() for ${tool.constructor.name || ""}`);
    var canEdit = tool.start(ctrl);
    console.log(`[SculptManager] tool.start() returned canEdit=${canEdit}`);

    // Push State for Undo/Redo
    if (this._main.getStateManager()) {
      if (tool.constructor.name === 'SculptVoxel') {
        // Voxel Undo - Worker Command
        this._main.getStateManager().pushStateVoxel(tool);
      } else if (this._main.getMesh() && this._main.getMesh().isDynamic) {
        // Dynamic Mesh Undo
        this._main.getStateManager().pushStateGeometry(this._main.getMesh());
      } else if (this._main.getMesh() && !this._main.getMesh().isDynamic) {
        // Static Mesh Undo (StateGeometry handled differently?)
        // Standard SculptGL pushes StateGeometry usually inside tool.start?
        // Actually SculptBase.start pushes StateGeometry.
        // Let's check SculptBase.
      }
    }

    if (this._main.getPicking().getMesh() && this.isUsingContinuous())
      this._sculptTimer = window.setInterval(tool._cbContinuous, 16.6);
    return canEdit;
  }

  end() {
    this.getCurrentTool().end();
    if (this._sculptTimer !== -1) {
      clearInterval(this._sculptTimer);
      this._sculptTimer = -1;
    }
  }

  preUpdate() {
    this.getCurrentTool().preUpdate(this.canBeContinuous());
  }

  update() {
    if (this.isUsingContinuous())
      return;
    this.getCurrentTool().update();
  }

  updateXR(picking, isPressed, origin, dir, options) {
    var tool = this.getCurrentTool();
    // if (window.screenLog && Math.random() < 0.01) window.screenLog(`ManagerXR: ToolIdx=${this._toolIndex} Tool=${!!tool}`, "orange");

    if (tool && tool.updateXR) {
      tool.updateXR(picking, isPressed, origin, dir, options);
    } else {
      // Log Removed
    }

    // Toggle Transform Gizmo visibility based on active tool AND being in VR
    const gizmoGroup = this._main._scene ? this._main._scene.getObjectByName("Transform Gizmo Group") : null;
    if (gizmoGroup) {
      const isVR = this._main._xrSession && this._main._xrSession.visibilityState === "visible";
      const isActive = (this._toolIndex === Enums.Tools.TRANSFORM_VR);
      gizmoGroup.visible = isVR && isActive;
    }
  }

  meshToVoxel() {
    var mesh = this._main.getMesh();
    if (!mesh || !mesh.getVertices) return; // Need a valid mesh

    var voxelTool = this.getTool(Enums.Tools.VOXEL);
    if (mesh._isVoxel || mesh.constructor.name === 'MeshProxy') {
      if (window.screenLog) window.screenLog("Cannot merge voxels into voxels", "yellow");
      return;
    }

    var nbVertices = mesh.getNbVertices();
    var vAr = mesh.getVertices();
    
    var threeMesh = mesh.getThreeMesh();
    var colorAttr = threeMesh && threeMesh.geometry.attributes.color;
    var cAr = null;
    if (colorAttr) {
        if (colorAttr.itemSize === 4) {
            cAr = new Float32Array(nbVertices * 3);
            const raw = colorAttr.array;
            for (let i = 0; i < nbVertices; i++) {
                cAr[i * 3]     = raw[i * 4];
                cAr[i * 3 + 1] = raw[i * 4 + 1];
                cAr[i * 3 + 2] = raw[i * 4 + 2];
            }
        } else {
            cAr = colorAttr.array;
        }
    }
    var mAr = mesh.getMaterials();
    var fAr = threeMesh && threeMesh.geometry.index ? threeMesh.geometry.index.array : null;

    if (!fAr || fAr.length === 0) {
        fAr = mesh.getTriangles(); // Fallback
    }

    var matrix = mesh.getMatrix();
    var vArWorld = new Float32Array(nbVertices * 3);
    
    var xMin = Infinity, yMin = Infinity, zMin = Infinity;
    var xMax = -Infinity, yMax = -Infinity, zMax = -Infinity;

    // Inline transform
    for (let i = 0; i < nbVertices; i++) {
        let id = i * 3;
        let x = vAr[id], y = vAr[id+1], z = vAr[id+2];
        let wx = matrix[0] * x + matrix[4] * y + matrix[8]  * z + matrix[12];
        let wy = matrix[1] * x + matrix[5] * y + matrix[9]  * z + matrix[13];
        let wz = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];

        vArWorld[id]   = wx;
        vArWorld[id+1] = wy;
        vArWorld[id+2] = wz;

        if (wx < xMin) xMin = wx;
        if (wy < yMin) yMin = wy;
        if (wz < zMin) zMin = wz;
        if (wx > xMax) xMax = wx;
        if (wy > yMax) yMax = wy;
        if (wz > zMax) zMax = wz;
    }

    const width = xMax - xMin;
    const height = yMax - yMin;
    const depth = zMax - zMin;
    let maxExtent = Math.max(width, height, depth);

    // Apply 30% extra padding for sculpting room!
    maxExtent *= 1.30; 

    // Find the mesh center
    const cx = (xMin + xMax) / 2;
    const cy = (yMin + yMax) / 2;
    const cz = (zMin + zMax) / 2;

    // Shift vertices to center around [0,0,0] for the worker
    for (let i = 0; i < nbVertices; i++) {
        let id = i * 3;
        vArWorld[id]   -= cx;
        vArWorld[id+1] -= cy;
        vArWorld[id+2] -= cz;
    }

    // Use manual resolution from Remesh slider
    let newRes = Remesh.RESOLUTION;
    newRes = Math.min(128, Math.max(32, newRes)); // Clamp [32, 128]

    // Save these for when the worker returns the mesh!
    voxelTool._pendingSize = maxExtent;
    voxelTool._pendingOffset = [cx - maxExtent / 2, cy - maxExtent / 2, cz - maxExtent / 2];
    voxelTool._pendingRes = newRes;

    console.log(`[SculptManager] meshToVoxel cx=${cx.toFixed(3)} cy=${cy.toFixed(3)} cz=${cz.toFixed(3)} mExtent=${maxExtent.toFixed(3)}`);
    console.log(`[SculptManager] pendOffset [${voxelTool._pendingOffset[0].toFixed(3)}, ${voxelTool._pendingOffset[1].toFixed(3)}, ${voxelTool._pendingOffset[2].toFixed(3)}]`);

    voxelTool._worker.postMessage({
        type: 'MESH_TO_VOXEL',
        v: vArWorld,
        c: cAr,
        m: mAr,
        f: fAr,
        res: newRes,
        size: maxExtent,
        center: [cx, cy, cz]
    });

    // Hold the old mesh visible until the voxel mesh is ready to swap seamlessly!
    voxelTool._pendingSourceMesh = mesh; 

    this.setToolIndex(Enums.Tools.VOXEL);
    
    // Force a start to register the VoxelMesh if it's the first time
    voxelTool.start(null);

    // Sync GUI
    if (this._main.getGui() && this._main.getGui()._ctrlSculpt) {
        this._main.getGui()._ctrlSculpt.setValue(Enums.Tools.VOXEL);
    }
  }

  isProcessingQuads() {
    return this._isProcessingQuads;
  }

  fillHoles() {
    console.log("[SculptManager] fillHoles() method called!");
    const mesh = this.getCurrentMesh();
    if (!mesh) {
      console.log("[SculptManager] fillHoles rejected: No active mesh!");
      return;
    }

    console.log("[SculptManager] Invoking HoleFilling module...");
    const result = HoleFilling(mesh);
    console.log("[SculptManager] HoleFilling module finished computed result!");
    if (!result) {
      console.log("[SculptManager] No holes found or couldn't fill.");
      return;
    }

    console.log(`[SculptManager] Holes filled! New vLen=${result.vertices.length/3}, fLen=${result.faces.length/4}`);
    console.log("[SculptManager] Importing MeshStatic for recreation...");

    // We need to create a real MeshStatic object!
    import('../mesh/meshStatic/MeshStatic.js').then((MeshStaticMod) => {
      const MeshStatic = MeshStaticMod.default;
      const newMesh = new MeshStatic(this._main._gl);
      
      newMesh.setVertices(result.vertices);
      newMesh.setNbVertices(result.vertices.length / 3);
      newMesh.setFaces(result.faces);
      newMesh.setNbFaces(result.faces.length / 4);
      
      newMesh.init();
      newMesh.initRender();
      
      newMesh.setMatrix(mesh.getMatrix());
      newMesh.setShaderType(mesh.getShaderType());
      if (mesh.getShowWireframe) newMesh.setShowWireframe(mesh.getShowWireframe());

      this._main.replaceMesh(mesh, newMesh);
    });
  }

  remeshQuads(targetFaces) {
    const mesh = this._main.getMesh();
    if (!mesh) return;

    if (this._isProcessingQuads) return; // Prevent duplicate clicks!

    this._isProcessingQuads = true;

    console.log(`[SculptManager] Quad Remesh processing...`);

    // 30s Safety Timeout to reset UI if worker hangs
    if (this._quadRemeshTimeout) clearTimeout(this._quadRemeshTimeout);
    this._quadRemeshTimeout = setTimeout(() => {
      if (this._isProcessingQuads) {
        this._isProcessingQuads = false;
        console.log(`[SculptManager] Quad Remesh timed out!`);
      }
    }, 30000);

    const voxelTool = this.getTool(Enums.Tools.VOXEL);
    if (!voxelTool || !voxelTool._worker) {
      console.error("SculptManager: VoxelWorker not initialized!");
      return;
    }

    const vAr = mesh.getVertices();
    const fAr = mesh.getFaces();

    console.log(`[SculptManager] Quad Remesh inputs: vLen=${vAr.length/3} vertices, fLen=${fAr.length/4} faces (isQuad=${mesh.isQuad})`);

    const isTriangles = fAr.length > 3 && fAr[3] === Utils.TRI_INDEX;

    voxelTool._worker.postMessage({
      type: 'REMESH_QUADRS',
      v: vAr,
      f: fAr,
      targetFaces: targetFaces,
      id: mesh.getID(),
      isTriangles: isTriangles
    });
  }

  symmetryMirror(side) {
    if (this._isProcessingSlice) return; // Share the lock
    this._isProcessingSlice = true;

    console.log(`[SculptManager] Symmetry Mirror processing... side=${side}`);

    const voxelTool = this.getTool(Enums.Tools.VOXEL);
    if (!voxelTool || !voxelTool._worker) {
      console.error("SculptManager: VoxelWorker not available for Symmetry Mirror");
      this._isProcessingSlice = false;
      return;
    }

    const mesh = this._main.getMesh();
    if (!mesh) {
      this._isProcessingSlice = false;
      return;
    }

    const vAr = mesh.getVertices();
    const fAr = mesh.getFaces();

    const ptPlane = mesh.getSymmetryOrigin ? mesh.getSymmetryOrigin() : [0, 0, 0];
    let nPlane = mesh.getSymmetryNormal ? mesh.getSymmetryNormal() : [1, 0, 0];
    
    // Fallback if normal is zero vector
    if (nPlane[0] === 0 && nPlane[1] === 0 && nPlane[2] === 0) {
      nPlane = [1, 0, 0];
    }

    try {
      console.log(`[SculptManager] Sending SYMMETRY_MIRROR message...`);
      voxelTool._worker.postMessage({
        type: 'SYMMETRY_MIRROR',
        v: vAr,
        f: fAr,
        ptPlane: ptPlane,
        nPlane: nPlane,
        isTriangles: !mesh.isQuad,
        side: side || 1, // Default to 1
        id: mesh.getID(),
        quadrangulate: Remesh.QUADRANGULATE
      });
      console.log(`[SculptManager] SYMMETRY_MIRROR message sent!`);
    } catch (e) {
      console.error("[SculptManager] postMessage failed for Symmetry Mirror:", e);
      this._isProcessingSlice = false;
    }
  }

  sliceAndCap() {
    const mesh = this._main.getMesh();
    if (!mesh) return;

    if (this._isProcessingSlice) return; // Prevent duplicate clicks
    this._isProcessingSlice = true;

    console.log(`[SculptManager] Slice + Cap processing...`);

    const voxelTool = this.getTool(Enums.Tools.VOXEL);
    if (!voxelTool || !voxelTool._worker) {
      console.error("SculptManager: VoxelWorker not initialized!");
      return;
    }

    const vAr = mesh.getVertices();
    const fAr = mesh.getFaces();
    
    // Explicit flag instead of guess
    const isQuad = mesh.isQuad === true;

    voxelTool._worker.postMessage({
      type: 'SLICE_AND_CAP',
      v: vAr,
      f: fAr,
      isQuad: isQuad,
      side: 1 // 1 for +X, -1 for -X
    });
  }

  onSliceAndCapResult(msg) {
    this._isProcessingSlice = false;

    const activeMesh = this._main.getMesh();
    if (!activeMesh) return;

    const main = this._main;
    const newMesh = new MeshStatic(main._gl);

    newMesh.setVertices(msg.v);
    
    // Pad triangles with TRI_INDEX to conform to SculptGL's quad-stride faces array
    const nbTri = msg.f.length / 3;
    const padded = new Uint32Array(nbTri * 4);
    for (let i = 0; i < nbTri; i++) {
      padded[i * 4] = msg.f[i * 3];
      padded[i * 4 + 1] = msg.f[i * 3 + 1];
      padded[i * 4 + 2] = msg.f[i * 3 + 2];
      padded[i * 4 + 3] = 4294967295; // TRI_INDEX (-1)
    }
    newMesh.setFaces(padded);
    newMesh.setNbFaces(nbTri); // Face count is number of triangles
    newMesh.setNbVertices(msg.v.length / 3);
    
    newMesh.init();

    newMesh.setMatrix(activeMesh.getMatrix());
    newMesh.setShaderType(activeMesh.getShaderType());
    if (activeMesh.getShowWireframe && newMesh.setShowWireframe) {
      newMesh.setShowWireframe(activeMesh.getShowWireframe());
    }

    activeMesh.setVisible(false);
    
    if (activeMesh.getThreeMesh) {
      const threeMesh = activeMesh.getThreeMesh();
      if (threeMesh) {
        threeMesh.visible = false;
      }
    }

    main.addNewMesh(newMesh);
    main.setMesh(newMesh);

    console.log(`[SculptManager] Slice + Cap Completed!`);
  }

  onSymmetryMirrorResult(data) {
    this._isProcessingSlice = false; // Reset lock

    if (data.stats) {
      const s = data.stats;
      console.log(`[SculptManager] Quadrangulation Stats: tris=${s.tris} leftovers=${s.leftoverTris} candidates=${s.candidates} merged=${s.merged} rejectedDot=${s.rejectedDot}`);
    }

    const mesh = this._main.getMesh();
    if (!mesh) return;

    // Same replacement logic as Slice result
    const newMesh = new MeshStatic(this._main._gl); // Pass WebGL context!
    newMesh.setVertices(data.v);
    newMesh.setNbVertices(data.v.length / 3);
    newMesh.setFaces(data.f);
    newMesh.setNbFaces(data.f.length / 4);

    newMesh.init();
    newMesh.initRender();

    if (mesh.getMaterial) newMesh.setMaterial(mesh.getMaterial());
    if (mesh.getShowWireframe && newMesh.setShowWireframe) {
      newMesh.setShowWireframe(mesh.getShowWireframe());
    }
    if (mesh.getTransformData && newMesh.setTransformData) {
      newMesh.setTransformData(mesh.getTransformData()); // Use setter!
    }
    newMesh.visible = mesh.visible;
    newMesh.isQuad = true;

    this._main.replaceMesh(mesh, newMesh);
    this._main.addNewMesh(newMesh);
    this._main.setMesh(newMesh);

    console.log(`[SculptManager] Symmetry Mirror Completed!`);
  }

  onTriangulateResult(data) {
    const mesh = this._main.getMesh();
    if (!mesh) return;

    console.log(`[SculptManager] Manual Triangulation Completed!`);

    // 1. Capture OLD state for UNDO
    const oldFaces = new Uint32Array(mesh.getFaces());
    const oldVerts = new Float32Array(mesh.getVertices());
    const wasQuad = mesh.isQuad;

    // 2. Capture NEW state for REDO
    const newFaces = new Uint32Array(data.f);
    const newVerts = new Float32Array(data.v);

    // 3. Define Undo/Redo callbacks
    const undoTris = () => {
      mesh.setVertices(oldVerts);
      mesh.setNbVertices(oldVerts.length / 3);
      mesh.setFaces(oldFaces);
      mesh.setNbFaces(oldFaces.length / 4);
      mesh.isQuad = wasQuad;
      const wasOptim = Mesh.OPTIMIZE;
      Mesh.OPTIMIZE = false;
      mesh.init(); 
      Mesh.OPTIMIZE = wasOptim;
      mesh.initRender();
      if (this._main.guiXR) this._main.guiXR._needsRedraw = true;
    };

    const redoTris = () => {
      mesh.setVertices(newVerts);
      mesh.setNbVertices(newVerts.length / 3);
      mesh.setFaces(newFaces);
      mesh.setNbFaces(newFaces.length / 4);
      mesh.isQuad = false;
      const wasOptim = Mesh.OPTIMIZE;
      Mesh.OPTIMIZE = false; // Bypass the fArUV capacity crash!
      mesh.init(); 
      Mesh.OPTIMIZE = wasOptim;
      mesh.initRender();
      if (this._main.guiXR) this._main.guiXR._needsRedraw = true;
    };

    // 4. Push to StateManager
    this._main.getStateManager().pushStateCustom(undoTris, redoTris);

    // 5. Apply NOW
    redoTris();
  }

  onQuadrangulateResult(data) {
    const mesh = this._main.getMesh();
    if (!mesh) return;

    console.log(`[SculptManager] Manual Quadrangulation Completed!`);

    // 1. Capture OLD state for UNDO
    const oldFaces = new Uint32Array(mesh.getFaces());
    const oldVerts = new Float32Array(mesh.getVertices());
    const wasQuad = mesh.isQuad;

    // 2. Capture NEW state for REDO
    const newFaces = new Uint32Array(data.f);
    const newVerts = new Float32Array(data.v);

    const undoQuads = () => {
      mesh.setVertices(oldVerts);
      mesh.setNbVertices(oldVerts.length / 3);
      mesh.setFaces(oldFaces);
      mesh.setNbFaces(oldFaces.length / 4);
      mesh.isQuad = wasQuad;
      const wasOptim = Mesh.OPTIMIZE;
      Mesh.OPTIMIZE = false;
      mesh.init(); 
      Mesh.OPTIMIZE = wasOptim;
      mesh.initRender();
      if (this._main.guiXR) this._main.guiXR._needsRedraw = true;
    };

    const redoQuads = () => {
      mesh.setVertices(newVerts);
      mesh.setNbVertices(newVerts.length / 3);
      mesh.setFaces(newFaces);
      mesh.setNbFaces(newFaces.length / 4);
      mesh.isQuad = true;
      const wasOptim = Mesh.OPTIMIZE;
      Mesh.OPTIMIZE = false; // Bypass the fArUV capacity crash!
      mesh.init(); 
      Mesh.OPTIMIZE = wasOptim;
      mesh.initRender();
      if (this._main.guiXR) this._main.guiXR._needsRedraw = true;
    };

    this._main.getStateManager().pushStateCustom(undoQuads, redoQuads);

    redoQuads();
  }

  onQuadRemeshResult(data) {
    if (this._quadRemeshTimeout) clearTimeout(this._quadRemeshTimeout);
    this._isProcessingQuads = false;

    const activeMesh = this._main.getMesh();
    if (!activeMesh) return;

    const main = this._main;
    const newMesh = new MeshStatic(main._gl);

    newMesh.setVertices(data.vertices);
    newMesh.setFaces(data.faces);
    
    newMesh.init(); // Automatically allocates arrays, computes topology, geometry, and center!
    newMesh.initRender(); // <-- Generate Three.js geometry!
    newMesh.isQuad = true; // Remeshed output is quads!

    // Transfer transform from the active mesh
    newMesh.setMatrix(activeMesh.getMatrix());
    newMesh.setShaderType(activeMesh.getShaderType());
    if (activeMesh.getShowWireframe && newMesh.setShowWireframe) {
      newMesh.setShowWireframe(activeMesh.getShowWireframe());
    }

    activeMesh.setVisible(false);
    if (activeMesh.setShowWireframe) {
      activeMesh.setShowWireframe(false);
    }
    if (activeMesh.getThreeMesh) {
      const threeMesh = activeMesh.getThreeMesh();
      if (threeMesh) {
        threeMesh.visible = false;
      }
    }

    main.addNewMesh(newMesh);
    main.setMesh(newMesh);

    console.log(`[SculptManager] Quad Mesh Created! ${data.vertices.length/3} vertices`);
  }

  postRender() {
  }
  addSculptToScene(scene) {
    return this.getCurrentTool().addSculptToScene(scene);
  }
}

export default SculptManager;
