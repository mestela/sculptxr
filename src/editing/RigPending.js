// A TWO-STEP RIG ASSIGNMENT — "set parent" and "aim at" — and WHERE THE SECOND STEP IS ALLOWED
// TO HAPPEN.
//
// Both are the same gesture: name a subject, then name a target. The subject comes from the
// outliner selection, and until now the target had to come from an outliner row too, because
// the state machine lived as a closure inside the outliner panel and the viewport had no way to
// reach it. That is fine for parenting a mesh to a mesh, where the outliner IS how you think
// about the hierarchy. It is bad for parenting a PIN to a PIN — which is the control-rig case:
// pins are named after the joint they hold, a rig has a lot of them, and picking "pin_hand_L"
// out of a list is a worse way to say "that one" than pointing at it.
//
// So the state moved here, and the viewport can finish the job. The outliner still can, and
// still does — this ADDS a way to answer the question, it does not replace one.
//
// THE STATE ALREADY LIVED ON `main` (`_rigPendingMode` / `_rigPendingSubject`), and it stays
// there rather than in this module: the panel repaints from it every frame to light the armed
// button and tint the candidate rows, and a second copy in here would be a second source of
// truth for one flag. This module owns the TRANSITIONS, not the storage.
const RigPending = {};

// The armed mode ('parent' | 'lookat'), or null. Everything asks this rather than reading the
// flag, so there is one place that decides what "armed" means.
RigPending.armed = function (main) {
  return (main && main._rigPendingMode) || null;
};

RigPending.subject = function (main) {
  if (!main || !main._rigPendingMode) return null;
  const id = main._rigPendingSubject;
  return (main.getMeshes() || []).find((m) => m.getID() === id) || null;
};

// ARMING NEVER ASSUMES A SUBJECT. Press the button, click the child, click the parent, done —
// the same three steps every time, whatever happened to be selected beforehand.
//
// It used to seed the child from the outliner selection, and that was the thing that made the
// feature unusable. On a flat screen, clicking a pin in the VIEWPORT only selects it while the
// Transform tool is active: every other tool ignores rig nodes by design, because they are
// locators the sculpt brush must skip. So the selection the button read was whatever was left
// over from something else, or nothing at all — and the gesture either started from the wrong
// child or refused to start. Reading a selection that the user cannot reliably SET is worse
// than not reading one.
//
// Both ends now come through this module's own rig-inclusive pick, which works in any tool.
RigPending.arm = function (main, mode) {
  if (!main) return null;
  main._rigPendingMode = mode;
  main._rigPendingSubject = null;
  main._rigPendingNamedAt = 0;
  // A SELECTED OBJECT IS THE CHILD, and the gesture starts at the second step. matt: "if
  // something is already selected, it should be treated as the child, and go immediately to
  // 'select parent'." With nothing selected it is the old three steps.
  const sel = main.getSelectedMeshes && main.getSelectedMeshes();
  const child = sel && sel.length ? sel[0] : null;
  if (child) {
    main._rigPendingSubject = child.getID();
    say('child = ' + label(child) + ' — now click the ' + (mode === 'parent' ? 'PARENT' : 'TARGET'));
  } else {
    say(mode === 'parent' ? 'Set parent: click the CHILD' : 'Aim at: click the EYE');
  }
  return mode;
};

// Which half of the gesture is outstanding — what the next click will name.
RigPending.step = function (main) {
  if (!RigPending.armed(main)) return null;
  return main._rigPendingSubject == null ? 'child' : 'parent';
};

RigPending.cancel = function (main) {
  if (!main || !main._rigPendingMode) return false;
  main._rigPendingMode = null;
  main._rigPendingSubject = null;
  // REFRESH HERE, not left to every caller. `take`/`complete` already did their own call after
  // this one returns, which just makes this a harmless second repaint for them — but a bare
  // `RigPending.cancel(main)` from anywhere else (the A button, an add-primitive shortcut that
  // silently drops a stale pick) used to leave an armed-looking button lit over a mode that had
  // in fact been cancelled, because nothing told either panel to look again.
  refreshOutliners(main);
  return true;
};

const label = (m) => (m && (m._permanentStaticLabel || m.uiName)) || ('#' + (m && m.getID?.()));

// Arm, or disarm if this same mode is already armed — the button is a toggle, and pressing it
// again is how you back out without committing to anything.
RigPending.toggle = function (main, mode) {
  if (RigPending.armed(main) === mode) { RigPending.cancel(main); return null; }
  return RigPending.arm(main, mode);
};

// The node the next click would act ON, for the feedback line: the rig node under the pointer
// while a parent is being chosen. Read off the preselection the app already maintains rather
// than picking again — a pick per frame is the thing the preselection war story is about.
RigPending.candidate = function (main) {
  if (RigPending.step(main) !== 'parent') return null;
  const meshes = main.getMeshes() || [];
  const ids = [];
  if (main._pinHighlightIds && main._pinHighlightIds.length) ids.push(...main._pinHighlightIds);
  else if (main._pinHighlightId != null && main._pinHighlightId >= 0) ids.push(main._pinHighlightId);
  if (main._skelHighlightIds && main._skelHighlightIds.length) ids.push(...main._skelHighlightIds);
  else if (main._skelHighlightId != null && main._skelHighlightId >= 0) ids.push(main._skelHighlightId);
  for (const id of ids) {
    const m = meshes.find((x) => x.getID() === id);
    // Never point the line at the child itself: parenting a thing to itself is refused, and a
    // line saying otherwise would be promising something that will not happen.
    if (m && m.getID() !== main._rigPendingSubject) return m;
  }
  return null;
};

// WHAT COUNTS AS A TARGET UNDER THE POINTER.
//
// Rig-inclusive, because the interesting targets — joints and pins — are locators the sculpt
// brush deliberately skips. And a pin is returned AS ITSELF, which is the one place this
// differs from SecondaryAction's pick: that one resolves a pin to the joint it holds, because
// pinning a pin is meaningless. Parenting to a pin is the whole point here — a pin driving
// other pins is a control handle, and resolving it to its joint would silently parent to the
// wrong thing and look like the feature half-works.
//
// The pick clobbers the shared picking state. Safe for the same reason SecondaryAction's is:
// this runs ONCE on a click that is then consumed, so nothing downstream reads the stale pick.
// JOINTS ARE TARGETS AGAIN, and this reverses an earlier call of mine that was wrong.
//
// It used to be pins-and-objects only, on the reasoning that parenting is a control-rig
// operation and a rig full of bones between you and the handle you are pointing at made the
// pick a fight. That is true of pin-to-pin parenting and false of the case people actually hit
// first: matt, "a likely scenario if someone draws a skeleton then realises they want the arms
// parented somewhere else."
//
// With bones excluded, arming Set Parent and clicking a joint hit NOTHING — and a click that
// hits nothing cancels, so the gesture disarmed itself and the next click went to the tool. The
// reported symptom was the tool running: "clicking anywhere just starts drawing a new bone
// chain." The gate was working; there was simply nothing it was allowed to take.
//
// The pick already knows how to prefer a pin over the bone it sits on — see `rigWinner` in
// Picking — so offering both is a preference, not a fight.
RigPending.targets = function (main) {
  // Everything. A joint carries BOTH `_isBone` and `_isNull` — it is a transform-only locator
  // that reuses the null evaluation paths — so any filter phrased in those terms excludes the
  // very thing this needs to offer. The callers already drop what is genuinely unpickable
  // (invisible meshes, voxel chunks) at the point of the ray.
  return (main.getMeshes() || []).slice();
};

RigPending.pickTarget = function (main) {
  const picking = main && main.getPicking && main.getPicking();
  if (!picking) return null;
  const list = RigPending.targets(main);
  if (!picking.intersectionMouseMeshes(list, main._mouseX, main._mouseY, false, true))
    return null;
  return picking.getMesh() || null;
};

// Rebuild both outliners — the desktop sidebar and the VR panel — so the armed button goes
// dark the moment the assignment lands. The panel repaints itself when IT was the one that
// finished; this is for the viewport, which has no idea a panel exists. Same pair FrameGroup
// refreshes after a scene-graph op, for the same reason.
// SAY WHERE THE GESTURE IS, ON SCREEN. The button label changes, but the button is in a panel
// you are not looking at while you point at a pin — and with the tools switched off, a click
// that does nothing visible is indistinguishable from a click the app never received. Same
// channel the pin cycle announces itself on.
function say(msg) {
  if (window.screenLog) window.screenLog(msg, 'cyan');
}

function refreshOutliners(main) {
  const gui = main && main.getGui && main.getGui();
  if (gui && gui._desktopSceneEl && gui._buildDesktopScene) gui._buildDesktopScene(gui._desktopSceneEl);
  // REBUILD, NOT REPAINT. markDirty() re-rasterises whatever HTML is already sitting in the
  // panel; it does not regenerate that HTML, so a button whose LABEL needs to change ("Set
  // parent..." -> "Click PARENT (list or 3D)...") kept its old text however many times this ran.
  // The rebuild's own cache key has nothing about rig-pending state in it either, so a plain
  // _rebuildContent() would see an unchanged key and skip -- the empty string forces it through
  // regardless, the same escape hatch every other caller of a forced rebuild in this file uses.
  //
  // matt: "the console is keeping track and if i continue through blindly it works, but the
  // panel/button state isn't updating." The gesture was always completing correctly on the VR
  // side; only the one thing telling you so, the button, never repainted with new words on it.
  const panel = main._mainMenuPanel;
  if (panel && typeof panel._rebuildContent === 'function') {
    panel._lastContentKey = '';
    panel._rebuildContent();
  } else {
    panel?.markDirty?.();
  }
}

// Finish against `target`. Disarms EITHER WAY, including on a miss: a click that found nothing
// has still been spent, and leaving it armed is how you get a mystery reparent three clicks
// later. (The same rule SecondaryAction settled on, for the same reason.)
// Take one click. When no child has been named yet this NAMES it and stays armed, returning
// false — nothing was assigned. When one has, it finishes and disarms.
RigPending.take = function (main, target) {
  if (!RigPending.armed(main)) return false;
  if (main._rigPendingSubject == null) {
    // A click on nothing while choosing the child cancels, rather than leaving a half-armed
    // mode with no visible subject: there is no line yet, so nothing on screen would say the
    // gesture is still live.
    if (!target) {
      RigPending.cancel(main);
      say('cancelled — that click hit nothing');
      refreshOutliners(main);
      return false;
    }
    main._rigPendingSubject = target.getID();
    main._rigPendingNamedAt = performance.now();
    say('child = ' + label(target) + ' — now click the '
      + (RigPending.armed(main) === 'parent' ? 'PARENT' : 'TARGET'));
    refreshOutliners(main);
    return false;
  }
  // THE CLICK THAT NAMED THE CHILD MUST NOT ALSO ANSWER FOR THE PARENT. A duplicated pointer/
  // mouse event (or a double tap) landed on the child again, "completed" against itself and
  // disarmed -- the tool looked like it exited as soon as the child was clicked.
  if (performance.now() - (main._rigPendingNamedAt || 0) < 350) return false;
  if (target && target.getID() === main._rigPendingSubject) {
    say('that is the child itself — click a different ' + (RigPending.armed(main) === 'parent' ? 'PARENT' : 'TARGET'));
    return false;
  }
  return RigPending.complete(main, target);
};

RigPending.complete = function (main, target) {
  const mode = RigPending.armed(main);
  const subjId = main && main._rigPendingSubject;
  RigPending.cancel(main);
  if (!mode || !target || target.getID() === subjId) return false;
  // Deliberately no rule about WHAT may be parented to what. Whatever the outliner allowed
  // yesterday it allows today: this module is a second way to name the target, not a new
  // policy about the answer. setMeshParent already refuses the one case that is structurally
  // impossible — a cycle.
  const subject = (main.getMeshes() || []).find((m) => m.getID() === subjId);
  if (mode === 'parent') main.setMeshParent?.(subjId, target.getID());
  else if (mode === 'lookat') main.setLookAt?.(subjId, target.getID());
  say((mode === 'parent' ? 'parented ' : 'aimed ') + label(subject) + ' -> ' + label(target));
  main.render?.();
  refreshOutliners(main);
  return true;
};

// The viewport half: pick under the pointer and finish. Returns true when the click was
// CONSUMED, which is what the caller uses to suppress the sculpt, the camera and the selection
// change that the same click would otherwise cause.
RigPending.fireFromPointer = function (main) {
  if (!RigPending.armed(main)) return false;
  const target = RigPending.pickTarget(main);
  // Repaint even on a miss: `complete` disarms either way, and a button still lit over a
  // mode that is no longer armed is worse than either outcome.
  if (!RigPending.take(main, target)) refreshOutliners(main);
  return true;
};

// The VR half. The controller ray has already picked something by the time this is asked, so
// the target is handed in rather than picked again — re-picking would be a second ray against
// a different frame's pose.
RigPending.fireFromRay = function (main, picked) {
  if (!RigPending.armed(main)) return false;
  if (!RigPending.take(main, picked)) refreshOutliners(main);
  return true;
};

export default RigPending;

