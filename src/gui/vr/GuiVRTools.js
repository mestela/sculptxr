import Enums from 'misc/Enums';

export default function getToolsWidgets(main) {
  return [
    // --- SECTION: SCULPTING ---
    // Sliders (Top Row)
    { type: 'slider', id: 'radius', x: 20, y: 120, w: 300, h: 40, label: 'Radius', value: 0.20 },
    { type: 'slider', id: 'intensity', x: 340, y: 120, w: 300, h: 40, label: 'Intensity', value: 0.5 },

    // Core Tools (Grid 2x4 for main, + others)
    // Row 1 (y=190)
    { type: 'button', id: Enums.Tools.BRUSH, label: 'Brush', x: 20, y: 190, w: 200, h: 60 },
    { type: 'button', id: Enums.Tools.INFLATE, label: 'Inflate', x: 240, y: 190, w: 200, h: 60 },
    { type: 'button', id: Enums.Tools.SMOOTH, label: 'Smooth', x: 460, y: 190, w: 200, h: 60 },
    { type: 'button', id: Enums.Tools.FLATTEN, label: 'Flatten', x: 680, y: 190, w: 200, h: 60 },

    // Row 2 (y=270)
    { type: 'button', id: Enums.Tools.PINCH, label: 'Pinch', x: 20, y: 270, w: 200, h: 60 },
    { type: 'button', id: Enums.Tools.CREASE, label: 'Crease', x: 240, y: 270, w: 200, h: 60 },
    { type: 'button', id: Enums.Tools.DRAG, label: 'Drag', x: 460, y: 270, w: 200, h: 60 },
    { type: 'button', id: Enums.Tools.MOVE, label: 'Move', x: 680, y: 270, w: 200, h: 60 },

    // Row 3 (y=350)
    { type: 'button', id: Enums.Tools.PAINT, label: 'Paint', x: 20, y: 350, w: 200, h: 60 },
    { type: 'button', id: Enums.Tools.TRANSFORM, label: 'Transform', x: 240, y: 350, w: 200, h: 60 },
    { type: 'button', id: Enums.Tools.MASKING, label: 'Mask', x: 460, y: 350, w: 200, h: 60 },
    { type: 'button', id: Enums.Tools.LOCALSCALE, label: 'L.Scale', x: 680, y: 350, w: 200, h: 60 },

    // --- SECTION: VOXEL ---
    { type: 'info', label: '--- VOXEL REMESHING ---', x: 20, y: 450 },

    // Voxel Sliders
    { type: 'slider', id: 'voxelRes', x: 20, y: 480, w: 300, h: 40, label: 'Resolution', value: 0.5 }, // 32..256
    { type: 'slider', id: 'voxelRad', x: 340, y: 480, w: 300, h: 40, label: 'Radius Mult', value: 0.5 }, // 1..100

    { type: 'button', id: Enums.Tools.VOXEL, label: 'VOXEL TOOL', x: 20, y: 540, w: 200, h: 60 },
    { type: 'button', id: 'bake', label: 'BAKE TO MESH', x: 240, y: 540, w: 300, h: 60 },

    // --- SECTION: TOPOLOGY ---
    { type: 'info', label: '--- TOPOLOGY ---', x: 20, y: 640 },
    { type: 'toggle', id: 'dynamic', label: 'Dynamic Topology', x: 20, y: 670, w: 300, h: 60 }
  ];
}
