#!/usr/bin/env node
/*
 * Single source of truth for the app version (semantic: major.minor.patch).
 * Bumps package.json, src/Version.js, and index.html together so they can
 * never diverge again.
 *
 *   node bump.mjs patch   # test build  (auto-run by `npm run dev`)
 *   node bump.mjs minor   # GitHub push
 *   node bump.mjs major   # manual, on request
 *
 * The in-app version is a plain `vX.Y.Z`; human-readable descriptions live in
 * docs/releases.md (keeps the in-app string from going stale).
 */
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = dirname(fileURLToPath(import.meta.url));
const level = process.argv[2] || 'patch';
if (!['major', 'minor', 'patch'].includes(level)) {
  console.error('usage: node bump.mjs <major|minor|patch>');
  process.exit(1);
}

const pkgPath = join(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
let [maj, min, pat] = (pkg.version || '0.0.0').split('.').map(n => parseInt(n, 10) || 0);
if (level === 'major')      { maj++; min = 0; pat = 0; }
else if (level === 'minor') { min++; pat = 0; }
else                        { pat++; }
const v = `${maj}.${min}.${pat}`;

// package.json
pkg.version = v;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

// src/Version.js
writeFileSync(join(root, 'src/Version.js'), `export const VERSION = 'v${v}';\n`);

// index.html — title + the VERSION comment (description intentionally dropped)
const idxPath = join(root, 'index.html');
let html = readFileSync(idxPath, 'utf8');
html = html.replace(/(<title>SculptXR )v\d+\.\d+\.\d+(<\/title>)/, `$1v${v}$2`);
html = html.replace(/(VERSION: )v\d+\.\d+\.\d+[^\n]*/, `$1v${v}`);
writeFileSync(idxPath, html);

console.log(`bumped ${level} -> v${v}`);
