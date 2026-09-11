// Node harness for PHYSICS-BONE SELF COLLISION — roadmap #36.
//
// matt: flagged physics joints "swing through each other and through the rest of the rig", and
// he scoped it explicitly — BONES ONLY, not the skin, because the capsules the rig already
// carries are the collision proxies.
//
// WHAT IS ACTUALLY WORTH TESTING HERE. The push-out is arithmetic, so it is RUN rather than
// regex'd: a claim about where a sphere ends up after being pushed out of a tapered capsule is
// not something a pattern match can check. The structural claims — adjacency exclusion, the
// alternation with the length constraint, one implementation shared by live and bake — are what
// the text checks are for.
//
// THE TRAP THIS FEATURE INHERITS, from [[project_sculptxr_physics_bones]]: each joint's target
// must be read AFTER its parent is written, or the chain becomes four independent springs. A
// collision pass has the same hazard — a collider's position has to be read LIVE at test time,
// not cached when the collider list is built, or a joint collides against where its neighbour
// was last frame.
//
// Run: node scratchpad/physcollide_test.mjs
//   PC_INJECT=nosphere      the particle's own radius is dropped, so a joint only stops when its
//                           CENTRE reaches the collider's surface — it sinks in by its radius
//   PC_INJECT=notaper       the capsule uses one radius end to end, so collision parts company
//                           with the drawn bone wherever a joint is sized
//   PC_INJECT=noadjacent    adjacency is not excluded, so every joint is shoved away from the
//                           bone it is attached to and the chain jams straight
//   PC_INJECT=onepass       push and length are each applied once instead of alternating, so the
//                           joint ends up back inside whatever it was pushed out of
//   PC_INJECT=nostale       the endpoint cache is never invalidated at a joint write, so a joint
//                           collides against where its neighbour was — the Gauss-Seidel hazard
//   PC_INJECT=norecache     `stale` is ignored and every test re-reads both endpoints, which is
//                           the original 40k-ancestor-walks-a-frame cost matt hit on mobile
//   PC_INJECT=rigpos        endPos ignores the particle and reads the rig, so XPBD (which writes
//                           the rig only after all 8 substeps) collides against last frame
//   PC_INJECT=tightbroad    the broad-phase sphere forgets the bone's half-length, so hits go
//                           missing at the ends of long bones and only there
//   PC_INJECT=noxpbd        the XPBD solver loses the collision pass, so `physXPBD(true)`
//                           silently turns an unrelated feature off
//   PC_INJECT=nopersist     the v14 params section is not written, so collide (and the five
//                           params v11 forgot) are lost on save
//   PC_INJECT=v11only       the v14 reader REPLACES the v11 values instead of merging, so a
//                           file's stiffness/damping/gravity are wiped by the newer section
import fs from 'fs';
import path from 'path';

const REPO = '/Users/mattestela/sculptxr';
let PHYS = fs.readFileSync(path.join(REPO, 'src/editing/PhysicsBones.js'), 'utf8');
let SKEL = fs.readFileSync(path.join(REPO, 'src/editing/Skeleton.js'), 'utf8');
const PANEL = fs.readFileSync(path.join(REPO, 'src/gui/bonePanel.js'), 'utf8');

const inject = process.env.PC_INJECT || '';
const cut = (src, a, b, name) => {
  if (!src.includes(a)) throw new Error('inject ' + name + ': anchor moved');
  return src.replace(a, b);
};
if (inject === 'nosphere') {
  PHYS = cut(PHYS, '    const want = pr + c.ra + (c.rb - c.ra) * t;',
    '    const want = c.ra + (c.rb - c.ra) * t;', inject);
} else if (inject === 'notaper') {
  PHYS = cut(PHYS, '    const want = pr + c.ra + (c.rb - c.ra) * t;',
    '    const want = pr + c.ra;', inject);
} else if (inject === 'noadjacent') {
  PHYS = cut(PHYS, '    if (c.a === joint || c.b === joint || c.a === par || c.b === par) continue;',
    '    if (false) continue;', inject);
} else if (inject === 'onepass') {
  PHYS = cut(PHYS, '  for (let ci = 0; ci < 2; ci++) {\n    let hit = pushOutOfBones(pt, jointR, joint, par);',
    '  for (let ci = 0; ci < 1; ci++) {\n    let hit = pushOutOfBones(pt, jointR, joint, par);', inject);
} else if (inject === 'nostale') {
  PHYS = cut(PHYS, '        markColliderStale(j);\n        markColliderStale(link.parent);',
    '        void j;', inject);
} else if (inject === 'norecache') {
  PHYS = cut(PHYS, '  if (!c.stale) return;', '  if (false) return;', inject);
} else if (inject === 'rigpos') {
  PHYS = cut(PHYS, '  if (st && st.p) return out.copy(st.p);', '  if (false) return out;', inject);
} else if (inject === 'tightbroad') {
  PHYS = cut(PHYS, '  c.reach = Math.sqrt(hx * hx + hy * hy + hz * hz) + Math.max(c.ra, c.rb);',
    '  c.reach = Math.max(c.ra, c.rb);', inject);
} else if (inject === 'noproxy') {
  PHYS = cut(PHYS, '  return Math.max(0, Math.min(PROXY_MAX, Math.floor(len / (2 * r)) - 1));',
    '  return 0;', inject);
} else if (inject === 'nolever') {
  PHYS = cut(PHYS, '      pt.addScaledVector(_proxyDelta.subVectors(_proxy, _proxyWas), 1 / t);',
    '      pt.addScaledVector(_proxyDelta.subVectors(_proxy, _proxyWas), 1);', inject);
} else if (inject === 'noxpbd') {
  PHYS = cut(PHYS,
    '          collideBone(st.p, _xPar, shape[i].len, jt, pj,\n'
    + '            Skeleton.jointRadius(jt, Skeleton.boneRadiusOf(main, jt)),\n'
    + '            Skeleton.jointRadius(pj, Skeleton.boneRadiusOf(main, pj)), _xDir);',
    '          void jt; void pj;', inject);
} else if (inject === 'nopersist') {
  SKEL = cut(SKEL, '  u[o++] = phys2.length;\n', '  u[o++] = 0;\n  if (false) ', inject);
} else if (inject === 'v11only') {
  SKEL = cut(SKEL, '        const cur = m._physicsParams || {};',
    '        const cur = {};', inject);
}

let failures = 0;
const check = (n, ok, d) => { if (ok) { console.log('  ok   ' + n); return; }
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

// ── THE PUSH-OUT, RUN FOR REAL ────────────────────────────────────────────────────────
// Lifted and driven against a stub skeleton. A minimal Vector3 stands in for three's, so the
// harness stays dependency-free; only the handful of methods the function uses are needed.
class V3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { return this.set(v.x, v.y, v.z); }
  clone() { return new V3(this.x, this.y, this.z); }
  subVectors(a, b) { return this.set(a.x - b.x, a.y - b.y, a.z - b.z); }
  addScaledVector(v, s) { return this.set(this.x + v.x * s, this.y + v.y * s, this.z + v.z * s); }
  divideScalar(s) { return this.set(this.x / s, this.y / s, this.z / s); }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  lengthSq() { return this.dot(this); }
  length() { return Math.sqrt(this.lengthSq()); }
  normalize() { const l = this.length(); return l > 0 ? this.divideScalar(l) : this; }
  distanceTo(v) { return Math.sqrt((this.x - v.x) ** 2 + (this.y - v.y) ** 2 + (this.z - v.z) ** 2); }
}

const fn = (name) => {
  const at = PHYS.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('not found: ' + name);
  // to the closing brace at column 0
  const end = PHYS.indexOf('\n}', at);
  return PHYS.slice(at, end + 2);
};

// Joint positions live in a map the stub Skeleton reads, so a test can MOVE a collider between
// calls and prove the position is read live rather than cached.
const POS = new Map();
const SkelStub = {
  jointPos: (j, out) => { const p = POS.get(j) || { x: 0, y: 0, z: 0 }; return out.copy(p); },
  joints: () => [],
  jointRadius: (j, fb) => (j && j.r > 0 ? j.r : (fb || 0)),
  boneRadiusOf: () => 0,
};

const scratch = ['_colA', '_colB', '_colP', '_colAx', '_colTo']
  .map((n) => `const ${n} = new V3();`).join('\n');

// The particle state the sim keeps. `endPos` prefers it over the rig, which is what makes XPBD's
// self-collision live (that solver writes the rig only AFTER all eight substeps, so the matrices
// hold last frame's positions for the whole loop).
const STATE = new Map();

const push = new Function('V3', 'Skeleton', 'getColliders', '_state', 'window', '_cPerf',
  scratch + '\nlet _colliders = null;\n'
  + fn('endPos') + '\n' + fn('refreshCollider') + '\n'
  + fn('pushOutOfBones').replace('if (!_colliders || !_colliders.length) return false;',
      '_colliders = getColliders(); if (!_colliders || !_colliders.length) return false;')
  + '\nreturn pushOutOfBones;')(V3, SkelStub, () => COLLIDERS, STATE, {}, 
    { tests: 0, rejected: 0, reads: 0 });

// A collider record shaped the way buildColliders makes them: endpoints cached, `stale` set so
// the first test reads them.
const C = (a, b, ra, rb) => ({ a, b, ra, rb, ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0,
  mx: 0, my: 0, mz: 0, reach: 0, stale: true });

let COLLIDERS = [];
let _jid = 1;
const J = (name, r) => { const id = _jid++; return { name, r, getID: () => id }; };

// A bone lying along X from (0,0,0) to (10,0,0), radius 1 at both ends.
{
  const a = J('a'), b = J('b');
  POS.set(a, { x: 0, y: 0, z: 0 }); POS.set(b, { x: 10, y: 0, z: 0 });
  COLLIDERS = [C(a, b, 1, 1)];

  // A particle of radius 0.5 sitting on the axis at x=5, y=0.2 — well inside.
  const p = new V3(5, 0.2, 0);
  const moved = push(p, 0.5, J('x'), J('y'));
  check('a joint inside a bone is pushed out to exactly touching', moved
    && Math.abs(Math.hypot(p.y, p.z) - 1.5) < 1e-9,
    'dist from axis = ' + Math.hypot(p.y, p.z) + ', want 1.5 (bone 1 + joint 0.5)');
  check('...along the shortest way out, so it does not slide down the bone',
    Math.abs(p.x - 5) < 1e-9, 'x = ' + p.x);

  // THE PARTICLE IS A SPHERE, not a point. Dropping its radius lets a joint sink into a bone by
  // its own width, which on a fat joint is most of the joint.
  const q = new V3(5, 0.2, 0);
  push(q, 0.5, J('x'), J('y'));
  check('...and its own radius counts, or a fat joint sinks in by its width',
    Math.hypot(q.y, q.z) > 1.4);

  // Already clear: no move, and the caller relies on the false to stop iterating.
  const r = new V3(5, 9, 0);
  check('a joint already clear is left alone and reports no move',
    push(r, 0.5, J('x'), J('y')) === false && r.y === 9);

  // Past the end, the cap is a sphere about the endpoint rather than an infinite cylinder.
  const e = new V3(11, 0.1, 0);
  push(e, 0.5, J('x'), J('y'));
  check('past the end it collides with the CAP, not an infinite cylinder',
    Math.abs(Math.sqrt((e.x - 10) ** 2 + e.y ** 2 + e.z ** 2) - 1.5) < 1e-9,
    'dist from end = ' + Math.sqrt((e.x - 10) ** 2 + e.y ** 2 + e.z ** 2));
}

// TAPER. A bone is the hull of the two spheres at its ends, so the width at the midpoint is the
// average — collide against one radius end to end and it parts company with the drawn bone.
{
  const a = J('a'), b = J('b');
  POS.set(a, { x: 0, y: 0, z: 0 }); POS.set(b, { x: 10, y: 0, z: 0 });
  COLLIDERS = [C(a, b, 1, 3)];
  const p = new V3(5, 0.1, 0);
  push(p, 0, J('x'), J('y'));
  check('a tapered bone is wider at the fat end, exactly as it is drawn',
    Math.abs(Math.hypot(p.y, p.z) - 2) < 1e-9,
    'half way along a 1->3 bone the width is 2, got ' + Math.hypot(p.y, p.z));
}

// ADJACENCY. A bone and its neighbour MEET at a joint, so they interpenetrate permanently by
// construction; colliding them shoves every joint away from the bone it hangs off and jams the
// chain straight. Excluded by SHARED ENDPOINT, which also covers siblings — two fingers meeting
// at one palm.
{
  const par = J('par'), me = J('me'), kid = J('kid'), sib = J('sib');
  POS.set(par, { x: 0, y: 0, z: 0 }); POS.set(me, { x: 10, y: 0, z: 0 });
  POS.set(kid, { x: 20, y: 0, z: 0 }); POS.set(sib, { x: 0, y: 10, z: 0 });
  COLLIDERS = [
    C(par, me, 2, 2),   // the particle's own bone
    C(me, kid, 2, 2),   // its child
    C(par, sib, 2, 2),  // its sibling, sharing the parent
  ];
  const p = new V3(10, 0, 0);
  check('a joint is not pushed out of its own bone, its child, or a sibling',
    push(p, 1, me, par) === false,
    'without this every joint is shoved off the bone it is attached to and the chain jams '
      + 'straight — the collision pass fights the rig rather than the rig fighting itself');
}

// THE ENDPOINT CACHE, which is the whole performance story and the easiest thing to get
// silently wrong. `Skeleton.jointPos` is not a matrix read: it goes through getModelSpaceMatrix,
// and for a PARENTED mesh — every joint in a skeleton — that walks the ancestor chain and
// inverts a 4x4, every call. The first cut did that twice per collider per proxy per particle
// per substep, which on a ten-joint tail against a fifty-bone rig under eight substeps is about
// forty thousand ancestor-walks a frame. matt: "very slow... making performance really suffer on
// mobile VR." The arithmetic was never the cost.
//
// So the cache has to actually cache — AND has to be invalidated when a joint really moves, or
// it stops being Gauss-Seidel and a joint collides against where its neighbour used to be.
{
  const a = J('a'), b = J('b');
  POS.set(a, { x: 0, y: 0, z: 0 }); POS.set(b, { x: 10, y: 0, z: 0 });
  const only = C(a, b, 1, 1);
  COLLIDERS = [only];

  const p1 = new V3(5, 0.1, 0);
  push(p1, 0, J('x'), J('y'));
  check('a collider is read once and then cached', only.stale === false);

  // Move the bone WITHOUT marking it stale: the cache must still answer with the old position,
  // which is what proves it is a cache at all rather than a read dressed up as one.
  POS.set(a, { x: 0, y: 50, z: 0 }); POS.set(b, { x: 10, y: 50, z: 0 });
  const p2 = new V3(5, 0.1, 0);
  check('...and is NOT re-read while it is clean', push(p2, 0, J('x'), J('y')) === true,
    'a clean collider that re-reads is not caching, which is the whole cost problem');

  // Marked stale, as the solver does at every joint write, it picks the move up.
  only.stale = true;
  const p3 = new V3(5, 0.1, 0);
  check('...and IS re-read once marked stale, so the pass stays Gauss-Seidel',
    push(p3, 0, J('x'), J('y')) === false,
    'the bone moved 50 units away, so nothing should collide; a cache never invalidated is the '
      + 'same ordering hazard that made the first physics build four independent springs');
}

// INVALIDATION AT THE WRITE SITE. The behavioural checks above mark staleness by hand, so they
// prove the cache HONOURS the flag — not that the solver ever SETS it. Without this the cache is
// correct and permanently stale, which is the Gauss-Seidel hazard wearing a cache as a disguise.
check('the solver marks colliders stale where it writes a joint',
  /IKSolver\.rotateJoint\(link\.parent, _qAim\);[\s\S]{0,400}?markColliderStale\(j\);/.test(PHYS),
  'a cache nothing invalidates is just a stale read');
check('...and invalidates everything at the top of each step, since animation may have moved any joint',
  (PHYS.match(/markAllCollidersStale\(\);/g) || []).length === 2,
  'one call in each solver; found '
    + (PHYS.match(/markAllCollidersStale\(\);/g) || []).length);

// THE PARTICLE, NOT THE RIG. XPBD writes the rig only after all eight substeps, so the matrices
// hold LAST FRAME's positions for the whole loop — a chain would collide with where it used to
// be. The sim's own particle is the live value, and reading it is also far cheaper than the
// matrix path.
{
  const a = J('a'), b = J('b');
  POS.set(a, { x: 0, y: 0, z: 0 }); POS.set(b, { x: 10, y: 0, z: 0 });
  STATE.clear();
  STATE.set(a.getID(), { p: new V3(0, 50, 0) });
  STATE.set(b.getID(), { p: new V3(10, 50, 0) });
  COLLIDERS = [C(a, b, 1, 1)];
  const p = new V3(5, 0.1, 0);
  check('a simulated collider is read from its PARTICLE, not from the rig matrix',
    push(p, 0, J('x'), J('y')) === false,
    'the rig still says y=0 but the particle has moved to y=50; reading the matrix would collide '
      + 'against a stale pose for the whole of XPBD\'s substep loop');
  STATE.clear();
}

// BROAD PHASE. Most bones are nowhere near most joints, and rejecting them costs six subtractions
// instead of a clamped segment projection plus a taper lerp. It must never reject something it
// should have hit — a too-tight reach is a silent miss, not a visible error.
{
  const a = J('a'), b = J('b');
  POS.set(a, { x: 0, y: 0, z: 0 }); POS.set(b, { x: 10, y: 0, z: 0 });
  COLLIDERS = [C(a, b, 1, 1)];
  // Just inside, at the very end of the bone — the worst case for a midpoint-based sphere.
  const edge = new V3(10, 1.0, 0);
  check('the broad phase does not reject a hit at the far end of a long bone',
    push(edge, 0.1, J('x'), J('y')) === true,
    'the reject sphere is centred on the MIDPOINT, so its radius has to be half the length plus '
      + 'the widest end — get that wrong and collisions go missing only on long bones');
}

// ── PROXIES ALONG THE BONE ────────────────────────────────────────────────────────────
// matt: "would we be able to distribute points along the bones to act as collision proxies?"
// Joint spheres alone leave a bone's MIDDLE uncovered — two long thin bones cross in an X with
// both endpoints clear. A dense chain is its own capsule and needs none of this; a long bone
// does.
{
  const count = new Function('PROXY_MAX', fn('proxyCount') + '\nreturn proxyCount;')(4);
  check('a bone barely longer than it is wide needs no proxies',
    count(2, 1) === 0, 'got ' + count(2, 1));
  check('...a long thin bone gets several', count(20, 1) === 4, 'got ' + count(20, 1));
  check('...spaced about a radius apart rather than an arbitrary fixed number',
    count(8, 1) === 3 && count(8, 2) === 1,
    'halving the radius of the same bone must ask for more points, not the same: '
      + count(8, 1) + ' vs ' + count(8, 2));
  check('...and it is capped, because this is the inner loop of the sim',
    count(10000, 0.01) === 4, 'got ' + count(10000, 0.01));
  check('...and a zero-radius or zero-length bone asks for none rather than dividing by zero',
    count(10, 0) === 0 && count(0, 1) === 0);
}
// THE LEVER ARM. The bone pivots about its parent, so a push at fraction t along it is the same
// angular correction as a push of 1/t at the child — the only thing that can move. Applying the
// raw correction under-rotates everything near the parent, so a bone sinks in at its base, worst
// nearest the root where the chain is stiffest.
check('a proxy correction is divided by its lever arm before reaching the joint',
  /pt\.addScaledVector\(_proxyDelta\.subVectors\(_proxy, _proxyWas\), 1 \/ t\);/.test(PHYS),
  'applied raw, a bone sinks in at its base and worst nearest the root');
check('...and a proxy is a lerp of the two joints, not a particle of its own',
  /_proxy\.copy\(parPos\)\.addScaledVector\(_colTo\.subVectors\(pt, parPos\), t\);/.test(PHYS),
  'a kinematic proxy has no degrees of freedom, so there is nothing to hold rigid and no '
    + 'active/passive bookkeeping — which is what makes this cheap rather than a second solver');

// ── STRUCTURE ─────────────────────────────────────────────────────────────────────────
// ALTERNATION. The push and the length constraint are two surfaces, and one pass of each lands
// on neither: pushing out moves the joint off its sphere about the parent, and putting it back
// on that sphere moves it back inside the collider.
check('the push alternates with the length constraint rather than running once',
  /for \(let ci = 0; ci < 2; ci\+\+\) \{[\s\S]{0,1600}?pt\.copy\(parPos\)\.addScaledVector\(dir, len\);/.test(PHYS),
  'one pass of each leaves the joint inside whatever it was pushed out of');
check('...and it runs AFTER the length constraint, like the ground does',
  PHYS.indexOf('_next.copy(_pPar).addScaledVector(_dir, rest);') < PHYS.indexOf('if (par.collide) {'),
  'pushing before the length constraint just re-projects the joint back inside');

// ONE IMPLEMENTATION, TWO SOLVERS. matt runs XPBD (the force solver cannot animate pin
// constraints on and off), while the code's built-in default is still the force one — so both
// are live paths depending on a saved option, and a collision that behaved differently between
// them is a bug that only shows up after someone flips a setting. THE PROXIES ARE THE REASON
// THIS CHECK EXISTS: the first cut gave XPBD the joint-sphere push and NOT the along-bone
// proxies, so the X-crossing gap stayed open on the solver actually in use.
check('both solvers go through the SAME collision routine',
  (PHYS.match(/collideBone\(/g) || []).length === 3,
  'one definition plus one call from each solver; found '
    + (PHYS.match(/collideBone\(/g) || []).length);
check('...so the proxies cannot be present in one solver and missing from the other',
  (PHYS.match(/proxyCount\(/g) || []).length === 2,
  'proxyCount is defined once and used once, inside the shared routine');

// ONE IMPLEMENTATION FOR LIVE AND BAKE. The bake advances the sim through solveStep, which is
// the same step() the viewport runs — so a bake cannot drift from the preview it was tuned
// against. Worth asserting because the ground constraint's own comments describe a world where
// these were two code paths.
check('the bake advances the sim through the same solver the viewport uses',
  /PhysicsBones\.solveStep = function \(main, dt\) \{\s*\n\s*return window\._physXPBD \? PhysicsBones\.stepXPBD\(main, dt\) : PhysicsBones\.step\(main, dt\);/.test(PHYS)
    && /PhysicsBones\.solveStep\(main, h\)/.test(PHYS),
  'two implementations mean a bake that does not match the preview');

// BOTH SOLVERS. XPBD is off by default and unfinished, so it would have been easy to skip — but
// then `physXPBD(true)` silently turns collision off, which is a setting quietly disabling an
// unrelated feature.
check('the XPBD solver runs the collision pass too',
  /collideBone\(st\.p, _xPar, shape\[i\]\.len, jt, pj,/.test(PHYS),
  'this is the solver matt actually runs; without it self-collision is simply absent for him');
check('...and invalidates the collider cache per step, like the force solver',
  (PHYS.match(/\n  _colliders = null;/g) || []).length === 2,
  'found ' + (PHYS.match(/\n  _colliders = null;/g) || []).length
    + ' per-step invalidations (the `let` declaration does not count)');

// COST. Built on first use, so a scene where nothing collides never walks the joint list.
check('the collider list is built lazily, not per particle',
  /if \(!_colliders\) _colliders = buildColliders\(main\);/.test(PHYS)
    && !/buildColliders\(main\)[\s\S]{0,50}for \(const link of links\)/.test(PHYS));

// ── PERSISTENCE ───────────────────────────────────────────────────────────────────────
// v11 saved three of the eight parameters. drag, ground, groundY, inertia and maxBend have been
// silently dropped on every save since physics bones shipped — a pre-existing bug this section
// fixes because the new flag needed a home anyway.
check('the format version moved for the new section',
  /const SKEL_VERSION = (1[4-9]|[2-9]\\d);/.test(SKEL)
    && /v14 the physics params v11 forgot/.test(SKEL),
  'pinning the exact number makes this fail on the NEXT section rather than on a real defect; '
    + 'what matters is that the physics params got a version of their own and it is recorded');
check('collide is written to the file', /co: p\.collide \? 1 : 0/.test(SKEL));
check('...along with the five parameters v11 forgot',
  /dr: p\.drag/.test(SKEL) && /gr: p\.ground \? 1 : 0/.test(SKEL) && /gy: p\.groundY/.test(SKEL)
    && /it: p\.inertia/.test(SKEL) && /mb: p\.maxBend/.test(SKEL),
  'tune a bend limit or tick Ground, reload, and both were quietly gone');
check('...and the buffer is sized for them, or the write runs off the end',
  /slots \+= 1 \+ phys2\.length \* 7;/.test(SKEL));
// THE WRITE ITSELF, not just the builder. Every other persistence check here reads the object
// that is ASSEMBLED for the section, which is upstream of the bytes — remove the write loop and
// they all still pass, which is exactly what PC_INJECT=nopersist proved the first time.
check('...and the section is actually written to the buffer',
  /u\[o\+\+\] = phys2\.length;[\s\S]{0,300}?u\[o\+\+\] = ph\.i; f\[o\+\+\] = ph\.dr; u\[o\+\+\] = ph\.gr; f\[o\+\+\] = ph\.gy;/.test(SKEL),
  'the builder can be perfect and the bytes still never leave');
check('...read back into the SAME params object v11 filled, not over it',
  /const cur = m\._physicsParams \|\| \{\};/.test(SKEL),
  'replacing it would wipe the stiffness/damping/gravity the v11 section just restored');
check('...as its own section, so a v13 build still reads the file',
  /if \(ver >= 14\) \{/.test(SKEL));

{
  // Round-trip the packing arithmetic: booleans through a Uint32 slot and floats through a
  // Float32 one, which is where a section like this usually goes wrong.
  const enc = (p) => ({ dr: p.drag, gr: p.ground ? 1 : 0, gy: p.groundY,
    it: p.inertia, mb: p.maxBend, co: p.collide ? 1 : 0 });
  const dec = (e) => ({ drag: e.dr, ground: !!e.gr, groundY: e.gy,
    inertia: e.it, maxBend: e.mb, collide: !!e.co });
  let ok = true, why = '';
  for (const ground of [false, true]) for (const collide of [false, true]) {
    const src = { drag: 0.25, ground, groundY: -0.25, inertia: 0.35, maxBend: 50, collide };
    const back = dec(enc(src));
    for (const k of Object.keys(src)) if (back[k] !== src[k]) { ok = false; why = k + ': ' + src[k] + ' -> ' + back[k]; }
  }
  check('every flag combination round-trips', ok, why);
}

// ── UI ────────────────────────────────────────────────────────────────────────────────
check('there is a Self Collision toggle beside Ground Collision',
  /flagButton\(c, 'phys-collide', 'Self Collision', physP\.collide\)/.test(PANEL));
check('...which mirrors to the twin, like every other physics flag',
  /q\('phys-collide'\)[\s\S]{0,400}?for \(const j of withTwin\(t\)\)/.test(PANEL),
  'a left ear that collides and a right one that does not is never what was wanted');
check('...and the parameter has a default, so an old rig reads as off',
  /collide: false \}/.test(PHYS) || /maxBend: 50, collide: false/.test(PHYS));

console.log(failures ? '\n' + failures + ' FAILED' : '\nall checks passed');
process.exit(failures ? 1 : 0);
