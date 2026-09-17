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

const REPO = new URL('..', import.meta.url).pathname;
// SWEEP EVERYTHING, SUBTRACT A NAMED BASELINE.
//
// This used to be a hand-written list of eleven rig and animation files, and the list was the
// weakness: `symMap` sat undefined in Move.startSculpt -- a plain ReferenceError, thrown whenever
// the topological symmetry snap actually succeeded -- and Move.js was simply not on it. matt hit
// it pressing Symmetrize L->R. Fixing that uncovered a SECOND one, `vAr`, in the same function,
// masked because symMap threw first.
//
// So the sweep is now the whole of src/, with the files that are already broken listed here by
// name. Anything not on this list must be clean, which means a NEW file is covered the day it is
// written and a newly-broken one fails immediately. Shrinking this list is the cleanup; growing
// it should take a deliberate decision.
//
// Each entry is a live ReferenceError waiting for the branch that reaches it, exactly like the two
// in Move.js were. They predate this widening and are reported separately rather than fixed in the
// same breath.
// EMPTY, AND IT SHOULD STAY THAT WAY. The seven files this listed when the sweep widened were
// all live ReferenceErrors -- Gizmo's VERTEX_SCALE (removed constant, in a console helper),
// PosedSymmetry's `b` (moved into a fallback branch by the ownership rewrite, still read by the
// trace), Remesh's `Mesh` (never imported, thrown by voxelMirror), VoxelState's `cx` (a log after
// a return), GuiXR's `main` (should have been this._main), GuiVRAnimation's `newData` (redo of a
// pasted shape key), GuiVRTools' `VERSION` (never imported) -- and all seven are fixed.
//
// Adding a name here is a decision to ship a known crash. Prefer fixing it.
const KNOWN_UNDEF = new Set([]);
const FILES = ['src/**/*.js'];

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
// eslint prints "<abs path>\n  line:col  error  '<id>' is not defined  no-undef"; attribute each
// error to the file heading above it, then drop the ones on the baseline.
const offenders = new Map();
{
  let file = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('/')) { file = line.trim().replace(REPO.replace(/\/$/, '') + '/', ''); continue; }
    const m = line.match(/error\s+'([^']+)' is not defined/);
    if (m && file) {
      if (!offenders.has(file)) offenders.set(file, new Set());
      offenders.get(file).add(m[1]);
    }
  }
}
const fresh = [...offenders.keys()].filter((f) => !KNOWN_UNDEF.has(f));
check('no undefined identifiers anywhere in src/, outside the named baseline',
  fresh.length === 0,
  fresh.map((f) => '    ' + f + ': ' + [...offenders.get(f)].join(', ')).join('\n'));

// And the baseline must not rot: a file that has been FIXED should leave the list, or the list
// stops meaning "these are the known-bad ones" and starts meaning "nobody has looked".
const stale = [...KNOWN_UNDEF].filter((f) => !offenders.has(f));
check('...and the baseline lists only files that are still broken',
  stale.length === 0,
  stale.map((f) => '    ' + f + ' is clean now — remove it from KNOWN_UNDEF').join('\n'));


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
