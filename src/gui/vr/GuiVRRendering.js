import Enums from 'misc/Enums';

export default function getRenderingWidgets(main) {
  return [
    { type: 'info', label: '--- SHADING MODE ---', x: 20, y: 130 },

    { type: 'button', id: 'pbr', label: 'PBR', x: 20, y: 170, w: 200, h: 80 },
    { type: 'button', id: 'matcap', label: 'Matcap', x: 240, y: 170, w: 200, h: 80 },
    { type: 'button', id: 'flat', label: 'Flat Shading', x: 20, y: 270, w: 200, h: 80 },
    { type: 'button', id: 'wireframe', label: 'Wireframe', x: 240, y: 270, w: 200, h: 80 },

    { type: 'info', label: '--- ENVIRONMENT ---', x: 20, y: 400 },
    { type: 'toggle', id: 'passthrough', label: 'AR Passthrough', x: 20, y: 440, w: 300, h: 80 },
    { type: 'info', label: '(Experimental: Blinks during switch)', x: 340, y: 470 },

    { type: 'info', label: '--- EXTRA ---', x: 20, y: 560 },
    { type: 'toggle', id: 'symmetry', label: 'Symmetry', x: 20, y: 600, w: 300, h: 80 },
  ];
}
