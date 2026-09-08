import TR from './GuiTR.js';
import { TAB_ICONS } from './tabIcons.js';
import { DesktopFloatPanel, injectFloatCSS } from './DesktopFloatPanel.js';

// The tab the sidebar opens on when nothing has been remembered and nothing is pinned.
const DESKTOP_DEFAULT_TAB = 'sculpting';
import GuiCamera from './GuiCamera.js';
import GuiFiles from './GuiFiles.js';
import GuiTopology from './GuiTopology.js';
import GuiSculpting from './GuiSculpting.js';
import GuiTimeline from './GuiTimeline.js';
import BlendshapeStackPanel from './BlendshapeStackPanel.js';
import Shader from '../render/ShaderLib.js';
import Enums from '../misc/Enums.js';
import getOptionsURL from '../misc/getOptionsURL.js';
import {
  buildSectionHTML_scene, buildSectionHTML_rendering, buildSectionHTML_camera, buildSectionHTML_topology, buildSectionHTML_sculpting,
  buildSectionHTML_properties, sectionHeaderHTML, SECTION_LABELS,
  injectMMCSS,
  wireSectionScene, wireSectionRendering, wireSectionTopology, wireSectionSculpting,
  updateOutlinerVisIcons,
  fixSliderDrag,
  buildMenuHTML_files,      wireMenuFiles,
  buildMenuHTML_history,    wireMenuHistory,
  buildMenuHTML_background, wireMenuBackground,
  buildMenuHTML_reference,  wireMenuReference,
  buildMenuHTML_desktopSettings, wireMenuDesktopSettings,
  buildMenuHTML_about,    wireMenuAbout,
} from './htmlvr/MainMenuPanel.js';

import Export from '../files/Export.js';
import { openBrowserSavesDOMOverlay } from './htmlvr/FilesPanel.js';

// Web Awesome Imports for vertical sidebar tabs
import '@awesome.me/webawesome/dist/styles/webawesome.css';
import '@awesome.me/webawesome/dist/components/tab-group/tab-group.js';
import '@awesome.me/webawesome/dist/components/tab/tab.js';
import '@awesome.me/webawesome/dist/components/tab-panel/tab-panel.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@awesome.me/webawesome/dist/components/details/details.js';
import '@awesome.me/webawesome/dist/components/checkbox/checkbox.js';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/select/select.js';
import '@awesome.me/webawesome/dist/components/option/option.js';
import '@awesome.me/webawesome/dist/components/slider/slider.js';

const TOPBAR_HEIGHT = 36;   // px — must match onCanvasResize top:36px allowance
const SIDEBAR_WIDTH = 380;  // px

// ── VR-safe dialogs ────────────────────────────────────────────────────────────
// Native confirm()/alert()/prompt() block the JS thread, killing the WebXR frame
// loop in PCVR. These non-blocking replacements use a DOM overlay instead.

window._vrConfirm = function(message, onOk, onCancel) {
  // In a headset the flat DOM overlay is invisible/uninteractable — route to the
  // in-scene VrConfirm panel (ray-interactable) instead.
  if (window._vrConfirmPanel && window.app?._renderer?.xr?.isPresenting) {
    window._vrConfirmPanel.open(message, onOk, onCancel);
    return;
  }

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.78);display:flex;align-items:center;justify-content:center;z-index:999999;font-family:system-ui,sans-serif;';

  const box = document.createElement('div');
  box.style.cssText = 'background:#1e1e1e;border:1px solid #555;border-radius:10px;padding:28px 32px;max-width:380px;width:90%;text-align:center;color:#eee;box-shadow:0 8px 40px rgba(0,0,0,.8);';

  const msg = document.createElement('p');
  msg.style.cssText = 'margin:0 0 22px;font-size:15px;line-height:1.5;';
  msg.textContent = message;

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:12px;justify-content:center;';

  const mkBtn = (label, bg, fg) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = `background:${bg};color:${fg};border:none;border-radius:6px;padding:9px 28px;font-size:14px;cursor:pointer;font-weight:600;`;
    b.onmouseenter = () => { b.style.opacity = '0.85'; };
    b.onmouseleave = () => { b.style.opacity = '1'; };
    return b;
  };

  const btnCancel = mkBtn('Cancel', '#444', '#eee');
  const btnOk     = mkBtn('Confirm', '#c0392b', '#fff');

  btnRow.appendChild(btnCancel);
  btnRow.appendChild(btnOk);
  box.appendChild(msg);
  box.appendChild(btnRow);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  const close = () => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); };
  btnOk.onclick     = () => { close(); onOk?.(); };
  btnCancel.onclick = () => { close(); onCancel?.(); };
  overlay.addEventListener('click', e => { if (e.target === overlay) { close(); onCancel?.(); } });
  btnCancel.focus(); // default focus on safe option
};

window._vrAlert = function(message) {
  // During XR: log to screen overlay; otherwise show a non-blocking toast
  if (window._screenLog) { window._screenLog('⚠ ' + message, 5000); return; }

  const toast = document.createElement('div');
  toast.style.cssText = 'position:fixed;bottom:32px;left:50%;transform:translateX(-50%);background:#222;border:1px solid #666;border-radius:8px;padding:14px 24px;color:#eee;font-family:system-ui,sans-serif;font-size:14px;z-index:999999;max-width:480px;box-shadow:0 4px 24px rgba(0,0,0,.7);display:flex;gap:16px;align-items:center;';
  toast.innerHTML = `<span>⚠ ${message}</span><button style="background:#444;color:#eee;border:none;border-radius:5px;padding:4px 14px;cursor:pointer;font-size:13px;">OK</button>`;
  document.body.appendChild(toast);
  const close = () => { if (toast.parentNode) toast.parentNode.removeChild(toast); };
  toast.querySelector('button').onclick = close;
  setTimeout(close, 8000); // auto-dismiss after 8 s
};

class Gui {

  constructor(main) {
    this._main = main;

    this._topbarEl  = null;
    this._sidebarEl = null;
    this._dropdowns = {};
    this._dropdownCloseHandler = null;

    this._ctrlFiles    = null;
    this._ctrlCamera   = null;
    this._ctrlSculpting = null;
    this._ctrlTopology  = null;
    this._ctrlTimeline  = null;

    // Desktop section panel elements (for rebuild on mesh change)
    this._desktopSceneEl     = null;
    this._desktopRenderingEl = null;
    this._desktopTopologyEl  = null;
    this._desktopSculptingEl = null;
    this._renderingFilesRemoveCb = null;

    this._notifications = {};
    this._xhrs = {};

    this._ctrls = [];
  }

  initGui() {
    this.deleteGui();

    const main  = this._main;
    const viewport = main.getViewport();

    var ctrls = this._ctrls;
    ctrls.length = 0;
    var idc = 0;

    // ── Controllers ────────────────────────────────────────────────────────────
    ctrls[idc++] = this._ctrlFiles  = new GuiFiles(null, this);
    ctrls[idc++] = this._ctrlCamera = new GuiCamera(null, this);

    // Inline key handlers extracted from GuiScene (deleted)
    const gui = this;
    ctrls[idc++] = {
      onKeyDown(event) {
        if (event.handled === true) return;
        event.stopPropagation();
        if (!main._focusGui) event.preventDefault();

        if (event.which === 73 && !event.ctrlKey) {               // I — isolate toggle
          event.handled = true;
          const meshes = main.getMeshes?.() ?? [];
          const hasHidden = meshes.some(m => !m.isVisible?.());
          if (hasHidden) {
            const toShow = meshes.filter(m => !m.isVisible?.());
            toShow.forEach(m => m.setVisible?.(true));
            const cbU = () => toShow.forEach(m => m.setVisible?.(false));
            const cbR = () => toShow.forEach(m => m.setVisible?.(true));
            main.getStateManager?.().pushStateCustom?.(cbU, cbR);
          } else {
            const selected = main.getSelectedMeshes?.() ?? [];
            if (meshes.length >= 2 && selected.length > 0 && selected.length < meshes.length) {
              const selSet = new Set(selected);
              const toHide = meshes.filter(m => !selSet.has(m));
              toHide.forEach(m => m.setVisible?.(false));
              const cbU = () => toHide.forEach(m => m.setVisible?.(true));
              const cbR = () => toHide.forEach(m => m.setVisible?.(false));
              main.getStateManager?.().pushStateCustom?.(cbU, cbR);
            }
          }
          main.render?.();
          if (gui._desktopSceneEl) gui._buildDesktopScene(gui._desktopSceneEl);
          gui.refreshFloatingSections?.();

        } else if (event.which === 68 && event.ctrlKey) {         // Ctrl+D — duplicate
          event.handled = true;
          main.duplicateSelection?.();
        }
      }
    };

    // Inline key handlers extracted from GuiStates (deleted)
    ctrls[idc++] = {
      onKeyDown(event) {
        if (event.handled === true) return;
        event.stopPropagation();
        if (!main._focusGui) event.preventDefault();
        const key = event.which;
        if (event.ctrlKey && key === 90) {                        // Ctrl+Z — undo
          event.handled = true;
          main._action = Enums.Action.NOTHING;
          main.undo?.();
        } else if (event.ctrlKey && key === 89) {                 // Ctrl+Y — redo
          event.handled = true;
          main.redo?.();
        }
      }
    };

    // ── Sidebar ────────────────────────────────────────────────────────────────
    const sidebarEl = this._sidebarEl = document.createElement('div');
    sidebarEl.id = 'gui-sidebar';
    Object.assign(sidebarEl.style, {
      position: 'fixed', top: '0', right: '0',
      width:  SIDEBAR_WIDTH + 'px', bottom: '0',
      background: '#121212',
      borderLeft: '1px solid #2d2d2d',
      overflow: 'hidden',
      zIndex: '1050'
    });
    document.body.appendChild(sidebarEl);

    // Resize handle — vertical 3-dot grip on the left edge of the sidebar.
    const sidebarHandle = document.createElement('div');
    Object.assign(sidebarHandle.style, {
      position: 'absolute', top: '0', left: '0', bottom: '0', width: '14px',
      cursor: 'ew-resize', zIndex: '9999', display: 'flex', touchAction: 'none',
      flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '5px',
    });
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement('div');
      Object.assign(dot.style, {
        width: '3px', height: '3px', borderRadius: '50%',
        background: '#555', pointerEvents: 'none', flexShrink: '0',
      });
      sidebarHandle.appendChild(dot);
    }
    sidebarEl.appendChild(sidebarHandle);

    // Drag to resize — pointer events work on desktop and iPad.
    // onResize is throttled via rAF so the canvas stays in sync without thrashing.
    let _resizingW = 0;
    let _resizeStartX = 0;
    let _resizeRafPending = false;
    sidebarHandle.addEventListener('pointerdown', (e) => {
      _resizeStartX = e.clientX;
      _resizingW = sidebarEl.offsetWidth;
      sidebarHandle.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    sidebarHandle.addEventListener('pointermove', (e) => {
      if (!_resizingW) return;
      const newW = Math.max(240, Math.min(700, _resizingW - (e.clientX - _resizeStartX)));
      sidebarEl.style.width = newW + 'px';
      if (this._topbarEl) this._topbarEl.style.right = newW + 'px';
      if (!_resizeRafPending) {
        _resizeRafPending = true;
        requestAnimationFrame(() => {
          _resizeRafPending = false;
          if (this._main?.onCanvasResize) this._main.onCanvasResize();
        });
      }
    });
    sidebarHandle.addEventListener('pointerup', () => {
      if (!_resizingW) return;
      _resizingW = 0;
      if (this._main?.onCanvasResize) this._main.onCanvasResize();
    });

    // Create Blender-inspired vertical tab group inside the sidebar
    const tabGroup = document.createElement('wa-tab-group');
    tabGroup.setAttribute('placement', 'start');
    tabGroup.className = 'sidebar-tab-group wa-dark';
    tabGroup.style.height = '100%';
    tabGroup.style.width  = '100%';

    const tabStyle = document.createElement('style');
    tabStyle.innerHTML = `
      .sidebar-tab-group {
        --track-color: transparent;
        --indicator-color: #3b82f6;
        display: flex;
        height: 100%;
        width: 100%;
      }
      .sidebar-tab-group::part(base) {
        display: flex;
        flex-direction: row;
        width: 100%;
        height: 100%;
        border: none;
      }
      .sidebar-tab-group::part(body) {
        flex: 1;
        height: 100%;
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .sidebar-tab-group::part(nav) {
        background-color: #121212;
        border-right: 1px solid #2d2d2d;
        padding-top: 12px;
        width: 54px;
        min-width: 54px;
        flex-shrink: 0;
      }
      .sidebar-tab-group::part(tabs) {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
      }
      .sidebar-tab-group::part(active-tab-indicator) {
        border-left: 3px solid #3b82f6;
        border-radius: 1.5px;
      }
      .sidebar-tab-group wa-tab {
        --wa-color-primary-600: #3b82f6;
        width: 40px;
        height: 40px;
        border-radius: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        transition: all 0.2s ease;
      }
      .sidebar-tab-group wa-tab::part(base) {
        padding: 0;
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #888;
      }
      .sidebar-tab-group wa-tab[active]::part(base) {
        color: #3b82f6;
        background-color: rgba(59, 130, 246, 0.1);
      }
      .sidebar-tab-group wa-tab:hover::part(base) {
        color: #fff;
        background-color: rgba(255, 255, 255, 0.05);
      }
      .sidebar-tab-group wa-tab.tl-on::part(base) {
        color: #94e2d5;
        background-color: rgba(148, 226, 213, 0.12);
      }
      .sidebar-tab-group wa-tab .tab-icon { width: 18px; height: 18px; display: block; }
      .sidebar-tab-group wa-tab-panel {
        flex: 1;
        height: 100%;
        overflow-y: auto;
        overflow-x: hidden !important;
        background-color: #1a1a1a;
      }
      .sidebar-tab-group wa-tab-panel::part(base) {
        padding: 10px;
        height: 100%;
        box-sizing: border-box;
        overflow-x: hidden !important;
      }
      .sidebar-tab-group wa-tab-panel .gui-ul > label { display: none !important; }
      .sidebar-tab-group wa-tab-panel .gui-ul {
        margin: 0 !important; padding: 0 !important;
        border: none !important; background: transparent !important;
      }
      .sidebar-tab-group wa-tab-panel .gui-ul > li {
        border: none !important; background: transparent !important;
      }
      .sidebar-tab-group wa-tab-panel .btn-grid {
        display: flex; gap: 4px; width: 100% !important; box-sizing: border-box;
      }
      .sidebar-tab-group wa-tab-panel .btn-grid wa-button { flex: 1; min-width: 0 !important; }
      .sidebar-tab-group wa-tab-panel .btn-grid wa-button::part(base) {
        padding: 0 !important; min-width: 0 !important;
      }
      .grid-tool-btn::part(base) {
        font-family: 'Inter', sans-serif; font-weight: 600; font-size: 10px;
        letter-spacing: 0.3px; border-radius: 4px; height: 32px; padding: 0 4px !important;
        display: flex; align-items: center; justify-content: center;
        text-align: center; white-space: normal !important; word-break: break-word;
        line-height: 1.1;
        background-color: var(--btn-bg) !important;
        border: 1px solid var(--btn-border) !important;
        color: var(--btn-color) !important;
        box-shadow: var(--btn-shadow) !important;
        transition: all 0.15s ease;
      }
      .grid-tool-btn:hover::part(base) { filter: brightness(1.2); cursor: pointer; }
      @keyframes bsTabFlash {
        0%   { background-color: rgba(255,77,77,0.0); }
        15%  { background-color: rgba(255,77,77,0.6); }
        100% { background-color: rgba(255,77,77,0.0); }
      }
      .sidebar-tab-group wa-tab.bs-flash { animation: bsTabFlash 0.45s ease-out; border-radius: 6px; }
    `;
    tabGroup.appendChild(tabStyle);

    const TAB_SVGS = TAB_ICONS;

    const createTab = (panelName, tooltipText) => {
      const tab = document.createElement('wa-tab');
      tab.setAttribute('slot', 'nav');
      tab.setAttribute('panel', panelName);
      tab.setAttribute('title', tooltipText);
      // ALREADY PINNED FROM LAST SESSION? Marked here rather than after the restore, because
      // the restore runs while the sidebar is still being built and the strip is not in the
      // document yet -- marking then finds nothing, and a frame later it still did not. The
      // saved state IS available at this point, so the tab can be born dimmed and
      // _updatePinnedTabStates only has to handle changes made during the session.
      if ((getOptionsURL().desktopPins || {})[panelName]) tab.classList.add('tab-pinned');
      const span = document.createElement('span');
      span.innerHTML = TAB_SVGS[panelName] ?? '';
      tab.appendChild(span);
      return tab;
    };

    const sceneTab     = createTab('scene',     'Scene');
    const renderingTab = createTab('rendering', TR('renderingTitle'));
    // Camera and capture, moved out of Rendering — five of that section's twelve headings, none
    // of them about how the model is drawn. See buildSectionHTML_camera.
    const cameraTab    = createTab('camera',    'Camera');
    const topologyTab  = createTab('topology',  TR('topologyTitle'));
    const sculptingTab = createTab('sculpting', TR('sculptTitle'));
    const propertiesTab = createTab('properties', 'Properties');
    const animationTab = createTab('animation', 'Animation');
    const blendshapesTab = createTab('blendshapes', 'Blendshapes');
    const timelineTab  = createTab('timeline',  'Timeline');

    // WHICH TAB OPENS.
    //
    // The one you left open last time, unless it is PINNED -- a pinned section's tab shows only
    // "this section is floating", so opening onto it wastes the sidebar on a placeholder while
    // the panel it is describing is already on screen. matt: "if i have the tools and outliner
    // pinned, its pointless to show the tools panel in the sidebar by default, that currently
    // just shows 'this panel has been pinned'."
    //
    // Falls through the ordinary tabs in order, so a session with everything pinned still opens
    // on something rather than nothing.
    {
      const pins = getOptionsURL().desktopPins || {};
      const tabsByName = { scene: sceneTab, rendering: renderingTab, camera: cameraTab,
        topology: topologyTab,
        sculpting: sculptingTab, properties: propertiesTab, animation: animationTab };
      const saved = getOptionsURL()._rawSaved?.desktopTab;
      const order = [saved, DESKTOP_DEFAULT_TAB, 'sculpting', 'properties', 'scene',
        'topology', 'rendering', 'animation'];
      const pick = order.find((n) => n && tabsByName[n] && !pins[n]) || DESKTOP_DEFAULT_TAB;
      (tabsByName[pick] || sculptingTab).setAttribute('active', '');
    }

    tabGroup.appendChild(sceneTab);
    tabGroup.appendChild(renderingTab);
    tabGroup.appendChild(cameraTab);
    tabGroup.appendChild(topologyTab);
    tabGroup.appendChild(sculptingTab);
    tabGroup.appendChild(propertiesTab);
    // Layers (blendshapes) then Animation then Timeline — anim + timeline sit adjacent
    // since they're tightly linked.
    tabGroup.appendChild(blendshapesTab);
    tabGroup.appendChild(animationTab);
    tabGroup.appendChild(timelineTab);

    const scenePanel     = document.createElement('wa-tab-panel'); scenePanel.setAttribute('name', 'scene');
    const renderingPanel = document.createElement('wa-tab-panel'); renderingPanel.setAttribute('name', 'rendering');
    const cameraPanel    = document.createElement('wa-tab-panel'); cameraPanel.setAttribute('name', 'camera');
    const topologyPanel  = document.createElement('wa-tab-panel'); topologyPanel.setAttribute('name', 'topology');
    const sculptingPanel = document.createElement('wa-tab-panel'); sculptingPanel.setAttribute('name', 'sculpting');
    const propertiesPanel = document.createElement('wa-tab-panel'); propertiesPanel.setAttribute('name', 'properties');
    const animationPanel = document.createElement('wa-tab-panel');
    animationPanel.setAttribute('name', 'animation');
    animationPanel.id = '_acp_sidebar_panel';
    const blendshapesPanel = document.createElement('wa-tab-panel');
    blendshapesPanel.setAttribute('name', 'blendshapes');
    // Timeline tab has no panel content — it's a pure toggle for the timeline overlay.
    const timelinePanel  = document.createElement('wa-tab-panel');
    timelinePanel.setAttribute('name', 'timeline');

    tabGroup.appendChild(scenePanel);
    tabGroup.appendChild(renderingPanel);
    tabGroup.appendChild(cameraPanel);
    tabGroup.appendChild(topologyPanel);
    tabGroup.appendChild(sculptingPanel);
    tabGroup.appendChild(propertiesPanel);
    tabGroup.appendChild(blendshapesPanel);
    tabGroup.appendChild(animationPanel);
    tabGroup.appendChild(timelinePanel);

    // Canvas-2D blendshape layer-stack panel (replaces the HTML blendshape UI).
    this._ctrlBlendshapes = new BlendshapeStackPanel(this._main).mount(blendshapesPanel);
    // Tab ref so a blocked sculpt can pulse the icon when the panel isn't visible.
    this._ctrlBlendshapes._tabEl = blendshapesTab;

    sidebarEl.appendChild(tabGroup);

    // Timeline tab toggles the timeline overlay without switching panel content.
    // Intercept in capture phase before wa-tab-group's own listener processes it.
    // Store ref globally so ACP syncAnimationSection can keep both in sync.
    window._animTimelineTabEl = timelineTab;
    let _prevActivePanel = 'sculpting';
    tabGroup.addEventListener('wa-tab-show', (e) => {
      const name = e.detail?.name;
      if (name !== 'timeline') {
        _prevActivePanel = name ?? _prevActivePanel;
        // REMEMBERED FOR NEXT SESSION, alongside the pin state -- the sidebar's arrangement is
        // one preference, not two. Timeline is excluded because it is a toggle for an overlay
        // rather than a panel; restoring onto it would show an empty sidebar.
        if (name) getOptionsURL.saveOption('desktopTab', name, 400);
      }
      // Rebuild the Scene outliner on show so it reflects the current meshes /
      // references (it's otherwise built once and goes stale when you add either).
      if (name === 'scene' && this._desktopSceneEl) this._buildDesktopScene(this._desktopSceneEl);
      this.refreshFloatingSections?.();
      if (name === 'blendshapes') this._ctrlBlendshapes?.onShow();
    });
    timelineTab.addEventListener('click', (e) => {
      e.stopImmediatePropagation();
      const tl = this._ctrlTimeline;
      if (!tl) return;
      const nowVisible = !tl._visible;
      tl.setVisibility(nowVisible);
      timelineTab.classList.toggle('tl-on', nowVisible);
      // Keep the ACP button in sync.
      document.querySelector('#acp-show-timeline-btn')?.classList.toggle('active', nowVisible);
      // Switch back to the previous content panel so the sidebar doesn't go blank.
      if (!nowVisible) tabGroup.show(_prevActivePanel);
    }, true);

    // GuiTopology and GuiSculpting use a detached container so their internals
    // work without adding yagui widgets to the visible sidebar.
    const detachedContainer = document.createElement('div');
    const makeDetachedParent = () => ({
      domSidebar: detachedContainer,
      addMenu: (name) => new WebAwesomeFolderMock(name, detachedContainer, null)
    });

    this._ctrlTopology  = new GuiTopology(makeDetachedParent(), this);
    this._ctrlSculpting = new GuiSculpting(makeDetachedParent(), this);

    ctrls[idc++] = this._ctrlTopology;
    ctrls[idc++] = this._ctrlSculpting;

    // Keep the desktop sculpting panel in sync whenever the active tool changes.
    const _ctrlSculptOrigSetValue = this._ctrlSculpting._ctrlSculpt.setValue.bind(this._ctrlSculpting._ctrlSculpt);
    this._ctrlSculpting._ctrlSculpt.setValue = (val, silent) => {
      _ctrlSculptOrigSetValue(val, silent);
      if (!silent && this._desktopSculptingEl) this._buildDesktopSculpting(this._desktopSculptingEl);
      this.refreshFloatingSections?.();
      if (this._desktopPropertiesEl) this._buildDesktopProperties(this._desktopPropertiesEl);
    };

    const _origOnKeyUp = this._ctrlSculpting.onKeyUp.bind(this._ctrlSculpting);
    this._ctrlSculpting.onKeyUp = (event) => {
      _origOnKeyUp(event);
      if (this._desktopSculptingEl) this._buildDesktopSculpting(this._desktopSculptingEl);
      this.refreshFloatingSections?.();
      if (this._desktopPropertiesEl) this._buildDesktopProperties(this._desktopPropertiesEl);
    };

    injectMMCSS();

    this._desktopSceneEl     = scenePanel;
    this._desktopRenderingEl = renderingPanel;
    this._desktopCameraEl    = cameraPanel;
    this._desktopTopologyEl  = topologyPanel;
    this._desktopSculptingEl = sculptingPanel;
    this._desktopPropertiesEl = propertiesPanel;
    this._buildDesktopScene(scenePanel);
    // Global hook so the animation loop can live-refresh the outliner eye icons.
    window._updateOutlinerVisIcons = () => updateOutlinerVisIcons(this._main);
    this._buildDesktopRendering(renderingPanel);
    this._buildDesktopCamera(cameraPanel);
    this._buildDesktopTopology(topologyPanel);
    this._buildDesktopSculpting(sculptingPanel);
    this._buildDesktopProperties(propertiesPanel);
    // Last, so every tab exists for a restored pin to empty out.
    this._restorePinnedSections();

    // Wire file-input listeners for rendering (matcap + UV texture loading).
    const ShaderUV     = Shader[Enums.Shader.UV];
    const ShaderMatcap = Shader[Enums.Shader.MATCAP];

    const onTexLoad = (evt) => {
      ShaderUV.texture0 = undefined;
      ShaderUV.texPath  = evt.target.result;
      main.render();
    };
    const cbLoadTex = (event) => {
      if (!event.target.files.length) return;
      const file = event.target.files[0];
      if (!file.type.match('image.*')) return;
      const reader = new FileReader();
      reader.onload = onTexLoad;
      document.getElementById('textureopen').value = '';
      reader.readAsDataURL(file);
    };

    const cbLoadMatcap = (event) => {
      if (!event.target.files.length) return;
      const file = event.target.files[0];
      if (!file.type.match('image.*')) return;
      const reader = new FileReader();
      reader.onload = (evt) => {
        const img = new Image();
        img.src = evt.target.result;
        img.onload = () => {
          const idMatcap = ShaderMatcap.matcaps.length;
          ShaderMatcap.matcaps.push({ name: file.name });
          ShaderMatcap.createTexture(main._gl, img, idMatcap);
          if (this._desktopRenderingEl) this._buildDesktopRendering(this._desktopRenderingEl);
          main.render();
        };
      };
      document.getElementById('matcapopen').value = '';
      reader.readAsDataURL(file);
    };

    document.getElementById('textureopen').addEventListener('change', cbLoadTex, false);
    document.getElementById('matcapopen').addEventListener('change', cbLoadMatcap, false);
    this._renderingFilesRemoveCb = () => {
      document.getElementById('textureopen').removeEventListener('change', cbLoadTex, false);
      document.getElementById('matcapopen').removeEventListener('change', cbLoadMatcap, false);
    };

    // Wireframe keyboard shortcut
    ctrls[idc++] = {
      onKeyUp(event) {
        if (getOptionsURL.getShortKey(event.which) === Enums.KeyAction.WIREFRAME && !event.ctrlKey) {
          const mesh = main.getMesh();
          if (!mesh) return;
          const next = !mesh.getShowWireframe?.();
          // Apply to the selection, falling back to the active mesh — a voxel object is
          // the active mesh but isn't in the selection list, so it was being skipped.
          const sel = main.getSelectedMeshes?.() ?? [];
          (sel.length ? sel : [mesh]).forEach(m => m.setShowWireframe?.(next));
          main.render();
          const wireBtn = gui._desktopRenderingEl?.querySelector('#mm-wireframe');
          if (wireBtn) wireBtn.classList.toggle('active', next);
        }
      }
    };

    // Animation tab content is provided by AnimationControlPanel (embedded by Scene.js)

    this._ctrlTimeline = new GuiTimeline(main);
    this._ctrlTimeline.setVisibility(false);

    // ── Topbar ─────────────────────────────────────────────────────────────────
    this._injectTopbarCSS();

    const topbarEl = this._topbarEl = document.createElement('div');
    topbarEl.id = 'gui-topbar';
    Object.assign(topbarEl.style, {
      position: 'fixed', top: '0', left: '0', right: SIDEBAR_WIDTH + 'px',
      height: TOPBAR_HEIGHT + 'px',
      background: '#11111b',
      borderBottom: 'none',
      display: 'flex', alignItems: 'center', gap: '2px',
      padding: '0 8px',
      zIndex: '1100',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      boxSizing: 'border-box'
    });
    document.body.appendChild(topbarEl);

    // Dropdown menu definitions
    const menuDefs = [
      { id: 'files',      label: 'Files ▾',      buildFn: buildMenuHTML_files,      wireFn: wireMenuFiles,      extraArgs: [() => openBrowserSavesDOMOverlay(main)] },
      { id: 'history',    label: 'History ▾',    buildFn: buildMenuHTML_history,    wireFn: wireMenuHistory },
      { id: 'background', label: 'Background ▾', buildFn: buildMenuHTML_background, wireFn: wireMenuBackground },
      { id: 'reference',  label: 'Reference ▾',  buildFn: buildMenuHTML_reference,  wireFn: wireMenuReference },
      { id: 'settings',   label: 'Settings ▾',   buildFn: buildMenuHTML_desktopSettings, wireFn: wireMenuDesktopSettings },
      { id: 'about',      label: 'About ▾',      buildFn: buildMenuHTML_about,      wireFn: wireMenuAbout },
    ];

    this._dropdowns = {};

    for (const def of menuDefs) {
      const btn = document.createElement('button');
      btn.className = 'desktop-menu-btn';
      btn.textContent = def.label;

      const dd = document.createElement('div');
      dd.className = 'desktop-dropdown';
      dd.style.display = 'none';
      document.body.appendChild(dd);

      btn.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        const isOpen = dd.style.display !== 'none';
        this._closeAllDropdowns();
        if (!isOpen) this._openDropdown(btn, dd, def);
      });

      topbarEl.appendChild(btn);
      this._dropdowns[def.id] = { btn, dd, def };
    }

    // Mesh stats — absolutely positioned at the right end of the topbar
    const statsSpan = document.createElement('span');
    statsSpan.id = 'desktop-mesh-stats';
    Object.assign(statsSpan.style, {
      position: 'absolute', right: '12px', top: '50%',
      transform: 'translateY(-50%)',
      color: '#666', fontSize: '11px',
      cursor: 'default', whiteSpace: 'nowrap',
      pointerEvents: 'none'
    });
    topbarEl.appendChild(statsSpan);

    // Close all dropdowns on outside click
    this._dropdownCloseHandler = (e) => {
      if (!e.target.closest?.('.desktop-dropdown') && !e.target.closest?.('.desktop-menu-btn')) {
        this._closeAllDropdowns();
      }
    };
    document.addEventListener('mousedown', this._dropdownCloseHandler);

    this.updateMesh();
    this.setVisibility(true);

    if (window.postprocessGui) window.postprocessGui();
  }

  _injectTopbarCSS() {
    if (document.getElementById('gui-topbar-css')) return;
    const style = document.createElement('style');
    style.id = 'gui-topbar-css';
    style.textContent = `
      .desktop-menu-btn {
        padding: 4px 10px;
        border: none;
        border-radius: 0;
        background: #1e1e2e;
        color: #cdd6f4;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        outline: none;
        white-space: nowrap;
        flex-shrink: 0;
      }
      .desktop-menu-btn:hover { background: #313244; }
      .desktop-menu-btn.active { background: #45475a; color: #89b4fa; }
      .desktop-dropdown {
        position: fixed;
        background: #1e1e2e;
        border: 1px solid #585b70;
        border-radius: 8px;
        padding: 8px;
        min-width: 180px;
        max-width: min(340px, 92vw);
        box-sizing: border-box;
        max-height: 80vh;
        overflow-y: auto;
        z-index: 1200;
      }
    `;
    document.head.appendChild(style);
  }

  _openDropdown(btn, dd, def) {
    const rect = btn.getBoundingClientRect();
    dd.style.top  = (rect.bottom + 2) + 'px';
    dd.style.left = rect.left + 'px';
    dd.style.display = 'block';
    btn.classList.add('active');

    const main    = this._main;
    const rebuild = () => {
      dd.innerHTML = def.buildFn(main);
      def.wireFn(dd, main, rebuild, ...(def.extraArgs ?? []));
    };
    rebuild();
  }

  _closeAllDropdowns() {
    for (const { btn, dd } of Object.values(this._dropdowns ?? {})) {
      dd.style.display = 'none';
      btn.classList.remove('active');
    }
  }

  getNotification(notifName) {
    var notif = this._notifications[notifName];
    if (!notif) {
      const span = document.createElement('span');
      span.style.cssText = 'color:red;padding:4px 8px;font-size:12px;display:none;flex-shrink:0';
      this._topbarEl?.appendChild(span);

      notif = {
        domContainer: span,
        isVisible:    () => span.style.display !== 'none',
        setMessage:   (msg) => { span.innerHTML = msg ?? ''; span.style.display = msg ? '' : 'none'; },
        setVisibility:(v)   => { span.style.display = v ? '' : 'none'; }
      };

      this._notifications[notifName] = notif;
      return notif;
    }

    if (this._xhrs[notifName] && notif.isVisible()) {
      const xhrToAbort = this._xhrs[notifName];
      window._vrConfirm('Abort ' + notifName + ' previous upload?', () => {
        xhrToAbort.abort();
        xhrToAbort.isAborted = true;
        notif.setMessage(null);
      });
      return;
    }

    return notif;
  }

  exportSketchfab() {
    this._export('sketchfab');
  }

  exportMaterialise() {
    window._vrConfirm('A new webpage will be opened. Start upload?', () => {
      this._export('materialise');
    });
  }

  _export(notifName) {
    var mesh = this._main.getMesh();
    if (!mesh) return;
    var notif = this.getNotification(notifName);
    if (!notif) return;
    var fName = 'export' + notifName.charAt(0).toUpperCase() + notifName.slice(1);
    this._xhrs[notifName] = Export[fName](this._main, notif);
  }

  updateMesh() {
    if (!this._topbarEl) return;
    this._ctrlTopology?.updateMesh();
    this._ctrlSculpting?.updateMesh();
    if (this._desktopSceneEl)     this._buildDesktopScene(this._desktopSceneEl);
    if (this._desktopRenderingEl) this._buildDesktopRendering(this._desktopRenderingEl);
    if (this._desktopTopologyEl)  this._buildDesktopTopology(this._desktopTopologyEl);
    if (this._desktopSculptingEl) this._buildDesktopSculpting(this._desktopSculptingEl);
    if (this._desktopPropertiesEl) this._buildDesktopProperties(this._desktopPropertiesEl);
    this.refreshFloatingSections?.();
    if (window._animPanel) window._animPanel.refreshBlendshapes(this._main.getMesh(), this._main);
    this._ctrlBlendshapes?.onShow();
    this.updateMeshInfo();
  }

  updateMeshInfo() {
    const statsEl = document.getElementById('desktop-mesh-stats');
    if (!statsEl) return;
    const mesh  = this._main.getMesh();
    const verts = mesh ? mesh.getNbVertices() : 0;
    const faces = mesh ? mesh.getNbFaces() : 0;
    statsEl.textContent = `${verts.toLocaleString()} verts  ${faces.toLocaleString()} faces`;
  }

  getFlatShading() {
    return this._main.getMesh()?.getFlatShading?.() ?? false;
  }

  getWireframe() {
    return this._main.getMesh()?.getShowWireframe?.() ?? false;
  }

  getShaderType() {
    return this._main.getMesh()?.getShaderType?.() ?? 0;
  }

  addAlphaOptions(opts) {
    this._ctrlSculpting?.addAlphaOptions(opts);
    if (this._desktopSculptingEl) this._buildDesktopSculpting(this._desktopSculptingEl);
    this.refreshFloatingSections?.();
    if (this._desktopPropertiesEl) this._buildDesktopProperties(this._desktopPropertiesEl);
  }

  deleteGui() {
    if (!this._topbarEl?.parentNode && !this._sidebarEl?.parentNode) return;

    this.callFunc('removeEvents');

    if (this._renderingFilesRemoveCb) {
      this._renderingFilesRemoveCb();
      this._renderingFilesRemoveCb = null;
    }

    if (this._dropdownCloseHandler) {
      document.removeEventListener('mousedown', this._dropdownCloseHandler);
      this._dropdownCloseHandler = null;
    }

    for (const { dd } of Object.values(this._dropdowns ?? {})) {
      dd.parentNode?.removeChild(dd);
    }
    this._dropdowns = {};

    this.setVisibility(false);

    if (this._ctrlTimeline?._container?.parentNode) {
      this._ctrlTimeline._container.parentNode.removeChild(this._ctrlTimeline._container);
    }

    this._topbarEl?.parentNode?.removeChild(this._topbarEl);
    this._topbarEl = null;
    this._sidebarEl?.parentNode?.removeChild(this._sidebarEl);
    this._sidebarEl = null;
  }

  setVisibility(bool) {
    if (this._topbarEl)  this._topbarEl.style.display  = bool ? '' : 'none';
    if (this._sidebarEl) this._sidebarEl.style.display = bool ? '' : 'none';
  }

  callFunc(func, event) {
    for (var i = 0, ctrls = this._ctrls, nb = ctrls.length; i < nb; ++i) {
      var ct = ctrls[i];
      if (ct && ct[func]) ct[func](event);
    }
  }

  // ── Desktop section panel helpers ──────────────────────────────────────────

  _buildDesktopScene(panelEl) {
    if (this._sectionIsFloating(panelEl, 'scene')) return;
    const main = this._main;
    // KEEP THE SCROLL across the rebuild — the desktop sidebar shares the outliner markup with
    // the VR panel and loses its position the same way. See the note there.
    const scrolls = [];
    panelEl.querySelectorAll('.mm-outliner-list').forEach((el, i) => scrolls.push([i, el.scrollTop]));
    panelEl.innerHTML = buildSectionHTML_scene(main);
    if (scrolls.length) {
      const lists = panelEl.querySelectorAll('.mm-outliner-list');
      for (const [i, top] of scrolls) if (lists[i]) lists[i].scrollTop = top;
    }
    const rebuild = () => this._buildDesktopScene(panelEl);
    // Pass a no-op lightRepaintFn so wireSelect doesn't call rebuild() when
    // toggling a dropdown open — that would replace innerHTML and immediately
    // close the dropdown. wireSelect already updates label/active-class directly.
    wireSectionScene(panelEl, main, rebuild, null); // desktop sidebar: no VR panel → numpad uses the DOM overlay

    this._decorateDesktopSection(panelEl, 'scene');
  }

  _buildDesktopRendering(panelEl) {
    if (this._sectionIsFloating(panelEl, 'rendering')) return;
    const main = this._main;
    panelEl.innerHTML = buildSectionHTML_rendering(main);
    const rebuild = () => this._buildDesktopRendering(panelEl);
    wireSectionRendering(panelEl, main, rebuild, () => {});
    fixSliderDrag(panelEl);

    this._decorateDesktopSection(panelEl, 'rendering');
  }

  // Camera and capture. Shares wireSectionRendering with the section it came out of: the ids are
  // disjoint and querySelector answers null for the ones that are not on this page, so there is
  // one wiring pass rather than a second copy to fall behind the first.
  _buildDesktopCamera(panelEl) {
    if (this._sectionIsFloating(panelEl, 'camera')) return;
    const main = this._main;
    panelEl.innerHTML = buildSectionHTML_camera(main);
    const rebuild = () => this._buildDesktopCamera(panelEl);
    wireSectionRendering(panelEl, main, rebuild, () => {});
    fixSliderDrag(panelEl);

    this._decorateDesktopSection(panelEl, 'camera');
  }

  _buildDesktopTopology(panelEl) {
    if (this._sectionIsFloating(panelEl, 'topology')) return;
    const main = this._main;
    panelEl.innerHTML = buildSectionHTML_topology(main);
    const rebuild = () => this._buildDesktopTopology(panelEl);
    wireSectionTopology(panelEl, main, rebuild, () => {});
    fixSliderDrag(panelEl);

    this._decorateDesktopSection(panelEl, 'topology');
  }

  // TOOLS AND PROPERTIES ARE TWO TABS HERE TOO. The first version of this split kept the
  // desktop sidebar as one column, on the grounds that its scrolling is a mouse wheel -- but
  // the split is not only about scrolling. Picking a tool and adjusting it are different tasks
  // at different rates, and separating them is worth having on every platform. matt: "i think
  // the split of tools vs properties is good. it should work well on desktop, please put it
  // there too."
  _buildDesktopSculpting(panelEl) {
    if (this._sectionIsFloating(panelEl, 'sculpting')) return;
    const main = this._main;
    panelEl.innerHTML = buildSectionHTML_sculpting(main);
    const rebuild = () => this._buildDesktopSculpting(panelEl);
    wireSectionSculpting(panelEl, main, rebuild, () => {});
    fixSliderDrag(panelEl);

    this._decorateDesktopSection(panelEl, 'sculpting');
  }

  // Wired with the SAME function as the tools tab: the ids are disjoint between the two pages
  // and querySelector returns null for the absent ones, so one pass is right for either -- and
  // a second wiring function would be the copy that falls behind.
  _buildDesktopProperties(panelEl) {
    if (this._sectionIsFloating(panelEl, 'properties')) return;
    const main = this._main;
    panelEl.innerHTML = buildSectionHTML_properties(main);
    const rebuild = () => this._buildDesktopProperties(panelEl);
    wireSectionSculpting(panelEl, main, rebuild, () => {});
    fixSliderDrag(panelEl);

    this._decorateDesktopSection(panelEl, 'properties');
  }

  // ── Pinning a sidebar section ───────────────────────────────────────────────────────────
  //
  // The sidebar shows ONE section at a time, so anything needed while working in another costs
  // a tab round-trip. Pinning lifts a section out of the strip and leaves it on screen. matt:
  // "i also think pins would work well on desktop too, lets add that feature there as well."
  //
  // A floating panel renders the SAME section HTML through the SAME wiring function as the
  // docked one. It is the section in a different frame, not a second copy of it.

  // True when this section is floating -- in which case its sidebar tab says where it went and
  // how to get it back, rather than going blank.
  _sectionIsFloating(panelEl, sectionId) {
    const panel = this._floatPanels?.get(sectionId);
    if (!panel) return false;
    // AND REBUILD THE FLOATING COPY, because this call was somebody asking for this section to
    // be redrawn -- and the section is over there now.
    //
    // The choke point matters. Refreshing floats from the places that rebuild the sidebar
    // reached the paths I knew about and missed Skeleton.refreshOutliner, which every rig edit
    // goes through and which calls _buildDesktopScene directly: with the outliner pinned, that
    // redrew the placeholder and stopped. matt: "scene/outliner still isn't updating on desktop
    // if pinned." Handled here, every caller works, including ones not written yet.
    panel.rebuild();
    panelEl.innerHTML = '<div class="dfp-away">This section is floating.'
      + '<button class="mm-action-btn" id="dfp-redock-here">Return it to the sidebar</button></div>';
    panelEl.querySelector('#dfp-redock-here')
      ?.addEventListener('click', () => this.redockSection(sectionId));
    return true;
  }

  _decorateDesktopSection(panelEl, sectionId) {
    panelEl.insertAdjacentHTML('afterbegin', sectionHeaderHTML(sectionId));
    panelEl.querySelector('#mm-section-pin-btn')
      ?.addEventListener('click', () => this.floatSection(sectionId));
  }

  // Which builder and wiring each section uses, in ONE place: a float panel that built itself
  // from a different function than its docked twin is exactly the drift this prevents.
  _sectionSpec(sectionId) {
    const main = this._main;
    switch (sectionId) {
      case 'scene': return { build: () => buildSectionHTML_scene(main),
        wire: (el, rb) => wireSectionScene(el, main, rb, null) };
      case 'rendering': return { build: () => buildSectionHTML_rendering(main),
        wire: (el, rb) => wireSectionRendering(el, main, rb, () => {}) };
      case 'topology': return { build: () => buildSectionHTML_topology(main),
        wire: (el, rb) => wireSectionTopology(el, main, rb, () => {}) };
      case 'sculpting': return { build: () => buildSectionHTML_sculpting(main),
        wire: (el, rb) => wireSectionSculpting(el, main, rb, () => {}) };
      case 'properties': return { build: () => buildSectionHTML_properties(main),
        wire: (el, rb) => wireSectionSculpting(el, main, rb, () => {}) };
      default: return null;
    }
  }

  floatSection(sectionId, at) {
    if (!this._floatPanels) this._floatPanels = new Map();
    if (this._floatPanels.has(sectionId)) { this._floatPanels.get(sectionId).raise(); return; }
    const spec = this._sectionSpec(sectionId);
    if (!spec) return;
    injectFloatCSS();
    // Staggered, so pinning three in a row does not stack them exactly on top of each other.
    const n = this._floatPanels.size;
    const panel = new DesktopFloatPanel({
      sectionId,
      build: spec.build,
      wire: (el, rb) => { spec.wire(el, rb); fixSliderDrag(el); },
      onRedock: (id) => this.redockSection(id),
      onMoved: () => this._savePinnedSections(),
    }).mount(at?.x ?? (90 + n * 24), at?.y ?? (90 + n * 24));
    this._floatPanels.set(sectionId, panel);
    this._refreshDesktopSection(sectionId);
    this._updatePinnedTabStates();
    this._savePinnedSections();
  }

  redockSection(sectionId) {
    const panel = this._floatPanels?.get(sectionId);
    if (!panel) return;
    panel.dispose();
    this._floatPanels.delete(sectionId);
    this._refreshDesktopSection(sectionId);
    this._updatePinnedTabStates();
    this._savePinnedSections();
  }

  // WHAT IS PINNED, AND WHERE, ACROSS SESSIONS.
  //
  // Pinning is a workspace arrangement, not a momentary action -- you set it up once for how
  // you work and expect it to be there next time, the same way the sidebar's own settings are.
  // matt: "pin states for panels on desktop should be persistent, remember state and position."
  //
  // Saved through the same option store as every other preference rather than a private
  // localStorage key, so it is cleared, exported and reasoned about with the rest of them.
  _savePinnedSections() {
    const map = {};
    if (this._floatPanels) {
      for (const [id, panel] of this._floatPanels) map[id] = panel.position;
    }
    // Debounced: a drag ends with one save, but redocking three panels in a row should not
    // write three times in as many milliseconds.
    getOptionsURL.saveOption('desktopPins', map, 250);
  }

  // Restored AFTER the docked sections are built, because floating one rewrites its sidebar
  // tab into the "this section is floating" placeholder -- and a tab that has not been built
  // yet has nothing to rewrite.
  _restorePinnedSections() {
    const saved = getOptionsURL().desktopPins;
    if (!saved) return;
    for (const id of Object.keys(saved)) {
      const at = saved[id];
      if (!this._sectionSpec(id)) continue;   // a section that no longer exists
      // Clamped into the CURRENT window: a panel saved on a wider screen, or on a second
      // monitor that is not there today, would otherwise restore off the edge with its dock
      // button beyond reach.
      const x = Math.min(Math.max(0, at?.x ?? 90), Math.max(0, window.innerWidth - 60));
      const y = Math.min(Math.max(0, at?.y ?? 90), Math.max(0, window.innerHeight - 40));
      this.floatSection(id, { x, y });
    }
    // No tab marking here: createTab reads the same saved state and the tabs are born dimmed.
    // Marking after the restore was tried and does not work -- the strip is not in the document
    // yet, and still is not a frame later.
  }

  _refreshDesktopSection(sectionId) {
    const el = {
      scene: this._desktopSceneEl, rendering: this._desktopRenderingEl,
      camera: this._desktopCameraEl,
      topology: this._desktopTopologyEl, sculpting: this._desktopSculptingEl,
      properties: this._desktopPropertiesEl,
    }[sectionId];
    if (!el) return;
    ({
      scene: () => this._buildDesktopScene(el),
      rendering: () => this._buildDesktopRendering(el),
      camera: () => this._buildDesktopCamera(el),
      topology: () => this._buildDesktopTopology(el),
      sculpting: () => this._buildDesktopSculpting(el),
      properties: () => this._buildDesktopProperties(el),
    })[sectionId]?.();
  }

  // A PINNED SECTION'S TAB IS DIMMED.
  //
  // Its tab is still there and still switchable, but its contents are somewhere else -- so
  // without a mark the strip says "Properties is pinned" while the tab looks exactly as it did
  // when it held the controls. Dimmed, it reads as "this lives elsewhere now", which is what
  // the VR panel already does to a torn-off tab (.mm-tab-btn.torn). matt: "in the sidebar their
  // icon should be dimmed if they've been pinned."
  //
  // Dimmed, NOT disabled: the tab still opens, and what it shows is the placeholder with the
  // button that brings the section back. Taking the click away would leave the placeholder
  // unreachable.
  _updatePinnedTabStates() {
    document.querySelectorAll('wa-tab[panel]').forEach((tab) => {
      const on = !!this._floatPanels?.has(tab.getAttribute('panel'));
      tab.classList.toggle('tab-pinned', on);
    });
  }

  // WHAT IS PINNED, TOP LEFT.
  //
  // A floating panel can end up behind another one, off in a corner, or simply forgotten -- and
  // its section's sidebar tab now shows a placeholder rather than the controls, so there is
  // nothing on screen saying where it went. The strip is that answer: one icon per pinned
  // section, always in the same place. matt: "would also be good on both desktop and vr for
  // when items get pinned, to put their icon in the top left."
  //
  // Clicking raises rather than redocks: the panels have their own dock button, and a strip
  // that dismissed things on a single click would make finding one indistinguishable from
  // putting it away.

  // Every floating panel, rebuilt from current state. Called wherever the docked sections are
  // rebuilt: a pinned panel that stops tracking the tool you just changed is worse than no
  // pinned panel.
  // CALLED WHEREVER A DOCKED SECTION REBUILDS. A floating panel is not in the tab strip, so
  // none of the things that refresh the sidebar reach it -- and the first version of this
  // shipped with the method defined and never called anywhere, which is exactly what it looks
  // like: matt, "if i tear off the scene/outliner it doesn't stay synced. i have to unpin then
  // repin for it to update."
  //
  // The rule that was supposed to catch that asked whether the method EXISTED. It does. A rule
  // has to ask about the call site.
  refreshFloatingSections() {
    if (!this._floatPanels) return;
    for (const p of this._floatPanels.values()) p.rebuild();
  }
}

class WebAwesomeFolderMock {
  constructor(name, panelDom, sidebar) {
    this.name = name;
    this.panelDom = panelDom;
    this.sidebar = sidebar;

    this.container = document.createElement('div');
    this.container.className = 'wa-stack';
    this.container.style.gap = '12px';
    this.container.style.padding = '4px 0';
    this.container.style.width = '100%';
    this.container.style.boxSizing = 'border-box';

    const _isTextInput = (e) => {
      const target = e.composedPath ? e.composedPath()[0] : e.target;
      const tag  = target?.tagName?.toLowerCase();
      const type = target?.type?.toLowerCase();
      if (tag === 'textarea') return true;
      if (tag === 'input' && type !== 'range' && type !== 'checkbox' && type !== 'radio' && type !== 'button' && type !== 'submit') return true;
      return false;
    };
    this.container.addEventListener('keydown', (e) => { if (_isTextInput(e)) e.stopPropagation(); });
    this.container.addEventListener('keyup',   (e) => { if (_isTextInput(e)) e.stopPropagation(); });

    this.panelDom.appendChild(this.container);
  }

  close() {}
  open() {}

  setVisibility(visible) { this.container.style.display = visible ? '' : 'none'; }

  addTitle(name) {
    const title = document.createElement('div');
    title.className = 'group-title';
    title.innerText = name;
    title.style.fontSize = '12px';
    title.style.fontWeight = '600';
    title.style.color = '#888';
    title.style.textTransform = 'uppercase';
    title.style.borderBottom = '1px solid #2d2d2d';
    title.style.paddingBottom = '4px';
    title.style.marginTop = '8px';
    this.container.appendChild(title);
    return { domTitle: title, setVisibility: (v) => { title.style.display = v ? '' : 'none'; } };
  }

  addSlider(name, valueOrObject, callbackOrProperty, min, max, step) {
    let initialVal = 0;
    let onChange = null;

    if (typeof callbackOrProperty === 'string' && typeof valueOrObject === 'object') {
      const obj = valueOrObject, prop = callbackOrProperty;
      initialVal = parseFloat(obj[prop]);
      onChange = (val) => { obj[prop] = val; };
    } else {
      initialVal = parseFloat(valueOrObject);
      onChange = (val) => { if (typeof callbackOrProperty === 'function') callbackOrProperty(val); };
    }

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;flex-direction:column;gap:4px';

    const labelRow = document.createElement('div');
    labelRow.style.cssText = 'display:flex;justify-content:space-between;font-size:12px;color:#bbb';
    const labelSpan = document.createElement('span');
    labelSpan.innerText = name;
    const valSpan = document.createElement('span');
    valSpan.style.cssText = 'font-weight:bold;color:#3b82f6';
    valSpan.innerText = initialVal.toString();
    labelRow.appendChild(labelSpan);
    labelRow.appendChild(valSpan);
    row.appendChild(labelRow);

    const slider = document.createElement('wa-slider');
    slider.setAttribute('min', min.toString());
    slider.setAttribute('max', max.toString());
    slider.setAttribute('step', step.toString());
    slider.setAttribute('value', initialVal.toString());
    slider.style.width = '100%';
    slider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      valSpan.innerText = val.toString();
      onChange(val);
    });
    row.appendChild(slider);
    this.container.appendChild(row);

    return {
      domSlider: slider,
      setValue: (val, silent) => { slider.value = val; valSpan.innerText = val.toString(); if (!silent) onChange(parseFloat(val)); },
      getValue: () => parseFloat(slider.value),
      setMin: (v) => slider.setAttribute('min', v.toString()),
      setMax: (v) => slider.setAttribute('max', v.toString()),
      setVisibility: (v) => { row.style.display = v ? '' : 'none'; },
      setEnable: (en) => { if (en) slider.removeAttribute('disabled'); else slider.setAttribute('disabled', ''); }
    };
  }

  addCheckbox(name, valueOrObject, callbackOrProperty) {
    let isChecked = false;
    let onChange = null;

    if (typeof callbackOrProperty === 'string' && typeof valueOrObject === 'object') {
      const obj = valueOrObject, prop = callbackOrProperty;
      isChecked = !!obj[prop];
      onChange = (checked) => { obj[prop] = checked; };
    } else {
      isChecked = !!valueOrObject;
      onChange = (checked) => { if (typeof callbackOrProperty === 'function') callbackOrProperty(checked); };
    }

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;font-size:12px';
    const checkbox = document.createElement('wa-checkbox');
    checkbox.innerText = name;
    checkbox.checked = isChecked;
    checkbox.style.flex = '1';
    checkbox.addEventListener('change', (e) => { onChange(e.target.checked); });
    row.appendChild(checkbox);
    this.container.appendChild(row);

    return {
      domCheckbox: checkbox,
      setValue: (val, silent) => { checkbox.checked = !!val; if (!silent) onChange(!!val); },
      getValue: () => checkbox.checked,
      setVisibility: (v) => { row.style.display = v ? '' : 'none'; },
      setEnable: (en) => { if (en) checkbox.removeAttribute('disabled'); else checkbox.setAttribute('disabled', ''); }
    };
  }

  addCombobox(name, valueOrObject, callbackOrProperty, options) {
    let initialVal = '';
    let onChange = null;

    if (typeof callbackOrProperty === 'string' && typeof valueOrObject === 'object') {
      const obj = valueOrObject, prop = callbackOrProperty;
      initialVal = obj[prop];
      onChange = (val) => { obj[prop] = val; };
    } else {
      initialVal = valueOrObject;
      onChange = (val) => {
        if (typeof callbackOrProperty === 'function') {
          const num = parseFloat(val);
          callbackOrProperty(isNaN(num) ? val : num);
        }
      };
      options = options || callbackOrProperty;
    }

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;flex-direction:column;gap:4px;font-size:12px';
    if (name) {
      const label = document.createElement('div');
      label.innerText = name;
      label.style.color = '#bbb';
      row.appendChild(label);
    }

    const select = document.createElement('wa-select');
    select.className = 'compact-select';
    select.setAttribute('value', initialVal.toString());
    select.style.width = '100%';

    const populateOptions = (opts) => {
      select.innerHTML = '';
      if (Array.isArray(opts)) {
        opts.forEach((optText, idx) => {
          if (optText === undefined) return;
          const opt = document.createElement('wa-option');
          opt.setAttribute('value', idx.toString());
          opt.innerText = optText;
          select.appendChild(opt);
        });
      } else if (typeof opts === 'object') {
        Object.entries(opts).forEach(([val, text]) => {
          const opt = document.createElement('wa-option');
          opt.setAttribute('value', val);
          opt.innerText = text;
          select.appendChild(opt);
        });
      }
    };

    populateOptions(options);
    select.addEventListener('change', (e) => { onChange(e.target.value); });
    row.appendChild(select);
    this.container.appendChild(row);

    return {
      domSelect: select,
      setValue: (val, silent) => { select.value = val.toString(); if (!silent) onChange(val.toString()); },
      getValue: () => select.value,
      setVisibility: (v) => { row.style.display = v ? '' : 'none'; },
      setEnable: (en) => { if (en) select.removeAttribute('disabled'); else select.setAttribute('disabled', ''); },
      setOptions: (newOpts) => { populateOptions(newOpts); },
      addOptions: (newOpts) => { populateOptions(newOpts); }
    };
  }

  addToolGrid(name, valueOrObject, callbackOrProperty, options) {
    let initialVal = 0;
    let onChange = null;

    if (typeof callbackOrProperty === 'string' && typeof valueOrObject === 'object') {
      const obj = valueOrObject, prop = callbackOrProperty;
      initialVal = obj[prop];
      onChange = (val) => { obj[prop] = val; };
    } else {
      initialVal = valueOrObject;
      onChange = (val) => {
        if (typeof callbackOrProperty === 'function') {
          const num = parseFloat(val);
          callbackOrProperty(isNaN(num) ? val : num);
        }
      };
      options = options || callbackOrProperty;
    }

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;flex-direction:column;gap:4px;width:100%';
    if (name) {
      const label = document.createElement('div');
      label.innerText = name;
      label.style.cssText = 'color:#bbb;font-size:12px';
      row.appendChild(label);
    }

    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:4px;width:100%';

    const getToolColor = (idStr) => {
      const id = parseInt(idStr, 10);
      switch (id) {
        case 0: case 1: case 4: case 5: case 6: case 14: return '#ebc5c5';
        case 3: case 8:                                   return '#c5d3eb';
        case 7: case 10: case 12: case 13: case 15: case 16: case 17: return '#c5ebc5';
        case 9:  return '#dec5eb';
        case 11: return '#ebdcc5';
        case 18: case 19: case 20: case 21: case 22: case 23:
        case 24: case 25: case 26: case 27: case 28: case 29:
        case 30: case 31: return '#dcd6a8';
        default: return '#eeeeee';
      }
    };

    const buttonsMap = {};
    const updateButtonStyles = (valStr, btn, isActive) => {
      const color = getToolColor(valStr);
      if (isActive) {
        btn.style.setProperty('--btn-bg', color);
        btn.style.setProperty('--btn-border', color);
        btn.style.setProperty('--btn-color', '#111');
        btn.style.setProperty('--btn-shadow', `0 0 8px ${color}55`);
      } else {
        btn.style.setProperty('--btn-bg', '#1a1a1a');
        btn.style.setProperty('--btn-border', '#2d2d2d');
        btn.style.setProperty('--btn-color', color);
        btn.style.setProperty('--btn-shadow', 'none');
      }
    };

    Object.entries(options).forEach(([val, text]) => {
      if (val === '-1') return;
      const btn = document.createElement('wa-button');
      btn.innerText = text;
      btn.setAttribute('size', 'small');
      btn.className = 'grid-tool-btn';
      btn.style.width = '100%';
      btn.addEventListener('click', () => {
        const valStr = val.toString();
        Object.entries(buttonsMap).forEach(([k, b]) => updateButtonStyles(k, b, k === valStr));
        onChange(valStr);
      });
      buttonsMap[val] = btn;
      grid.appendChild(btn);
    });

    const initialStr = initialVal.toString();
    Object.entries(buttonsMap).forEach(([k, b]) => updateButtonStyles(k, b, k === initialStr));
    row.appendChild(grid);
    this.container.appendChild(row);

    return {
      domGrid: grid,
      setValue: (val, silent) => {
        const valStr = (val !== null && val !== undefined) ? val.toString() : '-1';
        Object.entries(buttonsMap).forEach(([k, b]) => updateButtonStyles(k, b, k === valStr));
        if (!silent) onChange(valStr);
      },
      getValue: () => {
        const activeKey = Object.entries(buttonsMap).find(([k, b]) => b.style.getPropertyValue('--btn-color') === '#111');
        return activeKey ? activeKey[0] : '-1';
      },
      setVisibility: (v) => { row.style.display = v ? '' : 'none'; },
      setEnable: (en) => {
        Object.values(buttonsMap).forEach(b => {
          if (en) b.removeAttribute('disabled'); else b.setAttribute('disabled', '');
        });
      }
    };
  }

  addButton(name, callbackOrScope, method) {
    const btn = document.createElement('wa-button');
    btn.innerText = name;
    btn.setAttribute('variant', 'primary');
    btn.className = 'compact-btn';
    btn.style.width = '100%';
    btn.addEventListener('click', () => {
      if (typeof callbackOrScope === 'function') {
        callbackOrScope();
      } else if (typeof callbackOrScope === 'object' && typeof method === 'string' && typeof callbackOrScope[method] === 'function') {
        callbackOrScope[method]();
      }
    });
    this.container.appendChild(btn);
    return {
      domButton: btn,
      setVisibility: (v) => { btn.style.display = v ? '' : 'none'; },
      setEnable: (en) => { if (en) btn.removeAttribute('disabled'); else btn.setAttribute('disabled', ''); }
    };
  }

  addDualButton(name1, name2, callback1, callback2, method1, method2) {
    const row = document.createElement('div');
    row.className = 'btn-grid';
    row.style.cssText = 'display:flex;gap:4px;width:100%';

    const trigger = (cb, method) => {
      if (typeof cb === 'function') cb();
      else if (typeof cb === 'object' && typeof method === 'string' && typeof cb[method] === 'function') cb[method]();
    };

    const makeBtn = (name, cb, method) => {
      const btn = document.createElement('wa-button');
      btn.innerText = name;
      btn.setAttribute('variant', 'primary');
      btn.className = 'compact-btn';
      btn.style.flex = '1';
      btn.addEventListener('click', () => trigger(cb, method));
      row.appendChild(btn);
      return {
        domButton: btn,
        setVisibility: (v) => { btn.style.display = v ? '' : 'none'; },
        setEnable: (en) => { if (en) btn.removeAttribute('disabled'); else btn.setAttribute('disabled', ''); }
      };
    };

    const r1 = makeBtn(name1, callback1, method1);
    const r2 = makeBtn(name2, callback2, method2);
    this.container.appendChild(row);
    return [r1, r2];
  }

  addColor(name, color, callback) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;font-size:12px';
    const label = document.createElement('span');
    label.innerText = name;
    label.style.color = '#bbb';
    row.appendChild(label);

    const colorWrapper = document.createElement('div');
    colorWrapper.style.cssText = 'position:relative;width:48px;height:24px;border-radius:4px;border:1px solid #444;overflow:hidden;cursor:pointer';

    const colorInput = document.createElement('input');
    colorInput.setAttribute('type', 'color');

    const rgbToHex = (rgb) => {
      const toHex = (c) => { const h = Math.round(c * 255).toString(16); return h.length === 1 ? '0' + h : h; };
      return `#${toHex(rgb[0])}${toHex(rgb[1])}${toHex(rgb[2])}`;
    };
    const hexToRgb = (hex) => [
      parseInt(hex.slice(1, 3), 16) / 255,
      parseInt(hex.slice(3, 5), 16) / 255,
      parseInt(hex.slice(5, 7), 16) / 255
    ];

    let hexVal = (Array.isArray(color) || ArrayBuffer.isView(color)) ? rgbToHex(color) : color;
    colorInput.value = hexVal;
    colorInput.style.cssText = 'position:absolute;top:-5px;left:-5px;width:60px;height:34px;border:none;padding:0;margin:0;cursor:pointer;background:transparent';

    colorWrapper.appendChild(colorInput);
    row.appendChild(colorWrapper);
    this.container.appendChild(row);

    const updateHandler = (val, silent) => {
      const hex = (Array.isArray(val) || ArrayBuffer.isView(val)) ? rgbToHex(val) : val;
      colorInput.value = hex;
      if (!silent && typeof callback === 'function') {
        callback(Array.isArray(color) ? hexToRgb(hex) : hex);
      }
    };

    colorInput.addEventListener('input', (e) => updateHandler(e.target.value, false));

    return {
      domColor: colorInput,
      setValue: (val, silent) => updateHandler(val, silent),
      getValue: () => { const hex = colorInput.value; return Array.isArray(color) ? hexToRgb(hex) : hex; },
      setVisibility: (v) => { row.style.display = v ? '' : 'none'; },
      setEnable: (en) => { if (en) colorInput.removeAttribute('disabled'); else colorInput.setAttribute('disabled', ''); }
    };
  }
}

export default Gui;
