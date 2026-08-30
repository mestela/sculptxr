// Node harness for the mask buttons on the wrist panel.
//
// The bug this exists for: the panel called `t.clearMask()` / `t.invertMask()` while the tool
// has always defined `clear()` / `invert()`. Because the calls were optional-chained guards
// (`if (t?.clearMask)`), the wrong name did not throw -- the buttons silently did nothing from
// the day they shipped. A Quest 2 user reported it as "clear and invert mask seem broken";
// nothing in the code, the console, or a test would ever have said so.
//
// So this checks the two sides AGAINST EACH OTHER rather than checking either alone: every
// method the panel invokes on the masking tool must actually exist on it.
//
// Run: node scratchpad/maskbtn_test.mjs
//   MASK_INJECT=wrongname   the panel goes back to calling clearMask()
import fs from 'fs';
import path from 'path';

const REPO = '/Users/mattestela/sculptxr';
let PANEL = fs.readFileSync(path.join(REPO, 'src/gui/htmlvr/MiniPanel.js'), 'utf8');
const TOOL = fs.readFileSync(path.join(REPO, 'src/editing/tools/Masking.js'), 'utf8');

const inject = process.env.MASK_INJECT || '';
if (inject === 'wrongname') {
  const a = 'if (t?.clear) { t.clear(); main.render?.(); }';
  if (!PANEL.includes(a)) throw new Error('inject wrongname: anchor moved');
  PANEL = PANEL.replace(a, 'if (t?.clearMask) { t.clearMask(); main.render?.(); }');
}

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

// What the tool actually defines, read off the class body rather than assumed.
const methods = new Set(
  (TOOL.match(/^\s{2}([a-zA-Z_][\w]*)\s*\(/gm) || [])
    .map((m) => m.trim().replace(/\s*\($/, '')));
check('the masking tool defines clear() and invert()',
  methods.has('clear') && methods.has('invert'),
  [...methods].join(','));

// Every method the mask buttons call, taken from the panel source.
const seg = PANEL.slice(PANEL.indexOf('if (clearBtn)'), PANEL.indexOf('if (hardInput)'));
const called = [...seg.matchAll(/t\?\.([a-zA-Z_]\w*)/g)].map((m) => m[1]);
check('the panel names at least two methods on the tool', called.length >= 2, called.join(','));
for (const name of called) {
  check('the panel calls ' + name + '(), and the tool has it',
    methods.has(name),
    'an optional-chained call to a method that does not exist is a button that silently '
      + 'does nothing -- it cannot throw, so only this comparison can catch it');
}

// And the guard and the call must name the SAME method, or the guard passes and the call throws.
const pairs = [...seg.matchAll(/if \(t\?\.(\w+)\) \{ t\.(\w+)\(\)/g)];
check('every guard checks the method it then calls',
  pairs.length >= 2 && pairs.every((p) => p[1] === p[2]),
  pairs.map((p) => p[1] + '/' + p[2]).join(' '));

console.log(failures ? '\n' + failures + ' FAILURE(S)' : '\nall checks passed');
process.exit(failures ? 1 : 0);
