// Runs the REAL finalizeMarquee (dopesheet branch) against a stub registry.
import fs from 'fs';
const REPO = new URL('..', import.meta.url).pathname;
const SRC = fs.readFileSync(`${REPO}/src/gui/GuiTimeline.js`, 'utf8');
const m = SRC.match(/\n  finalizeMarquee\(e\) \{\n([\s\S]*?)\n  \}\n\n  draw\(\)/);
if (!m) throw new Error('finalizeMarquee not extracted');
const HEADER_H = 40;
const TimelineHelper = { laneHeight: (h, n) => Math.min(60, h / Math.max(1, n)), getKeysInGraphRange: () => [] };
const tr = { times: [0, 0.5, 1], positions: [0,0,0,0,0,0,0,0,0] };
const win = { _animationRegistry: { tracks: new Map() }, _animSelectedKeys: [], _animMasterDuration: 2, _animKeyShow: null };
const fn = new Function('TimelineHelper', 'HEADER_H', 'window', `return function (e) {\n${m[1]}\n};`)(TimelineHelper, HEADER_H, win);
const ctx = {
  _mode: 'dope', _cssWidth: 900, _cssHeight: 300, _viewStart: 0, _viewDuration: 2,
  _marqueeStart: { x: 150, y: 20 }, _marqueeEnd: { x: 900, y: 120 },
  _dopesheetTracks: () => [[1, tr]], _dopeScroll: () => 0, _setGraphTarget() {},
  _main: { _meshes: [], getStateManager: () => ({ pushStateCustom() {} }) },
};
try { fn.call(ctx, { shiftKey: false }); } catch (e) { console.log('THREW', e.stack); }
console.log(JSON.stringify(win._animSelectedKeys));
