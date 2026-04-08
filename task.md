# Task: Rebuild Inset Tool from Scratch

> [!IMPORTANT]
> **CRITICAL SESSION RULES**:
> 1.  **Step Id**: Start EVERY response with `Step Id: {id}`. Increment from the user's last `Step Id`.
> 2.  **No Caching Blame**: Browser caching is NEVER the valid cause of bugs here. Do not suggest clearing cache.
> 3.  **Local Vite Testing**: Rely ENTIRELY on local Vite (`npm run dev`) for testing. Do NOT deploy to Beta or Prod.

- [x] Analyze Extrude tool's 'Keep Together' disabled mode topology generation <!-- id: 0 -->
- [x] Rebuild Inset tool to use per-face independent topology when Keep Together is disabled <!-- id: 1 -->
- [x] Implement movement vectors aiming towards face midpoints with initial 0 inset <!-- id: 2 -->
- [x] Use controller click/start position to drive distance-based inset amount <!-- id: 3 -->
