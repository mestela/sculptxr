import Enums from '../../misc/Enums.js';
import TR from '../GuiTR.js';

export default function getSettingsWidgets(main) {
  // console.log(`[SculptGL] getSettingsWidgets: main is ${main ? main.constructor.name : 'undefined'}`);
  if (main) {
    // console.log(`[SculptGL] getSettingsWidgets: main._scene is ${main._scene ? main._scene.constructor.name : 'undefined'}`);
    if (main._scene) {
    //   console.log(`[SculptGL] getSettingsWidgets: reloadControllerModels on instance is ${main._scene.reloadControllerModels ? 'present' : 'missing'}`);
    //   console.log(`[SculptGL] getSettingsWidgets: reloadControllerModels on prototype is ${main._scene.constructor.prototype.reloadControllerModels ? 'present' : 'missing'}`);
    }
  }

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
    type: 'checkbox', id: 'ambidextrous_cursors', label: 'Ambidextrous Cursors', x: 0, y: y, w: menuW, h: ITEM_H,
    value: !!main._vrAmbidextrousCursors,
    onInteract: () => {
      main._vrAmbidextrousCursors = !main._vrAmbidextrousCursors;
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

  // --- CONTROLLER MODEL ---
  widgets.push({ type: 'header', label: 'Controller Model Override', x: 0, y: y, w: menuW, h: HEADER_H, header: true });
  y += HEADER_H + GAP;

  const controllerOptions = [
    { label: 'Auto', id: 0 },
    { label: 'meta-quest-touch-plus', id: 1 },
    { label: 'meta-quest-touch-plus-v2', id: 2 },
    { label: 'meta-quest-touch-pro', id: 3 },
    { label: 'oculus-touch-v3', id: 4 },
    { label: 'oculus-touch-v2', id: 5 },
    { label: 'valve-index', id: 6 },
    { label: 'htc-vive', id: 7 },
    { label: 'samsung-galaxyxr', id: 8 },
    { label: 'samsung-odyssey', id: 9 }
  ];

  let currentControllerIndex = controllerOptions.findIndex(o => o.label === (window._xrControllerOverride || 'Auto'));
  if (currentControllerIndex === -1) currentControllerIndex = 0;

  widgets.push({
    type: 'combobox',
    id: 'controller_model',
    label: 'Model Selection',
    x: 0, y: y, w: menuW, h: ITEM_H,
    value: currentControllerIndex,
    options: controllerOptions,
    onSelect: (id) => {
      console.log(`[SculptGL] onSelect called with id: ${id}`);
      const selectedOption = controllerOptions.find(o => o.id === id);
      console.log(`[SculptGL] selectedOption resolved to: ${selectedOption ? selectedOption.label : 'not found'}`);
      if (selectedOption) {
        window._xrControllerOverride = selectedOption.label;
        console.log(`[SculptGL] _xrControllerOverride updated to: ${window._xrControllerOverride}`);
        
        const scene = main || window.app;
        if (window._reloadControllerModels) {
            console.log(`[SculptGL] Invoking reloadControllerModels via global!`);
            window._reloadControllerModels.call(scene);
        } else if (scene && scene.reloadControllerModels) {
            console.log(`[SculptGL] Invoking reloadControllerModels via instance!`);
            scene.reloadControllerModels();
        } else {
            console.log(`[SculptGL] reloadControllerModels not found! (main._scene: ${!!main._scene}, window.app._scene: ${!!(window.app && window.app._scene)}, window._reloadControllerModels: ${!!window._reloadControllerModels})`);
        }
        if (main.render) main.render();
      }
    }
  });
  y += ITEM_H + GAP;

  widgets.push({
    type: 'slider', id: 'wireframe_bias', label: 'Wireframe Bias', x: 0, y: y, w: menuW, h: ITEM_H,
    min: 0.0, max: 0.005, step: 0.0001,
    value: main.getGui()._uiXR && main.getGui()._uiXR._uiSettings.wireframeBias !== undefined ? main.getGui()._uiXR._uiSettings.wireframeBias : 0.001,
    precision: 4, // Allow viewing full 0.0001 increments
    onInput: (val) => {
      // GuiXR now passes absolute values!
      if (main.getGui()._uiXR) {
        main.getGui()._uiXR._uiSettings.wireframeBias = val;
      }
      if (window.app && window.app.getMesh()) {
        const wireMesh = window.app.getMesh().getRenderData()._wireframeMesh;
        if (wireMesh && wireMesh.material && wireMesh.material.uniforms) {
          wireMesh.material.uniforms.uBias.value = val;
        }
      }
    }
  });
  y += ITEM_H + GAP;

  widgets.push({
    type: 'slider', id: 'wireframe_alpha', label: 'Wireframe Opacity', x: 0, y: y, w: menuW, h: ITEM_H,
    min: 0.0, max: 1.0, step: 0.05,
    value: main.getGui()._uiXR && main.getGui()._uiXR._uiSettings.wireframeAlpha !== undefined ? main.getGui()._uiXR._uiSettings.wireframeAlpha : 0.2, // Default 0.2
    precision: 2, // Percentage (0.00 to 1.00)
    onInput: (val) => {
      if (main.getGui()._uiXR) {
        main.getGui()._uiXR._uiSettings.wireframeAlpha = val;
      }
      if (window.app && window.app.getMesh()) {
        const wireMesh = window.app.getMesh().getRenderData()._wireframeMesh;
        if (wireMesh && wireMesh.material && wireMesh.material.uniforms) {
          wireMesh.material.uniforms.uOpacity.value = val;
        }
      }
    }
  });
  y += ITEM_H + GAP;

  widgets.push({
    type: 'slider', id: 'menu_brightness', label: 'Menu Brightness', x: 0, y: y, w: menuW, h: ITEM_H,
    min: 0.0, max: 1.0, step: 0.05,
    value: main._guiXR && main._guiXR._uiSettings.menuBrightness !== undefined ? main._guiXR._uiSettings.menuBrightness : 0.5,
    precision: 2,
    onInput: (val) => {
      if (main._guiXR) {
        main._guiXR._uiSettings.menuBrightness = val;
        main._guiXR._needsRedraw = true;
      }
      if (main._guiMini) {
        main._guiMini._uiSettings.menuBrightness = val;
        main._guiMini._needsRedraw = true;
      }
      if (main._guiPopup) {
        main._guiPopup._uiSettings.menuBrightness = val;
        main._guiPopup._needsRedraw = true;
      }
    }
  });
  y += ITEM_H + GAP;

  widgets.push({
    type: 'slider', id: 'menu_saturation', label: 'Menu Saturation', x: 0, y: y, w: menuW, h: ITEM_H,
    min: 0.0, max: 1.0, step: 0.05,
    value: main._guiXR && main._guiXR._uiSettings.menuSaturation !== undefined ? main._guiXR._uiSettings.menuSaturation : 0.5,
    precision: 2,
    onInput: (val) => {
      if (main._guiXR) {
        main._guiXR._uiSettings.menuSaturation = val;
        main._guiXR._needsRedraw = true;
      }
      if (main._guiMini) {
        main._guiMini._uiSettings.menuSaturation = val;
        main._guiMini._needsRedraw = true;
      }
      if (main._guiPopup) {
        main._guiPopup._uiSettings.menuSaturation = val;
        main._guiPopup._needsRedraw = true;
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
    value: main.getMesh() ? main.getMesh().getWireframeType() : ((typeof navigator !== 'undefined' && /OculusBrowser|Mobile VR|Mobile|Android/i.test(navigator.userAgent)) ? 0 : 1),
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

  // console.log(`[SculptGL] getSettingsWidgets returning ${widgets.length} widgets:`);
  // widgets.forEach(w => console.log(`  - ${w.type} (${w.label || w.id || 'none'})`));
  return {
    w: menuW, width: menuW,
    h: y + 10, height: y + 10,
    widgets: widgets
  };
}
