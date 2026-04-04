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

    this._selection = new Selection(main._gl); // the selection geometry (red hover circle)
    
    this._isProcessingQuads = false;
    this._quadRemeshTimeout = null;

    this.init();
  }

  setToolIndex(id) {
    this._toolIndex = id;
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

  start(ctrl) {
    var tool = this.getCurrentTool();
    var canEdit = tool.start(ctrl);

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
    this.getCurrentTool().end();
    if (this._sculptTimer !== -1) {
      clearInterval(this._sculptTimer);
      this._sculptTimer = -1;
    }
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

  symmetryMirror(side) {
    const mesh = this._main.getMesh();
    if (!mesh) return;

    console.log(`[SculptManager] symmetryMirror started locally! side=${side}`);
    
    var vAr = mesh.getVertices();
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
    console.log(`[SculptManager] symmetryMirror: using SNAP_TOLERANCE=${SNAP_TOLERANCE.toFixed(4)}`);
    
    // 1. Label Vertices
    var labels = new Int8Array(nbVertices);
    for (var i = 0; i < nbVertices; ++i) {
      var x = vAr[i * 3];
      
      // Force snap to center if within tolerance
      if (Math.abs(x) < SNAP_TOLERANCE) {
        vAr[i * 3] = 0;
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
        vAr[i * 3] = 0; // Snap to plane
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
        finalVerts.push(vAr[oldIdx * 3], vAr[oldIdx * 3 + 1], vAr[oldIdx * 3 + 2]);
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
    
    for (var i = 0; i < fullVerts.length / 3; ++i) {
      var x = fullVerts[i * 3];
      var y = fullVerts[i * 3 + 1];
      var z = fullVerts[i * 3 + 2];
      
      var key = Math.round(x*1000) + "_" + Math.round(y*1000) + "_" + Math.round(z*1000);
      
      if (!weldMap.has(key)) {
        weldMap.set(key, nextV);
        uniqueVerts.push(x, y, z);
        if (fullColors) {
          uniqueColors.push(fullColors[i * 3], fullColors[i * 3 + 1], fullColors[i * 3 + 2]);
        }
        nextV++;
      }
    }
    
    for (var i = 0; i < fullFaces.length; ++i) {
      var idx = fullFaces[i];
      if (idx === Utils.TRI_INDEX) {
        finalFullFaces[i] = Utils.TRI_INDEX;
        continue;
      }
      var x = fullVerts[idx * 3];
      var y = fullVerts[idx * 3 + 1];
      var z = fullVerts[idx * 3 + 2];
      var key = Math.round(x*1000) + "_" + Math.round(y*1000) + "_" + Math.round(z*1000);
      finalFullFaces[i] = weldMap.get(key);
    }
    
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
    console.log(`[SculptManager] Dissolved ${dissolvedCount} valence-2 vertices on centerline.`);
    
    // Clean up faces (remove duplicates and handle triangles)
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
      
      if (uvs.length < 3) {
        finalFullFaces[i] = Utils.TRI_INDEX;
        finalFullFaces[i + 1] = Utils.TRI_INDEX;
        finalFullFaces[i + 2] = Utils.TRI_INDEX;
        finalFullFaces[i + 3] = Utils.TRI_INDEX;
      } else if (uvs.length === 3) {
        finalFullFaces[i] = uvs[0];
        finalFullFaces[i + 1] = uvs[1];
        finalFullFaces[i + 2] = uvs[2];
        finalFullFaces[i + 3] = Utils.TRI_INDEX;
      } else {
        finalFullFaces[i] = uvs[0];
        finalFullFaces[i + 1] = uvs[1];
        finalFullFaces[i + 2] = uvs[2];
        finalFullFaces[i + 3] = uvs[3];
      }
    }
    
    // Remap vertices and faces to remove unused
    var vertMap = new Map();
    var remapedVerts = [];
    var remapedColors = [];
    var remapedFaces = new Uint32Array(finalFullFaces.length);
    var nextV = 0;
    
    for (let i = 0; i < finalFullFaces.length; i++) {
      var oldIdx = finalFullFaces[i];
      if (oldIdx === Utils.TRI_INDEX) {
        remapedFaces[i] = Utils.TRI_INDEX;
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
      remapedFaces[i] = vertMap.get(oldIdx);
    }
    
    uniqueVerts = remapedVerts;
    uniqueColors = remapedColors;
    finalFullFaces = remapedFaces;
    
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
    
    const prevMeshForUndo = mesh;
    const nextMeshForRedo = newMesh;
    
    const undoMirror = () => {
      this._main.replaceMesh(nextMeshForRedo, prevMeshForUndo);
      this._main.setMesh(prevMeshForUndo);
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
    const wasQuad = mesh.isQuad;

    // 2. Capture NEW state for REDO
    const newFaces = new Uint32Array(data.f);
    const newVerts = new Float32Array(data.v);

    const undoQuads = () => {
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

    const redoQuads = () => {
      mesh.setVertices(newVerts);
      mesh.setNbVertices(newVerts.length / 3);
      mesh.setFaces(newFaces);
      mesh.setNbFaces(newFaces.length / 4);
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
    newMesh.initRender(); // <-- Generate Three.js geometry!
    newMesh.isQuad = true; // Remeshed output is quads!

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
  }
  addSculptToScene(scene) {
    return this.getCurrentTool().addSculptToScene(scene);
  }
}

export default SculptManager;
