# SculptXR Handover Prompt

## Objective: Hide System Cursor in Stationary Mode (Desktop 6DOF)

The project is currently at `v0.8.219`. We are attempting to hide the OS system cursor when the user is actively sculpting with VR controllers while looking at the desktop monitor (STATIONARY mode).

### Current State & Constraints:
1. **The Goal:** The cursor must cleanly disappear when the user holds/moves the VR controllers, and instantly reappear when they reach over and move the physical hardware mouse, allowing seamless interaction with the desktop UI.
2. **What We Know:** `Scene.js` successfully calls `setCanvasCursor('none')` and applies it to the WebGL canvas style when VR movement is detected. However, the OS cursor remains visibly frozen on the screen exactly where the hardware mouse was last left. It does not track the VR controllers.
3. **The `PointerLock` Dead End:** The standard WebXR workaround for hiding the cursor is the `PointerLock API`. However, this is incompatible with the user's workflow because it locks the mouse state entirely, breaking the seamless transition to grabbing the physical mouse for UI interactions. 

### Mission for Next Session:
1. **Evidence-Based Investigation Only:** Do not deploy speculative "one-shot" fixes for the cursor.
2. **Determine the Override Source:** Investigate *why* the OS cursor ignores the canvas `cursor: none` rule when VR controllers are active. 
   - Is an invisible DOM element (like a GUI full-screen overlay) sitting on top of the canvas and catching the cursor?
   - Is a CSS rule on the `body` or within `yagui.css` overriding the canvas?
   - Is the browser (Chrome/WebXR) or OS (SteamVR Desktop overlay) forcing cursor visibility for security/composition reasons because physical mouse polling has stalled?
3. **Action Items:** Add specialized DOM/CSS logging (e.g., logging `document.elementFromPoint(mouseX, mouseY)` or checking computed styles) to provide hard proof of what the cursor is actually resting over when it refuses to hide.
3. Keep the user in the loop. Deploy to Beta iteratively.