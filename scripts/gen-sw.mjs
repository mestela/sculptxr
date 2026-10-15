// Run after dist/ is fully assembled (deploy.sh does): writes dist/sw.js with the file list baked in.
import { readdirSync, readFileSync, writeFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const dist = 'dist';
// Not precached: the spike entry + repro page (not the app), .ttf (every target browser takes the
// woff2), and every environment but the default (ShaderPBR idEnv 5, Ferndale 1k) -- the rest are
// picked by hand or are legacy-renderer PNGs / an unused 512, and sw.js caches them when first used.
// Also not precached: the copies GeometryWorker never loads (src/workers/voxel_wasm.wasm -- it uses the
// hashed assets/ one -- and assets/manifold-*.wasm -- it uses root manifold.wasm), and examples/.
const skip = /^(spike|repro_controllers\.html|sw\.js|examples\/|src\/workers\/voxel_wasm\.wasm|assets\/manifold-.*\.wasm)|\.ttf$|^app\/resources\/environments\/(?!ferndale_studio_07_1k\.hdr$)/;
const walk = d => readdirSync(d).flatMap(f => statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]);
const files = walk(dist).map(f => relative(dist, f)).filter(f => !skip.test(f) && f !== 'version.json');
const version = JSON.parse(readFileSync(join(dist, 'version.json'), 'utf8')).version;
const list = ['./', ...files.map(f => './' + f)];

writeFileSync(join(dist, 'sw.js'), readFileSync('scripts/sw.template.js', 'utf8')
  .replace('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(list)));
console.log(`sw.js: ${version}, ${list.length} files precached`);
