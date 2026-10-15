// THE RASTERISER FLOORS EVERY FRACTIONAL HEIGHT, AND THE ERROR ADDS UP DOWN THE PANEL.
//
// three-html-render rasterises a panel by cloning its DOM into an SVG <foreignObject>. Before
// serialising the clone it copies the computed fontSize/lineHeight/height/padding/margin/border
// of every element onto it -- pinning the layout so the SVG cannot re-flow differently. That
// part is right. What it does with a FRACTIONAL value is not:
//
//     n[s].style[r] = a % 1 !== 0 ? Math.floor(a) + "px" : i[r]
//
// Every row loses its fraction, and the losses ACCUMULATE down the flow. Measured through the
// real rasteriser, 15 stacked rows in one panel:
//
//     row height 27.0px  ->  texture scale 1.0000, drift   0.00px
//     row height 27.4px  ->  texture scale 0.9858, drift  -5.47px
//     row height 27.9px  ->  texture scale 0.9682, drift -12.47px
//
// Nothing in the app can see this: the hover quad is placed from the LIVE DOM's rects, which are
// correct, while what you look at is the texture, which is short. The highlight therefore sits
// BELOW the row it belongs to, by more the further down the panel you go -- exactly the shape of
// the bug matt reported ("nearly 3/4 off the menu element" at BLENDSHAPES, "at the top its more
// aligned"). It only shows up on a device whose font metrics make the rows fractional, which is
// why it does not reproduce on the mac, where every row measures a whole 27px.
//
// The fix is to pin the value the DOM actually has. Flooring was never buying anything the exact
// value does not: both stop the SVG re-flowing, only one of them lies about by how much.
//
// Applied here rather than by hand because node_modules is not committed, and rather than by
// vendoring 37KB of someone else's polyfill for a one-expression change. Idempotent, and a
// silent no-op once upstream fixes it or the shape of the line changes -- run from postinstall,
// where failing the install over a cosmetic patch would be worse than not applying it.
import { readFileSync, writeFileSync, existsSync } from 'fs';

const FILES = [
  'node_modules/three-html-render/dist/polyfill.mjs',
  'node_modules/three-html-render/dist/polyfill.js',
];

// The same expression, minified and not. Both files ship.
const EDITS = [
  ['isNaN(a) || (n[s].style[r] = a % 1 !== 0 ? Math.floor(a) + "px" : i[r]);',
   'isNaN(a) || (n[s].style[r] = i[r]);'],
  ['isNaN(a)||(n[s].style[r]=a%1!==0?Math.floor(a)+"px":i[r])',
   'isNaN(a)||(n[s].style[r]=i[r])'],
];

let touched = 0, already = 0;
for (const f of FILES) {
  if (!existsSync(f)) continue;
  let src = readFileSync(f, 'utf8');
  const before = src;
  for (const [from, to] of EDITS) if (src.includes(from)) src = src.split(from).join(to);
  if (src !== before) { writeFileSync(f, src); touched++; }
  else if (EDITS.some(([, to]) => src.includes(to))) already++;
}
if (touched) console.log(`[patch-three-html-render] fractional heights no longer floored (${touched} file${touched > 1 ? 's' : ''})`);
else if (already) console.log('[patch-three-html-render] already applied');
else console.warn('[patch-three-html-render] NOT APPLIED — the floor expression is gone or changed. '
  + 'If panel hover highlights drift down the panel again, re-read this script.');
