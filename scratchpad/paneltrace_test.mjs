// Node harness for src/misc/PanelTrace.js — the instrument for the wrist-panel disappearances.
//
// An instrument has to be trustworthy before it is worth reading, and this one cannot be
// exercised in the browser here: the panels build their meshes inside requestAnimationFrame,
// which is frozen whenever the preview pane is hidden. So it is driven directly, with fake
// meshes shaped like three's Object3D — which is all this code actually touches (visible,
// parent, scale, name, type).
//
// The behaviours that matter: it reports WHO wrote, it reports WHY a panel is not on screen
// (which is not the same question), it only speaks on a CHANGE, and it says nothing at all when
// it is off — a tracer that chatters is one you switch off and then cannot use.
//
// Run: node scratchpad/paneltrace_test.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO = '/Users/mattestela/sculptxr';
const SRC = fs.readFileSync(path.join(REPO, 'src/misc/PanelTrace.js'), 'utf8');

const body = SRC.split('\n')
  .filter((l) => !/^import\s/.test(l))
  .filter((l) => !/^export default/.test(l))
  .join('\n');

const prelude = `
const getOptionsURL = () => ({ panelTrace: false });
getOptionsURL.saveOption = () => {};
globalThis.window = globalThis;
globalThis.__log = [];
// A trap, not a sink: the reports must NOT go here. See the console capture below.
globalThis.screenLog = () => { throw new Error('screenLog must not be used for diagnostics'); };
`;

// THE REPORTS GO TO THE CONSOLE, so the console is what this captures. matt reads them over
// remote debugging: "don't use screenlog within the headset, its impossible to copy and paste
// into this chat." console is global, so overriding it here also captures the module's writes.
const _realLog = console.log;
console.log = (...a) => { globalThis.__log.push({ msg: a.join(' ') }); };

const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '_paneltrace_gen.mjs');
fs.writeFileSync(outPath, prelude + '\n' + body + '\nexport default PanelTrace;\n');
const PanelTrace = (await import(outPath + '?v=' + Date.now())).default;

let failures = 0;
const check = (n, ok, d) => { if (ok) return _realLog('  ok   ' + n);
  failures++; _realLog('  FAIL ' + n + (d ? '  ' + d : '')); };

// An Object3D as far as this code is concerned.
function obj(name, type, parent) {
  return { name, type: type || 'Object3D', visible: true, parent: parent || null,
           scale: { x: 1, y: 1, z: 1 }, matrixWorld: mat4At(0, 0, 0) };
}
// A column-major 4x4 with a translation, which is all `place()` reads of a panel; the camera
// adds a forward axis (its third column, negated) so "behind the head" can be asked.
function mat4At(x, y, z, fwd) {
  const f = fwd || [0, 0, -1];
  return { elements: [1, 0, 0, 0,  0, 1, 0, 0,  -f[0], -f[1], -f[2], 0,  x, y, z, 1] };
}
const camAt = (x, y, z, fwd) => ({ matrixWorld: mat4At(x, y, z, fwd) });
function sceneWith(mesh) {
  const root = obj('', 'Scene');
  const grip = obj('grip', 'Group', root);
  mesh.parent = grip;
  return { root, grip };
}
const app = (mini, picker, main) => ({
  _miniPanel: mini ? { mesh: mini } : null,
  _toolPickerPanel: picker ? { mesh: picker } : null,
  _mainMenuPanel: main ? { mesh: main } : null,
  _sculptManager: { getCurrentTool: () => ({ constructor: { name: 'BoneDrawTool' }, _mode: 2 }) },
});
const logged = () => globalThis.__log.map((e) => e.msg);
const clear = () => { globalThis.__log.length = 0; };

_realLog('\n── off by default ──────────────────────────────────────────────────────');
{
  globalThis.window._panelTrace = undefined;
  check('tracing is off unless asked for', PanelTrace.enabled() === false,
    'a tracer that is on by default is one that gets switched off before it is needed');
  const mesh = obj('mini'); sceneWith(mesh);
  const scene = app(mesh);
  PanelTrace.tick(scene);
  clear();
  mesh.visible = false;
  PanelTrace.tick(scene);
  check('...and says nothing while it is off', logged().length === 0);
  // ...but it still WRAPS, so switching it on mid-session catches the next write without a
  // reload. The wrap is what cannot be added retroactively to a write that already happened.
  check('...while still wrapping, so it works the moment it is switched on', !!mesh._ptWrapped);
}

_realLog('\n── who wrote it ────────────────────────────────────────────────────────');
{
  globalThis.window._panelTrace = true;
  const mesh = obj('mini'); sceneWith(mesh);
  const scene = app(mesh);
  PanelTrace.tick(scene);
  clear();
  function theCulpritFunction() { mesh.visible = false; }
  theCulpritFunction();
  const l = logged();
  check('a write is reported', l.some((m) => /MiniPanel\.visible true -> false/.test(m)));
  check('...and names the line that did it',
    l.some((m) => /theCulpritFunction/.test(m)),
    'the whole point is not having to infer the writer afterwards');
  clear();
  mesh.visible = false;
  check('...but an idempotent write is not a change and is not reported', logged().length === 0,
    'per-frame code assigns the same value constantly');
  check('the value still reads back', mesh.visible === false);
}

_realLog('\n── why it is not on screen ─────────────────────────────────────────────');
{
  globalThis.window._panelTrace = true;
  const mesh = obj('mini'); const { grip } = sceneWith(mesh);
  const scene = app(mesh);
  PanelTrace.tick(scene); clear();

  mesh.visible = false; PanelTrace.tick(scene);
  check('hidden outright', logged().some((m) => /MiniPanel: visible=false/.test(m)));
  mesh.visible = true; clear(); PanelTrace.tick(scene);
  check('...and back', logged().some((m) => /MiniPanel: shown/.test(m)));

  // THE CASE THE LAST FIX WAS ABOUT: `visible` reads true the whole time and the panel is not
  // on screen, because it is no longer under the grip. Indistinguishable from the outside.
  clear(); mesh.parent = null; PanelTrace.tick(scene);
  check('detached from the graph is reported as ITSELF, not as hidden',
    logged().some((m) => /detached from the scene graph/.test(m)),
    'the v3.30.15 restore ran inside if (uiGrip) and this is what that looked like');

  clear(); mesh.parent = grip; grip.visible = false; PanelTrace.tick(scene);
  check('an invisible ancestor names the ancestor',
    logged().some((m) => /ancestor "grip" is invisible/.test(m)));

  clear(); grip.visible = true; mesh.scale.x = 0; PanelTrace.tick(scene);
  check('a zero scale is caught too', logged().some((m) => /scale is zero/.test(m)),
    'hidden slots are scaled to zero elsewhere in this codebase, so it is a real state');

  clear(); PanelTrace.tick(scene); PanelTrace.tick(scene);
  check('...and a steady state is silent', logged().length === 0,
    'once a frame times three panels is a fire hose if it reports the state rather than changes');
}

_realLog('\n── a panel can vanish without anything touching visible ────────────────');
{
  globalThis.window._panelTrace = true;
  const mesh = obj('mini'); sceneWith(mesh);
  mesh.geometry = { parameters: { width: 0.24, height: 0.18 } };
  const scene = app(mesh);
  PanelTrace.tick(scene); clear();
  // The MiniPanel re-measures its plane every time the extras block is rebuilt, which under
  // Tweak Joints is every joint selection. Measured mid-relayout it comes back a sliver.
  mesh.geometry.parameters.height = 0.004;
  PanelTrace.tick(scene);
  check('a collapsed plane is reported as a resize, not as a hide',
    logged().some((m) => /resized 0\.240x0\.180 -> 0\.240x0\.004/.test(m)),
    'nothing touched visible, and from the outside the panel is simply gone');
  check('...and flagged as degenerate', logged().some((m) => /DEGENERATE/.test(m)));
  // A fresh panel for the negative case: the baseline is now the COLLAPSED size, so going back
  // to 0.18 from 0.004 is correctly another big change and would be reported.
  const steady = obj('mini2'); sceneWith(steady);
  steady.geometry = { parameters: { width: 0.24, height: 0.18 } };
  const scene2 = app(steady);
  PanelTrace.tick(scene2); clear();
  steady.geometry.parameters.height = 0.1801;
  PanelTrace.tick(scene2);
  check('...while a layout-sized wobble is not reported', logged().length === 0,
    'a tracer that reports float noise is one you stop reading');
}

_realLog('\n── where it is, not just whether it is drawn ──────────────────────────');
{
  globalThis.window._panelTrace = true;
  const mesh = obj('mini'); sceneWith(mesh);
  const scene = app(mesh);
  scene._camera = { getThreeCamera: () => camAt(0, 0, 0) };
  mesh.matrixWorld = mat4At(0, 0, -0.4);        // in front of the head, arm's length
  PanelTrace.tick(scene); clear();

  // A panel parked where the hand WAS during a dropout: still visible, still attached, gone.
  mesh.matrixWorld = mat4At(3, 0, -0.4);
  PanelTrace.tick(scene);
  check('a jump is reported with the distance from the head',
    logged().some((m) => /JUMPED/.test(m) && /m from the head/.test(m)),
    'nothing about visibility changes when a panel is simply somewhere else');
  check('...and far away is called out', logged().some((m) => /FAR/.test(m)));

  clear();
  mesh.matrixWorld = mat4At(0, 0, 0.4);          // same distance, other side of the head
  PanelTrace.tick(scene);
  check('behind the head is reported as such', logged().some((m) => /BEHIND it/.test(m)));

  clear();
  mesh.matrixWorld = mat4At(0.02, 0, 0.4);       // a hand-sized move, not a jump
  PanelTrace.tick(scene);
  check('...while an ordinary hand movement is not reported', logged().length === 0,
    'the hand moves every frame; only a jump is news');
}

_realLog('\n── the anchor has to actually be driven ───────────────────────────────');
{
  globalThis.window._panelTrace = true;
  const mesh = obj('mini'); sceneWith(mesh);
  const scene = app(mesh);
  scene._wristAnchor = { matrix: mat4At(0.1, 1.2, -0.3) };
  scene._vrControllerLeftGrip = null;            // the grip went away; the anchor holds its pose
  for (let i = 0; i < 61; i++) PanelTrace.tick(scene);
  check('a frozen wrist anchor is reported',
    logged().some((m) => /wrist anchor has not moved for 60 frames/.test(m)),
    'a grip that stops feeding leaves the panels where the hand last was, and nothing else changes');
  check('...naming whether each grip has a POSE, not merely an object',
    logged().some((m) => /grips L=NULL/.test(m) && /headHold=/.test(m)),
    'both grips were present through every freeze the trace caught; the pose was not');
  clear();
  for (let i = 0; i < 30; i++) PanelTrace.tick(scene);
  check('...and it is said once, not every frame after', logged().length === 0);
  clear();
  scene._wristAnchor.matrix = mat4At(0.11, 1.2, -0.3);
  PanelTrace.tick(scene);
  check('...and the recovery is reported too', logged().some((m) => /moved again after/.test(m)));
}

_realLog('\n── the report carries the context ──────────────────────────────────────');
{
  globalThis.window._panelTrace = true;
  const mesh = obj('mini'); sceneWith(mesh);
  const scene = app(mesh);
  PanelTrace.tick(scene); clear();
  mesh.visible = false; clear(); PanelTrace.tick(scene);
  check('the tool is named alongside the state',
    logged().some((m) => /\[tool BoneDrawTool\/2\]/.test(m)),
    "matt's case is Tweak Joints, and the mode is half of that answer");
}

_realLog('\n── all three panels, and only when they exist ──────────────────────────');
{
  globalThis.window._panelTrace = true;
  const mini = obj('mini'), main = obj('main');
  sceneWith(mini); sceneWith(main);
  const scene = app(mini, null, main);          // the picker is not built yet
  let threw = null;
  try { PanelTrace.tick(scene); } catch (e) { threw = e.message; }
  check('a panel that does not exist yet is skipped, not thrown on', threw === null,
    'the panels are built lazily, so every pass sees a different subset');
  check('...and the ones that do exist are wrapped', !!mini._ptWrapped && !!main._ptWrapped);
}

_realLog('\n── blank, or off to the side ──────────────────────────────────────────');
{
  globalThis.window._panelTrace = true;
  const mesh = obj('mini'); sceneWith(mesh);
  mesh.matrixWorld = mat4At(0, 0, -0.4);
  mesh.material = { map: {} };
  const scene = app(mesh);
  scene._camera = { getThreeCamera: () => camAt(0, 0, 0) };
  PanelTrace.tick(scene); clear();

  // The texture is disposed and rebuilt whenever the content's size changes; a paint that does
  // not arrive leaves the material with no map at all, and the quad draws blank.
  mesh.material.map = null;
  PanelTrace.tick(scene);
  check('a panel with no texture is reported as drawing blank',
    logged().some((m) => /NO TEXTURE/.test(m)),
    'nothing else here notices: it is visible, attached, sized and placed');

  clear(); mesh.material.map = {}; PanelTrace.tick(scene);
  check('...and the recovery too', logged().some((m) => /textured and in view/.test(m)));

  // 90 degrees to the side: gone, without a single flag changing.
  clear(); mesh.matrixWorld = mat4At(0.4, 0, 0); PanelTrace.tick(scene);
  check('a panel outside the view is reported', logged().some((m) => /outside the view/.test(m)));
  clear(); PanelTrace.tick(scene);
  check('...once, not every frame', logged().length === 0);
}

_realLog('\n── is something standing in front of it ───────────────────────────────');
{
  globalThis.window._panelTrace = true;
  const mesh = obj('mini'); sceneWith(mesh);
  mesh.matrixWorld = mat4At(0, 0, -0.4);
  const scene = app(mesh);
  scene._camera = { getThreeCamera: () => camAt(0, 0, 0) };
  // A raycaster shaped like three's, answering with whatever the test puts in front.
  let inFront = [];
  scene._miniPanel._raycaster = {
    set() {}, near: 0, far: 0,
    intersectObjects: () => inFront,
  };
  scene._scene = { children: [] };
  // The raycast half is opt-in: it walks the whole scene recursively, which this codebase has
  // paid for before, and in matt's headset it also threw on every sprite it met.
  globalThis.window._panelTraceProbe = true;
  const tick10 = () => { for (let i = 0; i < 10; i++) PanelTrace.tick(scene); };

  clear(); tick10();
  check('nothing in front of it is silent', !logged().some((m) => /OCCLUDED/.test(m)));

  // The rig overlay began WRITING DEPTH in v3.30.8, and it draws before the panels.
  inFront = [{ object: { name: 'bone_capsules', visible: true, material: { transparent: true, opacity: 0.9 } }, distance: 0.2 }];
  clear(); tick10();
  check('an occluder is named, with both distances',
    logged().some((m) => /OCCLUDED by "bone_capsules" at 0\.20m, panel at 0\.40m/.test(m)),
    'a panel can be visible, attached, sized and placed correctly and still be behind something');

  clear(); tick10();
  check('...and said once, not every probe', logged().length === 0);

  inFront = [];
  clear(); tick10();
  check('...and the clearing is reported', logged().some((m) => /nothing in front of it any more/.test(m)));

  // A ghost pass at 9% opacity is in front of everything and occludes nothing you can see.
  inFront = [{ object: { name: 'ghost', visible: true, material: { transparent: true, opacity: 0.09 } }, distance: 0.2 }];
  clear(); tick10();
  check('a nearly-invisible surface is not called an occluder', logged().length === 0,
    'the rig ghost passes sit in front of everything by design');

  // Off unless asked for, and it hands the raycaster a camera: a scene full of sprites (the
  // joint labels) throws "Raycaster.camera needs to be set" on every one, every probe.
  inFront = [{ object: { name: 'wall', visible: true, material: {} }, distance: 0.2 }];
  globalThis.window._panelTraceProbe = false;
  clear(); tick10();
  check('the probe is silent unless switched on', !logged().some((m) => /OCCLUDED/.test(m)),
    'it walks the whole scene recursively; everything else here is arithmetic');
  let sawCamera = false;
  scene._ptRaycaster = { set() {}, near: 0, far: 0,
    get camera() { return this._c; }, set camera(c) { this._c = c; sawCamera = !!c; },
    intersectObjects: () => inFront };
  globalThis.window._panelTraceProbe = true;
  clear(); tick10();
  check('...and gives the raycaster a camera when it does run', sawCamera,
    'without it three throws on every sprite in the scene, every probe');
  globalThis.window._panelTraceProbe = false;
}

_realLog('\n── the paint itself ───────────────────────────────────────────────────');
{
  globalThis.window._panelTrace = true;
  const mesh = obj('mini'); sceneWith(mesh);
  mesh.material = { map: null };
  mesh.geometry = { parameters: { width: 0.133, height: 0.113 } };
  const panel = { mesh, _element: { offsetWidth: 240, offsetHeight: 204 },
    _needsResize: true, _hostMounted: true,
    _onPaint() { this.mesh.material.map = { image: { width: 419, height: 800 } };
                 this.mesh.geometry.parameters.height = 0.254; } };
  const scene = app(null); scene._miniPanel = panel;
  scene._camera = { getThreeCamera: () => camAt(0, 0, 0) };
  mesh.matrixWorld = mat4At(0, 0, -0.4);
  PanelTrace.tick(scene);          // wraps _onPaint
  clear();
  panel._onPaint();
  const l = logged();
  // The rate limit is 200ms, which is the quarter-second matt measured, so whatever goes wrong
  // is set during a rebuild and not corrected until the next allowed paint. The paint is the one
  // part of the pipeline nothing here watched.
  check('a paint reports what the element measured and what the texture became',
    l.some((m) => /MiniPanel paint: el 240x204/.test(m) && /-> map 419x800/.test(m)),
    'a capture from a stale or unlaid-out element is invisible to every other check');
  check('...and flags the resize, which is what disposes the texture',
    l.some((m) => /RESIZE/.test(m)));
  check('...and the plane it ended up with',
    l.some((m) => /plane 0\.133x0\.254/.test(m)));

  clear();
  panel._hostMounted = false;
  panel._onPaint();
  check('...and an unmounted panel says so', logged().some((m) => /UNMOUNTED/.test(m)),
    'an unmounted panel captures nothing at all');
  globalThis.window._panelTrace = false;
  clear(); panel._onPaint();
  check('...and none of it runs when tracing is off', logged().length === 0);
}

_realLog('\n── switching it on says what it is starting from ───────────────────────');
{
  globalThis.window._panelTrace = false;
  const mesh = obj('mini'); const { grip } = sceneWith(mesh);
  mesh.geometry = { parameters: { width: 0.24, height: 0.18 } };
  mesh.matrixWorld = mat4At(0.1, 1.2, -0.3);
  const scene = app(mesh);
  scene._camera = { getThreeCamera: () => camAt(0, 0, 0) };
  grip.name = 'wrist_panel_anchor';
  globalThis.window.app = scene;
  clear();
  PanelTrace.setEnabled(true);
  const l = logged();
  // Everything else reports CHANGES, so a log with no PanelTrace lines is ambiguous -- nothing
  // happened, or it was never running. The snapshot settles that.
  check('switching it on announces itself', l.some((m) => /panel tracing ON/.test(m)));
  check('...and dumps every panel, so the log has a starting point',
    l.some((m) => /MiniPanel: shown/.test(m) && /m from the head/.test(m)
                  && /0\.240x0\.180/.test(m) && /parent=wrist_panel_anchor/.test(m)),
    'a report of a change is unreadable without the state it changed from');
  check('...naming a panel that does not exist yet as such',
    l.some((m) => /ToolPicker: not built yet/.test(m)));
  globalThis.window.app = undefined;
}

_realLog('\n── the flight recorder ────────────────────────────────────────────────');
{
  globalThis.window._panelTrace = true;
  const mesh = obj('mini'); sceneWith(mesh);
  mesh.geometry = { parameters: { width: 0.24, height: 0.18 } };
  mesh.material = { map: { image: { width: 512, height: 384 } }, opacity: 1, transparent: true };
  mesh.matrixWorld = mat4At(0.1, 1.2, -0.3);
  mesh.renderOrder = 11000;
  const scene = app(mesh);
  scene._camera = { getThreeCamera: () => camAt(0, 0, 0) };
  for (let i = 0; i < 5; i++) PanelTrace.tick(scene);
  // The frame it goes wrong: opacity to zero, which every other check in this file would call
  // a perfectly healthy panel.
  mesh.material.opacity = 0;
  PanelTrace.tick(scene);
  for (let i = 0; i < 3; i++) PanelTrace.tick(scene);

  clear();
  PanelTrace.dump(scene);
  const l = logged();
  check('the dump prints a history, with its own length and rate',
    l.some((m) => /panel history: \d+ frames over [\d.]+s \(\d+ fps\)/.test(m)));
  // The user's only clock is "it went a moment before I pressed the button", so the tape is
  // timed backwards from the press. The first tape ran out before the press: 240 frames at the
  // 55fps it measured is 4.3s, and noticing, turning to the pinned menu and aiming takes that.
  check('...and every row is timed from the press, not from the epoch',
    l.some((m) => /t-[\d.]+s MiniPanel/.test(m)),
    'a raw performance.now() cannot be lined up with "about three seconds ago"');
  check('...opening with the full state, since a diff needs a baseline',
    l.some((m) => /"op":1/.test(m) && /"ord":11000/.test(m) && /"tw":512/.test(m)));
  check('...then ONLY what changed, naming the field and both values',
    l.some((m) => /\{"op":"1->0"\}/.test(m)),
    'a full dump of 240 frames x 3 panels is unreadable; the changed rows are the whole point');
  check('...and identical frames are not printed at all',
    (l.filter((m) => /MiniPanel \{/.test(m)).length) === 2,
    'one baseline plus one change, out of nine recorded frames');
  // Material state is the half that nothing else here watches, and any of it can make a panel
  // that passes every other test invisible.
  check('the record carries the material, not just the transform',
    l.some((m) => /"cw":true/.test(m) && /"dt":/.test(m) && /"map":true/.test(m)),
    'opacity 0, colorWrite off or an empty texture all draw nothing and change nothing else');
}

_realLog('\n── is there anything ON the texture ───────────────────────────────────');
{
  globalThis.window._panelTrace = true;
  const mesh = obj('mini'); sceneWith(mesh);
  mesh.matrixWorld = mat4At(0, 0, -0.4);
  mesh.material = { map: { image: { width: 8, height: 8 } }, opacity: 1 };
  const scene = app(mesh);
  scene._camera = { getThreeCamera: () => camAt(0, 0, 0) };
  // An offscreen canvas that answers with whatever alpha the test wants. The real one draws the
  // panel's bitmap into 8x8 and averages; here the averaging is what is under test.
  let alpha = 255;
  globalThis.OffscreenCanvas = function () {
    return { getContext: () => ({
      clearRect() {}, drawImage() {},
      getImageData: () => ({ data: new Array(8 * 8 * 4).fill(0).map((_, i) => (i % 4 === 3 ? alpha : 200)) }),
    }) };
  };
  // The ink sampler is off unless asked for: it contradicted itself on the device and the number
  // cannot be used. Kept behind a switch, and still tested, so it works if a better idea arrives.
  globalThis.window._panelTraceInk = true;
  const tick10 = () => { for (let i = 0; i < 10; i++) PanelTrace.tick(scene); };
  // THE FIRST SAMPLE IS NOT A TRANSITION: a healthy panel reported as "texture has content
  // again" reads as a recovery from a blank that never happened, and matt's log opened with
  // exactly that line.
  clear(); tick10();
  // Two callers sampled through two different canvases and disagreed -- the per-frame sampler
  // reporting an empty texture while the paint either side of it, through the other canvas,
  // reported full. An instrument that contradicts itself has to be fixed before it is used.
  check('every ink sample goes through the same canvas',
    /const _inkScope = \{\};\s*\nfunction inkOf\(mesh\) \{\s*\n\s*const scene = _inkScope;/.test(SRC)
      && !/inkOf\(p\.mesh, scene\)/.test(SRC),
    'two contexts measuring one texture is two answers');
  check('a healthy first sample says nothing',
    !logged().some((m) => /texture has content/.test(m)),
    'there is nothing to have recovered from on the first look');
  clear();

  // The panel is a quad whose whole appearance is its map, and the background is transparent --
  // so a paint that lands empty draws nothing while every other field stays perfect. That is the
  // one thing the 30-second tape could not rule out.
  alpha = 0; tick10();
  check('an empty texture is reported, with the alpha it measured',
    logged().some((m) => /TEXTURE IS EMPTY \(mean alpha 0\)/.test(m)),
    'every other property of the panel is correct while this is happening');
  clear(); tick10();
  check('...once, not every sample', logged().length === 0);
  alpha = 255; clear(); tick10();
  check('...and the recovery, with alpha and luma',
    logged().some((m) => /texture has content again \(mean alpha 255, luma 200\)/.test(m)));
  clear(); globalThis.window._panelTraceInk = false; tick10();
  check('...and none of it runs unless the switch is on', logged().length === 0,
    'a measurement that contradicts itself must not be on by default');
  globalThis.window._panelTraceInk = true;
  delete globalThis.OffscreenCanvas;
  globalThis.window._panelTraceInk = false;
}

_realLog('\n── it is reachable from inside the headset ─────────────────────────────');
{
  const MM = fs.readFileSync(path.join(REPO, 'src/gui/htmlvr/MainMenuPanel.js'), 'utf8');
  const OPT = fs.readFileSync(path.join(REPO, 'src/misc/getOptionsURL.js'), 'utf8');
  const SC = fs.readFileSync(path.join(REPO, 'src/Scene.js'), 'utf8');
  check('the reports go to the console, never to screenLog',
    !/screenLog/.test(SRC.replace(/^\s*\/\/.*$/gm, '')),
    'text painted inside a headset cannot be copied out of it');
  // In the SHARED list, so it appears in the VR settings panel and the desktop one from a single
  // declaration. It went into the desktop builder alone first, and was simply absent in VR --
  // which is where the switch actually has to be, since that is where the bug happens.
  check('Settings offers it',
    /id: 'mm-panel-trace',[\s\S]{0,120}?PanelTrace\.enabled\(\)/.test(MM),
    'a console flag is no use on a GXR — the same reason the solver is a settings item');
  check('...from the list BOTH panels render, not one of them',
    (MM.match(/buildDevToggles\(/g) || []).length >= 3,
    'the declaration plus one render call per panel');
  check('...wired to the module, which persists it',
    /PanelTrace\.setEnabled\(on\)/.test(MM)
      && /options\.panelTrace = queryBool\(getVal\('panelTrace'\), false\);/.test(OPT));
  check('...and the frame loop drives it', /PanelTrace\.tick\(this\);/.test(SC));
  // A tape whose clock can read NEGATIVE is one nobody trusts mid-hunt: rounding the row time
  // while comparing it against an unrounded now put rows up to half a millisecond in the future
  // ("over -0.0s", "t--0.00s"), and made this harness fail one run in three.
  check('the tape clock cannot run backwards',
    /const row = \{ t: performance\.now\(\) \};/.test(SRC)
      && /Math\.max\(0, now - ring\[0\]\.t\)/.test(SRC)
      && /'t-' \+ \(Math\.max\(0, now - t\)/.test(SRC),
    'an instrument nobody can trust the clock of is not one to hand somebody mid-hunt');
  check('...and the history can be dumped from either settings panel',
    /id: 'mm-panel-dump',[\s\S]{0,120}?PanelTrace\.dump\(\)/.test(MM)
      && /renderAction\(t\.id, t\.label\)/.test(MM),
    'the panel that vanishes is not the one you can press a button on; the pinned menu is');
  check('...and the button is actually wired to run it',
    /if \(t\.action\) \{\s*\n\s*el\.addEventListener\('click', \(\) => \{ t\.run\(\); \}\);/.test(MM),
    'a dump button that does nothing is worse than no button');
  check('the label has no parentheses, which would make an unqueryable id',
    !/chk\('[^']*\([^']*'/.test(MM),
    'chk derives the id from the label and querySelector throws on a "(" in an id');
}

_realLog(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
