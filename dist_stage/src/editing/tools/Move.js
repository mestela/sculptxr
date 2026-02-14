import { vec3, mat4, quat } from 'gl-matrix';
import Geometry from '../../math3d/Geometry.js';
import SculptBase from 'editing/tools/SculptBase';
import MeshSymmetry from '../../mesh/MeshSymmetry.js';

class Move extends SculptBase {
  // v0.7.491: Clean Import & Null Check
  constructor(main) {
    super(main);

    this._radius = 80;
    this._intensity = 1.0;
    this._topoCheck = true;
    this._negative = false; // along normal
    this._allowAir = true; // [VR] Allow moving without surface snap
    this._moveData = {
      center: [0.0, 0.0, 0.0],
      dir: [0.0, 0.0],
      vProxy: null
    };
    this._moveDataSym = {
      center: [0.0, 0.0, 0.0],
      dir: [0.0, 0.0],
      vProxy: null
    };
    this._idAlpha = 0;
    this._lastVRQuat = quat.create(); // [VR] 6DOF
  }

  startSculpt() {
    var main = this._main;
    var picking = main.getPicking();
    this.initMoveData(picking, this._moveData);

    // VERIFY UPDATE
    // console.error("SculptXR verify: Move.js v0.7.491 loaded with NULL CHECKS");

    if (main.getSculptManager().getSymmetry()) {
      var pickingSym = main.getPickingSymmetry();
      var mesh = this.getMesh();
      
      // VR Symmetry Init
      if (main._xrSession && main._vrControllerPos && mesh) {
        // Mirror 'world' pos
          var worldPos = vec3.clone(main._vrControllerPos);
          var mInv = mat4.create();
          mat4.invert(mInv, mesh.getMatrix());
          vec3.transformMat4(worldPos, worldPos, mInv); // To Local
          worldPos[0] = -worldPos[0]; // Mirror X
          vec3.transformMat4(worldPos, worldPos, mesh.getMatrix()); // Back to World
          
          pickingSym.intersectionSphereMeshes([mesh], worldPos, picking.getWorldRadius());
          if (pickingSym.getMesh()) {
            pickingSym.setLocalRadius2(picking.getLocalRadius2());
            // CRITICAL FIX: Re-init alpha for valid masking (SculptBase.start initialized it with garbage mouse data)
            pickingSym.computePickedNormal(); // Update normal at new sym pos
            pickingSym.updateAlpha();         // Update masking plane
            this.initMoveData(pickingSym, this._moveDataSym);
          }
      } else {
        if (mesh) {
          pickingSym.intersectionMouseMesh(mesh);
          pickingSym.setLocalRadius2(picking.getLocalRadius2());

          if (pickingSym.getMesh()) {
            this.initMoveData(pickingSym, this._moveDataSym);
          }
        }
      }

      // TOPOLOGICAL VERTEX SNAP (Corrects Drift)
      if (pickingSym.getMesh() && mesh) {
        // Robust Fallback
        let symData = null;
        if (typeof mesh.getSymmetryData === 'function') {
          symData = mesh.getSymmetryData();
        } else {
          if (!mesh._symmetryData) mesh._symmetryData = new MeshSymmetry(mesh);
          symData = mesh._symmetryData; // Assuming imported via SculptBase or global scope
        }
        const symMap = symData ? symData.getMap() : null;

        if (symMap && this._moveData.iVerts) {
          const mainVerts = this._moveData.iVerts;
          const nbVerts = mainVerts.length;
          const newVerts = new Uint32Array(nbVerts);
          let acc = 0;
          for (let i = 0; i < nbVerts; ++i) {
            const id = mainVerts[i];
            const mid = symMap[id];
            if (mid !== -1) newVerts[acc++] = mid;
          }
          // Update Sym Move Data with EXACT mapped vertices
          const symVerts = newVerts.subarray(0, acc);
          this._moveDataSym.iVerts = symVerts;
          // IMPORTANT: Push these to Undo State (they might differ from geometric picking)
          main.getStateManager().pushVertices(symVerts);

          // Re-fetch proxy data for these specific vertices
          const vAr = mesh.getVertices();
          const vProxy = this._moveDataSym.vProxy = new Float32Array(acc * 3);
          const iVerts = this._moveDataSym.iVerts;
          for (let i = 0; i < acc; ++i) {
            const ind = iVerts[i] * 3;
            const j = i * 3;
            vProxy[j] = vAr[ind];
            vProxy[j + 1] = vAr[ind + 1];
            vProxy[j + 2] = vAr[ind + 2];
          }

          // Also update pickingSym center to match topological center?
          // Ideally yes, but Move tool uses `center` for falloff calculation. 
          // If we use the geometric center but topological vertices, the falloff might be slightly skewed if deformed.
          // But fixing vertices is 90% of the battle.
        }
      }
    }

    // [VR] Capture Initial Rotation
    if (main._xrSession && main._vrControllerQuat) {
      quat.copy(this._lastVRQuat, main._vrControllerQuat);
    }
  }

  initMoveData(picking, moveData) {
    if (this._topoCheck)
      picking.pickVerticesInSphereTopological(picking.getLocalRadius2());
    else
      picking.pickVerticesInSphere(picking.getLocalRadius2());

    vec3.copy(moveData.center, picking.getIntersectionPoint());
    var iVerts = picking.getPickedVertices();
    moveData.iVerts = new Uint32Array(iVerts); // Clone vertices

    // undo-redo
    this._main.getStateManager().pushVertices(iVerts);

    var mesh = picking.getMesh();
    if (!mesh) return; // Guard against null mesh

    var vAr = mesh.getVertices();
    var nbVerts = iVerts.length;
    var vProxy = moveData.vProxy = new Float32Array(nbVerts * 3);
    for (var i = 0; i < nbVerts; ++i) {
      var ind = iVerts[i] * 3;
      var j = i * 3;
      vProxy[j] = vAr[ind];
      vProxy[j + 1] = vAr[ind + 1];
      vProxy[j + 2] = vAr[ind + 2];
    }
  }

  copyVerticesProxy(picking, moveData) {
    var iVerts = moveData.iVerts || picking.getPickedVertices(); // Use stored if avail
    var vAr = this.getMesh().getVertices();
    var vProxy = moveData.vProxy;
    for (var i = 0, nbVerts = iVerts.length; i < nbVerts; ++i) {
      var ind = iVerts[i] * 3;
      var j = i * 3;
      vAr[ind] = vProxy[j];
      vAr[ind + 1] = vProxy[j + 1];
      vAr[ind + 2] = vProxy[j + 2];
    }
  }

  sculptStroke() {
    var main = this._main;
    var picking = main.getPicking();
    var pickingSym = main.getPickingSymmetry();
    var useSym = main.getSculptManager().getSymmetry() && pickingSym.getMesh();

    picking.updateAlpha(this._lockPosition);
    picking.setIdAlpha(this._idAlpha);
    if (useSym) {
      pickingSym.updateAlpha(false);
      pickingSym.setIdAlpha(this._idAlpha);
    }

    this.copyVerticesProxy(picking, this._moveData);
    if (useSym)
      this.copyVerticesProxy(pickingSym, this._moveDataSym);

    var mouseX = main._mouseX;
    var mouseY = main._mouseY;
    this.updateMoveDir(picking, mouseX, mouseY);
    this.move(picking.getPickedVertices(), picking.getIntersectionPoint(), picking.getLocalRadius2(), this._moveData, picking);

    if (useSym) {
      this.updateMoveDir(pickingSym, mouseX, mouseY, true);

      const moveData = this._moveData;
      const moveDataSym = this._moveDataSym;

      // Check if Topo Snap active (Master-Slave)
      if (moveData.iVerts && moveDataSym.iVerts && moveData.iVerts.length === moveDataSym.iVerts.length) {
        // Master-Slave Mirroring
        const iVerts = moveData.iVerts;
        const iVertsSym = moveDataSym.iVerts;
        const nbVerts = iVerts.length;

        const vAr = mesh.getVertices();
        const vProxy = moveData.vProxy;
        const symProxy = moveDataSym.vProxy;
        const nPlane = mesh.getSymmetryNormal();
        const delta = [0.0, 0.0, 0.0];

        for (let i = 0; i < nbVerts; ++i) {
          const id = iVerts[i];
          const idSym = iVertsSym[i];
          const i3 = id * 3;
          const i3Sym = idSym * 3;
          const j = i * 3;

          // Calc Delta
          delta[0] = vAr[i3] - vProxy[j];
          delta[1] = vAr[i3 + 1] - vProxy[j + 1];
          delta[2] = vAr[i3 + 2] - vProxy[j + 2];

          // Mirror Delta
          Geometry.mirrorPoint(delta, [0, 0, 0], nPlane);

          // Apply
          vAr[i3Sym] = symProxy[j] + delta[0];
          vAr[i3Sym + 1] = symProxy[j + 1] + delta[1];
          vAr[i3Sym + 2] = symProxy[j + 2] + delta[2];
        }
      } else {
      // Fallback
        this.move(pickingSym.getPickedVertices(), pickingSym.getIntersectionPoint(), pickingSym.getLocalRadius2(), this._moveDataSym, pickingSym);
      }
    }

    var mesh = this.getMesh();
    var mesh = this.getMesh();
    // FIX v0.7.492: Use moveData.iVerts for proper normal updates
    if (this._moveData.iVerts) {
      mesh.updateGeometry(mesh.getFacesFromVertices(this._moveData.iVerts), this._moveData.iVerts);
    } else {
      mesh.updateGeometry(mesh.getFacesFromVertices(picking.getPickedVertices()), picking.getPickedVertices());
    }

    if (useSym) {
      if (this._moveDataSym.iVerts) {
        mesh.updateGeometry(mesh.getFacesFromVertices(this._moveDataSym.iVerts), this._moveDataSym.iVerts);
      } else {
        mesh.updateGeometry(mesh.getFacesFromVertices(pickingSym.getPickedVertices()), pickingSym.getPickedVertices());
      }
    }
    this.updateRender();
    main.setCanvasCursor('default');
  }

  move(iVerts, center, radiusSquared, moveData, picking, rotQuat, useSym) {
    var mesh = this.getMesh();
    var vAr = mesh.getVertices();
    var mAr = mesh.getMaterials();
    var radius = Math.sqrt(radiusSquared);
    var vProxy = moveData.vProxy;
    var cx = center[0];
    var cy = center[1];
    var cz = center[2];
    var dir = moveData.dir;
    var dirx = dir[0];
    var diry = dir[1];
    var dirz = dir[2];

    var vTemp = [0.0, 0.0, 0.0];

    // Symmetry Plane Data
    var ptPlane = useSym ? mesh.getSymmetryOrigin() : null;
    var nPlane = useSym ? mesh.getSymmetryNormal() : null;

    for (var i = 0, l = iVerts.length; i < l; ++i) {
      var ind = iVerts[i] * 3;
      var j = i * 3;
      var vx = vProxy[j];
      var vy = vProxy[j + 1];
      var vz = vProxy[j + 2];
      var dx = vx - cx;
      var dy = vy - cy;
      var dz = vz - cz;
      var dist = Math.sqrt(dx * dx + dy * dy + dz * dz) / radius;
      var fallOff = dist * dist;
      fallOff = 3.0 * fallOff * fallOff - 4.0 * fallOff * dist + 1.0;
      fallOff *= mAr[ind + 2] * picking.getAlpha(vx, vy, vz);



      if (useSym) {
        // Linear Blend to avoid "Bum Crease" (Bulge/Dip at center)
        // We want Weight(Primary) + Weight(Sym) = 1.0 for coincident vertices.
        // Solution: Blend based on "Side of Plane" relative to Brush Center.
        // Factor = 0.5 + 0.5 * (VertexDist * BrushSide / Radius)

        var vDist = (vx - ptPlane[0]) * nPlane[0] + (vy - ptPlane[1]) * nPlane[1] + (vz - ptPlane[2]) * nPlane[2];

        // Determine which side of the plane the BRUSH CENTER is on
        var cDist = (cx - ptPlane[0]) * nPlane[0] + (cy - ptPlane[1]) * nPlane[1] + (cz - ptPlane[2]) * nPlane[2];
        var brushSide = cDist >= 0 ? 1.0 : -1.0;

        // If Vertex is on the same side as Brush, weight > 0.5
        // If Vertex is on opposite side, weight < 0.5
        var symFactor = 0.5 + 0.5 * (vDist * brushSide / radius);
        symFactor = Math.min(Math.max(symFactor, 0.0), 1.0); // Clamp 0..1

        fallOff *= symFactor;
      }

      // Apply Rotation if present
      var rotX = 0, rotY = 0, rotZ = 0;
      if (rotQuat) {
        vTemp[0] = dx; vTemp[1] = dy; vTemp[2] = dz;
        vec3.transformQuat(vTemp, vTemp, rotQuat);
        rotX = vTemp[0] - dx;
        rotY = vTemp[1] - dy;
        rotZ = vTemp[2] - dz;
      }

      vAr[ind] += (dirx + rotX) * fallOff;
      vAr[ind + 1] += (diry + rotY) * fallOff;
      vAr[ind + 2] += (dirz + rotZ) * fallOff;
    }
  }

  updateMoveDir(picking, mouseX, mouseY, useSymmetry) {
    var mesh = this.getMesh();
    var vNear = picking.unproject(mouseX, mouseY, 0.0);
    var vFar = picking.unproject(mouseX, mouseY, 0.1);
    var matInverse = mat4.create();
    mat4.invert(matInverse, mesh.getMatrix());
    vec3.transformMat4(vNear, vNear, matInverse);
    vec3.transformMat4(vFar, vFar, matInverse);

    var moveData = useSymmetry ? this._moveDataSym : this._moveData;
    if (useSymmetry) {
      var ptPlane = mesh.getSymmetryOrigin();
      var nPlane = mesh.getSymmetryNormal();
      Geometry.mirrorPoint(vNear, ptPlane, nPlane);
      Geometry.mirrorPoint(vFar, ptPlane, nPlane);
    }

    if (this._negative) {
      var len = vec3.dist(Geometry.vertexOnLine(moveData.center, vNear, vFar), moveData.center);
      vec3.normalize(moveData.dir, picking.computePickedNormal());
      vec3.scale(moveData.dir, moveData.dir, mouseX < this._lastMouseX ? -len : len);
    } else {
      vec3.sub(moveData.dir, Geometry.vertexOnLine(moveData.center, vNear, vFar), moveData.center);
    }
    vec3.scale(moveData.dir, moveData.dir, this._intensity);

    var eyeDir = picking.getEyeDirection();
    vec3.sub(eyeDir, vFar, vNear);
    vec3.normalize(eyeDir, eyeDir);
  }

  // WebXR Support
  updateXR(picking, isPressed) {
    // Custom Move Logic:
    // Hover: Update Anchor (_lastVRPos) continuously so we are ready to drag from current pos.
    // Drag: Lock Anchor (do NOT update _lastVRPos) so we can calculate delta from start.

    const main = this._main;
    const worldPos = main._vrControllerPos;

    if (!isPressed) {
      // HOVER: Update Anchor & Visuals
      if (worldPos) {
        if (!this._lastVRPos) this._lastVRPos = vec3.create();
        vec3.copy(this._lastVRPos, worldPos);

        // Also capture rotation for 6DOF
        if (main._vrControllerQuat) quat.copy(this._lastVRQuat, main._vrControllerQuat);
      }

      // Visuals only (Cursor)
      // We need to trigger a "Hover Probe" to update picking intersection
      // SculptBase.makeStrokeXR(..., false) does exactly this.
      // But Move.js overrides makeStrokeXR... 
      // Actually Move.js overrides SCULPTStrokeXR, but relies on SculptBase.makeStrokeXR?
      // No, Move.js does NOT override makeStrokeXR. It overrides SCULPTStrokeXR.
      // So we can call super.makeStrokeXR(picking, null, false) for visuals?
      // SculptBase.makeStrokeXR(picking, pickingSym, isSculpting)

      const pickingSym = main.getSculptManager().getSymmetry() ? main.getPickingSymmetry() : null;
      // Re-use SculptBase logic for cursor update
      super.makeStrokeXR(picking, pickingSym, false);
      this.updateRender();

      return;
    }

    // DRAG: Call specific Move Logic
    // This will calculate delta from the LOCKED _lastVRPos
    this.sculptStrokeXR(picking);
  }

  sculptStrokeXR(picking) {
    // Note: this method is called ONLY when isPressed = true (via custom updateXR above)
    if (!this._lastVRPos) return; // Should be set in Hover phase

    const main = this._main;
    const currentPos = main._vrControllerPos; // Set in Scene.js processVRSculpting
    const currentQuat = main._vrControllerQuat;



    if (!currentPos || !currentQuat) return;

    // Standardized Move Logic (World -> Local)
    var mesh = this.getMesh();
    if (!mesh) return;



    var mInv = mat4.create();
    mat4.invert(mInv, mesh.getMatrix());

    // Calculate Local Space Pos Delta
    var vStartLocal = vec3.clone(this._lastVRPos);
    vec3.transformMat4(vStartLocal, vStartLocal, mInv);

    var vCurrLocal = vec3.clone(currentPos);
    vec3.transformMat4(vCurrLocal, vCurrLocal, mInv);

    // Calculate Local Space Rot Delta
    // Q_delta = Q_current * inv(Q_start)
    // But we need it in MESH LOCAL SPACE.
    // The controller rotation is in WORLD space.
    // To apply to vertices, we need the rotation relative to the mesh.
    // Actually, simple way: 
    // 1. Get Delta in World Space: dQ = Current * inv(Start)
    // 2. Transform this delta into Local Space?
    //    Or transform vectors to world, rotate, back to local?
    //    Ideally: R_local = inv(MeshRot) * R_world * MeshRot ??

    // Let's try: Get World Delta, apply to Local Vectors (transformed to world direction, rotated, back to local)
    // OR simpler:
    // Convert Controller Quats to Local Space Quats first?
    // Q_local = inv(Q_mesh) * Q_controller

    // Mesh Rotation Quat
    var qMesh = quat.create();
    mat4.getRotation(qMesh, mesh.getMatrix());
    var qMeshInv = quat.create();
    quat.invert(qMeshInv, qMesh);

    // Start Local Quat
    var qStartLocal = quat.create();
    quat.multiply(qStartLocal, qMeshInv, this._lastVRQuat);

    // Current Local Quat
    var qCurrLocal = quat.create();
    quat.multiply(qCurrLocal, qMeshInv, currentQuat);

    // Delta Local Quat
    var qDeltaLocal = quat.create();
    var qStartInv = quat.create();
    quat.invert(qStartInv, qStartLocal);
    quat.multiply(qDeltaLocal, qCurrLocal, qStartInv);


    // Apply Local Delta to Primary
    const moveData = this._moveData;

    // 1. RESTORE PHASE: Reset all affected vertices to original positions
    // We must do ALL restores before ANY moves to handle overlapping vertices correctly.
    // Move.js does NOT update _lastVRPos in sculptStrokeXR, so vStartLocal is STATIC.
    // We are calculating Total Displacement (Start -> Curr), so we MUST reset to vProxy.
    this.copyVerticesProxy(picking, moveData);

    var pickingSym = main.getPickingSymmetry();
    const useSym = main.getSculptManager().getSymmetry() && pickingSym.getMesh();
    
    if (useSym) {
      const moveDataSym = this._moveDataSym;
      if (moveDataSym.iVerts) {
        this.copyVerticesProxy(pickingSym, moveDataSym);
      }
    }

    // 2. MOVE PHASE: Apply deltas
    
    // Apply Primary Move
    if (moveData.iVerts) {
       vec3.sub(moveData.dir, vCurrLocal, vStartLocal); 
      this.move(moveData.iVerts, moveData.center, picking.getLocalRadius2(), moveData, picking, qDeltaLocal, useSym);
    }

    // Apply Symmetry Move
    if (useSym) {
        const moveDataSym = this._moveDataSym;
        if (moveDataSym.iVerts) {

          // MASTER-SLAVE SYMMETRY:
          // Instead of calculating falloff/deformation independently (which causes drift),
          // we explicitly mirror the displacement of the primary vertices to the symmetry vertices.

          const iVerts = moveData.iVerts;
          const iVertsSym = moveDataSym.iVerts;
          const nbVerts = iVerts.length;

          if (iVertsSym.length === nbVerts) {
            const vAr = mesh.getVertices();
            const vProxy = moveData.vProxy;
            // vProxy has original primary positions
            // vAr now has modified primary positions (after this.move call above)

            const ptPlane = mesh.getSymmetryOrigin();
            const nPlane = mesh.getSymmetryNormal();
            const mirrorV = [0.0, 0.0, 0.0];
            const delta = [0.0, 0.0, 0.0];
            const symProxy = moveDataSym.vProxy;

            for (let i = 0; i < nbVerts; ++i) {
              const id = iVerts[i];
              const idSym = iVertsSym[i];

              const i3 = id * 3;
              const i3Sym = idSym * 3;

              // Calculate Delta from Primary
              // vNew - vOld
              // We can't just use vAr[i3] - vProxy[i*3] because vProxy is compact array
              const j = i * 3;
              delta[0] = vAr[i3] - vProxy[j];
              delta[1] = vAr[i3 + 1] - vProxy[j + 1];
              delta[2] = vAr[i3 + 2] - vProxy[j + 2];

              // Mirror Delta
              Geometry.mirrorPoint(delta, [0, 0, 0], nPlane); // vector mirror (origin 0)

              // Construct Sym Position: SymOrigin + MirroredDelta
              // We use symProxy as the stable origin
              vAr[i3Sym] = symProxy[j] + delta[0];
              vAr[i3Sym + 1] = symProxy[j + 1] + delta[1];
              vAr[i3Sym + 2] = symProxy[j + 2] + delta[2];
            }
          } else {
          // Fallback if counts mismatch (Shouldn't happen with Topo Snap)
            // Calculate correctly mirrored delta
            var symStartLocal = vec3.clone(vStartLocal);
            var symCurrLocal = vec3.clone(vCurrLocal);

            var ptPlane = mesh.getSymmetryOrigin();
            var nPlane = mesh.getSymmetryNormal();
            Geometry.mirrorPoint(symStartLocal, ptPlane, nPlane);
            Geometry.mirrorPoint(symCurrLocal, ptPlane, nPlane);

            vec3.sub(moveDataSym.dir, symCurrLocal, symStartLocal);

            // Mirror Rotation
            var qDeltaSym = quat.clone(qDeltaLocal);
            qDeltaSym[1] = -qDeltaSym[1];    // Y Inverted
            qDeltaSym[2] = -qDeltaSym[2];    // Z Inverted

            this.move(moveDataSym.iVerts, moveDataSym.center, pickingSym.getLocalRadius2(), moveDataSym, pickingSym, qDeltaSym, useSym);
          }
        }
    }

    // FIX v0.7.492: Use the ACTUAL modified vertices for updateGeometry, not the potentially stale picking vertices
    // This ensures normals are recomputed for all vertices that were moved.
    if (moveData.iVerts) {
      mesh.updateGeometry(mesh.getFacesFromVertices(moveData.iVerts), moveData.iVerts);
    } else {
      mesh.updateGeometry(mesh.getFacesFromVertices(picking.getPickedVertices()), picking.getPickedVertices());
    }

    if (useSym) {
      const moveDataSym = this._moveDataSym;
      if (pickingSym && pickingSym.getMesh()) {
        if (moveDataSym.iVerts) {
          mesh.updateGeometry(mesh.getFacesFromVertices(moveDataSym.iVerts), moveDataSym.iVerts);
        } else {
          mesh.updateGeometry(mesh.getFacesFromVertices(pickingSym.getPickedVertices()), pickingSym.getPickedVertices());
        }
      }
    }
    this.updateRender();
  }
}

export default Move;
