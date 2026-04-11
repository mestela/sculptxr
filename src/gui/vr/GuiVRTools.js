import Enums from '../../misc/Enums.js';
import getOptionsURL from '../../misc/getOptionsURL.js';
import TR from '../GuiTR.js';
import Tools from '../../editing/tools/Tools.js';
import Picking from '../../math3d/Picking.js';
import { vec3 } from 'gl-matrix';
import VoxelDensityOverlay from '../../render/VoxelDensityOverlay.js';


export default function getToolsWidgets(main, activeToolIndex, isMiniHUD = false) {
  if (activeToolIndex === undefined) activeToolIndex = main.getSculptManager().getToolIndex();
  const activeToolDef = Tools[activeToolIndex];
  const mesh = main.getMesh();
  const isVoxelMesh = mesh && mesh._isVoxel;
  const widgets = [];

  // Spacing Constants
  const col1X = 20;
  const btnH = 50; // Dense
  const gapBtn = 15;
  const gapSection = 30;
  const gapHeader = 30;

  let y = 100; // Start higher up to maximize Mini-HUD space

  // 1. Tool Selection (Standalone Icon / Combobox Button)
  // Removed "Tool" info header for a cleaner HUD look.

  // Build Options from Tools array
  const tab0Ids = [
    Enums.Tools.BRUSH,
    Enums.Tools.INFLATE,
    Enums.Tools.FLATTEN,
    Enums.Tools.PINCH,
    Enums.Tools.CREASE,
    Enums.Tools.SMOOTH,
    Enums.Tools.RELAX,
    Enums.Tools.PAINT,
    Enums.Tools.MOVE,
    Enums.Tools.GRAB,
    Enums.Tools.DRAG,
    Enums.Tools.SLIDE,
    Enums.Tools.TWIST,
    Enums.Tools.TRANSFORM_VR,
    Enums.Tools.MASKING
  ];

  const tab1Ids = [
    Enums.Tools.CUT_TOOL,
    Enums.Tools.EXTRUDE,
    Enums.Tools.INSET,
    Enums.Tools.DELETE_FACE,
    Enums.Tools.FILL_HOLE,
    Enums.Tools.DISSOLVE_EDGE,
    Enums.Tools.SPLIT_FACE,
    Enums.Tools.SPLIT_EDGE,
    Enums.Tools.EDGE_CREATE,
    Enums.Tools.SPIN_EDGE,
    Enums.Tools.COLLAPSE_EDGE,
    Enums.Tools.DISSOLVE_VERTEX,
    Enums.Tools.WELD
  ];

  window._activeToolTab = window._activeToolTab || 0;
  const orderedToolIds = window._activeToolTab === 0 ? tab0Ids : tab1Ids;

  const toolOptions = orderedToolIds.map(id => {
    if (id === null) return null;
    const t = Tools[id];
    let label = TR(t.uiName);
    label = label.replace(/\s*\([^)]*\)$/, '');
    if (label.includes('Transform VR')) label = 'Transform';

    return { label: label, id: id };
  });

  const getToolTint = (id) => {
    switch (id) {
      case Enums.Tools.BRUSH:
      case Enums.Tools.INFLATE:
      case Enums.Tools.VOXEL:
      case Enums.Tools.FLATTEN:
      case Enums.Tools.PINCH:
      case Enums.Tools.CREASE:
        return '#ebc5c5'; // Red (bright)
      case Enums.Tools.SMOOTH:
      case Enums.Tools.RELAX:
        return '#c5d3eb'; // Blue (bright)
      case Enums.Tools.MOVE:
      case Enums.Tools.GRAB:
      case Enums.Tools.SLIDE:
      case Enums.Tools.DRAG:
      case Enums.Tools.TWIST:
      case Enums.Tools.TRANSFORM:
      case Enums.Tools.TRANSFORM_VR:
      case Enums.Tools.LOCALSCALE:
        return '#c5ebc5'; // Green (bright)

      case Enums.Tools.CUT_TOOL:
      case Enums.Tools.EXTRUDE:
      case Enums.Tools.INSET:
      case Enums.Tools.DELETE_FACE:
      case Enums.Tools.FILL_HOLE:
      case Enums.Tools.DISSOLVE_EDGE:
      case Enums.Tools.SPLIT_FACE:
      case Enums.Tools.SPLIT_EDGE:
      case Enums.Tools.EDGE_CREATE:
      case Enums.Tools.SPIN_EDGE:
      case Enums.Tools.COLLAPSE_EDGE:
      case Enums.Tools.DISSOLVE_VERTEX:
      case Enums.Tools.WELD:
        return '#dcd6a8'; // Desaturated Yellow (curated)

      case Enums.Tools.PAINT:
        return '#dec5eb'; // Purple (bright)
      case Enums.Tools.MASKING:
        return '#ebdcc5'; // Orange (bright)
      default:
        return '#eeeeee';
    }
  };

  if (isMiniHUD) {
    // Add Main Menu Button
    widgets.push({
      type: 'button',
      id: 'main_menu',
      label: '[ Main Menu ]',
      x: col1X, y: y, w: 710, h: 50,
      data: { tint: '#444' },
      onInteract: () => {
        if (main._guiXR) {
          main._guiXR.toggleVisibility();
        }
      }
    });
    
    y += 60; // Space for the next button

    let toolLabelText = activeToolDef ? TR(activeToolDef.uiName) : '';
    if (activeToolIndex === Enums.Tools.VOXEL || window._activeToolTab === 2) {
      const vTool = main.getSculptManager().getTool(Enums.Tools.VOXEL);
      if (vTool) {
        const vMode = vTool._mode;
        const vNeg = vTool._negative;
        if (vMode === 0 && !vNeg) toolLabelText = 'Voxel (Add)';
        else if (vMode === 1 || (vMode === 0 && vNeg)) toolLabelText = 'Voxel (Sub)';
        else if (vMode === 3) toolLabelText = 'Voxel (Smooth)';
        else if (vMode === 4) toolLabelText = 'Voxel (Move)';
        else if (vMode === 2 && !vNeg) toolLabelText = 'Voxel (Inflate)';
        else if (vMode === 2 && vNeg) toolLabelText = 'Voxel (Deflate)';
        else toolLabelText = `Voxel (Mode ${vMode})`;
      }
    }

    widgets.push({
      type: 'button',
      id: 'tool_select',
      label: 'Tool: ' + toolLabelText,
      x: col1X, y: y, w: 710, h: 80, // Much larger and wider, acts as the primary HUD button
      data: { tint: getToolTint(activeToolIndex) },
      onInteract: () => {
        const toolPickerWidgets = [];
        
        const pad = 0;
        const cols = 3;
        const btnW = 150;
        const btnH = 60;

        const validOptions = toolOptions.filter(opt => opt !== null);
        const boxH = Math.ceil(validOptions.length / cols) * (btnH + pad) + pad;
        const startY = Math.max(160, 260 - (boxH / 2));

        const tabW = 150; // 450px / 3 = 150px exactly!
        const tabX = (660 - 450) / 2;

        toolPickerWidgets.push({
          type: 'sub_tab', id: 'popup_tab0', label: 'Sculpting',
          x: tabX, y: startY - 60, w: tabW, h: 60,
          data: { active: window._activeToolTab === 0 },
          onInteract: () => {
            window._activeToolTab = 0;
            if (main._guiMini) main._guiMini._tabWidgets['Tools'] = null;
            if (main._guiPopup) {
               const toolBtn = main._guiMini ? main._guiMini._getWidgets().find(w => w.id === 'tool_select') : null;
               if (toolBtn && toolBtn.onInteract) toolBtn.onInteract();
            }
          }
        });

        toolPickerWidgets.push({
          type: 'sub_tab', id: 'popup_tab1', label: 'Low Poly',
          x: tabX + tabW, y: startY - 60, w: tabW, h: 60,
          data: { active: window._activeToolTab === 1 },
          onInteract: () => {
            window._activeToolTab = 1;
            if (main._guiMini) main._guiMini._tabWidgets['Tools'] = null;
            if (main._guiPopup) {
               const toolBtn = main._guiMini ? main._guiMini._getWidgets().find(w => w.id === 'tool_select') : null;
               if (toolBtn && toolBtn.onInteract) toolBtn.onInteract();
            }
          }
        });

        toolPickerWidgets.push({
          type: 'sub_tab', id: 'popup_tab2', label: 'Voxel',
          x: tabX + (tabW * 2), y: startY - 60, w: tabW, h: 60,
          data: { active: window._activeToolTab === 2 },
          onInteract: () => {
            window._activeToolTab = 2;
            if (main._guiMini) main._guiMini._tabWidgets['Tools'] = null;
            if (main._guiPopup) {
               const toolBtn = main._guiMini ? main._guiMini._getWidgets().find(w => w.id === 'tool_select') : null;
               if (toolBtn && toolBtn.onInteract) toolBtn.onInteract();
            }
          }
        });

        // Calculate maximum box width (used for vertical centering)
        const maxBoxW = cols * (btnW + pad) + pad; // Total theoretical width

        if (window._activeToolTab === 2) {
          const voxelTool = main.getSculptManager().getTool(Enums.Tools.VOXEL);
          
          const setVoxelMode = (m, neg) => {
            if (!isVoxelMesh) return;
            if (voxelTool) {
              voxelTool._mode = m;
              voxelTool._negative = neg;
              main.getSculptManager().setToolIndex(Enums.Tools.VOXEL);
              if (main._guiPopup) main._guiPopup.closeOverlay();
              if (main._guiMini) { main._guiMini.refreshToolsWidget(); main._guiMini._needsRedraw = true; }
            }
          };

          const mode = voxelTool ? voxelTool._mode : 0;
          const isNeg = voxelTool ? voxelTool._negative : false;

          const vxOptions = [
            { label: 'Add', id: 'vx_add', active: mode === 0 && !isNeg, action: () => setVoxelMode(0, false) },
            { label: 'Sub', id: 'vx_sub', active: mode === 1 || (mode === 0 && isNeg), action: () => setVoxelMode(1, false) },
            { label: 'Smooth', id: 'vx_smooth', active: mode === 3, action: () => setVoxelMode(3, false) },
            { label: 'Move', id: 'vx_move', active: mode === 4, action: () => setVoxelMode(4, false) },
            { label: 'Inflate', id: 'vx_inf', active: mode === 2 && !isNeg, action: () => setVoxelMode(2, false) },
            { label: 'Deflate', id: 'vx_def', active: mode === 2 && isNeg, action: () => setVoxelMode(2, true) }
          ];

          const numRows = Math.ceil(vxOptions.length / cols);
          for (let r = 0; r < numRows; r++) {
            const itemsInRow = Math.min(cols, vxOptions.length - (r * cols));
            const rowW = itemsInRow * (btnW + pad) - pad;
            const rowStartX = (660 - rowW) / 2;

            for (let c = 0; c < itemsInRow; c++) {
              const opt = vxOptions[r * cols + c];
              toolPickerWidgets.push({
                type: 'button', id: opt.id, label: opt.label,
                x: rowStartX + c * (btnW + pad), y: startY + r * (btnH + pad), w: btnW, h: btnH,
                disabled: !isVoxelMesh,
                data: { active: opt.active, tint: '#ebc5c5' },
                onInteract: opt.action
              });
            }
          }
        } else {
          let currentOptionIdx = 0;
          let numRows = Math.ceil(validOptions.length / cols);

          for (let r = 0; r < numRows; r++) {
            let itemsInRow = Math.min(cols, validOptions.length - (r * cols));
            let rowW = itemsInRow * (btnW + pad) - pad;
            let rowStartX = (660 - rowW) / 2;

            for (let c = 0; c < itemsInRow; c++) {
              const opt = validOptions[currentOptionIdx];

              toolPickerWidgets.push({
                type: 'button', id: opt.id, label: opt.label,
                x: rowStartX + c * (btnW + pad),
                y: startY + r * (btnH + pad),
                w: btnW, h: btnH,
                disabled: isVoxelMesh,
                data: { active: activeToolIndex === opt.id, tint: getToolTint(opt.id) },
                onInteract: () => {
                  if (isVoxelMesh) return;
                  const guiGroup = main.getGui()._ctrlSculpting;
                  if (guiGroup && guiGroup._ctrlSculpt) {
                    guiGroup._ctrlSculpt.setValue(opt.id);
                  } else {
                    main.getSculptManager().setToolIndex(opt.id);
                  }

                  if (main._guiPopup) main._guiPopup.closeOverlay();
                  if (main._guiMini) {
                    main._guiMini.refreshToolsWidget();
                    main._guiMini.syncWidgetValues();
                    main._guiMini._needsRedraw = true;
                  }
                  if (main._guiXR) {
                    main._guiXR.refreshToolsWidget();
                    main._guiXR.syncWidgetValues();
                  }
                }
              });
              currentOptionIdx++;
            }
          }
        }

        if (main._guiPopup) {
          main._guiPopup.openOverlay('menu', { x: 0, y: 0, w: 660, h: 660, widgets: toolPickerWidgets, isToolPicker: true });
          main._guiPopup._needsRedraw = true;
        }
      }
    });

    y += 80 + gapSection;

  } else {
    const tabW = 253; // 780px / 3 = 253px
    widgets.push({
      type: 'sub_tab', id: 'sidebar_tab0', label: 'Sculpting',
      x: col1X, y: y, w: tabW, h: 60,
      data: { active: window._activeToolTab === 0 },
      onInteract: () => {
        window._activeToolTab = 0;
        if (main._guiXR) { main._guiXR.refreshToolsWidget(); main._guiXR._needsRedraw = true; }
      }
    });

    widgets.push({
      type: 'sub_tab', id: 'sidebar_tab1', label: 'Low Poly',
      x: col1X + tabW + 10, y: y, w: tabW, h: 60,
      data: { active: window._activeToolTab === 1 },
      onInteract: () => {
        window._activeToolTab = 1;
        if (main._guiXR) { main._guiXR.refreshToolsWidget(); main._guiXR._needsRedraw = true; }
      }
    });

    widgets.push({
      type: 'sub_tab', id: 'sidebar_tab2', label: 'Voxel',
      x: col1X + (tabW * 2) + 20, y: y, w: tabW, h: 60,
      data: { active: window._activeToolTab === 2 },
      onInteract: () => {
        window._activeToolTab = 2;
        if (main._guiXR) { main._guiXR.refreshToolsWidget(); main._guiXR._needsRedraw = true; }
      }
    });
    y += 60; // Removed gap so it sits directly on top of the buttons below!
    const pad = 15;
    const cols = 3;
    const btnW = 250;
    const btnH = 60;

    if (window._activeToolTab === 2) {
      const voxelTool = main.getSculptManager().getTool(Enums.Tools.VOXEL);
      
      const setVoxelMode = (m, neg) => {
        if (!isVoxelMesh) return;
        if (voxelTool) {
          voxelTool._mode = m;
          voxelTool._negative = neg;
          main.getSculptManager().setToolIndex(Enums.Tools.VOXEL);
          if (main._guiXR) { main._guiXR.refreshToolsWidget(); main._guiXR._needsRedraw = true; }
        }
      };

      const mode = voxelTool ? voxelTool._mode : 0;
      const isNeg = voxelTool ? voxelTool._negative : false;

      const vxOptions = [
        { label: 'Add', id: 'vx_add', active: mode === 0 && !isNeg, action: () => setVoxelMode(0, false) },
        { label: 'Sub', id: 'vx_sub', active: mode === 1 || (mode === 0 && isNeg), action: () => setVoxelMode(1, false) },
        { label: 'Smooth', id: 'vx_smooth', active: mode === 3, action: () => setVoxelMode(3, false) },
        { label: 'Move', id: 'vx_move', active: mode === 4, action: () => setVoxelMode(4, false) },
        { label: 'Inflate', id: 'vx_inf', active: mode === 2 && !isNeg, action: () => setVoxelMode(2, false) },
        { label: 'Deflate', id: 'vx_def', active: mode === 2 && isNeg, action: () => setVoxelMode(2, true) }
      ];

      for (let r = 0; r < Math.ceil(vxOptions.length / cols); r++) {
        for (let c = 0; c < Math.min(cols, vxOptions.length - (r * cols)); c++) {
          const opt = vxOptions[r * cols + c];
          widgets.push({
            type: 'button', id: opt.id, label: opt.label,
            x: col1X + c * (btnW + pad), y: y + r * (btnH + pad), w: btnW, h: btnH,
            disabled: !isVoxelMesh,
            data: { active: opt.active, tint: '#ebc5c5' },
            onInteract: opt.action
          });
        }
      }
      y += Math.ceil(vxOptions.length / cols) * (btnH + pad) + gapSection;

    } else {
      const validDesktopOptions = toolOptions.filter(opt => opt !== null);
      let currentDesktopOptionIdx = 0;
      let numDesktopRows = Math.ceil(validDesktopOptions.length / cols);

      for (let r = 0; r < numDesktopRows; r++) {
        for (let c = 0; c < Math.min(cols, validDesktopOptions.length - (r * cols)); c++) {
          const opt = validDesktopOptions[currentDesktopOptionIdx];

          widgets.push({
            type: 'button', id: opt.id, label: opt.label,
            x: col1X + c * (btnW + pad), y: y + r * (btnH + pad), w: btnW, h: btnH,
            disabled: isVoxelMesh,
            data: { active: activeToolIndex === opt.id, tint: getToolTint(opt.id) },
            onInteract: () => {
              if (isVoxelMesh) return;
              const guiGroup = main.getGui()._ctrlSculpting;
              if (guiGroup && guiGroup._ctrlSculpt) {
                guiGroup._ctrlSculpt.setValue(opt.id);
              } else {
                main.getSculptManager().setToolIndex(opt.id);
              }

              if (main._guiXR) {
                main._guiXR.refreshToolsWidget();
                main._guiXR.syncWidgetValues();
                main._guiXR._needsRedraw = true;
              }
              if (main._guiPopup) {
                main._guiPopup.refreshToolsWidget();
              }
            }
          });
          currentDesktopOptionIdx++;
        }
      }
      y += numDesktopRows * (btnH + pad) + gapSection;
    }
  }


  // 2. Brush Settings
  const activeTool = main.getSculptManager().getTool(activeToolIndex);

  // Radius
  widgets.push({
    type: 'slider',
    id: 'radius',
    label: 'Radius',
    x: col1X, y: y, w: 710, h: 60, // Stacked and widened for easier hitting
    value: activeTool ? activeTool._radius : 50,
    min: 5, max: 250, precision: 0,
    onInput: (val) => { 
      if (activeTool) { 
        activeTool._radius = val; 
        getOptionsURL.saveOption(`tool_${activeToolIndex}_radius`, val, 500);
        main.render(); 
      } 
    }
  });

  y += 60 + gapBtn;

  // Intensity
  widgets.push({
    type: 'slider',
    id: 'intensity',
    label: 'Intensity',
    x: col1X, y: y, w: 710, h: 60, // Stacked below Radius
    value: activeTool ? activeTool._intensity : 0.5,
    min: 0, max: 1, precision: 2,
    onInput: (val) => { 
      if (activeTool) { 
        activeTool._intensity = val; 
        getOptionsURL.saveOption(`tool_${activeToolIndex}_intensity`, val, 500);
        main.render(); 
      } 
    }
  });
  y += 60 + gapSection;

  // 2b. Tool Specific Settings
  // --- EXTRUDE / INSET ---
  if (activeToolIndex === Enums.Tools.EXTRUDE || activeToolIndex === Enums.Tools.INSET || (activeTool && (activeTool.constructor.name === 'Extrude' || activeTool.constructor.name === 'Inset'))) {
    const keepVal = !!window.keepExtrudeFacesTogether;
    const btnHeight = 60; // Standard btnH
    widgets.push({
      type: 'checkbox',
      id: 'mini_extrude_keep_together',
      label: 'Keep Together',
      x: col1X, y: y, w: isMiniHUD ? 710 : 550, h: btnHeight,
      value: keepVal,
      onInteract: () => {
        window.keepExtrudeFacesTogether = !window.keepExtrudeFacesTogether;
        if (main._guiXR) {
          main._guiXR.refreshToolsWidget();
          main._guiXR._needsRedraw = true;
        }
        if (main._guiMini) {
          main._guiMini.refreshToolsWidget();
          main._guiMini._needsRedraw = true;
        }
      }
    });
    y += btnHeight + gapBtn;
  }
  if (activeToolIndex === Enums.Tools.VOXEL && activeTool) {
    widgets.push({
      type: 'button',
      id: 'voxel_bake',
      label: 'Bake to Mesh',
      x: col1X, y: y, w: isMiniHUD ? 710 : 550, h: 60,
      onInteract: () => {
        if (activeTool.bakeToMesh) activeTool.bakeToMesh();
      }
    });
    y += 60 + 15;
  }

  // --- PAINT ---
  if ((activeToolIndex === Enums.Tools.PAINT || activeToolIndex === Enums.Tools.VOXEL) && activeTool) {
    // Color Picker (Replacing RGB Sliders & Header)
    const color = activeTool._color;
    widgets.push({
      type: 'colorpicker_embedded',
      id: 'picker',
      label: 'Color',
      x: col1X, y: y, w: 350, h: 380, // Taller size
      // value: color, // Passed via tool ref actually
    });
    // Height of picker (380) + small gap
    y += 380 + 10;

    // Material (Roughness, Metallic)
    widgets.push({
      type: 'slider', id: 'roughness', label: 'Roughness', x: col1X, y: y, w: 350, h: 50,
      value: activeTool._material ? activeTool._material[0] : 0.4, min: 0, max: 1, step: 0.01, precision: 2,
      onInput: (val) => { 
        if (activeTool._material) activeTool._material[0] = val; 
        getOptionsURL.saveOption(`tool_${activeToolIndex}_roughness`, val, 500);
        main.render(); 
      }
    });
    y += 55;
    widgets.push({
      type: 'slider', id: 'metallic', label: 'Metallic', x: col1X, y: y, w: 350, h: 50,
      value: activeTool._material ? activeTool._material[1] : 0.1, min: 0, max: 1, step: 0.01, precision: 2,
      onInput: (val) => { 
        activeTool._material[1] = val; 
        getOptionsURL.saveOption(`tool_${activeToolIndex}_metallic`, val, 500);
        main.render(); 
      }
    });
    y += 55 + gapBtn;

    // Swap Colors / Paint All
    widgets.push({
      type: 'button', id: 'swap_colors', label: 'Swap FG/BG', x: col1X, y: y, w: 170, h: btnH,
      onInteract: () => {
        activeTool.swapColors();
        main.render();
        if (main._guiXR) main._guiXR._needsRedraw = true;
        if (main._guiMini) main._guiMini._needsRedraw = true;
      }
    });
    widgets.push({
      type: 'button', id: 'paint_all', label: 'Paint All', x: col1X + 180, y: y, w: 170, h: btnH,
      onInteract: () => { activeTool.paintAll(); main.render(); }
    });
    y += btnH + gapSection;
  }

  // --- MASKING ---
  if (activeToolIndex === Enums.Tools.MASKING && activeTool) {
    widgets.push({ type: 'info', label: 'Masking Actions', x: col1X, y: y });
    y += gapHeader;

    // Clear / Invert
    widgets.push({
      type: 'button', id: 'mask_clear', label: 'Clear Mask', x: col1X, y: y, w: 170, h: btnH,
      onInteract: () => { activeTool.clear(); main.render(); }
    });
    widgets.push({
      type: 'button', id: 'mask_invert', label: 'Invert Mask', x: col1X + 180, y: y, w: 170, h: btnH,
      onInteract: () => { activeTool.invert(); main.render(); }
    });
    y += btnH + gapBtn;

    // Blur / Sharpen
    widgets.push({
      type: 'button', id: 'mask_blur', label: 'Blur', x: col1X, y: y, w: 170, h: btnH,
      onInteract: () => { activeTool.blur(); main.render(); }
    });
    widgets.push({
      type: 'button', id: 'mask_sharpen', label: 'Sharpen', x: col1X + 180, y: y, w: 170, h: btnH,
      onInteract: () => { activeTool.sharpen(); main.render(); }
    });
    y += btnH + gapSection;
  }

  // --- MOVE ---
  if (activeToolIndex === Enums.Tools.MOVE && activeTool) {
    widgets.push({
      type: 'checkbox', id: 'topo_check', label: 'Topological Check', x: col1X, y: y, w: 350, h: btnH,
      value: activeTool._topoCheck,
      onInteract: () => { 
        activeTool._topoCheck = !activeTool._topoCheck; 
        getOptionsURL.saveOption(`tool_${activeToolIndex}_topoCheck`, activeTool._topoCheck);
      }
    });
    y += btnH + gapSection;
  }

  // --- FLATTEN / SCRAPE / PINCH / CREASE / LOCALSCALE / SMOOTH ---
  // Add Culling Option for these tools
  if ([Enums.Tools.FLATTEN, Enums.Tools.SCRAPE, Enums.Tools.PINCH, Enums.Tools.CREASE, Enums.Tools.LOCALSCALE, Enums.Tools.SMOOTH].includes(activeToolIndex)) {
    // Already have "Thin Surface" (Culling) in generic list below?
    // Let's check generic list.
    // Yes, generic list adds "Thin Surface" (Culling) later.
    // So we don't need to add it here specificallly unless we want to prioritize it.
    // Generic placement is fine.
  }

  // --- TRANSFORM VR ---
  if (activeToolIndex === Enums.Tools.TRANSFORM_VR && activeTool) {
    widgets.push({ type: 'info', label: 'Transform Constraints', x: col1X, y: y });
    y += gapHeader;

    const ROW_Labels = ['Translate', 'Rotate', 'Scale']; // Not used for buttons, maybe for info?
    const COL_Labels = ['X', 'Y', 'Z'];
    const btnSize = (350 - 20) / 3; // 3 buttons, 10px gaps

    // Helper to refresh
    const refresh = () => { if (main._guiXR) main._guiXR.refreshToolsWidget(); };

    for (let r = 0; r < 3; ++r) {
      for (let c = 0; c < 3; ++c) {
        // ID: tx_0_0, etc.
        const isActiveMode = (activeTool._mode === r);
        const isAxisActive = isActiveMode && activeTool._axisMask[c];

        const label = COL_Labels[c];
        // Visual feedback for active state:
        // GuiVR doesn't support color change easily via this API?
        // We can prepend "> " or something? or "[ X ]".
        const displayLabel = isAxisActive ? `[ ${label} ]` : label;

        widgets.push({
          type: 'button',
          id: `tr_${r}_${c}`,
          label: label, // Just Label
          x: col1X + c * (btnSize + 10),
          y: y,
          w: btnSize,
          h: btnH,
          data: { active: isAxisActive }, // Highlight!
          onInteract: () => {
            if (activeTool._mode !== r) {
              // Switch Mode
              activeTool._mode = r;
              activeTool._axisMask = [false, false, false];
              activeTool._axisMask[c] = true;
            } else {
              // Toggle Axis
              activeTool._axisMask[c] = !activeTool._axisMask[c];
            }
            refresh();
          }
        });
      }
      y += btnH + gapBtn;
    }
    y += gapSection;
  }
  if (activeToolIndex === Enums.Tools.VOXEL && activeTool) {


    if (!isMiniHUD) {
      // Build Up (Tapered) Toggle
      widgets.push({
        type: 'checkbox',
        id: 'voxel_buildup',
        label: 'Build Up (Tapered)',
        x: col1X, y: y, w: 550, h: btnH,
        value: (activeTool._buildUp === true),
        onInteract: () => {
          if (activeTool) {
            activeTool._buildUp = !activeTool._buildUp;
            getOptionsURL.saveOption(`tool_${activeToolIndex}_buildUp`, activeTool._buildUp);
            if (main._guiXR) main._guiXR._needsRedraw = true;
          }
        }
      });
      y += btnH + gapBtn;
    }

    // Brush Shape Buttons (Sphere, Cube)
    const shape = activeTool._shape || 0;
    const btnShapeW = (550 - 10) / 2;

    const setVoxelShape = (s) => {
      if (activeTool) {
        activeTool._shape = s;
        if (main._guiXR) {
          main._guiXR.refreshToolsWidget();
        }
      }
    };

    widgets.push({
      type: 'button', id: 'vx_shape_sphere', label: 'Sphere', x: col1X, y: y, w: btnShapeW, h: btnH,
      data: { active: (shape === 0) },
      onInteract: () => setVoxelShape(0)
    });

    widgets.push({
      type: 'button', id: 'vx_shape_cube', label: 'Cube', x: col1X + btnShapeW + 10, y: y, w: btnShapeW, h: btnH,
      data: { active: (shape === 1) },
      onInteract: () => setVoxelShape(1)
    });

    y += btnH + gapBtn;

    // Alignment Buttons (World, Local) - Only show for Cube
    if (shape === 1) {
      const alignToController = activeTool._alignToController || false;
      const setVoxelAlign = (align) => {
        if (activeTool) {
          activeTool._alignToController = align;
          if (main._guiXR) {
            main._guiXR.refreshToolsWidget();
          }
        }
      };

      widgets.push({
        type: 'button', id: 'vx_align_world', label: 'World', x: col1X, y: y, w: btnShapeW, h: btnH,
        data: { active: !alignToController },
        onInteract: () => setVoxelAlign(false)
      });

      widgets.push({
        type: 'button', id: 'vx_align_local', label: 'Local', x: col1X + btnShapeW + 10, y: y, w: btnShapeW, h: btnH,
        data: { active: alignToController },
        onInteract: () => setVoxelAlign(true)
      });

      y += btnH + gapBtn;
    }

    const voxelResolution = (activeTool && activeTool._res) ? activeTool._res : 64;
    widgets.push({
      type: 'slider',
      id: 'voxel_res',
      label: 'Resolution',
      x: col1X, y: y, w: 550, h: 40,
      value: (activeTool && activeTool._pendingRes) ? activeTool._pendingRes : voxelResolution,
      min: 16, max: 256, step: 16, precision: 0,
      onInput: (val) => {
        if (activeTool && activeTool.setResolutionPreview) {
          activeTool.setResolutionPreview(val);
        }
        const mesh = main.getMesh ? main.getMesh() : (main._sculptManager ? main._sculptManager.getMesh() : null); // Fallback if main.getMesh() isn't standard
        if (mesh) {
          VoxelDensityOverlay.enable(mesh, val); // Persistent enable while tracking
        }
        getOptionsURL.saveOption(`tool_${activeToolIndex}_resolution`, val, 500);
      },
      onRelease: () => {
        VoxelDensityOverlay.disable(); // Explicit drop
      }
    });

    y += 40 + gapBtn;

    // Resample Button
    widgets.push({
      type: 'button',
      id: 'voxel_resample',
      label: 'Resample (No Undo)',
      x: col1X, y: y, w: 550, h: 40,
      onInteract: () => {
        if (activeTool && activeTool.applyResolution) {
          activeTool.applyResolution();
        }
      }
    });
    y += 40 + gapBtn;

    widgets.push({
      type: 'checkbox',
      id: 'voxel_flat',
      label: 'Flat Shading',
      x: col1X, y: y, w: 550, h: btnH,
      value: main.getMesh() ? main.getMesh().getFlatShading() : false,
      onInteract: () => {
        const mesh = main.getMesh();
        if (mesh) {
          mesh.setFlatShading(!mesh.getFlatShading());
          main.render();
          if (main._guiXR) main._guiXR._needsRedraw = true;
          if (main._guiMini) main._guiMini._needsRedraw = true;
        }
      }
    });
    y += btnH + gapBtn;

    // Wireframe Toggle
    widgets.push({
      type: 'checkbox',
      id: 'voxel_wireframe',
      label: 'Show Wireframe',
      x: col1X, y: y, w: 550, h: btnH,
      value: main.getMesh() ? main.getMesh().getShowWireframe() : false,
      onInteract: () => {
        const mesh = main.getMesh();
        if (mesh) {
          mesh.setShowWireframe(!mesh.getShowWireframe());
          main.render();
          if (main._guiXR) main._guiXR._needsRedraw = true;
          if (main._guiMini) main._guiMini._needsRedraw = true;
        }
      }
    });
    y += btnH + gapBtn;

    // --- TRIGGER MODULATION ---
    widgets.push({ type: 'info', label: 'Trigger Modulation', x: col1X, y: y });
    y += gapHeader;

    // Toggle: Modulate Radius
    widgets.push({
      type: 'checkbox',
      id: 'mod_radius',
      label: 'Radius (Pressure)',
      x: col1X, y: y, w: 400, h: btnH,
      value: activeTool ? activeTool._modulateRadius : false,
      onInteract: () => {
        if (activeTool) {
          activeTool._modulateRadius = !activeTool._modulateRadius;
          getOptionsURL.saveOption(`tool_${activeToolIndex}_modulateRadius`, activeTool._modulateRadius);
          main.render();
          if (main._guiXR) main._guiXR._needsRedraw = true;
        }
      }
    });
    y += btnH + gapBtn;

    // Toggle: Modulate Intensity
    widgets.push({
      type: 'checkbox',
      id: 'mod_intensity',
      label: 'Intensity (Pressure)',
      x: col1X, y: y, w: 400, h: btnH,
      value: activeTool ? activeTool._modulateIntensity : true,
      onInteract: () => {
        if (activeTool) {
          activeTool._modulateIntensity = !activeTool._modulateIntensity;
          getOptionsURL.saveOption(`tool_${activeToolIndex}_modulateIntensity`, activeTool._modulateIntensity);
          main.render();
          if (main._guiXR) main._guiXR._needsRedraw = true;
        }
      }
    });
    y += btnH + gapBtn;

    // Min Radius Slider
    widgets.push({
      type: 'slider',
      id: 'min_radius_pct',
      label: 'Min Radius %',
      x: col1X, y: y, w: 550, h: 40,
      value: activeTool ? (activeTool._minRadiusPct !== undefined ? activeTool._minRadiusPct : 10) : 10,
      min: 1, max: 100, precision: 0,
      onInput: (val) => { 
        if (activeTool) { 
          activeTool._minRadiusPct = val; 
          getOptionsURL.saveOption(`tool_${activeToolIndex}_minRadiusPct`, val, 500);
        } 
      }
    });
    y += 40 + gapBtn;

    // Min Intensity Slider
    widgets.push({
      type: 'slider',
      id: 'min_intensity_pct',
      label: 'Min Intensity %',
      x: col1X, y: y, w: 550, h: 40,
      value: activeTool ? (activeTool._minIntensityPct !== undefined ? activeTool._minIntensityPct : 10) : 10,
      min: 0, max: 100, precision: 0,
      onInput: (val) => { 
        if (activeTool) { 
          activeTool._minIntensityPct = val; 
          getOptionsURL.saveOption(`tool_${activeToolIndex}_minIntensityPct`, val, 500);
        } 
      }
    });
    y += 40 + gapBtn;

    // Bias Slider
    widgets.push({
      type: 'slider',
      id: 'pressure_bias',
      label: 'Pressure Bias (Min <-> Max)',
      x: col1X, y: y, w: 550, h: 40,
      value: activeTool ? (activeTool._pressureBias !== undefined ? activeTool._pressureBias : 0) : 0,
      min: -0.95, max: 0.95, precision: 2, step: 0.05,
      onInput: (val) => { 
        if (activeTool) { 
          activeTool._pressureBias = val; 
          getOptionsURL.saveOption(`tool_${activeToolIndex}_pressureBias`, val, 500);
        } 
      }
    });
    y += 40 + gapSection;

    // Skip the standard "Common" stuff? 
    // Voxel tool supports Negative (handled below).
    // Does NOT use Clay/Accumulate/Thin Surface.
    // So we might want to "return widgets" here or continue?
    // "Negative" is useful.
    // "Clay", "Accumulate" are not.
    // "Alpha" is maybe useful (if we use it for sculpting shape? Voxel usually is sphere).
    // Let's continue but maybe we can conditionally hide Clay/Accumulate?
    // The user didn't ask to HIDE them, but "only when voxel tool is active" referred to the NEW controls.
    // Let's just continue to standard controls for now to avoid breaking parity expectations unless requested.
  }


  // Only show wireframe toggle if we aren't using voxels
  if (main.getSculptManager().getToolIndex() !== Enums.Tools.VOXEL) {
    widgets.push({
      type: 'checkbox',
      id: 'wireframe',
      label: 'Wireframe',
      x: col1X, y: y, w: 550, h: btnH,
      value: main.getMesh() ? main.getMesh().getShowWireframe() : false,
      onInteract: () => {
        const mesh = main.getMesh();
        if (mesh) {
          mesh.setShowWireframe(!mesh.getShowWireframe());
          main.render();
          if (main._guiXR) main._guiXR._needsRedraw = true;
          if (main._guiMini) main._guiMini._needsRedraw = true;
        }
      }
    });
    y += btnH + gapBtn;
  }

  // Brush Symmetry Toggle
  widgets.push({
    type: 'checkbox',
    id: 'symmetry',
    label: 'Symmetry',
    x: col1X, y: y, w: 550, h: btnH,
    value: main.getSculptManager()._symmetry,
    onInteract: () => {
      const mgr = main.getSculptManager();
      mgr._symmetry = !mgr._symmetry;
      main.render();
      if (main._guiXR) main._guiXR._needsRedraw = true;
      if (main._guiMini) main._guiMini._needsRedraw = true;
    }
  });
  y += btnH + gapBtn;

  widgets.push({
    type: 'checkbox',
    id: 'clay',
    label: 'Clay',
    x: col1X, y: y, w: 550, h: btnH,
    value: activeTool ? activeTool._clay : false,
    onInteract: () => {
      if (activeTool) {
        activeTool._clay = !activeTool._clay;
        getOptionsURL.saveOption(`tool_${activeToolIndex}_clay`, activeTool._clay);
        main.render();
        if (main._guiXR) main._guiXR._needsRedraw = true;
      }
    }
  });
  y += btnH + gapBtn;

  widgets.push({
    type: 'checkbox',
    id: 'accumulate',
    label: 'Accumulate (no limit per stroke)',
    x: col1X, y: y, w: 550, h: btnH,
    value: activeTool ? activeTool._accumulate : false,
    onInteract: () => {
      if (activeTool) {
        activeTool._accumulate = !activeTool._accumulate;
        getOptionsURL.saveOption(`tool_${activeToolIndex}_accumulate`, activeTool._accumulate);
        main.render();
        if (main._guiXR) main._guiXR._needsRedraw = true;
      }
    }
  });
  y += btnH + gapBtn;
  widgets.push({
    type: 'checkbox',
    id: 'thin_surface',
    label: 'Thin surface (front vertex only)',
    x: col1X, y: y, w: 550, h: btnH,
    value: activeTool ? activeTool._culling : false, // _culling is likely the prop name
    onInteract: () => {
      if (activeTool) {
        activeTool._culling = !activeTool._culling;
        getOptionsURL.saveOption(`tool_${activeToolIndex}_culling`, activeTool._culling);
        main.render();
        if (main._guiXR) main._guiXR._needsRedraw = true;
      }
    }
  });
  y += btnH + gapSection;

  // 3. Alpha
  widgets.push({ type: 'info', label: 'Alpha', x: col1X, y: y });
  y += gapHeader;

  // Lock Position
  widgets.push({
    type: 'checkbox',
    id: 'lock_position',
    label: 'Lock position',
    x: col1X, y: y, w: 550, h: btnH,
    value: activeTool ? activeTool._lockPosition : false,
    disabled: !activeTool,
    onInteract: () => {
      if (activeTool && activeTool._lockPosition !== undefined) {
        activeTool._lockPosition = !activeTool._lockPosition;
        if (main._guiXR) main._guiXR._needsRedraw = true;
      }
    }
  });
  y += btnH + gapBtn;

  // Alpha Texture Combobox
  // We need to map Alpha Names to IDs/Indices for the Combobox
  const alphaNames = Object.keys(Picking.ALPHAS_NAMES);
  const alphaOptions = alphaNames.map((name, i) => ({ label: name, id: i }));

  // Find current index
  let currentAlphaIndex = 0;
  if (activeTool && activeTool._idAlpha) {
    currentAlphaIndex = alphaNames.indexOf(activeTool._idAlpha);
    if (currentAlphaIndex === -1) currentAlphaIndex = 0;
  }

  widgets.push({
    type: 'combobox',
    id: 'alpha_tex',
    label: 'Texture',
    x: col1X, y: y, w: 550, h: btnH,
    options: alphaOptions,
    value: currentAlphaIndex,
    disabled: !activeTool,
    onSelect: (id) => {
      const idx = alphaOptions.findIndex(o => o.id === id);
      if (idx >= 0) {
        const name = alphaNames[idx];
        activeTool._idAlpha = name;
        getOptionsURL.saveOption(`tool_${activeToolIndex}_alpha`, name);
        main.render();
        if (main._guiXR) main._guiXR._needsRedraw = true;
      }
    }
  });
  y += btnH + gapBtn;

  widgets.push({
    type: 'button',
    id: 'alpha_import',
    label: 'Import alpha tex (jpg, png...)',
    x: col1X, y: y, w: 550, h: btnH,
    onInteract: () => {
      // Trigger Desktop File Picker
      const input = document.getElementById('alphaopen');
      if (input) {
        input.click();
      } else {
      }
    }
  });
  y += btnH + gapSection;


  // 4. Common
  const mgr = main.getSculptManager();
  const showSym = activeToolIndex !== Enums.Tools.TRANSFORM;
  const showContinuous = mgr.canBeContinuous();

  if (showSym || showContinuous) {
    widgets.push({ type: 'info', label: 'Common', x: col1X, y: y });
    y += gapHeader;

    if (activeToolIndex === Enums.Tools.EXTRUDE || (activeTool && activeTool.constructor.name === 'Extrude')) {
      const keepVal = !!window.keepExtrudeFacesTogether;
      widgets.push({
        type: 'button',
        id: 'extrude_keep_together',
        label: keepVal ? '[X] Merged Boundary Loops' : '[ ] Isolated Face Loops',
        x: col1X, y: y, w: 550, h: btnH,
        onInteract: () => {
          window.keepExtrudeFacesTogether = !keepVal;
          if (main._guiXR) {
            main._guiXR.refreshToolsWidget();
            main._guiXR._needsRedraw = true;
          }
          if (main._guiMini) {
            main._guiMini.refreshToolsWidget();
            main._guiMini._needsRedraw = true;
          }
        }
      });
      y += btnH + gapBtn;
    }

    if (showSym) {

      // Re-symmetrize Buttons
      const btnW_Sym = (300 - 10) / 2;
      widgets.push({
        type: 'button', id: 'sym_lr', label: 'Sym L->R', x: col1X, y: y, w: btnW_Sym, h: btnH,
        onInteract: () => {
          const mesh = main.getMesh();
          if (mesh) {
            // Undo Support
            if (typeof mesh.getSymmetryData === 'function') {
              const symData = mesh.getSymmetryData();
              if (symData) {
                const verts = symData.getSymmetryDestinations(0);
                if (verts.length > 0) {
                  main.getStateManager().pushStateGeometry(mesh);
                  main.getStateManager().pushVertices(verts);
                }
              }
            }
            if (typeof mesh.symmetrize === 'function') mesh.symmetrize(0);
            main.render();
          }
        }
      });
      widgets.push({
        type: 'button', id: 'sym_rl', label: 'Sym R->L', x: col1X + btnW_Sym + 10, y: y, w: btnW_Sym, h: btnH,
        onInteract: () => {
          const mesh = main.getMesh();
          if (mesh) {
            // Undo Support
            if (typeof mesh.getSymmetryData === 'function') {
              const symData = mesh.getSymmetryData();
              if (symData) {
                const verts = symData.getSymmetryDestinations(1);
                if (verts.length > 0) {
                  main.getStateManager().pushStateGeometry(mesh);
                  main.getStateManager().pushVertices(verts);
                }
              }
            }
            if (typeof mesh.symmetrize === 'function') mesh.symmetrize(1);
            main.render();
          }
        }
      });
      y += btnH + gapBtn;
    }

    if (showContinuous) {
      widgets.push({
        type: 'checkbox',
        id: 'continuous',
        label: 'Continuous',
        x: col1X, y: y, w: 300, h: btnH,
        value: mgr._continuous,
        onInteract: () => {
          mgr._continuous = !mgr._continuous;
          main.render();
          if (main._guiXR) main._guiXR._needsRedraw = true;
        }
      });
      y += btnH + gapSection;
    } else {
      // If we had a gap for the header but didn't add the continuous button (and symmetry was also hidden? no, if we are here at least one is shown),
      // Actually if showContinuous is false we just skip it.
      // If we are here, at least one of them is true.
      // If showSym was true, we added y += btnH + gapBtn.
      // We might want to ensure the final spacing is correct. 
      // If continuous is hidden, we might have added extra gapBtn after symmetry.
      // Let's just reset standard gap after the block.
    }

    // Ensure consistent spacing after the block if items were added
    // The last item added usually adds its own spacing. 
    // If symmetry was last, it added `gapBtn`. We might want `gapSection` for the next potential section.
    // If continuous was last, it added `gapSection`.
    // Let's just fix the gap of the last added item if needed, but for now simple checks are fine.
    // Actually, if Symmetry is the ONLY one shown, it currently adds `gapBtn` (15) instead of `gapSection` (30).
    // Not a huge deal, but we can fix it.

    // Correction for spacing:
    // If we finished on Symmetry (Continuous hidden), we want gapSection.
    if (showSym && !showContinuous) {
      // Fix last gap
      y -= gapBtn; // remove gapBtn
      y += gapSection; // add gapSection
    }
  }

  // --- GRAB TOOL (Puppeteer Animation) ---
  if (activeToolIndex === Enums.Tools.GRAB && activeTool) {
    widgets.push({ type: 'info', label: 'Puppeteer Animation', x: col1X, y: y });
    y += gapHeader;

    // Global States
    window._animArmed = window._animArmed || false;
    window._animCountIn = window._animCountIn !== undefined ? window._animCountIn : true;
    window._animPlaying = window._animPlaying || false;

    // Explicit 'Record' Button Flow
    widgets.push({
      type: 'button',
      id: 'anim_record',
      label: window._animStatusText || '🔴 Record Track',
      x: col1X, y: y, w: 350, h: btnH,
      data: { tint: '#ff4444' },
      onInteract: () => {
        console.log("[Puppeteer] Record Button Clicked!");
        
        if (!window._animationRegistry) {
          console.error("[Puppeteer] ERROR: AnimationRegistry missing!");
          return;
        }

        let targetMesh = (main._selectMeshes && main._selectMeshes.length > 0) ? main._selectMeshes[0] : main._mesh;
        if (!targetMesh && main.getMeshes && main.getMeshes().length > 0) {
          targetMesh = main.getMeshes()[0];
          console.log("[Puppeteer] Auto-locking onto first scene mesh.");
        }

        if (!targetMesh) {
          console.error("[Puppeteer] FAIL: Absolutely no meshes found in scene.");
          window._animStatusText = 'No Mesh Found!';
          setTimeout(() => { window._animStatusText = '🔴 Record Track'; if (main._guiXR) main._guiXR._needsRedraw = true; }, 1500);
          if (main._guiXR) main._guiXR._needsRedraw = true;
          return;
        }
        
        console.log(`[Puppeteer] Locked onto Mesh ID: ${targetMesh.getID()}`);
        window._animArmed = true;
        window._animationRegistry.startRecording(targetMesh);
      }
    });

    // Stop/Reset ALL Tracks
    widgets.push({
      type: 'button',
      id: 'anim_stop_all',
      label: '⏹ Reset All Tracks',
      x: col1X + 360, y: y, w: 350, h: btnH,
      data: { tint: '#aaaaaa' },
      onInteract: () => {
        if (window._animationRegistry) {
          window._animationRegistry.resetAll();
        }
      }
    });

    y += btnH + gapBtn;

    // Playback Toggle
    widgets.push({
      type: 'button',
      id: 'anim_play',
      label: window._animPlaying ? '⏸ Pause All' : '▶ Play All',
      x: col1X, y: y, w: 710, h: btnH,
      data: { tint: window._animPlaying ? '#ffaa00' : '#44ff44' },
      onInteract: () => {
        window._animPlaying = !window._animPlaying;
        if (main._guiXR) main._guiXR._needsRedraw = true;
      }
    });

    y += btnH + gapSection;
  }

  // --- VERSION UPDATE WARNING ---
  if (window._updateAvailable) {
    y += gapHeader;
    
    // Line 1: Main Warning
    widgets.push({
      type: 'button',
      id: 'update_warning_1',
      label: 'new build ready!',
      x: col1X, y: y, w: 710, h: 50,
      data: { tint: 'hsl(30, 90%, 50%)', fontSize: '18px' }, // Orange warning color, small font
      onInteract: () => window.location.reload(true)
    });
    
    y += 50 + 5; // Small gap between lines
    
    const currentVersion = Object.values({VERSION})[0];
    const newVersion = window._availableVersion || '???';
    
    // Line 2: Version Details
    widgets.push({
      type: 'button',
      id: 'update_warning_2',
      label: `${currentVersion} -> ${newVersion}`,
      x: col1X, y: y, w: 710, h: 50,
      data: { tint: 'hsl(30, 90%, 50%)', fontSize: '18px' }, // Orange warning color, small font
      onInteract: () => window.location.reload(true)
    });
    
    y += 50 + gapSection;
  }

  return widgets;
}
