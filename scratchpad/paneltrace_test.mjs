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
  check('...naming which grips are missing', logged().some((m) => /grips L=NULL/.test(m)));
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
  check('the label has no parentheses, which would make an unqueryable id',
    !/chk\('[^']*\([^']*'/.test(MM),
    'chk derives the id from the label and querySelector throws on a "(" in an id');
}

_realLog(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
