# Task: Stabilize Edge Dissolve Tool

> [!IMPORTANT]
> **CRITICAL SESSION RULES**:
> 1.  **Step Id**: Start EVERY response with `Step Id: {id}`. Increment from the user's last `Step Id`.
> 2.  **No Caching Blame**: Browser caching is NEVER the valid cause of bugs here. Do not suggest clearing cache.
> 3.  **Local Vite Testing**: Rely ENTIRELY on local Vite (`npm run dev`) for testing. Do NOT deploy to Beta or Prod.

- [x] Analyze Edge Dissolve Tool implementation and find sources of mesh corruption during undo/redo <!-- id: 0 -->
- [x] Refactor undo/redo to use pre-instantiated mesh swapping instead of repeated dynamic allocations <!-- id: 1 -->
- [x] Verify if colors/materials also need to be copied during mesh replacement <!-- id: 2 -->
- [ ] Test locally using Vite <!-- id: 3 -->
- [x] Create walkthrough artifact <!-- id: 4 -->
