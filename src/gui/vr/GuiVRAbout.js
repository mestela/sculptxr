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

      // Parse mixed markdown styles on the same line
      if (clean.startsWith('# ')) {
         y += 20;
         clean = clean.replace('# ', '').trim();
         widgets.push({ type: 'info', label: clean, x: 10, y: y, w: menuW, h: 25, font: 'bold 22px sans-serif', color: '#bbb' });
         y += 25;
      } else {
         if (clean.startsWith('-')) y += 15;
         let bullet = clean.startsWith('-') ? '• ' : '';
         let raw = bullet + clean.replace(/^- /, '').replace(/^-/, '').trim();

         const words = raw.split(' ');
         let currentLineWords = [];
         let currentLen = 0;
         const wrappedLines = [];

         for (let w of words) {
            if (currentLen + w.length + 1 > 65) {
               wrappedLines.push(currentLineWords.join(' '));
               currentLineWords = [w];
               currentLen = w.length + 1;
            } else {
               currentLineWords.push(w);
               currentLen += w.length + 1;
            }
         }
         if (currentLineWords.length > 0) wrappedLines.push(currentLineWords.join(' '));

         for (let l of wrappedLines) {
            const spans = [];
            let isBold = false;
            const parts = l.split(/(\*\*|`)/);
            for (let part of parts) {
               if (part === '**' || part === '`') {
                  isBold = !isBold;
               } else if (part.length > 0) {
                  spans.push({ text: part, bold: isBold });
               }
            }
            widgets.push({ type: 'richtext', spans: spans, x: 10, y: y, w: menuW, h: 25 });
            y += 25;
         }
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
