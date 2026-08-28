import { vec2, vec3, quat, mat4 } from 'gl-matrix';
import Geometry from '../../math3d/Geometry.js';
import SculptBase from './SculptBase.js';

class Twist extends SculptBase {

  constructor(main) {
    super(main);

    this._culling = false;
    this._twistData = {
      normal: [0.0, 0.0, 0.0], // normal of rotation plane
      center: [0.0, 0.0] // 2D center of rotation 
    };
    this._twistDataSym = {
      normal: [0.0, 0.0, 0.0], // normal of rotation plane
      center: [0.0, 0.0] // 2D center of rotation 
    };
    this._idAlpha = 0;
  }

  startSculpt() {
    var main = this._main;
    var mouseX = main._mouseX;
    var mouseY = main._mouseY;
    var picking = main.getPicking();
    this.initTwistData(picking, mouseX, mouseY, this._twistData);
    if (main.getSculptManager().getSymmetry()) {
      var pickingSym = main.getPickingSymmetry();
      pickingSym.intersectionMouseMesh();
      pickingSym.setLocalRadius2(picking.getLocalRadius2());
      if (pickingSym.getMesh())
        this.initTwistData(pickingSym, mouseX, mouseY, this._twistDataSym);
    }
  }

  /** Set a few infos that will be needed for the twist function afterwards */
  initTwistData(picking, mouseX, mouseY, twistData) {
    picking.pickVerticesInSphere(picking.getLocalRadius2());
    vec3.negate(twistData.normal, picking.getEyeDirection());
    vec2.set(twistData.center, mouseX, mouseY);
  }

  /** Make a brush twist stroke */
  sculptStroke() {
    var main = this._main;
    var mx = main._mouseX;
    var my = main._mouseY;
    var lx = main._lastMouseX;
    var ly = main._lastMouseY;
    var picking = main.getPicking();
    var rLocal2 = picking.getLocalRadius2();
    picking.pickVerticesInSphere(rLocal2);
    this.stroke(picking, mx, my, lx, ly, this._twistData);

    if (main.getSculptManager().getSymmetry()) {
      var pickingSym = main.getPickingSymmetry();
      if (pickingSym.getMesh()) {
        pickingSym.pickVerticesInSphere(rLocal2);
        this.stroke(pickingSym, lx, ly, mx, my, this._twistDataSym);
      }
    }
    this.updateRender();
    main.setCanvasCursor('default');
  }

  /** On stroke */
  stroke(picking, mx, my, lx, ly, twistData) {
    if (typeof mx === 'boolean') {
      // VR Mode: stroke(picking, isSym)
      this.strokeXR(picking, mx);
      return;
    }

    // Mouse Mode
    // var iVertsInRadius = picking.getPickedVertices(); // Used below
    var iVertsInRadius = picking.getPickedVertices();

    // undo-redo
    this._main.getStateManager().pushVertices(iVertsInRadius);
    iVertsInRadius = this.dynamicTopology(picking);

    if (this._culling)
      iVertsInRadius = this.getFrontVertices(iVertsInRadius, picking.getEyeDirection());

    picking.updateAlpha(false);
    picking.setIdAlpha(this._idAlpha);

    // Calculate Angle for Mouse
    var mouseCenter = twistData.center;
    var vecMouse = [mx - mouseCenter[0], my - mouseCenter[1]];
    if (vec2.len(vecMouse) < 10) return; // Min drag distance
    vec2.normalize(vecMouse, vecMouse);

    var vecOldMouse = [lx - mouseCenter[0], ly - mouseCenter[1]];
    vec2.normalize(vecOldMouse, vecOldMouse);
    var angle = Geometry.signedAngle2d(vecMouse, vecOldMouse);

    // Twist
    this._twistMesh(iVertsInRadius, picking.getIntersectionPoint(), picking.getLocalRadius2(), twistData.normal, angle, picking);

    var mesh = this.getMesh();
    mesh.updateGeometry(mesh.getFacesFromVertices(iVertsInRadius), iVertsInRadius);
  }

  // Override SculptBase.updateXR to get extra arguments (origin, dir)
  updateXR(picking, isPressed, origin, dir) {
    if (!isPressed) return;
    this.strokeXR(picking, false, origin, dir);

    if (this._main.getSculptManager().getSymmetry()) {
      var pickingSym = this._main.getPickingSymmetry();
      // Only stroke if pickingSym has a mesh? 
      // Actually strokeXR will try to pick. 
      // But we need to know if we should even try.
      // SculptBase checks `pickingSym` existence.
      if (pickingSym) {
        // We need to sync local radius?
        pickingSym.setLocalRadius2(picking.getLocalRadius2());
        // Hand the symmetry pass the MAIN surface contact point; strokeXR mirrors it
        // across the symmetry plane to get the symmetric centre. (pickingSym has no
        // pick of its own, so its intersection point would otherwise be stale.)
        pickingSym.setIntersectionPoint(picking.getIntersectionPoint());
        this.strokeXR(pickingSym, true, origin, dir);
      }
    }
  }

  /** VR Stroke Logic */
  strokeXR(picking, isSym, origin, dir) {
    var main = this._main;
    // Fallback if origin/dir not provided (shouldn't happen with updated Scene/Manager)
    if (!origin || !dir) {
      if (main._vrControllerPos) origin = main._vrControllerPos;
      else return;

      // Fallback Dir?
      dir = [0, 0, -1]; // Dummy
    }

    var mesh = this.getMesh();
    var invMat = mat4.create();
    mat4.invert(invMat, mesh.getModelSpaceMatrix()); // parent-aware (== getMatrix unparented)

    // 1. Center of Rotation = the SURFACE contact point (local space), as found by the
    // pick. Using the raw controller position instead put the center ~off the surface,
    // so the radius search selected zero vertices and Twist did nothing.
    var center = vec3.clone(picking.getIntersectionPoint());

    // 2. Axis of Rotation (Controller Dir in Local Space)
    // Transform direction (ignore translation)
    var axis = vec3.create();
    var zero = vec3.create();
    var localDir = vec3.create();
    vec3.transformMat4(zero, [0, 0, 0], invMat);
    vec3.transformMat4(localDir, dir, invMat);
    vec3.sub(axis, localDir, zero);
    vec3.normalize(axis, axis);

    // Symmetry adjustment for Axis and Center
    if (isSym) {
      // Mirror Center
      var ptPlane = mesh.getSymmetryOrigin();
      var nPlane = mesh.getSymmetryNormal();
      Geometry.mirrorPoint(center, ptPlane, nPlane);

      // Mirror Axis?
      var axisSym = vec3.clone(axis);
      Geometry.mirrorPoint(axisSym, [0, 0, 0], nPlane); // Mirror vector
      axis = axisSym;
    }

    // FORCE PICKING: Use the calculated Drill Center
    // This ensures symmetry works AND allows "Air Sculpting" (Drill behavior)
    picking.setIntersectionPoint(center); // Local Space
    picking._mesh = mesh; // Ensure picking knows the mesh
    // picking.updateLocalAndWorldRadius2(); // If we changed world radius?
    // We assume picking radius is already set by caller (updateXR)
    picking.pickVerticesInSphere(picking.getLocalRadius2());
    picking.computePickedNormal(); // Optional but good for consistency

    var iVertsInRadius = picking.getPickedVertices();

    // undo-redo
    this._main.getStateManager().pushVertices(iVertsInRadius);
    iVertsInRadius = this.dynamicTopology(picking);

    // Culling?
    if (this._culling) {
      // Use negative normal as eye dir proxy for VR
      var n = picking.getPickedNormal(); // This is now valid because we computed picked normal
      var eyeDir = vec3.create();
      vec3.negate(eyeDir, n);
      iVertsInRadius = this.getFrontVertices(iVertsInRadius, eyeDir);
    }

    picking.updateAlpha(false);
    picking.setIdAlpha(this._idAlpha);

    // 3. Angle (Drill Mode)
    var angle = this._intensity * 0.15;
    if (this._negative) angle = -angle;
    if (isSym) angle = -angle; // Reverse for Symmetry

    // Twist
    this._twistMesh(iVertsInRadius, center, picking.getLocalRadius2(), axis, angle, picking);

    mesh.updateGeometry(mesh.getFacesFromVertices(iVertsInRadius), iVertsInRadius);
    this.updateRender(); // Ensure render update
  }

  _twistMesh(iVerts, center, radiusSquared, nPlane, angle, picking) {
    var mesh = this.getMesh();
    var vAr = mesh.getVertices();
    var mAr = mesh.getMaterials();
    var invRadius = 1.0 / Math.sqrt(radiusSquared);

    var cx = center[0];
    var cy = center[1];
    var cz = center[2];

    var rot = [0.0, 0.0, 0.0, 0.0];
    var coord = [0.0, 0.0, 0.0];

    for (var i = 0, l = iVerts.length; i < l; ++i) {
      var ind = iVerts[i] * 3;
      var vx = vAr[ind];
      var vy = vAr[ind + 1];
      var vz = vAr[ind + 2];

      var dx = vx - cx;
      var dy = vy - cy;
      var dz = vz - cz;

      var dist = Math.sqrt(dx * dx + dy * dy + dz * dz) * invRadius;
      if (dist >= 1.0) continue;

      var fallOff = dist * dist;
      fallOff = 3.0 * fallOff * fallOff - 4.0 * fallOff * dist + 1.0;
      fallOff *= angle * mAr[ind + 2] * picking.getAlpha(vx, vy, vz);

      quat.setAxisAngle(rot, nPlane, fallOff);

      vec3.set(coord, vx, vy, vz);
      vec3.sub(coord, coord, center);
      vec3.transformQuat(coord, coord, rot);
      vec3.add(coord, coord, center);

      vAr[ind] = coord[0];
      vAr[ind + 1] = coord[1];
      vAr[ind + 2] = coord[2];
    }
  }

  /** Twist the vertices around the mouse point intersection */
  twist(iVerts, center, radiusSquared, mouseX, mouseY, lastMouseX, lastMouseY, twistData, picking) {
    // Deprecated: Logic moved to stroke/strokeXR and _twistMesh
    // Keeping for safety if called externally?
    // But local refactoring replaced it.
  }
}

export default Twist;
