/**
 * VrRadialMenu — a worldspace pie/radial context menu for VR.
 *
 * Interaction (matches the agreed design):
 *   - Hold the dominant B button (Scene wires btns[5]) → the wheel spawns just
 *     above the controller and FREEZES in world space, facing the user.
 *   - Keep holding and move the controller; the DISPLACEMENT from where you
 *     pressed picks a sector (move right → right wedge, etc). A center dead-zone
 *     means "no selection" so you can back out.
 *   - Release B → run the highlighted command, or nothing if in the dead-zone.
 *
 * Rendered as a canvas-2D texture on a plane (NOT an HTML→SVG panel) so the
 * per-frame highlight repaint is cheap — the app's "continuous interaction =
 * canvas" rule. Commands are a plain list: { label, icon?, enabled?, run() }.
 *
 * Live tuning while in-headset via window._radial:
 *   { deadZone, radiusM, upOffset, camOffset }  (metres / metres of displacement)
 */

import * as THREE from 'three';

const CANVAS_PX = 512;

function tuning() {
  const t = (window._radial = window._radial || {});
  if (t.deadZone  == null) t.deadZone  = 0.03;  // m of controller displacement before a sector engages
  if (t.radiusM   == null) t.radiusM   = 0.12;  // world size of the wheel (half-extent)
  if (t.upOffset  == null) t.upOffset  = 0.05;  // m above the controller at spawn
  if (t.camOffset == null) t.camOffset = 0.04;  // m toward the user at spawn
  return t;
}

export class VrRadialMenu {
  constructor(scene3) {
    this._scene3 = scene3;

    this._canvas = document.createElement('canvas');
    this._canvas.width = this._canvas.height = CANVAS_PX;
    this._ctx = this._canvas.getContext('2d');

    this._tex = new THREE.CanvasTexture(this._canvas);
    this._tex.anisotropy = 4;
    const mat = new THREE.MeshBasicMaterial({ map: this._tex, transparent: true, depthTest: false, depthWrite: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    this.mesh.renderOrder = 10000; // draw over everything
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    scene3.add(this.mesh);

    this._commands = [];
    this._active = -1;       // highlighted sector, -1 = dead-zone/none
    this._open = false;
    this._bWasDown = false;

    this._p0 = new THREE.Vector3();     // controller pos at press (selection origin)
    this._camRight = new THREE.Vector3();
    this._camUp = new THREE.Vector3();
  }

  get isOpen() { return this._open; }

  // Called every XR frame for the dominant controller. bDown = B held,
  // cpos = [x,y,z] controller world pos, resolve() → command list (called on open).
  handleInput(bDown, cpos, resolve) {
    const pos = Array.isArray(cpos) ? new THREE.Vector3(cpos[0], cpos[1], cpos[2]) : cpos;
    if (bDown && !this._bWasDown) {
      const cmds = (resolve && resolve()) || [];
      if (cmds.length) this._openAt(pos, cmds);
    } else if (bDown && this._open) {
      this._updateSelection(pos);
    } else if (!bDown && this._bWasDown && this._open) {
      this._commit();
    }
    this._bWasDown = bDown;
  }

  _openAt(cpos, commands) {
    const cam = window.app?._camera?.getThreeCamera?.();
    if (!cam) return;
    const t = tuning();

    this._commands = commands;
    this._active = -1;
    this._p0.copy(cpos);

    // Camera basis for intuitive "move right → right wedge" mapping + billboard.
    cam.updateMatrixWorld();
    this._camRight.setFromMatrixColumn(cam.matrixWorld, 0).normalize();
    this._camUp.setFromMatrixColumn(cam.matrixWorld, 1).normalize();
    const toCam = new THREE.Vector3().subVectors(cam.position, cpos).normalize();

    // Float the wheel above the controller, nudged toward the user, facing the camera.
    this.mesh.position.copy(cpos)
      .addScaledVector(this._camUp, t.upOffset)
      .addScaledVector(toCam, t.camOffset);
    this.mesh.quaternion.copy(cam.quaternion);
    const d = t.radiusM * 2;
    this.mesh.scale.set(d, d, 1);

    this._open = true;
    this.mesh.visible = true;
    this._draw();
  }

  _updateSelection(cpos) {
    const t = tuning();
    const d = new THREE.Vector3().subVectors(cpos, this._p0);
    const dx = d.dot(this._camRight);
    const dy = d.dot(this._camUp);
    const dist = Math.hypot(dx, dy);

    let active = -1;
    if (dist >= t.deadZone && this._commands.length) {
      active = this._sectorAt(dx, dy, this._commands.length);
    }
    if (active !== this._active) {
      this._active = active;
      this._draw();
    }
  }

  // Sector 0 at 12 o'clock, increasing clockwise. Shared by hit + draw.
  _sectorAt(dx, dy, n) {
    // atan2(dx, dy): 0 at top, +clockwise.
    let a = Math.atan2(dx, dy);
    if (a < 0) a += Math.PI * 2;
    return Math.floor((a + Math.PI / n) / (Math.PI * 2 / n)) % n;
  }

  _commit() {
    const cmd = this._active >= 0 ? this._commands[this._active] : null;
    this.close();
    if (cmd && cmd.enabled !== false) {
      try { cmd.run?.(); } catch (e) { console.error('[VrRadial] command failed', e); }
    }
  }

  close() {
    this._open = false;
    this._active = -1;
    if (this.mesh) this.mesh.visible = false;
  }

  _draw() {
    const ctx = this._ctx;
    const n = this._commands.length;
    const S = CANVAS_PX, C = S / 2;
    const rOuter = S * 0.47, rInner = S * 0.20;
    ctx.clearRect(0, 0, S, S);
    if (!n) { this._tex.needsUpdate = true; return; }

    const seg = (Math.PI * 2) / n;
    for (let i = 0; i < n; i++) {
      // Sector i is centered at the top-going-clockwise position; -90° puts 0 at 12 o'clock.
      const mid = i * seg - Math.PI / 2;
      const a0 = mid - seg / 2, a1 = mid + seg / 2;
      const on = i === this._active;
      ctx.beginPath();
      ctx.arc(C, C, rOuter, a0, a1);
      ctx.arc(C, C, rInner, a1, a0, true);
      ctx.closePath();
      ctx.fillStyle = on ? 'rgba(137,180,250,0.92)' : 'rgba(30,30,46,0.82)';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(180,190,210,0.35)';
      ctx.stroke();

      // Label at the sector mid-radius.
      const rL = (rOuter + rInner) / 2;
      const lx = C + Math.cos(mid) * rL, ly = C + Math.sin(mid) * rL;
      ctx.fillStyle = on ? '#11111b' : '#cdd6f4';
      ctx.font = `${on ? 700 : 600} 30px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const cmd = this._commands[i];
      ctx.globalAlpha = cmd.enabled === false ? 0.4 : 1;
      ctx.fillText(cmd.label ?? '', lx, ly);
      ctx.globalAlpha = 1;
    }

    // Center dead-zone / cancel hint.
    ctx.beginPath();
    ctx.arc(C, C, rInner - 3, 0, Math.PI * 2);
    ctx.fillStyle = this._active < 0 ? 'rgba(243,139,168,0.30)' : 'rgba(20,20,30,0.85)';
    ctx.fill();
    ctx.fillStyle = '#6c7086';
    ctx.font = '600 26px system-ui, sans-serif';
    ctx.fillText('cancel', C, C);

    this._tex.needsUpdate = true;
  }
}
