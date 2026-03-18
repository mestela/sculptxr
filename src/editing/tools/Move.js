import { vec3, mat4, quat } from 'gl-matrix';
import Geometry from '../../math3d/Geometry.js';
import SculptBase from './SculptBase.js';
import MeshSymmetry from '../../mesh/MeshSymmetry.js';
import Enums from '../../misc/Enums.js';

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
    
    // VR Safety: If the current frame did not hit a mesh, do NOT fall back to a previous stroke's mesh!
    if (main._xrSession && !picking.getMesh()) {
      return;
    }

    var mesh = this.getMesh();
    if (!mesh) return;
    console.log(`[Move] startSculpt called. TopoCheck=${this._topoCheck}`);
    this.initMoveData(picking, this._moveData);
    console.log(`[Move] Primary Vertices Picked: ${picking.getPickedVertices() ? picking.getPickedVertices().length : 0}`);



    if (main.getSculptManager().getSymmetry()) {
      var pickingSym = main.getPickingSymmetry();
      var mesh = this.getMesh();
      
      // VR Symmetry Init
      if (main._xrSession && main._vrControllerPos && mesh && picking._isVRHit) {
        // Use proper symmetry mathematics on the LOCAL intersection point
        var localPos = vec3.clone(picking.getIntersectionPoint());
        var ptPlane = mesh.getSymmetryOrigin();
        var nPlane = mesh.getSymmetryNormal();
        Geometry.mirrorPoint(localPos, ptPlane, nPlane);

        // Convert mirrored point back to World space for the intersection sphere test
        var worldPos = vec3.clone(localPos);
        vec3.transformMat4(worldPos, worldPos, mesh.getMatrix());
          
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
          // TOPOLOGICAL SYMMETRY SNAP (Restored from SculptBase)
          let snapped = false;
          const pickedFace = picking.getPickedFace();
          if (pickedFace !== -1) {
            try {
              let symData = null;
              if (typeof mesh.getSymmetryData === 'function') {
                symData = mesh.getSymmetryData();
              } else {
                if (!mesh._symmetryData) mesh._symmetryData = new MeshSymmetry(mesh);
                symData = mesh._symmetryData;
              }
              const symMap = (symData && typeof symData.isTopo === 'function' && symData.isTopo()) ? symData.getMap() : null;

              if (symMap) {
                const fAr = mesh.getFaces();
                const vAr = mesh.getVertices();
                const iFace = pickedFace * 4;

                if (iFace >= 0 && iFace + 3 < fAr.length) {
                  const iv1 = fAr[iFace];
                  const iv2 = fAr[iFace + 1];
                  const iv3 = fAr[iFace + 2];

                  if (iv1 < symMap.length && iv2 < symMap.length && iv3 < symMap.length) {
                    const mv1 = symMap[iv1];
                    const mv2 = symMap[iv2];
                    const mv3 = symMap[iv3];

                    if (mv1 !== -1 && mv2 !== -1 && mv3 !== -1) {
                      const v1 = vAr.subarray(iv1 * 3, iv1 * 3 + 3);
                      const v2 = vAr.subarray(iv2 * 3, iv2 * 3 + 3);
                      const v3 = vAr.subarray(iv3 * 3, iv3 * 3 + 3);
                      const uvw = Geometry.barycentric(picking.getIntersectionPoint(), v1, v2, v3);

                      const rv1 = vAr.subarray(mv1 * 3, mv1 * 3 + 3);
                      const rv2 = vAr.subarray(mv2 * 3, mv2 * 3 + 3);
                      const rv3 = vAr.subarray(mv3 * 3, mv3 * 3 + 3);

                      const symPos = [0.0, 0.0, 0.0];
                      vec3.scaleAndAdd(symPos, symPos, rv1, uvw[0]);
                      vec3.scaleAndAdd(symPos, symPos, rv2, uvw[1]);
                      vec3.scaleAndAdd(symPos, symPos, rv3, uvw[2]);

                      pickingSym.setIntersectionPoint(symPos);
                      pickingSym._mesh = mesh; // Force hit
                      pickingSym.intersectionSphereMeshes([mesh], symPos, picking.getWorldRadius());
                      snapped = true;
                    }
                  }
                }
              }
            } catch (e) {
              console.warn("Move.js Topological Snap Failed", e);
            }
          }

          // If we successfully computed the topological symmetric position, proceed even if the
          // microscopic sphere hit validation failed due to severe camera offsets in 6DOF.
          if (pickingSym.getMesh() || snapped) {
            if (snapped && symMap) {
              // TOPOLOGICAL VERTEX SELECTION: Map exactly
              const mainVerts = picking.getPickedVertices();
              const newVerts = new Uint32Array(mainVerts.length);
              let acc = 0;
              for (let i = 0; i < mainVerts.length; ++i) {
                const id = mainVerts[i];
                const mid = symMap[id];
                if (mid !== -1) newVerts[acc++] = mid;
              }
              pickingSym._pickedVertices = newVerts.subarray(0, acc);
              pickingSym.setLocalRadius2(picking.getLocalRadius2());

              // Skip initMoveData to avoid overwriting _pickedVertices with pickVerticesInSphereTopological (which requires `_pickedFace`)
              vec3.copy(this._moveDataSym.center, pickingSym.getIntersectionPoint());
              this._moveDataSym.iVerts = new Uint32Array(pickingSym._pickedVertices);
              this._main.getStateManager().pushVertices(pickingSym._pickedVertices);

              var nbVerts = pickingSym._pickedVertices.length;
              var vProxy = this._moveDataSym.vProxy = new Float32Array(nbVerts * 3);
              for (var i = 0; i < nbVerts; ++i) {
                var ind = pickingSym._pickedVertices[i] * 3;
                var j = i * 3;
                vProxy[j] = vAr[ind];
                vProxy[j + 1] = vAr[ind + 1];
                vProxy[j + 2] = vAr[ind + 2];
              }

              this._moveDataSym.radius2 = pickingSym.getLocalRadius2();

            } else {
              if (main._xrSession) {
                // VR: Use Geometric Sphere Pick using symPos
                const symPos = [0.0, 0.0, 0.0];
                const ptPlane = mesh.getSymmetryOrigin();
                const nPlane = mesh.getSymmetryNormal();
                vec3.copy(symPos, picking.getIntersectionPoint());
                Geometry.mirrorPoint(symPos, ptPlane, nPlane);

                pickingSym.setIntersectionPoint(symPos);
                pickingSym.intersectionSphereMeshes([mesh], symPos, picking.getWorldRadius());
                
                // FORCE fallback if geometric check misses (tip in thin air)
                if (!pickingSym.getMesh()) {
                  pickingSym._mesh = mesh;
                  // console.log("[Move.js] Forced symmetric fallback on failure");
                }
              } else {
                if (!snapped) {
                  pickingSym.intersectionMouseMesh(mesh);
                }
              }
              
              pickingSym.setLocalRadius2(picking.getLocalRadius2());
              this.initMoveData(pickingSym, this._moveDataSym);
            }
          } else {
            console.log("[Move.js startSculpt] ABORT: pickingSym.getMesh() is falsy. snapped=", snapped);
          }
        }
      }
    }

    // [VR] Capture Initial Rotation
    if (main._xrSession && main._vrControllerQuat) {
      quat.copy(this._lastVRQuat, main._vrControllerQuat);
    }
  }

  end() {
    super.end();
    
    var main = this._main;
    var mesh = this.getMesh();
    if (!mesh) return;

    // FIX: Rebuild Octree completely after Move stroke. 
    // balanceOctree only splits dense cells, but doesn't move faces if they were dragged far away.
    // computeOctree rebuilds everything from scratch, which takes a few milliseconds but fixes raycasting!
    if (typeof mesh.computeOctree === 'function') {
      mesh.computeOctree();
    }

    var voxelTool = main.getSculptManager().getTool(Enums.Tools.VOXEL);
    if (voxelTool && voxelTool._voxelMesh === mesh && voxelTool._worker) {
      
      if (this._moveData.dir && (vec3.sqrLen(this._moveData.dir) > 0 || (this._moveData.quat && !quat.equals(this._moveData.quat, quat.create())))) {
        voxelTool._worker.postMessage({
          type: 'WARP_SPHERE',
          center: this._moveData.center,
          radius: Math.sqrt(this._moveData.radius2),
          translation: this._moveData.dir,
          rotation: this._moveData.quat
        });
      }

      var useSym = main.getSculptManager().getSymmetry() && this._moveDataSym && this._moveDataSym.center;
      if (useSym) {
        if (this._moveDataSym.dir && (vec3.sqrLen(this._moveDataSym.dir) > 0 || (this._moveDataSym.quat && !quat.equals(this._moveDataSym.quat, quat.create())))) {
          voxelTool._worker.postMessage({
            type: 'WARP_SPHERE',
            center: this._moveDataSym.center,
            radius: Math.sqrt(this._moveDataSym.radius2),
            translation: this._moveDataSym.dir,
            rotation: this._moveDataSym.quat
          });
        }
      }
      
      voxelTool._worker.postMessage({ type: 'GET_MESH' });
    }
  }

  initMoveData(picking, moveData) {
    if (this._topoCheck)
      picking.pickVerticesInSphereTopological(picking.getLocalRadius2());
    else
      picking.pickVerticesInSphere(picking.getLocalRadius2());

    moveData.radius2 = picking.getLocalRadius2();
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
    if (!moveData.vProxy) return;
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
    if (!this.getMesh()) return;
    var main = this._main;
    var picking = main.getPicking();
    var pickingSym = main.getPickingSymmetry();
    var useSym = main.getSculptManager().getSymmetry() && pickingSym.getMesh();

    // CRITICAL BUG FIX: Do NOT update Alpha or IdAlpha during the Move stroke!
    // Move.js relies on a statically cached chunk of vertices (vProxy).
    // If we update the alpha projection matrix to follow the mouse, the static
    // vertices fall out of the bounding box and get culled (hard edge).
    // SculptManager.start() already initialized perfect alpha masks at mouse-down.

    this.copyVerticesProxy(picking, this._moveData);
    if (useSym)
      this.copyVerticesProxy(pickingSym, this._moveDataSym);

    var mouseX = main._mouseX;
    var mouseY = main._mouseY;
    this.updateMoveDir(picking, mouseX, mouseY);

    // CRITICAL BUG FIX (Desktop Hard Edges): Use strictly the starting vertices and center, identical to VR
    var r2 = this._moveData.radius2 || picking.getLocalRadius2();
    if (this._moveData.quat) quat.identity(this._moveData.quat); // Clear VR Twist
    this.move(this._moveData.iVerts, this._moveData.center, r2, this._moveData, picking, null, useSym);

    if (useSym) {
      this.updateMoveDir(pickingSym, mouseX, mouseY, true);
      var r2Sym = this._moveDataSym.radius2 || pickingSym.getLocalRadius2();
      if (this._moveDataSym.quat) quat.identity(this._moveDataSym.quat); // Clear VR Twist
      this.move(this._moveDataSym.iVerts, this._moveDataSym.center, r2Sym, this._moveDataSym, pickingSym, null, useSym);
    }

    var mesh = this.getMesh();
    var mesh = this.getMesh();
    // FIX v0.7.492: Use moveData.iVerts for proper normal updates
    if (this._moveData.iVerts) {
      mesh.updateGeometry(mesh.getFacesFromVertices(this._moveData.iVerts), this._moveData.iVerts);
    }

    if (useSym) {
      if (this._moveDataSym.iVerts) {
        mesh.updateGeometry(mesh.getFacesFromVertices(this._moveDataSym.iVerts), this._moveDataSym.iVerts);
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
      var alphaVal = picking.getAlpha(vx, vy, vz);
      fallOff *= mAr[ind + 2] * alphaVal;






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
    
    // Scale Rotation by Intensity
    var qIdentity = quat.create();
    var qScaledLocal = quat.create();
    quat.slerp(qScaledLocal, qIdentity, qDeltaLocal, this._intensity);

    // Apply Primary Move
    if (!moveData.iVerts || !moveData.vProxy || moveData.vProxy.length === 0) {
      console.error("[Move Tool] Aborting move stroke. Missing iVerts or vProxy in primary moveData.");
      return;
    }
    if (moveData.iVerts) {
       vec3.sub(moveData.dir, vCurrLocal, vStartLocal); 
      vec3.scale(moveData.dir, moveData.dir, this._intensity);
      
      // Store final quat for Voxel Worker
      if (!moveData.quat) moveData.quat = quat.create();
      quat.copy(moveData.quat, qScaledLocal);
      
      this.move(moveData.iVerts, moveData.center, picking.getLocalRadius2(), moveData, picking, qScaledLocal, useSym);
    }

    // Apply Symmetry Move
    if (useSym) {
        const moveDataSym = this._moveDataSym;
        if (moveDataSym.iVerts) {
          // Dual Independent Evaluation (Vanilla behavior)
            var symStartLocal = vec3.clone(vStartLocal);
            var symCurrLocal = vec3.clone(vCurrLocal);

            var ptPlane = mesh.getSymmetryOrigin();
            var nPlane = mesh.getSymmetryNormal();
            Geometry.mirrorPoint(symStartLocal, ptPlane, nPlane);
            Geometry.mirrorPoint(symCurrLocal, ptPlane, nPlane);

            vec3.sub(moveDataSym.dir, symCurrLocal, symStartLocal);
          vec3.scale(moveDataSym.dir, moveDataSym.dir, this._intensity);

            // Mirror Rotation
          var qDeltaSym = quat.clone(qScaledLocal);
            qDeltaSym[1] = -qDeltaSym[1];    // Y Inverted
            qDeltaSym[2] = -qDeltaSym[2];    // Z Inverted

          // Store final quat for Voxel Worker
          if (!moveDataSym.quat) moveDataSym.quat = quat.create();
          quat.copy(moveDataSym.quat, qDeltaSym);

          this.move(moveDataSym.iVerts, moveDataSym.center, pickingSym.getLocalRadius2(), moveDataSym, pickingSym, qDeltaSym, useSym);
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
