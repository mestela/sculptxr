// Lane height in the dopesheet.
//
// The rule — share the panel height between lanes, floor of four slots — was written out at
// FIVE call sites: the drawing in TimelineHelper and four hit-testing/marquee paths in
// GuiTimeline. Five copies of a layout rule is four chances for a click to land on a different
// row than the one it was drawn on, and this project's signature bug is exactly that shape.
//
// It also had no cap, so a tall panel with two or three tracks stretched every row to several
// times the height its text and keys need — visible first in a resized VR timeline, then on a
// tall desktop one. Filling the space was never the intent; the floor of four was.
//
// Run: node scratchpad/timeline_lane_test.mjs   (from the repo root)
import fs from 'fs';

const REPO = '/Users/mattestela/sculptxr';
const read = (f) => fs.readFileSync(REPO + '/' + f, 'utf8');
const strip = (s) => s.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

const TL = strip(read('src/gui/GuiTimeline.js'));
const TH = read('src/gui/TimelineHelper.js');

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

check('the rule has one implementation', /static laneHeight\(laneAreaH, nTracks\)/.test(TH));

// No call site may compute it for itself again.
const strays = (TL.match(/Math\.max\(4, tracks\.length\)/g) || []).length
             + (strip(TH).match(/Math\.max\(4, tracks\.length\)/g) || []).length;
check('no call site recomputes it', strays === 0,
  `${strays} site(s) still divide the height themselves — drawing and hit-testing can disagree`);

// And every one of them goes through the helper: four in the timeline, one in the drawing.
const users = (TL.match(/TimelineHelper\.laneHeight\(/g) || []).length;
check('every timeline call site uses the helper', users === 4, `${users} of 4`);
check('the drawing uses it too', /TimelineHelper\.laneHeight\(laneAreaH, tracks\.length\)/.test(TH));

// The behaviour itself, run against the real constant read out of the source.
{
  const m = /const LANE_H_MAX = (\d+);/.exec(TH);
  check('the cap is a named constant', !!m);
  const CAP = m ? parseInt(m[1], 10) : NaN;

  // THE SHIPPED EXPRESSION, not a copy of it. Written as a local reimplementation first, this
  // block passed happily with the cap deleted from the source — it was testing the test. The
  // body is lifted out of TimelineHelper and evaluated, so the rule under test is the rule
  // that runs.
  const body = TH.slice(TH.indexOf('static laneHeight(laneAreaH, nTracks) {'));
  const inner = body.slice(body.indexOf('{') + 1, body.indexOf('\n  }'));
  const lane = new Function('laneAreaH', 'nTracks', inner);

  // A tall panel with few tracks is the reported bug: rows must NOT grow to fill it.
  check('a tall panel does not stretch the rows', lane(600, 3) === CAP,
    `${lane(600, 3)} vs cap ${CAP}`);
  // The VR panel as measured (724x161, header ~30) sat below the cap already, which is why it
  // only looked wrong once the panel was made taller.
  check('a short panel still squeezes', lane(161 - 30, 3) < CAP,
    `${lane(131, 3).toFixed(1)}`);
  // The floor of four survives: one object must not get a quarter-panel-tall row.
  check('one track still gets a quarter of the space, not all of it',
    lane(100, 1) === 25 && lane(100, 1) < CAP);
  // Monotonic: more tracks never gives taller rows.
  let ok = true;
  for (let n = 1; n < 40; n++) if (lane(500, n + 1) > lane(500, n) + 1e-9) ok = false;
  check('more tracks never means taller rows', ok);
}

// THE DOPESHEET SCROLL. The draw clamped it and wrote the clamp back; every hit test read the
// raw field. Whenever the raw value sat outside the range — which is what making the panel
// TALLER does, since more visible rows means a smaller maximum scroll — the keys DREW at one
// offset and were HIT-TESTED at another, so they highlighted under the cursor and then would
// not select. The next redraw repaired it silently, which is why it came and went.
{
  const TLsrc = fs.readFileSync(REPO + '/src/gui/GuiTimeline.js', 'utf8');
  const code = TLsrc.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

  check('the clamp has one implementation', /_dopeScroll\(\) \{/.test(code));

  // A raw read is only legitimate where the value is being WRITTEN (the wheel and the pan
  // start, both of which clamp as they write) and inside the accessor itself.
  const raw = (code.match(/this\._dopeScrollY \|\| 0/g) || []).length;
  check('no hit test reads the raw scroll', raw <= 3,
    `${raw} raw reads — a hit test on the unclamped value disagrees with the drawing`);
  const routed = (code.match(/this\._dopeScroll\(\)/g) || []).length;
  check('every hit test goes through the accessor', routed >= 4, `${routed}`);
  check('the drawing uses it too',
    /uiState\._dopeScroll \? uiState\._dopeScroll\(\)/.test(TH),
    'the draw clamping on its own is exactly the bug');

  // The accessor's own arithmetic, run as shipped.
  const i = code.indexOf('_dopeScroll() {');
  const inner = code.slice(code.indexOf('{', i) + 1, code.indexOf('\n  }', i));
  const fn = new Function(inner);
  const call = (cur, max) => {
    const ctx = { _dopeScrollY: cur, _dopeMaxScroll: max };
    const v = fn.call(ctx);
    return [v, ctx._dopeScrollY];
  };
  check('a scroll past the end is clamped', call(500, 120)[0] === 120, String(call(500, 120)[0]));
  check('...and the clamp is written back, so the next read agrees',
    call(500, 120)[1] === 120,
    'leaving the field unclamped means the very next raw read diverges again');
  check('a negative scroll is clamped too', call(-40, 120)[0] === 0);
  check('a scroll in range is left alone', call(60, 120)[0] === 60);
  // The case that produced the bug: the panel grows, max shrinks below the current offset.
  check('growing the panel does not strand the scroll past the new end',
    call(300, 0)[0] === 0 && call(300, 0)[1] === 0);
}

// A KEYED BONE GETS A REAL ROW. Joint tracks used to be folded into one synthetic row per
// skeleton, with the real entries removed. The row carried the joints' key TIMES so it drew
// keys and they highlighted — but its id was deliberately not a real mesh id, so nothing could
// resolve it to a track and selection, dragging and deleting all no-op'd. Keying is now per
// control, so those are exactly the rows you want to edit.
{
  const TLsrc = fs.readFileSync(REPO + '/src/gui/GuiTimeline.js', 'utf8');
  const THsrc = fs.readFileSync(REPO + '/src/gui/TimelineHelper.js', 'utf8');
  const code = TLsrc.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  const thCode = THsrc.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

  const i = code.indexOf('_dopesheetTracks() {');
  const FN = i === -1 ? '' : code.slice(i, code.indexOf('\n  }', i));

  check('joint tracks are not removed from the row list', !/jointIds\.has\(id\)/.test(FN),
    'filtering them out is what left the keys visible but unreachable');
  check('no synthetic rig row is pushed', !/_rigRow/.test(FN),
    'a row whose id resolves to no track cannot be selected or dragged');
  check('the drawing no longer special-cases one', !/_rigRow|_rigName/.test(thCode));
  // Rows carrying a NEGATIVE id are the unreachable kind. Frame groups keep their real ids.
  check('every row id is a real mesh id', !/entries\.push\(\[-/.test(FN),
    'a negative pseudo-id is by construction unresolvable');
  // The frame-group row must survive — it was never the problem and uses a real id.
  check('frame-group rows are untouched', /_srGroupRow: true/.test(FN));
}

// MARQUEE SELECTION. Two bugs, one call: the first and last keys in TIME could not be
// marqueed at all, and the lane range indexed the wrong list entirely.
{
  const TLsrc = fs.readFileSync(REPO + '/src/gui/GuiTimeline.js', 'utf8');
  const REG = fs.readFileSync(REPO + '/src/editing/AnimationRegistry.js', 'utf8');
  const code = TLsrc.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

  // The marquee tests a key's CENTRE, but a key is a drawn marker. At the two ends that is
  // unreachable rather than fiddly: the first key sits at exactly tlX with the row-name gutter
  // to its left (where a press is claimed before a marquee can begin), and the last sits at
  // the canvas edge with nowhere further to drag.
  check('the marquee is padded before becoming a time range',
    /x1 - MARQ_PAD - tlX/.test(code) && /x2 \+ MARQ_PAD - tlX/.test(code),
    'without padding the first and last keys in time cannot be selected at all');
  check('...and padded in y for the first and last rows',
    /y1 - MARQ_PAD - headerH/.test(code) && /y2 \+ MARQ_PAD - headerH/.test(code));
  check('the pad is a named constant', /const MARQ_PAD = \d+;/.test(code));

  // The lane range is a DOPESHEET row number. getKeysInTimeRange indexed the REGISTRY's map,
  // which is neither the same order nor the same membership — it keeps dead tracks and frame
  // group children and lacks the group rows. Every other collector iterates `tracks` directly.
  check('transform keys are gathered from the dopesheet rows',
    !/reg\.getKeysInTimeRange\(/.test(code),
    'that call indexes the registry map with dopesheet row numbers');
  const marq = code.slice(code.indexOf('const MARQ_PAD'));
  // Three collectors share the lane range (transform, blendshape, SR). The shape-LAYER one
  // legitimately differs: its sub-rows stack BELOW the lane's own slot, so a lane-index test
  // would cut them off — it compares its computed row Y against the rectangle instead.
  // Asserted rather than waved past, because "the odd one out" is what the transform
  // collector turned out to be.
  const collectors = (marq.match(/laneIdx < laneMin \|\| laneIdx > laneMax/g) || []).length;
  check('the three lane-indexed collectors agree', collectors === 3, `${collectors} collectors`);
  check('the shape-layer collector bounds itself geometrically instead',
    /rowY < y1 \|\| rowY > y2/.test(marq),
    'its sub-rows extend past the lane, so a lane index would drop them');

  // Lane maths carries the scroll, like every other lane computation in the file.
  check('the lane range carries the scroll',
    /_marqScroll = this\._dopeScroll\(\)/.test(code) && /headerH \+ _marqScroll/.test(code),
    'a scrolled dopesheet would marquee the wrong rows');

  // The registry helper may still exist for other callers, but its own test must stay
  // inclusive — an exclusive bound would drop the keys sitting exactly on the boundary.
  const gk = REG.slice(REG.indexOf('getKeysInTimeRange('));
  check('the registry range test is inclusive at both ends',
    (gk.match(/t >= tMin && t <= tMax/g) || []).length >= 2);
}

// MOUSE-UP MUST ALWAYS RELEASE. A throw inside it leaves every drag flag set, so the pointer
// reads as held down for ever: the marquee never closes, the key never drops, the playhead
// follows the cursor. A ReferenceError in finalizeMarquee produced exactly that, and in a
// headset there is no easy way back from a dead timeline.
{
  const TLsrc = fs.readFileSync(REPO + '/src/gui/GuiTimeline.js', 'utf8');
  const code = TLsrc.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

  const i = code.indexOf('onMouseUp(e) {');
  const FN = i === -1 ? '' : code.slice(i, code.indexOf('_onMouseUpBody(e) {', i));
  check('mouse-up guards its own body', /try \{[\s\S]{0,80}_onMouseUpBody\(e\);[\s\S]{0,40}\} catch/.test(FN),
    'an unguarded handler leaves the drag flags set when it throws');
  check('...and releases the drag when it fails', /_cancelActiveAction\(\)/.test(FN),
    'clearing the flags is the whole point; logging alone still leaves it stuck');
  check('the release helper clears every drag flag',
    ['_isDraggingPlayhead', '_isDraggingKeyframe', '_isDraggingMarquee', '_isDraggingTangent']
      .every((f) => new RegExp(f + ' = false').test(code)));
  // A failed repaint inside the handler must not put it back where it started.
  check('a failing redraw cannot re-trap the pointer',
    /try \{ this\.draw\(\); \} catch/.test(FN));

  // And the error that started it: no bare dsScroll may survive outside a parameter or a local.
  const bare = (code.match(/[^._\w]dsScroll/g) || []).length;
  const bound = (code.match(/const dsScroll = this\._dopeScroll\(\)/g) || []).length
              + (code.match(/trackH, dsScroll, tlX/g) || []).length;
  check('every dsScroll use is bound in its own scope', bare > 0 ? bound > 0 : true,
    'finalizeMarquee referenced one that was never declared there');
}

// KEY COLOUR. Keys were coloured by KIND — orange transform, blue shape, teal blendshape,
// another blue for layer keys, each with selected and hovered variants on top. Five hues
// before anything is selected, and the row already says what kind a key is. What you need at
// a glance is the STATE: idle, selected, moving.
{
  const TH2 = fs.readFileSync(REPO + '/src/gui/TimelineHelper.js', 'utf8');
  const code = TH2.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

  check('there is one palette', /static keyFill\(isSelected, isMoving, isMuted\)/.test(code));

  // Every key-drawing site must use it — four kinds of key, one rule.
  const users = (code.match(/TimelineHelper\.keyFill\(/g) || []).length;
  check('every key kind uses it', users === 4, `${users} of 4`);

  // The per-kind hues are gone from the KEYS. (#00ff88 survives on the blendshape row LABEL,
  // which is a lane name, not a key — the request was about key colours.)
  for (const [hue, what] of [['#ff9944', 'transform orange'], ['#44aaff', 'shape blue']]) {
    check(`the ${what} is gone`, !code.includes(hue), 'a key is still coloured by kind');
  }
  check('hover no longer claims a colour', !/isHovered \? '#00ffff'/.test(code),
    'cyan means MOVING now; hover reads as a heavier outline instead');
  check('...but hover is still visible', /static keyRing\(ctx, isHovered\)/.test(code)
    && /lineWidth = isHovered \?/.test(code),
    'losing preselection entirely would be worse than the colour clash');

  // The rule itself, run as shipped.
  const i = code.indexOf('static keyFill(isSelected, isMoving, isMuted)');
  const inner = code.slice(code.indexOf('{', i) + 1, code.indexOf('\n  }', i));
  const fill = new Function('isSelected', 'isMoving', 'isMuted', inner);
  check('idle is white', fill(false, false, false) === '#ffffff');
  check('selected is yellow', fill(true, false, false) === '#ffff00');
  check('moving is cyan', fill(true, true, false) === '#00ffff');
  // ORDER: a key being moved is also selected, so moving has to win or it never shows.
  check('moving beats selected', fill(true, true, false) !== fill(true, false, false),
    'checked after selected, cyan would never appear');
  check('muted stays grey', fill(false, false, true) === '#585b70',
    '"this will not play" is orthogonal to selection and worth keeping');
  check('muted beats the rest', fill(true, true, true) === fill(false, false, true));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
