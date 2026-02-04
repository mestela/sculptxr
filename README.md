# SculptXR - WebXR Sculpting

![SculptGL VR Screenshot](assets/sculptgl_vr.webp)
*SculptGL running on desktop, with SculptXR running natively on a Quest 3 in foreground in AR/passthrough mode.*

## Overview
**Active Development**: This is a fork of [SculptGL](http://stephaneginier.com/sculptgl) focused on adding WebXR capabilities. It is entirely done using Antigravity, sorry code purists.

**[Try the Live VR Build Here](https://tokeru.com/sculptxr/)** 

> [!NOTE]
> **WIP**: The VR Interface is a Work In Progress. Not all menus and UI elements from the desktop version are fully functional or present in VR yet. We are actively porting them over. 

## Releases
- v0.6.238: **Move Tool Polish**: Enabled Air Mode (move without surface intersection) and fixed radius scaling to match other tools.
- v0.6.220: **VR Brush Alignment**: Implemented Ray-based Picking (Laser) for precise brush positioning. Brush cursor now aligns perfectly with the controller's aim direction.
- v0.6.219: **Final Polish**: Log cleanup and version hardening.
- v0.6.218: **VR Brush Visuals**: Fixed Surface Radius Circle visibility (moved to RenderVR Pass 2).
- v0.6.93: **Radial Color Picker Refined**: Larger (300px), thinner ring (20px), and corrected Hue mapping (standard HSV).
- v0.6.70: **Modular VR Menu**: Major overhaul of `GuiXR`. increased resolution to 1024x1024. Added Tabs (TOOLS, SCENE, VIEW, FILES, HISTORY). Added "Add Primitive" and "Rendering Settings".
- v0.6.61: **Log Cleanup & Polish**: High-fidelity Quest Touch Plus controllers, PBR matte shading, ergonomic menu/laser offsets, and completely silent console logging.
- v0.6.50: **UX Improvement**: Moved Undo/Redo shortcuts to the **Left Controller Thumbstick** (Axis 2) to prevent accidental brush resizing.
- v0.6.49: **Fixed Symmetry Drift**: Implemented Surface-Relative Culling to prevent brushes from grabbing back-facing geometry, ensuring perfect symmetry.
- v0.6.33: **New VRLaser**: Added Red Cylinder Laser Pointer for menu interaction (Context-sensitive, only visible when pointing at menu).
- v0.6.51: **VR Controller Models**: Replaced placeholder cubes with official Oculus Touch v3 (Quest 2/3 style) models.

- v0.6.153: **VR Menu Defaults**: Configured menu to launch with 'Sculpting & Painting' expanded, while 'Rendering' and 'Topology' are collapsed to reduce clutter.
- v0.6.152: **VR Slider Fixes**: Fully functional Radius and Intensity sliders. Fixed detachment between menu state and VR cursor size.
- v0.6.150: **Architecture**: Fixed stale widget caching in VR Menu.

- v0.6.218: **VR Brush Visuals**: Fixed Surface Radius Circle visibility (moved to RenderVR Pass 2), added platform-specific offsets for correct brush positioning on PCVR and Standalone.
- v0.6.4: Fix VR Brush Lag (Cap Search Radius to 5cm Physical), Unit Correction
- v0.5.375: Fix VR Symmetry Skipping (Search Radius 4x), Revert Normal Culling
- v0.5.60: fixed desktop exposure (removed double-gamma), calibrated VR scale (100 units = 1m), fixed initial camera offset (starting position)
- v0.5.52: matcap material fix for VR, no longer rotates on head tilt
- v0.5.43: fixed move symmetry, thumbstick shortcuts, menu interaction
- v0.5.22: better symmetry, basic file IO, single grip can translate and rotate. 



## Supported platforms
It should work on any WebXR compatible device. So far I've tested on

- Quest 2 native browser
- Quest 3 native browser
- Google Chrome on Windows PCVR via Meta Link and Quest 3


## Features
- **Core VR/AR**:
    - Render ported to webXR
    - Works in PCVR (accessible via Meta Link/Air Link).
    - **Native Quest 2/3 Support**: Includes AR Passthrough mode (select it from the view menu, there's a noticable pause/glitch when it swaps)

- **v0.6.55** (Beta)
    - Fix: Resolved "Cannot read properties of null (reading 'length')" error during PLY loading.
    - Fix: Reordered `mesh.init()` before `mesh.setShaderType()` in `Scene.js` to ensure normals are computed before buffer updates.
    - Fix: Comprehensive Cache Busting (`?v=0.6.55`) for all modules in `importmap`.
    - Robustness: `ImportPLY.js` now handles both String and Buffer input and protects against null `vertices`/`faces`.
- **v0.6.54** (Beta)
    - Fix: Switched to ASCII PLY format to resolve binary parsing issues in `ImportPLY.js`.
    - Note: Binary PLY was failing with "Cannot read properties of null (reading 'length')" inside `ImportPLY` logic (likely `readHeader` or `ab2str` edge cases). ASCII is robust.
- **v0.6.53** (Beta)
    - Feature: Switch to PLY format for VR controllers (robust binary loading).
    - Pipeline: `convert_controllers.py` now exports PLY.
- **v0.6.52** (Beta)
    - Fix: Corrected URL path for VR controller models (`src/resources` vs `resources`).
    - Fix: Enhanced failure logging for controller loading.
    - Fix: Cache-busting for core JS modules to ensure updates propagate.
    - Cleanup: Removed spammy 'Ray Fail' logs.
- **v0.6.184** (Beta)
    - **VR Common Section**: Added 'Symmetry' and 'Continuous' controls to VR Sculpting Tools.
    - **Parity**: 'Sculpting & Painting' panel now matches Desktop functionality (Tools, Alpha, Common).
- **v0.6.51** (Beta)
    - Feature: Automated Oculus Controller Model Loading (OBJ).
    - Pipeline: `fetch_controllers.sh` and `convert_controllers.py`.

- **v0.6.61**:
    - **Controllers**: Polished Quest 3 Touch Plus models with smooth normals and PBR matte shading.
    - **UX**: Offset VR Menu (3cm Up/Right) for better button visibility.
    - **UX**: Offset Laser Pointer (1cm) to prevent mesh intersection.
    - **DX**: Silenced all high-frequency console logs for cleaner debugging.
- **v0.6.55** (Beta)
    - **Two-Handed Navigation**:
        - Single Grip: Translate world, rotate around controller
        - Double Grip: Scale and Rotate world from midpoint of controllers
    - Two-Handed Navigation:
        - Single Grip: Translate world, rotate around controller
        - Double Grip: Scale and Rotate world from midpoint of controllers
    - **Ray-casting Picking**: Precise brush alignment using laser pointer (v0.6.220)
    - Thumbstick left/right for undo/redo, up/down for brush size
    - Thumbstick left/right for undo/redo, up/down for brush size
- **Sculpting & Rendering**:
    - Most brushes are fully functional
    - Undo/Redo supported
    - Rendering modes: Matcap, PBR, Wireframe, Flat Shading (Desktop/VR Exposure matched)
    - Brush Indicator (Cursor) restored in VR
    - Correct World Scale (1.0 = 1 meter) & Comfortable Initial Camera Position
    - Symmetry (Fixed "Skipping" issues)
    - Export OBJ (will save to Downloads)
    - Import OBJ (will jump out of fullscreen mode and open a file browser)
    - **Voxel Sculpting**: Voxel Tool with additive/subtractive support and Undo/Redo.

## Todo
- **Functionality**:
    - Dynamic Topology (code path is active, but not working, unsure why)
    - Multiresolution not yet supported in VR
    - ~~Can't change matcaps or PBR environment (need combobox UI element)~~
    - Add primitives menu missing
    - Transform tool/gizmo missing
    - ~~Lots of 'minor' UI missing (need to take an inventory of all the menu items)~~
    - Re-symmetrize function, choose left->right, right->left
    - Spectator Mode: Implement Desktop Mirroring for PCVR (See `docs/spectator_mode_implementation.md`)
    - Drag tool not working correctly with symmetry
    - Reference image support
    - Look at tricks from old Dreams demos (eg the potters wheel for painting and sculpting)
    - Desktop mode with 6dof controllers! That should be possible to hack together!
- **UI + UX**  
    - ~~Controllers are represented with cubes, replace with something better~~ - **DONE v0.6.51**    
    - Two-handed-grip pivot point needs an overlay icon, not the current purple cube
    - Menu layout is clunky, but covers all desktop options now. slowly adding functionality.
    - Jump between passthrough (AR) and immersive (VR) modes is janky
    - UX for importing meshes is clunky (forced back into 2d mode to get standard browser import dialog)
    - Double handed grip needs work, gets hard to control when the world has been scaled too large
    - ~~**Input/Shortcuts**: Move Undo/Redo to Left Stick (User feedback: Right stick interferes with resizing)~~ - **DONE v0.6.50**
    - **Visual Feedback**: Show Voxel Grid/Boundary Box (Users report drawing out of bounds)
    - ~~**Content**: Add Primitive shapes (Cone, Cylinder, etc) for starting~~
    - Matcap misaligned; its upside down and slightly different in left/right eyes
    - Default move brush size is too big
    - Sphere radius indicator too prominent; should be fresnel effect so you only percieve the edges
    - Trigger on left controller should invoke sub mode
    - Drag on empty space of menu panel should scroll
    - Combobox for tool has misaligned highlight
    - Combobox for tool too slow; revert back to button panel i think
    - Default smooth strength too high
    - Menus currently need a click to close, then a click to open the next one. A click on another menu should hide the current, show the next straight away.
    

## Quick Start

Note that these instructions are for SculptGl, not sculptXR. I'm not using this, I'm just sending static files to my website atm.

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

