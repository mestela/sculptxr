import * as THREE from 'three';
import { vec3, mat4, quat } from 'gl-matrix';
import SculptBase from './SculptBase.js';
import { sampleDeltas, solveWeights } from '../DirectBlend.js';

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
    this._stats = new WeakMap();   // mesh -> {key, best, who, max}: see _statsFor
    // Rotation (see _ringFor): how hard a full twist pulls, and the twist in degrees at which it
    // reaches that — below it the grab is the plain point grab, so a hand that merely wobbles
    // while it pulls does not start steering the shapes.
    this._rotWeight = 0.5;
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
      out.push([name, delta]);
    }
    return out;
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
    const deltas = sampleDeltas(this._shapes(track), corners, mesh.getVertices(), local, this._minFrac);
    if (!Object.keys(deltas).length) return null;
    const world = vec3.transformMat4(vec3.create(), local, this._toWorld(mesh));
    const ring = this._main._xrSession && this._useRotation
      ? this._ringFor(mesh, track, local, picking.computePickedNormal(), deltas) : null;
    return { deltas, world, anchor: null, now: null, ring, rotAnchor: null, rotNow: null };
  }

  // ── Rotation: a grab holds a small rigid PATCH, not a point ─────────────────────────────────
  //
  // matt: "would it be possible to map controller rotations onto this? ... otherwise i feel we're
  // leaving expressivity on the table." A point has no orientation, but a patch does: four points
  // on a ring round the grab, carried rigidly by the hand. Twist the hand and the ring asks to
  // turn about the grab point — and turning a patch of skin is just displacement of its points,
  // which the shapes already know how to answer. Roll a mouth corner and it reaches for smile or
  // frown; tilt a brow and it splits inner from outer. Nothing authored.
  //
  // The ring pins are RELATIVE to the centre (their columns are delta_k - delta_centre), so they
  // constrain only the patch's turn, never its travel — pulling still behaves exactly as the point
  // grab did. And they only cover the shapes the centre grabbed, so a twist cannot recruit a shape
  // from elsewhere into the take. The ring is the cursor sphere: radius from the tool slider.
  _ringFor(mesh, track, local, normal, centre) {
    if (!normal) return null;
    const M = this._toWorld(mesh);
    const sc = Math.hypot(M[0], M[1], M[2]) || 1;
    const rScene = (this._radius / 100) * 0.1 / (this._main._vrScale || 1);
    const rl = rScene / sc;
    const n = vec3.normalize(vec3.create(), normal);
    const t1 = vec3.cross(vec3.create(), n, Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]);
    vec3.normalize(t1, t1);
    const t2 = vec3.cross(vec3.create(), n, t1);
    const v = mesh.getVertices(), nv = mesh.getNbVertices();
    const centreWorld = vec3.transformMat4(vec3.create(), local, M);
    const ring = [];
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2;
      const q = [0, 1, 2].map((i) => local[i] + rl * (Math.cos(a) * t1[i] + Math.sin(a) * t2[i]));
      let best = -1, bd = Infinity;
      for (let i = 0; i < nv; i++) {
        const dx = v[i * 3] - q[0], dy = v[i * 3 + 1] - q[1], dz = v[i * 3 + 2] - q[2];
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bd) { bd = d; best = i; }
      }
      if (best < 0) continue;
      const deltas = {};
      for (const name of Object.keys(centre)) {
        const d = track.blendshapes.get(name);
        if (!d || best * 3 + 2 >= d.length) continue;
        const c = centre[name];
        deltas[name] = [d[best * 3] - c[0], d[best * 3 + 1] - c[1], d[best * 3 + 2] - c[2]];
      }
      const pw = vec3.transformMat4(vec3.create(), [v[best * 3], v[best * 3 + 1], v[best * 3 + 2]], M);
      ring.push({ deltas, off: vec3.sub(pw, pw, centreWorld) });
    }
    return ring.length ? ring : null;
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
      // The patch keeps the turn it already has: carry the ring round with it, then measure the
      // next turn from here.
      if (pin.ring && pin.rotNow && pin.rotAnchor) {
        const R = quat.multiply(quat.create(), pin.rotNow, quat.invert(quat.create(), pin.rotAnchor));
        for (const r of pin.ring) vec3.transformQuat(r.off, r.off, R);
      }
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
      pins.push({ deltas: pin.deltas, drag: [b[0] - a[0], b[1] - a[1], b[2] - a[2]] });
      if (!pin.ring || !pin.rotNow || !pin.rotAnchor || !this._useRotation) continue;
      const R = quat.multiply(quat.create(), pin.rotNow, quat.invert(quat.create(), pin.rotAnchor));
      const angle = 2 * Math.acos(Math.min(1, Math.abs(R[3]))) * 180 / Math.PI;
      const weight = this._rotWeight * Math.min(1, angle / this._rotRamp);
      if (weight <= 0) continue;
      for (const r of pin.ring) {
        // Where this ring point sits now, relative to the centre, against where it sat: the
        // rotation's share of its movement, in the mesh's own space.
        const turned = vec3.transformQuat(vec3.create(), r.off, R);
        const p0 = vec3.add(vec3.create(), pin.world, r.off);
        const p1 = vec3.add(vec3.create(), pin.world, turned);
        vec3.transformMat4(a, p0, inv);
        vec3.transformMat4(b, p1, inv);
        pins.push({ deltas: r.deltas, drag: [b[0] - a[0], b[1] - a[1], b[2] - a[2]], weight });
      }
    }
    const w = solveWeights(pins, this._w0, { alpha: this._alpha });
    let changed = false;
    for (const name of Object.keys(w)) {
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
  start() {
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
    const pin = this._hands.get('mouse');
    if (!pin) return;
    const main = this._main;
    pin.now = main.getCamera().unproject(main._mouseX, main._mouseY, this._screenZ);
    this._solve();
  }

  end() {
    this._hands.delete('mouse');
    if (!this._hands.size) { this._endTake(this._mesh); this._mesh = null; }
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
  }

  _endTake(mesh) {
    if (mesh) this._reg()?.endInteraction?.(mesh);
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
      // No pose: the ray is on a menu and the press belongs to it. A held pin keeps its last
      // position rather than letting go, so glancing the ray across a panel does not drop the jaw.
      if (!c.matrix || !c.rayOrigin) continue;
      const tip = vec3.clone(c.rayOrigin);
      const rot = mat4.getRotation(quat.create(), c.matrix);

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
    if (!this._hands.size) { this._mesh = null; return; }
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
