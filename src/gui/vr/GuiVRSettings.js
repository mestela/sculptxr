import Enums from '../../misc/Enums.js';

export default function getSettingsWidgets(main) {
  const widgets = [];
  const menuW = 400;
  let y = 10;
  const ITEM_H = 40;
  const HEADER_H = 30;
  const GAP = 5;

  // --- INPUT ---
  widgets.push({ type: 'header', label: 'Input', x: 0, y: y, w: menuW, h: HEADER_H, header: true });
  y += HEADER_H + GAP;

  widgets.push({
    type: 'checkbox', id: 'left_hand_mode', label: 'Left Hand Mode', x: 0, y: y, w: menuW, h: ITEM_H,
    value: main._dominantHand === 'left',
    onInteract: () => {
      const newHand = main._dominantHand === 'left' ? 'right' : 'left';
      if (main.setDominantHand) main.setDominantHand(newHand);
    }
  });
  y += ITEM_H + GAP;

  widgets.push({
    type: 'checkbox', id: 'aim_picking_mode', label: 'Aim Picking Mode (Raycast)', x: 0, y: y, w: menuW, h: ITEM_H,
    value: !main._vrUseVolumeIntersect,
    onInteract: () => {
      main._vrUseVolumeIntersect = !main._vrUseVolumeIntersect;
      if (main.guiXR) main.guiXR._needsRedraw = true;
    }
  });
  y += ITEM_H + GAP;

  widgets.push({ type: 'header', label: 'Calibration', x: 0, y: y, w: menuW, h: HEADER_H, header: true });
  y += HEADER_H + GAP;

  widgets.push({
    type: 'slider', id: 'offsetY', label: 'Head Height', x: 0, y: y, w: menuW, h: ITEM_H,
    min: -2.0, max: 0.0, step: 0.1,
    value: main.getGui()._uiXR && main.getGui()._uiXR._uiSettings.offsetY !== undefined ? main.getGui()._uiXR._uiSettings.offsetY : -1.2,
    onInteract: (val) => {
      // Store globally for persistence
      if (main.getGui()._uiXR) {
        main.getGui()._uiXR._uiSettings.offsetY = val;
      }
      // Apply immediately
      main.updateVROffsets();
    }
  });
  y += ITEM_H + GAP;

  return {
    width: menuW,
    height: y + 10,
    widgets: widgets
  };
}
