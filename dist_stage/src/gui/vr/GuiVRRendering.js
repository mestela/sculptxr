import Enums from 'misc/Enums';

export default function getRenderingWidgets(main) {
  return [
    { type: 'info', label: '--- SHADING MODE ---', x: 20, y: 130 },

    // Shader Types
    { type: 'button', id: 'pbr', label: 'PBR', x: 20, y: 170, w: 200, h: 80 },
    { type: 'button', id: 'matcap', label: 'Matcap', x: 240, y: 170, w: 200, h: 80 },
    { type: 'button', id: 'flat', label: 'Flat Shading', x: 20, y: 270, w: 200, h: 80 },
    { type: 'button', id: 'wireframe', label: 'Wireframe', x: 240, y: 270, w: 200, h: 80 },



    // Comboboxes (New)
    { type: 'info', label: 'ENVIRONMENT', x: 20, y: 390 },
    { type: 'combobox', id: 'environment', label: 'Environment', x: 20, y: 430, w: 420, h: 80 },

    { type: 'info', label: 'MATCAP', x: 460, y: 390 },
    { type: 'combobox', id: 'matcap', label: 'Matcap', x: 460, y: 430, w: 420, h: 80 },

    { type: 'info', label: '--- EXTRA ---', x: 20, y: 550 },
    { type: 'toggle', id: 'passthrough', label: 'AR Passthrough', x: 20, y: 590, w: 300, h: 80 },
    { type: 'toggle', id: 'symmetry', label: 'Symmetry', x: 340, y: 590, w: 300, h: 80 },
  ];
}
