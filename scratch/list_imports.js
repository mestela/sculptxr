import fs from 'fs';

const buf = fs.readFileSync('src/workers/voxel_wasm.wasm');
const module = new WebAssembly.Module(buf);
const imports = WebAssembly.Module.imports(module);
console.log(imports);
