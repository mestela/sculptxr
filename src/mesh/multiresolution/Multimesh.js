import MeshResolution from './MeshResolution.js';
import Mesh from '../Mesh.js';
import * as THREE from 'three';
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
    
    // Instead of raw webgl buffer update, call the new Three.js geometry update
    mesh.updateIndexBuffer();
    this.updateWireframeBuffer();
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

  getLowIndexWireframe() {
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

    

    return super.render(main);
  }

  getTessellatedWireframe(lowIdx) {
    if (this._tessellatedWireframeCache && this._tessellatedWireframeCache.lowIdx === lowIdx && this._tessellatedWireframeCache.selIdx === this._sel) {
      return this._tessellatedWireframeCache.data;
    }

    var lowMesh = this._meshes[lowIdx];
    if (!lowMesh.getEdges() || lowMesh.getEdges().length === 0) {
      lowMesh.allocateArrays();
      lowMesh.initFaceRings();
      lowMesh.initEdges();
    }

    // Start with the base wireframe
    var edges = Array.from(lowMesh.getWireframe());

    // Recursively split edges for each subdivision level
    for (var L = lowIdx; L < this._sel; ++L) {
      var nextMesh = this._meshes[L + 1];
      
      // We need to find the new midpoint vertex for each edge (v1, v2)
      // The new midpoint vertex in nextMesh will be a neighbor to both v1 and v2.
      // NOTE: During subdivision, base vertices are kept at the START of the new array.
      // So v1 and v2 have the exact same index in nextMesh!
      
      var nextVrvSC = nextMesh.getVerticesRingVertStartCount();
      var nextVrv = nextMesh.getVerticesRingVert();
      
      var nextEdges = [];
      var nbEdges = edges.length / 2;
      
      for (var e = 0; e < nbEdges; ++e) {
        var v1 = edges[e * 2];
        var v2 = edges[e * 2 + 1];
        
        // Find the shared neighbor between v1 and v2 in nextMesh
        var start1 = nextVrvSC[v1 * 2];
        var end1 = start1 + nextVrvSC[v1 * 2 + 1];
        var start2 = nextVrvSC[v2 * 2];
        var end2 = start2 + nextVrvSC[v2 * 2 + 1];
        
        var mid = -1;
        for (var i = start1; i < end1; ++i) {
          var n1 = nextVrv[i];
          for (var j = start2; j < end2; ++j) {
            if (n1 === nextVrv[j]) {
              mid = n1;
              break;
            }
          }
          if (mid !== -1) break;
        }
        
        if (mid !== -1) {
          nextEdges.push(v1, mid, mid, v2);
        } else {
          // Fallback if topology is non-manifold or broken (shouldn't happen on standard meshes)
          nextEdges.push(v1, v2); 
        }
      }
      edges = nextEdges;
    }

    var result = new Uint32Array(edges);
    this._tessellatedWireframeCache = {
      lowIdx: lowIdx,
      selIdx: this._sel,
      data: result
    };

    return result;
  }

  updateWireframeBuffer() {
    if (this.getWireframeType() === 2) {
      super.updateWireframeBuffer();
      return;
    }

    var lowWireIdx = this.getLowIndexWireframe();

    if (lowWireIdx === this._sel) {
      super.updateWireframeBuffer();
      return;
    }

    if (lowWireIdx !== this._sel) {
      if (this.getShowWireframe()) {
        
        if (!this._renderData._wireframeMesh) {
          var wireGeometry = new THREE.BufferGeometry();
          var wireMaterial = new THREE.LineBasicMaterial({ 
            color: 0x000000, 
            transparent: true, 
            opacity: 0.2 
          });
          this._renderData._wireframeMesh = new THREE.LineSegments(wireGeometry, wireMaterial);
          this._renderData._wireframeMesh.frustumCulled = false;
          this._renderData._wireframeMesh.renderOrder = 1;
          if (this._renderData._threeMesh) {
              this._renderData._threeMesh.add(this._renderData._wireframeMesh);
          }
        }

        var indices;
        var type = this.getWireframeType();
        if (type === 1) { // Smooth L0
          indices = this.getTessellatedWireframe(lowWireIdx);
        } else if (type === 0) { // Fast L0
          var lowWireMesh = this._meshes[lowWireIdx];
          if (!lowWireMesh.getEdges() || lowWireMesh.getEdges().length === 0) {
            lowWireMesh.allocateArrays();
            lowWireMesh.initFaceRings();
            lowWireMesh.initEdges();
          }
          indices = lowWireMesh.getWireframe();
        }

        if (this._renderData._wireframeMesh && indices) {
          var wireGeom = this._renderData._wireframeMesh.geometry;
          var mainGeom = this._renderData._threeMesh.geometry;

          // Share position! MUST sync if mainGeom replaces position!
              wireGeom.setAttribute('position', mainGeom.getAttribute('position'));

          // Share normal! REQUIRED for vertex shader inflation!
              wireGeom.setAttribute('normal', mainGeom.getAttribute('normal'));

          var attr = wireGeom.getIndex();
          if (!attr || attr.array.length !== indices.length) {
              wireGeom.setIndex(new THREE.BufferAttribute(indices, 1));
          } else {
              attr.array.set(indices);
              attr.needsUpdate = true;
          }
          wireGeom.setDrawRange(0, indices.length);
        }
      }
    }
  }

  getRenderNbEdges() {
    if (this._renderNbEdgesOverride !== undefined) return this._renderNbEdgesOverride;
    return super.getRenderNbEdges();
  }

  renderWireframe(main) {
    if (this.isUsingTexCoords() || this.isUsingDrawArrays()) return super.renderWireframe(main);
    if (this.getWireframeType() === 2) return super.renderWireframe(main); // Full Wireframe

    var lowIdx = this.getLowIndexWireframe();
    if (lowIdx === this._sel) return super.renderWireframe(main);
    
    var type = this.getWireframeType();
    var lowMesh = this._meshes[lowIdx];

    // Force lazy init of the low-res wireframe arrays (if updateWireframeBuffer missed it)
    if (type === 1) { // Smooth L0
      if (!this._lowWireframeBuffer || !this._tessellatedWireframeCache || this._tessellatedWireframeCache.lowIdx !== lowIdx || this._tessellatedWireframeCache.selIdx !== this._sel) {
        if (!this._lowWireframeBuffer) {
          this._lowWireframeBuffer = new Buffer(this.getGL(), this.getGL().ELEMENT_ARRAY_BUFFER, this.getGL().STATIC_DRAW);
        }
        var tessWire = this.getTessellatedWireframe(lowIdx);
        this._lowWireframeBuffer.update(tessWire, tessWire.length);
      }
      this._renderNbEdgesOverride = this._tessellatedWireframeCache.data.length / 2;
    } else if (type === 0) { // Fast L0
      if (!this._lowWireframeBuffer || !lowMesh.getEdges() || lowMesh.getEdges().length === 0) {
        if (!lowMesh.getEdges() || lowMesh.getEdges().length === 0) {
          lowMesh.allocateArrays();
          lowMesh.initFaceRings();
          lowMesh.initEdges();
        }
        if (!this._lowWireframeBuffer) {
          this._lowWireframeBuffer = new Buffer(this.getGL(), this.getGL().ELEMENT_ARRAY_BUFFER, this.getGL().STATIC_DRAW);
        }
        this._lowWireframeBuffer.update(lowMesh.getWireframe(), lowMesh.getNbEdges() * 2);
      }
      this._renderNbEdgesOverride = lowMesh.getRenderNbEdges();
    }

    var render = this.getRenderData();
    var tmpWire = this.getWireframeBuffer();
    
    // Temporarily bind the lower level wireframe buffer (isolated from the shared renderData buffer)
    render._wireframeBuffer = this._lowWireframeBuffer;
    
    super.renderWireframe(main);
    this._renderNbEdgesOverride = undefined;
    
    render._wireframeBuffer = tmpWire;
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
