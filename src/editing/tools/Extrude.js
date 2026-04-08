import { vec3, mat4, quat } from 'gl-matrix';
import Geometry from '../../math3d/Geometry.js';
import SculptBase from './SculptBase.js';
import Utils from '../../misc/Utils.js';

class Extrude extends SculptBase {
  constructor(main) {
    super(main);
    this._continuous = true;
    this._extrudedVerts = null; 
    this._vProxy = null;
    this._lastVRPos = null;
    this._lastVRQuat = quat.create();
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

    // Determine faces to extrude (mask-aware: all completely unmasked faces, or just nearest if none masked)
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

    // Low-poly standards: Snapshot based undo
    this._undoSnapshot = this.captureMeshSnapshot(activeMesh);

    // Duplication/Extrusion Logic
    const oldNbVertices = activeMesh.getNbVertices();
    const oldNbFaces = activeMesh.getNbFaces();
    const oldFaces = activeMesh.getFaces();
    const oldVerts = activeMesh.getVertices();
    const oldColors = activeMesh.getColors();
    const oldMats = activeMesh.getMaterials();
    const oldUVs = activeMesh.getTexCoords();
    const oldFacesUV = activeMesh.getFacesTexCoord();

    const vertSet = new Set();
    for (const fIdx of targetFaces) {
      const idf = fIdx * 4;
      vertSet.add(oldFaces[idf]);
      vertSet.add(oldFaces[idf + 1]);
      vertSet.add(oldFaces[idf + 2]);
      if (oldFaces[idf + 3] !== Utils.TRI_INDEX) vertSet.add(oldFaces[idf + 3]);
    }

    const numNewVerts = vertSet.size;
    const vertMap = new Map(); // oldVert -> newVertIdx
    let currentVertIdx = oldNbVertices;

    // Create side faces (quads around boundary edges)
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

    const numNewFaces = boundaryEdges.length;

    // Allocate grown arrays
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

    // Populate duplicated vertices
    const newVertIndices = [];
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

    // Cap original faces with duplicated extruded vertices
    for (const fIdx of targetFaces) {
      const idf = fIdx * 4;
      const v1 = oldFaces[idf], v2 = oldFaces[idf + 1], v3 = oldFaces[idf + 2], v4 = oldFaces[idf + 3];
      newFaces[idf] = vertMap.get(v1);
      newFaces[idf + 1] = vertMap.get(v2);
      newFaces[idf + 2] = vertMap.get(v3);
      if (v4 !== Utils.TRI_INDEX) newFaces[idf + 3] = vertMap.get(v4);
    }

    // Create side wall faces
    let currentFaceIdx = oldNbFaces;
    for (const [ea, eb] of boundaryEdges) {
      // Quad connecting original ea, eb, and extruded newEb, newEa
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
    for (let i = 0; i < this._extrudedVerts.length; i++) {
      const idx = this._extrudedVerts[i] * 3;
      this._vProxy[i * 3] = newVertices[idx];
      this._vProxy[i * 3 + 1] = newVertices[idx + 1];
      this._vProxy[i * 3 + 2] = newVertices[idx + 2];
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
  updateXR(picking, isPressed) {
    const main = this._main;
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
    quat.multiply(qDeltaLocal, qCurrLocal, qStartInv);

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

    const clickX = this._lastVRPos ? this._lastVRPos[0] : 1;
    const primarySign = clickX >= 0 ? 1 : -1;
    const pivot = clickX >= 0 ? pivotRight : pivotLeft;
    const centerMirror = clickX >= 0 ? pivotLeft : pivotRight;

    for (let i = 0; i < this._extrudedVerts.length; i++) {
      const ind = this._extrudedVerts[i] * 3;
      const signX = Math.sign(this._vProxy[i * 3]) || 1;
      const isMirror = (signX !== primarySign);
      
      const currPivot = isMirror ? centerMirror : pivot;
      const moveX = isMirror ? -transDelta[0] : transDelta[0];
      
      vTemp[0] = this._vProxy[i * 3] - currPivot[0];
      vTemp[1] = this._vProxy[i * 3 + 1] - currPivot[1];
      vTemp[2] = this._vProxy[i * 3 + 2] - currPivot[2];

      if (isMirror) {
        vTemp[0] = -vTemp[0]; // Map pre-rotation coordinate precisely into primary side space
        vec3.transformQuat(vTemp, vTemp, qDeltaLocal); // Perform the exact standard primary rotation arc
        vTemp[0] = -vTemp[0]; // Mirror the resulting rotated coordinate back to the left side
      } else {
        vec3.transformQuat(vTemp, vTemp, qDeltaLocal);
      }

      vAr[ind] = currPivot[0] + vTemp[0] + moveX;
      vAr[ind + 1] = currPivot[1] + vTemp[1] + transDelta[1];
      vAr[ind + 2] = currPivot[2] + vTemp[2] + transDelta[2];
    }

    mesh.updateGeometry(mesh.getFacesFromVertices(this._extrudedVerts), this._extrudedVerts);
    this.updateRender();
  }

  end() {
    super.end();
    this._extrudedVerts = null;
    this._vProxy = null;

    const mesh = this.getMesh();
    const activeMesh = mesh ? (mesh.getCurrentMesh ? mesh.getCurrentMesh() : mesh) : null;
    if (activeMesh && this._undoSnapshot) {
      const redoSnapshot = this.captureMeshSnapshot(activeMesh);
      const snapshotToUndo = this._undoSnapshot;
      const snapshotToRedo = redoSnapshot;
      const undoExtrude = () => Object.getPrototypeOf(this).applyMeshSnapshot.call(this, activeMesh, snapshotToUndo);
      const redoExtrude = () => Object.getPrototypeOf(this).applyMeshSnapshot.call(this, activeMesh, snapshotToRedo);
      this._main.getStateManager().pushStateCustom(undoExtrude, redoExtrude);
      this._undoSnapshot = null;
    }
  }
}

export default Extrude;
