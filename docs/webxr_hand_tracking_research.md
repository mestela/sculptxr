# WebXR Hand Tracking Research: Apple Vision Pro vs. Meta Quest 3

This document summarizes findings for supporting WebXR hand tracking, specifically comparing the Apple Vision Pro (AVP) and the Meta Quest 3. This research informs potential future development of a controller-free "finger sculpt" mode for SculptXR.

## Overview

Both headsets support WebXR hand tracking, allowing users to interact with web-based experiences without standard controllers. However, their default interaction models, API surface availability, and onboarding friction differ significantly.

### 1. Immersive AR Mode (`immersive-ar`)

*   **Meta Quest 3:** Supports `immersive-ar`, allowing WebXR applications to utilize full-color, high-resolution passthrough, blending virtual objects seamlessly into the user's physical environment.
*   **Apple Vision Pro (visionOS):** Currently **does not** support the `immersive-ar` session type in Safari. While the AVP is a mixed-reality device, its WebXR implementation is heavily sandboxed for privacy and currently only supports `immersive-vr`.
    *   *Implication for SculptXR:* The passthrough AR mode currently enjoyed by Quest users cannot be replicated on the Vision Pro via WebXR at this time. Experiences on AVP will remain fully virtual (opaque background).

### 2. Hand Tracking Capabilities & Quality

*   **WebXR API Parity:** Both devices can provide access to the standard 25-joint skeletal hand data defined by the WebXR Hand Input API. This data gives the precise 3D transform (position and rotation) of every finger joint.
*   **Tracking Quality (AVP):** Developers report the AVP's hand tracking as highly precise. However, there may be slight latency (estimated 100-200ms) within WebXR compared to native visionOS apps or the Meta Quest. Tracking degrades if hands leave the headset's tracking frustum (field of view).
*   **"Finger Sculpt" Feasibility:** A "finger sculpt" mode is entirely technically feasible on both platforms. We can read the `XRHand` object attached to the `XRInputSource`, grab the `index-finger-tip` joint, and use its transform matrix to position the sculpting tool, replacing the controller position logic.

### 3. Interaction Models & API Differences

This is the most significant difference for developers:

*   **Meta Quest 3 (Direct Access Default):** The Meta Quest Browser historically prioritizes direct access. If the user grants permission, developers immediately receive the full 25-joint skeletal data. The system also exposes proprietary "microgestures" (like a thumb-to-index pinch) via extensions.
*   **Apple Vision Pro (Transient Pointer Default):** For privacy, Apple champions a "transient-pointer" system as the default WebXR interaction model.
    *   The system uses the device's native "look and pinch" mechanic.
    *   The WebXR app *only* receives input data (a ray indicating gaze direction and the pinch coordinate) at the exact moment a pinch occurs. Continuous tracking is hidden by default.
    *   **To get full hand tracking on AVP:** The WebXR application **must explicitly request** the `hand-tracking` optional feature when requesting the session:
        ```javascript
        navigator.xr.requestSession('immersive-vr', {
          optionalFeatures: ['hand-tracking'] // Crucial for AVP & Quest parity
        });
        ```
    *   Once requested and permission granted, the AVP behaves like the Quest, providing the full 25-joint skeleton needed for a "finger sculpt" tool.

### 4. User Onboarding Friction

*   **Meta Quest 3:** WebXR and hand tracking are established features, generally enabled by default in the Oculus/Meta Quest Browser. Users can launch directly into an experience.
*   **Apple Vision Pro:** WebXR is currently considered an *experimental feature*. AVP users must manually navigate deep into Safari settings to enable it:
    *   `Settings > Apps > Safari > Advanced > Feature Flags`
    *   Enable: `WebXR Device API`, `WebXR Hand Input Module`, `WebXR Augmented Reality Module`, and `WebXR GamePads Module`.
    *   *Note:* It is anticipated that WebXR support will improve and potentially be enabled by default in future visionOS updates (e.g., visionOS 2).

## Conclusion

Developing a "finger sculpt" mode (e.g., attaching the tool to the `index-finger-tip` joint) is a viable path that would benefit both Quest and AVP users. The primary technical requirement is ensuring the `hand-tracking` feature is explicitly requested during WebXR session initialization to force the AVP to provide full skeletal data instead of its default transient pointer model. However, AVP users will not be able to use the AR passthrough mode and will face significant friction activating WebXR flags in their device settings.
