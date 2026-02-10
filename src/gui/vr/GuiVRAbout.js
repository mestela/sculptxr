import TR from '../GuiTR.js?v=fix_3';

export default function getAboutWidgets(main) {
  const widgets = [];
  const menuW = 400;
  let y = 10;
  const ITEM_H = 40;
  const GAP = 5;

  widgets.push({ type: 'header', label: 'About & Help', x: 0, y: y, w: menuW, h: 30, header: true });
  y += 35;

  widgets.push({ type: 'info', label: 'SculptGL / SculptXR', x: 0, y: y, w: menuW, h: ITEM_H });
  y += ITEM_H + GAP;
  widgets.push({ type: 'info', label: 'stephaneginier.com', x: 0, y: y, w: menuW, h: ITEM_H });
  y += ITEM_H + GAP;

  widgets.push({ type: 'button', id: 'about_link', label: 'Open Website', x: 0, y: y, w: menuW, h: ITEM_H });
  y += ITEM_H + GAP;

  return { width: menuW, height: y + 10, widgets };
}
