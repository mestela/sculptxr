import * as fs from 'fs';
import getToolsWidgets from './src/gui/vr/GuiVRTools.js';

// Mock Main
const mockMain = {
  getSculptManager: () => ({
    getToolIndex: () => 1
  }),
  _guiXR: {
    toggleVisibility: () => {}
  }
};

// Mock translation
global.window = {
  TR: (str) => str
};

const widgets = getToolsWidgets(mockMain, 1, true);

console.log("Widgets generated:", widgets.length);
const mainMenuBtn = widgets.find(w => w.id === 'main_menu');

if (mainMenuBtn) {
  console.log("SUCCESS: Main Menu button found!");
  console.dir(mainMenuBtn);
} else {
  console.log("ERROR: Main Menu button MISSING!");
  // Print the first few to see what IS there
  console.log(widgets.slice(0, 3).map(w => w.id || w.label));
}
