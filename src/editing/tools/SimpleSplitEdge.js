import Utils from '../../misc/Utils.js';
import Mesh from '../../mesh/Mesh.js';
import SculptBase from './SculptBase.js';
import * as THREE from 'three';
import { vec3 } from 'gl-matrix';

class SimpleSplitEdge extends SculptBase {
  constructor(main) {
    super(main);
    this._continuous = false;
  }

  start(ctrl) {
    console.log("[SimpleSplitEdge] start called");
    const mesh = this.getMesh();
    if (!mesh) {
      console.log("[SimpleSplitEdge] No mesh found!");
      return false;
    }

    const activeMesh = mesh.getCurrentMesh ? mesh.getCurrentMesh() : mesh;
    
    const picking = this._main.getPicking();
    const pickedFaceIdx = picking.getPickedFace();
    if (pickedFaceIdx === undefined || pickedFaceIdx < 0) {
      console.log("[SimpleSplitEdge] No face picked (pickedFaceIdx < 0 or undefined)");
      return false;
    }

    const hitPoint = picking.getIntersectionPoint();
    if (!hitPoint) {
      console.log("[SimpleSplitEdge] No intersection point found");
      return false;
    }

    const faces = activeMesh.getFaces();
    const vertices = activeMesh.getVertices();
    const idf = pickedFaceIdx * 4;
    const vIdxs = [
      faces[idf],
      faces[idf + 1],
      faces[idf + 2],
      faces[idf + 3]
    ];

    // Find closest edge to hit point
    let closestEdge = -1;
    let minDistSq = Infinity;
    
    const getPointToSegmentDistSq = (p, a, b) => {
      const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
      const abLenSq = ab[0]*ab[0] + ab[1]*ab[1] + ab[2]*ab[2];
      if (abLenSq === 0) return ap[0]*ap[0] + ap[1]*ap[1] + ap[2]*ap[2];
      
      let t = (ap[0]*ab[0] + ap[1]*ab[1] + ap[2]*ab[2]) / abLenSq;
      t = Math.max(0, Math.min(1, t));
      
      const closest = [
        a[0] + t * ab[0],
        a[1] + t * ab[1],
        a[2] + t * ab[2]
      ];
      const dx = p[0] - closest[0];
      const dy = p[1] - closest[1];
      const dz = p[2] - closest[2];
      return dx*dx + dy*dy + dz*dz;
    };

    const getVert = (idx) => [
      vertices[idx * 3],
      vertices[idx * 3 + 1],
      vertices[idx * 3 + 2]
    ];

    const numVertsInFace = vIdxs[3] === Utils.TRI_INDEX ? 3 : 4;
    for (let i = 0; i < numVertsInFace; i++) {
      const vA = vIdxs[i];
      const vB = vIdxs[(i + 1) % numVertsInFace];
      const pA = getVert(vA);
      const pB = getVert(vB);
      const distSq = getPointToSegmentDistSq(hitPoint, pA, pB);
      if (distSq < minDistSq) {
        minDistSq = distSq;
        closestEdge = i;
      }
    }

    if (closestEdge === -1) {
      console.log("[SimpleSplitEdge] No edge found close to hit point");
      return false;
    }
    console.log("[SimpleSplitEdge] Found closest edge: " + closestEdge);

    const vA = vIdxs[closestEdge];
    const vB = vIdxs[(closestEdge + 1) % numVertsInFace];

    // Midpoint C
    const pA = getVert(vA);
    const pB = getVert(vB);
    const pC = [
      (pA[0] + pB[0]) * 0.5,
      (pA[1] + pB[1]) * 0.5,
      (pA[2] + pB[2]) * 0.5
    ];

    // Capture snapshot for undo
    const undoSnapshot = this.captureMeshSnapshot(activeMesh);

    // Add new vertex C with duplicate shifting
    const nbVertices = activeMesh.getNbVertices();
    const newVIdx = nbVertices;
    
    // 1. Shift vertices
    const newVertices = new Float32Array(vertices.length + 3);
    newVertices.set(vertices.subarray(0, nbVertices * 3), 0);
    newVertices[newVIdx * 3] = pC[0];
    newVertices[newVIdx * 3 + 1] = pC[1];
    newVertices[newVIdx * 3 + 2] = pC[2];
    newVertices.set(vertices.subarray(nbVertices * 3), (newVIdx + 1) * 3);
    activeMesh.setVertices(newVertices);
    
    // 2. Shift colors
    const colors = activeMesh.getColors();
    const newColors = new Float32Array(colors.length + 3);
    newColors.set(colors.subarray(0, nbVertices * 3), 0);
    newColors[newVIdx * 3] = colors[vA * 3]; // Inherit from vA
    newColors[newVIdx * 3 + 1] = colors[vA * 3 + 1];
    newColors[newVIdx * 3 + 2] = colors[vA * 3 + 2];
    newColors.set(colors.subarray(nbVertices * 3), (newVIdx + 1) * 3);
    activeMesh.setColors(newColors);
    
    // 3. Shift materials
    const materials = activeMesh.getMaterials();
    const newMaterials = new Float32Array(materials.length + 3);
    newMaterials.set(materials.subarray(0, nbVertices * 3), 0);
    newMaterials[newVIdx * 3] = materials[vA * 3]; // Inherit from vA
    newMaterials[newVIdx * 3 + 1] = materials[vA * 3 + 1];
    newMaterials[newVIdx * 3 + 2] = materials[vA * 3 + 2];
    newMaterials.set(materials.subarray(nbVertices * 3), (newVIdx + 1) * 3);
    activeMesh.setMaterials(newMaterials);
    
    // 4. Shift texCoordsST if applicable
    if (activeMesh.hasUV()) {
      const texCoordsST = activeMesh.getTexCoords();
      if (texCoordsST) {
        const newTexCoordsST = new Float32Array(texCoordsST.length + 2);
        newTexCoordsST.set(texCoordsST.subarray(0, nbVertices * 2), 0);
        
        const uvA_s = texCoordsST[vA * 2];
        const uvA_t = texCoordsST[vA * 2 + 1];
        const uvB_s = texCoordsST[vB * 2];
        const uvB_t = texCoordsST[vB * 2 + 1];
        
        newTexCoordsST[newVIdx * 2] = (uvA_s + uvB_s) * 0.5;
        newTexCoordsST[newVIdx * 2 + 1] = (uvA_t + uvB_t) * 0.5;
        
        newTexCoordsST.set(texCoordsST.subarray(nbVertices * 2), (newVIdx + 1) * 2);
        activeMesh.setTexCoords(newTexCoordsST);
      }
    }
    
    // 5. Update face indices!
    for (let i = 0; i < faces.length; i++) {
      if (faces[i] >= nbVertices && faces[i] !== Utils.TRI_INDEX) {
        faces[i] += 1;
      }
    }
    
    // 6. Update facesUV indices!
    if (activeMesh.hasUV()) {
      const facesUV = activeMesh.getFacesTexCoord();
      if (facesUV) {
        for (let i = 0; i < facesUV.length; i++) {
          if (facesUV[i] >= nbVertices && facesUV[i] !== Utils.TRI_INDEX) {
            facesUV[i] += 1;
          }
        }
      }
    }
    
    // 7. Shift DuplicateStartCount!
    const dupCW = activeMesh.getVerticesDuplicateStartCount();
    if (dupCW) {
      const newDupCW = new Uint32Array(dupCW.length + 1);
      newDupCW.set(dupCW.subarray(0, nbVertices), 0);
      newDupCW[nbVertices] = dupCW[nbVertices];
      newDupCW.set(dupCW.subarray(nbVertices), nbVertices + 1);
      activeMesh.setVerticesDuplicateStartCount(newDupCW);
    }
    
    activeMesh.setNbVertices(nbVertices + 1);
    console.log("[SimpleSplitEdge] Added vertex C with duplicate shifting, new count: " + (nbVertices + 1));

    console.log("[SimpleSplitEdge] Calling allocateArrays");
    activeMesh.allocateArrays();
    console.log("[SimpleSplitEdge] Called allocateArrays");
    
    // Interpolate normals from edge ends to prevent black artifacts
    const normals = activeMesh.getNormals();
    const nxA = normals[vA * 3];
    const nyA = normals[vA * 3 + 1];
    const nzA = normals[vA * 3 + 2];
    const nxB = normals[vB * 3];
    const nyB = normals[vB * 3 + 1];
    const nzB = normals[vB * 3 + 2];
    
    const nx = (nxA + nxB) * 0.5;
    const ny = (nyA + nyB) * 0.5;
    const nz = (nzA + nzB) * 0.5;
    const len = Math.sqrt(nx*nx + ny*ny + nz*nz);
    if (len > 0) {
      normals[newVIdx * 3] = nx / len;
      normals[newVIdx * 3 + 1] = ny / len;
      normals[newVIdx * 3 + 2] = nz / len;
    } else {
      normals[newVIdx * 3] = nxA;
      normals[newVIdx * 3 + 1] = nyA;
      normals[newVIdx * 3 + 2] = nzA;
    }
    
    activeMesh.initTopology();
    console.log("[SimpleSplitEdge] Called initTopology");
    activeMesh.updateGeometry();
    console.log("[SimpleSplitEdge] Called updateGeometry");
    
    // Wireframe Cache Invalidation
    if (activeMesh._meshData) {
      activeMesh._meshData._drawElementsWireframe = null;
      activeMesh._meshData._drawArraysWireframe = null;
    }

    activeMesh.updateBuffers();
    console.log("[SimpleSplitEdge] Called updateBuffers");
    activeMesh.initRender();
    console.log("[SimpleSplitEdge] Called initRender");
    
    // Create Visual Indicator (Transient)
    const sceneApp = this._main.getScene ? this._main.getScene() : this._main._scene;
    console.log("[SimpleSplitEdge] sceneApp found: " + (!!sceneApp));
    if (sceneApp) {
      console.log("[SimpleSplitEdge] sceneApp.add found: " + (!!sceneApp.add));
      console.log("[SimpleSplitEdge] sceneApp._scene found: " + (!!sceneApp._scene));
      
      let targetScene = sceneApp;
      if (sceneApp._scene) {
        targetScene = sceneApp._scene;
      }
      console.log("[SimpleSplitEdge] targetScene.add found: " + (!!targetScene.add));
      
      const geometry = new THREE.SphereGeometry(0.12, 8, 8); // Doubled size again for visibility
      const material = new THREE.MeshBasicMaterial({ color: 0xffff00, depthTest: false, transparent: true, opacity: 0.8 });
      const indicator = new THREE.Mesh(geometry, material);
      
      // Transform local hit point to world space
      const worldPos = [pC[0], pC[1], pC[2]];
      vec3.transformMat4(worldPos, worldPos, activeMesh.getMatrix());
      
      // Position at edge midpoint
      indicator.position.set(worldPos[0], worldPos[1], worldPos[2]);
      
      // Add to worldGroup if available to inherit transform
      let parentNode = targetScene;
      if (this._main._worldGroup) {
        parentNode = this._main._worldGroup;
        console.log("[SimpleSplitEdge] Adding to _worldGroup");
      } else {
        console.log("[SimpleSplitEdge] Adding to targetScene");
      }
      
      parentNode.add(indicator);
      console.log(`[SimpleSplitEdge] Added indicator at pos:`, worldPos);
      
      // Store in main app for cleanup or tracking
      if (!this._main._floatingIndicators) {
        this._main._floatingIndicators = [];
      }
      this._main._floatingIndicators.push({
        vIdx: newVIdx,
        mesh: indicator,
        edge: [vA, vB]
      });
    }

    const redoSnapshot = this.captureMeshSnapshot(activeMesh);

    const undoSplit = () => {
      this.applyMeshSnapshot(activeMesh, undoSnapshot);
      // Remove indicator
      if (this._main._floatingIndicators) {
        const ind = this._main._floatingIndicators.find(i => i.vIdx === newVIdx);
        if (ind) {
          sceneApp._scene.remove(ind.mesh);
          sceneApp._floatingIndicators = sceneApp._floatingIndicators.filter(i => i.vIdx !== newVIdx);
        }
      }
    };
    const redoSplit = () => {
      this.applyMeshSnapshot(activeMesh, redoSnapshot);
      // Re-add indicator? Or just let it be handled by state.
      // If we redo, we should probably re-create it.
    };

    this._main.getStateManager().pushStateCustom(undoSplit, redoSplit);

    if (this._main.getNotification) {
      this._main.getNotification().show(`Created vertex ${newVIdx} on edge.`);
    }

    return true;
  }

  stroke(picking) {
  }
}

export default SimpleSplitEdge;
