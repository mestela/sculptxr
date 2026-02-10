
// VoxelWorker.js
// Runs VoxelState and SurfaceNets in a background thread.

// Import dependencies (Standard ES Modules for Workers in modern browsers)
// We need VoxelState and SurfaceNets. 
// Since we are in strict mode, we might need to adjust imports if they use window/DOM.
// import { vec3 } from '../../lib/gl-matrix-wrapper.js?v=fix_3';
// import VoxelState from '../editing/VoxelState.js?v=fix_3'; // relative path failed
// import VoxelState from './VoxelState.js?v=fix_3'; // local copy worked
// import VoxelState from '/src/editing/VoxelState.js?v=fix_3'; // absolute path
import VoxelState from './VoxelState.js?v=fix_3'; // local copy (src/workers/VoxelState.js)
import TestModule from './TestModule.js?v=fix_3';
// SurfaceNets is a static object, should import fine
// BUT standard imports might fail if not served correctly or if they have other deps.
// Given the project structure, let's assume standard relative imports work in Chrome/Quest.

console.log("VoxelWorker: Script Starting...");
console.log("Imported Test:", TestModule);
let voxelState = null;

self.onmessage = function (e) {
  const msg = e.data;

  try {
    switch (msg.type) {
      case 'INIT':
        init(msg.res, msg.size);
        break;
      case 'RESIZE':
        // TODO
        break;
      case 'EDIT_SPHERE':
        editSphere(msg.center, msg.radius, msg.color, msg.isNegative, msg.returnMesh);
        break;
      case 'GET_MESH':
        // Force full remesh (debug)
        postMesh();
        break;
      case 'CLEAR':
        if (voxelState) {
          // VoxelState.js needs a clear method, or we reset it
          if (voxelState.clear) voxelState.clear();
          else voxelState = new VoxelState(voxelState.resolution, voxelState.size);
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
  console.log(`VoxelWorker: Init ${res}^3 Size=${size}`);
  voxelState = new VoxelState(res, size);
  // Force initial empty mesh
  // voxelState.clear();
  postMesh();
}

function editSphere(center, radius, color, isNegative, returnMesh) {
  if (!voxelState) return;

  let changed = false;
  if (isNegative) {
    changed = voxelState.subtractSphere(center, radius);
  } else {
    changed = voxelState.addSphere(center, radius, color);
  }

  if (changed && returnMesh) {
    postMesh();
  }
}

function postMesh() {
  if (!voxelState) return;

  // console.time('Worker:ComputeMesh');
  const res = voxelState.computeMesh();
  // console.timeEnd('Worker:ComputeMesh');

  // DEBUG: Log mesh stats
  // console.log(`Worker: Posting Mesh V=${res.vertices.length} F=${res.faces.length}`);

  // res = { vertices, faces, colors, materials } (Float32Arrays/Uint32Arrays)

  // We must TRANSFER the buffers to avoid copy overhead.
  const transferList = [
    res.vertices.buffer,
    res.faces.buffer,
    res.colors.buffer,
    res.materials.buffer
  ];

  self.postMessage({
    type: 'MESH_UPDATE',
    data: res
  }, transferList);
}
