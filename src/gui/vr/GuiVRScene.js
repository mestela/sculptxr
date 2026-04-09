import ShaderBase from '../../render/shaders/ShaderBase.js';
import Remesh from '../../editing/Remesh.js';

export default function getSceneWidgets(main) {
  const widgets = [];

  // Menu Dimensions
  const menuW = 400;
  // Let's calculate height dynamically or just strict list
  let y = 10;
  const ITEM_H = 40;
  const HEADER_H = 30; // Slightly smaller header for menu
  const GAP = 5;

  // --- OUTLINER ---
  widgets.push({ type: 'header', id: 'header_outliner', label: 'Outliner', x: 20, y: y, w: menuW - 40, h: HEADER_H, header: true });
  y += HEADER_H + GAP;

  const meshes = main.getMeshes();
  for (let i = 0; i < meshes.length; i++) {
    const mesh = meshes[i];
    if (mesh._isVoxelChunk) continue; // Skip voxel chunks in UI
    const typeName = (mesh._typeName || "Mesh") + " " + (i + 1);



    // Visibility Checkbox
    widgets.push({
      type: 'checkbox', id: 'vis_' + i, label: '', x: 20, y: y, w: 40, h: ITEM_H,
      icon: 'eye',
      isVisibility: true,
      value: mesh.isVisible(),
      onInteract: (val) => { 
        mesh.setVisible(val); 
        if (mesh.getThreeMesh()) mesh.getThreeMesh().visible = val; 
        main.render(); 
      }
    });

    // Multi-select Checkbox
    widgets.push({
      type: 'checkbox', id: 'multi_' + i, label: '', x: 70, y: y, w: 40, h: ITEM_H,
      value: main.getSelectedMeshes().includes(mesh),
      onInteract: () => { main.setOrUnsetMesh(mesh, true); main.render(); } // Always treat as multi-select toggling
    });

    // Name Button (Sets active mesh single-select style)
    widgets.push({
      type: 'button', id: 'select_' + i, label: typeName, x: 120, y: y, w: menuW - 170, h: ITEM_H,
      onInteract: () => { main.setOrUnsetMesh(mesh, false); main.render(); } // Clicking name sets it as single active mesh
    });

    // Delete Button
    widgets.push({
      type: 'button', id: 'del_' + i, label: '', x: 340, y: y, w: 40, h: ITEM_H,
      icon: 'x',
      onInteract: () => { main.removeMeshes([mesh]); main.render(); }
    });

    y += ITEM_H + GAP;
  }

  y += 10;

  // --- BOOLEANS ---
  widgets.push({ type: 'header', id: 'header_booleans', label: 'Booleans', x: 20, y: y, w: menuW - 40, h: HEADER_H, header: true });
  y += HEADER_H + GAP;

  const selectedMeshes = main.getSelectedMeshes();
  let booleanLabel = 'Boolean Ops (Select 2)';
  let booleanInteract = null;
  let booleanDisabled = true;

  if (selectedMeshes.length === 2) {
    const mesh1 = selectedMeshes[0];
    const mesh2 = selectedMeshes[1];
    const v1 = mesh1.isVisible();
    const v2 = mesh2.isVisible();

    if (v1 && v2) {
      booleanLabel = 'Boolean Union';
    } else if (!v1 && !v2) {
      booleanLabel = 'Boolean Intersect';
    } else {
      booleanLabel = 'Boolean Subtract';
    }
    
    booleanDisabled = false;
    booleanInteract = () => {
      try {
        if (main.getSculptManager()) {
          let op = 'union';
          if (v1 && v2) op = 'union';
          else if (!v1 && !v2) op = 'intersect';
          else op = 'subtract';
          
          main.getSculptManager().booleanOperationSelection(op);
        }
      } catch (e) {
        console.error(e);
      }
    };
  } else if (selectedMeshes.length > 2) {
    booleanLabel = 'Boolean (Keep selection <= 2)';
  } else if (selectedMeshes.length === 1) {
    booleanLabel = 'Boolean (Select 1 more)';
  }

  widgets.push({
    type: 'button', id: 'booleanOp', label: booleanLabel, x: 20, y: y, w: menuW - 40, h: ITEM_H,
    disabled: booleanDisabled,
    onInteract: booleanInteract
  });
  y += ITEM_H + GAP;

  widgets.push({
    type: 'checkbox', id: 'quadrangulate_boolean', label: 'Quadrangulate Result', x: 20, y: y, w: menuW - 40, h: ITEM_H,
    value: Remesh.QUADRANGULATE,
    onInteract: (val) => { Remesh.QUADRANGULATE = val; }
  });
  y += ITEM_H + GAP;

  y += 10;

  // --- SELECTION ---
  widgets.push({ type: 'header', id: 'header_selection', label: 'Selection', x: 20, y: y, w: menuW - 40, h: HEADER_H, header: true });
  y += HEADER_H + GAP;

  // Multi-select Checkbox
  // Multi-select Checkbox removed per user request
  // Delete Selection button removed per user request

  widgets.push({
    type: 'button', id: 'duplicateSelection', label: 'Duplicate', x: 20, y: y, w: menuW - 40, h: ITEM_H,
    onInteract: () => {
      try { main.duplicateSelection(); }
      catch (e) { console.error(e); }
    }
  });
  y += ITEM_H + GAP;

  // Lock Selection
  widgets.push({
    type: 'checkbox', id: 'lockSelection', label: 'Lock Selection', x: 20, y: y, w: menuW - 40, h: ITEM_H,
    value: !!main._lockSelection,
    onInteract: (val) => { 
      main._lockSelection = val; 
      const activeMesh = main.getMesh();
      console.log(`[LOCK DEBUG] Checkbox Toggled! Lock Selection is now: ${val}. Active Mesh ID is: ${activeMesh ? activeMesh.getID() : 'None'}`);
    }
  });
  y += ITEM_H + GAP;

  widgets.push({ type: 'button', id: 'clearScene', label: 'Clear Scene', x: 20, y: y, w: menuW - 40, h: ITEM_H, onInteract: () => main.clearScene() });
  y += ITEM_H + GAP;

  widgets.push({
    type: 'button', id: 'merge', label: 'Merge (Visual)', x: 20, y: y, w: menuW - 40, h: ITEM_H,
    onInteract: () => {
      try {
        if (main.getGui() && main.getGui()._ctrlScene) {
          main.getGui()._ctrlScene.merge();
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
    type: 'checkbox', id: 'isolate', label: 'Isolate', x: 20, y: y, w: menuW - 40, h: ITEM_H,
    value: isIsolate,
    onInteract: (val) => {
      // Manual Visibility Loop when Isolate is checked
      const selected = main.getSelectedMeshes();
      const allMeshes = main.getMeshes();
      allMeshes.forEach(m => {
        if (m._isVoxelChunk) return;
        const targetVisibility = val ? selected.includes(m) : true;
        m.setVisible(targetVisibility);
        if (m.getThreeMesh()) m.getThreeMesh().visible = targetVisibility;
      });

      if (main.getGui() && main.getGui()._ctrlScene) {
        main.getGui()._ctrlScene._ctrlIsolate.setValue(val, false);
      }
      main.render();
    }
  });
  y += ITEM_H + GAP;

  y += 10;

  // --- PRIMITIVES ---
  widgets.push({ type: 'header', id: 'header_primitives', label: 'Primitives', x: 20, y: y, w: menuW - 40, h: HEADER_H, header: true });
  y += HEADER_H + GAP;

  widgets.push({ type: 'button', id: 'addSphere', label: 'Add Sphere', x: 20, y: y, w: menuW - 40, h: ITEM_H, onInteract: () => main.addSphere() });
  y += ITEM_H + GAP;
  widgets.push({ type: 'button', id: 'addCube', label: 'Add Cube', x: 20, y: y, w: menuW - 40, h: ITEM_H, onInteract: () => main.addCube() });
  y += ITEM_H + GAP;
  widgets.push({ type: 'button', id: 'addCylinder', label: 'Add Cylinder', x: 20, y: y, w: menuW - 40, h: ITEM_H, onInteract: () => main.addCylinder() });
  y += ITEM_H + GAP;
  widgets.push({ type: 'button', id: 'addTorus', label: 'Add Torus', x: 20, y: y, w: menuW - 40, h: ITEM_H, onInteract: () => main.addTorus() });
  y += ITEM_H + GAP;
  widgets.push({ type: 'button', id: 'addGrid', label: 'Add Grid', x: 20, y: y, w: menuW - 40, h: ITEM_H, onInteract: () => main.addGrid() });
  y += ITEM_H + GAP;

  y += 10;

  // --- EXTRA ---
  widgets.push({ type: 'header', id: 'header_display', label: 'Display & Symmetry', x: 20, y: y, w: menuW - 40, h: HEADER_H, header: true });
  y += HEADER_H + GAP;

  widgets.push({ type: 'checkbox', id: 'grid', label: 'Show Grid', x: 20, y: y, w: menuW - 40, h: ITEM_H, value: main._showGrid, onInteract: () => { main._showGrid = !main._showGrid; main.render(); } });
  y += ITEM_H + GAP;
  widgets.push({ type: 'checkbox', id: 'contour', label: 'Show Contour', x: 20, y: y, w: menuW - 40, h: ITEM_H, value: main._showContour, onInteract: () => { main._showContour = !main._showContour; main.render(); } });
  y += ITEM_H + GAP;
  widgets.push({ type: 'checkbox', id: 'show_sym', label: 'Show Symmetry Line', x: 20, y: y, w: menuW - 40, h: ITEM_H, value: ShaderBase.showSymmetryLine, onInteract: () => { ShaderBase.showSymmetryLine = !ShaderBase.showSymmetryLine; main.render(); } });
  y += ITEM_H + GAP;
  widgets.push({ type: 'checkbox', id: 'darken', label: 'Darken Unselected', x: 20, y: y, w: menuW - 40, h: ITEM_H, value: ShaderBase.darkenUnselected, onInteract: () => { ShaderBase.darkenUnselected = !ShaderBase.darkenUnselected; main.render(); } });
  y += ITEM_H + GAP;

  const mesh = main.getMesh();
  const symOffset = mesh ? mesh.getSymmetryOffset() : 0;
  widgets.push({
    type: 'slider', id: 'symmetryOffset', label: 'Sym Offset', x: 20, y: y, w: menuW - 40, h: ITEM_H, value: symOffset, min: -1, max: 1, step: 0.001,
    onInput: (val) => { if (mesh) { mesh.setSymmetryOffset(val); main.render(); } }
  });
  y += ITEM_H + GAP;

  return {
    width: menuW,
    height: y + 10,
    widgets: widgets
  };
}
