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

console.log(fails ? `\n${fails} FAILURE(S)` : '\nall checks passed');
process.exit(fails ? 1 : 0);
