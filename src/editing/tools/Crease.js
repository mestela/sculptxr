import Tablet from '../../misc/Tablet.js';
import SculptBase from './SculptBase.js';

class Crease extends SculptBase {

  constructor(main) {
    super(main);

    this._radius = 25;
    // 0.4 default: crease is a pinch tool, so high intensity drags groove triangles toward
    // zero area and folds the mesh (no dyntopo to relieve the bunching). ~0.4 is the sweet
    // spot in VR; the slider still goes higher for anyone who wants a harder crease.
    this._intensity = 0.4;
    this._negative = true;
    this._culling = false;
    this._idAlpha = 0;
    this._lockPosition = false;
  }

  stroke(picking) {
    var iVertsInRadius = picking.getPickedVertices();
    var intensity = this._intensity * Tablet.getPressureIntensity();

    this.updateProxy(iVertsInRadius);
    // undo-redo
    this._main.getStateManager().pushVertices(iVertsInRadius);
    iVertsInRadius = this.dynamicTopology(picking);

    if (this._culling)
      iVertsInRadius = this.getFrontVertices(iVertsInRadius, picking.getEyeDirection());

    var aCenter = this.areaCenter(iVertsInRadius);

    picking.updateAlpha(this._lockPosition);
    picking.setIdAlpha(this._idAlpha);
    this.crease(iVertsInRadius, picking.getPickedNormal(), picking.getIntersectionPoint(), aCenter, picking.getLocalRadius2(), intensity, picking);

    var mesh = this.getMesh();
    mesh.updateGeometry(mesh.getFacesFromVertices(iVertsInRadius), iVertsInRadius);
  }

  /** Pinch+brush-like sculpt */
  crease(iVertsInRadius, aNormal, center, aCenter, radiusSquared, intensity, picking) {
    if (!aNormal || !center || radiusSquared <= 0.0) return;
    if (!Number.isFinite(aNormal[0]) || !Number.isFinite(aNormal[1]) || !Number.isFinite(aNormal[2])) return;

    var mesh = this.getMesh();
    var vAr = mesh.getVertices();
    var mAr = mesh.getMaterials();
    var vProxy = mesh.getVerticesProxy();
    var radius = Math.sqrt(radiusSquared);
    var cx = center[0];
    var cy = center[1];
    var cz = center[2];

    // FIX v0.8.160: Crease Groove Tracking
    // Use the actual center of mass (aCenter) of the local area to guide the pinch direction.
    // Deep grooves have bunched vertices, causing aCenter to naturally sit inside the groove.
    var gx = aCenter ? aCenter[0] : cx;
    var gy = aCenter ? aCenter[1] : cy;
    var gz = aCenter ? aCenter[2] : cz;
    var anx = aNormal[0];
    var any = aNormal[1];
    var anz = aNormal[2];
    var deformIntensity = intensity * 0.07;
    var brushFactor = deformIntensity * radius;

    // FIX v0.8.159: Centerline Symmetry Over-Accumulation
    // Symmetrical brushes overlap at the center, doubling the force application (200%).
    // We compute the distance to the symmetry plane and smoothly ramp down intensity to 50%
    // so that the sum of both brushes equals exactly 100% force.
    var useSymmetry = this._main.getSculptManager().getSymmetry();
    var overlapFactor = 1.0;
    if (useSymmetry) {
      var ptPlane = mesh.getSymmetryOrigin();
      var nPlane = mesh.getSymmetryNormal();
      var distToPlane = Math.abs((cx - ptPlane[0]) * nPlane[0] + (cy - ptPlane[1]) * nPlane[1] + (cz - ptPlane[2]) * nPlane[2]);
      if (distToPlane < radius) {
        overlapFactor = 0.5 + 0.5 * (distToPlane / radius);
      }
    }

    deformIntensity *= overlapFactor;
    brushFactor *= overlapFactor;

    if (this._negative)
      brushFactor = -brushFactor;
    for (var i = 0, l = iVertsInRadius.length; i < l; ++i) {
      var ind = iVertsInRadius[i] * 3;
      var dx = cx - vProxy[ind];
      var dy = cy - vProxy[ind + 1];
      var dz = cz - vProxy[ind + 2];
      var dist = Math.sqrt(dx * dx + dy * dy + dz * dz) / radius;
      if (dist >= 1.0)
        continue;
      var vx = vAr[ind];
      var vy = vAr[ind + 1];
      var vz = vAr[ind + 2];
      var fallOff = dist * dist;
      fallOff = 3.0 * fallOff * fallOff - 4.0 * fallOff * dist + 1.0;
      fallOff *= mAr[ind + 2] * picking.getAlpha(vx, vy, vz);
      var brushModifier = Math.pow(fallOff, 5) * brushFactor;
      fallOff *= deformIntensity;

      // FIX v0.8.158: Infinite Accumulation Spike
      // dx, dy, dz use vProxy to keep the mathematical profile sharp.
      // But adding dx * fallOff infinitely creates a massive spike over time.
      // Instead, we boundedly pull the current alive vertex `vx` towards the `gx` groove center.
      // The pinch inherently stops when vx = gx.
      var pinchDx = gx - vx;
      var pinchDy = gy - vy;
      var pinchDz = gz - vz;

      var nx = vx + pinchDx * fallOff * 2.0 + anx * brushModifier;
      var ny = vy + pinchDy * fallOff * 2.0 + any * brushModifier;
      var nz = vz + pinchDz * fallOff * 2.0 + anz * brushModifier;

      if (Number.isFinite(nx) && Number.isFinite(ny) && Number.isFinite(nz)) {
        vAr[ind] = nx;
        vAr[ind + 1] = ny;
        vAr[ind + 2] = nz;
      }
    }
  }
}

export default Crease;
