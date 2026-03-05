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

  startSculpt() {
    var mesh = this.getMesh();
    if (!mesh) return;

    var vAr = mesh.getVertices();
    if (!this._slideVProxy || this._slideVProxy.length !== vAr.length) {
      this._slideVProxy = new Float32Array(vAr.length);
    }
    this._slideVProxy.set(vAr); // Capture frozen mesh state O(N) very fast

    var nAr = mesh.getNormals();
    if (!this._slideNProxy || this._slideNProxy.length !== nAr.length) {
      this._slideNProxy = new Float32Array(nAr.length);
    }
    this._slideNProxy.set(nAr); // Capture frozen normals to ensure tangent projection doesn't tilt inward

    // Initialize anchor mappings for topological walking
    var nbVerts = vAr.length / 3;
    if (!this._slideAnchors || this._slideAnchors.length !== nbVerts) {
      this._slideAnchors = new Uint32Array(nbVerts);
    }
    for (var i = 0; i < nbVerts; i++) {
      this._slideAnchors[i] = i;
    }

    super.startSculpt();
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
    // We scale intensity by the physical translational delta (how far the surface actually moved)
    // If the user holds still, smoothing is 0. If they move, smoothing reaches a safe cap (0.3).
    // This prevents creases from instantly blurring out when the trigger is held over them.
    var dir = sym ? this._dragDirSym : this._dragDir;
    var dist = Math.sqrt(dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2]);
    var smoothIntensity = Math.min(0.3, dist * 2.0); // e.g., moving 15% of radius = 0.3 intensity
    
    if (smoothIntensity > 0.001) {
      this.smoothTangent(iVertsInRadius, smoothIntensity, picking);
    }

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
    var vProxy = this._slideVProxy;
    var nProxy = this._slideNProxy;

    if (!vProxy || !nProxy) return; // Safeguard if startSculpt didn't initialize yet

    var vrvStartCount = mesh.getVerticesRingVertStartCount();
    var vertRingVert = mesh.getVerticesRingVert();
    var rVerts = vertRingVert instanceof Array ? vertRingVert : null;

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

      // --- GEOMETRIC INTEGRATION (O(1) Proxy Face Snapping) ---
      // We project once against the proxy normal, then find the true closest Euclidean position
      // on the proxy surface, culling distant proxy faces via a fast bounding-sphere check.

      var pnX = nx, pnY = ny, pnZ = nz;
      if (idVert * 3 < nProxy.length) {
        pnX = nProxy[idVert * 3];
        pnY = nProxy[idVert * 3 + 1];
        pnZ = nProxy[idVert * 3 + 2];
      }

      var dot = dirx * pnX + diry * pnY + dirz * pnZ;
      var tx = dirx - dot * pnX;
      var ty = diry - dot * pnY;
      var tz = dirz - dot * pnZ;

      var rotX = 0, rotY = 0, rotZ = 0;
      if (rotQuat) {
        vTemp[0] = vx - cx; vTemp[1] = vy - cy; vTemp[2] = vz - cz;
        vec3.transformQuat(vTemp, vTemp, rotQuat);
        rotX = vTemp[0] - (vx - cx);
        rotY = vTemp[1] - (vy - cy);
        rotZ = vTemp[2] - (vz - cz);
      }

      vTarget[0] = vx + (tx + rotX) * fallOff;
      vTarget[1] = vy + (ty + rotY) * fallOff;
      vTarget[2] = vz + (tz + rotZ) * fallOff;

      var minDistSq = Infinity;
      var foundHit = false;

      // Only search within proxy faces
      var proxyFaces = mesh.getFacesFromVertices(iVerts); // The proxy neighborhood

      // PRE-COMPUTE PROXY BOUNDS (Once per brush, not per-vertex)
      // Since iVerts can be 500+ and proxyFaces can be 1000+, doing a nested V*F loop 
      // is 500,000 checks. We need a fast cull. Let's build a mini-AABB array for proxy faces.
      if (i === 0 && !this._proxyBounds) {
        this._proxyBounds = new Float32Array(proxyFaces.length * 6);
        for (var f = 0; f < proxyFaces.length; ++f) {
          var idFace = proxyFaces[f] * 4;
          var iv1 = fAr[idFace] * 3;
          var iv2 = fAr[idFace + 1] * 3;
          var iv3 = fAr[idFace + 2] * 3;
          var iv4 = fAr[idFace + 3];

          var isQuad = iv4 !== Utils.TRI_INDEX;

          var px1 = iv1 < vProxy.length ? vProxy[iv1] : vAr[iv1];
          var py1 = iv1 < vProxy.length ? vProxy[iv1 + 1] : vAr[iv1 + 1];
          var pz1 = iv1 < vProxy.length ? vProxy[iv1 + 2] : vAr[iv1 + 2];

          var px2 = iv2 < vProxy.length ? vProxy[iv2] : vAr[iv2];
          var py2 = iv2 < vProxy.length ? vProxy[iv2 + 1] : vAr[iv2 + 1];
          var pz2 = iv2 < vProxy.length ? vProxy[iv2 + 2] : vAr[iv2 + 2];

          var px3 = iv3 < vProxy.length ? vProxy[iv3] : vAr[iv3];
          var py3 = iv3 < vProxy.length ? vProxy[iv3 + 1] : vAr[iv3 + 1];
          var pz3 = iv3 < vProxy.length ? vProxy[iv3 + 2] : vAr[iv3 + 2];

          var minX = Math.min(px1, px2, px3);
          var maxX = Math.max(px1, px2, px3);
          var minY = Math.min(py1, py2, py3);
          var maxY = Math.max(py1, py2, py3);
          var minZ = Math.min(pz1, pz2, pz3);
          var maxZ = Math.max(pz1, pz2, pz3);

          if (isQuad) {
            iv4 *= 3;
            var px4 = iv4 < vProxy.length ? vProxy[iv4] : vAr[iv4];
            var py4 = iv4 < vProxy.length ? vProxy[iv4 + 1] : vAr[iv4 + 1];
            var pz4 = iv4 < vProxy.length ? vProxy[iv4 + 2] : vAr[iv4 + 2];
            minX = Math.min(minX, px4); maxX = Math.max(maxX, px4);
            minY = Math.min(minY, py4); maxY = Math.max(maxY, py4);
            minZ = Math.min(minZ, pz4); maxZ = Math.max(maxZ, pz4);
        }

          // Expand box slightly for floating point slop
          var slop = radius * 0.1;
          this._proxyBounds[f * 6] = minX - slop;
          this._proxyBounds[f * 6 + 1] = minY - slop;
          this._proxyBounds[f * 6 + 2] = minZ - slop;
          this._proxyBounds[f * 6 + 3] = maxX + slop;
          this._proxyBounds[f * 6 + 4] = maxY + slop;
          this._proxyBounds[f * 6 + 5] = maxZ + slop;
        }
      }

      for (var f = 0; f < proxyFaces.length; ++f) {
        // Fast AABB Cull
        var minX = this._proxyBounds[f * 6];
        var minY = this._proxyBounds[f * 6 + 1];
        var minZ = this._proxyBounds[f * 6 + 2];
        var maxX = this._proxyBounds[f * 6 + 3];
        var maxY = this._proxyBounds[f * 6 + 4];
        var maxZ = this._proxyBounds[f * 6 + 5];

        var expR = radius * 0.2; // 20% brush expansion for safety
        if (vTarget[0] < minX - expR || vTarget[0] > maxX + expR ||
          vTarget[1] < minY - expR || vTarget[1] > maxY + expR ||
          vTarget[2] < minZ - expR || vTarget[2] > maxZ + expR) {
          continue; // Cull!
        }

        var idFace = proxyFaces[f] * 4;

        var iv1 = fAr[idFace] * 3;
        var iv2 = fAr[idFace + 1] * 3;
        var iv3 = fAr[idFace + 2] * 3;
        var iv4 = fAr[idFace + 3];
        var isQuad = iv4 !== Utils.TRI_INDEX;

        v1[0] = iv1 < vProxy.length ? vProxy[iv1] : vAr[iv1];
        v1[1] = iv1 < vProxy.length ? vProxy[iv1 + 1] : vAr[iv1 + 1];
        v1[2] = iv1 < vProxy.length ? vProxy[iv1 + 2] : vAr[iv1 + 2];

        v2[0] = iv2 < vProxy.length ? vProxy[iv2] : vAr[iv2];
        v2[1] = iv2 < vProxy.length ? vProxy[iv2 + 1] : vAr[iv2 + 1];
        v2[2] = iv2 < vProxy.length ? vProxy[iv2 + 2] : vAr[iv2 + 2];

        v3[0] = iv3 < vProxy.length ? vProxy[iv3] : vAr[iv3];
        v3[1] = iv3 < vProxy.length ? vProxy[iv3 + 1] : vAr[iv3 + 1];
        v3[2] = iv3 < vProxy.length ? vProxy[iv3 + 2] : vAr[iv3 + 2];

        if (isQuad) {
          iv4 *= 3;
          v4[0] = iv4 < vProxy.length ? vProxy[iv4] : vAr[iv4];
          v4[1] = iv4 < vProxy.length ? vProxy[iv4 + 1] : vAr[iv4 + 1];
          v4[2] = iv4 < vProxy.length ? vProxy[iv4 + 2] : vAr[iv4 + 2];
        }

        // Exact distance logic
        var distSq = Geometry.distance2PointTriangle(vTarget, v1, v2, v3, closest);
        if (distSq < minDistSq) {
          minDistSq = distSq;
          bestClosest[0] = closest[0];
          bestClosest[1] = closest[1];
          bestClosest[2] = closest[2];
          foundHit = true;
        }

        if (isQuad) {
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

      // CRITICAL FALLBACK: If the AABB cull was too aggressive and rejected ALL faces,
      // foundHit will be false, and bestClosest will be [0,0,0] by default.
      // We MUST fall back to vTarget to prevent snapping to the origin!
      var currX = foundHit ? bestClosest[0] : vTarget[0];
      var currY = foundHit ? bestClosest[1] : vTarget[1];
      var currZ = foundHit ? bestClosest[2] : vTarget[2];
    }

    // Clean up proxy bound cache at the end of the step so it rebuilds next frame
    this._proxyBounds = null;

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
