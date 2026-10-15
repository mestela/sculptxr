# Make Skin: joint rotation, shaper joints, negative joints

Agreed with matt 2026-09-30. Code: `src/editing/SkinMesh.js`.

## Order

1. **Joint rotation**: BUILT v3.69.25 (uncommitted, awaiting headset test).
2. **Shaper joints + ring carry**: they have to ship together.
3. **Negative joints**: automatic, cavity only.

Parked: **the chest pinch.** matt couldn't reproduce it (the base topology relaxing back from a
forced shape). If it comes back, the first test is an A/B on
`window._boneSkinClampMode='support'; window._boneSkinClamp=0.55`.

## 1. Joint rotation (built)

- `_jointRot`: a model-space quaternion `[x,y,z,w]`, separate from the pose. Unset/identity is
  stored as nothing. API: `Skeleton.jointRot / jointRotIsSet / setJointRot / jointQuat /
  mirrorRot / centrelineRot`. The scale runs along the joint's own axes; the offset stays in model
  space.
- Every shape consumer reads it:
  - `boxAt` (bone directions go into the box frame, so claims are unchanged), with `latticePoint`
    placing the lattice
  - `capsuleTarget` (relax, nlerp between the two ends' frames)
  - `Skinning.envelopeT2` / `boneSegments` (bind, mesh-local)
  - `WeightCage.capsuleGeometry`
  - the capsule preview: the caps via the slot quaternion, the shaft via `aRA`/`aRB` in both GLSL
    and TSL
  - the Tweak Joint dots, `SkinMesh.attachments` + the `SkinPreview` hash, and
    `RigTopology.copyJoint` (reflected)
  - SKEL v19
- UI: three rotation rings in Tweak Joint (X/Y/Z in the joint frame). A centreline joint only gets
  the X ring. The twin takes the mirrored rotation, the face drag works along the turned axis, a
  single undo step covers each drag, and there's an "Unrotate" button beside Sharpness.
- Verified:
  - 40/40 random unrotated rigs are bit-identical to the old builder.
  - Whole-rig equivariance is checked in `skinbox_test`.
  - Found along the way: the HAND fixture's build sits on a tie. A 1e-7 rad turn changes which
    faces pair up, and this predates rotation.

## 2. Shaper joints (slide along the bone)

- `_shapers: [{ t, radius, scale, offset, rot }]` on the CHILD joint. They're not joints: no
  outliner, IK, keys or physics. Position = `lerp(parent, child, t)`, default `t = 0.5`, slidable.
- Make Skin splits parent → shaper(s) → child before `buildArrays`, using proxies that answer the
  same shape questions a joint does.
- The bind maps the split segments back to the ORIGINAL bone.
- **RING CARRY ships with it**: a joint with one bone in and one out, on opposite faces, emits a
  ring instead of a box. Otherwise every shaper adds 8 valence-3 corners.

## 3. Negative joints: DROPPED (2026-09-30)

A pocket was built and worked on a plain head, but on biped2 it funnelled the whole lower face into
a mouth that only just broke the surface. matt then decided he'd rather sculpt a mouth, and that
what he actually wants is a jaw. Removed completely. What replaced it:

- **Shapes Skin** (per joint, default on, SKEL v20 `_noSkinShape`). When it's off, Make Skin skips
  the joint and joins its children to the nearest ancestor that does shape the skin. The joint
  still binds and deforms.
  - Use it for a jaw, or for a twist bone in the middle of a chain.
  - Switching it off gives exactly the same skin as never drawing the joint (checked in
    `skinbox_test`).
- **A bind that follows rig edits** (`Skinning.syncJoints`, checked once a frame in
  `Skinning.update`).
  - Joints that survive keep their inverse bind.
  - A new joint's bind frame is its nearest bound ancestor's bind frame multiplied by where the new
    joint sits relative to that ancestor now, so it's right even on a posed rig.
  - Removed joints drop out, and the weights re-solve at the bind pose.
  - Checked in `scratchpad/rebind_test.mjs` (the `RB_INJECT=posebind` injection makes it fail).
- **Buried joints** (`layoutCages`): a joint with children whose centre sits inside its parent's
  shape has its cage box built just outside the parent's surface, moved the way the limb
  continues. This fixed the biped2 shoulder crease, and the hips go from 37 self-intersections
  to 0. `window._boneSkinEmbed = false` is the A/B switch; delete it once matt picks one.
