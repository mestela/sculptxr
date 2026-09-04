// Structural checks for keeping the browser-save gallery cheap enough for HTML→VR paint.
import fs from 'fs';

const files = fs.readFileSync('/Users/mattestela/sculptxr/src/gui/GuiFiles.js', 'utf8');
const menu = fs.readFileSync('/Users/mattestela/sculptxr/src/gui/htmlvr/MainMenuPanel.js', 'utf8');
const panel = fs.readFileSync('/Users/mattestela/sculptxr/src/gui/htmlvr/FilesPanel.js', 'utf8');
let fails = 0;
const check = (name, ok) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}`);
  if (!ok) fails++;
};

// 256 now, not 128: at 128 and JPEG 0.25 a save's thumbnail was mush, and the thumbnail is how
// you find the file again. matt: "they're a bit too blocky."
check('new browser thumbnails are captured at gallery resolution',
  /const THUMB = 256/.test(files) && /toDataURL\('image\/jpeg', 0\.72\)/.test(files));
check('legacy thumbnails are downsampled lazily for one page',
  files.includes('prepareBrowserSavePage(page = this._browserSavePage, pageSize = 12)') &&
  files.includes('this._browserSaves.slice(page * pageSize, (page + 1) * pageSize)') &&
  files.includes("canvas.toDataURL('image/jpeg', 0.8)") &&
  // matched to the capture size, or the downscale here throws the new pixels away again
  files.includes('const GALLERY_THUMB = 256;'));
check('gallery HTML contains at most twelve saves',
  menu.includes('const pageSize = 12') &&
  menu.includes('pageSaves.map(s =>'));
check('selection updates existing cards instead of rebuilding gallery HTML',
  menu.includes("card.classList.toggle('selected', card === item)") &&
  menu.includes('repaintFn?.()'));
check('VR panel awaits thumbnail preparation and rejects stale page rebuilds',
  panel.includes('await guiFiles?.prepareBrowserSavePage?.()') &&
  panel.includes('token !== this._rebuildToken'));

if (fails) process.exit(1);
console.log('browser gallery performance tests passed');
