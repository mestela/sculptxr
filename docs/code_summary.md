# SculptXR Architectural Overview

This document provides a high-level summary of the SculptXR codebase, focusing on the interactions between core systems, the Three.js rendering pipeline, and WebXR integration.

## Architecture & Data Flow

SculptXR follows a top-down delegation pattern for handling interactions, especially in VR:

1.  **Input Gathering (`Scene.js`)**: Captures WebXR controller poses, handles raycasting against the UI, and packages controller button states.
2.  **Dispatch (`SculptGL.js` & `SculptManager.js`)**: Forwards input data to the active tool instance.
3.  **Execution (`SculptBase.js` & Subclasses)**: The active tool processes the input.
    *   **Continuous Stroke Tools**: (e.g., Brush, Smooth) Sample positions along the controller path and apply localized deformation.
    *   **One-Shot Click Tools**: (e.g., SplitFace, Weld) Execute their logic entirely within the `start()` method on initial trigger press, ignoring the continuous stroke.
4.  **Heavy Lifting (`GeometryWorker.js`)**: Complex operations (Voxel remeshing, CSG Booleans, Symmetry Mirroring) are offloaded to a worker thread to maintain high frame rates in VR.
5.  **Rendering Bridge (`Mesh.js`)**: Converts the internal quad/triangle data structures into flat arrays suitable for Three.js GPU buffers and handles matrix synchronization with WebXR.

---

## Tool Registry & VR Status

Instead of listing all 25 tools individually, they are categorized by their architectural behavior in VR.

### Standard Stroke Tools
These tools inherit the default continuous stroke behavior from `SculptBase` without modification. They work reliably by sampling the controller path in physical space.
*   `Brush`, `Inflate`, `Smooth`, `Flatten`, `Pinch`, `Crease`, `Relax`, `Masking`, `LocalScale`.

### One-Shot Click Tools (Low-Poly)
These tools inherit from `SculptBase` but set `_continuous = false` and do not implement `stroke()`. They execute their operation once on trigger press based on the picked element.
*   `DeleteFace`, `FillHole`, `DissolveEdge`, `SplitFace`, `SpinEdge`, `CollapseEdge`, `DissolveVertex`, `Weld`.
*   `SnapWeldCenter`: A specialized tool to clean up the centerline seam by detecting and collapsing diamond faces into a single straight edge.

> [!IMPORTANT]
> **Data Retention Requirement**: When implementing tools that replace the mesh object entirely (like `DeleteFace` and `FillHole`), you must explicitly clone and transfer the `colors` and `materials` (roughness/metalness) arrays to the new mesh. Tools that modify the geometry in-place retain this data automatically.

### Special Cases (Overridden `updateXR`)

| Tool | Status | Key Behavior / Complexity |
| :--- | :--- | :--- |
| **`Twist`** | VR Supported | Overrides `updateXR` for a continuous "Drill Mode" rotation effect. |
| **`Drag`** | VR Supported | Calculates 3D delta from controller movement. Uses symmetry plane blending to prevent tearing. |
| **`Paint`** | VR Supported | Manages a state machine for the VR Eyedropper and live color sampling. |
| **`Move`** | VR Supported | Full 6DOF movement. Forces full octree rebuilds on completion. |
| **`TransformVR`** | VR Supported | Provides a dedicated 3D gizmo for precise Translate/Rotate/Scale in VR. |
| **`SculptVoxel`** | VR Supported | Communicates with `GeometryWorker`. Handles volume advection and custom trigger pressure curves. See modes below. |
| **`Transform`** | **Desktop Only** | The VR update method is a safety stub to prevent crashes. |

---

## VR Brush Centre & Stroke Pacing

*   **Brush centre (volume mode)**: In VR volume-intersect mode the brush centre is the **nearest surface point to the controller tip** (`Picking.intersectionSphereMeshes`, called from `Scene.processVRSculpting`). This jitters when the tip is held off-surface, which feeds back into pinch-style tools.
*   **Surface-walking anchor (Crease only, v2.7.0)**: Crease keeps an on-surface anchor, advances it by the controller's per-frame motion, and **re-snaps it to the surface each frame** — the re-snap discards the depth (normal) component, so the brush walks the surface laterally and ignores how far above/below the tip drifts (depth-independence, like desktop's screen-ray pick). Lives in `Scene.processVRSculpting`, gated on `toolIndex === Enums.Tools.CREASE`; other tools use the raw tip projection. Fixed the long-standing crease wobble/gallop/waves.
*   **Framerate-invariant strokes**: `SculptBase.sculptStrokeXR` gates application on **per-distance spacing** (`minSpacing = 0.02 * worldRadius`), so VR deformation tracks distance travelled, not frame count — without it, holding the trigger stamped the brush every frame (~3x over-accumulation at 90 vs 30 fps). Runtime toggles: `window._vrStrokeThrottle` (false = old per-frame), `window._vrStrokeSpacing`. Affects the standard stroke brushes (Brush, Inflate, Smooth, Flatten, Pinch, Crease, Masking, LocalScale); tools that override `updateXR` (Move, Drag, Twist, Grab, Slide, Paint, Voxel, Extrude, Inset, Cut) are unaffected.

---

## Persistence & Options Subsystem

SculptXR manages state and settings across sessions using a combination of URL parameters, Local Storage, and IndexedDB:

### 1. Options & Settings (`getOptionsURL.js`)
*   **Role**: Centralized configuration manager that loads settings on startup and provides methods to save them.
*   **Data Sources**:
    *   **URL Parameters**: Highest priority. Used for session-specific overrides (e.g., loading a specific model via `modelurl`).
    *   **Local Storage**: Used for persistent user preferences (e.g., UI theme, brush sizes, voxel resolution). Stored under the key `sculptxr_settings` as a JSON string.
*   **Key Behavior**:
    *   Exposes a function `getOptionsURL()` that returns a snapshot of resolved options.
    *   Provides `getOptionsURL.saveOption(key, value, debounceMs)` to persist settings back to `localStorage` with optional debouncing.

### 2. Large Data Storage (`StorageDB.js`)
*   **Role**: Wrapper around browser **IndexedDB** for storing large assets like meshes and projects.
*   **Key Behavior**:
    *   Opens a database named `SculptXR_Workspace`.
    *   Uses a single object store `assets` to store key-value pairs.
    *   Provides asynchronous `get`, `set`, `delete`, and `getAll` methods returning Promises.

---

## Undo & State Management

SculptXR manages history and undo/redo operations via `StateManager.js` using several distinct mechanisms:

*   **Localized Geometric Undo**: For standard brushes (e.g., Sculpt, Paint), the system records only the modified vertex indices and their previous attributes (position, color) before a stroke. This keeps memory overhead low.
*   **Custom Undo/Redo Functions (`pushStateCustom`)**: For complex operations changing mesh topology or visibility (like Quad Remeshing and Voxel Conversion), the system allows pushing custom function pairs. This is used to handle adding/removing meshes and toggling visibility of source meshes in a single atomic step.
*   **Worker-Side History**: Inside `GeometryWorker.js`, a local stack of distance fields is maintained. This allows rapid undo/redo of voxel operations without needing to transfer huge volumes of grid data back and forth to the main thread.

---

## The Voxel Sculpting Tool (`SculptVoxel.js`)

Unlike standard mesh brushes, the `Voxel` tool operates as a multi-mode sub-engine within a single tool slot. It delegates heavy lifting to `GeometryWorker.js` and supports the following modes (selectable in the VR HUD):

*   **Add / Subtract**: Mutates the distance field by combining sphere or cube signed distance functions (SDFs).
*   **Inflate / Deflate**: Shifts the isosurface outwards or inwards along the gradient.
*   **Smooth**: Applies a localized 3D blur to the distance field to soften edges.
*   **Move**: The most complex mode. It uses **Volumetric Advection** (multi-step ODE Euler integration) to shift volume according to controller movement without losing mass or causing tearing.

---

## Core System Summaries

### VR UI: Legacy Canvas System (`GuiXR.js`, `GuiVRTools.js`, `VRMenu.js`)
*   **Role**: The original VR menu system. `GuiXR.js` manually paints all widgets to an `OffscreenCanvas`; `VRMenu.js` wraps that canvas as a Three.js plane texture; `GuiVRTools.js` is the widget factory for the Tools tab.
*   **Status**: Being replaced by the HTMLVRPanel system (see below). Still active for Popup and non-Tools tabs (Scene, Topology, Rendering, etc.).
*   **Key Logic**:
    *   **Dynamic HUD**: Exposes specialized controls based on the active tool (e.g., axis constraints for `TransformVR`, resolution settings for `Voxel`).
    *   **Direct Mutation**: Callbacks directly set properties on the active tool instance.
*   **Deep Dive**: `docs/VR_UI_OVERHAUL.md`

### VR UI: MiniHUD (`GuiXR.js` with `_isMiniHUD = true`, `VRMenu.js`)
*   **Role**: Always-on compact panel permanently attached to the **non-dominant** wrist. The primary interface during active sculpting — the user never has to open a menu to adjust radius/intensity.
*   **Status**: **Next migration target.** Currently suppressed (hidden + raycasting disabled) when the HTML BrushPanel is active (`window._brushPanelEnabled !== false`). Toggle with `window.toggleBrushPanel(false)` to fall back to the legacy canvas MiniHUD.
*   **Canvas size**: 300 × 500 px. Offset: `(0.0, 0.05, -0.05)`, rotation: `(-π/2, π/8, 0)` (flat on palm, tilted toward user).
*   **Widget subset** (filtered from full Tools tab by `_isMiniHUD` flag in `GuiXR._getWidgets()`):
    *   **Main Menu button** — opens/closes the full `GuiXR` panel.
    *   **Tool select button** (large, tinted by tool type) — tapping opens a 3-column tool picker overlay.
    *   **Radius / Intensity sliders** — live-update the active tool.
    *   **Negative / Symmetry / Wireframe toggles**.
    *   **Color picker** (square, fills remaining height) — only shown for Paint tool.
    *   **Mask Clear / Invert** — side-by-side, shown for Masking tool.
    *   **Hardness** — shown where applicable.
*   **Key constraint**: `isMiniHUD = true` is passed to `getToolsWidgets()`, which switches to a wider single-column layout (710px vs 550px) and skips tool-specific secondary settings panels.

### VR UI: HTML Panel System (`src/gui/htmlvr/`)
*   **Role**: Replacement for the GuiXR canvas system. Renders real HTML/CSS panels into WebGL textures via the `three-html-render` polyfill, displayed on `PlaneGeometry` meshes attached to the controller wrist (or pinned in world space).
*   **Status**: Active. `BrushPanel` (Tools tab) is the first migrated panel. GuiXR legacy system still runs alongside for unported tabs.
*   **Three files**:
    *   `install.js` — singleton; installs rAF intercept + polyfill at module load time; owns the hidden host canvas; dispatches `onpaint` to registered panels.
    *   `HTMLVRPanel.js` — base class; owns the Three.js mesh, texture pipeline (via `captureElementImage` → `texture.needsUpdate`), UV→DOM hit mapping, and pointer dispatch.
    *   `BrushPanel.js` — concrete panel; Catppuccin Mocha HTML template; wires sliders/toggles/tool buttons to `SculptManager` state; supports wrist-follow and world-space pin/unpin.
*   **Runtime toggle**: `window.toggleBrushPanel()` — flips between HTML panel (new) and GuiXR canvas + MiniHUD (old). `window.toggleBrushPanel(false)` forces legacy mode.
*   **Key constraints**:
    *   The rAF intercept in `install.js` **must** be the first `three-html-render` import. Chrome pauses `window.requestAnimationFrame` in XR immersive mode; pending rAFs are drained manually each frame via `drainRAF()`.
    *   `ThreeHTMLRenderer` is intentionally not used — it routes texture uploads through a direct WebGL path (`texElementImage2D`) that bypasses Three.js's state machine and freezes the VR render.
    *   Only call `requestPaint()` when content is dirty (not every frame) — SVG rasterisation of a complex panel takes 20–80 ms.
    *   UV→DOM mapping: `relX = uv.x * width`, `relY = uv.y * height` (no inversion). The inversion used in the standalone test (`1 - uv.y`) was an artefact of `ThreeHTMLRenderer` applying `scaleY(-1)` to the DOM element; that transform is absent in the direct polyfill path.
*   **Deep Dive**: `docs/htmlvr.md`

### Mesh Pipeline: `Mesh.js`
*   **Role**: Bridges SculptGL data structures with Three.js rendering.
*   **Key Logic**:
    *   **Three.js Integration**: Constructs `THREE.Mesh` and implements a custom wireframe shader using `gl_FragDepth` to stop depth fighting.
    *   **Matrix Sync**: Disables Three.js `matrixAutoUpdate` and manually pushes engine transforms to ensure WebXR alignment.
    *   **Octree (spatial pick)**: `updateGeometry(iFaces, iVerts)` calls `updateOctree(iFaces)`, which does an **incremental** remove/add of the moved faces each substroke (`updateOctreeRemove`/`updateOctreeAdd`) so the sphere-query (`intersectSphere`, used by every brush's vertex pick) stays accurate while sculpting. The no-arg path rebuilds fully via `computeOctree` (voxel remesh). Leaf split/prune is deferred to `balanceOctree()` at stroke end. **Caution**: this incremental path was once replaced with a no-op `octree.build()` during a voxel optimization, freezing the octree mid-stroke and producing blocky/uneven brush buildup (the picked-vertex set collapsed as faces moved) — restored in v2.6.0. `MeshSafe.js` keeps a parallel correct copy.

### Voxel & Topology Pipeline: `GeometryWorker.js`
*   **Role**: Asynchronous engine for heavy geometry operations.
*   **Key Logic**:
    *   **Hybrid Engine**: Uses `manifold-3d` (C++ via WASM) for robust booleans and a custom Rust module for advanced quad remeshing.
    *   **Greedy Quadrangulation**: Contains a custom port of Blender's `quad_calc_error` metric to merge triangles back into clean quads after destructive operations.
    *   **Worker History**: Maintains a local stack of distance fields to allow instant Undo/Redo of voxel operations without main-thread roundtrips.

### Animation System: `AnimationRegistry.js`, `GuiVRAnimation.js` & `GuiTimeline.js`
*   **Role**: Manages the multi-track animation state and timeline visualization in both VR and Desktop.
*   **Key Logic**:
    *   **Registry**: `window._animationRegistry` stores track data (shapes, times, positions, quaternions, scales) mapped to mesh IDs.
    *   **Timeline UI**: Rendered via `GuiVRAnimation.js` in VR and `GuiTimeline.js` on Desktop.
    *   **Graph Editor**: `GuiTimeline.js` handles both the Dopesheet and Graph Editor on desktop. The Graph Editor supports 2D pivot zoom, marquee selection, and a full 2D transform box for value/time manipulation.
    *   **Undo/Redo**: Integrated with `StateManager.js` for keyframe edit events.
    *   **Live recording**: tools call `beginInteraction`/`endInteraction` at the true start and end of a gesture, so Grab, Transform and TransformVR do not each implement a subtly different "armed, now start". Capture runs on the **transport clock**, not wall time, so keys stay in sync at every playback speed and every control in a multi-target take spans the same loop boundary. Start-on-grab is an armed session (one gesture returns to waiting); countdown and immediate recording are one-shots that disarm on completion.
    *   **Two hands, one take**: each VR controller owns a pin control independently while sharing one capture clock and one undo step. `Scene.js` dispatches tools through a single dominant hand but supplies the complete controller snapshot in `options.controllers` — filtering by `handedness` silently discards the non-dominant trigger.
    *   **Focus is unified**: the last row, key or scene object clicked is the selected object in both the timeline and the 3D view, so there are never two contradictory highlights. Deleting a track removes the whole channel and restores it as the same object on undo, preserving tangents, layers and rest transforms.
    *   **A pinned joint is addressed through its pin** at selection and keying boundaries, so an overlapping joint marker cannot leave focus — or a key — on the driven bone. General selection deliberately does *not* resolve through pins: bones stay selectable for rig setup.
    *   **Mirroring is sparse**: only authored controls are reflected. An unkeyed knee or elbow is solver output and is rebuilt by IK rather than baked because it happened to be in the evaluated pose.

### Rigging & Skinning: `Skeleton.js`, `IKSolver.js`, `SkinMesh.js`, `Skinning.js`, `MotionTrail.js`
*   **Role**: Rigging is a **modelling** tool as much as an animation one — a rig is the fastest way to state a figure's proportions in VR, and `Make Skin` turns that statement into geometry.
*   **Key Logic**:
    *   **`Skeleton.js`**: bones, joints and pin controls are ordinary keyable scene objects. `Skeleton.DISPLAY_FLAGS` is the single registry of bone display flags — each entry is `[liveWindowGlobal, savedOptionKey, default]`, read through `Skeleton.displayFlag()` (live value, then saved, then default) and written through `Skeleton.setDisplayFlag()`. **Every flag in the registry must also be declared in `getOptionsURL.js` under its saved key**, or the toggle silently stops persisting; `scratchpad/bonepanel_test.mjs` asserts this per flag rather than by count.
    *   **`IKSolver.js`**: FABRIK. Capped at **10 sweeps** — a full-body pin arrangement often cannot meet every target, and forty sweeps merely repeated a stalled solve at several times the cost. Activation is fixed for the duration of a solve, so traversal order and filtered child lists are built once. Pins come in two kinds on one cycle: a **hard pin** is a target, a **soft pin** is a steering goal (the pole vector) that swivels a joint about the axis through the two hard pins bracketing it, and therefore costs those pins nothing. The swivel axis is the limb root immediately above the steered joint — searching upward for a hard target made an elbow with pinned hips swivel about the hip-to-wrist axis.
    *   **Evaluation must not carry history**. FABRIK seeds from the current pose, so the same controls reached by scrub, playback and a jump once put the knee up to 0.487 apart. Fixed in v3.19.94; interactive dragging still seeds from the live pose deliberately, so there are two seeding modes. See `docs/ik_orientation_pin_findings.md`.
    *   **`SkinMesh.js`**: a box per joint, **all boxes axis-aligned to the world**, divided four cells a side; each bone claims a rectangle of the side it points at, claimed faces are deleted and bridged, and the cage is relaxed onto the capsules. World alignment is load-bearing: per-bone orientation lets two boxes disagree about roll, which shears the bridge by an amount that depends on the angle the bone was drawn at. Output is all-quad and manifold by construction — a blockout meant to subdivide and remesh cleanly, not a model.
    *   **`Skinning.js`**: binds to the **control cage** (level 0). Binding from a subdivided view analyses each step downward first, directly on the resolution objects, so Bind never drops the viewport to the lowest level as a side effect.
    *   **`MotionTrail.js`**: the selected joint's path over the timeline, drawn as a **line only** — `THREE.Points` uses camera-facing square sprites, which at scene scale hid the model. Off by default: it costs a full evaluation per sample.
*   **Testing**: `scratchpad/ik_test.mjs`, `skinbox_test.mjs`, `mirrorpose_test.mjs`, `motiontrail_test.mjs`, `recording_test.mjs` and the `bonepanel`/`rigpick`/`skellock` harnesses. Each strips imports from the **real source file** so the code under test is the shipped code.

### Viewport Display Is Global, Not Per-Mesh
*   Shader and matcap are a **viewport preference** applied to all ordinary meshes, not a property carried by each one (v3.20.5). Bones, pins and reference images keep their own shaders. Imported files may carry per-object shader choices from the old model; those are overwritten with the global mode once hierarchy flags are restored.
*   All resolutions of a `Multimesh` share **one** `RenderData` / Three.js object. Keeping each parsed level's private copy attached higher-level wireframes to objects that never enter the scene.
*   A wireframe overlay must be built **after** its Three.js mesh is in the scene graph, and reattached on any later refresh — otherwise the saved flag reads true while an orphaned line object stays invisible until a subdivision change rebuilds it.
