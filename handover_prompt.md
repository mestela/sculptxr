# Handover Prompt (Protocol Enforced)

**Project Status**: v0.7.92 (BETA) - Grab Tool Stabilization (Mouse Interference, Hand Lock, Debounce)
**Current Working Directory**: `/Users/mattestela/.gemini/jetski/scratch/sculptxr`
**Checkpoint**:
- `sculptxr` (BETA): **v0.7.92** (Grab Tool Fixes: Mouse Guard, Hand Lock, Trigger Debounce)

## MANDATORY: Project Rules & Guidelines
[project_rules.md](file:///Users/mattestela/.gemini/jetski/scratch/sculptxr/project_rules.md)

## Current Focus: Stabilizing VR Interaction
We have been debugging stubborn issues where the **Grab Tool** (and other VR tools) would randomly drop objects or stop working.


## User notes:

- debounce is a bullshit theory, it didn't work. debounce isn't needed in any other part of the tool trigger behavior, it makes no senes here. 
- i really think you should carefully look at why double trigger scale works and single trigger doesn't clearly you're doing something stupid.
- further i'ld look VERY closely at the grip button code. it works PERFECTLY, its just that it happens to update the world rather than an object. surely the code should be pretty much identical apart from being fired by the trigger buttons rather than the grip buttons?



### Recent Accomplishments (v0.7.80 - v0.7.92)
- **Grab Tool / VR Interaction**:
    - **FIXED**: **Mouse Interference**: Desktop mouse events (`onMouseOut` -> `onDeviceUp`) were killing VR sessions. Added guards in `SculptGL.js`.
    - **FIXED**: **Active Hand Switching**: `Scene.js` was potentially checking the wrong hand's trigger if tracking flickered. Implemented **Active Hand Lock** (`_vrLockedHand`) to bind the session to the starting hand.
    - **FIXED**: **Signal Jitter**: Implemented **Trigger Debounce** (150ms grace period) in `Scene.js` to swallow widespread signal drops/flickers.
    - **FIXED**: **Air Grabs**: `Grab.js` now allows "Air Grabs" (`_allowAir = true`) ensuring ray misses don't terminate the hold.
- **Reference Images**:
    - **FIXED**: Crash due to `Uint32Array` faces (switched to `Int32Array`).
    - **FIXED**: Crash due to `updateDuplicateGeometry`.

## Outstanding Issues (Next Session)
1.  **Verification**:
    - User is currently testing **v0.7.92**.
    - If successful, the interaction should be rock solid.
2.  **Cleanup**:
    - `Scene.js` and `SculptGL.js` have embedded console logs (`[Scene] Sculpt END`, `VR Src`, `MouseUp Ignored`).
    - Once verified, **remove these logs** to clean up the console.

## Debugging Commands
- `window.debug.grab()`: Prints active controller pos and grab status.
- `debug.toggle()`: Toggles screen log.

## Recent Changes
*   **v0.7.92**: **Fix**: Trigger Debounce (150ms) to handle flaky trigger signals.
*   **v0.7.90**: **Fix**: Active Hand Lock (prevents hand swapping).
*   **v0.7.88**: **Fix**: Mouse Interference (`onDeviceUp` guard).
*   **v0.7.87**: **Fix**: `_allowAir` for Grab tool.

## Deployment
*   **PROD**: `./deploy.sh` (Deploys to tokeru.com/sculptxr)
*   **BETA**: `./deploy_beta.sh` (Deploys to tokeru.com/sculptxrbeta)

## Next Task
*   Wait for user confirmation of v0.7.92.
*   If good -> **Cleanup Logs**.
*   If bad -> Check `[Scene] Sculpt END` logs for the specific reason (is it still `TriggerRelease` > 150ms? or something else?).