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

    // CRITICAL FIX: Must force active WebGL updates when the user browses layers, or the solid triangles cache stales onto the old counts!
    if (this.updateBuffers) this.updateBuffers();
    if (this.updateWireframeBuffer) this.updateWireframeBuffer();
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

  // `poseOnly` says the CAUSE of this refresh was a joint moving. That rules a lot out: posing
  // changes vertices and normals, and cannot touch colours, materials, texture coordinates or
  // the index buffer -- so uploading those is several megabytes a frame of data that is
  // identical to what is already on the card. Measured at 49,666 displayed vertices, the whole
  // refresh was 9ms of a 13.6ms frame.
  //
  // It is a narrower claim than "nothing else changed": anything that DOES change a colour or a
  // material runs its own refresh, and this one is only ever asked for by the skin pass.
  updateResolution(poseOnly) {
    const _tr = window._skinTrace ? performance.now() : 0;
    this.updateGeometry(undefined, undefined, poseOnly);
    const _tb = window._skinTrace ? performance.now() : 0;
    // Kept even for a pose: with UVs present this is also what carries a vertex's normal out to
    // its duplicates, and normals are exactly what a pose changes. Without UVs it returns
    // immediately, which is the common case for a sculpted character.
    this.updateDuplicateColorsAndMaterials();
    if (poseOnly) {
      this.updateGeometryBuffers();   // vertices and normals, and nothing else
    } else {
      this.updateBuffers();           // already ends in updateWireframeBuffer()
    }
    if (window._skinTrace) {
      const p = window._skinPhase = window._skinPhase || {};
      p.geom = _tb - _tr;
      p.buf = performance.now() - _tb;
    }
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
    return false; // Allow exclusive index-to-displaced-position geometry overlays!
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
    // The overlay always supplies indexed vertex positions. Never pair those positions with
    // draw-arrays edge indices, which refer to duplicated triangle vertices and only happen to
    // line up at some resolutions.
    var edges = Array.from(lowMesh.getWireframe(true));

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
      var optionsObj = getOptionsURL ? getOptionsURL() : {};
      var wireType = optionsObj.wireframeType !== undefined ? optionsObj.wireframeType : 0;
      var activeMesh = this.getCurrentMesh();
      var baseMesh = this._meshes[0];

      if (!activeMesh.getEdges() || activeMesh.getEdges().length === 0) {
        activeMesh.allocateArrays();
        activeMesh.initFaceRings();
        activeMesh.initEdges();
      }
      if (!baseMesh.getEdges() || baseMesh.getEdges().length === 0) {
        baseMesh.allocateArrays();
        baseMesh.initFaceRings();
        baseMesh.initEdges();
      }
      
      var activeVerts = activeMesh.getVertices();
      var indices;
      if (this._meshes.length === 1 || wireType === 2) {
        indices = activeMesh.getWireframe(true);
      } else if (wireType === 0) {
        indices = baseMesh.getWireframe(true);
      } else if (wireType === 1) {
        indices = this.getTessellatedWireframe(0);
      }

      var rawAlpha = 0.25;
      var rawBias = 0.001;
      if (window.app && window.app.getGuiXR()) {
          var ui = window.app.getGuiXR()._uiSettings;
          if (ui.wireframeAlpha !== undefined) rawAlpha = ui.wireframeAlpha;
          if (ui.wireframeBias !== undefined) rawBias = ui.wireframeBias;
      }

      if (indices) {
        // Apply geometric bias along normals to prevent z-fighting
        var activeNormals = activeMesh.getNormals();
        var biasedVerts = activeVerts;
        
        if (activeNormals && rawBias > 0) {
          biasedVerts = new Float32Array(activeVerts.length);
          for (var i = 0; i < activeVerts.length; i += 3) {
            biasedVerts[i] = activeVerts[i] + activeNormals[i] * rawBias;
            biasedVerts[i+1] = activeVerts[i+1] + activeNormals[i+1] * rawBias;
            biasedVerts[i+2] = activeVerts[i+2] + activeNormals[i+2] * rawBias;
          }
        }

        if (!this._renderData._wireframeMesh) {
            // PER-VERTEX COLOUR, NOT FLAT BLACK.
            //
            // A black wire over a see-through skin reads as jet black rather than as an edge on
            // a surface — there is nothing behind it to mix with, so the alpha does not help.
            // And while weight painting, the one thing the wireframe should agree with is the
            // colour under it. matt: "wires when xray is enabled render jet black. they should
            // mix properly. when weight painting, the wire should take on the weight paint
            // colour."
            //
            // vertexColors reads the colour buffer written below; `color` stays white so the
            // vertex colour is used as-is rather than multiplied down to nothing.
            var lineMaterial = new THREE.LineBasicMaterial({
                color: 0xffffff,
                vertexColors: true,
                transparent: true,
                opacity: rawAlpha,
                depthTest: true
            });
            // ALPHA MUST ONLY ACCUMULATE, or the wireframe cuts a hole in the sculpt in AR.
            //
            // In passthrough the compositor reads the framebuffer's alpha as "how much room
            // shows through", and ordinary SrcAlpha/OneMinusSrcAlpha blending LOWERS destination
            // alpha — so a 25%-opacity black line over a bound mesh made the mesh see-through
            // along every edge. matt hit exactly this on the ground grid first: "if i have the
            // groundplane grid visible, in AR its really harsh." Same fix, same reason: keep the
            // colour blend as it was and give the alpha channel factors that can only add.
            lineMaterial.blending = THREE.CustomBlending;
            lineMaterial.blendSrc = THREE.SrcAlphaFactor;
            lineMaterial.blendDst = THREE.OneMinusSrcAlphaFactor;
            lineMaterial.blendSrcAlpha = THREE.OneFactor;
            lineMaterial.blendDstAlpha = THREE.OneFactor;
            
            var lineGeom = new THREE.BufferGeometry();
            this._renderData._wireframeMesh = new THREE.LineSegments(lineGeom, lineMaterial);
            this._renderData._wireframeMesh.frustumCulled = false;
            this._renderData._wireframeMesh.renderOrder = 1;
            
            var initialParent = activeMesh.getRenderData()._threeMesh || this._renderData._threeMesh;
            if (initialParent) {
                initialParent.add(this._renderData._wireframeMesh);
            } else if (window.app && window.app._scene) {
                window.app._scene.add(this._renderData._wireframeMesh);
            }
        } else {
            this._renderData._wireframeMesh.material.opacity = rawAlpha;
        }

        // Self-healing: Ensure the wireframe is always parented directly to the actual 3D mesh!
        var idealParent = activeMesh.getRenderData()._threeMesh || this._renderData._threeMesh;
        var currentParent = this._renderData._wireframeMesh.parent;

        if (idealParent && currentParent !== idealParent) {
            idealParent.add(this._renderData._wireframeMesh);
            this._renderData._wireframeMesh.matrixAutoUpdate = true;
        } else if (!idealParent && currentParent === window.app._scene) {
            this._renderData._wireframeMesh.matrixAutoUpdate = false;
            this._renderData._wireframeMesh.matrix.fromArray(this.getMatrix());
            this._renderData._wireframeMesh.matrixWorldNeedsUpdate = true;
        }

        // Always update both index and positions to keep up with live sculpting!
        this._renderData._wireframeMesh.geometry.setAttribute('position', new THREE.BufferAttribute(biasedVerts, 3));
        // ...and the colours with them, so the wire carries whatever the surface is showing —
        // the weight preview included. DARKENED, so an edge still reads as an edge against the
        // face it sits on rather than disappearing into it.
        var srcColors = activeMesh.getColors && activeMesh.getColors();
        if (srcColors && srcColors.length >= activeVerts.length) {
          var wireCols = this._renderData._wireCols;
          if (!wireCols || wireCols.length !== activeVerts.length) {
            wireCols = this._renderData._wireCols = new Float32Array(activeVerts.length);
          }
          for (var ci = 0; ci < activeVerts.length; ci++) wireCols[ci] = srcColors[ci] * 0.45;
          this._renderData._wireframeMesh.geometry.setAttribute('color', new THREE.BufferAttribute(wireCols, 3));
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
