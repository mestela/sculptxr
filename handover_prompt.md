# Handover Prompt (Protocol Enforced)

**Project Status**: Stable. The VR Sidebar has been overhauled into a modern 3-tab system ("Rendering", "Topology", "Sculpting"). The production build is fixed (Web Worker dependencies are now bundled correctly using Vite's `?worker` and configure output format `es`). 

**Current Working Directory**: `/Users/mattestela/.gemini/jetski/scratch/sculptxr`
**Current Branch**: `threejs_voxel_branch`

---

## Deployed Version
- **Beta**: v1.0.62 (Successfully deployed via `./deploy_beta.sh`)
- **Prod**: Not yet updated to this version (v1.0.60 legacy)

---

## Current Situation / Obstacles

We have successfully stabilized the **Voxel Remeshing Pipeline** and cleaned up the codebase for production!

### Key Achievements Today:
1.  **Voxel Remesh Stabilization**: Switched to Local Geometry Bounding Box for simulation sizing, decoupling from parent visual transforms.
2.  **Proportional Distance Field Scaling**: Fixed the "volume collapse" bug during resolution changes.
3.  **Active Bounds Reset**: Prevented `Verts=0` empty mesh extraction during resampling.
4.  **Log Stripping**: Systematically purged `[Voxel Debug]`, `DIAGNOSTIC`, `[SurfaceNets Live]`, `[VoxelWorker]`, `[Mesh Error]`, and `[SculptVoxel]` logs.
5.  **OBJ Export Fix**: Solved the `.obj.txt` suffix bug by setting the Blob type to `application/octet-stream`.

All fixes are pushed to `threejs_voxel_branch` and deployed to Beta (`v1.0.62`).

---

## Next Steps / Backlog

### Fit & Finish (Immediate Priorities)
1.  **Transform Gizmo Wobble**: Fix eccentric rotation/translation behavior on non-spherical objects (cylinders, etc.).
2.  **Voxel Undo Visualization**: Investigate why voxel undo sometimes reverts data but doesn't redraw the view.
3.  **Default Matcap Paint Tweak**: Resolve painting artifacts on the default matcap.

### Future Roadmap
1.  **Thumbstick Scrolling**: Map thumbstick to menu scrolling in VR.
2.  **Local Storage (IndexedDB)**: Persist user options and local projects.
3.  **Three-mesh-ui Migration**: Move UI panels to native Three.js geometry.

Good luck! 🛠️
