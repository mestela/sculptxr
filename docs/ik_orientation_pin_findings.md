# Rig findings: where the pin loses (v3.19.61–68)

Findings from the 2026-08-19 session on the VR rig tools. Kept because most of them are
non-obvious from the code, and two of them are things that had already been "explained"
wrongly, confidently, more than once.

**The through-line: every wrong answer this session came from reading the code, and every
right one came from measuring it.** Four times the harness contradicted a confident
explanation — twice mine, once matt's, once a fix that was right in aim and too broad in
scope.

Commits: `c2d4379a`, `1c30ac5a`, `bc2cc432`.

---

## 1. A driven orientation makes the children rigid, so a pin one bone down has nothing left to give

**Symptom.** Grab a knee with the ankle pinned and the whole leg moves as one piece. The foot
is carried off its pin; the torso swings to absorb the rest. It looks exactly like the solver
was skipped in favour of plain FK.

**Two wrong explanations first.**

1. Mine: "you're in FK mode, which edits the rest skeleton and never calls the solver."
   Plausible from the source comments, and it did not explain why the hips behaved differently
   in the same mode.
2. Matt's: "moving the knee bypasses the solver." Reasonable from the outside, also false.

**What settled it** was a trace behind the existing `_ikTrace` flag, rather than a third theory:

```
[+17.2ms] [ik] solve eff=bone_02_L targets=3 pins=2 rootFixed=false orient=1
```

The solver *was* running. `orient=1` is the tell.

**Mechanism.** The headset always sends an orientation — the controller carries 6DOF. Driving
it sets `eff.rot`, whose stated purpose in `IKSolver`'s own comments is to make the effector's
**immediate children rigid with it**. For a hand or a foot that is the feature: the limb keeps
the orientation you are holding it at. One bone above a pin it is fatal — with the knee's
position *and* orientation both driven, the ankle's position is a rigid function of them and
the pin has no freedom left to work with.

Ankle displacement from its pin, identical knee drag:

| driven rotation | before | after  | knee's own error |
| --------------- | ------ | ------ | ---------------- |
| position only   | 0.0000 | 0.0000 | 0.0000           |
| + 10°           | 0.7954 | 0.0000 | 0.0000           |
| + 30°           | 1.1020 | 0.0000 | 0.0000           |
| + 60°           | 1.4964 | 0.0000 | 0.0000           |

The knee reaches its target in every row.

**Fix.** When a pinned joint is a **direct child** of the effector, the pin outranks the
orientation. A pin is an explicit statement about where something stays; the wrist rotation
that arrives free with a 6DOF grab is not a statement about anything.

## 2. Scoped to a direct child, not any descendant — the harness found the difference

The first version dropped the orientation whenever *any* pinned descendant existed. It passed
the new tests and broke three old ones: the hips twist, where the feet are pinned three bones
down and are supposed to stay planted while the body turns above them. That case is the mirror
image of the knee, and killing the orientation there removes a feature.

The distinction is **slack**. A driven orientation rotates only the immediate children; deeper
joints reach their positions through their own solved rotations, which stay free.

```
  PINNED CHILD — over-constrained        PIN FURTHER DOWN — slack absorbs it

      hip  o                                 hips o  (driven)
           |                                      |   rigid
           |                                      |
     knee  O  (driven)                      knee  o  free
            \  rigid (shin)                        \
             \                                      \
     ankle    <>  (pinned)                 ankle     o  free
                                                      \
                                            foot       <>  (pinned)
```

`IKSolver.pinnedChild()` is the whole gate. The pin only loses when there is no free joint
between it and the hand.

## 3. A pin does not limit the knee's reach — it confines the knee to a surface

Written expecting the knee to land wherever it was dragged, a harness case failed twice, and
the solver was right both times.

The ankle is **one bone** below the knee, so pinning it puts the knee on a **sphere** centred
on the pin with radius equal to the shin. That is an equality, not a reach limit: a drag to any
point off that sphere is projected onto it, whether it was too far *or too near*.

Fix the hip as well and the knee lies on the intersection of two spheres — a **circle** about
the hip-to-ankle axis. That circle is the classic pole-vector parameter, and it is already
present in the rig; nothing currently steers where on it the knee rests.

Related: pull past what the chain can satisfy and `clampToPins` gives way on the **drag**, not
the pin. Deliberate — a pin that slides when you pull hard enough is not holding anything — but
it is why an elbow pin can feel like it has "too much influence".

---

## 4. Five smaller traps, each one idea repeated in the wrong place

- **Anchored against its own drag.** The solver fixes the root when nothing else is pinned, or
  the whole character follows your hand. It did that even when the root *was* the joint you
  grabbed, so the root bone would not move — which reads as a lock, not an anchor. Now
  `targets.size <= 1 && eff !== root`.

- **Pins outrank bones in the pick.** A pin sits exactly on its joint and wins the ray (higher
  rank, wider cone), so the moment you pinned a joint the bone preselection went to −1 and the
  A button died on that joint specifically: you could pin once, then never cycle or unpin.
  `Skeleton.hoveredJoint` now resolves a hovered pin through `_pinnedJoint`.

- **Caching the intent, not the write.** `Scene._updateStylusXray` recorded "I showed the
  ghost" before checking whether there was a ghost to show. Controllers are assigned on a
  `connected` event, so entering VR with Transform already active recorded success, and the
  early return then skipped every retry for as long as the tool stayed selected.

- **A sentinel that hard-codes the default into every reader.** `window._boneShowX !== false`
  means "default on", written out at eight call sites across five files. Changing a default
  meant finding all of them, and missing one leaves a flag that is on in the viewport and off
  in the panel. Replaced by `Skeleton.DISPLAY_FLAGS` — one registry, name → [live global, saved
  option, default].

- **Rebuilding what a matrix could scale.** The obvious hook for gizmo resizing (`_resize`)
  rebuilds all fifteen primitives and disposes none of them — about 33 rebuilds a second under
  a thumbstick. `gizmoSizeMul` already existed as a matrix scale, and the pick geometry rides
  the same matrix.

## 5. The obvious home for the shared helper was the one place it could not live

Three tools now bind the A button, so the binding belonged on `SculptBase`. But `SculptBase`
cannot import `IKSolver` — it reaches `Skeleton` and the whole mesh stack, and the cycle leaves
`SculptBase` undefined at the moment the tools extend it. `module_load_test.mjs` reported it
immediately as *Class extends value undefined* on all three tools.

Inverted: the binding lives on `IKSolver` and takes the tool as an argument, so nothing new
points back at the tools. There is a guard asserting `SculptBase` never imports the rig,
because putting it back is the tidy-looking refactor.

## 6. What the harness caught that review would not have

Every new guard was run against a reintroduced defect before being trusted. Three failures of
that discipline are worth naming:

- **An injection that reproduced nothing.** A defect meant to prove a guard was placed *before*
  the early return rather than after it. The test passed, proving only that the wrong thing had
  been broken.
- **Three guards matched their own commentary.** A source check for "this code must not call X"
  kept hitting the comment explaining why the code does not call X. Every such guard now strips
  comments first — a test that cannot tell code from prose reports the fix as the bug.
- **Two stubs carried stale defaults.** `bonepanel_test` and `bonescreen_test` stub `Skeleton`;
  both now parse the real `DISPLAY_FLAGS` out of the source instead of retyping its values, and
  one had to mirror the accessor's window-first precedence to stay honest.

---

## 7. Keying a rig node: the registry was never the obstacle

*(Added with v3.19.69–70, after the above.)*

A bone and a pin are ordinary meshes with ordinary transform tracks, and `keyTransforms` has
always keyed them generically — the Key Pose button proves it. Two **gates** in front of AutoKey
were the whole problem, each wrong for a different reason:

1. **It asked which tool was active.** `isMove` was `TRANSFORM/TRANSFORM_VR || GRAB`, so posing
   under the Bones tool fell through to the SHAPE-key branch. Symptom: "auto mode keyframes the
   skin". Now the gate asks what MOVED — a bone and a pin carry a transform and no shape, so a
   transform key is the only kind that means anything for either.
2. **It keyed the current selection, which is stale.** `currentMesh` comes from
   `_vrSculptMesh`, captured at stroke start from the SCULPTING pick — before Grab or Transform
   run their own rig-aware pick, and before the Bones tool's `_selectLater` (a `setTimeout(0)`
   that deliberately leaves the XR frame, because selecting inside it re-enters render and
   cancels the grab). So AutoKey was reading the wrong pick entirely.

Fixed by having every tool that can take a rig node record it **synchronously** at the moment
it takes hold (`main._lastRigEdit`), which AutoKey reads and clears. Fixing only the bones tool
was not enough and looked like a fix: Grab kept keying the skin, because the gate change alone
does nothing when the fallback is never populated.

Assigned unconditionally, so grabbing an ordinary object clears it — otherwise AutoKey being
off lets a bone from an earlier grab sit there and be keyed much later.

Playback already had the other half: writing a keyed bone sets `_ikPinsDirty`, so the pins
re-solve once after every joint has been written.

---

## Still open

- **The solve carries history.** Controls-only keying — key the pins and the hips, let the
  solver fill in the rest — needs the solve to be a pure function of (rest skeleton, control
  values). It is not. Same pins, same hip target, three different routes to the same frame:

  | arrived at the frame | knee position | distance from the "from rest" answer |
  | -------------------- | ------------- | ------------------------------------ |
  | from rest            | −0.064, 1.998, −0.018 | — |
  | via one other frame  | −0.054, 1.997, −0.049 | 0.032 |
  | via two other frames | 0.338, 1.910, 0.240   | **0.487** |

  The controls are satisfied every time (hips exact, ankle holds its pin to 0.0002) and the knee
  still lands half a bone-length apart. FABRIK seeds each solve from the current pose. Until
  that is seeded from rest (or a stored reference pose) for *evaluation*, a scrub and a playback
  will disagree. Note it may need to stay seeded-from-current while DRAGGING, since continuity
  is part of why interactive dragging feels smooth.

- **Cross-limb drift.** Posing the right knee re-solves the left one, which settles back to
  where the solver thinks it belongs. `buildGraph` walks the whole skeleton and `markActive`
  lights every chain leading to a target: the solve is global, the intent is local.

- **Pole vector via per-joint weights** (matt's idea, and better than a dedicated pole object).
  Not a soft pin but a *priority* ordering: a hard ankle goal and a low-weight knee goal, so
  the knee only steers the freedom the ankle leaves. That leftover freedom is exactly the
  circle in §3 — and removing that freedom is also part of what makes the solve reproducible,
  so this and the determinism item are more entangled than they look.
