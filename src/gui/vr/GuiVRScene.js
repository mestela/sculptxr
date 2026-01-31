import TR from 'gui/GuiTR';

export default function getSceneWidgets(main) {
  return [
    { type: 'info', label: '--- ADD PRIMITIVE ---', x: 20, y: 130 },

    // Primitives
    { type: 'button', id: 'addSphere', label: 'Sphere', x: 20, y: 170, w: 200, h: 80 },
    { type: 'button', id: 'addCube', label: 'Cube', x: 240, y: 170, w: 200, h: 80 },
    { type: 'button', id: 'addCylinder', label: 'Cylinder', x: 460, y: 170, w: 200, h: 80 },
    { type: 'button', id: 'addTorus', label: 'Torus', x: 680, y: 170, w: 200, h: 80 },

    { type: 'info', label: '--- SCENE MANAGEMENT ---', x: 20, y: 300 },

    { type: 'button', id: 'reset', label: 'CLEAR SCENE', x: 20, y: 340, w: 300, h: 80 },
    // { type: 'button', id: 'merge', label: 'Merge Selection', x: 340, y: 340, w: 300, h: 80 },
  ];
}
