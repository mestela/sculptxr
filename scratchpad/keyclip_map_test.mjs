// The selection-aware key clipboard maps clipboard objects to paste targets: identity when the
// targets include every source, BY ORDER when the counts match, else identity for the overlap,
// and identity back onto the originals when nothing is selected. Lifted and run.
import fs from 'node:fs';
const SRC = fs.readFileSync(new URL('../src/gui/GuiTimeline.js', import.meta.url), 'utf8');
let failures = 0;
const check = (n, ok, d) => { if (!ok) failures++; console.log((ok ? '  ok   ' : '  FAIL ') + n + (!ok && d ? '  ' + d : '')); };
const a = SRC.indexOf('  _mapClipTargets(clipIds, tgtIds) {');
const b = SRC.indexOf('\n  copyKeysSmart() {', a);
check('_mapClipTargets is liftable', a > 0 && b > a);
const fn = new Function('return {' + SRC.slice(a, b) + '}')()._mapClipTargets;
const m = (c, t) => [...fn(c, t)].map(([k, v]) => k + '>' + v).join(',');
check('nothing selected: back onto the originals', m([1, 2], []) === '1>1,2>2');
check('targets include every source: identity', m([1, 2], [2, 1, 9]) === '1>1,2>2');
check('targets are a SUBSET of the sources: only those', m([1, 2, 3], [2]) === '2>2');
check('different objects, same count: by order', m([1, 2], [7, 8]) === '1>7,2>8');
// THE PRODUCTION BUG (matt, 2026-10-10): Grab leaves a stray pin / joint selected, which is not
// one of the copied bones. That used to mean "paste onto the overlap" = nothing at all.
check('a stray unrelated selection is ignored: back onto the originals', m([1, 2, 3], [9]) === '1>1,2>2,3>3');
check('...so is a bigger unrelated selection', m([1, 2, 3], [8, 9]) === '1>1,2>2,3>3');
check('...and a partly related one that also holds something else', m([1, 2, 3], [2, 9]) === '1>1,2>2,3>3');
console.log(failures ? failures + ' FAILURE(S)' : 'all checks passed');
process.exit(failures ? 1 : 0);
