// ATTACHMENT PREVIEW — draw where Make Skin will bridge, before it is pressed.
//
// THE JOINT DRAWN AS THE SUBDIVIDED CUBE IT ACTUALLY IS, with the patch each bone will bridge
// through filled in, and BOTH ENDS OF A BONE IN THE SAME COLOUR so you can see what joins to
// what. matt: "maybe if the joint capsules were drawn as subdivided cubes, and matching faces are
// drawn in the same colour to imply what will be connected?"
//
// The first version of this drew each claim as a floating outline and was rejected on sight, for
// a good reason: an unexplained rectangle hanging in space near a joint is a mark, not an
// explanation. matt: "doesn't really help. its too much visual noise." A rectangle only means
// something against the grid it is a part of — showing the cube says why the patch is that size,
// why there are only so many of them, and which face ran out of room.
//
// The whole point is that this is not a picture OF the generator, it is the generator's own
// answer: SkinMesh.attachments runs the same boxAt / claimSides / settleEnds the build runs, so
// a patch drawn here is the patch the skin will be made through. Anything less would be a second
// opinion, which on this rig has a history — the joint volumes were four consumers each
// re-deriving one shape, and they agreed right up until the cases that mattered.
//
// WHAT IT IS FOR. A hand is five bones leaving one face of a four-cell box. That is the case the
// side assignment was written for and the one it runs out of room on, and when it does a finger
// is moved to a different FACE and bridges out of the palm sideways. Until now the only way to
// find that out was to generate a skin and look at the wreck.
//
// ITS OWN MODULE, and driven from Scene rather than from Skeleton's own visuals: this needs
// SkinMesh, SkinMesh needs Skeleton, and calling it from Skeleton would close that cycle and
// leave the whole rig undefined at load. MotionTrail lives out here for the same reason.
import * as THREE from 'three';
import Skeleton from './Skeleton.js';
import SkinMesh from './SkinMesh.js';

const SkinPreview = {};

// COLOUR IS IDENTITY, NOT SEVERITY. The first version coloured by how bad each patch was, which
// answered a question nobody was asking: you can see that a strip is thin. What you cannot see is
// WHICH strip on the palm becomes WHICH finger, and that is the thing a colour can say and
// geometry cannot. Golden-angle hues so consecutive bones — which are exactly the ones that end
// up side by side on one face — never land on neighbouring colours.
function pairColor(i, out) {
  return out.setHSL((i * 0.61803398875) % 1, 0.62, 0.56);
}

// The two failures still have to be visible, and they are shown as the PATCH ITSELF being wrong
// rather than as a colour code: an evicted patch is outlined, and a pinched one is simply small
// against a grid you can count. Outline only, so it reads on top of whatever hue the pair has.
const COL_GRID = new THREE.Color(0x5b6572);
// A cell no bone claims. Plain, so the coloured patches are the only thing that reads as
// meaning something — most of a joint's surface is ordinary skin and should look like it.
const COL_BARE = new THREE.Color(0x8891a0);
const COL_EVICT = new THREE.Color(0xe2453d);

function ensure(main) {
  if (main._skinPreview && main._skinPreview.group && main._skinPreview.group.parent) {
    return main._skinPreview;
  }
  const group = new THREE.Group();
  group.name = 'skin_attachment_preview';
  group.frustumCulled = false;

  // DEPTH-TESTED, FRONT FACES ONLY, now that this is a solid shape rather than a few flat
  // patches. The first version drew loose rectangles and turned the depth test off so they could
  // not fight the capsule they sat on; a closed rounded cube drawn that way shows its own back
  // faces through its front and reads as a tangle. Front-facing, depth-tested, and not
  // depth-WRITING keeps it a translucent solid that still lets the rig behind it through.
  //
  // Polygon offset pushes the surface a hair back so the grid drawn on it does not z-fight: the
  // lines lie exactly on those faces by construction.
  //
  // Opacity is set per frame from the capsule slider — see update(). The value here only has to
  // be something legal until the first one arrives.
  const fillMat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.5, side: THREE.FrontSide,
    depthTest: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
  });
  const lineMat = new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.5, depthTest: true, depthWrite: false,
  });
  const fill = new THREE.Mesh(new THREE.BufferGeometry(), fillMat);
  const line = new THREE.LineSegments(new THREE.BufferGeometry(), lineMat);
  fill.frustumCulled = line.frustumCulled = false;
  fill.renderOrder = 995;
  line.renderOrder = 996;   // the grid reads ON the patches, not under them
  group.add(fill); group.add(line);
  Skeleton.overlayGroup(main).add(group);
  main._skinPreview = { group: group, fill: fill, line: line };
  return main._skinPreview;
}

SkinPreview.setVisible = function (main, on) {
  const v = main && main._skinPreview;
  if (v && v.group) v.group.visible = !!on;
};

// WHAT THE DRAWING DEPENDS ON, cheaply enough to ask every frame.
//
// Nothing here is rebuilt unless the rig has actually moved, and on a still rig — which is most
// frames, including every frame you are looking at it rather than dragging it — this function is
// the only thing that runs. It reads two numbers per joint and a couple of ids, which is nothing
// beside re-deriving every claim and re-uploading every vertex, which is what used to happen
// sixty times a second whether or not anything had changed. matt: "i can feel it getting very
// gluggy."
//
// A HASH RATHER THAN A LIST, because the comparison has to be as cheap as the read: the point is
// to leave early, and building an array to compare against would spend most of what leaving
// saves. Collisions cost one stale frame until the next real change, which for a preview is not
// a price worth insuring against.
function poseHash(main) {
  const joints = Skeleton.joints(main);
  let h = joints.length * 2654435761;
  const c = new THREE.Vector3();
  const half = [0, 0, 0];
  for (const j of joints) {
    Skeleton.jointCentre(j, c);
    Skeleton.jointHalf(j, Skeleton.boneRadiusOf(main, j), half);
    // The parent matters as well as the pose: reparenting changes which bones leave a joint, and
    // so which cells are claimed, without moving anything.
    h = (h * 31 + (j._parentMesh ? j._parentMesh.getID() : 0)) | 0;
    h = (h * 31 + Math.round(c.x * 8192)) | 0;
    h = (h * 31 + Math.round(c.y * 8192)) | 0;
    h = (h * 31 + Math.round(c.z * 8192)) | 0;
    // SHARPNESS IS PART OF THE SHAPE, so it belongs in the hash. Without it the preview only
    // caught up when something else moved — or when the flag was toggled off and on, which clears
    // the hash. matt: "the attach cubes only change shape if i hide and show them."
    h = (h * 31 + Math.round(Skeleton.jointRound(j) * 256)) | 0;
    h = (h * 31 + Math.round(half[0] * 8192)) | 0;
    h = (h * 31 + Math.round(half[1] * 8192)) | 0;
    h = (h * 31 + Math.round(half[2] * 8192)) | 0;
  }
  return h;
}

SkinPreview.update = function (main) {
  if (!main) return;
  if (!Skeleton.displayFlag('skinClaims')) {
    SkinPreview.setVisible(main, false);
    main._skinPreviewHash = null;   // so switching it back on rebuilds
    return;
  }

  // Opacity is live — the slider must not wait for the rig to move — so it is set before the
  // early-out rather than after it.
  const vv = main._skinPreview;
  if (vv) {
    const o = Skeleton.capsuleOpacity();
    vv.fill.material.opacity = o;
    vv.line.material.opacity = o;
  }

  const hash = poseHash(main);
  if (vv && main._skinPreviewHash === hash) return;
  main._skinPreviewHash = hash;

  let att = null;
  try {
    att = SkinMesh.attachments(main);
  } catch (e) {
    // A preview must never be the thing that stops the frame. The generator refuses some rigs
    // outright and says so by returning nothing; anything it throws is worth knowing about but
    // is not worth taking the render down for.
    console.log('[skin preview] attachments failed', e);
  }

  const v = ensure(main);
  v.group.visible = !!att;
  if (!att) return;

  const op = Skeleton.capsuleOpacity();
  v.fill.material.opacity = op;
  v.line.material.opacity = op;

  const pos = [], col = [], lpos = [], lcol = [];
  const _a = new THREE.Vector3(), _b = new THREE.Vector3();
  const _q0 = new THREE.Vector3(), _q1 = new THREE.Vector3(), _q2 = new THREE.Vector3();
  const hue = new THREE.Color();

  const seg = (p0, p1, c) => {
    lpos.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
    lcol.push(c.r, c.g, c.b, c.r, c.g, c.b);
  };

  // WHICH BONE OWNS EACH CELL, keyed by side and cell, so the whole joint can be drawn in one
  // pass with each cell asking what it belongs to. Built per joint rather than per bone because
  // the joint is now the thing being drawn: every cell of it gets a colour, claimed or not.
  const owners = new Map();   // box -> Map('side,a,b' -> end)
  for (const e of att.ends) {
    let m = owners.get(e.box);
    if (!m) { m = new Map(); owners.set(e.box, m); }
    const r = e.rect;
    for (let a = r.a0; a < r.a1; a++)
      for (let b = r.b0; b < r.b1; b++) m.set(e.side + ',' + a + ',' + b, e);
  }

  // THE WHOLE JOINT, all six sides, as a rounded-off subdivided cube at the joint's own size —
  // no separate box floating near the rig to read against the capsule it is supposed to be
  // about. matt: "frankly i still find this view confusing."
  //
  // Every cell is drawn. A cell a bone will bridge through takes that bone's colour, the same at
  // both ends of the bone; the rest take a plain joint grey. So the question the view answers is
  // no longer "where is the box" but "which parts of this joint become which limb", which is the
  // one worth asking.
  // EACH JOINT AT ITS OWN LEVEL. A finger is divided twice a side and a palm eight times, so the
  // grid you count to see how much of a face a bone gets is the grid that joint actually has.
  for (const box of att.boxes) {
    const own = owners.get(box);
    const B = box.box;
    for (let si = 0; si < B.sides.length; si++) {
      // A SIDE'S OWN TWO COUNTS. Since the lattice is sized per axis a side is no longer square,
      // and drawing it as one silently dropped half of a palm's cells. See makeBox.
      const grid = B.sides[si].grid, NU = B.sides[si].nu, NV = B.sides[si].nv;
      for (let a = 0; a < NU; a++) {
        for (let b = 0; b < NV; b++) {
          const e = own && own.get(si + ',' + a + ',' + b);
          if (e) pairColor(e.pair, hue); else hue.copy(COL_BARE);
          att.round(box, grid[a][b], _q0);
          att.round(box, grid[a + 1][b], _q1);
          att.round(box, grid[a + 1][b + 1], _q2);
          att.round(box, grid[a][b + 1], _a);
          pos.push(_q0.x, _q0.y, _q0.z, _q1.x, _q1.y, _q1.z, _q2.x, _q2.y, _q2.z);
          pos.push(_q0.x, _q0.y, _q0.z, _q2.x, _q2.y, _q2.z, _a.x, _a.y, _a.z);
          for (let k = 0; k < 6; k++) col.push(hue.r, hue.g, hue.b);
        }
      }
      // The grid, so it reads as subdivided rather than as a smooth blob — and so a claimed
      // patch can be counted in cells, which is the only way to see that four fingers are
      // sharing one face four ways.
      // The two families of grid lines have to be walked separately now that the side need not be
      // square: one runs the length of v at each u, the other the length of u at each v.
      for (let a = 0; a <= NU; a++)
        for (let b = 0; b < NV; b++) {
          att.round(box, grid[a][b], _a); att.round(box, grid[a][b + 1], _b);
          seg(_a, _b, COL_GRID);
        }
      for (let b = 0; b <= NV; b++)
        for (let a = 0; a < NU; a++) {
          att.round(box, grid[a][b], _a); att.round(box, grid[a + 1][b], _b);
          seg(_a, _b, COL_GRID);
        }
    }
  }

  // EVICTED PATCHES ARE OUTLINED, keeping their pair colour underneath: the colour says which
  // finger, the outline says it is not on the face its bone points at.
  for (const e of att.ends) {
    if (!e.evicted) continue;
    const grid = e.box.box.sides[e.side].grid, r = e.rect;
    const ring = [[r.a0, r.b0], [r.a1, r.b0], [r.a1, r.b1], [r.a0, r.b1]];
    for (let i = 0; i < 4; i++) {
      att.round(e.box, grid[ring[i][0]][ring[i][1]], _a);
      att.round(e.box, grid[ring[(i + 1) % 4][0]][ring[(i + 1) % 4][1]], _b);
      seg(_a, _b, COL_EVICT);
    }
  }

  // WRITE INTO THE BUFFER WE ALREADY HAVE when it is the right size, which it is on every frame
  // of a drag — the rig moves, so the numbers change, but the number OF them does not. A new
  // BufferAttribute each time throws away the GPU buffer and makes three allocate and upload a
  // fresh one; copying into the existing array re-uploads the same allocation. Only a change in
  // topology — a joint added, a claim moving to another face — needs a new attribute.
  const put = (geo, name, src, itemSize) => {
    const a = geo.getAttribute(name);
    if (a && a.array.length === src.length) {
      a.array.set(src);
      a.needsUpdate = true;
    } else {
      geo.setAttribute(name, new THREE.Float32BufferAttribute(src, itemSize));
    }
  };
  const fg = v.fill.geometry, lg = v.line.geometry;
  put(fg, 'position', pos, 3);
  put(fg, 'color', col, 3);
  fg.computeBoundingSphere();
  put(lg, 'position', lpos, 3);
  put(lg, 'color', lcol, 3);
  lg.computeBoundingSphere();
};

// What the preview would say, as numbers, for the console — matt reads instruments over remote
// debugging rather than off a panel, and "which of my fingers got evicted" is a question with a
// one-line answer.
SkinPreview.report = function (main) {
  const att = SkinMesh.attachments(main);
  if (!att) { console.log('[skin preview] nothing to report — no bones'); return []; }
  const name = (m) => (m && (m._permanentStaticLabel || ('#' + m.getID()))) || '?';
  const rows = att.ends.map((e) => ({
    at: name(e.joint), to: name(e.other),
    // The block and the face it came out of, which is the thing you actually want to see: a whole
    // 4x4 face meeting a 2x2 block of an 8x8 one is the reduction band working, not a pinch.
    block: (e.rect.a1 - e.rect.a0) + 'x' + (e.rect.b1 - e.rect.b0) + ' of '
      + e.box.box.sides[e.side].nu + 'x' + e.box.box.sides[e.side].nv,
    perimeter: e.perimeter,
    state: e.evicted ? 'EVICTED' : (e.full ? 'ok' : 'pinched'),
  }));
  const bad = rows.filter((r) => r.state !== 'ok');
  console.log('[skin preview] ' + rows.length + ' bone ends, ' + bad.length + ' not clean');
  if (rows.length) console.table(rows);
  return rows;
};

// ON THE CONSOLE, because that is where rig diagnostics are read — over remote debugging from a
// headset, where a panel cannot be copied out of. `skinReport()` prints every bone end with the
// block it claims and whether anything had to shrink.
if (typeof window !== 'undefined') {
  window.skinReport = () => SkinPreview.report(window.sculptgl_instance);
}

export default SkinPreview;
