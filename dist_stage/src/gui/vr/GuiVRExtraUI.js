import TR from 'gui/GuiTR';
import ShaderContour from 'render/shaders/ShaderContour';
import Enums from 'misc/Enums';

export default function getExtraUIWidgets(main) {
  const widgets = [];
  const menuW = 400;
  let y = 10;
  const ITEM_H = 40;
  const GAP = 5;

  widgets.push({ type: 'header', label: 'Extra UI', x: 0, y: y, w: menuW, h: 30, header: true });
  y += 35;

  // Contour
  widgets.push({ type: 'header', label: TR('contour'), x: 0, y: y, w: menuW, h: 30, header: true });
  y += 35;
  widgets.push({ type: 'info', label: 'Contour Color (TODO)', x: 0, y: y, w: menuW, h: ITEM_H });
  y += ITEM_H + GAP;

  // Resolution
  widgets.push({ type: 'header', label: TR('resolution'), x: 0, y: y, w: menuW, h: 30, header: true });
  y += 35;
  const pr = main._pixelRatio;
  const minPr = 0.5;
  const maxPr = 2.0;
  const prNorm = (pr - minPr) / (maxPr - minPr);
  widgets.push({ type: 'slider', id: 'extra_pixel_ratio', label: 'Pixel Ratio', x: 0, y: y, w: menuW, h: ITEM_H, value: prNorm, min: minPr, max: maxPr, step: 0.05 });
  y += ITEM_H + GAP;

  // Voxel Settings
  widgets.push({ type: 'header', label: 'Voxel Settings', x: 0, y: y, w: menuW, h: 30, header: true });
  y += 35;

  // Try to get real values from Voxel Tool if initialized
  // But Voxel Tool might not be active. We use defaults if not.
  // Actually we should try to fetch current tool settings if they persist.
  // We'll stick to defaults or persistent if we can find them.
  // Assume persistent?
  let voxRes = 128;
  let voxRad = 50.0;
  // If we can improve this later we will.

  const minRes = 32;
  const maxRes = 256;
  const resNorm = (voxRes - minRes) / (maxRes - minRes);

  const minRad = 1.0;
  const maxRad = 100.0;
  const radNorm = (voxRad - minRad) / (maxRad - minRad);

  widgets.push({ type: 'slider', id: 'extra_vox_res', label: 'Res', x: 0, y: y, w: menuW, h: ITEM_H, value: resNorm, min: minRes, max: maxRes, step: 16 });
  y += ITEM_H + GAP;
  widgets.push({ type: 'slider', id: 'extra_vox_rad', label: 'Rad Mult', x: 0, y: y, w: menuW, h: ITEM_H, value: radNorm, min: minRad, max: maxRad, step: 1.0 });
  y += ITEM_H + GAP;

  return { width: menuW, height: y + 10, widgets };
}
