import Enums from '../../misc/Enums.js';
import TR from '../GuiTR.js';

export default function getSettingsWidgets(main) {
  const widgets = [];
  const menuW = 400;
  let y = 10;
  const ITEM_H = 40;
  const HEADER_H = 30;
  const GAP = 5;

  // --- INPUT ---
  widgets.push({ type: 'header', label: 'Input', x: 0, y: y, w: menuW, h: HEADER_H, header: true });
  y += HEADER_H + GAP;

  widgets.push({
    type: 'checkbox', id: 'left_hand_mode', label: 'Left Hand Mode', x: 0, y: y, w: menuW, h: ITEM_H,
    value: main._dominantHand === 'left',
    onInteract: () => {
      const newHand = main._dominantHand === 'left' ? 'right' : 'left';
      if (main.setDominantHand) main.setDominantHand(newHand);
    }
  });
  y += ITEM_H + GAP;

  widgets.push({
    type: 'checkbox', id: 'aim_picking_mode', label: 'Aim Picking Mode (Raycast)', x: 0, y: y, w: menuW, h: ITEM_H,
    value: !main._vrUseVolumeIntersect,
    onInteract: () => {
      main._vrUseVolumeIntersect = !main._vrUseVolumeIntersect;
      if (main.guiXR) main.guiXR._needsRedraw = true;
    }
  });
  y += ITEM_H + GAP;

  widgets.push({
    type: 'slider', id: 'trigger_curve', label: 'Trigger Sensitivity', x: 0, y: y, w: menuW, h: ITEM_H,
    min: 0.0, max: 1.0, step: 0.05,
    value: main._guiXR && main._guiXR._uiSettings.triggerCurve !== undefined ? main._guiXR._uiSettings.triggerCurve : 0.5,
    onInput: (val) => {
      if (main._guiXR) {
        main._guiXR._uiSettings.triggerCurve = val;
      }
    }
  });
  y += ITEM_H + GAP;


  widgets.push({ type: 'header', label: 'Calibration', x: 0, y: y, w: menuW, h: HEADER_H, header: true });
  y += HEADER_H + GAP;

  widgets.push({
    type: 'slider', id: 'offsetY', label: 'Head Height', x: 0, y: y, w: menuW, h: ITEM_H,
    min: -2.0, max: 0.0, step: 0.1,
    value: main.getGui()._uiXR && main.getGui()._uiXR._uiSettings.offsetY !== undefined ? main.getGui()._uiXR._uiSettings.offsetY : -1.2,
    onInteract: (val) => {
      // Store globally for persistence
      if (main.getGui()._uiXR) {
        main.getGui()._uiXR._uiSettings.offsetY = val;
      }
      // Apply immediately
      main.updateVROffsets();
    }
  });
  y += ITEM_H + GAP;

  widgets.push({ type: 'header', label: 'Profiling & Debug', x: 0, y: y, w: menuW, h: HEADER_H, header: true });
  y += HEADER_H + GAP;

  widgets.push({
    type: 'button', id: 'log_perf_profile', label: 'Log Perf Profile (120f)', x: 0, y: y, w: menuW, h: ITEM_H,
    onInteract: () => {
      if (window.debugProfile) window.debugProfile(120);
    }
  });
  y += ITEM_H + GAP;

  widgets.push({
    type: 'button', id: 'log_deep_functions', label: 'Log Deep Functions (60f)', x: 0, y: y, w: menuW, h: ITEM_H,
    onInteract: () => {
      if (window.initDeepProfiler) {
        // Build targets dynamically from the active scene
        const targets = [];
        if (main._sculptManager) targets.push({ name: 'SculptManager', instance: main._sculptManager });
        if (main._mesh) targets.push({ name: 'Mesh', instance: main._mesh });
        if (main._mesh && main._mesh.getRenderData()) targets.push({ name: 'RenderData', instance: main._mesh.getRenderData() });
        if (main._mesh && main._mesh.getMeshData()) targets.push({ name: 'MeshData', instance: main._mesh.getMeshData() });
        if (main._guiXR) targets.push({ name: 'GuiXR', instance: main._guiXR });

        window.initDeepProfiler(targets);

        // Schedule printing after 61 frames (since we profile for 60)
        let fCount = 0;
        const checkDone = () => {
          if (fCount++ > 65) {
            if (window.printDeepProfile) window.printDeepProfile();
          } else {
            requestAnimationFrame(checkDone);
          }
        };
        requestAnimationFrame(checkDone);
      }
    }
  });
  y += ITEM_H + GAP;

  widgets.push({ type: 'header', label: 'Rendering Quality', x: 0, y: y, w: menuW, h: HEADER_H, header: true });
  y += HEADER_H + GAP;

  const wireframeOptions = [
    { label: TR('renderingWireframeTypeSmooth') || 'Wireframe Level 0 Smooth', id: 1 },
    { label: TR('renderingWireframeTypeFast') || 'Wireframe Level 0 Fast', id: 0 },
    { label: TR('renderingWireframeTypeFull') || 'Wireframe Full', id: 2 }
  ];

  widgets.push({
    type: 'combobox',
    id: 'wireframe_type',
    label: '',
    x: 0, y: y, w: menuW, h: ITEM_H,
    value: main.getMesh() ? main.getMesh().getWireframeType() : 1,
    options: wireframeOptions,
    onSelect: (id) => {
      if (main.getMesh()) {
        main.getMesh().setWireframeType(id);
        main.render();
      }
    }
  });
  y += ITEM_H + GAP;

  // Add 150px vertical buffer to ensure it is scrollable and visible above the MiniHUD
  y += 150; 

  return {
    w: menuW, width: menuW,
    h: y + 10, height: y + 10,
    widgets: widgets
  };
}
