// Node harness for the project/playback range in the .sxr header (ExportSGL / ImportSGL).
//
// A binary format is the one place where an off-by-one costs you every file ever saved, so what
// is checked here is the ARITHMETIC around the new field rather than a round trip through real
// meshes: that the header buffer actually grew for it, that the write and the read agree on the
// order, and — the part that bites — that a file written BEFORE the field exists still lands on
// the right byte for everything after it.
//
// Run: node scratchpad/sglrange_test.mjs
//   SGL_INJECT=nogrow       the header size is not increased, so the last field runs off the end
//   SGL_INJECT=noreset      a v13/v14 file inherits the previous file's project start
//   SGL_INJECT=alwaysread   the project start is read regardless of version, shifting every
//                           later field by one float on an older file
import fs from 'fs';

const REPO = '/Users/mattestela/sculptxr';
let EXP = fs.readFileSync(`${REPO}/src/files/ExportSGL.js`, 'utf8');
let IMP = fs.readFileSync(`${REPO}/src/files/ImportSGL.js`, 'utf8');

const inject = process.env.SGL_INJECT || '';
const cut = (which, anchor, replacement = '') => {
  const src = which === 'exp' ? EXP : IMP;
  if (!src.includes(anchor)) throw new Error(`inject ${inject}: anchor moved -> ${anchor.trim().slice(0, 50)}`);
  if (which === 'exp') EXP = EXP.replace(anchor, replacement);
  else IMP = IMP.replace(anchor, replacement);
};
if (inject === 'nogrow') {
  cut('exp', 'var nbBytes = 4 * (1 + 3 + 4 + 13 + 4 + 1);', 'var nbBytes = 4 * (1 + 3 + 4 + 13 + 3 + 1);');
} else if (inject === 'noreset') {
  cut('imp', '      window._animProjectStart = 0;\n');
} else if (inject === 'alwaysread') {
  cut('imp', '      if (version >= 15) window._animProjectStart = f32a[off++];',
      '      window._animProjectStart = f32a[off++];');
}

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' :: ' + detail : ''}`); }
};

console.log('\nthe version and the header size moved together');
{
  const ver = +(EXP.match(/Export\.VERSION = (\d+);/)?.[1] || 0);
  check('the format version was bumped past 14', ver >= 15, String(ver));
  check('the version history names the new field',
    /^\/\/ 15 .*project range START/m.test(EXP), 'a format field with no history line is a field nobody can date');

  const m = EXP.match(/var nbBytes = 4 \* \(([^)]+)\);/);
  if (!m) throw new Error('the header size expression moved — this harness is testing nothing');
  const terms = m[1].split('+').map((t) => +t.trim());
  const total = terms.reduce((a, b) => a + b, 0);
  // 1 version + 3 + 4 + 13 camera framing + 4 range fields + 1 mesh count.
  check('the header reserves a float for the new field', total === 26,
    `${m[1]} = ${total}; four range floats are written, so the block must be 4 not 3`);
}

console.log('\nwrite order and read order agree');
{
  const wrote = [...EXP.matchAll(/f32a\[off\+\+\] = window\.(_anim\w+)/g)].map((x) => x[1]);
  const read  = [...IMP.matchAll(/window\.(_anim\w+) = f32a\[off\+\+\]/g)].map((x) => x[1]);
  check('the exporter writes four range fields', wrote.length === 4, wrote.join(','));
  check('the importer reads the same four, in the same order',
    read.join(',') === wrote.join(','),
    `wrote [${wrote}] read [${read}] — a binary header that disagrees by one float corrupts everything after it`);
  check('the project start is LAST, so older readers stop before it',
    wrote[3] === '_animProjectStart', wrote.join(','));
}

console.log('\nan older file still lands correctly');
{
  check('the new read is version-gated', /if \(version >= 15\) window\._animProjectStart = f32a\[off\+\+\]/.test(IMP),
    'reading it unconditionally shifts every later field by one float on a v13/v14 file');
  check('the project start is reset before the gate',
    /window\._animProjectStart = 0;[\s\S]{0,120}?if \(version >= 15\)/.test(IMP),
    'without this, loading an old file keeps the project start of whichever file was loaded before it');

  // The reset must come BEFORE the conditional read, or it wipes the value it just read.
  const iReset = IMP.indexOf('window._animProjectStart = 0;');
  const iRead  = IMP.indexOf('if (version >= 15) window._animProjectStart');
  check('...and not after it, which would erase what it read',
    iReset > 0 && iRead > 0 && iReset < iRead, `reset@${iReset} read@${iRead}`);
}

console.log(`\n${pass} passed, ${fail} failed${inject ? `  [inject=${inject}]` : ''}`
  + (fail ? '' : '  — all checks passed'));
process.exit(fail ? 1 : 0);
