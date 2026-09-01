// Node harness for VR PANEL HIT ZONES -- why a slider is hard to hit with a ray.
//
// matt, aiming at the X-Ray slider in the bone panel: "the hover hilight is very thin and
// misaligned too low, the earlier capsule slider (which i think we can remove) keeps stealing
// focus, even though its at least 4 button rows away."
//
// Two separate faults with one symptom:
//   1. the input's BOX was the painted track (4-5px), while the thumb is 16px and drawn
//      OUTSIDE that box -- so the thing you aim at and the thing you can hit are different
//      rectangles, and the highlight (drawn from the box) is a thin band below the thumb;
//   2. a press that missed the sliver fell back to searching the SUBTREE of whatever element
//      the walk returned -- an ancestor, whenever the point lands in padding -- and took the
//      FIRST slider it found, which is the first slider in the panel.
//
// Run: node scratchpad/panelhit_test.mjs
//   PH_INJECT=thintrack   the slider box goes back to being the painted track
//   PH_INJECT=paneltree   the fallback searches the whole subtree again
//   PH_INJECT=nolimitrow  the row limit stays but the vertical test is dropped
import fs from 'fs';
import path from 'path';

const REPO = '/Users/mattestela/sculptxr';
let PANEL = fs.readFileSync(path.join(REPO, 'src/gui/htmlvr/HTMLVRPanel.js'), 'utf8');
let MINI  = fs.readFileSync(path.join(REPO, 'src/gui/htmlvr/MiniPanel.js'), 'utf8');
let MM    = fs.readFileSync(path.join(REPO, 'src/gui/htmlvr/MainMenuPanel.js'), 'utf8');

const inject = process.env.PH_INJECT || '';
const cut = (src, a, b, n) => {
  if (!src.includes(a)) throw new Error('inject ' + n + ': anchor moved');
  return src.replace(a, b);
};
if (inject === 'thintrack') {
  MINI = cut(MINI, '  height: 20px;\n  background: transparent;', '  height: 5px;', inject);
} else if (inject === 'paneltree') {
  PANEL = cut(PANEL, "        const row = el.closest?.('.mp-row, .mm-row, .acp-row, [data-row]') || null;\n        const cand = row ? row.querySelector('input[type=range]') : null;",
    "        const cand = el.querySelector?.('input[type=range]') ?? null;", inject);
} else if (inject === 'nolimitrow') {
  PANEL = cut(PANEL, '          if (absY >= r.top - pad && absY <= r.bottom + pad) rangeEl = cand;',
    '          rangeEl = cand;', inject);
}

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

const rule = (src, sel) => {
  const m = new RegExp('(^|\n)' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\{').exec(src);
  if (!m) return '';
  const body = src.slice(m.index + m[1].length);
  return body.slice(0, body.indexOf('}'));
};
const px = (block, prop) => {
  const m = block.match(new RegExp('(?:^|[;{\\s])' + prop + ':\\s*(-?[\\d.]+)px'));
  return m ? Number(m[1]) : null;
};

// ── A HIT BOX YOU CAN ACTUALLY HIT ────────────────────────────────────────────────────
//
// A ray in a headset is not a mouse: the wrist's own tremor is worth several pixels at panel
// distance, so a control whose box is 4px tall cannot be hit deliberately, however carefully
// it is aimed. The thumb is the thing the eye aims at -- the box has to be at least that.
{
  const THUMB = 16;
  for (const [name, src, sel] of [
    ['the mini panel', MINI, '#mp-root input[type=range]'],
    ['the main panel', MM, '.mm-row input[type=range]'],
  ]) {
    const h = px(rule(src, sel), 'height');
    check(name + "'s slider box is as tall as the thumb it draws",
      h !== null && h >= THUMB,
      h + 'px box against a ' + THUMB + 'px thumb -- the highlight comes from the BOX, which is '
      + 'why it read as a thin band under the control');
  }
  // The look must survive: the thin track moves to the track pseudo-element rather than
  // being lost, and the thumb is re-centred on it inside the taller box.
  const track = rule(MINI, '#mp-root input[type=range]::-webkit-slider-runnable-track');
  check('...with the painted track kept thin, on the track element',
    px(track, 'height') !== null && px(track, 'height') <= 8,
    'the fix is a bigger hit box, not a fatter-looking slider');
  check('...and the thumb re-centred on it',
    px(rule(MINI, '#mp-root input[type=range]::-webkit-slider-thumb'), 'margin-top') !== null,
    'a 16px thumb on a 5px track inside a 20px box sits low without one');
  check('...the input itself painting nothing',
    /background: transparent/.test(rule(MINI, '#mp-root input[type=range]')),
    'or the old 5px background paints a second bar across the taller box');
}

// ── A PRESS GRABS THE SLIDER ON ITS OWN ROW ───────────────────────────────────────────
{
  const dispatch = PANEL.slice(PANEL.indexOf('_vrDispatch(type, uv, buttons'),
                               PANEL.indexOf("if (type === 'pointerup') this._sliderDragTarget = null;"));
  check('the fallback search is limited to the row that was pressed',
    /el\.closest\?\.\('\.mp-row, \.mm-row, \.acp-row/.test(dispatch),
    'searching the hit element\'s subtree finds the FIRST slider in the panel when the walk '
    + 'returns an ancestor -- which it does for any press that lands in padding');
  check('...and the slider it finds has to be under the ray',
    /if \(absY >= r\.top - pad && absY <= r\.bottom \+ pad\) rangeEl = cand;/.test(dispatch),
    'a row limit alone still grabs a slider the press was nowhere near vertically');
  check('...with the tolerance taken from the slider, not from the panel',
    /const pad = Math\.max\(10, r\.height\);/.test(dispatch),
    'the whole point of this branch is catching a press that just missed a thin track');
  check('a direct hit still wins outright',
    /if \(el\.tagName === 'INPUT' && el\.type === 'range'\) \{\s*\n\s*rangeEl = el;/.test(dispatch));
}

// ── ONE FEWER SLIDER TO MIS-GRAB ──────────────────────────────────────────────────────
//
// The capsule-radius slider was the FIRST range in the bone panel, which is precisely why the
// subtree fallback above kept landing on it. matt: "i think the defualt size is pretty good,
// whatever the default is, leave it at that, and remove the slider."
{
  const BONE = fs.readFileSync(path.join(REPO, 'src/gui/bonePanel.js'), 'utf8');
  check('the capsule-radius slider is gone',
    !/id="bone-rad"/.test(BONE) && !/bone-rad-val/.test(BONE));
  check('...and its handler with it',
    !/window\._boneRadiusFrac =/.test(BONE),
    'a listener for an element nothing emits is how a panel rots');
  check('...leaving the default as the size',
    /const DEFAULT_RADIUS_FRAC = 0\.25;/.test(
      fs.readFileSync(path.join(REPO, 'src/editing/Skeleton.js'), 'utf8')));
  check('...and the button that pushed it now reads as the reset it is',
    /id="bone-rad-all">Reset Radii</.test(BONE),
    '"Apply To All" names a value the panel no longer has');
}

console.log(failures ? '\n' + failures + ' FAILURE(S)' : '\nall checks passed');
process.exit(failures ? 1 : 0);
