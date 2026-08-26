// Node harness for the animation panel's DELETE button.
//
// The button had one meaning — "delete whatever key is at the current time" — and matt asked
// for a second: a gutter row already selects its object in the 3D view, so the row IS a
// selection and Delete should be able to remove that object's animation. Two meanings on one
// destructive control is exactly where a wrong guess costs someone their work, so what is
// checked here is the PRECEDENCE, and that the button says which one it is about to do.
//
// Run: node scratchpad/animdelete_test.mjs   (from the repo root)
//
// Defect injections (standing lesson 1):
//   AD_INJECT=trackfirst  the track case is tested before the key case, so Delete wipes a whole
//                         object's animation while keys are selected
//   AD_INJECT=icondead    the TOOLBAR icon goes back to keys only, so a selected track name
//                         leaves it greyed out — the reported bug
//   AD_INJECT=icontrackfirst  the icon deletes the whole track even when keys are selected
//   AD_INJECT=alwayson    the button never dims, so it gives no answer to "is anything selected"
//   AD_INJECT=nosigguard  the DOM is written every frame instead of only when the answer moves
import fs from 'fs';
import path from 'path';

const REPO = '/Users/mattestela/sculptxr';
let ACP = fs.readFileSync(path.join(REPO, 'src/gui/htmlvr/AnimationControlPanel.js'), 'utf8');
let TLW = fs.readFileSync(path.join(REPO, 'src/gui/GuiTimeline.js'), 'utf8');
const TL = TLW;
const REG = fs.readFileSync(path.join(REPO, 'src/editing/AnimationRegistry.js'), 'utf8');

{
  const inj = process.env.AD_INJECT || '';
  if (inj === 'trackfirst') {
    const a = "    if (window._animSelectedKeys?.length) {";
    if (!ACP.includes(a)) throw new Error('inject trackfirst: anchor moved');
    ACP = ACP.replace(a, '    if (false) {');
  } else if (inj === 'icondead') {
    // The toolbar ICON — the one actually in the top right — goes back to keys only, so
    // selecting a track name leaves it greyed out.
    const a = '        disabled: !hasSel && !hasTrackSel,';
    if (!TLW.includes(a)) throw new Error('inject icondead: anchor moved');
    TLW = TLW.replace(a, '        disabled: !hasSel,');
  } else if (inj === 'icontrackfirst') {
    const a = "              if (window._animSelectedKeys?.length) this.deleteSelectedKeys();\n              else this.deleteAnimationFromSelectedObjects();";
    if (!TLW.includes(a)) throw new Error('inject icontrackfirst: anchor moved');
    TLW = TLW.replace(a, '              this.deleteAnimationFromSelectedObjects();');
  } else if (inj === 'alwayson') {
    const a = '    btn.disabled = !on;';
    if (!ACP.includes(a)) throw new Error('inject alwayson: anchor moved');
    ACP = ACP.replace(a, '    btn.disabled = false;');
  } else if (inj === 'nosigguard') {
    const a = '    if (sig === this._lastDelSig) return;';
    if (!ACP.includes(a)) throw new Error('inject nosigguard: anchor moved');
    ACP = ACP.replace(a, '');
  }
}

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

// ── the precedence, evaluated ────────────────────────────────────────────────
//
// Lifted and RUN rather than read, because "which branch wins" is the whole of it and reading
// the order of three ifs is exactly the kind of thing that looks right.
{
  const i = ACP.indexOf("el.querySelector('#acp-del-key')?.addEventListener('click', () => {");
  const body = ACP.slice(ACP.indexOf('{', ACP.indexOf('() => {', i)) + 1,
    ACP.indexOf('\n  });', i));
  check('the Delete handler is liftable', body.length > 0, 'the click wiring moved');

  const run = ({ keys = 0, tracks = [], selIds = [], target = true, mode = 'transform' }) => {
    const did = [];
    const r = { tracks: new Map(tracks.map((id) => [id, {}])),
      deleteShapeKey: () => did.push('shapeKey'),
      deleteTransformKey: () => did.push('xfKey') };
    const timeline = {
      selectedAnimationIds: () => selIds,
      deleteAnimationFromSelectedObjects: () => { did.push('track'); return true; },
    };
    const win = {
      _animSelectedKeys: new Array(keys).fill({}),
      _animCurrentTime: 0,
      _animKeyMode: mode,
      _animPanel: { deleteKey: () => did.push('keys') },
    };
    new Function('reg', '_getTargetMesh', 'main', 'repaint', 'window', body)(
      () => r, () => (target ? {} : null),
      { getGui: () => ({ _ctrlTimeline: timeline }) }, () => {}, win);
    return did;
  };

  // KEYS FIRST, always. A key selection is the narrower statement, and getting this backwards
  // deletes a whole object's animation while the user is looking at three selected keys.
  check('keys selected -> the keys go', run({ keys: 3, tracks: [7], selIds: [7] })[0] === 'keys');
  check('...and nothing else does',
    run({ keys: 3, tracks: [7], selIds: [7] }).length === 1,
    'a second branch running too is a whole track lost to a key delete');

  // A row selected, no keys -> that object's animation.
  check('a selected track with animation -> the track goes',
    run({ keys: 0, tracks: [7], selIds: [7] })[0] === 'track');

  // The old behaviour survives as the last resort, so a bare Delete still does what it did.
  check('nothing selected -> the key at the current time, as before',
    run({ keys: 0, tracks: [], selIds: [] })[0] === 'xfKey');
  check('...respecting the key mode',
    run({ keys: 0, tracks: [], selIds: [], mode: 'shape' })[0] === 'shapeKey');

  // A row whose object has NO animation must not claim the press — there is nothing to delete,
  // and falling through to the key case is what a user pressing Delete on an empty row means.
  check('a selected object with no track falls through',
    run({ keys: 0, tracks: [], selIds: [7] })[0] === 'xfKey',
    'claiming the press and doing nothing looks like the button is broken');

  check('and with no target at all it does nothing rather than throw',
    run({ keys: 0, tracks: [], selIds: [], target: false }).length === 0);
}

// ── the button says which ────────────────────────────────────────────────────
{
  const i = ACP.indexOf('  syncDeleteButton() {');
  const body = ACP.slice(ACP.indexOf('{', i) + 1, ACP.indexOf('\n  }', i));
  check('syncDeleteButton is liftable', body.length > 0);

  const run = ({ keys = 0, tracks = [], selIds = [], prev = null }) => {
    const btn = { disabled: false, title: '', _cls: new Set(),
      classList: { toggle(c, on) { on ? btn._cls.add(c) : btn._cls.delete(c); } } };
    const self = { _element: { querySelector: () => btn },
      _main: { getGui: () => ({ _ctrlTimeline: { selectedAnimationIds: () => selIds } }) },
      _lastDelSig: prev };
    const win = { _animSelectedKeys: new Array(keys).fill({}),
      _animationRegistry: { tracks: new Map(tracks.map((id) => [id, {}])) } };
    new Function('window', body).call(self, win);
    return { btn, self };
  };

  check('nothing selected -> disabled', run({}).btn.disabled === true);
  check('...and dimmed', run({}).btn._cls.has('acp-dim') === true,
    'a destructive button that is always lit gives no answer to "is anything selected"');
  check('...and says so', /nothing selected/i.test(run({}).btn.title));

  const withKeys = run({ keys: 2 });
  check('keys selected -> enabled', withKeys.btn.disabled === false);
  check('...and says it means the keys', /keys/i.test(withKeys.btn.title));

  const withTrack = run({ tracks: [7], selIds: [7] });
  check('a track with animation -> enabled', withTrack.btn.disabled === false);
  check('...and says it means the animation', /animation/i.test(withTrack.btn.title),
    'the two meanings must not be a guess on a destructive control');

  check('a selected object with no animation -> still disabled',
    run({ tracks: [], selIds: [7] }).btn.disabled === true);

  // THE GUARD. This is called from the timeline's draw, so it must not write to the DOM on
  // every frame — the panel rasterises to a texture in VR and a per-frame class toggle is not
  // free. It also must not go stale: a CHANGED answer has to get through.
  const same = run({ keys: 2, prev: null });
  const again = run({ keys: 2, prev: same.self._lastDelSig });
  check('an unchanged answer touches nothing', again.btn.title === '',
    'called from draw(), so an unguarded write is one per frame');
  const changed = run({ keys: 0, prev: same.self._lastDelSig });
  check('a changed answer still gets through', changed.btn.title !== '',
    'a guard that never lets go is just a bug that is cheap to run');
}

// ── undo comes from the registry, not from a second path ─────────────────────
//
// deleteAnimationForIds already pushes its own undo entry. Writing another one here would give
// two entries for one action, and the second would restore a snapshot taken after the first had
// already run.
{
  check('the registry pushes undo for a track delete',
    /deleteAnimationForIds\(ids\) \{[\s\S]{0,1400}?pushStateCustom\(/.test(REG),
    'without this the track delete is unrecoverable');
  const i = ACP.indexOf("el.querySelector('#acp-del-key')");
  const body = ACP.slice(i, ACP.indexOf('\n  });', i));
  check('...and the button does NOT push a second one',
    !/pushStateCustom/.test(body),
    'two entries for one action, and the second restores a state the first already changed');
}

// ── the row selection is the object selection ────────────────────────────────
{
  check('picking a row re-reads the button',
    /_setGraphTarget\(meshId\) \{[\s\S]{0,1400}?_notifySelectionChanged\(\)/.test(TL),
    'the row, the scene object and Delete’s target are one thing');
  check('and so does a redraw, for every other way a selection changes',
    /draw\(\) \{\n[\s\S]{0,220}?this\._notifySelectionChanged\(\);/.test(TL),
    'key selection moves in a dozen places; chasing them all is how one gets missed');
}


// ── THE TOOLBAR ICON, which is the control that was actually asked about ─────
//
// The first pass wired the "Delete" text button in the Keyframes grid. The one matt means is
// the trash ICON in the timeline toolbar top right — a different control, with its own enabled
// flag and its own handler. Both now follow the same rule; this section is about the icon.
{
  const defs = TLW.slice(TLW.indexOf('const hasSel = !!(window._animSelectedKeys?.length);'),
    TLW.indexOf("id: 'delkey'") + 400);
  check('the icon is enabled by a selected track as well as by keys',
    /disabled: !hasSel && !hasTrackSel,/.test(defs),
    'this is the reported bug: the name goes yellow and the icon stays dead');
  check('...and "a selected track" means one that HAS animation',
    /_delReg\.tracks\?\.has\(id\)/.test(defs),
    'a row with no track would light the button over nothing to delete');
  check('...read from the same selection the row click sets',
    /this\.selectedAnimationIds\(\)\.some/.test(defs),
    'the row, the 3D object and the button must agree, or one of them is lying');
  check('...and it says which of the two it means',
    /tooltip: hasTrackSel \? 'Delete this object/.test(defs));

  // The handler, evaluated: keys still win.
  const i = TLW.indexOf("case 'delkey':");
  const body = TLW.slice(TLW.indexOf('\n', i), TLW.indexOf('break;', i));
  const run = (keys) => {
    const did = [];
    const self = { deleteSelectedKeys: () => did.push('keys'),
      deleteAnimationFromSelectedObjects: () => did.push('track') };
    new Function('window', body).call(self, { _animSelectedKeys: new Array(keys).fill({}) });
    return did[0];
  };
  check('icon: keys selected -> the keys go', run(2) === 'keys',
    'the other way round wipes an object’s animation while keys are selected');
  check('icon: no keys -> the track goes', run(0) === 'track');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
