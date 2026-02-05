# Desktop 6DOF Spectator Mode (Feature Guide)

## Overview
**Desktop 6DOF** allows a PCVR user (or observer) to view the sculpting session from a "Seated/Desktop" perspective on the monitor, independent of the VR Headset's motion. This is crucial for:
1.  **Comfort**: The VR user moves their head constantly; the desktop view should remain stable.
2.  **Broadcasting**: Streamers can show a steady camera angle while working.
3.  **Debugging**: Developers can inspect the scene without wearing the headset.

## User guide
1. Connect your headset to PCVR mode (tested with Meta Link, have not tried other PC setups)
2. Put on your headset
3. Open Chrome, navigate to tokeru.com/sculptxr
4. Press the 'Enter VR' button
5. When you can see the VR mode, take the headset off, place it on your desk facing you. Ensure the headset is a little off the edge of the desk, so the left and right fishye cameras on the side of the headset can see the ground
6. Press the 'D' key to toggle the desktop mode
7. Position yourself back a bit, so that even if you fully extend your arms forward, the controllers are still in front of the headset
8. Use the grip handles to position the sculpt comfortably on your monitor
9. If you need to adjust the offset, you can type `setSpectatorOffset(x, y, z)` in the console to adjust this live.

Note that the quest 3 is very aggressive about turning itself off. You need to put tape over the proximity sensor inside the headset, in the standalone settings turn off power saving, set the max time to 4 hours, and even _then_ the headset will turn itself off if it doesn't detect movement after a few minutes.

I think you can disable this in the developer tools, but I haven't tried it.



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
    *   *Runtime Tuning*: You can type `setSpectatorOffset(x, y, z)` in the console to adjust this live.

### 4. Input Controls
*   **Toggle**: Press **`D`** on the keyboard to toggle the "Desktop Offset" mode.
    *   *Active*: Desktop Camera is fixed/stabilized.
    *   *Inactive*: Desktop Camera follows the Headset (Standard Mirroring).

## Code Architecture
*   **`Scene.js`**:
    *   `_renderSceneVR()`: Handles the multi-pass rendering (Left Eye, Right Eye, Spectator).
    *   `_renderSpectator()`: Dedicated pass for the desktop view.
*   **`SculptGL.js`**:
    *   Input listeners for the `D` key.
