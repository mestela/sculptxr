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

    // Load Manifold-3D WASM
    try {
      const manifoldModule = await import('manifold-3d');
      const manifoldInstance = await manifoldModule.default({
        locateFile: (path) => {
          if (path.endsWith('.wasm')) {
            return '/manifold.wasm';
          }
          return path;
        }
      });
      manifoldInstance.setup();
      globalThis.manifold = manifoldInstance;
      console.log("VoxelWorker: Manifold-3D Loaded Successfully!");
    } catch (manifoldErr) {
      console.warn("VoxelWorker: Manifold-3D Load Failed", manifoldErr);
    }

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
      case 'SLICE_AND_CAP':
        sliceAndCap(msg);
        break;
      case 'SYMMETRY_MIRROR':
        symmetryMirror(msg);
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

    if (lenSq > 1e-12) { // 1e-12 epsilon
      out.push(faces[i], faces[i+1], faces[i+2]);
    } else {
      count++;
    }
  }
  if (count > 0) {
    console.log(`[VoxelWorker] filterCollinearTriangles: dropped ${count} collinear faces.`);
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
    if (areaSq < 1e-12) {
      continue; // Skip zero-area triangle
    }

    cleanFaces.push(a, b, c);
  }
  return new Uint32Array(cleanFaces);
}

function weldVertices(vertices, faces) {
  const uniqueVerts = [];
  const vertexMap = new Map(); // "x,y,z" -> newIndex
  const newFaces = new Uint32Array(faces.length);

  let nextIndex = 0;
  for (let i = 0; i < faces.length; i++) {
    const oldIdx = faces[i];
    if (oldIdx * 3 >= vertices.length) {
      // Out of bounds safety
      continue;
    }
    const x = vertices[oldIdx * 3];
    const y = vertices[oldIdx * 3 + 1];
    const z = vertices[oldIdx * 3 + 2];
    
    const key = `${x.toFixed(5)},${y.toFixed(5)},${z.toFixed(5)}`;
    
    if (!vertexMap.has(key)) {
      vertexMap.set(key, nextIndex);
      uniqueVerts.push(x, y, z);
      nextIndex++;
    }
    
    newFaces[i] = vertexMap.get(key);
  }

  return {
    vertices: new Float32Array(uniqueVerts),
    faces: newFaces
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

function symmetryMirror(msg) {
  try {
    const manifold = globalThis.manifold;
    if (!manifold) {
      console.error("symmetryMirror: manifold not loaded");
      return;
    }

    console.log(`[VoxelWorker] symmetryMirror started! isTriangles=${msg.isTriangles}`);

    const vertices = msg.v;
    const faces = msg.f;
    const isTriangles = msg.isTriangles;

    let triFaces = faces;
    if (!isTriangles) {
      console.log(`[VoxelWorker] triangulateQuads starting... for ${faces.length} faces`);
      triFaces = triangulateQuads(faces);
      console.log(`[VoxelWorker] triangulateQuads done!`);
    } else {
      if (faces.length % 4 === 0 && faces.length % 3 !== 0) {
        console.log(`[VoxelWorker] unpadTriangles starting... for 4-padded array of length ${faces.length}`);
        triFaces = unpadTriangles(faces);
        console.log(`[VoxelWorker] unpadTriangles done!`);
      } else {
        console.log(`[VoxelWorker] faces already unpadded (length % 3 === 0, length=${faces.length}). Using as-is.`);
        triFaces = faces;
      }
    }

    // 1. Clean up unscaled quad face indices + weld duplicate vertices (watertight)
    console.log(`[VoxelWorker] weldVertices starting... for ${triFaces.length} faces`);
    const welded = weldVertices(vertices, triFaces);
    console.log(`[VoxelWorker] weldVertices done! unique vertices=${welded.vertices.length}, faces=${welded.faces.length}`);

    // 2. Clean up degenerate triangles that were formed by welding!
    console.log(`[VoxelWorker] filterDegenerateTriangles starting...`);
    let cleanFaces = filterDegenerateTriangles(welded.vertices, welded.faces);
    console.log(`[VoxelWorker] filterDegenerateTriangles done! faces length=${cleanFaces.length}`);

    // 3. Filter collinear triangles (zero area via cross product)
    console.log(`[VoxelWorker] filterCollinearTriangles starting...`);
    cleanFaces = filterCollinearTriangles(welded.vertices, cleanFaces);
    console.log(`[VoxelWorker] filterCollinearTriangles done! faces length=${cleanFaces.length}`);

    // Scale up by 1000 to avoid precision issues in WASM
    console.log(`[VoxelWorker] Scaling up by 1000 for precision...`);
    const scaledVertices = new Float32Array(welded.vertices.length);
    for (let i = 0; i < welded.vertices.length; i++) {
        scaledVertices[i] = welded.vertices[i] * 1000.0;
    }

    // Convert cleanFaces to Uint32Array for manifold.Mesh!
    const triVertsTyped = new Uint32Array(cleanFaces);

    const mMesh = new manifold.Mesh({
      numProp: 3, // XYZ
      vertProperties: scaledVertices,
      triVerts: triVertsTyped
    });

    console.log(`[VoxelWorker] Creating Manifold constructor...`);
    const m = new manifold.Manifold(mMesh);
    
    // Normal and Origin
    const normal = msg.nPlane; // [x, y, z]
    const pt = msg.ptPlane; // [x, y, z]
    
    // Scale pt by 1000 as well since we scaled the mesh!
    const scaledPt = [pt[0] * 1000.0, pt[1] * 1000.0, pt[2] * 1000.0];
    const offset = scaledPt[0]*normal[0] + scaledPt[1]*normal[1] + scaledPt[2]*normal[2];

    console.log(`[VoxelWorker] splitByPlane: normal=[${normal}], offset=${offset}`);
    const [pos, neg] = m.splitByPlane(normal, offset);
    console.log(`[VoxelWorker] splitByPlane done! pos valid=${pos.getMesh().triVerts.length > 0}, neg valid=${neg.getMesh().triVerts.length > 0}`);
    
    const sideToKeep = msg.side || 1; // 1 for +L, -1 for +R
    const source = (sideToKeep === 1) ? pos : neg;
    
    console.log(`[VoxelWorker] Mirroring side... sideToKeep=${sideToKeep}`);
    const moved = source.translate([-scaledPt[0], -scaledPt[1], -scaledPt[2]]);
    const mirrored = moved.mirror(normal);
    const restored = mirrored.translate(scaledPt);
    console.log(`[VoxelWorker] Mirroring done!`);
    
    console.log(`[VoxelWorker] Composing sides...`);
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
    console.log(`[VoxelWorker] Union/Compose done!`);
    const resultMesh = combined.getMesh();

    // Scale back down by 1000
    const finalVertices = new Float32Array(resultMesh.vertProperties.length);
    for (let i = 0; i < resultMesh.vertProperties.length; i++) {
        finalVertices[i] = resultMesh.vertProperties[i] / 1000.0;
    }

    // 1. Pad the unpadded resultMesh.triVerts to standard 4-padded array per SculptGL contracts.
    const numTriangles = resultMesh.triVerts.length / 3;
    const paddedFaces = new Uint32Array(numTriangles * 4); // Standard unsigned array for WebGL indices
    let outPtr = 0;
    for (let i = 0; i < resultMesh.triVerts.length; i += 3) {
        paddedFaces[outPtr++] = resultMesh.triVerts[i];
        paddedFaces[outPtr++] = resultMesh.triVerts[i + 1];
        paddedFaces[outPtr++] = resultMesh.triVerts[i + 2];
        paddedFaces[outPtr++] = -1; // Standard pad for pure triangles in SculptGL
    }

    self.postMessage({
      type: 'SYMMETRY_MIRROR_RESULT',
      v: finalVertices, // XYZ (scaled back down)
      f: paddedFaces   // padded Int32Array (multiples of 4)
    }, [finalVertices.buffer, paddedFaces.buffer]);

  } catch (err) {
    console.error("symmetryMirror Error:", err);
  }
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

function remeshQuads(msg) {
  if (!globalThis.wasmModule) {
    console.error("remeshQuads: wasmModule not loaded");
    return;
  }

  const wasm = globalThis.wasmModule;
  const vertices = msg.v;
  
  let finalFaces = msg.f;
  let stride = 4;
  
  if (msg.isTriangles) {
    stride = 3;
    finalFaces = unpadTriangles(msg.f);
  }

  const targetFaces = msg.targetFaces;

  const vLen = vertices.length;
  const fLen = finalFaces.length;

  const vPtr = wasm.alloc(vLen * 4);
  const fPtr = wasm.alloc(fLen * 4);

  new Float32Array(wasm.memory.buffer, vPtr, vLen).set(vertices);
  new Uint32Array(wasm.memory.buffer, fPtr, fLen).set(finalFaces);

  const resPtr = wasm.remesh_quads_wasm(vPtr, vLen, fPtr, fLen, targetFaces, stride);

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

  const meta = new Uint32Array(wasm.memory.buffer, resPtr, 10);
  const outVPtr = meta[0], outVLen = meta[1];
  const outFPtr = meta[2], outFLen = meta[3];

  const outVertices = new Float32Array(wasm.memory.buffer, outVPtr, outVLen).slice();
  const outFaces = new Uint32Array(wasm.memory.buffer, outFPtr, outFLen).slice();

  console.log(`[VoxelWorker] remeshQuads output: vLen = ${outVertices.length / 3}, fLen = ${outFaces.length / 4} (elements=${outFaces.length})`);

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



