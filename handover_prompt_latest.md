# Handover Prompt (Protocol Enforced)

**Project Status**: v1.0.87 - Fixed Garbage Leak in Snapshots for Cut Tool
**Current Working Directory**: `/Users/mattestela/.gemini/jetski/scratch/sculptxr`
**Checkpoint**: Resolved persistent edge collapsing on undo by manually slicing arrays in `captureMeshSnapshot` to prevent garbage at the end of pre-allocated buffers from leaking into the snapshot.

## Deployed Version
- **Beta**: N/A (Deployment disabled in rules)
- **Prod**: N/A (Deployment disabled in rules)

## Interactive Debugging
- **Preference**: Use browser console for immediate state inspection.
- **Workflow**: Provide copy-pasteable snippets.

## Summary of Work
1.  Overrode the snapshot capture logic in `CutTool.js` to manually slice arrays using `subarray(0, count)` based on active counts (`nbFaces`, `nbVertices`). This prevents the large pre-allocated capacity arrays (which contain garbage at the end) from being copied in full and causing issues when restored.
2.  Incremented version to `v1.0.87` in `index.html` and `src/Version.js`.
3.  Updated `docs/releases.md` and `README.md`.

## Next Steps
- Verify that undoing a completed cut no longer leaves collapsed edges at the origin.
- If verified, commit the changes.
