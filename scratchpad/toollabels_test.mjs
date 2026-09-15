import fs from 'fs';

let fails = 0;
const check = (name, ok, extra) => {
  if (!ok) fails++;
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (ok || !extra ? '' : '  — ' + extra));
};

const ROOT = '/Users/mattestela/sculptxr/src';

// ── EVERY TOOL IN THE ENUM HAS A NAME, IN ONE PLACE ──────────────────────────────────────
//
// The wrist panel showed the Select tool as "Tool 35". SELECT was appended to Enums.Tools last
// and added to the picker lists, but MiniPanel kept its OWN private copy of the names and
// nothing made that copy follow. Scene's quick-swap toast had the mirror of the same fault: it
// looked names up by searching SCULPT_TOOLS, which contains no mesh-edit tool, so swapping to
// Extrude toasted a bare "Tool".
//
// matt: "surely the names should just be assigned from a central location? how has that one
// entry got out of sync?"
//
// Both now read TOOL_LABELS in gui/htmlvr/toolLists.js. This checks the thing that actually
// goes wrong -- a tool added to the enum and not named -- because that failure is silent
// everywhere except on a panel in a headset, which is the slowest place to notice anything.

const ENUMS = fs.readFileSync(ROOT + '/misc/Enums.js', 'utf8');
const LISTS = fs.readFileSync(ROOT + '/gui/htmlvr/toolLists.js', 'utf8');

const block = ENUMS.slice(ENUMS.indexOf('Enums.Tools = {'), ENUMS.indexOf('};', ENUMS.indexOf('Enums.Tools = {')));
const toolNames = [...block.matchAll(/^\s*([A-Z_0-9]+)\s*:/gm)].map((m) => m[1]);

check('the enum was actually parsed', toolNames.length > 20,
  'found ' + toolNames.length + ' tools, so a green result below would prove nothing');

const labelled = new Set(
  [...LISTS.matchAll(/\[Enums\.Tools\.([A-Z_0-9]+)\]\s*:/g)].map((m) => m[1]));

const missing = toolNames.filter((n) => !labelled.has(n));
check('every tool in Enums.Tools has a label in TOOL_LABELS',
  missing.length === 0,
  missing.join(', ') + ' would render as "Tool <id>" wherever the name is shown');

// A list entry must not carry its own spelling: that is how the two copies drifted apart in the
// first place. Entries are built from the id and read the label from the map.
const inlineLabels = [...LISTS.matchAll(/\{\s*id:\s*Enums\.Tools\.[A-Z_0-9]+\s*,\s*label:\s*'/g)];
check('...and no list entry hardcodes its own label',
  inlineLabels.length === 0,
  inlineLabels.length + ' entries spell a name beside the id instead of taking it from the map');

// Nobody else may keep a second map. The wrist panel's was the one that broke.
for (const f of ['gui/htmlvr/MiniPanel.js', 'gui/htmlvr/MainMenuPanel.js', 'gui/htmlvr/ToolPickerPanel.js']) {
  const src = fs.readFileSync(ROOT + '/' + f, 'utf8');
  check('no private tool-name map in ' + f,
    !/const\s+TOOL_NAMES\s*=/.test(src),
    'a second copy of the names is exactly what put "Tool 35" on the wrist panel');
}

console.log(fails ? `\n${fails} FAILURE(S)` : '\nall checks passed');
process.exit(fails ? 1 : 0);
