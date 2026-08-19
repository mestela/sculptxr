# v3.19.83
**The animation editor learns about rigs.** Keying a pose used to mean one button and one
all-or-nothing row; a bone is now an ordinary keyable object, and the editor treats it like one.

- **AutoKey keys a bone or a pin.** The gate asked which TOOL was active, so posing under the
  Bones tool fell through to the SHAPE-key branch and keyed the skin. It asks what MOVED now.
- **...and keys the node you actually took.** The selection is updated after AutoKey has run,
  so it is reliably one gesture stale — grab left pin, right pin, root and the keys landed on
  root, left, right. Every tool that can take a rig node now reports it synchronously.
- **A keyed bone gets its own dopesheet row.** Joint tracks were folded into one synthetic row
  per skeleton whose id resolved to no track: the keys drew, and highlighted, and could not be
  selected, dragged or deleted. Pins were never folded, which is why they behaved and bones
  did not.
- **The marquee reaches the first and last keys in time.** It tests a key's centre, and at the
  two ends the centre is unreachable — the first key sits under the row-name gutter, the last
  at the canvas edge. Transform keys were also gathered by indexing the registry's map with
  dopesheet row numbers, which are a different list.
- **Clicking a row or a key drives the graph editor**, rather than having to select the object
  in the 3D view first — and the target is now visible: the row's name turns yellow and the
  graph names what it is showing.
- **Mouse-up always releases the drag.** A throw left every drag flag set, so the marquee never
  closed and the playhead followed the cursor for ever.
- Plus the dopesheet's lane height is capped (a tall panel stretched three rows to fill it),
  one clamped scroll value shared by the drawing and the hit tests, and a fix for Grab throwing
  every frame when the trigger was held while pointing at a panel.

# v3.19.72
**Rig ergonomics.** The VR transform gizmo reaches the rig, and the rig gets out of the way.

- **The gizmo picks bones and pins.** `TransformVR` had no pick of any kind — it transformed
  whatever was already selected — so a bone could not be reached in VR at all. It now
  preselects on hover and selects on press, sharing both with Grab.
- **A dragged bone poses the rig.** The gizmo hands the joint to the solver as a request rather
  than writing its matrix, which would edit bone LENGTH. Undo snapshots the whole skeleton,
  because a solve reaches anywhere in the tree.
- **A pinned child outranks a driven twist.** A driven orientation makes the effector's
  immediate children rigid with it — right for a hand, fatal one bone above a pin, where it
  dragged the foot off its pin by up to 1.5 units. Scoped to a pinned DIRECT child: hips with
  pinned feet still twist, because the knee and ankle between them absorb it.
- **A pinned ankle confines the knee to a sphere**, not a reach limit — the freedom a pole
  vector would steer. Documented in `docs/ik_orientation_pin_findings.md`.
- **The thumbstick resizes the gizmo** while Transform is active (it is sized for objects and
  swamps a bone), the centre handle can optionally carry rotation as well as position, and
  **A pins the joint under the ray** in Transform and Grab, the same press the bone tool uses.
- **A bound mesh is locked out of viewport selection** and stays locked across a save, so the
  ray reaches the joints inside the character instead of the skin. Unbind hands it back.
- Bone capsules and weight colours default OFF, and every bone display flag persists.

# v3.19.54
**VR grab preselection works.** Three bugs stacked on top of one another, which is why it kept half-working and why two false leads (dev versus production, and a debug flag) looked convincing.

- **The hover ray was in the wrong space.** `updateXR` is handed `origin`/`dir` by Scene, already in engine space; the hover derived its own from the controller matrix — the raw WebXR frame — so the pick missed every mesh on every frame.
- **The hover never asked for a redraw**, so its work never reached the screen. This is why turning the trace ON appeared to fix it: `console.log` is redirected to `screenLog`, and the logging was performing the repaint.
- **It was far too expensive** — a full ray pick against every mesh plus a skeleton visual rebuild, ninety times a second. Merely attaching the remote console changed the frame budget enough to alter the outcome. Now throttled to about 15Hz (`window._grabHoverMs`), with the redraw tied to the highlight actually changing. Preselection does not need 90Hz; a hand does not move that fast.

**The lesson worth keeping**: "only works with debugging enabled" is a timing signal, not a mystery. Both false leads were the same cost problem wearing different hats.

# v3.19.51
**Full-body IK becomes a controller, not a mode.** The skeleton is now driven by the solver rather than posed directly: grab a bone with a hand or the mouse and it states where that joint should END UP, with every pin holding and the rest of the rig rearranging around it. Pins became objects in the scene, so they can be selected, dragged with the gizmo, saved and (next) keyed.

- **Pins are scene nulls.** A joint holds a direct reference, the same shape `_boneMirror` uses. The pin's TRANSFORM is the anchor, which makes the old ratcheting bug unrepresentable rather than carefully avoided — there is nothing to re-read. Moving a pin re-solves the rig; the transforms are watched each frame rather than the gizmo hooked, so undo, a keyed pin and a console poke all count. Pins are named after the bone they constrain (`pin_bone_03_R`) and survive saving (SKEL v3).
- **Bones and pins are selectable and grabbable**, on desktop and in VR. They are picked as points in a CONE rather than by ray-vs-geometry: a joint's pick sphere is a fraction the size of the marker you see, so the old behaviour meant aiming at an invisible object. Pins get a wider cone than bones, because ranking alone only decides ties — with equal cones a bone at the edge is as catchable as the pin sitting on it. A rig node beats a mesh whenever one was asked for, since the skeleton lives inside the sculpt.
- **A VR grab carries orientation as well as position.** The driven orientation is a constraint, not a decoration: the joint's children are carried by it, so twisting the hand twists the limb and the pins re-solve against where it lands.
- **The mouse and VR picks are separate functions**, and every rig change had to be made in both. Missing that is why VR selection lagged the desktop by three versions; `rigpick_test` now asserts the same four properties per path.
- **Known gaps**: a VR grab's undo restores only the grabbed joint, not the posed chain. The VR hover pick runs every frame against every visible mesh and may want throttling on a heavy scene.

# v3.19.48
**Orthographic is correct, and grab works in it.** `getOrthoZoom` read `_trans[2]` as a distance, but `setPivot` stores it pre-multiplied by `fov/45` — 1.8x at an 81-degree fov, which was the size jump on toggle. The corrected formula reproduces the old hand-tuned `0.00055` at the fov and canvas that constant was calibrated for, which is the proof it was this formula all along, frozen at one viewport.

- Grab's `start()` rebuilt its anchor with a perspective-only formula while `update()` intersects a plane, so the two disagreed and the first mouse move jumped by the difference. The anchor is now the pick's own hit point, and the cursor ray is mapped into MODEL space so the ray, the plane and the delta share one space — replacing the `worldScale` depth fudge.
- Rig picking in ortho uses a cylinder, not a cone: parallel rays make a depth-scaled radius vanish up close and balloon far away.

# v3.19.38
**Grabbing a bone drives the solver, with rig preselection.** Undo changed with it — a solved grab moves the whole chain, so the undo is a rig snapshot taken at grab time rather than one matrix. Bones already had a highlight; pins could not ride it, so `Skeleton.setRigHighlight` sets whichever applies and the pin marker grows and warms exactly as a joint does.

- Adds `scratchpad/undef_test.mjs`: eslint `no-undef` over the rig and animation files. A block-scoped `const` used outside its block crashed bone drawing and was invisible to everything else — not a syntax error, not module-scope, and `updateVisuals` has no harness because it needs a live Three scene.

# v3.19.31
**Rotation is stored as Euler with winding.** Keying a wheel at 3600 degrees now spins it ten times. A quaternion cannot hold more than one turn, so 3600 and 0 were the same orientation and slerp swept nothing. Interpolation is Euler by default and quaternion per track (`track.rotInterp = 'quat'`) — slerp is still better for tumbling motion where Euler will gimbal.

- Every read goes through `rotSync`, which rebuilds the Euler channels from the quaternions when they fall out of step with `times`. Rotation indexed against the wrong times would attach values to the wrong frames, which is far worse than losing winding — so a missed splice site degrades and cannot corrupt.
- The rebuild had to learn Euler's double cover: every XYZ orientation has two spellings and `setFromQuaternion` always returns the one with |y| <= 90, so a steady 170-degree-per-key spin rebuilt as 0, 10, −20, 30. Both spellings are unwrapped against the previous key and the nearer wins. This matters beyond the fallback — every existing saved animation goes through it.

# v3.19.30
**The curve editor gained rotation and scale.** A `T | R | S` segmented switch in the gutter; the three channel rows mean X/Y/Z of whichever is chosen, so hit-tests, tangents and selection are untouched. The vertical view is remembered PER GROUP and framed to a group's own keys on first visit — degrees and scene units are not the same kind of number, and carrying one group's zoom into another shows an empty graph that reads as a bug.

- The accessors moved to `src/editing/xfChannel.js` because the edit path spans three files. Dragging a rotation key vertically lands in `AnimationRegistry.moveSelectedKeysValue`, which wrote `positions` unconditionally — so it translated the object instead. A source guard now asserts no channel-indexed transform access outside the accessors, across all three files.

# v3.19.24
**IK pins hold through keyframe playback**, and pinned bones are colour-coded. Playback slerps stored local rotations and does not re-run the solver, so pin satisfaction does not survive interpolation — the foot cuts the chord instead of following the arc, exact at the keys and worst between them. `IKSolver.holdPins` re-solves once per frame after playback writes the pose, with the ROOT always held: the root's motion is what the take says the character does.

- Maya documents the same behaviour and the same answer — pinning "only affects your FBIK effectors during interaction, not during playback".
- A pinned bone is tinted by the pin at its ROOT (pin the ankle, the foot lights up), with a dashed leader drawn to any anchor the solve cannot reach, so a shortfall is visible as a gap rather than hidden.
- Also: a **Joints** display toggle for the markers and pins, and the pin marker moved to the anchor — it was drawn at the joint, which made a pin the solve was falling short of look like a pin being dragged along.

# v3.19.22
**Joint rotations no longer carry the history of how you got there.** A thigh wound up by tens of degrees every time the hips travelled a closed path, which is the candy-wrapper collapse at the top of the leg — and the same cause behind limbs spinning between keyframes and the solve depending on which way you scrubbed. One defect wearing three hats.

- `fitRotation` measured each joint's rotation as a DELTA from its current orientation. Every delta is minimal-arc, so no single frame invents roll — but composing a long run of them along a path is parallel transport, and parallel transport around a CLOSED loop comes back rotated. Driving the hips once round a circle and back to exactly where they started left the thigh about 35 degrees out; four laps left 130.
- The rotation is now built ABSOLUTELY from two things that carry no history: the child's offset in the joint's own frame (constant, because the solver only ever writes rotations) and where the solve wants that child, expressed in the parent's frame. With one child the fit is the minimal arc, which means zero twist relative to the parent — so identity means "the rest pose" rather than "wherever this joint drifted to".
- Measured over four laps: 2.21, 2.23, 2.23, 2.23 degrees. A constant offset rather than a ratchet. Peak thigh twist through the loop fell from 249 degrees to 22.
- `window._ikAbsoluteRotations = false` restores the accumulating write-back.
- **A held pose settles more slowly than it did.** Hold the target still and the knee moves 5.8e-3 per twenty solves, decaying geometrically; the old path reached machine precision immediately. The multi-child fit is an approximate Kabsch stand-in — read as a delta its error is re-measured and corrected away, read absolutely it is re-made from scratch each solve.
- **Not fully understood**: raising the fit's accuracy (`window._ikFitPasses`) fixes the settling but brings the ratchet back, which means the write-back was not the only source of history. FABRIK seeds each solve from the current pose and converges to the nearest solution, so the solved POSITIONS are path-dependent before any rotation is written. That one is still there.

# v3.19.21
**The hinge picks the branch once instead of being enforced every sweep, and pins are drawn where they actually are.**

- **Clamping the hinge inside every FABRIK sweep was making the solver oscillate.** On a rig with pinned ankles and the hips dragged about it cost 40x the frame-to-frame jitter and 270x the pin drift of leaving the constraint off — and MORE iterations made it worse, not better, which is the signature of a limit cycle rather than slow convergence. Bend depth, the hinge floor, letting the plane roll, and freezing the axis per solve were all tried; none closed the gap.
- Which side a knee bends is a DISCRETE choice, and a branch is chosen once, not enforced continuously. The solver now seeds the legal branch up front — closed form, intersecting the sphere of thigh-length about the hip with the sphere of shin-length about the goal and taking the solution the drawn bend permits — and then leaves FABRIK completely alone. It stays put because the sweeps only make local moves and cannot cross to the far branch unaided, which is the same "limitation" the clamp was fighting.
- Result: jitter and pin drift back to the unconstrained solver's levels, and reach error to exactly zero. A solver with nothing to argue with converges properly, so everything improved at once.
- The cost is that a drag which genuinely crosses branches switches once, visibly, rather than being held — three or four frames in four hundred on sweeps built to provoke it, about what the old post-hoc correction did and at less than half the jump size. `window._ikHingeMode = 'clamp'` trades back.
- **The pin marker was being drawn at the joint, not at the anchor**, so a pin the solve was falling short of looked like a pin being dragged along. The anchor data was never touched by the solver; the display was hiding the shortfall. The marker now sits at the anchor, a dashed leader is drawn from the joint to it whenever there is a real gap, and the 6DOF gimbal takes the anchored orientation so it genuinely holds still.

# v3.19.20
**IK pins hold through keyframe playback.** Playback does not re-run the solver — it slerps each joint's stored local rotation back into its matrix — and pin satisfaction does not survive that, because where a foot ends up is a nonlinear function of the rotations above it. Interpolate between two poses that each sit on the pin and the foot cuts the chord instead of following the arc.

- Exact AT the keys and worst between them: measured on a two-key leg it left the pin by 0.39 at the midpoint, about a quarter of the leg's length.
- This is Maya's behaviour too, and Maya says so outright — pinning "only affects your FBIK effectors during interaction, not during playback" — and its answer is to solve the pins every frame.
- `IKSolver.holdPins()` re-solves the interpolated pose against the pins, once per frame, after every joint matrix has been written. Driven by a dirty flag set as each bone is written, so a timeline SCRUB is covered by the same path as playback without either having to know about it.
- **The root is always held**, unlike an interactive drag: the root's motion is what the take says the character does, so the legs bend up to meet the pins rather than the character sliding down to meet them.
- Treats pins as constant goals for the whole timeline, since they are read from the joint's live pin state rather than from the animation data. Right for a foot planted through a shot; wrong for a pin meant to travel. That needs keyable goals — Maya's "set an IK key on the effector" — which is a larger job.
- `window._ikHoldPins = false` disables the pass.

# v3.19.19
**Hinge joint limits, applied inside the FABRIK sweeps.** Replaces the post-hoc `fixBendDirection` reflection, which solved freely and then reflected the joint back if it came out on the wrong side — a discrete jump applied after convergence, which moved the knee 2.06 units in a single frame against an input step of 0.015.

- Knees, elbows and fingers are 1-DOF. The axis comes from the pose the rig was DRAWN in: cross(bone in, bone out) at rest IS the hinge axis, so a pronounced bend is what turns this on and a joint drawn dead straight is left completely free. No new UI and no chain classification.
- **A limb's ball joint hangs directly off a branch point** — shoulders off the chest, thighs off the hips — while the hinge is always the joint one step further down. That structural test is what separates a knee from a shoulder without naming anything; hinging the ball joint instead locked the arm into its drawn plane and drifted pinned hands 1.45 units off their anchors.
- The floor is not zero. A perfectly straight limb is a degenerate fixed point of the sweeps — collinear in, collinear out — so a leg that once went straight stayed straight for ever, whatever the target.
- A hinge makes the set of reachable poses NON-CONVEX, and the sweeps are local, so a solve that falls short is retried once from the other branch.
- Superseded by v3.19.21, which keeps the branch selection and drops the in-sweep clamping. `window._ikHingeMode = 'clamp'` still selects this behaviour.

# v3.19.18
**The preferred bend comes from the rest pose only.** v3.19.17 refreshed the remembered bend on every frame it judged correct, which is self-confirming: the first frame a knee happened to solve backwards became that knee's preference and was then enforced for ever.

- The bend is now read ONCE from the pose the limb was drawn in and never refreshed from a solve. That is also why a drawn-in bend is the way to state the direction — the rest pose is a deliberate statement, a solved frame is not.
- A straight limb still does not forget, because nothing is being read off the live pose any more.
- `IKSolver.clearBendRefs()` re-reads them, and Tweak mode calls it on release: moving a knee in the rest skeleton IS how you change which way it bends, so a preference captured before that edit must not outlive it.
- **Unverified against the reported symptom.** A symmetric two-legged rig crouching on pinned feet passes with the fix AND with the old self-confirming refresh in place, so the harness does not reproduce the one-knee-forward-one-back case. The refresh was unsound and is gone on that reasoning; whether it was the cause of that specific report is not established.

# v3.19.17
**The preferred bend is remembered, not re-read.** A leg that straightens — jumping, so the feet leave the floor — expresses no bend while it is straight, so a preference taken from the live pose vanished at exactly the moment it was needed and the knees folded whichever way the solver fancied on the way down.

- The bend direction is now stored on the joint and refreshed on every frame the limb IS bent, so it survives a straight pose and decides which way the knee folds when the limb bends again.
- A joint drawn dead straight still expresses no preference and is left alone; the first bend it is given becomes the remembered one.
- **Known limit**: the preference is remembered in model space, so rotating the whole body a long way WHILE a limb is held straight can leave it stale. Refreshing on every bent frame makes that a narrow window, but it is not airtight — a body-relative frame is the proper fix.

# v3.19.16
**The drawn bend is the preferred bend, and a pinned foot survives its own knee being dragged.**

- **A leg drawn with a slight bend now keeps bending that way.** FABRIK has no opinion about which side a knee goes — a backwards knee satisfies every bone length just as well — so it was free to invert, and that inversion is the visible pop when swinging a limb. The sign of the bend the rig was DRAWN with is read once and held: if a solve flips it, the joint is reflected back across the line joining its neighbours, which restores the side while leaving both bone lengths exactly as they were. A joint drawn dead straight expresses no preference and is left alone — which is what makes drawing the bend the thing that turns this on. `window._ikPreferredBend = false` to disable.
- Only applied to serial links. Where several branches meet, the solver places them as one rigid cluster on purpose, and reflecting one alone produces a pose no single joint rotation can reproduce — the fitting stage then discards the difference, which comes out as pinned joints sliding. Knees and elbows are serial anyway.
- **Dragging a knee no longer pulls the pinned foot off the ground.** Knee and foot are one bone apart, so the knee can only ever sit on a sphere around the planted foot; asking for anything else is not a hard request but a contradictory one, and FABRIK answers a contradiction by splitting the difference. The drag is clamped onto that sphere instead, so the leg swings around the foot. A reachable drag is not clamped.
- **Deliberately limited to a SINGLE bone between the drag and the pin**, where there is no freedom at all. A longer path has slack, and running out of it is meaningful: pulling the hips up until the legs straighten and the feet leave the ground is a jump, and clamping there would nail the character to the floor. So dragging a thigh (two bones from a pinned foot) still moves the foot.

# v3.19.15
**A desktop IK drag holds the dragged joint's orientation.** A mouse or a finger carries position and nothing else, so a screen drag hands the solver three fewer constraints than the same grab in a headset — which is why full-body IK reads as far looser on the desktop. The rig was not behaving differently; it was being asked a vaguer question.

- The joint now keeps the orientation it had at the grab while it travels, through the same driven-orientation machinery the VR grab and the 6DOF pins already use. A dragged hand stays level while the arm re-solves under it. `window._ikLockGrabRotation = false` restores the free effector.
- **Per-joint stiffness was built, measured, and removed.** The idea was to blend each bone's new direction back toward the one it held before the solve, so the chain reaches the same targets by moving less. Measured over a 60-step drag it changed total joint travel by under 1.5% and left the worst single-frame jump untouched (2.76 → 2.71 of a scene unit), and the settings that moved the number at all cost up to 3×10⁻² of target accuracy. FABRIK converges too strongly for an early positional bias to survive; it is washed out by the iterations that follow. Shipping a tuning knob that does nothing is worse than shipping none, so it is gone.
- What the measurement actually shows is that the visible jerk is a BRANCH FLIP — the elbow or knee snapping to the other side — and positional damping cannot prevent one, because both branches satisfy the bone lengths equally well. That wants a preferred bend direction (a pole vector) or real joint limits, which is a different mechanism from the one tried here.

# v3.19.14
**Fix: `Skeleton.js` failed to load.** The v3.19.13 accessor that lets the panel read the capsule default was assigned onto `Skeleton` from a point ABOVE `const Skeleton = {}` — inside the const's temporal dead zone — so the module threw on evaluation and the whole rigging system was dead on load. Moved below the declaration.

- **Every unit check still passed while it was broken**, which is the more useful finding: the harnesses strip imports and stub their dependencies, so they exercise logic but never run a module's top level the way a browser does. A module that cannot even evaluate looked perfectly healthy.
- Added `scratchpad/module_load_test.mjs`: bundles the real rigging modules with their real imports and imports the result, which is the cheapest thing that catches a module-init failure. Verified to fail on the exact bug it was written for.

# v3.19.13
**Rig display proportions: one size of joint, thinner capsules.** The three things drawn per bone — body, joint marker, bind capsule — were each scaled off a different quantity, so none of them agreed with the others.

- **Joint markers are ONE size across the rig again.** v3.19.11 sized each marker off the bone below it, which did keep every joint clear of its own bone but turned a rig of mixed bone lengths into a string of mismatched beads — reading as noise, and as meaning something it does not. Constant is the honest choice: the marker says "a joint is here", and that claim is the same size everywhere. Set a little above the pre-v3.19.11 size so it still clears a typical bone; `JOINT_R_FRAC` in `Skeleton.js` is the single knob.
- **Default capsule radius halved**, 0.5 → 0.25 of a bone's own length. At half a bone's length the envelopes read as bloated tubes rather than limbs and swamped the bones they wrap. This is the number every downstream bind weight inherits, so it changes what a fresh bind produces.
- Bone bodies are unchanged — they were the one part that read correctly.
- The panel's Capsule slider now reads the default from `Skeleton` instead of carrying its own copy of the number, which is how a slider ends up lying about the current value.

# v3.19.12
**IK pins are world-space anchors, so a character can jump.** Pin the feet and push the hips down and the pins behaved; pull the hips up until the legs over-extend and the pins rose with the feet instead of holding the ground.

- **The cause**: a pin's target was read from the joint's LIVE position on every solve — "stay exactly where you are", asked afresh each frame. Any shortfall was therefore adopted as the new pin, and the anchor ratcheted upward a little per frame. Moving down worked only because the legs have slack there, so the solve lands on the pin exactly and re-reading it changes nothing; the bug was invisible in precisely the direction that was tested.
- **The fix**: the anchor is captured once when the pin goes on and held until it comes off. An unreachable pin now fails honestly — the foot aims at it and falls short — and snaps back onto it exactly as soon as the chain can reach again.
- Cycling 3DOF → 6DOF does not re-anchor. If the joint has drifted off an unreachable pin, re-reading it there would move the pin to the wrong place at the very moment a *stronger* hold was asked for. The 6DOF orientation is anchored the same way, for the same ratcheting reason.
- Undo carries the anchors, not just the pin modes: restoring the mode alone would re-anchor every pin to wherever the rig sat at undo time.
- **Known limit**: the anchor is not written to the save file (only the pin mode is, in the SKEL flags). A reloaded rig anchors its pins to the pose it loaded in — which is the pinned pose, so it is the right reading, but a pin that was deliberately left unreachable when saved comes back reachable.
- Covered by `scratchpad/ik_test.mjs`, including a jump-and-land case that fails by ~3 units of drift on the old code.

# v3.19.11
**Bones are the right thickness again, orthographic tracks the cursor, and a rig can be drawn with no mesh at all.**

- **Bone width reverted; the JOINT grew instead.** v3.19.10 made the joint markers visible by thinning the bones, which was the wrong way round — it turned the rig into needles at roughly a third of their proper width. Bones are back to the size they have always been, and the marker is now sized to clear the bone it terminates, capped so one long limb cannot balloon its joint. The capsules were the giveaway: they were right, so the bones were wrong.
- **Orthographic no longer tracks at double rate.** `Raycaster.setFromCamera` branches on the camera's *class*, and orthographic mode here keeps a `PerspectiveCamera` object with an ortho matrix swapped into it — so the raycaster took its perspective path against an ortho projection. The screen ray is now unprojected by hand from the matrices, which is correct for either projection because it never consults the class. Covered by a regression test that fails loudly on the old path.
- **A chain can be started with no sculpt in the scene.** The press was gated on a surface hit, so with the mesh deleted no chain could ever begin — VR has never had this problem because it places at the controller tip and asks the mesh nothing. The gate now only applies when there is actually something to press on.
- **The snap plane is sized to the view in an empty scene.** With no sculpt and no joints there is no object to take a scale from, so it falls back to how far the camera is pulled back — the difference between a usable plane and a postage stamp at the origin.
- **`O` toggles orthographic/perspective.** Rigging is done from flat front and side views and the Rendering menu is the wrong amount of friction for something flipped constantly. Any open Projection dropdown follows along.

# v3.19.10
**Branching, a rig that outlives its sculpt, visible joints, and orthographic views.** Four separate blockers found while rigging on the desktop.

- **Branching works again.** A press between chains was gated on the surface pick alone, so clicking the neck to grow the arms did nothing — the joint you aim at is usually the one place the cursor is NOT over unbroken sculpt. A press on a preselected joint now claims the pointer wherever it is.
- **Deleting the sculpt no longer takes the symmetry plane with it.** The plane is read off the sculpt but does not belong to it, so with no mesh the world centreline is still the answer; returning nothing took the plane, the snap and the mirrored joints away at once. The scene unit falls back to the skeleton's own extent for the same reason — measured against 1 instead, every marker was too small to see and every snap too tight to hit.
- **The joint markers are visible.** Bone width was a flat 12% of the bone's LENGTH while the marker is a fraction of the SCENE, so on anything longer than a finger the bone body grew wider than the joint and swallowed it. Width is now capped below the marker radius: beads on a string, at every scale.
- **Orthographic views render.** `Camera.updateOrtho` only ever wrote the legacy `_proj` matrix — a leftover from the raw-WebGL engine — and never touched the Three camera that actually draws, so selecting Orthographic left the renderer on its perspective projection while picking used an ortho one. Long-standing, not new; it just happens to block the front/side views rigging is normally done from.

# v3.19.9
**A root joint goes in the middle of the sculpt, not on its skin.** The depth ladder still consulted the surface pick for the first joint of a chain, so the root landed on the shell — and every joint after it inherited that depth, putting the whole chain on the surface. That is the one place a bone never belongs, and the exact 2D problem that made this feature VR-first.

- **The root takes the middle of the sculpt** (its own bounding sphere, in model space). Aiming at the body now puts the joint inside it; the drag then moves it laterally at that depth, so an off-centre root is still one gesture away.
- **The centreline comes from the snap, not from the depth.** Near the middle on screen the joint lands exactly on the symmetry plane, with the plane lit — measured in the running app: the skin under the cursor at z=22.3, the joint at x=0, z=-1.6.
- Not "where the cursor ray crosses the symmetry plane", which was the obvious construction and is quietly wrong: when the camera sits *on* the plane — which is exactly what a front view of a symmetric character is — the ray only meets it at the eye, so that path never fired from the most ordinary viewpoint there is. Mid-depth works from every angle.

# v3.19.8
**The bone tip follows the cursor everywhere, and the snap band lets go.** Two reports, one cause: the tip was driven straight off the surface pick, so it existed only where there was mesh under the pointer. On a limb that is most of the screen, and the tip simply vanished — which also made Snap Plane off look like the tool had stopped responding.

- **A depth ladder, so there is always an answer.** The tip rides a camera-facing plane whose depth comes from, in order: the joint you are continuing from; the surface under the cursor when starting a chain over the mesh; the last depth used when starting one off it. Continuing a chain no longer consults the mesh at all — the next joint belongs at the depth of the one before it, not on whatever skin happens to be under the pointer.
- **So a chain draws past the silhouette.** Verified in the app: with the sphere's edge at x≈615px the tip tracks smoothly out to x=820px, where before it drew nothing at all.
- **The snap band is measured in screen px** (14), not 5% of a scene unit. The old band was a hand-width — the right unit for a controller and the wrong one for a screen, since it scales with whatever else is in the scene and had grown wide enough to swallow the model, so every joint landed on the centreline whether you meant it or not. VR keeps the band it was tuned with.
- Whether a joint is treated as centreline (snapped, not mirrored) now follows whether it was *actually* snapped rather than a second reading of the band, which the two units would otherwise disagree about.
- Mid-chain a press anywhere on screen is meant, since the depth no longer comes from the mesh. Between chains it still has to land on the sculpt — that is where the first joint's depth comes from, and it leaves left-drag free to orbit when you are not drawing.

# v3.19.7
**The snap plane stays put, and Snap Plane off means draw at depth.** The plane was appearing and disappearing with the pointer, which is worse than not having one — you cannot line anything up against a plane that blinks.

- **The plane is furniture, not a hover effect.** With Snap Plane on it is drawn for as long as the mode is Draw or Tweak: no pointer needed, it survives the cursor leaving the mesh, and it survives release. Only its *brightening* still comes and goes, and that is a reading of the plane ("this joint will land on the centreline"), not a decision about showing it. Kept up by the tool's per-frame `postRender` hook, so nothing has to poke it.
- **Hidden in Pose, Radius and IK**, which move the character rather than edit the rest skeleton and have nothing to snap. Same split as VR.
- **Snap Plane off switches Draw to a fixed depth.** With no plane there is no centreline seam to aim at, and the surface pick then does the one thing you never want — it puts every joint on the skin. Instead the joint follows a camera-perpendicular plane at the depth of the bone being continued, so a chain stays inside the limb. Symmetry being off lands in the same place, for the same reason.
- In depth mode the drag is free of the mesh, so a chain can run out past the silhouette. The *press* still has to hit the sculpt — a press that claimed the pointer anywhere would swallow every attempt to orbit and look at what you are drawing. Starting a fresh chain, the press point is the only depth on offer, so it becomes the anchor and the drag holds it.
- Toggling Snap Plane reaches the plane on the same click rather than a frame later.

# v3.19.6
**Drawing bones on a flat screen: drag to place, and the centreline is visible again.** Draw mode was still click-to-commit, with the symmetry plane drawn only in VR — so placing a hip or a spine joint at x=0 meant guessing and undoing.

- **The symmetry plane is drawn on desktop and iPad**, exactly as in VR: faint while you are away from it, bright the moment the joint would snap to it. It appears while Draw mode is active and goes away on release. Note it is the *symmetry* plane — with symmetry off there is no centreline and no snap, in VR either.
- **Placement is press-drag-release.** Press on the mesh to start the joint, drag to adjust it, release to commit. The preview bone shows the resolved position throughout, so crossing into the snap band visibly pulls the joint onto the centreline before you let go. Dragging off the silhouette holds the last good point rather than jumping.
- **Hover previews the next bone** once a chain is going, so a chain is drawn by moving and pressing rather than pressing and hoping.
- **Two ways to end a chain, because the iPad has no A button.** Escape or Enter ends it, and pressing again leaves Draw for Pose — the same two steps the controller's A button walks through. With no keyboard, releasing a joint within 12px of the one it would hang from ends the chain instead: a zero-length bone is never a thing you meant. 12 rather than 5 px because this is for a fingertip.
- The pointer is no longer hidden during a bone drag. Hiding it is right for a sculpt brush, which draws its own ring in its place; Bones draws no cursor, so a drag aimed at a point on screen was losing the thing doing the aiming.
- Draw now opts out of the iPadOS single-action debounce along with the other modes. It commits on release, and a blocked `start()` mid-gesture would clear the active stroke so the release never placed anything.

# v3.19.5
**Every bone mode works with a mouse or a finger.** Tweak, Pose, Radius and IK existed only as 6DOF controller gestures, so on iPad and desktop they were shown disabled. They are all live now, and nothing in the Bones panel is greyed out any more.

The depth problem is the reason this was VR-first: a joint lives inside the mesh and a screen has no depth channel. It is answered per mode rather than papered over, because none of these modes is inventing a depth — each is moving, rotating or sizing something that already has a position.

- **Tweak (FK and Free) and IK — screen-plane drag.** The joint moves in the camera-facing plane through where it already is, so its depth is left exactly as it was and orbiting gives you the other axis. This is what every DCC does, and it never pretends to have supplied a depth it does not have. The grab holds its offset, so a joint does not jump to the pointer on the first frame.
- **Pose — camera-axis sweep.** No translation is involved, so there is nothing to fake: the axis locks to the camera view axis at the grab and the cursor's angular sweep around the joint's screen position is the amount. Straight off `GeodesicPoseTool`, which solved the same problem for its bend.
- **Radius — distance from the shaft.** A radius is a distance from a line, and a screen measures that perfectly well. Drag away from the capsule and it inflates, with the live weight recolour it has in VR.
- **A tap in IK mode cycles that joint's pin** (none → position → position + rotation), which is the A button's job in VR. The solve is deliberately not started until the pointer moves past a small threshold, so a pin press does not leave an empty "IK Pose" step in the undo history — and a finger that never quite holds still is still read as a tap.
- **Picking is done in screen space**, not by pushing the cursor into the volume: on a flat screen the joint you mean is the one under the pointer, and a model-space test against the ray would prefer whichever joint sat nearest the camera along it. Hidden joints stay ungrabbable, as in VR, and a click that hits nothing still orbits the camera.
- Correct under an orthographic camera and under the worldGroup's scale, both of which are easy to get silently wrong in a projection round-trip.
- The single-action debounce that protects click-once tools from iPadOS double-fire no longer applies to the drag modes, where it could only ever have blocked a second deliberate drag begun within 300ms of the last.
- Covered headlessly by `scratchpad/bonescreen_test.mjs` (against the shipped source): picking, cursor tracking, depth preservation, the pose sweep and its seam unwrap, radius growth, and the IK tap/drag split.

# v3.19.4
**The Bones controls exist outside VR.** Everything rigging — modes, bind, capsules, Make Skin, Bind Pose, Key Pose, the display toggles — was only ever in the VR wrist panel, so on iPad and desktop the whole feature was unreachable.

- The controls now appear in the Sculpting section whenever the Bones tool is active, which puts them in the iPad/desktop sidebar, the VR main menu and torn-off panels at once.
- **One source, two dialects.** The wrist panel and the menu use different chrome, so the markup is generated in either class dialect while the behaviour and the state sync are shared outright. A control added once now shows up everywhere.
- **The five controller-driven modes are shown disabled on a flat screen**, with a tooltip saying why. Tweak, Pose, Radius and IK are press-and-hold-a-joint-in-6DOF gestures with no touch or mouse equivalent yet; showing them as available and inert would be worse than showing them greyed. Draw works everywhere — it places joints from a surface pick.
- Everything that is a command rather than a gesture works on iPad today: bind and rebind, the capsule slider and Apply To All, Make Skin, Bind Pose, Key Pose, Clear Pins, and every display toggle.
- Structure verified headlessly (`scratchpad/bonepanel_test.mjs`), including that every id the wiring binds is an id the markup emits — a rename in one half would otherwise be a silently dead button.

# v3.19.3
**Shorter Nomad Link messages, and one that was not true.**

- The connection-failure hints are trimmed to the cause and the fix.
- **Removed "connect before entering VR"** from the Nomad Link panel. It was written on the theory that the browser's local-network prompt cannot be answered inside an immersive session; connecting from inside VR turns out to work, so it was advice for a problem nobody has.

# v3.19.2
**Nomad Link says why it could not connect.**

- A failed connection now names the likely cause instead of reporting only that it failed. The browser deliberately withholds the reason, so a blocked connection and a typo in the address looked identical — and you would go looking for the typo.
- **The case worth calling out is iOS.** Every browser on an iPhone or iPad is WebKit — Chrome there is a WKWebView wrapper and does not bring Chrome's networking rules with it — and WebKit does not appear to implement the loopback exception that lets an https page open a plain `ws://` to 127.0.0.1. Desktop Chrome does, which is why the same address works on the desktop and fails on the iPad with nothing visibly different. The error now says so, and suggests running Nomad on another device or opening SculptXR over http.
- A synchronous SecurityError at construction — some browsers refuse a mixed-content WebSocket there rather than failing later — is reported as the definite cause rather than as one candidate among several.
- Elsewhere the message points at Nomad's Link being enabled and at the local-network permission prompt.

# v3.19.1
**You can type into text fields again.**

- **Fix — a focused text field could not receive its own characters.** The app binds a lot of BARE keys as shortcuts, and every global key handler claimed them regardless of what had focus: entering an IP address in the Nomad Link panel toggled the animation panel on 'n' and the main menu on 'm' instead of typing. Typing now wins — global shortcuts stand down while an input, textarea, select or contenteditable has focus.
- Applied at every global entry point (the main key handler and its fan-out to every GUI shortcut, plus the three window listeners bound for the panel toggles) through one shared check, rather than case by case.
- Modifier state is still recorded while typing, since a focused field does not stop you holding shift.

# v3.19.0
**Full-body IK, stop-motion pinning, and pose keyframing.** Pin the parts that should stay where they are, drag anything else, and the whole skeleton rearranges itself around the pins — then key the pose and do it again.

- **IK mode** in the Bones tool. Trigger-hold a joint and the rig reaches for your hand: the limb bends, the spine follows, bone lengths hold. The grab is 6DOF, and that rotation is a constraint inside the solve rather than something applied after it — so twisting the hips swings the legs, and the pinned feet are re-solved against where they land.
- **Pins have three states**, cycled with A: none, position, position and rotation. A position pin lets the limb above it swivel; a 6DOF pin holds orientation too, which is what keeps a foot flat on the ground. An axis triad marks the first, the triad inside gimbal rings the second, both drawn in the joint's frame so the difference reads while you drag.
- **Key Pose** keys the whole rig at the playhead as one undo step, and the rig occupies a single lane in the dopesheet rather than one per joint. Pose, key, scrub, pose, key — playback interpolates and the bound mesh follows.
- **Bind Pose** returns a posed character to the pose its weights were solved against, exactly, using the inverse binds that already encode it.
- **Subdividing a bound, posed mesh** works instead of crashing, and the bound level survives Reverse, Delete Lower and undo — it was remembered as a position in a list that all three reorder.
- Solid and Wire toggles for the bone display; A ends a bone chain and, pressed again, leaves drawing entirely.
- Face buttons are read from the device rather than from whatever the current call path passed along — a binding that works "sometimes" is usually a degraded options object, not a bad binding.

# v3.18.16
**Face buttons read the device, not the call path.**

- **A now falls back to the live WebXR gamepads** when the options object it is handed carries no matching controller. A face button is global device state — it is not aimed at anything and does not depend on which code path called the tool this frame — but the value was only ever arriving through the options object, so any caller passing a thinner one silently disabled the binding.
- The trace made the case for this: the pointing-at-menu flag is STICKY and reads true almost permanently, so the guarded call path (which passed no controllers at all before v3.18.14) is the normal case rather than a rare one. Rather than audit every call site for a good options object, the tool asks the device.
- The fallback also covers a handedness mismatch: controllers present but none matching the hand being processed now falls through to the session instead of reporting "not pressed".
- Trace (`window._boneATrace = true`) additionally reports recording/playback state, the dominant hand, and a bail-out if the tool is ever called with no controller tip — which would skip the button handling entirely and look identical to a dead button.

# v3.18.14
**Face buttons stop being swallowed when the ray crosses a menu.**

- **Fix — A intermittently did nothing** (ending a bone chain, cycling an IK pin, the pose tool's maintain-length toggle). While the controller is pointing at a menu, the tool is still updated — so it does not pop — but with the trigger forced off, which is what stops a stroke starting through the panel. It was also handed an EMPTY controller list, and face buttons are read out of that list, so every face-button binding went dead. A face button is not aimed at anything; where the ray happens to be pointing has no business swallowing it.
- That is why it looked intermittent and order-dependent. The menu-pointing state is sticky, and the branch is skipped entirely while a tool is mid-action — so the trigger kept working, drawing kept working, and only the face button was lost. Having just used the mini panel made it far more likely.
- The trigger is still blocked through a menu. Only the button state is passed through now.

# v3.18.13
**A gets you out of bone drawing.**

- **A ends the chain; A again leaves Draw mode** (landing in Pose). Previously A only ever ended the chain, and there was no way to stop drawing from the controller at all — the next trigger dropped another root joint wherever your hand happened to be, which is fine while building a skeleton and wrong the moment you have finished one.
- **The cursor now says which of the two the next trigger will do.** Continuing a chain draws the full-size joint-coloured dot at the end of the preview bone; with no chain in progress it is a smaller blue dot, a place to start one. Ending a chain previously looked exactly like not having ended it — the only signal was a log line, which is hidden by default.

# v3.18.12
**Key Pose — the whole rig keyframed in one press.**

- **Key Pose** in the Bones mini panel keys every joint at the playhead, as ONE undo step. Pose, key, scrub on, pose again, key again — playback interpolates between them, and the bound mesh follows because the skin pass already re-skins whenever a joint moves.
- **Every joint is keyed, including the ones that did not move.** A joint left unkeyed holds its neighbouring keys' value and drifts out of the pose that was just set, which reads as the rig coming apart between poses.
- **The rig is one lane in the dopesheet, not thirty.** A keyed skeleton is thirty tracks carrying identical key times; thirty identical rows would bury every other object in the scene, and the thing being animated is the pose, not joint 14. Joint tracks fold into a single "Rig" row per skeleton.
- Keys on that row are shown but not yet draggable or deletable. Editing a rig's keys means moving the whole pose rather than one bone out of thirty, and that wants designing rather than falling out of the existing per-object key handling — so for now the row cannot be edited into a state that pulls the rig apart.
- Undo of a key takes the key back without moving the rig: the pose you are looking at is still the pose you posed.
- Behaviour verified headlessly (`scratchpad/keyrig_test.mjs`): single keys unchanged by the refactor, rig keys landing on every joint at shared times, one undo entry per pose, re-keying the same time overwriting rather than stacking, and out-of-order keying staying sorted.

# v3.18.11
**Subdividing a bound, posed mesh works instead of crashing.**

- **Fix — Subdivide on a bound mesh threw on the next frame.** A level created by subdividing has no detail vectors yet: they are allocated on the way DOWN, by the analysis pass. Nothing had ever reached a fresh level from below, because the only route up was a level you had already come down from — so the null was unreachable by accident. Skinning broke that invariant, since it synthesises up from the bound level on every posed frame. Applying details is now skipped when there are none, which is not a workaround: a level with no details IS exactly the subdivision of the level below.
- Posing continues to work across the new level. The rig stays bound at the level it was bound at, and the subdivided level rides on top through the existing multires propagation.
- **Fix — the bound level was remembered as a position in the level list, and several commands reorder that list.** Reverse inserts a level below, shifting everything up; Delete Lower splices levels off the bottom; undo and redo shuffle them back, in code that writes the list directly. The stored number then named a DIFFERENT resolution, and nothing threw — the weights simply addressed the wrong vertices. The bind now holds the level itself and re-derives its position, which makes every one of those cases correct without having to patch each of them.
- **Delete Lower / Delete Higher now refuse** when they would delete the level a rig is bound at, and say why. Previously the weight map was left pointing at geometry that no longer existed.
- Both behaviours are covered headlessly against the real source (`scratchpad/skin_level_test.mjs`): subdivide, reverse, delete, undo, and the synthesis walk starting from the re-derived level.

# v3.18.10
**Pins have three states, and the bone display has two more switches.**

- **A now cycles a joint's pin: none, position, position + rotation.** A position pin lets the limb above it swivel, which is right for a hand resting on something. A 6DOF pin holds the joint's orientation too — that is what keeps a foot flat on the ground instead of tipping over as the shin swings.
- The 6DOF pin runs through the same machinery as the joint in your hand: an absolute orientation the solve has to work around, not a correction applied afterwards. Its target is simply the orientation it already has, so the joint is its own fixed point and cannot ratchet round during a long drag (checked over 60 consecutive solves).
- **The pin marker says which state it is in.** An axis triad for a position pin, the triad inside gimbal rings for a 6DOF one. Both are drawn in the joint's own frame, so the difference is legible while you drag: a 3DOF triad turns with the limb, a 6DOF one stands still.
- **Solid and Wire toggles** for the bone display, alongside Lengths and Capsules. Turn both off and only the joint markers remain — the least cluttered thing to pose against, since the spheres are what you aim at.
- Pin modes are saved with the file, still with no format version bump (they occupy two spare bits of a flags word that held one boolean). A file saved by an earlier build reloads with its pins as position pins.

# v3.18.9
**Bind Pose button — one press puts a posed character back where it was bound.**

- New button in the Bones mini panel, below Bind/Unbind. Every bound rig returns to the pose its weights were solved against, and the mesh follows on the next frame.
- **Exact, not approximate.** The bind pose is not stored as a pose anywhere, but it does not need to be: the inverse bind matrices already are it, so each joint's bind transform comes straight back out of them. This is the same pose the weights were built against, to the last decimal.
- The mesh's CURRENT transform is used, so a character that has been moved or scaled since binding keeps its rig on it rather than snapping back to where the mesh used to stand.
- Undoable in one step, so trying a pose out costs nothing.
- The button is shown whenever ANYTHING in the scene is bound, not when the SELECTION is bound — while rigging, the selection is usually a joint, and a scene-wide reset should not vanish because you last grabbed an elbow.

# v3.18.8
**The IK grab is 6DOF — turn your hand and the joint turns with it.**

- **Rotation is now part of the solve, not applied after it.** Grab the hips with the feet and hands pinned, and twisting your controller twists the hips: the legs and spine are carried by that rotation, and the pinned limbs are then re-solved against wherever they land. Applying the rotation after the solve would have looked the same on the hips and left the pinned feet behind.
- The driven orientation is treated as absolute, measured from the pose at the moment of the grab, so a long drag with a lot of turning cannot accumulate drift.
- **A joint at the end of a chain can be rotated too.** Its rotation was previously undefined — there is nothing hanging off a hand to fit an orientation against — so a wrist could only be moved, never turned.
- `window._ikGrabRotate = false` goes back to position-only dragging.

# v3.18.7
**Full-body IK with stop-motion pinning.** A new IK mode in the Bones tool: pin the parts that should stay where they are, drag anything else, and the whole skeleton rearranges itself around the pins.

- **IK mode** (mini panel, alongside Draw / Tweak / Pose / Radius). Trigger-hold a joint and the rig reaches for your hand — the arm bends, the spine follows, the bones keep their lengths.
- **Pinning** — A button pins or unpins the joint you are pointing at. A pinned joint wears a red shell around its marker and does not move while anything else is dragged, so "hold the foot down and pull the hips into a crouch" is two pins and one drag. Pins are undoable, are saved with the file, and there is a Clear Pins button carrying the current count.
- **With nothing pinned the chain root is the anchor**, so a first drag reaches with the limb rather than dragging the whole character after your hand. Pin anything and the root is free to travel — which is what lets a pinned-feet pose actually lower the body.
- **The solver writes rotations, never bone lengths.** It solves positions, then converts them into the joint rotation that explains them, so no pose — reachable or not — can quietly re-proportion a rig. The one exception is the root's position, and only when something else is pinned.
- **Bones that share a joint move as one rigid unit.** Plain tree FABRIK lets two bones off the same joint change their angle to each other, which no single joint rotation can reproduce; the difference was silently discarded when the result was written back, and showed up as pinned joints drifting off their pins even after the solve had converged.
- An unreachable target makes the chain straighten and stop at its own reach. Joint limits are not in yet, so a knee will happily bend the wrong way — that is the next decision, once the solver has been posed with.
- Tested headlessly against the real solver source (`scratchpad/ik_test.mjs`): bone lengths preserved to 1e-6 across every case, pins held, unreachable targets falling short instead of stretching, separate skeletons untouched, and no NaN on a degenerate drag.

# v3.18.6
**Multires commands follow a selected bone to the mesh it drives.**

- **Fix — the Multiresolution buttons appeared to stop working after posing.** Grabbing a joint selects it, so the next Level +/− (or Subdivide, Reverse, Del Lower/Higher) was aimed at a joint locator, which has no levels and ignored it silently — the level readout moved, the model did not. If the selection is a joint that drives a bound mesh, the command now selects that mesh first and acts on it. The outliner selection changes with it, so the redirection is visible rather than magic.
- Confirmed on a Galaxy XR standalone: bind a ~700-poly cage, subdivide 3 levels, pose at the cage. Detail rides along and stays fast on-device.

# v3.18.4
**Rigging works across multires levels — bind low, sculpt high.** Bind at the lowest subdivision level, go up a level, and posing now carries the sculpted detail with it instead of destroying the mesh.

- **Fix — the mesh vanished when you posed a bone at a higher subdivision level than you bound at.** A Multimesh's `getVertices()`/`getNbVertices()` return the CURRENTLY SELECTED level, so the skin pass ran to the high level's vertex count while reading a weight map and source array sized for level 0. Every index past the end returned `undefined`, every vertex came out NaN, and the mesh disappeared — taking the skeleton with it, since marker size derives from the scene bounding radius. Reading past the end of a typed-array wrapper throws nothing, so it failed silently.
- **Feature — the bind remembers its level, and the levels above ride along.** Binding records which level it bound at and every later pass addresses that level explicitly. After posing the cage, the change is pushed up the stack through the existing multires propagation (partial subdivision plus each higher vertex's stored detail re-applied in its local frame), so sculpted detail sits on top of the posed cage rather than being flattened by it.
- Binding low is the useful case: the weight solve runs on a few thousand vertices instead of a few hundred thousand, and the capsules are far easier to judge against a cage.
- **Guard** — if a weight map and its level ever disagree on vertex count, the skin pass does nothing and says so once. Refusing to deform is disappointing; writing NaN over a sculpt is not recoverable.
- Note: the upward synthesis runs on every posed frame, so a deep stack will cost more than a shallow one. `docs/rig_multires_plan.md` has a console benchmark for measuring it on a real model.

# v3.18.3
**The skin follows the capsules, bones hide from the outliner, and stop spinning when you pose them.**

- **Fix — Make Skin now matches the capsules you tuned.** Each bone gets two rings at its own capsule radius, square to its own bone, so a tube is the constant thickness its capsule is. Previously every ring sat at a joint carrying the AVERAGE of the two bones meeting there, cut square to the bisector and widened by a miter at bends — so a bone between a thick parent and a thin child came out thick at one end and thin at the other, every joint introduced a radius nobody asked for, and bends bulged past the capsule that had been tuned against the real mesh. Thickness changes now happen at the joint, where the capsules change, instead of being smeared along the limb.

- **Fix — the drawn bone no longer spins about its own long axis while posing.** The bone visual was oriented by the minimal rotation from +Y onto the bone's direction, and the roll of that rotation is a function of the direction alone — so as a joint swung, the bone rolled in a way the joint never did, while the deformation underneath stayed correct. The visual was inventing a roll rather than reporting one. It is now built from the owning joint's own rotation, with the direction expressed in that joint's frame, so the bone rolls exactly as the joint rolls. Under a general 6DOF rotation the old orientation drifted up to 300 degrees against the joint frame; it now holds to zero.
- **Fix — the outliner eye on a joint does something.** A joint's own locator never draws (the bone and joint visuals represent it), so toggling its visibility had nothing to act on. The skeleton pass honours it now, and visibility is inherited down the chain: hide the root and every joint, bone, capsule and length label below it goes with it.
- Hidden joints are not grabbable either — preselection, tweak, pose and radius all skip them. Grabbing something you cannot see is worse than not being able to grab it.
- Hiding is display only: a hidden skeleton still deforms a bound mesh, so you can pose the rig, hide it, and look at the skin alone.

- **Fix — the outliner eye did nothing on a bone.** A joint's own locator never draws (the bone and joint visuals in the skeleton pass represent it), so toggling the mesh's visibility had nothing to act on. The skeleton pass now honours it, and visibility is inherited down the chain: hide the root and every joint, bone, capsule and length label below it goes with it.
- Hidden joints are not grabbable either — preselection, tweak, pose and radius all skip them. Grabbing something you cannot see is worse than not being able to grab it.
- Hiding is display only: a hidden skeleton still deforms a bound mesh, so you can pose the rig, hide it, and look at the skin alone.

# v3.18.0
**Bones to low-poly skin — clay over a wire armature.** Draw a skeleton, press Make Skin, and get quad tubes at the capsule radii you already tuned: a blockout to sculpt on rather than scaffolding to look at.

This is also the release that carries the skinning rework below it (v3.17.19–22): visible and editable bind capsules, rigid nearest-capsule weights, and the weight colour preview.

- **Feature — Make Skin** (mini panel, Bones). One continuous tube per chain, so an arm runs shoulder to wrist as a single surface and the elbow is a bend in it rather than a seam. Ring radius follows the capsules, tapering between bones, with a miter at each joint so the tube does not pinch on a bend. Dome caps at the ends. Frames are parallel-transported down the chain, so the quad rows run straight along a limb instead of spinning where it changes direction.
- Branch points are left interpenetrating on purpose: two clavicles leaving a spine each cap off inside the other. Resolving junctions cleanly is the hard part of every skin modifier ever written, and this is a shape you are about to voxel-remesh or sculpt over anyway.
- The skin lands exactly on the skeleton (model-space vertices, identity matrix, no auto-normalise) — the proportions you drew are the proportions you get. It arrives as an ordinary new mesh, one undo step, unbound so you can sculpt it freely.
- `window._boneSkinSides` sets the radial segment count (default 6 — low on purpose).

# v3.17.22
**Fix — a bone deforms with its parent joint, not its child.** Rotating a wrist swung the whole forearm.

- **Fix — bone ownership was one joint too far down the chain.** The forearm runs elbow to wrist, and it is the ELBOW that moves it; rotating the wrist should move the hand. Every capsule was bound to the joint at its tail instead of its head, so each joint dragged the bone above it. The weight colours were never wrong — the assignment genuinely was what they showed — which is why this read as a rotation problem rather than a binding one. **Rigs bound before this need a rebind.**
- **Change — bone colours are assigned, not hashed.** Each joint now takes the palette colour furthest in hue from its parent, its grandparent and its already-coloured siblings. A hash spreads colour evenly across the whole rig but says nothing about any particular adjacent pair, which is how a shoulder and an elbow ended up pink and purple — the one boundary the preview exists to show. Capsules wear the colour of the joint that moves them, matching the vertices they claim.

# v3.17.21
**Rigid nearest-capsule binding, with the weights painted on the mesh.** Weights were still reaching well past the capsules they came from. The fix is to stop blending entirely: one bone per vertex, decided by which capsule it is nearest.

- **Change — the bind is rigid.** Every vertex belongs to exactly one bone, weight 1, chosen by nearest capsule. No falloff, no multi-influence blend, no smoothing pass. Any falloff spreads influence past the capsule it came from, so the capsules stopped predicting the deformation no matter how carefully they were tuned. Smoothing and delta mush go on top of a correct assignment later; neither can rescue a wrong one. Smoothing is still available via `window._skinSmooth`, off by default.
- **Feature — weight colour preview.** Each bone gets a saturated identity colour, its capsule is drawn in that colour, and on bind every vertex is painted the colour of the bone that owns it. Weights reaching past their capsule are now something you see rather than something you infer. Vertices no bone claims go near-black. Toggle: Weights in the mini panel; the mesh's real colours are restored when it is turned off, when the mesh is unbound, and whenever you leave the Bones tool — so a preview can never be saved into a sculpt by accident.
- **Feature — Radius mode re-solves live.** Dragging a capsule radius on a bound mesh re-solves the weights under your hand (throttled, and measured against the bind pose so it stays correct on a posed character), so the territory recolours as the capsule grows. Undoing a radius change undoes the weights with it. `window._boneLiveWeights = false` disables it.
- **Note** — nearest is measured in units of each capsule's own radius, so a thin finger capsule cannot win territory from a thick torso one purely by sitting closer to the surface.

# v3.17.19
**Bind capsules, drawn and editable — and a falloff that actually stops.** The default weighting was too broad and too soft, and the capsule radius behind it was an invisible guess. It is now geometry you can see and grab.

- **Feature — capsules are drawn.** Every bone shows the capsule its weights are measured against, as a translucent envelope with the same xray ghost as the rest of the skeleton, so it reads through the sculpt. Toggle: Capsules in the mini panel.
- **Feature — Radius mode.** A fifth mode: trigger-hold near a capsule and its radius follows the controller's distance from the bone. Inflate the envelope until it contains the limb and let go. Mirrored bones follow their twin, and each drag is one undo step.
- **Feature — capsule size is a knob, not a constant.** The default radius (a fraction of the bone's own length) is a slider in the mini panel, with Apply To All to push it onto a skeleton already drawn. It was hard-coded at 0.15 with nothing behind that number; the default is now 0.5, but the point is that it can be judged by eye.
- **Change — the capsule falloff has compact support.** Weight now falls to exactly zero at the capsule wall instead of trailing off forever. Under the old inverse-square kernel every bone kept a small say in every vertex, the four influence slots filled with whatever was nearest after the real one, and the radius could only ever set a relative scale between bones — no value of it tightened anything. The drawn capsule is now precisely the region a bone can influence.
- **Change — vertices outside every capsule bind rigidly to the nearest bone**, and the bind reports how many did. A large count means the capsules are too small, which is now a number rather than a mystery deformation.
- **Tuning hatches:** `window._skinPower` (falloff exponent, default 2), `window._skinSmooth` (smoothing iterations, default 3), `window._boneRadiusFrac`, `window._boneShowCapsules`.

# v3.17.18
**Fix — joints could not be moved after a selection change.** Grabbing a joint selected it, selecting runs the tool-context switch, and that re-applied the already-active tool — which discarded the outgoing tool's preview state unconditionally, cancelling the grab on the frame it began.

- **Fix — re-applying the current tool no longer throws away work in progress.** Switching tools still clears the previous tool's preview; merely selecting something no longer does. This also protects extrude's tagged faces, which a selection change would otherwise have silently dropped.
- **Fix — joint selection syncs on release.** The outliner now follows a grabbed joint once the drag finishes, rather than mid-grab.

# v3.17.17
**Two overlay fixes.** Both are helper visuals outliving the moment they belonged to.

- **Fix — extrude's face tags clear when you leave the tool.** The yellow multi-face tags are a world-space overlay drawn on top of everything; switching tools left them on screen as ghost faces under whatever came next. Switching away now drops the tags. They are dropped rather than hidden on purpose — an invisible-but-live selection would mean the next extrude silently acting on faces you cannot see.
- **Fix — helper overlays no longer break the browser-save thumbnail.** The thumbnail frames its camera from the scene's bounding box, and that box ignores whether an object is visible. A parked bone preview or a set of face tags could therefore stretch the box far past the sculpt, pulling the camera back until the model was a speck or out of frame. Skeleton visuals and face tags are now excluded from both the framing and the render.

# v3.17.15
**Skin weights save, FK posing, and a clearer bind.** Weights now survive a reload, joints can be rotated to pose the character, and binding tells you what it actually did.

- **Feature — skin weights are saved.** Influences, weights, the bind pose and the inverse bind matrices all round-trip through `.sxr`, stored alongside the skeleton they index into. A file whose vertex count no longer matches its weights is refused with a warning rather than deformed with stale indices.
- **Feature — Pose mode.** A fourth mode in the mini panel: trigger-hold a joint and the controller's rotation drives it, pivoting on the joint's own origin, with children riding along through the hierarchy. Translation is ignored on purpose — moving joints is Tweak's job, and a pose that also moved them would quietly rewrite the rig's proportions.
- **Feature — joint selection is shared with the outliner.** Selecting a joint in the outliner lights it in the scene, and grabbing one in the scene selects it in the outliner.
- **Fix — bind says what it bound.** Drawing a chain leaves the last joint selected, so "select a mesh and bind" could silently bind a joint locator instead of the character. Binding a joint is now refused with an explanation, and a successful bind reports the mesh, joint count, vertex count and time taken.
- **Fix — binding is much faster.** The weight-smoothing pass was allocating per vertex per iteration; on a dense sculpt that read as a freeze.
- **Fix — a bad mesh can no longer hide the skeleton.** Joint and bone sizing is derived from the scene's largest mesh, so a single non-finite bounding radius used to scale every marker to nothing.
- **Fix — small rotations re-skin.** The change detector sampled only the matrix diagonal, which is insensitive to small rotations — exactly what posing produces.

# v3.17.11
**Bind a mesh to a skeleton.** Second phase of the rigging work: joints now deform geometry. Standard linear blend skinning — capsule falloff for the initial assignment, a smoothing pass over the weight field, four influences per vertex.

- **Feature — bind.** With the *Bones* tool active, select a mesh and press **Bind Mesh** in the mini panel. Each vertex is weighted against the nearest bone segments, then the weight field is smoothed so the boundary between two bones blends instead of creasing.
- **Feature — deformation follows the rig.** Moving a joint deforms the bound mesh. Skinning runs last in the deformation stack, on top of blendshapes and animation layers, so a rigged character can still carry its shapes.
- **Feature — unbind.** Returns the mesh to its bind pose and releases the topology tools.
- **Note — binding freezes topology.** Weights are per-vertex, so voxel, cut, extrude, inset, weld and the other vertex-count-changing tools are blocked while a mesh is bound. They are blocked rather than allowed to silently invalidate the weights; unbind to get them back.
- **Known gaps:** weights are not saved yet; joints can be translated but not yet rotated in place; a straight-line falloff can reach across a gap (a hand near a hip), and heavy twisting will pinch, both of which have standard fixes still to come.

# v3.17.10
**Bones — draw a skeleton by hand, in the volume.** First phase of the rigging work: joints are placed with the controller tip *inside* the mesh, which is the thing a flat screen cannot do. No auto-centring, no medial-axis fitting — those exist to work around a missing depth channel, and in VR there isn't one to work around.

- **Feature — draw chains.** *Bones* tool: trigger places a joint at the controller tip, auto-parented to the previous one. Click-per-joint rather than a continuous stroke, so every joint lands where you meant it. **A** ends the chain. Each joint is one undo step.
- **Feature — branch anywhere.** Between chains, the nearest joint is preselected (amber, and larger). Trigger there and the new bone shares that joint as its root — spine to clavicles to arms, with no separate parenting UI.
- **Feature — see through the mesh.** Joints, bones and the controller tip all draw an xray pass that appears only where they are occluded. Without it you are aiming a tip you cannot see.
- **Feature — tweak mode.** *Tweak Free* drags a joint while its children stay put in world space: move the knee, and thigh and shin re-aim while foot and toes hold. *Tweak FK* is the plain hierarchy behaviour, children follow. Modes and toggles live in the mini panel on the non-dominant hand.
- **Feature — symmetry plane, drawn.** The plane is visible and lights up when the tip is close enough to snap, so you can see that a hip or spine joint will be centred before you commit it. Joints on the plane are not mirrored; joints off it get a twin, named `_L` / `_R`.
- **Feature — axis snap.** A bone's direction snaps to a world axis within 5 degrees, preserving its length. Eye bones point exactly down Z.
- **Feature — bone lengths.** Optional readout at each bone's midpoint, for eyeballing that an upper and lower limb segment match.
- **Feature — skeletons save.** Scene hierarchy is now written to `.sxr` and restored on load. This is a *general* hierarchy block, not a bones one, so hand-parented rigs (an eye parented to a head) also survive a save for the first time — previously they were silently flattened. Old files load unchanged and old builds ignore the new block.

# v3.17.0
**Nomad Link — a live, two-way connection to Nomad Sculpt.** SculptXR now speaks Nomad's own bridge protocol (the same one the Blender and Houdini bridges use), so a sculpt can move between an iPad and a headset while you work: sculpt in Nomad and watch it update in VR, retopologise or use the low-poly tools here and push it back.

- **Feature — connect to Nomad.** *Files → Nomad Link*: enter the address from Nomad's Link menu and press **Connect**. Pairing is approved once on the device and remembered; the address is remembered too, so a reload reconnects in one tap. **Get scene** / **Get selection** pull geometry across.
- **Feature — live receive.** Each completed stroke in Nomad arrives as a sparse update (only the vertices it moved) and is applied in place, so a heavy scene stays cheap to follow.
- **Feature — send back.** **Send selected to Nomad** pushes the selected mesh, replacing the object it came from — one undo step over there. Quads stay quads, and face groups, UVs, vertex colour, roughness/metalness and the sculpt mask all survive the round trip.
- **Feature — live send.** With **Send edits live** ticked, every finished stroke goes to Nomad as a sparse update; anything that changes topology (remesh, weld, subdivide) sends the whole mesh instead. New meshes made here appear in Nomad on their first stroke, deletions propagate both ways, and undo/redo travels too.
- **Feature — instances.** Nomad's shared-geometry placements (mirrored eyes and the like) arrive as real linked instances — they share one mesh, so sculpting either updates both.
- **Feature — sculpt lock.** A "do nothing" mode in *Sculpting → Safety* and the VR radial menu: every sculpt input is ignored until you unlock. For when hand tracking grabs a stroke you didn't mean.
- **Note — connect before entering VR.** The browser asks permission to reach a device on your local network, and that prompt cannot be answered from inside a headset session.
- **Note — scale.** A Nomad scene is about one unit across, so linked meshes are scaled up on arrival (`?nomadScale=50` by default; only object transforms are scaled, so round trips can't drift).
- **Known gaps:** transforms made in SculptXR are not sent back; Nomad's procedural modifiers stay on Nomad's side; materials, textures, lights and cameras are ignored.

# v3.16.0
**Editable shape-layer keys + timeline clipboard shortcuts.** Follow-up to the v3.15 animation layers (#34): the keys on a layer row are now first-class dopesheet keys you can select, move, delete, and box-transform — and the desktop copy/cut/paste/delete shortcuts now work on every key type.

- **Feature — edit layer keys.** In the dopesheet, click a shape-layer key to select it (turns gold), drag to retime (snaps to frame), and it composites live. Previously the layer rows were display-only.
- **Feature — cross-layer multi-select.** **Shift-click** keys across non-contiguous layers (1, 3, 7), or **marquee** a box over several layer rows. A drag then moves the whole group rigidly.
- **Feature — transform box on layer keys.** With the transform box on and 2+ layer keys selected, drag its edges/centre to retime or scale the selection across layers — same as transform/shape keys.
- **Fix — desktop key shortcuts now work on layer (and all) keys.** **Ctrl+C / Ctrl+V** copy/paste selected keys (paste lands the earliest key on the playhead), **Ctrl+X** cuts, and **Delete / Backspace** (mouse over the timeline) removes the selection. These previously did nothing when layer keys were selected, and **Ctrl+X** / **Delete-key** had no binding at all.
- **Fix — delete is consistent everywhere.** The toolbar **×** button, the right-click **Delete**, and the **Delete** key all route to one complete implementation, so every key type (transform / shape / **layer** / blendshape) deletes and undoes the same way, in a single step.
- **Note:** layer keys carry vertex deltas, not a scalar value, so the transform box scales them in *time* only (vertical value-scaling is a no-op, as with frame keys).

# v3.15.0
**Animation layers — record deformation in stacked, combinable layers.** The vertex "keep-alive" recording (v3.13) now supports **layers**: record a base motion, add a layer, and each layer's edit composites on top and *rides* the earlier motion (a smile rides an opening jaw).

- **Feature — shape layers.** In the timeline (Shape key-mode), **`+L`** adds a layer; recording targets it, capturing its deformation as a *delta* on top of the base. Playback = base + Σ layers, so a later layer rides the motion beneath it.
- **Feature — layer rows in the dopesheet.** Each layer is its own track: name, mute (**M**), delete (**×**), keys, and an armed indicator (gold **●**). Click a layer's name to arm it for recording (click the active one again → back to the base).
- **Feature — combine layers.** A **selection dot** on each layer row (drag *through* the dots to multi-select), then **Combine** in the "…" menu (desktop) or the radial menu (VR) merges the selected layers into one.
- **Feature — per-layer undo.** Release the trigger and Undo removes just that layer's last recorded wave (and its deformation), in one step.
- **Feature — blendshape tracks in the dopesheet** now show a per-row name / mute / delete too.
- **Fix — "Start on click" recording** now works for shape takes (was transform-only); and a stroke made while a take is paused resumes the loop and records.
- **Change — dopesheet navigation:** the vertical mouse-wheel now scrolls the lanes (never pans time), and middle-mouse pans (vertical + time), matching the graph editor.
- **Note:** layers record in "pose that rides" mode — the base freezes during a layer stroke and the captured delta rides it on playback, so overlapping edits stay seamless.

# v3.14.0
**Transform gizmo overhaul (desktop + VR).** New free-transform handles, much better picking, and VR fit-and-finish.

- **Feature — center handle.** A sphere at the gizmo centre: drag it to translate freely in the plane perpendicular to the camera (desktop) / follow the controller in all axes (VR).
- **Feature — trackball free-rotate.** Click (desktop) or grab (VR) inside the rotation sphere, off the rings, to arcball-rotate freely — ideal for posing a hand or an eye.
- **Fix — pick accuracy.** Picking is now priority-tiered (centre → planes → arrows/scale → rings) so you select what's under the cursor instead of a fat arrow base or a ring behind it. Plane handles are grabbable from any angle; the trackball has a centre exclusion zone so it never steals the plane/centre handles; rings pick only from their visible side, so clicking *outside* the gizmo no longer grabs a hidden rotation.
- **VR — constant gizmo size.** The gizmo no longer balloons or shrinks with double-grip world zoom; it holds a fixed size like the menus and panels. New **Gizmo size** slider (0.25×–2×, persistent) in Settings replaces the old Gizmo scale slider.
- **VR — transform cursor cleanup.** The surface-snapping radius ring is hidden during transform (it read as "pushing against the mesh"), and the dominant controller's stylus tip now shows a subtle xray reveal *only* when it dips under a mesh surface — so reaching for the centre handle inside the mesh isn't flying blind.
- **Files menu tidy.** Tightened to fit the VR panel: import options ("Scale & center on import", "sRGB color") and OBJ export options ("OBJ ZBrush", "OBJ append") are now checkboxes, two per row; "Export all meshes" is a checkbox moved after the format buttons.

# v3.13.3
**Vertex recording — capture polish + per-wave undo.** Follow-up refinements to the v3.13.0 "keep alive" recording.

- **Fix**: the **VR timeline Record button** now arms recording. It was silently doing nothing when no object was the actively-picked mesh; it now resolves the target the same way the animation panel does.
- **Fix**: **keyframes no longer roll between loops.** Captured keys snap to a fixed frame grid, so re-passing the loop lands on the *same* frames instead of drifting a frame each pass and wedging new keys between the old ones. The capture rate is now whole-frame-aligned to your FPS.
- **Feature**: **per-wave undo.** Release the trigger and **Undo** removes just that last recorded motion — and the sculpt that made it — in a single step. Perform a wave, decide against it, undo, and the earlier waves stay put. Redo restores it.
- **Under the hood**: capture and the "prior waves keep playing under your stroke" rebase now run on one render-loop clock, removing a timing race that added jitter.

# v3.13.0
**Performance-record vertex deformation — "keep alive" sculpting.** Puppeteer a sculpt into motion: with the timeline looping, hold the trigger (or mouse) and sculpt, and your live deformation is recorded as animation. Build it up in waves — wobble the hair on one pass, the beard on the next.

- **Feature**: **Vertex performance recording (Shape mode).** Arm Record, set the key mode to **Shape**, and sculpt while the loop plays — the deformation under your brush is captured into a shape track at the capture rate. Move-brush a hairstyle to wiggle it in the wind, then loop it back.
- **Feature**: **Record in waves, additively.** The loop keeps playing the whole time you record. Keys are only laid down *while the trigger/mouse is held*, so you can perform one region, release, and perform another over a later pass — earlier waves keep animating underneath your new stroke.
- **Feature**: **Puppeteer against live motion.** While you sculpt, the prior waves keep playing under your brush instead of freezing; the verts you're grabbing follow your hand on top of that motion.
- **Detail**: keys are clocked off the visible playhead so they land where you see it; punch-in overwrite only touches the span you re-perform; the draw cursor stays visible while recording; takes are undoable and save/reload with the `.sxr`.
- **Note (MVP limitation)**: Shape recording stores full-mesh snapshots, so keep it to **relatively lightweight sculpts** for now (dense meshes make large takes). It needs a fixed topology — turn dyntopo off before recording.

# v3.11.0
**Unified frame-by-frame animation + persistence.** Voxel and mesh cel animation now live on one platform — each frame is a real object in the outliner driven by keyframed visibility — and voxel animations fully save and reload.

- **Feature**: **Frame animation as real objects.** Frames are children of a frame group in the outliner (collapsed by default), driven by a keyframed visibility track — one frame shows at a time. Works the same for voxel and mesh frames. Lay frames with **New / Dup / Delete** in the dopesheet SR row; scrub or play to flip through them.
- **Feature**: **Voxel animation saves and reloads.** Per-frame distance fields are stored in the `.sxr` (compressed), so a saved voxel animation reloads fully re-sculptable — no bake step. Surfaces, group structure, frame timing, and names all round-trip.
- **Feature**: **Frame copy / paste.** Select frame markers and **Ctrl+C / Ctrl+V** to copy them to the playhead (earliest lands on the playhead, spacing preserved). **Ctrl+Shift+V** pastes a **linked instance** — sculpt one and every linked copy updates (reuse a phoneme once). "Make unique" breaks the link. Also on the VR radial menu.
- **Feature**: **Linked instancing.** Duplicate an object as a linked instance that shares geometry — edits (sculpt and paint) propagate live to all occurrences; a chain glyph marks linked objects; make-unique breaks the link. Instance links persist through save/reload.
- **Feature**: **Autokey button** added to the timeline toolbar (mirrors the animation panel), and the desktop **Grab** tool now autokeys like the transform gizmo.
- **Feature**: **Split key-mode buttons.** The XF / SH / BS / SR row is now two-part: the top selects the keyed mode, the bottom toggles that type's visibility in the sheet; click the keyed mode again to solo it.
- **Persistence**: `.sxr` now also saves **mesh names** (fixed — multi-resolution meshes were saving as "Mesh N") and the **camera framing**, so a reload restores your viewpoint.
- **Fix**: keyframe selection respects the visibility filter — hidden key types can't be picked or marquee-selected (so copy/paste never drags along a hidden key).
- **Fix**: the VR save-name keyboard now appears in front of the menu panel instead of at the world origin.
- **Change**: the old cel-animation system was retired in favour of this unified platform; voxel animation no longer needs the "bake before saving" step.

# v3.10.0
**Frame-by-frame (cel) voxel animation** — draw a voxel object frame by frame and play it back, edited directly in the timeline dopesheet.

- **Feature**: **Frames in the dopesheet.** With a voxel object selected and the voxel tool active, the dopesheet gutter swaps to **New / Dup / Delete** — laying down time-keyed frames at the playhead (Dup copies the held frame, New is blank). Frames are *held* keys: the one shown is the latest at or before the playhead. Scrub or play the timeline to flip through them.
- **Feature**: **Retime in the dopesheet.** Frame ticks are full keys — click-drag to retime, drag past a neighbour to reorder, marquee-select and drag many, and the transform box to scale timing. Undoable.
- **Feature**: **Onion skinning** — ghost the neighbouring frames (blue = previous, red = next) while you draw, with a **loop-aware** option that wraps around the ends for cyclic animations. Off during playback.
- **Feature**: **Sculpting is gated to on-frame** — strokes only register when the playhead sits exactly on a frame, so an edit is never ambiguous. Works in VR (commit + gate wired into the VR stroke path) as well as desktop.
- **Feature**: **Desktop voxel Move tool** with a live drag preview (was VR-only).
- **Persistence**: frame sequences save and reload with the `.sxr` file.
- **Fixes**: empty voxel objects no longer flicker stale geometry or hide the draw plane; the wireframe no longer spams warnings on an empty voxel; VR animation-panel checkboxes are now clickable.
- **Change**: the browser-saves panel is now a thumbnail grid with a Load / Import / Delete toolbar (Load replaces the scene; Import appends).

# v3.9.6
- **Change**: the "new version available" notice is now a small dismissible pill at the bottom-centre instead of a full-width top bar, so it never blocks the toolbar / mid-flow actions.

# v3.9.5
- **Fix**: **Wireframe now works on voxel objects** — both the W shortcut and the Rendering panel toggle. The W shortcut falls back to the active mesh (a voxel object isn't in the selection list), and the wireframe overlay rebuilds from current geometry + rebinds on each voxel edit (it was empty/stale before).
- **Fix**: the update-banner Reload now confirms first (no accidental loss of unsaved work).

# v3.9.2
- **Fix**: **Stale-build detection.** The app now compares its baked version against the live `version.json` and shows a "New version available — Reload" banner when a cached old build is loaded; the reload cache-busts the URL. Also added cache-control headers (no-cache on `index.html`/`version.json`) so updated builds are picked up on refresh instead of serving a stale cache.

# v3.9.1
- **Fix**: **VR navigation inertia now fires on Galaxy XR** (and other runtimes that damp controller motion at release). The throw launches from the strongest recent velocity sample rather than the final frame, so a flick-and-release glides reliably.

# v3.9.0
Voxel draw-plane controls — surface mode, a movable/tiltable work plane, and clearer plane visuals.

- **Feature**: **Surface mode.** A new toggle in the voxel panel switches strokes between the draw plane and tracking the existing voxel surface (sculpt detail on what you've made). Brush stays a fixed world size in both.
- **Feature**: **Plane depth + tilt handles.** A left-edge depth slider pushes the draw plane along its normal (build up in slices; double-click to centre), and a tilt pad angles the plane (yaw/pitch; double-tap to reset) — both available in Camera and World-locked modes.
- **Change**: **Clearer draw plane.** The plane now shows as a translucent filled sheet plus a grid (line width can't be increased in WebGL), so it reads clearly on desktop and iPad.

# v3.8.0
Desktop voxel sculpting — the voxel toolset now works on desktop, including drawing into empty space on a movable work plane.

- **Feature**: **Voxel tools on desktop.** The voxel options (Add/Sub/Smooth/Inflate/Deflate, Sphere/Box, Build Up, Flat/Wire, Resolution + Resample, Convert to Mesh) are exposed in the Sculpting tab when a voxel object is active, and strokes deposit correctly with a fixed world-space brush size, an xray sphere cursor, and per-stroke undo.
- **Feature**: **Plane drawing (sketch into empty space).** Add Object → Voxel makes an empty object you can draw into: strokes land on a draw plane shown as a faint grid. The plane can be **Camera-locked** (follows the view) or **World-locked** (frozen in space so you can orbit around your drawing), toggled in the voxel panel.
- **Feature**: **Plane depth control.** A vertical depth slider (left edge) pushes the draw plane in/out along its normal, so you can build up volume in slices. Double-click resets to centre.
- **Change**: **Right-drag orbits** the camera (the browser context menu is suppressed on the canvas), so you can rotate the view while the cursor is over the infinite draw plane.

# v3.7.0
Blendshape layer reordering plus a batch of VR navigation/ergonomics improvements.

- **Feature**: **Drag-to-reorder blendshape layers.** Each layer row now has a grip handle (left of the eye) — drag it up/down to reorder the stack. The row body still selects / double-click-renames and the weight slider keeps its left/right drag, so there's no conflict. Order persists in saves.
- **Feature**: **Navigation inertia (VR).** Releasing a single-grip world move now keeps gliding with momentum — both position and rotation — and eases to a stop, instead of dead-stopping. Any new grip, two-handed move, or sculpt stroke cancels it.
- **Feature**: **Quick tool-swap (VR).** Click the left thumbstick to toggle between your two most-recent tools (Alt-Tab style; Smooth is excluded so dipping into it won't break your pair). A tool-name label briefly floats above the right controller.
- **Feature**: **Controller button labels (VR).** A short cheat-sheet of the current button assignments floats beside each controller for the first few seconds of a session, then hides. Toggle anytime from the console with `toggleVrButtonLabels()`.

# v3.6.0
Voxel sculpting restored — the voxel options lost in the GUI migration are back in the menus, plus fixes to the box-mode brush cursor.

- **Feature**: **Voxel menu restored.** Add Object → Voxel creates a voxel object, and the voxel extras panel re-exposes every option that had been stranded in the old VR GUI: brush modes (Add/Sub/Smooth/Move/Inflate/Deflate), Shape (Sphere/Box), Align-to-hand, Build Up, Flat/Wire display, a Resolution slider with live density preview, Resample, and Convert to Mesh.
- **Fix**: **Box cursor was tilted in world-align mode.** With Box + Align-to-hand off, the stamped voxels were correctly grid-aligned but the preview cube on the controller leaned by the world rotation. The cursor now matches the grid the stamp actually lands on.
- **Fix**: **Voxel brush cursor size drifted when you grip-scaled.** The preview cube/sphere only matched the real brush at the default world scale; after scaling it diverged. The preview now tracks the world scale so it stays accurate at any zoom.
- **Change**: **Surface ring hidden in voxel mode.** The thin circle cursor was mis-sized and not useful for voxels — the volume sphere/cube is now the sole brush indicator there.

# v3.5.0
Unified menu theme — the canvas panels (timeline + blendshape stack) now match the HTML menus.

- **Change**: **Menu colour grade applies to the canvas panels too.** The Settings Brightness/Saturation/Gamma sliders now affect the timeline and blendshape panel (they're canvas-textured meshes, so they weren't getting the grade before). Values persist and update live, same as the HTML panels.
- **Change**: **Shared theme palette.** New `src/gui/theme.js` (Catppuccin Mocha — the colours the HTML CSS already uses) is the single source of truth; the timeline and blendshape panels now reference it for all chrome (backgrounds, headers, gridlines, borders, text), so the neutral grays become the menu's blue-tinted palette and read as one theme. Semantic colours (keyframe types, channel colours, status) are unchanged.
- **Change**: **Default menu saturation 55 → 50.** A one-time migration re-applies the menu defaults (brightness 65 / saturation 50 / gamma 0) to existing installs.

# v3.4.1
- **Fix**: **Panel icons showed as placeholders in immersive on GalaxyXR** (desktop was fine). The v3.3.1 perf fix stopped inlining fonts into the CSS bundle, so Font Awesome glyphs were no longer embedded — and the panel rasteriser can't fetch `url()` fonts at paint time in immersive. FA Solid is now injected as a single base64 `@font-face` synchronously at startup (committed `faSolidBase64.js`), before the rasteriser caches stylesheets. CSS stays lean (~180 KB); per-paint adds one ~210 KB font copy.
- **Fix**: **New menu-colour defaults didn't apply to existing installs.** The brightness/saturation sliders were dead until v3.4.0, so saved values are stale old-defaults (e.g. 100% saturation) that overrode the new 65/55/0. A one-time migration forces 65/55/0 once, then respects user changes.

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
