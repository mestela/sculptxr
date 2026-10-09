// Runs the REAL finalizeMarquee (dopesheet branch) against a stub registry and asserts which
// lanes' keys a box catches. The box has to TOUCH a lane's key row; merely coming near the lane
// boundary must not pull in the neighbour (matt, 2026-10-10: "it will often grab too many keys
// from the row above my marquee").
import fs from 'fs';
const REPO = new URL('..', import.meta.url).pathname;
const SRC = fs.readFileSync(`${REPO}/src/gui/GuiTimeline.js`, 'utf8');
const m = SRC.match(/\n  finalizeMarquee\(e\) \{\n([\s\S]*?)\n  \}\n\n  draw\(\)/);
if (!m) throw new Error('finalizeMarquee not extracted');
let failures = 0;
const check = (n, ok, d) => { if (!ok) failures++; console.log((ok ? '  ok   ' : '  FAIL ') + n + (!ok && d ? '  ' + d : '')); };

const HEADER_H = 40;
const TimelineHelper = { laneHeight: (h, n) => Math.min(60, h / Math.max(1, n)), getKeysInGraphRange: () => [], bsEntries: () => [] };
const mkTr = () => ({ times: [0, 0.5, 1], positions: [0,0,0,0,0,0,0,0,0] });

function run(lanes, y1, y2, selectedMeshIds = []) {
  const win = { _animationRegistry: { tracks: new Map() }, _animSelectedKeys: [], _animMasterDuration: 2, _animKeyShow: null };
  const fn = new Function('TimelineHelper', 'HEADER_H', 'window', `return function (e) {\n${m[1]}\n};`)(TimelineHelper, HEADER_H, win);
  const ctx = {
    _mode: 'dope', _cssWidth: 900, _cssHeight: 300, _viewStart: 0, _viewDuration: 2,
    _marqueeStart: { x: 150, y: y1 }, _marqueeEnd: { x: 900, y: y2 },
    _dopesheetTracks: () => lanes.map((id) => [id, mkTr()]), _dopeScroll: () => 0, _setGraphTarget() {},
    _pruneMutedSelection() {}, _notifySelectionChanged() {},
    _main: { _meshes: [], getSelectedMeshes: () => selectedMeshIds.map((id) => ({ getID: () => id })),
             getStateManager: () => ({ pushStateCustom() {} }) },
  };
  fn.call(ctx, { shiftKey: false });
  return [...new Set(win._animSelectedKeys.map((k) => k.meshId))];
}

// one lane: trackH 60, header 40 -> lane 0 key row at y = 70
check('a box over the only lane selects its keys', run([1], 20, 120).join() === '1');
// two lanes: key rows at 70 and 130. A box from 60 to 100 clearly holds lane 0 and ends 30px short
// of lane 1's keys -- the old slot test (8px pad) pulled lane 1 in because its SLOT starts at 100.
check('a box around lane 0 does not grab lane 1 below it', run([1, 2], 60, 100).join() === '1',
  'got ' + run([1, 2], 60, 100).join());
check('...nor lane 0 above when the box is around lane 1', run([1, 2], 115, 145).join() === '2',
  'got ' + run([1, 2], 115, 145).join());
check('a box across both rows selects both', run([1, 2], 55, 140).join() === '1,2');
check('a box that misses every key row selects nothing', run([1, 2], 85, 105).join() === '');
// two OR MORE selected objects restrict the marquee to those lanes
check('with two objects selected the box only takes their lanes', run([1, 2, 3], 40, 230, [1, 3]).join() === '1,3',
  'got ' + run([1, 2, 3], 40, 230, [1, 3]).join());

console.log(failures ? failures + ' FAILURE(S)' : 'all checks passed');
process.exit(failures ? 1 : 0);
