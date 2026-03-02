# SculptXR Handover Prompt

## Current State
The project is currently at **v0.9.38**.
We recently implemented a dual VR menu system with a "Mini-HUD" panel anchored to the non-dominant hand and a transient 3-column Tool Picker overlay.
We have successfully fixed the UI rendering bugs where the hover states and active slider values were not updating visually on the new popups because their WebGL canvases were not being told to upload their textures in the `onXRFrame` render loop.

## Status / Current Bug
The user has confirmed that the Mini-HUD and Tool Picker are now working correctly as of v0.9.38.

**Pending Task:**
- ask user