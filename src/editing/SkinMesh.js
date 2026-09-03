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

// One box, built once and reused by every joint: the boxes differ only in centre and scale, so
// the lattice, the sides and the block layout are all the same object every time.
//
// Vertices are keyed by their exact lattice coordinate, so adjacent sides SHARE their edge and
// corner vertices rather than stacking duplicates along every seam.
function makeBox() {
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
    for (let a = 0; a <= CELLS; a++) {
      const col = [];
      for (let b = 0; b <= CELLS; b++) {
        const c = [0, 0, 0];
        c[s.axis] = s.sign * CELLS;
        c[s.u] = -CELLS + 2 * a;
        c[s.v] = -CELLS + 2 * b;
        col.push(idOf(c));
      }
      grid.push(col);
    }
    return { def: s, grid: grid };
  });

  return { lat: lat, sides: sides };
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
  return c.divideScalar(loop.length * CELLS).normalize();
}

const BOX = makeBox();

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

  const out = [];
  let at = 0;
  for (let i = 0; i < k; i++) {
    const lo2 = at, hi2 = at + sizes[i];
    at = hi2;
    out.push({
      bone: ordered[i], side: si,
      rect: alongU ? { a0: lo2, a1: hi2, b0: 0, b1: CELLS } : { a0: 0, a1: CELLS, b0: lo2, b1: hi2 },
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
          const s = rectDir(box, { side: claim.side, rect: sub }).dot(dir);
          if (s > top) { top = s; best = sub; }
        }
  return best ? { side: claim.side, rect: best } : claim;
}

// The far loop turned to run the same way round the bone as the near one, and rolled to the
// offset that pairs the vertices up. Both loops are wound outward from their OWN box, so they
// run in opposite directions about the bone; one has to be reversed or the bridge is a bow tie.
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
const _order = [];
function capsuleTarget(p, caps, out) {
  // Pass one: each capsule's signed distance and outward direction at p.
  let dmin = Infinity, rmin = Infinity;
  const sd = [], nx = [], ny = [], nz = [];
  for (const c of caps) {
    _ax.subVectors(c.b, c.a);
    const len2 = _ax.lengthSq();
    let t = len2 > 1e-18 ? _to.subVectors(p, c.a).dot(_ax) / len2 : 0;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    _cp.copy(c.a).addScaledVector(_ax, t);
    _to.subVectors(p, _cp);
    const l = _to.length();
    // A point sitting exactly on an axis has no direction to be pushed out along; skip that
    // capsule rather than inventing one. Smoothing will have moved it off by the next pass.
    if (l < 1e-9) { sd.push(Infinity); nx.push(0); ny.push(0); nz.push(0); continue; }
    // The radius where this point sits, lerped between the two ends. `t` is already clamped, so
    // past either end the cone keeps that end's radius and the cap stays a sphere of it.
    const cr = c.r2 === undefined ? c.r : c.r + (c.r2 - c.r) * t;
    const d = l - cr;                       // negative inside
    sd.push(d);
    nx.push(_to.x / l); ny.push(_to.y / l); nz.push(_to.z / l);
    if (d < dmin) dmin = d;
    if (cr < rmin) rmin = cr;
  }
  if (!(dmin < Infinity)) return out.copy(p);

  // THE BLEND WIDTH IS A LENGTH, and it has to be one that exists in the scene or the soft-min
  // is either a hard min (creases) or a mush (limbs merge). The smallest radius in play is the
  // finest feature anything nearby can have, so blending over a fraction of it keeps a thin
  // bone from being swallowed by a fat joint beside it.
  const k = Math.max(rmin * BLEND_FRAC, 1e-6);

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
  _order.length = 0;
  for (let i = 0; i < sd.length; i++) if (sd[i] < Infinity) _order.push(i);
  if (!_order.length) return out.copy(p);
  _order.sort((x, y) => sd[x] - sd[y]);

  let d = Infinity;
  _grad.set(0, 0, 0);
  let first = true;
  for (const i of _order) {
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

function buildArrays(joints, topo) {
  const adj = topo.adj;
  const verts = [];
  const boxes = new Map();

  // Pass one: a box at every joint, its bones each holding one block.
  for (const j of joints) {
    const nbs = adj.get(j);
    if (!nbs.length) continue;

    const c = Skeleton.jointPos(j);
    let r = 0, minLen = Infinity;
    const dirs = [];
    for (const nb of nbs) {
      const d = new THREE.Vector3().subVectors(Skeleton.jointPos(nb), c);
      minLen = Math.min(minLen, d.length());
      r = Math.max(r, boneRadius(j, nb));
      dirs.push(d.normalize());
    }
    // THE JOINT'S OWN RADIUS SIZES ITS BLOCK. The widest bone touching it is the fallback, not
    // the rule — that is what made a head the width of a neck, and a hand the width of a
    // forearm, with nothing to say otherwise. matt: "i need to be able to scale joints, not
    // bones."
    r = Skeleton.jointRadius(j, r);
    // ...and the clamp stays. A block wider than half the gap to its nearest neighbour reaches
    // into that neighbour's block, and the bridge between them turns inside out. A joint sized
    // past its neighbours grows its CAPSULE, which the relax then pushes the skin out onto —
    // the shape arrives, and the lattice stays untangled.
    const h = Math.min(r, minLen * LENGTH_CLAMP);
    if (!(h > 1e-9)) continue;

    const claims = claimSides(BOX, dirs);
    if (!claims) continue;

    // No rotation anywhere: the lattice goes straight to world, scaled and offset. That one
    // line is the whole reason bridges cannot shear against each other.
    const base = verts.length / 3;
    for (const l of BOX.lat) {
      verts.push(c.x + (h * l[0]) / CELLS, c.y + (h * l[1]) / CELLS, c.z + (h * l[2]) / CELLS);
    }

    const byNeighbour = new Map();
    nbs.forEach((nb, i) => byNeighbour.set(nb, { claim: claims[i], dir: dirs[i] }));
    boxes.set(j, { base: base, by: byNeighbour, dead: new Set() });
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

    const want = Math.min(perimeter(nEnd.claim.rect), perimeter(fEnd.claim.rect));
    const nc = perimeter(nEnd.claim.rect) === want
      ? nEnd.claim : shrinkTo(BOX, nEnd.claim, want, nEnd.dir);
    const fc = perimeter(fEnd.claim.rect) === want
      ? fEnd.claim : shrinkTo(BOX, fEnd.claim, want, fEnd.dir);
    for (const f of rectFaces(BOX, nc)) near.dead.add(f.join(','));
    for (const f of rectFaces(BOX, fc)) far.dead.add(f.join(','));

    const A = rectLoop(BOX, nc).map((v) => near.base + v);
    const B = rectLoop(BOX, fc).map((v) => far.base + v);
    if (A.length !== B.length) continue; // nothing sensible to stitch; leave both closed
    const M = matchLoop(A, B, posAt);

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
    const L = A.length;
    let span = 0, edge = 0;
    for (let i = 0; i < L; i++) {
      span += posAt(A[i]).distanceTo(posAt(M[i]));
      edge += posAt(A[i]).distanceTo(posAt(A[(i + 1) % L]))
            + posAt(M[i]).distanceTo(posAt(M[(i + 1) % L]));
    }
    span /= L;
    edge /= L * 2;
    let rings = edge > 1e-9 ? Math.round(span / edge) : 1;
    rings = rings < 1 ? 1 : (rings > MAX_SPANS ? MAX_SPANS : rings);

    let prev = A;
    const _pa = new THREE.Vector3(), _pb = new THREE.Vector3();
    for (let r = 1; r <= rings; r++) {
      let next = M;
      if (r < rings) {
        // Evenly spaced along each rail. Lerp is mirror-safe, so a symmetric skeleton stays
        // symmetric through the subdivision as well as through the relax.
        const t = r / rings;
        next = [];
        for (let i = 0; i < L; i++) {
          _pa.set(verts[A[i] * 3], verts[A[i] * 3 + 1], verts[A[i] * 3 + 2]);
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
    caps.push({ a: Skeleton.jointPos(p), b: Skeleton.jointPos(j),
      r: Math.max(Skeleton.jointRadius(p, rj), 1e-6), r2: Math.max(Skeleton.jointRadius(j, rj), 1e-6) });
    bones++;
  }

  // Whatever no bone claimed closes the box. A leaf joint keeps five of its six sides, which
  // is the cap — no dome, no pole, nothing to stitch to anything else.
  const wholeSide = { a0: 0, a1: CELLS, b0: 0, b1: CELLS };
  for (const box of boxes.values()) {
    for (let si = 0; si < BOX.sides.length; si++) {
      for (const f of rectFaces(BOX, { side: si, rect: wholeSide })) {
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

  return { ok: true, boxes: arr.boxes, bones: arr.bones, verts: mesh.getNbVertices(),
           faces: mesh.getNbFaces(), ms: Math.round(performance.now() - t0) };
};

// Exposed for the harness in scratchpad and for console poking: the geometry half of this
// module has no dependency on the mesh classes, so it can be exercised on its own.
SkinMesh._adjacency = adjacency;
SkinMesh._buildArrays = buildArrays;
SkinMesh._box = BOX;
SkinMesh._relax = relax;

export default SkinMesh;
