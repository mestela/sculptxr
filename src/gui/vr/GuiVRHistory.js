import StateManager from '../../states/StateManager.js';

export default function getHistoryWidgets(main) {
  const widgets = [];

  // Menu Dimensions
  const menuW = 400;
  let y = 10;
  const ITEM_H = 40;
  const HEADER_H = 30;
  const GAP = 5;

  // --- HISTORY ---
  widgets.push({ type: 'header', label: 'History', x: 0, y: y, w: menuW, h: HEADER_H, header: true });
  y += HEADER_H + GAP;

  widgets.push({ type: 'button', id: 'undo', label: 'Undo', x: 0, y: y, w: menuW, h: ITEM_H });
  y += ITEM_H + GAP;
  widgets.push({ type: 'button', id: 'redo', label: 'Redo', x: 0, y: y, w: menuW, h: ITEM_H });
  y += ITEM_H + GAP;

  // Separator?
  y += 10;

  // --- SETTINGS ---
  widgets.push({ type: 'header', label: 'Settings', x: 0, y: y, w: menuW, h: HEADER_H, header: true });
  y += HEADER_H + GAP;

  const maxVal = /OculusBrowser/.test(navigator.userAgent) ? 30 : 500;
  const currentLimit = main.getStateManager().limit;
  const normLimit = Math.max(0, Math.min(1, (currentLimit - 3) / (maxVal - 3)));
  widgets.push({ type: 'slider', id: 'stack_size', label: 'Max Undo Steps', x: 0, y: y, w: menuW, h: ITEM_H, value: normLimit, min: 3, max: maxVal, precision: 0 });
  y += ITEM_H + GAP;

  return {
    width: menuW,
    height: y + 10,
    widgets: widgets
  };
}
