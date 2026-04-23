# iPad Support and Interaction Fixes

This document records the changes made to support iPad (iOS Safari) and resolve interaction issues with touch and Apple Pencil.

## 1. WebXR API Compatibility (Silent Crash Fix)
- **Issue**: iOS Safari does not support WebXR by default, causing a `ReferenceError: Can't find variable: XRRigidTransform` when loading `Scene.js`.
- **Fix**: Added a polyfill for `XRRigidTransform` at the top of `src/Scene.js` if it is undefined. It mocks the `position` and `orientation` properties used by the app.

## 2. Touch Event Coordinates (Black Screen Fix)
- **Issue**: Tapping or dragging on the screen caused the 3D viewport to go black.
- **Cause**: Hammer.js event handlers in `SculptGL.js` were passing `pageX`/`pageY` to `setMousePosition`, which expected `clientX`/`clientY`. This resulted in `NaN` coordinates, breaking camera math.
- **Fix**: Updated `onPanStart`, `onPanMove`, and `onDoubleTap` in `src/SculptGL.js` to use `clientX`/`clientY` for the proxy event object.

## 3. Apple Pencil Sculpting
- **Issue**: Apple Pencil (and finger) interaction was interpreted as camera orbit rather than sculpting strokes.
- **Cause**: Hammer.js pan events were falling through to camera rotate logic because the hit test failed or the button was not recognized as left click during continuous events.
- **Fix**: Added handler for `pointerdown`, `pointermove`, and `pointerup` in `src/SculptGL.js`. If the `pointerType` is `'pen'` (Apple Pencil), events are routed directly to mouse handlers, enabling sculpting while keeping finger touch for camera manipulation.

## 4. UI Dragging and Scrolling
- **Issue**: Sliders and the timeline did not respond to dragging, only taps. But enabling dragging globally blocked vertical scrolling on panels.
- **Fix**: Added a selective Touch-to-Mouse mapper in `index.html`. It intercepts touches on elements with class `.gui-slider` or non-main canvases (timeline) and dispatches fake mouse events. Other touches fall through to native scrolling.

## 5. Eruda Console Toggle
- **Issue**: The Eruda floating console button was visible by default and hard to hide on iOS.
- **Fix**: Removed static Eruda injection from `index.html`. Added dynamic loader in `src/gui/Gui.js` via a checkbox in the "Extra UI" menu. It loads Eruda on demand and handles hiding the button via Shadow DOM style manipulation.

## 6. File Menu Cleanup
- **Action**: Removed "Save .sgl" from the files menu as it is lossy for SculptXR's rich data (animations, etc.). Kept "Export .sxr".
