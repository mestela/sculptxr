# Handover Prompt (Protocol Enforced)

**Project Status**: Rigging and rig animation are shipped and working. Bones and pins are
ordinary keyable scene objects; the VR gizmo poses through the solver; the animation editor
treats a bone like any other object. Two NEW features are next, both named by matt.
**Current Working Directory**: `/Users/mattestela/sculptxr`
**Checkpoint**: Nothing is mid-flight. Start on the pole vector (read the blocker first) or on
`SkinMesh` (wait for matt's description).

## MANDATORY reading
You MUST read `project_rules.md`, `overview.md` and `docs/code_summary.md` before responding.
NO EXCEPTIONS. Every response starts with `Step Id: {id}`. Never commit, push or deploy unless
asked.

**Also read `docs/ik_orientation_pin_findings.md` before touching the solver.** It records what
was tried, the numbers, and why the fixes are scoped the way they are. It will save you from
re-deriving three things the hard way.

## Deployed Version
- **Local / Prod / origin**: all at **v3.19.84** (`1c8473a8`). Working tree clean, nothing
  unpushed, nothing uncommitted.
- **Beta**: v2.9.0 (stale, ignore).

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

---

## THE TWO NEXT FEATURES

### 1. Pole vector — but fix determinism first

matt's design, and better than a dedicated pole object: **per-joint weights as a priority
ordering**. A hard ankle goal and a low-weight knee goal, so the knee only steers the freedom
the ankle leaves.

That freedom is real and measured. A pinned ankle is ONE bone below the knee, so it does not
merely limit the knee's reach — it confines the knee to a SPHERE about the pin (an equality,
not an inequality; a drag to any point off it is projected onto it, whether too far or too
near). Fix the hip as well and the intersection is the classic pole-vector CIRCLE.

**BLOCKER, and it is not optional:** the solve is not a pure function of (rest skeleton,
control values). FABRIK seeds each solve from the current pose, so the pose carries history.
Same pins, same hip target, three different routes to the same frame:

| arrived at the frame | knee position | distance from the "from rest" answer |
| -------------------- | ------------- | ------------------------------------ |
| from rest            | −0.064, 1.998, −0.018 | — |
| via one other frame  | −0.054, 1.997, −0.049 | 0.032 |
| via two other frames | 0.338, 1.910, 0.240   | **0.487** |

The controls are satisfied every time (hips exact, ankle holds its pin to 0.0002) and the knee
still lands half a bone-length apart. Until evaluation is seeded from the rest pose (or a
stored reference pose), a scrub and a playback will disagree and keyed controls will not
reproduce. Note it probably needs to stay seeded-from-current while DRAGGING — continuity is
part of why interactive dragging feels smooth — so expect two seeding modes, not one change.

Reproduce it with `scratchpad/_ik_gen.mjs` (the generated real-solver module `ik_test.mjs`
builds); the probe that produced the table above is trivial to rewrite.

### 2. Mesh from skeleton — "Make Skin" should make a better mesh

`src/editing/SkinMesh.js`, wired to the `Make Skin` button in `gui/bonePanel.js`.
**matt will describe what "better" means — ask before designing.**

What it does today, from its own header comments: quad **tubes along CHAINS** at the capsule
radii you already tuned, one continuous tube per chain so an elbow is just a bend in it (a
capsule per bone would leave interpenetrating shells at every joint). The documented weakness
is almost certainly what he means:

> Branch points ARE left interpenetrating: the tubes for two clavicles leaving a spine each cap
> themselves off inside the other. Resolving junctions properly is the hard part of every skin
> modifier ever written... This is a blockout, not a model.

## STILL OPEN (from the findings doc)
- **The solve carries history** — see the blocker above.
- **Cross-limb drift**: posing the right knee re-solves the left one, which settles back to
  where the solver thinks it belongs. `buildGraph` walks the whole skeleton and `markActive`
  lights every chain leading to a target: the solve is global, the intent is local.
- **A Key Pose on a thirty-joint rig is now thirty dopesheet rows.** The fold that hid them was
  removed deliberately (its keys drew, highlighted, and could not be selected). If Key Pose
  becomes central again, the fix is to make a summary row RESOLVE to its joints — click selects
  the pose, drag retimes it together — rather than hide them.

---

## HOW THIS CODE IS TESTED

`scratchpad/*.mjs`, run with `/opt/homebrew/bin/node`. Each reads the REAL source, strips
imports, prepends stubs — so the code under test is the shipped code. Sixteen harnesses:

- `ik_test.mjs` — the solver. Where solver work belongs. Has the root-grab, knee+pin and driven
  orientation cases.
- `rigpick_test.mjs` — cone geometry, mouse/VR pick parity, Transform/TransformVR parity.
- `transformopts_test.mjs` — the free-rotate handle and the A-button pin binding.
- `timeline_lane_test.mjs` — lane height, the dopesheet scroll, marquee reach, key colour.
- `graph_target_test.mjs` — what the graph editor graphs and how it is set.
- `autokey_rig_test.mjs` — AutoKey's two gates and the three take-hold sites.
- `skellock_test.mjs` — a REAL round trip through the shipped SKEL serialize/deserialize.
- `stylusxray_test.mjs`, `gizmosize_test.mjs`, `bonepanel_test.mjs`, `bonescreen_test.mjs`,
  `keyrig_test.mjs`, `xfchannel_test.mjs`, `skin_level_test.mjs`, `undef_test.mjs`,
  `module_load_test.mjs`.

**`module_load_test.mjs` earns its keep**: it is the only thing that catches an import cycle,
which it reports as *Class extends value undefined*.

### Standing lessons — every one of these cost time THIS session
1. **A passing test proves nothing until you have seen it fail.** Reintroduce the actual defect,
   and check the injection reproduced the RIGHT thing: one removed a call from the wrong site
   and another landed before an early return rather than after it, so both "passed" while
   proving nothing.
2. **Do not test a copy of the rule.** Behaviour checks that reimplement the logic locally pass
   happily with the shipped logic deleted. Lift the function body out of the source and evaluate
   it.
3. **Strip comments before a source guard.** Three guards matched the prose explaining why the
   code does NOT do the thing they forbade.
4. **Never bound a source slice by a character count.** A fixed 2600-char window truncated the
   block the moment a diagnostic was added, failing two checks on correct code. Bound by braces.
5. **Assert the property, not a tally.** A check for "exactly 8 callers" broke when a ninth
   legitimate caller appeared.

---

## WAR STORIES — read before debugging anything

1. **Reading the code produced wrong answers; measuring produced right ones.** Four times this
   session a confident explanation was contradicted by the harness or a trace — twice mine, once
   matt's, once a fix that was right in aim and too broad in scope. When a symptom is unclear,
   add a flag-gated trace and ask for one run. It beats three rounds of "try this".
2. **The selection is one gesture stale.** `currentMesh` at AutoKey time comes from the SCULPTING
   pick captured at stroke start, and tools update the app selection AFTER AutoKey has run. Any
   code that wants "what did the user just take" must use the tool's own synchronous report
   (`main._lastRigEdit`), never the selection.
3. **A debug flag can be load-bearing.** `console.log` is redirected to `screenLog` (a repaint),
   and the console changes frame timing. "Only works with debugging on" is a TIMING signal.
4. **Preselection must not disturb the pick.** `picking` is shared state; a hover pick every
   frame clobbers `_mesh`/`_interPoint`/`_pickedFace`. `Skeleton.hoverRigFromRay` snapshots and
   restores.
5. **Thresholds are not epsilons.** Move detection at `1e-9` is below float32 spacing, so it
   reported a move on every comparison. Now `1e-5`.
6. **Euler has a double cover** — both spellings must be compared when rebuilding from
   quaternions.
7. **The menu-guard path hands tools BUTTON-ONLY controllers** (`{handedness, buttons}`, no
   matrix, no ray) so face buttons keep working while a panel is under the ray. Anything reading
   a pose must guard for it; Grab did not, and threw once per frame for a whole session.
8. **Same rule in N places is this project's signature bug.** Found again three times this
   session: lane height in five places, the dopesheet scroll clamped in the drawing but not the
   hit tests, and a marquee collector indexing the registry's map with dopesheet row numbers.
   When you fix one, grep for the others.

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
- `holdPins` — re-solves pins after playback writes an interpolated pose. Root always fixed.
- `togglePin` / `pinOnA` — the shared A-button binding. `pinOnA` takes the TOOL as an argument
  because `SculptBase` cannot import `IKSolver` (cycle through `Skeleton` and the mesh stack).

## WORKING WITH MATT
He iterates fast and prefers a working thing to a designed thing. He finds the cases the harness
does not. Tell him plainly when something is unverified — he is not served by confident-sounding
guesses. When a fix cannot be verified locally, ASK FOR A TRACE EARLY rather than shipping
another guess. He is happy to answer a crisp design question with a recommendation attached; he
is not happy to be handed a survey of options with no opinion.
