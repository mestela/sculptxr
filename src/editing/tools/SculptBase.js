import Enums from '../../misc/Enums.js';
import Utils from '../../misc/Utils.js';
import Geometry from '../../math3d/Geometry.js';
import { vec3, mat4 } from 'gl-matrix';
import MeshSymmetry from '../../mesh/MeshSymmetry.js';
import Mesh from '../../mesh/Mesh.js';

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
    this._radius = 50.0;
    this._intensity = 0.5;
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

    // Is this a VR controller stroke or a Desktop mouse stroke?
    if (!main._vrSculpting) {
    // Desktop: Evaluate picking using the mouse
      if (!picking.intersectionMouseMeshes()) {
        // Fallback: pen tilt offsets the touch contact point from the hover ray by 3-15
        // device pixels. _penHoverMouseX/Y is set from the compat mousemove that fires
        // just before touchdown (within ~5px of the real contact position) and represents
        // where the hover cursor was last successfully tracking.
        const lhx = main._penHoverMouseX;
        const lhy = main._penHoverMouseY;
        const dx = lhx !== undefined ? Math.abs(lhx - main._mouseX) : Infinity;
        const dy = lhy !== undefined ? Math.abs(lhy - main._mouseY) : Infinity;
        const mx = main._mouseX, my = main._mouseY;
        if (dx < 30 && dy < 30 && picking.intersectionMouseMeshes(undefined, lhx, lhy)) {
          // pen hover fallback
        } else if (picking.intersectionMouseMeshes(undefined, mx, my, true)) {
          // Two-sided fallback: sculpting deforms the mesh and some triangles become back-facing
          // to the camera (visible with DoubleSide rendering but missed by front-face-only pick).
        } else if (dx < 30 && dy < 30 && picking.intersectionMouseMeshes(undefined, lhx, lhy, true)) {
          // backface hover fallback
        } else {
          return false;
        }
      }
    } else {
      // VR: Evaluating using the VR Ray (already computed in handleXRInput)
      if (!picking.getMesh() && !this._allowAir) {
        console.log(`[SculptBase] ABORT: VR start but no picking mesh and !allowAir`);
        return false;
      }
    }

    // [VR] Multi-select Check
    if (main._vrMultiSelect) ctrl = true;

    var mesh = null;
    if (main._lockSelection) {
      mesh = main.getMesh();
    } else {
      mesh = main.setOrUnsetMesh(picking.getMesh(), ctrl);
    }
    // console.log("[SculptBase] start called, picking mesh:", picking.getMesh(), "active mesh:", mesh);

    // [VR] Return early if Multi-select is active to prevent sculpting
    if (main._vrMultiSelect) return false;

    // If allowAir, we might proceed without a mesh selection
    if (!mesh && !this._allowAir) {
      console.log(`[SculptBase] ABORT: setOrUnsetMesh returned null and !allowAir`);
      return false;
    }

    picking.initAlpha();
    var pickingSym = main.getSculptManager().getSymmetry() ? main.getPickingSymmetry() : null;
    if (pickingSym && mesh) {
      pickingSym.intersectionMouseMesh(mesh);
      pickingSym.initAlpha();
    }

    if (mesh && mesh.isDynamic) {
      mesh._pauseWireframe = true;
    }

    // console.log("SculptBase: pushState called via start()");
    // if (window.screenLog) window.screenLog("SculptBase: Start Stroke (Push State)", "green");
    this.pushState();
    this._lastMouseX = main._mouseX;
    this._lastMouseY = main._mouseY;

    if (main._xrSession && main._vrControllerPos) {
      this._lastVRPos = vec3.clone(main._vrControllerPos);
    }

    // console.log("[SculptBase] about to call startSculpt, this is:", this.constructor.name);
    this.startSculpt();

    return true;
  }

  end() {
    var mesh = this.getMesh();
    if (mesh) {
      mesh.balanceOctree();
      if (mesh.isDynamic) {
        mesh._pauseWireframe = false;
        mesh.updateWireframeBuffer();
      }
    }
  }

  pushState() {
    var mesh = this.getMesh();
    if (!mesh) return;
    this._main.getStateManager().pushStateGeometry(mesh);
  }

  captureMeshSnapshot(mesh) {
    if (!mesh) return null;
    return {
      faces: new Uint32Array(mesh.getFaces().subarray(0, mesh.getNbFaces() * 4)),
      vertices: new Float32Array(mesh.getVertices().subarray(0, mesh.getNbVertices() * 3)),
      colors: mesh.getColors() ? new Float32Array(mesh.getColors().subarray(0, mesh.getNbVertices() * 3)) : null,
      materials: mesh.getMaterials() ? new Float32Array(mesh.getMaterials().subarray(0, mesh.getNbVertices() * 3)) : null,
      facesTexCoord: mesh.getFacesTexCoord() ? new Uint32Array(mesh.getFacesTexCoord().subarray(0, mesh.getNbFaces() * 4)) : null,
      groups: mesh.getFacesGroups() ? new Int32Array(mesh.getFacesGroups().subarray(0, mesh.getNbFaces())) : null,
      nbFaces: mesh.getNbFaces(),
      nbVertices: mesh.getNbVertices()
    };
  }

  applyMeshSnapshot(mesh, snapshot) {
    if (!mesh || !snapshot) return;
    const wasOptim = Mesh.OPTIMIZE;
    Mesh.OPTIMIZE = false;
    
    mesh.setFaces(snapshot.faces);
    mesh.setNbFaces(snapshot.nbFaces);
    mesh.setVertices(snapshot.vertices);
    mesh.setNbVertices(snapshot.nbVertices);
    
    if (snapshot.colors) {
      mesh.setColors(snapshot.colors);
    }
    if (snapshot.materials) {
      mesh.setMaterials(snapshot.materials);
    }
    if (snapshot.facesTexCoord) {
      mesh.setFacesTexCoord(snapshot.facesTexCoord);
    }
    
    mesh.allocateArrays();
    // Restore group ids after allocateArrays (which reallocates the face arrays).
    if (snapshot.groups && snapshot.groups.length === snapshot.nbFaces) {
      mesh.setFacesGroups(new Int32Array(snapshot.groups));
    }
    mesh.initTopology();

    // Clear wireframe caches to force re-computation on undo/redo!
    if (mesh._meshData) {
      mesh._meshData._drawElementsWireframe = null;
      mesh._meshData._drawArraysWireframe = null;
    }

    mesh.updateGeometry();
    mesh.updateCenter();
    if (mesh._renderData) {
      mesh.updateDuplicateColorsAndMaterials();
    }
    mesh.updateBuffers();
    
    Mesh.OPTIMIZE = wasOptim;
    mesh.initRender();
    if (typeof mesh.computeOctree === 'function') {
      mesh.computeOctree();
    }
  }

  startSculpt() {
    if (this._lockPosition === true)
      return;

    // VR Support: Initial stroke
    if (this._main._xrSession) {
      if (this.makeStrokeXR) {
        var picking = this._main.getPicking();
        var pickingSym = this._main.getSculptManager().getSymmetry() ? this._main.getPickingSymmetry() : null;
        // We defer the first stroke to updateXR so it receives proper trigger payload
        this._forceNextStroke = true;

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

    // Desktop mouse dragging freely permitted, EXCEPT when the VR controller is actively holding the trigger.
    if (main._vrSculpting) return;

    var picking = main.getPicking();
    var isSculpting = main._action === Enums.Action.SCULPT_EDIT;

    if (isSculpting && !canBeContinuous) {
      return;
    }

    if (isSculpting) {
      var mesh = this.getMesh();
      if (mesh) {
        picking.intersectionMouseMesh(mesh);
      }
    } else {
      picking.intersectionMouseMeshes();
    }

    var mesh = picking.getMesh();
    if (mesh && main.getSculptManager().getSymmetry())
      main.getPickingSymmetry().intersectionMouseMesh(mesh);
  }

  update(continuous) {
    if (this._main._vrSculpting) return;
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

    var count = Math.floor(dist / minSpacing);
    if (count < 1) count = 1;
    var step = 1.0 / count;
    dx *= step;
    dy *= step;
    var mouseX = this._lastMouseX + dx;
    var mouseY = this._lastMouseY + dy;
    
    if (this._useInitNormal) {
      this._initNormal = vec3.clone(picking.getPickedNormal());
    }

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
    if (!this.getMesh()) return;
    this.updateMeshBuffers();
    this._main.render();
  }

  // A HOVER CHANGED NOTHING, so it must not pay what a stroke pays.
  //
  // updateRender re-uploads the mesh's vertex buffers to the GPU. That is exactly right after a
  // stroke has moved vertices, and pure waste when the controller has merely moved: not one
  // value in those buffers is different. Called every frame from a tool's hover path it was the
  // single largest CPU cost in the headset - xr-tools sat at 3.3-4.8ms with the trigger not
  // pressed, while the shared hover path it wraps measured 0.04ms.
  //
  // The redraw flag still goes up, because the brush CURSOR did move and that has to reach the
  // screen. The cursor is its own object; it was never in the mesh's buffers.
  cursorRender() {
    this._main.render();
  }

  makeStroke(mouseX, mouseY, picking, pickingSym) {
    var mesh = this.getMesh();
    picking.intersectionMouseMesh(mesh, mouseX, mouseY);
    var pick1 = picking.getMesh();
    if (pick1) {
      picking.pickVerticesInSphere(picking.getLocalRadius2());
      if (this._useInitNormal) {
        vec3.copy(picking.getPickedNormal(), this._initNormal);
      } else {
        picking.computePickedNormal();
      }
    }
    // if dyn topo, we need to the picking and the sculpting altogether
    var dynTopo = mesh.isDynamic && !this._lockPosition;
    if (dynTopo && pick1)
      this.stroke(picking, false);

    var pick2;
    if (pickingSym) {
      // TOPOLOGICAL SYMMETRY SNAP
      // 1. Check if we have a valid main pick
      const pickedFace = picking.getPickedFace();
      if (pick1 && pickedFace !== -1) {
        try {
          // Get the symmetry map (Topological or Geometric Fallback)
          // Robust Fallback: Handle if getSymmetryData is missing on mesh instance
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

              // Check if mapped
              if (iv1 < symMap.length && iv2 < symMap.length && iv3 < symMap.length) {
                const mv1 = symMap[iv1];
                const mv2 = symMap[iv2];
                const mv3 = symMap[iv3];

                if (mv1 !== -1 && mv2 !== -1 && mv3 !== -1) {
                  // We have a full matching triangle!
                  // Barycentric...
                  const v1 = vAr.subarray(iv1 * 3, iv1 * 3 + 3);
                  const v2 = vAr.subarray(iv2 * 3, iv2 * 3 + 3);
                  const v3 = vAr.subarray(iv3 * 3, iv3 * 3 + 3);
                  const uvw = Geometry.barycentric(picking.getIntersectionPoint(), v1, v2, v3);

                  // Mirrored Triangle
                  const rv1 = vAr.subarray(mv1 * 3, mv1 * 3 + 3);
                  const rv2 = vAr.subarray(mv2 * 3, mv2 * 3 + 3);
                  const rv3 = vAr.subarray(mv3 * 3, mv3 * 3 + 3);

                  // Interpolate
                  const symPos = [0.0, 0.0, 0.0];
                  vec3.scaleAndAdd(symPos, symPos, rv1, uvw[0]);
                  vec3.scaleAndAdd(symPos, symPos, rv2, uvw[1]);
                  vec3.scaleAndAdd(symPos, symPos, rv3, uvw[2]);

                  // Snap pickingSym
                  pickingSym.setIntersectionPoint(symPos);
                  pickingSym._mesh = mesh; // Force hit
                  pickingSym.intersectionSphereMeshes([mesh], symPos, Math.sqrt(picking._rWorld2));
                  pick2 = pickingSym.getMesh();
                } else {
      // Fallback
                  pickingSym.intersectionMouseMesh(mesh, mouseX, mouseY);
                  pick2 = pickingSym.getMesh();
                }
              } else {
                // Index OOB? Fallback
                pickingSym.intersectionMouseMesh(mesh, mouseX, mouseY);
                pick2 = pickingSym.getMesh();
              }
            }
          } else {
            // No map
            pickingSym.intersectionMouseMesh(mesh, mouseX, mouseY);
            pick2 = pickingSym.getMesh();
          }
        } catch (e) {
          console.error("Topo Sym Mouse Error:", e);
          pickingSym.intersectionMouseMesh(mesh, mouseX, mouseY);
          pick2 = pickingSym.getMesh();
        }
      } else {
        // No main pick
        pickingSym.intersectionMouseMesh(mesh, mouseX, mouseY);
        pick2 = pickingSym.getMesh();
      }

      if (pick2) {
        pickingSym.setLocalRadius2(picking.getLocalRadius2());

        // TOPOLOGICAL VERTEX SELECTION
        var symMapUsed = false;
        if (pick1) {
          // Robust Fallback
          let symData = null;
          if (typeof mesh.getSymmetryData === 'function') {
            symData = mesh.getSymmetryData();
          } else {
            if (!mesh._symmetryData) mesh._symmetryData = new MeshSymmetry(mesh);
            symData = mesh._symmetryData;
          }
          const symMap = (symData && typeof symData.isTopo === 'function' && symData.isTopo()) ? symData.getMap() : null;
          if (symMap) {
            const mainVerts = picking.getPickedVertices();
            const newVerts = new Uint32Array(mainVerts.length);
            let acc = 0;
            for (let i = 0; i < mainVerts.length; ++i) {
              const id = mainVerts[i];
              const mid = symMap[id];
              if (mid !== -1 && mid < mesh.getNbVertices()) {
                newVerts[acc++] = mid;
              }
            }
            pickingSym._pickedVertices = newVerts.subarray(0, acc);
            symMapUsed = true;
          }
        }

        if (!symMapUsed) {
          pickingSym.pickVerticesInSphere(pickingSym.getLocalRadius2());
        }
        pickingSym.computePickedNormal();

        // FORCE SYMMETRY: Override Normal
        if (pick1) {
          var nPlane = mesh.getSymmetryNormal();
          var nMain = picking.getPickedNormal();
          var nSym = pickingSym.getPickedNormal();
          // Mirror vector: use origin [0,0,0] for plane
          vec3.copy(nSym, nMain);
          Geometry.mirrorPoint(nSym, [0, 0, 0], nPlane);
        }
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
    // Live-propagate the in-progress edit to any linked instances sharing this geometry
    // (they share _meshData, so just re-upload their buffers). end() is the catch-all for
    // tools that override this method (Paint/Masking).
    this._main.refreshLinkedSiblings?.(mesh);
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
  updateXR(picking, isPressed, origin, dir, options) {
    // FIX: Continuous Picking Update (Hover)
    // We always want to update the cursor position, even if not sculpting.
    this.sculptStrokeXR(picking, isPressed, origin, dir, options);
  }

  sculptStrokeXR(picking, isPressed, origin, dir, options) {
    var main = this._main;
    var pickingSym = main.getSculptManager().getSymmetry() ? main.getPickingSymmetry() : null;

    // Safety: Prevent sculpting if Multi-select is active
    if (main._vrMultiSelect) return;

    // Use Controller Distance (Robust like Move.js) instead of Surface Distance (Fragile)
    var worldPos = main._vrControllerPos;
    if (!worldPos || !this._lastVRPos) {
      if (worldPos) this._lastVRPos = vec3.clone(worldPos); // Init if missing
      return;
    }

    // HOVER STATE (Trigger Released)
    if (!isPressed) {
      this._vrStrokeStarted = false; // Reset VR stroke flag
      // Just update picking/cursor, no sculpting
      this.makeStrokeXR(picking, pickingSym, false, origin, dir, options);
      this._lastVRPos = vec3.clone(worldPos); // Keep sync
      this.updateRender();
      return;
    }

    // SCULPTING STATE (Trigger Pressed)
    if (!this._vrStrokeStarted) {
      this._vrStrokeStarted = true;
      this.pushState(); // Pushes StateGeometry or StateDynamic
      console.log("[SculptBase] VR Stroke Start: Pushed State");
    }

    var dist = vec3.dist(worldPos, this._lastVRPos);

    // PACING FIX: If using Aim (Raycast) mode rather than Volume intersect, the physical controller 
    // position might barely move (e.g. wrist rotation), but the laser sweeps across the distant surface.
    // We should compute the distance traveled on the mesh surface instead to permit continuous strokes.
    if (!main._vrUseVolumeIntersect && picking.getMesh() && this._lastInter) {
      var inter = picking.getIntersectionPoint();
      if (inter) {
        // Distance in world space across the surface of the mesh
        dist = vec3.dist(inter, this._lastInter) * picking.getMesh().getScale();
      }
    }

    var rWorld = Math.sqrt(picking._rWorld2);
    if (rWorld < 1e-5) rWorld = main._vrLastPickingRadius || 0.05; // Fallback if previous frame missed

    var spacingFactor = (typeof window._vrStrokeSpacing === 'number') ? window._vrStrokeSpacing : 0.02;
    var minSpacing = spacingFactor * rWorld;
    if (minSpacing < 0.001) minSpacing = 0.001; // Safety minimum

    // FRAMERATE INVARIANCE: apply the stroke per unit of controller/surface travel, not
    // once per frame. This gate was previously disabled, so holding the trigger stamped the
    // brush every frame -> at 90fps strokes accumulated ~3x faster than at 30fps (crease
    // spikes on press, runaway ridges, generally too-strong VR deformation). _lastVRPos is
    // only advanced when we actually apply (below), so distance accumulates across skipped
    // frames; the first stroke of a press still fires via _forceNextStroke. The default
    // spacing (0.02 * worldRadius) is very fine, so moving strokes stay smooth — only the
    // at-rest over-accumulation is removed. window._vrStrokeThrottle = false restores the
    // old per-frame behavior for A/B comparison.
    if (window._vrStrokeThrottle !== false && dist <= minSpacing && !this._forceNextStroke) {
      return;
    }

    this._forceNextStroke = false;


    // Using the picking state already found in processVRSculpting


    this.makeStrokeXR(picking, pickingSym, true, origin, dir, options);

    // Restore actual controller pos
    vec3.copy(this._lastVRPos, worldPos);
    vec3.copy(main._vrControllerPos, worldPos);

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

  makeStrokeXR(picking, pickingSym, isSculpting, origin, dir, options) {
    // Split out of xr-tools: this is the shared hover/stroke path every tool runs per frame,
    // so it separates "what all tools do" from "what THIS tool does" — and xr-tools at 3.3 to
    // 4.8ms with the trigger not pressed is mostly hover work by definition.
    this._main._mark?.('tool-hover');
    try {
      return this._makeStrokeXRInner(picking, pickingSym, isSculpting, origin, dir, options);
    } finally {
      this._main._mark?.('xr-tools');
    }
  }

  _makeStrokeXRInner(picking, pickingSym, isSculpting, origin, dir, options) {
    var pick1 = null;
    var pick2 = null;

    // Store the precise trigger float provided by Scene.js so tools can optionally modulate their strength
    if (options && options.triggerValue !== undefined) {
      this._lastTriggerValue = options.triggerValue;
    } else {
      this._lastTriggerValue = isSculpting ? 1.0 : 0.0;
    }

    var mesh = this.getMesh();
    if (!mesh) return;
    // picking is already updated by handleXRInput

    var pick1 = picking.getMesh();
    if (pick1) {
      if (isSculpting) {
        picking.pickVerticesInSphere(picking.getLocalRadius2());
      }

      picking.computePickedNormal();
    }


    var pick2;

    // Symmetry Logic for Generic Tools
    if (pickingSym && this._main.getSculptManager().getSymmetry()) {
      const main = this._main;
      if (main._vrControllerPos) {
        // Parent-aware model-space matrix (== getMatrix unparented) so the
        // world<->local symmetry conversion is correct for a parented child.
        var _mm = mesh.getModelSpaceMatrix();

        // Mirror World Pos
        var worldPos = vec3.clone(main._vrControllerPos);

        // If using Aim Mode, the true 'position' is the intersection point, not the controller
        if (!main._vrUseVolumeIntersect && picking.getMesh()) {
          vec3.transformMat4(worldPos, picking.getIntersectionPoint(), _mm);
        }

        var matInv = mat4.create();
        mat4.invert(matInv, _mm);

        // World -> Local
        var localPos = vec3.create();
        vec3.transformMat4(localPos, worldPos, matInv);

        // Correct Symmetry Mirroring (Local Space)
        var ptPlane = mesh.getSymmetryOrigin(); // Local Space
        var nPlane = mesh.getSymmetryNormal();  // Local Space
        Geometry.mirrorPoint(localPos, ptPlane, nPlane);

        // Local -> World
        var symWorldPos = vec3.create();
        vec3.transformMat4(symWorldPos, localPos, _mm);

        // LOGGING FOR DIRECTION SKEW AND LAG
        if (!this._lastWorldPos_Dbg) this._lastWorldPos_Dbg = vec3.clone(worldPos);
        if (!this._lastSymWorldPos_Dbg) this._lastSymWorldPos_Dbg = vec3.clone(symWorldPos);

        var deltaMain = vec3.sub(vec3.create(), worldPos, this._lastWorldPos_Dbg);
        var deltaSym = vec3.sub(vec3.create(), symWorldPos, this._lastSymWorldPos_Dbg);

        if (this._main._logThrottle % 15 === 0) {
          // Removed SymmetryAngle logging
          var lenM = vec3.len(deltaMain);
          var lenS = vec3.len(deltaSym);
          var meshScale = mesh.getScale();
          if (lenM > 0.0001) {
            // Logs removed
          }
        }

        vec3.copy(this._lastWorldPos_Dbg, worldPos);
        vec3.copy(this._lastSymWorldPos_Dbg, symWorldPos);

        // LOGGING
        // if (window.screenLog && Math.random() < 0.05) {
        //   window.screenLog(`Sym Check: Pos=${worldPos[0].toFixed(2)} Sym=${symWorldPos[0].toFixed(2)}`, "yellow");
        // }

        // Intersection
        var rWorld = Math.sqrt(picking._rWorld2);
        // FIX v0.6.4: Unit-Corrected Cap (5cm Physical)
        const vrScale = this._main._vrScale || 1.0;
        const invScale = 1.0 / vrScale;
        const MAX_SEARCH_METERS = 0.15; // 15cm
        const MAX_SEARCH_RADIUS = MAX_SEARCH_METERS * invScale;

        const searchRadius = Math.min(rWorld * 4.0, MAX_SEARCH_RADIUS);

        // TOPOLOGICAL SYMMETRY SNAP (VR)
        let snapped = false;
        try {
          if (pick1 && picking.getPickedFace() !== -1) {
            // Robust Fallback
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
              const iFace = picking.getPickedFace() * 4;

              // GUARD: Index out of bounds
              if (iFace < 0 || iFace + 3 >= fAr.length) throw new Error("Face index OOB");

              const iv1 = fAr[iFace];
              const iv2 = fAr[iFace + 1];
              const iv3 = fAr[iFace + 2];

              // GUARD: Vertex index OOB
              if (iv1 >= symMap.length || iv2 >= symMap.length || iv3 >= symMap.length) throw new Error("Vertex index OOB");

              const mv1 = symMap[iv1];
              const mv2 = symMap[iv2];
              const mv3 = symMap[iv3];

              if (mv1 !== -1 && mv2 !== -1 && mv3 !== -1) {
                // We have a full matching triangle!
                // Barycentric...
                const v1 = vAr.subarray(iv1 * 3, iv1 * 3 + 3);
                const v2 = vAr.subarray(iv2 * 3, iv2 * 3 + 3);
                const v3 = vAr.subarray(iv3 * 3, iv3 * 3 + 3);
                const uvw = Geometry.barycentric(picking.getIntersectionPoint(), v1, v2, v3);

                // Mirrored Triangle
                const rv1 = vAr.subarray(mv1 * 3, mv1 * 3 + 3);
                const rv2 = vAr.subarray(mv2 * 3, mv2 * 3 + 3);
                const rv3 = vAr.subarray(mv3 * 3, mv3 * 3 + 3);

                // Interpolate
                const symPos = [0.0, 0.0, 0.0];
                vec3.scaleAndAdd(symPos, symPos, rv1, uvw[0]);
                vec3.scaleAndAdd(symPos, symPos, rv2, uvw[1]);
                vec3.scaleAndAdd(symPos, symPos, rv3, uvw[2]);

                // Snap pickingSym directly using the Local mapped coordinate
                pickingSym.setIntersectionPoint(symPos);
                pickingSym._mesh = mesh; // Force hit

                // CRITICAL FIX: Bypass the geometric collision sphere on a perfect topological snap.
                // Re-use the exactly calculated physics radiuses from the main brush
                pickingSym._rWorld2 = picking._rWorld2;
                pickingSym._rLocal2 = picking._rLocal2;

                snapped = true;
              }
            }
          }
        } catch (e) {
          console.error("Topo Sym Error:", e);
        }

        let symData = null;
        if (typeof mesh.getSymmetryData === 'function') {
          symData = mesh.getSymmetryData();
        } else {
          if (!mesh._symmetryData) mesh._symmetryData = new MeshSymmetry(mesh);
          symData = mesh._symmetryData;
        }

        if (!snapped) {
          // PURE SPATIAL MIRRORING!
          const perfectB = vec3.create();
          vec3.copy(perfectB, picking.getIntersectionPoint());
          Geometry.mirrorPoint(perfectB, ptPlane, nPlane);
          
          pickingSym.setIntersectionPoint(perfectB);
          pickingSym._mesh = mesh; // Force hit
          pickingSym.setLocalRadius2(picking.getLocalRadius2());
        }

        if (pickingSym.getMesh()) {
          pickingSym.setLocalRadius2(picking.getLocalRadius2());

          var symMapUsed = false;
          if (isSculpting && pick1) {
            // Robust Fallback
            let symData = null;
            if (typeof mesh.getSymmetryData === 'function') {
              symData = mesh.getSymmetryData();
            } else {
              if (!mesh._symmetryData) mesh._symmetryData = new MeshSymmetry(mesh);
              symData = mesh._symmetryData;
            }
            const symMap = (symData && typeof symData.isTopo === 'function' && symData.isTopo()) ? symData.getMap() : null;

            if (symMap) {
              const mainVerts = picking.getPickedVertices();
              const newVerts = new Uint32Array(mainVerts.length);
              let acc = 0;
              const sculptFlag = Utils.SCULPT_FLAG;
              const vscf = mesh.getVerticesSculptFlags();

              for (let i = 0; i < mainVerts.length; ++i) {
                const id = mainVerts[i];
                const mid = symMap[id];
                if (mid !== -1) {
                  newVerts[acc++] = mid;
                  vscf[mid] = sculptFlag; // Mark it!
                }
              }
              pickingSym._pickedVertices = newVerts.subarray(0, acc);
              symMapUsed = true;
            }

          }

          if (isSculpting && !symMapUsed) {
            pickingSym.pickVerticesInSphere(pickingSym.getLocalRadius2());
          }
          pickingSym.computePickedNormal();

          // FIX v0.6.44: Normal Consistency Check
          // Only accept symmetry pick if its normal matches the mirrored main normal.
          // This prevents "locking" onto backfaces/cliffs without needing camera info.
          if (pick1) {
            const nMain = picking.getPickedNormal(); // Local Normal
            const nSym = pickingSym.getPickedNormal(); // Local Normal

            // FORCE SYMMETRY: Override Normal with Perfect Mirror
            // This fixes "Drift" by ensuring strokes always converge/diverge exactly as expected
            vec3.copy(nSym, nMain);
            Geometry.mirrorPoint(nSym, [0, 0, 0], nPlane);

            // We accept pick2 with the forced normal.
            pick2 = pickingSym.getMesh();

          } else {
            // If main brush didn't hit, we can't compare.
            // Allow symmetry to work alone.
            pick2 = pickingSym.getMesh();
          }
        }
      }
    }


    // FIX v0.6.49: Force "Surface-Relative" Culling
    // In VR, we lack a valid Camera EyeDir relative to the surface.
    // By setting EyeDir to the NEGATIVE PickedNormal, we tell getFrontVertices() to cull
    // everything "behind" the tangent plane of the stroke.
    // This prevents backface drift for BOTH Main and Symmetry brushes.

    var dynTopo = mesh.isDynamic && !this._lockPosition;

    if (isSculpting && pick1) {
      if (dynTopo) {
        this.stroke(picking, false);
      } else {
        // Main Brush: Use NEGATIVE Normal (pointing INTO surface) to keep front faces
        var nMain = picking.getPickedNormal();
        vec3.negate(picking.getEyeDirection(), nMain); 
        
        // Map iVertsFront for perfect symmetry
        var mainVerts = picking.getPickedVertices();
        var mainFront = this.getFrontVertices(mainVerts, picking.getEyeDirection());
        picking._pickedVerticesFront = mainFront;

        // Compute main aNormal and store it
        picking._aNormal = this.areaNormal(mainFront);

        this.stroke(picking, false);
      }
    }
    if (isSculpting && pick2) {
      // Symmetry Brush: Use NEGATIVE Normal (pointing INTO surface)
      var nSym = pickingSym.getPickedNormal();
      vec3.negate(pickingSym.getEyeDirection(), nSym);

      // Map mainFront to symFront!
      let symData = null;
      if (typeof mesh.getSymmetryData === 'function') {
        symData = mesh.getSymmetryData();
      } else {
        if (!mesh._symmetryData) mesh._symmetryData = new MeshSymmetry(mesh);
        symData = mesh._symmetryData;
      }
      const symMap = (symData && typeof symData.isTopo === 'function' && symData.isTopo()) ? symData.getMap() : null;

      if (picking._pickedVerticesFront && symMap) {
        const mainFront = picking._pickedVerticesFront;
        const symFront = new Uint32Array(mainFront.length);
        let acc = 0;
        for (let i = 0; i < mainFront.length; ++i) {
          const mid = symMap[mainFront[i]];
          if (mid !== -1) symFront[acc++] = mid;
        }
        pickingSym._pickedVerticesFront = symFront.subarray(0, acc);
      }

      // MIRROR aNormal DIRECTLY (Like Drag.js)
      if (picking._aNormal) {
        const symANormal = vec3.clone(picking._aNormal);
        Geometry.mirrorPoint(symANormal, [0, 0, 0], mesh.getSymmetryNormal());
        pickingSym._aNormal = symANormal;
      }

      this.stroke(pickingSym, true);
    }


    return pick1 || pick2;
  }

  /** Return the vertices that point toward the camera (or surface normal in VR) */
  getFrontVertices(iVertsInRadius, eyeDir) {
    var nbVertsSelected = iVertsInRadius.length;
    var iVertsFront = new Uint32Array(Utils.getMemory(4 * nbVertsSelected), 0, nbVertsSelected);
    var acc = 0;
    var nAr = this.getMesh().getNormals();
    if (!nAr) {
      // Fallback: No normals, no culling
      return iVertsInRadius;
    }

    // FIX v0.6.46: View-Independent Culling for VR
    // In VR, "eyeDir" is unreliable/irrelevant. We should cull backfaces relative to the SURFACE NORMAL.
    // However, getFrontVertices is generic. We need to check if we are in VR or if eyeDir is [0,0,0].
    // Actually, Picking.js sets eyeDir to [0,0,0] by default in VR currently.
    // If eyeDir is approx zero, or if we want to force Surface-Based Culling, we use Picked Normal.

    var useSurfaceNormal = false;
    if (this._main._xrSession) {
      useSurfaceNormal = true;
    }

    var eyeX = eyeDir[0];
    var eyeY = eyeDir[1];
    var eyeZ = eyeDir[2];

    if (useSurfaceNormal) {
      // We want to cull vertices that face AWAY from the brush direction.
      // The "Brush Direction" is effectively -PickedNormal (pushing into surface).
      // So we want vertices where Normal dot PickedNormal > 0.
      // Wait, eyeDir points FROM surface TO camera.
      // So backface culling keeps faces where Normal dot EyeDir > 0.
      // If we assume the "Virtual Eye" is infinitely far along the Normal, then EyeDir = PickedNormal.
      // So we just use PickedNormal as EyeDir.
      // BUT, we need to access the picking object to get PickedNormal!
      // getFrontVertices doesn't take 'picking' as arg, only eyeDir.
      // We can patch 'eyeDir' before calling this function, OR we can try to guess it here.
      // Better: Patch 'eyeDir' in the CALLER (stroke method) or SCULPTBASE (makeStroke).

      // actually, let's look at Brush.js. It calls:
      // var iVertsFront = this.getFrontVertices(iVertsInRadius, picking.getEyeDirection());

      // So we should fix Picking.getEyeDirection() to return PickedNormal in VR!
      // But picking.getEyeDirection is just a getter for _eyeDir.

      // Let's modify Brush.js instead? No, SculptBase is better.
      // Actually, let's just make getFrontVertices robust.
      // If eyeDir is zero, we can't cull.

      if (Math.abs(eyeX) < 1e-6 && Math.abs(eyeY) < 1e-6 && Math.abs(eyeZ) < 1e-6) {
        // EyeDir is zero (VR default).
        // We can't access picked normal here easily without passing 'picking'.
        // Let's just return ALL vertices (disable culling) to prevent "Disabled Stroke" bug.
        // This re-enables strokes but doesn't fix drift (backfaces included).
        // TO PROPERLY FIX DRIFT: We need to pass the Picking object or Normal to getFrontVertices.
        return iVertsInRadius; // Temporary fallback
      }
    }

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

  // Read a controller face button, for any tool that binds one (4 = A/X, 5 = B/Y).
  // Lives HERE rather than on one tool because three now bind buttons, and a second
  // copy is how the two halves drift apart.
  //
  // Reads the options first, then falls back to the LIVE SESSION. A face button is global
  // device state — it is not aimed at anything and does not depend on which code path
  // happened to call the tool this frame — but the value was arriving only through the
  // options object, so any caller that passed a thinner one silently disabled the binding.
  // That has now caused the same "A works, then doesn't" report twice, and the menu-guard
  // path (which passed no controllers at all until v3.18.14) turns out to be the NORMAL case
  // rather than a rare one: the pointing-at-menu flag is sticky and reads true almost
  // permanently. Rather than audit every call site for a good options object, ask the device.
  //
  // The fallback also covers a handedness mismatch: if the options carry controllers but none
  // matches the hand being processed, the loop falls through to the session rather than
  // reporting "not pressed".
 
  _readButton(options, index) {
    const hand = (options && options.handedness) || this._main._dominantHand;
    const ctrls = options && options.controllers;
    if (ctrls) {
      for (let i = 0; i < ctrls.length; i++) {
        const c = ctrls[i];
        if (c.handedness === hand && c.buttons && c.buttons[index]) {
          return !!c.buttons[index].pressed;
        }
      }
    }
    const session = this._main._xrSession;
    if (session && session.inputSources) {
      for (const src of session.inputSources) {
        if (src.handedness === hand && src.gamepad && src.gamepad.buttons
            && src.gamepad.buttons[index]) {
          return !!src.gamepad.buttons[index].pressed;
        }
      }
    }
    return false;
  }

  postRender(selection) {
    selection.render(this._main);
  }

  addSculptToScene() { }

  getScreenRadius() {
    return (this._radius || 1) * this._main.getPixelRatio();
  }
}

export default SculptBase;
