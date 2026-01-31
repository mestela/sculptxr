export default function getFilesWidgets(main) {
  return [
    { type: 'info', label: '--- IMPORT / EXPORT ---', x: 20, y: 130 },

    { type: 'button', id: 'import_obj', label: 'Import OBJ', x: 20, y: 170, w: 280, h: 80 },
    { type: 'button', id: 'export_obj', label: 'Export OBJ', x: 320, y: 170, w: 280, h: 80 },
    { type: 'button', id: 'export_stl', label: 'Export STL', x: 620, y: 170, w: 280, h: 80 },

    { type: 'info', label: 'Files will be saved to your browser downloads.', x: 20, y: 300 },
    { type: 'info', label: 'Importing will open a system dialog (exit VR temporarily).', x: 20, y: 340 },
  ];
}
