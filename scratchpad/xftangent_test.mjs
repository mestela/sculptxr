// Node harness for the graph editor's PER-GROUP tangents and framing.
//
// matt: "when i went into the S (scale) view for the graph editor for a pin the graph looks
// crazy, even though the actual keys are all the same."
//
// Two independent faults, either of which alone would have been survivable:
//
// 1. Tangent handles were stored per KEY and per CHANNEL but NOT per GROUP, so a handle dragged
//    on a translation curve was read back as the tangent of the rotation and scale curves too.
//    `dv` is a value-space number (-deltaY / zoomY), so on another group it is in the wrong
//    UNITS, not merely the wrong amount.
// 2. A channel whose keys are all identical -- scale, on anything never scaled -- was framed to
//    a span floor of 1e-3, i.e. zoomed some hundred thousand times, where any wobble fills the
//    graph.
//
// Run: node scratchpad/xftangent_test.mjs
//   XF_INJECT=ungrouped   tangents go back to one ungrouped key shared by all three groups
//   XF_INJECT=centerungrouped  the centre drag's vertical scale writes ungrouped again, so
//                         every key lands in the active group and the other curves sit still
//   XF_INJECT=pergrouppivot  keys stop scaling about the box's shared edge, so a mixed
//                         selection can no longer be collapsed onto one line
//   XF_INJECT=rawbox      the box writes display values straight into keys, so a normalised
//                         scale writes -1..1 numbers into real rotations
//   XF_INJECT=sharedtimes   a weight key's time is read from the transform times array, so it
//                         reports an unrelated key's time
//   XF_INJECT=nogroupstart  drag start values are read from the active group, so every key of a
//                         channel collapses onto one value when dragged
//   XF_INJECT=untagged    the marquee stops tagging keys with their group, so they highlight
//                         on the translation curve whatever they actually are
//   XF_INJECT=dashed      curves go back to being drawn with a dash pattern
//   XF_INJECT=onetriple   the gutter lists only the active group's triple again
//   XF_INJECT=reframe     toggling a channel reframes the view, so the zoom jumps around
//   XF_INJECT=strokeout   the stroke moves outside the channel loop, so only the last channel
//                         of each group is drawn -- with the brace count still correct
//   XF_INJECT=pixelnorm   normalise maps to screen pixels again, so the axis and the grid are
//                         left speaking raw units while the curves are normalised
//   XF_INJECT=fitactive   Fit All measures only the active group again
//   XF_INJECT=lostgroup   one end of each curve segment forgets its group and reads the active
//                         one instead, so every non-active curve runs to the wrong value
//   XF_INJECT=tinyspan    a flat channel is framed to the 1e-3 floor again
import fs from 'fs';
import path from 'path';

const REPO = '/Users/mattestela/sculptxr';
let XF = fs.readFileSync(path.join(REPO, 'src/editing/xfChannel.js'), 'utf8');
let TL = fs.readFileSync(path.join(REPO, 'src/gui/GuiTimeline.js'), 'utf8');
let HELP = fs.readFileSync(path.join(REPO, 'src/gui/TimelineHelper.js'), 'utf8');
const REG_SRC = fs.readFileSync(path.join(REPO, 'src/editing/AnimationRegistry.js'), 'utf8');
const VR = fs.readFileSync(path.join(REPO, 'src/gui/vr/GuiVRAnimation.js'), 'utf8');

const inject = process.env.XF_INJECT || '';
const cut = (src, a, b, n) => {
  if (!src.includes(a)) throw new Error('inject ' + n + ': anchor moved');
  return src.replace(a, b);
};
if (inject === 'ungrouped') {
  XF = cut(XF, "export function xfTanPrefix(group) { return 'trans_' + (group || xfGroup()) + '_'; }",
    "export function xfTanPrefix(group) { return 'trans_'; }", inject);
} else if (inject === 'centerungrouped') {
  TL = cut(TL, '          xfWrite(track, initKey.index, initKey.channel,\n                  this._rawVal(newVal, initKey.group), initKey.group);',
    '          xfWrite(track, initKey.index, initKey.channel, newVal);', inject);
} else if (inject === 'pergrouppivot') {
  HELP = cut(HELP, '        newVal = initialBox.minV + (initialVal - initialBox.minV) * factor;',
    '        newVal = (sk.val ?? 0) * factor;', inject);
} else if (inject === 'rawbox') {
  TL = cut(TL, '            (v, g) => this._rawVal(v, g));', '            null);', inject);
} else if (inject === 'sharedtimes') {
  TL = cut(TL, "    if (k.type === 'transform') return xfTimes(tr, k.group)?.[k.index] ?? 0;",
    "    if (k.type === 'transform') return tr.times?.[k.index] ?? 0;", inject);
} else if (inject === 'nogroupstart') {
  TL = cut(TL, "                  ? xfRead(tr, k.index, k.channel !== undefined ? k.channel : 0, k.group)",
    "                  ? xfRead(tr, k.index, k.channel !== undefined ? k.channel : 0)", inject);
} else if (inject === 'untagged') {
  HELP = cut(HELP, "              newKeys.push({ meshId: trackId, type: 'transform', index: i, channel: c,\n                             group: grp, time: t });",
    "              newKeys.push({ meshId: trackId, type: 'transform', index: i, channel: c, time: t });", inject);
} else if (inject === 'dashed') {
  TL = cut(TL, "        ctx.setLineDash([]);\n        for (const grp of xfVisible()) {",
    "        ctx.setLineDash([6, 3]);\n        for (const grp of xfVisible()) {", inject);
} else if (inject === 'onetriple') {
  TL = cut(TL, "      if (g === 'weight') continue;\n      for (let c = 0; c < 3; c++) {\n        labels.push(PREFIX[g] + 'XYZ'[c]);",
    "      if (g !== xfGroup()) continue;\n      for (let c = 0; c < 3; c++) {\n        labels.push(PREFIX[g] + 'XYZ'[c]);", inject);
} else if (inject === 'reframe') {
  TL = cut(TL, '    tlLog(`toggle group ${g} -> ${xfIsVisible(g) ? \'on\' : \'off\'}`,',
    '    this._frameXfGroup();\n    tlLog(`toggle group ${g} -> ${xfIsVisible(g) ? \'on\' : \'off\'}`,', inject);
} else if (inject === 'strokeout') {
  // The stroke moves outside the channel loop again -- the brace count stays right, so only a
  // depth check can see it.
  TL = cut(TL, '          ctx.stroke();\n        }\n        }',
    '        }\n          ctx.stroke();\n        }', inject);
} else if (inject === 'pixelnorm') {
  TL = cut(TL, '    return this.valueToY(this._normVal(val, grp, ranges));',
    '    return HEADER_H + 100 - this._normVal(val, grp, ranges) * 50;', inject);
} else if (inject === 'fitactive') {
  TL = cut(TL, '            const val = xfRead(track, i, c, grp);\n            if (typeof val !== \'number\' || !isFinite(val)) continue;',
    '            const val = xfRead(track, i, c);\n            if (typeof val !== \'number\' || !isFinite(val)) continue;', inject);
} else if (inject === 'lostgroup') {
  TL = cut(TL, 'const val2 = xfRead(track, i + 1, channel, grp);',
    'const val2 = xfRead(track, i + 1, channel);', inject);
} else if (inject === 'tinyspan') {
  TL = cut(TL, "                                 : (FLAT_SPAN[xfGroup()] || 1);",
    "                                 : 1e-3;", inject);
}

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

// ── THE PREFIX, run for real ──────────────────────────────────────────────────────────
// Built OUTSIDE the template literal: inside `${}` an escape like \\s is parsed as JS, so the
// regex ends up matching a literal backslash and the import line survives into the Function.
const body = XF.split('\n')
  .filter((l) => !/^import /.test(l))
  .join('\n')
  .replace(/^export /gm, '');
// THREE is handed in rather than stubbed: the module builds a scratch Quaternion at load, and
// the rotation accessors are real code that would be a lie if faked. Only the three functions
// under test are returned.
const THREE = await import(path.join(REPO, 'node_modules/three/build/three.module.js'));
const mod = new Function('win', 'THREE',
  'const window = win;\n' + body + '\nreturn { xfTanPrefix, xfTanGet, xfGroup };');
const win = {};
const M = mod(win, THREE);

win._animXfGroup = 'pos';
const asPos = M.xfTanPrefix();
win._animXfGroup = 'scale';
const asScale = M.xfTanPrefix();
win._animXfGroup = 'rot';
const asRot = M.xfTanPrefix();
check('each group has its own tangent namespace',
  asPos !== asScale && asScale !== asRot && asPos !== asRot,
  [asPos, asScale, asRot].join(' / ')
    + ' -- one shared key means a translation handle IS the scale curve\'s tangent');

// A handle dragged in one group must be invisible from another.
const tr = { tangentOffsets: {} };
win._animXfGroup = 'pos';
tr.tangentOffsets[M.xfTanPrefix() + '2_right_dv_0'] = 0.3;
check('a handle dragged on translate is readable there', M.xfTanGet(tr, '2_right_dv_0') === 0.3);
win._animXfGroup = 'scale';
check('...and invisible from scale',
  M.xfTanGet(tr, '2_right_dv_0') === undefined,
  'got ' + M.xfTanGet(tr, '2_right_dv_0') + ' -- a translation tangent on a scale curve is in '
    + 'the wrong units, not just the wrong amount');
win._animXfGroup = 'rot';
check('...and from rotate', M.xfTanGet(tr, '2_right_dv_0') === undefined);

// LEGACY FILES. Ungrouped keys were authored while looking at some group, almost always
// translate. They read as pos and nothing else.
const old = { tangentOffsets: { 'trans_2_right_dv_0': 0.7 } };
win._animXfGroup = 'pos';
check('a legacy ungrouped tangent still reads as translate', M.xfTanGet(old, '2_right_dv_0') === 0.7,
  'an old scene must keep the handles it was saved with');
win._animXfGroup = 'scale';
check('...and stops leaking into the other groups',
  M.xfTanGet(old, '2_right_dv_0') === undefined);

// ── EVERY SITE, or the write and the read disagree ────────────────────────────────────
for (const [name, src] of [['GuiTimeline', TL], ['TimelineHelper', HELP], ['GuiVRAnimation', VR]]) {
  check(name + ' uses the grouped prefix',
    /xfTanPrefix\(\)/.test(src) && !/\? 'trans_' :/.test(src),
    'a file still writing the ungrouped key puts handles somewhere the reader will not look');
}
// ...and NAMING the group, now that several are drawn at once. Defaulting to the active group
// was correct while the strip was a radio and is wrong the moment two curves share the graph.
check('the curve reads its tangents through the same accessor, for ITS group',
  /const rightDv = xfTanGet\(track, `\$\{i\}_right_dv_\$\{channel\}`, grp\);/.test(TL)
    && /const leftDv = xfTanGet\(track, `\$\{i \+ 1\}_left_dv_\$\{channel\}`, grp\);/.test(TL));
check('...including whether it HAS tangents at all',
  /const hasTangents = xfTanGet\(track, `\$\{i\}_right_dv_\$\{channel\}`, grp\) !== undefined/.test(TL),
  'reading this one ungrouped would draw handles the curve does not use');
// And the handle DRAWING follows the selected key's group rather than the global active one.
check('the tangent handles follow the selected key\'s group',
  /const selGrp = \(singleSelected && singleSelected\.group\) \|\| xfGroup\(\);/.test(TL)
    && /const rightDv = xfTanGet\(track, `\$\{i\}_right_dv_\$\{selChannel\}`, selGrp\);/.test(TL));

// ── NO READ MAY FORGET ITS GROUP ──────────────────────────────────────────────────────
//
// The curve is drawn per group now, so EVERY read inside that loop has to name the group. One
// that does not falls back to the ACTIVE group, and the result is a segment running from this
// group's value at one end to another group's at the other -- matt: "all curves except
// translation are still drawing very strangely between keys." Translation looked right only
// because it was usually the active group, so both ends agreed by accident.
//
// This came from patching the reads by enumerating them one at a time and missing `val2`, the
// END of each segment. A structural check is the answer: no three-argument channel read may
// survive anywhere in the file.
{
  // COUNT THE ARGUMENTS, don't pattern-match the names. The first version of this check looked
  // for `xfRead(track, ..., channel)` specifically, so it saw nothing wrong with
  // `xfRead(tr, k.index, k.channel ?? 0)` -- and that one gave every selected key its start
  // value from the ACTIVE group, which made a drag land every X key on the same number.
  const callsIn = (src, file) => {
    const out = [];
    const re = /xfRead\(/g;
    let m;
    while ((m = re.exec(src))) {
      let i = m.index + m[0].length, depth = 1, args = 1, arg = '';
      const parts = [];
      while (i < src.length && depth > 0) {
        const ch = src[i];
        if (ch === '(' || ch === '[') depth++;
        else if (ch === ')' || ch === ']') { depth--; if (depth === 0) break; }
        if (ch === ',' && depth === 1) { parts.push(arg.trim()); arg = ''; args++; }
        else arg += ch;
        i++;
      }
      parts.push(arg.trim());
      if (parts.length < 4) out.push(file + ': xfRead(' + parts.join(', ') + ')');
    }
    return out;
  };
  // WRITES TOO. There are two vertical-scale paths -- the edge handles go through
  // scaleKeysVertical, the centre drag through _setKeyVal -- and only the first was grouped, so
  // the centre drag wrote every key into whichever group was ACTIVE and the other curves never
  // moved. matt: "still ignoring curves when i scale vertically with the toolbox."
  const writesIn = (src, file) => {
    const out = [];
    const re = /xfWrite\(/g;
    let m;
    while ((m = re.exec(src))) {
      let i = m.index + m[0].length, depth = 1, arg = '';
      const parts = [];
      while (i < src.length && depth > 0) {
        const ch = src[i];
        if (ch === '(' || ch === '[') depth++;
        else if (ch === ')' || ch === ']') { depth--; if (depth === 0) break; }
        if (ch === ',' && depth === 1) { parts.push(arg.trim()); arg = ''; }
        else arg += ch;
        i++;
      }
      parts.push(arg.trim());
      if (parts.length < 5) out.push(file + ': xfWrite(' + parts.join(', ') + ')');
    }
    return out;
  };
  // Comments stripped first: the note above this fix QUOTES the defective call, and a scanner
  // that reads prose finds the bug in the explanation of the bug.
  const noComments = (src) => src.replace(/^\s*\/\/.*$/gm, '');
  const badWrites = [...writesIn(noComments(TL), 'GuiTimeline'),
                     ...writesIn(noComments(HELP), 'TimelineHelper'),
                     ...writesIn(noComments(REG_SRC), 'AnimationRegistry')];
  check('every value write names its group',
    badWrites.length === 0,
    badWrites.join('  |  ') + ' -- an ungrouped write lands in the ACTIVE group, so the key it '
      + 'was meant for never moves');

  const stragglers = [...callsIn(noComments(TL), 'GuiTimeline'),
                      ...callsIn(noComments(HELP), 'TimelineHelper')];
  check('every value read names its group',
    stragglers.length === 0,
    stragglers.join('  |  ') + ' -- an ungrouped read falls back to the active group, so a '
      + 'key reads another group\'s value and a drag collapses them together');
  // Both ends of the segment specifically, since it was the second one that was missed and the
  // first one that made it look fine.
  check('...at BOTH ends of every curve segment',
    /const val1 = xfRead\(track, i, channel, grp\);/.test(TL)
      && /const val2 = xfRead\(track, i \+ 1, channel, grp\);/.test(TL));
}

// ── NORMALISE IS A -1..1 VIEW, NOT A SCREEN TRICK ─────────────────────────────────────
//
// matt: "i'd expect the graph zoom range to jump to -1 to 1 vertically, and for each channel
// group to find its min and max value across xyz, then fit that range to the -1 to 1."
//
// The first version mapped values straight to SCREEN pixels, which looks like normalising until
// you notice the axis, the gridlines and the drag maths are all still in raw units -- so it read
// as "position half fitted, rotation and scale barely touched".
{
  check('a normalised value goes through the ordinary value axis',
    /_valY\(val, grp, ranges\) \{[\s\S]{0,200}?return this\.valueToY\(this\._normVal\(val, grp, ranges\)\);/.test(TL),
    'mapping to pixels directly leaves the ruler and the grid speaking a different language '
      + 'from the curves');
  check('...as (value - mid) / half, so each group fills -1..1',
    /return \(val - r\.mid\) \/ r\.half;/.test(TL));
  check('...measured across all three channels of the group together',
    /for \(let i = 0; i < n; i\+\+\) for \(let c = 0; c < 3; c\+\+\) \{[\s\S]{0,220}?xfRead\(track, i, c, g\)/.test(TL),
    'per-channel normalising would flatten the relative proportions of X, Y and Z');
  check('turning it on frames the view on -1..1',
    /this\._zoomY = \(band \* 0\.8\) \/ 2;/.test(TL) && /this\._panY = 0;/.test(TL));
  check('...and turning it off restores the raw view rather than leaving that zoom behind',
    /this\._rawView = \{ zoomY: this\._zoomY, panY: this\._panY \};/.test(TL)
      && /this\._zoomY = this\._rawView\.zoomY;/.test(TL));
  // A group with no variation must still get a mapping, or it silently falls back to raw units
  // -- which is how a missing `scales` array read as "normalise did nothing to scale".
  check('a flat or empty group still gets a defined mapping',
    /if \(!isFinite\(lo\) \|\| !isFinite\(hi\)\) \{ lo = 0; hi = 0; \}/.test(TL));
  // And the drag has to come BACK out of that space.
  check('a value drag is scaled back out of normalised units',
    /const d = _nr \? dVal \* _nr\.half : dVal;/.test(REG_SRC),
    'otherwise a 2-degree nudge on a 180-degree curve lands as 180');
}

// ── FIT ALL FITS EVERYTHING THAT IS SHOWING ───────────────────────────────────────────
// SCOPED TO autoFitGraph. The curve-drawing loop opens with the same `for (const grp of
// xfVisible())` and reads with the same call, so an unscoped regex passes on THAT while the fit
// is still measuring one group -- the check would then confirm the very bug it is guarding.
const FIT = (() => {
  const at = TL.indexOf('  autoFitGraph() {');
  return at < 0 ? '' : TL.slice(at, TL.indexOf('\n  }', at));
})();
check('Fit All measures every visible group, not just the active one',
  /for \(const grp of xfVisible\(\)\) \{/.test(FIT) && /xfRead\(track, i, c, grp\)/.test(FIT)
    && !/xfRead\(track, i, c\)/.test(FIT),
  'measured ungrouped it fits the active group and leaves the others off the top -- which '
    + 'reads as "fit only works on X"');
check('...including the weight channel, which has its own keys',
  /xfIsVisible\('weight'\)/.test(FIT) && /xfWeightTrack\(track\)/.test(FIT));

// ── KEY DOTS ──────────────────────────────────────────────────────────────────────────
const keyR = Number((TL.match(/const KEY_R = (\d+);/) || [])[1]);
check('key dots are drawn at the shared, smaller radius',
  keyR === 2 && !/ctx\.arc\(x, y, 4, 0, Math\.PI \* 2\)/.test(TL),
  'KEY_R ' + keyR + ' -- at 4 they crowded a dense curve and hid the shape they sit on');

// ── A PATH IS BEGUN AND FINISHED AT THE SAME NESTING DEPTH ────────────────────────────
//
// Wrapping the curve and dot loops in a per-group loop put the new closing brace in the WRONG
// PLACE twice: before `ctx.stroke()` and before `ctx.fill()`. The brace COUNT stayed correct so
// the file parsed and `node --check` was happy -- but stroke ran once per GROUP instead of once
// per channel, so only the last channel to call beginPath() was ever drawn. matt: "it only shows
// Z values ... it always seems to only show a single value across all."
//
// A syntax check cannot see this. Depth can: a beginPath and the stroke or fill that finishes it
// must sit at the same brace depth, or the finish is outside the loop that started it.
{
  const from = TL.indexOf('// 5. Draw Curves for Active Mesh');
  const to = TL.indexOf('// ── THE PIN WEIGHT CURVE');
  const region = from >= 0 && to > from ? TL.slice(from, to) : '';
  check('the curve block was found', region.length > 0);

  let depth = 0;
  const opens = [];       // depth at each beginPath
  const closes = [];      // depth at each stroke/fill
  for (const line of region.split('\n')) {
    const code = line.replace(/\/\/.*$/, '');
    if (/ctx\.beginPath\(\)/.test(code)) opens.push(depth);
    if (/ctx\.(stroke|fill)\(\)/.test(code)) closes.push(depth);
    for (const ch of code) { if (ch === '{') depth++; else if (ch === '}') depth--; }
  }
  check('every path begun is finished at the same nesting depth',
    opens.length === closes.length && opens.every((d, i) => d === closes[i]),
    'begins at depths [' + opens.join(',') + '], finishes at [' + closes.join(',') + '] -- a '
      + 'finish at a shallower depth ran outside the loop that began the path, so only the last '
      + 'iteration is drawn');
}

// ── EVERY SELECTION ROUTE TAGS THE GROUP ──────────────────────────────────────────────
//
// A transform key means nothing without its group once several are on screen. The click path
// was tagged first and the other two were not -- matt: "if i use the marquee tool, translate
// keys show they are selected and highlighted in yellow, rotation keys do not. they're
// selected, i can move them, but they're not yellow."
//
// The move working is the same fact as the highlight failing: an untagged key falls back to the
// ACTIVE group, which happened to be the one being marquee'd.
{
  const routes = [
    ['marquee', HELP, /newKeys\.push\(\{ meshId: trackId, type: 'transform', index: i, channel: c,\s*\n\s*group: grp, time: t \}\)/],
    ['curve click', TL, /type: 'transform', index: i, channel: desc\.channel, group: desc\.group/],
    ['key click', TL, /type: 'transform', index: i, channel: c,\s*\n\s*group: grp, startVal: val/],
  ];
  for (const [name, src, re] of routes) {
    check('the ' + name + ' route tags the key with its group', re.test(src),
      'an untagged key falls back to the active group -- it moves the right thing only by '
        + 'luck, and highlights on the wrong curve');
  }
  check('...and the curve hit test searches every visible group',
    /for \(const grp of xfVisible\(\)\) \{[\s\S]{0,300}?return \{ kind: 'transform', channel: c, group: grp \};/.test(TL));
  // The marquee's bounds are screen-derived, so under normalise they are in normalised space.
  check('the marquee compares in the same space it was drawn in',
    /const val = nr \? \(raw - nr\.mid\) \/ nr\.half : raw;/.test(HELP),
    'otherwise the box you drew and the keys it catches are measured in different units');
}

// ── A KEY'S TIME COMES FROM ITS OWN TRACK ─────────────────────────────────────────────
//
// Every transform group shares `track.times`, so a key index means the same thing across T, R
// and S. The weight channel does NOT -- it keeps its own times -- so reading a weight key's time
// out of `track.times` returns whatever transform key happens to sit at that index. Not a wrong
// number: an unrelated one. That is enough to put the transform box's extent somewhere else and
// to retime the wrong key.
check('there is one accessor for which times array a group lives on',
  /export function xfTimes\(tr, group\) \{[\s\S]{0,260}?if \(group === 'weight'\)/.test(XF));
{
  const sites = [
    ['the key-time lookup', /if \(k\.type === 'transform'\) return xfTimes\(tr, k\.group\)\?\.\[k\.index\] \?\? 0;/],
    ['the transform box capture', /time = xfTimes\(tr, sk\.group\)\?\.\[sk\.index\];/],
    ['the retime writer', /const _times = initKey\.type === 'transform' \? xfTimes\(track, initKey\.group\) : null;/],
  ];
  for (const [name, re] of sites) {
    check(name + ' goes through it', re.test(TL),
      'reading tr.times directly is right for T, R and S and wrong for weight');
  }
  check('...and a weight key\'s VALUE comes from the scalar track too',
    /sk\.group === 'weight'\s*\n\s*\? \(xfWeightTrack\(tr\)\?\.values\?\.\[sk\.index\]\)/.test(TL));
}

// ── THE TRANSFORM BOX IS A BOX IN THE VIEW ────────────────────────────────────────────
//
// Dragging its top edge scales about its bottom edge, whatever the curves inside are made of.
// That only works if the box and the keys are measured in the SAME space -- and with Normalise
// on they were not: the box's extent came from raw values while the curves were drawn
// normalised, so the box sat where the keys were not and the scale mixed a normalised target
// with raw values. In raw mode it was already correct, and must stay untouched.
{
  check('the box measures its extent in display space',
    (TL.match(/val = this\._dispVal\(/g) || []).length >= 2,
    'both extent sites -- the box is drawn around what you can see, not around raw numbers');
  check('...and the captured start values too',
    /val  = this\._dispVal\(/.test(TL));
  check('...and the write converts back out of it',
    /\(v, g\) => this\._rawVal\(v, g\)/.test(TL)
      && /back\(newVal, sk\.group\), sk\.group\);/.test(HELP),
    'one consistent space for the arithmetic; only the final write leaves it');
  // Raw mode has to be the identity, or this "fix" changes behaviour that was already right.
  check('with Normalise off both conversions are the identity',
    /_dispVal\(raw, grp\) \{\s*\n\s*if \(!this\._xfNorm\(\)\) return raw;/.test(TL)
      && /_rawVal\(disp, grp\) \{\s*\n\s*if \(!this\._xfNorm\(\)\) return disp;/.test(TL),
    'raw mode already scaled about the box edges correctly and must not change');
  // The pivot is the opposite edge -- that is what the UI implies.
  // The FACTOR still comes from the box the user dragged -- one drag, one meaning -- while the
  // PIVOT is per group. Asserted behaviourally above; this pins the shape so the two cannot
  // drift back together.
  check('the factor and the pivot both come from the dragged box',
    /factor = \(targetVal - initialBox\.minV\) \/ \(initialBox\.maxV - initialBox\.minV\);/.test(HELP)
      && /newVal = initialBox\.minV \+ \(initialVal - initialBox\.minV\) \* factor;/.test(HELP));
  // A weight key's extent has to come from its own track, times and values both.
  check('the box reads weight keys from the weight track',
    (TL.match(/sk\.group === 'weight'\s*\n?\s*\? xfWeightTrack\(track\)\?\.values/g) || []).length >= 1
      && (TL.match(/t   = xfTimes\(track, sk\.group\)/g) || []).length >= 2);
}

// ── THE BOX SCALES EVERY GROUP, ABOUT ONE SHARED PIVOT ────────────────────────────────
//
// The box is a box: dragging its top edge scales every selected key about its bottom edge, and
// the centre drag scales them about the box's midpoint. ONE pivot, shared -- matt: "it would be
// common to scale all the keys to their midpoint, and then move all the keys to zero."
// Collapsing a mixed selection onto a single line is the point, and per-group pivots make it
// impossible: each group collapses onto its own line instead.
//
// (This did briefly scale per group, on my reasoning about mixed units. The bug that appeared
// to justify it was really the centre drag writing keys UNGROUPED, so every key landed in the
// active group and the other curves never moved. Fixed at its source instead.)
//
// Run for real: this is arithmetic, and arithmetic asserted by regex is arithmetic nobody has
// checked.
{
  const src = HELP.slice(HELP.indexOf('static scaleKeysVertical'));
  const body = src.slice(src.indexOf('{') + 1, src.indexOf('\n  }'));
  const scaleKeysVertical = new Function('track', 'initialKeys', 'initialBox', 'targetVal',
    'handle', 'tBox', 'fromDisp', 'xfWrite', body);

  const mk = () => [
    { type: 'transform', group: 'rot', index: 0, channel: 0, val: -180 },
    { type: 'transform', group: 'rot', index: 1, channel: 0, val: 180 },
    { type: 'transform', group: 'pos', index: 0, channel: 0, val: 0 },
    { type: 'transform', group: 'pos', index: 1, channel: 0, val: 2 },
  ];
  const run = (handle, targetVal) => {
    const written = [];
    scaleKeysVertical({}, mk(), { minV: -180, maxV: 180 }, targetVal, handle, {},
      (v) => v, (tr, i, c, v, g) => written.push({ g, i, v }));
    return written;
  };

  // Drag the top edge all the way down to the bottom: EVERY key collapses onto the bottom edge,
  // whatever group it came from. That is the move that makes "scale to a line" possible.
  const flat = run('top', -180);
  check('collapsing the box puts every key on the same line',
    flat.length === 4 && flat.every((w) => Math.abs(w.v - (-180)) < 1e-9),
    flat.map((w) => w.g + ':' + w.v.toFixed(2)).join(' '));

  // Halving it: one shared affine map, so both groups move by the same proportion of the BOX.
  const half = run('top', 0);
  const byG = (g) => half.filter((w) => w.g === g).map((w) => w.v);
  check('halving the box halves every key about the shared bottom edge',
    Math.abs(byG('rot')[1] - 0) < 1e-9 && Math.abs(byG('pos')[1] - (-89)) < 1e-9,
    'rot ' + byG('rot').join(',') + '  pos ' + byG('pos').join(','));
  check('...and every selected key moves, none is skipped',
    half.length === 4 && new Set(half.map((w) => w.g)).size === 2);

  // The bottom handle pivots on the box's top edge.
  const fromBottom = run('bottom', 180);
  check('the bottom handle pivots on the box top',
    fromBottom.every((w) => Math.abs(w.v - 180) < 1e-9),
    fromBottom.map((w) => w.v.toFixed(2)).join(','));

  // A single-group selection is the same as it ever was.
  {
    const written = [];
    scaleKeysVertical({}, mk().filter((k) => k.group === 'pos'), { minV: 0, maxV: 2 }, 1, 'top',
      {}, (v) => v, (tr, i, c, v, g) => written.push({ g, i, v }));
    check('a single-group selection is unaffected by any of this',
      Math.abs(written[0].v - 0) < 1e-9 && Math.abs(written[1].v - 1) < 1e-9,
      written.map((w) => w.v).join(','));
  }
  // The centre drag shares the box midpoint for the same reason.
  check('the centre drag scales about the box midpoint, not per group',
    /const relVal = initKey\.val - initMidV;/.test(TL)
      && /_setKeyVal\(track, initKey, initMidV \+ relVal \* scaleFactorY\);/.test(TL));
}

// ── THE TOOLBAR ───────────────────────────────────────────────────────────────────────
//
// Order: show tangents, tangent mode, marquee, fit all, transform box, snap. The two tangent
// controls were split either side of Fit All, reading as two unrelated buttons rather than a
// switch and its mode. Showing them comes first because it gates the other -- Tied/Free means
// nothing while the handles are hidden.
{
  const at = (id) => TL.indexOf("btns.push({ id: '" + id + "'");
  const order = ['tangents', 'tangents-tied', 'marquee', 'fit', 'tbox', 'snap']
    .map((id) => [id, at(id)]);
  check('every toolbar button is still built', order.every(([, i]) => i > 0),
    order.map(([id, i]) => id + '@' + i).join(' '));
  check('...in the order show-tangents, mode, marquee, fit, box, snap',
    order.every(([, i], k) => k === 0 || i > order[k - 1][1]),
    order.map(([id]) => id).join(' -> '));
  // Three 28px buttons that are all a small outlined square read as the same button.
  check('fit and the transform box are drawn, not glyphs',
    /btn\.id === 'fit'/.test(TL) && /btn\.id === 'tbox'/.test(TL));
  check('...fit is a magnifier with four corner arrows',
    /ctx\.arc\(cx - 1, cy - 1, 4, 0, Math\.PI \* 2\); ctx\.stroke\(\);/.test(TL)
      && /for \(const \[sx, sy\] of \[\[-1, -1\], \[1, -1\], \[-1, 1\], \[1, 1\]\]\)/.test(TL));
  // The magnifier's handle ran into the lower-right corner arrow: the handle reached 5.5 while
  // the arrow's shaft starts 3.2 back from its tip at 8.5, i.e. at 5.3. They touched.
  {
    const handleEnd = Number((TL.match(/ctx\.lineTo\(cx \+ ([\d.]+), cy \+ [\d.]+\); ctx\.stroke\(\);/) || [])[1]);
    const armR = Number((TL.match(/const R = ([\d.]+);/) || [])[1]);
    const armBack = Number((TL.match(/ctx\.moveTo\(ax - sx \* ([\d.]+), ay - sy \* [\d.]+\);/) || [])[1]);
    check('the magnifier handle clears the corner arrow',
      handleEnd > 0 && armR > 0 && armBack > 0 && handleEnd < armR - armBack - 0.5,
      'handle ends at ' + handleEnd + ', arrow shaft starts at ' + (armR - armBack));
  }
  // SNAP: a ruler of fractional ticks, a taller whole-frame tick, and a 1 above it.
  check('the snap icon is drawn as a ruler with a whole-frame tick',
    /btn\.id === 'snap'/.test(TL)
      && /for \(const dx of \[-9, -6, -3, 3, 6, 9\]\)/.test(TL)
      && /ctx\.lineTo\(cx, base - 7\);/.test(TL)
      && /ctx\.fillText\('1', cx, base - 8\.5\);/.test(TL),
    'the point is that a value lands on a WHOLE frame rather than between two');
  check('...with the whole-frame tick taller than the fractions',
    /ctx\.lineTo\(cx \+ dx, base - 3\);/.test(TL) && /ctx\.lineTo\(cx, base - 7\);/.test(TL));
  check('...and the box is a square with eight grab dots',
    /\[-hw, -hh\], \[0, -hh\], \[hw, -hh\],/.test(TL)
      && /\[-hw, hh\], \[0, hh\], \[hw, hh\]/.test(TL),
    'corners and the N/S/E/W midpoints -- what the thing actually looks like on the graph');
}

// ── CURVES ARE SOLID ──────────────────────────────────────────────────────────────────
//
// The groups were dashed to tell three identical red/green/blue triples apart. Once the gutter
// named every row that cue was redundant, and a dashed curve is harder to read the shape of --
// matt: "dashed lines are distracting." Identity is the gutter's job, in words.
{
  const CURVES = (() => {
    const at = TL.indexOf('// 5. Draw Curves for Active Mesh');
    return at < 0 ? '' : TL.slice(at, TL.indexOf('// ── THE PIN WEIGHT CURVE', at));
  })();
  check('no curve is drawn with a dash pattern',
    !/setLineDash\(\[[^\]]+\]\)/.test(CURVES),
    'the gutter says which curve is which; a pattern you have to learn should not have to');
}

// ── THE GUTTER LISTS EVERY VISIBLE GROUP ──────────────────────────────────────────────
//
// matt: "if i have combinations of TRS displayed, the gutter should show them all as channel
// names, right now it only shows a single triple." It listed one X/Y/Z trio for the ACTIVE
// group -- right while the strip was a radio, a lie the moment two groups draw at once.
// Scoped to the row model, and asserting WHICH groups are skipped: the loop existing proves
// nothing if its body still filters down to the active group, which is the bug being guarded.
const ROWMODEL = (() => {
  const at = TL.indexOf('const PREFIX = { pos:');
  return at < 0 ? '' : TL.slice(at, TL.indexOf('this._gutterRowMeta', at));
})();
check('the gutter builds one labelled triple per visible group',
  /for \(const g of xfVisible\(\)\) \{/.test(ROWMODEL)
    && /labels\.push\(PREFIX\[g\] \+ 'XYZ'\[c\]\);/.test(ROWMODEL)
    && /if \(g === 'weight'\) continue;/.test(ROWMODEL)
    && !/xfGroup\(\)/.test(ROWMODEL),
  'weight is the only group skipped here -- anything comparing against the ACTIVE group is the '
    + 'single-triple behaviour wearing a loop');
check('...with a row for weight when it is showing',
  /if \(xfIsVisible\('weight'\)\) \{[\s\S]{0,120}?labels\.push\('Weight'\);/.test(TL));
// The row INDEX stopped being the channel number the moment there were several triples.
check('a row is resolved through the meta the drawing built, not by index arithmetic',
  /rowMeta\.push\(\{ kind: 'xf', group: g, channel: c \}\);/.test(TL)
    && /this\._gutterRowMeta = rowMeta;/.test(TL)
    && /const m = meta\[channel\];/.test(TL),
  'row 4 might be rotation Y -- index arithmetic would toggle translation Y instead');
// Visibility is per group AND channel, or hiding X in translation hides it in rotation too.
check('channel visibility is per group',
  /export function xfChanVisible\(g, c\) \{/.test(XF)
    && !/window\._animChannelVisible\[channel\] !== false : true;/.test(TL),
  'one shared trio of flags would hide the same letter in every group at once');
check('...and every curve, dot and hit-test asks for it that way',
  (TL.match(/xfChanVisible\(grp, c(?:hannel)?\)/g) || []).length >= 4,
  'a site still reading the old array would draw a curve the gutter says is hidden');

// ── TOGGLING A CHANNEL DOES NOT MOVE THE VIEW ─────────────────────────────────────────
//
// Remembering a zoom per group made sense while the strip was a RADIO -- you were changing what
// the graph was OF. As a FILTER it is wrong: adding a curve is not a reason to reframe the ones
// already on screen. matt: "if normalise is off, the zoom shouldn't change."
{
  const SW = (() => {
    const at = TL.indexOf('  _switchXfGroup(g) {');
    return at < 0 ? '' : TL.slice(at, TL.indexOf('\n  }', at));
  })();
  check('toggling a channel leaves the vertical view alone',
    !/_zoomY =/.test(SW) && !/_panY =/.test(SW) && !/_frameXfGroup\(\)/.test(SW),
    'Fit All is the explicit way to reframe; Normalise is the way to share an axis');
}

// ── FRAMING A FLAT CHANNEL ────────────────────────────────────────────────────────────
const flat = Number((TL.match(/const FLAT_SPAN = \{ pos: 1, rot: (\d+), scale: 1 \};/) || [])[1]);
check('a flat channel is framed to a comfortable window, not to the epsilon floor',
  /const span = measured > 1e-6 \? Math\.max\(measured, 1e-3\)/.test(TL)
    && /: \(FLAT_SPAN\[xfGroup\(\)\] \|\| 1\);/.test(TL),
  'all-identical keys framed to 1e-3 is a hundred-thousand-times zoom, where a flat curve '
    + 'looks wild');
check('...in the group\'s own units, since degrees and scene units are not the same number',
  flat === 90, 'rot window ' + flat + ' degrees');
check('...while a channel with a real range is still framed to it',
  /measured > 1e-6 \? Math\.max\(measured, 1e-3\)/.test(TL));

console.log(failures ? '\n' + failures + ' FAILURE(S)' : '\nall checks passed');
process.exit(failures ? 1 : 0);
