# SculptXR (v0.8.161)
WebXR Sculpting

![SculptGL VR Screenshot](assets/sculptgl_vr.webp)
*SculptGL running on desktop, with SculptXR running natively on a Quest 3 in foreground in AR/passthrough mode.*

## Overview
This is a fork of [SculptGL](http://stephaneginier.com/sculptgl) focused on adding WebXR capabilities. It is entirely done using Antigravity, sorry code purists.

Watch a demo of the Feb 4 build [here.](https://www.youtube.com/watch?v=0gq1ZNOeHDY)

Try the latest build [here!](https://tokeru.com/sculptxr/)

*   v0.8.161: Crease Tool Overhaul & Smooth VR Strokes
*   v0.8.153: VR Interaction & Stability Update
*   v0.8.18: Gray Wireframe Restore
*   v0.8.17: Smooth VR Slider Physics Fix
*   v0.8.2: VR Fuzzer
*   v0.8.1: VERSION Reference Fix
*   v0.7.801: Move Tool Symmetry Fix
*   v0.7.800: Voxel Stability & Performance Release
*   v0.7.696: Voxel Mirror Tool Symmetry Fix


[View Full Release History](docs/releases.md)


## Supported Platforms
It should work on any WebXR compatible device. So far I've tested on:
- Quest 2 and Quest 3 browser in standalone
- Google Chrome on Windows PCVR via Meta Link and Quest 3


## Todo
- In stationary mode, the controllers and menu scale when scaling the world; they should remain the same size relative to the desktop screen
-crease brush breaks symmetry
-still some topology symmetry issues
- **Functionality**:
(for post v1)
    - Voxel straight line mode
    - Voxel smooth shading
    - Voxel smooth tool
    - voxel cube brush
    - Voxel move brush (see how many of the current poly tools can be ported over)
    - voxel curves/tubes
    - Xray mode
    - Look at tricks from old Dreams demos (eg the potters wheel for painting and sculpting)
    - multiplayer

- **UI + UX** 

(for post v1) 
    - nearly time to think about tider panel
    - panel tear off/pin in place?
    - show more heads up things?
    - toolbar/shortcut bar?
    - outliner? 
    - Really need to make 100% VR native dialog, filebrowser for import/export
    - Combobox for tool needs a rethink. separate panel? Stack of most recently used tools ala zbrush?
    

## Done
- ~~Desktop 6DOF completed: Symmetry restored, tool radius scaling fixed, mouse pan/orbit restored, dual cursor shadowing isolated.~~ **DONE v0.8.124**
- ~~wireframe colour ugly, fix~~  **DONE v0.8.18** 
- ~~different undo queue length for desktop vs standalone~~ **DONE v0.8.17**    
- ~~warning if ar/vr isn't available, to try resatrting chrome (chrome needs to detect that webxr is available before launch)~~ **DONE v0.8.3**
- ~~final shakedown of runtime issues (occasional select errors, shader compile errors)~~ **DONE v0.8.3**
- ~~Show Voxel Grid/Boundary Box (Users report drawing out of bounds)~~ **DONE v0.7.800**
- ~~symmetry issues voxel remesh can't restore symmetry~~ **DONE v0.7.696**
- ~~symmetry issues, move will break symetry at center line~~ **DONE v0.7.692**
- ~~tools sphere intersect based, aim as an option in settings.~~ **DONE v0.7.690**
- ~~fix two handed grip scale misalignment.~~ **DONE v0.7.687**
- ~~Transform tool/gizmo missing~~ **DONE v0.7.644**
- ~~menus dont appear if scroll is low~~ - **DONE v0.7.493**
- ~~brush circle incorrectly oriented before first stroke~~ - **DONE v0.7.443**
- ~~Twist brush occasional console error~~ - **DONE v0.7.443**
- ~~Re-symmetrize function, choose left->right, right->left~~ - **DONE v0.7.434**
- ~~Drag and move tools should support 6dof rotation~~ - **DONE v0.7.443**
- ~~Crease in sub mode should pull out a crease~~ - **DONE v0.7.434**
- ~~Combobox for tool has misaligned highlight~~
- ~~Matcap misaligned; its upside down and slightly different in left/right eyes~~ - **DONE v0.7.429**
- ~~Drag on empty space of menu panel should scroll~~ - **DONE v0.7.429**
- ~~Trigger on left controller should always activate 'sub' mode~~ - **DONE v0.7.423**
- ~~Left handed mode~~ - **DONE v0.7.416**
- ~~Dynamic Topology (code path is active, but not working, unsure why)~~
- ~~Multiresolution not yet supported in VR~~
- ~~Add primitives menu missing~~
- ~~Symmetry for voxel tool~~ - **DONE v0.7.381**
- ~~Twist brush VR support (Drill Mode)~~ - **DONE v0.7.389**
- ~~Spectator Mode: Implement Desktop Mirroring for PCVR~~ - **DONE v0.6.293** (See `docs/feature_desktop_6dof.md`)
- ~~Drag tool not working correctly with symmetry~~ - **Stabilized v0.7.118**
- ~~Reference image support~~ - **Working v0.7.118**
- ~~Desktop mode with 6dof controllers! That should be possible to hack together!~~ **DONE v0.7.0**
- ~~Grab brush~~ - **DONE v0.7.118**
- ~~Voxel add, sub, inflate, deflate brushes~~ - **DONE v0.7.360**
- ~~Voxel Resampling~~ - **Stabilized v0.7.369**
- ~~Voxel Bake~~ - **DONE v0.7.360**
- ~~Voxel symmetry~~ - **DONE v0.7.360**
- ~~Voxel undo/redo~~ - **DONE v0.7.360**
- ~~Default move brush size is too big~~
- ~~Menu layout is clunky, but covers all desktop options now. slowly adding functionality.~~ - **Refined v0.7.401**
- ~~Default smooth strength too high~~
- ~~Sphere radius indicator too prominent; should be fresnel effect so you only percieve the edges~~
- ~~Trigger on left controller should invoke sub mode~~
- ~~Menus currently need a click to close, then a click to open the next one. A click on another menu should hide the current, show the next straight away.~~ - **DONE**
- ~~Double handed grip needs work, gets hard to control when the world has been scaled too large~~ - **Improved v0.7.118**
- ~~Controllers are represented with cubes, replace with something better~~ - **DONE v0.6.51**    
- ~~**Input/Shortcuts**: Move Undo/Redo to Left Stick (User feedback: Right stick interferes with resizing)~~ - **DONE v0.6.50**
- ~~idea! calibrate/adjust with grip controls. press C, go into 'move me' mode. normally grips move the world, controllers stay static in the view. in this mode, the world stays still, you move the controllers. tap C to exit out, now you're good to go.~~ **DONE v0.7.6**
- ~~Desktop mode is proof-of-concept; needs adjusting to feel comfortable (simulated seated view).~~ **DONE v0.7.0**

## Clear Browser Cache
When testing and freqently updating the project, I found Chrome on desktop and the Chrome derived browser on the Quest 3 love to cache JS files. 

There might be better ways, but here's what I do to ensure the build is clean, nothing is cached:

### Desktop Chrome

1. R.click on the page, Inspect
2. Network tab, 'Disable Cache' toggle, turn it on.

![Console Network](assets/console_network.jpg)

3. Application tab, Storage, 'Clear site data'

![](assets/console_application.jpg)

If the Inspect tab doesn't have enough room, the Network or Applications tab might be under the >> button in the top bar.

![](assets/console_hidden.jpg)

### Quest 3 browser

- Click the 3 dots button in the top right of the browser
- Clear Browsing Data
- Clear Data


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
