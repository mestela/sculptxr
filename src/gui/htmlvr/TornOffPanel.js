import { HTMLVRPanel, VR_PANEL_PX_PER_M } from './HTMLVRPanel.js';
import {
  MM_W, injectMMCSS,
  buildSectionHTML_scene,
  buildSectionHTML_rendering,
  buildSectionHTML_topology,
  buildSectionHTML_sculpting,
  buildSectionHTML_animation,
  wireSectionScene,
  wireSectionRendering,
  wireSectionTopology,
  wireSectionSculpting,
  fixSliderDrag,
  wireVRScrollbar,
  refreshVRScrollbar,
} from './MainMenuPanel.js';
import {
  wireAnimationSection,
  syncAnimationSection,
  refreshBlendshapesDOM,
} from './AnimationControlPanel.js';

const HEADER_H = 36; // px

const SECTION_LABELS = {
  scene:     'Scene',
  rendering: 'Rendering',
  topology:  'Topology',
  sculpting: 'Sculpting',
  animation: 'Animation',
};

export class TornOffPanel extends HTMLVRPanel {
  constructor(sectionId, main, scene, camera, renderer) {
    // CSS for .mm-torn-* classes lives in MainMenuPanel.js CSS string so it is
    // injected at startup (before the polyfill caches document.styleSheets).
    injectMMCSS();

    const root = document.createElement('div');
    root.className = 'mm-torn-root';
    // Inline styles as fallback — always present in the serialised clone
    // regardless of whether the polyfill's CSS cache was populated early enough.
    root.style.cssText = `width:${MM_W}px;background:#1e1e2e;color:#cdd6f4;` +
      `font-family:system-ui,-apple-system,sans-serif;box-sizing:border-box;` +
      `border-radius:12px;border:2px solid #cba6f7;overflow:hidden;user-select:none;position:relative;`;
    root.style.height = (HEADER_H + 456 + 4) + 'px';

    root.innerHTML = `
      <div class="mm-torn-header" style="display:flex;align-items:center;height:${HEADER_H}px;padding:0 8px;background:#11111b;border-bottom:2px solid #45475a;box-sizing:border-box;gap:6px;">
        <span class="mm-torn-title" style="flex:1;font-size:12px;font-weight:700;color:#cba6f7;text-transform:uppercase;letter-spacing:0.06em;">${SECTION_LABELS[sectionId] ?? sectionId}</span>
        <button class="mm-torn-redock" title="Return to main panel" style="display:flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border:1px solid #45475a;border-radius:5px;background:#1e1e2e;color:#6c7086;cursor:pointer;outline:none;flex-shrink:0;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>
          </svg>
        </button>
      </div>
      <div class="mm-torn-content" style="background:#1e1e2e;color:#cdd6f4;overflow-y:scroll;overflow-x:hidden;padding:8px 24px 8px 10px;box-sizing:border-box;height:456px;scrollbar-width:none;"></div>
      <div class="mm-scrollbar-track" style="position:absolute;right:2px;top:${HEADER_H + 4}px;bottom:2px;width:14px;background:#181825;border-radius:6px;z-index:20;box-sizing:border-box;"><div class="mm-scrollbar-thumb" style="position:absolute;left:3px;right:3px;min-height:32px;background:#585b70;border-radius:4px;cursor:pointer;"></div></div>
    `;

    super(root, MM_W / VR_PANEL_PX_PER_M);

    this._sectionId = sectionId;
    this._main      = main;

    this.init(scene, camera, renderer);
    this._waitAndSetup(main);
  }

  get sectionId() { return this._sectionId; }

  _waitAndSetup(main) {
    const check = () => {
      if (this.mesh) {
        this.rebuild(main);
        this._wireRedock();
        const el = this._element;
        wireVRScrollbar(
          el.querySelector('.mm-torn-content'),
          el.querySelector('.mm-scrollbar-track'),
          el.querySelector('.mm-scrollbar-thumb'),
          () => this.markDirty()
        );
      } else {
        requestAnimationFrame(check);
      }
    };
    requestAnimationFrame(check);
  }

  /** Rebuilds section HTML and re-wires. Call on full-repaint triggers. */
  rebuild(main) {
    this._main = main;
    const contentEl = this._element.querySelector('.mm-torn-content');
    if (!contentEl) return;

    contentEl.innerHTML = _buildSectionHTML(this._sectionId, main);
    this._wireSection(main);
    fixSliderDrag(contentEl);
    refreshVRScrollbar(contentEl, this._element.querySelector('.mm-scrollbar-thumb'));
    // flushPaint forces an immediate polyfill capture so the texture is
    // populated before the mesh becomes visible — prevents VD from seeing
    // a black (unpainted) frame and keying it out as transparent.
    this.flushPaint();
  }

  _wireSection(main) {
    const el           = this._element;
    const fullRepaint  = () => this.rebuild(main);
    const lightRepaint = () => this.markDirty();

    switch (this._sectionId) {
      case 'scene':
        wireSectionScene(el, main, fullRepaint);
        break;
      case 'rendering':
        wireSectionRendering(el, main, fullRepaint, lightRepaint, lightRepaint);
        break;
      case 'topology':
        wireSectionTopology(el, main, fullRepaint, lightRepaint, lightRepaint);
        break;
      case 'sculpting':
        wireSectionSculpting(el, main, fullRepaint, lightRepaint, lightRepaint);
        break;
      case 'animation':
        wireAnimationSection(el, main, {
          repaint:   lightRepaint,
          sync:      () => { syncAnimationSection(el, main); lightRepaint(); },
          refreshBs: (mesh) => { refreshBlendshapesDOM(el, mesh, main, lightRepaint); lightRepaint(); },
          vrPanel:   this,  // lets VrNumpad position itself next to this torn-off panel
        });
        break;
    }
  }

  _wireRedock() {
    const btn = this._element.querySelector('.mm-torn-redock');
    if (!btn) return;
    btn.addEventListener('click', () => {
      this._element.dispatchEvent(
        new CustomEvent('mm-section-redock', { detail: { section: this._sectionId }, bubbles: false })
      );
    });
  }

  syncFromState() {
    if (this._main) this.rebuild(this._main);
  }
}

function _buildSectionHTML(sectionId, main) {
  switch (sectionId) {
    case 'scene':     return buildSectionHTML_scene(main);
    case 'rendering': return buildSectionHTML_rendering(main);
    case 'topology':  return buildSectionHTML_topology(main);
    case 'sculpting': return buildSectionHTML_sculpting(main);
    case 'animation': return buildSectionHTML_animation();
    default:          return '';
  }
}
