# Feature: Controller Model Override & Dynamic Reloading

**Objective**: Allow users to manually override the WebXR controller profile reported by the runtime and reload the controller models on-the-fly without restarting the XR session. This addresses a limitation where some runtimes (like Virtual Desktop) transmit hardcoded controller strings.

## Implementation Details

### 1. Proxy-based Profile Override
We implemented a `Proxy` wrapper for `XRInputSource`. This intercepts the `profiles` property, allowing the application to force a specific controller profile string (e.g., `samsung-galaxyxr`) regardless of what the runtime reports.

### 2. Localization of XRControllerModelFactory
To bypass Vite's caching mechanisms a allow direct access to internal utilities (like `fetchProfile`), we created a local copy of `XRControllerModelFactory` (`src/XRControllerModelFactory_local.js`). This file is imported by `Scene.js`.

### 3. Dynamic Reloading Pipeline
We implemented `window._reloadControllerModels` (attached to `Scene.prototype.reloadControllerModels`) utilizing the exposed internal utilities from `XRControllerModelFactory_local.js`.

**Process**:
1.  **Clear Grip**: Removes all existing generic or model children from the grip object (`renderer.xr.getControllerGrip(i)`).
2.  **Generate Proxy**: Creates a new Proxy if an override is active, or uses the original `baseSource`.
3.  **Fetch Profile**: Manually invokes `fetchProfile` with the (proxied) input source.
4.  **Instance Model**: Creates a new `XRControllerModel` and `MotionController` using the resolved profile.
5.  **Render**: Adds the newly created model to the grip and triggers a render cycle.

### 4. UI Integration
A "Controller Model Override" combobox was added to the VR Settings menu (`GuiVRSettings.js`). Selecting an option updates `window._xrControllerOverride` and triggers the reload pipeline.

## Usage
1.  Enter VR.
2.  Open the VR Settings Menu.
3.  Locate "Controller Model Override".
4.  Select the desired profile (e.g., `samsung-galaxyxr`).
5.  The model will swap dynamically!

## Files Modified
*   `src/Scene.js`: Implemented `_originalInputSource` storage, `Proxy` logic, and `_reloadControllerModels`.
*   `src/XRControllerModelFactory_local.js`: Localized factory to bypass caching and expose utils.
*   `src/gui/vr/GuiVRSettings.js`: Added controller selection UI and reload integration.
