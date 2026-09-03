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
const PROJECT_RATE = 0.7;

// Model-space symmetry plane normal, matching TransformData._symmetryNormal.
const SYM_AXIS = 0;

// -----------------------------------------------------------------------------------------
// Skeleton topology
// -----------------------------------------------------------------------------------------

function adjacency(joints, main) {
  const set = new Set(joints);
  const adj = new Map();
  const bones = [];
  for (const j of joints) adj.set(j, []);
  // A SWALLOWED BONE IS NOT PART OF THE SKIN. The rest of the rig already agrees on this — the
  // bone draws no body, carries no capsule and bakes no weight cage — but Make Skin never asked,
  // so it went on building a block and a bridge for a bone the volume has absorbed. On matt's
  // rig that is the tip bone above the head: the egg IS the head, and the stub for the tip
  // punched a funnel through the crown. matt: "there is a strange collapse near the top."
  //
  // Dropped here rather than in the bone loop, so the joint at the far end loses its last
  // neighbour and gets no block either — an absorbed joint leaves nothing behind, instead of an
  // orphan cube floating inside the volume.
  //
  // Narrower than Skeleton.boneSwallowed, deliberately. That rule also covers a LEAF whose own
  // volume swallows the bone leading into it — a box hand over a wrist — and there the joint is
  // still real: dropping its bone strands the hand as a separate shell. What the skin can drop
  // is a joint that is absorbed ENTIRELY: a leaf, with no shape of its own, sitting inside its
  // parent's volume. It contributes nothing the volume does not already say.
  const hasChild = new Set();
  for (const j of joints) if (set.has(j._parentMesh)) hasChild.add(j._parentMesh);
  const absorbed = (p, j) => main && Skeleton.volumeContains
    && !hasChild.has(j) && !Skeleton.hasVolume(j) && Skeleton.hasVolume(p)
    && Skeleton.volumeContains(main, p, Skeleton.jointPos(j), 1.05);
  for (const j of joints) {
    const p = j._parentMesh;
    if (!set.has(p)) continue;
    if (Skeleton.jointPos(j).distanceTo(Skeleton.jointPos(p)) < 1e-9) continue; // no direction
    if (absorbed(p, j)) continue;
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
// BLENDED, not nearest. Taking the single closest capsule was the obvious reading of "the
// union's surface" and it was wrong twice over. It creases hard where two capsules meet, since
// neighbouring vertices answer  to different capsules and get pushed different ways. And it is not
// mirror-safe: a vertex on the symmetry plane is exactly equidistant from the left and right
// capsule, so the winner is whichever was listed first, and a symmetric skeleton came back
// with a visibly asymmetric skin.
//
// Weighting every capsule by how near the point is to ITS surface fixes both. Equal distances
// give equal weights, so the seam is pulled equally both ways and stays put, and the falloff
// makes the transition between two capsules smooth instead of a ridge.
const _cp = new THREE.Vector3(), _ax = new THREE.Vector3(), _to = new THREE.Vector3();
const _volSurf = new THREE.Vector3();
// THE SURFACE THE RELAX PULLS ONTO — and volumes belong in it.
//
// Everything above builds the blocks; this decides where they END UP, and it only knew about
// capsules. So a joint's block was shrinkwrapped onto its volume and then, six passes later,
// dragged back onto a capsule built from the old radius — matt: "the eggs for the chest and
// head, no effect at all. i'd even argue they're being completely ignored." They were: the
// shape was applied and then projected away.
//
// A volume target is the same shrinkwrap as everywhere else, run backwards: take the point into
// the volume's unit space, put it on the shape with Skeleton.shapePoint, and bring it back.
function volumeSurface(p, v, out) {
  _to.copy(p).sub(v.pos);
  if (v.quatInv) _to.applyQuaternion(v.quatInv);
  _to.set(_to.x / v.half[0], _to.y / v.half[1], _to.z / v.half[2]);
  // Which surface point lies in this direction — a BOX exits through a face, a round shape
  // through its normalised direction. Normalising unconditionally, as the first version did,
  // turned every box volume into a sphere of the box's dimensions.
  if (!Skeleton.shapeSurfaceFromDir(v.shape, _to.x, _to.y, _to.z, out)) return null;
  out.set(out.x * v.half[0], out.y * v.half[1], out.z * v.half[2]);
  if (v.quat) out.applyQuaternion(v.quat);
  return out.add(v.pos);
}

// Set by capsuleTarget: whether the surface it just returned is dominated by a VOLUME. Read by
// the relax, which then honours that surface fully instead of easing toward it — see below.
let _targetIsVolume = false;


function capsuleTarget(p, caps, out) {
  const surf = [], dist = [];
  let dmin = Infinity;
  let dminIsVolume = false;
  for (const c of caps) {
    // A VOLUME TARGET, rather than a capsule. Its "radius" for the weighting below is its
    // smallest half-extent, which is the scale over which being off-surface matters.
    if (c.shape) {
      const hit = volumeSurface(p, c, _volSurf);
      if (!hit) { surf.push(null); dist.push(Infinity); continue; }
      surf.push(hit.clone());
      const d = p.distanceTo(hit);
      dist.push(d);
      if (d < dmin) { dmin = d; dminIsVolume = true; }
      continue;
    }
    _ax.subVectors(c.b, c.a);
    const len2 = _ax.lengthSq();
    let t = len2 > 1e-18 ? _to.subVectors(p, c.a).dot(_ax) / len2 : 0;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    _cp.copy(c.a).addScaledVector(_ax, t);
    _to.subVectors(p, _cp);
    const l = _to.length();
    // A point sitting exactly on an axis has no direction to be pushed out along; skip that
    // capsule rather than inventing one. Smoothing will have moved it off by the next pass.
    if (l < 1e-9) { surf.push(null); dist.push(Infinity); continue; }
    surf.push(_cp.clone().addScaledVector(_to, c.r / l));
    const d = Math.abs(l - c.r);
    dist.push(d);
    if (d < dmin) { dmin = d; dminIsVolume = false; }
  }
  _targetIsVolume = dminIsVolume;
  if (!(dmin < Infinity)) return out.copy(p);

  // Blended, and continuous by construction. Two attempts at a UNION — taking the nearest
  // un-buried surface, then blending within that set — both made the surface fold where
  // neighbouring vertices disagreed about which candidate to use (18 and then 80 intersecting
  // face pairs in the harness). Filtering the candidate SET is discontinuous however the result
  // is blended afterwards, so the fix for junction pinching belongs in what the capsules
  // DESCRIBE, not in how they are combined — see the joint spheres where `caps` is built.
  out.set(0, 0, 0);
  let wsum = 0;
  for (let i = 0; i < caps.length; i++) {
    if (!surf[i]) continue;
    const scale = caps[i].shape
      ? Math.max(Math.min(caps[i].half[0], caps[i].half[1], caps[i].half[2]), 1e-6)
      : Math.max(caps[i].r, 1e-6);
    const x = (dist[i] - dmin) / scale;
    const w = Math.exp(-x * x);
    out.addScaledVector(surf[i], w);
    wsum += w;
  }
  return wsum > 0 ? out.divideScalar(wsum) : out.copy(p);
}

// Smooth, then pull back onto the capsules, and hold the seam on the symmetry plane.
//
// The seam has to be pinned explicitly. Smoothing is an averaging operation and the two sides
// of a limb are not exactly equal once the capsules differ, so without the pin the centre line
// drifts off x=0 a little more each pass and the symmetry that the world-aligned boxes bought
// is gone by the last one.
// OWNERSHIP BEATS PROXIMITY. A block is built at the CAPSULE's size, so when its joint carries
// a big volume none of its vertices START anywhere near that volume's surface — and a target
// chosen by "nearest surface" then picks a neighbouring capsule every time. That is why matt's
// pelvis dome was ignored outright while the smaller volumes half-worked: "you can see its
// ignored the red hips/pelvis completely."
//
// So a vertex that came from a volume's own block is projected onto THAT volume, however far
// away it currently is. Everything else still uses the nearest surface, which is the right rule
// for the bridges between blocks.
// SMOOTHING IS FOR THE JOINS; PROJECTION IS FOR EVERYTHING.
//
// The relax does two jobs and only one of them was wanted everywhere. SMOOTHING averages a
// vertex toward its neighbours, which is exactly right where two blocks are bridged — that seam
// is the part with no shape of its own — and exactly wrong on a block, where it washes out the
// volume and skews the quads that were built square. PROJECTION is what rounds an un-volumed
// block onto its capsule, so it still applies to every vertex.
//
// matt: "could the relax only operate on the joins between the sections, vs being on the entire
// skin?" — this is that, with the projection left alone so capsule-only rigs still round.
//
// window._boneSkinSmoothAll = true puts the old behaviour back for comparison.
function relax(verts, faces, caps, ownerVol, volTargets, isBlock) {
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
  let src = verts;
  for (let pass = 0; pass < RELAX_PASSES; pass++) {
    const dst = new Float32Array(src.length);
    for (let i = 0; i < nbV; i++) {
      p.set(src[i * 3], src[i * 3 + 1], src[i * 3 + 2]);
      const ns = nbr[i];
      // ...but only a VOLUME's block is exempt. Turning smoothing off for every block made
      // neighbouring cubes pass through each other — 6 and 32 intersecting face pairs in the
      // harness's own fixtures — because settling them apart is exactly what it was doing there.
      // A volume is a shape that was drawn deliberately; a capsule block is a rough cube that
      // this pass exists to round and settle. So the rule is ownership, not blockness.
      const maySmooth = window._boneSkinSmoothAll === true
        || !isBlock || !isBlock[i] || !(ownerVol && ownerVol[i] > 0);
      if (ns.length && maySmooth) {
        avg.set(0, 0, 0);
        for (const n of ns) avg.set(avg.x + src[n * 3], avg.y + src[n * 3 + 1], avg.z + src[n * 3 + 2]);
        avg.divideScalar(ns.length);
        p.lerp(avg, SMOOTH_RATE);
      }
      const own = ownerVol ? ownerVol[i] : 0;
      if (own > 0 && volTargets && volTargets[own - 1]) {
        // Its own volume, whatever the distance. Full strength, for the same reason as below.
        if (volumeSurface(p, volTargets[own - 1], t)) {
          p.copy(t);
          if (onSeam[i]) p.setComponent(SYM_AXIS, 0);
          dst[i * 3] = p.x; dst[i * 3 + 1] = p.y; dst[i * 3 + 2] = p.z;
          continue;
        }
      }
      capsuleTarget(p, caps, t);
      // A VOLUME IS HONOURED IN FULL; a capsule is eased toward.
      //
      // The smoothing above is an averaging pass, and averaging shrinks a convex surface — six
      // passes of it round an egg down toward its own chords. A capsule can absorb that because
      // it is a coarse envelope anyway; a volume is a shape the user drew, and easing back only
      // 70% of the way each pass leaves it visibly deflated. matt, with the relax switched off
      // entirely: "yes with boneSkinRelax its much better."
      //
      // So where the nearest surface is a volume, the vertex is put ON it — the smoothing still
      // does its job of evening out the bridges, and the shape survives the pass intact.
      p.lerp(t, _targetIsVolume ? 1 : PROJECT_RATE);
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

function buildArrays(main, joints, topo) {
  const adj = topo.adj;
  const verts = [];
  const boxes = new Map();
  let volumesUsed = 0;
  const volTargets = [];
  // Per-vertex volume owner, 1-based (0 = none), carried through the packing below.
  const ownerVol = [];
  // ...and whether a vertex belongs to a BLOCK rather than to a bridge between blocks.
  const isBlock = [];

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
    const h = Math.min(r, minLen * LENGTH_CLAMP);
    if (!(h > 1e-9)) continue;


    // A JOINT WITH A VOLUME IS BUILT AT THE VOLUME'S SIZE, not at one derived from its radius.
    //
    // This is the payoff matt pointed out when the volumes went in: with real shapes on the rig,
    // Make Skin "would now have a much better volume read of what the skin should be" — a pelvis
    // box that is as wide as the pelvis instead of a cube sized by the thinnest bone touching
    // it. Three half-extents and a centre offset replace one number.
    //
    // The volume's rotation IS applied to the block — a box on a wrist has to sit the way the
    // wrist does. What that costs is that the lattice no longer goes straight to world, so the
    // claim below has to be asked in the same turned frame; see there.
    const vol = main && Skeleton.hasVolume && Skeleton.hasVolume(j) && Skeleton.volumeFrame
      ? Skeleton.volumeFrame(main, j) : null;
    const volShape = vol ? Skeleton.jointVolume(j) : null;

    // THE CLAIM IS CHOSEN IN THE BLOCK'S OWN FRAME, and a volume's block is turned by the
    // volume's rotation. Choosing it from world directions against the unrotated lattice is
    // what turned matt's box hands inside out: the face the bone pointed at in world space was
    // not the face that ended up there once the rotation was applied, so the tube reached past
    // the box and folded back onto its far side. matt: "its simply that what you consider top
    // vs bottom is flipped."
    //
    // Every later use of `dir` — the shrink, the rect match — compares against the same lattice,
    // so the whole set moves into that frame together rather than only the claim.
    if (vol && vol.quat) {
      const inv = vol.quat.clone().invert();
      for (const d of dirs) d.applyQuaternion(inv);
    }

    const claims = claimSides(BOX, dirs);
    if (!claims) continue;
    if (vol) {
      volumesUsed++;
      // Carried through to the relax as a projection target — see capsuleTarget. Without this
      // the block is shaped and then smoothed back onto a capsule.
      volTargets.push({ shape: volShape, pos: vol.pos.clone(),
        quat: vol.quat ? vol.quat.clone() : null,
        quatInv: vol.quat ? vol.quat.clone().invert() : null,
        half: vol.half.slice() });
    }

    // SHRINKWRAPPED ONTO THE VOLUME. The lattice is already a cube surface, so every point maps
    // straight onto the shape through the SAME function the weight cage uses — matt's idea, and
    // the reason both agree: "a cube that is rotated and scaled to match the target volume,
    // subdivided, and then shrinkwrapped onto the target shape."
    //
    // NO PER-AXIS CLAMP. The first attempt limited each half-extent to the reach of the nearest
    // bone — and once a volume was bigger than that, ALL THREE axes clamped to the same number,
    // so every large volume came out a uniform blob and its proportions vanished. matt: "it
    // doesn't look like its following the shapes of the volumes at all." A volume is sized
    // deliberately; the skin's job is to follow it, and an overlap is a bridging problem to be
    // solved where the bridges are.
    // THE LATTICE IS TOPOLOGY; THE VOLUME IS SHAPE. Two jobs, and building the block AT the
    // volume's size conflated them.
    //
    // A bridge's loop is chosen in GRID CELLS — min(perimeter(near), perimeter(far)) — with no
    // reference to the bone's world size. Build the block at the volume's size and a limb
    // leaving a big chest claims two cells of a large face, which shrinkwraps to a small patch
    // on a big sphere: a thin neck out of a ball. That is matt's cloverleaf, and it is why
    // changing the capsule radius could not fix it — the claim is topological, not metric.
    //
    // So the block is built at the CAPSULE's size again, which keeps every bridge proportionate
    // to the bone it belongs to, and the volume does its work in the relax, where it is a
    // projection target that pushes the surface out onto the shape. The skin then conforms to
    // the capsules AND takes the volume's form, which is what image 3 and image 4 asked for
    // together.
    // BUILT AT THE VOLUME'S SIZE, shrinkwrapped onto its shape — matt's approach, and the
    // measurement that sent me back to it: with the block at CAPSULE size, a volume was formed
    // out of the block's ~98 lattice points alone while everything around it stayed thin, so a
    // big box on a wrist read as a coarse shell floating around a thin arm.
    //
    // The retreat to capsule size had been aimed at the cloverleaf — but every bridge loop on
    // matt's own rig measures 16, a full face, so the chokes were never the claim being small.
    const base = verts.length / 3;
    const _sp = new THREE.Vector3();
    for (const l of BOX.lat) {
      if (vol) {
        Skeleton.shapePoint(volShape, l[0] / CELLS, l[1] / CELLS, l[2] / CELLS, _sp);
        if (vol.quat) _sp.applyQuaternion(vol.quat);
        verts.push(vol.pos.x + _sp.x * vol.half[0],
                   vol.pos.y + _sp.y * vol.half[1],
                   vol.pos.z + _sp.z * vol.half[2]);
      } else {
        verts.push(c.x + (h * l[0]) / CELLS, c.y + (h * l[1]) / CELLS, c.z + (h * l[2]) / CELLS);
      }
    }
    for (let k = 0; k < BOX.lat.length; k++) isBlock[base + k] = 1;
    // WHICH VOLUME OWNS THESE VERTICES, if any. Ownership, not proximity — see the relax.
    if (vol) {
      const owner = volTargets.length;          // 1-based: this joint's target is the last pushed
      for (let k = 0; k < BOX.lat.length; k++) ownerVol[base + k] = owner;   // 0 = none
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
    // Reported so a pinch can be counted rather than described: a loop of 4 is one cell of one
    // face, which is the tiniest tube this can build.
    if (window._boneSkinTrace) {
      console.log('[skin] bone ' + (p._permanentStaticLabel || p.getID()) + ' -> '
        + (j._permanentStaticLabel || j.getID()) + '  loop=' + want
        + '  (near ' + perimeter(nEnd.claim.rect) + ', far ' + perimeter(fEnd.claim.rect) + ')');
    }
    const nc = perimeter(nEnd.claim.rect) === want
      ? nEnd.claim : shrinkTo(BOX, nEnd.claim, want, nEnd.dir);
    const fc = perimeter(fEnd.claim.rect) === want
      ? fEnd.claim : shrinkTo(BOX, fEnd.claim, want, fEnd.dir);
    if (window._skinLoopStats) {
      // The loop's WORLD size at each end, which is what a pinch actually is — the counts are
      // identical everywhere, so a narrow join is a small ring, not a short one.
      const ringR = (claim, at) => {
        const ids = rectLoop(BOX, claim);
        let r = 0;
        for (const id of ids) {
          const q = posAt(at.base + id);
          r += q.distanceTo(Skeleton.jointPos(at.joint));
        }
        return ids.length ? r / ids.length : 0;
      };
      // `near`/`far` are the block records; the base index lives on them, not on the end.
      window._skinLoopStats.push({ want: want,
        near: ringR(nc, { base: near.base, joint: p }),
        far: ringR(fc, { base: far.base, joint: j }) });
    }

    for (const f of rectFaces(BOX, nc)) near.dead.add(f.join(','));
    for (const f of rectFaces(BOX, fc)) far.dead.add(f.join(','));

    const A = rectLoop(BOX, nc).map((v) => near.base + v);
    const B = rectLoop(BOX, fc).map((v) => far.base + v);
    if (A.length !== B.length) continue; // nothing sensible to stitch; leave both closed
    const M = matchLoop(A, B, posAt);

    // TWIST DIAGNOSTIC. A bridge whose two loops are paired one step out of register shears
    // every quad along the bone the same way, which reads as the edge loops spiralling into the
    // hole rather than running straight down it — matt, on the top of a box hand: "you can see
    // there's a drift in the edge loops." Reported rather than described, in degrees about the
    // bone: a clean bridge is near zero, and one step of an L-loop is 360/L.
    if (window._skinTwistStats) {
      const ca = new THREE.Vector3(), cm = new THREE.Vector3();
      for (let i = 0; i < A.length; i++) { ca.add(posAt(A[i])); cm.add(posAt(M[i])); }
      ca.divideScalar(A.length); cm.divideScalar(A.length);
      const axis = cm.clone().sub(ca);
      if (axis.lengthSq() > 1e-12) {
        axis.normalize();
        const ra = new THREE.Vector3(), rm = new THREE.Vector3();
        let sum = 0;
        for (let i = 0; i < A.length; i++) {
          ra.copy(posAt(A[i])).sub(ca); ra.addScaledVector(axis, -ra.dot(axis));
          rm.copy(posAt(M[i])).sub(cm); rm.addScaledVector(axis, -rm.dot(axis));
          if (ra.lengthSq() < 1e-12 || rm.lengthSq() < 1e-12) continue;
          ra.normalize(); rm.normalize();
          const s = ra.clone().cross(rm).dot(axis);
          sum += Math.atan2(s, ra.dot(rm)) * 180 / Math.PI;
        }
        window._skinTwistStats.push({
          bone: (p._permanentStaticLabel || p.getID()) + '->' + (j._permanentStaticLabel || j.getID()),
          loop: A.length, step: +(360 / A.length).toFixed(1),
          twist: +(sum / A.length).toFixed(1) });
      }
    }

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
    // EVERY BONE KEEPS ITS CAPSULE, including the ones between volumes.
    //
    // These were suppressed when volumes went in, on the reasoning that a bone covered by a
    // volume has that volume as its surface. That was true of the volume's own block and false
    // of the BRIDGE between two blocks — which then had nothing at all to push it out, and
    // collapsed to whatever the two rings happened to span. matt, on the chest-to-sternum
    // pinch: "in the original skeleton/capsule view, there's no section there to tell the system
    // how wide that junction should be. if we had a capsule there, would that help?" There was
    // one; I had removed it.
    //
    // Safe to restore now that block vertices are projected by OWNERSHIP: a volume's own block
    // never consults the capsules, so the two can no longer fight over it.
    caps.push({ a: Skeleton.jointPos(p), b: Skeleton.jointPos(j), r: Math.max(boneRadius(p, j), 1e-6) });
    // A SPHERE AT EACH END, as wide as the widest bone meeting there.
    //
    // This is where junction pinching actually comes from: the capsules describe the bones and
    // nothing describes the JOINT, so at a junction every candidate surface is a tube heading
    // away and the blend of them lands inside all of them — the more bones meet, the further in
    // it pulls. On matt's rig the hips-to-leg joins came out at 9% and 14% of the width their
    // capsules called for.
    //
    // A sphere at the joint gives the blend something with the right radius to agree on, and
    // being a shape rather than a filter it stays continuous — which two attempts at combining
    // the candidates differently did not.
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
  const ownerPacked = new Int32Array(used.size);
  const blockPacked = new Uint8Array(used.size);
  for (const [old, now] of used) {
    packed[now * 3] = verts[old * 3];
    packed[now * 3 + 1] = verts[old * 3 + 1];
    packed[now * 3 + 2] = verts[old * 3 + 2];
    ownerPacked[now] = ownerVol[old] || 0;
    blockPacked[now] = isBlock[old] ? 1 : 0;
  }
  const idx = new Uint32Array(faces.length);
  for (let i = 0; i < faces.length; i++) {
    idx[i] = faces[i] === Utils.TRI_INDEX ? Utils.TRI_INDEX : used.get(faces[i]);
  }

  const relaxed = window._boneSkinRelax === false ? packed
    : relax(packed, idx, caps.concat(volTargets), ownerPacked, volTargets, blockPacked);
  return { vertices: relaxed, faces: idx, boxes: boxes.size, bones: bones,
           volumes: volumesUsed };
}

// Build a skin for the whole skeleton and add it to the scene as a new mesh.
//
// The vertices are written in MODEL space and the mesh keeps an identity matrix, so the skin
// lands exactly on the skeleton it came from. No normalizeSize() — the whole point is that the
// proportions are the ones already drawn.
SkinMesh.build = function (main) {
  const joints = Skeleton.joints(main);
  if (!joints.length) return { ok: false, why: 'draw a bone chain first' };

  const topo = adjacency(joints, main);
  if (!topo.bones.length) return { ok: false, why: 'skeleton has no bones (a chain needs 2+ joints)' };

  const t0 = performance.now();
  const arr = buildArrays(main, joints, topo);
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

  return { ok: true, boxes: arr.boxes, bones: arr.bones, volumes: arr.volumes,
           verts: mesh.getNbVertices(),
           faces: mesh.getNbFaces(), ms: Math.round(performance.now() - t0) };
};

// Exposed for the harness in scratchpad and for console poking: the geometry half of this
// module has no dependency on the mesh classes, so it can be exercised on its own.
SkinMesh._adjacency = adjacency;
SkinMesh._buildArrays = buildArrays;
SkinMesh._box = BOX;
SkinMesh._relax = relax;

export default SkinMesh;
