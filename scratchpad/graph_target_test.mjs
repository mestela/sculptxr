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
const routed = (code.match(/this\._graphMesh\(\)/g) || []).length;
check('every graph path is routed', routed === 8, `${routed} of 8`);

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

// It must NOT go through the app's selection: setMesh runs tool-context switching and ends in
// a render — the re-entrancy the bones tool's _selectLater exists to dodge. Looking at a curve
// should not be able to change your active tool.
{
  const i = code.indexOf('_setGraphTarget(meshId) {');
  const FN = code.slice(i, code.indexOf('\n  }', i));
  check('picking a curve does not change the scene selection',
    !/setMesh|setOrUnsetMesh/.test(FN),
    'this would switch tools as a side effect of clicking a row');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
