import Enums from './Enums.js';

var keyAction = Enums.KeyAction;

var queryBool = function (value, def) {
  if (value === undefined) return def;
  if (typeof value === 'boolean') return value;
  return value !== 'false' && value !== '0';
};

var queryNumber = function (value, min, max, def) {
  var f = parseFloat(value);
  if (!f && f !== 0.0) return def;
  return Math.max(min, Math.min(max, f));
};

var queryInteger = function (value, min, max, def) {
  var f = parseInt(value, 10);
  if (!f && f !== 0.0) return def;
  return Math.max(min, Math.min(max, f));
};

var queryColor = function (color, def) {
  if (!color) return def;
  var arr = color.split(',');
  if (arr.length < 3) return def;
  var out = def.slice();
  out[0] = parseInt(arr[0] || 0, 10) / 255;
  out[1] = parseInt(arr[1] || 0, 10) / 255;
  out[2] = parseInt(arr[2] || 0, 10) / 255;
  if (arr[3] !== undefined) out[3] = parseFloat(arr[3]);
  return out;
};

var readShortcuts = function (str) {
  var shortcuts = {};

  // tools
  shortcuts['0'.charCodeAt(0)] = keyAction.MOVE;
  shortcuts['1'.charCodeAt(0)] = keyAction.BRUSH;
  shortcuts['2'.charCodeAt(0)] = keyAction.INFLATE;
  shortcuts['3'.charCodeAt(0)] = keyAction.TWIST;
  shortcuts['4'.charCodeAt(0)] = keyAction.SMOOTH;
  shortcuts['5'.charCodeAt(0)] = keyAction.FLATTEN;
  shortcuts['6'.charCodeAt(0)] = keyAction.PINCH;
  shortcuts['7'.charCodeAt(0)] = keyAction.CREASE;
  shortcuts['8'.charCodeAt(0)] = keyAction.DRAG;
  shortcuts['9'.charCodeAt(0)] = keyAction.PAINT;
  shortcuts['E'.charCodeAt(0)] = keyAction.TRANSFORM;

  // sculpting
  shortcuts['C'.charCodeAt(0)] = keyAction.INTENSITY;
  shortcuts['X'.charCodeAt(0)] = keyAction.RADIUS;
  shortcuts['N'.charCodeAt(0)] = keyAction.NEGATIVE;
  shortcuts['S'.charCodeAt(0)] = keyAction.PICKER;
  shortcuts['V'.charCodeAt(0)] = keyAction.SWAP_COLORS;
  shortcuts[46] = keyAction.DELETE; // DEL

  // camera
  shortcuts['F'.charCodeAt(0)] = keyAction.CAMERA_FRONT;
  shortcuts['T'.charCodeAt(0)] = keyAction.CAMERA_TOP;
  shortcuts['L'.charCodeAt(0)] = keyAction.CAMERA_LEFT;
  shortcuts[32] = keyAction.CAMERA_RESET; // SPACE
  shortcuts[37] = keyAction.STRIFE_LEFT;
  shortcuts[39] = keyAction.STRIFE_RIGHT;
  shortcuts[38] = keyAction.STRIFE_UP;
  shortcuts[40] = keyAction.STRIFE_DOWN;

  // rendering
  shortcuts['W'.charCodeAt(0)] = keyAction.WIREFRAME;

  // other
  shortcuts['R'.charCodeAt(0)] = keyAction.REMESH;

  if (!str)
    return shortcuts;

  var vars = str.split(',');
  for (var i = 0, nbVars = vars.length; i < nbVars; i++) {
    var pair = vars[i].split(':', 2);
    if (pair.length !== 2) continue;

    var key = pair[1].toUpperCase();
    var tInt = parseInt(key, 10);
    // check if we consider it as charcode
    if (tInt === tInt && tInt >= 10) key = tInt;
    else key = key.charCodeAt(0);

    var keyac = keyAction[pair[0].toUpperCase()];
    if (keyac !== undefined) shortcuts[key] = keyac;
  }

  return shortcuts;
};

var readUrlParameters = function () {
  var vars = window.location.search.substr(1).split('&');
  var params = {};
  for (var i = 0, nbVars = vars.length; i < nbVars; i++) {
    var pair = vars[i].split('=', 2);
    if (pair.length !== 2) continue;
    params[pair[0].toLowerCase()] = pair[1];
  }
  return params;
};

var getEnum = function (obj, str, def) {
  if (str) {
    var val = obj[str.toUpperCase()];
    if (val !== undefined) return val;
  }
  return def;
};

var options;
var getOptionsURL = function () {
  if (options)
    return options;

  options = {};

  var params = readUrlParameters();
  var localParams = {};
  try {
    const stored = localStorage.getItem('sculptxr_settings');
    if (stored) localParams = JSON.parse(stored);
  } catch (e) {}

  options._rawSaved = localParams; // Expose for dynamic lookups (per-tool)

  var getVal = function (key, def) {
    if (params[key] !== undefined) return params[key];
    if (localParams[key] !== undefined) return localParams[key];
    return def;
  };

  // misc
  options.language = getVal('language', undefined); // english/chinese/korean/japanese/russian/turkish/swedish/french/german
  options.scalecenter = queryBool(getVal('scalecenter'), false);

  // display
  options.grid = queryBool(getVal('grid'), true);
  options.outline = queryBool(getVal('outline'), false);
  options.outlinecolor = queryColor(getVal('outlinecolor'), [0.3, 0.0, 0.0, 1.0]);
  options.mirrorline = queryBool(getVal('mirrorline'), false);
  options.darkenunselected = queryBool(getVal('darkenunselected'), true);

  // camera
  options.projection = getEnum(Enums.Projection, getVal('projection'), Enums.Projection.PERSPECTIVE); // perspective/orthographic
  options.cameramode = getEnum(Enums.CameraMode, getVal('cameramode'), Enums.Projection.ORBIT); // orbit/spherical/plane
  options.pivot = queryBool(getVal('pivot'), true);
  options.fov = queryNumber(getVal('fov'), 10, 90, 45); // [10-90]

  // rendering
  options.flatshading = queryBool(getVal('flatshading'), false);
  options.wireframe = queryBool(getVal('wireframe'), false);
  options.curvature = queryNumber(getVal('curvature'), 0, 5, 0); // [0-5]
  options.exposure = queryNumber(getVal('exposure'), 0, 5); // [0-5]
  options.environment = queryInteger(getVal('environment'), 0, Infinity, 2); // [0-inf]
  options.matcap = queryInteger(getVal('matcap'), 0, Infinity, 4); // [0-inf]
  options.shader = getEnum(Enums.Shader, getVal('shader'), Enums.Shader.PBR); // pbr/matcap/normal/uv
  options.filmic = queryBool(getVal('filmic'), false);

  options.modelurl = params.modelurl; // URL only

  options.controllerModel = getVal('controllerModel', 'Auto');
  window._xrControllerOverride = options.controllerModel; // Global override for XR load sequence

  // VR UI Settings
  options.leftHandMode = queryBool(getVal('leftHandMode'), false);
  options.aimPickingMode = queryBool(getVal('aimPickingMode'), false); // Default false
  options.debugMode = queryBool(getVal('debugMode'), false);
  options.ambidextrousCursors = queryBool(getVal('ambidextrousCursors'), false);
  options.triggerCurve = queryNumber(getVal('triggerCurve'), 0.0, 1.0, 0.5);
  options.wireframeBias = queryNumber(getVal('wireframeBias'), 0.0, 0.005, 0.0001);
  options.wireframeAlpha = queryNumber(getVal('wireframeAlpha'), 0.0, 1.0, 0.25);
  options.menuBrightness = queryNumber(getVal('menuBrightness'), 0.0, 1.0, 0.25);
  options.menuSaturation = queryNumber(getVal('menuSaturation'), 0.0, 1.0, 1.0);
  options.offsetY = queryNumber(getVal('offsetY'), -2.0, 0.0, -1.2);
  const isMobileVR = typeof navigator !== 'undefined' && /OculusBrowser|Mobile VR|Mobile|Android/i.test(navigator.userAgent);
  options.wireframeType = queryNumber(getVal('wireframeType'), 0, 2, 2); // Force 2 (Full Mode) for spatial topology tests
  options.stylusLength = queryNumber(getVal('stylusLength'), 0.0, 0.30, 0.10);
  options.stylusOffset = queryNumber(getVal('stylusOffset'), -0.15, 0.15, 0.0);
  options.stylusTilt = queryNumber(getVal('stylusTilt'), -45.0, 45.0, 0.0);
  options.gizmoScale = queryNumber(getVal('gizmoScale'), 5.0, 100.0, 15.625); // [5-100], default 15.625 (0.5 of 31.25)

  options.shortcuts = readShortcuts(params.shortcuts); // URL only for now

  return options;
};

getOptionsURL._saveTimers = {};

getOptionsURL.saveOption = function (key, value, debounceMs) {
  if (debounceMs) {
    clearTimeout(getOptionsURL._saveTimers[key]);
    getOptionsURL._saveTimers[key] = setTimeout(() => {
      getOptionsURL.saveOption(key, value, 0);
    }, debounceMs);
    return;
  }

  try {
    let localParams = {};
    const stored = localStorage.getItem('sculptxr_settings');
    if (stored) localParams = JSON.parse(stored);
    localParams[key] = value;
    localStorage.setItem('sculptxr_settings', JSON.stringify(localParams));
    if (options) options[key] = value; // update runtime snapshot
  } catch (e) {
    console.warn("Failed to save to localStorage:", e);
  }
};

getOptionsURL();

window.saveOption = getOptionsURL.saveOption;
window.getOptionsURL = getOptionsURL;

getOptionsURL.getShortKey = function (key) {
  // handles numpad
  if (key >= 96 && key <= 105) key -= 48;
  return getOptionsURL().shortcuts[key];
};

export default getOptionsURL;
