# Implementation Plan: IK pins as first-class scene objects

**Status**: design only, nothing built. Supersedes nothing; extends the rigging work at v3.19.25.
**Origin**: matt, 2026-08-18 — "if pins became actual items in the world vs a transient item/state
that only exists within the pose tool, we could use them for proper animation, as other aim
controllers, it's a constraint essentially."

## The idea in one line

A pin stops being two bits of state on a joint and becomes a null in the scene that the joint is
constrained to.

## Why this is the right shape

It is what the production systems do. Maya's IK handle IS a scene object with a transform, which
is why Autodesk's answer to "my pinned foot slides during playback" is *set an IK key on the
effector* — an effector you can key is an effector that is an object. Unreal's Control Rig
controls are the same thing. We arrived here from the opposite direction, which is a good sign.

It is also mostly built already:

- **Nulls are first-class.** `Scene.addNull()` (Scene.js ~2230) makes a transform-only locator
  with a cruciform gizmo, `_isNull = true`, pickable by VR ray but skipped by sculpt brushes.
- **A per-frame constraint pass already runs.** `_evaluateConstraints()` (Scene.js ~2266, called
  from ~1686) walks meshes carrying `_lookAtTargetId` and aims them at a target, in model space,
  before render. The eye rig uses it.
- **Joints are already nulls.** `Skeleton.js:516` — `_isNull = true; // transform-only locator:
  reuses the null constraint/eval paths`.

So this is less "add a constraint system" than "notice we have one and move pins into it".

## What it fixes that is broken today

1. **Pins do not survive saving.** `IKSolver.pinAnchor` falls back to the joint's live position
   because the anchor is never serialised — only the pin MODE is, packed into spare bits of the
   SKEL v2 hierarchy flags. Load a saved rig and every pin silently re-anchors to wherever the
   joint happens to be. As objects, pins serialise through the normal mesh path.
2. **Pins cannot be keyed**, so `IKSolver.holdPins` has to treat them as constant for the whole
   timeline. A foot that plants at frame 10 and releases at frame 40 cannot be expressed. As
   objects they get transform tracks from the existing animation system and this simply works.
3. **The gizmo/mode problem dissolves.** No mode, no second gizmo, no modifier key: a pin is an
   object, so you select it and transform it like anything else. This is the whole reason the
   idea came up.
4. **A class of bug becomes unrepresentable.** `setPin` carries careful "only anchor on the way
   IN" logic because re-reading the joint's live position made pins ratchet upward with a jumping
   character. If the pin IS a transform, there is nothing to re-read and the bug cannot be
   written.

## Data model

Follow the precedent the look-at constraint already sets — the CONSTRAINED object points at its
target, not the reverse:

- `joint._boneIKPinId` — id of the pin null, or null/absent for unpinned. Mirrors
  `mesh._lookAtTargetId` exactly.
- `pin._isPinTarget = true`, `pin._pinMode` — 1 (position) or 2 (position + orientation). Mode
  moves OFF the joint and onto the pin, because it is a property of the constraint, not of the
  bone.
- The pin's model-space transform IS the anchor. `pinAnchor()` / `pinAnchorQuat()` become reads
  of that transform, and all the capture-once logic in `setPin` is deleted.

Default parent is the world. Parenting a pin under something is then a real feature — a foot
pinned to a moving platform — and also a footgun worth documenting.

## The solver barely changes

This is the part that makes it cheap. `IKSolver.solve` and `holdPins` already consume pins
exclusively through `pinnedJoints()` / `pinAnchor()` / `pinAnchorQuat()`. Re-point those three at
the pin object and the sweeps, the branch seeding, the hinge and the write-back are all untouched.

`IKSolver.solve(main, effector, target, pins, orientation)` keeps its transient `pins` argument
unchanged — see "not changed" below.

## Phasing

**Phase 1 — pins as objects.** No generalisation. Create/destroy the null on pin cycle; re-point
the three accessor functions; move the triad/gimbal/leader drawing to key off the pin's transform
rather than the joint's; SKEL v3 for the link; load-time migration. Closes all four items above.

**Phase 2 — one constraint list.** Fold `_lookAtTargetId` and the IK pin into a single
`mesh._constraints` array evaluated by one pass, so aim/orient/parent constraints are the same
kind of thing. Do this only after Phase 1 has shown what the shape wants to be; a generic system
designed first will be wrong in ways not yet visible.

**Phase 3 — optional.** Offsets, weights, constraint blending.

## Migration

`SKEL_VERSION` is 2 and the loader already guards `if (ver > SKEL_VERSION) return;`, so bump to 3
and add a pin-target index per hierarchy entry. Old files still carry the pin MODE bits: on load,
for each joint with pin bits set, create a pin null at that joint's saved model transform. That is
exactly what `pinAnchor`'s current fallback does, so old files land where they do today — no
behaviour change, and they save forward into the new form.

## Risks and costs

- **Outliner clutter.** Eight pins is eight new rows. Wants grouping (a "Pins" group), a filter,
  or hiding pins from the outliner by default with a toggle. Needs a decision before Phase 1
  ships, not after.
- **Dangling references.** Deleting a pin object while a joint points at it. The look-at
  constraint has the same hazard and whatever it does should be reused.
- **Undo.** Pin cycle currently flips bits; it will become create/delete of a scene object. The
  existing `pushStateCustom` pattern covers this, and `capturePins`/`restorePins` will need
  rewriting to snapshot objects rather than flags.

## Explicitly NOT changed

- **Bone modes stay.** Constraints answer *what holds a joint*; modes answer *what a drag on a
  joint does* — solve (IK) versus edit the rest skeleton (Tweak). Different questions. Pins as
  objects replaces the pin STATE, not the mode.
- **Transient two-handed pinning stays transient.** A joint held in the other hand should not
  spawn a scene object; `IKSolver.solve` already takes a transient pin list for exactly this.

## Dependency worth knowing

The animation payoff in item 2 above is only half-usable until the graph editor exposes rotation
and scale channels. `GuiTimeline.js:743` returns `tr.positions[...]` as a transform key's editable
value, so today the curve editor shows translation only. Keyed pins would at least be positional,
so Phase 1 is still worth doing first — but "pins you can animate" and "curves you can edit" want
to land close together.
