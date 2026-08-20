// A once-a-second flight recorder for the VR frame loop, kept because a specific failure has
// now happened twice and has survived three attempts to reason it out from the source.
//
// THE SYMPTOM, as reported: a whole demo recorded fine — sculpting tools worked, TransformVR
// worked — but the radius sphere never appeared and Grab did nothing. Gone by morning, and not
// reproducible on demand. That shape of bug is exactly what this project's own notes warn
// about: reading the code produces wrong answers, measuring produces right ones. So this
// records the small set of values that tell the candidates apart, and PERSISTS them, because
// the person who hits the bug is mid-recording and cannot stop to read a console.
//
// The fields are not a general-purpose dump — each one exists to kill a specific candidate:
//
//   activeHand / domHand    _updateVRCursors hides the cursor for any hand that is not
//                           `_activeHandedness`. If the cursor is missing and activeHand is
//                           not the hand you are sculpting with, that is the whole answer.
//   ctlL / ctlR             the controller MODEL groups, which are loaded from a .ply OVER
//                           THE NETWORK at session start. The cursor is hidden outright for a
//                           hand whose model group is missing, so a failed fetch takes the
//                           radius sphere with it — and a fetch is exactly the kind of thing
//                           that fails once at night and never again.
//   curL / curR             the symptom itself, so the log says when it started, not just that
//                           it happened.
//   ctrls / withMatrix      the tools read their controllers out of this list. The menu-guard
//                           path deliberately hands over BUTTON-ONLY entries with no matrix,
//                           and Grab returns early when the active one has no matrix — so
//                           `ctrls>0 withMatrix=0` is Grab dead with everything else alive.
//   menuGuard               whether that guard is engaged, and it is sticky by design
//                           (`_wasPointingAtMenu`), which is what would make it outlast the
//                           moment that caused it.
//   sculpt / locked         the sculpt hand latch.
//   pick                    whether the pick found anything at all, which splits "the pick
//                           died" from "the pick is fine and the drawing is wrong".
//
// window._vrLog()      → this session's samples, as a table
// window._vrLog(true)  → the samples saved from the PREVIOUS session (the point of the whole
//                        exercise: the answer is still there the next morning)
// window._vrDiag = false disables recording.

const KEY = 'sxr_vrdiag';
const MAX = 600;          // ~10 minutes at one sample a second
const PERIOD_MS = 1000;
const SAVE_MS = 15000;

let buf = [];
let lastAt = 0;
let lastSave = 0;
let prev = null;          // last session's buffer, read once at startup

try {
  const raw = localStorage.getItem(KEY);
  if (raw) prev = JSON.parse(raw);
} catch (_) { /* absent or corrupt: nothing to recover, carry on */ }

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(buf)); } catch (_) { /* quota: not worth failing a frame over */ }
}

// Called once per XR frame; samples at most once a second. Everything it reads is already in
// hand — no picking, no traversal — so the cost off the sampling second is one comparison.
export function sampleVR(scene) {
  if (window._vrDiag === false) return;
  const now = Date.now();
  if (now - lastAt < PERIOD_MS) return;
  lastAt = now;

  const ctrls = scene._lastXRControllers || [];
  const tool = scene._sculptManager ? scene._sculptManager.getCurrentTool() : null;
  const picked = scene._picking ? scene._picking.getMesh() : null;

  buf.push({
    t: new Date(now).toTimeString().slice(0, 8),
    mode: scene._currentXRMode ? scene._currentXRMode.replace('immersive-', '') : '?',
    tool: tool && tool.constructor ? tool.constructor.name : 'none',
    activeHand: scene._activeHandedness || null,
    domHand: scene._dominantHand || null,
    ctlL: !!scene._vrControllerLeft,
    ctlR: !!scene._vrControllerRight,
    curL: !!(scene._vrCursorLeft && scene._vrCursorLeft.visible),
    curR: !!(scene._vrCursorRight && scene._vrCursorRight.visible),
    ctrls: ctrls.length,
    withMatrix: ctrls.filter((c) => c && c.matrix).length,
    menuGuard: !!(scene._isPointingAtMenu || scene._wasPointingAtMenu || scene._vrMenuTriggerLatch),
    sculpt: !!scene._vrSculpting,
    locked: scene._vrLockedHand || null,
    pick: picked ? (picked._permanentStaticLabel || 'mesh') : null,
  });
  if (buf.length > MAX) buf.shift();

  if (now - lastSave > SAVE_MS) { lastSave = now; save(); }
}

function dump(usePrev) {
  const rows = usePrev ? prev : buf;
  if (!rows || !rows.length) {
    console.log('[vrDiag] nothing recorded' + (usePrev ? ' in the previous session' : ' yet'));
    return rows || [];
  }
  // Collapse runs of identical states: ten minutes of "everything normal" is one line, and the
  // moment something changed is the line you are looking for. A per-second dump of 600 rows
  // hides the transition, which is the only thing in it worth reading.
  const key = (r) => JSON.stringify(r, (k, v) => (k === 't' ? undefined : v));
  const runs = [];
  for (const r of rows) {
    const last = runs[runs.length - 1];
    if (last && key(last.row) === key(r)) { last.until = r.t; last.n++; continue; }
    runs.push({ row: r, until: r.t, n: 1 });
  }
  const table = runs.map((g) => Object.assign({ from: g.row.t, to: g.until, secs: g.n }, g.row, { t: undefined }));
  if (console.table) console.table(table); else table.forEach((r) => console.log(r));
  console.log('[vrDiag] %d samples in %d distinct states%s', rows.length, runs.length,
    usePrev ? ' (previous session)' : '');
  return table;
}

window._vrLog = dump;
export default sampleVR;
