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
  const i = SRC.indexOf('  onVRMove(uv');   // signature grew a hand; do not pin the arg list
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
// ── TWO HANDS, ONE PANEL ─────────────────────────────────────────────────────
//
// Scene runs its dispatch once per CONTROLLER. The hand pointing at a panel calls onVRMove and
// the other hand — whose winner is some other panel, or none — calls onVRLeave on that same
// panel, every frame. Set, cleared, set again: the highlight flickered across every panel on
// screen and looked like a hit-test fault.
check('a hover records which hand owns it',
  /onVRMove\(uv, hand\) \{[\s\S]{0,240}?this\._hoverHand = hand;/.test(SRC));
check('...and only that hand can end it',
  /if \(hand === undefined \|\| hand === this\._hoverHand\) this\.clearHover\(\);/.test(SRC),
  'the other hand pointing elsewhere must not clear this hand\'s highlight');
check('...while an unnamed leave still clears, for a real teardown',
  /hand === undefined \|\|/.test(SRC),
  'a hidden panel or an ended session must not leave anything lit');
{
  const SCENE = fs.readFileSync(path.join(REPO, 'src/Scene.js'), 'utf8');
  check('Scene names the hand on both calls',
    /onVRMove\(_winner\.hit\.uv, source\.handedness\)/.test(SCENE)
      && /onVRLeave\(source\.handedness\)/.test(SCENE),
    'without the name the panel cannot tell the two cases apart');
}
check('...and is dropped when the panel is rebuilt',
  /markDirty\(\) \{[\s\S]{0,240}?this\._hoverEl = null;/.test(SRC),
  'a repaint usually means new markup, so the measured element may no longer exist');
check('...and the same element twice does no work',
  /if \(target === this\._hoverEl && !scrolled\) \{ q\.visible = true; return; \}/.test(SRC),
  'this runs every frame the ray is on a panel');
check('...unless the panel scrolled under it',
  /const scrolled = this\._hoverScrollTop !== this\._scrollTopOf\(target\);/.test(SRC),
  'the same row is now somewhere else, and the highlight would stay behind');

// ── the mapping, which is easy to get subtly wrong ───────────────────────────
// THIS CHECK ASSERTED THE BUG. It demanded `(0.5 - cy)` on the reasoning that DOM y is down
// and a plane's y is up — which is true in general and false here, because the panel's texture
// is mapped without inversion. Every highlight landed on the mirrored row, and the check
// confirmed it was correct. A test written from the same wrong assumption as the code does not
// catch the mistake, it ratifies it.
check('the panel maps DOM-down straight onto plane-down, without negating',
  /q\.position\.set\(\(cx - 0\.5\) \* this\._meshWidth, \(cy - 0\.5\) \* meshH/.test(SRC),
  'negating puts every highlight on the mirrored row');
check('the quad is sized from the measured rect, not a constant',
  /\(right - left\) \/ panelRect\.width/.test(SRC) && /\(bot - top\) \/ panelRect\.height/.test(SRC));

// ── a tall panel scrolls, and rects do not stop at the container ─────────────
check('the highlight is clipped to the scroll container',
  /const clip = this\._scrollClipRect\(target\) \|\| panelRect;/.test(SRC),
  'getBoundingClientRect happily reports an element scrolled out of view');
check('...and to the panel itself',
  /Math\.max\(r\.top, clip\.top, panelRect\.top\)/.test(SRC));
check('...and vanishes when nothing of it is left visible',
  /if \(bot - top <= 0\.5 \|\| right - left <= 0\.5\) \{ q\.visible = false; return; \}/.test(SRC),
  'otherwise a scrolled-away button keeps a highlight floating past the panel edge');
check('a half-scrolled button is cut off at the boundary, not hidden',
  /q\.scale\.set\(this\._meshWidth \* \(\(right - left\)/.test(SRC),
  'sizing from the clipped rect gives the partial case for free');
check('only ONE definition of which ancestor scrolls',
  (SRC.match(/scrollHeight > n\.clientHeight \+ 1/g) || []).length === 1,
  'two copies of that rule is how the clip and the scroll check drift apart');
check('a panel with no measurable size is skipped',
  /if \(!panelRect\.width \|\| !panelRect\.height\)/.test(SRC),
  'a hidden panel measures zero and would divide by it');

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
