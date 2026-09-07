import fs from 'fs';
import path from 'path';

let fails = 0;
const check = (name, ok, extra) => {
  if (!ok) fails++;
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (ok || !extra ? '' : '  — ' + extra));
};

const ROOT = '/Users/mattestela/sculptxr/src';

// ── PANEL MARKUP IS SERIALISED AS XML, AND XML FORBIDS `--` INSIDE A COMMENT ──────────────
//
// Every VR panel is drawn by cloning its DOM, serialising it, and loading the result as an
// <img> through a data: URL. That path is XML, not HTML, and the two disagree about exactly
// one thing we write by hand: a double hyphen inside a comment is ordinary prose in HTML and
// a parse error in XML. The image then fails to load, the polyfill logs `rasterize failed`,
// and the panel keeps whatever texture it last painted successfully — so the section button
// looks dead while the DOM underneath it has already changed.
//
// It cost a headset session to find. matt: "swap to outliner, it displays; swap to properties,
// panel stays as outliner." The comment responsible was one added the day before, in the block
// that explains why the X-Ray/Mush row no longer vanishes.
//
// The rule is on the whole of src because any file can grow a template literal, and the
// failure is silent everywhere except inside a headset.
{
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) files.push(p);
    }
  })(ROOT);

  const offenders = [];
  for (const f of files) {
    const s = fs.readFileSync(f, 'utf8');
    for (const m of s.matchAll(/<!--([\s\S]*?)-->/g)) {
      if (!m[1].includes('--')) continue;
      const line = s.slice(0, m.index).split('\n').length;
      offenders.push(f.slice(ROOT.length + 1) + ':' + line + ' ' + JSON.stringify(m[1].trim().slice(0, 60)));
    }
  }
  check('no HTML comment in src carries a double hyphen',
    offenders.length === 0,
    offenders.length + ' would break the SVG rasterise: ' + offenders.join(' | '));

  check('...and the check can see comments at all',
    files.some((f) => /<!--/.test(fs.readFileSync(f, 'utf8'))),
    'nothing matched, so a green result proves nothing');
}

// ── THE REASON THE ROW STAYS SURVIVES THE REWRITE ─────────────────────────────────────────
//
// The offending comment was load-bearing documentation, not decoration: it is the record of
// why the X-Ray/Mush row renders disabled instead of disappearing. Moving it out of the
// markup must not quietly delete it.
{
  const BONE = fs.readFileSync(ROOT + '/gui/bonePanel.js', 'utf8');
  check('bonePanel still explains why the unbound row stays',
    /A CONTROL THAT VANISHES CANNOT BE TOLD FROM ONE THAT IS BROKEN/.test(BONE));
  check('...and says it outside the emitted markup',
    !/<!--[\s\S]*?A CONTROL THAT VANISHES/.test(BONE),
    'it is back inside an HTML comment, where XML will read it');
  check('...and the row it describes is still rendered',
    /need a bound mesh/.test(BONE));
}

console.log(fails ? `\n${fails} FAILURE(S)` : '\nall checks passed');
process.exit(fails ? 1 : 0);
