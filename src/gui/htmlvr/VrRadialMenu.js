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

// Nothing may be clipped, so a label that does not fit its wedge wraps and then shrinks -- but
// only to here. Past this it is unreadable, and a wedge whose label cannot be read at all is
// better served by a shorter label than by smaller type.
const LABEL_MIN_PX = 13;
const CENTER_PX = 17;

// How wide a horizontal label may be inside a wedge. A wedge is a RING SEGMENT, so the usable
// width is the CHORD across it at the label's radius -- the ARC is always longer than the
// straight line it subtends, so measuring that says there is room where there is not, and the
// text runs past the edges. Capped by the ring's depth as well, for the two- and three-wedge
// cases where the chord is enormous and a long label would spill over the rims instead.
function wedgeWidth(rL, seg, ringDepth) {
  const chord = 2 * rL * Math.sin(Math.min(seg, Math.PI) / 2);
  return Math.min(chord, ringDepth * 2.6) * 0.84;
}

// Lay a label out inside its wedge: the widest it may draw is the CHORD across the wedge at the
// label's radius, which is what actually clips. Tries the full string, then a wrap at a space,
// then shrinks -- in that order, because a smaller whole word beats a broken one.
function fitLabel(ctx, text, maxW, basePx) {
  const font = (px, bold) => `${bold ? 700 : 600} ${px}px system-ui, sans-serif`;
  for (let px = basePx; px >= LABEL_MIN_PX; px -= 1) {
    ctx.font = font(px, false);
    if (ctx.measureText(text).width <= maxW) return { px: px, lines: [text] };
    // Two lines, split where the WIDEST line comes out narrowest -- that is the measure that
    // decides whether it fits, not evenness. Splitting at the first space turns "Set Parent To"
    // into one short line and one that still does not fit.
    const parts = text.split(' ');
    if (parts.length > 1) {
      let best = null;
      for (let k = 1; k < parts.length; k++) {
        const a = parts.slice(0, k).join(' '), b = parts.slice(k).join(' ');
        const w = Math.max(ctx.measureText(a).width, ctx.measureText(b).width);
        if (w <= maxW && (!best || w < best.w)) best = { w: w, lines: [a, b] };
      }
      if (best) return { px: px, lines: best.lines };
    }
  }
  return { px: LABEL_MIN_PX, lines: [text] };
}

function tuning() {
  const t = (window._radial = window._radial || {});
  if (t.deadZone  == null) t.deadZone  = 0.03;  // m of controller displacement before a sector engages
  // Smaller than it was (0.12), which the smaller type paid for: at the old size the wheel
  // filled the view and still clipped its own labels.
  if (t.radiusM   == null) t.radiusM   = 0.085; // world size of the wheel (half-extent)
  // TYPE SIZE IN CANVAS PIXELS, matched to the bone-name labels rather than picked by eye: a
  // label is a 34px glyph on a 64px-tall sprite (Skeleton's LABEL_FONT / LABEL_H), so the glyph
  // is 0.53 of the sprite's world height. Getting the wheel's text to READ the same size is
  // what let the wheel itself shrink -- matt: "the text labels for bone names is quite
  // readable, go for the same size, meaning we can make the marking menu much smaller."
  //
  // Kept as a literal HERE and not as a module constant, because tuning() is lifted and run on
  // its own by the harness; a reference to anything outside it fails there for a reason that
  // has nothing to do with the setting.
  if (t.labelPx   == null) t.labelPx   = 22;
  // THE WHEEL IS CENTRED ON THE HAND, because that is the origin the movement is measured
  // FROM. It used to float 5cm up, which put the visual centre somewhere the selection origin
  // was not: to hit the top sector you pushed up from a point below the middle of a wheel that
  // already looked like it was above your hand. matt: "doesn't feel aligned with my
  // controller." Only the toward-camera nudge survives, and that one is along the view axis so
  // it does not move anything in the plane you are aiming in.
  if (t.upOffset  == null) t.upOffset  = 0.0;
  if (t.camOffset == null) t.camOffset = 0.04;  // m toward the user at spawn
  if (t.showNeedle == null) t.showNeedle = true;
  // HOW BIG THE WHEEL LOOKS AND HOW FAR YOU MOVE ARE DIFFERENT NUMBERS.
  //
  // `radiusM` is the wheel's world size. It was doing double duty as the displacement that
  // reaches the rim, which put the rim 12cm of hand movement away while a sector armed at 3cm —
  // so pushing out to a submenu meant a deliberate 14cm shove nobody would find. matt: "i
  // shouldn't have to press B again to bring up the name options." He was pushing out, just not
  // four times further than selecting takes.
  //
  // `reachM` is that second number, and everything about the MAPPING now uses it: the needle,
  // the dead-zone ring, and the push-out. The rim is a comfortable flick past a selection.
  if (t.reachM == null) t.reachM = 0.07;
  // Where the submenu opens, in units of reachM. 1.0 = exactly at the rim, which is what the
  // needle touching the edge shows you.
  if (t.subRadius == null) t.subRadius = 1.0;
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
    this._pNow = new THREE.Vector3();   // live controller pos — where a submenu reopens
    this._isSub = false;                // depth guard: submenus do not nest
    this._pending = null;               // submenu list waiting for the next press
    this._nx = 0; this._ny = 0;         // live displacement, wheel radii, for the needle
    // THE DISK'S OWN AXES, read back off the mesh after it is placed — see _openAt.
    this._axX = new THREE.Vector3();
    this._axY = new THREE.Vector3();
    this._qTmp = new THREE.Quaternion();
    this._qPar = new THREE.Quaternion();
  }

  get isOpen() { return this._open; }

  // Called every XR frame for the dominant controller. bDown = B held,
  // cpos = [x,y,z] controller world pos, resolve() → command list (called on open).
  handleInput(bDown, cpos, resolve) {
    const pos = Array.isArray(cpos) ? new THREE.Vector3(cpos[0], cpos[1], cpos[2]) : cpos;
    if (bDown && !this._bWasDown) {
      this._pNow.copy(pos);
      // A SUBMENU IS TAKEN BY THE NEXT PRESS, not opened on the release that chose it.
      //
      // The gesture is hold -> drag -> release. Reopening the wheel ON the release left it with
      // no held button to drive: dragging did nothing, and the next press ran the root resolver
      // and replaced it. matt: "i can't select any options... pressing B goes back to the
      // original menu." So the submenu waits, and the next press opens IT — the same gesture
      // twice, rather than a second gesture nobody was told about.
      const pend = this._pending;
      this._pending = null;
      const cmds = pend || (resolve && resolve()) || [];
      this._isSub = !!pend;
      if (cmds.length) this._openAt(pos, cmds);
    } else if (bDown && this._open) {
      this._pNow.copy(pos);
      this._updateSelection(pos);
    } else if (!bDown && this._bWasDown && this._open) {
      this._commit();
    }
    this._bWasDown = bDown;
  }

  // Is a submenu waiting for the next press? Scene reads this to say so on screen.
  get hasPending() { return !!this._pending; }

  // THE CAMERA THE USER IS ACTUALLY LOOKING THROUGH.
  //
  // `app._camera.getThreeCamera()` is the app's BASE camera, and Camera.js keeps writing its
  // own orbit matrices to it every frame even during a session (the spectator modes depend on
  // that). So in XR it carries the desktop view, not the head — and a wheel faced with it comes
  // out consistently askew rather than randomly wrong. matt: "always tilted about 30 degrees
  // away from me to the right." The XR camera is the head.
  _viewCamera() {
    const app = window.app;
    const xr = app?._renderer?.xr;
    if (app?._xrSession && xr?.getCamera) {
      const c = xr.getCamera(app._camera?.getThreeCamera?.());
      // The ArrayCamera itself is the head; its sub-cameras are the eyes.
      if (c) return c;
    }
    return app?._camera?.getThreeCamera?.() || null;
  }

  _openAt(cpos, commands) {
    const cam = this._viewCamera();
    if (!cam) return;
    const t = tuning();

    this._commands = commands;
    this._pNow.copy(cpos);
    this._active = -1;
    this._p0.copy(cpos);
    // The ROOT ring opens under a hand that is at the origin by definition, so it arms at once;
    // the push-out below is what sets the gate. Cleared here rather than left standing, so a
    // fresh gesture never inherits the previous one's wait.
    this._needRecentre = false;

    // ONE FRAME FOR BOTH THE DRAWING AND THE PICK, and it is the DISK'S.
    //
    // This used to orient the wheel from `cam.quaternion` — the camera's LOCAL rotation — while
    // measuring the hand against `cam.matrixWorld` columns, which are WORLD axes. Those agree
    // only when the camera has no parent transform, and in XR (and in the spectator modes that
    // hack the camera matrices) it does. So the needle and the wedges were reading two
    // different frames, and the mapping came out right or mirrored depending on which. matt:
    // "the needle direction either goes in the same or opposite direction of the controller."
    //
    // Now: face the wheel at the viewer using the camera's WORLD orientation, expressed in
    // whatever space the mesh's parent is in, then read the axes BACK OFF THE PLACED MESH. The
    // frame the hand is measured in is by construction the frame that was drawn — they cannot
    // disagree again, whatever the camera or the parent is doing.
    //
    // Measuring against the disk's own axes is a CYLINDRICAL extrusion of the wheel: how far
    // along the disk you are, ignoring how far in front of or behind it you have reached. Fixed
    // at open, so turning your head mid-gesture does not slide the mapping under your hand —
    // which a viewer-relative projection would.
    cam.updateMatrixWorld();
    cam.getWorldQuaternion(this._qTmp);
    const toCam = new THREE.Vector3().subVectors(cam.position, cpos).normalize();

    this.mesh.position.copy(cpos)
      .addScaledVector(toCam, t.camOffset);
    if (this.mesh.parent && this.mesh.parent.getWorldQuaternion) {
      this.mesh.parent.getWorldQuaternion(this._qPar);
      this.mesh.quaternion.copy(this._qPar.invert()).multiply(this._qTmp);
    } else {
      this.mesh.quaternion.copy(this._qTmp);
    }
    const d = t.radiusM * 2;
    this.mesh.scale.set(d, d, 1);

    this._open = true;
    this.mesh.visible = true;
    // Read the axes back off the placed mesh. Scale rides in the matrix, so normalise.
    this.mesh.updateMatrixWorld(true);
    this._axX.setFromMatrixColumn(this.mesh.matrixWorld, 0).normalize();
    this._axY.setFromMatrixColumn(this.mesh.matrixWorld, 1).normalize();
    this._nx = this._ny = 0;
    this._draw();
  }

  _updateSelection(cpos) {
    const t = tuning();
    const d = new THREE.Vector3().subVectors(cpos, this._p0);
    const dx = d.dot(this._axX);
    const dy = d.dot(this._axY);
    const dist = Math.hypot(dx, dy);

    // The re-arm gate. Held out from the previous level, the hand has to return to the middle
    // before this ring will select anything -- otherwise the push-out that opened it is still
    // being made and would choose again instantly.
    if (this._needRecentre) {
      if (dist < t.deadZone) this._needRecentre = false;
      else {
        // Still show where the hand is, so the ring does not look frozen while it waits.
        const nx0 = dx / t.reachM, ny0 = dy / t.reachM;
        if (this._active !== -1 || Math.abs(nx0 - this._nx) > 0.01
            || Math.abs(ny0 - this._ny) > 0.01) {
          this._active = -1;
          this._nx = nx0; this._ny = ny0;
          this._draw();
        }
        return;
      }
    }

    let active = -1;
    if (dist >= t.deadZone && this._commands.length) {
      active = this._sectorAt(dx, dy, this._commands.length);
    }

    // PUSH OUT PAST THE RIM TO OPEN A SUBMENU, WITHOUT LETTING GO.
    //
    // matt: "as soon as i choose the name option in the first menu, it should display the next
    // marking menu." Right — and waiting for a second press was the compromise I made when
    // reopening on the release did not work. A radial's own idiom is better: keep dragging
    // outward and the child ring takes over, which is one continuous gesture and needs nothing
    // explaining.
    //
    // EVERY RING OPENS WHERE THE FIRST ONE DID. Re-origining at the crossing point meant each
    // level appeared wherever your hand had pushed to, so a three-deep chain walked across the
    // room — matt: "the next menu appears higher, I choose centre names, the menu drifts to the
    // left, choose limbs, it drifts further left." Chasing a menu is not a gesture.
    //
    // So the wheel STAYS PUT and you come back to the middle to choose again. That costs a
    // return stroke and buys a fixed target: one place to look, one origin, and a chain of any
    // depth that never moves. It also makes the gesture self-limiting in the right way — see
    // the re-arm rule in _openAt.
    //
    // ANY LEVEL, not just the first. This used to stop after one, on the reasoning that a menu
    // tree in mid-air is what a radial exists to avoid — but a push-out REPLACES the ring
    // rather than stacking one, so there is no tree and no back button to want. Capping it left
    // the "limbs.../spine..." swap drawing chevrons that did nothing, which is worse than
    // either choice: matt, "there's often one to the left, but it doesn't do anything."
    if (active >= 0 && dist >= t.reachM * t.subRadius) {
      const cmd = this._commands[active];
      const sub = cmd && cmd.enabled !== false && typeof cmd.sub === 'function' ? cmd.sub() : null;
      if (sub && sub.length) {
        this._isSub = true;
        // Anchored at the ORIGINAL origin, not at cpos. `_p0` is where the first ring opened
        // and has not moved since.
        this._openAt(this._p0, sub);
        // STEP IN BEFORE YOU CAN STEP OUT. The hand is still held out past the rim -- that is
        // what just opened this ring -- so arming now would select the sector it is already
        // sitting in and push straight out of that too: one flick would fall through every
        // level of a chain in a single frame. matt's rule: "they have to step in to step out
        // again." Set AFTER _openAt, which clears it for the root case.
        this._needRecentre = true;
        return;
      }
    }
    // SHOW WHERE THE HAND IS, not just which wedge won. Without a needle the mapping from
    // "move the controller" to "this wedge lights" is something you have to infer from the
    // result, and when it is even slightly off there is nothing on screen to say so — which is
    // how a 5cm offset went unexplained. matt: "the 'drag controller into a sector' isn't
    // clear". Quantised to a hundredth of a radius so a still hand does not repaint the canvas
    // every frame; a moving one costs one 512px upload, which is what canvas-2D is here for.
    const nx = dx / t.reachM, ny = dy / t.reachM;
    const moved = Math.abs(nx - this._nx) > 0.01 || Math.abs(ny - this._ny) > 0.01;
    if (active !== this._active || moved) {
      this._active = active;
      this._nx = nx; this._ny = ny;
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

  // A SUBMENU IS A COMMAND THAT RETURNS A COMMAND LIST.
  //
  // `run()` returning an array reopens the wheel on that list instead of closing — so a nested
  // choice is two flicks of one gesture rather than a second trip to a panel. It reopens at the
  // controller's CURRENT position, which is where your hand already is, so the second wheel
  // lands under your thumb rather than back where the first one spawned.
  //
  // Bounded on purpose: a submenu of a submenu is a menu tree, and a menu tree in mid-air is
  // the thing radials exist to avoid. Depth is capped at one.
  _commit() {
    const cmd = this._active >= 0 ? this._commands[this._active] : null;
    const wasSub = this._isSub;
    this._isSub = false;
    this.close();
    if (!cmd || cmd.enabled === false) return;
    // Released ON a sector that has more behind it, without pushing out far enough to open it.
    // Rather than do nothing — which reads as a dead wedge — arm it for the next press. The
    // push-out above is the fluent path; this is the one that catches a short drag.
    void wasSub;
    if (typeof cmd.sub === 'function') {
      let sub = null;
      try { sub = cmd.sub(); } catch (e) { console.error('[VrRadial] submenu failed', e); }
      if (sub && sub.length) {
        this._pending = sub;
        if (window.screenLog) window.screenLog('Press B again to choose', 'cyan');
      }
      return;
    }
    try { cmd.run?.(); } catch (e) { console.error('[VrRadial] command failed', e); }
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

      // Label at the sector mid-radius, laid out to FIT. The limit is the chord across the
      // wedge at that radius -- the wedge is a ring segment, so its usable width is a chord and
      // not the arc length, and measuring the arc is what let text run past the edges.
      const rL = (rOuter + rInner) / 2;
      const lx = C + Math.cos(mid) * rL, ly = C + Math.sin(mid) * rL;
      const maxW = wedgeWidth(rL, seg, rOuter - rInner);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const cmd = this._commands[i];
      ctx.globalAlpha = cmd.enabled === false ? 0.4 : 1;
      const fit = fitLabel(ctx, cmd.label ?? '', maxW, Math.round(tuning().labelPx));
      ctx.fillStyle = on ? '#11111b' : '#cdd6f4';
      ctx.font = `${on ? 700 : 600} ${fit.px}px system-ui, sans-serif`;
      const lh = fit.px * 1.15;
      const y0 = ly - (fit.lines.length - 1) * lh / 2;
      fit.lines.forEach((ln, k) => ctx.fillText(ln, lx, y0 + k * lh));
      // A WEDGE WITH MORE BEHIND IT SAYS SO. Pushing out past the rim opens it, and nothing on
      // screen said that was a thing you could do — so the gesture was undiscoverable even once
      // it was reachable. Chevrons at the rim, pointing the way you would push.
      if (typeof cmd.sub === 'function' && cmd.enabled !== false) {
        const cx = C + Math.cos(mid) * (rOuter - 14), cy = C + Math.sin(mid) * (rOuter - 14);
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(mid);
        ctx.strokeStyle = on ? '#11111b' : '#89b4fa';
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        for (const off of [-5, 3]) {
          ctx.beginPath();
          ctx.moveTo(off - 4, -7); ctx.lineTo(off + 3, 0); ctx.lineTo(off - 4, 7);
          ctx.stroke();
        }
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }

    // THE DEAD ZONE, drawn at its real size. It was implied by the inner disc, which is a
    // layout radius and has nothing to do with the 3cm of hand movement that actually arms a
    // sector — so "how far do I have to move" had no answer on screen.
    const t = tuning();
    const rDead = Math.max(8, (t.deadZone / t.reachM) * rOuter);
    ctx.beginPath();
    ctx.arc(C, C, rDead, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(243,139,168,0.55)';
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);

    // THE NEEDLE — where the hand actually is, in the same frame the sectors are laid out in.
    // Canvas y is DOWN and camUp is UP, so ny is negated here; getting that wrong is a menu
    // that picks the wedge opposite the one you are pointing at.
    if (t.showNeedle) {
      const px = C + this._nx * rOuter, py = C - this._ny * rOuter;
      ctx.beginPath();
      ctx.moveTo(C, C);
      ctx.lineTo(px, py);
      ctx.strokeStyle = this._active >= 0 ? 'rgba(137,180,250,0.95)' : 'rgba(160,170,190,0.55)';
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(px, py, 9, 0, Math.PI * 2);
      ctx.fillStyle = this._active >= 0 ? '#89b4fa' : '#6c7086';
      ctx.fill();
    }

    // Center: cancel when nothing is armed, and a nudge outward when it is not yet.
    ctx.beginPath();
    ctx.arc(C, C, rInner - 3, 0, Math.PI * 2);
    ctx.fillStyle = this._active < 0 ? 'rgba(243,139,168,0.30)' : 'rgba(20,20,30,0.85)';
    ctx.fill();
    ctx.fillStyle = this._active < 0 ? '#f38ba8' : '#6c7086';
    ctx.font = `600 ${CENTER_PX}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this._active < 0 ? 'move out' : 'release', C, C);

    this._tex.needsUpdate = true;
  }
}
