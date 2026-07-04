/**
 * AnimationControlPanel — single source of truth for animation UI.
 *
 * All HTML, CSS, wiring, and sync logic is exported as standalone functions
 * so the VR MainMenuPanel's Animation tab and the desktop sidebar panel share
 * the exact same implementation.
 *
 * Sections:
 *   1. Animation  (FPS, speed, duration/loop in frames, timeline toggle)
 *   2. Transport  (8-button bar + Clear All)
 *   3. Record     (Count In, Wait for Trigger, Bake Rate)
 *   4. Keyframes  (key mode, Add Key, Copy/Paste/Cut/Delete, Autokey)
 *   5. Blendshapes
 */

import { HTMLVRPanel, VR_PANEL_PX_PER_M } from './HTMLVRPanel.js';
import TimelineHelper from '../TimelineHelper.js';

// ── CSS ───────────────────────────────────────────────────────────────────────
// Uses .acp-root class prefix so the rules apply both to:
//   • #acp-root (standalone AnimationControlPanel sidebar element)
//   • .acp-root wrapper div inside MainMenuPanel's #mm-content area

const CSS = `
/* ── Animation section — Catppuccin Mocha ───────────────────────────────── */
.acp-root {
  color: #cdd6f4;
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 12px;
  user-select: none;
}
.acp-root .acp-section {
  margin-top: 12px;
}
.acp-root .acp-section-title {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #585b70;
  border-bottom: 1px solid #313244;
  padding-bottom: 4px;
  margin-bottom: 8px;
}
.acp-root .acp-stack {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.acp-root .acp-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.acp-root .acp-lbl {
  width: 80px;
  font-size: 11px;
  color: #a6adc8;
  flex-shrink: 0;
}
.acp-root .acp-val {
  width: 36px;
  text-align: right;
  font-size: 11px;
  color: #89b4fa;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}
.acp-root input[type=range] {
  flex: 1;
  accent-color: #89b4fa;
  height: 4px;
  cursor: pointer;
  min-width: 0;
}
.acp-root .acp-frame-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}
.acp-root .acp-frame-cell {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.acp-root .acp-frame-cell label {
  font-size: 10px;
  color: #6c7086;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.acp-root .acp-frame-cell input[type=number] {
  width: 100%;
  padding: 5px 8px;
  background: #181825;
  border: 1px solid #313244;
  border-radius: 6px;
  color: #cdd6f4;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  box-sizing: border-box;
  outline: none;
}
.acp-root .acp-frame-cell input[type=number]:focus { border-color: #89b4fa; }
.acp-root .acp-row input[type=number] {
  flex: 1; min-width: 0; padding: 5px 8px;
  background: #181825; border: 1px solid #313244; border-radius: 6px;
  color: #cdd6f4; font-size: 13px; font-variant-numeric: tabular-nums;
  box-sizing: border-box; outline: none;
}
.acp-root .acp-row input[type=number]:focus { border-color: #89b4fa; }
.acp-root .acp-check-row {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 12px;
  color: #a6adc8;
}
.acp-root .acp-check-row input[type=checkbox] {
  width: 14px; height: 14px;
  accent-color: #89b4fa;
  cursor: pointer;
  flex-shrink: 0;
}
.acp-root .acp-key-inspector {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 2px 5px;
  padding: 3px 0;
}
.acp-root .acp-key-inspector .acp-frame-cell {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 3px;
}
.acp-root .acp-key-inspector .acp-frame-cell label {
  font-size: 10px;
  color: #888;
  white-space: nowrap;
  min-width: 10px;
  text-align: right;
}
.acp-root .acp-key-inspector .acp-frame-cell input {
  width: 54px;
  font-size: 11px;
  padding: 1px 3px;
  height: 20px;
  box-sizing: border-box;
}
.acp-root .acp-transport {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 4px;
}
.acp-root .acp-transport button {
  padding: 9px 0;
  border: 1px solid #313244;
  border-radius: 6px;
  background: #181825;
  color: #a6adc8;
  font-size: 13px;
  cursor: pointer;
  text-align: center;
  outline: none;
  transition: background 0.1s, color 0.1s;
}
.acp-root .acp-transport button:hover,
.acp-root .acp-transport button.hover    { background: #24243e; color: #cdd6f4; }
.acp-root .acp-transport button.active   { background: #313244; color: #a6e3a1; border-color: #a6e3a1; }
.acp-root .acp-transport button.recording { background: #3d1e2e; color: #f38ba8; border-color: #f38ba8; }
.acp-root .acp-btn-grid {
  display: flex;
  gap: 4px;
}
.acp-root .acp-btn-grid button {
  flex: 1;
  padding: 8px 4px;
  border: 1px solid #313244;
  border-radius: 6px;
  background: #181825;
  color: #a6adc8;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  text-align: center;
  outline: none;
  transition: background 0.1s;
}
.acp-root .acp-btn-grid button:hover,
.acp-root .acp-btn-grid button.hover { background: #24243e; color: #cdd6f4; }
.acp-root .acp-btn-grid button.danger { color: #f38ba8; border-color: #f38ba8; }
.acp-root .acp-btn-grid button.danger:hover,
.acp-root .acp-btn-grid button.danger.hover { background: #3d1e2e; }
.acp-root .acp-select { width: 100%; }
.acp-root .acp-select-trigger {
  width: 100%; padding: 5px 8px; box-sizing: border-box;
  background: #181825; color: #cdd6f4; border: 1px solid #313244;
  border-radius: 6px; font-size: 11px; cursor: pointer; text-align: left;
  display: flex; justify-content: space-between; align-items: center; outline: none;
}
.acp-root .acp-select-trigger::after { content: ' ▾'; color: #585b70; flex-shrink: 0; }
.acp-root .acp-select-opts {
  border: 1px solid #313244; border-top: none; border-radius: 0 0 6px 6px;
  background: #181825; overflow: hidden;
}
.acp-root .acp-select-opt {
  display: block; width: 100%; text-align: left; padding: 6px 12px;
  background: transparent; color: #a6adc8; border: none; font-size: 11px;
  cursor: pointer; box-sizing: border-box; outline: none;
}
.acp-root .acp-select-opt:hover,
.acp-root .acp-select-opt.hover { background: #24243e; color: #cdd6f4; }
.acp-root .acp-select-opt.active { color: #89b4fa; }
.acp-root .acp-btn-full {
  width: 100%;
  padding: 9px;
  border: 1px solid #cba6f7;
  border-radius: 6px;
  background: #181825;
  color: #cba6f7;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  text-align: center;
  outline: none;
  transition: background 0.1s;
}
.acp-root .acp-btn-full:hover,
.acp-root .acp-btn-full.hover { background: #2a2040; }
.acp-root .acp-btn-clear {
  width: 100%;
  padding: 8px;
  border: 1px solid #45475a;
  border-radius: 6px;
  background: #181825;
  color: #6c7086;
  font-size: 11px;
  cursor: pointer;
  text-align: center;
  outline: none;
  transition: background 0.1s, color 0.1s, border-color 0.1s;
}
.acp-root .acp-btn-clear:hover,
.acp-root .acp-btn-clear.hover { background: #3d1e2e; color: #f38ba8; border-color: #f38ba8; }
.acp-root .acp-btn-timeline {
  width: 100%;
  padding: 9px;
  border: 1px solid #89b4fa;
  border-radius: 6px;
  background: #181825;
  color: #89b4fa;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  text-align: center;
  outline: none;
  transition: background 0.1s, color 0.1s;
}
.acp-root .acp-btn-timeline:hover,
.acp-root .acp-btn-timeline.hover { background: #1a2040; }
.acp-root .acp-btn-timeline.active { background: #1e2d5a; color: #cdd6f4; border-color: #89b4fa; box-shadow: 0 0 0 1px #89b4fa; }
.acp-root .acp-addkey-row { display: flex; gap: 6px; align-items: stretch; }
.acp-root .acp-addkey-row .acp-btn-full { flex: 3; width: auto; }
.acp-root .acp-btn-autokey {
  flex: 1;
  padding: 9px 6px;
  border: 1px solid #757575;
  border-radius: 6px;
  background: #141414;
  color: #757575;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  text-align: center;
  outline: none;
  transition: background 0.1s, color 0.1s;
}
.acp-root .acp-btn-autokey:hover,
.acp-root .acp-btn-autokey.hover { background: #1e1e1e; }
.acp-root .acp-btn-autokey.active { background: #94e2d5; color: #1e1e2e; border-color: #94e2d5; }
.acp-root .acp-mode-row {
  display: flex;
  gap: 0;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid #313244;
}
.acp-root .acp-mode-btn {
  flex: 1;
  padding: 7px 0;
  border: none;
  background: #181825;
  color: #6c7086;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  text-align: center;
  outline: none;
  transition: background 0.1s, color 0.1s;
}
.acp-root .acp-mode-btn.active { background: #313244; color: #cba6f7; }
.acp-root .acp-mode-btn:hover:not(.active),
.acp-root .acp-mode-btn.hover:not(.active) { background: #24243e; color: #a6adc8; }
.acp-root .acp-placeholder {
  font-size: 11px;
  color: #45475a;
  font-style: italic;
  padding: 4px 0;
}
.acp-root .acp-bs-create { display: flex; gap: 6px; }
.acp-root .acp-bs-create input[type=text] {
  flex: 1; padding: 5px 8px; background: #181825; border: 1px solid #313244;
  border-radius: 6px; color: #cdd6f4; font-size: 12px; outline: none;
}
.acp-root .acp-bs-create input[type=text]:focus { border-color: #89b4fa; }
.acp-root .acp-bs-create button {
  padding: 5px 12px; background: #181825; border: 1px solid #313244;
  border-radius: 6px; color: #a6e3a1; font-size: 14px; font-weight: 700;
  cursor: pointer; outline: none; flex-shrink: 0;
}
.acp-root .acp-bs-create button:hover { background: #1e3a2a; border-color: #a6e3a1; }
.acp-root .acp-bs-row {
  border: 1px solid #313244; border-radius: 7px; padding: 7px 9px; background: #181825;
}
.acp-root .acp-bs-row.editing { border-color: #a6e3a1; background: #131d18; }
.acp-root .acp-bs-base {
  border: 1px solid #45475a; border-radius: 7px; padding: 6px 9px; background: #1e1e2e;
  display: flex; align-items: center; gap: 6px; cursor: pointer;
}
.acp-root .acp-bs-base:hover { border-color: #585b70; }
.acp-root .acp-bs-base.editing { border-color: #a6e3a1; background: #131d18; }
.acp-root .acp-bs-base .acp-bs-edit { flex-shrink: 0; }
.acp-root .acp-bs-base .acp-bs-label { color: #585b70; font-style: italic; cursor: pointer; }
.acp-root .acp-bs-base.editing .acp-bs-label { color: #a6e3a1; font-style: normal; }
.acp-root .acp-bs-header { display: flex; align-items: center; gap: 6px; margin-bottom: 5px; }
.acp-root .acp-bs-num {
  width: 52px; padding: 3px 5px; background: #1e1e2e; border: 1px solid #313244;
  border-radius: 5px; color: #89b4fa; font-size: 11px; font-variant-numeric: tabular-nums;
  text-align: right; outline: none; flex-shrink: 0;
}
.acp-root .acp-bs-num:focus { border-color: #89b4fa; }
.acp-root .acp-bs-rename-input {
  flex: 1; min-width: 0; padding: 1px 4px; font-size: 12px; font-family: inherit;
  background: #1e1e2e; color: #cdd6f4; border: 1px solid #89b4fa; border-radius: 3px; outline: none;
}
.acp-root .acp-bs-label {
  flex: 1; font-size: 12px; color: #cdd6f4; cursor: pointer;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.acp-root .acp-bs-label:hover { color: #fff; }
.acp-root .acp-bs-row.editing .acp-bs-label { color: #a6e3a1; }
.acp-root .acp-bs-edit {
  width: 14px; height: 14px; border-radius: 50%; border: 2px solid #45475a;
  background: transparent; cursor: pointer; outline: none; flex-shrink: 0; padding: 0;
  transition: border-color 0.1s, background 0.1s;
}
.acp-root .acp-bs-edit.active { border-color: #a6e3a1; background: #a6e3a1; }
.acp-root .acp-bs-toolbar {
  display: flex; gap: 4px; align-items: center;
}
.acp-root .acp-bs-toolbar button {
  flex: 1; padding: 5px 4px; border: 1px solid #313244; border-radius: 6px;
  background: #181825; color: #a6adc8; font-size: 11px; cursor: pointer; outline: none;
  transition: background 0.1s, color 0.1s;
}
.acp-root .acp-bs-toolbar button:hover { background: #24243e; color: #cdd6f4; }
.acp-root #acp-bs-del-btn { color: #6c7086; }
.acp-root #acp-bs-del-btn:hover { color: #f38ba8; border-color: #f38ba8; background: #3d1e2e; }
.acp-root .acp-bs-key:hover { color: #ff9944; border-color: #ff9944; background: #3a2a1e; }
.acp-root .acp-bs-mode { display: flex; border: 1px solid #45475a; border-radius: 5px; overflow: hidden; flex-shrink: 0; }
.acp-root .acp-bs-mode button {
  flex: none; padding: 4px 9px; font-size: 11px; background: transparent; border: none;
  color: #6c7086; cursor: pointer; outline: none; transition: background 0.1s, color 0.1s;
}
.acp-root .acp-bs-mode button:hover { color: #cdd6f4; }
.acp-root .acp-bs-mode button.active { background: #313244; color: #cdd6f4; }
.acp-root .acp-bs-slider:disabled, .acp-root .acp-bs-num:disabled { opacity: 0.3; pointer-events: none; }
`;

let _cssInjected = false;
export function injectAnimCSS() {
  if (_cssInjected) return;
  _cssInjected = true;
  const s = document.createElement('style');
  s.textContent = CSS;
  document.head.appendChild(s);
}

// ── Shared HTML builder ───────────────────────────────────────────────────────
// Returns the animation section wrapped in .acp-root so CSS scoping works
// whether embedded inside MainMenuPanel's #mm-content or as a standalone panel.

export function buildAnimationSectionHTML() {
  return `<div class="acp-root">
    <!-- 1. Animation -->
    <div class="acp-section">
      <div class="acp-section-title">Animation</div>
      <div class="acp-stack">
        <div class="acp-frame-grid" style="grid-template-columns:repeat(2,1fr)">
          <div class="acp-frame-cell">
            <label>FPS</label>
            <input type="number" id="acp-fps" min="1" max="60" step="1" value="24">
          </div>
          <div class="acp-frame-cell">
            <label>Speed</label>
            <input type="number" id="acp-speed" min="0.1" max="4" step="0.1" value="1">
          </div>
        </div>
        <div class="acp-frame-grid">
          <div class="acp-frame-cell">
            <label>Duration</label>
            <input type="number" id="acp-duration" min="1" step="1" value="48">
          </div>
          <div class="acp-frame-cell">
            <label>Start</label>
            <input type="number" id="acp-loop-start" min="0" step="1" value="0">
          </div>
          <div class="acp-frame-cell">
            <label>End</label>
            <input type="number" id="acp-loop-end" min="1" step="1" value="48">
          </div>
        </div>
        <label class="acp-check-row" style="margin-top:16px">
          <input type="checkbox" id="acp-onion" checked> Onion skin (frames)
        </label>
        <label class="acp-check-row">
          <input type="checkbox" id="acp-onion-loop"> Loop-aware onion
        </label>
      </div>
    </div>

    <!-- 2. Transport -->
    <div class="acp-section">
      <div class="acp-section-title">Transport</div>
      <div class="acp-stack">
        <div class="acp-transport">
          <button id="acp-to-start"   title="Jump to start"><i class="fa-solid fa-backward-step"></i></button>
          <button id="acp-prev-frame" title="Previous frame"><i class="fa-solid fa-backward"></i></button>
          <button id="acp-play-rev"   title="Play backwards"><i class="fa-solid fa-play" style="transform:scaleX(-1);display:inline-block"></i></button>
          <button id="acp-stop"       title="Stop"><i class="fa-solid fa-stop"></i></button>
          <button id="acp-play-fwd"   title="Play forwards"><i class="fa-solid fa-play"></i></button>
          <button id="acp-next-frame" title="Next frame"><i class="fa-solid fa-forward"></i></button>
          <button id="acp-to-end"     title="Jump to end"><i class="fa-solid fa-forward-step"></i></button>
          <button id="acp-record"     title="Record"><i class="fa-solid fa-circle" style="color:#f38ba8"></i></button>
        </div>
        <button class="acp-btn-clear" id="acp-clear-all">Clear all animation</button>
        <button class="acp-btn-full" id="acp-bake-voxel" style="display:none"
          title="Voxel frame animations can't be saved to .sxr (the voxel field is runtime-only). Bake to a plain mesh-frame animation that saves and reloads. Undoable.">Bake voxel anim &rarr; mesh frames</button>
      </div>
    </div>

    <!-- 3. Record -->
    <div class="acp-section">
      <div class="acp-section-title">Record</div>
      <div class="acp-stack">
        <label class="acp-check-row">
          <input type="checkbox" id="acp-count-in"> Count in
        </label>
        <label class="acp-check-row">
          <input type="checkbox" id="acp-wait-trigger"> Wait for Trigger
        </label>
        <div class="acp-stack" style="gap:4px">
          <label style="font-size:10px;color:#6c7086;text-transform:uppercase;letter-spacing:.06em">Bake rate</label>
          <div class="acp-select" id="acp-bake-rate-wrap">
            <button class="acp-select-trigger" id="acp-bake-rate">Standard (~10 fps)</button>
            <div class="acp-select-opts" style="display:none">
              <button class="acp-select-opt" data-bakerate="0.033">Dense (~30 fps)</button>
              <button class="acp-select-opt active" data-bakerate="0.1">Standard (~10 fps)</button>
              <button class="acp-select-opt" data-bakerate="0.5">Sparse (2 fps)</button>
              <button class="acp-select-opt" data-bakerate="1.0">Step Key (1 fps)</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 4. Keyframes -->
    <div class="acp-section">
      <div class="acp-section-title">Keyframes</div>
      <div class="acp-stack">
        <div class="acp-mode-row">
          <button class="acp-mode-btn" data-mode="shape">Shape</button>
          <button class="acp-mode-btn" data-mode="transform">Transform</button>
          <button class="acp-mode-btn" data-mode="blendshape">Blendshape</button>
        </div>
        <div class="acp-addkey-row">
          <button class="acp-btn-full" id="acp-add-key">&#9670; Add Key</button>
          <button class="acp-btn-autokey" id="acp-autokey-btn">Autokey</button>
        </div>
        <div class="acp-btn-grid">
          <button id="acp-copy-key">Copy</button>
          <button id="acp-paste-key">Paste</button>
          <button id="acp-cut-key">Cut</button>
          <button id="acp-del-key" class="danger">Delete</button>
        </div>
      </div>
    </div>

    <!-- 5. Selected Key Inspector -->
    <div class="acp-section" id="acp-key-inspector-section">
      <div class="acp-section-title">Selected Key</div>
      <div class="acp-stack">
        <div class="acp-key-inspector" id="acp-key-inspector">
          <div class="acp-frame-cell">
            <label>Fr</label>
            <input type="text" id="acp-key-frame" inputmode="decimal" placeholder="—">
          </div>
          <div class="acp-frame-cell" id="acp-key-v1-cell">
            <label id="acp-key-v1-label">X</label>
            <input type="text" id="acp-key-v1" inputmode="decimal" placeholder="—">
          </div>
          <div class="acp-frame-cell" id="acp-key-v2-cell">
            <label id="acp-key-v2-label">Y</label>
            <input type="text" id="acp-key-v2" inputmode="decimal" placeholder="—">
          </div>
          <div class="acp-frame-cell" id="acp-key-v3-cell">
            <label id="acp-key-v3-label">Z</label>
            <input type="text" id="acp-key-v3" inputmode="decimal" placeholder="—">
          </div>
        </div>
      </div>
    </div>

    <!-- 6. Blendshapes — moved to the dedicated canvas BlendshapeStackPanel
         ("Blendshapes" sidebar tab on desktop; VR mount pending). The blendshape
         keyframe mode in the Keyframes section above is unaffected. The shared
         refreshBlendshapesDOM / acp-bs-* wiring below now no-ops (it guards on the
         absent #acp-bs-list) and stays for its other importers. -->
  </div>`;
}

// ── Shared range-drag handler ─────────────────────────────────────────────────
// Native range dragging can be stolen by window-level pointer handlers in VR.
// This explicit capture works in both the DOM overlay and in VR panels.

export function setupRangeDrag(root) {
  root.querySelectorAll('input[type=range]').forEach(input => {
    let active = false;
    const getVal = (clientX) => {
      const r    = input.getBoundingClientRect();
      const t    = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
      const min  = parseFloat(input.min)  || 0;
      const max  = parseFloat(input.max)  || 100;
      const step = parseFloat(input.step) || 1;
      const raw  = min + t * (max - min);
      return Math.max(min, Math.min(max, Math.round(raw / step) * step));
    };
    input.addEventListener('pointerdown', (e) => {
      const newVal = getVal(e.clientX);
      active = true; input.setPointerCapture(e.pointerId);
      input.value = newVal;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      e.stopPropagation();
    });
    input.addEventListener('pointermove', (e) => {
      if (!active) return;
      input.value = getVal(e.clientX);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      e.stopPropagation();
    });
    input.addEventListener('pointerup', (e) => {
      if (!active) return; active = false;
      if (input.hasPointerCapture(e.pointerId)) input.releasePointerCapture(e.pointerId);
      e.stopPropagation();
    });
    input.addEventListener('lostpointercapture', () => { active = false; });
  });
}

// ── Shared blendshape list builder ────────────────────────────────────────────

export function refreshBlendshapesDOM(el, mesh, main, repaint) {
  const list = el.querySelector('#acp-bs-list');
  if (!list) return;
  list.innerHTML = '';

  const mode  = window._bsMode ?? 'blend';
  el.querySelector('#acp-bs-mode-blend')?.classList.toggle('active', mode === 'blend');
  el.querySelector('#acp-bs-mode-edit') ?.classList.toggle('active', mode === 'edit');

  const reg   = window._animationRegistry;
  const track = reg?.tracks.get(mesh?.getID());

  if (!track?.blendshapes?.size) {
    // No blendshapes yet — just show the base layer.
    const baseRow = document.createElement('div');
    baseRow.className = 'acp-bs-base editing';
    baseRow.innerHTML = `<button class="acp-bs-edit active"></button><span class="acp-bs-label">Base</span>`;
    list.appendChild(baseRow);
    repaint?.();
    return;
  }

  // Layers in reverse insertion order (most recent at top), Base at bottom.
  const layerEntries = [...track.blendshapes.keys()].reverse();
  layerEntries.forEach((name) => {
    const bTrack = track.blendshapeTracks?.get(name);
    const weight = bTrack?.times?.length
      ? (reg.evaluateScalarTrack?.(bTrack, track.playbackTime) ?? 0)
      : 0;
    const isEditing = mode === 'edit' && track.editingBlendshape === name;
    // In edit mode, disable controls for all layers except the active one.
    const isLocked  = mode === 'edit' && !isEditing;

    const row = document.createElement('div');
    row.className = 'acp-bs-row' + (isEditing ? ' editing' : '');
    row.dataset.bsName = name;
    row.innerHTML = `
      <div class="acp-bs-header">
        <button class="acp-bs-edit${isEditing ? ' active' : ''}"
          title="${mode === 'edit' ? (isEditing ? 'Deselect layer' : 'Select layer for sculpting') : ''}"></button>
        <span class="acp-bs-label">${name}</span>
        <input type="number" class="acp-bs-num" min="0" max="1" step="0.01"
          value="${weight.toFixed(2)}"${isLocked ? ' disabled' : ''}>
      </div>
      <input type="range" class="acp-bs-slider" min="0" max="1" step="0.01"
        value="${weight}"${isLocked ? ' disabled' : ''}>
    `;

    const slider   = row.querySelector('.acp-bs-slider');
    const numInput = row.querySelector('.acp-bs-num');
    let startVal   = weight;

    // RAF-throttle the expensive vertex computation (applyBlendshapes + GPU upload).
    // The slider UI updates immediately so there's no perceived lag, but the 3D mesh
    // recompute is deferred to at most once per display frame.
    let _rafId  = null;
    let _rafVal = weight;
    const applyWeight = (val) => {
      _rafVal        = val;
      slider.value   = val;
      numInput.value = val.toFixed(2);
      if (_rafId !== null) return;
      _rafId = requestAnimationFrame(() => {
        _rafId = null;
        reg.setBlendshapeWeight?.(mesh, name, _rafVal);
        repaint?.();
      });
    };

    slider.addEventListener('focus', () => { startVal = parseFloat(slider.value); });
    slider.addEventListener('input', () => {
      window._lastActiveBlendshape = name;
      window._lastActiveBlendshapeWeight = parseFloat(slider.value);
      applyWeight(parseFloat(slider.value));
    });
    slider.addEventListener('change', () => {
      const newVal = parseFloat(slider.value), oldVal = startVal;
      main?.getStateManager?.()?.pushStateCustom(
        () => { applyWeight(oldVal); refreshBlendshapesDOM(el, mesh, main, repaint); },
        () => { applyWeight(newVal); refreshBlendshapesDOM(el, mesh, main, repaint); },
        false, 'Change Blendshape Weight'
      );
    });

    numInput.addEventListener('keydown', (e) => e.stopPropagation());
    numInput.addEventListener('keyup',   (e) => e.stopPropagation());
    numInput.addEventListener('focus',   () => { startVal = parseFloat(numInput.value) || 0; });
    numInput.addEventListener('input',   () => applyWeight(parseFloat(numInput.value) || 0));
    numInput.addEventListener('change',  () => {
      const newVal = parseFloat(numInput.value) || 0, oldVal = startVal;
      main?.getStateManager?.()?.pushStateCustom(
        () => { applyWeight(oldVal); refreshBlendshapesDOM(el, mesh, main, repaint); },
        () => { applyWeight(newVal); refreshBlendshapesDOM(el, mesh, main, repaint); },
        false, 'Change Blendshape Weight'
      );
      startVal = newVal;
    });

    const _toggleLayer = () => {
      if (mode !== 'edit') return;
      const tr = reg.tracks.get(mesh.getID());
      window._lastActiveBlendshape = name;
      if (tr?.editingBlendshape === name) reg.exitBlendshapeEditMode?.(mesh);
      else {
        if (tr?.editingBlendshape) reg.exitBlendshapeEditMode?.(mesh);
        reg.enterBlendshapeEditMode?.(mesh, name);
      }
      refreshBlendshapesDOM(el, mesh, main, repaint);
    };
    const editBtn = row.querySelector('.acp-bs-edit');
    editBtn.style.opacity = mode === 'edit' ? '' : '0.3';
    editBtn.style.pointerEvents = mode === 'edit' ? '' : 'none';
    editBtn.addEventListener('click', _toggleLayer);

    // Single click on label = toggle layer; double-click = rename inline.
    const _label = row.querySelector('.acp-bs-label');
    let _clickTimer = null;
    _label.addEventListener('click', (e) => {
      e.stopPropagation();
      if (_clickTimer) { clearTimeout(_clickTimer); _clickTimer = null; return; }
      _clickTimer = setTimeout(() => { _clickTimer = null; _toggleLayer(); }, 250);
    });
    _label.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const _useVrKb = !!window._vrKeyboard?.shouldUse?.();
      const input = document.createElement('input');
      input.type = 'text';
      input.value = name;
      input.className = 'acp-bs-rename-input';
      if (_useVrKb) input.inputMode = 'none'; // suppress the Quest system keyboard
      _label.replaceWith(input);
      if (!_useVrKb) input.select();
      let _committed = false;
      const _commit = () => {
        if (_committed) return; _committed = true;
        const newName = input.value.trim();
        if (newName && newName !== name) {
          reg.renameBlendshape?.(mesh, name, newName);
          refreshBlendshapesDOM(el, mesh, main, repaint);
        } else {
          input.replaceWith(_label);
        }
      };
      const _cancel = () => {
        if (_committed) return; _committed = true;
        input.replaceWith(_label);
      };
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { input.blur(); }
        else if (e.key === 'Escape') { input.removeEventListener('blur', _commit); _cancel(); }
      });
      // VR: no physical keyboard — drive commit/cancel from the on-screen keyboard and
      // skip blur-commit (it would fire the stale value the moment the keyboard opens).
      if (_useVrKb) {
        window._vrKeyboard.open(input.value, { label: 'Rename layer', maxLength: 40, onCancel: _cancel }, (text) => {
          const v = (text ?? '').trim();
          if (v) input.value = v;
          _commit();
        }, input, null);
      } else {
        input.addEventListener('blur', _commit);
        input.focus(); // focus triggers the Quest system keyboard — skip it in VR
      }
    });

    setupRangeDrag(row);
    list.appendChild(row);
  });

  // Base layer always at the bottom.
  const baseIsActive = mode === 'edit' && !track?.editingBlendshape;
  const baseRow = document.createElement('div');
  baseRow.className = 'acp-bs-base' + (baseIsActive ? ' editing' : '');
  baseRow.innerHTML = `<button class="acp-bs-edit${baseIsActive ? ' active' : ''}"
    style="${mode !== 'edit' ? 'opacity:0.3;pointer-events:none' : ''}"></button>
    <span class="acp-bs-label">Base</span>`;
  if (mode === 'edit') {
    baseRow.addEventListener('click', () => {
      if (track?.editingBlendshape) reg.exitBlendshapeEditMode?.(mesh);
      refreshBlendshapesDOM(el, mesh, main, repaint);
    });
  }
  list.appendChild(baseRow);

  repaint?.();
}

// ── Shared sync (updates DOM from window.* globals) ───────────────────────────

export function syncAnimationSection(el, main) {
  const r       = window._animationRegistry;
  const playing = !!window._animPlaying;
  const rec     = !!(r?.isRecording || r?.isCountingIn);
  const playFwd = playing && r?.playbackDirection !== -1;
  const playRev = playing && r?.playbackDirection === -1;
  const f       = window._animFPS || 24;

  el.querySelector('#acp-play-fwd')?.classList.toggle('active',    playFwd && !rec);
  el.querySelector('#acp-play-rev')?.classList.toggle('active',    playRev && !rec);
  el.querySelector('#acp-record')  ?.classList.toggle('recording', rec);

  const timeline = main?.getGui?.()._ctrlTimeline;
  const tlVisible = !!(timeline?._visible);
  const showTl = el.querySelector('#acp-show-timeline-btn');
  if (showTl) showTl.classList.toggle('active', tlVisible);
  if (window._animTimelineTabEl) window._animTimelineTabEl.classList.toggle('tl-on', tlVisible);

  const fpsInput = el.querySelector('#acp-fps');
  const fpsVal   = el.querySelector('#acp-fps-val');
  if (fpsInput) fpsInput.value = f;
  if (fpsVal)   fpsVal.textContent = f;

  const spd = window._animPlaybackSpeed || 1.0;
  const spdInput = el.querySelector('#acp-speed');
  const spdVal   = el.querySelector('#acp-speed-val');
  if (spdInput) spdInput.value = spd;
  if (spdVal)   spdVal.textContent = spd.toFixed(1) + 'x';

  const dur = el.querySelector('#acp-duration');
  if (dur) dur.value = Math.round((window._animMasterDuration || 2) * f);
  const ls = el.querySelector('#acp-loop-start');
  if (ls) ls.value = Math.round((window._animLoopStart || 0) * f);
  const le = el.querySelector('#acp-loop-end');
  if (le) le.value = Math.round(((window._animLoopEnd ?? window._animMasterDuration) || 2) * f);

  const ci = el.querySelector('#acp-count-in');
  if (ci) ci.checked = !!window._animCountIn;
  const wt = el.querySelector('#acp-wait-trigger');
  if (wt) wt.checked = !!window._animWaitForTrigger;

  // Bake is obsolete — voxel frame animation persists directly now.
  const bakeBtn = el.querySelector('#acp-bake-voxel');
  if (bakeBtn) bakeBtn.style.display = 'none';

  const bakeRate = String(window._animCaptureRate || 0.1);
  el.querySelectorAll('[data-bakerate]').forEach(b => {
    const match = b.dataset.bakerate === bakeRate;
    b.classList.toggle('active', match);
    if (match) {
      const trigger = el.querySelector('#acp-bake-rate');
      if (trigger?.childNodes[0]) trigger.childNodes[0].textContent = b.textContent;
    }
  });

  const mode = window._animKeyMode || 'shape';
  el.querySelectorAll('.acp-mode-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === mode)
  );

  const ak = el.querySelector('#acp-autokey-btn');
  if (ak) ak.classList.toggle('active', !!window._animAutoKey);

  // Selected key inspector.
  _syncKeyInspector(el, main);
}

function _syncKeyInspector(el, main) {
  const grid = el.querySelector('#acp-key-inspector');
  if (!grid) return;

  const reg = window._animationRegistry;
  const sel = window._animSelectedKeys;
  const fps = window._animFPS || 24;

  const frameInput = el.querySelector('#acp-key-frame');
  const v1Cell  = el.querySelector('#acp-key-v1-cell');
  const v2Cell  = el.querySelector('#acp-key-v2-cell');
  const v3Cell  = el.querySelector('#acp-key-v3-cell');
  const v1Label = el.querySelector('#acp-key-v1-label');
  const v2Label = el.querySelector('#acp-key-v2-label');
  const v3Label = el.querySelector('#acp-key-v3-label');
  const v1Input = el.querySelector('#acp-key-v1');
  const v2Input = el.querySelector('#acp-key-v2');
  const v3Input = el.querySelector('#acp-key-v3');

  const _setOrClear = (inp, val, decimals = 3) => {
    if (!inp || document.activeElement === inp) return;
    inp.value = val != null ? Number(val).toFixed(decimals) : '';
  };

  // No selection → show empty disabled fields
  if (!sel?.length || !reg) {
    if (frameInput) { frameInput.value = ''; frameInput.disabled = true; }
    [v1Input, v2Input, v3Input].forEach(i => { if (i) { i.value = ''; i.disabled = true; } });
    v1Cell?.style && (v1Cell.style.display = '');
    v2Cell?.style && (v2Cell.style.display = '');
    v3Cell?.style && (v3Cell.style.display = '');
    if (v1Label) v1Label.textContent = 'X';
    if (v2Label) v2Label.textContent = 'Y';
    if (v3Label) v3Label.textContent = 'Z';
    return;
  }

  // Enable all inputs
  if (frameInput) frameInput.disabled = false;
  [v1Input, v2Input, v3Input].forEach(i => { if (i) i.disabled = false; });

  const single = sel.length === 1 ? sel[0] : null;
  const allTransform = sel.every(k => k.type === 'transform');
  const allSameMesh  = sel.every(k => k.meshId === sel[0].meshId);

  // Helper: common value across selected keys for a given accessor, or null if mixed.
  const _common = (fn) => {
    const vals = sel.map(fn).filter(v => v != null);
    if (!vals.length) return null;
    const first = vals[0];
    return vals.every(v => Math.abs(v - first) < 0.0005) ? first : null;
  };

  if (single) {
    // Single-key mode
    const track = reg.tracks.get(single.meshId);
    if (!track) return;
    const kIdx = single.index;
    const _tForKey = () => {
      if (single.type === 'transform') return track.times?.[kIdx] ?? 0;
      if (single.type === 'blendshape' && single.name)
        return track.blendshapeTracks?.get(single.name)?.times?.[kIdx] ?? 0;
      return track.shapeTimes?.[kIdx] ?? 0;
    };
    _setOrClear(frameInput, Math.round(_tForKey() * fps), 0);

    if (single.type === 'transform' && track.positions) {
      if (v1Label) v1Label.textContent = 'X'; if (v2Label) v2Label.textContent = 'Y'; if (v3Label) v3Label.textContent = 'Z';
      v1Cell && (v1Cell.style.display = ''); v2Cell && (v2Cell.style.display = ''); v3Cell && (v3Cell.style.display = '');
      _setOrClear(v1Input, track.positions[kIdx * 3 + 0] ?? 0);
      _setOrClear(v2Input, track.positions[kIdx * 3 + 1] ?? 0);
      _setOrClear(v3Input, track.positions[kIdx * 3 + 2] ?? 0);
    } else if (single.type === 'blendshape' && single.name) {
      const bt = track.blendshapeTracks?.get(single.name);
      if (v1Label) v1Label.textContent = 'Weight';
      v1Cell && (v1Cell.style.display = ''); v2Cell && (v2Cell.style.display = 'none'); v3Cell && (v3Cell.style.display = 'none');
      _setOrClear(v1Input, bt?.values?.[kIdx] ?? 0);
    } else if (single.type === 'shape') {
      const t2 = _tForKey();
      const outTime = track.shapeOutputTimes?.[kIdx] ?? t2;
      if (v1Label) v1Label.textContent = 'Out';
      v1Cell && (v1Cell.style.display = ''); v2Cell && (v2Cell.style.display = 'none'); v3Cell && (v3Cell.style.display = 'none');
      _setOrClear(v1Input, outTime * fps, 2);
    } else {
      v1Cell && (v1Cell.style.display = 'none'); v2Cell && (v2Cell.style.display = 'none'); v3Cell && (v3Cell.style.display = 'none');
    }
  } else if (allTransform) {
    // Multi-key transform — show common X/Y/Z values (or blank if mixed)
    if (v1Label) v1Label.textContent = 'X'; if (v2Label) v2Label.textContent = 'Y'; if (v3Label) v3Label.textContent = 'Z';
    v1Cell && (v1Cell.style.display = ''); v2Cell && (v2Cell.style.display = ''); v3Cell && (v3Cell.style.display = '');
    if (frameInput && document.activeElement !== frameInput) frameInput.value = '';
    const _getPos = (k, ch) => {
      const tr = reg.tracks.get(k.meshId);
      return tr?.positions?.[k.index * 3 + ch];
    };
    _setOrClear(v1Input, _common(k => _getPos(k, 0)));
    _setOrClear(v2Input, _common(k => _getPos(k, 1)));
    _setOrClear(v3Input, _common(k => _getPos(k, 2)));
  } else if (sel.every(k => k.type === 'blendshape')) {
    // Multi-key blendshape — show common Weight value (or blank if mixed)
    if (v1Label) v1Label.textContent = 'Weight';
    v1Cell && (v1Cell.style.display = ''); v2Cell && (v2Cell.style.display = 'none'); v3Cell && (v3Cell.style.display = 'none');
    if (frameInput && document.activeElement !== frameInput) frameInput.value = '';
    const _getWeight = (k) => {
      const tr = reg.tracks.get(k.meshId);
      return tr?.blendshapeTracks?.get(k.name)?.values?.[k.index];
    };
    _setOrClear(v1Input, _common(k => _getWeight(k)));
  } else {
    // Mixed types — show empty fields
    if (frameInput && document.activeElement !== frameInput) frameInput.value = '';
    [v1Input, v2Input, v3Input].forEach(i => { if (i && document.activeElement !== i) i.value = ''; });
    v1Cell && (v1Cell.style.display = ''); v2Cell && (v2Cell.style.display = ''); v3Cell && (v3Cell.style.display = '');
  }
}

// ── Shared event wiring ───────────────────────────────────────────────────────
// repaint()    — mark the panel texture dirty (or no-op on desktop)
// sync()       — full syncAnimationSection + repaint
// refreshBs(mesh) — rebuild blendshape list for mesh

export function wireAnimationSection(el, main, { repaint = () => {}, sync, refreshBs, vrPanel = null }) {
  const _sync = sync ?? (() => { syncAnimationSection(el, main); repaint(); });
  const _refreshBs = refreshBs ?? ((mesh) => refreshBlendshapesDOM(el, mesh, main, repaint));
  // [Step Bug1] Expose sync so GuiTimeline can refresh key inspector after selection changes.
  window._animSyncKeyInspector = _sync;

  const reg    = () => window._animationRegistry;
  const fps    = () => window._animFPS || 24;
  const meshes = () => main._meshes || [];

  const _getTargetMesh = () => {
    const sel = main._selectMeshes;
    if (sel?.length > 0) return sel[0];
    if (main._mesh) return main._mesh;
    const all = main.getMeshes?.();
    return all?.length > 0 ? all[0] : null;
  };

  // ── Animation section ──────────────────────────────────────────────────────

  // [Step 3] Same synthetic-click fix applied to all panel checkboxes.
  const _cbWire = (id, fn) => {
    const cbEl = el.querySelector(id);
    if (!cbEl) return;
    cbEl.addEventListener('click', (e) => {
      if (!e.isTrusted) cbEl.checked = !cbEl.checked;
      fn(cbEl.checked);
    });
    // In VR the synthetic click lands on the row/label (not the tiny box) and an
    // untrusted click on a wrapping <label> does NOT forward to the <input>, so the
    // handler above never fires. Catch the row click too. Desktop label clicks are
    // trusted (they natively toggle the input), and an input-targeted click bubbles
    // up with target===cbEl — skip both to avoid double-toggling.
    const row = cbEl.closest('.acp-check-row');
    if (row && row !== cbEl) {
      row.addEventListener('click', (e) => {
        if (e.isTrusted || e.target === cbEl) return;
        cbEl.checked = !cbEl.checked;
        fn(cbEl.checked);
      });
    }
  };
  el.querySelector('#acp-show-timeline-btn')?.addEventListener('click', () => {
    const btn = el.querySelector('#acp-show-timeline-btn');
    const show = !btn.classList.contains('active');
    btn.classList.toggle('active', show);
    const inXR = !!(window.app?._renderer?.xr?.isPresenting);
    if (window.screenLog) window.screenLog(`[TL] show-timeline ${show} inXR=${inXR}`, 'yellow');
    if (inXR) {
      document.dispatchEvent(new CustomEvent('vtl-show', { detail: { show } }));
    } else {
      main.getGui?.()._ctrlTimeline?.setVisibility(show);
    }
  });

  // FPS/Speed are type-in number fields (not sliders) — a slider is far too easy to nudge
  // into an oddball value in VR, and FPS feeds the frame↔seconds math (a stray nudge
  // desyncs Duration/loop). Guard + clamp; 'change' fires on confirm (incl. the numpad).
  const fpsInput = el.querySelector('#acp-fps');
  fpsInput?.addEventListener('change', () => {
    let v = Math.round(parseFloat(fpsInput.value));
    if (!v || v < 1) v = window._animFPS || 24;
    v = Math.min(60, Math.max(1, v));
    window._animFPS = v;
    fpsInput.value = v;
    window.saveOption?.('animFPS', window._animFPS);
    repaint();
  });

  const speedInput = el.querySelector('#acp-speed');
  speedInput?.addEventListener('change', () => {
    let v = parseFloat(speedInput.value);
    if (!(v > 0)) v = window._animPlaybackSpeed || 1;
    v = Math.min(4, Math.max(0.1, v));
    window._animPlaybackSpeed = v;
    speedInput.value = v;
    repaint();
  });

  el.querySelector('#acp-duration')?.addEventListener('change', () => {
    const inputEl = el.querySelector('#acp-duration');
    const frames = parseInt(inputEl.value, 10);
    // Guard degenerate/empty input (a stray VR click can fire `change` with a junk value
    // — the "it keeps resetting to 2" report). Restore the displayed value, change nothing.
    if (!frames || frames < 1) {
      inputEl.value = Math.round((window._animMasterDuration || 2) * fps());
      return;
    }
    // Duration ONLY moves the loop boundary — it never touches keyframes. Make it undoable
    // so a misclick is always recoverable (snapshot the loop vars; the keyframes are intact).
    const prevDur = window._animMasterDuration, prevEnd = window._animLoopEnd;
    const apply = (dur, end) => {
      window._animMasterDuration = dur;
      window._animLoopEnd = end;
      const di = el.querySelector('#acp-duration'); if (di) di.value = Math.round((dur || 2) * fps());
      const le = el.querySelector('#acp-loop-end'); if (le) le.value = Math.round((end ?? dur ?? 2) * fps());
      main.getGui?.()._ctrlTimeline?.draw();
      repaint();
    };
    const newDur = frames / fps();
    apply(newDur, newDur);
    const sm = main.getStateManager?.();
    if (sm?.pushStateCustom) sm.pushStateCustom(() => apply(prevDur, prevEnd), () => apply(newDur, newDur), false, 'Change loop duration');
  });

  el.querySelector('#acp-loop-start')?.addEventListener('change', () => {
    const frames = parseInt(el.querySelector('#acp-loop-start').value, 10) || 0;
    window._animLoopStart = frames / fps();
    if (window._animLoopEnd <= window._animLoopStart)
      window._animLoopEnd = window._animLoopStart + 1 / fps();
    main.getGui?.()._ctrlTimeline?.draw();
    repaint();
  });

  el.querySelector('#acp-loop-end')?.addEventListener('change', () => {
    const frames = parseInt(el.querySelector('#acp-loop-end').value, 10) || 1;
    window._animLoopEnd = frames / fps();
    if (window._animLoopEnd <= (window._animLoopStart || 0))
      window._animLoopEnd = (window._animLoopStart || 0) + 1 / fps();
    main.getGui?.()._ctrlTimeline?.draw();
    repaint();
  });

  // ── Transport ──────────────────────────────────────────────────────────────

  el.querySelector('#acp-to-start')?.addEventListener('click', () => {
    if (!reg()) return;
    window._animCurrentTime = 0; reg().globalPlaybackTime = 0;
    meshes().forEach(m => reg().update(m, true)); repaint();
  });

  el.querySelector('#acp-prev-frame')?.addEventListener('click', () => {
    if (!reg()) return;
    window._animCurrentTime = Math.max(0, (window._animCurrentTime || 0) - 1 / fps());
    reg().globalPlaybackTime = window._animCurrentTime;
    meshes().forEach(m => reg().update(m, true)); repaint();
  });

  el.querySelector('#acp-play-rev')?.addEventListener('click', () => {
    const r = reg();
    if (window._animPlaying && r?.playbackDirection === -1) {
      window._animPlaying = false; r?.stopRecording?.(true);
    } else { window._animPlaying = true; if (r) r.playbackDirection = -1; }
    _sync();
  });

  el.querySelector('#acp-stop')?.addEventListener('click', () => {
    window._animPlaying = false; reg()?.stopRecording?.(true); _sync();
  });

  el.querySelector('#acp-play-fwd')?.addEventListener('click', () => {
    const r = reg();
    if (window._animPlaying && r?.playbackDirection !== -1) {
      window._animPlaying = false; r?.stopRecording?.(true);
    } else { window._animPlaying = true; if (r) r.playbackDirection = 1; }
    _sync();
  });

  el.querySelector('#acp-next-frame')?.addEventListener('click', () => {
    if (!reg()) return;
    const maxLen = window._animMasterDuration || 1;
    window._animCurrentTime = Math.min(maxLen, (window._animCurrentTime || 0) + 1 / fps());
    reg().globalPlaybackTime = window._animCurrentTime;
    meshes().forEach(m => reg().update(m, true)); repaint();
  });

  el.querySelector('#acp-to-end')?.addEventListener('click', () => {
    if (!reg()) return;
    window._animCurrentTime = window._animMasterDuration || 1;
    reg().globalPlaybackTime = window._animCurrentTime;
    meshes().forEach(m => reg().update(m, true)); repaint();
  });

  el.querySelector('#acp-record')?.addEventListener('click', () => {
    const r = reg(); if (!r) return;
    const target = _getTargetMesh(); if (!target) return;
    window._animArmed = true;
    if (window._animCountIn) r.startRecording(target);
    else if (window._animWaitForTrigger) window._animWaitingForGrab = true;
    else r.startRecording(target);
    _sync();
  });

  el.querySelector('#acp-clear-all')?.addEventListener('click', () => {
    window._vrConfirm('Clear all animation?', () => {
      const r = reg(); if (!r) return;
      r.stopRecording?.(true); r.tracks.clear();
      window._animCurrentTime = 0; r.globalPlaybackTime = 0;
      window._animPlaying = false;
      window._animSelectedKeys = [];
      // [Step Bug2] Reset timeline view so playhead is visible at t=0.
      window._animOnClearAll?.();
      _sync();
    });
  });

  // ── Record ─────────────────────────────────────────────────────────────────

  _cbWire('#acp-count-in', (v) => {
    window._animCountIn = v;
    if (window._animCountIn) window._animWaitForTrigger = false;
    _sync();
  });

  _cbWire('#acp-wait-trigger', (v) => {
    window._animWaitForTrigger = v;
    if (window._animWaitForTrigger) window._animCountIn = false;
    _sync();
  });

  // Onion skinning — ghost neighbour frames of the active SR group.
  _cbWire('#acp-onion', (v) => { window._frameGroup?.setOnion?.(v); });
  // Loop-aware: wrap the neighbour ghosts around the ends of the sequence.
  _cbWire('#acp-onion-loop', (v) => { window._frameGroup?.setOnionLoop?.(v); });

  const brTrigger = el.querySelector('#acp-bake-rate');
  const brOpts    = el.querySelector('#acp-bake-rate-wrap .acp-select-opts');
  brTrigger?.addEventListener('click', () => {
    if (brOpts) brOpts.style.display = brOpts.style.display === 'none' ? '' : 'none';
  });
  el.querySelectorAll('[data-bakerate]').forEach(btn => {
    btn.addEventListener('click', () => {
      window._animCaptureRate = parseFloat(btn.dataset.bakerate) || 0.1;
      if (brTrigger) brTrigger.childNodes[0].textContent = btn.textContent;
      if (brOpts) brOpts.style.display = 'none';
      el.querySelectorAll('[data-bakerate]').forEach(b => b.classList.toggle('active', b === btn));
    });
  });

  // ── Keyframes ──────────────────────────────────────────────────────────────

  const _updateAddKeyLabel = () => {
    const addKeyBtn = el.querySelector('#acp-add-key');
    if (addKeyBtn) addKeyBtn.innerHTML = window._animKeyMode === 'blendshape'
      ? '&#9670; Key All Blendshapes'
      : '&#9670; Add Key';
  };

  el.querySelectorAll('.acp-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      window._animKeyMode = btn.dataset.mode;
      el.querySelectorAll('.acp-mode-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.mode === window._animKeyMode)
      );
      _updateAddKeyLabel();
      repaint();
    });
  });

  el.querySelector('#acp-add-key')?.addEventListener('click', () => {
    const r = reg(); const target = _getTargetMesh();
    if (!r || !target) return;
    const t = window._animCurrentTime || 0;
    if (window._animKeyMode === 'shape') r.addShapeKey(target, t);
    else if (window._animKeyMode === 'blendshape') {
      // Key ALL blendshapes at their current evaluated weight (including weight=0)
      const track = r.tracks.get(target.getID());
      if (track?.blendshapeTracks) {
        track.blendshapeTracks.forEach((bTrack, name) => {
          const weight = bTrack.times.length > 0
            ? (r.evaluateScalarTrack?.(bTrack, t) ?? 0)
            : 0;
          r.setBlendshapeWeight?.(target, name, weight);
        });
      }
    } else r.addTransformKey(target, t);
    repaint();
  });

  const _copyKeys = () => {
    const r = reg(); const target = _getTargetMesh();
    if (!r || !target) return;
    const t = window._animCurrentTime || 0;
    if (window._animKeyMode === 'shape') r.copyShapeKey?.(target, t);
    else r.copyTransformKey?.(target, t);
  };

  el.querySelector('#acp-copy-key')?.addEventListener('click', _copyKeys);

  el.querySelector('#acp-paste-key')?.addEventListener('click', () => {
    const r = reg(); const target = _getTargetMesh();
    if (!r || !target) return;
    const t = window._animCurrentTime || 0;
    if (window._animKeyMode === 'shape' && r.clipboardShape) {
      r.pasteShapeKey?.(target, t); r.update(target, true);
    } else if (r.clipboardTransform) {
      r.pasteTransformKey?.(target, t); r.update(target, true);
    }
    repaint();
  });

  el.querySelector('#acp-cut-key')?.addEventListener('click', () => {
    _copyKeys();
    const r = reg(); const target = _getTargetMesh();
    if (!r || !target) return;
    const t = window._animCurrentTime || 0;
    if (window._animKeyMode === 'shape') r.deleteShapeKey?.(target, t);
    else r.deleteTransformKey?.(target, t);
    repaint();
  });

  el.querySelector('#acp-del-key')?.addEventListener('click', () => {
    const r = reg(); const target = _getTargetMesh();
    if (!r || !target) return;
    const t = window._animCurrentTime || 0;
    if (window._animKeyMode === 'shape') r.deleteShapeKey?.(target, t);
    else r.deleteTransformKey?.(target, t);
    repaint();
  });

  // [Step 3] Use 'click' not 'change': VR dispatches synthetic MouseEvent('click')
  // which is not isTrusted, so browsers don't toggle checkbox.checked and 'change'
  // never fires. Manually toggle when untrusted so VR and desktop both work.
  const _akEl = el.querySelector('#acp-autokey-btn');
  if (_akEl) {
    _akEl.addEventListener('click', () => {
      window._animAutoKey = !window._animAutoKey;
      _akEl.classList.toggle('active', !!window._animAutoKey);
    });
  }

  // ── Selected Key Inspector ─────────────────────────────────────────────────
  // [Expr] Evaluate a value expression against currentVal.
  // Supports +=N, -=N, *=N, /=N, and plain numbers.
  const _parseExpr = (raw, currentVal) => {
    const s = String(raw ?? '').trim();
    const op = s.slice(0, 2);
    const n  = parseFloat(s.slice(2));
    if (op === '+=' && !isNaN(n)) return currentVal + n;
    if (op === '-=' && !isNaN(n)) return currentVal - n;
    if (op === '*=' && !isNaN(n)) return currentVal * n;
    if (op === '/=' && !isNaN(n) && n !== 0) return currentVal / n;
    const direct = parseFloat(s);
    return isNaN(direct) ? null : direct;
  };

  // Exact keyframe time (seconds) for any key type.
  const _keyTime = (k, tr) => {
    if (k.type === 'transform')  return tr.times?.[k.index] ?? 0;
    if (k.type === 'shape')      return tr.shapeTimes?.[k.index] ?? 0;
    if (k.type === 'blendshape') return tr.blendshapeTracks?.get(k.name)?.times?.[k.index] ?? 0;
    return 0;
  };
  const _keyTimes = (k, tr) => {
    if (k.type === 'transform')  return tr.times;
    if (k.type === 'shape')      return tr.shapeTimes;
    if (k.type === 'blendshape') return tr.blendshapeTracks?.get(k.name)?.times;
    return null;
  };

  const _applyKeyFrame = () => {
    const fps = window._animFPS || 24;
    const rawVal = (el.querySelector('#acp-key-frame')?.value ?? '').trim();
    const sel = window._animSelectedKeys;
    if (!sel?.length) return;
    const r = reg(); if (!r) return;
    const mDur = (window._animMasterDuration > 0) ? window._animMasterDuration : 2.0;

    // Reference = first selected key; the expression evaluates against its frame.
    const ref = sel[0];
    const refTrack = r.tracks.get(ref.meshId); if (!refTrack) return;
    const refTime  = _keyTime(ref, refTrack);
    const refFrame = Math.round(refTime * fps);
    const newFrame = _parseExpr(rawVal, refFrame);
    if (newFrame == null) return;

    // Relative (+=, -=, *=, /=) → shift ALL selected keys by the frame delta,
    // preserving their spacing/offsets. Absolute number → set the reference key
    // to that whole frame and shift the rest rigidly by the same dt.
    const isRel = /^[+\-*/]=/.test(rawVal);
    const dt = isRel ? (newFrame - refFrame) / fps
                     : (Math.round(newFrame) / fps) - refTime;
    if (Math.abs(dt) < 0.0001) return;

    // Snapshot each selected key's exact time, shift all by dt.
    const moves = sel.map(k => {
      const tr = r.tracks.get(k.meshId);
      return tr ? { ...k, time: _keyTime(k, tr) } : null;
    }).filter(Boolean);
    TimelineHelper.moveKeys(r, moves, dt, undefined, mDur, main);

    // Re-sort touched tracks and re-resolve each key's index by its new time.
    const touched = new Set(moves.map(m => m.meshId));
    touched.forEach(id => { const tr = r.tracks.get(id); if (tr) r.sortTrack(tr); });
    window._animSelectedKeys = moves.map(m => {
      const tr = r.tracks.get(m.meshId); if (!tr) return m;
      const times = _keyTimes(m, tr);
      const want  = m.time + dt;
      const idx   = times?.findIndex(t => Math.abs(t - want) < 0.005) ?? -1;
      const { time: _drop, ...rest } = m;
      return idx !== -1 ? { ...rest, index: idx } : rest;
    });
    _sync();
  };

  // [Step Multi] Apply a value expression to ALL selected keys for channel ch.
  const _applyKeyVal = (ch) => {
    const ids = ['#acp-key-v1', '#acp-key-v2', '#acp-key-v3'];
    const rawVal = el.querySelector(ids[ch])?.value ?? '';
    const sel = window._animSelectedKeys;
    if (!sel?.length) return;
    const r = reg(); if (!r) return;
    const f = window._animFPS || 24;
    sel.forEach(k => {
      const track = r.tracks.get(k.meshId); if (!track) return;
      const kIdx = k.index;
      if (k.type === 'transform' && track.positions) {
        const cur = track.positions[kIdx * 3 + ch] ?? 0;
        const nv  = _parseExpr(rawVal, cur);
        if (nv != null && kIdx * 3 + ch < track.positions.length)
          track.positions[kIdx * 3 + ch] = nv;
      } else if (k.type === 'blendshape' && k.name && ch === 0) {
        const bt = track.blendshapeTracks?.get(k.name);
        const cur = bt?.values?.[kIdx] ?? 0;
        const nv  = _parseExpr(rawVal, cur);
        if (nv != null && bt?.values && kIdx < bt.values.length) bt.values[kIdx] = nv;
      } else if (k.type === 'shape' && ch === 0) {
        if (!track.shapeOutputTimes) track.shapeOutputTimes = [...(track.shapeTimes ?? [])];
        const cur = (track.shapeOutputTimes[kIdx] ?? track.shapeTimes?.[kIdx] ?? 0) * f;
        const nv  = _parseExpr(rawVal, cur);
        if (nv != null && kIdx < track.shapeOutputTimes.length)
          track.shapeOutputTimes[kIdx] = nv / f;
      }
    });
    if (main?.render) main.render();
    _sync();
  };

  const _wireKeyInput = (sel, fn) => {
    const inp = el.querySelector(sel); if (!inp) return;
    inp.addEventListener('change', fn);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
  };
  _wireKeyInput('#acp-key-frame', _applyKeyFrame);
  _wireKeyInput('#acp-key-v1',    () => _applyKeyVal(0));
  _wireKeyInput('#acp-key-v2',    () => _applyKeyVal(1));
  _wireKeyInput('#acp-key-v3',    () => _applyKeyVal(2));

  // ── Blendshapes ────────────────────────────────────────────────────────────

  const bsNameInput = el.querySelector('#acp-bs-name');
  const _createBlendshape = () => {
    let name = bsNameInput?.value.trim();
    const mesh = _getTargetMesh();
    if (!mesh || !window._animationRegistry) return;
    if (!name) {
      // Auto-generate an unused name (registry uses .tracks, not ._tracks)
      const track = window._animationRegistry.tracks?.get(mesh.getID?.());
      const existing = track?.blendshapes ? [...track.blendshapes.keys()] : [];
      let i = 1;
      while (existing.includes(`blendshape${i}`)) i++;
      name = `blendshape${i}`;
    }
    const reg = window._animationRegistry;
    reg.createBlendshape(mesh, name);
    // Auto-activate at 100% — new layer is immediately ready to sculpt into.
    reg.setBlendshapeWeight(mesh, name, 1.0);
    if (reg.tracks.get(mesh.getID())?.editingBlendshape) reg.exitBlendshapeEditMode(mesh);
    reg.enterBlendshapeEditMode(mesh, name);
    if (bsNameInput) bsNameInput.value = '';
    _refreshBs(mesh);
    repaint();
  };
  el.querySelector('#acp-bs-mode-blend')?.addEventListener('click', () => {
    window._bsMode = 'blend';
    const mesh = _getTargetMesh();
    const reg  = window._animationRegistry;
    if (mesh && reg?.tracks?.get(mesh.getID?.())?.editingBlendshape)
      reg.exitBlendshapeEditMode(mesh);
    _refreshBs(mesh);
    repaint?.();
  });
  el.querySelector('#acp-bs-mode-edit')?.addEventListener('click', () => {
    window._bsMode = 'edit';
    _refreshBs(_getTargetMesh());
    repaint?.();
  });

  el.querySelector('#acp-bs-add')?.addEventListener('click', _createBlendshape);
  bsNameInput?.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') _createBlendshape(); });
  bsNameInput?.addEventListener('keyup', (e) => e.stopPropagation());

  el.querySelector('#acp-bs-key-btn')?.addEventListener('click', () => {
    const mesh = _getTargetMesh();
    const reg  = window._animationRegistry;
    const name = reg?.tracks?.get(mesh?.getID?.())?.editingBlendshape;
    if (!mesh || !reg || !name) return;
    const slider = el.querySelector(`[data-bs-name="${name}"] .acp-bs-slider`);
    const weight = slider ? parseFloat(slider.value) : 1.0;
    reg.setBlendshapeWeight(mesh, name, weight);
    repaint?.();
  });

  el.querySelector('#acp-bs-del-btn')?.addEventListener('click', () => {
    const mesh = _getTargetMesh();
    const reg  = window._animationRegistry;
    const name = reg?.tracks?.get(mesh?.getID?.())?.editingBlendshape;
    if (!mesh || !reg || !name) return;
    reg.deleteBlendshape?.(mesh, name);
    _refreshBs(mesh);
    repaint?.();
  });

  // ── Numpad wiring for integer number inputs (desktop + VR) ──────────────
  // Clicking a number field opens the numpad overlay (DOM on desktop, 3D
  // panel in VR).  The numpad fires a synthetic 'change' event on confirm so
  // all existing duration/loop-start/end handlers run unchanged.

  const _numInputs = [
    { id: '#acp-duration',   label: 'Duration (frames)',  min: 1 },
    { id: '#acp-loop-start', label: 'Loop Start (frame)', min: 0 },
    { id: '#acp-loop-end',   label: 'Loop End (frame)',   min: 1 },
    { id: '#acp-fps',        label: 'FPS',                min: 1,   max: 60 },
    { id: '#acp-speed',      label: 'Playback speed',     min: 0.1, max: 4, integer: false },
  ];
  _numInputs.forEach(({ id, label, min, max, integer = true }) => {
    const input = el.querySelector(id);
    if (!input) return;
    input.addEventListener('click', (e) => {
      // Outside VR, only intercept when the user opted into the numpad;
      // otherwise let the native input accept keyboard typing.
      if (!window._vrNumpad || !window._vrNumpad.shouldUse()) return;
      // Cooldown: suppress re-open for 400 ms after the numpad closes so a
      // held or bouncing VR trigger can't immediately hit the panel beneath.
      if (window._vrNumpad.isBlockingOpen) return;
      e.preventDefault(); e.stopPropagation();
      const current = parseFloat(input.value) || min;
      window._vrNumpad.open(current, { label, integer, min, max }, (val) => {
        input.value = val;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }, input, vrPanel);
    });
  });

  // ── Keyframe editor inputs ────────────────────────────────────────────────
  // Frame number is integer; value fields (v1-v3) are floats.
  [
    { id: '#acp-key-frame', labelId: null,               integer: true  },
    { id: '#acp-key-v1',    labelId: '#acp-key-v1-label', integer: false },
    { id: '#acp-key-v2',    labelId: '#acp-key-v2-label', integer: false },
    { id: '#acp-key-v3',    labelId: '#acp-key-v3-label', integer: false },
  ].forEach(({ id, labelId, integer }) => {
    const input = el.querySelector(id);
    if (!input) return;
    input.addEventListener('click', (e) => {
      // Outside VR, only intercept when the user opted into the numpad;
      // otherwise let the native input accept keyboard typing.
      if (!window._vrNumpad || !window._vrNumpad.shouldUse()) return;
      if (window._vrNumpad.isBlockingOpen) return;
      // Frame input: only open when a single key is selected (frame is ambiguous for multi)
      if (id === '#acp-key-frame' && (!input.value || input.value === '—')) return;
      // Value inputs: only block if nothing is selected at all (disabled inputs)
      if (id !== '#acp-key-frame' && !window._animSelectedKeys?.length) return;
      e.preventDefault(); e.stopPropagation();
      // Empty when multi-select has mixed values — start from 0
      const current = parseFloat(input.value) || 0;
      const labelEl = labelId ? el.querySelector(labelId) : null;
      const label   = id === '#acp-key-frame' ? 'Frame' : (labelEl?.textContent || '');
      window._vrNumpad.open(current, { label, integer, min: integer ? 0 : undefined }, (val) => {
        input.value = val;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }, input, vrPanel);
    });
  });

  // ── Range drag + global init ───────────────────────────────────────────────

  setupRangeDrag(el);

  if (window._animMasterDuration === undefined) {
    window._animMasterDuration = (parseInt(el.querySelector('#acp-duration')?.value, 10) || 48) / fps();
  }
  if (window._animLoopStart === undefined) {
    window._animLoopStart = (parseInt(el.querySelector('#acp-loop-start')?.value, 10) || 0) / fps();
  }
  if (window._animLoopEnd === undefined) {
    window._animLoopEnd = (parseInt(el.querySelector('#acp-loop-end')?.value, 10) || 48) / fps();
  }
}

// ── AnimationControlPanel class ───────────────────────────────────────────────
// Thin wrapper: hosts the shared HTML in a standalone VR/desktop panel.
// The desktop sidebar embeds #acp-root directly; the VR system will attach
// this mesh to the wrist grip (task 3).

export class AnimationControlPanel extends HTMLVRPanel {
  constructor(main, scene, camera, renderer) {
    injectAnimCSS();

    const root = document.createElement('div');
    root.id        = 'acp-root';
    root.className = 'acp-root';
    root.innerHTML = buildAnimationSectionHTML();

    super(root, 560 / VR_PANEL_PX_PER_M);

    this._main            = main;
    this._startHidden     = true;
    this._lastBsMeshId    = null;
    this._lastBsCount     = 0;

    this.init(scene, camera, renderer);
    this._waitForMeshThenWire(main);
  }

  _waitForMeshThenWire(main) {
    if (this.mesh) { this._wireEvents(main); return; }
    const check = () => {
      if (this.mesh) this._wireEvents(main);
      else requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  }

  _wireEvents(main) {
    wireAnimationSection(this._element, main, {
      repaint:   () => this._requestPaint(),
      sync:      () => this.syncFromState(),
      refreshBs: (mesh) => this.refreshBlendshapes(mesh, main),
      vrPanel:   this,   // lets the numpad position itself next to this panel in VR
    });
  }

  refreshBlendshapes(mesh, main) {
    refreshBlendshapesDOM(this._element, mesh, main, () => this._requestPaint());
  }

  syncFromState() {
    syncAnimationSection(this._element, this._main);

    // Blendshape list: rebuild only when mesh or count changes.
    // getMesh() returns the UI-selected mesh, which may be null in VR (no
    // click-to-select).  Fall back to scanning all loaded meshes for one that
    // has blendshape tracks — same set playback already iterates.
    const reg = window._animationRegistry;
    let mesh = this._main?.getMesh?.() || this._main?._mesh;
    if (!mesh || !(reg?.tracks.get(mesh.getID())?.blendshapes?.size)) {
      const all = this._main?._meshes ?? [];
      mesh = all.find(m => reg?.tracks.get(m.getID())?.blendshapes?.size > 0) ?? mesh;
    }
    const meshId  = mesh?.getID?.();
    const track   = reg?.tracks.get(meshId);
    const bsCount = track?.blendshapes?.size ?? 0;

    if (meshId !== this._lastBsMeshId || bsCount !== this._lastBsCount) {
      this._lastBsMeshId = meshId;
      this._lastBsCount  = bsCount;
      this.refreshBlendshapes(mesh, this._main);
    } else if (bsCount > 0) {
      const t = window._animCurrentTime || 0;
      this._element.querySelectorAll('.acp-bs-row').forEach(row => {
        const name   = row.dataset.bsName;
        const bTrack = track?.blendshapeTracks?.get(name);
        if (!bTrack) return;
        const w = reg.evaluateScalarTrack?.(bTrack, t) ?? 0;
        const slider   = row.querySelector('.acp-bs-slider');
        const numInput = row.querySelector('.acp-bs-num');
        if (slider   && document.activeElement !== slider)   slider.value   = w;
        if (numInput && document.activeElement !== numInput) numInput.value = w.toFixed(2);
      });
    }

    this._requestPaint();
  }

  _requestPaint() { this.markDirty(); }

  deleteKey() {
    // SR frame-group markers → delete their real child objects via FrameGroup, then
    // fall through for any other selected key types.
    const srKeys = (window._animSelectedKeys || []).filter(k => k.type === 'sr');
    if (srKeys.length && window._frameGroup) {
      window._frameGroup.deleteFramesByChildIds(srKeys.map(k => k.childId));
      window._animSelectedKeys = (window._animSelectedKeys || []).filter(k => k.type !== 'sr');
      window.app?.getGui?.()?._ctrlTimeline?.draw?.();
      if (!window._animSelectedKeys.length) return;
    }

    const reg = window._animationRegistry;
    if (!reg) return;
    const mesh = this._main.getMesh();
    if (!mesh) return;

    const beforeState = new Map();
    reg.tracks.forEach((track, meshId) => beforeState.set(meshId, TimelineHelper.cloneTrack(track)));

    let actionName = '';
    if (window._animSelectedKeys?.length > 0) {
      reg.deleteSelectedKeys(window._animSelectedKeys);
      actionName = 'delete selected keys';
    } else {
      const t = window._animCurrentTime || 0;
      if (window._animKeyMode === 'shape' || window._animKeyMode === 0) {
        reg.deleteShapeKey(mesh, t); actionName = 'delete shape key';
      } else {
        reg.deleteTransformKey(mesh, t); actionName = 'delete transform key';
      }
    }
    reg.update(mesh, true);

    const afterState = new Map();
    reg.tracks.forEach((track, meshId) => afterState.set(meshId, TimelineHelper.cloneTrack(track)));

    const timeline = window.app?.getGui?.()?._ctrlTimeline;
    this._main.getStateManager().pushStateCustom(
      () => { beforeState.forEach((t, id) => reg.tracks.set(id, TimelineHelper.cloneTrack(t))); this._main.render(); timeline?.draw(); },
      () => { afterState.forEach((t, id)  => reg.tracks.set(id, TimelineHelper.cloneTrack(t))); this._main.render(); timeline?.draw(); },
      false, actionName
    );
  }

  _onMeshCreated(_scene) {
    if (this.mesh) {
      this.mesh.position.set(0.10, 0.10, -0.05);
      this.mesh.rotation.set(-Math.PI / 2, 0, 0);
    }
    requestAnimationFrame(() => this.syncFromState());
  }
}
