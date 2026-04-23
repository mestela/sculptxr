# Task: Unify Timeline and Graph Editor Code

> [!IMPORTANT]
> **CRITICAL SESSION RULES**:
> 1.  **Step Id**: Start EVERY response with `Step Id: {id}`. Increment from the user's last `Step Id`.
> 2.  **No Caching Blame**: Browser caching is NEVER the valid cause of bugs here. Do not suggest clearing cache.
> 3.  **Local Vite Testing**: Rely ENTIRELY on local Vite (`npm run dev`) for testing. Do NOT deploy to Beta or Prod.

- [x] Create `src/gui/TimelineHelper.js` with shared math and logic <!-- id: 0 -->
- [x] Refactor `src/gui/GuiTimeline.js` to use `TimelineHelper` <!-- id: 1 -->
- [x] Refactor `src/gui/GuiXR.js` to use `TimelineHelper` <!-- id: 2 -->
- [x] Verify graph rendering in Desktop and VR (Desktop verified by user) <!-- id: 3 -->
