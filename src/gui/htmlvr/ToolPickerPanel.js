/**
 * ToolPickerPanel — compact tool-selection overlay for SculptXR.
 *
 * A separate HTMLVRPanel (own mesh + texture) that lives at the same wrist
 * position as MiniPanel.  Scene.js swaps mesh.visible between the two, the
 * same way it swaps MiniPanel and the main menu.
 *
 * Fires custom events on this._element:
 *   'tp-close'          — user dismissed without selecting a tool
 *   'tp-tool-selected'  — e.detail.id contains the chosen tool index
 */

import { HTMLVRPanel, VR_PANEL_PX_PER_M } from './HTMLVRPanel.js';
import Enums from '../../misc/Enums.js';
import { SCULPT_TOOLS } from './toolLists.js';

// ── Tool data ────────────────────────────────────────────────────────────────
const TOOL_TINTS = {
  0:'#6b4040', 1:'#6b4040', 4:'#6b4040', 5:'#6b4040', 6:'#6b4040', 14:'#6b4040',
  3:'#404d6b', 8:'#404d6b',
  7:'#406b40', 10:'#406b40', 12:'#406b40', 15:'#406b40', 16:'#406b40', 17:'#406b40',
  2:'#406b40', 13:'#406b40',
  9:'#5a406b',
  11:'#6b5440',
};
const toolTint = (id) => TOOL_TINTS[id] ?? '#313244';


// ── CSS ───────────────────────────────────────────────────────────────────────
const CSS = `
#tp-root {
  width: 240px;
  padding: 10px 10px 10px;
  background: #1e1e2e;
  color: #cdd6f4;
  font-family: system-ui, -apple-system, sans-serif;
  box-sizing: border-box;
  border-radius: 12px;
  border: 1px solid #313244;
  user-select: none;
}
#tp-root .tp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
#tp-root .tp-title {
  font-size: 11px;
  font-weight: 600;
  color: #a6adc8;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
#tp-root .tp-close-btn {
  padding: 3px 8px;
  border: 1px solid #45475a;
  border-radius: 5px;
  background: #181825;
  color: #6c7086;
  font-size: 12px;
  cursor: pointer;
  outline: none;
}
#tp-root .tp-close-btn:hover,
#tp-root .tp-close-btn.hover { background: #313244; color: #cdd6f4; }

#tp-root .tp-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 5px;
  margin-bottom: 6px;
}
#tp-root .tp-btn {
  padding: 8px 4px;
  border: 1px solid #45475a;
  border-radius: 6px;
  background: #313244;
  color: #cdd6f4;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  text-align: center;
  outline: none;
  transition: filter 0.1s;
}
#tp-root .tp-btn:hover,
#tp-root .tp-btn.hover  { filter: brightness(1.3); }
#tp-root .tp-btn.active { box-shadow: 0 0 0 2px #89b4fa; }
`;

let _tpCssInjected = false;
function injectCSS() {
  if (_tpCssInjected) return;
  _tpCssInjected = true;
  const s = document.createElement('style');
  s.textContent = CSS;
  document.head.appendChild(s);
}

function buildHTML() {
  const btns = SCULPT_TOOLS.map(t =>
    `<button class="tp-btn" data-tool-id="${t.id}" style="background:${toolTint(t.id)}">${t.label}</button>`
  ).join('');
  return `
    <div class="tp-header">
      <span class="tp-title">Select Tool</span>
      <button class="tp-close-btn" id="tp-close">✕</button>
    </div>
    <div class="tp-grid">${btns}</div>
  `;
}

// ── ToolPickerPanel ───────────────────────────────────────────────────────────
export class ToolPickerPanel extends HTMLVRPanel {
  constructor(main, scene, camera, renderer) {
    injectCSS();
    const root = document.createElement('div');
    root.id = 'tp-root';
    root.innerHTML = buildHTML();

    super(root, 240 / VR_PANEL_PX_PER_M);

    this._main       = main;
    this._startHidden = true;   // hidden until user taps tool button on MiniPanel

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

  _onMeshCreated() {
    if (!this.mesh) return;
    // Same wrist position as MiniPanel
    this.mesh.position.set(0, 0.05, -0.05);
    this.mesh.rotation.set(-Math.PI / 2, Math.PI / 8, 0);
  }

  _wireEvents(main) {
    const root = this._element;

    // Close button
    root.querySelector('#tp-close')?.addEventListener('click', () => {
      this._element.dispatchEvent(new CustomEvent('tp-close', { bubbles: false }));
    });

    // Tool buttons
    root.querySelectorAll('.tp-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.dataset.toolId, 10);
        this._element.dispatchEvent(
          new CustomEvent('tp-tool-selected', { bubbles: false, detail: { id } })
        );
      });
    });
  }

  /** Highlight the currently active tool. */
  syncFromState() {
    if (!this._element) return;
    const sm  = this._main.getSculptManager?.();
    const idx = sm?.getToolIndex?.() ?? -1;
    this._element.querySelectorAll('.tp-btn').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.toolId, 10) === idx);
    });
    this.markDirty();
  }

  get pinned() { return false; }
}
