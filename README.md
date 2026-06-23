# SculptXR (v3.3.0)

WebXR Sculpting

![SculptGL VR Screenshot](assets/sculptxr_ar.jpg)
<br>*SculptXR running natively on a Quest 3 in AR/passthrough mode.*

## Overview
This is a fork of [SculptGL](http://stephaneginier.com/sculptgl) focused on adding WebXR capabilities. It is entirely done using Antigravity, sorry code purists.

Watch a demo of the Feb 27 build [here.](https://www.youtube.com/watch?v=h7nVgpOmaXs)

Try the latest build [here!](https://tokeru.com/sculptxr/)

*   **v3.3.0**: **Outliner overhaul**: a density + interaction pass on the Scene-tab outliner (desktop + VR) — the mesh list flows compactly instead of reserving a big block, lock moved to a toolbar padlock and mirror folded into the rig row, per-component bake buttons inline with each Pos/Rot/Scale row, typed transform edits are now undoable, the VR numpad parents to the panel, and deleting an object no longer blanks the controls.
*   **v3.2.0**: **Detailing at scale**: a sweep of fixes for working zoomed-in on fine detail in VR — brushes no longer over-reach their radius, the cursor/strokes stay on the surface and depth precision tracks the grip-scale, matcap shading is fixed under non-uniform scale and no longer flips/shimmers when rotating, and the brush cursor stops flipping depth. Plus a maintain-length mode for the Pose tool (A button) and a clean-up of mirror-eye deletion.
*   **v3.1.0**: **Posing in VR**: a new **Pose** tool — drop two anchors on the surface (A locked, B moved) and bend the band between them with a 6DOF controller grab (the limb rides your hand as a single bone). Built on a new on-mesh geodesic distance engine; supports X-symmetry and bounds a short corridor to the limb instead of flooding the whole side. First step of the rigging/posing track.
*   **v3.0.0**: **Rigging & performance-capture foundations**: a full ARKit blendshape pipeline (52-shape name library, symmetric split/combine), an eye rig (look-at + saccades + mirror socket), bake/freeze transforms, and a live outliner transform inspector — all on the parent-aware scene hierarchy.
*   **v2.9.9**: **Eye-rig foundation + fixes**: scene-hierarchy Phase 0 — meshes can be parented and still sculpt/move/gizmo correctly in VR (parent-aware picking + transform tools). Also fixes a long-standing duplicate "ghost" transform gizmo in VR.
*   **v2.9.0**: **Blendshape panel polish**: per-layer lock (Photoshop-style) with the Base cage locked by default (can't accidentally sculpt/corrupt the cage), hover highlights across the panel rows + timeline channel gutter, and a half-size VR panel (canvas px + plane both halved, so elements stay the same physical size).
*   **v2.8.1**: **Blendshape data-safety**: a corruption backstop that refuses to write a layer's delta unless it's at weight 1 (catches stroke paths the start() gate misses), plus Backup/Restore Shapes buttons in the VR Settings menu (undo-independent safety net, now reachable standalone).
*   **v2.8.0**: **Blendshape layer-stack panel**: a Photoshop/Nomad-style canvas UI for blendshapes (desktop sidebar tab + VR floating panel), replacing the old HTML section. Click-to-activate rows, always-live weight sliders, per-layer mute (eye) and solo, correct multi-layer delta capture, and panel↔timeline sync. Hardened blendshape data safety (base-rebase corruption guard + `bsBackup`/`bsRestore`). VR panels are grip-movable with hover-highlighted corner close buttons.
*   **v2.7.0**: **VR Crease overhaul**: depth-independent surface-walking anchor fixes the long-standing crease wobble/gallop/waves (the brush now walks the surface and ignores how far off-surface the controller tip drifts), VR strokes are framerate-invariant again (per-distance, not per-frame), and crease default intensity lowered to 0.4. Also fixes a `<head>` script load-order bug that was silently disabling two iPad fixes.
*   **v2.6.0**: **Fix**: Sculpting stability — standard brushes no longer accumulate blocky/terraced artifacts (and large brushes stay even). An earlier voxel optimization had frozen the mesh octree during a stroke, so the brush's vertex query went stale and dropped most of its vertices; reconnected the incremental octree update. Also steadier in VR.
*   **v2.5.0**: **iPad parity & QA** (Stéphane Ginier feedback): undo fixes (launch/delete/buttons/counts), full iPad mesh-edit + finger-gesture overhaul, background reimplemented (image + HDRI skybox + ambient, exposure/blur), reference images as first-class outliner meshes (transform/hide/show/undo), and broad desktop/iPad cleanup.
*   **v2.4.0**: **Fix**: VR-native confirm dialog (Clear All Animation now interactable in-headset), timeline edge-drag latch (blendshape weights reach 0.0 past the panel edge), and removed the blendshape-name scrub hint.
*   **v2.3.0**: **Perf**: VR UI performance & interaction polish — hidden HTML panels no longer re-rasterise (smooth idle + slider drags), fixed wrist-panel slider dragging, flicker-free panel swaps, throttled scrolling with working draggable scrollbars, and faster thumbstick scroll.
*   **v2.0.6**: **Feature**: Timeline & animation editor overhaul — graph-editor transform box for all key types, curve-click select + hover highlight, header Frame/Value fields with relative expressions, channel solo, two-handed VR zoom, VR numpad with +/−/= , blendshape overshoot, and persisted panel size / mode.
*   **v2.0.4**: **Fix**: SpinEdge lock-up after repeated spins, Extrude double-fire on iPad, and hard-edge normals after extrude in smooth shading.
*   **v2.0.3**: **Fix**: iPad Apple Pencil / touch overhaul — pan speed, zoom stability, back-face stamping, 2/3-finger undo/redo gestures, timeline layout, Scribble prevention.
*   **v2.0.0**: **Feature**: Complete UI overhaul — HTML VR panels replacing yagui, panel tear-off, VR timeline panel, blendshapes, animation rebuild, laser pointer rewrite.
*   **v1.0.224**: **Feature**: Graph Editor Visibility in Fit View, Time Fitting in VR, Shape Key Hover/Selection, and critical bug fixes for NaN errors and overlap.

[View Full Release History](docs/releases.md)

## Supported Platforms
It should work on any WebXR compatible device. So far I've tested on:
- Quest 2 and Quest 3 browser in standalone
- Google Chrome on Windows PCVR via Meta Link and Quest 3

## Instructions
### Basics
Press the 'Enter VR' button. If you're on a device that supports passthrough, press the 'Enter AR' button.

The right controller is the primary sculpting tool. The left controller contains a mini menu to change tool, radius, intensity, negative mode, toggle wireframe.

Right trigger will sculpt. Holding down left trigger while using right trigger will smooth.

The A button will engage 'negative' mode, so a brush build up will become a brush carve for example.

The X button will launch the full VR Menu.

Pushing the left controller thumbstick left/right will undo/redo.

Pushing the right controller thumbstick up/down will change radius.

Grip controls should work as expected, single grip will rotate/translate, both grip controls will scale the world.

Saving and loading will often pop up a dialog in non-vr mode. If you choose an option and see nothing, tap the meta button to drop back into 2d mode, you'll probably find a file dialog waiting for you.

If you're left handed, you can swap the controllers from the **Settings** menu.

### Voxels

In the tool combobox is a Voxel tool. This is a basic 'air draw toothpaste in 3d' tool like Adobe Medium, it has a sub palette of 4 modes, add, sub, inflate, deflate. It also lets you change the voxel resolution, and 'bake to mesh' will convert the voxel to regular polygons for further sculpting.

### Desktop spectator mode

If running on PCVR, the desktop will be in a spectator mode. It is a live preview of your sculpt from a stationary camera. You can move this camera with the regular mouse/tablet controls, and use the desktop sculpting tools. This means if there are certain operations easier to do in desktop, you can swap between them easily.

In the desktop UI under Camera -> Spectator mode, you can decide how the desktop mode should behave:

- **VR View (Mirror)** - a direct mirror of the VR view.
- **Desktop** - the standard view, a stationary view that can be controlled independantly of the VR view
- **Tracked** - A hybrid of VR View and desktop; it will match the orientation and scale of the VR View, but can be offset, and because it doesn't inherit translation, isn't as jittery or motion sickness inducing. Good for demos, working with a general audience.
- **Stationary (6DOF)** - Inspired by Dreams on the Playstation, this mode lets you use 6dof controllers with your monitor. More details below.

### Stationary (6DOF) Dreams mode
Before starting, cover the light sensor in the quest headset with something opaque (it's inside the headset between the lenses). 

Start SculptXR, Enter VR. Now remove the headset, and place it on your desk facing you. Make sure its slightly off the edge of the desk so that the lower fisheye cameras can see the floor.

Select Stationary (6DOF) from the Camera -> Spectator on desktop, sit back at least 50cm from the headset.

You should now see the sculpt and your controllers on screen. Start sculpting! It takes a little time to get used to without the stereo cues, use the radius circle indicator and the spherical indicator to judge your depth.

If the default position feels uncomfortable (too high, too far away, too shifted left or right), use the mouse to adjust. Scrollwheel will move near/far, middle mouse will pan up/down/left/right. 

My usual method is to adjust the view with the mouse so that the controllers feel comfortable in my lap, then use the grip controls to pull the sculpt into a comfortable position.

#### Stationary mode and tracking issues
My understanding is the Quest 3 makes a few (perfectly valid!) assumptions about tracking:

- It can always see the floor
- The headset is always moving a little bit so it can keep getting updates on where it is
- The controllers are held in a natural grip out front, below, with the 'face' of the controller facing the cameras.

When I first tested this Dreams mode putting the headset on my desk, I kept having the controllers drift and act strange. I eventually realised what was happening:

- It couldn't see the floor
- The headset was perfectly static, so it wasn't getting regular updates of where it was in space
- The controllers were showing their backside to the cameras, and often either too close or off to the sides near the headset 'ears'.

The Quest 3 is simply not designed for this tracking scenario. Hence you gotta help it a little. When placing it on your desk, ensure it's hanging off the edge a little so the cameras can see the floor. Careful, the quest 3 is  front heavy and likes to tip forward! If you have a way to mount it higher with more stability, perfect. 

By shifting yourself further back, you're more likely to keep the controllers in sight of the cameras at all times.

Despite not being designed to track the back of the controllers, the Quest 3 does a pretty good job. I find if controllers start to drift (usually because I've kept the controllers in a hard to track position for too long), just 'showing the face' of the controllers to the headset by tilting them forward for a second will reset tracking.


#### Stationary mode and standby
The quest 3 will go into standby mode if it thinks you're not using it. Covering the light sensor helps trick it, but if the headset hasn't moved for 2 minutes, it assumes it's not on your head and goes into standby. Currently I just tap or nudge the headset every 30 seconds. There are developer options to better control this, but I haven't tested them.



## Clear Browser Cache
The browser on the Quest 3 and Chrome desktop love to aggresively cache javascript files. This plays havok with SculptXR where I'm frequently updating files.

Here's what I do to clear the cache.

### Desktop Chrome

1. R.click on the page, Inspect
2. Network tab, 'Disable Cache' toggle, turn it on.
3. Application tab, Storage, 'Clear site data'
4. If the Inspect tab doesn't have enough room, the Network or Applications tab might be under the >> button in the top bar.

![](assets/console_network.jpg)
<br>*Network, Disable Cache*<br>

![](assets/console_application.jpg)
<br>*Application, Storage, Clear site data*<br>

![](assets/console_hidden.jpg)
<br>*Options sometimes hidden under >> menu*<br>

### Quest 3 browser

1. Click the 3 dots button in the top right of the browser
2. Clear Browsing Data
3. Clear Data



## Original Project Resources
- Live Demo: [stephaneginier.com/sculptgl](http://stephaneginier.com/sculptgl)
- Website: [stephaneginier.com](http://stephaneginier.com/)
- Galaxy XR Troubleshooting: [docs/galaxyxr.md](docs/galaxyxr.md)

## Credits
- Original SculptGL by [Stéphane Ginier](http://stephaneginier.com/).
- Raw environments from [HDRI Haven](https://hdrihaven.com/hdris).
- Quad Remeshing powered by [quadrs](https://crates.io/crates/quadrs), an experimental Rust port of Instant Meshes.
