# SculptXR Handover Prompt

## Objective: Fix 6DOF Rotation Trackballing

The project is currently at `v0.8.108`. The user is trying to implement a "STATIONARY" 6DOF spectator mode where the desktop camera perfectly mirrors the physical translation and rotation of the VR headset, but at a massive virtual scale, without "trackballing" (orbiting) around the sculpt.

We successfully isolated pure translation in `v0.8.104` using `scaledPanPos`. The user confirmed 1:1 forward/back panning works natively without moving the pivot.

However, in `v0.8.108`, the user reported that combining translation and rotation in the interactive matrix debugger (`window.debugTripodVirt = ['bakedDesktopView', 'panRot', 'scaledPanPos']`) breaks the 1:1 movement and reverts to the "trackball" behavior, where the scene swings orbitally.

### Current Status
- **Baseline**: `v0.8.108` is on Beta.
- **Physical Controllers (Pass 1)**: The array `window.debugTripodPhys = ["bakedDesktopView", "invScaleMat", "invBakedOffset"]` has been deployed to fix microscopic/teleported controllers, but the user went to sleep before testing it.
- **Virtual World (Pass 2)**: The user's array `['bakedDesktopView', 'panRot', 'scaledPanPos']` logically causes an orbital trackball effect.

### The Physics of the Trackball Regression
Why does `panRot * scaledPanPos` trackball?

1. `scaledPanPos` calculates a pure translation delta from the physical room origin.
2. `panRot` is a pure `mat4.fromQuat` rotation matrix. Critically, **it rotates around the exact origin `[0,0,0]`**.
3. `bakedDesktopView` pushes the entire scene 80 units backwards into the camera frustum so the sculpt is framed nicely in the viewport.

When `buildMatrix` evaluates `['bakedDesktopView', 'panRot', 'scaledPanPos']`, it performs:
`mat = bakedDesktopView * panRot * scaledPanPos`

In vector space (`v' = M * v`), operations evaluate **right-to-left**.
1. **First**, the vertex `v` is translated by `scaledPanPos`. If the user walks 2 meters to the right, `v` shifts left.
2. **Second**, `panRot` rotates the world. Because the vertex is no longer at `[0,0,0]`, rotating it swings it in a massive orbital arc around the origin! The further the user walks from the center of their room, the more violently the camera tracks in an orbit when they turn their head.
3. **Third**, `bakedDesktopView` pushes this swung vertex 80 units away to render it.

### Next Session Mission
When the user returns, you must explain that `panRot` cannot be blindly multiplied against a translated matrix, because the rotation pivot is `[0,0,0]`!

To rotate the camera "in place" (like an FPS camera) after walking mathematically away from the origin, the rotation matrix must pivot around the *camera's current local position*, not the world origin.

#### The Fix Strategy:
1. **Confirm Pass 1**: Ask the user if `window.debugTripodPhys = ["bakedDesktopView", "invScaleMat", "invBakedOffset"]` successfully renders the physical VR controllers in their lap.
2. **Re-architect Pass 2 Rotation**: You must create a new matrix logic in `Scene.js` (e.g., `localPanRot`) that applies the rotation *locally* relative to the translation delta, rather than globally around the sculpt origin. 
    * To rotate around a pivot `P` (the camera's translation), you translate by `-P`, rotate, then translate by `+P`.
    * Alternatively, look into the specific mathematical ordering of translation/rotation in `mat4.fromRotationTranslation`. If `worldMat` inherently trackballs because of `bakedDesktopView`'s 80-unit push, you may need to apply `panRot` first, *then* `scaledPanPos`, but ensure `bakedDesktopView` handles the 80 units as an isolated local zoom rather than a global modifier.

Help the user dial in the perfect matrix array in the console before deploying code!