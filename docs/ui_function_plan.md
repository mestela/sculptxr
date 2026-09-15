# Placement plan — where the unreachable functions go

Companion to `ui_function_audit.md`. IDs (A1, B3, …) are that document's.
Date: 2026-09-15.

## The one design decision everything else follows from

**A marking-menu command resolves its target by HOVER. A panel control has no hover.**

Every command in `_resolveRadialCommands` / `_resolvePinCommands` resolves through
`Skeleton.hoveredJoint(main)` first and the selection second, then *freezes* that at open so
moving the hand to pick a sector cannot change what gets acted on. A panel button cannot do
that — there is nothing under the pointer when you reach for a panel.

So the rule for every item below:

> **The panel copy acts on the SELECTION. The marking menu keeps acting on hover. One
> function, two target resolvers.**

This is not a new idea in this codebase — it is how the physics block already works
(`PhysicsBones.panelTarget(main, physSel)`, bonePanel.js:~125) and how the joint Sharpness
slider works (`roundSel.length === 1 ? roundSel[0] : null`). Add one shared helper,
`rigPanelTarget(main)` — "the single selected joint, resolving a pin to the joint it holds,
else null" — and have every new control below use it, so there is one answer to "what does
this panel act on" instead of six.

### Why selection is now a safe thing to build on

There is a comment in the Set Parent wiring (MainMenuPanel.js:~3913) saying the selection
"cannot be set reliably on a flat screen — only the Transform tool selects rig nodes". **That
comment is stale.** Two things have changed since:

* **The outliner selects joints.** Joints are ordinary meshes with `_permanentStaticLabel`,
  they render as outliner rows, and the row handler calls `setOrUnsetMesh` with no joint
  filter and no tool gate (MainMenuPanel.js:3820). It works on every platform, with no hover,
  no controller and no particular tool active. This is the most reliable selection path in the
  app and it is the one hands-only and iPad both have.
* **The Select tool exists** (v3.36.0, `Enums.Tools.SELECT`), written specifically because
  "every existing way to choose an object in the viewport also moves it", and it picks rig
  nodes.

The stale comment should be corrected as part of this work so it does not talk the next
person out of the same plan.

---

## Group A — rig topology

### A3, A4 — no new UI. Fix the buttons that already exist.

The outliner toolbar already has a copy button and a trash button that already act on the
selection. Neither needs a new home; both need their rig case handled.

* **A4** — `deleteCurrentSelection` (Scene.js:4390) already cascades the subtree correctly via
  `_withDescendants` and already records the right undo entry. It just never calls
  `Skeleton.updateVisuals` + `Skeleton.refreshOutliner`, so capsules, pins and labels go
  stale. Two lines at the end, guarded on the removed set containing a joint.
* **A3** — `duplicateSelection` (Scene.js:4550) makes a bare `MeshStatic`, and `copyData`
  carries no rig fields. Branch at the top: if every selected mesh is a joint, hand the whole
  thing to `RigTopology.duplicate` and return.

Do these two first. They are the cheapest items in the entire audit and they make two buttons
that currently lie start telling the truth.

### A1, A2, A5 — a new "Edit Chain" row in Rig Authoring

Home: `bonePanel.buildBoneAuthoringHTML`, below the existing snap/symmetry `c.toggles` row.

```
Rig Authoring
  [ Draw ][ Tweak ][ … ]            ← existing mode grid
  [ Snap Plane ][ Snap Axis ][ Sym ] ← existing
  ── Edit Chain ──                   ← new
  [ Split ][ Dissolve ]              ← A1, A2 — c.btnRow, disabled via RigTopology.canSplit/canDissolve
  [ Name chain… ]                    ← A5
```

* Enabled state comes from the same `RigTopology.canSplit` / `canDissolve` predicates the ring
  uses, asked of `rigPanelTarget(main)` instead of the hover target.
* The `inBoneTool` gate the ring applies is **not needed here** — this block only renders when
  the Bones tool is active, so the gate is structural rather than conditional. Same outcome,
  one less thing to keep in step.
* **A5 needs an input, not a button.** Two parts: a row of the preset names
  (`Skeleton.LIMB_NAMES` / `Skeleton.AXIS_NAMES`) with a switch between the two sets, and a
  free-text field. On desktop the field is a plain `<input>`; in VR it routes to `VrKeyboard`,
  which `_resolveRadialCommands` already does (Scene.js:11965) — reuse that call, do not write
  a second one. Given its size, A5 is the one item here that may deserve its own collapsible
  sub-block rather than a row.

Note: once A1–A5 have panel homes, the timeline's `…` menu (F1) is carrying rig-topology
commands for no reason. It can drop them and keep the key commands it is named for.

---

## Groups B and C — pins

Home: `bonePanel.buildBonePoseHTML`, which is exactly the right container — it already renders
in **all three** tools that bind the A-button pin cycle (Bone Draw, Grab, TransformVR), and it
is already shared by the main panel *and* the wrist panel.

**Model it on the physics block, which solves the identical problem two hundred lines up:** a
flag/mode control that reads the selection, plus a named sub-block that only appears once
there is a target to talk about.

```
Pose
  [ Clear Pins (3) ][ Rest Pose ]        ← existing
  [ Mirror Pose ][ Copy Side ]           ← existing

  ── Pin: L_wrist ──                     ← new, only when rigPanelTarget() is a joint
  [ Position ][ Pos + Rot ][ Rot Only ]  ← B1, B2, B3
  [ Aim ][ Unpin ][ Ground: On ]         ← B4, B5, B6
```

* Six chips in a `c.toggles` grid. **Dim the mode it is already in**, which is the ring's own
  rule and the only thing in the control that says what the current state is.
* B6 Ground is a `flagButton`, and — like the ring — only appears once a pin exists. B1–B5
  are always live on a joint.
* **Name the joint in the section title**, as the physics block does (`Physics: ` + physName).
  A pin control that will not say which joint it is about is the complaint the physics sliders
  were rewritten to fix; do not reintroduce it.

### C1–C5 — a Pin Weight sub-block

Appears only when the selected joint **has** a pin, mirroring how the physics sliders appear
only when `physTarget` exists:

```
  ── Pin Weight ──
  [ Activate Here ][ Deactivate Here ]   ← C1, C2
  [ Match Here ][ Half ][ Clear Keys ]   ← C3, C4, C5
```

C5 carries the ring's enabled test verbatim (a scalar track must exist). C1–C4 are always
enabled — the ring's comment on that is load-bearing: keying a value the channel already reads
still *puts a key there*, and dimming it made the command silently refuse.

### The one wrist-panel call to make

`buildBonePoseHTML` is rendered by the MiniPanel too, so B and C land on the wrist for free.
That is right for **B** — choosing a pin mode is something you do constantly while posing, and
it is the single biggest win for hands-only. It is arguable for **C**, which is setup work.

`buildBoneAuthoringHTML` already has the pattern for this: `const full = style !== 'mp'`, with
once-a-session controls wrapped in `${full ? … : ''}` to keep the wrist panel a wrist panel.
**Recommendation: B unconditional, C behind `full`.** Easy to change later; worth deciding
deliberately rather than by default, given "the bones minipanel is hardly a minipanel anymore".

---

## Group D — the MiniPanel strays

All four go into the main panel's **Properties** section (`buildSculptingHTML(main, 'props')`),
each next to controls that are already there.

| | Where | Note |
|---|---|---|
| **D1** grab channels | A `Grab` labelled pair, shown when `cur === GRAB` | Copy the existing `Motion Path` pair exactly (`mm-path-translate`/`mm-path-rotate`, MainMenuPanel.js:~2520) — same shape, same dialect. Must go through `GrabChannels.setChannel`, never the globals: turning off the last channel has to turn the other back on. |
| **D2** Connectivity | Beside the `Motion Path` pair, when `cur === MOVE` | Write live value first, saved second — the order every persisted setting in this file uses. |
| **D3** TransformVR mode | Into `transformPanel.buildTransformSectionHTML`, next to `Free rotate` | **Best fix of the four**: that builder is already shared by both panels, so adding it there gives it to the main panel *and* lets the MiniPanel delete its private `data-tvr-mode` copy. One control, one place. |
| **D4** voxel Align to hand | Into the existing `cols-3` voxel grid beside Build Up / Flat / Wire | The "omitted" comment at MainMenuPanel.js:2544 should go with it. |

---

## E1 — paint colour

Swap `<input type="color">` (`mm-paint-color`) for `buildColorWheelHTML({ prefix: 'mm-paint-cw' })`
plus a `new ColorWheel(...)` in the wiring. `ColorWheel` is **already imported into
MainMenuPanel** and already used there for the wireframe swatch (line 1537) — so this is a
swap against a working local example, not new code. Follow that example's shape: the swatch
opens the wheel, OK closes it.

---

## J1 — the touch affordance

The whole ring set exists on flat screen behind right-click only, so iPad and Pencil reach
none of it. Two candidates:

**Recommended — repurpose the ModifierButton.** It is already a floating on-screen button,
already placed in the thumb zone, already side-swappable for left-handers, and already shows
itself *only when the active tool has a secondary action* — which is exactly the set of tools
whose ring is worth opening (Grab, Transform, TransformVR, Bone Draw). Make it open
`openViewportMenu` at its own position instead of firing `SecondaryAction`.

*The tradeoff, stated plainly:* that removes the pin **cycle** from pen and touch. The
right-click comment (SculptGL.js:1578) already argues the ring is the better answer than the
cycle — "five states is two too many for a cycle" — and the menu reaches all five modes where
the cycle reaches two. So the cycle becomes redundant rather than lost. But it is a change to
existing behaviour on matt's primary drawing device, so it is his call, not mine.

**Alternative — long-press on the viewport.** Conventional, costs no screen space, and works
regardless of tool. Riskier: it needs a timer against a pointer stream that Safari already
mishandles on hover→touch transitions, and a long-press that fires mid-stroke would be worse
than no menu at all.

---

## G1 — copy / paste keys

These belong in the **timeline gutter**, next to the `addkey` / `delkey` buttons that are
already there (`GuiTimeline._gutterBtnDefs`), not in the main panel. They are key operations
and that row is where key operations live. This also lets the timeline's `…` menu shed the
last thing it is carrying that is not its own.

---

## Hands-only VR — does any of the above actually land there?

Mostly yes, and by construction rather than luck. The wrist panel is the *only* menu on a
hands-only runtime (Scene.js:9924), so the test for every item is "does its builder get called
with `style: 'mp'`?"

| | Home | Reaches hands-only? |
|---|---|---|
| A1, A2, A5 | `buildBoneAuthoringHTML` | **Yes** — MiniPanel renders `buildBoneSectionHTML` (= authoring + pose) for Bone Draw. Do **not** wrap the Edit Chain row in the `full` flag. |
| A3, A4 | outliner toolbar (main panel) | **Yes** — main panel is reachable via the wrist `Menu` swap button. |
| B1–B6 | `buildBonePoseHTML` | **Yes, and this is the big one.** That builder renders in the MiniPanel for **all three** pin tools — Bone Draw, Grab, TransformVR. Pin modes land on the wrist in every tool that used to need the A button. |
| C1–C5 | `buildBonePoseHTML`, behind `full` | **No, by choice** — main panel only. Reverse if it grates. |
| D1–D4 | Properties (main panel) | Yes, via the swap button. D3 additionally *removes* the MiniPanel's private copy. |
| E1 | Properties (main panel) | Yes — and it is the only way to set paint colour in a headset today, so this is a hands-only fix as much as a desktop one. |
| J1 | ModifierButton | **No — desktop/iPad only.** Correctly scoped; hands-only has no on-screen DOM. |
| G1 | timeline gutter | Yes — the VR timeline quad renders the same canvas. |

So the **commands** all arrive. What does not arrive is the **gesture**.

### The thing that is genuinely not replaced

A marking menu is one motion on the thing you are pointing at. The wrist panel is: select the
joint, look at your wrist, find the control, press. Same outcome, more steps — and the extra
steps are exactly the round trip the wrist quick-display block was added to kill ("i currently
find i have to keep jumping between the display options and the bone tool").

Worth being precise about what is missing, because it is narrower than it looks:
**hands-only still has hover.** The hand ray still preselects, so `Skeleton.hoveredJoint`
still resolves a target every frame. The ring's target resolution is fine. **Only the trigger
is missing.**

### Two routes already tried on device — do not re-propose

Both are recorded in Scene.js and both lost:

* **Palm-up to open a menu** — "tried on device and lost to Home View". On visionOS the index
  pinch is system select, palm-up is Home View, the crown is recenter.
* **A gaze-follow MENU button** — built, tested, wrong shape: "matt had to turn his pinching
  hand a long way to aim at it, could highlight it but took several attempts to click it."
  Off by default, kept only because it is the one menu route that survives losing wrist
  tracking.

The verdict written there is the position to argue against, not around: *"A target you must
acquire is worse than a panel that is simply already on your wrist."*

### Three options, cheapest first

**1. Accept the extra step (free — it is the plan above).**
Select the joint, act on the wrist. Costs one action more than the ring. This is already the
codebase's stated position and it needs no new machinery at all. Ship this first regardless,
because it is the floor under both options below.

**2. Arm-then-point, reusing the RigPending pattern.**
A `Menu` button on the wrist arms; the next dominant-hand pinch on a joint opens the radial
*there*, with the hover target frozen exactly as the B ring freezes it. This keeps the "acts
on what you are pointing at" property, which option 1 gives up.

The shape is not new — `RigPending` already does press-then-click-a-node for Set Parent and
Aim, in VR, and it works. It is the same three-step grammar, and the same `cancelPending`
cleanup. This is the option I would build if option 1 proves too slow in practice.

*Why the obvious version does not work:* a `Menu` button that opens the ring immediately is
useless, because to press your wrist your dominant hand is at your wrist — not pointing at the
joint. Arming is what decouples the press from the aim.

**3. Middle-finger pinch as the B button.**
Thumb-to-**middle** instead of thumb-to-index. Genuinely cheap to try: `middleTip` is
**already read every frame** for fist detection (Scene.js:9843), so this is one distance using
the same radius-subtraction formula and the same per-hand hysteresis that the index pinch
already has. No new input plumbing.

It is also different in kind from the two rejected routes: it is not a posture the OS watches
for, and it is not a target you must acquire — your hand can stay where it is pointing.

*Honest caveats:* it must be tested on device before anyone believes it, on AVP **and** Quest
— the radii differ per headset, which is exactly why the formula subtracts them. And there is
a real risk it fires during a fist, since a fist curls the middle finger toward the palm and
the thumb often rides along; the fist check measures middle-tip-to-middle-knuckle, so the two
gestures are separable, but the thresholds will need tuning against each other rather than in
isolation.

Given the history, this is the one to prototype behind a flag and A/B on device rather than
reason about further.

## Build order

1. **A4, A3** — two small fixes to existing outliner buttons. No new UI.
2. **B1–B6, C1–C5** into the Pose block. Biggest hole; two items unreachable on iPad by any
   route; lands on the wrist panel for hands-only at the same time.
3. **E1** — paint colour to ColorWheel. Small, self-contained, fixes a control dead in VR.
4. **A1, A2** — Split / Dissolve into Rig Authoring. **A5** after, since it needs an input.
5. **D1–D4** into Properties, D3 first (it deletes code rather than adding it).
6. **J1** — ModifierButton opens the viewport menu. Matt has approved dropping the pin cycle
   for pen and touch: "the cycle for the pin modes is terrible, its good to get rid of it."
7. **Hands-only option 2 or 3**, only if option 1 proves too slow in use. Prototype 3 behind a
   flag; it is one distance calculation against joints already being read.
8. **G1**, **H1**, and the stale-comment correction — tidy-ups.

Nothing here needs a deploy to evaluate; all of it is visible on desktop, and the VR-only
questions (wrist-panel height for B/C) need a headset session rather than a build decision.

---

# The wider tidy — is it subtabs?

Asked 2026-09-15: the bone main panel is bad, the bone wrist panel is ridiculous, the tools
page is too long, and the left icon bar is running out of room. Should Tools become
Sculpt/Lowpoly subtabs, Bones become Create/Animate/Physics, or is there something better?

**Short answer: not subtabs first.** Two of the four problems are miscategorisation rather
than crowding, and fixing those buys back the space without adding a navigation layer. Only
one of the four genuinely wants a second level, and it is not the one that looks worst.

## One idea checked and discarded

The tempting move was: the Bones tool already has a mode row at the top of its panel, so let
the mode row BE the subtab row — no new navigation to learn, and it is already the first thing
you look at.

It does not work. `MODES` is `draw, fk, free, pose, radius, joint, ik` (bonePanel.js:28) —
those are **pointer behaviours**, not lifecycle stages. Binding, Make Skin, physics and
display are orthogonal to all seven. Recorded so nobody spends an afternoon on it.

But the reason it fails is the actual diagnosis: **the bone panel crams two orthogonal axes
into one column.** Pointer mode (7 of them) and lifecycle stage (author → skin → pose →
physics → display). That is why it reads as a wall rather than as a long list.

## The icon-bar problem is not a crowding problem

The VR tab strip holds **nine** buttons — `scene, rendering, camera, topology, sculpting,
properties`, then blendshapes, animation, timeline (MainMenuPanel.js:1080) — in a 456px body
at ~44px each. It is nearly full, so the observation is right. But the list is doing four
different jobs at once:

1. **Switch this panel's content** — scene, topology, sculpting, properties, animation.
2. **Set once-a-session config** — rendering, camera.
3. **Launch a separate window** — blendshapes, timeline. These do not switch the tab at all;
   they spawn other panels, while looking exactly like the seven buttons that do. That is a
   category error sitting in the middle of the strip.
4. (and the top menubar does app/file work — files, history, background, reference, settings,
   about.)

Jobs 2 and 3 are not "the thing you are working on". Move them and the strip empties out:

* **Rendering and Camera → the top menubar**, beside Background / Reference / Settings. Same
  category — how the scene is lit, drawn and viewed, set and forgotten. Camera especially:
  in a headset the camera is your head, and the section is mostly spectator config.
* **Blendshapes and Timeline → out of the tab strip.** They are launchers. Either into the
  menubar or a small visually-distinct launcher group, but not sitting among the tabs
  pretending to be tabs.

Tab strip: **9 → 5** (`scene, topology, sculpting, properties, animation`). No second row, no
subtabs, and a genuine ambiguity removed. **Do this before anything else** — it is the
cheapest item here and it decides how much room the rest of the work has.

## Tools page — collapse, not subtabs

19 sculpt + 11 mesh tools = 30 buttons, ten rows of `cols-3`, ~280px of a 456px body before
anything else renders. Too long; agreed.

Subtabs would work. **Collapsible groups are slightly better**, and it is close enough to be
worth saying why rather than asserting it:

* A collapsed group still shows **its heading, in place** — so "Mesh Edit" is visible, named,
  and one click away. An unselected subtab shows a word in a different part of the UI and
  hides that its content is a tool grid at all.
* Both can be open at once when you want that. Subtabs make "show me everything" impossible.
* No new navigation concept, and no "which subtab am I on" state to remember or to restore.

Remember the last-open group per session. Hand-roll the toggle rather than reaching for
`<details>`: the disclosure triangle is a UA-drawn glyph and this markup gets serialised
through the SVG rasteriser, where UA glyphs are exactly the thing that does not survive.

## Bones — stages, and by frequency

His proposed cut (creation / animation / physics) is the right **axis** — the lifecycle one.
I would cut it by **frequency** instead, because the codebase already started doing that with
the `full` flag and it gives a sharper answer:

```
Rig Authoring
  [ Draw ][ Sel/Tweak FK ][ … ]        ← mode row: ALWAYS visible
  [ Snap Plane ][ Snap Axis ][ Sym ]   ← always visible
  ▸ Setup          Make Skin, Bake Capsules, Reset Radii, Bind/Unbind, X-Ray, Mush
  ▾ Pose           existing Pose block + the new pin modes (B) and Pin Weight (C)
  ▸ Physics        flag, Bake, 7 sliders, 2 collision flags
```

Collapsible, not tabs — because you genuinely **do** cross between these. You bind, pose,
find the weights wrong, go back. Tabs punish that; collapse does not. Display stays where it
already is, in Rendering.

## The wrist panel needs a blunt rule, not a layout

"The bone minipanel is ridiculous" is true and it is not a navigation problem — it is that
`buildBoneAuthoringHTML` renders nearly everything on the wrist. The `full` flag
(`style !== 'mp'`) already exists for exactly this and is currently applied to only three
blocks.

**Proposed rule: the wrist panel gets the mode row, the snaps, and the pin modes. Full stop.**
Everything else — setup, physics sliders, bind, X-Ray, Mush — is `full`-gated to the main
panel. That is one `${full ? … : ''}` per block and it is the single largest improvement
available to the wrist, for less work than any layout change here.

## The reframe worth considering

If there is a more elegant answer than any of the above, it is this: **the panel is long
because the tool is broad, and some of that breadth is now redundant.**

The Bones tool carries seven pointer modes. The comment on two of them says `fk` and `free`
were renamed to `Sel/Tweak` because people were using them as the Select the tool did not
have — and **a Select tool now exists** (v3.36.0). That is at least one mode's worth of
overlap, possibly two, introduced before the thing that replaced it.

Trimming modes shrinks the panel at the source rather than adding navigation to manage it. A
pass over the seven modes asking "which of these survives the Select tool" is worth doing
before committing to any layout, because it changes how much layout is needed.

## Order

1. Rebalance the tab strip (9 → 5). Cheapest, and it sets the budget for everything else.
2. The wrist-panel `full` rule for bones. One line per block.
3. Bones stages as collapsible groups in the main panel.
4. Tools page collapse.
5. The mode-overlap pass — before or after 3, but before anyone designs more navigation.

None of this blocks the audit work. Items A–E land in the same builders either way; doing the
tidy first just means they land somewhere less crowded.

---

# Mockup results — branch `ui-reorg-mockup`, measured 2026-09-15

Built behind `window._uiReorg` (default ON on this branch; Settings toggle in both panels;
persisted as the `uiReorg` URL option). Both layouts live in the markup and a class on the
root picks one, so VR toggles live. The desktop sidebar builds its tab strip once at startup,
so that half needs a reload.

## Content height, measured in the running app

The VR panel body is **456px**. Numbers are the rendered extent of `#mm-content`, nothing
selected, Bones tool active for the bone rows.

| Page | Legacy | Reorg | |
|---|---|---|---|
| Tools (main) | **455** | **332** | -27%. Legacy was at 455 of 456 — it fit by one pixel, which is why it felt at breaking point. |
| Bones properties (main) | **727** | **625** | -14%. Still over 456, so it still scrolls. Not solved. |
| Bones (wrist panel) | **458** | **460** | **No change.** |

## What that says

**The tab strip and the Tools page are wins.** Menubar 6 → 5 (Files, History, View, Settings,
About). Tab strip 9 → 5 plus two launchers fenced off at the bottom. The Tools page went from
one pixel inside its budget to 124px of headroom, and Mesh Edit stays visible and named.

**The bone panel is better and not fixed.** 14% off, still scrolling. The saving grows once a
physics joint is selected (seven sliders collapse), but the base case is still too tall. This
is the evidence for the "trim the modes" reframe rather than more navigation: the mode grid is
seven buttons and the Select tool has since taken over what two of them were being used for.

**The wrist panel did not move, and my recommendation for it was wrong.** I had said the
`full`-flag rule would be the single biggest wrist improvement. It is not, because `full` had
already been applied to Setup, Bind and the skin sliders — there was nothing left on the wrist
to take away. Collapsing Physics saves a row and the group heading costs one back.

First attempt actually made the wrist *worse* (458 → 492) by defaulting Physics open, which
added a heading and hid nothing. Defaulting it closed recovers to parity. A real wrist fix has
to come from somewhere else — the mode grid, or fewer modes.

## Two bugs found while building it

* **`MiniPanel._wireExtras` threw on every Grab wiring.** Line ~681 used `extrasEl`, which is
  the parameter name in `_syncExtrasActive` and does not exist in `_wireExtras` (the local is
  `extras`). So Set Parent on the wrist was dead, and the ReferenceError propagated out
  through `syncFromState`, skipping everything after the call whenever Grab was active.
  Pre-existing on master; fixed on this branch.
* **The reorg CSS was id-scoped** (`#mm-root ...`) on the first pass, which meant a torn-off
  or floated copy of the same markup would silently render the legacy layout. Now two classes
  on the root (`ui-reorg` / `ui-legacy`) with every rule two classes deep, which also avoids
  the single-class specificity tie the MiniPanel's hands-only row documents.

## Harness

`bonepanel_test` broke, exactly as the standing warning says injections do: the harness inlines
`bonePanel.js` with every `import` line stripped, so the two new imported symbols were
undefined and the file reported one message-less failure. Fixed by stubbing `uiReorg` and
`collapsibleHTML` in the harness preamble (driven by `globalThis.__uiReorg`, so the same
harness can assert either layout).

Two of its checks then failed on their **anchors rather than their intent** and were
re-expressed:

* "the tool grids are on exactly one of them" counted one exact literal and demanded exactly
  one. The reorg renders the same grid twice inside `part === 'tools'`, so the count moved
  while the claim stayed true. Now splits the function at the tools early-return and asserts
  the grids appear in that half and never in the props half.
* "Properties is a real section" matched the whole tab-strip array literal. The strip is two
  arrays now, so it matches the strip and asks whether 'properties' is in it.

Suite: **73/79**, the six standing failures only (pinhilite, rigpending, rigpick, rigtopo,
secondary, undef). `bonepanel_test` green.

## Still to try

Not built, in rough value order: the bone Setup/Pose/Physics split needs the Pose half (it
waits on the B/C pin work); the mode-count pass; and the wrist panel needs a different idea
entirely.

---

# Density pass — horizontal space, measured 2026-09-15

matt: "a lot of other sections feel like we're wasting a lot of horizontal space. eg the top of
that animation panel, fps and speed take up 1.5 rows for 2 labels and 2 numbers that will
always be less than 2 digits wide ... many buttons and sliders don't need to be on a single
row."

## The diagnosis

The panel had **no density model**. Every control claimed a full row by default, and the
exceptions were hand-made per section as fixed column counts. Two things follow:

* Short controls waste the row. "Count in" is a 67px checkbox alone across 290px.
* A hardcoded `repeat(2,1fr)` can only be right at ONE width — and these builders render into
  a ~410px main panel AND a 240px wrist panel.

So the fix is `auto-fit` grids and flex-wrap instead of fixed counts, with packing **opt-in per
control class** rather than a blanket change to the container. Density then follows the width
it is given, from one set of markup.

## What worked — the animation panel

Label beside the input instead of above it; `auto-fit minmax(96px, 1fr)` on the field grids;
checkboxes pack. Measured on the built markup at three widths:

| Container width | Before | After | Saved | Fields/row | Checkbox rows |
|---|---|---|---|---|---|
| 240px (wrist) | 764 | 753 | 11 | 2, 2 | 4 |
| 305px (sidebar) | 742 | 668 | **74 (10%)** | 2, 3 | 4 |
| 410px (VR main) | 742 | 646 | **96 (13%)** | 2, 3 | 3 |

`FPS [24] Speed [1]` is now one row with inline labels, `Duration / Start / End` is one row,
and the onion-skin pair sits on one line. The *plain* column does not change with width at all,
which is the point: the old layout is the same height at 240 and at 410.

The density class goes on `.acp-root` itself, not on an ancestor — the desktop sidebar renders
this markup into a `wa-tab-panel` nowhere near `#mm-root`, so an ancestor selector would have
styled the VR copy and silently skipped the sidebar.

## What half-worked — pairing slider rows

`.mm-row` pairs at `flex: 1 1 190px`, so a 410px main panel fits two and a 240px wrist fits
one, automatically. Mechanically it works: two 193px rows, 89px of slider track.

Two problems, both worth seeing before anyone commits to it:

1. **It only reaches rows whose container holds rows.** Scoped to direct children it caught
   one row in nine — the markup nests inconsistently (content column, `fieldset.mm-disabled-
   group`, unclassed divs, `div.shader-pbr`). `:has(> .mm-row)` asks the structural question
   directly and catches far more, but rows that are alone under their own heading still cannot
   pair, because there is nothing to pair them with. The result is a panel where some sliders
   are half width and some are full. That is not random — it is grouped by heading, and it may
   even read as intentional — but it is a look to approve, not a detail to assume.
2. **Halving the row truncates the label.** `.mm-lbl` is `flex: 0 0 30%`, so at 193px the label
   column is 58px and "Shadow Opacity" renders as "Shadow …". Pairing sliders properly needs
   the label to move above the slider (which spends the vertical the pairing just saved) or the
   labels to be shortened at the source.

89px of track is also simply narrow for a fine value. **My recommendation: keep the animation
density, and treat slider pairing as unresolved** — it needs a decision about labels first, and
that is a look-at-it-in-the-headset call.

## A guard added

The backtick trap caught me twice in one sitting: the panel stylesheets are JS template
literals, so a backtick anywhere inside one closes it, and the failure surfaces as a
ReferenceError naming a word out of a CSS comment ("reorg is not defined", "repeat is not
defined"). The MiniPanel carries a hand-written warning about it, which is the tell that it had
happened before — a comment in one file does not protect the next person editing another.

`panelxml_test` now checks every `const *CSS = ` literal for a stray backtick, alongside the
existing double-hyphen rule, with a self-check that it is looking at real stylesheets.
Negative-tested: introducing one backtick fails the check and names the file and line.

Suite still **73/79**, the six standing failures only.


---

# Density, second pass — the rest of the panels

matt: "did you do this to all the panels and menus, or just animation? the view menu still looks
really poorly laid out."

**Just animation.** The density CSS was scoped to `.acp-root.acp-dense`, so it could not apply
anywhere else by construction. The main panel had only the slider-pairing attempt, which is the
half-working one. And the View page was poorly laid out because I built it that way: four
builders concatenated flat, ten section headings in one scroll, no grouping.

## What the View page actually needed

Measured at 416px content, everything visible:

| | Height |
|---|---|
| Flat, as I first built it | **1376** |
| Grouped, default state (Rendering open, three closed) | **667** |

**The grouping is what fixed it, not the density.** Four collapsibles — Rendering, Camera,
Background, Reference — cut it by half before a single control moved. Density contributed 44px
on top of that (1376 to 1298 with all four open).

## The general density rule, and its real limit

The rule now asks `:has(> .mm-row, > .mm-toggle, > .mm-action-btn)` rather than naming the
containers it expects controls to be in. That matters: they sit 2 to 4 levels down and the
depth varies by section (`div.shader-pbr`, then `fieldset.mm-disabled-group` inside it, then
`div.mm-if-uv` inside that). I widened a named list three times before accepting that a named
list cannot keep up, and the failure mode is the bad kind — half the panel packs, half does
not, and nothing on screen says why.

Section titles stay at full width, so a heading forces a line break and controls under
different headings can never end up side by side. No wrappers, no per-section column counts.

**But packing only helps where packable controls are ADJACENT, and mostly they are not.**
The View page carries ten full-width buttons for one-to-three-word labels, which looked like an
easy 135px. It is not: each of them is separated from the next by a full-width control — a
fieldset, a section title, a choice grid — so each is alone on its line and `flex-grow` puts it
straight back to full width. The rule fires correctly (`flex: 1 1 170px`, parent is a flex
container) and changes nothing.

That is the honest limit of doing this in CSS: **density can only compress what the markup
already places together.** Making those ten buttons pair means reordering the markup so related
short controls sit next to each other — a per-section editing job, not a stylesheet.

## Where that leaves it

| | Result |
|---|---|
| Animation panel | Clean win: 10 to 13 percent, adapts with width. **I edited its markup.** |
| View page | Grouping halved it. Density added 44px. |
| Slider pairing | Works, but halving the row truncates the label ("Shadow Opacity" renders as "Shadow ..."). Unresolved. |
| Lone-button packing | Correct but inert on real markup, because the buttons are not adjacent. |

The pattern across all four: **where the markup was changed it worked; where CSS tried to infer
structure over markup it did not control, it reached an arbitrary subset or nothing at all.**

So the next step, if this is worth continuing, is not more selectors. It is giving the builders
a density vocabulary to emit — a wrapper or a class that says "these controls belong on a line
together" — and then the CSS has nothing left to guess.

Suite still **73/79**, six standing failures.

---

# Three picky things, and one of them was a bug

## 1. Repeated labels — fixed, and it unlocks the packing

Heading "SAVE" over buttons reading Save / Save as / Save to scene spends the row on what the
heading already said. **Export already does it right** and is the model: heading Export,
buttons `glb / obj / ply / stl` — nobody wonders what those do.

Rule: **the heading is the verb, the button is the object.** Applied to Files:

| Was | Now |
|---|---|
| Open scene… / Browser Saves… / New scene… | Scene… / Browser saves… / New… |
| Save (name) / Save As… / Save scene to disk (.sxr) | *(the filename)* / As… / To disk (.sxr) |
| Import mesh or audio… (obj, sgl, ply, stl, glb, mp3, wav) | Mesh or audio… *(formats in the tooltip)* |

The Save button naming the file rather than saying "Save" again keeps what the original comment
was protecting — with Save you want to be certain what it will overwrite — and says it better
under a heading that already says Save.

**This is not only tidiness.** A long label cannot share a line, so the repeated verb was also
why each button claimed a full row. Trimming the labels is what let the density rules pack
them: 10 buttons now sit on 8 rows instead of 10.

## 2. The "big gap" when a section is collapsed — not a gap, a fixed panel

Collapsed bodies measure `display: none`, height 0, and consecutive collapsed headings sit 7px
apart. Nothing is leaking.

The real cause: **`#mm-body` and `#mm-content` are a fixed 456px, and the VR panel is a
fixed-size 500px quad.** Collapsing content does not make the panel smaller — it leaves empty
space inside the same rectangle.

That has a consequence for everything above: **on the VR main panel, compressing a page that
already fits under 456px buys nothing visible.** Height savings only pay off on pages that
overflow and scroll — Bones (625px), View ungrouped (1376px). On a page that already fits,
density just moves the emptiness around.

If collapsing is meant to feel like it saves space in VR, the panel has to size to its content.
That is a real change — the mesh is built from MM_W and MM_BODY_H — and it is the thing to fix
before spending more on compression.

## 3. The mishmash — measured

Across the Files, View, Settings, Scene, Tools and Properties pages:

| | Count | Values |
|---|---|---|
| Control heights | **11** | 16, 22, 24, 25, 26, 27, 28, 30, 35 |
| Corner radii | **2 families** | 4px and 5px, no rule about which |
| Font sizes | **5** | 8, 10, 11, 12, 13 (8px is the outliner row) |
| Font weights | **3** | 400, 500, 700 |
| Control surfaces | **4 + none** | #181825, #313244, #2a2a3e, #11111b |
| Borders | mixed | 1px on buttons/inputs, none on rows, checks, titles |

`mm-action-btn` and `mm-choice` are both "a button you press" and sit on different greys at the
same height. `mm-select-trigger` is a third grey. `mm-text-input` is 35px where every other
control is 30. `mm-xf-bake` is 24. That is the whole of "mishmash of lineweights, some things
have borders, some don't" — it is not an impression, it is 11 heights and 4 surfaces.

**Proposed vocabulary** — the smallest set that covers everything currently built:

* **Two heights.** 30px for anything pressable or editable; 24px for a compact row. Not eleven.
* **One radius.** 5px.
* **Two type sizes.** 11px/500 for controls, 10px/700 uppercase for headings. Retire 8, 12, 13.
* **Two surfaces.** Resting `#181825`, active a tint of the accent. One grey for "a control",
  not four.
* **One border rule.** Every interactive control has a 1px border; nothing else does.
* **One left edge.** Shared horizontal padding on every control so labels line up down the
  column — today rows use a 30% label column and buttons use their own padding, which is why
  nothing aligns vertically.

That is a mechanical pass over the stylesheet rather than a redesign, and it is separable from
everything else here. **I would do it before any more density work**, because a consistent
rhythm is what makes packed rows read as intentional rather than crowded.

## And a pre-existing bug found on the way

**`.cols-4` was used and never defined.** The Export format row (`glb / obj / ply / stl`) asks
for `mm-choice-grid cols-4`; the stylesheet defines cols-2, cols-3 and cols-5 only. With no
rule to match, the bare `display: grid` gave it **one column**, so four short buttons have been
stacking vertically down the full panel width — in the VR menu and the desktop sidebar both —
for as long as that markup has existed. On master, `cols-4` appears once in markup and zero
times in CSS.

This is very likely part of what reads as "3 buttons stacked vertically". A missing class raises
nothing: no error, no warning, just a layout quietly falling back.

Fixed, and `panelxml_test` now checks the whole family — every `cols-N` used in markup must be
defined in CSS, with a both-sides self-check. Negative-tested: removing the rule fails the check
and names the class.

Suite **73/79**, six standing failures.

---

# The style sweep — measured 2026-09-15

## The finding that shaped it

`uiTokens.js` has always described itself as "single source of truth for the panel visual
language — change a value here and it propagates to all panels". It does not. Before this
sweep:

| File | `var(--ui-*)` references |
|---|---|
| MainMenuPanel.js | **0** |
| MiniPanel.js | **0** |
| AnimationControlPanel.js | **0** |
| VrConfirm.js | the only adopter |

**There was already a design system and nobody used it.** That is the whole explanation for
eleven control heights and four greys — not an absence of intent, an absence of adoption. So
the sweep does not invent a vocabulary; it applies the one already declared, after extending
the token set with the dimensions it was missing (control heights, type scale, control
surfaces, border, shared padding).

## How it is built

**One normalisation layer, injected once, hooked on the root element.** Not a rewrite of the
three stylesheets:

* An override layer keeps the old look one toggle away, which is the point of this branch.
  Fold it into the base rules and delete the originals once the look is agreed.
* `html.ui-reorg` rather than a per-panel class: the desktop sidebar, the wrist panel and the
  VR main menu are three roots in three places and the sidebar is inside none of them. A
  per-panel hook would have swept two of three and silently skipped the one most looked at.

## Result

Measured across Files, View, Settings, Scene, Tools and Properties (native range inputs
excluded — see below):

| | Before | After |
|---|---|---|
| Control heights | **9** — 16, 22, 24, 25, 26, 27, 28, 30, 35 | **6** — 16, 24, 25, 26, 27, 30 |
| Type sizes | **6** — 8, 10, 11/400, 11/500, 12, 13 | **4** — 10/700, 11/400, 11/500, 13/400 |
| Control surfaces | **9** | **5** |
| Corner radii | 3 | 3 |

The outliers are gone: the 8px outliner type, the 35px text input, the 28px tool button, the
22px swatch, and the four competing control greys (`#313244`, `#2a2a3e`, `#11111b`, `#181825`)
now resolve to one resting surface and one active tint.

**The residue, honestly.** 25, 26 and 27 remain against a 24px target — `min-height` sets a
floor and content pushes past it. They read as one rhythm at a glance and clamping them with a
fixed `height` risks clipping labels, so they are left. The remaining `13px/400` is the
`.mm-row` container's inherited size, not visible text (its label child is 11px). The remaining
surfaces are the colour swatch, whose background IS its value, and the outliner's selection
tint.

**Deliberately out of scope:** native `input[type=range]`. `accent-color` already themes it,
and forcing a height onto the track fights the browser's own thumb sizing for nothing.

## The shared left edge

Buttons put their label at their own horizontal padding; rows put theirs at zero, because rows
have no border and never had any. So every label in a column sat at one of two x positions —
"nothing is vertically aligned". Rows, check rows and headings now take the same
`--ui-ctl-px`, and the collapsible chevron sits in that gutter rather than pushing its heading
right, so heading text lines up with the controls beneath it.

## What it does not fix

The per-page visual delta is smaller than the table suggests, and worth saying plainly: on a
page already built from one control type (Files) almost nothing moves. The win is **consistency
between pages**, which is exactly the complaint — a panel that changes its rules as you move
through it.

It also cannot fix adjacency. On the Bones page, `Bake Capsules` and `Bind Mesh` sit in
separate single-cell grids, so they stay full width even though they would pair happily. That
is markup, not style — the same wall the density pass hit.

Suite **73/79**, six standing failures.

---

# Collapsible sections everywhere, and the two-line sweep

matt: "settings collapse all those trace options into a section. in fact i'd say all those
titles should be collapsable sections, and collapsed by default." Then: "alpha section for the
brush tool, why is it 2 lines? the import option could just be the last option of the combobox.
sweep for other sections like this."

## Every section title is now a collapsible — done as a DOM pass

A section title is emitted as a loose `<div class="mm-section-title">Name</div>` with its
content following as **plain siblings**. There is no wrapper to collapse, and there are dozens
of them across a dozen builders. So `groupSectionTitles()` walks the built content afterwards
and wraps each title plus everything up to the next one.

One function, every page, no builder touched — and a section added tomorrow is collapsible the
day it appears, without anyone remembering to make it so.

* **Key is the title text**, not a position, so open/closed survives the rebuilds that replace
  this markup wholesale (which happens on nearly every click). Duplicate titles in one page get
  an index suffix — "Type" appears more than once in View, and two sections sharing a key would
  open and close together.
* **A heading with nothing under it is left alone.** View has a run of titles whose content
  lives elsewhere; wrapping those would add a chevron that opens onto nothing.
* Collapsed by default, as asked.

**Settings went from an endless scroll to 14 headings in one view**: Input, Hand spike,
Controller spike, Calibration, Controller Model, Wireframe, Tone Mapping, Mesh, Ground Plane,
Menu, Blendshapes, Audio Scrub, Physics & Diagnostics, Debug.

### A bug this exposed, which had been there the whole branch

Every collapsible heading was **centre-aligned**. A heading is a `<button>`, and a button given
`display: flex` is centred by the user agent — so each heading sat in the middle of its own row
at a different x depending on word length, while everything beneath was left aligned. It read
as decoration rather than as the start of a section. `text-align` does not fix it because the
flex box has already placed the line; `justify-content: flex-start` does. Fixed in the sweep,
so it covers the headings the builders emit and the ones this pass creates.

## Alpha — import is the last option now

Picking an alpha and adding one to the list are the same question, so they belong in the same
control. As a button beside the picker it cost the section a second line to say something the
picker could say in one of its own rows.

The list is now `None / Square / Square1 / Skin / Skin1 / Import…`. Selecting Import restores
the trigger's label first — `wireSelect` has already written the clicked row's text onto it, and
"Import…" is not an alpha, so leaving it would have the control reporting a selection the brush
does not have, for as long as the dialog is open and permanently if it is cancelled.

## The sweep for the same shape

Three more sections were flagged. Two compressed, one deliberately not:

| Section | Was | Now |
|---|---|---|
| **Camera Reset** | Center/Front then Left/Top, two hardcoded 2-column grids | one row of four. They are a single set — four views of one thing — so the split implied a grouping that is not there. |
| **Background → Image** | Reset/Import pair, then a lone full-width Fill toggle | one row of three. The sweep gives a toggle and an action the same shape, so the active state is the only thing distinguishing them, which is the one that should. |
| **Multiresolution** | six buttons across three pairs | **left as is.** Each row is a matched opposition — Level down against Level up, Subdivide against Reverse, Del Lower against Del Higher — and the pairing *is* the information. Three-across would put Reverse next to Del Lower and say they belong together. A compressed layout is not worth a false grouping. |

That last one is the general rule worth keeping: **compress rows that are merely adjacent, never
rows that are paired.**

## One thing to decide

With everything collapsed by default, **Properties opens showing four headings and nothing
else** — Brush, Alpha, Safety, Symmetry — so adjusting the current tool's radius costs a click
first. That is the page you switch to *in order to* adjust the tool. State is sticky, so it is
one click per session rather than per visit, and it is exactly what was asked for.

If it grates, defaulting the Brush section open is one argument: `groupSectionTitles(contentEl,
{ defaultOpen: … })` already takes it, or a small keep-open list by key. Not guessed at here.

Suite **73/79**, six standing failures.

---

# Desktop menus — the third rendering path

matt: "settings looks unchanged on desktop."

Correct, and the cause is worth recording because it is the third time this session the same
mistake landed:

**This UI has three rendering paths, not two.**

1. The VR panel — `MainMenuPanel._rebuildContent`
2. The desktop sidebar's tab panels — `Gui._decorateDesktopSection`
3. **The desktop top-bar menus** — `Gui._openDropdown`, which goes through neither

Settings on desktop is `buildMenuHTML_desktopSettings` rendered into a `div.desktop-dropdown`
attached to `document.body`. So `groupSectionTitles` never ran on it and every section stayed
expanded, while the same idea collapsed cleanly in the headset.

The earlier two instances of this exact shape:

* the animation density class, which had to move onto `.acp-root` itself because the sidebar
  renders that markup into a `wa-tab-panel` nowhere near `#mm-root`;
* the collapsible wiring, which reached the VR panel and the wrist panel and left the
  sidebar's headings dead — and looked fine from a console, because the VR panel keeps its own
  copy of the same markup attached off-screen for the rasteriser.

**The rule: any change to panel content has to be applied at all three, and the check is to look
at the third one.** It is the one that is easy to forget and the one matt uses most.

Fixed at the single choke point — `_openDropdown`'s `rebuild()` now groups the section titles
and wires both kinds of heading (the ones this pass creates and the ones a builder emits).

## Result

* **Settings (desktop)** — six collapsed sections: Physics Bones, Wireframe, Numeric Input,
  Pen Pressure, Audio Scrub, Advanced. Opening Wireframe reveals its five controls; verified by
  measurement (0px collapsed, 114px open) and on screen.
* **View (desktop)** — two levels, which is the shape matt named: four top-level categories
  (Rendering, Camera, Background, Reference) each holding its own collapsible sections
  (Shader, Rig Display, Camera Reset, Projection, Camera Mode, …). A desktop menu with
  submenus, entirely inside the canvas.

Note the desktop and VR Settings pages have **different section names**, because they are
different builders (`buildMenuHTML_desktopSettings` against `buildMenuHTML_settings`). That is
the pre-existing drift the `DEV_TOGGLES` list was written to stop, still present in the
surrounding sections. Not touched here; worth its own pass.

## One consequence of keying by title text

Section state is keyed on the title, so it is **shared across panels**: opening Wireframe in
the headset opens it in the desktop menu too. That is almost certainly right — it is the same
section and the standing rule is that the two platforms should conform — but it does mean two
unrelated sections that happen to share a title would share state.

Suite **73/79**, six standing failures.

---

# Conforming the animation panel

matt: "the animation mainpanel looks nothing like the others, conform it."

It was a **parallel vocabulary**. `acp-*` declared its own buttons, its own fields, its own
segmented control and its own frame sizes, none of which shared a line with the `mm-*` panels
it sits beside. The style sweep had already caught its main buttons; this is what was left.

| | Was | Now |
|---|---|---|
| Transport buttons | radius 6, own border colour, 35px tall | radius 5, shared border, 30px |
| Mode row (Shape/Transform/Blendshape) | a bordered, rounded container wrapping three border-less buttons | frame removed — the sweep gives those three the standard chrome, so the container drew a second box around three boxes |
| Number fields | radius 6, 13px type | radius 5, 11px, shared border and display surface |
| Key-inspector fields | 20px, radius 6 | the **compact** 24px height, radius 5 — conforming to the scale, not flattening the distinction |
| Body type | 12px, the only size in the app that was neither 11 nor 13 | 11px |

Measured over all 31 controls with every section expanded: **two heights** (27 heading / 30
control), **two radii** (0 heading / 5 control), **three type sizes** (10 heading / 11 control /
13 transport glyph).

**The transport row is deliberately not repacked** — matt named it as a good use of space
("8 buttons across feels like a good use of space"). Only its chrome conforms. Its glyphs keep
13px, because an icon and a word do not read at the same point size.

One thing that needed `height` rather than `min-height`: the transport row is a grid track sized
to its content, and an icon button's line box carries descender space the glyph never uses — so
a 13px icon in a zero-padding button still measured 35px and set the track.

## And a fourth rendering path

The animation panel builds its own root **once, in its constructor**, and hands the same element
to the VR scene *and* to the desktop sidebar's Animation tab. So it goes through none of the
three paths listed above — not `_rebuildContent`, not `_decorateDesktopSection`, not
`_openDropdown`. Its section titles were the last ones in the app still uncollapsible.

**So the count is four:**

1. `MainMenuPanel._rebuildContent` — the VR panel
2. `Gui._decorateDesktopSection` — the desktop sidebar's tab panels
3. `Gui._openDropdown` — the desktop top-bar menus
4. `AnimationControlPanel`'s constructor — its own root, shared by both hosts

Four places, and every content-level change has to reach all of them. This is the single most
useful thing learned this session about the UI layer.

Grouped in the constructor, before the wiring runs — moving an element does not lose its
listeners, and `_waitForMeshThenWire` queries by id against the same root either way.

**Animation panel: 697px → 196px collapsed**, five sections (Animation, Transport, Record,
Keyframes, Selected Key), and it now reads as the same panel as the rest.

Suite **73/79**, six standing failures.

---

# Conforming the animation panel, properly

matt: "why are the weights so different? ... its not just border weights, its font size, padding
around number fields, even colours of the background of buttons, its all different and
misaligned." And: "collapsing all the sections by default isn't actually fixing the mess."

**Both correct.** Collapsing hides the mess; it does not fix it. And the sweep's override layer
had stopped working — same failure mode as the two layout passes before it: **a layer that
enumerates selectors cannot keep up with a stylesheet that declares its own values.**

## What the measurement said

The same 35 controls in each panel:

| | Scene | Animation |
|---|---|---|
| Border widths | 1 | **2** |
| Border colours | 2 | **5** |
| Backgrounds | 2 | **5** |
| Font sizes | 2 | **4** |

And in the animation stylesheet itself: **29 distinct hex colours, 5 font sizes, 4 border radii,
20 different padding declarations.** Values like `#bbbbbb`, `#a6adc8` and `#101219` are not in
any palette in this codebase — they were the user agent's, showing through.

## So the source was changed, not the override

* **Radii** — 7px / 6px / 5px / 3px all became `var(--ui-ctl-r)`. Zero literal radii left.
* **Type** — 12 / 13 / 14px became `var(--ui-ctl-fs)`. Left: 10px headings, 11px controls, and
  13px for the transport glyphs, which is the one deliberate exception — an icon and a word do
  not read at the same point size.
* **Structural greys** — property-aware replacement so a border colour could not be swapped
  into a background: borders to `--ui-ctl-border`, surfaces to `--ui-ctl-bg` / `--ui-display-bg`,
  text to `--ui-text` / `--ui-text-dim`.
* **Hover** — there were **four** different hover greys for one state (`#24243e`, `#2a2040`,
  `#1a2040`, `#1e1e1e`), one per button family. Now one `--ui-ctl-bg-hover`.
* **Active** — there were **four** different active looks: `#313244` with a green tint,
  `#313244` with a purple tint, an *inverted* `#94e2d5`-on-dark, and `#1e2d5a` with the accent.
  Now one: accent tint, accent border. Kept as they were: recording (danger) and armed (warn),
  because those colours carry meaning rather than decoration.
* **Number-field padding** — one value, which is what made identical-looking labels sit beside
  differently-sized boxes.

Hex colours in that stylesheet: **29 → 16**.

## The checkboxes were two different controls

The mm panels hand-draw a 13px box (`.mm-checkmark`: 1px `#585b70`, 3px radius, `#313244`,
accent when checked). The animation panel used a **native** `input[type=checkbox]` with
`accent-color`, so the user agent drew it — which is exactly where `#bbb`, `#a6adc8` and
`#101219` came from.

Now `appearance: none` with the same metrics and a tick drawn the same way. It very probably
fixes them in the headset too: a UA-drawn control is the kind of thing that does not survive the
panel rasteriser, which is why the mm side hand-draws one in the first place.

## Where it landed

Every value the animation panel now draws is one the scene panel also uses:

| | Value | Same as scene? |
|---|---|---|
| Control border | `#45475a` | yes |
| Control surface | `#181825` | yes |
| Field ground | `#11111b` | yes (mm-text-input) |
| Checkbox | `#585b70` on `#313244`, accent when checked, 3px | yes (mm-checkmark) |
| Radii | 5px controls, 3px checkbox | yes |
| Type | 11px control, 10px heading | yes |
| Accent / danger | `#89b4fa` / `#f38ba8` | yes, and only where the colour means something |

The scene panel's list is shorter only because it has fewer *kinds* of control in view — no
checkboxes, no danger states — not because it is more consistent.

## Still outstanding, and it is the one matt named first

**The FPS and Speed fields are still about 130px wide for a two-digit number.** The label is
inline now, but the field stretches to fill its grid track instead of sizing to its content.
Fixing that means numeric fields taking a width from their expected digit count rather than
`1fr` — at which point FPS, Speed, Duration, Start and End would all fit on one row instead of
two. That is the remaining "huge amount of wasted space" and it is a markup-level change to the
frame grid, not another CSS override.

Suite **73/79**, six standing failures.

---

# The number fields, sized to content

The last item from the density work, and the first thing matt raised: FPS and Speed each held
two digits in a ~142px box, across two hardcoded grids (`repeat(2,1fr)` and `repeat(3,1fr)`).

Two changes:

1. **One container instead of two.** The five fields are the same kind of thing — the numbers
   that describe the take — so they now share a container and can flow together. Split across a
   two-column grid and a three-column grid they never could, whatever their widths.
2. **Cells size to their content, and wrap.** `auto-fit` with a `1fr` track still hands every
   field an equal share of the panel, which is exactly how two digits ended up in 142px. Flex
   with a fixed 56px field and wrapping lets each cell take only what it needs.

56px is five digits at the control type size, and `tabular-nums` means every glyph is one
width, so the figure cannot be wrong by a character.

## Measured across the widths these builders actually render at

| Container | Rows | Height |
|---|---|---|
| 240px (wrist) | 3 | 102px |
| 305px (sidebar) | 2 | **66px** |
| 410px (VR main) | 2 | **66px** |
| 560px | **1** | **30px** |

Against the original **100px** of two fixed grids: 34% off at the widths in use today, 70% off
once the container is wide enough to hold the row. And it is now one set of markup with no
column count chosen for a panel that renders at three different sizes.

The legacy path is untouched: without the dense class the container is still a plain
`.acp-frame-grid` laying the five out three-up, as before.

Suite **73/79**, six standing failures.
