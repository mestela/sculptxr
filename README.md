# SculptXR - WebXR Sculpting

![SculptGL VR Screenshot](assets/sculptgl_vr.webp)
*SculptGL running on desktop, with SculptXR running natively on a Quest 3 in foreground in AR/passthrough mode.*

## Overview
This is a fork of [SculptGL](http://stephaneginier.com/sculptgl) focused on adding WebXR capabilities. It is entirely done using Antigravity, sorry code purists.

Try the latest build [here!](https://tokeru.com/sculptxr/)

Watch a demo of the Feb 4 build [here!](https://www.youtube.com/watch?v=0gq1ZNOeHDY)

The VR Interface is a Work In Progress. Not all menus and UI elements from the desktop version are fully functional or present in VR yet. We are actively porting them over. 

## Supported Platforms
It should work on any WebXR compatible device. So far I've tested on:
- Quest 2 native browser
- Quest 3 native browser
- Google Chrome on Windows PCVR via Meta Link and Quest 3

## Releases

- **v0.7.35**: **Desktop Preview Polish**:
    - **Feature**: Full "Desktop Preview" for VR Menu (Shift-Alt-V).
    - **Fix**: Resolved "phantom" highlighting where background tabs would light up or click through the overlay menu.
    - **Fix**: Polished hover states for overlay buttons (white border, brightness boost).
    - **Fix**: Removed debug logs for a cleaner console experience.

- **v0.7.33**: **Desktop Overlay Click Block**:
    - **Fix**: Applied the same spatial blocking to **clicks** that was applied to hovers. This prevents clicking "background tabs" (like About & Help) through the overlay menu when buttons overlap.

- **v0.7.32**: **Desktop Overlay Log Cleanup**:
    - **Cleanup**: Removed spammy debug logs (`[GuiXR] Map: ...`) to keep the console clean for VR testing.

- **v0.7.31**: **Desktop Overlay Spatial Fix**:
    - **Fix**: Re-enabled tab highlighting when the overlay is open, BUT only if the cursor is *outside* the overlay menu bounds. This allows you to select tabs if the menu is not covering them, but prevents accidental tab clicks when interacting with the menu.

- **v0.7.30**: **Desktop Overlay Tab Collision Fix**:
    - **Fix**: Disabled background tab highlighting while the overlay menu is open. This prevents "phantom" highlights on tabs (like "About & Help") when hovering over overlay buttons that sit visually on top of the tab area.

- **v0.7.29**: **Desktop Overlay Polish**:
    - **Fix**: Removed valid-but-distracting gray borders from un-hovered overlay buttons.
    - **Fix**: Ensured main tab highlights are cleared when interacting with the overlay menu (fixed stale "About & Help" highlight).

- **v0.7.28**: **Desktop Overlay Highlight Final**:
    - **Fix**: Finalized the robust highlighting logic (fixed previous update failure). Border is now drawn last to ensure visibility.

- **v0.7.27**: **Desktop Overlay Robust Highlight**:
    - **Fix**: Adjusted overlay highlighting z-order to ensure buttons and comboboxes don't obscure the selection. Added a clean white border on top of all hovered items.

- **v0.7.26**: **Desktop Overlay Green Highlight**:
    - **Debug**: Changed overlay hover highlight to bright GREEN to make it obvious if it's working or not.

- **v0.7.25**: **Desktop Overlay Reference Fix**:
    - **Fix**: Declared `hitWidget` variable to prevent ReferenceError in debug logs.

- **v0.7.24**: **Desktop Overlay Syntax Final**:
    - **Fix**: Finally fixed the syntax error in `GuiXR.js` (removed premature closing brace).

- **v0.7.23**: **Desktop Overlay Brace Fix**:
    - **Fix**: Resolved another syntax error (premature closing brace) in `GuiXR.js`.

- **v0.7.22**: **Desktop Overlay Syntax Fix**:
    - **Fix**: Resolved syntax error caused by stray code in the previous debug patch.

- **v0.7.21**: **Desktop Overlay Debug**:
    - **Debugging**: Added logs to `_updateOverlayHover` to trace hit testing math for overlay widgets.

- **v0.7.20**: **Desktop Highlight Fix**:
    - **Fix**: Added a render loop to `togglePreview` to ensure the GUI redraws when hover states change (since the main VR loop might not be running or updating GuiXR in desktop mode).

- **v0.7.19**: **Desktop Coord Fix Retry**:
    - **Fix**: Re-applied the coordinate fix (previous attempt failed to patch). Now correctly passing normalized coordinates to `setCursor`.

- **v0.7.18**: **Desktop Coord Fix**:
    - **Fix**: Removed double multiplication of coordinates in Desktop Preview. `setCursor` already scales by canvas size, so we now pass normalized coordinates.

- **v0.7.17**: **Desktop Debug Rect**:
    - **Debugging**: Added logs to `mapEventToPixels` to check `getBoundingClientRect()` values.

- **v0.7.16**: **Desktop Input Fix**:
    - **Fix**: Hardcoded canvas size for Desktop Preview input mapping to avoid issues with high-DPI displays or renderer resizing.

- **v0.7.15**: **Desktop Fix 2**:
    - **Fix**: Resolved `ReferenceError` preventing debug logs from working in Desktop Preview.

- **v0.7.14**: **Desktop Tracing**:
    - **Debugging**: Added verbose logs to `onInteract` to diagnose why clicks might be ignored in Desktop Preview.

- **v0.7.13**: **Desktop Debug Fix**:
    - **Fix**: Corrected control flow in `onInteract` which was preventing Tab and Widget interaction in Desktop Preview mode.

- **v0.7.12**: **Desktop Debug Logs**:
    - **Debugging**: Added console logs to `Shift-Alt-V` input to trace why mouse interaction might be failing.

- **v0.7.11**: **Desktop Menu Debug**:
    - **Debugging**: Fixed `Shift-Alt-V` preview mode to correctly handle mouse input, allowing easy testing of VR menus on desktop.

- **v0.7.10**: **Menu Input Priority**:
    - **Fix**: Clicking a menu button that overlaps a Tab Header now correctly triggers the button instead of switching the tab.

- **v0.7.9**: **Menu Hover Fix**:
    - **Highlight Stability**: Fixed an issue where menu buttons could stay highlighted when moving quickly between them.

- **v0.7.8**: **VR Menu Polish**:
    - **Toggle-to-Close**: Clicking the active menu tab (e.g. "Files") while open will now close it.
    - **Hover Focus**: Top Menu Tabs will now highlight when hovered, even if a menu dropdown is currently open.

- **v0.7.7**: **VR Menu Flow**:
    - **Fast Switching**: Clicking a Top Menu Tab now instantly opens it, even if another menu is already open (no longer need to click "Back" or empty space first).
    - **Cleanup**: Improved overlay closing logic.

- **v0.7.6**: **Controller Calibration Mode**: [Read the Feature Guide](docs/feature_desktop_6dof.md)
    - **Move Me**: Press 'C' to toggle Calibration Mode.
    - **Grip & Drag**: Hold grip to move the Spectator Camera relative to the world.
    - **Twist**: Hold grip and twist to rotate the Spectator Camera.
    - **Visuals**: Sculpt mesh hides automatically during calibration for a clearer view.
    - **Decoupled**: Calibration only affects the Spectator View; VR Headset view remains 1:1.

- **v0.7.0**: **Desktop 6DOF (Spectator Mode)**: [Read the Feature Guide](docs/feature_desktop_6dof.md)
    - **Desktop Mode**: Simulated "Seated" view for non-VR users.
    - **Parity Render**: Desktop view now renders exact same tools/mesh as VR (Solved "Missing Controller" bug).
    - **Zero Offset**: Desktop camera is rotated 180° to provide a stable "Seated" view of the sculpture.
    - **Sphere Depth**: Brush cursor now properly intersects with the mesh (enabled Depth Test).
    - **WebGL 1 Compatibility**: Restored support for older devices/browsers.

- **v0.6.238**: **Move Tool Polish**: Enabled Air Mode (move without surface intersection) and fixed radius scaling to match other tools.
- **v0.6.220**: **VR Brush Alignment**: Implemented Ray-based Picking (Laser) for precise brush positioning. Brush cursor now aligns perfectly with the controller's aim direction.
- **v0.6.219**: **Final Polish**: Log cleanup and version hardening.
- **v0.6.218**: **VR Brush Visuals**: Fixed Surface Radius Circle visibility (moved to RenderVR Pass 2), added platform-specific offsets for correct brush positioning on PCVR and Standalone.

- **v0.6.184**: **VR Common Section**: 
    - Added 'Symmetry' and 'Continuous' controls to VR Sculpting Tools.
    - **Parity**: 'Sculpting & Painting' panel now matches Desktop functionality (Tools, Alpha, Common).

- **v0.6.153**: **VR Menu Defaults**: Configured menu to launch with 'Sculpting & Painting' expanded, while 'Rendering' and 'Topology' are collapsed to reduce clutter.
- **v0.6.152**: **VR Slider Fixes**: Fully functional Radius and Intensity sliders. Fixed detachment between menu state and VR cursor size.
- **v0.6.150**: **Architecture**: Fixed stale widget caching in VR Menu.

- **v0.6.93**: **Radial Color Picker Refined**: Larger (300px), thinner ring (20px), and corrected Hue mapping (standard HSV).
- **v0.6.70**: **Modular VR Menu**: Major overhaul of `GuiXR`. increased resolution to 1024x1024. Added Tabs (TOOLS, SCENE, VIEW, FILES, HISTORY). Added "Add Primitive" and "Rendering Settings".

- **v0.6.61**: **Log Cleanup & Polish**: 
    - **Controllers**: Polished Quest 3 Touch Plus models with smooth normals and PBR matte shading.
    - **UX**: Offset VR Menu (3cm Up/Right) for better button visibility.
    - **UX**: Offset Laser Pointer (1cm) to prevent mesh intersection.
    - **DX**: Silenced all high-frequency console logs for cleaner debugging.

- **v0.6.55**: **Navigation & Robustness**:
    - **Two-Handed Navigation**: Single Grip to translate/rotate; Double Grip to scale/rotate from midpoint.
    - **Fix**: Resolved "Cannot read properties of null (reading 'length')" error during PLY loading.
    - **Fix**: Reordered `mesh.init()` to ensure normals are computed before buffer updates.
    - **Fix**: Comprehensive Cache Busting (`?v=0.6.55`) for all modules in `importmap`.
    - **Robustness**: `ImportPLY.js` now handles both String and Buffer input/

- **v0.6.54**: **ASCII PLY**: Switched to ASCII PLY format to resolve binary parsing issues in `ImportPLY.js`.
- **v0.6.53**: **PLY Controllers**: Switch to PLY format for VR controllers (robust binary loading).
- **v0.6.52**: **Build Fixes**: Corrected URL path for VR controller models and enhanced failure logging.

- **v0.6.51**: **VR Controller Models**: 
    - Replaced placeholder cubes with official Oculus Touch v3 (Quest 2/3 style) models.
    - Automated loading via `fetch_controllers.sh` and `convert_controllers.py` (OBJ/PLY).

- **v0.6.50**: **UX Improvement**: Moved Undo/Redo shortcuts to the **Left Controller Thumbstick** (Axis 2) to prevent accidental brush resizing.
- **v0.6.49**: **Fixed Symmetry Drift**: Implemented Surface-Relative Culling to prevent brushes from grabbing back-facing geometry, ensuring perfect symmetry.
- **v0.6.33**: **New VRLaser**: Added Red Cylinder Laser Pointer for menu interaction (Context-sensitive, only visible when pointing at menu).
- **v0.6.4**: **Latency**: Fix VR Brush Lag (Cap Search Radius to 5cm Physical), Unit Correction.

- **v0.5.x**: **Foundation**:
    - v0.5.375: Fix VR Symmetry Skipping (Search Radius 4x).
    - v0.5.60: Fixed desktop exposure, calibrated VR scale (100 units = 1m).
    - v0.5.52: Matcap material fix for VR.
    - v0.5.43: Fixed move symmetry, thumbstick shortcuts.
    - v0.5.22: Basic file IO, single grip navigation.

- **v0.1.0**: **Initial Port**:
    - Render ported to WebXR.
    - PCVR and Native Quest 2/3 Support (with AR Passthrough).

## Todo
- **Functionality**:
    - Dynamic Topology (code path is active, but not working, unsure why)
    - Multiresolution not yet supported in VR
    - Add primitives menu missing
    - Transform tool/gizmo missing
    - Re-symmetrize function, choose left->right, right->left
    - ~~Spectator Mode: Implement Desktop Mirroring for PCVR~~ - **DONE v0.6.293** (See `docs/feature_desktop_6dof.md`)
    - Drag tool not working correctly with symmetry
    - Drag and move support rotation
    - Reference image support
    - Look at tricks from old Dreams demos (eg the potters wheel for painting and sculpting)
    - ~~Desktop mode with 6dof controllers! That should be possible to hack together!~~ **DONE v0.7.0**
    - Symmetry for voxel brush
- **UI + UX**  
    - ~~Controllers are represented with cubes, replace with something better~~ - **DONE v0.6.51**    
    - Two-handed-grip pivot point needs an overlay icon, not the current purple cube
    - Menu layout is clunky, but covers all desktop options now. slowly adding functionality.
    - Jump between passthrough (AR) and immersive (VR) modes is janky
    - UX for importing meshes is clunky (forced back into 2d mode to get standard browser import dialog)
    - Double handed grip needs work, gets hard to control when the world has been scaled too large
    - ~~**Input/Shortcuts**: Move Undo/Redo to Left Stick (User feedback: Right stick interferes with resizing)~~ - **DONE v0.6.50**
    - **Visual Feedback**: Show Voxel Grid/Boundary Box (Users report drawing out of bounds)
    - Matcap misaligned; its upside down and slightly different in left/right eyes
    - Default move brush size is too big
    - Sphere radius indicator too prominent; should be fresnel effect so you only percieve the edges
    - Trigger on left controller should invoke sub mode
    - Drag on empty space of menu panel should scroll
    - Combobox for tool has misaligned highlight
    - Combobox for tool too slow; revert back to button panel i think
    - Default smooth strength too high
    - Menus currently need a click to close, then a click to open the next one. A click on another menu should hide the current, show the next straight away.
    - Trigger on left controller should activate 'sub' mode (and change colour of circle radius indicator)

- **Desktop 6DOF (Beta Issues)**:
    - ~~Desktop mode is proof-of-concept; needs adjusting to feel comfortable (simulated seated view).~~ **DONE v0.7.0**
    - Symmetry behaves strangely in desktop mode (investigate).
    - Tools should work based on Sphere Radius intersection 'hit' (currently relies heavily on Ray direction).
    - Should re-enable mouse controls to adjust the screen offset, eaier than using the consoel commands. Also just standard desktop mode should be able to work too. Maybe D can takeover the desktop view with the VR view, disable all the desktop UI, D again re-enables the desktop UI, stops the VR view being sent to desktop.
    - ~~idea! calibrate/adjust with grip controls. press C, go into 'move me' mode. normally grips move the world, controllers stay static in the view. in this mode, the world stays still, you move the controllers. tap C to exit out, now you're good to go.~~ **DONE v0.7.6**

## Quick Start
Note that these instructions are for SculptGl, not SculptXR. I'm just sending static files to my website atm.

1. Install dependencies:
   ```bash
   yarn
   ```
2. Run development server:
   ```bash
   yarn dev
   ```
3. Visit `http://localhost:8000` (or the URL provided).

Alternatively, you can use Python for a simple static server if you have built the source or are running pre-built files:
```bash
python3 -m http.server 8000
```

## Original Project Resources
- Live Demo: [stephaneginier.com/sculptgl](http://stephaneginier.com/sculptgl)
- Website: [stephaneginier.com](http://stephaneginier.com/)

## Tools
Node.js is required.

### Standalone Build
```bash
yarn add electron
yarn add electron-packager
yarn standalone
```

## Credits
- Original SculptGL by [Stéphane Ginier](http://stephaneginier.com/).
- Raw environments from [HDRI Haven](https://hdrihaven.com/hdris).
