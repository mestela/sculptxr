import MeshStatic from '../../mesh/meshStatic/MeshStatic.js';
import Mesh from '../../mesh/Mesh.js';
import Utils from '../../misc/Utils.js';
import SculptBase from './SculptBase.js';
import Geometry from '../../math3d/Geometry.js';

class Weld extends SculptBase {
  constructor(main) {
    super(main);
    this._continuous = false;
    this._sourceVertex = -1;
  }

  start(ctrl) {
    const mesh = this.getMesh();
    if (!mesh) return false;

    const picking = this._main.getPicking();
    const faceIdx = picking.getPickedFace();
    
    if (faceIdx === undefined || faceIdx < 0) {
      console.log("[Weld] Resetting source vertex because nothing was picked.");
      this._sourceVertex = -1;
      return false;
    }

    const inter = picking.getIntersectionPoint(); // local space
    const faces = mesh.getFaces();
    const vertices = mesh.getVertices();

    // Find the closest vertex to the intersection point
    const fid = faceIdx * 4;
    const faceVerts = [faces[fid], faces[fid + 1], faces[fid + 2]];
    if (faces[fid + 3] !== Utils.TRI_INDEX) faceVerts.push(faces[fid + 3]);

    let minDistSq = Infinity;
    let closestVert = -1;

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

    if (closestVert === -1) return false;

    if (this._sourceVertex === -1) {
      this._sourceVertex = closestVert;
      console.log(`[Weld] Step 1: Selected Source Vertex ${closestVert}. Click another one to weld!`);
      if (this._main.getNotification) {
        this._main.getNotification().show(`Source vertex ${closestVert} selected. Click target vertex to weld!`);
      }
      return true; // Don't push to history yet, just save state!
    }

    const targetVert = closestVert;
    if (targetVert === this._sourceVertex) {
      console.log("[Weld] Target is equal to source. Reset.");
      this._sourceVertex = -1;
      if (this._main.getNotification) {
        this._main.getNotification().show(`Selection reset.`);
      }
      return false;
    }

    console.log(`[Weld] Step 2: Target Vertex ${targetVert} picked! Welding ${this._sourceVertex} into ${targetVert}.`);

    const source = this._sourceVertex;
    const target = targetVert;
    this._sourceVertex = -1; // Reset for next run

    let sourceRefCount = 0;
    for (let i = 0; i < faces.length; ++i) {
      if (faces[i] === source) sourceRefCount++;
    }
    console.log(`[Weld] Source vertex ${source} is referenced by ${sourceRefCount} face corners.`);

    const newFaces = [];
    const undoFaces = new Uint32Array(faces);

    for (let i = 0; i < faces.length; i += 4) {
      let v1 = faces[i];
      let v2 = faces[i + 1];
      let v3 = faces[i + 2];
      let v4 = faces[i + 3];

      let activeCount = 0;
      if (v1 !== Utils.TRI_INDEX) activeCount++;
      if (v2 !== Utils.TRI_INDEX) activeCount++;
      if (v3 !== Utils.TRI_INDEX) activeCount++;
      if (v4 !== Utils.TRI_INDEX) activeCount++;

      const hasS = (v1===source || v2===source || v3===source || v4===source);
      const hasT = (v1===target || v2===target || v3===target || v4===target);

      if (hasS && hasT) {
        if (activeCount === 3) {
          continue; // Delete degenerate face
        }
        if (activeCount === 4) {
          let nextV = [];
          if (v1 !== source && v1 !== Utils.TRI_INDEX) nextV.push(v1);
          if (v2 !== source && v2 !== Utils.TRI_INDEX) nextV.push(v2);
          if (v3 !== source && v3 !== Utils.TRI_INDEX) nextV.push(v3);
          if (v4 !== source && v4 !== Utils.TRI_INDEX) nextV.push(v4);
          
          if (!nextV.includes(target)) nextV.push(target); 
          
          newFaces.push(nextV[0], nextV[1], nextV[2], Utils.TRI_INDEX);
          continue;
        }
      }

      if (hasS) {
        if (v1 === source) v1 = target;
        if (v2 === source) v2 = target;
        if (v3 === source) v3 = target;
        if (v4 === source) v4 = target;
      }

      newFaces.push(v1, v2, v3, v4);
    }

    const typedFaces = new Uint32Array(newFaces);
    
    const activeMesh = mesh.getCurrentMesh ? mesh.getCurrentMesh() : mesh;

    console.log("[Weld] Capturing undo snapshot...");
    const undoSnapshot = this.captureMeshSnapshot(activeMesh);

    activeMesh.setFaces(typedFaces);
    activeMesh.setNbFaces(typedFaces.length / 4);

    // Safety check: Ensure texCoordsST is at least as large as nbVertices to prevent RangeError in allocateArrays!
    if (activeMesh.hasUV()) {
      const nbVerts = activeMesh.getNbVertices();
      const nbTex = activeMesh.getTexCoords().length / 2;
      if (nbVerts > nbTex) {
        console.log(`[Weld] Safety resizing texCoordsST from ${nbTex} to ${nbVerts}`);
        const newTex = new Float32Array(nbVerts * 2);
        newTex.set(activeMesh.getTexCoords());
        activeMesh.setTexCoords(newTex);
      }
    }

    console.log(`[Weld] Faces count changed from ${faces.length / 4} to ${typedFaces.length / 4}`);

    activeMesh.allocateArrays();
    activeMesh.initTopology();
    activeMesh.updateGeometry();
    activeMesh.updateCenter();
    activeMesh.updateDuplicateColorsAndMaterials();
    
    // Clear wireframe caches
    if (activeMesh._meshData) {
      activeMesh._meshData._drawElementsWireframe = null;
      activeMesh._meshData._drawArraysWireframe = null;
    }
    
    if (activeMesh.updateBuffers) activeMesh.updateBuffers();
    else if (activeMesh.initRender) activeMesh.initRender();

    const redoSnapshot = this.captureMeshSnapshot(activeMesh);

    const undoWeld = () => {
      console.log(`[Weld] undoWeld EXECUTE`);
      this.applyMeshSnapshot(activeMesh, undoSnapshot);
    };

    const redoWeld = () => {
      console.log(`[Weld] redoWeld EXECUTE`);
      this.applyMeshSnapshot(activeMesh, redoSnapshot);
    };

    this._main.getStateManager().pushStateCustom(undoWeld, redoWeld);
    
    if (this._main.getNotification) {
      this._main.getNotification().show(`Welded ${source} to ${target}!`);
    } else {
      console.log(`[Weld] Complete: Welded ${source} to ${target}!`);
    }
    return true;
  }

  stroke(picking) {
  }
}

export default Weld;
