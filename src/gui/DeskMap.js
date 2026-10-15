import * as THREE from 'three';

// DESK SCULPT MAP: a top-down plan of what the app believes the desk looks like -- the headset
// lying on the desk, the desk camera and its field of view, the controllers, and the sculpt.
//
// Calibrating the desk camera against the view alone is adjusting against a black void while the
// thing you are moving is also the thing you are looking through, and the controllers are pinned
// to your real hands. The plan is the fixed frame of reference that view lacks.
//
// Drawn on its own 2D canvas over the desktop canvas, so it costs no scene pass and touches no
// renderer state inside the XR frame. Turned so the camera looks UP the map: you sit behind the
// camera, so left and right on the map are left and right on the monitor.
//
// IT IS ALSO A CONTROL (matt: "it would be good if the user could directly click on it to move
// things around, esp drag to pan"). Drag the camera dot or empty map to slide the camera over the
// floor, drag the ring at the end of its view line to turn it, drag the sculpt circle to move the
// sculpt, and scroll over the map to raise or lower the camera -- height being the one axis a plan
// cannot show. The plan's framing is FROZEN for the length of a drag; it re-fits itself to what it
// shows every frame, and re-fitting under the cursor would make every drag fight itself.

const SIZE = 240;          // CSS px
const PAD = 22;

const _v = new THREE.Vector3();
const _f = new THREE.Vector3();

function yawOf(m) {
  // Forward (-Z) projected onto the floor.
  _f.set(-m.elements[8], 0, -m.elements[10]);
  return Math.atan2(_f.x, -_f.z);
}

export default class DeskMap {
  constructor() {
    this._el = null;
    this._ctx = null;
    this._bboxTick = 0;
    this._sculptR = 0;
    this._drag = null;    // { what, frame, last: [px, py] }
    this._hit = null;     // screen positions from the last draw, for picking
  }

  // Plan pixels -> a floor-plane world delta (x, z), through the given frame.
  static _toWorld(f, dpx, dpy) {
    const x = dpx / f.k, y = dpy / f.k, c = Math.cos(f.yaw), s = Math.sin(f.yaw);
    return [x * c - y * s, x * s + y * c];
  }

  _local(e) {
    const r = this._el.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  _pick(p) {
    const h = this._hit;
    if (!h) return 'camera';
    const d = (q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (d(h.handle) < 10) return 'turn';
    if (d(h.cam) < 10) return 'camera';
    if (d(h.sculpt) < Math.max(10, h.sculptR)) return 'sculpt';
    return 'camera';
  }

  _onDown(e) {
    if (!this._frame || !this._cam) return;
    e.preventDefault(); e.stopPropagation();
    const p = this._local(e);
    this._drag = { what: this._pick(p), frame: { ...this._frame }, last: p };
    this._el.setPointerCapture?.(e.pointerId);
    this._el.style.cursor = 'grabbing';
  }

  _onMove(e) {
    const p = this._local(e);
    const dr = this._drag;
    if (!dr) {
      const w = this._pick(p);
      this._el.style.cursor = w === 'turn' ? 'crosshair' : 'grab';
      return;
    }
    e.preventDefault(); e.stopPropagation();
    const f = dr.frame, cam = this._cam;
    if (dr.what === 'turn') {
      // Aim the camera's heading at the cursor, keeping its tilt: a turn about world up.
      const c = this._hit.cam;
      const want = Math.atan2(p[0] - c[0], -(p[1] - c[1]));          // plan angle, 0 = up
      const prev = Math.atan2(dr.last[0] - c[0], -(dr.last[1] - c[1]));
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -(want - prev));
      cam.quaternion.premultiply(q).normalize();
    } else {
      const [dx, dz] = DeskMap._toWorld(f, p[0] - dr.last[0], p[1] - dr.last[1]);
      if (dr.what === 'sculpt') this._main.moveWorld?.([dx, 0, dz]);
      else { cam.position.x += dx; cam.position.z += dz; }
    }
    dr.last = p;
  }

  _onUp(e) {
    if (!this._drag) return;
    this._drag = null;
    this._el.releasePointerCapture?.(e.pointerId);
    this._el.style.cursor = 'grab';
  }

  _onWheel(e) {
    if (!this._cam) return;
    e.preventDefault(); e.stopPropagation();
    this._cam.position.y += (e.deltaY < 0 ? 1 : -1) * 0.01;   // 1 cm a notch
  }

  _ensure() {
    if (this._el) return;
    const el = this._el = document.createElement('canvas');
    const dpr = window.devicePixelRatio || 1;
    el.width = SIZE * dpr; el.height = SIZE * dpr;
    Object.assign(el.style, {
      position: 'fixed', left: '12px', bottom: '12px', width: SIZE + 'px', height: SIZE + 'px',
      background: 'rgba(17,17,27,0.82)', border: '1px solid #45475a', borderRadius: '6px',
      pointerEvents: 'auto', cursor: 'grab', zIndex: 50, touchAction: 'none',
    });
    el.addEventListener('pointerdown', (e) => this._onDown(e));
    el.addEventListener('pointermove', (e) => this._onMove(e));
    el.addEventListener('pointerup', (e) => this._onUp(e));
    el.addEventListener('pointercancel', (e) => this._onUp(e));
    el.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    document.body.appendChild(el);
    this._ctx = el.getContext('2d');
    this._ctx.scale(dpr, dpr);
  }

  hide() { if (this._el) this._el.style.display = 'none'; }

  // THE NUDGE TIMER. A Quest left still on a desk switches itself off after a few minutes of no
  // motion, and nothing says how long it has been. Counts up from the headset's last movement;
  // amber at 15 s, red at 25 s -- matt's Quest 3 turns off at about 30. Its own element, so it shows
  // with the map turned off.
  drawTimer(sec, mapShown) {
    let t = this._timer;
    if (!t) {
      t = this._timer = document.createElement('div');
      Object.assign(t.style, {
        position: 'fixed', left: '12px', padding: '4px 8px', borderRadius: '6px',
        font: '12px sans-serif', pointerEvents: 'none', zIndex: 50, border: '1px solid #45475a',
      });
      document.body.appendChild(t);
    }
    t.style.display = '';
    t.style.bottom = (mapShown ? SIZE + 18 : 12) + 'px';
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    const clock = m + ':' + String(s).padStart(2, '0');
    const warn = sec >= 25 ? 2 : sec >= 15 ? 1 : 0;
    t.textContent = warn === 2 ? `Headset still ${clock} - nudge it!` : `Headset still ${clock}`;
    t.style.background = ['rgba(17,17,27,0.82)', 'rgba(250,179,135,0.9)', 'rgba(243,139,168,0.95)'][warn];
    t.style.color = warn ? '#11111b' : '#cdd6f4';
    t.style.fontWeight = warn ? 'bold' : 'normal';
  }

  hideTimer() { if (this._timer) this._timer.style.display = 'none'; }

  // WHERE THE SCULPT IS, when it is not on screen: an arrow at the edge of the view pointing at
  // it, with how far. Above/below was the hard thing to read from the plan (matt), and an arrow
  // answers it without the plan. Hidden while the sculpt is on screen.
  drawArrow(main, cam) {
    const sp = new THREE.Vector3().fromArray(main._desktopCameraCache.center)
      .applyMatrix4(main._worldGroup.matrixWorld);
    const v = sp.clone().applyMatrix4(cam.matrixWorldInverse);   // camera space: -Z is ahead
    const ahead = v.z < 0;
    const tanY = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2), tanX = tanY * cam.aspect;
    const nx = ahead ? (v.x / -v.z) / tanX : 0, ny = ahead ? (v.y / -v.z) / tanY : 0;
    let a = this._arrow;
    if (ahead && Math.abs(nx) < 0.92 && Math.abs(ny) < 0.92) { if (a) a.style.display = 'none'; return; }
    // A 2D CANVAS, like the map: an inline SVG and a styled span here were both overridden by
    // the page CSS (no arrow, grey text). Canvas drawing has no cascade.
    const W = 230, Hh = 90, dpr = window.devicePixelRatio || 1;
    if (!a) {
      a = this._arrow = document.createElement('canvas');
      a.width = W * dpr; a.height = Hh * dpr;
      Object.assign(a.style, { position: 'fixed', width: W + 'px', height: Hh + 'px', pointerEvents: 'none', zIndex: 50 });
      a.getContext('2d').scale(dpr, dpr);
      document.body.appendChild(a);
    }
    a.style.display = '';
    // Screen direction (y down). In camera space x is right and y is up, ahead or behind.
    let dx = v.x, dy = -v.y;
    const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
    const r = main._renderer.domElement.getBoundingClientRect();
    const hw = r.width / 2 - 75, hh = r.height / 2 - 50;   // room for the label
    const t = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
    a.style.left = (r.left + r.width / 2 + dx * t - W / 2) + 'px';
    a.style.top = (r.top + r.height / 2 + dy * t - Hh / 2) + 'px';

    const ctx = a.getContext('2d');
    ctx.clearRect(0, 0, W, Hh);
    ctx.save();
    ctx.translate(W / 2, Hh / 2); ctx.rotate(Math.atan2(dx, -dy));
    ctx.beginPath(); ctx.moveTo(0, -18); ctx.lineTo(13, 7); ctx.lineTo(0, 1); ctx.lineTo(-13, 7); ctx.closePath();
    ctx.fillStyle = '#a6e3a1'; ctx.strokeStyle = '#11111b'; ctx.lineWidth = 2;
    ctx.fill(); ctx.stroke();
    ctx.restore();
    const dist = sp.distanceTo(new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld));
    const up = sp.y - new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld).y;
    const lines = [`sculpt ${Math.abs(up).toFixed(2)} m ${up >= 0 ? 'above' : 'below'}`,
      `${dist.toFixed(2)} m away${ahead ? '' : ', behind'}`];
    ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
    const ty = dy > 0.5 ? 11 : Hh - 17;   // the label on the side away from the screen edge
    lines.forEach((l, i) => {
      ctx.lineWidth = 3; ctx.strokeStyle = '#11111b'; ctx.strokeText(l, W / 2, ty + i * 13);
      ctx.fillStyle = '#a6e3a1'; ctx.fillText(l, W / 2, ty + i * 13);
    });
  }

  hideArrow() { if (this._arrow) this._arrow.style.display = 'none'; }

  // main: the Scene. head: three's XR camera (the headset on the desk). cam: the desk camera.
  draw(main, head, cam) {
    this._ensure();
    this._el.style.display = '';
    const ctx = this._ctx;
    ctx.clearRect(0, 0, SIZE, SIZE);
    this._main = main; this._cam = cam;

    const hp = new THREE.Vector3().setFromMatrixPosition(head.matrixWorld);
    const cp = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
    const grips = [
      ['L', main._vrControllerLeftGrip, '#89b4fa'],
      ['R', main._vrControllerRightGrip, '#f38ba8'],
    ].filter(([, g]) => g && g.visible !== false);

    // The sculpt: the desktop pivot as it sits in VR now, with a radius refreshed now and then.
    const wg = main._worldGroup;
    const sp = new THREE.Vector3().fromArray(main._desktopCameraCache.center).applyMatrix4(wg.matrixWorld);
    if (this._bboxTick++ % 30 === 0) {
      const bb = main.computeBoundingBoxScene?.();
      if (bb && Number.isFinite(bb[0])) {
        this._sculptR = 0.5 * Math.hypot(bb[3] - bb[0], bb[4] - bb[1], bb[5] - bb[2]) * wg.scale.x;
      }
    }

    // Plan frame: centred between headset and camera, turned so the camera looks up -- or, mid
    // drag, the frame the drag started in.
    const fr = this._drag ? this._drag.frame : null;
    const yaw = fr ? fr.yaw : yawOf(cam.matrixWorld);
    const cx = fr ? fr.cx : (hp.x + cp.x) / 2, cz = fr ? fr.cz : (hp.z + cp.z) / 2;
    const toPlan = (p) => {
      const dx = p.x - cx, dz = p.z - cz;
      const c = Math.cos(yaw), s = Math.sin(yaw);
      return [dx * c + dz * s, -dx * s + dz * c];   // x right, y = towards the viewer
    };
    const pts = [hp, cp, sp, ...grips.map(([, g]) => g.getWorldPosition(_v).clone())].map(toPlan);
    let ext = 0.4;
    for (const [x, y] of pts) ext = Math.max(ext, Math.abs(x), Math.abs(y));
    ext = Math.max(ext, this._sculptR) + 0.1;
    const k = fr ? fr.k : (SIZE / 2 - PAD) / ext;
    this._frame = { cx, cz, yaw, k };
    const X = (p) => SIZE / 2 + p[0] * k, Y = (p) => SIZE / 2 + p[1] * k;
    const dirPlan = (m) => {
      const a = yawOf(m) - yaw;
      return [Math.sin(a), -Math.cos(a)];
    };

    // 10 cm grid
    ctx.strokeStyle = 'rgba(108,112,134,0.18)'; ctx.lineWidth = 1;
    const step = 0.1 * k;
    for (let g = (SIZE / 2) % step; g < SIZE; g += step) {
      ctx.beginPath(); ctx.moveTo(g, 0); ctx.lineTo(g, SIZE); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, g); ctx.lineTo(SIZE, g); ctx.stroke();
    }

    // Camera field of view, out to a little past the sculpt.
    const c2 = toPlan(cp);
    const hfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * cam.aspect);
    const reach = (cp.distanceTo(sp) + this._sculptR + 0.2) * k;
    ctx.fillStyle = 'rgba(249,226,175,0.10)'; ctx.strokeStyle = 'rgba(249,226,175,0.55)';
    const ca = yawOf(cam.matrixWorld) - yaw;   // 0 except while a drag is turning it
    ctx.beginPath(); ctx.moveTo(X(c2), Y(c2));
    ctx.lineTo(X(c2) + Math.sin(ca - hfov / 2) * reach, Y(c2) - Math.cos(ca - hfov / 2) * reach);
    ctx.lineTo(X(c2) + Math.sin(ca + hfov / 2) * reach, Y(c2) - Math.cos(ca + hfov / 2) * reach);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // The turn handle: a ring at the end of the view line.
    const hx = X(c2) + Math.sin(ca) * 34, hy = Y(c2) - Math.cos(ca) * 34;
    ctx.strokeStyle = '#f9e2af'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(X(c2), Y(c2)); ctx.lineTo(hx, hy); ctx.stroke();
    ctx.beginPath(); ctx.arc(hx, hy, 6, 0, Math.PI * 2); ctx.stroke();

    // Sculpt
    const s2 = toPlan(sp);
    ctx.strokeStyle = '#a6e3a1'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(X(s2), Y(s2), Math.max(3, this._sculptR * k), 0, Math.PI * 2); ctx.stroke();
    this._hit = { cam: [X(c2), Y(c2)], handle: [hx, hy], sculpt: [X(s2), Y(s2)], sculptR: this._sculptR * k };

    // Headset: a box with its facing direction.
    const h2 = toPlan(hp), hd = dirPlan(head.matrixWorld);
    ctx.save(); ctx.translate(X(h2), Y(h2)); ctx.rotate(Math.atan2(hd[0], -hd[1]));
    ctx.fillStyle = '#cdd6f4'; ctx.fillRect(-0.09 * k, -0.05 * k, 0.18 * k, 0.1 * k);
    ctx.strokeStyle = '#cdd6f4'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -0.05 * k); ctx.lineTo(0, -0.16 * k); ctx.stroke();
    ctx.restore();

    // Controllers, each with the way it points.
    for (const [lbl, g, col] of grips) {
      g.getWorldPosition(_v);
      const p = toPlan(_v), d = dirPlan(g.matrixWorld);
      ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(X(p), Y(p), 4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(X(p), Y(p)); ctx.lineTo(X(p) + d[0] * 14, Y(p) + d[1] * 14); ctx.stroke();
      ctx.font = '10px sans-serif'; ctx.fillText(lbl, X(p) + 6, Y(p) - 6);
    }

    // HEIGHT GAUGE down the right edge: what a plan cannot show. The sculpt's vertical extent as
    // a green bar, the headset as a white tick, the camera as a yellow wedge pointing the way it
    // tilts, all on one vertical scale.
    {
      const gx = SIZE - 16, top = 40, bot = SIZE - 26;
      const ys = [cp.y, hp.y, sp.y - this._sculptR, sp.y + this._sculptR];
      let lo = Math.min(...ys) - 0.05, hi = Math.max(...ys) + 0.05;
      const gy = (y) => bot - (y - lo) / (hi - lo) * (bot - top);
      ctx.strokeStyle = 'rgba(205,214,244,0.25)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(gx, top); ctx.lineTo(gx, bot); ctx.stroke();
      ctx.fillStyle = 'rgba(166,227,161,0.45)';
      ctx.fillRect(gx - 4, gy(sp.y + this._sculptR), 8, Math.max(2, gy(sp.y - this._sculptR) - gy(sp.y + this._sculptR)));
      ctx.strokeStyle = '#cdd6f4'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(gx - 6, gy(hp.y)); ctx.lineTo(gx + 6, gy(hp.y)); ctx.stroke();
      const pt = Math.asin(Math.max(-1, Math.min(1, -cam.matrixWorld.elements[9])));   // + = looking up
      const cy = gy(cp.y);
      ctx.fillStyle = '#f9e2af';
      ctx.beginPath(); ctx.moveTo(gx - 10, cy);
      ctx.lineTo(gx - 10 - 9 * Math.cos(pt - 0.4), cy - 9 * Math.sin(pt - 0.4));   // canvas y is down
      ctx.lineTo(gx - 10 - 9 * Math.cos(pt + 0.4), cy - 9 * Math.sin(pt + 0.4));
      ctx.closePath(); ctx.fill();
      const above = cp.y - sp.y;
      ctx.fillStyle = '#f9e2af'; ctx.font = '10px sans-serif'; ctx.textAlign = 'right';
      ctx.fillText(`${above >= 0 ? '+' : ''}${above.toFixed(2)}`, gx - 22, cy + 3);
      ctx.textAlign = 'left';
    }

    // Camera last, on top.
    ctx.fillStyle = '#f9e2af';
    ctx.beginPath(); ctx.arc(X(c2), Y(c2), 5, 0, Math.PI * 2); ctx.fill();

    // Height and tilt are what a plan cannot show, so they are printed.
    const fwdY = -cam.matrixWorld.elements[9];
    const pitch = THREE.MathUtils.radToDeg(Math.asin(Math.max(-1, Math.min(1, fwdY))));
    ctx.fillStyle = '#cdd6f4'; ctx.font = '11px sans-serif';
    ctx.fillText(`cam ${(cp.y - hp.y >= 0 ? '+' : '')}${(cp.y - hp.y).toFixed(2)} m vs headset, pitch ${pitch.toFixed(0)}°`, 8, SIZE - 8);
    ctx.fillText(`${(0.1).toFixed(1)} m grid`, 8, 14);
    ctx.fillStyle = 'rgba(205,214,244,0.55)'; ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('drag: move \u00b7 ring: turn \u00b7 wheel: height', SIZE - 8, 27);
    ctx.textAlign = 'left';
    if (main._isCalibratingSpectator) {
      ctx.fillStyle = '#f9e2af'; ctx.font = 'bold 11px sans-serif';
      ctx.fillText('MOVE ME (C) - grip moves the camera', 8, 41);
    }
  }
}
