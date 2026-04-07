# Task: Implement Custom Ray-Plane / Sutherland-Hodgman Edge Slicer

> [!IMPORTANT]
> **CRITICAL SESSION RULES**:
> 1.  **Step Id**: Start EVERY response with `Step Id: {id}`. Increment from the user's last `Step Id`.
> 2.  **No Caching Blame**: Browser caching is NEVER the valid cause of bugs here. Do not suggest clearing cache.
> 3.  **Local Vite Testing**: Rely ENTIRELY on local Vite (`npm run dev`) for testing. Do NOT deploy to Beta or Prod.

- [x] Create Implementation Plan for the JS Edge Slicer <!-- id: 0 -->
- [x] Implement Sutherland-Hodgman face intersection with the X=0 plane <!-- id: 1 -->
- [x] Implement dynamic epsilon scaling and precision edge cases <!-- id: 2 -->
- [x] Implement fallback quadrangulation/triangulation for clipped N-gons <!-- id: 3 -->
- [x] Integrate with `GeometryWorker.js` for asynchronous handling <!-- id: 4 -->
