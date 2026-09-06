import { vec3, mat3, mat4 } from 'gl-matrix';
import Enums from '../misc/Enums.js';
import Utils from '../misc/Utils.js';
import OctreeCell from '../math3d/OctreeCell.js';
import Shader from '../render/ShaderLib.js';
import RenderData from './RenderData.js';
import MeshSymmetry from './MeshSymmetry.js';
import * as THREE from 'three';
import ShaderManager from '../render/ShaderManager.js';
import getOptionsURL from '../misc/getOptionsURL.js';

// Scratch for getModelSpaceMatrix (worldGroup-relative composed transform).
const _MS_INV = mat4.create();
const _MS_OUT = mat4.create();

/*
Basic usage:
var mesh = new MeshStatic(gl); // provide gl only if we need to render the mesh
mesh.setVertices(vertices); // vec3 xyz
mesh.setFaces(faces); // ivec4 abcd (d=Utils.TRI_INDEX if tri)

// these are optional
mesh.setColors(colors); // vec3 rgb
mesh.setMaterials(materials); // vec3 roughness/metalness/masking
mesh.initTexCoordsDataFromOBJData(UV, facesUV); // vec2, ivec4

mesh.init(); // compute octree/topo/UV, etc...
mesh.initRender(); // only if gl has been provided
*/

var DEF_ROUGHNESS = 0.18; // 0.18;
var DEF_METALNESS = 0.08; // 0.08;

class Mesh {

  constructor() {
    this._id = Mesh.ID++; // useful id to retrieve a mesh (dynamic mesh, multires mesh, voxel mesh)
    this._meshData = null;
    this._transformData = null;
    this._renderData = null;
    this._isVisible = true;
    this._symmetryData = null;
  }

  static sortFunction(meshA, meshB) {
    // render transparent (back to front) after opaque (front to back) ones
    var aTr = meshA.isTransparent();
    var bTr = meshB.isTransparent();
    if (aTr && !bTr) return 1;
    if (!aTr && bTr) return -1;
    return (meshB.getDepth() - meshA.getDepth()) * (aTr && bTr ? 1.0 : -1.0);
  }

  setID(id) {
    this._id = id;
  }

  isVisible() {
    return this._isVisible;
  }

  isUsingColors() {
    return this._meshData._colorsRGB !== null && this._meshData._colorsRGB.length > 0;
  }

  setVisible(bool) {
    this._isVisible = bool;
  }

  setVertices(vAr) {
    this._meshData._verticesXYZ = vAr;
    this._meshData._nbVertices = vAr.length / 3;
  }

  setFaces(fAr) {
    this._meshData._facesABCD = fAr;
    this._meshData._nbFaces = fAr.length / 4;
    // Auto-detect index type for drawElements
    if (fAr instanceof Uint16Array) {
      this._meshData._indexType = 5123; // gl.UNSIGNED_SHORT
    } else {
      this._meshData._indexType = 5125; // gl.UNSIGNED_INT
    }
  }

  getIndexType() {
    return this._meshData._indexType || 5125; // Default to UNSIGNED_INT
  }

  setTexCoords(tAr) {
    this._meshData._texCoordsST = tAr;
    this._meshData._nbTexCoords = tAr.length / 2;
  }

  setColors(cAr) {
    this._meshData._colorsRGB = cAr;
  }

  setMaterials(mAr) {
    this._meshData._materialsPBR = mAr;
  }

  setNormals(nAr) {
    this._meshData._normalsXYZ = nAr;
  }

  setVerticesDuplicateStartCount(startCount) {
    this._meshData._duplicateStartCount = startCount;
  }

  setFacesTexCoord(fuAr) {
    this._meshData._UVfacesABCD = fuAr;
  }

  setMeshData(mdata) {
    this._meshData = mdata;
  }

  setRenderData(rdata) {
    this._renderData = rdata;
  }

  setTransformData(tdata) {
    this._transformData = tdata;
  }

  setNbVertices(nbVertices) {
    this._meshData._nbVertices = nbVertices;
  }

  setNbFaces(nbFaces) {
    this._meshData._nbFaces = nbFaces;
  }

  getID() {
    return this._id;
  }

  getRenderData() {
    return this._renderData;
  }

  getMeshData() {
    return this._meshData;
  }

  getTransformData() {
    return this._transformData;
  }

  getNbVertices() {
    return this._meshData._nbVertices;
  }

  getNbFaces() {
    return this._meshData._nbFaces;
  }

  getNbQuads() {
    return this.getNbTriangles() - this.getNbFaces();
  }

  getNbTriangles() {
    return this._meshData._trianglesABC.length / 3;
  }

  getNbTexCoords() {
    return this._meshData._nbTexCoords;
  }

  hasUV() {
    return this._meshData._texCoordsST !== null;
  }

  getVertices() {
    return this._meshData._verticesXYZ;
  }

  getColors() {
    return this._meshData._colorsRGB;
  }

  getNormals() {
    return this._meshData._normalsXYZ;
  }

  getMaterials() {
    return this._meshData._materialsPBR;
  }

  getVerticesTagFlags() {
    return this._meshData._vertTagFlags;
  }

  getVerticesSculptFlags() {
    return this._meshData._vertSculptFlags;
  }

  getVerticesStateFlags() {
    return this._meshData._vertStateFlags;
  }

  getVerticesRingVertStartCount() {
    return this._meshData._vrvStartCount;
  }

  getVerticesRingVert() {
    return this._meshData._vertRingVert;
  }

  getVerticesRingFaceStartCount() {
    return this._meshData._vrfStartCount;
  }

  getVerticesRingFace() {
    return this._meshData._vertRingFace;
  }

  getVerticesOnEdge() {
    return this._meshData._vertOnEdge;
  }

  getVerticesProxy() {
    return this._meshData._vertProxy;
  }

  getFaces() {
    return this._meshData._facesABCD;
  }

  hasOnlyTriangles() {
    return this.getNbTriangles() === this.getNbFaces();
  }

  hasOnlyQuads() {
    return this.getNbTriangles() === this.getNbFaces() * 2;
  }

  getFaceNormals() {
    return this._meshData._faceNormalsXYZ;
  }

  getFaceBoxes() {
    return this._meshData._faceBoxes;
  }

  getFaceCenters() {
    return this._meshData._faceCentersXYZ;
  }

  getFacesTagFlags() {
    return this._meshData._facesTagFlags;
  }

  getFacesGroups() {
    return this._meshData._facesGroups;
  }

  setFacesGroups(groups) {
    this._meshData._facesGroups = groups;
  }

  getFaceEdges() {
    return this._meshData._faceEdges;
  }

  getFacesToTriangles() {
    return this._meshData._facesToTriangles;
  }

  getTrianglesTexCoord() {
    return this._meshData._UVtrianglesABC;
  }

  getTriangles() {
    return this._meshData._trianglesABC;
  }

  getEdges() {
    return this._meshData._edges;
  }

  getNbEdges() {
    return this._meshData._edges.length;
  }

  getTexCoords() {
    return this._meshData._texCoordsST;
  }

  getVerticesDuplicateStartCount() {
    return this._meshData._duplicateStartCount;
  }

  getFacesTexCoord() {
    return this._meshData._UVfacesABCD;
  }

  getVerticesDrawArrays() {
    if (!this._meshData._DAverticesXYZ || this._meshData._DAverticesXYZ.length < this.getNbTriangles() * 9) this.updateDrawArrays();
    return this._meshData._DAverticesXYZ;
  }

  getNormalsDrawArrays() {
    if (!this._meshData._DAnormalsXYZ || this._meshData._DAnormalsXYZ.length < this.getNbTriangles() * 9) this.updateDrawArrays();
    return this._meshData._DAnormalsXYZ;
  }

  getColorsDrawArrays() {
    if (!this._meshData._DAcolorsRGB || this._meshData._DAcolorsRGB.length < this.getNbTriangles() * 9) this.updateDrawArrays();
    return this._meshData._DAcolorsRGB;
  }

  getMaterialsDrawArrays() {
    if (!this._meshData._DAmaterialsPBR || this._meshData._DAmaterialsPBR.length < this.getNbTriangles() * 9) this.updateDrawArrays();
    return this._meshData._DAmaterialsPBR;
  }

  getTexCoordsDrawArrays() {
    if (!this._meshData._DAtexCoordsST || this._meshData._DAtexCoordsST.length < this.getNbTriangles() * 6) this.updateDrawArrays();
    return this._meshData._DAtexCoordsST;
  }

  getOctree() {
    return this._meshData._octree;
  }

  getCenter() {
    return this._transformData._center;
  }

  getMV() {
    return this._transformData._lastComputedMV;
  }

  getMVP() {
    return this._transformData._lastComputedMVP;
  }

  getN() {
    return this._transformData._lastComputedN;
  }

  getEN() {
    return this._transformData._lastComputedEN;
  }

  getDepth() {
    return this._transformData._lastComputedDepth;
  }

  getMatrix() {
    return this._transformData._matrix;
  }

  getEditMatrix() {
    return this._transformData._editMatrix;
  }

  getScale2() {
    var m = this._transformData._matrix;
    return m[0] * m[0] + m[4] * m[4] + m[8] * m[8];
  }

  getScale() {
    return Math.sqrt(this.getScale2());
  }

  setScale(scale) {
    var m = this._transformData._matrix;
    var cur = this.getScale();
    if (cur === 0.0) return;
    var ratio = scale / cur;
    m[0] *= ratio; m[1] *= ratio; m[2] *= ratio;
    m[4] *= ratio; m[5] *= ratio; m[6] *= ratio;
    m[8] *= ratio; m[9] *= ratio; m[10] *= ratio;
  }

  setMatrix(mat) {
    mat4.copy(this._transformData._matrix, mat);
  }

  // The mesh's transform in MODEL space (relative to `_worldGroup`) — i.e. the
  // composed parent chain up to but excluding the worldGroup. This is the space the
  // VR ray/sphere picking operates in. For a top-level (flat) mesh the local matrix
  // already IS model space, so we return it exactly (no inverse round-trip, no float
  // drift) — making the parent-aware picking a pure no-op until parenting exists.
  getModelSpaceMatrix(out) {
    out = out || mat4.create();
    const tm = this.getThreeMesh();
    const wg = window._sxrWorldGroup;
    if (!tm || !wg || tm.parent === wg) { mat4.copy(out, this._transformData._matrix); return out; }
    tm.updateWorldMatrix(true, false);
    mat4.invert(_MS_INV, wg.matrixWorld.elements);
    mat4.multiply(out, _MS_INV, tm.matrixWorld.elements);
    return out;
  }

  // Write side of getModelSpaceMatrix: given a desired MODEL-space transform, store
  // the correct LOCAL `_matrix` (converting through the parent). For a top-level mesh
  // model space IS local, so this is exactly setMatrix() — no behaviour change for
  // flat meshes. Transform tools (Grab/Move/gizmo) should read getModelSpaceMatrix()
  // and write setModelSpaceMatrix() so they keep working once a mesh is parented.
  setModelSpaceMatrix(modelMat) {
    const tm = this.getThreeMesh();
    const wg = window._sxrWorldGroup;
    // A DETACHED MESH IS TREATED AS A TOP-LEVEL ONE. Deleting a mesh takes its three mesh out of
    // its parent and leaves everything else intact for undo, so a reference held elsewhere ends
    // up here with `tm.parent` null and the conversion below threw on it. Local IS model space
    // for something that is not in the graph, which is exactly what the flat case does.
    if (!tm || !wg || !tm.parent || tm.parent === wg) { mat4.copy(this._transformData._matrix, modelMat); return; }
    tm.parent.updateWorldMatrix(true, false);
    // parent model-space = inverse(worldGroup.matrixWorld) * parent.matrixWorld
    mat4.invert(_MS_INV, wg.matrixWorld.elements);
    mat4.multiply(_MS_OUT, _MS_INV, tm.parent.matrixWorld.elements);
    // local = inverse(parent model-space) * modelMat
    mat4.invert(_MS_INV, _MS_OUT);
    mat4.multiply(this._transformData._matrix, _MS_INV, modelMat);
  }

  // Uniform scale of the model-space matrix (matches getScale()'s basis-length form).
  getModelSpaceScale() {
    const tm = this.getThreeMesh();
    const wg = window._sxrWorldGroup;
    if (!tm || !wg || tm.parent === wg) return this.getScale();
    const m = this.getModelSpaceMatrix(_MS_OUT);
    return Math.sqrt(m[0] * m[0] + m[4] * m[4] + m[8] * m[8]);
  }

  getSymmetryOrigin() {
    var orig = vec3.create();
    var tdata = this._transformData;
    var offset = tdata._symmetryOffset * this.computeLocalRadius();
    return vec3.scaleAndAdd(orig, tdata._center, tdata._symmetryNormal, offset);
  }

  getSymmetryOffset() {
    return this._transformData._symmetryOffset;
  }

  setSymmetryOffset(offset) {
    this._transformData._symmetryOffset = offset;
  }

  getSymmetryNormal() {
    return this._transformData._symmetryNormal;
  }

  getSymmetryData() {
    if (!this._symmetryData) this._symmetryData = new MeshSymmetry(this);
    return this._symmetryData;
  }

  symmetrize(direction) {
    this.getSymmetryData().symmetrize(direction);
  }

  getFacePosInLeaf() {
    return this._meshData._facePosInLeaf;
  }

  getFaceLeaf() {
    return this._meshData._faceLeaf;
  }

  getLeavesToUpdate() {
    return this._meshData._leavesToUpdate;
  }

  getLocalBound() {
    return this._meshData._octree._aabbLoose;
  }

  getRenderNbEdges() {
    return this.getNbEdges();
  }

  init() {
    this.initColorsAndMaterials();
    this.allocateArrays();
    this.initTopology();
    this.updateGeometry();
    if (this._renderData)
      this.updateDuplicateColorsAndMaterials();
    this.updateCenter();
    this.initThreeMesh();
  }

  initThreeMesh() {
    if (!this._renderData) return;
    if (!this._renderData._threeMesh) {

      
      var material = ShaderManager.getMaterial(this.getShaderType());
      if (!material) {
        material = new THREE.MeshStandardMaterial({
          color: 0xcccccc,
          roughness: 0.5,
          metalness: 0.1,
          wireframe: false,
          side: THREE.DoubleSide
        });
        if (this.isUsingColors && this.isUsingColors()) material.vertexColors = true;
      }

      // Apply polygonOffset to push solid mesh back and make wireframe crisp
      material.polygonOffset = true;
      material.polygonOffsetFactor = 1.0;
      material.polygonOffsetUnits = 1.0;

      this._renderData._threeMesh = new THREE.Mesh(this._renderData._geometry, material);
      this._renderData._threeMesh.userData.sculptMesh = this; // Link back for pickers
      this._renderData._threeMesh.frustumCulled = false; // SculptXR calculates its own frustum culling
      


      this._renderData._threeMesh.onBeforeRender = function(renderer, scene, camera) {
         var mat = this.material;
         if (mat && mat.isShaderMaterial && mat.userData.sculptShaderId === 5) { // Enums.Shader.MATCAP
             // Import on standard js module scope may not be visible inside this closure, check global or handle in ShaderManager
             if (window.ShaderManager && window.ShaderManager.onBeforeRenderMatCap) {
                  window.ShaderManager.onBeforeRenderMatCap(this.userData.sculptMesh, camera);
             }
         }
      };
    }
  }

  getThreeMesh() {
    return this._renderData ? this._renderData._threeMesh : null;
  }

  initTopology() {
    this.initFaceRings();
    // this.optimize(); // CRITICAL FIX: NEVER optimize topology! Destroys multires indices!
    this.initEdges();
    this.initVertexRings();
    this.initRenderTriangles();
  }

  updateGeometry(iFaces, iVerts, skipOctree) {
    // Layer sculpting intercept — two cases:
    //  A) A blendshape layer is active: keep its delta live.
    // Both are skipped during applyBlendshapes() recomposition (_applyingBS flag).
    const _reg = window._animationRegistry;
    const _track = _reg?.tracks?.get(this.getID?.());
    if (_track?.editingBlendshape && _track.baseShape && !_track._applyingBS) {
      // Blendshape layer editing. The active layer is held at weight 1 while
      // sculpting (the SculptManager gate blocks strokes otherwise), but the live
      // view is now the FULL weighted composition, not an isolated layer — so the
      // mesh may also carry other layers' contributions. Subtract those so the
      // captured delta is purely this layer:
      //   verts = base + activeDelta*1 + others  →  activeDelta = verts - base - others
      // otherLayersOffset() returns null when nothing else contributes (fast path).
      const _name = _track.editingBlendshape;
      // HARD GUARD: the capture below assumes the active layer is at weight 1
      // (delta = verts - base - others). If it isn't — e.g. the playhead is on a
      // keyframe where this layer evaluates ≠ 1, or a stroke slipped past the
      // SculptManager start() gate — writing that delta CORRUPTS the layer. So
      // refuse the write entirely; the moved verts are transient and get cleaned up
      // by the next applyBlendshapes recompose. This is the corruption backstop that
      // does not depend on the start() gate firing.
      const _bt = _track.blendshapeTracks?.get(_name);
      const _w  = _bt ? _reg.evaluateScalarTrack(_bt, _track.playbackTime || 0) : 0;
      if (Math.abs(_w - 1) > 1e-3 || (_track.blendshapeMuted && _track.blendshapeMuted.has(_name))) {
        if (window._blendshapeStackPanel?.flash) window._blendshapeStackPanel.flash();
        if (window._blendshapeStackPanelVR?.flash) window._blendshapeStackPanelVR.flash();
        _reg.applyBlendshapes(this); // discards the transient nudge + does a full geometry update
        return;
      }
      const _v    = this.getVertices();
      let _delta  = _track.blendshapes?.get(_name);
      if (!_delta || _delta.length !== _v.length) {
        _delta = new Float32Array(_v.length);
        _track.blendshapes.set(_name, _delta);
      }
      const _others = _reg.otherLayersOffset ? _reg.otherLayersOffset(_track, _name) : null;
      if (_others) {
        for (let _j = 0; _j < _v.length; _j++)
          _delta[_j] = _v[_j] - _track.baseShape[_j] - _others[_j];
      } else {
        for (let _j = 0; _j < _v.length; _j++)
          _delta[_j] = _v[_j] - _track.baseShape[_j];
      }
    } else if (_track?.baseShape && !_track._applyingBS) {
      // Base layer active: rebase baseShape to the new neutral.
      //
      // CRITICAL: the displayed mesh may carry active blendshape contributions —
      // either because the user is sculpting the base while some layers are on, or
      // because updateGeometry() fired incidentally (not via applyBlendshapes) while
      // a composed/animated pose is showing. Naively doing baseShape.set(verts) bakes
      // that composition into the base, corrupting EVERY layer's delta (the symptom:
      // sculpt a few layers, animate, and one comes back wrong). So subtract all
      // (non-muted) layer contributions to recover the true base:
      //   verts = base + Σ(layer*w)  →  base = verts - Σ(layer*w)
      // When nothing contributes (mesh already equals base) the offset is null and
      // this is just the old set() — and an incidental call now recomputes the SAME
      // base instead of poisoning it.
      const _v   = this.getVertices();
      const _all = _reg.otherLayersOffset ? _reg.otherLayersOffset(_track, null) : null;
      if (_all) {
        for (let _j = 0; _j < _v.length; _j++) _track.baseShape[_j] = _v[_j] - _all[_j];
      } else {
        _track.baseShape.set(_v);
      }
    }

    // Phase times for the skin trace. Split here because "the refresh is slow" was never
    // actionable: recomputing normals and rebuilding the draw arrays are different sizes of
    // problem with different answers, and the octree turned out to be only a quarter of it.
    const _pt = window._skinTrace ? (window._skinPhase = window._skinPhase || {}) : null;
    const _pa = _pt ? performance.now() : 0;
    this.updateFacesAabbAndNormal(iFaces, skipOctree);
    this.updateVerticesNormal(iVerts);
    if (_pt) _pt.norm = performance.now() - _pa;
    

    // THE OCTREE IS FOR PICKING, NOT FOR DRAWING, so a refresh that nobody is going to pick
    // against can skip it. That distinction did not matter while this only ran on a sculpt
    // stroke; it matters enormously now that the skin pass calls it on EVERY FRAME a joint
    // moves. Measured on a character bound at the base cage and displayed two levels up:
    // 49,666 vertices, 29ms a frame, of which the deformation was 2.5ms and the refresh 23ms
    // -- a full octree rebuild, per frame, for a query nothing was making.
    // matt: "the glug is more in terms of posing the character with pins more than sculpting."
    //
    // Marked stale instead, and rebuilt by the first query that needs it (see ensureOctree).
    if (skipOctree) {
      this._meshData._octreeStale = true;
    } else if (iFaces === undefined) {
      this.computeOctree(); 
    } else {
      this.updateOctree(iFaces);
    }
    
    if (_pt) _pt.oct = performance.now() - _pa - _pt.norm;

    if (this._renderData) {
      const _pb = _pt ? performance.now() : 0;
      this.updateDuplicateGeometry(iVerts);
      this.updateDrawArrays(iFaces);
      if (_pt) _pt.draw = performance.now() - _pb;
      
      // Final fallback for zero normals in render buffers
      const normals = this.getNormals();
      if (normals) {
        let fixedCount = 0;
        for (let i = 0; i < normals.length; i += 3) {
          const x = normals[i];
          const y = normals[i+1];
          const z = normals[i+2];
          const mag = x*x + y*y + z*z;
          if (isNaN(x) || isNaN(y) || isNaN(z) || mag < 0.0001) {
             normals[i] = 0.0;
             normals[i+1] = 1.0;
             normals[i+2] = 0.0;
             fixedCount++;
          }
        }

      }
    }
  }

  allocateArrays() {
    var nbVertices = this.getNbVertices();

    if (this.hasUV()) {
      var nbTexCoords = this._meshData._texCoordsST.length / 2;
      var maxCount = Math.max(nbVertices, nbTexCoords);

      var tmp = new Float32Array(maxCount * 3);
      tmp.set(this._meshData._verticesXYZ);
      this._meshData._verticesXYZ = tmp;

      this._meshData._normalsXYZ = new Float32Array(maxCount * 3);

      tmp = new Float32Array(maxCount * 3);
      if (this._meshData._colorsRGB) tmp.set(this._meshData._colorsRGB);
      this._meshData._colorsRGB = tmp;

      tmp = new Float32Array(maxCount * 3);
      if (this._meshData._materialsPBR) tmp.set(this._meshData._materialsPBR);
      this._meshData._materialsPBR = tmp;
    } else {
      if (!this._meshData._normalsXYZ || this._meshData._normalsXYZ.length !== nbVertices * 3)
        this._meshData._normalsXYZ = new Float32Array(nbVertices * 3);

      if (!this._meshData._colorsRGB || this._meshData._colorsRGB.length !== nbVertices * 3) {
        let tmp = new Float32Array(nbVertices * 3);
        if (this._meshData._colorsRGB) {
          tmp.set(this._meshData._colorsRGB.subarray(0, Math.min(this._meshData._colorsRGB.length, nbVertices * 3)));
        }
        this._meshData._colorsRGB = tmp;
      }

      if (!this._meshData._materialsPBR || this._meshData._materialsPBR.length !== nbVertices * 3) {
        let tmp = new Float32Array(nbVertices * 3);
        if (this._meshData._materialsPBR) {
          tmp.set(this._meshData._materialsPBR.subarray(0, Math.min(this._meshData._materialsPBR.length, nbVertices * 3)));
        }
        this._meshData._materialsPBR = tmp;
      }
    }

    this._meshData._vertOnEdge = new Uint8Array(nbVertices);
    this._meshData._vrvStartCount = new Uint32Array(nbVertices * 2);
    this._meshData._vrfStartCount = new Uint32Array(nbVertices * 2);
    this._meshData._vertTagFlags = new Int32Array(nbVertices);
    this._meshData._vertSculptFlags = new Int32Array(nbVertices);
    this._meshData._vertStateFlags = new Int32Array(nbVertices);
    this._meshData._vertProxy = new Float32Array(nbVertices * 3);

    var nbFaces = this.getNbFaces();
    this._meshData._faceEdges = new Uint32Array(nbFaces * 4);
    this._meshData._facesToTriangles = new Uint32Array(nbFaces);
    this._meshData._faceBoxes = new Float32Array(nbFaces * 6);
    this._meshData._faceNormalsXYZ = new Float32Array(nbFaces * 3);
    this._meshData._faceCentersXYZ = new Float32Array(nbFaces * 3);
    this._meshData._facesTagFlags = new Int32Array(nbFaces);

    // _facesGroups is persistent (unlike the transient tag flags): preserve any
    // existing group ids where the face count is unchanged, else default to 0.
    var oldGroups = this._meshData._facesGroups;
    var newGroups = new Int32Array(nbFaces);
    if (oldGroups) newGroups.set(oldGroups.subarray(0, Math.min(oldGroups.length, nbFaces)));
    this._meshData._facesGroups = newGroups;

    this._meshData._facePosInLeaf = new Uint32Array(nbFaces);
    var faceLeaf = this._meshData._faceLeaf = new Array(nbFaces);
    for (var i = 0; i < nbFaces; ++i) {
      faceLeaf[i] = null;
    }
  }

  /** Init color and material array */
  initColorsAndMaterials() {
    var nbVertices = this.getNbVertices();
    var i = 0;
    var len = nbVertices * 3;
    if (!this._meshData._colorsRGB || this._meshData._colorsRGB.length !== len) {
      var cAr = this._meshData._colorsRGB = new Float32Array(len);
      for (i = 0; i < len; ++i)
        cAr[i] = 1.0;
    }
    if (!this._meshData._materialsPBR || this._meshData._materialsPBR.length !== len) {
      var mAr = this._meshData._materialsPBR = new Float32Array(len);
      for (i = 0; i < nbVertices; ++i) {
        var j = i * 3;
        mAr[j] = DEF_ROUGHNESS;
        mAr[j + 1] = DEF_METALNESS;
        mAr[j + 2] = 1.0;
      }
    }
  }

  /** Computes faces ring around vertices */
  initFaceRings() {
    var fAr = this.getFaces();
    var nbVertices = this.getNbVertices();
    var nbFaces = this.getNbFaces();
    var i = 0;
    var id = 0;
    var countRing = new Uint32Array(nbVertices);
    for (i = 0; i < nbFaces; ++i) {
      id = i * 4;
      countRing[fAr[id]]++;
      countRing[fAr[id + 1]]++;
      countRing[fAr[id + 2]]++;
      var i4 = fAr[id + 3];
      if (i4 !== Utils.TRI_INDEX)
        countRing[i4]++;
    }

    var ringFace = this.getVerticesRingFaceStartCount();
    var acc = 0;
    for (i = 0; i < nbVertices; ++i) {
      var count = countRing[i];
      ringFace[i * 2] = acc;
      ringFace[i * 2 + 1] = count;
      acc += count;
    }

    var vrf = new Uint32Array(Utils.getMemory(4 * nbFaces * 6), 0, nbFaces * 6);
    acc = 0;
    for (i = 0; i < nbFaces; ++i) {
      id = i * 4;
      var iv1 = fAr[id];
      var iv2 = fAr[id + 1];
      var iv3 = fAr[id + 2];
      var iv4 = fAr[id + 3];
      vrf[ringFace[iv1 * 2] + (--countRing[iv1])] = i;
      vrf[ringFace[iv2 * 2] + (--countRing[iv2])] = i;
      vrf[ringFace[iv3 * 2] + (--countRing[iv3])] = i;
      if (iv4 !== Utils.TRI_INDEX) {
        vrf[ringFace[iv4 * 2] + (--countRing[iv4])] = i;
        ++acc;
      }
    }

    this._meshData._vertRingFace = new Uint32Array(vrf.subarray(0, nbFaces * 3 + acc));
  }

  /** Update a group of vertices' normal */
  updateVerticesNormal(iVerts) {
    var vrfStartCount = this.getVerticesRingFaceStartCount();
    var vertRingFace = this.getVerticesRingFace();
    var ringFaces = vertRingFace instanceof Array ? vertRingFace : null;
    var nAr = this.getNormals();
    var faceNormals = this.getFaceNormals();

    var full = iVerts === undefined;
    var nbVerts = full ? this.getNbVertices() : iVerts.length;
    for (var i = 0; i < nbVerts; ++i) {
      var ind = full ? i : iVerts[i];
      var start, end;
      if (ringFaces) {
        vertRingFace = ringFaces[ind];
        start = 0;
        end = vertRingFace.length;
      } else {
        start = vrfStartCount[ind * 2];
        end = start + vrfStartCount[ind * 2 + 1];
      }
      var nx = 0.0;
      var ny = 0.0;
      var nz = 0.0;
      for (var j = start; j < end; ++j) {
        var id = vertRingFace[j] * 3;
        nx += faceNormals[id];
        ny += faceNormals[id + 1];
        nz += faceNormals[id + 2];
      }
      var len = end - start;
      ind *= 3;
      var nLen = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (nLen > 1e-12) {
        nLen = 1.0 / nLen;
        nAr[ind] = nx * nLen;
        nAr[ind + 1] = ny * nLen;
        nAr[ind + 2] = nz * nLen;
      } else {
        nAr[ind] = 0.0;
        nAr[ind + 1] = 1.0; // Default up vector
        nAr[ind + 2] = 0.0;
      }
    }
  }

  /** Computes vertex ring around vertices */
  initVertexRings() {
    var vrvStartCount = this.getVerticesRingVertStartCount();
    var vertRingVert = this._meshData._vertRingVert = new Uint32Array(this.getNbEdges() * 2);
    var vrfStartCount = this.getVerticesRingFaceStartCount();
    var vertRingFace = this.getVerticesRingFace();
    var vertTagFlags = this.getVerticesTagFlags();
    var vertOnEdge = this.getVerticesOnEdge();
    var fAr = this.getFaces();
    var vrvStart = 0;

    for (var i = 0, l = this.getNbVertices(); i < l; ++i) {
      var tagFlag = ++Utils.TAG_FLAG;
      var vrfStart = vrfStartCount[i * 2];
      var vrfEnd = vrfStart + vrfStartCount[i * 2 + 1];
      var vrvCount = 0;

      for (var j = vrfStart; j < vrfEnd; ++j) {
        var ind = vertRingFace[j] * 4;
        var iVer1 = fAr[ind];
        var iVer2 = fAr[ind + 1];
        var iVer3 = fAr[ind + 2];
        var iVer4 = fAr[ind + 3];

        if (iVer1 === i) iVer1 = iVer4 !== Utils.TRI_INDEX ? iVer4 : iVer3;
        else if (iVer2 === i || iVer4 === i) iVer2 = iVer3;
        else if (iVer3 === i && iVer4 !== Utils.TRI_INDEX) iVer1 = iVer4;

        if (vertTagFlags[iVer1] !== tagFlag) {
          vertRingVert[vrvStart + (vrvCount++)] = iVer1;
          vertTagFlags[iVer1] = tagFlag;
        }

        if (vertTagFlags[iVer2] !== tagFlag) {
          vertRingVert[vrvStart + (vrvCount++)] = iVer2;
          vertTagFlags[iVer2] = tagFlag;
        }
      }

      vrvStartCount[i * 2] = vrvStart;
      vrvStartCount[i * 2 + 1] = vrvCount;
      vrvStart += vrvCount;
      if ((vrfEnd - vrfStart) !== vrvCount)
        vertOnEdge[i] = 1;
    }
  }

  /** Get more vertices (n-ring) */
  expandsVertices(iVerts, nRing) {
    var tagFlag = ++Utils.TAG_FLAG;
    var nbVerts = iVerts.length;
    var vrvStartCount = this.getVerticesRingVertStartCount();
    var vertRingVert = this.getVerticesRingVert();
    var ringVerts = vertRingVert instanceof Array ? vertRingVert : null;
    var vertTagFlags = this.getVerticesTagFlags();
    var acc = nbVerts;
    var nbVertices = this.getNbVertices();
    var iVertsExpanded = new Uint32Array(Utils.getMemory(4 * nbVertices), 0, nbVertices);
    iVertsExpanded.set(iVerts);

    var i = 0;
    for (i = 0; i < nbVerts; ++i)
      vertTagFlags[iVertsExpanded[i]] = tagFlag;

    var iBegin = 0;
    while (nRing) {
      --nRing;
      for (i = iBegin; i < nbVerts; ++i) {
        var idVert = iVertsExpanded[i];
        var start, end;
        if (ringVerts) {
          vertRingVert = ringVerts[idVert];
          start = 0;
          end = vertRingVert.length;
        } else {
          start = vrvStartCount[idVert * 2];
          end = start + vrvStartCount[idVert * 2 + 1];
        }

        for (var j = start; j < end; ++j) {
          var id = vertRingVert[j];
          if (vertTagFlags[id] === tagFlag)
            continue;

          vertTagFlags[id] = tagFlag;
          iVertsExpanded[acc++] = id;
        }
      }
      iBegin = nbVerts;
      nbVerts = acc;
    }

    return new Uint32Array(iVertsExpanded.subarray(0, acc));
  }

  /** Return all the vertices linked to a group of faces */
  getVerticesFromFaces(iFaces) {
    var tagFlag = ++Utils.TAG_FLAG;
    var nbFaces = iFaces.length;
    var vertTagFlags = this.getVerticesTagFlags();
    var fAr = this.getFaces();
    var acc = 0;
    var verts = new Uint32Array(Utils.getMemory(4 * iFaces.length * 4), 0, iFaces.length * 4);

    for (var i = 0; i < nbFaces; ++i) {
      var ind = iFaces[i] * 4;
      var iVer1 = fAr[ind];
      var iVer2 = fAr[ind + 1];
      var iVer3 = fAr[ind + 2];
      var iVer4 = fAr[ind + 3];
      if (vertTagFlags[iVer1] !== tagFlag) {
        vertTagFlags[iVer1] = tagFlag;
        verts[acc++] = iVer1;
      }
      if (vertTagFlags[iVer2] !== tagFlag) {
        vertTagFlags[iVer2] = tagFlag;
        verts[acc++] = iVer2;
      }
      if (vertTagFlags[iVer3] !== tagFlag) {
        vertTagFlags[iVer3] = tagFlag;
        verts[acc++] = iVer3;
      }

      if (iVer4 !== Utils.TRI_INDEX && vertTagFlags[iVer4] !== tagFlag) {
        vertTagFlags[iVer4] = tagFlag;
        verts[acc++] = iVer4;
      }
    }
    return new Uint32Array(verts.subarray(0, acc));
  }

  /** Update a group of faces normal and aabb */
  // `normalsOnly` skips the per-face box and centre. Those are read by exactly two things --
  // OctreeCell, to place a face in a cell, and Picking, to reject a face before measuring it --
  // and neither runs while a joint is moving. The NORMALS are not optional: they are what the
  // surface is shaded with, and a pose changes them.
  //
  // They go stale with the octree and come back with it, in ensureOctree(). Picking is safe
  // because it queries the tree before it reads a box (Picking.js: intersectSphere, then
  // getFaceBoxes), so there is no path to a stale box that has not just rebuilt one.
  updateFacesAabbAndNormal(iFaces, normalsOnly) {
    var faceNormals = this.getFaceNormals();
    var faceBoxes = this.getFaceBoxes();
    var faceCenters = this.getFaceCenters();
    var vAr = this.getVertices();
    var fAr = this.getFaces();

    var full = iFaces === undefined;
    var nbFaces = full ? this.getNbFaces() : iFaces.length;
    for (var i = 0; i < nbFaces; ++i) {
      var ind = full ? i : iFaces[i];
      var idTri = ind * 3;
      var idFace = ind * 4;
      var idBox = ind * 6;
      var ind1 = fAr[idFace] * 3;
      var ind2 = fAr[idFace + 1] * 3;
      var ind3 = fAr[idFace + 2] * 3;
      var ind4 = fAr[idFace + 3];
      var isQuad = ind4 !== Utils.TRI_INDEX;
      if (isQuad) ind4 *= 3;

      var v1x = vAr[ind1];
      var v1y = vAr[ind1 + 1];
      var v1z = vAr[ind1 + 2];
      var v2x = vAr[ind2];
      var v2y = vAr[ind2 + 1];
      var v2z = vAr[ind2 + 2];
      var v3x = vAr[ind3];
      var v3y = vAr[ind3 + 1];
      var v3z = vAr[ind3 + 2];

      // compute normals
      var ax = v2x - v1x;
      var ay = v2y - v1y;
      var az = v2z - v1z;
      var bx = v3x - v1x;
      var by = v3y - v1y;
      var bz = v3z - v1z;
      var crx = ay * bz - az * by;
      var cry = az * bx - ax * bz;
      var crz = ax * by - ay * bx;

      // compute boxes
      // for code readability of course
      var xmin = v1x < v2x ? v1x < v3x ? v1x : v3x : v2x < v3x ? v2x : v3x;
      var xmax = v1x > v2x ? v1x > v3x ? v1x : v3x : v2x > v3x ? v2x : v3x;
      var ymin = v1y < v2y ? v1y < v3y ? v1y : v3y : v2y < v3y ? v2y : v3y;
      var ymax = v1y > v2y ? v1y > v3y ? v1y : v3y : v2y > v3y ? v2y : v3y;
      var zmin = v1z < v2z ? v1z < v3z ? v1z : v3z : v2z < v3z ? v2z : v3z;
      var zmax = v1z > v2z ? v1z > v3z ? v1z : v3z : v2z > v3z ? v2z : v3z;

      if (isQuad) {
        var v4x = vAr[ind4];
        var v4y = vAr[ind4 + 1];
        var v4z = vAr[ind4 + 2];
        if (v4x < xmin) xmin = v4x;
        if (v4x > xmax) xmax = v4x;
        if (v4y < ymin) ymin = v4y;
        if (v4y > ymax) ymax = v4y;
        if (v4z < zmin) zmin = v4z;
        if (v4z > zmax) zmax = v4z;
        ax = v3x - v4x;
        ay = v3y - v4y;
        az = v3z - v4z;
        crx += ay * bz - az * by;
        cry += az * bx - ax * bz;
        crz += ax * by - ay * bx;
      }

      faceNormals[idTri] = crx;
      faceNormals[idTri + 1] = cry;
      faceNormals[idTri + 2] = crz;
      if (normalsOnly) continue;
      // boxes
      faceBoxes[idBox] = xmin;
      faceBoxes[idBox + 1] = ymin;
      faceBoxes[idBox + 2] = zmin;
      faceBoxes[idBox + 3] = xmax;
      faceBoxes[idBox + 4] = ymax;
      faceBoxes[idBox + 5] = zmax;
      // compute centers
      faceCenters[idTri] = (xmin + xmax) * 0.5;
      faceCenters[idTri + 1] = (ymin + ymax) * 0.5;
      faceCenters[idTri + 2] = (zmin + zmax) * 0.5;
    }
  }

  /** Update a group of faces aabb only (skip normals) */
  updateFacesAabb(iFaces) {
    var faceBoxes = this.getFaceBoxes();
    var faceCenters = this.getFaceCenters();
    var vAr = this.getVertices();
    var fAr = this.getFaces();

    var full = iFaces === undefined;
    var nbFaces = full ? this.getNbFaces() : iFaces.length;
    for (var i = 0; i < nbFaces; ++i) {
      var ind = full ? i : iFaces[i];
      var idTri = ind * 3;
      var idFace = ind * 4;
      var idBox = ind * 6;
      var ind1 = fAr[idFace] * 3;
      var ind2 = fAr[idFace + 1] * 3;
      var ind3 = fAr[idFace + 2] * 3;
      var ind4 = fAr[idFace + 3];
      var isQuad = ind4 !== Utils.TRI_INDEX;
      if (isQuad) ind4 *= 3;

      var v1x = vAr[ind1];
      var v1y = vAr[ind1 + 1];
      var v1z = vAr[ind1 + 2];
      var v2x = vAr[ind2];
      var v2y = vAr[ind2 + 1];
      var v2z = vAr[ind2 + 2];
      var v3x = vAr[ind3];
      var v3y = vAr[ind3 + 1];
      var v3z = vAr[ind3 + 2];

      // compute boxes
      var xmin = v1x < v2x ? v1x < v3x ? v1x : v3x : v2x < v3x ? v2x : v3x;
      var xmax = v1x > v2x ? v1x > v3x ? v1x : v3x : v2x > v3x ? v2x : v3x;
      var ymin = v1y < v2y ? v1y < v3y ? v1y : v3y : v2y < v3y ? v2y : v3y;
      var ymax = v1y > v2y ? v1y > v3y ? v1y : v3y : v2y > v3y ? v2y : v3y;
      var zmin = v1z < v2z ? v1z < v3z ? v1z : v3z : v2z < v3z ? v2z : v3z;
      var zmax = v1z > v2z ? v1z > v3z ? v1z : v3z : v2z > v3z ? v2z : v3z;

      if (isQuad) {
        var v4x = vAr[ind4];
        var v4y = vAr[ind4 + 1];
        var v4z = vAr[ind4 + 2];
        if (v4x < xmin) xmin = v4x;
        if (v4x > xmax) xmax = v4x;
        if (v4y < ymin) ymin = v4y;
        if (v4y > ymax) ymax = v4y;
        if (v4z < zmin) zmin = v4z;
        if (v4z > zmax) zmax = v4z;
      }

      // boxes
      faceBoxes[idBox] = xmin;
      faceBoxes[idBox + 1] = ymin;
      faceBoxes[idBox + 2] = zmin;
      faceBoxes[idBox + 3] = xmax;
      faceBoxes[idBox + 4] = ymax;
      faceBoxes[idBox + 5] = zmax;
      // compute centers
      faceCenters[idTri] = (xmin + xmax) * 0.5;
      faceCenters[idTri + 1] = (ymin + ymax) * 0.5;
      faceCenters[idTri + 2] = (zmin + zmax) * 0.5;
    }
  }

  /** Get more faces (n-ring) */
  expandsFaces(iFaces, nRing) {
    var tagFlag = ++Utils.TAG_FLAG;
    var nbFaces = iFaces.length;
    var vrfStartCount = this.getVerticesRingFaceStartCount();
    var vertRingFace = this.getVerticesRingFace();
    var ringFaces = vertRingFace instanceof Array ? vertRingFace : null;
    var ftf = this.getFacesTagFlags();
    var fAr = this.getFaces();
    var acc = nbFaces;
    var iFacesExpanded = new Uint32Array(Utils.getMemory(4 * this.getNbFaces()), 0, this.getNbFaces());
    iFacesExpanded.set(iFaces);
    var i = 0;
    for (i = 0; i < nbFaces; ++i)
      ftf[iFacesExpanded[i]] = tagFlag;
    var iBegin = 0;
    while (nRing) {
      --nRing;
      for (i = iBegin; i < nbFaces; ++i) {
        var ind = iFacesExpanded[i] * 4;

        for (var j = 0; j < 4; ++j) {
          var idv = fAr[ind + j];
          if (idv === Utils.TRI_INDEX)
            continue;

          var start, end;
          if (ringFaces) {
            vertRingFace = ringFaces[idv];
            start = 0;
            end = vertRingFace.length;
          } else {
            start = vrfStartCount[idv * 2];
            end = start + vrfStartCount[idv * 2 + 1];
          }
          for (var k = start; k < end; ++k) {
            var id = vertRingFace[k];
            if (ftf[id] === tagFlag)
              continue;
            ftf[id] = tagFlag;
            iFacesExpanded[acc++] = id;
          }
        }
      }
      iBegin = nbFaces;
      nbFaces = acc;
    }
    return new Uint32Array(iFacesExpanded.subarray(0, acc));
  }

  /** Return all the faces linked to a group of vertices */
  getFacesFromVertices(iVerts) {
    var tagFlag = ++Utils.TAG_FLAG;
    var nbVerts = iVerts.length;
    var vrfStartCount = this.getVerticesRingFaceStartCount();
    var vertRingFace = this.getVerticesRingFace();
    var ringFaces = vertRingFace instanceof Array ? vertRingFace : null;
    var ftf = this.getFacesTagFlags();
    var acc = 0;
    var iFaces = new Uint32Array(Utils.getMemory(4 * this.getNbFaces()), 0, this.getNbFaces());
    for (var i = 0; i < nbVerts; ++i) {
      var idVert = iVerts[i];
      var start, end;
      if (ringFaces) {
        vertRingFace = ringFaces[idVert];
        start = 0;
        end = vertRingFace.length;
      } else {
        start = vrfStartCount[idVert * 2];
        end = start + vrfStartCount[idVert * 2 + 1];
      }
      for (var j = start; j < end; ++j) {
        var iFace = vertRingFace[j];
        if (ftf[iFace] !== tagFlag) {
          ftf[iFace] = tagFlag;
          iFaces[acc++] = iFace;
        }
      }
    }
    return new Uint32Array(iFaces.subarray(0, acc));
  }

  /** Computes triangles */
  initRenderTriangles() {
    if (this.hasUV())
      this._meshData._UVtrianglesABC = this.computeTrianglesFromFaces(this.getFacesTexCoord());
    this._meshData._trianglesABC = this.computeTrianglesFromFaces(this.getFaces());
  }

  /** Computes triangles from faces */
  computeTrianglesFromFaces(faces) {
    var nbFaces = this.getNbFaces();
    var facesToTris = this.getFacesToTriangles();
    var iAr = new Uint32Array(Utils.getMemory(4 * nbFaces * 6), 0, nbFaces * 6);
    var acc = 0;
    for (var i = 0; i < nbFaces; ++i) {
      facesToTris[i] = acc;
      var iFace = i * 4;
      var iv1 = faces[iFace];
      var iv2 = faces[iFace + 1];
      var iv3 = faces[iFace + 2];
      var iv4 = faces[iFace + 3];
      var iTri = acc * 3;
      iAr[iTri] = iv1;
      iAr[iTri + 1] = iv2;
      iAr[iTri + 2] = iv3;
      ++acc;
      if (iv4 !== Utils.TRI_INDEX) {
        iTri = acc * 3;
        iAr[iTri] = iv1;
        iAr[iTri + 1] = iv3;
        iAr[iTri + 2] = iv4;
        ++acc;
      }
    }
    var view = new Uint32Array(iAr.subarray(0, acc * 3));
    return new Uint32Array(view); // Create an absolute, independent copy!
  }

  initEdges() {
    var fAr = this.getFaces();
    var feAr = this.getFaceEdges();
    var nbEdges = 0;
    var vertEdgeTemp = new Uint32Array(this.getNbVertices());
    var vrfStartCount = this.getVerticesRingFaceStartCount();
    var vertRingFace = this.getVerticesRingFace();
    for (var i = 0, nbVerts = this.getNbVertices(); i < nbVerts; ++i) {
      var start = vrfStartCount[i * 2];
      var end = start + vrfStartCount[i * 2 + 1];
      var compTest = nbEdges;
      for (var j = start; j < end; ++j) {
        var id = vertRingFace[j] * 4;
        var iv1 = fAr[id];
        var iv2 = fAr[id + 1];
        var iv3 = fAr[id + 2];
        var iv4 = fAr[id + 3];
        var t = 0;
        var idEdge = 0;
        if (iv4 === Utils.TRI_INDEX) {
          if (i > iv1) {
            t = vertEdgeTemp[iv1];
            idEdge = id + (i === iv2 ? 0 : 2);
            if (t <= compTest) {
              feAr[idEdge] = nbEdges;
              vertEdgeTemp[iv1] = ++nbEdges;
            } else {
              feAr[idEdge] = t - 1;
            }
          }
          if (i > iv2) {
            t = vertEdgeTemp[iv2];
            idEdge = id + (i === iv1 ? 0 : 1);
            if (t <= compTest) {
              feAr[idEdge] = nbEdges;
              vertEdgeTemp[iv2] = ++nbEdges;
            } else {
              feAr[idEdge] = t - 1;
            }
          }
          if (i > iv3) {
            t = vertEdgeTemp[iv3];
            idEdge = id + (i === iv1 ? 2 : 1);
            if (t <= compTest) {
              feAr[idEdge] = nbEdges;
              vertEdgeTemp[iv3] = ++nbEdges;
            } else {
              feAr[idEdge] = t - 1;
            }
          }
          feAr[id + 3] = Utils.TRI_INDEX;
        } else {
          if (i > iv1 && i !== iv3) {
            t = vertEdgeTemp[iv1];
            idEdge = id + (i === iv2 ? 0 : 3);
            if (t <= compTest) {
              feAr[idEdge] = nbEdges;
              vertEdgeTemp[iv1] = ++nbEdges;
            } else {
              feAr[idEdge] = t - 1;
            }
          }
          if (i > iv2 && i !== iv4) {
            t = vertEdgeTemp[iv2];
            idEdge = id + (i === iv1 ? 0 : 1);
            if (t <= compTest) {
              feAr[idEdge] = nbEdges;
              vertEdgeTemp[iv2] = ++nbEdges;
            } else {
              feAr[idEdge] = t - 1;
            }
          }
          if (i > iv3 && i !== iv1) {
            t = vertEdgeTemp[iv3];
            idEdge = id + (i === iv2 ? 1 : 2);
            if (t <= compTest) {
              feAr[idEdge] = nbEdges;
              vertEdgeTemp[iv3] = ++nbEdges;
            } else {
              feAr[idEdge] = t - 1;
            }
          }
          if (i > iv4 && i !== iv2) {
            t = vertEdgeTemp[iv4];
            idEdge = id + (i === iv1 ? 3 : 2);
            if (t <= compTest) {
              feAr[idEdge] = nbEdges;
              vertEdgeTemp[iv4] = ++nbEdges;
            } else {
              feAr[idEdge] = t - 1;
            }
          }
        }
      }
    }
    var eAr = this._meshData._edges = new Uint8ClampedArray(nbEdges);
    for (var k = 0, nbFaces = this.getNbFaces(); k < nbFaces; ++k) {
      var idf = k * 4;
      eAr[feAr[idf]]++;
      eAr[feAr[idf + 1]]++;
      eAr[feAr[idf + 2]]++;
      var i4 = feAr[idf + 3];
      if (i4 !== Utils.TRI_INDEX)
        eAr[i4]++;
    }
  }

  /** Return wireframe array (or compute it if not up to date) */
  getWireframe(forceIndexed) {
    var nbEdges = this.getNbEdges();
    var cdw;
    // The wireframe can always render from the indexed vertex layout, independent of
    // whether the main mesh is drawn via draw-arrays (group view). forceIndexed keeps
    // it off the draw-arrays layout entirely (that path desynced with the DA buffer).
    var useDrawArrays = forceIndexed ? false : this.isUsingDrawArrays();
    if (useDrawArrays) {
      if (this._meshData._drawArraysWireframe && this._meshData._drawArraysWireframe.length === nbEdges * 2) {
        return this._meshData._drawArraysWireframe;
      }
      cdw = this._meshData._drawArraysWireframe = new Uint32Array(nbEdges * 2);
    } else {
      if (this._meshData._drawElementsWireframe && this._meshData._drawElementsWireframe.length === nbEdges * 2) {
        return this._meshData._drawElementsWireframe;
      }
      cdw = this._meshData._drawElementsWireframe = new Uint32Array(nbEdges * 2);
    }

    var fAr = this.getFaces();
    var feAr = this.getFaceEdges();
    var nbFaces = this.getNbFaces();
    // Match updateDrawArrays: pure-triangle meshes don't maintain _facesToTriangles
    // (it stays zero-filled), so fall back to the face index directly. Reading the
    // stale array here collapsed every draw-arrays wireframe edge onto triangle 0.
    var facesToTris = this.hasOnlyTriangles() ? null : this.getFacesToTriangles();

    var nbLines = 0;
    var tagEdges = new Uint8Array(nbEdges);

    for (var i = 0; i < nbFaces; ++i) {
      var id = i * 4;

      var iv1, iv2, iv3;
      var iv4 = fAr[id + 3];
      var isQuad = iv4 !== Utils.TRI_INDEX;

      if (useDrawArrays) {
        var idTri = (facesToTris ? facesToTris[i] : i) * 3;
        iv1 = idTri;
        iv2 = idTri + 1;
        iv3 = idTri + 2;
        if (isQuad) iv4 = idTri + 5;
      } else {
        iv1 = fAr[id];
        iv2 = fAr[id + 1];
        iv3 = fAr[id + 2];
      }

      var ide1 = feAr[id];
      var ide2 = feAr[id + 1];
      var ide3 = feAr[id + 2];
      var ide4 = feAr[id + 3];

      if (tagEdges[ide1] === 0) {
        tagEdges[ide1] = 1;
        cdw[nbLines * 2] = iv1;
        cdw[nbLines * 2 + 1] = iv2;
        nbLines++;
      }
      if (tagEdges[ide2] === 0) {
        tagEdges[ide2] = 1;
        cdw[nbLines * 2] = iv2;
        cdw[nbLines * 2 + 1] = iv3;
        nbLines++;
      }
      if (tagEdges[ide3] === 0) {
        tagEdges[ide3] = 1;
        cdw[nbLines * 2] = iv3;
        cdw[nbLines * 2 + 1] = isQuad ? iv4 : iv1;
        nbLines++;
      }
      if (isQuad && tagEdges[ide4] === 0) {
        tagEdges[ide4] = 1;
        cdw[nbLines * 2] = iv4;
        cdw[nbLines * 2 + 1] = iv1;
        nbLines++;
      }
    }
    return useDrawArrays ? this._meshData._drawArraysWireframe : this._meshData._drawElementsWireframe;
  }

  updateDuplicateGeometry(iVerts) {
    if (!this.isUsingTexCoords() || !this.hasUV())
      return;

    var vAr = this.getVertices();
    var cAr = this.getColors();
    var mAr = this.getMaterials();
    var nAr = this.getNormals();
    var startCount = this.getVerticesDuplicateStartCount();

    var full = iVerts === undefined;
    var nbVerts = full ? this.getNbVertices() : iVerts.length;
    for (var i = 0; i < nbVerts; ++i) {
      var ind = full ? i : iVerts[i];
      var start = startCount[ind * 2];
      if (start === 0)
        continue;

      var end = start + startCount[ind * 2 + 1];
      var idOrig = ind * 3;
      var vx = vAr[idOrig];
      var vy = vAr[idOrig + 1];
      var vz = vAr[idOrig + 2];
      var nx = nAr[idOrig];
      var ny = nAr[idOrig + 1];
      var nz = nAr[idOrig + 2];
      var cx = cAr[idOrig];
      var cy = cAr[idOrig + 1];
      var cz = cAr[idOrig + 2];
      var mx = mAr[idOrig];
      var my = mAr[idOrig + 1];
      var mz = mAr[idOrig + 2];
      for (var j = start; j < end; ++j) {
        var idDup = j * 3;
        vAr[idDup] = vx;
        vAr[idDup + 1] = vy;
        vAr[idDup + 2] = vz;
        nAr[idDup] = nx;
        nAr[idDup + 1] = ny;
        nAr[idDup + 2] = nz;
        cAr[idDup] = cx;
        cAr[idDup + 1] = cy;
        cAr[idDup + 2] = cz;
        mAr[idDup] = mx;
        mAr[idDup + 1] = my;
        mAr[idDup + 2] = mz;
      }
    }
  }

  updateDuplicateColorsAndMaterials(iVerts) {
    if (!this.isUsingTexCoords() || !this.hasUV())
      return;

    var cAr = this.getColors();
    var mAr = this.getMaterials();
    var nAr = this.getNormals();
    var startCount = this.getVerticesDuplicateStartCount();

    var full = iVerts === undefined;
    var nbVerts = full ? this.getNbVertices() : iVerts.length;
    for (var i = 0; i < nbVerts; ++i) {
      var ind = full ? i : iVerts[i];
      var start = startCount[ind * 2];
      if (start === 0)
        continue;

      var end = start + startCount[ind * 2 + 1];
      var idOrig = ind * 3;
      var cx = cAr[idOrig];
      var cy = cAr[idOrig + 1];
      var cz = cAr[idOrig + 2];
      var mx = mAr[idOrig];
      var my = mAr[idOrig + 1];
      var mz = mAr[idOrig + 2];
      
      var nx = 0, ny = 0, nz = 0;
      if (nAr) {
        nx = nAr[idOrig];
        ny = nAr[idOrig + 1];
        nz = nAr[idOrig + 2];
      }

      var vrfStartCount = this.getVerticesRingFaceStartCount();
      const origHasFaces = vrfStartCount[ind * 2 + 1] > 0;

      for (var j = start; j < end; ++j) {
        var idDup = j * 3;
        cAr[idDup] = cx;
        cAr[idDup + 1] = cy;
        cAr[idDup + 2] = cz;
        mAr[idDup] = mx;
        mAr[idDup + 1] = my;
        mAr[idDup + 2] = mz;
        // Only overwrite duplicate normal if the original actually has faces!
        // This prevents zero normals of unused vertices from blanking out used duplicates.
        if (nAr && origHasFaces) {
          nAr[idDup] = nx;
          nAr[idDup + 1] = ny;
          nAr[idDup + 2] = nz;
        }
      }
    }
  }

  initTexCoordsDataFromOBJData(uvAr, uvfArOrig) {
    var fAr = this.getFaces();
    var len = fAr.length;

    if (len != uvfArOrig.length) return;
    var nbUV = uvAr.length / 2;

    // fix integrity (bug with sgl export??)
    for (i = 0; i < len; ++i) {
      if (uvfArOrig[i] >= nbUV) {
        uvfArOrig[i] = fAr[i];
      }
    }

    var nbVertices = this.getNbVertices();
    var i = 0;
    var j = 0;
    var iv = 0;
    var tag = 0;

    // detect duplicates vertices because of tex coords
    var tagV = new Int32Array(nbVertices);
    // vertex without uv might receive random values...
    var tArTemp = new Float32Array(Utils.getMemory(nbVertices * 4 * 2), 0, nbVertices * 2);
    var dup = [];
    var acc = 0;
    var nbDuplicates = 0;
    for (i = 0; i < len; ++i) {
      iv = fAr[i];
      if (iv === Utils.TRI_INDEX)
        continue;

      var uv = uvfArOrig[i];
      tag = tagV[iv];
      if (tag === (uv + 1))
        continue;

      if (tag === 0) {
        tagV[iv] = uv + 1;
        tArTemp[iv * 2] = uvAr[uv * 2];
        tArTemp[iv * 2 + 1] = uvAr[uv * 2 + 1];
        continue;
      }

      // first duplicate
      if (tag > 0) {
        tagV[iv] = --acc;
        dup.push([uv]);
        ++nbDuplicates;
        continue;
      }
      // check if we need to insert a new duplicate
      var dupArray = dup[-tag - 1];
      var nbDup = dupArray.length;
      for (j = 0; j < nbDup; ++j) {
        if (dupArray[j] === uv)
          break;
      }
      // insert new duplicate
      if (j === nbDup) {
        ++nbDuplicates;
        dupArray.push(uv);
      }
    }

    // order the duplicates vertices (and tex coords)
    var tAr = new Float32Array((nbVertices + nbDuplicates) * 2);
    tAr.set(tArTemp);
    var startCount = this._meshData._duplicateStartCount = new Uint32Array(nbVertices * 2);
    acc = 0;
    for (i = 0; i < nbVertices; ++i) {
      tag = tagV[i];
      if (tag >= 0)
        continue;

      var dAr = dup[-tag - 1];
      var nbDu = dAr.length;
      var start = nbVertices + acc;
      startCount[i * 2] = start;
      startCount[i * 2 + 1] = nbDu;
      acc += nbDu;
      for (j = 0; j < nbDu; ++j) {
        var idUv = dAr[j] * 2;
        var idUvCoord = (start + j) * 2;
        tAr[idUvCoord] = uvAr[idUv];
        tAr[idUvCoord + 1] = uvAr[idUv + 1];
      }
    }

    // create faces that uses duplicates vertices (with textures coordinates)
    var uvfAr = new Uint32Array(fAr);
    len = fAr.length;
    for (i = 0; i < len; ++i) {
      iv = uvfAr[i];
      if (iv === Utils.TRI_INDEX)
        continue;

      tag = tagV[iv];
      if (tag > 0)
        continue;

      var idtex = uvfArOrig[i];
      var dArray = dup[-tag - 1];
      var nbEl = dArray.length;
      for (j = 0; j < nbEl; ++j) {
        if (idtex === dArray[j]) {
          uvfAr[i] = startCount[iv * 2] + j;
          break;
        }
      }
    }

    this.setTexCoords(tAr);
    this.setFacesTexCoord(uvfAr);
  }

  setAlreadyDrawArrays() {
    // kind of a hack, to be used if the main arrays are already draw arrays
    this._meshData._DAverticesXYZ = this.getVertices();
    this._meshData._DAnormalsXYZ = this.getNormals();
    this._meshData._DAcolorsRGB = this.getColors();
    this._meshData._DAmaterialsPBR = this.getMaterials();
  }

  /** Updates the arrays that are going to be used by webgl */
  updateDrawArrays(iFaces) {
    if (!this.isUsingDrawArrays())
      return;

    var vAr = this.getVertices();
    var nAr = this.getNormals();
    var cAr = this.getColors();
    var mAr = this.getMaterials();

    var fAr = this.getFaces();

    var nbTriangles = this.getNbTriangles();
    var facesToTris = this.hasOnlyTriangles() ? null : this.getFacesToTriangles();

    var full = iFaces === undefined;
    var cdv = this._meshData._DAverticesXYZ;
    var cdn = this._meshData._DAnormalsXYZ;
    var cdc = this._meshData._DAcolorsRGB;
    var cdm = this._meshData._DAmaterialsPBR;

    if (!cdv || cdv.length < nbTriangles * 9) {
      this._meshData._DAverticesXYZ = new Float32Array(nbTriangles * 9);
      this._meshData._DAnormalsXYZ = new Float32Array(nbTriangles * 9);
      this._meshData._DAcolorsRGB = new Float32Array(nbTriangles * 9);
      this._meshData._DAmaterialsPBR = new Float32Array(nbTriangles * 9);

      // We MUST copy the old data over if this is a PARTIAL update (iFaces !== undefined)!
      if (!full && cdv) {
        this._meshData._DAverticesXYZ.set(cdv);
        this._meshData._DAnormalsXYZ.set(cdn);
        this._meshData._DAcolorsRGB.set(cdc);
        this._meshData._DAmaterialsPBR.set(cdm);
      }
      
      cdv = this._meshData._DAverticesXYZ;
      cdn = this._meshData._DAnormalsXYZ;
      cdc = this._meshData._DAcolorsRGB;
      cdm = this._meshData._DAmaterialsPBR;
    }
    // console.log("Mesh: updateDrawArrays called", full ? "FULL" : "PARTIAL", full ? this.getNbFaces() : iFaces.length);

    // Group-view: tint each face by its group id instead of its vertex colors.
    var showGroups = this._renderData._showFacesGroups && this._meshData._facesGroups;
    var groupsAr = showGroups ? this._meshData._facesGroups : null;
    var groupCol = showGroups ? [0.0, 0.0, 0.0] : null;

    var nbFaces = full ? this.getNbFaces() : iFaces.length;
    for (var i = 0; i < nbFaces; ++i) {
      var idFace = full ? i : iFaces[i];
      var ftt = facesToTris ? facesToTris[idFace] : idFace;
      var vId = ftt * 9;

      if (showGroups) this.getFaceGroupColor(groupsAr[idFace], groupCol);

      idFace *= 4;
      var id1 = fAr[idFace] * 3;
      var id2 = fAr[idFace + 1] * 3;
      var id3 = fAr[idFace + 2] * 3;

      // coordinates
      cdv[vId] = vAr[id1];
      cdv[vId + 1] = vAr[id1 + 1];
      cdv[vId + 2] = vAr[id1 + 2];
      cdv[vId + 3] = vAr[id2];
      cdv[vId + 4] = vAr[id2 + 1];
      cdv[vId + 5] = vAr[id2 + 2];
      cdv[vId + 6] = vAr[id3];
      cdv[vId + 7] = vAr[id3 + 1];
      cdv[vId + 8] = vAr[id3 + 2];

      // color (per-face group tint when group-view is on, else per-vertex colors)
      if (showGroups) {
        var gr = groupCol[0], gg = groupCol[1], gb = groupCol[2];
        cdc[vId] = cdc[vId + 3] = cdc[vId + 6] = gr;
        cdc[vId + 1] = cdc[vId + 4] = cdc[vId + 7] = gg;
        cdc[vId + 2] = cdc[vId + 5] = cdc[vId + 8] = gb;
      } else {
        cdc[vId] = cAr[id1];
        cdc[vId + 1] = cAr[id1 + 1];
        cdc[vId + 2] = cAr[id1 + 2];
        cdc[vId + 3] = cAr[id2];
        cdc[vId + 4] = cAr[id2 + 1];
        cdc[vId + 5] = cAr[id2 + 2];
        cdc[vId + 6] = cAr[id3];
        cdc[vId + 7] = cAr[id3 + 1];
        cdc[vId + 8] = cAr[id3 + 2];
      }

      // material
      cdm[vId] = mAr[id1];
      cdm[vId + 1] = mAr[id1 + 1];
      cdm[vId + 2] = mAr[id1 + 2];
      cdm[vId + 3] = mAr[id2];
      cdm[vId + 4] = mAr[id2 + 1];
      cdm[vId + 5] = mAr[id2 + 2];
      cdm[vId + 6] = mAr[id3];
      cdm[vId + 7] = mAr[id3 + 1];
      cdm[vId + 8] = mAr[id3 + 2];

      // normals
      cdn[vId] = nAr[id1];
      cdn[vId + 1] = nAr[id1 + 1];
      cdn[vId + 2] = nAr[id1 + 2];
      cdn[vId + 3] = nAr[id2];
      cdn[vId + 4] = nAr[id2 + 1];
      cdn[vId + 5] = nAr[id2 + 2];
      cdn[vId + 6] = nAr[id3];
      cdn[vId + 7] = nAr[id3 + 1];
      cdn[vId + 8] = nAr[id3 + 2];

      var id4 = fAr[idFace + 3];
      if (id4 === Utils.TRI_INDEX)
        continue;
      id4 *= 3;

      vId += 9;
      // coordinates
      cdv[vId] = vAr[id1];
      cdv[vId + 1] = vAr[id1 + 1];
      cdv[vId + 2] = vAr[id1 + 2];
      cdv[vId + 3] = vAr[id3];
      cdv[vId + 4] = vAr[id3 + 1];
      cdv[vId + 5] = vAr[id3 + 2];
      cdv[vId + 6] = vAr[id4];
      cdv[vId + 7] = vAr[id4 + 1];
      cdv[vId + 8] = vAr[id4 + 2];

      // colors (second triangle of the quad — same group tint as the first)
      if (showGroups) {
        cdc[vId] = cdc[vId + 3] = cdc[vId + 6] = groupCol[0];
        cdc[vId + 1] = cdc[vId + 4] = cdc[vId + 7] = groupCol[1];
        cdc[vId + 2] = cdc[vId + 5] = cdc[vId + 8] = groupCol[2];
      } else {
        cdc[vId] = cAr[id1];
        cdc[vId + 1] = cAr[id1 + 1];
        cdc[vId + 2] = cAr[id1 + 2];
        cdc[vId + 3] = cAr[id3];
        cdc[vId + 4] = cAr[id3 + 1];
        cdc[vId + 5] = cAr[id3 + 2];
        cdc[vId + 6] = cAr[id4];
        cdc[vId + 7] = cAr[id4 + 1];
        cdc[vId + 8] = cAr[id4 + 2];
      }

      // materials
      cdm[vId] = mAr[id1];
      cdm[vId + 1] = mAr[id1 + 1];
      cdm[vId + 2] = mAr[id1 + 2];
      cdm[vId + 3] = mAr[id3];
      cdm[vId + 4] = mAr[id3 + 1];
      cdm[vId + 5] = mAr[id3 + 2];
      cdm[vId + 6] = mAr[id4];
      cdm[vId + 7] = mAr[id4 + 1];
      cdm[vId + 8] = mAr[id4 + 2];

      // normals
      cdn[vId] = nAr[id1];
      cdn[vId + 1] = nAr[id1 + 1];
      cdn[vId + 2] = nAr[id1 + 2];
      cdn[vId + 3] = nAr[id3];
      cdn[vId + 4] = nAr[id3 + 1];
      cdn[vId + 5] = nAr[id3 + 2];
      cdn[vId + 6] = nAr[id4];
      cdn[vId + 7] = nAr[id4 + 1];
      cdn[vId + 8] = nAr[id4 + 2];
    }

    if (this.isUsingTexCoords())
      this.updateDrawArraysTexCoord(iFaces);
  }

  /** Updates the UV array data for drawArrays */
  updateDrawArraysTexCoord(iFaces) {
    var nbTriangles = this.getNbTriangles();
    var facesToTris = this.getFacesToTriangles();

    var full = iFaces === undefined;
    var cdt = this._meshData._DAtexCoordsST;
    if (!cdt || cdt.length !== nbTriangles * 6)
      cdt = this._meshData._DAtexCoordsST = new Float32Array(nbTriangles * 6);

    var tAr = this.getTexCoords();
    var fArUV = this.getFacesTexCoord();

    var nbFaces = full ? this.getNbFaces() : iFaces.length;
    for (var i = 0; i < nbFaces; ++i) {
      var idFace = full ? i : iFaces[i];
      var ftt = facesToTris[idFace];
      var vIduv = ftt * 6;

      idFace *= 4;
      var id1uv = fArUV[idFace] * 2;
      var id2uv = fArUV[idFace + 1] * 2;
      var id3uv = fArUV[idFace + 2] * 2;

      cdt[vIduv] = tAr[id1uv];
      cdt[vIduv + 1] = tAr[id1uv + 1];
      cdt[vIduv + 2] = tAr[id2uv];
      cdt[vIduv + 3] = tAr[id2uv + 1];
      cdt[vIduv + 4] = tAr[id3uv];
      cdt[vIduv + 5] = tAr[id3uv + 1];

      var id4uv = fArUV[idFace + 3];
      if (id4uv === Utils.TRI_INDEX)
        continue;
      id4uv *= 3;

      vIduv += 6;
      cdt[vIduv] = tAr[id1uv];
      cdt[vIduv + 1] = tAr[id1uv + 1];
      cdt[vIduv + 2] = tAr[id3uv];
      cdt[vIduv + 3] = tAr[id3uv + 1];
      cdt[vIduv + 4] = tAr[id4uv];
      cdt[vIduv + 5] = tAr[id4uv + 1];
    }
  }

  /////////////////
  // TRANSFORM DATA
  /////////////////
  updateCenter() {
    var box = this.getLocalBound();
    vec3.set(this._transformData._center, (box[0] + box[3]) * 0.5, (box[1] + box[4]) * 0.5, (box[2] + box[5]) * 0.5);
  }

  /** Pre compute mv and mvp matrices as well as the depth center */
  updateMatrices(camera) {
    mat3.normalFromMat4(this._transformData._lastComputedEN, this._transformData._editMatrix);
    mat4.mul(this._transformData._lastComputedMV, camera.getView(), this._transformData._matrix);
    mat3.normalFromMat4(this._transformData._lastComputedN, this._transformData._lastComputedMV);
    mat4.mul(this._transformData._lastComputedMVP, camera.getProjection(), this._transformData._lastComputedMV);
    var cen = this._transformData._center;
    var m = this._transformData._lastComputedMVP;
    this._transformData._lastComputedDepth = m[2] * cen[0] + m[6] * cen[1] + m[10] * cen[2] + m[14];
    
    // Sync to Three.js Mesh
    if (this._renderData && this._renderData._threeMesh) {
      // Set the local matrix from the sculptor's math. The desktop gizmo writes the
      // real _matrix live during a drag, so parented children and the wireframe
      // follow through the native scene graph — no editMatrix preview fold needed.
      this._renderData._threeMesh.matrixAutoUpdate = false;
      this._renderData._threeMesh.matrix.fromArray(this._transformData._matrix);

      // CRITICAL FIX: Do NOT blindly copy 'matrix' to 'matrixWorld'
      // WebXR requires objects to inherit transforms from their parents (like 'worldGroup' or the Scene itself).
      // By calling updateMatrixWorld(true), Three.js correctly calculates the final world position
      // including any VR specific scaling or scene offsets!
      this._renderData._threeMesh.updateMatrixWorld(true);
    }
  }

  computeLocalRadius() {
    var box = this.getLocalBound();
    return 0.5 * vec3.dist([box[0], box[1], box[2]], [box[3], box[4], box[5]]);
  }

  normalizeSize() {
    var radius = this.computeLocalRadius();
    if (isNaN(radius) || radius === 0) {
        return;
    }
    var scale = Utils.SCALE / (2.0 * radius);
    mat4.scale(this._transformData._matrix, this._transformData._matrix, [scale, scale, scale]);
  }

  computeWorldBound() {
    var worldb = this._meshData._worldBound;
    var localb = this.getLocalBound();
    var mat = this.getMatrix();

    // trans
    worldb[0] = worldb[3] = mat[12];
    worldb[1] = worldb[4] = mat[13];
    worldb[2] = worldb[5] = mat[14];
    
    // If the mesh is empty or uninitialized, localb is Infinity.
    // Skip rotation math to prevent NaN cascades.
    if (!Number.isFinite(localb[0])) {
        worldb[0] = localb[0]; worldb[1] = localb[1]; worldb[2] = localb[2];
        worldb[3] = localb[3]; worldb[4] = localb[4]; worldb[5] = localb[5];
        return worldb;
    }

    // rotate per component
    for (var i = 0; i < 3; ++i) {
      var i4 = i * 4;
      var mini = localb[i];
      var maxi = localb[i + 3];
      for (var j = 0; j < 3; ++j) {
        var cm = mat[i4 + j];
        var a = cm * maxi;
        var b = cm * mini;
        if (a < b) {
          worldb[j] += a;
          worldb[j + 3] += b;
        } else {
          worldb[j] += b;
          worldb[j + 3] += a;
        }
      }
    }
    
    for(var k=0; k<6; k++) {
        if(isNaN(worldb[k])) {
            console.error("🛑 computeWorldBound produced NaN! LocalBounds:", localb, "Matrix:", mat);
            if(window.screenLog) window.screenLog("NaN WorldBound", "red");
            break;
        }
    }

    return worldb;
  }

  /////////
  // OCTREE
  /////////

  // Rebuild an octree that a pose refresh deliberately skipped. Called from the QUERIES rather
  // than from getOctree(), because getOctree() is also read per frame for nothing more than a
  // loose bound (Gizmo's scale heuristic) -- forcing a rebuild there would hand back every
  // millisecond this saves. A stale loose bound is harmless; a stale ANSWER is not.
  ensureOctree() {
    if (!this._meshData._octreeStale) return;
    this._meshData._octreeStale = false;
    // The boxes and centres were skipped along with the tree, and the tree is built FROM them.
    // Rebuilding the octree over stale boxes would place every face by where it used to be,
    // which is a wrong answer rather than a slow one.
    this.updateFacesAabbAndNormal();
    this.computeOctree();
  }

  /** Return faces intersected by a ray */
  intersectRay(vNear, eyeDir, collectLeaves) {
    var nbFaces = this.getNbFaces();
    this.ensureOctree();
    // Safe guard: Octree might not be initialized
    if (!this._meshData._octree) return [];
    var collectFaces = new Uint32Array(Utils.getMemory(nbFaces * 4), 0, nbFaces);
    return this._meshData._octree.collectIntersectRay(vNear, eyeDir, collectFaces, collectLeaves ? this._meshData._leavesToUpdate : undefined);
  }

  /** Return faces inside a sphere */
  intersectSphere(vert, radiusSquared, collectLeaves) {
    var nbFaces = this.getNbFaces();
    this.ensureOctree();
    // Safe guard: Octree might not be initialized
    if (!this._meshData._octree) return [];
    var collectFaces = new Uint32Array(Utils.getMemory(nbFaces * 4), 0, nbFaces);
    return this._meshData._octree.collectIntersectSphere(vert, radiusSquared, collectFaces, collectLeaves ? this._meshData._leavesToUpdate : undefined);
  }


  /** Update Octree */
  updateOctree(iFaces) {
    // An incremental update moves faces between cells of the tree it already has. If a pose
    // refresh skipped the rebuild, that tree describes an older pose, and shuffling today's
    // faces around inside it leaves a structure that matches neither.
    this.ensureOctree();
    // Incremental update for standard sculpt strokes: move the modified faces between
    // octree cells and refresh loose AABBs so the sphere query stays accurate mid-stroke.
    // (Previously this called octree.build(this, iFaces), which is a no-op on an already
    // -subdivided tree -> the octree froze at stroke-start positions, so big-brush strokes
    // lost most of their picked vertices and produced blocky/uneven flattening.
    // The no-arg path that voxel remeshing uses still does a full computeOctree.)
    if (iFaces) {
      if (this._meshData._octree)
        this.updateOctreeAdd(this.updateOctreeRemove(iFaces));
      else
        this.computeOctree();
    } else {
      this.computeOctree();
    }
  }

  computeAabb() {
    var nbVertices = this.getNbVertices();
    var vAr = this.getVertices();
    var xmin = Infinity;
    var ymin = Infinity;
    var zmin = Infinity;
    var xmax = -Infinity;
    var ymax = -Infinity;
    var zmax = -Infinity;
    for (var i = 0; i < nbVertices; ++i) {
      var j = i * 3;
      var vx = vAr[j];
      var vy = vAr[j + 1];
      var vz = vAr[j + 2];
      if (vx < xmin) xmin = vx;
      if (vx > xmax) xmax = vx;
      if (vy < ymin) ymin = vy;
      if (vy > ymax) ymax = vy;
      if (vz < zmin) zmin = vz;
      if (vz > zmax) zmax = vz;
    }
    return [xmin, ymin, zmin, xmax, ymax, zmax];
  }

  /** Compute the octree */
  computeOctree() {
    this._meshData._octreeStale = false;   // however we got here, the tree is current again
    var abRoot = this.computeAabb();
    var xmin = abRoot[0];
    var ymin = abRoot[1];
    var zmin = abRoot[2];
    var xmax = abRoot[3];
    var ymax = abRoot[4];
    var zmax = abRoot[5];
    var dx = xmax - xmin;
    var dy = ymax - ymin;
    var dz = zmax - zmin;

    // add minimal thickness
    var offset = Math.sqrt(dx * dx + dy * dy + dz * dz) * 0.2;
    var eps = 1e-16;
    if (xmax - xmin < eps) {
      xmin -= offset;
      xmax += offset;
    }
    if (ymax - ymin < eps) {
      ymin -= offset;
      ymax += offset;
    }
    if (zmax - zmin < eps) {
      zmin -= offset;
      zmax += offset;
    }

    // root octree bigger than minimum aabb... (to avoid too many octree rebuild)
    var dfx = dx * 0.3;
    var dfy = dy * 0.3;
    var dfz = dz * 0.3;
    var xmin2 = xmin - dfx;
    var xmax2 = xmax + dfx;
    var ymin2 = ymin - dfy;
    var ymax2 = ymax + dfy;
    var zmin2 = zmin - dfz;
    var zmax2 = zmax + dfz;

    // octree construction
    if (this._meshData._octree) this._meshData._octree.release();
    var octree = this._meshData._octree = OctreeCell.getFree();
    octree.resetNbFaces(this.getNbFaces());
    octree.setAabbLoose(xmin, ymin, zmin, xmax, ymax, zmax);
    octree.setAabbSplit(xmin2, ymin2, zmin2, xmax2, ymax2, zmax2);
    octree.build(this);
  }

  updateOctreeRemove(iFaces) {
    var faceCenters = this.getFaceCenters();
    var fboxes = this.getFaceBoxes();
    var facePosInLeaf = this._meshData._facePosInLeaf;
    var faceLeaf = this._meshData._faceLeaf;
    var nbFaces = iFaces.length;
    var acc = 0;
    var facesToMove = new Uint32Array(Utils.getMemory(4 * nbFaces), 0, nbFaces);
    // recompute position inside the octree
    for (var i = 0; i < nbFaces; ++i) {
      var idFace = iFaces[i];
      var idb = idFace * 6;
      var idCen = idFace * 3;
      var leaf = faceLeaf[idFace];
      var ab = leaf._aabbSplit;

      var vx = faceCenters[idCen];
      var vy = faceCenters[idCen + 1];
      var vz = faceCenters[idCen + 2];

      if (vx <= ab[0] || vy <= ab[1] || vz <= ab[2] || vx > ab[3] || vy > ab[4] || vz > ab[5]) {
        // a face center has moved from its cell
        facesToMove[acc++] = iFaces[i];
        var facesInLeaf = leaf._iFaces;
        if (facesInLeaf.length > 0) { // remove faces from octree cell
          var iFaceLast = facesInLeaf[facesInLeaf.length - 1];
          var iPos = facePosInLeaf[idFace];
          facesInLeaf[iPos] = iFaceLast;
          facePosInLeaf[iFaceLast] = iPos;
          facesInLeaf.pop();
        }
      } else { // expands cell aabb loose if necessary
        leaf.expandsAabbLoose(fboxes[idb], fboxes[idb + 1], fboxes[idb + 2], fboxes[idb + 3], fboxes[idb + 4], fboxes[idb + 5]);
      }
    }
    return new Uint32Array(facesToMove.subarray(0, acc));
  }

  updateOctreeAdd(facesToMove) {
    var fc = this.getFaceCenters();
    var fb = this.getFaceBoxes();
    var facePosInLeaf = this._meshData._facePosInLeaf;
    var faceLeaf = this._meshData._faceLeaf;
    var nbFacesToMove = facesToMove.length;

    var root = this._meshData._octree;
    var rootSplit = root._aabbSplit;
    var xmin = rootSplit[0];
    var ymin = rootSplit[1];
    var zmin = rootSplit[2];
    var xmax = rootSplit[3];
    var ymax = rootSplit[4];
    var zmax = rootSplit[5];

    for (var i = 0; i < nbFacesToMove; ++i) { // add face to the octree
      var idFace = facesToMove[i];
      var idb = idFace * 6;
      var ibux = fb[idb];
      var ibuy = fb[idb + 1];
      var ibuz = fb[idb + 2];
      var iblx = fb[idb + 3];
      var ibly = fb[idb + 4];
      var iblz = fb[idb + 5];

      if (ibux > xmax || iblx < xmin || ibuy > ymax || ibly < ymin || ibuz > zmax || iblz < zmin) {
        // a face is outside the root node, we reconstruct the whole octree, slow... but rare
        this.computeOctree();
        this._meshData._leavesToUpdate.length = 0;
        break;
      }

      var idc = idFace * 3;
      var newleaf = root.addFace(idFace, ibux, ibuy, ibuz, iblx, ibly, iblz, fc[idc], fc[idc + 1], fc[idc + 2]);
      if (newleaf) {
        facePosInLeaf[idFace] = newleaf._iFaces.length - 1;
        faceLeaf[idFace] = newleaf;
      } else { // failed to insert face in octree, re-insert it back
        var facesInLeaf = faceLeaf[idFace]._iFaces;
        facePosInLeaf[idFace] = facesInLeaf.length;
        facesInLeaf.push(facesToMove[i]);
      }
    }
  }

  /** balance octree (cut empty leaves or go deeper if needed) */
  balanceOctree() {
    ++OctreeCell.FLAG;
    var leavesToUpdate = this._meshData._leavesToUpdate;
    var nbLeaves = leavesToUpdate.length;

    for (var i = 0; i < nbLeaves; ++i) {
      var leaf = leavesToUpdate[i];
      if (leaf._flag === OctreeCell.FLAG)
        continue;

      if (leaf._iFaces.length === 0)
        leaf.pruneIfPossible();
      else if (leaf._iFaces.length > OctreeCell.MAX_FACES && leaf._depth < OctreeCell.MAX_DEPTH)
        leaf.build(this);

      leaf._flag = OctreeCell.FLAG;
    }

    leavesToUpdate.length = 0;
  }

  //////////////
  // RENDER DATA
  //////////////
  setFlatColor(val) {
    this.getFlatColor().set(val);
  }

  setAlbedo(val) {
    this.getAlbedo().set(val);
  }

  setMode(mode) {
    this._renderData._mode = mode;
  }

  setRoughness(val) {
    this._renderData._roughness = val;
  }

  setMetallic(val) {
    this._renderData._metallic = val;
  }

  setOpacity(alpha) {
    this._renderData._alpha = alpha;
  }

  setTexture0(tex) {
    this._renderData._texture0 = tex;
  }

  setMatcap(idMat) {
    this._renderData._matcap = idMat;
  }

  setCurvature(cur) {
    this._renderData._curvature = cur;
  }

  setFlatShading(flatShading) {
    if (this._renderData._flatShading !== flatShading) {
      this._renderData._flatShading = flatShading;
      this.updateBuffers();
    }
  }

  setShowWireframe(showWireframe) {
    this._renderData._showWireframe = RenderData.ONLY_DRAW_ARRAYS ? false : showWireframe;
    if (this._renderData._wireframeMesh) {
        this._renderData._wireframeMesh.visible = this.getShowWireframe();
    }
    this.updateWireframeBuffer();
  }

  setUseDrawArrays(bool) {
    if (this._renderData._useDrawArrays !== bool) {
      this._renderData._useDrawArrays = bool;
      if (bool) {
        this.updateDrawArrays();
      }
      this.updateBuffers();
    }
  }

  getGL() {
    return this._renderData._gl;
  }

  getCount() {
    var gl = this.getGL();
    if (this.getMode() === gl.TRIANGLES) return this.getNbTriangles() * 3;
    if (this.getMode() === gl.LINES) return this.getNbVertices();
    return 0;
  }

  getVertexBuffer() {
    return this._renderData._vertexBuffer;
  }

  getNormalBuffer() {
    return this._renderData._normalBuffer;
  }

  getColorBuffer() {
    return this._renderData._colorBuffer;
  }

  getMaterialBuffer() {
    return this._renderData._materialBuffer;
  }

  getTexCoordBuffer() {
    return this._renderData._texCoordBuffer;
  }

  getIndexBuffer() {
    return this._renderData._indexBuffer;
  }

  getWireframeBuffer() {
    return this._renderData._wireframeBuffer;
  }

  getRoughness() {
    return this._renderData._roughness;
  }

  getMetallic() {
    return this._renderData._metallic;
  }

  getOpacity() {
    return this._renderData._alpha;
  }

  getFlatColor() {
    return this._renderData._flatColor;
  }

  getMode() {
    return this._renderData._mode;
  }

  getAlbedo() {
    return this._renderData._albedo;
  }

  getTexture0() {
    return this._renderData._texture0;
  }

  getMatcap() {
    return this._renderData._matcap;
  }

  getCurvature() {
    return this._renderData._curvature;
  }

  getFlatShading() {
    return this._renderData._flatShading;
  }

  getShowFacesGroups() {
    return this._renderData._showFacesGroups;
  }

  setShowFacesGroups(bool) {
    if (this._renderData._showFacesGroups === bool) return;
    this._renderData._showFacesGroups = bool;
    // The main mesh is left untouched (indexed, wireframe works). Group colours render as
    // a separate non-indexed overlay child mesh — crisp per face, no draw-arrays fragility.
    this.updateGroupOverlay();
  }

  // Rebuild the group-colour overlay: a non-indexed child mesh where every triangle of a
  // face is painted that face's group colour (so each face reads solid — crisp per-face).
  // Semi-transparent so the base shading + wireframe show through.
  updateGroupOverlay() {
    var rd = this._renderData;
    if (!this.getShowFacesGroups() || !this._meshData._facesGroups) {
      if (rd._groupOverlayMesh) rd._groupOverlayMesh.visible = false;
      return;
    }

    var fAr = this.getFaces();
    var vAr = this.getVertices();
    var groups = this._meshData._facesGroups;
    var nbFaces = this.getNbFaces();
    var nbTris = this.getNbTriangles();

    var pos = new Float32Array(nbTris * 9);
    var col = new Float32Array(nbTris * 9);
    var gcol = [0.0, 0.0, 0.0];
    var t = 0;
    var writeTri = (ia, ib, ic) => {
      var o = t * 9;
      var a = ia * 3, b = ib * 3, c = ic * 3;
      pos[o] = vAr[a]; pos[o + 1] = vAr[a + 1]; pos[o + 2] = vAr[a + 2];
      pos[o + 3] = vAr[b]; pos[o + 4] = vAr[b + 1]; pos[o + 5] = vAr[b + 2];
      pos[o + 6] = vAr[c]; pos[o + 7] = vAr[c + 1]; pos[o + 8] = vAr[c + 2];
      for (var j = 0; j < 9; j += 3) { col[o + j] = gcol[0]; col[o + j + 1] = gcol[1]; col[o + j + 2] = gcol[2]; }
      t++;
    };
    for (var i = 0; i < nbFaces; ++i) {
      this.getFaceGroupColor(groups[i], gcol);
      var id = i * 4;
      var a = fAr[id], b = fAr[id + 1], c = fAr[id + 2], d = fAr[id + 3];
      writeTri(a, b, c);
      if (d !== Utils.TRI_INDEX) writeTri(a, c, d);
    }

    if (!rd._groupOverlayMesh) {
      // depthWrite:false so the (decorative, camera-pulled) overlay polygon doesn't write
      // depth in FRONT of the wireframe LineSegments — polygon offset can't push lines, so
      // an overlay that wrote depth would occlude the wireframe in group-paint mode.
      var mat = new THREE.MeshBasicMaterial({
        vertexColors: true, transparent: true, opacity: 0.65,
        depthTest: true, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -1.0, polygonOffsetUnits: -1.0
      });
      rd._groupOverlayMesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
      rd._groupOverlayMesh.frustumCulled = false;
      rd._groupOverlayMesh.renderOrder = 0.5; // above the base mesh, below the wireframe (1)
      if (rd._threeMesh) rd._threeMesh.add(rd._groupOverlayMesh);
    }
    var geom = rd._groupOverlayMesh.geometry;
    var posAttr = geom.getAttribute('position');
    if (!posAttr || posAttr.array.length !== pos.length) {
      geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geom.setAttribute('color', new THREE.BufferAttribute(col, 3));
    } else {
      posAttr.array.set(pos); posAttr.needsUpdate = true;
      var colAttr = geom.getAttribute('color'); colAttr.array.set(col); colAttr.needsUpdate = true;
    }
    rd._groupOverlayMesh.visible = true;
  }

  // Deterministic palette for group ids. Group 0 (unpainted) reads as neutral light gray;
  // other ids get distinct hues via the golden-angle sequence. Writes rgb into out.
  getFaceGroupColor(groupId, out) {
    if (groupId <= 0) {
      out[0] = out[1] = out[2] = 0.85;
      return out;
    }
    var h = (groupId * 0.61803398875) % 1.0; // golden-ratio hue spread
    var s = 0.55;
    var v = 0.95;
    var i = Math.floor(h * 6);
    var f = h * 6 - i;
    var p = v * (1 - s);
    var q = v * (1 - f * s);
    var t = v * (1 - (1 - f) * s);
    switch (i % 6) {
      case 0: out[0] = v; out[1] = t; out[2] = p; break;
      case 1: out[0] = q; out[1] = v; out[2] = p; break;
      case 2: out[0] = p; out[1] = v; out[2] = t; break;
      case 3: out[0] = p; out[1] = q; out[2] = v; break;
      case 4: out[0] = t; out[1] = p; out[2] = v; break;
      default: out[0] = v; out[1] = p; out[2] = q; break;
    }
    return out;
  }

  getShowWireframe() {
    return this._renderData._showWireframe;
  }

  getWireframeType() {
    return this._renderData._wireframeType;
  }

  setWireframeType(type) {
    this._renderData._wireframeType = type;
    this.updateWireframeBuffer();
  }

  isUsingDrawArrays() {
    return this._renderData._useDrawArrays || RenderData.ONLY_DRAW_ARRAYS;
  }

  isUsingTexCoords() {
    var shaderType = this._renderData._shaderType;
    return shaderType === Enums.Shader.UV || shaderType === Enums.Shader.PAINTUV;
  }

  isTransparent() {
    return this._renderData._alpha < 0.99;
  }

  getShaderType() {
    return this._renderData._shaderType;
  }

  setShaderType(shaderName) {
    var hasUV = this.hasUV();
    if (shaderName === Enums.Shader.UV && !hasUV) {
      if (this._renderData._shaderType !== Enums.Shader.UV)
        return;
      shaderName = Enums.Shader.MATCAP;
    }

    this._renderData._shaderType = shaderName;
    if (this._renderData._threeMesh) {
      this._renderData._threeMesh.material = ShaderManager.getMaterial(shaderName);
    }
    if (hasUV) {
      this.updateDuplicateGeometry();
      this.updateDrawArrays();
    }
    this.updateBuffers();
  }

  initRender() {
    this.setShaderType(this._renderData._shaderType);
    this.setShowWireframe(this.getShowWireframe());
  }

  /////////
  // RENDER
  /////////
  render(main) {
    if (!this.isVisible()) return;
    try {
      // Restore legacy WebGL1 draw loop for overlays like Gizmo
      Shader[this.getShaderType()].getOrCreate(this.getGL()).draw(this, main);
    } catch (e) { } 
  }

  renderWireframe(main) {
    if (!this.isVisible()) return;
    try {
      Shader[Enums.Shader.WIREFRAME].getOrCreate(this.getGL()).draw(this, main);
    } catch (e) { }
  }

  renderFlatColor(main) {
    if (!this.isVisible()) return;
    try {
      Shader[Enums.Shader.FLAT].getOrCreate(this.getGL()).draw(this, main);
    } catch (e) { }
  }

  /////////////////
  // UPDATE BUFFERS
  /////////////////
  getRenderNbVertices() {
    if (this.isUsingDrawArrays()) return this.getCount();
    return this.isUsingTexCoords() ? this.getNbTexCoords() : this.getNbVertices();
  }

  updateVertexBuffer() {
    var vertices = this.isUsingDrawArrays() ? this.getVerticesDrawArrays() : this.getVertices();
    
    if (vertices.length === 6) {
        // console.warn("🛑 CAUGHT LENGTH 6 ARRAY! 🛑", new Error().stack);

    }
    
    var geom = this._renderData._geometry;
    var attr = geom.getAttribute('position');
    
    // If the attribute doesn't exist, or is too small, recreate it.
    if (!attr || attr.array.length < vertices.length) {
      if (geom && geom.getAttribute('position')) {
          geom.deleteAttribute('position');
          geom.dispose();
      }
      
      var newGeom = new THREE.BufferGeometry();
      newGeom.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
      
      if (this._renderData._threeMesh) {
          this._renderData._threeMesh.geometry = newGeom;
      }
      this._renderData._geometry = newGeom;
      
      // Force all other attributes to re-bind to the NEW geometry
      this.updateNormalBuffer();
      this.updateColorBuffer();
      this.updateMaterialBuffer();
      this.updateTexCoordBuffer();
      this.updateIndexBuffer();
      this.updateWireframeBuffer();
      
      if (this.isUsingDrawArrays()) {
          newGeom.setDrawRange(0, this.getRenderNbVertices());
      }
    } else {
      if (attr.updateRange) {
        attr.updateRange.offset = 0;
        attr.updateRange.count = -1;
      }
      attr.array.set(vertices);
      attr.needsUpdate = true;

      if (geom) {
        geom.computeBoundingSphere();
        geom.computeBoundingBox();
      }
    }
  }

  updateNormalBuffer() {
    var normals = this.isUsingDrawArrays() ? this.getNormalsDrawArrays() : this.getNormals();
    var geom = this._renderData._geometry;
    var attr = geom.getAttribute('normal');
    if (!normals) return; // Skip if no normals provided
    
    if (!attr || attr.array.length < normals.length) {
      if (attr) {
          geom.deleteAttribute('normal');
          geom.dispose(); // force WebGL context to drop old buffer
      }
      geom.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    } else {
      if (attr.updateRange) {
        attr.updateRange.offset = 0;
        attr.updateRange.count = -1;
      }
      attr.array.set(normals);
      attr.needsUpdate = true;
    }
  }

  updateColorBuffer() {
    var colors = this.isUsingDrawArrays() ? this.getColorsDrawArrays() : this.getColors();
    var geom = this._renderData._geometry;
    var attr = geom.getAttribute('color');
    if (!attr || attr.array.length < colors.length) {
      if (attr) {
          geom.deleteAttribute('color');
          geom.dispose();
      }
      geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    } else {
      attr.array.set(colors);
      if (this._isVoxel) {
          // Only upload active colors!
          attr.updateRange = { offset: 0, count: this.getRenderNbVertices() * 3 };
      }
      attr.needsUpdate = true;
    }
  }

  updateMaterialBuffer() {
    var materials = this.isUsingDrawArrays() ? this.getMaterialsDrawArrays() : this.getMaterials();
    var geom = this._renderData._geometry;
    var attr = geom.getAttribute('aMaterial');
    if (!attr || attr.array.length < materials.length) {
      if (attr) {
          geom.deleteAttribute('aMaterial');
          geom.dispose();
      }
      geom.setAttribute('aMaterial', new THREE.BufferAttribute(materials, 3));
    } else {
      attr.array.set(materials);
      if (this._isVoxel) {
          // Only upload active materials!
          attr.updateRange = { offset: 0, count: this.getRenderNbVertices() * 3 };
      }
      attr.needsUpdate = true;
    }
  }

  updateTexCoordBuffer() {
    var geom = this._renderData._geometry;
    if (this.isUsingTexCoords()) {
      var texCoords = this.isUsingDrawArrays() ? this.getTexCoordsDrawArrays() : this.getTexCoords();
      var attr = geom.getAttribute('uv');
      if (!attr || attr.array !== texCoords || attr.array.length !== texCoords.length) {
        if (attr) {
            geom.deleteAttribute('uv');
            geom.dispose();
        }
        geom.setAttribute('uv', new THREE.BufferAttribute(texCoords, 2));
      } else {
        attr.array.set(texCoords);
        attr.needsUpdate = true;
      }
    } else {
      if (geom.getAttribute('uv')) {
          geom.deleteAttribute('uv');
          geom.dispose();
      }
    }
  }

  updateIndexBuffer() {
    var geom = this._renderData._geometry;
    if (this.isUsingDrawArrays()) {
        if (geom.index) {
            geom.setIndex(null);
            geom.dispose();
        }
        if (geom.attributes.position) {
            geom.setDrawRange(0, geom.attributes.position.count);
        }
        return;
    }
    var useTex = this.isUsingTexCoords();
    var triangles = useTex ? this.getTrianglesTexCoord() : this.getTriangles();
    
    if (this._isVoxel) {
        var faces = this.getFaces();
        if (faces) {
            triangles = new Uint32Array(faces.length / 4 * 6);
            for(let i=0, j=0; i<faces.length; i+=4, j+=6) {
                 triangles[j] = faces[i];
                 triangles[j+1] = faces[i+1];
                 triangles[j+2] = faces[i+2];
                 triangles[j+3] = faces[i+2];
                 triangles[j+4] = faces[i+3];
                 triangles[j+5] = faces[i];
            }
        }
    }

    if (!triangles) return; // Skip if no valid index data
    
    // Relax check for index length
    geom.setIndex(null);
    geom.setIndex(new THREE.BufferAttribute(triangles, 1));
    
    // TRICKY: SculptXR uses large pre-allocated capacity arrays for performance.
    // Three.js by default renders the FULL capacity array, which contains garbage/out-of-bound indices
    // at the end of the array. We MUST cap the draw range to the actually used faces.
    if (geom.index) {
        let drawRangeCount = this.getNbTriangles() * 3;
        let posAttrCount = geom.attributes.position.count;
        let maxIndex = 0;
        let indexArray = geom.index.array;
        for(let i=0; i<drawRangeCount; i++) {
            if(indexArray[i] > maxIndex) maxIndex = indexArray[i];
        }
        
        geom.setDrawRange(0, drawRangeCount);
    }
    
    // Force Three.js to recalculate internally caching bounds because SculptXR topology is dynamic
    if (!this._isVoxel) {
        geom.computeBoundingSphere();
        geom.computeBoundingBox();
    } else {
        if (!geom.boundingSphere) {
            geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(0,0,0), 1000); // Giant dummy sphere to bypass culling
            geom.boundingBox = new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(0,0,0), new THREE.Vector3(1000,1000,1000));
        }
    }
    
    // Sometimes SculptXR raw normals aren't sufficient or correctly mapped, force recompute only if missing
    if (!this.getNormals() || this.getNormals().length === 0) {
        geom.computeVertexNormals();
    }
  }

  updateWireframeBuffer() {
    if (this.getShowWireframe()) {
      // An empty mesh (fresh/blank voxel object) has nothing to outline. Skip the
      // edge rebuild + warning that would otherwise fire on every buffer update.
      if (this.getNbVertices() === 0) {
        if (this._renderData._wireframeMesh) this._renderData._wireframeMesh.visible = false;
        return;
      }
      if (!this.getEdges() || this.getEdges().length === 0) {
        this.allocateArrays();
        this.initFaceRings();
        this.initEdges();
      }
      // Always build the wireframe from the indexed layout so it's valid regardless of
      // the main mesh's render mode (group view forces draw-arrays on the main mesh).
      this.getWireframeBuffer().update(this.getWireframe(true), this.getNbEdges() * 2);

      // Revert to pure quad edge rendering using THREE.LineSegments to suppress diagonal triangulation
      var edgeIndices = this.getWireframe(true);

      // Fallback: derive edges from the render geometry's triangle index. The app-side
      // edge list isn't built for some meshes (e.g. the voxel SurfaceNets output), which
      // left their wireframe empty; the render geometry index is always current.
      const _g = this._renderData._geometry;
      if ((!edgeIndices || edgeIndices.length === 0) && _g && _g.index) {
        const idx = _g.index.array;
        const e = new Uint32Array(Math.floor(idx.length / 3) * 6);
        let o = 0;
        for (let t = 0; t + 2 < idx.length; t += 3) {
          const a = idx[t], b = idx[t + 1], c = idx[t + 2];
          e[o++] = a; e[o++] = b; e[o++] = b; e[o++] = c; e[o++] = c; e[o++] = a;
        }
        edgeIndices = e;
      }

      if (edgeIndices && edgeIndices.length > 0) {
          if (!this._renderData._wireframeMesh) {
              var lineMaterial = new THREE.LineBasicMaterial({
                  color: 0x000000,
                  transparent: true,
                  opacity: 0.3,
                  depthTest: true,
                  polygonOffset: true,
                  polygonOffsetFactor: -2.0,
                  polygonOffsetUnits: -2.0
              });
              var lineGeom = new THREE.BufferGeometry();
              this._renderData._wireframeMesh = new THREE.LineSegments(lineGeom, lineMaterial);
              this._renderData._wireframeMesh.frustumCulled = false;
              this._renderData._wireframeMesh.renderOrder = 1;

              if (this._renderData._threeMesh) {
                  this._renderData._threeMesh.add(this._renderData._wireframeMesh);
              } else {
                  console.warn("[SXR Wireframe] Failed to find _threeMesh parent to attach wireframe!");
              }
          }

          // A restored preference can request wireframe before the owning Three.js mesh has
          // entered the scene. Creation then succeeds without a parent. Reattach on any later
          // refresh so rendering does not depend on changing subdivision level.
          const wireMesh = this._renderData._wireframeMesh;
          const solidMesh = this._renderData._threeMesh;
          if (solidMesh && wireMesh.parent !== solidMesh) solidMesh.add(wireMesh);

          const geom = wireMesh.geometry;
          // Bind to the INDEXED vertex positions — the wireframe edges are built from the
          // indexed layout (getWireframe(true)), so position + indices always match, no
          // matter the main mesh's render mode. (Sharing the main geom's position went out
          // of sync in draw-arrays/group view → "vertex buffer is not big enough".)
          const wfVerts = this.getVertices();
          const wfPos = geom.getAttribute('position');
          if (!wfPos || wfPos.array !== wfVerts) {
              geom.setAttribute('position', new THREE.BufferAttribute(wfVerts, 3));
          } else {
              wfPos.needsUpdate = true;
          }
          if (!geom.index || geom.index.array !== edgeIndices) {
              geom.setIndex(new THREE.BufferAttribute(edgeIndices, 1));
          }
          this._renderData._wireframeMesh.visible = true;
      } else if (this._renderData._wireframeMesh) {
          // No derivable edges — hide any stale wireframe instead of spamming.
          this._renderData._wireframeMesh.visible = false;
      }
    } else {
      if (this._renderData._wireframeMesh) {
        this._renderData._wireframeMesh.visible = false;
      }
    }
  }

  updateGeometryBuffers() {
    this.updateVertexBuffer();
    this.updateNormalBuffer();
  }

  updateBuffers() {
    this.updateGeometryBuffers();
    this.updateColorBuffer();
    this.updateMaterialBuffer();
    this.updateTexCoordBuffer();
    this.updateIndexBuffer();
    this.updateWireframeBuffer();
    
    if (this.isUsingDrawArrays()) {
      var geom = this._renderData._geometry;
      geom.setDrawRange(0, this.getRenderNbVertices());
    }
  }

  release() {
    if (this.getTexture0())
      this.getGL().deleteTexture(this.getTexture0());
    this.getVertexBuffer().release();
    this.getNormalBuffer().release();
    this.getColorBuffer().release();
    this.getMaterialBuffer().release();
    this.getIndexBuffer().release();
    this.getWireframeBuffer().release();
  }

  copyRenderConfig(mesh) {
    this.setFlatShading(mesh.getFlatShading());
    this.setShowWireframe(mesh.getShowWireframe());
    this.setShaderType(mesh.getShaderType());
    this.setMatcap(mesh.getMatcap());
    this.setTexture0(mesh.getTexture0());
    this.setCurvature(mesh.getCurvature());
    this.setOpacity(mesh.getOpacity());
  }

  copyTransformData(mesh) {
    vec3.copy(this.getCenter(), mesh.getCenter());
    mat4.copy(this.getMatrix(), mesh.getMatrix());
    mat4.copy(this.getEditMatrix(), mesh.getEditMatrix());
    vec3.copy(this.getSymmetryNormal(), mesh.getSymmetryNormal());
  }

  copyData(mesh) {
    this.setVertices(mesh.getVertices().slice());
    this.setFaces(mesh.getFaces().slice());

    this.setColors(mesh.getColors().slice());
    this.setMaterials(mesh.getMaterials().slice());
    if (mesh.hasUV()) {
      this.initTexCoordsDataFromOBJData(mesh.getTexCoords(), mesh.getFacesTexCoord());
    }

    // Per-face group ids (steers guided quad remesh). Deep-copy so the clone owns them —
    // must be set before init() so allocateArrays preserves it to nbFaces.
    var srcGroups = mesh.getFacesGroups ? mesh.getFacesGroups() : null;
    if (srcGroups) this.setFacesGroups(srcGroups.slice());

    this._isVoxel = mesh._isVoxel;

    this.init();
    this.initRender();

    this.copyTransformData(mesh);
    this.copyRenderConfig(mesh);

    // Mirror the group-view state so a clone of a mesh that's showing groups also shows
    // them (independent overlay), instead of the original appearing to "lose" them.
    if (mesh.getShowFacesGroups && mesh.getShowFacesGroups()) {
      this.setShowFacesGroups(true);
    }
  }

  optimize() {
    if (this.getNbFaces() === 0 || !Mesh.OPTIMIZE)
      return;

    // lower is better :
    // ACTVR : ~1 is optimal (soup or not)
    // ACMR : ~0.5 optimal ratio, 3 for triangle soup
    // var data = this.computeCacheScore();

    this.optimizePostTransform();
    this.optimizePreTransform();
    this.initFaceRings();

    // console.log('\nbefore ACMR ' + data.ACMR);
    // console.log('before ACTVR ' + data.ACTVR);
    // data = this.computeCacheScore();
    // console.log('after ACMR ' + data.ACMR);
    // console.log('after ACTVR ' + data.ACTVR);
  }

  computeCacheScore() {
    var fAr = this.getFaces();
    var nbFaces = this.getNbFaces();

    var sizeCache = 32;
    var cache = [];
    cache.length = sizeCache;

    var cacheMiss = 0;
    var k = 0;
    for (var i = 0; i < nbFaces; ++i) {
      var id = i * 3;
      var nbPoly = fAr[id + 3] !== Utils.TRI_INDEX ? 4 : 3;
      // check in cache
      for (var j = 0; j < nbPoly; ++j) {

        var idFace = fAr[id + j];
        // check in cache
        for (k = 0; k < sizeCache; ++k) {
          if (cache[k] === undefined) {
            cache[k] = idFace;
            cacheMiss++;
            break;
          } else if (cache[k] === idFace) {
            break;
          }
        }

        if (k === sizeCache) {
          cacheMiss++;
          cache.shift();
          cache.push(idFace);
        }
      }
    }

    return {
      ACMR: cacheMiss / nbFaces,
      ACTVR: cacheMiss / this.getNbVertices()
    };
  }

  optimizePostTransform() {
    // post transform optimization (index buffer re-index), it implements tipsy
    // http://gfx.cs.princeton.edu/pubs/Sander_2007_%3ETR/tipsy.pdf

    var i = 0;
    var cacheSize = 32;
    var hasUV = this.hasUV();
    var fAr = this.getFaces();
    var fArUV = hasUV ? this.getFacesTexCoord() : fAr;

    var nbFaces = this.getNbFaces();
    var nbUniqueVertices = this.getNbVertices();
    var nbVertices = hasUV ? this.getNbTexCoords() : nbUniqueVertices;

    var dupUV = this.getVerticesDuplicateStartCount();
    var mapToUnique = new Uint32Array(nbVertices - nbUniqueVertices);
    if (hasUV) {
      for (i = 0; i < nbVertices; ++i) {
        var dupStart = dupUV[i * 2];
        var dupEnd = dupStart + dupUV[i * 2 + 1];
        for (var j = dupStart; j < dupEnd; ++j) {
          mapToUnique[j - nbUniqueVertices] = i;
        }
      }
    }

    var fringsStartCount = this.getVerticesRingFaceStartCount();
    var frings = this.getVerticesRingFace();

    var livesTriangles = new Int32Array(nbVertices);
    for (i = 0; i < nbUniqueVertices; ++i) {
      livesTriangles[i] = fringsStartCount[i * 2 + 1];
    }

    for (i = nbUniqueVertices; i < nbVertices; ++i) {
      livesTriangles[i] = fringsStartCount[mapToUnique[i - nbUniqueVertices] * 2 + 1];
    }

    var vTimeStamp = new Uint32Array(nbVertices);
    var timeStamp = cacheSize + 1;
    var cursor = 0;

    var deadEndStack = new Uint32Array(Utils.getMemory(4 * nbFaces * 4), 0, nbFaces * 4);
    var deadEndCount = 0;
    var emittedFaces = new Uint8Array(nbFaces);

    var fArUVNew = new Uint32Array(nbFaces * 4);
    var fArNew = hasUV ? new Uint32Array(nbFaces * 4) : fArUVNew;
    var fcount = 0;

    var fanningVertex = 0;
    while (fanningVertex >= 0) {

      var ringCandidates = [];

      var idRing = fanningVertex >= nbUniqueVertices ? mapToUnique[fanningVertex - nbUniqueVertices] : fanningVertex;
      var start = fringsStartCount[idRing * 2];
      var end = start + fringsStartCount[idRing * 2 + 1];

      for (i = start; i < end; ++i) {
        var idFace = frings[i];
        if (emittedFaces[idFace]) continue;
        emittedFaces[idFace] = 1;

        var idf = idFace * 4;

        var idv1 = deadEndStack[deadEndCount++] = fArUVNew[fcount++] = fArUV[idf];
        var idv2 = deadEndStack[deadEndCount++] = fArUVNew[fcount++] = fArUV[idf + 1];
        var idv3 = deadEndStack[deadEndCount++] = fArUVNew[fcount++] = fArUV[idf + 2];
        var idv4 = fArUVNew[fcount++] = fArUV[idf + 3];
        var isQuad = idv4 !== Utils.TRI_INDEX;

        if (hasUV) {
          fArNew[fcount - 4] = fAr[idf];
          fArNew[fcount - 3] = fAr[idf + 1];
          fArNew[fcount - 2] = fAr[idf + 2];
          fArNew[fcount - 1] = fAr[idf + 3];
        }

        ringCandidates.push(idv1, idv2, idv3);

        --livesTriangles[idv1];
        --livesTriangles[idv2];
        --livesTriangles[idv3];

        if (timeStamp - vTimeStamp[idv1] > cacheSize) vTimeStamp[idv1] = timeStamp++;
        if (timeStamp - vTimeStamp[idv2] > cacheSize) vTimeStamp[idv2] = timeStamp++;
        if (timeStamp - vTimeStamp[idv3] > cacheSize) vTimeStamp[idv3] = timeStamp++;

        if (isQuad) {
          deadEndStack[deadEndCount++] = idv4;
          ringCandidates.push(idv4);
          --livesTriangles[idv4];
          if (timeStamp - vTimeStamp[idv4] > cacheSize) vTimeStamp[idv4] = timeStamp++;
        }

      }

      // get emitted next vertex
      fanningVertex = -1;
      var bestPriority = -1;
      var nbCandidates = ringCandidates.length;
      for (i = 0; i < nbCandidates; ++i) {
        var idc = ringCandidates[i];
        var liveCount = livesTriangles[idc];
        if (liveCount <= 0) continue;

        var priority = 0;
        var posCache = timeStamp - vTimeStamp[idc];
        if (posCache + 2 * liveCount <= cacheSize) {
          priority = posCache;
        }

        if (priority > bestPriority) {
          bestPriority = priority;
          fanningVertex = idc;
        }
      }

      if (fanningVertex !== -1) continue;

      while (deadEndCount > 0) {
        var vEnd = deadEndStack[--deadEndCount];
        if (livesTriangles[vEnd] > 0) {
          fanningVertex = vEnd;
          break;
        }
      }

      if (fanningVertex !== -1) continue;

      while (cursor < nbVertices) {
        if (livesTriangles[cursor++] > 0) {
          fanningVertex = cursor - 1;
          break;
        }
      }

    }

    fArUV.set(fArUVNew.subarray(0, nbFaces * 4));
    if (hasUV) fAr.set(fArNew.subarray(0, nbFaces * 4));

  }

  optimizePreTransform() {
    // pre transform optimization (not as important as post transform though)
    // it also removes unused vertices

    var vArOld = this.getVertices();
    var cArOld = this.getColors();
    var mArOld = this.getMaterials();
    var nbVertices = this.getNbVertices();

    var fAr = this.getFaces();
    var fArCount = this.getNbFaces() * 4;

    var vArNew = new Float32Array(nbVertices * 3);
    var cArNew = new Float32Array(nbVertices * 3);
    var mArNew = new Float32Array(nbVertices * 3);

    var idvPos = new Uint32Array(nbVertices);
    var acc = 0;
    var i = 0;
    for (i = 0; i < fArCount; ++i) {
      var iv = fAr[i];
      if (iv === Utils.TRI_INDEX) continue;

      var tag = idvPos[iv] - 1;
      if (tag === -1) {
        var idNew = acc * 3;
        var idOld = iv * 3;
        vArNew[idNew] = vArOld[idOld];
        vArNew[idNew + 1] = vArOld[idOld + 1];
        vArNew[idNew + 2] = vArOld[idOld + 2];

        cArNew[idNew] = cArOld[idOld];
        cArNew[idNew + 1] = cArOld[idOld + 1];
        cArNew[idNew + 2] = cArOld[idOld + 2];

        mArNew[idNew] = mArOld[idOld];
        mArNew[idNew + 1] = mArOld[idOld + 1];
        mArNew[idNew + 2] = mArOld[idOld + 2];

        tag = acc++;
        idvPos[iv] = tag + 1;
      }

      fAr[i] = tag;
    }

    var nbUnusedVertex = nbVertices - acc;
    if (nbUnusedVertex > 0)
      this.setNbVertices(acc);

    // Only the unique "positoned" vertices are pre transform, because sculptgl 
    // requires the duplicate vertices to be after the uniques positioned vertices
    if (this.hasUV()) {
      var fArUV = this.getFacesTexCoord();
      // remap unique vertex i
      for (i = 0; i < fArCount; ++i) {
        var iduv = fArUV[i];
        if (iduv < nbVertices) fArUV[i] = idvPos[iduv] - 1;
        else if (iduv !== Utils.TRI_INDEX) fArUV[i] -= nbUnusedVertex;
      }

      var nbUV = this.getNbTexCoords();
      var nbUVNew = this.getNbTexCoords() - nbUnusedVertex;

      var tAr = this.getTexCoords();
      var tArNew = new Float32Array(nbUVNew * 2);
      var dupUVNew = new Uint32Array(acc * 2);
      var dupUV = this.getVerticesDuplicateStartCount();

      for (i = 0; i < nbVertices; ++i) {
        var i2 = i * 2;
        var start = dupUV[i2];
        var newiv = (idvPos[i] - 1) * 2;
        if (newiv < 0) continue;

        if (start > 0) {
          dupUVNew[newiv] = start - nbUnusedVertex;
          dupUVNew[newiv + 1] = dupUV[i2 + 1];
        }

        tArNew[newiv] = tAr[i2];
        tArNew[newiv + 1] = tAr[i2 + 1];
      }

      for (i = nbVertices; i < nbUV; ++i) {
        var ivd = i * 2;
        var ivdnew = (i - nbUnusedVertex) * 2;
        tArNew[ivdnew] = tAr[ivd];
        tArNew[ivdnew + 1] = tAr[ivd + 1];
      }

      this.setVerticesDuplicateStartCount(dupUVNew);
      this.setTexCoords(tArNew);
    }

    vArOld.set(vArNew);
    cArOld.set(cArNew);
    mArOld.set(mArNew);

  }

  subdivideFlow() {
    var fAr = this.getFaces();
    var vAr = this.getVertices();
    var nAr = this.getNormals();
    var cAr = this.getColors();
    var mAr = this.getMaterials();
    
    var nbFaces = this.getNbFaces();
    var nbVertices = this.getNbVertices();
    var nbEdges = this.getNbEdges();
    
    console.log("[Mesh] subdivideFlow started. Faces:", nbFaces, "Verts:", nbVertices, "Edges:", nbEdges);
    
    // 1. Compute face centers
    var faceCenters = new Float32Array(nbFaces * 3);
    for (var i = 0; i < nbFaces; ++i) {
      var id = i * 4;
      var iv1 = fAr[id];
      var iv2 = fAr[id + 1];
      var iv3 = fAr[id + 2];
      var iv4 = fAr[id + 3];
      
      var count = iv4 !== Utils.TRI_INDEX ? 4 : 3;
      var cx = vAr[iv1 * 3] + vAr[iv2 * 3] + vAr[iv3 * 3];
      var cy = vAr[iv1 * 3 + 1] + vAr[iv2 * 3 + 1] + vAr[iv3 * 3 + 1];
      var cz = vAr[iv1 * 3 + 2] + vAr[iv2 * 3 + 2] + vAr[iv3 * 3 + 2];
      
      if (iv4 !== Utils.TRI_INDEX) {
        cx += vAr[iv4 * 3];
        cy += vAr[iv4 * 3 + 1];
        cz += vAr[iv4 * 3 + 2];
      }
      
      faceCenters[i * 3] = cx / count;
      faceCenters[i * 3 + 1] = cy / count;
      faceCenters[i * 3 + 2] = cz / count;
    }
    
    // 2. Build vertex -> faces mapping
    this.initVertexRings();
    var vrfStartCount = this.getVerticesRingFaceStartCount();
    var vertRingFace = this.getVerticesRingFace();
    
    // 3. Create new faces (one for each original vertex)
    var newNbFaces = nbVertices;
    var newFAr = new Uint32Array(newNbFaces * 4);
    var faceCount = 0;
    
    for (var i = 0; i < nbVertices; ++i) {
      var startF = vrfStartCount[i * 2];
      var countF = vrfStartCount[i * 2 + 1];
      if (countF < 3) continue; // Skip boundary vertices
      
      var vx = vAr[i * 3];
      var vy = vAr[i * 3 + 1];
      var vz = vAr[i * 3 + 2];
      
      var nx = nAr[i * 3];
      var ny = nAr[i * 3 + 1];
      var nz = nAr[i * 3 + 2];
      
      // Find two orthogonal vectors in tangent plane
      var ux = 1, uy = 0, uz = 0;
      if (Math.abs(nx) > 0.9) { ux = 0; uy = 1; uz = 0; }
      // cross product N x U
      var wx = ny * uz - nz * uy;
      var wy = nz * ux - nx * uz;
      var wz = nx * uy - ny * ux;
      // make U orthogonal to N and W
      ux = wy * nz - wz * ny;
      uy = wz * nx - wx * nz;
      uz = wx * ny - wy * nx;
      
      // Normalize U and W
      var lenU = Math.sqrt(ux*ux + uy*uy + uz*uz);
      ux /= lenU; uy /= lenU; uz /= lenU;
      var lenW = Math.sqrt(wx*wx + wy*wy + wz*wz);
      wx /= lenW; wy /= lenW; wz /= lenW;
      
      // Collect face centers and compute angles
      var centers = [];
      for (var j = 0; j < countF; ++j) {
        var faceId = vertRingFace[startF + j];
        var cx = faceCenters[faceId * 3];
        var cy = faceCenters[faceId * 3 + 1];
        var cz = faceCenters[faceId * 3 + 2];
        
        var dx = cx - vx;
        var dy = cy - vy;
        var dz = cz - vz;
        
        var u = dx * ux + dy * uy + dz * uz;
        var w = dx * wx + dy * wy + dz * wz;
        
        centers.push({ id: faceId, angle: Math.atan2(w, u) });
      }
      
      // Sort by angle
      centers.sort((a, b) => a.angle - b.angle);
      
      // Create quad or triangle
      var idNew = faceCount * 4;
      if (centers.length >= 4) {
        newFAr[idNew] = centers[0].id;
        newFAr[idNew + 1] = centers[1].id;
        newFAr[idNew + 2] = centers[2].id;
        newFAr[idNew + 3] = centers[3].id;
      } else if (centers.length === 3) {
        newFAr[idNew] = centers[0].id;
        newFAr[idNew + 1] = centers[1].id;
        newFAr[idNew + 2] = centers[2].id;
        newFAr[idNew + 3] = Utils.TRI_INDEX;
      }
      faceCount++;
    }
    
    // 4. Update mesh
    this.setNbVertices(nbFaces);
    this.setVertices(faceCenters);
    
    // Clear colors and materials or average them
    var newCAr = new Float32Array(nbFaces * 3);
    var newMAr = new Float32Array(nbFaces * 3);
    newCAr.fill(1.0); // Default white
    this.setColors(newCAr);
    this.setMaterials(newMAr);
    
    var actualFAr = new Uint32Array(faceCount * 4);
    actualFAr.set(newFAr.subarray(0, faceCount * 4));
    this.setFaces(actualFAr);
    
    this._meshData._facesToTriangles = new Uint32Array(faceCount);
    this._meshData._trianglesABC = this.computeTrianglesFromFaces(actualFAr).slice();
    
    this.updateFacesAabbAndNormal();
    this.updateVerticesNormal();
    this.updateWireframeBuffer();
    
    this._meshData._vertRingVert = null;
    this._meshData._vertRingFace = null;
    this._meshData._vertRingFaceStartCount = null;
    this._meshData._vertRingVertStartCount = null;
    this._meshData._faceEdges = null;
    
    this.initFaceRings();
    this.initEdges();
    this.initVertexRings();
    
    this.updateGeometry();

      

    

    

    

    



    

  }

  symmetrize(direction) {
    if (!this._symmetryData) this._symmetryData = new MeshSymmetry(this);
    this._symmetryData.symmetrize(direction);
  }
}

Mesh.OPTIMIZE = true;
Mesh.ID = 0;

export default Mesh;
