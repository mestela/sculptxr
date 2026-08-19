// The stylus xray ghost: the blue tip you see through a mesh when the controller reaches
// inside one (Scene._updateStylusXray).
//
// It stopped appearing for the transform tools. The cause was not the tool list — they were
// both on it — but a cache that recorded the INTENT to show the ghost before knowing whether
// the write had landed, which latched the failure in for as long as the tool stayed selected.
//
// Run: node scratchpad/stylusxray_test.mjs   (from the repo root)
import fs from 'fs';
import path from 'path';

const REPO = '/Users/mattestela/sculptxr';
const SCENE = fs.readFileSync(path.join(REPO, 'src/Scene.js'), 'utf8');
const ENUMS = fs.readFileSync(path.join(REPO, 'src/misc/Enums.js'), 'utf8');

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

// Comments stripped: the prose in this function describes the bug it fixes, in the same words
// the assertions look for.
const code = SCENE.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const i = code.indexOf('_updateStylusXray() {');
check('the function is still there', i !== -1);
const FN = i === -1 ? '' : code.slice(i, code.indexOf('\n  }', i));

// THE LATCH. The key must be recorded only once there is a ghost to write to; otherwise a
// frame that runs before the controllers are connected (or after the wiped-state branch nulls
// them) records success, and the early return skips every retry afterwards.
const iGuard = FN.indexOf('if (!domGhost) return;');
const iKey = FN.indexOf('this._stylusXrayKey = key;');
const iLookup = FN.indexOf("domGhost = ");
check('the ghost is looked up before the key is recorded', iLookup !== -1 && iKey > iLookup,
  'the key is cached before the lookup: a missing ghost latches the failure in');
check('a missing ghost does not record the key', iGuard !== -1 && iGuard < iKey,
  'without this guard the early return skips every retry while the tool stays selected');
check('the ghost is written every time the key is recorded',
  FN.indexOf('domGhost.visible = on;') > iKey,
  'the write must be unconditional once the key is taken');

// THE TOOL LIST. It is an allowlist, not a universal rule — but every tool whose gesture puts
// the controller INSIDE the mesh belongs on it. Grab was the one missing.
const list = /const on = ([\s\S]*?);\n/.exec(FN);
check('the tool list is still an explicit list', !!list);
if (list) {
  for (const tool of ['TRANSFORM', 'TRANSFORM_VR', 'BONE_DRAW', 'GRAB']) {
    check(`${tool} reveals the tip`, new RegExp(`Enums\\.Tools\\.${tool}\\b`).test(list[1]),
      'this tool reaches inside the mesh, so the spike needs to be visible through it');
  }
  // A sculpt brush works ON the surface: an always-on blue tip there is noise, not proprioception.
  check('the sculpt brushes are left out', !/Enums\.Tools\.BRUSH\b/.test(list[1]));
  // Every name in the list must actually exist, or the comparison is silently always false.
  for (const m of list[1].matchAll(/Enums\.Tools\.([A-Z_]+)/g)) {
    check(`Enums.Tools.${m[1]} exists`, new RegExp(`^\\s*${m[1]}:\\s*\\d+`, 'm').test(ENUMS),
      'an unknown enum member is undefined, and idx === undefined is never true');
  }
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
