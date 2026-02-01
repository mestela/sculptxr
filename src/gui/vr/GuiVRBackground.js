import TR from 'gui/GuiTR';

export default function getBackgroundWidgets(main) {
  const widgets = [];
  const menuW = 400;
  let y = 10;
  const ITEM_H = 40;
  const GAP = 5;

  const bg = main.getBackground();

  widgets.push({ type: 'header', label: TR('backgroundTitle'), x: 0, y: y, w: menuW, h: 30, header: true });
  y += 35;

  const types = [
    { id: 0, label: 'Image' },
    { id: 1, label: 'Environment' },
    { id: 2, label: 'Ambient env' }
  ];
  widgets.push({ type: 'combobox', id: 'bg_type', label: 'Type', x: 0, y: y, w: menuW, h: ITEM_H, options: types, value: bg._type });
  y += ITEM_H + GAP;

  if (bg._type === 1) { 
     widgets.push({ type: 'slider', id: 'bg_blur', label: 'Blur', x: 0, y: y, w: menuW, h: ITEM_H, value: bg._blur, min: 0, max: 1, step: 0.01 });
     y += ITEM_H + GAP;
  }

  widgets.push({ type: 'header', label: 'Image', x: 0, y: y, w: menuW, h: 30, header: true });
  y += 35;

  widgets.push({ type: 'button', id: 'bg_reset', label: TR('backgroundReset'), x: 0, y: y, w: menuW, h: ITEM_H });
  y += ITEM_H + GAP;
  widgets.push({ type: 'button', id: 'bg_import', label: TR('backgroundImport'), x: 0, y: y, w: menuW, h: ITEM_H });
  y += ITEM_H + GAP;
  widgets.push({ type: 'checkbox', id: 'bg_fill', label: TR('backgroundFill'), x: 0, y: y, w: menuW, h: ITEM_H, value: bg._fill });
  y += ITEM_H + GAP;

  return { width: menuW, height: y + 10, widgets };
}
