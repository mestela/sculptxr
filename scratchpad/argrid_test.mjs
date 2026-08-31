// Node harness for the ground grid's AR compositing.
//
// THE BUG: in passthrough the framebuffer's ALPHA is what the compositor reads to decide how
// much of the real room shows through. Ordinary SrcAlpha/OneMinusSrcAlpha blending applies to
// the alpha channel as well as to colour, so a half-alpha grid line drawn over the mesh LOWERS
// the destination alpha and the room comes through -- the grid was making the sculpt
// see-through rather than darkening it. matt: "punching a hole in the alpha".
//
// This does not merely grep for the factor names. It reads the factors out of Scene.js and then
// EVALUATES THE BLEND EQUATION with them, so a plausible-looking but wrong choice (ZeroFactor,
// or leaving alpha on the colour factors) fails on the number it produces. The invariant is one
// line: drawing the grid must never LOWER destination alpha.
//
// Run: node scratchpad/argrid_test.mjs
//   ARGRID_INJECT=alphablend  alpha goes back to the colour factors (the original bug)
//   ARGRID_INJECT=zeroalpha   a wrong "fix" that wipes alpha instead of preserving it
//   ARGRID_INJECT=depthwrite  the transparent grid writes depth again
//   ARGRID_INJECT=ghostorder  the ghost sorts with the meshes, so GreaterDepth never passes
//   ARGRID_INJECT=gridorder   the grid ties with the meshes and snaps in and out as you tumble
//   ARGRID_INJECT=gridbefore  the grid draws before the meshes, so the sculpt paints over the
//                             part of it that is in FRONT of the sculpt
//   ARGRID_INJECT=sliderdrift the slider writes both passes the SAME value, so the occluded
//                             half stops being the fainter one
//   ARGRID_INJECT=nopersist   the slider stops saving, so the setting is lost on reload
//   ARGRID_INJECT=noghost     the second pass stops being a ghost, so the sculpt hides the grid
//   ARGRID_INJECT=ghostblend  the ghost blends normally and punches the hole back in
import fs from 'fs';
import path from 'path';

const REPO = '/Users/mattestela/sculptxr';
let SRC = fs.readFileSync(path.join(REPO, 'src/Scene.js'), 'utf8');

const inject = process.env.ARGRID_INJECT || '';
if (inject === 'alphablend') {
  const a = `    this._groundGrid.material.blendSrcAlpha = THREE.OneFactor;
    this._groundGrid.material.blendDstAlpha = THREE.OneFactor;`;
  if (!SRC.includes(a)) throw new Error('inject alphablend: anchor moved');
  SRC = SRC.replace(a, `    this._groundGrid.material.blendSrcAlpha = THREE.SrcAlphaFactor;
    this._groundGrid.material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;`);
} else if (inject === 'zeroalpha') {
  const a = '    this._groundGrid.material.blendDstAlpha = THREE.OneFactor;';
  if (!SRC.includes(a)) throw new Error('inject zeroalpha: anchor moved');
  SRC = SRC.replace(a, '    this._groundGrid.material.blendDstAlpha = THREE.ZeroFactor;');
} else if (inject === 'ghostorder') {
  const a = '    this._groundGridGhost.renderOrder = 201;';
  if (!SRC.includes(a)) throw new Error('inject ghostorder: anchor moved');
  SRC = SRC.replace(a, '    this._groundGridGhost.renderOrder = 0;');
} else if (inject === 'gridorder') {
  const a = '    this._groundGrid.renderOrder = 200;';
  if (!SRC.includes(a)) throw new Error('inject gridorder: anchor moved');
  SRC = SRC.replace(a, '    this._groundGrid.renderOrder = 0;');
} else if (inject === 'gridbefore') {
  const a = '    this._groundGrid.renderOrder = 200;';
  if (!SRC.includes(a)) throw new Error('inject gridbefore: anchor moved');
  SRC = SRC.replace(a, '    this._groundGrid.renderOrder = -1;');
} else if (inject === 'sliderdrift') {
  const a = '      this._groundGridGhost.material.opacity = v * GRID_GHOST_FRACTION;';
  if (!SRC.includes(a)) throw new Error('inject sliderdrift: anchor moved');
  SRC = SRC.replace(a, '      this._groundGridGhost.material.opacity = v;');
} else if (inject === 'nopersist') {
  const a = "    getOptionsURL.saveOption?.('gridOpacity', v, 250);";
  if (!SRC.includes(a)) throw new Error('inject nopersist: anchor moved');
  SRC = SRC.replace(a, '');
} else if (inject === 'noghost') {
  const a = '  ghostMat.depthFunc = THREE.GreaterDepth;';
  if (!SRC.includes(a)) throw new Error('inject noghost: anchor moved');
  SRC = SRC.replace(a, '  ghostMat.depthFunc = THREE.LessEqualDepth;');
} else if (inject === 'ghostblend') {
  const a = '  ghostMat.blending = THREE.CustomBlending;';
  if (!SRC.includes(a)) throw new Error('inject ghostblend: anchor moved');
  SRC = SRC.replace(a, '  ghostMat.blending = THREE.NormalBlending;');
} else if (inject === 'depthwrite') {
  const a = '    this._groundGrid.material.depthWrite = false;';
  if (!SRC.includes(a)) throw new Error('inject depthwrite: anchor moved');
  SRC = SRC.replace(a, '    this._groundGrid.material.depthWrite = true;');
}

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

const read = (prop) => {
  const m = SRC.match(new RegExp('_groundGrid\\.material\\.' + prop + ' = (?:THREE\\.)?(\\w+);'));
  return m ? m[1] : null;
};

// The GL blend factors, as the functions they actually are.
const FACTOR = {
  OneFactor: () => 1,
  ZeroFactor: () => 0,
  SrcAlphaFactor: (s) => s,
  OneMinusSrcAlphaFactor: (s) => 1 - s,
  DstAlphaFactor: (s, d) => d,
  OneMinusDstAlphaFactor: (s, d) => 1 - d,
};
// result = src * F_src + dst * F_dst, clamped -- which is what the hardware does.
const blend = (srcF, dstF, s, d) =>
  Math.min(1, Math.max(0, s * FACTOR[srcF](s, d) + d * FACTOR[dstF](s, d)));

check('the grid blends with explicit, custom factors',
  read('blending') === 'CustomBlending', read('blending'));

const sA = read('blendSrcAlpha'), dA = read('blendDstAlpha');
check('the alpha channel has factors of its own',
  !!FACTOR[sA] && !!FACTOR[dA], sA + ' / ' + dA);

if (FACTOR[sA] && FACTOR[dA]) {
  // THE INVARIANT. A half-alpha grid line over a fully opaque sculpt must leave it opaque.
  const overMesh = blend(sA, dA, 0.5, 1.0);
  check('drawing the grid over the mesh does not lower its alpha',
    overMesh >= 1.0,
    'alpha ' + overMesh.toFixed(3) + ' after the grid crosses an opaque sculpt -- anything '
      + 'under 1 is the room showing through, which is the reported hole');
  // ...at every opacity the slider can reach, not just the default.
  const worst = [0.05, 0.25, 0.5, 0.75, 1].map((a) => blend(sA, dA, a, 1.0));
  check('...at any grid opacity the slider allows',
    worst.every((a) => a >= 1.0), worst.map((a) => a.toFixed(2)).join(','));
  // ...and over a mesh that is itself partly transparent.
  check('...and over a half-transparent mesh, which must not get MORE transparent',
    blend(sA, dA, 0.5, 0.5) >= 0.5, blend(sA, dA, 0.5, 0.5).toFixed(3));
  // But the grid must still be visible against the room, or the "fix" is just an invisible grid.
  const overRoom = blend(sA, dA, 0.5, 0.0);
  check('the grid is still drawn over empty space',
    overRoom > 0, 'alpha ' + overRoom.toFixed(3) + ' against passthrough -- a grid that '
      + 'preserves alpha by contributing none of its own is simply invisible');
}

// THE GHOST PASS. Fixing the alpha hole took the grid's visibility with it -- the hole WAS the
// visibility -- so a second pass draws the grid where the sculpt is in FRONT of it, faintly.
// Same idiom the bones use to stay readable inside a mesh.
{
  const gsA = (SRC.match(/ghostMat\.blendSrcAlpha = THREE\.(\w+);/) || [])[1];
  const gdA = (SRC.match(/ghostMat\.blendDstAlpha = THREE\.(\w+);/) || [])[1];
  check('there is a ghost pass, drawn only where something is nearer',
    /ghostMat\.depthFunc = THREE\.GreaterDepth;/.test(SRC),
    'without it the sculpt simply hides the grid, which is correct compositing and still not '
      + 'the "half mixed on the mesh" that was asked for');
  // ABSOLUTE, not a fraction. As a fraction it multiplied an already-low default -- 0.5 * 0.35
  // = 0.175 -- and against bright passthrough that reads as nothing at all, which is what "it
  // disappears as I go higher" actually was: the ghost drawing at a strength you cannot see.
  // FAINTER THAN THE VISIBLE PASS, and derived from it so one slider moves both. Two
  // independent opacities drift apart the moment either is touched.
  const frac = Number((SRC.match(/const GRID_GHOST_FRACTION = ([\d.]+);/) || [])[1]);
  check('...fainter than the visible pass, as a fraction of it',
    /ghostMat\.opacity = this\._groundGrid\.material\.opacity \* GRID_GHOST_FRACTION;/.test(SRC)
      && frac > 0 && frac < 1,
    'fraction ' + frac);
  check('...and the slider keeps the two in step through ONE setter',
    /setGridOpacity\(val\) \{/.test(SRC)
      && /_groundGridGhost\.material\.opacity = v \* GRID_GHOST_FRACTION;/.test(SRC),
    'a slider that writes only the visible pass leaves the ghost at the old strength');
  // Both halves, because either alone is useless: custom factors that NormalBlending ignores,
  // or CustomBlending pointed at factors that still reduce alpha.
  check('...and it carries the alpha rule too, or it reinstates the hole',
    /ghostMat\.blending = THREE\.CustomBlending;/.test(SRC)
      && !!FACTOR[gsA] && !!FACTOR[gdA] && blend(gsA, gdA, 0.5, 1.0) >= 1.0,
    'blending=' + ((SRC.match(/ghostMat\.blending = THREE\.(\w+);/) || [])[1])
      + '  alpha factors ' + gsA + ' / ' + gdA);
  // THE ORDERING IS THE FIX. GreaterDepth passes only where something nearer has ALREADY
  // written depth, so a ghost drawn before the sculpt is discarded every frame -- invisible,
  // not faint. And a grid left at renderOrder 0 ties with the meshes on bounding-sphere
  // distance (grid and default sculpt are both at the origin), so the sort flips as the view
  // tumbles and the grid snaps in and out at an angle threshold.
  const main = Number((SRC.match(/_groundGrid\.renderOrder = (-?\d+);/) || [])[1]);
  const ghost = Number((SRC.match(/_groundGridGhost\.renderOrder = (-?\d+);/) || [])[1]);
  check('the ghost is ordered AFTER the meshes, or GreaterDepth has nothing to test',
    ghost > 1,
    'ghost renderOrder ' + ghost + ' -- at 0 it ties with every mesh and is discarded');
  // BOTH passes go after the meshes. Ordering the main pass BEFORE them looks like the
  // opposite-and-therefore-safe choice and is not: it writes no depth, so drawn first it
  // cannot occlude anything and the sculpt paints over it even where the grid is NEARER.
  check('...and so is the main pass, so depth TESTING decides it rather than the sort',
    main > 1 && main < ghost,
    'main renderOrder ' + main + ' -- before the meshes it cannot occlude (no depth write) and '
      + 'the sculpt covers the grid in front of it; tied with them the sort flips as you tumble');
  check('...with the two exactly one step apart, as one paired decision',
    ghost - main === 1, main + ' -> ' + ghost);
  // UNDER THE VR PANELS. A ghost drawn with GreaterDepth shows wherever something is NEARER --
  // and a menu in front of the floor is exactly that -- so the panels must be ordered AFTER it
  // or the floor is painted over the UI. renderOrder is the only lever: the ghost cannot be
  // told to make an exception for one object.
  const PANEL = fs.readFileSync(path.join(REPO, 'src/gui/htmlvr/HTMLVRPanel.js'), 'utf8');
  const panelOrder = Number((PANEL.match(/this\.mesh\.renderOrder = (\d+);/) || [])[1]);
  check('the VR panels are ordered AFTER both grid passes',
    panelOrder > ghost && panelOrder > main,
    'panel renderOrder ' + panelOrder + ' vs grid ' + main + '/' + ghost
      + ' -- at 0 the panel draws first and the ghost paints the floor over the menu');
  check('...and the panel still depth-tests, so this is order and not a trick',
    /depthWrite: true,/.test(PANEL) && /depthTest: true,/.test(PANEL));
  check('...and the grid stays under the rig overlays too',
    ghost < 9996, 'bone ghosts sit at 9998');
  check('...and neither pass writes depth',
    (SRC.match(/depthWrite = false;/g) || []).length >= 2);
  check('the toggle drives both passes',
    /_groundGridGhost\.visible = !!this\._showGrid;/.test(SRC)
      && (SRC.match(/_groundGridGhost\.visible/g) || []).length >= 2,
    'one grid switch, two objects -- a ghost that ignores the toggle is a grid you cannot '
      + 'turn off');
}

// Colour is deliberately unchanged: the look over empty space was already right.
check('the COLOUR factors are the ordinary alpha blend, untouched',
  read('blendSrc') === 'SrcAlphaFactor' && read('blendDst') === 'OneMinusSrcAlphaFactor',
  read('blendSrc') + ' / ' + read('blendDst'));

// A transparent surface that writes depth occludes whatever sorts after it -- and every mesh in
// this app is transparent, so the grid was competing with the sculpt inside one pass.
check('the transparent grid does not write depth',
  read('depthWrite') === 'false',
  'depthWrite=' + read('depthWrite'));
check('...while its opacity still comes from the setting',
  /_groundGrid\.material\.opacity = getOptionsURL\(\)\.gridOpacity/.test(SRC));

// TUNED ONCE, NOT EVERY SESSION. matt settled on 0.2 in AR against a real room; a slider that
// forgets is a setting you re-make on every load.
const OPTS = fs.readFileSync(path.join(REPO, 'src/misc/getOptionsURL.js'), 'utf8');
const dflt = Number((OPTS.match(/getVal\('gridOpacity'\), 0\.0, 1\.0, ([\d.]+)\)/) || [])[1]);
check('the default grid opacity is the value that was actually judged good',
  dflt === 0.2, 'default ' + dflt);
check('...and moving the slider persists it',
  /getOptionsURL\.saveOption\?\.\('gridOpacity', v, \d+\)/.test(SRC),
  'setGridOpacity must write the setting, or the slider is forgotten on reload');
check('...debounced, since it fires on every frame of a drag',
  /saveOption\?\.\('gridOpacity', v, [1-9]\d*\)/.test(SRC));

console.log(failures ? '\n' + failures + ' FAILURE(S)' : '\nall checks passed');
process.exit(failures ? 1 : 0);
