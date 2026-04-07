1. Query Menu Status & Coordinates
Run the built-in tracking dump command:

javascript
window.debugVRPose();
This will output the full transform hierarchy to the console, specifically detailing:

Whether the _vrMenu.mesh is successfully attached as a child of the controller grip.
The local translation and rotation of the menu panels.
2. Force Visibility & Redraws
If the menus become detached or turn invisible upon re-entering immersive mode, execute the following snippet to forcefully un-hide them and trigger a complete redraw/GPU upload:

javascript
// Force Main Menu visibility
if (window.app._vrMenu && window.app._vrMenu.mesh) {
    window.app._vrMenu.mesh.visible = true;
}
// Force Mini-HUD tool palette visibility
if (window.app._guiMini && window.app._guiMini.mesh) {
    window.app._guiMini.mesh.visible = true;
}
// Force responsive redraws on all GUI canvases
if (window.app._guiXR) window.app._guiXR._needsRedraw = true;
if (window.app._guiMini) window.app._guiMini._needsRedraw = true;
