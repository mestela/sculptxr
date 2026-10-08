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

const REPO = new URL('..', import.meta.url).pathname;
let SRC = fs.readFileSync(path.join(REPO, 'src/editing/Skeleton.js'), 'utf8');

// Defect injections (standing lesson 1):
//   RIG_INJECT=nullscount   nulls count towards the scene unit, so adding a PIN resizes the
//                           whole rig — the reported bug, exactly
//   RIG_INJECT=nosync       a matrix write is left unsynced to the three-side matrix
//   RIG_INJECT=widthfloor   the scene-unit floor goes back under bone width, so a short bone
//                           on a large rig comes out many times too fat
//   RIG_INJECT=unitreadspos the unit signature folds in an object's POSITION, so posing the
//                           scene re-measures it and the markers change size as things move
{
  const inj = process.env.RIG_INJECT || '';
  if (inj === 'nullscount') {
    const a = '    if (Skeleton.isJoint(m) || m._isNull) continue;';
    if (SRC.split(a).length - 1 !== 2) throw new Error('inject nullscount: anchor moved');
    SRC = SRC.replace(a, '    if (false) continue;');   // the signature loop is the first one
  } else if (inj === 'nosync') {
    // A matrix write that leaves the three-side matrix behind. The two then disagree until
    // something refreshes them, and the next world-preserving read measures the stale one.
    const a = '            Skeleton.syncThree(pinObj);';
    if (!SRC.includes(a)) throw new Error('inject nosync: anchor moved');
    SRC = SRC.replace(a, '');
  } else if (inj === 'widthfloor') {
    const a = 'function boneWidth(len) { return len * 0.12; }';
    if (!SRC.includes(a)) throw new Error('inject widthfloor: anchor moved');
    SRC = SRC.replace(a, 'function boneWidth(len, jr) { return Math.max(len * 0.12, jr * 0.6); }');
  } else if (inj === 'unitreadspos') {
    const a = '    sig = (Math.imul(sig, 16777619) ^ (Math.round(ss * 4096) | 0)) | 0;';
    if (!SRC.includes(a)) throw new Error('inject unitreadspos: anchor moved');
    SRC = SRC.replace(a, a + '\n    sig = (Math.imul(sig, 16777619) ^ (Math.round(sm[12] * 4096) | 0)) | 0;');
  }
}
let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

// ── the two highest-count kinds are instanced ────────────────────────────────
// Anchored on the CALL, not on its position in the object literal: the slot is wrapped in
// physVariant now (a second batch holding the physics-bone shape), and an anchor that spelled out
// the whole line failed on a change that left the instancing exactly as it was.
check('the bone body is instanced, not a Mesh per joint',
  /batchSlot\(main, 'bone', boneGeometry, false\)/.test(SRC)
    && /bone: \{/.test(SRC));
// The shaft used to be a Mesh per bone, on the reasoning that its per-bone taper "one instanced
// draw cannot express". That was true of UNIFORMS and not of the thing itself: the taper is two
// half-extent vectors, which are per-instance ATTRIBUTES, and the rotation it also wanted is
// recoverable from instanceMatrix because the scale baked in there is (1, length, 1). So the
// shaft is batched now too, and capsules cost four draw calls instead of a hundred and ninety-two.
check('the capsule shaft is instanced, with its taper as per-instance attributes',
  /shaft: makeCapsuleShaftSlots\(main\)/.test(SRC)
    && /attribute vec3 aHA;/.test(SRC) && /attribute vec3 aHB;/.test(SRC),
  'a mesh per bone is six draw calls per bone');
// A hidden slot is a ZERO matrix by design, and normalize() of a zero column is NaN -- undefined
// behaviour that happens to draw nothing on one GPU and is not guaranteed to on another.
check('...and the taper is skipped for a collapsed instance rather than going NaN',
  /float _len0 = length\(_im\[0\]\);/.test(SRC) && /if \(_len0 > 1e-8\) \{/.test(SRC),
  'a hidden capsule feeds NaN vertices to the GPU');
check('...deriving the rotation from the instance rather than sending it',
  /mat3 _rot = mat3\(normalize\(_im\[0\]\), normalize\(_im\[1\]\), normalize\(_im\[2\]\)\);/.test(SRC),
  'uRot and uRotInv would be eighteen more floats per instance to say what the matrix says');
// InstancedMesh does not manage custom attributes, so they have to be resized with the batch.
// The half-extents come from module scratch arrays reused for every bone, and the flush reads
// them once at the END of the pass -- so a stored REFERENCE gives every capsule the last bone's
// taper. It looks exactly like the taper being inverted.
check('...copying the half-extents into the slot rather than referencing the scratch',
  /o\._ha\[0\] = hA\[0\] \* SHAFT_INSET;/.test(SRC)
    && !/o\._ha = hA; o\._hb = hB;/.test(SRC),
  'every shaft ends up wearing the last bone in the rig taper');
// Coincident surfaces at 14 segments interleave their facets, so a joint seam breaks into a
// stipple of two colours. Strict nesting has an unambiguous depth order and does not depend on
// the depth buffer's precision to hold. matt: "their radii are so closely aligned, their
// tessellation is becoming apparent where they intersect."
// The seam between two capsules is the intersection of two FACETED surfaces, so its zigzag is
// the facet sagitta, r(1 - cos(pi/n)): 2.5% of the radius at the 14 segments these had, 0.06% at
// 56. Instanced, so this is one geometry rather than one per bone.
check('the capsules are tessellated finely enough that the seam is not a sawtooth',
  // The counts are a SETTING now (the mobile-VR knob), so what is pinned is the DEFAULT and the
  // fact that both geometries take it — a hardcoded low number would be the regression here.
  /const CAP_SEGMENTS_DEFAULT = 56;/.test(SRC)
    && /new THREE\.CylinderGeometry\(1, 1, 1, n, 1, true\)/.test(SRC)
    && /new THREE\.SphereGeometry\(1, n,/.test(SRC),
  'at 14 segments the zigzag is about a pixel wide at a working zoom');
check('...and inset, so the shaft never shares a surface with the spheres it enters',
  /const SHAFT_INSET = 0\.97;/.test(SRC) && /const HEAD_INSET = 0\.98;/.test(SRC));
// ── SHARPNESS REACHES THE DRAWN CAPSULE, NOT ONLY THE SKIN ───────────────────────────────────
//
// The exponent is per joint and the capsules are INSTANCED from one shared sphere and one shared
// cylinder — so it has to arrive as an instanced attribute and be applied in the vertex shader,
// or a boxy joint would look round right up until Make Skin disagreed with it. Both shaders skip
// the pow() entirely at p = 2, which is what keeps the common rig free.
check('the shaft blends BOTH ends\' sharpness',
  /attribute float aPA;/.test(SRC) && /attribute float aPB;/.test(SRC)
    && /float _p = mix\(aPA, aPB, _t\);/.test(SRC),
  'a boxy palm running into a round finger has to taper in sharpness as well as in size');
check('...and the end spheres take their own joint\'s',
  /attribute float aP;/.test(SRC) && /function sharpMaterialInstanced/.test(SRC));
check('...and both skip the cost when the joint is round',
  (SRC.match(/> 2\.001/g) || []).length >= 2,
  'pow() three times per vertex on every rig would be the price of a feature almost nobody uses');
check('...and the attributes default to 2, not 0',
  /new Float32Array\(cap\)\.fill\(2\)/.test(SRC),
  'a zero exponent is not a shape; an unwritten slot must draw as the ellipsoid it always was');

check('...and the head sphere sits inside the one the bone above already drew there',
  // The tuple carries the joint too now (each cap takes its own sharpness), so the trailing
  // entries are open — what is pinned is the INSET, which is what this check is about.
  /\[e\.cap\.a, _cA, hA, HEAD_INSET[^\]]*\],\s*\[e\.cap\.b, _cB, hB, 1[^\]]*\]/.test(SRC)
    && /o\.scale\.set\(ph\[0\] \* k, ph\[1\] \* k, ph\[2\] \* k\);/.test(SRC),
  'every joint in a chain is drawn twice over, by the bone that ends there and the one that starts');
check('the END spheres get their own geometry too, now that they carry an attribute',
  /const needsOwnGeo = isShaftKey\(key\)/.test(SRC)
    && /startsWith\('capEnd'\)/.test(SRC)
    && /if \(needsOwnGeo\) geo = geo\.clone\(\);/.test(SRC),
  'four batches sharing one sphere overwrite each other\'s aP and resize it to whichever grew '
    + 'last, so the batch holding the most instances reads past the end and stops drawing');

// Instanced attributes live on the GEOMETRY, and the capsule geometries are shared singletons --
// so four shaft batches sharing one would write their taper over each other.
check('...on a geometry of its own, since the shaft geometry is a shared singleton',
  // The clone now covers ends as well as shafts (see above), so the shaft's half of it is
  // asserted through the same predicate rather than by its old standalone line.
  /const needsOwnGeo = isShaftKey\(key\)/.test(SRC)
    && /if \(needsOwnGeo\) geo = geo\.clone\(\);/.test(SRC),
  'the shaft batches overwrite one another taper data');
check('...and the taper attributes grow with the batch',
  /if \(isShaftKey\(key\)\) ensureTaperAttrs\(m, cap\);/.test(SRC),
  'a rig that gains a joint writes taper data past the end of the buffer');
check('the joint dot is instanced too',
  /batchSlot\(main, 'joint', jointGeometry, false\)/.test(SRC) && /joint: \{/.test(SRC));
// ── THE PHYSICS-BONE SHAPE IS A BATCH, NOT A MESH ────────────────────────────
//
// A flagged joint and its chain draw a box and a beam instead of a sphere and an octahedron, and
// the cheap way to do that is a second INSTANCED batch the slot is routed to per frame -- the
// same shape as the existing keyHi trick. The expensive way, and the one to catch here, is a
// Mesh per physics joint, which would put the per-joint draw calls back one rig at a time.
check('the physics shapes are batches the slot is routed to',
  /physVariant\(main, batchSlot\(main, 'joint'/.test(SRC)
    && /physVariant\(main, batchSlot\(main, 'bone'/.test(SRC)
    && !/new THREE\.Mesh\(jointPhysGeometry/.test(SRC));
check('...chosen by a per-frame flag, with highlight routing still ahead of it',
  /slot\._phys && slot\._keyPhys/.test(SRC) && /slot\._hi && slot\._keyHi/.test(SRC));
check('...and the wireframe overlay follows the same shape',
  /'wire-phys', bonePhysEdgeGeometry/.test(SRC),
  'a box drawn with the octahedron edge lines is worse than either on its own');
// The whole chain, not only the flagged joint: what the marker answers is "does this bone swing".
check('every joint under a flagged root is marked, not just the root',
  /for \(let n = j; n; n = n\._parentMesh\) if \(n\._physicsRoot\) return true/.test(SRC));
// ...BUT THE BONE IS ASKED ABOUT THE PARENT, NOT THE JOINT.
//
// A joint owns the bone that ENDS at it, so the joint's own answer marks the bone one link too
// high -- flag the elbow and the shoulder-to-elbow bone became a beam. The flagged joint is the
// anchor and does not translate, so the first thing that actually swings is the bone BELOW it.
check('the bone shape is one link below the flag, not one above',
  /function physicsBoneGoverned\(j\) \{\s*\n\s*return physicsGoverned\(j && j\._parentMesh\);/.test(SRC));
check('...and the bone and its wireframe both read that one, while the joint reads its own',
  /e\.bone\.solid\._phys = e\.bone\.ghost\._phys = phBone;/.test(SRC)
    && /e\.wire\.solid\._phys = e\.wire\.ghost\._phys = phBone;/.test(SRC)
    && /e\.joint\.solid\._phys = e\.joint\.ghost\._phys = physicsGoverned\(j\);/.test(SRC),
  'the wireframe following the solid is what keeps a beam from being drawn with octahedron edges');

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
// NOT REBUILT ON EVERY CHANGE, AND NEVER SHRUNK. The original rule here was "only when the
// joint count moves" -- an exact-fit buffer, reallocated whenever n changed. That is once per
// size rather than once per frame, which was the point at the time, but on the node renderer a
// replacement buffer is a new render object and therefore a new compiled pipeline: matt's
// compile report caught rigbatch:wire-ghost at 0v, 2v, 24v and 480v in a single session, at
// 30-40ms each. So the invariant is now the same one the instanced batches hold -- grow only,
// geometrically, and let the draw range decide what is drawn.
check('...and the wire buffer only ever grows, in the same steps the batches use',
  /if \(!pa \|\| pa\.array\.length < need\)/.test(SRC)
    && /while \(cap < need\) cap \*= BATCH_GROW;/.test(SRC),
  'an exact-fit buffer is a new pipeline every time the joint count changes');
check('...and the draw range still decides what is drawn',
  /g\.setDrawRange\(0, n \* verts\);/.test(SRC),
  'a capacity buffer without a draw range draws the slack as garbage triangles');
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
    /for \(const o of \[e\.joint\.solid, e\.joint\.ghost\]\) \{[\s\S]{0,500}?o\.material\.color\.setHex/.test(SRC),
    'if these had to be rewritten, the risky half of the change was not avoided');
}

// ── THE BOOKKEEPING, which is the part that can go wrong quietly ──────────────
check('slots are gathered from the LIVE entries, not held by the batch',
  /for \(const e of main\._skelVis\.values\(\)\)/.test(SRC)
    && !/b\.slots\.push/.test(SRC),
  'a batch that keeps its own list renumbers every joint after a deleted one');
// The literal list IS the check: a slot left off it is simply never drawn, and nothing else
// notices. Every batched part has to appear here, capsule ends included.
check('an entry publishes ALL its slots for gathering',
  /e\._slots = \[e\.bone\.solid, e\.bone\.ghost, e\.joint\.solid, e\.joint\.ghost,\s*\n\s*e\.wire\.solid, e\.wire\.ghost,\s*\n\s*e\.cap\.shaft\.solid, e\.cap\.shaft\.ghost,\s*\n\s*e\.cap\.a\.solid, e\.cap\.a\.ghost, e\.cap\.b\.solid, e\.cap\.b\.ghost\]/.test(SRC),
  'a slot left off this list is simply never drawn');
// A batched part must NOT also be added to the scene, or it is drawn twice: once as an instance
// and once as a mesh that nothing places any more.
check('...and no capsule part is also a scene child',
  !/g\.add\(e\.cap/.test(SRC) && !/\[e\.cap\.shaft, e\.cap\.a, e\.cap\.b\]\) g\.add/.test(SRC),
  'an instanced part added to the group is drawn twice');
check('the flush runs AFTER the dead entries are disposed',
  SRC.indexOf('if (!live.has(id)) disposeEntry') < SRC.lastIndexOf('flushBatches(main)'),
  'flushing first publishes a joint that is about to be removed');

// A hidden joint must keep its slot, or everything after it shifts.
check('an invisible slot is scaled to zero, not dropped',
  /s\.visible \? s\.scale : _sZero/.test(SRC),
  'shortening the count to hide one instance renumbers the rest');

// ── growth ────────────────────────────────────────────────────────────────────
// GEOMETRIC GROWTH FROM A CAPACITY A RIG FITS IN. This used to pin `cap *= 2` literally, from
// when a batch started at 1 and doubled. That is the wrong invariant twice over: the factor is
// a tuning number, and the STARTING capacity is the one that matters. On the node renderer a
// replacement InstancedMesh is a new RenderObject, so every rebuild compiles fourteen pipelines
// in one frame -- starting at 1 put that frame at joints 1, 2, 4, 8, 16 and 32, which is the
// stutter matt kept reporting while drawing chains. What must hold is that the growth is
// multiplicative (so it terminates and rebuilds get rarer) and that a whole ordinary rig fits
// without a single rebuild.
const cap0 = /const BATCH_CAP0 = (\d+);/.exec(SRC);
const grow = /const BATCH_GROW = (\d+);/.exec(SRC);
check('the batches start big enough for an ordinary rig',
  !!cap0 && parseInt(cap0[1], 10) >= 24,
  'a small starting capacity rebuilds every batch, and every pipeline, mid-chain');
check('...and grow multiplicatively when one does not fit',
  !!grow && parseInt(grow[1], 10) >= 2 && /while \(cap < n\) cap \*= BATCH_GROW;/.test(SRC),
  'an additive step rebuilds every batch a fixed number of joints apart, forever');
check('...from the same constant the batch was created with',
  /new THREE\.InstancedMesh\(geo, capMat \|\| mat, BATCH_CAP0\)/.test(SRC)
    && /return \{ mesh: m, cap: BATCH_CAP0, ghost/.test(SRC),
  'a literal here and a constant there is how the first rebuild lands on joint one');
// ── the warm list must not drift from the real one ────────────────────────────
// A pipeline is keyed on geometry as well as material, so the rig's batches are warmed on their
// own meshes before a session; a batch missing from that table is a pipeline compiled INSIDE the
// session, on the first bone, which is invisible from anywhere but a headset running boneTrace.
// Listing the keys twice is the risk this covers.
const warmKeys = new Set();
for (const m of SRC.matchAll(/\['([\w-]+)',\s*\w+Geometry,\s*(?:true|false)\]/g)) warmKeys.add(m[1]);
const liveKeys = new Set();
for (const m of SRC.matchAll(/(?:batchSlot|physVariant|lineBatchSlot|physLineVariant)\(main,[\s\S]{0,60}?'([\w-]+)'/g)) {
  liveKeys.add(m[1]);
}
// batchSlot's optional keyHi is a second batch on the same line, and needs warming too.
for (const m of SRC.matchAll(/batchSlot\(main, '[\w-]+', \w+, (?:true|false), '([\w-]+)'\)/g)) liveKeys.add(m[1]);
check('the prewarm table is not empty', warmKeys.size >= 12, `${warmKeys.size} keys`);
const missing = [...liveKeys].filter((k) => !warmKeys.has(k));
check('every batch a rig creates is in the prewarm table', missing.length === 0,
  'not warmed: ' + missing.join(', '));

check('...and the old instance mesh is disposed when it is replaced',
  /old\.dispose\(\);/.test(SRC));

// ── the slots are not scene objects ───────────────────────────────────────────
check('slots are not added to the overlay group',
  !/g\.add\(e\.bone\.solid/.test(SRC) && !/g\.add\([^)]*e\.joint\.solid/.test(SRC),
  'a slot has no geometry or material; adding one to the scene does nothing good');
// This rule USED to require the capsules in that list, from when they were real meshes. They
// were instanced two versions later and the rule went on passing, pinning the line that then
// threw: a slot answers to `.material` and has no `userData` at all, so disposing one blew up
// on the frame after a joint entry went away. matt: "i could delete some and it was fine, but
// then deleted some more and got this error: Cannot read properties of undefined (reading
// 'vcMat')". Only the pin markers are still meshes.
check('...and dispose does not try to free a slot',
  /for \(const p of \[e\.pinB, e\.pinS, e\.pinR\]\)/.test(SRC)
    && !/\.\.\.caps/.test(SRC),
  'a slot owns nothing to dispose, and calling dispose on one would throw');
check('...and the capsule slots are not gathered for disposal either',
  !/const caps = e\.cap \?/.test(SRC),
  'that list is what put slots into the dispose loop');

// ── marker sizing is not driven by the POSE ──────────────────────────────────
//
// matt: pins popped a quarter larger for a few seconds during playback, then back. It was not
// the preselection - it was the scene unit, which is the largest mesh's BOUNDING SPHERE, and on
// a bound character that sphere grows and shrinks as the pose changes. Cached for 500ms, the
// rescaling arrived as a step rather than a drift, which is what read as a pop.
//
// Holding it during playback only covered playback; a pose changed by hand did it too, and so
// did anything else that touched the scene between ticks. The timer is gone now and the value
// is latched against a signature — see the section at the bottom, which runs it. This check
// stays because the playback hold is still the cheapest short-circuit and losing it would put
// a signature walk on every frame of every playing rig.
// The multiplier suffix is allowed here: this check is about the SHORT-CIRCUIT (the latch is
// returned without a re-measure), not about the exact expression. The multiplier is required on
// every return by its own check further down.
check('the scene unit is held while the rig is animating',
  /if \(main\._skelUnit && window\._animPlaying\) return main\._skelUnit\b/.test(SRC),
  'a scene does not change size because something in it moved');
check('...and it can still be re-measured when the scene really does change',
  /main\._skelUnitSig = sig;/.test(SRC) && /let best = 0;/.test(SRC),
  'freezing it outright would stop it tracking a sculpt that actually grew');

// ── preselection says "this one" without moving it ───────────────────────────
{
  const i = SRC.indexOf('const pinParts = [');
  const block = SRC.slice(i, SRC.indexOf('];', i));
  check('a preselected pin does not change size',
    !/pinHot \?/.test(block), block.replace(/\s+/g, ' ').slice(0, 90));
  check('...and preselection is still carried by colour',
    /o\.material\.color\.setHex\(pinHeld \? SELECT_COLOR : \(pinHot \? HILITE_COLOR/.test(SRC),
    'dropping the scale must not drop the signal with it');
  // The same CONSTANT, not the same hex: a highlight is one colour across the rig, and the
  // check that pinned it to a literal reported a deliberate repaint as a regression.
  check('...in the same colour the joints use',
    /setHex\(jointHeld \|\| isSel \? SELECT_COLOR\s*\n?\s*: \(isHi \? HILITE_COLOR/.test(SRC)
      && /setHex\(pinHeld \? SELECT_COLOR : \(pinHot \? HILITE_COLOR/.test(SRC),
    'the two must read one constant, or they drift apart');
  // ...AND SELECTED OUTRANKS PRESELECTED, on the joint and on the bone alike. Preselect was tested
  // first, so pointing at something already selected repainted it yellow.
  check('a selected thing stays selected-coloured under the cursor',
    /jointHeld \|\| isSel \? SELECT_COLOR/.test(SRC)
      && /\(boneHeld \|\| boneSel\) \? SELECT_COLOR/.test(SRC),
    'the highlight flicked between the two as the hand moved');
}


// ── THE SCENE UNIT IS LATCHED ────────────────────────────────────────────────
//
// Every marker in the rig is sized from Skeleton.sceneUnit, so anything that moves it resizes
// the whole skeleton at once — which is how a user ends up reporting that "adding a few
// constraints made the bones 10x bigger". It used to be re-measured on a 500ms timer from the
// largest mesh's bounding sphere, and a bounding sphere is not a fixed property of an object:
// it grows as the pose opens out. Now the value is latched and only a SIGNATURE over what is
// in the scene releases it.
//
// The signature is lifted and RUN, because the whole property is about what it does and does
// not read, and no amount of matching its spelling says that.
{
  const i = SRC.indexOf('  let sig = 2166136261 | 0;');
  const j = SRC.indexOf('if (main._skelUnit && main._skelUnitSig === sig)', i);
  check('the unit signature is liftable', i > 0 && j > i, 'sceneUnit moved');
  if (i > 0 && j > i) {
    const lifted = SRC.slice(i, j);
    const Skeleton = { isJoint: (m) => !!m._isBone, joints: (mn) => mn.getMeshes().filter((m) => m._isBone) };
    const sigOf = new Function('main', 'Skeleton', 'Math',
      lifted + '\nreturn sig;').bind(null);

    let nextId = 1;
    const mesh = (o = {}) => {
      const m = new Float64Array(16);
      m[0] = m[5] = m[10] = m[15] = 1;
      return { _id: nextId++, getID() { return this._id; },
        getModelSpaceMatrix() { return this.m; }, m, ...o };
    };
    const scene = (list) => ({ getMeshes: () => list });
    const sig = (list) => sigOf(scene(list), Skeleton, Math);

    const sculpt = mesh();
    const base = sig([sculpt]);

    // THE REPORTED BUG. A pin is a null; a null is not the size of the scene.
    const pin = mesh({ _isNull: true, _isPinTarget: true });
    check('adding a pin does not move the scene unit', sig([sculpt, pin]) === base,
      'this is the one that made the rig jump when constraints were added');
    check('nor do several', sig([sculpt, pin, mesh({ _isNull: true }), mesh({ _isNull: true })]) === base);
    const joint = mesh({ _isNull: true, _isBone: true });
    check('nor does adding a joint, while there is a mesh to measure',
      sig([sculpt, joint]) === base);

    // POSING. The signature must not read a position — not the object's, not a joint's.
    const posed = mesh();
    posed.m[12] = 12.5; posed.m[13] = -3; posed.m[14] = 7;
    posed._id = sculpt.getID();
    check('moving something does not move the scene unit', sig([posed]) === base,
      'a scene does not change SIZE because something in it moved');

    // SCALING, which is deliberate and SHOULD carry the markers with it.
    const scaled = mesh();
    scaled._id = sculpt.getID();
    scaled.m[0] = scaled.m[5] = scaled.m[10] = 2;
    check('scaling an object DOES move it', sig([scaled]) !== base,
      'that one is a deliberate act, and the markers belong at the new size');

    // Structure.
    check('adding a real mesh moves it', sig([sculpt, mesh()]) !== base);
    check('removing one moves it', sig([]) !== base);

    // With nothing to measure, the fallback is the rig's own extent — which legitimately grows
    // as a rig is drawn, so the joint COUNT is in the signature. Its positions still are not.
    const j1 = mesh({ _isNull: true, _isBone: true });
    const j2 = mesh({ _isNull: true, _isBone: true });
    const rigOnly = sig([j1]);
    check('with no mesh, drawing another joint re-measures', sig([j1, j2]) !== rigOnly,
      'the rig is its own ruler then, and it is still being drawn');
    const j1moved = mesh({ _isNull: true, _isBone: true });
    j1moved._id = j1.getID(); j1moved.m[13] = 40;
    check('...but posing that rig still does not', sig([j1moved]) === rigOnly);
    check('and a pin on a mesh-less rig is still not the ruler',
      sig([j1, mesh({ _isNull: true, _isPinTarget: true })]) === rigOnly);
  }
  // The latch itself: measuring and then ignoring the result would pass every check above.
  // Same as the playback latch above: the SHORT-CIRCUIT is what is pinned, so the multiplier
  // suffix is allowed. That it is present on this return too is checked in its own block.
  check('the measurement is skipped entirely when the signature is unchanged',
    /if \(main\._skelUnit && main\._skelUnitSig === sig\) return main\._skelUnit\b/.test(SRC));
  check('and there is no timer left to release it',
    !/_skelUnitAt/.test(SRC),
    'a 500ms re-measure is what made the old jump arrive as a step');
}


// ── THE RIG FALLBACK IS A LOCAL MEASURE, NOT THE RIG'S SPREAD ────────────────
//
// With no sculpt to measure, the unit comes from the rig itself. It used to be the greatest
// distance from the joint CENTROID — the rig's overall reach — and that is not a size: it grows
// with every limb added. The same rig drawn as a 7-joint stub and loaded as a 17-joint body
// measured 42.4 and 132.6, a 3x jump in every marker, bone and snap radius. matt: "the pin
// handle sizes are 4x what they used to be."
//
// The fix is the MEDIAN BONE LENGTH, and the property that matters is that it is INVARIANT to
// how many limbs the rig has. So the block is lifted and RUN against two rigs that differ only
// in limb count, and the answer must be the same.
{
  const i = SRC.indexOf('  if (best <= 1e-6) {\n    from = \'rig\';');
  const j = SRC.indexOf('  // Empty scene: no sculpt AND no joints yet', i);
  // THE MEASUREMENT MOVED OUT OF THE BRANCH, so the lift has to bring it along. It is a shared
  // helper now (markerUnit needs the same number), and lifting only the branch would run
  // `best = medianBoneLength(main)` against nothing — a ReferenceError, which is a test that
  // fails by crashing instead of by asserting. Both halves, concatenated, so what runs below is
  // still the shipped arithmetic and not a paraphrase of it.
  // BOTH HELPERS NOW. `medianBoneLength` delegates to a shared `median`, so lifting only the
  // former runs it against nothing -- a ReferenceError inside the lifted block, which kills the
  // harness mid-file. run_all scores by OUTPUT WORDING, so a harness that dies before printing
  // its tally is counted as PASSING: this crash read as green until it was run on its own.
  const gi = SRC.indexOf('function median(vals) {');
  const gj = gi < 0 ? -1 : SRC.indexOf('\n}\n', gi) + 3;
  const mi = SRC.indexOf('function medianBoneLength(main) {');
  const mj = mi < 0 ? -1 : SRC.indexOf('\n}\n', mi) + 3;
  check('the shared median is liftable', gi > 0 && gj > gi, 'median() moved');
  check('the rig fallback is liftable', i > 0 && j > i, 'the fallback moved');
  check('...and the median it calls is liftable with it', mi > 0 && mj > mi,
    'medianBoneLength moved');
  if (i > 0 && j > i && mi > 0 && mj > mi && gi > 0 && gj > gi) {
    const lifted = SRC.slice(gi, gj) + '\n' + SRC.slice(mi, mj) + '\n' + SRC.slice(i, j);
    // A joint is a mesh with a parent and a position; boneLength is the parent-to-joint
    // distance, and 0 for a root. The stub mirrors that contract exactly.
    //
    // `jointPos` and the two scratch vectors are here for the INJECTED spread measure, not for
    // the shipped one: without them the injection throws inside the lifted block and the harness
    // dies before it can report the failure, which is a test that fails by crashing rather than
    // by asserting. The vectors are plain objects with the three methods the spread uses.
    const vec = (x, y, z) => ({
      x, y, z,
      set(a, b, c) { this.x = a; this.y = b; this.z = c; return this; },
      add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; },
      divideScalar(s) { this.x /= s; this.y /= s; this.z /= s; return this; },
      distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); },
    });
    const _pA = vec(0, 0, 0), _pB = vec(0, 0, 0);
    const Skeleton = {
      joints: (mn) => mn.getMeshes().filter((m) => m._isBone),
      jointPos: (jt, out) => out.set(jt._x, jt._y, jt._z),
      boneLength: (mn, jt) => {
        const p = jt._parentMesh;
        if (!p || !p._isBone) return 0;
        return Math.hypot(jt._x - p._x, jt._y - p._y, jt._z - p._z);
      },
    };
    const fallbackOf = new Function('main', 'Skeleton', 'best', 'from', '_pA', '_pB',
      lifted + '\nreturn best;').bind(null);
    const scene = (list) => ({ getMeshes: () => list });
    const joint = (x, y, z, parent) => ({
      _isBone: true, _isNull: true, _x: x, _y: y, _z: z, _parentMesh: parent || null,
    });
    // `limbs` chains of four bones, each 10 long, hung off one root at the origin. The chains
    // are laid out along y so they are genuinely far apart — the spread measure would see that
    // and the median must not.
    const build = (limbs) => {
      const r = joint(0, 0, 0, null);
      const all = [r];
      for (let n = 0; n < limbs; n++) {
        let prev = r;
        for (let k = 1; k <= 4; k++) {
          const jt = joint(10 * k, n * 40, 0, prev);
          prev = jt;
          all.push(jt);
        }
      }
      return all;
    };
    const oneLimb = build(1);
    const fourLimbs = build(4);
    const a = fallbackOf(scene(oneLimb), Skeleton, 0, 'mesh', _pA, _pB);
    const b = fallbackOf(scene(fourLimbs), Skeleton, 0, 'mesh', _pA, _pB);
    check('the rig fallback is a bone length, not the rig\'s reach',
      Math.abs(a - 10) < 1e-9, 'expected the 10-long bone, got ' + a);
    check('...and it does not grow when limbs are added',
      Math.abs(a - b) < 1e-9,
      'one limb measured ' + a + ', four measured ' + b + ' — the spread bug is back');
    // A lone root has no bone to measure, so it must fall through rather than report 0.
    check('a rig with no bones falls through to the camera',
      fallbackOf(scene([joint(0, 0, 0, null)]), Skeleton, 0, 'mesh', _pA, _pB) <= 1e-6);
  }
}


// ── A BONE'S WIDTH IS ITS OWN BUSINESS ───────────────────────────────────────
//
// matt: "one hand bone has gone huge again", with rigUnit() reporting the scene unit had been
// measured exactly once and never moved — so the unit was not what changed, something
// downstream was multiplying it. It was the floor under boneWidth: no thinner than the joint
// dot, which is jr = unit * JOINT_R_FRAC, ONE number for the whole rig. On a rig with no sculpt
// the unit is the rig's own half-extent; matt's was 57.9, so the floor sat at 1.04 and every
// bone shorter than 8.7 units was pinned to the same width. A spine looks fine at that. A hand
// bone is thirty times too fat.
{
  const m = /function boneWidth\(([^)]*)\) \{ return ([^;]+); \}/.exec(SRC);
  check('boneWidth is liftable', !!m, 'the helper moved');
  if (m) {
    const args = m[1].split(',').map((a) => a.trim()).filter(Boolean);
    check('bone width takes ONLY the length', args.length === 1 && args[0] === 'len',
      'got (' + m[1] + '): anything else is the whole rig reaching into one bone');
    // The extra argument is supplied when the signature still has one, so an injected floor
    // fails as a WRONG WIDTH rather than as a NaN — a check that only catches the missing
    // argument would pass against a floor fed from somewhere else.
    const JR = 57.8582 * 0.03;   // matt's rig: unit 57.9, no sculpt to measure
    const raw = new Function(m[1] || 'len', 'return (' + m[2] + ');');
    const w = (len) => (args.length > 1 ? raw(len, JR) : raw(len));

    // Proportional, so a bone reports its own length and two bones of different lengths look
    // different. That is the only thing the width is for.
    check('width is proportional to length', Math.abs(w(10) / w(1) - 10) < 1e-9,
      'w(1)=' + w(1) + ' w(10)=' + w(10));
    check('...at every scale', Math.abs(w(0.1) / w(0.01) - 10) < 1e-9);

    // THE REPORTED BUG, as a ratio. A hand bone next to a spine bone on the same rig must stay
    // in proportion to it however big the rig is; a floor makes them converge on one width.
    const spine = 8, hand = 0.3;
    check('a short bone stays in proportion to a long one on the same rig',
      Math.abs((w(spine) / w(hand)) - (spine / hand)) < 1e-9,
      'ratio ' + (w(spine) / w(hand)).toFixed(2) + ' vs the lengths’ ' + (spine / hand).toFixed(2));
    check('...and a very short one does not blow up',
      w(0.05) < w(0.06) && w(0.05) > 0, 'w(0.05)=' + w(0.05));
  }
  // The scene unit must not reach the bone at all now. `jr` still sizes the pin markers and the
  // isolated-joint dot; a bone body is not one of its customers.
  check('no drawn bone is sized by the scene unit',
    !/boneWidth\([^)]*jr/.test(SRC),
    'that is how one number for the whole rig ended up setting one bone’s width');
}


// ── EVERY MATRIX WRITE IS SYNCED ─────────────────────────────────────────────
//
// There are TWO matrices for every mesh: the SculptGL `_matrix` and the three-side
// `tm.matrix`. A write to the first that does not push through to the second leaves them
// disagreeing, and the damage lands later and somewhere else — `setMeshParent`, `attach()`
// and `getModelSpaceMatrix` on a parented mesh all read the THREE side, so the next
// world-preserving operation preserves a world transform that was never true. FrameGroup
// carries a note about this exact mistake SHRINKING a duplicated mesh, which is why a
// gradual collapse sends you here.
//
// So: a structural rule rather than a behavioural one, because the failure is not local to
// the write and no unit of behaviour contains it. Every setModelSpaceMatrix / getMatrix()
// write in the rig files must be followed by syncThree within a few lines.
{
  const files = [['Skeleton.js', SRC],
    ['IKSolver.js', fs.readFileSync(path.join(REPO, 'src/editing/IKSolver.js'), 'utf8')]];
  for (const [name, src] of files) {
    const lines = src.split('\n');
    const unsynced = [];
    lines.forEach((l, i) => {
      const writes = /\.setModelSpaceMatrix\(/.test(l)
        || /mat4\.copy\(\s*\w+\.getMatrix\(\)/.test(l)
        || /\.setMatrix\(/.test(l);
      if (!writes) return;
      // syncThree is what pushes it across. Allow it on the same line or just after, and
      // allow the definition of syncThree itself, which IS the push.
      if (/syncThree|Skeleton\.syncThree = /.test(l)) return;
      const after = lines.slice(i, i + 4).join('\n');
      if (/syncThree|matrixAutoUpdate|tm\.matrix\.fromArray/.test(after)) return;
      unsynced.push((i + 1) + ': ' + l.trim());
    });
    check(name + ': every matrix write is pushed through to the three-side matrix',
      unsynced.length === 0,
      unsynced.join('  |  '));
  }
}

// ── ONE PALETTE, TWO PIPELINES ────────────────────────────────────────────────────────────
//
// three converts a material's colour on output; SculptGL writes vertex colours to the
// framebuffer as they stand. The identity palette feeds BOTH, so it has to be authored in one
// space and handed to each in the space that pipeline expects. It wasn't: setHSL defaults to
// the WORKING (linear) space, so the palette went into three unconverted and was converted a
// second time on the way out -- a 0.1225 dark channel reaching the screen at 0.384. matt: "if i
// turn on weights on the skin, they're fully saturated... the capsules feel like they're at
// least half the saturation of the weight and bones colours."
{
  const SKIN = fs.readFileSync(path.join(REPO, 'src/editing/Skinning.js'), 'utf8');
  const CAGE = fs.readFileSync(path.join(REPO, 'src/editing/WeightCage.js'), 'utf8');
  // Anchored on the ARGUMENT that matters, not on the whole call: the hue is no longer
  // `i / BONE_PALETTE_SIZE` -- the palette skips the arcs reserved for preselection and selection
  // (see chainHue) -- and spelling out the first argument failed on a change that left the colour
  // space exactly where it was.
  // Only the colour SPACE is pinned here. Hue comes from chainHue and lightness is a named
  // constant now (the chains were pulled 20% down so the state colours pop), so spelling either
  // out would fail this check on a change it is not about.
  check('the identity palette states its colour space',
    /setHSL\([^)]*THREE\.SRGBColorSpace\)/.test(SRC),
    "setHSL's default is the working space, which is linear -- the colour is then converted twice");
  // ...and the reserved arcs are real, or a chain can wear the selection colour again.
  check('the chain palette keeps clear of the preselect and select hues',
    /const CHAIN_HUE_EXCLUDE = \[0\.134, 0\.444\];/.test(SRC)
      && /function chainHue\(i, n\)/.test(SRC)
      && !/hueGap\(i \/ BONE_PALETTE_SIZE, a \/ BONE_PALETTE_SIZE\)/.test(SRC),
    'the avoidance maths has to compare the hues the slots actually have, not their indices');
  check('...and the unmanaged pipeline has its own accessor',
    /Skeleton\.boneColorSRGB = function/.test(SRC) && /convertLinearToSRGB\(\)/.test(SRC));
  check('...which the skin-weight colours use',
    /Skeleton\.boneColorSRGB\(main, j\)/.test(SKIN),
    'these are SculptGL vertex colours, not a three material');
  check('...and so do the weight cages',
    /Skeleton\.boneColorSRGB\(main, owner\)/.test(CAGE));
}

// ── A DELETED PIN IS NOT A PIN ────────────────────────────────────────────────────────────
//
// Deleting a mesh takes its three mesh out of its parent and leaves every other reference
// intact, ON PURPOSE, so undo can put the same object back. So `_isPinTarget` -- a property of
// the mesh -- still answers true for a deleted pin, and every guard written as "is it a pin
// target" walked straight over the dangling reference. matt deleted a multi-selection of pins
// from the outliner and the next frame threw in setModelSpaceMatrix.
{
  const IKS = fs.readFileSync(path.join(REPO, 'src/editing/IKSolver.js'), 'utf8');
  const MESH = fs.readFileSync(path.join(REPO, 'src/mesh/Mesh.js'), 'utf8');
  check('the visuals read the joint\'s pin through a liveness test',
    /function livePin\(joint\)/.test(SRC) && /return \(tm && !tm\.parent\) \? null : p;/.test(SRC),
    'a mesh out of the scene graph is deleted, whatever its flags still say');
  check('...and the per-frame pin draw uses it',
    /const pinObj = livePin\(j\);/.test(SRC),
    'this is the line that crashed');
  check('...and so does the solver, from its own copy of the rule',
    /const tm = p\.getThreeMesh && p\.getThreeMesh\(\);\s*\n\s*if \(tm && !tm\.parent\) return null;/.test(IKS));
  check('...and no rig draw still tests _isPinTarget alone',
    !/pinObj && pinObj\._isPinTarget/.test(SRC),
    'that test is what let the dangling reference through');
  // The same class of crash, closed where it actually threw: local IS model space for something
  // that is not in the graph, which is exactly what the flat case already does.
  check('a detached mesh converts model space as a top-level one, not by throwing',
    /if \(!tm \|\| !wg \|\| !tm\.parent \|\| tm\.parent === wg\)/.test(MESH),
    "tm.parent.updateWorldMatrix on a deleted mesh is the reported TypeError");
}

// ── THE RIG SCALE IS A VIEW, AND IT SURVIVES A RELOAD ────────────────────────
//
// The unit is measured from the scene and is correct, but not always the size you want to work
// at: a rig on a large sculpt gets markers in proportion and too small to aim at. So there is a
// multiplier over the measured unit — a VIEW preference, stored with the other settings and
// never written into a .sxr, so the same file opens at the same real size on any machine and
// only the markers move. matt: "how can i change the global scene units? ... this should be a
// preference in the settings pane."
//
// Two things have to hold, and the second is the one that was missing: the multiplier is applied
// at the RETURN (so it is a view of the measurement, not part of it), and it is SEEDED from the
// saved option at boot (or a scale dialled in last session is silently forgotten).
{
  // Applied at EVERY return, over the latched measurement — not folded into `_skelUnit`, which is
  // the measurement itself. Folding it in would invalidate the signature and force a re-measure
  // every time the slider moved.
  //
  // EVERY return, not just the last. There are three ways out of sceneUnit — the playback latch,
  // the signature latch, and a fresh measurement — and the first cut only multiplied the last.
  // The signature latch is the one that runs on every frame after the first, so the slider moved
  // the number and no marker: the exact "it does nothing" report. This counts the returns and
  // requires the multiplier on all of them.
  const unitFn = /Skeleton\.sceneUnit = function \(main\) \{([\s\S]*?)\n\};/.exec(SRC);
  check('sceneUnit is liftable', !!unitFn, 'sceneUnit moved');
  check('a flat screen defaults to half the headset size, and the slider is a preference on top', /const FLAT_SCREEN_RIG_MUL = 0\.5;/.test(SRC));
  if (unitFn) {
    const returns = unitFn[1].match(/return [^;]+;/g) || [];
    check('...and EVERY return applies the multiplier',
      returns.length > 0 && returns.every((r) => /unitMul\(main\)|sceneUnitMul/.test(r))
        && /function unitMul\(main\) \{\s*return Skeleton\.sceneUnitMul \* \(main && main\._xrSession \? XR_RIG_MUL : FLAT_SCREEN_RIG_MUL\);/.test(SRC),
      'a bare return bypasses the slider — got: ' + returns.join(' | '));
  }
  check('...and the latch stores the bare measurement',
    /main\._skelUnit = best > 1e-6 \? best : 1;/.test(SRC),
    'the latched value must not already carry the multiplier');
  // The setter clamps to a positive finite number, so a bad option cannot zero every marker.
  const setter = /Skeleton\.setSceneUnitMul = function \(mul\) \{([\s\S]*?)\n\};/.exec(SRC);
  check('the multiplier setter is liftable', !!setter, 'setSceneUnitMul moved');
  if (setter) {
    // The setter is DEFINED, then CALLED — the body's own `return` is inside the function, so
    // the outer body has to invoke it to get the clamped value back.
    const run = new Function('mul', 'Skeleton',
      'Skeleton.sceneUnitMul = 1;\n' + setter[0] + '\nreturn Skeleton.setSceneUnitMul(mul);');
    const S = {};
    check('a positive multiplier is taken as given', run(2.5, S) === 2.5, 'got ' + run(2.5, S));
    check('...and a zero or negative one falls back to 1, not to nothing',
      run(0, S) === 1 && run(-3, S) === 1, 'a 0 multiplier would make every marker invisible');
    check('...and a non-number falls back to 1', run('wide', S) === 1 && run(NaN, S) === 1);
  }
  // SEEDED AT BOOT. The slider writes the live value and persists it; without a read-back on
  // load the stored preference is dead and every marker returns at 1x.
  const GL = fs.readFileSync(path.join(REPO, 'src/SculptGL.js'), 'utf8');
  check('the saved rig scale is seeded into the live multiplier at boot',
    /Skeleton\.setSceneUnitMul\(_ipadOpts\.rigScale\)/.test(GL),
    'the slider persists rigScale but nothing reads it back — the preference is forgotten on reload');
  // ...and the option is declared, or saveOption silently stops persisting it.
  const OPTS = fs.readFileSync(path.join(REPO, 'src/misc/getOptionsURL.js'), 'utf8');
  check('the rig scale option is declared',
    /options\.rigScale = queryNumber\(getVal\('rigScale'\)/.test(OPTS),
    'an undeclared key is dropped by saveOption and nothing says so');
  // THE SLIDER MUST REBUILD THE RIG, NOT JUST REPAINT IT. Every marker's size is computed inside
  // updateVisuals and written to the instanced batches there; render() alone re-draws the batches
  // with the scales they already hold, so the number moves and nothing on screen does. This is
  // the bug the first cut shipped: the slider called render() and the rig did not resize.
  const MENU = fs.readFileSync(path.join(REPO, 'src/gui/htmlvr/MainMenuPanel.js'), 'utf8');
  const rigCb = /wireScaleSlider\(el, q\('#mm-rig-scale'\)[\s\S]*?\n  \}, paint\);/.exec(MENU);
  check('the rig scale slider is wired', !!rigCb, 'the slider moved');
  if (rigCb) {
    check('...and it rebuilds the rig, not just repaints it',
      /Skeleton\.updateVisuals\(main\)/.test(rigCb[0]),
      'render() alone leaves the instanced batches at their old scale — the slider does nothing');
  }
}

// EVERYTHING DRAWN ON A LIMB IS A MULTIPLE OF THE JOINT IT BELONGS TO.
//
// sceneUnit has two sources that are not the same kind of measurement: with a sculpt in the scene
// it is the biggest mesh's BOUNDING RADIUS, and with no sculpt it is the MEDIAN BONE LENGTH. On
// the bundled human base those are 44.0 and 8.0 -- five and a half times apart -- so the same rig
// got markers five times bigger the moment a body appeared beside it. Every marker constant in
// Skeleton.js was tuned against one of those two and then applied against the other, three
// separate times, and each round cost a headset session to find out that the constant was fine
// and the unit under it had moved.
//
// The joint dot always escaped it, because `jd` is measured PER JOINT and capped by its own bone
// -- the only marker in the file not measured by the scene at all, and the only one never
// reported wrong. So the pins and the text hang off `jd` now and there is no second ruler left to
// drift. matt: "I think the text label size and pin size should be multipliers based on joint
// size."
{
  const SKEL = fs.readFileSync(path.join(REPO, 'src/editing/Skeleton.js'), 'utf8');
  // Comments stripped throughout: the notes in that file name the units they moved AWAY from, on
  // purpose. A test that cannot tell code from commentary reports the explanation as the bug.
  const CODE = SKEL.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

  // ONE implementation of the median, still, for sceneUnit's own fallback and the diagnostic.
  check('the median has one implementation, shared by everything that needs one',
    /function median\(vals\) \{/.test(CODE)
      && (CODE.match(/\.sort\(\(a, b\) => a - b\)/g) || []).length === 1,
    'a second copy of the median is a second ruler waiting to drift');
  check("...and sceneUnit's rig fallback uses it",
    /from = 'rig';\s*\n\s*best = medianBoneLength\(main\);/.test(CODE));
  // AND NO THIRD UNIT. `markerUnit` was the previous cure -- the median, handed to the labels --
  // and it was the right diagnosis with the wrong fix: it gave the rig a third ruler and left the
  // text answering to something the joints did not.
  check('there is no separate marker unit any more', !/markerUnit/.test(CODE),
    'a third ruler for the markers is the bug this replaced, not the fix');

  // A ROOT IS NOT A SMALLER JOINT.
  //
  // `_boneRadius` is the radius of the bone ENDING at a joint, so a root has none and falls back
  // to `unit * ROOT_RADIUS_FRAC` -- an unrelated formula against an unrelated ruler, landing at
  // about HALF what its own children get (0.66 against 1.32 on the human base). Every marker on
  // the root is sized from it, so the root's name was visibly smaller than every other name on
  // the rig. matt: "i noticed the label on the root joint is smaller than all the others."
  //
  // Measured by the widest bone LEAVING it instead. Built in the pass that already walks every
  // joint's parent, so it costs nothing, and it is the DRAWN radius only -- `_boneRadius` is the
  // capsule the skin binds to and must not move.
  // (The root stand-in that used to size the dot is gone: every joint dot is one size now, so a root
  // is no longer a special case. The capsule radius the skin binds to is untouched.)
  check('the dot no longer follows its capsule: no stand-in, no own-radius cap',
    !/rootStandIn/.test(CODE) && !/Math\.min\(jr, ownR \* 0\.6\)/.test(CODE) && !/_jointRadius > 0 \? j\._jointRadius : bR/.test(CODE),
    'a dot sized by its joint\'s capsule is two things saying "size" at once');

  // THE TEXT. One number for both sprites, off the joint, times the slider.
  // ONE HEIGHT FOR EVERY LABEL ON THE RIG. Sized per joint the names came out different on every
  // bone, which reads as the labels being broken rather than as the joints being different -- a
  // name is something you READ. matt: "labels should all be the same size, not measured per
  // joint." Still measured by the joint, though: the MEDIAN of the joint radii, so it is the size
  // of a typical joint on this rig and not a scene unit sneaking back in.
  check('every label on the rig is one height',
    /const labelH = median\(joints\.map\(jointDotRadius\)\) \* LABEL_R_FRAC \* Skeleton\.labelSizeMul;/.test(CODE)
      && (CODE.match(/const _n?h = labelH;/g) || []).length === 2,
    'a name and the length beside it must never be two sizes, and neither must two names');
  check('...computed once per draw, not once per joint',
    (CODE.match(/const labelH = /g) || []).length === 1);
  // And the dot radius itself has ONE definition, because the per-joint markers and the median
  // above both need it -- two copies is how this file's rulers drifted apart every other time.
  check('the joint dot radius has one definition',
    /const jointDotRadius = \(j\) => \{\s*const L = shortestBone\.get\(j\.getID\(\)\);\s*return L > 1e-9 \? Math\.min\(jr, L\) : jr;\s*\};/.test(CODE)
      && /const jd = jointDotRadius\(j\);/.test(CODE),
    'the loop and the label median must not measure a joint two different ways');
  // THE PINS. Same rule, same joint, their own slider -- and the triad and the rotation-only
  // marker keep their proportion to each other, so a pin does not change shape with its mode.
  const pinParts = /const pinParts = \[([\s\S]*?)\];/.exec(CODE);
  check('the pin parts are liftable', !!pinParts, 'the pin block moved');
  if (pinParts) {
    check('...and every one is sized by its own joint, times the slider',
      /const pinR = jd \* PIN_R_FRAC \* Skeleton\.pinSizeMul;/.test(CODE)
        && /jd \* PIN_SOFT_R_FRAC \* Skeleton\.pinSizeMul/.test(pinParts[1])
        && !/jr \*/.test(pinParts[1]),
      'a pin on a scene ruler swamps every joint smaller than the average one');
  }
  check('the pin leader rides the pin it links, slider and all',
    /if \(gap > pinR \* [\d.]+\)/.test(CODE) && /dashSize = pinR \* [\d.]+;/.test(CODE)
      && /gapSize = pinR \* [\d.]+;/.test(CODE),
    'dashes that do not shrink with the pin read as a solid line');
  // The name's offset exists to CLEAR THE DOT, so it is measured with what the dot was drawn at.
  check("the name clears the dot by the dot's own radius",
    /addScaledVector\(_up, jd \* [\d.]+\)/.test(CODE),
    'on a whole-rig figure the text floats above a dot that is not that big');
  // The pick zone is taken from the drawn sizes, so it follows the slider without being told.
  check('the pin pick radius is still taken from the drawn parts',
    /for \(const \[, on, size\] of pinParts\) if \(on\) r = Math\.max\(r, size\);/.test(CODE),
    'a pick zone on its own number is a pin that does not mean what it looks like');

  // ── THE TWO SLIDERS ────────────────────────────────────────────────────────
  //
  // These exist because the constants above were re-tuned three times and every round was a
  // headset session. matt: "give me sliders in settings next to rig size that are controls for
  // pin size, label size... i'll set what looks like good values, then you can make them
  // defaults." A slider that does not persist, or does not seed at boot, is a value he has to set
  // again every launch -- the same round trip in a different costume.
  const setters = [['pin', 'setPinSizeMul', 'pinSizeMul'],
                   ['label', 'setLabelSizeMul', 'labelSizeMul']];
  for (const [name, setter, field] of setters) {
    check('the ' + name + ' size multiplier has a setter',
      new RegExp('Skeleton\\.' + setter + ' = function \\(mul\\) \\{').test(CODE));
    check('...and it defaults to 1',
      new RegExp('Skeleton\\.' + field + ' = 1;').test(CODE));
  }
  // The clamp guards the way setSceneUnitMul does: a zero or a NaN here makes every pin and every
  // label vanish, which reads as the rig breaking rather than as a bad number.
  const guard = /const _posMul = \(v, cur\) => \{([\s\S]*?)\n\};/.exec(SKEL);
  check('a bad multiplier cannot zero the markers', !!guard);
  if (guard) {
    const run = new Function('v', 'cur',
      'const _posMul = (v, cur) => {' + guard[1] + '\n};\nreturn _posMul(v, cur);');
    check('...a positive multiplier is taken as given', run(2.5, 1) === 2.5);
    check('...and zero, negative, NaN and a string all fall back',
      run(0, 1) === 1 && run(-3, 1) === 1 && run(NaN, 1) === 1 && run('wide', 1) === 1,
      'a 0 multiplier would make every pin and label invisible');
  }
  const OPT = fs.readFileSync(path.join(REPO, 'src/misc/getOptionsURL.js'), 'utf8');
  check('both options are declared, or saveOption drops them silently',
    /options\.pinScale\s+= queryNumber\(getVal\('pinScale'\)/.test(OPT)
      && /options\.labelScale = queryNumber\(getVal\('labelScale'\)/.test(OPT),
    'an undeclared key is dropped by saveOption and nothing says so');
  const GL = fs.readFileSync(path.join(REPO, 'src/SculptGL.js'), 'utf8');
  check('...and both are seeded into the live values at boot',
    /Skeleton\.setPinSizeMul\(_ipadOpts\.pinScale\)/.test(GL)
      && /Skeleton\.setLabelSizeMul\(_ipadOpts\.labelScale\)/.test(GL),
    'a size dialled in last night has to be the size the first marker is drawn at');
  const MENU2 = fs.readFileSync(path.join(REPO, 'src/gui/htmlvr/MainMenuPanel.js'), 'utf8');
  check('both sliders are in the Rig section beside Rig Scale',
    /id="mm-pin-scale"/.test(MENU2) && /id="mm-label-scale"/.test(MENU2)
      && MENU2.indexOf('id="mm-rig-scale"') < MENU2.indexOf('id="mm-pin-scale"')
      // The NEXT section title after Rig Scale, searched forward from it -- "Ground Plane" as a
      // bare string occurs earlier in the file for an unrelated control, and searching for that
      // put the section boundary 77k characters BEFORE the block being checked.
      && MENU2.indexOf('id="mm-label-scale"')
         < MENU2.indexOf('mm-section-title">Ground Plane', MENU2.indexOf('id="mm-rig-scale"')),
    'filed away from Rig Scale is filed where nobody will look for it');
  // Read from the LIVE value, not the options snapshot -- the same trap Rig Scale hit: the
  // snapshot is only refreshed on load, so the slider jumps back mid-drag on a repaint.
  check('...and both read the live multiplier when the panel is built',
    /const pinScale\s+= Skeleton\.pinSizeMul \?\? 1;/.test(MENU2)
      && /const labelScale\s+= Skeleton\.labelSizeMul \?\? 1;/.test(MENU2));
  // updateVisuals, not render: the sizes are written into the instanced batches inside that call.
  for (const id of ['mm-pin-scale', 'mm-label-scale']) {
    const cb = new RegExp("wireScaleSlider\\(el, q\\('#" + id + "'\\)[\\s\\S]*?\\n  \\}, paint\\);").exec(MENU2);
    check('the ' + id + ' slider rebuilds the rig, not just repaints it',
      !!cb && /Skeleton\.updateVisuals\(main\)/.test(cb[0]),
      'render() alone leaves the batches at the size they already hold');
    check('...and persists what it set',
      !!cb && /getOptionsURL\.saveOption\('(pin|label)Scale'/.test(cb[0]));
  }
}

// THE BONE-DRAW CURSOR IS THE JOINT IT PREVIEWS.
//
// Two markers make up that cursor -- a dot, replaced by a DISC while the symmetry snap is hot
// (`o.visible = !snapPlane`), so they are one marker and must be one size. Both had size rules of
// their own, and both drifted away from the joints around them:
//
//   the dot  was the bare `jr` (a fraction of the scene unit), while a DRAWN joint has been
//            capped by its own radius since the finger-joint work -- `min(jr, ownR * 0.6)`. On an
//            ordinary limb bone that is ~1.7x too big and at finger scale ~17x. matt, in a
//            headset at Rig Scale 1x: "the drawn joints are correct... but the sphere drawn on
//            the end of the controller is huge. at the very least i would expect it to be drawn
//            the same size as the joints."
//   the disc was a fixed 0.01m of ROOM, so it tracked neither the Rig Scale slider (turn it down
//            and every other marker shrank while this did not -- it read as the cursor GROWING)
//            nor the dot it stands in for.
//
// Both now come from the radius the joint ABOUT TO BE MADE will be given, run through the same
// cap updateVisuals uses. A cursor with its own size rule is a cursor that will drift again.
{
  const SKEL = fs.readFileSync(path.join(REPO, 'src/editing/Skeleton.js'), 'utf8');
  const prev = /Skeleton\.showPreview = function \(main, fromPos, toPos, hot\) \{([\s\S]*?)\n\};/.exec(SKEL);
  check('showPreview is liftable', !!prev, 'showPreview moved');
  if (prev) {
    const body = prev[1];
    // ONE SIZE: the preview dot is the same bare `jr` every drawn joint dot is.
    check('the drawn joint dot is jr, shrunk only to its shortest bone', /Math\.min\(jr, L\)/.test(SKEL));
    check('...and the preview dot follows the same rule', /const jd = previewLen > 1e-9 \? Math\.min\(jr, previewLen\) : jr;/.test(body),
      'a preview with a size rule of its own will drift from the joints it becomes');
    // (The preview no longer measures the joint it will make: the dot is one size, so there is nothing to measure.)
    check('...and addJoint still stores exactly that',
      /mesh\._boneRadius = len \* radiusFrac\(\);/.test(SKEL)
        && /mesh\._boneRadius = unit \* ROOT_RADIUS_FRAC;/.test(SKEL),
      'addJoint changed its default radius and the preview was left behind');
    // The dot and the disc are ONE marker: the disc replaces the dot rather than joining it, so
    // it has to be drawn at the dot's radius and not at a constant of its own.
    check('the dot is drawn at the capped size', /o\.scale\.setScalar\(jd\);/.test(body));
    check('...and the disc that replaces it takes the same radius',
      /disc\.scale\.setScalar\(jd\);/.test(body),
      'a room-fixed disc tracks neither the Rig Scale slider nor the dot it stands in for');
    check('...and the disc really does REPLACE the dot',
      /o\.visible = !snapPlane;/.test(body),
      'if they are drawn together they are two markers and may legitimately differ in size');
    // Nothing left measuring the cursor in metres of room.
    check('no room-fixed constant remains in the cursor', !/DISC_RADIUS_M/.test(SKEL),
      'a constant in the room cannot track a marker measured in the model');
  }
}

// THE LABEL SITS BESIDE ITS BONE, NOT A SCENE-UNIT AWAY FROM IT.
//
// The length/name label was nudged off the shaft by a fixed world-Y offset of `jr * 1.6` — a
// fraction of the SCENE UNIT. Two things were wrong with that. It was not perpendicular to the
// bone, so on a near-vertical bone the nudge ran ALONG it and the label slid toward one end.
// And it scaled with the scene unit, so raising the Rig Scale slider pushed the text further
// from the bone on every frame. matt: "when alter the slider the text still moves away from the
// center of each bone." The offset is now perpendicular to the bone and sized from the bone's
// own width, which does not move when the marker scale does.
{
  const SKEL = fs.readFileSync(path.join(REPO, 'src/editing/Skeleton.js'), 'utf8');
  const place = /e\.label\.sprite\.position\.copy\(_pA\)[\s\S]*?;/.exec(SKEL);
  check('the label placement is liftable', !!place, 'the label moved');
  if (place) {
    check('...and the nudge is perpendicular to the bone, not world up',
      /addScaledVector\(_perp,/.test(place[0]),
      'a world-Y nudge runs ALONG a near-vertical bone and slides the label to one end');
    check('...and it is sized from the bone, not the scene unit',
      /boneWidth\(len\)/.test(place[0]) && !/jr \* 1\.6/.test(place[0]),
      'a scene-unit offset drifts off the bone as the Rig Scale slider moves');
  }
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
