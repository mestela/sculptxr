// Node harness for WEIGHT CAGES — roadmap #50.
//
// matt's framing: bake the capsule to a MESH, parent it to the bone, and measure the skin
// against that. A mesh is sculptable with the brush stack that already exists, so almost
// nothing new gets built -- and the roadmap's objection (a distance-to-volume query needs an
// accelerator) is about PER-FRAME cost and does not apply to a one-off bind.
//
// The one thing that had to change is the ranking. The capsule bind divides by each capsule's
// own radius so a thin finger cannot outbid a fat torso by being nearer the surface; a cage has
// no radius. SIGNED distance replaces it: inside is negative, most negative wins. That is the
// number this harness is really about, so it is computed, not asserted.
//
// Run: node scratchpad/weightcage_test.mjs
//   WC_INJECT=unsigned    the sign is dropped, so outside-but-close beats inside
//   WC_INJECT=nobroad     the bounding-box broadphase is removed
//   WC_INJECT=triples     faces go back to triangle triples, which SculptGL cannot read
//   WC_INJECT=nobuffers   the index buffer is never uploaded, so the mesh draws nothing
//   WC_INJECT=translucent a baked capsule goes translucent again, which reads worse than opaque
//   WC_INJECT=firstwins   ties are taken by the first cage rather than the deepest
//   WC_INJECT=drawnonly   the Capsules button hides only the drawn overlay, not the baked meshes
//   WC_INJECT=halfhide    hiding a cage sets one of the two visibility flags, not both
//   WC_INJECT=bothcaps    the drawn capsules keep drawing over the baked ones
import fs from 'fs';
import path from 'path';

const REPO = '/Users/mattestela/sculptxr';
const THREE = await import(path.join(REPO, 'node_modules/three/build/three.module.js'));
let SRC = fs.readFileSync(path.join(REPO, 'src/editing/WeightCage.js'), 'utf8');
let SKEL_INJ = false;
let SCENE_INJ = false;

const inject = process.env.WC_INJECT || '';
const cut = (a, b, n) => {
  if (!SRC.includes(a)) throw new Error('inject ' + n + ': anchor moved');
  SRC = SRC.replace(a, b);
};
if (inject === 'unsigned') {
  cut('  return bestSign * Math.sqrt(best);', '  return Math.sqrt(best);', inject);
} else if (inject === 'nobroad') {
  cut(`  if (px < bb[0] - slack || py < bb[1] - slack || pz < bb[2] - slack
   || px > bb[3] + slack || py > bb[4] + slack || pz > bb[5] + slack) return Infinity;`, '', inject);
} else if (inject === 'triples') {
  // Faces go back to raw triangle triples, which SculptGL cannot read -- the mesh then has no
  // valid faces and the bake puts nothing in the scene.
  cut('      if (lo.pole) faces.push(a, c, d, Utils.TRI_INDEX);       // fan at the first pole\n      else if (hi.pole) faces.push(a, b, c, Utils.TRI_INDEX);  // fan at the last\n      else faces.push(a, b, c, d);',
    '      if (a !== b) faces.push(a, b, c);\n      if (c !== d) faces.push(a, c, d);', inject);
} else if (inject === 'noloop') {
  cut('  lengthSegs = Math.max(2, lengthSegs || 2);', '  lengthSegs = 1;', inject);
} else if (inject === 'worldremove') {
  SCENE_INJ = true;
} else if (inject === 'greycage') {
  cut('    const col = Skeleton.boneColor(main, p);', '    const col = { r: 0.5, g: 0.5, b: 0.5 };', inject);
} else if (inject === 'hiddenparent') {
  // Not in this file: the defect lives in Skeleton, so it is injected there.
  SKEL_INJ = true;
} else if (inject === 'nobuffers') {
  // Just the upload: the two calls are no longer adjacent (the colour push sits between them),
  // and the previous two-line anchor went dead the moment that was added.
  cut('    cage.updateBuffers();', '', inject);
} else if (inject === 'translucent') {
  cut('WeightCage.OPACITY = 1;', 'WeightCage.OPACITY = 0.45;', inject);
} else if (inject === 'firstwins') {
  cut('      if (d < bestD) { bestD = d; bestJoint = cages[c].joint; }',
    '      if (bestD === Infinity) { bestD = d; bestJoint = cages[c].joint; }', inject);
}

let SKEL_DRAW_INJ = '';
if (inject === 'bothcaps') SKEL_DRAW_INJ = inject;
let PANEL_INJ = '';
if (inject === 'drawnonly') PANEL_INJ = inject;
else if (inject === 'halfhide') {
  cut('    const t = c.getThreeMesh?.();\n    if (t) t.visible = !!on;', '', inject);
}

// Geometry.distance2PointTriangle is real code and the whole measurement rests on it, so it is
// lifted rather than stubbed.
const GEO = fs.readFileSync(path.join(REPO, 'src/math3d/Geometry.js'), 'utf8');
const geoBody = GEO.split('\n').filter((l) => !/^import /.test(l))
  .join('\n').replace(/^export default Geometry;$/m, '');
// gl-matrix handed in, not stubbed: distance2PointTriangle is the measurement everything here
// rests on, and a fake of it would pass whatever it was written to pass.
const glm = await import(path.join(REPO, 'node_modules/gl-matrix/esm/index.js'));
const Geometry = new Function('vec3', 'mat4', 'quat',
  'var Geometry = {};' + geoBody + '; return Geometry;')(glm.vec3, glm.mat4, glm.quat);

const body = SRC.split('\n').filter((l) => !/^import /.test(l)).join('\n')
  .replace(/^export default WeightCage;$/m, '');
const Utils = { TRI_INDEX: 4294967295 };
// `window` handed in: the module installs a console diagnostic on it at load, and node has no
// window. A bare object is enough -- the diagnostic is not what is under test here.
const WeightCage = new Function('THREE', 'Skeleton', 'Geometry', 'Utils', 'window',
  body + '\nreturn WeightCage;')(THREE, {}, Geometry, Utils, {});

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

// ── THE GEOMETRY IS A CLOSED CAPSULE ──────────────────────────────────────────────────
const g = WeightCage.capsuleGeometry(0, 0, 0, 0, 2, 0, 0.5, 12, 4);
check('a capsule is built', !!g && g.verts.length > 0 && g.faces.length > 0);
{
  // FACES ARE ivec4 -- four indices, TRI_INDEX in the fourth slot for a triangle. Emitting raw
  // triangle triples produced a mesh with no valid faces at all, so the bake put nothing in the
  // scene. Checked here because it is the format the whole thing lives or dies by.
  check('faces are stored four indices per face',
    g.faces.length % 4 === 0, g.faces.length + ' indices');
  const tris = [];
  for (let t = 0; t + 3 < g.faces.length; t += 4) {
    const a = g.faces[t], b = g.faces[t + 1], c = g.faces[t + 2], d = g.faces[t + 3];
    if (d === Utils.TRI_INDEX) tris.push([a, b, c]);
    else { tris.push([a, b, c]); tris.push([a, c, d]); }
  }
  check('...quads in the body, triangles only at the poles',
    [...g.faces].filter((x, i) => i % 4 === 3 && x === Utils.TRI_INDEX).length
      === 12 * 2,   // one fan per pole, `radial` faces each
    'tri faces: ' + [...g.faces].filter((x, i) => i % 4 === 3 && x === Utils.TRI_INDEX).length);
  // Every edge shared by exactly two faces: containment is meaningless on an open surface, so
  // "is it closed" is the property that matters, not the face count.
  const edges = new Map();
  for (const tri of tris) {
    for (let k = 0; k < 3; k++) {
      const a = tri[k], b = tri[(k + 1) % 3];
      const key = a < b ? a + ':' + b : b + ':' + a;
      edges.set(key, (edges.get(key) || 0) + 1);
    }
  }
  const bad = [...edges.values()].filter((c) => c !== 2).length;
  check('...and it is closed, every edge shared by two faces',
    bad === 0, bad + ' edges of ' + edges.size + ' are not shared by exactly two');
}
{
  // The ends are hemispheres, so the extreme points sit a radius beyond each joint.
  let lo = Infinity, hi = -Infinity, maxR = 0;
  for (let i = 0; i < g.verts.length; i += 3) {
    const y = g.verts[i + 1];
    if (y < lo) lo = y; if (y > hi) hi = y;
    maxR = Math.max(maxR, Math.hypot(g.verts[i], g.verts[i + 2]));
  }
  // EDGE LOOPS ALONG THE BONE. Without one at the middle, the centre of a capsule has no
  // vertices to move and cannot be shaped at all -- which is the one thing this mesh is for.
  {
    const mid = [];
    for (let i = 0; i < g.verts.length; i += 3) {
      if (Math.abs(g.verts[i + 1] - 1) < 1e-6) mid.push(i);   // y = 1 is halfway along 0..2
    }
    check('there is an edge loop at the middle of the bone',
      mid.length === 12, mid.length + ' verts at the midpoint (expected one ring of 12)');
  }
  // ...and no duplicated ring, which the previous version emitted at A: a degenerate band of
  // zero-area quads down the middle of every capsule.
  {
    const seen = new Map();
    for (let i = 0; i < g.verts.length; i += 3) {
      const k = [g.verts[i], g.verts[i + 1], g.verts[i + 2]].map((n) => n.toFixed(5)).join(',');
      seen.set(k, (seen.get(k) || 0) + 1);
    }
    const dupes = [...seen.values()].filter((c) => c > 1).length;
    check('...and no ring is emitted twice', dupes === 0, dupes + ' duplicated vertices');
  }
  check('the caps extend a radius past each end',
    Math.abs(lo + 0.5) < 1e-6 && Math.abs(hi - 2.5) < 1e-6, lo.toFixed(3) + '..' + hi.toFixed(3));
  check('...and the tube is the radius wide', Math.abs(maxR - 0.5) < 1e-6, maxR.toFixed(4));
}

// ── SIGNED DISTANCE ───────────────────────────────────────────────────────────────────
const prep = (geo, joint) => ({
  joint: joint, verts: geo.verts, faces: geo.faces,
  bb: (() => {
    const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let i = 0; i < geo.verts.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        if (geo.verts[i + k] < b[k]) b[k] = geo.verts[i + k];
        if (geo.verts[i + k] > b[3 + k]) b[3 + k] = geo.verts[i + k];
      }
    }
    return b;
  })(),
});
const cage = prep(g, 7);
const sd = (x, y, z) => WeightCage.signedDistance(cage, x, y, z, 10);

check('a point at the centre of the capsule is inside (negative)',
  sd(0, 1, 0) < 0, sd(0, 1, 0).toFixed(4));
check('...and roughly a radius deep', Math.abs(sd(0, 1, 0) + 0.5) < 0.02, sd(0, 1, 0).toFixed(4));
check('a point well outside is positive',
  sd(3, 1, 0) > 0, sd(3, 1, 0).toFixed(4));
check('...and about the right distance away',
  Math.abs(sd(3, 1, 0) - 2.5) < 0.02, sd(3, 1, 0).toFixed(4));
check('a point just inside the wall is a small negative',
  sd(0.45, 1, 0) < 0 && sd(0.45, 1, 0) > -0.1, sd(0.45, 1, 0).toFixed(4));
check('a point just outside the wall is a small positive',
  sd(0.55, 1, 0) > 0 && sd(0.55, 1, 0) < 0.1, sd(0.55, 1, 0).toFixed(4));
// The broadphase must not change the answer for anything near the cage.
check('the bounding box rejects far points without walking triangles',
  WeightCage.signedDistance(cage, 50, 50, 50, 0.1) === Infinity);

// ── THE RANKING, which is the whole point ─────────────────────────────────────────────
{
  // Two cages: a fat one along Y, and a thin one running close alongside it. A point INSIDE the
  // fat one but nearer the thin one's SURFACE must go to the fat one -- that is the exact case
  // the capsule bind needed its radius normalisation for, and signed distance gets it right
  // without one.
  const fat = prep(WeightCage.capsuleGeometry(0, 0, 0, 0, 2, 0, 0.6, 12, 4), 1);
  const thin = prep(WeightCage.capsuleGeometry(1.0, 0, 0, 1.0, 2, 0, 0.08, 12, 4), 2);
  const verts = new Float32Array([0.4, 1, 0]);      // inside fat, close to thin's surface
  // THIN FIRST, deliberately: with the winner listed first, a "take the first cage" bug gives
  // the right answer by accident and the test proves nothing.
  const w = WeightCage.weights(verts, 1, [thin, fat], 4, 10);
  check('a vertex inside a fat cage is not stolen by a nearer thin one',
    w.idx[0] === 1,
    'went to joint ' + w.idx[0] + ' -- this is the case the radius normalisation existed for');
  check('...and it is not counted as outside', w.outside === 0);
}
{
  // Deepest inside wins where two cages overlap.
  const a = prep(WeightCage.capsuleGeometry(0, 0, 0, 0, 2, 0, 0.5, 12, 4), 1);
  const b = prep(WeightCage.capsuleGeometry(0.4, 0, 0, 0.4, 2, 0, 0.5, 12, 4), 2);
  // Same reason: the shallower cage is listed first.
  const w = WeightCage.weights(new Float32Array([0.05, 1, 0]), 1, [b, a], 4, 10);
  check('where cages overlap, the deepest one wins', w.idx[0] === 1, 'joint ' + w.idx[0]);
}
{
  // A vertex outside everything still gets a bone, and is counted.
  const a = prep(WeightCage.capsuleGeometry(0, 0, 0, 0, 2, 0, 0.3, 12, 4), 1);
  const w = WeightCage.weights(new Float32Array([5, 1, 0]), 1, [a], 4, 100);
  check('a vertex outside every cage still gets its nearest bone', w.idx[0] === 1);
  check('...and is reported as outside', w.outside === 1,
    'the same diagnostic the capsule bind gives: the cages are too small');
}
check('one bone per vertex, weight 1', (() => {
  const a = prep(WeightCage.capsuleGeometry(0, 0, 0, 0, 2, 0, 0.5, 12, 4), 3);
  const w = WeightCage.weights(new Float32Array([0, 1, 0]), 1, [a], 4, 10);
  return w.wts[0] === 1 && w.idx[1] === -1 && w.idx[2] === -1 && w.idx[3] === -1;
})(), 'no blending anywhere -- delta mush does the softening');

// ── THE WIRING ────────────────────────────────────────────────────────────────────────
//
// Structural, because building a scene and a rig in node is a bigger fake than the thing it
// would be testing. What matters here is that the bind PREFERS cages and FALLS BACK to
// capsules, so a scene with no cages cannot tell this code exists.
{
  const SK = fs.readFileSync(path.join(REPO, 'src/editing/Skinning.js'), 'utf8');
  const PANEL = fs.readFileSync(path.join(REPO, 'src/gui/bonePanel.js'), 'utf8');
  check('the bind uses cages when there are any',
    /const prepared = prepareCages\(main, joints,/.test(SK)
      && /raw = cageWeights\(prepared, level\.getVertices\(\), level\.getNbVertices\(\)\);/.test(SK));
  check('...and falls back to capsules when there are none',
    /if \(!raw\) raw = nearestCapsuleWeights\(level\.getVertices\(\), level\.getNbVertices\(\), segs\);/.test(SK),
    'an existing rig must bind exactly as it did');
  check('...skipping a cage whose joint has gone',
    /if \(ji === undefined\) continue;/.test(SK),
    'weighting vertices to a bone that no longer exists is worse than ignoring the cage');
  check('a cage remembers its bone by ID, not by index',
    /cage\._cageJointId = p\.getID\(\);/.test(SRC),
    'the joint list is rebuilt every call, and an index points at a different bone the moment '
      + 'one is added, split or dissolved');
  check('a cage is parented to the joint its bone hangs from',
    /main\.setMeshParent\(cage\.getID\(\), p\.getID\(\)/.test(SRC),
    'so it moves with its bone and needs no rig of its own');
  // ONE BUTTON FOR BOTH KINDS OF CAPSULE. Baked, there are two representations in the scene and
  // only the drawn overlay answered the toggle -- so "hide the capsules" left the solid ones
  // sitting over the character with no way to clear them but the outliner, row by row.
  {
    const panel = PANEL_INJ === 'drawnonly'
      ? PANEL.replace("      if (name === 'capsules') WeightCage.setVisible(main, on);", '')
      : PANEL;
    check('the Capsules button hides the baked meshes too',
      /if \(name === 'capsules'\) WeightCage\.setVisible\(main, on\);/.test(panel));
    check('...setting both visibility flags, like the outliner eye does',
      /c\.setVisible\?\.\(!!on\);/.test(SRC) && /if \(t\) t\.visible = !!on;/.test(SRC),
      'one without the other leaves a mesh that is hidden to one half of the app');
    check('...and a bake turns them on rather than making twenty invisible meshes',
      /Skeleton\.setDisplayFlag\('capsules', true\); WeightCage\.setVisible\(main, true\);/.test(PANEL),
      'the same reason a radius edit turns them on: an invisible edit looks like a no-op');
  }

  // BAKED, THE MESHES ARE THE CAPSULES. Drawing the parametric ones as well puts a second,
  // stale copy of the same shape over the top -- and once a cage is sculpted the two disagree,
  // with the one that is no longer true drawn in front.
  {
    let skel = fs.readFileSync(path.join(REPO, 'src/editing/Skeleton.js'), 'utf8');
    if (SKEL_DRAW_INJ) {
      const a = "  const showCaps = Skeleton.displayFlag('capsules')\n"
        + "    && !(main.getMeshes() || []).some((m) => m && m._isWeightCage);";
      if (!skel.includes(a)) throw new Error('inject bothcaps: anchor moved');
      skel = skel.replace(a, "  const showCaps = Skeleton.displayFlag('capsules');");
    }
    check('a baked rig stops drawing the parametric capsules',
      /const showCaps = Skeleton\.displayFlag\('capsules'\)\s*\n\s*&& !\(main\.getMeshes\(\) \|\| \[\]\)\.some\(\(m\) => m && m\._isWeightCage\);/.test(skel),
      'otherwise the mesh, the baked capsules AND the parametric ones are all on screen at once');
    check('...decided per frame, so Delete Capsules brings them straight back',
      /const showCaps = Skeleton\.displayFlag/.test(skel) && !/_hasWeightCages/.test(skel),
      'a latched flag would need clearing from every path that removes a cage');
  }

  check('baking refuses to double up',
    /if \(existing\.length\) return \{ ok: false, why: 'cages already exist/.test(SRC));
  // A CAPSULE LIVES INSIDE THE CHARACTER -- that is what it is for -- so an opaque cage is
  // completely enclosed by the skin and invisible. The bake ran, took its time and appeared to
  // do nothing. The capsule OVERLAY has always been drawn with a ghost pass for this reason; a
  // cage is a real mesh and cannot use that, so it gets alpha.
  // OPAQUE. Translucency was meant to solve "a capsule lives inside the skin", and a
  // translucent shape inside another shape reads worse than either alone. Hide the skin
  // instead -- one click, unambiguous.
  check('a baked capsule is drawn opaque',
    /cage\.setOpacity\(WeightCage\.OPACITY\);/.test(SRC)
      && /WeightCage\.OPACITY = 1;/.test(SRC));
  check('...with its wireframe on, so the shape can be read',
    /cage\.setShowWireframe\(true\);/.test(SRC));
  // `init()` writes the POSITIONS; the INDEX comes from updateBuffers(). Without it the mesh
  // has vertices and no triangles and draws nothing -- and every other field looks perfect,
  // which is exactly how this hid through three rounds of diagnostics.
  // THE ONE THAT COST SIX VERSIONS. A joint locator paints nothing, and it used to achieve
  // that with `visible = false` -- which in three skips the object's ENTIRE SUBTREE. A capsule
  // parented to a joint could therefore never render, however correct it was, and every field
  // measured on it came back right because the capsule WAS right. Its parent was hidden.
  {
    let SKEL = fs.readFileSync(path.join(REPO, 'src/editing/Skeleton.js'), 'utf8');
    if (SKEL_INJ) SKEL = SKEL.replace('  tm.visible = true;', '  tm.visible = false;');
    check('a joint locator hides itself by MATERIAL, not by visible',
      /function noDrawMaterial\(tm\) \{[\s\S]{0,300}?tm\.visible = true;/.test(SKEL)
        && /colorWrite: false, depthWrite: false/.test(SKEL),
      'visible=false on a parent makes every descendant invisible too');
    // The rule is about JOINTS, and it used to be enforced as "this line appears nowhere in the
    // file". Restoring a hidden mesh from a save needs exactly this line -- so the guard is now
    // that every one of them is gated on the row NOT being a joint, which is the actual
    // invariant rather than a proxy for it.
    {
      const hits = [...SKEL.matchAll(/tm\.visible = false;/g)];
      const guarded = hits.every((h) => /!\(row\.bone & 1\)/.test(SKEL.slice(Math.max(0, h.index - 400), h.index)));
      check('...and nothing sets a joint locator invisible any more',
        guarded,
        hits.length + ' occurrence(s); one ungated anywhere in the joint path hides everything '
        + 'parented to a joint');
    }
    check('...reasserted rather than assumed, since initRender rebuilds materials',
      (SKEL.match(/noDrawMaterial\(tm\);/g) || []).length >= 2,
      'applied at creation AND every frame -- the two drifting apart is how the white pick '
        + 'sphere comes back');
  }
  // Both calls, in that order -- not necessarily adjacent, since the colour push sits between
  // them. Pinning them as neighbours made this fail the moment anything legitimate was added.
  check('the bake uploads its index buffer',
    /cage\.updateGeometry\(\);[\s\S]{0,400}?cage\.updateBuffers\(\);/.test(SRC),
    'primitives get this free from normalizeSize(), which a capsule must not call -- it '
      + 'rescales to a unit box and destroys the fit');
  // The rig gives every bone an identity colour and the DRAWN capsules already use it. A baked
  // one that came out grey was losing information the rig was handing it for free.
  check('a baked capsule takes the colour of its bone',
    /const col = Skeleton\.boneColor\(main, p\);/.test(SRC)
      && /cAr\[ci\] = col\.r; cAr\[ci \+ 1\] = col\.g; cAr\[ci \+ 2\] = col\.b;/.test(SRC),
    'twenty-one grey capsules say nothing about which belongs to what');
  check('...as vertex colours, so sculpting keeps them',
    /const cAr = base\.getColors\(\);/.test(SRC),
    'new vertices inherit colour from their neighbours');
  check('...pushed through the duplicate buffer before upload',
    /updateDuplicateColorsAndMaterials\(\);\s*\n\s*cage\.updateBuffers\(\);/.test(SRC),
    'writing the array alone does not reach the render buffers');
  check('a baked capsule is an ordinary quad mesh',
    /cage\.isQuad = true;/.test(SRC),
    'so it subdivides and sculpts like any other primitive rather than degrading to triangles');
  // The bind must read the level being SCULPTED, or sculpting at a subdivided level changes
  // nothing and the tool appears not to work.
  check('the bind measures the level you are looking at, not level 0',
    /const level = cage\.getCurrentMesh \? cage\.getCurrentMesh\(\)/.test(SRC),
    'sculpt at level 2 and a level-0 read measures the smooth base underneath');
  // DELETING SOMETHING PARENTED. Every removal path removed the render object from
  // `_worldGroup` -- but a parented mesh's render object lives under its PARENT's, and
  // Object3D.remove() on a non-child is a silent no-op. So deleted joints, deleted capsules and
  // a reset scene all left their render objects drawing. It hid for as long as it did because
  // joint locators used to be `visible = false`, which made the leaks invisible leaks.
  {
    let SCENE = fs.readFileSync(path.join(REPO, 'src/Scene.js'), 'utf8');
    if (SCENE_INJ) SCENE = SCENE.replace('    if (t.parent) { t.parent.remove(t); return; }', '');
    check('a render object is detached from its ACTUAL parent',
      /detachMeshThree\(mesh\) \{[\s\S]{0,200}?if \(t\.parent\) \{ t\.parent\.remove\(t\); return; \}/.test(SCENE),
      'removing from _worldGroup is a no-op for anything parented to a joint');
    check('...and no removal path bypasses it',
      !/_worldGroup\.remove\(/.test(SCENE),
      'clearScene and replaceMesh each had their own copy of the same wrong assumption');
    check('...with a fallback for an object that has no parent yet',
      /var target = this\._worldGroup \|\| this\._scene;\s*\n\s*if \(target\) target\.remove\(t\);/.test(SCENE));
  }
  check('the panel offers bake and delete as one state',
    /hasCages \? 'Delete Capsules' : 'Bake Capsules'/.test(PANEL),
    'named for the thing the user already has a word for, not for our word');
  check('...and the bind says which source decided the weights',
    /res\.cages \? `, from \$\{res\.cages\} baked capsule\(s\)` : ', from drawn capsules'/.test(PANEL),
    '"I sculpted a cage and nothing changed" should be answerable without guessing');
}

console.log(failures ? '\n' + failures + ' FAILURE(S)' : '\nall checks passed');
process.exit(failures ? 1 : 0);
