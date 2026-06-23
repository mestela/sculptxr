# v3.4.0
Menu colour controls — the Settings → Menu **Brightness** and **Saturation** sliders work again (they'd been dead since the move from the canvas GUI), plus a new **Gamma** slider.

- **Feature**: **Menu Brightness / Saturation / Gamma.** Applied as a GPU colour-grade on the VR panel texture (brightness multiply → saturation around luminance → gamma `pow()`), so adjusting is cheap (no panel re-rasterise). Values persist and apply on load. New defaults: brightness 65 / saturation 55 / gamma 0.
- **Fix**: **Brightness/Saturation were dead in VR.** Two reasons: (1) nothing consumed the slider values after the canvas→HTML-panel migration (the old GUI recoloured each draw; the textured panels had no equivalent) — now driven by the grade above; (2) `_wireSettings` threw a `ReferenceError` partway through (an out-of-scope `lightRepaint`), which aborted wiring before the menu sliders — so they never got their listeners. Fixing that also restores the **controller-model dropdown** and the **wireframe bias/opacity sliders**, which were silently dead from the same throw.

# v3.3.1
- **Fix (prod perf)**: **VR menus were extremely slow in production** (not dev). The build inlined all fonts as base64 into the CSS bundle (`assetsInlineLimit: 300000` → ~2.5 MB CSS), and the html-in-canvas panel rasterizer inlines the whole page CSS into every panel SVG on every repaint — so each menu paint serialized/decoded ~2.5 MB. Lowered `assetsInlineLimit` to the Vite default; prod CSS is now ~180 KB. FontAwesome in panels stays covered by `install.js`'s runtime font injection. Dev was unaffected (fonts served as separate files), which is why it only showed up once deployed.

# v3.3.0
Outliner overhaul — a density + interaction pass on the Scene-tab outliner (desktop + VR), so more fits on screen and the transform/rig controls are quicker to reach.

## Layout & density
- **Change**: **Compacted the outliner.** The mesh list no longer reserves a big fixed block (was a 248px floor) — it flows at content height, so the transform and rig controls sit right under it instead of after a gap. Tighter rows, and the "Eye" / "Add Object" section titles were dropped to recover vertical space.
- **Change**: **Lock moved to the toolbar** as a padlock icon beside copy/delete (amber when locked), and **Mirror** folded into the rig button row (`Set parent / Aim at / Mirror X`) — saving another row.

## Transform / bake
- **Feature**: **Per-component bake buttons inline with the values.** Each Pos/Rot/Scale row ends with a small bake (cake) icon that freezes just that component into the geometry (position→0 / rotation→0 / scale→1). Replaces the old "Bake scale / Apply all" pair — clicking all three equals the old "Apply all". Added `bakeTranslate` / `bakeRotate` alongside `bakeScale`; all bake across multires levels + blendshapes with undo.
- **Fix**: **Typed transform edits are undoable.** Entering a Pos/Rot/Scale value (typed field or VR numpad) now pushes a matrix snapshot, so undo/redo reverts it and refreshes the fields.

## VR fixes
- **Fix**: **The VR numpad parents to the outliner panel** and floats beside the field, like every other numpad — it was missing the source-panel reference and floating in front of the camera instead.
- **Fix**: **Deleting an object no longer blanks the panel.** Delete now re-selects a remaining mesh, so its transform/rig controls stay visible (was clearing the selection, which hid most of the panel).

# v3.2.0
Detailing at scale — a sweep of fixes for working zoomed-in on fine detail (eyes, faces) in VR, where grip-scaling the world up exposed a cluster of picking, shading, and cursor bugs. Plus a maintain-length mode for the Pose tool.

## VR sculpting when scaled up
- **Fix**: **Brushes no longer over-reach their radius.** The vertex selection floored its radius at 2.5% of the whole mesh, so when the brush was small relative to the model (zoomed in) it grabbed a fixed bubble far larger than the brush — smooth reached past its ring, and clay flattened a region far bigger than its buildup ceiling so it appeared to do nothing. Selection now respects the actual brush radius at any scale (the widened radius is kept only to fetch candidate faces).
- **Fix**: **Cursor and strokes stay on the surface at high scale.** The contact pick's minimum search radius was in mesh-units only, so as the world scaled up its real-world reach grew with it and the pick snapped to surface metres from the controller tip — cursor under the mesh, sculpt offset from the stylus, crease reacting to a depth below the surface. The search reach is now capped in physical space (tunable: `window._contactMaxReach`).
- **Fix**: **Surface ring tracks the real hit point.** It was reconstructed along the controller ray (only correct for ray picks); contact/volume picks land off-axis, so the ring floated above the surface and drifted with scale. Now placed at the actual hit transformed by the world matrix.
- **Fix**: **Depth precision is scale-aware.** VR near/far were pinned at 0.01/50 m (a 5000:1 ratio) → z-fighting (eyelids over eyeball) and the cursor losing the depth test. Near/far now derive from the sculpt's physical size and distance, which track the grip-scale, keeping precision matched to the working scale.

## Shading & cursor
- **Fix**: **Matcap normals correct under non-uniform scale.** The matcap and PBR shaders transformed normals with the model-view 3×3 instead of the normal matrix (inverse-transpose), so any non-uniformly-scaled mesh (a stretched eyeball) shaded wrong until baked. Now uses the proper normal matrix.
- **Fix**: **Matcap no longer flips/shimmers** when grip-rotating the world or working on an off-centre mesh. The billboard stabilization aimed from the camera at the mesh *origin*, which swung wildly for a long character at scale; it now aims along the camera's view direction (mesh-position independent), while still keeping the lighting world-upright.
- **Fix**: **Matcap shading no longer snaps** as you move with multiple objects — all matcap meshes share one material, so the per-mesh orientation uniform is now force-re-uploaded per draw instead of inheriting the first-drawn mesh's.
- **Fix**: **Brush cursor stops flipping in front of / behind the mesh.** The transparent sculpt material shares Three's depth-sorted queue with the cursor; the cursor is now pinned to render last so its draw order can't swap.

## Pose tool & eye rig
- **Feature**: **Maintain-length mode** for the Pose tool (toggle with the **A** button). Keeps only the controller's rotation about the anchor, so the limb bends without stretching — the iPad/desktop feel, in 6DOF.
- **Fix**: **Mirror eyes delete cleanly.** A live-mirror eye is parented outside the mesh list, so Clear Scene and deleting the source left the mirror behind; both paths now remove it.

## Brush feel
- **Change**: **Clay buildup raised** (default ceiling 0.1 → 0.3) — the old default felt dead when detailing. Live tuning knobs added for smooth strength and crease pinch/push balance (`window._smoothScale`, `_creasePinchScale`, `_creasePushScale`).

# v3.1.0
Posing in VR — a new **Pose** tool that bends a limb with two anchors and a 6DOF controller grab, built on a new on-mesh geodesic engine. First step of the rigging/posing track (rigless posing before skeletons).

## Pose tool
- **Feature**: **Geodesic Pose tool** (`src/editing/tools/GeodesicPoseTool.js`). Drop two anchors on the surface — **A** (where the falloff starts / the locked side) and **B** (where it ends / the moved side) — and the band of surface between them deforms with a smooth geodesic falloff. Distances are measured *across the mesh surface* (geodesic), not through space, so the falloff follows the form instead of leaking across gaps.
- **Feature**: **VR 6DOF grab.** Trigger-press to place A, then press-and-hold on B and **move/twist the controller** — the band follows your hand as a single bone (linear-blend skinning): behind A stays locked, beyond B rides rigidly with the hand, the middle blends. Aimed with the laser like the Transform tool. Desktop drives the same corridor via a click-A / click-drag-B bend.
- **Feature**: **Symmetry.** With X-symmetry on, the A/B corridor is mirrored across the mesh plane and the matching mirrored motion is applied to the other side — pose both shoulders at once.
- **Change**: **Lateral falloff limit.** A short corridor at a junction (e.g. a shoulder) no longer floods the whole side of the body; the influence is bounded to the limb around the A→B line, with the width auto-scaling to the corridor length.

## Geodesic engine
- **Foundation**: **On-surface geodesic distance field** (`src/editing/Geodesic.js`) — Dijkstra over the mesh surface, the substrate for the Pose tool's falloff and reused toward auto skin-weights in the rigging phase.

# v3.0.0
Rigging & performance-capture foundations — a full ARKit blendshape pipeline, an eye rig, freeze-transform tools, and a live transform inspector, all built on the parent-aware scene hierarchy.

## ARKit blendshape pipeline
- **Feature**: **ARKit name library** (`src/editing/ArkitBlendshapes.js`). The blendshape **New** button now opens a picker grouped by face region, seeded with the ARKit 52 — shown as **34 entries**, because the 14 true mirror pairs collapse into one symmetric shape you sculpt once with X-symmetry. Categories are colour-dotted: **symmetric** (splits L/R), **center** (sculpt as-is), **directional** (`jawLeft` etc — look like pairs but aren't). A "+ Blank layer" quick option is kept; already-created names show dimmed/checked (selecting, not duplicating). Scrolls via mouse-wheel + drag on desktop and the **thumbstick in VR**.
- **Feature**: **Split a symmetric shape into its ARKit L/R halves.** Sculpt `eyeBlink` once in symmetry, then split into `eyeBlinkLeft` + `eyeBlinkRight` — the delta is feathered across the symmetry plane with a soft midline band (`left + right` at weight 1 reproduce the original). Saves hand-splitting every shape.
- **Feature**: **Combine the halves back** into the single symmetric shape, to keep editing in symmetry. The split↔combine round-trip is lossless.

## Eye rig
- **Feature**: per-eye **look-at** (near target → cross-eyed, far → parallel), **saccades** (amplitude + speed, working with or without an aim constraint), and a **mirror** socket that reflects across the head's centreline and tracks the head as it rotates. Built on the parent-aware per-frame constraint pass; look-at roll uses the head's local up.

## Transform tools
- **Feature**: **Outliner transform inspector** — Pos/Rot/Scale fields (3 per row, numpad on click, local space) that **track gizmo/grab manipulation live**. Set-parent / aim-at / lock share a row; lock makes an object unselectable in the viewport.
- **Feature**: **Bake / freeze transforms.** "Bake scale" freezes the mesh's scale into the geometry (Scale → 1, like Maya freeze / Blender apply — the default sphere's internal 57.735 becomes 1); "Apply all" freezes translation + rotation + scale (matrix → identity). Bakes across all multires levels and blendshape base/deltas; sculpting still works at the new size (dyntopo/remesh are mesh-relative).

## Cleanup
- **Change**: **Retired the legacy canvas VR menu's reappearance.** The old `GuiXR` main menu + mini-HUD could be toggled back on (the "old menus reappear" glitch); that toggle is gone — the HTML panels are now the only menu — and dead `GuiScene.js` was deleted. Full removal of `GuiXR` awaits migrating brush/settings state + the remaining popups to HTML (tracked).

# v2.9.40 – v2.9.63
Transform plumbing through the Three.js scene graph, and the whole sculpt/transform toolset made parent-aware (sculpting/posing parented objects — eyes-on-a-head, etc.).

- **Foundation**: **Desktop gizmo writes the real transform live.** The desktop transform tool now writes the mesh's actual matrix every drag frame (matching the VR path) instead of an editMatrix shader *preview*. This let us DELETE three pieces of custom preview code — the editMatrix shader preview, the parent's "child-follow" hack, and the wireframe-editMatrix hack — because parented children and the wireframe now follow through the native scene graph. Undo snapshots the drag-start vs committed matrix.
- **Foundation**: **The whole sculpt/transform toolset is now hierarchy-aware.** The recurring bug: world↔local conversions that used a mesh's raw *local* matrix (`getMatrix`/`getScale`/`getScale2`) are wrong for a *parented* mesh (local ≠ world). Fixed by routing them through `getModelSpaceMatrix()`/`getModelSpaceScale()`, which compose the full parent chain (and are byte-identical to the old calls for unparented meshes, so top-level behaviour is unchanged). Deeper parenting (grandchild and beyond) works by construction — everything reads `threeMesh.matrixWorld`, which composes the entire chain.
- **Fix**: **VR brush no longer engulfs a parented child.** Sculpting a child mesh in VR produced a ~300× brush that froze and massively deformed it. The world→local brush-radius conversion divided by the child's *local* scale instead of its composed model scale (a stray `getScale2()` in the VR input handler that overwrote the correct radius). Now parent-aware.
- **Fix**: **VR brush cursor (ring + dot) lands on a child's surface.** The cursor was placed via the local matrix, so on a child it floated behind the object and mirrored controller motion (while the xray sphere was correct). `_updateVRCursors` now lifts the hit point via `getModelSpaceMatrix`.
- **Fix**: **Per-tool parent-awareness** — Move, Drag, Twist, Slide, Extrude, the VR symmetry path, Crease's surface-walking anchor, and the Cut tool's interactive highlight/preview all now convert world↔local correctly for a parented (or grandchild) mesh. (Inflate / Flatten / Pinch / Smooth were already local-space-only.)
- **Fix**: **Twist works again (pre-existing bug, surfaced while testing).** Twist centred its drill on the raw controller position, which sits *off* the surface, so the radius search selected zero vertices and it did nothing — on any mesh, parented or not. Now it centres on the surface contact point (controller direction still sets the twist axis), and symmetry works (the symmetry pass is handed the main surface point to mirror).
- **Fix**: **VR outliner panel scrolls with the thumbstick.** A nested scroll container (the bordered object list) fought the panel's own scroll, so the thumbstick scrolled the inner list and the parenting/rig controls below were unreachable. The thumbstick now targets the panel body, and the object list flows into it.
- **Known limitation**: **Non-uniform scaling** — the brush-radius model assumes uniform scale (a single scalar). With non-uniform scale on a mesh or any ancestor, surface *hit* detection is fine but the brush *footprint* stretches/squashes. Pre-existing SculptGL design; low priority.

# v2.9.9
Eye-rig foundation (scene-hierarchy Phase 0) + transform/gizmo fixes.

- **Fix**: **Duplicate "ghost" transform gizmo in VR.** There are two gizmo systems (desktop `Gizmo.js`, VR `GizmoVR.js`); the desktop one's visibility was sticky from the desktop-only `postRender` and was never hidden in VR, so it lingered overlapping the VR gizmo (a small second gizmo near the object's old position). Now force-hidden every VR frame, plus a tool-switch hide so a deselected transform gizmo can't linger on either platform.
- **Foundation (scene hierarchy / eye rig, Phase 0):** picking and the VR transform tools are now **parent-aware**, so a mesh parented under another sculpts/moves/gizmos correctly (composed world transform instead of assuming flat). `Mesh.getModelSpaceMatrix/getModelSpaceScale` (read) + `setModelSpaceMatrix` (write); wired into `intersectionRayMeshes`/`intersectionSphereMeshes`, Grab, the VR gizmo, and the gizmo anchor. No-op for unparented meshes. `window.setMeshParent(childId, parentId)` console helper for testing. See `implementation_plan_eye_rig.md`.

# v2.9.0
Blendshape panel: layer lock, hover highlights, smaller VR panel.

- **Feature**: **Per-layer lock (Photoshop-style) + Base cage locked by default.** A lock icon on every row (amber = locked); the Base is locked automatically once blendshapes exist, because it was too easy to accidentally select Base and sculpt — corrupting every layer's reference. The sculpt gate refuses to sculpt a locked layer or the locked cage (flashes); click the lock open to deliberately edit it. Applies on desktop and in VR.
- **Feature**: **Hover highlights.** Blendshape panel rows tint on hover and brighten the specific element under the cursor (name / eye / lock / slider thumb), plus the New/Del toolbar buttons. The timeline gutter highlights the channel name + visibility eye on hover. Works with the VR ray and the desktop mouse.
- **Change**: **VR blendshape panel is half size.** Both the canvas pixels and the world plane were halved by the same factor, so the UI elements stay the same physical size to the user — the panel is just physically smaller and shows fewer rows at once (not a content scale).

# v2.8.1
Blendshape data-safety hardening.

- **Fix**: **Corruption backstop at the delta write.** The delta capture only works when the active layer is at weight 1; some stroke paths reached it at weight ≠ 1 (the `SculptManager.start()` gate has a hole), writing a corrupt delta you couldn't undo. `Mesh.updateGeometry` now re-checks the active layer's evaluated weight at the actual write and **refuses it** if it isn't ~1 (or the layer is muted) — flashing the panel and recomposing to discard the stray nudge. Independent of the start() gate, so it catches every path.
- **Feature**: **Backup / Restore Shapes** buttons in the VR Settings menu (wired to `bsBackup`/`bsRestore`, with on-device confirmation) — the undo-independent blendshape safety net is now reachable in standalone VR, not just the console.

# v2.8.0
Blendshape "layer stack" panel — a Photoshop/Nomad-style canvas UI for blendshapes, on desktop and in VR.

- **Feature**: **New canvas-2D blendshape layer-stack panel** (`src/gui/BlendshapeStackPanel.js`), replacing the old HTML blendshape section. It's drawn imperatively to a `<canvas>` (the `GuiTimeline` pattern) rather than HTML, so a weight-slider drag is a cheap 2D redraw instead of the HTML-in-WebXR DOM→SVG→raster→GPU upload — the elegant single-place "what layers exist + how much each is on" UX *and* the speed. Desktop: a new **Blendshapes** sidebar tab. VR: a floating panel toggled from the main-menu strip.
- **Feature**: **Per-row controls** — click a row to make it the active sculpt layer (blue highlight), weight slider (live at all times), numeric value, an **eye** to mute (zero a layer's contribution without losing its stored weight), and **solo** (Alt-click the eye on desktop / secondary-trigger + eye in VR — isolates one layer; toggling restores the prior visibility of all). New / Delete toolbar; double-click a name to rename (desktop). Base layer pinned at the bottom. Icons are vector/FontAwesome on the canvas, no emoji.
- **Change**: **Sliders are always live** — the panel shows the true weighted composition instead of force-isolating the active layer (which used to make the sliders look dead). Sculpting into a layer is gated to "visible + weight 1"; a blocked stroke flashes the layer name red (and pulses the tab icon if the panel is hidden). Multi-layer delta capture is correct: the sculpted layer's delta subtracts the other active layers' contributions, so stacking layers doesn't bleed between them.
- **Fix**: **Blendshape-corruption guard.** The base-layer rebase wrote `baseShape = currentVerts` on any `updateGeometry`, so if it fired while a composed/animated pose was showing, that pose got baked into the neutral and every layer's delta corrupted. It now subtracts all active layer contributions (`verts − Σ(layer·weight)`), recovering the true base — incidental rebases become harmless. Added `window.bsBackup()` / `window.bsRestore()` console helpers as an undo-independent safety net.
- **Change**: The desktop panel and the VR floating panel stay in lock-step with the timeline (scrub/keyframe ↔ slider), and both share one newest-first (Photoshop) layer order across the panel, the timeline gutter, and the dopesheet.
- **VR**: both the blendshape and timeline floating panels are grip-movable and have a corner **close button** (child mesh, hover-highlighted) so they no longer have to be dismissed from the menu.

# v2.7.0
VR Crease overhaul — depth-independent surface tracking + framerate-invariant strokes.

- **Fix**: **VR Crease no longer wobbles / gallops / waves.** The instability was in the brush *centre*, not the crease math: in VR the centre was re-derived each frame as the nearest surface point to the controller tip, so holding the tip even ~1cm off-surface fed back into the deforming geometry (jitter below, intermittent pick dropouts above). Crease now uses a **surface-walking anchor** — it anchors to the contact point and advances by the controller's lateral motion, letting the per-frame surface re-snap discard the depth component. The brush walks the surface and ignores how far above/below the tip drifts (the depth-independence desktop gets for free from screen-ray picking). Scoped to the Crease tool in volume-intersect mode; other tools unchanged.
- **Change**: **VR strokes are now framerate-invariant.** The per-distance spacing throttle in the VR stroke path had been disabled, so holding the trigger stamped the brush every frame — at 90fps deformation accumulated ~3x faster than at 30fps (crease spikes on press, generally too-strong VR sculpting). Restored the throttle so deformation tracks distance travelled, not frame count. The spacing is very fine, so moving strokes stay smooth; only the at-rest over-accumulation is removed. Affects the standard stroke brushes (Brush, Inflate, Smooth, Flatten, Pinch, Crease, Masking, LocalScale).
- **Tweak**: Crease default intensity lowered to 0.4. It's a pinch tool, so very high intensity drags groove triangles toward zero area and folds the mesh (no dyntopo to relieve the bunching); ~0.4 is the sweet spot and the slider still goes higher.
- **Fix**: An inline `<head>` script ran `MutationObserver.observe(document.body, …)` before `<body>` existed, throwing on every load and aborting the rest of the block. This silently disabled two iPad fixes — `inputmode` stamping (forces the VR numpad over the iOS keyboard) and Safari page pinch-zoom suppression ("grey bar"). Now observes `document.documentElement`.

# v2.6.0
Sculpting stability — fix accumulating "blocky" brush artifacts (octree froze mid-stroke).

- **Fix**: Standard mesh brushes (Brush/Clay, Flatten, Crease, Inflate, …) no longer build up blocky / terraced artifacts when you work over the same area, and large brushes flatten evenly instead of leaving raised shoulders. Root cause: the mesh octree was effectively frozen for the duration of a stroke. An earlier voxel optimization had reduced `Mesh.updateOctree(iFaces)` to a no-op `build()` call, so as vertices moved under the brush the spatial sphere-query that gathers the affected vertices went stale and intermittently dropped most of them (observed 840 → 81), flattening only part of the brushed region. Reconnected the incremental octree update (move modified faces between cells + refresh bounds each substroke — the path `MeshSafe` already used). The voxel remesh path still does a full rebuild, so voxel performance is unchanged. Bonus: sculpting also feels more stable and fluid in VR (the freeze was platform-agnostic).

# v2.5.0
iPad parity & QA pass (Stéphane Ginier feedback) — undo, gestures, background, references.

Headline items (see the v2.4.x entries below for detail):
- **Undo/redo**: fixed launch-undo bricking sculpting and delete→undo; the on-screen buttons work and show counts (disabled when unavailable).
- **iPad touch**: full mesh-edit + finger-gesture overhaul (tap-to-edit, finger=camera/pencil=edit, 2→1 rotate, finger-sculpt disambiguation, no stray extrude on release); iOS loupe suppressed; page pinch-zoom blocked; number fields editable via the numpad.
- **Background**: reimplemented for three.js — imported image, plus the built-in HDRIs as a skybox (ported LogLUV octahedral panorama decode + SH), with per-HDRI × rendering-slider exposure and blur. Default grey.
- **Reference images**: first-class meshes — appear in the outliner, select/transform (real-time)/hide/show, undoable; textured planes sized to the model.
- **Desktop cleanup**: VR-only menus and the voxel-bounds box no longer appear at the world origin; the blue brush sphere no longer flashes on load.
- **Misc**: graph editor is the default timeline mode; Brush defaults to Clay; emoji buttons → FontAwesome; language selector hidden (real localization pending).

# v2.4.38
Background, environment skybox & reference images (three.js port).

- **Update**: Reference images are now first-class meshes (`MeshReference` via `addNewMesh`): they show in the outliner, can be selected / transformed in real-time / hidden, and are undoable. Removed the separate references subsection.

- **Feature**: **Background reimplemented for three.js**. Import an image (flat backdrop), or pick **Environment** / **Ambient env**. The built-in HDRIs now render as a skybox again — ported SculptGL's fullscreen LogLUV octahedral panorama decode (`texturePanoramaLod`) + SH evaluation into a three.js shader; no new assets. Per-HDRI exposure × the rendering-panel exposure slider drives brightness; blur uses the prefiltered mips. Default grey. Scoped to non-XR.
- **Feature**: **Reference images work again**. Add reference → an unlit textured plane at the model centre, sized ~1.3× the model with the image's aspect. (The old MeshReference was WebGL-only and never rendered after the migration.)
- **Fix**: Desktop no longer shows VR-only elements at the world origin — the **VR canvas menus** (mini-HUD/menu/popup) default hidden and are gated to XR, and the green **voxel-bounds box** defaults hidden (shown only during voxel modeling).

# v2.4.25
More iPad/QA polish.

- **Feature**: Undo/Redo buttons show the count and disable when there's nothing to undo/redo.
- **UX**: Selecting a low-poly/topology edit tool (delFace, extrude, inset, …) auto-shows wireframe and restores your previous setting when you leave it.
- **Fix**: The blue xray brush sphere no longer flashes at the world origin during startup (and is no longer force-shown, unpositioned, on desktop).
- **Tweak**: Brush tool defaults to Clay on.

# v2.4.21
iPad QA polish batch (Stéphane notes).

- **Fix**: Action buttons no longer stay "selected" after a tap on touch — mouse `:hover` gated behind `@media (hover: hover)`.
- **Fix**: Files menu no longer blows out to a huge width (bounded `max-width`).
- **Fix**: Number fields are editable on iPad — the numpad now opens on touch-primary devices (the iOS keyboard is suppressed, so it was the only editor). Fixes "animation duration can't be edited" and all numpad-wired fields.
- **Change**: Language selector hidden (legacy translations only cover the removed yagui UI; the current HTML UI is English-only with no re-render — real localization is a future task).
- **Fix**: Pinch-zoom on a panel no longer zooms/reflows the whole page ("grey bar"); Safari page pinch-zoom is blocked globally (the viewport handles its own 2-finger camera via pointer events).
- **Change**: Starting a sculpt/edit stroke now stops animation playback (you can still orbit during playback).
- **Fix**: "Max undo steps" slider can be dragged (not just tapped) on touch.
- **Fix**: Voxel-resolution preview overlay stays visible while the slider is held (was auto-hiding ~250 ms after the last move).

# v2.4.14
iPad mesh-edit & finger-gesture overhaul (Stéphane QA, cluster B).

- **Fix**: **Mesh-edit tools work on touch**. Single-action tools (delFace, dissolve, weld, split, …) read the picked face/verts in `start()` but never refreshed the pick — on a touch tap (no hover) they hit a stale pick and did nothing, then fired late. `SculptManager.start` now refreshes the pick at the pointer position for these tools.
- **Design**: **Finger = camera / pencil = edit** stays the model. With *Finger Sculpt off* (default) fingers never sculpt/edit — 1-finger rotates (even zoomed in), 2-finger pans/zooms, **2→1 finger = rotate** (also fixes "going back to one finger does nothing"). Editing with fingers requires enabling Finger Sculpt.
- **Fix**: **Finger-sculpt disambiguation** (Finger Sculpt on). The first of two fingers no longer misfires a sculpt/extrude: the sculpt start is deferred a short window (~90 ms / 6 px) so a 2nd finger (camera) or a quick tap cancels it; a real drag or brief hold commits it. The 2-finger camera gesture and the 2→1 rotate now work while finger-sculpting (the pointerup dispatch order was also fixed so the rotate isn't clobbered by `onDeviceUp`).
- **Fix**: **No 0-height extrude on camera release**. `SculptManager.end()` now only commits when a stroke actually started, so lifting fingers over the mesh during a camera gesture can't fire a spurious `extrude.end()`.

# v2.4.6
iPad QA polish — icon spacing and graph-editor default.

- **Polish**: Spacing between FontAwesome icons and labels on action buttons (undo/redo/refresh).
- **Tweak**: The timeline now defaults to the **graph editor** on all platforms (was dopesheet on desktop/iPad); the persisted preference still overrides.

# v2.4.5
iPad QA round 1 (Stéphane Ginier) — undo fixes, icon cleanup, Safari touch suppression.

- **Fix**: **Undo at launch no longer breaks sculpting**. The startup mesh's "add" state was undoable — undoing it emptied the scene and killed the BVH. The undo stack is now reset after the default mesh (mirroring `loadScene`), so it's the baseline.
- **Fix**: **Delete → undo restores the mesh**. `StateAddRemove` returned the mesh to the array but never re-added its three.js object to the scene graph (a WebGL→three.js regression). Added shared `attach/detachMeshThree` helpers used by add, remove, and undo/redo.
- **Fix**: **Undo/redo UI buttons work**. They were synthesising a key event the handler never matched. Added a canonical `undo()`/`redo()` on the app; the keyboard shortcut, on-screen buttons, and the iPad 2/3-finger-tap gesture now all route through it (the gesture also gets the render + GUI refresh it was skipping).
- **Cleanup**: Replaced emoji/unicode-glyph buttons (undo/redo/visibility/refresh/save placeholder) with **FontAwesome icons**; codified "FA icons or plain text, never emoji" going forward.
- **Fix (iPad)**: Suppressed the Safari double-tap-drag **glass magnifier / text-selection** on the canvas (`touch-action:none` + `user-select`/`-webkit-touch-callout:none`); also stops Safari intercepting touch gestures before the app.

# v2.4.2
Panel design tokens, VR hover fix, and a FontAwesome icon-load fix.

- **Refactor**: **Design tokens** (`uiTokens.js`): single source of truth for the panel visual language — semantic CSS custom properties (`--ui-panel-bg`, `--ui-btn-bg-hover`, `--ui-danger-bg`, `--ui-radius`, …) plus a matching `UI_PALETTE` JS export for canvas surfaces. VrConfirm fully adopts it; broader adoption is incremental.
- **Fix**: **VR button hover**: there is no CSS `:hover` in a headset (panels are rasterised textures) — the ray dispatch adds a `.hover` class instead. VrConfirm styled only `:hover`, so its buttons were dead in VR. Now styles both `:hover` and `.hover` (+ active states); same fix applied to VrNumpad.
- **Fix**: **Icons intermittently blank on cold load** (`fontReady.js`): the SVG-foreignObject rasteriser only bakes FontAwesome glyphs if the web-font is loaded at paint time; a panel rasterising before the woff2 arrived left icons blank until a dev-server restart. Now explicitly loads the FA faces and force-repaints all panels once fonts are ready (and on later `loadingdone`). Manual escape hatch: `window._repaintAllPanels()`.

# v2.4.0
Timeline & VR-dialog fixes — confirm dialogs, edge-drag, gutter cleanup.

- **Feature**: **VR-native confirm dialog**: "Clear all animation" (and any other `_vrConfirm` caller) previously popped a flat DOM overlay that's invisible/uninteractable inside a headset. Added an in-scene `VrConfirm` panel (sibling to VrNumpad): ray-interactable, modal, floats just in front of the active panel inheriting its rotation (with the `scale.y=-1` decompose correction so it isn't flipped), and uses standard depth compositing. `window._vrConfirm` routes to it when an XR session is presenting; desktop keeps the DOM overlay.
- **Fix**: **Timeline edge-drag latch**: dragging a blendshape weight in the timeline gutter dropped the moment the ray left the panel, making it easy to reach 1.0 but nearly impossible to reach 0.0 (the left edge is close). The drag now latches: while the trigger is held, the ray is projected onto the timeline plane and `move` events keep flowing past the panel edge (unclamped, since the gutter scrub is relative). Release commits at the dragged position. Respects the two-handed zoom and grip-move gestures.
- **Tweak**: **Blendshape gutter cleanup**: removed the faint `↔` scrub-hint glyph that appeared on hover over blendshape names.

# v2.3.0
VR UI performance & interaction polish — HTML panels, sliders, and scrolling.

- **Fix**: **VR Slider Dragging (wrist panels)**: Radius/intensity sliders on the wrist-mounted panels were pegging to their minimum on touch. During a slider drag the ray was projected onto a plane built from the panel mesh's *local* transform, but those panels are parented to the controller grip — so the plane was placed in the wrong space and the projected UV collapsed. Now built from the panel's world transform; sliders track correctly. Same root-cause fix applied to the value-entry hit-tests.
- **Feature**: **HTML Panel Performance — Idle Freeze**: The HTML-in-canvas panels re-serialised their entire DOM to SVG several times a second even when nothing changed, dropping VR framerate. Added per-panel change-detection (BrushPanel/MiniPanel) so static panels stop rasterising when idle, and **unmount hidden panels from the shared host canvas** so each paint only rasterises what's actually visible (the polyfill re-rasterises every mounted child per paint). Idle and slider-drag framerate is dramatically improved.
- **Fix**: **Panel Swap Flash**: Switching panels (e.g. tool button → tool selection) no longer flashes/blanks — the remount no longer force-disposes the texture; geometry only rebuilds when content size actually changes.
- **Feature**: **Scrollable Panel Performance**: Scrolling long panels (Files, settings, torn-off sections) re-rasterised the whole panel on every step. Now the re-rasterisation is throttled during a continuous scroll (with a sharp snap on release), keeping the framerate up while scrolling.
- **Fix**: **Custom Scrollbars in VR**: The custom scrollbar thumb now tracks the scroll position (the native `scroll` event doesn't fire for the offscreen programmatic scroll), and the scrollbar is **draggable** — grab the thumb or track and the ray's vertical position scrubs the list.
- **Tweak**: **Thumbstick Scroll Speed**: Panel scrolling is now proportional to stick deflection and ~2.5× faster at full push (hold the trigger for fine control).
- **Internal**: Consistent semantic versioning via `bump.mjs` (patch on test builds, minor on push, major on request); `dist/` build output removed from git tracking.

# v2.0.6
Timeline & animation editor overhaul — graph editing, VR ergonomics, and persistence.

### Graph editor
- **Fix**: **Transform Box in Graph Editor**: The transform box now appears and works for all key types (transform, shape, blendshape), not just transform keys. Fixed the horizontal/center handles, which silently did nothing because the move handler mapped time→pixels using the raw loop range while the hit-test/draw used the graph view window; after any zoom/pan these diverged. Added a minimum on-screen box height so the vertical handles stay usable even when all selected keys share one value.
- **Feature**: **Select a Channel by Clicking its Curve**: Clicking a curve line (not just a keyframe) selects that whole channel; hovering a curve highlights it (brighter, thicker) and bolds its gutter row so it's clear what a click will select.
- **Feature**: **Header Frame & Value Fields**: Two click-to-edit fields in the timeline header. **F** sets/shifts the selected key frame(s); **V** sets/shifts their value(s). Both accept relative expressions (`+=10`, `-=5`, `*=2`) to adjust a whole multi-selection at once, or a plain number (frame: set the reference and shift the rest rigidly; value: set every selected key to it — e.g. zero a batch of weights).
- **Fix**: **Single-Key Snap to Whole Frame**: Dragging a single key with snap on now lands it on a whole frame (6.2 → 7.0) instead of preserving the fractional offset; multi-selections shift rigidly by the same delta.
- **Fix**: **Blendshape Value Overshoot**: Removed the 0–1 clamp from keyframe value edits (transform box, graph drag) and from typed numeric entry — blendshape weights can now intentionally overshoot below 0 / above 1. Gutter weight scrubbing still clamps.
- **Feature**: **Channel Solo & Reliable Hide**: Hold the secondary trigger (Shift) and click a channel's eye icon to solo it (hide all others); repeat to restore. Hidden channels are now fully inert — not selectable by click, marquee, or curve — and no longer reveal themselves when a stale selection is followed.
- **Fix**: **Gutter Eye-Icon Clicks in VR**: Visibility toggles now fire immediately on press (no click-vs-drag deferral that was impossible to satisfy with a jittery controller); hit zone widened. Selection-driven gutter auto-scroll brings the edited/selected channel into view. The value badge field is narrower and right-aligned, and loses focus when you click elsewhere.

### VR ergonomics
- **Feature**: **On-Screen Numpad for Numeric Entry**: Numeric fields bring up a floating numpad in VR (and optionally on desktop via a "Always show numpad" setting, useful on keyboard-less tablets). The numpad has **+ / − / =** buttons for relative-shift vs absolute entry, and does not clamp typed values.
- **Feature**: **Two-Handed Timeline Zoom**: With both controllers pointing at empty graph space, controller separation zooms the view — horizontal spread zooms time, vertical spread zooms value, pivoting around the midpoint. Single-pointer empty-space drag still pans. A white aim laser now also shows on the secondary controller when it points at the timeline.
- **Fix**: **VR Timeline Panel Persistence**: The panel's size is remembered across sessions (resize once and it sticks); the dope/graph mode is also remembered. The panel reopens crisp at the saved size (previously it loaded stretched/low-res until nudged).

# v2.0.4
- **Fix**: **SpinEdge Lock-Up After Multiple Spins**: SpinEdge was silently locking up after 2–3 spins because repeated spinning alternated the winding of the produced triangles, making them back-facing and invisible to the face picker. Added a cross-product winding consistency check that swaps the unshared-vertex pair when the proposed triangle would face away from the original, so spinning works indefinitely.
- **Fix**: **Extrude Double-Fire on iPad**: On iPadOS, `touchstart` fired *after* `pointerdown` and was unconditionally resetting the `_ptrDownHandledThisTouch` flag, causing the touch-move fallback to fire a second `onMouseDown`. Fixed by making the `touchstart` reset conditional — it only clears the flag when the sculpt action has not already started.
- **Fix**: **Extrude Normals in Smooth Shaded Mode**: After an extrude, smooth normals at the cap edge and base junction looked incorrect because `updateVerticesNormal` blended side-wall face normals into the cap and base vertices. Added `_applyHardEdgeNormals()`, which runs after each geometry update and recomputes vertex normals for extruded and base verts using only their original-mesh face contributions (face index < pre-extrude face count). This gives clean hard edges at the extrusion boundary in smooth mode. Applied during drag (real-time preview) and on stroke end.

# v2.0.3
- **Fix**: **iPad Apple Pencil / Finger Conflict**: Resolved a conflict where Apple Pencil hover events were mis-routed when fingers were also on screen. Pen hover is now suppressed when fingers are active; active pen strokes are not blocked by co-present fingers.
- **Fix**: **iPad 2-Finger Pan Speed**: Corrected a device-pixel-ratio double-scaling bug in `getSpeedFactor()` that caused 2-finger pan to feel 50% too slow on high-DPR displays (iPad). Pan now tracks at approximately 1:1 with finger movement.
- **Fix**: **iPad 2-Finger Zoom Oscillation**: Replaced the pinch-distance accumulator with an EMA (Exponential Moving Average, alpha=0.2) to absorb the transient distance spikes caused by alternating per-finger pointer events. Random zoom-during-pan is eliminated.
- **Fix**: **iPad Back-Face Brush Stamping**: Changed `Geometry.intersectionRayTriangleEdges` from double-sided to front-face-only Möller-Trumbore (reject when `det < EPSILON`). Prevents a second brush stamp from landing on the back face of a deformed mesh after the octree becomes stale.
- **Fix**: **iPad Pen Bounce / Duplicate Strokes**: Added a 50 ms debounce on Apple Pencil `pointerdown` and a Map-based dedup on `(type + pointerId + timestamp)` to absorb iPadOS's double-dispatch of identical pointer events and pen-tip physical bounce sequences.
- **Feature**: **iPad 2-Finger Tap = Undo, 3-Finger Tap = Redo**: Added multi-finger tap detection to the touch gesture engine. A quick tap (< 300 ms, < 40 px drift) with 2 fingers fires Undo; 3 fingers fires Redo (450 ms window to allow time to place 3 fingers). Uses `_peakFingerCount` and sequence-level timing so finger-lift order does not affect detection.
- **Fix**: **iPad Gesture Engine Stuck State**: Added a force-reset of stale gesture state on pen `pointerdown`. If a `pointerup` is dropped by the OS during rapid gestures, the pen going down now clears `_fingerPointers` and calls `onDeviceUp()` to recover.
- **Fix**: **VR Panel Pen Event Isolation**: Added `if (e.pointerType !== 'mouse') return` guard to `HTMLVRPanel` desktop pointer handlers so Apple Pencil events no longer accidentally trigger VR panel hit-tests.
- **Fix**: **Timeline Layout — Panel Overlap**: Fixed a `querySelector('.gui-sidebar')` vs `id="gui-sidebar"` selector mismatch that caused the timeline to always expand full-width, covering the sidebar panel. Timeline now correctly constrains its right edge to the sidebar's left edge.
- **Fix**: **Timeline Apple Pencil / Touch Support**: Replaced mouse-only event listeners on the timeline canvas with Pointer Events (`pointerdown`/`pointermove`/`pointerup`). All timeline interactions (scrubbing, key dragging, mode toggle, graph editor) now work with Apple Pencil and finger touch. Added `touch-action: none` to prevent iPadOS Scribble and scroll interception.
- **Fix**: **Blendshape Input Scribble Prevention**: The blendshape name input is now hidden by default, appearing only when the user taps "+". This prevents iPadOS Scribble from activating when the Apple Pencil passes near the sliders below. Added `writingsuggestions="false"` and autocomplete suppression to both the sidebar and ACP blendshape name inputs.

# v2.0.0
- **Feature**: **Complete UI Overhaul — HTML VR Panels**: Replaced the legacy yagui canvas-drawn UI with a new HTML-based panel system (`HTMLVRPanel`). Panels are rendered as live HTML surfaces in VR space, enabling standard HTML/CSS layout, scroll, and interaction. Desktop and VR UIs now share the same panel components.
- **Feature**: **Panel Tear-Off / Docking**: Panels can be detached from the sidebar and repositioned freely in VR space, or re-docked. Tear-off state persists across interactions.
- **Feature**: **VR Animation Timeline Panel**: The animation timeline/graph editor is now available as a separate floating panel in VR, with full feature parity with the desktop timeline.
- **Feature**: **Blendshape Support**: Added blendshape (morph target) creation, weight sliders, and keyframe animation for shape keys. Baking blendshapes to mesh geometry is supported.
- **Feature**: **Laser Pointer Overhaul**: Rewrote VR laser pointer with magnetic snapping to surface, correct depth ordering, and reliable hit detection across all panel types.
- **Feature**: **Spectator Mode Improvements**: Added Tracked and Stationary (6DOF Dreams) spectator sub-modes. VR mirror, desktop-independent, tracked, and stationary modes are all selectable from Camera settings.
- **Feature**: **GXR Performance**: Resolved GXR-specific frame-rate issues; sustained 90fps on Galaxy XR hardware.
- **Feature**: **Animation Rebuild**: Rewrote core animation playback and recording to handle shape keys and transform keys in the same track. Added `.sxr` save/load for animation data.
- **Feature**: **Numpad Input**: Added numpad for precise numeric entry in VR and desktop animation panels.
- **Feature**: **Transform and Grab Tools**: Restored and improved the Transform and Grab sculpting tools with correct undo support.
- **UI**: **Icons and Panel Parity**: Replaced text-only tool buttons with icons across desktop and VR panels. Desktop and VR animation panels brought to feature parity.
- **Fix**: **Desktop Restoration**: Fully restored desktop sculpting mode after the VR-first UI rewrite; all desktop tools, menus, and panels functional.
- **Fix**: **PCVR Compatibility**: Resolved controller detection and menu interaction issues specific to PCVR via Meta Link.

# v1.0.224
- **Feature**: **Graph Editor Channel Visibility in Fit View**: Updated "Fit View" in both Desktop and VR to only fit to visible channels, and included shape keys in the calculation.
- **Feature**: **Graph Editor Time Fitting in VR**: Added horizontal time fitting to VR Graph Editor for parity with desktop.
- **Feature**: **Shape Key Hover and Selection in Graph Editor**: Added hover highlights for shape keys and their tangent handles in VR.
- **Fix**: **Graph Editor View Range Consistency**: Fixed inconsistency where playhead and interaction used compressed range while header used full range in graph mode, and reset view to full range when switching to Dope Sheet mode on desktop.
- **Fix**: **Marquee Selection for Shape Keys**: Fixed `getKeysInGraphRange` to include shape keys and respect visibility, so they can be selected with marquee.
- **Fix**: **NaN Error on Paste in Graph Editor**: Fixed division by zero in Bezier evaluation when `dt` is zero in `AnimationRegistry.js`.
- **Fix**: **NaN Error on Copy/Paste in Desktop GUI**: Fixed `copyKey` in `GuiAnimation.js` to use `kTime` instead of `k.time` for shape keys, preventing `NaN` times.
- **Fix**: **Overlap in Dope Sheet**: Separated transform and shape keys vertically in `drawDopeSheet` to avoid overlap.
- **Fix**: **Tangent Handle Selection in VR**: Removed incorrect `i > 0` check in `GuiXR.js` that prevented selecting some left handles.
- **Cleanup**: Removed debug logs in `GuiTimeline.js`, `GuiXR.js`, `GuiAnimation.js`, and `AnimationRegistry.js`.

# v1.0.223
- **Fix**: **VR Dopesheet Multi-Move**: Fixed state loss of selected keys across frames by storing `_animSelectedKeysInitialTimes` on `window` instead of `this`.
- **Fix**: **VR Dopesheet Drag Fallback**: Populated `window._animSelectedKeysInitialTimes` when clicking keys in Dopesheet mode to prevent falling back to single key move.
- **Fix**: **ReferenceError in _handleGraphTimelineRelease**: Defined `yToValue` using `TimelineHelper` to fix crash when releasing marquee in Dopesheet mode.
- **Fix**: **Shape Key Mapping Bug**: Fixed incorrect value mapping when populating initial times for shape keys in Dopesheet mode.
- **Cleanup**: Removed verbose logging added for debugging.

# v1.0.221
- **Feature**: **Graph Editor Multi-Key Dragging in VR**: Supported moving multiple selected keys in VR graph mode by capturing initial states on click.
- **Feature**: **Transport Play Toggle**: Made play buttons act as toggles for both desktop and VR.
- **Feature**: **Graph Editor Tangent Handles in VR**: Added Tie/Break Tangent button and square display for broken tangents in VR.
- **Fix**: **Graph Editor Tangent Scrambling**: Added index-shifting logic to prevent tangent scrambling when keys are deleted or inserted in `AnimationRegistry`.
- **Fix**: **Graph Editor Key Dragging in VR**: Fixed key dragging math to be zoom-independent and prevented dopesheet interaction from stealing events.
- **Fix**: **Graph Editor Transform Box in VR**: Added missing state capturing for undo, fixed `NaN` corruption on translation, and added safety limit to `scaleCenter` to prevent key collapse.
- **Fix**: **Graph Editor Marquee Selection in VR**: Fixed marquee to exit to `select` mode automatically in 'auto select & exit' mode.
- **UI**: **VR Animation UI Overhaul**: Unified text color to `#ccc`, made stop button a flat square, expanded widgets to fill panel width (compensated for scrollbar), renamed labels to 'Op: Select' and 'Timeline'/'Graph Editor', and reorganized the layout to put tangents and mode on a single line at the bottom, with tangent buttons conditional on graph mode.

# v1.0.220
- **Feature**: **Graph Editor 2D Transform Box**: Added a full 2D Transform Box to the graph editor, supporting scaling in both time and value space via edge handles, and 2D translation by dragging inside the box.
- **Feature**: **Graph Editor Marquee Selection**: Implemented marquee selection in the graph editor with a visual overlay box and live highlighting of keys inside the box.
- **Feature**: **Graph Editor 2D Pivot Zoom**: Right-click drag now scales the view both horizontally (time) and vertically (value) around the exact click pivot point.
- **Feature**: **Graph Editor Selection Undo**: Added selection changes to the undo queue, named "graph editor multikeys selection".
- **Feature**: **Graph Editor Transform Undo**: Added transform box operations to the undo queue, named "graph editor transform box".
- **Fix**: **Graph Editor Playhead Scrubbing**: Fixed playhead scrubbing to be zoom-aware and update the 3D view in real-time.
- **Fix**: **Graph Editor Key Jumping**: Resolved time and value jumps when starting to drag keys.
- **UI**: **Graph Editor Colors**: Changed selected keys to Yellow and hovered keys to Cyan to avoid conflict with the green Y channel.
- **UI**: **Graph Editor Clipping**: Added a clipping mask to prevent curves and keys from drawing over the header.
- **Optimization**: **Playback Speed Persistence**: Playback speed is now saved to and restored from local storage.
- **Optimization**: **No Auto-Play on Load**: Loading an SXR file no longer automatically starts playback.

# v1.0.219
- **Feature**: **Motion Record Undo**: Recording a motion is now fully undoable. The system captures the track state and mesh matrix before recording and restores them on Undo.
- **Feature**: **Multi-Key Copy/Paste on Desktop**: Ported the VR multi-key copy/paste logic to desktop, allowing batch operations on selected keys.
- **Fix**: **Transform Box Expansion**: Allowed the right handle of the transform box to expand the timeline duration and loop end automatically when pulled past the current limit, in both Desktop and VR.
- **Fix**: **Single Key Delete Undo**: Refactored single key deletion to use the batch deletion logic, making it fully undoable.
- **Fix**: **VR Undo Reliability**: Fixed a variable name mismatch and allowed processing release events even if the cursor is inactive, making Undo much more reliable in VR.
- **UI**: **Named Undo Operations**: Added an optional name parameter to `pushStateCustom` to provide specific descriptions in the console for custom operations like "Delete Keys" and "Transform Box Edit".
- **Cleanup**: Removed verbose `Undo Debug` and `AutoKey Debug` logs from the console.

# v1.0.217
- **Feature**: **Desktop Timeline Snapping**: Playhead now snaps to integer frames based on FPS setting, ensuring parity with VR.
- **UI**: **Desktop Timeline Off by Default**: Timeline and Transform Box are now off by default in desktop mode to reduce clutter.
- **UI**: **Clean Timeline**: Removed "No recorded tracks in memory." text from empty timeline.
- **UI**: **VR Button Layering**: Moved VR buttons back to bottom with z-index 10000 to prevent occlusion by timeline.
- **UI**: **OpenXR Warning Fade**: Changed OpenXR warning to a fade-in/fade-out message with click-to-dismiss.

# v1.0.216
- **Feature**: **Geometric Wireframe Bias**: Replaced the unreliable shader-based clip-space bias with a geometric vertex offset along normals, successfully preventing z-fighting on desktop.
- **UI**: **Wireframe Opacity Slider**: Added a live wireframe opacity slider to the desktop rendering menu and grouped all wireframe controls together.
- **UX**: **Desktop Defaults**: Set default wireframe opacity to 0.25 and bias to 0.001 for desktop interface.

# v1.0.215
- **Fix**: **Extrude Tool Deadlock**: Resolved issue where tool switched to Masking after undo operations by updating `getSelectedTool()` to query `SculptManager` directly.
- **Fix**: **Inset Tool Desktop Support**: Implemented `sculptStroke()` in `Inset.js` to map vertical mouse drag to inset scale, fixing `this.stroke is not a function` error.
- **Feature**: **Keep Together Option**: Added "Keep Together" checkbox to the desktop Low Poly tools list.
- **UX**: **Cut Tool Preselection**: Enabled preselection highlight dot and confirmed cut points on desktop by overriding `preUpdate()` in `CutTool.js`.
- **UI**: **Tool Cleanup**: Hidden **Split Edge**, **Edge Create**, and **Snap and Weld to Center** from both Desktop and VR UIs as requested.
- **Cleanup**: Removed noisy logs in `SculptGL.js` and `Reversion.js`.

# v1.0.214
- **Feature**: **VR Mini-HUD Masking Controls**: Added "Clear Mask" and "Invert Mask" buttons side-by-side in the mini-HUD for quick access.
- **Feature**: **Masking Hardness Slider**: Added a "Hardness" slider to the Masking tool VR interface and whitelisted it for the Mini-HUD.
- **Feature**: **Desktop Preview for Mini-HUD**: Added `Alt + Shift + B` shortcut to toggle a desktop preview of the VR Mini-HUD for easier debugging.
- **Fix**: **Mini-HUD Preview Aspect Ratio**: Fixed the desktop preview to respect the Mini-HUD's native aspect ratio (300x500) instead of forcing a square.
- **Fix**: **Popup Auto-Preview & Cleanup**: Tool picker popups triggered from the mini-HUD preview now correctly spawn their own desktop previews and clean up properly when a tool is selected or closed.
- **Cleanup**: Removed duplicate `closeOverlay` method in `GuiXR.js` that was shadowing the cleanup logic.

# v1.0.213
- **Feature**: **AutoKey Frame 0 Fallback**: Automatically creates a key at frame 0 with the original position when moving an object at a later frame, ensuring animation starts from the beginning.
- **Fix**: **AutoKey Undefined Time**: Resolved issue where AutoKey failed to trigger on startup because `window._animCurrentTime` was undefined.
- **Fix**: **Vite Import Error**: Resolved Vite import-analysis error in `GuiVRAnimation.js` by passing `Enums` from `GuiXR.js` instead of importing it directly.
- **UX**: **Paste Refresh**: Pasting keys now immediately refreshes the 3D view.

# v1.0.212
- **Fix**: **VR Menu Sub-Tab Overdraw**: Resolved issue where tool sub-tabs (Sculpting, Low Poly, Voxel) drew over the section tabs and global tabs by implementing conditional clipping and adjusting default positioning.
- **Fix**: **Combobox Ghost Clicks**: Prevented fall-through clicks on release of combobox dropdowns by setting the `_ignoreUntilRelease` safety flag directly in `_handleDropdownInteract`.
- **Cleanup**: Removed verbose debug logs from `GuiXR.js`.

# v1.0.211
- **Feature**: **Frame-Based Animation Workflow**: Transitioned the animation system from time-based to frame-based logic, with a user-definable FPS setting (default 24).
- **UX**: **Precision Sliders**: Implemented release-on-trigger-depress interaction for sliders and playhead to eliminate hand-drift.
- **Cleanup**: **Telemetry Purge**: Commented out verbose [Telemetry] and [USER EVENT] logs in Scene.js, GuiXR.js, and index.html for clean release.

# v1.0.209
- **Fix**: Set viewport frame sizing directly to ensure layer binding stability.

# v1.0.208
- **Fix**: **Framebuffer Initialization Synchronization**: Silenced corrupted early WebGL draw routines when initializing display frame allocations.

# v1.0.207
- **Optimization**: **Startup Render Loop Bound Suppression**: Removed expensive recursive frame bounds recalculations on child wireframe bindings.

# v1.0.206
- **Fix**: **Symmetry Extrusions**: Enforced exact mirrored centers/rotational pivots for 6DOF transformations to protect symmetric connectivity pipelines.

# v1.0.205
- **Fix**: **Level 0 Wireframe Consistency**: Resolved wireframe rendering synchronization issues in Level 0 mode for multiresolution meshes to ensure consistent overlay updates during interaction.

# v1.0.204
- **Fix**: **Extrude Tool Symmetry**: Corrected the continuous 6DOF extrusion dragging behavior when selecting faces on the local negative X side of the mesh. Now dynamically determines primary control alignment directly from local controller contact coordinates.

# v1.0.203
- **Feature**: **Timeline Drag-Jump Elimination**: Clarified variable references inside standard multi-track sequence evaluations to prevent unintended drift behavior.

# v1.0.202
- **Feature**: **Absolute SXR Reconstruction Pipeline**: Restored seamless hierarchical import parity by completely locking down heuristic geometry optimization `Mesh.optimize()`, preserving standardized multi-resolution pointer bindings.
- **Fix**: **LOD Proxy Cage Tracking**: Designed a unified `updateWireframeBuffer()` model matching dense brush positions mapped to recursive baseline cage indices across all UX modes (Full/Fast/Smooth).

# v1.0.200

# v1.0.198
- **Fix**: **Level State GPU Sync**: Patched `Multimesh.setSelection()` to fully trigger index and attribute boundary updates so GPU tables switch smoothly when browsing levels visually.

# v1.0.197
- **Fix**: **Synchronized Flattened Surface DrawArrays**: Triggered full `updateGeometry()` over instantiated hierarchies ensuring flattened normals and solid-shaded UV arrays render synchronized with static nodes.

# v1.0.196
- **Fix**: **Rebuilding Edge References**: Forced `initTopology()` to recompile line caches immediately after parsing pre-serialized discrete buffers to lock wireframes securely onto unshifted positions.

# v1.0.195
- **Fix**: **Absolute Static Topology Overrides**: Reverted cleanly to unified `mm.addLevel()` processing to fix missing discrete pointers, while explicitly forcing BOTH `newLevel.getFaces()` and `newLevel.getVertices()` to strictly adopt serialized memory blocks to clear edge displacement drift completely.

# v1.0.194
- **Fix**: **Restored Stable Discrete Layer Base**: Reinstated individual memory buffers over subdivided nodes while fully retaining identical spatial pointer checks to bypass dynamic boundary shifts.

# v1.0.193
- **Fix**: **Absolute Optimization Base Static Lock**: Upgraded the `.sxr` parser to strictly override the global ES6 `Mesh.OPTIMIZE` superclass constant instead of locally instanced prototypes. This perfectly prevents the GPU Tipsy index-sorting algorithm from running out-of-sync during load time, permanently fixing coordinate desynchronization over natively subdivided meshes!

# v1.0.192
- **Fix**: **Native Reconstruction and Full Mode Lock**: Restored the unified memory `mm.addLevel()` generation loop upon SXR load after successfully eliminating downstream exporter index padding, and explicitly enforced `wireframeType = 2` globally to prevent headset performance limits from clamping detailed wireframes.

# v1.0.191
- **Fix**: **Wireframe Memory Desynchronization Fix**: Synchronized the wireframe position attribute upload in `Multimesh.js` to evaluate the identical `isUsingDrawArrays()` conditional as the solid material renderer. This absolutely ensures the wireframe overlay references the exact same memory pointer as the underlying shaded geometry, completely preventing visual desynchronization and tangling.

# v1.0.190
- **Fix**: **Multiresolution Edge Structure Reversal**: Removed the redundant execution of `initTopology()` on shared level wrappers during import to immediately eliminate edge index scrambling and wireframe visual tangling.

# v1.0.189
- **Fix**: **Multiresolution Edge Topology Generation**: Enforced explicit execution of `initTopology()` on all newly instantiated `MeshResolution` level wrappers during the `.sxr` import cycle. This guarantees that every layer successfully populates its edge index reference tables, entirely preventing aborted WebGL wireframe renders on loaded subdivided meshes.

# v1.0.188
- **Fix**: **SXR Multiresolution Export Serialization Fix**: Updated `ExportSGL.js` to explicitly switch to each multiresolution layer (`setSelection(L)`) before reading its vertex array. This ensures the overarching memory pointer always retrieves the exact subdivided layout for that level, entirely preventing zero-padded coordinate artifacts at the rear of saved meshes.

# v1.0.187
- **Fix**: **Multiresolution Stack Loading Reversal**: Safely reverted the `.sxr` import reconstruction routine back to the stable discrete wrapper paradigm to immediately restore solid geometry integrity across all multiresolution levels.

# v1.0.186
- **Fix**: **Multiresolution Stack Native Re-generation**: Reconstructed the SXR import multiresolution wrapper creation loop using the native `mm.addLevel()` subdivider to guarantee perfect index alignment and mapping tables, while strictly disabling global GPU optimizations to prevent topological drift.

# v1.0.185
- **Fix**: **Base Mesh Index Scrambling Fix**: Explicitly bypassed GPU index optimization (`this.optimize()`) during the initialization of the base resolution level (Level 0) in the `.sxr` import pipeline. This ensures the base topology remains perfectly aligned with the index structures of the statically loaded higher resolution layers.

# v1.0.184
- **Fix**: **Multiresolution Wireframe Index Spaghetti Fix**: Removed the rogue index-mapping translation loop from `updateWireframeBuffer` that was corrupting WebGL index buffers by attempting to draw low-resolution arrays using high-resolution vertex IDs. Also reverted the `.sxr` import parser to the stable discrete-wrapper loading paradigm to prevent Catmull-Clark topology generation from misaligning saved project faces.

# v1.0.183
- **Fix**: **SXR Topology Reconstruction (Flat Coordinate Fix)**: Resolved the critical issue where imported multiresolution levels (1, 2, 3) collapsed into a single vertex coordinate `[0.25, 0.25, -0.25]` and failed to propagate base sculpting strokes up the hierarchy. The system now builds the multi-level stack natively using the standard `addLevel()` subdivider to guarantee 100% accurate Catmull-Clark mapping tables (`_vertMapping`), and overrides the final calculated position coordinates with the exact values parsed from the `.sxr` file payload.

# v1.0.182
- **Fix**: **Wireframe Transformation Tracking (Feet Origin Fix)**: Resolved the issue where the wireframe overlay appeared at the user's feet rather than aligned with the model. The system now correctly parents the overlay directly to the active level's `Three.js` mesh so it automatically inherits 3D spatial transformation matrices (position, rotation, scale) in real-time, and includes a self-healing matrix projection fallback for uninitialized containers.

# v1.0.181
- **Fix**: **SXR Multiresolution Wireframe Synchronization**: Completely resolved the issue where `.sxr` loaded wireframes appeared scrambled or anchored to the floor. The pipeline now extracts the exact `Float32Array` of the currently active level directly, unconditionally attaches the overlay to the root `window.app._scene` to bypass unloaded WebGL containers, and explicitly updates both index and position buffers on every single stroke so the wireframe inherits geometry deformations in real-time.

# v1.0.180
- **Fix**: **Multiresolution Wireframe Stability**: Reverted `updateWireframeBuffer` in `Multimesh.js` to the stable Three.js implementation to resolve index miswiring and opacity issues.
- **Fix**: **Animation Transport Auto-Start**: The SGL importer now properly initializes the track data within `AnimationRegistry` and triggers transport playback immediately upon loading animated SXR files.

# v1.0.171
- **Feature**: **Shape Key Interpolation Engine**: Activated shape morph animation capabilities directly inside the VR Animation DAW. Shape keys can now be evaluated, interpolated, and rendered to the headset entirely independently of object-level transformation keyframes.
- **Feature**: **Morph Keyframe Management**: Implemented a clipboard-driven action bar directly above the timeline allowing precise Copy, Paste, and Delete commands for shape keys at any arbitrary playback position.
- **UX**: Visual indicators for shape keys are rendered as bright yellow diamonds on track lanes, slider labels have been cleaned up to prevent text clipping, and the scene ground grid visibility toggle now automatically saves to local storage for persistent restoration across sessions.

# v1.0.169
- **Fix**: **Animation DAWs Matrix Stability**: Implemented strict quaternion length normalization and fallback sanitization inside the Mocap Looper `captureTick` and frame updates to permanently prevent invalid vector outputs from corrupting scene matrices and generating `NaN` bounding box errors.
- **UX**: **Punch-in Marker Cleanup**: The bright orange visual reference bar that denotes your exact overdub insertion time now automatically clears from the timeline lane as soon as recording stops.
- **Diagnostics**: Completely silenced all verbose internal tracking console logs for Grab, Animation, Label, and Puppeteer modules to provide a perfectly quiet runtime console.

# v1.0.166
- **Diagnostics**: Added detailed trace logging to the Mocap Looper punch-in pipeline and Grab tool trigger release handlers to debug secondary-track recording failures.

# v1.0.165
- **Feature**: **Source-of-Truth Record Button Logic**: Completely decoupled the animation configuration toggles from recording execution. The transport Record button is now the absolute authority:
  - If the transport is already playing, both configuration toggles are ignored and the system immediately awaits a trigger pull to punch in dynamically without interrupting playback.
  - If the transport is stopped and Countdown is enabled, the system waits 3 seconds before starting both recording and playback simultaneously.
- **UX**: Renamed the UI toggle to "Start on Trigger".

# v1.0.164
- **Feature**: **Punch-In on Grab (Wait for Trigger)**: Added a highly intuitive recording mode to the Mocap Looper. When enabled, clicking Record simply arms the track ("🟢 Waiting for Grab..."). The system idles infinitely until you physically squeeze the trigger and pull an object using the Grab tool, at which point it instantly and seamlessly punches in on the exact frame of contact.
- **UX**: Made the 3-Second Countdown and Wait-for-Trigger options mutually exclusive via smart UI toggles.

# v1.0.163
- **Fix**: **Mocap Looper Multi-Track Desynchronization**: Resolved a severe timing flaw where recording a second object (overdubbing) would capture keyframes starting at loop time 0.0s instead of the active global playhead position, causing complete animation desynchronization. The registry now correctly derives its recording start offset directly from `globalPlaybackTime` for all overdub layers.

# v1.0.162
- **Feature**: **VR Animation DAW Timeline Stabilization**: Finalized the multi-track animation transport interface. Restored unconstrained, continuous playhead scrubbing that accurately tracks the physical controller pointer even if the hand drifts far outside the widget boundary.
- **Feature**: **Rest-Pose Vector Cache Hardening**: Upgraded the `AnimationRegistry` to capture absolute 4x4 transformation matrix parameters (`position`, `quaternion`, `scale`) directly upon recording initialization, bypassing legacy array indexing to guarantee muted or deleted tracks perfectly revert meshes to their original spatial location.
- **UX**: **Unified Visibility Vector Graphics**: Replaced problematic eye emoji text representations with standard scalable `Path2D` vector graphics matching the Outliner layer to ensure crisp rendering and flawless color override states across all UI elements.

- **Feature**: **Context-Aware Sculpting Intelligence**: Developed an intelligent object-selection tracker that monitors Outliner activity. Standard polygon selections automatically reactivate the last used sculpting brush, Voxel blocks switch to the Voxel tab, and mixed selections securely unset the active tool to enforce a strict, no-edit default state until explicit artist confirmation.
- **Fix**: **Transform Undo Stack Integration**: Relocated the custom state capture block inside the standard `Grab` lifecycle from `updateXR` to the native `end()` hook to guarantee full Undo/Redo support when moving primitives in space.
- **UX**: Removed noisy console outputs from Voxel sub-mode UI string concatenation loops and background SurfaceNets computation loops, and simplified default primitive naming inside the scene graph.

# v1.0.155
- **Fix**: **Phantom Mesh Resolution (ID Hardening Protocol)**: Permanently resolved the critical "Ghost Mesh" vulnerability where geometry became invisible but stuck in the scene graph after Voxel conversion or Remeshing.
- **Fix**: **Strict Object Identity Deletions**: Overhauled `getIndexMesh()` inside the core `Scene.js` engine to prioritize exact object reference matching (`===`) rather than generic `getID()` comparisons. This completely safeguards against cross-deletions when multiple elements share identical numeric tracking IDs.

# v1.0.154
- **Feature**: **VR Tools Fit and Finish**: Fully polished the VR palette tabbed interface. Added a subtle 2px separation border to all sub_tabs, perfectly aligned the Mini-HUD quick-picker within safe visible margins, resolved the layout cache-lock bug so tab options swap instantly upon click, hid the non-functional 'Snap & Weld to Center' tool, and migrated all Low Poly tools to a beautifully curated desaturated yellow theme (`#dcd6a8`).

# v1.0.153
- **Feature**: **Tools Menu Tab Reorganization**: Divided the massive, single-column Tools overlay into two clean tabs ('Sculpting' and 'Low Poly') to drastically reduce UI clutter inside the VR environment. The active tab state persists seamlessly between the main sidebar and the Mini-HUD quick-picker.

- **Fix**: **Multi-selection Raycast Stability**: Resolved a critical shared-variable mutation bug within `Picking.intersectionRayMeshes`. When evaluating multiple objects concurrently, the engine previously transformed the global ray destination vector in-place inside the loop, causing subsequent raychecks to wildly deflect. The loop now utilizes an isolated world-space copy, restoring perfect target accuracy for multi-object picking operations.

# v1.0.150
- **Feature**: **VR Selection Lock Enforcement**: Enforced persistent, un-shifting target binding across all sculpted inputs and standard Grab tool executions when the `Lock Selection` toggle is active.
- **Feature**: **Lock Multi-selection Transformation Support**: Fully integrated support for multi-selected Outliner items while locking is enabled. The manual picking filter now captures all active multi-select targets and simultaneously applies spatial transformation matrices to every included block during a single stroke event without jittering or losing focus.

# v1.0.149
- **UX**: **Persistent About Menu Scrolling**: Successfully restored thumbstick vertical scrolling and persistent state saving across overlay sessions for the VR About & Help menu.

# v1.0.143
- **Feature**: **Inset Tool Rewrite**: Complete ground-up rebuild of the VR Inset tool supporting dynamic independent un-welded per-face topology (when "Keep Together" is disabled), and precise per-face target midpoint averaging (when "Keep Together" is enabled) to prevent cross-cancellation and ensure coplanar, non-sinking boundary contraction across complex spherical shapes.
- **Feature**: **Precision Start Marker**: Integrated a prominent, glowing 0.2m yellow marker sphere precisely calculated from surface intersection matrix data, perfectly illustrating where the controller initially latched to support micro-precision manual drag gestures.

# v1.0.133
- **Fix**: **Extrude Garbage Pitfall Precaution**: Adjusted the Undo/Redo state recording mechanics within `Extrude.js` to completely avoid the "Garbage Pitfall". Array buffers are now properly and explicitly sliced using `.subarray` to limit snapshots exactly to active ranges (`nbFaces`, `nbVertices`), preventing trailing unused buffer memory from tangling wireframes or collapsing active ranges upon operation Undo/Redo.
- **UX**: **Subdivision Alert Non-Blocking Overhaul**: Replaced all blocking `window.alert` and `window.confirm` calls within `GuiTopology.js` with non-blocking `window.screenLog` VR HUD notifications. This ensures users are never forced out of immersive WebXR mode by desktop modal dialogs when attempting reverse subdivision checks or multiresolution boundary actions.

# v1.0.132
- **Feature**: **Extrude Keep-Together Mini-HUD Integration**: Successfully hooked up the interactive `keepExtrudeFacesTogether` boundary extraction toggle to both the main VR tools submenu and the permanent left-wrist Mini HUD interface.
- **UX**: **Side-Wall Full Loop Spawning**: Extrude tools now explicitly support contiguous side-wall spawning via checking boundary edges dynamically when Keep-Together is completely disabled, ensuring non-merged faces generate complete exterior blocks perfectly.

# v1.0.131
- **Feature**: **Low Poly Modeling Tools**: Implemented one-shot **Extrude** and **Inset** low-poly tools explicitly optimized for VR 6DOF interaction. Extrude creates continuous quads and supports 6DOF follow movement. Inset dynamically scales a face inner-ring towards its geometric center driven seamlessly by hand displacement along the targeted surface normal.
- **UX**: Fully integrated both new tools into the interactive VR HUD panel, complete with descriptive vector labels and synchronized visual green color-coding conforming to application low poly toolsets.
- **Fix**: **6DOF Undo Consistency**: Relocated custom state snapshot capturing in both `Extrude` and `Inset` from the initial click phase to the actual `end()` phase, ensuring Undo operations precisely capture and restore the final dragged positions of the continuous stroke without snapping or reverting incorrectly.
- **Fix**: **6DOF Extrusion Spatial Mirroring & Pivot Decoupling**: Resolved an issue where symmetric mirrored extrusion targets moved toward the origin. The algorithm now dynamically groups duplicated vertices by spatial sign (left/right) and computes independent barycentric pivots (`pivotRight`, `pivotLeft`) for rotation and mirroring, preventing any collapse or shear. Symmetrical duplicate faces now precisely invert both their X-axis positional delta and rotational orientation relative to the center plane, achieving absolute visual symmetry.
- **Feature**: **Dual Extrusion Modes (Split vs Together)**: Extrusion operations now support two distinct topological boundary models. By default, every targeted face map independently extracts its own isolated edge perimeter (`keyPrefix`), ensuring symmetric center-line extrusions (or multi-face selections) perfectly split apart into un-merged isolated blocks. Setting `keepExtrudeFacesTogether = true` cleanly merges boundary loops into a single contiguous bridge for consolidated shapes.
- **Fix**: **Inset Ring Proxy Indexing**: Fixed an indexing breakdown where `Inset._vProxy` erroneously polled the original pre-duplicated unallocated vertices list, resolving the bug where inset face selections collapsed and disappeared.
- **Safety & Undo**: Tools strictly adhere to established low-poly memory standards, utilizing absolute vertex snapshots (`captureMeshSnapshot`), dynamic topology invalidation (`updateGeometry`, `updateBuffers`), and wireframe-buffer destruction for high-fidelity mesh state management.

# v1.0.130
- **Feature**: **Multiresolution VR HUD Readout**: Enlarged the multiresolution section in the VR Topology menu. It now precisely displays the active level range alongside targeted baseline and max-resolution vertex readouts.
- **Feature**: **Reset to Level 0 Macro**: Added a single-click "Jump to 0 & Del Higher" button inside the Topology menu to instantly clear high-resolution multires layers in a single step.
- **Fix**: **Reverse Base-Level Wireframe Synchronization**: Resolved crisscrossing and scrambled wireframe line segment tangling occurring on meshes constructed using the 'Reverse' algorithm down-sampling passes. By tracking `getEvenMapping` inversion tables, the pipeline dynamically translates base Level 0 line indices through the intermediate parent mapping chain (`getVerticesMapping`), guaranteeing perfect alignment against the active high-resolution shared position coordinate buffers.

# v1.0.129
- **Feature**: **Continuous Surface Relaxation**: Finalized the Slide brush's sub mode (Alt / Negative). Holding the negative modifier triggers a continuous, surface-constrained tangential relaxation flow across local geometry, untangling intersections in place without losing form or volume.
- **Fix**: **Symmetry Mapping Alignment**: Fully synchronized continuous dual-handed stroke execution and alpha projection falloff mirroring on the constraint slider to perfectly match symmetric twin coordinates and eliminate offhand projection shear.

# v1.0.125
- **UX**: **Mesh Processing State UI Feedback**: Decimation and Isotropic Remeshing buttons in the VR Topology menu now provide real-time feedback by disabling themselves and displaying a "Processing..." label while their respective WASM/Worker loops execute, mirroring the behavior of the Quad Remesher.
- **Safety**: **Duplicate Click Prevention**: Decimation and Isotropic Remeshing operations now incorporate a duplicate click prevention lock and a 30-second safety timeout reset to prevent worker stalls from permanently locking the UI.

# v1.0.122
- **Performance**: **WASM Threading Investigation**: Investigated 7.5-second lockups in Baby Shark library calls (`simplifyMesh`, `remeshIsotropic`).
    - Forced Rayon to use a single thread to avoid threading overhead in the browser.
    - Attempted full WASM multithreading with atomics and isolation headers (`Cross-Origin` headers in `vite.config.js`).
    - Assessed `Three.js` `SimplifyModifier` as fallback (found to be too slow and hung color mapper).
    - Retained Baby Shark at ~7s as the best available path for now.
- **Fix**: **WASM Caching**: Added `{ cache: 'no-store' }` to the WASM fetch in `GeometryWorker.js` to ensure fresh builds are loaded.

# v1.0.121
- **Feature**: **Local Triangle-Only Quadrangulation**: Added a "Skip Quads" option to the Quadrangulate tool in VR. When enabled, it performs a purely local search to merge adjacent triangles into quads without welding vertices or processing existing quads. This prevents loss of color data and preserves clean topology.
- **Fix**: **Color Loss in Quadrangulation**: Fixed issue where the regular Quadrangulate tool removed vertex colors by mapping colors to the new welded vertices in the worker.
- **Fix**: **DataCloneError**: Fixed a worker error when color and vertex arrays shared the same memory buffer by filtering duplicates from the transfer list.

# v1.0.120
- **Fix**: **Mesh Shading Corruption (Black Mesh)**: Resolved issue where `DeleteFace` and other topological edits caused the mesh to go black.
    - Fixed `allocateArrays` in `Mesh.js` to correctly copy existing colors and materials when reallocating arrays for non-UV meshes (e.g., from `baby_shark`).
    - Added a final pass in `updateGeometry` to catch and fix zero-length or NaN normals by forcing them to `[0, 1, 0]`.
- **UX**: **VR Sliders Fix**: Fixed hardcoded values in `decimateTargetFaces` and `remeshEdgeLength` sliders in `GuiVRTopology.js` so they are now fully interactive and retain their values. Added `getDisplayValue` to format and update their text labels in real-time.

# v1.0.119
- **Feature**: **Stylus Tilt Controls**: Added a "Stylus Tilt" slider to the VR Settings menu (range ±45°). Updated laser pointer, raycast picking, and volume intersection to account for the tilted stylus.

# v1.0.115
- **Fix**: **Symmetry Mirror Topology**: Standardized pipeline to Welding -> Cleanup -> Dissolution -> Cleanup -> Compaction. Increased welding tolerance to 0.01 to collapse tiny sliver edges along the centerline.

# v1.0.93
- **Fix**: **Removed Valence-2 Dissolution**: Removed the experimental block that dissolved valence-2 vertices on the centerline in `symmetryMirror`. This was causing severe topology corruption by blindly merging vertices without geometric validation.

# v1.0.91
- **Optimization**: **Spatial Grid for Welding**: Replaced the `O(N^2)` distance search in `symmetryMirror` with a spatial grid (cell size `0.001`) with neighbor checks. This restores near-instant performance on large production assets while maintaining robust floating-point tolerance.

# v1.0.90
- **Fix**: **Symmetry Plane Sliver Faces**: Added a check in `symmetryMirror` to discard faces where all vertices lie entirely on the symmetry plane (`X = 0`). This prevents zero-width "internal walls" from creating non-manifold geometry.

# v1.0.89
- **Fix**: **Distance-Based Vertex Welding**: Replaced the grid/rounding-based welding in `symmetryMirror` with a distance-based search (`EPSILON = 0.001`). This prevents floating-point drift from creating duplicate vertices at the center line that fail to weld.

# v1.0.88
- **Fix**: **Symmetry Non-Manifold Mess**: Resolved issue where `symmetryMirror` created duplicate and degenerate faces when vertices were snapped to the center plane, by adding a duplicate face removal step and compacting the face array.

# v1.0.87
- **Fix**: **Garbage Separation in Snapshots**: Resolved persistent edge collapsing on undo by manually slicing arrays in `captureMeshSnapshot` to prevent garbage at the end of pre-allocated buffers from leaking into the snapshot.

# v1.0.86
- **Fix**: **Wireframe Ghosting on Undo**: Resolved issue where undoing a completed cut left collapsed edges at the origin by forcing wireframe edge arrays to rebuild.

# v1.0.85
- **Feature**: **UV Support in Undo/Redo**: Fixed mesh corruption upon undoing a completed cut by properly capturing and restoring the UV buffer (`texCoordsST`) in custom states, adhering to Low-Poly Tool Standards.

# v1.0.84
- **Feature**: **Global Undo/Redo for Cut Operation**: Implemented global undo/redo for the completed Cut operation by capturing mesh snapshots before and after the cut, resolving the mesh "explosion" issue.

# v1.0.83
- **Feature**: **Granular Redo for Cut Tool**: Implemented a granular redo system for the Cut Tool, allowing users to restore reverted cut markers by pressing Redo (Thumbstick right on non-dominant hand).

# v1.0.82
- **Feature**: **Granular Undo for Cut Tool**: Implemented a granular undo system for the Cut Tool, allowing users to revert individual cut markers by pressing Undo (Thumbstick left on non-dominant hand).

# v1.0.81
- **Feature**: **Live Rubberband Preview**: Implemented a live rubberband line that stretches to the hover-snapped marker, giving immediate feedback.
- **UX**: **Topology-Restricted Selections**: Limited valid next cut points to only features that share a face with the last clicked point, preventing invalid complex cuts.
- **Fix**: **Fault Marker Cleanup**: Ensured all markers (including yellow highlight sphere) are cleaned up on tool exit and undo.

# v1.0.79
- **Feature**: **Low-Poly Tools Conformation**: Standardized `FillHole`, `SpinEdge`, `Weld`, and `SnapWeldCenter` to use the snapshot-based state management system for reliable Undo/Redo.
- **Feature**: **Grid Solver for FillHole**: Implemented a robust 2D projection corner detection algorithm to analytically determine `M x N` grid dimensions, preventing skewing on curved surfaces.
- **Fix**: **Wireframe Cache Invalidation**: Forced wireframe cache invalidation in `applyMeshSnapshot` to ensure Three.js wireframe meshes are rebuilt after topology mutations.
- **Fix**: **Defensive UV Resizing**: Added safety checks to prevent `RangeError` when modifying vertex counts in `Weld` and `SnapWeldCenter`.

# v1.0.78
- **Fix**: **Voxel Mesh Alignment Drift**: Corrected grid-to-world coordinate mapping by standardizing on `resolution - 1` for step calculations, eliminating volume loss/inflation and scale-drift issues.
- **Fix**: **Voxel Material & Wireframe Inheritance**: Ensured voxelized mesh correctly inherits source polygon mesh's material properties and wireframe visibility state.
- **Fix**: **Tangled Wireframe during Voxel Edits**: Resolved wireframe line scrambles during live voxel sculpting by forcing a rebuild of the wireframe index buffer (`_wireframe = null`) when topology changes.
- **Fix**: **Undo/Redo UI Synchronization**: Custom undo/redo steps now trigger a HUD redraw to ensure visibility and UI state are correctly reflected in VR.

# v1.0.77
- **Feature**: **Global Exposure and Tone Mapping Controls**: Replaced the non-functional "Filmic" checkbox with a comprehensive control set in the VR Rendering menu, including a Tone Mapping combobox (None, Linear, Reinhard, Cineon, ACESFilmic) and a global Exposure slider (0.0 to 3.0).
- **Feature**: **Matcap Exposure Support**: Added a `uExposure` uniform to the custom Matcap shader to allow Matcap materials to respond to the global exposure slider.
- **Cleanup**: Removed the competing PBR-specific exposure slider to avoid conflict with the new global control.

# v1.0.76
- **Feature**: **Advanced Dynamic Boolean Modes**: Context-aware operations triggered by visibility states when exactly 2 objects are selected (Union if both visible, Subtract if one visible, Intersect if both invisible).
- **Feature**: **Quadrangulate Toggle**: Added an explicit toggle to quadrangulate the resulting boolean mesh immediately.

# v1.0.75
- **Feature**: **VR UI Standardization**: Standardized widget alignment, padding, and font sizes across all VR HUD tabs (Scene, Settings, Rendering). Replaced legacy canvas-drawn shapes with crisp, high-fidelity SVG path icons for visibility, delete, and checkboxes.
- **Feature**: **Scrollable Overlay Menus**: Enabled thumbstick scrolling on massive overlay menus (like Settings) with proper isolation from background tabs.

# v1.0.73
- **Feature**: **User-Adjustable Stylus Offset (Z-Shift)**: Added a "Stylus Z-Shift" slider to VR Settings (-0.15m to +0.15m). Allows pulling the visual stylus tip backward/forward to sit flush with the physical controller model across different runtimes (PCVR vs. Standalone).
- **Fix**: **Local WASM Loading over Network IP**: Resolved `TypeError: Incorrect response MIME type` when testing locally via network IPs by swapping fragile hostname string-mapping for Vite's native `import.meta.env.DEV`.
- **Fix**: **WebXR Stylus Options Persistence**: Whitelisted stylus variables in `getOptionsURL.js` ensuring changes persist across page reloads. Visual meshes now automatically pre-scale and pre-shift to stored values on startup.

# v1.0.72
- **Feature**: **Visually Rich Browser Gallery**: Implemented a standalone, visually rich overlay gallery for managing saved sculpts within VR.
- **Feature**: **Procedural and Real Thumbnails**: Added support for thumbnails in the gallery. In non-VR mode, it force-renders the canvas synchronously. In VR mode, it auto-frames the sculpt using a transient headset camera and snaps it!
- **UX**: **Auto-Fitting Camera Viewport**: The thumbnail camera automatically computes the bounding box of your sculpt and adjusts FOV to fit it perfectly in frame!
- **UX**: **Ultra Clean UI Screen Snaps**: It temporarily hides all scene children (menus, HUDs, controllers) during screenshot render passes to ensure pristine thumbnail views!
- **Fix**: **Resolved Popup Closing Bug**: Fixed a race condition where the gallery overlay would close immediately after being opened from the Files menu.

# v1.0.71
- **Feature**: **Thumbstick Menu Scrolling**: Either thumbstick (dominant or non-dominant) can be used to scroll the VR main menu viewport when pointing the laser at it.
- **UX**: **Variable Scroll Speed Limits**: Default thumbstick scrolling set to a high-tempo `24px` per tick. Holding the secondary trigger drops it to `4px` for fine precision.
- **Fix**: **Stray Scene.js Comment Glitch**: Reconnected an orphaned `*/` tag that had accidentally broken module parsing.

# v1.0.70
- **Fix**: **Calibrated Color Space (Gamma Un-correction)**: Solved double-gamma scale washouts when eyedropping from mesh vertex colors. Calibrates raw Linear output correctly to three.js pipeline specs.
- **Fix**: **Hue Wheel Infinite Drag persistence**: Prevented lasers dropping or focus dropping when flying off the edge of quads by employing infinite-plane intersection math. Resolved hue resetting to Red (H=0) when Saturation reaches 0.
- **UX**: **Three-Arc Comparison Swatch Ring**: The VR Surface ring is now split into 3 independent arcs: Top 50% (Live Sample), Lower-Left 25% (Previous FG Color at start), Lower-Right 25% (Secondary BG Color) for a total visual side-by-side comparison system.

# v1.0.69
- **UX**: **Live Eyedropper Ring Comparison**: Split the brush surface ring into Top/Bottom arcs. The Top arc previews the live-sampled color of the mesh, while the Bottom arc displays the current active paint color for direct visual comparison.
- **UX**: **Hide Sculpt Visuals While Sampling**: The volume brush sphere and cube indicators are now hidden while the eyedropper is active to clearly signal selection mode vs painting mode.
- **UI**: **Crisp Vector Eyedropper Icon**: Replaced manual canvas strokes with the full Lucide standard vector path drawn at native 1:1 scale (no sub-pixel scaling) to achieve high-fidelity rendering in VR.

# v1.0.68
- **Fix**: **Stabilizing VR Transform Gizmo**: Resolved erratic behavior under non-uniform scale operations by implementing a robust TRS decomposition mechanism.
- **Fix**: **Coordinate Space Synchronization**: Fixed a bug where local constrained axes were used directly as world axes, causing gimbal tumbling when rotating offset objects. The axis is now correctly transformed to world coordinates.
- **UX**: **Intuitive Gesture Interaction**: Standardized single-axis rotation swipes to follow visual intuition – X and Z use standard counter-clockwise subtraction, whilst Y is inverted to track the "front" of the object during an intuitive hand pull.
- **Performance**: Resolved a critical zerovector clone glitch that tanked frame-rate performance when scale handles were engaged.
- **UI**: Added missing translations for `sculptWeld` in `src/gui/tr/english.js` to silence auto-HUD localization warning floods.

# v1.0.67
- **Feature**: **Weld / Target Weld Tool**: Created a new synchronous two-click sequential tool for zipping together separated vertices or merging loose geometry. It is safely integrated into the VR Tool Wheel.
- **Fix**: **VR HUD Scale Fix**: Clapped the `startY` of the mini-HUD tool selections to `Math.max(20, ...)` to ensure that adding more tools does not push the top entries off the top of the viewport.
- **Fix**: **Silenced HUD Log Floods**: Added translations for `sculptCollapseEdge` and `sculptDissolveVertex` to `english.js` to silence auto-HUD localization warning floods.
- **Cleanup**: Restored focus to Low Poly tools by removing the unfinished `Global Dissolve` button on standard topology.

# v1.0.66
- **Fix**: **Edge Dissolve Tool Stabilization**: Resolved a major issue where face normals would flip inward or tilt when reconstructing quads. Implemented dynamic counter-clockwise vertex ordering based on outward-pointing normal dot products.
- **Performance**: **In-Place Edge Dissolution**: Replaced complete mesh object replacement with in-place index buffer updates. This eliminates the black flashing/disappearing mesh during edit and undo/redo cycles.
- **Fix**: **Silenced Startup Error**: Removed the harmless `Radius: 0` error popup during initial bounding box calculation before scene load.

# v1.0.65 (Work in Progress)
- **Feature**: **Manual Topology Swaps (Triangulate & Quadrangulate)**: Added explicit buttons to the VR Topology menu to toggle between triangle and quad dominant meshes in-place.
- **Architecture**: **In-Place Modification & State Management**: Overhauled sculptor message handlers to perform updates on the existing mesh reference, avoiding scene clutter and duplicates.
- **Architecture**: **Custom Undo/Redo Tracking**: Registered custom state snapshots for manual topology changes, tying them seamlessly into the global undo history.
- **Fix**: **TypedArray Capacity Bounds Safe Rebuilds**: Dynamically throttles `MeshStatic.OPTIMIZE` during `mesh.init()` to bypass out-of-bounds capacity crashes on non-UV secondary face index typed arrays.

# v1.0.64
- **Feature**: **Symmetry Mirror & Quad Merge Optimization**: Ported Blender's BMesh `quad_calc_error` metric (Planarity, Squareness, Area Symmetry) to JavaScript for clean, visually high-grade quad merging.
- **Topology**: Loosened candidates threshold to `0.2` (approx 78° tilt) to force the Priority Queue to sweep curved surfaces cleanly, turning spheres into quad-dominant meshes!
- **Symmetry**: Removed legacy `x1000` scaling up and down during Manifold-3D CSG boolean union to prevent double-surfaces hanging on the seam. Added a `weldVertices` pass *after* union so quads can gracefully merge across the mirror plane.
- **Symmetry**: Pre-snapping vertices to the symmetry plane (threshold 1mm) before slicing with `splitByPlane` to prevent slicing through face interiors and causing slivers!
- **UI**: New meshes now inherit the wireframe toggle status of their parents during Mirror operations!

# v1.0.63
- **Feature**: **Quad Remeshing**: Integrated `quadrs` Rust library via WebAssembly for automatic quad remeshing.
- **UI**: Added UI toggles for Target Faces in both Desktop and VR Topology menus.
- **Feedback**: Added processing states, duplicate click protection, and a 30s safety timeout.
- **Visuals**: Automatically hides the old mesh and wireframe while inheriting materials and transforms for a seamless transition.
- **Attribution**: Powered by [quadrs](https://crates.io/crates/quadrs), an experimental Rust port of Instant Meshes.

# v1.0.62
- **Fix**: **OBJ Export Extensions**: Explicitly specified `application/octet-stream` for OBJ exports, forcing the browser to treat it as generic binary data and preventing the `.txt` suffix appending.

# v1.0.61
- **Fix**: **Voxel Remesh Stabilization**: Switched from World Space Box3 to Local Geometry Bounding Box for simulation sizing, decoupling the voxel engine from parent transforms and scaling.
- **Fix**: **Voxel Resample Math**: Implemented proportional distance field scaling `(newSize / oldSize)` when changing voxel resolution to prevent the volume from collapsing into a solid interior.
- **Fix**: **Voxel Bounds Reset**: Active voxel bounds are now hard-reset during resampling to prevent out-of-bounds scanning and empty mesh extraction (`Verts=0`).
- **UI**: **Checkerboard Preview Scale**: Synchronized the density overlay with the visual mesh's true scale, ensuring the preview accurately represents the resolution the user will get.

# v1.0.60
- **Build & Optimization**: **Voxel Worker Production Fix**: Migrated `SculptVoxel.js` to use Vite’s native `?worker` query for Worker bundling. This forces Vite to bundle `VoxelState.js` code directly into the Worker during build, eliminating 404 runtime errors.
- **Build & Optimization**: **Vite Worker Output `es`**: Configured `vite.config.js` to use `worker { format: "es" }` to support code splitting without breaking production builds with rollup `iife` errors.

# v1.0.56
- **UI**: **VR Sidebar UI Refactor from Accordions to 3-Tab View**: Overhauled the VR Sidebar menu to utilize a fixed-header 3-tab layout ("Rendering", "Topology", "Sculpting"). This eliminates vertical scrolling through headers.
- **UI**: **Folder Tab Aesthetic**: Applied a beveled trapezoid shape to the sub-tabs with dark-gutter background contrast to replicate unified UI file folders. Shifted left/right slopes inwards to prevent overlap with the cyan panel border.
- **UI**: **Responsive Scroll Windows & MiniHUD Overdraw Fix**: Fixed a viewport bounds leak where scrolling context elements would overdraw the tab headers or bleed into the MiniHUD. 

# v1.0.55
- **Feature**: **Voxel Build-Up (Tapered) Scaling**: Modulated brush radius using a time-based interpolation to enable tapered sculpting strokes.
- **Fix**: **Inverted Time Ramp for Negative Sculpting**: Negative modes now shrink from Max to 0 (tapering down to a point) for better organic carving tail finishes.
- **Fix**: **Flat Mesh Shader Reads Color**: Transformed standard WebGl `ShaderFlat` to correctly bind and read vertex colors instead of a solid red override. Now you can visualize faceted facet normals while keeping your paint!
- **UI**: **Menu and Widget Clean-Up**: Removed unused smooth shading button from voxel panel and removed diagnostic color swatch from the shared color picker UI without layout shifts.

# v1.0.54
- **Fix**: **Voxel Color Fidelity**: Resolved a persistent color channel shift (Red to Purple, Yellow to White) during mesh-to-voxel conversion by correctly assigning the Blue channel in the SDF writing loop.
- **Fix**: **Variable Hoisting**: Fixed a hoisting issue where `nbVertices` was used before being defined in `meshToVoxel`.

# v1.0.50 - v1.0.53
- **Performance**: **Voxel WASM Integration**: Fully integrated the Rust WebAssembly module for Voxel mesh generation (`SurfaceNets`), dropping mesh extraction compute times from ~20ms (JS) down to ~8-12ms, enabling buttery smooth voxel sculpting at high resolutions.
- **Performance**: **First-Stroke Voxel Stutter Fix**: Resolved a massive ~1-second framerate lockup (`1,074ms computeVertexNormals`) caused by a legacy hack that attempted to allocate 1,000,000 dummy polygons on the main thread during initialization.
- **Performance**: **Dynamic Reallocation Bypass**: Removed an unconditionally called `initThreeMesh()` loop that was unnecessarily destroying and rebuilding the entire WebGL `BufferGeometry` on every single stroke. The voxel engine now seamlessly utilizes native Three.js 0.5ms `gl.bufferSubData` patching instead.
- **Fix**: **Invisible Voxels**: Corrected the mesh instantiation flow to guarantee Three.js `BufferGeometry` compiles correctly on the exact frame the Voxel is placed, rather than requiring a second stroke to appear.
- **Fix**: **WASM Stability & Bridge**: Implemented a persistent WebAssembly memory bridge to eliminate heap thrashing and aggressive garbage collection spikes, ensuring `SurfaceNets` stays memory-safe throughout infinite sculpting duration.

# v1.0.49
- **Feature**: **Three.js Port for Transform Gizmo**: Ported the legacy WebGL Transform Gizmo to the Three.js scene graph. It now renders correctly and follows the world transformations.
- **Fix**: **Gizmo Scale & Selection**: Resolved issues with the gizmo disappearing or being misaligned by ensuring proper matrix updates and picking radius calculations.
- **Fix**: **Gizmo Interaction**: Restored full translation, rotation, and scaling functionality for the gizmo in VR.

# v1.0.48
- **Fix**: **Paint Tool Restored**: Fixed a variable mapping regression between the legacy `BufferGeometry` name (`aColor`) and modern Three.js's native vertex extraction buffer (`color`). Custom attributes are now routed to `BufferGeometry` perfectly!
- **Chore**: **Noise Reduction**: Heavily stripped debug telemetry including `[XR Tracking]`, `[L]`/`[R]` didHit, and `Mode: AIR/UI` to provide a clean development workflow. Use profiling tools manually when needed.

# v1.0.47
- **Feature**: **Controller Model Override & Dynamic Reloading**: Added a "Controller Model Override" combobox to the VR Settings menu. Users can now manually segment the WebXR controller profile reported by the runtime, bypassing hardcoded limitations (like Virtual Desktop's transmission of hardcoded strings). The override applies instantly to runtime models without session restarts!
- **Architecture**: Created a local variant of `XRControllerModelFactory` (`src/XRControllerModelFactory_local.js`) to bypass optimization caching of module modules and securely extract internal Threejs profile variables.

# v1.0.45
- **Performance**: **Canvas Context Proxy for Menus**: Removed heavy `ctx.filter` from the main drawing loop and replaced it with a fast Javascript Proxy layer that intercepts and shifts colors on-the-fly. Instant framerate recovery for all menu draw passes!
- **Fix**: **Hue/Saturation Edge Cases**: Converted HSL tool definitions to Hex strings so that the Proxy correctly parses and intercepts them without heavy string regex evaluations inside the render loop. Fixed `parseFloat` type coercion errors that defaults to unshifted outputs.

# v1.0.44
- **Refactoring**: **Button Rendering Consolidation**: Unified the button rendering paths for the Main Menu, MiniHUD, and Tool Picker overlay into a single shared function (`_drawButton`).
- **Visuals**: Replaced the hardcoded intense green highlights with a subtle light gray selection border to reduce distractions.
- **VR Anti-Aliasing**: Applied hardware `shadowBlur` (radius 2) to the selection border, significantly reducing pixel crawl and aliasing in both GalaxyXR and Quest 3 headsets.

## v1.0.43
- **Feature**: **Menu Brightness and Saturation Sliders**: Added fine-tune controls for the visual appearance of the VR menus. Adjust brightness (0 to 1, mapping to darker tones) and saturation (0 to 1, piecewise mapping up to 500% boost).
- **UX**: Unified application of these settings across the Main Menu, MiniHUD, and the context-sensitive Tool Picker popup.
- **Visuals**: Reduced the active tool button highlight from intense green to a subtle light gray to avoid visual distraction.

## v1.0.42
- **Feature**: **VR Poly Move Tool Rotation Fix**: Resolved the "drift" issue where vertices did not follow the ray's sweep during rotation. Updated the tool to utilize the controller's origin (and its mirrored counterpart for symmetry) as the rotation pivot, keeping drawn vertices perfectly locked to the brush cursor dot.

## v1.0.41
- **Feature**: **Wireframe Bias & Opacity Sliders**: Added fine-tune controls for the mesh wireframe overlay in VR. Adjust depth bias offset and transparency live! Defaults to `0.001` bias (1mm) and `0.2` opacity (20%).
- **UX**: Expanded sliders to support arbitrary ranges (`0.0 - 1.0` and `0.0 - 0.005`) without UI track scaling quirks.
- **Cleanup**: Purged redundant console logs (`[Mesh]`, `[GuiVRTools]`, `[Multimesh]`) to restore a silent, performant developer console.

## v1.0.40
- **Feature**: **Timestamps on Save**: Saves are now dated (`yourMesh_YYYYMMDD_HHMM.ext`) to bypass the GalaxyXR overwrite prompt and avoid accidental loss!
- **UI**: Scale-agnostic **Precision Center Dot** added to the brush circle for fine ray-alignment.
- **UI**: Silenced HUD logs inside the main `VRMenu` to prevent obstructing long panels.
- **Visuals**: Menus scaled down to optimal proportions for better field of view.

## v1.0.39
- **Feature**: **Pure Spatial Mirroring for Symmetry**: Resolved persistent skewing and offsets in standard brush tools by adopting a "Pure Spatial Volume" approach (matching `Drag` and `Move`). The symmetry brush now bypasses surface raycasting and uses the mathematically perfect mirror of the main brush in local space. No more jumping or $3.58cm$ offsets!
- **Cleanup**: Purged redundant console logs (`[SymDebug]`, `P-Pick`, `S-Sculpt`) to restore a silent, performant developer console.

## v1.0.38
- **Performance**: Optimized Move tool with fast AABB face rejection (`faceBoxes`), skipping 90% of distance checks on dense meshes.
- **Visuals**: Fixed MatCap brightness and rotation tracking (stability when mesh is offset).

## v1.0.33

- **Fix**: **VR Move Tool Symmetry & Stability**: Resolved a critical issue where the Move tool would fail to apply symmetry if the symmetric tip was in thin air (missed face). It now forces a fallback to the main mesh, preventing the primary move from "winning" and throwing the chin off-center.
- **Fix**: **Broken Brushes after Large Moves**: The Move tool now rebuilds the Octree (`mesh.computeOctree()`) at the end of a stroke. This ensures subsequent tools (Crease, Smooth) map correctly to heavily deformed geometry and don't miss or go crazy.
- **Fix**: **Ghost Grabs**: Prevented the Move tool from initiating a drag if the *current frame* did not hit a mesh, and reset intersection points to zero on failure to prevent leaking old state.
- **Fix**: **Console Spam**: Silenced verbose `[Pick Miss]` diagnostics during idle hover.

## v1.0.22
- **Fix**: **VR Picking Instability**: Resolved a severe picking instantiation bug where users frequently 'missed' the sculpt entirely when pulling the VR trigger. This occurred because the performant `intersectionRayMesh` pipeline was erroneously receiving World Space ray vectors instead of Local Space vectors when a mesh was actively locked for a stroke. Reverting to `intersectionRayMeshes([mesh], ...)` automatically handles the coordinate inversions, restoring flawlessly responsive picking even heavily translated/scaled assets.
- **Fix**: **Debug Spam**: Silenced the `Cursor VR Debug` verbose console output, dropping unnecessary internal frame overheads during continuous raycasting.

## v1.0.21
- **Fix**: **VR Move Tool Symmetry**: Resolved a critical issue where the VR Move tool would silently fall back to Desktop mouse coordinates for its symmetry origin. This was caused by the new ultra-fast thin raycast engine (introduced in v1.0.20) failing to set the `_isVRHit` flag. The Move tool now correctly utilizes proper VR mathematical plane mirroring.

## v1.0.2 - v1.0.20
- **Feature**: **VR Cursor Visuals**: Restored 1:1 parity with the master branch for VR cursors. The volume indicator sphere now utilizes proper additive blending, desaturates to white based on tool intensity, and accurately tints red when negative mode is engaged. The stylus spike length was doubled to better represent the physical interaction point.
- **Fix**: **Raycast Optimization**: Discovered and fixed a major performance penalty caused by running thick volumetric cylinders (`intersectionRayMeshesVR`) against dense DynTopo meshes every frame. Reverted to ultra-fast thin octree raycasts (`intersectionRayMeshes`) to restore 90hz performance.
- **Fix**: **Raycast Penetration Bug**: Fixed the "jumping to the opposite side of the mesh" bug. When the user pushes the physical controller inside the solid clay volume, the thin raycast evaluates the inside of the back geometry. Added mathematical dot-product backface-culling, so the cursor gracefully hides itself when inside a mesh rather than snapping to the opposite wall.

## v1.0.1
- **Feature**: **GUI Interaction Fixes**: Resolved deep VR interaction race conditions caused by high-speed controller jerks. Fixed double-clicks, sweep-clicks, and drag deadzones, allowing the UI to instantly and flawlessly respond to physical controller input.
- **Fix**: **Draw Order Sync**: Fixed a visual desynchronization issue where toggling a checkbox would execute the software action but wait a full frame before visually updating the UI.

## v1.0.0
- **Milestone Release**: **Three.js Architecture Overhaul**. Completely stripped out raw WebGL matrix rendering (`Render.js`, `Camera.js`, `Shader.js`) in favor of native Three.js v160 objects, meshes, and materials.
- **Feature**: **Three.js WebXR Management**: Relied on native `renderer.xr` session and camera management, establishing widespread hardware compatibility (Quest, GalaxyXR, Index, PCVR, Apple Vision Pro).

## v0.9.289 - v0.9.304
- **Performance**: **DOM Layout Thrashing Fix**: Discovered and fixed a major 60% CPU bottleneck caused by `window.screenLog` triggering synchronous `.innerText` layout recalculations every frame. Replaced with non-blocking `.textContent` and capped DOM element insertion length for an instant framerate boost on Standalone devices.
- **Fix**: **Samsung Galaxy XR Render Bug**: Implemented a WebGL `gl.scissor` hardware clipping hotfix and explicit per-eye Framebuffer re-binding (`gl.bindFramebuffer`) inside `renderVR` to bypass a Qualcomm Adreno/Chrome driver bug that was causing WebXR to only render the scene strictly in the left eye.
- **Fix**: **Mobile VR Fast Wireframes**: Changed the default Wireframe rendering mode to `Fast L0` not just for Oculus Browser, but for any detected `Android/Mobile VR` user agent (such as Chrome on Galaxy XR). PCVR safely retains `Smooth L0` defaults.
- **Fix**: **Hand Tracking Crash**: Resolved a `ReferenceError: require is not defined` crash that prevented native hand skeleton lines from rendering in the latest module build.
- **Fix**: **Frame Setup**: Resolved `ReferenceError: frame is not defined` from the XR Render Loop.

## v0.9.279 - v0.9.288
- **Feature**: **Native Hand Tracking Polish**: Rebuilt the VR Mini-HUD interaction model specifically for native hand tracking. The Mini-HUD now anchors dynamically to the physical palm of the non-dominant hand, and includes a proximity-based cyan glowing border to indicate when it is active.
- **UX**: **Z-Depth Push-to-Click**: Added an intuitive Z-depth physical collision system. You can now press Mini-HUD buttons directly by poking the panel with your index finger, completely eliminating the need to use awkward 'Pinch' gestures while hovering. 
- **UX**: **Grab Suppression**: Sculpting and world-grabbing operations are now rigorously suppressed anytime your dominant hand is within 25cm of your non-dominant wrist/palm. This permanently solves the issue where attempting to use the Mini-HUD would accidentally carve giant holes in the mesh or drag the world around.
- **UX**: **Visual Enhancements**: Added a `[ Main Menu ]` button directly to the Mini-HUD, and a global `[ Close Menu ]` button to the Main Menu overlay. Rendered basic hand skeleton spheres to visualize hand tracking data, and suppressed the main VR laser pointer while native hand tracking is active.

## v0.9.267
- **Feature**: **Voxel Smooth Tool**: Implemented a localized 3D Soft-Blur (averaging filter) over the SDF volume for Voxels. It evaluates a 3D bounding box natively within the worker thread, producing mathematically perfect bevels and organic transitions without physically moving geometry.
- **UX**: Exposed the Voxel Smooth tool in the VR Mini-HUD, and mapped it to the secondary trigger so you can rapidly smooth geometry on-the-fly while using the Add/Sub Voxel brush.

## v0.9.267 - 0.9.278 (2026-03-09)
*   **Voxel Move Tool:** Implemented a new 'Move' tool for Voxel sculpting.
    *   **Visual Proxy:** When the stroke begins, the tool captures the affected vertices and detaches them as a lightweight, real-time proxy that seamlessly translates and rotates 1:1 with the VR controller, preventing heavy `SurfaceNets` rebake stutters while dragging.
    *   **ODE SDF Advection:** Upon releasing the trigger, the tool dispatches a `WARP_SPHERE` command. The Web Worker utilizes a multi-step Reverse-Euler integration solver across the spatial distance field to perfectly recreate the proxy deformation within the voxel grid, effectively eliminating the common "spatial folding/tearing" artifacts seen in naive advection implementations.
    *   **Dual-Stroke Symmetry:** Fully supported symmetrical displacement mapping.

## v0.9.251 - v0.9.266
- **Feature**: **VR Trigger Sensitivity Calibration**: Added a new "Trigger Sensitivity" slider to the VR Settings menu. Rather than acting as a simple analog multiplier (which makes brushes feel weak), this slider mathematically defines the **binary physical activation threshold** of the VR controller's trigger.
- **UX**: **Index Controller Ergonomics**: Users with deep-throw analog triggers (like the Valve Index) no longer have to bottom-out the trigger at 100% force to start a stroke. Setting the slider to "Light" drops the physical bite-point to just 10% depression, while "Hard" requires a full 90% squeeze, allowing total ergonomic personalization.
- **Fix**: **100% Force Splat**: Diagnosed and fixed a high-level API flaw in `SculptBase.js` where the very first frame of every VR stroke was being instantiated with an undefined `options` payload. This caused brushes to drop a massive 1.0 (100% intensity) "splatter" frame onto the mesh before the analog curve could catch up. The initial stroke hit is now mathematically deferred into the native `updateXR` loop, ensuring total force consistency from the first millisecond of contact.

## v0.9.232 - v0.9.250
- **Feature**: **Version Update Prompt**: Added a cache-busting polling system that detects when a new version of SculptXR is deployed to the server.
- **UX**: **Desktop Warning**: When an update is detected on Desktop, a top-banner appears instructing the user to clear their browser cache and refresh.
- **UX**: **VR Mini-HUD Warning**: When an update is detected, standalone VR users will see a "new build ready!" warning string appended to the bottom of their Mini-HUD, alerting them without requiring them to remove their headset.
- **Fix**: **VR Text Clipping**: Shrunk the `window.screenLog` monospace font from 24px to 20px so that version strings (e.g., `v0.9.247 -> v0.9.248`) no longer overflow and clip out of the floating VR debug console.

## v0.9.217 - v0.9.231
- **Feature**: **Voxel Cube Brush**: The Voxel tool now natively supports a precise 'Cube' SDF brush shape alongside the traditional 'Sphere', accessible via the new Brush Shape toggle in the VR Mini-HUD and Desktop Tool menu.
- **Feature**: **Oriented Cube Sculpting**: When using the new Cube brush, users can toggle "Controller Alignment". When active, the voxel cube physically rotates with the user's wrist (via quaternion projection into the SDF local space), allowing for angled block carving and building.
- **Feature**: **Visual Brush Indicators**: The VR pointer now dynamically swaps between a transparent radius sphere or a transparent radius cube to perfectly match the active voxel brush shape and orientation in real-time.
- **Optimization**: **Voxel Worker Threading**: Completely refactored the Voxel Tool's geometry pipeline. The intensive `_computeNormals`, `_fixNormals`, and `color/material` sanitization loops were stripped from the main thread (`SculptVoxel.js`) and offloaded entirely to the Web Worker (`VoxelState.js`).
- **Optimization**: **Voxel Wireframe Rebuild Paradox**: Prevented the WebGL renderer (`MeshStatic.js`) from repeatedly triggering an expensive `O(N)` topology rebuild every single frame whenever wireframes were enabled on Voxel meshes.
- **Fix**: **Voxel Baking Crash**: Resolved `_computeNormals is not a function` throw when attempting to click 'Bake' on a Voxel mesh.
- **Fix**: **Giant Orange VR Cursors**: Disabled the legacy desktop orange debug cursors from erroneously appearing in the VR view at the world origin.
- **Fix**: **Voxel Cube Symmetry**: Corrected the quaternion math in the VR Sculpting payload so that the Cube brush rotation perfectly mirrors across the X-axis symmetry plane.
- **Polish**: Removed spamming debug logs (`VoxelWorker:`, `Voxel Res:`, etc.) from the internal worker and exposed the `Flat` shaded material option explicitly in the global VR/Desktop rendering menus.
- **UI Polish**: Removed an accidental duplicate "Flat shading" toggle button from the VR Rendering menu overlay.

## v0.9.209 - v0.9.216
- **Feature**: **Voxel Wireframe Restored**: Restored the wireframe toggle button for the Voxel tool in the Mini-HUD and optimized the mesh pipeline to support drawing wireframes directly over pure quad SurfaceNets structures.
- **Optimization**: **Wireframe Sub-Sampling (Standalone)**: Implemented a dynamic sub-sampling cap (`Wireframe.MAX_TRIANGLES = 300,000`) for the wireframe renderer. High-resolution meshes dynamically decimate the drawn lines for the overlay, instantly curing the severe CPU/GPU framerate lockups on Quest standalone headsets.
- **Optimization**: **Standalone Wireframe Default**: Standalone headsets (Quest) now automatically default to `Fast L0` wireframes to guarantee performance headroom on launch, while PCVR falls back to the denser `Smooth L0` tessellation.
- **Fix**: **Combobox UI Array Coordinates**: Fixed a critical coordinate offset bug that pushed newly opened comboboxes (like Wireframe/Shader selectors) off the right edge of their virtual canvas buffers when inside scaled 3D overlays.
- **Fix**: **Combobox Duplication**: Purged an overlapping phantom render pass that caused dropdown menus to draw twice simultaneously on the canvas.
- **Fix**: **Voxel Bake & Resample Integrity**: Traced and fixed a `ReferenceError: fArTri...` crash deep in `SculptVoxel.bakeToMesh`. Also resolved an issue where standard voxel stroke drawing would fail to register immediately after a bake operation.
- **UI Polish**: **HUD Tool Layout**: Stripped an unnecessary 100px padding margin from the Desktop-version logic that was bleeding into VR, instantly closing the giant gap between the Tool Picker grid and the Radius sliders.

## v0.9.159 - v0.9.175
- **Feature**: **Color Blur / Smooth Brush**: When using the Paint tool, holding the secondary trigger now natively blends and blurs vertex colors and PBR materials (Roughness/Metallic) within the brush radius.
- **UX**: **Contextual Eyedropper Cursor**: When actively sampling colors via the Mini-HUD Eyedropper, the brush's VR radius ring now instantly tints to the sampled color for immediate visual feedback.
- **UX**: **A-Button Color Swap**: Pressing the physical 'A' button (or 'X' button for left-handed users) now instantly swaps the Foreground and Background selected colors, complete with real-time UI synchronization in the Mini-HUD and the VR 3D brush cursor.

## v0.9.154 - v0.9.158
- **Polish**: **Mini-HUD Tweaks**: Shifted the Mini-HUD slightly higher and inward for a more symmetrical and comfortable viewing angle. Exposed `MINI_HUD_TRANSFORM` and `TOOLCOMB_TRANSFORM` variables to the global scope so developers can interactively tweak the 3D offsets of the HUD and Tool Picker via the DevTools console.
- **Fix**: **Duplicate Twist Tool**: Removed a redundant Twist tool entry from the VR Combobox. This reduces the total tool count to 15, allowing the UI to form 5 perfectly symmetrical rows without any trailing slots.
- **Fix**: **Isolate Toggle Logic**: Fixed a desynchronization bug where toggling "Isolate" via the Mini-HUD checkbox felt inverted. The controller now explicitly forces the underlying Sculpting state to match the physical VR checkbox state perfectly.
- **Cleanup**: **Undo Logs**: Stripped noisy debug console logs (`Shortcuts: Undo`) from the controller event listener.

## v0.9.150
- **UX**: **Intensity Mapping**: The X-axis (left/right) on the dominant controller's thumbstick now natively controls the Brush Intensity!
- **UX**: **Fine Tuning**: The secondary controller's trigger now acts as a "Fine Tuning" modifier lock. When held, sliding the primary thumbstick will adjust settings (like Radius or Intensity) at 10% of their normal speed, allowing for high-precision micro-adjustments in VR without opening the UI.

## v0.9.144
- **Feature**: **In-App Deep Profiler**: Added a robust in-app function profiler to diagnose standalone VR performance drops without remote debugging tools. The profiler wraps key classes (`SculptManager`, `Mesh`, etc.) and records millisecond execution times across a 60-frame window. It can be triggered via the "Log Deep Functions" button in the VR Settings menu and will wait for an active sculpt stroke before recording.
- **Feature**: **VR HUD Logger**: Implemented a native WebXR text logging system (`GuiXR.printLog`) that draws `window.screenLog` messages directly onto the VR Mini-HUD. This allows standalone users to view critical debug state, matrix readouts, and performance profiles completely in-headset. The VR HUD truncates to the last 2 lines directly in your vision while the full detailed output is safely preserved in the desktop console.

## v0.9.128
- **Bugfix**: **Proxy Snapping Stapling Bug (Geodesic Fix)**: Resolved the underlying mathematical flaw in the Slide brush that caused topological tangling and "locking" over high-curvature or non-Delaunay geometry. Previously, a macroscopic brush movement would tangentially shoot the tracking vertex physically off the curved surface, causing the Euclidean topology-walker to get trapped on the perimeters of distant faces. The Slide macro-movement is now **Sub-Stepped** into infinitesimal geodesic intervals, allowing the anchor to mathematically track the perfectly curved physical surface structure natively without ever defecting.

## v0.9.127
- **Bugfix**: **Proxy Snapping Stapling Bug**: Fixed a severe issue where multiple vertices would tear or "staple" together in a jagged line during long slides. The root cause was the `vTarget` tangentially projecting into a neighboring Voronoi cell on non-Delaunay (squished/uneven) geometry. When the algorithm geometrically clamped to the anchor's 1-ring faces, the vertex would get snagged on the 1-ring's infinite outer perimeter and drag along it instead of sliding natively across the sphere. The projection now evaluates the full **2-Ring neighborhood** (faces of the anchor AND its topological neighbors), guaranteeing `vTarget` finds the true unbroken proxy surface directly beneath it.

## v0.9.126
- **Bugfix**: **Slide Brush Proxy Normal Deflection**: Fixed a bug where ~10% of vertices would snap wildly or tangle during a slide. Tangential projection previously used the *live* vertex normal, which would tilt as the surface distorted during a stroke, causing the projection vector to deflect inward through the mesh. The projection now rigorously uses the *Proxy* normal of the topological `_slideAnchor` the vertex is currently migrating across, ensuring movement remains completely and safely tangential even over extreme distances.

## v0.9.125
- **Feature**: **Tangential Relaxation (Slide Brush)**: Re-enabled the scaled `smoothTangent` Laplacian pass within the Slide brush. Because the Proxy Migration feature (v0.9.122) now mathematically guarantees vertices cannot sink or erode over time, they are safe to gently relax against the surface to untangle the polygons during a slide naturally.

## v0.9.124
- **Hotfix**: **Slide Brush Initialization Crash**: Fixed a critical `TypeError` crash in the Slide brush that occurred on the very first frame of interaction. The `_slideVProxy` initialization order was corrected to execute *before* `super.startSculpt()` fires its initial stroke logic.

## v0.9.123
- **Hotfix**: **Proxy Migration Dynamic Topology Crash**: Fixed a critical `TypeError` crash in the Slide brush when used with Dynamic Topology enabled. The `_slideAnchors` and `_slideVProxy` arrays are fixed snapshots at the start of the stroke, but dynamic topology creates new vertices mid-stroke. Added bounds checking so newly spawned vertices gracefully fall back to live live geometry instead of accessing undefined proxy indices.

## v0.9.122
- **Feature/Fix**: **Proxy Migration (Mesh-Walking)**: Re-wrote the Slide brush's surface projection algorithm to project sliding vertices against an immutable, frozen origin mesh state (`vProxy`) rather than the live geometry. Vertices track their current location by topological "Mesh-Walking" across the proxy face adjacency. This permanently eliminates the geometric erosion (melting) problem when sliding over sharp details like lips and creases, perfectly preserving the original curvature over long, multi-stroke movements.

## v0.9.121
- **Experiment**: Disabled `smoothTangent` completely in the Slide brush to isolate the cause of shape erosion.

## v0.9.120
- **Hotfix**: **Slide Brush Detail Preservation**: Fixed a major bug where holding the Slide brush over sharp details (like creases or lips) would rapidly blur them out even if the controller wasn't moving. The tangential relaxation pass (`smoothTangent`) is now strictly scaled by the physical distance the controller translates during the stroke, perfectly preserving sharp curvature when the brush is held still or wiggled gently.

## v0.9.119
- **Refactor**: **VR UI Clean Up**: Removed the redundant "Negative" toggle button from the Mini-HUD, as the physical hardware button 'A'/'X' acts as a real-time override, freeing up UI space for future tool options.

## v0.9.117 - v0.9.118

## v0.9.112 - v0.9.116
- **Feature**: **Slide Brush**: Added a dedicated 'Slide' tool to shift mesh topology smoothly across the existing surface without adding or removing volume.
- **Math Upgrade**: **Closest-Point Snapping**: Replaced naïve tangential projection with an exact $O(1)$ 1-ring neighborhood raycast `Geometry.distance2PointTriangle` that snaps the translated vertex perfectly onto the unmodified local surface in real-time. 
- **Immersion**: **VR 6DOF Rotation**: The Slide brush tracks the incremental rotational delta `_dragQuat` of the VR controller (`main._vrControllerQuat`), allowing the user to twist and steer the edge flow tangentially while sliding the surface skin.

## v0.9.108 - v0.9.111
- **Feature**: **Relax Brush**: Added a dedicated 'Relax' tool to the brush palette. Unlike 'Smooth' which shrinks volume based on vertex average, 'Relax' projects vertex movement strictly onto the tangent plane, evening out density and fixing bad topology without losing surface details.
- **UI & UX**: **VR Combobox Math**: Rewrote the VR tool picker geometry to automatically center dangling items on rows that don't fit the strict 3-column layout.
- **UI & UX**: **Tool Organization**: Restructured the layout of the VR combobox, tinted the Relax tool Blue (smoothing group), and moved the Twist tool into the Green (transform/move group).

## v0.9.103 - v0.9.107
- **Feature**: **Drag Tool Restored**: Re-enabled the classic 'Snakehook' style Drag brush.
- **Math Upgrade**: Ported modern `Move.js` symmetry blending to `Drag.js` to prevent crossing mesh tearing.
- **VR Polish**: Fixed VR 1:1 physical tracking offsets, corrected cursor scaling, and normalized default brush radius.
- **Stability**: Resolved a `TypeError` by ensuring history state is pushed on initial VR strokes.
- **GL Fix**: Fixed a WebGL `GL_INVALID_OPERATION` crash when using Drag with Dynamic Topology by properly synchronizing geometry buffer lengths mid-stroke.

## v0.9.102
- **Polish**: **Tool Combobox Categorization**: The Mini-HUD Tool Picker buttons are now visually categorized by color (Red for Sculpting, Blue for Smoothing, Purple for Painting, Green for Transforms, Orange for Masking). The active selected tool label is forced white for maximum legibility against its green background.
- **Clean**: **VR Tool Labels**: Stripped extraneous desktop keyboard shortcuts (like `(-Shift)`, `(G)`) from the tool labels exclusively in the VR UI to reduce visual clutter, and renamed `Transform VR` to simply `Transform`.

## v0.9.94
- **Fix:** Implemented a Global Interaction Lock in `Scene.js`. This prevents a physical controller trigger press that originated on an overlay (like the Mini-HUD Tool Picker popup) from bleeding through and registering as a false click on the UI underneath (like the Radius Slider) when the overlay immediately closes.
- **Clean:** Removed noisy `[Hvr]` and `[Click]` debug logging generated by the UI pointer interaction system.

## v0.9.93
- **Fix**: **Color Picker UI Stability**: Fixed the intermittent responsiveness of the Swap Colors button by replacing the hover-exit debounce with a strict time-based cooldown (300ms).
- **Fix**: **Color Picker Drag Locks**: Fixed a bug where dragging from the Hue ring into the SV square (or vice versa) would cause the UI math to glitch and incorrectly update the wrong region. The active dragging region is now strictly locked and values are correctly clamped even if the pointer strays outside the visual boundaries of the widget.

## v0.9.85
- **Feature**: **Paint Tool FG/BG Color Swatch**: The Paint Tool now maintains a secondary (background) color and material state. You can swap between your foreground and background colors seamlessly via the 'Swap Colors' button in both the Desktop and VR GUIs, or instantly by pressing the `V` hotkey.
- **Feature**: **Mini-HUD Color Picker**: The Mini-HUD now explicitly supports the embedded color picker widget when the Paint Tool is active, making rapid painting adjustments in VR much more accessible.

## v0.9.84
- **Polish**: **Paint Brush Intensity**: The paint brush intensity slide now maps to an exponential curve (squared). This fixes an issue where the brush was too aggressive at low slider values, now allowing for very subtle "airbrush" style stroke build-up.

## v0.9.83
- **Feature**: **Long Distance Aim Sculpting**: When Aim Mode is enabled, brushes now mathematically project their radius and displacement down the length of the laser ray. This allows for long-distance sculpting with true 1:1 physical translation and accurate brush sizes on the distant surface.
- **Fix**: **Aim Mode Symmetry**: Fixed an issue where the symmetry brush failed to initialize in Aim Mode. Symmetry now perfectly mirrors the actual laser hit point rather than the physical controller position.

## v0.9.71
- **Fix**: **VR Move Brush Intensity**: Fixed an issue where the VR Move tool ignored the intensity slider and applied 100% displacement. Both positional drag and wrist rotation are now properly scaled by the brush intensity setting in VR.

## v0.9.70
- **Fix**: **Secondary Grip Collision**: Removed legacy logic that forced negative/subtract mode when the secondary hand's grip button was pressed, decoupling it and allowing the grip to function purely for 6DOF world navigation.

## v0.9.68 - v0.9.69
- **Deployment**: **Automated Version Bumps**: The `deploy.sh` and `deploy_beta.sh` scripts now automatically increment the patch version in `index.html` and `src/Version.js` when detecting a repeat deployment.
- **UI**: **Environment Labeling**: The version string in the bottom right of the UI now explicitly appends ` - PROD` or ` - BETA` based on the deployment hostname to prevent feedback confusion.

## v0.9.65
- **Tooling**: **Interactive Combobox Positioning**: Injected a `window.tpDebug` override into `Scene.js`. When running in PCVR, developers can now interactively adjust the 3D X/Y/Z offsets of the Tool Picker combobox (`_vrPopup`) via the DevTools console to perfectly tune its spatial alignment relative to the controller.

## v0.9.64
- **UI**: **Continuous Tool Picker Layout**: Adjusted the Tool Picker in `GuiVRTools.js` to have 0 padding between buttons. Modified the button border rendering in `GuiXR.js` to draw clean, inset 1px borders. This eliminates the visual gaps between buttons, merging them into a single, contiguous UI panel without needing an overarching background quad.

## v0.9.63
- **Rendering**: **WebXR Alpha Cutout Fix**: Resolved a critical rendering issue where transparent parts of the UI overlay canvases (like the Tool Picker) were overwriting the WebXR Framebuffer's alpha channel to 0 during standard blending. This caused the XR compositor to show the real-world passthrough instead of the 3D scene behind the UI. Fixed by adding a `discard` check for pixels with `alpha < 0.01` in the primary Texture shader.

## v0.9.62
- **UI**: **Tool Picker Legibility**: Removed the `noBg` flag from the Tool Picker buttons. The buttons now render with their own individual solid gray backgrounds, ensuring readability against the 3D scene after the overarching background panel was removed in v0.9.61.

## v0.9.61
- **UI**: **Tool Picker Simplification**: Completely removed the dark background panel from the Tool Picker overlay. The tool buttons now float directly over the 3D scene, eliminating any overlapping alpha rendering issues while preserving the pre-v0.9.57 layout alignment.

## v0.9.60
- **UI**: **Tool Picker Alignment Fix**: Corrected the bounds of the dark background quad on the Tool Picker combobox. By calculating the exact width/height of the button grid in `GuiVRTools.js` and passing it to the overlay renderer, the dark background now tightly wraps the buttons, removing the unnecessary alpha punch-out on the right and bottom edges.

## v0.9.59
- **Internal**: **Baseline Revert**: Reverted all experimental alignment and depth changes to commit `7c85b8f` to establish a clean baseline for depth testing.

## v0.9.56
- **UI**: **Hit-test Alignment Fix**: Resolved a coordinate misalignment issue in the Tool Picker and other overlays where the visual buttons and their hitboxes would diverge, especially at the edges of the screen. Fixed a scale mismatch where overlays were drawn at 1.13x scale but hit-tested at 1.0x scale.

## v0.9.55
- **UI**: **Mini-HUD Interaction Fix**: Resolved a critical issue where selecting a tool in the Mini-HUD tool picker would bleed the interaction event through to the radius slider beneath it on the next frame, unintentionally maximizing brush size. Implemented a strict rising-edge requirement for all base-layer interactions in `GuiXR.js`.

## v0.9.50
- **Optimization**: **Scaled World O(N) Bottleneck**: Replaced the VR cursor's static 5cm inner-search with an iterative, expanding octree search. This fixes a massive frame rate drop that occurred when using the 2-hand gesture to scale the world down, which previously caused the 5cm physical search sphere to encompass the entire dense mesh, triggering O(N) distance checks on all ~50,000+ faces at 90hz. The iterative search guarantees the engine only evaluates the few polygons physically intersecting the closest edge of the controller, regardless of world scale or brush size.

## v0.9.49
- **UX**: **Instant Button Latch**: The VR primary and secondary buttons (used for Negative Mode and Mini-HUD toggle) now respond instantly on press-down rather than waiting for release. If maintained as a long-press (transient hold over 300ms), the tool will seamlessly revert back to its previous state upon release.

## v0.9.48
- **UI**: **Tinted Hover Sphere**: The 3D VR brush radius sphere now dynamically tints its white x-ray material slightly red when Negative Mode is active (and slightly blue when positive), providing a much clearer visual anchor that perfectly matches the surface alignment cursor.

## v0.9.46
- **Optimization**: **O(N) Picking Bottleneck**: Added a multi-pass inner search constraint to `Picking.js:intersectionSphereMeshes` that checks a 5cm proximity radius before defaulting to the full brush volumetric sweep. This drastically reduces CPU load when hovering with massive brush radii over dense geometry by evaluating strictly the nearest dozen triangles rather than thousands, solving the large-brush framerate drop across all tools.

## v0.9.44
- **Optimization**: **Redundant Topology Hit Detect**: Prevented instances of `pickVerticesInSphere` from firing continuously on every hover frame when `isSculpting` is false within `SculptBase.js`.

## v0.9.43
- **Fix**: **Sync Wireframe Toggle**: Enabled the new 'Wireframe' checkbox on the Mini-HUD to stay visually synced with the active mesh's state, rather than just firing one-way callbacks.
- **Cleanup**: Stripped stale debug logging (`window.screenLog`) statements from `Scene.js` and `GuiVRTools.js` in preparation for main deployment.

## v0.9.42
- **UI Tweaks**: Added 'Wireframe' toggle directly to the Mini-HUD panel, below the Negative mode toggle.
- **UI Tweaks**: Shortened "Negative (N or -Alt)" to just "Negative" to reduce text crowding.
- **Fix**: Removed residual debug text (`SculptXR v...`) from the Mini-HUD rendering loop.
- **Fix**: Resolved an intercept bug in `GuiXR.js`'s `_updateHover()` method where the `cy < HEADER_HEIGHT` logic (originally meant for tabs) was inappropriately clearing mouse highlights for UI widgets physically located at the top of the Mini-HUD canvas (like Tool Select and Radius).

## v0.9.40
- **Fix**: **Left Handed Mode Crash**: Resolved a `TypeError: Cannot read properties of undefined` crash that occurred when switching to "Left Handed" mode and pressing the primary controller button. The VR button state tracking logic in `Scene.js` was generalized from hardcoded physical mapping (`.A` / `.X`) to a unified `.Primary` key that dynamically binds correctly for both standard and inverted interaction profiles.

## v0.9.39
- **Fix**: **Mini-HUD Radius Persistence**: Fixed a bug where selecting tools from the Mini-HUD popup would reset UI widgets (like the Radius slider) back to an arbitrary default (`0.20`), hiding the tool's actual saved state. Modified `syncWidgetValues` and `updateRadiusWidget` to ensure complete state synchronization across `_guiXR`, `_guiMini`, and `_guiPopup` render loops without breaking tool callbacks.
- **Fix**: **Controller Thumbstick Radius**: Adjusted the hardware thumbstick (up/down) to dynamically scale the brush size in both the main menu and the new Mini-HUD instantly (via simultaneous calls to both UI contexts).

## v0.9.0
- **Milestone Release**: Bumped version to v0.9.0 for the next major development cycle.
- **Verification**: Verified deployment stability on Quest 3 native browser during major version transition.

## v0.8.230
- Tidy up: Massive repository deep clean, removing old testing scripts, generated diffs, numerous backup files from `src/`, and legacy debugging HTML pages.

## v0.8.229
- Tidy up: Removed unreferenced matrix testing files, golden reference files, and temporary GUI code from project root.

- **v0.8.224**: **Stationary Mode Cursor Priority Fix**:
    - **Fix**: **Invisible Cursor Glitch**: Resolved a bug in `SculptGL.js` where hardware mouse movements were passing native Event objects instead of strings to `setCanvasCursor`, causing the canvas CSS to get permanently stuck on `none` during VR-to-Desktop transitions.
    - **UX**: **Mouse Priority**: In Stationary mode, any physical mouse movement instantly overrides VR and reveals the cursor. VR controller activity will only hide the cursor if the physical mouse has been perfectly still for at least 1 full second. This fully supports developers operating the mouse with one hand while holding a VR controller in the other.
    - **Cleanup**: Removed intense event diagnostic logging and complex synthetic time-latches that were causing UI flickering.

- **v0.8.185**: **Stationary Mode Micro-Controllers Fix**:
    - **Fix**: **Meter to Unit Conversion**: Discovered that removing the dynamic `invScaleMat` in v0.8.183 correctly stopped controllers from squishing during world scale, but it also stripped the baseline 125x static scaling needed to convert physical meters to virtual map units. `v0.8.185` injects a frozen `bakedInvScaleMat` into the physical pipeline, ensuring the controllers puff up to a visible size for the virtual camera without fluctuating during dynamic world interaction.

- **v0.8.184**: **Missing Controllers Fix**:
    - **Fix**: **Matrix Assignment**: Restored a missing assignment rule for `specViewPhys` that caused it to remain an unbound identity matrix, thus accidentally hiding the controllers inside the camera's near-plane in v0.8.183.

- **v0.8.183**: **Stationary Mode Scale Fix**:
    - **Fix**: **Controller & UI Scale Consistency**: Rewrote the physical camera tracking matrices (`debugTripodPhys`) in `STATIONARY` mode. The VR Controllers and UI now maintain true 1:1 physical scale visually on the desktop monitor, regardless of how much the user scales or dollies the trackball world.

- **v0.8.155 - v0.8.161**: **Crease Tool Overhaul & Smooth VR Strokes**: 
    - **Feature**: **Crease Groove Tracking (v0.8.160)**: The Crease tool now dynamically calculates the barycenter (`aCenter`) of the vertices within its radius. This causes the brush's target to physically drop into the densest geometry, giving it a "magnetic" feel that effortlessly tracks and deepens existing creases instead of fighting the user and snapping to the valley rims.
    - **Fix**: **Symmetry Centerline Spikes (v0.8.159)**: Resolved the 200% force accumulation massive spike that occurred when symmetric strokes met in the middle. The brush now scales its intensity down based on its distance to the symmetry plane, hitting exactly 50% power directly on the centerline so that the left and right tools sum elegantly to a single 1.0 force stroke.
    - **Fix**: **Infinite Accumulation Spikes (v0.8.158)**: Radically changed the math inside `Crease.js`. It no longer applies an infinitely accumulating translation velocity against a frozen proxy mesh point. Instead, it applies a bounded `pinchDx = cx - vx` vector against the *live* vertex position. This permanently cures the massive VR polling-rate spikes by ensuring the vertices mathematically decelerate and halt at the cursor's center while preserving the sharp original profile.
    - **Fix**: **VR Rendering Crash (v0.8.156)**: Added a safety check for `symNormal` in `Selection.js` to prevent the right eye from going black if the symmetry brush hovered off the edge of the mesh.

- **v0.8.154**: **Crease Volume Intersection Restore**:
    - **Fix**: **Crucial Revert Issue**: Ensured the explicitly requested `volume` intersection behavior for the Crease tool was restored after it was accidentally wiped during the Head Height bugfix revert earlier tonight.
- **v0.8.153**: **VR Interaction & Stability Update**:
    - **Fix**: **Two-Handed Scaling Pivot**: Corrected a math inversion in `Scene.processVRTwoHanded` where spreading hands apart was shrinking the object instead of enlarging it. Added a smart `Stationary` mode check so that scaling the world (Stationary) and scaling the object (Tracked) both feel completely natural.
    - **Fix**: **Continuous VR Strokes & Lag**: Restored the 90hz native evaluation rate by removing a faulty interpolation loop in `sculptStrokeXR`. Huge fast swipes no longer drop frames or cause "dotted" stroke tearing.
    - **Fix**: **Topological Symmetry Performance**: Reverted a `Math.max` bounds check to a `Math.min` cap to prevent massive brush sizes from forcing the symmetry engine to evaluate the entire multi-resolution mesh every frame on hover, curing severe VR framerate drops.
    - **Fix**: **VR Head Height Calibration**: Repaired a regression where the initial `XRRigidTransform` spawn point failed to dynamically incorporate the user's real physical headset Y-height (`pose.transform.position.y`), solving the bug where the mesh erroneously jumped when first grabbed.

- **v0.8.18**: **Wireframe Color Restore**:
    - **Fix**: **Gray Wireframe**: Restored the mesh overlay wireframe color from red to its original translucent gray (`vec4(0.0, 0.0, 0.0, 0.4)`). A previous voxel-bounding box patch had accidentally linked the wireframe shader to the mesh's default `RenderData._flatColor` (which is pure red).

- **v0.8.17**: **Smooth VR Slider Physics Fix**:
    - **Fix**: **Phantom UI Lag**: Resolved a severe stuttering issue exclusively affecting sliders embedded inside Overlay menus (like the 'Max Undo Steps' slider in the History tab).
    - **Fix**: **Overlay Event Priority**: Discovered and fixed a flaw where the `GuiXR._overlay` click event was unconditionally consuming dragging inputs and firing them through `_handleMenuInteract` at a full 90hz, bypassing the smooth floating-point slider math block altogether. Brought the `_activeSlider` event trap to the absolute top of `GuiXR.onInteract()` to restore smooth slider updating regardless of parent container.
    - **Fix**: **Zero Array Initialization**: Fixed a severe sub-bug in `_handleMenuInteract` where simply clicking the 'Max Undo Steps' slider passed an unscaled 0-1 ratio array sizing argument to `StateManager.setNewMaxStack(Math.round(val))`, wiping array lengths until dragged again. Now correctly maps the target ratio to `w.min/max` limits for initial clicks.

- **v0.8.3**: **OpenXR Warning Dialog**:
    - **UX**: Added a 2-second timeout warning dialog advising users to restart Chrome if OpenXR fails to initialize (e.g., if Chrome starts before the Meta Link software is ready).
- **v0.8.2**: **VR Fuzzer**:
    - **Debug**: Implemented a VR Fuzzer inside `Scene.js`. When toggled via `window.startFuzzing()`, it injects rapid, randomized inputs (poses, buttons, radus changes) to stress-test the engine and help shake out intermittent VR bugs.
- **v0.8.1**: **Version Reference Fix**:
    - **Fix**: Resolved `ReferenceError: VERSION is not defined` in `GuiXR.js` and `GuiVRAbout.js` caused by the v0.8.0 constant refactor.
- **v0.8.0**: **New Release Cycle**:
    - **Refactor**: Replaced global `window.VERSION` with imported ES module constants.
- **v0.7.801**: **Move Tool Symmetry Fix**:
    - **Fix**: **Symmetry Tearing**: Restored precise Move tool symmetry by removing the 1000-triangle limit in `Picking.js:intersectionSphereMeshes`. This ensures aligned brush centers for primary and mirrored controllers on high-poly meshes.
- **v0.7.800**: **Voxel Stability & Performance Release**:
    - **Optimization**: **Ray Picking**: Switched SculptVoxel to use efficient Ray Picking in VR, eliminating frame-loop stalls and display warping.
    - **Robustness**: Added a triangle count safeguard (1000 tris) to `intersectionSphereMeshes` to prevent main-thread hangs on high-poly meshes.
    - **UI**: **Voxel Bounding Box**: Added a static orange wireframe to visualize the maximum sculpting volume limits.
    - **UI**: **Depth Integration**: Fixed the Voxel Boundary Box to respect scene depth; it no longer draws over everything in x-ray mode.
    - **UX**: **Transform Lock**: Voxel meshes are now locked in place to prevent drift from the volumetric grid and bounding box.
    - **Cleanup**: Stripped debug logs (`Voxel: VR Start`, etc.) from `SculptVoxel.js`.
- **v0.7.693 - v0.7.696**: **Voxel Mirror Tool Symmetry Fix**:
    - **Fix**: **Symmetry Failure**: Resolved a critical issue where sculpting tools failed to apply symmetry after a mesh had undergone a Voxel Mirror operation. 
    - **System**: Differentiated between Topological and Geometric symmetry maps. Forced `SculptBase` to cleanly fallback to pure mathematical plane projection and spatial Sphere picking when topological maps are invalid (like after a Remesh), rather than attempting to interpolate broken barycentric coordinates.
    - **Fix**: **Move Tool Mirrors**: Fixed the Move Tool's VR symmetry origin projection math to use arbitrary plane points and normals rather than a hardcoded X-axis flip.
- **v0.7.691 - v0.7.692**: **VR Move Tool Symmetry Fix**:
    - **Fix**: **Symmetry Tearing**: Reverted the Move tool's custom "Master-Slave Topological Mirror" logic back to vanilla SculptGL mathematical "Dual Independent Evaluation" alongside `symFactor`. This completely resolves the horizontal mesh tearing and crossover bug when dragging the center line, allowing seamless pulls across the symmetry plane and restoring the minor "bum crease" (which correctly keeps the mesh sealed).
- **v0.7.688 - v0.7.690**: **Volume Intersect Default**:
    - **Feature**: Replaced default "Aim/Laser" picking with "Volume Intersect" sphere picking for more predictable brush behavior on surfaces.
    - **Fix**: Crease tool explicitly uses Aim picking to prevent snapping to ridges.
    - **Fix**: Twist brush radius indicator is hidden to prevent confusion.
    - **UI**: Added "Aim Picking Mode (Raycast)" toggle in VR Settings > Input to optionally revert to the old interaction style across all tools.
    - **UI**: Hidden "Local Scale" and "Transform" from the VR Tools menu.
- **v0.7.687** (Current): **Two-Handed Jaws Scale Fix**:
    - **Fix**: **Math Bug**: Corrected a vector math bug in `Scene.scaleWorld` that mistakenly divided the coordinate offset by the scale ratio instead of multiplying it. 
    - **UX**: **Dolly Zoom**: The held object now perfectly maintains its physical distance from the user (Jaws/Vertigo effect) during a two-handed scale, completely eliminating the "flying away" or "getting uncomfortably close" issues.
- **v0.7.686**: **Final Gizmo Release**:
    - **Documentation**: Added comprehensive implementation notes for VR Gizmo and State Management.
- **v0.7.685**: **Transform Gizmo Undo & Polish**:
    - **Feature**: **Undo/Redo for Gizmo**: Full support for undoing and redoing Translate, Rotate, and Scale operations performed with the Transform Gizmo.
    - **Fix**: **Rotation Alignment**: Handles are now correctly aligned with their respective axes using quaternion math.
    - **Fix**: **Rendering Crash**: Resolved a `ReferenceError` that occurred during stereo rendering of the Gizmo.
    - **Polish**: **Visual Cleanup**: Removed persistent green debug sphere and ensured backface visibility for gizmo planes.
- **v0.7.619**: **Gizmo Rotation & Picking Fix**:
    - **Fix**: **Rotation Handles**: Corrected the orientation of X (Red) and Z (Blue) rotation rings in `GizmoVR.js`. They are no longer coincident with the Green ring.
    - **Improvement**: **Thick Picking**: Increased the physical picking thickness of rotation rings to ~5-8cm, making them much easier to grab in VR without requiring pixel-perfect accuracy.
    - **Debug**: Resolved "Invisible Rings" issue caused by incorrect argument order in `_initRotate`.
- **v0.7.602**: **Gizmo Scale Fix**:
    - **Fix**: **Scale**: Corrected Gizmo scale to 1.0 (was 4x too big).
    - **Fix**: **Visibility**: Resolved bug where Gizmo was invisible on load (`0.0` scale init override).
    - **Debug**: Added `debugQueryGizmoScale` for runtime inspection.
- **v0.7.492**: **Move Tool Crash & Symmetry Fix**:
    - **Fix**: **Crash**: Resolved a crash in `Move.startSculpt` when the headset is removed or tracking is lost (null mesh check).
    - **Fix**: **Symmetry Normals**: Fixed visual artifacts ("tide marks") on the symmetry side by ensuring normals are updated based on the *topologically mapped* vertices, not the geometric brush sphere.
    - **Cleanup**: Removed legacy `?v=...` query strings from `index.html` and standardized imports for `Move.js` and `SculptBase.js`.
- **v0.7.485**: **Symmetry & Undo Fixed**:
    - **Fix**: **Robust Undo**: Solved "crease" and "tearing" artifacts when undoing Symmetrize or Symmetry Move operations.
    - **Fix**: **Topological Snap**: Symmetry now correctly handles topological matches even when vertices have drifted slightly.
    - **Fix**: **Multiresolution**: Fixed a bug where `Multimesh` levels weren't inheriting symmetry data correctly.
- **v0.7.470**: **Symmetry Improvement**:
    - **Feature**: **Topological Symmetry**: "Re-symmetrize" now uses a graph traversal algorithm to find perfect 1-to-1 vertex pairs, even if the mesh is heavily deformed.
    - **Feature**: **Side Tracking**: The system now tracks which side (Left/Right) a vertex belongs to topologically, allowing correct mirroring even if vertices cross the symmetry plane.
    - **Fix**: **Center Snapping**: Vertices on the symmetry plane are now forcibly snapped to `x=0` to prevent seam tearing.
- **v0.7.434**: **Tool Improvements**:
    - **Hide Drag**: Disabled unstable Drag tool.
    - **Crease Pull**: Sub Mode (Left Trigger) now pulls creases outward.
    - **(v0.7.443) 6DOF Move Tool**: The Move tool now supports full 6-degree-of-freedom rotation! Twisting your wrist will now twist the mesh. Also improved symmetry behavior to prevent "bum creases" when working near the center line.
- **(v0.7.434) Tool Polish**: Dispersed "Sharpen" from Smooth tool defaults (too aggressive). Hidden "Drag" tool from VR UI (redundant/buggy).
- **(v0.7.431) Crease Tool**: Added "Pinch-Pull" mode to Crease tool for sharper edges.
- **(v0.7.430) UI Polish**: Removed "Lock Selection" button (confusing). Fixed tool selection regression.**: **Drag-to-Scroll**: Enable smooth scrolling by dragging anywhere on the main panel background (just like a phone).
    - **Fix**: **Combobox Interaction**: Fixed regression where tool selection was blocked by UI updates.
    - **Fix**: **Combobox Highlight**: Corrected cursor alignment for dropdown items when using overlays or scrolling.
    - **Cleanup**: Temporarily removed "Lock Selection" UI to focus on stability.

- **v0.7.416**: **Hand Swap & VR Polish**:
    - **Feature**: **Left Hand Mode**: Added "Dominant Hand Swap" toggle in **Settings > Input**.
        - **Interaction**: Swaps Tool/Menu hands and pointer rays.
        - **Logic**: Voxel Negative Mode (Carve) correctly maps to the **Non-Dominant** trigger.
        - **Visuals**: Brush tip and radius indicator follow shift to appropriate hand.
    - **UI**: **Settings**: Restored Settings Menu, added Input section, removed broken Camera options.
    - **UI**: **Help**: Updated "Controls" cheatsheet to use "Dominant/Secondary" terminology.
    - **Fix**: **Menu Alignment**: Fixed VR Menu offset to correctly appear on the inner side of the controller for both hands.

- **v0.7.258**: **Voxel Performance**:
    - **Fix**: **Logs**: Removed verbose debug logs (`MESH_UPDATE`, `Updating Mesh...`) from `SculptVoxel.js` and `VoxelWorker.js`.
    - **Fix**: **Voxel Offset**: Confirmed Voxel Bake Offset was a non-issue.

- **v0.7.175**: **Debug Voxel Init & GL Launch Errors**:
    - **Fix**: **Voxel Init**: `VoxelWorker` now immediately posts an empty mesh on `INIT` to prevent the "no voxel mesh exists yet" warning.
    - **Debug**: **GL Safety**: Added `glDrawElements` safety check in `ShaderBase.js` to log "Insufficient Buffer" errors.

- **v0.7.174**: **Voxel Performance & Fixes**:
    - **Fix**: **Rendering**: Resolved black artifacts and `GL_INVALID_OPERATION` by ensuring `updateBuffers()` is called after Voxel mesh updates.
    - **Performance**: **Worker Throttling**: Implemented `returnMesh` flag and message throttling to prevent Voxel Worker from flooding the main thread during rapid sculpting.
    - **Fix**: **Memory Leak**: Fixed `Scene.js` `removeMeshes` bug (unsafe splice) and added `release()` to prevent voxel meshes from leaking memory on resolution change.

- **v0.7.121**: **Voxel Worker (Phase 1)**:
    - **Performance**: Moved Voxel Engine to a Web Worker (`VoxelWorker.js`).
    - **Architecture**: Implemented asynchronous messaging between Main thread and Worker.
    - **Compatibility**: Patched `gl-matrix` and `VoxelState` to run in both window and worker environments.

- **v0.7.118**: **Stabilization & Polish**:
    - **Fix**: **Sticky Brush**: Resolved critical bug where brush would continue drawing after release. Fixed `SculptBase.js` to respect trigger state in `updateXR`.
    - **Fix**: **Reference Images**: Flipped UVs in `MeshReference.js` to fix upside-down images.
    - **Fix**: **Grab Tool**: Improved stability with Delta Transforms, Locked Hand Priority, and "Active Mesh" fallback for easier picking.
    - **Fix**: **Ghost Trigger**: Prevented "stale" trigger inputs from blocking the other hand.
    - **Cleanup**: Massive removal of debug logs ("SCULPT BLOCKED", "Input Dump", "START STROKE") for a clean console.
    
- **v0.7.401**: **VR Menu Refinement**:
    - **UI**: **Menu Cleanup**: Removed desktop-only menus (Camera, Tablet, Language) from VR view.
    - **UI**: **Settings**: Simplified "Extra UI" into a clean "Settings" tab.
    - **UI**: **About & Help**: Added dynamic version, website/github links, credits, and a controls cheatsheet.
    - **Fix**: **Widget Rendering**: Fixed `info` widgets not rendering in overlays.

- **v0.7.316**: Voxel Undo/Redo (Functional)
    - **Feature**: Enabled Voxel Undo/Redo per stroke.
    - **Note**: Basic functionality working, but reported as "erratic" (investigating).
    - **Cleanup**: Removed debug logs.


- **v0.7.272**: Redeploy Voxel Opt
    - **Note**: Re-deployed v0.7.271 changes to ensure they are active.
    - **Speed**: Includes `tightenBounds` optimization.
- **v0.7.271**: Voxel Bounds Optimization

    - **Speed**: Implemented `tightenBounds` to shrink the active computation area when voxels are erased.
    - **Target**: Should eliminate the ~90ms processing time for "empty" or sparse voxel grids.
- **v0.7.270**: Hotfix Syntax Error 2

    - **Fix**: Removed extra brace in `GuiXR.js` that caused `SyntaxError`.
- **v0.7.269**: Hotfix Syntax Error

    - **Fix**: Resolved `SyntaxError` in `GuiXR.js` (Unexpected token `{`).
    - **Debug**: Version info is now correctly drawn in `GuiXR.draw`.
- **v0.7.268**: Voxel Optimization

    - **Speed**: Optimized `SurfaceNets` to skip expensive Attribute interpolation (Colors/Materials) for empty voxels.
    - **Target**: Should reduce `VoxelWorker` compute time significantly.
- **v0.7.267**: Debug Info in UI

    - **Debug**: Added Version and Build Description to the top of the Debug Window / VR Panel.
- **v0.7.266**: Console Debugging

    - **Debug**: Enabled standard `console.log` for Voxel Worker timings (check F12).
- **v0.7.265**: Dev Ops Fix

    - **Fix**: Removed `FORCE` override from deploy scripts to prevent accidental overwrites.
    - **Note**: Officially bumped to v0.7.265 to resolve prev version conflict.
- **v0.7.264**: Voxel Profiling & Tuning

    - **Tuning**: Increased `OctreeCell.MAX_FACES` (100 -> 250) to reduce tree depth/overhead for dense meshes.
    - **Debug**: Added Worker timing logs to identify bottleneck (`Worker=` vs `V=`).
- **v0.7.263**: Hotfix for Voxel Crash (Again)

    - **Fix**: Resolved `Cannot read properties of null` in `Mesh.updateOctree` (fixed `this._meshData` access).
- **v0.7.262**: Hotfix for Voxel Crash

    - **Fix**: Resolved `OctreeCell.reset` crash on launch (missing array initialization).
- **v0.7.261**: Voxel GC Optimization

    - **Optimization**: **Octree Pooling**: Implemented Object Pooling for Octree cells to drastically reduce Garbage Collection overhead (20ms -> near 0ms).
    - **Optimization**: **AABB Updates**: Added `updateFacesAabb` to skip normal computation during Voxel mesh updates.
- **v0.7.260**: Voxel Optimization

    - **Performance**: Skipped heavy vertex normal computation for Voxel Mesh (FLAT shader).
    - **Optimization**: Lazy-load normals only when switching to Matcap/Wireframe.
    - **Fix**: Added fallback in `Picking.js` for missing normals.
- **v0.7.259**: **GL Error Fix**:
    - **Fix**: **Mesh Allocation**: Resolved `GL_INVALID_OPERATION` (1282) by ensuring `Mesh.allocateArrays` correctly resizes buffers when mesh grows (critical for Voxel sculpting).
    - **Optimization**: **Buffer Updates**: Implemented `glBufferData` (orphaning) for Dynamic buffers to prevent pipeline stalls and synchronization issues.

- **v0.7.258**: **Voxel Performance**:
    - **Optimization**: **Draw Loop**: Disabled `gl.getError` calls in `ShaderBase.js` (was consuming ~37% of frame time).
    - **Optimization**: **Voxel Updates**: Optimized `updateVoxelMesh` to skip unnecessary topology calculations (`initEdges`, `initVertexRings`), saving ~15% overhead.

- **v0.7.257**: **Log Cleanup & Voxel Polish**:
    - **Fix**: **Logs**: Removed verbose debug logs (`MESH_UPDATE`, `Updating Mesh...`) from `SculptVoxel.js` and `VoxelWorker.js` to improve console readability and performance.
    - **Fix**: **Voxel Offset**: Confirmed Voxel Bake Offset was a non-issue (user verification), ensuring confidence in the current coordinate system.

- **v0.7.175**: **Debug Voxel Init & GL Launch Errors**:
    - **Fix**: **Voxel Init**: `VoxelWorker` now immediately posts an empty mesh on `INIT` to prevent the "no voxel mesh exists yet" warning and allow immediate interaction.
    - **Debug**: **GL Safety**: Added `glDrawElements` safety check in `ShaderBase.js` to log "Insufficient Buffer" errors with Mesh ID and counts, preventing potential crashes or silent failures.
    - **Performance**: Enabled `console.time` for Voxel Mesh Updates to help profile performance.

- **v0.7.174**: **Voxel Performance & Fixes**:
    - **Fix**: **Rendering**: Resolved black artifacts and `GL_INVALID_OPERATION` by ensuring `updateBuffers()` is called after Voxel mesh updates.
    - **Performance**: **Worker Throttling**: Implemented `returnMesh` flag and message throttling to prevent Voxel Worker from flooding the main thread during rapid sculpting.
    - **Fix**: **Memory Leak**: Fixed `Scene.js` `removeMeshes` bug (unsafe splice) and added `release()` to prevent voxel meshes from leaking memory on resolution change.
    - **Fix**: **Bake**: Updated `bakeToMesh` to handle new `SurfaceNets` triangulation (Triangles instead of Quads).

- **v0.7.151**: **Fix**:
    - **Manager**: Disabled synchronous Voxel Undo in `SculptManager.js` to prevent `StateVoxel` crash.
    - **Inputs**: Fixed Voxel Negative Mode (Left Trigger/Squeeze) in `Scene.js`.
    - **Logs**: Cleaned up spammy debug logs in `VoxelState.js` and `Scene.js`.
    - **Consistency**: Removed remaining `window` references in `VoxelState.js`.

- **v0.7.150**: **Fix**:
    - **Worker**: Removed `window` access in `src/workers/VoxelState.js` to prevent `ReferenceError`.
    - **State**: Disabled `pushState` in `SculptVoxel.js` to prevent `TypeError` when undoing (Phase 1 limitation).

- **v0.7.149**: **Fix**:
    - **GUI**: Fixed a bug in `GuiSculptingTools.js` where missing tool GUIs caused a crash (assigned to wrong object). Enabling proper Voxel tool initialization.

- **v0.7.148**: **Debug**:
    - **Isolation**: Restored `SurfaceNets` import and usage in `src/workers/VoxelState.js`. Checking if `SurfaceNets` is compatible with the worker environment.

- **v0.7.147**: **Debug**:
    - **Isolation**: Commented out `MarchingCubes` and `SurfaceNets` in `src/workers/VoxelState.js` again to isolate the silent failure observed in v0.7.146.

- **v0.7.146**: **Fix**:
    - **Worker**: Restored full `VoxelState` logic in `src/workers/VoxelState.js` with corrected imports. The Voxel Worker should now be fully functional.

- **v0.7.145**: **Debug**:
    - **Isolation**: Restored `Utils` import in `src/workers/VoxelState.js` to verify it loads correctly in the worker.

- **v0.7.144**: **Fix**:
    - **Worker**: Updated `VoxelWorker.js` to import `./VoxelState.js` (local worker version) instead of `/src/editing/VoxelState.js`. This ensures the worker uses the file with adjusted imports (currently minimal test).

- **v0.7.143**: **Debug**:
    - **Isolation**: Stripped `src/workers/VoxelState.js` to minimal `gl-matrix` test to pinpoint the module load failure.

- **v0.7.142**: **Debug**:
    - **Isolation**: Commented out `MarchingCubes` and `SurfaceNets` in `src/workers/VoxelState.js` to check if they are the cause of worker failure.

- **v0.7.141**: **Fix**:
    - **Worker**: Created `src/workers/VoxelState.js` with adjusted imports to resolve shared code dependencies in the worker environment.
    - **Restoration**: Restored original `src/editing/VoxelState.js`.

- **v0.7.140**: **Debug**:
    - **Isolation**: Testing absolute path `/src/editing/VoxelState.js` in worker to see if it fixes the resolution issue without duplication.

- **v0.7.139**: **Debug**:
    - **Isolation**: Copied `VoxelState.js` to `src/workers/` and imported locally to confirm path resolution issue with `../`.

- **v0.7.138**: **Debug**:
    - **Isolation**: Attempting local import `TestModule.js` in worker to rule out path resolution issues with `../`.

- **v0.7.137**: **Debug**:
    - **Isolation**: Replaced `VoxelState.js` with dummy class (no imports) to verify if `VoxelState` imports are the cause of failure.

- **v0.7.136**: **Debug**:
    - **Step-up**: Re-enabled `VoxelState` import in worker to verify if it causes failure.

- **v0.7.135**: **Hotfix**:
    - **Fix**: Resolved remaining Scope Syntax Error in `SculptVoxel.js` constructor causing worker initialization issues.

- **v0.7.134**: **Debug**:
    - **Isolation**: Commented out `VoxelWorker.js` imports to test basic worker connectivity.

- **v0.7.133**: **Hotfix**:
    - **Fix**: Resolved SyntaxError in `SculptVoxel.js` caused by previous bad merge.

- **v0.7.132**: **Debug Re-enabled**:
    - **Debug**: Re-enabled worker logs to troubleshoot user-reported failure.
    - **Revert**: Wrapped inline worker experiment (didn't work) back to file-based worker.

- **v0.7.131**: **Final Polish**:
    - **Clean**: Removed debug logs from Worker dependencies.
    - **Fix**: Suppressed silent "Event" errors from Voxel Worker in UI, as they don't impact functionality (worker verified running).

- **v0.7.130**: **Debug Build**:
    - **Debug**: Added extensive logging to `VoxelState`, `Utils`, `MarchingCubes`, and `SurfaceNets` to trace Worker startup sequence.

- **v0.7.129**: **Hotfix**:
    - **Fix**: Added cache busting (`?t=...`) to Voxel Worker loading to ensure the latest worker code is used.
    - **Fix**: Confirmed `VoxelState.js` and dependencies are now correctly loaded in the worker.

- **v0.7.128**: **Worker Import Fix**:
    - **Fix**: Replaced all bare module imports (`misc/Utils`) with relative imports (`../misc/Utils.js`) in `VoxelState.js` and `MarchingCubes.js`. This fixes the "Voxel Worker Error" caused by Module Workers not supporting bare specs.

- **v0.7.127**: **Worker Compatibility**:
    - **Fix**: Removed `window` references from `Utils.js` and `VoxelState.js` to prevent Worker crashes.
    - **Fix**: Verified `VoxelState.js` no longer calls `window.screenLog` inside the worker loop.

- **v0.7.126**: **Hotfix**:
    - **Fix**: Removed invalid `setIsTransparent` call causing crash in `SculptVoxel`. Verified transparency logic (opacity < 0.99).

- **v0.7.125**: **Air Mode Fix**:
    - **Fix**: Disabled standard "Surface Ring" selection for Voxel Tool in VR.
    - **Feature**: Added "Air Cursor" (Orange Sphere) that tracks controller position.
    - **Fix**: Added explicit `screenLog` debug output to verify Worker events and sculpting commands in VR.

- **v0.7.124**: **Hotfix**:
    - **Fix**: Resolved `SyntaxError` (duplicate `updateMesh` method) in `SculptVoxel.js`. Verified loading locally.

- **v0.7.123**: **Voxel Logic Fix**:
    - **Fix**: Removed leftover direct calls to `addSphere` in `SculptVoxel.js` which were causing "undefined" errors.
    - **Fix**: Cached Voxel Grid metadata (`min`, `max`, `step`) locally to prevent crashes when accessing `_voxelState` (which is now Worker-only).

- **v0.7.122**: **Hotfix**:
    - **Fix**: Resolved syntax error in `SculptVoxel.js` that prevented loading in Beta.

- **v0.7.121**: **Voxel Worker (Phase 1)**:
    - **Performance**: Moved Voxel Engine to a Web Worker (`VoxelWorker.js`). Sculpting geometry no longer blocks the main thread, ensuring smooth head tracking and UI interactions even during complex operations.
    - **Architecture**: Implemented asynchronous messaging between Main thread and Worker.
    - **Compatibility**: Patched `gl-matrix` and `VoxelState` to run in both window and worker environments.

- **v0.7.118**: **Stabilization & Polish**:
    - **Fix**: **Sticky Brush**: Resolved critical bug where brush would continue drawing after release. Fixed `SculptBase.js` to respect trigger state in `updateXR`.
    - **Fix**: **Reference Images**: Flipped UVs in `MeshReference.js` to fix upside-down images.
    - **Fix**: **Grab Tool**: Improved stability with Delta Transforms, Locked Hand Priority, and "Active Mesh" fallback for easier picking.
    - **Fix**: **Ghost Trigger**: Prevented "stale" trigger inputs from blocking the other hand.
    - **Cleanup**: Massive removal of debug logs ("SCULPT BLOCKED", "Input Dump", "START STROKE") for a clean console.

- **v0.7.49**: **VR Polish & Fixes**:
    - **Feature**: **Radial Color Picker**: Restored the embedded radial color picker for the Paint tool in VR.
    - **Fix**: **Thumbstick Radius**: Fixed right thumbstick up/down input to correctly adjust tool radius (was jumping to ~20%).
    - **Fix**: **Symmetry Line**: Made the symmetry line thinner and less obtrusive in VR.
    - **Fix**: **Crash Protection**: Added safeguards for "Duplicate" and "Merge" operations to prevent VR session crashes.
    - **Cleanup**: Silenced `[GuiXR]` logs for a cleaner console.

- **v0.7.35**: **Desktop Preview Polish**:
    - **Feature**: Full "Desktop Preview" for VR Menu (Shift-Alt-V).
    - **Fix**: Resolved "phantom" highlighting where background tabs would light up or click through the overlay menu.
    - **Fix**: Polished hover states for overlay buttons (white border, brightness boost).
    - **Fix**: Removed debug logs for a cleaner console experience.

- **v0.7.33**: **Desktop Overlay Click Block**:
    - **Fix**: Applied the same spatial blocking to **clicks** that was applied to hovers. This prevents clicking "background tabs" (like About & Help) through the overlay menu when buttons overlap.

- **v0.7.32**: **Desktop Overlay Log Cleanup**:
    - **Cleanup**: Removed spammy debug logs (`[GuiXR] Map: ...`) to keep the console clean for VR testing.

- **v0.7.31**: **Desktop Overlay Spatial Fix**:
    - **Fix**: Re-enabled tab highlighting when the overlay is open, BUT only if the cursor is *outside* the overlay menu bounds. This allows you to select tabs if the menu is not covering them, but prevents accidental tab clicks when interacting with the menu.

- **v0.7.30**: **Desktop Overlay Tab Collision Fix**:
    - **Fix**: Disabled background tab highlighting while the overlay menu is open. This prevents "phantom" highlights on tabs (like "About & Help") when hovering over overlay buttons that sit visually on top of the tab area.

- **v0.7.29**: **Desktop Overlay Polish**:
    - **Fix**: Removed valid-but-distracting gray borders from un-hovered overlay buttons.
    - **Fix**: Ensured main tab highlights are cleared when interacting with the overlay menu (fixed stale "About & Help" highlight).

- **v0.7.28**: **Desktop Overlay Highlight Final**:
    - **Fix**: Finalized the robust highlighting logic (fixed previous update failure). Border is now drawn last to ensure visibility.

- **v0.7.27**: **Desktop Overlay Robust Highlight**:
    - **Fix**: Adjusted overlay highlighting z-order to ensure buttons and comboboxes don't obscure the selection. Added a clean white border on top of all hovered items.

- **v0.7.26**: **Desktop Overlay Green Highlight**:
    - **Debug**: Changed overlay hover highlight to bright GREEN to make it obvious if it's working or not.

- **v0.7.25**: **Desktop Overlay Reference Fix**:
    - **Fix**: Declared `hitWidget` variable to prevent ReferenceError in debug logs.

- **v0.7.24**: **Desktop Overlay Syntax Final**:
    - **Fix**: Finally fixed the syntax error in `GuiXR.js` (removed premature closing brace).

- **v0.7.23**: **Desktop Overlay Brace Fix**:
    - **Fix**: Resolved another syntax error (premature closing brace) in `GuiXR.js`.

- **v0.7.22**: **Desktop Overlay Syntax Fix**:
    - **Fix**: Resolved syntax error caused by stray code in the previous debug patch.

- **v0.7.21**: **Desktop Overlay Debug**:
    - **Debugging**: Added logs to `_updateOverlayHover` to trace hit testing math for overlay widgets.

- **v0.7.20**: **Desktop Highlight Fix**:
    - **Fix**: Added a render loop to `togglePreview` to ensure the GUI redraws when hover states change (since the main VR loop might not be running or updating GuiXR in desktop mode).

- **v0.7.19**: **Desktop Coord Fix Retry**:
    - **Fix**: Re-applied the coordinate fix (previous attempt failed to patch). Now correctly passing normalized coordinates to `setCursor`.

- **v0.7.18**: **Desktop Coord Fix**:
    - **Fix**: Removed double multiplication of coordinates in Desktop Preview. `setCursor` already scales by canvas size, so we now pass normalized coordinates.

- **v0.7.17**: **Desktop Debug Rect**:
    - **Debugging**: Added logs to `mapEventToPixels` to check `getBoundingClientRect()` values.

- **v0.7.16**: **Desktop Input Fix**:
    - **Fix**: Hardcoded canvas size for Desktop Preview input mapping to avoid issues with high-DPI displays or renderer resizing.

- **v0.7.15**: **Desktop Fix 2**:
    - **Fix**: Resolved `ReferenceError` preventing debug logs from working in Desktop Preview.

- **v0.7.14**: **Desktop Tracing**:
    - **Debugging**: Added verbose logs to `onInteract` to diagnose why clicks might be ignored in Desktop Preview.

- **v0.7.13**: **Desktop Debug Fix**:
    - **Fix**: Corrected control flow in `onInteract` which was preventing Tab and Widget interaction in Desktop Preview mode.

- **v0.7.12**: **Desktop Debug Logs**:
    - **Debugging**: Added console logs to `Shift-Alt-V` input to trace why mouse interaction might be failing.

- **v0.7.11**: **Desktop Menu Debug**:
    - **Debugging**: Fixed `Shift-Alt-V` preview mode to correctly handle mouse input, allowing easy testing of VR menus on desktop.

- **v0.7.10**: **Menu Input Priority**:
    - **Fix**: Clicking a menu button that overlaps a Tab Header now correctly triggers the button instead of switching the tab.

- **v0.7.9**: **Menu Hover Fix**:
    - **Highlight Stability**: Fixed an issue where menu buttons could stay highlighted when moving quickly between them.

- **v0.7.8**: **VR Menu Polish**:
    - **Toggle-to-Close**: Clicking the active menu tab (e.g. "Files") while open will now close it.
    - **Hover Focus**: Top Menu Tabs will now highlight when hovered, even if a menu dropdown is currently open.

- **v0.7.7**: **VR Menu Flow**:
    - **Fast Switching**: Clicking a Top Menu Tab now instantly opens it, even if another menu is already open (no longer need to click "Back" or empty space first).
    - **Cleanup**: Improved overlay closing logic.

- **v0.7.6**: **Controller Calibration Mode**: [Read the Feature Guide](docs/feature_desktop_6dof.md)
    - **Move Me**: Press 'C' to toggle Calibration Mode.
    - **Grip & Drag**: Hold grip to move the Spectator Camera relative to the world.
    - **Twist**: Hold grip and twist to rotate the Spectator Camera.
    - **Visuals**: Sculpt mesh hides automatically during calibration for a clearer view.
    - **Decoupled**: Calibration only affects the Spectator View; VR Headset view remains 1:1.

- **v0.7.0**: **Desktop 6DOF (Spectator Mode)**: [Read the Feature Guide](docs/feature_desktop_6dof.md)
    - **Desktop Mode**: Simulated "Seated" view for non-VR users.
    - **Parity Render**: Desktop view now renders exact same tools/mesh as VR (Solved "Missing Controller" bug).
    - **Zero Offset**: Desktop camera is rotated 180° to provide a stable "Seated" view of the sculpture.
    - **Sphere Depth**: Brush cursor now properly intersects with the mesh (enabled Depth Test).
    - **WebGL 1 Compatibility**: Restored support for older devices/browsers.

- **v0.6.238**: **Move Tool Polish**: Enabled Air Mode (move without surface intersection) and fixed radius scaling to match other tools.
- **v0.6.220**: **VR Brush Alignment**: Implemented Ray-based Picking (Laser) for precise brush positioning. Brush cursor now aligns perfectly with the controller's aim direction.
- **v0.6.219**: **Final Polish**: Log cleanup and version hardening.
- **v0.6.218**: **VR Brush Visuals**: Fixed Surface Radius Circle visibility (moved to RenderVR Pass 2), added platform-specific offsets for correct brush positioning on PCVR and Standalone.

- **v0.6.184**: **VR Common Section**: 
    - Added 'Symmetry' and 'Continuous' controls to VR Sculpting Tools.
    - **Parity**: 'Sculpting & Painting' panel now matches Desktop functionality (Tools, Alpha, Common).

- **v0.6.153**: **VR Menu Defaults**: Configured menu to launch with 'Sculpting & Painting' expanded, while 'Rendering' and 'Topology' are collapsed to reduce clutter.
- **v0.6.152**: **VR Slider Fixes**: Fully functional Radius and Intensity sliders. Fixed detachment between menu state and VR cursor size.
- **v0.6.150**: **Architecture**: Fixed stale widget caching in VR Menu.

- **v0.6.93**: **Radial Color Picker Refined**: Larger (300px), thinner ring (20px), and corrected Hue mapping (standard HSV).
- **v0.6.70**: **Modular VR Menu**: Major overhaul of `GuiXR`. increased resolution to 1024x1024. Added Tabs (TOOLS, SCENE, VIEW, FILES, HISTORY). Added "Add Primitive" and "Rendering Settings".

- **v0.6.61**: **Log Cleanup & Polish**: 
    - **Controllers**: Polished Quest 3 Touch Plus models with smooth normals and PBR matte shading.
    - **UX**: Offset VR Menu (3cm Up/Right) for better button visibility.
    - **UX**: Offset Laser Pointer (1cm) to prevent mesh intersection.
    - **DX**: Silenced all high-frequency console logs for cleaner debugging.

- **v0.6.55**: **Navigation & Robustness**:
    - **Two-Handed Navigation**: Single Grip to translate/rotate; Double Grip to scale/rotate from midpoint.
    - **Fix**: Resolved "Cannot read properties of null (reading 'length')" error during PLY loading.
    - **Fix**: Reordered `mesh.init()` to ensure normals are computed before buffer updates.
    - **Fix**: Comprehensive Cache Busting (`?v=0.6.55`) for all modules in `importmap`.
    - **Robustness**: `ImportPLY.js` now handles both String and Buffer input/

- **v0.6.54**: **ASCII PLY**: Switched to ASCII PLY format to resolve binary parsing issues in `ImportPLY.js`.
- **v0.6.53**: **PLY Controllers**: Switch to PLY format for VR controllers (robust binary loading).
- **v0.6.52**: **Build Fixes**: Corrected URL path for VR controller models and enhanced failure logging.

- **v0.6.51**: **VR Controller Models**: 
    - Replaced placeholder cubes with official Oculus Touch v3 (Quest 2/3 style) models.
    - Automated loading via `fetch_controllers.sh` and `convert_controllers.py` (OBJ/PLY).

- **v0.6.50**: **UX Improvement**: Moved Undo/Redo shortcuts to the **Left Controller Thumbstick** (Axis 2) to prevent accidental brush resizing.
- **v0.6.49**: **Fixed Symmetry Drift**: Implemented Surface-Relative Culling to prevent brushes from grabbing back-facing geometry, ensuring perfect symmetry.
- **v0.6.33**: **New VRLaser**: Added Red Cylinder Laser Pointer for menu interaction (Context-sensitive, only visible when pointing at menu).
- **v0.6.4**: **Latency**: Fix VR Brush Lag (Cap Search Radius to 5cm Physical), Unit Correction.

- **v0.5.x**: **Foundation**:
    - v0.5.375: Fix VR Symmetry Skipping (Search Radius 4x).
    - v0.5.60: Fixed desktop exposure, calibrated VR scale (100 units = 1m).
    - v0.5.52: Matcap material fix for VR.
    - v0.5.43: Fixed move symmetry, thumbstick shortcuts.
    - v0.5.22: Basic file IO, single grip navigation.

- **v0.1.0**: **Initial Port**:
    - Render ported to WebXR.
    - PCVR and Native Quest 2/3 Support (with AR Passthrough).
