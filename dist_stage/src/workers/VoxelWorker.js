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
const MAX_HISTORY = 20; // Limit memory usage

// Async Init to catch import errors
(async function () {
  try {
    console.log("VoxelWorker: Importing TestModule...");
    // Handle potentially different base paths? No, strictly relative to this file.
    const tm = await import('./TestModule.js');
    TestModule = tm.default;
    console.log("VoxelWorker: TestModule Loaded ->", TestModule);

    console.log("VoxelWorker: Importing VoxelState...");
    const vs = await import('./VoxelState.js');
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
    console.warn(`VoxelWorker: Received message '${msg.type}' before imports ready. Retrying in 100ms...`);
    setTimeout(() => self.onmessage(e), 100);
    return;
  }

  try {
    switch (msg.type) {
      case 'INIT':
        init(msg.res, msg.size);
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
          history.push({ df: copy });
          historyPtr = 0;
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

  // Push Initial State (Empty)
  const df = voxelState.getDistanceField();
  const copy = new Float32Array(df);
  history.push({ df: copy });
  historyPtr = 0;

  postMesh();
}

function snapshot() {
  if (!voxelState) return;

  // 1. Truncate Future
  if (historyPtr < history.length - 1) {
    history.length = historyPtr + 1;
  }

  // 2. Clone Current (Last Safe) to create New Editable Tip
  const currentDF = voxelState.getDistanceField();
  const newDF = new Float32Array(currentDF); // Clone

  // 3. Push & Advance
  history.push({ df: newDF });
  historyPtr++;

  // 4. Swap VoxelState to use New Tip
  voxelState.setDistanceField(newDF);

  // 5. Limit Size
  if (history.length > MAX_HISTORY) {
    history.shift();
    historyPtr--;
  }
}

function undo() {
  if (historyPtr > 0) {
    historyPtr--;
    restoreState();
  }
}

function redo() {
  if (historyPtr < history.length - 1) {
    historyPtr++;
    restoreState();
  }
}

function restoreState() {
  if (!voxelState || historyPtr < 0) return;
  const state = history[historyPtr];
  if (state && state.df) {
    voxelState.setDistanceField(state.df);
    postMesh();
  }
}

function editSphere(center, radius, color, isNegative, returnMesh) {
  if (!voxelState) return;

  // Apply edit
  voxelState.editSphere(center, radius, color, isNegative);

  // Return mesh?
  if (returnMesh) postMesh();
}

function inflateSphere(center, radius, strength, returnMesh) {
  if (!voxelState) return;
  voxelState.inflateSphere(center, radius, strength);
  if (returnMesh) postMesh();
}

function postMesh() {
  if (!voxelState) return;

  // Timing
  // const t0 = performance.now();
  const meshData = voxelState.computeMesh();
  // const t1 = performance.now();

  self.postMessage({
    type: 'MESH_UPDATE',
    data: meshData,
    // computeTime: t1 - t0
  }, [meshData.vertices.buffer, meshData.colors.buffer, meshData.materials.buffer, meshData.faces.buffer]);
}
