/**
 * MainMenuPanel — main VR menu for SculptXR, replacing GuiXR + VRMenu.
 *
 * Layout mirrors the desktop sidebar:
 *
 *   ┌─ top menubar ──────────────────────────────────────────┐
 *   │  Files   History   Reference   Settings   About        │
 *   ├──────┬─────────────────────────────────────────────────┤
 *   │  🏔  │                                                 │
 *   │Scene │                                                 │
 *   │  🔷  │  <content area — scrollable, switches per tab>  │
 *   │ Topo │                                                 │
 *   │  🎨  │                                                 │
 *   │Rndng │                                                 │
 *   │  🖌  │                                                 │
 *   │Sculpt│                                                 │
 *   └──────┴─────────────────────────────────────────────────┘
 *
 * _activeMenu:    null | 'history'|'reference'|'settings'|'about'
 * _activeSection: 'scene'|'topology'|'rendering'|'sculpting'
 *
 * When _activeMenu is non-null, content shows the top-menu content.
 * Clicking any side tab closes the menu and shows that section.
 * The panel is fixed height — content scrolls inside the body.
 */

import { HTMLVRPanel, VR_PANEL_PX_PER_M, setMenuColorGrade, wristPanelY, wristPanelYaw, wristPanelPitch} from './HTMLVRPanel.js';
import Skinning from '../../editing/Skinning.js';
import Enums        from '../../misc/Enums.js';
import getOptionsURL, { MENU_GRADE_DEFAULTS } from '../../misc/getOptionsURL.js';
import Shader       from '../../render/ShaderLib.js';
import Remesh       from '../../editing/Remesh.js';
import Picking      from '../../math3d/Picking.js';
import RigPending   from '../../editing/RigPending.js';
import MotionPathEdit from '../../editing/MotionPathEdit.js';
import GrabChannels from '../../editing/grabChannels.js';
import PhysicsBones from '../../editing/PhysicsBones.js';
import PanelTrace from '../../misc/PanelTrace.js';
import { toolTextTint } from './toolTints.js';
import { ColorWheel, buildColorWheelHTML } from './ColorWheel.js';
import Multimesh from '../../mesh/multiresolution/Multimesh.js';
import { SCULPT_TOOLS, MESH_TOOLS } from './toolLists.js';
import {
  buildBoneSectionHTML,
  buildBonePoseHTML,
  buildBoneDisplayHTML,
  buildBoneAnimationHTML,
  wireBoneSection,
} from '../bonePanel.js';
import { buildTransformSectionHTML, wireTransformSection } from '../transformPanel.js';
import Tablet from '../../misc/Tablet.js';
import TR from '../GuiTR.js';
import VoxelDensityOverlay from '../../render/VoxelDensityOverlay.js';
import { TAB_ICONS, ICON_PIN, ICON_DOCK } from '../tabIcons.js';
import { VERSION } from '../../Version.js';
import { faIcon, setFaIcon } from './faIcons.js';
import { collapsibleHTML, wireGroups, uiReorg, applyUISweep, groupSectionTitles, pageDefaultOpen, resetUIDefaults } from './uiTokens.js';
import Skeleton from '../../editing/Skeleton.js';
import releaseText from '../../../docs/releases.md?raw';
import {


  injectAnimCSS,
  buildAnimationSectionHTML,
  wireAnimationSection,
  syncAnimationSection,
  refreshBlendshapesDOM,
} from './AnimationControlPanel.js';

// LIGHT INTENSITY IS A LOG SLIDER, because a linear one is unusable.
//
// Scene._syncThreeLights sets the three.js intensity to slider x ref^2, where ref is half the
// scene diagonal -- about 29 units for the default sphere, so ref^2 is about 870. Slider 1
// therefore means "irradiance 1 at 29 units away". In VR you place a light far nearer than
// that, and irradiance goes as 1/d^2: at 10 units, slider 1 is already 8x over and every
// surface facing the light clips to flat white. Measured in a session: slider ~2 -> three.js
// intensity 1762, and matt could not drag below ~0.23, which still clips.
//
// So the whole useful span lived in the bottom ~1% of a 0..20 linear track. The mapping is now
// logarithmic over 0.001..20, which puts 1.0 near the middle and makes the low end reachable.
// The stored value is unchanged -- this is the track's shape only, not the light's meaning.
const LIGHT_INT_MIN = 0.001;
const LIGHT_INT_MAX = 20;
const lightIntFromSlider = (v) => (v <= 0 ? 0
  : LIGHT_INT_MIN * Math.pow(LIGHT_INT_MAX / LIGHT_INT_MIN, v / 1000));
const lightIntToSlider = (x) => (!x || x <= 0 ? 0
  : Math.round(1000 * Math.log(Math.max(LIGHT_INT_MIN, x) / LIGHT_INT_MIN)
      / Math.log(LIGHT_INT_MAX / LIGHT_INT_MIN)));


// ONE HEADER, both platforms. The row carries the section's name and its float/pin button, and
// it is the same markup and the same CSS in the VR panel and in the desktop sidebar -- so a
// change to how pinning looks or is labelled cannot land on one and not the other.
export const SECTION_LABELS = {
  scene: 'Scene', rendering: 'Rendering', camera: 'Camera', topology: 'Topology',
  sculpting: 'Tools', properties: 'Properties', animation: 'Animation',
};

export function sectionHeaderHTML(sectionId) {
  const label = SECTION_LABELS[sectionId] ?? sectionId;
  return `<div class="mm-section-header"><span class="mm-section-header-title">${label}</span>`
    + `<button class="mm-section-pin-btn" id="mm-section-pin-btn" title="Float panel">${ICON_PIN}</button></div>`;
}

// The section the panel opens on, and the one the tab strip marks active. Named rather than
// positional so the two cannot disagree.
const DEFAULT_SECTION = 'sculpting';

// ── UI REORG MOCKUP (branch ui-reorg-mockup) ────────────────────────────────
//
// A LAYOUT EXPERIMENT BEHIND A SWITCH, not a decision. Everything it changes is markup and
// CSS; no command moves and no wiring changes, so the old layout is always one toggle away
// and the two can be compared on the same build in the same session.
//
// ON BY DEFAULT on this branch, because the point of the branch is to look at it. Flip it in
// Settings (both panels carry the toggle, see DEV_TOGGLES) or with window._uiReorg = false.
//
// What it does:
//   - menubar:  Background + Reference fold into one View menu, which also absorbs the
//               Rendering and Camera SECTIONS. Six buttons become five, and the row has room
//               again -- it was full at ${MM_W}px, which is what killed the first version of
//               this plan (a seventh button pushed the pin off the panel on Vision Pro).
//   - tabstrip: Rendering and Camera leave (they are in View now). Blendshapes and Timeline
//               are LAUNCHERS rather than tabs -- they spawn other panels while looking
//               exactly like the six that switch content -- so they drop below a divider.
//               Nine buttons become five plus two launchers.
//   - content:  the Sculpt and Mesh Edit grids collapse; the bone panel's once-a-session
//               blocks collapse.
//
// REVEALED BY A CLASS ON THE ROOT, not rebuilt. Same trick as the hands-only row: the shell
// is built once in the constructor, so anything that has to survive a toggle must already be
// in the markup with CSS deciding whether it shows. A rebuild would work too and would mean
// tearing down a live panel mid-session to look at a layout.
// uiReorg() lives in uiTokens.js so bonePanel can read it without a cycle. Re-exported
// here because this is where the rest of the panel vocabulary is imported from.
export { uiReorg };

// ── Dimensions ───────────────────────────────────────────────────────────────
export const MM_W  = 480;   // total DOM width  (px)
const MM_TABS_W    = 50;    // left tab-strip width
const MM_MENUBAR_H = 44;    // top menubar height (px) — must match actual rendered height
// Body height is fixed so the mesh never changes dimensions on tab switch.
const MM_BODY_H    = 456;   // height below menubar (scrollable content lives here)
// Hands-only undo/redo strip pinned to the bottom. The body loses exactly this much when it is
// shown, so the two never overlap and no content is hidden underneath it.
const MM_UNDO_H    = 38;

// CONTAINERS THAT ALREADY LAY THEMSELVES OUT, excluded from the density rules below.
//
// The density exists for content that is one control per row. A row authored to be compact is
// not that, and repacking it makes it worse: the Scene page's add-row puts six primitive
// buttons on ONE line at 38-57px each, and a 170px flex-basis turned that into three rows of
// 193px blocks. The four rig-constraint buttons went from one row to two the same way.
// matt, comparing the hosts: "the desktop layout is good and compact, match it" -- the sidebar
// was right precisely because these rules had never been applied to it.
//
// Written INTO the dense selectors rather than as an override after them. As a separate
// opt-out it lost on specificity to the :has() rules and changed nothing, which is the sort of
// silent no-op this file has produced twice already.
const AUTHORED_ROWS = ':not(.mm-add-row, .mm-rig-btn-row, .mm-btn-pair, .mm-choice-grid, '
  + '.mm-toolbar, .mm-xform-row, .mm-check-pair, .acp-transport, .acp-btn-grid, .acp-frame-grid)';

// ── CSS ──────────────────────────────────────────────────────────────────────
const CSS = `
/* An icon is a path now, not a glyph. Sized and coloured exactly as the <i> it replaced was:
   1em square so it tracks font-size, currentColor so it inherits, and FontAwesome's own
   -0.125em baseline nudge so it sits on the text line the way the glyph did. */
.fa-i {
  width: 1em;
  height: 1em;
  fill: currentColor;
  vertical-align: -0.125em;
  display: inline-block;
  flex-shrink: 0;
}
#mm-root {
  /* width + height are set as inline styles in the constructor so they survive
     the polyfill's SVG foreignObject serialisation.  The CSS selector here is
     kept for fallback / non-VR use only. */
  width: ${MM_W}px;
  background: #1e1e2e;
  color: #cdd6f4;
  font-family: system-ui, -apple-system, sans-serif;
  box-sizing: border-box;
  border-radius: 12px;
  /* AN INSET SHADOW, NOT A BORDER. The rasteriser builds its SVG at the element's CLIENT size
     and draws the element at 0,0 inside it, so anything in the border box but outside the
     client box — the bottom and right borders, and whatever they push out of view — is simply
     cut off. An inset shadow paints inside the client box and costs nothing at the edges.
     It looks the same; it is measured differently. */
  box-shadow: inset 0 0 0 2px #585b70;
  overflow: hidden;
  user-select: none;
  /* position:absolute is injected by the polyfill; position:relative makes the
     element a containing block for its absolutely-positioned children when it
     renders normally (desktop overlay etc). */
  position: relative;
}

/* ── Top menubar ─────────────────────────────────────────────── */
/* Absolute positioning avoids dependence on display:flex on #mm-body, which
   can fail silently inside Chrome SVG foreignObject rendering. */
#mm-menubar {
  position: absolute;
  top: 0; left: 0; right: 0;
  height: ${MM_MENUBAR_H}px;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 5px 8px;
  border-bottom: 2px solid #45475a;
  background: #11111b;
  box-sizing: border-box;
}
.mm-menu-btn {
  /* SHRINK BEFORE THE PIN MOVES. The same markup rasterises at different widths on visionOS and
     on Galaxy XR — matt: "it renders differently on avp vs gxr" — so a row that ends 4px short
     of the edge in one engine can run past it in the other, and what gets pushed off is the
     flex-shrink:0 button at the end. A flex item with nowrap text will not shrink below its
     content unless min-width says it may; with these two it gives up label width instead, and
     the pin stays on the panel whatever the font metrics turn out to be. */
  min-width: 0;
  overflow: hidden;
  padding: 5px 11px;
  border: 1px solid #45475a;
  border-radius: 5px;
  background: #1e1e2e;
  color: #cdd6f4;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  outline: none;
  white-space: nowrap;
}
.mm-menu-btn:hover, .mm-menu-btn.hover { background: #313244; color: #cdd6f4; border-color: #7f849c; }
.mm-menu-btn.active {
  background: #45475a;
  color: #89b4fa;
  border-color: #89b4fa;
}
.mm-pin-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 5px 7px;
  border: 1px solid #45475a;
  border-radius: 5px;
  background: #1e1e2e;
  color: #6c7086;
  cursor: pointer;
  outline: none;
  flex-shrink: 0;
}
.mm-pin-btn:hover, .mm-pin-btn.hover { background: #313244; color: #cdd6f4; border-color: #7f849c; }

/* HANDS-ONLY CONTROLS — see the note in MiniPanel. Present in the markup, revealed by a class on
   the root, so it stays a style change and needs only a repaint. A controller runtime has X/A
   and a thumbstick for these. */
/* ID-QUALIFIED ON PURPOSE. A bare .mm-hands-only display:none ties on specificity with
   .mm-row display:flex, so source order decides and the row wins — the control then shows on a
   controller, which is the one device it is meant to stay off. Qualifying with the root id
   beats any single-class rule, and the reveal below beats this in turn.
   (No backticks in here: this whole block is inside a JS template literal.) */
#mm-root .mm-hands-only { display: none; }
#mm-root.hands-only .mm-hands-only { display: flex; }
#mm-root.hands-only #mm-undo-row { display: flex; }

/* ABSOLUTE, AND THE BODY GIVES UP THE ROOM FOR IT.
   #mm-body is position:absolute, so it is out of normal flow — a static sibling after it does
   not land below it, it lands immediately after the menubar and draws across the top of the
   panel. matt: "they seem to be drawing over/under the menu buttons at the top."
   So the row is pinned to the bottom, and the body is shortened by exactly its height when the
   row is shown, rather than the row being laid over content that is still there. */
#mm-undo-row {
  position: absolute;
  left: 0; right: 0; bottom: 0;
  height: ${MM_UNDO_H}px;
  box-sizing: border-box;
  gap: 6px;
  padding: 6px 8px;
  background: #1e1e2e;
  border-top: 1px solid #313244;
}
#mm-root.hands-only #mm-body { height: ${MM_BODY_H - MM_UNDO_H}px; }
#mm-undo-row button {
  flex: 1;
  padding: 7px 0;
  border: 1px solid #45475a;
  border-radius: 6px;
  background: #1e1e2e;
  color: #a6adc8;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  outline: none;
}
#mm-undo-row button:hover, #mm-undo-row button.hover { background: #313244; color: #cdd6f4; border-color: #7f849c; }
.mm-pin-btn.active {
  background: rgba(203,166,247,0.15);
  color: #cba6f7;
  border-color: #cba6f7;
}

/* ── Body (tab strip + content) ──────────────────────────────── */
#mm-body {
  position: absolute;
  top: ${MM_MENUBAR_H}px;
  left: 0; right: 0;
  height: ${MM_BODY_H}px;
}

/* ── Left tab strip ──────────────────────────────────────────── */
/* ── UI reorg mockup: what the class on the root switches ────────────────────
   Both layouts are in the markup at all times; these rules choose one. Everything here is
   display and order only, so a toggle is a repaint and never a rebuild. */
/* TWO CLASSES ON THE ROOT, NOT AN ID, and both selectors below are two-class deep on purpose.
   Scoping to #mm-root looked tidier and was wrong twice over: a single-class .mm-reorg-only
   display rule ties on specificity with any single-class rule that sets display, and then
   source order decides it (the same trap the MiniPanel's hands-only row documents), and an id
   selector matches only THE root -- so a torn-off section, a floated copy, or anything else
   rendering this markup under a different id silently gets the legacy layout. */
.ui-legacy .mm-reorg-only { display: none; }
.ui-reorg .mm-legacy-only { display: none; }
/* The launcher group: same buttons, pushed to the bottom of the strip and fenced off, so a
   button that opens another panel no longer looks like a button that switches this one. */
/* Only the FIRST launcher pushes. auto margin on both made each one claim its share of the
   free space, so the two ended up spread down the strip instead of grouped at the bottom. */
.ui-reorg #mm-tabstrip .mm-tab-launcher.mm-tab-launcher-first {
  margin-top: auto;
  border-top: 2px solid #45475a;
  padding-top: 8px;
}
/* A collapsed group keeps its heading: the whole argument for collapsing rather than
   subtabbing is that the other group stays visible, named, and one click away. */
.mm-group-head {
  display: flex; align-items: center; gap: 6px; width: 100%;
  margin: 6px 0 3px 0; padding: 3px 4px;
  background: none; border: 0; border-radius: 4px;
  color: #a6adc8; font-size: 11px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.08em;
  cursor: pointer; text-align: left;
}
.mm-group-head:hover, .mm-group-head.hover { background: #313244; color: #cdd6f4; }
.mm-group-chev { font-size: 9px; width: 10px; flex-shrink: 0; color: #6c7086; }
/* COLLAPSED MEANS HIDDEN, WHATEVER ELSE IS SAID ABOUT THE ELEMENT.
   Without the !important this rule LOSES. A collapsed body that directly contains a row or a
   button matches the density container selector, which resolves to display:flex, and that
   selector scores (0,3,0) against this rule's (0,2,0) -- so the section carried the class,
   reported itself collapsed, and rendered in full.
   It only bit the VR main panel, because .mm-dense is on #mm-content and nowhere else: the
   desktop sidebar and the animation panel were always right, which is exactly the shape matt
   reported -- "on gxr in vr, almost every section, both menus and panels, are fully expanded"
   while the desktop looked correct.
   The specificity also crept up as the density selectors gained :has() and :not() parts, so
   this worked earlier in the branch and stopped. window.uiDiag() reports it directly now:
   collapsedButStillVisible. */
.mm-group-body.collapsed { display: none !important; }

#mm-tabstrip {
  position: absolute;
  top: 0; left: 0;
  width: ${MM_TABS_W}px;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 5px;
  gap: 4px;
  border-right: 2px solid #45475a;
  background: #11111b;
  box-sizing: border-box;
  overflow: hidden;
}
.mm-tab-btn {
  width: 38px;
  height: 38px;
  padding: 0;
  border: 1px solid #45475a;
  border-radius: 6px;
  background: #1e1e2e;
  color: #cdd6f4;
  cursor: pointer;
  outline: none;
  box-sizing: border-box;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}
.mm-tab-btn svg, .mm-tab-btn i { pointer-events: none; }
.mm-tab-btn:hover, .mm-tab-btn.hover { background: #313244; color: #cdd6f4; border-color: #7f849c; }
.mm-tab-btn.active {
  background: rgba(137,180,250,0.25);
  color: #89b4fa;
  border-color: #89b4fa;
  font-weight: 800;
}
.mm-tab-btn.torn {
  opacity: 0.3;
  pointer-events: none;
}
/* Toggle tabs (Blendshapes / Timeline) pack with the rest — no bottom push — but keep
   the .tl-on highlight below to show when their mesh is visible. */
.mm-tl-btn.tl-on { background: rgba(137,220,235,0.2); color: #89dceb; border-color: #89dceb; }
.mm-section-header {
  display: flex;
  align-items: center;
  height: 34px;
  margin: -8px -10px 8px -10px;
  padding: 0 8px;
  background: #11111b;
  border-bottom: 2px solid #45475a;
  box-sizing: border-box;
  gap: 6px;
  position: sticky;
  top: -8px;
  z-index: 3;
  flex-shrink: 0;
}
.mm-section-header-title {
  flex: 1;
  font-size: 12px;
  font-weight: 700;
  color: #89b4fa;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.mm-section-pin-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px; height: 26px;
  padding: 0;
  border: 1px solid #45475a;
  border-radius: 5px;
  background: #1e1e2e;
  color: #6c7086;
  cursor: pointer;
  outline: none;
  flex-shrink: 0;
}
.mm-section-pin-btn:hover, .mm-section-pin-btn.hover {
  background: #313244;
  color: #89b4fa;
  border-color: #89b4fa;
}

/* ── Content area ────────────────────────────────────────────── */
#mm-content {
  position: absolute;
  top: 0;
  left: ${MM_TABS_W}px;
  right: 14px; bottom: 0;
  overflow-y: scroll;
  overflow-x: hidden;
  padding: 8px 10px 8px 10px;
  box-sizing: border-box;
  scrollbar-width: none;
}
#mm-content::-webkit-scrollbar { display: none; }

/* ── Custom scrollbar (VR-safe — native scrollbar is hidden) ─── */
.mm-scrollbar-track {
  position: absolute;
  right: 0; top: 0; bottom: 0;
  width: 14px;
  background: #181825;
  box-sizing: border-box;
  z-index: 20;
}
.mm-scrollbar-thumb {
  position: absolute;
  left: 3px; right: 3px;
  min-height: 32px;
  background: #585b70;
  border-radius: 4px;
  cursor: pointer;
  user-select: none;
}
.mm-scrollbar-thumb.hover, .mm-scrollbar-thumb:hover { background: #7f849c; }

/* ── Shared content primitives ───────────────────────────────── */
.mm-section-title {
  font-size: 10px;
  font-weight: 700;
  color: #6c7086;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  padding: 5px 0 3px;
  border-bottom: 1px solid #313244;
  margin-bottom: 4px;
}
.mm-section-title:first-child { padding-top: 0; }
/* A FIELD LABEL, NOT A SECTION. Same look as a section heading and none of its behaviour:
   groupSectionTitles wraps every .mm-section-title into a collapsible, so a heading used merely
   to name one control turns into a chevron you have to open to reach a single dropdown. That is
   what the Camera page was -- five collapsibles over five controls. matt: "the view->camera
   section itself can be simplified, no subsections, just put all those options in all those
   subsections under 'camera'." */
.mm-field-lbl {
  font-size: 10px; color: #6c7086; text-transform: uppercase; letter-spacing: .06em;
  padding: 6px 0 2px;
}
/* A control that does not apply right now, still in its place. pointer-events off rather than
   the input's own disabled attribute, so the row keeps its height and nothing below it moves when
   the projection changes -- which is the whole reason it is dimmed rather than hidden. */
.mm-inert { opacity: 0.35; pointer-events: none; }

/* ── DENSITY (ui reorg mockup) ───────────────────────────────────────────────
   ASK THE STRUCTURAL QUESTION, DO NOT GUESS AT IT. This rule was widened three times before
   landing here, and each widening was the same mistake: naming the containers it expected the
   controls to be in. They are 2 to 4 levels down and the depth varies by section -- a button
   can sit in div.shader-pbr, or in fieldset.mm-disabled-group inside it, or in div.mm-if-uv
   inside that. A named list cannot keep up, and when it falls behind the symptom is nasty:
   half the panel packs and half does not, with nothing on screen saying why.

   :has() asks "does this element directly contain a control" instead, so it finds them at
   whatever depth they turn out to be.

   THE HEADINGS DO THE GROUPING FOR FREE. Anything not given a smaller basis stays at 100
   percent, and section titles are in that default -- so a title forces a line break, a run of
   controls between two titles packs together, and controls under different headings never end
   up side by side. No wrappers, no per-section column counts.

   THE BASIS IS THE ADAPTIVE MECHANISM. At 190px a 410px main panel fits two rows and a 240px
   wrist panel fits one, from the same markup.

   (no backticks in here, and no double-dash: this is inside a template literal and it is also
   serialised as XML by the rasteriser. panelxml_test checks both.) */
.mm-dense,
.mm-dense *:has(> .mm-row, > .mm-toggle, > .mm-action-btn)${AUTHORED_ROWS} {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  /* ALIGN-CONTENT, WHICH IS THE ONE THAT BITES. A wrapping flex container defaults to
     stretching its LINES to fill its height, and this container has a fixed 456px height. So a
     page of seven collapsed headings became seven flex lines each stretched to a seventh of the
     panel: 27px headings sitting 55px apart, floating down an otherwise empty box.

     This is what matt saw on the collapsed Topology panel in the headset, and it is the same
     thing reported earlier as a "big gap between collapsed sections" -- which was then wrongly
     blamed on the panel being a fixed-size quad. The quad does not help, but the gap is this.

     align-items governs an item within its line and was already set; it does nothing about the
     lines themselves. */
  align-content: flex-start;
  gap: 0 10px;
}
.mm-dense > *,
.mm-dense *:has(> .mm-row, > .mm-toggle, > .mm-action-btn)${AUTHORED_ROWS} > * {
  flex: 1 1 100%;
  min-width: 0;
}
.mm-dense > .mm-row,
.mm-dense *:has(> .mm-row)${AUTHORED_ROWS} > .mm-row { flex: 1 1 190px; }

/* A lone short button does not need its own row. The View page alone carried ten of them at
   396px for labels of one to three words. */
.mm-dense > .mm-toggle,
.mm-dense > .mm-action-btn,
.mm-dense *:has(> .mm-toggle)${AUTHORED_ROWS} > .mm-toggle,
.mm-dense *:has(> .mm-action-btn)${AUTHORED_ROWS} > .mm-action-btn { flex: 1 1 170px; }

/* A collapsible heading is a divider: it must never share a line with what it labels. */
.mm-dense .mm-group-head { flex: 1 1 100%; }

.mm-row { flex: 1 1 190px; }

/* A LONE SHORT BUTTON DOES NOT NEED ITS OWN ROW. The View page alone carried ten of them at
   396px for labels of one to three words -- Ground Plane, Shadow Catcher, Hide All
   Decorations, Pivot, Fill, Show references -- about 270px of height for content that pairs
   into half that. */
.mm-dense > .mm-toggle,
.mm-dense > .mm-action-btn,
.mm-dense .mm-group-body > .mm-toggle,
.mm-dense .mm-group-body > .mm-action-btn { flex: 1 1 170px; }

/* A collapsible heading is a divider: it must never share a line with what it labels. */
.mm-dense .mm-group-head { flex: 1 1 100%; }

.mm-row { flex: 1 1 190px; }

/* A SLIDER ROW KEEPS THE WHOLE LINE, and the reason is the label column rather than the slider.
   .mm-lbl is a fixed 30% so every control in a panel starts at the same x -- which is right at a
   full 392px (the longest label here measures 95px against 118px of column) and falls apart the
   moment two rows pack onto one line: 30% of a 190px half-row is 57px, and "Grab speed" comes out
   "Grab sp...". matt, reading the settings page: "i can't read the label on these parameters.
   'grab speed' (i assume) is 'grab sp...', the other is 'trigger ...', i don't know what these
   do." A control whose name you cannot read is not a control.

   Packing was a good trade when a row was a label and a checkbox. It stopped being one once the
   sections became collapsible -- matt: "because we're folding parameters now, maybe we don't need
   to put 2 sliders together?" -- because folding already buys back far more height than pairing
   ever did, and it buys it without taking the words away.

   Slider rows only. A select or a checkbox row still pairs happily; those labels are short and
   the control does not need the width.

   TWO THINGS HERE ARE DELIBERATE, AND BOTH WERE MEASURED RATHER THAN GUESSED.

   The class is applied in JS (uiTokens.groupSectionTitles) rather than selected with
   :has(input[type=range]). Not because :has() is unsupported -- it is -- but because the class is
   then available to a selector of ANY shape, which matters for the second point.

   And it is !important, which is not usually the answer. The packing it has to beat is
   .mm-dense :has(> .mm-row):not(...) > .mm-row, and :has() and :not() take the specificity of
   their most specific argument, so that rule scores (0,4,0). The obvious
   .mm-dense .mm-row.mm-row-wide is (0,3,0) and loses -- which is exactly what matt saw:
   "this is what it looks like in vr. still packing into 2 columns, i can't read the labels."
   Matching (0,4,0) would mean rebuilding that selector's shape here and keeping the two in step
   for ever. There is also a bare .mm-row { flex: 1 1 190px } that applies OUTSIDE .mm-dense
   entirely, so any .mm-dense-scoped answer misses the desktop sidebar's rows regardless.

   One class, applied to exactly the rows that need it, opting out of a cascade of packing rules
   at several specificities. That is the case !important exists for. */
.mm-row.mm-row-wide { flex: 1 1 100% !important; }

/* FULL-WIDTH SINGLE BUTTONS PACK TOO. The View page alone carried ten of them at 396px for
   labels of one to three words -- Ground Plane, Shadow Catcher, Hide All Decorations, Pivot,
   Fill, Show references -- which is about 270px of height for content that pairs into half
   that.

   THE HEADINGS DO THE GROUPING FOR FREE. Section titles stay at flex-basis 100 percent, so a
   title forces a line break and a run of buttons between two titles packs together and no
   further. Buttons under different headings can never end up side by side, without anyone
   having to wrap them in anything. */
.mm-dense > .mm-toggle,
.mm-dense > .mm-action-btn { flex: 1 1 170px; }

.mm-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 0;
}
/* A FIXED LABEL COLUMN, so every row in a panel starts its control at the same x.
   With flex:1 the label took whatever half was left, and "whatever was left" differs by row:
   (no backticks in here — this stylesheet is inside a template literal and one closes it)
   a slider row also carries a 34px value readout and a select row does not, so the two split the
   line differently and the controls came out ragged against each other — measured at 193px
   against 173px in the same panel. matt: "its ragged, make both the width of the env combobox
   match the width of the mesh opacity and capsule opacity below it."
   A PERCENTAGE rather than pixels because these panels are torn off at other widths, and the
   longest label here is 95px against 30% of 392 — room to spare, and the ellipsis below is the
   backstop for anything longer. */
.mm-lbl {
  flex: 0 0 30%;
  font-size: 11px;
  color: #a6adc8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mm-val {
  width: 34px;
  text-align: right;
  font-size: 10px;
  color: #7f849c;
  flex-shrink: 0;
}
/* Tall enough to hit with a ray — see the note on #mp-root input[type=range]. A 4px box is a
   sliver in a headset, and the thumb the eye aims at is drawn well outside it. */
.mm-row input[type=range] {
  flex: 1;
  accent-color: #89b4fa;
  height: 18px;
  cursor: pointer;
  min-width: 0;
}

/* Checkbox row: label left, custom checkbox right */
.mm-check-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 5px 0;
  font-size: 11px;
  color: #a6adc8;
  cursor: pointer;
  user-select: none;
  gap: 8px;
  box-sizing: border-box;
}
.mm-check-row:hover { color: #cdd6f4; }
.mm-check-row input[type=checkbox] {
  width: 0;
  height: 0;
  opacity: 0;
  margin: 0;
  flex-shrink: 0;
}
.mm-checkmark {
  position: relative;
  width: 13px;
  height: 13px;
  border: 1px solid #585b70;
  border-radius: 3px;
  background: #313244;
  flex-shrink: 0;
}
.mm-check-row input[type=checkbox]:checked + .mm-checkmark {
  background: #89b4fa;
  border-color: #89b4fa;
}
.mm-check-row input[type=checkbox]:checked + .mm-checkmark::after {
  content: '';
  position: absolute;
  left: 3px;
  top: 0px;
  width: 4px;
  height: 8px;
  border: 2px solid #1e1e2e;
  border-top: none;
  border-left: none;
  transform: rotate(45deg);
}
/* Two check-rows sharing one line (space-tight options). */
.mm-check-pair { display: flex; gap: 12px; width: 100%; box-sizing: border-box; }
.mm-check-pair .mm-check-row { flex: 1 1 0; min-width: 0; }
.mm-check-pair .mm-check-row > span:first-child {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* Toggle (checkbox replacement) */
/* Toggles share the action-button resting look (single button language); the
   only difference is the .active highlight for genuine on/off toggles. */
.mm-toggle {
  width: 100%;
  padding: 7px 10px;
  border: 1px solid #45475a;
  border-radius: 5px;
  background: #181825;
  color: #cdd6f4;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  text-align: left;
  outline: none;
  margin-bottom: 3px;
  box-sizing: border-box;
}
.mm-toggle:hover, .mm-toggle.hover { filter: brightness(1.2); }
.mm-toggle.active {
  background: rgba(137,180,250,0.2);
  color: #89b4fa;
  border-color: #89b4fa;
}
/* A TICK DRAWN FROM THE STATE, for toggles that opt in with .mm-tick.
   Same approach as the mini panel: the .active class is the single source of truth, so the
   indicator cannot disagree with the highlight the way a tick typed into the label can.
   Opt-in rather than applied to every .mm-toggle, because the others here spell their state out
   in words (On / Off) and changing those was not asked for.
   NOTE: this whole block is a JS TEMPLATE LITERAL. No backticks anywhere, comments included. */
.mm-toggle.mm-tick.active::before { content: '✓ '; }

/* Choice grid (combobox replacement) */
.mm-choice-grid {
  display: grid;
  gap: 3px;
  margin-bottom: 6px;
}
.mm-choice-grid.cols-2 { grid-template-columns: repeat(2, 1fr); }
.mm-choice-grid.cols-3 { grid-template-columns: repeat(3, 1fr); }
/* cols-4 WAS USED AND NEVER DEFINED. The Export format row (glb / obj / ply / stl) asks for it,
   and with no rule to match, .mm-choice-grid's bare display:grid gave it ONE column -- so four
   short buttons have been stacking vertically down the full width of the panel, in the VR menu
   and the desktop sidebar both, for as long as that markup has existed. Nothing errors for a
   class that does not exist, which is why it survived; panelxml_test now checks the family. */

.mm-choice-grid.cols-4 { grid-template-columns: repeat(4, 1fr); }
.mm-choice-grid.cols-5 { grid-template-columns: repeat(5, 1fr); }
.mm-choice {
  padding: 6px 4px;
  border: 1px solid #45475a;
  border-radius: 5px;
  background: #313244;
  color: #a6adc8;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  text-align: center;
  outline: none;
}
.mm-choice:hover, .mm-choice.hover { filter: brightness(1.2); }
.mm-choice.active {
  background: rgba(137,180,250,0.2);
  color: #89b4fa;
  border-color: #89b4fa;
}
.mm-choice.mm-dim, .mm-toggle.mm-dim, .mm-action-btn.mm-dim { opacity: 0.4; } /* mesh tools, and symmetry, while a voxel object is active */

/* Action button */
.mm-action-btn {
  width: 100%;
  padding: 7px 10px;
  border: 1px solid #45475a;
  border-radius: 5px;
  background: #181825;
  color: #cdd6f4;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  text-align: left;
  outline: none;
  margin-bottom: 3px;
  box-sizing: border-box;
}
/* Spacing between a leading FontAwesome icon and the button label. */
.mm-action-btn i { margin-right: 6px; }
.mm-action-btn:disabled { opacity: 0.4; cursor: default; pointer-events: none; }
.mm-transport {
  display: flex;
  gap: 3px;
  margin-bottom: 6px;
}
.mm-transport-btn {
  flex: 1;
  padding: 6px 0;
  border: 1px solid #45475a;
  border-radius: 5px;
  background: #181825;
  color: #cdd6f4;
  font-size: 12px;
  cursor: pointer;
  text-align: center;
  outline: none;
  box-sizing: border-box;
}
.mm-transport-btn:hover, .mm-transport-btn.hover { background: #313244; border-color: #7f849c; }
.mm-transport-btn:active, .mm-transport-btn.active { background: #45475a; }
.mm-transport-btn.record { color: #f38ba8; }
.mm-action-btn.hover { background: #313244; }
.mm-action-btn.danger { color: #f38ba8; border-color: #f38ba8; }
.mm-action-btn.danger.hover { background: rgba(243,139,168,0.15); }
/* Mouse :hover only on hover-capable devices — on iPad/touch the :hover state
   sticks after a tap (looked like an action button stayed "selected"). The VR
   ray uses the .hover class above, which is unaffected. */
@media (hover: hover) {
  .mm-action-btn:hover        { background: #313244; }
  .mm-action-btn.danger:hover { background: rgba(243,139,168,0.15); }
}

/* Two-button row */
.mm-btn-pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  margin-bottom: 3px;
}
.mm-btn-pair .mm-action-btn { margin-bottom: 0; }

/* ── Custom select (VR-safe dropdown) ──────────────────────────── */
.mm-select { width: 100%; margin-bottom: 3px; }
/* A SELECT INSIDE A LABELLED ROW SITS BESIDE THE LABEL, like a slider does. On its own it is a
   full-width control with a heading over it; in a row it is the control half of "label: value",
   so it takes the space the label leaves rather than the whole line. Without this the 100% above
   wins and the label is pushed onto its own line above it. */
.mm-row .mm-select { flex: 1; width: auto; margin-bottom: 0; min-width: 0; }
.mm-select-trigger {
  width: 100%; padding: 5px 8px; box-sizing: border-box;
  background: #2a2a3e; color: #cdd6f4; border: 1px solid #45475a;
  border-radius: 4px; font-size: 11px; cursor: pointer; text-align: left;
  display: flex; justify-content: space-between; align-items: center;
  outline: none;
}
.mm-select-trigger::after { content: ' ▾'; flex-shrink: 0; color: #7f849c; }
.mm-select-trigger:hover, .mm-select-trigger.hover { border-color: #7f849c; }
.mm-select-opts {
  border: 1px solid #45475a; border-top: none;
  border-radius: 0 0 4px 4px; background: #1e1e2e; overflow: hidden;
}
.mm-select-opt {
  display: block; width: 100%; text-align: left; padding: 6px 12px;
  background: transparent; color: #a6adc8; border: none; font-size: 11px;
  cursor: pointer; box-sizing: border-box; outline: none;
}
.mm-select-opt:hover, .mm-select-opt.hover { background: #313244; color: #cdd6f4; }
.mm-select-opt.active { color: #89b4fa; background: rgba(137,180,250,0.08); }

/* Outliner item (scene tab) */
/* Bordered object list — tall enough for ~8 rows, then FLOWS (grows) rather than
   making its own scroll container. A nested scrollable fought the panel's own scroll
   in VR (the thumbstick targeted the deepest scrollable, this list, so the controls
   below were unreachable). With the list flowing, the panel is the single scroll
   surface on both desktop and VR. */
/* The list needs a scrollbar you can actually SEE and grab. Native ones never reach the panel:
   the VR panel is rasterised through an SVG foreignObject, which paints no scrollbar at all —
   the same reason #mm-content has a hand-built track. So the list gets the same treatment, in a
   relative wrapper that the track can pin itself to. */
.mm-outliner-wrap { position: relative; }
.mm-outliner-list::-webkit-scrollbar { display: none; }
.mm-outliner-sbar {
  /* Inside the list's border, and only as tall as the list — the shared .mm-scrollbar-track
     stretches to its offset parent, which here would be the whole wrapper. */
  top: 1px; bottom: 6px; right: 1px;
  width: 12px;
  border-radius: 5px;
}
.mm-outliner-list {
  border: 1px solid #45475a;
  border-radius: 5px;
  /* Flow at content height (single panel scroll surface). The floor used to be 248px,
     which reserved a big empty block for a 2–3 mesh scene and pushed the transform/rig
     controls off-screen — now just enough to not collapse when empty. */
  /* ...AND THEN NEITHER, BECAUSE A LIST THAT RESIZES IS THE PROBLEM. Flowing at content height
     means the list — and the whole panel under it — moves every time the scene gains or loses a
     row, so the buttons below never stay where you left them and selecting things walks the
     layout around under your hand. matt: "the outliner shouldn't collapse size. keep it whatever
     is its maximum size at all times. we'll adjust the other buttons to fit."
     One fixed height, always: it scrolls when there is more and shows empty space when there is
     less, and nothing below it ever moves. It also takes the panel's own height out of the
     equation, which is what the resize machinery in HTMLVRPanel spends its time chasing. */
  height: ${Math.round(MM_BODY_H * 0.44)}px;
  min-height: 52px;
  /* ...AND A CEILING, because the other end became the problem. A rig has dozens of joints,
     and at content height the list grew to the full panel and pushed everything below it out
     of reach: every visit to a rig control meant scrolling past the whole skeleton. Capped at
     two thirds, the list scrolls itself and the controls under it stay where they were.
     matt: "it should expand no bigger than, say 2/3 of the panel."
     THEN A THIRD SMALLER AGAIN (0.66 -> 0.44), because two thirds still buried what is under it:
     the transform fields and the parenting buttons are the reason you open this panel with a rig
     selected, and reaching them meant scrolling the whole skeleton first. matt: "the outliner
     takes up too much vertical space still in that menu, its hard to scroll past it to get to
     the transform matrix controls and set parent buttons. make it 1/3 less rows." */
  max-height: ${Math.round(MM_BODY_H * 0.44)}px;
  overflow-y: auto;
  overscroll-behavior: contain;   /* stop a flick inside the list from scrolling the panel too */
  scrollbar-width: none;          /* the rasteriser does not paint native scrollbars — see .mm-outliner-sbar */
  padding: 2px 4px;
  padding-right: 16px;            /* room for the track, which overlays the right edge */
  margin-bottom: 5px;
  box-sizing: border-box;
}
/* DRAGGABLE, ON DESKTOP ONLY. The fixed height above is what stops the list moving everything
   below it as the scene changes, and it has to stay — but a desktop window has vertical space to
   spare and a mouse that can grab an edge, so the number should be the user's rather than a
   fraction of the panel. matt: "on desktop because there's more vertical space and its easier to
   grab things, can the outliner region be draggable so i can expand its height?"
   SCOPED TO wa-tab-panel, which is the desktop sidebar's own container — the VR panel lives in
   the host canvas and never matches, so the headset keeps the fixed height it needs and the
   rasteriser is never asked to draw a resize grabber it cannot paint.
   max-height goes with it: a cap the user is dragging against is a cap fighting them. */
wa-tab-panel .mm-outliner-list {
  /* NO CSS resize any more. That is a feature iOS Safari does not implement, so the
     one place with the least room to spare was the one place it never worked -- and where it DID
     work the grabber was a 7px corner. The grip below does the job on every device, so the
     native one is left off rather than having two handles in the same corner. */
  max-height: none;
}
/* The drag target. Full width so a finger can find it, and only in the docked sidebar: the VR
   panel keeps its fixed height (see the note above) and the rasteriser is never asked to paint
   a handle it cannot use. */
.mm-outliner-grip { display: none; }
wa-tab-panel .mm-outliner-grip {
  display: block;
  height: 11px;
  margin: -3px 0 5px;
  cursor: ns-resize;
  touch-action: none;          /* or the page scrolls instead of the drag running */
  border-radius: 0 0 5px 5px;
  /* Two hairlines, the same visual language as the float panel's corner grip. */
  background:
    linear-gradient(to bottom, transparent 0 3px, #6c7086 3px 4px, transparent 4px 6px,
                    #6c7086 6px 7px, transparent 7px 100%);
  background-size: 26px 100%;
  background-repeat: no-repeat;
  background-position: center;
}
wa-tab-panel .mm-outliner-grip:hover { filter: brightness(1.6); }

.mm-outliner-row {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 0 0;
}
/* A QUARTER SMALLER, throughout the outliner. Sized for a scene of a few meshes, the rows were
   comfortable; against a skeleton they are most of the panel. Everything here scales together —
   type, eye, icon and gaps — because shrinking only the text leaves the buttons setting the
   row height and nothing is gained. matt: "the font size and icons used for the outliner are
   too big, i think they could be 25% smaller in vr." */
/* WITH THE EYE GONE FROM THE ROW, THE ROW ITSELF CARRIES THE STATE. A hidden mesh was legible
   only through its own eye icon; now the name dims, and a keyframe-driven one takes the same
   orange the eye used, so "the timeline controls this" still reads at a glance. */
.mm-outliner-row.is-hidden .mm-mesh-btn { opacity: 0.45; font-style: italic; }
.mm-outliner-row.vis-keyed .mm-node-icon { color: #fab387; }
.mm-outliner-row.vis-keyed.is-hidden .mm-node-icon { color: #8a4b1e; }
/* The toolbar eye takes the same orange when the selection's visibility is keyed. */
.mm-tool-btn.keyed { color: #fab387; }
.mm-collapse-btn {
  width: 16px; height: 24px; flex-shrink: 0; padding: 0;
  border: none; background: none; color: #9399b2; font-size: 10px;
  cursor: pointer; outline: none;
  display: flex; align-items: center; justify-content: center;
}
.mm-collapse-btn:hover, .mm-collapse-btn.hover { color: #cdd6f4; }
.mm-collapse-spacer { width: 16px; flex-shrink: 0; display: inline-block; }
.mm-mesh-btn {
  flex: 1;
  min-width: 0;                /* allow ellipsis inside the flex row */
  display: flex;              /* override WebAwesome's centered button base */
  align-items: center;
  justify-content: flex-start;
  padding: 2px 5px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: #a6adc8;
  font-size: 8px;
  cursor: pointer;
  text-align: left;
  outline: none;
}
.mm-node-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mm-rename-input {
  flex: 1; min-width: 0;
  background: #11111b; color: #cdd6f4;
  border: 1px solid #89b4fa; border-radius: 4px;
  font-size: 8px; padding: 2px 4px; outline: none;   /* matches .mm-mesh-btn, or the row jumps height on rename */
}
.mm-mesh-btn:hover, .mm-mesh-btn.hover { background: #313244; color: #cdd6f4; }
.mm-mesh-btn.active { color: #89b4fa; background: rgba(137,180,250,0.1); }
.mm-node-icon { display: inline-block; width: 10px; font-size: 8px; text-align: center; margin-right: 4px; color: #6c7086; }
.mm-mesh-btn.is-null .mm-node-icon { color: #66e0ff; }
.mm-mesh-btn.active .mm-node-icon { color: #89b4fa; }
.mm-rig-label { font-size: 10px; color: #a6adc8; text-transform: uppercase; letter-spacing: 0.04em; margin: 8px 0 3px; }
.mm-rig-btn-row { display: flex; gap: 3px; margin-top: 4px; }
.mm-rig-btn-row .mm-toggle { flex: 1; text-align: center; }
/* Transform fields: a label + 3 numeric inputs (X/Y/Z) per row. */
.mm-xform-row { display: flex; align-items: center; gap: 3px; margin-bottom: 3px; }
.mm-xf-lbl { width: 38px; flex-shrink: 0; font-size: 11px; color: #a6adc8; }
.mm-xf {
  flex: 1; min-width: 0; box-sizing: border-box;
  background: #11111b; color: #cdd6f4;
  border: 1px solid #45475a; border-radius: 4px;
  font-size: 11px; padding: 4px 5px; outline: none; text-align: right;
}
.mm-xf:focus, .mm-xf.hover { border-color: #89b4fa; }
/* Free-text field (Nomad Link address). Same treatment as .mm-xf so it reads the
   same through the VR colour LUT, but left-aligned and at the panel's body size —
   an address is easier to read large. */
.mm-text-input {
  flex: 1; min-width: 0; box-sizing: border-box;
  background: #11111b; color: #cdd6f4;
  border: 1px solid #45475a; border-radius: 4px;
  font-size: 13px; padding: 4px 6px; outline: none;
}
.mm-text-input:focus, .mm-text-input.hover { border-color: #89b4fa; }
.mm-xf::-webkit-inner-spin-button, .mm-xf::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
/* Per-row bake button (freeze that component into the geometry), sits after the X/Y/Z fields. */
.mm-xf-bake {
  width: 24px; height: 24px; flex-shrink: 0;
  border: 1px solid #45475a; border-radius: 4px;
  background: #181825; color: #cdd6f4; font-size: 11px;
  cursor: pointer; outline: none; box-sizing: border-box;
  display: flex; align-items: center; justify-content: center; padding: 0;
}
.mm-xf-bake:hover, .mm-xf-bake.hover { background: #313244; color: #f9e2af; }
/* Outliner toolbar — icon-only copy/delete buttons. */
.mm-toolbar { display: flex; gap: 4px; margin-bottom: 6px; }
.mm-tool-btn {
  width: 32px; height: 28px; flex-shrink: 0;
  border: 1px solid #45475a; border-radius: 5px;
  background: #181825; color: #cdd6f4; font-size: 12px;
  cursor: pointer; outline: none; box-sizing: border-box;
  display: flex; align-items: center; justify-content: center;
}
.mm-tool-btn:hover, .mm-tool-btn.hover { background: #313244; }
.mm-tool-btn:disabled { opacity: 0.4; cursor: default; pointer-events: none; }
.mm-tool-btn.active { background: rgba(249,226,175,0.15); color: #f9e2af; border-color: #f9e2af; } /* locked */
/* Add-object buttons side by side (the "Add Object" title was dropped → small gap above). */
.mm-add-row { display: flex; gap: 3px; margin-top: 5px; }
.mm-add-row .mm-action-btn { flex: 1; text-align: center; }
/* During a pending pick, dim the subject row and tint pickable targets (no border). */
.mm-outliner-row.rig-target .mm-mesh-btn { background: rgba(249,226,175,0.1); }
.mm-outliner-row.rig-subject { opacity: 0.5; }

/* Info / placeholder */
.mm-info {
  font-size: 11px;
  color: #6c7086;
  padding: 6px 0;
  font-style: italic;
}

/* Storage gallery */
/* A COLUMN THAT SCROLLS ITSELF, like the outliner. A three-across grid of tiles pushed the
   panel past its own height, so finding a save meant scrolling the whole menu and the buttons
   moved while you did it. A list scrolls INSIDE its own box and everything around it stays
   put. matt: "maybe a list style like the outliner, so just a column... the internal area of
   the actual files should be scrollable, like how the outliner is scrollable within the larger
   scrollable panel. ideally the browser saves outer panel won't need any scrolling." */
.mm-storage-wrap { position: relative; }
/* Inside the list's border and only as tall as the list — the shared .mm-scrollbar-track
   stretches to its offset parent, which here would be the whole wrapper. Same as the
   outliner's, because it is the same job. */
.mm-storage-sbar {
  top: 1px; bottom: 7px; right: 1px;
  width: 12px;
  border-radius: 5px;
}
.mm-storage-list {
  border: 1px solid #45475a;
  border-radius: 5px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: ${Math.round(MM_BODY_H * 0.62)}px;
  overflow-y: auto;
  overscroll-behavior: contain;   /* a flick inside the list must not scroll the panel too */
  scrollbar-width: none;          /* the rasteriser does not paint native scrollbars */
  padding-right: 16px;            /* room for the track, which overlays the right edge */
  margin-bottom: 6px;
  box-sizing: border-box;
}
.mm-storage-list::-webkit-scrollbar { display: none; }
.mm-storage-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: #181825;
  cursor: pointer;
}
.mm-storage-item img,
.mm-storage-item .mm-storage-noimg {
  width: 34px; height: 34px; flex-shrink: 0;
  border-radius: 3px;
  object-fit: cover;
  background: #313244;
}
.mm-storage-noimg {
  display: flex; align-items: center; justify-content: center;
  font-size: 13px; color: #6c7086;
}
/* THUMBNAIL, THEN NAME, THEN DATE -- all on one line. Stacking the name above the date made the
   row twice as tall for no gain: the date is three characters and belongs beside the name, not
   under it. matt: "each row entry should be a small square thumbnail, with the name and short
   form date next to it." The name takes whatever room is left and ellipses; the date never
   shrinks, so the column of dates stays aligned down the list. */
.mm-storage-item .mm-storage-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.mm-storage-item .mm-storage-name { flex: 1; min-width: 0; }
.mm-storage-item .mm-storage-date { flex-shrink: 0; }
.mm-storage-item.selected {
  border-color: #89b4fa;
  background: #1e1e2e;
}
.mm-storage-toolbar {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 5px;
  margin-bottom: 6px;
}
.mm-storage-page {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  color: #a6adc8;
}
.mm-action-btn:disabled {
  opacity: 0.4;
  cursor: default;
}
/* THE NAME IS WHAT YOU ARE LOOKING FOR. A tile carried a picture and a date, and a date tells
   you nothing about which save it is -- saves made in one sitting all say the same thing. The
   name is typed at save time and was simply never shown. matt: "the thumbnails in the browser
   saves dialog should include the name in the listing." */
.mm-storage-name {
  display: block;
  font-size: 10px;
  color: #cdd6f4;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mm-storage-item.selected .mm-storage-name { color: #ffffff; }
.mm-storage-date {
  display: block;
  font-size: 8px;
  color: #6c7086;
  text-align: left;
  padding: 2px 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mm-storage-btns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px;
  padding: 2px;
}
.mm-storage-btns .mm-action-btn {
  font-size: 9px;
  padding: 3px 4px;
  margin-bottom: 0;
  text-align: center;
}

/* Conditional sections (Rendering) */
.mm-disabled-group {
  border: 0; margin: 0; padding: 0; min-width: 0;
}
.mm-disabled-group:disabled, .mm-if-pbr[inert], .mm-if-matcap[inert], .mm-if-uv[inert] {
  opacity: 0.4;
  pointer-events: none;
}
/* Shader-specific groups keep their place. Inapplicable controls mute instead of vanishing,
 * so the Rendering panel has one stable layout and can be used by muscle memory. */
.mm-if-pbr, .mm-if-matcap, .mm-if-uv { display: block; }

/* ── TornOffPanel (floating section panels) ───────── */
.mm-torn-root {
  width: 480px;
  background: #1e1e2e;
  color: #cdd6f4;
  font-family: system-ui, -apple-system, sans-serif;
  box-sizing: border-box;
  border-radius: 12px;
  border: 2px solid #cba6f7;
  overflow: hidden;
  user-select: none;
  position: relative;
}
.mm-torn-header {
  display: flex;
  align-items: center;
  height: 36px;
  padding: 0 8px;
  background: #11111b;
  border-bottom: 2px solid #45475a;
  box-sizing: border-box;
  gap: 6px;
}
.mm-torn-title {
  flex: 1;
  font-size: 12px;
  font-weight: 700;
  color: #cba6f7;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.mm-torn-redock {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px; height: 26px;
  padding: 0;
  border: 1px solid #45475a;
  border-radius: 5px;
  background: #1e1e2e;
  color: #6c7086;
  cursor: pointer;
  outline: none;
  flex-shrink: 0;
}
.mm-torn-redock:hover, .mm-torn-redock.hover {
  background: #313244;
  color: #cba6f7;
  border-color: #cba6f7;
}
.mm-torn-content {
  background: #1e1e2e;
  color: #cdd6f4;
  overflow-y: scroll;
  overflow-x: hidden;
  padding: 8px 10px;
  padding-right: 24px;
  box-sizing: border-box;
  scrollbar-width: none;
}
.mm-torn-content::-webkit-scrollbar { display: none; }
`;

let _mmCssInjected = false;
export function injectMMCSS() {
  if (_mmCssInjected) return;
  _mmCssInjected = true;
  injectAnimCSS();
  const s = document.createElement('style');
  s.textContent = CSS;
  document.head.appendChild(s);
}
// Internal alias used by the class constructor.
function injectCSS() { injectMMCSS(); }

// ── Custom VR-safe select helpers ──────────────────────────────────────────────
// Replaces native <select> (which can't open inside a WebGL texture) with an
// inline accordion list that responds to the same click/pointer events.

export function buildSelectHTML(id, options, currentVal) {
  const cur = String(currentVal);
  const label = options.find(o => String(o.val) === cur)?.label ?? options[0]?.label ?? '';
  const opts = options.map(o =>
    `<button class="mm-select-opt${String(o.val) === cur ? ' active' : ''}" data-val="${o.val}">${o.label}</button>`
  ).join('');
  return `<div class="mm-select" id="${id}-wrap">
    <button class="mm-select-trigger" id="${id}">${label}</button>
    <div class="mm-select-opts" style="display:none">${opts}</div>
  </div>`;
}

export function wireSelect(el, id, callback, repaintFn) {
  const wrap    = el.querySelector(`#${id}-wrap`);
  if (!wrap) return;
  const trigger = wrap.querySelector(`#${id}`);
  const optsEl  = wrap.querySelector('.mm-select-opts');

  trigger?.addEventListener('click', () => {
    optsEl.style.display = optsEl.style.display === 'none' ? '' : 'none';
    repaintFn?.();
  });

  wrap.querySelectorAll('.mm-select-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      if (trigger) trigger.childNodes[0].textContent = btn.textContent;
      optsEl.style.display = 'none';
      wrap.querySelectorAll('.mm-select-opt').forEach(b => b.classList.toggle('active', b === btn));
      callback(btn.dataset.val);
      repaintFn?.();
    });
  });
}

// ── Shell HTML (static structure only; content area is filled dynamically) ──
function buildShellHTML() {
  return `
    <div id="mm-menubar">
      <!-- WHAT IS TORN OFF, TOP LEFT. A section that has been floated leaves a placeholder in
           its tab and a panel somewhere in the room, and nothing on screen says which. One chip
           per torn-off section, always in the same corner, and pressing one brings it back.
           Same idea and same position as the desktop strip. -->
      <button class="mm-menu-btn" data-menu="files">Files</button>
      <button class="mm-menu-btn" data-menu="history">History</button>
      <button class="mm-menu-btn mm-legacy-only" data-menu="background">Background</button>
      <button class="mm-menu-btn mm-legacy-only" data-menu="reference">Reference</button>
      <button class="mm-menu-btn mm-reorg-only" data-menu="view">View</button>
      <button class="mm-menu-btn" data-menu="settings">Settings</button>
      <button class="mm-menu-btn" data-menu="about">About</button>
      <div style="flex:1"></div>
      <!-- The swap back to the wrist panel USED TO LIVE HERE, and it does not fit: six menu
           buttons plus the pin already fill this row to the edge at ${MM_W}px, so a seventh
           pushed the pin off the panel on Vision Pro and half-covered it on Galaxy XR. It is a
           hands-only control and there is already a hands-only row with room in it, so it went
           to the bottom of the panel with Undo/Redo. -->
      <button class="mm-pin-btn" id="mm-pin-btn" title="Pin panel in world space">${ICON_PIN}</button>
    </div>
    <div id="mm-body">
      <div id="mm-tabstrip">
        ${['scene','topology','sculpting','properties'].map((s) =>
          // Active by NAME, not by index: the tab that opens is the default section, and
          // hardcoding its position means adding a tab silently opens a different one.
          `<button class="mm-tab-btn${s === DEFAULT_SECTION ? ' active' : ''}" data-section="${s}" title="${s[0].toUpperCase() + s.slice(1)}">${TAB_ICONS[s]}</button>`
        ).join('\n        ')}
        ${['rendering','camera'].map((s) =>
          // In the reorg these two live in the View menu instead. Kept in the markup so the
          // toggle is a repaint, and so the legacy layout is unchanged by any of this.
          `<button class="mm-tab-btn mm-legacy-only" data-section="${s}" title="${s[0].toUpperCase() + s.slice(1)}">${TAB_ICONS[s]}</button>`
        ).join('\n        ')}
        <button class="mm-tab-btn" data-section="animation" title="Animation">${TAB_ICONS.animation}</button>
        <!-- LAUNCHERS, NOT TABS. These two open other panels; they never switch this one.
             In the reorg a divider says so. -->
        <button class="mm-tab-btn mm-tl-btn mm-tab-launcher mm-tab-launcher-first" id="mm-bs-btn" title="Blendshapes">${TAB_ICONS.blendshapes}</button>
        <button class="mm-tab-btn mm-tl-btn mm-tab-launcher" id="mm-tl-btn" title="Timeline">${TAB_ICONS.timeline}</button>
      </div>
      <div id="mm-content"></div>
      <div id="mm-sbar-track" class="mm-scrollbar-track"><div id="mm-sbar-thumb" class="mm-scrollbar-thumb"></div></div>
    </div>
    <!-- Bottom of the panel, hands-only: no thumbstick means no other way to undo, and no X/A
         button means no other way to swap back to the wrist panel. Plain text, not glyphs: an
         icon that needs explaining is worse than a word, and these are only ever read through
         the VR rasteriser. -->
    <div id="mm-undo-row" class="mm-hands-only">
      <button id="mm-undo">Undo</button>
      <button id="mm-redo">Redo</button>
      <button id="mm-mini-btn" title="Back to the wrist panel">Mini</button>
    </div>
  `;
}

// ── Content builders ─────────────────────────────────────────────────────────

// OPEN REPLACES, IMPORT ADDS, SAVE ROUND-TRIPS, EXPORT IS ONE-WAY. The menu used to offer one
// file-in button called "Add mesh" and five format buttons called "Save", which says nothing
// about which of those keeps your rig and which throws it away. matt: "we need more
// straightforward and easy to understand options for file load vs file import, file save should
// be really clear as well, again its all a mess and hard to read at a glance." The four words
// carry the difference now, and the sections run in the order you use them.
//
// Import ADDS to the scene rather than replacing it, which is what that button has always done;
// it simply had no counterpart to be distinguished from. Export holds the four mesh formats
// because they lose the rig, the history and the frame groups: calling them "save" was the lie.
// Nomad Link goes last, being a bridge you set up once a session.
//
// New scene sits with Open, because starting a new one is a thing you do INSTEAD of opening --
// same moment, same part of the menu -- and it is a plain button until it is armed. Red on the
// resting state made a routine action look dangerous every time you passed it; red on the
// "Confirm clear (no undo)" state is the warning that is actually worth having. matt: "make it
// the regular button color, not red. the warning that appears one click to say 'are you sure?'
// can stay red, thats useful." 
//
// NO HTML COMMENTS IN HERE. The VR panel serialises this markup into an SVG, which is XML, and
// XML forbids "--" inside a comment -- so one prose dash blanked the whole panel with nothing
// but "SVG image failed to load". It renders fine on desktop, whose HTML parser is lenient,
// which is exactly what makes it worth a rule rather than care.
export function buildMenuHTML_files(main) {
  const guiFiles  = main.getGui?.()._ctrlFiles ?? null;
  // SAVE OVERWRITES, SAVE AS MAKES ANOTHER ONE -- the pair every other application has. The name
  // of the file you are in goes on the button, because "Save" with nothing else said is the one
  // command where you want to be certain what it is about to land on. Disabled until there is
  // something to save over; Save As is always there.
  const curSave = guiFiles?.currentSaveName?.() ?? '';
  const exportAll = guiFiles?._exportAll ?? true;
  const objZbrush = guiFiles?._objColorZbrush ?? false;
  const objAppend = guiFiles?._objColorAppended ?? false;

  return `
    ${/* THE HEADING IS THE VERB, THE BUTTON IS THE OBJECT.
          "Save" over three buttons that each begin with the word Save spends the row on
          something the heading already said -- matt: "the section title says SAVE, then the
          buttons say save, save as, save to scene, lots of repeated info."

          EXPORT ALREADY DOES THIS and is the model: heading Export, buttons glb / obj / ply /
          stl. Nobody has ever wondered what those do.

          It is not only tidiness. A long label cannot share a line with anything, so the
          repeated verb is also the reason these buttons each claim a full row -- trimming the
          labels is what lets the density rules pack them at all. The format list moves to the
          tooltip, where it is available and not in the way. */ ''}
    <div class="mm-section-title">Open</div>
    <button class="mm-action-btn" id="mm-open-scene" title="Open a scene from disk">Scene…</button>
    <button class="mm-action-btn" id="mm-browser-saves" title="Open a scene saved in this browser">Browser saves…</button>
    <button class="mm-action-btn${main._clearSceneConfirm ? ' danger' : ''}" id="mm-clear-scene"
      title="Start an empty scene">${main._clearSceneConfirm ? 'Confirm — no undo' : 'New…'}</button>

    <div class="mm-section-title">Save</div>
    ${/* The button names the FILE it would land on rather than saying Save again, which is the
          thing the original comment here was protecting: with Save you want to be certain what
          it is about to overwrite. Under a heading that already says Save, the filename alone
          says it better than "Save (filename)" did. */ ''}
    <button class="mm-action-btn" id="mm-browser-save-over"${curSave ? '' : ' disabled'}
      title="${curSave ? 'Save back over ' + curSave : 'Nothing open yet — use As…'}">${curSave || 'Nothing open yet'}</button>
    <button class="mm-action-btn" id="mm-browser-save-quick" title="Save as a new browser save">As…</button>
    <button class="mm-action-btn" id="mm-export-sxr" title="Save the scene to disk as a .sxr file">To disk (.sxr)</button>

    <div class="mm-section-title">Import</div>
    <button class="mm-action-btn" id="mm-import-obj"
      title="Import a mesh or audio file — obj, sgl, ply, stl, glb, mp3, wav">Mesh or audio…</button>
    <div class="mm-check-pair">
      <label class="mm-check-row"><span>Scale &amp; center on import</span><input type="checkbox" id="mm-import-scale"${main._autoMatrix ? ' checked' : ''}><span class="mm-checkmark"></span></label>
      <label class="mm-check-row"><span>sRGB color</span><input type="checkbox" id="mm-import-srgb"${main._vertexSRGB ? ' checked' : ''}><span class="mm-checkmark"></span></label>
    </div>


    <div class="mm-section-title">Export</div>
    <div class="mm-choice-grid cols-4">
      <button class="mm-choice" id="mm-export-glb">glb</button>
      <button class="mm-choice" id="mm-export-obj">obj</button>
      <button class="mm-choice" id="mm-export-ply">ply</button>
      <button class="mm-choice" id="mm-export-stl">stl</button>
    </div>
    <label class="mm-check-row"><span>Export all meshes</span><input type="checkbox" id="mm-export-all"${exportAll ? ' checked' : ''}><span class="mm-checkmark"></span></label>
    <button class="mm-toggle" id="mm-export-objseq"
      title="Export the frame-by-frame animation as a zipped per-frame OBJ sequence (anim.0000.obj …) — importable as a mesh sequence in any DCC.">Export OBJ sequence (.zip)</button>
    <div class="mm-check-pair">
      <label class="mm-check-row"><span>OBJ ZBrush</span><input type="checkbox" id="mm-obj-zbrush"${objZbrush ? ' checked' : ''}><span class="mm-checkmark"></span></label>
      <label class="mm-check-row"><span>OBJ append</span><input type="checkbox" id="mm-obj-append"${objAppend ? ' checked' : ''}><span class="mm-checkmark"></span></label>
    </div>

    <div class="mm-section-title">Export textures</div>
    <div class="mm-row">
      <span class="mm-lbl">Size (2^n)</span>
      <input type="range" id="mm-tex-size" min="8" max="13" step="1" value="10">
      <span class="mm-val" id="mm-tex-size-val">1024</span>
    </div>
    <div class="mm-choice-grid cols-3">
      <button class="mm-choice" id="mm-save-diffuse">Diffuse</button>
      <button class="mm-choice" id="mm-save-roughness">Roughness</button>
      <button class="mm-choice" id="mm-save-metalness">Metalness</button>
    </div>



    <div class="mm-section-title">Nomad Link</div>
    <div class="mm-row">
      <span class="mm-lbl">Address</span>
      <input type="text" id="mm-nomad-host" class="mm-text-input" placeholder="10.0.0.138" value="${main.getNomadLink?.()._host || getOptionsURL().nomadHost || ''}">
    </div>
    <div class="mm-choice-grid cols-2">
      <button class="mm-choice" id="mm-nomad-connect">Connect</button>
      <button class="mm-choice" id="mm-nomad-disconnect">Disconnect</button>
    </div>
    <div class="mm-choice-grid cols-2">
      <button class="mm-choice" id="mm-nomad-get-scene">Get scene</button>
      <button class="mm-choice" id="mm-nomad-get-selection">Get selection</button>
    </div>
    <button class="mm-action-btn" id="mm-nomad-send">Send selected to Nomad</button>
    <label class="mm-check-row"><span>Send edits live</span><input type="checkbox" id="mm-nomad-live"${main._nomadLiveSend ? ' checked' : ''}><span class="mm-checkmark"></span></label>
    <div id="mm-nomad-status" style="color:#a6adc8;font-size:11px;margin:3px 0">${main.getNomadLink?.().getMessage() || 'Disconnected'}</div>


    <button class="mm-action-btn danger" id="mm-exit-vr">Exit VR</button>
  `;
}

export function buildMenuHTML_history(main) {
  const sm  = main.getStateManager?.() ?? main._stateManager;
  const maxV = /OculusBrowser/.test(navigator.userAgent) ? 30 : 500;
  const cur  = sm?.limit ?? 50;
  const pct  = Math.max(0, Math.min(100, ((cur - 3) / (maxV - 3)) * 100));
  const uC   = sm?.undoCount?.() ?? 0;
  const rC   = sm?.redoCount?.() ?? 0;
  return `
    <div class="mm-section-title">History</div>
    <div class="mm-btn-pair">
      <button class="mm-action-btn" id="mm-undo"${uC ? '' : ' disabled'}>${faIcon('rotate-left')} Undo${uC ? ` (${uC})` : ''}</button>
      <button class="mm-action-btn" id="mm-redo"${rC ? '' : ' disabled'}>${faIcon('rotate-right')} Redo${rC ? ` (${rC})` : ''}</button>
    </div>
    <div class="mm-section-title">Settings</div>
    <div class="mm-row">
      <span class="mm-lbl">Max undo steps</span>
      <input type="range" id="mm-stack-size" min="3" max="${maxV}" step="1" value="${cur}">
      <span class="mm-val" id="mm-stack-val">${cur}</span>
    </div>
  `;
}

export function buildMenuHTML_reference() {
  return `
    <div class="mm-section-title">Reference Images</div>
    <button class="mm-action-btn" id="mm-ref-add">Add reference image…</button>
    <button class="mm-action-btn" id="mm-ref-clear">Clear all references</button>
    <button class="mm-toggle" id="mm-ref-show">Show references</button>
  `;
}

// THE DEVELOPER TOGGLES, DECLARED ONCE.
//
// There are two settings panels -- buildMenuHTML_settings for VR and
// buildMenuHTML_desktopSettings for the sidebar -- and they had independent copies of the same
// controls, with different ids for the same setting (`mm-phys-xpbd` against
// `mm-constraint-solver-xpbd`). So a toggle added to one simply does not exist in the other, and
// that is exactly what happened to the panel tracer: matt, "if i look in the DESKTOP settings
// panel, i see it. if i look in the VR settings panel, i don't see it." Standing rule, said
// often enough to be a law here: "i want desktop and vr to conform as much as possible, use the
// same code as much as possible, otherwise we end up in this situation over and over."
//
// So the LIST lives here and the two panels render it in their own idiom -- VR uses toggle
// buttons, the sidebar uses check rows -- through a renderer they each pass in. One id per
// setting, one place to add the next one, and neither panel can drift from the other again.
const DEV_TOGGLES = [
  // IN THE SHARED LIST so it appears in the VR Settings page AND the desktop one, which is the
  // whole reason this list exists. A reset that you can only reach on the platform that is
  // already behaving would be useless.
  { id: 'mm-ui-reset', label: 'Reset UI to Defaults', action: true,
    run: () => {
      resetUIDefaults();
      // ...AND THE MENU COLOUR GRADE. The Settings > Menu sliders tint the rasterised panel
      // texture, and a panel graded into illegibility is exactly the state you cannot read your
      // way out of -- which makes it the other half of "put the interface back". matt: "the
      // reset, it should reset the settings, 'menu' section for the interface color,
      // brightness, saturation, gamma."
      //
      // Written to the live settings object, saved, and applied, in that order: the object is
      // what the sliders read when the page rebuilds, the save is what survives a reload, and
      // setMenuColorGrade is what changes the pixels without waiting for either.
      try {
        const d = MENU_GRADE_DEFAULTS;
        getOptionsURL.saveOption('menuBrightness', d.brightness, 0);
        getOptionsURL.saveOption('menuSaturation', d.saturation, 0);
        getOptionsURL.saveOption('menuGamma', d.gamma, 0);
        setMenuColorGrade(d.brightness, d.saturation, d.gamma);
      } catch (_) {}
      // Rebuild everything that draws sections, on both hosts: the VR panels rebuild from their
      // own content key, and the desktop sidebar and menus rebuild when next opened.
      for (const p of (window._mmPanels || [])) {
        try { p._lastContentKey = ''; p._rebuildContent?.(); } catch (_) {}
      }
      try { window.app?.getGui?.()?._closeAllDropdowns?.(); } catch (_) {}
      try { window.screenLog?.('UI reset to defaults', 'lime'); } catch (_) {}
    } },
  { id: 'mm-phys-xpbd',   label: 'Constraint Solver (XPBD)',
    get: () => !!window._physXPBD,      set: (on) => PhysicsBones.setSolver(on) },
  { id: 'mm-panel-trace', label: 'Trace Panel Visibility',
    get: () => PanelTrace.enabled(),    set: (on) => PanelTrace.setEnabled(on) },
  // An ACTION rather than a state: press it the moment the menu goes and the last three seconds
  // of every panel's full state comes out of the console. The main menu is the one to press it
  // from -- pinned, it is not the panel that vanishes.
  { id: 'mm-panel-dump',  label: 'Dump Panel History',  action: true,
    run: () => PanelTrace.dump() },
  // A MODAL YOU CANNOT SEE STILL BLOCKS THE BUTTONS.
  //
  // The A-button pin ring is suppressed while a modal is up, and that test reads
  // `_vrKeyboard?.mesh?.visible`. matt's panelPerf trace listed VrKeyboard as MOUNTED for a
  // whole session -- and a panel is only mounted while its mesh is visible -- so the keyboard
  // was up the entire time and A did nothing. matt: "the marking menu isn't appearing when i
  // hover on a joint and press the A button."
  //
  // This is the escape hatch, not the fix: whatever leaves it open is still to be found. It
  // also reports what it closed, so it doubles as the answer to "was one actually stuck?".
  // WHAT IS ACTUALLY ON SCREEN IN THE RIG, named. Every rig visual has a display flag, so
  // "I turned them all off and something is still drawn" means either a flag with no button or
  // an object drawn outside the flag system -- and those need different fixes. Reading the code
  // could not separate them; this asks the scene graph. matt: "theres a little wireframe sphere
  // being drawn at the root/tip of each bone. if i turn off all the display modes/options for
  // joints, they're still there."
  { id: 'mm-rig-dump', label: 'Dump Rig Visuals', action: true,
    run: () => {
      const main = window.sculptgl;
      const g = main?._skelGroup;
      if (!g) { console.log('[rig] no skeleton group — nothing is drawn'); return; }
      const rows = [];
      g.traverse((o) => {
        if (o === g || !o.visible) return;
        // An instanced batch draws nothing at count 0, however visible the mesh says it is.
        const n = o.isInstancedMesh ? o.count : null;
        if (n === 0) return;
        let par = o.parent, hidden = false;
        while (par && par !== g) { if (!par.visible) hidden = true; par = par.parent; }
        if (hidden) return;
        rows.push([(o.name || o.type) + '  ', o.geometry?.type || '-', n === null ? '' : ' x' + n,
                   o.material?.wireframe ? ' WIREFRAME' : '', ' order ' + o.renderOrder].join(''));
      });
      const flags = Object.keys(Skeleton.DISPLAY_FLAGS)
        .filter((k) => Skeleton.displayFlag(k)).join(', ') || 'none';
      console.log('[rig] ' + rows.length + ' visible objects in the skeleton group, flags on: '
        + flags);
      for (const r of rows) console.log('[rig]   ' + r);
    } },
  { id: 'mm-close-modals', label: 'Close Stuck Modals', action: true,
    run: () => {
      const shut = [];
      for (const [name, m] of [['keyboard', window._vrKeyboard], ['numpad', window._vrNumpad],
                               ['confirm', window._vrConfirmPanel]]) {
        if (m?.mesh?.visible || m?.isBlockingOpen) { try { m.close?.(); shut.push(name); } catch (_) {} }
      }
      console.log('[modals] ' + (shut.length ? 'closed: ' + shut.join(', ') : 'none were open'));
    } },
  // Where a posing frame goes, printed once a second: lbs / mush / synth / refresh. Posing a
  // SUBDIVIDED bound mesh spends most of its frame above the bound level, and until this
  // existed the split between "the deformation" and "rebuilding the display level" was a guess.
  { id: 'mm-skin-trace',  label: 'Trace Skin Frame Cost',
    get: () => !!window._skinTrace,     set: (on) => { window._skinTrace = !!on; } },
  // The whole posed-symmetry round trip, once a second: every hop as a point in a named space,
  // so a disagreement between spaces reads as a number in the wrong range rather than as a
  // mirrored stroke that quietly goes missing.
  { id: 'mm-sym-trace',   label: 'Trace Posed Symmetry',
    get: () => !!window._symTrace,      set: (on) => { window._symTrace = !!on; } },
  { id: 'mm-no-fold',     label: 'Freeze Sculpt Fold (bisect)',
    get: () => !!window._skinNoFold,    set: (on) => { window._skinNoFold = !!on; } },
  // ON is the new behaviour: an ambient repaint costs the one panel that changed. OFF restores
  // the old whole-canvas paint, where every mounted panel is re-serialised for every repaint.
  // matt: "performance is still noticably slower with torn off panels and trying to animate a
  // rig" -- and tearing panels off is exactly what makes the two prices diverge, so the switch
  // is the A/B: pin two panels, pose a rig, flip it.
  // THE TWO OLDEST INSTRUMENTS WERE NEVER PUT HERE. xrPerf and ikPerf have existed for months as
  // console-only globals, which by matt's standing rule means they may as well not exist -- you
  // cannot open a console mid-session in a headset. matt: "i see 'trace panel cost' and 'scoped
  // panel repaint', i don't see xperf." Routed through the existing window.xrPerf()/ikPerf()
  // functions rather than poking the flags, because those also reset the accumulators; setting
  // the raw flag mid-run reports a window that started before the switch did.
  { id: 'mm-xr-perf', label: 'Trace Frame Time',
    get: () => !!window._xrPerf,
    set: (on) => { if (window.xrPerf) window.xrPerf(!!on); else window._xrPerf = !!on; } },
  { id: 'mm-ik-perf', label: 'Trace Rig Solve',
    get: () => !!window._ikPerf,
    set: (on) => { if (window.ikPerf) window.ikPerf(!!on); else window._ikPerf = !!on; } },
  // The frame profiler cannot see panel rasterisation: the polyfill's paint callback awaits the
  // image decode, so Scene's `panel-paint` bucket stops at the first await and the decode lands
  // in the frame gap instead of in our work. This measures the span and names the cause.
  // ANSWERS BACK, like xrPerf and ikPerf do. This line only prints when a paint happens, so
  // "no output" means either "panels cost nothing" or "the switch did not take" -- and those are
  // opposite conclusions. The ack makes silence mean the first one.
  // WAS ON FOR EVERYONE, ALWAYS. Five lines per trigger press, gated opt-OUT on a console
  // variable nobody in a headset can set. matt: "logs are still crazy noisy."
  // Three lines per touch, then silent, so a repro can be done without the console filling.
  { id: 'mm-tweak-trace', label: 'Trace Bone Tweak',
    get: () => !!window._tweakTrace,    set: (on) => { window._tweakTrace = !!on; } },
  { id: 'mm-grab-trace', label: 'Trace Trigger Press',
    get: () => !!window._grabTrace,     set: (on) => { window._grabTrace = !!on; } },
  { id: 'mm-panel-perf', label: 'Trace Panel Cost',
    get: () => !!window._panelPerf,
    set: (on) => {
      window._panelPerf = !!on;
      console.log('[panelPerf] ' + (on ? 'ON' : 'off') + ' — ' + VERSION
        + (on ? '. One line a second, but ONLY when a panel repaints: silence here means no panel'
              + ' work at all, which is itself the answer.' : ''));
    } },
];

// WHICH OF THESE IS A TRACE. Ten of the sixteen dev toggles are tracers, and they were all
// rendered into one block under "Physics Bones" -- a heading that describes two of them.
// matt: "anything with 'trace' in the name should be under a 'trace' section."
//
// Read off the LABEL rather than kept as a second field, so a tracer added later lands in the
// right section by being named like one, with nothing to remember.
const isTrace = (t) => /trace/i.test(t.label);
// The UI reset is not a diagnostic and does not belong under a physics heading; it gets its own
// section on both pages. Matched by id rather than by label so renaming the button cannot
// silently move it back in with the tracers.
const isUi = (t) => t.id === 'mm-ui-reset';

// `group` is 'ui', 'trace', 'other', or undefined for everything (still used by wireDevToggles'
// contract that every id is rendered somewhere).
export function buildDevToggles(render, renderAction, group) {
  const want = (t) => group == null
    || (group === 'ui' ? isUi(t)
      : group === 'trace' ? (isTrace(t) && !isUi(t))
      : (!isTrace(t) && !isUi(t)));
  return DEV_TOGGLES.filter(want).map((t) => (t.action
    ? (renderAction ? renderAction(t.id, t.label) : '')
    : render(t.id, t.label, t.get()))).join('\n    ');
}

// Both event shapes, because a button carries its state in a class and a checkbox carries it in
// `checked` -- the setting itself does not care which panel it is being flipped from.
export function wireDevToggles(q, paint) {
  for (const t of DEV_TOGGLES) {
    const el = q('#' + t.id);
    if (!el) continue;
    if (t.action) {
      el.addEventListener('click', () => { t.run(); });
    } else if (el.tagName === 'INPUT') {
      el.addEventListener('change', (e) => { t.set(!!e.target.checked); paint?.(); });
    } else {
      el.addEventListener('click', () => {
        const on = t.set(!t.get());
        el.classList.toggle('active', on === undefined ? t.get() : !!on);
        paint?.();
      });
    }
  }
}

// THE SCRUB-GRAIN CONTROLS, DECLARED ONCE — same reason as buildDevToggles above, and the same
// standing rule: "i want desktop and vr to conform as much as possible, use the same code as
// much as possible, otherwise we end up in this situation over and over."
//
// Dragging a playhead has no playback rate, only a position, so it is made audible by replaying
// a short window of the clip AT the playhead, over and over (AudioTrack._grain). These three
// numbers are that window, and the right values depend on the material — dialogue wants a longer
// grain than a drum loop — which is why they are a setting and not a constant.
//
// SPACING SHOULD STAY UNDER LENGTH. Consecutive grains then overlap, and that overlap is what
// makes a drag sound continuous instead of stuttered. The ranges deliberately allow the other
// way round, because a deliberately gappy scrub is a legitimate thing to want.
//
// Stored in seconds (what the Web Audio scheduler takes), shown in milliseconds (what anyone
// thinks in). Every key here is declared in getOptionsURL.js — without that it stops persisting
// and nothing says so.
const AUDIO_GRAINS = [
  { id: 'mm-audio-grain-len',  label: 'Grain length',  win: '_audioGrainSec',
    opt: 'audioGrainSec',     min: 20, max: 250, step: 5, dflt: 0.09 },
  { id: 'mm-audio-grain-gap',  label: 'Grain spacing', win: '_audioGrainSpacing',
    opt: 'audioGrainSpacing', min: 10, max: 200, step: 5, dflt: 0.05 },
  { id: 'mm-audio-grain-fade', label: 'Grain fade',    win: '_audioGrainFade',
    opt: 'audioGrainFade',    min: 0,  max: 20,  step: 1, dflt: 0.004 },
];

// Live window value, then the saved setting, then the default — the same ladder AudioTrack reads
// through, so the slider cannot show one number while the engine uses another.
const grainMs = (g, opts) => Math.round(
  (Number.isFinite(window[g.win]) ? window[g.win] : (opts[g.opt] ?? g.dflt)) * 1000);

export function buildAudioSectionHTML(renderToggle) {
  const opts = getOptionsURL();
  const on = window._audioScrub !== undefined ? !!window._audioScrub : (opts.audioScrub !== false);
  const rows = AUDIO_GRAINS.map((g) => {
    const ms = grainMs(g, opts);
    return `<div class="mm-row">
      <span class="mm-lbl">${g.label}</span>
      <input type="range" id="${g.id}" min="${g.min}" max="${g.max}" step="${g.step}" value="${ms}">
      <span class="mm-val" id="${g.id}-val">${ms}ms</span>
    </div>`;
  }).join('\n    ');
  return `<div class="mm-section-title">Audio Scrub</div>
    ${renderToggle('mm-audio-scrub', 'Scrub audio', on)}
    ${rows}`;
}

// `slide` is passed in because the two panels wire sliders differently: the VR panel needs a
// dirty hook so the rasteriser repaints the texture, the desktop sidebar is live DOM and needs
// nothing. Both toggle shapes are handled for the same reason as wireDevToggles — a button
// carries its state in a class, a checkbox in `checked`, and the setting does not care.
export function wireAudioSection(q, slide, paint) {
  const el = q('#mm-audio-scrub');
  if (el) {
    const apply = (on) => { window._audioScrub = !!on; getOptionsURL.saveOption('audioScrub', !!on); };
    if (el.tagName === 'INPUT') {
      el.addEventListener('change', (e) => { apply(e.target.checked); paint?.(); });
    } else {
      el.addEventListener('click', () => {
        // Read the current state the same way the markup does — `!== false`, so an unset
        // value reads as ON — or the first click on a never-touched toggle turns it off while
        // the button was drawn lit.
        apply(!(window._audioScrub !== false));
        el.classList.toggle('active', !!window._audioScrub);
        paint?.();
      });
    }
  }
  for (const g of AUDIO_GRAINS) {
    slide(q('#' + g.id), q('#' + g.id + '-val'), (ms) => {
      window[g.win] = ms / 1000;
      getOptionsURL.saveOption(g.opt, ms / 1000, 300);
    }, (v) => `${Math.round(v)}ms`);
  }
}

// THE WIREFRAME CONTROLS, DECLARED ONCE — same reason as buildDevToggles above.
//
// These lived only in the VR settings panel, so on desktop there was nowhere at all to set the
// wire's bias, opacity or type; asking for a colour is what surfaced it. Rather than write the
// colour twice and leave the other three behind, the whole block is one function that both panels
// render. matt's standing rule, quoted above: "i want desktop and vr to conform as much as
// possible, use the same code as much as possible, otherwise we end up in this situation over and
// over."
//
// One set of ids, which is safe because only one of the two panels is live at a time — the same
// contract buildDevToggles relies on.
// IS THE PICKER OPEN. Module-level rather than on the element because the panels rebuild their
// DOM on every repaint, so anything stored on the markup is gone by the time you look at it — and
// only one of the two panels is live at a time, which is the same contract the shared ids rely on.
// Is `a` anywhere above `b` in the parent chain? Used to reduce a selection to the roots it
// implies, so duplicating a shoulder and its elbow together copies one arm rather than nesting a
// second forearm inside the copy.
function isAncestorOf(a, b) {
  for (let n = b && b._parentMesh; n; n = n._parentMesh) if (n === a) return true;
  return false;
}

let _wfPickerOpen = false;
let _litPickerOpen = false;   // the selected light's colour wheel
// The paint wheel needs neither an open flag nor a revision: it is always there, so its markup
// never changes and there is nothing for the rebuild cache to miss. Both existed briefly, for the
// swatch-and-OK version this replaced.

// ...AND A REVISION THAT SAYS THIS SECTION'S MARKUP CHANGED.
//
// The VR panel does not rebuild its DOM on request: _rebuildContent caches on a key made of the
// menu name and a few scene counts, and returns early when the key is unchanged. Opening the
// picker changes neither, so in the headset the swatch was wired, clicked, and rebuilt nothing —
// matt: "clicking the swatch in vr doesn't show the colour wheel." The desktop menu rebuilds
// unconditionally, which is exactly why it worked there and hid the bug.
//
// A counter rather than the flags themselves, so anything added to this section later is covered
// by bumping it instead of by remembering to extend the key.
let _wfRev = 0;
export function wireframeSectionRev() { return _wfRev; }

function buildWireframeSectionHTML(main) {
  const opts   = getOptionsURL();
  const bias   = opts.wireframeBias    ?? 0.001;
  const alpha  = opts.wireframeAlpha   ?? 0.2;
  const surf   = opts.wireframeSurface ?? true;
  const colour = opts.wireframeColor   ?? '#000000';
  const curType = main.getMesh?.()?.getWireframeType?.() ?? 1;
  const typeBtns = [{ id: 1, label: 'Smooth' }, { id: 0, label: 'Fast' }, { id: 2, label: 'Full' }]
    .map(t => `<button class="mm-choice${curType === t.id ? ' active' : ''}" data-wf-type="${t.id}">${t.label}</button>`)
    .join('');
  return `
    <div class="mm-section-title">Wireframe</div>
    <div class="mm-row">
      <span class="mm-lbl">Bias</span>
      <input type="range" id="mm-wf-bias" min="0" max="50" step="1" value="${Math.round(bias * 10000)}">
      <span class="mm-val" id="mm-wf-bias-val">${bias.toFixed(4)}</span>
    </div>
    <div class="mm-row">
      <span class="mm-lbl">Opacity</span>
      <input type="range" id="mm-wf-alpha" min="0" max="100" step="5" value="${Math.round(alpha * 100)}">
      <span class="mm-val" id="mm-wf-alpha-val">${Math.round(alpha * 100)}%</span>
    </div>
    <!-- A SWATCH THAT OPENS THE PICKER, not a picker sitting open in a settings list. The wheel
         is 150px of hue ring in a column of one-line rows; it belongs behind the swatch, which is
         both the button and the readout of what is currently set. matt: "cute but dumb. it should
         be a colour swatch, when clicked it should show the colour wheel."
         The wheel itself is the paint tool's — see ColorWheel.js — because it is the only colour
         control in this app that survives being rasterised into a VR panel. -->
    <div class="mm-row">
      <span class="mm-lbl">Color</span>
      <button id="mm-wf-swatch" title="${colour}"
        style="width:44px;height:22px;padding:0;border-radius:4px;cursor:pointer;flex-shrink:0;background:${colour};border:1px solid #45475a"></button>
      <button class="mm-choice${surf ? ' active' : ''}" id="mm-wf-surface"
        style="flex:1;margin-left:6px">From surface: ${surf ? 'On' : 'Off'}</button>
    </div>
    ${_wfPickerOpen ? `
    <div class="mm-row" style="justify-content:center">
      ${buildColorWheelHTML({ prefix: 'mm-wf-cw', size: 150 })}
    </div>
    <button class="mm-action-btn" id="mm-wf-ok" style="margin-bottom:3px">OK</button>` : ''}
    <div class="mm-choice-grid cols-3">${typeBtns}</div>`;
}

// ...and its wiring, for the same reason. `paint` re-renders the panel that called it, so the
// swatch dimming and the toggle's active state follow whichever one is live.
function wireWireframeSection(el, main, paint, dirty) {
  const q    = (sel) => el.querySelector(sel);
  const opts = getOptionsURL;

  wireSlider(q('#mm-wf-bias'), q('#mm-wf-bias-val'), (v) => {
    const f = v / 10000;
    const wm = main.getMesh?.()?.getRenderData?.()._wireframeMesh;
    if (wm?.material?.uniforms) wm.material.uniforms.uBias.value = f;
    opts.saveOption('wireframeBias', f, 500);
  }, (v) => (v / 10000).toFixed(4), dirty);

  wireSlider(q('#mm-wf-alpha'), q('#mm-wf-alpha-val'), (v) => {
    const f = v / 100;
    const wm = main.getMesh?.()?.getRenderData?.()._wireframeMesh;
    if (wm?.material?.uniforms) wm.material.uniforms.uOpacity.value = f;
    opts.saveOption('wireframeAlpha', f, 500);
  }, (v) => `${v}%`, dirty);

  // EVERY MESH, not just the selected one — the colour is a global setting, and a wire that only
  // changed where you happened to be looking would read as a bug. updateWireframeBuffer is where
  // the colour is actually written; nothing else re-reads it.
  const repaintWires = () => {
    for (const m of (main.getMeshes?.() ?? [])) {
      try { m.updateWireframeBuffer?.(); } catch (_) {}
    }
    main.render?.();
  };

  q('#mm-wf-swatch')?.addEventListener('click', () => { _wfPickerOpen = true; _wfRev++; paint?.(); });
  q('#mm-wf-ok')?.addEventListener('click', () => {
    // CONFIRM AND CLOSE. There is no separate cancel: the wheel writes live so you are choosing
    // against the mesh itself rather than against a preview, and OK is the acknowledgement that
    // you are done with it.
    _wfPickerOpen = false;
    _wfRev++;
    el._wfWheel?.dispose?.();
    el._wfWheel = null;
    paint?.();
  });

  const cwRoot = q('#mm-wf-cw');
  if (cwRoot) {
    const hex2rgb = (h) => [parseInt(h.substr(1, 2), 16) / 255,
                            parseInt(h.substr(3, 2), 16) / 255,
                            parseInt(h.substr(5, 2), 16) / 255];
    const rgb2hex = (c) => '#' + [0, 1, 2].map((i) =>
      Math.max(0, Math.min(255, Math.round(c[i] * 255))).toString(16).padStart(2, '0')).join('');
    // The panel rebuilds its DOM on every repaint, so an old wheel's document-level pointermove
    // and pointerup listeners would otherwise accumulate one set per repaint.
    el._wfWheel?.dispose?.();
    const wheel = new ColorWheel(cwRoot, {
      prefix: 'mm-wf-cw', size: 150,
      get: () => hex2rgb(opts().wireframeColor || '#000000'),
      set: (rgb) => {
        const hex = rgb2hex(rgb);
        opts.saveOption('wireframeColor', hex, 300);
        // TOUCHING THE WHEEL TURNS THE SURFACE TINT OFF. Otherwise you drag a colour and nothing
        // happens on screen, which is indistinguishable from the control being broken.
        if ((opts().wireframeSurface ?? true) !== false) {
          opts.saveOption('wireframeSurface', false);
          const btn = q('#mm-wf-surface');
          if (btn) { btn.classList.remove('active'); btn.textContent = 'From surface: Off'; }
        }
        // THE CHEAP PATH, not repaintWires: a wheel drag fires on every pointermove, and
        // rebuilding an edge list per move is what makes a colour picker feel broken on a heavy
        // mesh. Only the material changes here — and the swatch is poked directly rather than
        // through a repaint, which would rebuild the DOM out from under the drag.
        Multimesh.setWireColor(main.getMeshes?.() ?? [], rgb);
        const sw = q('#mm-wf-swatch');
        if (sw) { sw.style.background = hex; sw.title = hex; }
      },
      render: () => main.render?.(),
    });
    el._wfWheel = wheel;
  }

  q('#mm-wf-surface')?.addEventListener('click', () => {
    const on = !(opts().wireframeSurface ?? true);
    opts.saveOption('wireframeSurface', on);
    _wfRev++;                       // the button's own label says On/Off — see wireframeSectionRev
    repaintWires();
    paint?.();
  });

  el.querySelectorAll('[data-wf-type]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const t = parseInt(btn.dataset.wfType, 10);
      main.getMesh()?.setWireframeType?.(t);
      opts.saveOption('wireframeType', t);
      main.render?.();
      el.querySelectorAll('[data-wf-type]').forEach(b => b.classList.toggle('active', b === btn));
      paint?.();
    });
  });
}


// ── SETTINGS SECTIONS THAT ARE NOT ABOUT THE PLATFORM, DECLARED ONCE ─────────
//
// There are two Settings pages -- buildMenuHTML_settings for VR, buildMenuHTML_desktopSettings
// for the sidebar -- and they had grown entirely different SECTION LISTS: fifteen headings in
// the headset against seven on the desktop. Three sections were already shared through builders
// (wireframe, audio, dev toggles) for exactly this reason, and the rest had drifted.
//
// These four are not about the platform at all. Tone mapping and exposure, mesh curvature, the
// ground grid and the blendshape backup are the same settings wherever you are sitting, and
// they were reachable only in a headset. matt: "they of COURSE should match to desktop."
//
// What stays VR-only is what genuinely is: the hand and controller spikes, pinch thresholds,
// head-height calibration, the controller model, and the Menu brightness/saturation/gamma,
// which is the LUT applied to the rasterised panel texture and means nothing on a monitor.
export function buildSharedSettingsHTML(main) {
  const curvature      = main.getMesh?.()?.getCurvature?.() ?? 0;
  const gridOpacity    = main.getGridOpacity?.() ?? 0.5;
  const gridOccOpacity = main.getGridOccludedOpacity?.() ?? 0.2;
  const exposure       = main.getExposure?.() ?? 1.0;
  const curTM          = main.getToneMapping?.() ?? 0;
  const tmBtns = [
    { id: 0, label: 'None' }, { id: 1, label: 'Linear' }, { id: 2, label: 'Reinhard' },
    { id: 3, label: 'Cineon' }, { id: 4, label: 'ACES' },
  ].map(t => `<button class="mm-choice${curTM === t.id ? ' active' : ''}" data-tonemap="${t.id}">${t.label}</button>`).join('');

  return `
    <div class="mm-section-title">Tone Mapping</div>
    <div class="mm-choice-grid cols-5">${tmBtns}</div>
    <div class="mm-row">
      <span class="mm-lbl">Exposure</span>
      <input type="range" id="mm-exposure" min="0" max="300" step="5" value="${Math.round(exposure*100)}">
      <span class="mm-val" id="mm-exposure-val">${exposure.toFixed(2)}</span>
    </div>

    <div class="mm-section-title">Mesh</div>
    <div class="mm-row">
      <span class="mm-lbl">Curvature</span>
      <input type="range" id="mm-curvature" min="0" max="100" step="1" value="${Math.round(curvature*20)}">
      <span class="mm-val" id="mm-curvature-val">${Math.round(curvature*20)}</span>
    </div>

    <div class="mm-section-title">Ground Plane</div>
    <div class="mm-row">
      <span class="mm-lbl">Grid Opacity</span>
      <input type="range" id="mm-grid-opacity" min="0" max="100" step="5" value="${Math.round(gridOpacity*100)}">
      <span class="mm-val" id="mm-grid-opacity-val">${gridOpacity.toFixed(2)}</span>
    </div>
    <div class="mm-row">
      <span class="mm-lbl">Grid Occluded Opacity</span>
      <input type="range" id="mm-grid-occ-opacity" min="0" max="100" step="5" value="${Math.round(gridOccOpacity*100)}">
      <span class="mm-val" id="mm-grid-occ-opacity-val">${gridOccOpacity.toFixed(2)}</span>
    </div>

    <div class="mm-section-title">Blendshapes</div>
    <div class="mm-btn-pair">
      <button class="mm-action-btn" id="mm-bs-backup">Backup Shapes</button>
      <button class="mm-action-btn" id="mm-bs-restore">Restore Shapes</button>
    </div>
  `;
}

// The matching wiring, so neither page can gain a control the other cannot operate.
export function wireSharedSettings(el, main, paint) {
  const q = (id) => el.querySelector(id);
  wireSlider(q('#mm-curvature'), q('#mm-curvature-val'), (v) => {
    const ms = main.getSelectedMeshes?.()?.length ? main.getSelectedMeshes() : [main.getMesh?.()];
    ms?.forEach((m) => m?.setCurvature?.(v / 20)); main.render?.();
  }, null, paint);
  wireSlider(q('#mm-grid-opacity'), q('#mm-grid-opacity-val'), (v) => {
    main.setGridOpacity?.(v / 100);
  }, (v) => (v / 100).toFixed(2), paint);
  // The part of the grid drawn BEHIND objects, on its own number rather than a fraction of the
  // one above -- see Scene.setGridOccludedOpacity.
  wireSlider(q('#mm-grid-occ-opacity'), q('#mm-grid-occ-opacity-val'), (v) => {
    main.setGridOccludedOpacity?.(v / 100);
  }, (v) => (v / 100).toFixed(2), paint);
  wireSlider(q('#mm-exposure'), q('#mm-exposure-val'), (v) => {
    main.setExposure?.(v / 100); main.render?.();
  }, (v) => (v / 100).toFixed(2), paint);
  el.querySelectorAll('[data-tonemap]').forEach((btn) => {
    btn.addEventListener('click', () => {
      main.setToneMapping?.(parseInt(btn.dataset.tonemap, 10));
      el.querySelectorAll('[data-tonemap]').forEach((b) => b.classList.toggle('active', b === btn));
      paint?.();
    });
  });
  q('#mm-bs-backup')?.addEventListener('click', () => {
    window.bsBackup?.();
    window.screenLog?.('Blendshapes backed up', 'lime');
  });
  q('#mm-bs-restore')?.addEventListener('click', () => {
    window.bsRestore?.();
    window.screenLog?.('Blendshapes restored from backup', 'cyan');
  });
}

function buildMenuHTML_settings(main) {
  const opts = getOptionsURL();

  const triggerCurve  = opts.triggerCurve    ?? 0.5;
  const stylusLength  = opts.stylusLength    ?? 0.10;
  const grabGain      = opts.grabGain        ?? 1.0;
  // Nav throw (#19): how much of your release speed the scene keeps gliding with.
  const navThrow      = (window._navThrow != null ? +window._navThrow : null) ?? opts.navThrow ?? 1.0;
  // FROM THE ONE ACCESSOR, because the default is per-runtime now: a literal here would show a
  // Quest's threshold on a Vision Pro and the slider would lie about what is in force.
  const pinchOn       = opts.pinchOn ?? (main.getPinchOn ? main.getPinchOn() : 0.022);
  const hStylusLen    = opts.handStylusLength ?? 0.05;
  const hStylusOff    = opts.handStylusOffset ?? 0.0;
  const hRayPitch     = Number.isFinite(window._handRayPitch) ? window._handRayPitch
                      : (opts.handRayPitch ?? 20);
  const stylusOffset  = opts.stylusOffset    ?? 0.0;
  const stylusTilt    = opts.stylusTilt      ?? 0;
  const gizmoSizeMul  = opts.gizmoSizeMul  ?? 1.0;
  const offsetY       = opts.offsetY         ?? -1.2;
  // Bias/Opacity/Colour/Type all live in buildWireframeSectionHTML now, shared with desktop.
  // MOVED OUT OF RENDERING: set once and left alone, which is what this menu is for. matt: "move
  // grid opacity, wf opacity, wf offset, tone mapping to the settings menu."
  //
  // The wireframe pair needed no move at all — Settings has had Bias and Opacity all along, and
  // Rendering carried a SECOND copy under different ids (mm-render-wf-*) writing the same two
  // settings. Two sliders for one value, either of which could be left disagreeing with the
  // other on screen. That copy is gone; this is the one that stays.
  const curvature     = main.getMesh?.()?.getCurvature?.() ?? 0;
  const gridOpacity   = main.getGridOpacity?.() ?? 0.5;
  const gridOccOpacity = main.getGridOccludedOpacity?.() ?? 0.2;
  const exposure      = main.getExposure?.() ?? 1.0;
  const curTM         = main.getToneMapping?.() ?? 0;
  const tmBtns        = [
    { id: 0, label: 'None' }, { id: 1, label: 'Linear' }, { id: 2, label: 'Reinhard' },
    { id: 3, label: 'Cineon' }, { id: 4, label: 'ACES' },
  ].map(t => `<button class="mm-choice${curTM === t.id ? ' active' : ''}" data-tonemap="${t.id}">${t.label}</button>`).join('');
  const menuBright    = opts.menuBrightness  ?? 0.65;
  const menuSat       = opts.menuSaturation  ?? 0.50;
  const menuGamma     = opts.menuGamma       ?? 0.0;
  const debugMode     = opts.debugMode       ?? false;
  const isLeft      = main._dominantHand === 'left';
  const isRaycast   = !main._vrUseVolumeIntersect;
  const isAmbi      = !!main._vrAmbidextrousCursors;

  // Controller options
  const ctrlModels = ['Auto','meta-quest-touch-plus','meta-quest-touch-plus-v2',
    'meta-quest-touch-pro','oculus-touch-v3','oculus-touch-v2',
    'valve-index','htc-vive','samsung-galaxyxr','samsung-odyssey'];
  const ctrlLabels = ['Auto','Quest+','Quest+ v2','Quest Pro','Touch v3','Touch v2',
    'Index','Vive','GalaxyXR','Odyssey'];
  const curCtrl = Math.max(0, ctrlModels.indexOf(window._xrControllerOverride ?? 'Auto'));

  return `
    <button class="mm-action-btn" id="mm-show-ctrl-guide">Show Controller Guide</button>
    <div class="mm-section-title">Input</div>
    <button class="mm-toggle${isLeft    ? ' active' : ''}" id="mm-left-hand">Left Hand Mode</button>
    <button class="mm-toggle${isRaycast ? ' active' : ''}" id="mm-raycast">Aim Picking (Raycast)</button>
    <button class="mm-toggle${isAmbi    ? ' active' : ''}" id="mm-ambi">Ambidextrous Cursors</button>

    <div class="mm-row">
      ${/* NOT "sensitivity", which reads as a pressure curve -- and there is no pressure here to
           be sensitive to. Analog pressure was built and deliberately disabled: a controller
           trigger has a short throw, so driving intensity from it makes you wiggle the start of
           every stroke. What is left is WHERE IN THE TRAVEL the press registers, which is what
           this sets. matt, looking at the panel: "what does trigger sensitivity do?" -- a fair
           question to have to ask about a control you have shipped. */ ''}
      <span class="mm-lbl" title="How far the trigger must be pulled before a stroke starts. Higher is a lighter pull. Controllers only: hands use Pinch distance.">Press point</span>
      <input type="range" id="mm-trigger" min="0" max="100" step="5" value="${Math.round(triggerCurve*100)}">
      <span class="mm-val" id="mm-trigger-val">${Math.round(triggerCurve*100)}%</span>
    </div>

    <div class="mm-row">
      <span class="mm-lbl">Grab speed</span>
      <input type="range" id="mm-grab-gain" min="25" max="200" step="5" value="${Math.round(grabGain*100)}">
      <span class="mm-val" id="mm-grab-gain-val">${Math.round(grabGain*100)}%</span>
    </div>

    <!-- Beside Grab speed, because it is the other half of the same gesture: one sets how far the
         world moves while you hold it, this sets how much of that it keeps once you let go.
         Off means the scene stops exactly where you left it. -->
    <div class="mm-row">
      <span class="mm-lbl">Throw</span>
      <input type="range" id="mm-nav-throw" min="0" max="100" step="5" value="${Math.round(navThrow*100)}"
        title="How much speed the scene keeps after you release a world grab. 0 stops it dead.">
      <span class="mm-val" id="mm-nav-throw-val">${navThrow > 0 ? Math.round(navThrow*100) + '%' : 'Off'}</span>
    </div>

    <!-- Hands only: a controller has a physical trigger and no pinch to calibrate. Shown in
         millimetres because that is what it is — the gap between finger and thumb SURFACES at
         which a click registers. Lower is tighter; negative needs them pressed together. -->
    <div class="mm-row mm-hands-only">
      <span class="mm-lbl">Pinch distance</span>
      <!-- To 50mm, because a Quest 2's pinch reads a ~11mm gap and its relaxed hand 45mm+: a
           slider that stopped at 15 could not reach a working threshold for that device. -->
      <input type="range" id="mm-pinch-on" min="-10" max="50" step="1" value="${Math.round(pinchOn*1000)}">
      <span class="mm-val" id="mm-pinch-on-val">${Math.round(pinchOn*1000)}mm</span>
    </div>

    <!-- ALWAYS VISIBLE, BOTH SETS. These were hidden unless the session was hands-only, which
         meant the controls silently changed identity depending on what you were holding — matt:
         "dont do the magical swap of parameters, i hate that behavior in all apps, especially one
         i'm helping to write." Two labelled groups, both always there, is one more row of screen
         and no ambiguity about which value you are editing. -->
    <div class="mm-section-title">Hand spike</div>
    <div class="mm-row">
      <span class="mm-lbl">Length</span>
      <input type="range" id="mm-hand-len" min="0" max="20" step="1" value="${Math.round(hStylusLen*100)}">
      <span class="mm-val" id="mm-hand-len-val">${Math.round(hStylusLen*100)}</span>
    </div>
    <div class="mm-row">
      <span class="mm-lbl">Offset</span>
      <input type="range" id="mm-hand-off" min="-10" max="10" step="1" value="${Math.round(hStylusOff*100)}">
      <span class="mm-val" id="mm-hand-off-val">${Math.round(hStylusOff*100)}</span>
    </div>
    <div class="mm-row">
      <span class="mm-lbl">Angle</span>
      <input type="range" id="mm-hand-pitch" min="-80" max="80" step="1" value="${Math.round(hRayPitch)}">
      <span class="mm-val" id="mm-hand-pitch-val">${Math.round(hRayPitch)}&deg;</span>
    </div>

    <div class="mm-section-title">Controller spike</div>
    <div class="mm-row">
      <span class="mm-lbl">Length</span>
      <input type="range" id="mm-stylus-len" min="0" max="30" step="1" value="${Math.round(stylusLength*100)}">
      <span class="mm-val" id="mm-stylus-len-val">${Math.round(stylusLength*100)}</span>
    </div>
    <div class="mm-row">
      <span class="mm-lbl">Z-Shift</span>
      <input type="range" id="mm-stylus-off" min="-15" max="15" step="1" value="${Math.round(stylusOffset*100)}">
      <span class="mm-val" id="mm-stylus-off-val">${Math.round(stylusOffset*100)}</span>
    </div>
    <div class="mm-row">
      <span class="mm-lbl">Tilt</span>
      <input type="range" id="mm-stylus-tilt" min="-45" max="45" step="1" value="${Math.round(stylusTilt)}">
      <span class="mm-val" id="mm-stylus-tilt-val">${Math.round(stylusTilt)}°</span>
    </div>
    <div class="mm-row">
      <span class="mm-lbl">Gizmo size</span>
      <input type="range" id="mm-gizmo-mul" min="25" max="200" step="5" value="${Math.round(gizmoSizeMul*100)}">
      <span class="mm-val" id="mm-gizmo-mul-val">${gizmoSizeMul.toFixed(2)}x</span>
    </div>

    <div class="mm-section-title">Calibration</div>
    <div class="mm-row">
      <span class="mm-lbl">Head height</span>
      <input type="range" id="mm-head-height" min="-200" max="0" step="10" value="${Math.round(offsetY*100)}">
      <span class="mm-val" id="mm-head-height-val">${offsetY.toFixed(1)}</span>
    </div>

    <div class="mm-section-title">Controller Model</div>
    ${buildSelectHTML('mm-ctrl-model', ctrlModels.map((m, i) => ({ val: i, label: ctrlLabels[i] })), curCtrl)}

    ${buildWireframeSectionHTML(main)}

    ${buildSharedSettingsHTML(main)}

    <div class="mm-section-title">Menu</div>
    <div class="mm-row">
      <span class="mm-lbl">Brightness</span>
      <input type="range" id="mm-menu-bright" min="0" max="100" step="5" value="${Math.round(menuBright*100)}">
      <span class="mm-val" id="mm-menu-bright-val">${Math.round(menuBright*100)}%</span>
    </div>
    <div class="mm-row">
      <span class="mm-lbl">Saturation</span>
      <input type="range" id="mm-menu-sat" min="0" max="100" step="5" value="${Math.round(menuSat*100)}">
      <span class="mm-val" id="mm-menu-sat-val">${Math.round(menuSat*100)}%</span>
    </div>
    <div class="mm-row">
      <span class="mm-lbl">Gamma</span>
      <input type="range" id="mm-menu-gamma" min="0" max="100" step="5" value="${Math.round(menuGamma*100)}">
      <span class="mm-val" id="mm-menu-gamma-val">${Math.round(menuGamma*100)}%</span>
    </div>

    ${buildAudioSectionHTML((id, label, on) =>
      `<button class="mm-toggle${on ? ' active' : ''}" id="${id}">${label}</button>`)}

    <div class="mm-section-title">UI</div>
    ${buildDevToggles((id, label, on) =>
      `<button class="mm-toggle${on ? ' active' : ''}" id="${id}">${label}</button>`,
      (id, label) => `<button class="mm-action-btn" id="${id}">${label}</button>`, 'ui')}

    <div class="mm-section-title">Physics &amp; Diagnostics</div>
    ${buildDevToggles((id, label, on) =>
      `<button class="mm-toggle${on ? ' active' : ''}" id="${id}">${label}</button>`,
      (id, label) => `<button class="mm-action-btn" id="${id}">${label}</button>`, 'other')}

    <div class="mm-section-title">Trace</div>
    ${buildDevToggles((id, label, on) =>
      `<button class="mm-toggle${on ? ' active' : ''}" id="${id}">${label}</button>`,
      (id, label) => `<button class="mm-action-btn" id="${id}">${label}</button>`, 'trace')}

    <div class="mm-section-title">Debug</div>
    <button class="mm-toggle${debugMode ? ' active' : ''}" id="mm-debug-mode">Debug Mode (HUD Logs)</button>
    <button class="mm-action-btn" id="mm-perf-profile">Log Perf Profile (120f)</button>
  `;
}

// THE VIEW PAGE (ui reorg mockup) -- Rendering, Camera, Background and Reference as one
// scrollable page.
//
// They are one category: how the scene is lit, drawn, framed and referenced, all set once and
// left. Two of them were TABS and two were MENUS, which is the split this reorg is trying to
// remove -- the tab strip should hold what you switch between while working, and none of these
// four is that.
//
// Concatenation, not a new layout. The four builders are untouched and their ids are disjoint,
// so the existing wire functions each find their own controls and miss the rest -- the same
// arrangement Rendering/Camera and Sculpting/Properties already use.
export function buildMenuHTML_view(main) {
  // GROUPED, NOT GLUED. The first version concatenated the four builders flat, which put ten
  // section headings into one scroll with no way to collapse any of them -- matt: "the view
  // menu still looks really poorly laid out", and he was right. Four groups, one open.
  //
  // Rendering opens because it is the one with the controls you actually reach for (shader,
  // opacity, the rig display flags); the other three are set once.
  return collapsibleHTML('view-rendering', 'Rendering', buildSectionHTML_rendering(main))
    + collapsibleHTML('view-camera', 'Camera', buildSectionHTML_camera(main), false)
    + collapsibleHTML('view-background', 'Background', buildMenuHTML_background(main), false)
    + collapsibleHTML('view-reference', 'Reference', buildMenuHTML_reference(), false);
}

export function buildMenuHTML_about() {
  const releaseHTML = (() => {
    try {
      const lines = releaseText.split('\n');
      let html = '';
      let releases = 0;
      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        if (line.startsWith('# ')) {
          if (releases >= 3) break;
          releases++;
          html += `<div style="color:#89b4fa;font-weight:600;font-size:12px;margin-top:6px">${line.slice(2)}</div>`;
        } else if (line.startsWith('- ')) {
          html += `<div style="color:#a6adc8;font-size:11px;margin:1px 0 1px 6px">• ${line.slice(2).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')}</div>`;
        }
      }
      return html;
    } catch { return ''; }
  })();

  return `
    <div class="mm-section-title">About SculptXR ${VERSION}</div>
    <div style="color:#a6adc8;font-size:11px;margin-bottom:4px">Original by Stéphane Ginier<br>VR port by Matt Estela &amp; Antigravity &amp; Claude</div>
    <div class="mm-btn-pair">
      <button class="mm-action-btn" id="mm-about-tokeru">tokeru.com/sculptxr</button>
      <button class="mm-action-btn" id="mm-about-github">GitHub</button>
    </div>
    <div class="mm-section-title">Recent Changes</div>
    <div id="mm-release-notes" style="max-height:200px;overflow-y:auto">${releaseHTML}</div>
  `;
}

export function wireMenuAbout(el) {
  el.querySelector('#mm-about-tokeru')?.addEventListener('click', () => window.open('https://tokeru.com/sculptxr', '_blank'));
  el.querySelector('#mm-about-github') ?.addEventListener('click', () => window.open('https://github.com/mestela/sculptxr', '_blank'));
}

// ── Section content builders ─────────────────────────────────────────────────

export function buildSectionHTML_scene(main) {
  const meshes   = main.getMeshes?.() ?? [];
  const selected = main.getSelectedMeshes?.() ?? [];

  // Assign stable label/id to every outliner-visible node, and gather them so the
  // tree renderer and the Rig dropdowns share one source of truth.
  const nodes = [];
  let count = 0;
  for (const m of meshes) {
    if (m._isVoxelChunk) continue;
    count++;
    if (!m._permanentStaticLabel) {
      m._permanentStaticLabel = m.uiName || m._uiName || `${m._typeName || 'Mesh'} ${count}`;
    }
    if (!m._permanentStaticId) {
      m._permanentStaticId = 'm_' + Math.random().toString(36).slice(2, 9);
    }
    nodes.push(m);
  }

  // Stable outliner order: sort by creation id (getID is monotonic). This keeps
  // rows from shuffling when selection state changes — only parenting nests them.
  nodes.sort((a, b) => a.getID() - b.getID());

  // Two-step rig assignment state (lives on main so it survives panel rebuilds):
  //   _rigPendingMode = 'parent' | 'lookat' | null,  _rigPendingSubject = mesh id
  const pendingMode = main._rigPendingMode || null;

  // Render the outliner as a tree: top-level nodes (no _parentMesh) first, each
  // followed by its children indented one level deeper.
  const childrenOf = (parent) => nodes.filter((m) => (m._parentMesh || null) === parent);
  const renderRow = (m, depth) => {
    const vis   = m.isVisible?.() ?? true;
    const hasVisKeys = !!window._animationRegistry?.hasVisibilityKeys?.(m);
    const hasKids = childrenOf(m).length > 0;
    const collapsed = !!m._outlinerCollapsed;
    const isSel = selected.includes(m);
    const isNull = !!m._isNull;
    const typeIcon = isNull ? 'fa-asterisk' : 'fa-cube';
    // WHICH JOINTS SIMULATE, said in the list as well as in the viewport. The panel used to
    // answer this by naming the joint in the Physics heading, which is built once and then goes
    // stale as the selection moves. matt: "it doesn't stay up to date, its just confusing. better
    // would be some visual indicator both in the outliner and in the 3dview."
    //
    // A trailing icon, exactly as a linked instance already marks itself, so the row's name and
    // its indent are untouched -- the outliner is a tree you read down the left edge, and a
    // marker that moved the text would cost more than it tells you. It marks the whole governed
    // chain rather than only the flagged root, which is what the rig actually does.
    const isPhys = Skeleton.physicsGoverned?.(m) && Skeleton.isJoint?.(m);
    // During a pending pick, rows read as targets (and the subject can't pick itself).
    const isSubject = pendingMode && m.getID() === main._rigPendingSubject;
    const pickCls = pendingMode ? (isSubject ? ' rig-subject' : ' rig-target') : '';
    // ONE BUTTON EACH, IN THE TOOLBAR — NOT ONE PER ROW.
    //
    // The eye and the pencil used to sit on every row: three buttons per mesh, and with a rig
    // the list is dozens of rows deep. They also predate multi-select, which is what actually
    // made them redundant — the toolbar acts on the selection, so hiding six meshes is a
    // select-then-click instead of six clicks, and the row is left as what it is, a name you
    // pick. matt: "now that we have multiselect, lets remove the per-item visibility and rename
    // buttons, and move them to the top toolbar."
    //
    // A hidden mesh still has to READ as hidden with no eye on the row, so the name dims.
    return `
      <div class="mm-outliner-row${pickCls}${vis ? '' : ' is-hidden'}${hasVisKeys ? ' vis-keyed' : ''}">
        ${hasKids
          ? `<button class="mm-collapse-btn" data-mesh-id="${m._permanentStaticId}" data-action="collapse" style="margin-left:${depth * 14}px" title="${collapsed ? 'Expand' : 'Collapse'}">${faIcon(collapsed ? 'chevron-right' : 'chevron-down')}</button>`
          : `<span class="mm-collapse-spacer" style="margin-left:${depth * 14}px"></span>`}
        <button class="mm-mesh-btn${isSel ? ' active' : ''}${isNull ? ' is-null' : ''}" data-mesh-id="${m._permanentStaticId}" data-action="select" title="Select — rename from the toolbar, or double-click">
          ${faIcon(typeIcon, { cls: 'mm-node-icon' })}<span class="mm-node-name">${m._permanentStaticLabel}</span>${main.isLinked?.(m) ? faIcon('link', { size: 10, style: 'margin-left:5px;color:#89dceb', title: 'Linked instance — shares geometry; edits affect all occurrences' }) : ''}${isPhys ? faIcon('wind', { size: 10, style: 'margin-left:5px;color:#a6e3a1', title: 'Physics bone — this joint swings, or hangs below one that does' }) : ''}
        </button>
      </div>`;
  };
  const renderTree = (parent, depth) => {
    let html = '';
    for (const m of childrenOf(parent)) {
      html += renderRow(m, depth);
      if (!m._outlinerCollapsed) html += renderTree(m, depth + 1);
    }
    return html;
  };
  let meshRows = renderTree(null, 0);
  if (!meshRows) meshRows = '<div class="mm-info">No meshes in scene</div>';

  // ── Rig section — shown when exactly one node is selected ──────────────────
  let rigHTML = '';
  if (selected.length === 1) {
    const sel    = selected[0];
    const selId  = sel.getID();
    const lookAtId = main.getLookAt?.(selId) ?? null;
    const parent   = main.getParentMesh?.(selId) ?? null;
    const lookTgt  = (lookAtId != null) ? nodes.find((m) => m.getID() === lookAtId) : null;
    const mirrored = !!main.isMirrored?.(selId);
    const saccading = !!main.isSaccading?.(selId);
    const sacAmp   = main.getSaccadeAmp?.(selId) ?? 5;
    const sacSpeed = main.getSaccadeSpeed?.(selId) ?? 1;
    const sacSmooth = +(main.getSaccadeSmooth?.(selId) ?? 0).toFixed(2);

    const trs = main.getTransformTRS?.(selId) || { t: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] };
    const _f = (n) => (Math.round(n * 1000) / 1000);
    // Per-row bake button (freezes that component into the geometry, right next to its values).
    const _bake = { t: ['mm-bake-t', 'Bake translation into geometry (position → 0)'],
                    r: ['mm-bake-r', 'Bake rotation into geometry (rotation → 0; may misalign symmetry)'],
                    s: ['mm-bake-s', 'Bake scale into geometry (scale → 1)'] };
    // CLEAR, BESIDE BAKE, AND THEY ARE NOT THE SAME THING. Bake folds the transform INTO the
    // geometry and leaves the object where it looks; Clear throws the transform away and the
    // object moves. Both end with the same numbers in the fields, which is exactly why they
    // belong next to each other and why the tooltips say which one keeps the shape put.
    const _clear = { t: ['mm-clear-t', 'Clear translation (position → 0; the object moves)'],
                     r: ['mm-clear-r', 'Clear rotation (rotation → 0; the object turns)'],
                     s: ['mm-clear-s', 'Clear scale (scale → 1; the object resizes)'] };
    const _xfRow = (type, label, vals, step) => `
      <div class="mm-xform-row">
        <span class="mm-xf-lbl">${label}</span>
        <input type="number" class="mm-xf" data-xf="${type}" data-axis="0" step="${step}" value="${_f(vals[0])}">
        <input type="number" class="mm-xf" data-xf="${type}" data-axis="1" step="${step}" value="${_f(vals[1])}">
        <input type="number" class="mm-xf" data-xf="${type}" data-axis="2" step="${step}" value="${_f(vals[2])}">
        <button class="mm-xf-bake" id="${_bake[type][0]}" title="${_bake[type][1]}">${faIcon('cake-candles')}</button>
        <button class="mm-xf-bake" id="${_clear[type][0]}" title="${_clear[type][1]}">C</button>
      </div>`;
    rigHTML = `
      ${_xfRow('t', 'Pos', trs.t, '0.01')}
      ${_xfRow('r', 'Rot', trs.r, '1')}
      ${_xfRow('s', 'Scale', trs.s, '0.01')}

      <div class="mm-rig-btn-row">
        <button class="mm-toggle${pendingMode === 'parent' ? ' active' : ''}" data-rig="set-parent">
          ${pendingMode === 'parent'
            ? (main._rigPendingSubject == null ? 'Click CHILD (list or 3D)…' : 'Click PARENT (list or 3D)…')
            : 'Set parent…'}
        </button>
        <button class="mm-toggle${pendingMode === 'lookat' ? ' active' : ''}" data-rig="set-aim">
          ${pendingMode === 'lookat'
            ? (main._rigPendingSubject == null ? 'Click EYE (list or 3D)…' : 'Click TARGET (list or 3D)…')
            : 'Aim at…'}
        </button>
        <!-- NOT the Mirror button in the toolbar above, and the name has to say so. This one is
             a live eye-rig constraint: a render-only twin that reflects POSITION and then aims
             itself at the source's look-at target, so the pair converges. It ignores rotation
             on purpose. The toolbar's Mirror makes real reflected COPIES, rotation and all. -->
        <button class="mm-toggle${mirrored ? ' active' : ''}" data-rig="mirror" title="Eye rig: live twin reflected across X that re-aims itself at the same target (rotation is NOT copied). For real mirrored copies use Mirror in the toolbar.">Mirror Eye</button>
        <!-- SACCADES JOINS THE ROW. It is a constraint like the other three — something the node
             does on its own once switched on — and it sat alone on a full-width line below them
             for no reason but the order it was written in. Its two sliders stay underneath and
             still appear only when it is on. matt: "so there'll be 4 constraint buttons in a row;
             set parent, aim at, mirror x, saccades." -->
        <button class="mm-toggle${saccading ? ' active' : ''}" data-rig="saccades">Saccades</button>
      </div>
      ${parent ? `<button class="mm-action-btn" data-rig="clear-parent">Clear parent</button>` : ''}
      ${lookTgt ? `<button class="mm-action-btn" data-rig="clear-aim">Clear aim</button>` : ''}
      <div class="mm-row" id="mm-rig-sac-amp-row" style="${saccading ? '' : 'display:none'}">
        <span class="mm-lbl">Amplitude</span>
        <input type="range" id="mm-rig-sac-amp" min="0" max="20" step="0.5" value="${sacAmp}">
        <span class="mm-val" id="mm-rig-sac-amp-val">${sacAmp}</span>
      </div>
      <div class="mm-row" id="mm-rig-sac-speed-row" style="${saccading ? '' : 'display:none'}">
        <span class="mm-lbl">Speed</span>
        <input type="range" id="mm-rig-sac-speed" min="0.1" max="3" step="0.1" value="${sacSpeed}">
        <span class="mm-val" id="mm-rig-sac-speed-val">${sacSpeed}</span>
      </div>
      <div class="mm-row" id="mm-rig-sac-smooth-row" style="${saccading ? '' : 'display:none'}">
        <span class="mm-lbl">Smooth</span>
        <input type="range" id="mm-rig-sac-smooth" min="0" max="1" step="0.05" value="${sacSmooth}">
        <span class="mm-val" id="mm-rig-sac-smooth-val">${sacSmooth}</span>
      </div>
    `;
  }

  const hasSel = selected.length > 0;
  // The eye shows what the CLICK will do to the selection: any visible → it hides them all.
  const selAnyVisible = selected.some((m) => m.isVisible?.() ?? true);
  const selVisKeyed   = selected.some((m) => !!window._animationRegistry?.hasVisibilityKeys?.(m));
  // Lock lives in the toolbar (padlock) and acts on the single selected mesh.
  const singleSel = selected.length === 1 ? selected[0] : null;
  const tbLocked  = singleSel ? !!main.isSelectLocked?.(singleSel.getID()) : false;

  // THE SELECTED LIGHT'S OWN PROPERTIES. They have existed on the entity since lights were
  // added and the shader reads all three every frame, but nothing has ever written them —
  // every light in every scene has been warm-white at intensity 1 since the feature shipped.
  // Only shown when exactly one light is selected: these are per-object, and a section that
  // appears empty is worse than one that is not there.
  const _lit = (singleSel && singleSel._isLight) ? singleSel : null;
  const _litHex = '#' + [0, 1, 2].map((i) =>
    Math.max(0, Math.min(255, Math.round(((_lit?._lightColor ?? [1, 1, 1])[i]) * 255)))
      .toString(16).padStart(2, '0')).join('');
  const lightHTML = !_lit ? '' : `
    <div class="mm-section-title">Light</div>
    ${/* TYPE FIRST, because it decides which of the rows below mean anything. Falloff is
         distance attenuation, which a directional light does not have; Cone belongs to a spot
         alone. Hidden rather than dimmed: a row that cannot do anything is noise, and the
         section is short enough that nothing jumps far. */ ''}
    <div class="mm-row">
      <span class="mm-lbl">Type</span>
      <div class="mm-choice-grid cols-3" style="flex:1">
        <button class="mm-choice${(_lit._lightType || 0) === 0 ? ' active' : ''}" data-light-type="0">Point</button>
        <button class="mm-choice${(_lit._lightType || 0) === 1 ? ' active' : ''}" data-light-type="1">Spot</button>
        <button class="mm-choice${(_lit._lightType || 0) === 2 ? ' active' : ''}" data-light-type="2">Sun</button>
      </div>
      <span class="mm-val"></span>
    </div>
    <div class="mm-row">
      <span class="mm-lbl">Intensity</span>
      <input type="range" id="mm-light-int" min="0" max="1000" step="1" value="${lightIntToSlider(_lit._lightIntensity ?? 1)}">
      <span class="mm-val" id="mm-light-int-val">${(_lit._lightIntensity ?? 1).toFixed(3)}</span>
    </div>
    ${/* FALLOFF, not "range": it is the distance at which the light is half as bright, not a
         hard cutoff -- the attenuation in ShaderPBR never reaches zero. Sized from the scene
         diagonal when the light was made, so the useful span is relative to that. */ ''}
    ${(_lit._lightType || 0) !== 2 ? `
    <div class="mm-row">
      <span class="mm-lbl">Falloff</span>
      <input type="range" id="mm-light-range" min="1" max="${Math.max(50, Math.round((_lit._lightRange ?? 50) * 4))}" step="1" value="${Math.round(_lit._lightRange ?? 50)}">
      <span class="mm-val" id="mm-light-range-val">${Math.round(_lit._lightRange ?? 50)}</span>
    </div>` : ''}
    ${(_lit._lightType || 0) === 1 ? `
    <div class="mm-row">
      <span class="mm-lbl">Cone</span>
      <input type="range" id="mm-light-cone" min="5" max="89" step="1" value="${Math.round(_lit._lightConeDeg ?? 35)}">
      <span class="mm-val" id="mm-light-cone-val">${Math.round(_lit._lightConeDeg ?? 35)}&deg;</span>
    </div>` : ''}
    ${/* SHADOWS, per light, because every one of these depends on the scene's scale and on
         the look being aimed for -- there is no value that is right for a 34-unit sculpt and
         a 3-unit one at the same time.

         Bias is normalBias, and it RUNS NEGATIVE: -1 to 1. Positive pushes the lookup out
         along the surface normal, which clears acne; negative pulls it in, which closes a
         contact gap at the risk of acne elsewhere. matt: "sh bias at 0 still has a light
         leak. it might need to support negative values too". Zero is not a floor here,
         it is the middle of the useful range.

         Softness is shadow.radius, and it is a UNIFORM blur -- see the note in
         _syncThreeLights about why it does not harden at the contact point. Worth knowing
         while chasing a leak: a wide radius blurs the penumbra across the contact point too,
         so a gap that persists at bias 0 may be softness rather than bias. */ ''}
    <div class="mm-row">
      <span class="mm-lbl">Shadow</span>
      <button class="mm-choice${(_lit._castShadow !== false) ? ' active' : ''}" id="mm-light-shadow">${(_lit._castShadow !== false) ? 'On' : 'Off'}</button>
      <span class="mm-val"></span>
    </div>
    ${(_lit._castShadow !== false) ? `
    <div class="mm-row">
      <span class="mm-lbl">Sh. opacity</span>
      <input type="range" id="mm-light-shopacity" min="0" max="100" step="1" value="${Math.round((_lit._shadowIntensity ?? 1) * 100)}">
      <span class="mm-val" id="mm-light-shopacity-val">${Math.round((_lit._shadowIntensity ?? 1) * 100)}%</span>
    </div>
    <div class="mm-row">
      <span class="mm-lbl">Sh. softness</span>
      <input type="range" id="mm-light-shsoft" min="0" max="100" step="1" value="${Math.round(_lit._shadowRadius ?? 4)}">
      <span class="mm-val" id="mm-light-shsoft-val">${Math.round(_lit._shadowRadius ?? 4)}</span>
    </div>
    <div class="mm-row">
      <span class="mm-lbl">Sh. bias</span>
      <input type="range" id="mm-light-shbias" min="-100" max="100" step="1" value="${Math.round((_lit._shadowNormalBias ?? 0.15) * 100)}">
      <span class="mm-val" id="mm-light-shbias-val">${(_lit._shadowNormalBias ?? 0.15).toFixed(2)}</span>
    </div>` : ''}
    ${/* THE COLOUR WHEEL, not an <input type=color> and not preset swatches: it is the only
         colour control in this app that survives being rasterised into a VR panel, and the
         Scene section renders there too. Swatch opens it, OK closes it. */ ''}
    <div class="mm-row">
      <span class="mm-lbl">Colour</span>
      <button id="mm-light-swatch" title="Light colour"
        style="width:44px;height:22px;padding:0;border-radius:4px;cursor:pointer;flex-shrink:0;background:${_litHex};border:1px solid #45475a"></button>
      <span class="mm-val"></span>
    </div>
    ${_litPickerOpen ? `
    <div class="mm-row" style="justify-content:center">
      ${buildColorWheelHTML({ prefix: 'mm-light-cw', size: 150 })}
    </div>
    <button class="mm-action-btn" id="mm-light-cw-ok" style="margin-bottom:3px">OK</button>` : ''}
`;

  return `
    ${/* HEADINGS EXIST SO THE SECTION CAN FOLD. This used to carry a note saying the outliner
         needed no heading because it was obviously one — true, but it also meant
         groupSectionTitles had nothing to grab and the whole tab was a single slab. matt:
         "make the scene tab sections foldable, so be able to fold the outliner, the transform
         properties, the constraints, the primitives." _decorateDesktopSection already runs
         groupSectionTitles over every sidebar section, so a heading is all that is needed. */ ''}
    <div class="mm-section-title">Outliner</div>
    <div class="mm-toolbar">
      <button class="mm-tool-btn" id="mm-duplicate" title="Duplicate selected (independent copy)"${hasSel ? '' : ' disabled'}>${faIcon('copy')}</button>
      <button class="mm-tool-btn" id="mm-instance" title="Instance selected (linked — shares geometry, edits affect all)"${hasSel ? '' : ' disabled'}>${faIcon('link')}</button>
      <button class="mm-tool-btn" id="mm-mirror-sel" title="Mirror selected across X — new copies, position AND rotation reflected"${hasSel ? '' : ' disabled'}>${faIcon('right-left')}</button>
      <button class="mm-tool-btn" id="mm-make-unique" title="Make unique (break the link — private copy)"${(singleSel && main.isLinked?.(singleSel)) ? '' : ' disabled'}>${faIcon('link-slash')}</button>
      <button class="mm-tool-btn${selVisKeyed ? ' keyed' : ''}" id="mm-vis-toggle" title="${selVisKeyed ? 'Visibility is keyframe-driven (timeline controls it)' : (selAnyVisible ? 'Hide selected' : 'Show selected')}"${hasSel ? '' : ' disabled'}>${faIcon(selAnyVisible ? 'eye' : 'eye-slash')}</button>
      <button class="mm-tool-btn" id="mm-rename-sel" title="Rename selected"${singleSel ? '' : ' disabled'}>${faIcon('pen')}</button>
      <button class="mm-tool-btn" id="mm-delete-mesh" title="Delete selected"${hasSel ? '' : ' disabled'}>${faIcon('trash')}</button>
      <button class="mm-tool-btn${tbLocked ? ' active' : ''}" data-rig="lock" title="Lock — unselectable in the viewport when on"${singleSel ? '' : ' disabled'}>${faIcon(tbLocked ? 'lock' : 'lock-open')}</button>
    </div>
    <div class="mm-outliner-wrap">
      <div class="mm-outliner-list">${meshRows}</div>
      <div class="mm-scrollbar-track mm-outliner-sbar"><div class="mm-scrollbar-thumb"></div></div>
      ${/* A REAL HANDLE, because CSS `resize` is not available everywhere this panel docks.
           iOS Safari does not implement it at all -- so on the iPad the list simply could not be
           dragged, while the same build resized fine on desktop. matt: "on ipad and desktop, the
           outliner should be resizable when docked in the side bar."
           A full-width bar rather than the native corner gripper, which is a ~7px target you
           have to hit exactly and is the wrong shape for a finger. Hidden in the VR panel by the
           same scoping the old rule used -- see the stylesheet. */ ''}
      <div class="mm-outliner-grip" title="Drag to resize the list"></div>
    </div>
    ${rigHTML ? `<div class="mm-section-title">Transform</div>${rigHTML}` : ''}
    ${lightHTML}
    <div class="mm-section-title">Primitives</div>
    <div class="mm-add-row">
      <button class="mm-action-btn" id="mm-add-cube">Cube</button>
      <button class="mm-action-btn" id="mm-add-sphere">Sphere</button>
      <button class="mm-action-btn" id="mm-add-cylinder" title="All-quad cylinder — Reverse walks it back down to a clean low-poly base">Cyl</button>
      <button class="mm-action-btn" id="mm-add-null">Null</button>
      <button class="mm-action-btn" id="mm-add-light" title="A point light you place like any other object — move it, parent it to a bone, keyframe it">Light</button>
      <button class="mm-action-btn" id="mm-add-voxel" title="Spawn an empty voxel object and switch to the Voxel tool">Voxel</button>
      <button class="mm-action-btn" id="mm-add-human" title="MakeHuman's CC0 base mesh — 13k quads of authored topology, to sculpt on or to conform to">Human</button>
    </div>
  `;
}

export function buildSectionHTML_topology(main) {
  const mesh   = main.getMesh?.();
  const isMulti = !!(mesh?._meshes);
  const isDyn   = !!(mesh?.isDynamic);
  const numLvl  = isMulti ? mesh._meshes.length : 0;
  const curLvl  = isMulti ? mesh._sel : 0;

  const res = Remesh.RESOLUTION;

  const topo = main.getGui?.()?._ctrlTopology ?? null;
  const topoTarget = topo?._targetFaces ?? 1000;
  const topoSteer  = topo?._steeringWeight ?? 1.0;

  let multiInfo = isMulti
    ? `<div class="mm-info">Level ${curLvl} of ${numLvl - 1} — ${mesh.getNbVertices?.()?.toLocaleString() ?? '?'} vertices</div>`
    : '';

  return `
    ${/* THE THREE PAIRS HERE STAY PAIRS. The sweep for two-line sections flagged this one as
         six buttons across three rows, but each row is a matched opposition -- Level down
         against Level up, Subdivide against Reverse, Del Lower against Del Higher -- and the
         pairing IS the information. Repacking them three-across would put Reverse next to Del
         Lower and say they belong together. Compressed layout is not worth a false grouping. */ ''}
    <div class="mm-section-title">Multiresolution</div>
    ${multiInfo}
    <div class="mm-btn-pair">
      <button class="mm-action-btn" id="mm-level-down" ${isMulti && curLvl > 0 ? '' : 'disabled'}>Level −</button>
      <button class="mm-action-btn" id="mm-level-up"   ${isMulti && curLvl < numLvl - 1 ? '' : 'disabled'}>Level +</button>
    </div>
    <div class="mm-btn-pair">
      <button class="mm-action-btn" id="mm-subdivide" ${mesh ? '' : 'disabled'}>Subdivide</button>
      <button class="mm-action-btn" id="mm-reverse"   ${isMulti && curLvl === 0 ? '' : 'disabled'}>Reverse</button>
    </div>
    <div class="mm-btn-pair">
      <button class="mm-action-btn danger" id="mm-del-lower"  ${isMulti && curLvl > 0 ? '' : 'disabled'}>Del Lower</button>
      <button class="mm-action-btn danger" id="mm-del-higher" ${isMulti && curLvl < numLvl - 1 ? '' : 'disabled'}>Del Higher</button>
    </div>

    <div class="mm-section-title">Remesh (SurfaceNets)</div>
    <div class="mm-row">
      <span class="mm-lbl">Resolution</span>
      <input type="range" id="mm-remesh-res" min="8" max="400" step="1" value="${res}">
      <span class="mm-val" id="mm-remesh-res-val">${res}</span>
    </div>
    <button class="mm-toggle${Remesh.BLOCK ? ' active' : ''}" id="mm-remesh-block">Block mode</button>
    <button class="mm-action-btn" id="mm-remesh" ${mesh ? '' : 'disabled'}>Remesh</button>

    <div class="mm-section-title">Remesh (Marching Cubes)</div>
    <button class="mm-toggle${Remesh.SMOOTHING ? ' active' : ''}" id="mm-remesh-smooth">Smoothing</button>
    <button class="mm-action-btn" id="mm-remesh-mc" ${mesh ? '' : 'disabled'}>Remesh MC</button>

    <div class="mm-section-title">Dynamic Topology</div>
    <button class="mm-toggle${isDyn ? ' active' : ''}" id="mm-dynamic">Dynamic Topology</button>

    <div class="mm-section-title">Voxel</div>
    <button class="mm-action-btn" id="mm-mesh-to-voxels" ${mesh ? '' : 'disabled'}>Mesh → Voxels</button>

    <div class="mm-section-title">Quad Remesh</div>
    <div class="mm-row">
      <span class="mm-lbl">Target Faces</span>
      <input type="range" id="mm-quad-target" min="100" max="10000" step="100" value="${topoTarget}">
      <span class="mm-val" id="mm-quad-target-val">${topoTarget}</span>
    </div>
    <div class="mm-row">
      <span class="mm-lbl">Group Steering</span>
      <input type="range" id="mm-quad-steer" min="0" max="1" step="0.05" value="${topoSteer}">
      <span class="mm-val" id="mm-quad-steer-val">${topoSteer}</span>
    </div>
    <div class="mm-row">
      ${/* NOT THE SYMMETRY TOGGLE. That one is a sculpting mode -- every stroke mirrored across
           X -- and lives under its own Symmetry heading. This is an argument to ONE operation:
           quad-remesh half the mesh, then mirror and weld it, so the seam comes out clean.
           Sharing the word made it read as a stray duplicate of a control that was already on.
           adurna35: "The symmetry button has a duplicate further down in the panel next to
           axis/plane i think?" -- it is not a duplicate, it just never said what it was. */ ''}
      <span class="mm-lbl" title="Remesh one half across X=0, then mirror and weld it, for a clean symmetric seam. Not the sculpting Symmetry toggle.">Mirror Halves</span>
      <input type="checkbox" id="mm-quad-symmetry">
    </div>
    <button class="mm-action-btn" id="mm-quadremesh" ${mesh ? '' : 'disabled'}>Quadremesh</button>

    <div class="mm-section-title">Mesh Health</div>
    <button class="mm-action-btn" id="mm-validate">Validate Manifold</button>
    <button class="mm-toggle" id="mm-auto-heal">Auto heal on remesh</button>
  `;
}

// SCENE DISPLAY FIRST. The ground plane is the toggle reached most often in this menu and it sat
// below the shader, both environment grids, every mesh-display slider and the wireframe controls:
// a long scroll in a headset to flip one switch. matt: "the groundplane option is too far low on
// the menu and hard to reach." It also sits OUTSIDE the mesh-disabled fieldset, or it greys out
// with controls it has nothing to do with.
//
// No HTML comments in the template itself -- see buildMenuHTML_files.
export function buildSectionHTML_rendering(main) {
  const mesh = main.getMesh?.();
  const meshDisabled = main.getMeshes?.().some(m => !m._isBone && !m._isNull && !m._isReference) ? '' : ' disabled';

  const ShaderPBR    = Shader[Enums.Shader.PBR];
  const ShaderMATCAP = Shader[Enums.Shader.MATCAP];
  const shaderType   = getOptionsURL().shader;

  const shaders = [
    { id: Enums.Shader.MATCAP, label: 'Matcap' },
    { id: Enums.Shader.PBR,    label: 'PBR'    },
    { id: Enums.Shader.FLAT,   label: 'Flat'   },
    { id: Enums.Shader.NORMAL, label: 'Normal' },
    { id: Enums.Shader.UV,     label: 'UV'     },
  ];
  const shaderBtns = shaders.map(s =>
    `<button class="mm-choice${shaderType === s.id ? ' active' : ''}" data-shader="${s.id}">${s.label}</button>`
  ).join('');

  const toneMaps = [
    { id: 0, label: 'None' }, { id: 1, label: 'Linear' }, { id: 2, label: 'Reinhard' },
    { id: 3, label: 'Cineon' }, { id: 4, label: 'ACES' },
  ];
  const curTM = main.getToneMapping?.() ?? 0;
  const tmBtns = toneMaps.map(t =>
    `<button class="mm-choice${curTM === t.id ? ' active' : ''}" data-tonemap="${t.id}">${t.label}</button>`
  ).join('');

  const exposure    = main.getExposure?.() ?? 1.0;
  const gridOpacity = main.getGridOpacity?.() ?? 0.5;
  const shadowOpac  = main.getShadowOpacity?.() ?? 0.35;
  const shadowSoft  = main.getShadowSoftness?.() ?? 2.5;
  const shadowLive  = main.isShadowActive?.() ?? false;
  const isCatcher   = main.getShadowCatcher?.() ?? false;
  const curvature   = mesh?.getCurvature?.() ?? 0;
  const opacity     = mesh?.getOpacity?.() ?? 1;
  const isFlat      = getOptionsURL().flatshading;
  const isWire      = getOptionsURL().wireframe;
  const isSolid     = mesh?._renderData?._threeMesh?.material?.visible ?? true;

  const opts     = getOptionsURL;
  const wfBias   = opts().wireframeBias  ?? 0.001;
  const wfAlpha  = opts().wireframeAlpha ?? 0.2;

  // ENVIRONMENTS AND MATCAPS ARE DROPDOWNS, NOT A BUTTON EACH.
  //
  // Fourteen named buttons across two titled grids, and the names do most of nothing: nobody
  // recognises a matcap by its name, so the grid was fourteen things to read past rather than to
  // choose from. As selects they are two lines, and the list is still one press away.
  //
  // `buildSelectHTML` is the same control the camera section uses for Projection and the
  // spectator modes — a trigger button and a hidden list of buttons, no <select> element — which
  // is what makes it work in the headset, where a native dropdown has no way to open. matt: "you
  // seemed to work out how to do dropown menus that work on both vr and desktop earlier."
  // ONLY THE ENVIRONMENTS THIS RENDERER CAN ACTUALLY LOAD.
  //
  // The two paths read different assets and neither can read the other's: the legacy
  // renderer samples the LogLUV octahedral atlas (`path`) and has no HDR decoder, while the
  // node renderer takes an equirect `hdr` through RGBELoader and PMREM and cannot decode the
  // atlas. Listing all of them would offer four choices that do nothing, silently, depending
  // on which renderer you happen to be running.
  //
  // Filtered AFTER the map so `val` stays the real index into ShaderPBR.environments --
  // everything downstream, including the saved option, is that index.
  const _isNode = !!(main && main._isNodeRenderer);
  const envOpts = (ShaderPBR?.environments ?? [])
    .map((env, i) => ({ val: i, label: env.name, _ok: _isNode ? !!env.hdr : !!env.path }))
    .filter((o) => o._ok);
  // IMPORT IS AN OPTION, NOT A BUTTON BESIDE THE LIST. Choosing a matcap and adding one are the
  // same decision — "which matcap" — so they belong in the same control; a button next to the
  // dropdown was a second thing to look at for a case that comes up once in a while. matt: "make
  // 'import matcap' an option within the matcap combobox rather than a button."
  //
  // A STRING VALUE, so it cannot collide with an index however many matcaps are loaded, and so
  // the callback can tell them apart without a magic number.
  const matcapOpts = (ShaderMATCAP?.matcaps ?? []).map((m, i) => ({ val: i, label: m.name }))
    .concat([{ val: 'import', label: 'Import matcap…' }]);
  const curMatcap = mesh?.getMatcap?.() ?? 0;

  // Shader-class remains useful for styling, but every group is always laid out. Inapplicable
  // groups are inert and muted instead of removed, so controls never jump under the hand.
  const shaderClass = shaderType === Enums.Shader.PBR    ? 'shader-pbr'
                    : shaderType === Enums.Shader.MATCAP  ? 'shader-matcap'
                    : shaderType === Enums.Shader.UV       ? 'shader-uv'
                    : '';

  // Camera
  const camera  = main.getCamera?.() ?? main._camera;
  const proj    = camera?.getProjectionType?.() ?? 0;
  const fov     = camera?.getFov?.() ?? 45;
  const mode    = camera?.getMode?.() ?? 0;
  const pivot   = camera?.getUsePivot?.() ?? false;
  const vmode   = main._spectatorViewMode ?? 0;
  const skipMap = { 0: 0, 1: 1, 3: 2, 7: 3 };
  const fps     = skipMap[main._spectatorFrameSkip ?? 3] ?? 2;
  const speed   = main._cameraSpeed ?? 0.3;

  // RIG DISPLAY GOES LAST, NOT FIRST. It used to open the section, so a panel about how the model
  // is drawn began with fourteen toggles about bones.
  //
  // It does not LEAVE, though, and that is worth recording because I nearly removed it on the
  // grounds that the bone panel has the same block. It does not: buildBoneDisplayHTML is exported
  // there and used only here, so deleting it from this section strands the rig display flags, the
  // capsule slider, Attach and Hide All with no home in the app at all. bonepanel_test says so
  // outright ("Rendering owns the rig display block"), which is what the check is for.
  const rigDisplay = buildBoneDisplayHTML(main, 'mm');
  return `
    <div id="mm-render-root" class="${shaderClass}">
      <!-- NO 'Scene Display' HEADING. It sat above one button, so it was a heading that announced
           a group of one — which is the thing that made this panel read as bitsy. -->
      <button class="mm-toggle${main._showGrid ? ' active' : ''}" id="mm-grid-toggle">Ground Plane</button>

      <fieldset class="mm-disabled-group"${meshDisabled}>
      <div class="mm-section-title">Shader</div>
      <div class="mm-choice-grid cols-5">${shaderBtns}</div>

      <!-- ONE ROW, AND ONLY THE ONE THAT APPLIES. Environment belongs to PBR and Matcap to
           Matcap, so they are never both meaningful — and each was carrying its own heading over
           a single dropdown. A label beside the control says the same word in a fraction of the
           space, and the row is the same height whichever appears, so nothing below it moves.
           This replaces the earlier rule that inapplicable groups stay laid out but inert: that
           was about controls not jumping under the hand, and a row that is always one row high
           keeps the promise while showing only what is live. -->
      ${shaderType === Enums.Shader.PBR ? `<div class="mm-row">
        <span class="mm-lbl">Environment</span>
        ${buildSelectHTML('mm-env-select', envOpts, ShaderPBR?.idEnv ?? 0)}
        <!-- Reserves the value column a slider row has, so the control ends where a slider does. -->
        <span class="mm-val"></span>
      </div>
      ${/* HOW MUCH THE ENVIRONMENT CONTRIBUTES, separately from exposure. Exposure multiplies
           the IBL and the lamps together so the ratio never moves; this scales only the IBL,
           and at 0 the scene is lit by its own lights alone -- which is the only way to see
           what a point light is actually doing. */ ''}
      <div class="mm-row">
        <span class="mm-lbl">Env Intensity</span>
        <input type="range" id="mm-env-intensity" min="0" max="200" step="1" value="${Math.round((getOptionsURL().envIntensity ?? 1) * 100)}">
        <span class="mm-val" id="mm-env-intensity-val">${Math.round((getOptionsURL().envIntensity ?? 1) * 100)}%</span>
      </div>` : ''}
      ${shaderType === Enums.Shader.MATCAP ? `<div class="mm-row">
        <span class="mm-lbl">Matcap</span>
        ${buildSelectHTML('mm-matcap-select', matcapOpts, curMatcap)}
        <span class="mm-val"></span>
      </div>` : ''}

      <div class="mm-if-uv"${shaderType === Enums.Shader.UV ? '' : ' inert aria-disabled="true"'}>
        <button class="mm-action-btn" id="mm-import-uv">Import UV texture…</button>
      </div>

      <!-- No 'Mesh Display' heading either: what follows is plainly about the mesh, and the
           heading only separated it from the shader controls above, which the Shader heading
           already does. -->
      <div class="mm-row">
        <span class="mm-lbl">Mesh Opacity</span>
        <input type="range" id="mm-opacity" min="0" max="100" step="1" value="${Math.round(opacity*100)}">
        <span class="mm-val" id="mm-opacity-val">${Math.round(opacity*100)}%</span>
      </div>
      <!-- ONE ROW, THREE WORDS. Three full-width toggles stacked down the panel for three
           settings that are read together and switched against each other; the second word of
           each label ("Shading", "Shading") carried no information and cost three lines. Ids are
           unchanged, so the wiring is untouched. -->
      <div class="mm-choice-grid cols-3">
        <button class="mm-choice${isFlat  ? ' active' : ''}" id="mm-flat-shading">Flat</button>
        <button class="mm-choice${isWire  ? ' active' : ''}" id="mm-wireframe">Wire</button>
        <button class="mm-choice${isSolid ? ' active' : ''}" id="mm-solid">Solid</button>
      </div>
      <!-- SHADOW CATCHER IS THE WHOLE SWITCH. There is no enable toggle and no built-in floor:
           block out the real table, flag it, and it vanishes except for what the sculpt throws on
           it — and the Shadow Light appears in the scene as an object you move. Want the shadow
           gone? Hide the proxy, delete it, or take the material off. The two sliders are the only
           things left that are about how the shadow LOOKS rather than whether it exists, so they
           go inert until something is actually catching one. -->
      <button class="mm-toggle${isCatcher ? ' active' : ''}" id="mm-shadow-catcher">Shadow Catcher</button>
      <div id="mm-shadow-group"${shadowLive ? '' : ' inert aria-disabled="true"'}>
        <div class="mm-row">
          <span class="mm-lbl">Shadow Opacity</span>
          <input type="range" id="mm-shadow-opacity" min="0" max="100" step="1" value="${Math.round(shadowOpac*100)}">
          <span class="mm-val" id="mm-shadow-opacity-val">${Math.round(shadowOpac*100)}%</span>
        </div>
        <!-- Tenths, and up to 24: a PCF radius is useful well below 1 texel, and a real room's
             area light needs a far wider kernel than a spot's own penumbra gives. -->
        <div class="mm-row">
          <span class="mm-lbl">Softness</span>
          <input type="range" id="mm-shadow-soft" min="0" max="240" step="1" value="${Math.round(shadowSoft*10)}">
          <span class="mm-val" id="mm-shadow-soft-val">${shadowSoft.toFixed(1)}</span>
        </div>
      </div>
      </fieldset>

      ${rigDisplay}
    </div>
  `;
}

// ── CAMERA, MOVED OUT OF RENDERING ────────────────────────────────────────────────────────────
//
// Five of the rendering section's twelve headings were camera and capture — reset, projection,
// mode, the desktop canvas and the spectator frame rate — and none of them is about how the model
// is drawn. They were there because there was nowhere else to put them, and they were most of
// what made that panel unreadable. matt: "its still rediculously messy and bitsy and impossible
// to read at a glance."
//
// The controls move INTACT, ids and all, which is what keeps this a move rather than a rewrite:
// wireSectionRendering already wires them by id and querySelector answers null for the ones that
// are not on the page, so one wiring function still serves both sections — the same arrangement
// Sculpting and Properties use.
export function buildSectionHTML_camera(main) {
  const camera  = main.getCamera?.() ?? main._camera;
  const proj    = camera?.getProjectionType?.() ?? 0;
  const fov     = camera?.getFov?.() ?? 45;
  const mode    = camera?.getMode?.() ?? 0;
  const pivot   = camera?.getUsePivot?.() ?? false;
  const vmode   = main._spectatorViewMode ?? 0;
  const skipMap = { 0: 0, 1: 1, 3: 2, 7: 3 };
  const fps     = skipMap[main._spectatorFrameSkip ?? 3] ?? 2;
  const speed   = main._cameraSpeed ?? 0.3;
  return `
    <div id="mm-camera-root">
      ${/* NO SUB-HEADINGS HERE. Every .mm-section-title becomes its own collapsible, so this page
           was five chevrons you had to open one at a time to reach five controls -- and the
           Projection one was a heading over a single dropdown. matt: "no subsections, just put
           all those options in all those subsections under 'camera'."
           The names stay as field labels where the control needs one; the view buttons lose
           theirs entirely, because Center/Front/Left/Top say what they are. */ ''}
      ${/* FOUR ONE-WORD BUTTONS, ONE ROW. They were two mm-btn-pairs, which is a hardcoded
           two-column grid, so four labels of five letters each took two lines of a 410px
           panel. They are also a single set -- four views of the same thing -- so splitting
           them across rows implied a grouping that is not there. */ ''}
      <div class="mm-choice-grid cols-4">
        <button class="mm-action-btn" id="mm-cam-center">Center</button>
        <button class="mm-action-btn" id="mm-cam-front">Front</button>
        <button class="mm-action-btn" id="mm-cam-left">Left</button>
        <button class="mm-action-btn" id="mm-cam-top">Top</button>
      </div>

      <div class="mm-field-lbl">Projection</div>
      ${buildSelectHTML('mm-cam-proj', [
        { val: 0, label: 'Perspective' },
        { val: 1, label: 'Orthographic' },
      ], proj)}
      ${/* FOV STAYS PUT, DIMMED. It used to be display:none under orthographic, so switching
           projection moved everything below it and the slider vanished rather than explaining
           itself -- matt: "the ortho/persp is confusing. just leave the fov slider visible at
           all times, dim it when we're in ortho mode." Dimmed and inert says "this control
           belongs to the other projection"; absent says nothing and shuffles the page. */ ''}
      <div class="mm-row mm-fov-row${proj!==0?' mm-inert':''}" id="mm-fov-row">
        <span class="mm-lbl">FOV</span>
        <input type="range" id="mm-cam-fov" min="10" max="90" step="1" value="${fov}">
        <span class="mm-val" id="mm-cam-fov-val">${Math.round(fov)}°</span>
      </div>

      <div class="mm-field-lbl">Camera Mode</div>
      ${buildSelectHTML('mm-cam-mode', [
        { val: 0, label: 'Orbit' },
        { val: 1, label: 'Spherical' },
        { val: 2, label: 'Plane' },
      ], mode)}
      <button class="mm-toggle${pivot?' active':''}" id="mm-cam-pivot">Pivot</button>
      <div class="mm-row">
        <span class="mm-lbl">Speed</span>
        <input type="range" id="mm-cam-speed" min="0.05" max="1" step="0.001" value="${speed}">
        <span class="mm-val" id="mm-cam-speed-val">${speed.toFixed(2)}</span>
      </div>

      <div class="mm-field-lbl">Desktop Canvas (VR)</div>
      ${buildSelectHTML('mm-spectator-mode', [
        { val: 0, label: 'Blank (VR active)' },
        { val: 1, label: 'Mirror (headset)' },
        { val: 2, label: 'Desktop free camera' },
        { val: 3, label: 'Spectator (coupled)' },
      ], vmode)}

      <div class="mm-field-lbl">Spectator FPS</div>
      ${buildSelectHTML('mm-spectator-fps', [
        { val: 0, label: 'Full rate' },
        { val: 1, label: '½ rate' },
        { val: 2, label: '¼ rate (default)' },
        { val: 3, label: '⅛ rate' },
      ], fps)}
    </div>
  `;
}


// Tool definitions. This was mirrored from BrushPanel, which is gone (2026-08-28) — this
// is now the single source of truth for the Sculpting tab's grid.
// Helper: encode a 0-1 rgb vec3 component as two hex digits.
const _toHex2 = v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');

// The Alpha picker's last row is a verb rather than an alpha. Spelled so it cannot collide with
// a real alpha name, which are file-derived.
const ALPHA_IMPORT = '__import__';

// TOOLS AND PROPERTIES ARE TWO PAGES, not one long scroll.
//
// The tool grids are a wall of buttons and they sit ABOVE everything that describes the tool
// you just picked -- so every radius change, every toggle, every symmetry button was a scroll
// past the whole wall. They are also used at completely different rates: you pick a tool
// occasionally and adjust it constantly. matt: "the huge amount of buttons at the top for all
// the tools for both sculpting and lowpoly gets in the way of all the tool related buttons and
// state at the bottom."
//
// One builder, because both pages are computed from the same tool state and splitting the
// computation would be two things to keep in step. `part` picks which half comes back.
function buildSculptingHTML(main, part) {
  const sm  = main.getSculptManager?.() ?? main._sculptManager;
  const cur = sm?.getToolIndex?.() ?? -1;
  const tool = sm?.getCurrentTool?.();
  const symOn  = sm?._symmetry ?? false;
  // A voxel object's surface is a view of the worker's distance field, so nothing that edits
  // vertices sticks. Covers MeshProxy for the same reason SculptManager.meshToVoxel does.
  const _symMesh = main.getMesh?.();
  const symDead = !!(_symMesh && (_symMesh._isVoxel || _symMesh.constructor?.name === 'MeshProxy'));
  const contOn = sm?._continuous ?? false;

  // Mesh/sculpt tools don't apply to a voxel object — dim the inactive ones when the Voxel
  // tool is active so the live set (the Voxel-mode grid below) is obvious.
  const dimForVoxel = (cur === Enums.Tools.VOXEL) ? ' mm-dim' : '';
  const sculptBtns = SCULPT_TOOLS.map(t =>
    `<button class="mm-choice${cur === t.id ? ' active' : dimForVoxel}" data-tool-id="${t.id}" style="color:${toolTextTint(t.id)}">${t.label}</button>`
  ).join('');
  const meshBtns = MESH_TOOLS.map(t =>
    `<button class="mm-choice${cur === t.id ? ' active' : dimForVoxel}" data-tool-id="${t.id}" style="color:${toolTextTint(t.id)}">${t.label}</button>`
  ).join('');

  if (part === 'tools') {
    // 19 sculpt tools + 11 mesh tools is ten rows of a three-column grid, which is most of the
    // panel's body before anything else renders. Collapsing one of them is the whole fix: they
    // are close to two different applications and you are rarely picking from both.
    if (uiReorg()) {
      return collapsibleHTML('tools-sculpt', 'Sculpt',
               `<div class="mm-choice-grid cols-3">${sculptBtns}</div>`)
           + collapsibleHTML('tools-mesh', 'Mesh Edit',
               `<div class="mm-choice-grid cols-3">${meshBtns}</div>`, false);
    }
    return `
    <div class="mm-section-title">Sculpt</div>
    <div class="mm-choice-grid cols-3">${sculptBtns}</div>
    <div class="mm-section-title">Mesh Edit</div>
    <div class="mm-choice-grid cols-3">${meshBtns}</div>
  `;
  }

  // ── Brush settings (radius + intensity) ─────────────────────────
  let brushHTML = '';
  if (tool && tool._radius !== undefined) {
    const radius    = Math.round(tool._radius ?? 50);
    const intensity = Math.round((tool._intensity ?? 0.5) * 100);
    brushHTML += `
      <div class="mm-section-title">Brush</div>
      <div class="mm-row">
        <span class="mm-lbl">Radius</span>
        <input type="range" id="mm-brush-radius" min="5" max="250" step="1" value="${radius}">
        <span class="mm-val" id="mm-brush-radius-val">${radius}</span>
      </div>
      <div class="mm-row">
        <span class="mm-lbl">Intensity</span>
        <input type="range" id="mm-brush-intensity" min="0" max="100" step="1" value="${intensity}">
        <span class="mm-val" id="mm-brush-intensity-val">${intensity}%</span>
      </div>${tool._hardness !== undefined ? `
      <div class="mm-row">
        <span class="mm-lbl">Hardness</span>
        <input type="range" id="mm-brush-hardness" min="0" max="100" step="1" value="${Math.round(tool._hardness * 100)}">
        <span class="mm-val" id="mm-brush-hardness-val">${Math.round(tool._hardness * 100)}%</span>
      </div>` : ''}`;

    // ── Tool-specific toggles ────────────────────────────────────────
    const isMasking        = cur === Enums.Tools.MASKING;
    const isPaintGroup     = cur === Enums.Tools.PAINT_GROUP;
    const isMove           = cur === Enums.Tools.MOVE;
    const isGrab           = cur === Enums.Tools.GRAB;
    const isSmooth         = cur === Enums.Tools.SMOOTH;
    const isVoxel          = cur === Enums.Tools.VOXEL;
    const isExtrudeOrInset = cur === Enums.Tools.EXTRUDE || cur === Enums.Tools.INSET;
    const hasNegative   = tool._negative   !== undefined;
    const hasClay       = tool._clay       !== undefined;
    const hasAccumulate = tool._accumulate !== undefined;
    // HIDDEN ON SMOOTH AND RELAX. Neither earns its place there, and matt, having read what they
    // do: "i don't think either do anything particularly useful, hide them both for now."
    //
    // Tangential on Smooth means "become Relax" -- Relax is literally `class Relax extends Smooth`
    // with `_tangent = true` -- so it was a second route to a tool that has its own button.
    // Culling's VR path is unfinished: getFrontVertices bails out and returns every vertex when
    // eyeDir is zero, and the patch that gives it a usable eyeDir lives only in makeStroke's
    // STATIC-mesh branch, so on a dyntopo mesh it is likely doing nothing at all.
    //
    // The fields and the code stay; only these two buttons go. Culling remains on the nine other
    // tools that define it, where the desktop path works and nobody has reported otherwise.
    const isRelaxLike   = isSmooth || cur === Enums.Tools.RELAX;
    const hasCulling    = tool._culling    !== undefined && !isRelaxLike;
    const hasTopoCheck  = tool._topoCheck  !== undefined;
    const hasTangent    = tool._tangent    !== undefined && !isRelaxLike;
    // Smooth only, and it scopes itself: no other tool defines the field. See Smooth.js for what
    // the two answers actually do -- on, detail comes off and form stays; off, the form goes too,
    // and thin geometry with it.
    // `&& !tool._tangent`: the HC correction lives in smooth(), and smoothTangent() never calls
    // it -- so on Relax (permanently tangential) the button would light up and change nothing.
    // A control that does nothing is worse than an absent one.
    const hasPreserve   = tool._preserveVolume !== undefined && !tool._tangent;

    // Voxel uses its own mode grid (Add/Sub/Inflate/Deflate) instead of the generic
    // negative/clay/etc. toggles, so suppress those here.
    if (!isVoxel && (hasNegative || hasClay || hasAccumulate || hasCulling || hasTopoCheck || hasTangent || hasPreserve)) {
      const toggles = [];
      if (hasNegative) {
        // Masking: flip label/active so button means "Erase existing mask"
        // Move: label as "Along Normal"
        const negLabel  = (isMasking || isPaintGroup) ? 'Erase' : isMove ? 'Along Normal' : 'Negative';
        const negActive = isMasking ? !tool._negative : tool._negative;
        toggles.push(`<button class="mm-choice${negActive ? ' active' : ''}" id="mm-brush-negative">${negLabel}</button>`);
      }
      if (hasClay)       toggles.push(`<button class="mm-choice${tool._clay       ? ' active' : ''}" id="mm-brush-clay"    >Clay      </button>`);
      if (hasAccumulate) toggles.push(`<button class="mm-choice${tool._accumulate ? ' active' : ''}" id="mm-brush-accum"   >Accumulate</button>`);
      if (hasCulling)    toggles.push(`<button class="mm-choice${tool._culling    ? ' active' : ''}" id="mm-brush-culling" >Culling   </button>`);
      if (hasTopoCheck)  toggles.push(`<button class="mm-choice${tool._topoCheck  ? ' active' : ''}" id="mm-brush-topo"    >Topo Check</button>`);
      if (hasTangent)    toggles.push(`<button class="mm-choice${tool._tangent    ? ' active' : ''}" id="mm-brush-tangent" >Tangential</button>`);
      if (hasPreserve)   toggles.push(`<button class="mm-choice${tool._preserveVolume ? ' active' : ''}" id="mm-brush-preserve"`
        + ` title="On: smooths detail off and keeps the form (thin shapes survive). Off: smooths the form away too.">Keep Volume</button>`);
      const cols = toggles.length <= 2 ? 'cols-2' : 'cols-3';
      brushHTML += `<div class="mm-choice-grid ${cols}" style="margin-top:4px">${toggles.join('')}</div>`;
    }

    // ── Motion path: which channel of the keys an edit writes ────────
    //
    // Move and Smooth are the two tools that can sculpt a motion path, so they are the two that
    // get the choice. A 6DOF grab always produces both a translation and a rotation — your hand
    // cannot move without turning a little — so without these a nudge sideways also nods every
    // gnomon it passes. matt: "i can see cases where i'll want to affect just positions, or just
    // rotations, or both."
    //
    // The same global setting the wrist panel writes, deliberately: "which channel am I
    // editing" is a fact about the edit and not about the brush, and two panels disagreeing
    // about it would be worse than either answer.
    //
    // A COLLAPSED SECTION, NOT A DIM LABEL. These were here already -- under an `mm-lbl`, which is
    // the style used for a slider's caption, with the buttons reading "Move" and "Rotate" as if
    // they were tool names. matt read the panel and concluded they were not there at all, and
    // said of the wrist panel's copy: "it took me a moment to realise this was related to motion
    // paths." A heading you can see beats two words that could mean anything.
    //
    // Closed by default: it matters only while a path is on screen, which is a minority of the
    // time this panel is open. wireGroups already services every collapsible in this element.
    if (isMove || isSmooth) {
      const ch = MotionPathEdit.channels();
      brushHTML += collapsibleHTML('motion-paths', 'Motion Paths', `
        <div class="mm-choice-grid cols-3">
          <button class="mm-choice${ch.translate ? ' active' : ''}" id="mm-path-translate">Move</button>
          <button class="mm-choice${ch.rotate ? ' active' : ''}" id="mm-path-rotate">Rotate</button>
          ${/* Connectivity has been MiniPanel-only since it shipped, so on desktop the option
               governing whether a drag reaches the other curves inside the brush ran on whatever
               the wrist panel was last set to, unseen. It belongs beside the two channels it
               qualifies rather than in a section of its own. */ ''}
          <button class="mm-choice${MotionPathEdit.connected() ? ' active' : ''}" id="mm-path-connected">Connect</button>
        </div>`, false);
    }

    // ── Grab channels ────────────────────────────────────────────────
    //
    // The same pair the wrist panel has had, and for the same reason the motion-path one is
    // here: on desktop Grab ran with whatever VR was last set to and no way to see it.
    //
    // THROUGH GrabChannels.setChannel, never the globals -- turning the last one off has to turn
    // the other back on, because a grab that neither translates nor rotates is indistinguishable
    // from a broken grab.
    if (isGrab) {
      const gch = GrabChannels.channels();
      brushHTML += collapsibleHTML('grab-channels', 'Grab', `
        <div class="mm-choice-grid cols-2">
          <button class="mm-choice${gch.translate ? ' active' : ''}" id="mm-grab-translate">Translate</button>
          <button class="mm-choice${gch.rotate ? ' active' : ''}" id="mm-grab-rotate">Rotate</button>
        </div>`, false);
    }

    // ── Face-group paint controls ────────────────────────────────────
    if (isPaintGroup) {
      const grp = tool._group ?? 1;
      const showGroups = main.getMesh?.()?.getShowFacesGroups?.() ?? false;
      brushHTML += `
        <div class="mm-row">
          <span class="mm-lbl">Active Group</span>
          <input type="range" id="mm-group-active" min="1" max="8" step="1" value="${grp}">
          <span class="mm-val" id="mm-group-active-val">${grp}</span>
        </div>
        <button class="mm-toggle${showGroups ? ' active' : ''}" id="mm-group-show">Show Groups</button>`;
    }

    // ── Voxel-specific controls (ported from the VR MiniPanel; align-to-hand omitted) ──
    if (isVoxel) {
      const curMode    = tool._mode ?? 0;
      const curNeg     = tool._negative ?? false;
      const curShape   = tool._shape ?? 0; // 0=Sphere, 1=Box
      const vmesh      = tool._voxelMesh;
      const curBuildup = tool._buildUp ?? false;
      const curFlat    = vmesh?.getFlatShading?.() ?? false;
      const curWire    = vmesh?.getShowWireframe?.() ?? false;
      const curRes     = tool._pendingRes ?? tool._res ?? 128;

      // Move (mode 4) advects voxels by the cursor delta; desktop bakes the warp on
      // mouse-up (SculptVoxel start/stroke/end), no live preview yet.
      const modes = [
        { mode: 0, neg: false, label: 'Add'     },
        { mode: 1, neg: false, label: 'Sub'     },
        { mode: 3, neg: false, label: 'Smooth'  },
        { mode: 2, neg: false, label: 'Inflate' },
        { mode: 2, neg: true,  label: 'Deflate' },
        { mode: 4, neg: false, label: 'Move'    },
      ];
      const isActiveMode = (m) => {
        if (m.mode === 0 && !m.neg) return curMode === 0 && !curNeg;
        if (m.mode === 1 && !m.neg) return curMode === 1 || (curMode === 0 && curNeg);
        return m.mode === curMode && m.neg === curNeg;
      };
      // Semantic tints matching toolTints.js: deform (Add/Sub/Inflate/Deflate) = red,
      // Smooth = blue, Move = green — so voxel modes read the same as the mesh tools.
      const modeTint = (m) => m.mode === 3 ? '#89b4fa' : m.mode === 4 ? '#a6e3a1' : '#f38ba8';
      const modeBtns = modes.map(m =>
        `<button class="mm-choice${isActiveMode(m) ? ' active' : ''}" data-voxel-mode="${m.mode}" data-voxel-neg="${m.neg}" style="color:${modeTint(m)}">${m.label}</button>`
      ).join('');
      const shapeBtns = [{ shape: 0, label: 'Sphere' }, { shape: 1, label: 'Box' }].map(s =>
        `<button class="mm-choice${curShape === s.shape ? ' active' : ''}" data-voxel-shape="${s.shape}">${s.label}</button>`
      ).join('');

      brushHTML += `
        <div class="mm-section-title">Voxel Mode</div>
        <div class="mm-choice-grid cols-3">${modeBtns}</div>
        <div class="mm-choice-grid cols-2" style="margin-top:4px">${shapeBtns}</div>
        <div class="mm-choice-grid cols-3" style="margin-top:4px">
          <button class="mm-choice${curBuildup ? ' active' : ''}" data-voxel-buildup="1">Build Up</button>
          <button class="mm-choice${curFlat ? ' active' : ''}" data-voxel-flat="1">Flat</button>
          <button class="mm-choice${curWire ? ' active' : ''}" data-voxel-wire="1">Wire</button>
        </div>
        <div class="mm-row">
          <span class="mm-lbl">Resolution</span>
          <input type="range" id="mm-voxel-res" min="16" max="256" step="16" value="${curRes}">
          <span class="mm-val" id="mm-voxel-res-val">${curRes}</span>
        </div>
        <div class="mm-choice-grid cols-2" style="margin-top:4px">
          <button class="mm-choice${!tool._surfaceMode ? ' active' : ''}" data-voxel-planelock="1" title="Draw plane: camera-locked (follows view) vs world-locked (fixed so you can orbit around your drawing). Click to toggle.">Plane: ${tool._planeWorldLocked ? 'World' : 'Camera'}</button>
          <button class="mm-choice${tool._surfaceMode ? ' active' : ''}" data-voxel-surface="1" title="Surface mode: strokes track the existing voxel surface instead of the draw plane">Surface</button>
        </div>
        <div class="mm-btn-pair" style="margin-top:4px">
          <button class="mm-action-btn" data-voxel-resample="1">Resample</button>
          <button class="mm-action-btn" data-voxel-bake="1">Convert to Mesh</button>
        </div>`;
    }

    // ── Masking-specific: clear/invert/blur/sharpen + extract ────────
    if (isMasking) {
      const thickness = tool._thickness ?? 0;
      brushHTML += `
        <div class="mm-btn-pair" style="margin-top:4px">
          <button class="mm-action-btn" id="mm-mask-clear"  >Clear   </button>
          <button class="mm-action-btn" id="mm-mask-invert" >Invert  </button>
        </div>
        <div class="mm-btn-pair">
          <button class="mm-action-btn" id="mm-mask-blur"   >Blur    </button>
          <button class="mm-action-btn" id="mm-mask-sharpen">Sharpen </button>
        </div>
        <div class="mm-section-title">Extract</div>
        <div class="mm-row">
          <span class="mm-lbl">Thickness</span>
          <input type="range" id="mm-mask-thickness" min="-500" max="500" step="1" value="${Math.round(thickness * 100)}">
          <span class="mm-val" id="mm-mask-thickness-val">${thickness.toFixed(2)}</span>
        </div>
        <button class="mm-action-btn" id="mm-mask-extract" style="margin-top:3px">Extract Mesh</button>`;
    }

    // ── Extrude / Inset: keep-together option ────────────────────────
    if (isExtrudeOrInset) {
      const kt = !!window.keepExtrudeFacesTogether;
      brushHTML += `<button class="mm-toggle${kt ? ' active' : ''}" id="mm-keep-together" style="margin-top:4px">Keep Together</button>`;
    }

    // ── Alpha brush texture selector ─────────────────────────────────
    if (tool._idAlpha !== undefined) {
      const alphaNames = Object.keys(Picking.ALPHAS_NAMES);
      const currentAlpha = tool._idAlpha ?? alphaNames[0];
      // IMPORT IS THE LAST OPTION, NOT A SECOND CONTROL. Picking an alpha and adding one to
      // the list are the same question -- "which alpha" -- so they belong in the same control.
      // As a button beside the picker it cost the section a second line to say a thing the
      // picker could say in one of its own rows. matt: "the import option could just be the
      // last option of the combobox."
      //
      // The sentinel value is handled in the wiring, which restores the trigger's label: the
      // list is a list of alphas and Import is a verb, so leaving it showing as the current
      // selection would be a lie about what the brush is using.
      brushHTML += `
        <div class="mm-section-title">Alpha</div>
        ${buildSelectHTML('mm-alpha-select',
            alphaNames.map(n => ({ val: n, label: n })).concat([{ val: ALPHA_IMPORT, label: 'Import…' }]),
            currentAlpha)}`;
    }

    // ── Paint-specific controls ──────────────────────────────────────
    if (cur === Enums.Tools.PAINT && tool._color) {
      // ColorWheel, PERMANENTLY OPEN, not a native colour input behind a swatch.
      //
      // The native picker is one of the controls that does not survive being rasterised into a VR
      // panel, so paint colour was unsettable in a headset -- and paint is not a desktop-only
      // tool. First cut put the wheel behind a swatch with an OK button, copying the wireframe
      // colour's shape, and in the headset it came apart: the swatch left, the wheel right, OK
      // sharing a line with the roughness slider. matt: "its a mess... i don't think the ok dialog
      // is needed, can it just have the colour wheel permanently open, with a swatch next to it?
      // closer to how the minipanel is laid out."
      //
      // So it is the MiniPanel's layout: one wheel with `extras`, which carries its own
      // foreground/background swatches, the swap arrow and the eyedropper in its header. No open
      // state, no OK, and no revision feeding the rebuild key -- the markup no longer changes, so
      // there is nothing for the cache to miss.
      //
      // ITS OWN LINE, CENTRED. The density pass gives a bare child `flex: 1 1 100%` (its own line)
      // and an `.mm-row` `flex: 1 1 190px` (packed beside its neighbours), so the `mm-row` wrapper
      // WAS the misalignment. A plain centring div rather than none at all, because `1 1 100%`
      // also stretches the wheel's own 200px box to the full panel width and leaves the ring
      // hanging off the left of a 396px slab.
      const roughness = Math.round((tool._material?.[0] ?? 0.5) * 100);
      const metallic  = Math.round((tool._material?.[1] ?? 0.0) * 100);
      brushHTML += `
        <div class="mm-section-title">Paint</div>
        <div style="display:flex;justify-content:center">
          ${buildColorWheelHTML({ prefix: 'mm-paint-cw', size: 200, extras: true })}
        </div>
        <div class="mm-row">
          <span class="mm-lbl">Roughness</span>
          <input type="range" id="mm-paint-roughness" min="0" max="100" step="1" value="${roughness}">
          <span class="mm-val" id="mm-paint-roughness-val">${roughness}%</span>
        </div>
        <div class="mm-row">
          <span class="mm-lbl">Metallic</span>
          <input type="range" id="mm-paint-metallic" min="0" max="100" step="1" value="${metallic}">
          <span class="mm-val" id="mm-paint-metallic-val">${metallic}%</span>
        </div>
        <div class="mm-choice-grid cols-2" style="margin-top:4px">
          <button class="mm-choice${tool._writeAlbedo ? ' active' : ''}" id="mm-paint-albedo">Write Color</button>
          <button class="mm-choice${tool._pickColor   ? ' active' : ''}" id="mm-paint-pick"  >Pick Color </button>
        </div>`;
    }
  }

  return `
    ${brushHTML}
    ${cur === Enums.Tools.BONE_DRAW ? buildBoneSectionHTML(main, 'mm') : ''}
    ${cur === Enums.Tools.GRAB || cur === Enums.Tools.TRANSFORM_VR
      ? buildBonePoseHTML(main, 'mm') : ''}
    ${cur === Enums.Tools.TRANSFORM_VR || cur === Enums.Tools.TRANSFORM
      ? buildTransformSectionHTML(main, 'mm') : ''}
    <div class="mm-section-title">Safety</div>
    <button class="mm-toggle${window._sculptLocked ? ' active' : ''}" id="mm-sculpt-lock"
      title="Ignore every sculpt input until unlocked — for when hand tracking or a stray controller would otherwise damage the mesh.">
      Sculpt lock ${window._sculptLocked ? '✓ On (tools do nothing)' : 'Off'}
    </button>

    ${/* NOT ON A VOXEL OBJECT, because neither of these can do anything there and both were
         failing silently. matt: "the sym and symmeerize buttons do nothing."

         Sym: SculptVoxel.stroke never consults the symmetric picking, and getDesktopCursor
         re-picks from main._mouseX/_mouseY rather than from the picking it is handed -- so the
         mirrored call deposits in the same place as the first.

         Symmetrize: mesh.symmetrize() moves vertices of the EXTRACTED SURFACE, and the worker
         regenerates that surface from the distance field on the next edit. The field is the
         source of truth; the mesh is a view of it.

         Disabled rather than hidden: a control that vanishes teaches nothing, and the tooltip is
         where the answer goes. The real fix is a field mirror in the worker (which live Sym could
         share) -- until then this stops the panel claiming something it cannot do. */ ''}
    <div class="mm-section-title">Symmetry</div>
    <button class="mm-toggle mm-tick${symOn ? ' active' : ''}${symDead ? ' mm-dim' : ''}" id="mm-sym-toggle"${
      symDead ? ' disabled title="Not available on a voxel object: voxel strokes are not mirrored yet."' : ''}>Sym</button>
    <div class="mm-row" style="gap:6px">
      <button class="mm-action-btn${symDead ? ' mm-dim' : ''}" id="mm-sym-lr" style="flex:1"${
        symDead ? ' disabled title="Not available on a voxel object: the surface is rebuilt from the voxel field, so a mirrored mesh would not survive the next edit."' : ''}>Symmetrize L→R</button>
      <button class="mm-action-btn${symDead ? ' mm-dim' : ''}" id="mm-sym-rl" style="flex:1"${
        symDead ? ' disabled title="Not available on a voxel object: the surface is rebuilt from the voxel field, so a mirrored mesh would not survive the next edit."' : ''}>Symmetrize R→L</button>
    </div>
    <button class="mm-toggle${contOn ? ' active' : ''}" id="mm-continuous" style="margin-top:4px">
      Continuous ${contOn ? '✓ On' : 'Off'}
    </button>
  `;
}

export function buildSectionHTML_sculpting(main) { return buildSculptingHTML(main, 'tools'); }
export function buildSectionHTML_properties(main) { return buildSculptingHTML(main, 'props'); }

export function buildSectionHTML_animation(main) {
  // The rig-animation block comes with the section now; appending it here as well was what
  // made the two Animation panels disagree about whether Trails exists.
  return buildAnimationSectionHTML(main, 'mm');
}

// ── MainMenuPanel class ──────────────────────────────────────────────────────

export class MainMenuPanel extends HTMLVRPanel {
  /**
   * @param {object}              main      SculptXR app / Scene object
   * @param {THREE.Scene}         scene
   * @param {THREE.Camera}        camera
   * @param {THREE.WebGLRenderer} renderer
   */
  constructor(main, scene, camera, renderer) {
    injectCSS();
    applyUISweep();

    const root = document.createElement('div');
    root.id = 'mm-root';
    // Inline width AND height so they survive SVG foreignObject serialisation.
    // With all children position:absolute they don't contribute to the parent's
    // auto-height, so without the inline height Ee() would capture 0px.
    root.style.width  = MM_W + 'px';
    // No border to add: the 2px frame is an inset shadow (see the CSS), so the element is
    // exactly its content and its client box is the whole of it — which is the box the
    // rasteriser measures and the plane is now built from.
    root.style.height = (MM_MENUBAR_H + MM_BODY_H) + 'px';  // = 500px
    root.innerHTML = buildShellHTML();

    super(root, MM_W / VR_PANEL_PX_PER_M);

    this._main           = main;
    // SO A SECTION CAN NAME THE PANEL IT IS IN. The section builders are shared with the desktop
    // sidebar and are handed an ELEMENT, not a panel -- but anything that summons a floating VR
    // panel (the keyboard, the name chooser) has to say what to float in front of. On the desktop
    // hosts this stays undefined, which is the right answer there: there is nothing to float.
    root._vrPanel = this;
    this._activeMenu    = null;     // null | 'files'|'history'|'reference'|'settings'|'about'
    this._activeSection = DEFAULT_SECTION; // scene|topology|rendering|sculpting|properties|animation
    this._lastContentKey = '';      // avoids redundant rebuilds
    this._startHidden   = true;
    this._pinned        = false;
    this._tornOffSections = new Set(); // sections currently floating as TornOffPanels

    this.init(scene, camera, renderer);
    this._applyReorgClass();
    (window._mmPanels = window._mmPanels || []).push(this);
    this._waitForMeshThenWire(main);
  }

  // The reorg is a class on the root; see uiReorg().
  _applyReorgClass() {
    const on = uiReorg();
    applyUISweep();
    this._element?.querySelector('#mm-content')?.classList.toggle('mm-dense', on);
    // BOTH classes, always exactly one of them. The CSS keys off each by name so that every
    // rule is two classes deep and cannot lose a specificity tie; see the note in the CSS.
    this._element?.classList.toggle('ui-reorg', on);
    this._element?.classList.toggle('ui-legacy', !on);
  }

  get pinned() { return this._pinned; }

  /** Called by Scene.js when a section has been torn off into a floating panel. */
  notifyTearOff(sectionId) {
    this._tornOffSections.add(sectionId);
    // If the torn-off section is currently active, switch to the first available one.
    if (this._activeSection === sectionId) {
      const sections = ['scene', 'rendering', 'topology', 'sculpting', 'properties', 'animation'];
      const next = sections.find(s => !this._tornOffSections.has(s));
      if (next) this._setSection(next);
    }
    this._updateTornTabStates();
  }

  /** Called by Scene.js when a floating panel is re-docked. */
  notifyReDock(sectionId) {
    this._tornOffSections.delete(sectionId);
    this._updateTornTabStates();
    this._lastContentKey = ''; // force rebuild if this section is now active again
  }

  _updateTornTabStates() {
    this._element.querySelectorAll('.mm-tab-btn').forEach(btn => {
      btn.classList.toggle('torn', this._tornOffSections.has(btn.dataset.section));
    });
    this.markDirty();
  }

  // One chip per torn-off section. Pressing one asks for it back, which is the useful action
  // in VR: a floating panel in a room you have since turned away from is harder to walk to
  // than to recall.
  // TORN-OFF SECTIONS ARE STILL THIS PANEL'S CONTENT, just somewhere else in the room.
  //
  // Seven places across four files mark this panel dirty when something changes -- a joint is
  // added, a tool switches, a frame group edits -- and none of them knew about the torn-off
  // copies, so a pinned outliner stopped updating the moment it was pinned. matt noticed it on
  // desktop first and then: "i notice in vr that the outliner isn't updating when pinned
  // either."
  //
  // Fixed where "this panel's content changed" ARRIVES rather than at the seven call sites, so
  // callers that do not exist yet are covered too. The same shape as the desktop fix, which put
  // it in _sectionIsFloating for the same reason.
  registerTorn(panel) { (this._tornPanels ||= new Set()).add(panel); }
  unregisterTorn(panel) { this._tornPanels?.delete(panel); }

  markDirty() {
    super.markDirty();
    if (!this._tornPanels) return;
    // REQUEST, not perform: rebuilding here would put a DOM regeneration and a blocking
    // rasterise on every markDirty, of which there are many a second while a rig is handled.
    // The panel picks it up on its next frame, throttled -- see requestSync.
    for (const p of this._tornPanels) p.requestSync?.();
  }


  // ── Mesh placement ─────────────────────────────────────────────────────────

  _onMeshCreated() {
    if (!this.mesh) return;
    // Wrist-relative offset — the shared panel convention, so it sits
    // flat on the non-dominant palm when parented to the controller grip.
    // Scene.js re-parents this mesh to uiGrip every frame in VR.
    this.mesh.position.set(0.10, wristPanelY(), -0.05);
    this.mesh.rotation.set(wristPanelPitch(), wristPanelYaw(), 0);
  }

  // ── Wait for mesh, then wire shell events ──────────────────────────────────

  _waitForMeshThenWire(main) {
    const check = () => {
      if (this.mesh) this._wireShell(main);
      else requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  }

  _wireShell(main) {
    const root = this._element;

    // Top menubar buttons
    root.querySelectorAll('.mm-menu-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._setMenu(btn.dataset.menu);
      });
    });

    // Side tab strip buttons
    root.querySelectorAll('.mm-tab-btn').forEach(btn => {
      if (btn.id === 'mm-tl-btn' || btn.id === 'mm-bs-btn') return; // handled separately below
      btn.addEventListener('click', () => {
        if (!this._tornOffSections.has(btn.dataset.section)) {
          this._setSection(btn.dataset.section);
        }
      });
    });

    // Timeline tab — toggles the VR timeline mesh, does not switch panel content
    root.querySelector('#mm-tl-btn')?.addEventListener('click', () => {
      const tlBtn = root.querySelector('#mm-tl-btn');
      const show = !tlBtn.classList.contains('tl-on');
      tlBtn.classList.toggle('tl-on', show);
      document.dispatchEvent(new CustomEvent('vtl-show', { detail: { show } }));
      this.markDirty();
    });

    // Blendshapes tab — toggles the VR blendshape layer-stack mesh (canvas panel)
    root.querySelector('#mm-bs-btn')?.addEventListener('click', () => {
      const bsBtn = root.querySelector('#mm-bs-btn');
      const show = !bsBtn.classList.contains('tl-on');
      bsBtn.classList.toggle('tl-on', show);
      document.dispatchEvent(new CustomEvent('vbs-show', { detail: { show } }));
      this.markDirty();
    });

    // Swap back to the wrist panel — announced, so Scene decides what the swap means.
    const miniBtn = root.querySelector('#mm-mini-btn');
    if (miniBtn) {
      miniBtn.addEventListener('click', () => {
        this._element.dispatchEvent(new CustomEvent('mm-show-mini', { bubbles: false }));
      });
    }

    const _uBtn = root.querySelector('#mm-undo');
    const _rBtn = root.querySelector('#mm-redo');
    if (_uBtn) _uBtn.addEventListener('click', () =>
      this._element.dispatchEvent(new CustomEvent('mm-undo', { detail: { redo: false }, bubbles: false })));
    if (_rBtn) _rBtn.addEventListener('click', () =>
      this._element.dispatchEvent(new CustomEvent('mm-undo', { detail: { redo: true }, bubbles: false })));

    // Pin button
    const pinBtn = root.querySelector('#mm-pin-btn');
    if (pinBtn) {
      pinBtn.addEventListener('click', () => {
        this._pinned = !this._pinned;
        pinBtn.classList.toggle('active', this._pinned);
        this._element.dispatchEvent(
          new CustomEvent('mm-pin-change', { detail: { pinned: this._pinned }, bubbles: false })
        );
        this.markDirty();
      });
    }

    // Custom scrollbar
    wireVRScrollbar(
      root.querySelector('#mm-content'),
      root.querySelector('#mm-sbar-track'),
      root.querySelector('#mm-sbar-thumb'),
      () => this.markDirty()
    );

    // Populate initial content
    this._rebuildContent();
  }

  // A PRESS IN THE VIEWPORT DISMISSES THE MENU.
  //
  // Every other menu in every other app closes when you go back to the work. This one stayed up
  // until you pressed its button a second time, so after opening a file — or changing your mind
  // about it — the menu sat over the model. matt: "it should definitely close if i click on the
  // viewport."
  //
  // ON THE CANVAS, not the document: a press anywhere in the panel, the sidebar or a torn-off
  // window is still working the UI and must not dismiss anything. The canvas IS "back to the
  // model", which is exactly the condition.
  //
  // Nothing is consumed — no preventDefault, no stopPropagation — so the press that closes the
  // menu also does whatever it was going to do. Dismissing is a side effect of going back to
  // work, not a click you have to spend.
  _wireViewportDismiss(main) {
    const canvas = main && main._canvas;
    if (!canvas || this._dismissWired) return;
    this._dismissWired = true;
    canvas.addEventListener('pointerdown', () => { this.closeMenu(); });
  }

  // Dismiss whatever menu is up. Public because things OUTSIDE the panel finish a menu's job —
  // loading a scene, above all, which arrives through Scene.loadScene rather than through any
  // button here. A no-op when nothing is open.
  closeMenu() {
    if (!this._activeMenu) return false;
    this._activeMenu = null;
    this._lastContentKey = '';
    this._rebuildContent();
    this.markDirty();
    return true;
  }

  // ── Navigation ─────────────────────────────────────────────────────────────

  _setMenu(name) {
    this._activeMenu = (this._activeMenu === name) ? null : name;
    this._rebuildContent();
  }

  _setSection(name) {
    this._activeMenu    = null;
    this._activeSection = name;
    this._rebuildContent();
  }

  _rebuildContent() {
    const root      = this._element;
    const contentEl = root.querySelector('#mm-content');
    if (!contentEl) return;

    // Build cache key first — DOM mutations below are no-ops when the key
    // matches, so skip them entirely to avoid polyfill layout recalculations.
    const mesh = this._main.getMesh?.();
    const shaderType = getOptionsURL().shader;
    const meshCount  = this._main.getMeshes?.()?.length ?? 0;
    const sm = this._main.getSculptManager?.() ?? this._main._sculptManager;
    const curTool = sm?.getToolIndex?.() ?? -1;
    const symOn  = sm?._symmetry  ? 1 : 0;
    const contOn = sm?._continuous ? 1 : 0;
    const guiFiles    = this._main.getGui?.()._ctrlFiles ?? null;
    const savesCount  = guiFiles?._browserSaves?.length ?? 0;
    const key = this._activeMenu
      ? `menu:${this._activeMenu}:${savesCount}:${wireframeSectionRev()}`
      // `_outlinerRev` is bumped by anything that changes what the outliner SAYS rather than
      // what it contains — a rename above all. Without it the key is identical after a rename
      // (same section, same mesh count) and the rebuild below is skipped, so the panel keeps
      // showing the old names until something unrelated forces it. See Skeleton.refreshOutliner.
      : `sec:${this._activeSection}:${shaderType}:${meshCount}:${curTool}:${symOn}:${contOn}:${uiReorg() ? 1 : 0}`
        + `:${this._main._outlinerRev | 0}`;

    this._applyReorgClass();
    if (key === this._lastContentKey) return;
    this._lastContentKey = key;

    // Update top menubar active state
    root.querySelectorAll('.mm-menu-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.menu === this._activeMenu);
    });

    // Update side tab active state (tabs always visible; dim them when a menu is open)
    root.querySelectorAll('.mm-tab-btn').forEach(btn => {
      btn.classList.toggle('active', !this._activeMenu && btn.dataset.section === this._activeSection);
    });

    // Build HTML
    const main = this._main;
    let html = '';
    if (this._activeMenu) {
      switch (this._activeMenu) {
        case 'files':         html = buildMenuHTML_files(main);     break;
        case 'browser-saves': html = '<button class="mm-action-btn" id="mm-back-to-files" style="margin-bottom:8px">← Back to Files</button>' + buildMenuHTML_browserSaves(main); break;
        case 'history':    html = buildMenuHTML_history(main);    break;
        case 'background': html = buildMenuHTML_background(main); break;
        case 'reference':  html = buildMenuHTML_reference();     break;
        case 'view':       html = buildMenuHTML_view(main);      break;
        case 'settings':   html = buildMenuHTML_settings(main);  break;
        case 'about':      html = buildMenuHTML_about();         break;
      }
    } else {
      switch (this._activeSection) {
        case 'scene':     html = buildSectionHTML_scene(main);     break;
        case 'topology':  html = buildSectionHTML_topology(main);  break;
        case 'rendering': html = buildSectionHTML_rendering(main); break;
        case 'camera':    html = buildSectionHTML_camera(main);    break;
        case 'sculpting': html = buildSectionHTML_sculpting(main); break;
        case 'properties': html = buildSectionHTML_properties(main); break;
        case 'animation': html = buildSectionHTML_animation(main); break;
      }
      // 'Tools', not 'Sculpting'. The section header sits directly above the body's own
      // "Sculpt" heading, so the old label said the same word twice in two type sizes for no
      // gain — matt: "there is a unnecessary extra header, 'SCULPTING'". The ROW stays because
      // it carries the float-panel pin button; only the word changes. 'Tools' also covers what
      // the section actually holds, which is Sculpt AND Mesh Edit AND Paint.
      html = sectionHeaderHTML(this._activeSection) + html;
    }

    // KEEP THE SCROLL. Selecting a row bumps `_outlinerRev`, which changes the key above, which
    // replaces the whole of #mm-content — and a new list starts at the top. On a rig with a
    // hand's worth of joints that means every selection throws you back to the collarbone, so
    // picking a run of fingers is a fight. matt: "each time i selected something the outliner
    // would shift or reset its scroll. i hate that."
    //
    // Read BEFORE the assignment and written after, by class rather than by identity: the
    // elements are new objects, so the old ones cannot be asked anything once the HTML lands.
    const scrolls = [];
    contentEl.querySelectorAll('.mm-outliner-list').forEach((el, i) => scrolls.push([i, el.scrollTop]));
    contentEl.innerHTML = html;
    if (scrolls.length) {
      const lists = contentEl.querySelectorAll('.mm-outliner-list');
      for (const [i, top] of scrolls) if (lists[i]) lists[i].scrollTop = top;
    }

    // Wire section header pin button
    const sectionPinBtn = contentEl.querySelector('#mm-section-pin-btn');
    if (sectionPinBtn) {
      sectionPinBtn.addEventListener('click', () => {
        const section = this._activeSection;
        if (!this._tornOffSections.has(section)) {
          this._element.dispatchEvent(
            new CustomEvent('mm-section-tearoff', { detail: { section }, bubbles: false })
          );
        }
      });
    }

    // Every section title on this page becomes a collapsible, collapsed unless it has been
    // opened before. Runs on the fresh markup and before the wiring, so the heads it creates
    // are wired by the same pass as the ones the builders emit.
    if (uiReorg()) groupSectionTitles(contentEl, { defaultOpen: pageDefaultOpen(this._activeMenu) });

    this._wireContent();

    // Sync custom scrollbar thumb after content changes
    refreshVRScrollbar(this._element.querySelector('#mm-content'), this._element.querySelector('#mm-sbar-thumb'));

    // The outliner is rebuilt from scratch on every content change, so its scrollbar is a NEW
    // pair of elements each time and has to be re-wired here — wiring it once at construction
    // would leave it dead from the first rebuild onwards.
    // Same for the browser-saves list, and for the same reason: it is rebuilt on every content
    // change, so a scrollbar wired once at construction would be dead from the first rebuild.
    const svList = this._element.querySelector('.mm-storage-list');
    if (svList) {
      const svWrap = svList.parentElement;
      wireVRScrollbar(
        svList,
        svWrap.querySelector('.mm-storage-sbar'),
        svWrap.querySelector('.mm-storage-sbar .mm-scrollbar-thumb'),
        () => this.markDirty()
      );
      refreshVRScrollbar(svList, svWrap.querySelector('.mm-storage-sbar .mm-scrollbar-thumb'));
    }

    const olList = this._element.querySelector('.mm-outliner-list');
    if (olList) {
      const olWrap = olList.parentElement;
      wireVRScrollbar(
        olList,
        olWrap.querySelector('.mm-outliner-sbar'),
        olWrap.querySelector('.mm-outliner-sbar .mm-scrollbar-thumb'),
        () => this.markDirty()
      );
      refreshVRScrollbar(olList, olWrap.querySelector('.mm-outliner-sbar .mm-scrollbar-thumb'));
    }

    this.markDirty();
  }

  // ── Event wiring for dynamic content ──────────────────────────────────────

  _wireContent() {
    const main = this._main;
    wireGroups(this._element, () => this.noteContentResized());
    if (this._activeMenu) {
      this._wireMenu(this._activeMenu, main);
    } else {
      this._wireSection(this._activeSection, main);
    }
  }

  // ── Menu event wiring ──────────────────────────────────────────────────────

  _wireMenu(menu, main) {
    const el = this._element;
    const q  = (id) => el.querySelector(id);
    const paint = () => this.markDirty();

    if (menu === 'files') {
      const rebuildFiles = () => {
        this._lastContentKey = '';
        this._refreshContent();
      };
      wireMenuFiles(el, main, rebuildFiles, () => {
        const guiFiles = main.getGui?.()._ctrlFiles ?? null;
        Promise.resolve(guiFiles?.prepareBrowserSavePage?.()).then(() => this._setMenu('browser-saves'));
      });
    } else if (menu === 'browser-saves') {
      wireMenuBrowserSaves(el, main, async () => {
        const guiFiles = main.getGui?.()._ctrlFiles ?? null;
        await guiFiles?.prepareBrowserSavePage?.();
        this._lastContentKey = '';
        this._refreshContent();
      }, paint);
      q('#mm-back-to-files')?.addEventListener('click', () => this._setMenu('files'));

    } else if (menu === 'history') {
      wireMenuHistory(el, main, paint);
    } else if (menu === 'view') {
      // All four, on one root. Disjoint ids means each pass wires its own controls and finds
      // null for everything else, so there is no second copy of any of them to drift.
      const fullRepaint = () => { this._lastContentKey = ''; this._rebuildContent(); };
      wireSectionRendering(el, main, fullRepaint, paint, paint);
      wireMenuBackground(el, main, paint);
      q('#mm-ref-add')?.addEventListener('click', () => document.getElementById('referenceopen')?.click());
      q('#mm-ref-clear')?.addEventListener('click', () => { main.getReferenceManager?.()?.clear?.(); paint(); });
      q('#mm-ref-show')?.addEventListener('click', () => {
        q('#mm-ref-show')?.classList.toggle('active');
        paint();
      });

    } else if (menu === 'background') {
      wireMenuBackground(el, main, paint);
    } else if (menu === 'reference') {
      q('#mm-ref-add')?.addEventListener('click', () => document.getElementById('referenceopen')?.click());
      q('#mm-ref-clear')?.addEventListener('click', () => { main.getReferenceManager?.()?.clear?.(); paint(); });
      q('#mm-ref-show')?.addEventListener('click', () => {
        q('#mm-ref-show')?.classList.toggle('active');
        paint();
      });

    } else if (menu === 'settings') {
      this._wireSettings(main);

    } else if (menu === 'about') {
      wireMenuAbout(el);
    }
  }

  _wireSettings(main) {
    const el   = this._element;
    const q    = (id) => el.querySelector(id);
    const opts = getOptionsURL;
    const paint = () => this.markDirty();

    // THE CONTROLS THAT MOVED HERE FROM RENDERING. Same handlers, same ids — the bodies are
    // copied from wireSectionRendering rather than shared, because that function wires a SECTION
    // and this wires a MENU, and the two are reached by different routes. The ids are unique, so
    // the pair cannot both be live at once.
    // The platform-neutral sections, from the shared pair. Curvature used to carry a note here
    // saying it was "a desktop-only tuning control" while living in a VR-only page, which is the
    // contradiction this extraction resolves: it is on both pages now.
    wireSharedSettings(el, main, paint);

    // Relaunch the floating controller-button guide. Clearing _btnLabels forces a
    // rebuild with the CURRENT dominant hand (so toggling Left Hand Mode then re-showing
    // reflects it). #45.
    q('#mm-show-ctrl-guide')?.addEventListener('click', () => {
      if (main._btnLabels) {
        main._btnLabels.left?.mesh?.removeFromParent?.();
        main._btnLabels.right?.mesh?.removeFromParent?.();
        main._btnLabels = null;
      }
      window._vrShowButtonLabels = true;
      main._btnLabelsAutoHideAt = performance.now() + 8000;
    });

    // Input toggles
    q('#mm-left-hand')?.addEventListener('click', () => {
      const newHand = main._dominantHand === 'left' ? 'right' : 'left';
      main.setDominantHand?.(newHand);
      opts.saveOption('leftHandMode', newHand === 'left');
      q('#mm-left-hand')?.classList.toggle('active', newHand === 'left');
      paint();
    });
    q('#mm-raycast')?.addEventListener('click', () => {
      main._vrUseVolumeIntersect = !main._vrUseVolumeIntersect;
      opts.saveOption('aimPickingMode', !main._vrUseVolumeIntersect);
      q('#mm-raycast')?.classList.toggle('active', !main._vrUseVolumeIntersect);
      paint();
    });
    // A SETTING, NOT AN ENV VAR. This lived only on `window`, which meant a console -- and there
    // is no console in a headset. matt: "its a pain changing things like this with an envar in
    // the console on the gxr." PhysicsBones.setSolver persists it through the same option store
    // as every other setting here, so it survives a reload like they do.
    wireDevToggles(q, paint);
    // `_wireSlider` rather than the bare one: in VR a slider drag has to mark the panel dirty
    // or the texture keeps showing the old number.
    wireAudioSection(q, (sl, val, cb, fmt) => this._wireSlider(sl, val, cb, fmt), paint);
    q('#mm-ambi')?.addEventListener('click', () => {
      main._vrAmbidextrousCursors = !main._vrAmbidextrousCursors;
      opts.saveOption('ambidextrousCursors', main._vrAmbidextrousCursors);
      q('#mm-ambi')?.classList.toggle('active', main._vrAmbidextrousCursors);
      paint();
    });

    // Press point -- where in the trigger's travel a press registers. See _triggerThreshold.
    this._wireSlider(q('#mm-trigger'), q('#mm-trigger-val'), (v) => {
      const f = v / 100;
      opts.saveOption('triggerCurve', f, 500);
    }, (v) => `${v}%`);

    // Grab speed — world movement per unit of hand movement while gripping.
    this._wireSlider(q('#mm-grab-gain'), q('#mm-grab-gain-val'), (v) => {
      const f = v / 100;
      opts.saveOption('grabGain', f, 500);
    }, (v) => `${v}%`);

    // Throw — how much of the release speed the world keeps. Writes the live global as well as
    // the saved option so it takes effect on the very next release rather than the next reload;
    // Scene._navThrowScale reads the live one first, in that order.
    this._wireSlider(q('#mm-nav-throw'), q('#mm-nav-throw-val'), (v) => {
      const f = v / 100;
      window._navThrow = f;
      opts.saveOption('navThrow', f, 500);
    }, (v) => (v > 0 ? `${v}%` : 'Off'));

    // Pinch distance — millimetres of finger-to-thumb gap that still counts as a click.
    this._wireSlider(q('#mm-pinch-on'), q('#mm-pinch-on-val'), (v) => {
      const f = v / 1000;
      opts.saveOption('pinchOn', f, 500);
    }, (v) => `${v}mm`);

    // Hand spike — length and offset in centimetres, angle in degrees (negative aims lower).
    // The VISUAL spike is a mesh that only moves when update* is called; the accessors decide
    // where the picking TIP is. Writing the setting alone moves one and not the other, which is
    // how the drawn spike and the radius sphere end up in different places.
    this._wireSlider(q('#mm-hand-len'), q('#mm-hand-len-val'), (v) => {
      const f = v / 100;
      main.updateStylusLength?.(f);
      opts.saveOption('handStylusLength', f, 500);
    });
    this._wireSlider(q('#mm-hand-off'), q('#mm-hand-off-val'), (v) => {
      const f = v / 100;
      main.updateStylusOffset?.(f);
      opts.saveOption('handStylusOffset', f, 500);
    });
    this._wireSlider(q('#mm-hand-pitch'), q('#mm-hand-pitch-val'), (v) => {
      // The ray correction reads the window override first, so keep them in step — otherwise a
      // value set here would be ignored for as long as a console trial is still in effect.
      window._handRayPitch = v;
      opts.saveOption('handRayPitch', v, 500);
    }, (v) => `${v}\u00B0`);

    // Stylus
    this._wireSlider(q('#mm-stylus-len'), q('#mm-stylus-len-val'), (v) => {
      const f = v / 100;
      main.updateStylusLength?.(f);
      opts.saveOption('stylusLength', f, 500);
    });
    this._wireSlider(q('#mm-stylus-off'), q('#mm-stylus-off-val'), (v) => {
      const f = v / 100;
      main.updateStylusOffset?.(f);
      opts.saveOption('stylusOffset', f, 500);
    });
    this._wireSlider(q('#mm-stylus-tilt'), q('#mm-stylus-tilt-val'), (v) => {
      main.updateStylusTilt?.(v);
      opts.saveOption('stylusTilt', v, 500);
    }, (v) => `${v}°`);
    // Gizmo size multiplier (0.25x–2x, persistent). Live via window._gizmoSizeMul, read
    // each frame by GizmoVR.update; no _resize needed (it's a matrix scale).
    this._wireSlider(q('#mm-gizmo-mul'), q('#mm-gizmo-mul-val'), (v) => {
      const f = v / 100;
      window._gizmoSizeMul = f;
      opts.saveOption('gizmoSizeMul', f, 500);
      main.render?.();
    }, (v) => `${(v / 100).toFixed(2)}x`);

    // Calibration
    this._wireSlider(q('#mm-head-height'), q('#mm-head-height-val'), (v) => {
      const f = v / 100;
      main.updateVROffsets?.();
      opts.saveOption('offsetY', f, 500);
    }, (v) => (v / 100).toFixed(1));

    // Controller model
    {
      const ctrlModels = ['Auto','meta-quest-touch-plus','meta-quest-touch-plus-v2',
        'meta-quest-touch-pro','oculus-touch-v3','oculus-touch-v2',
        'valve-index','htc-vive','samsung-galaxyxr','samsung-odyssey'];
      wireSelect(el, 'mm-ctrl-model', (v) => {
        const idx = parseInt(v, 10);
        window._xrControllerOverride = ctrlModels[idx];
        opts.saveOption('controllerModel', ctrlModels[idx]);
        if (window._reloadControllerModels) window._reloadControllerModels.call(main);
        else main.reloadControllerModels?.();
        main.render?.();
      }, paint); // was `lightRepaint` (undefined in this method) → threw ReferenceError, aborting
                 // _wireSettings before the controller-model/wireframe/menu sliders got wired.
    }

    // Wireframe — bias, opacity, colour and type, shared with the desktop Settings menu.
    //
    // REBUILD, not markDirty. `paint` here is the panel's re-rasterise, which redraws the DOM as
    // it stands; this section's controls change the MARKUP (the picker appears, the toggle's
    // label flips), so they need the content built again. The desktop menu's repaintFn already
    // does that, which is why only VR was broken.
    wireWireframeSection(el, main, () => { this._rebuildContent(); this.markDirty(); },
                         () => this.markDirty());

    // Menu brightness/saturation
    this._wireSlider(q('#mm-menu-bright'), q('#mm-menu-bright-val'), (v) => {
      const f = v / 100;
      opts.saveOption('menuBrightness', f, 500);
      setMenuColorGrade(f, ui?.menuSaturation ?? 0.5, ui?.menuGamma ?? 0.5);
    }, (v) => `${v}%`);
    this._wireSlider(q('#mm-menu-sat'), q('#mm-menu-sat-val'), (v) => {
      const f = v / 100;
      opts.saveOption('menuSaturation', f, 500);
      setMenuColorGrade(ui?.menuBrightness ?? 0.5, f, ui?.menuGamma ?? 0.5);
    }, (v) => `${v}%`);
    this._wireSlider(q('#mm-menu-gamma'), q('#mm-menu-gamma-val'), (v) => {
      const f = v / 100;
      opts.saveOption('menuGamma', f, 500);
      setMenuColorGrade(ui?.menuBrightness ?? 0.5, ui?.menuSaturation ?? 0.5, f);
    }, (v) => `${v}%`);

    // Debug
    q('#mm-debug-mode')?.addEventListener('click', () => {
      const dbg = !(opts().debugMode ?? false);
      opts.saveOption('debugMode', dbg);
      q('#mm-debug-mode')?.classList.toggle('active', dbg);
      paint();
    });
    q('#mm-perf-profile')?.addEventListener('click', () => window.debugProfile?.(120));

    // Blendshape safety net — snapshot/restore all layer deltas + base (undo-
    // independent). Console helpers aren't reachable in standalone VR, so surface
    // them here. screenLog gives on-device confirmation.
  }

  // ── Section event wiring ───────────────────────────────────────────────────

  _wireSection(section, main) {
    const el = this._element;
    const fullRepaint = () => { this._lastContentKey = ''; this._rebuildContent(); };
    const lightRepaint = () => this.markDirty();

    if (section === 'scene') {
      wireSectionScene(el, main, fullRepaint, this); // this = the VR panel, so the numpad anchors to it
    } else if (section === 'topology') {
      wireSectionTopology(el, main, fullRepaint, lightRepaint, lightRepaint);
    } else if (section === 'rendering' || section === 'camera') {
      // ONE WIRING FUNCTION FOR BOTH, the same arrangement Sculpting and Properties use: the two
      // pages have disjoint ids, querySelector answers null for the ones that are not here, and
      // there is no second copy to fall behind the first.
      wireSectionRendering(el, main, fullRepaint, lightRepaint, lightRepaint);
    } else if (section === 'sculpting' || section === 'properties') {
      // BOTH PAGES, one wiring function. The two halves have disjoint ids and querySelector
      // returns null for the ones that are not on this page, so the single wiring pass is
      // correct for either -- and there is no second copy to fall behind the first.
      wireSectionSculpting(el, main, fullRepaint, lightRepaint, lightRepaint);
    } else if (section === 'animation') {
      this._wireSectionAnimation(el, lightRepaint);
      wireBoneSection(el, main, { refresh: lightRepaint, rebuild: lightRepaint, panel: el._vrPanel || null });
    }
  }

  _wireSectionAnimation(el, repaint) {
    wireAnimationSection(el, this._main, {
      repaint,
      sync: () => { syncAnimationSection(el, this._main); repaint(); },
      refreshBs: (mesh) => { refreshBlendshapesDOM(el, mesh, this._main, repaint); repaint(); },
      vrPanel: this,  // lets the numpad position itself next to this panel in VR
    });
    // Populate blendshape list immediately after wiring — wireAnimationSection only
    // registers the callback, it doesn't call it on setup.
    const _bsMesh = this._main?.getMesh?.() || this._main?._mesh
      || this._main?._meshes?.find?.(m => window._animationRegistry?.tracks.get(m.getID())?.blendshapes?.size > 0);
    refreshBlendshapesDOM(el, _bsMesh, this._main, repaint);
    repaint();
  }

  // ── Slider helper ──────────────────────────────────────────────────────────
  // Wires input[type=range] → val display span → callback.
  // formatFn(intValue) → string; default is just String(v).

  _wireSlider(sliderEl, valEl, cb, formatFn) {
    wireSlider(sliderEl, valEl, cb, formatFn, () => this.markDirty());
  }

  // ── Outliner helper ────────────────────────────────────────────────────────

  _findMeshById(stableId) {
    return (this._main.getMeshes?.() ?? []).find(m => m._permanentStaticId === stableId) ?? null;
  }

  // ── Public API (called by Scene.js) ───────────────────────────────────────

  /**
   * Refresh the currently displayed content (e.g. after a sculpt operation
   * changes mesh count or shader type).
   */
  syncFromState() {
    this._lastContentKey = '';
    this._rebuildContent();
  }

  /** Toggle the panel visible and refresh content. */
  show(visible) {
    if (!this.mesh) return;
    this.mesh.visible = visible;
    if (visible) {
      this.syncFromState();
      // Start the async polyfill paint chain immediately so the texture is as
      // fresh as possible by the time the renderer draws this frame.
      this.flushPaint();
    }
  }

  /**
   * Override _onPaint: emit a one-time screenLog so the VR mirror confirms
   * the polyfill successfully rendered the panel.
   */
  _onPaint() {
    const hadTexture = !!this._texture;
    super._onPaint();
    if (!hadTexture && this._texture) {
      // First successful paint — visible in VR mirror + remote DevTools.
      console.log('[MainMenuPanel] polyfill first paint OK, canvas size:',
        this._texture.image?.width, '×', this._texture.image?.height);
      if (window.screenLog) window.screenLog('[MainMenu] first paint ✓', 'cyan');
    }
  }
}

// ── Module-level shared wire helpers (used by both VR MainMenuPanel and desktop Gui) ─────

/**
 * Apply explicit pointer-capture drag handling to every input[type=range] inside rootEl.
 * Native range drag breaks inside web-component shadow DOM / overflow containers — this
 * re-implements it with pointerdown/move/up + setPointerCapture so it works reliably.
 * Call once after injecting section HTML into a desktop panel element.
 */
export function fixSliderDrag(rootEl) {
  rootEl.querySelectorAll('input[type=range]').forEach(input => {
    let dragging = false;
    const getVal = (clientX) => {
      const r = input.getBoundingClientRect();
      const t = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
      const min = parseFloat(input.min) || 0;
      const max = parseFloat(input.max) || 100;
      const step = parseFloat(input.step) || 1;
      return Math.max(min, Math.min(max, Math.round((min + t * (max - min)) / step) * step));
    };
    input.addEventListener('pointerdown', (e) => {
      dragging = true;
      input.setPointerCapture(e.pointerId);
      input.value = getVal(e.clientX);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      e.stopPropagation();
    });
    input.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      input.value = getVal(e.clientX);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      e.stopPropagation();
    });
    input.addEventListener('pointerup', (e) => {
      if (!dragging) return;
      dragging = false;
      if (input.hasPointerCapture(e.pointerId)) input.releasePointerCapture(e.pointerId);
      e.stopPropagation();
    });
    input.addEventListener('lostpointercapture', () => { dragging = false; });
  });
}

/**
 * Update the custom scrollbar thumb to reflect the current scroll position.
 * Call after any scrollTop change or content size change.
 */
// DEFERRED, BECAUSE READING scrollHeight FORCES A SYNCHRONOUS LAYOUT.
//
// Every rebuild does: set innerHTML, wire it up, then call this -- and this reads scrollHeight
// and clientHeight, which the browser cannot answer without laying out the subtree that was just
// replaced. So each rebuild paid a forced reflow of a whole panel, and then the rasteriser laid
// the same DOM out again. matt's profile of three pinned panels named this line twice:
//
//   Recalculate style  MainMenuPanel.js:2858   60.6ms  7.6%
//   Layout             MainMenuPanel.js:2858   24.0ms  3.0%
//
// against WebGLRenderer.render at 16.1% in the same slice -- so one line of scrollbar
// arithmetic was in the same league as all the 3D drawing.
//
// Deferring to the next frame does not skip the layout, it stops us FORCING it mid-write: by
// then the browser has laid out once, on its own schedule, and the read is free. Coalesced per
// element, because a rebuild can ask several times and one answer serves them all. The thumb
// lands one frame late, which at 72Hz is not a thing anyone can see.
const _sbPending = new WeakSet();
export function refreshVRScrollbar(scrollEl, thumbEl) {
  if (!scrollEl || !thumbEl || _sbPending.has(scrollEl)) return;
  _sbPending.add(scrollEl);
  requestAnimationFrame(() => {
    _sbPending.delete(scrollEl);
    _applyVRScrollbar(scrollEl, thumbEl);
  });
}

function _applyVRScrollbar(scrollEl, thumbEl) {
  if (!scrollEl || !thumbEl || !scrollEl.isConnected) return;
  const { scrollTop, scrollHeight, clientHeight } = scrollEl;
  if (scrollHeight <= clientHeight) { thumbEl.style.display = 'none'; return; }
  thumbEl.style.display = '';
  const thumbH = Math.max(32, (clientHeight / scrollHeight) * clientHeight);
  const maxTop  = clientHeight - thumbH;
  const ratio   = scrollTop / (scrollHeight - clientHeight);
  thumbEl.style.height = thumbH + 'px';
  thumbEl.style.top    = Math.round(ratio * maxTop) + 'px';
}

/**
 * Wire a custom scrollbar track+thumb to a scroll container.
 * Uses pointer capture for smooth drag.  dirtyFn() triggers a panel repaint.
 */
export function wireVRScrollbar(scrollEl, trackEl, thumbEl, dirtyFn) {
  if (!scrollEl || !trackEl || !thumbEl) return;

  const refresh = () => { refreshVRScrollbar(scrollEl, thumbEl); dirtyFn?.(); };

  // Sync thumb on scroll (thumbstick or any programmatic scroll)
  scrollEl.addEventListener('scroll', refresh);

  // Click on track (outside thumb) — jump-scroll
  trackEl.addEventListener('pointerdown', (e) => {
    if (e.target === thumbEl) return;
    const rect  = trackEl.getBoundingClientRect();
    const ratio = (e.clientY - rect.top) / rect.height;
    scrollEl.scrollTop = ratio * (scrollEl.scrollHeight - scrollEl.clientHeight);
    refresh();
    e.stopPropagation();
    e.preventDefault();
  });

  // Drag thumb
  let _dragStartY = 0, _dragStartScroll = 0, _dragging = false;
  thumbEl.addEventListener('pointerdown', (e) => {
    _dragging = true;
    _dragStartY = e.clientY;
    _dragStartScroll = scrollEl.scrollTop;
    thumbEl.setPointerCapture(e.pointerId);
    e.stopPropagation();
    e.preventDefault();
  });
  thumbEl.addEventListener('pointermove', (e) => {
    if (!_dragging) return;
    const dy = e.clientY - _dragStartY;
    const trackH = trackEl.clientHeight;
    const scrollRange = scrollEl.scrollHeight - scrollEl.clientHeight;
    scrollEl.scrollTop = Math.max(0, Math.min(scrollRange, _dragStartScroll + (dy / trackH) * scrollEl.scrollHeight));
    refresh();
    e.stopPropagation();
  });
  thumbEl.addEventListener('pointerup', (e) => {
    _dragging = false;
    if (thumbEl.hasPointerCapture(e.pointerId)) thumbEl.releasePointerCapture(e.pointerId);
  });
  thumbEl.addEventListener('lostpointercapture', () => { _dragging = false; });

  // Initial state
  refresh();
}

/**
 * Wire an input[type=range] to a value-display span and a callback.
 * dirtyFn is called after each input event (pass markDirty for VR, or a rebuild fn for desktop).
 */
export function wireSlider(sliderEl, valEl, cb, formatFn, dirtyFn) {
  if (!sliderEl) return;
  const fmt = formatFn ?? String;
  sliderEl.addEventListener('input', () => {
    const v = parseFloat(sliderEl.value);
    if (valEl) valEl.textContent = fmt(v);
    cb(v);
    dirtyFn?.();
  });
  if (valEl) valEl.textContent = fmt(parseFloat(sliderEl.value));
}

/**
 * Wire event handlers for the Rendering section.
 * fullRepaintFn  — called when HTML structure needs to change (shader switch).
 * lightRepaintFn — called for toggle buttons (defaults to fullRepaintFn).
 * sliderDirtyFn  — called on each slider input event, e.g. markDirty for VR
 *                  (defaults to null — desktop DOM renders itself, no rebuild on drag).
 */
/**
 * Wire event handlers for the Scene/Outliner section.
 */
// Lightweight in-place refresh of the outliner eye icons (icon + orange keyed
// colour) to match current visibility — cheap enough to call every animation frame,
// unlike a full outliner rebuild. Used so the eye state tracks the timeline live.
export function updateOutlinerVisIcons(main) {
  const reg = window._animationRegistry;
  const meshes = main.getMeshes?.() ?? [];
  const sel = main.getSelectedMeshes?.() ?? [];

  // THE ROWS, which no longer have an eye of their own: dim a hidden one and orange a keyed one.
  // Still per-frame cheap (class toggles, no rebuild) because the timeline drives visibility and
  // the outliner has to follow it live.
  document.querySelectorAll('[data-action="select"]').forEach((btn) => {
    const mesh = meshes.find((m) => m._permanentStaticId === btn.dataset.meshId);
    const row = btn.parentElement;
    if (!mesh || !row) return;
    row.classList.toggle('is-hidden', !(mesh.isVisible?.() ?? true));
    row.classList.toggle('vis-keyed', !!reg?.hasVisibilityKeys?.(mesh));
  });

  // THE TOOLBAR EYE, which now reports the selection rather than one mesh. Queried across the
  // document because the torn-off Scene panel carries its own copy of this toolbar.
  const anyVis = sel.some((m) => m.isVisible?.() ?? true);
  const keyed  = sel.some((m) => !!reg?.hasVisibilityKeys?.(m));
  document.querySelectorAll('#mm-vis-toggle').forEach((btn) => {
    btn.classList.toggle('keyed', keyed);
    // Was a className swap on an <i> glyph; the icon is a path now, so swap the path.
    setFaIcon(btn, anyVis ? 'eye' : 'eye-slash');
  });
}

// SHIFT+CLICK: the run of rows from the anchor to the one just clicked, replacing the
// selection — Finder/Explorer behaviour, which is what an outliner is measured against.
//
// THE ROW ORDER COMES FROM THE DOM, not from main.getMeshes(). The list is a HIERARCHY: children
// sit under their parents and a collapsed branch is not on screen at all, so the scene array's
// order is not the order the user sees, and "everything between these two" has to mean between
// them AS DISPLAYED or it selects things that were never on the screen.
//
// Returns false when there is nothing to range over (no anchor yet, or the anchor has since been
// deleted or collapsed out of view), so the caller can fall back to an ordinary click rather
// than have Shift silently do nothing.
function selectRange(el, main, clicked) {
  const anchorId = main._outlinerAnchorId;
  if (!anchorId) return false;
  const ids = [...el.querySelectorAll('[data-action="select"]')].map((b) => b.dataset.meshId);
  const a = ids.indexOf(anchorId);
  const b = ids.indexOf(clicked?._permanentStaticId);
  if (a < 0 || b < 0) return false;

  const byId = new Map((main.getMeshes?.() ?? []).map((m) => [m._permanentStaticId, m]));
  // Walked from the anchor TOWARDS the click so the clicked row is added last and therefore
  // ends up as the active mesh — the one the transform fields and the rig buttons act on.
  // Adding the run in list order instead would leave whichever end sorted last in charge,
  // which is not the row the user just pointed at.
  const step = a <= b ? 1 : -1;
  main.setOrUnsetMesh?.(null);
  for (let i = a; ; i += step) {
    const m = byId.get(ids[i]);
    // `true` is multi-select, which TOGGLES — safe only because the selection was just cleared,
    // so nothing in the run can already be in it.
    if (m) main.setOrUnsetMesh?.(m, true);
    if (i === b) break;
  }
  return true;
}

export function wireSectionScene(el, main, repaintFn, vrPanel = null) {
  // THE SELECTED LIGHT'S PROPERTIES. Resolved per event rather than captured at wire time, so a
  // stale handler cannot write to a light that is no longer selected. Both fields are read by
  // ShaderPBR every frame, so there is nothing to invalidate -- just render.
  {
    const _litSel = () => {
      const sel = main.getSelectedMeshes?.() ?? [];
      return (sel.length === 1 && sel[0]?._isLight) ? sel[0] : null;
    };
    wireSlider(el.querySelector('#mm-light-int'), el.querySelector('#mm-light-int-val'), (v) => {
      const L = _litSel(); if (!L) return;
      L._lightIntensity = lightIntFromSlider(v);
      main.render?.();
    }, (v) => lightIntFromSlider(v).toFixed(3), null);
    wireSlider(el.querySelector('#mm-light-range'), el.querySelector('#mm-light-range-val'), (v) => {
      const L = _litSel(); if (!L) return;
      L._lightRange = v;
      main.render?.();
    }, (v) => String(v), null);
    el.querySelector('#mm-light-shadow')?.addEventListener('click', () => {
      const L = _litSel(); if (!L) return;
      L._castShadow = (L._castShadow === false);
      // repaintFn, not lightRepaintFn: this is wireSectionScene, which has no such parameter.
      // `lightRepaintFn?.()` looks safe and is not -- optional CALL does not protect an
      // undefined IDENTIFIER, so the shadow toggle threw a ReferenceError out of the VR
      // dispatch every time it was pressed. The toggle changes the button's MARKUP, so it
      // needs the full repaint anyway.
      repaintFn?.();
      main.render?.();
    });
    wireSlider(el.querySelector('#mm-light-shopacity'), el.querySelector('#mm-light-shopacity-val'), (v) => {
      const L = _litSel(); if (!L) return;
      L._shadowIntensity = v / 100;
      main.render?.();
    }, (v) => v + '%', null);
    wireSlider(el.querySelector('#mm-light-shsoft'), el.querySelector('#mm-light-shsoft-val'), (v) => {
      const L = _litSel(); if (!L) return;
      L._shadowRadius = v;
      main.render?.();
    }, (v) => String(v), null);
    wireSlider(el.querySelector('#mm-light-shbias'), el.querySelector('#mm-light-shbias-val'), (v) => {
      const L = _litSel(); if (!L) return;
      L._shadowNormalBias = v / 100;
      main.render?.();
    }, (v) => (v / 100).toFixed(2), null);
    wireSlider(el.querySelector('#mm-light-cone'), el.querySelector('#mm-light-cone-val'), (v) => {
      const L = _litSel(); if (!L) return;
      L._lightConeDeg = v;
      // The cone handle IS the angle, so it has to be rebuilt as the slider moves or it starts
      // lying. Cheap enough to do per input event: ~60 line segments.
      main.decorateLight?.(L);
      main.render?.();
    }, (v) => `${v}\u00B0`, null);
    // A REBUILD, not a repaint: changing the type changes which rows exist.
    el.querySelectorAll('[data-light-type]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const L = _litSel(); if (!L) return;
        L._lightType = parseInt(btn.dataset.lightType, 10);
        // The handle is type-specific -- asterisk, cone or parallel rays -- so it is rebuilt
        // here rather than left showing the shape of the type you just left.
        main.decorateLight?.(L);
        main.render?.();
        repaintFn?.();
      });
    });

    const _toHex = (rgb) => '#' + [0, 1, 2].map((i) =>
      Math.max(0, Math.min(255, Math.round(rgb[i] * 255))).toString(16).padStart(2, '0')).join('');
    el.querySelector('#mm-light-swatch')?.addEventListener('click', () => {
      _litPickerOpen = true; repaintFn?.();
    });
    el.querySelector('#mm-light-cw-ok')?.addEventListener('click', () => {
      _litPickerOpen = false; repaintFn?.();
    });
    const _cwRoot = el.querySelector('#mm-light-cw');
    if (_cwRoot) {
      // Disposed first: this section rebuilds on every repaint, and an old wheel keeps
      // document-level pointermove/pointerup listeners that would otherwise pile up.
      el._litWheel?.dispose?.();
      el._litWheel = new ColorWheel(_cwRoot, {
        prefix: 'mm-light-cw', size: 150,
        get: () => (_litSel()?._lightColor ?? [1, 1, 1]).slice(0, 3),
        set: (rgb) => {
          const L = _litSel(); if (!L) return;
          L._lightColor = [rgb[0], rgb[1], rgb[2]];
          // The ray gizmo is drawn in the light's own colour, so it has to be repainted or it
          // starts lying. This is the first caller refreshLightDecoration has ever had.
          main.refreshLightDecoration?.(L);
          const sw = el.querySelector('#mm-light-swatch');
          if (sw) sw.style.background = _toHex(rgb);
          main.render?.();
        },
        render: () => main.render?.(),
      });
    }
  }

  const findMesh = id => (main.getMeshes?.() ?? []).find(m => m._permanentStaticId === id) ?? null;

  // Toolbar eye → hide/show the whole selection. ONE TARGET STATE FOR ALL OF THEM, taken from
  // "is any of them visible": a per-mesh toggle across a mixed selection just inverts the mess
  // and needs a second click to mean anything.
  el.querySelector('#mm-vis-toggle')?.addEventListener('click', () => {
    const sel = main.getSelectedMeshes?.() ?? [];
    if (!sel.length) return;
    const want = !sel.some((m) => m.isVisible?.() ?? true);
    for (const mesh of sel) {
      mesh.setVisible?.(want);
      if (mesh.getThreeMesh?.()) mesh.getThreeMesh().visible = want;
    }
    main.render?.();
    repaintFn();
  });

  // Chevron → expand/collapse a parent's children in the outliner (frame groups,
  // rigs, any parented hierarchy). State lives on the mesh so it survives repaints.
  el.querySelectorAll('[data-action="collapse"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const mesh = findMesh(btn.dataset.meshId);
      if (!mesh) return;
      mesh._outlinerCollapsed = !mesh._outlinerCollapsed;
      repaintFn();
    });
  });


  // Complete a pending two-step rig assignment (parent / aim) against `target`.
  // The transitions live in RigPending now, because the VIEWPORT can finish one of these too
  // and two copies of the rule is how the outliner and the 3D pick would drift apart.
  const completeRigPending = (target) => {
    RigPending.take(main, target);
    repaintFn();
  };

  // Inline rename editor. Replaces the row's label with a text input; commits on
  // Enter/blur, cancels on Escape. (Each click repaints, so the double-click is
  // detected via timestamps stored on `main`, and we re-query the fresh button.)
  const beginRename = (btn, mesh) => {
    const _useVrKb = !!window._vrKeyboard?.shouldUse?.();
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'mm-rename-input';
    input.value = mesh._permanentStaticLabel ?? '';
    if (_useVrKb) input.inputMode = 'none'; // suppress the Quest system keyboard
    btn.replaceChildren(input);
    // Focusing the input is what triggers the Quest's native keyboard — skip it in VR so
    // only our on-screen keyboard shows.
    if (!_useVrKb) { input.focus(); input.select(); }
    let done = false;
    const commit = (save) => {
      if (done) return; done = true;
      if (save) {
        const v = input.value.trim();
        if (v) { mesh._permanentStaticLabel = v; mesh.uiName = v; }
      }
      repaintFn();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // keep app shortcuts from firing while typing
      if (e.key === 'Enter')  { e.preventDefault(); commit(true); }
      else if (e.key === 'Escape') { e.preventDefault(); commit(false); }
    });
    // VR: no physical keyboard — drive the rename from the on-screen keyboard and skip
    // the blur-commit (opening the keyboard can blur the field and commit the stale value
    // first). Desktop keeps blur-to-commit.
    if (_useVrKb) {
      window._vrKeyboard.open(input.value, { label: 'Rename mesh', maxLength: 40 }, (text) => {
        const v = (text ?? '').trim();
        if (v) input.value = v;
        commit(!!v);
      }, input, vrPanel);
    } else {
      input.addEventListener('blur', () => commit(true));
    }
  };

  // Toolbar pencil → rename the selected mesh (double-click a row still works, but it's awkward
  // in VR). Single selection only — the button is disabled otherwise, since one name cannot be
  // typed into six meshes.
  el.querySelector('#mm-rename-sel')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const sel = main.getSelectedMeshes?.() ?? [];
    if (sel.length !== 1) return;
    const mesh = sel[0];
    const nameBtn = el.querySelector(`[data-action="select"][data-mesh-id="${mesh._permanentStaticId}"]`);
    if (nameBtn) beginRename(nameBtn, mesh);
  });

  // HOVERING A ROW LIGHTS THE THING IN 3D. matt: "if i hover over names in the outliner tree in
  // the panel, it should highlight the bone in the 3d view as well." The rig already has a
  // preselection channel — the same one the controller ray drives — so this is a second SOURCE
  // for it rather than a second highlight, and the colour means the same thing in both places.
  //
  // Cleared on leave, and on a repaint the rows are rebuilt anyway, so a stale highlight cannot
  // outlive the row that set it.
  // POINTERMOVE, NOT ENTER/LEAVE. The VR panel synthesises pointermove/down/up onto the
  // offscreen DOM; enter and leave are generated by the browser's own hit testing and never
  // arrive, so listeners on those work on a flat screen and silently do nothing in a headset —
  // which is the platform this is for.
  //
  // Cleared on the CAPTURE phase at the panel root and set on the row's own bubble, so moving
  // off a row onto anything else — another row, a button, blank panel — clears it without
  // needing a leave event. Ordering does the work: capture runs before the target.
  const setPanelHover = (id) => {
    if (main._rigPanelHoverId === id) return;   // no repaint unless the answer moved
    main._rigPanelHoverId = id;
    if (window._outlinerHoverTrace) console.log('[outlinerHover] -> ' + id);
    Skeleton.updateVisuals(main);
    main.render?.();
  };
  // NO RESET HERE. This wiring re-runs on every panel repaint, and a repaint can happen while
  // the pointer is sitting on a row — so clearing the id here fought the hover instead of
  // tidying after it. The capture-phase clear below and the leave handler are enough.
  // CLEARING CLEARS BOTH CHANNELS. A rig row lights through the rig's preselection, a plain
  // mesh through its own bounds outline, and the row under the pointer changes kind as you move
  // down the list -- so clearing only the one you happened to set last leaves the other lit.
  const clearHover = () => { setPanelHover(-1); main.setMeshHoverHighlight?.(-1); };
  el.addEventListener('pointermove', () => clearHover(), true);
  el.addEventListener('pointerleave', () => clearHover());
  const rows = el.querySelectorAll('[data-action="select"]');
  rows.forEach(btn => {
    const onRow = (why) => {
      const mesh = findMesh(btn.dataset.meshId);
      if (window._outlinerHoverTrace) {
        console.log('[outlinerHover] row ' + btn.dataset.meshId + ' (' + why + ') -> '
          + (mesh ? (mesh._permanentStaticLabel || mesh.getID()) : 'NO MESH')
          + ' rig=' + !!(mesh && (mesh._isBone || mesh._isPinTarget)));
      }
      if (!mesh) return;
      // A rig node lights through the rig's own preselection channel; anything else gets the
      // bounds outline, which is the only highlight a shared-material mesh can carry. Both are
      // the same yellow, because in both places it answers the same question.
      if (mesh._isBone || mesh._isPinTarget) { setPanelHover(mesh.getID()); return; }
      main.setMeshHoverHighlight?.(mesh.getID());
    };
    // TWO SOURCES, because the two platforms deliver hover differently. On a flat screen it is
    // a real pointermove. In VR there IS no pointer event — hover is a 3D quad precisely so it
    // does not repaint the panel — so HTMLVRPanel announces what its quad found instead.
    btn.addEventListener('pointermove', () => onRow('pointer'));
    btn.addEventListener('vrhover', () => onRow('vr'));
    btn.addEventListener('vrhoverout', () => clearHover());
  });
  if (window._outlinerHoverTrace) {
    console.log('[outlinerHover] wired ' + rows.length + ' rows');
  }

  // CLICKING EMPTY SPACE IN THE LIST DROPS THE SELECTION.
  //
  // There was no way to select NOTHING, so a selection you could not reach past was permanent
  // until you found something else to click. matt got round one by picking a pin far from what
  // he was aiming at -- a workaround for a missing verb: "i should be able to click in empty
  // space in the outliner, and that should drop all selected objects." Every file browser and
  // every DCC outliner does this, and the list has a FIXED height precisely so there is empty
  // space under the rows to click on.
  //
  // A click that landed inside a row is that row's business and is left alone: its own listener
  // has already run, and a deselect here would immediately undo the select it just made.
  el.querySelector('.mm-outliner-list')?.addEventListener('click', (e) => {
    if (e.target.closest && e.target.closest('.mm-outliner-row')) return;
    cancelPending();          // an armed set-parent/aim is asking you to click a NODE
    main.setOrUnsetMesh?.(null);
    main.render?.(); repaintFn();
  });

  el.querySelectorAll('[data-action="select"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const mesh = findMesh(btn.dataset.meshId);
      if (!mesh) return;
      // Step 2 of a rig assignment: this click picks the target, not a selection.
      if (main._rigPendingMode) { completeRigPending(mesh); return; }
      const id = btn.dataset.meshId;
      const now = Date.now();
      const prev = main._lastOutlinerClick;
      const isDouble = prev && prev.id === id && (now - prev.t) < 500;
      main._lastOutlinerClick = { id, t: now };
      // Double-click → rename. Short-circuit BEFORE the select repaint: `btn` is the
      // live (already-selected) row element from the first click's repaint, so we can
      // edit it directly. Repainting first would destroy it mid-gesture, which is why
      // the rename used to need several taps to "wake up". Reset the timestamp so a
      // third click doesn't immediately re-trigger.
      if (isDouble) {
        main._lastOutlinerClick = null;
        beginRename(btn, mesh);
        return;
      }
      // MULTI-SELECT. Ctrl and Shift are NOT the same gesture, and treating them as one (which
      // this did) is the thing that makes a list feel unlike every other list. Finder, Explorer,
      // every DCC outliner: Ctrl/Cmd toggles one row, Shift takes the run from the anchor to
      // here. matt: "control+click should individually select and toggle, shift+click should
      // select a range."
      //
      // VR's secondary trigger stays a toggle — there is no keyboard out there to say range with,
      // and a toggle is the one of the two that composes into any selection given enough clicks.
      const range  = !!(e && e.shiftKey);
      const toggle = !!(e && (e.ctrlKey || e.metaKey)) || !!main.multiSelectHeld?.();
      if (range && selectRange(el, main, mesh)) {
        // the anchor deliberately stays put, so a second Shift+click re-picks the run from the
        // same end rather than walking it along
      } else if (toggle) {
        main.setOrUnsetMesh?.(mesh, true);
        main._outlinerAnchorId = id;
      } else {
        main.setOrUnsetMesh?.(mesh, false);
        main._outlinerAnchorId = id;
      }
      main.render?.(); repaintFn();
    });
  });

  // Any scene-add action cancels an in-progress pick to avoid a stale subject.
  const cancelPending = () => RigPending.cancel(main);

  // When an SR frame group is the active context, a newly-added primitive is adopted
  // as the frame at the playhead (fills a blank "New" slot) instead of a stray object.
  const addPrimitive = (make) => {
    cancelPending();
    // Only adopt into an SR frame group while you're actively in SR mode with the
    // timeline open — otherwise it's a normal standalone object (e.g. after you close
    // the timeline / leave SR mode to build regular geometry).
    const tlVisible = !!main.getGui?.()?._ctrlTimeline?._visible;
    const inSR = tlVisible && window._animKeyMode === 'shaperep';
    const grp = inSR ? window._frameGroup?.activeGroup?.() : null;
    const m = make();
    if (grp && m) window._frameGroup.adoptAsFrame(m, grp);
    main.render?.(); repaintFn();
  };
  el.querySelector('#mm-add-sphere')?.addEventListener('click', () => addPrimitive(() => main.addSphere?.()));
  el.querySelector('#mm-add-cube')?.addEventListener('click', () => addPrimitive(() => main.addCube?.()));
  el.querySelector('#mm-add-cylinder')?.addEventListener('click', () => addPrimitive(() => main.addCylinder?.()));
  // ASYNC, unlike the others: the geometry is a fetched asset. addPrimitive expects `make()` to
  // return the mesh synchronously (it may adopt it into a frame group), so the await happens
  // first and the shared path runs once the mesh exists.
  el.querySelector('#mm-add-human')?.addEventListener('click', async () => {
    const btn = el.querySelector('#mm-add-human');
    if (btn) { btn.disabled = true; btn.textContent = '...'; }
    try {
      await main.addHumanBase?.();
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Human'; }
    }
    cancelPending();
    main.render?.(); repaintFn();
  });
  el.querySelector('#mm-add-null')?.addEventListener('click', () => {
    cancelPending(); main.addNull?.(); main.render?.(); repaintFn();
  });
  el.querySelector('#mm-add-light')?.addEventListener('click', () => {
    cancelPending(); main.addLight?.(); main.render?.(); repaintFn();
  });
  el.querySelector('#mm-add-voxel')?.addEventListener('click', () => {
    cancelPending(); main.addVoxelObject?.(); main.render?.(); repaintFn(); // empty voxel space + Voxel tool
  });
  el.querySelector('#mm-duplicate')?.addEventListener('click', () => {
    // A JOINT DUPLICATES ITS CHAIN, not itself. duplicateSelection copies one mesh and inherits
    // its parent, which on a joint is a lone joint hanging off the same parent -- and it carries
    // `_boneMirror` across, so the copy claims the original's twin. See Skeleton.duplicateChain.
    const sel = main.getSelectedMeshes?.() ?? [];
    const joints = sel.filter((m) => Skeleton.isJoint(m));
    if (joints.length && joints.length === sel.length) {
      // ROOTS ONLY. Selecting a shoulder and its elbow means one arm, not an arm plus a forearm
      // nested inside the copy of the arm.
      const roots = joints.filter((j) => !joints.some((o) => o !== j && isAncestorOf(o, j)));
      for (const j of roots) Skeleton.duplicateChain(main, j);
    } else {
      main.duplicateSelection?.();
    }
    main.render?.(); repaintFn();
  });
  el.querySelector('#mm-instance')?.addEventListener('click', () => {
    main.instanceSelection?.(); main.render?.(); repaintFn();
  });
  el.querySelector('#mm-mirror-sel')?.addEventListener('click', () => {
    main.mirrorSelection?.(0); main.render?.(); repaintFn();
  });
  el.querySelector('#mm-make-unique')?.addEventListener('click', () => {
    main.makeUniqueSelection?.(); main.render?.(); repaintFn();
  });
  el.querySelector('#mm-delete-mesh')?.addEventListener('click', () => {
    main.deleteCurrentSelection?.(); main.render?.(); repaintFn();
  });

  // ── Rig controls (parent / look-at / mirror / saccades) ─────────────────────
  const selOne = () => {
    const s = main.getSelectedMeshes?.() ?? [];
    return s.length === 1 ? s[0] : null;
  };

  // Two-step assignment: arm a pending mode, then the next outliner click is the target.
  // Pressing the same button again cancels.
  // ALWAYS THREE STEPS: press, click the child, click the parent. The selection is not read at
  // all — on a flat screen it cannot be set reliably for a pin in the first place (only the
  // Transform tool selects rig nodes), so seeding the child from it started the gesture on
  // whatever was left over from something else.
  el.querySelector('[data-rig="set-parent"]')?.addEventListener('click', () => {
    RigPending.toggle(main, 'parent');
    repaintFn();
  });
  el.querySelector('[data-rig="set-aim"]')?.addEventListener('click', () => {
    RigPending.toggle(main, 'lookat');
    repaintFn();
  });
  el.querySelector('[data-rig="clear-parent"]')?.addEventListener('click', () => {
    const sel = selOne(); if (!sel) return;
    main.setMeshParent?.(sel.getID(), null);
    main.render?.(); repaintFn();
  });
  el.querySelector('[data-rig="clear-aim"]')?.addEventListener('click', () => {
    const sel = selOne(); if (!sel) return;
    main.clearLookAt?.(sel.getID());
    main.render?.(); repaintFn();
  });
  el.querySelector('[data-rig="lock"]')?.addEventListener('click', () => {
    const sel = selOne(); if (!sel) return;
    main.toggleSelectLock?.(sel.getID());
    main.render?.(); repaintFn();
  });

  el.querySelector('[data-rig="mirror"]')?.addEventListener('click', () => {
    const sel = selOne(); if (!sel) return;
    main.toggleMirror?.(sel.getID());
    main.render?.(); repaintFn();
  });

  el.querySelector('[data-rig="saccades"]')?.addEventListener('click', () => {
    const sel = selOne(); if (!sel) return;
    const on = !main.isSaccading?.(sel.getID());
    main.setSaccades?.(sel.getID(), on);
    main.render?.(); repaintFn();
  });

  wireSlider(el.querySelector('#mm-rig-sac-amp'), el.querySelector('#mm-rig-sac-amp-val'), (v) => {
    const sel = selOne(); if (!sel) return;
    main.setSaccades?.(sel.getID(), true, v);
  });
  wireSlider(el.querySelector('#mm-rig-sac-speed'), el.querySelector('#mm-rig-sac-speed-val'), (v) => {
    const sel = selOne(); if (!sel) return;
    main.setSaccadeSpeed?.(sel.getID(), v);
  });

  wireSlider(el.querySelector('#mm-rig-sac-smooth'), el.querySelector('#mm-rig-sac-smooth-val'), (v) => {
    const sel = selOne(); if (!sel) return;
    main.setSaccadeSmooth?.(sel.getID(), v);
  });

  el.querySelector('#mm-bake-t')?.addEventListener('click', () => {
    const sel = selOne(); if (!sel) return;
    main.bakeTranslate?.(sel.getID());
    main.render?.(); repaintFn(); // Pos fields now 0
  });
  el.querySelector('#mm-bake-r')?.addEventListener('click', () => {
    const sel = selOne(); if (!sel) return;
    main.bakeRotate?.(sel.getID());
    main.render?.(); repaintFn(); // Rot fields now 0
  });
  el.querySelector('#mm-bake-s')?.addEventListener('click', () => {
    const sel = selOne(); if (!sel) return;
    main.bakeScale?.(sel.getID());
    main.render?.(); repaintFn(); // Scale fields now 1
  });

  // Transform fields (local Pos/Rot/Scale). Edit writes the one component; clicking a
  // field opens the VR numpad (same pattern as the animation panel).
  const _xfNames = { t: 'Position', r: 'Rotation', s: 'Scale' };
  // Zero for position and rotation, one for scale — the identity for each component, written
  // through the same setter the number fields use so there is one path that changes a transform.
  const _clearTo = { t: 0, r: 0, s: 1 };
  for (const type of ['t', 'r', 's']) {
    el.querySelector(`#mm-clear-${type}`)?.addEventListener('click', () => {
      const sel = selOne(); if (!sel) return;
      for (let axis = 0; axis < 3; axis++) {
        main.setTransformComponent?.(sel.getID(), type, axis, _clearTo[type]);
      }
      main.render?.(); repaintFn();
    });
  }

  el.querySelectorAll('.mm-xf').forEach((input) => {
    const type = input.dataset.xf;
    const axis = parseInt(input.dataset.axis, 10);
    input.addEventListener('change', () => {
      const sel = selOne(); if (!sel) return;
      main.setTransformComponent?.(sel.getID(), type, axis, parseFloat(input.value));
      // no repaint — keep focus; the field already shows the entered value
    });
    input.addEventListener('click', (e) => {
      if (!window._vrNumpad || !window._vrNumpad.shouldUse()) return;
      if (window._vrNumpad.isBlockingOpen) return;
      e.preventDefault(); e.stopPropagation();
      const current = parseFloat(input.value) || 0;
      const label = `${_xfNames[type] || ''} ${['X', 'Y', 'Z'][axis]}`;
      window._vrNumpad.open(current, { label, integer: false }, (val) => {
        input.value = val;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }, input, vrPanel); // sourcePanel → numpad parents to & floats beside this panel (was missing → floated at camera)
    });
  });
}

export function wireSectionRendering(el, main, fullRepaintFn, lightRepaintFn = fullRepaintFn, sliderDirtyFn = null) {
  const mesh   = main.getMesh?.();
  const meshes = main.getSelectedMeshes?.()?.length ? main.getSelectedMeshes() : (mesh ? [mesh] : []);
  const ShaderPBR = Shader[Enums.Shader.PBR];

  wireBoneSection(el, main, { refresh: fullRepaintFn, rebuild: fullRepaintFn, panel: el._vrPanel || null });

  el.querySelectorAll('[data-shader]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.shader, 10);
      getOptionsURL.setGlobalShader(main, id);
      fullRepaintFn(); // sections appear/disappear on shader change
    });
  });

  // No repaint passed to either: wireSelect updates its own trigger label and active row, and a
  // rebuild here would replace the dropdown mid-press and swallow the click — the same reason the
  // desktop sidebar passes a no-op light repaint for the scene section.
  wireSelect(el, 'mm-env-select', (val) => {
    ShaderPBR.idEnv = parseInt(val, 10);
    main.getBackground?.()?._applyBackground?.(); // refresh if background shows the env
    main.render?.();
  });

  wireSelect(el, 'mm-matcap-select', (val) => {
    if (val === 'import') {
      // PUT THE LABEL BACK FIRST. wireSelect has already written "Import matcap…" onto the
      // trigger and marked that row active, which is right for a choice and wrong for an action:
      // no matcap changed, and the control would sit claiming one that does not exist. The file
      // dialog is asynchronous and may be cancelled, so there is nothing to wait for either.
      const wrap = el.querySelector('#mm-matcap-select-wrap');
      const cur  = String(mesh?.getMatcap?.() ?? 0);
      const back = wrap?.querySelector(`.mm-select-opt[data-val="${cur}"]`);
      const trig = wrap?.querySelector('.mm-select-trigger');
      if (trig && back) trig.childNodes[0].textContent = back.textContent;
      wrap?.querySelectorAll('.mm-select-opt').forEach(b => b.classList.toggle('active', b === back));
      document.getElementById('matcapopen')?.click();
      return;
    }
    const id = parseInt(val, 10);
    (main.getSelectedMeshes?.()?.length ? main.getSelectedMeshes() : [mesh])
      ?.forEach(m => m.setMatcap?.(id));
    main.render?.();
  });

  el.querySelector('#mm-import-uv')?.addEventListener('click',     () => document.getElementById('textureopen')?.click());

  const gridBtn = el.querySelector('#mm-grid-toggle');
  gridBtn?.addEventListener('click', () => {
    main._showGrid = !main._showGrid;
    if (main._groundGrid) main._groundGrid.visible = main._showGrid;
    gridBtn.classList.toggle('active', main._showGrid);
    try {
      const s = JSON.parse(localStorage.getItem('sculptxr_settings') || '{}');
      s.grid = main._showGrid;
      localStorage.setItem('sculptxr_settings', JSON.stringify(s));
    } catch (_) {}
    main.render?.();
  });

  // SHADOW CATCHER IS THE ONLY SHADOW CONTROL THAT TURNS ANYTHING ON OR OFF. Flagging the
  // selection makes it a proxy; the light appears on its own on the next frame. The two sliders
  // below only say how the shadow looks, so they follow whether one is actually being caught.
  const catchBtn = el.querySelector('#mm-shadow-catcher');
  catchBtn?.addEventListener('click', () => {
    const on = !(main.getShadowCatcher?.() ?? false);
    main.setShadowCatcher?.(on);
    catchBtn.classList.toggle('active', on);
    const grp = el.querySelector('#mm-shadow-group');
    if (grp) {
      if (on) { grp.removeAttribute('inert'); grp.removeAttribute('aria-disabled'); }
      else    { grp.setAttribute('inert', ''); grp.setAttribute('aria-disabled', 'true'); }
    }
    lightRepaintFn();
  });

  // LIVE VALUE WRITTEN DIRECTLY, PERSIST DEBOUNCED. saveOption only updates the runtime
  // snapshot when its debounce fires, so relying on it alone would leave the viewport a third
  // of a second behind the thumb — on the one slider whose whole purpose is watching the
  // lighting change as you drag.
  wireSlider(el.querySelector('#mm-env-intensity'), el.querySelector('#mm-env-intensity-val'), (v) => {
    const f = v / 100;
    getOptionsURL().envIntensity = f;
    getOptionsURL.saveOption('envIntensity', f, 300);
    main.render?.();
  }, (v) => `${v}%`, sliderDirtyFn);

  wireSlider(el.querySelector('#mm-shadow-opacity'), el.querySelector('#mm-shadow-opacity-val'), (v) => {
    main.setShadowOpacity?.(v / 100);
  }, (v) => `${v}%`, sliderDirtyFn);

  wireSlider(el.querySelector('#mm-shadow-soft'), el.querySelector('#mm-shadow-soft-val'), (v) => {
    main.setShadowSoftness?.(v / 10);
  }, (v) => (v / 10).toFixed(1), sliderDirtyFn);

  // OPACITY, NOT TRANSPARENCY. The slider ran backwards — 0 meant fully opaque and you pushed it
  // UP to make the mesh disappear — which is the opposite of every other opacity in the app,
  // including the capsule slider right below it. Now 0 is see-through, 100 is solid, and 100 is
  // where a mesh starts. Curvature moved to Settings.
  wireSlider(el.querySelector('#mm-opacity'), el.querySelector('#mm-opacity-val'), (v) => {
    meshes?.forEach(m => m.setOpacity?.(v / 100)); main.render?.();
  }, (v) => `${v}%`, sliderDirtyFn);

  el.querySelector('#mm-flat-shading')?.addEventListener('click', () => {
    const t = !getOptionsURL().flatshading;
    getOptionsURL.setGlobalFlatShading(main, t);
    el.querySelector('#mm-flat-shading')?.classList.toggle('active', t);
    lightRepaintFn();
  });
  el.querySelector('#mm-wireframe')?.addEventListener('click', () => {
    const t = !getOptionsURL().wireframe;
    getOptionsURL.setGlobalWireframe(main, t);
    el.querySelector('#mm-wireframe')?.classList.toggle('active', t);
    lightRepaintFn();
  });

  // Wireframe opacity and z-offset sliders
  const opts = getOptionsURL;
  // The WF Opacity/Offset sliders and their wiring moved to Settings, which already had the
  // same two under 'Wireframe'. See buildMenuHTML_settings.

  el.querySelector('#mm-solid')?.addEventListener('click', () => {
    meshes?.forEach(m => {
      const mat = m._renderData?._threeMesh?.material;
      if (mat) mat.visible = !mat.visible;
    });
    main.render?.();
    lightRepaintFn();
  });

  // Tone mapping, Exposure and Grid Opacity moved to Settings; their wiring went with them.

  // Camera controls
  const camera = main.getCamera?.() ?? main._camera;
  el.querySelector('#mm-cam-center')?.addEventListener('click', () => { camera?.resetView?.();       main.render?.(); });
  el.querySelector('#mm-cam-front') ?.addEventListener('click', () => { camera?.toggleViewFront?.(); main.render?.(); });
  el.querySelector('#mm-cam-left')  ?.addEventListener('click', () => { camera?.toggleViewLeft?.();  main.render?.(); });
  el.querySelector('#mm-cam-top')   ?.addEventListener('click', () => { camera?.toggleViewTop?.();   main.render?.(); });

  wireSelect(el, 'mm-cam-proj', (v) => {
    const n = parseInt(v, 10);
    camera?.setProjectionType?.(n);
    // Dimmed, not hidden -- see the note in the builder.
    el.querySelector('#mm-fov-row')?.classList.toggle('mm-inert', n !== 0);
    main.render?.();
  }, lightRepaintFn);
  wireSlider(el.querySelector('#mm-cam-fov'), el.querySelector('#mm-cam-fov-val'),
    (v) => { camera?.setFov?.(v); main.render?.(); },
    v => `${Math.round(v)}°`, sliderDirtyFn);

  wireSelect(el, 'mm-cam-mode', (v) => {
    camera?.setMode?.(parseInt(v, 10)); main.render?.();
  }, lightRepaintFn);
  el.querySelector('#mm-cam-pivot')?.addEventListener('click', (e) => {
    camera?.toggleUsePivot?.();
    e.currentTarget.classList.toggle('active', camera?.getUsePivot?.() ?? false);
    main.render?.();
  });
  wireSlider(el.querySelector('#mm-cam-speed'), el.querySelector('#mm-cam-speed-val'),
    (v) => { main._cameraSpeed = v; },
    v => v.toFixed(2), sliderDirtyFn);

  const skipMap = [0, 1, 3, 7];
  wireSelect(el, 'mm-spectator-mode', (v) => {
    main._spectatorViewMode = parseInt(v, 10); main._spectatorN = 0;
  }, lightRepaintFn);
  wireSelect(el, 'mm-spectator-fps', (v) => {
    main._spectatorFrameSkip = skipMap[parseInt(v, 10)] ?? 3; main._spectatorN = 0;
  }, lightRepaintFn);
}

/**
 * Wire event handlers for the Topology section.
 */
export function wireSectionTopology(el, main, repaintFn, lightRepaintFn = repaintFn, sliderDirtyFn = null) {
  const topo = main.getGui?.()._ctrlTopology ?? null;

  // Posing a bone selects that bone, so a multires command issued straight afterwards would
  // land on a joint locator — which has no levels and silently ignores it. That reads as "the
  // level buttons stopped working". If the selection is a joint that drives a bound mesh,
  // select that mesh first: the command then does what it looks like it should, and the
  // outliner shows why.
  const retarget = () => {
    const sel = main.getMesh?.();
    if (!sel || !sel._isBone) return;
    const bound = Skinning.meshForJoint(main, sel);
    if (bound) { main.setMesh?.(bound); repaintFn(); }
  };

  el.querySelector('#mm-level-down')?.addEventListener('click', () => {
    retarget();
    const m = main.getMesh?.();
    if (m?._meshes && m._sel > 0) { topo?.onResolutionChanged?.(m._sel); main.render?.(); repaintFn(); }
  });
  el.querySelector('#mm-level-up')?.addEventListener('click', () => {
    retarget();
    const m = main.getMesh?.();
    if (m?._meshes && m._sel < m._meshes.length - 1) { topo?.onResolutionChanged?.(m._sel + 2); main.render?.(); repaintFn(); }
  });
  el.querySelector('#mm-subdivide')?.addEventListener('click',   () => { retarget(); topo?.subdivide?.();    main.render?.(); repaintFn(); });
  el.querySelector('#mm-reverse')?.addEventListener('click',     () => { retarget(); topo?.reverse?.();      main.render?.(); repaintFn(); });
  el.querySelector('#mm-del-lower')?.addEventListener('click',   () => { retarget(); topo?.deleteLower?.();  main.render?.(); repaintFn(); });
  el.querySelector('#mm-del-higher')?.addEventListener('click',  () => { retarget(); topo?.deleteHigher?.(); main.render?.(); repaintFn(); });

  wireSlider(
    el.querySelector('#mm-remesh-res'), el.querySelector('#mm-remesh-res-val'),
    (v) => { Remesh.RESOLUTION = v; topo?.remeshResolution?.(v); },
    null, sliderDirtyFn
  );
  // Keep the voxel-density preview overlay visible for the whole time the slider
  // is held (not just while moving) — capture phase so fixSliderDrag can't swallow
  // the events. The element is fresh each rebuild, so listeners don't leak.
  const _resSlider = el.querySelector('#mm-remesh-res');
  if (_resSlider) {
    _resSlider.addEventListener('pointerdown',  () => VoxelDensityOverlay.holdOpen(), true);
    _resSlider.addEventListener('pointerup',     () => VoxelDensityOverlay.release(),  true);
    _resSlider.addEventListener('pointercancel', () => VoxelDensityOverlay.release(),  true);
  }
  el.querySelector('#mm-remesh-block')?.addEventListener('click', () => {
    Remesh.BLOCK = !Remesh.BLOCK;
    el.querySelector('#mm-remesh-block')?.classList.toggle('active', Remesh.BLOCK);
    lightRepaintFn();
  });
  el.querySelector('#mm-remesh-smooth')?.addEventListener('click', () => {
    Remesh.SMOOTHING = !Remesh.SMOOTHING;
    el.querySelector('#mm-remesh-smooth')?.classList.toggle('active', Remesh.SMOOTHING);
    lightRepaintFn();
  });
  el.querySelector('#mm-remesh')?.addEventListener('click',    () => { topo?.remesh?.();   main.render?.(); repaintFn(); });
  el.querySelector('#mm-remesh-mc')?.addEventListener('click', () => { topo?.remeshMC?.(); main.render?.(); repaintFn(); });
  el.querySelector('#mm-dynamic')?.addEventListener('click',   () => { topo?.dynamicToggleActivate?.(); main.render?.(); repaintFn(); });
  el.querySelector('#mm-mesh-to-voxels')?.addEventListener('click', () => { topo?.meshToVoxel?.(); main.render?.(); repaintFn(); });

  // Quad remesh
  wireSlider(
    el.querySelector('#mm-quad-target'), el.querySelector('#mm-quad-target-val'),
    (v) => { if (topo) topo._targetFaces = v; }, null, sliderDirtyFn
  );
  wireSlider(
    el.querySelector('#mm-quad-steer'), el.querySelector('#mm-quad-steer-val'),
    (v) => { topo?.onSteeringChanged?.(v); }, (v) => v.toFixed(2), sliderDirtyFn
  );
  const symChk = el.querySelector('#mm-quad-symmetry');
  if (symChk) {
    symChk.checked = !!topo?._quadSymmetry;
    symChk.addEventListener('change', () => { topo?.setQuadSymmetry?.(symChk.checked); });
  }
  el.querySelector('#mm-quadremesh')?.addEventListener('click', () => { topo?.remeshQuads?.(); });

  el.querySelector('#mm-validate')?.addEventListener('click',  () => { topo?.validateMesh?.(); });
  el.querySelector('#mm-auto-heal')?.addEventListener('click', () => {
    el.querySelector('#mm-auto-heal')?.classList.toggle('active');
    lightRepaintFn();
  });
}

/**
 * Wire event handlers for the Sculpting section.
 */
export function wireSectionSculpting(el, main, repaintFn, lightRepaintFn = repaintFn, sliderDirtyFn = null) {
  const sm = main.getSculptManager?.() ?? main._sculptManager;

  // The Bones controls, shared with the wrist panel. This section is what makes rigging
  // reachable at all on iPad and desktop — it lived only in the VR wrist panel before.
  // Both callbacks repaint: this panel has no in-place state sync, so a rebuild is how a
  // toggle shows that it toggled.
  wireBoneSection(el, main, { refresh: repaintFn, rebuild: repaintFn, panel: el._vrPanel || null });
  wireTransformSection(el, main, { refresh: repaintFn });

  el.querySelector('#mm-sculpt-lock')?.addEventListener('click', () => {
    window._sculptLocked = !window._sculptLocked;
    getOptionsURL.saveOption('sculptLocked', !!window._sculptLocked, 0);
    repaintFn();
  });

  el.querySelectorAll('[data-tool-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.toolId, 10);
      main.getGui?.()._ctrlSculpting?._ctrlSculpt?.setValue(id);
      main.render?.();
      repaintFn();
    });
  });

  // ── Brush settings ─────────────────────────────────────────────────────────
  const tool = sm?.getCurrentTool?.();
  if (tool) {
    const idx = sm?.getToolIndex?.();

    wireSlider(el.querySelector('#mm-brush-radius'), el.querySelector('#mm-brush-radius-val'),
      (v) => {
        tool._radius = v;
        getOptionsURL.saveOption(`tool_${idx}_radius`, v, 500);
        main.render?.();
      }, String, sliderDirtyFn);

    wireSlider(el.querySelector('#mm-brush-intensity'), el.querySelector('#mm-brush-intensity-val'),
      (v) => {
        tool._intensity = v / 100;
        getOptionsURL.saveOption(`tool_${idx}_intensity`, v / 100, 500);
        main.render?.();
      }, (v) => `${v}%`, sliderDirtyFn);

    if (tool._hardness !== undefined) {
      wireSlider(el.querySelector('#mm-brush-hardness'), el.querySelector('#mm-brush-hardness-val'),
        (v) => {
          tool._hardness = v / 100;
          getOptionsURL.saveOption(`tool_${idx}_hardness`, v / 100, 500);
          main.render?.();
        }, (v) => `${v}%`, sliderDirtyFn);
    }

    el.querySelector('#mm-brush-negative')?.addEventListener('click', (e) => {
      tool._negative = !tool._negative;
      const isMasking = sm?.getToolIndex?.() === Enums.Tools.MASKING;
      e.currentTarget.classList.toggle('active', isMasking ? !tool._negative : tool._negative);
      main.render?.();
      lightRepaintFn();
    });

    // Face-group paint controls (only present when the Groups tool is active)
    wireSlider(
      el.querySelector('#mm-group-active'), el.querySelector('#mm-group-active-val'),
      (v) => { if (tool.setGroup) tool.setGroup(v); }, null, sliderDirtyFn
    );
    el.querySelector('#mm-group-show')?.addEventListener('click', (e) => {
      const mesh = main.getMesh?.();
      const on = !(mesh?.getShowFacesGroups?.() ?? false);
      mesh?.setShowFacesGroups?.(on);
      e.currentTarget.classList.toggle('active', on);
      main.render?.();
    });
    // The path channels. Live value first so it takes effect on the current stroke, saved
    // second so it sticks — the order every persisted setting in here is read and written in.
    const pathChannel = (id, liveKey, savedKey, pick) => {
      el.querySelector(id)?.addEventListener('click', (e) => {
        const next = !pick(MotionPathEdit.channels());
        window[liveKey] = next;
        getOptionsURL.saveOption(savedKey, next, 0);
        e.currentTarget.classList.toggle('active', next);
        lightRepaintFn();
      });
    };
    pathChannel('#mm-path-translate', '_pathTranslate', 'pathTranslate', (c) => c.translate);
    pathChannel('#mm-path-rotate', '_pathRotate', 'pathRotate', (c) => c.rotate);
    // Connectivity is not one of `channels()`, so it reads its own accessor; same live-then-saved
    // order as everything else here.
    el.querySelector('#mm-path-connected')?.addEventListener('click', (e) => {
      const next = !MotionPathEdit.connected();
      window._pathConnected = next;
      getOptionsURL.saveOption('pathConnected', next, 0);
      e.currentTarget.classList.toggle('active', next);
      lightRepaintFn();
    });
    // Grab's pair goes through setChannel, which is what keeps at least one of them on.
    //
    // BOTH BUTTONS GET REPAINTED, not just the one clicked. Turning off the last channel turns
    // the OTHER one back on, so the click that changes a button you did not press is the normal
    // case here, not an edge one -- and the desktop sections pass an empty lightRepaintFn, so
    // nothing else is going to redraw them.
    const paintGrab = (ch) => {
      el.querySelector('#mm-grab-translate')?.classList.toggle('active', ch.translate);
      el.querySelector('#mm-grab-rotate')?.classList.toggle('active', ch.rotate);
    };
    const grabChannel = (id, which) => {
      el.querySelector(id)?.addEventListener('click', () => {
        paintGrab(GrabChannels.setChannel(which, !GrabChannels.channels()[which]));
        lightRepaintFn();
      });
    };
    grabChannel('#mm-grab-translate', 'translate');
    grabChannel('#mm-grab-rotate', 'rotate');

    el.querySelector('#mm-brush-clay')?.addEventListener('click', (e) => {
      tool._clay = !tool._clay;
      e.currentTarget.classList.toggle('active', tool._clay);
      getOptionsURL.saveOption(`tool_${idx}_clay`, tool._clay);
      main.render?.();
      lightRepaintFn();
    });
    el.querySelector('#mm-brush-accum')?.addEventListener('click', (e) => {
      tool._accumulate = !tool._accumulate;
      e.currentTarget.classList.toggle('active', tool._accumulate);
      getOptionsURL.saveOption(`tool_${idx}_accumulate`, tool._accumulate);
      main.render?.();
      lightRepaintFn();
    });
    el.querySelector('#mm-brush-culling')?.addEventListener('click', (e) => {
      tool._culling = !tool._culling;
      e.currentTarget.classList.toggle('active', tool._culling);
      main.render?.();
    });
    el.querySelector('#mm-brush-topo')?.addEventListener('click', (e) => {
      tool._topoCheck = !tool._topoCheck;
      e.currentTarget.classList.toggle('active', tool._topoCheck);
    });
    // NO #mm-brush-tangent LISTENER. Smooth and Relax are the only tools that define `_tangent`
    // and both now suppress the button, so it can never be rendered — a listener for an element
    // nothing emits is the kind of thing that reads as a live feature in a grep six months from
    // now. `_tangent` itself stays: it is how Relax works.
    // Persisted, unlike the toggles above it: this one changes what the tool IS rather than how
    // one stroke behaves, and having to rediscover it every session is most of the reason the
    // behaviour read as a bug in the first place.
    el.querySelector('#mm-brush-preserve')?.addEventListener('click', (e) => {
      tool._preserveVolume = !tool._preserveVolume;
      e.currentTarget.classList.toggle('active', tool._preserveVolume);
      getOptionsURL.saveOption(`tool_${main.getSculptManager().getToolIndex()}_preserveVolume`, tool._preserveVolume);
      main.render?.();
    });

    // ── Masking extras ────────────────────────────────────────────────────────
    el.querySelector('#mm-mask-clear')   ?.addEventListener('click', () => { tool.clear?.();   main.render?.(); });
    el.querySelector('#mm-mask-invert')  ?.addEventListener('click', () => { tool.invert?.();  main.render?.(); });
    el.querySelector('#mm-mask-blur')    ?.addEventListener('click', () => { tool.blur?.();    main.render?.(); });
    el.querySelector('#mm-mask-sharpen') ?.addEventListener('click', () => { tool.sharpen?.(); main.render?.(); });
    wireSlider(el.querySelector('#mm-mask-thickness'), el.querySelector('#mm-mask-thickness-val'),
      (v) => { tool._thickness = v / 100; },
      (v) => (v / 100).toFixed(2), sliderDirtyFn);
    el.querySelector('#mm-mask-extract') ?.addEventListener('click', () => { tool.extract?.(); main.render?.(); });

    // ── Extrude / Inset keep-together ─────────────────────────────────────────
    el.querySelector('#mm-keep-together')?.addEventListener('click', (e) => {
      window.keepExtrudeFacesTogether = !window.keepExtrudeFacesTogether;
      e.currentTarget.classList.toggle('active', window.keepExtrudeFacesTogether);
    });

    // ── Paint-specific ────────────────────────────────────────────────────────
    if (tool._color) {
      const pcw = el.querySelector('#mm-paint-cw');
      if (pcw) {
        // The panel rebuilds its DOM on every repaint, so an old wheel's document-level
        // pointermove and pointerup listeners would accumulate one set per repaint.
        el._paintWheel?.dispose?.();
        // The tool is looked up on every call rather than captured: the wheel outlives a tool
        // switch, and a captured tool would go on editing the one that is no longer selected.
        // Same reasoning, same code, as the MiniPanel's copy.
        const paintTool = () => {
          let t = sm?.getCurrentTool?.();
          if (!t?._color) t = sm?.getTool?.(Enums.Tools.PAINT);
          return t?._color ? t : null;
        };
        // `_color` IS rgb in 0..1, which is the wheel's own currency -- no hex round trip here,
        // unlike the wireframe colour, which is stored as a hex string.
        el._paintWheel = new ColorWheel(pcw, {
          prefix: 'mm-paint-cw', size: 200,
          get: () => paintTool()?._color ?? null,
          set: (rgb) => {
            const t = paintTool();
            if (t) { t._color[0] = rgb[0]; t._color[1] = rgb[1]; t._color[2] = rgb[2]; }
          },
          render: () => main.render?.(),
          extras: {
            secondary: () => paintTool()?._colorSecondary ?? [0, 0, 0],
            picking:   () => !!paintTool()?._pickColor,
            togglePick: () => { const t = paintTool(); if (t) t._pickColor = !t._pickColor; },
            swap: () => {
              const t = paintTool();
              if (!t) return;
              if (typeof t.swapColors === 'function') { t.swapColors(); return; }
              if (!t._colorSecondary) return;
              const tmp = [t._color[0], t._color[1], t._color[2]];
              t._color[0] = t._colorSecondary[0]; t._color[1] = t._colorSecondary[1]; t._color[2] = t._colorSecondary[2];
              t._colorSecondary[0] = tmp[0]; t._colorSecondary[1] = tmp[1]; t._colorSecondary[2] = tmp[2];
            },
          },
        });
      }
      wireSlider(el.querySelector('#mm-paint-roughness'), el.querySelector('#mm-paint-roughness-val'),
        (v) => { if (tool._material) tool._material[0] = v / 100; main.render?.(); },
        (v) => `${v}%`, sliderDirtyFn);
      wireSlider(el.querySelector('#mm-paint-metallic'), el.querySelector('#mm-paint-metallic-val'),
        (v) => { if (tool._material) tool._material[1] = v / 100; main.render?.(); },
        (v) => `${v}%`, sliderDirtyFn);
      el.querySelector('#mm-paint-albedo')?.addEventListener('click', (e) => {
        tool._writeAlbedo = !tool._writeAlbedo;
        e.currentTarget.classList.toggle('active', tool._writeAlbedo);
        lightRepaintFn();
      });
      el.querySelector('#mm-paint-pick')?.addEventListener('click', (e) => {
        tool._pickColor = !tool._pickColor;
        e.currentTarget.classList.toggle('active', tool._pickColor);
        lightRepaintFn();
      });
    }

    // ── Voxel-specific ────────────────────────────────────────────────────────
    if (idx === Enums.Tools.VOXEL) {
      el.querySelectorAll('[data-voxel-mode],[data-voxel-shape],[data-voxel-buildup],[data-voxel-flat],[data-voxel-wire],[data-voxel-resample],[data-voxel-bake],[data-voxel-planelock],[data-voxel-surface]').forEach(btn => {
        btn.addEventListener('click', () => {
          if (btn.dataset.voxelSurface !== undefined) {
            tool._surfaceMode = !tool._surfaceMode;       // strokes track the surface
          } else if (btn.dataset.voxelPlanelock !== undefined) {
            if (tool._surfaceMode) tool._surfaceMode = false;        // surface → plane mode
            else tool.setPlaneWorldLock?.(!tool._planeWorldLocked);  // toggle camera/world lock
          } else if (btn.dataset.voxelShape !== undefined) {
            tool._shape = parseInt(btn.dataset.voxelShape, 10);
          } else if (btn.dataset.voxelBake !== undefined) {
            tool.bakeToMesh?.();                       // convert voxel object → poly mesh
          } else if (btn.dataset.voxelBuildup !== undefined) {
            tool._buildUp = !tool._buildUp;
            getOptionsURL.saveOption(`tool_${idx}_buildUp`, tool._buildUp);
          } else if (btn.dataset.voxelFlat !== undefined) {
            const m = tool._voxelMesh; if (m) m.setFlatShading?.(!m.getFlatShading?.());
          } else if (btn.dataset.voxelWire !== undefined) {
            const m = tool._voxelMesh; if (m) m.setShowWireframe?.(!m.getShowWireframe?.());
          } else if (btn.dataset.voxelResample !== undefined) {
            tool.applyResolution?.();                  // re-voxelize at the chosen resolution
          } else {
            tool._mode     = parseInt(btn.dataset.voxelMode, 10);
            tool._negative = btn.dataset.voxelNeg === 'true';
          }
          main.render?.();
          repaintFn();
        });
      });
      // Resolution: live density-overlay preview on drag, re-voxelize on release.
      wireSlider(el.querySelector('#mm-voxel-res'), el.querySelector('#mm-voxel-res-val'),
        (v) => {
          tool.setResolutionPreview?.(v);
          if (tool._voxelMesh) VoxelDensityOverlay.enable(tool._voxelMesh, v);
          getOptionsURL.saveOption(`tool_${idx}_resolution`, v, 500);
        }, String, sliderDirtyFn);
      const _vres = el.querySelector('#mm-voxel-res');
      if (_vres) {
        const onRelease = () => { VoxelDensityOverlay.disable(); tool.applyResolution?.(); main.render?.(); };
        _vres.addEventListener('change', onRelease);
        _vres.addEventListener('pointerup', onRelease, true);
        _vres.addEventListener('pointercancel', onRelease, true);
      }
    }

    // ── Alpha brush texture ───────────────────────────────────────────────────
    if (tool._idAlpha !== undefined) {
      wireSelect(el, 'mm-alpha-select', (v) => {
        if (v !== ALPHA_IMPORT) { tool._idAlpha = v; main.render?.(); return; }
        // PUT THE LABEL BACK FIRST. wireSelect has already written the clicked row's text onto
        // the trigger, and "Import..." is not an alpha -- leaving it there would have the
        // control reporting a selection the brush does not have, for as long as the file dialog
        // is open and for good if it is cancelled.
        const trig = el.querySelector('#mm-alpha-select');
        if (trig && trig.childNodes[0]) trig.childNodes[0].textContent = String(tool._idAlpha ?? '');
        el.querySelectorAll('#mm-alpha-select-wrap .mm-select-opt').forEach((b) => {
          b.classList.toggle('active', b.dataset.val === String(tool._idAlpha));
        });
        const input = document.getElementById('alphaopen');
        if (!input) return;
        // Wire a one-shot handler: load the alpha then rebuild this section.
        const onAlphaLoaded = () => {
          input.removeEventListener('change', onAlphaLoaded);
          repaintFn(); // rebuild so the new alpha appears in the list
        };
        input.addEventListener('change', onAlphaLoaded);
        input.click();
      }, lightRepaintFn);
    }
  }

  // ── Symmetry ────────────────────────────────────────────────────────────────
  const symToggle = el.querySelector('#mm-sym-toggle');
  if (symToggle && sm) {
    symToggle.addEventListener('click', () => {
      sm._symmetry = !sm._symmetry;
      // The class IS the state: the tick follows it in CSS (.mm-tick.active). Rewriting the
      // label here would put the long form straight back on the first press.
      symToggle.classList.toggle('active', sm._symmetry);
      main.render?.();
      lightRepaintFn();
    });
  }

  el.querySelector('#mm-sym-lr')?.addEventListener('click', () => {
    main.getGui?.()._ctrlSculpting?.onSymLR?.(); main.render?.();
  });
  el.querySelector('#mm-sym-rl')?.addEventListener('click', () => {
    main.getGui?.()._ctrlSculpting?.onSymRL?.(); main.render?.();
  });

  const contBtn = el.querySelector('#mm-continuous');
  if (contBtn && sm) {
    contBtn.addEventListener('click', () => {
      sm._continuous = !sm._continuous;
      contBtn.classList.toggle('active', sm._continuous);
      contBtn.textContent = `Continuous ${sm._continuous ? '✓ On' : 'Off'}`;
      lightRepaintFn();
    });
  }
}

export function buildMenuHTML_browserSaves(main) {
  const guiFiles = main.getGui?.()._ctrlFiles ?? null;
  const saves    = guiFiles?._browserSaves ?? [];
  const pageSize = 12;
  const pageCount = Math.max(1, Math.ceil(saves.length / pageSize));
  const page = Math.max(0, Math.min(guiFiles?._browserSavePage ?? 0, pageCount - 1));
  if (guiFiles) guiFiles._browserSavePage = page;
  const pageSaves = saves.slice(page * pageSize, (page + 1) * pageSize);
  const selKey   = guiFiles?._selectedSaveKey ?? null;
  // Drop a stale selection (e.g. after a delete) so the toolbar disables again.
  const hasSel   = saves.some(s => (s.key ?? s.id ?? '') === selKey);
  const disabled = hasSel ? '' : 'disabled';

  const thumbs = saves.length === 0
    ? '<div class="mm-info">No saves yet</div>'
    : pageSaves.map(s => {
        const key   = s.key ?? s.id ?? '';
        const ts    = s.value?.timestamp ?? 0;
        const thumb = s.value?.galleryThumb ?? s.value?.thumb ?? '';
        const date  = ts ? new Date(ts).toLocaleDateString(undefined, { month:'short', day:'numeric' }) : '—';
        // The name the save was given, falling back to its key so a legacy record without one
        // still says something. Escaped: it is user-typed and goes straight into markup.
        const rawName = s.value?.name || key || 'untitled';
        const name = String(rawName).replace(/[&<>"]/g, (c) =>
          ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
        const sel   = key === selKey ? ' selected' : '';
        const img   = thumb
          ? `<img src="${thumb}" alt="save">`
          : `<div class="mm-storage-noimg">${faIcon('cube')}</div>`;
        return `
          <div class="mm-storage-item${sel}" data-save-key="${key}" title="${name}">
            ${img}
            <span class="mm-storage-meta">
              <span class="mm-storage-name">${name}</span>
              <span class="mm-storage-date">${date}</span>
            </span>
          </div>`;
      }).join('');

  // THE LIST FIRST, then the things you do to what you picked. Every control used to sit ABOVE
  // the saves -- three actions, then Save and Refresh, then pagination -- so you scrolled past
  // four rows of chrome to reach what you came for, and the buttons that act on a selection were
  // furthest from it. Saving is the one action that is not about the selection, so it stays at
  // the top where it reads as "put the current scene in here".
  return `
    <div class="mm-btn-pair">
      <button class="mm-action-btn" id="mm-browser-save">Save current scene as…</button>
      <button class="mm-action-btn" id="mm-storage-refresh">${faIcon('arrows-rotate')} Refresh</button>
    </div>
    <div class="mm-storage-wrap">
      <div class="mm-storage-list" id="mm-storage-grid">${thumbs}</div>
      <div class="mm-scrollbar-track mm-storage-sbar"><div class="mm-scrollbar-thumb"></div></div>
    </div>
    <div class="mm-storage-toolbar">
      <button class="mm-action-btn" id="mm-storage-load" ${disabled}>Open</button>
      <button class="mm-action-btn" id="mm-storage-import" ${disabled}>Import</button>
      <button class="mm-action-btn danger" id="mm-storage-delete" ${disabled}>Delete</button>
    </div>
    <div class="mm-storage-toolbar">
      <button class="mm-action-btn" id="mm-storage-prev" ${page <= 0 ? 'disabled' : ''}>Previous</button>
      <span class="mm-storage-page">${page + 1} / ${pageCount}</span>
      <button class="mm-action-btn" id="mm-storage-next" ${page >= pageCount - 1 ? 'disabled' : ''}>Next</button>
    </div>
  `;
}

export function wireMenuBrowserSaves(el, main, rebuildFn, repaintFn = rebuildFn) {
  const q = (sel) => el.querySelector(sel);
  const guiFiles = main.getGui?.()._ctrlFiles ?? null;
  const selKey = () => guiFiles?._selectedSaveKey ?? null;

  q('#mm-browser-save')?.addEventListener('click', () => {
    warnVoxelThenSave(main, () => promptSaveName('Save scene as', 'scene', (n) => {
      guiFiles?.saveToBrowserStorage?.(n);
      setTimeout(() => {
        guiFiles?.refreshBrowserSaves?.().then(() => rebuildFn());
      }, 800);
    }));
  });
  q('#mm-storage-refresh')?.addEventListener('click', () => {
    guiFiles?.refreshBrowserSaves?.().then(() => rebuildFn());
  });
  q('#mm-storage-prev')?.addEventListener('click', () => {
    if (!guiFiles || guiFiles._browserSavePage <= 0) return;
    guiFiles._browserSavePage--;
    guiFiles._selectedSaveKey = null;
    rebuildFn();
  });
  q('#mm-storage-next')?.addEventListener('click', () => {
    if (!guiFiles) return;
    const pages = Math.ceil((guiFiles._browserSaves?.length || 0) / 12);
    if (guiFiles._browserSavePage >= pages - 1) return;
    guiFiles._browserSavePage++;
    guiFiles._selectedSaveKey = null;
    rebuildFn();
  });

  // Select a save by clicking its thumbnail; the toolbar acts on the selection.
  el.querySelectorAll('.mm-storage-item').forEach(item => {
    item.addEventListener('click', () => {
      if (guiFiles) guiFiles._selectedSaveKey = item.dataset.saveKey;
      el.querySelectorAll('.mm-storage-item').forEach(card =>
        card.classList.toggle('selected', card === item));
      ['#mm-storage-load', '#mm-storage-import', '#mm-storage-delete'].forEach(sel => {
        const button = q(sel); if (button) button.disabled = false;
      });
      repaintFn?.();
    });
  });

  // Load = replace the current scene; Import = append to it.
  q('#mm-storage-load')?.addEventListener('click', () => {
    const key = selKey();
    if (key) guiFiles?.loadSpecificBrowserSave?.(key, true);
  });
  q('#mm-storage-import')?.addEventListener('click', () => {
    const key = selKey();
    if (key) guiFiles?.loadSpecificBrowserSave?.(key, false);
  });
  q('#mm-storage-delete')?.addEventListener('click', () => {
    const key = selKey();
    if (!key) return;
    guiFiles?.deleteBrowserSave?.(key);
    if (guiFiles) guiFiles._selectedSaveKey = null;
    setTimeout(() => guiFiles?.refreshBrowserSaves?.().then(() => rebuildFn()), 300);
  });
}

// Open the keyboard (VR 3D panel, or DOM overlay on desktop) to collect a save name, then
// run cb(name). Cancel → no save; the field is pre-filled so a bare confirm still saves.
function promptSaveName(label, defaultName, cb) {
  // VR → our 3D keyboard; desktop (and anywhere with a real keyboard) → native prompt.
  if (window._vrKeyboard?.shouldUse?.()) {
    // Anchor the keyboard to the main menu panel (the Files menu lives on it) so it pops
    // up in front of the panel rather than at the world origin.
    const panel = window.app?._mainMenuPanel || null;
    window._vrKeyboard.open(defaultName ?? '', { label, maxLength: 60 }, (name) => {
      const n = (name ?? '').trim();
      if (n) cb(n);
    }, null, panel);
  } else {
    const n = (window.prompt(label, defaultName ?? '') ?? '').trim();
    if (n) cb(n);
  }
}

// Voxel frame animation now persists (fields are serialized), so saving needs no warning
// or bake step — this is a straight passthrough kept only so its call sites don't change.
function warnVoxelThenSave(main, proceed) { proceed(); }

export function wireMenuFiles(el, main, rebuildFn, onBrowserSavesOpen = null) {
  const q = (sel) => el.querySelector(sel);
  const guiFiles = main.getGui?.()._ctrlFiles ?? null;

  q('#mm-exit-vr')?.addEventListener('click', () => { main._xrSession?.end(); });
  q('#mm-browser-saves')?.addEventListener('click', () => onBrowserSavesOpen?.());

  // ---- Nomad Link ----
  const link = main.getNomadLink?.();
  if (link) {
    const status = q('#mm-nomad-status');
    // Write straight to the node instead of rebuilding: a rebuild would blow away
    // the address field mid-typing.
    link.onStatus = (state, message) => { if (status) status.textContent = message; };
    link.onLog = (text) => { if (status) status.textContent = text; };

    q('#mm-nomad-connect')?.addEventListener('click', () => {
      const host = (q('#mm-nomad-host')?.value || '').trim();
      if (!host) { status.textContent = 'Enter the address shown in Nomad\'s Link menu'; return; }
      getOptionsURL.saveOption('nomadHost', host, 0); // so a refresh reconnects with one tap
      link.connect(host, undefined);
    });
    q('#mm-nomad-disconnect')?.addEventListener('click', () => link.disconnect());
    q('#mm-nomad-get-scene')?.addEventListener('click', () => {
      if (!link.requestScene()) status.textContent = 'Connect first';
    });
    q('#mm-nomad-get-selection')?.addEventListener('click', () => {
      if (!link.requestSelection()) status.textContent = 'Connect first';
    });
    q('#mm-nomad-live')?.addEventListener('change', (e) => {
      main._nomadLiveSend = e.target.checked;
      getOptionsURL.saveOption('nomadLiveSend', main._nomadLiveSend, 0);
      status.textContent = main._nomadLiveSend
        ? 'Edits will go to Nomad as you finish each stroke'
        : 'Live sending off';
    });
    q('#mm-nomad-send')?.addEventListener('click', () => {
      if (!link.isConnected()) status.textContent = 'Connect first';
      else if (!main.sendMeshToNomad()) status.textContent = 'Select a mesh to send';
    });
  }

  q('#mm-clear-scene')?.addEventListener('click', () => {
    if (!main._clearSceneConfirm) {
      main._clearSceneConfirm = true;
      rebuildFn(); // re-render button as "Confirm"
      setTimeout(() => {
        if (!main._clearSceneConfirm) return;
        main._clearSceneConfirm = false;
        rebuildFn();
      }, 3000);
    } else {
      main._clearSceneConfirm = false;
      main.clearScene?.(); main.render?.(); rebuildFn();
    }
  });

  // IMPORT: adds to the scene. Same picker, flag left clear.
  q('#mm-import-obj')?.addEventListener('click', () => {
    window._fileOpenReplace = false;
    document.getElementById('fileopen')?.click();
  });
  // OPEN: replaces it. The flag is read once by SculptGL.loadFiles, before the first file, and
  // cleared there -- so a cancelled picker cannot leave it armed for the next Import.
  q('#mm-open-scene')?.addEventListener('click', () => {
    window._fileOpenReplace = true;
    document.getElementById('fileopen')?.click();
  });
  // The same browser save the Browser Saves panel offers, reachable without going into it --
  // saving is the thing you do most often and it was two clicks deep.
  q('#mm-browser-save-quick')?.addEventListener('click', () => {
    promptSaveName('Save As', 'sculpt', (n) => guiFiles?.saveToBrowserStorage?.(n));
  });
  // No prompt: Save is the command you press without being asked anything.
  q('#mm-browser-save-over')?.addEventListener('click', () => {
    guiFiles?.saveToBrowserStorage?.(null, { overwrite: true });
  });
  q('#mm-import-scale')?.addEventListener('change', (e) => {
    main._autoMatrix = e.target.checked;
  });
  q('#mm-import-srgb')?.addEventListener('change', (e) => {
    main._vertexSRGB = e.target.checked;
  });

  q('#mm-export-all')?.addEventListener('change', (e) => {
    if (guiFiles) guiFiles._exportAll = e.target.checked;
  });
  q('#mm-export-sxr')?.addEventListener('click', () => warnVoxelThenSave(main, () => promptSaveName('Save .sxr as', 'sculpt', n => guiFiles?.saveFileAsSGL?.(n))));
  q('#mm-export-glb')?.addEventListener('click', () => promptSaveName('Save .glb as', 'sculpt', n => guiFiles?.saveFileAsGLB?.(n)));
  q('#mm-export-obj')?.addEventListener('click', () => promptSaveName('Save .obj as', 'sculpt', n => guiFiles?.saveFileAsOBJ?.(n)));
  q('#mm-export-ply')?.addEventListener('click', () => promptSaveName('Save .ply as', 'sculpt', n => guiFiles?.saveFileAsPLY?.(n)));
  q('#mm-export-stl')?.addEventListener('click', () => promptSaveName('Save .stl as', 'sculpt', n => guiFiles?.saveFileAsSTL?.(n)));
  q('#mm-export-objseq')?.addEventListener('click', () => promptSaveName('OBJ sequence name', 'anim', n => guiFiles?.saveObjSequence?.(n)));

  q('#mm-obj-zbrush')?.addEventListener('change', (e) => {
    if (guiFiles) guiFiles._objColorZbrush = e.target.checked;
  });
  q('#mm-obj-append')?.addEventListener('change', (e) => {
    if (guiFiles) guiFiles._objColorAppended = e.target.checked;
  });

  q('#mm-browser-save')?.addEventListener('click', () => {
    warnVoxelThenSave(main, () => promptSaveName('Save scene as', 'scene', (n) => {
      guiFiles?.saveToBrowserStorage?.(n);
      setTimeout(() => {
        guiFiles?.refreshBrowserSaves?.().then(() => rebuildFn());
      }, 800);
    }));
  });
  q('#mm-storage-refresh')?.addEventListener('click', () => {
    guiFiles?.refreshBrowserSaves?.().then(() => rebuildFn());
  });

  el.querySelectorAll('.mm-storage-load').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.saveKey;
      if (key) guiFiles?.loadSpecificBrowserSave?.(key);
    });
  });
  el.querySelectorAll('.mm-storage-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.saveKey;
      if (key) {
        guiFiles?.deleteBrowserSave?.(key);
        setTimeout(() => rebuildFn(), 300);
      }
    });
  });

  const texSlider = q('#mm-tex-size');
  const texVal    = q('#mm-tex-size-val');
  if (texSlider && texVal) {
    texSlider.addEventListener('input', () => {
      const v = parseInt(texSlider.value, 10);
      texVal.textContent = Math.round(Math.pow(2, v));
      guiFiles?.onTextureSize?.(v);
    });
    texVal.textContent = Math.round(Math.pow(2, texSlider.value));
    guiFiles?.onTextureSize?.(parseInt(texSlider.value, 10));
  }
  q('#mm-save-diffuse')?.addEventListener('click',   () => guiFiles?.saveTextureDiffuse?.());
  q('#mm-save-roughness')?.addEventListener('click', () => guiFiles?.saveTextureRoughness?.());
  q('#mm-save-metalness')?.addEventListener('click', () => guiFiles?.saveTextureMetalness?.());
}

export function wireMenuHistory(el, main, repaintFn) {
  const q = (sel) => el.querySelector(sel);

  q('#mm-undo')?.addEventListener('click', () => {
    main.undo?.();
    repaintFn?.();
  });
  q('#mm-redo')?.addEventListener('click', () => {
    main.redo?.();
    repaintFn?.();
  });

  const stackSlider = q('#mm-stack-size');
  const stackVal    = q('#mm-stack-val');
  if (stackSlider && stackVal) {
    stackSlider.addEventListener('input', () => {
      const v = parseInt(stackSlider.value, 10);
      stackVal.textContent = v; // live value display — no rebuild needed
      const sm = main.getStateManager?.() ?? main._stateManager;
      if (sm) sm.limit = v;
      // NOTE: do NOT call repaintFn() here. On the desktop dropdown it rebuilds the
      // whole menu (innerHTML), destroying the slider mid-drag → drag died, only the
      // initial click registered. VR re-rasters via its own slider-drag dispatch.
    });
  }

  // Native range inputs have touch-action:none (anti Pencil-scroll), which breaks
  // finger-drag on iPad → tap-only. fixSliderDrag adds the pointer-based drag the
  // other menus use. (This menu was the only one not calling it.)
  fixSliderDrag(el);
}

export function wireMenuReference(el, main, repaintFn) {
  el.querySelector('#mm-ref-add')?.addEventListener('click', () => document.getElementById('referenceopen')?.click());
  el.querySelector('#mm-ref-clear')?.addEventListener('click', () => { main.getReferenceManager?.()?.clear?.(); repaintFn?.(); });
  el.querySelector('#mm-ref-show')?.addEventListener('click', (e) => { e.currentTarget.classList.toggle('active'); repaintFn?.(); });
}

// ── Desktop topbar dropdown menus ─────────────────────────────────────────────
// These build/wire functions power the new HTML topbar introduced when yagui
// was removed.  They follow the same buildMenuHTML_* / wireMenu* pattern used
// by the VR main menu.


export function buildMenuHTML_background(main) {
  const bg   = main.getBackground?.();
  const type = bg?._type ?? 0;
  const blur = bg?._blur ?? 0;
  const fill = bg?._fill ?? false;
  return `
    <div class="mm-section-title">Type</div>
    ${buildSelectHTML('mm-bg-type', [
      { val: 0, label: 'Image' },
      { val: 1, label: 'Environment' },
      { val: 2, label: 'Ambient env' },
    ], type)}
    <div class="mm-row" id="mm-blur-row"${type!==1?' style="display:none"':''}>
      <span class="mm-lbl">Blur</span>
      <input type="range" id="mm-bg-blur" min="0" max="1" step="0.01" value="${blur}">
      <span class="mm-val" id="mm-bg-blur-val">${blur.toFixed(2)}</span>
    </div>
    <div class="mm-section-title">Image</div>
    ${/* The lone Fill toggle was costing a second line for one four-letter word. It joins the
         two actions: the sweep gives a toggle and an action the same shape, so the only thing
         that distinguishes them is the active state, which is the one that should. */ ''}
    <div class="mm-choice-grid cols-3">
      <button class="mm-action-btn" id="mm-bg-reset">Reset</button>
      <button class="mm-action-btn" id="mm-bg-import">Import…</button>
      <button class="mm-toggle${fill?' active':''}" id="mm-bg-fill">Fill</button>
    </div>
  `;
}

export function wireMenuBackground(el, main, repaintFn) {
  const q  = (sel) => el.querySelector(sel);
  const bg = main.getBackground?.();

  wireSelect(el, 'mm-bg-type', (v) => {
    const n = parseInt(v, 10);
    bg?.setType?.(n);
    main.onCanvasResize?.();
    main.render?.();
    const blurRow = q('#mm-blur-row');
    if (blurRow) blurRow.style.display = n === 1 ? '' : 'none';
  });

  wireSlider(q('#mm-bg-blur'), q('#mm-bg-blur-val'),
    (v) => { if (bg) { bg._blur = v; bg._applyBackground?.(); } main.render?.(); },
    v => v.toFixed(2));

  q('#mm-bg-reset')?.addEventListener('click',  () => { bg?.deleteTexture?.(); main.render?.(); });
  q('#mm-bg-import')?.addEventListener('click', () => document.getElementById('backgroundopen')?.click());

  q('#mm-bg-fill')?.addEventListener('click', (e) => {
    if (bg) bg._fill = !bg._fill;
    e.currentTarget.classList.toggle('active', bg?._fill ?? false);
    main.onCanvasResize?.();
  });

  fixSliderDrag(el);
}

export function buildMenuHTML_tablet(main) {
  const rf    = Tablet.radiusFactor ?? 0.75;
  const ifact = Tablet.intensityFactor ?? 0.0;
  return `
    <div class="mm-section-title">Pen Pressure</div>
    <div class="mm-row">
      <span class="mm-lbl">Radius factor</span>
      <input type="range" id="mm-tablet-radius" min="0" max="1" step="0.01" value="${rf}">
      <span class="mm-val" id="mm-tablet-radius-val">${rf.toFixed(2)}</span>
    </div>
    <div class="mm-row">
      <span class="mm-lbl">Intensity factor</span>
      <input type="range" id="mm-tablet-intensity" min="0" max="1" step="0.01" value="${ifact}">
      <span class="mm-val" id="mm-tablet-intensity-val">${ifact.toFixed(2)}</span>
    </div>
  `;
}

export function wireMenuTablet(el, main, repaintFn) {
  const q = (sel) => el.querySelector(sel);
  wireSlider(q('#mm-tablet-radius'),    q('#mm-tablet-radius-val'),
    (v) => { Tablet.radiusFactor    = v; }, v => v.toFixed(2));
  wireSlider(q('#mm-tablet-intensity'), q('#mm-tablet-intensity-val'),
    (v) => { Tablet.intensityFactor = v; }, v => v.toFixed(2));
  fixSliderDrag(el);
}

export function buildMenuHTML_desktopSettings(main) {
  const opts = getOptionsURL();

  const langs   = Object.keys(TR.languages);
  const langIdx = langs.indexOf(TR.select);

  const rf    = Tablet.radiusFactor ?? 0.75;
  const ifact = Tablet.intensityFactor ?? 0.0;

  const isIpad = /iPad/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const chk = (id, checked) => `<label class="mm-check-row"><span>${id}</span><input type="checkbox" id="mm-${id.toLowerCase().replace(/\s+/g,'-')}"${checked ? ' checked' : ''}><span class="mm-checkmark"></span></label>`;
  const ipadSection = isIpad ? `
    <div class="mm-section-title">Multitouch</div>
    ${chk('Fingers control view',  opts.ipadFingerView)}
    ${chk('Fingers sculpt',        opts.ipadFingerSculpt)}
    ${chk('Stylus controls view',  opts.ipadStylusView)}
    ${chk('Stylus sculpts',        opts.ipadStylusSculpt)}
  ` : '';

  const debugActive = !!document.getElementById('log')?.style.display && document.getElementById('log').style.display !== 'none';
  const _devChk = (id, label, on) =>
    `<label class="mm-check-row"><span>${label}</span><input type="checkbox" id="${id}"${
      on ? ' checked' : ''}><span class="mm-checkmark"></span></label>`;
  const _devAct = (id, label) => `<button class="mm-action-btn" id="${id}">${label}</button>`;
  const physSection = `
    <div class="mm-section-title">UI</div>
    ${buildDevToggles(_devChk, _devAct, 'ui')}

    <div class="mm-section-title">Physics Bones</div>
    ${buildDevToggles(_devChk, _devAct, 'other')}

    <div class="mm-section-title">Trace</div>
    ${buildDevToggles(_devChk, _devAct, 'trace')}`;

  return `${ipadSection}${physSection}
    ${buildWireframeSectionHTML(main)}
    ${/* The four platform-neutral sections, which until now existed only in the headset. */ ''}
    ${buildSharedSettingsHTML(main)}
    <div class="mm-section-title">Numeric Input</div>
    ${chk('Always show numpad', opts.alwaysNumpad)}
    <div class="mm-section-title">Pen Pressure</div>
    <div class="mm-row">
      <span class="mm-lbl">Radius factor</span>
      <input type="range" id="mm-tablet-radius" min="0" max="1" step="0.01" value="${rf}">
      <span class="mm-val" id="mm-tablet-radius-val">${rf.toFixed(2)}</span>
    </div>
    <div class="mm-row">
      <span class="mm-lbl">Intensity factor</span>
      <input type="range" id="mm-tablet-intensity" min="0" max="1" step="0.01" value="${ifact}">
      <span class="mm-val" id="mm-tablet-intensity-val">${ifact.toFixed(2)}</span>
    </div>
    ${buildAudioSectionHTML((id, label, on) =>
      `<label class="mm-check-row"><span>${label}</span><input type="checkbox" id="${id}"${
        on ? ' checked' : ''}><span class="mm-checkmark"></span></label>`)}
    <div class="mm-section-title">Advanced</div>
    <label class="mm-check-row"><span>Show debug log</span><input type="checkbox" id="mm-debug-log"${debugActive ? ' checked' : ''}><span class="mm-checkmark"></span></label>
    <label class="mm-check-row"><span>Show Eruda console</span><input type="checkbox" id="mm-eruda-console"><span class="mm-checkmark"></span></label>
    <button class="mm-action-btn" id="mm-clear-log">Clear log</button>
  `;
  // Language selector hidden: the legacy TR(key) translations only cover the old
  // yagui UI, while the current HTML panels are hardcoded English and don't consult
  // TR — so switching language did nothing. Re-enable once the UI is retrofitted
  // with TR keys (+ re-render) and the 10 language files are filled in for it.
}

export function wireMenuDesktopSettings(el, main, repaintFn) {
  const q = (sel) => el.querySelector(sel);

  // The wireframe block, same code as the VR panel. No dirty hook: this menu is live DOM rather
  // than a rasterised texture, so there is nothing to mark.
  wireWireframeSection(el, main, repaintFn);

  // ...and the four platform-neutral sections, from the same builder the VR page uses, so a
  // control cannot exist on one page and be inoperable on the other.
  // A NO-OP, NOT repaintFn. Its third argument is the slider DIRTY hook, called on every
  // `input` event -- and on desktop repaintFn is the dropdown's rebuild, which does
  // `dd.innerHTML = buildFn(...)`. That destroyed the <input> the pointer was captured on, so
  // exposure, curvature and the two grid opacities stepped once and then refused to drag.
  // matt: "settings -> exposure is steppy still." The VR mount still passes its paint, because
  // the rasteriser genuinely has to be told the texture changed; the DOM redraws itself.
  wireSharedSettings(el, main, () => {});

  const wireCheck = (id, optKey, windowKey) => {
    q(id)?.addEventListener('change', (e) => {
      window[windowKey] = e.target.checked;
      getOptionsURL.saveOption(optKey, e.target.checked);
    });
  };
  wireCheck('#mm-fingers-control-view',  'ipadFingerView',   '_ipadFingerView');
  wireCheck('#mm-fingers-sculpt',        'ipadFingerSculpt', '_ipadFingerSculpt');
  wireCheck('#mm-stylus-controls-view',  'ipadStylusView',   '_ipadStylusView');
  wireCheck('#mm-stylus-sculpts',        'ipadStylusSculpt', '_ipadStylusSculpt');
  wireCheck('#mm-always-show-numpad',    'alwaysNumpad',     '_alwaysNumpad');

  // The same list the VR panel wires, from the same place. These settings are owned by their
  // modules (PhysicsBones, PanelTrace), which persist them, rather than by a bare window write.
  wireDevToggles(q, repaintFn);

  // No dirty hook here, same as the rest of this panel: live DOM renders itself.
  wireAudioSection(q, wireSlider, repaintFn);

  wireSlider(q('#mm-tablet-radius'),    q('#mm-tablet-radius-val'),
    (v) => { Tablet.radiusFactor    = v; getOptionsURL.saveOption('tabletRadiusFactor',    v, 300); }, v => v.toFixed(2));
  wireSlider(q('#mm-tablet-intensity'), q('#mm-tablet-intensity-val'),
    (v) => { Tablet.intensityFactor = v; getOptionsURL.saveOption('tabletIntensityFactor', v, 300); }, v => v.toFixed(2));
  fixSliderDrag(el);

  q('#mm-debug-log')?.addEventListener('change', (e) => {
    const next = e.target.checked;
    window._showDebugLog = next;
    getOptionsURL.saveOption('debugMode', next);
    const log = document.getElementById('log');
    if (log) log.style.display = next ? 'block' : 'none';
    if (next && window.screenLog) window.screenLog('Debug Log Enabled', 'lime');
  });

  q('#mm-eruda-console')?.addEventListener('change', (e) => {
    const next = e.target.checked;
    if (next) {
      if (!window.eruda) {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/eruda';
        script.onload = () => { window.eruda.init(); window.eruda.show(); };
        document.head.appendChild(script);
      } else {
        window.eruda.show();
        const c = document.querySelector('.eruda-container');
        c?.shadowRoot?.querySelector('.eruda-entry-btn')?.style?.setProperty('display', 'block', 'important');
      }
    } else {
      window.eruda?.hide?.();
      const c = document.querySelector('.eruda-container');
      c?.shadowRoot?.querySelector('.eruda-entry-btn')?.style?.setProperty('display', 'none', 'important');
    }
  });

  q('#mm-clear-log')?.addEventListener('click', () => {
    const log = document.getElementById('log');
    if (log) {
      while (log.children.length > 1) log.removeChild(log.lastChild);
      if (window.screenLog) window.screenLog('Log Cleared', 'lime');
    }
  });

  wireSelect(el, 'mm-language', (v) => {
    const langs = Object.keys(TR.languages);
    TR.select = langs[parseInt(v, 10)];
    getOptionsURL.saveOption('language', TR.select);
    main.getGui?.().initGui?.();
  });
}
