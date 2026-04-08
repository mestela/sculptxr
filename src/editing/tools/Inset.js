import { vec3, mat4 } from 'gl-matrix';
import Geometry from '../../math3d/Geometry.js';
import SculptBase from './SculptBase.js';
import Utils from '../../misc/Utils.js';

class Inset extends SculptBase {
  constructor(main) {
    super(main);
    this._continuous = true;
    this._insetVerts = null;
    this._vProxy = null;
    this._faceCenters = null;
    this._faceNormals = null;
    this._lastVRPos = null;
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

    this._undoSnapshot = this.captureMeshSnapshot(activeMesh);

    const oldNbVertices = activeMesh.getNbVertices();
    const oldNbFaces = activeMesh.getNbFaces();
    const oldFaces = activeMesh.getFaces();
    const oldVerts = activeMesh.getVertices();
    const oldColors = activeMesh.getColors();
    const oldMats = activeMesh.getMaterials();
    const oldUVs = activeMesh.getTexCoords();
    const oldFacesUV = activeMesh.getFacesTexCoord();

    // Find all outer boundary edges around target faces
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

    const boundaryEdges = [];
    for (const fIdx of targetFaces) {
      const idf = fIdx * 4;
      const v1 = oldFaces[idf], v2 = oldFaces[idf + 1], v3 = oldFaces[idf + 2], v4 = oldFaces[idf + 3];
      const checkEdge = (a, b) => {
        const key = a < b ? `${a}-${b}` : `${b}-${a}`;
        if (edgeCounts.get(key) === 1) boundaryEdges.push([a, b]);
      };
      checkEdge(v1, v2); checkEdge(v2, v3);
      if (v4 !== Utils.TRI_INDEX) {
        checkEdge(v3, v4); checkEdge(v4, v1);
      } else {
        checkEdge(v3, v1);
      }
    }

    // Collect unique boundary vertices
    const vertSet = new Set();
    for (const [ea, eb] of boundaryEdges) {
      vertSet.add(ea);
      vertSet.add(eb);
    }

    const numNewVerts = vertSet.size;
    const numNewFaces = boundaryEdges.length;

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

    // Compute average center and normal of inset group
    const center = vec3.create();
    const normal = vec3.create();
    const v1 = vec3.create(), v2 = vec3.create(), v3 = vec3.create();
    
    for (const oldV of vertSet) {
      center[0] += oldVerts[oldV * 3];
      center[1] += oldVerts[oldV * 3 + 1];
      center[2] += oldVerts[oldV * 3 + 2];
    }
    vec3.scale(center, center, 1 / vertSet.size);

    for (const fIdx of targetFaces) {
      const idf = fIdx * 4;
      v1[0] = oldVerts[oldFaces[idf] * 3]; v1[1] = oldVerts[oldFaces[idf] * 3 + 1]; v1[2] = oldVerts[oldFaces[idf] * 3 + 2];
      v2[0] = oldVerts[oldFaces[idf + 1] * 3]; v2[1] = oldVerts[oldFaces[idf + 1] * 3 + 1]; v2[2] = oldVerts[oldFaces[idf + 1] * 3 + 2];
      v3[0] = oldVerts[oldFaces[idf + 2] * 3]; v3[1] = oldVerts[oldFaces[idf + 2] * 3 + 1]; v3[2] = oldVerts[oldFaces[idf + 2] * 3 + 2];
      
      const cb = vec3.create(), ab = vec3.create(), cross = vec3.create();
      vec3.sub(cb, v3, v2);
      vec3.sub(ab, v1, v2);
      vec3.cross(cross, cb, ab);
      vec3.normalize(cross, cross);
      vec3.add(normal, normal, cross);
    }
    vec3.normalize(normal, normal);

    // Populate inset vertices (scaled slightly towards center to start)
    const vertMap = new Map();
    let currentVertIdx = oldNbVertices;
    const newVertIndices = [];

    for (const oldV of vertSet) {
      vertMap.set(oldV, currentVertIdx);
      newVertIndices.push(currentVertIdx);

      const origX = oldVerts[oldV * 3];
      const origY = oldVerts[oldV * 3 + 1];
      const origZ = oldVerts[oldV * 3 + 2];

      // Start slightly inset
      newVertices[currentVertIdx * 3] = origX + (center[0] - origX) * 0.1;
      newVertices[currentVertIdx * 3 + 1] = origY + (center[1] - origY) * 0.1;
      newVertices[currentVertIdx * 3 + 2] = origZ + (center[2] - origZ) * 0.1;

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

    // Update target faces to point to new inset ring
    for (const fIdx of targetFaces) {
      const idf = fIdx * 4;
      const a = oldFaces[idf], b = oldFaces[idf + 1], c = oldFaces[idf + 2], d = oldFaces[idf + 3];
      if (vertMap.has(a)) newFaces[idf] = vertMap.get(a);
      if (vertMap.has(b)) newFaces[idf + 1] = vertMap.get(b);
      if (vertMap.has(c)) newFaces[idf + 2] = vertMap.get(c);
      if (d !== Utils.TRI_INDEX && vertMap.has(d)) newFaces[idf + 3] = vertMap.get(d);
    }

    // Connect outer boundary to inner inset loop
    let currentFaceIdx = oldNbFaces;
    for (const [ea, eb] of boundaryEdges) {
      const newEa = vertMap.get(ea);
      const newEb = vertMap.get(eb);

      const idf = currentFaceIdx * 4;
      newFaces[idf] = ea;
      newFaces[idf + 1] = eb;
      newFaces[idf + 2] = newEb;
      newFaces[idf + 3] = newEa;

      if (newFacesUV) {
        newFacesUV[idf] = 0;
        newFacesUV[idf + 1] = 0;
        newFacesUV[idf + 2] = 0;
        newFacesUV[idf + 3] = 0;
      }

      currentFaceIdx++;
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
      activeMesh._drawArraysWireframe = null;
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
    for (let i = 0; i < this._insetVerts.length; i++) {
      const idx = this._insetVerts[i] * 3;
      this._vProxy[i * 3] = newVertices[idx];
      this._vProxy[i * 3 + 1] = newVertices[idx + 1];
      this._vProxy[i * 3 + 2] = newVertices[idx + 2];
    }

    this._center = center;
    this._normal = normal;

    if (main._vrControllerPos) {
      this._lastVRPos = vec3.clone(main._vrControllerPos);
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

  sculptStrokeXR(picking) {
    if (!this._lastVRPos || !this._insetVerts || !this._vProxy) return;

    const main = this._main;
    const currentPos = main._vrControllerPos;
    if (!currentPos) return;

    const mesh = this.getMesh();
    if (!mesh) return;

    const mInv = mat4.create();
    mat4.invert(mInv, mesh.getMatrix());

    const vStartLocal = vec3.clone(this._lastVRPos);
    vec3.transformMat4(vStartLocal, vStartLocal, mInv);

    const vCurrLocal = vec3.clone(currentPos);
    vec3.transformMat4(vCurrLocal, vCurrLocal, mInv);

    const transDelta = vec3.create();
    vec3.sub(transDelta, vCurrLocal, vStartLocal);

    // Movement along face normal drives inset amount
    const insetDist = vec3.dot(transDelta, this._normal);
    // Map controller distance along normal to an inset scale [0..1]
    // Moving forward shrinks the face, moving backward keeps/reverts it
    let scale = 0.1 + insetDist * 2.0;
    scale = Math.max(0.01, Math.min(0.99, scale));

    const vAr = mesh.getVertices();
    for (let i = 0; i < this._insetVerts.length; i++) {
      const ind = this._insetVerts[i] * 3;
      const origX = this._vProxy[i * 3];
      const origY = this._vProxy[i * 3 + 1];
      const origZ = this._vProxy[i * 3 + 2];

      vAr[ind] = origX + (this._center[0] - origX) * scale;
      vAr[ind + 1] = origY + (this._center[1] - origY) * scale;
      vAr[ind + 2] = origZ + (this._center[2] - origZ) * scale;
    }

    mesh.updateGeometry(mesh.getFacesFromVertices(this._insetVerts), this._insetVerts);
    this.updateRender();
  }

  end() {
    super.end();
    this._insetVerts = null;
    this._vProxy = null;

    const mesh = this.getMesh();
    const activeMesh = mesh ? (mesh.getCurrentMesh ? mesh.getCurrentMesh() : mesh) : null;
    if (activeMesh && this._undoSnapshot) {
      const redoSnapshot = this.captureMeshSnapshot(activeMesh);
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
