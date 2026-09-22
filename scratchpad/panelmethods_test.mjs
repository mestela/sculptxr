// EVERY `this._method()` ON A VR PANEL RESOLVES TO A METHOD THAT EXISTS.
//
// MainMenuPanel is ~6000 lines of handlers wired up by name, and a handler only runs when someone
// presses that control IN A HEADSET. A typo therefore sits there silently: `this._refreshContent()`
// -- a method that has never existed -- shipped in the Files menu's rebuild callback and threw on
// every Save/Load press. It did not read as a broken button either, because the throw comes out of
// handleXRInput, taking the rest of that frame's input with it. matt saw it as launch hiccups.
//
// Static because it has to be: no harness can press a VR button, and the app cannot tell a missing
// method from an unpressed one.
//
// Run: node scratchpad/panelmethods_test.mjs   (from the repo root)
import fs from 'fs';
import path from 'path';

const REPO = new URL('..', import.meta.url).pathname;
const FILES = ['src/gui/htmlvr/MainMenuPanel.js', 'src/gui/htmlvr/HTMLVRPanel.js'];

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

// Every method name DEFINED across the panel classes and their base, plus anything assigned onto
// `this`. A subclass calling a base method is normal, so the whole family is one pool -- this is
// a typo check, not a visibility check.
const defined = new Set();
const called = new Map();   // name -> first file:line that calls it
for (const rel of FILES) {
  const src = fs.readFileSync(path.join(REPO, rel), 'utf8');
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    // `  _name(args) {` — a class method. Deliberately anchored to the two-space class body indent
    // so a nested arrow function assigned to a const does not read as a definition.
    const def = /^\s{2}(?:async\s+|static\s+|\*\s*)?(_[A-Za-z0-9_]+)\s*\(/.exec(l);
    if (def) defined.add(def[1]);
    // `this._name = ` — assigned rather than declared, which several of these are.
    for (const m of l.matchAll(/this\.(_[A-Za-z0-9_]+)\s*=(?!=)/g)) defined.add(m[1]);
    // The call sites. `?.` is excluded on purpose: optional-call is how this file legitimately
    // asks for something that may not be there.
    for (const m of l.matchAll(/this\.(_[A-Za-z0-9_]+)\(/g)) {
      if (!called.has(m[1])) called.set(m[1], rel.split('/').pop() + ':' + (i + 1));
    }
  }
}

check('the panel sources were read and have methods', defined.size > 40, `${defined.size} defined`);
check('...and call sites were found', called.size > 20, `${called.size} called`);

const missing = [...called.keys()].filter((n) => !defined.has(n));
check('every this._method() called on a panel is defined',
  missing.length === 0,
  missing.map((n) => n + ' (' + called.get(n) + ')').join(', '));

// The specific one, named, so this file says what it is for even after the list above goes quiet.
check('the Files menu rebuild calls _rebuildContent',
  defined.has('_rebuildContent') && !fs.readFileSync(
    path.join(REPO, 'src/gui/htmlvr/MainMenuPanel.js'), 'utf8').includes('this._refreshContent('),
  '_refreshContent is not a method and never was');

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
