// Hover on a VR panel is drawn in 3D, not rasterised.
//
// A pointermove into the offscreen DOM changes CSS :hover, the polyfill's observer sees the
// mutation, and the WHOLE PANEL re-rasterises for a highlight. Crossing a row of buttons was one
// full repaint per button, each landing inside a committed frame — which is what made the
// controller feel like it was dragging through treacle.
import fs from 'fs';
import path from 'path';

const REPO = '/Users/mattestela/sculptxr';
const SRC = fs.readFileSync(path.join(REPO, 'src/gui/htmlvr/HTMLVRPanel.js'), 'utf8');
let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

// ── the whole point: a plain hover must not reach the DOM ────────────────────
{
  const i = SRC.indexOf('  onVRMove(uv) {');
  const fn = i === -1 ? '' : SRC.slice(i, SRC.indexOf('\n  }', i));
  check('onVRMove exists', i !== -1);
  check('a plain hover does NOT dispatch into the DOM',
    /this\._showHover\(uv\);/.test(fn),
    'a pointermove changes :hover, and that re-rasterises the entire panel');
  check('...but a slider DRAG still does',
    /if \(this\._sliderDragTarget\) \{ this\._vrDispatch\('pointermove'/.test(fn),
    'a slider genuinely needs the DOM to move');
}

// ── the highlight itself ─────────────────────────────────────────────────────
check('the highlight is a mesh parented to the panel',
  /this\.mesh\.add\(m\);/.test(SRC),
  'parenting means a panel that is grabbed and moved takes its hover with it');
check('...drawn over the panel, not inside it',
  /depthTest: false, depthWrite: false/.test(SRC) && /renderOrder = \(this\.mesh\.renderOrder \|\| 0\) \+ 1/.test(SRC));
check('...and out of the tone mapper, like the other overlays',
  /toneMapped: false/.test(SRC));

// Only pressable things. Otherwise the quad lands on whatever container was under the ray and
// reads as a random rectangle rather than "this is what you would click".
{
  const i = SRC.indexOf('  _hoverable(el) {');
  const fn = SRC.slice(i, SRC.indexOf('\n  }', i));
  check('only pressable elements highlight',
    /BUTTON/.test(fn) && /INPUT/.test(fn) && /role'\) === 'button'/.test(fn));
  check('...and the walk stops at the panel root',
    /n !== root/.test(fn), 'without this it walks out of the panel entirely');
}

// ── the ways a stale highlight happens, which is the failure mode here ───────
check('the highlight clears when the ray leaves',
  /onVRLeave\(\) \{[\s\S]{0,200}?this\.clearHover\(\);/.test(SRC),
  'otherwise it stays lit on the last button crossed and reads as a selection');
check('...and is dropped when the panel is rebuilt',
  /markDirty\(\) \{[\s\S]{0,240}?this\._hoverEl = null;/.test(SRC),
  'a repaint usually means new markup, so the measured element may no longer exist');
check('...and the same element twice does no work',
  /if \(target === this\._hoverEl\) \{ q\.visible = true; return; \}/.test(SRC),
  'this runs every frame the ray is on a panel');

// ── the mapping, which is easy to get subtly wrong ───────────────────────────
check('DOM y-down is converted to plane y-up',
  /\(0\.5 - cy\) \* meshH/.test(SRC),
  'getting this backwards puts the highlight on the mirrored row, which looks plausible');
check('the quad is sized from the element rect, not a constant',
  /r\.width \/ panelRect\.width/.test(SRC) && /r\.height \/ panelRect\.height/.test(SRC));
check('a panel with no measurable size is skipped',
  /if \(!panelRect\.width \|\| !panelRect\.height\)/.test(SRC),
  'a hidden panel measures zero and would divide by it');

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
