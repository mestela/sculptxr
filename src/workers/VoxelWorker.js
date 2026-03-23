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
      const wasmInit = await import('./voxel_wasm.wasm?init');
      const wasmInst = await wasmInit.default();
      wasmModule = wasmInst.exports || wasmInst.instance?.exports;
      console.log("VoxelWorker: Rust WASM Loaded!");
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
        resample(msg.res);
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
      default:
        // console.warn('VoxelWorker: Unknown message', msg.type);
    }
  } catch (err) {
    console.error('VoxelWorker Error:', err);
  }
};

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

function resample(res) {
  if (!voxelState) return;

  // Resample
  voxelState.resample(res);

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

  voxelState.tightenBounds(); // Fix: Tighten once before chunk loop to get real active bounds!

  const t0 = performance.now();
  const chunkSize = 24;
  const res = voxelState._dims[0]; // Fix: use _dims[0] instead of .resolution
  const chunks = [];

  // self.postMessage({ type: 'LOG', data: `VoxelWorker: postMesh running. Res=${res} ActiveMin=${voxelState._activeMin} ActiveMax=${voxelState._activeMax}` });

  // Pre-allocate inputs for WASM once per frame to save overhead
  let dimsPtr = 0, boundsPtr = 0, distancePtr = 0, colorPtr = 0, materialPtr = 0;
  let wasmMemory = null;

  if (wasmModule) {
    try {
      const totalCells = res * res * res;
      dimsPtr = wasmModule.alloc(3 * 4);
      boundsPtr = wasmModule.alloc(6 * 4);
      distancePtr = wasmModule.alloc(totalCells * 4);
      colorPtr = wasmModule.alloc(totalCells * 3 * 4);
      materialPtr = wasmModule.alloc(totalCells * 3 * 4);

      const mem = wasmModule.memory.buffer;
      new Int32Array(mem, dimsPtr, 3).set([res, res, res]);
      new Float32Array(mem, distancePtr, totalCells).set(voxelState.getDistanceField());
      new Float32Array(mem, colorPtr, totalCells * 3).set(voxelState._voxels.colorField);
      new Float32Array(mem, materialPtr, totalCells * 3).set(voxelState._voxels.materialField);
    } catch (allocErr) {
      console.error("VoxelWorker WASM Alloc Error, falling back to JS", allocErr);
      dimsPtr = 0; // Mark as failed
    }
  }

  try {
    for (let x = 0; x < res; x += chunkSize) {
      for (let y = 0; y < res; y += chunkSize) {
        for (let z = 0; z < res; z += chunkSize) {

          if (x >= voxelState._activeMin[0] - chunkSize && x <= voxelState._activeMax[0] &&
              y >= voxelState._activeMin[1] - chunkSize && y <= voxelState._activeMax[1] &&
              z >= voxelState._activeMin[2] - chunkSize && z <= voxelState._activeMax[2]) {

            const bounds = {
              min: [x, y, z],
              max: [Math.min(res, x + chunkSize + 1), Math.min(res, y + chunkSize + 1), Math.min(res, z + chunkSize + 1)]
            };

            let meshData;
            if (wasmModule && dimsPtr !== 0) {
              const mem1 = wasmModule.memory.buffer; // Fresh read
              new Int32Array(mem1, boundsPtr, 6).set([bounds.min[0], bounds.min[1], bounds.min[2], bounds.max[0], bounds.max[1], bounds.max[2]]);

              const resultPtr = wasmModule.compute_surface_wasm(dimsPtr, boundsPtr, distancePtr, colorPtr, materialPtr);

              if (resultPtr !== 0) {
                const mem2 = wasmModule.memory.buffer; // Fresh read after allocation!
                const resultView = new Int32Array(mem2, resultPtr, 10);
                const vPtr = resultView[0], vLen = resultView[1];
                const fPtr = resultView[2], fLen = resultView[3];
                const cPtr = resultView[4], cLen = resultView[5];
                const mPtr = resultView[6], mLen = resultView[7];
                const nPtr = resultView[8], nLen = resultView[9];

                meshData = {
                  vertices: new Float32Array(mem2, vPtr, vLen).slice(), // Clone out of wasm heap!
                  faces: new Uint32Array(mem2, fPtr, fLen).slice(),
                  colors: new Float32Array(mem2, cPtr, cLen).slice(),
                  materials: new Float32Array(mem2, mPtr, mLen).slice(),
                  normals: (nPtr !== 0 && nLen > 0) ? new Float32Array(mem2, nPtr, nLen).slice() : null
                };

                wasmModule.free_mesh_result(resultPtr);
              } else {
                meshData = { vertices: new Float32Array(0), faces: new Uint32Array(0), colors: new Float32Array(0), materials: new Float32Array(0) };
              }
            } else {
              meshData = voxelState.computeMesh(bounds);
            }

            chunks.push({
              id: `chunk_${x}_${y}_${z}`,
              vertices: meshData.vertices,
              faces: meshData.faces,
              colors: meshData.colors,
              materials: meshData.materials,
              normals: meshData.normals
            });
          }
        }
      }
    }
  } finally {
    if (wasmModule && dimsPtr !== 0) {
      const totalCells = res * res * res;
      wasmModule.dealloc(dimsPtr, 3 * 4);
      wasmModule.dealloc(boundsPtr, 6 * 4);
      wasmModule.dealloc(distancePtr, totalCells * 4);
      wasmModule.dealloc(colorPtr, totalCells * 3 * 4);
      wasmModule.dealloc(materialPtr, totalCells * 3 * 4);
    }
  }

  const t1 = performance.now();

  self.postMessage({ type: 'LOG', data: `VoxelWorker: postMesh generated ${chunks.length} chunks in ${(t1-t0).toFixed(1)}ms` });

  const transferList = [];
  for (const chunk of chunks) {
    if (chunk.vertices) transferList.push(chunk.vertices.buffer);
    if (chunk.faces) transferList.push(chunk.faces.buffer);
    if (chunk.colors) transferList.push(chunk.colors.buffer);
    if (chunk.materials) transferList.push(chunk.materials.buffer);
    if (chunk.normals) transferList.push(chunk.normals.buffer);
  }

  self.postMessage({ type: 'CHUNK_UPDATE', chunks: chunks, computeTime: (t1 - t0) }, transferList);
}

