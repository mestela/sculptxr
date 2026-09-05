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
globalThis.screenLog = (msg, colour) => { globalThis.__log.push({ msg, colour }); };
`;

const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '_paneltrace_gen.mjs');
fs.writeFileSync(outPath, prelude + '\n' + body + '\nexport default PanelTrace;\n');
const PanelTrace = (await import(outPath + '?v=' + Date.now())).default;

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

// An Object3D as far as this code is concerned.
function obj(name, type, parent) {
  return { name, type: type || 'Object3D', visible: true, parent: parent || null,
           scale: { x: 1, y: 1, z: 1 } };
}
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

console.log('\n── off by default ──────────────────────────────────────────────────────');
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

console.log('\n── who wrote it ────────────────────────────────────────────────────────');
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

console.log('\n── why it is not on screen ─────────────────────────────────────────────');
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

console.log('\n── a panel can vanish without anything touching visible ────────────────');
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

console.log('\n── the report carries the context ──────────────────────────────────────');
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

console.log('\n── all three panels, and only when they exist ──────────────────────────');
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

console.log('\n── it is reachable from inside the headset ─────────────────────────────');
{
  const MM = fs.readFileSync(path.join(REPO, 'src/gui/htmlvr/MainMenuPanel.js'), 'utf8');
  const OPT = fs.readFileSync(path.join(REPO, 'src/misc/getOptionsURL.js'), 'utf8');
  const SC = fs.readFileSync(path.join(REPO, 'src/Scene.js'), 'utf8');
  check('Settings offers it', /chk\('Trace panel visibility', PanelTrace\.enabled\(\)\)/.test(MM),
    'a console flag is no use on a GXR — the same reason the solver is a settings item');
  check('...wired to the module, which persists it',
    /PanelTrace\.setEnabled\(e\.target\.checked\)/.test(MM)
      && /options\.panelTrace = queryBool\(getVal\('panelTrace'\), false\);/.test(OPT));
  check('...and the frame loop drives it', /PanelTrace\.tick\(this\);/.test(SC));
  check('the label has no parentheses, which would make an unqueryable id',
    !/chk\('[^']*\([^']*'/.test(MM),
    'chk derives the id from the label and querySelector throws on a "(" in an id');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
