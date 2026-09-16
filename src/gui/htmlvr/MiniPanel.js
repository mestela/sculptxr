import MotionPathEdit from '../../editing/MotionPathEdit.js';
import GrabChannels  from '../../editing/grabChannels.js';
import RigPending    from '../../editing/RigPending.js';
/**
 * MiniPanel — compact wrist HUD for SculptXR.
 *
 * Replaces the legacy canvas-based MiniHUD with a live HTML panel rendered
 * into a WebGL texture via the three-html-render polyfill.
 *
 * Displays:
 *   • Current tool button (tinted by tool family) → tapping opens the tool picker
 *   • Radius + Intensity sliders
 *   • Symmetry / Negative / Wireframe toggles
 *   • Tool-specific extras (masking, paint, voxel, extrude/inset)
 *
 * Scene.js wires:
 *   this._miniPanel = new MiniPanel(this, scene, camera, renderer);
 *   this._miniPanel.bindDesktopPointers(renderer, camera);
 */

import { HTMLVRPanel, VR_PANEL_PX_PER_M, wristPanelY, wristPanelYaw, wristPanelPitch} from './HTMLVRPanel.js';
import Enums          from '../../misc/Enums.js';
import getOptionsURL  from '../../misc/getOptionsURL.js';
import Utils          from '../../misc/Utils.js';
import { toolTint }   from './toolTints.js';
import { toolLabel }  from './toolLists.js';
import { wireGroups, applyUISweep, tagReorgRoot } from './uiTokens.js';
import { ColorWheel, buildColorWheelHTML } from './ColorWheel.js';
import VoxelDensityOverlay from '../../render/VoxelDensityOverlay.js';
import {
  buildBoneSectionHTML,
  buildBonePoseHTML,
  wireBoneSection,
  syncBoneSection,
} from '../bonePanel.js';
import { buildTransformSectionHTML, wireTransformSection, syncTransformSection } from '../transformPanel.js';

// THE TWO CHANNELS A MOTION-PATH EDIT CAN WRITE, as one markup helper so Move and Smooth cannot
// drift apart. A 6DOF grab always produces both a translation and a rotation — your hand cannot
// move without turning a little — so without these a nudge sideways also nods every gnomon it
// passes. matt: "i can see cases where i'll want to affect just positions, or just rotations, or
// both."
//
// Labelled "Path" because these are about the motion path and NOT about the mesh brush, which
// shares the tool and the panel above it.
// The same two buttons for GRAB, in the same dialect. A grabbed joint with translation off
// stops being an IK effector and simply turns -- which is the whole point.
function grabChannelHTML() {
  const ch = GrabChannels.channels();
  return `
        <div class="mp-toggles">
          <button class="mp-toggle-btn${ch.translate ? ' active' : ''}" id="mp-grab-translate">Translate</button>
          <button class="mp-toggle-btn${ch.rotate ? ' active' : ''}" id="mp-grab-rotate">Rotate</button>
        </div>`;
}

// SET PARENT, ON THE WRIST. Parenting is a three-step gesture done WHILE grabbing things about
// -- press, click the child, click the parent -- and it lived only in the main menu, so every use
// meant leaving the thing you were looking at and coming back. matt: "set parent is really
// useful. i think that should be put on the grab minipanel."
//
// Reads its lit state from RigPending rather than a local flag, because the VIEWPORT can finish
// or cancel the gesture too and a copy here would go stale the moment it did.
function setParentHTML(main) {
  const armed = main?._rigPendingMode === 'parent';
  return `
        <div class="mp-toggles">
          <button class="mp-toggle-btn${armed ? ' active' : ''}" id="mp-set-parent">Set Parent</button>
        </div>`;
}

function pathChannelHTML() {
  const ch = MotionPathEdit.channels();
  return `
        <div class="mp-toggles">
          <button class="mp-toggle-btn${ch.translate ? ' active' : ''}" id="mp-path-translate">Path Move</button>
          <button class="mp-toggle-btn${ch.rotate ? ' active' : ''}" id="mp-path-rotate">Path Rotate</button>
        </div>`;
}


// ── Tool name lookup ─────────────────────────────────────────────────────────
// FROM THE REGISTRY, NOT A SECOND COPY. This file used to carry its own TOOL_NAMES map, which
// is how the wrist panel came to call the Select tool "Tool 35": SELECT was appended to the
// enum and added to toolLists, and nothing made this copy follow. See TOOL_LABELS.
const toolName = (id) => toolLabel(id);

// ── CSS ───────────────────────────────────────────────────────────────────────
const CSS = `
/* Collapsible group headings (ui reorg mockup). The markup comes from uiTokens.collapsibleHTML,
   which the bone panel emits into BOTH panels, so the wrist needs the same rules -- the two
   panels do not share a stylesheet. Sized down for this panel's narrower column. */
.mm-group-head {
  display: flex; align-items: center; gap: 5px; width: 100%;
  margin: 5px 0 2px 0; padding: 3px 3px;
  background: none; border: 0; border-radius: 4px;
  color: #a6adc8; font-size: 10px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.06em;
  cursor: pointer; text-align: left;
}
.mm-group-head:hover, .mm-group-head.hover { background: #313244; color: #cdd6f4; }
.mm-group-chev { font-size: 8px; width: 9px; flex-shrink: 0; color: #6c7086; }
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

/* ── MiniPanel — Catppuccin Mocha ──────────────────────────────────── */
#mp-root {
  width: 240px;
  padding: 10px 12px 12px;
  background: #1e1e2e;
  color: #cdd6f4;
  font-family: system-ui, -apple-system, sans-serif;
  box-sizing: border-box;
  border-radius: 12px;
  /* An inset shadow rather than a border, for the reason spelled out in MainMenuPanel: the
     rasteriser's SVG is the CLIENT box, so a real border takes content off the bottom and
     right edges with it. */
  box-shadow: inset 0 0 0 1px #313244;
  user-select: none;
}

/* ── Tool button ──────────────────────────────────────────────────── */
/* SWAP TO THE MAIN MENU. On a hands-only runtime there is no X/A button to open the main panel
   with, so the swap has to live on the panels themselves. Plain text rather than a glyph: the VR
   rasteriser is the only place these are ever read, and an icon that needs explaining is worse
   than a word.

   IT LIVES IN THE HANDS-ONLY ROW AT THE BOTTOM, alongside Undo/Redo, which is where the main
   panel's swap ended up for want of room in its menubar. Two earlier homes, both wrong: floated
   over the corner of the tool button, where the tool button won every press (_uvToElement walks
   children in REVERSE DOM ORDER and returns the first geometric match — it never looks at
   z-index), and then beside it in this row, where it crowded the top. The bottom row is
   hands-only already and styles its own buttons, so this one needs nothing but a home. */
.mp-toprow {
  display: flex;
  gap: 6px;
  align-items: stretch;
  margin-bottom: 10px;
}

/* HANDS-ONLY CONTROLS. A controller runtime has X/A to swap panels and a thumbstick to undo, so
   these are dead weight there — present in the markup, revealed by a class, so showing them is a
   style change and needs only a repaint rather than a markup rebuild. */
/* ID-QUALIFIED ON PURPOSE. A bare .mp-hands-only display:none ties on specificity with
   .mp-row display:flex, so source order decides and the row wins — the control then shows on a
   controller, which is the one device it is meant to stay off. Qualifying with the root id
   beats any single-class rule, and the reveal below beats this in turn.
   (No backticks in here: this whole block is inside a JS template literal.) */
#mp-root .mp-hands-only { display: none; }
#mp-root.hands-only .mp-hands-only { display: flex; }

#mp-undo-row {
  gap: 6px;
  margin-top: 10px;
}
#mp-undo-row button {
  flex: 1;
  padding: 8px 0;
  border: 1px solid #45475a;
  border-radius: 8px;
  background: #1e1e2e;
  color: #a6adc8;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  outline: none;
}
#mp-undo-row button:hover, #mp-undo-row button.hover { background: #313244; color: #cdd6f4; border-color: #7f849c; }

#mp-tool-btn {
  flex: 1;
  min-width: 0;
  padding: 9px 12px;
  border: 1px solid #45475a;
  border-radius: 8px;
  background: #313244;
  color: #cdd6f4;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  text-align: left;
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0;   /* the flex row owns the spacing now */
  outline: none;
  transition: filter 0.1s;
}
#mp-tool-btn:hover,
#mp-tool-btn.hover  { filter: brightness(1.25); }
#mp-tool-btn:active,
#mp-tool-btn.active { filter: brightness(1.45); }
#mp-tool-btn .mp-tool-arrow {
  font-size: 11px;
  color: #6c7086;
  margin-left: 6px;
}

/* ── Divider ──────────────────────────────────────────────────────── */
#mp-root .mp-divider {
  border: none;
  border-top: 1px solid #313244;
  margin: 8px 0;
}

/* ── Sliders ──────────────────────────────────────────────────────── */
#mp-root .mp-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
#mp-root .mp-lbl {
  width: 62px;
  font-size: 11px;
  color: #a6adc8;
  flex-shrink: 0;
}
/* THE HIT BOX IS THE ELEMENT, NOT THE PAINTED TRACK.
   The input WAS 5px tall and painted its own track, so the box a ray has to hit was a 5px
   sliver -- while the thumb, at 16px, is drawn overflowing that box. So the control looks three
   times taller than it can be hit, and the hover highlight came out as a thin band sitting
   below the thumb you were aiming at. matt: "the hover hilight is very thin and misaligned too
   low." Same width, same look: the box grows to a hittable 20px and the 5px track moves to the
   track pseudo-element inside it. */
#mp-root input[type=range] {
  flex: 1;
  -webkit-appearance: none;
  height: 20px;
  background: transparent;
  outline: none;
  cursor: pointer;
}
#mp-root input[type=range]::-webkit-slider-runnable-track {
  height: 5px;
  border-radius: 3px;
  background: #45475a;
}
#mp-root input[type=range]::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 16px; height: 16px;
  border-radius: 50%;
  background: #89b4fa;
  cursor: pointer;
  box-shadow: 0 0 0 3px rgba(137,180,250,0.25);
  margin-top: -5.5px;          /* centre the thumb on the track inside the taller box */
}
#mp-root .mp-val {
  width: 32px;
  text-align: right;
  font-size: 11px;
  color: #89b4fa;
  font-variant-numeric: tabular-nums;
}

/* ── Toggle row ───────────────────────────────────────────────────── */
#mp-root .mp-toggles {
  display: flex;
  gap: 6px;
}
/* Two toggle rows in one section -- Move and Smooth both have them -- were flush against each
   other: the gap property spaces buttons WITHIN a row and says nothing about the row below. */
#mp-root .mp-toggles + .mp-toggles { margin-top: 6px; }
/* ONE COLUMN RHYTHM DOWN THE PANEL. A flex row divides itself by how many chips are in it, so
   a row of five and a row of three below it shared no edges and the panel read as a jumble.
   Opting a row into the same three columns the mode grid uses lines every chip in the panel up
   with the one above it -- and a row of five simply becomes 3 + 2, still on those columns. */
#mp-root .mp-toggles.cols-3 {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
#mp-root .mp-toggle-btn {
  flex: 1;
  padding: 6px 4px;
  border: 1px solid #313244;
  border-radius: 7px;
  background: #181825;
  color: #6c7086;
  font-size: 10px;
  font-weight: 500;
  cursor: pointer;
  text-align: center;
  outline: none;
  transition: background 0.1s, color 0.1s, border-color 0.1s;
}
#mp-root .mp-toggle-btn.active     { background: #313244; color: #89b4fa; border-color: #585b70; }
/* THE TICK IS STATE, SO IT IS DRAWN FROM THE STATE.
   It used to be typed into the label — "✓ Sym" — which meant it was on whether the toggle was or
   not, while the highlight beside it told the truth. Two indicators, one of them always lying.
   matt: "It is permanently on. It should toggle along with the button highlighted/disabled
   visual state."
   Driven from the .active class rather than by rewriting textContent, because that class is
   already toggled every refresh and is already known to repaint in VR — whereas a MARKUP change
   would have to go through _rebuildContent with a revision in the cache key to appear there at
   all (see the note in HTMLVRPanel). One source of truth, and no new repaint path.
   NOTE FOR ANYONE EDITING THIS BLOCK: it is a JS TEMPLATE LITERAL. No backticks, anywhere,
   including in comments — one ends the string and the panel dies on launch. */
#mp-root .mp-toggle-btn.active::before { content: '✓ '; }
#mp-root .mp-toggle-btn:hover,
#mp-root .mp-toggle-btn.hover      { background: #24243e; color: #a6adc8; border-color: #45475a; }
#mp-root .mp-toggle-btn:active,
#mp-root .mp-toggle-btn.active.hover { background: #45475a; }

/* ── Extras section ───────────────────────────────────────────────── */
#mp-extras {
  margin-top: 8px;
}

/* Masking buttons */
#mp-extras .mp-btn-row {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}
#mp-extras .mp-action-btn {
  flex: 1;
  padding: 7px 6px;
  border: 1px solid #313244;
  border-radius: 7px;
  background: #181825;
  color: #a6adc8;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  text-align: center;
  outline: none;
  transition: background 0.1s, color 0.1s;
}
#mp-extras .mp-action-btn:hover,
#mp-extras .mp-action-btn.hover  { background: #24243e; color: #cdd6f4; border-color: #45475a; }
#mp-extras .mp-action-btn:active,
#mp-extras .mp-action-btn.active { background: #45475a; }

/* Paint colour swatch */
#mp-color-swatch {
  width: 100%;
  height: 20px;
  border-radius: 5px;
  border: 1px solid #45475a;
  margin-bottom: 8px;
  box-sizing: border-box;
}

/* Voxel mode grid */
#mp-extras .mp-voxel-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 5px;
  margin-bottom: 6px;
}
#mp-extras .mp-voxel-btn {
  padding: 6px 4px;
  border: 1px solid #313244;
  border-radius: 6px;
  background: #181825;
  color: #a6adc8;
  font-size: 10px;
  font-weight: 500;
  cursor: pointer;
  text-align: center;
  outline: none;
  transition: background 0.1s, color 0.1s;
}
#mp-extras .mp-voxel-btn.active    { background: #313244; color: #cba6f7; border-color: #cba6f7; }
#mp-extras .mp-voxel-btn:hover,
#mp-extras .mp-voxel-btn.hover     { background: #24243e; color: #cdd6f4; border-color: #45475a; }
#mp-extras .mp-voxel-btn:active    { background: #45475a; }

/* Keep-Together toggle */
#mp-extras .mp-keep-btn {
  width: 100%;
  padding: 7px 10px;
  border: 1px solid #313244;
  border-radius: 7px;
  background: #181825;
  color: #6c7086;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  text-align: center;
  outline: none;
  transition: background 0.1s, color 0.1s, border-color 0.1s;
}
#mp-extras .mp-keep-btn.active  { background: #313244; color: #89b4fa; border-color: #585b70; }
#mp-extras .mp-keep-btn:hover,
#mp-extras .mp-keep-btn.hover   { background: #24243e; color: #a6adc8; border-color: #45475a; }
`;

let _mpCssInjected = false;
function injectCSS() {
  if (_mpCssInjected) return;
  _mpCssInjected = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}

// ── Static HTML ───────────────────────────────────────────────────────────────
function buildHTML() {
  return `
    <div class="mp-toprow">
      <button id="mp-tool-btn" style="background:${toolTint(0)}">
        <span id="mp-tool-name">Brush</span>
        <span class="mp-tool-arrow">▸ All</span>
      </button>
    </div>
    <div class="mp-row">
      <span class="mp-lbl">Radius</span>
      <input type="range" id="mp-radius" min="5" max="250" step="1" value="50">
      <span class="mp-val" id="mp-radius-val">50</span>
    </div>
    <div class="mp-row">
      <span class="mp-lbl">Intensity</span>
      <input type="range" id="mp-intensity" min="0" max="100" step="1" value="50">
      <span class="mp-val" id="mp-intensity-val">50%</span>
    </div>
    <hr class="mp-divider">
    <div class="mp-toggles">
      <button class="mp-toggle-btn" id="mp-sym">Sym</button>
      <button class="mp-toggle-btn" id="mp-neg">Neg</button>
      <button class="mp-toggle-btn" id="mp-wire">Wire</button>
    </div>
    <div id="mp-extras"></div>
    <!-- Bottom of the panel, hands-only: with no thumbstick, this is the only way to undo
         without leaving whatever you are doing, and with no X/A button the swap to the main menu
         has nowhere else to go either. Lower right, the same corner it sits in on the main
         panel, so the two swaps are in the same place as each other. -->
    <div id="mp-undo-row" class="mp-hands-only">
      <button id="mp-undo">Undo</button>
      <button id="mp-redo">Redo</button>
      <button id="mp-swap-btn" title="Open the main menu">Menu</button>
    </div>
  `;
}

// The colour wheel moved to ColorWheel.js so the settings panel can use it too — same widget,
// same geometry at 216, with the colour it edits passed in rather than read off the paint tool.
// ── MiniPanel ─────────────────────────────────────────────────────────────────

export class MiniPanel extends HTMLVRPanel {
  /**
   * @param {object}              main      SculptXR main Scene / app object
   * @param {THREE.Scene}         scene
   * @param {THREE.Camera}        camera
   * @param {THREE.WebGLRenderer} renderer
   */
  constructor(main, scene, camera, renderer) {
    injectCSS();

    const root = document.createElement('div');
    root.id = 'mp-root';
    // The sweep is scoped on a .ui-reorg ANCESTOR, and the rasteriser serialises this root on
    // its own -- so the class has to be on the root itself or none of the styling reaches VR.
    applyUISweep();
    tagReorgRoot(root);
    root.innerHTML = buildHTML();

    // Width derived from the shared px/m ratio so fonts match the other panels
    super(root, 240 / VR_PANEL_PX_PER_M); // 0.133 m

    this._main          = main;
    this._pinned        = false;  // always false — no pin button on MiniPanel
    this._colorWheel    = null;
    this._lastExtrasIdx = -1;     // track last-built extras so we never compare innerHTML
    this._lastExtrasKey = null;   // tool + bone selection: both change what the block contains

    // Initialise the Three.js mesh.
    this.init(scene, camera, renderer);

    // Wire DOM events once mesh is ready (requestAnimationFrame delay in init).
    this._waitForMeshThenWire(main);
  }

  // ── Wait for mesh, then wire events ─────────────────────────────────────────

  _waitForMeshThenWire(main) {
    if (this.mesh) {
      this._wireEvents(main);
    } else {
      const check = () => {
        if (this.mesh) this._wireEvents(main);
        else requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    }
  }

  // ── Wrist offset ──────────────────────────────────────────────────────────

  _onMeshCreated(_scene) {
    if (this.mesh) {
      // Matches legacy MiniHUD wrist positioning
      this.mesh.position.set(0, wristPanelY(), -0.05);
      this.mesh.rotation.set(wristPanelPitch(), wristPanelYaw(), 0);
    }
    // Initial state sync once everything is live.
    requestAnimationFrame(() => this.syncFromState());
  }

  // ── DOM event wiring ───────────────────────────────────────────────────────

  _wireHUDBody(main) {
    const root = this._element;

    // ── Radius slider ────────────────────────────────────────────────────────
    const radiusInput = root.querySelector('#mp-radius');
    const radiusVal   = root.querySelector('#mp-radius-val');
    if (radiusInput) {
      radiusInput.addEventListener('input', () => {
        const val = parseFloat(radiusInput.value);
        if (radiusVal) radiusVal.textContent = Math.round(val);
        const sm  = main.getSculptManager?.();
        const idx = sm?.getToolIndex();
        const t   = sm?.getCurrentTool?.();
        if (t) {
          t._radius = val;
          getOptionsURL.saveOption(`tool_${idx}_radius`, val, 500);
          main.render?.();
        }
        this._requestPaint();
      });
    }

    // ── Intensity slider ─────────────────────────────────────────────────────
    const intensityInput = root.querySelector('#mp-intensity');
    const intensityVal   = root.querySelector('#mp-intensity-val');
    if (intensityInput) {
      intensityInput.addEventListener('input', () => {
        const pct = parseFloat(intensityInput.value);
        const val = pct / 100;
        if (intensityVal) intensityVal.textContent = Math.round(pct) + '%';
        const sm  = main.getSculptManager?.();
        const idx = sm?.getToolIndex();
        const t   = sm?.getCurrentTool?.();
        if (t) {
          t._intensity = val;
          getOptionsURL.saveOption(`tool_${idx}_intensity`, val, 500);
          main.render?.();
        }
        this._requestPaint();
      });
    }

    // ── Toggle helpers ───────────────────────────────────────────────────────
    const makeToggle = (id, getVal, setVal) => {
      const btn = root.querySelector(id);
      if (!btn) return;
      btn.addEventListener('click', () => {
        setVal(!getVal());
        this.syncFromState();
      });
    };

    makeToggle('#mp-sym',
      () => main.getSculptManager?.()._symmetry,
      (v) => { const sm = main.getSculptManager?.(); if (sm) { sm._symmetry = v; main.render?.(); } }
    );
    // NEGATIVE LIVES ON THE TOOL, NOT ON THE MANAGER.
    //
    // This read and wrote sculptManager._negative, which nothing in the codebase defines or
    // consults — every tool carries its own _negative, and the VR path reads
    // currentTool._negative XOR the subtract override. So the button toggled a property of its
    // own invention, then read that same property back to decide whether to look active: it lit
    // up correctly and changed nothing. Symmetry next to it is fine because the manager really
    // does own _symmetry.
    //
    // Not every tool has the flag (it is declared per tool), so a tool without one is left
    // alone rather than having the property invented on it a second time.
    makeToggle('#mp-neg',
      () => !!main.getSculptManager?.()?.getCurrentTool?.()?._negative,
      (v) => {
        const t = main.getSculptManager?.()?.getCurrentTool?.();
        if (t && '_negative' in t) { t._negative = v; main.render?.(); }
      }
    );
    makeToggle('#mp-wire',
      () => main.getMesh?.()?.getShowWireframe?.() ?? false,
      (v) => { const mesh = main.getMesh?.(); if (mesh) { mesh.setShowWireframe(v); main.render?.(); } }
    );
  }

  // ── DOM event wiring (one-time, at mesh-ready) ─────────────────────────────

  _wireEvents(main) {
    // Tool button fires event — Scene.js swaps to ToolPickerPanel
    this._element?.querySelector('#mp-tool-btn')?.addEventListener('click', () => {
      this._element.dispatchEvent(new CustomEvent('mp-show-tool-picker', { bubbles: false }));
    });
    // Swap to the main menu. Announced as an event rather than calling Scene directly, exactly
    // as the tool picker above does — the panel says what happened and Scene decides what that
    // means, so the panel keeps working if the swap is ever rerouted.
    this._element?.querySelector('#mp-swap-btn')?.addEventListener('click', () => {
      this._element.dispatchEvent(new CustomEvent('mp-show-main-menu', { bubbles: false }));
    });
    this._element?.querySelector('#mp-undo')?.addEventListener('click', () => {
      this._element.dispatchEvent(new CustomEvent('mp-undo', { detail: { redo: false }, bubbles: false }));
    });
    this._element?.querySelector('#mp-redo')?.addEventListener('click', () => {
      this._element.dispatchEvent(new CustomEvent('mp-undo', { detail: { redo: true }, bubbles: false }));
    });
    this._wireHUDBody(main);
  }

  // ── Extras wiring (called after syncFromState rebuilds #mp-extras) ─────────

  _wireExtras(main) {
    const extras = this._element?.querySelector('#mp-extras');
    if (!extras) return;

    // Dispose any previous colour wheel before re-wiring
    if (this._colorWheel) {
      this._colorWheel.dispose();
      this._colorWheel = null;
    }

    const sm  = main.getSculptManager?.();
    const idx = sm?.getToolIndex?.() ?? -1;

    // Collapsible groups emitted by the shared bone panel (ui reorg mockup).
    // noteContentResized, not markDirty: a section opening changes this panel's HEIGHT, and the
    // plane has to be re-measured or the texture lands on the old one. See HTMLVRPanel.
    wireGroups(extras, () => this.noteContentResized());

    // ── Brush extras ───────────────────────────────────────────────────────
    if (idx === Enums.Tools.BRUSH) {
      const makeToolToggle = (id, prop) => {
        const btn = extras.querySelector(id);
        if (!btn) return;
        btn.addEventListener('click', () => {
          const t = sm?.getCurrentTool?.();
          if (t) { t[prop] = !t[prop]; main.render?.(); }
          this.syncFromState();
        });
      };
      makeToolToggle('#mp-clay',    '_clay');
      makeToolToggle('#mp-culling', '_culling');
    }

    // ── Bones extras ───────────────────────────────────────────────────────
    // Shared with the menu/sidebar build of the same panel — see gui/bonePanel.js.
    if (idx === Enums.Tools.TRANSFORM_VR || idx === Enums.Tools.TRANSFORM) {
      wireTransformSection(extras, main, { refresh: () => this.syncFromState() });
    }

    if (idx === Enums.Tools.BONE_DRAW || idx === Enums.Tools.GRAB || idx === Enums.Tools.TRANSFORM_VR) {
      wireBoneSection(extras, main, {
        panel: this,
        refresh: () => this.syncFromState(),
        // Binding and Make Skin change WHICH buttons exist, and the extras markup is only
        // rebuilt when the tool changes, so those have to force one.
        rebuild: () => { this._lastExtrasIdx = -1; this._lastExtrasKey = null; this.syncFromState(); },
      });
    }

    // ── The motion-path channel buttons, on both tools that edit a path ────
    // Shared wiring rather than two copies: Move and Smooth show the same pair and write the
    // same global setting, so a second copy is a second place for the order of "live value
    // first, saved second" to be got wrong.
    if (idx === Enums.Tools.MOVE || idx === Enums.Tools.SMOOTH) {
      const channelBtn = (id, liveKey, savedKey) => {
        extras.querySelector(id)?.addEventListener('click', () => {
          const ch = MotionPathEdit.channels();
          const next = !(liveKey === '_pathTranslate' ? ch.translate : ch.rotate);
          window[liveKey] = next;
          getOptionsURL.saveOption(savedKey, next, 0);
          this.syncFromState();
        });
      };
      channelBtn('#mp-path-translate', '_pathTranslate', 'pathTranslate');
      channelBtn('#mp-path-rotate', '_pathRotate', 'pathRotate');
    }

    // The same pair for GRAB. Through GrabChannels rather than writing the globals here,
    // because turning off the last one has to turn the other back on -- a grab that does
    // nothing is indistinguishable from a broken grab.
    if (idx === Enums.Tools.GRAB) {
      const grabBtn = (id, which) => {
        extras.querySelector(id)?.addEventListener('click', () => {
          GrabChannels.setChannel(which, !GrabChannels.channels()[which]);
          this.syncFromState();
        });
      };
      grabBtn('#mp-grab-translate', 'translate');
      grabBtn('#mp-grab-rotate', 'rotate');
      // Same entry point the main menu uses, so the two cannot drift: press to arm, press again
      // to cancel, and the viewport completes it.
      // `extras`, not `extrasEl`. This function's local is `extras`; `extrasEl` is the PARAMETER
      // name over in _syncExtrasActive, and it does not exist here -- so this line threw a
      // ReferenceError out of _wireExtras every time the Grab extras were wired, killing Set
      // Parent on the wrist and everything after the call in syncFromState with it.
      extras.querySelector('#mp-set-parent')?.addEventListener('click', () => {
        RigPending.toggle(this._main, 'parent');
        extras.querySelector('#mp-set-parent')
          ?.classList.toggle('active', this._main?._rigPendingMode === 'parent');
      });
    }

    // ── Move extras: how a path edit measures "near" ───────────────────────
    if (idx === Enums.Tools.MOVE) {
      const btn = extras.querySelector('#mp-connected');
      if (btn) {
        btn.addEventListener('click', () => {
          // Live value first so it takes effect on the current stroke, saved second so it
          // sticks — the order every other persisted setting in here is read and written in.
          const next = !MotionPathEdit.connected();
          window._pathConnected = next;
          getOptionsURL.saveOption('pathConnected', next, 0);
          this.syncFromState();
        });
      }
    }

    // ── Smooth / Relax extras ──────────────────────────────────────────────
    if (idx === Enums.Tools.SMOOTH || idx === Enums.Tools.RELAX) {
      const tangentBtn = extras.querySelector('#mp-tangent');
      if (tangentBtn) {
        tangentBtn.addEventListener('click', () => {
          const t = sm?.getCurrentTool?.();
          if (t) { t._tangent = !t._tangent; main.render?.(); }
          this.syncFromState();
        });
      }
      if (idx === Enums.Tools.SMOOTH) {
        const sharpenBtn = extras.querySelector('#mp-sharpen');
        if (sharpenBtn) {
          sharpenBtn.addEventListener('click', () => {
            const t = sm?.getCurrentTool?.();
            if (t) { t._negative = !t._negative; main.render?.(); }
            this.syncFromState();
          });
        }
      }
    }

    // ── Masking extras ─────────────────────────────────────────────────────
    if (idx === Enums.Tools.MASKING) {
      const clearBtn   = extras.querySelector('#mp-mask-clear');
      const invertBtn  = extras.querySelector('#mp-mask-invert');
      const hardInput  = extras.querySelector('#mp-hardness');
      const hardVal    = extras.querySelector('#mp-hardness-val');
      const thickInput = extras.querySelector('#mp-thickness');
      const thickVal   = extras.querySelector('#mp-thickness-val');

      if (clearBtn) {
        clearBtn.addEventListener('click', () => {
          const t = sm?.getCurrentTool?.();
          // The tool's methods are clear()/invert(), not clearMask()/invertMask(). Written as
          // an optional-chained guard, the wrong name did not throw -- the buttons simply did
          // nothing, forever, and read as "clear and invert mask seem broken" (Quest 2 user,
          // 2026-08-28). A guard that hides a typo is worse than no guard.
          if (t?.clear) { t.clear(); main.render?.(); }
          this.syncFromState();
        });
      }
      if (invertBtn) {
        invertBtn.addEventListener('click', () => {
          const t = sm?.getCurrentTool?.();
          if (t?.invert) { t.invert(); main.render?.(); }
          this.syncFromState();
        });
      }
      if (hardInput) {
        hardInput.addEventListener('input', () => {
          const val = parseFloat(hardInput.value) / 100;
          if (hardVal) hardVal.textContent = Math.round(parseFloat(hardInput.value)) + '%';
          const t = sm?.getCurrentTool?.();
          if (t) {
            t._hardness = val;
            getOptionsURL.saveOption(`tool_${idx}_hardness`, val, 500);
            main.render?.();
          }
          this._requestPaint();
        });
      }
      if (thickInput) {
        thickInput.addEventListener('input', () => {
          const val = parseFloat(thickInput.value) / 100;
          if (thickVal) thickVal.textContent = Math.round(parseFloat(thickInput.value)) + '%';
          const t = sm?.getCurrentTool?.();
          if (t) {
            t._thickness = val;
            getOptionsURL.saveOption(`tool_${idx}_thickness`, val, 500);
            main.render?.();
          }
          this._requestPaint();
        });
      }
    }

    // ── Paint extras ───────────────────────────────────────────────────────
    if (idx === Enums.Tools.PAINT) {
      // Colour wheel
      this._colorWheel?.dispose();
      const cwRoot = extras.querySelector('#mp-cw');
      if (cwRoot) {
        // The paint tool is looked up on every call rather than captured: the wheel outlives a
      // tool switch, and a captured tool would go on editing the one that is no longer selected.
      const paintTool = () => {
        const sm = main.getSculptManager?.();
        let t = sm?.getCurrentTool?.();
        if (!t?._color) t = sm?.getTool?.(Enums.Tools.PAINT);
        return (t?._color) ? t : null;
      };
      this._colorWheel = new ColorWheel(cwRoot, {
        prefix: 'mp-cw', size: 216, onchange: () => this._requestPaint(),
        render: () => main.render?.(),
        get: () => paintTool()?._color ?? null,
        set: (rgb) => { const t = paintTool(); if (t) { t._color[0] = rgb[0]; t._color[1] = rgb[1]; t._color[2] = rgb[2]; } },
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

      // Roughness / metalness
      const roughInput = extras.querySelector('#mp-roughness');
      const roughVal   = extras.querySelector('#mp-roughness-val');
      const metInput   = extras.querySelector('#mp-metalness');
      const metVal     = extras.querySelector('#mp-metalness-val');

      if (roughInput) {
        roughInput.addEventListener('input', () => {
          const val = parseFloat(roughInput.value) / 100;
          if (roughVal) roughVal.textContent = Math.round(parseFloat(roughInput.value)) + '%';
          const t = sm?.getCurrentTool?.();
          if (t?._material) {
            t._material[0] = val;
            getOptionsURL.saveOption(`tool_${idx}_roughness`, val, 500);
            main.render?.();
          }
          this._requestPaint();
        });
      }
      if (metInput) {
        metInput.addEventListener('input', () => {
          const val = parseFloat(metInput.value) / 100;
          if (metVal) metVal.textContent = Math.round(parseFloat(metInput.value)) + '%';
          const t = sm?.getCurrentTool?.();
          if (t?._material) {
            t._material[1] = val;
            getOptionsURL.saveOption(`tool_${idx}_metalness`, val, 500);
            main.render?.();
          }
          this._requestPaint();
        });
      }
    }

    // ── Voxel extras ───────────────────────────────────────────────────────
    if (idx === Enums.Tools.VOXEL) {
      extras.querySelectorAll('.mp-voxel-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const t = sm?.getCurrentTool?.();
          if (t) {
            if (btn.dataset.voxelShape !== undefined) {
              t._shape = parseInt(btn.dataset.voxelShape, 10); // sphere / box
            } else if (btn.dataset.voxelAlign !== undefined) {
              t._alignToController = !t._alignToController; // box follows controller rotation
            } else if (btn.dataset.voxelBake !== undefined) {
              t.bakeToMesh?.(); // convert voxel object → editable poly mesh
            } else if (btn.dataset.voxelBuildup !== undefined) {
              t._buildUp = !t._buildUp;
              getOptionsURL.saveOption(`tool_${idx}_buildUp`, t._buildUp);
            } else if (btn.dataset.voxelFlat !== undefined) {
              const m = t._voxelMesh; if (m) m.setFlatShading?.(!m.getFlatShading?.());
            } else if (btn.dataset.voxelWire !== undefined) {
              const m = t._voxelMesh; if (m) m.setShowWireframe?.(!m.getShowWireframe?.());
            } else if (btn.dataset.voxelResample !== undefined) {
              t.applyResolution?.(); // re-voxelize at _pendingRes
            } else {
              t._mode     = parseInt(btn.dataset.voxelMode, 10);
              t._negative = btn.dataset.voxelNeg === 'true';
            }
            main.render?.();
          }
          this.syncFromState();
        });
      });
      // Resolution slider: live preview (density overlay) on drag, re-voxelize on release.
      const resSlider = extras.querySelector('#mp-voxel-res');
      if (resSlider) {
        resSlider.addEventListener('input', () => {
          const v = parseInt(resSlider.value, 10);
          const valEl = extras.querySelector('#mp-voxel-res-val'); if (valEl) valEl.textContent = v;
          const t = sm?.getCurrentTool?.();
          t?.setResolutionPreview?.(v);
          if (t?._voxelMesh) VoxelDensityOverlay.enable(t._voxelMesh, v);
          getOptionsURL.saveOption(`tool_${Enums.Tools.VOXEL}_resolution`, v, 500);
        });
        resSlider.addEventListener('change', () => {
          VoxelDensityOverlay.disable();
          sm?.getCurrentTool?.()?.applyResolution?.();
          main.render?.();
        });
      }
    }

    // ── Extrude / Inset extras ─────────────────────────────────────────────
    if (idx === Enums.Tools.EXTRUDE || idx === Enums.Tools.INSET) {
      const keepBtn = extras.querySelector('#mp-keep-together');
      if (keepBtn) {
        keepBtn.addEventListener('click', () => {
          window.keepExtrudeFacesTogether = !(window.keepExtrudeFacesTogether ?? true);
          getOptionsURL.saveOption(`tool_${idx}_keepTogether`, window.keepExtrudeFacesTogether);
          main.render?.();
          this.syncFromState();
        });
      }
    }

  }

  // ── Incremental extras-state sync (no innerHTML rebuild) ─────────────────
  // Called by syncFromState() when the tool hasn't changed so we only update
  // toggle-button active classes in-place.  Never touches innerHTML so that
  // _colorWheel.draw()'s inline-style mutations are never disturbed.

  _syncExtrasActive(extrasEl, sm, idx, tool) {
    if (idx === Enums.Tools.BRUSH) {
      extrasEl.querySelector('#mp-clay')   ?.classList.toggle('active', !!tool._clay);
      extrasEl.querySelector('#mp-culling')?.classList.toggle('active', !!tool._culling);

    } else if (idx === Enums.Tools.SMOOTH || idx === Enums.Tools.RELAX) {
      extrasEl.querySelector('#mp-tangent')?.classList.toggle('active', !!tool._tangent);
      if (idx === Enums.Tools.SMOOTH) {
        extrasEl.querySelector('#mp-sharpen')?.classList.toggle('active', !!tool._negative);
      }

    } else if (idx === Enums.Tools.BONE_DRAW || idx === Enums.Tools.GRAB) {
      syncBoneSection(extrasEl, this._main);
      // HERE, not in a branch of its own further down: GRAB already matches this arm of the
      // chain, so a second `else if (idx === GRAB)` below it is unreachable and the buttons
      // never repaint. They were toggling the setting the whole time with nothing to show for
      // it -- matt: "they don't even pretend to disable visually."
      if (idx === Enums.Tools.GRAB) {
        const gch = GrabChannels.channels();
        extrasEl.querySelector('#mp-grab-translate')?.classList.toggle('active', gch.translate);
        extrasEl.querySelector('#mp-grab-rotate')?.classList.toggle('active', gch.rotate);
      }
    } else if (idx === Enums.Tools.TRANSFORM_VR || idx === Enums.Tools.TRANSFORM) {
      syncTransformSection(extrasEl, this._main);
      if (idx === Enums.Tools.TRANSFORM_VR) syncBoneSection(extrasEl, this._main);

    } else if (idx === Enums.Tools.VOXEL) {
      const curMode = tool._mode    ?? 0;
      const curNeg  = tool._negative ?? false;
      extrasEl.querySelectorAll('[data-voxel-mode]').forEach(btn => {
        const bMode = parseInt(btn.dataset.voxelMode, 10);
        const bNeg  = btn.dataset.voxelNeg === 'true';
        let active;
        if      (bMode === 0 && !bNeg) active = curMode === 0 && !curNeg;
        else if (bMode === 1 && !bNeg) active = curMode === 1 || (curMode === 0 && curNeg);
        else                           active = bMode === curMode && bNeg === curNeg;
        btn.classList.toggle('active', active);
      });
      const curShape = tool._shape ?? 0;
      extrasEl.querySelectorAll('[data-voxel-shape]').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.voxelShape, 10) === curShape);
      });
      extrasEl.querySelectorAll('[data-voxel-align]').forEach(btn => {
        btn.classList.toggle('active', !!(tool._alignToController));
      });
      extrasEl.querySelectorAll('[data-voxel-buildup]').forEach(btn => {
        btn.classList.toggle('active', !!(tool._buildUp));
      });
      const vm = tool._voxelMesh;
      extrasEl.querySelectorAll('[data-voxel-flat]').forEach(btn => {
        btn.classList.toggle('active', !!(vm?.getFlatShading?.()));
      });
      extrasEl.querySelectorAll('[data-voxel-wire]').forEach(btn => {
        btn.classList.toggle('active', !!(vm?.getShowWireframe?.()));
      });

    } else if (idx === Enums.Tools.MOVE || idx === Enums.Tools.SMOOTH) {
      const ch = MotionPathEdit.channels();
      extrasEl.querySelector('#mp-path-translate')?.classList.toggle('active', ch.translate);
      extrasEl.querySelector('#mp-path-rotate')?.classList.toggle('active', ch.rotate);
      extrasEl.querySelector('#mp-connected')
        ?.classList.toggle('active', MotionPathEdit.connected());
    } else if (idx === Enums.Tools.EXTRUDE || idx === Enums.Tools.INSET) {
      extrasEl.querySelector('#mp-keep-together')
        ?.classList.toggle('active', !!(window.keepExtrudeFacesTogether ?? true));
    }
  }

  // ── Build extras HTML for a given tool index ──────────────────────────────

  _buildExtrasHTML(sm, idx) {
    if (!sm) return '';

    // ── Brush ──────────────────────────────────────────────────────────────
    if (idx === Enums.Tools.BRUSH) {
      const t       = sm.getCurrentTool?.();
      const clay    = !!(t?._clay);
      const culling = !!(t?._culling);
      return `
        <hr class="mp-divider">
        <div class="mp-toggles">
          <button class="mp-toggle-btn${clay    ? ' active' : ''}" id="mp-clay">Clay</button>
          <button class="mp-toggle-btn${culling ? ' active' : ''}" id="mp-culling">Culling</button>
        </div>
      `;
    }

    // ── Bones ──────────────────────────────────────────────────────────────
    // The same controls the menu/sidebar shows, in the wrist panel's dialect. Mode lives
    // here rather than on a face button: the modes do not fit two buttons without each one
    // changing meaning by mode, which is what made the previous binding opaque.
    if (idx === Enums.Tools.BONE_DRAW) {
      // The quick display toggles used to be prepended HERE, because the wrist panel had no Rig
      // Display of its own and swapping solid for wireframe meant a trip to the main menu. They
      // now live inside the shared builder's "View and Assist" section, which puts them on both
      // panels and inside a fold, so this is one call again. Prepending them as well would render
      // the same five ids twice in one root and the second copy would win every wiring lookup.
      return buildBoneSectionHTML(this._main, 'mp');
    }

    if (idx === Enums.Tools.GRAB) {
      return `<hr class="mp-divider">${grabChannelHTML()}${setParentHTML(this._main)}`
        + buildBonePoseHTML(this._main, 'mp');
    }

    // ── Transform ──────────────────────────────────────────────────────────
    // Shared with the main menu's copy — see gui/transformPanel.js.
    if (idx === Enums.Tools.TRANSFORM_VR || idx === Enums.Tools.TRANSFORM) {
      return buildTransformSectionHTML(this._main, 'mp')
        + (idx === Enums.Tools.TRANSFORM_VR ? buildBonePoseHTML(this._main, 'mp') : '');
    }

    // ── Move ───────────────────────────────────────────────────────────────
    // How the brush measures "near" when Move is on a MOTION PATH. Always shown rather than
    // appearing with the path: a wrist control that comes and goes moves the buttons beside it
    // under your hand. Named "Path Falloff" so it is plainly about paths and not the mesh.
    if (idx === Enums.Tools.MOVE) {
      const on = MotionPathEdit.connected();
      return `
        <hr class="mp-divider">
        ${pathChannelHTML()}
        <div class="mp-toggles">
          <button class="mp-toggle-btn${on ? ' active' : ''}" id="mp-connected">Connectivity</button>
        </div>
      `;
    }

    // ── Smooth / Relax ─────────────────────────────────────────────────────
    if (idx === Enums.Tools.SMOOTH || idx === Enums.Tools.RELAX) {
      const t       = sm.getCurrentTool?.();
      const tangent = !!(t?._tangent);
      const sharpen = idx === Enums.Tools.SMOOTH && !!(t?._negative);
      return `
        <hr class="mp-divider">
        ${idx === Enums.Tools.SMOOTH ? pathChannelHTML() : ''}
        <div class="mp-toggles">
          <button class="mp-toggle-btn${tangent ? ' active' : ''}" id="mp-tangent">Tangent</button>
          ${idx === Enums.Tools.SMOOTH
            ? `<button class="mp-toggle-btn${sharpen ? ' active' : ''}" id="mp-sharpen">Sharpen</button>`
            : ''}
        </div>
      `;
    }

    // ── Masking ────────────────────────────────────────────────────────────
    if (idx === Enums.Tools.MASKING) {
      const t        = sm.getCurrentTool?.();
      const hardPct  = Math.round((t?._hardness  ?? 0.5) * 100);
      const thickPct = Math.round((t?._thickness ?? 0.5) * 100);
      return `
        <hr class="mp-divider">
        <div class="mp-btn-row">
          <button class="mp-action-btn" id="mp-mask-clear">Clear Mask</button>
          <button class="mp-action-btn" id="mp-mask-invert">Invert</button>
        </div>
        <div class="mp-row">
          <span class="mp-lbl">Hardness</span>
          <input type="range" id="mp-hardness" min="0" max="100" step="1" value="${hardPct}">
          <span class="mp-val" id="mp-hardness-val">${hardPct}%</span>
        </div>
        <div class="mp-row">
          <span class="mp-lbl">Thickness</span>
          <input type="range" id="mp-thickness" min="0" max="100" step="1" value="${thickPct}">
          <span class="mp-val" id="mp-thickness-val">${thickPct}%</span>
        </div>
      `;
    }

    // ── Paint ──────────────────────────────────────────────────────────────
    if (idx === Enums.Tools.PAINT) {
      const t        = sm.getCurrentTool?.();
      const roughPct = Math.round((t?._material?.[0] ?? 0.5) * 100);
      const metPct   = Math.round((t?._material?.[1] ?? 0.0) * 100);
      // Pure HTML/CSS colour wheel — no canvas, renders correctly through
      // SVG foreignObject.  Layout constants must match _CW_* at top of file.
      return `
        <hr class="mp-divider">
        ${buildColorWheelHTML({ prefix: 'mp-cw', size: 216, extras: true })}
        <hr class="mp-divider">
        <div class="mp-row">
          <span class="mp-lbl">Roughness</span>
          <input type="range" id="mp-roughness" min="0" max="100" step="1" value="${roughPct}">
          <span class="mp-val" id="mp-roughness-val">${roughPct}%</span>
        </div>
        <div class="mp-row">
          <span class="mp-lbl">Metalness</span>
          <input type="range" id="mp-metalness" min="0" max="100" step="1" value="${metPct}">
          <span class="mp-val" id="mp-metalness-val">${metPct}%</span>
        </div>
      `;
    }

    // ── Voxel ──────────────────────────────────────────────────────────────
    if (idx === Enums.Tools.VOXEL) {
      const t       = sm.getCurrentTool?.();
      const curMode = t?._mode ?? 0;
      const curNeg  = t?._negative ?? false;
      const curShape = t?._shape ?? 0; // 0=Sphere, 1=Box (brush volume shape)
      const curAlign = t?._alignToController ?? false; // Box brush follows controller rotation
      const vmesh    = t?._voxelMesh;                  // flat/wireframe live on the mesh
      const curBuildup = t?._buildUp ?? false;
      const curFlat    = vmesh?.getFlatShading?.() ?? false;
      const curWire    = vmesh?.getShowWireframe?.() ?? false;
      const curRes     = t?._pendingRes ?? t?._res ?? 128;

      // mode 0=Add, 1=Sub, 2=Inflate/Deflate, 3=Smooth, 4=Move
      const modes = [
        { mode: 0, neg: false, label: 'Add'     },
        { mode: 1, neg: false, label: 'Sub'     },
        { mode: 3, neg: false, label: 'Smooth'  },
        { mode: 4, neg: false, label: 'Move'    },
        { mode: 2, neg: false, label: 'Inflate' },
        { mode: 2, neg: true,  label: 'Deflate' },
      ];

      const isActiveMode = (m) => {
        if (m.mode === 0 && !m.neg) return curMode === 0 && !curNeg;
        if (m.mode === 1 && !m.neg) return curMode === 1 || (curMode === 0 && curNeg);
        return m.mode === curMode && m.neg === curNeg;
      };

      // Semantic tints matching toolTints.js / MainMenuPanel: deform (Add/Sub/Inflate/
      // Deflate) = red, Smooth = blue, Move = green.
      const modeTint = (m) => m.mode === 3 ? '#89b4fa' : m.mode === 4 ? '#a6e3a1' : '#f38ba8';
      const btns = modes.map(m =>
        `<button class="mp-voxel-btn${isActiveMode(m) ? ' active' : ''}" data-voxel-mode="${m.mode}" data-voxel-neg="${m.neg}" style="color:${modeTint(m)}">${m.label}</button>`
      ).join('');

      // Brush volume shape (sphere / box) — restored from the old VR menu.
      const shapeBtns = [{ shape: 0, label: 'Sphere' }, { shape: 1, label: 'Box' }].map(s =>
        `<button class="mp-voxel-btn${curShape === s.shape ? ' active' : ''}" data-voxel-shape="${s.shape}">${s.label}</button>`
      ).join('');

      return `
        <hr class="mp-divider">
        <div class="mp-voxel-grid">${btns}</div>
        <div class="mp-voxel-grid">${shapeBtns}</div>
        <div class="mp-voxel-grid"><button class="mp-voxel-btn${curAlign ? ' active' : ''}" data-voxel-align="1" title="Box brush follows controller rotation (Box shape only)">Align to hand</button></div>
        <div class="mp-voxel-grid">
          <button class="mp-voxel-btn${curBuildup ? ' active' : ''}" data-voxel-buildup="1" title="Tapered build-up (gradual stroke accumulation)">Build Up</button>
          <button class="mp-voxel-btn${curFlat ? ' active' : ''}" data-voxel-flat="1" title="Flat shading">Flat</button>
          <button class="mp-voxel-btn${curWire ? ' active' : ''}" data-voxel-wire="1" title="Show wireframe">Wire</button>
        </div>
        <div class="mp-row">
          <span class="mp-lbl">Resolution</span>
          <input type="range" id="mp-voxel-res" min="16" max="256" step="16" value="${curRes}">
          <span class="mp-val" id="mp-voxel-res-val">${curRes}</span>
        </div>
        <div class="mp-voxel-grid">
          <button class="mp-voxel-btn" data-voxel-resample="1" title="Re-voxelize at the chosen resolution (no undo)">Resample</button>
          <button class="mp-voxel-btn" data-voxel-bake="1" title="Convert this voxel object into an editable poly mesh">Convert to Mesh</button>
        </div>
      `;
    }

    // ── Extrude / Inset ────────────────────────────────────────────────────
    if (idx === Enums.Tools.EXTRUDE || idx === Enums.Tools.INSET) {
      const isActive = !!(window.keepExtrudeFacesTogether ?? true);
      return `
        <hr class="mp-divider">
        <button class="mp-keep-btn${isActive ? ' active' : ''}" id="mp-keep-together">Keep Together</button>
      `;
    }

    // TransformVR's Move / Rotate / Scale used to be built HERE, privately, which is why the main
    // panel had no way to change the gizmo's mode at all. It lives in the shared builder now (see
    // transformPanel.XF_MODES) and arrives through the Transform case above, so both panels get
    // it and there is one copy instead of two.

    return '';
  }

  // ── Sync DOM from app state ────────────────────────────────────────────────

  /**
   * Read the current sculpt manager state and reflect it in the HTML.
   * Safe to call before mesh exists — guards on this._element.
   */
  syncFromState() {
    if (!this._element) return;

    const main = this._main;
    const sm   = main.getSculptManager?.();
    const root = this._element;

    // ── Tool button ────────────────────────────────────────────────────────
    const idx      = sm?.getToolIndex?.() ?? 0;
    const tool     = sm?.getCurrentTool?.();
    const toolBtn  = root.querySelector('#mp-tool-btn');
    const toolName_ = toolName(idx);

    if (toolBtn) {
      toolBtn.style.background = toolTint(idx);
      const nameEl = root.querySelector('#mp-tool-name');
      if (nameEl) nameEl.textContent = toolName_;
    }

    // ── Radius ─────────────────────────────────────────────────────────────
    if (tool) {
      const rInput = root.querySelector('#mp-radius');
      const rVal   = root.querySelector('#mp-radius-val');
      if (rInput && rVal) {
        rInput.value     = tool._radius ?? 50;
        rVal.textContent = Math.round(tool._radius ?? 50);
      }

      // ── Intensity ────────────────────────────────────────────────────────
      const iInput = root.querySelector('#mp-intensity');
      const iVal   = root.querySelector('#mp-intensity-val');
      if (iInput && iVal) {
        const pct        = Math.round((tool._intensity ?? 0.5) * 100);
        iInput.value     = pct;
        iVal.textContent = pct + '%';
      }
    }

    // ── Symmetry ───────────────────────────────────────────────────────────
    root.querySelector('#mp-sym')?.classList.toggle('active', !!sm?._symmetry);

    // ── Negative ───────────────────────────────────────────────────────────
    // Same source of truth the toggle writes — reading the manager showed a state nothing had.
    root.querySelector('#mp-neg')?.classList.toggle('active', !!sm?.getCurrentTool?.()?._negative);

    // ── Wireframe ──────────────────────────────────────────────────────────
    const wf = main.getMesh?.()?.getShowWireframe?.() ?? false;
    root.querySelector('#mp-wire')?.classList.toggle('active', wf);

    // ── Tool-specific extras: rebuild HTML only when tool changes ─────────
    // IMPORTANT: do NOT compare extrasEl.innerHTML to the template string.
    // _colorWheel.draw() modifies inline styles on elements inside #mp-extras
    // (setting background:rgb(...), left:Xpx, etc.).  Those style changes land
    // in innerHTML, so a naive string comparison triggers a rebuild — and a
    // _needsResize / texture dispose — on every single syncFromState() call
    // while on the Paint tool, causing a ~1-second flicker cycle.
    const extrasEl = root.querySelector('#mp-extras');
    if (extrasEl) {
      // THE TOOL IS NOT THE ONLY THING THIS BLOCK DEPENDS ON. Keyed on the tool alone, selecting
      // a different bone never rebuilt it -- so the physics sliders, which exist only when a
      // flagged joint is selected, simply did not appear until something else forced a rebuild.
      // matt: "if i select the shoulder to bring up the physics properties, they're not
      // displayed. i have to click the physics button again to turn it off, then turn it on
      // again to display them", and, correctly: "are you reading the state of the selected bone
      // in order to know if you show the physics properties or not?" It is -- it just was not
      // re-reading it.
      //
      // JOINTS ONLY in the key. Keying on the whole selection would rebuild the block whenever a
      // sculpt selection changed, which is the per-sync churn the note above is about.
      const selKey = (main.getSelectedMeshes?.() || [])
        .filter((m) => m && m._isBone).map((m) => m.getID()).join(',');
      const extrasKey = idx + '|' + selKey;
      // The bisection switch that used to gate this (window._mpNoRebuild) is GONE, and its
      // settings entry with it. It answered its question in v3.30.39 -- the rebuild WAS the
      // cause, by nulling material.map and forcing a shader recompile -- and then stayed in the
      // menu, where its whole effect is "the wrist panel's tool controls never update again".
      // matt, months later: "i pin the tools, select the bone tool, the parameter pane that is
      // still on my wrist isn't updating." A debugging switch that outlives its investigation
      // is indistinguishable from a bug, and this one was reachable from the settings panel.
      if (this._lastExtrasKey !== extrasKey) {
        // Tool or bone selection changed: rebuild the whole block and re-wire.
        this._lastExtrasKey = extrasKey;
        this._lastExtrasIdx = idx;
        extrasEl.innerHTML  = this._buildExtrasHTML(sm, idx);
        this._wireExtras(main);
        // Defer geometry resize until _onPaint fires with the fresh texture.
        this._needsResize = true;
      } else if (tool) {
        // Same tool: only update active-class states in place; never touch innerHTML.
        this._syncExtrasActive(extrasEl, sm, idx, tool);
      }
    }

    // Keep the colour wheel canvas current on periodic syncs
    // (e.g. after eyedropper picks a colour from the scene).
    this._colorWheel?.draw();

    this._requestPaint();
  }

  // ── Paint request ──────────────────────────────────────────────────────────
  // markDirty() is enough — the XR render loop calls update() every frame which
  // drains the polyfill queue.  Calling flushPaint() (synchronous drain) on every
  // interaction was causing heavy per-frame rasterisation work and felt laggy.
  // flushPaint() is still used in _swapHtmlPanels (Scene.js) for the specific
  // case of needing a fresh texture before a panel becomes visible.

  _requestPaint() {
    this.markDirty();
  }

  // ── Pin state accessor ─────────────────────────────────────────────────────

  get pinned() { return this._pinned; }
}
