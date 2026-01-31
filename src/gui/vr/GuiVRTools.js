import Enums from 'misc/Enums';
import TR from 'gui/GuiTR';

export default function getToolsWidgets(main, activeToolIndex) {
  const widgets = [];

  // 1. Common Sliders (Top Row) - Always visible
  widgets.push({ type: 'slider', id: 'radius', x: 20, y: 120, w: 300, h: 40, label: 'Radius', value: 0.20 });
  widgets.push({ type: 'slider', id: 'intensity', x: 340, y: 120, w: 300, h: 40, label: 'Intensity', value: 0.5 });

  // 2. Tool Grid (Collapsed if Paint is active? No, keep grid for switching)
  // Actually, if we have many paint widgets, we might need space.
  // For now, let's put the grid at y=190.
  const toolsY = 190;
  widgets.push(
    { type: 'button', id: Enums.Tools.BRUSH, label: 'Brush', x: 20, y: toolsY, w: 200, h: 60 },
    { type: 'button', id: Enums.Tools.INFLATE, label: 'Inflate', x: 240, y: toolsY, w: 200, h: 60 },
    { type: 'button', id: Enums.Tools.SMOOTH, label: 'Smooth', x: 460, y: toolsY, w: 200, h: 60 },
    { type: 'button', id: Enums.Tools.FLATTEN, label: 'Flatten', x: 680, y: toolsY, w: 200, h: 60 },

    { type: 'button', id: Enums.Tools.PINCH, label: 'Pinch', x: 20, y: toolsY + 80, w: 200, h: 60 },
    { type: 'button', id: Enums.Tools.CREASE, label: 'Crease', x: 240, y: toolsY + 80, w: 200, h: 60 },
    { type: 'button', id: Enums.Tools.DRAG, label: 'Drag', x: 460, y: toolsY + 80, w: 200, h: 60 },
    { type: 'button', id: Enums.Tools.MOVE, label: 'Move', x: 680, y: toolsY + 80, w: 200, h: 60 },

    { type: 'button', id: Enums.Tools.PAINT, label: 'Paint', x: 20, y: toolsY + 160, w: 200, h: 60 },
    { type: 'button', id: Enums.Tools.TRANSFORM, label: 'Transform', x: 240, y: toolsY + 160, w: 200, h: 60 },
    { type: 'button', id: Enums.Tools.MASKING, label: 'Mask', x: 460, y: toolsY + 160, w: 200, h: 60 },
    { type: 'button', id: Enums.Tools.LOCALSCALE, label: 'L.Scale', x: 680, y: toolsY + 160, w: 200, h: 60 }
  );

  // 3. Dynamic Tool Settings
  const contextY = toolsY + 240; // 190 + 160 + 80 = 430

  // --- ALPHA SETTINGS (Common to most tools) ---
  // Mockup for now
  // widgets.push({ type: 'info', label: 'ALPHA', x: 620, y: 120 }); // Crammed in top right?
  // Let's put Alpha just above context settings or inline

  if (activeToolIndex === Enums.Tools.PAINT) {
    // --- PAINT TOOL SETTINGS ---
    widgets.push({ type: 'info', label: '--- PAINT SETTINGS ---', x: 20, y: contextY });

    // Row 1: Roughness & Metallic
    widgets.push({ type: 'slider', id: 'roughness', label: 'Roughness', x: 20, y: contextY + 40, w: 300, h: 40, value: 0.5 });
    widgets.push({ type: 'slider', id: 'metallic', label: 'Metallic', x: 340, y: contextY + 40, w: 300, h: 40, value: 0 });

    // Row 2: Actions & Channels
    const row2Y = contextY + 100;
    widgets.push({ type: 'button', id: 'paint_all', label: 'Paint All', x: 20, y: row2Y, w: 200, h: 60 });

    // Channels
    widgets.push({ type: 'info', label: 'Channels:', x: 240, y: row2Y + 20 });
    widgets.push({ type: 'toggle', id: 'write_albedo', label: 'Albedo', x: 360, y: row2Y, w: 100, h: 60 });
    widgets.push({ type: 'toggle', id: 'write_roughness', label: 'Rough', x: 470, y: row2Y, w: 100, h: 60 });
    widgets.push({ type: 'toggle', id: 'write_metalness', label: 'Metal', x: 580, y: row2Y, w: 100, h: 60 });

    // Row 3: Embedded Color Picker
    const pickerH = 300;
    widgets.push({ type: 'colorpicker_embedded', id: 'picker', x: 20, y: row2Y + 80, w: 400, h: pickerH });

  } else if (activeToolIndex === Enums.Tools.MASKING) {
    widgets.push({ type: 'info', label: '--- MASKING ---', x: 20, y: contextY });

    const row1Y = contextY + 40;
    widgets.push({ type: 'button', id: 'mask_clear', label: 'Clear', x: 20, y: row1Y, w: 160, h: 60, disabled: true });
    widgets.push({ type: 'button', id: 'mask_invert', label: 'Invert', x: 200, y: row1Y, w: 160, h: 60, disabled: true });
    widgets.push({ type: 'button', id: 'mask_blur', label: 'Blur', x: 380, y: row1Y, w: 160, h: 60, disabled: true });
    widgets.push({ type: 'button', id: 'mask_sharpen', label: 'Sharpen', x: 560, y: row1Y, w: 160, h: 60, disabled: true });

    const row2Y = contextY + 120;
    widgets.push({ type: 'button', id: 'mask_extract', label: 'Extract (Mockup)', x: 20, y: row2Y, w: 300, h: 60, disabled: true });
    widgets.push({ type: 'slider', id: 'extract_thick', label: 'Thickness', x: 340, y: row2Y, w: 300, h: 40, value: 0.1, disabled: true });

  } else {
    // --- DEFAULT / VOXEL SETTINGS ---
    widgets.push({ type: 'info', label: '--- VOXEL REMESHING ---', x: 20, y: contextY });
    widgets.push({ type: 'slider', id: 'voxelRes', x: 20, y: contextY + 40, w: 300, h: 40, label: 'Resolution', value: 0.5 });
    widgets.push({ type: 'slider', id: 'voxelRad', x: 340, y: contextY + 40, w: 300, h: 40, label: 'Radius Mult', value: 0.5 });
    widgets.push({ type: 'button', id: Enums.Tools.VOXEL, label: 'VOXEL TOOL', x: 20, y: contextY + 100, w: 200, h: 60 });
    widgets.push({ type: 'button', id: 'bake', label: 'BAKE TO MESH', x: 240, y: contextY + 100, w: 300, h: 60 });
  }

  // Common Tool Options (Alpha, etc.) - Mockups
  // Ideally positioned in free space or context dependent
  if (activeToolIndex !== Enums.Tools.PAINT) {
    const alphaY = contextY + 180;
    widgets.push({ type: 'info', label: 'ALPHA (MOCKUP)', x: 600, y: contextY });
    widgets.push({ type: 'combobox', id: 'alpha_select', label: 'Alpha', x: 600, y: contextY + 40, w: 300, h: 60, disabled: true });
    widgets.push({ type: 'button', id: 'alpha_import', label: 'Import', x: 600, y: contextY + 110, w: 140, h: 60, disabled: true });
    widgets.push({ type: 'toggle', id: 'alpha_lock', label: 'Lock Pos', x: 760, y: contextY + 110, w: 140, h: 60, disabled: true });
  }

  if (activeToolIndex === Enums.Tools.BRUSH) {
    // Add Clay/Accumulate
    const brushY = contextY + 280;
    widgets.push({ type: 'toggle', id: 'clay', label: 'Clay', x: 20, y: brushY, w: 140, h: 60, disabled: true });
    widgets.push({ type: 'toggle', id: 'accumulate', label: 'Accumulate', x: 180, y: brushY, w: 140, h: 60, disabled: true });
  }

  // Topology (Bottom) - Dynamic Y
  // If Paint: contextY + 100 (Row2) + 80 (Spacing) + 300 (Picker) + 40 (Padding)
  let topoY = 700;
  if (activeToolIndex === Enums.Tools.PAINT) {
    const row2Y = contextY + 100;
    topoY = row2Y + 80 + 300 + 40;
  } else {
    topoY = contextY + 220;
  }

  widgets.push({ type: 'info', label: '--- TOPOLOGY ---', x: 20, y: topoY });
  widgets.push({ type: 'toggle', id: 'dynamic', label: 'Dynamic Topology', x: 20, y: topoY + 40, w: 300, h: 60 });

  return widgets;
}
