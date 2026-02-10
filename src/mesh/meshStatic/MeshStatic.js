import Mesh from '../Mesh.js?v=fix_3';
import TransformData from '../TransformData.js?v=fix_3';
import MeshData from '../MeshData.js?v=fix_3';
import RenderData from '../RenderData.js?v=fix_3';
import Enums from '../../misc/Enums.js?v=fix_3';

class MeshStatic extends Mesh {

  constructor(gl) {
    super();

    this._id = Mesh.ID++; // useful id to retrieve a mesh (dynamic mesh, multires mesh, voxel mesh)

    if (gl) this._renderData = new RenderData(gl, this);
    this._meshData = new MeshData();
    this._transformData = new TransformData();
  }

  setShaderType(type) {
    if (this._isVoxel && type !== Enums.Shader.FLAT && type !== Enums.Shader.WIREFRAME) type = Enums.Shader.FLAT;
    super.setShaderType(type);
  }

  getShaderType() {
    if (this._isVoxel) {
      // If underlying is WIREFRAME, return it.
      if (this._renderData && this._renderData._shaderType === Enums.Shader.WIREFRAME) return Enums.Shader.WIREFRAME;
      return Enums.Shader.FLAT;
    }
    return super.getShaderType();
  }
}

export default MeshStatic;
