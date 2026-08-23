// What the graph editor graphs.
//
// It read _main.getMesh() — the 3D-VIEW selection — in eight places, so the only way to graph
// a track was to go and select its object in the scene, even after clicking its row in the
// dopesheet. The timeline now owns its own target.
//
// Run: node scratchpad/graph_target_test.mjs   (from the repo root)
import fs from 'fs';

const REPO = '/Users/mattestela/sculptxr';
const SRC = fs.readFileSync(REPO + '/src/gui/GuiTimeline.js', 'utf8');
const code = SRC.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

check('there is a resolver', /_graphMesh\(\) \{/.test(code));
check('and a setter', /_setGraphTarget\(meshId\) \{/.test(code));

// EXACTLY ONE getMesh() may survive: the fallback inside the resolver. Any other is a graph
// path still reading the scene selection, which is the bug — and it would be invisible, since
// the two agree whenever you happen to have the right object selected.
const direct = (code.match(/this\._main\.getMesh\(\)/g) || []).length;
check('only the resolver still reads the scene selection', direct === 1,
  `${direct} direct reads; every graph path must go through _graphMesh()`);
// A MINIMUM, not an exact count. Pinned at exactly 8 this broke the moment a legitimate new
// caller was added (the graph's own name label) — a test asserting a tally rather than the
// property it cares about. The property is the check above: nothing reads the scene selection
// directly except the resolver's fallback.
const routed = (code.match(/this\._graphMesh\(\)/g) || []).length;
check('every graph path goes through the resolver', routed >= 8, `${routed} callers`);

// The fallback IS the old behaviour, so nothing changes until something is clicked.
{
  const i = code.indexOf('_graphMesh() {');
  const FN = code.slice(i, code.indexOf('\n  }', i));
  check('an unset target falls back to the scene selection',
    /return this\._main\.getMesh\(\);/.test(FN));
  check('a deleted object falls back too, rather than graphing nothing',
    /_graphMeshId = null;/.test(FN),
    'a stale id would resolve to nothing and the graph would go blank');
}

// Synthetic rows (the folded rig lane) carry a negative pseudo-id with no track behind it.
{
  const i = code.indexOf('_setGraphTarget(meshId) {');
  const FN = code.slice(i, code.indexOf('\n  }', i));
  check('synthetic rows are refused', /meshId == null \|\| meshId < 0/.test(FN),
    'the folded rig row has no track: targeting it would blank the graph');
}

// The two ways in.
check('clicking a row name sets the target', /rx < 176 && ry >= ty2[\s\S]{0,200}?_setGraphTarget\(meshId\)/.test(code),
  'the name strip is the obvious thing to click and did nothing');
check('clicking a key sets it too',
  (code.match(/_activeMeshId = meshId;\s*\n\s*this\._setGraphTarget\(meshId\)/g) || []).length === 4,
  'all four key-hit paths (transform, shape, blendshape, layer) must agree');

// A MARQUEE IS A SELECTION TOO. Clicking a row or a single key pointed the graph at it;
// sweeping a rectangle over the same keys did not, and the graph stayed on whatever the 3D
// view had selected — the very thing the per-click version exists to stop.
check('a marquee points the graph at what it caught',
  /if \(newKeys\.length\) this\._setGraphTarget\(newKeys\[0\]\.meshId\);/.test(code),
  'sweeping a selection left the graph on the scene selection');
check('...and an empty sweep leaves the graph alone',
  /if \(newKeys\.length\)/.test(code),
  'blanking the graph on an empty marquee would be worse than doing nothing');

// Timeline focus and the scene selection are deliberately ONE THING, so this DOES go through
// the app's selection. The hazard the old check was guarding is real and survives the change:
// setOrUnsetMesh runs TOOL CONTEXT SWITCHING and ends in a render. So the property to assert is
// not "never selects" — it is "selects without switching your tool". Looking at a curve must not
// change the active tool.
{
  const i = code.indexOf('_setGraphTarget(meshId) {');
  const FN = code.slice(i, code.indexOf('\n  }', i));
  const call = FN.match(/setMesh\?\.\(([^)]*)\)/);
  check('picking a curve selects, but with keepTool set',
    !!call && /,\s*true\s*$/.test(call[1]),
    call ? `setMesh(${call[1]}) — no keepTool argument, so this switches tools`
         : 'the graph target no longer selects at all');

  // ...and the flag has to actually reach the guard. A call site passing an argument the
  // selection path ignores would pass the check above while switching tools exactly as before.
  const SCENE = fs.readFileSync(REPO + '/src/Scene.js', 'utf8');
  check('...and keepTool gates the tool-context switch in Scene',
    /setMesh\(mesh, keepTool\)[\s\S]{0,120}setOrUnsetMesh\(mesh, false, keepTool\)/.test(SCENE)
      && /setOrUnsetMesh\(mesh, multiSelect, keepTool\)/.test(SCENE)
      && /selected\.length > 0 && !keepTool/.test(SCENE),
    'keepTool is passed but never reaches the tool-switch guard');
}

// THE TARGET HAS TO BE VISIBLE. It can now be set from four places (row name, key, marquee,
// and the 3D selection as a fallback), so "which object am I looking at" is a real question in
// both halves of the editor — and neither half answered it.
{
  const TH = fs.readFileSync(REPO + '/src/gui/TimelineHelper.js', 'utf8');

  // Dopesheet: the target row's name, in the same yellow a selected key is drawn in, so the
  // row and its keys read as one selection.
  check('the dopesheet marks the target row',
    /uiState && uiState\._graphMeshId === id/.test(TH),
    'nothing in the dopesheet says which row the graph will show');
  check('...in the selected-key yellow', /isGraphTarget \? '#ffff00'/.test(TH));
  check('...without losing the muted colour', /track\.muted \? '#6c7086' : '#cdd6f4'/.test(TH),
    'a muted row must still read as muted when it is not the target');

  // Graph: the subject's name, drawn in the curve area.
  const i = code.indexOf('drawGraph(ctx) {');
  const FN = i === -1 ? '' : code.slice(i, code.indexOf('\n  }\n', i));
  check('the graph editor names what it is showing', /_gname/.test(FN) && /fillText\(_gname/.test(FN),
    'a graph full of curves with nothing saying whose they are');
  check('...and says so when there is nothing to show',
    /'nothing selected'/.test(FN),
    'an empty graph and a graph of an empty track look identical otherwise');
  check('the label matches the row colour', /_gm \? '#ffff00'/.test(FN));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
