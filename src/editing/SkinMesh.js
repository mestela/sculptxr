import * as THREE from 'three';
import Utils from '../misc/Utils.js';
import MeshStatic from '../mesh/meshStatic/MeshStatic.js';
import Multimesh from '../mesh/multiresolution/Multimesh.js';
import Enums from '../misc/Enums.js';
import getOptionsURL from '../misc/getOptionsURL.js';
import Skeleton from './Skeleton.js';

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
const BLOCK = 2;

// Half-extent as a fraction of the shortest bone touching a joint. Two boxes on one bone must
// not touch, so the two together have to stay under 1.0; a fat joint on a short bone is pinched
// rather than allowed to swallow its neighbour.
const LENGTH_CLAMP = 0.45;

// How long a bridge may get before it is cut into more rings, as a multiple of the loop's own
// edge length. Aiming for roughly square quads: a bone whose span is four edge-lengths long
// gets four rings. Capped so a very long thin bone cannot run away with the vertex count.
const MAX_SPANS = 32;

// Relax. Each pass smooths, then pulls the result back onto the capsule surface — smoothing
// alone deflates a cage steadily, and it is the projection that holds the volume. Neither is
// useful without the other.
const RELAX_PASSES = 6;
const SMOOTH_RATE = 0.55;
// How far a capsule's influence bleeds into its neighbour's, as a fraction of the SMALLEST
// radius near the point — the finest feature anything there can have, so a thin bone leaving a
// fat joint stays a thin bone. It rounds the seam where two capsules meet and cannot make the
// skin thinner anywhere: a smooth-min only ever adds.
const BLEND_FRAC = 0.6;

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

function adjacency(joints) {
  const set = new Set(joints);
  const adj = new Map();
  const bones = [];
  for (const j of joints) adj.set(j, []);
  for (const j of joints) {
    const p = j._parentMesh;
    if (!set.has(p)) continue;
    if (Skeleton.jointPos(j).distanceTo(Skeleton.jointPos(p)) < 1e-9) continue; // no direction
    adj.get(j).push(p);
    adj.get(p).push(j);
    bones.push([p, j]);
  }
  return { adj: adj, bones: bones };
}

// The radius of the bone between two joints. It is stored on the CHILD joint of the pair,
// which is why this cannot just read one of them.
function boneRadius(a, b) {
  if (b._parentMesh === a) return b._boneRadius || 0;
  if (a._parentMesh === b) return a._boneRadius || 0;
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
// `n` is cells a side. The lattice runs -n..n in steps of two so a cell is two units wide and the
// centre of a side lands on an integer, which is what lets a claim be described in cells and
// still name real vertices.
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
    const grid = [];
    for (let a = 0; a <= n; a++) {
      const col = [];
      for (let b = 0; b <= n; b++) {
        const c = [0, 0, 0];
        c[s.axis] = s.sign * n;
        c[s.u] = -n + 2 * a;
        c[s.v] = -n + 2 * b;
        col.push(idOf(c));
      }
      grid.push(col);
    }
    return { def: s, grid: grid };
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

// Where a rectangle sits, as a direction from the box centre, so a claim can be compared
// against the bone that wants it.
function rectDir(box, claim) {
  const c = new THREE.Vector3();
  const loop = rectLoop(box, claim);
  for (const v of loop) c.add(new THREE.Vector3(box.lat[v][0], box.lat[v][1], box.lat[v][2]));
  return c.divideScalar(loop.length * box.n).normalize();
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
  let b = BOXES.get(n);
  if (!b) { b = makeBox(n); BOXES.set(n, b); }
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
  const CELLS = box.n;
  if (bones.length === 1) {
    return [{ bone: bones[0], side: si, rect: { a0: 0, a1: CELLS, b0: 0, b1: CELLS } }];
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
  const k = ordered.length;
  const sizes = [];
  for (let i = 0; i < k; i++) sizes.push(Math.floor(CELLS / k) + (i < CELLS % k ? 1 : 0));

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
    const w = compact ? Math.min(CELLS, Math.max(sizes[i], 2)) : CELLS;
    const c0 = compact ? Math.floor((CELLS - w) / 2) : 0;
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
  const CELLS = box.n;
  const rank = dirs.map((d) => box.sides
    .map((s, i) => ({ i: i, v: d.getComponent(s.def.axis) * s.def.sign }))
    .sort((p, q) => q.v - p.v));
  const at = dirs.map((_, b) => rank[b][0].i);
  const nextFor = dirs.map(() => 1);

  for (let guard = 0; guard < 64; guard++) {
    const perSide = box.sides.map(() => []);
    at.forEach((si, bone) => perSide[si].push(bone));
    let over = -1;
    for (let i = 0; i < perSide.length; i++) if (perSide[i].length > CELLS) { over = i; break; }
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

function matchLoop(near, far, posAt) {
  const rev = far.slice().reverse();
  const L = rev.length;
  let best = null, bestCost = Infinity;
  for (let k = 0; k < L; k++) {
    let cost = 0;
    for (let i = 0; i < L; i++) cost += posAt(near[i]).distanceToSquared(posAt(rev[(i + k) % L]));
    if (cost < bestCost) {
      bestCost = cost;
      best = [];
      for (let i = 0; i < L; i++) best.push(rev[(i + k) % L]);
    }
  }
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
let _order = new Int32Array(0);
function ensureCapsScratch(n) {
  if (_sd.length >= n) return;
  _sd = new Float64Array(n); _nx = new Float64Array(n);
  _ny = new Float64Array(n); _nz = new Float64Array(n);
  _order = new Int32Array(n);
}
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
    const ux = _to.x / Math.max(hx, 1e-9);
    const uy = _to.y / Math.max(hy, 1e-9);
    const uz = _to.z / Math.max(hz, 1e-9);
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
    const fine = Math.min(hx, hy, hz);
    if (fine < rmin) rmin = fine;
  }
  if (!(dmin < Infinity)) return out.copy(p);

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
function boxAt(j, nbs) {
  // THE BLOCK SITS ON THE SHAPE, and the bones are aimed between SHAPES. Both follow from the
  // envelope being the hull of the shapes rather than of the joints: leave the block on the
  // joint and a tweaked joint gets a cage in one place and a capsule in another, with the
  // bridges stretched between them.
  const c = Skeleton.jointCentre(j);
  let r = 0;
  const dirs = [];
  const lens = [];
  for (const nb of nbs) {
    const d = new THREE.Vector3().subVectors(Skeleton.jointCentre(nb), c);
    lens.push(d.length());
    r = Math.max(r, boneRadius(j, nb));
    dirs.push(d.normalize());
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
  const half = Skeleton.jointHalf(j, r);
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
  if (window._boneSkinClampMode === 'support') {
    for (let i = 0; i < dirs.length; i++) {
      const d = dirs[i];
      const reach = half[0] * Math.abs(d.x) + half[1] * Math.abs(d.y) + half[2] * Math.abs(d.z);
      if (reach > 1e-12) sc = Math.min(sc, (lens[i] * clampFrac) / reach);
    }
  } else {
    const lim = Math.min.apply(null, lens) * clampFrac;
    const big = Math.max(half[0], half[1], half[2]);
    if (big > lim) sc = lim / big;
  }
  const h = [half[0] * sc, half[1] * sc, half[2] * sc];
  if (!(h[0] > 1e-9 && h[1] > 1e-9 && h[2] > 1e-9)) return null;

  const box = boxOf(levelFor(dirs));
  const claims = claimSides(box, dirs);
  if (!claims) return null;
  return { c: c, h: h, dirs: dirs, claims: claims, box: box };
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
  const verts = [];
  const boxes = new Map();

  // Pass one: a box at every joint, its bones each holding one block.
  for (const j of joints) {
    const nbs = adj.get(j);
    if (!nbs.length) continue;
    const bx = boxAt(j, nbs);
    if (!bx) continue;
    const c = bx.c, h = bx.h, dirs = bx.dirs, claims = bx.claims, BX = bx.box, N = BX.n;

    // No rotation anywhere: the lattice goes straight to world, scaled and offset. That one
    // line is the whole reason bridges cannot shear against each other.
    const base = verts.length / 3;
    for (const l of BX.lat) {
      verts.push(c.x + (h[0] * l[0]) / N,
                 c.y + (h[1] * l[1]) / N,
                 c.z + (h[2] * l[2]) / N);
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
    const canStep = (pN === pF * 2 && !(pF & 1)) || (pF === pN * 2 && !(pN & 1));
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
        _pStep.lerp(_pStep2, 0.15);
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
    caps.push({ a: Skeleton.jointCentre(p), b: Skeleton.jointCentre(j),
      ha: guard(Skeleton.jointHalf(p, rj)), hb: guard(Skeleton.jointHalf(j, rj)),
      pa: Skeleton.jointRound(p), pb: Skeleton.jointRound(j) });
    bones++;
  }

  // Whatever no bone claimed closes the box. A leaf joint keeps five of its six sides, which
  // is the cap — no dome, no pole, nothing to stitch to anything else.
  for (const box of boxes.values()) {
    const wholeSide = { a0: 0, a1: box.box.n, b0: 0, b1: box.box.n };
    for (let si = 0; si < box.box.sides.length; si++) {
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

  const relaxed = window._boneSkinRelax === false ? packed : relax(packed, idx, caps);
  return { vertices: relaxed, faces: idx, boxes: boxes.size, bones: bones };
}

// Build a skin for the whole skeleton and add it to the scene as a new mesh.
//
// The vertices are written in MODEL space and the mesh keeps an identity matrix, so the skin
// lands exactly on the skeleton it came from. No normalizeSize() — the whole point is that the
// proportions are the ones already drawn.
SkinMesh.build = function (main) {
  const joints = Skeleton.joints(main);
  if (!joints.length) return { ok: false, why: 'draw a bone chain first' };

  const topo = adjacency(joints);
  if (!topo.bones.length) return { ok: false, why: 'skeleton has no bones (a chain needs 2+ joints)' };

  const t0 = performance.now();
  const arr = buildArrays(joints, topo);
  if (!arr) return { ok: false, why: 'could not build a skin from this skeleton' };

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
  const joints = Skeleton.joints(main);
  if (!joints.length) return null;
  const topo = adjacency(joints);
  if (!topo.bones.length) return null;

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
    boxes.set(j, { joint: j, c: bx.c, h: bx.h, box: bx.box,
                   half: Skeleton.jointHalf(j, Skeleton.boneRadiusOf(main, j)),
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
    const clean = stepped || st.want >= 4 * Math.min(near.box.n, far.box.n);
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
  const at = (box, id, out) => {
    const l = box.box.lat[id], n = box.box.n;
    return out.set(box.c.x + (box.h[0] * l[0]) / n,
                   box.c.y + (box.h[1] * l[1]) / n,
                   box.c.z + (box.h[2] * l[2]) / n);
  };

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
    const ux = l[0] / n, uy = l[1] / n, uz = l[2] / n;
    const pw = Skeleton.jointRound(box.joint);
    // A lattice point always lies on the box surface, so at least one component is +-1 and the
    // norm can never be zero.
    const nrm = (pw <= 2.0001)
      ? Math.hypot(ux, uy, uz)
      : Math.pow(Math.pow(Math.abs(ux), pw) + Math.pow(Math.abs(uy), pw)
               + Math.pow(Math.abs(uz), pw), 1 / pw);
    const k = nrm > 1e-9 ? 1 / nrm : 1;
    const hf = box.half;
    return out.set(box.c.x + hf[0] * ux * k,
                   box.c.y + hf[1] * uy * k,
                   box.c.z + hf[2] * uz * k);
  };

  return { boxes: Array.from(boxes.values()), ends: ends, pairs: pair, at: at, round: round };
};

// Exposed for the harness in scratchpad and for console poking: the geometry half of this
// module has no dependency on the mesh classes, so it can be exercised on its own.
SkinMesh._adjacency = adjacency;
SkinMesh._buildArrays = buildArrays;
// The box FOR A LEVEL, since there is no longer a single one. The harness builds fixtures against
// it and console pokes read it; both want to name the level they mean.
SkinMesh._boxOf = boxOf;
SkinMesh._box = boxOf(CELLS);
SkinMesh._levelFor = levelFor;
SkinMesh._relax = relax;

export default SkinMesh;
