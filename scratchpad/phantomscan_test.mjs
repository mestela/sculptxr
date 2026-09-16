// Node harness for src/misc/PhantomScan.js — the "what is that dot" scanner.
//
// This tool exists to ANSWER a question, so the thing at risk is not that it crashes but that it
// answers wrongly and confidently. It has already done that once: v2 reported the rig's capsule
// and joint batches as visible phantoms drawn against their own flags, and I relayed that to matt
// as a flag bug. It was not. The batches sit in the scene with `visible === true` while drawing
// nothing, because a hidden slot is scaled to ZERO rather than removed. Every check here guards a
// way the report can lie.
//
// Run: node scratchpad/phantomscan_test.mjs
//   SCAN_INJECT=exactsig     signatures matched exactly instead of by prefix (v1's silent failure)
//   SCAN_INJECT=noinstcount  empty instanced batches counted as drawn (the false positive)
//   SCAN_INJECT=countall     drawRange counting applied to ordinary meshes too
//   SCAN_INJECT=geobeatsboth the geo-only pass runs first, so geo+order entries never fire
//   SCAN_INJECT=arrayreturn  the scan returns the array again, so a pasted table loses the columns
//   SCAN_INJECT=tinttoflash  blink goes back to tinting material.color
//   SCAN_INJECT=groupleak    hide/blink act on the group representative only, not its members
//   SCAN_INJECT=nodrawignored objects hidden through their MATERIAL are reported as on screen
//   SCAN_INJECT=colorwriteok  colorWrite:false stops counting as hidden (the 40 joint locators)
//   SCAN_INJECT=linerange     merged line batches counted by draw range, not by segment length
//   SCAN_INJECT=nullblind     a DRAWING null/pin pick sphere goes back to reading as UNKNOWN
import fs from 'fs';
import path from 'path';

const REPO = new URL('..', import.meta.url).pathname;
let SRC = fs.readFileSync(path.join(REPO, 'src/misc/PhantomScan.js'), 'utf8');
const SKEL = fs.readFileSync(path.join(REPO, 'src/editing/Skeleton.js'), 'utf8');

const inject = process.env.SCAN_INJECT || '';
const swap = (a, b, label) => {
  if (!SRC.includes(a)) throw new Error('inject ' + label + ': anchor moved');
  SRC = SRC.split(a).join(b);
};
if (inject === 'exactsig') {
  swap('if (b.geo && b.order == null && sig.startsWith(b.geo)) return b;',
       'if (b.geo && b.order == null && sig === b.geo) return b;', inject);
} else if (inject === 'noinstcount') {
  swap('    if (!opts.all && inst && inst.drawn === 0) { empty++; return; }', '', inject);
} else if (inject === 'countall') {
  swap("  if (o.isLineSegments && typeof o.name === 'string' && o.name.startsWith('rigbatch:')) {",
       '  if (o.isLineSegments) {', inject);
} else if (inject === 'geobeatsboth') {
  swap('    if (b.geo && b.order != null && sig.startsWith(b.geo) && o.renderOrder === b.order) return b;', '', inject);
} else if (inject === 'arrayreturn') {
  swap("  return header + '\\n' + lines.join('\\n');", '  return rows;', inject);
} else if (inject === 'tinttoflash') {
  swap('      for (const r of rows) for (const o of r._all) o.visible = on;',
       '      for (const r of rows) for (const o of r._all) o.material.color.setHex(0xff00ff);', inject);
} else if (inject === 'nodrawignored') {
  swap('    if (!opts.all && !drawsPixels(o)) { nodraw++; return; }', '', inject);
} else if (inject === 'colorwriteok') {
  swap('    && x.colorWrite !== false', '', inject);
} else if (inject === 'linerange') {
  swap('      if (Math.abs(a[p] - a[q]) > 1e-9 || Math.abs(a[p + 1] - a[q + 1]) > 1e-9\n        || Math.abs(a[p + 2] - a[q + 2]) > 1e-9) drawn++;',
       '      drawn++;', inject);
} else if (inject === 'nullblind') {
  swap("      const what = sm._isPinTarget ? 'pin' : (sm._isBone ? 'bone/joint' : (sm._isNull ? 'null' : null));",
       '      const what = null;', inject);
} else if (inject === 'groupleak') {
  swap('    for (const r of rows) for (const o of r._all) { o.visible = false; _hidden.push(o); }',
       '    for (const r of rows) { r._o.visible = false; _hidden.push(r._o); }', inject);
}

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

// ── THE FALSE POSITIVE THAT ALREADY HAPPENED ──────────────────────────────────────────────────
check('an instanced batch is judged by how many instances it actually draws',
  /function instanceCount\(o\)/.test(SRC) && /o\.isInstancedMesh/.test(SRC)
    && /if \(sx > 1e-9 && sy > 1e-9 && sz > 1e-9\) drawn\+\+;/.test(SRC),
  'Skeleton.flushBatches scales a hidden slot to ZERO rather than removing it, so the batch '
    + 'stays `visible` while drawing nothing');
check('...and a batch drawing nothing is not reported as on screen',
  /if \(!opts\.all && inst && inst\.drawn === 0\) \{ empty\+\+; return; \}/.test(SRC));
check('...while {all:true} still shows it, since an EMPTY batch explains a missing thing',
  /!opts\.all && inst/.test(SRC));
check('the line-batch count is applied only to the rig batches',
  /o\.isLineSegments && typeof o\.name === 'string' && o\.name\.startsWith\('rigbatch:'\)/.test(SRC),
  'ordinary meshes carry a finite drawRange too — counting those put "1/1" on every row');
check('the rig names its batches, so a batch does not have to be guessed at',
  /b\.mesh\.name = 'rigbatch:' \+ key;/.test(SKEL)
    && (SKEL.match(/rigbatch:/g) || []).length >= 2,
  'both the instanced batches (batchFor) and the merged line batches (lineBatchSlot)');

// ── THE OTHER TWO WAYS THIS CODEBASE HIDES THINGS ─────────────────────────────────────────────
// `object.visible` is the one it uses LEAST. Both of these produced a full page of false
// positives before they were handled.
check('an object hidden through its MATERIAL is not reported as on screen',
  /function drawsPixels\(o\)/.test(SRC)
    && /if \(!opts\.all && !drawsPixels\(o\)\) \{ nodraw\+\+; return; \}/.test(SRC));
check('...including colorWrite:false, which is how the rig hides its joint locators',
  /x\.colorWrite !== false/.test(SRC),
  'noDrawMaterial sets colorWrite false and explicitly LEAVES visible true, so they can still '
    + 'be picked — forty of them were reported as phantoms');
check('...an invisible material, and a transparent one at zero opacity',
  /x\.visible !== false/.test(SRC) && /!\(x\.transparent && x\.opacity <= 0\)/.test(SRC));
check('a merged line batch is counted by SEGMENT LENGTH, not by draw range',
  /o\.isLineSegments && typeof o\.name === 'string'/.test(SRC)
    && /Math\.abs\(a\[p\] - a\[q\]\) > 1e-9/.test(SRC),
  'flushLineBatch collapses a hidden joint to a POINT and leaves the range full, so a switched-'
    + 'off wireframe reported as 1/1 drawn');
check('...and the no-draw and empty counts are reported rather than silently dropped',
  /nodraw \? ', ' \+ nodraw/.test(SRC) && /empty \? ', ' \+ empty/.test(SRC));

// ── SIGNATURE MATCHING ────────────────────────────────────────────────────────────────────────
// v1 keyed on `SphereGeometry(1,10,8)` while three reports
// `SphereGeometry(1,10,8,0,6.2832,0,3.1416)`, so almost every row came back UNKNOWN.
check('signatures match by PREFIX, not exactly',
  /sig\.startsWith\(b\.geo\)/.test(SRC) && !/sig === b\.geo/.test(SRC),
  'three reports the full default parameter list');
check('an entry naming BOTH geometry and order is tried first',
  /if \(b\.geo && b\.order != null && sig\.startsWith\(b\.geo\) && o\.renderOrder === b\.order\) return b;/.test(SRC),
  'the joint scale handles share the joint marker geometry and differ only in render order');
check('...and the geo-only pass is narrowed so it cannot swallow them',
  /if \(b\.geo && b\.order == null && sig\.startsWith\(b\.geo\)\) return b;/.test(SRC));
{
  // The table must actually distinguish the pair it claims to.
  // Whitespace-tolerant: the table is column-aligned, so pinning to single spaces makes the
  // check fail on formatting rather than on behaviour.
  const marker = /\{ geo: 'SphereGeometry\(1,10,8',\s+name: 'joint marker'/.test(SRC);
  const handle = /\{ geo: 'SphereGeometry\(1,10,8',\s*order: 10002,\s*name: 'joint scale handle'/.test(SRC);
  check('...and the table carries both, or the distinction is theoretical', marker && handle);
}

// ── THE REPORT HAS TO SURVIVE BEING PASTED ────────────────────────────────────────────────────
check('the scan returns TEXT, not the array',
  /return header \+ '\\n' \+ lines\.join\('\\n'\);/.test(SRC),
  'the console renders an array as a table, and a pasted table drops every column after the third');
check('...with the objects still reachable for follow-up',
  /scan\.last = rows;/.test(SRC));
check('...and the first column alone identifies the row',
  /what: \(b \? b\.name : 'UNKNOWN'\)/.test(SRC)
    && /\+ '  <' \+ o\.type/.test(SRC) && /\+ '  order=' \+ o\.renderOrder/.test(SRC),
  'because that is the one column a truncated table keeps');
check('an UNKNOWN carries its colour and nearest named ancestor',
  /const col = \(o\.material && o\.material\.color\)/.test(SRC) && /namedUp/.test(SRC));

// ── POINTING AT THINGS ────────────────────────────────────────────────────────────────────────
check('blink toggles visibility rather than tinting a material',
  /o\.visible = on;/.test(SRC) && !/color\.setHex\(0xff00ff\)/.test(SRC),
  'custom ShaderMaterials have no .color, and a shared material would tint every user of it');
// BOTH call sites, named separately. The loose version matched blink's loop and went on passing
// with hide's copy injected away — the same shape of dead check as the fit one in shadow_test.
check('hide acts on every member of a collapsed group',
  /for \(const r of rows\) for \(const o of r\._all\) \{ o\.visible = false; _hidden\.push\(o\); \}/.test(SRC),
  'rows are collapsed by kind, so the representative is not the only object');
check('...and so does blink',
  /for \(const r of rows\) for \(const o of r\._all\) o\.visible = on;/.test(SRC));
check('repeats are collapsed with a count',
  /r\.n = 1; r\._all = \[r\._o\];/.test(SRC) && /g\.n\+\+; g\._all\.push\(r\._o\);/.test(SRC));
check('restore puts back exactly what was hidden',
  /for \(const o of _hidden\) o\.visible = true;/.test(SRC));

// ── A NULL'S PICK SPHERE IS NAMED BY WHAT IT IS ───────────────────────────────────────────────
// It is built by SculptXR's own Primitives.createSphere, so its signature is a bare
// `BufferGeometry` and no geometry rule can ever reach it. Reaching the list at all IS the
// finding: makePin and decorateNull both end by making the null non-drawing, so one that draws
// missed that step — which is exactly the bug the loaded-pin path had.
check('a drawing null / pin / bone pick sphere is named through its sculpt mesh',
  /sm\._isPinTarget \? 'pin'/.test(SRC) && /SHOULD BE NON-DRAWING/.test(SRC));

// ── VISIBILITY MEANS VISIBLE ALL THE WAY UP ───────────────────────────────────────────────────
check('an object inside a hidden group is not reported',
  /for \(let n = o; n; n = n\.parent\) if \(!n\.visible\) return false;/.test(SRC));
check('the sculpt itself is excluded, but rig meshes are not',
  /if \(sm && !sm\._isBone && !sm\._isNull && !sm\._isReference\) return;/.test(SRC));
check('the rig flag that governs a row is reported, with what it currently reads',
  /Skeleton\.displayFlag\(b\.flag\)/.test(SRC) && /Skeleton\.displayFlagRaw\(b\.flag\)/.test(SRC),
  'a row drawn while its flag says OFF is the bug, named');

// ── THE TWO BUGS THIS HUNT ACTUALLY FOUND, in Skeleton.js ─────────────────────────────────────
check('a pin restored from a file is made non-drawing, like one made live',
  /const _pinTm = p\.pin\.getThreeMesh && p\.pin\.getThreeMesh\(\);/.test(SKEL)
    && /noDrawMaterial\(_pinTm\);/.test(SKEL),
  'makePin does this at the end; the load path did not, so a pin from a .sxr drew its pick '
    + 'sphere as a small ball on the rig, reachable by no display flag');
check('...and its cruciform is hidden too, or the pin carries a second marker',
  /const _cross = _pinTm\.children && _pinTm\.children\.find\(\(c\) => c\.name === 'null_cruciform'\);/.test(SKEL));
check('Hide All Decorations wins over the joint-dot exemptions',
  /const decorHidden = Skeleton\.decorationsHidden\(\);/.test(SKEL)
    && /o\.visible = !decorHidden && \(showJoints \|\| \(!jointHeld && \(isolated \|\| isHi \|\| isSel\)\)\);/.test(SKEL),
  'preselect/selection/isolated keep a switched-off rig pointable-at, which is right for the '
    + '`joints` flag and wrong for a master switch that exists to clear the view');

console.log('');
console.log(failures ? failures + ' FAILURE(S)' : 'all ok');
process.exit(failures ? 1 : 0);
