import MeshResolution from './MeshResolution.js';
import Mesh from '../Mesh.js';
import * as THREE from 'three';
import getOptionsURL from '../../misc/getOptionsURL.js';
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
    this.updateResolution();
  }

  deleteHigher() {
    this._meshes.splice(this._sel + 1);
    this.updateResolution();
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
    return false; // Fix: Always render the true wireframe and surface of the active layer natively!
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
    if (this.getShowWireframe()) {
      var wireType = this.getWireframeType(); // 0: Level 0 Fast, 1: Level 0 Smooth, 2: Full
      var activeMesh = (wireType === 0 || wireType === 1) ? this._meshes[0] : this.getCurrentMesh();
      var sourceLevel = (wireType === 0 || wireType === 1) ? 0 : this._sel;

      if (!activeMesh.getEdges() || activeMesh.getEdges().length === 0) {
        activeMesh.allocateArrays();
        activeMesh.initFaceRings();
        activeMesh.initEdges();
      }
      
      var indices = activeMesh.getWireframe();
      
      if (sourceLevel < this._meshes.length - 1 && indices) {
        var mappedIndices = new Uint32Array(indices.length);
        for (var i = 0; i < indices.length; i++) {
          var curId = indices[i];
          for (var L = sourceLevel; L < this._meshes.length - 1; L++) {
            var map = this._meshes[L].getVerticesMapping();
            if (map && curId < map.length) {
              curId = map[curId];
            }
          }
          mappedIndices[i] = curId;
        }
        indices = mappedIndices;
      }

      var currentAlpha = 0.3;
      var rawBias = 0.001;
      if (window.app && window.app.getGuiXR()) {
          var ui = window.app.getGuiXR()._uiSettings;
          if (ui.wireframeAlpha !== undefined) currentAlpha = ui.wireframeAlpha;
          if (ui.wireframeBias !== undefined) rawBias = ui.wireframeBias;
      }

      if (indices) {
        if (!this._renderData._wireframeMesh) {
            var lineMaterial = new THREE.LineBasicMaterial({
                color: 0x000000,
                transparent: true,
                opacity: currentAlpha,
                depthTest: true
            });
            lineMaterial.userData = { uBias: { value: rawBias } };
            lineMaterial.onBeforeCompile = function(shader) {
                shader.uniforms.uBias = lineMaterial.userData.uBias;
                shader.vertexShader = 'uniform float uBias;\n' + shader.vertexShader;
                shader.vertexShader = shader.vertexShader.replace(
                    '#include <project_vertex>',
                    '#include <project_vertex>\n  gl_Position.z -= uBias * gl_Position.w;'
                );
            };
            
            var lineGeom = new THREE.BufferGeometry();
            lineGeom.setAttribute('position', this._renderData._geometry.getAttribute('position'));
            this._renderData._wireframeMesh = new THREE.LineSegments(lineGeom, lineMaterial);
            this._renderData._wireframeMesh.frustumCulled = false;
            this._renderData._wireframeMesh.renderOrder = 1;
            
            if (this._renderData._threeMesh) {
                this._renderData._threeMesh.add(this._renderData._wireframeMesh);
            }
        } else {
            this._renderData._wireframeMesh.material.opacity = currentAlpha;
            if (this._renderData._wireframeMesh.material.userData.uBias) {
                this._renderData._wireframeMesh.material.userData.uBias.value = rawBias;
            }
        }

        this._renderData._wireframeMesh.geometry.setIndex(new THREE.BufferAttribute(indices, 1));
        this._renderData._wireframeMesh.geometry.computeBoundingSphere();
        this._renderData._wireframeMesh.geometry.computeBoundingBox();
        this._renderData._wireframeMesh.visible = true;
      }
    } else {
      if (this._renderData._wireframeMesh) {
        this._renderData._wireframeMesh.visible = false;
      }
    }
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
