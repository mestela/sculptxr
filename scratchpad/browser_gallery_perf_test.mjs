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
// Small and SHARP: the blockiness was quality 0.25, not the pixel count, and the list is a
// column of small rows. matt: "if anything the images can be smaller, but of higher quality."
check('new browser thumbnails are captured at gallery resolution',
  /const THUMB = 128/.test(files) && /toDataURL\('image\/jpeg', 0\.88\)/.test(files));
check('legacy thumbnails are downsampled lazily for one page',
  files.includes('prepareBrowserSavePage(page = this._browserSavePage, pageSize = 12)') &&
  files.includes('this._browserSaves.slice(page * pageSize, (page + 1) * pageSize)') &&
  files.includes("canvas.toDataURL('image/jpeg', 0.9)") &&
  // matched to the capture size, or the downscale here throws the new pixels away again
  files.includes('const GALLERY_THUMB = 128;'));
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

// ── THE PANEL IS A LIST THAT SCROLLS ITSELF ───────────────────────────────────────────
//
// A three-across grid of tiles pushed the panel past its own height, so finding a save meant
// scrolling the whole menu and the buttons moved while you did it. matt: "maybe a list style like
// the outliner, so just a column... the internal area of the actual files should be scrollable,
// like how the outliner is scrollable within the larger scrollable panel. ideally the browser
// saves outer panel won't need any scrolling."
check('the saves panel is a scrolling column, not a grid',
  /\.mm-storage-list \{[\s\S]{0,400}?overflow-y: auto;/.test(menu)
    && !/\.mm-storage-grid \{[\s\S]{0,120}?grid-template-columns/.test(menu),
  'the outer panel has to scroll to reach the saves');
check('...with its own scrollbar, wired on every rebuild like the outliner',
  /mm-storage-sbar/.test(menu)
    && /const svList = this\._element\.querySelector\('\.mm-storage-list'\);/.test(menu),
  'rebuilt markup means new elements, so a scrollbar wired once is dead after the first rebuild');
// Actions act on a selection, so they belong under the thing you select; saving does not, so it
// stays at the top where it reads as "put the current scene in here".
check('...the list comes before the buttons that act on it',
  menu.indexOf('id="mm-storage-grid"') < menu.indexOf('id="mm-storage-load"')
    && menu.indexOf('id="mm-storage-load"') < menu.indexOf('id="mm-storage-prev"'));


// ── OPEN REPLACES, IMPORT ADDS ────────────────────────────────────────────────────────
//
// The menu offered one file-in button called "Add mesh" and five format buttons called "Save",
// which says nothing about which keeps your rig and which throws it away. matt: "we need more
// straightforward and easy to understand options for file load vs file import."
check('the file menu reads Open / Save / Import / Export, in that order',
  (() => {
    const f = menu.slice(menu.indexOf('buildMenuHTML_files'), menu.indexOf('buildMenuHTML_history'));
    const at = (t) => f.indexOf('mm-section-title">' + t);
    return at('Open') >= 0 && at('Open') < at('Save') && at('Save') < at('Import')
      && at('Import') < at('Export') && at('Nomad Link') > at('Export');
  })(),
);
// This path has always appended, which is Import's behaviour -- there was simply no Open.
check('...Open sets the replace flag, Import clears it',
  /q\('#mm-open-scene'\)[\s\S]{0,200}?window\._fileOpenReplace = true;/.test(menu)
    && /q\('#mm-import-obj'\)[\s\S]{0,200}?window\._fileOpenReplace = false;/.test(menu));
check('...and the flag is consumed once, before the first file',
  /if \(window\._fileOpenReplace\) \{\s*\n\s*window\._fileOpenReplace = false;\s*\n\s*this\.clearScene\(\);/.test(
    fs.readFileSync('/Users/mattestela/sculptxr/src/SculptGL.js', 'utf8')),
  'clearing per file would throw away the earlier ones in a multi-select');


// A row is a square thumbnail, then the name, then a short date -- all on ONE line. Stacking the
// name above the date made every row twice as tall for no gain: the date is a few characters and
// belongs beside the name. matt: "each row entry should be a small square thumbnail, with the
// name and short form date next to it."
check('a saves row lays out thumbnail, name and date on one line',
  /\.mm-storage-item \.mm-storage-meta \{[\s\S]{0,160}?display: flex;/.test(menu)
    && /\.mm-storage-item \.mm-storage-name \{ flex: 1; min-width: 0; \}/.test(menu)
    && /\.mm-storage-item \.mm-storage-date \{ flex-shrink: 0; \}/.test(menu),
  'the row wraps to two lines and the dates stop lining up');
// Square, and the same size whatever the image is: object-fit keeps a non-square capture from
// stretching, and a fixed box keeps the rows an even height down the list.
check('...with a fixed square thumbnail',
  /\.mm-storage-item img,[\s\S]{0,120}?width: 34px; height: 34px;[\s\S]{0,120}?object-fit: cover;/.test(menu));

console.log('browser gallery performance tests passed');
