import TR from './GuiTR.js';
import Enums from '../misc/Enums.js';
import Tools from '../editing/tools/Tools.js';
import getOptionsURL from '../misc/getOptionsURL.js';
import GuiSculptingTools from './GuiSculptingTools.js';

var GuiTools = GuiSculptingTools.tools;

class GuiSculpting {

  constructor(guiParent, ctrlGui) {
    this._main = ctrlGui._main; // main application
    this._ctrlGui = ctrlGui; // main gui
    this._sculptManager = ctrlGui._main.getSculptManager(); // sculpting management
    this._toolOnRelease = -1; // tool to apply when the mouse or the key is released
    this._invertSign = false; // invert sign of tool (add/sub)

    this._modalBrushRadius = false; // modal brush radius change
    this._modalBrushIntensity = false; // modal brush intensity change

    // modal stuffs (not canvas based, because no 3D picking involved)
    this._lastPageX = 0;
    this._lastPageY = 0;
    // for modal radius
    this._refX = 0;
    this._refY = 0;

    this._menu = null;
    this._ctrlSculpt = null;
    this._ctrlSymmetry = null;
    this._ctrlContinuous = null;
    this._ctrlTitleCommon = null;
    this.init(guiParent);
  }

  init(guiParent) {
    var menu = this._menu = guiParent.addMenu(TR('sculptTitle'));
    menu.open();

    // sculpt tool categories
    const sculptTools = [
      Enums.Tools.BRUSH, Enums.Tools.INFLATE, Enums.Tools.TWIST, Enums.Tools.SMOOTH,
      Enums.Tools.FLATTEN, Enums.Tools.PINCH, Enums.Tools.CREASE, Enums.Tools.DRAG,
      Enums.Tools.RELAX, Enums.Tools.PAINT, Enums.Tools.MOVE, Enums.Tools.MASKING,
      Enums.Tools.LOCALSCALE, Enums.Tools.TRANSFORM
    ];

    const lowPolyTools = [
      Enums.Tools.DELETE_FACE, Enums.Tools.FILL_HOLE, Enums.Tools.DISSOLVE_EDGE,
      Enums.Tools.SPLIT_FACE, Enums.Tools.SPIN_EDGE, Enums.Tools.COLLAPSE_EDGE,
      Enums.Tools.DISSOLVE_VERTEX, Enums.Tools.WELD,
      Enums.Tools.CUT_TOOL,
      Enums.Tools.EXTRUDE, Enums.Tools.INSET,
      Enums.Tools.TRANSFORM
    ];

    const voxelTools = [
      Enums.Tools.VOXEL
    ];

    const buildOptTools = (list) => {
      const opts = { '-1': 'None' };
      list.forEach(id => {
        if (Tools[id]) opts[id] = TR(Tools[id].uiName);
      });
      return opts;
    };

    const currentTool = this._sculptManager.getToolIndex();

    menu.addTitle('Sculpt Tools');
    this._ctrlSculpt = menu.addCombobox('', sculptTools.includes(currentTool) ? currentTool : -1, this.onChangeTool.bind(this), buildOptTools(sculptTools));

    menu.addTitle('Low Poly Tools');
    this._ctrlLowPoly = menu.addCombobox('', lowPolyTools.includes(currentTool) ? currentTool : -1, this.onChangeTool.bind(this), buildOptTools(lowPolyTools));
    
    // Global option for Inset and Extrude
    this._ctrlKeepTogether = menu.addCheckbox('Keep Together', !!window.keepExtrudeFacesTogether, (val) => {
      window.keepExtrudeFacesTogether = val;
    });

    menu.addTitle('Voxel Tools');
    this._ctrlVoxel = menu.addCombobox('', voxelTools.includes(currentTool) ? currentTool : -1, this.onChangeTool.bind(this), buildOptTools(voxelTools));

    // Store lists for sync
    this._sculptToolsList = sculptTools;
    this._lowPolyToolsList = lowPolyTools;
    this._voxelToolsList = voxelTools;

    GuiSculptingTools.initGuiTools(this._sculptManager, this._menu, this._main);

    this._ctrlTitleCommon = menu.addTitle(TR('sculptCommon'));
    // symmetry
    this._ctrlSymmetry = menu.addCheckbox(TR('sculptSymmetry'), this._sculptManager._symmetry, this.onSymmetryChange.bind(this));
    menu.addDualButton(TR('sculptSymLR'), TR('sculptSymRL'), this, this, 'onSymLR', 'onSymRL');
    // continuous
    this._ctrlContinuous = menu.addCheckbox(TR('sculptContinuous'), this._sculptManager, '_continuous');

    GuiSculptingTools.show(this._sculptManager.getToolIndex());
    this.addEvents();
    this.onChangeTool(this._sculptManager.getToolIndex());
  }

  onSymmetryChange(value) {
    this._sculptManager._symmetry = value;
    this._main.render();
  }

  onSymLR() {
    const mesh = this._main.getMesh();
    if (!mesh) return;

    // Undo Support
    const symData = mesh.getSymmetryData();
    if (symData) {
      const verts = symData.getSymmetryDestinations(0); // 0 = L->R
      if (verts.length > 0) {
        this._main.getStateManager().pushStateGeometry(mesh);
        this._main.getStateManager().pushVertices(verts);
      }
    }

    mesh.symmetrize(0);
    this._main.render();
  }

  onSymRL() {
    const mesh = this._main.getMesh();
    if (!mesh) return;

    // Undo Support
    const symData = mesh.getSymmetryData();
    if (symData) {
      const verts = symData.getSymmetryDestinations(1); // 1 = R->L
      if (verts.length > 0) {
        this._main.getStateManager().pushStateGeometry(mesh);
        this._main.getStateManager().pushVertices(verts);
      }
    }

    mesh.symmetrize(1);
    this._main.render();
  }

  addEvents() {
    var cbLoadAlpha = this.loadAlpha.bind(this);
    document.getElementById('alphaopen').addEventListener('change', cbLoadAlpha, false);
    this.removeCallback = function () {
      document.getElementById('alphaopen').removeEventListener('change', cbLoadAlpha, false);
    };
  }

  removeEvents() {
    if (this.removeCallback) this.removeCallback();
  }

  getSelectedTool() {
    return this._sculptManager.getToolIndex();
  }

  releaseInvertSign() {
    if (!this._invertSign)
      return;
    this._invertSign = false;
    var tool = GuiTools[this.getSelectedTool()];
    if (tool.toggleNegative)
      tool.toggleNegative();
  }

  onChangeTool(newValue) {
    newValue = parseInt(newValue, 10);
    if (newValue === -1) return; // Ignore "None" selection

    // Sync other comboboxes
    if (this._ctrlSculpt) this._ctrlSculpt.setValue(this._sculptToolsList.includes(newValue) ? newValue : -1, true);
    if (this._ctrlLowPoly) this._ctrlLowPoly.setValue(this._lowPolyToolsList.includes(newValue) ? newValue : -1, true);
    if (this._ctrlVoxel) this._ctrlVoxel.setValue(this._voxelToolsList.includes(newValue) ? newValue : -1, true);

    GuiSculptingTools.hide(this._sculptManager.getToolIndex());
    this._sculptManager.setToolIndex(newValue);
    GuiSculptingTools.show(newValue);

    var showContinuous = this._sculptManager.canBeContinuous() === true;
    this._ctrlContinuous.setVisibility(showContinuous);

    var showSym = newValue !== Enums.Tools.TRANSFORM;
    this._ctrlSymmetry.setVisibility(showSym);

    this._ctrlTitleCommon.setVisibility(showContinuous || showSym);

    this._main.getPicking().updateLocalAndWorldRadius2();
  }

  loadAlpha(event) {
    if (event.target.files.length === 0)
      return;

    var file = event.target.files[0];
    if (!file.type.match('image.*'))
      return;

    var reader = new FileReader();
    var main = this._main;
    var tool = GuiTools[this._sculptManager.getToolIndex()];

    reader.onload = function (evt) {
      var img = new Image();
      img.src = evt.target.result;
      img.onload = main.onLoadAlphaImage.bind(main, img, file.name || 'new alpha', tool);
    };

    document.getElementById('alphaopen').value = '';
    reader.readAsDataURL(file);
  }

  addAlphaOptions(opts) {
    for (var i = 0, nbTools = GuiTools.length; i < nbTools; ++i) {
      var gTool = GuiTools[i];
      if (gTool && gTool._ctrlAlpha) gTool._ctrlAlpha.addOptions(opts);
    }
  }

  updateMesh() {
    this._menu.setVisibility(!!this._main.getMesh());
  }

  _startModalBrushRadius(x, y) {
    this._refX = x;
    this._refY = y;
    var cur = GuiTools[this.getSelectedTool()];
    if (cur._ctrlRadius) {
      var rad = cur._ctrlRadius.getValue();
      this._refX -= rad;
      this._main.getSculptManager().getSelection().setOffsetX(-rad * this._main.getPixelRatio());
      this._main.renderSelectOverRtt();
    }
  }

  _checkModifierKey(event) {
    var selectedTool = this.getSelectedTool();
    // console.log("[GuiSculpting] _checkModifierKey, ctrl:", event.ctrlKey, "selected:", selectedTool, "toolOnRelease:", this._toolOnRelease);

    if (this._main._action === Enums.Action.NOTHING) {
      if (event.shiftKey && !event.altKey && !event.ctrlKey) {
        // smoothing on shift key
        if (selectedTool !== Enums.Tools.SMOOTH && selectedTool !== Enums.Tools.EXTRUDE) {
          this._toolOnRelease = selectedTool;
          this._ctrlSculpt.setValue(Enums.Tools.SMOOTH);
        }
      }
      if (event.ctrlKey && !event.shiftKey && !event.altKey) {
        // masking on ctrl key
        if (selectedTool !== Enums.Tools.MASKING) {
          this._toolOnRelease = selectedTool;
          this._ctrlSculpt.setValue(Enums.Tools.MASKING);
        }
      }
    }
    if (event.altKey) {
      // invert sign on alt key
      if (this._invertSign || event.shiftKey) return true;
      this._invertSign = true;
      var curTool = GuiTools[selectedTool];
      if (curTool.toggleNegative)
        curTool.toggleNegative();
      return true;
    }
    return false;
  }

  ////////////////
  // KEY EVENTS
  //////////////// 
  onKeyDown(event) {
    if (event.handled === true)
      return;

    var main = this._main;
    var shk = getOptionsURL.getShortKey(event.which);
    event.stopPropagation();

    if (!main._focusGui || shk === Enums.KeyAction.RADIUS || shk === Enums.KeyAction.INTENSITY)
      event.preventDefault();

    event.handled = true;
    if (this._checkModifierKey(event))
      return;

    if (main._action !== Enums.Action.NOTHING)
      return;

    if (shk !== undefined && Tools[shk])
      return this._ctrlSculpt.setValue(shk);

    var cur = GuiTools[this.getSelectedTool()];

    switch (shk) {
    case Enums.KeyAction.DELETE:
      main.deleteCurrentSelection();
      break;
    case Enums.KeyAction.INTENSITY:
      this._modalBrushIntensity = main._focusGui = true;
      break;
    case Enums.KeyAction.RADIUS:
      if (!this._modalBrushRadius) this._startModalBrushRadius(this._lastPageX, this._lastPageY);
      this._modalBrushRadius = main._focusGui = true;
      break;
    case Enums.KeyAction.NEGATIVE:
      if (cur.toggleNegative) cur.toggleNegative();
      break;
    case Enums.KeyAction.PICKER:
      var ctrlPicker = cur._ctrlPicker;
      if (ctrlPicker && !ctrlPicker.getValue()) ctrlPicker.setValue(true);
      break;
      case Enums.KeyAction.SWAP_COLORS:
        if (cur.swapColors) cur.swapColors();
        break;
    default:
      event.handled = false;
    }
  }

  onKeyUp(event) {
    var releaseTool = this._main._action === Enums.Action.NOTHING && this._toolOnRelease !== -1 && !event.ctrlKey && !event.shiftKey;
    // console.log("[GuiSculpting] onKeyUp, releaseTool:", releaseTool, "toolOnRelease:", this._toolOnRelease, "ctrl:", event.ctrlKey);
    if (!event.altKey || releaseTool)
      this.releaseInvertSign();

    if (releaseTool) {
      this.onChangeTool(this._toolOnRelease);
      this._toolOnRelease = -1;
    }

    var main = this._main;
    switch (getOptionsURL.getShortKey(event.which)) {
    case Enums.KeyAction.RADIUS:
      this._modalBrushRadius = main._focusGui = false;
      var selRadius = this._main.getSculptManager().getSelection();
      selRadius.setOffsetX(0.0);
      event.pageX = this._lastPageX;
      event.pageY = this._lastPageY;
      main.setMousePosition(event);
      main.getPicking().intersectionMouseMeshes();
      main.renderSelectOverRtt();
      break;
    case Enums.KeyAction.PICKER:
      var cur = GuiTools[this.getSelectedTool()];
      var ctrlPicker = cur._ctrlPicker;
      if (ctrlPicker && ctrlPicker.getValue()) ctrlPicker.setValue(false);
      break;
    case Enums.KeyAction.INTENSITY:
      this._modalBrushIntensity = main._focusGui = false;
      break;
    }
  }

  ////////////////
  // MOUSE EVENTS
  ////////////////
  onMouseUp(event) {
    if (this._toolOnRelease !== -1 && !event.ctrlKey && !event.shiftKey) {
      this.releaseInvertSign();
      this._ctrlSculpt.setValue(this._toolOnRelease);
      this._toolOnRelease = -1;
    }
  }

  onMouseMove(event) {
    var wid = GuiTools[this.getSelectedTool()];

    if (this._modalBrushRadius && wid._ctrlRadius) {
      var dx = event.pageX - this._refX;
      var dy = event.pageY - this._refY;
      wid._ctrlRadius.setValue(Math.sqrt(dx * dx + dy * dy));
      this._main.renderSelectOverRtt();
    }

    if (this._modalBrushIntensity && wid._ctrlIntensity) {
      wid._ctrlIntensity.setValue(wid._ctrlIntensity.getValue() + event.pageX - this._lastPageX);
    }

    this._lastPageX = event.pageX;
    this._lastPageY = event.pageY;
  }

  onMouseOver(event) {
    if (this._modalBrushRadius)
      this._startModalBrushRadius(event.pageX, event.pageY);
  }
}

export default GuiSculpting;
