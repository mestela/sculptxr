// Grab's translate/rotate pair, and the Connect button that joined the motion-path channels.
//
// Two separate things can be wrong here and only one of them is visible in the state:
// setChannel's "at least one stays on" rule, and whether the PANEL agrees with what it did.
// The desktop sections pass an empty lightRepaintFn, so a handler that only changes state
// leaves two buttons lying about it -- which is how this shipped the first time.
import fs from 'fs';
const MAIN = fs.readFileSync(new URL('../src/gui/htmlvr/MainMenuPanel.js', import.meta.url).pathname, 'utf8');

let failures = 0;
const check = (name, ok, why) => {
  if (!ok) { failures++; console.log(`   FAIL ${name}  ${why || ''}`); }
};

// ── The rule itself, against the real module ────────────────────────────────
//
// EVALUATED, not imported: getOptionsURL drags in gl-matrix, which does not load outside a
// browser. The body below is the shipped file with its import line removed and nothing else,
// so the rule under test is the one that runs.
const GC_SRC = fs.readFileSync(new URL('../src/editing/grabChannels.js', import.meta.url).pathname, 'utf8');
const gcBody = GC_SRC
  .split('\n').filter((l) => !/^import\s/.test(l)).join('\n')
  .replace(/^export default GrabChannels;$/m, '');
globalThis.window = {};
const _saved = {};
const getOptionsURL = () => _saved;
getOptionsURL.saveOption = (k, v) => { _saved[k] = v; };
const GrabChannels = new Function('getOptionsURL', 'window',
  gcBody + '\nreturn GrabChannels;')(getOptionsURL, globalThis.window);

check('both channels are on by default',
  GrabChannels.channels().translate && GrabChannels.channels().rotate,
  'a fresh grab has to do the whole gesture');

check('turning one off leaves the other on',
  (() => { const n = GrabChannels.setChannel('rotate', false); return n.translate && !n.rotate; })(),
  'translation-only is the FK case this exists for');

check('turning off the LAST one turns the other back on',
  (() => { const n = GrabChannels.setChannel('translate', false); return n.rotate && !n.translate; })(),
  'a grab that does nothing is indistinguishable from a broken grab');

check('...and channels() never reports both off either',
  (() => {
    globalThis.window._grabTranslate = false;
    globalThis.window._grabRotate = false;
    const c = GrabChannels.channels();
    return c.translate && c.rotate;
  })(),
  'a stale saved pair must not resurrect the dead state');

// ── The panel agreeing with it ──────────────────────────────────────────────
check('the grab section is built for the Grab tool only',
  /const isGrab\s+= cur === Enums\.Tools\.GRAB;/.test(MAIN)
    && /if \(isGrab\) \{[\s\S]{0,400}?collapsibleHTML\('grab-channels'/.test(MAIN),
  'it is a tool option, not a global one');

check('the click goes through setChannel, not the globals',
  /GrabChannels\.setChannel\(which, !GrabChannels\.channels\(\)\[which\]\)/.test(MAIN)
    && !/window\._grabTranslate\s*=/.test(MAIN),
  'writing the global directly skips the rule that keeps one on');

// The bug: state changed, buttons did not.
check('BOTH buttons are repainted from what setChannel returned',
  (() => {
    const m = /const paintGrab = \(ch\) => \{([\s\S]*?)\};/.exec(MAIN);
    if (!m) return false;
    return /#mm-grab-translate'\)\?\.classList\.toggle\('active', ch\.translate\)/.test(m[1])
        && /#mm-grab-rotate'\)\?\.classList\.toggle\('active', ch\.rotate\)/.test(m[1])
        && /paintGrab\(GrabChannels\.setChannel\(/.test(MAIN);
  })(),
  'the click that turns the OTHER button on is the normal case, and nothing else redraws it');

// ── #67: Connect, moved out of the wrist panel ──────────────────────────────
check('Connect sits in the motion-path grid, not a section of its own',
  (() => {
    const m = /collapsibleHTML\('motion-paths',[\s\S]*?\}\);/.exec(MAIN);
    if (!m) return false;
    // Same grid as Move and Rotate, widened to three, rather than a block of its own below.
    return /mm-choice-grid cols-3/.test(m[0])
        && /id="mm-path-connected"/.test(m[0])
        && /id="mm-path-translate"/.test(m[0]);
  })(),
  'it qualifies the two channels beside it');

check('Connect reads its own accessor and paints itself',
  /const next = !MotionPathEdit\.connected\(\);/.test(MAIN)
    && /e\.currentTarget\.classList\.toggle\('active', next\);/.test(MAIN),
  'connected() is not one of channels(), so it cannot be read from there');

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
