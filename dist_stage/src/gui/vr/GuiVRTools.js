import Enums from '../../misc/Enums.js';
import TR from '../GuiTR.js';
import Tools from '../../editing/tools/Tools.js';
import Picking from '../../math3d/Picking.js';
import { vec3 } from 'gl-matrix';

export default function getToolsWidgets(main, activeToolIndex) {
  if (activeToolIndex === undefined) activeToolIndex = main.getSculptManager().getToolIndex();
  const widgets = [];

  // Spacing Constants
  const col1X = 20;
  const btnH = 50; // Dense
  const gapBtn = 15;
  const gapSection = 30;
  const gapHeader = 30;

  let y = 130;

  // 1. Tool Selection (Combobox)
  // Removing "Tool" italic header to match desktop 1:1 more closely or just saving space
  widgets.push({ type: 'info', label: 'Tool', x: col1X, y: y }); 
  y += gapHeader;

  // Build Options from Tools array
  // Filter out Drag tool (Index 6) and LocalScale if confusing? LocalScale is Index 10?
  // Let's just filter by name or ID if possible, or just skip it.
  // Tools array has objects with `uiName`.
  // Tools array has objects with `uiName`.
  const toolOptions = Tools.map((t, i) => {
    if (!t) return null;
    return { label: TR(t.uiName), id: i };
  })
    .filter(t => t && t.label !== 'Drag'); // Hide Drag

  widgets.push({
    type: 'combobox',
    id: 'tool_select',
    label: 'Tool',
    x: col1X, y: y, w: 320, h: btnH,
    value: activeToolIndex,
    options: toolOptions,
    onSelect: (id) => {
      main.getSculptManager().setToolIndex(id);
      if (main.guiXR) main.guiXR.refreshToolsWidget();
    }
  });

  y += btnH + gapSection;


  // 2. Brush Settings
  const activeTool = main.getSculptManager().getTool(activeToolIndex);

  // Radius
  widgets.push({
    type: 'slider',
    id: 'radius',
    label: 'Radius',
    x: col1X, y: y, w: 350, h: 50,
    value: activeTool ? activeTool._radius : 50,
    min: 5, max: 250, precision: 0,
    onInput: (val) => { if (activeTool) { activeTool._radius = val; main.render(); } }
  });

  // Intensity
  widgets.push({
    type: 'slider',
    id: 'intensity',
    label: 'Intensity',
    x: 400, y: y, w: 350, h: 50,
    value: activeTool ? activeTool._intensity : 0.5,
    min: 0, max: 1, precision: 2,
    onInput: (val) => { if (activeTool) { activeTool._intensity = val; main.render(); } }
  });
  y += 50 + gapSection;

  // 2b. Tool Specific Settings
  // --- PAINT ---
  if (activeToolIndex === Enums.Tools.PAINT && activeTool) {
    widgets.push({ type: 'info', label: 'Paint Settings', x: col1X, y: y });
    y += gapHeader;

    // Color (RGB Sliders)
    // Color Picker (Replacing RGB Sliders)
    const color = activeTool._color;
    widgets.push({
      type: 'colorpicker_embedded',
      id: 'picker',
      label: 'Color',
      x: col1X, y: y, w: 350, h: 350, // Square-ish
      // value: color, // Passed via tool ref actually
    });
    // Height of picker (350) + gap
    y += 350 + gapSection;

    // Material (Roughness, Metallic)
    widgets.push({
      type: 'slider', id: 'roughness', label: 'Roughness', x: col1X, y: y, w: 350, h: 50,
      value: activeTool._material[0], min: 0, max: 1, step: 0.01, precision: 2,
      onInput: (val) => { activeTool._material[0] = val; main.render(); }
    });
    y += 55;
    widgets.push({
      type: 'slider', id: 'metallic', label: 'Metallic', x: col1X, y: y, w: 350, h: 50,
      value: activeTool._material[1], min: 0, max: 1, step: 0.01, precision: 2,
      onInput: (val) => { activeTool._material[1] = val; main.render(); }
    });
    y += 55 + gapBtn;

    // Paint All Button
    widgets.push({
      type: 'button', id: 'paint_all', label: 'Paint All', x: col1X, y: y, w: 350, h: btnH,
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
      onInteract: () => { activeTool._topoCheck = !activeTool._topoCheck; }
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
    const refresh = () => { if (main.guiXR) main.guiXR.refreshToolsWidget(); };

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
    widgets.push({ type: 'info', label: 'Voxel Settings', x: col1X, y: y });
    y += gapHeader;

    // Radius already handled above? Yes.

    // Resolution Slider (32-256)
    // We need to get current resolution. SculptVoxel has `_res`
    // Voxel settings
    const voxelResolution = activeTool._res || 64;

    // Mode Buttons (Add, Sub, Inflate, Deflate)
    const btnW = (550 - (3 * 10)) / 4; // 550 total width, 3 gaps
    const mode = activeTool._mode || 0; // 0=Add, 1=Sub, 2=Inflate, 3=Deflate (implied by Inflate + Negative?)
    const isNeg = activeTool._negative; // Current negative state

    // DEBUG: Log current state construction
    // console.log(`GuiVRTools Build: Mode=${mode} Neg=${isNeg}`);

    // Helper to set mode
    const setVoxelMode = (m, neg) => {
      if (activeTool) {
        activeTool._mode = m;
        activeTool._negative = neg;
        // Force re-render of UI to show active state
        if (main.guiXR) {
          main.guiXR.refreshToolsWidget();
        }
      }
    };

    // ACTIVE STATE?
    // We can highlight the active button.
    // GuiVR currently doesn't support "toggle" buttons natively in 'button' type, 
    // but we can simulate it or just use them as triggers.
    // User wants "options", implies selection.

    // Add
    widgets.push({
      type: 'button', id: 'vx_add', label: 'Add', x: col1X, y: y, w: btnW, h: btnH,
      data: { active: (mode === 0 && !isNeg) },
      onInteract: () => setVoxelMode(0, false)
    });

    // Sub
    widgets.push({
      type: 'button', id: 'vx_sub', label: 'Sub', x: col1X + btnW + 10, y: y, w: btnW, h: btnH,
      data: { active: (mode === 1 || (mode === 0 && isNeg)) }, // Support both explicit Sub mode and Negative Add
      onInteract: () => setVoxelMode(1, false)
    });

    // Inflate
    widgets.push({
      type: 'button', id: 'vx_inf', label: 'Inflate', x: col1X + 2 * (btnW + 10), y: y, w: btnW, h: btnH,
      data: { active: (mode === 2 && !isNeg) },
      onInteract: () => setVoxelMode(2, false)
    });

    // Deflate
    widgets.push({
      type: 'button', id: 'vx_def', label: 'Deflate', x: col1X + 3 * (btnW + 10), y: y, w: btnW, h: btnH,
      data: { active: (mode === 2 && isNeg) },
      onInteract: () => setVoxelMode(2, true)
    });

    y += btnH + gapBtn;

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
          if (main.guiXR) main.guiXR._needsRedraw = true;
        }
      }
    });
    y += 40 + gapBtn;

    // Wireframe Toggle
    widgets.push({
      type: 'checkbox',
      id: 'voxel_wireframe',
      label: 'Show Wireframe',
      x: col1X, y: y, w: 550, h: btnH,
      value: (activeTool._voxelMesh && activeTool._voxelMesh.getShaderType() === Enums.Shader.WIREFRAME),
      onInteract: () => {
        if (activeTool && activeTool.toggleVoxelWireframe) {
          activeTool.toggleVoxelWireframe();
          if (main.guiXR) main.guiXR._needsRedraw = true;
        }
      }
    });
    y += btnH + gapBtn;

    // Smooth Shading Toggle
    /*
    widgets.push({
      type: 'checkbox',
      id: 'voxel_smooth',
      label: 'Smooth Shading',
      x: col1X, y: y, w: 550, h: btnH,
      value: (activeTool._smooth === true),
      onInteract: () => {
        if (activeTool && activeTool.toggleSmooth) {
          activeTool.toggleSmooth();
          if (main.guiXR) main.guiXR._needsRedraw = true;
        }
      }
    });
    y += btnH + gapBtn;
    */

    // Bake Button
    widgets.push({
      type: 'button',
      id: 'voxel_bake',
      label: 'Bake to Mesh',
      x: col1X, y: y, w: 550, h: btnH,
      onInteract: () => {
        if (activeTool && activeTool.bakeToMesh) {
          activeTool.bakeToMesh();
          // if (window.screenLog) window.screenLog('Voxel Baked to Mesh', 'lime');
        }
      }
    });
    y += btnH + gapSection;

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
          main.render();
          if (main.guiXR) main.guiXR._needsRedraw = true;
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
          main.render();
          if (main.guiXR) main.guiXR._needsRedraw = true;
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
      onInput: (val) => { if (activeTool) { activeTool._minRadiusPct = val; } }
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
      onInput: (val) => { if (activeTool) { activeTool._minIntensityPct = val; } }
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
      onInput: (val) => { if (activeTool) { activeTool._pressureBias = val; } }
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


  // Negative, Clay, Accumulate, Thin surface
  widgets.push({
    type: 'checkbox',
    id: 'negative',
    label: 'Negative (N or -Alt)',
    x: col1X, y: y, w: 550, h: btnH,
    value: activeTool ? activeTool._negative : false,
    onInteract: () => {
      if (activeTool) {
        // if (window.screenLog) window.screenLog('Toggling Negative', 'yellow');
        activeTool._negative = !activeTool._negative;
        main.render();
        if (main.guiXR) main.guiXR._needsRedraw = true;
      } else {
        // if (window.screenLog) window.screenLog('Error: No Active Tool', 'red');
      }
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
        // if (window.screenLog) window.screenLog('Toggling Clay', 'yellow');
        activeTool._clay = !activeTool._clay;
        main.render();
        if (main.guiXR) main.guiXR._needsRedraw = true;
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
        // if (window.screenLog) window.screenLog('Toggling Accumulate', 'yellow');
        activeTool._accumulate = !activeTool._accumulate;
        main.render();
        if (main.guiXR) main.guiXR._needsRedraw = true;
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
        main.render();
        if (main.guiXR) main.guiXR._needsRedraw = true;
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
        // if (window.screenLog) window.screenLog(`Lock Position: ${activeTool._lockPosition}`, 'yellow');
        if (main.guiXR) main.guiXR._needsRedraw = true;
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
    onSelect: (idx) => {
      if (activeTool) {
        const name = alphaNames[idx];
        activeTool._idAlpha = name;
        // if (window.screenLog) window.screenLog(`Alpha Set: ${name}`, 'lime');
        // Picking.setIdAlpha() is usually called by the tool on stroke, but we update the tool prop here.
        if (main.guiXR) main.guiXR._needsRedraw = true;
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
        // if (window.screenLog) window.screenLog('Desktop File Picker Opened', 'yellow');
      } else {
        // if (window.screenLog) window.screenLog('Error: #alphaopen not found', 'red');
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

    if (showSym) {
      widgets.push({
        type: 'checkbox',
        id: 'symmetry',
        label: 'Symmetry',
        x: col1X, y: y, w: 300, h: btnH,
        value: mgr._symmetry,
        onInteract: () => {
          mgr._symmetry = !mgr._symmetry;
          // if (window.screenLog) window.screenLog(`Symmetry: ${mgr._symmetry}`, 'lime');
          main.render();
          if (main.guiXR) main.guiXR._needsRedraw = true;
        }
      });
      y += btnH + gapBtn;

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
          // if (window.screenLog) window.screenLog(`Continuous: ${mgr._continuous}`, 'lime');
          main.render();
          if (main.guiXR) main.guiXR._needsRedraw = true;
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

  // --- GRAB TOOL ---
  if (activeToolIndex === Enums.Tools.GRAB && activeTool) {
    widgets.push({ type: 'info', label: 'Grab Settings', x: col1X, y: y });
    y += gapHeader;
    // No specific settings yet? 
    // Maybe "Uniform Scale" toggle for 2-handed?
    // For now just placeholder or nothing.
  }

  return widgets;
}
