import { vec3 } from 'gl-matrix';
import Tools from '../editing/tools/Tools.js';
import TR from './GuiTR.js';
import Picking from '../math3d/Picking.js';
import Enums from '../misc/Enums.js';
import Utils from '../misc/Utils.js';

var GuiSculptingTools = {};
GuiSculptingTools.tools = [];
var GuiTools = GuiSculptingTools.tools;

GuiSculptingTools.initGuiTools = function (sculpt, menu, main) {
  // init each tools ui
  // console.log("GuiSculptingTools.initGuiTools: VOXEL Index =", Enums.Tools.VOXEL);
  for (var i = 0, nbTools = Tools.length; i < nbTools; ++i) {
    if (!Tools[i]) continue;


    var uTool = GuiTools[i];
    if (!uTool) {
      console.error('No gui for tool index : ' + i);
      GuiTools[i] = { // FIX: Assign to GuiTools array, not GuiSculptingTools object
        _ctrls: [],
        init: function () {}
      };
      uTool = GuiTools[i]; // Update ref
    }
    uTool.init(sculpt.getTool(i), menu, main);
    GuiSculptingTools.hide(i);
  }
};

GuiSculptingTools.hide = function (toolIndex) {
  for (var i = 0, ctrls = GuiTools[toolIndex]._ctrls, nbCtrl = ctrls.length; i < nbCtrl; ++i)
    ctrls[i].setVisibility(false);
};

GuiSculptingTools.show = function (toolIndex) {
  for (var i = 0, ctrls = GuiTools[toolIndex]._ctrls, nbCtrl = ctrls.length; i < nbCtrl; ++i)
    ctrls[i].setVisibility(true);
};

var setOnChange = function (key, factor, val) {
  this[key] = factor ? val / factor : val;
};

// some helper functions
var addCtrlRadius = function (tool, fold, widget, main) {
  var ctrl = fold.addSlider(TR('sculptRadius'), tool._radius, function (val) {
    setOnChange.call(tool, '_radius', 1, val);
    main.getSculptManager().getSelection().setIsEditMode(true);
    main.renderSelectOverRtt();
  }, 5, 500, 1);
  widget._ctrlRadius = ctrl;
  return ctrl;
};
var addCtrlIntensity = function (tool, fold, widget) {
  var ctrl = fold.addSlider(TR('sculptIntensity'), tool._intensity * 100, setOnChange.bind(tool, '_intensity', 100), 0, 100, 1);
  widget._ctrlIntensity = ctrl;
  return ctrl;
};
var addCtrlHardness = function (tool, fold) {
  return fold.addSlider(TR('sculptHardness'), tool._hardness * 100, setOnChange.bind(tool, '_hardness', 100), 0, 100, 1);
};
var addCtrlCulling = function (tool, fold) {
  return fold.addCheckbox(TR('sculptCulling'), tool, '_culling');
};
var addCtrlNegative = function (tool, fold, widget, name) {
  var ctrl = fold.addCheckbox(name || TR('sculptNegative'), tool, '_negative');
  widget.toggleNegative = function () {
    ctrl.setValue(!ctrl.getValue());
  };
  return ctrl;
};

var importAlpha = function () {
  document.getElementById('alphaopen').click();
};
var addCtrlAlpha = function (ctrls, fold, tool, ui) {
  ctrls.push(fold.addTitle(TR('sculptAlphaTitle')));
  if (tool._lockPosition !== undefined)
    ctrls.push(fold.addCheckbox(TR('sculptLockPositon'), tool, '_lockPosition'));
  ui._ctrlAlpha = fold.addCombobox(TR('sculptAlphaTex'), tool, '_idAlpha', Picking.ALPHAS_NAMES);
  ctrls.push(ui._ctrlAlpha);
  ctrls.push(fold.addButton(TR('sculptImportAlpha'), importAlpha));
};

GuiTools[Enums.Tools.BRUSH] = {
  _ctrls: [],
  init: function (tool, fold, main) {
    this._ctrls.push(addCtrlRadius(tool, fold, this, main));
    this._ctrls.push(addCtrlIntensity(tool, fold, this));
    this._ctrls.push(addCtrlNegative(tool, fold, this));
    this._ctrls.push(fold.addCheckbox(TR('sculptClay'), tool, '_clay'));
    this._ctrls.push(fold.addCheckbox(TR('sculptAccumulate'), tool, '_accumulate'));
    this._ctrls.push(addCtrlCulling(tool, fold));
    addCtrlAlpha(this._ctrls, fold, tool, this);
  }
};

GuiTools[Enums.Tools.CREASE] = {
  _ctrls: [],
  init: function (tool, fold, main) {
    this._ctrls.push(addCtrlRadius(tool, fold, this, main));
    this._ctrls.push(addCtrlIntensity(tool, fold, this));
    this._ctrls.push(addCtrlNegative(tool, fold, this));
    this._ctrls.push(addCtrlCulling(tool, fold));
    addCtrlAlpha(this._ctrls, fold, tool, this);
  }
};

GuiTools[Enums.Tools.DRAG] = {
  _ctrls: [],
  init: function (tool, fold, main) {
    this._ctrls.push(addCtrlRadius(tool, fold, this, main));
    addCtrlAlpha(this._ctrls, fold, tool, this);
  }
};

GuiTools[Enums.Tools.FLATTEN] = {
  _ctrls: [],
  init: function (tool, fold, main) {
    this._ctrls.push(addCtrlRadius(tool, fold, this, main));
    this._ctrls.push(addCtrlIntensity(tool, fold, this));
    this._ctrls.push(addCtrlNegative(tool, fold, this));
    this._ctrls.push(addCtrlCulling(tool, fold));
    addCtrlAlpha(this._ctrls, fold, tool, this);
  }
};

GuiTools[Enums.Tools.INFLATE] = {
  _ctrls: [],
  init: function (tool, fold, main) {
    this._ctrls.push(addCtrlRadius(tool, fold, this, main));
    this._ctrls.push(addCtrlIntensity(tool, fold, this));
    this._ctrls.push(addCtrlNegative(tool, fold, this));
    this._ctrls.push(addCtrlCulling(tool, fold));
    addCtrlAlpha(this._ctrls, fold, tool, this);
  }
};

GuiTools[Enums.Tools.PAINT] = {
  _ctrls: [],
  onMaterialChanged: function (main, tool, materials) {
    vec3.copy(tool._color, materials[0].getValue());
    tool._material[0] = materials[1].getValue() / 100;
    tool._material[1] = materials[2].getValue() / 100;

    var mesh = main.getMesh();
    if (!mesh) return;

    if (tool._writeAlbedo) mesh.setAlbedo(tool._color);
    if (tool._writeRoughness) mesh.setRoughness(tool._material[0]);
    if (tool._writeMetalness) mesh.setMetallic(tool._material[1]);
    main.render();
  },
  resetMaterialOverride: function (main, tool) {
    if (this._ctrlPicker.getValue() !== tool._pickColor)
      this._ctrlPicker.setValue(tool._pickColor);

    var mesh = main.getMesh();
    if (!mesh || !mesh.getAlbedo) return;

    mesh.getAlbedo()[0] = -1.0;
    mesh.setRoughness(-1.0);
    mesh.setMetallic(-1.0);
    main.render();
  },
  onPickedMaterial: function (materials, tool, main, color, roughness, metallic) {
    main.setCanvasCursor(Utils.cursors.dropper);
    materials[0].setValue(color, true);
    materials[1].setValue(roughness * 100, true);
    materials[2].setValue(metallic * 100, true);
    vec3.copy(tool._color, color);
    tool._material[0] = roughness;
    tool._material[1] = metallic;
  },
  onColorPick: function (tool, main, val) {
    tool._pickColor = val;
    main.setCanvasCursor(val ? Utils.cursors.dropper : 'default');
    main._action = val ? Enums.Action.SCULPT_EDIT : Enums.Action.NOTHING;
    main.renderSelectOverRtt();
  },
  init: function (tool, fold, main) {
    this._ctrls.push(addCtrlRadius(tool, fold, this, main));
    this._ctrls.push(addCtrlIntensity(tool, fold, this));
    this._ctrls.push(addCtrlHardness(tool, fold, this));
    this._ctrls.push(addCtrlCulling(tool, fold));

    this._ctrls.push(fold.addTitle(TR('sculptPBRTitle')));
    this._ctrls.push(fold.addButton(TR('sculptPaintAll'), tool, 'paintAll'));
    this._ctrlPicker = fold.addCheckbox(TR('sculptPickColor'), tool._pickColor, this.onColorPick.bind(this, tool, main));
    this._ctrls.push(this._ctrlPicker);

    var materials = [];
    var cbMatChanged = this.onMaterialChanged.bind(this, main, tool, materials);
    var ctrlColor = fold.addColor(TR('sculptColor'), tool._color, cbMatChanged);
    var ctrlRoughness = fold.addSlider(TR('sculptRoughness'), tool._material[0] * 100, cbMatChanged, 0, 100, 1);
    var ctrlMetallic = fold.addSlider(TR('sculptMetallic'), tool._material[1] * 100, cbMatChanged, 0, 100, 1);

    this.swapColors = () => tool.swapColors();
    this._ctrls.push(fold.addButton('Swap Colors (V)', this.swapColors));

    materials.push(ctrlColor, ctrlRoughness, ctrlMetallic);
    this._ctrls.push(ctrlColor, ctrlRoughness, ctrlMetallic);
    tool.setPickCallback(this.onPickedMaterial.bind(this, materials, tool, main));

    tool._onColorSwapped = () => {
      materials[0].setValue(tool._color, true);
      materials[1].setValue(tool._material[0] * 100, true);
      materials[2].setValue(tool._material[1] * 100, true);
      main.render();
    };

    // mask
    this._ctrls.push(fold.addTitle('Write channel'));
    this._ctrls.push(fold.addCheckbox(TR('sculptColor'), tool, '_writeAlbedo'));
    this._ctrls.push(fold.addCheckbox(TR('sculptRoughness'), tool, '_writeRoughness'));
    this._ctrls.push(fold.addCheckbox(TR('sculptMetallic'), tool, '_writeMetalness'));

    window.addEventListener('keyup', this.resetMaterialOverride.bind(this, main, tool));
    window.addEventListener('mouseup', this.resetMaterialOverride.bind(this, main, tool));

    addCtrlAlpha(this._ctrls, fold, tool, this);
  }
};

GuiTools[Enums.Tools.PINCH] = {
  _ctrls: [],
  init: function (tool, fold, main) {
    this._ctrls.push(addCtrlRadius(tool, fold, this, main));
    this._ctrls.push(addCtrlIntensity(tool, fold, this));
    this._ctrls.push(addCtrlNegative(tool, fold, this));
    this._ctrls.push(addCtrlCulling(tool, fold));
    addCtrlAlpha(this._ctrls, fold, tool, this);
  }
};

GuiTools[Enums.Tools.TWIST] = {
  _ctrls: [],
  init: function (tool, fold, main) {
    this._ctrls.push(addCtrlRadius(tool, fold, this, main));
    this._ctrls.push(addCtrlCulling(tool, fold));
    addCtrlAlpha(this._ctrls, fold, tool, this);
  }
};

GuiTools[Enums.Tools.LOCALSCALE] = {
  _ctrls: [],
  init: function (tool, fold, main) {
    this._ctrls.push(addCtrlRadius(tool, fold, this, main));
    this._ctrls.push(addCtrlCulling(tool, fold));
    addCtrlAlpha(this._ctrls, fold, tool, this);
  }
};

GuiTools[Enums.Tools.MOVE] = {
  _ctrls: [],
  init: function (tool, fold, main) {
    this._ctrls.push(addCtrlRadius(tool, fold, this, main));
    this._ctrls.push(addCtrlIntensity(tool, fold, this));
    this._ctrls.push(fold.addCheckbox(TR('sculptTopologicalCheck'), tool, '_topoCheck'));
    this._ctrls.push(addCtrlNegative(tool, fold, this, TR('sculptMoveAlongNormal')));
    addCtrlAlpha(this._ctrls, fold, tool, this);
  }
};

GuiTools[Enums.Tools.SMOOTH] = {
  _ctrls: [],
  init: function (tool, fold, main) {
    this._ctrls.push(addCtrlRadius(tool, fold, this, main));
    this._ctrls.push(addCtrlIntensity(tool, fold, this));
    this._ctrls.push(fold.addCheckbox(TR('sculptTangentialSmoothing'), tool, '_tangent'));
    this._ctrls.push(addCtrlCulling(tool, fold));
    addCtrlAlpha(this._ctrls, fold, tool, this);
  }
};

GuiTools[Enums.Tools.MASKING] = {
  _ctrls: [],
  init: function (tool, fold, main) {
    this._ctrls.push(addCtrlRadius(tool, fold, this, main));
    this._ctrls.push(addCtrlIntensity(tool, fold, this));
    this._ctrls.push(addCtrlHardness(tool, fold, this));
    this._ctrls.push(addCtrlNegative(tool, fold, this));
    this._ctrls.push(addCtrlCulling(tool, fold));
    this._main = main;
    this._tool = tool;
    var bci = fold.addDualButton(TR('sculptMaskingClear'), TR('sculptMaskingInvert'), tool, tool, 'clear', 'invert');
    var bbs = fold.addDualButton(TR('sculptMaskingBlur'), TR('sculptMaskingSharpen'), tool, tool, 'blur', 'sharpen');
    this._ctrls.push(bci[0], bci[1], bbs[0], bbs[1]);
    // mask extract
    this._ctrls.push(fold.addTitle(TR('sculptExtractTitle')));
    this._ctrls.push(fold.addSlider(TR('sculptExtractThickness'), tool, '_thickness', -5, 5, 0.001));
    this._ctrls.push(fold.addButton(TR('sculptExtractAction'), tool, 'extract'));
    addCtrlAlpha(this._ctrls, fold, tool, this);
  }
};

GuiTools[Enums.Tools.TRANSFORM] = {
  _ctrls: [],
  init: function () {}
};

GuiTools[Enums.Tools.TRANSFORM_VR] = {
  _ctrls: [],
  init: function (tool, fold, main) {
    const ROW_Labels = ['T', 'R', 'S'];
    const COL_Labels = ['X', 'Y', 'Z'];

    // Helper to refresh UI (since buttons need to update their visual state)
    // Actually in GuiVR, buttons don't have "active" state easily?
    // We can use the Label to show state? "[ X ]" vs "X"
    // Or we just rely on `main.guiXR.refreshToolsWidget()` which rebuilds everything?
    // Let's assume hitting a button triggers a rebuild if we call it.

    const refresh = () => {
      if (main.guiXR) main.guiXR.refreshToolsWidget();
    };

    const gap = 10;
    const btnW = 100; // 350 total -> 3*100 + 2*10 = 320. Fits.

    // 3x3 Grid
    for (let r = 0; r < 3; ++r) {
      // MODE ROW
      // We want to group them?
      // Actually layout is just x, y coordinate.
      // We can add them sequentially.

      // Buttons for X, Y, Z in this Row (Mode)
      // If Mode == r, then we show the Axis State.
      // If Mode != r, clicking sets Mode to r.

      const isCurrentMode = (tool._mode === r);
      // Label prefix?
      const prefix = ROW_Labels[r];

      // Add a header or just use the buttons?
      // Let's use buttons.

      // We need to pass x, y explicitly to `add*` functions if we want custom layout?
      // GuiVR usually stacks vertically unless we do custom pushing?
      // The `fold` passed here is the `GuiVR` or `GuiVRFolder`?
      // In `GuiVRTools.js`, `fold` seems to be the `activeTool` specific context?
      // No, `GuiVRTools.initGuiTools` passes `menu`.
      // `menu` isn't passed here?
      // Wait. `GuiVRTools.js` `getToolsWidgets` constructs a JSON array `widgets`.
      // It DOES NOT use `init` like `GuiSculptingTools.js`.
      // `GuiVRTools.js` exports `getToolsWidgets`.
      // `GuiSculptingTools.js` uses `init`.
      // I am editing `GuiVRTools.js` which builds widgets ARRAY.
      // I don't use `init` function logic inside `GuiVRTools.js`!
      // I am editing the `getToolsWidgets` function directly.
    }
  }
};

GuiTools[Enums.Tools.VOXEL] = {
  _ctrls: [],
  init: function (tool, fold, main) {
    // Resolution
    this._ctrls.push(fold.addTitle("Resolution"));
    var ctrlRes = fold.addSlider("Res", tool._res, function (val) {
      if (tool.setResolutionPreview) tool.setResolutionPreview(val);
      else tool.setResolution(val);
    }, 16, 400, 1);
    this._ctrls.push(ctrlRes);

    this._ctrls.push(fold.addButton("Resample (No Undo)", function () {
      if (tool.applyResolution) tool.applyResolution();
    }));
    // Let's use a combobox or similar.
    var options = { 'Add': 0, 'Subtract': 1, 'Inflate': 2 };
    var ctrlMode = fold.addCombobox('Mode', tool, '_mode', options);
    this._ctrls.push(ctrlMode);

    // Intensity/Strength (only for Inflate?)
    // Actually SculptVoxel uses it for Inflate strength (default 0.5)
    // Reuse addCtrlIntensity but map it to _strength?
    // addCtrlIntensity maps to _intensity (0..1).
    // Let's use a custom slider for Strength (0..1 or 0..2?)
    var ctrlStrength = fold.addSlider('Strength', tool._strength * 100, function (val) {
      tool._strength = val / 100;
    }, 0, 100, 1);
    this._ctrls.push(ctrlStrength);

    this._ctrls.push(fold.addButton('Flip Winding', tool, 'flipWinding'));
    this._ctrls.push(fold.addButton('Clear', tool, 'clear'));
  }
};

GuiTools[Enums.Tools.GRAB] = {
  _ctrls: [],
  init: function () { }
};

export default GuiSculptingTools;
