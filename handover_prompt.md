# SculptXR Handover Prompt

## Objective: Resolve Remaining VR Quirks (Crease Symmetry & Stationary Scale)

The project is currently at `v0.8.153`. We successfully deployed a massive stability update tonight that resolved the severe VR stroke lag (by removing a faulty interpolation loop), fixed the topological symmetry performance drop (Math.min radius cap), and corrected the inverted 2-handed scaling gesture (including a smart mode check for Stationary vs Tracked).

The user reported two remaining issues that need to be addressed in the next session:

### Issue 1: Crease Brush Breaks Symmetry
The `Crease` brush breaks symmetry when used in VR. We recently (in v0.8.154) corrected `Scene.js` to ensure the Crease tool explicitly uses volume intersection (`intersectionSphereMeshes`), making it smooth and stable like the standard brushes.
*   **The Problem**: Despite using the exact same volume intersection logic as `Brush` and `Pinch`, the topological symmetry engine still fails to draw correctly on the mirrored side when using `Crease`. 
*   **Where to investigate**: Compare the `SculptBase.js` stroke calculations (specifically what variables the mirror evaluates) for `Crease` vs `Brush`. Are they handling `intersectionSphereMeshes` outputs differently, or is the normal evaluation algorithm in `Crease.js` somehow throwing off the geometric mirror tether?

### Issue 2: Stationary Mode UI / Controller Scaling
In `Stationary` (Desktop 6DOF) mode, the VR menu and the controller models themselves are scaling up and down when the user scales the world.
*   **The Problem**: In Stationary mode, the user is scaling the *World* around them to zoom in/out of the object. However, the Controllers and Menu UI should remain a fixed, comfortable physical size relative to the desktop screen (or the user's physical hands). Right now, they are inheriting the `_vrScale` multiplier intended for the world.
*   **Where to investigate**: Look at `Scene.js` rendering / matrix updates (e.g. `_updateMatricesMeshVR`, `renderSceneVR`, or where the Menu/Controller `XRRigidTransform` is applied). We likely need to decouple or counteract the `_vrScale` specifically for the GUI and Controller drawables when `_spectatorMode === Enums.SpectatorMode.STATIONARY`.

## Next Session Mission
1. Investigate the Crease brush symmetry logic.
2. Fix the Stationary mode scale inheritance for the GUI and Controllers.
3. Deploy fixes to Beta and verify with the user.