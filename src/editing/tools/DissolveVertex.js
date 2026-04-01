import MeshStatic from '../../mesh/meshStatic/MeshStatic.js';
import Mesh from '../../mesh/Mesh.js';
import Utils from '../../misc/Utils.js';
import SculptBase from './SculptBase.js';
import Geometry from '../../math3d/Geometry.js';
import { vec3 } from 'gl-matrix';

class DissolveVertex extends SculptBase {
  constructor(main) {
    super(main);
    this._continuous = false;
  }

  start(ctrl) {
    console.log("[DissolveVertex] Tool start() invoked! Attempting to dissolve picked vertex.");
    
    const mesh = this.getMesh();
    if (!mesh) return false;

    const picking = this._main.getPicking();
    const faceIdx = picking.getPickedFace();
    
    if (faceIdx === undefined || faceIdx < 0) {
      console.log("[DissolveVertex] Exit: No face picked!");
      return false;
    }

    const inter = picking.getIntersectionPoint(); // local space
    const faces = mesh.getFaces();
    const vertices = mesh.getVertices();

    const fid = faceIdx * 4;
    const v = [faces[fid], faces[fid + 1], faces[fid + 2], faces[fid + 3]];
    
    let minDistSq = Infinity;
    let closestVert = -1;

    v.forEach(vIdx => {
      if (vIdx === Utils.TRI_INDEX) return;
      const d = vec3.sqrDist(inter, vertices.subarray(vIdx * 3, vIdx * 3 + 3));
      if (d < minDistSq) {
        minDistSq = d;
        closestVert = vIdx;
      }
    });

    if (closestVert === -1) return false;

    console.log(`[DissolveVertex] Picked vertex ${closestVert} closest to intersection.`);

    // Gather all faces using CLOSEST VERTEX
    const vrfStartCount = mesh.getVerticesRingFaceStartCount();
    const vertRingFace = mesh.getVerticesRingFace();

    const startIdx = vrfStartCount[closestVert * 2];
    const count = vrfStartCount[closestVert * 2 + 1];

    const connectedFaces = [];
    for (let i = 0; i < count; ++i) {
      connectedFaces.push(vertRingFace[startIdx + i]);
    }

    console.log(`[DissolveVertex] Vertex ${closestVert} is used by ${connectedFaces.length} faces.`);

    // Check valence! The user wants to dissolve valence-2 vertices (collinear edges)
    // Valence-2 means it should connect to exactly 2 edges. In terms of faces, it can connect to 1 face (boundary) or 2 faces (manifold seam).
    if (connectedFaces.length > 2) {
      console.log(`[DissolveVertex] Exit: Vertex ${closestVert} is connected to ${connectedFaces.length} faces. Not a valence-2 boundary/seam vertex!`);
      return false; // Actually exit!
    }

    // Shrink face array
    const newFaces = []; // Can use dynamic array then convert
    
    for (let i = 0; i < faces.length; i += 4) {
      const idx = i / 4;
      if (connectedFaces.includes(idx)) {
        // This is a face using the vertex to dissolve!
        // Read indices
        let fv = [faces[i], faces[i + 1], faces[i + 2], faces[i + 3]];
        
        // Count active vertices
        const activeCount = fv.filter(v => v !== Utils.TRI_INDEX).length;

        if (activeCount <= 3) {
          // It was a triangle. If we remove a vertex, it becomes a 2-vertex degenerate line. We just DELETE the face!
          console.log(`[DissolveVertex] Face ${idx} was a triangle. Deleting it.`);
          continue; // Do not push to newFaces
        }

        // It was a quad! Removing one vertex makes it a triangle.
        console.log(`[DissolveVertex] Quad face ${idx} losing vertex ${closestVert}. Converting to triangle.`);
        
        const remaining = fv.filter(v => v !== closestVert && v !== Utils.TRI_INDEX);
        if (remaining.length === 3) {
          newFaces.push(remaining[0]);
          newFaces.push(remaining[1]);
          newFaces.push(remaining[2]);
          newFaces.push(Utils.TRI_INDEX);
        } else {
          console.log(`[DissolveVertex] Face ${idx} corrupted read. Skipping.`);
        }
      } else {
        // Not a connected face. Just copy it!
        newFaces.push(faces[i]);
        newFaces.push(faces[i + 1]);
        newFaces.push(faces[i + 2]);
        newFaces.push(faces[i + 3]);
      }
    }

    const tNewFaces = new Uint32Array(newFaces);

    const prevMesh = this.getMesh();
    const activeMesh = prevMesh.getCurrentMesh ? prevMesh.getCurrentMesh() : prevMesh;

    // Save old state
    const undoFaces = new Uint32Array(faces);

    // Set new state
    activeMesh.setFaces(tNewFaces);
    activeMesh.setNbFaces(tNewFaces.length / 4);

    activeMesh.init();
    activeMesh.initRender();

    const redoFaces = tNewFaces;

    const undoDissolve = () => {
      console.log(`[DissolveVertex] undoDissolve EXECUTE`);
      const wasOptim = Mesh.OPTIMIZE;
      Mesh.OPTIMIZE = false;
      activeMesh.setFaces(undoFaces);
      activeMesh.setNbFaces(undoFaces.length / 4);
      activeMesh.init();
      Mesh.OPTIMIZE = wasOptim;
      activeMesh.initRender();
    };

    const redoDissolve = () => {
      console.log(`[DissolveVertex] redoDissolve EXECUTE`);
      const wasOptim = Mesh.OPTIMIZE;
      Mesh.OPTIMIZE = false;
      activeMesh.setFaces(redoFaces);
      activeMesh.setNbFaces(redoFaces.length / 4);
      activeMesh.init();
      Mesh.OPTIMIZE = wasOptim;
      activeMesh.initRender();
    };

    this._main.getStateManager().pushStateCustom(undoDissolve, redoDissolve);
    
    return true;
  }

  stroke(picking) {
  }
}

export default DissolveVertex;
