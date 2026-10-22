import * as THREE from 'three';
import { vec3, mat3, mat4, quat } from 'gl-matrix';
import SculptBase from './SculptBase.js';
import { sampleDeltas, averageDeltas, solveWeights } from '../DirectBlend.js';
import { arkitEntry, lrPairFor } from '../ArkitBlendshapes.js';
import Enums from '../../misc/Enums.js';

/**
 * FACE — grab the face and pull it; the blendshape weights follow. See DirectBlend.js.
 *
 * matt's picture of it was playing "puppet" with his kids: hold a face, and they push your jaw
 * and brows around with both hands. So this tool has no brush and writes no vertices. Each hand
 * that grabs a point on a blendshaped mesh becomes a pin, and every frame the pins are solved for
 * the weights that put those points where the hands are. A hand that grabs and holds still is a
 * pin too, which is what lets the other hand pull the jaw without the lips following.
 *
 * IT DRIVES THE PREVIEW LAYER, never keys. setBlendshapeWeight writes a key, and a pose you are
 * still feeling for is not a key — the same reason the Kaospad drives previews. The pad's Key
 * button commits them (commitBlendshapePreview takes the whole preview map, whoever set it), and
 * a take records them, because `_performedShapes` reads the preview map.
 */
// One hue per shape, by its order on the mesh — the golden-angle spread the face-group palette
// uses, at the saturation asked for (the heatmap is soft, the cursor is full).
function shapeHue(i, sat) {
  const h = ((i + 1) * 0.61803398875) % 1, v = 0.95;
  const k = (n) => (n + h * 6) % 6;
  const f = (n) => v - v * sat * Math.max(0, Math.min(k(n), 4 - k(n), 1));
  return [f(5), f(3), f(1)];
}

class FacePuppet extends SculptBase {

  constructor(main) {
    super(main);
    this._hands = new Map();   // hand ('left'/'right'/'mouse') -> pin
    this._mesh = null;         // the one mesh the held pins are on
    this._w0 = {};             // weights when the pins last changed
    this._vrTriggerWas = {};
    this._heated = new Set();   // meshes showing the influence heatmap
    // Relative to the strongest shape at the pins (see solveWeights). Exposed so it can be tuned
    // live from the console while the feel is being found.
    this._alpha = 0.02;
    // A shape moving the grab point by less than this fraction of the strongest one is not
    // grabbed at all — see sampleDeltas on why that matters for layering.
    this._minFrac = 0.15;
    // Panel toggles (main menu + wrist).
    this._showHeat = true;
    this._useRotation = true;
    // Few shapes answer a drag instead of every one that moves the point (DirectBlend SPARSE).
    // On facecap, a half-shape drag at the smile's own corner: 8 shapes on -> 2 (smile 0.46),
    // blink/brow/jaw -> 1 each, pucker/puff 7 -> 3-4; the point still lands within ~10%.
    this._useSparse = true;
    // LAYERING: a shape that already has keys when the grab starts is left out of the solve, so
    // its take keeps playing underneath. Without it, a smile pass at the mouth corner re-solved
    // jawOpen too (it moves the corner) and recorded over the jaw pass. matt: "the happy/sad had
    // basically totally overwrite the jawopen animation."
    this._protectKeys = true;
    this._limitReach = true;   // Limit toggle: see _clampToReach
    this._protected = null;   // names keyed at the start of this grab
    // SMOOTH: hold the off-hand trigger (Shift on desktop) and the press turns DOWN whatever is on
    // under it instead of grabbing — matt's instinct after a pose overloads: "wherever i click,
    // identify the shapes that are active, turn down their sliders." Weight per second, scaled by
    // how much each shape moves this spot, so the one dominating here falls first.
    this._smoothRate = 1.5;
    this._smoothLatch = false;   // VR: the off-hand trigger is held with no pin
    this._smoother = null;       // the hand (or 'mouse') smoothing
    this._smoothT = 0;
    this._sparse = 0.01;
    this._stats = new WeakMap();   // mesh -> {key, best, who, max}: see _statsFor
    // Rotation (see _twists): how hard a full twist pulls, and the twist in degrees at which it
    // reaches that — below it the grab is the plain point grab, so a hand that merely wobbles
    // while it pulls does not start steering the shapes.
    this._rotWeight = 1;
    this._twistLoosen = 0.9;
    this._rotRamp = 15;
  }

  // NOTHING IS SCULPTED. The base class versions run a stroke; these make that structural.
  updateContinuous() {}
  addSculptToScene() {}
  // The base hover pick (it is what places the cursor on the desktop), then the heat.
  preUpdate(canBeContinuous) {
    super.preUpdate(canBeContinuous);
    this._heatTick();
  }

  // Called by the manager when the tool is switched away from.
  clearPreview() {
    for (const m of this._heated) this._heatOverlay(m, false);
    this._heated.clear();
  }

  // ── Influence heatmap: where on the face there is something to grab ────────────────────────
  //
  // matt: "its hard to see where the zones of influence are... is there a way to show a heatmap
  // or similar of where are the clickable zones, esp the 'best' zones to click and drag?"
  //
  // HUE IS THE SHAPE THAT DOMINATES THERE, BRIGHTNESS IS HOW FAR IT MOVES THE SKIN. A grab takes
  // the shapes that move the point, so a patch of one strong colour is a clean handle on one
  // shape, a seam between colours is where a pull mixes two, and grey is nothing to hold.
  // Hues follow the face-group palette by shape order.
  //
  // An overlay child sharing the mesh's own position and index buffers, so it moves with the
  // blendshapes and the skin for free — only the colours are its own, and they are recomputed
  // only when the set of shapes changes.
  _heatTick() {
    const want = new Set(this._showHeat ? this._targets() : []);
    for (const m of this._heated) if (!want.has(m)) { this._heatOverlay(m, false); this._heated.delete(m); }
    for (const m of want) { this._heatOverlay(m, true); this._heated.add(m); }
  }

  _heatOverlay(mesh, on) {
    const tm = mesh.getThreeMesh && mesh.getThreeMesh();
    if (!tm) return;
    let ov = tm.userData.faceHeat;
    if (!on) { if (ov) ov.visible = false; return; }
    const g = tm.geometry;
    if (!g.index) return;   // draw-arrays layouts do not share vertices with the mesh data
    const track = this._track(mesh);
    if (!ov) {
      ov = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({
        // ADDITIVE, so where no shape reaches it adds nothing and the skin is untouched. Alpha
        // blending with a per-vertex alpha darkened the whole face on this renderer.
        vertexColors: true, transparent: true, blending: THREE.AdditiveBlending,
        depthTest: true, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
      }));
      ov.frustumCulled = false;
      ov.renderOrder = 0.5;   // as the face-group overlay: over the skin, under the wireframe
      tm.add(ov);
      tm.userData.faceHeat = ov;
    }
    const og = ov.geometry;
    const pos = g.attributes.position;
    const key = this._heatKey(track) + '|' + pos.count;
    if (og.attributes.position !== pos || og.index !== g.index || ov.userData.key !== key) {
      og.setAttribute('position', pos);
      og.setIndex(g.index);
      og.setAttribute('color', new THREE.BufferAttribute(this._heatColours(mesh, track, pos.count), 3));
      ov.userData.key = key;
    }
    og.setDrawRange(g.drawRange.start, g.drawRange.count);
    if (!ov.visible) { ov.visible = true; this._main.render(); }
  }

  _heatKey(track) {
    const muted = track.blendshapeMuted ? [...track.blendshapeMuted].join(',') : '';
    return [...track.blendshapes.keys()].join(',') + '|' + muted + '|' + (track._bsRev | 0);
  }

  // Per vertex, the strongest shape and how far it moves the skin; and the strongest of those
  // anywhere on the mesh, which is what "the strongest region" is measured against. Shared by
  // the heatmap and the cursor, so the two always agree about which colour a place is.
  _statsFor(mesh, track) {
    const key = this._heatKey(track);
    const hit = this._stats.get(mesh);
    if (hit && hit.key === key) return hit;
    const shapes = this._shapes(track);
    const nv = mesh.getNbVertices();
    const best = new Float32Array(nv);
    const who = new Int16Array(nv).fill(-1);
    let max = 0;
    shapes.forEach(([, d], si) => {
      const n = Math.min(nv, d.length / 3);
      for (let v = 0; v < n; v++) {
        const m = Math.hypot(d[v * 3], d[v * 3 + 1], d[v * 3 + 2]);
        if (m > best[v]) { best[v] = m; who[v] = si; }
      }
    });
    for (let v = 0; v < nv; v++) max = Math.max(max, best[v]);
    const st = { key, best, who, max, names: shapes.map(([n]) => n) };
    this._stats.set(mesh, st);
    return st;
  }

  _heatColours(mesh, track, count) {
    const { best, who, max } = this._statsFor(mesh, track);
    const col = new Float32Array(count * 3);   // black = adds nothing (additive)
    for (let v = 0; v < best.length; v++) {
      if (who[v] < 0 || max <= 0) continue;
      // sqrt so the falloff of a shape shows, not just its peak
      const t = Math.sqrt(best[v] / max), h = shapeHue(who[v], 0.55);
      for (let k = 0; k < 3; k++) col[v * 3 + k] = h[k] * t * 0.7;
    }
    return col;
  }

  // ── The cursor says what a grab here would take, heatmap on or off ──────────────────────────
  //
  // matt: "always change its color to match the region under the cursor; be white where its far
  // away, and ramp to maximum saturation when its in the strongest defined region of a
  // blendshape." Same hue as the heatmap for the shape, at full saturation; the ramp is the
  // strongest shape's movement at this point over the strongest anywhere on the mesh.
  //
  // `out` is a THREE.Color. Returns true when it set one, so callers keep their own colour
  // otherwise. Called by the desktop cursor (Selection) and per hand by the VR cursor (Scene).
  cursorColor(out, mesh, face, local) {
    const track = this._track(mesh);
    if (!track || face < 0 || !local) { out.setRGB(1, 1, 1); return true; }
    const st = this._statsFor(mesh, track);
    const corners = this._corners(mesh, face);
    const d = sampleDeltas(this._shapes(track), corners, mesh.getVertices(), local);
    let bestName = null, bestM = 0;
    for (const [name, v] of Object.entries(d)) {
      const m = Math.hypot(v[0], v[1], v[2]);
      if (m > bestM) { bestM = m; bestName = name; }
    }
    const si = st.names.indexOf(bestName);
    if (si < 0 || st.max <= 0) { out.setRGB(1, 1, 1); return true; }
    const t = Math.min(1, bestM / st.max), h = shapeHue(si, 1);
    out.setRGB(1 + (h[0] - 1) * t, 1 + (h[1] - 1) * t, 1 + (h[2] - 1) * t);
    return true;
  }

  _corners(mesh, face) {
    const f = mesh.getFaces();
    const nv = mesh.getNbVertices();
    const corners = [];
    for (let k = 0; k < 4; k++) {
      const v = f[face * 4 + k];
      if (v < nv) corners.push(v);
    }
    return corners;
  }

  _reg() { return window._animationRegistry; }

  _track(mesh) {
    const reg = this._reg();
    const t = reg && mesh && reg.tracks.get(mesh.getID());
    return t && t.blendshapes && t.blendshapes.size ? t : null;
  }

  _targets() {
    return this._main.getMeshes().filter((m) => m.isVisible() && !m._isVoxelChunk && this._track(m));
  }

  // Every unmuted shape and what the mesh is wearing of it right now, previews included.
  _shapes(track) {
    const out = [];
    for (const [name, delta] of track.blendshapes) {
      if (track.blendshapeMuted && track.blendshapeMuted.has(name)) continue;
      if (track.blendshapeCombos && track.blendshapeCombos.has(name)) continue;  // derived, never solved
      out.push([name, delta]);
    }
    return out;
  }

  // Rules between shapes, from their NAMES (ARKit's, or any fooLeft/fooRight), for solveWeights.
  // With symmetry on, the halves of a pair share one weight, and a directional pose (jawLeft,
  // mouthRight) is left out: tied to its mirror it would cancel itself. Opposing poses are
  // exclusive; ARKit's mouthClose is a corrective that only closes the lips against jawOpen.
  _rules(track) {
    const has = (nm) => track.blendshapes.has(nm);
    const exclusive = [], tie = [], exclude = [];
    const seen = new Set();
    for (const [name] of track.blendshapes) {
      const e = arkitEntry(name);
      if (e && e.category === 'directional' && has(e.arkit.opposite) && !seen.has(e.arkit.opposite)) {
        exclusive.push([name, e.arkit.opposite]);
        seen.add(name);
      }
      const look = /^eyeLook(In|Up)(Left|Right)$/.exec(name);
      if (look) {
        const other = 'eyeLook' + (look[1] === 'In' ? 'Out' : 'Down') + look[2];
        if (has(other)) exclusive.push([name, other]);
      }
    }
    // A lip rolled IN and a lip flared OUT are opposite turns of the same skin. Untied, twisting a
    // rolled lip back answered with funnel on top (0.8 roll -> 0.7 roll + 0.39 funnel) instead of
    // unrolling it — matt: "once [lip roll is] activated, i can only really turn it off again by
    // using the smooth brush".
    for (const roll of ['mouthRollLower', 'mouthRollUpper']) if (has(roll) && has('mouthFunnel')) exclusive.push([roll, 'mouthFunnel']);
    if (this._main.getSculptManager().getSymmetry()) {
      for (const [name] of track.blendshapes) {
        const e = arkitEntry(name);
        if (e && e.category === 'directional') { exclude.push(name); continue; }
        const pair = lrPairFor(name, has);
        if (pair && name === pair.left && has(pair.right)) tie.push([pair.left, pair.right]);
      }
    }
    const under = has('mouthClose') && has('jawOpen') ? { mouthClose: 'jawOpen' } : {};
    return { exclusive, tie, exclude, under };
  }

  // LOCALITY: per shape at these pins, how much it moves the WHOLE face for each unit it moves
  // the grabbed points, relative to the most local shape there. 1 for the shape this spot belongs
  // to; tens for jawOpen at the lower lid, which it moves a little while swinging the whole jaw.
  // matt: "if i pull [the lower lid] too far, the entire lower mouth gets engaged." Region-based
  // models (Tena et al. 2011) and Cetinaslan's localized descent attack the same failure.
  _locality(track, pins) {
    if (!this._totals) this._totals = new WeakMap();
    const ratio = {};
    for (const [name, delta] of track.blendshapes) {
      let local = 0;
      for (const pin of pins) { const d = pin.deltas[name]; if (d) local = Math.max(local, Math.hypot(d[0], d[1], d[2])); }
      if (!local) continue;
      let total = this._totals.get(delta);
      if (total === undefined) {
        total = 0;
        for (let i = 0; i < delta.length; i += 3) total += Math.hypot(delta[i], delta[i + 1], delta[i + 2]);
        this._totals.set(delta, total);
      }
      ratio[name] = total / local;
    }
    const best = Math.min(...Object.values(ratio));
    const cost = {};
    // Square root: jawOpen at the lid (ratio ~50) is still several times dearer, but pucker
    // against cheekPuff at the lips (ratio ~2) no longer hands the pucker to the cheek.
    for (const [name, r] of Object.entries(ratio)) cost[name] = Math.min(10, Math.sqrt(r / best));
    return cost;
  }

  // LIMIT: a point cannot be pulled further than the furthest-reaching single shape there could
  // take it, along the pull. Past that, least squares stacks every shape that closes the gap a
  // little — matt: "its relatively easy to make implausible, overdriven combinations". Measured on
  // the ICT head, a pull of twice a shape's reach: lid 10 shapes -> 2, smile 10 -> 2, funnel 5 -> 3;
  // under its reach nothing changes. (Huber-weighting the pin was tried first and did ~nothing.)
  // A shape already on can also travel back, so its reach against the pull counts too.
  _clampToReach(deltas, drag) {
    const len = Math.hypot(drag[0], drag[1], drag[2]);
    if (!len) return drag;
    const u = [drag[0] / len, drag[1] / len, drag[2] / len];
    let reach = 0;
    for (const [name, c] of Object.entries(deltas)) {
      const along = c[0] * u[0] + c[1] * u[1] + c[2] * u[2];
      const w = this._w0[name] || 0;
      reach = Math.max(reach, along > 0 ? along * (1 - w) : -along * w);
    }
    return len > reach ? [u[0] * reach, u[1] * reach, u[2] * reach] : drag;
  }

  // FIX COMBO: the pose on the face looks wrong, so make it sculptable. Every shape on at 0.2 or
  // more becomes a driver of a combination layer (or the existing one for the same drivers), that
  // layer is made active, and the tool goes to Move (matt: "usually the tool of choice to fix shapes"). The pose stays as it is: the layer is
  // sculpted at the strength it shows and stored at full (AnimationRegistry.createCombo).
  fixCombo() {
    const reg = this._reg();
    const main = this._main;
    const sel = main.getMesh && main.getMesh();
    const mesh = sel && this._track(sel) ? sel : this._targets()[0];
    const name = mesh && reg.createCombo(mesh);
    if (!name) { console.log('[Face] Fix Combo: dial in at least two shapes first'); return null; }
    const track = reg.tracks.get(mesh.getID());
    if (track.editingBlendshape !== name) {
      if (track.editingBlendshape) reg.exitBlendshapeEditMode(mesh);
      reg.enterBlendshapeEditMode(mesh, name);
    }
    if (main.setMesh && sel !== mesh) main.setMesh(mesh);
    reg._refreshBlendPanels(mesh);
    const w = reg.blendshapePreviewAt(track, name, null);
    if (w < reg.COMBO_MIN_W) console.log(`[Face] Fix Combo: ${name} is at ${w.toFixed(2)}; turn the drivers up to sculpt it (needs ${reg.COMBO_MIN_W})`);
    main.getSculptManager().setToolIndex(Enums.Tools.MOVE);
    main.getGui?.()?._ctrlSculpt?.setValue?.(Enums.Tools.MOVE);
    main.render();
    return name;
  }

  _keyedNames(track) {
    return [...(track.blendshapeTracks || [])].filter(([, bt]) => bt.times.length > 1).map(([n]) => n);
  }

  // One frame of smoothing at a picked point: every shape that is ON and moves this spot comes down.
  _smoothAt(mesh, deltas) {
    const reg = this._reg();
    const track = this._track(mesh);
    if (!reg || !track || !deltas) return;
    const now = performance.now();
    const dt = Math.min(0.1, (now - this._smoothT) / 1000);
    this._smoothT = now;
    const mag = {};
    for (const [n, d] of Object.entries(deltas)) mag[n] = Math.hypot(d[0], d[1], d[2]);
    // With symmetry on, the other half comes down with this one, as it would have gone up with it.
    for (const [a, b] of this._rules(track).tie) {
      const m = Math.max(mag[a] || 0, mag[b] || 0);
      if (m) mag[a] = mag[b] = m;
    }
    const max = Math.max(0, ...Object.values(mag));
    if (!max) return;
    // NOT Protect Keys: in a take, what is on under the cursor IS the earlier passes, and turning
    // those down is the whole point of reaching for smooth. It records over them where it is used.
    const cur = this._currentWeights(track);
    let changed = false;
    for (const [n, m] of Object.entries(mag)) {
      if (!(cur[n] > 0)) continue;
      const w = Math.max(0, cur[n] - this._smoothRate * this._gain() * dt * m / max);
      changed = reg.setBlendshapePreview(mesh, n, Math.round(w * 1e4) / 1e4) || changed;
    }
    if (changed) { reg.applyBlendshapes(mesh); this._main.render(); }
  }

  _beginSmooth(who, mesh) {
    this._smoother = who;
    this._mesh = mesh;
    this._smoothT = performance.now();
    this._beginTake(mesh);
  }

  _endSmooth() {
    this._endTake(this._mesh);
    this._smoother = null;
    this._mesh = null;
    this._protected = null;
  }

  _currentWeights(track) {
    const reg = this._reg();
    const w = {};
    for (const [name] of track.blendshapes) {
      w[name] = reg.blendshapePreviewAt(track, name, track.blendshapeTracks.get(name));
    }
    return w;
  }

  // A pin from whatever `picking` just hit: the shapes' deltas at that point, and the point in
  // scene space so a hand's movement can be measured from it.
  _pinFromPick(picking, mesh, track) {
    const face = picking.getPickedFace();
    if (face < 0) return null;
    const corners = this._corners(mesh, face);
    const local = vec3.clone(picking.getIntersectionPoint());
    const patch = this._patch(mesh, corners, local, this._localRadius(mesh, picking));
    const sample = (shapes, minFrac) => patch
      ? averageDeltas(shapes, patch.idx, patch.wts, minFrac)
      : sampleDeltas(shapes, corners, mesh.getVertices(), local, minFrac);
    const deltas = sample(this._shapes(track), this._minFrac);
    this._addCombos(track, deltas, (shapes) => sample(shapes, 0));
    if (!Object.keys(deltas).length) return null;
    const world = vec3.transformMat4(vec3.create(), local, this._toWorld(mesh));
    const twist = this._useRotation ? this._twists(mesh, track, corners, local, Object.keys(deltas)) : null;
    return { deltas, world, anchor: null, now: null, twist, rotAnchor: null, rotNow: null };
  }

  // COMBOS IN THE SOLVE. A combo's weight is the product of its drivers', so with smile at 0.8, a
  // little more jawOpen also brings in 0.8 x the smile_jawOpen fix: jawOpen's column at this point
  // is its own delta plus that. Taken at the grab's starting weights (the Jacobian there), so the
  // columns stay fixed for the grab and the solve stays linear and path independent.
  _addCombos(track, deltas, sample) {
    const combos = track.blendshapeCombos;
    if (!combos || !combos.size) return;
    const live = [...combos.keys()].filter((n) => track.blendshapes.has(n) && !track.blendshapeMuted?.has(n));
    if (!live.length) return;
    const fix = sample(live.map((n) => [n, track.blendshapes.get(n)]));
    const reg = this._reg();
    const w = (n) => reg.blendshapePreviewAt(track, n, track.blendshapeTracks.get(n));
    for (const [name, f] of Object.entries(fix)) {
      const drivers = combos.get(name);
      for (const d of drivers) {
        let k = 1;
        for (const o of drivers) if (o !== d) k *= w(o);
        if (k < 1e-4 || !track.blendshapes.has(d)) continue;
        const col = deltas[d] || (deltas[d] = [0, 0, 0]);
        col[0] += k * f[0]; col[1] += k * f[1]; col[2] += k * f[2];
      }
    }
  }

  // RADIUS = HOW MUCH SKIN A GRAB TAKES: the vertices within the tool radius, walked out over the
  // mesh from the picked face (so a lower-lip grab never reaches across the mouth into the upper
  // lip, as a plain sphere would), weighted toward the centre. Too small to cover a face: null,
  // and the point under the cursor is sampled instead.
  _patch(mesh, corners, local, r) {
    if (!(r > 0)) return null;
    const pos = mesh.getVertices();
    const vrv = mesh.getVerticesRingVert(), sc = mesh.getVerticesRingVertStartCount();
    const ring = (v) => (Array.isArray(vrv) ? vrv[v] : vrv.subarray(sc[v * 2], sc[v * 2] + sc[v * 2 + 1]));
    const r2 = r * r;
    const seen = new Set(corners), queue = [...corners], idx = [], wts = [];
    while (queue.length) {
      const v = queue.pop();
      const dx = pos[v * 3] - local[0], dy = pos[v * 3 + 1] - local[1], dz = pos[v * 3 + 2] - local[2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > r2) continue;
      const f = 1 - d2 / r2;
      idx.push(v); wts.push(f * f);
      for (const nb of ring(v)) if (!seen.has(nb)) { seen.add(nb); queue.push(nb); }
    }
    return idx.length >= 3 ? { idx, wts } : null;
  }

  // The tool radius in the mesh's own units: the cursor sphere in VR, the brush
  // circle projected at the hit on desktop.
  _localRadius(mesh, picking) {
    if (this._main._xrSession) {
      const M = this._toWorld(mesh);
      return (this._radius / 100) * 0.1 / (this._main._vrScale || 1) / (Math.hypot(M[0], M[1], M[2]) || 1);
    }
    picking.updateLocalAndWorldRadius2();
    return picking.getLocalRadius();
  }

  // INTENSITY = GAIN: 50% follows the hand 1:1, 100% twice as far, 25% half — fine control.
  _gain() {
    return 2 * this._intensity;
  }

  // ── Rotation: twist the hand, and the shapes that TURN this patch of skin answer ───────────
  //
  // matt: "view the head from the side, click on the lip, and rotate my controllers to see the lips
  // curl in and out." Each shape is measured for the rotation it applies to a small patch round
  // the grab: the best-fit small rotation (axis x angle) of the patch's vertices, from its delta.
  // On the ICT lower lip, mouthRollLower turns that patch 28-36 deg one way about the face's
  // left-right axis and mouthFunnel ~35 deg the other way; jawOpen only ~10. The hand's twist since
  // the grab is matched against those, as one more pin: so curl in, curl out, and back again.
  //
  // This replaced a ring of four points at the cursor-sphere radius, which in VR came out at a
  // fifth of the head: it measured the chin and cheek turning, and a lip curl was invisible to it.
  // The patch here is its own, deliberately small (3% of the mesh), so it never spans the mouth.
  _twists(mesh, track, corners, local, names) {
    const bd = mesh.getLocalBound();
    const r = 0.03 * Math.max(bd[3] - bd[0], bd[4] - bd[1], bd[5] - bd[2]);
    const patch = this._patch(mesh, corners, local, r);
    if (!patch) return null;
    const pos = mesh.getVertices();
    const { idx, wts } = patch;
    let W = 0;
    const c = [0, 0, 0];
    idx.forEach((v, k) => { W += wts[k]; for (let j = 0; j < 3; j++) c[j] += wts[k] * pos[v * 3 + j]; });
    for (let j = 0; j < 3; j++) c[j] /= W;
    // d_k ~ w x p_k for a small rotation w, so w = A^-1 sum(p_k x d_k), A = sum(|p|^2 I - p p^T).
    const A = new Float32Array(9);
    const rel = idx.map((v, k) => {
      const p = [pos[v * 3] - c[0], pos[v * 3 + 1] - c[1], pos[v * 3 + 2] - c[2]];
      const pp = p[0] * p[0] + p[1] * p[1] + p[2] * p[2];
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) A[i * 3 + j] += wts[k] * ((i === j ? pp : 0) - p[i] * p[j]);
      return p;
    });
    const Ainv = mat3.invert(mat3.create(), A);
    if (!Ainv) return null;
    const cols = {};
    for (const name of names) {
      const d = track.blendshapes.get(name);
      if (!d) continue;
      const m = [0, 0, 0];
      idx.forEach((v, k) => { for (let j = 0; j < 3; j++) m[j] += wts[k] * d[v * 3 + j]; });
      for (let j = 0; j < 3; j++) m[j] /= W;
      const b = [0, 0, 0];
      idx.forEach((v, k) => {
        const p = rel[k], q = [d[v * 3] - m[0], d[v * 3 + 1] - m[1], d[v * 3 + 2] - m[2]];
        b[0] += wts[k] * (p[1] * q[2] - p[2] * q[1]);
        b[1] += wts[k] * (p[2] * q[0] - p[0] * q[2]);
        b[2] += wts[k] * (p[0] * q[1] - p[1] * q[0]);
      });
      const w = vec3.transformMat3(vec3.create(), b, Ainv);
      // As arc length at the patch radius, so a twist pin weighs like a pull of the same size.
      if (vec3.length(w) > 1e-3) cols[name] = [w[0] * r, w[1] * r, w[2] * r];
    }
    return Object.keys(cols).length ? { cols, r } : null;
  }

  // TWO WORLDS. The controllers arrive in scene space, which is what getModelSpaceMatrix maps
  // into; the desktop camera unprojects into three's world, which also carries the world group's
  // transform (see the note in Picking on locators). Measured the first time: the model-space
  // answer put the grab point 100px from the cursor, and a 3px drag saturated every shape.
  _toWorld(mesh) {
    if (this._main._xrSession) return mesh.getModelSpaceMatrix();
    const tm = mesh.getThreeMesh();
    tm.updateMatrixWorld(true);
    return tm.matrixWorld.elements;
  }

  // The pins changed (a hand grabbed or let go): the current pose becomes the new rest for the
  // regulariser, and every held hand measures from where it is now. See DirectBlend on why this
  // happens here and never per frame.
  _reanchor() {
    const track = this._track(this._mesh);
    if (!track) return;
    this._w0 = this._currentWeights(track);
    for (const pin of this._hands.values()) {
      if (pin.now) pin.anchor = vec3.clone(pin.now);
      // The next twist is measured from here.
      if (pin.rotNow) pin.rotAnchor = quat.clone(pin.rotNow);
    }
  }

  _solve() {
    const mesh = this._mesh;
    const reg = this._reg();
    if (!mesh || !reg || !this._hands.size) return;
    const inv = mat4.invert(mat4.create(), this._toWorld(mesh));
    if (!inv) return;
    const a = vec3.create(), b = vec3.create();
    const pins = [];
    for (const pin of this._hands.values()) {
      if (!pin.anchor || !pin.now) continue;
      vec3.transformMat4(a, pin.anchor, inv);
      vec3.transformMat4(b, pin.now, inv);
      const g = this._gain();
      const drag = [(b[0] - a[0]) * g, (b[1] - a[1]) * g, (b[2] - a[2]) * g];
      const twisting = pin.twist && pin.rotNow && pin.rotAnchor && this._useRotation;
      const R = twisting ? quat.multiply(quat.create(), pin.rotNow, quat.invert(quat.create(), pin.rotAnchor)) : null;
      if (R && R[3] < 0) quat.scale(R, R, -1);
      const angle = R ? 2 * Math.acos(Math.min(1, R[3])) : 0;
      const ramp = Math.min(1, (angle * 180 / Math.PI) / this._rotRamp);
      // A TWIST LOOSENS THE HOLD ON THE POINT. Curling a lip moves the very skin you hold, so a
      // point pinned where it was outvoted the twist (the ICT lower lip reached 0.09 at 40 deg).
      pins.push({ deltas: pin.deltas, drag: this._limitReach ? this._clampToReach(pin.deltas, drag) : drag,
        weight: 1 - this._twistLoosen * ramp });
      if (!twisting) continue;
      const weight = this._rotWeight * ramp;
      if (weight <= 0) continue;
      // The axis into the mesh's own frame (a direction: the inverse matrix's rotation part).
      const ax = vec3.normalize(vec3.create(), [
        inv[0] * R[0] + inv[4] * R[1] + inv[8] * R[2],
        inv[1] * R[0] + inv[5] * R[1] + inv[9] * R[2],
        inv[2] * R[0] + inv[6] * R[1] + inv[10] * R[2]]);
      const k = angle * pin.twist.r * g;
      pins.push({ deltas: pin.twist.cols, drag: [ax[0] * k, ax[1] * k, ax[2] * k], weight, twist: true });
    }
    const track = reg.tracks.get(mesh.getID());
    const rules = track ? this._rules(track) : {};
    if (this._protectKeys && track) {
      // Taken once per grab, so the keys THIS take is laying down do not lock its own shapes.
      // Two keys or more: a single key is a held pose (an import writes one per shape for the
      // file's default weights), not a take to protect — counting it locked all of facecap.
      if (!this._protected) this._protected = this._keyedNames(track);
      rules.exclude = [...(rules.exclude || []), ...this._protected];
      rules.tie = (rules.tie || []).filter(([a, b]) => !this._protected.includes(a) && !this._protected.includes(b));
    }
    const cost = this._useSparse && track ? this._locality(track, pins.filter((p) => !p.twist)) : null;
    const w = solveWeights(pins, this._w0, { alpha: this._alpha, sparse: this._useSparse ? this._sparse : 0, cost, ...rules });
    let changed = false;
    const previewing = track?.blendshapePreview;
    for (const name of Object.keys(w)) {
      // ONLY SHAPES THAT MOVE. The solver answers for every shape at the pin, most left where they
      // were — and a take keys whatever is previewed, so a smile pass on facecap wrote 22 curves,
      // half of them flat lines at the file's default weights. Once a shape has moved it stays
      // previewed, so it can come back to where it started.
      if (Math.abs(w[name] - (this._w0[name] || 0)) < 1e-3 && !previewing?.has(name)) continue;
      // Snapped to a 1e-4 grid so a hand held still does not recomposite the mesh every frame
      // over a change in the sixth decimal place.
      changed = reg.setBlendshapePreview(mesh, name, Math.round(w[name] * 1e4) / 1e4) || changed;
    }
    if (changed) {
      reg.applyBlendshapes(mesh);
      this._main.render();
    }
  }

  // ── Desktop: one pin, under the mouse, dragged in the plane facing the camera ──────────────
  start(shift) {
    const main = this._main;
    // The headset's presses are handled per hand in updateXR; Scene calls this on the trigger
    // too, against a mouse position nobody is looking at. Same guard as SelectTool.
    if (main._xrSession) return false;
    const picking = main.getPicking();
    if (!picking.intersectionMouseMeshes(this._targets(), main._mouseX, main._mouseY)) return false;
    const mesh = picking.getMesh();
    const track = this._track(mesh);
    const pin = track && this._pinFromPick(picking, mesh, track);
    if (!pin) return false;
    if (shift) {
      this._beginSmooth('mouse', mesh);
      this._smoothAt(mesh, pin.deltas);
      return true;
    }
    this._hands.clear();
    this._mesh = mesh;
    pin.now = vec3.clone(pin.world);
    pin.anchor = vec3.clone(pin.world);
    this._screenZ = main.getCamera().project(pin.world)[2];
    this._hands.set('mouse', pin);
    this._beginTake(mesh);
    this._reanchor();
    return true;
  }

  update() {
    const main = this._main;
    if (this._smoother === 'mouse') {
      const picking = main.getPicking();
      if (!this._mesh || !picking.intersectionMouseMeshes([this._mesh], main._mouseX, main._mouseY)) return;
      const track = this._track(this._mesh);
      this._smoothAt(this._mesh, track && this._pinFromPick(picking, this._mesh, track)?.deltas);
      return;
    }
    const pin = this._hands.get('mouse');
    if (!pin) return;
    pin.now = main.getCamera().unproject(main._mouseX, main._mouseY, this._screenZ);
    this._solve();
  }

  end() {
    if (this._smoother === 'mouse') { this._endSmooth(); return; }
    this._hands.delete('mouse');
    if (!this._hands.size) { this._endTake(this._mesh); this._mesh = null; this._protected = null; }
  }

  // ── Recording: a grab IS the take, the way a Grab is for a transform take ───────────────────
  //
  // With Record armed, the first hand on the face starts a BLENDSHAPE take and the last hand off
  // it ends one. The key mode is forced rather than asked for: pulling a face can only ever mean
  // weights, and a take left in Transform mode would quietly record the head's matrix instead.
  // The capture itself is the Kaospad's — it keys whatever the preview layer holds, which is
  // exactly the shapes these pins are solving for.
  _beginTake(mesh) {
    const reg = this._reg();
    this._gestureBegin(mesh);
    if (!reg || !window._animArmed || reg.isRecording || reg.isCountingIn) return;
    // The take records the SELECTED mesh's track, and the selection is often something else
    // (this tool never needed it). Select the face first, keeping this tool.
    if (this._main.getMesh() !== mesh) this._main.setOrUnsetMesh(mesh, false, true);
    // A PASS RECORDS ONLY WHAT THIS GRAB MOVES. The take keys every shape in the preview map, and
    // a pose held from an earlier drag is still sitting there — so it would be flattened into this
    // pass. Let it go, so the passes already recorded play underneath; the anchor pose is taken
    // after this, from the curves.
    reg.clearBlendshapePreview(mesh);
    window._animKeyMode = 'blendshape';
    window._animWaitingForGrab = true;
    // NO COUNT-IN: the grab is the cue, and three seconds of holding a face still before
    // anything records is three seconds of performance thrown away.
    const countIn = window._animCountIn;
    window._animCountIn = false;
    reg.beginInteraction(mesh);
    window._animCountIn = countIn;
    if (this._gesture) this._gesture.take = !!reg.isRecording;
  }

  _endTake(mesh) {
    if (mesh) this._reg()?.endInteraction?.(mesh);
    this._gestureFinish();
  }

  // ONE UNDO STEP PER GESTURE, first hand on to last hand off (a smooth stroke too). The tool only
  // ever writes the preview layer, and nothing undid that: matt, "undo doesn't work for this face
  // tool". A take is left to its own step (AnimationRegistry's "Record Face Take"), which holds the
  // keys; the preview it leaves behind is cleared when it stops.
  _gestureBegin(mesh) {
    if (this._gesture) return;
    const track = this._track(mesh);
    if (!track) return;
    this._gesture = { mesh, take: false, before: new Map(track.blendshapePreview || []) };
  }

  _gestureFinish() {
    const g = this._gesture;
    this._gesture = null;
    if (!g || g.take) return;
    const reg = this._reg();
    const track = this._track(g.mesh);
    if (!reg || !track) return;
    const after = new Map(track.blendshapePreview || []);
    if (after.size === g.before.size && [...after].every(([n, v]) => g.before.get(n) === v)) return;
    const put = (snap) => {
      const tr = this._track(g.mesh);
      if (!tr) return;
      tr.blendshapePreview = new Map(snap);
      reg.applyBlendshapes(g.mesh);
      reg._refreshBlendPanels?.(g.mesh);
      this._main.render();
    };
    this._main.getStateManager().pushStateCustom(() => put(g.before), () => put(after), false, 'Face Pose');
  }

  // ── VR: every hand is a pin. Trigger grabs where its ray meets the face; letting go drops it ─
  updateXR(picking, isPressed, origin, dir, options) {
    this._heatTick();
    const controllers = (options && options.controllers) || [];
    let pinsChanged = false;
    for (const c of controllers) {
      const hand = c.handedness;
      const down = !!(c.buttons && c.buttons[0] && c.buttons[0].pressed);
      const was = !!this._vrTriggerWas[hand];
      this._vrTriggerWas[hand] = down;
      // Let go of smooth mode BEFORE the pose guard: an off hand released over a panel has no
      // pose, and skipping its release would leave the mode stuck on.
      const offHand = hand !== (this._main._dominantHand || 'right');
      if (offHand && !down && this._smoothLatch) { this._smoothLatch = false; if (this._smoother) this._endSmooth(); continue; }
      // No pose: the ray is on a menu and the press belongs to it. A held pin keeps its last
      // position rather than letting go, so glancing the ray across a panel does not drop the jaw.
      if (!c.matrix || !c.rayOrigin) continue;
      const tip = vec3.clone(c.rayOrigin);
      const rot = mat4.getRotation(quat.create(), c.matrix);

      // SMOOTH MODE, as for every other tool: the off-hand trigger alone is the mode, the dominant
      // press does the work. Only with no pin held — reaching in with the off hand while the
      // dominant one holds the face is still the two-hand grab.
      if (offHand && down && !was && !this._hands.size && !this._smoother) { this._smoothLatch = true; continue; }
      if (this._smoothLatch && offHand) continue;
      if (!offHand && this._smoothLatch && down) {
        const hit = this._grabFromRay(picking, tip, c.rayDirection);
        if (!this._smoother) { if (hit) this._beginSmooth(hand, this._mesh); }
        if (hit && this._smoother === hand) this._smoothAt(this._mesh, hit.deltas);
        continue;
      }
      if (!down && was && this._smoother === hand) { this._endSmooth(); continue; }

      if (down && !was) {
        const pin = this._grabFromRay(picking, tip, c.rayDirection);
        if (pin) {
          pin.now = tip;
          pin.rotNow = rot;
          this._hands.set(hand, pin);
          pinsChanged = true;
        }
      } else if (!down && was) {
        if (this._hands.delete(hand)) pinsChanged = true;
        if (!this._hands.size) this._endTake(this._mesh);
      } else if (down) {
        const pin = this._hands.get(hand);
        if (pin) { pin.now = tip; pin.rotNow = rot; }
      }
    }
    if (!this._hands.size) { if (!this._smoother) { this._mesh = null; this._protected = null; } return; }
    if (pinsChanged) { this._beginTake(this._mesh); this._reanchor(); }
    this._solve();
  }

  // From the spike's tip along its ray — and from a little behind the tip as well, because the
  // natural gesture is to put the tip ON the face, and a ray starting just inside the skin finds
  // only the back of the head.
  _grabFromRay(picking, tip, dir) {
    let targets = this._targets();
    // Both hands on ONE face. A second mesh mid-gesture would need its own solve, and the first
    // hand's anchor pose would no longer describe it.
    if (this._mesh && this._hands.size) targets = targets.filter((m) => m === this._mesh);
    if (!targets.length || !dir) return null;
    const back = vec3.scaleAndAdd(vec3.create(), tip, dir, -0.05 / (this._main._vrScale || 1));
    for (const o of [back, tip]) {
      if (!picking.intersectionRayMeshes(targets, o, dir)) continue;
      const mesh = picking.getMesh();
      const track = this._track(mesh);
      const pin = track && this._pinFromPick(picking, mesh, track);
      if (pin) { this._mesh = mesh; return pin; }
    }
    return null;
  }
}

export default FacePuppet;
