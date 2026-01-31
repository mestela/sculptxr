
export default function getFilesWidgets(main) {
  const widgets = [];

  const w = 350; // Menu Width
  const pad = 10;
  const itemH = 50;
  const headerH = 40;

  let y = 10;
  const x = 10;
  const contentW = w - 20;

  // Helpers
  const addHeader = (label) => {
    widgets.push({ type: 'info', label, x, y, w: contentW, h: headerH, header: true }); // Special flag for header style
    y += headerH;
  };
  const addButton = (id, label) => {
    widgets.push({ type: 'button', id, label, x, y, w: contentW, h: itemH, textAlign: 'left' });
    y += itemH;
  };
  const addCheckbox = (id, label, valueObj, valueKey) => {
    // We assume valueObj[valueKey] holds boolean, update via callback or reliance on main loop?
    // GuiXR updates usually need explicit state or getter.
    // For now, let's just make them buttons that toggle state or standard checkboxes if supported.
    // GuiXR supports 'checkbox'.
    widgets.push({ type: 'checkbox', id, label, x, y, w: contentW, h: itemH, value: false }); // Logic handled in GuiXR
    y += itemH;
  };

  // --- Import ---
  addHeader('Import');
  addButton('import_obj', 'Add (obj, sgl, ply, stl)');
  addCheckbox('import_scale', 'Scale and center');
  addCheckbox('import_srgb', 'sRGB vertex color');

  // --- Export Scene ---
  y += 10;
  addHeader('Export Scene');
  addCheckbox('export_all', 'Export all');
  addButton('export_sgl', 'Save .sgl (SculptGL)');
  addButton('export_obj', 'Save .obj');
  addButton('export_ply', 'Save .ply');
  addButton('export_stl', 'Save .stl');
  addCheckbox('export_zbrush', 'OBJ color zbrush');
  addCheckbox('export_append', 'OBJ color append');
  addButton('go_sketchfab', 'Go to Sketchfab !');

  // --- Export Textures ---
  y += 10;
  addHeader('Export textures');
  widgets.push({ type: 'slider', id: 'tex_size', label: 'Size', x, y, w: contentW, h: itemH, value: 0.5 });
  y += itemH;

  addButton('save_diffuse', 'Save diffuse');
  addButton('save_roughness', 'Save roughness');
  addButton('save_metalness', 'Save metalness');

  return { widgets, width: w, height: y + 20 };
}
