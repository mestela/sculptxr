// Nomad Sculpt .nom container reader. Imports nothing, so it runs under plain node (see
// scratchpad/nomimport_test.mjs). Reverse-engineered from sample files, 2026-10-10.
//
// LAYOUT (little-endian):
//   0x00  "Nomad Sculpt"            12 bytes
//   0x0c  u32 version               7 in the samples
//   0x10  u64 x7: totalSize, jsonOffset, jsonLength, dataOffset, dataLength, thumbOffset, thumbWidth
//   0x48  thumbnail                 thumbWidth x thumbWidth RGBA8 (128x128)
//         JSON scene                groups/lights/materials/meshes/scene/settings
//         data block                every binary array, addressed by the JSON
//
// A JSON array descriptor is {count, type, offset, length, lz4, only_zeros}. `offset` is relative
// to the DATA BLOCK (not the file), so rewriting the JSON never moves an array.
//
// An lz4 array is a run of chunks: [u32 rawLen][u32 compLen][LZ4 block], 1 MiB raw per chunk.
// Vertices (f32vec3) and the multires level_offsets are stored raw, without the lz4 flag.

const MAGIC = 'Nomad Sculpt';

const TYPE_SIZE = { f32vec3: 12, f32vec2: 8, i32vec4: 16, u16: 2, u8: 1, u8rgbm: 4, u8vec2: 2 };

// Plain LZ4 block decode (no frame). `out` is preallocated at the known raw length.
function lz4Block(src, sStart, sEnd, out, oStart) {
  let s = sStart, o = oStart;
  while (s < sEnd) {
    const token = src[s++];
    let lit = token >> 4;
    if (lit === 15) { let b; do { b = src[s++]; lit += b; } while (b === 255); }
    for (let k = 0; k < lit; k++) out[o++] = src[s++];
    if (s >= sEnd) break;
    const off = src[s] | (src[s + 1] << 8); s += 2;
    let ml = token & 15;
    if (ml === 15) { let b; do { b = src[s++]; ml += b; } while (b === 255); }
    ml += 4;
    // byte by byte: a match may overlap its own output (run-length)
    for (let k = 0, m = o - off; k < ml; k++) out[o++] = out[m++];
  }
  return o;
}

class NomFile {
  constructor(buffer) {
    const bytes = this.bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const view = this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < MAGIC.length; i++)
      if (bytes[i] !== MAGIC.charCodeAt(i)) throw new Error('Not a Nomad .nom file');
    this.version = view.getUint32(12, true);
    const u64 = (o) => Number(view.getBigUint64(o, true));
    this.totalSize = u64(0x10);
    this.jsonOffset = u64(0x18);
    this.jsonLength = u64(0x20);
    this.dataOffset = u64(0x28);
    this.dataLength = u64(0x30);
    this.thumbOffset = u64(0x38);
    this.thumbWidth = u64(0x40);
    if (this.jsonOffset + this.jsonLength > bytes.length || this.dataOffset > bytes.length)
      throw new Error('Truncated .nom file');
    this.scene = JSON.parse(new TextDecoder().decode(
      bytes.subarray(this.jsonOffset, this.jsonOffset + this.jsonLength)));
  }

  // Raw bytes of a descriptor, decompressed. Returns a fresh Uint8Array (aligned, so typed
  // views over `.buffer` are safe). null when the descriptor is absent.
  bytesOf(desc) {
    if (!desc) return null;
    const size = TYPE_SIZE[desc.type];
    if (!size) throw new Error('Unknown .nom array type ' + desc.type);
    const n = desc.count * size;
    if (desc.only_zeros) return new Uint8Array(n);
    const start = this.dataOffset + desc.offset;
    // a copy: Buffer.slice (node) is a view, and typed views over `.buffer` need it aligned
    if (!desc.lz4) return new Uint8Array(this.bytes.subarray(start, start + n));
    const out = new Uint8Array(n);
    let p = start, o = 0;
    const end = start + desc.length;
    while (p < end) {
      const rawLen = this.view.getUint32(p, true), compLen = this.view.getUint32(p + 4, true);
      p += 8;
      lz4Block(this.bytes, p, p + compLen, out, o);
      p += compLen; o += rawLen;
    }
    if (o !== n) throw new Error('.nom array decoded to ' + o + ' bytes, expected ' + n);
    return out;
  }

  // A whole .nom with `scene` as its JSON. Everything else is copied through UNTOUCHED: header
  // (with the four moved offsets rewritten), thumbnail, and the data block byte for byte. Array
  // offsets are data-block-relative, so editing the JSON cannot invalidate them.
  // `patches` is [{ offset, bytes }] with offsets relative to the data block: written over a COPY
  // of it, for arrays that are stored raw (vertices) and so can be replaced in place.
  serialize(scene, patches) {
    const js = new TextEncoder().encode(JSON.stringify(scene, null, 4));
    const head = this.bytes.subarray(0, this.thumbOffset);
    const thumb = this.bytes.subarray(this.thumbOffset, this.jsonOffset);
    const data = this.bytes.subarray(this.dataOffset, this.dataOffset + this.dataLength);
    const out = new Uint8Array(head.length + thumb.length + js.length + data.length);
    out.set(head, 0); out.set(thumb, head.length);
    const jsonOffset = head.length + thumb.length, dataOffset = jsonOffset + js.length;
    out.set(js, jsonOffset); out.set(data, dataOffset);
    for (const p of patches || []) out.set(p.bytes, dataOffset + p.offset);
    const v = new DataView(out.buffer);
    [out.length, jsonOffset, js.length, dataOffset, data.length, this.thumbOffset, this.thumbWidth]
      .forEach((n, i) => v.setBigUint64(0x10 + i * 8, BigInt(n), true));
    return out;
  }

  f32(desc) { const b = this.bytesOf(desc); return b && new Float32Array(b.buffer); }
  i32(desc) { const b = this.bytesOf(desc); return b && new Int32Array(b.buffer); }
  u16(desc) { const b = this.bytesOf(desc); return b && new Uint16Array(b.buffer); }
}

export default NomFile;
