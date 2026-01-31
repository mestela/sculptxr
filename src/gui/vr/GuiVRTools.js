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
  widgets.push({ type: 'info', label: 'SCULPT TOOL', x: col1X, y: y });
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
      // Enums.Tools keys are mapped by index if Tools array is ordered same as Enums?
      main.getSculptManager().setToolIndex(id);
      if (main.guiXR) main.guiXR.refreshToolsWidget();
    }
  });
  y += btnH + gapSection;


  // 2. Common Settings (Symmetry, Continuous)
  widgets.push({ type: 'info', label: 'COMMON', x: col1X, y: y });
  y += gapHeader;

  widgets.push({ type: 'checkbox', id: 'symmetry', label: 'Symmetry', x: col1X, y: y, w: 300, h: btnH, value: main.getSculptManager()._symmetry });
  y += btnH + gapSection;


  // 3. Radius / Intensity
  // Sliders
  widgets.push({ type: 'slider', id: 'radius', label: 'Radius', x: col1X, y: y, w: 350, h: 40, value: 0.5 });
  widgets.push({ type: 'slider', id: 'intensity', label: 'Intensity', x: 400, y: y, w: 350, h: 40, value: 0.5 });
  y += 40 + gapSection;


  // 4. Alpha (Mockup)
  widgets.push({ type: 'info', label: 'ALPHA', x: col1X, y: y });
  y += gapHeader;

  widgets.push({ type: 'button', id: 'alpha_import', label: 'Import Alpha', x: col1X, y: y, w: 250, h: btnH, disabled: true });
  y += btnH + gapSection;


  // 5. Tool Specifics
  if (activeToolIndex === Enums.Tools.PAINT) {
    widgets.push({ type: 'info', label: 'PAINT', x: col1X, y: y });
    y += gapHeader;

    widgets.push({ type: 'slider', id: 'roughness', label: 'Roughness', x: col1X, y: y, w: 300, h: 40, value: 0.5 });
    widgets.push({ type: 'slider', id: 'metallic', label: 'Metallic', x: 340, y: y, w: 300, h: 40, value: 0 });
    y += 40 + gapBtn;

    // We need logic for these writes. GuiXR has special cases for 'write_albedo' etc.
    const tool = main.getSculptManager().getTool(Enums.Tools.PAINT);

    widgets.push({ type: 'checkbox', id: 'write_albedo', label: 'Albedo', x: col1X, y: y, w: 150, h: btnH, value: tool._writeAlbedo });
    widgets.push({ type: 'checkbox', id: 'write_roughness', label: 'Rough', x: 180, y: y, w: 150, h: btnH, value: tool._writeRoughness });
    widgets.push({ type: 'checkbox', id: 'write_metalness', label: 'Metal', x: 340, y: y, w: 150, h: btnH, value: tool._writeMetalness });
    y += btnH + gapBtn;

    widgets.push({ type: 'colorpicker_embedded', id: 'picker', x: col1X, y: y, w: 400, h: 250 });
  } else if (activeToolIndex === Enums.Tools.MASKING) {
    widgets.push({ type: 'info', label: 'MASKING', x: col1X, y: y });
    y += gapHeader;

    widgets.push({ type: 'button', id: 'mask_invert', label: 'Invert', x: col1X, y: y, w: 150, h: btnH, disabled: true });
    widgets.push({ type: 'button', id: 'mask_clear', label: 'Clear', x: 190, y: y, w: 150, h: btnH, disabled: true });
    widgets.push({ type: 'button', id: 'mask_blur', label: 'Blur', x: 360, y: y, w: 150, h: btnH, disabled: true });
    widgets.push({ type: 'button', id: 'mask_sharpen', label: 'Sharpen', x: 530, y: y, w: 150, h: btnH, disabled: true });
  }

  return widgets;
}
