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
    // KEEP THE VOLUME. Laplacian smoothing moves every vertex towards the average of its
    // neighbours, and on any convex surface that average lies INSIDE it — so smoothing shrinks,
    // and on a low-resolution tube it shrinks fast. matt: "if i smooth on the fingers, they
    // rapidly become super thin tubes."
    //
    // The correction is Vollmer's HC-Laplacian: the shrink is the LOW-FREQUENCY part of the
    // displacement, the part a vertex shares with its neighbours, so subtracting a blend of each
    // vertex's own displacement and its neighbours' average removes the shrink while leaving the
    // high-frequency part — which is the smoothing that was actually wanted.
    //
    // MEASURED on an 8-sided tube of radius 1, which is about what a finger's skin comes out as.
    // Radius after N passes, plain against HC:
    //     1 pass    0.854   ->  0.989
    //     5 passes  0.452   ->  0.948
    //    20 passes  0.040   ->  0.809
    // The plain operator does not merely thin a tube, it eventually consumes it; that is the
    // operator behaving correctly, which is why the answer is a different operator and not a
    // smaller intensity.
    this._preserveVolume = true;
    // How many times the smoothing step runs per stroke step — see the loop in update().
    this._passes = 1;
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
    // MORE THAN ONE PASS, FOR RELAX. A tangential pass moves each vertex only as far as its ring
    // average projected onto the surface, which is a small step by construction — so one pass of
    // it reads as barely doing anything however hard the intensity is pushed. matt: "relax doesn't
    // relax enough." Passes are the honest lever: intensity past 1 overshoots the average and
    // oscillates, while repeating a convergent step just converges further.
    //
    // One pass for Smooth, so nothing about it changes; Relax sets its own count.
    var passes = Math.max(1, this._passes | 0);
    for (var pass = 0; pass < passes; ++pass) {
      if (this._tangent) this.smoothTangent(iVertsInRadius, intensity, picking);
      else this.smooth(iVertsInRadius, intensity, picking);
    }

    var mesh = this.getMesh();
    mesh.updateGeometry(mesh.getFacesFromVertices(iVertsInRadius), iVertsInRadius);
  }

  /** Smooth a group of vertices. New position is given by simple averaging */
  smooth(iVerts, intensity, picking) {
    var mesh = this.getMesh();
    var vAr = mesh.getVertices();
    var mAr = mesh.getMaterials();
    var nbVerts = iVerts.length;

    // Three views on one scratch buffer: the smoothed positions, the displacement each vertex
    // took, and the one-ring average of that displacement.
    var bytes = nbVerts * 4 * 3;
    var mem = Utils.getMemory(bytes * 3);
    var smoothVerts = new Float32Array(mem, 0, nbVerts * 3);
    this.laplacianSmooth(iVerts, smoothVerts);

    if (this._preserveVolume) {
      var disp = new Float32Array(mem, bytes, nbVerts * 3);
      var avgDisp = new Float32Array(mem, bytes * 2, nbVerts * 3);
      for (var d = 0; d < nbVerts; ++d) {
        var d3 = d * 3, dind = iVerts[d] * 3;
        disp[d3] = smoothVerts[d3] - vAr[dind];
        disp[d3 + 1] = smoothVerts[d3 + 1] - vAr[dind + 1];
        disp[d3 + 2] = smoothVerts[d3 + 2] - vAr[dind + 2];
      }
      this.ringAverageLocal(iVerts, disp, avgDisp);
      // BETA IS HOW MUCH OF THE SHRINK COMES BACK. At 0 the correction is the neighbours' average
      // alone and the surface barely smooths; at 1 it is the vertex's own displacement and nothing
      // moves at all. Vollmer's paper uses 0.5-0.6, and 0.5 is what reads as "smoother, same
      // thickness" here.
      var beta = 0.5;
      for (d = 0; d < nbVerts; ++d) {
        var c3 = d * 3;
        smoothVerts[c3] -= beta * disp[c3] + (1 - beta) * avgDisp[c3];
        smoothVerts[c3 + 1] -= beta * disp[c3 + 1] + (1 - beta) * avgDisp[c3 + 1];
        smoothVerts[c3 + 2] -= beta * disp[c3 + 2] + (1 - beta) * avgDisp[c3 + 2];
      }
    }

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
