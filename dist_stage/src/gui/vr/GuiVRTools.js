import Enums from 'misc/Enums';
import TR from 'gui/GuiTR';
import Tools from 'editing/tools/Tools';
import Picking from 'math3d/Picking';

export default function getToolsWidgets(main, activeToolIndex) {
  if (activeToolIndex === undefined) activeToolIndex = main.getSculptManager().getToolIndex();
  const widgets = [];

  // Spacing Constants
  const col1X = 20;
  const btnH = 50; // Dense
  const gapBtn = 15;
  const gapSection = 30;
  const gapHeader = 30;

  let y = 130;

  // 1. Tool Selection (Combobox)
  // Removing "Tool" italic header to match desktop 1:1 more closely or just saving space
  widgets.push({ type: 'info', label: 'Tool', x: col1X, y: y }); 
  y += gapHeader;

  // Build Options from Tools array
  const toolOptions = Tools.map((t, i) => ({ label: TR(t.uiName), id: i }));

  widgets.push({
    type: 'combobox',
    id: 'tool_select',
    label: 'Tool',
    x: col1X, y: y, w: 320, h: btnH,
    value: activeToolIndex,
    options: toolOptions,
    onSelect: (id) => {
      main.getSculptManager().setToolIndex(id);
      if (main.guiXR) main.guiXR.refreshToolsWidget();
    }
  });
  y += btnH + gapSection;


  // 2. Brush Settings
  const activeTool = main.getSculptManager().getTool(activeToolIndex);

  // Radius
  widgets.push({
    type: 'slider',
    id: 'radius',
    label: 'Radius',
    x: col1X, y: y, w: 350, h: 40,
    value: activeTool ? activeTool._radius : 50,
    min: 5, max: 250, precision: 0,
    onInput: (val) => { if (activeTool) { activeTool._radius = val; main.render(); } }
  });

  // Intensity
  widgets.push({
    type: 'slider',
    id: 'intensity',
    label: 'Intensity',
    x: 400, y: y, w: 350, h: 40,
    value: activeTool ? activeTool._intensity : 0.5,
    min: 0, max: 1, precision: 2,
    onInput: (val) => { if (activeTool) { activeTool._intensity = val; main.render(); } }
  });
  y += 40 + gapSection;

  // Negative, Clay, Accumulate, Thin surface
  widgets.push({
    type: 'checkbox',
    id: 'negative',
    label: 'Negative (N or -Alt)',
    x: col1X, y: y, w: 550, h: btnH,
    value: activeTool ? activeTool._negative : false,
    onInteract: () => {
      if (activeTool) {
        if (window.screenLog) window.screenLog('Toggling Negative', 'yellow');
        activeTool._negative = !activeTool._negative;
        main.render();
        if (main.guiXR) main.guiXR._needsRedraw = true;
      } else {
        if (window.screenLog) window.screenLog('Error: No Active Tool', 'red');
      }
    }
  });
  y += btnH + gapBtn;

  widgets.push({
    type: 'checkbox',
    id: 'clay',
    label: 'Clay',
    x: col1X, y: y, w: 550, h: btnH,
    value: activeTool ? activeTool._clay : false,
    onInteract: () => {
      if (activeTool) {
        if (window.screenLog) window.screenLog('Toggling Clay', 'yellow');
        activeTool._clay = !activeTool._clay;
        main.render();
        if (main.guiXR) main.guiXR._needsRedraw = true;
      }
    }
  });
  y += btnH + gapBtn;

  widgets.push({
    type: 'checkbox',
    id: 'accumulate',
    label: 'Accumulate (no limit per stroke)',
    x: col1X, y: y, w: 550, h: btnH,
    value: activeTool ? activeTool._accumulate : false,
    onInteract: () => {
      if (activeTool) {
        if (window.screenLog) window.screenLog('Toggling Accumulate', 'yellow');
        activeTool._accumulate = !activeTool._accumulate;
        main.render();
        if (main.guiXR) main.guiXR._needsRedraw = true;
      }
    }
  });
  y += btnH + gapBtn;
  widgets.push({
    type: 'checkbox',
    id: 'thin_surface',
    label: 'Thin surface (front vertex only)',
    x: col1X, y: y, w: 550, h: btnH,
    value: activeTool ? activeTool._culling : false, // _culling is likely the prop name
    onInteract: () => {
      if (activeTool) {
        activeTool._culling = !activeTool._culling;
        main.render();
        if (main.guiXR) main.guiXR._needsRedraw = true;
      }
    }
  });
  y += btnH + gapSection;

  // 3. Alpha
  widgets.push({ type: 'info', label: 'Alpha', x: col1X, y: y });
  y += gapHeader;

  // Lock Position
  widgets.push({
    type: 'checkbox',
    id: 'lock_position',
    label: 'Lock position',
    x: col1X, y: y, w: 550, h: btnH,
    value: activeTool ? activeTool._lockPosition : false,
    disabled: !activeTool,
    onInteract: () => {
      if (activeTool && activeTool._lockPosition !== undefined) {
        activeTool._lockPosition = !activeTool._lockPosition;
        if (window.screenLog) window.screenLog(`Lock Position: ${activeTool._lockPosition}`, 'yellow');
        if (main.guiXR) main.guiXR._needsRedraw = true;
      }
    }
  });
  y += btnH + gapBtn;

  // Alpha Texture Combobox
  // We need to map Alpha Names to IDs/Indices for the Combobox
  const alphaNames = Object.keys(Picking.ALPHAS_NAMES);
  const alphaOptions = alphaNames.map((name, i) => ({ label: name, id: i }));

  // Find current index
  let currentAlphaIndex = 0;
  if (activeTool && activeTool._idAlpha) {
    currentAlphaIndex = alphaNames.indexOf(activeTool._idAlpha);
    if (currentAlphaIndex === -1) currentAlphaIndex = 0;
  }

  widgets.push({
    type: 'combobox',
    id: 'alpha_tex',
    label: 'Texture',
    x: col1X, y: y, w: 550, h: btnH,
    options: alphaOptions,
    value: currentAlphaIndex,
    disabled: !activeTool,
    onSelect: (idx) => {
      if (activeTool) {
        const name = alphaNames[idx];
        activeTool._idAlpha = name;
        if (window.screenLog) window.screenLog(`Alpha Set: ${name}`, 'lime');
        // Picking.setIdAlpha() is usually called by the tool on stroke, but we update the tool prop here.
        if (main.guiXR) main.guiXR._needsRedraw = true;
      }
    }
  });
  y += btnH + gapBtn;

  widgets.push({
    type: 'button',
    id: 'alpha_import',
    label: 'Import alpha tex (jpg, png...)',
    x: col1X, y: y, w: 550, h: btnH,
    onInteract: () => {
      // Trigger Desktop File Picker
      const input = document.getElementById('alphaopen');
      if (input) {
        input.click();
        if (window.screenLog) window.screenLog('Desktop File Picker Opened', 'yellow');
      } else {
        if (window.screenLog) window.screenLog('Error: #alphaopen not found', 'red');
      }
    }
  });
  y += btnH + gapSection;


  // 4. Common
  const mgr = main.getSculptManager();
  const showSym = activeToolIndex !== Enums.Tools.TRANSFORM;
  const showContinuous = mgr.canBeContinuous();

  if (showSym || showContinuous) {
    widgets.push({ type: 'info', label: 'Common', x: col1X, y: y });
    y += gapHeader;

    if (showSym) {
      widgets.push({
        type: 'checkbox',
        id: 'symmetry',
        label: 'Symmetry',
        x: col1X, y: y, w: 300, h: btnH,
        value: mgr._symmetry,
        onInteract: () => {
          mgr._symmetry = !mgr._symmetry;
          if (window.screenLog) window.screenLog(`Symmetry: ${mgr._symmetry}`, 'lime');
          main.render();
          if (main.guiXR) main.guiXR._needsRedraw = true;
        }
      });
      y += btnH + gapBtn;
    }

    if (showContinuous) {
      widgets.push({
        type: 'checkbox',
        id: 'continuous',
        label: 'Continuous',
        x: col1X, y: y, w: 300, h: btnH,
        value: mgr._continuous,
        onInteract: () => {
          mgr._continuous = !mgr._continuous;
          if (window.screenLog) window.screenLog(`Continuous: ${mgr._continuous}`, 'lime');
          main.render();
          if (main.guiXR) main.guiXR._needsRedraw = true;
        }
      });
      y += btnH + gapSection;
    } else {
      // If we had a gap for the header but didn't add the continuous button (and symmetry was also hidden? no, if we are here at least one is shown),
      // Actually if showContinuous is false we just skip it.
      // If we are here, at least one of them is true.
      // If showSym was true, we added y += btnH + gapBtn.
      // We might want to ensure the final spacing is correct. 
      // If continuous is hidden, we might have added extra gapBtn after symmetry.
      // Let's just reset standard gap after the block.
    }

    // Ensure consistent spacing after the block if items were added
    // The last item added usually adds its own spacing. 
    // If symmetry was last, it added `gapBtn`. We might want `gapSection` for the next potential section.
    // If continuous was last, it added `gapSection`.
    // Let's just fix the gap of the last added item if needed, but for now simple checks are fine.
    // Actually, if Symmetry is the ONLY one shown, it currently adds `gapBtn` (15) instead of `gapSection` (30).
    // Not a huge deal, but we can fix it.

    // Correction for spacing:
    // If we finished on Symmetry (Continuous hidden), we want gapSection.
    if (showSym && !showContinuous) {
      // Fix last gap
      y -= gapBtn; // remove gapBtn
      y += gapSection; // add gapSection
    }
  }

  return widgets;
}
