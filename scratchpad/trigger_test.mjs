// Extract the two helpers and prove the fix against the reported symptom, with no browser.
import fs from 'fs';
const SRC = fs.readFileSync(new URL('../src/Scene.js', import.meta.url).pathname, 'utf8');

let fails = 0;
const check = (n, ok, extra) => { if (!ok) fails++;
  console.log((ok ? '  ok   ' : '  FAIL ') + n + (ok || !extra ? '' : '  — ' + extra)); };

// The helpers, lifted out and run on a stub.
const grab = (name) => {
  const i = SRC.indexOf('  ' + name + '(');
  const j = SRC.indexOf('\n  }\n', i) + 4;
  return SRC.slice(i, j).replace(/^\s*/, '');
};
const body = grab('_triggerThreshold') + '\n' + grab('_isTriggerDown');
// THE SETTING COMES FROM THE OPTIONS STORE NOW, not from GuiXR's _uiSettings cache, which was
// deleted -- it was a startup snapshot of these same options. The stub is the store, so the
// lifted function runs against the shape it really sees.
// PER INSTANCE, not a shared module-level stub. The lifted function reads the store at CALL
// time, so one shared object would let a later mk() silently change what an earlier instance
// reports -- a trap for the next check added below rather than a bug today.
const makeClass = (curve) => new Function('getOptionsURL',
  'return class T { constructor(o){Object.assign(this,o);} ' + body + ' }'
)(() => ({ triggerCurve: curve }));

const controller = (value, pressed) => ({ _pad: { buttons: [{ value, pressed }] } });
const mk = (curve, isHand) =>
  new (makeClass(curve))({ _padOf: (s) => s._pad, _isHandSource: () => !!isHand });

// LIGHT sensitivity: slider 1.0 -> threshold 0.1. The setting matt's symptom needs.
const light = mk(1.0, false);
check('light sensitivity gives a low threshold', Math.abs(light._triggerThreshold() - 0.1) < 1e-9,
  'got ' + light._triggerThreshold());

// THE SYMPTOM: a small pull. Past the sculpt threshold, but the runtime has not called it pressed.
const smallPull = controller(0.3, false);
check('a small pull counts as down (this is the bug that was fixed)',
  light._isTriggerDown(smallPull) === true,
  'the sculpt path starts a stroke here, so the smooth override must arm here too');

check('...and a full pull still counts', light._isTriggerDown(controller(1.0, true)) === true);
check('...and a resting trigger does not', light._isTriggerDown(controller(0.0, false)) === false);

// HARD sensitivity: slider 0.0 -> threshold 0.9. A small pull is genuinely not a press.
const hard = mk(0.0, false);
check('hard sensitivity gives a high threshold', Math.abs(hard._triggerThreshold() - 0.9) < 1e-9);
check('...and a 0.3 pull is correctly NOT down', hard._isTriggerDown(controller(0.3, false)) === false);
check('...while a 0.95 pull is', hard._isTriggerDown(controller(0.95, false)) === true);

// HANDS keep the runtime's boolean: a hand's value rests high and has no travel to calibrate.
const hand = mk(1.0, true);
check('a hand ignores the analog threshold and uses pressed',
  hand._isTriggerDown(controller(0.8, false)) === false
    && hand._isTriggerDown(controller(0.0, true)) === true,
  'a resting hand reads high, so a travel threshold would latch on for ever');

// And every call site asks the same question. Counted as "at least both", not "exactly two": the
// off-hand end-chain gesture asks it a third time, for the same reason the other two do -- it must
// agree with the Smooth modifier about whether the dominant hand is held, or one press would mean
// two things.
check('the smooth override asks _isTriggerDown for BOTH hands',
  (SRC.match(/this\._isTriggerDown\(src\)/g) || []).length >= 2,
  'the modifier and the thing it modifies have to agree about what "held" means');
check('...and no call site still reads buttons[0].pressed for the override',
  !/handedness === this\._dominantHand && this\._padOf\(src\)\?\.buttons\?\.\[0\]\?\.pressed/.test(SRC));

console.log(fails ? `\n${fails} FAILURE(S)` : '\nall checks passed');
process.exit(fails ? 1 : 0);
