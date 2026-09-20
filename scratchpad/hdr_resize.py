#!/usr/bin/env python3
"""Downsample a Radiance .hdr in LINEAR FLOAT, preserving dynamic range.

ffmpeg's scale filter clamps HDR to [0,1]: measured on ferndale_studio_07, peak went from
1216.0 to 1.00, which removes every actual light source from the image and leaves an IBL
that looks flat and dim. This does the resample in float and writes RGBE back out.
"""
import struct, sys

def read_hdr(path):
    f = open(path, 'rb')
    if not f.readline().startswith(b'#?'):
        raise ValueError('not a Radiance file')
    while True:
        line = f.readline()
        if line.strip() == b'':
            break
    dims = f.readline().split()
    if dims[0] != b'-Y' or dims[2] != b'+X':
        raise ValueError('unsupported orientation %r' % dims)
    h, w = int(dims[1]), int(dims[3])
    px = bytearray(w * h * 4)
    for y in range(h):
        row = f.read(4)
        if len(row) < 4:
            raise ValueError('truncated at row %d' % y)
        if row[0] == 2 and row[1] == 2 and ((row[2] << 8) | row[3]) == w:
            # new-style RLE: four separate channel planes
            for c in range(4):
                x = 0
                while x < w:
                    n = f.read(1)[0]
                    if n > 128:
                        val = f.read(1)[0]
                        for _ in range(n - 128):
                            px[(y * w + x) * 4 + c] = val; x += 1
                    else:
                        data = f.read(n)
                        for b in data:
                            px[(y * w + x) * 4 + c] = b; x += 1
        else:
            px[(y * w) * 4:(y * w) * 4 + 4] = row
            px[(y * w + 1) * 4:(y * w + h) * 4] = f.read((w - 1) * 4)
    f.close()
    return w, h, px

def to_float(w, h, px):
    out = [0.0] * (w * h * 3)
    for i in range(w * h):
        e = px[i * 4 + 3]
        if e == 0:
            continue
        s = 2.0 ** (e - 136)          # (e-128) exponent, /256 mantissa
        out[i * 3] = (px[i * 4] + 0.5) * s
        out[i * 3 + 1] = (px[i * 4 + 1] + 0.5) * s
        out[i * 3 + 2] = (px[i * 4 + 2] + 0.5) * s
    return out

def box_down(w, h, f, factor):
    ow, oh = w // factor, h // factor
    out = [0.0] * (ow * oh * 3)
    inv = 1.0 / (factor * factor)
    for y in range(oh):
        for x in range(ow):
            r = g = b = 0.0
            for j in range(factor):
                for i in range(factor):
                    k = ((y * factor + j) * w + (x * factor + i)) * 3
                    r += f[k]; g += f[k + 1]; b += f[k + 2]
            o = (y * ow + x) * 3
            out[o] = r * inv; out[o + 1] = g * inv; out[o + 2] = b * inv
    return ow, oh, out

def write_hdr(path, w, h, f):
    import math
    out = open(path, 'wb')
    out.write(b'#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n')
    out.write(b'-Y %d +X %d\n' % (h, w))
    row = bytearray(w * 4)
    for y in range(h):
        for x in range(w):
            k = (y * w + x) * 3
            r, g, b = f[k], f[k + 1], f[k + 2]
            m = max(r, g, b)
            if m < 1e-32:
                row[x * 4:x * 4 + 4] = b'\0\0\0\0'
                continue
            mant, e = math.frexp(m)
            sc = mant * 256.0 / m
            row[x * 4] = min(255, int(r * sc))
            row[x * 4 + 1] = min(255, int(g * sc))
            row[x * 4 + 2] = min(255, int(b * sc))
            row[x * 4 + 3] = min(255, e + 128)
        out.write(bytes(row))    # flat RGBE: valid, and simpler than emitting RLE
    out.close()

if __name__ == '__main__':
    src, dst, factor = sys.argv[1], sys.argv[2], int(sys.argv[3])
    w, h, px = read_hdr(src)
    f = to_float(w, h, px)
    print('in  %dx%d  max=%.2f' % (w, h, max(f)))
    ow, oh, of = box_down(w, h, f, factor)
    print('out %dx%d  max=%.2f' % (ow, oh, max(of)))
    write_hdr(dst, ow, oh, of)
