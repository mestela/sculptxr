import Enums from 'misc/Enums';
import TR from 'gui/GuiTR';
import Tools from 'editing/tools/Tools';

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
    x: col1X, y: y, w: 400, h: btnH,
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

  widgets.push({ type: 'checkbox', id: 'lock_position', label: 'Lock position', x: col1X, y: y, w: 550, h: btnH, disabled: true });
  y += btnH + gapBtn;

  widgets.push({ type: 'combobox', id: 'alpha_tex', label: 'Texture', x: col1X, y: y, w: 550, h: btnH, options: [{ label: 'None', id: 0 }], value: 0, disabled: true });
  y += btnH + gapBtn;

  widgets.push({ type: 'button', id: 'alpha_import', label: 'Import alpha tex (jpg, png...)', x: col1X, y: y, w: 550, h: btnH, disabled: true });
  y += btnH + gapSection;


  // 4. Common
  widgets.push({ type: 'info', label: 'Common', x: col1X, y: y });
  y += gapHeader;

  widgets.push({ type: 'checkbox', id: 'symmetry', label: 'Symmetry', x: col1X, y: y, w: 300, h: btnH, value: main.getSculptManager()._symmetry });
  y += btnH + gapBtn;
  widgets.push({ type: 'checkbox', id: 'continuous', label: 'Continuous', x: col1X, y: y, w: 300, h: btnH, disabled: true });
  y += btnH + gapSection;

  return widgets;
}
