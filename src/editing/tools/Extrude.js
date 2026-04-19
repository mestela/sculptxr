import { vec3, mat4, quat } from 'gl-matrix';
import Geometry from '../../math3d/Geometry.js';
import SculptBase from './SculptBase.js';
import Utils from '../../misc/Utils.js';
import * as THREE from 'three';

class Extrude extends SculptBase {
  constructor(main) {
    super(main);
    this._continuous = true;
    this._extrudedVerts = null; 
    this._vProxy = null;
    this._lastVRPos = null;
    this._lastVRQuat = quat.create();
    if (window.keepExtrudeFacesTogether === undefined) {
      window.keepExtrudeFacesTogether = true;
    }
    this._selectedFaces = new Set();
  }

  pushState() {
    // Disabled: Exclusively use the single custom state snapshot in end().
  }

  start(ctrl) {
    const main = this._main;
    const isDesktop = !main._vrSculpting;
    
    if (isDesktop && main._shiftKey) {
      const picking = main.getPicking();
      const pickedFace = picking.getPickedFace();
      if (pickedFace !== undefined && pickedFace >= 0) {
        if (this._selectedFaces.has(pickedFace)) {
          this._selectedFaces.delete(pickedFace);
        } else {
          this._selectedFaces.add(pickedFace);
        }
        this.updateSelectionHighlight();
        main.render();
      }
      return;
    }
    
    if (!isDesktop && main._vrSecondaryTriggerPressed) {
      const picking = main.getPicking();
      const pickedFace = picking.getPickedFace();
      if (pickedFace !== undefined && pickedFace >= 0) {
        // Determine drag mode based on initial face state
        this._dragSelectMode = this._selectedFaces.has(pickedFace) ? 'remove' : 'add';
        
        const mesh = this.getMesh();
        const activeMesh = mesh.getCurrentMesh ? mesh.getCurrentMesh() : mesh;
        const symFace = main.getSculptManager().getSymmetry() ? this.getSymmetricalFace(activeMesh, pickedFace) : -1;
        
        if (this._dragSelectMode === 'remove') {
          this._selectedFaces.delete(pickedFace);
          if (symFace !== -1) this._selectedFaces.delete(symFace);
        } else {
          this._selectedFaces.add(pickedFace);
          if (symFace !== -1) this._selectedFaces.add(symFace);
        }
        this._lastPickedFace = pickedFace; 
        this.updateSelectionHighlight();
        main.render();
      } else {
        if (this._selectedFaces.size > 0) {
          this._prevSelectedFaces = new Set(this._selectedFaces); 
          this._selectedFaces.clear();
          this.updateSelectionHighlight();
          main.render();
        }
      }
      return;
    }
    
    this._lastPickedFace = null;
    super.start(ctrl);
  }

  updateSelectionHighlight() {
    const mesh = this.getMesh();
    if (!mesh) return;
    const activeMesh = mesh.getCurrentMesh ? mesh.getCurrentMesh() : mesh;
    const faces = activeMesh.getFaces();
    const vertices = activeMesh.getVertices();
    const mat = activeMesh.getMatrix();
    
    const positions = [];
    
    if (this._selectedFaces && this._selectedFaces.size > 0) {
      for (const fIdx of this._selectedFaces) {
        const idf = fIdx * 4;
        const v1 = faces[idf];
        const v2 = faces[idf + 1];
        const v3 = faces[idf + 2];
        const v4 = faces[idf + 3];
        const isTri = v4 === Utils.TRI_INDEX;
        
        const p1 = [vertices[v1 * 3], vertices[v1 * 3 + 1], vertices[v1 * 3 + 2]];
        const p2 = [vertices[v2 * 3], vertices[v2 * 3 + 1], vertices[v2 * 3 + 2]];
        const p3 = [vertices[v3 * 3], vertices[v3 * 3 + 1], vertices[v3 * 3 + 2]];
        const p4 = isTri ? null : [vertices[v4 * 3], vertices[v4 * 3 + 1], vertices[v4 * 3 + 2]];
        
        const pushTriangle = (a, b, c) => {
          const wa = [0,0,0], wb = [0,0,0], wc = [0,0,0];
          vec3.transformMat4(wa, a, mat);
          vec3.transformMat4(wb, b, mat);
          vec3.transformMat4(wc, c, mat);
          positions.push(wa[0], wa[1], wa[2]);
          positions.push(wb[0], wb[1], wb[2]);
          positions.push(wc[0], wc[1], wc[2]);
        };
        
        pushTriangle(p1, p2, p3);
        if (!isTri) {
          pushTriangle(p1, p3, p4);
        }
      }
    }
    
    if (positions.length === 0) {
      if (this._selectionMesh) {
        this._selectionMesh.visible = false;
      }
      return;
    }
    
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    
    if (!this._selectionMesh) {
      const material = new THREE.MeshBasicMaterial({ 
        color: 0xffff00, 
        depthTest: false, 
        transparent: true, 
        depthWrite: false, 
        opacity: 0.4,
        side: THREE.DoubleSide
      });
      this._selectionMesh = new THREE.Mesh(geometry, material);
      this._selectionMesh.renderOrder = 10000;
      this._selectionMesh.isPickable = false;
      
      const sceneApp = this._main.getScene ? this._main.getScene() : this._main._scene;
      let targetScene = sceneApp;
      if (sceneApp && sceneApp._scene) targetScene = sceneApp._scene;
      
      let parentNode = targetScene;
      if (this._main._worldGroup) parentNode = this._main._worldGroup;
      parentNode.add(this._selectionMesh);
    } else {
      this._selectionMesh.geometry.dispose();
      this._selectionMesh.geometry = geometry;
      this._selectionMesh.visible = true;
    }
  }

  onUndo() {
    if (this._prevSelectedFaces) {
      this._selectedFaces = new Set(this._prevSelectedFaces);
      this._prevSelectedFaces = null;
      this.updateSelectionHighlight();
      this._main.render();
      return true;
    }
    
    if (this._main._stateManager) {
      this._main._stateManager.undo();
      this.updateSelectionHighlight();
      this._main.render();
      return true;
    }
    
    return false;
  }

  onRedo() {
    if (this._main._stateManager) {
      this._main._stateManager.redo();
      this.updateSelectionHighlight();
      this._main.render();
      return true;
    }
    return false;
  }

  getSymmetricalFace(mesh, faceIdx) {
    const faces = mesh.getFaces();
    const oldVerts = mesh.getVertices();
    const idf = faceIdx * 4;
    const v1 = faces[idf], v2 = faces[idf + 1], v3 = faces[idf + 2], v4 = faces[idf + 3];
    
    const cx = (oldVerts[v1 * 3] + oldVerts[v2 * 3] + oldVerts[v3 * 3] + (v4 !== Utils.TRI_INDEX ? oldVerts[v4 * 3] : 0)) / (v4 !== Utils.TRI_INDEX ? 4 : 3);
    const cy = (oldVerts[v1 * 3 + 1] + oldVerts[v2 * 3 + 1] + oldVerts[v3 * 3 + 1] + (v4 !== Utils.TRI_INDEX ? oldVerts[v4 * 3 + 1] : 0)) / (v4 !== Utils.TRI_INDEX ? 4 : 3);
    const cz = (oldVerts[v1 * 3 + 2] + oldVerts[v2 * 3 + 2] + oldVerts[v3 * 3 + 2] + (v4 !== Utils.TRI_INDEX ? oldVerts[v4 * 3 + 2] : 0)) / (v4 !== Utils.TRI_INDEX ? 4 : 3);

    const mx = -cx; 
    
    let bestF = -1;
    let bestDist = Infinity;
    
    for (let f = 0; f < mesh.getNbFaces(); f++) {
      if (f === faceIdx) continue;

      const idf_m = f * 4;
      const mv1 = faces[idf_m], mv2 = faces[idf_m + 1], mv3 = faces[idf_m + 2], mv4 = faces[idf_m + 3];
      
      const fcx = (oldVerts[mv1 * 3] + oldVerts[mv2 * 3] + oldVerts[mv3 * 3] + (mv4 !== Utils.TRI_INDEX ? oldVerts[mv4 * 3] : 0)) / (mv4 !== Utils.TRI_INDEX ? 4 : 3);
      const fcy = (oldVerts[mv1 * 3 + 1] + oldVerts[mv2 * 3 + 1] + oldVerts[mv3 * 3 + 1] + (mv4 !== Utils.TRI_INDEX ? oldVerts[mv4 * 3 + 1] : 0)) / (mv4 !== Utils.TRI_INDEX ? 4 : 3);
      const fcz = (oldVerts[mv1 * 3 + 2] + oldVerts[mv2 * 3 + 2] + oldVerts[mv3 * 3 + 2] + (mv4 !== Utils.TRI_INDEX ? oldVerts[mv4 * 3 + 2] : 0)) / (mv4 !== Utils.TRI_INDEX ? 4 : 3);

      const dx = fcx - mx;
      const dy = fcy - cy;
      const dz = fcz - cz;
      const dist = dx * dx + dy * dy + dz * dz;
      if (dist < bestDist) {
        bestDist = dist;
        bestF = f;
      }
    }
    
    if (bestF !== -1 && bestDist < 0.01) {
      return bestF;
    }
    return -1;
  }

  startSculpt() {
    const main = this._main;
    const picking = main.getPicking();
    const mesh = this.getMesh();
    if (!mesh || !picking.getMesh()) {
      return;
    }

    const activeMesh = mesh.getCurrentMesh ? mesh.getCurrentMesh() : mesh;
    const pickedFaceIdx = picking.getPickedFace();
    console.log("[Extrude] startSculpt called, pickedFaceIdx:", pickedFaceIdx);
    if (pickedFaceIdx === undefined || pickedFaceIdx < 0) {
      return;
    }

    // Calculate initial normal for desktop extrusion
    const faces = activeMesh.getFaces();
    const oldVerts = activeMesh.getVertices();
    const idf = pickedFaceIdx * 4;
    const v1 = faces[idf], v2 = faces[idf + 1], v3 = faces[idf + 2];
    
    const p1x = oldVerts[v1 * 3], p1y = oldVerts[v1 * 3 + 1], p1z = oldVerts[v1 * 3 + 2];
    const p2x = oldVerts[v2 * 3], p2y = oldVerts[v2 * 3 + 1], p2z = oldVerts[v2 * 3 + 2];
    const p3x = oldVerts[v3 * 3], p3y = oldVerts[v3 * 3 + 1], p3z = oldVerts[v3 * 3 + 2];
    
    const e1x = p2x - p1x, e1y = p2y - p1y, e1z = p2z - p1z;
    const e2x = p3x - p1x, e2y = p3y - p1y, e2z = p3z - p1z;
    
    this._extrudeNormal = vec3.create();
    this._extrudeNormal[0] = e1y * e2z - e1z * e2y;
    this._extrudeNormal[1] = e1z * e2x - e1x * e2z;
    this._extrudeNormal[2] = e1x * e2y - e1y * e2x;
    vec3.normalize(this._extrudeNormal, this._extrudeNormal);

    const cx = (p1x + p2x + p3x) / 3;
    this._primaryIsRight = cx >= -0.01;

    // Determine faces to extrude
    const targetFaces = [];
    const materials = activeMesh.getMaterials();
    let useMaskGroup = false;

    if (this._selectedFaces && this._selectedFaces.size > 0) {
      for (const f of this._selectedFaces) {
        targetFaces.push(f);
      }
    } else if (materials) {
      let anyMasked = false;
      let anyUnmasked = false;
      for (let i = 0; i < activeMesh.getNbVertices(); i++) {
        const m = materials[i * 3 + 2];
        if (m < 0.99) anyMasked = true;
        if (m > 0.01) anyUnmasked = true;
      }
      if (anyMasked && anyUnmasked) {
        useMaskGroup = true;
        for (let f = 0; f < activeMesh.getNbFaces(); f++) {
          const idf = f * 4;
          const v1 = faces[idf];
          const v2 = faces[idf + 1];
          const v3 = faces[idf + 2];
          const v4 = faces[idf + 3];
          const isTri = v4 === Utils.TRI_INDEX;

          const m1 = materials[v1 * 3 + 2];
          const m2 = materials[v2 * 3 + 2];
          const m3 = materials[v3 * 3 + 2];
          const m4 = isTri ? 1.0 : materials[v4 * 3 + 2];

          if (m1 > 0.5 && m2 > 0.5 && m3 > 0.5 && m4 > 0.5) {
            targetFaces.push(f);
          }
        }
      }
    }

    if (targetFaces.length === 0) {
      targetFaces.push(pickedFaceIdx);

      // Add symmetry support for click face
      if (main.getSculptManager().getSymmetry()) {
        const oldVerts = activeMesh.getVertices();
        const idf = pickedFaceIdx * 4;
        const v1 = faces[idf], v2 = faces[idf + 1], v3 = faces[idf + 2], v4 = faces[idf + 3];
        
        const cx = (oldVerts[v1 * 3] + oldVerts[v2 * 3] + oldVerts[v3 * 3] + (v4 !== Utils.TRI_INDEX ? oldVerts[v4 * 3] : 0)) / (v4 !== Utils.TRI_INDEX ? 4 : 3);
        const cy = (oldVerts[v1 * 3 + 1] + oldVerts[v2 * 3 + 1] + oldVerts[v3 * 3 + 1] + (v4 !== Utils.TRI_INDEX ? oldVerts[v4 * 3 + 1] : 0)) / (v4 !== Utils.TRI_INDEX ? 4 : 3);
        const cz = (oldVerts[v1 * 3 + 2] + oldVerts[v2 * 3 + 2] + oldVerts[v3 * 3 + 2] + (v4 !== Utils.TRI_INDEX ? oldVerts[v4 * 3 + 2] : 0)) / (v4 !== Utils.TRI_INDEX ? 4 : 3);

        const mx = -cx; 
        
        let bestF = -1;
        let bestDist = Infinity;
        
        for (let f = 0; f < activeMesh.getNbFaces(); f++) {
          if (f === pickedFaceIdx) continue;

          const idf_m = f * 4;
          const mv1 = faces[idf_m], mv2 = faces[idf_m + 1], mv3 = faces[idf_m + 2], mv4 = faces[idf_m + 3];
          
          const fcx = (oldVerts[mv1 * 3] + oldVerts[mv2 * 3] + oldVerts[mv3 * 3] + (mv4 !== Utils.TRI_INDEX ? oldVerts[mv4 * 3] : 0)) / (mv4 !== Utils.TRI_INDEX ? 4 : 3);
          const fcy = (oldVerts[mv1 * 3 + 1] + oldVerts[mv2 * 3 + 1] + oldVerts[mv3 * 3 + 1] + (mv4 !== Utils.TRI_INDEX ? oldVerts[mv4 * 3 + 1] : 0)) / (mv4 !== Utils.TRI_INDEX ? 4 : 3);
          const fcz = (oldVerts[mv1 * 3 + 2] + oldVerts[mv2 * 3 + 2] + oldVerts[mv3 * 3 + 2] + (mv4 !== Utils.TRI_INDEX ? oldVerts[mv4 * 3 + 2] : 0)) / (mv4 !== Utils.TRI_INDEX ? 4 : 3);

          const dx = fcx - mx;
          const dy = fcy - cy;
          const dz = fcz - cz;
          const dist = dx * dx + dy * dy + dz * dz;
          if (dist < bestDist) {
            bestDist = dist;
            bestF = f;
          }
        }
        
        if (bestF !== -1 && bestDist < 0.01) {
          targetFaces.push(bestF);
        }
      }
    }

    // Compute per-vertex normals for selection
    this._vertNormals = new Map();
    const vAr = activeMesh.getVertices();
    const facesAr = activeMesh.getFaces();
    
    for (const fIdx of targetFaces) {
      const idf = fIdx * 4;
      const v1 = facesAr[idf];
      const v2 = facesAr[idf + 1];
      const v3 = facesAr[idf + 2];
      const v4 = facesAr[idf + 3];
      const isTri = v4 === Utils.TRI_INDEX;
      
      const p1 = [vAr[v1 * 3], vAr[v1 * 3 + 1], vAr[v1 * 3 + 2]];
      const p2 = [vAr[v2 * 3], vAr[v2 * 3 + 1], vAr[v2 * 3 + 2]];
      const p3 = [vAr[v3 * 3], vAr[v3 * 3 + 1], vAr[v3 * 3 + 2]];
      
      const e1 = vec3.create(), e2 = vec3.create(), n = vec3.create();
      vec3.sub(e1, p2, p1);
      vec3.sub(e2, p3, p1);
      vec3.cross(n, e1, e2);
      vec3.normalize(n, n);
      
      const addNormal = (v) => {
        if (!this._vertNormals.has(v)) {
          this._vertNormals.set(v, vec3.create());
        }
        vec3.add(this._vertNormals.get(v), this._vertNormals.get(v), n);
      };
      
      addNormal(v1);
      addNormal(v2);
      addNormal(v3);
      if (!isTri) addNormal(v4);
    }
    
    for (const [v, n] of this._vertNormals.entries()) {
      vec3.normalize(n, n);
    }

    // Low-poly standards: Snapshot based undo avoiding the Garbage Pitfall
    this._undoSnapshot = {
      faces: new Uint32Array(activeMesh.getFaces().subarray(0, activeMesh.getNbFaces() * 4)),
      vertices: new Float32Array(activeMesh.getVertices().subarray(0, activeMesh.getNbVertices() * 3)),
      colors: activeMesh.getColors() ? new Float32Array(activeMesh.getColors().subarray(0, activeMesh.getNbVertices() * 3)) : null,
      materials: activeMesh.getMaterials() ? new Float32Array(activeMesh.getMaterials().subarray(0, activeMesh.getNbVertices() * 3)) : null,
      facesTexCoord: activeMesh.getFacesTexCoord() ? new Uint32Array(activeMesh.getFacesTexCoord().subarray(0, activeMesh.getNbFaces() * 4)) : null,
      nbFaces: activeMesh.getNbFaces(),
      nbVertices: activeMesh.getNbVertices(),
      selectedFaces: new Set(this._selectedFaces)
    };
    if (activeMesh.getTexCoords()) {
      const nbTex = activeMesh.getNbTexCoords ? activeMesh.getNbTexCoords() : activeMesh.getNbVertices();
      this._undoSnapshot.texCoords = new Float32Array(activeMesh.getTexCoords().subarray(0, nbTex * 2));
    }

    // Duplication/Extrusion Logic
    const oldNbVertices = activeMesh.getNbVertices();
    const oldNbFaces = activeMesh.getNbFaces();
    const oldFaces = activeMesh.getFaces();
    const oldColors = activeMesh.getColors();
    const oldMats = activeMesh.getMaterials();
    const oldUVs = activeMesh.getTexCoords();
    const oldFacesUV = activeMesh.getFacesTexCoord();

    const newVertIndices = [];
    let currentVertIdx = oldNbVertices;
    let currentFaceIdx = oldNbFaces;

    let numNewVerts = 0;
    let numNewFaces = 0;
    
    this._newToOldMap = new Map();

    if (!window.keepExtrudeFacesTogether) {
      // Mode 1: Isolated Face Blocks (Completely un-welded individual extruded pillars)
      for (const fIdx of targetFaces) {
        const idf = fIdx * 4;
        numNewVerts += (oldFaces[idf + 3] !== Utils.TRI_INDEX) ? 4 : 3;
        numNewFaces += (oldFaces[idf + 3] !== Utils.TRI_INDEX) ? 4 : 3;
      }
    } else {
      // Mode 2: Consolidated Bridging (Merged shared vertices and outer-loop boundary edges only)
      const vertSetCount = new Set();
      const edgeCounts = new Map();
      for (const fIdx of targetFaces) {
        const idf = fIdx * 4;
        vertSetCount.add(oldFaces[idf]);
        vertSetCount.add(oldFaces[idf + 1]);
        vertSetCount.add(oldFaces[idf + 2]);
        if (oldFaces[idf + 3] !== Utils.TRI_INDEX) vertSetCount.add(oldFaces[idf + 3]);

        const addE = (a, b) => {
          const key = a < b ? `${a}-${b}` : `${b}-${a}`;
          edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
        };
        const v1 = oldFaces[idf], v2 = oldFaces[idf + 1], v3 = oldFaces[idf + 2], v4 = oldFaces[idf + 3];
        addE(v1, v2); addE(v2, v3);
        if (v4 !== Utils.TRI_INDEX) {
          addE(v3, v4); addE(v4, v1);
        } else {
          addE(v3, v1);
        }
      }
      numNewVerts = vertSetCount.size;
      for (const count of edgeCounts.values()) {
        if (count === 1) numNewFaces++;
      }
    }

    const newNbVertices = oldNbVertices + numNewVerts;
    const newNbFaces = oldNbFaces + numNewFaces;

    const newVertices = new Float32Array(newNbVertices * 3);
    newVertices.set(oldVerts.subarray(0, oldNbVertices * 3));

    const newFaces = new Uint32Array(newNbFaces * 4);
    newFaces.set(oldFaces.subarray(0, oldNbFaces * 4));

    let newColors = null, newMats = null, newUVs = null, newFacesUV = null;
    if (oldColors) {
      newColors = new Float32Array(newNbVertices * 3);
      newColors.set(oldColors.subarray(0, oldNbVertices * 3));
    }
    if (oldMats) {
      newMats = new Float32Array(newNbVertices * 3);
      newMats.set(oldMats.subarray(0, oldNbVertices * 3));
    }
    if (oldUVs) {
      newUVs = new Float32Array(newNbVertices * 2);
      newUVs.set(oldUVs.subarray(0, oldNbVertices * 2));
    }
    if (oldFacesUV) {
      newFacesUV = new Uint32Array(newNbFaces * 4);
      newFacesUV.set(oldFacesUV.subarray(0, oldNbFaces * 4));
    }

    if (!window.keepExtrudeFacesTogether) {
      // Build Isolated Extrusions
      for (const fIdx of targetFaces) {
        const idf = fIdx * 4;
        const v1 = oldFaces[idf], v2 = oldFaces[idf + 1], v3 = oldFaces[idf + 2], v4 = oldFaces[idf + 3];
        const isQuad = (v4 !== Utils.TRI_INDEX);
        const verts = isQuad ? [v1, v2, v3, v4] : [v1, v2, v3];
        const extrudedVertIds = [];

        for (const oldV of verts) {
          newVertIndices.push(currentVertIdx);
          extrudedVertIds.push(currentVertIdx);
          this._newToOldMap.set(currentVertIdx, oldV);

          newVertices[currentVertIdx * 3] = oldVerts[oldV * 3];
          newVertices[currentVertIdx * 3 + 1] = oldVerts[oldV * 3 + 1];
          newVertices[currentVertIdx * 3 + 2] = oldVerts[oldV * 3 + 2];

          if (newColors) {
            newColors[currentVertIdx * 3] = oldColors[oldV * 3];
            newColors[currentVertIdx * 3 + 1] = oldColors[oldV * 3 + 1];
            newColors[currentVertIdx * 3 + 2] = oldColors[oldV * 3 + 2];
          }
          if (newMats) {
            newMats[currentVertIdx * 3] = oldMats[oldV * 3];
            newMats[currentVertIdx * 3 + 1] = oldMats[oldV * 3 + 1];
            newMats[currentVertIdx * 3 + 2] = oldMats[oldV * 3 + 2];
          }
          if (newUVs) {
            newUVs[currentVertIdx * 2] = oldUVs[oldV * 2];
            newUVs[currentVertIdx * 2 + 1] = oldUVs[oldV * 2 + 1];
          }
          currentVertIdx++;
        }

        // Cap Top Face
        newFaces[idf] = extrudedVertIds[0];
        newFaces[idf + 1] = extrudedVertIds[1];
        newFaces[idf + 2] = extrudedVertIds[2];
        if (isQuad) newFaces[idf + 3] = extrudedVertIds[3];

        // Build Side Walls
        const addWall = (ea, eb, newEb, newEa) => {
          const widf = currentFaceIdx * 4;
          newFaces[widf] = ea;
          newFaces[widf + 1] = eb;
          newFaces[widf + 2] = newEb;
          newFaces[widf + 3] = newEa;
          if (newFacesUV) {
            newFacesUV[widf] = 0; newFacesUV[widf + 1] = 0; newFacesUV[widf + 2] = 0; newFacesUV[widf + 3] = 0;
          }
          currentFaceIdx++;
        };

        addWall(v1, v2, extrudedVertIds[1], extrudedVertIds[0]);
        addWall(v2, v3, extrudedVertIds[2], extrudedVertIds[1]);
        if (isQuad) {
          addWall(v3, v4, extrudedVertIds[3], extrudedVertIds[2]);
          addWall(v4, v1, extrudedVertIds[0], extrudedVertIds[3]);
        } else {
          addWall(v3, v1, extrudedVertIds[0], extrudedVertIds[2]);
        }
      }
    } else {
      // Build Consolidated Deduplicated Bridging
      const vertSet = new Set();
      for (const fIdx of targetFaces) {
        const idf = fIdx * 4;
        vertSet.add(oldFaces[idf]);
        vertSet.add(oldFaces[idf + 1]);
        vertSet.add(oldFaces[idf + 2]);
        if (oldFaces[idf + 3] !== Utils.TRI_INDEX) vertSet.add(oldFaces[idf + 3]);
      }

      const vertMap = new Map(); // oldVert -> newVertIdx
      for (const oldV of vertSet) {
        vertMap.set(oldV, currentVertIdx);
        newVertIndices.push(currentVertIdx);
        this._newToOldMap.set(currentVertIdx, oldV);

        newVertices[currentVertIdx * 3] = oldVerts[oldV * 3];
        newVertices[currentVertIdx * 3 + 1] = oldVerts[oldV * 3 + 1];
        newVertices[currentVertIdx * 3 + 2] = oldVerts[oldV * 3 + 2];

        if (newColors) {
          newColors[currentVertIdx * 3] = oldColors[oldV * 3];
          newColors[currentVertIdx * 3 + 1] = oldColors[oldV * 3 + 1];
          newColors[currentVertIdx * 3 + 2] = oldColors[oldV * 3 + 2];
        }
        if (newMats) {
          newMats[currentVertIdx * 3] = oldMats[oldV * 3];
          newMats[currentVertIdx * 3 + 1] = oldMats[oldV * 3 + 1];
          newMats[currentVertIdx * 3 + 2] = oldMats[oldV * 3 + 2];
        }
        if (newUVs) {
          newUVs[currentVertIdx * 2] = oldUVs[oldV * 2];
          newUVs[currentVertIdx * 2 + 1] = oldUVs[oldV * 2 + 1];
        }
        currentVertIdx++;
      }

      for (const fIdx of targetFaces) {
        const idf = fIdx * 4;
        const v1 = oldFaces[idf], v2 = oldFaces[idf + 1], v3 = oldFaces[idf + 2], v4 = oldFaces[idf + 3];
        newFaces[idf] = vertMap.get(v1);
        newFaces[idf + 1] = vertMap.get(v2);
        newFaces[idf + 2] = vertMap.get(v3);
        if (v4 !== Utils.TRI_INDEX) newFaces[idf + 3] = vertMap.get(v4);
      }

      const edgeCounts = new Map();
      const addEdge = (a, b) => {
        const key = a < b ? `${a}-${b}` : `${b}-${a}`;
        edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
      };
      for (const fIdx of targetFaces) {
        const idf = fIdx * 4;
        const v1 = oldFaces[idf], v2 = oldFaces[idf + 1], v3 = oldFaces[idf + 2], v4 = oldFaces[idf + 3];
        addEdge(v1, v2); addEdge(v2, v3);
        if (v4 !== Utils.TRI_INDEX) {
          addEdge(v3, v4); addEdge(v4, v1);
        } else {
          addEdge(v3, v1);
        }
      }
      for (const fIdx of targetFaces) {
        const idf = fIdx * 4;
        const v1 = oldFaces[idf], v2 = oldFaces[idf + 1], v3 = oldFaces[idf + 2], v4 = oldFaces[idf + 3];
        const checkEdge = (a, b) => {
          const key = a < b ? `${a}-${b}` : `${b}-${a}`;
          if (edgeCounts.get(key) === 1) {
            const newEa = vertMap.get(a);
            const newEb = vertMap.get(b);
            const widf = currentFaceIdx * 4;
            newFaces[widf] = a;
            newFaces[widf + 1] = b;
            newFaces[widf + 2] = newEb;
            newFaces[widf + 3] = newEa;
            if (newFacesUV) {
              newFacesUV[widf] = 0; newFacesUV[widf + 1] = 0; newFacesUV[widf + 2] = 0; newFacesUV[widf + 3] = 0;
            }
            currentFaceIdx++;
          }
        };
        checkEdge(v1, v2); checkEdge(v2, v3);
        if (v4 !== Utils.TRI_INDEX) {
          checkEdge(v3, v4); checkEdge(v4, v1);
        } else {
          checkEdge(v3, v1);
        }
      }
    }

    activeMesh.setFaces(newFaces);
    activeMesh.setNbFaces(newNbFaces);
    activeMesh.setVertices(newVertices);
    activeMesh.setNbVertices(newNbVertices);

    if (newColors) activeMesh.setColors(newColors);
    if (newMats) activeMesh.setMaterials(newMats);
    if (newUVs) activeMesh.setTexCoords(newUVs);
    if (newFacesUV) activeMesh.setFacesTexCoord(newFacesUV);

    // Wireframe cache invalidation & array re-alignment
    if (activeMesh._meshData) {
      activeMesh._meshData._drawElementsWireframe = null;
      activeMesh._meshData._drawArraysWireframe = null;
      activeMesh._meshData._edges = new Uint8ClampedArray(0);
    }

    activeMesh.allocateArrays();
    activeMesh.initTopology();
    activeMesh.updateGeometry();
    activeMesh.updateCenter();
    if (activeMesh._renderData) activeMesh.updateDuplicateColorsAndMaterials();
    activeMesh.updateBuffers();
    activeMesh.initRender();

    // Setup continuous state for 6DOF Follow
    this._extrudedVerts = new Uint32Array(newVertIndices);
    this._vProxy = new Float32Array(this._extrudedVerts.length * 3);
    this._vMirrorState = new Uint8Array(this._extrudedVerts.length);

    // Populate mirror side context
    let eIdx = 0;
    if (!window.keepExtrudeFacesTogether) {
      for (const fIdx of targetFaces) {
        const idf = fIdx * 4;
        const v1 = oldFaces[idf], v2 = oldFaces[idf + 1], v3 = oldFaces[idf + 2], v4 = oldFaces[idf + 3];
        const cx = (oldVerts[v1 * 3] + oldVerts[v2 * 3] + oldVerts[v3 * 3] + (v4 !== Utils.TRI_INDEX ? oldVerts[v4 * 3] : 0)) / (v4 !== Utils.TRI_INDEX ? 4 : 3);
        const isMirr = (cx < -0.01); // Left side mirror face
        const count = (v4 !== Utils.TRI_INDEX ? 4 : 3);
        for (let c = 0; c < count; c++) {
          const idx = this._extrudedVerts[eIdx] * 3;
          this._vProxy[eIdx * 3] = newVertices[idx];
          this._vProxy[eIdx * 3 + 1] = newVertices[idx + 1];
          this._vProxy[eIdx * 3 + 2] = newVertices[idx + 2];
          this._vMirrorState[eIdx] = isMirr ? 1 : 0;
          eIdx++;
        }
      }
    } else {
      for (let i = 0; i < this._extrudedVerts.length; i++) {
        const idx = this._extrudedVerts[i] * 3;
        this._vProxy[i * 3] = newVertices[idx];
        this._vProxy[i * 3 + 1] = newVertices[idx + 1];
        this._vProxy[i * 3 + 2] = newVertices[idx + 2];
        this._vMirrorState[i] = (newVertices[idx] < -0.001) ? 1 : 0;
      }
    }

    // Base anchoring for deltas
    if (main._vrControllerPos) {
      this._lastVRPos = vec3.clone(main._vrControllerPos);
    }
    if (main._vrControllerQuat) {
      quat.copy(this._lastVRQuat, main._vrControllerQuat);
    }


  }

  // WebXR Support for 6DOF Dragging
  updateXR(picking, isPressed, origin, dir, options) {
    const main = this._main;
    
    if (options && options.controllers) {
      const dominantHand = options.handedness;
      const nonDominantHand = dominantHand === 'left' ? 'right' : 'left';
      
      let isSecondaryTriggerPressed = false;
      for (const ctrl of options.controllers) {
        if (ctrl.handedness === nonDominantHand) {
          if (ctrl.buttons && ctrl.buttons[0] && ctrl.buttons[0].pressed) {
            isSecondaryTriggerPressed = true;
          }
          break;
        }
      }
      
      if (isSecondaryTriggerPressed) {
        if (isPressed) {
          const pickedFace = picking.getPickedFace();
          if (pickedFace !== undefined && pickedFace >= 0) {
            if (pickedFace !== this._lastPickedFace) {
              const mesh = this.getMesh();
              const activeMesh = mesh.getCurrentMesh ? mesh.getCurrentMesh() : mesh;
              const symFace = main.getSculptManager().getSymmetry() ? this.getSymmetricalFace(activeMesh, pickedFace) : -1;
              
              if (this._dragSelectMode === 'remove') {
                this._selectedFaces.delete(pickedFace);
                if (symFace !== -1) this._selectedFaces.delete(symFace);
              } else {
                this._selectedFaces.add(pickedFace);
                if (symFace !== -1) this._selectedFaces.add(symFace);
              }
              this.updateSelectionHighlight();
            }
          }
        }
        this.updateRender();
        return;
      }
    }

    if (!isPressed) {
      if (main._vrControllerPos) {
        if (!this._lastVRPos) this._lastVRPos = vec3.create();
        vec3.copy(this._lastVRPos, main._vrControllerPos);
      }
      if (main._vrControllerQuat) {
        quat.copy(this._lastVRQuat, main._vrControllerQuat);
      }
      super.makeStrokeXR(picking, null, false);
      this.updateRender();
      return;
    }

    this.sculptStrokeXR(picking);
  }

  sculptStrokeXR(picking) {
    if (!this._lastVRPos || !this._extrudedVerts || !this._vProxy) return;

    const main = this._main;
    const currentPos = main._vrControllerPos;
    const currentQuat = main._vrControllerQuat;
    if (!currentPos || !currentQuat) return;

    const mesh = this.getMesh();
    if (!mesh) return;

    const mInv = mat4.create();
    mat4.invert(mInv, mesh.getMatrix());

    // Get deltas in local space
    const vStartLocal = vec3.clone(this._lastVRPos);
    vec3.transformMat4(vStartLocal, vStartLocal, mInv);

    const vCurrLocal = vec3.clone(currentPos);
    vec3.transformMat4(vCurrLocal, vCurrLocal, mInv);

    const transDelta = vec3.create();
    vec3.sub(transDelta, vCurrLocal, vStartLocal);

    const isMultiFace = this._selectedFaces && this._selectedFaces.size > 0;

    // Lock to normal only for multi-face
    if (isMultiFace && this._extrudeNormal) {
      const dot = vec3.dot(transDelta, this._extrudeNormal);
      vec3.scale(transDelta, this._extrudeNormal, dot);
    }

    const qMesh = quat.create();
    mat4.getRotation(qMesh, mesh.getMatrix());
    const qMeshInv = quat.create();
    quat.invert(qMeshInv, qMesh);

    const qStartLocal = quat.create();
    quat.multiply(qStartLocal, qMeshInv, this._lastVRQuat);

    const qCurrLocal = quat.create();
    quat.multiply(qCurrLocal, qMeshInv, currentQuat);

    const qDeltaLocal = quat.create();
    const qStartInv = quat.create();
    quat.invert(qStartInv, qStartLocal);
    
    if (!isMultiFace) {
      quat.multiply(qDeltaLocal, qCurrLocal, qStartInv); 
    }

    // Move all extruded vertices
    const vAr = mesh.getVertices();
    const vTemp = vec3.create();

    // Compute center of proxy verts for rotation pivot

    const pivotRight = vec3.create();
    const pivotLeft = vec3.create();
    let countRight = 0;
    let countLeft = 0;

    for (let i = 0; i < this._extrudedVerts.length; i++) {
      if (this._vProxy[i * 3] >= 0) {
        pivotRight[0] += this._vProxy[i * 3];
        pivotRight[1] += this._vProxy[i * 3 + 1];
        pivotRight[2] += this._vProxy[i * 3 + 2];
        countRight++;
      } else {
        pivotLeft[0] += this._vProxy[i * 3];
        pivotLeft[1] += this._vProxy[i * 3 + 1];
        pivotLeft[2] += this._vProxy[i * 3 + 2];
        countLeft++;
      }
    }

    if (countRight > 0) vec3.scale(pivotRight, pivotRight, 1.0 / countRight);
    if (countLeft > 0) vec3.scale(pivotLeft, pivotLeft, 1.0 / countLeft);

    const primaryIsRight = vStartLocal[0] >= 0;

    if (primaryIsRight && countRight > 0) {
      pivotLeft[0] = -pivotRight[0];
      pivotLeft[1] = pivotRight[1];
      pivotLeft[2] = pivotRight[2];
    } else if (!primaryIsRight && countLeft > 0) {
      pivotRight[0] = -pivotLeft[0];
      pivotRight[1] = pivotLeft[1];
      pivotRight[2] = pivotLeft[2];
    }

    for (let i = 0; i < this._extrudedVerts.length; i++) {
      const ind = this._extrudedVerts[i] * 3;
      const isLeft = (this._vMirrorState[i] === 1);
      const isPrimary = primaryIsRight ? !isLeft : isLeft;
      
      const currPivot = isLeft ? pivotLeft : pivotRight;
      
      if (isMultiFace) {
        const newV = this._extrudedVerts[i];
        const oldV = this._newToOldMap ? this._newToOldMap.get(newV) : null;
        const normal = (oldV !== null && this._vertNormals) ? this._vertNormals.get(oldV) : this._extrudeNormal;
        
        const dot = vec3.dot(transDelta, this._extrudeNormal);
        
        vAr[ind] = this._vProxy[i * 3] + normal[0] * dot;
        if (Math.abs(this._vProxy[i * 3]) < 0.001 && window.keepExtrudeFacesTogether) {
          vAr[ind] = 0.0;
        }
        vAr[ind + 1] = this._vProxy[i * 3 + 1] + normal[1] * dot;
        vAr[ind + 2] = this._vProxy[i * 3 + 2] + normal[2] * dot;
      } else {
        const moveX = isPrimary ? transDelta[0] : -transDelta[0];
        
        vTemp[0] = this._vProxy[i * 3] - currPivot[0];
        vTemp[1] = this._vProxy[i * 3 + 1] - currPivot[1];
        vTemp[2] = this._vProxy[i * 3 + 2] - currPivot[2];

        if (!isPrimary) {
          vTemp[0] = -vTemp[0];
          vec3.transformQuat(vTemp, vTemp, qDeltaLocal);
          vTemp[0] = -vTemp[0];
        } else {
          vec3.transformQuat(vTemp, vTemp, qDeltaLocal);
        }

        vAr[ind] = currPivot[0] + vTemp[0] + moveX;
        if (Math.abs(this._vProxy[i * 3]) < 0.001 && window.keepExtrudeFacesTogether) {
          vAr[ind] = 0.0;
        }
        vAr[ind + 1] = currPivot[1] + vTemp[1] + transDelta[1];
        vAr[ind + 2] = currPivot[2] + vTemp[2] + transDelta[2];
      }
    }

    mesh.updateGeometry(mesh.getFacesFromVertices(this._extrudedVerts), this._extrudedVerts);
    this.updateRender();
    this.updateSelectionHighlight();
  }

  sculptStroke() {
    const main = this._main;
    const mesh = this.getMesh();
    if (!mesh || !this._extrudedVerts || !this._vProxy || !this._extrudeNormal) return;

    const activeMesh = mesh.getCurrentMesh ? mesh.getCurrentMesh() : mesh;
    
    // Calculate delta based on mouse Y movement
    const dy = main._mouseY - this._lastMouseY;
    
    // We need a scale factor to map pixels to world space units
    // Let's use a simple scale for now
    const scale = -dy * 0.002; // Negative because moving mouse up usually means extruding OUT
    
    const transDelta = vec3.create();
    vec3.scale(transDelta, this._extrudeNormal, scale);

    const vAr = activeMesh.getVertices();
    
    // Move all extruded vertices along the normal
    for (let i = 0; i < this._extrudedVerts.length; i++) {
      const ind = this._extrudedVerts[i] * 3;
      const isLeft = (this._vMirrorState[i] === 1);
      const isPrimary = this._primaryIsRight ? !isLeft : isLeft;
      const moveX = isPrimary ? transDelta[0] : -transDelta[0];
      
      vAr[ind] = this._vProxy[i * 3] + moveX;
      if (Math.abs(this._vProxy[i * 3]) < 0.001 && window.keepExtrudeFacesTogether) {
        vAr[ind] = 0.0;
      }
      vAr[ind + 1] = this._vProxy[i * 3 + 1] + transDelta[1];
      vAr[ind + 2] = this._vProxy[i * 3 + 2] + transDelta[2];
    }

    activeMesh.updateGeometry(activeMesh.getFacesFromVertices(this._extrudedVerts), this._extrudedVerts);
    this.updateRender();
  }

  end() {
    super.end();
    
    // Retain selection after extrude! Do not clear here.
    
    this._extrudedVerts = null;
    this._vProxy = null;

    const mesh = this.getMesh();
    const activeMesh = mesh ? (mesh.getCurrentMesh ? mesh.getCurrentMesh() : mesh) : null;

    if (window.repairWindingOrders) {
      window.repairWindingOrders();
    }

    if (activeMesh && this._undoSnapshot) {
      const redoSnapshot = {
        faces: new Uint32Array(activeMesh.getFaces().subarray(0, activeMesh.getNbFaces() * 4)),
        vertices: new Float32Array(activeMesh.getVertices().subarray(0, activeMesh.getNbVertices() * 3)),
        colors: activeMesh.getColors() ? new Float32Array(activeMesh.getColors().subarray(0, activeMesh.getNbVertices() * 3)) : null,
        materials: activeMesh.getMaterials() ? new Float32Array(activeMesh.getMaterials().subarray(0, activeMesh.getNbVertices() * 3)) : null,
        facesTexCoord: activeMesh.getFacesTexCoord() ? new Uint32Array(activeMesh.getFacesTexCoord().subarray(0, activeMesh.getNbFaces() * 4)) : null,
        nbFaces: activeMesh.getNbFaces(),
        nbVertices: activeMesh.getNbVertices(),
        selectedFaces: new Set(this._selectedFaces)
      };
      if (activeMesh.getTexCoords()) {
        const nbTex = activeMesh.getNbTexCoords ? activeMesh.getNbTexCoords() : activeMesh.getNbVertices();
        redoSnapshot.texCoords = new Float32Array(activeMesh.getTexCoords().subarray(0, nbTex * 2));
      }
      const snapshotToUndo = this._undoSnapshot;
      const snapshotToRedo = redoSnapshot;
      const undoExtrude = () => {
        Object.getPrototypeOf(this).applyMeshSnapshot.call(this, activeMesh, snapshotToUndo);
        if (snapshotToUndo.selectedFaces) {
          this._selectedFaces = new Set(snapshotToUndo.selectedFaces);
          this.updateSelectionHighlight();
        }
      };
      const redoExtrude = () => {
        Object.getPrototypeOf(this).applyMeshSnapshot.call(this, activeMesh, snapshotToRedo);
        if (snapshotToRedo.selectedFaces) {
          this._selectedFaces = new Set(snapshotToRedo.selectedFaces);
          this.updateSelectionHighlight();
        }
      };
      this._main.getStateManager().pushStateCustom(undoExtrude, redoExtrude);
      this._undoSnapshot = null;
    }
  }
}

export default Extrude;
