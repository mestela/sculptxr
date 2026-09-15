# UI reachability audit — what is not in the main panel

Date: 2026-09-15. Code read at v3.40.4.

Every gap has a stable ID (A1, B3, …). Quote the ID when asking for one to be fixed;
the IDs do not get renumbered as items are closed — a closed item keeps its ID and is
struck through.

## What "main panel" means here

There is one body of markup behind both main panels. `src/gui/htmlvr/MainMenuPanel.js`
exports `buildSectionHTML_*` / `buildMenuHTML_*`, and:

* the VR main menu (`MainMenuPanel`) renders sections `scene, topology, rendering,
  camera, sculpting, properties, animation` plus menus `files, history, background,
  reference, settings, about`;
* the desktop/iPad sidebar (`src/gui/Gui.js`) renders the *same* builders, minus the
  `animation` section (desktop has `GuiTimeline` instead).

So "in the main panel" is almost always one fact, not two. Where it isn't, it is called
out below.

The other surfaces:

* **MiniPanel** — `src/gui/htmlvr/MiniPanel.js`, the wrist HUD. VR only.
* **Marking menu (B ring)** — `Scene._resolveRadialCommands()`, drawn by `VrRadialMenu`.
* **Pin ring (A ring)** — `Scene._resolvePinCommands()`, same renderer, separate button.
* **Viewport "…" menu** — `Scene._resolveViewportMenuCommands()` = B ring + the A ring as a
  `Pin` submenu. Flat-screen skin of the two rings, drawn by `ViewportMenu`.
* **Timeline "…" button** — `GuiTimeline._contextMenuCommands()` = shape-layer commands +
  `_resolveRadialCommands()`. **Not** the pin ring.

## Input reality per platform

| | Controllers (Quest/PCVR) | Hands-only (AVP, GXR hand mode) | Desktop | iPad / Pencil |
|---|---|---|---|---|
| B ring (marking menu) | yes | **no button** | no | no |
| A ring (pin modes) | yes | **no button** | no | no |
| Viewport "…" | no | no | **right-click only** | **no right-click** |
| Timeline "…" | yes | yes (VR timeline quad) | yes | yes |

`Scene._buildControllerGuide` (≈ line 12272) confirms the hands mapping: pinch, fist,
both-fists, both-pinch. No stick, no face buttons. Everything the rings carry is therefore
unreachable in hands-only *except* via the timeline "…".

---

# Tier 1 — in no panel at all (marking-menu only)

These exist **only** in `_resolveRadialCommands` / `_resolvePinCommands`. Verified by
grepping every call site of the underlying API.

## Group A — rig topology, B ring only

| ID | Command | Underlying call | Only call site |
|---|---|---|---|
| **A1** | Split bone | `RigTopology.split` | Scene.js:12006 |
| **A2** | Dissolve | `RigTopology.dissolve` | Scene.js:12010 |
| **A3** | Duplicate Chain / Duplicate Mesh | `RigTopology.duplicate` / `_duplicateInPlace` | Scene.js:12028 |

> **A3 — the outliner's copy button is not this.** `mm-duplicate` calls `Scene.duplicateSelection`
> (Scene.js:4550), which makes a bare `MeshStatic` + `copyData`. `Mesh.copyData` (Mesh.js:2913)
> carries geometry, transform and render config only — **not** `_isBone`, `_boneMirror`,
> `_ikRest` or `_bonePinMode` — and there is no `_withDescendants` call, so nothing below the
> joint comes along. Duplicating a joint from the outliner yields one orphaned capsule-shaped
> mesh that is not a joint. `RigTopology.duplicate` by contrast walks the subtree, renames the
> whole chain onto a free base, rebuilds the mirror twin and records one undo entry.
> **Fix shape:** branch in `duplicateSelection` — if every selected mesh is a joint, hand off to
> `RigTopology.duplicate`.

| **A4** | Delete Bone | `Scene.deleteJointSubtree` | Scene.js:12050 |

> **A4 — the outliner's trash mostly works, and leaves the rig visuals stale.** `mm-delete-mesh`
> calls `Scene.deleteCurrentSelection` (Scene.js:4390), which expands through `_withDescendants`
> — and joints are ordinary meshes parented by `_parentMesh`, so the subtree **does** cascade and
> the undo entry **does** record the whole set. What it does not do, and `deleteJointSubtree`
> does, is call `Skeleton.updateVisuals` + `Skeleton.refreshOutliner` afterwards. So capsules,
> pins, name labels and the outliner rows for the deleted joints survive until something else
> forces a refresh. **Fix shape:** two lines at the end of `deleteCurrentSelection`, guarded on
> the removed set containing a joint.

| **A5** | Name chain (+ `Limb names` / `Centre names` sets, + `Keyboard`) | `Skeleton.nameChain` | Scene.js:11942, 11969 |

`bonePanel.buildBoneAuthoringHTML` has none of these. A4 also has a desktop keyboard equivalent
(`Delete` while in Bone Draw with joints selected, SculptGL.js:1300), which routes to the same
`deleteCurrentSelection` and so carries the same stale-visuals caveat.

## Group B — pin modes, A ring / viewport "…" only

All six go through Scene.js:11802 (`IKSolver.setPinMode`) except B6.

| ID | Command | Note |
|---|---|---|
| **B1** | Position | |
| **B2** | Position and Rotation | |
| **B3** | **Rotation Only** | unreachable on iPad by any route |
| **B4** | **Aim** | unreachable on iPad by any route |
| **B5** | Unpin (single joint) | main panel has only the all-pins wipe |
| **B6** | Ground: On / Off | `IKSolver.togglePinGround`, Scene.js:11826 |

The main panel's Pose block (`buildBonePoseHTML`) has only **Clear Pins (n)** — an all-pins
wipe, not a per-joint mode.

The on-screen Modifier button (`ModifierButton` → `SecondaryAction.PIN`) is *not* an
equivalent: it runs `IKSolver.togglePin`, a **3-step cycle** unpinned → position →
position+rotation. It reaches B1 and B2 only; `PIN_ROT` (B3) and `PIN_SOFT` (B4) are
unreachable from it.

## Group C — pin weight, A ring `Weight` submenu only

| ID | Command | Call |
|---|---|---|
| **C1** | Activate Here | `IKSolver.setPinActive(…, true)`, Scene.js:11845 |
| **C2** | Deactivate Here | `IKSolver.setPinActive(…, false)`, Scene.js:11847 |
| **C3** | Match Here | `IKSolver.matchPinHere`, Scene.js:11852 |
| **C4** | Half | `IKSolver.setPinWeightKey`, Scene.js:11854 |
| **C5** | Clear Keys | `IKSolver.clearPinWeight`, Scene.js:11859 |

Note the asymmetry: **physics** bone weight has a full main-panel block (Weight slider, Key
Weight, Stiffness, Gravity, Damping, Follow, Drag, Ground/Self collision) in
`buildBoneAuthoringHTML`. **Pin** weight has nothing.

---

# Tier 2 — Group D: in the MiniPanel but not the main panel

| ID | Control | MiniPanel | Main panel |
|---|---|---|---|
| **D1** | Grab channels — `Translate` / `Rotate` | `mp-grab-translate` / `mp-grab-rotate` (MiniPanel.js:51) | **absent**. `GrabChannels` has no other UI consumer. |
| **D2** | Motion-path `Connectivity` falloff | `mp-connected` (MiniPanel.js:1046) | **absent**. Only other consumer is `GuiSculptingTools.js:32`, which builds into a detached container (Gui.js:554) and is never displayed. |
| **D3** | TransformVR mode `Move` / `Rotate` / `Scale` | `data-tvr-mode` (MiniPanel.js:1203) | **absent**. `transformPanel.buildTransformSectionHTML` carries only `Free rotate`. |
| **D4** | Voxel `Align to hand` | `data-voxel-align` (MiniPanel.js:1166) | **deliberately omitted** — MainMenuPanel.js:2544 comment "align-to-hand omitted". Still a gap for a VR user driving the main panel. |
| **D5** | Paint colour wheel | `ColorWheel` (MiniPanel.js:794, 1106) | main panel uses `<input type="color">` (`mm-paint-color`, MainMenuPanel.js:2650). See E1. |

Non-gaps checked and cleared (listed so they are not re-audited):

* `Set Parent` — in both (MiniPanel `mp-set-parent`; main panel outliner, MainMenuPanel.js:3918).
* Rig display flags — MiniPanel has 5 quick ones, main panel has all 14 in Rendering
  (`buildBoneDisplayHTML`, MainMenuPanel.js:2254).
* Masking, Smooth/Relax, Extrude/Inset, Brush toggles, voxel modes/shape/buildup/flat/wire/
  resolution/resample/bake — all in both. Main panel is a superset (adds Blur, Sharpen,
  Extract, plane-lock, Surface mode).
* Undo/redo, tool swap, radius, intensity — MiniPanel carries the hands-only substitutes for
  the stick bindings; History menu and the Properties sliders cover the main panel side.

---

# Tier 3 — Group E: in the main panel but not usable where it matters

| ID | Item |
|---|---|
| **E1** | **Paint colour.** `mm-paint-color` is a native `<input type="color">`. A native colour input does not survive the HTML→SVG rasteriser, so in a headset the main panel cannot set paint colour at all — only the MiniPanel's `ColorWheel` can. `ColorWheel` is already imported into MainMenuPanel (wireframe swatch, line 1537), so the fix is a swap, not new code. |

---

# Tier 4 — Group F: reachable, but only down a path nobody will find

| ID | Item |
|---|---|
| **F1** | The timeline's `…` toolbar button (`GuiTimeline.js:4074`, tooltip "More: Copy / Paste / Paste Link / Dup / Make Unique / Delete") opens the **entire B ring** — A1–A5 included. The VR timeline quad renders the same canvas (`Scene._openVRTimeline`, opened from the Animation section's `Show Timeline`), so in hands-only the chain **does** exist: Main panel → Animation → Show Timeline → `…` → Split bone. Reachable, not discoverable. Does **not** include groups B or C. |

---

# Tier 5 — Group G: input-only, no UI anywhere

| ID | Function | Binding | Panel equivalent |
|---|---|---|---|
| **G1** | Copy / Cut / Paste keys | Ctrl+C / X / V | timeline `…` only |
| **G2** | Quick tool swap | stick click / `mp-swap-btn` | MiniPanel only |
| **G3** | Spectator mode cycle | `D` | none (dev-facing) |
| **G4** | Spectator calibration | `C` | none (dev-facing) |
| — | Ortho / perspective toggle | `O` | **covered** — Rendering `mm-cam-proj` |

G3 and G4 are dev-facing; listed for completeness, not proposed as work.

---

# Tier 6 — Group H: tool-grid gaps

`toolLists.js` is the single source for both the main panel's tool grid and the VR tool picker.

| ID | Item |
|---|---|
| **H1** | `Enums.Tools.VOXEL` (14) is **not in `toolLists.js`**. The Voxel tool is entered only as a side effect of `Add Voxel Object` (`mm-add-voxel`, MainMenuPanel.js:2072 / 3887) or by selecting a voxel object. Reads as an oversight. |
| **H2** | Also absent: `LOCALSCALE` (12), `TRANSFORM` (13), `SNAP_WELD_CENTER` (26), `SPLIT_EDGE` (27), `EDGE_CREATE` (28). These look legacy/desktop-internal and are probably correct to leave out — flagged only so the omission is on the record. |

---

# Tier 7 — Group J: platform affordance

| ID | Item |
|---|---|
| **J1** | The viewport "…" menu (B ring + pin submenu) is bound to **right-click only** (`SculptGL.js:1588`). iPad and Pencil reach none of it. Already on the backlog as "desktop/iPad '…' next". **Confirmed on device 2026-09-15** — matt, on an iPad: "there's no r.click menu nor marking menu." Not inferred from the code; observed. |
| **J2** | Hands-only has no B or A button, so groups A, B and C are unreachable except through F1. This is the umbrella item the rest of Tier 1 rolls up into. |

---

# Suggested order of work

1. **B1–B6 and C1–C5 into the main panel Pose block.** Biggest hole: eleven commands, none
   of them anywhere else, and two of them (B3, B4) unreachable on iPad by any route at all.
   A mode row beside `Clear Pins` acting on the selected joint mirrors how the physics block
   already reads the selection.
2. **A1–A5 into the Bone Authoring block**, acting on the selection rather than on hover.
   A1 and A2 are already gated on the Bone tool, which is exactly when that panel is showing.
   A3 and A4 are cheaper than the rest: the outliner buttons already exist and already act on
   the selection — A4 needs a refresh call, A3 needs a joint branch. Do those two first.
3. **E1** — paint colour to `ColorWheel`. Small, and it fixes a control that is currently
   dead in VR.
4. **D1–D4** into Properties. Each is one button next to controls that are already there.
5. **J1** — a viewport "…" affordance for touch.
6. **H1** — Voxel into `toolLists.js`.

---

# Unrelated finding, recorded here because this audit is what turned it up

The page's three error handlers — `window.addEventListener('error')`,
`unhandledrejection`, and the `console.error` interceptor — are all installed **inside
`window.onload`** (index.html:308), which is inside a `<script type="module">`. A failure at
module-evaluation time (a bad import, a parse error) means `onload` never fires, so none of
them are ever installed and the error is invisible on device. Even when they do fire they
write into `#log`, which is `display:none` (index.html:51) and is only revealed by a Settings
toggle that needs the app to be alive. `?debugMode=1` does not help — that flag drives the VR
HUD log, not `#log`.

This surfaced on 2026-09-15 when the site failed to load on an iPad and then started working
again on its own. An intermittent load failure that leaves no trace anywhere is the worst
case for this arrangement, and we have now had one.

**Fix shape:** move the three listeners into a plain inline `<script>` in `<head>`, before the
module loads, buffering into an array the later code drains. Optionally reveal `#log` on an
uncaught error rather than waiting to be asked.
