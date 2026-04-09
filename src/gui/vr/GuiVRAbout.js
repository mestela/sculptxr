import TR from '../GuiTR.js';
import { VERSION } from '../../Version.js';
import releaseText from '../../../docs/releases.md?raw';

export default function getAboutWidgets(main) {
  const widgets = [];
  const menuW = 600;
  let y = 10;
  const ITEM_H = 40;
  const GAP = 5;

  widgets.push({ type: 'header', label: 'About & Help', x: 0, y: y, w: menuW, h: 30, header: true });
  y += 35;

  const version = VERSION || '0.0.0';
  widgets.push({ type: 'info', label: `SculptXR ${version}`, x: 10, y: y, w: menuW, h: ITEM_H });
  y += ITEM_H + GAP;

  widgets.push({ type: 'info', label: 'Original by Stéphane Ginier', x: 10, y: y, w: menuW, h: ITEM_H });
  y += ITEM_H + GAP;
  widgets.push({ type: 'info', label: 'VR Port by Matt Estela and Antigravity', x: 10, y: y, w: menuW, h: ITEM_H });
  y += ITEM_H + GAP;

  widgets.push({ type: 'button', id: 'about_link', label: 'tokeru.com/sculptxr', x: 0, y: y, w: menuW, h: ITEM_H, onInteract: () => window.open('https://tokeru.com/sculptxr/') });
  y += ITEM_H + GAP;

  widgets.push({ type: 'button', id: 'github_link', label: 'github.com/mestela/sculptxr', x: 0, y: y, w: menuW, h: ITEM_H, onInteract: () => window.open('https://github.com/mestela/sculptxr') });
  y += ITEM_H + GAP;

  // Controls Cheatsheet
  widgets.push({ type: 'header', label: 'Controls', x: 0, y: y, w: menuW, h: 30, header: true });
  y += 35;

  widgets.push({ type: 'info', label: 'Secondary Stick: Undo / Redo', x: 10, y: y, w: menuW, h: ITEM_H });
  y += ITEM_H + GAP;
  widgets.push({ type: 'info', label: 'Dominant Stick: Brush Size / Intensity', x: 10, y: y, w: menuW, h: ITEM_H });
  y += ITEM_H + GAP;
  widgets.push({ type: 'info', label: 'Grip: Move / Scale World', x: 10, y: y, w: menuW, h: ITEM_H });
  y += ITEM_H + GAP;

  // Release History Preview
  widgets.push({ type: 'header', label: 'Recent Release Notes', x: 0, y: y, w: menuW, h: 30, header: true });
  y += 35;

  try {
    const lines = releaseText.split('\n').slice(0, 200);
    for (let line of lines) {
      let clean = line.trim();
      if (clean.length === 0) continue;

      // Strip markdown prefixes to clean up the raw feel
      if (clean.startsWith('- **')) clean = clean.replace('- **', '').replace('**:', ':');
      if (clean.startsWith('# ')) clean = clean.replace('# ', 'Version ');

      // Break long lines to fit in wider menu
      const maxChars = 85;
      for (let i = 0; i < clean.length; i += maxChars) {
        const chunk = clean.slice(i, i + maxChars);
        widgets.push({ type: 'info', label: chunk, x: 10, y: y, w: menuW, h: 25 });
        y += 25;
      }
    }
  } catch (e) {
    widgets.push({ type: 'info', label: 'Release notes not found.', x: 10, y: y, w: menuW, h: ITEM_H });
    y += ITEM_H + GAP;
  }

  widgets.push({ type: 'button', id: 'github_rel_link', label: 'Read more on GitHub', x: 0, y: y, w: menuW, h: ITEM_H, onInteract: () => window.open('https://github.com/mestela/sculptxr/blob/master/docs/releases.md') });
  y += ITEM_H + GAP;

  return { width: menuW, height: Math.min(600, y + 10), widgets };
}
