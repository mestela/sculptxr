import * as THREE from 'three';
import Skeleton from '../editing/Skeleton.js';

// WHAT IS THAT DOT, AND WHICH SWITCH OWNS IT.
//
// The scene carries a lot of small spheres — joint markers, capsule end caps, pin handles, brush
// cursors, tool click points, controller models — created in a dozen files, each gated on its own
// flag. When one is left on screen there is no way to tell from looking which of those it is, and
// guessing costs a session.
//
// So: don't guess. This walks the live scene, lists what is ACTUALLY VISIBLE (visible all the way
// up its parent chain), names each one from the table below, and — the part that matters — says
// WHICH RIG DISPLAY FLAG governs it and what that flag currently reads. An object that is on
// screen while its flag says off is the bug, named and located, rather than a hunt.
//
//   scanPhantoms()                  what is on screen, noise excluded
//   scanPhantoms({ all: true })     including the controller models and the panels
//   scanPhantoms({ hide: true })    hide everything listed; { restore: true } puts them back
//   scanPhantoms({ blink: 3 })      blink the listed objects 3 times, to point at them
//   scanPhantoms({ only: 'sphere' })only signatures containing that text
//
// Extend BLAME when something new shows up as UNKNOWN, rather than working it out again.

// A signature is matched by PREFIX: three reports the full parameter list
// (`SphereGeometry(1,10,8,0,6.2832,0,3.1416)`), and pinning a table entry to every default
// argument means it stops matching the first time one of them changes. The first few numbers are
// what identify a call site; the rest are noise.
const BLAME = [
  // ── matched by NAME first, for objects whose geometry is not distinctive enough. The shadow
  // light's ray is a unit cylinder, which a bone capsule shaft also is. ──
  { nameIn: 'shadow_light_handle', name: 'shadow light handle', src: 'render/SceneShadow.js (_decorateLight)' },
  { nameIs: 'shadow_light_ray',    name: 'shadow light ray',    src: 'render/SceneShadow.js (_ensureGnomon)' },
  { nameIs: 'null_cruciform',      name: 'null locator cross',  src: 'Scene.js:2776 (decorateNull)' },
  // The rig's instanced/merged batches name themselves — see Skeleton.batchFor. The key after the
  // colon is the batch: bone, joint, wire, capShaft, capEnd, each with a G (ghost) and Hi variant.
  { namePrefix: 'rigbatch:cap',    name: 'rig batch: capsules',    src: 'editing/Skeleton.js (batchFor)', flag: 'capsules' },
  { namePrefix: 'rigbatch:joint',  name: 'rig batch: joint markers', src: 'editing/Skeleton.js (batchFor)', flag: 'joints' },
  { namePrefix: 'rigbatch:bone',   name: 'rig batch: bone bodies',  src: 'editing/Skeleton.js (batchFor)', flag: 'solid' },
  { namePrefix: 'rigbatch:wire',   name: 'rig batch: bone wireframe', src: 'editing/Skeleton.js (batchFor)', flag: 'wire' },
  { namePrefix: 'rigbatch:',       name: 'rig batch (other)',      src: 'editing/Skeleton.js (batchFor)' },
  // ── the rig. `flag` is the Skeleton display flag that is supposed to hide it. ──
  { geo: 'CylinderGeometry(1,1,1',  name: 'bone capsule shaft',   src: 'editing/Skeleton.js:317', flag: 'capsules' },
  { geo: 'SphereGeometry(1,56,40',  name: 'bone capsule end cap', src: 'editing/Skeleton.js:322', flag: 'capsules' },
  { geo: 'SphereGeometry(1,10,8',   name: 'joint marker',         src: 'editing/Skeleton.js:133', flag: 'joints' },
  // ── the viewport ──
  { geo: 'SphereGeometry(0.005,8,8', name: 'brush centre dot',    src: 'drawables/Selection.js:218' },
  { geo: 'SphereGeometry(1,24,16',  name: 'voxel brush volume',   src: 'drawables/Selection.js:228' },
  { geo: 'SphereGeometry(1,32,32',  name: 'VR tool cursor centre', src: 'Scene.js:5722' },
  { geo: 'SphereGeometry(1,12,12',  name: 'geodesic pose dot',    src: 'editing/tools/GeodesicPoseTool.js:64' },
  { geo: 'SphereGeometry(0.2,8,8',  name: 'Cut / Inset click point', src: 'editing/tools/CutTool.js:274, Inset.js:481' },
  { geo: 'SphereGeometry(0.04,8,8', name: 'Cut tool vertex dot',  src: 'editing/tools/CutTool.js:420' },
  { geo: 'SphereGeometry(0.12,8,8', name: 'EdgeCreate / SplitEdge dot', src: 'editing/tools/EdgeCreate.js:359' },
  { geo: 'CylinderGeometry(0,0.005', name: 'stylus spike',        src: 'Scene.js (VR stylus)' },
  { geo: 'CylinderGeometry(0,0.004', name: 'stylus spike ghost',  src: 'Scene.js:5669' },
  { geo: 'SphereGeometry(0.03,8,8', name: 'controller fallback blob', src: 'XRControllerModelFactory_local.js:329' },
  { geo: 'SphereGeometry(0.5,16,16', name: 'forced controller proxy', src: 'force_controller_render.js:32' },
  // ── render orders, checked only when the geometry says nothing ──
  { geo: 'SphereGeometry(1,10,8', order: 10002, name: 'joint scale handle', src: 'editing/Skeleton.js:1232' },
  { order: 9999,  name: 'rig part, solid pass', src: 'editing/Skeleton.js:544' },
  { order: 9998,  name: 'rig ghost / selection ring', src: 'editing/Skeleton.js:753' },
  { order: 9996,  name: 'bone capsule',        src: 'editing/Skeleton.js:983', flag: 'capsules' },
  { order: 9995,  name: 'rig GHOST pass',      src: 'editing/Skeleton.js:461 (GHOST_ORDER)' },
  { order: 995,   name: 'skin preview patch',  src: 'editing/SkinPreview.js:82', flag: 'skinClaims' },
  { order: 11000, name: 'HTMLVR panel',         src: 'gui/htmlvr/HTMLVRPanel.js' },
  { order: 999,   name: 'VR tool cursor (group)', src: 'Scene.js:5722 (createVRCursor)' },
  { order: 199,   name: 'shadow catcher plane', src: 'render/SceneShadow.js' },
  { order: 200,   name: 'ground grid',         src: 'Scene.js:2349' },
  { order: 201,   name: 'ground grid ghost',   src: 'Scene.js:2388' },
];

// The controller models are dozens of named parts from the controller GLTF, and they are never
// what anyone means by "what is that dot" — they are the controller, drawn where the controller
// is. Excluded by default so the list is the length of the problem rather than the length of the
// scene; `{ all: true }` brings them back.
const NOISE_NAME = /^(L_|R_|GripMesh|stylus_|pointer_|.*_LED$|.*Button.*|.*[Tt]rigger.*|.*thumb.*)/;

function chain(o) {
  const out = [];
  for (let n = o.parent; n && out.length < 5; n = n.parent) out.push(n.name || n.type);
  return out.join(' < ');
}

function signature(o) {
  const g = o.geometry;
  if (!g) return o.type;
  const p = g.parameters;
  if (!p) return g.type;
  return g.type + '(' + Object.keys(p).map(k => {
    const v = p[k];
    return (typeof v === 'number') ? +v.toFixed(4) : v;
  }).join(',') + ')';
}

// Geometry first, render order only as a fallback: a shaft and an end cap share a render order
// but are different objects, and the geometry is the thing that tells them apart.
function blame(o, sig) {
  const own = o.name || '';
  const up = chain(o);
  for (const b of BLAME) {
    if (b.nameIs && own === b.nameIs) return b;
    if (b.nameIn && (own === b.nameIn || up.includes(b.nameIn))) return b;
    if (b.namePrefix && own.startsWith(b.namePrefix)) return b;
  }
  // BOTH-MATCH FIRST. The joint scale handles reuse the joint marker's geometry and are told
  // apart only by their render order, so an entry that names both has to be considered before
  // either of the looser passes — otherwise the geometry pass claims it and the order entry below
  // is dead code that never fires.
  for (const b of BLAME) {
    if (b.geo && b.order != null && sig.startsWith(b.geo) && o.renderOrder === b.order) return b;
  }
  for (const b of BLAME) if (b.geo && b.order == null && sig.startsWith(b.geo)) return b;
  for (const b of BLAME) if (b.order != null && !b.geo && o.renderOrder === b.order) return b;
  return null;
}

function reallyVisible(o) {
  for (let n = o; n; n = n.parent) if (!n.visible) return false;
  return true;
}

// HOW MANY OF THIS OBJECT ARE ACTUALLY ON SCREEN.
//
// The rig draws its capsules, joints and bones through INSTANCED and MERGED batches, and a batch
// stays in the scene with `visible === true` whether or not it is drawing anything: a hidden slot
// is scaled to ZERO rather than removed (Skeleton.flushBatches), and a merged line batch keeps its
// buffer and shrinks its draw range. So walking the graph for `visible` objects reports every
// batch as live — which is how the first pass "found" capsules and joint markers that their own
// flags had correctly switched off. That was a false positive, and this is the column that kills
// it: an object drawing 0 of 4 instances is not on screen, whatever its flag says.
//
// Returns null for an ordinary object (nothing to count), else { drawn, of }.
//
// The merged LINE batches are the same trap wearing a different hat: `flushLineBatch` collapses a
// hidden joint's edges to a POINT rather than shrinking the draw range, so the batch keeps a full
// buffer and a full draw range while every segment it contains has zero length. Counting the
// range said "1/1 drawn" for a wireframe that was correctly switched off — which is how I came
// within one message of reporting the `wire` flag as broken, for the second time.
function instanceCount(o) {
  if (o.isInstancedMesh) {
    const n = o.count | 0;
    let drawn = 0;
    const a = o.instanceMatrix && o.instanceMatrix.array;
    if (!a) return { drawn: n, of: n };
    for (let i = 0; i < n; i++) {
      // The scale is the length of the basis vectors; a zeroed slot composes to all-zero.
      const b = i * 16;
      const sx = Math.hypot(a[b], a[b + 1], a[b + 2]);
      const sy = Math.hypot(a[b + 4], a[b + 5], a[b + 6]);
      const sz = Math.hypot(a[b + 8], a[b + 9], a[b + 10]);
      if (sx > 1e-9 && sy > 1e-9 && sz > 1e-9) drawn++;
    }
    return { drawn: drawn, of: n };
  }
  // A merged line batch: count the SEGMENTS that have length. Only for the rig's own batches —
  // ordinary sculpt meshes carry a finite drawRange too, and counting those put a meaningless
  // "1/1" on every row.
  if (o.isLineSegments && typeof o.name === 'string' && o.name.startsWith('rigbatch:')) {
    const g = o.geometry;
    const pa = g && g.getAttribute && g.getAttribute('position');
    if (!pa) return { drawn: 0, of: 0 };
    const n = Math.min(pa.count, (g.drawRange && g.drawRange.count !== Infinity)
      ? g.drawRange.count : pa.count);
    const a = pa.array;
    let drawn = 0, of = 0;
    for (let i = 0; i + 1 < n; i += 2) {
      of++;
      const p = i * 3, q = p + 3;
      if (Math.abs(a[p] - a[q]) > 1e-9 || Math.abs(a[p + 1] - a[q + 1]) > 1e-9
        || Math.abs(a[p + 2] - a[q + 2]) > 1e-9) drawn++;
    }
    return { drawn: drawn, of: of };
  }
  return null;
}

// DOES THIS PUT PIXELS ON SCREEN AT ALL.
//
// `object.visible` is only one of the ways this codebase hides things, and it is not even the
// common one. The rig's joint locators are hidden through the MATERIAL — `noDrawMaterial` sets
// `colorWrite: false` and explicitly leaves `visible = true`, with a comment saying so — because
// they still have to be picked and transformed. Forty of those were reported as phantoms on the
// last scan. A material can also be switched off outright, or be transparent at zero opacity.
function drawsPixels(o) {
  const m = o.material;
  if (!m) return true;
  const list = Array.isArray(m) ? m : [m];
  return list.some((x) => x
    && x.visible !== false
    && x.colorWrite !== false
    && !(x.transparent && x.opacity <= 0));
}

const _hidden = [];

function scan(opts) {
  opts = opts || {};
  const main = window.app;
  const scene = window.threeScene || (main && main._scene);
  if (!scene) { console.warn('scanPhantoms: no scene yet'); return []; }

  if (opts.restore) {
    for (const o of _hidden) o.visible = true;
    const n = _hidden.length; _hidden.length = 0;
    const msg = 'scanPhantoms: restored ' + n + ' object(s)';
    console.log(msg);
    main && main.render && main.render();
    return msg;
  }

  let rows = [];
  let noise = 0, empty = 0, nodraw = 0;
  const wp = new THREE.Vector3(), ws = new THREE.Vector3();
  scene.updateMatrixWorld(true);

  scene.traverse((o) => {
    if (!o.isMesh && !o.isPoints && !o.isLine && !o.isSprite) return;
    if (!reallyVisible(o)) return;

    // The sculpt itself is not a phantom. Rig meshes ARE listed — they are exactly what is being
    // hunted, and "I turned the rig off" is the complaint.
    const sm = o.userData && o.userData.sculptMesh;
    if (sm && !sm._isBone && !sm._isNull && !sm._isReference) return;
    if (main && main._sceneShadow && o.material === main._sceneShadow._mat) return;

    if (!opts.all && (NOISE_NAME.test(o.name || '') || NOISE_NAME.test(chain(o)))) { noise++; return; }

    // Hidden by its material rather than by `visible` — see drawsPixels.
    if (!opts.all && !drawsPixels(o)) { nodraw++; return; }

    const inst = instanceCount(o);
    // Nothing drawn is nothing to hunt. `{all:true}` keeps them, because "the batch exists but is
    // empty" is itself worth seeing when the question is why something ISN'T drawn.
    if (!opts.all && inst && inst.drawn === 0) { empty++; return; }

    const sig = signature(o);
    if (opts.only && !sig.toLowerCase().includes(String(opts.only).toLowerCase())) return;

    o.getWorldPosition(wp);
    o.getWorldScale(ws);
    let radius = 0;
    if (o.geometry) {
      if (!o.geometry.boundingSphere) { try { o.geometry.computeBoundingSphere(); } catch (_) {} }
      radius = (o.geometry.boundingSphere ? o.geometry.boundingSphere.radius : 0)
             * Math.max(Math.abs(ws.x), Math.abs(ws.y), Math.abs(ws.z));
    }
    // WHAT THE MESH IS BEATS WHAT IT LOOKS LIKE. A null's pick sphere comes from
    // `Primitives.createSphere`, not from THREE, so its signature is a bare `BufferGeometry` and
    // no geometry rule can ever name it. The link back to the SculptXR mesh can.
    //
    // Reaching this list at all is the finding: both `makePin` and `decorateNull` end by putting
    // a colorWrite-off material on the null, so one that DRAWS is a null that missed that step.
    let b = blame(o, sig);
    if (!b && sm) {
      const what = sm._isPinTarget ? 'pin' : (sm._isBone ? 'bone/joint' : (sm._isNull ? 'null' : null));
      if (what) {
        b = {
          name: what + ' pick sphere — SHOULD BE NON-DRAWING',
          src: 'Scene.js buildNull/decorateNull; Skeleton.makePin, noDrawMaterial',
        };
      }
    }
    // WHAT AN UNKNOWN NEEDS TO SAY. The lookup table cannot know about code it has never seen, so
    // an unmatched object has to carry enough to be greppable: its material colour (the joint
    // scale handles are red/green/blue per axis, the light handle is 0xffd166), and the nearest
    // ancestor anyone bothered to name.
    const col = (o.material && o.material.color) ? '#' + o.material.color.getHexString() : '';
    let namedUp = '';
    for (let n = o.parent; n; n = n.parent) if (n.name) { namedUp = n.name; break; }
    // THE COLUMN THE HUNT ACTUALLY NEEDS. `flag` is the switch that should hide this; `flagSays`
    // is what that switch currently reads. `on` with the object drawn is correct; OFF with the
    // object drawn is the bug, and it is now named rather than suspected.
    let flag = '', flagSays = '';
    if (b && b.flag) {
      flag = b.flag;
      try {
        flagSays = Skeleton.displayFlag(b.flag) ? 'on'
                 : (Skeleton.displayFlagRaw(b.flag) ? 'OFF (via Hide All Decorations)' : 'OFF');
      } catch (_) { flagSays = '?'; }
    }
    rows.push({
      // SELF-CONTAINED FIRST COLUMN. console.table truncates everything after the first few
      // fields, and that is how the columns that identify a row keep getting cut before they
      // reach me. Whatever else is here, this one field has to be enough on its own.
      what: (b ? b.name : 'UNKNOWN')
        + '  <' + o.type + '/' + (o.material ? o.material.type : '-') + '>'
        + '  ' + sig
        + '  order=' + o.renderOrder
        + (col ? '  col=' + col : '')
        + (o.name ? '  name=' + o.name : (namedUp ? '  under=' + namedUp : ''))
        + (inst ? '  inst=' + inst.drawn + '/' + inst.of : ''),
      drawn: inst ? (inst.drawn + '/' + inst.of) : '',
      kind: o.type,
      colour: col,
      namedAncestor: namedUp,
      mat: o.material ? o.material.type : '',
      flag: flag, flagSays: flagSays,
      from: b ? b.src : '(add a signature to PhantomScan.BLAME)',
      name: o.name || '',
      sig: sig,
      order: o.renderOrder,
      pos: [+wp.x.toFixed(2), +wp.y.toFixed(2), +wp.z.toFixed(2)].join(', '),
      radius: +radius.toFixed(4),
      under: chain(o),
      _o: o,
    });
  });

  rows.sort((a, b2) => b2.radius - a.radius);

  // COLLAPSE THE REPEATS. A handle is seven meshes and a rig is dozens of identical parts; listing
  // each one turns the answer into another haystack. Same thing, same render order, same kind →
  // one line with a count, keeping the biggest one's position so there is still somewhere to look.
  const byKind = new Map();
  const grouped = [];
  for (const r of rows) {
    const k = r.what + '|' + r.order + '|' + r.kind + '|' + r.under;
    const g = byKind.get(k);
    if (g) { g.n++; g._all.push(r._o); continue; }
    r.n = 1; r._all = [r._o];
    byKind.set(k, r);
    grouped.push(r);
  }
  rows = grouped;

  const header = 'scanPhantoms: ' + rows.length + ' kind(s) actually drawing'
    + (empty ? ', ' + empty + ' empty batch(es) skipped' : '')
    + (nodraw ? ', ' + nodraw + ' no-draw (colorWrite off / invisible material) skipped' : '')
    + (noise ? ', ' + noise + ' controller/stylus part(s) skipped' : '')
    + ((empty || noise || nodraw) ? ' — {all:true} to see them' : '');
  console.log(header);
  // Printed as lines as well as a table: console.table truncates the columns that matter, which
  // is how a 74-row dump ends up saying nothing.
  const lines = rows.map((r, i) =>
    '  ' + String(i).padStart(2) + '  ' + r.what
    + (r.flag ? '   [flag ' + r.flag + ' = ' + r.flagSays + ']' : '')
    + (r.n > 1 ? '   \u00D7' + r.n : '')
    + '   r=' + r.radius + '  at (' + r.pos + ')   ' + r.from);

  rows.forEach((r, i) => console.log(
    '  ' + String(i).padStart(2) + '  ' + r.what
    + (r.flag ? '   [flag ' + r.flag + ' = ' + r.flagSays + ']' : '')
    + (r.n > 1 ? '   \u00D7' + r.n : '')
    + (r.drawn ? '   inst ' + r.drawn : '')
    + '   r=' + r.radius + '  at (' + r.pos + ')  order=' + r.order
    + '  ' + r.kind + '/' + r.mat + '  ' + r.sig
    + (r.name ? '  name=' + r.name : '') + '   ' + r.from));

  if (opts.hide) {
    for (const r of rows) for (const o of r._all) { o.visible = false; _hidden.push(o); }
    console.log('scanPhantoms: hid ' + rows.length + ' — scanPhantoms({restore:true}) to undo');
    main && main.render && main.render();
  }

  // BLINK, NOT RECOLOUR. The first version tinted `material.color`, which does nothing at all for
  // the objects most worth pointing at: custom ShaderMaterials have no `.color`, and a shared
  // material would have tinted every user of it. Toggling `visible` works for every object there
  // is, and a thing that flashes in and out is easier to spot than a thing that changes hue.
  if (opts.blink) {
    const times = Math.max(1, Math.min(10, opts.blink | 0));
    let n = 0;
    const step = () => {
      const on = (n % 2) === 1;
      for (const r of rows) for (const o of r._all) o.visible = on;
      main && main.render && main.render();
      if (++n < times * 2) setTimeout(step, 220);
      else { for (const r of rows) for (const o of r._all) o.visible = true; main && main.render && main.render(); }
    };
    step();
  }

  // THE RETURN VALUE IS THE REPORT, as text. Returning the array meant the console rendered it as
  // a table, and a pasted table arrives with every column after the third replaced by an ellipsis
  // — twice now the identifying fields never made it back. The objects are still on `scan.last`.
  scan.last = rows;
  return header + '\n' + lines.join('\n');
}

scan.BLAME = BLAME;

export default scan;
