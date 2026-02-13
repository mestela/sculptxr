# Handover: Drag-to-Scroll & Stability (v0.7.429+)

## Current Status
- **Goal:** Enhancing Main Panel Usability and Stability.
- **Latest Version:** `v0.7.429` (Deployed to Production).
- **Status:** **STABLE**.
  - **Drag-to-Scroll**: Main Panel background can now be dragged to scroll (smooth & responsive).
  - **Regression Fix**: Tool Selection logic restored (was broken in v0.7.427).
  - **Lock Selection**: UI removed temporarily (needs further work).
  - **Left Hand Mode**: Fully functional (v0.7.416).

## Solutions Implemented
1.  **Drag-to-Scroll**: Modified `GuiXR.js` `onInteract` to prioritize background drags while respecting widget interactions.
2.  **Debounce Logic**: Set `debounceTime = 0` for scroll interactions to ensure 60fps responsiveness.
3.  **Deployment**: Production deployment script (`deploy_production.sh`) created and verified.

## Next task
Ask user

## Environment
-   **URL:** `https://tokeru.com/sculptxr/`
-   **Repo:** `https://github.com/mestela/sculptxr`
-   **Deploy Prod:** `./deploy_production.sh`
-   **Deploy Beta:** `./deploy_beta.sh`
