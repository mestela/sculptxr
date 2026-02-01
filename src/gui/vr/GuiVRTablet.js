import TR from 'gui/GuiTR';
import Tablet from 'misc/Tablet';

export default function getTabletWidgets(main) {
  const widgets = [];
  const menuW = 400;
  let y = 10;
  const ITEM_H = 40;
  const GAP = 5;

  widgets.push({ type: 'header', label: TR('wacom'), x: 0, y: y, w: menuW, h: 30, header: true });
  y += 35;

  widgets.push({ type: 'slider', id: 'tablet_intensity', label: TR('wacomIntensity'), x: 0, y: y, w: menuW, h: ITEM_H, value: Tablet.intensityFactor, min: 0, max: 1, step: 0.01 });
  y += ITEM_H + GAP;
  widgets.push({ type: 'slider', id: 'tablet_radius', label: TR('wacomRadius'), x: 0, y: y, w: menuW, h: ITEM_H, value: Tablet.radiusFactor, min: 0, max: 1, step: 0.01 });
  y += ITEM_H + GAP;

  return { width: menuW, height: y + 10, widgets };
}
