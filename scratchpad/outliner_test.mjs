// Node harness for the VR outliner's size.
//
// Two complaints, one cause: the outliner was styled for a scene of a few meshes, and a rig has
// dozens of joints. matt: "it expands to the full length of the panel, meaning its a lot of
// scrolling... the font size and icons used for the outliner are too big."
//
// Both are CSS in a template literal, so this reads the declarations out of the source and
// checks the NUMBERS -- a class existing says nothing about how big it is.
//
// Run: node scratchpad/outliner_test.mjs
//   OL_INJECT=nocap     the list grows to content height again, pushing the controls off-screen
//   OL_INJECT=noscroll  it is capped but does not scroll, so the rows past the cap are lost
//   OL_INJECT=bigtype   the type goes back to its pre-rig size
//   OL_INJECT=blindscroll the thumbstick always scrolls the panel, ignoring what the ray is on
//   OL_INJECT=blindthumb  a scroll moves the panel's thumb whatever container actually moved
//   OL_INJECT=nosbar      the list scrolls but has no track, so in VR there is nothing to see
//   OL_INJECT=roweye      the eye comes back onto every row
//   OL_INJECT=onevis      the toolbar eye hides only the first of the selection
//   OL_INJECT=nodim       a hidden mesh reads exactly like a visible one now the eye is gone
//   OL_INJECT=renamemulti the rename button stays live on a multi-selection
import fs from 'fs';
import path from 'path';

const REPO = '/Users/mattestela/sculptxr';
let SRC = fs.readFileSync(path.join(REPO, 'src/gui/htmlvr/MainMenuPanel.js'), 'utf8');
let PANEL = fs.readFileSync(path.join(REPO, 'src/gui/htmlvr/HTMLVRPanel.js'), 'utf8');

const inject = process.env.OL_INJECT || '';
const cut = (a, b, n) => {
  if (!SRC.includes(a)) throw new Error('inject ' + n + ': anchor moved');
  SRC = SRC.replace(a, b);
};
if (inject === 'nocap') {
  cut('  max-height: ${Math.round(MM_BODY_H * 0.66)}px;', '', inject);
} else if (inject === 'noscroll') {
  cut('  overflow-y: auto;\n  overscroll-behavior: contain;', '', inject);
} else if (inject === 'bigtype') {
  cut('.mm-node-icon { display: inline-block; width: 10px; font-size: 8px;',
    '.mm-node-icon { display: inline-block; width: 14px; font-size: 12px;', inject);
} else if (inject === 'roweye') {
  cut('<div class="mm-outliner-row${pickCls}',
    '<div class="x"><button class="mm-vis-btn" data-action="vis"></button></div><div class="mm-outliner-row${pickCls}',
    inject);
} else if (inject === 'onevis') {
  cut('    for (const mesh of sel) {', '    for (const mesh of sel.slice(0, 1)) {', inject);
} else if (inject === 'nodim') {
  cut('.mm-outliner-row.is-hidden .mm-mesh-btn { opacity: 0.45; font-style: italic; }', '', inject);
} else if (inject === 'renamemulti') {
  const A = 'id="mm-rename-sel" title="Rename selected"$' + "{singleSel ? '' : ' disabled'}";
  cut(A, 'id="mm-rename-sel" title="Rename selected"', inject);
} else if (inject === 'nosbar') {
  cut('<div class="mm-scrollbar-track mm-outliner-sbar">', '<div class="mm-nope">', inject);
} else if (inject === 'blindscroll') {
  const a = 'const el = (at && this._scrollClipEl(at)) || this._findScrollable(this._element);';
  if (!PANEL.includes(a)) throw new Error('inject blindscroll: anchor moved');
  PANEL = PANEL.replace(a, 'const el = this._findScrollable(this._element);')
               .replace('this._lastUV = uv;', '');
} else if (inject === 'blindthumb') {
  const a = 'const thumb = (scrollEl.parentElement';
  if (!PANEL.includes(a)) throw new Error('inject blindthumb: anchor moved');
  PANEL = PANEL.replace(a, 'const thumb = (false');
}

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

// The declarations of one CSS rule, so a number can be read from the block it belongs to
// rather than from anywhere in the file that happens to contain it.
// The CSS lives in a template literal, so a `${...}` interpolation inside a rule carries a
// closing brace that is NOT the end of the rule -- slicing to the first '}' silently cut this
// block off at max-height and reported the overflow lines below it as missing.
const rule = (sel) => {
  // AT THE START OF A RULE, not anywhere the selector appears: '.mm-mesh-btn {' also occurs as
  // the tail of '.mm-outliner-row.is-hidden .mm-mesh-btn {', and matching that one returned a
  // block with no font-size in it -- reported as "the type is missing" when it was right there.
  const m = new RegExp('(^|\n)' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\{').exec(SRC);
  const at = m ? m.index + m[1].length : -1;
  if (at < 0) return '';
  const body = SRC.slice(at).replace(/\$\{[^}]*\}/g, 'X');
  return body.slice(0, body.indexOf('}'));
};
const num = (block, prop) => {
  const m = block.match(new RegExp(prop + ':\\s*([\\d.]+)px'));
  return m ? Number(m[1]) : null;
};

const bodyH = Number((SRC.match(/const MM_BODY_H\s*=\s*(\d+);/) || [])[1]);
check('the panel body height is readable', bodyH > 0, String(bodyH));

// ── A CEILING, AND A SCROLLBAR ────────────────────────────────────────────────────────
{
  const list = rule('.mm-outliner-list');
  check('the outliner list is capped', /max-height:/.test(list),
    'at content height a rig fills the panel and pushes every control below it out of reach');
  const frac = Number((SRC.match(/max-height: \$\{Math\.round\(MM_BODY_H \* ([\d.]+)\)/) || [])[1]);
  // Tightened from two thirds to a bit under a half: two thirds still buried the transform
  // fields and the parenting buttons under a rig's worth of joints. matt: "make it 1/3 less
  // rows." The check is a BAND, not the number -- what matters is that the list is capped well
  // short of the panel, not the exact fraction.
  check('...at a bit under half the panel',
    frac > 0.3 && frac < 0.55, 'fraction ' + frac);
  check('...and scrolls itself, or the rows past the cap are simply lost',
    /overflow-y:\s*auto/.test(list));
  check('...without a flick inside it scrolling the panel as well',
    /overscroll-behavior:\s*contain/.test(list),
    'the panel is itself a scroll surface, so a nested one has to stop the chain');
  check('...while still not collapsing when the scene is empty',
    /min-height:\s*\d+px/.test(list),
    'the floor is why this looked right before a rig existed');
}

// ── A QUARTER SMALLER, TOGETHER ───────────────────────────────────────────────────────
//
// Shrinking only the text gains nothing: the eye button then sets the row height. So the type,
// the eye, the icon and the gaps all have to come down together, and that is what is checked.
{
  const btn = rule('.mm-mesh-btn');

  const icon = rule('.mm-node-icon');
  const row = rule('.mm-outliner-row');
  const WAS = { type: 11, icon: 14 };
  const type = num(btn, 'font-size');
  const iconW = num(icon, 'width');
  const shrunk = (now, was) => now !== null && now <= was * 0.8 && now > was * 0.5;
  check('the row type is about a quarter smaller', shrunk(type, WAS.type),
    type + 'px, was ' + WAS.type);
  check('...and the node icon, by rather more', iconW !== null && iconW <= WAS.icon * 0.75,
    iconW + 'px, was ' + WAS.icon + ' -- a second 10% pass after the first still read too big');
  check('...glyph and box together', (num(icon, 'font-size') || 99) <= iconW,
    'a glyph larger than its box is what made these read big at any width');
  check('the row padding came down too',
    /padding:\s*0 0/.test(row) || (num(row, 'padding') !== null && num(row, 'padding') < 1),
    'row padding is part of the height whatever the type does');
  // The rename field sits in the same row and would otherwise jump the height when it appears.
  check('the rename field matches the row type',
    num(rule('.mm-rename-input'), 'font-size') === type,
    'a bigger field would resize the row the moment you double-click a name');
}

// ── A SCROLLBAR YOU CAN SEE ───────────────────────────────────────────────────────────
//
// The panel is rasterised through an SVG foreignObject, which paints no native scrollbar, so
// `overflow-y: auto` alone gives a list that scrolls invisibly. The hand-built track is the
// only thing a headset ever shows -- matt: "it needs its own scrollbar".
{
  check('the list carries its own track',
    /class="mm-scrollbar-track mm-outliner-sbar"/.test(SRC),
    'overflow:auto paints nothing in an SVG-rasterised panel');
  check('...with a thumb inside it',
    /mm-outliner-sbar"><div class="mm-scrollbar-thumb"/.test(SRC));
  check('...pinned to a positioned wrapper, not floating in the panel',
    /\.mm-outliner-wrap \{[^}]*position: relative/.test(SRC));
  check('...and the native bar suppressed so the two do not both appear',
    /scrollbar-width:\s*none/.test(rule('.mm-outliner-list')) &&
    /\.mm-outliner-list::-webkit-scrollbar \{ display: none/.test(SRC));
  check('the rows leave room for the track',
    (num(rule('.mm-outliner-list'), 'padding-right') || 0) >= 12,
    'without it the track sits on top of the names');
  // The list is re-rendered on every content rebuild, so its scrollbar is a NEW element pair.
  check('the track is re-wired after each rebuild, not once at construction',
    /wireVRScrollbar\(\s*olList/.test(SRC),
    'wiring it once leaves it dead from the first rebuild on');
}

// ── SCROLL GOES WHERE THE RAY IS ──────────────────────────────────────────────────────
//
// matt: "if i use the thumbstick within the outliner, scroll the outliner, if i use the
// thumbstick elsewhere on the panel, scroll the panel."
{
  check('the panel remembers where the ray last was',
    /this\._lastUV = uv;/.test(PANEL));
  check('...and a scroll resolves the container from THAT, not from the panel',
    /const at = this\._lastUV \? this\._uvToElement\(this\._lastUV\)\.el : null;/.test(PANEL) &&
    /this\._scrollClipEl\(at\)/.test(PANEL),
    'one global answer scrolls the panel under a list that stays put');
  check('...falling back to the panel body when the ray is not in a scroller',
    /\|\| this\._findScrollable\(this\._element\)/.test(PANEL),
    'and _scrollClipEl only accepts a container that actually overflows, so a short list falls through');
  check('the thumb that moves belongs to the container that scrolled',
    /const thumb = \(scrollEl\.parentElement/.test(PANEL),
    'a panel-wide query moves the wrong thumb and reads as the scroll going astray');
}

// ── ONE BUTTON EACH, IN THE TOOLBAR ───────────────────────────────────────────────────
//
// Three buttons per row is a lot of row when a rig puts dozens of them on screen, and
// multi-select is what made the per-row pair redundant. matt: "now that we have multiselect,
// lets remove the per-item visibility and rename buttons, and move them to the top toolbar."
{
  check('no eye on the rows any more',
    !/class="mm-vis-btn/.test(SRC) && !/data-action="vis"/.test(SRC));
  check('no pencil on the rows any more',
    !/class="mm-rename-btn/.test(SRC) && !/data-action="rename"/.test(SRC));
  check('...and their dead CSS went with them',
    !/^\.mm-vis-btn/m.test(SRC) && !/^\.mm-rename-btn/m.test(SRC),
    'rules for elements nothing emits are how a stylesheet rots');

  // The OUTLINER's toolbar specifically: '.mm-outliner-wrap' first appears in the stylesheet,
  // hundreds of lines above the markup, so slicing to its first occurrence gave nothing at all.
  const barAt = SRC.indexOf('<div class="mm-toolbar">', SRC.indexOf('mm-section-title">Outliner'));
  const bar = SRC.slice(barAt, SRC.indexOf('<div class="mm-outliner-wrap">', barAt));
  check('the toolbar has the eye', /id="mm-vis-toggle"/.test(bar));
  check('the toolbar has the pencil', /id="mm-rename-sel"/.test(bar));
  check('the eye is disabled with nothing selected',
    /id="mm-vis-toggle"[^>]*\$\{hasSel \? '' : ' disabled'\}/.test(bar));
  check('the pencil needs a SINGLE selection',
    /id="mm-rename-sel"[^>]*\$\{singleSel \? '' : ' disabled'\}/.test(bar),
    'one typed name cannot go into six meshes');
  check('the eye reports the selection, not one mesh',
    /const selAnyVisible = selected\.some/.test(SRC));

  // The click has to reach every selected mesh, and to pick ONE target state -- a per-mesh
  // toggle over a mixed selection just inverts the mess.
  check('hiding acts on the whole selection',
    /for \(const mesh of sel\) \{/.test(SRC));
  check('...towards a single target state',
    /const want = !sel\.some\(\(m\) => m\.isVisible/.test(SRC));

  // With no eye on the row, the row itself has to carry the state.
  check('a hidden mesh still reads as hidden',
    /\.mm-outliner-row\.is-hidden \.mm-mesh-btn \{[^}]*opacity/.test(SRC),
    'the eye was the only thing saying so before');
  check('...and a keyframed one still reads as keyframed',
    /\.mm-outliner-row\.vis-keyed/.test(SRC) && /\.mm-tool-btn\.keyed/.test(SRC));
  // updateOutlinerVisIcons runs every frame so the timeline's visibility shows live.
  check('the per-frame sync updates the rows',
    /row\.classList\.toggle\('is-hidden'/.test(SRC),
    'it used to walk the row eyes, which no longer exist');
  check('...and the toolbar eye',
    /querySelectorAll\('#mm-vis-toggle'\)/.test(SRC),
    'querySelectorAll, because a torn-off Scene panel has its own copy');
}

console.log(failures ? '\n' + failures + ' FAILURE(S)' : '\nall checks passed');
process.exit(failures ? 1 : 0);
