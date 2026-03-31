// VoxelWorker.js - Dynamic Import Version
// This enables us to catch import errors (404, syntax, etc) which otherwise silent-fail the worker.

// console.log("VoxelWorker: Script Loading... (Dynamic)");

let VoxelState = null;
let TestModule = null;
let wasmModule = null;
let isReady = false;
let voxelState = null;

// Undo/Redo History
const history = [];
let historyPtr = -1;
let snapshotCounter = 0;
const MAX_HISTORY = 20; // Limit memory usage
let isDirty = false; // Tracks if the current snapshot has been modified

// Async Init to catch import errors
(async function () {
  try {
    // console.log("VoxelWorker: Importing TestModule...");
    // Handle potentially different base paths? No, strictly relative to this file.
    const tm = await import('./TestModule.js');
    TestModule = tm.default;
    // console.log("VoxelWorker: TestModule Loaded ->", TestModule);

    // console.log("VoxelWorker: Importing VoxelState...");
    const vs = await import('../editing/VoxelState.js');
    VoxelState = vs.default;
    // console.log("VoxelWorker: VoxelState Loaded");

    // Load Rust WASM
    try {
      // Use robust fetch approach for Vite Web Workers
      const wasmUrl = new URL('./voxel_wasm.wasm', import.meta.url).href;
      const response = await fetch(wasmUrl);
      const { instance } = await WebAssembly.instantiateStreaming(response, {
        env: {
          // Provide basic math env if Rust standard library requires panic handlers (shouldn't for no_std/basic std)
        }
      });
      globalThis.wasmModule = instance.exports;
      wasmModule = instance.exports;
      console.log("VoxelWorker: Rust WASM Loaded Successfully!");
    } catch (wasmErr) {
      console.warn("VoxelWorker: Rust WASM Load Failed -> using JS SurfaceNets fallback", wasmErr);
    }

    isReady = true;

    // If we queued any messages, process them here? 
    // For now, simpler to just start accepting.

  } catch (e) {
    // console.error("VoxelWorker: CRITICAL IMPORT ERROR", e);
    // Report to main thread (optional, console is visible)
    self.postMessage({ type: 'ERROR', message: e.message, stack: e.stack });
  }
})();

self.onerror = function (e) {
  console.error("VoxelWorker_GlobalError:", e.message, e.filename, e.lineno, e);
};

self.onmessage = function (e) {
  const msg = e.data;

  if (!isReady) {
    // console.warn(`VoxelWorker: Received message '${msg.type}' before imports ready. Retrying in 100ms...`);
    setTimeout(() => self.onmessage(e), 100);
    return;
  }

  try {
    switch (msg.type) {
      case 'INIT':
        init(msg.res, msg.size);
        break;
      case 'RESAMPLE':
        resample(msg.res, msg.size, msg.min);
        break;
      case 'SNAPSHOT':
        snapshot();
        break;
      case 'UNDO':
        undo();
        break;
      case 'REDO':
        redo();
        break;
      case 'EDIT_SPHERE':
        // self.postMessage({ type: 'LOG', data: "Worker received EDIT_SPHERE with shape: " + msg.shape });
        editSphere(msg.center, msg.radius, msg.color, msg.isNegative, msg.shape, msg.brushRotation, msg.returnMesh);
        break;
      case 'INFLATE':
        // self.postMessage({ type: 'LOG', data: "Worker received INFLATE with shape: " + msg.shape });
        inflateSphere(msg.center, msg.radius, msg.strength, msg.shape, msg.brushRotation, msg.returnMesh);
        break;
      case 'SMOOTH_SPHERE':
        smoothSphere(msg.center, msg.radius, msg.strength, msg.shape, msg.brushRotation, msg.returnMesh);
        break;
      case 'WARP_SPHERE':
        warpSphere(msg.center, msg.radius, msg.translation, msg.rotation, msg.steps, msg.stepRotation, msg.returnMesh);
        break;
      case 'SMOOTH':
        setSmooth(msg.value);
        break;
      case 'GET_MESH':
        postMesh();
        break;
      case 'CLEAR':
        if (voxelState) {
          if (voxelState.clear) voxelState.clear();
          else voxelState = new VoxelState(voxelState.resolution, voxelState.size);
        }
        // Reset History
        if (voxelState) {
          history.length = 0;
          const df = voxelState.getDistanceField();
          const copy = new Float32Array(df);
          history.push({ df: copy, id: 0 });
          historyPtr = 0;
          snapshotCounter = 0;
        }
        postMesh();
        break;
      case 'MESH_TO_VOXEL':
        meshToVoxel(msg);
        break;
      case 'REMESH_QUADRS':
        remeshQuads(msg);
        break;
      default:
        // console.warn('VoxelWorker: Unknown message', msg.type);
    }
  } catch (err) {
    console.error('VoxelWorker Error:', err);
  }
};

function meshToVoxel(msg) {
  if (msg.res && msg.size && msg.center) {
    // console.log(`[VoxelWorker] meshToVoxel: Re-initializing VoxelState with Res=${msg.res}, Size=${msg.size.toFixed(2)}`);
    voxelState = new VoxelState(msg.res, msg.size); // Dynamic re-init!
  }

  if (!voxelState) return;
  
  if (voxelState.addMeshSDF(msg.v, msg.c, msg.m, msg.f)) {
    isDirty = true;
  } else {
    // console.warn(`[VoxelWorker] addMeshSDF FAILED or NO CHANGE!`);
  }
  postMesh();
}

function init(res, size) {
  if (!VoxelState) {
    // console.error("VoxelWorker: Cannot Init, VoxelState class missing.");
    return;
  }
  voxelState = new VoxelState(res, size);
  history.length = 0;
  snapshotCounter = 0;

  // Push Initial State (Empty)
  const df = voxelState.getDistanceField();
  const copy = new Float32Array(df);
  history.push({ df: copy, id: snapshotCounter });
  historyPtr = 0;

  // self.postMessage({ type: 'LOG', data: `Voxel Init. Snapshot: ${snapshotCounter}` });

  postMesh();
}

function resample(res, size, min) {
  if (!voxelState) {
    self.postMessage({ type: 'LOG', data: "VoxelWorker.resample Error: voxelState is null!" });
    return;
  }

  // self.postMessage({ type: 'LOG', data: `VoxelWorker.resample Start: res=${res} size=${size} min=${min}` });

  // Resample
  voxelState.resample(res, size, min);

  // Clear History (Complex to resample history, so just reset for now?)
  // Ideally we should try to resample history too, but memory usage explodes.
  // Let's reset history but keep current state.
  history.length = 0;
  snapshotCounter++; // New era

  const df = voxelState.getDistanceField();
  const copy = new Float32Array(df);
  history.push({ df: copy, id: snapshotCounter });
  historyPtr = 0;

  // self.postMessage({ type: 'LOG', data: `Voxel Resampled to ${res}. History Reset.` });

  postMesh();
}

function setSmooth(val) {
  if (!voxelState) return;
  voxelState.smooth = val;
  // Re-compute mesh immediately
  postMesh();
}

function snapshot() {
  if (!voxelState) return;

  const currentDF = voxelState.getDistanceField();
  const newDF = new Float32Array(currentDF); // Clone
  let reused = false;

  // If Dirty OR First time -> New History Step
  if (isDirty || historyPtr < 0 || history.length === 0) {
    if (historyPtr < history.length - 1) {
      history.length = historyPtr + 1; // Truncate
    }
    snapshotCounter++;
    historyPtr++;
    history.push({ df: newDF, id: snapshotCounter });

    // Limit Size
    if (history.length > MAX_HISTORY) {
      history.shift();
      historyPtr--;
    }
  } else {
    // Reuse current step (Clean)
    reused = true;
  }

  // Compute Volume
  let vol = 0;
  for (let i = 0; i < newDF.length; i++) {
    if (newDF[i] <= 0.0) vol++;
  }

  voxelState.setDistanceField(newDF);
  isDirty = false; // Reset dirty

  const b = voxelState._activeMin;
  const B = voxelState._activeMax;
  // self.postMessage({ type: 'LOG', data: `Snapshot Created: ${snapshotCounter} (Ptr=${historyPtr}) Vol=${vol} Reused=${reused} Bounds=[${b[0]},${b[1]},${b[2]}]-[${B[0]},${B[1]},${B[2]}]` });
}

function undo() {
  // If we have unsaved changes, save them first so we can Redo later.
  if (isDirty) {
    snapshot();
  }

  if (historyPtr > 0) {
    historyPtr--;
    restoreState(history[historyPtr]);
    isDirty = false;

    const id = history[historyPtr].id;
    const df = history[historyPtr].df;
    let vol = 0;
    for (let i = 0; i < df.length; i++) {
      if (df[i] <= 0.0) vol++;
    }

    // self.postMessage({ type: 'LOG', data: `Undo -> Snapshot: ${id} (Ptr=${historyPtr + 1}->${historyPtr}) Vol=${vol}` });
  } else {
    // self.postMessage({ type: 'LOG', data: `Undo Failed: Bottom of Stack (Ptr=${historyPtr})` });
  }
}

function redo() {
  if (historyPtr < history.length - 1) {
    historyPtr++;
    restoreState(history[historyPtr]);
    isDirty = false;

    const id = history[historyPtr].id;
    const df = history[historyPtr].df;
    let vol = 0;
    for (let i = 0; i < df.length; i++) {
      if (df[i] <= 0.0) vol++;
    }
    // self.postMessage({ type: 'LOG', data: `Redo -> Snapshot: ${id} (Ptr=${historyPtr}) Vol=${vol}` });
  } else {
    // self.postMessage({ type: 'LOG', data: `Redo Failed: Top of Stack (Ptr=${historyPtr})` });
  }
}

function restoreState() {
  if (!voxelState || historyPtr < 0) return;
  const state = history[historyPtr];
  if (state && state.df) {
    if (state.df.length !== voxelState.getDistanceField().length) {
      // console.error(`VoxelWorker: Undo/Redo Mismatch! Hist=${state.df.length} Curr=${voxelState.getDistanceField().length}`);
      // Try to recover? Resampling undo history is hard.
      // For now, just warn.
      return;
    }
    voxelState.setDistanceField(state.df);
    postMesh();
  }
}

function editSphere(center, radius, color, isNegative, shape, brushRotation, returnMesh) {
  if (!voxelState) return;

  const t0 = performance.now();
  
  if (center && center[0] > 1000.0) {
    // console.log("DIAGNOSTIC WORKER: Received huge center[0]: " + center[0] + " (meters?). Main thread divide by 1000 failed?");
  }

  // Apply edit
  const changed = voxelState.editSphere(center, radius, color, isNegative, shape, brushRotation);
  const t1 = performance.now();

  if (!changed) {
     self.postMessage({ type: 'LOG', data: `EditSphere: No Change (Rad=${radius.toFixed(2)}, C=[${center[0].toFixed(1)},${center[1].toFixed(1)},${center[2].toFixed(1)}], Neg=${isNegative})` });
  } else {
    isDirty = true;
    // self.postMessage({ type: 'LOG', data: `EditSphere: SUCCESS in ${(t1-t0).toFixed(2)}ms` });
  }

  if (returnMesh) postMesh();
}

function inflateSphere(center, radius, strength, shape, brushRotation, returnMesh) {
  if (!voxelState) return;
  if (voxelState.inflateSphere(center, radius, strength, shape, brushRotation)) {
    isDirty = true;
  }
  if (returnMesh) postMesh();
}

function smoothSphere(center, radius, strength, shape, brushRotation, returnMesh) {
  if (!voxelState) return;
  if (voxelState.smoothSphere(center, radius, strength, shape, brushRotation)) {
    isDirty = true;
  }
  if (returnMesh) postMesh();
}

function warpSphere(center, radius, translation, rotation, steps, stepRotation, returnMesh) {
  if (!voxelState) return;
  if (voxelState.warpSphere(center, radius, translation, rotation, steps, stepRotation)) {
    isDirty = true;
  }
  if (returnMesh) postMesh();
}

function postMesh() {
  if (!voxelState) return;

  // self.postMessage({ type: 'LOG', data: `VoxelWorker postMesh Start: extracting surface...` });

  const t0 = performance.now();
  
  // PRE-MESH VALIDATION: Check if Distance Field itself is corrupted
  const df = voxelState.getDistanceField();
  let hasBadDF = false;
  for (let i = 0; i < df.length; i++) {
    if (isNaN(df[i])) {
      hasBadDF = true;
      break;
    }
  }
  if (hasBadDF) {
    // console.error("[Mesh Error] VoxelWorker postMesh: Distance Field contains NaN BEFORE mesh extraction!");
  }

  let res = null;
  try {
    res = voxelState.computeMesh(); 
  } catch (err) {
    // self.postMessage({ type: 'LOG', data: `VoxelWorker postMesh Error: computeMesh threw: ${err.message}` });
    return;
  }

  const t1 = performance.now();

  // Validate Mesh Vertices for NaN/Infinity
  if (res.vertices) {
    let hasBad = false;
    for (let i = 0; i < res.vertices.length; i++) {
      if (isNaN(res.vertices[i]) || res.vertices[i] === Infinity || res.vertices[i] === -Infinity) {
        hasBad = true;
        break;
      }
    }
    if (hasBad) {
      // console.error("[Mesh Error] VoxelWorker postMesh: Generated Mesh contains NaN or Infinity vertices!");
    }
  }

  const transfer = [];
  if (res.vertices && res.vertices.buffer) transfer.push(res.vertices.buffer);
  if (res.faces && res.faces.buffer) transfer.push(res.faces.buffer);
  if (res.colors && res.colors.buffer) transfer.push(res.colors.buffer);
  if (res.materials && res.materials.buffer) transfer.push(res.materials.buffer);
  if (res.normals && res.normals.buffer) transfer.push(res.normals.buffer);

  self.postMessage({ 
    type: 'MESH_UPDATE', 
    data: res, 
    computeTime: (t1 - t0),
    isWASM: res.isWASM
  }, transfer);
}

function remeshQuads(msg) {
  if (!globalThis.wasmModule) {
    console.error("remeshQuads: wasmModule not loaded");
    return;
  }

  const wasm = globalThis.wasmModule;
  const vertices = msg.v;
  const faces = msg.f;
  const targetFaces = msg.targetFaces;

  const vLen = vertices.length;
  const fLen = faces.length;

  const vPtr = wasm.alloc(vLen * 4);
  const fPtr = wasm.alloc(fLen * 4);

  new Float32Array(wasm.memory.buffer, vPtr, vLen).set(vertices);
  new Uint32Array(wasm.memory.buffer, fPtr, fLen).set(faces);

  const resPtr = wasm.remesh_quads_wasm(vPtr, vLen, fPtr, fLen, targetFaces);

  if (resPtr === 0) {
    console.error("remesh_quads_wasm FAILED");
    wasm.dealloc(vPtr, vLen * 4);
    wasm.dealloc(fPtr, fLen * 4);
    return;
  }

  const meta = new Uint32Array(wasm.memory.buffer, resPtr, 10);
  const outVPtr = meta[0], outVLen = meta[1];
  const outFPtr = meta[2], outFLen = meta[3];

  const outVertices = new Float32Array(wasm.memory.buffer, outVPtr, outVLen).slice();
  const outFaces = new Uint32Array(wasm.memory.buffer, outFPtr, outFLen).slice();

  wasm.free_mesh_result(resPtr);
  wasm.dealloc(vPtr, vLen * 4);
  wasm.dealloc(fPtr, fLen * 4);

  const transfer = [];
  if (outVertices.buffer) transfer.push(outVertices.buffer);
  if (outFaces.buffer) transfer.push(outFaces.buffer);

  self.postMessage({
    type: 'MESH_UPDATE_QUAD',
    data: {
      vertices: outVertices,
      faces: outFaces,
      id: msg.id
    }
  }, transfer);
}



