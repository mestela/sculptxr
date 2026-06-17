# Handover Prompt (Protocol Enforced)

**Project Status**: VR Crease overhaul + blocky-brush fix shipped (v2.7.0, deployed to beta). Next task: build a **canvas-2D blendshape "layer stack" panel** (Nomad-style). Design is locked; no code written yet for it.
**Current Working Directory**: `/Users/mattestela/sculptxr`
**Branch**: `feature/html-in-vr`
**Checkpoint**: clean working tree at v2.7.0 (committed `489c86e2` + docs `1e143266` + deploy record `4dc0ea6e`, all pushed to `origin/feature/html-in-vr`).

## MANDATORY reading (before responding)
You MUST read `overview.md` (repo root) and `docs/code_summary.md` for project context. Also read `project_rules.md` (the repo constitution — Step Id prefix, no auto-commit/deploy, no emoji, VR rules). NO EXCEPTIONS. The auto-memory (`MEMORY.md` + the `project_sculptxr_*` files) loads automatically and carries the full backlog + this task's design.

## Deployed Version
- **Beta**: v2.7.0
- **Prod**: not updated this session

## Interactive Debugging
- **Preference**: browser console for state inspection; provide copy-pasteable snippets. matt uses an ADB remote Chrome console in VR (standard `console.log` is copyable there). `window.screenLog(msg, color)` for on-device HUD.
- Run `npm run bump:patch` yourself on every test handoff (HMR is live; no build event otherwise) so the in-app VERSION updates.

## THE TASK: canvas-2D blendshape layer-stack panel

**Why** (decided 2026-06-17): the existing HTML blendshape UI (`AnimationControlPanel.js` Section 6) has the irreducible HTML-in-WebXR per-paint cost (DOM→SVG→rasterize→GPU upload) on every weight-slider drag. We first tried a "pure split" (strip sliders from the panel, mix weights on the timeline) — matt found it **confusing** (separates "what layers exist" from "how much each is on"), so it was **reverted**. New direction: a **canvas-2D layer stack with sliders** (Photoshop/Nomad-style). A canvas redraw is cheap, so it gives the elegant single-place UX *and* the speed, and sidesteps the HTML raster cost for the one genuinely continuous-interaction panel.

**Per-row design (matt's pick — FULLER):** each layer row = active/select dot (tap → sculpt that layer) · name · weight slider · numeric value · **visibility/mute** (zero its contribution without losing the stored weight) · **solo** (isolate at 1.0). Base layer pinned at the bottom. Toolbar: New, Del; rename via double-click/long-press. **Icons must be vector/FontAwesome drawn on the canvas — NO emoji/unicode glyphs** (recurring matt rule).

**Both platforms are the target; build desktop-first for iteration speed.**

### Build order (increments — each testable)
1. **Desktop canvas panel** — new module (suggest `src/gui/BlendshapeStackPanel.js`). Mirror `GuiTimeline.js`: `document.createElement('canvas')` + `getContext('2d')` + imperative `draw()`; `pointerdown` on the canvas with `setPointerCapture`, `pointermove`/`pointerup` on window; redraw only on interaction/state change. Hit-test rows for: select-dot, slider track (drag → live weight), buttons. Wire to `AnimationRegistry`. Mount into a new **"Blendshapes" tab** in the desktop sidebar (see `MainMenuPanel.js` tab plumbing). Get the UX right here first.
2. **Solo + mute/visibility** — NEW registry support (not present yet): add per-layer `muted` state + a `soloed` layer, and apply them during `applyBlendshapes`/evaluation (muted → weight treated as 0; solo → isolate that layer). Then draw + wire the row icons.
3. **VR mount** — render the canvas to a texture on a panel mesh (reuse the VR timeline's canvas→texture pattern in `Scene.js`: search `_vrTimelineMesh` / `_vrTimelineTexture`; note `texture.dispose()` before `needsUpdate` on resize, r183 quirk). Map the VR ray → canvas x/y and hit-test directly (simpler than the HTML UV→DOM path). Add `'blendshapes'` to the VR main-menu tab strip (`MainMenuPanel.js` sections array ~line 710) + a `TAB_ICON` in `src/gui/tabIcons.js`.
4. **Retire** the old HTML blendshape Section 6 in `AnimationControlPanel.js` once the canvas panel is proven on both platforms.

### Key reference files
- `src/gui/GuiTimeline.js` — the canvas pattern to mirror (canvas ~L91, getContext ~L101, pointer handlers ~L109–135, imperative `draw()`).
- `src/editing/AnimationRegistry.js` — blendshape API (all present): `createBlendshape` ~L798, `setBlendshapeWeight` ~L861, `deleteBlendshape` ~L980, `renameBlendshape` ~L1015, `enterBlendshapeEditMode` ~L1036, `exitBlendshapeEditMode` ~L1050. For increment 2, find `applyBlendshapes`/evaluate and add the mute/solo hook there.
- `src/gui/htmlvr/AnimationControlPanel.js` — current HTML blendshape Section 6 + `refreshBlendshapesDOM` (reference for behavior: rename-on-dblclick, enter/exit edit mode, create/delete, Base row). This is what's being replaced.
- `src/gui/htmlvr/MainMenuPanel.js` — tab strip (sections array ~L710), how the Animation tab embeds `#acp-root`, how to add a tab.
- `src/Scene.js` — VR timeline canvas→texture mounting + resize handle (`_vrTimelineMesh`).

### Gotcha
VR text entry for naming new layers: no VR keyboard exists yet. Default-name new layers ("Layer N") and rename later, or lean on the **ARKit name-library** backlog item (`eyeBlinkLeft`, `jawOpen`, …).

## Workflow rules (non-negotiable — see `project_rules.md`)
- **Step Id prefix** on every chat response (`Step Id: {n}`, increment from the user's last).
- **NO auto-commit / NO auto-deploy** — only when matt explicitly asks. `deploy_beta.sh`/`deploy.sh` are an ask-first gate (run when asked; never self-initiate).
- `npm run bump:patch` per test handoff; `node bump.mjs minor` before a deliberate push; release notes → top of `docs/releases.md` + README (latest entries).
- **No emoji/unicode-glyph buttons** anywhere — FontAwesome or plain text/vector only.
- VR is the priority surface; `Scene.js` is the sole VR input handler.
- Syntax-check edits with `node --check <file>` (esbuild may not be cached). "Count braces" before deep debugging.

## Recently shipped (context, see `docs/releases.md`)
- **v2.7.0**: VR Crease surface-walking anchor (depth-independent — fixed wobble/gallop/waves) + framerate-invariant VR strokes + `<head>` load-order fix. See [[sculptxr-crease-vr-hypothesis]] memory.
- **v2.6.0**: blocky-brush fix — reconnected the incremental octree update that a voxel optimization had frozen mid-stroke. See [[sculptxr-blocky-brush-fix]] memory.
