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

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
