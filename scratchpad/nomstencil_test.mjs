// node scratchpad/nomstencil_test.mjs [file.nom ...] -- Catmull-Clark stencil vs Nomad's own stored offsets
import fs from 'fs';
import NomFile from '../src/files/NomFile.js';
import { buildStencil, applyStencil } from '../src/files/NomMultires.js';
const files = process.argv.slice(2).length ? process.argv.slice(2) : ['wrestle_rest.nom', 'sphere_facegroups.nom', 'skinny2.nom'].map((f) => process.env.HOME + '/Desktop/' + f);
let bad = 0; const ok = (n, c, d = '') => { console.log((c ? 'ok   ' : 'FAIL ') + n + ' ' + d); if (!c) bad++; };
for (const f of files) {
  if (!fs.existsSync(f)) { console.log('skip ' + f); continue; }
  const nom = new NomFile(fs.readFileSync(f));
  nom.scene.meshes.forEach((m, mi) => {
    const lv = m.multires_levels; if (!lv || lv.length < 2) return;
    const viewed = m.multires_level | 0, top = nom.f32(m.vertices);
    const facesOf = (k) => nom.i32(k === viewed ? m.faces : lv[k].faces);
    // positions per level: up to the viewed level they are slices of the top array
    let P = viewed === 0 ? top : top.subarray(0, lv[0].count_vertex * 3);
    for (let k = 1; k < lv.length; k++) {
      const parent = facesOf(k - 1), kids = facesOf(k), nOld = lv[k - 1].count_vertex, nNew = lv[k].count_vertex;
      const tag = f.split('/').pop() + ' mesh' + mi + ' level ' + k + '(' + nNew + 'v)';
      if (!parent || !kids) { console.log('skip ' + tag + ' (no faces)'); break; }
      const t0 = Date.now(), st = buildStencil(parent, kids, nOld, nNew), ms = Date.now() - t0;
      ok(tag + ' structure', !!st, ms + 'ms');
      if (!st) break;
      const S = new Float32Array(nNew * 3); applyStencil(st, P, S, nNew);
      const off = lv[k].level_offsets && nom.f32(lv[k].level_offsets);
      const truth = k <= viewed ? top.subarray(0, nNew * 3) : null;
      let next;
      if (off) {
        next = new Float32Array(nNew * 3); for (let i = 0; i < nNew * 3; i++) next[i] = S[i] + off[i];
        if (truth) {
          let mx = 0; for (let i = 0; i < nNew * 3; i++) mx = Math.max(mx, Math.abs(next[i] - truth[i]));
          // Format 7 stores plain object-space offsets and this must hold to float precision. Format 6
          // (an older Nomad) stores offsets that do NOT follow that rule (measured: error ~2e-2 on a
          // sculpted head), which does not matter: up to the viewed level the importer takes the
          // positions from the top array and never reads those offsets.
          if (nom.version >= 7) ok(tag + ' stencil+offset == stored positions', mx < 2e-6, 'max err ' + mx.toExponential(2));
          else console.log('     ' + tag + ' (format ' + nom.version + ': offsets not object-space) |stencil+offset - stored| max ' + mx.toExponential(2));
        }
      } else if (truth) {
        // no offsets stored for this level: report how far the plain subdivision is from the truth
        let mx = 0, s = 0; for (let i = 0; i < nNew * 3; i++) { const d = Math.abs(S[i] - truth[i]); mx = Math.max(mx, d); s += d; }
        console.log('     ' + tag + ' no offsets in file; |stencil - stored| max ' + mx.toExponential(2) + ' mean ' + (s / (nNew * 3)).toExponential(2));
        next = truth;
      } else break;
      P = next;
    }
  });
}
process.exit(bad ? 1 : 0);
