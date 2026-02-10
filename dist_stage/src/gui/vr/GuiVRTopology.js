import Enums from '../../misc/Enums.js?v=fix_3';
import Remesh from '../../editing/Remesh.js?v=fix_3';

import Multimesh from '../../mesh/multiresolution/Multimesh.js?v=fix_3';
import MeshDynamic from '../../mesh/dynamic/MeshDynamic.js?v=fix_3';

export default function getTopologyWidgets(main) {
  const widgets = [];

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


  // --- REMESH ---
  widgets.push({ type: 'info', label: 'Remesh', x: col1X, y: y });
  y += gapHeader;

  // Resolution Slider
  widgets.push({
    type: 'slider', id: 'voxelRes', label: 'Resolution', x: col1X, y: y, w: 350, h: 40,
    value: Remesh.RESOLUTION, min: 8, max: 400, step: 1,
    onInput: (val) => {
      Remesh.RESOLUTION = val;
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
