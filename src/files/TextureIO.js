// THE TEXTURE FOOTER BLOCK — the images and material scalars a .sxr used to drop on the floor.
//
// matt: "textures are not being restored when i load a sxr, i can't tell if its not saving to
// sxr, or not loading from sxr." It was the saving: ExportSGL had no texture handling of any
// kind, so a camel imported from a .glb looked right until you saved it, and came back grey.
//
// THE UVs WERE NEVER THE PROBLEM. ExportSGL has written texCoords and facesTexCoord since long
// before maps existed, so every textured mesh already round-trips the coordinates the images are
// sampled with. What had no home in the file was the images themselves and the four scalars that
// go with them (transmission, and the roughness/metalness/normal strengths).
//
// SOURCE BYTES, NOT PIXELS. A map is stored as the ORIGINAL encoded PNG/JPEG exactly as it
// arrived in the .glb, so a save is a memcpy and is lossless. Re-encoding the decoded image
// would be slower, bigger, and would quietly recompress a JPEG every time the file was saved.
// `_sxrSrc` is stashed on the texture at import for exactly this, by ImportGLTF and again by the
// loader below so a file re-saved from a .sxr keeps round-tripping.
//
// The fallback re-encodes through a canvas, and is deliberately the fallback: it is there so a
// texture from some future path still SAVES rather than silently vanishing, which is the failure
// this whole block exists to fix. `toDataURL` is synchronous, which matters -- Export.export
// returns a Blob, not a promise, so nothing here is allowed to be async.
//
// LOADING IS ASYNC and cannot be otherwise: decoding an image is. The meshes appear untextured
// and the maps land a frame or two later, which is why each decode re-checks that its mesh is
// still there before assigning.

const TXTR_MAGIC = 0x54585452;  // 'TXTR'
const TXTR_VERSION = 1;

// The other footer blocks, so the finder can walk PAST them. A magic it does not recognise makes
// it stop rather than guess -- the same rule findSkelBlock follows, and for the same reason: a
// wrong guess here reads mesh data as a length.
const SKEL_MAGIC = 0x534B454C;  // 'SKEL'
const FGRP_MAGIC = 0x46475250;  // 'FGRP'

const MIME = ['image/png', 'image/jpeg', 'image/webp'];

const TextureIO = {};

// ── writing ─────────────────────────────────────────────────────────────────────────

// The encoded bytes for one texture: what it came in as, or a re-encode if we never saw them.
function srcBytesFor(tex) {
  if (!tex) return null;
  const s = tex._sxrSrc || (tex.userData && tex.userData._sxrSrc);
  if (s && s.bytes && s.bytes.length) return s;

  const img = tex.image;
  if (!img || !img.width || !img.height) return null;
  try {
    const cv = document.createElement('canvas');
    cv.width = img.width; cv.height = img.height;
    cv.getContext('2d').drawImage(img, 0, 0);
    // Synchronous by specification, unlike toBlob -- see the note at the top about Export
    // not being allowed to return a promise.
    const url = cv.toDataURL('image/png');
    const b64 = url.slice(url.indexOf(',') + 1);
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes: bytes, mime: 'image/png' };
  } catch (e) {
    console.warn('[TextureIO] could not encode a texture for save', e);
    return null;
  }
}

// A mesh is worth a record if it carries anything this block is the only home for. Transmission
// counts on its own: a pane of glass with no maps at all is still a material setting that was
// being lost.
function hasAnything(m) {
  if (!m || m._isNull) return false;
  const anyMap = (m.getAlbedoMap && m.getAlbedoMap())
    || (m.getRoughMetalMap && m.getRoughMetalMap())
    || (m.getNormalMap && m.getNormalMap());
  return !!anyMap || !!(m.getTransmission && m.getTransmission() > 0);
}

TextureIO.serialize = function (meshes) {
  if (!meshes || !meshes.length) return null;

  const records = [];
  for (let i = 0; i < meshes.length; i++) {
    const m = meshes[i];
    if (!hasAnything(m)) continue;

    const maps = [
      m.getAlbedoMap     ? m.getAlbedoMap()     : null,
      m.getRoughMetalMap ? m.getRoughMetalMap() : null,
      m.getNormalMap     ? m.getNormalMap()     : null,
    ].map(srcBytesFor);

    let flags = 0;
    for (let k = 0; k < 3; k++) if (maps[k]) flags |= (1 << k);

    records.push({
      i: i, flags: flags, maps: maps,
      trans: m.getTransmission  ? m.getTransmission()  : 0,
      rough: m.getRoughFactor   ? m.getRoughFactor()   : 1,
      metal: m.getMetalFactor   ? m.getMetalFactor()   : 1,
      nscale: m.getNormalScale  ? m.getNormalScale()   : 1,
    });
  }
  if (!records.length) return null;

  // Header is magic + version + count; each record is 6 words plus, per present map, 2 words of
  // (mime, length) and the bytes padded up to the next word. Everything stays 4-byte aligned so
  // the u32/f32 views over the block are always legal.
  let body = 3 * 4;
  for (const r of records) {
    body += 6 * 4;
    for (const mp of r.maps) if (mp) body += 2 * 4 + ((mp.bytes.length + 3) & ~3);
  }

  const buf = new ArrayBuffer(body + 8);
  const u = new Uint32Array(buf), f = new Float32Array(buf), u8 = new Uint8Array(buf);
  let o = 0;
  u[o++] = TXTR_MAGIC; u[o++] = TXTR_VERSION; u[o++] = records.length;
  for (const r of records) {
    u[o++] = r.i; u[o++] = r.flags;
    f[o++] = r.trans; f[o++] = r.rough; f[o++] = r.metal; f[o++] = r.nscale;
    for (const mp of r.maps) {
      if (!mp) continue;
      const mi = MIME.indexOf(mp.mime);
      u[o++] = mi < 0 ? 0 : mi;
      u[o++] = mp.bytes.length;
      u8.set(mp.bytes, o * 4);
      o += ((mp.bytes.length + 3) & ~3) / 4;
    }
  }
  u[o++] = TXTR_MAGIC; u[o++] = body;
  return buf;
};

// ── reading ─────────────────────────────────────────────────────────────────────────

// Walk the footer chain backwards. Identical in shape to findSkelBlock, and it has to tolerate
// the blocks written after this one -- TXTR goes FIRST so that FrameGroup's stays last (its
// reader only ever inspects the final 8 bytes of the file).
function findBlock(buffer) {
  let end = buffer.byteLength;
  for (let guard = 0; guard < 8 && end >= 8; guard++) {
    const foot = new Uint32Array(buffer, end - 8, 2);
    const magic = foot[0], len = foot[1];
    const start = end - 8 - len;
    if (start < 0 || (start & 3)) return null;
    if (magic === TXTR_MAGIC) return { start: start, len: len };
    if (magic !== SKEL_MAGIC && magic !== FGRP_MAGIC) return null; // unknown tail: do not guess
    end = start;
  }
  return null;
}

// Rebuild a THREE.Texture from encoded bytes, with the SAME flags ImportGLTF sets -- otherwise a
// round-tripped model comes back a gamma out (albedo) or upside down (all three).
function decode(bytes, mime, srgb, THREE) {
  const blob = new Blob([bytes], { type: mime });
  return createImageBitmap(blob).then((bmp) => {
    const tex = new THREE.Texture(bmp);
    if (srgb && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = false;               // glTF UV origin, which is what these coordinates are
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.needsUpdate = true;
    // Kept so the next save is a memcpy of the original bytes rather than a re-encode.
    tex._sxrSrc = { bytes: bytes, mime: mime };
    return tex;
  });
}

TextureIO.deserialize = function (buffer, meshes, THREE) {
  try {
    if (!buffer || !meshes || !meshes.length || !THREE) return;
    const blk = findBlock(buffer);
    if (!blk) return;
    const u = new Uint32Array(buffer, blk.start, blk.len / 4);
    const f = new Float32Array(buffer, blk.start, blk.len / 4);
    let o = 0;
    if (u[o++] !== TXTR_MAGIC) return;
    const ver = u[o++];
    if (ver > TXTR_VERSION) return;  // written by a newer build: leave it alone
    const n = u[o++];

    for (let r = 0; r < n; r++) {
      const mi = u[o++], flags = u[o++];
      const trans = f[o++], rough = f[o++], metal = f[o++], nscale = f[o++];
      const m = meshes[mi];

      // The SCALARS are synchronous and land immediately; only the images have to wait.
      if (m && m.setTransmission && trans > 0) m.setTransmission(trans);

      for (let k = 0; k < 3; k++) {
        if (!(flags & (1 << k))) continue;
        const mimeIdx = u[o++], len = u[o++];
        const at = blk.start + o * 4;
        o += ((len + 3) & ~3) / 4;
        if (!m) continue;
        const bytes = new Uint8Array(buffer.slice(at, at + len));
        // Albedo is the only sRGB one -- the other two are linear data, and calling either of
        // them colour would bend every roughness and every normal on the way in.
        decode(bytes, MIME[mimeIdx] || MIME[0], k === 0, THREE).then((tex) => {
          // A load can be superseded while an image decodes, so re-check the mesh is still the
          // one we were asked about rather than writing into a scene that has moved on.
          if (!m || (m.isVisible === undefined && !m.getID)) return;
          if (k === 0 && m.setAlbedoMap) m.setAlbedoMap(tex);
          else if (k === 1 && m.setRoughMetalMap) m.setRoughMetalMap(tex, rough, metal);
          else if (k === 2 && m.setNormalMap) m.setNormalMap(tex, nscale);
        }).catch((e) => console.warn('[TextureIO] map decode failed for mesh ' + mi, e));
      }
    }
  } catch (e) {
    console.error('[TextureIO] deserialize failed', e);
  }
};

TextureIO.MAGIC = TXTR_MAGIC;
TextureIO.VERSION = TXTR_VERSION;

export default TextureIO;
