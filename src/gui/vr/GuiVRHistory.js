export default function getHistoryWidgets(main) {
  const widgets = [];
  const col1X = 20;
  const btnH = 60;
  const gapBtn = 20;
  const gapSection = 40;
  const gapHeader = 40;

  let y = 130;

  widgets.push({ type: 'info', label: 'HISTORY', x: col1X, y: y });
  y += gapHeader;

  widgets.push({ type: 'button', id: 'undo', label: 'Undo', x: col1X, y: y, w: 240, h: btnH });
  widgets.push({ type: 'button', id: 'redo', label: 'Redo', x: 280, y: y, w: 240, h: btnH });

  // Align stack size slider?
  widgets.push({ type: 'slider', id: 'stack_size', label: 'Stack Size', x: 540, y: y + 10, w: 300, h: 40, value: 0.5, disabled: true });
  y += btnH + gapSection;

  widgets.push({ type: 'info', label: 'SUBDIVISION', x: col1X, y: y });
  y += gapHeader;

  widgets.push({ type: 'button', id: 'max_resolution', label: 'Subdivide', x: col1X, y: y, w: 300, h: btnH });

  return widgets;
}
