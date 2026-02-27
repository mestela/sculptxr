# Desktop 6DOF Mode (User Guide)

## Overview
**Desktop 6DOF** allows a PCVR user (or observer) to view the sculpting session from a "Seated/Desktop" perspective on the monitor, independent of the VR Headset's motion. This is crucial for:
1.  **Comfort**: The VR user moves their head constantly; the desktop view should remain stable.
2.  **Broadcasting**: Streamers can show a steady camera angle while working.
3.  **Debugging**: Developers can inspect the scene without wearing the headset.

## User guide
0. Cover the proximity/light sensor inside the headset with a sticker or opaque tape (its the thing roughly where the middle of your eyebrows would be)
1. Connect your headset to PCVR mode (tested with Meta Link in both USB and wifi mode, have not tried other PC setups)
2. Put on your headset
3. Open Chrome, navigate to tokeru.com/sculptxr
4. Press the 'Enter VR' button
5. When you can see the VR mode, take the headset off, place it on your desk facing you. PLACEMENT IS IMPORTANT! Ensure the headset is a little off the edge of the desk, so the left and right fishye cameras on the side of the headset can see the ground.
6. Press the 'D' key to toggle the desktop mode
7. Position yourself back a bit, so that even if you fully extend your arms forward, the controllers are still in front of the headset
8. Use the grip handles to position the sculpt comfortably on your monitor

## Calibration/offset

It's likely that if you rest your hands comfortably, it feels misaligned to the view. To fix, tap C.

Now when you use the grip controls, you move everything, including your controls. Eg if your controls feel too far to the right and tilted too far forward, tap C, move everything to the left, tilt back. Press C again, And see if your resting position feels better.

This process doesn't feel as intuitive as it should, I'll revisit at some point.

## Disable auto-standby

Note that the quest 3 is (correctly) very quick to turn itself off to save battery. It has 2 main ways to do this; a light sensor near your eyebrows to detect when you're wearing it, and a timeout if it detects the headset has been still for more than 2 minutes.

To defeat the light sensor, block it with somethng opaque (a sticker, some painters tape etc)

To defeat the motion sensor, for now I'm just trying to remember to tap the headset every 30 seconds. :) 

Apparenty this development tool lets you turn off both things, but I haven't tried it yet:

https://developers.meta.com/horizon/documentation/unity/ts-mqdh/





## Implementation Details

### 1. Parity Rendering
Previously, the desktop view used a separate, simplified render path that often missed updates (e.g., controllers not showing up, meshes missing).
*   **Fix**: We refactored `Scene.render()` and `Scene.renderVR()` to share the exact same draw calls.
*   **Mechanism**: A "Parity Render" pass enables `gl.DEPTH_TEST` and `gl.CULL_FACE` to match VR, ensuring the brush radius sphere and tools clip correctly against the mesh.

### 2. Depth Perception (Sphere Fix)
The Brush Radius Sphere uses a custom shader. In VR, stereo vision provides depth cues. On 2D Desktop, it looked "always on top" (ghostly).
*   **Fix**: Enabled `gl.enable(gl.DEPTH_TEST)` in the sphere's render pass.
*   **Result**: The sphere now visually "clips" into the mesh when intersecting, providing a clear depth cue on 2D screens.

### 3. Coordinate System & Offset
The VR workspace and Desktop Camera share the same World Space (`SCENE_TRANSFORM` in `Scene.js`).
*   **Rotation**: The Desktop Camera is rotated **180° around Y** to face the "Front" of the sculpture (matching the default VR seated position).
*   **Offset**: Default offset is `(0, 0, 0)`.
    *   *History*: We tested inverted Y offsets, but `(0,0,0)` proved most ergonomic for the standard "Seated at pivot" feel.
    *   *Runtime Tuning*: Press C to enable calibration mode, use the grip triggers to adjust, press C again to exit calibration.

### 4. Input Controls
*   **Toggle**: Press **`D`** on the keyboard to toggle the "Desktop Offset" mode.
    *   *Active*: Desktop Camera is fixed/stabilized.
    *   *Inactive*: Desktop Camera follows the Headset (Standard Mirroring).

### 5. Coordinate Distortion & Tool Mirroring (v0.8.124)
A major challenge with 6DOF Desktop mode is that the headset's positional tracking (which defines `panRot` and `scaledPanPos`) distorts the perceived desktop camera matrix. 
When the user uses the mouse on the Desktop canvas, unprojecting those 2D coordinates back into 3D space causes severe mathematical divergence:
*   **Infinite Brush Radius**: Standard unprojection scales the radius dynamically based on mouse drag distance. In 6DOF, drifting off the mesh caused the unprojected vector to scale to infinity, creating an exploding brush radius with hard, unblended edges. We fixed this by dynamically caching the initial `radius2` at `mousedown`, locking the physical footprint of the stroke.
*   **Topological Symmetry Snap**: The standard `Move` tool symmetry drops a microscopic 3D collision sphere onto the mirrored side of the mesh to validate a topological hit. Because the 6DOF matrix offset was causing this sphere's radius to unproject as `~0.005`, the intersection validation missed and aborted symmetry entirely. We patched `Move.js` to intelligently trust the mathematically mapped topological vertex (`symMap`) and forcefully bypass the broken 3D collision check, restoring perfect mirror symmetry for desktop editors.
*   **Dual Cursor Isolation**: Because VR controllers update the shared `Picking` singleton every frame, the Desktop UI's 2D raycaster erroneously re-projected the VR controller's 3D intersection back onto the 2D computer screen, rendering a distracting floating cursor. We fixed this by tagging intersections with `_isVRHit = true` and commanding `Selection.js` to disable the 2D cursor projection when a VR hit is active.

## Code Architecture
*   **`Scene.js`**:
    *   `_renderSceneVR()`: Handles the multi-pass rendering (Left Eye, Right Eye, Spectator).
    *   `_renderSpectator()`: Dedicated pass for the desktop view.
*   **`SculptGL.js`**:
    *   Input listeners for the `D` key.
