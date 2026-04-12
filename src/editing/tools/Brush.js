import { vec3 } from 'gl-matrix';
import Tablet from '../../misc/Tablet.js';
import SculptBase from './SculptBase.js';
import Flatten from './Flatten.js';

class Brush extends SculptBase {

  constructor(main) {
    super(main);

    this._radius = 25;
    this._intensity = 0.5;
    this._negative = false;
    this._clay = false;
    this._culling = false;
    this._accumulate = true; // if we ignore the proxy
    this._idAlpha = 0;
    this._lockPosition = false;
  }

  stroke(picking) {
    var iVertsInRadius = picking.getPickedVertices();
    var intensity = this._intensity * Tablet.getPressureIntensity();

    // Removed [Brush] stroke logging


    if (!this._accumulate && !this._lockPosition)
      this.updateProxy(iVertsInRadius);
    // undo-redo
    this._main.getStateManager().pushVertices(iVertsInRadius);
    if (!this._lockPosition)
      iVertsInRadius = this.dynamicTopology(picking);

    var iVertsFront = (picking._pickedVerticesFront && picking._pickedVerticesFront.length > 0) ? picking._pickedVerticesFront : this.getFrontVertices(iVertsInRadius, picking.getEyeDirection());
    if (this._culling)
      iVertsInRadius = iVertsFront;

    var r2 = picking.getLocalRadius2();
    picking.updateAlpha(this._lockPosition);
    picking.setIdAlpha(this._idAlpha);

    if (!this._clay) {
      this.brush(iVertsInRadius, picking.getPickedNormal(), picking.getIntersectionPoint(), r2, intensity, picking);
    } else {
      var aNormal = picking._aNormal || this.areaNormal(iVertsFront);
      if (!aNormal)
        return;
      var aCenter = this._lockPosition ? picking.getIntersectionPoint() : this.areaCenter(iVertsFront);
      var off = Math.sqrt(r2) * 0.1;
      vec3.scaleAndAdd(aCenter, aCenter, aNormal, this._negative ? -off : off);
      Flatten.prototype.flatten.call(this, iVertsInRadius, aNormal, aCenter, picking.getIntersectionPoint(), r2, intensity, picking);
    }

    var mesh = this.getMesh();
    mesh.updateGeometry(mesh.getFacesFromVertices(iVertsInRadius), iVertsInRadius);
  }

  brush(iVertsInRadius, aNormal, center, radiusSquared, intensity, picking) {
    var mesh = this.getMesh();
    var vAr = mesh.getVertices();
    var mAr = mesh.getMaterials();
    var vProxy = this._accumulate || this._lockPosition ? vAr : mesh.getVerticesProxy();
    var radius = Math.sqrt(radiusSquared);
    if (radius < 1e-6) return; // Prevent division by zero / NaNs

    var deformIntensityBrush = intensity * radius * 0.5;
    if (this._negative)
      deformIntensityBrush = -deformIntensityBrush;
    var cx = center[0];
    var cy = center[1];
    var cz = center[2];
    var anx = aNormal[0];
    var any = aNormal[1];
    var anz = aNormal[2];
    // Safety: If normal is NaN, abort to prevent mesh corruption
    if (isNaN(anx) || isNaN(any) || isNaN(anz)) return;

    for (var i = 0, l = iVertsInRadius.length; i < l; ++i) {
      var ind = iVertsInRadius[i] * 3;
      var dx = vProxy[ind] - cx;
      var dy = vProxy[ind + 1] - cy;
      var dz = vProxy[ind + 2] - cz;
      var dist = Math.sqrt(dx * dx + dy * dy + dz * dz) / radius;
      if (dist >= 1.0)
        continue;
      var vx = vAr[ind];
      var vy = vAr[ind + 1];
      var vz = vAr[ind + 2];
      var fallOff = dist * dist;
      fallOff = 3.0 * fallOff * fallOff - 4.0 * fallOff * dist + 1.0;
      fallOff *= mAr[ind + 2] * deformIntensityBrush * picking.getAlpha(vx, vy, vz);
      vAr[ind] = vx + anx * fallOff;
      vAr[ind + 1] = vy + any * fallOff;
      vAr[ind + 2] = vz + anz * fallOff;

      if (i === 0 && window.screenLog) {
        // console.log(`Brush: Modifying ID ${iVertsInRadius[i]}. Diff: ${anx * fallOff}, ${any * fallOff}, ${anz * fallOff}`);
        // window.screenLog(`Brush: dV ${anx * fallOff} FO:${fallOff}`, "magenta");

      }
    }
  }
}

export default Brush;
