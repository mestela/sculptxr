import Selection from '../drawables/Selection.js';
import getOptionsURL from '../misc/getOptionsURL.js';
import Tools from './tools/Tools.js';
import Enums from '../misc/Enums.js';
import HoleFilling from './HoleFilling.js';
import Utils from '../misc/Utils.js';
import Remesh from './Remesh.js';
import Mesh from '../mesh/Mesh.js';
import MeshStatic from '../mesh/meshStatic/MeshStatic.js';


class SculptManager {

  constructor(main) {
    this._main = main;

    this._toolIndex = Enums.Tools.BRUSH;
    this._tools = []; // the sculpting tools

    // symmetry stuffs
    this._symmetry = true; // if symmetric sculpting is enabled  

    // continuous stuffs
    this._continuous = false; // continuous sculpting
    this._sculptTimer = -1; // continuous interval timer
    this._strokeActive = false; // true between a successful start() and its end()

    this._selection = new Selection(main._gl); // the selection geometry (red hover circle)
    
    this._isProcessingQuads = false;
    this._quadRemeshTimeout = null;

    this.init();
  }

  // Hide both transform gizmo groups (Transform → Gizmo.js, TransformVR → GizmoVR.js).
  _hideTransformGizmos() {
    const a = this.getTool(Enums.Tools.TRANSFORM)?._gizmo?._group;
    const b = this.getTool(Enums.Tools.TRANSFORM_VR)?._gizmo?._group;
    if (a) a.visible = false;
    if (b) b.visible = false;
  }

  setToolIndex(id) {
    const oldTool = this.getCurrentTool();
    if (oldTool && oldTool.clearPreview) {
      oldTool.clearPreview();
    }

    // Route both transform variants to the right tool for the current context.
    // Transform (13) has desktop mouse interaction; TransformVR (16) has controller interaction.
    if (id === Enums.Tools.TRANSFORM || id === Enums.Tools.TRANSFORM_VR) {
      const isVR = this._main && this._main._renderer &&
                   this._main._renderer.xr && this._main._renderer.xr.isPresenting;
      id = isVR ? Enums.Tools.TRANSFORM_VR : Enums.Tools.TRANSFORM;
    }

    this._toolIndex = id;

    // Tool switch: hide BOTH transform gizmos so a deselected one can't linger (the
    // gizmos only ever turn themselves on). The active transform tool re-shows its
    // own each frame (desktop: postRender; VR: TransformVR.updateXR). Runs in both
    // platforms, so it also clears a stale desktop gizmo when entering VR.
    this._hideTransformGizmos();

    // Low-poly / topology edit tools (DELETE_FACE..INSET) auto-show wireframe so
    // you can see the edges you're editing; restore the prior state on leaving.
    {
      const isLowPoly = id >= Enums.Tools.DELETE_FACE && id <= Enums.Tools.INSET;
      const meshes = this._main.getMeshes?.() ?? [];
      if (isLowPoly && !this._wfForcedByEdit) {
        this._wfSavedState = !!this._main.getMesh?.()?.getShowWireframe?.();
        this._wfForcedByEdit = true;
        meshes.forEach(m => m.setShowWireframe?.(true));
        this._main.render?.();
      } else if (!isLowPoly && this._wfForcedByEdit) {
        this._wfForcedByEdit = false;
        meshes.forEach(m => m.setShowWireframe?.(this._wfSavedState));
        this._main.render?.();
      }
    }

    // Hide the VR gizmo when not using TransformVR, and hide the desktop gizmo
    // when not using Transform — so switching away clears both groups.
    const tDesktop = this._tools[Enums.Tools.TRANSFORM];
    if (tDesktop && tDesktop._gizmo && tDesktop._gizmo._group) {
      tDesktop._gizmo._group.visible = (id === Enums.Tools.TRANSFORM);
    }
    const tVR = this._tools[Enums.Tools.TRANSFORM_VR];
    if (tVR && tVR._gizmo && tVR._gizmo._group) {
      tVR._gizmo._group.visible = (id === Enums.Tools.TRANSFORM_VR);
    }
  }

  getToolIndex() {
    return this._toolIndex;
  }

  getCurrentTool() {
    return this._tools[this._toolIndex];
  }

  getSymmetry() {
    return this._symmetry;
  }

  setSymmetry(val) {
    this._symmetry = val;
  }

  getTool(index) {
    return this._tools[index];
  }

  getSelection() {
    return this._selection;
  }

  init() {
    var main = this._main;
    var tools = this._tools;
    const opts = getOptionsURL();
    const saved = opts._rawSaved || {};

    for (var i = 0, nb = Tools.length; i < nb; ++i) {
      if (Tools[i]) {
        tools[i] = new Tools[i](main);
        
        // Restore per-tool settings from localStorage
        if (saved[`tool_${i}_radius`] !== undefined) tools[i]._radius = saved[`tool_${i}_radius`];
        if (saved[`tool_${i}_intensity`] !== undefined) tools[i]._intensity = saved[`tool_${i}_intensity`];
        if (saved[`tool_${i}_roughness`] !== undefined) tools[i]._material[0] = saved[`tool_${i}_roughness`];
        if (saved[`tool_${i}_metallic`] !== undefined) tools[i]._material[1] = saved[`tool_${i}_metallic`];
        if (saved[`tool_${i}_clay`] !== undefined) tools[i]._clay = saved[`tool_${i}_clay`];
        if (saved[`tool_${i}_accumulate`] !== undefined) tools[i]._accumulate = saved[`tool_${i}_accumulate`];
        if (saved[`tool_${i}_culling`] !== undefined) tools[i]._culling = saved[`tool_${i}_culling`];
        if (saved[`tool_${i}_topoCheck`] !== undefined) tools[i]._topoCheck = saved[`tool_${i}_topoCheck`];
        if (saved[`tool_${i}_modulateRadius`] !== undefined) tools[i]._modulateRadius = saved[`tool_${i}_modulateRadius`];
        if (saved[`tool_${i}_modulateIntensity`] !== undefined) tools[i]._modulateIntensity = saved[`tool_${i}_modulateIntensity`];
        if (saved[`tool_${i}_minRadiusPct`] !== undefined) tools[i]._minRadiusPct = saved[`tool_${i}_minRadiusPct`];
        if (saved[`tool_${i}_minIntensityPct`] !== undefined) tools[i]._minIntensityPct = saved[`tool_${i}_minIntensityPct`];
        if (saved[`tool_${i}_pressureBias`] !== undefined) tools[i]._pressureBias = saved[`tool_${i}_pressureBias`];
        if (saved[`tool_${i}_alpha`] !== undefined) tools[i]._idAlpha = saved[`tool_${i}_alpha`];
      }
    }
  }

  canBeContinuous() {
    switch (this._toolIndex) {
    case Enums.Tools.TWIST:
    case Enums.Tools.MOVE:
    case Enums.Tools.DRAG:
    case Enums.Tools.LOCALSCALE:
    case Enums.Tools.TRANSFORM:
      return false;
    default:
      return true;
    }
  }

  isUsingContinuous() {
    return this._continuous && this.canBeContinuous();
  }

  // True when sculpting is permitted given the active blendshape layer (if any).
  // No active layer → always allowed (normal base sculpting is unaffected).
  // Active layer → must be visible (not muted) and at weight 1, so the delta
  // capture in Mesh.updateGeometry stays correct.
  _canSculptActiveBlendshapeLayer() {
    const reg = window._animationRegistry;
    const mesh = this._main.getMesh?.();
    if (!reg || !mesh) return true;
    const track = reg.tracks.get(mesh.getID());
    if (!track) return true;
    const name = track.editingBlendshape;
    if (!name) {
      // Base cage is active. Block when it's locked (default once blendshapes exist)
      // so the cage isn't wrecked by accident. No baseShape yet → normal sculpting.
      return !(track.baseShape && track.baseLocked);
    }
    if (track.blendshapeLocked?.has?.(name)) return false; // locked layer
    if (track.blendshapeMuted?.has?.(name)) return false;  // hidden layer
    const bTrack = track.blendshapeTracks?.get(name);
    const w = bTrack ? reg.evaluateScalarTrack(bTrack, track.playbackTime || 0) : 0;
    return Math.abs(w - 1) < 1e-3;
  }

  start(ctrl) {
    var tool = this.getCurrentTool();

    // Blendshape layer gate (desktop + VR both route through here): when a layer is
    // active for editing, all mesh deformation is captured into that layer's delta
    // — which is only correct while the layer is visible and held at weight 1. If
    // not, block the stroke and flash the blendshape palette so the user sees why.
    // EXCEPT the transform tools: they move the object's matrix, not vertex deltas,
    // so the delta-capture concern doesn't apply. Gating them locked out E-key
    // transform/keying entirely once an object had blendshapes (Base is locked by
    // default), which only flashed the palette instead of letting the object move.
    const _isTransform = this._toolIndex === Enums.Tools.TRANSFORM
                      || this._toolIndex === Enums.Tools.TRANSFORM_VR;
    if (!_isTransform && !this._canSculptActiveBlendshapeLayer()) {
      window._blendshapeStackPanel?.flash?.();   // desktop panel
      window._blendshapeStackPanelVR?.flash?.(); // VR panel mesh
      return false;
    }

    // Frame (cel) animation gate: an object with a frame sequence can only be edited
    // when the playhead is parked exactly on a frame — off-frame edits are ambiguous
    // (modify which frame?). The voxel tool enforces this internally; this covers the
    // regular brushes editing a baked (non-voxel) mesh-frame anim. Transform exempt.
    if (!_isTransform && window._frameAnim && !window._frameAnim.canSculptActive()) {
      if (window.screenLog) window.screenLog('Park the playhead on a frame to edit it', '#f9e2af');
      return false;
    }

    // iPad double-fire guard for single-action tools.
    // On iPadOS the pressure-transition synthesis (pointermove 0→pressure) and the
    // real pointerdown can both reach start() within 10–200ms of each other.  For
    // tools whose entire operation runs inside start() this causes a second, spurious
    // operation on the (now mutated) mesh with a stale picking face index.
    // The guard is intentionally limited to tools with _continuous===false because
    // drag-based tools need start() called once per stroke and are not affected.
    const SINGLE_ACTION_DEBOUNCE_MS = 300;
    if (tool._continuous === false) {
      const now = performance.now();
      const msSinceLast = now - (this._lastSingleActionMs || 0);
      if (msSinceLast < SINGLE_ACTION_DEBOUNCE_MS) {
        if (window.screenLog) window.screenLog(
          `[SculptMgr] single-action dup blocked (${Math.round(msSinceLast)}ms) tool:${this._toolIndex}`, '#f9e2af');
        return false;
      }
      this._lastSingleActionMs = now;

      // Touch has no hover, so the picking ray is stale when these single-action
      // mesh-edit tools read getPickedFace()/getPickedVertices() in start() — most
      // override start() without calling super.start() or intersecting themselves,
      // so on iPad the tap landed on a stale/empty pick and did nothing (then a
      // later interaction fired the deferred edit). Refresh the pick at the current
      // pointer position. Not in VR (its ray pick is computed in handleXRInput).
      if (!this._main._vrSculpting) {
        this._main.getPicking().intersectionMouseMeshes();
      }
    }

    var canEdit = tool.start(ctrl);
    // Mark a stroke active only when the tool actually engaged. end() is otherwise
    // a no-op, so a camera-gesture release (which never calls start()) can't fire a
    // spurious tool.end() — that was committing a 0-height extrude on release when a
    // finger happened to be over the mesh.
    this._strokeActive = !!canEdit;

    // Sculpting interrupts animation playback (you can orbit during playback, but a
    // sculpt/edit stops it). Refresh the timeline + transport UI to match.
    if (canEdit && window._animPlaying) {
      window._animPlaying = false;
      if (window._animationRegistry) window._animationRegistry.lastGlobalTime = null;
      this._main.getGui?.()?._ctrlTimeline?.draw?.();
      window._animSyncKeyInspector?.();
    }

    // Push State for Undo/Redo
    if (this._main.getStateManager()) {
      if (tool.constructor.name === 'SculptVoxel') {
        // Voxel Undo - Worker Command
        this._main.getStateManager().pushStateVoxel(tool);
      } else if (this._main.getMesh() && this._main.getMesh().isDynamic) {
        // Dynamic Mesh Undo
        this._main.getStateManager().pushStateGeometry(this._main.getMesh());
      } else if (this._main.getMesh() && !this._main.getMesh().isDynamic) {
        // Static Mesh Undo (StateGeometry handled differently?)
        // Standard SculptGL pushes StateGeometry usually inside tool.start?
        // Actually SculptBase.start pushes StateGeometry.
        // Let's check SculptBase.
      }
    }

    if (this._main.getPicking().getMesh() && this.isUsingContinuous())
      this._sculptTimer = window.setInterval(tool._cbContinuous, 16.6);
    return canEdit;
  }

  end() {
    // Always clear the continuous timer (cleanup), but only commit the tool when a
    // stroke actually started — a camera-gesture release must not fire tool.end().
    if (this._sculptTimer !== -1) {
      clearInterval(this._sculptTimer);
      this._sculptTimer = -1;
    }
    if (!this._strokeActive) return;
    this._strokeActive = false;
    this.getCurrentTool().end();

    // Capture the finished stroke back into the active non-voxel cel frame so edits
    // persist across scrubbing (no-op for voxel — that commits via the worker, and
    // for objects without a frame sequence).
    window._frameAnim?.captureActiveMeshEdit?.();

    // Linked instances share geometry (_meshData); after an edit, re-sync every sibling's
    // GPU buffers so the change shows on all occurrences.
    this._main.refreshLinkedSiblings?.(this._main.getMesh?.());
  }

  preUpdate() {
    this.getCurrentTool().preUpdate(this.canBeContinuous());
  }

  update() {
    if (this.isUsingContinuous())
      return;
    this.getCurrentTool().update();
  }

  updateXR(picking, isPressed, origin, dir, options) {
    var tool = this.getCurrentTool();
    // if (window.screenLog && Math.random() < 0.01) window.screenLog(`ManagerXR: ToolIdx=${this._toolIndex} Tool=${!!tool}`, "orange");

    if (tool && tool.updateXR) {
      tool.updateXR(picking, isPressed, origin, dir, options);
    } else {
      // Log Removed
    }

    // Toggle Transform Gizmo visibility based on active tool AND being in VR
    const gizmoGroup = this._main._scene ? this._main._scene.getObjectByName("Transform Gizmo Group") : null;
    if (gizmoGroup) {
      const isVR = this._main._xrSession && this._main._xrSession.visibilityState === "visible";
      const isActive = (this._toolIndex === Enums.Tools.TRANSFORM_VR);
      gizmoGroup.visible = isVR && isActive;
    }
  }

  meshToVoxel() {
    var mesh = this._main.getMesh();
    if (!mesh) return;
    if (!mesh.getVertices) return;

    var voxelTool = this.getTool(Enums.Tools.VOXEL);
    if (mesh._isVoxel || mesh.constructor.name === 'MeshProxy') {
      if (window.screenLog) window.screenLog("Cannot merge voxels into voxels", "yellow");
      return;
    }

    var nbVertices = mesh.getNbVertices();
    var vAr = mesh.getVertices();
    
    var threeMesh = mesh.getThreeMesh();
    var colorAttr = threeMesh && threeMesh.geometry.attributes.color;
    var cAr = null;
    if (colorAttr) {
        if (colorAttr.itemSize === 4) {
            cAr = new Float32Array(nbVertices * 3);
            const raw = colorAttr.array;
            for (let i = 0; i < nbVertices; i++) {
                cAr[i * 3]     = raw[i * 4];
                cAr[i * 3 + 1] = raw[i * 4 + 1];
                cAr[i * 3 + 2] = raw[i * 4 + 2];
            }
        } else {
            cAr = colorAttr.array;
        }
    }
    var mAr = mesh.getMaterials();
    var fAr = threeMesh && threeMesh.geometry.index ? threeMesh.geometry.index.array : null;

    if (!fAr || fAr.length === 0) {
        fAr = mesh.getTriangles(); // Fallback
    }

    var matrix = mesh.getMatrix();
    var vArWorld = new Float32Array(nbVertices * 3);
    
    var xMin = Infinity, yMin = Infinity, zMin = Infinity;
    var xMax = -Infinity, yMax = -Infinity, zMax = -Infinity;

    // Inline transform
    for (let i = 0; i < nbVertices; i++) {
        let id = i * 3;
        let x = vAr[id], y = vAr[id+1], z = vAr[id+2];
        let wx = matrix[0] * x + matrix[4] * y + matrix[8]  * z + matrix[12];
        let wy = matrix[1] * x + matrix[5] * y + matrix[9]  * z + matrix[13];
        let wz = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];

        vArWorld[id]   = wx;
        vArWorld[id+1] = wy;
        vArWorld[id+2] = wz;

        if (wx < xMin) xMin = wx;
        if (wy < yMin) yMin = wy;
        if (wz < zMin) zMin = wz;
        if (wx > xMax) xMax = wx;
        if (wy > yMax) yMax = wy;
        if (wz > zMax) zMax = wz;
    }

    const width = xMax - xMin;
    const height = yMax - yMin;
    const depth = zMax - zMin;
    let maxExtent = Math.max(width, height, depth);

    // Apply 30% extra padding for sculpting room!
    maxExtent *= 1.30; 

    // Find the mesh center
    const cx = (xMin + xMax) / 2;
    const cy = (yMin + yMax) / 2;
    const cz = (zMin + zMax) / 2;

    // Shift vertices to center around [0,0,0] for the worker
    for (let i = 0; i < nbVertices; i++) {
        let id = i * 3;
        vArWorld[id]   -= cx;
        vArWorld[id+1] -= cy;
        vArWorld[id+2] -= cz;
    }

    // Use manual resolution from Remesh slider
    let newRes = Remesh.RESOLUTION;
    newRes = Math.min(200, Math.max(8, newRes)); // Clamp [8, 200]

    // Save these for when the worker returns the mesh!
    voxelTool._pendingSize = maxExtent;
    
    voxelTool._pendingOffset = [
        cx - maxExtent / 2,
        cy - maxExtent / 2,
        cz - maxExtent / 2
    ];

    voxelTool._pendingRes = newRes;

    

    voxelTool._worker.postMessage({
        type: 'MESH_TO_VOXEL',
        v: vArWorld,
        c: cAr,
        m: mAr,
        f: fAr,
        res: newRes,
        size: maxExtent,
        center: [cx, cy, cz]
    });

    // Hold the old mesh visible until the voxel mesh is ready to swap seamlessly!
    voxelTool._pendingSourceMesh = mesh; 

    this.setToolIndex(Enums.Tools.VOXEL);
    
    // Force a start to register the VoxelMesh if it's the first time
    voxelTool.start(null);

    // Sync GUI
    if (this._main.getGui() && this._main.getGui()._ctrlSculpt) {
        this._main.getGui()._ctrlSculpt.setValue(Enums.Tools.VOXEL);
    }
  }

  isProcessingQuads() {
    return this._isProcessingQuads;
  }

  fillHoles() {
    const mesh = this.getCurrentMesh();
    if (!mesh) {
      return;
    }

    const result = HoleFilling(mesh);
    if (!result) {
      return;
    }

    // We need to create a real MeshStatic object!
    import('../mesh/meshStatic/MeshStatic.js').then((MeshStaticMod) => {
      const MeshStatic = MeshStaticMod.default;
      const newMesh = new MeshStatic(this._main._gl);
      
      newMesh.setVertices(result.vertices);
      newMesh.setNbVertices(result.vertices.length / 3);
      newMesh.setFaces(result.faces);
      newMesh.setNbFaces(result.faces.length / 4);
      
      newMesh.init();
      newMesh.initRender();
      
      newMesh.setMatrix(mesh.getMatrix());
      newMesh.setShaderType(mesh.getShaderType());
      if (mesh.getShowWireframe) newMesh.setShowWireframe(mesh.getShowWireframe());

      this._main.replaceMesh(mesh, newMesh);
    });
  }

  remeshQuads(targetFaces) {
    const mesh = this._main.getMesh();
    if (!mesh) return;

    if (this._isProcessingQuads) return; // Prevent duplicate clicks!

    this._isProcessingQuads = true;

    // 30s Safety Timeout to reset UI if worker hangs
    if (this._quadRemeshTimeout) clearTimeout(this._quadRemeshTimeout);
    this._quadRemeshTimeout = setTimeout(() => {
      if (this._isProcessingQuads) {
        this._isProcessingQuads = false;
      }
    }, 30000);

    const voxelTool = this.getTool(Enums.Tools.VOXEL);
    if (!voxelTool || !voxelTool._worker) {
      console.error("SculptManager: VoxelWorker not initialized!");
      return;
    }

    const vAr = mesh.getVertices();
    const fAr = mesh.getFaces();
    const cAr = mesh.getColors();

    const isTriangles = fAr.length > 3 && fAr[3] === Utils.TRI_INDEX;

    voxelTool._worker.postMessage({
      type: 'REMESH_QUADRS',
      v: vAr,
      f: fAr,
      colors: cAr,
      targetFaces: targetFaces,
      id: mesh.getID(),
      isTriangles: isTriangles
    });
  }

  simplifyMesh(targetFaces, errorThreshold) {
    const mesh = this._main.getMesh();
    if (!mesh) return;

    if (this._isProcessingQuads) return; // Prevent duplicate clicks!

    this._isProcessingQuads = true;

    // 30s Safety Timeout to reset UI if worker hangs
    if (this._quadRemeshTimeout) clearTimeout(this._quadRemeshTimeout);
    this._quadRemeshTimeout = setTimeout(() => {
      if (this._isProcessingQuads) {
        this._isProcessingQuads = false;
      }
    }, 30000);

    const voxelTool = this.getTool(Enums.Tools.VOXEL);
    if (!voxelTool || !voxelTool._worker) {
      console.error("SculptManager: VoxelWorker not initialized!");
      return;
    }

    const vAr = mesh.getVertices();
    const fAr = mesh.getFaces();
    const cAr = mesh.getColors();

    const isTriangles = fAr.length > 3 && fAr[3] === Utils.TRI_INDEX;

    voxelTool._worker.postMessage({
      type: 'SIMPLIFY_MESH',
      v: vAr,
      f: fAr,
      colors: cAr,
      targetFaces: targetFaces,
      errorThreshold: errorThreshold,
      id: mesh.getID(),
      isTriangles: isTriangles
    });
  }

  remeshIsotropic(targetEdgeLength) {
    const mesh = this._main.getMesh();
    if (!mesh) return;

    if (this._isProcessingQuads) return; // Prevent duplicate clicks!

    this._isProcessingQuads = true;

    // 30s Safety Timeout to reset UI if worker hangs
    if (this._quadRemeshTimeout) clearTimeout(this._quadRemeshTimeout);
    this._quadRemeshTimeout = setTimeout(() => {
      if (this._isProcessingQuads) {
        this._isProcessingQuads = false;
      }
    }, 30000);

    const voxelTool = this.getTool(Enums.Tools.VOXEL);
    if (!voxelTool || !voxelTool._worker) {
      console.error("SculptManager: VoxelWorker not initialized!");
      return;
    }

    const vAr = mesh.getVertices();
    const fAr = mesh.getFaces();
    const cAr = mesh.getColors();

    const isTriangles = fAr.length > 3 && fAr[3] === Utils.TRI_INDEX;

    voxelTool._worker.postMessage({
      type: 'REMESH_ISOTROPIC',
      v: vAr,
      f: fAr,
      colors: cAr,
      targetEdgeLength: targetEdgeLength,
      id: mesh.getID(),
      isTriangles: isTriangles
    });
  }

  symmetryMirror(side) {
    const mesh = this._main.getMesh();
    if (!mesh) return;


    
    var vAr = mesh.getVertices();
    var snappedVerts = new Float32Array(vAr); // Clone to avoid modifying original in place
    var fAr = mesh.getFaces();
    var origColors = mesh.getColors();
    var nbVertices = mesh.getNbVertices();
    
    // Assume plane is X=0 for simplicity
    const nPlane = mesh.getSymmetryNormal ? mesh.getSymmetryNormal() : [1, 0, 0];
    if (Math.abs(nPlane[0]) < 0.9) {
      console.warn("[SculptManager] symmetryMirror only supports X-axis for now!");
    }
    
    var keepSide = side || 1; // 1: Keep Positive X, -1: Keep Negative X
    
    // Compute adaptive tolerance (2% of mesh radius)
    const meshRadius = mesh.computeLocalRadius ? mesh.computeLocalRadius() : 1.0;
    const SNAP_TOLERANCE = meshRadius * 0.02; 

    
    // 1. Label Vertices
    var labels = new Int8Array(nbVertices);
    for (var i = 0; i < nbVertices; ++i) {
      var x = snappedVerts[i * 3]; // Use snappedVerts
      
      // Force snap to center if within tolerance
      if (Math.abs(x) < SNAP_TOLERANCE) {
        snappedVerts[i * 3] = 0;
        x = 0;
      }
      
      if (keepSide === 1) {
        labels[i] = (x >= 0) ? 1 : -1; // 1: Keep, -1: Discard
      } else {
        labels[i] = (x <= 0) ? 1 : -1; // 1: Keep, -1: Discard
      }
    }
    
    // 2. Filter Faces
    var newFaces = [];
    var keptVerts = new Set();
    
    for (var i = 0; i < fAr.length; i += 4) {
      var iv1 = fAr[i];
      var iv2 = fAr[i + 1];
      var iv3 = fAr[i + 2];
      var iv4 = fAr[i + 3];
      
      var l1 = labels[iv1];
      var l2 = labels[iv2];
      var l3 = labels[iv3];
      var l4 = iv4 !== Utils.TRI_INDEX ? labels[iv4] : 1;
      
      var keepFace = false;
      if (iv4 !== Utils.TRI_INDEX) {
        if (l1 === 1 || l2 === 1 || l3 === 1 || l4 === 1) keepFace = true;
      } else {
        if (l1 === 1 || l2 === 1 || l3 === 1) keepFace = true;
      }
      
      if (keepFace) {
        // Check for faces straddling the plane that need bisection
        // Aggressive: Split ANY quad crossing the plane into triangles BEFORE cleanup!
        var hasLeft = false;
        var hasRight = false;
        const faceIndices = [iv1, iv2, iv3, iv4];
        for (let j = 0; j < 4; j++) {
          let idx = faceIndices[j];
          if (idx === Utils.TRI_INDEX) continue;
          let x = snappedVerts[idx * 3]; // Use snappedVerts
          if (x < -0.001) hasLeft = true;
          if (x > 0.001) hasRight = true;
        }
        
        if (hasLeft && hasRight && iv4 !== Utils.TRI_INDEX) {
          // Split into two triangles along the diagonal
          newFaces.push(iv1, iv2, iv3, Utils.TRI_INDEX);
          newFaces.push(iv1, iv3, iv4, Utils.TRI_INDEX);
          keptVerts.add(iv1); keptVerts.add(iv2); keptVerts.add(iv3); keptVerts.add(iv4);
          continue;
        }

        newFaces.push(iv1, iv2, iv3, iv4);
        keptVerts.add(iv1);
        keptVerts.add(iv2);
        keptVerts.add(iv3);
        if (iv4 !== Utils.TRI_INDEX) keptVerts.add(iv4);
      }
    }
    
    // 3. Snap boundary vertices
    for (var i = 0; i < nbVertices; ++i) {
      if (labels[i] === -1 && keptVerts.has(i)) {
        snappedVerts[i * 3] = 0; // Snap to plane
      }
    }
    
    // 4. Remap vertices and faces to remove unused
    var vertMap = new Map();
    var finalVerts = [];
    var finalColors = [];
    var finalFaces = new Uint32Array(newFaces.length);
    var nextV = 0;
    
    for (var i = 0; i < newFaces.length; i++) {
      var oldIdx = newFaces[i];
      if (oldIdx === Utils.TRI_INDEX) {
        finalFaces[i] = Utils.TRI_INDEX;
        continue;
      }
      if (!vertMap.has(oldIdx)) {
        vertMap.set(oldIdx, nextV);
        finalVerts.push(snappedVerts[oldIdx * 3], snappedVerts[oldIdx * 3 + 1], snappedVerts[oldIdx * 3 + 2]);
        if (origColors) {
          finalColors.push(origColors[oldIdx * 3], origColors[oldIdx * 3 + 1], origColors[oldIdx * 3 + 2]);
        }
        nextV++;
      }
      finalFaces[i] = vertMap.get(oldIdx);
    }
    
    var halfNbVerts = finalVerts.length / 3;
    var halfNbFaces = finalFaces.length / 4;
    
    // 5. Mirror and duplicate
    var fullVerts = new Float32Array(halfNbVerts * 2 * 3);
    fullVerts.set(finalVerts);
    
    var fullColors = null;
    if (origColors) {
      fullColors = new Float32Array(halfNbVerts * 2 * 3);
      fullColors.set(finalColors);
    }
    
    for (var i = 0; i < halfNbVerts; ++i) {
      fullVerts[(halfNbVerts + i) * 3] = -finalVerts[i * 3]; // Mirror X
      fullVerts[(halfNbVerts + i) * 3 + 1] = finalVerts[i * 3 + 1];
      fullVerts[(halfNbVerts + i) * 3 + 2] = finalVerts[i * 3 + 2];
      
      if (fullColors) {
        fullColors[(halfNbVerts + i) * 3] = finalColors[i * 3];
        fullColors[(halfNbVerts + i) * 3 + 1] = finalColors[i * 3 + 1];
        fullColors[(halfNbVerts + i) * 3 + 2] = finalColors[i * 3 + 2];
      }
    }
    
    var fullFaces = new Uint32Array(halfNbFaces * 2 * 4);
    fullFaces.set(finalFaces);
    
    for (var i = 0; i < halfNbFaces; ++i) {
      var idNew = (halfNbFaces + i) * 4;
      var idOld = i * 4;
      
      var iv1 = finalFaces[idOld];
      var iv2 = finalFaces[idOld + 1];
      var iv3 = finalFaces[idOld + 2];
      var iv4 = finalFaces[idOld + 3];
      
      var niv1 = iv1 + halfNbVerts;
      var niv2 = iv2 + halfNbVerts;
      var niv3 = iv3 + halfNbVerts;
      var niv4 = iv4 !== Utils.TRI_INDEX ? iv4 + halfNbVerts : Utils.TRI_INDEX;
      
      fullFaces[idNew] = niv3;
      fullFaces[idNew + 1] = niv2;
      fullFaces[idNew + 2] = niv1;
      fullFaces[idNew + 3] = niv4;
    }
    
    // 6. Weld seam vertices
    var weldMap = new Map();
    var uniqueVerts = [];
    var uniqueColors = [];
    var finalFullFaces = new Uint32Array(fullFaces.length);
    nextV = 0;
    
    const EPSILON = 0.01; // Increased to collapse tiny edges on centerline
    const EPSILON_SQ = EPSILON * EPSILON;
    
    for (var i = 0; i < fullVerts.length / 3; ++i) {
      var x = fullVerts[i * 3];
      var y = fullVerts[i * 3 + 1];
      var z = fullVerts[i * 3 + 2];
      
      var found = -1;
      for (let j = 0; j < uniqueVerts.length / 3; ++j) {
        let dx = x - uniqueVerts[j * 3];
        let dy = y - uniqueVerts[j * 3 + 1];
        let dz = z - uniqueVerts[j * 3 + 2];
        if (dx * dx + dy * dy + dz * dz < EPSILON_SQ) {
          found = j;
          break;
        }
      }
      
      if (found === -1) {
        weldMap.set(i, nextV);
        uniqueVerts.push(x, y, z);
        if (fullColors) {
          uniqueColors.push(fullColors[i * 3], fullColors[i * 3 + 1], fullColors[i * 3 + 2]);
        }
        nextV++;
      } else {
        weldMap.set(i, found);
      }
    }
    
    for (var i = 0; i < fullFaces.length; ++i) {
      var idx = fullFaces[i];
      if (idx === Utils.TRI_INDEX) {
        finalFullFaces[i] = Utils.TRI_INDEX;
        continue;
      }
      finalFullFaces[i] = weldMap.get(idx);
    }
    
    // Dissolution loop moved below
    
    // Clean up faces (remove duplicates and handle triangles)
    var seenFaces = new Set();
    var newFacesList = [];
    
    for (var i = 0; i < finalFullFaces.length; i += 4) {
      var iv1 = finalFullFaces[i];
      var iv2 = finalFullFaces[i + 1];
      var iv3 = finalFullFaces[i + 2];
      var iv4 = finalFullFaces[i + 3];
      
      if (iv1 === Utils.TRI_INDEX) continue;
      
      var uvs = [];
      if (iv1 !== Utils.TRI_INDEX) uvs.push(iv1);
      if (iv2 !== Utils.TRI_INDEX && !uvs.includes(iv2)) uvs.push(iv2);
      if (iv3 !== Utils.TRI_INDEX && !uvs.includes(iv3)) uvs.push(iv3);
      if (iv4 !== Utils.TRI_INDEX && !uvs.includes(iv4)) uvs.push(iv4);
      
      if (uvs.length < 3) continue;
      
      // Check if all vertices are on the symmetry plane (X=0)
      var allOnPlane = true;
      for (var j = 0; j < uvs.length; j++) {
        var idx = uvs[j];
        if (Math.abs(uniqueVerts[idx * 3]) > 0.001) {
          allOnPlane = false;
          break;
        }
      }
      if (allOnPlane) continue;
      
      // Check for duplicate faces (same set of vertices)
      var sortedUvs = uvs.slice().sort((a, b) => a - b);
      var key = sortedUvs.join('_');
      if (seenFaces.has(key)) continue;
      seenFaces.add(key);
      

      

      
      if (uvs.length === 3) {
        newFacesList.push(uvs[0], uvs[1], uvs[2], Utils.TRI_INDEX);
      } else {
        newFacesList.push(uvs[0], uvs[1], uvs[2], uvs[3]);
      }
    }
    
    finalFullFaces = new Uint32Array(newFacesList);
    
    // 6.5. Dissolve valence-2 vertices on centerline
    var uniqueVertCount = uniqueVerts.length / 3;
    var neighbors = Array.from({length: uniqueVertCount}, () => new Set());
    for (var i = 0; i < finalFullFaces.length; i += 4) {
      var iv1 = finalFullFaces[i];
      var iv2 = finalFullFaces[i + 1];
      var iv3 = finalFullFaces[i + 2];
      var iv4 = finalFullFaces[i + 3];
      
      if (iv1 === Utils.TRI_INDEX) continue;
      
      const verts = [iv1, iv2, iv3];
      if (iv4 !== Utils.TRI_INDEX) verts.push(iv4);
      
      for (let j = 0; j < verts.length; j++) {
        const vA = verts[j];
        const vB = verts[(j + 1) % verts.length];
        neighbors[vA].add(vB);
        neighbors[vB].add(vA);
      }
    }
    
    var dissolvedCount = 0;
    for (var i = 0; i < uniqueVertCount; ++i) {
      if (neighbors[i].size === 2) {
        var x = uniqueVerts[i * 3];
        // Check if on centerline
        if (Math.abs(x) < 0.001) {
          var nArr = Array.from(neighbors[i]);
          var vA = nArr[0];
          var vB = nArr[1];
          // Only dissolve if BOTH neighbors are on the centerline!
          // This ensures we only collapse edges ALONG the plane.
          var aOnPlane = Math.abs(uniqueVerts[vA * 3]) < 0.001;
          var bOnPlane = Math.abs(uniqueVerts[vB * 3]) < 0.001;
          
          if (aOnPlane && bOnPlane) {
            // Replace i with vA in all faces
            for (var j = 0; j < finalFullFaces.length; ++j) {
              if (finalFullFaces[j] === i) {
                finalFullFaces[j] = vA;
              }
            }
            dissolvedCount++;
          }
        }
      }
    }
    console.log(`[SculptManager] Dissolved ${dissolvedCount} valence-2 vertices on centerline.`);



    // Remap vertices and faces to remove unused and drop degenerate faces
    var vertMap = new Map();
    var remapedVerts = [];
    var remapedColors = [];
    var remapedFaces = [];
    var nextV = 0;
    
    for (let i = 0; i < finalFullFaces.length; i += 4) {
      var iv1 = finalFullFaces[i];
      var iv2 = finalFullFaces[i + 1];
      var iv3 = finalFullFaces[i + 2];
      var iv4 = finalFullFaces[i + 3];
      
      // If the first vertex is TRI_INDEX, the face was marked as degenerate/deleted
      if (iv1 === Utils.TRI_INDEX) continue;
      
      const faceIndices = [iv1, iv2, iv3, iv4];
      const mappedFace = [];
      
      for (let j = 0; j < 4; j++) {
        const oldIdx = faceIndices[j];
        if (oldIdx === Utils.TRI_INDEX) {
          mappedFace.push(Utils.TRI_INDEX);
          continue;
        }
        
        if (!vertMap.has(oldIdx)) {
          vertMap.set(oldIdx, nextV);
          remapedVerts.push(uniqueVerts[oldIdx * 3], uniqueVerts[oldIdx * 3 + 1], uniqueVerts[oldIdx * 3 + 2]);
          if (uniqueColors.length > 0) {
            remapedColors.push(uniqueColors[oldIdx * 3], uniqueColors[oldIdx * 3 + 1], uniqueColors[oldIdx * 3 + 2]);
          }
          nextV++;
        }
        mappedFace.push(vertMap.get(oldIdx));
      }
      
      remapedFaces.push(mappedFace[0], mappedFace[1], mappedFace[2], mappedFace[3]);
    }
    
    uniqueVerts = remapedVerts;
    uniqueColors = remapedColors;
    finalFullFaces = new Uint32Array(remapedFaces);
    
    // 7. Update mesh
    var newMesh = new MeshStatic(this._main._gl);
    newMesh.setVertices(new Float32Array(uniqueVerts));
    newMesh.setFaces(finalFullFaces);
    if (uniqueColors.length > 0) {
      newMesh.setColors(new Float32Array(uniqueColors));
    }
    newMesh.setNbFaces(finalFullFaces.length / 4);
    newMesh.setNbVertices(uniqueVerts.length / 3);
    newMesh.isQuad = true;
    
    newMesh.init();
    newMesh.initRender();
    
    newMesh.setMatrix(mesh.getMatrix());
    newMesh.setShaderType(mesh.getShaderType());
    if (mesh.getShowWireframe) newMesh.setShowWireframe(mesh.getShowWireframe());
    
    this._main.replaceMesh(mesh, newMesh);
    this._main.setMesh(newMesh);
    
    // Invalidate wireframe cache for new mesh
    if (newMesh._meshData) {
      newMesh._meshData._drawElementsWireframe = null;
      newMesh._meshData._drawArraysWireframe = null;
      newMesh._meshData._edges = new Uint8ClampedArray(0);
    }
    
    const prevMeshForUndo = mesh;
    const nextMeshForRedo = newMesh;
    
    const undoMirror = () => {
      this._main.replaceMesh(nextMeshForRedo, prevMeshForUndo);
      this._main.setMesh(prevMeshForUndo);
      // Invalidate wireframe cache for restored mesh
      if (prevMeshForUndo._meshData) {
        prevMeshForUndo._meshData._drawElementsWireframe = null;
        prevMeshForUndo._meshData._drawArraysWireframe = null;
        prevMeshForUndo._meshData._edges = new Uint8ClampedArray(0);
      }
      if (this._main.guiXR) this._main.guiXR._needsRedraw = true;
    };
    
    const redoMirror = () => {
      this._main.replaceMesh(prevMeshForUndo, nextMeshForRedo);
      this._main.setMesh(nextMeshForRedo);
      if (this._main.guiXR) this._main.guiXR._needsRedraw = true;
    };
    
    this._main.getStateManager().pushStateCustom(undoMirror, redoMirror);
    
    if (this._main.guiXR) this._main.guiXR._needsRedraw = true;
  }

  sliceAndCap() {
    const mesh = this._main.getMesh();
    if (!mesh) return;

    if (this._isProcessingSlice) return; // Prevent duplicate clicks
    this._isProcessingSlice = true;

    const voxelTool = this.getTool(Enums.Tools.VOXEL);
    if (!voxelTool || !voxelTool._worker) {
      console.error("SculptManager: VoxelWorker not initialized!");
      return;
    }

    const vAr = mesh.getVertices();
    const fAr = mesh.getFaces();
    
    // Explicit flag instead of guess
    const isQuad = mesh.isQuad === true;

    voxelTool._worker.postMessage({
      type: 'SLICE_AND_CAP',
      v: vAr,
      f: fAr,
      isQuad: isQuad,
      side: 1 // 1 for +X, -1 for -X
    });
  }

  booleanOperationSelection(op) {
    if (this._isProcessingSlice) return; // Share lock
    this._isProcessingSlice = true;

    const selectedMeshes = this._main.getSelectedMeshes().slice(); // Snapshot
    this._pendingUnionMeshes = selectedMeshes; 
    
    if (selectedMeshes.length !== 2) {
      if (window.screenLog) window.screenLog("Select exactly two meshes for this operation", "yellow");
      this._isProcessingSlice = false;
      return;
    }

    const mesh1 = selectedMeshes[0];
    const mesh2 = selectedMeshes[1];
    const v1 = mesh1.isVisible();
    const v2 = mesh2.isVisible();

    let sortedMeshes = selectedMeshes;
    if (op === 'subtract') {
      // Subtract invisible from visible.
      // So baseMesh (visible) goes first!
      if (!v1) {
        sortedMeshes = [mesh2, mesh1];
      }
    }

    const voxelTool = this.getTool(Enums.Tools.VOXEL);
    if (!voxelTool || !voxelTool._worker) {
      console.error("SculptManager: VoxelWorker not available for Booleans");
      this._isProcessingSlice = false;
      return;
    }

    const meshesData = [];

    for (let i = 0; i < sortedMeshes.length; i++) {
      const mesh = sortedMeshes[i];
      const nbVertices = mesh.getNbVertices();
      const vAr = mesh.getVertices();
      const fAr = mesh.getFaces();
      const matrix = mesh.getMatrix();

      // Transform to world space
      const vArWorld = new Float32Array(nbVertices * 3);
      for (let j = 0; j < nbVertices; j++) {
        const id = j * 3;
        const x = vAr[id], y = vAr[id + 1], z = vAr[id + 2];
        vArWorld[id]     = matrix[0] * x + matrix[4] * y + matrix[8]  * z + matrix[12];
        vArWorld[id + 1] = matrix[1] * x + matrix[5] * y + matrix[9]  * z + matrix[13];
        vArWorld[id + 2] = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
      }

      meshesData.push({
        v: vArWorld,
        f: fAr,
        isTriangles: !mesh.isQuad
      });
    }

    try {
      voxelTool._worker.postMessage({
        type: 'BOOLEAN_OPERATION',
        meshes: meshesData,
        op: op,
        quadrangulate: Remesh.QUADRANGULATE
      });
    } catch (e) {
      console.error("[SculptManager] postMessage failed for Boolean:", e);
      this._isProcessingSlice = false;
    }
  }

  onSliceAndCapResult(msg) {
    this._isProcessingSlice = false;

    const activeMesh = this._main.getMesh();
    if (!activeMesh) return;

    const main = this._main;
    const newMesh = new MeshStatic(main._gl);

    newMesh.setVertices(msg.v);
    
    // Pad triangles with TRI_INDEX to conform to SculptGL's quad-stride faces array
    const nbTri = msg.f.length / 3;
    const padded = new Uint32Array(nbTri * 4);
    for (let i = 0; i < nbTri; i++) {
      padded[i * 4] = msg.f[i * 3];
      padded[i * 4 + 1] = msg.f[i * 3 + 1];
      padded[i * 4 + 2] = msg.f[i * 3 + 2];
      padded[i * 4 + 3] = 4294967295; // TRI_INDEX (-1)
    }
    newMesh.setFaces(padded);
    newMesh.setNbFaces(nbTri); // Face count is number of triangles
    newMesh.setNbVertices(msg.v.length / 3);
    
    newMesh.init();

    newMesh.setMatrix(activeMesh.getMatrix());
    newMesh.setShaderType(activeMesh.getShaderType());
    if (activeMesh.getShowWireframe && newMesh.setShowWireframe) {
      newMesh.setShowWireframe(activeMesh.getShowWireframe());
    }

    activeMesh.setVisible(false);
    
    if (activeMesh.getThreeMesh) {
      const threeMesh = activeMesh.getThreeMesh();
      if (threeMesh) {
        threeMesh.visible = false;
      }
    }

    main.addNewMesh(newMesh);
    main.setMesh(newMesh);
  }

  onBooleanUnionResult(msg) {
    this._isProcessingSlice = false; // Reset lock

    if (!this._pendingUnionMeshes || this._pendingUnionMeshes.length === 0) {
      console.warn("No pending union meshes found!");
      return;
    }

    const main = this._main;
    const newMesh = new MeshStatic(main._gl);

    newMesh.setVertices(msg.v);
    newMesh.setFaces(msg.f);
    newMesh.setNbFaces(msg.f.length / 4);
    newMesh.setNbVertices(msg.v.length / 3);
    newMesh.isQuad = true; // Output is quads!

    newMesh.init();
    newMesh.initRender();

    // Set matrix to identity since vertices are in world space
    import('gl-matrix').then(({ mat4 }) => {
      const identityMat = mat4.create();
      newMesh.setMatrix(identityMat);
    });

    const oldMeshes = this._pendingUnionMeshes.slice(); // Snapshot

    const redoUnion = () => {
      console.log(`[SculptManager] redoUnion EXECUTE`);
      // Remove old meshes manually
      for (const m of oldMeshes) {
        const idx = main._meshes.indexOf(m);
        if (idx >= 0) {
          if (main._worldGroup && m.getThreeMesh()) main._worldGroup.remove(m.getThreeMesh());
          main._meshes.splice(idx, 1);
        }
      }
      // Add new mesh manually
      main._meshes.push(newMesh);
      if (main._worldGroup && newMesh.getThreeMesh()) main._worldGroup.add(newMesh.getThreeMesh());
      main.setMesh(newMesh);
      if (main.guiXR && main.guiXR.refreshSceneWidget) main.guiXR.refreshSceneWidget();
    };

    const undoUnion = () => {
      console.log(`[SculptManager] undoUnion EXECUTE`);
      // Remove new mesh manually
      const idx = main._meshes.indexOf(newMesh);
      if (idx >= 0) {
        if (main._worldGroup && newMesh.getThreeMesh()) main._worldGroup.remove(newMesh.getThreeMesh());
        main._meshes.splice(idx, 1);
      }
      // Add old meshes manually
      for (const m of oldMeshes) {
        main._meshes.push(m);
        if (main._worldGroup && m.getThreeMesh()) main._worldGroup.add(m.getThreeMesh());
      }
      main.setMesh(oldMeshes[0]);
      if (main.guiXR && main.guiXR.refreshSceneWidget) main.guiXR.refreshSceneWidget();
    };

    redoUnion(); // Execute now

    this._main.getStateManager().pushStateCustom(undoUnion, redoUnion);

    this._pendingUnionMeshes = null; // Clear
  }

  onSymmetryMirrorFaults(data) {
    this._isProcessingSlice = false; // Reset lock
    const mesh = this._main.getMesh();
    if (!mesh) return;

    if (data.v && data.f) {
      console.log(`[SculptManager] Validated repair received. Shaving and adopting welded mesh!`);
      const newMesh = new MeshStatic(this._main._gl);
      newMesh.setVertices(data.v);
      newMesh.setNbVertices(data.v.length / 3);
      newMesh.setFaces(data.f);
      newMesh.setNbFaces(data.f.length / 4);
      
      const wasOptim = Mesh.OPTIMIZE;
      Mesh.OPTIMIZE = false;
      newMesh.init();
      Mesh.OPTIMIZE = wasOptim;
      newMesh.initRender();
      
      newMesh.setMatrix(mesh.getMatrix());
      newMesh.setShaderType(mesh.getShaderType());
      if (mesh.getShowWireframe) newMesh.setShowWireframe(mesh.getShowWireframe());
      newMesh.isQuad = mesh.isQuad; 

      const undoFaults = () => {
        console.log(`[SculptManager] undoFaults EXECUTE`);
        this._main.replaceMesh(newMesh, mesh);
        if (this._main.guiXR && this._main.guiXR.refreshSceneWidget) this._main.guiXR.refreshSceneWidget();
      };
      
      const redoFaults = () => {
        console.log(`[SculptManager] redoFaults EXECUTE`);
        this._main.replaceMesh(mesh, newMesh);
        if (this._main.guiXR && this._main.guiXR.refreshSceneWidget) this._main.guiXR.refreshSceneWidget();
      };

      redoFaults();
      this._main.getStateManager().pushStateCustom(undoFaults, redoFaults);
      return; 
    }

    const indices = data.holesIndices;
    if (!indices || indices.length === 0) return;

    const colors = mesh.getColors();
    if (colors) {
      console.log(`[SculptManager] Coloring ${indices.length} fault vertices red.`);
      
      for (const idx of indices) {
        if (idx * 3 >= colors.length) continue;
        colors[idx * 3] = 1.0;     // Red
        colors[idx * 3 + 1] = 0.0; // Green
        colors[idx * 3 + 2] = 0.0; // Blue
      }
      
      mesh.updateColorBuffer(); // Push updated colors to WebGL
      this._main.render(); // Re-render viewport
    } else {
      console.warn("[SculptManager] Cannot color faults - mesh lacks colors array.");
    }
  }

  onSymmetryMirrorResult(data) {
    this._isProcessingSlice = false; // Reset lock

    if (data.stats) {
      const s = data.stats;
      console.log(`[SculptManager] Quadrangulation Stats: tris=${s.tris} leftovers=${s.leftoverTris} candidates=${s.candidates} merged=${s.merged} rejectedDot=${s.rejectedDot}`);
    }

    const mesh = this._main.getMesh();
    if (!mesh) return;

    console.log(`[SculptManager] onSymmetryMirrorResult START: current mesh v=${mesh.getNbVertices()} f=${mesh.getNbFaces()} incoming v=${data.v.length/3} f=${data.f.length/4}`);

    // Create NEW mesh object for REDO
    const newMesh = new MeshStatic(this._main._gl);
    newMesh.setVertices(data.v);
    newMesh.setNbVertices(data.v.length / 3);
    newMesh.setFaces(data.f);
    newMesh.setNbFaces(data.f.length / 4);
    newMesh.isQuad = true;

    newMesh.init();
    newMesh.initRender();

    // Inherit visible and style properties
    if (mesh.getMaterial) newMesh.setMaterial(mesh.getMaterial());
    if (mesh.getShowWireframe && newMesh.setShowWireframe) {
      newMesh.setShowWireframe(mesh.getShowWireframe());
    }
    if (mesh.getTransformData && newMesh.setTransformData) {
      newMesh.setTransformData(mesh.getTransformData());
    }
    newMesh.visible = mesh.visible;

    const undoMirror = () => {
      console.log(`[SculptManager] undoMirror EXECUTE: swapping back to old mesh object`);
      this._main.replaceMesh(newMesh, mesh);
      if (this._main.guiXR && this._main.guiXR.refreshSceneWidget) {
        this._main.guiXR.refreshSceneWidget();
      }
    };

    const redoMirror = () => {
      console.log(`[SculptManager] redoMirror EXECUTE: swapping to new mirrored mesh object`);
      this._main.replaceMesh(mesh, newMesh);
      if (this._main.guiXR && this._main.guiXR.refreshSceneWidget) {
        this._main.guiXR.refreshSceneWidget();
      }
    };

    // Apply Redo (Execute)
    redoMirror();

    // Push state
    this._main.getStateManager().pushStateCustom(undoMirror, redoMirror);
    }

  onTriangulateResult(data) {
    const mesh = this._main.getMesh();
    if (!mesh) return;

    // 1. Capture OLD state for UNDO
    const oldFaces = new Uint32Array(mesh.getFaces());
    const oldVerts = new Float32Array(mesh.getVertices());
    const wasQuad = mesh.isQuad;

    // 2. Capture NEW state for REDO
    const newFaces = new Uint32Array(data.f);
    const newVerts = new Float32Array(data.v);

    // 3. Define Undo/Redo callbacks
    const undoTris = () => {
      mesh.setVertices(oldVerts);
      mesh.setNbVertices(oldVerts.length / 3);
      mesh.setFaces(oldFaces);
      mesh.setNbFaces(oldFaces.length / 4);
      mesh.isQuad = wasQuad;
      const wasOptim = Mesh.OPTIMIZE;
      Mesh.OPTIMIZE = false;
      mesh.init(); 
      Mesh.OPTIMIZE = wasOptim;
      mesh.initRender();
      if (this._main.guiXR) this._main.guiXR._needsRedraw = true;
    };

    const redoTris = () => {
      mesh.setVertices(newVerts);
      mesh.setNbVertices(newVerts.length / 3);
      mesh.setFaces(newFaces);
      mesh.setNbFaces(newFaces.length / 4);
      mesh.isQuad = false;
      const wasOptim = Mesh.OPTIMIZE;
      Mesh.OPTIMIZE = false; // Bypass the fArUV capacity crash!
      mesh.init(); 
      Mesh.OPTIMIZE = wasOptim;
      mesh.initRender();
      if (this._main.guiXR) this._main.guiXR._needsRedraw = true;
    };

    // 4. Push to StateManager
    this._main.getStateManager().pushStateCustom(undoTris, redoTris);

    // 5. Apply NOW
    redoTris();
  }

  onQuadrangulateResult(data) {
    const mesh = this._main.getMesh();
    if (!mesh) return;

    // 1. Capture OLD state for UNDO
    const oldFaces = new Uint32Array(mesh.getFaces());
    const oldVerts = new Float32Array(mesh.getVertices());
    const oldColors = mesh.getColors() ? new Float32Array(mesh.getColors()) : null;
    const wasQuad = mesh.isQuad;

    // 2. Capture NEW state for REDO
    const newFaces = new Uint32Array(data.f);
    const newVerts = new Float32Array(data.v);
    const newColors = data.c ? new Float32Array(data.c) : null;

    const undoQuads = () => {
      mesh.setVertices(oldVerts);
      mesh.setNbVertices(oldVerts.length / 3);
      mesh.setFaces(oldFaces);
      mesh.setNbFaces(oldFaces.length / 4);
      if (oldColors) mesh.setColors(oldColors);
      mesh.isQuad = wasQuad;
      const wasOptim = Mesh.OPTIMIZE;
      Mesh.OPTIMIZE = false;
      mesh.init(); 
      Mesh.OPTIMIZE = wasOptim;
      mesh.initRender();
      if (this._main.guiXR) this._main.guiXR._needsRedraw = true;
    };

    const redoQuads = () => {
      mesh.setVertices(newVerts);
      mesh.setNbVertices(newVerts.length / 3);
      mesh.setFaces(newFaces);
      mesh.setNbFaces(newFaces.length / 4);
      if (newColors) mesh.setColors(newColors);
      mesh.isQuad = true;
      const wasOptim = Mesh.OPTIMIZE;
      Mesh.OPTIMIZE = false; // Bypass the fArUV capacity crash!
      mesh.init(); 
      Mesh.OPTIMIZE = wasOptim;
      mesh.initRender();
      if (this._main.guiXR) this._main.guiXR._needsRedraw = true;
    };

    this._main.getStateManager().pushStateCustom(undoQuads, redoQuads);
    redoQuads();
  }

  onQuadRemeshResult(data) {
    if (this._quadRemeshTimeout) clearTimeout(this._quadRemeshTimeout);
    this._isProcessingQuads = false;

    const activeMesh = this._main.getMesh();
    if (!activeMesh) return;

    const main = this._main;
    const newMesh = new MeshStatic(main._gl);

    newMesh.setVertices(data.vertices);
    newMesh.setFaces(data.faces);
    
    if (data.colors) {
      newMesh.setColors(data.colors);
    }
    
    newMesh.init(); // Automatically allocates arrays, computes topology, geometry, and center!
    
    // Fix zero normals produced by isolated vertices or canceling face normals
    const normals = newMesh.getNormals();
    if (normals) {
      let fixedCount = 0;
      for (let i = 0; i < normals.length; i += 3) {
        const x = normals[i];
        const y = normals[i+1];
        const z = normals[i+2];
        const mag = Math.sqrt(x*x + y*y + z*z);
        if (mag < 0.001) {
          normals[i] = 0;
          normals[i+1] = 1; // Default up vector
          normals[i+2] = 0;
          fixedCount++;
        } else {
          // Normalize to ensure consistent shading
          normals[i] = x / mag;
          normals[i+1] = y / mag;
          normals[i+2] = z / mag;
        }
      }
      if (fixedCount > 0) {
        console.log(`[SculptManager] Fixed ${fixedCount} zero/invalid normals.`);
      }
    }

    newMesh.initRender(); // <-- Generate Three.js geometry!
    newMesh.isQuad = true;

    // Transfer transform from the active mesh
    newMesh.setMatrix(activeMesh.getMatrix());
    newMesh.setShaderType(activeMesh.getShaderType());
    if (activeMesh.getShowWireframe && newMesh.setShowWireframe) {
      newMesh.setShowWireframe(activeMesh.getShowWireframe());
    }

    const sourceMesh = activeMesh;
    const quadMesh = newMesh;
    
    const undoOp = () => {
      quadMesh.setVisible(false);
      if (quadMesh.getThreeMesh()) quadMesh.getThreeMesh().visible = false;
      
      sourceMesh.setVisible(true);
      if (sourceMesh.getThreeMesh()) sourceMesh.getThreeMesh().visible = true;
      
      const idx = this._main.getMeshes().indexOf(quadMesh);
      if (idx >= 0) this._main.getMeshes().splice(idx, 1);
      if (this._main._worldGroup && quadMesh.getThreeMesh()) {
        this._main._worldGroup.remove(quadMesh.getThreeMesh());
      }
      
      this._main.setMesh(sourceMesh);
      if (this._main.guiXR) this._main.guiXR.refreshSceneWidget();
    };
    
    const redoOp = () => {
      sourceMesh.setVisible(false);
      if (sourceMesh.getThreeMesh()) sourceMesh.getThreeMesh().visible = false;
      
      quadMesh.setVisible(true);
      if (quadMesh.getThreeMesh()) quadMesh.getThreeMesh().visible = true;
      
      if (!this._main.getMeshes().includes(quadMesh)) {
        this._main.getMeshes().push(quadMesh);
        if (this._main._worldGroup && quadMesh.getThreeMesh()) {
          this._main._worldGroup.add(quadMesh.getThreeMesh());
        }
      }
      
      this._main.setMesh(quadMesh);
      if (this._main.guiXR) this._main.guiXR.refreshSceneWidget();
    };
    
    redoOp();
    this._main.getStateManager().pushStateCustom(undoOp, redoOp);

    
  }

  postRender() {
    const tool = this.getCurrentTool();

    // Desktop: hide both transform gizmos; the active tool's postRender re-shows its
    // own. (VR uses setToolIndex + TransformVR.updateXR — postRender doesn't run there.)
    this._hideTransformGizmos();

    // --- DEBUG (remove once gizmo displays) ---
    // Log the first postRender call for each distinct toolIndex so the counter
    // never exhausts before the user switches tools.
    if (!this._prLoggedIndexes) this._prLoggedIndexes = new Set();
    if (!this._prLoggedIndexes.has(this._toolIndex)) {
      this._prLoggedIndexes.add(this._toolIndex);
      console.log('[SculptManager.postRender first for toolIndex=' + this._toolIndex + ']',
        'toolName:', tool ? tool.constructor.name : 'null',
        'hasPostRender:', !!(tool && tool.postRender)
      );
    }
    // --- END DEBUG ---
    if (tool && tool.postRender) {
      tool.postRender(this._selection);
    }
  }
  addSculptToScene(scene) {
    return this.getCurrentTool().addSculptToScene(scene);
  }
}

export default SculptManager;
