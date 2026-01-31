export default function getFilesWidgets(main) {
  const widgets = [];
  // Spacing Constants
  const col1X = 20;
  const colWidth = 200;
  const btnH = 60;
  const gapBtn = 20; // Gap between button rows
  const gapSection = 40; // Gap above header
  const gapHeader = 40; // Gap below header (to next button)

  let y = 130;

  // --- Import / Export ---
  widgets.push({ type: 'info', label: 'IMPORT / EXPORT', x: col1X, y: y });
  y += gapHeader;

  // Row 2: OBJ / STL
  widgets.push({ type: 'button', id: 'import_obj', label: 'Import OBJ', x: col1X, y: y, w: colWidth, h: btnH });
  widgets.push({ type: 'button', id: 'export_obj', label: 'Export OBJ', x: col1X + 220, y: y, w: colWidth, h: btnH });
  widgets.push({ type: 'button', id: 'export_stl', label: 'Export STL', x: col1X + 440, y: y, w: colWidth, h: btnH });
  widgets.push({ type: 'button', id: 'export_sgl', label: 'Export SGL', x: col1X + 660, y: y, w: colWidth, h: btnH, disabled: true });
  y += btnH + gapBtn;

  // Row 3: More Exports
  widgets.push({ type: 'button', id: 'export_ply', label: 'Export PLY', x: col1X, y: y, w: colWidth, h: btnH, disabled: true });
  widgets.push({ type: 'button', id: 'obj_zbrush', label: 'ZBrush Color', x: col1X + 220, y: y, w: colWidth, h: btnH, disabled: true });
  widgets.push({ type: 'button', id: 'obj_append', label: 'Append Color', x: col1X + 440, y: y, w: colWidth, h: btnH, disabled: true });
  y += btnH + gapSection;

  // --- Import Options ---
  widgets.push({ type: 'info', label: 'IMPORT OPTIONS', x: col1X, y: y });
  y += gapHeader;

  widgets.push({ type: 'button', id: 'auto_matrix', label: 'Auto Matrix', x: col1X, y: y, w: colWidth, h: btnH, disabled: true });
  widgets.push({ type: 'button', id: 'vert_srgb', label: 'Vertex SRGB', x: col1X + 220, y: y, w: colWidth, h: btnH, disabled: true });
  y += btnH + gapSection;

  // --- Texture Export ---
  widgets.push({ type: 'info', label: 'TEXTURE EXPORT', x: col1X, y: y });
  y += gapHeader;

  // Slider (Size)
  // Sliders often draw label above/left. In VR Menu, slider label is inside/above?
  // Let's check visual. Previous screen showed "Size: 0.50" inside?
  // Standard slider height 40.
  widgets.push({ type: 'slider', id: 'tex_size', label: 'Size', x: col1X, y: y, w: 400, h: 40, value: 0.5, disabled: true });
  y += 40 + gapBtn; // Smaller gap for slider to buttons?

  widgets.push({ type: 'button', id: 'save_color', label: 'Save Color', x: col1X, y: y, w: colWidth, h: btnH, disabled: true });
  widgets.push({ type: 'button', id: 'save_rough', label: 'Save Rough', x: col1X + 220, y: y, w: colWidth, h: btnH, disabled: true });
  widgets.push({ type: 'button', id: 'save_metal', label: 'Save Metal', x: col1X + 440, y: y, w: colWidth, h: btnH, disabled: true });
  y += btnH + gapSection;

  // Footer
  widgets.push({ type: 'info', label: 'Files will be saved to your browser downloads.', x: col1X, y: y });
  y += 40;
  widgets.push({ type: 'info', label: 'Importing will open a system dialog (exit VR temporarily).', x: col1X, y: y });

  return widgets;
}
