import fs from 'fs';
const buf = fs.readFileSync(process.argv[2]);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const M = 0x534b454c, F = 0x46475250;
let end = ab.byteLength, blk = null;
for (let g = 0; g < 8 && end >= 8; g++) { const ft = new Uint32Array(ab, end - 8, 2); const st = end - 8 - ft[1];
  if (ft[0] === M) { blk = { st, len: ft[1] }; break; } if (ft[0] !== F) break; end = st; }
const u = new Uint32Array(ab, blk.st, blk.len / 4), f = new Float32Array(ab, blk.st, blk.len / 4);
let o = 0; o++; const ver = u[o++], n = u[o++]; const NONE = 0xffffffff;
console.log('SKEL v' + ver, n, 'entries');
const rows = [];
for (let i = 0; i < n; i++) rows.push({ mi: u[o++], pi: u[o++], bone: u[o++], r: f[o++], mir: u[o++], pin: u[o++] });
const ns = u[o++];
for (let i = 0; i < ns; i++) { o++; const nj = u[o++], nv = u[o++]; o++; o += nj + nv * 8 + nv * 3 + nj * 16; }
const nr = u[o++]; const rest = new Map();
for (let i = 0; i < nr; i++) { const mi = u[o++]; rest.set(mi, Array.from(f.subarray(o, o + 16))); o += 16; }
o += 1 + u[o] * 12;           // vols
const rads = u[o++]; o += rads * 2;
const sc = u[o++]; o += sc * 4;
const of = u[o++]; o += of * 4;
const rd = u[o++]; o += rd * 2;
const ph = u[o++]; o += ph * 4;
const ph2 = u[o++]; o += ph2 * 7;
const rign = u[o++]; const rig = [];
for (let i = 0; i < rign; i++) { rig.push({ i: u[o], aim: u[o + 1], sac: u[o + 2] }); o += 7; }
const J = new Map(rows.filter(r => r.bone & 1).map(r => [r.mi, { ...r, kids: [] }]));
for (const j of J.values()) if (J.has(j.pi)) J.get(j.pi).kids.push(j);
const mul = (a, b) => { const c = new Array(16).fill(0); for (let i = 0; i < 4; i++) for (let k = 0; k < 4; k++) for (let j = 0; j < 4; j++) c[k * 4 + j] += a[i * 4 + j] * b[k * 4 + i]; return c; };
const W = new Map(); const wm = j => { if (W.has(j)) return W.get(j); const l = rest.get(j.mi); const m = J.has(j.pi) ? mul(wm(J.get(j.pi)), l) : l; W.set(j, m); return m; };
const modes = ['none', 'POS', 'FULL', '?', 'ROT'];
const pm = b => ((b >> 1) & 3) | ((b >> 2) & 4);
const pr = (j, d) => { const m = wm(j); const rg = rig.find(r => r.i === j.mi);
  console.log('  '.repeat(d) + '#' + j.mi + ' (' + m[12].toFixed(2) + ',' + m[13].toFixed(2) + ',' + m[14].toFixed(2) + ') r=' + j.r.toFixed(2)
   + ' pin=' + (modes[pm(j.bone)] ?? pm(j.bone)) + (j.pin !== NONE ? '[pinMesh#' + j.pin + ']' : '') + (j.mir !== NONE ? ' mir#' + j.mir : '') + (rg && rg.aim !== NONE ? ' AIM->#' + rg.aim : ''));
  j.kids.forEach(k => pr(k, d + 1)); };
for (const j of J.values()) if (!J.has(j.pi)) pr(j, 0);
console.log('rig constraints:', JSON.stringify(rig));
