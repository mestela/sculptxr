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

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
