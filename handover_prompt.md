# SculptXR Handover Prompt

## Current State & Focus
You are stepping into the **SculptXR** project, a WebXR-based sculpting and animation tool.

### 🚀 Active Objective
We are currently debugging the **WebXR startup latency** (the "gray void" issue) where the screen hangs for ~5 seconds upon entering VR.

### 🛠 Recent Achievements
- **VR UI Stability (v1.0.213)**: Implemented interaction shields (`_ignoreUntilRelease`) and click-bleed protection (`_justClosedOverlay`) to stabilize UI interactions.
- **Animation System**: Stabilized the **AutoKey** logic, ensuring keys are generated correctly on the first move and handling undefined playback times. Frame 0 initialization is now standard for new tracks.
- **Tool Swapping**: Enforced 'GRAB' mode transitions during 'TRANSFORM' operations for consistency.

### 🔍 Known Issues & Next Steps
1. **Investigate Startup Delay**: Profile the transition between `setSession` and the first render frame. Check if controller initialization or network asset loading blocks the loop.
2. **Fix WebGL Errors**: Resolve `GL_INVALID_FRAMEBUFFER_OPERATION` errors during VR entry.
3. **Verify AutoKey**: Ensure AutoKey triggers reliably in all scenarios in VR.

## Context
- Framework: Three.js (v1.0)
- UI: Damped sliders, Numberpad overlays.
- State Management: Command Pattern for Undo/Redo.
