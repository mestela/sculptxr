import fs from 'fs';

let fails = 0;
const check = (name, ok, extra) => {
  if (!ok) fails++;
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (ok || !extra ? '' : '  — ' + extra));
};

const R = '/Users/mattestela/sculptxr/src/gui/htmlvr/';
const INSTALL = fs.readFileSync(R + 'install.js', 'utf8');
const PANEL   = fs.readFileSync(R + 'HTMLVRPanel.js', 'utf8');
const TORN    = fs.readFileSync(R + 'TornOffPanel.js', 'utf8');
const MM      = fs.readFileSync(R + 'MainMenuPanel.js', 'utf8');

// ── A REPAINT IS PRICED PER MOUNTED PANEL ─────────────────────────────────────────────────
//
// `canvas.requestPaint()` is `for (const child of state.children) state.dirty.add(child)` inside
// the polyfill, and each dirty element is separately cloned, serialised and re-decoded with a
// full inline copy of the page CSS. Measured on the dev server: one requestPaint() with three
// panels mounted reports changedElements: 3; the scoped path reports 1.
//
// That is the whole of matt's "performance is still noticably slower with torn off panels and
// trying to animate a rig" — tearing a panel off does not add a panel's worth of cost, it adds
// a panel's worth of cost TO EVERY REPAINT, including the ones driven by the rig.
{
  check('the ambient dirty path repaints one panel',
    /else if \(requestPaintScoped\(this\)\) this\._dirty = false;/.test(PANEL),
    'back on requestPaintOnce(getHostCanvas()), which dirties every mounted panel');

  check('...and requestPaintScoped exists to be called',
    /export function requestPaintScoped\(panel\)/.test(INSTALL));

  // The scoped nudge is an attribute touch precisely so the polyfill's own MutationObserver
  // does the dirtying — one element, through public DOM, with no reach into its internals.
  check('...by giving the polyfill a mutation to observe',
    /setAttribute\('data-rx-paint'/.test(INSTALL),
    'no attribute nudge, so nothing marks the single panel dirty');

  // _paintScheduled means "a queued paint covers every panel". A scoped paint does not, and
  // claiming otherwise silently swallows the next full paint in the same drain.
  const scoped = (INSTALL.match(/export function requestPaintScoped[\s\S]*?\n}/) || [''])[0];
  check('...without claiming to have covered every panel',
    scoped.length > 50 && !/_paintScheduled\s*=\s*true/.test(scoped),
    'requestPaintScoped sets _paintScheduled, so requestPaintOnce will dedup a paint it does not cover');

  // A resize really does move every panel's captured region — that one stays whole-canvas.
  check('a resize still repaints the whole canvas',
    /if \(this\._needsResize\) \{ requestPaintForced\(getHostCanvas\(\)\); this\._dirty = false; \}/.test(PANEL),
    'the shared-layout invalidation is gone; panels will capture stale regions');
}

// ── AN UNCHANGED SECTION DOES NOT REBUILD ─────────────────────────────────────────────────
//
// The main panel forwards markDirty to every torn-off section, so anything that dirties it
// during a pose drag used to regenerate each torn panel's DOM, re-wire it and re-rasterise it,
// whether or not a single character of its markup had changed.
{
  check('a torn panel compares before it rebuilds',
    /if \(!immediate && html === this\._lastHTML\) return;/.test(TORN),
    'every sync regenerates the DOM again, changed or not');

  check('...and remembers what it built',
    /this\._lastHTML = html;/.test(TORN));

  // The guard must NOT apply to the immediate path: creation and show need the blocking paint
  // even when the markup happens to match, or the panel appears as an unpainted black quad.
  check('...but a first paint is never skipped',
    /!immediate && html === this\._lastHTML/.test(TORN),
    'the guard would swallow the creation paint and show a black panel');
}

// ── THE A/B IS A SETTING, NOT A CONSOLE VARIABLE ──────────────────────────────────────────
//
// Standing rule: the switch has to be reachable from inside a headset, because that is the only
// place the comparison means anything.
{
  check('Scoped Panel Repaint is in the settings menu',
    /id: 'mm-scoped-paint'[\s\S]{0,200}?_panelScopedPaint/.test(MM),
    'no toggle, so the comparison needs a laptop and a console');

  check('...defaulting to on',
    /window\._panelScopedPaint !== false/.test(MM),
    'the fix ships off');

  check('...and honoured by the paint path',
    /window\._panelScopedPaint === false/.test(INSTALL) && /return requestPaintOnce\(canvas\)/.test(INSTALL),
    'the toggle does not reach the code it is supposed to bisect');
}

// ── THE FRAME PROFILER CANNOT SEE PANEL RASTERISATION ─────────────────────────────────────
//
// Scene.js times `panel-paint` around drainRAF(). The polyfill's paint callback is an ASYNC
// function that awaits Promise.all(dirty.map(rasterise)), so drainRAF() returns at the FIRST
// AWAIT: the bucket holds the clone and the serialise, and the image decode -- which the
// prod-CSS trace already identified as the expensive half -- resolves later, outside every
// mark, landing in the frame gap instead of in "our work". Measured on the dev server, the
// span was 37.9ms/paint against 15.4ms of synchronous drain: the bucket sees under half.
//
// This is not a detail. It is how "the menus are not the cost" was concluded twice from
// measurements that were honest about the wrong interval. So the instrument must time the SPAN,
// request to paint event, and it must be able to say WHO dirtied the panel.
{
  check('the panel instrument times the span, not the drain',
    /function _ppRequested\(\)/.test(INSTALL) && /function _ppPainted\(/.test(INSTALL),
    'no span timing, so the async decode stays invisible');

  // Both entries into a queued paint have to open the span or the average is quietly wrong.
  const wrapper = (INSTALL.match(/canvas\.requestPaint = function[\s\S]*?\n  \};/) || [''])[0];
  const scoped  = (INSTALL.match(/export function requestPaintScoped[\s\S]*?\n}/) || [''])[0];
  check('...opened by the whole-canvas path', /_ppRequested\(\)/.test(wrapper),
    'a rate-limited full paint is timed from zero');
  check('...and by the scoped path', /_ppRequested\(\)/.test(scoped),
    'scoped paints report a span of 0 and flatter the average');

  check('...and closed by the paint event, which carries the element count',
    /function _onPaintEvent\(e\) \{\s*\n\s*_ppPainted\(e && e\.changedElements/.test(INSTALL),
    'the span never closes, or closes without knowing how many panels were rasterised');

  check('markDirty is what gets tallied',
    /markDirty\(\) \{\s*\n\s*notePanelDirty\(this\);/.test(PANEL),
    'the tally is somewhere else, so it counts something other than dirtying');

  check('...and the cause is sampled, not built every call',
    /\(_pp\.seq\+\+ & 7\) !== 0\) return;/.test(INSTALL),
    'a stack per markDirty makes the instrument the cost it is measuring');

  check('a torn rebuild is counted separately from a skip',
    /notePanelRebuild\(this, immediate \|\| html !== this\._lastHTML\)/.test(TORN),
    'cannot tell a working content guard from a broken one');

  check('Trace Panel Cost is in the settings menu',
    /id: 'mm-panel-perf'[\s\S]{0,160}?_panelPerf/.test(MM),
    'console-only, which by the standing rule means it does not exist');

  // An instrument that is on by default is a cost everyone pays for a question nobody asked.
  check('...and off until asked for',
    !/window\._panelPerf\s*=\s*true/.test(INSTALL) && !/window\._panelPerf\s*=\s*true/.test(MM),
    'the tracer ships on');
}

// ── EVERY INSTRUMENT IS REACHABLE FROM INSIDE A HEADSET ───────────────────────────────────
//
// Standing rule, and it had quietly lapsed for the two oldest instruments in the codebase:
// xrPerf and ikPerf existed only as console globals for months. matt, mid-investigation: "i see
// 'trace panel cost' and 'scoped panel repaint', i don't see xperf." A switch you cannot reach
// without a laptop is not a switch during a headset session, which is the only session where
// these numbers mean anything.
//
// The toggles route through window.xrPerf()/ikPerf() rather than assigning the flags, because
// those functions also reset the accumulators -- flipping the raw flag mid-run reports a window
// that began before the switch did.
{
  for (const [id, label, fn] of [['mm-xr-perf', 'Trace Frame Time', 'xrPerf'],
                                 ['mm-ik-perf', 'Trace Rig Solve', 'ikPerf']]) {
    const block = (MM.match(new RegExp("\\{ id: '" + id + "'[\\s\\S]*?\\n(?=  [/{])")) || [''])[0];
    check(label + ' is in the settings menu', block.includes(label),
      'console-only, so it does not exist inside a headset');
    check('...and ' + id + ' resets the accumulator via window.' + fn,
      new RegExp('window\\.' + fn + '\\(!!on\\)').test(block),
      'assigns the raw flag, so the first window reported began before the switch');
  }
}

// ── SILENCE MUST MEAN ONE THING ───────────────────────────────────────────────────────────
//
// [panelPerf] only prints when a panel repaints, so no output means either "panels cost nothing"
// or "the switch did not take" — opposite conclusions from the same empty console, and the
// second one wastes a headset session. Same reason xrPerf/ikPerf have always acknowledged
// themselves ("A SWITCH THAT ANSWERS BACK": a silent flag cannot be told from stale code).
{
  const block = (MM.match(/\{ id: 'mm-panel-perf'[\s\S]*?\n    \} \},/) || [''])[0];
  check('Trace Panel Cost acknowledges itself',
    /console\.log\('\[panelPerf\] ' \+ \(on \? 'ON' : 'off'\)/.test(block),
    'the toggle is silent, so an empty console proves nothing');
  check('...and says which build it is',
    /VERSION/.test(block),
    'no version in the ack, so stale code looks identical to a working switch');
}

// ── A SYNC IS NOT A CHANGE ────────────────────────────────────────────────────────────────
//
// Scene calls _animPanel.syncFromState() EVERY FRAME, and syncFromState ended with an
// unconditional markDirty -- so the animation panel asked for a repaint 60-90 times a second
// for the whole session, visible or not, changed or not. From matt's trace, with the panel not
// even mounted:
//
//   dirtied: AnimationControlPanel 60, MiniPanel 2
//   caused by: AnimationControlPanel._requestPaint 8   (sampled 1 in 8)
//
// The 200ms limiter capped what got through, which is why this was survivable instead of
// obvious -- but each one that did get through was a full rasterise, priced across every
// mounted panel.
{
  const ACP = fs.readFileSync(R + 'AnimationControlPanel.js', 'utf8');
  const SCENE = fs.readFileSync('/Users/mattestela/sculptxr/src/Scene.js', 'utf8');

  check('the animation panel repaints only when its render changed',
    /const sig = this\._renderSig\(\);\s*\n\s*if \(sig !== this\._lastRenderSig\) \{/.test(ACP),
    'syncFromState marks dirty unconditionally, 60+ times a second');

  // Enumerating the state sources is how the last two bugs shipped. Signing the RENDERED output
  // cannot miss one: if the panel looks different, the signature differs.
  check('...signed from what it renders, not from a list of state sources',
    /_renderSig\(\)[\s\S]{0,400}?el\.textContent[\s\S]{0,200}?querySelectorAll\('input/.test(ACP),
    'the signature enumerates sources, so a missed one shows as a stale panel');

  check('...and a hidden panel is not synced every frame',
    /if \(this\._animPanel\.mesh\?\.visible\) this\._animPanel\.syncFromState\(\);/.test(SCENE),
    'the per-frame sync runs for a panel nobody can see');

  // update() is what mounts and unmounts — gating THAT on visibility would strand the panel.
  check('...while update() still runs unconditionally',
    /this\._animPanel\.update\(true\);/.test(SCENE),
    'gating update() too would leave the panel mounted after it is hidden');
}

// ── AN INVISIBLE MODAL STILL BLOCKS THE BUTTONS ───────────────────────────────────────────
//
// The A-button pin ring is suppressed while a modal is up, and that test reads
// `_vrKeyboard?.mesh?.visible`. matt's trace listed VrKeyboard as MOUNTED for a whole session,
// and a panel is only mounted while its mesh is visible -- so a keyboard nobody could see had
// been eating the A button. An escape hatch that also reports what it found.
{
  check('Close Stuck Modals is in the settings menu',
    /id: 'mm-close-modals'[\s\S]{0,600}?_vrKeyboard/.test(MM),
    'no way to clear a stuck modal from inside a headset');
  check('...and says what it closed, or that nothing was open',
    /none were open/.test(MM),
    'silence again cannot be told from "the button did nothing"');
}

// ── THE CAUSE MUST NAME THE CALLER, NOT THE WRAPPER ───────────────────────────────────────
//
// The first version filtered the stack by FILE (install.js, HTMLVRPanel.js), so for the main
// panel it reported `MainMenuPanel.markDirty` — the subclass override. That names the panel we
// already knew from the `dirtied` line and says nothing about what asked it, which is the only
// actionable half. Filter by what a frame IS: markDirty/_requestPaint/requestSync are plumbing.
{
  check('the cause skips the dirty wrappers',
    /!\/\\\.\(markDirty\|_requestPaint\|requestSync\|_ppRequested\)\\b\//.test(INSTALL),
    'a subclass markDirty override masks the real caller');
}

// ── THE BLANK CHECK IS A GPU READBACK ─────────────────────────────────────────────────────
//
// _bitmapIsBlank draws the full bitmap into an 8x8 canvas and calls getImageData -- a GPU->CPU
// readback. It ran on every paint of every panel. matt's performance recording put getImageData
// at 251ms self time, and a readback also forces a pipeline flush, which lands on
// WebGLRenderer.render -- the largest entry in that profile at 31% self. That is how MORE
// PANELS made the RENDERER slower, which is otherwise a strange thing for a panel to do.
//
// The blanks it catches all come from a re-layout the panel has not repainted since, so it arms
// on exactly those and stays armed while it keeps seeing blanks.
{
  check('the blank check only runs when a re-layout armed it',
    /this\._texture && this\._suspectBlank && _bitmapIsBlank\(bitmap\)/.test(PANEL),
    'a GPU readback on every paint of every panel');
  check('...armed by mount and unmount',
    /this\._suspectBlank = true;[\s\S]{0,120}?if \(want\) \{/.test(PANEL),
    'a mount can leave a stale captured region with nothing to catch it');
  check('...and by a resize',
    /this\._needsResize = false;\s*\n\s*this\._suspectBlank = true;/.test(PANEL),
    'a resize is the case the check was originally written for');
  check('...and disarmed once a good capture arrives',
    /this\._suspectBlank = false;/.test(PANEL),
    'it stays armed forever, which is where it started');
}

console.log(fails ? `\n${fails} FAILURE(S)` : '\nall checks passed');
process.exit(fails ? 1 : 0);
