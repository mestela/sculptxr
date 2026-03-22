# Handover Prompt - Poly Move Tool Rotation Fix (v1.0.42)

**Project Status**: **Success!** We fixed the rotation "drift" in the Poly Move tool for VR. The vertices now stay locked to the cursor center during rotation.

---

## Recent Work & Achievements (This Chat)

### 1. Fixed Rotation Origin (v1.0.42)
Changed the rotation origin from the pick point (`center`) to the controller's starting position (`vStartLocal`). This provides a "grab and swing" feel where the mesh rotates around the controller rather than sliding.
-   **File**: `src/editing/tools/Move.js`

### 2. Symmetrical Rotation (v1.0.42)
Symmetry is now handled correctly by passing the mirrored controller origin (`symStartLocal`) as the pivot for symmetric strokes.
-   **File**: `src/editing/tools/Move.js`

### 3. Documentation & Versioning
Bumped version to `v1.0.42` in `src/Version.js` and updated `README.md` (latest 3 releases) and `docs/releases.md`.

---

## Next Steps:

The fix is live on the `threejs` branch. 
Possible next directions:
1.  **Strange Falloff**: The user mentioned the falloff felt "strange" earlier. This could be investigated.
2.  **Voxel Move Tool**: Porting the voxel move tool to Three.js (currently it's considered legacy/missing).
3.  **Other Fit & Finish**: Continue with standard mesh fit and finish items.

---

## Device & Server
-   **Server**: `npm run dev` (Vite)
-   **Testing**: Chrome Remote DevTools over USB on GalaxyXR.
