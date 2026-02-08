import Enums from 'misc/Enums';
import TR from 'gui/GuiTR';
import ReferenceManager from 'editing/ReferenceManager'; // To be created? Or just handle in GuiReference for now?
// Actually we agreed to put logic in ReferenceManager usually? 
// But current GuiBackground handles logic directly in GuiBackground usually?
// Let's stick to GuiReference managing the UI and maybe a simple ReferenceManager or just Scene methods.
// Implementation Plan said: ReferenceManager.js

class GuiReference {

  constructor(guiParent, ctrlGui) {
    this._main = ctrlGui._main; // main application
    this._menu = null;
    this.init(guiParent);
  }

  init(guiParent) {
    // We don't add a menu here for VR? 
    // GuiXR calls getReferenceWidgets usually.
    // This file might be for Desktop GUI? 
    // If we are replacing GuiBackground, we should update Desktop GUI too?
    // Plan said: "Modify GuiBackground.js -> Rename to GuiReference.js"
    // And "Update GuiXR.js".
  }
  
  // Static method for VR Widgets?
  // GuiXR uses `getBackgroundWidgets` currently import from... where?
  // GuiXR imports `getBackgroundWidgets` likely from a separate file or defines it?
  // Checked GuiXR.js: `import getBackgroundWidgets from 'gui/vr/GuiVRBackground';` ? 
  // No, `GuiXR.js` imports were not fully shown in previous view.
  // Let's check `GuiXR.js` imports.
}
export default GuiReference;
