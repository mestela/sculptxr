import Enums from 'misc/Enums';
import Utils from 'misc/Utils';
import Geometry from 'math3d/Geometry';
import { vec3, mat4 } from 'gl-matrix';

// Overview sculpt :
// start (check if we hit the mesh, start state stack) -> startSculpt
// startSculpt (init stuffs specific to the tool) -> sculptStroke

// sculptStroke (handle sculpt stroke by throttling/smoothing stroke) -> makeStroke
// makeStroke (handle symmetry and picking before sculping) -> stroke
// stroke (tool specific, move vertices, etc)

// update -> sculptStroke

class SculptBase {

  constructor(main) {
    this._main = main;
    this._cbContinuous = this.updateContinuous.bind(this); // callback continuous
    this._lastMouseX = 0.0;
    this._lastMouseY = 0.0;
  }

  setRadius(val) {
    this._radius = val;
  }

  setIntensity(val) {
    this._intensity = val;
  }

  setToolMesh(mesh) {
    // to be called when we create a new instance of a tool operator
    // that is no part of the main application Sculpt container (e.g smooth)
    this._forceToolMesh = mesh;
  }

  getMesh() {
    return this._forceToolMesh || this._main.getMesh();
  }

  start(ctrl) {
    var main = this._main;
    var picking = main.getPicking();

    // VR Bypass: If in VR, we assume picking is already done by handleXRInput
    if (!main._xrSession) {
      if (!picking.intersectionMouseMeshes() && !this._allowAir)
        return false;
    } else {
      // In VR, just check if we have a mesh picked OR allowAir
      if (!picking.getMesh() && !this._allowAir) return false;
    }

    var mesh = main.setOrUnsetMesh(picking.getMesh(), ctrl);
    // If allowAir, we might proceed without a mesh selection
    if (!mesh && !this._allowAir)
      return false;

    picking.initAlpha();
    var pickingSym = main.getSculptManager().getSymmetry() ? main.getPickingSymmetry() : null;
    if (pickingSym && mesh) {
      pickingSym.intersectionMouseMesh(mesh);
      pickingSym.initAlpha();
    }

    // console.log("SculptBase: pushState called via start()");
    // if (window.screenLog) window.screenLog("SculptBase: Start Stroke (Push State)", "green");
    this.pushState();
    this._lastMouseX = main._mouseX;
    this._lastMouseY = main._mouseY;

    if (main._xrSession && main._vrControllerPos) {
      this._lastVRPos = vec3.clone(main._vrControllerPos);
    }

    this.startSculpt();

    return true;
  }

  end() {
    if (this.getMesh())
      this.getMesh().balanceOctree();
  }

  pushState() {
    this._main.getStateManager().pushStateGeometry(this.getMesh());
  }

  startSculpt() {
    if (this._lockPosition === true)
      return;

    // VR Support: Initial stroke
    if (this._main._xrSession) {
      if (this.makeStrokeXR) {
        var picking = this._main.getPicking();
        var pickingSym = this._main.getSculptManager().getSymmetry() ? this._main.getPickingSymmetry() : null;

        this.makeStrokeXR(picking, pickingSym); 

        // Init lastInter for continuous update
        var inter = picking.getIntersectionPoint();
        if (inter) this._lastInter = [inter[0], inter[1], inter[2]];
      }
      return;
      return;
    } else {
      // Fallback for Desktop Mouse debugging
      // if (window.screenLog) window.screenLog("SculptBase: VR Check FAIL - Fallback to Mouse", "orange");
    }

    this.sculptStroke();
  }

  preUpdate(canBeContinuous) {
    var main = this._main;

    // VR Bypass: handleXRInput does the intersection logic
    if (main._xrSession) return;

    var picking = main.getPicking();
    var isSculpting = main._action === Enums.Action.SCULPT_EDIT;

    if (isSculpting && !canBeContinuous)
      return;

    if (isSculpting) {
      var mesh = this.getMesh();
      if (mesh) picking.intersectionMouseMesh(mesh);
    } else {
      picking.intersectionMouseMeshes();
    }

    var mesh = picking.getMesh();
    if (mesh && main.getSculptManager().getSymmetry())
      main.getPickingSymmetry().intersectionMouseMesh(mesh);
  }

  update(continuous) {
    if (this._lockPosition === true)
      return this.updateSculptLock(continuous);
    this.sculptStroke();
  }

  /** Update lock position */
  updateSculptLock(continuous) {
    var main = this._main;
    if (!continuous)
      this._main.getStateManager().getCurrentState().undo(); // tricky

    var picking = main.getPicking();
    var origRad = this._radius;
    var pickingSym = main.getSculptManager().getSymmetry() ? main.getPickingSymmetry() : null;

    var dx = main._mouseX - this._lastMouseX;
    var dy = main._mouseY - this._lastMouseY;
    this._radius = Math.sqrt(dx * dx + dy * dy);
    // it's a bit hacky... I just simulate another stroke with a very small offset
    // so that the stroke still has a direction (the mask can be rotated correctly then)
    var offx = dx / this._radius;
    var offy = dy / this._radius;
    this.makeStroke(this._lastMouseX + offx * 1e-3, this._lastMouseY + offy * 1e-3, picking, pickingSym);
    this._radius = origRad;

    this.updateRender();
    main.setCanvasCursor('default');
  }

  sculptStroke() {
    var main = this._main;
    var picking = main.getPicking();
    var pickingSym = main.getSculptManager().getSymmetry() ? main.getPickingSymmetry() : null;

    var dx = main._mouseX - this._lastMouseX;
    var dy = main._mouseY - this._lastMouseY;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var minSpacing = 0.15 * this._radius * main.getPixelRatio();

    if (dist <= minSpacing)
      return;

    var step = 1.0 / Math.floor(dist / minSpacing);
    dx *= step;
    dy *= step;
    var mouseX = this._lastMouseX + dx;
    var mouseY = this._lastMouseY + dy;

    for (var i = step; i <= 1.0; i += step) {
      if (!this.makeStroke(mouseX, mouseY, picking, pickingSym))
        break;
      mouseX += dx;
      mouseY += dy;
    }

    this.updateRender();

    this._lastMouseX = main._mouseX;
    this._lastMouseY = main._mouseY;
  }

  updateRender() {
    this.updateMeshBuffers();
    this._main.render();
  }

  makeStroke(mouseX, mouseY, picking, pickingSym) {
    var mesh = this.getMesh();
    picking.intersectionMouseMesh(mesh, mouseX, mouseY);
    var pick1 = picking.getMesh();
    if (pick1) {
      picking.pickVerticesInSphere(picking.getLocalRadius2());
      picking.computePickedNormal();
    }
    // if dyn topo, we need to the picking and the sculpting altogether
    var dynTopo = mesh.isDynamic && !this._lockPosition;
    if (dynTopo && pick1)
      this.stroke(picking, false);

    var pick2;
    if (pickingSym) {
      pickingSym.intersectionMouseMesh(mesh, mouseX, mouseY);
      pick2 = pickingSym.getMesh();
      if (pick2) {
        pickingSym.setLocalRadius2(picking.getLocalRadius2());
        pickingSym.pickVerticesInSphere(pickingSym.getLocalRadius2());
        pickingSym.computePickedNormal();
      }
    }

    if (!dynTopo && pick1) this.stroke(picking, false);
    if (pick2) this.stroke(pickingSym, true);
    return pick1 || pick2;
  }

  updateMeshBuffers() {
    var mesh = this.getMesh();
    if (mesh.isDynamic)
      mesh.updateBuffers();
    else
      mesh.updateGeometryBuffers();
  }

  updateContinuous() {
    if (this._lockPosition) return this.update(true);
    var main = this._main;
    var picking = main.getPicking();
    var pickingSym = main.getSculptManager().getSymmetry() ? main.getPickingSymmetry() : null;
    this.makeStroke(main._mouseX, main._mouseY, picking, pickingSym);
    this.updateRender();
  }

  // WebXR Support
  updateXR(picking) {
    this.sculptStrokeXR(picking);
  }

  sculptStrokeXR(picking) {
    var main = this._main;
    var pickingSym = main.getSculptManager().getSymmetry() ? main.getPickingSymmetry() : null;

    // Use Controller Distance (Robust like Move.js) instead of Surface Distance (Fragile)
    var worldPos = main._vrControllerPos;
    if (!worldPos || !this._lastVRPos) {
      return;
    }

    var dist = vec3.dist(worldPos, this._lastVRPos);
    var rWorld = Math.sqrt(picking._rWorld2);
    var minSpacing = 0.15 * rWorld;

    if (dist <= minSpacing) {
      // if (window.screenLog && this._main._logThrottle % 60 === 0) window.screenLog(`SB: Skip dist=${dist.toFixed(4)}`, "grey");
      return;
    }

    this.makeStrokeXR(picking, pickingSym);

    vec3.copy(this._lastVRPos, worldPos);
    // Also update _lastInter nicely if we can, but it's less critical now
    var inter = picking.getIntersectionPoint();
    if (inter) {
      if (!this._lastInter) this._lastInter = [0, 0, 0];
      this._lastInter[0] = inter[0];
      this._lastInter[1] = inter[1];
      this._lastInter[2] = inter[2];
    }

    this.updateRender();
  }

  makeStrokeXR(picking, pickingSym) {
    const t0 = performance.now();
    var mesh = this.getMesh();
    // picking is already updated by handleXRInput

    var pick1 = picking.getMesh();
    if (pick1) {
      picking.pickVerticesInSphere(picking.getLocalRadius2());
      picking.computePickedNormal();
    }

    var dynTopo = mesh.isDynamic && !this._lockPosition;
    if (dynTopo && pick1)
      this.stroke(picking, false);

    var pick2;
    // Symmetry Logic for Generic Tools
    if (pickingSym && this._main.getSculptManager().getSymmetry()) {
      const main = this._main;
      if (main._vrControllerPos) {
        // Mirror World Pos
        var worldPos = vec3.clone(main._vrControllerPos);
        var mInv = mat4.create();
        mat4.invert(mInv, mesh.getMatrix());

        // World -> Local
        var localPos = vec3.create();
        vec3.transformMat4(localPos, worldPos, mInv);

        // Correct Symmetry Mirroring (Local Space)
        var ptPlane = mesh.getSymmetryOrigin(); // Local Space
        var nPlane = mesh.getSymmetryNormal();  // Local Space
        Geometry.mirrorPoint(localPos, ptPlane, nPlane);

        // Local -> World
        var symWorldPos = vec3.create();
        vec3.transformMat4(symWorldPos, localPos, mesh.getMatrix());

        // LOGGING
        // if (window.screenLog && Math.random() < 0.05) {
        //   window.screenLog(`Sym Check: Pos=${worldPos[0].toFixed(2)} Sym=${symWorldPos[0].toFixed(2)}`, "yellow");
        // }

        // Intersection
        var rWorld = Math.sqrt(picking._rWorld2);

        // FIX v0.6.4: Unit-Corrected Cap (5cm Physical)
        const vrScale = this._main._vrScale || 1.0;
        const invScale = 1.0 / vrScale;
        const MAX_SEARCH_METERS = 0.05; // 5cm
        const MAX_SEARCH_RADIUS = MAX_SEARCH_METERS * invScale;

        const searchRadius = Math.min(rWorld * 4.0, MAX_SEARCH_RADIUS);
        pickingSym.intersectionSphereMeshes([mesh], symWorldPos, searchRadius);

        if (pickingSym.getMesh()) {
          pickingSym.setLocalRadius2(picking.getLocalRadius2());
          pickingSym.pickVerticesInSphere(pickingSym.getLocalRadius2());
          pickingSym.computePickedNormal();
          pick2 = pickingSym.getMesh();
        }
      }
    }

    if (!dynTopo && pick1) {
      this.stroke(picking, false);
    }
    if (pick2) {
      this.stroke(pickingSym, true);
    }

    const t1 = performance.now();
    if (!this._lastPerfLog || t1 - this._lastPerfLog > 1000) {
      this._lastPerfLog = t1;
      const dur = t1 - t0;
      const count1 = pick1 ? picking.getPickedVertices().length : 0;
      const count2 = pick2 ? pickingSym.getPickedVertices().length : 0;
      if (window.screenLog) {
        window.screenLog(`Stroke: ${dur.toFixed(1)}ms V:${count1 + count2}`, dur > 10 ? "orange" : "green");
      }
    }

    return pick1 || pick2;
  }

  /** Return the vertices that point toward the camera */
  getFrontVertices(iVertsInRadius, eyeDir) {
    var nbVertsSelected = iVertsInRadius.length;
    var iVertsFront = new Uint32Array(Utils.getMemory(4 * nbVertsSelected), 0, nbVertsSelected);
    var acc = 0;
    var nAr = this.getMesh().getNormals();
    var eyeX = eyeDir[0];
    var eyeY = eyeDir[1];
    var eyeZ = eyeDir[2];
    for (var i = 0; i < nbVertsSelected; ++i) {
      var id = iVertsInRadius[i];
      var j = id * 3;
      if ((nAr[j] * eyeX + nAr[j + 1] * eyeY + nAr[j + 2] * eyeZ) <= 0.0)
        iVertsFront[acc++] = id;
    }
    return new Uint32Array(iVertsFront.subarray(0, acc));
  }

  /** Compute average normal of a group of vertices with culling */
  areaNormal(iVerts) {
    var mesh = this.getMesh();
    var nAr = mesh.getNormals();
    var mAr = mesh.getMaterials();
    var anx = 0.0;
    var any = 0.0;
    var anz = 0.0;
    for (var i = 0, l = iVerts.length; i < l; ++i) {
      var ind = iVerts[i] * 3;
      var f = mAr[ind + 2];
      anx += nAr[ind] * f;
      any += nAr[ind + 1] * f;
      anz += nAr[ind + 2] * f;
    }
    var len = Math.sqrt(anx * anx + any * any + anz * anz);
    if (len === 0.0)
      return;
    len = 1.0 / len;
    return [anx * len, any * len, anz * len];
  }

  /** Compute average center of a group of vertices (with culling) */
  areaCenter(iVerts) {
    var mesh = this.getMesh();
    var vAr = mesh.getVertices();
    var mAr = mesh.getMaterials();
    var nbVerts = iVerts.length;
    var ax = 0.0;
    var ay = 0.0;
    var az = 0.0;
    var acc = 0;
    for (var i = 0; i < nbVerts; ++i) {
      var ind = iVerts[i] * 3;
      var f = mAr[ind + 2];
      acc += f;
      ax += vAr[ind] * f;
      ay += vAr[ind + 1] * f;
      az += vAr[ind + 2] * f;
    }
    return [ax / acc, ay / acc, az / acc];
  }

  /** Updates the vertices original coords that are sculpted for the first time in this stroke */
  updateProxy(iVerts) {
    var mesh = this.getMesh();
    var vAr = mesh.getVertices();
    var vProxy = mesh.getVerticesProxy();
    if (vAr === vProxy)
      return;
    var vertStateFlags = mesh.getVerticesStateFlags();
    var stateFlag = Utils.STATE_FLAG;
    for (var i = 0, l = iVerts.length; i < l; ++i) {
      var id = iVerts[i];
      if (vertStateFlags[id] !== stateFlag) {
        var ind = id * 3;
        vProxy[ind] = vAr[ind];
        vProxy[ind + 1] = vAr[ind + 1];
        vProxy[ind + 2] = vAr[ind + 2];
      }
    }
  }

  /** Laplacian smooth. Special rule for vertex on the edge of the mesh. */
  laplacianSmooth(iVerts, smoothVerts, vField) {
    var mesh = this.getMesh();
    var vrvStartCount = mesh.getVerticesRingVertStartCount();
    var vertRingVert = mesh.getVerticesRingVert();
    var ringVerts = vertRingVert instanceof Array ? vertRingVert : null;
    var vertOnEdge = mesh.getVerticesOnEdge();
    var vAr = vField || mesh.getVertices();
    var nbVerts = iVerts.length;

    for (var i = 0; i < nbVerts; ++i) {
      var i3 = i * 3;
      var id = iVerts[i];

      var start, end;
      if (ringVerts) {
        vertRingVert = ringVerts[id];
        start = 0;
        end = vertRingVert.length;
      } else {
        start = vrvStartCount[id * 2];
        end = start + vrvStartCount[id * 2 + 1];
      }

      var idv = 0;
      var vcount = end - start;
      if (vcount <= 2) {
        idv = id * 3;
        smoothVerts[i3] = vAr[idv];
        smoothVerts[i3 + 1] = vAr[idv + 1];
        smoothVerts[i3 + 2] = vAr[idv + 2];
        continue;
      }

      var avx = 0.0;
      var avy = 0.0;
      var avz = 0.0;
      var j = 0;

      if (vertOnEdge[id] === 1) {
        var nbVertEdge = 0;
        for (j = start; j < end; ++j) {
          idv = vertRingVert[j];
          // we average only with vertices that are also on the edge
          if (vertOnEdge[idv] === 1) {
            idv *= 3;
            avx += vAr[idv];
            avy += vAr[idv + 1];
            avz += vAr[idv + 2];
            ++nbVertEdge;
          }
        }

        if (nbVertEdge >= 2) {
          smoothVerts[i3] = avx / nbVertEdge;
          smoothVerts[i3 + 1] = avy / nbVertEdge;
          smoothVerts[i3 + 2] = avz / nbVertEdge;
          continue;
        }
        avx = avy = avz = 0.0;
      }

      for (j = start; j < end; ++j) {
        idv = vertRingVert[j] * 3;
        avx += vAr[idv];
        avy += vAr[idv + 1];
        avz += vAr[idv + 2];
      }

      smoothVerts[i3] = avx / vcount;
      smoothVerts[i3 + 1] = avy / vcount;
      smoothVerts[i3 + 2] = avz / vcount;
    }
  }

  dynamicTopology(picking) {
    var mesh = this.getMesh();
    var iVerts = picking.getPickedVertices();
    if (!mesh.isDynamic)
      return iVerts;

    var subFactor = mesh.getSubdivisionFactor();
    var decFactor = mesh.getDecimationFactor();
    if (subFactor === 0.0 && decFactor === 0.0)
      return iVerts;

    if (iVerts.length === 0) {
      iVerts = mesh.getVerticesFromFaces([picking.getPickedFace()]);
      // undo-redo
      this._main.getStateManager().pushVertices(iVerts);
    }

    var iFaces = mesh.getFacesFromVertices(iVerts);
    var radius2 = picking.getLocalRadius2();
    var center = picking.getIntersectionPoint();
    var d2Max = radius2 * (1.1 - subFactor) * 0.2;
    var d2Min = (d2Max / 4.2025) * decFactor;

    // undo-redo
    this._main.getStateManager().pushFaces(iFaces);

    if (subFactor)
      iFaces = mesh.subdivide(iFaces, center, radius2, d2Max, this._main.getStateManager());
    if (decFactor)
      iFaces = mesh.decimate(iFaces, center, radius2, d2Min, this._main.getStateManager());
    iVerts = mesh.getVerticesFromFaces(iFaces);

    var nbVerts = iVerts.length;
    var sculptFlag = Utils.SCULPT_FLAG;
    var vscf = mesh.getVerticesSculptFlags();
    var iVertsInRadius = new Uint32Array(Utils.getMemory(nbVerts * 4), 0, nbVerts);
    var acc = 0;
    for (var i = 0; i < nbVerts; ++i) {
      var iVert = iVerts[i];
      if (vscf[iVert] === sculptFlag)
        iVertsInRadius[acc++] = iVert;
    }

    iVertsInRadius = new Uint32Array(iVertsInRadius.subarray(0, acc));
    mesh.updateTopology(iFaces, iVerts);
    mesh.updateGeometry(iFaces, iVerts);

    return iVertsInRadius;
  }

  getUnmaskedVertices() {
    return this.filterMaskedVertices(0.0, Infinity);
  }

  getMaskedVertices() {
    return this.filterMaskedVertices(-Infinity, 1.0);
  }

  filterMaskedVertices(lowerBound = -Infinity, upperBound = Infinity) {
    var mesh = this.getMesh();
    var mAr = mesh.getMaterials();
    var nbVertices = mesh.getNbVertices();
    var cleaned = new Uint32Array(Utils.getMemory(4 * nbVertices), 0, nbVertices);
    var acc = 0;
    for (var i = 0; i < nbVertices; ++i) {
      var mask = mAr[i * 3 + 2];
      if (mask > lowerBound && mask < upperBound)
        cleaned[acc++] = i;
    }
    return new Uint32Array(cleaned.subarray(0, acc));
  }

  postRender(selection) {
    selection.render(this._main);
  }

  addSculptToScene() {}

  getScreenRadius() {
    return (this._radius || 1) * this._main.getPixelRatio();
  }
}

export default SculptBase;
