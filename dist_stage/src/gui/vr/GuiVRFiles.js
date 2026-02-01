
export default function getFilesWidgets(main) {
  const widgets = [];

  const w = 350; // Menu Width
  const pad = 10;
  const itemH = 40;
  const headerH = 30;

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
  const addCheckbox = (id, label, value) => {
    widgets.push({ type: 'checkbox', id, label, x, y, w: contentW, h: itemH, value: !!value }); 
    y += itemH;
  };

  // State Lookup
  const guiFiles = (main.getGui && main.getGui()) ? main.getGui()._guiFiles : null;
  const exportAll = guiFiles ? guiFiles._exportAll : true;
  const objZbrush = guiFiles ? guiFiles._objColorZbrush : false;
  const objAppend = guiFiles ? guiFiles._objColorAppended : false;

  // --- Import ---
  addHeader('Import');
  addButton('import_obj', 'Add (obj, sgl, ply, stl)');
  // _autoMatrix matches 'import_scale' (Scale and center usually implies normalizing matrix)
  addCheckbox('import_scale', 'Scale and center', main._autoMatrix);
  addCheckbox('import_srgb', 'sRGB vertex color', main._vertexSRGB);

  // --- Export Scene ---
  y += 10;
  addHeader('Export Scene');
  addCheckbox('export_all', 'Export all', exportAll);
  addButton('export_sgl', 'Save .sgl (SculptGL)');
  addButton('export_obj', 'Save .obj');
  addButton('export_ply', 'Save .ply');
  addButton('export_stl', 'Save .stl');
  addCheckbox('export_zbrush', 'OBJ color zbrush', objZbrush);
  addCheckbox('export_append', 'OBJ color append', objAppend);
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
