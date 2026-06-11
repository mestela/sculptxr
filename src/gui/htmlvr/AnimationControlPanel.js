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
.acp-root .acp-bs-header { display: flex; align-items: center; gap: 6px; margin-bottom: 5px; }
.acp-root .acp-bs-label {
  flex: 1; font-size: 12px; color: #cdd6f4;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.acp-root .acp-bs-num {
  width: 52px; padding: 3px 5px; background: #1e1e2e; border: 1px solid #313244;
  border-radius: 5px; color: #89b4fa; font-size: 11px; font-variant-numeric: tabular-nums;
  text-align: right; outline: none; flex-shrink: 0;
}
.acp-root .acp-bs-num:focus { border-color: #89b4fa; }
.acp-root .acp-bs-edit {
  padding: 3px 8px; border: 1px solid #313244; border-radius: 5px;
  background: #181825; color: #a6adc8; font-size: 10px; cursor: pointer;
  outline: none; flex-shrink: 0;
}
.acp-root .acp-bs-edit.active { color: #a6e3a1; border-color: #a6e3a1; background: #1e3a2a; }
.acp-root .acp-bs-del {
  padding: 3px 6px; border: 1px solid #313244; border-radius: 5px;
  background: #181825; color: #6c7086; font-size: 11px; cursor: pointer; outline: none; flex-shrink: 0;
}
.acp-root .acp-bs-del:hover { color: #f38ba8; border-color: #f38ba8; background: #3d1e2e; }
.acp-root .acp-bs-key {
  padding: 3px 6px; border: 1px solid #313244; border-radius: 5px;
  background: #181825; color: #6c7086; font-size: 11px; cursor: pointer; outline: none; flex-shrink: 0;
}
.acp-root .acp-bs-key:hover { color: #ff9944; border-color: #ff9944; background: #3a2a1e; }
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
        <label class="acp-check-row">
          <input type="checkbox" id="acp-show-timeline"> Show Timeline
        </label>
        <div class="acp-row">
          <span class="acp-lbl">FPS</span>
          <input type="range" id="acp-fps" min="1" max="60" step="1" value="24">
          <span class="acp-val" id="acp-fps-val">24</span>
        </div>
        <div class="acp-row">
          <span class="acp-lbl">Speed</span>
          <input type="range" id="acp-speed" min="0.1" max="4.0" step="0.1" value="1.0">
          <span class="acp-val" id="acp-speed-val">1.0x</span>
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
        <button class="acp-btn-full" id="acp-add-key">&#9670; Add Key</button>
        <div class="acp-btn-grid">
          <button id="acp-copy-key">Copy</button>
          <button id="acp-paste-key">Paste</button>
          <button id="acp-cut-key">Cut</button>
          <button id="acp-del-key" class="danger">Delete</button>
        </div>
        <label class="acp-check-row">
          <input type="checkbox" id="acp-autokey"> Autokey
        </label>
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

    <!-- 6. Blendshapes -->
    <div class="acp-section">
      <div class="acp-section-title">Blendshapes</div>
      <div class="acp-stack">
        <div class="acp-bs-create">
          <input type="text" id="acp-bs-name" placeholder="New shape name..."
                 autocomplete="off" autocorrect="off" autocapitalize="off"
                 spellcheck="false" writingsuggestions="false">
          <button id="acp-bs-add">+</button>
        </div>
        <div id="acp-bs-list" class="acp-stack">
          <span class="acp-placeholder">No blendshapes on current mesh</span>
        </div>
      </div>
    </div>
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

  const reg   = window._animationRegistry;
  const track = reg?.tracks.get(mesh?.getID());

  if (!track?.blendshapes?.size) {
    list.innerHTML = '<span class="acp-placeholder">No blendshapes on current mesh</span>';
    repaint?.();
    return;
  }

  track.blendshapes.forEach((_, name) => {
    const bTrack = track.blendshapeTracks?.get(name);
    const weight = bTrack?.times?.length
      ? (reg.evaluateScalarTrack?.(bTrack, track.playbackTime) ?? 0)
      : 0;
    const isEditing = track.editingBlendshape === name;

    const row = document.createElement('div');
    row.className = 'acp-bs-row' + (isEditing ? ' editing' : '');
    row.dataset.bsName = name;
    row.innerHTML = `
      <div class="acp-bs-header">
        <span class="acp-bs-label">${name}</span>
        <input type="number" class="acp-bs-num" min="0" max="1" step="0.01" value="${weight.toFixed(2)}">
        <button class="acp-bs-key" title="Key this blendshape">&#9670;</button>
        <button class="acp-bs-edit${isEditing ? ' active' : ''}">${isEditing ? 'Done' : 'Edit'}</button>
        <button class="acp-bs-del" title="Delete">Del</button>
      </div>
      <input type="range" class="acp-bs-slider" min="0" max="1" step="0.01" value="${weight}">
    `;

    const slider   = row.querySelector('.acp-bs-slider');
    const numInput = row.querySelector('.acp-bs-num');
    let startVal   = weight;

    const applyWeight = (val) => {
      reg.setBlendshapeWeight?.(mesh, name, val);
      slider.value   = val;
      numInput.value = val.toFixed(2);
      repaint?.();
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

    row.querySelector('.acp-bs-key').addEventListener('click', () => {
      const t = window._animCurrentTime || 0;
      const currentWeight = parseFloat(slider.value);
      reg.setBlendshapeWeight?.(mesh, name, currentWeight);
      repaint?.();
    });

    row.querySelector('.acp-bs-edit').addEventListener('click', () => {
      const tr = reg.tracks.get(mesh.getID());
      window._lastActiveBlendshape = name;
      if (tr?.editingBlendshape === name) reg.exitBlendshapeEditMode?.(mesh);
      else {
        if (tr?.editingBlendshape) reg.exitBlendshapeEditMode?.(mesh);
        reg.enterBlendshapeEditMode?.(mesh, name);
      }
      refreshBlendshapesDOM(el, mesh, main, repaint);
    });

    row.querySelector('.acp-bs-del').addEventListener('click', () => {
      reg.deleteBlendshape?.(mesh, name);
      refreshBlendshapesDOM(el, mesh, main, repaint);
    });

    setupRangeDrag(row);
    list.appendChild(row);
  });

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
  const showTl = el.querySelector('#acp-show-timeline');
  if (showTl) showTl.checked = !!(timeline?._visible);

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

  const ak = el.querySelector('#acp-autokey');
  if (ak) ak.checked = !!window._animAutoKey;

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
  };
  _cbWire('#acp-show-timeline', (show) => {
    const inXR = !!(window.app?._renderer?.xr?.isPresenting);
    if (window.screenLog) window.screenLog(`[TL] show-timeline ${show} inXR=${inXR}`, 'yellow');
    if (inXR) {
      document.dispatchEvent(new CustomEvent('vtl-show', { detail: { show } }));
    } else {
      main.getGui?.()._ctrlTimeline?.setVisibility(show);
    }
  });

  const fpsInput = el.querySelector('#acp-fps');
  const fpsVal   = el.querySelector('#acp-fps-val');
  fpsInput?.addEventListener('input', () => {
    window._animFPS = Math.round(parseFloat(fpsInput.value));
    if (fpsVal) fpsVal.textContent = window._animFPS;
    window.saveOption?.('animFPS', window._animFPS);
    repaint();
  });

  const speedInput = el.querySelector('#acp-speed');
  const speedVal   = el.querySelector('#acp-speed-val');
  speedInput?.addEventListener('input', () => {
    window._animPlaybackSpeed = parseFloat(speedInput.value);
    if (speedVal) speedVal.textContent = window._animPlaybackSpeed.toFixed(1) + 'x';
    repaint();
  });

  el.querySelector('#acp-duration')?.addEventListener('change', () => {
    const frames = parseInt(el.querySelector('#acp-duration').value, 10) || 1;
    window._animMasterDuration = frames / fps();
    window._animLoopEnd = window._animMasterDuration;
    const le = el.querySelector('#acp-loop-end');
    if (le) le.value = Math.round(window._animLoopEnd * fps());
    main.getGui?.()._ctrlTimeline?.draw();
    repaint();
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
  const _akEl = el.querySelector('#acp-autokey');
  if (_akEl) {
    _akEl.addEventListener('click', (e) => {
      if (!e.isTrusted) _akEl.checked = !_akEl.checked;
      window._animAutoKey = _akEl.checked;
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

  const _applyKeyFrame = () => {
    const fps = window._animFPS || 24;
    const rawVal = el.querySelector('#acp-key-frame')?.value ?? '';
    const sel = window._animSelectedKeys;
    if (!sel?.length) return;
    const r = reg(); if (!r) return;
    const mDur = (window._animMasterDuration > 0) ? window._animMasterDuration : 2.0;
    const single = sel[0];
    const track = r.tracks.get(single.meshId); if (!track) return;
    const origTime = single.type === 'transform' ? (track.times?.[single.index] ?? 0) : (track.shapeTimes?.[single.index] ?? 0);
    const currentFrame = Math.round(origTime * fps);
    const newFrame = _parseExpr(rawVal, currentFrame);
    if (newFrame == null) return;
    const dt = (newFrame / fps) - origTime;
    if (Math.abs(dt) < 0.0001) return;
    TimelineHelper.moveKeys(r, [{ ...single, time: origTime }], dt, undefined, mDur, main);
    r.sortTrack(track);
    const newTime = origTime + dt;
    const times = single.type === 'transform' ? track.times : track.shapeTimes;
    const newIdx = times?.findIndex(t => Math.abs(t - newTime) < 0.005) ?? -1;
    if (newIdx !== -1) window._animSelectedKeys = [{ ...single, index: newIdx }];
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
    window._animationRegistry.createBlendshape(mesh, name);
    if (bsNameInput) bsNameInput.value = '';
    _refreshBs(mesh);
    repaint();
  };
  el.querySelector('#acp-bs-add')?.addEventListener('click', _createBlendshape);
  bsNameInput?.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') _createBlendshape(); });
  bsNameInput?.addEventListener('keyup', (e) => e.stopPropagation());

  // ── Numpad wiring for integer number inputs (desktop + VR) ──────────────
  // Clicking a number field opens the numpad overlay (DOM on desktop, 3D
  // panel in VR).  The numpad fires a synthetic 'change' event on confirm so
  // all existing duration/loop-start/end handlers run unchanged.

  const _numInputs = [
    { id: '#acp-duration',   label: 'Duration (frames)',  min: 1 },
    { id: '#acp-loop-start', label: 'Loop Start (frame)', min: 0 },
    { id: '#acp-loop-end',   label: 'Loop End (frame)',   min: 1 },
  ];
  _numInputs.forEach(({ id, label, min }) => {
    const input = el.querySelector(id);
    if (!input) return;
    input.addEventListener('click', (e) => {
      if (!window._vrNumpad) return; // numpad not yet initialised — fall back to native input
      // Cooldown: suppress re-open for 400 ms after the numpad closes so a
      // held or bouncing VR trigger can't immediately hit the panel beneath.
      if (window._vrNumpad.isBlockingOpen) return;
      e.preventDefault(); e.stopPropagation();
      const current = parseFloat(input.value) || min;
      window._vrNumpad.open(current, { label, integer: true, min }, (val) => {
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

    // Blendshape list: rebuild only when mesh or count changes
    const mesh   = this._main?.getMesh?.() || this._main?._mesh;
    const meshId = mesh?.getID?.();
    const reg    = window._animationRegistry;
    const track  = reg?.tracks.get(meshId);
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
