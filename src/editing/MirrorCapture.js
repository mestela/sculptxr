import * as THREE from 'three';
import { mat4 } from 'gl-matrix';
import Skeleton from './Skeleton.js';
import NodeMaterials from '../render/nodes/NodeMaterials.js';

// MIRROR CAPTURE: record the headset and both hands onto three nulls, with a mirror in front of
// you so you can see the performance you are giving.
//
// The nulls (Head, Hand L, Hand R, under one Performance parent) are ordinary transform takes, so
// everything after the take is existing tooling: parent or aim-constrain to them, clean them in
// the graph editor, move the Performance parent to place the whole thing.
//
// The mirror is not a render-to-texture. It is a frame plus simple proxies of the headset and
// hands, REFLECTED through the mirror plane — cheaper than a second render in a headset, and the
// proxies are the thing you want to read anyway.
//
// The frame lives under the WORLD GROUP, so moving or scaling the world carries it, and a grip
// near it grabs it instead (see claimGrip). The proxies live at the scene root in metres, since
// they stand for real things: live, they are your headset and hands; during playback, the take.
//
// ONE MATERIAL, ONE BUILD. Every part is a vertex-coloured mesh on the sculpt's own shared
// material (see material()). It used to be a material per box -- a dozen shader compiles on every
// open, all thrown away on close. Close now only hides the rig.

const MIRROR_DIST = 0.85;   // metres in front of the head
const MIRROR_DROP = 0.2;    // centre below eye height
const MIRROR_W = 0.8, MIRROR_H = 1.2, BAR = 0.02;
const BTN_R = 0.045, BTN_HIT = 0.07, BTN_REARM = 0.13;
const GRAB_MARGIN = 0.1;    // metres around the frame that a grip grabs it
const ORDER_PROXY = 160;

const COL = { idle: 0x8a3a48, armed: 0xfab387, rec: 0xf38ba8, frame: 0xcdd6f4 };

const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _mw = new THREE.Matrix4();
const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
const _n = new THREE.Vector3(), _c = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1);
const _col = new THREE.Color();

// THE SCULPT'S OWN MATERIAL, so nothing new compiles: it is on screen from the first frame. The
// geometry carries exactly the sculpt's attributes (position, normal, color, aMaterial; indexed),
// which is what lets the renderer reuse the program instead of building one. A plain vertex-colour
// material is only the fallback for the legacy renderer or an empty scene.
let sharedMat = null;
const realMesh = (main) => main.getMeshes().find((m) => !m._isNull && !m._isBone && !m._isReference && m.getNbVertices);
function material(main) {
  if (sharedMat) return sharedMat;
  const real = realMesh(main);
  sharedMat = (NodeMaterials.isActive?.() && NodeMaterials.get(real ? real.getShaderType() : 0))
    || new THREE.MeshBasicMaterial({ vertexColors: true });
  return sharedMat;
}

// Boxes [w, h, d, hex, x, y, z] merged into one indexed, vertex-coloured mesh.
function boxes(main, list) {
  const pos = [], nrm = [], col = [], idx = [];
  for (const [w, h, d, hex, x = 0, y = 0, z = 0] of list) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    const base = pos.length / 3;
    pos.push(...g.attributes.position.array);
    nrm.push(...g.attributes.normal.array);
    for (const i of g.index.array) idx.push(base + i);
    _col.setHex(hex);
    for (let i = 0; i < g.attributes.position.count; i++) col.push(_col.r, _col.g, _col.b);
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  return mesh(main, geo);
}

const owned = [];   // every mesh on the shared material, for the shadow-flag sync
function syncShadowFlags(main) {
  const tm = realMesh(main)?.getThreeMesh?.();
  if (tm) for (const m of owned) m.receiveShadow = tm.receiveShadow;
}

function mesh(main, geo) {
  // aMaterial = (roughness, metalness, mask): matte, non-metal, unmasked.
  const n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = 0.6; a[i * 3 + 2] = 1; }
  geo.setAttribute('aMaterial', new THREE.Float32BufferAttribute(a, 3));
  const m = new THREE.Mesh(geo, material(main));
  owned.push(m);
  m.renderOrder = ORDER_PROXY;
  m.frustumCulled = false;
  return m;
}

// Rebuilt as a plain BufferGeometry with the same arrays the boxes use: a stock SphereGeometry
// on the sculpt material compiled a pipeline of its own on the headset (187ms, measured), where
// the boxes compiled nothing.
function sphere(main, r, hex) {
  const g = new THREE.SphereGeometry(r, 16, 12);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(Array.from(g.attributes.position.array), 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(Array.from(g.attributes.normal.array), 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 3), 3));
  geo.setIndex(Array.from(g.index.array));
  g.dispose();
  const m = mesh(main, geo);
  tint(m, hex);
  return m;
}

// Recolour a whole mesh. Only called when the colour changes.
function tint(m, hex) {
  if (m._hex === hex) return;
  m._hex = hex;
  const a = m.geometry.attributes.color;
  _col.setHex(hex);
  for (let i = 0; i < a.count; i++) a.setXYZ(i, _col.r, _col.g, _col.b);
  a.needsUpdate = true;
}

// A copy of a node tree that SHARES geometry and materials and carries nothing else. Not
// Object3D.clone: that deep-copies userData through JSON, and the controller model's userData
// holds a texture -- so each clone serialised it with toDataURL. 5.4s of a 6s frame on the GXR,
// profiled; it was the whole of the first-open hitch.
function shareClone(o) {
  const c = o.isMesh ? new THREE.Mesh(o.geometry, o.material) : new THREE.Object3D();
  c.position.copy(o.position); c.quaternion.copy(o.quaternion); c.scale.copy(o.scale);
  c.visible = o.visible;
  for (const k of o.children) c.add(shareClone(k));
  return c;
}

// A proxy is a group whose matrix is written directly each frame (reflection has det < 0, which
// a position/quaternion/scale cannot express).
function proxy(child) {
  const g = new THREE.Group();
  g.matrixAutoUpdate = false;
  g.add(child);
  return g;
}

// Headset proxy in the head frame: three's camera looks down -Z.
const headProxy = (main) => proxy(boxes(main, [
  [0.19, 0.11, 0.09, 0x8899aa, 0, 0, -0.03],
  [0.17, 0.08, 0.02, 0x22262e, 0, 0, -0.085],    // visor
  [0.03, 0.02, 0.01, 0x66e0ff, -0.04, 0.005, -0.097],
  [0.03, 0.02, 0.01, 0x66e0ff, 0.04, 0.005, -0.097],
  [0.2, 0.03, 0.16, 0x555b66, 0, 0.02, 0.07],     // strap
]));

// Hand proxy in grip space: -Z is "forward" out of the fist. The nub shows roll and aim.
function handProxy(main, hex) {
  const b = boxes(main, [[0.05, 0.05, 0.1, hex], [0.02, 0.02, 0.05, 0xffffff, 0, 0.01, -0.07]]);
  const g = proxy(b);
  g._box = b;
  return g;
}

const MirrorCapture = {
  active: false,
  // Test seam: () => ({ head, left, right }) of THREE.Matrix4 in scene-root space (or null).
  // Desktop has no headset, so this is how the mode is exercised off-device.
  poseHook: null,
  _mirror: null, _frame: null, _btn: null, _proxies: null, _proxyRoot: null,
  _refl: new THREE.Matrix4(),
  _nulls: null,
  _grab: null,                // { hand, offset } while a grip holds the mirror
  _btnArmed: true, _btnCooldown: 0,

  toggle(main) { return this.active ? this.exit(main) : this.enter(main); },

  enter(main) {
    this._main = main;
    const t0 = performance.now();
    const pose = this._readPose(main);
    if (!pose?.head) { window.screenLog?.('Mirror capture needs a headset', 'orange'); return false; }
    const first = !this._mirror;
    this._build(main);
    syncShadowFlags(main);   // before the first draw, or that draw builds the wrong pipeline
    const t1 = performance.now();
    this._place(main, pose.head);
    // THE FIRST-OPEN HITCH, MEASURED: build, place, then the next frames (see update). One line.
    if (first) this._timing = { t0, build: t1 - t0, place: performance.now() - t1, frames: [], last: performance.now() };
    this._mirror.visible = this._proxyRoot.visible = true;
    this.active = true;
    window.screenLog?.('Mirror capture on: poke the ball or press Record', 'cyan');
    return true;
  },

  exit(main) {
    const r = window._animationRegistry;
    if (r && this._isOurTake(r)) r.toggleRecord(null);
    if (this._mirror) this._mirror.visible = this._proxyRoot.visible = false;
    this._grab = null;
    this.active = false;
    main.render?.();
    return false;
  },

  // Start or stop a take on the three nulls. Stopping goes through toggleRecord so the take is
  // finalised exactly like any other (undo, loop length, auto-play).
  toggleRecord(main) {
    this._main = main;
    const r = window._animationRegistry;
    if (!r) return false;
    const busy = r.isRecording || r.isCountingIn || r.captureTimer || r.countInTimer
      || window._animArmed || window._animWaitingForGrab;
    if (busy) { r.toggleRecord(null); return false; }
    const n = this._ensureNulls(main);
    window._animKeyMode = 'transform';        // the recorder records whatever the mode says
    r.loopOffForRecord();
    window._animArmed = true;
    window._animWaitingForGrab = false;       // no grab is coming: the performance is the take
    // ON THE PERFORMER BEFORE THE FIRST SAMPLE. The recorder samples on its own 33ms timer, not
    // the render loop, so its first key could land before update() had moved the nulls -- and it
    // keyed wherever they sat before the take: a bad key at frame 0, every take.
    this._driveAll(this._readPose(main));
    r.startRecording(n.head);
    r.addInteractionTarget(n.left);
    r.addInteractionTarget(n.right);
    return true;
  },

  // From the VR input loop, per hand, BEFORE world navigation reads the grip. True means the
  // mirror owns this grip and the world must not move. A grab latches until the grip opens.
  claimGrip(main, hand, isGrip, canStart) {
    if (!this.active) return false;
    if (this._grab && this._grab.hand === hand) {
      if (isGrip) return true;
      this._grab = null;
      return false;
    }
    if (!isGrip || !canStart || this._grab) return false;
    const grip = hand === 'left' ? main._vrControllerLeftGrip : main._vrControllerRightGrip;
    if (!grip || !this._nearFrame(grip.matrixWorld)) return false;
    // offset = inv(hand) * mirror, so mirror = hand * offset while held.
    this._grab = { hand, grip, offset: grip.matrixWorld.clone().invert().multiply(this._mirrorWorld(_mw)) };
    return true;
  },

  // Per frame, from the render loop. Reads one boolean while off.
  update(main) {
    this._main = main;
    if (!this.active || !this._mirror) return;
    // Leaving the session puts the world group back at desktop scale, which blew the mirror up
    // 87x and left its record ball floating in the desktop scene. The mirror is a headset thing.
    if (!this.poseHook && !main._renderer?.xr?.isPresenting) { this.exit(main); return; }
    // RECEIVESHADOW IS PART OF THE PIPELINE KEY (three's RenderObject.getDynamicCacheKey). The
    // sculpt receives when a shadow light is up; ours did not, so the same material built a second
    // pipeline -- a 6 second frame on the GXR, measured. Follow the sculpt, every frame.
    syncShadowFlags(main);
    const tm = this._timing;
    if (tm) {
      const now = performance.now();
      tm.frames.push(Math.round(now - tm.last)); tm.last = now;
      if (tm.frames.length === 8) {
        console.log('[mirror] first open: build ' + tm.build.toFixed(1) + 'ms, place ' + tm.place.toFixed(1)
          + 'ms, next frames ' + tm.frames.join(' ') + ' ms, model clones L/R ' + !!this._proxies.left._model
          + '/' + !!this._proxies.right._model);
        this._timing = null;
      }
    }
    if (this._grab) this._setMirrorWorld(main, _m.multiplyMatrices(this._grab.grip.matrixWorld, this._grab.offset));
    this._updateReflection();

    const pose = this._readPose(main);
    const r = window._animationRegistry;
    const ours = r && this._isOurTake(r);

    // THE MIRROR SHOWS THE TIMELINE whenever there is a take, playing or paused. It shows YOU
    // only when there is nothing recorded yet, or a take is armed / counting in / recording.
    const n = this._findNulls(main);
    const armed = r && (r.isRecording || r.isCountingIn || window._animArmed || window._animWaitingForGrab);
    const hasTake = n && (r?.tracks.get(n.head.getID())?.times?.length > 0);
    const replay = hasTake && !armed;
    const src = replay
      ? { head: this._nullPose(n.head), left: this._nullPose(n.left), right: this._nullPose(n.right) }
      : pose;

    const P = this._proxies;
    for (const k of ['head', 'left', 'right']) {
      const m = src && src[k];
      P[k].visible = !!m;
      if (m) { P[k].matrix.multiplyMatrices(this._refl, m); P[k].matrixWorldNeedsUpdate = true; }
    }
    if (pose) { this._syncModel(P.left, pose.leftGrip); this._syncModel(P.right, pose.rightGrip); }

    // Through the count-in too, so the nulls are already on you when capture begins.
    if (r && (r.isRecording || r.isCountingIn) && ours) this._driveAll(pose);

    this._pokeButton(main, pose);
    tint(this._btn, r?.isRecording ? COL.rec : (r?.isCountingIn ? COL.armed : COL.idle));
    tint(this._frame, r?.isRecording && ours ? COL.rec : COL.frame);
  },

  _driveAll(pose) {
    const n = this._nulls;
    if (!n || !pose) return;
    if (pose.head) this._drive(n.head, pose.head);
    if (pose.left) this._drive(n.left, pose.left);
    if (pose.right) this._drive(n.right, pose.right);
  },

  // Show the runtime's own controller model in the reflection when there is one, so orientation
  // reads at a glance; the box stands in for tracked hands and while the model is still loading.
  // The clone is static (no button animation) and shares the original's materials.
  _syncModel(proxyGroup, grip) {
    const model = grip && grip.children.find((c) => 'motionController' in c);
    const src = model && model.visible ? model.children[0] : null;
    if (proxyGroup._modelSrc !== src) {
      if (proxyGroup._model) proxyGroup.remove(proxyGroup._model);
      proxyGroup._model = null;
      if (src) {
        const w = new THREE.Group();
        w.matrixAutoUpdate = false;
        w.matrix.copy(model.matrix);
        w.add(shareClone(src));
        w.traverse((o) => { o.frustumCulled = false; o.renderOrder = ORDER_PROXY; });
        proxyGroup.add(w);
        proxyGroup._model = w;
      }
      proxyGroup._modelSrc = src;
    }
    proxyGroup._box.visible = !proxyGroup._model;
  },

  // How far the view must reach to keep the reflection: everything reflected sits about as far
  // behind the mirror as it is in front of it, plus room for arms and a step back.
  farReach(headPos) {
    if (!this._mirror) return 0;
    return 2 * headPos.distanceTo(_c.setFromMatrixPosition(this._mirrorWorld(_mw))) + 1.0;
  },

  _mirrorScale() {
    const e = this._mirrorWorld(_mw).elements;
    return Math.hypot(e[0], e[1], e[2]) || 1;
  },

  _isOurTake(r) {
    const n = this._nulls;
    if (!n || !r.recordingTargets) return false;
    return r.recordingTargets.includes(n.head);
  },

  _readPose(main) {
    if (this.poseHook) return this.poseHook(main);
    const xr = main._renderer?.xr;
    if (!xr?.isPresenting) return null;
    const grab = (o) => (o && o.visible ? o.matrixWorld.clone() : null);
    return {
      head: xr.getCamera().matrixWorld.clone(),
      left: grab(main._vrControllerLeftGrip),
      right: grab(main._vrControllerRightGrip),
      leftGrip: main._vrControllerLeftGrip,
      rightGrip: main._vrControllerRightGrip,
    };
  },

  _build(main) {
    if (this._mirror) return;
    // A frame of four bars and nothing inside it: any surface across the opening sits between
    // you and the reflected proxies and hides them.
    const w = MIRROR_W / 2, h = MIRROR_H / 2, c = COL.frame;
    const frame = boxes(main, [[MIRROR_W + BAR, BAR, BAR, c, 0, -h], [MIRROR_W + BAR, BAR, BAR, c, 0, h],
      [BAR, MIRROR_H + BAR, BAR, c, -w, 0], [BAR, MIRROR_H + BAR, BAR, c, w, 0]]);

    // On the frame's bottom-right corner, so it reads as part of the mirror. Floating between
    // you and the mirror it looked like a stray object in the scene.
    const btn = sphere(main, BTN_R, COL.idle);
    btn.position.set(w, -h, BAR);

    const mirror = new THREE.Group();
    mirror.name = 'mirror_capture';
    mirror.matrixAutoUpdate = false;
    mirror.add(frame, btn);
    main._worldGroup.add(mirror);

    const proxies = { head: headProxy(main), left: handProxy(main, 0x66e0ff), right: handProxy(main, 0xffa060) };
    const pg = new THREE.Group();
    pg.name = 'mirror_capture_proxies';
    pg.add(proxies.head, proxies.left, proxies.right);
    main._scene.add(pg);

    this._mirror = mirror; this._frame = frame; this._btn = btn;
    this._proxies = proxies; this._proxyRoot = pg;
  },

  // Stand the mirror in front of the head, upright, facing it.
  _place(main, head) {
    head.decompose(_p, _q, _s);
    _n.set(0, 0, -1).applyQuaternion(_q); _n.y = 0;
    if (_n.lengthSq() < 1e-6) _n.set(0, 0, -1);
    _n.normalize();
    _c.copy(_p).addScaledVector(_n, MIRROR_DIST);
    _c.y -= MIRROR_DROP;
    _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-_n.x, -_n.z));   // +Z toward you
    // Real size the first time. After that it keeps the size it has IN THE WORLD, so a take
    // recorded against it still plays back at the same size relative to it.
    _s.setScalar(this._placed ? this._mirrorScale() : 1);
    this._placed = true;
    this._setMirrorWorld(main, _m.compose(_c, _q, _s));
  },

  // The mirror's local matrix under the world group, from a world (metres) matrix. Placed this
  // way it starts at real size whatever the world scale, then scales with the world after.
  _setMirrorWorld(main, world) {
    const wg = main._worldGroup;
    wg.updateWorldMatrix(true, false);
    this._mirror.matrix.copy(wg.matrixWorld).invert().multiply(world);
    this._mirror.matrixWorldNeedsUpdate = true;
    this._mirror.updateWorldMatrix(false, true);
  },

  // R = I - 2nn^T about the mirror's plane, read from where the mirror is NOW: it moves with
  // the world and with a grab.
  _updateReflection() {
    const e = this._mirrorWorld(_mw).elements;
    _c.set(e[12], e[13], e[14]);
    _n.set(e[8], e[9], e[10]).normalize();
    const n = _n, d = 2 * n.dot(_c);
    this._refl.set(
      1 - 2 * n.x * n.x, -2 * n.x * n.y, -2 * n.x * n.z, d * n.x,
      -2 * n.y * n.x, 1 - 2 * n.y * n.y, -2 * n.y * n.z, d * n.y,
      -2 * n.z * n.x, -2 * n.z * n.y, 1 - 2 * n.z * n.z, d * n.z,
      0, 0, 0, 1);
  },

  // A hand within GRAB_MARGIN of the frame (or inside it, near its plane).
  _nearFrame(handWorld) {
    _p.setFromMatrixPosition(handWorld);
    const e = this._mirrorWorld(_mw).elements;
    const sc = Math.hypot(e[0], e[1], e[2]) || 1;       // world-scale on the mirror
    _p.applyMatrix4(_m2.copy(_mw).invert());
    const g = GRAB_MARGIN / sc;
    return Math.abs(_p.x) < MIRROR_W / 2 + g && Math.abs(_p.y) < MIRROR_H / 2 + g && Math.abs(_p.z) < g;
  },

  _pokeButton(main, pose) {
    const now = performance.now();
    _p.copy(this._btn.position).applyMatrix4(this._mirrorWorld(_mw));
    let near = Infinity;
    for (const k of ['left', 'right']) {
      const m = pose && pose[k];
      if (!m) continue;
      near = Math.min(near, _s.setFromMatrixPosition(m).distanceTo(_p));
    }
    if (near > BTN_REARM) this._btnArmed = true;
    if (this._btnArmed && near < BTN_HIT && now > this._btnCooldown) {
      this._btnArmed = false;
      this._btnCooldown = now + 800;
      this.toggleRecord(main);
      window._animPanel?.syncFromState?.();
    }
  },

  // A null's world pose for replay, scaled by how much the MIRROR has been scaled since the take
  // (it scales with the world), so the headset and hands keep their size relative to the mirror.
  _nullPose(mesh) {
    this._worldOf(this._main, mesh, _m).decompose(_p, _q, _s);
    const k = this._mirrorScale();
    if (!mesh._perfRefScale) mesh._perfRefScale = k;   // a loaded take: assume today's mirror
    _s.setScalar(k / mesh._perfRefScale);
    return new THREE.Matrix4().compose(_p, _q, _s);
  },

  // A mesh's world matrix composed from the app's OWN local matrices (getModelSpaceMatrix) under
  // the world group -- never three's matrixWorld, which lags until a render. Reading the parent
  // through three put the first sample of every take out by exactly sqrt(3), the Performance
  // null's own scale: for that one tick its three matrix had not picked the scale up yet.
  _wgWorld(main) {
    const wg = main._worldGroup;
    wg.updateWorldMatrix(true, false);   // wg is the node that moves, so ITS flag is set
    return wg.matrixWorld;
  },
  _mirrorWorld(out) {
    return out.multiplyMatrices(this._wgWorld(this._main), this._mirror.matrix);
  },
  _worldOf(main, mesh, out) {
    return out.fromArray(mesh.getModelSpaceMatrix()).premultiply(this._wgWorld(main));
  },

  // Null local = inv(parent world) * pose, keeping the null's own scale: the world group's
  // scale would otherwise land in the matrix and the null would balloon or vanish.
  _drive(mesh, pose) {
    mesh._perfRefScale = this._mirrorScale();   // the mirror's scale when this was performed
    const parent = mesh._parentMesh;
    if (parent) this._worldOf(this._main, parent, _m).invert().multiply(pose);
    else _m.copy(this._wgWorld(this._main)).invert().multiply(pose);
    _m.decompose(_p, _q, _s);
    const own = mesh.getMatrix();
    _s.set(Math.hypot(own[0], own[1], own[2]), Math.hypot(own[4], own[5], own[6]),
      Math.hypot(own[8], own[9], own[10]));
    _m2.compose(_p, _q, _s);
    mat4.copy(own, _m2.elements);
    Skeleton.syncThree(mesh);
  },

  // The nulls if they are in the scene: the ones this session made, or a loaded file's, by name.
  _findNulls(main) {
    const meshes = main.getMeshes();
    const n = this._nulls;
    if (n && [n.root, n.head, n.left, n.right].every((m) => meshes.includes(m))) return n;
    const by = (label) => meshes.find((m) => m._isNull && m._permanentStaticLabel === label);
    const found = { root: by('Performance'), head: by('Perf Head'), left: by('Perf Hand L'), right: by('Perf Hand R') };
    this._nulls = (found.root && found.head && found.left && found.right) ? found : null;
    return this._nulls;
  },

  _ensureNulls(main) {
    const n = this._findNulls(main);
    if (n) return n;
    const make = (label) => {
      const m = main.buildNull();
      m._permanentStaticLabel = label;
      main.addNewMesh(m);
      main.decorateNull(m);
      return m;
    };
    const root = make('Performance');
    const out = { root, head: make('Perf Head'), left: make('Perf Hand L'), right: make('Perf Hand R') };
    for (const k of ['head', 'left', 'right']) {
      main.setMeshParent(out[k].getID(), root.getID(), { silent: true });
    }
    this._nulls = out;
    return out;
  },
};

window._mirrorCapture = MirrorCapture;
export default MirrorCapture;
