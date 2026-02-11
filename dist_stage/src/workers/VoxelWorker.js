// VoxelWorker.js - Dynamic Import Version
// This enables us to catch import errors (404, syntax, etc) which otherwise silent-fail the worker.

console.log("VoxelWorker: Script Loading... (Dynamic)");

let VoxelState = null;
let TestModule = null;
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
    console.log("VoxelWorker: Importing TestModule...");
    // Handle potentially different base paths? No, strictly relative to this file.
    const tm = await import('./TestModule.js');
    TestModule = tm.default;
    console.log("VoxelWorker: TestModule Loaded ->", TestModule);

    console.log("VoxelWorker: Importing VoxelState...");
    const vs = await import('../editing/VoxelState.js');
    VoxelState = vs.default;
    console.log("VoxelWorker: VoxelState Loaded");

    isReady = true;

    // If we queued any messages, process them here? 
    // For now, simpler to just start accepting.

  } catch (e) {
    console.error("VoxelWorker: CRITICAL IMPORT ERROR", e);
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
        editSphere(msg.center, msg.radius, msg.color, msg.isNegative, msg.returnMesh);
        break;
      case 'INFLATE':
        inflateSphere(msg.center, msg.radius, msg.strength, msg.returnMesh);
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
        console.warn('VoxelWorker: Unknown message', msg.type);
    }
  } catch (err) {
    console.error('VoxelWorker Error:', err);
  }
};

function init(res, size) {
  if (!VoxelState) {
    console.error("VoxelWorker: Cannot Init, VoxelState class missing.");
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

  self.postMessage({ type: 'LOG', data: `Voxel Init. Snapshot: ${snapshotCounter}` });

  postMesh();
}

function resample(res) {
  if (!voxelState) return;

  // Resample
  self.postMessage({ type: 'LOG', data: `VoxelWorker: Calling VoxelState.resample(${res})...` });
  voxelState.resample(res);
  self.postMessage({ type: 'LOG', data: `VoxelWorker: Resample returned. Resetting History...` });

  // Clear History (Complex to resample history, so just reset for now?)
  // Ideally we should try to resample history too, but memory usage explodes.
  // Let's reset history but keep current state.
  history.length = 0;
  snapshotCounter++; // New era

  const df = voxelState.getDistanceField();
  const copy = new Float32Array(df);
  history.push({ df: copy, id: snapshotCounter });
  historyPtr = 0;

  self.postMessage({ type: 'LOG', data: `Voxel Resampled to ${res}. History Reset. Reposting Mesh...` });

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
      console.error(`VoxelWorker: Undo/Redo Mismatch! Hist=${state.df.length} Curr=${voxelState.getDistanceField().length}`);
      // Try to recover? Resampling undo history is hard.
      // For now, just warn.
      return;
    }
    voxelState.setDistanceField(state.df);
    postMesh();
  }
}

function editSphere(center, radius, color, isNegative, returnMesh) {
  if (!voxelState) return;

  // Apply edit
  const changed = voxelState.editSphere(center, radius, color, isNegative);

  if (!changed) {
    // self.postMessage({ type: 'LOG', data: `EditSphere: No Change (Radius=${radius})` });
  } else {
    isDirty = true;
  }

  if (returnMesh) postMesh();
}

function inflateSphere(center, radius, strength, returnMesh) {
  if (!voxelState) return;
  if (voxelState.inflateSphere(center, radius, strength)) {
    isDirty = true;
  }
  if (returnMesh) postMesh();
}

function postMesh() {
  if (!voxelState) return;

  // Timing
  // const t0 = performance.now();
  const meshData = voxelState.computeMesh();
  // const t1 = performance.now();

  // Determine the ID of the current state
  let currentID = snapshotCounter;
  if (historyPtr >= 0 && historyPtr < history.length) {
    currentID = history[historyPtr].id;
  }

  const transferList = [meshData.vertices.buffer, meshData.colors.buffer, meshData.materials.buffer, meshData.faces.buffer];
  if (meshData.normals) {
    transferList.push(meshData.normals.buffer);
  }

  self.postMessage({
    type: 'MESH_UPDATE',
    data: meshData,
    id: currentID // Tag with ACTUAL ID of the state we just computed
    // computeTime: t1 - t0
  }, transferList);
}
