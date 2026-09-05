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
import fs from 'fs';
import path from 'path';

const REPO = '/Users/mattestela/sculptxr';
const FILES = [
  'src/editing/Skeleton.js',
  'src/editing/IKSolver.js',
  'src/editing/xfChannel.js',
  'src/editing/AnimationRegistry.js',
  'src/editing/tools/Grab.js',
  'src/editing/tools/TransformVR.js',
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


// ── A MATERIAL THAT REFUSES TO TEST DEPTH MUST NOT WRITE IT ──────────────────────────────
//
// `depthTest: false` says "draw me whatever is in front of me"; three's depthWrite defaults to
// TRUE, which then says "...and everything drawn after me must respect where I am". Together
// they stamp an overlay's depth into the buffer while ignoring the buffer, so anything later
// that DOES depth-test is punched out behind it -- and the VR panels, at renderOrder 11000 with
// depth testing on, are exactly that. It cost days: "in volume tweak, select a joint, go near a
// bbox handle, menu disappears", the joint handles being one of five materials with this pair.
//
// A sweep rather than five rules, because the next one will be written by someone adding an
// overlay and it will look exactly as reasonable as these did.
{
  const offenders = [];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name))
      : (e.name.endsWith('.js') ? [path.join(dir, e.name)] : []));
  for (const file of walk(path.join(REPO, 'src'))) {
    const src = fs.readFileSync(file, 'utf8');
    const re = /depthTest:\s*false/g;
    let m;
    while ((m = re.exec(src))) {
      // the enclosing object literal
      let d = 0, start = -1;
      for (let k = m.index; k >= 0; k--) {
        if (src[k] === '}') d++;
        else if (src[k] === '{') { if (!d) { start = k; break; } d--; }
      }
      d = 0; let end = -1;
      for (let k = m.index; k < src.length; k++) {
        if (src[k] === '{') d++;
        else if (src[k] === '}') { if (!d) { end = k; break; } d--; }
      }
      if (start < 0 || end < 0) continue;
      if (!/depthWrite/.test(src.slice(start, end))) {
        offenders.push(file.replace(REPO + '/', '') + ':' + (src.slice(0, m.index).split('\n').length));
      }
    }
  }
  check('no material tests depth off while still writing it',
    offenders.length === 0,
    offenders.join('  '));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
