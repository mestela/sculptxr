import Mesh from '../Mesh.js';
import TransformData from '../TransformData.js';
import MeshData from '../MeshData.js';
import RenderData from '../RenderData.js';
import Enums from '../../misc/Enums.js';
import Utils from '../../misc/Utils.js';

// v0.7.457: Force Reload
class MeshStatic extends Mesh {

  constructor(gl) {
    super();

    this._id = Mesh.ID++; // useful id to retrieve a mesh (dynamic mesh, multires mesh, voxel mesh)

    if (gl) this._renderData = new RenderData(gl, this);
    this._meshData = new MeshData();
    this._transformData = new TransformData();
  }

  getWireframe() {
    if (this._isVoxel && this._wireframe) return this._wireframe;
    return super.getWireframe();
  }

  getRenderNbEdges() {
    if (this._isVoxel && this._wireframe) return this._wireframe.length / 2;
    return super.getRenderNbEdges();
  }

  getRenderNbVertices() {
    if (this._isVoxel) return this.getNbFaces() * 6; // Accounts for quads (2 tris per face)
    return super.getRenderNbVertices();
  }

  getNbTriangles() {
    if (this._isVoxel) return this.getNbFaces() * 2; // Each quad is 2 triangles
    return super.getNbTriangles();
  }

  updateWireframeBuffer() {
    if (this._isVoxel) {
      if (this.getShowWireframe()) {
        if (!this._wireframe) {
          var fAr = this.getFaces();
          var nbFaces = this.getNbFaces();
          this._wireframe = new Uint32Array(nbFaces * 8);
          var wire = this._wireframe;
          for (var i = 0; i < nbFaces; i++) {
            var id = i * 4;
            var wId = i * 8;

            wire[wId] = fAr[id];
            wire[wId + 1] = fAr[id + 1];
            wire[wId + 2] = fAr[id + 1];
            wire[wId + 3] = fAr[id + 2];

            if (fAr[id + 3] !== Utils.TRI_INDEX) {
              wire[wId + 4] = fAr[id + 2];
              wire[wId + 5] = fAr[id + 3];
              wire[wId + 6] = fAr[id + 3];
              wire[wId + 7] = fAr[id];
            } else {
              wire[wId + 4] = fAr[id + 2];
              wire[wId + 5] = fAr[id];
              wire[wId + 6] = fAr[id];
              wire[wId + 7] = fAr[id];
            }
          }
        }
        // Removed legacy WebGL1 buffer updates, let it fall through to Three.js
      }
    }
    super.updateWireframeBuffer();
  }

  getLocalBound() {
    const rd = this.getRenderData();
    if (!rd) {
      if (this._meshData && this._meshData._aabbLoose && this._meshData._aabbLoose.length === 6) {
        return this._meshData._aabbLoose; // Fallback to mesh data if ready
      }
      return [0, 0, 0, 0, 0, 0]; // Default fall-back to avoid index zero-reading crashes
    }
    if (!rd._aabbLoose) {
      // Fall back to octree bounds (populated by copyData/init) rather than returning zero extent,
      // which collapses camera near≈far and produces a thin-slice rendering artifact.
      return this._meshData?._octree?._aabbLoose ?? [0, 0, 0, 0, 0, 0];
    }
    return rd._aabbLoose;
  }

  // Linked instance: SHARE the source's geometry (_meshData — verts/faces/colors/octree/
  // rings) while keeping our own transform + render buffers. Editing either occurrence
  // mutates the shared data; each re-syncs its own GPU buffers on stroke end (see
  // Scene.refreshLinkedSiblings). Break the link with makeUnique().
  shareData(mesh) {
    this.setMeshData(mesh.getMeshData()); // share the geometry — no slice
    this._isVoxel = mesh._isVoxel;
    // init() builds our OWN threeMesh (initThreeMesh) + uploads geometry (updateGeometry)
    // from the shared data. allocateArrays/initTopology are idempotent on already-built
    // shared data (they no-op when arrays are the right size), so the source is untouched.
    this.init();
    this.initRender();
    this.copyTransformData(mesh);
    this.copyRenderConfig(mesh);
  }

  // Break a data link: deep-copy the (currently shared) geometry into our own arrays so
  // future edits no longer touch the other occurrences. Safe even when not linked — it
  // just makes a private copy. Transform + render config are already ours, kept as-is.
  makeUnique() {
    const v = this.getVertices().slice();
    const f = this.getFaces().slice();
    const c = this.getColors().slice();
    const m = this.getMaterials().slice();
    const g = this.getFacesGroups() ? this.getFacesGroups().slice() : null;
    const hadUV = this.hasUV();
    const t   = hadUV ? this.getTexCoords().slice() : null;
    const fuv = hadUV ? this.getFacesTexCoord().slice() : null;
    this.setMeshData(new MeshData()); // fresh, unshared
    this.setVertices(v);
    this.setFaces(f);
    this.setColors(c);
    this.setMaterials(m);
    if (g) this.setFacesGroups(g); // carry per-face groups across the link break
    if (hadUV) this.initTexCoordsDataFromOBJData(t, fuv);
    this.init();
    this.initRender();
    this.updateBuffers();
  }

}

export default MeshStatic;
