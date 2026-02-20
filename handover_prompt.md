# Handover Prompt
## Current Task: Fixing GizmoVR Coordinate Space Mismatch
- **State**: `v0.7.639` (Beta).
- **Critical Finding**: **Coordinate Space Mismatch Confirmed.**
    - The GizmoVR ray intersection logic is testing against **World Space** geometry using a **Camera Space** ray.
    - **Evidence**: Aiming the controller 180 degrees backwards (towards the camera origin) hits the Gizmo components that are visually rendered in front of the user (offset by `_xrWorldOffset`).
    - The `_xrWorldOffset` (e.g., Pull Back 55cm, Lift 1.2m) is applied to the **Visuals** but **NOT** to the **Ray Math**.
## The Fix Plan
1.  **Locate Ray Origin**: Find where `_vrControllerPos` / Ray Origin is derived in [Scene.js](cci:7://file:///Users/mattestela/.gemini/jetski/scratch/sculptxr/src/Scene.js:0:0-0:0) (likely raw `getPose` in Camera Space).
2.  **Apply Offset**: Before passing the Ray to `GizmoVR.intersect`, apply the `_xrWorldOffset` matrix to both Origin and Direction.
    - `vec3.transformMat4(rayOrigin, rayOrigin, xrWorldMatrix)`
    - `vec3.transformMat4(rayDir, rayDir, xrWorldMatrix)` (Direction vector, so `w=0`)
3.  **Verify**: Aiming at the visual Gizmo should now correctly hit the mathematical Gizmo.
## Environment
-   **URL:** `https://tokeru.com/sculptxrbeta/`
-   **Repo:** `https://github.com/mestela/sculptxr`
-   **Deploy Beta:** `./deploy_beta.sh`