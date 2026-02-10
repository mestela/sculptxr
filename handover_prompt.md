# Handover Prompt (Protocol Enforced)

**Project Status**: Voxel Freeze Fix & Rendering Cleanup
**Current Working Directory**: `/Users/mattestela/.gemini/jetski/scratch/sculptxr`
**Checkpoint**: `v0.7.292` (Deployed to Beta)

## 🚨 CRITICAL INSTRUCTIONS (READ THIS FIRST)
1.  **CACHE IS INNOCENT**: The user **manually clears cache** (Application -> Clear Storage) every time.
    *   **NEVER** blame caching.
    *   **NEVER** try "cache busting" (adding `?v=xyz`) as a primary fix. It has been tried and failed.
    *   **If you think it's caching, YOU ARE WRONG.** It is a logic issue or a git/deployment issue.

2.  **THE ISSUE**:
    *   `_drawScene` logs ("Start", "Grid", "Meshes") are **MISSING**.
    *   `applyRender` logging **WORKS** (`[Scene] applyRender Start` appears).
    *   `applyRender` calls `_drawScene`.
    *   **Paradox**: `applyRender` says it calls `_drawScene`, but `_drawScene` doesn't print its first log line.

3.  **REQUIRED ACTION**:
    *   **DIFF AGAINST MASTER**: The answer lies in the difference between the current branch and `master`.
    *   Do NOT guess. Do NOT hypothesis.
    *   **Execute this command immediately**:
        ```bash
        git diff master src/Scene.js > diff_master_scene.txt
        ```
    *   **READ THE DIFF**. Look for:
        -   Changes in `start()` (Is `_drawScene` overwritten?).
        -   Changes in `_drawScene` definition.
        -   Changes in `applyRender`.

## Context
-   **Files**: `src/Scene.js` is the core. `src/SculptGL.js` extends it.
-   **Debugging So Far**:
    -   Added unconditional logs.
    -   Initialized `_logThrottle`.
    -   Removed `window.screenLog` checks.
    -   Confirmed `master` branch exists locally.
-   **Current State**: Grid and Sphere are invisible. Logs stop partially through the frame.

## Next Steps
1.  Run `git diff master src/Scene.js`.
2.  Analyze why `_drawScene` is seemingly skipped or crashing silently (though `try-catch` in `applyRender` catches nothing?).
3.  **Fix**: Restore the working logic from master.