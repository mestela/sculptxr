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

  // ── A BACKTICK INSIDE AN INJECTED STYLESHEET ────────────────────────────────────────────
  //
  // The panel stylesheets are JS template literals, so a backtick anywhere inside one CLOSES
  // it: everything after becomes code, and the usual shape of the failure is a
  // ReferenceError naming some word out of a CSS comment ("reorg is not defined", "repeat is
  // not defined"). The MiniPanel's hands-only block already carries a hand-written warning
  // about this, which is the tell that it has happened before -- a warning in one file does
  // not cover the next person editing another.
  //
  // Caught twice in one sitting while writing CSS comments that quoted selector names, which
  // is exactly when it is most tempting to reach for code formatting.
  const cssOffenders = [];
  for (const f of files) {
    const s2 = fs.readFileSync(f, 'utf8');
    // Each `const <NAME>CSS = ` / `const CSS = ` literal, up to its closing backtick-semicolon.
    for (const m of s2.matchAll(/const\s+\w*CSS\w*\s*=\s*`/g)) {
      const start = m.index + m[0].length;
      const end = s2.indexOf('`;', start);
      if (end < 0) continue;
      const body = s2.slice(start, end);
      if (!body.includes('`')) continue;
      const line = s2.slice(0, start + body.indexOf('`')).split('\n').length;
      cssOffenders.push(f.slice(ROOT.length + 1) + ':' + line);
    }
  }
  check('no injected stylesheet contains a stray backtick',
    cssOffenders.length === 0,
    cssOffenders.length + ' would close the template literal and turn the rest of the CSS into '
      + 'code: ' + cssOffenders.join(' | '));

  // ── EVERY GRID COLUMN CLASS THAT IS USED IS ALSO DEFINED ────────────────────────────────
  //
  // `cols-4` was used by the Export format row and defined nowhere, so .mm-choice-grid's bare
  // display:grid gave it one column and four short buttons stacked down the whole panel width,
  // in both hosts, for as long as that markup existed. A class that does not exist raises
  // nothing -- no error, no warning, just a layout quietly falling back.
  //
  // The cols-N family is a closed set with an obvious spelling, so it can be checked exactly:
  // collect what the markup asks for, collect what the stylesheets define, compare.
  {
    const used = new Set(), defined = new Set();
    for (const f of files) {
      const s3 = fs.readFileSync(f, 'utf8');
      for (const m of s3.matchAll(/class="[^"]*?\bcols-(\d+)\b/g)) used.add(m[1]);
      for (const m of s3.matchAll(/\.cols-(\d+)\s*\{/g)) defined.add(m[1]);
    }
    const missing = [...used].filter((n) => !defined.has(n)).sort();
    check('every cols-N grid class used in markup is defined in CSS',
      missing.length === 0,
      'cols-' + missing.join(', cols-') + ' would silently fall back to a single column');
    check('...and that check found classes on both sides',
      used.size > 0 && defined.size > 0,
      'used=' + used.size + ' defined=' + defined.size + ', so a green result proves nothing');
  }

  check('...and that check is looking at real stylesheets',
    files.some((f) => /const\s+\w*CSS\w*\s*=\s*`/.test(fs.readFileSync(f, 'utf8'))),
    'no CSS literal matched the pattern, so a green result proves nothing');
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
