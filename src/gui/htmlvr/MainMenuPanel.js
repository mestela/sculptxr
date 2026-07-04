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

import { HTMLVRPanel, VR_PANEL_PX_PER_M, setMenuColorGrade } from './HTMLVRPanel.js';
import Enums        from '../../misc/Enums.js';
import getOptionsURL from '../../misc/getOptionsURL.js';
import Shader       from '../../render/ShaderLib.js';
import Remesh       from '../../editing/Remesh.js';
import Picking      from '../../math3d/Picking.js';
import { toolTextTint } from './toolTints.js';
import { SCULPT_TOOLS, MESH_TOOLS } from './toolLists.js';
import Tablet from '../../misc/Tablet.js';
import TR from '../GuiTR.js';
import VoxelDensityOverlay from '../../render/VoxelDensityOverlay.js';
import { TAB_ICONS, ICON_PIN, ICON_DOCK } from '../tabIcons.js';
import { VERSION } from '../../Version.js';
import releaseText from '../../../docs/releases.md?raw';
import {
  injectAnimCSS,
  buildAnimationSectionHTML,
  wireAnimationSection,
  syncAnimationSection,
  refreshBlendshapesDOM,
} from './AnimationControlPanel.js';

// ── Dimensions ───────────────────────────────────────────────────────────────
export const MM_W  = 480;   // total DOM width  (px)
const MM_TABS_W    = 50;    // left tab-strip width
const MM_MENUBAR_H = 44;    // top menubar height (px) — must match actual rendered height
// Body height is fixed so the mesh never changes dimensions on tab switch.
const MM_BODY_H    = 456;   // height below menubar (scrollable content lives here)

// ── CSS ──────────────────────────────────────────────────────────────────────
const CSS = `
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
  border: 2px solid #585b70;
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
.mm-tl-btn { margin-top: auto; border-top: 1px solid #313244; }
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

.mm-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 0;
}
.mm-lbl {
  flex: 1;
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
.mm-row input[type=range] {
  flex: 1;
  accent-color: #89b4fa;
  height: 4px;
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

/* Choice grid (combobox replacement) */
.mm-choice-grid {
  display: grid;
  gap: 3px;
  margin-bottom: 6px;
}
.mm-choice-grid.cols-2 { grid-template-columns: repeat(2, 1fr); }
.mm-choice-grid.cols-3 { grid-template-columns: repeat(3, 1fr); }
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
.mm-outliner-list {
  border: 1px solid #45475a;
  border-radius: 5px;
  /* Flow at content height (single panel scroll surface). The floor used to be 248px,
     which reserved a big empty block for a 2–3 mesh scene and pushed the transform/rig
     controls off-screen — now just enough to not collapse when empty. */
  min-height: 52px;
  padding: 2px 4px;
  margin-bottom: 5px;
  box-sizing: border-box;
}
.mm-outliner-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 1px 0;
}
.mm-vis-btn {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  border: 1px solid #45475a;
  border-radius: 4px;
  background: #313244;
  color: #cdd6f4;
  font-size: 11px;
  cursor: pointer;
  outline: none;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}
.mm-vis-btn.hidden { color: #45475a; }
/* Keyframe-driven visibility: orange eye (bright = shown, dark = hidden) so it reads
   as "timeline controls this" vs a normal manual eye. */
.mm-vis-btn.keyed { color: #fab387; }
.mm-vis-btn.keyed.hidden { color: #8a4b1e; }
.mm-collapse-btn {
  width: 16px; height: 24px; flex-shrink: 0; padding: 0;
  border: none; background: none; color: #9399b2; font-size: 10px;
  cursor: pointer; outline: none;
  display: flex; align-items: center; justify-content: center;
}
.mm-collapse-btn:hover, .mm-collapse-btn.hover { color: #cdd6f4; }
.mm-collapse-spacer { width: 16px; flex-shrink: 0; display: inline-block; }
.mm-rename-btn {
  width: 24px; height: 24px; flex-shrink: 0;
  border: 1px solid #45475a; border-radius: 4px; background: #313244;
  color: #6c7086; font-size: 11px; cursor: pointer; outline: none;
  display: flex; align-items: center; justify-content: center; padding: 0;
}
.mm-rename-btn:hover, .mm-rename-btn.hover { background: #45475a; color: #cdd6f4; }
.mm-mesh-btn {
  flex: 1;
  min-width: 0;                /* allow ellipsis inside the flex row */
  display: flex;              /* override WebAwesome's centered button base */
  align-items: center;
  justify-content: flex-start;
  padding: 4px 6px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: #a6adc8;
  font-size: 11px;
  cursor: pointer;
  text-align: left;
  outline: none;
}
.mm-node-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mm-rename-input {
  flex: 1; min-width: 0;
  background: #11111b; color: #cdd6f4;
  border: 1px solid #89b4fa; border-radius: 4px;
  font-size: 11px; padding: 3px 5px; outline: none;
}
.mm-mesh-btn:hover, .mm-mesh-btn.hover { background: #313244; color: #cdd6f4; }
.mm-mesh-btn.active { color: #89b4fa; background: rgba(137,180,250,0.1); }
.mm-node-icon { display: inline-block; width: 14px; text-align: center; margin-right: 6px; color: #6c7086; }
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
.mm-storage-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 5px;
  margin-bottom: 6px;
}
.mm-storage-item {
  border: 1px solid #313244;
  border-radius: 5px;
  overflow: hidden;
  background: #181825;
  cursor: pointer;
}
.mm-storage-item.selected {
  border-color: #89b4fa;
  box-shadow: 0 0 0 1px #89b4fa inset;
}
.mm-storage-toolbar {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 5px;
  margin-bottom: 6px;
}
.mm-action-btn:disabled {
  opacity: 0.4;
  cursor: default;
}
.mm-storage-item img {
  width: 100%;
  aspect-ratio: 1;
  display: block;
  object-fit: cover;
}
.mm-storage-date {
  display: block;
  font-size: 8px;
  color: #6c7086;
  text-align: center;
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
.mm-if-pbr, .mm-if-matcap, .mm-if-uv { display: none; }
.shader-pbr    .mm-if-pbr    { display: block; }
.shader-matcap .mm-if-matcap { display: block; }
.shader-uv     .mm-if-uv     { display: block; }

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
      <button class="mm-menu-btn" data-menu="files">Files</button>
      <button class="mm-menu-btn" data-menu="history">History</button>
      <button class="mm-menu-btn" data-menu="background">Background</button>
      <button class="mm-menu-btn" data-menu="reference">Reference</button>
      <button class="mm-menu-btn" data-menu="settings">Settings</button>
      <button class="mm-menu-btn" data-menu="about">About</button>
      <div style="flex:1"></div>
      <button class="mm-pin-btn" id="mm-pin-btn" title="Pin panel in world space">${ICON_PIN}</button>
    </div>
    <div id="mm-body">
      <div id="mm-tabstrip">
        ${['scene','rendering','topology','sculpting','animation'].map((s, i) =>
          `<button class="mm-tab-btn${i === 3 ? ' active' : ''}" data-section="${s}" title="${s[0].toUpperCase() + s.slice(1)}">${TAB_ICONS[s]}</button>`
        ).join('\n        ')}
        <button class="mm-tab-btn mm-tl-btn" id="mm-bs-btn" title="Blendshapes">${TAB_ICONS.blendshapes}</button>
        <button class="mm-tab-btn mm-tl-btn" id="mm-tl-btn" title="Timeline">${TAB_ICONS.timeline}</button>
      </div>
      <div id="mm-content"></div>
      <div id="mm-sbar-track" class="mm-scrollbar-track"><div id="mm-sbar-thumb" class="mm-scrollbar-thumb"></div></div>
    </div>
  `;
}

// ── Content builders ─────────────────────────────────────────────────────────

export function buildMenuHTML_files(main) {
  const guiFiles  = main.getGui?.()._ctrlFiles ?? null;
  const exportAll = guiFiles?._exportAll ?? true;
  const objZbrush = guiFiles?._objColorZbrush ?? false;
  const objAppend = guiFiles?._objColorAppended ?? false;

  return `
    <button class="mm-action-btn" id="mm-browser-saves">Browser Saves…</button>

    <div class="mm-section-title">Import</div>
    <button class="mm-action-btn" id="mm-import-obj">Add mesh (obj, sgl, ply, stl)</button>
    <button class="mm-toggle${main._autoMatrix ? ' active' : ''}" id="mm-import-scale">Scale & center on import</button>
    <button class="mm-toggle${main._vertexSRGB ? ' active' : ''}" id="mm-import-srgb">sRGB vertex colour</button>

    <div class="mm-section-title">Save</div>
    <button class="mm-toggle${exportAll ? ' active' : ''}" id="mm-export-all">Export all meshes</button>
    <div class="mm-choice-grid cols-5">
      <button class="mm-choice" id="mm-export-sxr">sxr</button>
      <button class="mm-choice" id="mm-export-glb">glb</button>
      <button class="mm-choice" id="mm-export-obj">obj</button>
      <button class="mm-choice" id="mm-export-ply">ply</button>
      <button class="mm-choice" id="mm-export-stl">stl</button>
    </div>
    <button class="mm-toggle" id="mm-export-objseq"
      title="Export the frame-by-frame animation as a zipped per-frame OBJ sequence (anim.0000.obj …) — importable as a mesh sequence in any DCC.">Export OBJ sequence (.zip)</button>
    <div class="mm-choice-grid cols-2">
      <button class="mm-choice${objZbrush ? ' active' : ''}" id="mm-obj-zbrush">OBJ ZBrush</button>
      <button class="mm-choice${objAppend ? ' active' : ''}" id="mm-obj-append">OBJ append</button>
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

    <div class="mm-section-title">Scene</div>
    <button class="mm-action-btn danger" id="mm-clear-scene">
      ${main._clearSceneConfirm ? 'Confirm clear (no undo)' : 'Clear scene…'}
    </button>

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
      <button class="mm-action-btn" id="mm-undo"${uC ? '' : ' disabled'}><i class="fa-solid fa-rotate-left"></i> Undo${uC ? ` (${uC})` : ''}</button>
      <button class="mm-action-btn" id="mm-redo"${rC ? '' : ' disabled'}><i class="fa-solid fa-rotate-right"></i> Redo${rC ? ` (${rC})` : ''}</button>
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

function buildMenuHTML_settings(main) {
  const gx  = main._guiXR ?? main.getGuiXR?.();
  const ui  = gx?._uiSettings ?? {};
  const opts = getOptionsURL();

  const triggerCurve  = ui.triggerCurve    ?? opts.triggerCurve    ?? 0.5;
  const stylusLength  = ui.stylusLength    ?? opts.stylusLength    ?? 0.10;
  const stylusOffset  = ui.stylusOffset    ?? opts.stylusOffset    ?? 0.0;
  const stylusTilt    = ui.stylusTilt      ?? opts.stylusTilt      ?? 0;
  const gizmoScale    = opts.gizmoScale    ?? 15.625;
  const offsetY       = ui.offsetY         ?? opts.offsetY         ?? -1.2;
  const wfBias        = ui.wireframeBias   ?? opts.wireframeBias   ?? 0.001;
  const wfAlpha       = ui.wireframeAlpha  ?? opts.wireframeAlpha  ?? 0.2;
  const menuBright    = ui.menuBrightness  ?? 0.65;
  const menuSat       = ui.menuSaturation  ?? 0.50;
  const menuGamma     = ui.menuGamma       ?? 0.0;
  const debugMode     = ui.debugMode       ?? false;

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

  const wfTypes = [
    { id: 1, label: 'Smooth' },
    { id: 0, label: 'Fast'   },
    { id: 2, label: 'Full'   },
  ];
  const curWfType = main.getMesh?.()?.getWireframeType?.() ?? 1;

  const wfTypeBtns = wfTypes.map(t =>
    `<button class="mm-choice${curWfType === t.id ? ' active' : ''}" data-wf-type="${t.id}">${t.label}</button>`
  ).join('');

  return `
    <button class="mm-action-btn" id="mm-show-ctrl-guide">Show Controller Guide</button>
    <div class="mm-section-title">Input</div>
    <button class="mm-toggle${isLeft    ? ' active' : ''}" id="mm-left-hand">Left Hand Mode</button>
    <button class="mm-toggle${isRaycast ? ' active' : ''}" id="mm-raycast">Aim Picking (Raycast)</button>
    <button class="mm-toggle${isAmbi    ? ' active' : ''}" id="mm-ambi">Ambidextrous Cursors</button>

    <div class="mm-row">
      <span class="mm-lbl">Trigger sensitivity</span>
      <input type="range" id="mm-trigger" min="0" max="100" step="5" value="${Math.round(triggerCurve*100)}">
      <span class="mm-val" id="mm-trigger-val">${Math.round(triggerCurve*100)}%</span>
    </div>

    <div class="mm-section-title">Stylus</div>
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
      <span class="mm-lbl">Gizmo scale</span>
      <input type="range" id="mm-gizmo-scale" min="5" max="100" step="1" value="${Math.round(gizmoScale)}">
      <span class="mm-val" id="mm-gizmo-val">${Math.round(gizmoScale)}</span>
    </div>

    <div class="mm-section-title">Calibration</div>
    <div class="mm-row">
      <span class="mm-lbl">Head height</span>
      <input type="range" id="mm-head-height" min="-200" max="0" step="10" value="${Math.round(offsetY*100)}">
      <span class="mm-val" id="mm-head-height-val">${offsetY.toFixed(1)}</span>
    </div>

    <div class="mm-section-title">Controller Model</div>
    ${buildSelectHTML('mm-ctrl-model', ctrlModels.map((m, i) => ({ val: i, label: ctrlLabels[i] })), curCtrl)}

    <div class="mm-section-title">Wireframe</div>
    <div class="mm-row">
      <span class="mm-lbl">Bias</span>
      <input type="range" id="mm-wf-bias" min="0" max="50" step="1" value="${Math.round(wfBias*10000)}">
      <span class="mm-val" id="mm-wf-bias-val">${wfBias.toFixed(4)}</span>
    </div>
    <div class="mm-row">
      <span class="mm-lbl">Opacity</span>
      <input type="range" id="mm-wf-alpha" min="0" max="100" step="5" value="${Math.round(wfAlpha*100)}">
      <span class="mm-val" id="mm-wf-alpha-val">${Math.round(wfAlpha*100)}%</span>
    </div>
    <div class="mm-choice-grid cols-3">${wfTypeBtns}</div>

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

    <div class="mm-section-title">Blendshapes</div>
    <button class="mm-action-btn" id="mm-bs-backup">Backup Shapes</button>
    <button class="mm-action-btn" id="mm-bs-restore">Restore Shapes</button>

    <div class="mm-section-title">Debug</div>
    <button class="mm-toggle${debugMode ? ' active' : ''}" id="mm-debug-mode">Debug Mode (HUD Logs)</button>
    <button class="mm-action-btn" id="mm-perf-profile">Log Perf Profile (120f)</button>
  `;
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
    // During a pending pick, rows read as targets (and the subject can't pick itself).
    const isSubject = pendingMode && m.getID() === main._rigPendingSubject;
    const pickCls = pendingMode ? (isSubject ? ' rig-subject' : ' rig-target') : '';
    // Indent the NAME (not the row) so the vis-eye column stays vertically aligned.
    return `
      <div class="mm-outliner-row${pickCls}">
        <button class="mm-vis-btn${vis ? '' : ' hidden'}${hasVisKeys ? ' keyed' : ''}" data-mesh-id="${m._permanentStaticId}" data-action="vis" title="${hasVisKeys ? 'Visibility is keyframe-driven (timeline controls it)' : 'Toggle visibility'}">
          <i class="fa-solid ${vis ? 'fa-eye' : 'fa-eye-slash'}"${hasVisKeys ? ` style="color:${vis ? '#fab387' : '#8a4b1e'}"` : ''}></i>
        </button>
        ${hasKids
          ? `<button class="mm-collapse-btn" data-mesh-id="${m._permanentStaticId}" data-action="collapse" style="margin-left:${depth * 14}px" title="${collapsed ? 'Expand' : 'Collapse'}"><i class="fa-solid ${collapsed ? 'fa-chevron-right' : 'fa-chevron-down'}"></i></button>`
          : `<span class="mm-collapse-spacer" style="margin-left:${depth * 14}px"></span>`}
        <button class="mm-mesh-btn${isSel ? ' active' : ''}${isNull ? ' is-null' : ''}" data-mesh-id="${m._permanentStaticId}" data-action="select" title="Rename with the pencil, or double-click">
          <i class="fa-solid ${typeIcon} mm-node-icon"></i><span class="mm-node-name">${m._permanentStaticLabel}</span>${main.isLinked?.(m) ? '<i class="fa-solid fa-link" style="margin-left:5px;font-size:10px;color:#89dceb" title="Linked instance — shares geometry; edits affect all occurrences"></i>' : ''}
        </button>
        <button class="mm-rename-btn" data-mesh-id="${m._permanentStaticId}" data-action="rename" title="Rename">
          <i class="fa-solid fa-pen"></i>
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

    const trs = main.getTransformTRS?.(selId) || { t: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] };
    const _f = (n) => (Math.round(n * 1000) / 1000);
    // Per-row bake button (freezes that component into the geometry, right next to its values).
    const _bake = { t: ['mm-bake-t', 'Bake translation into geometry (position → 0)'],
                    r: ['mm-bake-r', 'Bake rotation into geometry (rotation → 0; may misalign symmetry)'],
                    s: ['mm-bake-s', 'Bake scale into geometry (scale → 1)'] };
    const _xfRow = (type, label, vals, step) => `
      <div class="mm-xform-row">
        <span class="mm-xf-lbl">${label}</span>
        <input type="number" class="mm-xf" data-xf="${type}" data-axis="0" step="${step}" value="${_f(vals[0])}">
        <input type="number" class="mm-xf" data-xf="${type}" data-axis="1" step="${step}" value="${_f(vals[1])}">
        <input type="number" class="mm-xf" data-xf="${type}" data-axis="2" step="${step}" value="${_f(vals[2])}">
        <button class="mm-xf-bake" id="${_bake[type][0]}" title="${_bake[type][1]}"><i class="fa-solid fa-cake-candles"></i></button>
      </div>`;
    rigHTML = `
      ${_xfRow('t', 'Pos', trs.t, '0.01')}
      ${_xfRow('r', 'Rot', trs.r, '1')}
      ${_xfRow('s', 'Scale', trs.s, '0.01')}

      <div class="mm-rig-btn-row">
        <button class="mm-toggle${pendingMode === 'parent' ? ' active' : ''}" data-rig="set-parent">
          ${pendingMode === 'parent' ? 'Select parent…' : 'Set parent…'}
        </button>
        <button class="mm-toggle${pendingMode === 'lookat' ? ' active' : ''}" data-rig="set-aim">
          ${pendingMode === 'lookat' ? 'Select aim…' : 'Aim at…'}
        </button>
        <button class="mm-toggle${mirrored ? ' active' : ''}" data-rig="mirror" title="Mirror across X (eye rig)">Mirror X</button>
      </div>
      ${parent ? `<button class="mm-action-btn" data-rig="clear-parent">Clear parent</button>` : ''}
      ${lookTgt ? `<button class="mm-action-btn" data-rig="clear-aim">Clear aim</button>` : ''}

      <button class="mm-toggle${saccading ? ' active' : ''}" data-rig="saccades">Saccades</button>
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
    `;
  }

  const hasSel = selected.length > 0;
  // Lock lives in the toolbar (padlock) and acts on the single selected mesh.
  const singleSel = selected.length === 1 ? selected[0] : null;
  const tbLocked  = singleSel ? !!main.isSelectLocked?.(singleSel.getID()) : false;
  return `
    <div class="mm-section-title">Outliner</div>
    <div class="mm-toolbar">
      <button class="mm-tool-btn" id="mm-duplicate" title="Duplicate selected (independent copy)"${hasSel ? '' : ' disabled'}><i class="fa-solid fa-copy"></i></button>
      <button class="mm-tool-btn" id="mm-instance" title="Instance selected (linked — shares geometry, edits affect all)"${hasSel ? '' : ' disabled'}><i class="fa-solid fa-link"></i></button>
      <button class="mm-tool-btn" id="mm-make-unique" title="Make unique (break the link — private copy)"${(singleSel && main.isLinked?.(singleSel)) ? '' : ' disabled'}><i class="fa-solid fa-link-slash"></i></button>
      <button class="mm-tool-btn" id="mm-delete-mesh" title="Delete selected"${hasSel ? '' : ' disabled'}><i class="fa-solid fa-trash"></i></button>
      <button class="mm-tool-btn${tbLocked ? ' active' : ''}" data-rig="lock" title="Lock — unselectable in the viewport when on"${singleSel ? '' : ' disabled'}><i class="fa-solid ${tbLocked ? 'fa-lock' : 'fa-lock-open'}"></i></button>
    </div>
    <div class="mm-outliner-list">${meshRows}</div>
    ${rigHTML}
    <div class="mm-add-row">
      <button class="mm-action-btn" id="mm-add-cube">Cube</button>
      <button class="mm-action-btn" id="mm-add-sphere">Sphere</button>
      <button class="mm-action-btn" id="mm-add-null">Null</button>
      <button class="mm-action-btn" id="mm-add-voxel" title="Spawn an empty voxel object and switch to the Voxel tool">Voxel</button>
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

  let multiInfo = isMulti
    ? `<div class="mm-info">Level ${curLvl} of ${numLvl - 1} — ${mesh.getNbVertices?.()?.toLocaleString() ?? '?'} vertices</div>`
    : '';

  return `
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

    <div class="mm-section-title">Mesh Health</div>
    <button class="mm-action-btn" id="mm-validate">Validate Manifold</button>
    <button class="mm-toggle" id="mm-auto-heal">Auto heal on remesh</button>
  `;
}

export function buildSectionHTML_rendering(main) {
  const mesh = main.getMesh?.();
  if (!mesh) return '<div class="mm-info">No mesh selected</div>';

  const ShaderPBR    = Shader[Enums.Shader.PBR];
  const ShaderMATCAP = Shader[Enums.Shader.MATCAP];
  const shaderType   = mesh.getShaderType?.() ?? Enums.Shader.PBR;

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
  const curvature   = mesh.getCurvature?.() ?? 0;
  const opacity     = mesh.getOpacity?.() ?? 1;
  const isFlat      = mesh.getFlatShading?.() ?? false;
  const isWire      = mesh.getShowWireframe?.() ?? false;
  const isSolid     = mesh._renderData?._threeMesh?.material?.visible ?? true;

  const gx       = main._guiXR ?? main.getGuiXR?.();
  const uiS      = gx?._uiSettings ?? {};
  const opts     = getOptionsURL;
  const wfBias   = uiS.wireframeBias  ?? opts.wireframeBias  ?? 0.001;
  const wfAlpha  = uiS.wireframeAlpha ?? opts.wireframeAlpha ?? 0.2;

  // PBR — environment list
  const envBtns = (ShaderPBR?.environments ?? []).map((env, i) =>
    `<button class="mm-choice${ShaderPBR.idEnv === i ? ' active' : ''}" data-env="${i}">${env.name}</button>`
  ).join('');

  // Matcap list
  const matcapBtns = (ShaderMATCAP?.matcaps ?? []).map((m, i) =>
    `<button class="mm-choice${mesh.getMatcap?.() === i ? ' active' : ''}" data-matcap="${i}">${m.name}</button>`
  ).join('');

  // Shader-class on the root div drives .mm-if-pbr / .mm-if-matcap / .mm-if-uv visibility
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

  return `
    <div id="mm-render-root" class="${shaderClass}">
      <div class="mm-section-title">Shader</div>
      <div class="mm-choice-grid cols-5">${shaderBtns}</div>

      <div class="mm-if-pbr">
        <div class="mm-section-title">Environment</div>
        <div class="mm-choice-grid cols-2" id="mm-env-grid">${envBtns}</div>
      </div>

      <div class="mm-if-matcap">
        <div class="mm-section-title">Matcap</div>
        <div class="mm-choice-grid cols-2" id="mm-matcap-grid">${matcapBtns}</div>
        <button class="mm-action-btn" id="mm-import-matcap">Import matcap…</button>
      </div>

      <div class="mm-if-uv">
        <div class="mm-section-title">Texture</div>
        <button class="mm-action-btn" id="mm-import-uv">Import UV texture…</button>
      </div>

      <div class="mm-section-title">Display</div>
      <button class="mm-toggle${main._showGrid ? ' active' : ''}" id="mm-grid-toggle">Ground Plane</button>
      <div class="mm-row">
        <span class="mm-lbl">Curvature</span>
        <input type="range" id="mm-curvature" min="0" max="100" step="1" value="${Math.round(curvature * 20)}">
        <span class="mm-val" id="mm-curvature-val">${Math.round(curvature * 20)}</span>
      </div>
      <div class="mm-row">
        <span class="mm-lbl">Transparency</span>
        <input type="range" id="mm-transparency" min="0" max="100" step="1" value="${Math.round((1-opacity)*100)}">
        <span class="mm-val" id="mm-transparency-val">${Math.round((1-opacity)*100)}%</span>
      </div>
      <button class="mm-toggle${isFlat  ? ' active' : ''}" id="mm-flat-shading">Flat Shading</button>
      <button class="mm-toggle${isWire  ? ' active' : ''}" id="mm-wireframe">Wireframe</button>
      <div class="mm-row">
        <span class="mm-lbl">WF Opacity</span>
        <input type="range" id="mm-render-wf-alpha" min="0" max="100" step="5" value="${Math.round(wfAlpha*100)}">
        <span class="mm-val" id="mm-render-wf-alpha-val">${Math.round(wfAlpha*100)}%</span>
      </div>
      <div class="mm-row">
        <span class="mm-lbl">WF Offset</span>
        <input type="range" id="mm-render-wf-bias" min="0" max="50" step="1" value="${Math.round(wfBias*10000)}">
        <span class="mm-val" id="mm-render-wf-bias-val">${wfBias.toFixed(4)}</span>
      </div>
      <button class="mm-toggle${isSolid ? ' active' : ''}" id="mm-solid">Solid Shading</button>

      <div class="mm-section-title">Tone Mapping</div>
      <div class="mm-choice-grid cols-5">${tmBtns}</div>

      <div class="mm-row">
        <span class="mm-lbl">Exposure</span>
        <input type="range" id="mm-exposure" min="0" max="300" step="5" value="${Math.round(exposure*100)}">
        <span class="mm-val" id="mm-exposure-val">${exposure.toFixed(2)}</span>
      </div>

      <div class="mm-section-title">Camera Reset</div>
      <div class="mm-btn-pair">
        <button class="mm-action-btn" id="mm-cam-center">Center</button>
        <button class="mm-action-btn" id="mm-cam-front">Front</button>
      </div>
      <div class="mm-btn-pair">
        <button class="mm-action-btn" id="mm-cam-left">Left</button>
        <button class="mm-action-btn" id="mm-cam-top">Top</button>
      </div>

      <div class="mm-section-title">Projection</div>
      ${buildSelectHTML('mm-cam-proj', [
        { val: 0, label: 'Perspective' },
        { val: 1, label: 'Orthographic' },
      ], proj)}
      <div class="mm-row" id="mm-fov-row"${proj!==0?' style="display:none"':''}>
        <span class="mm-lbl">FOV</span>
        <input type="range" id="mm-cam-fov" min="10" max="90" step="1" value="${fov}">
        <span class="mm-val" id="mm-cam-fov-val">${Math.round(fov)}°</span>
      </div>

      <div class="mm-section-title">Camera Mode</div>
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

      <div class="mm-section-title">Desktop Canvas (VR)</div>
      ${buildSelectHTML('mm-spectator-mode', [
        { val: 0, label: 'Blank (VR active)' },
        { val: 1, label: 'Mirror (headset)' },
        { val: 2, label: 'Desktop free camera' },
        { val: 3, label: 'Spectator (coupled)' },
      ], vmode)}

      <div class="mm-section-title">Spectator FPS</div>
      ${buildSelectHTML('mm-spectator-fps', [
        { val: 0, label: 'Full rate' },
        { val: 1, label: '½ rate' },
        { val: 2, label: '¼ rate (default)' },
        { val: 3, label: '⅛ rate' },
      ], fps)}
    </div>
  `;
}

// Tool definitions mirrored from BrushPanel — single source of truth kept here
// so the Sculpting tab and the BrushPanel grid stay in sync.
// Helper: encode a 0-1 rgb vec3 component as two hex digits.
const _toHex2 = v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');

export function buildSectionHTML_sculpting(main) {
  const sm  = main.getSculptManager?.() ?? main._sculptManager;
  const cur = sm?.getToolIndex?.() ?? -1;
  const tool = sm?.getCurrentTool?.();
  const symOn  = sm?._symmetry ?? false;
  const contOn = sm?._continuous ?? false;

  const sculptBtns = SCULPT_TOOLS.map(t =>
    `<button class="mm-choice${cur === t.id ? ' active' : ''}" data-tool-id="${t.id}" style="color:${toolTextTint(t.id)}">${t.label}</button>`
  ).join('');
  const meshBtns = MESH_TOOLS.map(t =>
    `<button class="mm-choice${cur === t.id ? ' active' : ''}" data-tool-id="${t.id}" style="color:${toolTextTint(t.id)}">${t.label}</button>`
  ).join('');

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
    const isMove           = cur === Enums.Tools.MOVE;
    const isSmooth         = cur === Enums.Tools.SMOOTH;
    const isVoxel          = cur === Enums.Tools.VOXEL;
    const isExtrudeOrInset = cur === Enums.Tools.EXTRUDE || cur === Enums.Tools.INSET;
    const hasNegative   = tool._negative   !== undefined;
    const hasClay       = tool._clay       !== undefined;
    const hasAccumulate = tool._accumulate !== undefined;
    const hasCulling    = tool._culling    !== undefined;
    const hasTopoCheck  = tool._topoCheck  !== undefined;
    const hasTangent    = tool._tangent    !== undefined;

    // Voxel uses its own mode grid (Add/Sub/Inflate/Deflate) instead of the generic
    // negative/clay/etc. toggles, so suppress those here.
    if (!isVoxel && (hasNegative || hasClay || hasAccumulate || hasCulling || hasTopoCheck || hasTangent)) {
      const toggles = [];
      if (hasNegative) {
        // Masking: flip label/active so button means "Erase existing mask"
        // Move: label as "Along Normal"
        const negLabel  = isMasking ? 'Erase' : isMove ? 'Along Normal' : 'Negative';
        const negActive = isMasking ? !tool._negative : tool._negative;
        toggles.push(`<button class="mm-choice${negActive ? ' active' : ''}" id="mm-brush-negative">${negLabel}</button>`);
      }
      if (hasClay)       toggles.push(`<button class="mm-choice${tool._clay       ? ' active' : ''}" id="mm-brush-clay"    >Clay      </button>`);
      if (hasAccumulate) toggles.push(`<button class="mm-choice${tool._accumulate ? ' active' : ''}" id="mm-brush-accum"   >Accumulate</button>`);
      if (hasCulling)    toggles.push(`<button class="mm-choice${tool._culling    ? ' active' : ''}" id="mm-brush-culling" >Culling   </button>`);
      if (hasTopoCheck)  toggles.push(`<button class="mm-choice${tool._topoCheck  ? ' active' : ''}" id="mm-brush-topo"    >Topo Check</button>`);
      if (hasTangent)    toggles.push(`<button class="mm-choice${tool._tangent    ? ' active' : ''}" id="mm-brush-tangent" >Tangential</button>`);
      const cols = toggles.length <= 2 ? 'cols-2' : 'cols-3';
      brushHTML += `<div class="mm-choice-grid ${cols}" style="margin-top:4px">${toggles.join('')}</div>`;
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
      const modeBtns = modes.map(m =>
        `<button class="mm-choice${isActiveMode(m) ? ' active' : ''}" data-voxel-mode="${m.mode}" data-voxel-neg="${m.neg}">${m.label}</button>`
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
      brushHTML += `
        <div class="mm-section-title">Alpha</div>
        ${buildSelectHTML('mm-alpha-select', alphaNames.map(n => ({ val: n, label: n })), currentAlpha)}
        <button class="mm-action-btn" id="mm-alpha-import" style="margin-top:3px">Import alpha…</button>`;
    }

    // ── Paint-specific controls ──────────────────────────────────────
    if (cur === Enums.Tools.PAINT && tool._color) {
      const hexColor  = '#' + _toHex2(tool._color[0]) + _toHex2(tool._color[1]) + _toHex2(tool._color[2]);
      const roughness = Math.round((tool._material?.[0] ?? 0.5) * 100);
      const metallic  = Math.round((tool._material?.[1] ?? 0.0) * 100);
      brushHTML += `
        <div class="mm-section-title">Paint</div>
        <div class="mm-row">
          <span class="mm-lbl">Color</span>
          <input type="color" id="mm-paint-color" value="${hexColor}"
            style="width:44px;height:22px;padding:1px 2px;border:1px solid #45475a;border-radius:4px;background:#313244;cursor:pointer;flex-shrink:0">
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
    <div class="mm-section-title">Sculpt</div>
    <div class="mm-choice-grid cols-3">${sculptBtns}</div>
    <div class="mm-section-title">Mesh Edit</div>
    <div class="mm-choice-grid cols-3">${meshBtns}</div>
    ${brushHTML}
    <div class="mm-section-title">Symmetry</div>
    <button class="mm-toggle${symOn ? ' active' : ''}" id="mm-sym-toggle">
      Mirror Symmetry ${symOn ? '✓ On' : 'Off'}
    </button>
    <div class="mm-row" style="gap:6px">
      <button class="mm-action-btn" id="mm-sym-lr" style="flex:1">Symmetrize L→R</button>
      <button class="mm-action-btn" id="mm-sym-rl" style="flex:1">Symmetrize R→L</button>
    </div>
    <button class="mm-toggle${contOn ? ' active' : ''}" id="mm-continuous" style="margin-top:4px">
      Continuous ${contOn ? '✓ On' : 'Off'}
    </button>
  `;
}

export function buildSectionHTML_animation() {
  return buildAnimationSectionHTML();
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

    const root = document.createElement('div');
    root.id = 'mm-root';
    // Inline width AND height so they survive SVG foreignObject serialisation.
    // With all children position:absolute they don't contribute to the parent's
    // auto-height, so without the inline height Ee() would capture 0px.
    root.style.width  = MM_W + 'px';
    // border-box total = content (MM_MENUBAR_H + MM_BODY_H) + 2×border (2px each)
    root.style.height = (MM_MENUBAR_H + MM_BODY_H + 4) + 'px';  // = 504px
    root.innerHTML = buildShellHTML();

    super(root, MM_W / VR_PANEL_PX_PER_M);

    this._main           = main;
    this._activeMenu    = null;     // null | 'files'|'history'|'reference'|'settings'|'about'
    this._activeSection = 'sculpting'; // 'scene'|'topology'|'rendering'|'sculpting'
    this._lastContentKey = '';      // avoids redundant rebuilds
    this._startHidden   = true;
    this._pinned        = false;
    this._tornOffSections = new Set(); // sections currently floating as TornOffPanels

    this.init(scene, camera, renderer);
    this._waitForMeshThenWire(main);
  }

  get pinned() { return this._pinned; }

  /** Called by Scene.js when a section has been torn off into a floating panel. */
  notifyTearOff(sectionId) {
    this._tornOffSections.add(sectionId);
    // If the torn-off section is currently active, switch to the first available one.
    if (this._activeSection === sectionId) {
      const sections = ['scene', 'rendering', 'topology', 'sculpting', 'animation'];
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

  // ── Mesh placement ─────────────────────────────────────────────────────────

  _onMeshCreated() {
    if (!this.mesh) return;
    // Wrist-relative offset — matches the BrushPanel convention so it sits
    // flat on the non-dominant palm when parented to the controller grip.
    // Scene.js re-parents this mesh to uiGrip every frame in VR.
    this.mesh.position.set(0.10, 0.10, -0.05);
    this.mesh.rotation.set(-Math.PI / 2, 0, 0);
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
    const shaderType = mesh?.getShaderType?.() ?? -1;
    const meshCount  = this._main.getMeshes?.()?.length ?? 0;
    const sm = this._main.getSculptManager?.() ?? this._main._sculptManager;
    const curTool = sm?.getToolIndex?.() ?? -1;
    const symOn  = sm?._symmetry  ? 1 : 0;
    const contOn = sm?._continuous ? 1 : 0;
    const guiFiles    = this._main.getGui?.()._ctrlFiles ?? null;
    const savesCount  = guiFiles?._browserSaves?.length ?? 0;
    const key = this._activeMenu
      ? `menu:${this._activeMenu}:${savesCount}`
      : `sec:${this._activeSection}:${shaderType}:${meshCount}:${curTool}:${symOn}:${contOn}`;

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
        case 'settings':   html = buildMenuHTML_settings(main);  break;
        case 'about':      html = buildMenuHTML_about();         break;
      }
    } else {
      switch (this._activeSection) {
        case 'scene':     html = buildSectionHTML_scene(main);     break;
        case 'topology':  html = buildSectionHTML_topology(main);  break;
        case 'rendering': html = buildSectionHTML_rendering(main); break;
        case 'sculpting': html = buildSectionHTML_sculpting(main); break;
        case 'animation': html = buildSectionHTML_animation();     break;
      }
      const SECTION_LABELS = { scene: 'Scene', rendering: 'Rendering', topology: 'Topology', sculpting: 'Sculpting', animation: 'Animation' };
      const label = SECTION_LABELS[this._activeSection] ?? this._activeSection;
      const pinSVG = ICON_PIN;
      html = `<div class="mm-section-header"><span class="mm-section-header-title">${label}</span><button class="mm-section-pin-btn" id="mm-section-pin-btn" title="Float panel">${pinSVG}</button></div>` + html;
    }

    contentEl.innerHTML = html;

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

    this._wireContent();

    // Sync custom scrollbar thumb after content changes
    refreshVRScrollbar(this._element.querySelector('#mm-content'), this._element.querySelector('#mm-sbar-thumb'));

    this.markDirty();
  }

  // ── Event wiring for dynamic content ──────────────────────────────────────

  _wireContent() {
    const main = this._main;
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
      wireMenuFiles(el, main, paint, () => {
        this._setMenu('browser-saves');
      });
    } else if (menu === 'browser-saves') {
      wireMenuBrowserSaves(el, main, () => { this._lastContentKey = ''; paint(); });
      q('#mm-back-to-files')?.addEventListener('click', () => this._setMenu('files'));

    } else if (menu === 'history') {
      wireMenuHistory(el, main, paint);
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
    const gx   = main._guiXR ?? main.getGuiXR?.();
    const ui   = gx?._uiSettings ?? {};
    const opts = getOptionsURL;
    const paint = () => this.markDirty();

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
    q('#mm-ambi')?.addEventListener('click', () => {
      main._vrAmbidextrousCursors = !main._vrAmbidextrousCursors;
      opts.saveOption('ambidextrousCursors', main._vrAmbidextrousCursors);
      q('#mm-ambi')?.classList.toggle('active', main._vrAmbidextrousCursors);
      paint();
    });

    // Trigger sensitivity
    this._wireSlider(q('#mm-trigger'), q('#mm-trigger-val'), (v) => {
      const f = v / 100;
      if (ui) ui.triggerCurve = f;
      opts.saveOption('triggerCurve', f, 500);
    }, (v) => `${v}%`);

    // Stylus
    this._wireSlider(q('#mm-stylus-len'), q('#mm-stylus-len-val'), (v) => {
      const f = v / 100;
      if (ui) ui.stylusLength = f;
      main.updateStylusLength?.(f);
      opts.saveOption('stylusLength', f, 500);
    });
    this._wireSlider(q('#mm-stylus-off'), q('#mm-stylus-off-val'), (v) => {
      const f = v / 100;
      if (ui) ui.stylusOffset = f;
      main.updateStylusOffset?.(f);
      opts.saveOption('stylusOffset', f, 500);
    });
    this._wireSlider(q('#mm-stylus-tilt'), q('#mm-stylus-tilt-val'), (v) => {
      if (ui) ui.stylusTilt = v;
      main.updateStylusTilt?.(v);
      opts.saveOption('stylusTilt', v, 500);
    }, (v) => `${v}°`);
    this._wireSlider(q('#mm-gizmo-scale'), q('#mm-gizmo-val'), (v) => {
      opts.saveOption('gizmoScale', v, 500);
      const sc = main.getSculptManager?.();
      if (sc) {
        const t = sc.getTool?.(Enums.Tools.TRANSFORM_VR);
        if (t?._gizmo) { t._gizmo._resize(v); t._gizmo._lastScale = v; }
      }
      main.render?.();
    });

    // Calibration
    this._wireSlider(q('#mm-head-height'), q('#mm-head-height-val'), (v) => {
      const f = v / 100;
      if (ui) ui.offsetY = f;
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

    // Wireframe
    this._wireSlider(q('#mm-wf-bias'), q('#mm-wf-bias-val'), (v) => {
      const f = v / 10000;
      if (ui) ui.wireframeBias = f;
      const wm = main.getMesh?.()?.getRenderData?.()._wireframeMesh;
      if (wm?.material?.uniforms) wm.material.uniforms.uBias.value = f;
      opts.saveOption('wireframeBias', f, 500);
    }, (v) => (v / 10000).toFixed(4));
    this._wireSlider(q('#mm-wf-alpha'), q('#mm-wf-alpha-val'), (v) => {
      const f = v / 100;
      if (ui) ui.wireframeAlpha = f;
      const wm = main.getMesh?.()?.getRenderData?.()._wireframeMesh;
      if (wm?.material?.uniforms) wm.material.uniforms.uOpacity.value = f;
      opts.saveOption('wireframeAlpha', f, 500);
    }, (v) => `${v}%`);

    el.querySelectorAll('[data-wf-type]').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = parseInt(btn.dataset.wfType, 10);
        main.getMesh()?.setWireframeType?.(t);
        opts.saveOption('wireframeType', t);
        main.render?.();
        el.querySelectorAll('[data-wf-type]').forEach(b => b.classList.toggle('active', b === btn));
        paint();
      });
    });

    // Menu brightness/saturation
    this._wireSlider(q('#mm-menu-bright'), q('#mm-menu-bright-val'), (v) => {
      const f = v / 100;
      if (ui) ui.menuBrightness = f;
      opts.saveOption('menuBrightness', f, 500);
      setMenuColorGrade(f, ui?.menuSaturation ?? 0.5, ui?.menuGamma ?? 0.5);
    }, (v) => `${v}%`);
    this._wireSlider(q('#mm-menu-sat'), q('#mm-menu-sat-val'), (v) => {
      const f = v / 100;
      if (ui) ui.menuSaturation = f;
      opts.saveOption('menuSaturation', f, 500);
      setMenuColorGrade(ui?.menuBrightness ?? 0.5, f, ui?.menuGamma ?? 0.5);
    }, (v) => `${v}%`);
    this._wireSlider(q('#mm-menu-gamma'), q('#mm-menu-gamma-val'), (v) => {
      const f = v / 100;
      if (ui) ui.menuGamma = f;
      opts.saveOption('menuGamma', f, 500);
      setMenuColorGrade(ui?.menuBrightness ?? 0.5, ui?.menuSaturation ?? 0.5, f);
    }, (v) => `${v}%`);

    // Debug
    q('#mm-debug-mode')?.addEventListener('click', () => {
      if (ui) ui.debugMode = !ui.debugMode;
      opts.saveOption('debugMode', ui.debugMode ?? false);
      q('#mm-debug-mode')?.classList.toggle('active', ui.debugMode ?? false);
      paint();
    });
    q('#mm-perf-profile')?.addEventListener('click', () => window.debugProfile?.(120));

    // Blendshape safety net — snapshot/restore all layer deltas + base (undo-
    // independent). Console helpers aren't reachable in standalone VR, so surface
    // them here. screenLog gives on-device confirmation.
    q('#mm-bs-backup')?.addEventListener('click', () => {
      window.bsBackup?.();
      window.screenLog?.('Blendshapes backed up', 'lime');
    });
    q('#mm-bs-restore')?.addEventListener('click', () => {
      window.bsRestore?.();
      window.screenLog?.('Blendshapes restored from backup', 'cyan');
    });
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
    } else if (section === 'rendering') {
      wireSectionRendering(el, main, fullRepaint, lightRepaint, lightRepaint);
    } else if (section === 'sculpting') {
      wireSectionSculpting(el, main, fullRepaint, lightRepaint, lightRepaint);
    } else if (section === 'animation') {
      this._wireSectionAnimation(el, lightRepaint);
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
export function refreshVRScrollbar(scrollEl, thumbEl) {
  if (!scrollEl || !thumbEl) return;
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
  document.querySelectorAll('[data-action="vis"]').forEach((btn) => {
    const mesh = meshes.find((m) => m._permanentStaticId === btn.dataset.meshId);
    if (!mesh) return;
    const vis = mesh.isVisible?.() ?? true;
    const keyed = !!reg?.hasVisibilityKeys?.(mesh);
    btn.classList.toggle('hidden', !vis);
    btn.classList.toggle('keyed', keyed);
    const i = btn.querySelector('i');
    if (i) {
      const want = `fa-solid ${vis ? 'fa-eye' : 'fa-eye-slash'}`;
      if (i.className !== want) i.className = want;
      const col = keyed ? (vis ? '#fab387' : '#8a4b1e') : '';
      if (i.style.color !== col) i.style.color = col;
    }
  });
}

export function wireSectionScene(el, main, repaintFn, vrPanel = null) {
  const findMesh = id => (main.getMeshes?.() ?? []).find(m => m._permanentStaticId === id) ?? null;

  el.querySelectorAll('[data-action="vis"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const mesh = findMesh(btn.dataset.meshId);
      if (!mesh) return;
      const cur = mesh.isVisible?.() ?? true;
      mesh.setVisible?.(!cur);
      if (mesh.getThreeMesh?.()) mesh.getThreeMesh().visible = !cur;
      main.render?.();
      repaintFn();
    });
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
  const completeRigPending = (target) => {
    const mode   = main._rigPendingMode;
    const subjId = main._rigPendingSubject;
    main._rigPendingMode = null;
    main._rigPendingSubject = null;
    if (target && target.getID() !== subjId) {
      if (mode === 'parent')      main.setMeshParent?.(subjId, target.getID());
      else if (mode === 'lookat') main.setLookAt?.(subjId, target.getID());
    }
    main.render?.(); repaintFn();
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

  // Pencil button → rename (double-click still works, but it's awkward in VR).
  el.querySelectorAll('[data-action="rename"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const mesh = findMesh(btn.dataset.meshId);
      if (!mesh) return;
      const nameBtn = el.querySelector(`[data-action="select"][data-mesh-id="${btn.dataset.meshId}"]`);
      if (nameBtn) beginRename(nameBtn, mesh);
    });
  });

  el.querySelectorAll('[data-action="select"]').forEach(btn => {
    btn.addEventListener('click', () => {
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
      main.setOrUnsetMesh?.(mesh, false); main.render?.(); repaintFn();
    });
  });

  // Any scene-add action cancels an in-progress pick to avoid a stale subject.
  const cancelPending = () => { main._rigPendingMode = null; main._rigPendingSubject = null; };

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
  el.querySelector('#mm-add-null')?.addEventListener('click', () => {
    cancelPending(); main.addNull?.(); main.render?.(); repaintFn();
  });
  el.querySelector('#mm-add-voxel')?.addEventListener('click', () => {
    cancelPending(); main.addVoxelObject?.(); main.render?.(); repaintFn(); // empty voxel space + Voxel tool
  });
  el.querySelector('#mm-duplicate')?.addEventListener('click', () => {
    main.duplicateSelection?.(); main.render?.(); repaintFn();
  });
  el.querySelector('#mm-instance')?.addEventListener('click', () => {
    main.instanceSelection?.(); main.render?.(); repaintFn();
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
  el.querySelector('[data-rig="set-parent"]')?.addEventListener('click', () => {
    const sel = selOne(); if (!sel) return;
    if (main._rigPendingMode === 'parent') cancelPending();
    else { main._rigPendingMode = 'parent'; main._rigPendingSubject = sel.getID(); }
    repaintFn();
  });
  el.querySelector('[data-rig="set-aim"]')?.addEventListener('click', () => {
    const sel = selOne(); if (!sel) return;
    if (main._rigPendingMode === 'lookat') cancelPending();
    else { main._rigPendingMode = 'lookat'; main._rigPendingSubject = sel.getID(); }
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

  el.querySelectorAll('[data-shader]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.shader, 10);
      const ms = main.getSelectedMeshes?.()?.length ? main.getSelectedMeshes() : [mesh];
      ms?.forEach(m => { if (m) m.setShaderType?.(id); });
      main.render?.();
      fullRepaintFn(); // sections appear/disappear on shader change
    });
  });

  el.querySelectorAll('[data-env]').forEach(btn => {
    btn.addEventListener('click', () => {
      ShaderPBR.idEnv = parseInt(btn.dataset.env, 10);
      main.getBackground?.()?._applyBackground?.(); // refresh if background shows the env
      main.render?.();
      el.querySelectorAll('[data-env]').forEach(b => b.classList.toggle('active', b === btn));
      lightRepaintFn();
    });
  });

  el.querySelectorAll('[data-matcap]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.matcap, 10);
      (main.getSelectedMeshes?.()?.length ? main.getSelectedMeshes() : [mesh])
        ?.forEach(m => m.setMatcap?.(id));
      main.render?.();
      el.querySelectorAll('[data-matcap]').forEach(b => b.classList.toggle('active', b === btn));
      lightRepaintFn();
    });
  });

  el.querySelector('#mm-import-matcap')?.addEventListener('click', () => document.getElementById('matcapopen')?.click());
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

  wireSlider(el.querySelector('#mm-curvature'), el.querySelector('#mm-curvature-val'), (v) => {
    meshes?.forEach(m => m.setCurvature?.(v / 20)); main.render?.();
  }, null, sliderDirtyFn);
  wireSlider(el.querySelector('#mm-transparency'), el.querySelector('#mm-transparency-val'), (v) => {
    meshes?.forEach(m => m.setOpacity?.(1 - v / 100)); main.render?.();
  }, (v) => `${v}%`, sliderDirtyFn);

  el.querySelector('#mm-flat-shading')?.addEventListener('click', () => {
    const t = !mesh?.getFlatShading?.();
    meshes?.forEach(m => m.setFlatShading?.(t));
    main.render?.();
    el.querySelector('#mm-flat-shading')?.classList.toggle('active', t);
    lightRepaintFn();
  });
  el.querySelector('#mm-wireframe')?.addEventListener('click', () => {
    const t = !mesh?.getShowWireframe?.();
    (main.getMeshes?.() ?? meshes)?.forEach(m => m.setShowWireframe?.(t));
    main.render?.();
    el.querySelector('#mm-wireframe')?.classList.toggle('active', t);
    lightRepaintFn();
  });

  // Wireframe opacity and z-offset sliders
  const gx  = main._guiXR ?? main.getGuiXR?.();
  const ui  = gx?._uiSettings ?? {};
  const opts = getOptionsURL;
  wireSlider(el.querySelector('#mm-render-wf-alpha'), el.querySelector('#mm-render-wf-alpha-val'), (v) => {
    const f = v / 100;
    ui.wireframeAlpha = f;
    const wm = main.getMesh?.()?.getRenderData?.()._wireframeMesh;
    if (wm?.material) { wm.material.opacity = f; main.render?.(); }
    opts.saveOption('wireframeAlpha', f, 500);
  }, (v) => `${v}%`, sliderDirtyFn);
  wireSlider(el.querySelector('#mm-render-wf-bias'), el.querySelector('#mm-render-wf-bias-val'), (v) => {
    const f = v / 10000;
    ui.wireframeBias = f;
    const wm = main.getMesh?.()?.getRenderData?.()._wireframeMesh;
    if (wm?.material?.uniforms?.uBias) { wm.material.uniforms.uBias.value = f; main.render?.(); }
    else {
      // LineBasicMaterial path: rebuild wireframe buffer so bias takes effect
      main.getMesh?.()?.updateWireframeBuffer?.();
      main.render?.();
    }
    opts.saveOption('wireframeBias', f, 500);
  }, (v) => (v / 10000).toFixed(4), sliderDirtyFn);

  el.querySelector('#mm-solid')?.addEventListener('click', () => {
    meshes?.forEach(m => {
      const mat = m._renderData?._threeMesh?.material;
      if (mat) mat.visible = !mat.visible;
    });
    main.render?.();
    lightRepaintFn();
  });

  el.querySelectorAll('[data-tonemap]').forEach(btn => {
    btn.addEventListener('click', () => {
      main.setToneMapping?.(parseInt(btn.dataset.tonemap, 10));
      el.querySelectorAll('[data-tonemap]').forEach(b => b.classList.toggle('active', b === btn));
      lightRepaintFn();
    });
  });

  wireSlider(el.querySelector('#mm-exposure'), el.querySelector('#mm-exposure-val'), (v) => {
    main.setExposure?.(v / 100); main.render?.();
  }, (v) => (v / 100).toFixed(2), sliderDirtyFn);

  // Camera controls
  const camera = main.getCamera?.() ?? main._camera;
  el.querySelector('#mm-cam-center')?.addEventListener('click', () => { camera?.resetView?.();       main.render?.(); });
  el.querySelector('#mm-cam-front') ?.addEventListener('click', () => { camera?.toggleViewFront?.(); main.render?.(); });
  el.querySelector('#mm-cam-left')  ?.addEventListener('click', () => { camera?.toggleViewLeft?.();  main.render?.(); });
  el.querySelector('#mm-cam-top')   ?.addEventListener('click', () => { camera?.toggleViewTop?.();   main.render?.(); });

  wireSelect(el, 'mm-cam-proj', (v) => {
    const n = parseInt(v, 10);
    camera?.setProjectionType?.(n);
    const fovRow = el.querySelector('#mm-fov-row');
    if (fovRow) fovRow.style.display = n === 0 ? '' : 'none';
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

  el.querySelector('#mm-level-down')?.addEventListener('click', () => {
    const m = main.getMesh?.();
    if (m?._meshes && m._sel > 0) { topo?.onResolutionChanged?.(m._sel); main.render?.(); repaintFn(); }
  });
  el.querySelector('#mm-level-up')?.addEventListener('click', () => {
    const m = main.getMesh?.();
    if (m?._meshes && m._sel < m._meshes.length - 1) { topo?.onResolutionChanged?.(m._sel + 2); main.render?.(); repaintFn(); }
  });
  el.querySelector('#mm-subdivide')?.addEventListener('click',   () => { topo?.subdivide?.();    main.render?.(); repaintFn(); });
  el.querySelector('#mm-reverse')?.addEventListener('click',     () => { topo?.reverse?.();      main.render?.(); repaintFn(); });
  el.querySelector('#mm-del-lower')?.addEventListener('click',   () => { topo?.deleteLower?.();  main.render?.(); repaintFn(); });
  el.querySelector('#mm-del-higher')?.addEventListener('click',  () => { topo?.deleteHigher?.(); main.render?.(); repaintFn(); });

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
    el.querySelector('#mm-brush-tangent')?.addEventListener('click', (e) => {
      tool._tangent = !tool._tangent;
      e.currentTarget.classList.toggle('active', tool._tangent);
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
      el.querySelector('#mm-paint-color')?.addEventListener('input', (e) => {
        const h = e.target.value;
        tool._color[0] = parseInt(h.slice(1, 3), 16) / 255;
        tool._color[1] = parseInt(h.slice(3, 5), 16) / 255;
        tool._color[2] = parseInt(h.slice(5, 7), 16) / 255;
        main.render?.();
        sliderDirtyFn?.();
      });
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
        tool._idAlpha = v; main.render?.();
      }, lightRepaintFn);

      el.querySelector('#mm-alpha-import')?.addEventListener('click', () => {
        const input = document.getElementById('alphaopen');
        if (!input) return;
        // Wire a one-shot handler: load the alpha then rebuild this section.
        const onAlphaLoaded = () => {
          input.removeEventListener('change', onAlphaLoaded);
          repaintFn(); // rebuild so the new alpha appears in the buttons
        };
        input.addEventListener('change', onAlphaLoaded);
        input.click();
      });
    }
  }

  // ── Symmetry ────────────────────────────────────────────────────────────────
  const symToggle = el.querySelector('#mm-sym-toggle');
  if (symToggle && sm) {
    symToggle.addEventListener('click', () => {
      sm._symmetry = !sm._symmetry;
      symToggle.classList.toggle('active', sm._symmetry);
      symToggle.textContent = `Mirror Symmetry ${sm._symmetry ? '✓ On' : 'Off'}`;
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
  const selKey   = guiFiles?._selectedSaveKey ?? null;
  // Drop a stale selection (e.g. after a delete) so the toolbar disables again.
  const hasSel   = saves.some(s => (s.key ?? s.id ?? '') === selKey);
  const disabled = hasSel ? '' : 'disabled';

  const thumbs = saves.length === 0
    ? '<div class="mm-info">No saves yet</div>'
    : saves.map(s => {
        const key   = s.key ?? s.id ?? '';
        const ts    = s.value?.timestamp ?? 0;
        const thumb = s.value?.thumb ?? '';
        const date  = ts ? new Date(ts).toLocaleDateString(undefined, { month:'short', day:'numeric' }) : '—';
        const sel   = key === selKey ? ' selected' : '';
        const img   = thumb
          ? `<img src="${thumb}" alt="save">`
          : `<div style="width:100%;aspect-ratio:1;background:#313244;display:flex;align-items:center;justify-content:center;font-size:20px;color:#6c7086"><i class="fa-solid fa-cube"></i></div>`;
        return `
          <div class="mm-storage-item${sel}" data-save-key="${key}">
            ${img}
            <span class="mm-storage-date">${date}</span>
          </div>`;
      }).join('');

  return `
    <div class="mm-storage-toolbar">
      <button class="mm-action-btn" id="mm-storage-load" ${disabled}>Load</button>
      <button class="mm-action-btn" id="mm-storage-import" ${disabled}>Import</button>
      <button class="mm-action-btn danger" id="mm-storage-delete" ${disabled}>Delete</button>
    </div>
    <div class="mm-btn-pair">
      <button class="mm-action-btn" id="mm-browser-save">Save scene</button>
      <button class="mm-action-btn" id="mm-storage-refresh"><i class="fa-solid fa-arrows-rotate"></i> Refresh</button>
    </div>
    <div class="mm-storage-grid" id="mm-storage-grid">${thumbs}</div>
  `;
}

export function wireMenuBrowserSaves(el, main, rebuildFn) {
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

  // Select a save by clicking its thumbnail; the toolbar acts on the selection.
  el.querySelectorAll('.mm-storage-item').forEach(item => {
    item.addEventListener('click', () => {
      if (guiFiles) guiFiles._selectedSaveKey = item.dataset.saveKey;
      rebuildFn();
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

  q('#mm-clear-scene')?.addEventListener('click', () => {
    if (!main._clearSceneConfirm) {
      main._clearSceneConfirm = true;
      rebuildFn(); // re-render button as "Confirm"
      setTimeout(() => { main._clearSceneConfirm = false; }, 3000);
    } else {
      main._clearSceneConfirm = false;
      main.clearScene?.(); main.render?.(); rebuildFn();
    }
  });

  q('#mm-import-obj')?.addEventListener('click', () => {
    document.getElementById('fileopen')?.click();
  });
  q('#mm-import-scale')?.addEventListener('click', () => {
    main._autoMatrix = !main._autoMatrix;
    q('#mm-import-scale')?.classList.toggle('active', main._autoMatrix);
  });
  q('#mm-import-srgb')?.addEventListener('click', () => {
    main._vertexSRGB = !main._vertexSRGB;
    q('#mm-import-srgb')?.classList.toggle('active', main._vertexSRGB);
  });

  q('#mm-export-all')?.addEventListener('click', () => {
    if (guiFiles) guiFiles._exportAll = !guiFiles._exportAll;
    q('#mm-export-all')?.classList.toggle('active', guiFiles?._exportAll ?? true);
  });
  q('#mm-export-sxr')?.addEventListener('click', () => warnVoxelThenSave(main, () => promptSaveName('Save .sxr as', 'sculpt', n => guiFiles?.saveFileAsSGL?.(n))));
  q('#mm-export-glb')?.addEventListener('click', () => promptSaveName('Save .glb as', 'sculpt', n => guiFiles?.saveFileAsGLB?.(n)));
  q('#mm-export-obj')?.addEventListener('click', () => promptSaveName('Save .obj as', 'sculpt', n => guiFiles?.saveFileAsOBJ?.(n)));
  q('#mm-export-ply')?.addEventListener('click', () => promptSaveName('Save .ply as', 'sculpt', n => guiFiles?.saveFileAsPLY?.(n)));
  q('#mm-export-stl')?.addEventListener('click', () => promptSaveName('Save .stl as', 'sculpt', n => guiFiles?.saveFileAsSTL?.(n)));
  q('#mm-export-objseq')?.addEventListener('click', () => promptSaveName('OBJ sequence name', 'anim', n => guiFiles?.saveObjSequence?.(n)));

  q('#mm-obj-zbrush')?.addEventListener('click', () => {
    if (guiFiles) guiFiles._objColorZbrush = !guiFiles._objColorZbrush;
    q('#mm-obj-zbrush')?.classList.toggle('active', guiFiles?._objColorZbrush ?? true);
  });
  q('#mm-obj-append')?.addEventListener('click', () => {
    if (guiFiles) guiFiles._objColorAppended = !guiFiles._objColorAppended;
    q('#mm-obj-append')?.classList.toggle('active', guiFiles?._objColorAppended ?? false);
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
    <div class="mm-btn-pair">
      <button class="mm-action-btn" id="mm-bg-reset">Reset</button>
      <button class="mm-action-btn" id="mm-bg-import">Import…</button>
    </div>
    <button class="mm-toggle${fill?' active':''}" id="mm-bg-fill">Fill</button>
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

  return `${ipadSection}
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
