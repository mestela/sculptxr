# SculptGL WebXR Implementation Handover (v0.6.33)

## Current Status
**Version**: `v0.6.33` (Stable)
**Active Task**: Maintenance / Feature Polish.

## Achievements
- **VRLaser**: Implemented a context-sensitive Red Laser Pointer for the VR Menu.
    - **Visuals**: Unlit Red Cylinder (1mm radius).
    - **Behavior**: Only visible when pointing at the menu; dynamic length matches distance.
- **90fps Cursor**: Decoupled VR Menu cursor from the 30fps texture update loop.
- **Crash Fixes**: Resolved `ShaderFlat` crashes.
- **VR Menu Depth**: Fixed incorrect depth sorting.

## Known Issues
- **None Critical**.
- **Minor**: Dynamic Topology in VR is enabled but behavior is inconsistent/unverified.

## Next Steps
1.  **Voxel Grid Visualization**: Users report drawing out of bounds; a visual bounding box would help.
2.  **Spectator Mode**: Implement Desktop Mirroring for PCVR.

## Useful Commands
- `deploy.sh`: Deploys to Production (`sculptxr`).
- `deploy_beta.sh`: Deploys to Beta (`sculptxrbeta`).