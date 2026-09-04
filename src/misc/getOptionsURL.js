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
  options.nomadHost = getVal('nomadHost', ''); // last Nomad Link address, so a refresh reconnects in one tap
  options.nomadLiveSend = queryBool(getVal('nomadLiveSend'), false);
  options.sculptLocked = queryBool(getVal('sculptLocked'), false); // "do nothing" mode
  // Nomad units -> SculptXR units. Half of Utils.SCALE: a whole Nomad scene is
  // roughly one unit, and normalising it to a full 100 arrives too big to work on.
  options.nomadScale = queryNumber(getVal('nomadScale'), 0.01, 10000, 50);

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
  // Which physics-bone solver runs. Off is the force solver, which is still the default: the
  // constraint one removes the pin-activation pop but does not yet land the hand on the pin.
  options.physicsXPBD = queryBool(getVal('physicsXPBD'), false);
  options.ambidextrousCursors = queryBool(getVal('ambidextrousCursors'), false);
  options.triggerCurve = queryNumber(getVal('triggerCurve'), 0.0, 1.0, 0.5);
  options.wireframeBias = queryNumber(getVal('wireframeBias'), 0.0, 0.005, 0.0001);
  options.wireframeAlpha = queryNumber(getVal('wireframeAlpha'), 0.0, 1.0, 0.25);
  options.menuBrightness = queryNumber(getVal('menuBrightness'), 0.0, 1.0, 0.65); // matt-tuned menu look
  options.menuSaturation = queryNumber(getVal('menuSaturation'), 0.0, 1.0, 0.50);
  options.menuGamma      = queryNumber(getVal('menuGamma'),      0.0, 1.0, 0.0);  // (0.5 = neutral γ 1.0)
  options.offsetY = queryNumber(getVal('offsetY'), -2.0, 0.0, -1.2);
  const isMobileVR = typeof navigator !== 'undefined' && /OculusBrowser|Mobile VR|Mobile|Android/i.test(navigator.userAgent);
  options.wireframeType = queryNumber(getVal('wireframeType'), 0, 2, 2); // Force 2 (Full Mode) for spatial topology tests
  options.stylusLength = queryNumber(getVal('stylusLength'), 0.0, 0.30, 0.10);
  options.stylusOffset = queryNumber(getVal('stylusOffset'), -0.15, 0.15, 0.0);
  options.stylusTilt = queryNumber(getVal('stylusTilt'), -45.0, 45.0, 0.0);
  options.gizmoScale = queryNumber(getVal('gizmoScale'), 5.0, 100.0, 15.625); // [5-100], default 15.625 (0.5 of 31.25)
  options.gizmoSizeMul = queryNumber(getVal('gizmoSizeMul'), 0.25, 2.0, 1.0); // user size multiplier for the VR transform gizmo
  // Centre handle of the VR gizmo carries the controller's ROTATION as well as its
  // position (6DOF, the way Grab holds a thing). Off = the centre handle translates only.
  options.xfFreeRotate = queryBool(getVal('xfFreeRotate'), false);

  // Bone display flags — persisted so the rig looks the way you left it. Capsules and
  // weights default OFF: both are diagnostics drawn over the sculpt. Registry and accessors
  // live in editing/Skeleton.js (Skeleton.DISPLAY_FLAGS); these defaults must match it.
  options.boneSnapPlane = queryBool(getVal('boneSnapPlane'), true);
  options.boneSnapAxis = queryBool(getVal('boneSnapAxis'), true);
  options.boneShowLengths = queryBool(getVal('boneShowLengths'), false);
  options.boneShowNames = queryBool(getVal('boneShowNames'), false);
  options.boneShowCapsules = queryBool(getVal('boneShowCapsules'), false);
  options.boneShowWeights = queryBool(getVal('boneShowWeights'), false);
  options.boneShowSolid = queryBool(getVal('boneShowSolid'), true);
  options.boneShowWire = queryBool(getVal('boneShowWire'), true);
  options.boneShowJointDots = queryBool(getVal('boneShowJointDots'), true);
  options.boneShowPins = queryBool(getVal('boneShowPins'), true);
  // Which side the on-screen secondary-action modifier sits on. Off = right, matching the
  // right-click shorthand; a left-hander swaps it so it is not under the drawing hand.
  options.modifierLeft = queryBool(getVal('modifierLeft'), false);
  // Motion path editing: does the brush travel ALONG the strand (default) or straight through
  // space? A path is monotonic in time, so along-the-strand is implicitly a time-ordered
  // falloff; off reaches every pass through a region, which is occasionally what you want.
  options.pathConnected = queryBool(getVal('pathConnected'), true);
  // Which channel of the keys a motion-path edit writes. Both by default: the twist reaching
  // the orientations is the point of the feature, and a default of off would read as it not
  // working. See MotionPathEdit.channels.
  options.pathTranslate = queryBool(getVal('pathTranslate'), true);
  options.pathRotate = queryBool(getVal('pathRotate'), true);
  // Which channels a transform TAKE records. All three by default — a recorder that quietly
  // drops a channel is worse than one that records too much.
  options.recTranslate = queryBool(getVal('recTranslate'), true);
  options.recRotate = queryBool(getVal('recRotate'), true);
  options.recScale = queryBool(getVal('recScale'), true);
  // Extra height for the wrist panels, for controllers with a tracking ring (Quest 2) that the
  // panels would otherwise clip through. 0 = the shared default. See HTMLVRPanel.wristPanelY.
  options.wristPanelLift = queryNumber(getVal('wristPanelLift'), 0.0, 0.20, 0.0);
  window._wristPanelLiftSaved = options.wristPanelLift;
  options.boneShowTrails = queryBool(getVal('boneShowTrails'), false);
  options.boneShowGnomons = queryBool(getVal('boneShowGnomons'), false);
  options.boneShowGnomonsAll = queryBool(getVal('boneShowGnomonsAll'), false);
  // Which half of a VR grab is applied. Both on is the ordinary 6DOF grab; translation off
  // turns a grabbed joint from an IK effector into a plain FK rotation.
  options.grabTranslate = queryBool(getVal('grabTranslate'), true);
  options.grabRotate = queryBool(getVal('grabRotate'), true);

  options.shortcuts = readShortcuts(params.shortcuts); // URL only for now

  // Input
  options.tabletRadiusFactor    = queryNumber(getVal('tabletRadiusFactor'),    0.0, 1.0,   0.75);
  options.tabletIntensityFactor = queryNumber(getVal('tabletIntensityFactor'), 0.0, 1.0,   0.0);

  // iPad multitouch routing (defaults match existing behaviour)
  options.ipadFingerView    = queryBool(getVal('ipadFingerView'),    true);
  options.ipadFingerSculpt  = queryBool(getVal('ipadFingerSculpt'),  false);
  options.ipadStylusView    = queryBool(getVal('ipadStylusView'),    false);
  options.ipadStylusSculpt  = queryBool(getVal('ipadStylusSculpt'),  true);

  // Numeric entry: force the on-screen numpad outside VR (useful on
  // keyboard-less tablets). In VR the numpad is always used regardless.
  options.alwaysNumpad      = queryBool(getVal('alwaysNumpad'),      false);

  // VR timeline panel size in metres (persisted so a resize sticks across
  // sessions). H = 0 means "derive from canvas aspect" on first open.
  options.vrTimelineW       = queryNumber(getVal('vrTimelineW'), 0.20, 1.60, 0.90);
  options.vrTimelineH       = queryNumber(getVal('vrTimelineH'), 0.00, 0.40, 0.00);
  // VR timeline dope/graph mode (persisted): 'dope' | 'graph'.
  options.vrTimelineMode    = (getVal('vrTimelineMode') === 'dope') ? 'dope' : (getVal('vrTimelineMode') === 'graph' ? 'graph' : null);

  // History
  options.maxUndo = queryInteger(getVal('maxUndo'), 3, 500, 50);

  // Topology
  options.remesh_resolution = queryNumber(getVal('remesh_resolution'), 0, Infinity, 1.0);

  // Animation
  options.animFPS = queryInteger(getVal('animFPS'), 1, 120, 24);
  // Record mode (persisted, mutually exclusive). Default for new users: Start-on-click ON,
  // Count-in OFF (matt uses start-on-click most).
  options.animStartOnClick = queryBool(getVal('animStartOnClick'), true);
  options.animCountIn      = queryBool(getVal('animCountIn'),      false);
  options.animLoopEnabled  = queryBool(getVal('animLoopEnabled'),  true);

  // Scene
  // 0.2 is matt's own setting, arrived at in AR against a real room: the grid reads as a floor
  // rather than competing with the sculpt. Persisted like every other slider, so it survives a
  // reload -- it was tuned once and should not have to be tuned again.
  options.gridOpacity = queryNumber(getVal('gridOpacity'), 0.0, 1.0, 0.2);

  // Rig
  // How see-through a BOUND mesh is drawn, so the capsules inside it can be seen and sculpted.
  // 1 is opaque, which is what every rig starts as -- this is a working view, turned on while
  // weighting and turned back off after, and persisted so it survives the reload that a long
  // weighting session tends to involve.
  options.skinOpacity = queryNumber(getVal('skinOpacity'), 0.05, 1.0, 1.0);

  // One-time migration to the new menu-colour defaults (v3.4.x). The brightness/saturation
  // sliders were dead from the canvas→HTML migration until v3.4.0, so any *saved* values are
  // stale old-defaults (e.g. saturation 100%). Force 65/55/0 once, then respect user changes.
  try {
    if (typeof localStorage !== 'undefined' && !localStorage.getItem('menuGradeDefaultsV2')) {
      localStorage.setItem('menuGradeDefaultsV2', '1');
      options.menuBrightness = 0.65; getOptionsURL.saveOption('menuBrightness', 0.65, 0);
      options.menuSaturation = 0.50; getOptionsURL.saveOption('menuSaturation', 0.50, 0);
      options.menuGamma      = 0.0;  getOptionsURL.saveOption('menuGamma',      0.0,  0);
    }
  } catch (e) { /* localStorage unavailable — fall through with read defaults */ }

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

// Shader mode is a viewport preference, not mesh authoring data. Keep one numeric runtime
// value, persist its readable enum name, and apply it to every ordinary scene mesh. Rig
// controls and reference images own specialised shaders and are deliberately excluded.
getOptionsURL.shaderName = function (shader) {
  if (shader === Enums.Shader.MATCAP) return 'matcap';
  if (shader === Enums.Shader.FLAT) return 'flat';
  if (shader === Enums.Shader.NORMAL) return 'normal';
  if (shader === Enums.Shader.UV) return 'uv';
  return 'pbr';
};

getOptionsURL.setGlobalShader = function (main, shader) {
  getOptionsURL.saveOption('shader', getOptionsURL.shaderName(shader));
  getOptionsURL().shader = shader; // saveOption stores the serialised name in the live snapshot
  const meshes = main?.getMeshes?.() || [];
  for (const mesh of meshes) {
    if (!mesh?.setShaderType || mesh._isBone || mesh._isNull || mesh._isReference) continue;
    mesh.setShaderType(shader);
  }
  main?.render?.();
};

getOptionsURL.setGlobalFlatShading = function (main, enabled) {
  enabled = !!enabled;
  getOptionsURL.saveOption('flatshading', enabled);
  const meshes = main?.getMeshes?.() || [];
  for (const mesh of meshes) {
    if (!mesh?.setFlatShading || mesh._isBone || mesh._isNull || mesh._isReference) continue;
    mesh.setFlatShading(enabled);
  }
  main?.render?.();
};

getOptionsURL.setGlobalWireframe = function (main, enabled) {
  enabled = !!enabled;
  getOptionsURL.saveOption('wireframe', enabled);
  const meshes = main?.getMeshes?.() || [];
  for (const mesh of meshes) {
    if (!mesh?.setShowWireframe || mesh._isBone || mesh._isNull || mesh._isReference) continue;
    mesh.setShowWireframe(enabled);
  }
  main?.render?.();
};

getOptionsURL();

// Hand-puppetry (#28 v1): honour ?puppet=1 to start in puppet mode — an in-headset
// toggle without a console (window.togglePuppet() flips it live thereafter). Read ONCE
// here at load so repeated getOptionsURL() calls can't re-clobber a live toggle-off.
if (typeof window !== 'undefined') {
  try {
    var _pp = new URLSearchParams(window.location.search).get('puppet');
    if (_pp !== null && _pp !== 'false' && _pp !== '0') window._puppetMode = true;
  } catch (e) { /* no URL context */ }
}

window.saveOption = getOptionsURL.saveOption;
window.getOptionsURL = getOptionsURL;

getOptionsURL.getShortKey = function (key) {
  // handles numpad
  if (key >= 96 && key <= 105) key -= 48;
  return getOptionsURL().shortcuts[key];
};

export default getOptionsURL;
