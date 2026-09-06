// WHO HID THE PANEL, AND WHEN.
//
// `mesh.visible` on the wrist panels has several writers and is also read as "is the menu open"
// by the hit tests and the main-menu toggle. v3.30.15 gave the secondary-trigger hide a single
// owner, and the mini panel STILL vanishes -- under Tweak Joints, where that owner cannot even
// arm (it requires the Grab tool), and without the main menu being affected. matt: "we might
// need some logging here, its still doing it."
//
// So this is the instrument rather than another guess. Two things it reports, because a panel
// you cannot see is not necessarily a panel whose `visible` is false:
//
//   * EVERY WRITE to `mesh.visible`, with the line that did it. The property is swapped for an
//     accessor, so a write from anywhere -- Scene, the panel's own show(), a swap, a stray
//     assignment -- is caught at the moment it happens rather than inferred afterwards.
//   * EVERY CHANGE in whether it can actually be SEEN, audited once a frame: an ancestor turned
//     invisible, the mesh detached from the scene graph, a zero scale. The v3.30.15 hunt found
//     the restore living inside `if (uiGrip)`, and "detached from the grip" looks exactly like
//     "hidden" from the outside while `visible` reads true the whole time.
//
// Reported to the BROWSER CONSOLE, not to screenLog. matt reads these over remote debugging, and
// a screenLog line is text painted into the headset that cannot be copied out of it: "don't use
// screenlog within the headset, its impossible to copy and paste into this chat. use regular
// chrome console, i have remote debugging enabled, much easier to use." The SWITCH still has to
// be reachable from inside the headset though -- that is a settings item, for the same reason
// the physics solver is one. Off by default and persisted, so it survives the reload it takes to
// switch it on.
import getOptionsURL from './getOptionsURL.js';

const PanelTrace = {};

// The reason a mesh is not on screen, or null when it is. Ordered most-specific first: a
// detached mesh is also "not visible", and saying which one is the whole point.
function whyHidden(mesh) {
  if (!mesh) return 'no mesh';
  if (!mesh.visible) return 'visible=false';
  let o = mesh.parent;
  if (!o) return 'detached from the scene graph';
  for (; o; o = o.parent) {
    if (!o.visible) return 'ancestor "' + (o.name || o.type) + '" is invisible';
    if (!o.parent && o.type !== 'Scene') return 'not under a Scene (top is ' + (o.name || o.type) + ')';
  }
  const s = mesh.scale;
  if (Math.abs(s.x * s.y * s.z) < 1e-12) return 'scale is zero';
  return null;
}

// The first frame of the stack that is not this tracer -- the line that actually did the write.
//
// Skipped BY FUNCTION NAME as well as by path. The path test alone reads as though it works and
// does not: it depends on the file still being called PanelTrace at the point the stack is
// formatted, which is not true of a bundle, of a harness that inlines this module, or of any
// build that renames it -- and when it fails it fails silently, reporting the tracer's own
// setter as the culprit. The harness caught exactly that.
function caller() {
  const lines = String(new Error().stack || '').split('\n');
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l || /PanelTrace/.test(l)) continue;
    if (/\bat (caller|set|Object\.set)\b/.test(l) || /\[as visible\]/.test(l)) continue;
    return l.replace(/^at\s+/, '').replace(/\?t=\d+/, '').slice(0, 120);
  }
  return '?';
}

// A PANEL CAN VANISH WITHOUT ANYTHING TOUCHING `visible`. The mesh is a PlaneGeometry rebuilt
// from the element's measured aspect whenever the content's size changes -- and the MiniPanel
// sets `_needsResize` every time its extras block is rebuilt, which under Tweak Joints is every
// time you select a different joint. Measure that at the wrong moment (mid-relayout, before the
// polyfill has laid the new markup out) and the plane comes back a sliver, which from the
// outside is indistinguishable from the panel disappearing -- and self-corrects on a later
// paint, which is what "reappears randomly" looks like. So the size is watched too, and a
// change big enough to notice is reported with both numbers.
function sizeOf(mesh) {
  const g = mesh && mesh.geometry, p = g && g.parameters;
  if (!p || !(p.width > 0) || !(p.height > 0)) return null;
  return { w: p.width, h: p.height };
}

// THE HEAD, not the app's camera. In a session the orbit camera is still sitting wherever the
// desktop view left it -- tens of scene units away -- so every distance measured against it came
// back as "47m from the head, FAR" for a panel that was 30cm from the user's face. The XR camera
// is the one with the actual head pose; the orbit camera is only right outside a session.
function headCamera(scene) {
  const xr = scene._renderer && scene._renderer.xr;
  if (xr && xr.isPresenting && xr.getCamera) {
    const c = xr.getCamera();
    if (c && c.matrixWorld) return c;
  }
  const c = scene._camera && scene._camera.getThreeCamera ? scene._camera.getThreeCamera() : null;
  return c && c.matrixWorld ? c : null;
}

function say(msg) {
  console.log('[PanelTrace] ' + msg);
}

// Swap `visible` for an accessor ONCE per mesh. Idempotent because attach() runs from the frame
// loop: the panels are built lazily and a panel that did not exist yet on the last pass has to
// be picked up on this one, without re-wrapping the ones that already are.
function wrap(name, mesh) {
  if (!mesh || mesh._ptWrapped) return;
  let v = mesh.visible;
  Object.defineProperty(mesh, 'visible', {
    configurable: true,
    get() { return v; },
    set(nv) {
      nv = !!nv;
      if (nv !== v && PanelTrace.enabled()) {
        say(name + '.visible ' + v + ' -> ' + nv + '  by ' + caller());
      }
      v = nv;
    },
  });
  mesh._ptWrapped = true;
}

// WHERE IT IS, not just whether it is drawn. The v3.30.19 anchor made the panels FOLLOW the
// grip instead of being children of it, which fixed the inherited-visibility blink -- and the
// next report of "still disappearing" came with no trace line at all: visible, attached,
// correctly sized, and still not there. That leaves position, which nothing was watching. A
// panel parked where your hand WAS during a dropout, or behind you, is gone as far as anyone
// using it is concerned, and it produces no visibility event whatsoever.
function place(mesh, cam) {
  // An instrument must never be the thing that takes the render loop down: anything it reads
  // might not be there yet on the frame it first sees a panel.
  if (!mesh || !mesh.matrixWorld) return null;
  const m = mesh.matrixWorld.elements;
  const p = { x: m[12], y: m[13], z: m[14] };
  if (!cam) return { p, d: null, behind: null };
  const c = cam.matrixWorld.elements;
  const dx = p.x - c[12], dy = p.y - c[13], dz = p.z - c[14];
  // The camera looks down -Z in its own basis; the third column IS that axis in world space.
  const fx = -c[8], fy = -c[9], fz = -c[10];
  const along = dx * fx + dy * fy + dz * fz;
  return { p, d: Math.sqrt(dx * dx + dy * dy + dz * dz), behind: along < 0 };
}

// IS SOMETHING IN FRONT OF IT? Nothing above can answer that: the panel can be visible,
// attached, correctly sized and exactly where it should be, and still be behind a piece of
// geometry. The rig overlay began WRITING DEPTH in v3.30.8 (capsules had to occlude each other),
// it is drawn before the panels, and the preselect highlight changes what it draws on every
// hover -- and matt: "all i was doing was moving the cursor between bones... it feels strongly
// linked to the preselect highlight." So the probe is a ray from the head to the panel's centre,
// reporting the first thing it meets that is not the panel itself.
//
// Throttled, because it is a raycast: every 10th frame is four a second in a session, which is
// far finer than a flash you can see and still nothing next to the frame it rides in.
// Kept separate so the harness can drive it with plain objects: everything here is arithmetic on
// matrices plus one raycast through whatever raycaster the scene already has.
function _probe(scene, mesh, cam) {
  const mk = scene._ptRaycaster || (scene._ptRaycaster = (scene._miniPanel && scene._miniPanel._raycaster) || null);
  if (!mk || !mk.set || !mk.intersectObjects) return null;
  // A SPRITE CANNOT BE RAYCAST WITHOUT A CAMERA, and this scene is full of them (the joint
  // labels). three throws "Raycaster.camera needs to be set" for every one, every probe, which
  // in a headset is an error flood down the remote console and a stall in the frame that emits
  // it. The instrument was distorting the thing it was measuring. matt's log caught it.
  mk.camera = cam;
  const m = mesh.matrixWorld.elements, c = cam.matrixWorld.elements;
  const ox = c[12], oy = c[13], oz = c[14];
  let dx = m[12] - ox, dy = m[13] - oy, dz = m[14] - oz;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
  dx /= len; dy /= len; dz /= len;
  mk.set({ x: ox, y: oy, z: oz }, { x: dx, y: dy, z: dz });
  mk.near = 0; mk.far = len * 0.999;   // stop just short of the panel: only what is IN FRONT
  const hits = mk.intersectObjects(scene._scene.children, true) || [];
  for (const h of hits) {
    const o = h.object;
    if (!o || o === mesh || o.visible === false) continue;
    if (o.material && o.material.transparent && (o.material.opacity ?? 1) < 0.2) continue;
    return { name: o.name || o.type || '?', d: h.distance, panelD: len };
  }
  return null;
}

// ── THE FLIGHT RECORDER ────────────────────────────────────────────────────────────────────
//
// Five fixes for the vanishing panel, five plausible mechanisms, and it still goes. Every one of
// them was reasoned from a partial view and shipped before it could be checked against the thing
// actually happening, which is a loop worth breaking rather than running a sixth time.
//
// So: record EVERYTHING about the panels, every frame, into a ring buffer, and let matt dump the
// last few seconds the moment he sees it go. The bug is intermittent and lasts a moment, and no
// change-triggered report can help when the question is "what was different on the frame it
// vanished" -- the answer has to be a recording of that frame, next to the ones either side of
// it. What the reports above cover is a guess about which fields matter; this covers all of them.
//
// Diff-compressed on the way out: 240 frames x 3 panels is unreadable printed whole, and the
// only interesting rows are the ones where something moved.
// LONG ENOUGH TO STILL HOLD THE EVENT WHEN THE BUTTON IS PRESSED.
//
// The first tape came back with 240 frames of a perfectly healthy panel: visible, parented,
// textured, opaque, in view, every field constant except a millimetre of hand drift. 240 frames
// at the ~55fps that recording measured is 4.3 seconds -- and noticing the menu has gone,
// turning to the pinned main menu, aiming at it and pressing a button takes about that long. So
// the most likely reading is not "nothing was wrong", it is "the tape had already run past it".
//
// Half a minute costs about 125k numbers, which is nothing, and it cannot run past a flash the
// user then walks over to report.
const HISTORY = 1800;  // ~30 seconds

function frameOf(p, cam) {
  const m = p.mesh;
  const mat = m.material || {};
  const tex = mat.map;
  const img = tex && tex.image;
  const w = m.matrixWorld && m.matrixWorld.elements;
  const at = place(m, cam);
  return {
    vis: m.visible === true,
    par: (m.parent && (m.parent.name || m.parent.type)) || 'NONE',
    anc: whyHidden(m) || '',
    x: w ? +w[12].toFixed(3) : null, y: w ? +w[13].toFixed(3) : null, z: w ? +w[14].toFixed(3) : null,
    d: at && at.d !== null ? +at.d.toFixed(2) : null,
    behind: at ? !!at.behind : null,
    sx: +m.scale.x.toFixed(3), sy: +m.scale.y.toFixed(3), sz: +m.scale.z.toFixed(3),
    // The material half, which nothing above watches: an opacity of 0, colorWrite off, a
    // blending mode change or a texture whose image has gone empty each draw a panel that is
    // present, placed, textured by every earlier test, and invisible.
    op: mat.opacity === undefined ? null : +Number(mat.opacity).toFixed(3),
    tr: mat.transparent === true,
    cw: mat.colorWrite !== false,
    dt: mat.depthTest !== false,
    dw: mat.depthWrite !== false,
    bl: mat.blending === undefined ? null : mat.blending,
    map: !!tex,
    tw: img ? (img.width || img.videoWidth || 0) : 0,
    th: img ? (img.height || img.videoHeight || 0) : 0,
    ink: p._ptInk === undefined ? null : p._ptInk,
    ord: m.renderOrder,
    cull: m.frustumCulled === true,
    gw: m.geometry && m.geometry.parameters ? +Number(m.geometry.parameters.width).toFixed(3) : null,
    gh: m.geometry && m.geometry.parameters ? +Number(m.geometry.parameters.height).toFixed(3) : null,
  };
}

PanelTrace.record = function (scene, panels, cam) {
  const ring = scene._ptRing || (scene._ptRing = []);
  // UNROUNDED. Rounding here and comparing against an unrounded performance.now() in the dump
  // makes a row up to half a millisecond in the FUTURE, which prints as "over -0.0s" and
  // "t--0.00s". Harmless in a long tape and confusing in a short one, and it made this module's
  // own harness fail one run in three -- an instrument nobody can trust the clock of is not one
  // to hand somebody mid-hunt.
  const row = { t: performance.now() };
  for (const [name, p] of panels) if (p && p.mesh) row[name] = frameOf(p, cam);
  ring.push(row);
  if (ring.length > HISTORY) ring.shift();
};

// Print the recording. Only the fields that CHANGED from the previous frame, so a steady panel
// takes one line and the frame everything went wrong takes one line naming exactly what moved.
PanelTrace.dump = function (scene) {
  scene = scene || window.app || window.sculptgl;
  const ring = scene && scene._ptRing;
  if (!ring || !ring.length) { say('no history recorded (is tracing on?)'); return; }
  // Timed BACKWARDS from the press, because that is the only clock the user has: "it went about
  // three seconds before I hit the button" points straight at t-3s.
  const now = performance.now();
  const span = Math.max(0, now - ring[0].t) / 1000;
  say('--- panel history: ' + ring.length + ' frames over ' + span.toFixed(1)
    + 's (' + (ring.length / Math.max(span, 0.001)).toFixed(0) + ' fps), oldest first, times are'
    + ' SECONDS BEFORE THE DUMP ---');
  const ago = (t) => 't-' + (Math.max(0, now - t) / 1000).toFixed(2) + 's';
  const prev = {};
  let printed = 0;
  for (const row of ring) {
    for (const name of ['MiniPanel', 'ToolPicker', 'MainMenu']) {
      const cur = row[name];
      if (!cur) continue;
      const was = prev[name];
      prev[name] = cur;
      if (!was) { say(ago(row.t) + ' ' + name + ' ' + JSON.stringify(cur)); printed++; continue; }
      const diff = {};
      for (const k in cur) if (cur[k] !== was[k]) diff[k] = was[k] + '->' + cur[k];
      if (!Object.keys(diff).length) continue;
      say(ago(row.t) + ' ' + name + ' ' + JSON.stringify(diff));
      printed++;
    }
  }
  say('--- ' + printed + ' changed rows; the rest were identical ---');
};

// IS THERE ANYTHING ON THE TEXTURE?
//
// The 30-second tape settled the question it was built for: pressed within half a second of the
// menu going, the MiniPanel's record shows visible, parented, nothing hiding it, opacity 1,
// colorWrite on, a 419x800 map, renderOrder 11000, not culled, 0.4m from the head and in view,
// with nothing changing but a millimetre of hand drift. Every property of the object was
// correct while the thing was, to the user, not there.
//
// One possibility survives that: the texture is present and its CONTENT is empty. The panel is a
// quad whose whole appearance is its map, the map is re-rasterised by the polyfill on every
// content change, and the background is transparent -- so a paint that lands empty draws exactly
// nothing while every field above stays perfect. It also fits the correlation with the preselect
// highlight, which is what makes the panel repaint in the first place.
//
// So: sample the bitmap. An 8x8 draw of it into an offscreen canvas, mean alpha over the 64
// pixels, every tenth frame -- enough to catch a blank that lasts long enough to see, cheap
// enough to leave on while hunting.
const _inkScope = {};   // one 8x8 canvas for the whole module; a fresh one per call is waste
function inkOf(mesh, scene) {
  scene = scene || _inkScope;
  const tex = mesh.material && mesh.material.map;
  const img = tex && tex.image;
  if (!img) return null;
  let c = scene._ptInkCanvas;
  if (!c) {
    if (typeof OffscreenCanvas === 'undefined') return null;
    c = scene._ptInkCanvas = new OffscreenCanvas(8, 8);
    scene._ptInkCtx = c.getContext('2d', { willReadFrequently: true });
  }
  const ctx = scene._ptInkCtx;
  if (!ctx) return null;
  try {
    ctx.clearRect(0, 0, 8, 8);
    ctx.drawImage(img, 0, 0, 8, 8);
    const d = ctx.getImageData(0, 0, 8, 8).data;
    let a = 0, lum = 0;
    for (let i = 0; i < d.length; i += 4) { a += d[i + 3]; lum += (d[i] + d[i + 1] + d[i + 2]) / 3; }
    return { a: Math.round(a / 64), lum: Math.round(lum / 64) };
  } catch (_) {
    return null;   // a consumed or cross-origin bitmap; not worth taking the frame down for
  }
}

// THE PAINT ITSELF, which is the one part of the pipeline nothing here has watched.
//
// matt narrowed it to a deterministic sequence: Joint Tweak, select a joint with the trigger,
// move the controller a little, and the mini panel goes for about a quarter of a second and
// comes back -- once. "it feels like its forcing a full repaint/rebuild of the menu." And the
// panel repaint rate limit is PAINT_MIN_MS = 200ms, which is that quarter second: whatever goes
// wrong is set during a rebuild and not corrected until the NEXT allowed paint.
//
// Selecting a joint changes the extras block's key, so the block is rebuilt, the content changes
// height (measured: 0.113 -> 0.254) and `_needsResize` is set -- and a resize DISPOSES the
// texture and rebuilds the geometry from the element's measured box. So the questions are what
// the capture returned, what the element measured at that instant, and what the texture ended up
// as. Wrapped rather than edited into the panel: this is an instrument, and it comes off with
// the flag.
function wrapPaint(name, panel) {
  if (!panel || panel._ptPaintWrapped || typeof panel._onPaint !== 'function') return;
  panel._ptPaintWrapped = true;
  const orig = panel._onPaint.bind(panel);
  panel._onPaint = function () {
    if (!PanelTrace.enabled()) return orig();
    const el = panel._element;
    const before = {
      w: el ? el.offsetWidth : null, h: el ? el.offsetHeight : null,
      resize: !!panel._needsResize, map: !!(panel.mesh && panel.mesh.material.map),
      mounted: !!panel._hostMounted,
    };
    const t0 = performance.now();
    const aBefore = inkOf(panel.mesh);
    orig();
    const aAfter = inkOf(panel.mesh);
    const tex = panel.mesh && panel.mesh.material.map;
    const img = tex && tex.image;
    const g = panel.mesh && panel.mesh.geometry && panel.mesh.geometry.parameters;
    say(name + ' paint: el ' + before.w + 'x' + before.h
      + (before.resize ? '  RESIZE' : '') + (before.mounted ? '' : '  UNMOUNTED')
      + ' -> map ' + (tex ? ((img && img.width) || '?') + 'x' + ((img && img.height) || '?') : 'NONE')
      + (g ? '  plane ' + (+g.width).toFixed(3) + 'x' + (+g.height).toFixed(3) : '')
      + '  alpha ' + (aBefore ? aBefore.a : '-') + '->' + (aAfter ? aAfter.a : '-')
      + '  ' + (performance.now() - t0).toFixed(1) + 'ms');
  };
}

PanelTrace.enabled = function () {
  if (typeof window._panelTrace === 'boolean') return window._panelTrace;
  const saved = getOptionsURL().panelTrace;
  return typeof saved === 'boolean' ? saved : false;
};

PanelTrace.setEnabled = function (on) {
  window._panelTrace = !!on;
  try { getOptionsURL.saveOption('panelTrace', !!on, 0); } catch (_) {}
  say('panel tracing ' + (on ? 'ON' : 'off'));
  // AND A SNAPSHOT, so the log says what it is starting from. Everything else here reports
  // CHANGES, which means a log with no PanelTrace lines in it is ambiguous: nothing happened, or
  // the tracer was never running. This line settles that, and it prints the whole state of every
  // panel so the first report has something to be a change FROM.
  if (on) PanelTrace.snapshot(window.app || window.sculptgl);
};

PanelTrace.snapshot = function (scene) {
  if (!scene) return;
  const cam = headCamera(scene);
  for (const [name, p] of [['MiniPanel', scene._miniPanel], ['ToolPicker', scene._toolPickerPanel],
                           ['MainMenu', scene._mainMenuPanel]]) {
    if (!p || !p.mesh) { say(name + ': not built yet'); continue; }
    const why = whyHidden(p.mesh);
    const at = place(p.mesh, cam);
    const g = p.mesh.geometry && p.mesh.geometry.parameters;
    say(name + ': ' + (why || 'shown')
      + (at && at.d !== null ? '  ' + at.d.toFixed(2) + 'm from the head' + (at.behind ? ' BEHIND it' : '') : '')
      + (g ? '  ' + (+g.width).toFixed(3) + 'x' + (+g.height).toFixed(3) : '')
      + '  parent=' + ((p.mesh.parent && (p.mesh.parent.name || p.mesh.parent.type)) || 'NONE')
      + (p.pinned ? '  pinned' : ''));
  }
};

// Called every frame from the render loop. Cheap when off: three property reads and a return.
PanelTrace.tick = function (scene) {
  if (!scene) return;
  const panels = [
    ['MiniPanel', scene._miniPanel],
    ['ToolPicker', scene._toolPickerPanel],
    ['MainMenu', scene._mainMenuPanel],
  ];
  for (const [name, p] of panels) if (p && p.mesh) { wrap(name, p.mesh); wrapPaint(name, p); }
  if (!PanelTrace.enabled()) return;

  const state = scene._ptState || (scene._ptState = {});
  for (const [name, p] of panels) {
    if (!p || !p.mesh) continue;
    const why = whyHidden(p.mesh);
    const now = why || 'shown';
    if (state[name] === now) continue;
    // The tool is named with it because the reports that matter arrive in pairs -- something
    // hid the panel, and something else was going on at the time. matt's case is Tweak Joints.
    const sm = scene._sculptManager;
    const tool = sm && sm.getCurrentTool ? sm.getCurrentTool() : null;
    const mode = tool && tool._mode !== undefined ? ('/' + tool._mode) : '';
    state[name] = now;
    say(name + ': ' + now + '   [tool ' + ((tool && tool.constructor.name) || '?') + mode + ']');
  }

  // ...where it is, on a move big enough to be a jump rather than a hand moving. Reported with
  // the distance from the head and whether it is behind it, because those are the two ways a
  // panel that is drawing perfectly is nonetheless not on screen.
  const cam = headCamera(scene);
  const places = scene._ptPlace || (scene._ptPlace = {});
  for (const [name, p] of panels) {
    if (!p || !p.mesh) continue;
    const now = place(p.mesh, cam);
    if (!now) continue;
    const was = places[name];
    places[name] = now;
    const far = now.d !== null && now.d > 2.0;              // further than an arm, in metres
    const jumped = was && Math.hypot(now.p.x - was.p.x, now.p.y - was.p.y, now.p.z - was.p.z) > 0.5;
    const flipped = was && was.behind !== now.behind;
    if (!jumped && !flipped && !(far && (!was || was.d <= 2.0))) continue;
    say(name + ': at ' + now.p.x.toFixed(2) + ',' + now.p.y.toFixed(2) + ',' + now.p.z.toFixed(2)
      + (now.d === null ? '' : '  ' + now.d.toFixed(2) + 'm from the head'
        + (now.behind ? ' BEHIND it' : ''))
      + (jumped ? '  JUMPED' : '') + (far ? '  FAR' : ''));
  }

  // ...and whether the anchor the wrist panels ride is actually being driven. A grip that stops
  // updating leaves them frozen in the last place the hand was seen -- which looks exactly like
  // "it disappeared" and, unlike every other cause here, changes nothing this file watches.
  const anchor = scene._wristAnchor;
  if (anchor) {
    const e = anchor.matrix.elements;
    const key = e[12].toFixed(3) + ',' + e[13].toFixed(3) + ',' + e[14].toFixed(3);
    const st = scene._ptAnchor || (scene._ptAnchor = { key: null, still: 0 });
    if (key === st.key) st.still++;
    else { if (st.still > 60) say('wrist anchor moved again after ' + st.still + ' still frames'); st.still = 0; st.key = key; }
    // 60 frames is under a second of a hand that has not moved AT ALL, which a real hand does
    // not do -- so this is the grip having stopped feeding us, not the user holding still.
    if (st.still === 60) {
      // POSE, not existence. `grip.visible` is three's own record of whether this frame had a
      // grip pose, and "the object is there" was never the interesting half: both grips were
      // present through every freeze the trace caught.
      const pose = (g) => (!g ? 'NULL' : (g.visible === false ? 'no-pose' : 'live'));
      say('wrist anchor has not moved for 60 frames at ' + key
        + '  [grips L=' + pose(scene._vrControllerLeftGrip)
        + ' R=' + pose(scene._vrControllerRightGrip)
        + '  headHold=' + (scene._wristHeadOffset ? 'armed' : 'none') + ']');
    }
  }

  // ...and the two cheap per-frame questions the raycast cannot be run often enough to answer.
  //
  // A PANEL WITH NO TEXTURE draws as an untextured quad -- which, on a material whose colour is
  // white and whose only content was the map, is a blank. The panel is rasterised through the
  // polyfill and the texture is disposed and rebuilt whenever the content's size changes, so a
  // paint that does not arrive leaves exactly this state, and nothing else here would notice.
  //
  // OUT OF THE VIEW is the other one: a panel 30cm away and 90 degrees to the side is gone
  // without a single flag changing. This is the half-angle to the panel against a generous
  // 55-degree half-FOV, so it reports leaving the view rather than clipping precisely.
  const flags = scene._ptFlags || (scene._ptFlags = {});
  for (const [name, p] of panels) {
    if (!p || !p.mesh) continue;
    const mat = p.mesh.material;
    const blank = !!(mat && 'map' in mat && !mat.map);
    let outOfView = false;
    if (cam && p.mesh.matrixWorld) {
      const m = p.mesh.matrixWorld.elements, c = cam.matrixWorld.elements;
      let dx = m[12] - c[12], dy = m[13] - c[13], dz = m[14] - c[14];
      const L = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      const dot = (dx * -c[8] + dy * -c[9] + dz * -c[10]) / L;
      outOfView = dot < 0.57;                    // ~55 degrees off the view axis
    }
    const key = (blank ? 'blank' : '') + (outOfView ? '|outofview' : '');
    if (flags[name] === key) continue;
    flags[name] = key;
    if (key) say(name + ': ' + (blank ? 'NO TEXTURE (drawing blank)' : '')
      + (blank && outOfView ? ' and ' : '') + (outOfView ? 'outside the view' : ''));
    else say(name + ': textured and in view');
  }

  // ...and whether anything is standing in front of it. Reported on a CHANGE of occluder, so a
  // panel that is permanently behind something says it once.
  const occ = scene._ptOcc || (scene._ptOcc = { n: 0, by: {} });
  occ.n++;
  // THE RAYCAST IS THE EXPENSIVE HALF and it is off unless asked for (window._panelTraceProbe).
  // It walks the WHOLE scene recursively, which this codebase has paid for before -- three's
  // intersectObject defaults to recursive and `isPickable` does not stop it, a lesson that cost
  // four headset sessions. Everything else here is arithmetic on numbers already in hand, so the
  // trace stays usable while hunting; the probe is for when the question is specifically "what is
  // in front of it", and it has already answered that one.
  const probeOn = !!window._panelTraceProbe;
  // The texture's CONTENT, on the same throttle. See inkOf: this is the last way a panel whose
  // every property is correct can still be invisible.
  {
    // EVERY FRAME, not every tenth: the window under investigation is one paint interval, 200ms,
    // and a ten-frame sample can sit either side of it. An 8x8 draw is cheap enough to afford.
    const inks = scene._ptInk || (scene._ptInk = {});
    for (const [name, p] of panels) {
      // HIDDEN ONES TOO. The panel is already empty at the instant it is shown, so whatever
      // empties it happens while nobody is looking -- and sampling only the visible ones means
      // the transition is never timestamped, just its result.
      if (!p || !p.mesh) continue;
      const ink = inkOf(p.mesh, scene);
      if (!ink) continue;
      p._ptInk = ink.a;                      // carried into the tape, so the dump shows it too
      const blank = ink.a < 8;               // essentially nothing drawn
      if (inks[name] === blank) continue;
      const first = inks[name] === undefined;
      inks[name] = blank;
      // THE FIRST SAMPLE IS NOT A TRANSITION. Reported as one, a healthy panel opened with
      // "texture has content again", which reads as a recovery from a blank that never happened.
      if (first && !blank) continue;
      say(name + (blank ? ': TEXTURE IS EMPTY (mean alpha ' + ink.a + ')'
        : ': texture has content again (mean alpha ' + ink.a + ', luma ' + ink.lum + ')'));
    }
  }

  if (probeOn && cam && occ.n % 10 === 0) {
    for (const [name, p] of panels) {
      if (!p || !p.mesh || !p.mesh.visible || !p.mesh.matrixWorld) continue;
      let hit = null;
      try { hit = _probe(scene, p.mesh, cam); } catch (_) { hit = null; }
      const key = hit ? hit.name : '';
      if (occ.by[name] === key) continue;
      occ.by[name] = key;
      say(hit
        ? name + ': OCCLUDED by "' + hit.name + '" at ' + hit.d.toFixed(2)
          + 'm, panel at ' + hit.panelD.toFixed(2) + 'm'
        : name + ': nothing in front of it any more');
    }
  }

  // ...and the whole state into the ring buffer, for the dump.
  PanelTrace.record(scene, panels, cam);

  // ...and the size, on the same once-a-change rule. A quarter is well below anything a real
  // layout change produces and well above float noise.
  const sizes = scene._ptSize || (scene._ptSize = {});
  for (const [name, p] of panels) {
    if (!p || !p.mesh) continue;
    const s = sizeOf(p.mesh);
    if (!s) continue;
    const was = sizes[name];
    sizes[name] = s;
    if (!was) continue;
    const dw = Math.abs(s.w - was.w) / was.w, dh = Math.abs(s.h - was.h) / was.h;
    if (dw < 0.25 && dh < 0.25) continue;
    say(name + ': resized ' + was.w.toFixed(3) + 'x' + was.h.toFixed(3)
      + ' -> ' + s.w.toFixed(3) + 'x' + s.h.toFixed(3)
      + (s.h < 0.01 || s.w < 0.01 ? '  DEGENERATE' : ''));
  }
};

export default PanelTrace;
