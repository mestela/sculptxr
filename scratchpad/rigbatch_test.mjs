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
check('the bone body is instanced, not a Mesh per joint',
  /bone: \{\s*\n\s*solid: batchSlot\(main, 'bone', boneGeometry, false\)/.test(SRC));
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
  /o\._ha\[0\] = hA\[0\]; o\._ha\[1\] = hA\[1\]; o\._ha\[2\] = hA\[2\];/.test(SRC)
    && !/o\._ha = hA; o\._hb = hB;/.test(SRC),
  'every shaft ends up wearing the last bone in the rig taper');
// Instanced attributes live on the GEOMETRY, and the capsule geometries are shared singletons --
// so four shaft batches sharing one would write their taper over each other.
check('...on a geometry of its own, since the shaft geometry is a shared singleton',
  /if \(isShaftKey\(key\)\) geo = geo\.clone\(\);/.test(SRC),
  'the shaft batches overwrite one another taper data');
check('...and the taper attributes grow with the batch',
  /if \(isShaftKey\(key\)\) ensureTaperAttrs\(m, cap\);/.test(SRC),
  'a rig that gains a joint writes taper data past the end of the buffer');
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
//
// Holding it during playback only covered playback; a pose changed by hand did it too, and so
// did anything else that touched the scene between ticks. The timer is gone now and the value
// is latched against a signature — see the section at the bottom, which runs it. This check
// stays because the playback hold is still the cheapest short-circuit and losing it would put
// a signature walk on every frame of every playing rig.
check('the scene unit is held while the rig is animating',
  /if \(main\._skelUnit && window\._animPlaying\) return main\._skelUnit;/.test(SRC),
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
    /setHex\(jointHeld \? SELECT_COLOR\s*\n?\s*: \(isHi \? HILITE_COLOR/.test(SRC)
      && /setHex\(pinHeld \? SELECT_COLOR : \(pinHot \? HILITE_COLOR/.test(SRC),
    'the two must read one constant, or they drift apart');
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
  check('the measurement is skipped entirely when the signature is unchanged',
    /if \(main\._skelUnit && main\._skelUnitSig === sig\) return main\._skelUnit;/.test(SRC));
  check('and there is no timer left to release it',
    !/_skelUnitAt/.test(SRC),
    'a 500ms re-measure is what made the old jump arrive as a step');
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
  check('the identity palette states its colour space',
    /setHSL\(i \/ BONE_PALETTE_SIZE, 0\.95, 0\.55, THREE\.SRGBColorSpace\)/.test(SRC),
    "setHSL's default is the working space, which is linear -- the colour is then converted twice");
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

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
