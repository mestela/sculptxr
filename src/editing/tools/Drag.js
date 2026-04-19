import { vec3, mat4 } from 'gl-matrix';
import Geometry from '../../math3d/Geometry.js';
import SculptBase from './SculptBase.js';

class Drag extends SculptBase {

  constructor(main) {
    super(main);

    this._radius = 50; // Normalize size to match Move brush
    this._dragDir = [0.0, 0.0, 0.0];
    this._dragDirSym = [0.0, 0.0, 0.0];
    this._idAlpha = 0;
  }

  // VR Support: Drag needs to calculate delta from controller movement
  updateXR(picking, isPressed, origin, dir, options) {
    var main = this._main;
    if (!main._vrControllerPos) return;

    // Guard: If we are dragging with one hand, ignore the other hand
    if (main._vrLockedHand && options && options.handedness !== main._vrLockedHand) {
      return;
    }

    if (!isPressed) {
      // HOVER
      if (!this._lastVRPos) this._lastVRPos = vec3.create();
      vec3.copy(this._lastVRPos, main._vrControllerPos);
      var pickingSym = main.getSculptManager().getSymmetry() ? main.getPickingSymmetry() : null;
      super.makeStrokeXR(picking, pickingSym, false);
      this.updateRender();
      return;
    }

    if (!this._lastVRPos) {
      this._lastVRPos = vec3.clone(main._vrControllerPos);

      // CRITICAL FIX: Drag overrides standard SculptManager/SculptBase initialization for its stroke logic.
      // We MUST ensure the initial state is pushed, else Undo/Redo will throw `getCurrentState` TypeError.
      this.pushState(); 
      return;
    }

    var mesh = this.getMesh();
    if (!mesh) return;

    // Use getMatrix() just like Move.js
    var mInv = mat4.create();
    mat4.invert(mInv, mesh.getMatrix());

    var vPrevLocal = vec3.clone(this._lastVRPos);
    vec3.transformMat4(vPrevLocal, vPrevLocal, mInv);

    var vCurrLocal = vec3.clone(main._vrControllerPos);
    vec3.transformMat4(vCurrLocal, vCurrLocal, mInv);

    // Compute frame-to-frame delta in local space
    vec3.sub(this._dragDir, vCurrLocal, vPrevLocal);

    // Safety guard for huge deltas
    var deltaLength = vec3.length(this._dragDir);
    if (deltaLength > 0.5) {
      console.log(`VR Drag: Ignoring huge delta: ${deltaLength.toFixed(4)}`);
      vec3.copy(this._lastVRPos, main._vrControllerPos);
      return;
    }

    // repick vertices at new center (Scene.js updated intersection)
    picking._mesh = mesh;
    // CRITICAL FIX: Do NOT call picking.updateLocalAndWorldRadius2(). It recalculates radius based on screen-space camera FOV,
    // which completely destroys VR physical radius scaling, causing the cursor to shrink to a dot. VR radius is set in Scene.js.
    picking.pickVerticesInSphere(picking.getLocalRadius2());
    picking.computePickedNormal();

    // Apply primary stroke
    this.stroke(picking, false);

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
      this.stroke(pickingSym, true);
    }

    // Update history for frame-to-frame delta
    vec3.copy(this._lastVRPos, main._vrControllerPos);

    if (typeof mesh.computeOctree === 'function') {
      mesh.computeOctree();
    }

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

    var count = Math.floor(dist / minSpacing);
    if (count < 1) count = 1;
    var step = 1.0 / count;
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
      if (typeof mesh.computeOctree === 'function') {
        mesh.computeOctree();
      }
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
    this.drag(iVertsInRadius, picking.getIntersectionPoint(), picking.getLocalRadius2(), sym, picking);

    var mesh = this.getMesh();
    mesh.updateGeometry(mesh.getFacesFromVertices(iVertsInRadius), iVertsInRadius);
  }

  /** Drag deformation */
  drag(iVerts, center, radiusSquared, sym, picking) {
    var mesh = this.getMesh();
    var vAr = mesh.getVertices();
    var mAr = mesh.getMaterials();
    var radius = Math.sqrt(radiusSquared);
    var cx = center[0];
    var cy = center[1];
    var cz = center[2];
    var dir = sym ? this._dragDirSym : this._dragDir;
    var dirx = dir[0];
    var diry = dir[1];
    var dirz = dir[2];
    for (var i = 0, l = iVerts.length; i < l; ++i) {
      var ind = iVerts[i] * 3;
      var vx = vAr[ind];
      var vy = vAr[ind + 1];
      var vz = vAr[ind + 2];
      var dx = vx - cx;
      var dy = vy - cy;
      var dz = vz - cz;
      var dist = Math.sqrt(dx * dx + dy * dy + dz * dz) / radius;
      if (dist > 1.0) continue;
      var fallOff = dist * dist;
      fallOff = 3.0 * fallOff * fallOff - 4.0 * fallOff * dist + 1.0;

      // Prevent "Bum Crease" crossover tearing on Symmetry Plane
      var useSymmetry = this._main.getSculptManager().getSymmetry();
      if (useSymmetry) {
        var ptPlane = mesh.getSymmetryOrigin();
        var nPlane = mesh.getSymmetryNormal();

        // Linear Blend factor near the symmetry plane
        var vDist = (vx - ptPlane[0]) * nPlane[0] + (vy - ptPlane[1]) * nPlane[1] + (vz - ptPlane[2]) * nPlane[2];
        var cDist = (cx - ptPlane[0]) * nPlane[0] + (cy - ptPlane[1]) * nPlane[1] + (cz - ptPlane[2]) * nPlane[2];
        var brushSide = cDist >= 0 ? 1.0 : -1.0;

        var symFactor = 0.5 + 0.5 * (vDist * brushSide / radius);
        symFactor = Math.min(Math.max(symFactor, 0.0), 1.0); // Clamp 0..1

        fallOff *= symFactor;
      }

      fallOff *= mAr[ind + 2] * picking.getAlpha(vx, vy, vz);
      vAr[ind] = vx + dirx * fallOff;
      vAr[ind + 1] = vy + diry * fallOff;
      vAr[ind + 2] = vz + dirz * fallOff;
    }
  }

  /** Set a few infos that will be needed for the drag function afterwards */
  updateDragDir(picking, mouseX, mouseY, useSymmetry) {
    var mesh = this.getMesh();
    var vNear = picking.unproject(mouseX, mouseY, 0.0);
    var vFar = picking.unproject(mouseX, mouseY, 0.1);
    var matInverse = mat4.create();
    mat4.invert(matInverse, mesh.getThreeMesh().matrixWorld.elements);
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
    // picking.updateLocalAndWorldRadius2();
    var eyeDir = picking.getEyeDirection();
    vec3.sub(eyeDir, vFar, vNear);
    vec3.normalize(eyeDir, eyeDir);
  }
}

export default Drag;
