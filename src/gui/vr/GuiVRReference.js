import TR from 'gui/GuiTR';
import ReferenceManager from 'editing/ReferenceManager'; // Implementation needed?
// Actually we can just implement upload logic here if simple. 
// But Image Loading is async. 

export default function getReferenceWidgets(main) { // Replaces getBackgroundWidgets
  const widgets = [];

  // Menu Dimensions
  const menuW = 400;
  let y = 10;
  const ITEM_H = 40;
  const HEADER_H = 30;
  const GAP = 5;

  // --- REFERENCE IMAGES ---
  widgets.push({ type: 'header', label: 'Reference Images', x: 0, y: y, w: menuW, h: HEADER_H, header: true });
  y += HEADER_H + GAP;

  // Add Reference Button
  widgets.push({
    type: 'button',
    id: 'add_reference',
    label: 'Add Reference (Import Image)',
    x: 0, y: y, w: menuW, h: ITEM_H,
    onInteract: () => {
        // Trigger generic file picker or specific one?
        // We can reuse `backgroundopen` or add `referenceopen` input in index.html?
        // Or just use `backgroundopen` and hijack the listener?
        // Let's assume we need a new input `referenceopen` in index.html or reuse `backgroundopen`.
        // Ideally we name it consistently.
        // Let's use `backgroundopen` for now if it exists, but renaming to `referenceopen` is cleaner.
        // Plan: Add `referenceopen` to index.html too.
        
        const input = document.getElementById('referenceopen');
        if (input) input.click();
        else {
             // Fallback or Error
             if (window.screenLog) window.screenLog('Error: #referenceopen not found', 'red');
        }
    }
  });
  y += ITEM_H + GAP;
  
  // Clear All
  widgets.push({
    type: 'button',
    id: 'clear_references',
    label: 'Clear All References',
    x: 0, y: y, w: menuW, h: ITEM_H,
    onInteract: () => {
        // Main.getReferenceManager().clear()? 
        // We need to implement ReferenceManager accessible from main.
        if (main.getReferenceManager) {
            main.getReferenceManager().clear();
        }
    }
  });
  y += ITEM_H + GAP;
  
  // Toggle Visibility?
  widgets.push({
      type: 'checkbox',
      id: 'show_references',
      label: 'Show References',
      x: 0, y: y, w: menuW, h: ITEM_H,
      value: true, // Need state
      onInteract: () => {
          // Toggle visibility
      }
  });
  y += ITEM_H + GAP;

  return {
    width: menuW,
    height: y + 10,
    widgets: widgets
  };
}
