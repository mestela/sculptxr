// A JOINT'S GUESSED ROTATION FRAME: X down the bone, Z about the bend, from the chain alone.
//
// Pure maths on a tree of positions (JointFrame.jointFrame), then the same on matt's rig.sxr when
// it is on the Desktop, where the interesting case lives: pre-bent arms, legs and neck.
//
// Run: node scratchpad/jointframe_test.mjs
import fs from 'fs';
import path from 'path';
import { vec3 } from 'gl-matrix';
const REPO = new URL('..', import.meta.url).pathname;
const { jointFrame, BEND_MIN } = await import(path.join(REPO, 'src/editing/JointFrame.js'));

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };
const near = (a, b, e = 1e-4) => vec3.dist(a, b) < e;

const mk = (pts, parents) => ({
  pos: (i) => vec3.fromValues(...pts[i]),
  parent: (i) => (parents[i] === undefined ? null : parents[i]),
  children: (i) => Object.keys(parents).map(Number).filter((k) => parents[k] === i),
});
const orthonormal = (f) => Math.abs(vec3.dot(f.x, f.y)) < 1e-5 && Math.abs(vec3.dot(f.x, f.z)) < 1e-5
  && Math.abs(vec3.dot(f.y, f.z)) < 1e-5 && Math.abs(vec3.len(f.x) - 1) < 1e-5 && Math.abs(vec3.len(f.z) - 1) < 1e-5
  && near(vec3.cross([0, 0, 0], f.x, f.y), f.z);
const rotZ = (v, a) => [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a), v[2]];

// 1. a bent chain in the xy plane: the hinge is z, X is down the child bone
{
  const t = mk([[0, 0, 0], [0, -1, 0], [1, -2, 0]], { 1: 0, 2: 1 });
  const f = jointFrame(t, 1);
  check('bend: hinge is the plane normal', near(f.z, [0, 0, 1]) || near(f.z, [0, 0, -1]));
  check('bend: X is down the bone to the child', near(f.x, vec3.normalize([0, 0, 0], [1, -1, 0])));
  check('bend: right-handed and orthonormal', orthonormal(f));
  // positive turn about Z takes the incoming bone TOWARD the outgoing one = bends further
  const a = [0, -1, 0], b = vec3.normalize([0, 0, 0], [1, -1, 0]);
  const turned = vec3.transformQuat([0, 0, 0], a, [0, 0, Math.sin(Math.PI / 8) * f.z[2], Math.cos(Math.PI / 8)]);
  check('bend: a positive turn bends further the way the chain bends', vec3.dot(turned, b) > vec3.dot(a, b));
}
// 2. the mirrored limb: same bend, other side, hinge flips so "positive = more bend" still holds
{
  const L = jointFrame(mk([[0, 0, 0], [0, -1, 0], [1, -2, 0]], { 1: 0, 2: 1 }), 1);
  const R = jointFrame(mk([[0, 0, 0], [0, -1, 0], [-1, -2, 0]], { 1: 0, 2: 1 }), 1);
  check('mirror: hinges are opposite', near(L.z, vec3.negate([0, 0, 0], R.z)));
}
// 3. a straight joint has no plane. It does NOT inherit the bend above it (a straight knee below
//    a sideways-bent hip would flex about the hip's abduction axis); its hinge is across the limb
//    and across the way the character faces.
{
  const t = mk([[0, 0, 0], [0, -1, 0], [1, -2, 0], [2, -3, 0]], { 1: 0, 2: 1, 3: 2 });  // joint 2 is straight
  const here = jointFrame(t, 2);
  check('straight joint: reference hinge, not inherited', here.source === 'reference');
  check('straight joint: still orthonormal', orthonormal(here));
  // a straight leg standing along -Y, character facing +Z: it flexes about the side axis (X)
  const leg = jointFrame(mk([[0, 0, 0], [0, -1, 0], [0, -2, 0], [0, -3, 0]], { 1: 0, 2: 1, 3: 2 }), 2);
  check('straight standing leg flexes about the side axis', near(leg.z, [-1, 0, 0]) || near(leg.z, [1, 0, 0]));
  // a T-posed arm along +X flexes about the vertical
  const arm = jointFrame(mk([[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]], { 1: 0, 2: 1, 3: 2 }), 2);
  check('straight T-posed arm flexes about the vertical', near(arm.z, [0, 1, 0]) || near(arm.z, [0, -1, 0]));
}
// 4. a leaf continues the incoming bone and inherits
{
  const t = mk([[0, 0, 0], [0, -1, 0], [1, -2, 0]], { 1: 0, 2: 1 });
  const leaf = jointFrame(t, 2);
  check('leaf: X continues the incoming bone', near(leaf.x, vec3.normalize([0, 0, 0], [1, -1, 0])));
  check('leaf: hinge inherited from its parent', near(leaf.z, jointFrame(t, 1).z) || vec3.dot(leaf.z, jointFrame(t, 1).z) > 0.99);
  check('leaf: orthonormal', orthonormal(leaf));
}
// 5. a root with several children heads for the longest chain
{
  const t = mk([[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 2, 0], [0, 3, 0]], { 1: 0, 2: 0, 3: 2, 4: 3 });
  const f = jointFrame(t, 0);
  check('root: X heads down the longest chain', near(f.x, [0, 1, 0]));
  check('root: orthonormal', orthonormal(f));
}
// 6. a fork continues along the straightest child, not the first one
{
  const t = mk([[0, 0, 0], [0, -1, 0], [0.2, -2, 0], [3, -1, 0]], { 1: 0, 2: 1, 3: 1 });
  check('fork: continues along the straightest child', near(jointFrame(t, 1).x, vec3.normalize([0, 0, 0], [0.2, -1, 0])));
}
// 7. nothing bends anywhere: a stable reference frame, not an arbitrary one
{
  const t = mk([[0, 0, 0], [0, -1, 0], [0, -2, 0]], { 1: 0, 2: 1 });
  const f = jointFrame(t, 1);
  check('straight line: reference frame', f.source === 'reference' && orthonormal(f));
  // along the facing direction itself the reference would be degenerate
  const g = jointFrame(mk([[0, 0, 0], [0, 0, 1], [0, 0, 2]], { 1: 0, 2: 1 }), 1);
  check('limb along the facing direction still gets a frame', orthonormal(g));
}
// 8. nearly straight is treated as straight (no noisy plane)
{
  const eps = Math.sin(BEND_MIN) * 0.3;
  const t = mk([[0, 0, 0], [0, -1, 0], [eps, -2, 0.0]], { 1: 0, 2: 1 });
  check('near-straight: not a bend', jointFrame(t, 1).source !== 'bend');
}

// 9. matt's rig, if it is where he keeps it: every bent joint's hinge must be perpendicular to
//    both bones, and X must lie along the outgoing bone
const RIG = path.join(process.env.HOME, 'Desktop/rig.sxr');
if (fs.existsSync(RIG)) {
  const buf = fs.readFileSync(RIG); const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  let end = ab.byteLength, blk = null;
  for (let g = 0; g < 8 && end >= 8; g++) { const ft = new Uint32Array(ab, end - 8, 2); const st = end - 8 - ft[1];
    if (ft[0] === 0x534b454c) { blk = { st, len: ft[1] }; break; } if (ft[0] !== 0x46475250) break; end = st; }
  const u = new Uint32Array(ab, blk.st, blk.len / 4), f32 = new Float32Array(ab, blk.st, blk.len / 4);
  let o = 3; const n = u[2]; const rows = [];
  for (let i = 0; i < n; i++) { rows.push({ mi: u[o], pi: u[o + 1], bone: u[o + 2] }); o += 6; }
  const ns = u[o++]; for (let i = 0; i < ns; i++) { o++; const nj = u[o++], nv = u[o++]; o++; o += nj + nv * 8 + nv * 3 + nj * 16; }
  const nr = u[o++]; const rest = new Map(); for (let i = 0; i < nr; i++) { const mi = u[o++]; rest.set(mi, Array.from(f32.subarray(o, o + 16))); o += 16; }
  const J = rows.filter((r) => r.bone & 1); const ids = new Set(J.map((r) => r.mi)); const par = {}; J.forEach((r) => { if (ids.has(r.pi)) par[r.mi] = r.pi; });
  const mul = (a, b) => { const c = new Array(16).fill(0); for (let i = 0; i < 4; i++) for (let k = 0; k < 4; k++) for (let j = 0; j < 4; j++) c[k * 4 + j] += a[i * 4 + j] * b[k * 4 + i]; return c; };
  const W = new Map(); const wm = (i) => { if (W.has(i)) return W.get(i); const l = rest.get(i); const m = par[i] !== undefined ? mul(wm(par[i]), l) : l; W.set(i, m); return m; };
  const pts = {}; ids.forEach((i) => { const m = wm(i); pts[i] = [m[12], m[13], m[14]]; });
  const tree = { pos: (i) => vec3.fromValues(...pts[i]), parent: (i) => (par[i] === undefined ? null : par[i]),
    children: (i) => [...ids].filter((k) => par[k] === i) };
  const names = { 23: 'pelvis', 11: 'spine', 7: 'spine2', 14: 'neck base', 4: 'neck', 2: 'head', 5: 'clavicle L', 6: 'shoulder L', 17: 'elbow L', 8: 'wrist L', 19: 'knee L? (hip)', 21: 'knee' };
  console.log('\n  rig.sxr frames (X = down bone, Z = hinge):');
  const fmt = (v) => '(' + [...v].map((x) => x.toFixed(2)).join(', ') + ')';
  for (const i of ids) {
    const fr = jointFrame(tree, i); if (!fr) continue;
    console.log('   #' + String(i).padEnd(3) + ' ' + fr.source.padEnd(9) + ' X' + fmt(fr.x) + ' Z' + fmt(fr.z));
    check('rig #' + i + ': orthonormal', orthonormal(fr));
    if (fr.source === 'bend') {
      const p = par[i], k = tree.children(i);
      const a = vec3.normalize([0, 0, 0], vec3.sub([0, 0, 0], tree.pos(i), tree.pos(p)));
      check('rig #' + i + ': hinge is perpendicular to the incoming bone', Math.abs(vec3.dot(fr.z, a)) < 1e-3);
      check('rig #' + i + ': X lies along a child bone', k.some((c) => near(fr.x, vec3.normalize([0, 0, 0], vec3.sub([0, 0, 0], tree.pos(c), tree.pos(i))), 1e-3)));
    }
  }
} else console.log('  (rig.sxr not on the Desktop: rig section skipped)');

if (failures) { console.log(failures + ' FAILED'); process.exit(1); }
console.log('all checks passed');
