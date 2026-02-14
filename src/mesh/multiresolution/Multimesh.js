import MeshResolution from './MeshResolution.js';
import Mesh from '../Mesh.js';
import Buffer from '../../render/Buffer.js';
import Subdivision from '../../editing/Subdivision.js';
import Reversion from '../../editing/Reversion.js';

class Multimesh extends Mesh {

  static get NONE() {
    return 0;
  }
  static get SCULPT() {
    return 1;
  }
  static get CAMERA() {
    return 2;
  }
  static get PICKING() {
    return 3;
  }

  constructor(mesh) {
    super();

    this.setID(mesh.getID());
    this.setRenderData(mesh.getRenderData());
    this.setTransformData(mesh.getTransformData());

    this._meshes = [new MeshResolution(mesh, true)];
    this.setSelection(0);

    var gl = mesh.getGL();
    this._indexBuffer = new Buffer(gl, gl.ELEMENT_ARRAY_BUFFER, gl.STATIC_DRAW);
    this._wireframeBuffer = new Buffer(gl, gl.ELEMENT_ARRAY_BUFFER, gl.STATIC_DRAW);
  }

  getCurrentMesh() {
    return this._meshes[this._sel];
  }

  setSelection(sel) {
    this._sel = sel;
    this.setMeshData(this.getCurrentMesh().getMeshData());
  }

  addLevel() {
    if ((this._meshes.length - 1) !== this._sel)
      return this.getCurrentMesh();

    var nbFaces = this.getCurrentMesh().getNbFaces();
    // var strTimer = 'addLevel : ' + nbFaces + ' -> ' + nbFaces * 4;
    // console.time(strTimer);

    var baseMesh = this.getCurrentMesh();
    var newMesh = new MeshResolution(baseMesh);
    baseMesh.setVerticesMapping(undefined);

    Subdivision.fullSubdivision(baseMesh, newMesh);
    newMesh.initTopology();

    this.pushMesh(newMesh);
    this.initRender();

    // console.timeEnd(strTimer);

    return newMesh;
  }

  computeReverse() {
    if (this._sel !== 0)
      return this.getCurrentMesh();

    var baseMesh = this.getCurrentMesh();
    var newMesh = new MeshResolution(baseMesh);

    var status = Reversion.computeReverse(baseMesh, newMesh);
    if (!status)
      return;

    newMesh.initTopology();

    this.unshiftMesh(newMesh);
    this.initRender();
    return newMesh;
  }

  lowerLevel() {
    if (this._sel === 0)
      return this._meshes[0];

    this._meshes[this._sel - 1].lowerAnalysis(this.getCurrentMesh());
    this.setSelection(this._sel - 1);
    this.updateResolution();

    return this.getCurrentMesh();
  }

  higherLevel() {
    if (this._sel === this._meshes.length - 1)
      return this.getCurrentMesh();

    this._meshes[this._sel + 1].higherSynthesis(this.getCurrentMesh());
    this.setSelection(this._sel + 1);
    this.updateResolution();

    return this.getCurrentMesh();
  }

  updateResolution() {
    this.updateGeometry();
    this.updateDuplicateColorsAndMaterials();
    this.updateBuffers();

    var mesh = this._meshes[this.getLowIndexRender()];
    this._indexBuffer.update(mesh.getTriangles());
    this._wireframeBuffer.update(mesh.getWireframe());
  }

  selectResolution(sel) {
    while (this._sel > sel) {
      this.lowerLevel();
    }
    while (this._sel < sel) {
      this.higherLevel();
    }
  }

  findIndexFromMesh(mesh) {
    var meshes = this._meshes;
    for (var i = 0, l = meshes.length; i < l; ++i) {
      if (mesh === meshes[i])
        return i;
    }
  }

  selectMesh(mesh) {
    var val = this.findIndexFromMesh(mesh);
    this.selectResolution(val);
  }

  pushMesh(mesh) {
    this._meshes.push(mesh);
    this.setSelection(this._meshes.length - 1);
    this.updateResolution();
  }

  unshiftMesh(mesh) {
    this._meshes.unshift(mesh);
    this.setSelection(1);
    this.lowerLevel();
  }

  popMesh() {
    this._meshes.pop();
    this.setSelection(this._meshes.length - 1);
    this.updateResolution();
  }

  shiftMesh() {
    this._meshes.shift();
    this.setSelection(0);
    this.updateResolution();
  }

  deleteLower() {
    this._meshes.splice(0, this._sel);
    this.setSelection(0);
  }

  deleteHigher() {
    this._meshes.splice(this._sel + 1);
  }

  getLowIndexRender() {
    var limit = 500000;
    var sel = this._sel;
    while (sel >= 0) {
      var mesh = this._meshes[sel];
      // we disable low rendering for lower resolution mesh with
      // an index indirection for even vertices
      if (mesh.getEvenMapping() === true)
        return sel === this._sel ? sel : sel + 1;
      if (mesh.getNbTriangles() < limit)
        return sel;
      --sel;
    }
    return 0;
  }

  _renderLow(main) {
    var render = this.getRenderData();
    var tmpSel = this._sel;
    var tmpIndex = this.getIndexBuffer();
    this.setSelection(this.getLowIndexRender());
    render._indexBuffer = this._indexBuffer;

    super.render(main);

    render._indexBuffer = tmpIndex;
    this.setSelection(tmpSel);
  }

  _renderWireframeLow(main) {
    var render = this.getRenderData();
    var tmpSel = this._sel;
    var tmpWire = this.getWireframeBuffer();
    this.setSelection(this.getLowIndexRender());
    render._wireframeBuffer = this._wireframeBuffer;

    super.renderWireframe(main);

    render._wireframeBuffer = tmpWire;
    this.setSelection(tmpSel);
  }

  _canUseLowRender(main) {
    if (this.isUsingTexCoords() || this.isUsingDrawArrays()) return false;
    if (Multimesh.RENDER_HINT === Multimesh.PICKING || Multimesh.RENDER_HINT === Multimesh.NONE) return false;
    if (main.getMesh() === this && Multimesh.RENDER_HINT !== Multimesh.CAMERA) return false;
    if (this.getLowIndexRender() === this._sel) return false;
    return true;
  }

  render(main) {
    if (this._canUseLowRender(main)) {
      return this._renderLow(main);
    }
    // Ensure the main RenderData uses the current mesh's index buffer
    var currentMesh = this.getCurrentMesh();
    var render = this.getRenderData();
    render._indexBuffer = currentMesh.getIndexBuffer();

    // Debug Mismatch
    // Buffer.js stores size in _size (element count, matches data.length)
    var curIB = currentMesh.getIndexBuffer()._size;
    var curVB = currentMesh.getRenderData()._vertexBuffer._size;
    var mainVB = this.getRenderData()._vertexBuffer._size;

    // Theoretical max index
    var nbVerts = currentMesh.getNbVertices();

    // Scan for max index
    let maxIndex = 0;
    // MeshResolution likely uses getFaces() which returns Uint32Array
    var faces = currentMesh.getFaces();
    if (faces) {
      // 98304 faces * 4 = 393216 elements in fAr (including TRI_INDEX=-1)
      // or if it is just a raw array... let's trust getNbFaces()
      // Actually fAr is usually size * 4
      var l = faces.length;
      for (var i = 0; i < l; ++i) {
        if (faces[i] < 4294967295 && faces[i] > maxIndex) maxIndex = faces[i];
      }
    } else {
      maxIndex = -1;
    }

    var curCB = currentMesh.getColorBuffer() ? currentMesh.getColorBuffer()._size : 0;
    var curMB = currentMesh.getMaterialBuffer() ? currentMesh.getMaterialBuffer()._size : 0;

    /*
    console.warn(`[Multimesh] ID:${this.getID()} Draw! 
      CurIB:${curIB} (indices)
      CurVB:${curVB} (floats) -> ${curVB / 3} verts
      CurCB:${curCB} (floats) -> ${curCB / 3} verts
      CurMB:${curMB} (floats) -> ${curMB / 3} verts
      NBVerts:${nbVerts}
      MaxIndex:${maxIndex}
      Diff:${(curVB - mainVB)}
    `);
    */

    return super.render(main);
  }

  renderWireframe(main) {
    return this._canUseLowRender(main) ? this._renderWireframeLow(main) : super.renderWireframe(main);
  }

  getSymmetryData() {
    return this.getCurrentMesh().getSymmetryData();
  }

  symmetrize(direction) {
    this.getCurrentMesh().symmetrize(direction);
    this.updateResolution();
  }
}

Multimesh.RENDER_HINT = 0;

export default Multimesh;
