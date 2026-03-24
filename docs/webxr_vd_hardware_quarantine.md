# WebXR & Virtual Desktop Hardware Quarantine Debugging

## Problem Statement
Users reported that "3 out of 4 times" after performing a deep "Clear Site Data" or "Disable Cache" in Chrome on PCVR (using Virtual Desktop to stream from a Quest 3), the VR 3D scene would successfully launch and render, but the tracking controllers would completely fail to initialize. The UI menus would not mount, and the controllers were invisible.

## Debugging Process & Timeline

1. **Initial Assumption (Event Desync):** We initially assumed the `connected` event on the `WebXRController` instances was firing asynchronously and missing our assignment hooks. We refactored `Scene.js` to initialize the controllers *before* `await this._renderer.xr.setSession(session)` to guarantee the listeners were armed.
2. **Aggressive Tick Logging:** After the fix failed to resolve the issue for cache-cleared environments, we injected an aggressive telemetry tick (`_tickLog`) deep into the native 90hz `handleXRInput` render loop. This queried the browser's raw hardware array directly: `frame.session.inputSources.length`.
3. **The Smoking Gun:** The telemetry conclusively proved `inputSources.length: 0` was perpetually evaluating down the pipe. Chrome was successfully generating an immersive OpenXR context, but completely refusing to pass the physical gamepad devices to the Javascript engine.
4. **Architectural Override:** To guarantee maximum resilience, we completely ripped out the fragile `connected` event listener architecture (which is prone to dropping during asynchronous hardware negotiations). Handedness mapping (`this._vrControllerLeft = getController(i)`) was shifted down into the `handleXRInput` loop, where it dynamically maps the physical indices 90 times a second by querying the chronologically sorted `inputSources` array directly.
5. **Pinpointing the Root Cause:** The tick logger continued to report `SrcLen: 0`. We deduced this was an intersection between Chromium Security models and Virtual Desktop's emulation layering:
    *   **Browser Privacy Quarantine:** Doing a "Clear Site Data" instantly deletes Chromium's persistent grant for "Virtual Reality devices". On the next load, WebXR immersive mode launches opaquely, but the hardware API is silently quarantined pending user intent (clicking a DOM prompt).
    *   **Virtual Desktop Overrides:** Virtual Desktop has an experimental OpenXR feature that attempts to map physical optical hands from the Quest as "Hands" into the PCVR stream. 
    *   **The Conflict:** Our `requestSession` call explicitly asked for `optionalFeatures: ['hand-tracking']`. Virtual Desktop intercepted this, told Chrome that "Hands" were available, which caused Chrome to eagerly expect skeletal data. Since the user was holding regular controllers, no skeletal data arrived, and Chromium completely bypassed the standard fallback `gamepad` API initialization in confusion, effectively locking `inputSources` empty permanently.

## Resolution
1. **Removed `hand-tracking` Flag:** We forcefully removed `'hand-tracking'` from the `optionalFeatures` parameter in `SculptGL.js:startXRSession`. By omitting this flag, Chromium defaults purely to the legacy `gamepad` profile initialization map. OpenXR intercepts no longer confuse the skeletal pipeline, ensuring `.inputSources` reliably auto-populates with `meta-quest-touch-plus` physical controllers.
2. **Bulletproof Muting & Mounting:** The frame-by-frame polling loop dynamically connects UI elements only when `.handedness` evaluates cleanly natively. If tracking pauses or controllers are lost, `.inputSources` safely drops to `0` and zeroes out the logic, effortlessly healing when the VR device connects again natively.
3. **Hard Permission Fix:** We advised the user to explicitly hardcode `chrome://settings/content/vr` to natively allow hardware access indefinitely to prevent cache-clears stripping permission prompts.
