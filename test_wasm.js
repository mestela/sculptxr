const fs = require('fs');

async function test() {
    const buf = fs.readFileSync('src/workers/voxel_wasm.wasm');
    const wasm = await WebAssembly.compile(buf);
    console.log(WebAssembly.Module.exports(wasm));
}

test();
