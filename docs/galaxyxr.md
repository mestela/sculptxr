# Galaxy XR WebXR Rendering Issues and Workarounds

Developing for WebXR on Samsung Galaxy XR devices running Chrome requires specific workarounds due to idiosyncratic behavior in both the Qualcomm Adreno GPU driver and Chrome's WebGL implementation on Android 14+.

This document covers three major bugs encountered during SculptXR development and their fixes.

## 1. The Single-Eye Rendering Bug

**The Problem:**
When entering WebXR on the Galaxy XR, the application would only render correctly in the left eye. The right eye would remain entirely blank or show the hardware AR passthrough camera feed without the WebGL canvas overlaid.

**Root Cause:**
Chrome incorrectly handled the WebGL Frame Buffer Object (FBO) state bindings provided by `glLayer.framebuffer` across multiple WebXR views (`pose.views`). Specifically, the Qualcomm Adreno tile-rendering backend occasionally drops FBO bindings mid-render. When the loop progressed from the left eye (view 0) to the right eye (view 1), the FBO was no longer bound, causing the right eye's draw calls to vanish. Furthermore, the views were susceptible to viewport bleeding if hardware clipping wasn't explicitly enforced.

**The Fix:**
The WebXR render loop in `Scene.js` was fortified to be overly explicit per-eye:

1.  **Strict State Recreation:** Inside the `for (var i = 0; i < views.length; ++i)` loop, the `glLayer.framebuffer` must be aggressively re-bound: `<br>` `gl.bindFramebuffer(gl.FRAMEBUFFER, glLayer.framebuffer);`
2.  **Hardware Clipping:** WebGL `gl.scissor()` must be supplied identically alongside `gl.viewport()`. This prevents the hardware driver from allowing one viewport's render pass to overwrite the other viewport's data in the underlying buffer.
3.  **Per-Eye Clearing:** `gl.clearColor` and `gl.clear` must be invoked inside the loop for each view, rather than once before the view loop.

## 2. Mid-Pass FBO Drops (UI Texture Uploads)

**The Problem:**
Even with the single-eye fixes applied, the right eye would still occasionally "drop out" momentarily during sculpting or when dragging an interactive UI overlay (like the VR Mini-HUD or Tool Picker).

**Root Cause:**
WebGL state leakage and driver bugs. In `Scene.js`, the VR Menu overlay is backed by a 2D Canvas element that gets rasterized into a WebGL texture via `texSubImage2D`. If this texture upload occurred *inside* the `pose.views` render loop (or nested deeply within the scene graph's render calls), the Adreno tile-renderer would panic and drop the WebGL context's active bound FBO entirely. The subsequent draw calls for the right eye would then fail silently.

**The Fix:**
Texture uploads must be executed *prior* to the WebXR FBO rendering loop. We moved `this._guiXR.updateTexture()` to occur explicitly before the `views` loop starts, ensuring all sub-image data is uploaded to WebGL memory before the delicate stereo render pass begins.

## 3. The `window.screenLog` CPU Bottleneck

**The Problem:**
Performance on the Galaxy XR felt incredibly sluggish compared to the Meta Quest 3, completely failing to maintain 90fps, particularly when the debug console UI was active.

**Root Cause:**
A massive CPU bottleneck created by synchronous DOM layout reflows (Layout Thrashing). The `window.screenLog` diagnostic tool, designed to print floating logs on the Galaxy XR desktop viewport, was appending lines using `element.innerText += ...`. 

In Chrome, modifying `.innerText` forces the browser to synchronously recalculate the style and layout of the entire tree to determine what text is visibly rendered. Doing this 90 times a second inside `requestAnimationFrame` consumed over 60% of the main thread's CPU time, starving the WebGL rasterizer.

**The Fix:**
1.  **Switched to `textContent`:** We changed the logger to use `.textContent` instead of `.innerText`. `textContent` modifies the text node directly without triggering a synchronous CSS/layout reflow.
2.  **Capped DOM Growth:** Replaced `+=` with arrays. We pushed lines into an array, `slice(-50)` to keep only the 50 most recent logs, and then `join('\n')`. This prevents the text node from infinitely growing and choking memory.
3.  **Rate-Limiting:** We wrapped the text update in a conditional block to skip DOM manipulation entirely when the UI is hidden (`!window._showDebugLog`), ensuring zero overhead when not actively debugging.
