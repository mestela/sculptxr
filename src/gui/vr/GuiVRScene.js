import ShaderBase from '../../render/shaders/ShaderBase.js';
import Remesh from '../../editing/Remesh.js';

let isConfirmingClear = false;

export default function getSceneWidgets(main) {
  const widgets = [];

  // Use full 1024px VR Canvas Width
  const menuW = 1024;
  const colW = 460;
  const leftX = 20;
  const rightX = 520;
  const ITEM_H = 40;
  const HEADER_H = 30;
  const GAP = 5;

  let leftY = 10;
  let rightY = 10;

  widgets.push({ type: 'header', id: 'header_outliner', label: 'Outliner', x: leftX, y: leftY, w: colW - 280, h: HEADER_H, header: true });

  widgets.push({ 
    type: 'button', id: 'btn_sort_outliner', 
    label: main._outlinerSortAz ? 'Sort: A-Z' : 'Sort: ID', 
    x: leftX + colW - 140, y: leftY, w: 140, h: HEADER_H, 
    onInteract: () => { main._outlinerSortAz = !main._outlinerSortAz; main.render(); } 
  });
  leftY += HEADER_H + GAP;

  const meshes = main.getMeshes();
  const sortedOutlinerMeshes = [];
  
  for (let i = 0; i < meshes.length; i++) {
    if (!meshes[i]._isVoxelChunk) {
      sortedOutlinerMeshes.push(meshes[i]);
    }
  }
  
  // 1. Ensure every mesh has its label preemptively so sorting isn't null
  let preCount = 0;
  for (let i = 0; i < sortedOutlinerMeshes.length; i++) {
    preCount++;
    const m = sortedOutlinerMeshes[i];
    if (!m._permanentStaticLabel) {
      if (m.uiName) m._permanentStaticLabel = m.uiName;
      else if (m._uiName) m._permanentStaticLabel = m._uiName;
      else m._permanentStaticLabel = (m._typeName || "Mesh") + " " + preCount;
    }
  }

  if (main._outlinerSortAz) {
    sortedOutlinerMeshes.sort((a, b) => {
      let nameA = a._permanentStaticLabel || "";
      let nameB = b._permanentStaticLabel || "";
      return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
    });
  } else {
    sortedOutlinerMeshes.sort((a, b) => a.getID() - b.getID());
  }
  
  let displayCount = 0;

  for (let i = 0; i < sortedOutlinerMeshes.length; i++) {
    const mesh = sortedOutlinerMeshes[i];
    
    displayCount++;
    if (!mesh._permanentStaticLabel) {
      if (mesh.uiName) mesh._permanentStaticLabel = mesh.uiName;
      else if (mesh._uiName) mesh._permanentStaticLabel = mesh._uiName;
      else mesh._permanentStaticLabel = (mesh._typeName || "Mesh") + " " + displayCount;
    }
    if (!mesh._permanentStaticId) {
      mesh._permanentStaticId = 'm_' + Math.random().toString(36).substring(2, 11);
    }
    
    const stableId = mesh._permanentStaticId;
    const typeName = mesh._permanentStaticLabel;

    widgets.push({
      type: 'checkbox', id: 'vis_' + stableId, label: '', x: leftX, y: leftY, w: 40, h: ITEM_H,
      icon: 'eye',
      isVisibility: true,
      value: mesh.isVisible(),
      onInteract: (val) => { 
        mesh.setVisible(val); 
        if (mesh.getThreeMesh()) mesh.getThreeMesh().visible = val; 
        main.render(); 
      }
    });

    widgets.push({
      type: 'checkbox', id: 'multi_' + stableId, label: '', x: leftX + 50, y: leftY, w: 40, h: ITEM_H,
      value: main.getSelectedMeshes().includes(mesh),
      onInteract: () => { main.setOrUnsetMesh(mesh, true); main.render(); }
    });

    widgets.push({
      type: 'button', id: 'select_' + stableId, label: typeName, x: leftX + 100, y: leftY, w: colW - 150, h: ITEM_H,
      onInteract: () => { main.setOrUnsetMesh(mesh, false); main.render(); }
    });

    widgets.push({
      type: 'button', id: 'del_' + stableId, label: '', x: leftX + colW - 40, y: leftY, w: 40, h: ITEM_H,
      icon: 'x',
      onInteract: () => { main.removeMeshes([mesh]); main.render(); }
    });

    leftY += ITEM_H + GAP;
  }

  leftY += 10;


  // --- RIGHT COLUMN: BOOLEANS, SELECTION, PRIMITIVES ---
  widgets.push({ type: 'header', id: 'header_booleans', label: 'Booleans', x: rightX, y: rightY, w: colW, h: HEADER_H, header: true });
  rightY += HEADER_H + GAP;

  const selectedMeshes = main.getSelectedMeshes();
  let booleanLabel = 'Boolean Ops (Select 2)';
  let booleanInteract = null;
  let booleanDisabled = true;

  if (selectedMeshes.length === 2) {
    const mesh1 = selectedMeshes[0];
    const mesh2 = selectedMeshes[1];
    const v1 = mesh1.isVisible();
    const v2 = mesh2.isVisible();

    if (v1 && v2) booleanLabel = 'Boolean Union';
    else if (!v1 && !v2) booleanLabel = 'Boolean Intersect';
    else booleanLabel = 'Boolean Subtract';
    
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
    type: 'button', id: 'booleanOp', label: booleanLabel, x: rightX, y: rightY, w: colW, h: ITEM_H,
    disabled: booleanDisabled,
    onInteract: booleanInteract
  });
  rightY += ITEM_H + GAP;

  widgets.push({
    type: 'checkbox', id: 'quadrangulate_boolean', label: 'Quadrangulate Result', x: rightX, y: rightY, w: colW, h: ITEM_H,
    value: Remesh.QUADRANGULATE,
    onInteract: (val) => { Remesh.QUADRANGULATE = val; }
  });
  rightY += ITEM_H + GAP;

  rightY += 10;

  // --- SELECTION ---
  widgets.push({ type: 'header', id: 'header_selection', label: 'Selection', x: rightX, y: rightY, w: colW, h: HEADER_H, header: true });
  rightY += HEADER_H + GAP;

  const thirdW = (colW - 2 * GAP) / 3;
  widgets.push({
    type: 'button', id: 'selectAll', label: 'All', x: rightX, y: rightY, w: thirdW, h: ITEM_H,
    onInteract: () => {
      const all = main.getMeshes();
      all.forEach(m => {
        if (!m._isVoxelChunk && !main.getSelectedMeshes().includes(m)) {
          main.setOrUnsetMesh(m, true);
        }
      });
      main.render();
    }
  });

  widgets.push({
    type: 'button', id: 'selectNone', label: 'None', x: rightX + thirdW + GAP, y: rightY, w: thirdW, h: ITEM_H,
    onInteract: () => {
      main._selectMeshes.length = 0;
      if (main.getMesh()) main._selectMeshes.push(main.getMesh());
      main.render();
    }
  });

  widgets.push({
    type: 'button', id: 'selectInvert', label: 'Invert', x: rightX + 2 * (thirdW + GAP), y: rightY, w: thirdW, h: ITEM_H,
    onInteract: () => {
      const all = main.getMeshes();
      const currentSelected = [...main.getSelectedMeshes()];
      main._selectMeshes.length = 0;
      
      all.forEach(m => {
        if (!m._isVoxelChunk && !currentSelected.includes(m)) {
          main._selectMeshes.push(m);
        }
      });
      if (main._selectMeshes.length === 0 && main.getMesh()) {
        main._selectMeshes.push(main.getMesh());
      }
      main.render();
    }
  });
  rightY += ITEM_H + GAP;

  const halfWSelection = (colW - GAP) / 2;
  widgets.push({
    type: 'button', id: 'toggleVisSelected', label: 'Show/Hide', x: rightX, y: rightY, w: halfWSelection, h: ITEM_H,
    onInteract: () => {
      const selected = main.getSelectedMeshes();
      if (selected.length > 0) {
        const targetVis = !selected[0].isVisible();
        selected.forEach(m => {
          m.setVisible(targetVis);
          if (m.getThreeMesh()) m.getThreeMesh().visible = targetVis;
        });
        main.render();
      }
    }
  });

  widgets.push({
    type: 'button', id: 'deleteSelected', label: 'Delete', x: rightX + halfWSelection + GAP, y: rightY, w: halfWSelection, h: ITEM_H,
    onInteract: () => {
      const selected = [...main.getSelectedMeshes()];
      if (selected.length > 0) {
        main.removeMeshes(selected);
        main.render();
      }
    }
  });
  rightY += ITEM_H + GAP;

  widgets.push({
    type: 'button', id: 'duplicateSelection', label: 'Duplicate', x: rightX, y: rightY, w: colW, h: ITEM_H,
    onInteract: () => {
      try { main.duplicateSelection(); }
      catch (e) { console.error(e); }
    }
  });
  rightY += ITEM_H + GAP;

  widgets.push({
    type: 'button', id: 'merge', label: 'Merge', x: rightX, y: rightY, w: colW, h: ITEM_H,
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
  rightY += ITEM_H + GAP;

  widgets.push({
    type: 'checkbox', id: 'lockSelection', label: 'Lock', x: rightX, y: rightY, w: colW, h: ITEM_H,
    value: !!main._lockSelection,
    onInteract: (val) => { main._lockSelection = val; }
  });
  rightY += ITEM_H + GAP;

  let isIsolate = false;
  if (main.getGui() && main.getGui()._ctrlScene) {
    isIsolate = main.getGui()._ctrlScene.hasHiddenMeshes();
  }
  widgets.push({
    type: 'checkbox', id: 'isolate', label: 'Isolate', x: rightX, y: rightY, w: colW, h: ITEM_H,
    value: isIsolate,
    onInteract: (val) => {
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
  rightY += ITEM_H + GAP;

  if (!isConfirmingClear) {
    widgets.push({ 
      type: 'button', id: 'clearScene', label: 'Clear Scene', x: rightX, y: rightY, w: colW, h: ITEM_H, 
      onInteract: () => { 
        isConfirmingClear = true;
        if (main.getGuiXR()) main.getGuiXR().refreshSceneWidget();
      } 
    });
    rightY += ITEM_H + GAP;
  } else {
    widgets.push({ 
      type: 'info', id: 'clearScene_info', label: 'Clear Scene? (No Undo)', x: rightX, y: rightY, w: colW, h: ITEM_H, color: '#ff4444'
    });
    rightY += ITEM_H + GAP;

    const halfW = (colW - GAP) / 2;
    widgets.push({ 
      type: 'button', id: 'clearScene_ok', label: 'OK', x: rightX, y: rightY, w: halfW, h: ITEM_H, 
      onInteract: () => { 
        isConfirmingClear = false;
        main.clearScene();
        if (main.getGuiXR()) main.getGuiXR().refreshSceneWidget();
      } 
    });

    widgets.push({ 
      type: 'button', id: 'clearScene_cancel', label: 'Cancel', x: rightX + halfW + GAP, y: rightY, w: halfW, h: ITEM_H, 
      onInteract: () => { 
        isConfirmingClear = false;
        if (main.getGuiXR()) main.getGuiXR().refreshSceneWidget();
      } 
    });
    rightY += ITEM_H + GAP;
  }

  // --- TRANSFORM UTILITIES ---
  widgets.push({ type: 'header', id: 'header_transforms', label: 'Transform Utilities', x: rightX, y: rightY, w: colW, h: HEADER_H, header: true });
  rightY += HEADER_H + GAP;

  const activeMeshForReadout = main.getMesh();
  let scaleStr = "Identity (1.0)";
  if (activeMeshForReadout) {
    const sc = activeMeshForReadout.getScale();
    if (Math.abs(sc - 1.0) > 0.001) {
      scaleStr = sc.toFixed(6);
    }
  }

  widgets.push({
    type: 'info', id: 'transform_scale_readout', label: 'Current Scale: ' + scaleStr, x: rightX, y: rightY, w: colW, h: ITEM_H, color: '#aaaaaa'
  });
  rightY += ITEM_H + GAP;

  widgets.push({
    type: 'button', id: 'bakeTransform', label: 'Bake Transform (Freeze to Vertices)', x: rightX, y: rightY, w: colW, h: ITEM_H,
    onInteract: () => {
      const active = main.getMesh();
      if (active) {
        const vAr = active.getVertices();
        const mat = active.getMatrix();
        for (let j = 0; j < active.getNbVertices(); ++j) {
          const ind = j * 3;
          const x = vAr[ind];
          const y = vAr[ind + 1];
          const z = vAr[ind + 2];
          vAr[ind]     = mat[0] * x + mat[4] * y + mat[8]  * z + mat[12];
          vAr[ind + 1] = mat[1] * x + mat[5] * y + mat[9]  * z + mat[13];
          vAr[ind + 2] = mat[2] * x + mat[6] * y + mat[10] * z + mat[14];
        }

        mat[0] = 1; mat[1] = 0; mat[2] = 0; mat[3] = 0;
        mat[4] = 0; mat[5] = 1; mat[6] = 0; mat[7] = 0;
        mat[8] = 0; mat[9] = 0; mat[10] = 1; mat[11] = 0;
        mat[12] = 0; mat[13] = 0; mat[14] = 0; mat[15] = 1;

        active.updateGeometry();
        active.updateBuffers();
        if (active.computeOctree) active.computeOctree();
        main.render();
        if (main.getGuiXR()) main.getGuiXR().refreshSceneWidget();
      }
    }
  });
  rightY += ITEM_H + GAP;

  rightY += 10;

  // --- PRIMITIVES ---
  widgets.push({ type: 'header', id: 'header_primitives', label: 'Primitives', x: rightX, y: rightY, w: colW, h: HEADER_H, header: true });
  rightY += HEADER_H + GAP;

  widgets.push({ type: 'button', id: 'addSphere', label: 'Add Sphere', x: rightX, y: rightY, w: colW, h: ITEM_H, onInteract: () => main.addSphere() });
  rightY += ITEM_H + GAP;
  widgets.push({ type: 'button', id: 'addCube', label: 'Add Cube', x: rightX, y: rightY, w: colW, h: ITEM_H, onInteract: () => main.addCube() });
  rightY += ITEM_H + GAP;
  widgets.push({ type: 'button', id: 'addCylinder', label: 'Add Cylinder', x: rightX, y: rightY, w: colW, h: ITEM_H, onInteract: () => main.addCylinder() });
  rightY += ITEM_H + GAP;
  widgets.push({ type: 'button', id: 'addTorus', label: 'Add Torus', x: rightX, y: rightY, w: colW, h: ITEM_H, onInteract: () => main.addTorus() });
  rightY += ITEM_H + GAP;
  widgets.push({ type: 'button', id: 'addGrid', label: 'Add Grid', x: rightX, y: rightY, w: colW, h: ITEM_H, onInteract: () => main.addGrid() });
  rightY += ITEM_H + GAP;
  widgets.push({ type: 'button', id: 'addVoxelBlock', label: 'Add Empty Voxel Object', x: rightX, y: rightY, w: colW, h: ITEM_H, icon: 'box', onInteract: () => main.addVoxelObject() });
  rightY += ITEM_H + GAP;

  rightY += 10;

  // --- BOTTOM ROW: DISPLAY & SYMMETRY ---
  let bottomY = Math.max(leftY, rightY) + 20;
  widgets.push({ type: 'header', id: 'header_display', label: 'Display & Symmetry', x: leftX, y: bottomY, w: menuW - 40, h: HEADER_H, header: true });
  bottomY += HEADER_H + GAP;

  widgets.push({ type: 'checkbox', id: 'grid', label: 'Show Grid', x: leftX, y: bottomY, w: colW, h: ITEM_H, value: main._showGrid, onInteract: () => { main._showGrid = !main._showGrid; main.render(); } });
  widgets.push({ type: 'checkbox', id: 'contour', label: 'Show Contour', x: rightX, y: bottomY, w: colW, h: ITEM_H, value: main._showContour, onInteract: () => { main._showContour = !main._showContour; main.render(); } });
  bottomY += ITEM_H + GAP;

  widgets.push({ type: 'checkbox', id: 'show_sym', label: 'Show Symmetry Line', x: leftX, y: bottomY, w: colW, h: ITEM_H, value: ShaderBase.showSymmetryLine, onInteract: () => { ShaderBase.showSymmetryLine = !ShaderBase.showSymmetryLine; main.render(); } });
  bottomY += ITEM_H + GAP;

  const mesh = main.getMesh();
  const symOffset = mesh ? mesh.getSymmetryOffset() : 0;
  widgets.push({
    type: 'slider', id: 'symmetryOffset', label: 'Sym Offset', x: leftX, y: bottomY, w: menuW - 40, h: ITEM_H, value: symOffset, min: -1, max: 1, step: 0.001,
    onInput: (val) => { if (mesh) { mesh.setSymmetryOffset(val); main.render(); } }
  });
  bottomY += ITEM_H + GAP;

  return {
    width: menuW,
    height: bottomY + 10,
    widgets: widgets
  };
}
