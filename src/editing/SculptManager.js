import Selection from '../drawables/Selection.js';
import Tools from './tools/Tools.js';
import Enums from '../misc/Enums.js';
import Utils from '../misc/Utils.js';

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
    var canEdit = tool.start(ctrl);

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

    var vAr = mesh.getVertices();
    var cAr = mesh.getColors();
    var mAr = mesh.getMaterials();
    
    var threeMesh = mesh.getThreeMesh();
    var fAr = threeMesh && threeMesh.geometry.index ? threeMesh.geometry.index.array : null;

    if (!fAr || fAr.length === 0) {
        fAr = mesh.getTriangles(); // Fallback
    }

    var matrix = mesh.getMatrix();
    var nbVertices = mesh.getNbVertices();
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

    // Preserve cell detail (roughly 1.17 meters per cell in standard 150m bounds)
    // Scale resolution down proportional to size to reduce total cell count and speed up SurfaceNets!
    let newRes = Math.ceil(maxExtent / (150 / 128));
    newRes = Math.min(128, Math.max(32, newRes)); // Clamp [32, 128]

    // Save these for when the worker returns the mesh!
    voxelTool._pendingSize = maxExtent;
    voxelTool._pendingOffset = [cx - maxExtent / 2, cy - maxExtent / 2, cz - maxExtent / 2];
    voxelTool._pendingRes = newRes;

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

  postRender() {
  }
  addSculptToScene(scene) {
    return this.getCurrentTool().addSculptToScene(scene);
  }
}

export default SculptManager;
