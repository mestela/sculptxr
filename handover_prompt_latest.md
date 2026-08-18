# Handover Prompt (Protocol Enforced)

**Project Status**: Active Development — Rigging (roadmap #35). FBIK now works as a CONTROLLER:
pins are scene objects, grabbing a bone poses the rig, rotation has real winding. The remaining
work is making the VR transform tool reach bones and pins.
**Current Working Directory**: `/Users/mattestela/sculptxr`
**Checkpoint**: Give `TransformVR.js` a rig-aware pick. It has none at all.

## MANDATORY reading
You MUST read `project_rules.md`, `overview.md` and `docs/code_summary.md` before responding. NO EXCEPTIONS.
Every response starts with `Step Id: {id}`. Never commit, push or deploy unless asked.

## Deployed Version
- **Local**: v3.19.60 — committed as `f545693a`, **NOT PUSHED**
- **Prod**: v3.19.54 (`388a55ec`) — deployed, working
- **Beta**: v2.9.0 (stale, ignore)

## Interactive Debugging
- **Preference**: browser console for immediate state inspection; copy-pasteable snippets.
- Matt tests on desktop AND iPad AND in VR. Trust his reports over a green suite.
- **`console.log` IS INTERCEPTED** (`index.html` ~236) and routed to `screenLog`. That is not a
  curiosity: logging performs a repaint, so a debug flag can be LOAD-BEARING. See the war
  stories below — "only works with the trace on" cost half a session.

---

## THE TASK: rig picking in TransformVR

`TransformVR.js` contains no `intersection*` call of any kind — it operates on
`this.getMesh()`, whatever was already selected. So "picking doesn't work in VR" is precise:
there is no picking to fix. It needs one adding.

Everything it needs already exists and is shared with Grab:

- `picking.intersectionRayMeshes(meshes, origin, dir, /* includeRig */ true)`
- `Skeleton.hoverRigFromRay(main, picking, origin, dir)` — preselection, throttled, non-destructive

Use the `origin`/`dir` that `updateXR` is HANDED. They arrive in engine space. Deriving a ray
from the controller matrix puts it in the raw WebXR frame and the pick misses every mesh in the
scene, silently, on every frame.

---

## THE TRAP THAT COST A DAY: parallel implementations

Four times this week the same shape of bug: two code paths doing one job, and a fix landing in
only one of them.

| desktop | VR |
| --- | --- |
| `Transform.js` | `TransformVR.js` |
| `Picking.intersectionMouseMeshes` | `Picking.intersectionRayMeshes` |
| `Grab.start`/`update` | `Grab.updateXR` |

**CHECK WHICH TOOL IS ACTUALLY ACTIVE BEFORE EDITING.** Six rounds of fixes went into
`Transform.js` while matt was testing `TransformVR` in the headset — the log line
`[TransformVR] updateXR` is what finally revealed it. Ask for a console trace EARLY.

`rigpick_test.mjs` now asserts the same properties on both picks precisely so they cannot
drift again. Extend that pattern rather than fixing one side.

---

## STATE OF THE RIG

**Working and confirmed by matt:**
- **Pins are scene nulls.** The pin's TRANSFORM is the anchor, so the old ratcheting bug is
  unrepresentable. Selectable, gizmo-draggable, named after their bone (`pin_bone_03_R`), saved
  (SKEL v3), and keyed by Key Pose.
- **Grab poses the rig** on desktop and in VR, carrying orientation as well as position.
- **Bones and pins are picked as points in a CONE**, not by ray-vs-geometry — a joint's pick
  sphere is a fraction the size of the marker you see. Pins get a wider cone than bones because
  ranking only decides ties. Ortho uses a cylinder (parallel rays).
- **Rotation is Euler with winding** — a 3600-degree key spins ten times. `rotSync` rebuilds
  from quaternions when the arrays fall out of step: a missed splice site degrades, never
  corrupts.
- **The graph editor has T/R/S channels**, with per-group view framing.

**Off or absent:**
- **Gizmo posing** (`window._ikGizmoPose = true` to enable). It WORKS, but the detector watches
  every joint every frame for every tool, and restoring matrices before re-solving fights
  anything else that writes joints — it locked the desktop gizmo up completely. Watching global
  state is fine for pins (nothing else moves them) and wrong for joints (solver, skinning,
  animation, undo all write them). **Scope it to an actual gizmo drag** — mouse-down over a
  joint to mouse-up — rather than inferring from matrices changing.
- **Rig preselection in `TransformVR`** — the task above.
- **Thumbstick controlling gizmo scale** (matt's idea, not started). The gizmo is sized for
  objects and is comically large on a bone; radius-on-thumbstick is the established gesture so
  it should feel familiar. Note the gizmo's size is DERIVED (constant screen size), so this
  means adding a user scale factor on top, persisting it, and routing the thumbstick when
  Transform is active.

---

## WAR STORIES — read these before debugging anything visual

1. **A debug flag can be load-bearing.** VR grab worked only with `_grabTrace` on, then only
   with the remote console attached. Neither can change logic. `console.log` is redirected to
   `screenLog` (a repaint), and the console changes frame timing. The real causes were a missing
   `render()` and a hover costing too much at 90Hz. **"Only works with debugging on" is a TIMING
   signal, not a mystery.**
2. **Preselection must not disturb the pick.** `picking` is shared state — a pick writes
   `_mesh`, `_interPoint`, `_pickedFace`, which tools read to decide what was clicked. A hover
   pick every frame clobbered it. `Skeleton.hoverRigFromMouse/FromRay` snapshot and restore.
3. **Thresholds are not epsilons.** Move detection compared matrices at `1e-9`, below float32
   spacing (~1.2e-7 near 1-2), so it reported a move on EVERY comparison. This shipped in the
   pin watcher at v3.19.33 and re-solved every frame for two days. Now `1e-5` (`MOVE_EPS`).
4. **`_trans[2]` is not a distance.** `setPivot` stores it pre-multiplied by `fov/45`. Reading it
   as a distance inflated the ortho frustum by 1.8x. The corrected formula reproduces the old
   hand-tuned `0.00055` at the fov and canvas that constant was calibrated for.
5. **Euler has a double cover.** Every XYZ orientation has two spellings and
   `setFromQuaternion` always returns |y| <= 90, so a steady 170-deg-per-key spin rebuilds as
   0, 10, -20, 30. Unwrapping by whole turns cannot fix it; both spellings must be compared.

---

## HOW THIS CODE IS TESTED

`scratchpad/*.mjs`, run with `/opt/homebrew/bin/node`. Each reads the REAL source, strips
imports, prepends stubs — so the code under test is the shipped code.

- `ik_test.mjs` — the solver, pins, gizmo watcher. Where solver work belongs.
- `rigpick_test.mjs` — the cone geometry and the mouse/VR pick parity.
- `xfchannel_test.mjs` — graph editor channels, rotation winding, and a SOURCE GUARD that no
  channel-indexed transform access exists outside the accessors, across three files.
- `undef_test.mjs` — eslint `no-undef` over ten rig/animation files. Added after a block-scoped
  `const` used outside its block crashed bone drawing, invisible to every other harness.
- `module_load_test.mjs` — bundles the REAL modules with REAL imports and imports them. The only
  thing that catches a module failing to EVALUATE.
- `keyrig_test.mjs`, `bonepanel_test.mjs`, `bonescreen_test.mjs`, `skin_level_test.mjs`.

**Two standing lessons:**
1. **A passing test proves nothing until you have seen it fail.** A source guard passed against
   the real bug TWICE (wrong file, then a regex blind to optional chaining) before it worked.
   Always reintroduce the actual defect.
2. **Test the CALL SITES, not just the helper.** Accessor tests were green while five call sites
   went around them and the graph editor was broken. What catches that is asserting nothing else
   touches the underlying arrays.

---

## SOLVER MAP (`src/editing/IKSolver.js`)

- `fabrik` — backward/forward sweeps. Subbase children move as ONE RIGID CLUSTER.
- `runSolve` — the sweeps plus one retry from the other branch. Shared by the interactive solve
  and the playback pin pass.
- **The hinge is SEEDED, not clamped.** Which side a knee bends is a discrete choice; clamping
  it inside every sweep made the solver oscillate (40x jitter, 270x pin drift, and MORE
  iterations made it worse). `window._ikHingeMode = 'clamp'` restores the old behaviour.
- `fitLocalRotation` — rotations built ABSOLUTELY from the child's constant local offset, not as
  a delta from the current orientation. Deltas are individually roll-free but compose into
  parallel transport, which comes back rotated around a closed loop — that was the twist ratchet
  behind the candy-wrapper collapse.
- `holdPins` — re-solves pins after playback writes an interpolated pose. Root always fixed.
- `externallyMovedJoint` / `resolveToJoint` — the gizmo-posing watcher. Opt-in, see above.

## STILL UNRESOLVED
- A held pose settles geometrically rather than to machine precision, and raising the
  multi-child fit accuracy brings the twist ratchet back — FABRIK seeding each solve from the
  current pose is a second source of path dependence.
- `hitWorld` in `Grab.start` is built from `getMatrix()`, which is local-to-parent and equals the
  model matrix only for unparented objects. Latent; desktop grab works and it is not understood
  why.
- `Skinning.isBound` may not survive the Multimesh proxy — a bound-mesh check failed to fire.
- `docs/releases.md` is written through v3.19.54; v3.19.55-60 are not yet written up.

## WORKING WITH MATT
He iterates fast and prefers a working thing to a designed thing. He finds the cases the harness
does not. Tell him plainly when something is unverified — he is not served by confident-sounding
guesses. When a fix cannot be verified locally, ASK FOR A CONSOLE TRACE EARLY rather than
shipping another guess; three round-trips of "try this" is worse than one trace.
