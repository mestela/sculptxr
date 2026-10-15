// THE VIDEO / AUDIO CLIPS, SAVED AS A REFERENCE.
//
// A .sxr does not embed the clip: it records which file it was (name), where it starts on the
// timeline (offset), and the switches (audio muted, video shown). On open those become a PENDING
// reference -- the timeline shows a "missing" lane for each -- and the moment a file of the same
// name is loaded the saved offset and switches are applied to it. Embedding would make a saved
// scene as big as its clip; a reference keeps saves small and costs one reload of the file.
//
// A pending reference that was never relinked is WRITTEN BACK on the next save, so opening a scene
// and saving it without finding the clip does not quietly forget where the clip was.
//
// THE FOOTER BLOCK 'MDIA', written FIRST of the footer chain: [mesh][MDIA][TXTR][SKEL][FGRP].
// Every other reader walks back from the end and stops at the block it wants, so one placed
// before them all is never reached by an older build, and FGRP stays last (its reader only looks
// at the final 8 bytes). Payload is JSON, so a field can be added without a version bump.
//   words: [version=1][jsonByteLength][json, padded to 4]   then the footer [MAGIC][block bytes]

const MDIA_MAGIC = 0x4D444941;  // 'MDIA'
const KNOWN = [0x54585452 /* TXTR */, 0x534B454C /* SKEL */, 0x46475250 /* FGRP */, MDIA_MAGIC];

const MediaRef = {};

MediaRef.serialize = function (main) {
  const vt = window._videoTrack, at = window._audioTrack, pend = window._pendingMedia || {};
  const rm = main && main._referenceManager;
  const out = { v: 1 };
  if (vt && vt.hasClip()) {
    out.video = { name: vt.name(), offset: vt.offset(), visible: rm ? rm.videoVisible() : true,
      frames: vt.frameCount(), fps: vt.fps() };
  } else if (pend.video) out.video = pend.video;
  if (at && at.hasClip()) {
    out.audio = { name: at.name(), offset: at.offset(), muted: at.isMuted(), duration: at.duration() };
  } else if (pend.audio) out.audio = pend.audio;
  if (!out.video && !out.audio) return null;

  const json = new TextEncoder().encode(JSON.stringify(out));
  const padded = (json.length + 3) & ~3;
  const words = 2 + padded / 4;
  const buf = new ArrayBuffer((words + 2) * 4);
  const u = new Uint32Array(buf);
  u[0] = 1; u[1] = json.length;
  new Uint8Array(buf, 8, json.length).set(json);
  u[words] = MDIA_MAGIC; u[words + 1] = words * 4;
  return buf;
};

function findBlock(buffer) {
  let end = buffer.byteLength;
  for (let guard = 0; guard < 8 && end >= 8; guard++) {
    const foot = new Uint32Array(buffer, end - 8, 2);
    const magic = foot[0], len = foot[1];
    const start = end - 8 - len;
    if (start < 0 || (start & 3)) return null;
    if (magic === MDIA_MAGIC) return { start, len };
    if (!KNOWN.includes(magic)) return null;   // unknown tail: do not guess
    end = start;
  }
  return null;
}

// Reads the block (if any) into the pending reference. Does not touch a clip that is loaded.
MediaRef.deserialize = function (buffer) {
  window._pendingMedia = null;
  try {
    const blk = findBlock(buffer);
    if (!blk) return;
    const u = new Uint32Array(buffer, blk.start, 2);
    const n = u[1];
    if (u[0] > 1 || n <= 0 || 8 + n > blk.len) return;
    const data = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, blk.start + 8, n)));
    const p = {};
    if (data.video && data.video.name) p.video = data.video;
    if (data.audio && data.audio.name) p.audio = data.audio;
    if (p.video || p.audio) window._pendingMedia = p;
  } catch (e) { console.error('[MediaRef] read failed', e); }
};

// A clip finished loading: if it is the one the scene was saved with, restore its settings.
MediaRef.applyLoaded = function (kind, track, file) {
  const pend = window._pendingMedia;
  const p = pend && pend[kind];
  if (!p || !file || p.name !== file.name) return;
  track.setOffset(p.offset || 0);
  if (kind === 'audio') track.setMuted(!!p.muted);
  if (kind === 'video') window.app?._referenceManager?.setVideoVisible?.(p.visible !== false);
  pend[kind] = null;
  if (!pend.video && !pend.audio) window._pendingMedia = null;
};

window._mediaRef = MediaRef;
export default MediaRef;
