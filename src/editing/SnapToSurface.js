// SNAP TO SURFACE, for any two meshes (Topology panel). The Face tool's Topo Transfer had it for
// the GNM head only (matt: "really useful, can we make that available everywhere?"). Same flow:
// Use Selected as Target marks the surface, then Snap pulls every vertex of the other selected
// mesh(es) onto it. The solve is TopoWrap.snapSurface, as there, without the GNM-only parts (its
// face regions and the lip re-solve).
//
// ON A MESH WITH BLENDSHAPES IT GOES WHERE A BRUSH STROKE WOULD (matt: "i added a blendshape layer
// and ran snap expecting the snap to be stored in the layer"). With a layer being edited, the
// snapped shape is written to the vertices and Mesh.updateGeometry's layer capture stores it as that
// layer's delta, the same path and the same undo as a stroke -- so it has to pass the same gate
// (SculptManager._canSculptActiveBlendshapeLayer: visible, unlocked, at weight 1). With no layer
// active it goes into the Base, as Topo Transfer's snap does, unless the Base is locked. Everything
// else is an ordinary geometry undo step.
import { mat4, vec3 } from 'gl-matrix';
import { buildGrid, snapSurface, neighbours } from './TopoWrap.js';
import { triangles } from './ShapeRetarget.js';

export const snapTarget = { id: null };

const say = (msg, colour) => { console.log('[Snap] ' + msg); window.screenLog?.(msg, colour); };
export const snapLabel = (m) => (m ? m._permanentStaticLabel || 'Object ' + m.getID() : 'none');

export function snapTargetMesh(main) {
  return snapTarget.id == null ? null : main.getMeshes().find((m) => m.getID() === snapTarget.id) || null;
}

export function setSnapTarget(main) {
  const m = main.getMesh();
  if (!m) return say('Select the mesh to snap onto first', 'yellow');
  snapTarget.id = m.getID();
  say(`Snap target: ${snapLabel(m)}. Now select the mesh to snap and press Snap`);
}

// The selected meshes that can be snapped: real geometry, not the target.
function sources(main, t) {
  const sel = main.getSelectedMeshes?.() || [];
  const list = sel.length ? sel : [main.getMesh()].filter(Boolean);
  return list.filter((m) => m !== t && !m._isBone && !m._isNull && !m._isReference && m.getNbFaces?.() > 0);
}

export const canSnap = (main) => { const t = snapTargetMesh(main); return !!t && sources(main, t).length > 0; };

// From `a`'s local space to `b`'s.
function between(a, b) {
  const m = mat4.create();
  mat4.invert(m, b.getMatrix());
  return mat4.multiply(m, m, a.getMatrix());
}

function radiusOf(m) {
  const v = m.getVertices(), n = m.getNbVertices();
  let r = 0;
  for (let i = 0; i < n * 3; i += 3) r = Math.max(r, Math.abs(v[i]), Math.abs(v[i + 1]), Math.abs(v[i + 2]));
  return r || 1;
}

let _grid = null;
export function snapSelectedToTarget(main) {
  const t = snapTargetMesh(main);
  if (!t) return say('Use Selected as Target first', 'yellow');
  const src = sources(main, t);
  if (!src.length) return say('Select the mesh to snap (not the target)', 'yellow');
  const t0 = performance.now();
  const gkey = t.getID() + '|' + t.getNbVertices() + '|' + t.getNbFaces();
  if (!_grid || _grid.key !== gkey) {
    const tris = triangles(t.getFaces(), t.getNbFaces());
    _grid = { key: gkey, g: buildGrid(tris, Float32Array.from(t.getVertices().subarray(0, t.getNbVertices() * 3))) };
  }
  const maxDist = radiusOf(t) * 0.3;
  const reg = window._animationRegistry, sm = main.getStateManager?.();
  const v = vec3.create();
  const done = [];
  for (const s of src) {
    const track = reg?.tracks.get(s.getID());
    let base = track?.baseShape;
    const layer = base && track.editingBlendshape;
    if (layer) {
      const w = reg.blendshapePreviewAt ? reg.blendshapePreviewAt(track, layer, track.blendshapeTracks?.get(layer)) : 0;
      const why = reg.isBlendshapeCombo?.(track, layer) ? 'is a combo (sculpt combos with a brush)'
        : track.blendshapeLocked?.has?.(layer) ? 'is locked'
        : track.blendshapeMuted?.has?.(layer) ? 'is hidden'
        : Math.abs(w - 1) >= 1e-3 ? 'is not at weight 1' : null;
      if (why) { window._blendshapeStackPanel?.flash?.(); say(`${snapLabel(s)} not snapped: layer ${layer} ${why}`, 'yellow'); continue; }
      base = null;   // into the layer, through the geometry path below
    } else if (base && track.baseLocked) {
      window._blendshapeStackPanel?.flash?.();
      say(`${snapLabel(s)} not snapped: its Base is locked (pick a layer, or unlock Base)`, 'yellow');
      continue;
    }
    const nv = s.getNbVertices();
    const cur = base || s.getVertices().subarray(0, nv * 3);
    const toT = between(s, t), toS = between(t, s);
    const inT = new Float32Array(nv * 3);
    for (let i = 0; i < nv; i++) { vec3.transformMat4(v, cur.subarray(i * 3, i * 3 + 3), toT); inT.set(v, i * 3); }
    const tris = triangles(s.getFaces(), s.getNbFaces());
    const out = snapSurface(inT, tris, neighbours(tris, nv), new Uint8Array(nv).fill(1), _grid.g, { maxDist });
    const after = new Float32Array(nv * 3);
    for (let i = 0; i < nv; i++) { vec3.transformMat4(v, out.subarray(i * 3, i * 3 + 3), toS); after.set(v, i * 3); }
    if (base) {
      const before = base.slice();
      const put = (b) => { track.baseShape.set(b); track._bsRev = (track._bsRev | 0) + 1; reg.applyBlendshapes(s); main.render(); };
      put(after);
      sm?.pushStateCustom(() => put(before), () => put(after), false, 'Snap to Surface');
    } else {
      sm?.pushStateGeometry(s);
      sm?.pushVertices(Uint32Array.from({ length: nv }, (_, i) => i));
      s.getVertices().set(after);
      s.updateGeometry();
      s.updateBuffers?.();
      if (s.updateResolution) s.updateResolution();
    }
    done.push(layer ? `${snapLabel(s)} (layer ${layer})` : snapLabel(s));
  }
  main.render();
  if (done.length) say(`Snapped ${done.join(', ')} onto ${snapLabel(t)} in ${(performance.now() - t0).toFixed(0)} ms`);
}
