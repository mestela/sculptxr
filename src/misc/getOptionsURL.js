import Enums from './Enums.js';

// THE MENU COLOUR GRADE, IN ONE PLACE. Brightness, saturation and gamma applied to the
// rasterised panel texture. Three consumers want these numbers -- the option reader, the
// one-time v3.4.x migration, and the Settings reset -- and three copies of a tuned value is how
// they end up disagreeing.
export const MENU_GRADE_DEFAULTS = { brightness: 0.65, saturation: 0.50, gamma: 0.0 };

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

// A `#rrggbb` string, kept as a string because that is what an <input type="color"> reads and
// writes. Anything else is a stored value from another version or a hand-edited URL, and the
// default is a better answer than a colour parsed out of nonsense.
var queryHex = function (value, def) {
  return (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) ? value : def;
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
    // LOWERCASED ON THE URL SIDE ONLY. readUrlParameters stores every key lowercased, so a
    // camelCase option -- boneSnapAxis, boneSnapFlat, envIntensity, most of this file -- could
    // never be set from a URL at all: the lookup used the camelCase spelling and the table held
    // the lowercase one, so it silently fell through to localStorage or the default. Options
    // whose names happen to be all lowercase have always worked, which is why this survived.
    //
    // localParams keeps its exact spelling: that table is written by saveOption with the key as
    // given, so lowercasing it here would break every stored setting.
    var urlKey = key.toLowerCase();
    if (params[urlKey] !== undefined) return params[urlKey];
    if (localParams[key] !== undefined) return localParams[key];
    return def;
  };

  // misc
  options.language = getVal('language', undefined); // english/chinese/korean/japanese/russian/turkish/swedish/french/german
  options.scalecenter = queryBool(getVal('scalecenter'), false);
  options.nomadHost = getVal('nomadHost', ''); // last Nomad Link address, so a refresh reconnects in one tap
  options.nomadLiveSend = queryBool(getVal('nomadLiveSend'), false);
  options.sculptLocked = queryBool(getVal('sculptLocked'), false); // "do nothing" mode
  // HAND TRACKING, on by default. Off ignores hand input sources entirely -- see the filter in
  // Scene's per-frame input handler. Persisted because the reason to switch it off is a working
  // session at a desk with a keyboard, and having to find the toggle again every time is most of
  // the annoyance it exists to remove.
  options.handTracking = queryBool(getVal('handTracking'), true);
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
  // 5 = Ferndale studio 07, the first equirect HDR environment (ShaderPBR.environments).
  // The default used to be 2, studio_small_01, back when every environment was a LogLUV
  // octahedral atlas.
  options.environment = queryInteger(getVal('environment'), 0, Infinity, 5); // [0-inf]
  // ?noenv=1 — skip scene.environment entirely on the node path. See Scene._syncThreeLights.
  options.noenv = getVal('noenv') === '1';
  // ?nowarm=1 — skip the pre-session pipeline warm. See Scene.enterXR.
  // ?warm=1 — restore the pre-session pipeline warm, which is OFF by default because it
  // compiles the non-XR camera uniform layout. See Scene.enterXR.
  // ?warm=0 goes back to compiling pipelines whenever something is first drawn. On by default:
  // matt, after a session that stuttered five separate times, "i want a long startup when the app
  // launches, compiling shaders etc there, and no stuttering ... after that point".
  options.warm = queryBool(getVal('warm'), true);
  // The rig's instanced batches are warmed on their OWN geometry before the session, because a
  // pipeline is keyed on geometry as well as material and a plain-plane warm compiles the wrong
  // one. Default ON; `?rigwarm=0` is the bisection switch if it ever misbehaves.
  options.rigwarm = queryBool(getVal('rigwarm'), true);

  // How much the environment map contributes in PBR, independent of exposure — 0 kills the IBL
  // so only the scene's own lights remain, which is how you judge a lamp.
  options.envIntensity = queryNumber(getVal('envIntensity'), 0, 2, 1); // [0-2]
  // ?renderer=webgpu switches to WebGPURenderer (WebGL backend) for the TSL migration. URL
  // only, deliberately: this is not a preference to persist into someone's next session while
  // the port is half done.
  // SAY SO WHEN IT IS NOT A VALUE WE KNOW.
  //
  // `?renderer=webgpu?xrlayers=1` -- two question marks -- makes the value the whole string
  // "webgpu?xrlayers=1", which is not 'webgpu', so this quietly hands back the legacy renderer.
  // matt hit exactly that and spotted it only from the old environment list and black
  // controllers: "i don't trust that its using the new code path." A silent fallback to a
  // different renderer is the worst possible answer to a typo.
  const _rq = params.renderer;
  if (_rq !== undefined && _rq !== 'webgpu' && _rq !== 'webgl') {
    console.warn('[options] ?renderer=' + JSON.stringify(_rq) + ' is not a renderer — falling '
      + 'back to legacy WebGL. Separate flags with & rather than ?, e.g. '
      + '?renderer=webgpu&xrlayers=1');
  }
  options.renderer = _rq === 'webgpu' ? 'webgpu' : 'webgl';
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
  // THE WIRE'S COLOUR, and the switch that says whether to use it.
  //
  // The shipped wireframe takes its colour FROM THE SURFACE, darkened — that is what makes it
  // read as an edge on a shaded mesh instead of a jet-black line over a see-through one, and it
  // is what lets the wire show the weight paint underneath it (see Multimesh.updateWireframeBuffer).
  // A flat colour throws that away, so it is a mode rather than a replacement: `wireframeSurface`
  // stays on by default and `wireframeColor` only takes over when it is turned off.
  options.wireframeSurface = queryBool(getVal('wireframeSurface'), true);
  options.wireframeColor = queryHex(getVal('wireframeColor'), '#000000');
  // matt-tuned menu look. The three numbers live in MENU_GRADE_DEFAULTS (below) so the read
  // path, the one-time migration and the Settings "Reset UI to Defaults" action cannot each
  // carry their own idea of what the default is.
  options.menuBrightness = queryNumber(getVal('menuBrightness'), 0.0, 1.0, MENU_GRADE_DEFAULTS.brightness);
  options.menuSaturation = queryNumber(getVal('menuSaturation'), 0.0, 1.0, MENU_GRADE_DEFAULTS.saturation);
  options.menuGamma      = queryNumber(getVal('menuGamma'),      0.0, 1.0, MENU_GRADE_DEFAULTS.gamma);  // (0.5 = neutral γ 1.0)
  options.offsetY = queryNumber(getVal('offsetY'), -2.0, 0.0, -1.2);
  const isMobileVR = typeof navigator !== 'undefined' && /OculusBrowser|Mobile VR|Mobile|Android/i.test(navigator.userAgent);
  options.wireframeType = queryNumber(getVal('wireframeType'), 0, 2, 2); // Force 2 (Full Mode) for spatial topology tests
  options.stylusLength = queryNumber(getVal('stylusLength'), 0.0, 0.30, 0.10);
  options.stylusOffset = queryNumber(getVal('stylusOffset'), -0.15, 0.15, 0.0);
  options.stylusTilt = queryNumber(getVal('stylusTilt'), -45.0, 45.0, 0.0);
  // World-grab gain: how far the world moves per unit of hand movement. 1.0 is 1:1. Lower suits
  // an unbraced hand gesture, which throws the scene at the same speed a controller grab hauls
  // it. Floor of 0.25 rather than 0 so the grab can never become inert and look broken.
  options.grabGain = queryNumber(getVal('grabGain'), 0.25, 2.0, 1.0);
  // Pinch distance: skin-to-skin gap (metres) at which finger and thumb count as closed. 0 is
  // contact; negative requires them pressed together. Measured deliberate pinches reach about
  // -0.017, so the usable range sits well inside this.
  // The range has to reach a Quest 2, whose pinch bottoms out at a gap of ~0.011 and whose
  // relaxed hand sits at 0.045+ — a slider that stopped at 0.015 could not express a working
  // threshold for that device at all. Default 0.022; see Scene.getPinchOn for the measurements.
  // NO DEFAULT HERE, and that is the whole point: a default makes this always-finite, so
  // Scene.getPinchOn's `Number.isFinite(o) ? o : ...` always took THIS value and the per-runtime
  // branch behind it was dead code. undefined means "the user has not chosen", which is what
  // lets the runtime decide -- exactly as `foveation` above does.
  options.pinchOn = queryNumber(getVal('pinchOn'), -0.010, 0.050, undefined);
  // XR compositor foveation, 0 (full resolution everywhere) to 1 (three's default maximum).
  // Left undefined unless asked for, so the per-runtime default in enterXR decides: off where
  // foveation is fixed rather than gaze-driven, three's default everywhere else.
  options.foveation = queryNumber(getVal('foveation'), 0, 1, undefined);
  // XR framebuffer scale -- the direct fill-rate lever, and the one that matters on a headset
  // whose eye buffers are large. Undefined means "leave it at 1.0"; see Scene's note.
  options.fbscale = queryNumber(getVal('fbscale'), 0.3, 2, undefined);
  // Hand-tracking spike: a pinch has no shaft to extend, so the tip sits close to the fingers.
  // Separate from the controller values, which were tuned against a controller.
  options.handStylusLength = queryNumber(getVal('handStylusLength'), 0.0, 0.20, 0.05);
  options.handStylusOffset = queryNumber(getVal('handStylusOffset'), -0.10, 0.10, 0.0);
  // Hand ray pitch, degrees, applied to the anatomical ray (see _handRayFromJoints).
  //
  // +20 measured on Galaxy XR 2026-09-14. The earlier -45 was measured against a DIFFERENT
  // construction — visionOS's targetRaySpace, before the ray was rebuilt from joints — so it is
  // stale rather than a second device's value.
  //
  // Range widened past the old +20 ceiling, which the measured value sat exactly on: a setting
  // whose correct value is its own maximum cannot be tuned in one direction.
  options.handRayPitch = queryNumber(getVal('handraypitch'), -80, 80, 20);
  // Ask for hand-tracking as a REQUIRED feature. A window flag has to be set before the session
  // starts and is lost on reload, which is a sequencing trap in a headset; a URL option cannot
  // be mistimed. ?requireHands=1
  //
  // LOWERCASE KEY ON PURPOSE: readUrlParameters() lowercases every key it parses, so a camelCase
  // lookup can only ever match the localStorage half of getVal and never the URL half. Several
  // options above are written camelCase and quietly work for saved settings only.
  options.requireHands = queryBool(getVal('requirehands'), false);
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
  // Flatten a bone into a world plane when it is already within five degrees of one -- the dual
  // of the axis snap. On by default; see the note beside snapFlat in Skeleton.DISPLAY_FLAGS.
  options.boneSnapFlat = queryBool(getVal('boneSnapFlat'), true);
  options.boneShowLengths = queryBool(getVal('boneShowLengths'), false);
  options.boneShowNames = queryBool(getVal('boneShowNames'), false);
  options.boneShowCapsules = queryBool(getVal('boneShowCapsules'), false);
  options.boneShowSkinClaims = queryBool(getVal('boneShowSkinClaims'), false);
  options.boneHideDecor = queryBool(getVal('boneHideDecor'), false);
  // The kaospad folded away in the blendshape stack panel. Registered here rather than read
  // straight off _rawSaved so it round-trips through queryBool like every other toggle --
  // a saved 'false' string would otherwise read as truthy.
  options.blendPadCollapsed = queryBool(getVal('blendPadCollapsed'), false);
  // Nav throw strength after releasing a world grab (#19). 0 stops the scene dead, 1 is the
  // shipped feel. A number rather than a toggle because 'less, but not none' is the request.
  options.navThrow = queryNumber(getVal('navThrow'), 0, 1, 1);
  {
    // Capsule tessellation — the mobile-VR knob. null = never set, so the shipped 56 stands.
    const raw = getVal('boneCapSegments');
    options.boneCapSegments = (raw == null || raw === '') ? null : parseInt(raw, 10);
  }
  // The desktop outliner's dragged height, in px. null = never dragged, so the stylesheet's own
  // fraction-of-the-panel height stands. See Gui._buildDesktopScene.
  {
    const raw = getVal('outlinerHeight');
    options.outlinerHeight = (raw == null || raw === '') ? null : parseInt(raw, 10);
  }
  // The ground grid's occluded pass has its own opacity; null means "never set", which falls back
  // to the fraction of the main one it used to be derived from. See Scene.getGridOccludedOpacity.
  {
    const raw = getVal('gridOccludedOpacity');
    options.gridOccludedOpacity = (raw == null || raw === '') ? null : parseFloat(raw);
  }
  // Capsules shaded rather than flat. Default true: unlit ones read as a single silhouette and a
  // near limb cannot be told from a far one.
  options.boneCapsuleShaded = queryBool(getVal('boneCapsuleShaded'), true);
  // Panel visibility tracing (Settings). Persisted because switching it on costs a reload to be
  // in place for the next session, and the bug it is hunting is intermittent.
  options.panelTrace = queryBool(getVal('panelTrace'), false);
  // Which desktop sidebar sections are floating, and where. An object rather than a scalar --
  // stored and read as-is, with a type check because a URL parameter of the same name would
  // arrive as a string and must not be mistaken for the map.
  {
    const dp = getVal('desktopPins', null);
    options.desktopPins = (dp && typeof dp === 'object') ? dp : null;
  }
  // How solid the capsules draw. They are a diagnostic at 0.16, but turned up they are a CHEAP
  // STAND-IN FOR THE SKIN: at 1 the rig reads as a solid figure you can animate against with the
  // mesh hidden. matt: "it would be great to have it be fully opaque and animate with the skin
  // turned off."
  options.boneCapsuleOpacity = queryNumber(getVal('boneCapsuleOpacity'), 0.05, 1.0, 0.16);
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
  // The hover outline on ordinary meshes — see Skeleton's DISPLAY_FLAGS. On by default: it is
  // the only preselection a mesh can carry, and its absence is what made Grab read as guesswork.
  options.meshHoverHighlight = queryBool(getVal('meshHoverHighlight'), true);
  // Which half of a VR grab is applied. Both on is the ordinary 6DOF grab; translation off
  // turns a grabbed joint from an IK effector into a plain FK rotation.
  options.grabTranslate = queryBool(getVal('grabTranslate'), true);
  options.grabRotate = queryBool(getVal('grabRotate'), true);

  options.shortcuts = readShortcuts(params.shortcuts); // URL only for now

  // Input
  // Scrub-grain shape, in SECONDS (the settings sliders show milliseconds). Spacing wants to
  // stay under length: overlapping grains are what make a drag sound continuous rather than
  // stuttered, so the ranges deliberately allow both and the panel says which way is which.
  options.audioScrub        = queryBool(getVal('audioScrub'),        true);
  options.audioGrainSec     = queryNumber(getVal('audioGrainSec'),     0.01, 0.5,  0.09);
  options.audioGrainSpacing = queryNumber(getVal('audioGrainSpacing'), 0.01, 0.4,  0.05);
  options.audioGrainFade    = queryNumber(getVal('audioGrainFade'),    0.0,  0.05, 0.004);

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

  // Cast shadow. There is no enable flag: flagging a mesh as a Shadow Catcher is what turns the
  // feature on, so the only settings are the two about how the shadow LOOKS. Both persisted,
  // because these are tuned once against a real room in AR — see render/SceneShadow.js.
  options.shadowOpacity  = queryNumber(getVal('shadowOpacity'),  0.0, 1.0, 0.35);
  options.shadowSoftness = queryNumber(getVal('shadowSoftness'), 0,   24,  2.5);

  // Rig
  // How see-through a BOUND mesh is drawn, so the capsules inside it can be seen and sculpted.
  // 1 is opaque, which is what every rig starts as -- this is a working view, turned on while
  // weighting and turned back off after, and persisted so it survives the reload that a long
  // weighting session tends to involve.
  options.skinOpacity = queryNumber(getVal('skinOpacity'), 0.05, 1.0, 1.0);
  options.cageOpacity = queryNumber(getVal('cageOpacity'), 0.05, 1.0, 1.0);

  // One-time migration to the new menu-colour defaults (v3.4.x). The brightness/saturation
  // sliders were dead from the canvas→HTML migration until v3.4.0, so any *saved* values are
  // stale old-defaults (e.g. saturation 100%). Force 65/55/0 once, then respect user changes.
  try {
    if (typeof localStorage !== 'undefined' && !localStorage.getItem('menuGradeDefaultsV2')) {
      localStorage.setItem('menuGradeDefaultsV2', '1');
      const d = MENU_GRADE_DEFAULTS;
      options.menuBrightness = d.brightness; getOptionsURL.saveOption('menuBrightness', d.brightness, 0);
      options.menuSaturation = d.saturation; getOptionsURL.saveOption('menuSaturation', d.saturation, 0);
      options.menuGamma      = d.gamma;      getOptionsURL.saveOption('menuGamma',      d.gamma,      0);
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
