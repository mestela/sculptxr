// Catches identifiers that do not exist — the class of bug the stubbed harnesses cannot see.
//
// Twice now a block-scoped const has been used outside its block: `pinObj` declared inside
// `if (pinMode) {}` and read by the highlight below it. That is not a syntax error, so esbuild
// parses it happily; it is not module-scope work, so module_load_test evaluates it happily; and
// updateVisuals has no harness of its own because it needs a live Three scene. It only shows up
// as a crash the moment you draw a bone.
//
// ESLint's no-undef finds it in milliseconds, so the rig files are swept on every test run.
// Deliberately ONE rule: this is a bug detector, not a style gate, and a lint run that reports
// formatting opinions is a lint run people stop reading.
import { execFileSync } from 'child_process';
import path from 'path';

const REPO = '/Users/mattestela/sculptxr';
const FILES = [
  'src/editing/Skeleton.js',
  'src/editing/IKSolver.js',
  'src/editing/xfChannel.js',
  'src/editing/AnimationRegistry.js',
  'src/editing/tools/Grab.js',
  'src/editing/tools/BoneDrawTool.js',
  'src/gui/GuiTimeline.js',
  'src/gui/TimelineHelper.js',
  'src/gui/bonePanel.js',
  'src/math3d/Picking.js',
];

let failures = 0;
const check = (name, ok, detail) => {
  if (ok) { console.log('  ok   ' + name); return; }
  failures++; console.log('  FAIL ' + name + (detail ? '\n' + detail : ''));
};

let out = '';
try {
  execFileSync('npx', ['eslint', '--config',
    path.join(REPO, 'scratchpad/_undef_eslint.config.mjs'), ...FILES],
    { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
} catch (e) {
  out = (e.stdout || '') + (e.stderr || '');
}
check('no undefined identifiers in the rig and animation files', out.trim() === '', out.trim());

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
