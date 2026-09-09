import Tablet from '../../misc/Tablet.js';
import Utils from '../../misc/Utils.js';
import SculptBase from './SculptBase.js';

class Inflate extends SculptBase {

  constructor(main) {
    super(main);

    this._radius = 50;
    this._intensity = 0.3;
    this._negative = false;
    this._culling = false;
    this._idAlpha = 0;
    this._lockPosition = false;
    // INFLATE ALONG A SMOOTHED NORMAL FIELD, not each vertex's own normal.
    //
    // Pushing every vertex down its own normal is correct for a dense mesh and wrong for a coarse
    // one: on a low-resolution tube adjacent normals diverge by tens of degrees, so neighbours
    // travel apart, the quads between them fold, and what should be a swelling becomes a crease
    // with geometry trapped behind it. matt: "if i inflate these, minor differences in normals
    // rapidly expand to become creases and trapped geometry."
    //
    // Averaging the direction over the one-ring removes exactly the component that makes
    // neighbours diverge, and leaves the overall outward push intact. On a dense mesh the
    // averaged normal and the raw one agree, so it costs nothing there.
    this._smoothNormals = true;
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

    picking.updateAlpha(this._lockPosition);
    picking.setIdAlpha(this._idAlpha);
    this.inflate(iVertsInRadius, picking.getIntersectionPoint(), picking.getLocalRadius2(), intensity, picking);

    var mesh = this.getMesh();
    mesh.updateGeometry(mesh.getFacesFromVertices(iVertsInRadius), iVertsInRadius);
  }

  /** Inflate a group of vertices */
  inflate(iVerts, center, radiusSquared, intensity, picking) {
    var mesh = this.getMesh();
    var vAr = mesh.getVertices();
    var mAr = mesh.getMaterials();
    var vProxy = mesh.getVerticesProxy();
    var nAr = mesh.getNormals();
    // The averaged field, computed once for the whole brush rather than per vertex. laplacianSmooth
    // takes any per-vertex field, so the normals go through the same ring walk the positions do.
    var sNor = null;
    if (this._smoothNormals) {
      sNor = new Float32Array(Utils.getMemory(iVerts.length * 4 * 3), 0, iVerts.length * 3);
      this.laplacianSmooth(iVerts, sNor, nAr);
    }
    var radius = Math.sqrt(radiusSquared);
    var deformIntensity = intensity * radius * 0.1;
    if (this._negative)
      deformIntensity = -deformIntensity;
    var cx = center[0];
    var cy = center[1];
    var cz = center[2];
    for (var i = 0, l = iVerts.length; i < l; ++i) {
      var ind = iVerts[i] * 3;
      var dx = vProxy[ind] - cx;
      var dy = vProxy[ind + 1] - cy;
      var dz = vProxy[ind + 2] - cz;
      var dist = Math.sqrt(dx * dx + dy * dy + dz * dz) / radius;
      if (dist >= 1.0)
        continue;
      var fallOff = dist * dist;
      fallOff = 3.0 * fallOff * fallOff - 4.0 * fallOff * dist + 1.0;
      fallOff = deformIntensity * fallOff;
      var vx = vAr[ind];
      var vy = vAr[ind + 1];
      var vz = vAr[ind + 2];
      var nx = nAr[ind];
      var ny = nAr[ind + 1];
      var nz = nAr[ind + 2];
      if (sNor) {
        // BLENDED, NOT REPLACED. A fully averaged normal on a sharp edge points into the wedge
        // between the two faces and would flatten the feature it is inflating; half of each keeps
        // the surface's own direction while removing the divergence that folds the quads.
        var i3n = i * 3;
        nx = nx * 0.5 + sNor[i3n] * 0.5;
        ny = ny * 0.5 + sNor[i3n + 1] * 0.5;
        nz = nz * 0.5 + sNor[i3n + 2] * 0.5;
        // A cancelled pair leaves nothing to push along — fall back rather than divide by zero.
        if (nx * nx + ny * ny + nz * nz < 1e-12) {
          nx = nAr[ind]; ny = nAr[ind + 1]; nz = nAr[ind + 2];
        }
      }
      fallOff /= Math.sqrt(nx * nx + ny * ny + nz * nz);
      fallOff *= mAr[ind + 2] * picking.getAlpha(vx, vy, vz);
      vAr[ind] = vx + nx * fallOff;
      vAr[ind + 1] = vy + ny * fallOff;
      vAr[ind + 2] = vz + nz * fallOff;
    }
  }
}

export default Inflate;
