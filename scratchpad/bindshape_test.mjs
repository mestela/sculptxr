import fs from 'fs';

let fails = 0;
const check = (name, ok, extra) => {
  if (!ok) fails++;
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (ok || !extra ? '' : '  — ' + extra));
};
const SKIN = fs.readFileSync(new URL('../src/editing/Skinning.js', import.meta.url).pathname, 'utf8');
const PANEL = fs.readFileSync(new URL('../src/gui/bonePanel.js', import.meta.url).pathname, 'utf8');

// ── THERE WAS NOTHING TO GO BACK TO ───────────────────────────────────────────────────────
//
// matt: "at one point when working on the thigh, the mirrored sculpting operation went strange,
// and it inverted... if i went back to the rest pose, the damage was permanent. is there
// anything stored currently that would allow a mesh to be reset to its rest pose?"
//
// There was not, and not by oversight: `_skinRest` is captured at bind and then deliberately
// overwritten by every sculpt at bind pose and by the posed write-back, because leaving it on
// the pre-sculpt shape would make a joint-radius tweak silently revert the model. So the rest
// shape tracks the damage, and going to the rest pose shows it faithfully.
{
  check('the bind shape is snapshotted at bind',
    /mesh\._skinBindShape = new Float32Array\(mesh\._skinRest\);/.test(SKIN),
    'nothing records the shape the mesh was bound in');

  // The whole value of this copy is that it does NOT follow edits. If anything else writes it,
  // it becomes another _skinRest and the button becomes a no-op that looks like it worked.
  const writes = (SKIN.match(/_skinBindShape\s*(=|\.set\()/g) || []).length;
  check('...and written in exactly two places: the bind, and the unbind that clears it',
    writes === 2, writes + ' writes — a third means it is tracking edits again');

  check('...cleared on unbind with the rest of the bind data',
    /mesh\._skinInvBind = mesh\._skinRest = mesh\._skinSrc = mesh\._skinBindShape = null;/.test(SKIN),
    'a stale bind shape outlives the bind it came from');
}

// ── THE REVERT PUTS BACK ALL THREE, NOT JUST THE ONE YOU CAN SEE ──────────────────────────
//
// The level's vertices are what is drawn; `_skinRest` is what weights re-solve against and what
// unbind restores; `_skinSrc` is the composited rest the skin pass rebuilds from every frame.
// Restoring the drawn one alone would be undone by the next skin pass.
{
  const fn = (SKIN.match(/Skinning\.revertToBindShape = function[\s\S]*?\n\};/) || [''])[0];
  check('the revert exists', fn.length > 100);
  for (const [what, re] of [
    ['the drawn level', /level\.getVertices\(\)\.set\(mesh\._skinBindShape\);/],
    ['_skinRest', /mesh\._skinRest\.set\(mesh\._skinBindShape\);/],
    ['_skinSrc', /mesh\._skinSrc\.set\(mesh\._skinBindShape\);/],
  ]) check('...restores ' + what, re.test(fn), 'the next skin pass rebuilds from what was missed');

  check('...and drops the caches defined against the old rest shape',
    /_skinMushDelta = mesh\._skinMushScratch = null;/.test(fn),
    'the mush deltas describe a shape that no longer exists');

  check('...refusing, with a reason, when there is no bind to go back to',
    /return \{ ok: false, why: 'nothing bound/.test(fn),
    'a silent no-op reads as a broken button');

  check('...and reporting how far it moved',
    /moved/.test(fn),
    '"nothing happened" and "it worked, the damage was small" look identical otherwise');
}

// ── AND IT IS UNDOABLE ────────────────────────────────────────────────────────────────────
//
// "Throw away every sculpt since the bind" is exactly the button someone presses by accident.
{
  check('the panel offers it only when something is bound',
    /\$\{bound \? `[\s\S]*?id="bone-revert"/.test(PANEL),
    'a button that cannot work should not be there to press');
  check('...and pushes an undo state around it',
    /pushStateCustom\?\.\(\s*\n?\s*\(\) => put\(before\), \(\) => put\(after\), false, 'Revert to Bind Shape'\)/.test(PANEL),
    'no way back from a destructive button');
  check('...snapshotting only as many vertices as the bind covers',
    /liveV\.length >= nbF/.test(PANEL),
    'a snapshot longer than _skinRest cannot be written back and throws on undo');
}

console.log(fails ? `\n${fails} FAILURE(S)` : '\nall checks passed');
process.exit(fails ? 1 : 0);
