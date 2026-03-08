# Handover Prompt

**Project Status**: Finished the `feature/performance-wireframe` branch, deploying v0.9.216 to both Beta and Production environments. We've successfully fully restored and optimized rendering for Voxel pure quad meshes, cured severe wireframe performance constraints on standalone headsets, fixed coordinate offsets and duplicates in the VR overlay comboboxes, and polished up the UI spacing.
**Current Working Directory**: `/Users/mattestela/.gemini/jetski/scratch/sculptxr/`

## Recent Work & Context
1. **Wireframe Performance & Quads**: `SurfaceNets.js` successfully creates and exports pure quads now. Voxel meshes draw properly in `Wireframe` mode without crashing. Implemented `MAX_TRIANGLES` limits within `ShaderWireframe.js` to intelligently sub-sample lines and preserve framerates when drawing incredibly dense geometries in standalone VR.
2. **Platform Specific Defaults**: Modifed the startup `_wireframeType` inside `RenderData.js` to automatically default to `Fast L0` (barycentric) wireframes if `navigator.userAgent` detects an `OculusBrowser`. This ensures users entering VR with wireframe toggled on do not immediately tank their performance.
3. **VR Combobox Bug Fixes**: Purged a phantom secondary loop drawing comboboxes twice in `GuiXR.js`. We also removed an erroneous `drawX = startX - ox` spatial transform that was inexplicably throwing newly-opened comboboxes off the right side of the active HUD texture (which itself is mapped to a dynamic physical overlay plane).
4. **Current Build**: Deployed to `tokeru.com/sculptxr/` main production as version `v0.9.216`. Documentation (`todo.md`, `README.md`, `releases.md`) is completely updated.

## Next Steps
The environment is clean and stable. You can proceed to test the site, or immediately start tackling the next major `todo.md` items:
1. **VR Movement Tracking / Ski Navigation**: Look into making world scaling and translation more robust. The user notes an issue with accidental double-grips stopping the flow.
2. **Dynamic Topology Performance**: Dyntopo still struggles severely on standalone hardware. Now that wireframe is fixed, look into deep profiling Dyntopo vertex splitting on Quest.
3. **Advanced Voxel Tools**: Port more standard tools (Smooth, Move) over to the Voxel brush palette, or begin investigating "straight line" or "曲线/Tubes" voxel modes.