import Enums from 'misc/Enums';

export default function getSettingsWidgets(main) {
  const widgets = [];
  const menuW = 400;
  let y = 10;
  const ITEM_H = 40;
  const HEADER_H = 30;
  const GAP = 5;

  // --- CAMERA ---
  widgets.push({ type: 'header', label: 'Camera', x: 0, y: y, w: menuW, h: HEADER_H, header: true });
  y += HEADER_H + GAP;

  widgets.push({ type: 'button', id: 'reset_view', label: 'Reset View', x: 0, y: y, w: menuW, h: ITEM_H });
  y += ITEM_H + GAP;

  const cam = main.getCamera();
  const fovVal = (cam.getFov() - 10) / (90 - 10);
  widgets.push({ type: 'slider', id: 'fov', label: 'Field of View', x: 0, y: y, w: menuW, h: ITEM_H, value: fovVal, min: 10, max: 90 });
  y += ITEM_H + GAP;

  const isOrtho = cam.getMode() === Enums.CameraMode.ORTHOGRAPHIC;
  widgets.push({ type: 'checkbox', id: 'camera_mode', label: 'Orthographic', x: 0, y: y, w: menuW, h: ITEM_H, value: isOrtho });
  y += ITEM_H + GAP;

  // Divider
  y += 10;

  return {
    width: menuW,
    height: y + 10,
    widgets: widgets
  };
}
