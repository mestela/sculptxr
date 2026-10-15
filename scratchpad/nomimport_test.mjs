// node scratchpad/nomimport_test.mjs [file.nom]  -- decodes a real .nom through NomFile + ImportNOM
import fs from 'fs';
import NomFile from '../src/files/NomFile.js';
const f = process.argv[2] || process.env.HOME + '/Desktop/sphere_facegroups.nom';
if (!fs.existsSync(f)) { console.log('skip: no sample at ' + f); process.exit(0); }
let bad = 0; const ok = (n, c, d = '') => { console.log((c ? 'ok   ' : 'FAIL ') + n + ' ' + d); if (!c) bad++; };
const t = Date.now();
const nom = new NomFile(fs.readFileSync(f));
ok('version', nom.version === 7, nom.version);
ok('data block closes the file', nom.dataOffset + nom.dataLength === nom.totalSize && nom.totalSize === fs.statSync(f).size);
const m = nom.scene.meshes[0];
const v = nom.f32(m.vertices), fc = nom.i32(m.faces), g = nom.u16(m.faces_group);
ok('vertex count', v.length === m.count_vertex * 3);
let mx = 0; for (const i of fc) mx = Math.max(mx, i);
ok('face indices in range', mx < m.count_vertex, 'max ' + mx);
const cnt = {}; for (const x of g) cnt[x] = (cnt[x] || 0) + 1;
ok('face groups match defs', Object.keys(cnt).length === m.groups.length, JSON.stringify(cnt));
ok('every array decodes', (() => { let n = 0; const w = (o) => { if (o && typeof o === 'object') { if (o.offset !== undefined && o.type) { nom.bytesOf(o); n++; } for (const k in o) w(o[k]); } }; w(nom.scene.meshes); return n > 20; })());
ok('typeless all-zeros array takes its size from the caller', nom.bytesOf({ count: 5, only_zeros: true }, 'u16').length === 10);
console.log('done in ' + (Date.now() - t) + ' ms');
process.exit(bad ? 1 : 0);
