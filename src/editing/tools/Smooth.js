import MotionPathEdit from '../MotionPathEdit.js';
import MotionTrail from '../MotionTrail.js';
import Utils from '../../misc/Utils.js';
import Tablet from '../../misc/Tablet.js';
import SculptBase from './SculptBase.js';

class Smooth extends SculptBase {

  constructor(main) {
    super(main);

    this._radius = 50;
    this._intensity = 0.75;
    this._culling = false;
    this._tangent = false;
    this._idAlpha = 0;
    this._lockPosition = false;
    this._negative = false; // Support Sharpen
  }

  // SMOOTHING A MOTION PATH. On a mesh "smooth" needs a whole tool to disambiguate; on a strand
  // it has exactly one meaning — a 1D Laplacian along the curve — and that IS noise removal, so
  // this is the tool for taking the jitter out of a hand-recorded take.
  //
  // Hooked at start() for the same reason Move is: SculptBase.start aborts when the click
  // misses geometry, and a motion path arcs through empty space.
  // A MOTION PATH IS NOT A MESH, so the shared preUpdate — which requests a frame when the
  // thing under the cursor changes — never asks for one while you are over a curve. Desktop
  // renders on demand, and MotionTrail.update runs inside render(), so the preselect highlight
  // was only recoloured on frames drawn for some other reason: the lit dot sat wherever the
  // cursor had been when the last frame went out.
  //
  // Hooked here rather than in SculptBase because SculptBase cannot import MotionPathEdit
  // without closing an import cycle (MotionTrail already reaches back through redrawHook for
  // the same reason). These two tools are the only ones that can edit a path anyway.
  preUpdate(canBeContinuous) {
    super.preUpdate(canBeContinuous);
    MotionPathEdit.hoverTick(this._main);
  }

  start(ctrl) {
    const main = this._main;
    if (MotionPathEdit.begin(main, main._mouseX, main._mouseY, this.getScreenRadius())) return true;
    return super.start(ctrl);
  }

  sculptStroke() {
    const main = this._main;
    if (MotionPathEdit.active(main)) {
      // Iterative, unlike a Move: holding the brush still should keep relaxing, so each frame
      // reads the current curve rather than the baseline. The baseline stays untouched, because
      // push-back has to measure the whole gesture, not the last frame of it.
      if (MotionPathEdit.smoothStep(main, this._intensity)) {
        MotionTrail.redrawEdit(main);
        main.render();
      }
      return;
    }
    super.sculptStroke();
  }

  end() {
    super.end();
    if (MotionPathEdit.active(this._main)) MotionPathEdit.endStroke(this._main);
  }

  updateXR(picking, isPressed, origin, dir, options) {
    if (MotionPathEdit.strokeXR(this._main, picking, isPressed, this, 'smooth', this._intensity, options)) return;
    return super.updateXR(picking, isPressed, origin, dir, options);
  }

  stroke(picking) {
    var iVertsInRadius = picking.getPickedVertices();
    // Smooth moves a fixed fraction toward the neighbour average — no radius term — so it feels
    // disproportionately strong when zoomed in on fine detail. Tune live with _smoothScale.
    var intensity = this._intensity * Tablet.getPressureIntensity() * (window._smoothScale ?? 1.0);

    // undo-redo
    this._main.getStateManager().pushVertices(iVertsInRadius);

    if (this._culling)
      iVertsInRadius = this.getFrontVertices(iVertsInRadius, picking.getEyeDirection());

    picking.updateAlpha(this._lockPosition);
    picking.setIdAlpha(this._idAlpha);
    if (this._tangent) this.smoothTangent(iVertsInRadius, intensity, picking);
    else this.smooth(iVertsInRadius, intensity, picking);

    var mesh = this.getMesh();
    mesh.updateGeometry(mesh.getFacesFromVertices(iVertsInRadius), iVertsInRadius);
  }

  /** Smooth a group of vertices. New position is given by simple averaging */
  smooth(iVerts, intensity, picking) {
    var mesh = this.getMesh();
    var vAr = mesh.getVertices();
    var mAr = mesh.getMaterials();
    var nbVerts = iVerts.length;

    var smoothVerts = new Float32Array(Utils.getMemory(nbVerts * 4 * 3), 0, nbVerts * 3);
    this.laplacianSmooth(iVerts, smoothVerts);

    for (var i = 0; i < nbVerts; ++i) {
      var ind = iVerts[i] * 3;
      var vx = vAr[ind];
      var vy = vAr[ind + 1];
      var vz = vAr[ind + 2];
      var i3 = i * 3;
      var mIntensity = intensity * mAr[ind + 2];
      if (picking)
        mIntensity *= picking.getAlpha(vx, vy, vz);

      // if (this._negative) mIntensity = -mIntensity * 0.3; // Sharpen (Disabled for now)

      var intComp = 1.0 - mIntensity;
      vAr[ind] = vx * intComp + smoothVerts[i3] * mIntensity;
      vAr[ind + 1] = vy * intComp + smoothVerts[i3 + 1] * mIntensity;
      vAr[ind + 2] = vz * intComp + smoothVerts[i3 + 2] * mIntensity;
    }
  }

  /** Smooth a group of vertices. Reproject the position on each vertex normals plane */
  smoothTangent(iVerts, intensity, picking) {
    var mesh = this.getMesh();
    var vAr = mesh.getVertices();
    var mAr = mesh.getMaterials();
    var nAr = mesh.getNormals();
    var nbVerts = iVerts.length;

    var smoothVerts = new Float32Array(Utils.getMemory(nbVerts * 4 * 3), 0, nbVerts * 3);
    this.laplacianSmooth(iVerts, smoothVerts);

    for (var i = 0; i < nbVerts; ++i) {
      var ind = iVerts[i] * 3;
      var vx = vAr[ind];
      var vy = vAr[ind + 1];
      var vz = vAr[ind + 2];
      var nx = nAr[ind];
      var ny = nAr[ind + 1];
      var nz = nAr[ind + 2];
      var len = nx * nx + ny * ny + nz * nz;
      if (len === 0.0)
        continue;
      len = 1.0 / Math.sqrt(len);
      nx *= len;
      ny *= len;
      nz *= len;
      var i3 = i * 3;
      var smx = smoothVerts[i3];
      var smy = smoothVerts[i3 + 1];
      var smz = smoothVerts[i3 + 2];
      var dot = nx * (smx - vx) + ny * (smy - vy) + nz * (smz - vz);
      var mIntensity = intensity * mAr[ind + 2];
      if (picking)
        mIntensity *= picking.getAlpha(vx, vy, vz);
      vAr[ind] = vx + (smx - nx * dot - vx) * mIntensity;
      vAr[ind + 1] = vy + (smy - ny * dot - vy) * mIntensity;
      vAr[ind + 2] = vz + (smz - nz * dot - vz) * mIntensity;
    }
  }

  /** Smooth a group of vertices along their normals */
  smoothAlongNormals(iVerts, intensity, picking) {
    var mesh = this.getMesh();
    var vAr = mesh.getVertices();
    var mAr = mesh.getMaterials();
    var nAr = mesh.getNormals();
    var nbVerts = iVerts.length;

    var smoothVerts = new Float32Array(Utils.getMemory(nbVerts * 4 * 3), 0, nbVerts * 3);
    this.laplacianSmooth(iVerts, smoothVerts);

    for (var i = 0; i < nbVerts; ++i) {
      var ind = iVerts[i] * 3;
      var vx = vAr[ind];
      var vy = vAr[ind + 1];
      var vz = vAr[ind + 2];
      var nx = nAr[ind];
      var ny = nAr[ind + 1];
      var nz = nAr[ind + 2];
      var i3 = i * 3;
      var len = 1.0 / ((nx * nx + ny * ny + nz * nz));
      var dot = nx * (smoothVerts[i3] - vx) + ny * (smoothVerts[i3 + 1] - vy) + nz * (smoothVerts[i3 + 2] - vz);
      dot *= len * intensity * mAr[ind + 2];
      if (picking)
        dot *= picking.getAlpha(vx, vy, vz);
      vAr[ind] = vx + nx * dot;
      vAr[ind + 1] = vy + ny * dot;
      vAr[ind + 2] = vz + nz * dot;
    }
  }
}

export default Smooth;
