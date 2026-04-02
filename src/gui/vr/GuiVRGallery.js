export default function getGalleryWidgets(main) {
  const widgets = [];

  const w = 400; // Wider for thumbnails!
  const pad = 10;
  const itemH = 60; // Taller for thumbnails!
  const headerH = 30;

  let y = 10;
  const x = 10;
  const contentW = w - 20;

  const addHeader = (label) => {
    widgets.push({ type: 'info', label, x, y, w: contentW, h: headerH, header: true });
    y += headerH;
  };

  addHeader('Browser Sculpt Gallery');
  y += 10;

  const guiFiles = (main.getGui && main.getGui()) ? main.getGui()._ctrlFiles : null;
  const savedList = (guiFiles && guiFiles._browserSaves) ? guiFiles._browserSaves : [];

  if (savedList.length === 0) {
    widgets.push({ type: 'info', label: 'No saves found in browser storage.', x, y, w: contentW, h: 40, textAlign: 'left' });
    y += 40;
  } else {
    savedList.forEach(save => {
      // Main Load Button
      widgets.push({
        type: 'button',
        id: `load_browser_${save.key}`,
        label: save.value.name,
        x, y, w: contentW - 60, h: itemH,
        textAlign: 'left',
        data: { thumbImage: save.value.thumbImage },
        onInteract: () => {
          if (guiFiles) guiFiles.loadSpecificBrowserSave(save.key);
        }
      });

      // Delete Button
      widgets.push({
        type: 'button',
        id: `del_browser_${save.key}`,
        label: 'X',
        x: x + contentW - 50, y, w: 50, h: itemH,
        data: { tint: '#f44' },
        onInteract: () => {
          if (window.screenLog) window.screenLog(`Deleting ${save.key}...`, "orange");
          if (guiFiles) {
            guiFiles.deleteBrowserSave(save.key);
            
            // Live Refresh! Open overlay again to regenerate widgets without dead item.
            setTimeout(() => {
              if (main._guiXR) {
                const data = getGalleryWidgets(main);
                main._guiXR.openOverlay('menu', {
                  x: 200,
                  y: 200,
                  w: data.width,
                  h: data.height,
                  widgets: data.widgets,
                  title: 'Browser Gallery'
                });
              }
            }, 100); // Tiny timeout to let DB op finish
          }
        }
      });

      y += itemH + 10;
    });
  }

  return { widgets, width: w, height: y + 20 };
}
