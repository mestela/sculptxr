/**
 * AnimationControlPanel — HTML-based VR/desktop animation panel.
 *
 * Section order matches GuiAnimation.js exactly:
 *   1. Animation  (FPS, speed, duration/loop in frames, timeline toggles)
 *   2. Transport  (8-button bar + Clear All)
 *   3. Record     (Count In, Wait for Trigger, Bake Rate)
 *   4. Keyframes  (key mode, Add Key, Copy/Paste/Cut/Delete, Autokey, Show Tangents)
 *   5. Blendshapes (placeholder — populated separately)
 *
 * Timecode display is added above Transport as a VR-useful extra.
 */

import { HTMLVRPanel, VR_PANEL_PX_PER_M } from './HTMLVRPanel.js';
import TimelineHelper from '../TimelineHelper.js';

const CSS = `
/* ── AnimationControlPanel — Catppuccin Mocha ───────────────────────────── */
#acp-root {
  width: 560px;
  padding: 14px 18px 18px;
  background: #1e1e2e;
  color: #cdd6f4;
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 12px;
  box-sizing: border-box;
  border-radius: 14px;
  border: 1px solid #313244;
  user-select: none;
}

/* ── Section headers ─────────────────────────────────────────────────────── */
#acp-root .acp-section {
  margin-top: 12px;
}
#acp-root .acp-section-title {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #585b70;
  border-bottom: 1px solid #313244;
  padding-bottom: 4px;
  margin-bottom: 8px;
}
#acp-root .acp-stack {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* ── Timecode ────────────────────────────────────────────────────────────── */
#acp-root .acp-timecode {
  font-size: 20px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: #cdd6f4;
  text-align: center;
  letter-spacing: 0.05em;
  padding: 6px 0;
  background: #181825;
  border-radius: 8px;
  border: 1px solid #313244;
  margin-bottom: 4px;
}

/* ── Row layout ──────────────────────────────────────────────────────────── */
#acp-root .acp-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
#acp-root .acp-lbl {
  width: 80px;
  font-size: 11px;
  color: #a6adc8;
  flex-shrink: 0;
}
#acp-root .acp-val {
  width: 36px;
  text-align: right;
  font-size: 11px;
  color: #89b4fa;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

/* ── Sliders ─────────────────────────────────────────────────────────────── */
#acp-root input[type=range] {
  flex: 1;
  accent-color: #89b4fa;
  height: 4px;
  cursor: pointer;
  min-width: 0;
}

/* ── Number inputs ───────────────────────────────────────────────────────── */
#acp-root .acp-frame-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}
#acp-root .acp-frame-cell {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
#acp-root .acp-frame-cell label {
  font-size: 10px;
  color: #6c7086;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
#acp-root .acp-frame-cell input[type=number] {
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
#acp-root .acp-frame-cell input[type=number]:focus { border-color: #89b4fa; }

/* ── Checkboxes / toggles ────────────────────────────────────────────────── */
#acp-root .acp-check-row {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 12px;
  color: #a6adc8;
}
#acp-root .acp-check-row input[type=checkbox] {
  width: 14px; height: 14px;
  accent-color: #89b4fa;
  cursor: pointer;
  flex-shrink: 0;
}
#acp-root .acp-check-row.active { color: #cdd6f4; }

/* ── Transport bar ───────────────────────────────────────────────────────── */
#acp-root .acp-transport {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 4px;
}
#acp-root .acp-transport button {
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
#acp-root .acp-transport button:hover,
#acp-root .acp-transport button.hover    { background: #24243e; color: #cdd6f4; }
#acp-root .acp-transport button.active   { background: #313244; color: #a6e3a1; border-color: #a6e3a1; }
#acp-root .acp-transport button.recording { background: #3d1e2e; color: #f38ba8; border-color: #f38ba8; }

/* ── Button rows ─────────────────────────────────────────────────────────── */
#acp-root .acp-btn-grid {
  display: flex;
  gap: 4px;
}
#acp-root .acp-btn-grid button {
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
#acp-root .acp-btn-grid button:hover,
#acp-root .acp-btn-grid button.hover { background: #24243e; color: #cdd6f4; }
#acp-root .acp-btn-grid button.danger { color: #f38ba8; border-color: #f38ba8; }
#acp-root .acp-btn-grid button.danger:hover,
#acp-root .acp-btn-grid button.danger.hover { background: #3d1e2e; }

/* ── Full-width button ───────────────────────────────────────────────────── */
#acp-root .acp-btn-full {
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
#acp-root .acp-btn-full:hover,
#acp-root .acp-btn-full.hover { background: #2a2040; }

#acp-root .acp-btn-clear {
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
#acp-root .acp-btn-clear:hover,
#acp-root .acp-btn-clear.hover { background: #3d1e2e; color: #f38ba8; border-color: #f38ba8; }

/* ── Select ──────────────────────────────────────────────────────────────── */
#acp-root .acp-select-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
#acp-root .acp-select-row label {
  font-size: 11px;
  color: #a6adc8;
  flex-shrink: 0;
  width: 80px;
}
#acp-root select {
  flex: 1;
  padding: 5px 8px;
  background: #181825;
  border: 1px solid #313244;
  border-radius: 6px;
  color: #cdd6f4;
  font-size: 12px;
  outline: none;
  cursor: pointer;
}
#acp-root select:focus { border-color: #89b4fa; }

/* ── Key mode tabs ───────────────────────────────────────────────────────── */
#acp-root .acp-mode-row {
  display: flex;
  gap: 0;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid #313244;
}
#acp-root .acp-mode-btn {
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
#acp-root .acp-mode-btn.active { background: #313244; color: #cba6f7; }
#acp-root .acp-mode-btn:hover:not(.active),
#acp-root .acp-mode-btn.hover:not(.active) { background: #24243e; color: #a6adc8; }

/* ── Blendshapes ─────────────────────────────────────────────────────────── */
#acp-root .acp-placeholder {
  font-size: 11px;
  color: #45475a;
  font-style: italic;
  padding: 4px 0;
}
#acp-root .acp-bs-create {
  display: flex;
  gap: 6px;
}
#acp-root .acp-bs-create input[type=text] {
  flex: 1;
  padding: 5px 8px;
  background: #181825;
  border: 1px solid #313244;
  border-radius: 6px;
  color: #cdd6f4;
  font-size: 12px;
  outline: none;
}
#acp-root .acp-bs-create input[type=text]:focus { border-color: #89b4fa; }
#acp-root .acp-bs-create button {
  padding: 5px 12px;
  background: #181825;
  border: 1px solid #313244;
  border-radius: 6px;
  color: #a6e3a1;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  outline: none;
  flex-shrink: 0;
}
#acp-root .acp-bs-create button:hover { background: #1e3a2a; border-color: #a6e3a1; }
#acp-root .acp-bs-row {
  border: 1px solid #313244;
  border-radius: 7px;
  padding: 7px 9px;
  background: #181825;
}
#acp-root .acp-bs-row.editing { border-color: #a6e3a1; background: #131d18; }
#acp-root .acp-bs-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 5px;
}
#acp-root .acp-bs-label {
  flex: 1;
  font-size: 12px;
  color: #cdd6f4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
#acp-root .acp-bs-num {
  width: 52px;
  padding: 3px 5px;
  background: #1e1e2e;
  border: 1px solid #313244;
  border-radius: 5px;
  color: #89b4fa;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  text-align: right;
  outline: none;
  flex-shrink: 0;
}
#acp-root .acp-bs-num:focus { border-color: #89b4fa; }
#acp-root .acp-bs-edit {
  padding: 3px 8px;
  border: 1px solid #313244;
  border-radius: 5px;
  background: #181825;
  color: #a6adc8;
  font-size: 10px;
  cursor: pointer;
  outline: none;
  flex-shrink: 0;
}
#acp-root .acp-bs-edit.active { color: #a6e3a1; border-color: #a6e3a1; background: #1e3a2a; }
#acp-root .acp-bs-del {
  padding: 3px 6px;
  border: 1px solid #313244;
  border-radius: 5px;
  background: #181825;
  color: #6c7086;
  font-size: 11px;
  cursor: pointer;
  outline: none;
  flex-shrink: 0;
}
#acp-root .acp-bs-del:hover { color: #f38ba8; border-color: #f38ba8; background: #3d1e2e; }
`;

let _cssInjected = false;
function injectCSS() {
  if (_cssInjected) return;
  _cssInjected = true;
  const s = document.createElement('style');
  s.textContent = CSS;
  document.head.appendChild(s);
}

export class AnimationControlPanel extends HTMLVRPanel {
  constructor(main, scene, camera, renderer) {
    injectCSS();

    const root = document.createElement('div');
    root.id = 'acp-root';
    root.innerHTML = AnimationControlPanel._buildHTML();

    super(root, 560 / VR_PANEL_PX_PER_M);

    this._main            = main;
    this._startHidden     = true;
    this._feedbackTimer   = null;

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

  // ── HTML ──────────────────────────────────────────────────────────────────

  static _buildHTML() {
    return `
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
            <button id="acp-to-start"   title="Jump to start">|&#9664;</button>
            <button id="acp-prev-frame" title="Previous frame">&#9664;&#9664;</button>
            <button id="acp-play-rev"   title="Play backwards">&#9664;</button>
            <button id="acp-stop"       title="Stop">&#9632;</button>
            <button id="acp-play-fwd"   title="Play forwards">&#9654;</button>
            <button id="acp-next-frame" title="Next frame">&#9654;&#9654;</button>
            <button id="acp-to-end"     title="Jump to end">&#9654;|</button>
            <button id="acp-record"     title="Record">&#9679;</button>
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
          <div class="acp-select-row">
            <label>Bake rate</label>
            <select id="acp-bake-rate">
              <option value="0.033">Dense (~30 fps)</option>
              <option value="0.1" selected>Standard (~10 fps)</option>
              <option value="0.5">Sparse (2 fps)</option>
              <option value="1.0">Step Key (1 fps)</option>
            </select>
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

      <!-- 5. Blendshapes -->
      <div class="acp-section">
        <div class="acp-section-title">Blendshapes</div>
        <div class="acp-stack">
          <div class="acp-bs-create">
            <input type="text" id="acp-bs-name" placeholder="New shape name...">
            <button id="acp-bs-add">+</button>
          </div>
          <div id="acp-bs-list" class="acp-stack">
            <span class="acp-placeholder">No blendshapes on current mesh</span>
          </div>
        </div>
      </div>
    `;
  }

  // ── Event wiring ──────────────────────────────────────────────────────────

  _wireEvents(main) {
    const root    = this._element;
    const reg     = () => window._animationRegistry;
    const fps     = () => window._animFPS || 24;
    const meshes  = () => main._meshes || [];

    const _getTargetMesh = () => {
      const sel = main._selectMeshes;
      if (sel && sel.length > 0) return sel[0];
      if (main._mesh) return main._mesh;
      const all = main.getMeshes?.();
      return all && all.length > 0 ? all[0] : null;
    };

    // ── Animation section ──────────────────────────────────────────────────

    root.querySelector('#acp-show-timeline').addEventListener('change', (e) => {
      main.getGui?.()._ctrlTimeline?.setVisibility(e.target.checked);
    });

    const fpsInput = root.querySelector('#acp-fps');
    const fpsVal   = root.querySelector('#acp-fps-val');
    fpsInput.addEventListener('input', () => {
      window._animFPS = Math.round(parseFloat(fpsInput.value));
      fpsVal.textContent = window._animFPS;
      this._requestPaint();
    });

    const speedInput = root.querySelector('#acp-speed');
    const speedVal   = root.querySelector('#acp-speed-val');
    speedInput.addEventListener('input', () => {
      window._animPlaybackSpeed = parseFloat(speedInput.value);
      speedVal.textContent = window._animPlaybackSpeed.toFixed(1) + 'x';
      this._requestPaint();
    });

    // Frame-based duration inputs
    root.querySelector('#acp-duration').addEventListener('change', () => {
      const frames = parseInt(root.querySelector('#acp-duration').value, 10) || 1;
      window._animMasterDuration = frames / fps();
      window._animLoopEnd = window._animMasterDuration;
      root.querySelector('#acp-loop-end').value = Math.round(window._animLoopEnd * fps());
      main.getGui?.()._ctrlTimeline?.draw();
      this._requestPaint();
    });

    root.querySelector('#acp-loop-start').addEventListener('change', () => {
      const frames = parseInt(root.querySelector('#acp-loop-start').value, 10) || 0;
      window._animLoopStart = frames / fps();
      if (window._animLoopEnd <= window._animLoopStart)
        window._animLoopEnd = window._animLoopStart + 1 / fps();
      main.getGui?.()._ctrlTimeline?.draw();
      this._requestPaint();
    });

    root.querySelector('#acp-loop-end').addEventListener('change', () => {
      const frames = parseInt(root.querySelector('#acp-loop-end').value, 10) || 1;
      window._animLoopEnd = frames / fps();
      if (window._animLoopEnd <= (window._animLoopStart || 0))
        window._animLoopEnd = (window._animLoopStart || 0) + 1 / fps();
      main.getGui?.()._ctrlTimeline?.draw();
      this._requestPaint();
    });

    // ── Transport ──────────────────────────────────────────────────────────

    root.querySelector('#acp-to-start').addEventListener('click', () => {
      if (!reg()) return;
      window._animCurrentTime = 0;
      reg().globalPlaybackTime = 0;
      meshes().forEach(m => reg().update(m, true));
      this._requestPaint();
    });

    root.querySelector('#acp-prev-frame').addEventListener('click', () => {
      if (!reg()) return;
      window._animCurrentTime = Math.max(0, (window._animCurrentTime || 0) - 1 / fps());
      reg().globalPlaybackTime = window._animCurrentTime;
      meshes().forEach(m => reg().update(m, true));
      this._requestPaint();
    });

    root.querySelector('#acp-play-rev').addEventListener('click', () => {
      const r = reg();
      if (window._animPlaying && r?.playbackDirection === -1) {
        window._animPlaying = false; r?.stopRecording?.(true);
      } else {
        window._animPlaying = true; if (r) r.playbackDirection = -1;
      }
      this.syncFromState();
    });

    root.querySelector('#acp-stop').addEventListener('click', () => {
      window._animPlaying = false;
      reg()?.stopRecording?.(true);
      this.syncFromState();
    });

    root.querySelector('#acp-play-fwd').addEventListener('click', () => {
      const r = reg();
      if (window._animPlaying && r?.playbackDirection !== -1) {
        window._animPlaying = false; r?.stopRecording?.(true);
      } else {
        window._animPlaying = true; if (r) r.playbackDirection = 1;
      }
      this.syncFromState();
    });

    root.querySelector('#acp-next-frame').addEventListener('click', () => {
      if (!reg()) return;
      const maxLen = window._animMasterDuration || 1;
      window._animCurrentTime = Math.min(maxLen, (window._animCurrentTime || 0) + 1 / fps());
      reg().globalPlaybackTime = window._animCurrentTime;
      meshes().forEach(m => reg().update(m, true));
      this._requestPaint();
    });

    root.querySelector('#acp-to-end').addEventListener('click', () => {
      if (!reg()) return;
      window._animCurrentTime = window._animMasterDuration || 1;
      reg().globalPlaybackTime = window._animCurrentTime;
      meshes().forEach(m => reg().update(m, true));
      this._requestPaint();
    });

    root.querySelector('#acp-record').addEventListener('click', () => {
      const r = reg();
      if (!r) return;
      const target = _getTargetMesh();
      if (!target) return;
      window._animArmed = true;
      if (window._animCountIn) { r.startRecording(target); }
      else if (window._animWaitForTrigger) { window._animWaitingForGrab = true; }
      else { r.startRecording(target); }
      this.syncFromState();
    });

    root.querySelector('#acp-clear-all').addEventListener('click', () => {
      if (!confirm('Clear all animation?')) return;
      const r = reg();
      if (!r) return;
      r.stopRecording?.(true);
      r.tracks.clear();
      window._animCurrentTime = 0;
      r.globalPlaybackTime = 0;
      window._animPlaying = false;
      this.syncFromState();
    });

    // ── Record section ─────────────────────────────────────────────────────

    root.querySelector('#acp-count-in').addEventListener('change', (e) => {
      window._animCountIn = e.target.checked;
      if (window._animCountIn) window._animWaitForTrigger = false;
      this.syncFromState();
    });

    root.querySelector('#acp-wait-trigger').addEventListener('change', (e) => {
      window._animWaitForTrigger = e.target.checked;
      if (window._animWaitForTrigger) window._animCountIn = false;
      this.syncFromState();
    });

    root.querySelector('#acp-bake-rate').addEventListener('change', () => {
      window._animCaptureRate = parseFloat(root.querySelector('#acp-bake-rate').value) || 0.1;
    });

    // ── Keyframes section ──────────────────────────────────────────────────

    root.querySelectorAll('.acp-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        window._animKeyMode = btn.dataset.mode;
        root.querySelectorAll('.acp-mode-btn').forEach(b =>
          b.classList.toggle('active', b.dataset.mode === window._animKeyMode)
        );
        this._requestPaint();
      });
    });

    root.querySelector('#acp-add-key').addEventListener('click', () => {
      const r = reg();
      const target = _getTargetMesh();
      if (!r || !target) return;
      const t = window._animCurrentTime || 0;
      if (window._animKeyMode === 'shape') {
        r.addShapeKey(target, t);
      } else if (window._animKeyMode === 'blendshape') {
        const track = r.tracks.get(target.getID());
        const name = track?.editingBlendshape || window._lastActiveBlendshape;
        if (name && track?.blendshapeTracks?.has(name)) {
          const bTrack = track.blendshapeTracks.get(name);
          const weight = bTrack.times.length > 0
            ? r.evaluateScalarTrack(bTrack, t)
            : (window._lastActiveBlendshapeWeight ?? 0);
          r.setBlendshapeWeight?.(target, name, weight);
        }
      } else {
        r.addTransformKey(target, t);
      }
      this._requestPaint();
    });

    const _copyKeys = () => {
      const r = reg();
      const target = _getTargetMesh();
      if (!r || !target) return;
      const t = window._animCurrentTime || 0;
      if (window._animKeyMode === 'shape') r.copyShapeKey?.(target, t);
      else r.copyTransformKey?.(target, t);
    };

    root.querySelector('#acp-copy-key').addEventListener('click', _copyKeys);

    root.querySelector('#acp-paste-key').addEventListener('click', () => {
      const r = reg();
      const target = _getTargetMesh();
      if (!r || !target) return;
      const t = window._animCurrentTime || 0;
      if (window._animKeyMode === 'shape' && r.clipboardShape) {
        r.pasteShapeKey?.(target, t); r.update(target, true);
      } else if (r.clipboardTransform) {
        r.pasteTransformKey?.(target, t); r.update(target, true);
      }
      this._requestPaint();
    });

    root.querySelector('#acp-cut-key').addEventListener('click', () => {
      _copyKeys();
      const r = reg();
      const target = _getTargetMesh();
      if (!r || !target) return;
      const t = window._animCurrentTime || 0;
      if (window._animKeyMode === 'shape') r.deleteShapeKey?.(target, t);
      else r.deleteTransformKey?.(target, t);
      this._requestPaint();
    });

    root.querySelector('#acp-del-key').addEventListener('click', () => {
      const r = reg();
      const target = _getTargetMesh();
      if (!r || !target) return;
      const t = window._animCurrentTime || 0;
      if (window._animKeyMode === 'shape') r.deleteShapeKey?.(target, t);
      else r.deleteTransformKey?.(target, t);
      this._requestPaint();
    });

    root.querySelector('#acp-autokey').addEventListener('change', (e) => {
      window._animAutoKey = e.target.checked;
    });


    // ── Explicit drag handler for all range inputs ────────────────────────
    // Native range-input drag can be stolen by window-level pointer handlers
    // (HTMLVRPanel desktop raycasters). Explicit capture guarantees it works
    // in the DOM overlay and in VR equally.
    this._setupRangeDrag(root);

    // Initialise globals from panel HTML defaults if not already set by a
    // previous session or loaded file.  This ensures looping works even when
    // the user never touches these fields.
    if (window._animMasterDuration === undefined) {
      window._animMasterDuration = (parseInt(root.querySelector('#acp-duration').value, 10) || 48) / fps();
    }
    if (window._animLoopStart === undefined) {
      window._animLoopStart = (parseInt(root.querySelector('#acp-loop-start').value, 10) || 0) / fps();
    }
    if (window._animLoopEnd === undefined) {
      window._animLoopEnd = (parseInt(root.querySelector('#acp-loop-end').value, 10) || 48) / fps();
    }

    // ── Blendshapes section ────────────────────────────────────────────────

    const bsNameInput = root.querySelector('#acp-bs-name');

    const _createBlendshape = () => {
      const name = bsNameInput.value.trim();
      const mesh = _getTargetMesh();
      if (!name || !mesh || !window._animationRegistry) return;
      window._animationRegistry.createBlendshape(mesh, name);
      bsNameInput.value = '';
      this.refreshBlendshapes(mesh, main);
      this._requestPaint();
    };

    root.querySelector('#acp-bs-add').addEventListener('click', _createBlendshape);
    bsNameInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') _createBlendshape();
    });
    bsNameInput.addEventListener('keyup', (e) => e.stopPropagation());
  }

  // ── Range input drag ─────────────────────────────────────────────────────

  _setupRangeDrag(root) {
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
        active = true;
        input.setPointerCapture(e.pointerId);
        input.value = getVal(e.clientX);
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
        if (!active) return;
        active = false;
        if (input.hasPointerCapture(e.pointerId)) input.releasePointerCapture(e.pointerId);
        e.stopPropagation();
      });

      input.addEventListener('lostpointercapture', () => { active = false; });
    });
  }

  // ── Blendshapes ───────────────────────────────────────────────────────────

  refreshBlendshapes(mesh, main) {
    const list = this._element.querySelector('#acp-bs-list');
    if (!list) return;
    list.innerHTML = '';

    const reg   = window._animationRegistry;
    const track = reg?.tracks.get(mesh?.getID());

    if (!track?.blendshapes?.size) {
      list.innerHTML = '<span class="acp-placeholder">No blendshapes on current mesh</span>';
      this._requestPaint();
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
          <button class="acp-bs-edit${isEditing ? ' active' : ''}">${isEditing ? 'Done' : 'Edit'}</button>
          <button class="acp-bs-del" title="Delete">&#128465;</button>
        </div>
        <input type="range" class="acp-bs-slider" min="0" max="1" step="0.01" value="${weight}">
      `;

      const slider  = row.querySelector('.acp-bs-slider');
      const numInput = row.querySelector('.acp-bs-num');
      let startVal  = weight;

      const applyWeight = (val) => {
        reg.setBlendshapeWeight?.(mesh, name, val);
        slider.value  = val;
        numInput.value = val.toFixed(2);
        this._requestPaint();
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
          () => { applyWeight(oldVal); this.refreshBlendshapes(mesh, main); },
          () => { applyWeight(newVal); this.refreshBlendshapes(mesh, main); },
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
          () => { applyWeight(oldVal); this.refreshBlendshapes(mesh, main); },
          () => { applyWeight(newVal); this.refreshBlendshapes(mesh, main); },
          false, 'Change Blendshape Weight'
        );
        startVal = newVal;
      });

      row.querySelector('.acp-bs-edit').addEventListener('click', () => {
        const tr = reg.tracks.get(mesh.getID());
        window._lastActiveBlendshape = name;
        if (tr?.editingBlendshape === name) {
          reg.exitBlendshapeEditMode?.(mesh);
        } else {
          if (tr?.editingBlendshape) reg.exitBlendshapeEditMode?.(mesh);
          reg.enterBlendshapeEditMode?.(mesh, name);
        }
        this.refreshBlendshapes(mesh, main);
      });

      row.querySelector('.acp-bs-del').addEventListener('click', () => {
        reg.deleteBlendshape?.(mesh, name);
        this.refreshBlendshapes(mesh, main);
      });

      this._setupRangeDrag(row);
      list.appendChild(row);
    });

    this._requestPaint();
  }

  // ── syncFromState ─────────────────────────────────────────────────────────

  syncFromState() {
    const root    = this._element;
    const r       = window._animationRegistry;
    const playing = !!window._animPlaying;
    const rec     = !!(r?.isRecording || r?.isCountingIn);
    const playFwd = playing && r?.playbackDirection !== -1;
    const playRev = playing && r?.playbackDirection === -1;
    const f       = window._animFPS || 24;

    // Timecode
    // Transport states
    root.querySelector('#acp-play-fwd').classList.toggle('active',    playFwd && !rec);
    root.querySelector('#acp-play-rev').classList.toggle('active',    playRev && !rec);
    root.querySelector('#acp-record').classList.toggle('recording',   rec);

    // Animation section
    const timeline = this._main?.getGui?.()._ctrlTimeline;
    root.querySelector('#acp-show-timeline').checked = !!(timeline?._visible);
    root.querySelector('#acp-fps').value           = f;
    root.querySelector('#acp-fps-val').textContent = f;
    const spd = window._animPlaybackSpeed || 1.0;
    root.querySelector('#acp-speed').value           = spd;
    root.querySelector('#acp-speed-val').textContent = spd.toFixed(1) + 'x';
    root.querySelector('#acp-duration').value    = Math.round((window._animMasterDuration || 2) * f);
    root.querySelector('#acp-loop-start').value  = Math.round((window._animLoopStart || 0) * f);
    root.querySelector('#acp-loop-end').value    = Math.round(((window._animLoopEnd ?? window._animMasterDuration) || 2) * f);

    // Record section
    root.querySelector('#acp-count-in').checked     = !!window._animCountIn;
    root.querySelector('#acp-wait-trigger').checked = !!window._animWaitForTrigger;
    const bakeRate = String(window._animCaptureRate || 0.1);
    for (const opt of root.querySelector('#acp-bake-rate').options) {
      opt.selected = opt.value === bakeRate;
    }

    // Key mode
    const mode = window._animKeyMode || 'shape';
    root.querySelectorAll('.acp-mode-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.mode === mode)
    );

    // Keyframe section
    root.querySelector('#acp-autokey').checked = !!window._animAutoKey;

    // Blendshapes — rebuild list when mesh or blendshape count changes
    const mesh    = this._main?.getMesh?.() || this._main?._mesh;
    const meshId  = mesh?.getID?.();
    const reg     = window._animationRegistry;
    const track   = reg?.tracks.get(meshId);
    const bsCount = track?.blendshapes?.size ?? 0;

    if (meshId !== this._lastBsMeshId || bsCount !== this._lastBsCount) {
      this._lastBsMeshId = meshId;
      this._lastBsCount  = bsCount;
      this.refreshBlendshapes(mesh, this._main);
    } else if (bsCount > 0) {
      // Update weights in existing rows without full rebuild
      const t = window._animCurrentTime || 0;
      root.querySelectorAll('.acp-bs-row').forEach(row => {
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
    if (window._animSelectedKeys && window._animSelectedKeys.length > 0) {
      reg.deleteSelectedKeys(window._animSelectedKeys);
      actionName = 'delete selected keys';
    } else {
      const t = window._animCurrentTime || 0;
      if (window._animKeyMode === 'shape' || window._animKeyMode === 0) {
        reg.deleteShapeKey(mesh, t);
        actionName = 'delete shape key';
      } else {
        reg.deleteTransformKey(mesh, t);
        actionName = 'delete transform key';
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
    requestAnimationFrame(() => this.syncFromState());
  }
}
