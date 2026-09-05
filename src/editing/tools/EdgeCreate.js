import Utils from '../../misc/Utils.js';
import Mesh from '../../mesh/Mesh.js';
import SculptBase from './SculptBase.js';
import * as THREE from 'three';
import { vec3 } from 'gl-matrix';

class EdgeCreate extends SculptBase {
  constructor(main) {
    super(main);
    this._continuous = false;
    this._sourceVertex = -1;
  }

  start(ctrl) {
    console.log("[EdgeCreate] start called");
    const mesh = this.getMesh();
    if (!mesh) return false;

    const activeMesh = mesh.getCurrentMesh ? mesh.getCurrentMesh() : mesh;
    const picking = this._main.getPicking();
    const faceIdx = picking.getPickedFace();
    
    if (faceIdx === undefined || faceIdx < 0) {
      console.log("[EdgeCreate] Resetting source vertex because nothing was picked.");
      this._sourceVertex = -1;
      this.clearSourceIndicator();
      return false;
    }

    const inter = picking.getIntersectionPoint(); // local space
    const faces = activeMesh.getFaces();
    const vertices = activeMesh.getVertices();

    // Find closest vertex in the picked face or floating indicators
    const fid = faceIdx * 4;
    const faceVerts = [faces[fid], faces[fid + 1], faces[fid + 2]];
    if (faces[fid + 3] !== Utils.TRI_INDEX) faceVerts.push(faces[fid + 3]);

    let minDistSq = Infinity;
    let closestVert = -1;

    // 1. Check face corners
    for (let i = 0; i < faceVerts.length; ++i) {
      const v = faceVerts[i];
      const vx = vertices[v * 3];
      const vy = vertices[v * 3 + 1];
      const vz = vertices[v * 3 + 2];
      
      const dx = inter[0] - vx;
      const dy = inter[1] - vy;
      const dz = inter[2] - vz;
      const distSq = dx*dx + dy*dy + dz*dz;

      if (distSq < minDistSq) {
        minDistSq = distSq;
        closestVert = v;
      }
    }

    const sceneApp = this._main.getScene ? this._main.getScene() : this._main._scene;
    if (this._main._floatingIndicators) {
      for (const ind of this._main._floatingIndicators) {
        const v = ind.vIdx;
        const vx = vertices[v * 3];
        const vy = vertices[v * 3 + 1];
        const vz = vertices[v * 3 + 2];
        
        const dx = inter[0] - vx;
        const dy = inter[1] - vy;
        const dz = inter[2] - vz;
        const distSq = dx*dx + dy*dy + dz*dz;

        if (distSq < minDistSq) {
          minDistSq = distSq;
          closestVert = v;
        }
      }
    }

    if (closestVert === -1) return false;

    if (this._sourceVertex === -1) {
      this._sourceVertex = closestVert;
      console.log(`[EdgeCreate] Step 1: Selected Source Vertex ${closestVert}.`);
      
      // Show source indicator
      this.createSourceIndicator(closestVert, activeMesh);
      
      if (this._main.getNotification) {
        this._main.getNotification().show(`Source vertex ${closestVert} selected. Click target vertex to create edge!`);
      }
      return true;
    }

    const targetVert = closestVert;
    if (targetVert === this._sourceVertex) {
      console.log("[EdgeCreate] Target is equal to source. Reset.");
      this._sourceVertex = -1;
      this.clearSourceIndicator();
      if (this._main.getNotification) {
        this._main.getNotification().show(`Selection reset.`);
      }
      return false;
    }

    console.log(`[EdgeCreate] Step 2: Target Vertex ${targetVert} picked! Joining ${this._sourceVertex} and ${targetVert}.`);
    
    const undoSnapshot = this.captureMeshSnapshot(activeMesh);

    const source = this._sourceVertex;
    const target = targetVert;
    this._sourceVertex = -1; // Reset
    this.clearSourceIndicator();

    // Perform edge creation (Face splitting)
    // SEARCH ALL FACES for one that contains both source and target!
    let foundFaceIdx = -1;
    let augmented = [];
    
    // Helper to check if a face contains a vertex (regular or floating)
    const hasUV = activeMesh.hasUV();
    const facesUV = hasUV ? activeMesh.getFacesTexCoord() : null;

    const getAugmentedList = (fIndex) => {
      const idf = fIndex * 4;
      const fv = [faces[idf], faces[idf + 1], faces[idf + 2], faces[idf + 3]];
      const fvUV = hasUV ? [facesUV[idf], facesUV[idf + 1], facesUV[idf + 2], facesUV[idf + 3]] : null;
      const isTri = fv[3] === Utils.TRI_INDEX;
      const numVerts = isTri ? 3 : 4;
      
      const aug = [];
      const augUV = hasUV ? [] : null;
      
      for (let i = 0; i < numVerts; i++) {
        const vA = fv[i];
        const vB = fv[(i + 1) % numVerts];
        aug.push(vA);
        if (hasUV) augUV.push(fvUV[i]);
        
        if (this._main._floatingIndicators) {
          for (const ind of this._main._floatingIndicators) {
            const edge = ind.edge;
            if (edge && edge.length >= 2 && ((edge[0] === vA && edge[1] === vB) || (edge[0] === vB && edge[1] === vA))) {
              aug.push(ind.vIdx);
              if (hasUV) augUV.push(ind.vIdx); // Use vertex index as fallback for floating UV
            }
          }
        }
      }
      return { verts: aug, uvs: augUV };
    };

    let augmentedUV = [];
    for (let i = 0; i < faces.length / 4; i++) {
      const result = getAugmentedList(i);
      if (result.verts.includes(source) && result.verts.includes(target)) {
        foundFaceIdx = i;
        augmented = result.verts;
        augmentedUV = result.uvs;
        break;
      }
    }

    if (foundFaceIdx === -1) {
      console.log("[EdgeCreate] No face found containing both vertices.");
      if (this._main.getNotification) {
        this._main.getNotification().show(`Vertices must belong to the same face.`);
      }
      return false;
    }

    const fIdx = foundFaceIdx;
    console.log(`[EdgeCreate] Found shared face ${fIdx} automatically!`);

    const idx1 = augmented.indexOf(source);
    const idx2 = augmented.indexOf(target);

    if (idx1 === -1 || idx2 === -1) {
      console.log("[EdgeCreate] Vertices not found in augmented face list.");
      if (this._main.getNotification) {
        this._main.getNotification().show(`Vertices must belong to the picked face.`);
      }
      return false;
    }

    // Split the augmented list
    const i = Math.min(idx1, idx2);
    const j = Math.max(idx1, idx2);

    const f1 = augmented.slice(i, j + 1);
    const f2 = augmented.slice(j).concat(augmented.slice(0, i + 1));

    let f1UV = null;
    let f2UV = null;
    if (hasUV) {
      f1UV = augmentedUV.slice(i, j + 1);
      f2UV = augmentedUV.slice(j).concat(augmentedUV.slice(0, i + 1));
    }

    console.log("[EdgeCreate] Split augmented list", augmented, "into", f1, "and", f2);

    // Validate face sizes (must be 3 or 4)
    if (f1.length < 3 || f1.length > 4 || f2.length < 3 || f2.length > 4) {
      console.log("[EdgeCreate] Invalid face sizes generated:", f1.length, f2.length);
      if (this._main.getNotification) {
        this._main.getNotification().show(`Invalid operation: would create N-gon.`);
      }
      return false;
    }

    // Replace original face with f1, and append f2!
    // We need to expand the faces array.
    const newFaces = new Uint32Array(faces.length + 4);
    newFaces.set(faces);
    
    const newFacesUV = hasUV ? new Uint32Array(facesUV.length + 4) : null;
    if (hasUV) newFacesUV.set(facesUV);
    
    const setFace = (idx, vertList, uvList) => {
      const fid = idx * 4;
      newFaces[fid] = vertList[0];
      newFaces[fid + 1] = vertList[1];
      newFaces[fid + 2] = vertList[2];
      newFaces[fid + 3] = vertList.length === 4 ? vertList[3] : Utils.TRI_INDEX;
      
      if (hasUV && uvList) {
        newFacesUV[fid] = uvList[0];
        newFacesUV[fid + 1] = uvList[1];
        newFacesUV[fid + 2] = uvList[2];
        newFacesUV[fid + 3] = uvList.length === 4 ? uvList[3] : Utils.TRI_INDEX;
      }
    };

    setFace(fIdx, f1, f1UV); // Replace old face
    const newFIdx = faces.length / 4;
    setFace(newFIdx, f2, f2UV); // Append new face

    activeMesh.setFaces(newFaces);
    if (hasUV) activeMesh.setFacesTexCoord(newFacesUV);
    activeMesh.setNbFaces(newFIdx + 1);

    // Defensive UV Resizing (Inherit from standards)
    if (hasUV) {
      const nbVerts = activeMesh.getNbVertices();
      const nbTex = activeMesh.getTexCoords().length / 2;
      if (nbVerts > nbTex) {
        const newTex = new Float32Array(nbVerts * 2);
        newTex.set(activeMesh.getTexCoords());
        activeMesh.setTexCoords(newTex);
      }
    }

    activeMesh.allocateArrays();
    activeMesh.initTopology();
    activeMesh.updateGeometry();
    
    // Fix shading artifact by updating duplicate colors and materials
    if (activeMesh._renderData) {
      activeMesh.updateDuplicateColorsAndMaterials();
    }
    
    // Wireframe Cache Invalidation
    if (activeMesh._meshData) {
      activeMesh._meshData._drawElementsWireframe = null;
      activeMesh._meshData._drawArraysWireframe = null;
    }

    activeMesh.updateBuffers();
    activeMesh.initRender();

    // Re-bless vertex normals if they reach valence 4 to fix black artifacts
    const reBlessVertex = (v) => {
      const ringFace = activeMesh.getVerticesRingFaceStartCount();
      const valence = ringFace ? ringFace[v * 2 + 1] : 0;
      if (valence >= 4) {
        console.log(`[EdgeCreate] Re-blessing vertex ${v} with valence ${valence}`);
        const normals = activeMesh.getNormals();
        const faceNormals = activeMesh.getFaceNormals();
        const vertRingFace = activeMesh.getVerticesRingFace();
        
        const start = ringFace[v * 2];
        const end = start + valence;
        
        let nx = 0, ny = 0, nz = 0;
        for (let j = start; j < end; ++j) {
          const fId = vertRingFace[j] * 3;
          nx += faceNormals[fId];
          ny += faceNormals[fId + 1];
          nz += faceNormals[fId + 2];
        }
        
        const len = Math.sqrt(nx*nx + ny*ny + nz*nz);
        if (len > 0) {
          normals[v * 3] = nx / len;
          normals[v * 3 + 1] = ny / len;
          normals[v * 3 + 2] = nz / len;
        }
      }
    };

    reBlessVertex(source);
    reBlessVertex(target);
    
    if (activeMesh._renderData) {
      activeMesh.updateDuplicateGeometry();
      activeMesh.updateBuffers(); // Push updated normals to GPU
    }

    // Cleanup floating indicators when they reach valence 4
    if (this._main._floatingIndicators) {
      const ringFace = activeMesh.getVerticesRingFaceStartCount();
      
      let targetScene = sceneApp;
      if (sceneApp._scene) targetScene = sceneApp._scene;
      
      let parentNode = targetScene;
      if (this._main._worldGroup) parentNode = this._main._worldGroup;
      
      this._main._floatingIndicators = this._main._floatingIndicators.filter(ind => {
        const v = ind.vIdx;
        if (v === source || v === target) {
          const valence = ringFace ? ringFace[v * 2 + 1] : 0;
          console.log(`[EdgeCreate] Vertex ${v} valence:`, valence);
          if (valence >= 4) {
            console.log(`[EdgeCreate] Removing indicator for vertex ${v} (valence ${valence})`);
            parentNode.remove(ind.mesh);
            return false;
          }
        }
        return true;
      });
    }

    const redoSnapshot = this.captureMeshSnapshot(activeMesh);

    this._main.getStateManager().pushStateCustom(
      () => this.applyMeshSnapshot(activeMesh, undoSnapshot),
      () => this.applyMeshSnapshot(activeMesh, redoSnapshot)
    );

    if (this._main.getNotification) {
      this._main.getNotification().show(`Created edge between ${source} and ${target}.`);
    }

    return true;
  }

  createSourceIndicator(vIdx, mesh) {
    const sceneApp = this._main.getScene ? this._main.getScene() : this._main._scene;
    if (!sceneApp) return;

    this.clearSourceIndicator();

    const vertices = mesh.getVertices();
    const vx = vertices[vIdx * 3];
    const vy = vertices[vIdx * 3 + 1];
    const vz = vertices[vIdx * 3 + 2];

    const geometry = new THREE.SphereGeometry(0.12, 8, 8); // Doubled size again for visibility
    const material = new THREE.MeshBasicMaterial({ color: 0x00ff00, depthTest: false, depthWrite: false, transparent: true, opacity: 0.8 });
    this._sourceIndicatorMesh = new THREE.Mesh(geometry, material);

    const worldPos = [vx, vy, vz];
    vec3.transformMat4(worldPos, worldPos, mesh.getMatrix());
    this._sourceIndicatorMesh.position.set(worldPos[0], worldPos[1], worldPos[2]);

    let targetScene = sceneApp;
    if (sceneApp._scene) targetScene = sceneApp._scene;
    
    let parentNode = targetScene;
    if (this._main._worldGroup) parentNode = this._main._worldGroup;
    parentNode.add(this._sourceIndicatorMesh);
  }

  clearSourceIndicator() {
    const sceneApp = this._main.getScene ? this._main.getScene() : this._main._scene;
    if (sceneApp && this._sourceIndicatorMesh) {
      let targetScene = sceneApp;
      if (sceneApp._scene) targetScene = sceneApp._scene;
      
      let parentNode = targetScene;
      if (this._main._worldGroup) parentNode = this._main._worldGroup;
      parentNode.remove(this._sourceIndicatorMesh);
      this._sourceIndicatorMesh = null;
    }
  }

  stroke(picking) {
  }
}

export default EdgeCreate;
