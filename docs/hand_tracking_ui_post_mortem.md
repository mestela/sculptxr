# Hand Tracking UI Polish - Debugging Post-Mortem

**Date:** March 11, 2026
**Branch:** `hand_tracking`

## Current Status 
The core physics and tracking math for native hands works (grabbing, orientation, pushing the main menu), but the styling and layout logic of the `GuiXR` MiniHUD are failing in non-obvious ways. 

### Issue 1: Missing `[ Main Menu ]` Button on MiniHUD
- **Goal:** The MiniHUD tools tab should have a button spanning the top opening the main VR menu.
- **Attempt 1:** Traced to `getToolsWidgets` in `GuiVRTools.js` relying on an `isMiniHUD` boolean that wasn't being passed.
- **Attempt 2:** Modified `GuiXR` constructor to accept and cache `_isMiniHUD`.
- **Attempt 3:** Explicitly updated the `_getWidgets` generation loop in `GuiXR` to pass `this._isMiniHUD` into the `gens[secTitle]` calls.
- **Result:** The button still does not visually appear in the headset. 

### Issue 2: Proximity Glow Border (`_isMiniHUDActive`)
- **Goal:** The MiniHUD border should glow cyan when the opposing index finger enters a 25cm radius.
- **Attempt 1:** The threshold check in `Scene.js` was correctly finding the distance, but the state wasn't persisting. 
- **Attempt 2:** Moved the `_isMiniHUDActive` boolean reset outside the `source.hand` input loop, since the left hand processing was immediately overwriting the right hand's state. 
- **Attempt 3:** Added an explicit state-change detector at the end of `handleXRInput` to trigger `_guiMini._needsRedraw = true` when the proximity state flips.
- **Result:** The border still does not glow cyan.

### Roadblocks
1. **Lack of Console Access:** The user cannot connect adb or browser devtools to see JS errors.
2. **Headless Testing Failed:** MacOS prevents the browser subagent from launching local Chrome with WebXR flags. A quick NodeJS script also failed due to `gl-matrix` ESM module resolution errors preventing the UI from rendering offline.
3. **VR Log Injection Failed:** We injected `addVrLog` directly into the `GuiXR` render loop to print the value of `isMiniHUD` onto the Quest screen. The user reported the text never appeared, implying the render loop for the `Sculpting & Painting` tab might not be firing *at all*, or the widget generation is crashing silently.

## Next Steps for Tomorrow
1. Check if the "Tools" tab is actually open/selected by default on the MiniHUD. If it's closed, `gens[secTitle]` never runs.
2. Verify if `this._viewMode` vs `secTitle` logic in `GuiXR._getWidgets()` is misrouting the MiniHUD layout entirely. 
3. Re-examine `VRMenu.js` to see if the cyan border drawing instructions (added to `GuiXR.js` line ~1930) are being clipped or overridden by a solid background.
4. Stop deploying to production; keep all future tests strictly isolated on the `hand_tracking` branch until the UI proves stable.
