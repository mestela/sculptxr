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
    // See Move.preUpdate: path hover always, mesh hover only when the paths are not up.
    MotionPathEdit.hoverTick(this._main);
    if (this._pathsOwnStroke()) return;
    super.preUpdate(canBeContinuous);
  }

  // THE PATHS OWN THE STROKE WHILE THEY ARE ON SCREEN — see MotionPathEdit.owns. Both halves of
  // the tool are gated, not just the press: preUpdate is where the per-frame HOVER raycast
  // happens, and skipping it is most of the point on a heavy mesh. A press that misses every
  // curve returns false rather than falling through, so nothing sculpts and the camera gets the
  // drag instead.
  _pathsOwnStroke() {
    return MotionPathEdit.owns(this._main);
  }

  start(ctrl) {
    const main = this._main;
    if (MotionPathEdit.begin(main, main._mouseX, main._mouseY, this.getScreenRadius())) return true;
    // Missed every curve while curves are drawn: the mesh is not the target — see Move.start.
    if (this._pathsOwnStroke()) return false;
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
    if (this._pathsOwnStroke()) return;
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

    // A ONE-RING LAPLACIAN IS NOT A FIXED-SIZE BRUSH. It moves each vertex toward the average of
    // its IMMEDIATE neighbours, so how far the surface travels per pass is set by EDGE LENGTH,
    // not by the radius you dialled in. Subdivide and the same brush at the same strength does
    // less and less, until on a dense mesh it does visibly nothing. adurna35: "Smooth tool doesn't
    // affect higher poly meshes even at 100% strength... Now i have to remesh pretty low to see a
    // genuine change."
    //
    // MEASURED, on a gaussian bump of fixed world width, one step at intensity 1.0, amplitude
    // remaining (1.0 = untouched):
    //
    //   verts across the span   16      32      64     128     256     512    1024
    //   plain laplacian      0.8672  0.9651  0.9913  0.9979  0.9995  0.9999  1.0000
    //   with HC volume       0.9759  0.9982  0.9999  1.0000  1.0000  1.0000  1.0000
    //
    // The falloff is quadratic in linear density, and quadratic in linear density is LINEAR IN
    // THE VERTEX COUNT UNDER THE BRUSH -- a count already in hand, since it is the array we were
    // handed. So passes scale with it against a reference footprint, capped twice: a hard ceiling,
    // and a work budget, because the cost is passes x verts and a headset has a frame budget.
    //
    // Plain laplacian, passes scaled this way, same measurement:
    //   verts under brush        12      46     185     741    2965   11859
    //   passes                    1       5      16      16      13       3
    //   amplitude left       0.8672  0.8560  0.8837  0.9672  0.9931  0.9996
    // -- parity with the low-poly feel up to a few hundred verts under the brush, degrading
    // beyond it. Honest limit: passes cannot buy their way out of this at very high density.
    //
    // Tunable live, because the reference and the caps are feel, not maths:
    //   window._smoothAutoPasses = false   the old fixed single pass
    //   window._smoothPassRef              footprint that means "one pass" (default 10)
    //   window._smoothPassCap              hard ceiling (default 16)
    //   window._smoothPassBudget           passes x verts ceiling (default 40000)
    if (!this._tangent && window._smoothAutoPasses !== false) {
      var nv = iVertsInRadius.length;
      var ref = window._smoothPassRef || 10;
      var cap = window._smoothPassCap || 16;
      var budget = window._smoothPassBudget || 40000;
      var scaled = Math.max(1, Math.round(nv / ref));
      var afford = Math.max(1, Math.floor(budget / Math.max(nv, 1)));
      passes = Math.max(passes, Math.min(cap, scaled, afford));
    }

    // window._smoothTrace = true -- what the brush actually decided, since "it could be stronger"
    // and "it is at the ceiling" look identical from inside a headset. Throttled: a stroke is 90
    // of these a second.
    if (window._smoothTrace && (!this._smTraceT || performance.now() - this._smTraceT > 250)) {
      this._smTraceT = performance.now();
      var _pv = this._preserveVolume;
      console.log('[smooth] verts=' + iVertsInRadius.length + ' passes=' + passes
        + ' intensity=' + intensity.toFixed(2) + ' strength=' + this._intensity.toFixed(2)
        + ' preserveVolume=' + _pv);
    }
    if (this._tangent) {
      for (var pass = 0; pass < passes; ++pass) {
        this.smoothTangent(iVertsInRadius, intensity, picking);
      }
    } else {
      // THE FALLOFF IS APPLIED ONCE, NOT ONCE PER PASS.
      //
      // Each pass blended toward the smoothed position by intensity*alpha, so over k passes a
      // vertex received 1-(1-m)^k. That is fine at k=1 and ruinous at k=16, because it turns a
      // soft falloff into a disc with a rim:
      //
      //   alpha      1.00    0.70    0.50    0.30    0.20    0.10    0.05
      //   k=1      1.0000  0.7000  0.5000  0.3000  0.2000  0.1000  0.0500
      //   k=16     1.0000  1.0000  1.0000  0.9967  0.9719  0.8147  0.5599
      //
      // Everything past alpha 0.3 is fully smoothed and the whole transition is squeezed into the
      // outer sliver -- so each dab of the brush leaves a step where its edge fell. matt: "i see
      // clear stepping where each 'stamp' of the brush has been." Invisible until now only
      // because Keep Volume damped every pass; it is the density compensation that made k large.
      //
      // So: run the passes at FULL strength on the picked set, then blend original toward result
      // once by intensity*alpha. The profile is then exactly the falloff curve, whatever k is.
      // Masking stays per-pass (passing picking=null keeps the material term inside smooth()) --
      // mask values are flat 0 or 1, so compounding them cannot build a gradient, and a masked
      // vertex must not drift and snap back.
      var mesh0 = this.getMesh();
      var vAr0 = mesh0.getVertices();
      var nv0 = iVertsInRadius.length;
      // Instance scratch, not Utils.getMemory: smooth() uses that same shared arena internally,
      // and this has to survive across all of its calls.
      if (!this._rimOrig || this._rimOrig.length < nv0 * 3) {
        this._rimOrig = new Float32Array(nv0 * 3);
        this._rimW = new Float32Array(nv0);
      }
      var orig = this._rimOrig, wAr = this._rimW;
      for (var q = 0; q < nv0; ++q) {
        var oi = iVertsInRadius[q] * 3, q3 = q * 3;
        var ox = vAr0[oi], oy = vAr0[oi + 1], oz = vAr0[oi + 2];
        orig[q3] = ox; orig[q3 + 1] = oy; orig[q3 + 2] = oz;
        // Sampled at the ORIGINAL position: the vertex is about to move, and the falloff is a
        // function of where it was when the brush landed on it.
        wAr[q] = intensity * (picking ? picking.getAlpha(ox, oy, oz) : 1);
      }
      for (var pass2 = 0; pass2 < passes; ++pass2) {
        this.smooth(iVertsInRadius, 1.0, null);
      }
      for (var r = 0; r < nv0; ++r) {
        var ri = iVertsInRadius[r] * 3, r3 = r * 3;
        var a = wAr[r]; if (a >= 1) continue;
        var ia = 1 - a;
        vAr0[ri]     = orig[r3]     * ia + vAr0[ri]     * a;
        vAr0[ri + 1] = orig[r3 + 1] * ia + vAr0[ri + 1] * a;
        vAr0[ri + 2] = orig[r3 + 2] * ia + vAr0[ri + 2] * a;
      }
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

    // VOLUME PRESERVATION IS A CEILING, NOT A DAMPER, and that is the part worth knowing before
    // touching it. HC does not merely smooth more slowly -- it converges to a fixed point that
    // STILL HAS THE SHAPE IN IT. Measured on the same bump at 64 verts across, amplitude left
    // after five thousand passes:
    //
    //   plain          0.0013     (smooths away completely, as you would expect)
    //   HC beta 0.5    0.8007     (never removes it, however long you hold the brush)
    //   HC beta 0.2       NaN     (the correction goes unstable below ~0.4 -- beta is not a dial)
    //
    // So the two complaints this operator has collected are genuinely opposed. matt wanted HC
    // because plain laplacian eats thin geometry: "if i smooth on the fingers, they rapidly
    // become super thin tubes." adurna35 wants shape gone: "i have to remesh pretty low to see a
    // genuine change." Preserving volume is exactly the thing that refuses the second.
    //
    // BOTH ANSWERS ARE RIGHT, SO IT IS A BUTTON. matt, after the A/B on device: "now i see the
    // difference. yes thats huge, and awesome, both have pros and cons." On means detail comes off
    // and form stays; off means the form goes too, and thin geometry goes with it. Defaults ON,
    // which is the shipped behaviour and the one whose failure mode is recoverable.
    //
    // Read straight off the tool, with no window override beside it: this session lost two rounds
    // to a value that had two sources of truth, and a debug switch living next to a real control
    // is exactly that shape. The panel writes this field and saveOption persists it.
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
