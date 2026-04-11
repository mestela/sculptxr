import Enums from '../../misc/Enums.js';
import Remesh from '../../editing/Remesh.js';
import VoxelDensityOverlay from '../../render/VoxelDensityOverlay.js';
import getOptionsURL from '../../misc/getOptionsURL.js';
import Subdivision from '../../editing/Subdivision.js';

import Multimesh from '../../mesh/multiresolution/Multimesh.js';
import MeshDynamic from '../../mesh/dynamic/MeshDynamic.js';
import MeshStatic from '../../mesh/meshStatic/MeshStatic.js';

let activeOperation = 'mesh_to_voxels';
let healState = false;

export default function getTopologyWidgets(main) {
  const widgets = [];

  const savedRes = getOptionsURL().remesh_resolution;
  if (savedRes !== undefined) Remesh.RESOLUTION = savedRes;

  const menuW = 400;
  const col1X = 20;
  const btnH = 50; 
  const gapBtn = 15;
  const gapSection = 30;
  const gapHeader = 30;

  let y = 130;

  const mesh = main.getMesh();
  const isMulti = mesh && mesh._meshes;
  const isDyn = mesh ? mesh.isDynamic : false;

  // --- 1. MULTIRESOLUTION ---
  widgets.push({ type: 'info', label: 'Multiresolution', x: col1X, y: y });
  y += gapHeader;

  if (isMulti) {
    const numLevels = mesh._meshes.length;
    widgets.push({ type: 'info', label: `Level ${mesh._sel} of ${numLevels - 1}, ${mesh.getNbVertices().toLocaleString()} vertices`, x: col1X, y: y });
    y += 30;
    widgets.push({ type: 'info', label: `Level 0: ${mesh._meshes[0].getNbVertices().toLocaleString()} vertices`, x: col1X, y: y });
    y += 30;
    widgets.push({ type: 'info', label: `Level ${numLevels - 1}: ${mesh._meshes[numLevels - 1].getNbVertices().toLocaleString()} vertices`, x: col1X, y: y });
    y += 40;

    const canDown = mesh._sel > 0;
    const canUp = mesh._sel < mesh._meshes.length - 1;

    widgets.push({
      type: 'button', id: 'level_down', label: 'Level -', x: col1X, y: y, w: 150, h: btnH,
      disabled: !canDown,
      onInteract: () => {
        if (canDown) {
          main.getGui()._ctrlTopology.onResolutionChanged(mesh._sel);
          if (main.guiXR) main.guiXR._needsRedraw = true;
        }
      }
    });

    widgets.push({
      type: 'button', id: 'level_up', label: 'Level +', x: 180, y: y, w: 150, h: btnH,
      disabled: !canUp,
      onInteract: () => {
        if (canUp) {
          main.getGui()._ctrlTopology.onResolutionChanged(mesh._sel + 2);
          if (main.guiXR) main.guiXR._needsRedraw = true;
        }
      }
    });
    y += btnH + gapBtn;
  }

  const canSubdivide = !isMulti || (isMulti && mesh._sel === mesh._meshes.length - 1);
  const canReverse = !isMulti || (isMulti && mesh._sel === 0);

  widgets.push({
    type: 'button', id: 'subdivide', label: 'Subdivide', x: col1X, y: y, w: 150, h: btnH,
    disabled: !mesh,
    onInteract: () => {
      if (!mesh) return;
      if (main.getGui() && main.getGui()._ctrlTopology) {
        main.getGui()._ctrlTopology.subdivide();
        if (main.guiXR) main.guiXR._needsRedraw = true;
      }
    }
  });

  widgets.push({
    type: 'button', id: 'reverse', label: 'Reverse', x: 180, y: y, w: 150, h: btnH,
    disabled: !isMulti || !canReverse,
    onInteract: () => {
      if (main.getGui() && main.getGui()._ctrlTopology) {
        main.getGui()._ctrlTopology.reverse();
        if (main.guiXR) main.guiXR._needsRedraw = true;
      }
    }
  });
  y += btnH + gapBtn;

  const hasLower = isMulti && mesh._sel > 0;
  const hasHigher = isMulti && mesh._sel < mesh._meshes.length - 1;

  widgets.push({
    type: 'button', id: 'del_lower', label: 'Del Lower', x: col1X, y: y, w: 150, h: btnH,
    disabled: !hasLower,
    onInteract: () => {
      if (main.getGui() && main.getGui()._ctrlTopology) {
        main.getGui()._ctrlTopology.deleteLower();
        if (main.guiXR) main.guiXR._needsRedraw = true;
      }
    }
  });
  widgets.push({
    type: 'button', id: 'del_higher', label: 'Del Higher', x: 180, y: y, w: 150, h: btnH,
    disabled: !hasHigher,
    onInteract: () => {
      if (main.getGui() && main.getGui()._ctrlTopology) {
        main.getGui()._ctrlTopology.deleteHigher();
        if (main.guiXR) main.guiXR._needsRedraw = true;
      }
    }
  });
  y += btnH + gapBtn;

  widgets.push({
    type: 'button', id: 'reset_base', label: 'Jump to 0 & Del Higher', x: col1X, y: y, w: 350, h: btnH,
    disabled: !(isMulti && mesh._meshes.length > 1),
    onInteract: () => {
      const mul = main.getMesh();
      if (mul && mul._meshes && mul._meshes.length > 1) {
        mul.selectResolution(0);
        mul.deleteHigher();
        if (main.getGui() && main.getGui()._ctrlTopology) {
          main.getGui()._ctrlTopology.updateMeshResolution();
        }
        if (main.guiXR) main.guiXR._needsRedraw = true;
      }
    }
  });
  y += btnH + gapSection;


  // --- 2. OPERATIONS (COMBOBOX PANEL) ---
  widgets.push({ type: 'info', label: 'Operations', x: col1X, y: y });
  y += gapHeader;

  const operationOptions = [
    { label: 'Mesh to Voxels', id: 'mesh_to_voxels' },
    { label: 'Quad Remesher (Instant Meshes)', id: 'quad_remesher' },
    { label: 'Cut in Half (Manifold)', id: 'manifold_slice' },
    { label: 'Remesh (Voxels)', id: 'remesh_voxels' },
    { label: 'Decimate (Baby Shark)', id: 'decimate' },
    { label: 'Tri Remesher (Baby Shark)', id: 'tri_remesher' }
  ];

  widgets.push({
    type: 'combobox',
    id: 'topology_operation',
    label: '',
    x: col1X, y: y, w: 450, h: btnH,
    value: activeOperation,
    options: operationOptions,
    onSelect: (id) => {
      activeOperation = id;
      if (main.guiXR) main.guiXR._needsRedraw = true;
    }
  });
  y += btnH + gapBtn;

  // Sub-Panel for Active Operation
  if (activeOperation === 'mesh_to_voxels') {
    // Voxel Convert Mode
    widgets.push({
      type: 'slider', id: 'voxelConvertRes', label: 'Voxel Density', x: col1X, y: y, w: 350, h: 40,
      value: Math.min(1, Math.sqrt(Remesh.RESOLUTION / 200)), min: 0, max: 1, step: 0.01,
      getDisplayValue: (val) => (Math.pow(val, 2) * 200).toFixed(0),
      onInput: (val) => {
        const actualRes = Math.round(Math.pow(val, 2) * 200);
        Remesh.RESOLUTION = actualRes;
        getOptionsURL.saveOption('remesh_resolution', actualRes, 500);
        if (mesh) VoxelDensityOverlay.enable(mesh, actualRes);
      },
      onRelease: () => {
        VoxelDensityOverlay.disable();
      }
    });
    y += 40 + gapBtn;

    widgets.push({
      type: 'button', id: 'mesh_to_voxel', label: 'Convert Mesh to Voxels', x: col1X, y: y, w: 350, h: btnH,
      disabled: !mesh || mesh.isVoxel,
      onInteract: () => {
        if (!mesh || mesh.isVoxel) return;
        if (main.getSculptManager().meshToVoxel) {
          main.getSculptManager().meshToVoxel();
          main.getSculptManager().setToolIndex(Enums.Tools.VOXEL);
          window._activeToolTab = 2;
          if (main.guiXR) { main.guiXR.refreshToolsWidget(); main.guiXR._needsRedraw = true; }
          if (main._guiMini) { main._guiMini.refreshToolsWidget(); main._guiMini._needsRedraw = true; }
        }
      }
    });
    y += btnH + gapSection;

  } else if (activeOperation === 'quad_remesher') {
    // Instant Meshes Mode
    if (Remesh.TARGET_QUADS === undefined) Remesh.TARGET_QUADS = 1000;

    widgets.push({
      type: 'slider', id: 'quadTargetFaces', label: 'Target Faces', x: col1X, y: y, w: 350, h: 40,
      value: Remesh.TARGET_QUADS, min: 100, max: 10000, step: 100,
      onInput: (val) => { Remesh.TARGET_QUADS = val; }
    });
    y += 40 + gapBtn;

    const isRemeshProcessing = main.getSculptManager().isProcessingQuads ? main.getSculptManager().isProcessingQuads() : false;
    const quadLabel = window._topologyOpFailed ? 'Failed!' : (isRemeshProcessing ? 'Processing...' : 'Quadremesh');
    widgets.push({
      type: 'button', id: 'remesh_quads', label: quadLabel, disabled: isRemeshProcessing, x: col1X, y: y, w: 350, h: btnH,
      onInteract: () => {
        if (main.getSculptManager().remeshQuads) {
          main.getSculptManager().remeshQuads(Remesh.TARGET_QUADS);
        }
      }
    });
    y += btnH + gapSection;

  } else if (activeOperation === 'manifold_slice') {
    // Slice + Cap Mode
    widgets.push({
      type: 'button', id: 'slice_and_cap', label: 'Slice + Cap Symmetry', x: col1X, y: y, w: 350, h: btnH,
      onInteract: () => {
        if (main.getSculptManager().sliceAndCap) {
          main.getSculptManager().sliceAndCap();
        }
      }
    });
    y += btnH + gapSection;

  } else if (activeOperation === 'remesh_voxels') {
    // General Remeshing Mode
    widgets.push({
      type: 'slider', id: 'voxelRes', label: 'Resolution', x: col1X, y: y, w: 350, h: 40,
      value: Remesh.RESOLUTION, min: 8, max: 400, step: 1,
      onInput: (val) => {
        Remesh.RESOLUTION = val;
        if (mesh) VoxelDensityOverlay.poke(mesh, val);
      }
    });
    y += 40 + gapBtn;

    widgets.push({
      type: 'button', id: 'remesh', label: 'Remesh', x: col1X, y: y, w: 350, h: btnH,
      onInteract: () => {
        if (main.getGui() && main.getGui()._ctrlTopology) {
          main.getGui()._ctrlTopology.remesh();
          if (main.guiXR) main.guiXR._needsRedraw = true;
        }
      }
    });
    y += btnH + gapSection;

  } else if (activeOperation === 'decimate') {
    // Decimation Mode
    if (window.decimationTargetFaces === undefined) window.decimationTargetFaces = 5000;

    widgets.push({
      type: 'slider', id: 'decimateTargetFaces', label: 'Target Faces', x: col1X, y: y, w: 350, h: 40,
      value: window.decimationTargetFaces, min: 100, max: 50000, step: 100,
      getDisplayValue: (val) => val.toFixed(0),
      onInput: (val) => { window.decimationTargetFaces = val; }
    });
    y += 40 + gapBtn;

    const isDecimateProcessing = main.getSculptManager().isProcessingQuads ? main.getSculptManager().isProcessingQuads() : false;
    const decLabel = window._topologyOpFailed ? 'Failed!' : (isDecimateProcessing ? 'Processing...' : 'Decimate Mesh');
    widgets.push({
      type: 'button', id: 'decimate_mesh', label: decLabel, disabled: isDecimateProcessing, x: col1X, y: y, w: 350, h: btnH,
      onInteract: () => {
        const targetFaces = window.decimationTargetFaces || 5000;
        main.getSculptManager().simplifyMesh(targetFaces, 0.001);
        if (main.guiXR) main.guiXR._needsRedraw = true;
      }
    });
    y += btnH + gapSection;

  } else if (activeOperation === 'tri_remesher') {
    // Isotropic Tri Remesher Mode
    if (window.remeshEdgeLength === undefined) window.remeshEdgeLength = 0.1;

    widgets.push({
      type: 'slider', id: 'remeshEdgeLength', label: 'Edge Length', x: col1X, y: y, w: 350, h: 40,
      value: window.remeshEdgeLength, min: 0.01, max: 1.0, step: 0.01,
      getDisplayValue: (val) => val.toFixed(2),
      onInput: (val) => { window.remeshEdgeLength = val; }
    });
    y += 40 + gapBtn;

    const isIsoProcessing = main.getSculptManager().isProcessingQuads ? main.getSculptManager().isProcessingQuads() : false;
    const isoLabel = window._topologyOpFailed ? 'Failed!' : (isIsoProcessing ? 'Processing...' : 'Remesh Isotropic');
    widgets.push({
      type: 'button', id: 'remesh_isotropic', label: isoLabel, disabled: isIsoProcessing, x: col1X, y: y, w: 350, h: btnH,
      onInteract: () => {
        const edgeLength = window.remeshEdgeLength || 0.1;
        main.getSculptManager().remeshIsotropic(edgeLength);
        if (main.guiXR) main.guiXR._needsRedraw = true;
      }
    });
    y += btnH + gapSection;
  }


  // --- 3. UTILITIES ---
  widgets.push({ type: 'info', label: 'Utilities', x: col1X, y: y });
  y += gapHeader;

  widgets.push({
    type: 'button', id: 'validate_topo_counts', label: 'Validate Topology (Counts)', x: col1X, y: y, w: 350, h: btnH,
    onInteract: () => {
      if (window.validateMesh) {
        window.validateMesh();
      }
    }
  });
  y += btnH + gapBtn;

  widgets.push({
    type: 'button', id: 'repair_winding_orders', label: 'Repair Winding Orders', x: col1X, y: y, w: 350, h: btnH,
    onInteract: () => {
      if (window.repairWindingOrders) {
        window.repairWindingOrders();
      }
    }
  });
  y += btnH + gapBtn;

  widgets.push({
    type: 'checkbox', id: 'quad_skip_quads', label: 'Skip Quads', x: col1X, y: y, w: 170, h: 30,
    value: window.quadSkipQuads || false,
    onInteract: (val) => { window.quadSkipQuads = val; }
  });
  y += 30 + 10;

  widgets.push({
    type: 'button', id: 'quad_manual', label: 'Quadrangulate', x: col1X, y: y, w: 170, h: btnH,
    onInteract: () => {
      if (!mesh) return;
      const tool = main.getSculptManager().getTool(Enums.Tools.VOXEL);
      if (tool && tool._worker) {
        tool._worker.postMessage({
          type: 'QUADRANGULATE_ONLY',
          v: mesh.getVertices(),
          f: mesh.getFaces(),
          c: mesh.getColors(),
          skipsQuads: window.quadSkipQuads || false,
          rejectSeams: false,
          symmetryX: mesh.getSymmetryOrigin ? mesh.getSymmetryOrigin()[0] : 0
        });
      }
    }
  });

  widgets.push({
    type: 'button', id: 'tri_manual', label: 'Triangulate', x: col1X + 180, y: y, w: 170, h: btnH,
    onInteract: () => {
      if (!mesh) return;
      const tool = main.getSculptManager().getTool(Enums.Tools.VOXEL);
      if (tool && tool._worker) {
        tool._worker.postMessage({
          type: 'TRIANGULATE_ONLY',
          v: mesh.getVertices(),
          f: mesh.getFaces()
        });
      }
    }
  });
  y += btnH + gapBtn;

  widgets.push({
    type: 'button', id: 'voxel_mirror_lr', label: 'Mirror L \u2192 R', x: col1X, y: y, w: 170, h: btnH,
    onInteract: () => {
      console.log('[GuiVRTopology] Mirror L->R button clicked!');
      if (window.screenLog) window.screenLog('[GuiVRTopology] Mirror L->R clicked', 'cyan');
      if (mesh) {
        const wasDynamic = mesh.isDynamic;
        if (!mesh.isDynamic) {
            console.log('[GuiVRTopology] Triggering static quad/triangle symmetryMirror(-1)');
            main.getSculptManager().symmetryMirror(-1);
            if (main.guiXR) main.guiXR._needsRedraw = true;
            return;
        }
        let nmesh = Remesh.voxelMirror(mesh, 0);
        if (wasDynamic) nmesh = new MeshDynamic(nmesh);
        main.getStateManager().pushStateAddRemove(nmesh, [mesh]);
        main.getMeshes().splice(main.getIndexMesh(mesh), 1);
        main.getMeshes().push(nmesh);
        main.setMesh(nmesh);
        if (main.guiXR) main.guiXR._needsRedraw = true;
      }
    }
  });

  widgets.push({
    type: 'button', id: 'voxel_mirror_rl', label: 'Mirror R \u2192 L', x: 200, y: y, w: 170, h: btnH,
    onInteract: () => {
      console.log('[GuiVRTopology] Mirror R->L button clicked!');
      if (window.screenLog) window.screenLog('[GuiVRTopology] Mirror R->L clicked', 'cyan');
      if (mesh) {
        if (!mesh.isDynamic) {
            console.log('[GuiVRTopology] Triggering static quad/triangle symmetryMirror(1)');
            main.getSculptManager().symmetryMirror(1);
            if (main.guiXR) main.guiXR._needsRedraw = true;
            return;
        }
        let nmesh = Remesh.voxelMirror(mesh, 1);
        const wasDynamic = mesh.isDynamic;
        if (wasDynamic) nmesh = new MeshDynamic(nmesh);
        main.getStateManager().pushStateAddRemove(nmesh, [mesh]);
        main.getMeshes().splice(main.getIndexMesh(mesh), 1);
        main.getMeshes().push(nmesh);
        main.setMesh(nmesh);
        if (main.guiXR) main.guiXR._needsRedraw = true;
      }
    }
  });
  y += btnH + gapBtn;

  if (window.mirrorSplitOnly === undefined) window.mirrorSplitOnly = false;
  widgets.push({
    type: 'checkbox', id: 'mirror_split_only', label: 'Split Only (Debug Cut)', x: col1X, y: y, w: 350, h: btnH,
    value: window.mirrorSplitOnly,
    onInteract: () => { window.mirrorSplitOnly = !window.mirrorSplitOnly; }
  });
  y += btnH + gapBtn;

  widgets.push({
    type: 'button', id: 'recalc_normals', label: 'Recalculate Normals', x: col1X, y: y, w: 350, h: btnH,
    onInteract: () => {
      if (!mesh) return;
      mesh.updateGeometry();
      mesh.updateGeometryBuffers();
      if (main.guiXR) main.guiXR._needsRedraw = true;
    }
  });
  y += btnH + gapBtn;

  widgets.push({
    type: 'button', id: 'fill_holes', label: 'Fill Holes', x: col1X, y: y, w: 350, h: btnH,
    onInteract: () => {
      if (main.getSculptManager().fillHoles) {
        main.getSculptManager().fillHoles();
      }
    }
  });
  y += btnH + gapBtn;

  widgets.push({
    type: 'checkbox', id: 'auto_heals_manifold', label: 'Heal and Weld (Fix Holes)', x: col1X, y: y, w: 350, h: btnH,
    value: healState,
    onInteract: () => {
      healState = !healState;
      if (main.guiXR) main.guiXR._needsRedraw = true;
    }
  });
  y += btnH + gapBtn;

  widgets.push({
    type: 'button', id: 'validate_manifold', label: 'Validate Manifold (Color Holes)', x: col1X, y: y, w: 350, h: btnH,
    onInteract: () => {
      if (!mesh) return;
      const tool = main.getSculptManager().getTool(Enums.Tools.VOXEL);
      if (tool && tool._worker) {
        tool._worker.postMessage({
          type: 'VALIDATE_MANIFOLD',
          v: mesh.getVertices(),
          f: mesh.getFaces(),
          isTriangles: !mesh.isQuad,
          heal: healState
        });
      }
    }
  });
  y += btnH + gapSection;


  // --- 4. DYNAMIC TOPOLOGY ---
  widgets.push({ type: 'info', label: 'Dynamic Topology', x: col1X, y: y });
  y += gapHeader;

  widgets.push({
    type: 'checkbox', id: 'dynamic', label: 'Activated', x: col1X, y: y, w: 350, h: btnH,
    value: isDyn,
    onInteract: () => {
      if (main.getGui() && main.getGui()._ctrlTopology) {
        main.getGui()._ctrlTopology.dynamicToggleActivate();
        if (main.guiXR) main.guiXR._needsRedraw = true;
      }
    }
  });
  y += btnH + gapBtn;

  widgets.push({
    type: 'slider', id: 'dyn_subd', label: 'Subdivision', x: col1X, y: y, w: 350, h: 40,
    value: MeshDynamic.SUBDIVISION_FACTOR, min: 0, max: 100, step: 1,
    disabled: !isDyn,
    onInput: (val) => { MeshDynamic.SUBDIVISION_FACTOR = val; }
  });

  widgets.push({
    type: 'slider', id: 'dyn_dec', label: 'Decimation', x: col1X, y: y + 50, w: 350, h: 40,
    value: MeshDynamic.DECIMATION_FACTOR, min: 0, max: 100, step: 1,
    disabled: !isDyn,
    onInput: (val) => { MeshDynamic.DECIMATION_FACTOR = val; }
  });
  y += 100 + gapBtn;

  widgets.push({
    type: 'checkbox', id: 'dyn_linear', label: 'Linear', x: col1X, y: y, w: 350, h: btnH,
    value: MeshDynamic.LINEAR,
    disabled: !isDyn,
    onInteract: () => {
      MeshDynamic.LINEAR = !MeshDynamic.LINEAR;
      if (main.guiXR) main.guiXR._needsRedraw = true;
    }
  });
  y += btnH + gapSection;

  return widgets;
}
