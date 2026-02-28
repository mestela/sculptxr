# SculptXR Handover Prompt

## Objective: Resolve Remaining VR Quirks (Crease Symmetry & Stationary Scale)

The project is currently at `v0.8.153`. We successfully deployed a massive stability update tonight that resolved the severe VR stroke lag (by removing a faulty interpolation loop), fixed the topological symmetry performance drop (Math.min radius cap), and corrected the inverted 2-handed scaling gesture (including a smart mode check for Stationary vs Tracked).

The user reported two remaining issues that need to be addressed in the next session:

### Issue 1: Crease Brush Breaks Symmetry
The `Crease` brush breaks symmetry when used in VR. Unlike other brushes that use volume intersection (`intersectionSphereMeshes`), the Crease tool was explicitly forced to use laser-raycast aiming (`intersectionRayMesh`) to prevent it from sliding off sharp ridges. 
*   **The Problem**: The topological symmetry engine likely struggles to mirror a purely geometric raycast hit correctly, or the hit-point calculation used by the raycast doesn't accurately map to the mirrored vertex topology in the same way the sphere intersection does.
*   **Where to investigate**: Compare how `SculptBase.js` / `makeStrokeXR` handles the `picking` and `pickingSym` objects when the primary tool is using Raycast vs Sphere.

### Issue 2: Stationary Mode UI / Controller Scaling
In `Stationary` (Desktop 6DOF) mode, the VR menu and the controller models themselves are scaling up and down when the user scales the world.
*   **The Problem**: In Stationary mode, the user is scaling the *World* around them to zoom in/out of the object. However, the Controllers and Menu UI should remain a fixed, comfortable physical size relative to the desktop screen (or the user's physical hands). Right now, they are inheriting the `_vrScale` multiplier intended for the world.
*   **Where to investigate**: Look at `Scene.js` rendering / matrix updates (e.g. `_updateMatricesMeshVR`, `renderSceneVR`, or where the Menu/Controller `XRRigidTransform` is applied). We likely need to decouple or counteract the `_vrScale` specifically for the GUI and Controller drawables when `_spectatorMode === Enums.SpectatorMode.STATIONARY`.

## Next Session Mission
1. Investigate the Crease brush symmetry logic.
2. Fix the Stationary mode scale inheritance for the GUI and Controllers.
3. Deploy fixes to Beta and verify with the user.