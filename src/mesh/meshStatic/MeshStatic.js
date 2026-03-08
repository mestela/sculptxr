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
        this.getWireframeBuffer().update(this._wireframe, this._wireframe.length);
      }
      return;
    }
    super.updateWireframeBuffer();
  }


  // setShaderType(type) {
  //   if (this._isVoxel && type !== Enums.Shader.FLAT && type !== Enums.Shader.WIREFRAME) type = Enums.Shader.FLAT;
  //   super.setShaderType(type);
  // }

  // getShaderType() {
  //   if (this._isVoxel) {
  //     // If underlying is WIREFRAME, return it.
  //     if (this._renderData && this._renderData._shaderType === Enums.Shader.WIREFRAME) return Enums.Shader.WIREFRAME;
  //     return Enums.Shader.FLAT;
  //   }
  //   return super.getShaderType();
  // }
}

export default MeshStatic;
