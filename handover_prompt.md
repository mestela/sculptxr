# Handover Prompt (Protocol Enforced)

**Project Status**: Active Development — Rigging (roadmap #35). The bone tools now work with a mouse and a finger; the remaining problem is that FBIK is UNCONSTRAINED, and the task is joint limits.
**Current Working Directory**: `/Users/mattestela/sculptxr`
**Checkpoint**: Replace the post-hoc "preferred bend" correction with real hinge constraints inside the FABRIK sweeps.

## MANDATORY reading
You MUST read `project_rules.md`, `overview.md` and `docs/code_summary.md` before responding. NO EXCEPTIONS.
Every response starts with `Step Id: {id}`. Never commit, push or deploy unless asked.

## Deployed Version
- **Local**: v3.19.18 — committed as `51c96430`, **NOT PUSHED, NOT DEPLOYED** (matt's call)
- **Prod**: v3.19.11 (`9d552751`)
- **Beta**: v2.9.0 (stale, ignore)

## Interactive Debugging
- **Preference**: Use the browser console for immediate state inspection.
- **Workflow**: Provide copy-pasteable snippets.
- A plain-HTTP dev server config exists (`sculptxr_http`, port 8081) because the in-app browser
  will not accept the self-signed cert on 8080. The automated tab THROTTLES its render loop:
  picking silently returns nothing until real input has driven a frame. Drive it with real
  clicks, or accept that synthetic pointer events will mislead you.

---

## THE TASK: joint limits, hinge first

### Why now, and why REPLACE rather than add
The preferred-bend feature (`fixBendDirection` in `src/editing/IKSolver.js`) is a POST-HOC
CORRECTION: solve freely, then reflect the joint back if it came out on the wrong side. That is
structurally poppy — the correction is a discrete jump applied after convergence, so when a limb
passes through straight the solver crosses the boundary and the fix snaps it back. Matt sees the
snap. Three iterations each fixed one symptom and revealed another, which is evidence the
approach is wrong rather than incomplete.

A constraint applied INSIDE the sweeps never lets the solve cross the boundary, so there is
nothing to snap. Delete `fixBendDirection` when the constraint lands; do not run both.

### What is still wrong (matt's own words, latest session)
1. "It still pops out and into poor poses if I straighten then bend the knee."
2. "If I move the knee, the feet and feet pins move with it, but if I then move the hips, the
   knee stays where it should and the feet pop back into place. The right end result, but
   unintuitive." — the drag frame is showing an UNCONVERGED solve.

Constraints subsume (2) as well: with a hinge on the knee, dragging the knee can only rotate the
leg about that hinge, so the foot cannot be dragged off its pin because the configurations where
it would be are no longer representable. The current single-bone clamp (`clampToPins`) is a
special case bolted on outside the solver and should probably go with `fixBendDirection`.

### Shape of the work — HINGE ONLY for phase 1
- Knees, elbows and fingers are 1-DOF. That single case covers the backwards bend, the branch
  flip and the pop.
- **The hinge axis comes from the REST POSE** — the pronounced bend matt already draws by habit.
  The bend-plane normal IS the axis, which is already computed in `fixBendDirection` and stored
  as `joint._boneBendRef`. So phase 1 needs NO new UI and NO chain classification.
- Apply in BOTH FABRIK sweeps (Aristidou & Lasenby's constrained variant): express the incoming
  bone direction in the joint's local frame, project onto the hinge plane, clamp the angle.
- Angle range can default wide (0–160 degrees); tightening is a later refinement.

**The risk to plan for**: constrained FABRIK converges more slowly and can fail to reach targets
that unconstrained FABRIK would. The PIN TESTS ARE THE CANARY — if pins start drifting, that is
the constraint fighting the solve, not a bug in the pin code.

### Phase 2 (matt wants it, explicitly deferred)
Classify joint chains, to both NAME them and control their behaviour — that is where per-joint
limit ranges come from (a knee's range is not an elbow's). It lands on a working mechanism
rather than being a prerequisite.

---

## HOW THIS CODE IS TESTED — read this before writing a test

`scratchpad/*.mjs`, run with `/opt/homebrew/bin/node`. Each harness reads the REAL source, strips
its imports, prepends stubs, and imports the result, so the code under test is the shipped code.

- `ik_test.mjs` (66) — the solver. Where constraint work belongs.
- `bonescreen_test.mjs` (124) — desktop/iPad input plumbing for BoneDrawTool.
- `module_load_test.mjs` (5) — bundles the REAL modules with their REAL imports and imports them.
- `bonepanel_test.mjs`, `keyrig_test.mjs`, `skin_level_test.mjs`.

**Two lessons that cost real time in the last session, both worth internalising:**

1. **A passing test proves nothing until you have seen it fail.** Three separate tests passed
   against buggy code: a knee-flip test whose sweep never provoked a flip (the unguarded control
   also scored zero); a `_modelCentre` test that passed because the scene stub contained only
   joints, so the answer was `(0,0,0)` either way; and a symmetry test that passes with AND
   without the bug it was written for. ALWAYS re-run a new test against the pre-fix code.
2. **The harnesses stub everything, so they cannot catch a module that fails to EVALUATE.** A
   TDZ error in `Skeleton.js` shipped with all 209 checks green. `module_load_test.mjs` exists
   for exactly this. `esbuild --outfile=/dev/null` proves syntax only, never evaluation.

---

## SOLVER MAP (`src/editing/IKSolver.js`)

- `buildGraph` — per-solve node graph. `n.off` is the offset from the parent BEFORE the solve,
  in model space; `n.len` its length. Rebuilt every solve on purpose.
- `fabrik(nodes, targets, root, rootFixed, tol)` — backward sweep (leaves to root, subbases
  average their branches), forward sweep (root outward, re-imposing lengths). **A subbase's
  children are placed as ONE RIGID CLUSTER** — do not move them independently, or you produce a
  pose no single joint rotation can reproduce and `applyRotations` silently discards the
  difference, which surfaces as pinned joints drifting. This bit me when `fixBendDirection`
  reflected a thigh.
- `applyRotations` / `fitRotation` — fits each joint's rotation to the solved child positions,
  as a MINIMAL-ARC DELTA from its current orientation. Never invents roll; also means the local
  quaternion carries accumulated history.
- `IKSolver.pinAnchor(joint)` — the world-space anchor. NOT the joint's live position.
- `clampToPins` / `pathLengths` / `reachSpan` — the single-bone drag clamp.
- `fixBendDirection` — the thing to replace.
- Runtime flags: `window._ikPreferredBend`, `_ikClampToPins`, `_ikLockGrabRotation`,
  `_ikGrabRotate`.

## A STANDING TRAP
When a pin or a reach looks wrong, check whether the target is geometrically REACHABLE before
suspecting the solver. This has cost real time four times now. A knee one bone from a pinned
foot can ONLY sit on a sphere around it; asking for anything else is contradictory, not hard.

---

## KEYFRAMING — answered, not yet acted on

Matt asked whether keyed IK poses re-run FABRIK on playback. **They do not.**
`AnimationRegistry._writeTransformKey` stores each joint's LOCAL TRS; playback slerps the
quaternion and lerps position/scale straight back into the local matrix. No solve in the loop.

The craziness he reports comes from what IK BAKES: every solve is a minimal-arc delta from the
current pose, so the stored local quaternion carries accumulated history (roll about each bone
axis, and which side a knee ended up on) rather than only the visible pose. Two poses that look
identical can hold quite different local quaternions, and slerp interpolates that hidden
difference — which reads as limbs spinning.

**Proposed fix, not started**: canonicalise the pose at key time — re-derive each joint's local
rotation from the visible bone directions with zero roll relative to its parent, so a key depends
only on what you can see. Contained. Discuss with matt before building.

---

## STATE OF THE TREE

**`51c96430` (v3.19.18) — committed, NOT PUSHED.** Everything below is in it.
Prod is still v3.19.11; `origin/master` is one commit behind local.

- v3.19.12 IK pins are world-space anchors (a character can jump; an unreachable pin falls short
  and returns exactly)
- v3.19.13 display proportions: constant joint marker size, default capsule radius halved to 0.25
- v3.19.14 fix: `Skeleton.js` TDZ crash + the module-load harness
- v3.19.15 desktop IK drag holds its grab-time orientation. **Per-joint stiffness was built,
  measured and REMOVED** — under 1.5% change in joint travel, worst single-frame jump untouched,
  and the settings that moved the number cost up to 3e-2 of target accuracy. Do not re-propose
  positional damping for branch flips: both branches satisfy the bone lengths equally well, so
  there is nothing for a distance-based bias to prefer.
- v3.19.16–.18 preferred bend (partial, see THE TASK)

**Shipped to prod as v3.19.11**: the whole desktop/iPad bone toolset — screen-plane drag for
Tweak and IK, camera-axis sweep for Pose, distance-from-shaft for Radius, tap-to-cycle IK pins,
press-drag-release drawing with the symmetry plane visible, Escape/Enter to end a chain, `O` for
orthographic, and the fix for orthographic rendering blank since the Three.js port.

**Known open, not bugs to chase**: rig keys are drawn in the dopesheet but deliberately not
draggable; `window._boneATrace = true` turns on an A-button trace kept after an intermittent
face-button bug.

**Matt flagged for after the bone work**: the VR mini-HUD's "low poly & full menu" button opens a
panel that is "quite broken".

## WORKING WITH MATT
He iterates fast and prefers a working thing to a designed thing. He tests on desktop AND iPad
AND in VR, and he finds the cases the harness does not — trust his reports over a green suite.
Tell him plainly when something is unverified; he is not served by confident-sounding guesses.
