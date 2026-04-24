# Plan - Flight Recorder (Emulation & Playback)

## Objective
Create a system to record WebXR input streams (controller poses, button states) and replay them to reduce headset friction during development and testing, especially for menu and timeline operations.

## Core Components
- `FlightRecorder.js`: New module to manage recording state, buffer storage, and serialization.
- `Scene.js` Hooks: Intercept the live WebXR input in `handleXRInput` to either record it or override it with recorded data.

## Data Schema
The recording will be stored as an array of frame objects:
- `f`: Frame number (integer).
- `t`: Delta time since last frame (float).
- `hmd`: Head position and rotation.
- `left`/`right`: Controller data:
    - `p`: Position `[x, y, z]`.
    - `r`: Rotation quaternion `[x, y, z, w]`.
    - `b`: Button states (mask or boolean map).

## Data Flow

### Recording Mode
1. User triggers recording via debug key or menu.
2. `Scene.js` reads live input from `navigator.xr`.
3. Input is applied to the scene and passed to `FlightRecorder`.
4. `FlightRecorder` pushes the frame data to a buffer.

### Playback Mode
1. User loads a recorded file and triggers playback.
2. `Scene.js` bypasses `navigator.xr`.
3. `FlightRecorder` provides the data for the current frame index.
4. `Scene.js` constructs mock WebXR input objects and passes them to the interaction systems.

## Specific Focus: Menu & Timeline Operations
- The system relies on raycasting from controller poses.
- By replaying poses and trigger clicks, the simulated rays will interact with the VR menu (and timeline) exactly as recorded.
- Requires Desktop Preview mode to be active to observe the UI response on screen.

## Addendum: Details for Future Implementation
To make this plan fully actionable for an assistant with fresh context, the following details would need to be investigated or decided:

### 1. Investigation Points
- **Target Function**: We need to verify where `Scene.js` polls the WebXR input sources.
- **Input Structure**: We need to inspect how the project handles the WebXR `Gamepad` API or button presses to ensure the mock objects match perfectly.

### 2. Mocking Strategy
- The mock objects created during playback must satisfy all property accesses (e.g., `.pose`, `.buttons`, `.axes`) that the existing code expects.

### 3. Data Extraction
- Since we are running locally via Vite, the easiest way to "save" the recording without complex server-side code is to stringify the JSON and log it to the console, or expose it to a global variable (`window.lastRecording`) that can be copy-pasted or saved via the browser developer tools.
