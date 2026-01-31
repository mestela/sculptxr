export default function getSceneWidgets(main) {
  const widgets = [];

  // Match GuiScene.js Order:
  // 1. Scene (Clear, Primitives)
  // 2. Selection (Isolate, Merge, Duplicate, Delete)
  // 3. Extra (Darken Unselected, Contour, Grid, Symmetry Line, Sym Offset)

  // Spacing Constants
  const col1X = 20;
  const btnH = 60;
  const gapBtn = 20;
  const gapSection = 40;
  const gapHeader = 40;

  let y = 130;

  // --- SCENE ---
  widgets.push({ type: 'info', label: 'SCENE', x: col1X, y: y });
  y += gapHeader;

  widgets.push({ type: 'button', id: 'reset', label: 'Reset / Clear', x: col1X, y: y, w: 250, h: btnH });
  y += btnH + gapBtn;

  // Primitives Row 1
  widgets.push({ type: 'button', id: 'addSphere', label: 'Sphere', x: col1X, y: y, w: 180, h: btnH });
  widgets.push({ type: 'button', id: 'addCube', label: 'Cube', x: 220, y: y, w: 180, h: btnH });
  widgets.push({ type: 'button', id: 'addCylinder', label: 'Cylinder', x: 420, y: y, w: 180, h: btnH });
  y += btnH + gapBtn;

  // Primitives Row 2
  widgets.push({ type: 'button', id: 'addTorus', label: 'Torus', x: col1X, y: y, w: 180, h: btnH });
  // Torus sliders mockup (disabled)
  // widgets.push({ type: 'slider', id: 'torus_rad', label: 'Radius', x: 220, y: 310, w: 200, h: 40, value: 0.5, disabled: true });
  y += btnH + gapSection;


  // --- SELECTION ---
  widgets.push({ type: 'info', label: 'SELECTION', x: col1X, y: y });
  y += gapHeader;

  widgets.push({ type: 'button', id: 'duplicateSelection', label: 'Duplicate', x: col1X, y: y, w: 200, h: btnH });
  widgets.push({ type: 'button', id: 'deleteSelection', label: 'Delete', x: 240, y: y, w: 200, h: btnH });
  widgets.push({ type: 'button', id: 'merge', label: 'Merge', x: 460, y: y, w: 200, h: btnH });
  widgets.push({ type: 'checkbox', id: 'isolate', label: 'Isolate', x: 680, y: y, w: 200, h: btnH });
  y += btnH + gapSection;


  // --- EXTRA ---
  widgets.push({ type: 'info', label: 'EXTRA', x: col1X, y: y });
  y += gapHeader;

  widgets.push({ type: 'checkbox', id: 'grid', label: 'Show Grid', x: col1X, y: y, w: 300, h: btnH });
  widgets.push({ type: 'checkbox', id: 'contour', label: 'Show Contour', x: 350, y: y, w: 300, h: btnH });
  y += btnH + gapBtn;

  widgets.push({ type: 'checkbox', id: 'show_sym', label: 'Show Symmetry Line', x: col1X, y: y, w: 350, h: btnH, disabled: true });
  widgets.push({ type: 'checkbox', id: 'darken', label: 'Darken Unselected', x: 400, y: y, w: 350, h: btnH, disabled: true });
  y += btnH + gapBtn;

  widgets.push({ type: 'slider', id: 'symmetryOffset', label: 'Sym Offset', x: col1X, y: y, w: 400, h: 40, value: 0.5 });

  return widgets;
}
