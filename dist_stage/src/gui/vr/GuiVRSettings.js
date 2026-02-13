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



  return {
    width: menuW,
    height: y + 10,
    widgets: widgets
  };
}
