import TR from 'gui/GuiTR';

export default function getSettingsWidgets(main) {
  const widgets = [];

  // Spacing Constants
  const col1X = 20;
  const btnH = 60;
  const gapBtn = 20;
  const gapSection = 40;
  const gapHeader = 40;

  let y = 130;

  // --- BACKGROUND ---
  widgets.push({ type: 'info', label: 'BACKGROUND', x: col1X, y: y });
  y += gapHeader;

  widgets.push({ type: 'button', id: 'reset_bg', label: 'Reset BG', x: col1X, y: y, w: 200, h: btnH, disabled: true });
  widgets.push({ type: 'button', id: 'import_bg', label: 'Import BG', x: 240, y: y, w: 200, h: btnH, disabled: true });
  y += btnH + gapSection;

  // --- CAMERA ---
  widgets.push({ type: 'info', label: 'CAMERA', x: col1X, y: y });
  y += gapHeader;

  widgets.push({ type: 'button', id: 'reset_view', label: 'Reset View', x: col1X, y: y, w: 200, h: btnH });
  widgets.push({ type: 'slider', id: 'fov', label: 'FOV', x: 240, y: y + 10, w: 300, h: 40, value: 0.5, disabled: true });
  y += btnH + gapSection;

  // --- CONFIG ---
  widgets.push({ type: 'info', label: 'CONFIG', x: col1X, y: y });
  y += gapHeader;

  widgets.push({ type: 'combobox', id: 'language', label: 'Language', x: col1X, y: y, w: 300, h: btnH, disabled: true });
  y += btnH + gapBtn;

  return widgets;
}
