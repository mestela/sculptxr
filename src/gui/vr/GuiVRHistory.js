import StateManager from 'states/StateManager';

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

  widgets.push({ type: 'slider', id: 'stack_size', label: 'Stack Size', x: 0, y: y, w: menuW, h: ITEM_H, value: StateManager.STACK_LENGTH, min: 3, max: 50, step: 1 });
  y += ITEM_H + GAP;

  return {
    width: menuW,
    height: y + 10,
    widgets: widgets
  };
}
