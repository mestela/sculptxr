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

// Frame-by-frame animation: named distance-field snapshots, one per drawn frame.
// Keyed by an integer slot id assigned on the main thread. POC stores the full
// Float32Array distance field per slot (no compression). Colours are NOT stored
// here yet (matches undo history); the display mesh keeps per-frame colour.
const frameFields = {};

function frameStore(slot) {
  if (!voxelState) return;
  frameFields[slot] = new Float32Array(voxelState.getDistanceField());
}

function frameLoad(slot) {
  if (!voxelState) return;
  const f = frameFields[slot];
  if (!f) return;
  voxelState.setDistanceField(f);
  isDirty = false;
  postMesh();
}

function frameCopy(srcSlot, dstSlot) {
  const f = frameFields[srcSlot];
  frameFields[dstSlot] = f ? new Float32Array(f) : null;
}

function frameBlank(slot) {
  console.log('[VoxelWorker] FRAME_BLANK slot=' + slot + ' (frame handlers active)');
  if (!voxelState) return;
  const empty = new Float32Array(voxelState.getDistanceField().length).fill(10000.0);
  frameFields[slot] = empty;
  voxelState.setDistanceField(empty);
  isDirty = false;
  postMesh();
}

function frameDelete(slot) {
  delete frameFields[slot];
}

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

    // Load Manifold-3D WASM
    try {
      const manifoldModule = await import('manifold-3d');
      const manifoldInstance = await manifoldModule.default({
        locateFile: (path) => {
          if (path.endsWith('.wasm')) {
            const isDev = import.meta.env.DEV;
            if (!isDev) {
              // In production, assume worker is in assets/ and wasm is in root dist/
              return new URL('../manifold.wasm', import.meta.url).href;
            }
            return '/manifold.wasm'; // Works in dev (vite dev server)
          }
          return path;
        }
      });
      manifoldInstance.setup();
      globalThis.manifold = manifoldInstance;
      console.log("GeometryWorker: Manifold-3D Loaded Successfully!");
    } catch (manifoldErr) {
      console.warn("GeometryWorker: Manifold-3D Load Failed", manifoldErr);
    }

    // Load Rust WASM
    try {
      // Use robust fetch approach for Vite Web Workers
      const wasmUrl = new URL('./voxel_wasm.wasm', import.meta.url).href;
      const response = await fetch(wasmUrl, { cache: 'no-store' });
      const { instance } = await WebAssembly.instantiateStreaming(response, {
        env: {
          js_getrandom: function(ptr, len) {
            if (!globalThis.wasmModule) {
              console.error("js_getrandom called before wasmModule was set!");
              return;
            }
            const buf = new Uint8Array(globalThis.wasmModule.memory.buffer, ptr, len);
            crypto.getRandomValues(buf);
          }
        },
        __wbindgen_placeholder__: new Proxy({}, {
          get: function(target, prop) {
            console.warn(`[GeometryWorker] Stub called for __wbindgen_placeholder__.${prop}`);
            return function() {
              console.warn(`[GeometryWorker] Stub executed for __wbindgen_placeholder__.${prop}`);
              return 0;
            };
          }
        }),
        __wbindgen_externref_xform__: new Proxy({}, {
          get: function(target, prop) {
            console.warn(`[GeometryWorker] Stub called for __wbindgen_externref_xform__.${prop}`);
            return function() {
              console.warn(`[GeometryWorker] Stub executed for __wbindgen_externref_xform__.${prop}`);
              return 0;
            };
          }
        })
      });
      globalThis.wasmModule = instance.exports;
      wasmModule = instance.exports;
      console.log("GeometryWorker: Rust WASM Loaded Successfully!");
    } catch (wasmErr) {
      console.warn("GeometryWorker: Rust WASM Load Failed -> using JS SurfaceNets fallback", wasmErr);
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
        postMesh(msg.forCommit);
        break;
      case 'FRAME_STORE':
        frameStore(msg.slot);
        break;
      case 'FRAME_LOAD':
        frameLoad(msg.slot);
        break;
      case 'FRAME_COPY':
        frameCopy(msg.srcSlot, msg.dstSlot);
        break;
      case 'FRAME_BLANK':
        frameBlank(msg.slot);
        break;
      case 'FRAME_DELETE':
        frameDelete(msg.slot);
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
      case 'SIMPLIFY_MESH':
        simplifyMesh(msg);
        break;
      case 'REMESH_ISOTROPIC':
        remeshIsotropic(msg);
        break;
      case 'SLICE_AND_CAP':
        sliceAndCap(msg);
        break;
      case 'TRIANGULATE_ONLY':
        triangulateOnly(msg);
        break;
      case 'QUADRANGULATE_ONLY':
        quadrangulateOnly(msg);
        break;
      case 'BOOLEAN_OPERATION':
        booleanOperation(msg);
        break;
      case 'SYMMETRY_MIRROR':
        symmetryMirror(msg);
        break;
      case 'VALIDATE_MANIFOLD':
        validateManifold(msg);
        break;
      default:
        // console.warn('VoxelWorker: Unknown message', msg.type);
    }
  } catch (err) {
    console.error('VoxelWorker Error:', err);
    self.postMessage({ type: 'WORKER_ERROR', error: err.message || err.toString() });
  }
};

function meshToVoxel(msg) {
  if (msg.res && msg.size && msg.center) {
    // console.log(`[GeometryWorker] meshToVoxel: Re-initializing VoxelState with Res=${msg.res}, Size=${msg.size.toFixed(2)}`);
    voxelState = new VoxelState(msg.res, msg.size); // Dynamic re-init!
  }

  if (!voxelState) return;
  
  if (voxelState.addMeshSDF(msg.v, msg.c, msg.m, msg.f)) {
    isDirty = true;
  } else {
    // console.warn(`[GeometryWorker] addMeshSDF FAILED or NO CHANGE!`);
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

function postMesh(forCommit) {
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
    forCommit: !!forCommit,
    computeTime: (t1 - t0),
    isWASM: res.isWASM
  }, transfer);
}

function triangulateQuads(faces) {
  let triCount = 0;
  for (let i = 0; i < faces.length; i += 4) {
    triCount++;
    if (faces[i + 3] !== 4294967295) triCount++;
  }
  
  const triFaces = new Uint32Array(triCount * 3);
  let triIdx = 0;
  for (let i = 0; i < faces.length; i += 4) {
    triFaces[triIdx++] = faces[i];
    triFaces[triIdx++] = faces[i + 1];
    triFaces[triIdx++] = faces[i + 2];
    
    if (faces[i + 3] !== 4294967295) {
      triFaces[triIdx++] = faces[i];
      triFaces[triIdx++] = faces[i + 2];
      triFaces[triIdx++] = faces[i + 3];
    }
  }
  return triFaces;
}

function filterCollinearTriangles(vertices, faces) {
  const out = [];
  let count = 0;
  for (let i = 0; i < faces.length; i += 3) {
    const i0 = faces[i] * 3;
    const i1 = faces[i+1] * 3;
    const i2 = faces[i+2] * 3;

    const ax = vertices[i1] - vertices[i0];
    const ay = vertices[i1+1] - vertices[i0+1];
    const az = vertices[i1+2] - vertices[i0+2];

    const bx = vertices[i2] - vertices[i0];
    const by = vertices[i2+1] - vertices[i0+1];
    const bz = vertices[i2+2] - vertices[i0+2];

    // Cross product
    const nx = ay * bz - az * by;
    const ny = az * bx - ax * bz;
    const nz = ax * by - ay * bx;
    const lenSq = nx*nx + ny*ny + nz*nz;

    if (lenSq > 1e-24) {
      out.push(faces[i], faces[i+1], faces[i+2]);
    } else {
      count++;
    }
  }
  if (count > 0) {
    console.log(`[GeometryWorker] filterCollinearTriangles: dropped ${count} collinear faces.`);
  }
  return out;
}

function filterDegenerateTriangles(vertices, faces) {
  const cleanFaces = [];
  const seen = new Set();

  for (let i = 0; i < faces.length; i += 3) {
    const a = faces[i];
    const b = faces[i + 1];
    const c = faces[i + 2];
    
    if (a === b || b === c || c === a) continue;

    // Check Duplicate Triangle
    const sorted = [a, b, c].sort((x, y) => x - y);
    const key = `${sorted[0]},${sorted[1]},${sorted[2]}`;
    if (seen.has(key)) {
      continue; // Duplicate triangle
    }
    seen.add(key);

    const ax = vertices[a * 3], ay = vertices[a * 3 + 1], az = vertices[a * 3 + 2];
    const bx = vertices[b * 3], by = vertices[b * 3 + 1], bz = vertices[b * 3 + 2];
    const cx = vertices[c * 3], cy = vertices[c * 3 + 1], cz = vertices[c * 3 + 2];

    const v1x = bx - ax, v1y = by - ay, v1z = bz - az;
    const v2x = cx - ax, v2y = cy - ay, v2z = cz - az;

    const cpx = v1y * v2z - v1z * v2y;
    const cpy = v1z * v2x - v1x * v2z;
    const cpz = v1x * v2y - v1y * v2x;

    const areaSq = cpx * cpx + cpy * cpy + cpz * cpz;
    if (areaSq < 1e-24) { // Soften epsilon to prevent dropping valid tiny triangles
      continue; 
    }

    cleanFaces.push(a, b, c);
  }
  return new Uint32Array(cleanFaces);
}

function weldVertices(vertices, faces) {
  const uniqueVerts = [];
  const vertexMap = new Map(); // "x,y,z" -> newIndex
  const newFaces = new Uint32Array(faces.length);
  const newToOldMap = []; // New index -> First seen old index

  let nextIndex = 0;
  for (let i = 0; i < faces.length; i++) {
    const oldIdx = faces[i];
    if (oldIdx * 3 >= vertices.length) {
      continue;
    }
    const x = vertices[oldIdx * 3];
    const y = vertices[oldIdx * 3 + 1];
    const z = vertices[oldIdx * 3 + 2];

    const bucketScale = 50.0; // 0.02 units tolerance
    const bx = Math.round(x * bucketScale);
    const by = Math.round(y * bucketScale);
    const bz = Math.round(z * bucketScale);
    const key = `${bx}_${by}_${bz}`;

    if (!vertexMap.has(key)) {
      vertexMap.set(key, nextIndex);
      uniqueVerts.push(x, y, z);
      newToOldMap.push(oldIdx); // Save the original index!
      nextIndex++;
    }

    newFaces[i] = vertexMap.get(key);
  }

  return {
    vertices: new Float32Array(uniqueVerts),
    faces: newFaces,
    newToOldMap: newToOldMap
  };
}

function sliceAndCap(msg) {
  if (!globalThis.manifold) {
    console.error("sliceAndCap: Manifold not loaded");
    return;
  }

  const manifold = globalThis.manifold;
  const vertices = msg.v;
  const faces = msg.f;
  const isQuad = msg.isQuad;

  console.log(`VoxelWorker sliceAndCap: isQuad=${isQuad}, vLen=${vertices.length}, fLen=${faces.length}`);

  let triFaces = faces;
  if (isQuad) {
    triFaces = triangulateQuads(faces);
    console.log(`Triangulated Quads: fLen=${triFaces.length}`);
  } else {
    triFaces = filterDegenerateTriangles(vertices, faces);
  }

  const welded = weldVertices(vertices, triFaces);
  console.log(`Welded Vertices: vLen=${welded.vertices.length}, fLen=${welded.faces.length}`);
  
  const cleanFaces = filterDegenerateTriangles(welded.vertices, welded.faces);
  console.log(`Cleaned Faces: fLen=${cleanFaces.length}`);

  // Winding Check: Count directed edges
  const edgeCount = new Map();
  let duplicateDirectedEdges = 0;
  for (let i = 0; i < cleanFaces.length; i += 3) {
    const a = cleanFaces[i];
    const b = cleanFaces[i + 1];
    const c = cleanFaces[i + 2];
    
    const edges = [[a, b], [b, c], [c, a]];
    for (const [u, v] of edges) {
      const key = `${u}_${v}`;
      const count = (edgeCount.get(key) || 0) + 1;
      edgeCount.set(key, count);
      if (count > 1) {
        duplicateDirectedEdges++;
      }
    }
  }
  console.log(`Inconsistent Winding (Shared directed edges): ${duplicateDirectedEdges}`);

  // Watertight Check: Measure undirected edges
  const undirectedCount = new Map();
  for (let i = 0; i < cleanFaces.length; i += 3) {
    const a = cleanFaces[i];
    const b = cleanFaces[i + 1];
    const c = cleanFaces[i + 2];
    
    const edges = [[a, b], [b, c], [c, a]];
    for (const [u, v] of edges) {
      const min = Math.min(u, v);
      const max = Math.max(u, v);
      const key = `${min}_${max}`;
      undirectedCount.set(key, (undirectedCount.get(key) || 0) + 1);
    }
  }

  let boundaryEdges = 0;
  let oversharedEdges = 0;
  for (const [key, count] of undirectedCount.entries()) {
    if (count === 1) boundaryEdges++;
    if (count > 2) oversharedEdges++;
  }
  console.log(`Watertight Check: Open Boundaries (Holes)=${boundaryEdges}, Overshared Edges (Branching)=${oversharedEdges}`);

  console.log(`Manifold Module Keys: ${Object.keys(manifold).join(", ")}`);
  console.log(`Type of manifold.Mesh: ${typeof manifold.Mesh}`);
  if (manifold.Mesh) {
    try {
      const dummy = new manifold.Mesh({
        numVert: 0,
        numTri: 0,
        vertPos: new Float32Array(0),
        triVerts: new Uint32Array(0)
      });
      console.log(`Keys of manifold.Mesh instance: ${Object.keys(dummy).join(", ")}`);
    } catch (e) {
      console.log(`Failed to create dummy Mesh instance: ${e.message}`);
    }
  }

  try {
    // Create Mesh
    const mesh = new manifold.Mesh({
      numProp: 3, // XYZ
      vertProperties: welded.vertices,
      triVerts: cleanFaces
    });

    // Create Manifold
    const m = new manifold.Manifold(mesh);
    console.log(`Manifold Instance Prototypes: ${Object.keys(Object.getPrototypeOf(m)).join(", ")}`);
    console.log(`Manifold Class Statics: ${Object.keys(manifold.Manifold).join(", ")}`);
    
    // Create giant cube for slicing
    const size = 10000;
    let cube = manifold.Manifold.cube([size, size, size], false); // Use static method, false=origin corner
    
    const side = msg.side || 1; // 1 for +X, -1 for -X
    if (side === 1) {
      cube = cube.translate([0, -size / 2, -size / 2]);
    } else {
      cube = cube.translate([-size, -size / 2, -size / 2]);
    }

    // Subtract
    const resultManifold = m.subtract(cube);

    // Get Mesh back
    const resultMesh = resultManifold.getMesh();

    console.log(`Resulting Mesh: vLen=${resultMesh.vertProperties.length}, fLen=${resultMesh.triVerts.length}`);

    // Send back to main thread
    self.postMessage({
      type: 'SLICE_AND_CAP_RESULT',
      v: resultMesh.vertProperties, // XYZ
      f: resultMesh.triVerts
    }, [resultMesh.vertProperties.buffer, resultMesh.triVerts.buffer]);

  } catch (err) {
    console.error("sliceAndCap Error:", err);
  }
}

function booleanOperation(msg) {
  try {
    const manifold = globalThis.manifold;
    if (!manifold) {
      console.error("booleanOperation: manifold not loaded");
      return;
    }

    console.log(`[GeometryWorker] booleanOperation started! Op=${msg.op}, Num meshes=${msg.meshes.length}`);

    let combinedManifold = null;

    for (let i = 0; i < msg.meshes.length; i++) {
        const meshData = msg.meshes[i];
        let triFaces = meshData.f;
        
        // Stride 4 to Stride 3 (unpadding)
        if (triFaces.length % 4 === 0) {
            if (triFaces[3] === 4294967295 || triFaces[3] === 0xFFFFFFFF) {
                triFaces = unpadTriangles(triFaces);
            } else if (!meshData.isTriangles) {
                triFaces = triangulateQuads(triFaces);
            }
        }

        const welded = weldVertices(meshData.v, triFaces);
        let cleanFaces = filterDegenerateTriangles(welded.vertices, welded.faces);
        cleanFaces = filterCollinearTriangles(welded.vertices, cleanFaces);

        const triVertsTyped = new Uint32Array(cleanFaces);
        const mMesh = new manifold.Mesh({
            numProp: 3,
            vertProperties: welded.vertices,
            triVerts: triVertsTyped
        });

        const currentManifold = new manifold.Manifold(mMesh);

        if (!combinedManifold) {
            combinedManifold = currentManifold;
        } else {
            if (msg.op === 'subtract') {
                console.log(`[GeometryWorker] Subtracting mesh ${i+1}/${msg.meshes.length}...`);
                combinedManifold = combinedManifold.subtract(currentManifold);
            } else if (msg.op === 'intersect') {
                console.log(`[GeometryWorker] Intersecting mesh ${i+1}/${msg.meshes.length}...`);
                combinedManifold = combinedManifold.intersect(currentManifold);
            } else {
                console.log(`[GeometryWorker] Unioning mesh ${i+1}/${msg.meshes.length}...`);
                combinedManifold = combinedManifold.add(currentManifold);
            }
        }
    }

    if (!combinedManifold) {
        console.error("booleanOperation: no valid meshes to operate on");
        return;
    }

    const resultMesh = combinedManifold.getMesh();
    const weldedAfter = weldVertices(resultMesh.vertProperties, resultMesh.triVerts);

    let paddedFaces;
    let topologyStats;
    if (msg.quadrangulate !== false) {
        console.log(`[GeometryWorker] Quadrangulating Boolean result...`);
        const result = quadrangulateGreedy(weldedAfter.vertices, weldedAfter.faces, false, 0);
        paddedFaces = result.paddedFaces;
        topologyStats = result.stats;
    } else {
        paddedFaces = padTrianglesToQuads(weldedAfter.faces);
    }

    self.postMessage({
        type: 'BOOLEAN_UNION_RESULT',
        v: weldedAfter.vertices,
        f: paddedFaces,
        stats: topologyStats
    }, [weldedAfter.vertices.buffer, paddedFaces.buffer]);

  } catch (err) {
      console.error("booleanOperation Error:", err);
      self.postMessage({ type: 'BOOLEAN_UNION_ERROR', error: err.message });
  }
}

function symmetryMirror(msg) {
  try {
    const manifold = globalThis.manifold;
    if (!manifold) {
      console.error("symmetryMirror: manifold not loaded");
      return;
    }

    console.log(`[GeometryWorker] symmetryMirror started! isTriangles=${msg.isTriangles}`);

    const vertices = msg.v;
    const faces = msg.f;
    const isTriangles = msg.isTriangles;

    let triFaces = faces;
    if (!isTriangles) {
      console.log(`[GeometryWorker] triangulateQuads starting... for ${faces.length} faces`);
      triFaces = triangulateQuads(faces);
      console.log(`[GeometryWorker] triangulateQuads done!`);
    } else {
      if (faces.length % 4 === 0) {
        if (faces[3] === 4294967295 || faces[3] === 0xFFFFFFFF) {
          console.log(`[GeometryWorker] unpadTriangles starting... for 4-padded array of length ${faces.length}`);
          triFaces = unpadTriangles(faces);
        } else {
          console.log(`[GeometryWorker] quad mesh detected in triangles path! Triangulating before validation...`);
          triFaces = triangulateQuads(faces); // Triangulate quads properly!
        }
      } else {
        console.log(`[GeometryWorker] faces already unpadded or not 4-padded (length=${faces.length}). Using as-is.`);
        triFaces = faces;
      }
    }

    const normal = msg.nPlane; 
    const pt = msg.ptPlane;

    // 1. Clean up unscaled quad face indices + weld duplicate vertices (watertight)
    console.log(`[GeometryWorker] weldVertices starting... for ${triFaces.length} faces`);
    const welded = weldVertices(vertices, triFaces);
    console.log(`[GeometryWorker] weldVertices done! unique vertices=${welded.vertices.length}, faces=${welded.faces.length}`);

    let cleanFaces = filterDegenerateTriangles(welded.vertices, welded.faces);
    console.log(`[GeometryWorker] filterDegenerateTriangles done! faces length=${cleanFaces.length}`);

    // 3. Filter collinear triangles (zero area via cross product)
    console.log(`[GeometryWorker] filterCollinearTriangles starting...`);
    cleanFaces = filterCollinearTriangles(welded.vertices, cleanFaces);
    console.log(`[GeometryWorker] filterCollinearTriangles done! faces length=${cleanFaces.length}`);

    // 4. Snap vertices to the symmetry plane before slicing!
    const snapEpsilon = 1e-3; 
    for (let i = 0; i < welded.vertices.length; i += 3) {
        const dx = welded.vertices[i] - pt[0];
        const dy = welded.vertices[i + 1] - pt[1];
        const dz = welded.vertices[i + 2] - pt[2];
        const dist = dx * normal[0] + dy * normal[1] + dz * normal[2];
        
        if (Math.abs(dist) < snapEpsilon) {
            welded.vertices[i] -= dist * normal[0];
            welded.vertices[i + 1] -= dist * normal[1];
            welded.vertices[i + 2] -= dist * normal[2];
        }
    }

    // Watertight Check: Measure undirected edges
    const undirectedCount = new Map();
    for (let k = 0; k < cleanFaces.length; k += 3) {
      const a = cleanFaces[k];
      const b = cleanFaces[k + 1];
      const c = cleanFaces[k + 2];
      
      const edges = [[a, b], [b, c], [c, a]];
      for (const [u, v] of edges) {
        const min = Math.min(u, v);
        const max = Math.max(u, v);
        const key = `${min}_${max}`;
        undirectedCount.set(key, (undirectedCount.get(key) || 0) + 1);
      }
    }

    let boundaryEdges = 0;
    let oversharedEdges = 0;
    for (const [key, count] of undirectedCount.entries()) {
      if (count === 1) boundaryEdges++;
      if (count > 2) oversharedEdges++;
    }
    console.log(`[GeometryWorker] symmetryMirror Watertight Check: Open Boundaries (Holes)=${boundaryEdges}, Overshared Edges (Branching)=${oversharedEdges}`);

    if (boundaryEdges > 0 || oversharedEdges > 0) {
      const faultIndices = [];
      for (const [key, count] of undirectedCount.entries()) {
        if (count === 1 || count > 2) {
          const parts = key.split("_");
          const u = parseInt(parts[0]);
          const v = parseInt(parts[1]);
          const oldU = welded.newToOldMap[u];
          const oldV = welded.newToOldMap[v];
          faultIndices.push(oldU, oldV);
        }
      }
      self.postMessage({
        type: 'SYMMETRY_MIRROR_FAULTS',
        holesIndices: faultIndices
      });
      console.log(`[GeometryWorker] Proceeding despite faults, as requested.`);
    }

    const triVertsTyped = new Uint32Array(cleanFaces);

    const mMesh = new manifold.Mesh({
      numProp: 3, // XYZ
      vertProperties: welded.vertices, // Unscaled!
      triVerts: triVertsTyped
    });

    console.log(`[GeometryWorker] Creating Manifold constructor...`);
    const m = new manifold.Manifold(mMesh);
    
    const offset = pt[0]*normal[0] + pt[1]*normal[1] + pt[2]*normal[2];

    console.log(`[GeometryWorker] splitByPlane: normal=[${normal}], offset=${offset}`);
    const parts = m.splitByPlane(normal, offset);

    // splitByPlane returns an array of [pos, neg]!
    const source = msg.side === 1 ? parts[0] : parts[1];
    const moved = source.translate({ x: -pt[0], y: -pt[1], z: -pt[2] });
    const mirrored = moved.mirror({ x: normal[0], y: normal[1], z: normal[2] });
    const restored = mirrored.translate({ x: pt[0], y: pt[1], z: pt[2] });
    console.log(`[GeometryWorker] Mirroring done!`);
    
    console.log(`[GeometryWorker] Composing sides...`);
    let combined;
    try {
        if (typeof source.add === 'function') {
            combined = source.add(restored);
        } else {
            combined = manifold.Manifold.compose([source, restored]);
        }
    } catch (e) {
        console.error("Compose/Add failed, trying fallback compose", e);
        combined = manifold.Manifold.compose([source, restored]);
    }
    console.log(`[GeometryWorker] Union/Compose done!`);
    const resultMesh = combined.getMesh();

    // Weld vertices after Manifold union to remove duplicate seam vertices!
    const weldedAfter = weldVertices(resultMesh.vertProperties, resultMesh.triVerts);

    // 1. Run custom priority quadrangulation to merge coplanar triangles into quads if enabled.
    let paddedFaces;
    let topologyStats;
    if (msg.quadrangulate !== false) {
      console.log(`[GeometryWorker] Running custom Priority Quadrangulation...`);
      const symmetryX = pt ? pt[0] : 0; // Use symmetry plane center
      const result = quadrangulateGreedy(weldedAfter.vertices, weldedAfter.faces, true, symmetryX); // Reject seam merges
      paddedFaces = result.paddedFaces;
      topologyStats = result.stats;
    } else {
      console.log(`[GeometryWorker] Skipping Quadrangulation. Padding triangles to quad stride.`);
      paddedFaces = padTrianglesToQuads(weldedAfter.faces);
    }
 
     self.postMessage({
       type: 'SYMMETRY_MIRROR_RESULT',
       v: weldedAfter.vertices, // Use clean welded vertices
       f: paddedFaces,
       stats: topologyStats   
     }, [weldedAfter.vertices.buffer, paddedFaces.buffer]);
 
   } catch (err) {
     console.error("symmetryMirror Error:", err);
   }
}

function padTrianglesToQuads(faces) {
  const triCount = faces.length / 3;
  const padded = new Uint32Array(triCount * 4);
  for (let i = 0; i < triCount; i++) {
    padded[i * 4] = faces[i * 3];
    padded[i * 4 + 1] = faces[i * 3 + 1];
    padded[i * 4 + 2] = faces[i * 3 + 2];
    padded[i * 4 + 3] = 4294967295; // TRI_INDEX (-1)
  }
  return padded;
}

function unpadTriangles(faces) {
  const triCount = faces.length / 4;
  const triFaces = new Uint32Array(triCount * 3);
  let acc = 0;
  for (let i = 0; i < faces.length; i += 4) {
    triFaces[acc++] = faces[i];
    triFaces[acc++] = faces[i + 1];
    triFaces[acc++] = faces[i + 2];
  }
  return triFaces;
}

// Greedy Coplanar Triangle Merging (Quadrangulation)
// Blender's EXACT Error metric for quads (ported from bmo_join_triangles.cc)
function quadCalcError(v1, v2, v3, v4) {
  let error = 0.0;

  // 1. Normal difference
  const normalTri = (p1, p2, p3) => {
    const ax = p2[0] - p1[0], ay = p2[1] - p1[1], az = p2[2] - p1[2];
    const bx = p3[0] - p1[0], by = p3[1] - p1[1], bz = p3[2] - p1[2];
    const nx = ay * bz - az * by;
    const ny = az * bx - ax * bz;
    const nz = ax * by - ay * bx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len > 0) return [nx / len, ny / len, nz / len];
    return [0, 0, 1];
  };

  const angleNorm = (n1, n2) => {
    let dot = n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2];
    if (dot > 1.0) dot = 1.0;
    if (dot < -1.0) dot = -1.0;
    return Math.acos(dot);
  };

  const n1A = normalTri(v1, v2, v3);
  const n2A = normalTri(v1, v3, v4);
  const angleA = angleNorm(n1A, n2A);

  const n1B = normalTri(v2, v3, v4);
  const n2B = normalTri(v4, v1, v2);
  const angleB = angleNorm(n1B, n2B);

  error += (angleA + angleB) / (Math.PI * 2);

  // 2. Co-linearity (Angle distortion)
  const edgeVecs = [
    [v2[0] - v1[0], v2[1] - v1[1], v2[2] - v1[2]],
    [v3[0] - v2[0], v3[1] - v2[1], v3[2] - v2[2]],
    [v4[0] - v3[0], v4[1] - v3[1], v4[2] - v3[2]],
    [v1[0] - v4[0], v1[1] - v4[1], v1[2] - v4[2]]
  ];

  for (let i = 0; i < 4; i++) {
    const len = Math.sqrt(edgeVecs[i][0] * edgeVecs[i][0] + edgeVecs[i][1] * edgeVecs[i][1] + edgeVecs[i][2] * edgeVecs[i][2]);
    if (len > 0) { edgeVecs[i][0] /= len; edgeVecs[i][1] /= len; edgeVecs[i][2] /= len; }
  }

  const pi_2 = Math.PI / 2;
  const dev1 = Math.abs(angleNorm(edgeVecs[0], edgeVecs[1]) - pi_2);
  const dev2 = Math.abs(angleNorm(edgeVecs[1], edgeVecs[2]) - pi_2);
  const dev3 = Math.abs(angleNorm(edgeVecs[2], edgeVecs[3]) - pi_2);
  const dev4 = Math.abs(angleNorm(edgeVecs[3], edgeVecs[0]) - pi_2);

  error += (dev1 + dev2 + dev3 + dev4) / (Math.PI * 2);

  // 3. Concavity (Area difference)
  const areaTri = (p1, p2, p3) => {
    const ax = p2[0] - p1[0], ay = p2[1] - p1[1], az = p2[2] - p1[2];
    const bx = p3[0] - p1[0], by = p3[1] - p1[1], bz = p3[2] - p1[2];
    const nx = ay * bz - az * by;
    const ny = az * bx - ax * bz;
    const nz = ax * by - ay * bx;
    return 0.5 * Math.sqrt(nx * nx + ny * ny + nz * nz);
  };

  const areaTriA = areaTri(v1, v2, v3) + areaTri(v1, v3, v4);
  const areaTriB = areaTri(v2, v3, v4) + areaTri(v4, v1, v2);

  const minArea = Math.min(areaTriA, areaTriB);
  const maxArea = Math.max(areaTriA, areaTriB);

  error += maxArea > 0 ? (1.0 - minArea / maxArea) : 1.0;

  return error;
}

// Coplanar Triangle Merging (Quadrangulation)
function quadrangulateGreedy(vertices, triIndices, rejectSeams = false, symmetryX = 0, isQuadTri = null, originalQuads = []) {
  if (!triIndices || triIndices.length === 0) return new Uint32Array(0);

  const numTris = triIndices.length / 3;
  const edgeMap = new Map(); // key -> { tris: [triIdx], v0, v1 }

  const stats = {
    tris: numTris,
    edges: 0,
    boundary: 0,
    manifold: 0,
    nonManifold: 0,
    rejectedDot: 0,
    candidates: 0,
    merged: 0,
    leftoverTris: 0
  };

  // Build Edge Map
  for (let i = 0; i < numTris; i++) {
    const v0 = triIndices[i * 3];
    const v1 = triIndices[i * 3 + 1];
    const v2 = triIndices[i * 3 + 2];

    const edges = [
      [v0, v1],
      [v1, v2],
      [v2, v0]
    ];

    for (const [a, b] of edges) {
      const minV = Math.min(a, b);
      const maxV = Math.max(a, b);
      const key = `${minV}_${maxV}`;

      let edgeData = edgeMap.get(key);
      if (!edgeData) {
        edgeData = { tris: [], v0: minV, v1: maxV };
        edgeMap.set(key, edgeData);
      }
      edgeData.tris.push(i);
    }
  }

  // Pre-calculate triangle normals
  const normals = new Float32Array(numTris * 3);
  for (let i = 0; i < numTris; i++) {
    const v0 = triIndices[i * 3] * 3;
    const v1 = triIndices[i * 3 + 1] * 3;
    const v2 = triIndices[i * 3 + 2] * 3;

    const ax = vertices[v1] - vertices[v0];
    const ay = vertices[v1 + 1] - vertices[v0 + 1];
    const az = vertices[v1 + 2] - vertices[v0 + 2];

    const bx = vertices[v2] - vertices[v0];
    const by = vertices[v2 + 1] - vertices[v0 + 1];
    const bz = vertices[v2 + 2] - vertices[v0 + 2];

    let nx = ay * bz - az * by;
    let ny = az * bx - ax * bz;
    let nz = ax * by - ay * bx;

    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len > 0.0001) {
      nx /= len;
      ny /= len;
      nz /= len;
    } else {
      if (numTris < 20) {
        console.log(`[Quadrangulate] Zero normal for tri ${i}!`);
        console.log(`[Quadrangulate]   v0 idx: ${triIndices[i * 3]} coords: [${vertices[v0]}, ${vertices[v0 + 1]}, ${vertices[v0 + 2]}]`);
        console.log(`[Quadrangulate]   v1 idx: ${triIndices[i * 3 + 1]} coords: [${vertices[v1]}, ${vertices[v1 + 1]}, ${vertices[v1 + 2]}]`);
        console.log(`[Quadrangulate]   v2 idx: ${triIndices[i * 3 + 2]} coords: [${vertices[v2]}, ${vertices[v2 + 1]}, ${vertices[v2 + 2]}]`);
      }
    }

    normals[i * 3] = nx;
    normals[i * 3 + 1] = ny;
    normals[i * 3 + 2] = nz;
  }

  const merged = new Uint8Array(numTris);
  const outQuads = [...originalQuads];
  const outTris = [];

  // Candidate collection
  const candidates = [];

  if (numTris < 20) console.log(`[Quadrangulate] Total triangles: ${numTris}, Edges in map: ${edgeMap.size}`);

  for (const [key, edgeData] of edgeMap.entries()) {
    if (numTris < 20) console.log(`[Quadrangulate] Checking edge ${key}, tris: [${edgeData.tris.join(',')}]`);
    if (edgeData.tris.length !== 2) continue;

    const triA = edgeData.tris[0];
    const triB = edgeData.tris[1];

    if (merged[triA] || merged[triB]) {
      if (numTris < 20) console.log(`[Quadrangulate]   Skipping: One or both triangles already merged.`);
      continue;
    }
    if (isQuadTri && (isQuadTri[triA] || isQuadTri[triB])) {
      continue;
    }

    const dot = normals[triA * 3] * normals[triB * 3] +
                normals[triA * 3 + 1] * normals[triB * 3 + 1] +
                normals[triA * 3 + 2] * normals[triB * 3 + 2];

    const v1x = vertices[edgeData.v0 * 3];
    const v2x = vertices[edgeData.v1 * 3];
    const isOnSeam = (Math.abs(v1x - symmetryX) < 0.05 && Math.abs(v2x - symmetryX) < 0.05) ||
                     (Math.abs(v1x) < 0.02 && Math.abs(v2x) < 0.02);

    if (rejectSeams && isOnSeam) {
      if (numTris < 20) console.log(`[Quadrangulate]   Skipping: Edge is on seam.`);
      continue;
    }

    if (!isOnSeam && Math.abs(dot) < 0.2) {
      if (numTris < 20) {
        console.log(`[Quadrangulate]   Skipping: Low dot product ${dot}`);
        console.log(`[Quadrangulate]     TriA=${triA} normal: [${normals[triA * 3]}, ${normals[triA * 3 + 1]}, ${normals[triA * 3 + 2]}]`);
        console.log(`[Quadrangulate]     TriB=${triB} normal: [${normals[triB * 3]}, ${normals[triB * 3 + 1]}, ${normals[triB * 3 + 2]}]`);
      }
      stats.rejectedDot++;
      continue; 
    }

    const av0 = triIndices[triA * 3];
    const av1 = triIndices[triA * 3 + 1];
    const av2 = triIndices[triA * 3 + 2];

    const bv0 = triIndices[triB * 3];
    const bv1 = triIndices[triB * 3 + 1];
    const bv2 = triIndices[triB * 3 + 2];

    let unsharedA = -1;
    if (av0 !== edgeData.v0 && av0 !== edgeData.v1) unsharedA = av0;
    if (av1 !== edgeData.v0 && av1 !== edgeData.v1) unsharedA = av1;
    if (av2 !== edgeData.v0 && av2 !== edgeData.v1) unsharedA = av2;

    let unsharedB = -1;
    if (bv0 !== edgeData.v0 && bv0 !== edgeData.v1) unsharedB = bv0;
    if (bv1 !== edgeData.v0 && bv1 !== edgeData.v1) unsharedB = bv1;
    if (bv2 !== edgeData.v0 && bv2 !== edgeData.v1) unsharedB = bv2;

    if (unsharedA === -1 || unsharedB === -1) continue;

    // 2D Projection & Angle Sort
    const pts = [unsharedA, edgeData.v0, unsharedB, edgeData.v1].map(idx => ({
      idx,
      x: vertices[idx * 3],
      y: vertices[idx * 3 + 1],
      z: vertices[idx * 3 + 2]
    }));

    const cx = (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4;
    const cy = (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4;
    const cz = (pts[0].z + pts[1].z + pts[2].z + pts[3].z) / 4;

    const nx = (normals[triA * 3] + normals[triB * 3]) / 2;
    const ny = (normals[triA * 3 + 1] + normals[triB * 3 + 1]) / 2;
    const nz = (normals[triA * 3 + 2] + normals[triB * 3 + 2]) / 2;

    const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz);
    const snx = nx / nLen;
    const sny = ny / nLen;
    const snz = nz / nLen;

    let tx = 1, ty = 0, tz = 0;
    if (Math.abs(snx) > 0.9) { tx = 0; ty = 1; }
    let ux = ty * snz - tz * sny;
    let uy = tz * snx - tx * snz;
    let uz = tx * sny - ty * snx;
    const uLen = Math.sqrt(ux * ux + uy * uy + uz * uz);
    ux /= uLen; uy /= uLen; uz /= uLen;

    let vx = sny * uz - snz * uy;
    let vy = snz * ux - snx * uz;
    let vz = snx * uy - sny * ux;
    const vLen = Math.sqrt(vx * vx + vy * vy + vz * vz);
    vx /= vLen; vy /= vLen; vz /= vLen;

    const angles = pts.map(p => {
      const dx = p.x - cx;
      const dy = p.y - cy;
      const dz = p.z - cz;
      const x = dx * ux + dy * uy + dz * uz;
      const y = dx * vx + dy * vy + dz * vz;
      return { idx: p.idx, x, y, theta: Math.atan2(y, x) };
    });

    angles.sort((a, b) => a.theta - b.theta);

    // Convexity and Squareness check
    let isConvex = true;
    let squarenessError = 0;

    for (let i = 0; i < 4; i++) {
      const p0 = angles[i];
      const p1 = angles[(i + 1) % 4];
      const p2 = angles[(i + 2) % 4];

      const dx1 = p1.x - p0.x;
      const dy1 = p1.y - p0.y;
      const dx2 = p2.x - p1.x;
      const dy2 = p2.y - p1.y;

      const cross = dx1 * dy2 - dy1 * dx2;
      if (cross < 0) {
        isConvex = false; // Sign flipped (concave quad)
        break;
      }

      const l1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
      const l2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);

      if (l1 > 1e-6 && l2 > 1e-6) {
        const dotProduct = (dx1 * dx2 + dy1 * dy2) / (l1 * l2);
        squarenessError += Math.abs(dotProduct);
      }
    }

    // Combine Blender's exact error metric + soft concavity penalty
    const p1 = [vertices[angles[0].idx * 3], vertices[angles[0].idx * 3 + 1], vertices[angles[0].idx * 3 + 2]];
    const p2 = [vertices[angles[1].idx * 3], vertices[angles[1].idx * 3 + 1], vertices[angles[1].idx * 3 + 2]];
    const p3 = [vertices[angles[2].idx * 3], vertices[angles[2].idx * 3 + 1], vertices[angles[2].idx * 3 + 2]];
    const p4 = [vertices[angles[3].idx * 3], vertices[angles[3].idx * 3 + 1], vertices[angles[3].idx * 3 + 2]];

    let error = quadCalcError(p1, p2, p3, p4);
    if (numTris < 20) {
      console.log(`[Quadrangulate] Candidate: TriA=${triA}, TriB=${triB}, Error=${error}`);
      console.log(`[Quadrangulate]   Angles: ${angles.map(a => a.idx).join(',')}`);
    }

    candidates.push({
      triA,
      triB,
      error,
      quad: [angles[0].idx, angles[1].idx, angles[2].idx, angles[3].idx]
    });
    stats.candidates++;
  }

  // Sort candidates by error (minimize error), rounding to 4 decimals to ignore float noise!
  candidates.sort((a, b) => {
    const errA = Math.round(a.error * 10000) / 10000;
    const errB = Math.round(b.error * 10000) / 10000;
    
    if (errA !== errB) {
      return errA - errB;
    }
    
    // Tie-breaker: Prefer lower face IDs to keep it consistent
    return Math.min(a.triA, a.triB) - Math.min(b.triA, b.triB);
  });

  // Merge candidates (Best first)
  if (numTris < 20) console.log(`[Quadrangulate] Total candidates after sorting: ${candidates.length}`);
  for (const cand of candidates) {
    if (merged[cand.triA] || merged[cand.triB]) {
      if (numTris < 20) console.log(`[Quadrangulate] Skipping candidate ${cand.triA}-${cand.triB} (already merged)`);
      continue;
    }
    if (numTris < 20) console.log(`[Quadrangulate] Merging ${cand.triA} and ${cand.triB} with error ${cand.error}`);
    outQuads.push(cand.quad);
    merged[cand.triA] = 1;
    merged[cand.triB] = 1;
    stats.merged++;
  }

  // Set rest of Triangles
  for (let i = 0; i < numTris; i++) {
    if (!merged[i] && (!isQuadTri || !isQuadTri[i])) {
      outTris.push([triIndices[i * 3], triIndices[i * 3 + 1], triIndices[i * 3 + 2]]);
      stats.leftoverTris++;
    }
  }

  const finalFaces = new Uint32Array((outQuads.length + outTris.length) * 4);
  let outPtr = 0;
  for (const quad of outQuads) {
    finalFaces[outPtr++] = quad[0];
    finalFaces[outPtr++] = quad[1];
    finalFaces[outPtr++] = quad[2];
    finalFaces[outPtr++] = quad[3];
  }
  for (const tri of outTris) {
    finalFaces[outPtr++] = tri[0];
    finalFaces[outPtr++] = tri[1];
    finalFaces[outPtr++] = tri[2];
    finalFaces[outPtr++] = -1;
  }

  return { paddedFaces: finalFaces, stats };
}

function triangulateOnly(msg) {
  // First get raw 3-strided triangles
  const rawTris = triangulateQuads(msg.f);
  
  // Calculate how many triangles we have
  const nbTris = rawTris.length / 3;
  
  // Create 4-stride array with -1 padding
  const padded = new Uint32Array(nbTris * 4);
  let pIdx = 0;
  for (let i = 0; i < rawTris.length; i += 3) {
    padded[pIdx++] = rawTris[i];
    padded[pIdx++] = rawTris[i+1];
    padded[pIdx++] = rawTris[i+2];
    padded[pIdx++] = 4294967295; // -1
  }

  self.postMessage({
    type: 'TRIANGULATE_RESULT',
    v: msg.v,
    f: padded
  }, [msg.v.buffer, padded.buffer]);
}

function quadrangulateOnly(msg) {
  const faces = msg.f;
  const vertices = msg.v;
  
  if (msg.skipsQuads) {
    // Advanced mode: ONLY merge adjacent triangles, ignore quads, preserve colors and vertices!
    const edgeMap = new Map(); // key -> [faceIdx]
    
    // 1. Build edge map for TRIANGLES only!
    for (let i = 0; i < faces.length; i += 4) {
      if (faces[i + 3] === 4294967295) {
        const v0 = faces[i];
        const v1 = faces[i + 1];
        const v2 = faces[i + 2];
        
        const edges = [
          [v0, v1], [v1, v2], [v2, v0]
        ];
        
        for (const [a, b] of edges) {
          const minV = Math.min(a, b);
          const maxV = Math.max(a, b);
          const key = `${minV}_${maxV}`;
          
          let list = edgeMap.get(key);
          if (!list) {
            list = [];
            edgeMap.set(key, list);
          }
          list.push(i);
        }
      }
    }
    
    const merged = new Set();
    const newQuads = [];
    
    // 2. Find candidates!
    for (const [key, faceList] of edgeMap.entries()) {
      if (faceList.length === 2) {
        const fA = faceList[0];
        const fB = faceList[1];
        
        if (merged.has(fA) || merged.has(fB)) continue;
        
        const av0 = faces[fA];
        const av1 = faces[fA + 1];
        const av2 = faces[fA + 2];
        
        const bv0 = faces[fB];
        const bv1 = faces[fB + 1];
        const bv2 = faces[fB + 2];
        
        const [v0Str, v1Str] = key.split('_');
        const ev0 = parseInt(v0Str);
        const ev1 = parseInt(v1Str);
        
        let diaA = -1;
        if (av0 !== ev0 && av0 !== ev1) diaA = av0;
        else if (av1 !== ev0 && av1 !== ev1) diaA = av1;
        else diaA = av2;
        
        let diaB = -1;
        if (bv0 !== ev0 && bv0 !== ev1) diaB = bv0;
        else if (bv1 !== ev0 && bv1 !== ev1) diaB = bv1;
        else diaB = bv2;
        
        if (diaA === -1 || diaB === -1) continue;
        
        // Preserve Winding Order Exactly from Triangle A!
        let vStart, vEnd;
        if (diaA === av0) {
          vStart = av2;
          vEnd = av1;
        } else if (diaA === av1) {
          vStart = av0;
          vEnd = av2;
        } else {
          vStart = av1;
          vEnd = av0;
        }
        
        newQuads.push([vStart, diaA, vEnd, diaB]);
        merged.add(fA);
        merged.add(fB);
      }
    }
    
    // 3. Reconstruct faces!
    const finalFaces = [];
    for (let i = 0; i < faces.length; i += 4) {
      if (faces[i + 3] !== 4294967295) {
        finalFaces.push(faces[i], faces[i + 1], faces[i + 2], faces[i + 3]);
      } else {
        if (!merged.has(i)) {
          finalFaces.push(faces[i], faces[i + 1], faces[i + 2], -1);
        }
      }
    }
    
    for (const quad of newQuads) {
      finalFaces.push(quad[0], quad[1], quad[2], quad[3]);
    }
    
    const padded = new Uint32Array(finalFaces);
    
    const transfer = [vertices.buffer, padded.buffer, msg.c ? msg.c.buffer : null].filter(Boolean);
    const uniqueTransfer = [...new Set(transfer)];
    
    self.postMessage({
      type: 'QUADRANGULATE_RESULT',
      v: vertices,
      f: padded,
      c: msg.c, // Pass back original colors directly!
      stats: { tris: faces.length / 4, merged: newQuads.length }
    }, uniqueTransfer);
    
    return;
  }
  
  // Original behavior!
  const tris = triangulateQuads(msg.f);
  
  // Weld vertices to ensure clean connectivity for sorting
  const welded = weldVertices(msg.v, tris);
  
  // Run our perfect quadrangulation!
  const result = quadrangulateGreedy(welded.vertices, welded.faces, msg.rejectSeams, msg.symmetryX);
  
  // Handle colors if present!
  let newColors = null;
  if (msg.c) {
    newColors = new Float32Array(welded.vertices.length);
    for (let i = 0; i < welded.newToOldMap.length; i++) {
      const oldIdx = welded.newToOldMap[i];
      newColors[i * 3] = msg.c[oldIdx * 3];
      newColors[i * 3 + 1] = msg.c[oldIdx * 3 + 1];
      newColors[i * 3 + 2] = msg.c[oldIdx * 3 + 2];
    }
  }

  self.postMessage({
    type: 'QUADRANGULATE_RESULT',
    v: welded.vertices,
    f: result.paddedFaces,
    c: newColors,
    stats: result.stats
  }, [welded.vertices.buffer, result.paddedFaces.buffer, newColors ? newColors.buffer : null].filter(Boolean));
}

function remeshQuads(msg) {
  if (!globalThis.wasmModule) {
    console.error("remeshQuads: wasmModule not loaded");
    return;
  }

  const wasm = globalThis.wasmModule;
  const vertices = msg.v;
  
  // remesh_quads_wasm expects 4-padded faces always (even for triangles)
  const finalFaces = msg.f;
  const stride = 4;

  const targetFaces = msg.targetFaces;

  const vLen = vertices.length;
  const fLen = finalFaces.length;

  const t0 = performance.now();
  const vPtr = wasm.alloc(vLen * 4);
  const fPtr = wasm.alloc(fLen * 4);

  new Float32Array(wasm.memory.buffer, vPtr, vLen).set(vertices);
  new Uint32Array(wasm.memory.buffer, fPtr, fLen).set(finalFaces);
  const t_copy_in = performance.now();

  const t_exe_start = performance.now();
  const resPtr = wasm.remesh_quads_wasm(vPtr, vLen, fPtr, fLen, targetFaces, stride);
  const t_exe_end = performance.now();

  if (resPtr === 0) {
    console.error("remesh_quads_wasm FAILED");
    wasm.dealloc(vPtr, vLen * 4);
    wasm.dealloc(fPtr, fLen * 4);
    
    self.postMessage({
      type: 'MESH_UPDATE_QUAD_ERROR',
      message: "Rust remesh_quads_wasm returned 0 (failed to remesh)"
    });
    return;
  }

  const t_copy_out_start = performance.now();
  const meta = new Uint32Array(wasm.memory.buffer, resPtr, 10);
  const outVPtr = meta[0], outVLen = meta[1];
  const outFPtr = meta[2], outFLen = meta[3];

  const outVertices = new Float32Array(wasm.memory.buffer, outVPtr, outVLen).slice();
  const outFaces = new Uint32Array(wasm.memory.buffer, outFPtr, outFLen).slice();
  const t_copy_out_end = performance.now();

  // console.log(`[GeometryWorker] remeshQuads Profile:`);
  // console.log(`  Copy IN: ${(t_copy_in - t0).toFixed(2)} ms`);
  // console.log(`  WASM Exe: ${(t_exe_end - t_exe_start).toFixed(2)} ms`);
  // console.log(`  Copy OUT: ${(t_copy_out_end - t_copy_out_start).toFixed(2)} ms`);
  // console.log(`  Total: ${(t_copy_out_end - t0).toFixed(2)} ms`);

  console.log(`[GeometryWorker] remeshQuads output: vLen = ${outVertices.length / 3}, fLen = ${outFaces.length / 4} (elements=${outFaces.length})`);

  wasm.free_mesh_result(resPtr);
  wasm.dealloc(vPtr, vLen * 4);
  wasm.dealloc(fPtr, fLen * 4);

  let outColors = null;
  if (msg.colors) {
    console.log("[GeometryWorker] Transferring vertex colors...");
    outColors = transferColors(outVertices, vertices, msg.colors);
  }

  const transfer = [];
  if (outVertices.buffer) transfer.push(outVertices.buffer);
  if (outFaces.buffer) transfer.push(outFaces.buffer);
  if (outColors && outColors.buffer) transfer.push(outColors.buffer);

  self.postMessage({
    type: 'MESH_UPDATE_QUAD',
    data: {
      vertices: outVertices,
      faces: outFaces,
      colors: outColors,
      id: msg.id
    }
  }, transfer);
}

function simplifyMesh(msg) {
  if (!globalThis.wasmModule) {
    console.error("simplifyMesh: wasmModule not loaded");
    return;
  }
  const wasm = globalThis.wasmModule;

  const vertices = msg.v;
  let finalFaces = msg.f;
  
  if (msg.isTriangles) {
    finalFaces = unpadTriangles(msg.f);
  }

  const targetFaces = msg.targetFaces || 0;
  const errorThreshold = msg.errorThreshold || 0.001;

  const vLen = vertices.length;
  const fLen = finalFaces.length;

  const t0 = performance.now();
  const vPtr = wasm.alloc(vLen * 4);
  const fPtr = wasm.alloc(fLen * 4);

  new Float32Array(wasm.memory.buffer, vPtr, vLen).set(vertices);
  new Uint32Array(wasm.memory.buffer, fPtr, fLen).set(finalFaces);
  const t_copy_in = performance.now();

  const t_exe_start = performance.now();
  const resPtr = wasm.simplify_mesh_wasm(vPtr, vLen, fPtr, fLen, targetFaces, errorThreshold);
  const t_exe_end = performance.now();

  if (resPtr === 0) {
    console.error("simplify_mesh_wasm FAILED");
    wasm.dealloc(vPtr, vLen * 4);
    wasm.dealloc(fPtr, fLen * 4);
    
    self.postMessage({
      type: 'MESH_UPDATE_QUAD_ERROR',
      message: "Rust simplify_mesh_wasm returned 0 (failed to simplify)"
    });
    return;
  }

  const t_copy_out_start = performance.now();
  const meta = new Uint32Array(wasm.memory.buffer, resPtr, 10);
  const outVPtr = meta[0], outVLen = meta[1];
  const outFPtr = meta[2], outFLen = meta[3];

  const outVertices = new Float32Array(wasm.memory.buffer, outVPtr, outVLen).slice();
  const outFaces = new Uint32Array(wasm.memory.buffer, outFPtr, outFLen).slice();
  const t_copy_out_end = performance.now();

  // console.log(`[GeometryWorker] simplifyMesh Profile:`);
  // console.log(`  Copy IN: ${(t_copy_in - t0).toFixed(2)} ms`);
  // console.log(`  WASM Exe: ${(t_exe_end - t_exe_start).toFixed(2)} ms`);
  // console.log(`  Copy OUT: ${(t_copy_out_end - t_copy_out_start).toFixed(2)} ms`);
  // console.log(`  Total: ${(t_copy_out_end - t0).toFixed(2)} ms`);

  console.log(`[GeometryWorker] simplifyMesh output: vLen = ${outVertices.length / 3}, fLen = ${outFaces.length / 4} (elements=${outFaces.length})`);

  wasm.free_mesh_result(resPtr);
  wasm.dealloc(vPtr, vLen * 4);
  wasm.dealloc(fPtr, fLen * 4);
  console.log(`[GeometryWorker] simplifyMesh output: vLen = ${outVertices.length / 3}, fLen = ${outFaces.length / 3}`);

  let outColors = null;
  if (msg.colors) {
    console.log("[GeometryWorker] Transferring vertex colors...");
    outColors = transferColors(outVertices, vertices, msg.colors);
  }

  const transfer = [];
  if (outVertices.buffer) transfer.push(outVertices.buffer);
  if (outFaces.buffer) transfer.push(outFaces.buffer);
  if (outColors && outColors.buffer) transfer.push(outColors.buffer);

  self.postMessage({
    type: 'MESH_UPDATE_QUAD',
    data: {
      vertices: outVertices,
      faces: outFaces,
      colors: outColors,
      id: msg.id
    }
  }, transfer);
}

function remeshIsotropic(msg) {
  if (!globalThis.wasmModule) {
    console.error("remeshIsotropic: wasmModule not loaded");
    return;
  }
  const wasm = globalThis.wasmModule;

  const vertices = msg.v;
  let finalFaces = msg.f;
  
  if (msg.isTriangles) {
    finalFaces = unpadTriangles(msg.f);
  }

  // Scale down the UI slider range by 0.1x so 0.1 = 0.01 edge length!
  const targetEdgeLength = (msg.targetEdgeLength || 0.1) * 0.1;

  const vLen = vertices.length;
  const fLen = finalFaces.length;

  const t0 = performance.now();
  const vPtr = wasm.alloc(vLen * 4);
  const fPtr = wasm.alloc(fLen * 4);

  new Float32Array(wasm.memory.buffer, vPtr, vLen).set(vertices);
  new Uint32Array(wasm.memory.buffer, fPtr, fLen).set(finalFaces);
  const t_copy_in = performance.now();

  const t_exe_start = performance.now();
  const resPtr = wasm.remesh_isotropic_wasm(vPtr, vLen, fPtr, fLen, targetEdgeLength);
  const t_exe_end = performance.now();

  if (resPtr === 0) {
    console.error("remesh_isotropic_wasm FAILED");
    wasm.dealloc(vPtr, vLen * 4);
    wasm.dealloc(fPtr, fLen * 4);
    
    self.postMessage({
      type: 'MESH_UPDATE_QUAD_ERROR',
      message: "Rust remesh_isotropic_wasm returned 0 (failed to remesh)"
    });
    return;
  }

  const t_copy_out_start = performance.now();
  const meta = new Uint32Array(wasm.memory.buffer, resPtr, 10);
  const outVPtr = meta[0], outVLen = meta[1];
  const outFPtr = meta[2], outFLen = meta[3];

  const outVertices = new Float32Array(wasm.memory.buffer, outVPtr, outVLen).slice();
  const outFaces = new Uint32Array(wasm.memory.buffer, outFPtr, outFLen).slice();
  const t_copy_out_end = performance.now();

  // console.log(`[GeometryWorker] remeshIsotropic Profile:`);
  // console.log(`  Copy IN: ${(t_copy_in - t0).toFixed(2)} ms`);
  // console.log(`  WASM Exe: ${(t_exe_end - t_exe_start).toFixed(2)} ms`);
  // console.log(`  Copy OUT: ${(t_copy_out_end - t_copy_out_start).toFixed(2)} ms`);
  // console.log(`  Total: ${(t_copy_out_end - t0).toFixed(2)} ms`);

  console.log(`[GeometryWorker] remeshIsotropic output: vLen = ${outVertices.length / 3}, fLen = ${outFaces.length / 4} (elements=${outFaces.length})`);

  wasm.free_mesh_result(resPtr);
  wasm.dealloc(vPtr, vLen * 4);
  wasm.dealloc(fPtr, fLen * 4);

  let outColors = null;
  if (msg.colors) {
    console.log("[GeometryWorker] Transferring vertex colors...");
    outColors = transferColors(outVertices, vertices, msg.colors);
  }

  const transfer = [];
  if (outVertices.buffer) transfer.push(outVertices.buffer);
  if (outFaces.buffer) transfer.push(outFaces.buffer);
  if (outColors && outColors.buffer) transfer.push(outColors.buffer);

  self.postMessage({
    type: 'MESH_UPDATE_QUAD',
    data: {
      vertices: outVertices,
      faces: outFaces,
      colors: outColors,
      id: msg.id
    }
  }, transfer);
}

function transferColors(newVerts, oldVerts, oldColors) {
  const newColors = new Float32Array(newVerts.length);
  const nLen = newVerts.length / 3;
  const oLen = oldVerts.length / 3;
  
  for (let i = 0; i < nLen; i++) {
    const nx = newVerts[i * 3];
    const ny = newVerts[i * 3 + 1];
    const nz = newVerts[i * 3 + 2];
    
    let minDistSq = Infinity;
    let closestIdx = -1;
    
    for (let j = 0; j < oLen; j++) {
      const ox = oldVerts[j * 3];
      const oy = oldVerts[j * 3 + 1];
      const oz = oldVerts[j * 3 + 2];
      
      const dx = nx - ox;
      const dy = ny - oy;
      const dz = nz - oz;
      const dSq = dx*dx + dy*dy + dz*dz;
      
      if (dSq < minDistSq) {
        minDistSq = dSq;
        closestIdx = j;
      }
    }
    
    if (closestIdx !== -1) {
      newColors[i * 3] = oldColors[closestIdx * 3];
      newColors[i * 3 + 1] = oldColors[closestIdx * 3 + 1];
      newColors[i * 3 + 2] = oldColors[closestIdx * 3 + 2];
    }
  }
  return newColors;
}

function validateManifold(msg) {
  const vertices = msg.v;
  const faces = msg.f;
  const isTriangles = msg.isTriangles;

  let triFaces = faces;
  if (!isTriangles) {
    triFaces = triangulateQuads(faces); // Already available in worker
  } else {
    if (faces.length % 4 === 0 && (faces[3] === 4294967295 || faces[3] === 0xFFFFFFFF)) {
      triFaces = unpadTriangles(faces);
    } else if (faces.length % 4 === 0) {
      triFaces = triangulateQuads(faces); // Fallback for quad array in triangles path
    }
  }

  const welded = weldVertices(vertices, triFaces);
  let cleanFaces = filterDegenerateTriangles(welded.vertices, welded.faces);
  cleanFaces = filterCollinearTriangles(welded.vertices, cleanFaces);

  const undirectedCount = new Map();
  for (let k = 0; k < cleanFaces.length; k += 3) {
    const a = cleanFaces[k];
    const b = cleanFaces[k + 1];
    const c = cleanFaces[k + 2];
    
    const edges = [[a, b], [b, c], [c, a]];
    for (const [u, v] of edges) {
      const min = Math.min(u, v);
      const max = Math.max(u, v);
      const key = `${min}_${max}`;
      undirectedCount.set(key, (undirectedCount.get(key) || 0) + 1);
    }
  }

  let boundaryEdges = 0;
  let oversharedEdges = 0;
  const faultIndices = [];

  for (const [key, count] of undirectedCount.entries()) {
    if (count === 1) boundaryEdges++;
    if (count > 2) oversharedEdges++;

    if (count === 1 || count > 2) {
      const parts = key.split("_");
      const u = parseInt(parts[0]);
      const v = parseInt(parts[1]);
      const oldU = welded.newToOldMap[u];
      const oldV = welded.newToOldMap[v];
      faultIndices.push(oldU, oldV);
    }
  }

  if (msg.heal) {
    const healWelded = weldVertices(vertices, faces); // Preserves quads or padding by using original faces array
    
    const transfer = [];
    if (healWelded.vertices && healWelded.vertices.buffer) transfer.push(healWelded.vertices.buffer);
    if (healWelded.faces && healWelded.faces.buffer) transfer.push(healWelded.faces.buffer);

    self.postMessage({
      type: 'VALIDATE_MANIFOLD_RESULT',
      holesIndices: faultIndices,
      holes: boundaryEdges,
      branching: oversharedEdges,
      v: healWelded.vertices,
      f: healWelded.faces
    }, transfer);
  } else {
    self.postMessage({
      type: 'VALIDATE_MANIFOLD_RESULT',
      holesIndices: faultIndices,
      holes: boundaryEdges,
      branching: oversharedEdges
    });
  }
}

