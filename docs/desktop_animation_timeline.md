# Desktop Animation Timeline & UI Refinements

This document covers the recent enhancements and fixes applied to the Desktop Animation Timeline and associated UI elements in SculptXR.

## 1. Timeline Behavior
- **Playhead Snapping**: The playhead now snaps to integer frames based on `window._animFPS` (default 24), ensuring frame-perfect alignment across both Desktop and VR modes.
- **Default Visibility**: The timeline is now hidden by default in Desktop mode to reduce UI clutter on startup. It can be enabled via the "Show Timeline" checkbox in the Animation menu.
- **Clean Empty State**: The message "No recorded tracks in memory." has been removed from the empty timeline view to keep the interface clean.

## 2. Transform Box
- **Opt-in Logic**: The Transform Box is now strictly opt-in and defaults to off. It will not appear automatically when a single key is selected, preventing unintended UI clutter during simple interactions.

## 3. XR UI Layering & Visibility
- **Occlusion Fix**: The custom "Enter VR" and "Enter AR" buttons (in `#xr-ui`) have been assigned a `z-index` of `10000` to guarantee they render above the animation timeline (which has a `z-index` of `2000`) and all other UI elements.
- **Positioning**: The buttons remain at the bottom center of the screen, resolving conflicts where they were previously buried beneath the timeline in some environments (like GalaxyXR).

## 4. OpenXR Detection Warning
- **Non-Blocking Alert**: The "OpenXR not detected" warning dialog has been redesigned to be non-intrusive:
    - It fades in over `0.25s`.
    - It holds for `5 seconds` to allow reading.
    - It fades out over `0.25s`.
    - If clicked/tapped, it immediately fades away in `0.1s`.
- **Layout**: All text is now conformed to a single line and single font size to keep it compact and readable.
