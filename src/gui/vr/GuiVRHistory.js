export default function getHistoryWidgets(main) {
  return [
    { type: 'info', label: '--- HISTORY ---', x: 20, y: 130 },

    { type: 'button', id: 'undo', label: 'Undo', x: 20, y: 170, w: 240, h: 100 },
    { type: 'button', id: 'redo', label: 'Redo', x: 280, y: 170, w: 240, h: 100 },

    { type: 'slider', id: 'stack_size', label: 'Stack Size', x: 540, y: 200, w: 300, h: 40, value: 0.5, disabled: true }, // Mockup

    { type: 'info', label: '--- SUBDIVISION ---', x: 20, y: 320 },
    { type: 'button', id: 'max_resolution', label: 'Subdivide', x: 20, y: 360, w: 300, h: 80 },
  ];
}
