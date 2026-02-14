# Handover: Robust Symmetry & Undo (v0.7.490)

> [!IMPORTANT]
> **CRITICAL RULES FOR THIS SESSION**:
> 1.  **Step ID**: Start EVERY response with `Step Id: {id}`. Increment from the user's last `Step Id`.
> 2.  **No Caching Blame**: Browser caching is NEVER the valid cause of bugs here. Do not suggest clearing cache.
> 3.  **Beta Deployment**: ALL code changes must be deployed to Beta (`./deploy_beta.sh`) before asking for testing.

## Current Status
- **Goal:** Fix Move Tool Null Crash & Symmetry Undo Artifacts.
- **Latest Version:** `v0.7.490` (Deployed to Beta).
- **Last Step Id:** 302
- **Status:** **CRITICAL INVESTIGATION REQUIRED**.
  - **Move Tool Crash**: `Move.startSculpt` crashes when `mesh` is null (e.g. headset removed).
  - **Symmetry Undo Artifact**: "Tide mark" on symmetry side after Undo. Likely caused by the crash interrupting the stroke start before `pushVertices` captures the symmetry state.
  - **Persistence Issue**: Fixes were applied to `src/editing/tools/Move.js` (null checks added), but the user reports the **CRASH PERSISTS** with stack traces pointing to the **OLD** line numbers.
  - **Constraint**: `deploy_beta.sh` is considered "fine" by the user. Do not blame it or caching.

## Solutions Attempted
1.  **Null Checks**: Added `if (mesh)` guards in `startSculpt` and `makeStrokeXR`.
2.  **Force Update**: Updated `index.html` importmap to use `Move.js?v=490`.
3.  **Verification**: Verified `Move.js` on disk has the checks.

## Next Steps
1.  **Investigate Execution Path**: Why is the browser executing old code?
    - Check if `Move.js` is bundled or served from a different location?
    - Check if `SculptGL.js` imports a *different* `Move.js`?
2.  **Fix "Tide Mark"**: Once the crash is fixed, verify if `StateGeometry` correctly restores the symmetry side.
    - If `startSculpt` completes, it *should* push the correct vertices.

## Environment
-   **URL:** `https://tokeru.com/sculptxr/`
-   **Repo:** `https://github.com/mestela/sculptxr`
-   **Deploy Prod:** `./deploy_production.sh`
-   **Deploy Beta:** `./deploy_beta.sh`
