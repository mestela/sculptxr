export default function getFilesWidgets(main) {
  const widgets = [
    { type: 'info', label: '--- IMPORT / EXPORT ---', x: 20, y: 130 },

    // Row 1: Common
    { type: 'button', id: 'import_obj', label: 'Import OBJ', x: 20, y: 170, w: 200, h: 80 },
    { type: 'button', id: 'export_obj', label: 'Export OBJ', x: 240, y: 170, w: 200, h: 80 },
    { type: 'button', id: 'export_stl', label: 'Export STL', x: 460, y: 170, w: 200, h: 80 },
    { type: 'button', id: 'export_sgl', label: 'Export SGL', x: 680, y: 170, w: 200, h: 80, disabled: true }, // Mockup
  ];

  // Row 2: More Exports
  const row2Y = 260;
  widgets.push({ type: 'button', id: 'export_ply', label: 'Export PLY', x: 20, y: row2Y, w: 200, h: 80, disabled: true }); // Mockup
  widgets.push({ type: 'toggle', id: 'obj_zbrush', label: 'ZBrush Color', x: 240, y: row2Y, w: 200, h: 80, disabled: true }); // Mockup
  widgets.push({ type: 'toggle', id: 'obj_append', label: 'Append Color', x: 460, y: row2Y, w: 200, h: 80, disabled: true }); // Mockup

  // Import Options
  widgets.push({ type: 'info', label: '--- IMPORT OPTIONS ---', x: 20, y: 380 });
  widgets.push({ type: 'toggle', id: 'auto_matrix', label: 'Auto Matrix', x: 20, y: 420, w: 200, h: 60, disabled: true }); // Mockup
  widgets.push({ type: 'toggle', id: 'vert_srgb', label: 'Vertex SRGB', x: 240, y: 420, w: 200, h: 60, disabled: true }); // Mockup


  // Texture Export
  widgets.push({ type: 'info', label: '--- TEXTURE EXPORT ---', x: 20, y: 520 });
  widgets.push({ type: 'slider', id: 'tex_size', label: 'Size', x: 20, y: 560, w: 300, h: 40, value: 0.5, disabled: true }); // Mockup
  widgets.push({ type: 'button', id: 'save_color', label: 'Save Color', x: 20, y: 620, w: 200, h: 60, disabled: true }); // Mockup
  widgets.push({ type: 'button', id: 'save_rough', label: 'Save Rough', x: 240, y: 620, w: 200, h: 60, disabled: true }); // Mockup
  widgets.push({ type: 'button', id: 'save_metal', label: 'Save Metal', x: 460, y: 620, w: 200, h: 60, disabled: true }); // Mockup

  widgets.push({ type: 'info', label: 'Files will be saved to your browser downloads.', x: 20, y: 720 });
  widgets.push({ type: 'info', label: 'Importing will open a system dialog (exit VR temporarily).', x: 20, y: 760 });

  return widgets;
}
