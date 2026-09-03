// RUN MAKE SKIN AGAINST ONE OF MATT'S SAVED RIGS, and measure what comes out.
//
// The loop this breaks: "the skin looks strange" -> I guess -> he tests -> still strange. His
// .sxr files carry the whole skeleton, so the generator can be run here and the result measured
// — bridge loop sizes, block sizes, degenerate faces — without anyone putting a headset on.
//
// Reads the SKEL block written by Skeleton.serialize: the hierarchy (parent, bone flag, radius,
// mirror) plus the v5 rest matrices, which are each joint's LOCAL matrix. That is enough to
// rebuild positions and run the real buildArrays.
//
// Run: node scratchpad/skelprobe.mjs ~/Documents/claude/skel01.sxr
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO = '/Users/mattestela/sculptxr';
const THREE = await import(path.join(REPO, 'node_modules/three/build/three.module.js'));

const file = process.argv[2] || path.join(process.env.HOME, 'Documents/claude/skel01.sxr');
const buf = fs.readFileSync(file);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

const SKEL_MAGIC = 0x534b454c, FGRP = 0x46475250;
function findSkel(buffer) {
  let end = buffer.byteLength;
  for (let guard = 0; guard < 8 && end >= 8; guard++) {
    const foot = new Uint32Array(buffer, end - 8, 2);
    const magic = foot[0], len = foot[1];
    const start = end - 8 - len;
    if (start < 0 || (start & 3)) return null;
    if (magic === SKEL_MAGIC) return { start, len };
    if (magic !== FGRP) return null;
    end = start;
  }
  return null;
}

const blk = findSkel(ab);
if (!blk) { console.log('no SKEL block in ' + file); process.exit(1); }
const u = new Uint32Array(ab, blk.start, blk.len / 4);
const f = new Float32Array(ab, blk.start, blk.len / 4);
let o = 0;
if (u[o++] !== SKEL_MAGIC) { console.log('bad magic'); process.exit(1); }
const ver = u[o++];
const n = u[o++];
const NONE = 0xffffffff;

const rows = [];
for (let i = 0; i < n; i++) {
  const mi = u[o++], pi = u[o++], bone = u[o++], r = f[o++], mir = u[o++];
  const pin = ver >= 3 ? u[o++] : NONE;
  rows.push({ mi, pi, bone, r, mir, pin });
}
// skins
const nSkins = u[o++];
for (let i = 0; i < nSkins; i++) {
  o++; const nj = u[o++], nbV = u[o++];
  o += nj + nbV * 4 * 2 + nbV * 3 + nj * 16;
}
const VOLUME_SHAPES = ['none', 'box', 'half', 'egg'];
const vols = new Map();
const rests = new Map();
if (ver >= 5) {
  const nRest = u[o++];
  for (let i = 0; i < nRest; i++) {
    const mi = u[o++];
    const m = new THREE.Matrix4().fromArray(f.subarray(o, o + 16));
    o += 16;
    rests.set(mi, m);
  }
}

// v7: the volumes themselves. Before v7 they were never written, so an older file has none
// however many the rig had when it was saved.
if (ver >= 7) {
  const vn = u[o++];
  for (let i = 0; i < vn; i++) {
    const mi = u[o++], word = u[o++];
    const dims = [f[o++], f[o++], f[o++]];
    const off = [f[o++], f[o++], f[o++]];
    const rot = [f[o++], f[o++], f[o++], f[o++]];
    vols.set(mi, { shape: VOLUME_SHAPES[word & 15] || 'none',
      dims: (word & 16) ? dims : null, off: (word & 32) ? off : null,
      rot: (word & 64) ? rot : null });
  }
}

console.log(file.split('/').pop() + ': SKEL v' + ver + ', ' + n + ' entries, '
  + rests.size + ' rest matrices, ' + nSkins + ' bound mesh(es), '
  + vols.size + ' volume(s)'
  + (ver < 7 ? '  [pre-v7: volumes were not saved at all]' : ''));

// ── rebuild the joints ────────────────────────────────────────────────────────────────
const byIndex = new Map();
for (const r of rows) if (r.bone & 1) byIndex.set(r.mi, { mi: r.mi, r: r.r, parent: null, kids: [] });
for (const r of rows) {
  const j = byIndex.get(r.mi);
  if (!j) continue;
  if (r.pi !== NONE && byIndex.has(r.pi)) { j.parent = byIndex.get(r.pi); j.parent.kids.push(j); }
  j.vol = (r.bone & 32) ? 'saved-cage' : null;
}
const joints = [...byIndex.values()];
console.log('  joints: ' + joints.length + ', roots: ' + joints.filter((j) => !j.parent).length);

// World position from the rest chain: model = parentModel * localRest.
const world = new Map();
const place = (j) => {
  if (world.has(j)) return world.get(j);
  const local = rests.get(j.mi) || new THREE.Matrix4();
  const m = j.parent ? place(j.parent).clone().multiply(local) : local.clone();
  world.set(j, m);
  return m;
};
for (const j of joints) place(j);

// ── what the generator will see ───────────────────────────────────────────────────────
//
// The two numbers behind the cloverleaf: how big each joint's block is, and how big the bone
// leaving it is. A bridge is chosen in GRID CELLS, so a bone much thinner than the block it
// leaves gets a loop that is a small patch of a large face.
const posOf = (j) => new THREE.Vector3().setFromMatrixPosition(world.get(j));
let worst = null;
for (const j of joints) {
  const kids = j.kids;
  const nbs = kids.concat(j.parent ? [j.parent] : []);
  if (!nbs.length) continue;
  let minLen = Infinity, maxR = 0;
  for (const nb of nbs) {
    minLen = Math.min(minLen, posOf(j).distanceTo(posOf(nb)));
    maxR = Math.max(maxR, nb.r || 0, j.r || 0);
  }
  const h = Math.min(maxR, minLen * 0.45);
  for (const nb of nbs) {
    const rBone = Math.max(nb.r || 0, 1e-6);
    const ratio = rBone / Math.max(h, 1e-6);
    if (!worst || ratio < worst.ratio) worst = { j: j.mi, nb: nb.mi, ratio, h, rBone, nbs: nbs.length };
  }
  if (nbs.length >= 3) {
    console.log('  junction at #' + j.mi + ': ' + nbs.length + ' bones, block h=' + h.toFixed(3)
      + ', radii ' + nbs.map((x) => (x.r || 0).toFixed(2)).join('/'));
  }
}
// ── RUN THE REAL GENERATOR ────────────────────────────────────────────────────────────
//
// Everything above is arithmetic about the rig; this runs the shipped buildArrays over it and
// reports what it actually produced. A bridge that comes out with a 4-vertex loop IS the choke
// point, and now it can be counted rather than described.
{
  let SM = fs.readFileSync(path.join(REPO, 'src/editing/SkinMesh.js'), 'utf8');
  const SKEL_SRC = fs.readFileSync(path.join(REPO, 'src/editing/Skeleton.js'), 'utf8');
  const shapeSrc = SKEL_SRC.slice(SKEL_SRC.indexOf('Skeleton.shapePoint = function'),
    SKEL_SRC.indexOf('Skeleton.mirrorVolumeOffset = function'));

  const prelude = `
const Utils = { TRI_INDEX: 4294967295 };
const Skeleton = {
  joints: () => [],
  jointPos: (j, out) => (out || new THREE.Vector3()).set(j.p[0], j.p[1], j.p[2]),
  hasVolume: () => false,
};
const MeshStatic = class {}; const Multimesh = class {};
const getOptionsURL = () => ({}); getOptionsURL.saveOption = () => {};
const Enums = {}; const mat4 = {};
globalThis.window = globalThis.window || {};
`;
  const body = SM.split('\n').filter((l) => !/^import\s/.test(l))
    .filter((l) => !/^export default/.test(l)).join('\n');
  const gen = path.join(path.dirname(fileURLToPath(import.meta.url)), '_skelprobe_gen.mjs');
  fs.writeFileSync(gen, "import * as THREE from '" + path.join(REPO, 'node_modules/three/build/three.module.js')
    + "';\n" + prelude + shapeSrc + '\n' + body + '\nexport default SkinMesh;\n');
  const SkinMesh = (await import(gen + '?v=' + Date.now())).default;

  const mk = joints.map((j) => {
    const p = posOf(j);
    return { p: [p.x, p.y, p.z], _r: j.r, _mi: j.mi, _src: j };
  });
  const byMi = new Map(mk.map((m) => [m._mi, m]));
  for (const m of mk) m._parentMesh = m._src.parent ? byMi.get(m._src.parent.mi) : null;
  // boneRadius reads _boneRadius off the joints.
  for (const m of mk) m._boneRadius = m._r;

  const topo = SkinMesh._adjacency(mk);
  const arr = SkinMesh._buildArrays(null, mk, topo);
  if (!arr) {
    console.log('  buildArrays returned nothing — every joint failed its claim');
  } else {
    const quads = [];
    for (let i = 3; i < arr.faces.length; i += 4) quads.push(arr.faces[i]);
    const tris = quads.filter((x) => x === 4294967295).length;
    console.log('  built: ' + arr.boxes + ' blocks, ' + arr.bones + ' bones bridged of '
      + topo.bones.length + ', ' + (arr.vertices.length / 3) + ' verts, '
      + (arr.faces.length / 4) + ' faces (' + tris + ' tris)');
    if (arr.bones < topo.bones.length) {
      console.log('  ** ' + (topo.bones.length - arr.bones) + ' bone(s) produced NO bridge — '
        + 'that is a limb with a gap in it, or an invisible elbow');
    }
  }
}

// ── DOES A VOLUME ACTUALLY REACH THE SKIN ─────────────────────────────────────────────
//
// The question matt's second screenshot asked: his pelvis dome sat outside the mesh entirely.
// A volume is put on the busiest junction of HIS rig and the result measured — how close the
// surface gets to the volume, rather than how close it looks.
{
  const SM2 = fs.readFileSync(path.join(REPO, 'src/editing/SkinMesh.js'), 'utf8');
  const SKEL2 = fs.readFileSync(path.join(REPO, 'src/editing/Skeleton.js'), 'utf8');
  const shapeSrc2 = SKEL2.slice(SKEL2.indexOf('Skeleton.shapePoint = function'),
    SKEL2.indexOf('Skeleton.mirrorVolumeOffset = function'));

  // The junction with the most bones — the pelvis or the chest, depending on the rig.
  let hub = null;
  for (const j of joints) {
    const deg = j.kids.length + (j.parent ? 1 : 0);
    if (!hub || deg > hub.deg) hub = { j, deg };
  }
  const half = [3, 2, 3];

  const prelude2 = `
const Utils = { TRI_INDEX: 4294967295 };
const Skeleton = {
  joints: () => [],
  jointPos: (j, out) => (out || new THREE.Vector3()).set(j.p[0], j.p[1], j.p[2]),
  hasVolume: (j) => !!j._volShape,
  jointVolume: (j) => j._volShape,
  volumeFrame: (main, j) => ({ pos: new THREE.Vector3(j.p[0], j.p[1], j.p[2]),
    quat: null, half: j._volHalf }),
};
const MeshStatic = class {}; const Multimesh = class {};
const getOptionsURL = () => ({}); getOptionsURL.saveOption = () => {};
const Enums = {}; const mat4 = {};
globalThis.window = globalThis.window || {};
`;
  const body2 = SM2.split('\n').filter((l) => !/^import\s/.test(l))
    .filter((l) => !/^export default/.test(l)).join('\n');
  const gen2 = path.join(path.dirname(fileURLToPath(import.meta.url)), '_skelprobe_vol.mjs');
  fs.writeFileSync(gen2, "import * as THREE from '" + path.join(REPO, 'node_modules/three/build/three.module.js')
    + "';\n" + prelude2 + shapeSrc2 + '\n' + body2 + '\nexport default SkinMesh;\n');
  const SkinMesh2 = (await import(gen2 + '?v=' + Date.now())).default;

  const mk2 = joints.map((j) => {
    const p = posOf(j);
    return { p: [p.x, p.y, p.z], _boneRadius: j.r, _mi: j.mi, _src: j };
  });
  const byMi2 = new Map(mk2.map((m) => [m._mi, m]));
  for (const m of mk2) m._parentMesh = m._src.parent ? byMi2.get(m._src.parent.mi) : null;
  // THE FILE'S OWN VOLUMES when it has them (v7+), and a synthetic one otherwise so an older
  // rig still exercises the path.
  let usedReal = 0;
  for (const [mi, v] of vols) {
    const m = byMi2.get(mi);
    if (!m || v.shape === 'none') continue;
    m._volShape = v.shape;
    // Unset dims mean "fit to the rig"; the fit lives in Skeleton and needs a real scene, so
    // the probe approximates it with the joint's own radius rather than skipping the volume.
    m._volHalf = v.dims || [m._boneRadius, m._boneRadius, m._boneRadius];
    usedReal++;
  }
  const hubMesh = byMi2.get(hub.j.mi);
  if (!usedReal) { hubMesh._volShape = 'half'; hubMesh._volHalf = half; }
  for (const [mi, v] of vols) {
    const m = byMi2.get(mi);
    const deg = m ? (m._src.kids.length + (m._src.parent ? 1 : 0)) : 0;
    console.log('    volume on joint #' + mi + ': ' + v.shape
      + '  dims=' + (v.dims ? v.dims.map((x) => x.toFixed(2)).join('x') : 'fitted')
      + '  offset=' + (v.off ? v.off.map((x) => x.toFixed(2)).join(',') : 'fitted')
      + '  rot=' + (v.rot ? 'set' : 'none')
      + '  (' + deg + ' bones)'
      + (m ? '  at y=' + posOf(m._src).y.toFixed(2) : ''));
  }
  {
    const rows = joints.map((j) => ({ mi: j.mi, y: posOf(j).y,
      deg: j.kids.length + (j.parent ? 1 : 0), vol: (vols.get(j.mi) || {}).shape || '-' }))
      .sort((a, b) => b.y - a.y);
    console.log('  every joint, tallest first  (# / height / bones / volume):');
    console.log('    ' + rows.map((r) => '#' + r.mi + ' ' + r.y.toFixed(1) + ' ' + r.deg + 'b ' + r.vol).join('   '));
  }
  console.log('  volumes fed to the generator: '
    + (usedReal ? usedReal + ' from the file' : '1 synthetic (file has none)'));

  globalThis.window._skinLoopStats = [];
  const topo2 = SkinMesh2._adjacency(mk2);
  const arr2 = SkinMesh2._buildArrays({}, mk2, topo2);
  if (arr2) {
    // How near does the skin get to the dome's surface? Measured over the vertices closest to
    // the hub, which are the ones its block produced.
    const probeOn = usedReal
      ? mk2.find((m) => m._volShape) : hubMesh;
    const probeHalf = probeOn._volHalf;
    const hp = new THREE.Vector3(probeOn.p[0], probeOn.p[1], probeOn.p[2]);
    let onShape = 0, near = 0;
    const q = new THREE.Vector3();
    for (let i = 0; i < arr2.vertices.length; i += 3) {
      q.set(arr2.vertices[i], arr2.vertices[i + 1], arr2.vertices[i + 2]).sub(hp);
      if (q.length() > 6) continue;                       // not this joint's neighbourhood
      near++;
      const u = new THREE.Vector3(q.x / probeHalf[0], q.y / probeHalf[1], q.z / probeHalf[2]);
      if (Math.abs(u.length() - 1) < 0.12 || (Math.abs(q.y) < 0.35 && u.length() <= 1.05)) onShape++;
    }
    {
      const loops = globalThis.window._skinLoopStats || [];
      const counts = new Map();
      for (const l of loops) counts.set(l.want, (counts.get(l.want) || 0) + 1);
      console.log('  bridge loop counts: '
        + [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => k + ' x' + v).join(', '));
      const byGap = loops.slice().sort((a, b) => Math.min(a.near, a.far) - Math.min(b.near, b.far));
      console.log('  narrowest joins (ring radius at each end):');
      for (const l of byGap.slice(0, 4)) {
        console.log('    near ' + l.near.toFixed(2) + '  far ' + l.far.toFixed(2)
          + '   ratio ' + (Math.min(l.near, l.far) / Math.max(l.near, l.far)).toFixed(2));
      }
    }
    console.log('  volume probe: ' + probeOn._volShape + ' '
      + probeHalf.map((x) => x.toFixed(2)).join('x') + ' on joint #' + probeOn._mi
      + ' — ' + onShape + ' of ' + near + ' nearby verts land on its surface');
    console.log('  ' + (onShape > near * 0.3
      ? 'the volume is reaching the skin.'
      : '** the volume is NOT reaching the skin — this is the pelvis case.'));
  }
}

if (worst) {
  console.log('  tightest bone/block ratio: ' + worst.ratio.toFixed(2)
    + ' (joint #' + worst.j + ' -> #' + worst.nb + ', block ' + worst.h.toFixed(3)
    + ' vs bone radius ' + worst.rBone.toFixed(3) + ')');
  console.log('  a ratio well under 1 is the cloverleaf: the bone claims a small patch of a '
    + 'much larger block, and the claim is quantised to ' + 4 + ' cells per face.');
}
