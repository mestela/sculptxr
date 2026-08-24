# Handover Prompt (Protocol Enforced)

**Project Status**: Rigging, skinning, rig animation and LIVE PERFORMANCE RECORDING are shipped
and working. Bones and pins are ordinary keyable scene objects; the VR gizmo poses through the
solver; `Make Skin` turns a skeleton into a clean quad blockout; two controllers can each drive
a pin control in one recorded take. The pole vector shipped as a SOFT PIN (v3.19.96), and its
determinism blocker was fixed first (v3.19.94), as intended.
**Current Working Directory**: `/Users/mattestela/sculptxr`
**Checkpoint**: Nothing is mid-flight. Work through **v3.20.5** lives on the `codex` branch
(pushed to `origin/codex`), which is `master` + 12 commits; `master` itself has 3 unpushed
commits and is fully contained in `codex`. **`master` has not been fast-forwarded to `codex`** —
ask matt before merging. `.last_deployed_version` is uncommitted at v3.20.5 (the deploy script
writes it); commit it as `chore: record the v3.20.5 production deploy`.

## MANDATORY reading
You MUST read `project_rules.md`, `overview.md` and `docs/code_summary.md` before responding.
NO EXCEPTIONS. Every response starts with `Step Id: {id}`. Never commit, push or deploy unless
asked.

**Also read `docs/ik_orientation_pin_findings.md` before touching the solver.** It records what
was tried, the numbers, and why the fixes are scoped the way they are.

## Deployed Version
- **Local**: **v3.20.6** on branch `codex`.
- **Prod**: **v3.20.5** (`d39d09cf`), deployed 2026-08-23. matt has used the whole v3.19.96 to
  v3.20.5 range and reports the features feel good.
- **origin/codex**: v3.20.5. **origin/master**: v3.19.90 — three commits behind local `master`.
- **Beta**: v2.9.0 (stale, ignore).
- All three version files (`package.json`, `src/Version.js`, `index.html`) agree at v3.20.6.
  Check that before trusting a bump — see war story 2.

## Interactive Debugging
- **Preference**: browser console; copy-pasteable snippets. matt tests on desktop AND iPad AND
  in VR. Trust his reports over a green suite.
- **Trace flags that exist now** — use them instead of guessing:
  - `window._ikTrace` — one line per solve: effector, target and pin counts, rootFixed, and
    whether a driven orientation was dropped and why. Plus `holdPins`.
  - `window._tlTrace` — per dopesheet click: the geometry the hit test is using, the NEAREST
    key with its dx/dy, the gate states, and which branch consumed the click.
  - `window._animKeyTrace` — every input to the AutoKey decision, not just the outcome.
  - `window._grabTrace`, `window._boneATrace` — preselection and the A button.
  - `window._boneSkinRelax = false` — build the raw skin cage with no relax pass. The only way
    to tell a claim bug from a relax bug; they look identical from outside.
  - `window._skinTrace`, `window._boneTrace`, `window._pickTrace`, `window._orthoTrace` — the
    rest of the set. Every one is off by default and all of them beat guessing.
  - `IK_INJECT=noswivel|axial` — harness-only env var for `ik_test.mjs`, which reintroduces the
    two plausible ways the steering goal can be wrong so its checks have been SEEN to fail.

---

## THE POLE VECTOR — DONE (v3.19.96, refined v3.20.4)

It shipped as matt designed it: **per-joint weights as a priority ordering**, a hard ankle goal
and a low-weight knee goal, so the knee only steers the freedom the ankle leaves.

The freedom is real and was measured. A pinned ankle is ONE bone below the knee, so it does not
merely limit the knee's reach — it confines the knee to a SPHERE about the pin. Fix the hip as
well and the intersection of two spheres is the classic pole-vector **circle** about the
hip-to-ankle axis. A **soft pin** steers where on that circle the knee sits, and the strong
claim — the one the harness tests — is that it costs the hard pins **nothing**, because the
rotation that steers is about the axis through both of them and every point of that axis is
fixed. A knee cannot reach a goal off its circle and must not stretch anything trying; it goes
to the closest point the circle allows.

It is a fourth stop on the existing pin cycle, not a new button: a soft pin is a pin in every
structural sense (same object, same anchor, same undo) and differs only in what the solver does
with it.

**The refinement in v3.20.4 is the one to remember.** The swivel axis was found by searching
UPWARD for a hard target, so an elbow with pinned hips swivelled about the HIP-to-wrist axis and
dragged the shoulder and torso with it. The pole adjustment runs AFTER FABRIK, so the limb root
immediately above the steered joint is already solved and can be treated as fixed without a pin
of its own. The axis is always shoulder-to-wrist, or hip-to-ankle for a knee.

### The determinism blocker was fixed first (v3.19.94)

FABRIK seeds each solve from the current pose, so the pose carried history. Same pins, same hip
target, three routes to one frame put the knee up to **0.487** apart while satisfying every
control exactly (hips exact, ankle holding its pin to 0.0002). Evaluation is now independent of
the route taken to a frame. As predicted, this is **two seeding modes, not one change** —
interactive DRAGGING still seeds from the live pose, because that continuity is part of why
dragging feels smooth. `null` alone means an interactive drag; an explicitly empty control set
is still an evaluation and wants every solver-owned joint restored before solving.

Reproduce either with `scratchpad/_ik_gen.mjs` (the generated real-solver module `ik_test.mjs`
builds).

---

## SKINNING — DONE (v3.19.90, bind fixed v3.20.4), and how it got there

`src/editing/SkinMesh.js`, wired to `Make Skin` in `gui/bonePanel.js`. Harness:
`scratchpad/skinbox_test.mjs`, which runs in BOTH modes (`SKIN_RELAX=0` for the raw cage).

**What it does now.** A box per joint, **all boxes axis-aligned to the world**, divided four
cells a side. Every bone claims a rectangle of the side it points at — the WHOLE face if it is
alone on that side, equal strips if it shares. Both ends of a bone settle on the smaller loop,
the claimed faces are deleted and bridged, the bridge is cut into rings sized to the loop's own
edge length, and the whole cage is relaxed onto the capsules (smooth, then project, 6 passes).

**Why world-aligned is the load-bearing decision.** Orienting each box to its own bone is the
obvious thing and it is wrong: two boxes can disagree about roll, so the bridge between them
shears, and the amount depends on the angle the bone was drawn at. matt's symptom was "it only
works if I draw at 90 degrees". Boxes that share one orientation have parallel faces
everywhere, so a bridge CANNOT corkscrew at any angle, and there is no roll left to solve,
transport, or hand to the user. The shear does not vanish — it stops being a topology problem
and becomes a shape problem, which is what relax is for.

**Free consequences, both load-bearing:** world X is the symmetry normal and a claim boundary
sits on the box centre, so the seam between two legs lands exactly ON the symmetry plane. And a
lone bone claiming the WHOLE face removes a tie — a bone pointing straight at a face matches
all four quarters identically, so picking one quarter means picking by array order, and a
symmetric skeleton came back visibly asymmetric.

**Dead ends, so nobody re-walks them:**
1. **A tube per CHAIN** (the original). Cannot express a branch: two tubes leaving a spine each
   capped themselves off inside the other. Four separate shells, 95 intersecting face pairs.
2. **One face per bone on an ORIENTED box.** Bridges sheared with the draw angle.
3. **Rectangles + strips + parallel-transported frames.** Same shear, more machinery.
4. **Clamping how far a vertex may move per relax pass.** Stopped relax resolving the raw cage
   at all — the five-bone case went from clean to 50 intersecting pairs.
5. **Holding each bridge vertex to its own bone's capsule** instead of the nearest. Collapsed
   the fat end of every bone; broke three cases at 34 / 367 / 557 pairs.

**Relax must blend, not snap.** Projecting each vertex onto the single nearest capsule creases
hard where two capsules meet AND is not mirror-safe (a seam vertex is exactly equidistant from
the left and right capsule, so the winner is list order). Weight every capsule by proximity.

**Stated limits, written down in the harness rather than tolerated silently:**
- Relaxed: 4 intersecting face pairs where a limb four times thinner than its joint leaves it.
  The union surface near that junction IS the joint's sphere, so every limb's base ring is
  pulled onto the same sphere. Inherent to conforming per-bone topology to a union surface at a
  large radius ratio.
- Raw cage: the five-bones-off-one-face case grazes itself. Relax clears it. Exempted as a
  FLAG, not a count — a face-pair count on the cage is an artefact of bridge density, and
  pinning a number to it means editing that number forever until the check means nothing.

**Untouched, matt's call to make:** `RELAX_PASSES` (6), `SMOOTH_RATE`, `PROJECT_RATE`,
`MAX_SPANS` (32) and the `LENGTH_CLAMP` (0.45) box clamp — which may now be redundant, since
relax conforms to the capsules anyway. All constants at the top of the file.

**Bind always takes the CONTROL CAGE (v3.20.4).** Binding from a subdivided view analysed the
visible sculpt instead of level 0. Each step downward is now analysed first, directly on the
resolution objects rather than by changing selection — Bind must not drop matt's viewport to the
lowest level as a side effect of being pressed.

---

## LIVE RECORDING AND MULTI-PIN ANIMATION — DONE (v3.20.0 - v3.20.2)

This is the bulk of the recent work and the part matt has actually driven. The load-bearing
decisions, so nobody unpicks one by accident:

- **`beginInteraction` / `endInteraction` are called by the TOOLS**, at the true start and end
  of a gesture. Keeping the state transition there is what stops Grab, Transform and
  TransformVR each implementing a subtly different "armed, now start".
- **Capture runs on the TRANSPORT clock, not wall time.** The transport already applies the
  playback-speed multiplier and owns range clamping and wrapping, so keys stay in sync at every
  speed and every control in a multi-target take spans the same loop boundary.
- **A tap is not a take.** The old early return cleared the timer while leaving `isRecording`
  true — a red Record button that could neither capture nor reliably re-arm. Always finish the
  lifecycle.
- **Start-on-grab is an ARMED SESSION** (one released gesture returns to waiting for the next);
  countdown and immediate recording are ONE-SHOTS that disarm on completion. Two different
  things on purpose.
- **Two hands, one take.** `Scene.js` dispatches tools through a single dominant active source
  but supplies the complete controller snapshot in `options.controllers`. **Read both snapshots;
  filtering by `options.handedness` silently discards the non-dominant trigger.** Multi-controller
  tools must also use the same STYLUS RAY convention as the active-controller path — a raw
  matrix -Z ray misses whenever stylus offset or tilt is configured, which made the first hand
  fall back to legacy Grab and left the second hand unable to acquire anything.
- **Grab's origin is the VISIBLE STYLUS TIP**, not the controller pivot or the spike base. Grab
  is proximity-based, so this is the difference between reaching what it looks like it is
  reaching and not.
- **Timeline focus and scene selection are deliberately ONE THING.** The last row, key or scene
  object clicked is the selected object everywhere. Two highlights that can disagree is the bug
  this prevents; Delete targeting stale key selections from another row was the symptom.
- **A pinned joint is addressed through its PIN** at selection and keying boundaries, so an
  overlapping joint marker cannot leave focus, or a key, on the driven bone. General selection
  deliberately does NOT resolve through pins — bones stay selectable for rig setup and for
  editing legacy bone animation.
- **Mirroring is SPARSE.** Only authored controls are reflected; an unkeyed knee is solver
  output and is rebuilt by IK rather than baked because it happened to be in the evaluated pose.
  A joint without a twin mirrors IN PLACE (hips travel metres, a spine carries real twist), but
  an unpaired tip below a paired hand rides the mirrored hand frame instead.
- **A full pin on the ROOT holds translation as well as rotation.** `holdPins` anchoring the
  root is right everywhere except when the pin is ON the root, where it discarded the pin's
  translation while its orientation still applied — the rotate-but-do-not-move behaviour.
- **The solver caps at 10 sweeps, not 40.** Complex full-body pin arrangements often cannot meet
  every target, and forty sweeps merely repeated a stalled solve at several times the cost.
  Visually indistinguishable in normal posing, and it keeps immersive playback live. The
  alternate-branch retry is now opt-in for the same reason.

---

## STILL OPEN

### 1. A JUDDER REGRESSION IN THE HEADSET — open, and the cause is NOT known

matt, 2026-08-24 on GalaxyXR: the app judders, **and it still judders with all bones and trails
disabled**. That last part is the important one and it was measured, not guessed.

**What it rules out.** Everything the motion-path work draws. The overlays were the first
suspect and alpha blending was removed on that theory (v3.20.34) — the colours improved, which
was worth having on its own, but the judder was never the blending. With trails off,
`MotionTrail.update` returns on its second line and the whole feature costs nothing.

**Do not repeat the mistake that got made here.** Three rounds went into the overlays on a
theory that was never measured. The next step is a MEASUREMENT, and the cheapest one that
actually discriminates is a bisect: matt calls it a regression, so it has a first bad version.
The range to bisect is roughly v3.20.9 (where this session's work starts) to v3.20.35, and a
build only has to be judged judder / no judder in the headset.

**Suspects worth holding lightly until then**, all things that run per frame REGARDLESS of the
trail flag, and all introduced in that range:
- `MotionPathEdit.strokeXR` is called from `Move.updateXR` and `Smooth.updateXR` on every frame
  in VR, whether or not a path exists.
- `Scene._updateStylusXray` gained `this._trailStrand` in its cache key.
- The per-frame allocations in `MotionTrail.recolor` and `drawGnomons` (a fresh `Float32Array`
  and a `.map()` per frame) — real GC churn at 72-90Hz, but only while trails are ON, so they
  cannot be this.

The last point is the shape of the whole problem: the obvious costs are all gated behind the
flag that was switched off. Whatever this is, it is somewhere else.

### 2. The rotation axis triads went missing (v3.20.34), fix UNCONFIRMED

Only the gnomons ever had their `resolution` set; `LineMaterial` clones its uniforms per
material, so the trail — converted to fat lines in v3.20.32 — was left at the default 1x1, which
divides a screen-space width by 1 instead of by a thousand. Fixed in v3.20.35 by routing both
through `pushFat`, which owns the resolution and the rebuild rule. **Nobody has seen the triads
come back.** `window._trailTrace` reports the gnomons' segment count, length and resolution.

### 3. Hard edges are now a known trade
Blending is off and this renderer runs `antialias: false` (MSAA breaks WebXR session start), so
`alphaToCoverage` has no coverage either. Fat lines are hard-edged. If that reads badly the
lever is MSAA, not blending.

### 4. Still not started
- **Editing rotation VALUES.** The triads exist so you can see what you would be twisting. The
  gesture: grab a point on the position path, the controller's twist drives the ROTATION keys,
  a Position/Rotation toggle on the Move MiniPanel choosing which. Smooth in rotation mode
  slerps each key toward its neighbours.
- **Key insertion on push-back.** A wiggle sculpted between two keys has nothing to carry it and
  vanishes on release. Measure the residual after push-back, insert a key at the peak, repeat —
  with a guard, or a noisy edit bakes a key per frame.
- **The orientation lock for Grab's desktop solve**, so Bone Draw's IK mode can be retired
  without desktop posing getting looser.
- **Split bone / dissolve bone** (matt, 2026-08-24, for later). Backlog #46. Insert a joint
  partway along a bone; remove a joint and rejoin its neighbours. Both are TOPOLOGY edits, and
  that is where the work is rather than in the geometry: a bound skin's weights, animation
  tracks keyed by object id, pins holding a joint by reference, and the SKEL block's parent
  indices all have to be told what happened.
- **`window._trailTrace`** was added for an unexplained report — a pin highlighted in the
  viewport would not trail, though selecting it in the outliner did. The sticky trail target
  probably masks it now; the cause is still unknown.

---

## HOW THIS CODE IS TESTED

`scratchpad/*.mjs`, run with `/opt/homebrew/bin/node`. Each reads the REAL source, strips
imports, prepends stubs — so the code under test is the shipped code. **Twenty-four harnesses**,
of which **twenty pass** — see STILL OPEN for the three long-standing failures.

Run the lot with:

```bash
for t in scratchpad/*_test.mjs; do printf '%-26s ' "$(basename $t .mjs)"; \
  /opt/homebrew/bin/node "$t" >/dev/null 2>&1 && echo PASS || echo FAIL; done
```

- `ik_test.mjs` — the solver, including the steering goal. Where solver work belongs.
- `skinbox_test.mjs` — the skin. Closed, manifold, consistently wound, one shell, no
  self-intersection, all quads, no stretched quads, mirror symmetry. Runs raw AND relaxed.
- `recording_test.mjs` — the take lifecycle: arm/start/stop, the transport clock, multi-target
  takes sharing one capture clock and one undo step, and the tap-is-not-a-take case.
- `mirrorpose_test.mjs` — sparse mirroring: which joints are controls, which are solver output
  that must be rebuilt, and the unpaired-trunk-reflects-in-place rule.
- `motiontrail_test.mjs` — the trail stays line-only and off by default.
- `glb_rig_export_test.mjs` — the rig survives a GLB export.
- `global_shader_test.mjs`, `browser_gallery_perf_test.mjs` — shading as a viewport preference,
  and the gallery decoding only the current page.
- `deltamush_test.mjs`, `skin_level_test.mjs` — bind level and the mush pass.
- `rigpick_test.mjs`, `transformopts_test.mjs`, `timeline_lane_test.mjs`, `graph_target_test.mjs`,
  `autokey_rig_test.mjs`, `skellock_test.mjs`, `stylusxray_test.mjs`, `gizmosize_test.mjs`,
  `bonepanel_test.mjs`, `bonescreen_test.mjs`, `keyrig_test.mjs`, `xfchannel_test.mjs`,
  `undef_test.mjs`, `module_load_test.mjs`.

**`module_load_test.mjs` earns its keep**: it is the only thing that catches an import cycle,
which it reports as *Class extends value undefined*.

### Standing lessons — every one of these cost time
1. **A passing test proves nothing until you have seen it fail.** Reintroduce the actual defect,
   and check the injection reproduced the RIGHT thing.
2. **A test can pass on the broken code and still feel rigorous.** The first skin harness
   checked edge counts — closed, manifold, consistently wound — and the chain-of-tubes version
   it was meant to condemn PASSED every one, because two tubes that merely pass THROUGH each
   other are each a perfectly good closed surface. Combinatorial manifoldness is blind to
   geometry. The checks that caught it were connected-shell count and face-face intersection.
   Ask what the defect actually IS before choosing what to assert.
3. **Do not declare a limitation before finding its cause.** Five-bones-in-a-row was written off
   as "too dense, out of scope" and matt was told so. The real cause was that a bone could be
   seated OUT OF SEQUENCE, and the fix — deal claims in bone order — made it work outright and
   deleted more code than it added. A limit you cannot explain mechanically is an unfinished
   diagnosis.
4. **Do not test a copy of the rule.** Behaviour checks that reimplement the logic locally pass
   happily with the shipped logic deleted. Lift the function body out of the source.
5. **Strip comments before a source guard.** Guards have matched the prose explaining why the
   code does NOT do the thing they forbade.
6. **Never bound a source slice by a character count.** Bound by braces.
7. **Assert the property, not a tally, and not a source SPELLING.** "Exactly 8 callers" breaks
   when a ninth legitimate caller appears — same reason the raw-cage overlap exemption is a flag,
   not a number. Fresh instance in v3.20.6: `bonepanel_test` pinned the exact line
   `const meshDisabled = mesh ? '' : ' disabled'`. The condition was later widened, correctly,
   from "a mesh is SELECTED" to "a mesh EXISTS", and the check reported correct code as a
   regression. It now asserts that the fieldset takes its disabled state from a variable that
   can evaluate to `' disabled'`, whatever that variable is called. Then v3.20.7 found FIVE more of the
   same shape in `rigpick_test`, one in `graph_target_test` and one in `recording_test` — each
   pinning a source spelling that a deliberate, better design change had moved. **A check bound
   to a spelling reports an improvement as a regression, which is worse than no check**, because
   it trains people to ignore the suite. Where the rule is arithmetic, LIFT IT AND EVALUATE IT.

---

## WAR STORIES — read before debugging anything

1. **Reading the code produced wrong answers; measuring produced right ones.** Repeatedly. When
   a symptom is unclear, add a flag-gated trace and ask for one run. It beats three rounds of
   "try this".
2. **`npm run bump:patch` CAN ROLL THE VERSION BACKWARDS.** `bump.mjs` reads `package.json` as
   its source of truth, and `package.json` had drifted 66 versions behind `Version.js` /
   `index.html`. A patch bump took v3.19.84 to **v3.19.19**. Repaired 2026-08-20 by resetting
   package.json and re-bumping. Check all three agree before trusting a bump — a deploy right
   after that would have failed the version guard for a reason nobody would have guessed.
3. **A bug you cannot find by reading may not be there.** The "browser save loses the skeleton"
   report survived a full trace of the save and load paths — every link was correct — and matt
   retested and it worked. Do not invent a cause to explain a report; ask for a retest or a
   trace.
4. **The selection is one gesture stale.** `currentMesh` at AutoKey time comes from the SCULPTING
   pick captured at stroke start, and tools update the app selection AFTER AutoKey has run. Use
   the tool's own synchronous report (`main._lastRigEdit`), never the selection.
5. **A debug flag can be load-bearing.** `console.log` is redirected to `screenLog` (a repaint),
   and the console changes frame timing. "Only works with debugging on" is a TIMING signal.
6. **Preselection must not disturb the pick.** `picking` is shared state; a hover pick every
   frame clobbers `_mesh`/`_interPoint`/`_pickedFace`. `Skeleton.hoverRigFromRay` snapshots and
   restores.
7. **Thresholds are not epsilons.** Move detection at `1e-9` is below float32 spacing. Now `1e-5`.
8. **Euler has a double cover** — both spellings must be compared when rebuilding from quaternions.
9. **The menu-guard path hands tools BUTTON-ONLY controllers** (`{handedness, buttons}`, no
   matrix, no ray). Anything reading a pose must guard for it.
10. **Same rule in N places is this project's signature bug.** When you fix one, grep for the others.
11. **A registry does not make a flag persist — the declaration does.** `Skeleton.DISPLAY_FLAGS`
    carried `pins` with its saved key `boneShowPins`, `bonePanel` drew its button, `Skeleton`
    read it, and it still reset on every load, because `getOptionsURL.js` never declared
    `boneShowPins`. Two halves that each look complete alone. Found by the harness in v3.20.6 —
    which is exactly why that check loops over the registry rather than counting flags.
11. **`Box3.setFromObject` ignores visibility.** Hiding an overlay does not keep it out of a
    bounding box. Thumbnail framing collapsed for a whole release because a hidden preview bone
    parked at the last controller position still counted. Detach, do not hide.

## SOLVER MAP (`src/editing/IKSolver.js`)
- `fabrik` — backward/forward sweeps. Subbase children move as ONE RIGID CLUSTER.
- `runSolve` — the sweeps plus one retry from the other branch.
- **The hinge is SEEDED, not clamped** — clamping made the solver oscillate (40x jitter, 270x
  pin drift). `window._ikHingeMode = 'clamp'` restores the old behaviour.
- `fitLocalRotation` — rotations built ABSOLUTELY from the child's constant local offset, not as
  a delta (deltas compose into parallel transport and come back rotated — the twist ratchet).
- `solve` — the interactive path. Pulls in pinned joints as extra targets; `rootFixed` is
  `targets.size <= 1 && eff !== root` (the second half is what makes the root grabbable). A
  driven orientation is DROPPED when a pinned joint is a direct child — see the findings doc.
- `holdPins` — re-solves pins after playback writes an interpolated pose. Root normally fixed —
  **except when the pin is ON the root**, where fixing it discards the pin's translation while
  its orientation still applies (rotate-but-do-not-move).
- **Soft pins are the pole vector.** A swivel about the axis through the two bracketing hard
  pins, run AFTER FABRIK, so the limb root above the steered joint is already solved and needs
  no pin of its own. Do not search upward for a hard target — that made an elbow with pinned
  hips swivel about the hip-to-wrist axis.
- **10 sweeps, not 40**, and the alternate-branch retry is opt-in. Activation is fixed for the
  duration of a solve, so traversal order and filtered child lists are built once.
- **Seeding has two modes**: `null` means an interactive drag (seed from the live pose, for
  continuity); an explicitly empty control set is an evaluation and restores every solver-owned
  joint first, which is what makes a frame independent of the route to it.
- `togglePin` / `pinOnA` — the shared A-button binding. `pinOnA` takes the TOOL as an argument
  because `SculptBase` cannot import `IKSolver` (cycle through `Skeleton` and the mesh stack).

## WORKING WITH MATT
He iterates fast and prefers a working thing to a designed thing. He finds the cases the harness
does not. Tell him plainly when something is unverified — he is not served by confident-sounding
guesses. When a fix cannot be verified locally, ASK FOR A TRACE EARLY rather than shipping
another guess. He is happy to answer a crisp design question with a recommendation attached; he
is not happy to be handed a survey of options with no opinion.

He also proposes architecture, and when he does it is usually right and usually SIMPLER than
what is there. World-aligned boxes and the whole-face extrude were both his, and both deleted
more code than they added. Engage with the proposal on its merits before defending the build.
