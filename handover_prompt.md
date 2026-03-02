# SculptXR Handover Prompt

## Current State
The project is currently at **v0.9.22**.
We recently implemented a dual VR menu system with a "Mini-HUD" panel anchored to the non-dominant hand and a transient 3-column Tool Picker overlay.

## Status / Current Bug
The user has reported a new bug: **Clicking the tool button in the Mini-HUD incorrectly launches the main VR menu and shows the 3-column selection there instead of staying isolated or using its own instance.**

**Pending Task:**
- Investigate why the Mini-HUD is launching the main VR menu when the tool button is clicked.
- Double-check if we are incorrectly reusing elements or doubling up on names (e.g. `guiXR.openOverlay` vs `guiMini.openOverlay` or `main.guiXR.setVisibility(true)` being called unintentionally).
- Ensure separate instances of the tool combobox/picker are correctly handled so the Mini-HUD launches its own transient popup without bringing up the main VR menu.