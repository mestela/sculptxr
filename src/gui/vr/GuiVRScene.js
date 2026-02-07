import ShaderBase from 'render/shaders/ShaderBase';
import Remesh from 'editing/Remesh';

export default function getSceneWidgets(main) {
  const widgets = [];

  // Menu Dimensions
  const menuW = 400;
  // Let's calculate height dynamically or just strict list
  let y = 10;
  const ITEM_H = 40;
  const HEADER_H = 30; // Slightly smaller header for menu
  const GAP = 5;

  // --- SCENE ---
  widgets.push({ type: 'header', label: 'Scene', x: 0, y: y, w: menuW, h: HEADER_H, header: true });
  y += HEADER_H + GAP;

  widgets.push({ type: 'button', id: 'reset', label: 'Reset / Clear', x: 0, y: y, w: menuW, h: ITEM_H, onInteract: () => main.clearScene() });
  y += ITEM_H + GAP;

  // Primitives
  widgets.push({ type: 'button', id: 'addSphere', label: 'Add Sphere', x: 0, y: y, w: menuW, h: ITEM_H, onInteract: () => main.addSphere() });
  y += ITEM_H + GAP;
  widgets.push({ type: 'button', id: 'addCube', label: 'Add Cube', x: 0, y: y, w: menuW, h: ITEM_H, onInteract: () => main.addCube() });
  y += ITEM_H + GAP;
  widgets.push({ type: 'button', id: 'addCylinder', label: 'Add Cylinder', x: 0, y: y, w: menuW, h: ITEM_H, onInteract: () => main.addCylinder() });
  y += ITEM_H + GAP;
  widgets.push({ type: 'button', id: 'addTorus', label: 'Add Torus', x: 0, y: y, w: menuW, h: ITEM_H, onInteract: () => main.addTorus() });
  y += ITEM_H + GAP;

  // Separator?
  y += 10;

  // --- SELECTION ---
  widgets.push({ type: 'header', label: 'Selection', x: 0, y: y, w: menuW, h: HEADER_H, header: true });
  y += HEADER_H + GAP;

  // Multi-select Checkbox
  widgets.push({
    type: 'checkbox', id: 'multiselect', label: 'Multi-select', x: 0, y: y, w: menuW, h: ITEM_H,
    value: !!main._vrMultiSelect,
    onInteract: () => { main._vrMultiSelect = !main._vrMultiSelect; }
  });
  y += ITEM_H + GAP;

  widgets.push({
    type: 'button', id: 'duplicateSelection', label: 'Duplicate', x: 0, y: y, w: menuW, h: ITEM_H,
    onInteract: () => {
      try { main.duplicateSelection(); }
      catch (e) { console.error(e); }
    }
  });
  y += ITEM_H + GAP;

  widgets.push({ type: 'button', id: 'deleteSelection', label: 'Delete', x: 0, y: y, w: menuW, h: ITEM_H, onInteract: () => main.deleteCurrentSelection() });
  y += ITEM_H + GAP;

  widgets.push({
    type: 'button', id: 'merge', label: 'Merge', x: 0, y: y, w: menuW, h: ITEM_H,
    onInteract: () => {
      try {
        if (main.getGui() && main.getGui()._ctrlScene) {
          main.getGui()._ctrlScene.merge();
          // Auto-disable multi-select after merge
          main._vrMultiSelect = false;
        }
      } catch (e) {
        console.error(e);
      }
    }
  });
  y += ITEM_H + GAP;

  // Isolate
  let isIsolate = false;
  if (main.getGui() && main.getGui()._ctrlScene) {
    isIsolate = main.getGui()._ctrlScene.hasHiddenMeshes();
  }
  widgets.push({
    type: 'checkbox', id: 'isolate', label: 'Isolate', x: 0, y: y, w: menuW, h: ITEM_H,
    value: isIsolate,
    onInteract: () => {
      if (main.getGui() && main.getGui()._ctrlScene) {
        main.getGui()._ctrlScene.toggleShowHide();
      }
    }
  });
  y += ITEM_H + GAP;

  // Separator?
  y += 10;

  // --- EXTRA ---
  widgets.push({ type: 'header', label: 'Extra', x: 0, y: y, w: menuW, h: HEADER_H, header: true });
  y += HEADER_H + GAP;

  widgets.push({ type: 'checkbox', id: 'grid', label: 'Show Grid', x: 0, y: y, w: menuW, h: ITEM_H, value: main._showGrid, onInteract: () => { main._showGrid = !main._showGrid; main.render(); } });
  y += ITEM_H + GAP;
  widgets.push({ type: 'checkbox', id: 'contour', label: 'Show Contour', x: 0, y: y, w: menuW, h: ITEM_H, value: main._showContour, onInteract: () => { main._showContour = !main._showContour; main.render(); } });
  y += ITEM_H + GAP;
  widgets.push({ type: 'checkbox', id: 'show_sym', label: 'Show Symmetry Line', x: 0, y: y, w: menuW, h: ITEM_H, value: ShaderBase.showSymmetryLine, onInteract: () => { ShaderBase.showSymmetryLine = !ShaderBase.showSymmetryLine; main.render(); } });
  y += ITEM_H + GAP;
  widgets.push({ type: 'checkbox', id: 'darken', label: 'Darken Unselected', x: 0, y: y, w: menuW, h: ITEM_H, value: ShaderBase.darkenUnselected, onInteract: () => { ShaderBase.darkenUnselected = !ShaderBase.darkenUnselected; main.render(); } });
  y += ITEM_H + GAP;

  const mesh = main.getMesh();
  const symOffset = mesh ? mesh.getSymmetryOffset() : 0;
  widgets.push({
    type: 'slider', id: 'symmetryOffset', label: 'Sym Offset', x: 0, y: y, w: menuW, h: ITEM_H, value: symOffset, min: -1, max: 1, step: 0.001,
    onInput: (val) => { if (mesh) { mesh.setSymmetryOffset(val); main.render(); } }
  });
  y += ITEM_H + GAP;

  return {
    width: menuW,
    height: y + 10,
    widgets: widgets
  };
}
