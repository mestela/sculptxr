import { vec3, mat4 } from 'gl-matrix';
import Geometry from './Geometry.js';
import Tablet from '../misc/Tablet.js';
import Utils from '../misc/Utils.js';
import TR from '../gui/GuiTR.js';

var _TMP_NEAR = [0.0, 0.0, 0.0];
var _TMP_NEAR_1 = [0.0, 0.0, 0.0];
var _TMP_FAR = [0.0, 0.0, 0.0];
var _TMP_FAR_1 = [0.0, 0.0, 0.0];
var _TMP_INV = mat4.create();
var _TMP_MS = mat4.create(); // model-space (worldGroup-relative) mesh matrix
var _TMP_INTER = [0.0, 0.0, 0.0];
var _TMP_INTER_1 = [0.0, 0.0, 0.0];
var _TMP_DIR_PICK = [0.0, 0.0, 0.0];
var _TMP_V1 = [0.0, 0.0, 0.0];
var _TMP_V2 = [0.0, 0.0, 0.0];
var _TMP_V3 = [0.0, 0.0, 0.0];

class Picking {

  static addAlpha(u8, width, height, name) {
    var newAlpha = {};
    newAlpha._name = name;
    newAlpha._texture = u8;
    newAlpha._ratioX = Math.max(1.0, width / height);
    newAlpha._ratioY = Math.max(1.0, height / width);
    newAlpha._ratioMax = Math.max(newAlpha._ratioX, newAlpha._ratioY);
    newAlpha._width = width;
    newAlpha._height = height;
    var i = 1;
    while (Picking.ALPHAS[newAlpha._name])
      newAlpha._name = name + (i++);
    Picking.ALPHAS[newAlpha._name] = newAlpha;
    Picking.ALPHAS_NAMES[newAlpha._name] = newAlpha._name;
    return newAlpha;
  }

  constructor(main, xSym) {
    this._mesh = null; // mesh
    this._main = main; // the camera
    this._pickedFace = -1; // face picked
    this._pickedVertices = []; // vertices selected
    this._interPoint = [0.0, 0.0, 0.0]; // intersection point (mesh local space)
    this._rLocal2 = 0.0; // radius of the selection area (local/object space)
    this._rLocal2 = 0.0; // radius of the selection area (local/object space)
    this._rWorld2 = 0.0; // radius of the selection area (world space)
    this._eyeDir = [0.0, 0.0, 0.0]; // eye direction

    this._xSym = !!xSym;

    this._pickedNormal = [0.0, 0.0, 0.0];
    // alpha stuffs
    this._alphaOrigin = [0.0, 0.0, 0.0];
    this._alphaSide = 0.0;
    this._alphaLookAt = mat4.create();
    this._alpha = null;
  }

  setIdAlpha(id) {
    this._alpha = Picking.ALPHAS[id];
  }

  getAlpha(x, y, z) {
    var alpha = this._alpha;
    // VR Fix: Allow alpha calculation to proceed so we get Symmetry Masking (xn > 1.0 checks)
    if (!alpha || !alpha._texture) return 1.0;

    var m = this._alphaLookAt;
    var rs = this._alphaSide;

    var xn = alpha._ratioY * (m[0] * x + m[4] * y + m[8] * z + m[12]) / (this._xSym ? -rs : rs);
    if (Math.abs(xn) > 1.0) return 0.0;

    var yn = alpha._ratioX * (m[1] * x + m[5] * y + m[9] * z + m[13]) / rs;
    if (Math.abs(yn) > 1.0) return 0.0;

    var aw = alpha._width;
    xn = (0.5 - xn * 0.5) * aw;
    yn = (0.5 - yn * 0.5) * alpha._height;
    return alpha._texture[(xn | 0) + aw * (yn | 0)] / 255.0;
  }

  updateAlpha(keepOrigin) {
    var dir = _TMP_V1;
    var nor = _TMP_V2;

    var radius = Math.sqrt(this._rLocal2);
    this._alphaSide = radius * Math.SQRT1_2;

    vec3.sub(dir, this._interPoint, this._alphaOrigin);
    if (vec3.len(dir) === 0) return;
    vec3.normalize(dir, dir);

    var normal = this._pickedNormal;
    vec3.scaleAndAdd(dir, dir, normal, -vec3.dot(dir, normal));
    vec3.normalize(dir, dir);

    if (!keepOrigin)
      vec3.copy(this._alphaOrigin, this._interPoint);

    vec3.scaleAndAdd(nor, this._alphaOrigin, normal, radius);
    mat4.lookAt(this._alphaLookAt, this._alphaOrigin, nor, dir);
  }

  initAlpha() {
    this.computePickedNormal();
    this.updateAlpha();
  }

  getMesh() {
    return this._mesh;
  }

  setLocalRadius2(radius) {
    this._rLocal2 = radius;
  }

  getLocalRadius2() {
    return this._rLocal2;
  }

  getLocalRadius() {
    return Math.sqrt(this._rLocal2);
  }

  getWorldRadius2() {
    return this._rWorld2;
  }

  getWorldRadius() {
    return Math.sqrt(this._rWorld2);
  }

  setIntersectionPoint(inter) {
    this._interPoint = inter;
  }

  getEyeDirection() {
    return this._eyeDir;
  }

  getIntersectionPoint() {
    return this._interPoint;
  }

  getPickedVertices() {
    return this._pickedVertices;
  }

  getPickedFace() {
    return this._pickedFace;
  }

  getPickedNormal() {
    return this._pickedNormal;
  }

  /** Intersection between a ray the mouse position for every meshes */
  intersectionMouseMeshes(meshes = this._main.getMeshes(), mouseX = this._main._mouseX, mouseY = this._main._mouseY, twoSided = false) {
    if (this._main && this._main._lockSelection) {
      const activeMesh = this._main.getMesh();
      if (activeMesh) {
        meshes = [activeMesh];
      }
    }
    this._isVRHit = false;

    var vNear = this.unproject(mouseX, mouseY, 0.0);
    var vFar = this.unproject(mouseX, mouseY, 0.1);
    var nearDistance = Infinity;
    var nearMesh = null;
    var nearFace = -1;

    for (var i = 0, nbMeshes = meshes.length; i < nbMeshes; ++i) {
      var mesh = meshes[i];
      if (!mesh.isVisible() || mesh.isPickable === false || mesh._selectLocked)
        continue;

      mesh.getThreeMesh().updateMatrixWorld(true);
      mat4.invert(_TMP_INV, mesh.getThreeMesh().matrixWorld.elements);
      vec3.transformMat4(_TMP_NEAR_1, vNear, _TMP_INV);
      vec3.transformMat4(_TMP_FAR, vFar, _TMP_INV);
      if (!this.intersectionRayMesh(mesh, _TMP_NEAR_1, _TMP_FAR, twoSided))
        continue;

      var interTest = this.getIntersectionPoint();
      var testDistance = vec3.dist(_TMP_NEAR_1, interTest) * mesh.getScale();
      if (testDistance < nearDistance) {
        nearDistance = testDistance;
        nearMesh = mesh;
        vec3.copy(_TMP_INTER_1, interTest);
        nearFace = this.getPickedFace();
      }
    }

    if (this._main && this._main._lockSelection) {
      const activeMesh = this._main.getMesh();
      if (activeMesh) {
        this._mesh = activeMesh;
        return false;
      }
    }

    this._mesh = nearMesh;
    if (nearMesh) {
      vec3.copy(this._interPoint, _TMP_INTER_1);
      this._pickedFace = nearFace;
      if (nearFace !== -1)
        this.updateLocalAndWorldRadius2();
    } else {
      this._pickedFace = -1;
    }
    return !!nearMesh;
  }

  intersectionRayMeshes(meshes, origin, direction) {
    var nearDistance = Infinity;
    var nearMesh = null;
    var nearFace = -1;

    // vNear = origin
    // vFar = origin + direction * length
    vec3.copy(_TMP_NEAR_1, origin);
    vec3.scaleAndAdd(_TMP_FAR_1, origin, direction, 5000.0);

    for (var i = 0, nbMeshes = meshes.length; i < nbMeshes; ++i) {
      var mesh = meshes[i];
      if (!mesh.isVisible() || mesh._selectLocked) continue;

      mesh.getModelSpaceMatrix(_TMP_MS); // parent-aware (== getMatrix() for flat meshes)
      mat4.invert(_TMP_INV, _TMP_MS);
      vec3.transformMat4(_TMP_NEAR, _TMP_NEAR_1, _TMP_INV);
      vec3.transformMat4(_TMP_FAR, _TMP_FAR_1, _TMP_INV);

      if (!this.intersectionRayMesh(mesh, _TMP_NEAR, _TMP_FAR)) continue;

      var interTest = this.getIntersectionPoint();
      // Distance check (world space)
      // intersectionRayMesh sets _interPoint in LOCAL space

      // Transform local intersection to world to measure distance from origin
      vec3.transformMat4(_TMP_V1, interTest, _TMP_MS);
      var testDistance = vec3.dist(origin, _TMP_V1);

      if (testDistance < nearDistance) {
        nearDistance = testDistance;
        nearMesh = mesh;
        vec3.copy(_TMP_INTER_1, interTest);
        nearFace = this.getPickedFace();
      }
    }

    this._mesh = nearMesh;
    vec3.copy(this._interPoint, _TMP_INTER_1);
    this._pickedFace = nearFace;

    // For radius, we might need to handle it differently in VR
    // updateLocalAndWorldRadius2 uses screen projection.
    // We'll trust it works if we fake mouse, OR we overload it.
    if (nearFace !== -1)
      this.updateLocalAndWorldRadius2();

    return !!nearMesh;
  }

  /** Intersection between a sphere and meshes (Contact Picking for VR) */
  intersectionSphereMeshes(meshes, worldCenter, worldRadius) {
    if (this._main && this._main._lockSelection) {
      const activeMesh = this._main.getMesh();
      if (activeMesh) {
        meshes = [activeMesh];
      }
    }
    this._isVRHit = true;
    var nearDistance = Infinity;
    var nearMesh = null;
    var nearFace = -1;
    var nearPoint = [0.0, 0.0, 0.0];

    var localCenter = [0.0, 0.0, 0.0];
    var closestPoint = [0.0, 0.0, 0.0];

    // Temp vars for triangle vertices
    var v1 = [0.0, 0.0, 0.0];
    var v2 = [0.0, 0.0, 0.0];
    var v3 = [0.0, 0.0, 0.0];
    var vAr, fAr;

    var worldRadiusSq = worldRadius * worldRadius;

    for (var i = 0, nbMeshes = meshes.length; i < nbMeshes; ++i) {
      var mesh = meshes[i];
      if (!mesh.isVisible() || mesh.isPickable === false || mesh._selectLocked) continue;

      mesh.getModelSpaceMatrix(_TMP_MS); // parent-aware (== getMatrix() for flat meshes)
      mat4.invert(_TMP_INV, _TMP_MS);
      vec3.transformMat4(localCenter, worldCenter, _TMP_INV);

      var scale = mesh.getModelSpaceScale();
      var localRadiusSq = worldRadiusSq / (scale * scale);

      // Silenced continuous console noise

      var iFaces = [];

      var bound = mesh.getLocalBound();
      var dx = bound[3] - bound[0];
      var dy = bound[4] - bound[1];
      var dz = bound[5] - bound[2];
      var meshLocalSize = Math.hypot(dx, dy, dz);

      var safeMinRadius = meshLocalSize * 0.05;
      var safeMinRadiusSq = safeMinRadius * safeMinRadius;

      var maxLocalRadiusSq = Math.max(localRadiusSq, safeMinRadiusSq);
      var maxLocalRadius = Math.sqrt(maxLocalRadiusSq);

      // Step size is physically 5cm OR 5% of the mesh's bounding size, whichever is smaller.
      var vrScale = this._main && this._main._vrScale ? this._main._vrScale : 1.0;
      var physicalStepLocal = (0.05 / vrScale) / scale;
      var meshStepLocal = Math.max(0.0001, meshLocalSize * 0.05);
      var stepLocal = Math.min(physicalStepLocal, meshStepLocal);

      // Protect against insanely huge volumetric brushes triggering too many steps (cap at 60 lookups)
      if (maxLocalRadius / stepLocal > 60) {
        stepLocal = maxLocalRadius / 60;
      }

      var currentSearchR = stepLocal;

      while (currentSearchR <= maxLocalRadius) {
        iFaces = mesh.intersectSphere(localCenter, currentSearchR * currentSearchR);
        if (iFaces.length > 0) break;
        currentSearchR += stepLocal;
      }

      if (iFaces.length === 0) {
        iFaces = mesh.intersectSphere(localCenter, maxLocalRadiusSq);
      }

      const isSculpting = this._main && this._main._vrSculpting;

      if (iFaces.length === 0) continue;

      vAr = mesh.getVertices();
      fAr = mesh.getFaces();

      var faceBoxes = mesh.getFaceBoxes();
      var lRadius = maxLocalRadius;

      var rejectedByAABB = 0;
      var rejectedByDist = 0;

      // Find closest face
      for (var j = 0; j < iFaces.length; ++j) {
        var faceId = iFaces[j];
        var boxId = faceId * 6;

        // Fast AABB Check
        if (localCenter[0] < faceBoxes[boxId] - lRadius ||
            localCenter[0] > faceBoxes[boxId + 3] + lRadius ||
            localCenter[1] < faceBoxes[boxId + 1] - lRadius ||
            localCenter[1] > faceBoxes[boxId + 4] + lRadius ||
            localCenter[2] < faceBoxes[boxId + 2] - lRadius ||
            localCenter[2] > faceBoxes[boxId + 5] + lRadius) {
            rejectedByAABB++;
            continue;
        }

        var indFace = faceId * 4;

        // Get vertices
        var iv1 = fAr[indFace] * 3;
        var iv2 = fAr[indFace + 1] * 3;
        var iv3 = fAr[indFace + 2] * 3;

        v1[0] = vAr[iv1]; v1[1] = vAr[iv1 + 1]; v1[2] = vAr[iv1 + 2];
        v2[0] = vAr[iv2]; v2[1] = vAr[iv2 + 1]; v2[2] = vAr[iv2 + 2];
        v3[0] = vAr[iv3]; v3[1] = vAr[iv3 + 1]; v3[2] = vAr[iv3 + 2];

        // Check distance
        var distSq = Geometry.distance2PointTriangle(localCenter, v1, v2, v3, closestPoint);

        // Quad check?
        var iv4 = fAr[indFace + 3];
        if (iv4 !== Utils.TRI_INDEX) {
          var iv4i = iv4 * 3;
          var v4 = [vAr[iv4i], vAr[iv4i + 1], vAr[iv4i + 2]];
          var closestQuad = [0, 0, 0, 0];
          var distSq2 = Geometry.distance2PointTriangle(localCenter, v1, v3, v4, closestQuad);
          if (distSq2 < distSq) {
            distSq = distSq2;
            vec3.copy(closestPoint, closestQuad);
          }
        }

        if (distSq < maxLocalRadiusSq) { // Found a potential hit within radius
          // Convert dist to world for comparison
          var worldDist = Math.sqrt(distSq) * scale;
          if (worldDist < nearDistance) {
            nearDistance = worldDist;
            nearMesh = mesh;
            nearFace = iFaces[j];
            vec3.copy(nearPoint, closestPoint);
          }
        } else {
          rejectedByDist++;
        }
      }

      // Culling complete
    }



    if (nearMesh) {
      this._mesh = nearMesh;
      vec3.copy(this._interPoint, nearPoint);
      this._pickedFace = nearFace;
      // FIX for VR: Use the passed physical radius, DO NOT re-project to screen (which updateLocalAndWorldRadius2 does)
      this._rWorld2 = worldRadius * worldRadius;
      this._rLocal2 = maxLocalRadiusSq;
      return true;
    }

    // Reset Picking if no hit, UNLESS Lock Selection is enabled
    if (this._main && this._main._lockSelection) {
      const activeMesh = this._main.getMesh();
      if (activeMesh) {
        this._mesh = activeMesh;
        // Preserve the active locked mesh so tools like Move.js don't abort due to a !picking.getMesh() check!
        return false;
      }
    }

    this._mesh = null;
    this._pickedFace = -1;
    this._rLocal2 = 0.0;
    vec3.set(this._interPoint, 0.0, 0.0, 0.0);
    return false;
  }

  intersectionMouseMesh(mesh = this._main.getMesh(), mouseX = this._main._mouseX, mouseY = this._main._mouseY) {
    var vNear = this.unproject(mouseX, mouseY, 0.0);
    var vFar = this.unproject(mouseX, mouseY, 0.1);
    
    if (window._debugRay) {
      var eyeDir = [0, 0, 0];
      vec3.sub(eyeDir, vFar, vNear);
      vec3.normalize(eyeDir, eyeDir);
      console.log("Ray Dir:", eyeDir, "Mouse:", mouseX, mouseY, "Cam Size:", this._main.getCamera()._width, this._main.getCamera()._height);
    }

    var matInverse = mat4.create();
    mesh.getThreeMesh().updateMatrixWorld(true);
    mat4.invert(matInverse, mesh.getThreeMesh().matrixWorld.elements);
    vec3.transformMat4(vNear, vNear, matInverse);
    vec3.transformMat4(vFar, vFar, matInverse);
    return this.intersectionRayMesh(mesh, vNear, vFar);
  }

  /** Intersection between a ray and a mesh */
  intersectionRayMesh(mesh, vNearOrig, vFarOrig, twoSided = false) {
    // resest picking
    this._mesh = null;
    this._pickedFace = -1;
    // resest picking
    vec3.copy(_TMP_NEAR, vNearOrig);
    vec3.copy(_TMP_FAR, vFarOrig);
    // apply symmetry
    if (this._xSym) {
      var ptPlane = mesh.getSymmetryOrigin();
      var nPlane = mesh.getSymmetryNormal();
      Geometry.mirrorPoint(_TMP_NEAR, ptPlane, nPlane);
      Geometry.mirrorPoint(_TMP_FAR, ptPlane, nPlane);
    }
    var vAr = mesh.getVertices();
    var fAr = mesh.getFaces();
    // compute eye direction
    var eyeDir = this.getEyeDirection();
    vec3.sub(eyeDir, _TMP_FAR, _TMP_NEAR);
    vec3.normalize(eyeDir, eyeDir);
    var iFacesCandidates = mesh.intersectRay(_TMP_NEAR, eyeDir);
    var distance = Infinity;
    var nbFacesCandidates = iFacesCandidates.length;
    for (var i = 0; i < nbFacesCandidates; ++i) {
      var indFace = iFacesCandidates[i] * 4;
      var ind1 = fAr[indFace] * 3;
      var ind2 = fAr[indFace + 1] * 3;
      var ind3 = fAr[indFace + 2] * 3;
      _TMP_V1[0] = vAr[ind1];
      _TMP_V1[1] = vAr[ind1 + 1];
      _TMP_V1[2] = vAr[ind1 + 2];
      _TMP_V2[0] = vAr[ind2];
      _TMP_V2[1] = vAr[ind2 + 1];
      _TMP_V2[2] = vAr[ind2 + 2];
      _TMP_V3[0] = vAr[ind3];
      _TMP_V3[1] = vAr[ind3 + 1];
      _TMP_V3[2] = vAr[ind3 + 2];
      var hitDist = Geometry.intersectionRayTriangle(_TMP_NEAR, eyeDir, _TMP_V1, _TMP_V2, _TMP_V3, _TMP_INTER, twoSided);
      if (hitDist < 0.0) {
        ind2 = fAr[indFace + 3];
        if (ind2 !== Utils.TRI_INDEX) {
          ind2 *= 3;
          _TMP_V2[0] = vAr[ind2];
          _TMP_V2[1] = vAr[ind2 + 1];
          _TMP_V2[2] = vAr[ind2 + 2];
          hitDist = Geometry.intersectionRayTriangle(_TMP_NEAR, eyeDir, _TMP_V1, _TMP_V3, _TMP_V2, _TMP_INTER, twoSided);
        }
      }
      if (hitDist >= 0.0 && hitDist < distance) {
        distance = hitDist;
        vec3.copy(this._interPoint, _TMP_INTER);
        this._pickedFace = iFacesCandidates[i];
      }
    }
    if (this._pickedFace !== -1) {
      this._mesh = mesh;
      this.updateLocalAndWorldRadius2();
      return true;
    }
    this._rLocal2 = 0.0;
    return false;
  }

  /** Find all the vertices inside the sphere */
  pickVerticesInSphere(rLocal2) {
    var mesh = this._mesh;
    var vAr = mesh.getVertices();
    var vertSculptFlags = mesh.getVerticesSculptFlags();
    var inter = this.getIntersectionPoint();

    // Compute a safe minimum search radius to bridge stale Octree gaps.
    // If rLocal is tiny (due to matrix scaling), use a fraction of mesh size instead.
    var bound = mesh.getLocalBound();
    var dx = Math.max(0.001, bound[3] - bound[0]);
    var dy = Math.max(0.001, bound[4] - bound[1]);
    var dz = Math.max(0.001, bound[5] - bound[2]);
    var meshSize = Math.max(dx, dy, dz);
    
    // 2.5% of the mesh size is a safe, responsive bubble that doesn't over-fetch too many candidates
    var safeMinRadius = meshSize * 0.025; 
    var safeMinRadiusSq = safeMinRadius * safeMinRadius;
    var searchRadiusSq = Math.max(rLocal2, safeMinRadiusSq);

    var iFacesInCells = mesh.intersectSphere(inter, searchRadiusSq, true);
    var iVerts = mesh.getVerticesFromFaces(iFacesInCells);
    var nbVerts = iVerts.length;

    var sculptFlag = ++Utils.SCULPT_FLAG;
    var pickedVertices = new Uint32Array(Utils.getMemory(4 * nbVerts), 0, nbVerts);
    var acc = 0;
    var itx = inter[0];
    var ity = inter[1];
    var itz = inter[2];

    for (var i = 0; i < nbVerts; ++i) {
      var ind = iVerts[i];
      var j = ind * 3;
      var ddx = itx - vAr[j];
      var ddy = ity - vAr[j + 1];
      var ddz = itz - vAr[j + 2];
      if ((ddx * ddx + ddy * ddy + ddz * ddz) < searchRadiusSq) {
        vertSculptFlags[ind] = sculptFlag;
        pickedVertices[acc++] = ind;
      }
    }

    this._pickedVertices = new Uint32Array(pickedVertices.subarray(0, acc));
    return this._pickedVertices;
  }


  _isInsideSphere(id, inter, rLocal2) {
    if (id === Utils.TRI_INDEX) return false;
    var iv = id * 3;
    return vec3.sqrDist(inter, this._mesh.getVertices().subarray(iv, iv + 3)) <= rLocal2;
  }

  pickVerticesInSphereTopological(rLocal2) {
    var mesh = this._mesh;
    if (!mesh) return new Uint32Array(0);
    var nbVertices = mesh.getNbVertices();
    var vAr = mesh.getVertices();
    var fAr = mesh.getFaces();

    var vrvStartCount = mesh.getVerticesRingVertStartCount();
    var vertRingVert = mesh.getVerticesRingVert();
    var ringVerts = vertRingVert instanceof Array ? vertRingVert : null;

    var vertSculptFlags = mesh.getVerticesSculptFlags();
    var vertTagFlags = mesh.getVerticesTagFlags();

    var sculptFlag = ++Utils.SCULPT_FLAG;
    var tagFlag = ++Utils.TAG_FLAG;

    var inter = this.getIntersectionPoint();
    var itx = inter[0];
    var ity = inter[1];
    var itz = inter[2];

    var pickedVertices = new Uint32Array(Utils.getMemory(4 * nbVertices), 0, nbVertices);
    var idf = this.getPickedFace() * 4;
    var acc = 1;

    if (this._isInsideSphere(fAr[idf], inter, rLocal2)) pickedVertices[0] = fAr[idf];
    else if (this._isInsideSphere(fAr[idf + 1], inter, rLocal2)) pickedVertices[0] = fAr[idf + 1];
    else if (this._isInsideSphere(fAr[idf + 2], inter, rLocal2)) pickedVertices[0] = fAr[idf + 2];
    else if (this._isInsideSphere(fAr[idf + 3], inter, rLocal2)) pickedVertices[0] = fAr[idf + 3];
    else acc = 0;

    if (acc === 1) {
      vertSculptFlags[pickedVertices[0]] = sculptFlag;
      vertTagFlags[pickedVertices[0]] = tagFlag;
    }

    for (var i = 0; i < acc; ++i) {
      var id = pickedVertices[i];
      var start, end;
      if (ringVerts) {
        vertRingVert = ringVerts[id];
        start = 0;
        end = vertRingVert.length;
      } else {
        start = vrvStartCount[id * 2];
        end = start + vrvStartCount[id * 2 + 1];
      }

      for (var j = start; j < end; ++j) {
        var idv = vertRingVert[j];
        if (vertTagFlags[idv] === tagFlag)
          continue;
        vertTagFlags[idv] = tagFlag;

        var id3 = idv * 3;
        var dx = itx - vAr[id3];
        var dy = ity - vAr[id3 + 1];
        var dz = itz - vAr[id3 + 2];
        if ((dx * dx + dy * dy + dz * dz) > rLocal2)
          continue;

        vertSculptFlags[idv] = sculptFlag;
        pickedVertices[acc++] = idv;
      }
    }

    this._pickedVertices = new Uint32Array(pickedVertices.subarray(0, acc));
    return this._pickedVertices;
  }

  computeWorldRadius2(ignorePressure) {
    this._mesh.getThreeMesh().updateMatrixWorld(true);
    vec3.transformMat4(_TMP_INTER, this.getIntersectionPoint(), this._mesh.getThreeMesh().matrixWorld.elements);
 
    var offsetX = this._main.getSculptManager().getCurrentTool().getScreenRadius();
    if (!ignorePressure) offsetX *= Tablet.getPressureRadius();
 
    var screenInter = this.project(_TMP_INTER);
    return vec3.sqrDist(_TMP_INTER, this.unproject(screenInter[0] + offsetX, screenInter[1], screenInter[2]));
  }

  updateLocalAndWorldRadius2() {
    if (!this._mesh) return;
    this._rWorld2 = this.computeWorldRadius2();

    const m = this._mesh.getThreeMesh().matrixWorld.elements;
    const scale2 = m[0] * m[0] + m[4] * m[4] + m[8] * m[8];
    this._rLocal2 = this._rWorld2 / scale2;
  }

  unproject(x, y, z) {
    const cam = this._main.getCamera();
    // Desktop picking align fix for STATIONARY / TRACKED VR
    const isSpectator = this._main.getXRMode && this._main.getXRMode() &&
      (this._main._spectatorMode === 0 || this._main._spectatorMode === 1);

    if (isSpectator) cam._unprojectDiverted = true;
    const res = cam.unproject(x, y, z);
    if (isSpectator) cam._unprojectDiverted = false;

    return res;
  }

  project(vec) {
    const cam = this._main.getCamera();
    const isSpectator = this._main.getXRMode && this._main.getXRMode() &&
      (this._main._spectatorMode === 0 || this._main._spectatorMode === 1);

    if (isSpectator) cam._unprojectDiverted = true;
    const res = cam.project(vec);
    if (isSpectator) cam._unprojectDiverted = false;

    return res;
  }

  computePickedNormal() {
    if (!this._mesh || this._pickedFace < 0) return;
    // OPTIMIZATION: Fallback if normals are missing (e.g. Voxel Flat Shader)
    const normals = this._mesh.getNormals();
    if (normals && normals.length > 0) {
      this.polyLerp(normals, this._pickedNormal);
    } else {
      // Compute Face Normal
      const fAr = this._mesh.getFaces();
      const vAr = this._mesh.getVertices();
      const id = this._pickedFace * 4;
      const iv1 = fAr[id] * 3;
      const iv2 = fAr[id + 1] * 3;
      const iv3 = fAr[id + 2] * 3;

      const v1 = vAr.subarray(iv1, iv1 + 3);
      const v2 = vAr.subarray(iv2, iv2 + 3);
      const v3 = vAr.subarray(iv3, iv3 + 3);

      Geometry.triangleNormal(this._pickedNormal, v1, v2, v3);
    }
    return vec3.normalize(this._pickedNormal, this._pickedNormal);
  }

  polyLerp(vField, out) {
    var vAr = this._mesh.getVertices();
    var fAr = this._mesh.getFaces();
    var id = this._pickedFace * 4;
    var iv1 = fAr[id] * 3;
    var iv2 = fAr[id + 1] * 3;
    var iv3 = fAr[id + 2] * 3;

    var iv4 = fAr[id + 3];
    var isQuad = iv4 !== Utils.TRI_INDEX;
    if (isQuad) iv4 *= 3;

    var d1 = vec3.dist(this._interPoint, vAr.subarray(iv1, iv1 + 3));
    if (d1 < 1e-6) return vec3.copy(out, vField.subarray(iv1, iv1 + 3));
    var len1 = 1.0 / d1;

    var d2 = vec3.dist(this._interPoint, vAr.subarray(iv2, iv2 + 3));
    if (d2 < 1e-6) return vec3.copy(out, vField.subarray(iv2, iv2 + 3));
    var len2 = 1.0 / d2;

    var d3 = vec3.dist(this._interPoint, vAr.subarray(iv3, iv3 + 3));
    if (d3 < 1e-6) return vec3.copy(out, vField.subarray(iv3, iv3 + 3));
    var len3 = 1.0 / d3;

    var len4 = 0.0;
    if (isQuad) {
      var d4 = vec3.dist(this._interPoint, vAr.subarray(iv4, iv4 + 3));
      if (d4 < 1e-6) return vec3.copy(out, vField.subarray(iv4, iv4 + 3));
      len4 = 1.0 / d4;
    }

    var invSum = 1.0 / (len1 + len2 + len3 + len4);
    vec3.set(out, 0.0, 0.0, 0.0);
    vec3.scaleAndAdd(out, out, vField.subarray(iv1, iv1 + 3), len1 * invSum);
    vec3.scaleAndAdd(out, out, vField.subarray(iv2, iv2 + 3), len2 * invSum);
    vec3.scaleAndAdd(out, out, vField.subarray(iv3, iv3 + 3), len3 * invSum);
    if (isQuad) vec3.scaleAndAdd(out, out, vField.subarray(iv4, iv4 + 3), len4 * invSum);
    vec3.normalize(out, out);
    return out;
  }

  /** Intersection between a thick ray (segment) and a mesh */
  intersectionRayMeshThick(mesh, vNearOrig, vFarOrig, radiusSq) {
    var dir = _TMP_DIR_PICK;
    vec3.sub(dir, vFarOrig, vNearOrig);
    vec3.normalize(dir, dir);
    // reset picking
    this._mesh = null;
    this._pickedFace = -1;

    vec3.copy(_TMP_NEAR, vNearOrig);
    vec3.copy(_TMP_FAR, vFarOrig);

    // Apply Symmetry (Optional? For Gizmos usually irrelevant but good for consistency)
    if (this._xSym) {
      var ptPlane = mesh.getSymmetryOrigin();
      var nPlane = mesh.getSymmetryNormal();
      Geometry.mirrorPoint(_TMP_NEAR, ptPlane, nPlane);
      Geometry.mirrorPoint(_TMP_FAR, ptPlane, nPlane);
    }

    var vAr = mesh.getVertices();
    var fAr = mesh.getFaces();

    var minRadiusSq = Infinity;
    var distance = Infinity; // distanceToCamera - keep for tie-breaking or mesh-sorting
    var nbFaces = fAr.length / 4; // Quads/Tris

    // We iterate ALL faces (Structure dependent)
    // Optimization: Check bounding box first? 
    // Gizmos are small, full iteration is fine.

    // Temp vars for Segment-Segment
    var closestRay = [0.0, 0.0, 0.0];
    var closestEdge = [0.0, 0.0, 0.0];

    for (var i = 0; i < nbFaces; ++i) {
      var indFace = i * 4;
      var iv1 = fAr[indFace] * 3;
      var iv2 = fAr[indFace + 1] * 3;
      var iv3 = fAr[indFace + 2] * 3;
      var iv4 = fAr[indFace + 3];

      _TMP_V1[0] = vAr[iv1]; _TMP_V1[1] = vAr[iv1 + 1]; _TMP_V1[2] = vAr[iv1 + 2];
      _TMP_V2[0] = vAr[iv2]; _TMP_V2[1] = vAr[iv2 + 1]; _TMP_V2[2] = vAr[iv2 + 2];
      _TMP_V3[0] = vAr[iv3]; _TMP_V3[1] = vAr[iv3 + 1]; _TMP_V3[2] = vAr[iv3 + 2];

      // Check Edge 1 (V1-V2)
      var d1 = Geometry.distanceSqSegmentSegment(_TMP_NEAR, _TMP_FAR, _TMP_V1, _TMP_V2, closestRay, closestEdge);
      if (window.debugPicking) {
        // Visual debug for close calls (within 5x radius)
        if (d1 < radiusSq * 25.0) {
          // We can't easily draw lines, but we can log or draw a sphere at the candidate
          // Need to transform closestEdge to World for debug view
          var worldPt = vec3.create();
          vec3.transformMat4(worldPt, closestEdge, mesh.getMatrix());
          // Draw RED if miss, GREEN if hit (logic below)
          var isHit = d1 < radiusSq;
          // We need a way to accumulate debug points? 
          // For now, let's just use the main debug sphere for the BEST hit.
        }
      }

      if (d1 < radiusSq) {
        vec3.sub(_TMP_V1, closestRay, _TMP_NEAR);
        if (vec3.dot(_TMP_V1, dir) > 0.0001) {
          if (d1 < minRadiusSq) {
            minRadiusSq = d1;
            distance = vec3.sqrDist(_TMP_NEAR, closestRay);
            vec3.copy(this._interPoint, closestEdge); // Snap to Edge
            this._pickedFace = i;

            if (window.debugPicking) {
              var worldPt = vec3.create();
              vec3.transformMat4(worldPt, closestEdge, mesh.getMatrix());
              if (this._main.updateDebugPivot) this._main.updateDebugPivot(worldPt, true); // Green
            }
          }
        }
      }

      // Check Edge 2 (V2-V3)
      var d2 = Geometry.distanceSqSegmentSegment(_TMP_NEAR, _TMP_FAR, _TMP_V2, _TMP_V3, closestRay, closestEdge);
      if (d2 < radiusSq) {
        vec3.sub(_TMP_V1, closestRay, _TMP_NEAR);
        if (vec3.dot(_TMP_V1, dir) > 0.0001) {
          if (d2 < minRadiusSq) {
            minRadiusSq = d2;
            distance = vec3.sqrDist(_TMP_NEAR, closestRay);
            vec3.copy(this._interPoint, closestEdge);
            this._pickedFace = i;
            if (window.debugPicking) {
              var worldPt = vec3.create();
              vec3.transformMat4(worldPt, closestEdge, mesh.getMatrix());
              if (this._main.updateDebugPivot) this._main.updateDebugPivot(worldPt, true);
            }
          }
        }
      }

      // Check Edge 3 (V3-V1) or (V3-V4)
      if (iv4 === Utils.TRI_INDEX) {
        // Triangle
        var d3 = Geometry.distanceSqSegmentSegment(_TMP_NEAR, _TMP_FAR, _TMP_V3, _TMP_V1, closestRay, closestEdge);
        if (d3 < radiusSq) {
          vec3.sub(_TMP_V1, closestRay, _TMP_NEAR);
          if (vec3.dot(_TMP_V1, dir) > 0.0001) {
            if (d3 < minRadiusSq) {
              minRadiusSq = d3;
              distance = vec3.sqrDist(_TMP_NEAR, closestRay);
              vec3.copy(this._interPoint, closestEdge);
              this._pickedFace = i;
              if (window.debugPicking) {
                var worldPt = vec3.create();
                vec3.transformMat4(worldPt, closestEdge, mesh.getMatrix());
                if (this._main.updateDebugPivot) this._main.updateDebugPivot(worldPt, true);
              }
            }
          }
        }
      } else {
        // Quad (Check V3-V4 and V4-V1)
        var iv4i = iv4 * 3;
        var v4 = [vAr[iv4i], vAr[iv4i + 1], vAr[iv4i + 2]];

        // Edge 3 (V3-V4)
        var d3 = Geometry.distanceSqSegmentSegment(_TMP_NEAR, _TMP_FAR, _TMP_V3, v4, closestRay, closestEdge);
        if (d3 < radiusSq) {
          vec3.sub(_TMP_V1, closestRay, _TMP_NEAR);
          if (vec3.dot(_TMP_V1, dir) > 0.0001) {
            if (d3 < minRadiusSq) {
              minRadiusSq = d3;
              distance = vec3.sqrDist(_TMP_NEAR, closestRay);
              vec3.copy(this._interPoint, closestEdge);
              this._pickedFace = i;
              if (window.debugPicking) {
                var worldPt = vec3.create();
                vec3.transformMat4(worldPt, closestEdge, mesh.getMatrix());
                if (this._main.updateDebugPivot) this._main.updateDebugPivot(worldPt, true);
              }
            }
          }
        }

        // Edge 4 (V4-V1)
        var d4 = Geometry.distanceSqSegmentSegment(_TMP_NEAR, _TMP_FAR, v4, _TMP_V1, closestRay, closestEdge);
        if (d4 < radiusSq) {
          vec3.sub(_TMP_V1, closestRay, _TMP_NEAR);
          if (vec3.dot(_TMP_V1, dir) > 0.0001) {
            if (d4 < minRadiusSq) {
              minRadiusSq = d4;
              distance = vec3.sqrDist(_TMP_NEAR, closestRay);
              vec3.copy(this._interPoint, closestEdge);
              this._pickedFace = i;
              if (window.debugPicking) {
                var worldPt = vec3.create();
                vec3.transformMat4(worldPt, closestEdge, mesh.getMatrix());
                if (this._main.updateDebugPivot) this._main.updateDebugPivot(worldPt, true);
              }
            }
          }
        }
      }
    }

    if (this._pickedFace !== -1) {
      this._mesh = mesh;
      return true; // Match found
    }
    return false;
  }

  /** Intersection for VR (Bypasses Screen Projection) */
  intersectionRayMeshesVR(meshes, origin, direction, physicalRadius) {
    this._isVRHit = true;
    var nearDistance = Infinity;
    var nearMesh = null;
    var nearFace = -1;

    // vNear = origin
    // vFar = origin + direction * length
    vec3.copy(_TMP_NEAR_1, origin);
    vec3.scaleAndAdd(_TMP_FAR_1, origin, direction, 100.0); // 100m range (better precision)

    // Scale physical radius to World Units (approximate, since picking is in local space usually)
    // Actually intersectionRayMesh takes Ray in Local Space.
    // So we need to scale the radius to Local Space.

    for (var i = 0, nbMeshes = meshes.length; i < nbMeshes; ++i) {
      var mesh = meshes[i];
      if (!mesh.isVisible()) continue;

      mat4.invert(_TMP_INV, mesh.getMatrix());
      vec3.transformMat4(_TMP_NEAR, _TMP_NEAR_1, _TMP_INV);
      vec3.transformMat4(_TMP_FAR, _TMP_FAR_1, _TMP_INV);

      // Local Radius Squared
      // World Radius = physicalRadius (e.g. 0.05)
      // Local Radius = World Radius / Scale
      var scale = mesh.getScale();
      var localRadius = physicalRadius / scale;
      var localRadiusSq = localRadius * localRadius;

      // First check EXACT Ray Cast (Priority)
      var hitExact = this.intersectionRayMesh(mesh, _TMP_NEAR, _TMP_FAR);
      var hitThick = false;

      // If no exact hit, check Thick
      if (!hitExact) {
        hitThick = this.intersectionRayMeshThick(mesh, _TMP_NEAR, _TMP_FAR, localRadiusSq);
      }

      if (!hitExact && !hitThick) continue;

      var interTest = this.getIntersectionPoint();
      // Distance check (world space)
      vec3.transformMat4(_TMP_V1, interTest, mesh.getMatrix());
      var testDistance = vec3.dist(origin, _TMP_V1);

      if (testDistance < nearDistance) {
        nearDistance = testDistance;
        nearMesh = mesh;
        vec3.copy(_TMP_INTER_1, interTest);
        nearFace = this.getPickedFace();
      }
    }

    this._mesh = nearMesh;
    vec3.copy(this._interPoint, _TMP_INTER_1);
    this._pickedFace = nearFace;

    // VR RADIUS FIX: Store in Engine Units (apply inverse vrScale)
    if (nearFace !== -1) {
      const vrScale = this._main._vrScale || 50.0;
      const pickingRadius = physicalRadius / vrScale;
      this._rWorld2 = pickingRadius * pickingRadius;
      // Parent-aware: convert world radius to LOCAL using the composed MODEL scale
      // (parentChain * _matrix), not the raw local getScale2(). For a parented child
      // these differ by the parent's scale — using local blows the radius up ~scale²
      // and the brush engulfs the whole mesh.
      const _msc = nearMesh.getModelSpaceScale ? nearMesh.getModelSpaceScale() : nearMesh.getScale();
      this._rLocal2 = this._rWorld2 / (_msc * _msc);
    } else {
      this._rLocal2 = 0.0;
    }

    return !!nearMesh;
  }
}

// TODO update i18n strings in a dynamic way
Picking.INIT_ALPHAS_NAMES = [TR('alphaSquare'), TR('alphaSkin')];
Picking.INIT_ALPHAS_PATHS = ['square.jpg', 'skin.jpg'];

var readAlphas = function () {
  // check nodejs
  if (!window.module || !window.module.exports) return;
  var fs = eval('require')('fs');
  var path = eval('require')('path');

  var directoryPath = path.join(window.__filename, '../resources/alpha');
  fs.readdir(directoryPath, function (err, files) {
    if (err) return;
    for (var i = 0; i < files.length; ++i) {
      var fname = files[i];
      if (fname == 'square.jpg' || fname == 'skin.jpg') continue;
      Picking.INIT_ALPHAS_NAMES.push(fname);
      Picking.INIT_ALPHAS_PATHS.push(fname);
    }
  });
};

readAlphas();

var none = TR('alphaNone');
Picking.ALPHAS_NAMES = {};
Picking.ALPHAS_NAMES[none] = none;

Picking.ALPHAS = {};
Picking.ALPHAS[none] = null;

export default Picking;
