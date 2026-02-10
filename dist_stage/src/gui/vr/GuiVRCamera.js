import TR from '../GuiTR.js?v=fix_3';
import Enums from '../../misc/Enums.js?v=fix_3';
import StateManager from '../../states/StateManager.js?v=fix_3';

export default function getCameraWidgets(main) {
  const widgets = [];
  const menuW = 400;
  let y = 10;
  const ITEM_H = 40;
  const GAP = 5;

  const camera = main.getCamera();

  // Reset
  widgets.push({ type: 'header', label: TR('cameraReset'), x: 0, y: y, w: menuW, h: 30, header: true });
  y += 35;

  widgets.push({ type: 'button', id: 'cam_reset', label: TR('cameraCenter'), x: 0, y: y, w: menuW, h: ITEM_H });
  y += ITEM_H + GAP;
  widgets.push({ type: 'button', id: 'cam_front', label: TR('cameraFront'), x: 0, y: y, w: menuW, h: ITEM_H });
  y += ITEM_H + GAP;
  widgets.push({ type: 'button', id: 'cam_left', label: TR('cameraLeft'), x: 0, y: y, w: menuW, h: ITEM_H });
  y += ITEM_H + GAP;
  widgets.push({ type: 'button', id: 'cam_top', label: TR('cameraTop'), x: 0, y: y, w: menuW, h: ITEM_H });
  y += ITEM_H + GAP;

  // Projection
  widgets.push({ type: 'header', label: TR('cameraProjection'), x: 0, y: y, w: menuW, h: 30, header: true });
  y += 35;

  const projs = [
    { id: Enums.Projection.PERSPECTIVE, label: TR('cameraPerspective') },
    { id: Enums.Projection.ORTHOGRAPHIC, label: TR('cameraOrthographic') }
  ];
  widgets.push({ type: 'combobox', id: 'cam_proj', label: 'Projection', x: 0, y: y, w: menuW, h: ITEM_H, options: projs, value: camera.getProjectionType() });
  y += ITEM_H + GAP;

  if (camera.getProjectionType() === Enums.Projection.PERSPECTIVE) {
    const fov = camera.getFov();
    const minFov = 10;
    const maxFov = 90;
    const fovNorm = (fov - minFov) / (maxFov - minFov);
    widgets.push({ type: 'slider', id: 'fov', label: TR('cameraFov'), x: 0, y: y, w: menuW, h: ITEM_H, value: fovNorm, min: minFov, max: maxFov, step: 1 });
    y += ITEM_H + GAP;
  }

  // Mode
  widgets.push({ type: 'header', label: TR('cameraMode'), x: 0, y: y, w: menuW, h: 30, header: true });
  y += 35;

  const modes = [
    { id: Enums.CameraMode.ORBIT, label: TR('cameraOrbit') },
    { id: Enums.CameraMode.SPHERICAL, label: TR('cameraSpherical') },
    { id: Enums.CameraMode.PLANE, label: TR('cameraPlane') }
  ];
  widgets.push({ type: 'combobox', id: 'cam_mode', label: 'Mode', x: 0, y: y, w: menuW, h: ITEM_H, options: modes, value: camera.getMode() });
  y += ITEM_H + GAP;

  widgets.push({ type: 'checkbox', id: 'cam_pivot', label: TR('cameraPivot'), x: 0, y: y, w: menuW, h: ITEM_H, value: camera.getUsePivot() });
  y += ITEM_H + GAP;

  // Speed
  const speed = main._cameraSpeed || 0.1;
  const minSpeed = 0.05;
  const maxSpeed = 1.0;
  const speedNorm = (speed - minSpeed) / (maxSpeed - minSpeed);
  widgets.push({ type: 'slider', id: 'cam_speed', label: 'Speed', x: 0, y: y, w: menuW, h: ITEM_H, value: speedNorm, min: minSpeed, max: maxSpeed, step: 0.001 });
  y += ITEM_H + GAP;

  return { width: menuW, height: y + 10, widgets };
}
