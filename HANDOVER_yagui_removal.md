# SculptXR — Yagui Removal Handover

## Project basics
- Location: `~/sculptxr`
- Stack: Three.js + WASM WebXR sculpting app
- Build: `npm run build` from `~/sculptxr`
- **Do not auto-commit**

---

## Context: what was done before this task

### GUI architecture (current state)
Three UI systems exist — the goal of this task is to eliminate yagui:

1. **mm-* HTML system** (`src/gui/htmlvr/MainMenuPanel.js`) — the "right" system going forward. Builds HTML strings via `buildMenuHTML_*` functions, wires them via `wireMenu*` functions. Used by the VR main panel and desktop sidebar sections.
2. **yagui** (`import yagui from 'yagui'`) — legacy system, still owns the desktop topbar and several dropdown menus. **This is what we're removing.**
3. **Canvas timeline** (`src/gui/GuiTimeline.js`) — intentionally kept as canvas; leave it alone.

### What already uses mm-* (not yagui)
- Desktop sidebar: WebAwesome vertical tabs (Scene / Rendering / Topology / Sculpting / Animation) — each tab panel is populated by `buildSectionHTML_*` + `wireSectionScene/Rendering/Topology/Sculpting` from `MainMenuPanel.js`
- VR main panel (`src/gui/htmlvr/MainMenuPanel.js`) — HTMLVRPanel subclass
- Files menu content: `buildMenuHTML_files(main)` + `wireMenuFiles(el, main, rebuildFn, onBrowserSavesOpen)`
- History menu content: `buildMenuHTML_history(main)` + `wireMenuHistory(el, main, repaintFn)`
- Browser saves gallery: `buildMenuHTML_browserSaves(main)` + `wireMenuBrowserSaves(el, main, rebuildFn)`
- `FilesPanel` (`src/gui/htmlvr/FilesPanel.js`) — floating HTMLVRPanel overlay for browser saves in VR
- `openFilesDOMOverlay(main)` / `openBrowserSavesDOMOverlay(main)` — exported from `FilesPanel.js`, used on desktop

### mm-* CSS classes (injected by `injectMMCSS()` from MainMenuPanel.js)
- `mm-action-btn` — standard button
- `mm-toggle` / `mm-toggle.active` — toggle button
- `mm-section-title` — section header
- `mm-row` — label + input + value row
- `mm-lbl`, `mm-val` — label/value spans in a row
- `mm-btn-pair` — two buttons side by side
- `mm-choice` / `mm-choice.active` — mutually exclusive choice button
- `mm-info` — muted info text

### Key patterns to follow

**buildMenuHTML_* pattern:**
```js
export function buildMenuHTML_camera(main) {
  const someState = main._someProperty ?? default;
  return `
    <div class="mm-section-title">Camera Reset</div>
    <div class="mm-btn-pair">
      <button class="mm-action-btn" id="mm-cam-center">Center</button>
      <button class="mm-action-btn" id="mm-cam-front">Front</button>
    </div>
    ...
  `;
}
```

**wireMenu* pattern:**
```js
export function wireMenuCamera(el, main, repaintFn) {
  const q = (sel) => el.querySelector(sel);
  q('#mm-cam-center')?.addEventListener('click', () => { main.resetCamera?.(); repaintFn?.(); });
  // etc.
}
```

**Always call `fixSliderDrag(el)`** after wiring any panel that has `<input type="range">` sliders. Import from MainMenuPanel.js.

---

## What yagui currently owns (inventory)

### `Gui.js` structural usage
- `new yagui.GuiMain(viewport, onResize)` — main layout wrapper
- `this._guiMain.addTopbar()` → `this._topbar` — the horizontal menu bar
- `this._guiMain.addRightSidebar()` → `this._sidebar` — wraps the WebAwesome tabs (sidebar content is already custom HTML appended into this; removing yagui here means the WebAwesome tabGroup needs a new parent)
- `this._topbar.addExtra()` — the "Extra" dropdown
- `this._topbar.addMenu()` — used for notifications and About button

### Gui* classes and their yagui menus

**`GuiScene`** — menu title "Scene"
- Buttons: Reset Scene, Add Sphere, Add Cube, Add Cylinder, Add Torus, Add Grid, Merge, Duplicate, Delete
- Checkboxes: Isolate, Show Contour, Show Grid, Show Symmetry Line
- Sliders: Grid Opacity (0–1), SymOffset (−1–1)
- Key handlers: `I` (isolate), `Ctrl+D` (duplicate)
- **STATUS: DELETE** — sidebar Scene tab already has all of this. Extract key handlers as standalone listeners.

**`GuiStates`** — menu title "History"
- Buttons: Undo (Ctrl+Z), Redo (Ctrl+Y)
- Slider: Max undo stack (3–500)
- Key handlers: `Ctrl+Z`, `Ctrl+Y`
- **STATUS: DELETE** — keyboard shortcuts cover this; VR history menu also has it. Extract key handlers as standalone listeners.

**`GuiBackground`** — menu title "Background"
- Combobox: Type (Image / Environment / Ambient env)
- Slider: Blur (0–1, conditional on type)
- Buttons: Reset Background, Import Background
- Checkbox: Fill
- **STATUS: CONVERT** to `buildMenuHTML_background` + `wireMenuBackground`

**`GuiCamera`** — menu title "Camera"
- Buttons: Center, Front, Left, Top
- Combobox: Projection (Perspective / Orthographic)
- Slider: FOV (10–90°, conditional)
- Combobox: Camera Mode (Orbit / Spherical / Plane)
- Checkbox: Pivot
- Combobox: Desktop canvas in VR (Blank / Mirror / Desktop free / Spectator)
- Combobox: Spectator FPS (Full / ½ / ¼ / ⅛)
- Slider: Speed (0.05–1.0)
- Key handlers: WASD/QZ camera movement, Shift+rotate snaps angle
- **STATUS: CONVERT** to `buildMenuHTML_camera` + `wireMenuCamera`. Keep key handlers.

**`GuiTablet`** — menu title "Pressure"
- Sliders: Radius Factor (0–1), Intensity Factor (0–1)
- **STATUS: CONVERT** to `buildMenuHTML_tablet` + `wireMenuTablet`

**`GuiConfig`** — menu title "Language"
- Combobox: language selector (from `TR.languages`)
- **STATUS: CONVERT** — tiny, fold into a Settings/⚙ dropdown

**`GuiMesh`** — NOT a dropdown menu
- Appends vertex count and face count text nodes directly to topbar DOM
- Updated via `updateMeshInfo()`
- **STATUS: CONVERT** — replace with a `<span id="desktop-mesh-stats">` in the new topbar; update it wherever `updateMeshInfo()` is called

**`GuiFiles`** — menu title "Files"
- Has `menu.addButton('Browser Saves…', () => window.openBrowserSaves?.())` and yagui items for import/export
- Critical methods used throughout codebase: `saveToBrowserStorage`, `saveFileAsSGL/GLB/OBJ/PLY/STL`, `saveTextureDiffuse/Roughness/Metalness`, `refreshBrowserSaves`, `loadSpecificBrowserSave`, `deleteBrowserSave`
- Properties read by VR: `_exportAll`, `_objColorZbrush`, `_objColorAppended`, `_browserSaves`, `_texSize`
- **STATUS: GUT `init()` only** — keep all methods and properties. The topbar "Files" button uses `buildMenuHTML_files` + `wireMenuFiles` (already built).

**Extra menu** (inline in `Gui.js`):
- Contour Color picker → move to Rendering sidebar section (or ⚙ dropdown)
- Pixel Ratio slider → same
- Voxel Res + Voxel Rad Mult sliders → ⚙ dropdown (developer settings)
- Controller Model combobox → ⚙ dropdown
- Force Grey Controllers checkbox → ⚙ dropdown
- Show Debug Log / Show Eruda Console checkboxes → ⚙ dropdown
- Clear Log button → ⚙ dropdown

---

## The removal plan (step by step)

### Step 1 — Delete GuiScene and GuiStates
In `Gui.initGui()`:
- Remove `this._ctrlScene = new GuiScene(this._topbar, this)`
- Remove `this._ctrlStates = new GuiStates(this._topbar, this)`
- Remove their imports
- Extract key handlers as inline entries in `this._ctrls`:
  ```js
  ctrls[idc++] = {
    onKeyDown: (event) => {
      if (event.handled) return;
      const key = event.which;
      if (event.ctrlKey && key === 90) { /* undo */ event.handled = true; }
      if (event.ctrlKey && key === 89) { /* redo */ event.handled = true; }
      if (key === 73 && !event.ctrlKey) { /* isolate */ event.handled = true; }
      if (event.ctrlKey && key === 68) { /* duplicate */ event.handled = true; }
    }
  };
  ```
- Check `this._ctrlScene.updateMesh()` callsites — replace with direct calls or remove if redundant with sidebar rebuild

### Step 2 — Build the new HTML topbar
Replace `yagui.GuiMain` + `addTopbar()` with a custom `<div>` structure.

**Topbar layout:**
```
[Files ▾] [Camera ▾] [Background ▾] [Pressure ▾] [⚙ ▾]  |  12,345 verts  24,690 faces
```

The topbar is `position:fixed; top:0; left:0; right:Xpx` (leaving room for the sidebar). Each button opens a floating dropdown panel below it. Clicking outside closes all dropdowns.

**Dropdown behavior:**
- Each menu button toggles a `<div class="desktop-dropdown">` that appears below the button
- Dropdown content is built by calling `buildMenuHTML_*` + `wireMenu*`
- One shared `document.addEventListener('mousedown', closeAllDropdowns)` closes all on outside click
- Rebuild content on open (so state is always fresh)

Create this in `src/gui/DesktopTopbar.js` or inline in `Gui.js`. Simpler to inline given it's tightly coupled to Gui.js.

**Sidebar parent:** The WebAwesome tab group currently appended to `this._sidebar.domSidebar` needs a new parent. Replace with a plain `<div id="gui-sidebar">` appended to `document.body` or `viewport`, positioned with CSS (`position:fixed; top:topbarHeight; right:0; width:380px; bottom:0`).

### Step 3 — Convert remaining menus to mm-* HTML
Add these exports to `MainMenuPanel.js` (at the bottom, same as `wireMenuFiles`/`wireMenuHistory`):

- `buildMenuHTML_camera(main)` + `wireMenuCamera(el, main, repaintFn)`
- `buildMenuHTML_background(main)` + `wireMenuBackground(el, main, repaintFn)`
- `buildMenuHTML_tablet(main)` + `wireMenuTablet(el, main, repaintFn)`
- `buildMenuHTML_settings(main)` + `wireMenuSettings(el, main, repaintFn)` — the ⚙ dropdown (pixel ratio, contour color, voxel settings, debug controls)

Read the original Gui* class `init()` methods carefully to replicate all state reading and all action wiring.

For GuiCamera — the key handlers (WASD, Shift+rotate) must be preserved. Move them to `GuiCamera.onKeyDown` if not already there, and keep GuiCamera in `this._ctrls` (just gut its `init()`, keep `onKeyDown`).

### Step 4 — Vertex/face count
- Add `<span id="desktop-mesh-stats" style="...">` to the topbar HTML
- In `Gui.js`, add an `updateMeshInfo()` method that sets `#desktop-mesh-stats` text content
- Replace `this._ctrlMesh.updateMeshInfo()` callsites with `this.updateMeshInfo()`

### Step 5 — Remove yagui
- Remove `import yagui from 'yagui'` from `Gui.js`
- Remove `this._guiMain`, `this._topbar`, `this._sidebar` and all `.domSidebar`, `.domResize` references
- `npm run build` — fix any remaining references
- Remove `"yagui"` from `package.json` dependencies (run `npm uninstall yagui` or edit manually)

---

## Critical constraints

### callFunc / this._ctrls
`Gui.callFunc('onKeyDown', event)` iterates `this._ctrls` and calls `onKeyDown` on each controller. Any class with key handlers **must remain in `this._ctrls`** even after gutting its `init()`. This includes: GuiCamera (WASD), GuiFiles (Ctrl+O/E), GuiSculpting, GuiTopology.

### getGui() references
`main.getGui()._ctrlFiles` is called from VR code (Scene.js, MainMenuPanel.js, FilesPanel.js) to access GuiFiles methods and properties. `this._ctrlFiles` must remain a live GuiFiles instance with all its methods intact. Same for `_ctrlSculpting`, `_ctrlTopology`.

### updateMesh() chain
`Gui.updateMesh()` is called from Scene.js after mesh selection changes. It currently calls:
```js
this._ctrlScene.updateMesh();   // ← needs replacement
this._ctrlMesh.updateMeshInfo(); // ← needs replacement
```
Replace with direct logic inlined into `Gui.updateMesh()`.

### Sidebar DOM
The WebAwesome tab group (`<wa-tab-group>`) is currently appended to `this._sidebar.domSidebar` (a yagui DOM node). When yagui is removed, the tabGroup needs a real parent. Make a plain `<div id="gui-sidebar">` and append to the viewport element or body.

### GuiFiles methods used by VR
These methods on `this._ctrlFiles` are called from non-GUI code and must continue to work:
- `saveToBrowserStorage()`, `saveFileAsSGL()`, `saveFileAsGLB()`, `saveFileAsOBJ()`, `saveFileAsPLY()`, `saveFileAsSTL()`
- `saveTextureDiffuse()`, `saveTextureRoughness()`, `saveTextureMetalness()`
- `refreshBrowserSaves()`, `loadSpecificBrowserSave(key)`, `deleteBrowserSave(key)`
- Properties: `_exportAll`, `_objColorZbrush`, `_objColorAppended`, `_browserSaves`, `_texSize`

---

## Files to read before starting
1. `src/gui/Gui.js` — full file; understand the yagui structure and what's already been replaced
2. `src/gui/GuiCamera.js` — to build `buildMenuHTML_camera`
3. `src/gui/GuiBackground.js` — to build `buildMenuHTML_background`
4. `src/gui/GuiTablet.js` — to build `buildMenuHTML_tablet`
5. `src/gui/GuiConfig.js` — for language selector
6. `src/gui/GuiScene.js` — to extract key handlers before deleting
7. `src/gui/GuiStates.js` — to extract key handlers before deleting
8. `src/gui/GuiMesh.js` — to understand what updateMeshInfo does
9. `src/gui/htmlvr/MainMenuPanel.js` — bottom of file, see existing wireMenu* exports for the exact pattern to follow
