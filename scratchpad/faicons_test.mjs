import fs from 'fs';

let fails = 0;
const check = (name, ok, extra) => {
  if (!ok) fails++;
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (ok || !extra ? '' : '  — ' + extra));
};
const ROOT = new URL('../', import.meta.url).pathname;
const ICONS   = fs.readFileSync(ROOT + 'src/gui/htmlvr/faIcons.js', 'utf8');
const INSTALL = fs.readFileSync(ROOT + 'src/gui/htmlvr/install.js', 'utf8');
const MM      = fs.readFileSync(ROOT + 'src/gui/htmlvr/MainMenuPanel.js', 'utf8');
const ACP     = fs.readFileSync(ROOT + 'src/gui/htmlvr/AnimationControlPanel.js', 'utf8');
const TABS    = fs.readFileSync(ROOT + 'src/gui/tabIcons.js', 'utf8');

// ── THE FONT MUST NOT BE IN document.styleSheets ──────────────────────────────────────────
//
// The rasteriser inlines every stylesheet into EVERY panel's SVG on EVERY paint. A base64
// @font-face in a <style> therefore cost 206KB per panel per paint -- measured 462KB/36.5ms
// with it against 256KB/29.3ms without, same panel, cold decode. matt: "slower and slower the
// more mainpanels i pin", because each pinned panel paid for the font separately.
//
// The FontFace API registers the family for canvas and for the DOM WITHOUT ever appearing in
// document.styleSheets, which is the whole point: available to draw with, invisible to the
// serialiser.
{
  check('FA is registered through the FontFace API',
    /new FontFace\('Font Awesome 6 Free'/.test(INSTALL),
    'not registered, so the canvas radial menu loses its glyphs');

  check('...and never as a stylesheet the rasteriser will inline',
    !/@font-face\{font-family:'Font Awesome/.test(INSTALL),
    'the 206KB font is back in document.styleSheets, and back in every panel SVG');

  // The radial menu draws codepoints with ctx.fillText the frame it opens; an unloaded family
  // silently falls back to the default font rather than failing.
  check('...and the load is kicked at startup, not left to first paint',
    /_faFace\.load\(\)/.test(INSTALL),
    'the radial menu can open before the family is usable');
}

// ── EVERY ICON A PANEL ASKS FOR MUST EXIST ────────────────────────────────────────────────
//
// faIcon() returns '' for an unknown name, so a typo or a newly-used icon is not an error --
// it is a button that silently has no icon on it. That is exactly the kind of thing nobody
// notices until it is in a headset.
{
  const known = new Set([...ICONS.matchAll(/^  '([a-z0-9-]+)': \[/gm)].map((m) => m[1]));
  check('the generated map has icons in it', known.size > 20, known.size + ' found');

  const used = new Set();
  for (const src of [MM, ACP, TABS]) {
    for (const m of src.matchAll(/faIcon\('([a-z0-9-]+)'/g)) used.add(m[1]);
    for (const m of src.matchAll(/_fa\('([a-z0-9-]+)'/g)) used.add(m[1]);
    // the ternaries: faIcon(cond ? 'a' : 'b')
    for (const m of src.matchAll(/faIcon\([^)]*\?\s*'([a-z0-9-]+)'\s*:\s*'([a-z0-9-]+)'/g)) {
      used.add(m[1]); used.add(m[2]);
    }
  }
  const missing = [...used].filter((n) => !known.has(n));
  check('every icon the panels ask for is in the map', missing.length === 0,
    'missing: ' + missing.join(', ') + ' — those buttons render with no icon at all');
  check('...and the panels actually ask for some', used.size >= 15, used.size + ' referenced');
}

// ── NO GLYPH MARKUP LEFT IN A RASTERISED PANEL ────────────────────────────────────────────
//
// An <i class="fa-solid"> in panel markup needs the font embedded to render, so one left behind
// would either show nothing in VR or drag the font back in to fix it.
{
  for (const [name, src] of [['MainMenuPanel', MM], ['AnimationControlPanel', ACP],
                             ['tabIcons', TABS]]) {
    check(name + ' has no FontAwesome glyph markup left',
      !/<i class="fa-solid/.test(src) && !/font-family:'Font Awesome/.test(src),
      'a glyph needs the font that is no longer inlined');
  }
  check('the icon class is styled to sit where the glyph did',
    /\.fa-i \{[\s\S]*?vertical-align: -0\.125em;/.test(MM),
    'icons will not sit on the text baseline');
}

console.log(fails ? `\n${fails} FAILURE(S)` : '\nall checks passed');
process.exit(fails ? 1 : 0);
