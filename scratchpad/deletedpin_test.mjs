// A DELETED PIN MUST NOT COME BACK ON RELOAD.
//
// Deleting a pin leaves the joint's `_boneIKPin` mode and `_boneIKPinObj` alone (so undo can put
// the same object back). Skeleton.serialize used to write that stale mode with no pin link, which
// the loader reads as an old file carrying only a MODE and answers by building a new pin.
// Reproduced in the browser on rig.sxr (delete pin_spine_01, save, fresh page, load: pin back),
// fixed by writing mode 0 for a joint whose pin object is no longer in the scene.
//
// Run: node scratchpad/deletedpin_test.mjs
import fs from 'fs';
import path from 'path';
const REPO = new URL('..', import.meta.url).pathname;
const src = fs.readFileSync(path.join(REPO, 'src/editing/Skeleton.js'), 'utf8')
  .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

const blk = src.slice(src.indexOf('Skeleton.serialize = function'), src.indexOf('// Bound meshes.') > 0 ? src.indexOf('Bound meshes.') : undefined);
check('serialize decides the pin bits from whether the pin still exists',
  /const pinBits = \(m\._isBone && m\._boneIKPinObj && !livePin\(m\)\) \? 0 : \(m\._boneIKPin \| 0\);/.test(blk));
const wordStart = blk.indexOf('bone: (m._isBone ? 1 : 0)');
const word = blk.slice(wordStart, blk.indexOf('r: m._boneRadius', wordStart));
check('the bone word is built from pinBits', /pinBits & 3/.test(word) && /pinBits & 4/.test(word) && /pinBits & 8/.test(word));
check('the bone word never reads the raw mode again', !/_boneIKPin/.test(word),
  'a direct read here brings back the stale mode of a deleted pin');
if (failures) { console.log(failures + ' FAILED'); process.exit(1); }
console.log('all checks passed');
