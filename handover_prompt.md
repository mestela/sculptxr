# SculptXR Handover Prompt

## Objective: v1.0 Stabilization (Feature Freeze)

The project has entered the **v0.8.0** release cycle. We are officially in a **Feature Freeze**. The objective for this phase is to reach **v1.0** by focusing exclusively on bug fixes, performance optimizations, and UX stability.

### Current Status
- **Baseline**: `v0.8.0` is live on the Beta channel.
- **Recent Fix**: Resolved a major symmetry regression in the Move tool (removed a 1000-triangle limit in `Picking.js` that caused brush center offsets).
- **Major Features Complete**: Voxel Remeshing, Transform Gizmo (desktop/VR), Symmetrical Geometric Mapping, and Voxel Bounding Box UI.

### Core Rules for this Phase
1. **NO NEW FEATURES**: Do not implement new tools or experimental features unless explicitly asked for a bug fix that requires an architectural change.
2. **STABILITY FIRST**: Prioritize fixing "pop", "jitter", or "drift" in VR interactions.
3. **VERSIONING**: 
    - The **Source of Truth** for the version is the `<title>` tag in [index.html](file:///Users/mattestela/.gemini/jetski/scratch/sculptxr/index.html).
    - The `deploy.sh` script automatically syncs this version into `src/Version.js` during deployment.
    - Every new deployment (Beta or Production) REQUIRES a version bump in `index.html`.

### Known Areas to Watch
- **Symmetry Snapping**: Monitor the consistency of geometric symmetry mapping on remeshed voxel meshes.
- **VR Transform Alignment**: Ensure the Transform Gizmo and Grab tools remain perfectly centered and do not drift during extended sculpting sessions.
- **Performance**: Maintain 90Hz in VR. Avoid introducing any code that iterates through every face/vertex on the main thread during `sculptStroke`.

## Next Mission
Wait for user bug reports or regression findings. If a bug is reported, perform deep root-cause analysis (similar to the Move Symmetry investigation in `research.md`) before applying a surgical fix.