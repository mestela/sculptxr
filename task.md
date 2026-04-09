# Task: VR Selection Lock Cleanup and Release

> [!IMPORTANT]
> **CRITICAL SESSION RULES**:
> 1.  **Step Id**: Start EVERY response with `Step Id: {id}`. Increment from the user's last `Step Id`.
> 2.  **No Caching Blame**: Browser caching is NEVER the valid cause of bugs here. Do not suggest clearing cache.
> 3.  **Local Vite Testing**: Rely ENTIRELY on local Vite (`npm run dev`) for testing. Do NOT deploy to Beta or Prod.

- [x] Document the VR Multi-selection Lock system inside `docs/releases.md` <!-- id: 0 -->
- [x] Remove `[LOCK DEBUG]` log inside `Picking.js` <!-- id: 1 -->
- [x] Remove `[LOCK DEBUG]` logs inside `Scene.js` <!-- id: 2 -->
- [x] Remove `[LOCK DEBUG]` log inside `GuiVRScene.js` <!-- id: 3 -->
- [x] Remove `Grab: RELEASED` log inside `Grab.js` <!-- id: 4 -->
- [x] Stage, verify, and push changes <!-- id: 5 -->
