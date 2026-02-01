import Enums from 'misc/Enums';
import TR from 'gui/GuiTR';
import Tools from 'editing/tools/Tools';

export default function getToolsWidgets(main, activeToolIndex) {
  const widgets = [];

  // Spacing Constants
  const col1X = 20;
  const btnH = 60;
  const gapBtn = 20;
  const gapSection = 40;
  const gapHeader = 40;

  let y = 130;

  // 1. Tool Selection (Combobox)
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
  widgets.push({ type: 'slider', id: 'radius', label: 'Radius (-X)', x: col1X, y: y, w: 350, h: 40, value: 0.5 });
  widgets.push({ type: 'slider', id: 'intensity', label: 'Intensity (-C)', x: 400, y: y, w: 350, h: 40, value: 0.5 });
  y += 40 + gapSection;

  const activeTool = main.getSculptManager().getTool(activeToolIndex);

  // Negative, Clay, Accumulate, Thin surface
  widgets.push({ type: 'checkbox', id: 'negative', label: 'Negative (N or -Alt)', x: col1X, y: y, w: 400, h: btnH, value: activeTool ? activeTool._negative : false });
  y += btnH + gapBtn;
  widgets.push({ type: 'checkbox', id: 'clay', label: 'Clay', x: col1X, y: y, w: 400, h: btnH, value: activeTool ? activeTool._clay : false });
  y += btnH + gapBtn;
  widgets.push({ type: 'checkbox', id: 'accumulate', label: 'Accumulate (no limit per stroke)', x: col1X, y: y, w: 400, h: btnH, value: activeTool ? activeTool._accumulate : false });
  y += btnH + gapBtn;
  widgets.push({ type: 'checkbox', id: 'thin_surface', label: 'Thin surface (front vertex only)', x: col1X, y: y, w: 400, h: btnH, disabled: true }); // Not sure if exposed easily, marking disabled for now or check prop
  y += btnH + gapSection;


  // 3. Alpha
  widgets.push({ type: 'info', label: 'Alpha', x: col1X, y: y });
  y += gapHeader;

  widgets.push({ type: 'checkbox', id: 'lock_position', label: 'Lock position', x: col1X, y: y, w: 400, h: btnH, disabled: true });
  y += btnH + gapBtn;

  widgets.push({ type: 'combobox', id: 'alpha_tex', label: 'Texture', x: col1X, y: y, w: 400, h: btnH, options: [{ label: 'None', id: 0 }], value: 0, disabled: true });
  y += btnH + gapBtn;

  widgets.push({ type: 'button', id: 'alpha_import', label: 'Import alpha tex (jpg, png...)', x: col1X, y: y, w: 400, h: btnH, disabled: true });
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
