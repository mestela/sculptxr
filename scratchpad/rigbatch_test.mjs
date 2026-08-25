// Node harness for the instanced rig visuals in src/editing/Skeleton.js.
//
// matt's frame timing put the judder squarely here: with a skeleton loaded, `draw` went 2.6ms
// to 11.3ms and the call count 23 to 185, while every other section stayed flat. A bone body
// and a joint dot were each their own Mesh, drawn twice for the xray ghost, so the call count
// grew with the rig.
//
// What can go wrong with instancing is not "it looks different" — it is BOOKKEEPING. Instances
// are positional, so a deleted joint that leaves its slot behind silently shifts every joint
// after it onto the wrong transform, and that reads as the rig falling apart rather than as a
// perf change.
import fs from 'fs';
import path from 'path';

const REPO = '/Users/mattestela/sculptxr';
const SRC = fs.readFileSync(path.join(REPO, 'src/editing/Skeleton.js'), 'utf8');
let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

// ── the two highest-count kinds are instanced ────────────────────────────────
check('the bone body is instanced, not a Mesh per joint',
  /bone: \{\s*\n\s*solid: batchSlot\(main, 'bone', boneGeometry, false\)/.test(SRC));
check('the joint dot is instanced too',
  /joint: \{\s*\n\s*solid: batchSlot\(main, 'joint', jointGeometry, false\)/.test(SRC));
check('...and the xray ghost is its own batch, not a second pass over the first',
  /'bone-ghost', boneGeometry, true/.test(SRC) && /'joint-ghost', jointGeometry, true/.test(SRC),
  'the ghost needs GreaterDepth and its own opacity, so it cannot share a material');

// ── the wireframe is MERGED, not instanced ───────────────────────────────────
//
// There is no InstancedLineSegments, so the edges go into one buffer that is transformed on the
// CPU each pass. That is a few thousand floats a frame against the fifty draw calls it removes.
check('the wireframe is a merged line batch',
  /lineBatchSlot\(main, 'wire', boneEdgeGeometry, false\)/.test(SRC)
    && /lineBatchSlot\(main, 'wire-ghost', boneEdgeGeometry, true\)/.test(SRC));
check('...with per-vertex colour, since a merged buffer has one material',
  /vertexColors: true, transparent: true, depthWrite: false/.test(SRC),
  'the joints tint differently and they now share a material');
check('...and the buffer is only rebuilt when the joint count moves',
  /if \(!pa \|\| pa\.array\.length !== need\)/.test(SRC),
  'reallocating every frame would cost more than the draw calls did');
check('...a hidden joint collapses rather than being removed',
  /_mSlot\.compose\(s\.position, s\.quaternion, s\.visible \? s\.scale : _sZero\)[\s\S]{0,400}?P\[o\] = _vLine\.x/.test(SRC),
  'the merged buffer is positional too');
check('the wireframe no longer joins the scene graph per joint',
  !/g\.add\(e\.wire\.solid/.test(SRC));

// ── the call sites did not have to change ─────────────────────────────────────
//
// The four hundred lines that place these things are delicate. A slot has to look enough like a
// Mesh that they keep working untouched.
{
  const i = SRC.indexOf('function makeSlot');
  const slot = SRC.slice(i, SRC.indexOf('\n}', i));
  for (const field of ['position', 'quaternion', 'scale', 'material', 'visible', 'updateMatrix'])
    check('a slot still answers to .' + field, slot.includes(field + ':') || slot.includes(field + '('));
  check('...and the placement code was left alone',
    /for \(const o of \[e\.joint\.solid, e\.joint\.ghost\]\) \{[\s\S]{0,200}?o\.material\.color\.setHex/.test(SRC),
    'if these had to be rewritten, the risky half of the change was not avoided');
}

// ── THE BOOKKEEPING, which is the part that can go wrong quietly ──────────────
check('slots are gathered from the LIVE entries, not held by the batch',
  /for \(const e of main\._skelVis\.values\(\)\)/.test(SRC)
    && !/b\.slots\.push/.test(SRC),
  'a batch that keeps its own list renumbers every joint after a deleted one');
check('an entry publishes ALL its slots for gathering',
  /e\._slots = \[e\.bone\.solid, e\.bone\.ghost, e\.joint\.solid, e\.joint\.ghost,\s*\n\s*e\.wire\.solid, e\.wire\.ghost\]/.test(SRC),
  'a slot left off this list is simply never drawn');
check('the flush runs AFTER the dead entries are disposed',
  SRC.indexOf('if (!live.has(id)) disposeEntry') < SRC.lastIndexOf('flushBatches(main)'),
  'flushing first publishes a joint that is about to be removed');

// A hidden joint must keep its slot, or everything after it shifts.
check('an invisible slot is scaled to zero, not dropped',
  /s\.visible \? s\.scale : _sZero/.test(SRC),
  'shortening the count to hide one instance renumbers the rest');

// ── growth ────────────────────────────────────────────────────────────────────
check('the buffers grow in powers of two',
  /while \(cap < n\) cap \*= 2;/.test(SRC),
  'InstancedMesh cannot be resized, so a rig gaining a joint would rebuild every add');
check('...and the old instance mesh is disposed when it is replaced',
  /old\.dispose\(\);/.test(SRC));

// ── the slots are not scene objects ───────────────────────────────────────────
check('slots are not added to the overlay group',
  !/g\.add\(e\.bone\.solid/.test(SRC) && !/g\.add\([^)]*e\.joint\.solid/.test(SRC),
  'a slot has no geometry or material; adding one to the scene does nothing good');
check('...and dispose does not try to free a slot',
  /for \(const p of \[e\.pinT, e\.pinG, e\.pinS, \.\.\.caps\]\)/.test(SRC),
  'a slot owns nothing to dispose, and calling dispose on one would throw');

// ── marker sizing is not driven by the POSE ──────────────────────────────────
//
// matt: pins popped a quarter larger for a few seconds during playback, then back. It was not
// the preselection - it was the scene unit, which is the largest mesh's BOUNDING SPHERE, and on
// a bound character that sphere grows and shrinks as the pose changes. Cached for 500ms, the
// rescaling arrived as a step rather than a drift, which is what read as a pop.
check('the scene unit is held while the rig is animating',
  /if \(main\._skelUnit && window\._animPlaying\) return main\._skelUnit;/.test(SRC),
  'a scene does not change size because something in it moved');
check('...but is still recomputed when nothing is playing',
  /now - main\._skelUnitAt < 500\) return main\._skelUnit;/.test(SRC),
  'freezing it outright would stop it tracking a sculpt that actually grew');

// ── preselection says "this one" without moving it ───────────────────────────
{
  const i = SRC.indexOf('const pinParts = [');
  const block = SRC.slice(i, SRC.indexOf('];', i));
  check('a preselected pin does not change size',
    !/pinHot \?/.test(block), block.replace(/\s+/g, ' ').slice(0, 90));
  check('...and preselection is still carried by colour',
    /o\.material\.color\.setHex\(pinHandColor \|\| \(pinHot \? HILITE_COLOR/.test(SRC),
    'dropping the scale must not drop the signal with it');
  check('...in the same yellow the joints use', /const HILITE_COLOR = 0xffe066;/.test(SRC));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
