import * as THREE from 'three';
import Utils from '../misc/Utils.js';
import MeshStatic from '../mesh/meshStatic/MeshStatic.js';
import Multimesh from '../mesh/multiresolution/Multimesh.js';
import Enums from '../misc/Enums.js';
import getOptionsURL from '../misc/getOptionsURL.js';
import Skeleton from './Skeleton.js';
import HandFit from './HandFit.js';

// [Rigging POC#2] Bones -> low-poly skin. Clay over a wire armature.
//
// Draw a skeleton, press one button, and get a quad cage over every bone at the capsule radii
// you already tuned — a blockout you then sculpt, the ZSphere move.
//
// A BOX PER JOINT, ALL OF THEM AXIS-ALIGNED TO THE WORLD. Each box is divided four ways a
// side; every bone claims one 2x2 BLOCK of the side it points at, and the blocks at the two
// ends of a bone are deleted and bridged. Then the whole cage is relaxed onto the capsules.
//
// THE BOXES DO NOT ROTATE, AND THAT IS THE POINT. Orienting each box to its own bone is the
// obvious thing and it was the source of every remaining problem: two boxes could disagree
// about roll, so a bridge between them sheared, and the amount it sheared by depended on the
// angle the bone happened to be drawn at. The result only looked deliberate when a skeleton
// was drawn at right angles. Boxes that all share one orientation have parallel faces
// everywhere, so a bridge CANNOT corkscrew at any angle, and there is no roll left to solve,
// transport, or hand to the user to fix.
//
// The shear does not disappear — a bone at 45 degrees still leaves a face that is 45 degrees
// off it. It stops being a topology problem and becomes a shape problem, which is what the
// relax pass is for. Getting the topology CONSISTENT and letting relaxation do the shaping is
// a better division of labour than trying to make the topology follow the bone.
//
// Two things fall out for free. World X is the symmetry normal, and a block boundary sits on
// the box centre, so the seam between two legs lands exactly on the symmetry plane rather than
// near it. And every claim is the same 2x2 block, so every bridge loop is eight vertices and
// no two ends of a bone ever have to negotiate a shape.
//
// EXCEPT WHEN THE USER TURNS ONE (Tweak Joint rings, `_jointRot`). The default stays world-aligned
// for every reason above; a turn is an authored edge-flow choice — a finger curl, a tail — and
// its shear is the one that was asked for. The box is built in the joint's own frame (boxAt
// takes the bone directions into it) and the relax measures the ellipsoid there too.
//
// What came before, in order, and why none of it is here: a tube per CHAIN (could not express
// a branch at all — two tubes leaving a spine capped themselves off inside each other); one
// face per bone on an oriented box (bridges sheared with the draw angle); rectangles of an
// oriented box with strips and transported frames (same shear, more machinery).

const SkinMesh = {};

// Cells a side. Four is what gives every bone a 2x2 block to extrude and still leaves four
// disjoint blocks a side, so a joint can carry four bones off one face without any two of them
// ever overlapping — the blocks tile, rather than being chosen and checked.
const CELLS = 4;

// The finest a joint may be divided. Only a joint with several bones leaving ONE face ever gets
// here — see levelFor — and the cap is what stops a pathological rig (every limb leaving the same
// side of one joint) from turning that joint into most of the mesh.
const MAX_CELLS = 8;
// THE FLOOR FOR A SHORT AXIS, which is not the same number as the floor for a joint. levelFor's
// floor of four is a SILHOUETTE rule — it sets how many sides a limb's tube has — and it applies
// to the axis that is actually long. An axis a third the length of its neighbours contributes a
// third of the silhouette and two cells there is proportionate, not a regression. See levelsFor.
const MIN_CELLS = 2;
const BLOCK = 2;

// Half-extent as a fraction of the shortest bone touching a joint. Two boxes on one bone must
// not touch, so the two together have to stay under 1.0; a fat joint on a short bone is pinched
// rather than allowed to swallow its neighbour.
const LENGTH_CLAMP = 0.45;
// The fraction a floating limb's hub box may reach towards each neighbour (see boxAt, support).
const SUPPORT_CLAMP = 0.55;

// How long a bridge may get before it is cut into more rings, as a multiple of the loop's own
// edge length. Aiming for roughly square quads: a bone whose span is four edge-lengths long
// gets four rings. Capped so a very long thin bone cannot run away with the vertex count.
const MAX_SPANS = 32;

// Relax. Each pass smooths, then pulls the result back onto the capsule surface — smoothing
// alone deflates a cage steadily, and it is the projection that holds the volume. Neither is
// useful without the other.
// Twenty, not six: the extra passes do not change the form (vertices inside a volume 281 -> 277), they
// settle the quads along it. On the biped the worst quad's aspect goes 11.7 -> 5.8, the hips stop bunching,
// and crossing pairs drop on the hard fixtures (crowded hand 66 -> 37). 60ms -> 185ms on a button press.
const RELAX_PASSES = 20;
const SMOOTH_RATE = 0.55;
// How far a capsule's influence bleeds into its neighbour's, as a fraction of the SMALLEST
// radius near the point — the finest feature anything there can have, so a thin bone leaving a
// fat joint stays a thin bone. It rounds the seam where two capsules meet and cannot make the
// skin thinner anywhere: a smooth-min only ever adds.
const BLEND_FRAC = 0.6;
// A thin bone leaving a fat one blends wider than the thin bone alone would say, or the join is a hard T
// (chest to clavicle, the armpit). The width moves this far from the thin radius towards the fat one, in
// ratio: 0 is the thin radius, 1 the fat.
const BLEND_MIX = 0.35;

// How far each pass pulls back onto the union after smoothing. Damped rather than a full snap:
// at 1 the surface lands exactly on the union and limbs that nearly touch drive their bridges
// through each other — 85 intersecting faces on matt's own rig, and 0 at this rate.
//
// I spent a round tuning this number DOWN, on the theory that the skin was lumpy because the
// pull was beating the smoothing. Wrong lever twice over: the lumpiness was capsuleTarget
// returning something that was not the union at all (see there), and once that was fixed the
// original 0.7 measured best on every count — fit, and self-intersection, on matt's rig.
// Overridable as window._boneSkinWrapRate, for the next person who wants to check rather than
// assume.
const PROJECT_RATE = 0.7;

// Model-space symmetry plane normal, matching TransformData._symmetryNormal.
const SYM_AXIS = 0;

// -----------------------------------------------------------------------------------------
// Skeleton topology
// -----------------------------------------------------------------------------------------

// Joints a skipped floating joint's limbs join (a palm's far end), from the last adjacency(): their
// boxes are clamped by support, not by nearest neighbour (see boxAt).
let _floatHubs = new Set();
// A limb joined to its hub THROUGH a skipped floating joint -> that floating joint (its knuckle).
let _viaFloat = new Map();

// `skip` holds the joints that deform but do not shape the skin (Skeleton.jointShapesSkin). They
// are absent from `joints`, and a joint whose parent is one of them hangs from the nearest
// ancestor that is not — so a jaw leaves no trace and a twist bone mid-forearm leaves one bone.
function adjacency(joints, skip) {
  _floatHubs = new Set();
  _viaFloat = new Map();
  const set = new Set(joints);
  const adj = new Map();
  const bones = [];
  for (const j of joints) adj.set(j, []);
  // Where a FLOATING joint joins the skin: the nearer end of its parent's connected bones (the
  // parent itself, or one of its unfloating children). A finger floating off a wrist whose bone to
  // the middle knuckle is the palm joins at that knuckle, the palm's far end, rather than bridging
  // from the wrist through the palm volume; a thumb near the wrist joins at the wrist.
  const attach = (j, p) => {
    if (!Skeleton.boneFloats(j)) return p;
    const at = Skeleton.jointPos(j);
    let best = p, bd = Skeleton.jointPos(p).distanceTo(at);
    for (const k of joints) {
      if (k === j || k._parentMesh !== p || Skeleton.boneFloats(k)) continue;
      const d = Skeleton.jointPos(k).distanceTo(at);
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  };
  for (const j of joints) {
    let p = j._parentMesh;
    // Past a skipped FLOATING joint to where it joins (see skinSkip), not to its parent.
    let viaFloat = false;
    while (p && skip && skip.has(p)) {
      if (Skeleton.boneFloats(p) && p._parentMesh) { _viaFloat.set(j, p); p = attach(p, p._parentMesh); viaFloat = true; break; }
      p = p._parentMesh;
    }
    if (!set.has(p)) continue;
    if (!viaFloat) p = attach(j, p);
    else _floatHubs.add(p);
    if (Skeleton.jointPos(j).distanceTo(Skeleton.jointPos(p)) < 1e-9) continue; // no direction
    adj.get(j).push(p);
    adj.get(p).push(j);
    bones.push([p, j]);
  }
  return { adj: adj, bones: bones };
}

// The radius of the bone between two joints. It is stored on the CHILD joint of the pair,
// which is why this cannot just read one of them.
// Through any joints that do not shape the skin, since adjacency joins across them.
function hangsFrom(c, p) {
  let q = c._parentMesh;
  while (q && q !== p && q._noSkinShape) q = q._parentMesh;
  return q === p;
}
function boneRadius(a, b) {
  if (hangsFrom(b, a)) return b._boneRadius || 0;
  if (hangsFrom(a, b)) return a._boneRadius || 0;
  return Math.max(a._boneRadius || 0, b._boneRadius || 0);
}

// -----------------------------------------------------------------------------------------
// The box
// -----------------------------------------------------------------------------------------

// The six sides, each as the axis it faces plus the two axes its grid runs along. `u` and `v`
// are ordered so that walking the grid u-then-v winds counter-clockwise seen from OUTSIDE.
const BOX_SIDES = [
  { axis: 0, sign: 1, u: 1, v: 2 },  // +X
  { axis: 0, sign: -1, u: 2, v: 1 }, // -X
  { axis: 1, sign: 1, u: 2, v: 0 },  // +Y
  { axis: 1, sign: -1, u: 0, v: 2 }, // -Y
  { axis: 2, sign: 1, u: 0, v: 1 },  // +Z
  { axis: 2, sign: -1, u: 1, v: 0 }, // -Z
];

// One box PER SUBDIVISION LEVEL, built once and shared by every joint at that level: boxes of the
// same level differ only in centre and scale, so the lattice, the sides and the block layout are
// all the same object every time.
//
// Vertices are keyed by their exact lattice coordinate, so adjacent sides SHARE their edge and
// corner vertices rather than stacking duplicates along every seam.
//
// `n` is cells a side, PER AXIS: [nx, ny, nz]. The lattice runs -n[k]..n[k] in steps of two on
// each axis, so a cell is two units wide there and the centre of a side still lands on an
// integer, which is what lets a claim be described in cells and still name real vertices.
//
// PER AXIS, BECAUSE A JOINT IS NOT A CUBE. A uniform lattice on a flat palm gives square cells on
// the broad face and slivers through the thin one — and, worse, the only way to give five fingers
// room ACROSS the palm was to divide the palm's THICKNESS eight ways too. Sizing each axis in
// proportion to its own half-extent makes the cells roughly cubic, which is what lets a bone's
// claim be square in cells and square in world at the same time. See levelsFor.
//
// NO TOPOLOGY CHANGES HERE. The sides are the same six, wound the same way, and a claim is still
// a rectangle of cells; only how many cells a side has along each of its two axes.
function makeBox(n) {
  const index = new Map();
  const lat = [];
  const idOf = (c) => {
    const key = c[0] + ',' + c[1] + ',' + c[2];
    let id = index.get(key);
    if (id === undefined) { id = lat.length; index.set(key, id); lat.push(c.slice()); }
    return id;
  };

  const sides = BOX_SIDES.map((s) => {
    // A SIDE CARRIES ITS OWN TWO COUNTS, so everything downstream that used to read the box's one
    // number asks the side it is actually working on instead.
    const nu = n[s.u], nv = n[s.v];
    const grid = [];
    for (let a = 0; a <= nu; a++) {
      const col = [];
      for (let b = 0; b <= nv; b++) {
        const c = [0, 0, 0];
        c[s.axis] = s.sign * n[s.axis];
        c[s.u] = -nu + 2 * a;
        c[s.v] = -nv + 2 * b;
        col.push(idOf(c));
      }
      grid.push(col);
    }
    return { def: s, grid: grid, nu: nu, nv: nv };
  });

  return { lat: lat, sides: sides, n: n };
}

// The boundary vertices of a rectangle of cells, counter-clockwise seen from outside, so a
// bridge inherits the side's own winding. Its length is 2*(width+height) in cells, which is
// what the two ends of a bone have to agree on.
function rectLoop(box, claim) {
  const side = box.sides[claim.side];
  const r = claim.rect;
  const loop = [];
  for (let a = r.a0; a < r.a1; a++) loop.push(side.grid[a][r.b0]);
  for (let b = r.b0; b < r.b1; b++) loop.push(side.grid[r.a1][b]);
  for (let a = r.a1; a > r.a0; a--) loop.push(side.grid[a][r.b1]);
  for (let b = r.b1; b > r.b0; b--) loop.push(side.grid[r.a0][b]);
  return loop;
}

function rectFaces(box, claim) {
  const side = box.sides[claim.side];
  const r = claim.rect;
  const out = [];
  for (let a = r.a0; a < r.a1; a++)
    for (let b = r.b0; b < r.b1; b++)
      out.push([side.grid[a][b], side.grid[a + 1][b], side.grid[a + 1][b + 1], side.grid[a][b + 1]]);
  return out;
}

function perimeter(r) { return 2 * ((r.a1 - r.a0) + (r.b1 - r.b0)); }

// The perimeter of a WHOLE side, in cells: the most that end of a bone could ever offer. It was
// 4n while every side was square; a side sized per axis has to be asked.
function facePerimeter(box, si) { const s = box.sides[si]; return 2 * (s.nu + s.nv); }

// Where a rectangle sits, as a direction from the box centre, so a claim can be compared
// against the bone that wants it.
function rectDir(box, claim) {
  const c = new THREE.Vector3();
  const loop = rectLoop(box, claim);
  for (const v of loop) c.add(new THREE.Vector3(box.lat[v][0], box.lat[v][1], box.lat[v][2]));
  // NORMALISED PER AXIS BEFORE THE DIRECTION IS TAKEN. The lattice is no longer isotropic, so a
  // raw coordinate sum leans towards whichever axis has the most cells; dividing each component by
  // its own count puts the rectangle back on the unit box first, where the comparison against the
  // bone direction means what it did.
  const n = box.n;
  return c.set(c.x / n[0], c.y / n[1], c.z / n[2]).normalize();
}

// ONE BOX PER LEVEL, MADE ONCE. Three levels are enough and the cap is deliberate: a level has to
// be a POWER OF TWO or the ends of a bone cannot agree. A k-by-k block of cells has 4k boundary
// vertices whatever size those cells are, so a coarse box's whole face (k = n) meets a fine box's
// k-cell block exactly when both sides count the same k — and powers of two are what make a
// coarse cell line up with a block of a finer one rather than straddling it.
const BOXES = new Map();
// Scratch for the reduction band's own ring — see transitionBand and the bridge.
const _pStep = new THREE.Vector3();
const _pStep2 = new THREE.Vector3();
function boxOf(n) {
  const key = n[0] + ',' + n[1] + ',' + n[2];
  let b = BOXES.get(key);
  if (!b) { b = makeBox(n); BOXES.set(key, b); }
  return b;
}

// HOW FINELY A JOINT HAS TO BE DIVIDED: enough to hand a rectangle to every bone that leaves it,
// and no more.
//
// It used to be four, everywhere, because CELLS was one constant for the whole rig — so a
// fingertip carried the same ninety-six cells as a pelvis, and a finger then had to give almost
// all of its face back to meet the small patch a crowded palm could spare. matt: "it seems to me
// that the full face of the child joint should connect to 1 of those exposed 4 sub-faces on the
// wrist. if they were a lower subdivision, that would work right?"
//
// It does, and this is the half that makes it work: a chain joint — every finger bone, every
// spine bone — has its bones on opposite faces and needs no subdivision at all, so its whole face
// IS the one cell its parent hands it. Only a joint with several bones leaving one face has to
// divide, and only as far as that face's own crowd demands.
//
// Measured on the busiest side, since that is the one that runs out of room, and rounded up to a
// power of two.
function levelFor(dirs) {
  let most = 1;
  const perSide = new Array(BOX_SIDES.length).fill(0);
  for (const d of dirs) {
    let bi = 0, bv = -Infinity;
    for (let i = 0; i < BOX_SIDES.length; i++) {
      const def = BOX_SIDES[i];
      const v = d.getComponent(def.axis) * def.sign;
      if (v > bv) { bv = v; bi = i; }
    }
    perSide[bi]++;
    if (perSide[bi] > most) most = perSide[bi];
  }
  // TWO IS THE FLOOR, NOT ONE. A joint divided once a side is a plain cube, and a chain of them is
  // a four-sided tube with nothing between its corners: the relax has no vertices left to pull
  // into an ellipsoid, so a joint scaled 4:1 comes back round and Tweak Joint stops meaning
  // anything. The harness said so in the bluntest way available — "one scaled per axis stops being
  // round" came back NaN, because the width it measures was zero.
  //
  // TWO IS ALSO WHAT A CHILD OFFERS, and that is what sets the rule above it. A joint at two has a
  // 2x2 face: eight boundary vertices, handed over whole. So a parent has to be able to give every
  // bone on its busiest side a 2x2 BLOCK, which takes two cells of width each — hence twice the
  // crowd, rounded up to a power of two. A palm with four fingers goes to eight and gives each of
  // them a 2x2 with six rows of face left over between and around them; every finger bone in the
  // chain below stays at two. Neither end shrinks, which is the whole point.
  //
  // I tried giving three or four bones a QUADRANT each instead, which needs no extra level. It
  // fails on exactly the case it was for: fingers sit in a ROW, so splitting them two-by-two
  // stacks two of them across the face from where they actually are, and a bone seated out of
  // sequence puts its bridge through its neighbour's — 60 and 93 intersecting pairs on the two
  // hand fixtures.
  //
  // THIS IS STILL FEWER POLYGONS THAN BEFORE, which is worth saying because eight looks like an
  // increase. It applies to one joint. Every other joint in a hand drops from four to two — from
  // ninety-six cells to twenty-four — and the palm's 384 does not come close to paying that back.
  // FOUR IS THE FLOOR, NOT TWO — and two was a real regression, caught on matt's own forearm.
  //
  // A chain joint's whole face IS the bridge loop, so the level sets the number of sides the tube
  // has: level 2 gives a 2x2 face, perimeter 8, an OCTAGONAL limb. An octagon inscribed in a
  // circle touches at its corners and cuts to cos(pi/8) = 0.924 between them, so the silhouette
  // reads 8% inside the capsule everywhere — which is exactly what matt saw: "it still collapses
  // between the wrist and the elbow." Measured on hand2.sxr: vertices at 0.96-0.99 of the
  // capsule (so the relax was doing its job) with only 7-9 of them per ring.
  //
  // Level 4 is a 16-sided tube, which is what every bone had before per-joint levels existed. The
  // floor was set at 2 for a different reason — a joint at 1 is a plain cube with nothing for the
  // relax to shape — and that reasoning is sound and simply does not reach far enough: shape
  // fidelity needs 2, SILHOUETTE needs 4.
  //
  // It costs the polycount saving I claimed when levels landed. That saving was mostly this
  // trade, made without noticing: 744 cells against 1536 was bought by halving the resolution of
  // every chain bone. What survives is the part that was always the point — a crowded joint gets
  // subdivided FURTHER (a palm goes to 8) so its children can attach without shrinking.
  // FOUR, because the level sets how many SIDES a limb has and two gives an octagon.
  //
  // A chain joint's whole face IS the bridge loop, so level 2 = perimeter 8, and an octagon
  // inscribed in a circle cuts to cos(pi/8) = 0.924 between its corners — the limb reads 8%
  // inside its capsule for its whole length. Measured on matt's hand2.sxr: forearm vertices at
  // 0.96-0.99 of the capsule, so the relax was doing its job, with only 7-9 of them per ring.
  // matt: "it still collapses between the wrist and the elbow" and, at 4, "yes that wrist looks
  // better now".
  //
  // The floor was 2 when per-joint levels landed, for a reason that is true and does not reach
  // far enough: a joint at 1 is a plain cube with nothing for the relax to shape. SHAPE fidelity
  // needs 2; SILHOUETTE needs 4. It also means the polycount saving claimed at the time was
  // mostly this trade rather than a free win.
  //
  // WHAT IT COSTS, measured rather than assumed. The five-fingers fixture goes from 62
  // self-intersecting pairs to 108, and matt's own hand from 221 to 555 — WORSE, but not a clean
  // sheet spoiled: a crowded palm has never generated a clean skin, which is why that fixture
  // carries a stated overlap allowance at all. The cause is that the floor is only half of a
  // PAIRWISE contract: a bone's loop is the smaller of what its two ends offer, so at floor 2 a
  // finger's face (8) happened to match a crowded palm's block (8) and nothing shrank, while at 4
  // the finger offers 16, the palm can spare 6-8, and the finger attaches through a sliver of a
  // fat box whose bridge grazes its neighbour's.
  //
  // THE REAL FIX IS TOP-DOWN: a child's level should be the size of the block its PARENT can
  // spare, resolved parent-first down the tree instead of per joint in isolation. Then a forearm
  // off an uncrowded elbow is 16-sided while fingers off a crowded palm stay at 8, and neither
  // end ever shrinks. Until that exists this is the better of two flawed states, chosen because
  // the faceting is on EVERY chain bone of every rig while the overlaps are on crowded hands
  // that already had them.
  //
  // window._boneSkinLevelFloor = 2 goes back. Tie-breaking shrinkTo toward the face centre was
  // tried and is not it (108 -> 100, noise).
  const floor = (window._boneSkinLevelFloor === 2 || window._boneSkinLevelFloor === 8)
    ? window._boneSkinLevelFloor : 4;
  let n = floor;
  while (n < most * 2 && n < MAX_CELLS) n *= 2;
  return n;
}

// ONE COUNT PER AXIS, in proportion to the joint's own half-extents.
//
// levelFor answers how finely a joint has to be divided to SEAT ITS BONES. This decides how that
// division is spread over the three axes: the level it returns is the count on the LONGEST axis,
// and a shorter axis gets proportionally fewer cells, so the cells come out roughly cubic instead
// of square on a palm's broad face and slivers through its thickness.
//
// WHY THIS IS A POLE FIX AND NOT A COSMETIC ONE. Two ends of a bone have to agree on PERIMETER,
// and under a uniform lattice the only lever on perimeter was the level, which moves in powers of
// two: sixteen, then thirty-two, nothing between. So a palm crowded enough to need eight cells
// across got eight through its thickness as well, its claim rectangles came out the wrong shape
// for the finger faces meeting them, and the mismatch had to be absorbed by the reduction band —
// and a band is a wedge, and a wedge is a valence-3/valence-5 pair by construction. Measured on
// matt's handbefore.sxr, the band was worth a full point of pole count: 2.7% without it, 3.7%
// with, against 1.7% for the same hand through QuadRemesher. Sized per axis a palm can spare a
// SQUARE block for each finger without inflating its thickness, so the two ends can agree without
// a band at all.
//
// matt, on the deprecated ZSphere plugin that did exactly this: "i used a plugin for zspheres that
// let you more carefully control the x/y/z division count, that let you get better joins."
//
// STILL POWERS OF TWO. That is what makes a coarse cell line up with a block of a finer one rather
// than straddling it — see boxOf — and it is the contract the reduction band checks before it
// fires. Rounding is done in the log domain, so an axis wanting three cells gets four rather than
// two: the geometric midpoint of two and four is 2.83, not 3.
//
// A ROUND JOINT COMES BACK EXACTLY WHERE IT WAS. Equal half-extents give equal counts, which is
// the single level levelFor already returned, so nothing tuned against the uniform lattice moves
// and only joints that are genuinely not cubes change shape.
//
// window._boneSkinPerAxis = false goes back to the uniform lattice, since there is no natural A/B
// here and the thing worth measuring is a pole count on a real hand.
function levelsFor(dirs, half) {
  const base = levelFor(dirs);
  const big = Math.max(half[0], half[1], half[2]);
  if (window._boneSkinPerAxis === false || !(big > 1e-12)) return [base, base, base];
  const out = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const want = base * (half[k] / big);
    let n = MIN_CELLS;
    while (n < base && n * Math.SQRT2 < want) n *= 2;
    out[k] = Math.min(base, n);
  }
  return out;
}

// Hand every bone leaving a joint a rectangle of the side it points at.
//
// ONE BONE TAKES THE WHOLE SIDE. That is not generosity, it is the only symmetric answer: a
// bone pointing straight at a face matches all four quarters of it EXACTLY equally, so picking
// one quarter means picking by array order, and a symmetric skeleton then came back with a
// visibly asymmetric skin. There is no tie to break if the claim is the face.
//
// Two bones split the side into equal halves, cut across whichever axis separates them, and
// the halves go to them in the order they themselves lie along it. Equal keeps the seam on the
// box centre — which, because the boxes are world-aligned, is the symmetry plane. In order is
// what stops two bridges crossing: a bone seated out of sequence puts its bridge across its
// neighbour's, and that was the last self-intersection to survive every earlier version here.
//
// Three or four fall back to quarters, arranged by trying every way and keeping the best total.
// Four quarters is at most twenty-four arrangements, so best is exact rather than greedy.
function splitSide(box, si, bones, dirs) {
  // THE SIDE'S OWN TWO COUNTS, not the box's one. `a` runs along the side's u axis and `b` along
  // its v, and since per-axis sizing those need not be the same number.
  const NU = box.sides[si].nu, NV = box.sides[si].nv;
  if (bones.length === 1) {
    return [{ bone: bones[0], side: si, rect: { a0: 0, a1: NU, b0: 0, b1: NV } }];
  }

  const def = box.sides[si].def;
  let lo = Infinity, hi = -Infinity, loV = Infinity, hiV = -Infinity;
  for (const b of bones) {
    const cu = dirs[b].getComponent(def.u), cv = dirs[b].getComponent(def.v);
    lo = Math.min(lo, cu); hi = Math.max(hi, cu);
    loV = Math.min(loV, cv); hiV = Math.max(hiV, cv);
  }
  // Ties go to `u`, and on the sides where two limbs actually split, that is the axis the
  // symmetry plane cuts along.
  const alongU = (hi - lo) >= (hiV - loV);
  const comp = (b) => dirs[b].getComponent(alongU ? def.u : def.v);
  const ordered = bones.slice().sort((p, q) => comp(p) - comp(q));

  // Strips as even as the grid allows: an exact split when the count divides CELLS, and the
  // remainder spread one cell at a time when it does not. Uneven is fine — each bone settles
  // its loop length with its own far end, so three bones sharing a face as 2-1-1 costs nothing
  // beyond one limb being fatter than its neighbours.
  // Split along one axis and stay whole across the other, so the two counts have distinct jobs:
  // SPLIT is the one being cut into strips, CROSS is the one a compact block is centred in.
  const SPLIT = alongU ? NU : NV, CROSS = alongU ? NV : NU;
  const k = ordered.length;
  const sizes = [];
  for (let i = 0; i < k; i++) sizes.push(Math.floor(SPLIT / k) + (i < SPLIT % k ? 1 : 0));

  // THREE OR MORE GET A COMPACT BLOCK, NOT A FULL-DEPTH STRIP.
  //
  // A strip spans the whole face across, so a bone that gets one attaches through a patch that
  // touches both edges: nothing surrounds it, and there is no material for the relax to round the
  // join with. On a hand that is the difference between a finger arriving as a flat ribbon and
  // arriving as a tube. matt, on his own rig: "the thumb connects well, a whole single side... but
  // the fingers get a strange connection, a single 1x4 row of faces... it would almost be better
  // to do a single face and connect, so there's enough connective tissue around the joint to
  // smooth it over."
  //
  // So the strip is squared off and centred across: four fingers on one palm face take one cell
  // each instead of one row each, and the remaining twelve cells stay ordinary surface between
  // and around them.
  //
  // ONLY AT THREE OR MORE. One bone takes the whole face and two split it in equal halves, and
  // that halving is load-bearing: the seam lands on the box centre, which — because the boxes are
  // world-aligned — is the symmetry plane itself, and that is what puts the seam between two legs
  // exactly on the centreline rather than near it. Squaring those off would move it.
  //
  // The blocks stay inside their own strips, so they cannot overlap however the sizes fall out.
  const compact = k >= 3;
  const out = [];
  let at = 0;
  for (let i = 0; i < k; i++) {
    const lo2 = at, hi2 = at + sizes[i];
    at = hi2;
    // As deep as it is wide, centred. With CELLS even and a width of one the centring cannot be
    // exact; landing a cell off-centre is invisible next to the strip it replaces.
    const w = compact ? Math.min(CROSS, Math.max(sizes[i], 2)) : CROSS;
    const c0 = compact ? Math.floor((CROSS - w) / 2) : 0;
    const c1 = c0 + w;
    out.push({
      bone: ordered[i], side: si,
      rect: alongU ? { a0: lo2, a1: hi2, b0: c0, b1: c1 } : { a0: c0, a1: c1, b0: lo2, b1: hi2 },
    });
  }
  return out;
}

// Which side each bone points at, with no side given more bones than it has cells to cut into.
//
// A side can only be split as many ways as it has cells, and the case that forces this is a
// hand: five bones all leaving one face. Overflowing used to abandon the whole box, which took
// its joint and every bone through it out of the mesh — the palm simply vanished and the hand
// came back as six loose shells. Moving the worst-fitting bone to its next-best side instead
// gives a shape that is wrong in a way you can see and fix, rather than absent.
function assignSides(box, dirs) {
  // HOW MANY WAYS A SIDE CAN BE CUT is now a property of the side: splitSide cuts along whichever
  // of its two axes the bones actually spread over, so the capacity is the larger of the two.
  const cap = box.sides.map((s) => Math.max(s.nu, s.nv));
  const rank = dirs.map((d) => box.sides
    .map((s, i) => ({ i: i, v: d.getComponent(s.def.axis) * s.def.sign }))
    .sort((p, q) => q.v - p.v));
  const at = dirs.map((_, b) => rank[b][0].i);
  const nextFor = dirs.map(() => 1);

  for (let guard = 0; guard < 64; guard++) {
    const perSide = box.sides.map(() => []);
    at.forEach((si, bone) => perSide[si].push(bone));
    let over = -1;
    for (let i = 0; i < perSide.length; i++) if (perSide[i].length > cap[i]) { over = i; break; }
    if (over < 0) return perSide;
    // Evict the bone that fits this side least well and has somewhere else to go.
    const crowd = perSide[over]
      .filter((b) => nextFor[b] < rank[b].length)
      .sort((p, q) => rank[p][0].v - rank[q][0].v);
    if (!crowd.length) return perSide; // nowhere left; let the caller cope
    const move = crowd[0];
    at[move] = rank[move][nextFor[move]++].i;
  }
  return null;
}

// A whole box: send each bone to a side, then cut each side into strips.
function claimSides(box, dirs) {
  const perSide = assignSides(box, dirs);
  if (!perSide) return null;

  const claims = new Array(dirs.length).fill(null);
  for (let i = 0; i < box.sides.length; i++) {
    if (!perSide[i].length) continue;
    for (const p of splitSide(box, i, perSide[i], dirs)) {
      claims[p.bone] = { side: p.side, rect: p.rect };
    }
  }
  return claims;
}

// Shrink a claim to a given perimeter, keeping the part of it the bone actually points at.
//
// A bone has to meet the SAME loop length at both ends or there is no all-quad bridge between
// them — a whole face is a sixteen-vertex loop and a half is twelve. So the shape belongs to
// the BONE, the smaller of what its two ends offer, and the generous end gives up the rest and
// keeps it as ordinary surface. That reads as a limb meeting a wider bulb, which is what it is.
function shrinkTo(box, claim, want, dir) {
  const r = claim.rect;
  let best = null, top = -Infinity;
  for (let a0 = r.a0; a0 < r.a1; a0++)
    for (let a1 = a0 + 1; a1 <= r.a1; a1++)
      for (let b0 = r.b0; b0 < r.b1; b0++)
        for (let b1 = b0 + 1; b1 <= r.b1; b1++) {
          const sub = { a0: a0, a1: a1, b0: b0, b1: b1 };
          if (perimeter(sub) !== want) continue;
          // Tie-breaking toward the face CENTRE was tried here and is not the answer: it moved
          // the five-finger fixture from 108 intersecting pairs to 100, which is noise. The
          // crossing bridges are a symptom of the shrink itself, not of which sub-rect wins it.
          // See levelFor.
          const s = rectDir(box, { side: claim.side, rect: sub }).dot(dir);
          if (s > top) { top = s; best = sub; }
        }
  return best ? { side: claim.side, rect: best } : claim;
}

// The far loop turned to run the same way round the bone as the near one, and rolled to the
// offset that pairs the vertices up. Both loops are wound outward from their OWN box, so they
// run in opposite directions about the bone; one has to be reversed or the bridge is a bow tie.
// A 2:1 LOOP REDUCTION, IN QUADS.
//
// A limb's resolution should not be dictated by what its parent can spare. A finger is a 16-sided
// tube; a crowded palm can only hand out an 8-vertex block; and settling both ends on the smaller
// number means the finger gives up most of its face and attaches through a sliver — high-res
// palm, pinched bridge, high-res finger. matt: "it goes from the relatively high res geo on the
// wrist, does a small very low res bridge to the base of the finger, then goes high res again."
//
// THE CONSTRAINT THAT SHAPES THE PATTERN: in a band of quads where every quad has two vertices on
// each side, the number of quads equals the number of edges on BOTH sides — so such a band cannot
// change a loop's length, however it is arranged. Reduction needs a quad with THREE consecutive
// vertices on the fine side and ONE on the coarse: a wedge, which consumes two fine edges and no
// coarse edge at all.
//
// Balancing those two kinds gives the ratio. With w wedges and q ordinary quads the band consumes
// 2w + q fine edges and q coarse ones, so 2:1 means q = 2w — one wedge for every two quads, four
// fine edges and two coarse per unit. A 16-vertex loop meets an 8-vertex loop in four such units,
// twelve quads, and no vertex is invented.
//
// The alternative — a triangle per pair — was not considered: the whole mesh is quads by contract
// and the harness fails on the first non-quad.
function transitionBand(fine, coarse, pushQuad) {
  const F = fine.length, C = coarse.length;
  // Two to one, and an even number of coarse edges so the units divide the ring exactly. Anything
  // else falls back to settling both ends on the smaller loop, which is what always happened.
  if (F !== C * 2 || (C & 1)) return false;
  const units = C / 2;
  // Counted so a harness can assert the band was REACHED — a suite that passes without ever
  // entering this function says nothing about it.
  SkinMesh._bandCount = (SkinMesh._bandCount | 0) + 1;
  for (let u = 0; u < units; u++) {
    const fi = u * 4, ci = u * 2;
    const f0 = fine[fi % F], f1 = fine[(fi + 1) % F], f2 = fine[(fi + 2) % F];
    const f3 = fine[(fi + 3) % F], f4 = fine[(fi + 4) % F];
    const c0 = coarse[ci % C], c1 = coarse[(ci + 1) % C], c2 = coarse[(ci + 2) % C];
    // The wedge: two fine edges collapse onto one coarse vertex.
    pushQuad(f0, f1, f2, c0);
    // ...then two ordinary quads carry the remaining two fine edges across the two coarse ones,
    // sharing the wedge's rails so the band stays manifold.
    pushQuad(f2, f3, c1, c0);
    pushQuad(f3, f4, c2, c1);
  }
  return true;
}

//
// A TIE IS BROKEN BY HANDEDNESS, NOT BY INDEX. A flattened volume makes both loops rectangles, and
// two rolls then pair them at exactly the same cost, shearing the bridge one way round the bone or
// the other. Taking the first in index order took a different one on each arm (the twin's loop runs
// mirrored), so a flattened forearm came out sheared one way on the left and the other on the right.
// Twist about the bone flips under a mirror, and so does the side of the body: their product picks
// the mirror image of the left's choice on the right.
function matchLoop(near, far, posAt) {
  const rev = far.slice().reverse();
  const L = rev.length;
  const costs = [];
  for (let k = 0; k < L; k++) {
    let cost = 0;
    for (let i = 0; i < L; i++) cost += posAt(near[i]).distanceToSquared(posAt(rev[(i + k) % L]));
    costs.push(cost);
  }
  const low = Math.min(...costs), tied = [];
  for (let k = 0; k < L; k++) if (costs[k] <= low * (1 + 1e-6) + 1e-12) tied.push(k);
  let pick = tied[0];
  if (tied.length > 1) {
    const cn = new THREE.Vector3(), cf = new THREE.Vector3();
    for (let i = 0; i < L; i++) { cn.add(posAt(near[i])); cf.add(posAt(rev[i])); }
    cn.divideScalar(L); cf.divideScalar(L);
    const axis = new THREE.Vector3().subVectors(cf, cn), side = Math.sign(cn.x + cf.x);
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    let top = -Infinity;
    for (const k of tied) {
      let tw = 0;
      for (let i = 0; i < L; i++) {
        a.copy(posAt(near[i])).sub(cn); b.copy(posAt(rev[(i + k) % L])).sub(cf);
        tw += a.cross(b).dot(axis);
      }
      if (tw * side > top + 1e-9) { top = tw * side; pick = k; }
    }
  }
  const best = [];
  for (let i = 0; i < L; i++) best.push(rev[(i + pick) % L]);
  return best;
}

// -----------------------------------------------------------------------------------------
// Relax
// -----------------------------------------------------------------------------------------

// Pull a point onto the surface of the union of capsules.
//
// A DISTANCE FIELD, NOT AN AVERAGE OF SURFACE POINTS. Averaging points was the first fix — it
// replaced "snap to the nearest capsule", which creased where two met and was not mirror-safe —
// and it holds only while every capsule near a vertex is about the same size. Once joints carry
// their own radii that stops being true, and the average of two far-apart surfaces lands
// somewhere neither of them is: a chest vertex between two fat shoulders is dragged out and
// sideways, and the chest collapses to a sheet spanning between them. matt: "the chest to
// shoulder connection seems to almost be repelled by the shoulder joint."
//
// The union of capsules has an exact signed distance — the MINIMUM of each capsule's own — and
// a point goes to its surface by stepping along the gradient. A hard min creases at the seam,
// which is what started all this, so the min is SMOOTHED: an exponential soft-min, which is the
// same falloff as before and now weights DISTANCES rather than positions. Equal distances still
// give equal weight, so the mirror seam is still pinned by symmetry rather than by luck.
const _cp = new THREE.Vector3(), _ax = new THREE.Vector3(), _to = new THREE.Vector3();
const _grad = new THREE.Vector3();
// SCRATCH FOR THE INNER LOOP, GROWN ONCE. This function runs once per vertex per relax pass —
// about sixteen thousand times for a rig the size of matt's — and it used to allocate four
// arrays and push into them on every one of those calls, then sort with a comparator closure.
// That bookkeeping, not the arithmetic, was 95% of Make Skin: 311ms of a 327ms build.
let _sd = new Float64Array(0), _nx = new Float64Array(0);
let _ny = new Float64Array(0), _nz = new Float64Array(0);
let _order = new Int32Array(0), _fn = new Float64Array(0);
function ensureCapsScratch(n) {
  if (_sd.length >= n) return;
  _sd = new Float64Array(n); _nx = new Float64Array(n);
  _ny = new Float64Array(n); _nz = new Float64Array(n);
  _order = new Int32Array(n); _fn = new Float64Array(n);
}
// THE TWO ENDS' ROTATIONS, INVERTED, for measuring a point in the frame its extents belong to.
// Null when neither joint is rotated, which is the path every rig took before rotation existed.
// The second is put in the first's hemisphere so a blend between them takes the short way round
// — and since a reflection leaves the dot product alone, a mirrored pair makes the same choice.
function capRotations(p, j) {
  if (!Skeleton.jointRotIsSet(p) && !Skeleton.jointRotIsSet(j)) return null;
  const a = Skeleton.jointRot(p), b = Skeleton.jointRot(j);
  const ia = [-a[0], -a[1], -a[2], a[3]];
  let ib = [-b[0], -b[1], -b[2], b[3]];
  if (ia[0] * ib[0] + ia[1] * ib[1] + ia[2] * ib[2] + ia[3] * ib[3] < 0) ib = ib.map((v) => -v);
  return new Float64Array([ia[0], ia[1], ia[2], ia[3], ib[0], ib[1], ib[2], ib[3]]);
}

// v rotated by the unit quaternion (qx, qy, qz, qw), into `out` — inline, no allocation, since
// this runs per vertex per capsule per relax pass.
function rotInto(qx, qy, qz, qw, vx, vy, vz, out) {
  const tx = 2 * (qy * vz - qz * vy), ty = 2 * (qz * vx - qx * vz), tz = 2 * (qx * vy - qy * vx);
  out[0] = vx + qw * tx + (qy * tz - qz * ty);
  out[1] = vy + qw * ty + (qz * tx - qx * tz);
  out[2] = vz + qw * tz + (qx * ty - qy * tx);
}
const _loc = new Float64Array(3);

function capsuleTarget(p, caps, out) {
  // Pass one: each capsule's signed distance and outward direction at p.
  ensureCapsScratch(caps.length);
  const sd = _sd, nx = _nx, ny = _ny, nz = _nz;
  let dmin = Infinity, rmin = Infinity;
  let nc = 0;
  for (let ci = 0; ci < caps.length; ci++) {
    const c = caps[ci];
    _ax.subVectors(c.b, c.a);
    const len2 = _ax.lengthSq();
    let t = len2 > 1e-18 ? _to.subVectors(p, c.a).dot(_ax) / len2 : 0;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    _cp.copy(c.a).addScaledVector(_ax, t);
    _to.subVectors(p, _cp);
    const l = _to.length();
    // A point sitting exactly on an axis has no direction to be pushed out along; skip that
    // capsule rather than inventing one. Smoothing will have moved it off by the next pass.
    if (l < 1e-9) continue;   // on the axis: no direction to be pushed out along
    // THE HALF-EXTENTS WHERE THIS POINT SITS, lerped between the two ends. `t` is already
    // clamped, so past either end the shape keeps that end's extents and the cap stays that
    // end's ellipsoid. Three numbers rather than one, since a joint can be sized per axis.
    const hx = c.ha[0] + (c.hb[0] - c.ha[0]) * t;
    const hy = c.ha[1] + (c.hb[1] - c.ha[1]) * t;
    const hz = c.ha[2] + (c.hb[2] - c.ha[2]) * t;

    // THE SURFACE IN THIS DIRECTION, measured radially. For a sphere that is the true signed
    // distance; for an ellipsoid it is the distance along the ray from the centre, which is
    // always at least the true (perpendicular) distance and — the part that matters — is zero
    // exactly on the surface and changes sign across it. The relax steps along this same ray,
    // so the two agree and it lands ON the surface rather than near it.
    // A ROTATED END MEASURES IN ITS OWN FRAME: the extents run along the joint's axes, so the
    // offset is taken into that frame first. Blended between the two ends' frames by the same t
    // the extents use (a normalised lerp — t is monotone along the shaft and the two are already
    // in one hemisphere), so a turned palm twists into an unturned finger rather than snapping.
    // A rotation keeps length, so `l` below is still the distance and only the direction's
    // components change.
    let lx = _to.x, ly = _to.y, lz = _to.z;
    const ri = c.ri;
    if (ri) {
      let qx = ri[0] + (ri[4] - ri[0]) * t, qy = ri[1] + (ri[5] - ri[1]) * t;
      let qz = ri[2] + (ri[6] - ri[2]) * t, qw = ri[3] + (ri[7] - ri[3]) * t;
      const ql = Math.hypot(qx, qy, qz, qw) || 1;
      qx /= ql; qy /= ql; qz /= ql; qw /= ql;
      rotInto(qx, qy, qz, qw, lx, ly, lz, _loc);
      lx = _loc[0]; ly = _loc[1]; lz = _loc[2];
    }
    const ux = lx / Math.max(hx, 1e-9);
    const uy = ly / Math.max(hy, 1e-9);
    const uz = lz / Math.max(hz, 1e-9);
    // THE NORM'S EXPONENT IS THE SHAPE. |x|^p + |y|^p + |z|^p = 1 is an ellipsoid at p = 2 and
    // approaches a box as p grows — every squircle in between, from one number. Lerped along the
    // bone like the half-extents are, so a boxy palm blends into a round finger rather than
    // stepping at the joint. matt: "if i could choose how much to blend it towards a cube shape,
    // that would help the initial layout a lot."
    //
    // p === 2 SHORT-CIRCUITS to hypot, which is not just tidiness: this is the innermost loop of
    // the relax, run per vertex per capsule per pass, and Math.pow three times over is many times
    // the cost of a hypot. Almost every joint is round, so almost every joint pays nothing.
    const pw = c.pa + (c.pb - c.pa) * t;
    const lu = (pw <= 2.0001)
      ? Math.hypot(ux, uy, uz)
      : Math.pow(Math.pow(Math.abs(ux), pw) + Math.pow(Math.abs(uy), pw)
               + Math.pow(Math.abs(uz), pw), 1 / pw);
    if (lu < 1e-9) continue;
    const cr = l / lu;                      // the surface's distance from the axis, this way
    const d = l - cr;                       // negative inside
    sd[nc] = d; nx[nc] = _to.x / l; ny[nc] = _to.y / l; nz[nc] = _to.z / l;
    nc++;
    if (d < dmin) dmin = d;
    // The FINEST feature here, which is the smallest of the three half-extents rather than the
    // radius: a joint squashed flat in Z has to keep a blend narrow enough not to fill it back
    // out again.
    // A volume's own `fine`: its depth along the bone is only the dome, not a feature.
    const fine = c.fine || Math.min(hx, hy, hz);
    _fn[nc - 1] = fine;
    if (fine < rmin) rmin = fine;
  }
  if (!(dmin < Infinity)) return out.copy(p);
  // ONLY THE SHAPES THAT REACH THIS POINT. Every shape in the skeleton used to count, so the thinnest
  // bone anywhere set how hard every seam was: a clavicle or a finger creased the hips, which is what cut
  // the sockets into them. A shape counts within its own size of the nearest surface.
  rmin = Infinity;
  let rbig = 0;
  for (let i = 0; i < nc; i++) {
    if (sd[i] - dmin >= _fn[i]) continue;
    if (_fn[i] < rmin) rmin = _fn[i];
    if (_fn[i] > rbig) rbig = _fn[i];
  }
  if (rbig > rmin) rmin *= Math.pow(rbig / rmin, BLEND_MIX);

  // THE BLEND WIDTH IS A LENGTH, and it has to be one that exists in the scene or the soft-min
  // is either a hard min (creases) or a mush (limbs merge). The smallest radius in play is the
  // finest feature anything nearby can have, so blending over a fraction of it keeps a thin
  // bone from being swallowed by a fat joint beside it.
  // Overridable as window._boneSkinBlend, for the same reason PROJECT_RATE is: this is the
  // number to bisect when limbs that should be separate arrive welded together.
  //
  // THE SUSPECT WHEN SOME FINGERS COLLAPSE AND OTHERS DO NOT. The fold below is over every
  // capsule near the point, siblings included, and a smooth-min only ever ADDS — so the gap
  // between two fingers is filled from both sides at once. An INNER finger has a sibling either
  // side of it and an outer one has a sibling on a single side, which is an asymmetry in the rig
  // rather than in the code, and it predicts exactly the shape of the complaint: the two middle
  // fingers weld to the palm and the two outside ones do not.
  const blendFrac = typeof window._boneSkinBlend === 'number'
    ? Math.max(0, Math.min(2, window._boneSkinBlend)) : BLEND_FRAC;
  const k = Math.max(rmin * blendFrac, 1e-6);

  // POLYNOMIAL SMOOTH-MIN, folded pairwise. log-sum-exp was the first version and is BIASED:
  // where two equal surfaces meet it returns min - width*log(2), so every seam gains a fifth of
  // a radius whatever the width is set to — a bulge that no tuning removes. This one is exactly
  // min() once two distances are further apart than k, and departs from it by at most k/4, at
  // the seam, which is the rounding that is wanted there.
  //
  // The normal is blended by the same h, so the step direction turns through the seam instead
  // of switching at it — that switch is what creased the very first version of this function.
  // FOLDED IN SORTED ORDER, nearest first. The fold is order-dependent for three or more
  // capsules — enough so that a symmetric skeleton came back with 164 vertices missing their
  // mirror twin — and sorting removes the dependence outright: the result is then a function of
  // the SET of distances, which the left and right halves of a mirrored rig share exactly.
  // INSERTION SORT, no comparator closure and no allocation. `nc` is the number of capsules
  // that had anything to say about this point — a handful — and insertion sort is the right
  // shape at that size as well as the cheap one.
  for (let i = 0; i < nc; i++) {
    let k = i - 1;
    const v = i;
    while (k >= 0 && sd[_order[k]] > sd[v]) { _order[k + 1] = _order[k]; k--; }
    _order[k + 1] = v;
  }

  let d = Infinity;
  _grad.set(0, 0, 0);
  let first = true;
  for (let oi = 0; oi < nc; oi++) {
    const i = _order[oi];
    if (first) { d = sd[i]; _grad.set(nx[i], ny[i], nz[i]); first = false; continue; }
    const b = sd[i];
    const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (b - d)) / k));
    // mix(b, d, h) - k*h*(1-h). Symmetric in the two arguments, so a vertex equidistant from a
    // left and a right capsule gets the same answer whichever was listed first — the mirror
    // seam is held by the maths rather than by array order.
    d = b + (d - b) * h - k * h * (1 - h);
    _grad.set(nx[i] + (_grad.x - nx[i]) * h,
              ny[i] + (_grad.y - ny[i]) * h,
              nz[i] + (_grad.z - nz[i]) * h);
  }
  if (first) return out.copy(p);

  const gl = _grad.length();
  if (gl < 1e-9) return out.copy(p);
  _grad.divideScalar(gl);
  return out.copy(p).addScaledVector(_grad, -d);

}

// Smooth, then pull back onto the capsules, and hold the seam on the symmetry plane.
//
// The seam has to be pinned explicitly. Smoothing is an averaging operation and the two sides
// of a limb are not exactly equal once the capsules differ, so without the pin the centre line
// drifts off x=0 a little more each pass and the symmetry that the world-aligned boxes bought
// is gone by the last one.
function relax(verts, faces, caps) {
  const nbV = verts.length / 3;
  const nbr = [];
  for (let i = 0; i < nbV; i++) nbr.push([]);
  const seen = new Set();
  for (let f = 0; f < faces.length; f += 4) {
    const q = [faces[f], faces[f + 1], faces[f + 2], faces[f + 3]];
    const n = q[3] === Utils.TRI_INDEX ? 3 : 4;
    for (let i = 0; i < n; i++) {
      const a = q[i], b = q[(i + 1) % n];
      const k = a < b ? a * nbV + b : b * nbV + a;
      if (seen.has(k)) continue;
      seen.add(k);
      nbr[a].push(b); nbr[b].push(a);
    }
  }

  const onSeam = new Uint8Array(nbV);
  for (let i = 0; i < nbV; i++) if (Math.abs(verts[i * 3 + SYM_AXIS]) < 1e-9) onSeam[i] = 1;

  const p = new THREE.Vector3(), t = new THREE.Vector3(), avg = new THREE.Vector3();
  const wrapRate = typeof window._boneSkinWrapRate === 'number'
    ? Math.max(0, Math.min(1, window._boneSkinWrapRate)) : PROJECT_RATE;
  let src = verts;
  for (let pass = 0; pass < RELAX_PASSES; pass++) {
    const dst = new Float32Array(src.length);
    for (let i = 0; i < nbV; i++) {
      p.set(src[i * 3], src[i * 3 + 1], src[i * 3 + 2]);
      const ns = nbr[i];
      if (ns.length) {
        avg.set(0, 0, 0);
        for (const n of ns) avg.set(avg.x + src[n * 3], avg.y + src[n * 3 + 1], avg.z + src[n * 3 + 2]);
        avg.divideScalar(ns.length);
        p.lerp(avg, SMOOTH_RATE);
      }
      capsuleTarget(p, caps, t);
      p.lerp(t, wrapRate);
      if (onSeam[i]) p.setComponent(SYM_AXIS, 0);
      dst[i * 3] = p.x; dst[i * 3 + 1] = p.y; dst[i * 3 + 2] = p.z;
    }
    src = dst;
  }
  return src;
}

// -----------------------------------------------------------------------------------------
// Assembly
// -----------------------------------------------------------------------------------------

// THE BOX AT ONE JOINT: where it sits, how big it is, which way each bone leaves it, and which
// rectangle of which face each of those bones claims.
//
// Lifted out of buildArrays so the ATTACHMENT PREVIEW can ask the generator where the bones will
// land instead of working it out again. A second implementation of this is precisely how the
// joint volumes drifted from the thing they claimed to describe: four consumers, each re-deriving
// the shape, agreeing at first and diverging on the cases that mattered. There is one answer
// here, and the preview shows it rather than a picture of it.
// WRAPPING THE BONE VOLUMES. With Bone Volumes on (the flag the bind and the drawing read) they ARE the
// shape: Tweak Joint edits them, and the joint shapes below have no controls left. This wrapped the joint
// shapes regardless, so a volume's width, height, offset, twist, ends and sharpness all reached the
// weights and none of them reached the skin. Null with the flag off, or on a rig with no radii.
//
// ONE CAP PER VOLUME, the drawn shape in the relax's own terms: a segment, the section as half-extents in
// the volume's frame, its sharpness, and the drawn dome's depth along the bone.
//
// EXCEPT WHERE IT MEETS A NEIGHBOUR. A volume stops short of its joint by a gap, which is right for
// weights (the split falls in it) and wrong for a surface: wrapped literally, two domes facing each other
// pinch the skin to nothing at every joint, like a string of sausages. So an end with a neighbour runs on
// to the joint, and a free end (a fingertip, an end pulled past the tip) stays exactly where it was drawn.
// By how much depends on the neighbour's size: a thin neck leaves the chest's end as drawn, as carrying
// the whole chest to the neck joint would wrap a shelf over its base. A neighbour of its own size or
// larger closes the gap completely.
//
// JUST OUTSIDE THE VOLUME, by VOLUME_MARGIN of its section. Exactly on it, smoothing leaves most of the skin
// a hair inside and the volume shows through (skinny_v07: 1870 of 2530 vertices inside at 1.0, 297 at 1.04,
// 277 at 1.08), and volumes belong under the surface. More only crowds fingers: crossing pairs on a hand
// go 10, 23, 39 over the same three. Overridable as window._boneSkinMargin.
const VOLUME_MARGIN = 1.04;
// The ball at a branch: full size, as anything smaller left the biped's limbs crossing (0 pairs at 1, 44 at 0.85).
const HUB_SIZE = 1;
// A joint bending further than this between its two volumes gets a ball too, the size of the limb that
// carries on: a clavicle into an upper arm, which otherwise turns a squared-off corner. Not the larger
// volume's size, as at a branch: a fat hip into a thin thigh grew lobes that way. Elbows and knees sit under it.
const BEND_BALL = Math.cos(60 * Math.PI / 180);
// Two bones this close to one line are one limb carrying on: a neck into a head, a finger off a palm.
const ALONG = 0.7;
// THIN ROOTS FLARE. A limb leaving a fatter volume at an angle widens towards it at that end, this far from its
// own size to the fat one's: thigh into hip, clavicle into chest, the mass matt sculpted where a plain tube
// left a T-bar. Against biped_resculpt.sxr, surface distance on hips, legs and shoulder: 0 .279 .284 .342,
// 0.5 .213 .216 .315. Higher reads closer but stretches quads (worst 5.6 at 0.5, 7.3 at 0.75, 11.9 at 1).
const ROOT_FLARE = 0.5;
const FLARE_MIN_RATIO = 1.3;
// ...but not towards a limb running alongside within this fraction of the gap: two thighs flaring at each other
// crushed the crotch into 8.4:1 quads, 5.6 without.
const FLARE_ROOM = 0.3;
// A fat end stays a dome when it overlaps a limb this much thinner carrying straight on, see `reach`.
const DOME_RATIO = 0.8;
let _vols = null;
const volSize = (v) => Math.sqrt(v.rw * v.rh);
const volEnd = (v, at) => (at === v.j ? v.f.C0.clone().addScaledVector(v.f.d, v.f.axial) : v.f.C0.clone());
// The distance from a point to a volume's axis, and that nearest point when `out` is given.
function toAxis(x, v, out) {
  const t = Math.max(0, Math.min(v.f.axial, new THREE.Vector3().subVectors(x, v.f.C0).dot(v.f.d)));
  const q = v.f.C0.clone().addScaledVector(v.f.d, t);
  if (out) out.copy(q);
  return q.distanceTo(x);
}
// Half-extents along the world axes of a set of volumes; `along` says how deep each counts along its own bone.
function worldExtents(list, along) {
  const h = [0, 0, 0];
  for (const v of list) {
    const f = v.f, l = along(v);
    for (let k = 0; k < 3; k++) {
      const a = f.e1.getComponent(k) * v.rw, c = f.e3.getComponent(k) * v.rh, d = f.d.getComponent(k) * l;
      h[k] = Math.max(h[k], Math.sqrt(a * a + c * c + d * d));
    }
  }
  return h;
}
function volumeShapes(main, all) {
  if (!Skeleton.displayFlag('volumes')) return null;
  const vols = [], touching = new Map();
  const touch = (j, v) => { if (!touching.has(j)) touching.set(j, []); touching.get(j).push(v); };
  for (const j of all) {
    if (!Skeleton.boneHasCapsule(j)) continue;
    const f = Skeleton.volumeFrame(main, j);
    if (!(f.len > 1e-9)) continue;
    const v = { j: j, p: j._parentMesh, f: f, rw: Math.max(f.r * f.W, 1e-6), rh: Math.max(f.r * f.H, 1e-6) };
    vols.push(v);
    touch(j, v);
    touch(v.p, v);
  }
  if (!vols.length) return null;

  const reach = (v, at) => {                    // 0 = stop as drawn, 1 = run on to the joint
    const list = touching.get(at);
    let big = 0;
    for (const o of list) if (o !== v) big = Math.max(big, volSize(o));
    // NOTHING TO CLOSE: a fat end already overlapping a thinner limb that carries straight on keeps its dome.
    // Running on buried the neck and made head and neck one column, 2.47 wide where matt's resculpt is 1.85.
    if (list.length === 2 && big < volSize(v) * DOME_RATIO) {
      const o = list[0] === v ? list[1] : list[0];
      if (Math.abs(o.f.d.dot(v.f.d)) > ALONG && toAxis(volEnd(v, at), o) < volSize(o)) return 0;
    }
    return Math.min(1, big / volSize(v));
  };
  const flared = (v, at, h) => {                // this end's section, h[0] and h[2] being the shaft's
    let fat = null;
    for (const o of touching.get(at)) if (o !== v && (!fat || volSize(o) > volSize(fat))) fat = o;
    if (!fat || volSize(fat) < FLARE_MIN_RATIO * volSize(v) || Math.abs(fat.f.d.dot(v.f.d)) > ALONG) return h;
    const k = 1 + ROOT_FLARE * (volSize(fat) / volSize(v) - 1), out = [h[0] * k, h[1], h[2] * k];
    const e = volEnd(v, at), near = new THREE.Vector3();
    for (const o of vols) {
      if (o === v || Math.abs(o.f.d.dot(v.f.d)) < ALONG) continue;
      if (touching.get(v.p).includes(o) || touching.get(v.j).includes(o)) continue;
      const dist = toAxis(e, o, near);
      if (dist < 1e-6) continue;
      near.sub(e).divideScalar(dist);
      const cap = dist * FLARE_ROOM;
      if (Math.abs(near.dot(v.f.e1)) > 0.5 && out[0] > cap) out[0] = h[0];
      if (Math.abs(near.dot(v.f.e3)) > 0.5 && out[2] > cap) out[2] = h[2];
    }
    return out;
  };
  const caps = [], half = new Map(), centre = new Map(), free = new Map();
  for (const v of vols) {
    const f = v.f, fine = Math.min(v.rw, v.rh);
    // A FULL DOME, deeper than the drawn bevel (half this, Skeleton.updateVisuals): a section-deep end is what
    // makes a head a head and takes the rim off a fat short volume like a hip, where the drawn one left a ledge.
    // So a drawn volume's flat rim can show through the skin at a free end.
    const b = Math.max(Math.min(fine, 0.5 * f.axial), 1e-6);
    // Along the bone from C0: where the shaft ends, the dome then reaching `b` past it.
    const r0 = reach(v, v.p), r1 = reach(v, v.j);
    let s0 = b + (-f.inset - b) * r0;
    let s1 = (f.axial - b) + (f.inset + b) * r1;
    if (s1 < s0) s0 = s1 = (s0 + s1) / 2;
    const iq = f.Q.clone().invert();
    const ri = new Float64Array([iq.x, iq.y, iq.z, iq.w, iq.x, iq.y, iq.z, iq.w]);
    const pw = Skeleton.volumeRound(v.j);
    const margin = typeof window._boneSkinMargin === 'number' ? window._boneSkinMargin : VOLUME_MARGIN;
    const h = [v.rw * margin, b, v.rh * margin];
    v.cap = { a: f.C0.clone().addScaledVector(f.d, s0), b: f.C0.clone().addScaledVector(f.d, s1),
      ha: flared(v, v.p, h), hb: flared(v, v.j, h), pa: pw, pb: pw, ri: ri, fine: fine, vol: v };
    caps.push(v.cap);
  }

  // THE BOX AT A JOINT: as big as the volumes touching it, axis by axis (the boxes stay world-aligned, so
  // a volume's section is taken through its frame), and centred on them. A free end dragged off its joint
  // takes its box along, inside the end, so the cap wraps that end rather than stretching along the bone
  // to reach it. Only when dragged: moving every leaf's box this way crossed neighbouring fingers (235
  // face pairs against 78 on a crowded hand).
  for (const [j, list] of touching) {
    const h = worldExtents(list, (v) => Math.min(v.rw, v.rh)), off = new THREE.Vector3();
    for (const v of list) off.addScaledVector(v.f.e1, v.f.o1 * v.f.r).addScaledVector(v.f.e3, v.f.o3 * v.f.r);
    half.set(j, h);
    const c = Skeleton.jointPos(j).add(off.divideScalar(list.length));
    const moved = list.length === 1 && (list[0].j === j ? list[0].f.end1 : list[0].f.end0);
    if (moved) {
      const v = list[0], f = v.f, tip = v.j === j;
      const hd = Math.abs(f.d.x) * h[0] + Math.abs(f.d.y) * h[1] + Math.abs(f.d.z) * h[2];
      const t = tip ? Math.max(f.axial - hd, f.axial / 2) : Math.min(hd, f.axial / 2);
      c.copy(f.C0).addScaledVector(f.d, t);
      // Where boxAt seats the box once it knows its clamped size: the end, and the way out through it.
      free.set(j, { end: tip ? f.C0.clone().addScaledVector(f.d, f.axial) : f.C0.clone(), out: tip ? f.d.clone() : f.d.clone().negate() });
    }
    centre.set(j, c);
    // A BRANCH HAS TO BE ONE MASS. Three or more bones meeting leave their roots converging on one point in
    // open space, where the volumes have no shape to absorb them, and those tubes pass through each other.
    const bend = list.length === 2 && list[0].f.d.dot(list[1].f.d) < BEND_BALL;
    if (list.length >= 3 || bend) {
      const kid = bend && list.find((v) => v.p === j);
      // ...and no deeper along the fattest bone than the limb carrying on past it: a chest's ball the chest's
      // own depth rose 2.85 up the neck and buried it. Flattened, 1.57.
      let fat = list[0], on = 0;
      for (const v of list) if (volSize(v) > volSize(fat)) fat = v;
      for (const v of list) if (v !== fat && Math.abs(v.f.d.dot(fat.f.d)) > ALONG) on = Math.max(on, volSize(v));
      const hh = on > 0 ? worldExtents(list, (v) => (v === fat ? on : Math.min(v.rw, v.rh))) : h;
      const hub = kid ? [volSize(kid), volSize(kid), volSize(kid)] : [hh[0] * HUB_SIZE, hh[1] * HUB_SIZE, hh[2] * HUB_SIZE];
      caps.push({ a: c.clone(), b: c.clone(), ha: hub, hb: hub, pa: 2, pb: 2, ri: new Float64Array([0, 0, 0, 1, 0, 0, 0, 1]),
        fine: Math.min(hub[0], hub[1], hub[2]), hub: j });
    }
  }
  return { caps: caps, half: half, centre: centre, touching: touching, free: free };
}
function shapeCentre(j) {
  const c = _vols && _vols.centre.get(j);
  return c ? c.clone() : Skeleton.jointCentre(j);
}
// Is `x` inside this cap? The relax's own measure: the p-norm of the offset, in units of the extents.
const _ciA = new THREE.Vector3(), _ciT = new THREE.Vector3(), _ciL = new Float64Array(3);
function insideCap(c, x) {
  _ciA.subVectors(c.b, c.a);
  const l2 = _ciA.lengthSq();
  let t = l2 > 1e-18 ? _ciT.subVectors(x, c.a).dot(_ciA) / l2 : 0;
  t = t < 0 ? 0 : (t > 1 ? 1 : t);
  _ciT.copy(c.a).addScaledVector(_ciA, t).subVectors(x, _ciT);
  rotInto(c.ri[0], c.ri[1], c.ri[2], c.ri[3], _ciT.x, _ciT.y, _ciT.z, _ciL);
  const ux = _ciL[0] / (c.ha[0] + (c.hb[0] - c.ha[0]) * t), uy = _ciL[1] / (c.ha[1] + (c.hb[1] - c.ha[1]) * t),
    uz = _ciL[2] / (c.ha[2] + (c.hb[2] - c.ha[2]) * t);
  const n = c.pa <= 2.0001 ? Math.hypot(ux, uy, uz)
    : Math.pow(Math.pow(Math.abs(ux), c.pa) + Math.pow(Math.abs(uy), c.pa) + Math.pow(Math.abs(uz), c.pa), 1 / c.pa);
  return n < 1;
}

// WHERE A JOINT'S CAGE BOX IS BUILT, which is its shape's centre unless that centre is BURIED in
// its parent's shape.
//
// A shoulder drawn inside a wide chest is the case: the chest's shape reaches past the shoulder
// joint, so the shoulder's box sits half inside the chest, the relax pushes those inside vertices
// out onto the chest's surface, and they fold into a crease down the shoulder. matt, on biped2:
// "i have scaled the chest wide, its getting the pinching i was talking about at the shoulders."
// Measured there: arm_01_L sits at 0.95 of the chest's own radius in that direction.
//
// So a buried joint's box is built just OUTSIDE the parent's surface instead, moved the way its
// LIMB CONTINUES — towards its own children — until it clears, plus half its own extent that way
// so the box starts at the surface rather than straddling it. Not along the bone from the parent:
// a hip buried in a pelvis would then be pushed out SIDEWAYS, and the leg would leave the body as
// a shelf; the thigh comes out of the bottom of the pelvis. Never more than 60% of the way to its
// child, so a short limb keeps a bone to bridge. Only
// the CAGE moves: the capsules the relax wraps onto are still the shapes where they were drawn.
// A LEAF is left alone: nothing continues from it, so there is no limb direction to move it along.
//
// window._boneSkinEmbed = false turns it off, for the A/B.
let _cageAt = null;
function extentAlong(j, dir, fallback) {
  const half = Skeleton.jointHalf(j, fallback);
  let x = dir.x, y = dir.y, z = dir.z;
  if (Skeleton.jointRotIsSet(j)) {
    const r = Skeleton.jointRot(j);
    rotInto(-r[0], -r[1], -r[2], r[3], x, y, z, _loc);
    x = _loc[0]; y = _loc[1]; z = _loc[2];
  }
  const ux = x / Math.max(half[0], 1e-9), uy = y / Math.max(half[1], 1e-9), uz = z / Math.max(half[2], 1e-9);
  const pw = Skeleton.jointRound(j);
  const n = (pw <= 2.0001) ? Math.hypot(ux, uy, uz)
    : Math.pow(Math.pow(Math.abs(ux), pw) + Math.pow(Math.abs(uy), pw) + Math.pow(Math.abs(uz), pw), 1 / pw);
  return n > 1e-12 ? 1 / n : 0;
}
// Is `x` inside p's shape? The same measure the relax uses: the p-norm of the offset in p's own
// frame, in units of its half-extents.
const _inV = new THREE.Vector3();
function insideShape(p, cp, x, rb) {
  _inV.subVectors(x, cp);
  const e = extentAlong(p, _inV.lengthSq() > 1e-18 ? _inV.clone().normalize() : _inV.set(0, 1, 0), rb);
  return x.distanceTo(cp) < e;
}
function layoutCages(joints, topo) {
  _cageAt = null;
  if (window._boneSkinEmbed === false) return;
  const map = new Map();
  for (const [p, j] of topo.bones) {
    const nbs = topo.adj.get(j);
    if (nbs.length < 2) continue;                       // a leaf: no limb to follow out
    const rb = boneRadius(p, j);
    const cp = shapeCentre(p), cj = shapeCentre(j);
    // With volumes, buried is inside one that this joint's own bones are not: a shoulder in the chest.
    const own = _vols && (_vols.touching.get(j) || []);
    const buried = _vols
      ? (x) => _vols.caps.some((c) => !own.includes(c.vol) && c.hub !== j && insideCap(c, x))
      : (x) => insideShape(p, cp, x, rb);
    if (!buried(cj)) continue;                          // not buried
    // Which way the limb continues: the mean direction to its children.
    const e = new THREE.Vector3();
    let near = Infinity;
    for (const k of nbs) {
      if (k === p) continue;
      const d = new THREE.Vector3().subVectors(shapeCentre(k), cj);
      near = Math.min(near, d.length());
      e.add(d.normalize());
    }
    if (!(e.lengthSq() > 1e-12) || !(near < Infinity)) continue;
    e.normalize();
    // March out until the point clears the parent's shape, then bisect the crossing.
    let lo = 0, hi = near * 0.6;
    if (buried(_inV.copy(cj).addScaledVector(e, hi).clone())) {
      map.set(j, cj.clone().addScaledVector(e, hi));
      continue;
    }
    for (let it = 0; it < 24; it++) {
      const mid = (lo + hi) / 2;
      if (buried(cj.clone().addScaledVector(e, mid))) lo = mid; else hi = mid;
    }
    const hv = _vols && _vols.half.get(j);
    const ext = hv ? Math.abs(e.x) * hv[0] + Math.abs(e.y) * hv[1] + Math.abs(e.z) * hv[2] : extentAlong(j, e, rb);
    const out = Math.min(hi + 0.5 * ext, near * 0.6);
    map.set(j, cj.clone().addScaledVector(e, out));
  }
  _cageAt = map.size ? map : null;
}
function cageCentre(j) {
  const c = _cageAt && _cageAt.get(j);
  return c ? c.clone() : shapeCentre(j);
}

// A FINGER LEAVES THE PALM THE WAY IT POINTS, IN KNUCKLE ORDER. Box modelling cuts the palm's far
// face into one column per finger and extrudes each straight out; the ZSphere lesson is the same
// (fingers on the side they head for, spread across it). Measured from the palm end's centre, the
// pinky's second joint lies mostly SIDEWAYS, so it was handed the side face and twisted round onto
// it (matt: "it looks about the same as before"). So a limb joined through a floating knuckle is
// seated by its own direction (knuckle -> next joint), tilted towards where its knuckle sits across
// the hub so the fingers keep their order along the face. `d` is rewritten in place.
const KNUCKLE_SPREAD = 0.35;
function knuckleDir(hub, c, nb, d) {
  const k = _viaFloat.get(nb);
  if (!k || !_floatHubs.has(hub)) return;
  const kp = Skeleton.jointPos(k);
  const f = new THREE.Vector3().subVectors(cageCentre(nb), kp);
  if (!(f.lengthSq() > 1e-12)) return;
  f.normalize();
  const off = new THREE.Vector3().subVectors(kp, c);
  off.addScaledVector(f, -off.dot(f));
  if (off.lengthSq() > 1e-12) f.addScaledVector(off.normalize(), KNUCKLE_SPREAD).normalize();
  d.copy(f);
}

// THE PALM END IS AS WIDE AS ITS KNUCKLES. Box modelling sizes the palm box to the knuckle line and
// cuts one column per finger; a box narrower than that seats the outer fingers inboard of their own
// knuckles, so their bridges bend outward and roll (the pinky twisted inside out). Across the hand
// (any axis the fingers do not run along) the box reaches each floating knuckle plus that finger's
// radius. Grows only; the support clamp still bounds it towards real neighbours.
// ...AND IT ENDS AT THE KNUCKLES. Centred on the knuckle line, the box's far face sat past it, up
// against each finger's next joint, and the clamp then shrank the whole box to 62% -- narrower than
// the knuckles again. A box-modelled palm's far face IS the knuckle line, so the box steps back
// along the fingers by its own depth that way.
function palmBack(hub, nbs, c) {
  if (!_floatHubs.has(hub) || !_vols) return;
  const half = _vols.half.get(hub);
  if (!half) return;
  const f = new THREE.Vector3();
  for (const nb of nbs) {
    const k = _viaFloat.get(nb);
    if (k) f.add(new THREE.Vector3().subVectors(cageCentre(nb), Skeleton.jointPos(k)).normalize());
  }
  if (!(f.lengthSq() > 1e-12)) return;
  f.normalize();
  c.addScaledVector(f, -(Math.abs(f.x) * half[0] + Math.abs(f.y) * half[1] + Math.abs(f.z) * half[2]));
}

function knuckleSpan(hub, c, nbs, half) {
  if (!_floatHubs.has(hub)) return;
  for (const nb of nbs) {
    const k = _viaFloat.get(nb);
    if (!k) continue;
    const kp = Skeleton.jointPos(k);
    const f = new THREE.Vector3().subVectors(cageCentre(nb), kp).normalize();
    const rad = nb._boneRadius || 0;
    for (let a = 0; a < 3; a++) {
      if (Math.abs(f.getComponent(a)) > 0.5) continue; // the axis the finger runs along
      half[a] = Math.max(half[a], Math.abs(kp.getComponent(a) - c.getComponent(a)) + rad);
    }
  }
}

function boxAt(j, nbs) {
  // THE BLOCK SITS ON THE SHAPE, and the bones are aimed between SHAPES. Both follow from the
  // envelope being the hull of the shapes rather than of the joints: leave the block on the
  // joint and a tweaked joint gets a cage in one place and a capsule in another, with the
  // bridges stretched between them.
  const c = cageCentre(j);
  palmBack(j, nbs, c);
  // A ROTATED JOINT'S BOX IS THE SAME BOX, TURNED. Everything below — which side a bone points
  // at, how a side divides, the per-axis counts, the clamp's support — is worked out in the box's
  // OWN frame, so the bone directions are taken into that frame here and none of it changes.
  // Only where the lattice lands in the world does (latticePoint). Unrotated stays null, and the
  // arithmetic is then exactly what it was.
  const q = !_vols && Skeleton.jointRotIsSet(j) ? Skeleton.jointQuat(j) : null;
  const qi = q ? q.clone().invert() : null;
  let r = 0;
  const dirs = [];
  const lens = [];
  for (const nb of nbs) {
    const d = new THREE.Vector3().subVectors(cageCentre(nb), c);
    lens.push(d.length());
    r = Math.max(r, boneRadius(j, nb));
    d.normalize();
    knuckleDir(j, c, nb, d);
    if (qi) d.applyQuaternion(qi);
    dirs.push(d);
  }
  // THE JOINT'S OWN RADIUS SIZES ITS BLOCK. The widest bone touching it is the fallback, not
  // the rule — that is what made a head the width of a neck, and a hand the width of a
  // forearm, with nothing to say otherwise. matt: "i need to be able to scale joints, not
  // bones."
  r = Skeleton.jointRadius(j, r);
  // THE LATTICE IS SIZED PER AXIS, from the same jointHalf the capsule uses.
  //
  // It used to take the scalar radius, so a joint tweaked flat and wide got a UNIFORM CUBE for a
  // cage and an anisotropic ellipsoid for a target, and relax squashed the one onto the other
  // afterwards. Two things were wrong with that. The cage started further from its own target
  // than it needed to, which is work the relax should not have to do — and, worse, the claims
  // were computed on a shape the user had already said was not the shape: tweak a palm flat and
  // the fingers still divided up a square face, so the tweak could not steer the attachment at
  // all. matt: "if i use the tweak joints, i feel the attach cube should reflect those
  // scale/offset changes."
  //
  // The offset needed nothing — `jointCentre` above has always carried it.
  //
  // NO TOPOLOGY MOVES WITH THIS. The faces stay axis-aligned, so which side a bone points at and
  // how a side divides are decided exactly as before; only where the vertices sit changes. That
  // is what keeps this a shape change rather than a rewrite of the part that is hard to get
  // right.
  const half = ((_vols && _vols.half.get(j)) || Skeleton.jointHalf(j, r)).slice();
  knuckleSpan(j, c, nbs, half);
  // ...and the clamp stays, now per axis. A block wider than half the gap to its nearest
  // neighbour reaches into that neighbour's block, and the bridge between them turns inside out.
  // Clamping each axis against the same gap keeps that guarantee in every direction: a joint
  // stretched along one axis is held there and stays free on the others, where it was never in
  // anyone's way.
  // THE CLAMP SHRINKS THE BOX, IT DOES NOT RESHAPE IT.
  //
  // It used to cap each axis at the limit independently, which quietly threw the tweak away: on a
  // hand the nearest neighbour is a finger bone away, so the limit is small, all three axes hit
  // it, and what came back was a CUBE of that size whatever shape had been asked for. It only
  // started obeying the tweak once an axis fell below the limit on its own. matt: "using the
  // joint tweak changes the box pivots, but not their scale unless i make them incredibly narrow.
  // they should match to the apparent bounding box of the joint capsules."
  //
  // So the limit is met by scaling the whole box down UNIFORMLY, until its LARGEST half-extent
  // fits — the proportions the user tweaked survive and only the size gives way, which is what
  // makes the box read as the capsule's bounding box rather than as a cube near it.
  //
  // NO AXIS EVER EXCEEDS THE OLD LIMIT, and that is deliberate rather than incidental. A joint
  // with no tweak comes out exactly where it always did, so nothing that was tuned against this
  // shape moves: I tried the principled version first — bound each box by its SUPPORT towards
  // each neighbour, h·|d|, which is the honest measure of whether two boxes overlap and would
  // have let an untweaked box grow sideways where nothing was in the way. It cost 6 and 110
  // intersecting face pairs on the harness fixtures. The clamp is not only holding boxes apart
  // along their bones; the relax and PROJECT_RATE were tuned with these sizes in play, and a box
  // that is a different size makes a bridge of a different length for the relax to work on.
  // Correct in isolation, wrong in the system — the sizes stay bounded as they were.
  // HOW BIG THE BOX MAY BE, and two ways of asking.
  //
  // SHIPPED (nearest): the limit is the NEAREST neighbour's distance, applied whatever direction
  // that neighbour lies in. Two boxes on one bone then each take at most 45% of the gap, so the
  // pair stays under 1.0 and they cannot meet — the guarantee this clamp exists for.
  //
  // It is also direction-blind, and on a hand that is ruinous. Measured on matt's hand2.sxr: the
  // palm's shape is 6.24 x 4.37 x 2.72 and its cage came out 2.48 x 1.74 x 1.08 — FORTY PERCENT —
  // because its nearest neighbour is a finger base 5.52 away, BELOW it, while the width being
  // shrunk is across the hand. The relax then has to drag the cage out by two and a half times,
  // which is what matt saw: "the top of the wrist hasn't conformed well to the implied capsule;
  // its hugged too closely to the tweaked wrist joint."
  //
  // SUPPORT (window._boneSkinClampMode = 'support'): measure how far the box actually reaches
  // TOWARDS each neighbour — h.|d|, the support function — and scale uniformly until every one of
  // those fits. Correct in the direction that matters and leaves the other axes alone.
  //
  // WHY IT IS NOT THE DEFAULT YET. It needs LENGTH_CLAMP at 0.55 to pass skinbox_test — below
  // that the fixtures come back with intersecting faces, and TIGHTENING makes it worse (2 pairs
  // at 0.45, 8 at 0.35), because box size sets bridge length and a smaller box makes a longer,
  // thinner bridge for limbs to pass through. But 0.55 twice over is 1.10 of the gap, so the
  // "two boxes cannot meet" guarantee above is gone — traded for a shape that fits. That is a
  // judgement about a rig nobody has looked at in a headset yet, so it is a switch until it has
  // been: window._boneSkinClampMode = 'support'; window._boneSkinClamp = 0.55.
  const clampFrac = typeof window._boneSkinClamp === 'number'
    ? Math.max(0.05, Math.min(0.95, window._boneSkinClamp)) : LENGTH_CLAMP;
  let sc = 1;
  // A FLOATING LIMB'S HUB IS CLAMPED BY SUPPORT. A palm end's nearest neighbour is the first finger
  // joint, a phalanx away along the hand, so the nearest-neighbour clamp shrank its width across the
  // hand to that and the four fingers attached through twisted slivers of a box a third of the palm.
  // Support only limits the box towards each neighbour. Not globally: that costs intersecting faces
  // on the fixtures (see SUPPORT above).
  const support = window._boneSkinClampMode === 'support' || _floatHubs.has(j);
  if (support) {
    const frac = window._boneSkinClampMode === 'support' ? clampFrac : SUPPORT_CLAMP;
    for (let i = 0; i < dirs.length; i++) {
      const d = dirs[i];
      const reach = half[0] * Math.abs(d.x) + half[1] * Math.abs(d.y) + half[2] * Math.abs(d.z);
      if (reach > 1e-12) sc = Math.min(sc, (lens[i] * frac) / reach);
    }
  } else {
    const lim = Math.min.apply(null, lens) * clampFrac;
    const big = Math.max(half[0], half[1], half[2]);
    if (big > lim) sc = lim / big;
  }
  const h = [half[0] * sc, half[1] * sc, half[2] * sc];
  if (!(h[0] > 1e-9 && h[1] > 1e-9 && h[2] > 1e-9)) return null;

  // A FREE END'S BOX GOES ON THE END, once it has its real size. Left where it was placed, the clamp's
  // smaller box stops short and the end's quads all come from stretching one small face: the biped's head
  // had a few big quads for a cap and every ring bunched at the neck, its hand a coarse point. On the end,
  // the bridge behind it is longer and takes its share of the rings.
  const fr = _vols && _vols.free.get(j);
  if (fr) c.copy(fr.end).addScaledVector(fr.out, -(Math.abs(fr.out.x) * h[0] + Math.abs(fr.out.y) * h[1] + Math.abs(fr.out.z) * h[2]));

  // THE COUNTS COME OFF THE CLAMPED HALF-EXTENTS, which is the box's real shape — clamping scales
  // uniformly, so it cannot change the proportions this reads, but taking the same array keeps one
  // answer rather than two that agree today.
  const box = boxOf(levelsFor(dirs, h));
  const claims = claimSides(box, dirs);
  if (!claims) return null;
  // `q` is null for an unrotated joint, so every consumer can take its old path verbatim.
  return { c: c, h: h, dirs: dirs, claims: claims, box: box, q: q };
}

// WHERE ONE LATTICE POINT OF A BOX LANDS, in model space. The one placement for the builder and the
// attach preview both, so the patch the preview colours is the patch the skin is cut from.
const _lp = new THREE.Vector3();
function latticePoint(bx, l, out) {
  const n = bx.box.n, h = bx.h;
  _lp.set((h[0] * l[0]) / n[0], (h[1] * l[1]) / n[1], (h[2] * l[2]) / n[2]);
  if (bx.q) _lp.applyQuaternion(bx.q);
  return out.copy(bx.c).add(_lp);
}

// SETTLE ONE BONE'S TWO ENDS on a single loop length. A bone has to meet the same perimeter at
// both ends or there is no all-quad bridge, so the shape belongs to the bone — the smaller of
// what its two ends offer — and the generous end gives up the rest. Shared with the preview for
// the same reason boxAt is: this, not the raw claim, is the rectangle you actually attach
// through, and it is the one that comes out thin.
// EACH END SHRINKS ON ITS OWN BOX, which is the whole point of per-joint levels: the two ends are
// no longer the same lattice. A coarse child usually needs no shrinking at all — its whole face is
// already the size its parent could spare — and that is the case this exists to make rare.
function settleEnds(nEnd, fEnd, nBox, fBox) {
  const want = Math.min(perimeter(nEnd.claim.rect), perimeter(fEnd.claim.rect));
  const nc = perimeter(nEnd.claim.rect) === want
    ? nEnd.claim : shrinkTo(nBox, nEnd.claim, want, nEnd.dir);
  const fc = perimeter(fEnd.claim.rect) === want
    ? fEnd.claim : shrinkTo(fBox, fEnd.claim, want, fEnd.dir);
  return { want: want, nc: nc, fc: fc };
}

function buildArrays(joints, topo) {
  const adj = topo.adj;
  layoutCages(joints, topo);
  const verts = [];
  const boxes = new Map();

  // Pass one: a box at every joint, its bones each holding one block.
  for (const j of joints) {
    const nbs = adj.get(j);
    if (!nbs.length) continue;
    const bx = boxAt(j, nbs);
    if (!bx) continue;
    const dirs = bx.dirs, claims = bx.claims, BX = bx.box;

    // No rotation unless the user asked for one: the lattice goes straight to world, scaled and
    // offset, and that is the whole reason bridges cannot shear against each other. A rotated
    // joint shears its bridges by exactly the turn it was given — which is the edge flow asked
    // for, and matchLoop rolls each bridge to the pairing that twists least.
    const base = verts.length / 3;
    const _v = new THREE.Vector3();
    for (const l of BX.lat) {
      latticePoint(bx, l, _v);
      verts.push(_v.x, _v.y, _v.z);
    }

    const byNeighbour = new Map();
    nbs.forEach((nb, i) => byNeighbour.set(nb, { claim: claims[i], dir: dirs[i] }));
    boxes.set(j, { base: base, by: byNeighbour, dead: new Set(), box: BX });
  }

  // Pass two: settle each bone on one loop length, then bridge.
  const faces = [];
  const posAt = (id) => new THREE.Vector3(verts[id * 3], verts[id * 3 + 1], verts[id * 3 + 2]);
  const pushQuad = (a, b, c, d) => faces.push(a, b, c, d === undefined ? Utils.TRI_INDEX : d);

  let bones = 0;
  const caps = [];
  for (const [p, j] of topo.bones) {
    const near = boxes.get(p), far = boxes.get(j);
    if (!near || !far) continue; // a joint pinched out of existence takes its bone with it
    const nEnd = near.by.get(j), fEnd = far.by.get(p);
    if (!nEnd || !fEnd || !nEnd.claim || !fEnd.claim) continue;

    // KEEP BOTH FACES WHEN ONE IS TWICE THE OTHER, and step between them with a reduction band.
    //
    // settleEnds is still the fallback and still right for every other ratio: a bone has to meet
    // the same loop at both ends or there is nothing to bridge. But 2:1 is the case a rig actually
    // produces — a limb at one level meeting a crowded parent's block at the next level down — and
    // it is the one ratio the wedge pattern handles exactly. So that case keeps both claims and
    // pays for the difference in one band of quads instead of by shrinking a face away.
    const pN = perimeter(nEnd.claim.rect), pF = perimeter(fEnd.claim.rect);
    // window._boneSkinBand = false falls back to settling both ends on the smaller loop, which is
    // what happened before the band existed — kept so its contribution can be measured rather
    // than argued about. window._boneSkinBandAt moves where along the bone it sits.
    const canStep = window._boneSkinBand !== false
      && ((pN === pF * 2 && !(pF & 1)) || (pF === pN * 2 && !(pN & 1)));
    const st = canStep ? { nc: nEnd.claim, fc: fEnd.claim, want: Math.min(pN, pF) }
                       : settleEnds(nEnd, fEnd, near.box, far.box);
    const nc = st.nc, fc = st.fc;
    for (const f of rectFaces(near.box, nc)) near.dead.add(f.join(','));
    for (const f of rectFaces(far.box, fc)) far.dead.add(f.join(','));

    const A = rectLoop(near.box, nc).map((v) => near.base + v);
    const B = rectLoop(far.box, fc).map((v) => far.base + v);
    if (!canStep && A.length !== B.length) continue; // nothing sensible to stitch; leave both closed

    // THE BAND SITS AT THE FINE END, and the rest of the bone is bridged at the coarse count.
    //
    // Its coarse side is a new ring seeded from every OTHER vertex of the fine loop — so the two
    // sides already correspond, with no matching to do — nudged one step along the bone so the
    // band has somewhere to be. Everything after it is the ordinary ring bridge it always was.
    let A2 = A, B2 = B, stepFine = null, stepCoarse = null;
    if (canStep) {
      const fineIsNear = A.length > B.length;
      const fineLoop = fineIsNear ? A : B;
      const coarseLoop = fineIsNear ? B : A;
      const seed = [];
      for (let i = 0; i < fineLoop.length; i += 2) seed.push(fineLoop[i]);
      const target = matchLoop(seed, coarseLoop, posAt);
      const made = [];
      for (let i = 0; i < seed.length; i++) {
        _pStep.set(verts[seed[i] * 3], verts[seed[i] * 3 + 1], verts[seed[i] * 3 + 2]);
        _pStep2.set(verts[target[i] * 3], verts[target[i] * 3 + 1], verts[target[i] * 3 + 2]);
        // A SHORT STEP, not a share of the span: the band is a transition, not a segment of the
        // limb, and a long one would read as a taper rather than a change of resolution.
        _pStep.lerp(_pStep2, typeof window._boneSkinBandAt === 'number'
          ? Math.max(0.02, Math.min(0.5, window._boneSkinBandAt)) : 0.15);
        made.push(verts.length / 3);
        verts.push(_pStep.x, _pStep.y, _pStep.z);
      }
      stepFine = fineLoop; stepCoarse = made;
      // The remaining span runs from the band's coarse side to the far loop, both coarse.
      A2 = fineIsNear ? made : coarseLoop;
      B2 = fineIsNear ? coarseLoop : made;
    }
    const M = matchLoop(A2, B2, posAt);

    // RINGS ALONG THE BONE, not one span. A box is divided four ways a side, so its quads are
    // about a quarter of its width; bridging straight from one box to the other in a single
    // span gives a bone one ring of quads however long it is. On anything but a stubby bone
    // that ring is enormously longer than it is wide, and relax then has nothing to work with
    // along the limb — the capsule it is trying to reach is sampled at two points, so the
    // middle of a long bone just stretches instead of rounding.
    //
    // So the span is cut into rings sized to the LOOP'S OWN edge length, which is the width of
    // the quads it is about to make. That keeps them roughly square without anyone having to
    // pick a density: a short bone still gets one ring, and a long one gets as many as it
    // takes for its quads to match the boxes at either end.
    // The band first, if there is one: it is emitted from the fine loop onto the ring seeded from
    // it, and the ring bridge below then starts at the coarse count.
    if (stepFine && !transitionBand(stepFine, stepCoarse, pushQuad)) {
      // The pattern refused (an odd coarse count reaching here would be a bug, not a rig): fall
      // back rather than leave a hole.
      continue;
    }

    const L = A2.length;
    let span = 0, edge = 0;
    for (let i = 0; i < L; i++) {
      span += posAt(A2[i]).distanceTo(posAt(M[i]));
      edge += posAt(A2[i]).distanceTo(posAt(A2[(i + 1) % L]))
            + posAt(M[i]).distanceTo(posAt(M[(i + 1) % L]));
    }
    span /= L;
    edge /= L * 2;
    let rings = edge > 1e-9 ? Math.round(span / edge) : 1;
    rings = rings < 1 ? 1 : (rings > MAX_SPANS ? MAX_SPANS : rings);

    let prev = A2;
    const _pa = new THREE.Vector3(), _pb = new THREE.Vector3();
    for (let r = 1; r <= rings; r++) {
      let next = M;
      if (r < rings) {
        // Evenly spaced along each rail. Lerp is mirror-safe, so a symmetric skeleton stays
        // symmetric through the subdivision as well as through the relax.
        const t = r / rings;
        next = [];
        for (let i = 0; i < L; i++) {
          _pa.set(verts[A2[i] * 3], verts[A2[i] * 3 + 1], verts[A2[i] * 3 + 2]);
          _pb.set(verts[M[i] * 3], verts[M[i] * 3 + 1], verts[M[i] * 3 + 2]);
          _pa.lerp(_pb, t);
          next.push(verts.length / 3);
          verts.push(_pa.x, _pa.y, _pa.z);
        }
      }
      for (let i = 0; i < L; i++) {
        const i2 = (i + 1) % L;
        pushQuad(prev[i], prev[i2], next[i2], next[i]);
      }
      prev = next;
    }
    // A RADIUS AT EACH END. The number has always lived on a joint — a bone reads its CHILD's —
    // so a bone drawing one uniform capsule was a choice, not a constraint, and it is the choice
    // that made a head or a hand impossible to describe. Now the capsule is a cone between its
    // two joints' radii. A joint with no radius of its own (a root, an unsized tip) falls back
    // to the bone's, which is exactly the old shape.
    const rj = Math.max(boneRadius(p, j), 1e-6);
    // ...and three of them at each end now, so a joint can be wide and shallow. jointHalf is the
    // one definition of how big a joint is; the draw and the handles read the same function.
    const guard = (h) => [Math.max(h[0], 1e-6), Math.max(h[1], 1e-6), Math.max(h[2], 1e-6)];
    // THE ENDS ARE THE SHAPES' CENTRES, not the joints. A face drag moves one face and leaves
    // the other, which shifts the shape off its joint — and the envelope is the hull of the two
    // SHAPES. Reading the joints here would leave the skin behind wherever a joint was tweaked.
    if (!_vols) caps.push({ a: Skeleton.jointCentre(p), b: Skeleton.jointCentre(j),
      ha: guard(Skeleton.jointHalf(p, rj)), hb: guard(Skeleton.jointHalf(j, rj)),
      pa: Skeleton.jointRound(p), pb: Skeleton.jointRound(j),
      ri: capRotations(p, j) });
    bones++;
  }

  // Whatever no bone claimed closes the box. A leaf joint keeps five of its six sides, which
  // is the cap — no dome, no pole, nothing to stitch to anything else.
  for (const box of boxes.values()) {
    for (let si = 0; si < box.box.sides.length; si++) {
      const sd = box.box.sides[si];
      const wholeSide = { a0: 0, a1: sd.nu, b0: 0, b1: sd.nv };
      for (const f of rectFaces(box.box, { side: si, rect: wholeSide })) {
        if (box.dead.has(f.join(','))) continue;
        pushQuad(box.base + f[0], box.base + f[1], box.base + f[2], box.base + f[3]);
      }
    }
  }

  if (!faces.length) return null;

  // Drop vertices no face refers to — the centre vertex of a claimed block is left behind by
  // its own bridge, and a stray vertex is not a crash but it is a lie in the counts and it
  // confuses everything downstream that walks the mesh.
  const used = new Map();
  for (const f of faces) {
    if (f === Utils.TRI_INDEX) continue;
    if (!used.has(f)) used.set(f, used.size);
  }
  const packed = new Float32Array(used.size * 3);
  for (const [old, now] of used) {
    packed[now * 3] = verts[old * 3];
    packed[now * 3 + 1] = verts[old * 3 + 1];
    packed[now * 3 + 2] = verts[old * 3 + 2];
  }
  const idx = new Uint32Array(faces.length);
  for (let i = 0; i < faces.length; i++) {
    idx[i] = faces[i] === Utils.TRI_INDEX ? Utils.TRI_INDEX : used.get(faces[i]);
  }

  const relaxed = window._boneSkinRelax === false ? packed : relax(packed, idx, _vols ? _vols.caps : caps);
  return { vertices: relaxed, faces: idx, boxes: boxes.size, bones: bones };
}

// ── TEMPLATE HANDS ───────────────────────────────────────────────────────────────────────
//
// A wrist carrying HandTemplate's skeleton (Add Hand) is not skinned by the lattice: one tube per
// bone made a palm that collapsed to a stem between forearm and fingers whatever the layout. Its
// joints are left out, so the forearm ends at the wrist; that end is cut open to a ring and bridged
// to matt's modelled hand, fitted to wherever the joints are now (HandFit).
function skinJoints(main) {
  const all = Skeleton.joints(main);
  const hands = [];
  const gone = new Set();
  for (const j of all) {
    const h = HandFit.handAt(main, j);
    if (!h) continue;
    hands.push(h);
    for (const k of HandFit.handJoints(main, h)) gone.add(k);
  }
  return { all: gone.size ? all.filter((j) => !gone.has(j)) : all, hands };
}

// How far back from the wrist the forearm is cut, as a fraction of wrist -> middle knuckle: the
// length the bridge has to taper from the forearm's section to the hand's.
// The biped's forearm is twice the width of a hand's wrist: at 0.22 it pinched into a wineglass.
const HAND_BRIDGE = 0.6;
// Rings inside the bridge.
const HAND_RINGS = 4;

// A BAND OF QUADS BETWEEN TWO RINGS OF DIFFERENT COUNTS (an even difference), the general case of
// transitionBand: each vertex of the smaller ring takes a run of 1 or 3 vertices on the larger one,
// a run of 3 being a wedge (three on the busy side, one on the other) and every step between runs
// an ordinary quad. Which vertices take the wedges is solved for, so every vertex is as near as it
// can be, by angle about the limb, to the one it meets across the band. Rings in the same angular
// direction; `rim` runs the way its kept faces do, `hand` the same way round.
function quadZip(rim, angR, hand, angH, push) {
  const fineIsHand = hand.length > rim.length;
  const fine = fineIsHand ? hand : rim, coarse = fineIsHand ? rim : hand;
  const aF = fineIsHand ? angH : angR, aC = fineIsHand ? angR : angH;
  const F = fine.length, C = coarse.length;
  const wrap = (x) => Math.atan2(Math.sin(x), Math.cos(x));
  const cost = (i, k) => { const d = wrap(aF[i % F] - aC[k]); return d * d; };
  let best = Infinity, plan = null;
  for (let s = 0; s < F; s++) {
    let dp = new Float64Array(F + 1).fill(Infinity);
    dp[0] = 0;
    const back = [];
    for (let k = 0; k < C; k++) {
      const nd = new Float64Array(F + 1).fill(Infinity), bk = new Int8Array(F + 1);
      for (let x = 0; x <= F; x++) {
        if (dp[x] === Infinity) continue;
        for (const g of [1, 3]) {
          if (x + g > F) continue;
          let c = dp[x];
          for (let t = 0; t < g; t++) c += cost(s + x + t, k);
          if (c < nd[x + g]) { nd[x + g] = c; bk[x + g] = g; }
        }
      }
      back.push(bk);
      dp = nd;
    }
    if (dp[F] < best - 1e-12) {
      best = dp[F];
      const sizes = new Array(C);
      for (let k = C - 1, x = F; k >= 0; k--) { sizes[k] = back[k][x]; x -= sizes[k]; }
      plan = { s, sizes };
    }
  }
  if (!plan) return false;
  const f = (i) => fine[(plan.s + i) % F];
  for (let k = 0, p = 0; k < C; k++) {
    const g = plan.sizes[k], c0 = coarse[k], c1 = coarse[(k + 1) % C], x = p + g - 1;
    if (g === 3) push(fineIsHand ? [c0, f(p), f(p + 1), f(p + 2)] : [f(p + 2), f(p + 1), f(p), c0]);
    push(fineIsHand ? [c1, c0, f(x), f(x + 1)] : [f(x + 1), f(x), c0, c1]);
    p += g;
  }
  return true;
}

function attachHands(main, arr, hands) {
  const V = Array.from(arr.vertices);
  let F = Array.from(arr.faces);
  const P = (i, out) => out.set(V[3 * i], V[3 * i + 1], V[3 * i + 2]);
  const _p = new THREE.Vector3(), _c = new THREE.Vector3();
  const nFaces = () => F.length / 4;
  const corners = (f) => (F[4 * f + 3] === Utils.TRI_INDEX ? 3 : 4);
  const centroid = (f, out) => {
    out.set(0, 0, 0);
    const n = corners(f);
    for (let c = 0; c < n; c++) out.add(P(F[4 * f + c], _p));
    return out.divideScalar(n);
  };
  for (const hand of hands) {
    const wrist = hand.wrist, up = wrist._parentMesh;
    const fitted = HandFit.fit(main, hand);
    const base = V.length / 3;
    for (let i = 0; i < fitted.verts.length; i++) V.push(fitted.verts[i]);
    for (let i = 0; i < fitted.faces.length; i++) F.push(fitted.faces[i] + base);
    if (!up) { console.warn('[skin] template hand: wrist has no forearm, hand left unjoined'); continue; }

    // THE CUT: every face of the forearm's end past a plane HAND_BRIDGE back from the wrist, found by
    // flooding from the face furthest out along the forearm, so nothing else past that plane (a thigh
    // beside a hanging hand) is touched.
    const W = Skeleton.jointPos(wrist), d = new THREE.Vector3().subVectors(W, Skeleton.jointPos(up)).normalize();
    const M = Skeleton.jointPos(hand.by.get('middle_01'));
    const handDir = new THREE.Vector3().subVectors(M, W).normalize();
    // The FOREARM's radius (stored on the wrist), widest way across: boneRadiusOf would take the
    // hand's own bones, and a fattened palm then pulled the search out onto whatever lies beside it.
    const sec = Skeleton.volumeSection(wrist);
    const rArm = Math.max((wrist._boneRadius || Skeleton.boneRadiusOf(main, wrist)) * Math.max(1, sec[0], sec[1]), 1e-6);
    const rf = rArm * 3;
    // Never less than the forearm's own radius: the cut has to clear the forearm's rounded end, and a
    // short palm (knuckles pulled in) left that end as a bulb under the hand.
    const gap = Math.max(HAND_BRIDGE * W.distanceTo(M), rArm);
    const along = (f) => centroid(f, _c).sub(W).dot(d);
    const offAxis = (f) => { centroid(f, _c).sub(W); return _c.addScaledVector(d, -_c.dot(d)).length(); };
    const handFaces = new Set();
    for (let f = 0; f < fitted.faces.length / 4; f++) handFaces.add(F.length / 4 - fitted.faces.length / 4 + f);
    // The seed is the face NEAREST THE WRIST: the furthest out along the forearm's line reached the
    // hips past a flattened (wider) forearm, and that side's cut took the torso.
    let seed = -1, best = Infinity;
    for (let f = 0; f < nFaces(); f++) {
      if (handFaces.has(f)) continue;
      const t = along(f);
      if (!(t > -gap && t < rf && offAxis(f) < rf)) continue;
      const dist = centroid(f, _c).distanceTo(W);
      if (dist < best) { best = dist; seed = f; }
    }
    if (seed < 0) { console.warn('[skin] template hand: no forearm end found, hand left unjoined'); continue; }
    const edgeFaces = new Map();
    const ek = (x, y) => (x < y ? x + '_' + y : y + '_' + x);
    for (let f = 0; f < nFaces(); f++) {
      const n = corners(f);
      for (let c = 0; c < n; c++) {
        const k = ek(F[4 * f + c], F[4 * f + (c + 1) % n]);
        if (!edgeFaces.has(k)) edgeFaces.set(k, []);
        edgeFaces.get(k).push(f);
      }
    }
    const cut = new Set([seed]);
    const stack = [seed];
    while (stack.length) {
      const f = stack.pop(), n = corners(f);
      for (let c = 0; c < n; c++) {
        for (const g of edgeFaces.get(ek(F[4 * f + c], F[4 * f + (c + 1) % n]))) {
          if (cut.has(g) || handFaces.has(g) || along(g) <= -gap) continue;
          cut.add(g); stack.push(g);
        }
      }
    }
    // A PLANE CROSSES THE RINGS ON A SLANT and leaves a staircase. A kept face touching the cut on two
    // or more edges is a notch in it: fill notches until none are left, and the rim is a whole ring.
    for (let grew = true; grew;) {
      grew = false;
      for (let f = 0; f < nFaces(); f++) {
        if (cut.has(f) || handFaces.has(f)) continue;
        const n = corners(f);
        let touch = 0;
        for (let c = 0; c < n; c++) {
          if (edgeFaces.get(ek(F[4 * f + c], F[4 * f + (c + 1) % n])).some((g) => cut.has(g))) touch++;
        }
        if (touch >= 2) { cut.add(f); grew = true; }
      }
    }
    // The ring left behind, in the direction the KEPT faces run it.
    const next = new Map();
    for (let f = 0; f < nFaces(); f++) {
      if (cut.has(f) || handFaces.has(f)) continue;
      const n = corners(f);
      for (let c = 0; c < n; c++) {
        const x = F[4 * f + c], y = F[4 * f + (c + 1) % n];
        if (edgeFaces.get(ek(x, y)).some((g) => cut.has(g))) next.set(x, y);
      }
    }
    const ring = [];
    if (next.size) {
      let x = next.keys().next().value;
      while (ring.length <= next.size && x !== undefined) { ring.push(x); x = next.get(x); if (x === ring[0]) break; }
    }
    const L = fitted.loop.length;
    if (ring.length !== next.size || ring.length < 3) {
      console.warn('[skin] template hand: forearm cut is not one ring (' + next.size + ' edges); hand left unjoined');
      continue;
    }
    for (let f = nFaces() - 1; f >= 0; f--) if (cut.has(f)) F.splice(4 * f, 4);
    const N = ring.length;
    // THE HAND'S RING in the order its faces run it, then turned round and rolled to sit against the
    // forearm's: the bridge runs each ring against the faces on both sides.
    const lp = fitted.loop.map((i) => i + base);
    let fwd = false;
    for (let f = 0; f < fitted.faces.length / 4 && !fwd; f++) {
      for (let c = 0; c < 4; c++) {
        if (fitted.faces[4 * f + c] + base === lp[0] && fitted.faces[4 * f + (c + 1) % 4] + base === lp[1]) fwd = true;
      }
    }
    const hring = fwd ? lp.slice() : lp.slice().reverse();     // in face order
    const want = hring.slice().reverse();                      // bridge runs it backwards
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    // ring[i] -> ring[i+1] is the KEPT face's direction, so the bridge takes ring[i+1] -> ring[i];
    // B is ordered the same way round, and the hand's faces run it the other way. A holds, for each
    // of B, the point on the forearm's rim its curve leaves from.
    let B, A, zip = null;
    if (N === L) {
      let roll = 0, cost = Infinity;
      for (let r = 0; r < L; r++) {
        let s = 0;
        for (let i = 0; i < L; i++) s += P(ring[i], a).distanceToSquared(P(want[(i + r) % L], b));
        if (s < cost) { cost = s; roll = r; }
      }
      B = ring.map((_, i) => want[(i + roll) % L]);
      A = ring.map((ri) => P(ri, new THREE.Vector3()));
    } else {
      // A FOREARM OF ANOTHER SECTION (a flattened or thinned volume changes how many sides its tube
      // has): the rims are matched by ANGLE about the forearm, the hand's vertices leave from the
      // forearm rim at their own angles, and the first band takes up the difference in counts with
      // wedges (see quadZip). Angles about the axis reflect with the rig, so a mirrored pair of arms
      // gets a mirrored pair of joins.
      if ((N - L) % 2) { console.warn('[skin] template hand: forearm rim has ' + N + ' sides, odd against ' + L + '; hand left unjoined'); continue; }
      const u = new THREE.Vector3(1, 0, 0).addScaledVector(d, -d.x);
      if (u.lengthSq() < 0.04) u.set(0, 1, 0).addScaledVector(d, -d.y);
      u.normalize();
      const v = new THREE.Vector3().crossVectors(d, u);
      const centre = (ids) => ids.reduce((s, i) => s.add(P(i, a)), new THREE.Vector3()).divideScalar(ids.length);
      const cR = centre(ring), cB = centre(want);
      const angOf = (ids, c) => ids.map((i) => { P(i, a).sub(c); return Math.atan2(a.dot(v), a.dot(u)); });
      const wrap = (x) => Math.atan2(Math.sin(x), Math.cos(x));
      const sense = (ang) => Math.sign(ang.reduce((s, x, i) => s + wrap(ang[(i + 1) % ang.length] - x), 0));
      let angR = angOf(ring, cR), angW = angOf(want, cB);
      const sR = sense(angR), sW = sense(angW);
      if (!sR || sR !== sW) { console.warn('[skin] template hand: rims run opposite ways; hand left unjoined'); continue; }
      angR = angR.map((x) => x * sR); angW = angW.map((x) => x * sR);
      const TAU = 2 * Math.PI, mod = (x) => ((x % TAU) + TAU) % TAU;
      // Start the hand ring at the vertex nearest the rim's first.
      let j0 = 0;
      for (let j = 1; j < L; j++) if (Math.abs(wrap(angW[j] - angR[0])) < Math.abs(wrap(angW[j0] - angR[0]))) j0 = j;
      B = want.map((_, i) => want[(i + j0) % L]);
      const angB = angW.map((_, i) => angW[(i + j0) % L]);
      const relR = angR.map((x) => mod(x - angR[0])).concat([TAU]);
      const d0 = wrap(angB[0] - angR[0]);
      const relB = angB.map((x) => d0 + mod(x - angB[0])).concat([d0 + TAU]);
      A = relB.slice(0, L).map((th) => {
        th = mod(th);
        let j = 0;
        while (j < N - 1 && relR[j + 1] <= th) j++;
        const s = (th - relR[j]) / Math.max(relR[j + 1] - relR[j], 1e-9);
        return P(ring[j], new THREE.Vector3()).lerp(P(ring[(j + 1) % N], b), Math.max(0, Math.min(1, s)));
      });
      zip = { angR, angB };
    }
    let prev = ring;
    for (let k = 1; k <= HAND_RINGS + 1; k++) {
      let cur;
      if (k === HAND_RINGS + 1) cur = B;
      else {
        // A HERMITE CURVE per vertex pair, leaving the forearm along the forearm and arriving along
        // the hand, so the taper eases in and out rather than kinking at both rims.
        const t = k / (HAND_RINGS + 1), t2 = t * t, t3 = t2 * t;
        const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
        cur = B.map((bi, i) => {
          a.copy(A[i]); P(bi, b);
          const len = a.distanceTo(b);
          const x = new THREE.Vector3().copy(a).multiplyScalar(h00).addScaledVector(d, h10 * len)
            .addScaledVector(b, h01).addScaledVector(handDir, h11 * len);
          V.push(x.x, x.y, x.z);
          return V.length / 3 - 1;
        });
      }
      if (k === 1 && zip) {
        quadZip(prev, zip.angR, cur, zip.angB, (q) => F.push(q[0], q[1], q[2], q[3]));
      } else {
        for (let i = 0; i < L; i++) {
          const i1 = (i + 1) % L;
          F.push(prev[i1], prev[i], cur[i], cur[i1]);
        }
      }
      prev = cur;
    }
  }
  // Repack: the cut leaves its vertices behind.
  const used = new Map();
  for (const f of F) if (f !== Utils.TRI_INDEX && !used.has(f)) used.set(f, used.size);
  const vertices = new Float32Array(used.size * 3);
  for (const [old, now] of used) { vertices[3 * now] = V[3 * old]; vertices[3 * now + 1] = V[3 * old + 1]; vertices[3 * now + 2] = V[3 * old + 2]; }
  const faces = new Uint32Array(F.length);
  for (let i = 0; i < F.length; i++) faces[i] = F[i] === Utils.TRI_INDEX ? Utils.TRI_INDEX : used.get(F[i]);
  return Object.assign({}, arr, { vertices, faces });
}

// The joints that get no box: Shapes Skin off, and every FLOATING joint with bones of its own.
//
// A floating knuckle's box sat right beside the middle knuckle's, and the box clamp (each box under
// half the gap to its nearest neighbour) shrank both to slivers: four fingers crammed onto a tiny
// palm end, joined sideways at a right angle the relax inflated over and a smooth pulled into thin
// necks. matt: "i checked the hand, no, its done a pretty bad job there too." With no box of its
// own, a floating joint's limb runs straight from where it joins (adjacency), whose box is now
// sized by real neighbours, so the fingers fan out of one palm block. A floating LEAF keeps its box:
// with nothing leaving it there is no limb to run on.
//
// Not the hips: legs floating off a pelvis this way meet in one trunk (a wishbone, hips .39 against
// .245 on biped_resculpt), because the thigh tops are where the hip mass is. Hips keep connected
// hip bones.
function skinSkip(all) {
  const parents = new Set(all.map((k) => k._parentMesh));
  return new Set(all.filter((j) => !Skeleton.jointShapesSkin(j) || (Skeleton.boneFloats(j) && parents.has(j))));
}

// Build a skin for the whole skeleton and add it to the scene as a new mesh.
//
// The vertices are written in MODEL space and the mesh keeps an identity matrix, so the skin
// lands exactly on the skeleton it came from. No normalizeSize() — the whole point is that the
// proportions are the ones already drawn.
SkinMesh.build = function (main) {
  const { all, hands } = skinJoints(main);
  const skip = skinSkip(all);
  const joints = skip.size ? all.filter((j) => !skip.has(j)) : all;
  if (!joints.length) return { ok: false, why: 'draw a bone chain first' };

  const topo = adjacency(joints, skip);
  if (!topo.bones.length) return { ok: false, why: 'skeleton has no bones (a chain needs 2+ joints)' };

  const t0 = performance.now();
  _vols = volumeShapes(main, all);
  let arr = buildArrays(joints, topo);
  if (!arr) return { ok: false, why: 'could not build a skin from this skeleton' };
  if (hands.length) arr = attachHands(main, arr, hands);

  const base = new MeshStatic(main._gl);
  base.setVertices(arr.vertices);
  base.setFaces(arr.faces);
  base.init();
  if (main._gl) base.initRender();

  const mesh = new Multimesh(base);
  mesh.setMatcap(getOptionsURL().matcap);
  mesh._typeName = 'Skin';
  mesh.isQuad = true;
  mesh._permanentStaticLabel = 'skin';
  main.addNewMesh(mesh); // pushes its own add-state, so this is one undo step

  return { ok: true, mesh: mesh, boxes: arr.boxes, bones: arr.bones, verts: mesh.getNbVertices(),
           faces: mesh.getNbFaces(), ms: Math.round(performance.now() - t0) };
};

// ── WHERE THE BONES WILL ATTACH ──────────────────────────────────────────────────────────
//
// Everything Make Skin has already decided, before it is pressed: for each bone end, the exact
// rectangle of the joint's box it will bridge through.
//
// This exists because the failure it shows CANNOT BE SEEN ANY OTHER WAY. A hand is five bones
// leaving one face of a four-cell box, which is the case assignSides was written for and the
// case it runs out of room on — and when it does, the worst-fitting bone is moved to its
// next-best SIDE, so a finger bridges out of the palm sideways. Nothing in the skeleton says so;
// you find out by generating a skin and looking at the wreck. matt, on his second attempt: "the
// fingers have attached in very ugly ways, not recoverable."
//
// TWO THINGS ARE WORTH SEEING, and they are different problems with different fixes:
//   • EVICTED — the bone is not on the face it points at, because that face was full. Fix by
//     moving the joint so the bones fan out, or by giving the palm fewer children.
//   • PINCHED — the bone is on the right face but sharing it, so its rectangle is a thin strip
//     rather than a square. Four fingers on one face get one cell each: a perimeter of 10 where
//     a whole face is 16. That is the flat, ribboned root, and it is not a bug — it is the face
//     being divided as far as it goes.
SkinMesh.attachments = function (main) {
  const { all } = skinJoints(main);
  const skip = skinSkip(all);
  const joints = skip.size ? all.filter((j) => !skip.has(j)) : all;
  if (!joints.length) return null;
  const topo = adjacency(joints, skip);
  if (!topo.bones.length) return null;
  _vols = volumeShapes(main, all);
  layoutCages(joints, topo);

  const boxes = new Map();
  for (const j of joints) {
    const nbs = topo.adj.get(j);
    if (!nbs.length) continue;
    const bx = boxAt(j, nbs);
    if (!bx) continue;
    const by = new Map();
    nbs.forEach((nb, i) => by.set(nb, { claim: bx.claims[i], dir: bx.dirs[i] }));
    // BOTH SIZES. `h` is the lattice the generator actually builds — clamped so a box cannot
    // reach into its neighbour's — and `half` is the joint's own shape, unclamped, which is what
    // the user tweaked and what the capsule draws at. The preview wants the second: a picture at
    // 45% of the size of the thing you are shaping does not read as that thing.
    boxes.set(j, { joint: j, c: bx.c, h: bx.h, box: bx.box, q: bx.q,
                   half: (_vols && _vols.half.get(j)) || Skeleton.jointHalf(j, Skeleton.boneRadiusOf(main, j)),
                   by: by, sides: new Set() });
  }

  // The side this direction WANTED, which is rank[0] in assignSides. A claim on any other side
  // is one that was evicted for want of room.
  const bestSide = (d) => {
    let bi = 0, bv = -Infinity;
    for (let i = 0; i < BOX_SIDES.length; i++) {
      const def = BOX_SIDES[i];
      const v = d.getComponent(def.axis) * def.sign;
      if (v > bv) { bv = v; bi = i; }
    }
    return bi;
  };

  const ends = [];
  let pair = 0;
  for (const [p, j] of topo.bones) {
    const near = boxes.get(p), far = boxes.get(j);
    if (!near || !far) continue;
    const nEnd = near.by.get(j), fEnd = far.by.get(p);
    if (!nEnd || !fEnd || !nEnd.claim || !fEnd.claim) continue;
    // THE SAME RULE THE GENERATOR USES, or the preview is a second opinion — and a second opinion
    // about the claims is precisely how the joint volumes drifted from what they described. A 2:1
    // pair keeps both faces and pays the difference in a reduction band, so the view shows the
    // finger's WHOLE face meeting a 2x2 block of the palm, which is what will be built.
    const pN2 = perimeter(nEnd.claim.rect), pF2 = perimeter(fEnd.claim.rect);
    const stepped = (pN2 === pF2 * 2 && !(pF2 & 1)) || (pF2 === pN2 * 2 && !(pN2 & 1));
    const st = stepped ? { nc: nEnd.claim, fc: fEnd.claim, want: Math.min(pN2, pF2) }
                       : settleEnds(nEnd, fEnd, near.box, far.box);
    // ONE `pair` NUMBER FOR BOTH ENDS. It is what lets the two patches be drawn in the same
    // colour, which is the whole of the answer to "what is going to join to what" — the pairing
    // is decided here, and a viewer matching them up again by position would be guessing.
    // WHAT COUNTS AS A CLEAN ATTACHMENT, now that the two ends need not be the same level.
    //
    // It used to be "the whole of a face at the one global level", which no longer means anything:
    // a palm at eight has a 32-vertex face and hands out 8-vertex blocks by design, and calling
    // every one of those pinched would report the fix as the fault. What matters is whether the
    // bone got as much as the COARSER end could offer — its whole face — because that is the most
    // the pair can agree on. Less than that, and somebody shrank.
    // A stepped pair is clean at BOTH ends by construction: each keeps its whole face, which is
    // the most either could offer. Otherwise it is still the coarser end's face that decides.
    const clean = stepped || st.want >= Math.min(facePerimeter(near.box, nEnd.claim.side),
                                                 facePerimeter(far.box, fEnd.claim.side));
    const add = (box, joint, other, claim, dir) => {
      box.sides.add(claim.side);
      ends.push({ joint: joint, other: other, box: box, side: claim.side, rect: claim.rect,
                  pair: pair, perimeter: st.want,
                  evicted: claim.side !== bestSide(dir), full: clean });
    };
    add(near, p, j, st.nc, nEnd.dir);
    add(far, j, p, st.fc, fEnd.dir);
    pair++;
  }
  if (!ends.length) return null;

  // Model-space position of one lattice vertex on one box — the SAME arithmetic buildArrays uses
  // to place its vertices, so a patch drawn here sits exactly where the skin will be built.
  const at = (box, id, out) => latticePoint(box, box.box.lat[id], out);

  // THE SAME LATTICE POINT, PUSHED OUT ONTO THE JOINT'S OWN SURFACE, AT THE JOINT'S OWN SIZE.
  //
  // A cube run through enough subdivision becomes very nearly a sphere, and that is not an
  // analogy here — the cage IS a subdivided cube and the relax IS what rounds it onto the joint's
  // shape. matt: "i meant a subdivided AND smoothed cube... if the joint spheres were replaced
  // with these spheres, you could then do the same colour coding directly on the joint spheres."
  //
  // AND IT USES THE JOINT'S SHARPNESS, so the preview shows the shape the skin will actually be
  // built onto rather than a fixed guess at it. The surface along a ray is where the p-norm
  // reaches 1, so dividing the lattice direction by its own p-norm lands exactly on it: p = 2 is
  // the sphere, higher p pushes towards the box, and the previous fixed 82%-of-the-way-to-a-
  // sphere constant is gone — it was approximating this.
  const round = (box, id, out) => {
    const l = box.box.lat[id], n = box.box.n;
    const ux = l[0] / n[0], uy = l[1] / n[1], uz = l[2] / n[2];
    const pw = Skeleton.jointRound(box.joint);
    // A lattice point always lies on the box surface, so at least one component is +-1 and the
    // norm can never be zero.
    const nrm = (pw <= 2.0001)
      ? Math.hypot(ux, uy, uz)
      : Math.pow(Math.pow(Math.abs(ux), pw) + Math.pow(Math.abs(uy), pw)
               + Math.pow(Math.abs(uz), pw), 1 / pw);
    const k = nrm > 1e-9 ? 1 / nrm : 1;
    const hf = box.half;
    out.set(hf[0] * ux * k, hf[1] * uy * k, hf[2] * uz * k);
    if (box.q) out.applyQuaternion(box.q);
    return out.add(box.c);
  };

  return { boxes: Array.from(boxes.values()), ends: ends, pairs: pair, at: at, round: round };
};

// Exposed for the harness in scratchpad and for console poking: the geometry half of this
// module has no dependency on the mesh classes, so it can be exercised on its own.
SkinMesh._adjacency = adjacency;
SkinMesh._buildArrays = buildArrays;
SkinMesh._volumeShapes = (main, all) => (_vols = volumeShapes(main, all));
// The box FOR A LEVEL, since there is no longer a single one. The harness builds fixtures against
// it and console pokes read it; both want to name the level they mean.
SkinMesh._boxOf = boxOf;
SkinMesh._box = boxOf([CELLS, CELLS, CELLS]);
SkinMesh._levelFor = levelFor;
SkinMesh._levelsFor = levelsFor;
SkinMesh._relax = relax;

export default SkinMesh;
