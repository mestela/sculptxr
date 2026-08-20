import { VERSION } from '../Version.js';

// `window._whyNoPick()` — why is the ray finding nothing?
//
// Written for a specific failure that has now happened twice, both times on the production
// build, both times at night, and both times gone by morning: the brush radius indicator does
// not appear and Grab does nothing, while the rest of the app is fine. That reads as a broken
// deploy, and it is worth saying plainly why it almost certainly is not one — the build is a
// SINGLE bundle with no code splitting, index.html is served no-store, and the asset names are
// content hashes. A stale cache therefore hands you an old app that WORKS; there is no partial
// build to be had over the network. What does produce exactly these two symptoms is state:
// three separate flags, each of which quietly removes meshes from the picking scans, and none
// of which announces itself anywhere on screen.
//
//   mesh._selectLocked   the per-mesh lock. Skipped by ALL THREE picking scans, so a locked
//                        mesh cannot be picked, selected, grabbed OR SCULPTED — the brush has
//                        nothing to hover, so the radius indicator has nothing to draw.
//                        Skinning.bind() sets this on every mesh it binds, and it is saved in
//                        the file, so it survives a reload of that scene.
//   main._lockSelection  the Lock Selection toggle: the scans are restricted to the ACTIVE
//                        mesh. With a joint or a pin selected, that leaves nothing sculptable.
//   window._animPlaying  playback suppresses the cursor by design (it is a flipbook, not an
//                        edit surface). Only hides the indicator; does not stop Grab.
//
// Every one of them is invisible, sticky, and indistinguishable from a broken build from the
// outside. So the answer is not to reason about which it was — it is to ask, in one line, at
// the moment it happens and BEFORE reloading (a reload clears two of the three and destroys
// the evidence).
function whyNoPick() {
  const main = window.app || window.sculptgl;
  if (!main) { console.log('[whyNoPick] no app on window yet'); return; }

  const meshes = main.getMeshes ? (main.getMeshes() || []) : [];
  const active = main.getMesh ? main.getMesh() : null;
  const name = (m) => (m && (m._permanentStaticLabel || ('mesh#' + (m.getID ? m.getID() : '?')))) || 'none';
  const sm = main.getSculptManager ? main.getSculptManager() : null;
  const tool = sm && sm.getCurrentTool ? sm.getCurrentTool() : null;

  const rows = meshes.map((m) => ({
    name: name(m),
    visible: m.isVisible ? m.isVisible() : '?',
    pickable: m.isPickable !== false,
    selectLocked: !!m._selectLocked,
    bound: !!m._skinW,
    joint: !!m._isBone,
  }));

  const real = rows.filter((r) => !r.joint);
  const blocked = real.filter((r) => r.selectLocked || !r.visible || !r.pickable);

  console.log('[whyNoPick] build %s (deployed %s)', VERSION,
    window._deployedVersion || 'not checked yet');
  console.log('[whyNoPick] lockSelection=%s animPlaying=%s skinPause=%s xr=%s tool=%s',
    !!main._lockSelection, !!window._animPlaying, !!window._skinPause, !!main._xrSession,
    tool && tool.constructor ? tool.constructor.name : 'none');
  console.log('[whyNoPick] active selection: %s%s', name(active),
    active && active._isBone ? ' (A JOINT — not a sculptable mesh)' : '');
  if (console.table) console.table(rows); else rows.forEach((r) => console.log(r));

  // The verdict, in the order the scans actually apply the rules, so the first line printed is
  // the first thing that would have to be undone.
  const say = [];
  if (main._lockSelection) {
    say.push('Lock Selection is ON: only "' + name(active) + '" can be picked. ' +
      'Fix: app._lockSelection = false');
  }
  if (blocked.length) {
    say.push(blocked.length + ' of ' + real.length + ' meshes are out of the picking scans (' +
      blocked.map((r) => r.name + (r.selectLocked ? ':locked' : r.visible ? ':unpickable' : ':hidden')).join(', ') +
      '). Fix for a lock: app.getMeshes().forEach(m => m._selectLocked = false)');
  }
  if (window._animPlaying) say.push('Playback is running, which hides the brush cursor by design.');
  if (!real.length) say.push('There are no sculptable meshes in the scene at all.');
  if (!say.length) say.push('Nothing here would stop a pick — the cause is somewhere else, so ' +
    'grab a console log of the failing frame rather than reloading.');
  say.forEach((s) => console.log('[whyNoPick] ' + s));
  return rows;
}

window._whyNoPick = whyNoPick;
export default whyNoPick;
