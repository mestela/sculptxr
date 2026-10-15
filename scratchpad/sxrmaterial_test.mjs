// Node harness for WHAT A .sxr CARRIES BACK — the texture footer block, and the physics
// parameters that kept getting added to PhysicsBones without being added to the file.
//
// matt: "textures are not being restored when i load a sxr, i can't tell if its not saving to
// sxr, or not loading from sxr. physics settings don't look like they're being saved in the sxr
// either." Both were the SAVING side, and the texture one was total: ExportSGL had no texture
// handling of any kind.
//
// THE RECURRING BUG THIS FILE EXISTS TO CATCH is the physics one, because it has now happened
// three times in a row. v11 wrote three of the parameters and PhysicsBones had eight, so five
// were silently dropped on every save; v14 fixed that and PhysicsBones has since grown to
// twelve, so mass, substeps and iterations were dropped exactly the same way. The check below
// counts DEFAULTS against what the writer names, so the next parameter added to PhysicsBones
// fails here instead of failing in matt's hands after a tuning session.
//
// Run: node scratchpad/sxrmaterial_test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');

let failures = 0;
const check = (name, ok, got = '') => {
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (ok ? '' : '  ' + got));
  if (!ok) failures++;
};

const SKEL = read('src/editing/Skeleton.js');
const PHYS = read('src/editing/PhysicsBones.js');
const TIO  = read('src/files/TextureIO.js');
const EXP  = read('src/files/ExportSGL.js');
const SCENE = read('src/Scene.js');

// ── every physics parameter reaches the file ────────────────────────────────────────
{
  // DEFAULTS is the definition of "a physics parameter", so it is the list to measure against.
  // Up to the closing brace, so the LAST entry counts too -- anchoring on the name of whatever
  // is currently last is how this test would quietly stop seeing the newest parameter.
  const body = (PHYS.match(/const DEFAULTS = \{([\s\S]*?)\};/) || [])[1];
  // Strip the comments first: DEFAULTS is heavily annotated and prose contains colons. Names
  // are then any `word:` at a line start OR after a comma, since several share a line.
  const bare = body ? body.replace(/\/\/[^\n]*/g, '') : '';
  const names = [...bare.matchAll(/(?:^|,)\s*(\w+)\s*:/gm)].map((m) => m[1]);
  check('PhysicsBones.DEFAULTS is readable by this test', names.length >= 12, names.join(','));

  // The three sections the writer builds, in order: v11, v14, v17.
  const written = SKEL.slice(SKEL.indexOf('const phys = ['), SKEL.indexOf('const offs = ['));
  const missing = names.filter((n) => !new RegExp('p\\.' + n + '\\b').test(written));
  check('...and EVERY one of them is written to the skeleton block',
    missing.length === 0,
    'never saved, so it comes back as a default: ' + missing.join(', '));

  check('...including the three that prompted this (mass, substeps, iterations)',
    /phys3\.push\(\{ i: i, ms: p\.mass, sb: p\.substeps, it: p\.iterations \}\)/.test(SKEL));
  check('...read back under a version gate, merged onto what v11/v14 built',
    /if \(ver >= 17\)/.test(SKEL) && /cur\.mass = ms; cur\.substeps = sb; cur\.iterations = it3;/.test(SKEL),
    'replacing rather than merging would drop the parameters the older sections carry');
  // AT LEAST 17, not exactly 17. Pinning the literal means the next person to add a section
  // gets a red test for doing the right thing -- which is how this file made v18 look like a
  // regression. The property that matters is that the version never goes BACKWARDS.
  check('...with the block version raised so old files still read',
    (() => { const m = /const SKEL_VERSION = (\d+);/.exec(SKEL); return !!m && +m[1] >= 17; })());
  // Counts are integers and go through the u32 view; a float view would read them as denormals.
  check('...and the two COUNTS written as integers, not floats',
    /u\[o\+\+\] = ph\.i; f\[o\+\+\] = ph\.ms; u\[o\+\+\] = ph\.sb; u\[o\+\+\] = ph\.it;/.test(SKEL));
  // v18: THE LIGHT PARAMETERS. Same failure mode as v11/v14/v17 and the texture block before
  // them -- the feature works until you save. matt: "lights aren't being saved/loaded properly
  // to sxr". Every property that makes a light a light, not just the mesh it rides on.
  check('a light saves its type, colour, intensity, range and cone',
    /lights\.push\(\{/.test(SKEL) && /t: m\._lightType/.test(SKEL)
      && /inten: m\._lightIntensity/.test(SKEL) && /range: m\._lightRange/.test(SKEL)
      && /cone: m\._lightConeDeg/.test(SKEL),
    'a saved light came back as a plain sphere without these');
  check('...and the whole shadow group, which is three tuning decisions',
    /cast: \(m\._castShadow !== false\)/.test(SKEL) && /shNear: m\._shadowNear/.test(SKEL)
      && /shBias: m\._shadowNormalBias/.test(SKEL) && /shInt: m\._shadowIntensity/.test(SKEL)
      && /shRad: m\._shadowRadius/.test(SKEL),
    'near, bias and softness are all hand-tuned; losing them on save wastes that session');
  check('...read back under a version gate that also restores the flags',
    /if \(ver >= 18\)/.test(SKEL) && /m\._isLight = true;/.test(SKEL) && /m\._isNull = true;/.test(SKEL),
    'without _isLight/_isNull the mesh reloads as ordinary geometry');
  check('...and the gizmo is rebuilt, since it is not serialized',
    /main\.decorateLight && main\.decorateLight\(m\)/.test(SKEL));
  // DERIVED, NOT PINNED. Asserting `* 13` means adding a field -- the correct change -- fails
  // here, which is the same literal-pinning trap that made v18 itself look like a regression.
  // The invariant is that the slot count EQUALS what the writer actually writes, so count it.
  {
    const body = (SKEL.match(/u\[o\+\+\] = lights\.length;([\s\S]*?)\n  \}/) || [])[1] || '';
    const written = (body.match(/[ufi32]+\[o\+\+\]/g) || []).length;
    const declared = Number((SKEL.match(/slots \+= 1 \+ lights\.length \* (\d+);/) || [, 0])[1]);
    check('...with the light section sized to exactly what it writes',
      written > 0 && written === declared,
      'writes ' + written + ' per light, reserves ' + declared
        + ' — a wrong slot count corrupts every block written after it');
  }

  check('...with the section sized in the slot count',
    /slots \+= 1 \+ phys3\.length \* 4;/.test(SKEL),
    'an unsized section writes past the buffer');
}

// ── textures are saved at all ───────────────────────────────────────────────────────
{
  check('the exporter appends a texture block',
    /TextureIO\.serialize\(meshes\)/.test(EXP),
    'this is the whole bug: there was no texture handling in ExportSGL of any kind');
  // FrameGroup's reader only inspects the final 8 bytes of the file, so its block must stay
  // last. Ordering is load-bearing, not cosmetic.
  check('...BEFORE the skeleton and frame-group blocks',
    EXP.indexOf('TextureIO.serialize') < EXP.indexOf('Skeleton.serialize')
      && EXP.indexOf('Skeleton.serialize') < EXP.indexOf('_frameGroup.serialize'),
    'anything appended after FrameGroup makes its reader silently skip its own data');
  check('...and the loader restores it',
    /TextureIO\.deserialize\(fileData, added, THREE\)/.test(SCENE));

  check('all three maps and the four scalars are covered',
    /getAlbedoMap/.test(TIO) && /getRoughMetalMap/.test(TIO) && /getNormalMap/.test(TIO)
      && /getTransmission/.test(TIO) && /getRoughFactor/.test(TIO)
      && /getMetalFactor/.test(TIO) && /getNormalScale/.test(TIO));
  // A transmissive surface with no maps is still a material setting that was being lost.
  check('...and transmission alone is enough to earn a record',
    /return !!anyMap \|\| !!\(m\.getTransmission && m\.getTransmission\(\) > 0\);/.test(TIO));

  // Re-encoding a JPEG on every save would recompress it every time; the original bytes are a
  // memcpy and are exact.
  check('a map is stored as its ORIGINAL encoded bytes where we have them',
    /const s = tex\._sxrSrc \|\| \(tex\.userData && tex\.userData\._sxrSrc\);/.test(TIO));
  check('...with a canvas re-encode only as the fallback, and a SYNCHRONOUS one',
    /cv\.toDataURL\('image\/png'\)/.test(TIO)
      // toBlob is the asynchronous sibling and is the easy thing to reach for. Comments may
      // name it; a CALL to it would break the save path.
      && !/\.toBlob\s*\(/.test(TIO) && !/await /.test(TIO.slice(0, TIO.indexOf('// ── reading'))),
    'Export returns a Blob, not a promise, so nothing on the save path may be async');
  check('...and a loaded map keeps its bytes, so a re-save is a memcpy too',
    /tex\._sxrSrc = \{ bytes: bytes, mime: mime \};/.test(TIO));

  // The flags have to match ImportGLTF's or a round trip comes back a gamma out or upside down.
  check('albedo comes back sRGB and the data maps come back linear',
    /decode\(bytes, MIME\[mimeIdx\] \|\| MIME\[0\], k === 0, THREE\)/.test(TIO)
      && /if \(srgb && THREE\.SRGBColorSpace\) tex\.colorSpace = THREE\.SRGBColorSpace;/.test(TIO),
    'calling a roughness map colour bends every value on the way in');
  check('...and every map keeps flipY off, as glTF UVs require',
    /tex\.flipY = false;/.test(TIO));

  // Its finder walks the footer chain backwards past blocks written after it. A magic it does
  // not know must STOP the walk -- guessing reads mesh data as a length.
  check('the block finder walks past the later footers and stops at anything else',
    /if \(magic !== SKEL_MAGIC && magic !== FGRP_MAGIC\) return null;/.test(TIO));
  check('...and records stay 4-byte aligned, so the u32/f32 views are legal',
    (TIO.match(/\(\w+\.bytes\.length \+ 3\) & ~3/g) || []).length >= 1
      && /o \+= \(\(len \+ 3\) & ~3\) \/ 4;/.test(TIO));
  check('...and a block from a newer build is left alone',
    /if \(ver > TXTR_VERSION\) return;/.test(TIO));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
