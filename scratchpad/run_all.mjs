// EVERY harness in this directory, in one command.
//
// There was no runner, so "the harnesses pass" meant whichever ones I had in my head at the
// time — and a hand-picked ten is not a suite. undef_test.mjs, which is an ESLint no-undef
// sweep over the rig files, sat here passing and unrun while a deleted `_vGrab` shipped a dead
// Tweak FK and Tweak Free to production and survived four versions there. It catches that in
// milliseconds. Two more harnesses (rigbatch, bonescreen) had been left asserting behaviour
// removed weeks earlier, which nobody noticed for the same reason.
//
// Success wording is not uniform across these files — most end "all checks passed", a couple
// say "<name> tests passed" — so the pass test accepts either rather than quietly failing the
// odd ones out.
//
// Run: node scratchpad/run_all.mjs        (add a substring to run a subset)
import { readdirSync } from 'fs';
import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const filter = process.argv[2] || '';
const files = readdirSync(DIR).filter((f) => f.endsWith('_test.mjs') && f.includes(filter)).sort();

let failed = [];
const t0 = Date.now();
for (const f of files) {
  let out = '', ok = false;
  try {
    out = execFileSync('node', [path.join(DIR, f)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    ok = /all checks passed|tests passed/.test(out);
  } catch (e) {
    out = (e.stdout || '') + (e.stderr || '');
  }
  if (!ok) failed.push([f, out.trim().split('\n').filter((l) => /FAIL|Error|error/.test(l)).slice(0, 4)]);
  process.stdout.write(ok ? '.' : 'X');
}
process.stdout.write('\n');

for (const [f, lines] of failed) {
  console.log('\n' + f);
  for (const l of lines) console.log('   ' + l.trim());
}
console.log(`\n${files.length - failed.length}/${files.length} passed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
process.exit(failed.length ? 1 : 0);
