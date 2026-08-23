import { HTMLVRPanel, VR_PANEL_PX_PER_M } from './HTMLVRPanel.js';
import { buildMenuHTML_files, wireMenuFiles, buildMenuHTML_browserSaves, wireMenuBrowserSaves, fixSliderDrag, injectMMCSS } from './MainMenuPanel.js';

const DESKTOP_OVERLAY_ID = '_fp_dom_overlay';

/** Open a saves-only DOM overlay (nested from the files menu). */
export function openBrowserSavesDOMOverlay(main) {
  const OVERLAY_ID = '_fp_saves_overlay';
  const existing = document.getElementById(OVERLAY_ID);
  if (existing) { existing.remove(); return; }

  injectMMCSS();

  const backdrop = document.createElement('div');
  backdrop.id = OVERLAY_ID;
  backdrop.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;pointer-events:auto;';

  const panel = document.createElement('div');
  panel.style.cssText = 'background:#1e1e2e;border-radius:12px;border:2px solid #585b70;overflow:hidden;width:440px;max-height:70vh;display:flex;flex-direction:column;box-shadow:0 16px 48px rgba(0,0,0,0.8);font-family:system-ui,-apple-system,sans-serif;color:#cdd6f4;box-sizing:border-box;';

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:#181825;border-bottom:1px solid #313244;flex-shrink:0;';
  const title = document.createElement('span');
  title.style.cssText = 'font-weight:600;font-size:14px;letter-spacing:0.3px;';
  title.textContent = 'Browser Saves';
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = 'background:none;border:none;color:#cdd6f4;font-size:16px;cursor:pointer;padding:2px 8px;border-radius:4px;line-height:1;';
  closeBtn.addEventListener('click', () => backdrop.remove());
  header.appendChild(title);
  header.appendChild(closeBtn);

  const body = document.createElement('div');
  body.style.cssText = 'overflow-y:auto;padding:8px;flex:1;min-height:0;';

  const build = async () => {
    await guiFiles?.prepareBrowserSavePage?.();
    body.innerHTML = buildMenuHTML_browserSaves(main);
    wireMenuBrowserSaves(body, main, build);
  };
  const guiFiles = main.getGui?.()._ctrlFiles ?? null;
  if (guiFiles) { guiFiles.refreshBrowserSaves().then(build); } else { build(); }

  panel.appendChild(header);
  panel.appendChild(body);
  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);

  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
  document.addEventListener('keydown', function onEsc(e) {
    if (e.key === 'Escape') { backdrop.remove(); document.removeEventListener('keydown', onEsc); }
  });
}

/** Open a plain DOM overlay — used on desktop where no Three.js panel is needed. */
export function openFilesDOMOverlay(main) {
  const existing = document.getElementById(DESKTOP_OVERLAY_ID);
  if (existing) { existing.remove(); return; }

  injectMMCSS();

  const backdrop = document.createElement('div');
  backdrop.id = DESKTOP_OVERLAY_ID;
  backdrop.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;pointer-events:auto;';

  const panel = document.createElement('div');
  panel.style.cssText = [
    'background:#1e1e2e',
    'border-radius:12px',
    'border:2px solid #585b70',
    'overflow:hidden',
    'width:440px',
    'max-height:80vh',
    'display:flex',
    'flex-direction:column',
    'box-shadow:0 16px 48px rgba(0,0,0,0.8)',
    'font-family:system-ui,-apple-system,sans-serif',
    'color:#cdd6f4',
    'box-sizing:border-box',
  ].join(';');

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:#181825;border-bottom:1px solid #313244;flex-shrink:0;';
  const title = document.createElement('span');
  title.style.cssText = 'font-weight:600;font-size:14px;letter-spacing:0.3px;';
  title.textContent = 'Files';
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = 'background:none;border:none;color:#cdd6f4;font-size:16px;cursor:pointer;padding:2px 8px;border-radius:4px;line-height:1;';
  closeBtn.addEventListener('click', () => backdrop.remove());
  header.appendChild(title);
  header.appendChild(closeBtn);

  const body = document.createElement('div');
  body.style.cssText = 'overflow-y:auto;padding:8px;flex:1;min-height:0;';

  const build = async () => {
    await guiFiles?.prepareBrowserSavePage?.();
    body.innerHTML = buildMenuHTML_files(main);
    wireMenuFiles(body, main, build, () => openBrowserSavesDOMOverlay(main));
    fixSliderDrag(body);
  };

  const guiFiles = main.getGui?.()._ctrlFiles ?? null;
  if (guiFiles) {
    guiFiles.refreshBrowserSaves().then(build);
  } else {
    build();
  }

  panel.appendChild(header);
  panel.appendChild(body);
  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);

  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
  document.addEventListener('keydown', function onEsc(e) {
    if (e.key === 'Escape') { backdrop.remove(); document.removeEventListener('keydown', onEsc); }
  });
}

const FP_W      = 440;
const FP_HDR_H  = 40;
const FP_BODY_H = 580;
const FP_H      = FP_HDR_H + FP_BODY_H;

export class FilesPanel extends HTMLVRPanel {
  constructor() {
    injectMMCSS();

    const root = document.createElement('div');
    root.id = 'fp-root';
    root.style.cssText = [
      `width:${FP_W}px`,
      `height:${FP_H}px`,
      'background:#1e1e2e',
      'border-radius:12px',
      'overflow:hidden',
      'font-family:system-ui,-apple-system,sans-serif',
      'color:#cdd6f4',
      'box-sizing:border-box',
      'border:2px solid #585b70',
      'box-shadow:0 16px 48px rgba(0,0,0,0.8)',
    ].join(';');

    root.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:#181825;border-bottom:1px solid #313244;flex-shrink:0">
        <span style="font-weight:600;font-size:14px;letter-spacing:0.3px">Files</span>
        <button id="fp-close" style="background:none;border:none;color:#cdd6f4;font-size:16px;cursor:pointer;padding:2px 8px;border-radius:4px;line-height:1">✕</button>
      </div>
      <div id="fp-body" style="height:${FP_BODY_H}px;overflow-y:auto;padding:8px;box-sizing:border-box"></div>
    `;

    super(root, FP_W / VR_PANEL_PX_PER_M);

    this._root = root;
    this._main = null;
    this._startHidden = true;

    // Close button is in the header which is never rebuilt — wire once.
    root.querySelector('#fp-close').addEventListener('click', () => this.close());

    // VR scroll interception: polyfill can't route pointer events to native
    // scrollbar chrome, so intercept clicks in the right-side gutter.
    const body = root.querySelector('#fp-body');
    body.addEventListener('mousedown', (e) => {
      const inScrollbar = e.offsetX >= body.clientWidth;
      if (!inScrollbar) return;
      const ratio = e.offsetY / body.clientHeight;
      body.scrollTop = ratio * (body.scrollHeight - body.clientHeight);
      this.markDirty();
      e.stopPropagation();
      e.preventDefault();
    });
  }

  /** Open the panel for a given main app instance, pre-loading browser saves. */
  open(main) {
    this._main = main;
    const guiFiles = main.getGui?.()._ctrlFiles ?? null;
    if (guiFiles) {
      guiFiles.refreshBrowserSaves().then(() => guiFiles.prepareBrowserSavePage?.()).then(async () => {
        await this._rebuild();
        this.flushPaint?.();
      });
    } else {
      this._rebuild().then(() => this.flushPaint?.());
    }
    if (this.mesh) this.mesh.visible = true;
  }

  close() {
    if (this.mesh) this.mesh.visible = false;
    this._element.dispatchEvent(new CustomEvent('fp-close', { bubbles: false }));
  }

  syncFromState() {
    if (this._main) this._rebuild();
  }

  async _rebuild() {
    const body = this._root.querySelector('#fp-body');
    if (!body || !this._main) return;
    const token = this._rebuildToken = (this._rebuildToken || 0) + 1;
    const guiFiles = this._main.getGui?.()._ctrlFiles ?? null;
    await guiFiles?.prepareBrowserSavePage?.();
    if (token !== this._rebuildToken) return;
    body.innerHTML = buildMenuHTML_browserSaves(this._main);
    wireMenuBrowserSaves(body, this._main, () => this._rebuild(), () => this.markDirty());
    this.markDirty();
  }
}
