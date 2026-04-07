import Enums from '../../misc/Enums.js';
import Remesh from '../../editing/Remesh.js';
import VoxelDensityOverlay from '../../render/VoxelDensityOverlay.js';
import getOptionsURL from '../../misc/getOptionsURL.js';
import Subdivision from '../../editing/Subdivision.js';

import Multimesh from '../../mesh/multiresolution/Multimesh.js';
import MeshDynamic from '../../mesh/dynamic/MeshDynamic.js';
import MeshStatic from '../../mesh/meshStatic/MeshStatic.js';

let healState = false; // Persistent toggle across UI redraws

export default function getTopologyWidgets(main) {
  const widgets = [];

  // Load saved voxel resolution
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
  const isMulti = mesh && mesh._meshes; // Multimesh check
  const isDyn = mesh ? mesh.isDynamic : false;

  // --- MULTIRESOLUTION ---
  widgets.push({ type: 'info', label: 'Multiresolution', x: col1X, y: y });
  y += gapHeader;

  if (isMulti) {
    widgets.push({ type: 'info', label: `Current Level: ${mesh._sel}`, x: col1X, y: y });
    y += 40;

    const canDown = mesh._sel > 0;
    const canUp = mesh._sel < mesh._meshes.length - 1;

    widgets.push({
      type: 'button', id: 'level_down', label: 'Level -', x: col1X, y: y, w: 150, h: btnH,
      disabled: !canDown,
      onInteract: () => {
        if (canDown) {
          main.getGui()._ctrlTopology.onResolutionChanged(mesh._sel); // 1-based index (sel-1+1)
          if (main.guiXR) main.guiXR._needsRedraw = true;
        }
      }
    });

    widgets.push({
      type: 'button', id: 'level_up', label: 'Level +', x: 180, y: y, w: 150, h: btnH,
      disabled: !canUp,
      onInteract: () => {
        if (canUp) {
          main.getGui()._ctrlTopology.onResolutionChanged(mesh._sel + 2); // 1-based index (sel+1+1)
          if (main.guiXR) main.guiXR._needsRedraw = true;
        }
      }
    });
    y += btnH + gapBtn;
  }

  // Subdivide / Reverse
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

  // Del Lower / Higher
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
  y += btnH + gapSection;


  // --- VOXEL CONVERSION ---
  widgets.push({ type: 'info', label: 'Voxel Conversion', x: col1X, y: y });
  y += gapHeader;

  // Dedicated Resolution Slider for Voxel Conversion (Logarithmic 0-200)
  widgets.push({
    type: 'slider', id: 'voxelConvertRes', label: 'Voxel Density', x: col1X, y: y, w: 350, h: 40,
    value: Math.min(1, Math.sqrt(Remesh.RESOLUTION / 200)), min: 0, max: 1, step: 0.01,
    getDisplayValue: (val) => (Math.pow(val, 2) * 200).toFixed(0),
    onInput: (val) => {
      const actualRes = Math.round(Math.pow(val, 2) * 200);
      Remesh.RESOLUTION = actualRes;
      getOptionsURL.saveOption('remesh_resolution', actualRes, 500);
      const tMesh = main.getMesh();
      if (tMesh) {
        VoxelDensityOverlay.enable(tMesh, actualRes);
      }
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
      console.log(`[GuiVRTopology] Convert Mesh to Voxels clicked! mesh=${!!mesh} isVoxel=${mesh ? mesh.isVoxel : "N/A"}`);
      if (!mesh || mesh.isVoxel) return;
      if (main.getSculptManager().meshToVoxel) {
        console.log(`[GuiVRTopology] Calling meshToVoxel()`);
        main.getSculptManager().meshToVoxel();
        
        main.getSculptManager().setToolIndex(Enums.Tools.VOXEL);
        if (main.getGuiXR()) {
          main.getGuiXR().refreshToolsWidget(); // Refresh VR tools UI
        }
      } else {
        console.error(`[GuiVRTopology] meshToVoxel method not found on SculptManager!`);
      }
    }
  });
  y += btnH + gapSection;


  // --- QUAD REMESHING ---
  widgets.push({ type: 'info', label: 'Quad Remeshing', x: col1X, y: y });
  y += gapHeader;

  if (Remesh.TARGET_QUADS === undefined) {
    Remesh.TARGET_QUADS = 1000;
  }

  widgets.push({
    type: 'slider', id: 'quadTargetFaces', label: 'Target Faces', x: col1X, y: y, w: 350, h: 40,
    value: Remesh.TARGET_QUADS, min: 100, max: 10000, step: 100,
    onInput: (val) => {
      Remesh.TARGET_QUADS = val;
    }
  });
  y += 40 + gapBtn;

  const isRemeshProcessing = main.getSculptManager().isProcessingQuads ? main.getSculptManager().isProcessingQuads() : false;

  widgets.push({
    type: 'button', id: 'remesh_quads', label: isRemeshProcessing ? 'Processing...' : 'Quadremesh', disabled: isRemeshProcessing, x: col1X, y: y, w: 350, h: btnH,
    onInteract: () => {
      if (main.getSculptManager().remeshQuads) {
        main.getSculptManager().remeshQuads(Remesh.TARGET_QUADS);
      }
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
  y += btnH + gapSection;

  // --- MANIFOLD SLICING ---
  widgets.push({ type: 'info', label: 'Manifold Slicing', x: col1X, y: y });
  y += gapHeader;

  widgets.push({
    type: 'button', id: 'slice_and_cap', label: 'Slice + Cap Symmetry', x: col1X, y: y, w: 350, h: btnH,
    onInteract: () => {
      if (main.getSculptManager().sliceAndCap) {
        main.getSculptManager().sliceAndCap();
      }
    }
  });
  y += btnH + gapSection;

  // --- REMESH ---
  widgets.push({ type: 'info', label: 'Remesh', x: col1X, y: y });
  y += gapHeader;

  // Resolution Slider
  widgets.push({
    type: 'slider', id: 'voxelRes', label: 'Resolution', x: col1X, y: y, w: 350, h: 40,
    value: Remesh.RESOLUTION, min: 8, max: 400, step: 1,
    onInput: (val) => {
      Remesh.RESOLUTION = val;
      const mesh = main.getMesh();
      if (mesh) {
        VoxelDensityOverlay.poke(mesh, val);
      }
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
      console.log(`[GuiVRTopology] Manual Quadrangulate Button clicked!`);
      const mesh = main.getMesh();
      if (!mesh) { console.log(`[GuiVRTopology] No active mesh found!`); return; }
      const tool = main.getSculptManager().getTool(Enums.Tools.VOXEL);
      if (tool && tool._worker) {
        console.log(`[GuiVRTopology] Sending QUADRANGULATE_ONLY to worker...`);
        tool._worker.postMessage({
          type: 'QUADRANGULATE_ONLY',
          v: mesh.getVertices(),
          f: mesh.getFaces(),
          c: mesh.getColors(),
          skipsQuads: window.quadSkipQuads || false,
          rejectSeams: false,
          symmetryX: mesh.getSymmetryOrigin ? mesh.getSymmetryOrigin()[0] : 0
        });
      } else {
        console.log(`[GuiVRTopology] No Voxel tool or worker found!`);
      }
    }
  });

  widgets.push({
    type: 'button', id: 'tri_manual', label: 'Triangulate', x: col1X + 180, y: y, w: 170, h: btnH,
    onInteract: () => {
      console.log(`[GuiVRTopology] Manual Triangulate Button clicked!`);
      const mesh = main.getMesh();
      if (!mesh) { console.log(`[GuiVRTopology] No active mesh found!`); return; }
      const tool = main.getSculptManager().getTool(Enums.Tools.VOXEL);
      if (tool && tool._worker) {
        console.log(`[GuiVRTopology] Sending TRIANGULATE_ONLY to worker...`);
        tool._worker.postMessage({
          type: 'TRIANGULATE_ONLY',
          v: mesh.getVertices(),
          f: mesh.getFaces()
        });
      } else {
        console.log(`[GuiVRTopology] No Voxel tool or worker found!`);
      }
    }
  });
  y += btnH + gapBtn;

  widgets.push({
    type: 'button', id: 'recalc_normals', label: 'Recalculate Normals', x: col1X, y: y, w: 350, h: btnH,
    onInteract: () => {
      console.log(`[GuiVRTopology] Manual Recalculate Normals Button clicked!`);
      const mesh = main.getMesh();
      if (!mesh) { console.log(`[GuiVRTopology] No active mesh found!`); return; }
      mesh.updateGeometry();
      mesh.updateGeometryBuffers();
      if (main.guiXR) main.guiXR._needsRedraw = true;
    }
  });
  y += btnH + gapBtn;
 
   // --- DECIMATION ---
   widgets.push({ type: 'info', label: 'Mesh Decimation', x: col1X, y: y });
   y += gapHeader;
 
   if (window.decimationTargetFaces === undefined) {
     window.decimationTargetFaces = 5000;
   }

   widgets.push({
     type: 'slider', id: 'decimateTargetFaces', label: 'Target Faces', x: col1X, y: y, w: 350, h: 40,
     value: window.decimationTargetFaces, min: 100, max: 50000, step: 100,
     getDisplayValue: (val) => val.toFixed(0),
     onInput: (val) => {
       window.decimationTargetFaces = val;
     }
   });
   y += 40 + gapBtn;
 
   const isDecimateProcessing = main.getSculptManager().isProcessingQuads ? main.getSculptManager().isProcessingQuads() : false;

   widgets.push({
     type: 'button', id: 'decimate_mesh', label: isDecimateProcessing ? 'Processing...' : 'Decimate Mesh', disabled: isDecimateProcessing, x: col1X, y: y, w: 350, h: btnH,
     onInteract: () => {
       console.log(`[GuiVRTopology] Decimate Mesh Button clicked!`);
       const targetFaces = window.decimationTargetFaces || 5000;
       main.getSculptManager().simplifyMesh(targetFaces, 0.001);
       if (main.guiXR) main.guiXR._needsRedraw = true;
     }
   });
   y += btnH + gapSection;

   // --- ISOTROPIC REMESHING ---
   widgets.push({ type: 'info', label: 'Isotropic Remeshing', x: col1X, y: y });
   y += gapHeader;
 
   if (window.remeshEdgeLength === undefined) {
     window.remeshEdgeLength = 0.1;
   }

   widgets.push({
     type: 'slider', id: 'remeshEdgeLength', label: 'Edge Length', x: col1X, y: y, w: 350, h: 40,
     value: window.remeshEdgeLength, min: 0.01, max: 1.0, step: 0.01,
     getDisplayValue: (val) => val.toFixed(2),
     onInput: (val) => {
       window.remeshEdgeLength = val;
     }
   });
   y += 40 + gapBtn;
 
   const isIsoProcessing = main.getSculptManager().isProcessingQuads ? main.getSculptManager().isProcessingQuads() : false;

   widgets.push({
     type: 'button', id: 'remesh_isotropic', label: isIsoProcessing ? 'Processing...' : 'Remesh Isotropic', disabled: isIsoProcessing, x: col1X, y: y, w: 350, h: btnH,
     onInteract: () => {
       console.log(`[GuiVRTopology] Remesh Isotropic Button clicked!`);
       const edgeLength = window.remeshEdgeLength || 0.1;
       main.getSculptManager().remeshIsotropic(edgeLength);
       if (main.guiXR) main.guiXR._needsRedraw = true;
     }
   });
   y += btnH + gapSection;

  widgets.push({
    type: 'button', id: 'voxel_mirror_lr', label: 'Mirror L \u2192 R', x: col1X, y: y, w: 170, h: btnH,
    onInteract: () => {
      if (main.getMesh()) {
        const mesh = main.getMesh();
        const wasDynamic = mesh.isDynamic;
        
        if (!mesh.isDynamic) {
            main.getSculptManager().symmetryMirror(-1); // Keep Negative side (Left), mirror to Positive (Right)
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
      if (main.getMesh()) {
        const mesh = main.getMesh();
        if (!mesh.isDynamic) {
            main.getSculptManager().symmetryMirror(1); // Keep positive (Right), mirror to Left
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
      const mesh = main.getMesh();
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
  y += btnH + gapBtn;

  // --- DYNAMIC TOPOLOGY ---
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
    onInput: (val) => {
      MeshDynamic.SUBDIVISION_FACTOR = val;
    }
  });

  widgets.push({
    type: 'slider', id: 'dyn_dec', label: 'Decimation', x: col1X, y: y + 50, w: 350, h: 40,
    value: MeshDynamic.DECIMATION_FACTOR, min: 0, max: 100, step: 1,
    disabled: !isDyn,
    onInput: (val) => {
      MeshDynamic.DECIMATION_FACTOR = val;
    }
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
