import TR from 'gui/GuiTR';

export default function getSceneWidgets(main) {
  return [
    { type: 'info', label: '--- ADD PRIMITIVE ---', x: 20, y: 130 },

    // Primitives
    { type: 'button', id: 'addSphere', label: 'Sphere', x: 20, y: 170, w: 200, h: 80 },
    { type: 'button', id: 'addCube', label: 'Cube', x: 240, y: 170, w: 200, h: 80 },
    { type: 'button', id: 'addCylinder', label: 'Cylinder', x: 460, y: 170, w: 200, h: 80 },
    { type: 'button', id: 'addTorus', label: 'Torus', x: 680, y: 170, w: 200, h: 80 },

    // Torus Params (Mockup)
    // Only visible if Torus selected? Or always visible? Desktop shows them always if Torus tool?
    // Let's put them below primitives for now as disabled
    const primY = 260;
  widgets.push({ type: 'slider', id: 'torus_rad', label: 'Radius', x: 20, y: primY, w: 200, h: 40, value: 0.5, disabled: true });
  widgets.push({ type: 'slider', id: 'torus_tub', label: 'Tube', x: 240, y: primY, w: 200, h: 40, value: 0.2, disabled: true });
  widgets.push({ type: 'slider', id: 'torus_arc', label: 'Arc', x: 460, y: primY, w: 200, h: 40, value: 1.0, disabled: true });


  { type: 'info', label: '--- SELECTION ---', x: 20, y: 340 },
  { type: 'button', id: 'duplicateSelection', label: 'Duplicate', x: 20, y: 380, w: 200, h: 80 },
  { type: 'button', id: 'deleteSelection', label: 'Delete', x: 240, y: 380, w: 200, h: 80 },
  { type: 'button', id: 'merge', label: 'Merge', x: 460, y: 380, w: 200, h: 80 },
  { type: 'toggle', id: 'isolate', label: 'Isolate', x: 680, y: 380, w: 200, h: 80 },

  { type: 'info', label: '--- SCENE ---', x: 20, y: 500 },
  { type: 'button', id: 'reset', label: 'CLEAR SCENE', x: 20, y: 540, w: 300, h: 80 },
  { type: 'toggle', id: 'darken', label: 'Darken Unsel', x: 340, y: 540, w: 200, h: 80, disabled: true }); // Mockup

    // Helpers?
  { type: 'slider', id: 'symmetryOffset', label: 'Sym Offset', x: 340, y: 640, w: 300, h: 40, value: 0.5 }, // Needs mapping
  { type: 'toggle', id: 'show_sym', label: 'Show Line', x: 660, y: 640, w: 200, h: 60, disabled: true }); // Mockup
  ];
}
