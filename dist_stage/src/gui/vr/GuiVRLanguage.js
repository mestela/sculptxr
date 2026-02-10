import TR from '../GuiTR.js';

export default function getLanguageWidgets(main) {
  const widgets = [];
  const menuW = 400;
  let y = 10;
  const ITEM_H = 40;
  const GAP = 5;

  widgets.push({ type: 'header', label: 'Language', x: 0, y: y, w: menuW, h: 30, header: true });
  y += 35;

  const langs = Object.keys(TR.languages).map(l => ({ id: l, label: l }));
  widgets.push({ type: 'combobox', id: 'language', label: 'Language', x: 0, y: y, w: menuW, h: ITEM_H, options: langs, value: TR.select });
  y += ITEM_H + GAP;

  return { width: menuW, height: y + 10, widgets };
}
