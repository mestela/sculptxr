import TR from 'gui/GuiTR';
import Remesh from 'editing/Remesh';
import MeshDynamic from 'mesh/dynamic/MeshDynamic';

export default function getTopologyWidgets(main) {
  const mesh = main.getMesh();
  const isDynamic = mesh && mesh.isDynamic;

  const widgets = [];

  // --- MULTIRES ---
  widgets.push({ type: 'info', label: '--- MULTIRES ---', x: 20, y: 130 });
  
  // Resolution Slider
  // We need to know current resolution level if multires
  // For visual simplicity, we might just show +/- buttons or use the slider if we can read state.
  // GuiXR updates 30Hz, so we can read mesh._sel if it's a multimesh.
  let multiResLevel = 1;
  let multiResMax = 1;
  if (mesh && mesh._meshes) {
    multiResLevel = mesh._sel + 1;
    multiResMax = mesh._meshes.length;
  }
  widgets.push({ type: 'slider', id: 'multiresLevel', label: 'Level', x: 20, y: 170, w: 300, h: 40, value: multiResLevel / Math.max(1, multiResMax), min: 1, max: multiResMax });
  
  const dualY = 220;
  widgets.push({ type: 'button', id: 'subdivide', label: 'Subdivide', x: 340, y: dualY, w: 200, h: 60 });
  widgets.push({ type: 'button', id: 'reverse', label: 'Reverse', x: 560, y: dualY, w: 200, h: 60 });

  widgets.push({ type: 'button', id: 'delLower', label: 'Del Lower', x: 340, y: dualY + 80, w: 200, h: 60 });
  widgets.push({ type: 'button', id: 'delHigher', label: 'Del Higher', x: 560, y: dualY + 80, w: 200, h: 60 });


  // --- DYNAMIC TOPOLOGY ---
  widgets.push({ type: 'info', label: '--- DYNAMIC TOPOLOGY ---', x: 20, y: 400 });
  widgets.push({ type: 'toggle', id: 'dynamic', label: 'Enable Dynamic', x: 20, y: 440, w: 300, h: 60 });
  widgets.push({ type: 'toggle', id: 'linear', label: 'Linear', x: 340, y: 440, w: 200, h: 60, disabled: true }); // Mockup

  if (isDynamic) {
    widgets.push({ type: 'slider', id: 'dynamicSubd', label: 'Subdivision', x: 20, y: 520, w: 300, h: 40, value: MeshDynamic.SUBDIVISION_FACTOR / 100 });
    widgets.push({ type: 'slider', id: 'dynamicDec', label: 'Decimation', x: 340, y: 520, w: 300, h: 40, value: MeshDynamic.DECIMATION_FACTOR / 100 });
  }

  // --- REMESH ---
  widgets.push({ type: 'info', label: '--- REMESH ---', x: 20, y: 600 });
  widgets.push({ type: 'slider', id: 'remeshRes', label: 'Resolution', x: 20, y: 640, w: 300, h: 40, value: Remesh.RESOLUTION / 400 });
  widgets.push({ type: 'toggle', id: 'remeshBlock', label: 'Block', x: 340, y: 640, w: 200, h: 60, disabled: true }); // Mockup
  widgets.push({ type: 'button', id: 'remesh', label: 'Remesh (Surf)', x: 560, y: 640, w: 200, h: 60 });

  const mcY = 720;
  widgets.push({ type: 'button', id: 'remeshMC', label: 'Remesh (MC)', x: 560, y: mcY, w: 200, h: 60 });
  widgets.push({ type: 'toggle', id: 'remeshSmooth', label: 'Smooth MC', x: 340, y: mcY, w: 200, h: 60, disabled: true }); // Mockup

  return widgets;
}
