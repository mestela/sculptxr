// Does each rigging module actually EVALUATE?
//
// The other harnesses strip imports and stub the world, so they test logic but never run a
// module's top level as the browser does. That gap shipped a real break: an assignment onto
// `Skeleton` placed above `const Skeleton = {}` sat in the const's temporal dead zone, so
// the module threw on load — every unit check still passed, because every one of them was
// running against a stub. This bundles the real files with their real imports and imports
// the result, which is the cheapest thing that would have caught it.
//
// Run: node scratchpad/module_load_test.mjs   (from the repo root)
import { build } from 'esbuild';
import fs from 'fs';
import path from 'path';

import { spawnSync } from 'child_process';

const REPO = '/Users/mattestela/sculptxr';
const MODULES = [
  'src/editing/Skeleton.js',
  'src/editing/IKSolver.js',
  'src/editing/Skinning.js',
  'src/editing/tools/BoneDrawTool.js',
  'src/gui/bonePanel.js',
  // Added 2026-08-18: the graph editor gained module-scope THREE objects, which is exactly
  // the kind of top-level work the stubbed harnesses cannot see fail.
  'src/gui/GuiTimeline.js',
  'src/gui/TimelineHelper.js',
  'src/editing/xfChannel.js',
  'src/editing/tools/Grab.js',
  'src/editing/tools/TransformVR.js',
];

// Browser globals the bundled leaves touch at module scope. Deliberately minimal: the point
// is to run each module's OWN top level, not to emulate a browser.
globalThis.self = globalThis;
globalThis.location = globalThis.location || { search: '', hash: '', href: 'http://localhost/', protocol: 'http:', host: 'localhost' };
globalThis.localStorage = globalThis.localStorage || {
  getItem: () => null, setItem() {}, removeItem() {}, clear() {},
};
globalThis.window = globalThis;
globalThis.document = globalThis.document || {
  createElement: () => ({ getContext: () => null, style: {}, addEventListener() {} }),
  addEventListener() {}, querySelectorAll: () => [], querySelector: () => null,
  documentElement: { style: {} }, body: { appendChild() {} },
};

let failures = 0;
const out = path.join(REPO, 'scratchpad', '_modload_gen.mjs');

for (const rel of MODULES) {
  const entry = path.join(REPO, rel);
  try {
    await build({
      entryPoints: [entry], bundle: true, format: 'esm', outfile: out,
      platform: 'neutral', logLevel: 'silent',
      // The DOM/WebGL leaves are not what is under test; only that the module's own top
      // level runs. Anything unresolvable is stubbed to an empty module.
      external: ['three', 'gl-matrix'],
    });
    let src = fs.readFileSync(out, 'utf8');
    // Real three/gl-matrix so class extends, Vector3 etc. behave; nothing else is touched.
    src = src.replace(/from\s*"three"/g, `from "${REPO}/node_modules/three/build/three.module.js"`)
             .replace(/from\s*"gl-matrix"/g, `from "${REPO}/node_modules/gl-matrix/esm/index.js"`);
    fs.writeFileSync(out, src);
    await import(out + '?v=' + Date.now());
    console.log('  ok   ' + rel + ' evaluates');
  } catch (e) {
    failures++;
    console.log('  FAIL ' + rel + ' — ' + String(e.message || e).split('\n')[0]);
  }
}

// ── EVERY FILE THE APP ACTUALLY IMPORTS, PARSED ───────────────────────────────────────────
//
// The list below is hand-picked, which means a syntax error anywhere else ships. It just did: a
// bare `function` declaration placed inside a class body in Scene.js -- legal-looking, and an
// "Uncaught SyntaxError" that takes the WHOLE app down on load, found by matt rather than here.
// Scene.js was not on any list, and no list will ever be complete.
//
// esbuild parses the entire import graph from the entry point in about 0.4s, which is cheaper
// than most single harnesses here. Bare packages and vite's own import forms (?raw, ?url,
// ?worker, .wasm, .md) are external: this is a PARSE check of our own source, not a build.
{
  const _r = spawnSync('npx', ['esbuild', '--bundle', '--packages=external',
    '--log-level=error', '--format=esm', '--outfile=/dev/null',
    '--external:*?raw', '--external:*.md', '--external:*.wasm',
    '--external:*?url', '--external:*?worker', 'src/SculptGL.js'],
    { cwd: REPO, encoding: 'utf8' });
  const out = ((_r.stdout || '') + (_r.stderr || '')).trim();
  if (_r.status === 0) {
    console.log('  ok   every file the app imports parses');
  } else {
    failures++;
    console.log('  FAIL every file the app imports parses\n'
      + out.split('\n').slice(0, 12).join('\n'));
  }
}


console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
