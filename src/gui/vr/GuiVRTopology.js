import Enums from 'misc/Enums';

export default function getTopologyWidgets(main) {
  const widgets = [];

  // Match GuiTopology.js:
  // 1. Multiresolution (Slider, Reverse, Subdivide, Del Lower/Higher)
  // 2. Remesh (Res, Block, Remesh Button) + MC (Res, Smooth, Remesh Button)
  // 3. Dynamic (Toggle, Subd, Dec, Linear)

  // Spacing Constants
  const col1X = 20;
  const btnH = 60;
  const gapBtn = 20;
  const gapSection = 40;
  const gapHeader = 40;

  let y = 130;

  // --- MULTIRESOLUTION ---
  widgets.push({ type: 'info', label: 'MULTIRESOLUTION', x: col1X, y: y });
  y += gapHeader;

  widgets.push({ type: 'slider', id: 'multires_level', label: 'Level', x: col1X, y: y, w: 300, h: 40, value: 0, disabled: true }); // Needs wiring
  y += 40 + gapBtn; // Slider height + gap

  widgets.push({ type: 'button', id: 'subdivide', label: 'Subdivide', x: col1X, y: y, w: 200, h: btnH });
  widgets.push({ type: 'button', id: 'reverse', label: 'Reverse', x: 230, y: y, w: 200, h: btnH });
  y += btnH + gapBtn;

  widgets.push({ type: 'button', id: 'del_lower', label: 'Del Lower', x: col1X, y: y, w: 200, h: btnH, disabled: true });
  widgets.push({ type: 'button', id: 'del_higher', label: 'Del Higher', x: 230, y: y, w: 200, h: btnH, disabled: true });
  y += btnH + gapSection;


  // --- REMESH ---
  widgets.push({ type: 'info', label: 'REMESH', x: col1X, y: y });
  y += gapHeader;

  widgets.push({ type: 'slider', id: 'voxelRes', label: 'Resolution', x: col1X, y: y, w: 400, h: 40, value: 0.5 });
  y += 40 + gapBtn;

  widgets.push({ type: 'checkbox', id: 'remesh_block', label: 'Blocky', x: col1X, y: y, w: 200, h: btnH, disabled: true });
  widgets.push({ type: 'button', id: 'remesh', label: 'Remesh (Surface)', x: 230, y: y, w: 250, h: btnH });
  y += btnH + gapSection;


  // --- DYNAMIC ---
  widgets.push({ type: 'info', label: 'DYNAMIC TOPOLOGY', x: col1X, y: y });
  y += gapHeader;

  widgets.push({ type: 'checkbox', id: 'dynamic', label: 'Activated', x: col1X, y: y, w: 300, h: btnH });
  y += btnH + gapBtn;

  widgets.push({ type: 'slider', id: 'dyn_subd', label: 'Subdivision', x: col1X, y: y, w: 300, h: 40, value: 0.5, disabled: true });
  widgets.push({ type: 'slider', id: 'dyn_dec', label: 'Decimation', x: 350, y: y, w: 300, h: 40, value: 0.5, disabled: true });
  y += 40 + gapBtn;

  widgets.push({ type: 'checkbox', id: 'dyn_linear', label: 'Linear', x: col1X, y: y, w: 200, h: btnH, disabled: true });

  return widgets;
}
