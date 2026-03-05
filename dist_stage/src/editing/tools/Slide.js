import { vec3, mat4, quat } from 'gl-matrix';
import Geometry from '../../math3d/Geometry.js';
import SculptBase from './SculptBase.js';
import Smooth from './Smooth.js';
import Utils from '../../misc/Utils.js';

class Slide extends SculptBase {

  constructor(main) {
    super(main);

    this._radius = 50; // Normalize size to match Move brush
    this._dragDir = [0.0, 0.0, 0.0];
    this._dragDirSym = [0.0, 0.0, 0.0];
    this._idAlpha = 0;
    this._lastVRQuat = quat.create();
  }

  // VR Support: Drag needs to calculate delta from controller movement
  updateXR(picking, isPressed) {
    var main = this._main;
    if (!main._vrControllerPos) return;

    if (!isPressed) {
      // HOVER
      if (!this._lastVRPos) this._lastVRPos = vec3.create();
      vec3.copy(this._lastVRPos, main._vrControllerPos);

      if (main._vrControllerQuat) {
        quat.copy(this._lastVRQuat, main._vrControllerQuat);
      }

      var pickingSym = main.getSculptManager().getSymmetry() ? main.getPickingSymmetry() : null;
      super.makeStrokeXR(picking, pickingSym, false);
      this.updateRender();
      return;
    }

    if (!this._lastVRPos) {
      this._lastVRPos = vec3.clone(main._vrControllerPos);
      if (main._vrControllerQuat) {
        quat.copy(this._lastVRQuat, main._vrControllerQuat);
      }

      // CRITICAL FIX: Drag/Slide overrides standard SculptManager/SculptBase initialization for its stroke logic.
      // We MUST ensure the initial state is pushed, else Undo/Redo will throw `getCurrentState` TypeError.
      this.pushState();
      return;
    }

    // VR DRAG LOGIC (Modernized to match Move.js logic)
    var deltaWorld = vec3.create();
    vec3.sub(deltaWorld, main._vrControllerPos, this._lastVRPos);

    var mesh = this.getMesh();
    if (!mesh) return;

    var invMat = mat4.create();
    mat4.invert(invMat, mesh.getMatrix());

    // Vector transformation (ignore translation by doing head - zero)
    var zero = vec3.create();
    var localZero = vec3.create();
    var localHead = vec3.create();
    vec3.transformMat4(localZero, zero, invMat);
    vec3.transformMat4(localHead, deltaWorld, invMat);
    vec3.sub(this._dragDir, localHead, localZero);

    // VR 6DOF ROTATION LOGIC
    var qMesh = quat.create();
    mat4.getRotation(qMesh, mesh.getMatrix());
    var qMeshInv = quat.create();
    quat.invert(qMeshInv, qMesh);

    var qStartLocal = quat.create();
    quat.multiply(qStartLocal, qMeshInv, this._lastVRQuat);

    var qCurrLocal = quat.create();
    quat.multiply(qCurrLocal, qMeshInv, main._vrControllerQuat);

    var qDeltaLocal = quat.create();
    var qStartInv = quat.create();
    quat.invert(qStartInv, qStartLocal);
    quat.multiply(qDeltaLocal, qCurrLocal, qStartInv);

    var qScaledLocal = quat.create();
    var qIdentity = quat.create();
    quat.slerp(qScaledLocal, qIdentity, qDeltaLocal, 1.0); // Intensity can scale this

    // repick vertices at new center (Scene.js updated intersection)
    picking._mesh = mesh;
    // CRITICAL FIX: Do NOT call picking.updateLocalAndWorldRadius2(). It recalculates radius based on screen-space camera FOV,
    // which completely destroys VR physical radius scaling, causing the cursor to shrink to a dot. VR radius is set in Scene.js.
    picking.pickVerticesInSphere(picking.getLocalRadius2());
    picking.computePickedNormal();

    // Apply primary stroke
    this.slide(picking.getPickedVertices(), picking.getIntersectionPoint(), picking.getLocalRadius2(), false, picking, qScaledLocal);

    // Symmetry
    var pickingSym = main.getPickingSymmetry();
    if (main.getSculptManager().getSymmetry() && pickingSym) {
      // Mirror the delta vector for the symmetrical brush direction
      vec3.copy(this._dragDirSym, this._dragDir);
      Geometry.mirrorPoint(this._dragDirSym, [0, 0, 0], mesh.getSymmetryNormal());

      pickingSym._mesh = mesh;
      vec3.copy(pickingSym.getIntersectionPoint(), picking.getIntersectionPoint());
      Geometry.mirrorPoint(pickingSym.getIntersectionPoint(), mesh.getSymmetryOrigin(), mesh.getSymmetryNormal());

      pickingSym.setLocalRadius2(picking.getLocalRadius2());
      pickingSym.pickVerticesInSphere(pickingSym.getLocalRadius2());
      pickingSym.computePickedNormal();

      var qDeltaSym = quat.clone(qScaledLocal);
      qDeltaSym[1] = -qDeltaSym[1];    // Y Inverted
      qDeltaSym[2] = -qDeltaSym[2];    // Z Inverted

      this.slide(pickingSym.getPickedVertices(), pickingSym.getIntersectionPoint(), pickingSym.getLocalRadius2(), true, pickingSym, qDeltaSym);
    }

    // Update history
    vec3.copy(this._lastVRPos, main._vrControllerPos);
    if (main._vrControllerQuat) quat.copy(this._lastVRQuat, main._vrControllerQuat);

    if (mesh.isDynamic) {
      this.updateMeshBuffers();
    }

    this.updateRender();
  }

  sculptStroke() {
    var main = this._main;
    var mesh = this.getMesh();
    var picking = main.getPicking();
    var pickingSym = main.getSculptManager().getSymmetry() ? main.getPickingSymmetry() : null;

    var dx = main._mouseX - this._lastMouseX;
    var dy = main._mouseY - this._lastMouseY;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var minSpacing = 0.15 * this._radius;

    var step = 1.0 / Math.floor(dist / minSpacing);
    dx *= step;
    dy *= step;
    var mouseX = this._lastMouseX;
    var mouseY = this._lastMouseY;

    if (!picking.getMesh())
      return;
    picking._mesh = mesh;
    if (pickingSym) {
      pickingSym._mesh = mesh;
      vec3.copy(pickingSym.getIntersectionPoint(), picking.getIntersectionPoint());
      Geometry.mirrorPoint(pickingSym.getIntersectionPoint(), mesh.getSymmetryOrigin(), mesh.getSymmetryNormal());
    }

    for (var i = 0.0; i < 1.0; i += step) {
      if (!this.makeStroke(mouseX, mouseY, picking, pickingSym))
        break;
      mouseX += dx;
      mouseY += dy;
    }

    this.updateRender();

    this._lastMouseX = main._mouseX;
    this._lastMouseY = main._mouseY;
  }

  makeStroke(mouseX, mouseY, picking, pickingSym) {
    var mesh = this.getMesh();
    this.updateDragDir(picking, mouseX, mouseY);
    picking.pickVerticesInSphere(picking.getLocalRadius2());
    picking.computePickedNormal();
    // if dyn topo, we need to the picking and the sculpting altogether
    if (mesh.isDynamic)
      this.stroke(picking, false);

    if (pickingSym) {
      this.updateDragDir(pickingSym, mouseX, mouseY, true);
      pickingSym.setLocalRadius2(picking.getLocalRadius2());
      pickingSym.pickVerticesInSphere(pickingSym.getLocalRadius2());
    }

    if (!mesh.isDynamic) this.stroke(picking, false);
    if (pickingSym) this.stroke(pickingSym, true);

    if (mesh.isDynamic) {
      this.updateMeshBuffers();
    }

    return true;
  }

  /** On stroke */
  stroke(picking, sym) {
    var iVertsInRadius = picking.getPickedVertices();

    // undo-redo
    this._main.getStateManager().pushVertices(iVertsInRadius);
    iVertsInRadius = this.dynamicTopology(picking);

    picking.updateAlpha(this._lockPosition);
    picking.setIdAlpha(this._idAlpha);
    this.slide(iVertsInRadius, picking.getIntersectionPoint(), picking.getLocalRadius2(), sym, picking);

    // Tangential relaxation pass to prevent bunching
    this.smoothTangent(iVertsInRadius, 1.0, picking);

    var mesh = this.getMesh();
    mesh.updateGeometry(mesh.getFacesFromVertices(iVertsInRadius), iVertsInRadius);
  }

  /** Slide deformation with Closest-Point O(1) Snapping */
  slide(iVerts, center, radiusSquared, sym, picking, rotQuat) {
    var mesh = this.getMesh();
    var vAr = mesh.getVertices();
    var mAr = mesh.getMaterials();
    var fAr = mesh.getFaces();
    var nAr = mesh.getNormals();

    var vrfStartCount = mesh.getVerticesRingFaceStartCount();
    var vertRingFace = mesh.getVerticesRingFace();
    var ringFaces = vertRingFace instanceof Array ? vertRingFace : null;

    var radius = Math.sqrt(radiusSquared);
    var cx = center[0];
    var cy = center[1];
    var cz = center[2];
    var dir = sym ? this._dragDirSym : this._dragDir;
    var dirx = dir[0];
    var diry = dir[1];
    var dirz = dir[2];

    var nbVerts = iVerts.length;
    var newPos = new Float32Array(nbVerts * 3);
    var vTarget = [0.0, 0.0, 0.0];
    var v1 = [0.0, 0.0, 0.0];
    var v2 = [0.0, 0.0, 0.0];
    var v3 = [0.0, 0.0, 0.0];
    var v4 = [0.0, 0.0, 0.0];
    var closest = [0.0, 0.0, 0.0, 0];
    var bestClosest = [0.0, 0.0, 0.0];
    var vTemp = [0.0, 0.0, 0.0];

    for (var i = 0; i < nbVerts; ++i) {
      var idVert = iVerts[i];
      var ind = idVert * 3;
      var vx = vAr[ind];
      var vy = vAr[ind + 1];
      var vz = vAr[ind + 2];
      var nx = nAr[ind];
      var ny = nAr[ind + 1];
      var nz = nAr[ind + 2];

      var dx = vx - cx;
      var dy = vy - cy;
      var dz = vz - cz;
      var dist = Math.sqrt(dx * dx + dy * dy + dz * dz) / radius;
      if (dist >= 1.0) {
        newPos[i * 3] = vx; newPos[i * 3 + 1] = vy; newPos[i * 3 + 2] = vz;
        continue;
      }

      var fallOff = dist * dist;
      fallOff = 3.0 * fallOff * fallOff - 4.0 * fallOff * dist + 1.0;

      // Prevent "Bum Crease" crossover tearing on Symmetry Plane
      var useSymmetry = this._main.getSculptManager().getSymmetry();
      if (useSymmetry) {
        var ptPlane = mesh.getSymmetryOrigin();
        var nPlane = mesh.getSymmetryNormal();
        var vDist = (vx - ptPlane[0]) * nPlane[0] + (vy - ptPlane[1]) * nPlane[1] + (vz - ptPlane[2]) * nPlane[2];
        var cDist = (cx - ptPlane[0]) * nPlane[0] + (cy - ptPlane[1]) * nPlane[1] + (cz - ptPlane[2]) * nPlane[2];
        var brushSide = cDist >= 0 ? 1.0 : -1.0;
        var symFactor = 0.5 + 0.5 * (vDist * brushSide / radius);
        symFactor = Math.min(Math.max(symFactor, 0.0), 1.0);
        fallOff *= symFactor;
      }

      fallOff *= mAr[ind + 2] * picking.getAlpha(vx, vy, vz);

      // Tangential Projection
      var dot = dirx * nx + diry * ny + dirz * nz;
      var tx = dirx - dot * nx;
      var ty = diry - dot * ny;
      var tz = dirz - dot * nz;

      // Rotational delta
      var rotX = 0, rotY = 0, rotZ = 0;
      if (rotQuat) {
        vTemp[0] = dx; vTemp[1] = dy; vTemp[2] = dz;
        vec3.transformQuat(vTemp, vTemp, rotQuat);
        rotX = vTemp[0] - dx;
        rotY = vTemp[1] - dy;
        rotZ = vTemp[2] - dz;
      }

      vTarget[0] = vx + (tx + rotX) * fallOff;
      vTarget[1] = vy + (ty + rotY) * fallOff;
      vTarget[2] = vz + (tz + rotZ) * fallOff;

      var minDistSq = Infinity;
      var foundHit = false;

      var start, end;
      var ringArray = vertRingFace;
      if (ringFaces) {
        ringArray = ringFaces[idVert];
        start = 0;
        end = ringArray.length;
      } else {
        start = vrfStartCount[idVert * 2];
        end = start + vrfStartCount[idVert * 2 + 1];
      }

      for (var j = start; j < end; ++j) {
        var idFace = ringArray[j] * 4;
        var iv1 = fAr[idFace] * 3;
        var iv2 = fAr[idFace + 1] * 3;
        var iv3 = fAr[idFace + 2] * 3;
        var iv4 = fAr[idFace + 3];

        v1[0] = vAr[iv1]; v1[1] = vAr[iv1 + 1]; v1[2] = vAr[iv1 + 2];
        v2[0] = vAr[iv2]; v2[1] = vAr[iv2 + 1]; v2[2] = vAr[iv2 + 2];
        v3[0] = vAr[iv3]; v3[1] = vAr[iv3 + 1]; v3[2] = vAr[iv3 + 2];

        var distSq = Geometry.distance2PointTriangle(vTarget, v1, v2, v3, closest);
        if (distSq < minDistSq) {
          minDistSq = distSq;
          bestClosest[0] = closest[0];
          bestClosest[1] = closest[1];
          bestClosest[2] = closest[2];
          foundHit = true;
        }

        if (iv4 !== Utils.TRI_INDEX) {
          iv4 *= 3;
          v4[0] = vAr[iv4]; v4[1] = vAr[iv4 + 1]; v4[2] = vAr[iv4 + 2];
          distSq = Geometry.distance2PointTriangle(vTarget, v1, v3, v4, closest);
          if (distSq < minDistSq) {
            minDistSq = distSq;
            bestClosest[0] = closest[0];
            bestClosest[1] = closest[1];
            bestClosest[2] = closest[2];
            foundHit = true;
          }
        }
      }

      if (foundHit) {
        newPos[i * 3] = bestClosest[0];
        newPos[i * 3 + 1] = bestClosest[1];
        newPos[i * 3 + 2] = bestClosest[2];
      } else {
        newPos[i * 3] = vTarget[0];
        newPos[i * 3 + 1] = vTarget[1];
        newPos[i * 3 + 2] = vTarget[2];
      }
    }

    // Apply snapped positions
    for (var i = 0; i < nbVerts; ++i) {
      var ind = iVerts[i] * 3;
      vAr[ind] = newPos[i * 3];
      vAr[ind + 1] = newPos[i * 3 + 1];
      vAr[ind + 2] = newPos[i * 3 + 2];
    }
  }

  /** Set a few infos that will be needed for the drag function afterwards */
  updateDragDir(picking, mouseX, mouseY, useSymmetry) {
    var mesh = this.getMesh();
    var vNear = picking.unproject(mouseX, mouseY, 0.0);
    var vFar = picking.unproject(mouseX, mouseY, 0.1);
    var matInverse = mat4.create();
    mat4.invert(matInverse, mesh.getMatrix());
    vec3.transformMat4(vNear, vNear, matInverse);
    vec3.transformMat4(vFar, vFar, matInverse);
    var dir = this._dragDir;
    if (useSymmetry) {
      dir = this._dragDirSym;
      var ptPlane = mesh.getSymmetryOrigin();
      var nPlane = mesh.getSymmetryNormal();
      Geometry.mirrorPoint(vNear, ptPlane, nPlane);
      Geometry.mirrorPoint(vFar, ptPlane, nPlane);
    }
    var center = picking.getIntersectionPoint();
    picking.setIntersectionPoint(Geometry.vertexOnLine(center, vNear, vFar));
    vec3.sub(dir, picking.getIntersectionPoint(), center);
    picking._mesh = mesh;
    picking.updateLocalAndWorldRadius2();
    var eyeDir = picking.getEyeDirection();
    vec3.sub(eyeDir, vFar, vNear);
    vec3.normalize(eyeDir, eyeDir);
  }

  // Delegate smoothing math to Smooth.js to handle Tangential Relaxation
  laplacianSmooth(iVerts, smoothVerts) {
    return Smooth.prototype.laplacianSmooth.call(this, iVerts, smoothVerts);
  }

  smoothTangent(iVerts, intensity, picking) {
    return Smooth.prototype.smoothTangent.call(this, iVerts, intensity, picking);
  }
}

export default Slide;
