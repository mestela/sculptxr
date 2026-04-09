# Task: Enable Multi-Select Matrix Transformation in Grab.js

> [!IMPORTANT]
> **CRITICAL SESSION RULES**:
> 1.  **Step Id**: Start EVERY response with `Step Id: {id}`. Increment from the user's last `Step Id`.
> 2.  **No Caching Blame**: Browser caching is NEVER the valid cause of bugs here. Do not suggest clearing cache.
> 3.  **Local Vite Testing**: Rely ENTIRELY on local Vite (`npm run dev`) for testing. Do NOT deploy to Beta or Prod.

- [x] Broaden the picking payload inside `Scene.js` to include the full multi-select array when `this._lockSelection` is active <!-- id: 0 -->
- [x] Apply the delta matrix transformation to the full array of selected meshes within `Grab.js` instead of just the single intercepted target <!-- id: 1 -->
