import Enums from 'misc/Enums';

export default function getRenderingWidgets(main) {
  return [
    { type: 'info', label: '--- SHADING MODE ---', x: 20, y: 130 },

    //     { type: 'toggle', id: 'flat', label: 'Flat Shading', x: 20, y: 270, w: 200, h: 80 },
    //     { type: 'toggle', id: 'wireframe', label: 'Wireframe', x: 240, y: 270, w: 200, h: 80 },

    // Shader Types (Expanded)
    { type: 'button', id: 'pbr', label: 'PBR', x: 20, y: 170, w: 140, h: 80 },
    { type: 'button', id: 'matcap', label: 'Matcap', x: 170, y: 170, w: 140, h: 80 },
    { type: 'button', id: 'normal', label: 'Normal', x: 320, y: 170, w: 140, h: 80, disabled: true }, // Mockup
    { type: 'button', id: 'uv', label: 'UV', x: 470, y: 170, w: 140, h: 80, disabled: true }, // Mockup

    { type: 'toggle', id: 'flat', label: 'Flat', x: 20, y: 270, w: 140, h: 80 },
    { type: 'toggle', id: 'wireframe', label: 'Wire', x: 170, y: 270, w: 140, h: 80 },
    { type: 'toggle', id: 'filmic', label: 'Filmic', x: 320, y: 270, w: 140, h: 80, disabled: true }, // Mockup

    // Comboboxes
    { type: 'info', label: 'ENVIRONMENT', x: 20, y: 390 },
    { type: 'combobox', id: 'environment', label: 'Environment', x: 20, y: 430, w: 420, h: 80 },

    { type: 'info', label: 'MATCAP', x: 460, y: 390 },
    { type: 'combobox', id: 'matcap', label: 'Matcap', x: 460, y: 430, w: 300, h: 80 },
    { type: 'button', id: 'import_matcap', label: 'Import', x: 770, y: 430, w: 130, h: 80, disabled: true }, // Mockup

    { type: 'info', label: '--- POST PROCESS ---', x: 20, y: 550 },
    { type: 'slider', id: 'exposure', label: 'Exposure', x: 20, y: 590, w: 300, h: 40, value: 0.2 }, 
    { type: 'slider', id: 'curvature', label: 'Curvature', x: 340, y: 590, w: 300, h: 40, value: 0.2 },
    { type: 'slider', id: 'transparency', label: 'Transparency', x: 660, y: 590, w: 240, h: 40, value: 0, disabled: true }, // Mockup

    { type: 'info', label: '--- VISUALS ---', x: 20, y: 660 },
    { type: 'toggle', id: 'symmetry', label: 'Symmetry', x: 20, y: 700, w: 200, h: 80 },
    { type: 'toggle', id: 'grid', label: 'Grid', x: 240, y: 700, w: 200, h: 80 },
    { type: 'toggle', id: 'contour', label: 'Contour', x: 460, y: 700, w: 200, h: 80 },
    { type: 'toggle', id: 'passthrough', label: 'AR Mode', x: 680, y: 700, w: 200, h: 80 },
  ];
}
