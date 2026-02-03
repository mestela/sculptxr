import Selection from 'drawables/Selection';
import Tools from 'editing/tools/Tools';
import Enums from 'misc/Enums';

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
        // Voxel Undo
        if (tool._voxelState) this._main.getStateManager().pushStateVoxel(tool._voxelState);
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
      if (window.screenLog && isPressed && Math.random() < 0.05) window.screenLog(`ManagerXR: No updateXR for tool ${this._toolIndex}`, "red");
    }
  }

  postRender() {
    this.getCurrentTool().postRender(this._selection);
  }

  addSculptToScene(scene) {
    return this.getCurrentTool().addSculptToScene(scene);
  }
}

export default SculptManager;
