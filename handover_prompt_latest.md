# Handover Prompt (Protocol Enforced)

**Project Status**: Active Development — Rigging (roadmap #35). Rigging is feature-complete in VR and shipped; this task brings the posing modes to a 2D screen.
**Current Working Directory**: `/Users/mattestela/sculptxr`
**Checkpoint**: Bone tool modes have no mouse/touch implementation — build them.

## MANDATORY reading
You MUST read `project_rules.md`, `overview.md` and `docs/code_summary.md` before responding. NO EXCEPTIONS.
Every response starts with `Step Id: {id}`. Never commit, push or deploy unless asked.

## Deployed Version
- **Local**: v3.19.4 (dev server usually already running on https://localhost:8080)
- **Beta**: v2.9.0 (stale, ignore)
- **Prod**: v3.19.0

## Interactive Debugging
- **Preference**: Use the browser console for immediate state inspection.
- **Workflow**: Provide copy-pasteable snippets.

---

## THE TASK

`src/editing/tools/BoneDrawTool.js` has six modes. **Only `draw` has a desktop path**; the
other five exist solely in `updateXR` (VR controllers). On iPad and desktop they are currently
rendered disabled, which is a placeholder, not a design decision — they are all perfectly
implementable on a 2D screen.

| Mode | VR gesture | What it must become on a screen |
| :--- | :--- | :--- |
| `fk` / `free` (Tweak) | grab a joint, drag it in 6DOF; FK lets children follow, FREE pins them | click a joint, drag it. Depth is the open question — see below |
| `pose` | grab a joint, controller ROTATION drives it, children ride | click a joint, drag to rotate about an axis |
| `radius` | hold near a capsule, radius follows hand distance from the bone | click a capsule, drag out to size it |
| `ik` | drag a joint, solver reaches with the whole rig, pins held; A cycles pins | click a joint and drag; needs a click for pin cycling too |

### Where to write it
`BoneDrawTool.start()` / `update()` / `end()` — the standard `SculptBase` desktop stroke
hooks. `start()` currently early-returns unless the mode is `draw`. Every mode's *logic* is
already factored into shared methods that take a position or a quaternion, so this is mostly
input plumbing, not new rigging maths:
- `_beginGrab(joint)` / `_dragTo(pos)` / `_releaseGrab()` — tweak
- `_beginPose(joint, quat)` / `_poseTo(quat)` / `_releasePose()` — pose
- `_beginRadius(joint)` / `_radiusTo(pos)` / `_releaseRadius()` — radius
- `_beginIK(joint, quat)` / `_ikTo(pos, quat)` / `_releaseIK()` — IK
All of them push their own undo on release. `Skeleton.pickJoint(main, modelPos, maxDist)`
finds the joint nearest a model-space point; `this._pickBone(pos)` does the capsule version.

### THE ONE REAL DESIGN PROBLEM: depth
A joint lives INSIDE the mesh, and a screen gives you no depth. Do not paper over this — it is
the whole reason bone drawing was built VR-first. Three approaches, and it is worth putting
them to matt rather than picking silently:
1. **Screen-plane drag** — move the joint in the plane through it facing the camera. Simple,
   predictable, and orbiting gives you the other axis. This is what most DCCs do.
2. **Surface-pick depth** — reuse `picking.intersectionMouseMeshes()` as `draw` mode does.
   Wrong for a joint that belongs in the middle of a limb; fine for `radius`.
3. **Camera-axis rotation for `pose`** — there is a WORKED PRECEDENT in this repo:
   `src/editing/tools/GeodesicPoseTool.js` bends on desktop by taking the pivot, locking the
   rotation axis to the camera view axis, and using the cursor's angular sweep around the
   pivot's screen position as the amount. `pose` mode wants exactly that, driving
   `_poseTo(quat)` instead of a vertex deform. Read that tool before designing anything.

### Do not forget
- **`Enums.Tools.GEODESIC_POSE` is a different tool from `BONE_DRAW`** — don't confuse them.
- **`setToolIndex` fires `clearPreview()` only on a real tool change**, but selection changes
  call it constantly; anything destructive must stay gated on that.
- **Never call `main.render()` from `updateXR`** (re-entrant render). `_refresh()` already
  early-returns in XR; the desktop path is the one that needs the explicit render.
- Joint selection: grabbing a joint calls `setMesh(joint)` DEFERRED via `setTimeout` — doing
  it during the grab killed the grab (see the comment on `_selectLater`).
- The gating to remove when modes land: `XR_ONLY_MODES` in `src/gui/bonePanel.js`. Remove
  each mode from that array as it gains a 2D path — the disabled state and tooltip then go
  away by themselves in every panel.

### Testing
No VR needed for most of this. The repo's pattern is a node harness that strips imports from
the REAL source and stubs the rest, so the code under test is the shipped code:
`scratchpad/ik_test.mjs`, `skin_level_test.mjs`, `keyrig_test.mjs`, `bonepanel_test.mjs`.
Run them all before handing anything back. Ask matt for a desktop/iPad test — he iterates
fast and prefers a working thing to a designed thing.

**A trap that has cost real time three times**: when a pin or a reach looks wrong, check
whether the target is geometrically REACHABLE before suspecting the solver. Straight limbs
have zero slack, so any body movement over-extends them and falling short is correct.

---

## STATE OF THE TREE

**Uncommitted** (all matt-tested except where noted), on top of `2999294a`:
- v3.19.1 typing fix — global key handlers stand down while a field has focus
  (`Utils.isTypingTarget`, used in `SculptGL.onKeyDown/onKeyUp` and three `Scene.js` listeners)
- v3.19.2/.3 Nomad Link failure hints (iOS/WebKit blocks `ws://` from an https page), and the
  removal of the "connect before entering VR" advice, which was never true
- v3.19.4 the shared bones panel — `src/gui/bonePanel.js`, used by MiniPanel (`mp` dialect)
  and the sculpting section (`mm` dialect)

**Shipped to prod as v3.19.0**: full-body IK, 3-state pinning, 6DOF grab, Bind Pose, Key Pose,
the subdivide-while-bound crash fix, the bound-level fix.

**Known open, not bugs to chase**: rig keys are drawn in the dopesheet but deliberately not
draggable (editing a pose means moving the WHOLE pose — unbuilt); no joint limits, so knees
bend backwards; `window._boneATrace = true` turns on an A-button trace kept in the build after
an intermittent face-button bug that may or may not be fully fixed.
