import * as THREE from 'three';
import Utils from '../misc/Utils.js';
import MeshStatic from '../mesh/meshStatic/MeshStatic.js';
import Multimesh from '../mesh/multiresolution/Multimesh.js';
import Enums from '../misc/Enums.js';
import getOptionsURL from '../misc/getOptionsURL.js';
import Skeleton from './Skeleton.js';

// [Rigging POC#2] Bones -> low-poly skin. Clay over a wire armature.
//
// Draw a skeleton, press one button, and get a quad tube running along every chain at the
// capsule radii you already tuned — a blockout you then sculpt, the ZSphere / skin-modifier
// move. The rig is the fastest way to state a figure's proportions in VR, and this is what
// turns that statement into geometry instead of leaving it as scaffolding.
//
// TUBES ALONG CHAINS, NOT CAPSULES PER BONE. A capsule per bone would be trivial but leaves
// interpenetrating shells at every joint — a lot of interior geometry to fight the moment you
// start sculpting. A chain shares one ring at each interior joint, so an arm is a single
// continuous tube from shoulder to wrist and the elbow is just a bend in it.
//
// Branch points ARE left interpenetrating: the tubes for two clavicles leaving a spine each
// cap themselves off inside the other. Resolving junctions properly is the hard part of every
// skin modifier ever written, and it is the wrong thing to spend effort on for a shape that
// exists to be voxel-remeshed or sculpted over immediately. This is a blockout, not a model.

const SkinMesh = {};

// Radial segments. Low on purpose: this is a blockout, and a 6-sided tube reads as form while
// staying light enough to grab and push around.
const DEFAULT_SIDES = 6;
function sides() {
  const v = window._boneSkinSides;
  return Number.isFinite(v) && v >= 3 ? Math.round(v) : DEFAULT_SIDES;
}

// Dome cap proportions: one extra ring, then a pole. A single pole fan would spike the end of
// every finger and every head into a cone.
const CAP_RING_OFFSET = 0.55; // x radius, along the chain direction
const CAP_RING_SCALE = 0.83;  // x radius

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();

function childMap(main, joints) {
  const kids = new Map();
  for (const j of joints) kids.set(j, []);
  for (const j of joints) {
    const p = j._parentMesh;
    if (kids.has(p)) kids.get(p).push(j);
  }
  return kids;
}

// Split the skeleton into maximal chains, so each becomes one continuous tube.
//
// A chain HEAD is a joint that cannot be an interior ring: a root (nothing above it) or a
// branch (more than one bone below it). Every head starts one chain per child, and each chain
// runs down through pass-through joints until it reaches the next head or a leaf.
function chains(main, joints) {
  const kids = childMap(main, joints);
  const out = [];

  for (const head of joints) {
    const isRoot = !kids.has(head._parentMesh);
    if (!isRoot && kids.get(head).length <= 1) continue; // pass-through or leaf
    for (const kid of kids.get(head)) {
      const chain = [head, kid];
      let tip = kid;
      while (kids.get(tip).length === 1) {
        tip = kids.get(tip)[0];
        chain.push(tip);
      }
      out.push(chain);
    }
  }
  return out;
}

// Radius of the bone ENDING at `joint` (that is where the radius is stored).
function boneRadius(joint) { return joint._boneRadius || 0; }

// Per-ring radius along a chain. Interior rings average the two bones meeting there, so a
// tapering limb tapers smoothly instead of stepping at every joint.
function ringRadii(chain) {
  const n = chain.length - 1;
  const r = new Array(chain.length);
  r[0] = boneRadius(chain[1]);
  for (let i = 1; i < n; i++) r[i] = (boneRadius(chain[i]) + boneRadius(chain[i + 1])) * 0.5;
  r[n] = boneRadius(chain[n]);
  return r;
}

// Ring frames along the chain, PARALLEL TRANSPORTED. Rebuilding the basis from a fixed world
// up-vector at every ring makes the tube spin as the chain changes direction (and degenerate
// where a bone is vertical); carrying the previous ring's basis forward through the minimal
// rotation between normals keeps the quad rows straight down the limb.
function ringFrames(pts, normals) {
  const frames = [];
  let u = null;
  for (let i = 0; i < pts.length; i++) {
    const n = normals[i];
    if (!u) {
      // Any perpendicular will do for the first ring; pick the world axis least aligned with
      // the bone so the cross product is well conditioned.
      const ax = Math.abs(n.x) < 0.9 ? _v1.set(1, 0, 0) : _v1.set(0, 1, 0);
      u = new THREE.Vector3().crossVectors(ax, n).normalize();
    } else {
      // Remove the component along the new normal and renormalise: the minimal rotation,
      // without building a quaternion per ring.
      u = u.clone().addScaledVector(n, -u.dot(n));
      if (u.lengthSq() < 1e-12) {
        const ax = Math.abs(n.x) < 0.9 ? _v1.set(1, 0, 0) : _v1.set(0, 1, 0);
        u = new THREE.Vector3().crossVectors(ax, n);
      }
      u.normalize();
    }
    frames.push({ u: u.clone(), v: new THREE.Vector3().crossVectors(n, u).normalize(), n: n });
  }
  return frames;
}

// One chain -> a list of rings (centre, basis, radius) ready to stitch, plus the two poles.
function chainRings(main, chain) {
  const pts = chain.map((j) => Skeleton.jointPos(j));
  const radii = ringRadii(chain);
  const n = pts.length - 1;

  // Direction of each bone, and the ring normal at each joint: the bisector at interior
  // joints, so the ring sits square to the bend rather than square to one of the two bones.
  const dirs = [];
  for (let i = 0; i < n; i++) {
    const d = new THREE.Vector3().subVectors(pts[i + 1], pts[i]);
    const len = d.length();
    if (len < 1e-9) return null; // coincident joints: nothing sensible to build
    dirs.push(d.divideScalar(len));
  }
  const normals = [];
  for (let i = 0; i <= n; i++) {
    if (i === 0) normals.push(dirs[0].clone());
    else if (i === n) normals.push(dirs[n - 1].clone());
    else normals.push(new THREE.Vector3().addVectors(dirs[i - 1], dirs[i]).normalize());
  }

  const frames = ringFrames(pts, normals);
  const rings = [];
  for (let i = 0; i <= n; i++) {
    // Miter: a ring cut square to the bisector is an ellipse narrower than the tube, so widen
    // it by 1/cos(half angle). Clamped, because a hairpin bend would otherwise blow up.
    const bend = i === 0 || i === n ? 1 : Math.max(dirs[i - 1].dot(normals[i]), 0.35);
    rings.push({ c: pts[i], f: frames[i], r: radii[i] / bend });
  }

  // Dome caps at both ends, reusing the adjacent ring's basis so the stitching stays aligned.
  const first = rings[0], last = rings[rings.length - 1];
  const startCap = {
    c: first.c.clone().addScaledVector(first.f.n, -radii[0] * CAP_RING_OFFSET),
    f: first.f, r: radii[0] * CAP_RING_SCALE,
  };
  const endCap = {
    c: last.c.clone().addScaledVector(last.f.n, radii[n] * CAP_RING_OFFSET),
    f: last.f, r: radii[n] * CAP_RING_SCALE,
  };
  return {
    rings: [startCap].concat(rings, [endCap]),
    poleStart: first.c.clone().addScaledVector(first.f.n, -radii[0]),
    poleEnd: last.c.clone().addScaledVector(last.f.n, radii[n]),
  };
}

// Build the vertex and face arrays for every chain, concatenated into one mesh.
//
// Winding: for a quad [(k,j), (k,j+1), (k+1,j+1), (k+1,j)] with rings ordered along the chain
// direction and the ring basis right-handed about it, the face normal comes out radially
// outward, matching the convention the primitives use.
function buildArrays(main, chainList) {
  const R = sides();
  const cos = new Float32Array(R), sin = new Float32Array(R);
  for (let j = 0; j < R; j++) {
    const a = (Math.PI * 2 * j) / R;
    cos[j] = Math.cos(a); sin[j] = Math.sin(a);
  }

  const verts = [];
  const faces = [];
  const pushFace = (a, b, c, d) => {
    faces.push(a, b, c, d === undefined ? Utils.TRI_INDEX : d);
  };

  for (const chain of chainList) {
    const built = chainRings(main, chain);
    if (!built) continue;
    const rings = built.rings;

    const base = verts.length / 3;
    for (const ring of rings) {
      for (let j = 0; j < R; j++) {
        _v2.copy(ring.c)
          .addScaledVector(ring.f.u, ring.r * cos[j])
          .addScaledVector(ring.f.v, ring.r * sin[j]);
        verts.push(_v2.x, _v2.y, _v2.z);
      }
    }
    const poleA = verts.length / 3;
    verts.push(built.poleStart.x, built.poleStart.y, built.poleStart.z);
    const poleB = verts.length / 3;
    verts.push(built.poleEnd.x, built.poleEnd.y, built.poleEnd.z);

    for (let k = 0; k < rings.length - 1; k++) {
      for (let j = 0; j < R; j++) {
        const j2 = (j + 1) % R;
        pushFace(base + k * R + j, base + k * R + j2,
                 base + (k + 1) * R + j2, base + (k + 1) * R + j);
      }
    }
    const lastRow = base + (rings.length - 1) * R;
    for (let j = 0; j < R; j++) {
      const j2 = (j + 1) % R;
      pushFace(poleA, base + j2, base + j);          // start cap faces backwards
      pushFace(poleB, lastRow + j, lastRow + j2);    // end cap faces forwards
    }
  }

  if (!faces.length) return null;
  return { vertices: new Float32Array(verts), faces: new Uint32Array(faces) };
}

// Build a skin for the whole skeleton and add it to the scene as a new mesh.
//
// The vertices are written in MODEL space and the mesh keeps an identity matrix, so the skin
// lands exactly on the skeleton it came from. No normalizeSize() — the whole point is that the
// proportions are the ones already drawn.
SkinMesh.build = function (main) {
  const joints = Skeleton.joints(main);
  if (!joints.length) return { ok: false, why: 'draw a bone chain first' };

  const chainList = chains(main, joints);
  if (!chainList.length) return { ok: false, why: 'skeleton has no bones (a chain needs 2+ joints)' };

  const t0 = performance.now();
  const arr = buildArrays(main, chainList);
  if (!arr) return { ok: false, why: 'could not build a skin from this skeleton' };

  const base = new MeshStatic(main._gl);
  base.setVertices(arr.vertices);
  base.setFaces(arr.faces);
  base.init();
  if (main._gl) base.initRender();

  const mesh = new Multimesh(base);
  mesh.setShaderType(Enums.Shader.MATCAP);
  mesh.setMatcap(getOptionsURL().matcap);
  mesh._typeName = 'Skin';
  mesh.isQuad = true;
  mesh._permanentStaticLabel = 'skin';
  main.addNewMesh(mesh); // pushes its own add-state, so this is one undo step

  return { ok: true, chains: chainList.length, verts: mesh.getNbVertices(),
           faces: mesh.getNbFaces(), ms: Math.round(performance.now() - t0) };
};

// Exposed for the round-trip test in scratch and for console poking: the geometry half of
// this module has no dependency on the mesh classes, so it can be exercised on its own.
SkinMesh._chains = chains;
SkinMesh._buildArrays = buildArrays;

export default SkinMesh;
