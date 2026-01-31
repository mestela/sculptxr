# SculptXR - WebXR Sculpting

## Status
**Active Development**: This is a fork of [SculptGL](http://stephaneginier.com/sculptgl) focused on adding WebXR capabilities, specifically a VR Menu system.
(The original project is no longer actively maintained by the author).

**[Try the Live VR Build Here](https://tokeru.com/sculptxr/)** 

## Releases
- v0.6.93: **Radial Color Picker Refined**: Larger (300px), thinner ring (20px), and corrected Hue mapping (standard HSV).
- v0.6.70: **Modular VR Menu**: Major overhaul of `GuiXR`. increased resolution to 1024x1024. Added Tabs (TOOLS, SCENE, VIEW, FILES, HISTORY). Added "Add Primitive" and "Rendering Settings".
- v0.6.61: **Log Cleanup & Polish**: High-fidelity Quest Touch Plus controllers, PBR matte shading, ergonomic menu/laser offsets, and completely silent console logging.
- v0.6.50: **UX Improvement**: Moved Undo/Redo shortcuts to the **Left Controller Thumbstick** (Axis 2) to prevent accidental brush resizing.
- v0.6.49: **Fixed Symmetry Drift**: Implemented Surface-Relative Culling to prevent brushes from grabbing back-facing geometry, ensuring perfect symmetry.
- v0.6.33: **New VRLaser**: Added Red Cylinder Laser Pointer for menu interaction (Context-sensitive, only visible when pointing at menu).
- v0.6.51: **VR Controller Models**: Replaced placeholder cubes with official Oculus Touch v3 (Quest 2/3 style) models.

- v0.6.4: Fix VR Brush Lag (Cap Search Radius to 5cm Physical), Unit Correction
- v0.5.375: Fix VR Symmetry Skipping (Search Radius 4x), Revert Normal Culling
- v0.5.60: fixed desktop exposure (removed double-gamma), calibrated VR scale (100 units = 1m), fixed initial camera offset (starting position)
- v0.5.52: matcap material fix for VR, no longer rotates on head tilt
- v0.5.43: fixed move symmetry, thumbstick shortcuts, menu interaction
- v0.5.22: better symmetry, basic file IO, single grip can translate and rotate. 

![SculptGL VR Screenshot](assets/sculptgl_vr.webp)
*SculptGL running on desktop, with SculptXR running natively on a Quest 3 in foreground in AR/passthrough mode.*

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
    - Ray-casting support for UI interaction
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
    - Can't change matcaps or PBR environment (need combobox UI element)
    - Add primitives menu missing
    - Transform tool/gizmo missing
    - Lots of 'minor' UI missing (need to take an inventory of all the menu items)
    - Re-symmetrize function, choose left->right, right->left
    - Spectator Mode: Implement Desktop Mirroring for PCVR (See `docs/spectator_mode_implementation.md`)
- **UI + UX**  
    - ~~Controllers are represented with cubes, replace with something better~~ - **DONE v0.6.51**    
    - Two-handed-grip pivot point needs an overlay icon, not the current purple cube
    - Menu layout is clunky
    - Jump between passthrough (AR) and immersive (VR) modes is janky
    - UX for importing meshes is clunky (forced back into 2d mode to get standard browser import dialog)
    - Double handed grip needs work, gets hard to control when the world has been scaled too large
    - ~~**Input/Shortcuts**: Move Undo/Redo to Left Stick (User feedback: Right stick interferes with resizing)~~ - **DONE v0.6.50**
    - **Visual Feedback**: Show Voxel Grid/Boundary Box (Users report drawing out of bounds)
    - **Content**: Add Primitive shapes (Cone, Cylinder, etc) for starting



## Long Term Goals / Vision
To eventually rewrite this project so it can coexist properly with upstream SculptGL. The current VR implementation is a "hard fork" with significant divergence in the core `Scene.js` logic.

**The Dream Goal:**
- Seamless Desktop <-> VR Switching.
- A "Start XR" button in the standard desktop UI.
- Putting on the headset transitions to the VR interface (hand palette etc).
- Taking off the headset returns immediately to the desktop interface.

*Note: This likely requires a clean fork/rewrite where the VR functionality is injected as a modular "plugin" rather than replacing the core application loop.*

## Quick Start
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

## Dev Process / Background

This port/proof of concept was done using **[Google Gemini / Antigravity](https://antigravity.google/)** over a weekend. 

My day job is a 3D artist; while I can do VEX and Python OK, and read/write a little bit of JavaScript, tackling a full port like this was totally beyond me. I had a vague understanding of how this port was going to have to be broken down into steps, and it pretty much went as intended. Most of this was short bursts of time between housework and family things, I'd estimate maybe 8 hours in total. 

**Rough Timeline:**

Saturday:
- Send something, anything to VR mode.
- Deal with scale issues (SculptGL default scale is huge in VR).
- Get cubes as controller representations.
- Get basic surface interaction working (this was mildly tricky as it was essentially totally replacing SculptGL's screen-based system with VR selection/interaction).
- Get both controllers working.
- Get brush interaction stable and intuitive.
- Fix shading (was weirdly posterised; turns out it was a high dynamic range RGBE thing where 'E' was exposure, not being translated properly into VR).
- Solve world scaling and rotation (lots of iteration here).
- Brush indicator working.

Sunday:
- Menu system: lots of testing here to add a palette on one hand, port over the various buttons SculptGL uses.
- Then mild disaster as a Meta update stopped PCVR working, which meant moving to native Quest 3.
- To my surprise native Quest 3 browser worked without a hitch!
- Then got AR passthrough working (apparently a single line of code).
- Fixed shader issues with world scale (normals were being incorrectly scaled as the world scaled).

Monday evening
- Fix world scale issues again: as the world scaled, the controllers or mesh would fly away (pivots for scaling were really weird).
- Bring rest of SculptGL menus over.
- Fix Undo/Redo (needed some careful poking through the code to see how SculptGL was updating mesh states directly to the GPU).
- Tidy up, publish to github.

The actual interaction with Antigravity was pretty conversational, eg 'ok, the lighting is looking strange when i scale, as the world scales up, the colours go dark, like a gamma crush.. what could it be?' we'd interact, it would ask me to debug, report stuff from the console, it would publish a change, I'd report back.

I had one disaster when I asked it too broad a request 'ok, add menus now', it broke the codebase and took effort to restore, but now I know to be more fine grained in my requests.

I haven't dared look at the code, maybe its all AI slop. One day I'll have a closer look. I'm quietly hoping that because this works on desktop chrome webXR, and on quest 3 with no changes, it'll also work for androidXR and AVP (assuming you have controllers).

Anyway, was a fun project, I hope to find time to finish of the last few things.
