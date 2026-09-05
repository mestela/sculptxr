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

PanelTrace.enabled = function () {
  if (typeof window._panelTrace === 'boolean') return window._panelTrace;
  const saved = getOptionsURL().panelTrace;
  return typeof saved === 'boolean' ? saved : false;
};

PanelTrace.setEnabled = function (on) {
  window._panelTrace = !!on;
  try { getOptionsURL.saveOption('panelTrace', !!on, 0); } catch (_) {}
  say('panel tracing ' + (on ? 'ON' : 'off'));
};

// Called every frame from the render loop. Cheap when off: three property reads and a return.
PanelTrace.tick = function (scene) {
  if (!scene) return;
  const panels = [
    ['MiniPanel', scene._miniPanel],
    ['ToolPicker', scene._toolPickerPanel],
    ['MainMenu', scene._mainMenuPanel],
  ];
  for (const [name, p] of panels) if (p && p.mesh) wrap(name, p.mesh);
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
  const cam = scene._camera && scene._camera.getThreeCamera ? scene._camera.getThreeCamera() : null;
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
      say('wrist anchor has not moved for 60 frames at ' + key
        + '  [grips L=' + (scene._vrControllerLeftGrip ? 'yes' : 'NULL')
        + ' R=' + (scene._vrControllerRightGrip ? 'yes' : 'NULL') + ']');
    }
  }

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
