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

    console.log("[DissolveVertex] Capturing undo snapshot...");
    const undoSnapshot = this.captureMeshSnapshot(activeMesh);

    // Handle UVs if present
    const facesTexCoord = activeMesh.getFacesTexCoord();
    let newFacesTexCoord = null;
    if (facesTexCoord) {
      const tempTexCoord = [];
      
      for (let i = 0; i < faces.length; i += 4) {
        const idx = i / 4;
        if (connectedFaces.includes(idx)) {
          let fv = [faces[i], faces[i + 1], faces[i + 2], faces[i + 3]];
          const activeCount = fv.filter(v => v !== Utils.TRI_INDEX).length;
          
          if (activeCount <= 3) {
            // Triangle dropped!
            continue;
          }
          
          // Quad becoming triangle!
          const remainingIdx = [];
          for (let k = 0; k < 4; ++k) {
            if (faces[i + k] !== closestVert && faces[i + k] !== Utils.TRI_INDEX) {
              remainingIdx.push(k);
            }
          }
          
          if (remainingIdx.length === 3) {
            tempTexCoord.push(facesTexCoord[i + remainingIdx[0]]);
            tempTexCoord.push(facesTexCoord[i + remainingIdx[1]]);
            tempTexCoord.push(facesTexCoord[i + remainingIdx[2]]);
            tempTexCoord.push(0); // Dummy for 4th element
          }
        } else {
          // Keep face
          tempTexCoord.push(facesTexCoord[i]);
          tempTexCoord.push(facesTexCoord[i + 1]);
          tempTexCoord.push(facesTexCoord[i + 2]);
          tempTexCoord.push(facesTexCoord[i + 3]);
        }
      }
      newFacesTexCoord = new Uint32Array(tempTexCoord);
    }

    // Set new state
    activeMesh.setFaces(tNewFaces);
    activeMesh.setNbFaces(tNewFaces.length / 4);
    
    if (newFacesTexCoord) {
      activeMesh.setFacesTexCoord(newFacesTexCoord);
    }

    activeMesh.allocateArrays();
    activeMesh.initTopology();
    activeMesh.updateGeometry();
    activeMesh.updateCenter();
    
    if (activeMesh._renderData)
      activeMesh.updateDuplicateColorsAndMaterials();
    activeMesh.updateBuffers();

    // Cleanup floating indicator if it exists!
    if (this._main._floatingIndicators) {
      const k = this._main._floatingIndicators.findIndex(ind => ind.vIdx === closestVert);
      if (k !== -1) {
        console.log(`[DissolveVertex] Removing indicator for dissolved vertex ${closestVert}`);
        const ind = this._main._floatingIndicators[k];
        this._main._floatingIndicators.splice(k, 1);
        if (ind.mesh && ind.mesh.parent) {
          ind.mesh.parent.remove(ind.mesh);
        }
      }
    }

    const redoSnapshot = this.captureMeshSnapshot(activeMesh);

    this._main.getStateManager().pushStateCustom(
      () => this.applyMeshSnapshot(activeMesh, undoSnapshot),
      () => this.applyMeshSnapshot(activeMesh, redoSnapshot)
    );
    
    return true;
  }

  stroke(picking) {
  }
}

export default DissolveVertex;
