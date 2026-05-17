import { vec3, mat4 } from 'gl-matrix';
import Geometry from '../../math3d/Geometry.js';
import SculptBase from './SculptBase.js';
import Utils from '../../misc/Utils.js';
import * as THREE from 'three';

class Inset extends SculptBase {
  constructor(main) {
    super(main);
    this._continuous = true;
    this._insetVerts = null;
    this._vProxy = null;
    this._vTarget = null;
    this._lastVRPos = null;
    if (window.keepExtrudeFacesTogether === undefined) {
      window.keepExtrudeFacesTogether = true;
    }
  }

  pushState() {
    // Disabled: Exclusively use the single custom state snapshot in end().
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
    if (pickedFaceIdx === undefined || pickedFaceIdx < 0) {
      return;
    }

    // Determine faces to inset (mask-aware: all completely unmasked faces, or just nearest if none masked)
    const targetFaces = [];
    const materials = activeMesh.getMaterials();
    const faces = activeMesh.getFaces();
    let useMaskGroup = false;

    if (materials) {
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

    if (!useMaskGroup || targetFaces.length === 0) {
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
        
        if (bestF !== -1 && bestDist < 0.001) {
          targetFaces.push(bestF);
        }
      }
    }

    // Snapshot undo/redo
    this._undoSnapshot = {
      faces: new Uint32Array(activeMesh.getFaces().subarray(0, activeMesh.getNbFaces() * 4)),
      vertices: new Float32Array(activeMesh.getVertices().subarray(0, activeMesh.getNbVertices() * 3)),
      colors: activeMesh.getColors() ? new Float32Array(activeMesh.getColors().subarray(0, activeMesh.getNbVertices() * 3)) : null,
      materials: activeMesh.getMaterials() ? new Float32Array(activeMesh.getMaterials().subarray(0, activeMesh.getNbVertices() * 3)) : null,
      facesTexCoord: activeMesh.getFacesTexCoord() ? new Uint32Array(activeMesh.getFacesTexCoord().subarray(0, activeMesh.getNbFaces() * 4)) : null,
      nbFaces: activeMesh.getNbFaces(),
      nbVertices: activeMesh.getNbVertices()
    };
    if (activeMesh.getTexCoords()) {
      const nbTex = activeMesh.getNbTexCoords ? activeMesh.getNbTexCoords() : activeMesh.getNbVertices();
      this._undoSnapshot.texCoords = new Float32Array(activeMesh.getTexCoords().subarray(0, nbTex * 2));
    }

    const oldNbVertices = activeMesh.getNbVertices();
    const oldNbFaces = activeMesh.getNbFaces();
    const oldFaces = activeMesh.getFaces();
    const oldVerts = activeMesh.getVertices();
    const oldColors = activeMesh.getColors();
    const oldMats = activeMesh.getMaterials();
    const oldUVs = activeMesh.getTexCoords();
    const oldFacesUV = activeMesh.getFacesTexCoord();

    let numNewVerts = 0;
    let numNewFaces = 0;

    if (!window.keepExtrudeFacesTogether) {
      for (const fIdx of targetFaces) {
        const idf = fIdx * 4;
        numNewVerts += (oldFaces[idf + 3] !== Utils.TRI_INDEX) ? 4 : 3;
        numNewFaces += (oldFaces[idf + 3] !== Utils.TRI_INDEX) ? 4 : 3;
      }
    } else {
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

    const newVertIndices = [];
    let currentVertIdx = oldNbVertices;
    let currentFaceIdx = oldNbFaces;

    if (!window.keepExtrudeFacesTogether) {
      for (const fIdx of targetFaces) {
        const idf = fIdx * 4;
        const v1 = oldFaces[idf], v2 = oldFaces[idf + 1], v3 = oldFaces[idf + 2], v4 = oldFaces[idf + 3];
        const isQuad = (v4 !== Utils.TRI_INDEX);
        const verts = isQuad ? [v1, v2, v3, v4] : [v1, v2, v3];
        const insetVertIds = [];

        for (const oldV of verts) {
          newVertIndices.push(currentVertIdx);
          insetVertIds.push(currentVertIdx);

          // Start exactly at original position (0 inset)
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

        // Point original face to the new inner ring
        newFaces[idf] = insetVertIds[0];
        newFaces[idf + 1] = insetVertIds[1];
        newFaces[idf + 2] = insetVertIds[2];
        if (isQuad) newFaces[idf + 3] = insetVertIds[3];

        // Build side walls connecting outer ring to inner ring
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

        addWall(v1, v2, insetVertIds[1], insetVertIds[0]);
        addWall(v2, v3, insetVertIds[2], insetVertIds[1]);
        if (isQuad) {
          addWall(v3, v4, insetVertIds[3], insetVertIds[2]);
          addWall(v4, v1, insetVertIds[0], insetVertIds[3]);
        } else {
          addWall(v3, v1, insetVertIds[0], insetVertIds[2]);
        }
      }
    } else {
      const vertSet = new Set();
      for (const fIdx of targetFaces) {
        const idf = fIdx * 4;
        vertSet.add(oldFaces[idf]);
        vertSet.add(oldFaces[idf + 1]);
        vertSet.add(oldFaces[idf + 2]);
        if (oldFaces[idf + 3] !== Utils.TRI_INDEX) vertSet.add(oldFaces[idf + 3]);
      }

      const vertMap = new Map();
      for (const oldV of vertSet) {
        vertMap.set(oldV, currentVertIdx);
        newVertIndices.push(currentVertIdx);

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

    this._insetVerts = new Uint32Array(newVertIndices);
    this._vProxy = new Float32Array(this._insetVerts.length * 3);
    this._vTarget = new Float32Array(this._insetVerts.length * 3);

    let eIdx = 0;
    if (!window.keepExtrudeFacesTogether) {
      for (const fIdx of targetFaces) {
        const idf = fIdx * 4;
        const v1 = oldFaces[idf], v2 = oldFaces[idf + 1], v3 = oldFaces[idf + 2], v4 = oldFaces[idf + 3];
        const isQuad = v4 !== Utils.TRI_INDEX;
        const count = isQuad ? 4 : 3;

        const cx = (oldVerts[v1 * 3] + oldVerts[v2 * 3] + oldVerts[v3 * 3] + (isQuad ? oldVerts[v4 * 3] : 0)) / count;
        const cy = (oldVerts[v1 * 3 + 1] + oldVerts[v2 * 3 + 1] + oldVerts[v3 * 3 + 1] + (isQuad ? oldVerts[v4 * 3 + 1] : 0)) / count;
        const cz = (oldVerts[v1 * 3 + 2] + oldVerts[v2 * 3 + 2] + oldVerts[v3 * 3 + 2] + (isQuad ? oldVerts[v4 * 3 + 2] : 0)) / count;

        for (let c = 0; c < count; c++) {
          const idx = this._insetVerts[eIdx] * 3;
          this._vProxy[eIdx * 3] = newVertices[idx];
          this._vProxy[eIdx * 3 + 1] = newVertices[idx + 1];
          this._vProxy[eIdx * 3 + 2] = newVertices[idx + 2];

          this._vTarget[eIdx * 3] = cx - newVertices[idx];
          this._vTarget[eIdx * 3 + 1] = cy - newVertices[idx + 1];
          this._vTarget[eIdx * 3 + 2] = cz - newVertices[idx + 2];

          eIdx++;
        }
      }
    } else {
      const targetAccum = new Map();
      const countAccum = new Map();

      for (const fIdx of targetFaces) {
        const idf = fIdx * 4;
        const v1 = oldFaces[idf], v2 = oldFaces[idf + 1], v3 = oldFaces[idf + 2], v4 = oldFaces[idf + 3];
        const isQuad = v4 !== Utils.TRI_INDEX;
        const count = isQuad ? 4 : 3;

        const cx = (oldVerts[v1 * 3] + oldVerts[v2 * 3] + oldVerts[v3 * 3] + (isQuad ? oldVerts[v4 * 3] : 0)) / count;
        const cy = (oldVerts[v1 * 3 + 1] + oldVerts[v2 * 3 + 1] + oldVerts[v3 * 3 + 1] + (isQuad ? oldVerts[v4 * 3 + 1] : 0)) / count;
        const cz = (oldVerts[v1 * 3 + 2] + oldVerts[v2 * 3 + 2] + oldVerts[v3 * 3 + 2] + (isQuad ? oldVerts[v4 * 3 + 2] : 0)) / count;

        const verts = isQuad ? [v1, v2, v3, v4] : [v1, v2, v3];
        for (const oldV of verts) {
          if (!targetAccum.has(oldV)) {
            targetAccum.set(oldV, [0, 0, 0]);
            countAccum.set(oldV, 0);
          }
          const tArr = targetAccum.get(oldV);
          tArr[0] += cx - oldVerts[oldV * 3];
          tArr[1] += cy - oldVerts[oldV * 3 + 1];
          tArr[2] += cz - oldVerts[oldV * 3 + 2];
          countAccum.set(oldV, countAccum.get(oldV) + 1);
        }
      }

      for (let i = 0; i < this._insetVerts.length; i++) {
        const idx = this._insetVerts[i] * 3;
        this._vProxy[i * 3] = newVertices[idx];
        this._vProxy[i * 3 + 1] = newVertices[idx + 1];
        this._vProxy[i * 3 + 2] = newVertices[idx + 2];

        const vx = newVertices[idx], vy = newVertices[idx + 1], vz = newVertices[idx + 2];
        let bestV = -1, bestDist = Infinity;
        for (const [oldV, tArr] of targetAccum.entries()) {
          const dx = oldVerts[oldV * 3] - vx;
          const dy = oldVerts[oldV * 3 + 1] - vy;
          const dz = oldVerts[oldV * 3 + 2] - vz;
          const dist = dx * dx + dy * dy + dz * dz;
          if (dist < bestDist) {
            bestDist = dist;
            bestV = oldV;
          }
        }

        if (bestV !== -1) {
          const count = countAccum.get(bestV);
          const tArr = targetAccum.get(bestV);
          this._vTarget[i * 3] = tArr[0] / count;
          this._vTarget[i * 3 + 1] = tArr[1] / count;
          this._vTarget[i * 3 + 2] = tArr[2] / count;
        }
      }
    }

    if (main._vrControllerPos) {
      this._lastVRPos = vec3.clone(main._vrControllerPos);
    }

    const hitPoint = picking.getIntersectionPoint();
    if (hitPoint) {
      const worldPos = [0, 0, 0];
      const mat = activeMesh.getMatrix();
      vec3.transformMat4(worldPos, hitPoint, mat);

      if (!this._clickSphere) {
        const geom = new THREE.SphereGeometry(0.2, 8, 8);
        const mat = new THREE.MeshBasicMaterial({
          color: 0xffff00,
          depthTest: false,
          transparent: true,
          depthWrite: false,
          opacity: 0.8
        });
        this._clickSphere = new THREE.Mesh(geom, mat);
        this._clickSphere.renderOrder = 9999;
        this._clickSphere.isPickable = false;

        const sceneApp = main.getScene ? main.getScene() : main._scene;
        const targetScene = (sceneApp && sceneApp._scene) ? sceneApp._scene : sceneApp;
        const parentNode = main._worldGroup ? main._worldGroup : targetScene;
        if (parentNode) parentNode.add(this._clickSphere);
      }
      this._clickSphere.position.set(worldPos[0], worldPos[1], worldPos[2]);
      this._clickSphere.visible = true;
    }
  }

  updateXR(picking, isPressed) {
    const main = this._main;
    if (!isPressed) {
      if (main._vrControllerPos) {
        if (!this._lastVRPos) this._lastVRPos = vec3.create();
        vec3.copy(this._lastVRPos, main._vrControllerPos);
      }
      super.makeStrokeXR(picking, null, false);
      this.updateRender();
      return;
    }

    this.sculptStrokeXR(picking);
  }

  sculptStroke() {
    const main = this._main;
    const mesh = this.getMesh();
    if (!mesh || !this._insetVerts || !this._vProxy || !this._vTarget) return;

    const activeMesh = mesh.getCurrentMesh ? mesh.getCurrentMesh() : mesh;
    
    // Calculate delta based on mouse Y movement
    const dy = main._mouseY - this._lastMouseY;
    
    // Negative because moving mouse up usually means insetting IN
    const scale = Math.min(0.99, Math.max(0, -dy * 0.002)); 
    
    const vAr = activeMesh.getVertices();
    for (let i = 0; i < this._insetVerts.length; i++) {
      const ind = this._insetVerts[i] * 3;
      vAr[ind] = this._vProxy[i * 3] + this._vTarget[i * 3] * scale;
      vAr[ind + 1] = this._vProxy[i * 3 + 1] + this._vTarget[i * 3 + 1] * scale;
      vAr[ind + 2] = this._vProxy[i * 3 + 2] + this._vTarget[i * 3 + 2] * scale;
    }

    activeMesh.updateGeometry(activeMesh.getFacesFromVertices(this._insetVerts), this._insetVerts);
    this.updateRender();
  }

  sculptStrokeXR(picking) {
    if (!this._lastVRPos || !this._insetVerts || !this._vProxy) return;

    const main = this._main;
    const currentPos = main._vrControllerPos;
    if (!currentPos) return;

    const mesh = this.getMesh();
    if (!mesh) return;

    const dist = vec3.distance(currentPos, this._lastVRPos);
    const scale = Math.min(0.99, dist * 0.1);

    const vAr = mesh.getVertices();
    for (let i = 0; i < this._insetVerts.length; i++) {
      const ind = this._insetVerts[i] * 3;
      vAr[ind] = this._vProxy[i * 3] + this._vTarget[i * 3] * scale;
      vAr[ind + 1] = this._vProxy[i * 3 + 1] + this._vTarget[i * 3 + 1] * scale;
      vAr[ind + 2] = this._vProxy[i * 3 + 2] + this._vTarget[i * 3 + 2] * scale;
    }

    mesh.updateGeometry(mesh.getFacesFromVertices(this._insetVerts), this._insetVerts);
    this.updateRender();
  }

  clearPreview() {
    if (this._clickSphere) {
      this._clickSphere.removeFromParent();
      this._clickSphere.geometry.dispose();
      this._clickSphere.material.dispose();
      this._clickSphere = null;
    }
  }

  end() {
    super.end();
    this._insetVerts = null;
    this._vProxy = null;
    this._vTarget = null;

    if (this._clickSphere) {
      this._clickSphere.visible = false;
    }

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
        nbVertices: activeMesh.getNbVertices()
      };
      if (activeMesh.getTexCoords()) {
        const nbTex = activeMesh.getNbTexCoords ? activeMesh.getNbTexCoords() : activeMesh.getNbVertices();
        redoSnapshot.texCoords = new Float32Array(activeMesh.getTexCoords().subarray(0, nbTex * 2));
      }
      const snapshotToUndo = this._undoSnapshot;
      const snapshotToRedo = redoSnapshot;
      const undoInset = () => Object.getPrototypeOf(this).applyMeshSnapshot.call(this, activeMesh, snapshotToUndo);
      const redoInset = () => Object.getPrototypeOf(this).applyMeshSnapshot.call(this, activeMesh, snapshotToRedo);
      this._main.getStateManager().pushStateCustom(undoInset, redoInset);
      this._undoSnapshot = null;
    }
  }
}

export default Inset;
