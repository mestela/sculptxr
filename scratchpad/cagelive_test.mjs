// Node harness for LIVE WEIGHTS FROM SCULPTED CAPSULES, and the x-ray that lets you see them.
//
// matt: "i don't see the skin weights changing on the skin in terms of colours as i sculpt and
// move the capsule meshes" -- the cage IS the weights, so a stroke on one is a weight edit and
// should show as one without a trip through Rebind.
//
// The load-bearing claim is the shortcut. Re-measuring every vertex against every capsule after
// every stroke is what makes this too slow to do live, so only the vertices the touched capsule
// can have changed are re-measured (matt's own suggestion: "only testing against the last
// touched capsule"). A candidate rule that MISSES a vertex is a wrong weight that shows up in
// one sculpt out of ten -- so this runs the real rule against a full brute-force solve and
// demands they agree exactly, rather than checking that the rule exists.
//
// Run: node scratchpad/cagelive_test.mjs
//   CL_INJECT=ownedonly   candidates = what the bone already owned, so a GROWN capsule misses
//   CL_INJECT=boxonly     candidates = the new box, so a SHRUNK capsule keeps stale weights
//   CL_INJECT=nopad       the box is not padded, so vertices just outside it are missed
//   CL_INJECT=poseframes  a live re-solve measures at the CURRENT pose, not the bind pose
//   CL_INJECT=nohook      a finished stroke no longer re-solves the skin
//   CL_INJECT=capsulesnap a re-solve ignores cages and reasserts the drawn capsules
//   CL_INJECT=noxray      the x-ray slider stops reaching the bound meshes
//   CL_INJECT=sharedmat   the skin keeps the SHARED material, so its alpha leaks to every mesh
//   CL_INJECT=xraydepth   a see-through skin goes on writing depth, hiding the capsules inside
import fs from 'fs';
import path from 'path';

const REPO = '/Users/mattestela/sculptxr';
const THREE = await import(path.join(REPO, 'node_modules/three/build/three.module.js'));
let SRC   = fs.readFileSync(path.join(REPO, 'src/editing/WeightCage.js'), 'utf8');
let SKIN  = fs.readFileSync(path.join(REPO, 'src/editing/Skinning.js'), 'utf8');
const SM  = fs.readFileSync(path.join(REPO, 'src/editing/SculptManager.js'), 'utf8');
const PANEL = fs.readFileSync(path.join(REPO, 'src/gui/bonePanel.js'), 'utf8');

const inject = process.env.CL_INJECT || '';
const cut = (a, b, n) => {
  if (!SRC.includes(a)) throw new Error('inject ' + n + ': anchor moved');
  SRC = SRC.replace(a, b);
};
const cutSkin = (a, b, n) => {
  if (!SKIN.includes(a)) throw new Error('inject ' + n + ': anchor moved');
  SKIN = SKIN.replace(a, b);
};
if (inject === 'ownedonly') {
  cut(`    const x = verts[i * 3], y = verts[i * 3 + 1], z = verts[i * 3 + 2];
    if (x >= bb[0] - pad && x <= bb[3] + pad &&
        y >= bb[1] - pad && y <= bb[4] + pad &&
        z >= bb[2] - pad && z <= bb[5] + pad) out.push(i);`, '', inject);
} else if (inject === 'boxonly') {
  cut('    if (idx[i * maxInfluences] === cage.joint) { out.push(i); continue; }', '', inject);
} else if (inject === 'nopad') {
  cut('    const pad = d > 0 ? d : 0;', '    const pad = 0;', inject);
} else if (inject === 'poseframes') {
  cutSkin('    (ji) => new THREE.Matrix4().copy(mesh._skinInvBind[ji]).invert());',
    '    (ji) => new THREE.Matrix4().fromArray(joints[ji].getModelSpaceMatrix()));', inject);
} else if (inject === 'capsulesnap') {
  cutSkin('  if (prepared.length) {\n    raw = resolveCagesRaw(mesh, prepared, nbV, touched);',
    '  if (false) {\n    raw = resolveCagesRaw(mesh, prepared, nbV, touched);', inject);
} else if (inject === 'nohook' || inject === 'noxray') {
  // Both live in other files; handled at their checks below.
}

// The real Geometry, not a stub: the whole measurement rests on distance2PointTriangle.
const GEO = fs.readFileSync(path.join(REPO, 'src/math3d/Geometry.js'), 'utf8');
const geoBody = GEO.split('\n').filter((l) => !/^import /.test(l))
  .join('\n').replace(/^export default Geometry;$/m, '');
const glm = await import(path.join(REPO, 'node_modules/gl-matrix/esm/index.js'));
const Geometry = new Function('vec3', 'mat4', 'quat',
  'var Geometry = {};' + geoBody + '; return Geometry;')(glm.vec3, glm.mat4, glm.quat);

const Utils = { TRI_INDEX: 4294967295 };
const body = SRC.split('\n').filter((l) => !/^import /.test(l)).join('\n')
  .replace(/^export default WeightCage;$/m, '');
const WeightCage = new Function('THREE', 'Skeleton', 'Geometry', 'Utils', 'window',
  body + '\nreturn WeightCage;')(THREE, {}, Geometry, Utils, {});

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

const MAXI = 4;

// A prepared cage, straight from the real capsule geometry -- the same shape the bake makes.
const prep = (joint, ax, ay, az, bx, by, bz, r, scale = 1) => {
  const g = WeightCage.capsuleGeometry(ax, ay, az, bx, by, bz, r, 10, 3, 2);
  const v = new Float32Array(g.verts.length);
  const cx = (ax + bx) / 2, cy = (ay + by) / 2, cz = (az + bz) / 2;
  for (let i = 0; i < g.verts.length; i += 3) {
    // "Sculpting" the capsule = pushing its vertices out from its own centre.
    v[i]     = cx + (g.verts[i]     - cx) * scale;
    v[i + 1] = cy + (g.verts[i + 1] - cy) * scale;
    v[i + 2] = cz + (g.verts[i + 2] - cz) * scale;
  }
  const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < v.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      if (v[i + k] < bb[k]) bb[k] = v[i + k];
      if (v[i + k] > bb[k + 3]) bb[k + 3] = v[i + k];
    }
  }
  return { joint, verts: v, faces: g.faces, bb, mesh: null };
};

const slackOf = (cages) => {
  let d = 0;
  for (const c of cages) d = Math.max(d, Math.hypot(c.bb[3] - c.bb[0], c.bb[4] - c.bb[1], c.bb[5] - c.bb[2]));
  return d;
};

// A block of sample points spanning both capsules and the space around them.
const V = [];
for (let x = -1.4; x <= 1.4001; x += 0.2)
  for (let y = -0.6; y <= 2.6001; y += 0.2)
    for (let z = -0.6; z <= 0.6001; z += 0.3) V.push(x, y, z);
const verts = new Float32Array(V);
const nbV = verts.length / 3;

// Two bones: one up the middle (joint 0), one out to the side (joint 1).
const A0 = () => prep(0, 0, 0, 0, 0, 2, 0, 0.4);
const B  = (scale) => prep(1, 0.8, 0.4, 0, 0.8, 1.6, 0, 0.3, scale);

// ── THE SHORTCUT AGREES WITH THE LONG WAY ─────────────────────────────────────────────
//
// Grown and shrunk are separate cases and they fail in opposite directions: a grown capsule
// takes vertices it never owned (so "everything I owned" is not enough), a shrunk one loses
// vertices no new box contains (so "everything in the new box" is not enough). Both run.
for (const [label, before, after] of [
  ['a capsule grown by sculpting', 1.0, 1.9],
  ['a capsule shrunk by sculpting', 1.9, 1.0],
]) {
  const cagesBefore = [A0(), B(before)];
  const cagesAfter  = [A0(), B(after)];
  const base = WeightCage.weights(verts, nbV, cagesBefore, MAXI, slackOf(cagesBefore));
  const full = WeightCage.weights(verts, nbV, cagesAfter, MAXI, slackOf(cagesAfter));

  const touched = cagesAfter[1];
  const cand = WeightCage.candidates(verts, nbV, touched, base, MAXI);
  const part = WeightCage.weightsPartial(verts, cagesAfter, MAXI, slackOf(cagesAfter), cand, base);

  let changed = 0, wrong = 0, firstWrong = -1;
  for (let i = 0; i < nbV; i++) {
    if (base.idx[i * MAXI] !== full.idx[i * MAXI]) changed++;
    if (part.idx[i * MAXI] !== full.idx[i * MAXI]) { wrong++; if (firstWrong < 0) firstWrong = i; }
  }
  check(label + ' changes some weights', changed > 0,
    changed + ' of ' + nbV + ' vertices -- a test where nothing moved proves nothing');
  check('...and the shortcut matches a full solve exactly', wrong === 0,
    wrong + ' vertices differ, first at ' + firstWrong);
  check('...while measuring far fewer vertices', cand.length < nbV,
    cand.length + ' of ' + nbV + ' measured');
}

// A candidate that reaches no cage at all must keep what it had rather than being unweighted.
{
  const cages = [A0()];
  const base = WeightCage.weights(verts, nbV, cages, MAXI, slackOf(cages));
  const far = [];
  for (let i = 0; i < nbV; i++) if (base.idx[i * MAXI] < 0) far.push(i);
  const part = WeightCage.weightsPartial(verts, cages, MAXI, 0.0001, [...far, 0], base);
  let lost = 0;
  for (let i = 0; i < nbV; i++) if (base.idx[i * MAXI] >= 0 && part.idx[i * MAXI] < 0) lost++;
  check('a broadphase miss never unweights a vertex', lost === 0, lost + ' vertices dropped');
}

// ── THE WIRING ────────────────────────────────────────────────────────────────────────
{
  check('a live re-solve uses the cages when there are any',
    /const prepared = prepareCages\(main, joints,/.test(SKIN) &&
    /if \(prepared\.length\) \{\s*\n\s*raw = resolveCagesRaw\(mesh, prepared, nbV, touched\)/.test(SKIN),
    'otherwise sculpting a cage changes nothing while the drawn capsules are quietly reasserted');
  check('...measured at the BIND pose, not wherever the character is standing',
    /\(ji\) => new THREE\.Matrix4\(\)\.copy\(mesh\._skinInvBind\[ji\]\)\.invert\(\)/.test(SKIN),
    'the rest vertices are bind-pose, so a posed cage would jump the weights on every pose change');
  check('...and bind and re-solve share one cage-preparation path',
    (SKIN.match(/= prepareCages\(main, joints,/g) || []).length === 2,
    'two copies of this drift, and the drift shows as weights that change on Rebind');
  check('the pre-smoothing assignment is kept for the next partial solve',
    (SKIN.match(/mesh\._skinRaw = rawSnapshot\(raw\);/g) || []).length === 2 &&
    /function rawSnapshot/.test(SKIN),
    'smoothing is not invertible, so the smoothed map cannot be amended in place -- '
    + 'and both the bind and the re-solve have to leave one behind, or the NEXT stroke is full');
  check('...including the distance to each winner',
    /dist: raw\.dist \? new Float32Array\(raw\.dist\) : null/.test(SKIN),
    'without it every vertex is a candidate and the shortcut measures the whole mesh');

  const hooked = inject === 'nohook'
    ? SM.replace('Skinning.onCageEdited(this._main, this._main.getMesh?.());', '')
    : SM;
  check('a finished stroke re-solves the skin',
    /Skinning\.onCageEdited\(this\._main, this\._main\.getMesh\?\.\(\)\);/.test(hooked),
    'in SculptManager.end -- on stroke END, since the cost is over the skin, not the cage');
  check('...and so does an undo',
    /Skinning\.onCageEdited/.test(fs.readFileSync(path.join(REPO, 'src/states/StateManager.js'), 'utf8')),
    'undo is the one path that changes a cage with no stroke to end');
  check('...and it is a no-op for anything that is not a cage',
    /if \(!WeightCage\.isCage\(cage\)\) return 0;/.test(SKIN),
    'this runs at the end of every stroke in the app');
}

// ── X-RAY ─────────────────────────────────────────────────────────────────────────────
//
// A capsule lives inside the character, so the shape being edited is behind the shape it is
// edited for. matt: "we should have a way to turn on xray mode for either the capsule meshes
// or the actual skin mesh itself."
{
  const skin = inject === 'noxray'
    ? SKIN.replace('    mesh.setOpacity(a);', '')
    : SKIN;
  check('the skin can be made see-through', /Skinning\.setSkinOpacity = function/.test(skin));

  // THE SHARED MATERIAL IS WHY THE FIRST VERSION LEAKED. Every matcap mesh shares one cached
  // ShaderMaterial, and Scene's per-frame loop writes each mesh's uniforms into it in turn;
  // only uRotCorrection is re-uploaded per draw, so uAlpha ends up being whichever mesh the
  // loop wrote LAST. Setting the skin's opacity turned the capsules see-through with it.
  check('...through a material of its own, not the shared one',
    /const own = mat\.clone\(\);/.test(inject === 'sharedmat' ? skin.replace('const own = mat.clone();', '') : skin)
    && /_skinPrivate/.test(skin),
    'the shared uniforms make one mesh\'s alpha everyone\'s alpha');
  check('...with depth writing off while it is transparent',
    /tm\.material\.depthWrite = clear;/.test(inject === 'xraydepth' ? skin.replace('tm.material.depthWrite = clear;', '') : skin),
    'a see-through skin that still writes depth REJECTS the capsules inside it');
  check('...drawn after the meshes so it blends over the capsules',
    /tm\.renderOrder = clear \? 0 : 2;/.test(skin));
  check('...and both put back at full opacity',
    /const clear = a >= 0\.99;/.test(skin),
    'an opaque mesh should be an ordinary opaque mesh again');
  check('unbind takes the x-ray off with it',
    /mesh\.setOpacity\?\.\(1\);/.test(skin) && /tm\.material\.depthWrite = true;/.test(skin),
    'a half-transparent mesh with depth off, left behind, is a mystery to walk into later');
  check('...reaching every BOUND mesh, which is the set with capsules inside it',
    /if \(!Skinning\.isBound\(mesh\)\) continue;\s*\n\s*mesh\.setOpacity\(a\);/.test(skin));
  check('...applied again after a bind',
    /mesh\._selectLocked = true;\s*\n\s*Skinning\.applySkinOpacity\(main\);/.test(skin),
    'or a mesh bound while x-ray is on comes up opaque and the setting looks broken');
  check('...and persisted, like every other slider',
    /getOptionsURL\.saveOption\('skinOpacity'/.test(skin) &&
    /options\.skinOpacity = queryNumber/.test(
      fs.readFileSync(path.join(REPO, 'src/misc/getOptionsURL.js'), 'utf8')));
  check('...with a slider in the bones panel',
    /id="bone-xray"/.test(PANEL) && /setSkinOpacity\(main, pct \/ 100\)/.test(PANEL));
  check('...that shows the saved value when the panel is rebuilt',
    /xrayInput2\.value = String\(pct\)/.test(PANEL),
    'a slider that always reads 100% while the mesh is see-through is worse than none');
}

console.log(failures ? '\n' + failures + ' FAILURE(S)' : '\nall checks passed');
process.exit(failures ? 1 : 0);
