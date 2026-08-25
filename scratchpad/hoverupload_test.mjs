// A HOVER MUST NOT RE-UPLOAD THE MESH.
//
// updateRender() calls updateMeshBuffers(), which pushes the whole vertex buffer to the GPU.
// That is right after a stroke and waste on a hover, and it was measured as the single largest
// CPU cost in the headset: xr-tools 3.3-4.8ms with the trigger NOT pressed, while the shared
// hover path inside it measured 0.04ms. The rest was this.
//
// The rule is easy to undo by accident — cursorRender and updateRender differ by one line and
// read almost identically at a call site — so it is asserted rather than left to a comment.
import fs from 'fs';
import path from 'path';

const REPO = '/Users/mattestela/sculptxr';
const BASE = fs.readFileSync(path.join(REPO, 'src/editing/tools/SculptBase.js'), 'utf8');
const MOVE = fs.readFileSync(path.join(REPO, 'src/editing/tools/Move.js'), 'utf8');
let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

// The two must stay distinguishable: one uploads, one does not.
{
  const i = BASE.indexOf('  cursorRender() {');
  const fn = i === -1 ? '' : BASE.slice(i, BASE.indexOf('\n  }', i));
  check('cursorRender exists', i !== -1);
  check('...and does NOT touch the mesh buffers',
    !!fn && !/updateMeshBuffers/.test(fn),
    'a hover changed nothing; re-uploading it is the cost this exists to avoid');
  check('...but does still raise the redraw flag',
    /this\._main\.render\(\)/.test(fn),
    'the brush CURSOR moved even though the mesh did not');

  const j = BASE.indexOf('  updateRender() {');
  const up = BASE.slice(j, BASE.indexOf('\n  }', j));
  check('updateRender still uploads, for the stroke path that needs it',
    /updateMeshBuffers/.test(up));
}

// The hover branch is the one that runs every frame with nothing pressed.
{
  const i = MOVE.indexOf('    if (!isPressed) {');
  const hover = i === -1 ? '' : MOVE.slice(i, MOVE.indexOf('\n    }', i));
  check('Move has an isPressed=false branch', i !== -1);
  check('...and it uses cursorRender, not updateRender',
    /this\.cursorRender\(\)/.test(hover) && !/this\.updateRender\(\)/.test(hover),
    'this branch runs every frame the controller is not pressed');
}

// The stroke path must be untouched: buffers there HAVE changed.
{
  const i = BASE.indexOf('  sculptStrokeXR(');
  const fn = BASE.slice(i, BASE.indexOf('\n  }', BASE.indexOf('this.updateRender();', i)));
  check('the stroke path still calls updateRender',
    /this\.updateRender\(\);/.test(fn),
    'skipping the upload after a real stroke would leave the edit invisible');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
