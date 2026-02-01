import Enums from 'misc/Enums';

export default function getTopologyWidgets(main) {
  const widgets = [];

  // Match GuiTopology.js:
  // 1. Multiresolution (Slider, Reverse, Subdivide, Del Lower/Higher)
  // 2. Remesh (Res, Block, Remesh Button) + MC (Res, Smooth, Remesh Button)
  // 3. Dynamic (Toggle, Subd, Dec, Linear)

  // Spacing Constants
  const col1X = 20;
  const btnH = 50; // Dense
  const gapBtn = 15;
  const gapSection = 30;
  const gapHeader = 30;

  let y = 130;

  // --- MULTIRESOLUTION ---
  widgets.push({ type: 'info', label: 'Multiresolution', x: col1X, y: y });
  y += gapHeader;

  widgets.push({ type: 'button', id: 'subdivide', label: 'Subdivide', x: col1X, y: y, w: 150, h: btnH });
  widgets.push({ type: 'button', id: 'reverse', label: 'Reverse', x: 180, y: y, w: 150, h: btnH });
  y += btnH + gapBtn;

  widgets.push({ type: 'button', id: 'del_lower', label: 'Del Lower', x: col1X, y: y, w: 150, h: btnH, disabled: true });
  widgets.push({ type: 'button', id: 'del_higher', label: 'Del Higher', x: 180, y: y, w: 150, h: btnH, disabled: true });
  y += btnH + gapSection;


  // --- REMESH ---
  widgets.push({ type: 'info', label: 'Remesh', x: col1X, y: y });
  y += gapHeader;

  widgets.push({ type: 'slider', id: 'voxelRes', label: 'Resolution', x: col1X, y: y, w: 350, h: 40, value: 0.5 });
  y += 40 + gapBtn;

  widgets.push({ type: 'button', id: 'remesh', label: 'Remesh', x: col1X, y: y, w: 350, h: btnH });
  y += btnH + gapSection;


  // --- DYNAMIC TOPOLOGY ---
  widgets.push({ type: 'info', label: 'Dynamic Topology', x: col1X, y: y });
  y += gapHeader;

  widgets.push({ type: 'checkbox', id: 'dynamic', label: 'Activated', x: col1X, y: y, w: 350, h: btnH });
  y += btnH + gapBtn;

  widgets.push({ type: 'slider', id: 'dyn_subd', label: 'Subdivision', x: col1X, y: y, w: 350, h: 40, value: 50, disabled: true });
  widgets.push({ type: 'slider', id: 'dyn_dec', label: 'Decimation', x: col1X, y: y + 50, w: 350, h: 40, value: 50, disabled: true });
  y += 100 + gapBtn;

  widgets.push({ type: 'checkbox', id: 'dyn_linear', label: 'Linear', x: col1X, y: y, w: 350, h: btnH, disabled: true });
  y += btnH + gapSection;

  return widgets;
}
