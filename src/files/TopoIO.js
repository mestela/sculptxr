// TOPO TRANSFER STATE, SAVED: the landmark picks (and which object they were picked on) and a held
// pose (TopoPose.js), so a wrap can be set up, saved, and finished later. Without it a save kept
// only the posed Base -- the picks and the pose to take back out were lost.
//
// THE FOOTER BLOCK 'TOPO', written FIRST of the footer chain: [mesh][TOPO][MDIA][TXTR][SKEL][FGRP].
// Every other reader walks back from the end and stops at its own block (or at a magic it does not
// know), so one placed before them all is never reached by them, this build or an older one.
// Objects are named by their index in the saved list, picks stay in the target's local space.
//   words: [version=1][jsonByteLength][json, padded to 4][held: ref, D as f32, nv*3 each]
//   then the footer [MAGIC][block bytes]
import { topo, refreshMarkers } from '../editing/TopoTransfer.js';
import { held } from '../editing/TopoPose.js';

const TOPO_MAGIC = 0x544F504F;  // 'TOPO'
const KNOWN = [0x4D444941 /* MDIA */, 0x54585452 /* TXTR */, 0x534B454C /* SKEL */, 0x46475250 /* FGRP */, TOPO_MAGIC];

const TopoIO = {};

TopoIO.serialize = function (meshes) {
  const ids = meshes.map((m) => m.getID());
  const target = ids.indexOf(topo.targetId);
  const h = held.pose, hm = h ? ids.indexOf(h.meshId) : -1;
  const out = { v: 1 };
  if (target >= 0 && topo.picks.size) {
    out.target = target;
    out.cur = topo.cur;
    out.picks = Object.fromEntries([...topo.picks].map(([k, q]) => [k, Array.from(q.p)]));
  }
  if (hm >= 0) out.held = { mesh: hm, n: h.D.length, preview: [...h.preview], weights: h.weights || null };
  if (out.target === undefined && !out.held) return null;

  const json = new TextEncoder().encode(JSON.stringify(out));
  const padded = (json.length + 3) & ~3;
  const words = 2 + padded / 4 + (out.held ? 2 * out.held.n : 0);
  const buf = new ArrayBuffer((words + 2) * 4);
  const u = new Uint32Array(buf), f = new Float32Array(buf);
  u[0] = 1; u[1] = json.length;
  new Uint8Array(buf, 8, json.length).set(json);
  if (out.held) {
    const at = 2 + padded / 4;
    f.set(h.ref, at);
    f.set(h.D, at + out.held.n);
  }
  u[words] = TOPO_MAGIC; u[words + 1] = words * 4;
  return buf;
};

function findBlock(buffer) {
  let end = buffer.byteLength;
  for (let guard = 0; guard < 8 && end >= 8; guard++) {
    const foot = new Uint32Array(buffer, end - 8, 2);
    const magic = foot[0], len = foot[1];
    const start = end - 8 - len;
    if (start < 0 || (start & 3)) return null;
    if (magic === TOPO_MAGIC) return { start, len };
    if (!KNOWN.includes(magic)) return null;   // unknown tail: do not guess
    end = start;
  }
  return null;
}

// A file with the block REPLACES the scene's picks and held pose; one without leaves them alone
// (an import added beside a wrap in progress must not clear it).
TopoIO.deserialize = function (buffer, added, main) {
  try {
    const blk = findBlock(buffer);
    if (!blk) return;
    const u = new Uint32Array(buffer, blk.start, 2);
    const n = u[1];
    if (u[0] > 1 || n <= 0 || 8 + n > blk.len) return;
    const data = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, blk.start + 8, n)));
    const t = added[data.target];
    if (t && data.picks) {
      topo.targetId = t.getID();
      topo.picks = new Map(Object.entries(data.picks).map(([k, p]) => [k, { p }]));
      topo.cur = data.cur | 0;
      topo.pick = false;
    }
    const hm = data.held && added[data.held.mesh];
    if (hm) {
      const at = blk.start + 8 + ((n + 3) & ~3), len = data.held.n;
      held.pose = {
        meshId: hm.getID(),
        ref: new Float32Array(buffer.slice(at, at + len * 4)),
        D: new Float32Array(buffer.slice(at + len * 4, at + len * 8)),
        preview: new Map(data.held.preview),
        weights: data.held.weights || null,
      };
    }
    refreshMarkers(main);
    window._refreshTopo?.();
  } catch (e) { console.error('[TopoIO] read failed', e); }
};

export default TopoIO;
