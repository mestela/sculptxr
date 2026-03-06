import Enums from '../misc/Enums.js';

import TR from './GuiTR.js';
import Tools from '../editing/tools/Tools.js';
import Export from '../files/Export.js';
import { saveAs } from 'file-saver';
import Shader from '../render/ShaderLib.js';
import Utils from '../misc/Utils.js';
import { vec3 } from 'gl-matrix';
import { VERSION } from '../Version.js';

// Modular Imports - Relative with explicit extensions to bypass map issues
import getToolsWidgets from './vr/GuiVRTools.js';
import getSceneWidgets from './vr/GuiVRScene.js';
import getRenderingWidgets from './vr/GuiVRRendering.js';
import getFilesWidgets from './vr/GuiVRFiles.js';
import getHistoryWidgets from './vr/GuiVRHistory.js';
import getReferenceWidgets from './vr/GuiVRReference.js'; // Replaces Background
import getCameraWidgets from './vr/GuiVRCamera.js';
import getTabletWidgets from './vr/GuiVRTablet.js';
import getSettingsWidgets from './vr/GuiVRSettings.js';
import getLanguageWidgets from './vr/GuiVRLanguage.js';
import getExtraUIWidgets from './vr/GuiVRExtraUI.js';
import getAboutWidgets from './vr/GuiVRAbout.js';
import getTopologyWidgets from './vr/GuiVRTopology.js';
import Tablet from '../misc/Tablet.js';

// Direct access for property setters
import MeshDynamic from '../mesh/dynamic/MeshDynamic.js';
import Remesh from '../editing/Remesh.js';
import ShaderBase from '../render/shaders/ShaderBase.js';
import StateManager from '../states/StateManager.js';

const TAB_HEIGHT = 68; // Increased from 52 (+30%)
const TAB_ROWS = 3; // Rows of tabs
const HEADER_HEIGHT = TAB_HEIGHT * TAB_ROWS; // Reserved for Tabs
const CANVAS_SIZE = 1024;
// Desktop Order: Topbar (Files, Scene, History/States, Settings/Config) -> Sidebar (Rendering, Topology, Tools/Sculpting)
// Top Row: Files, Scene, History, Settings
// Bottom/Sidebar: View (Rendering), Topology, Tools (Sculpting)
// Actually, user wants "Half horizontal space" mockup.
// Let's assume the user wants the VR panel to LOOK like the desktop sidebar.
// The mockup shows Tabs at the top, and then collapsible sections below.
// We will group widgets into "Sections" instead of just "Tabs".

// Group 1: Global Tabs (Top)
// Group 1: Global Tabs (Top)
const GLOBAL_TABS = ['Files', 'Scene', 'History', 'Reference', 'Settings', 'About & Help'];
// Group 2: Layout Sections (Sidebar style) - these are displayed effectively as one long scrollable page?
// Or does clicking one hide others?
// User said: "panel has collapsible sections like the desktop"
// This implies they are all stacked vertically.

const SECTIONS = ['Rendering', 'Topology', 'Sculpting & Painting'];

// Map old Tabs to new Layout Logic
// Files, Scene, History, Settings -> Top Bar (Tabs)
// View -> Rendering Section
// Topology -> Topology Section
// Tools -> Sculpting & Painting Section

const COLOR_HEADER = '#111';
const COLOR_SECTION_BG = '#282828';
const COLOR_WIDGET_BG = '#444';

const OVERLAY_BG = 'rgba(0, 0, 0, 0.8)';
const OVERLAY_W = 720;
const OVERLAY_H = 720;
const OVERLAY_X = (CANVAS_SIZE - OVERLAY_W) / 2;
const OVERLAY_Y = (CANVAS_SIZE - OVERLAY_H) / 2;

const OVERLAY_SCALE = 1.13; // 13% Larger Menus (User Request)

export default class GuiXR {

  constructor(main, canvas, customWidth = null, customHeight = null) {

    this._main = main;
    this._gl = main._gl;

    if (canvas) {
      this._canvas = canvas;
      this._ctx = canvas.getContext('2d');
    } else {
      this._canvas = document.createElement('canvas');
      this._canvas.width = customWidth || CANVAS_SIZE;
      this._canvas.height = customHeight || CANVAS_SIZE;
      this._ctx = this._canvas.getContext('2d');
    }

    this._uiSettings = {
      resolution: 256, // Voxel Resolution
      radius: 1.0 // Voxel Radius
    };

    // Preload Dropper Icon
    this._dropperIcon = new Image();
    this._dropperIcon.src = 'resources/dropper.png';

    this._isVisible = false; // By default it is hidden until summoned

    this._needsRedraw = true; // Request Canvas Redraw
    this._needsUpload = true; // Request GPU Upload (formerly _needsUpdate)
    this._textureAllocated = false;
    this._activeTab = 'Sculpting & Painting'; // Default section open?
    // Actually if they are collapsible, we need a map of open/closed states.
    this._sectionStates = {
      'Rendering': false,
      'Topology': false,
      'Sculpting & Painting': true
    };

    this._scrollOffset = 0; // Vertical scroll
    this._maxScroll = 0;

    this._cursor = { x: -1, y: -1, active: false };
    this._radius = 0.20;

    // Overlay State
    this._overlay = null;
    this._overlayData = null;
    this._overlayOpenTime = 0; // Cooldown for accidental clicks

    this._inputDebounce = 0; // Debounce all interactions
    this._activeCombobox = null; // In-context dropdown state


    this._widgetGenerators = {
      'Files': getFilesWidgets,
      'Scene': getSceneWidgets,
      'History': getHistoryWidgets,
      'Rendering': getRenderingWidgets,
      'Topology': getTopologyWidgets,
      'Sculpting & Painting': (main, isMiniHUD) => getToolsWidgets(main, main.getSculptManager().getToolIndex(), isMiniHUD),
      'Reference': getReferenceWidgets,
      'Settings': getCameraWidgets, // Wait, Camera Widgets ARE the settings? User said "hid the settings menu".
      // Actually, GuiVRCamera.js exports getCameraWidgets but the tab was likely named 'Camera'.
      // If I rename 'Camera' to 'Settings' in the UI, I should use getCameraWidgets?
      // Or create a new getSettingsWidgets wrapping Camera + Input?
      // GuiVRSettings.js exists but was unused?
      // Let's use GuiVRSettings.js if it exists and works, or merge Camera into it.
      // GuiVRSettings.js exported getSettingsWidgets.
      // Let's use THAT for 'Settings'.
      'Settings': (main) => {
        // We might want to combine Camera + Input here?
        // GuiVRSettings.js (content read earlier) had "Camera" header.
        // Let's use GuiVRSettings.js.
        // I need to import it first?
        // It was NOT imported in GuiXR.js. I need to add import.
        return getSettingsWidgets(main);
      },
      'Camera': getCameraWidgets,
      'Tablet pressure': getTabletWidgets,
      'Language': getLanguageWidgets,
      'Extra UI': getExtraUIWidgets,
      'About & Help': getAboutWidgets
    };

    this._tabWidgets = {}; // Cache (updated on draw)

    // We need to know which "Mode" we are in.
    // If we click "FILES", does it replace the sidebar?
    // User says "Menus are at the top".
    // "Panel has collapsible sections".
    // This implies the MAIN VIEW is the Sidebar stack (Rendering + Topo + Sculpting).
    // And global tabs might just show overlays or switch context?
    // Let's assume "Sidebar Mode" is the default view.
    this._viewMode = 'SIDEBAR'; // vs 'FILES', 'SCENE', 'HISTORY', 'SETTINGS' ?
    this._isDraggingScrollbar = false; // New state for scrollbar drag
    this._activeSlider = null; // Lock for slider drag
    // Actually, Scene/History might be better as Panels too?
    // For now, let's keep the user's mockup logic:
    // Top Rows: Files, Scene, History, Background, Camera...
    // Below: The Sidebar Stack.

    // setTimeout(() => this.syncToolRadius(), 500);

    // Register Paint Tool Callback globally
    const sm = this._main.getSculptManager();
    const paintTool = sm.getTool(Enums.Tools.PAINT);
    if (paintTool && paintTool.addPickCallback) {
      paintTool.addPickCallback((color, roughness, metallic) => {
        vec3.copy(paintTool._color, color);
        paintTool._material[0] = roughness;
        paintTool._material[1] = metallic;

        this._needsRedraw = true;
        this.draw();
      });
    }

    if (paintTool && paintTool.addColorSwappedCallback) {
      paintTool.addColorSwappedCallback(() => {
        this._needsRedraw = true;
        this.draw();
      });
    }

    // Desktop Preview Toggle (Dev Tool)
    window.addEventListener('keydown', (e) => {
      if (e.shiftKey && e.altKey && e.code === 'KeyV') {
        this.togglePreview();
      }
    });

    this._pendingDraw = false;

    // Style Exposure (Runtime Customization)
    this.styles = {
      // Main Panel
      fontMain: '24px sans-serif',
      fontMainBold: 'bold 24px sans-serif',
      colorBg: '#202020',
      colorWidgetBg: '#333',
      colorWidgetHover: '#444',
      colorText: '#fff',
      colorTextDim: '#ccc',
      colorAccent: '#00D0FF',

      // Overlay
      overlayBg: 'rgba(0, 0, 0, 0.8)',
      overlayMenuBg: '#222',
      overlayMenuBorder: '#444',
      fontOverlay: '20px sans-serif',
      fontOverlayHeader: 'bold 16px sans-serif',
      overlayItemHeight: 40 // Not directly used yet, but good for reference
    };

    // --- POPUP VR LOG SYSTEM ---
    this._logLines = []; // { text: "msg", color: "lime", time: 0 }

    // Expose for Console
    window.guiXR = this;
  }

  _requestDraw() {
    this._needsRedraw = true;
  }



  _getOverlayPivot() {
    // Pivot around Menu Origin if it's a menu
    if (this._overlay === 'menu' && this._overlayData) {
      return { x: this._overlayData.x, y: this._overlayData.y };
    }
    // Default to Center for other overlays
    return { x: CANVAS_SIZE / 2, y: CANVAS_SIZE / 2 };
  }

  closeOverlay() {
    this._overlay = null;
    this._overlayData = null;
    this._needsRedraw = true;
  }

  // Console Helper for Tab Switching
  switchTab(tabName) {
    const tabIdx = GLOBAL_TABS.indexOf(tabName);

    // Toggle-to-Close Logic
    // If the active overlay corresponds to this tab, close it and return.
    if (this._overlay === 'menu' && this._overlayData && this._overlayData.tabName === tabName) {
      this.closeOverlay();
      this._activeCombobox = null;
      return;
    }

    // Auto-close existing overlay/combobox to prevent stack buildup
    this.closeOverlay();
    this._activeCombobox = null;
    if (tabIdx !== -1) {
      const w = this._canvas.width;

      // Row Logic Match draw()
      const rowCount = 3;
      // 3 items per row
      // Row 1: 0,1,2
      // Row 2: 3,4,5
      // Row 3: 6,7,8
      const countInRow = 3;
      const idxInRow = tabIdx % 3;

      const rowW = w / countInRow;
      const x = idxInRow * rowW;

      let data = null;
      // Use generator map if available
      const gen = this._widgetGenerators[tabName];
      if (gen) {
        data = gen(this._main);
      }

      if (data) {
        let overlayX = x;
        // Clamp overlayX (taking Scale into account)
        const scaledWidth = data.width * OVERLAY_SCALE;
        if (overlayX + scaledWidth > this._canvas.width) {
          overlayX = this._canvas.width - scaledWidth;
        }
        if (overlayX < 0) overlayX = 0;

        // Determine Y based on which row this tab belongs to
        // Row 1: 0..2 (3 tabs)
        // Row 2: 3..5 (3 tabs)
        // Row 3: 6..8 (3 tabs)
        let rowIndex = 0;
        if (tabIdx >= 6) rowIndex = 2;
        else if (tabIdx >= 3) rowIndex = 1;

        const overlayY = (rowIndex + 1) * TAB_HEIGHT;

        this.openOverlay('menu', {
          x: overlayX,
          y: overlayY,
          w: data.width,
          h: data.height,
          widgets: data.widgets,
          tabName: tabName
        });
        this.draw();
        return;
      }
    }

    // Sidebar fallback (Tools, Rendering, etc. - though Tools is removed from GLOBAL_TABS now?)
    // User list didn't include "Tools". But "Tools" is usually the main sculpting thing.
    // If "Tools" is not in GLOBAL_TABS, we might need another way to access it?
    // Maybe user meant "Tools" as "Sculpting"?
    // The user's list: "Files, Scene, History, Background, Camera, Tablet pressure, Language, Extra UI, About & Help"
    // Where is "Sculpting" or "Tools"? Maybe they assume it's always visible or in Sidebar?
    // Since I'm making top bar, I'll assume standard layout below is Tools/Sidebar.
    // But if I can't click "Tools" tab...
    // I'll leave 'Tools' out of GLOBAL_TABS as per request, but maybe add it as a separate persistent thing?
    // Or maybe the Sidebar is always visible?
    // For now, I follow the user's specific list for the Top Menu.

    this._activeCombobox = null;
    this._needsRedraw = true;
    this.draw();
  }

  nextTab() {
    // Cycle through Global Tabs + Sidebar?
    // Debug helper mainly.
  }

  togglePreview() {
    if (this._previewContainer) {
      document.body.removeChild(this._previewContainer);
      this._previewContainer = null;
      console.log("[GuiXR] Desktop Preview Hidden");
      return;
    }

    const div = document.createElement('div');
    div.style.position = 'absolute';
    div.style.top = '50%';
    div.style.left = '50%';
    div.style.transform = 'translate(-50%, -50%)';
    div.style.zIndex = '9999';
    div.style.border = '4px solid #00D0FF';
    div.style.background = '#222';
    div.style.boxShadow = '0 0 20px rgba(0,0,0,0.8)';
    // Scale to fit height
    const scale = (window.innerHeight * 0.8) / CANVAS_SIZE;
    div.style.width = `${CANVAS_SIZE * scale}px`;
    div.style.height = `${CANVAS_SIZE * scale}px`;

    this._canvas.style.width = '100%';
    this._canvas.style.height = '100%';

    div.appendChild(this._canvas);
    document.body.appendChild(div);
    this._previewContainer = div;


    // Start Desktop Render Loop
    const loop = () => {
      if (!this._previewContainer) return;
      if (this._needsRedraw) {
        this.draw();
      }
      requestAnimationFrame(loop);
    };
    loop();

    // Attach Events
    const mapEventToPixels = (e) => {
      const rect = this._canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;

      if (Math.random() < 0.05 || e.type === 'pointerdown') {

      }

      return {
        x: x,
        y: y
      };
    };

    const onPointerDown = (e) => {
      if (e.button !== 0) return; // Only left click
      e.preventDefault();
      const { x, y } = mapEventToPixels(e);
      this.setCursor(x, y);
      this.onInteract(x, y, true);
    };
    const onPointerMove = (e) => {
      e.preventDefault();
      const { x, y } = mapEventToPixels(e);
      this.setCursor(x, y);
    };
    const onPointerUp = (e) => {
      e.preventDefault();
      this.setCursor(-1, -1); // Deactivate cursor
    };

    this._canvas.addEventListener('pointerdown', onPointerDown);
    this._canvas.addEventListener('pointermove', onPointerMove);
    this._canvas.addEventListener('pointerup', onPointerUp);

    // Desktop Mouse Wheel Logic
    const onWheel = (e) => {
      e.preventDefault();
      // Scroll Logic
      this._scrollOffset += e.deltaY; // vertical scroll
      this._scrollOffset = Math.max(0, Math.min(this._scrollOffset, this._maxScroll));
      this._needsRedraw = true;
      this.draw();
    };
    this._canvas.addEventListener('wheel', onWheel);

    this._previewCleanup = () => {
      this._canvas.removeEventListener('pointerdown', onPointerDown);
      this._canvas.removeEventListener('pointermove', onPointerMove);
      this._canvas.removeEventListener('pointerup', onPointerUp);
      this._canvas.removeEventListener('wheel', onWheel);
    };

    this._needsRedraw = true;
    this.draw();
  }

  // Reload widgets (e.g. when tool changes)
  refreshSymmetry() {
    this._needsRedraw = true;
    this.draw();
  }

  refreshToolsWidget() {
    this._tabWidgets = {}; // Clear cache to force regeneration
    this._needsRedraw = true;
    this.draw();
  }

  init(gl) {
    if (this._texture) return;
    this._texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this._texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.draw();
  }

  setCursor(u, v) {
    if (u < 0) {
      this._cursor.active = false;
      this._hoverWidget = null;
    } else {
      this._cursor.active = true;
      this._cursor.x = u * this._canvas.width;
      this._cursor.y = v * this._canvas.height;
      this._updateHover();
    }
    // Optimization: Don't set _needsRedraw = true unconditionally here.
    // _updateHover will handle it if widget changes.
  }

  _updateHover() {
    if (!this._cursor.active) {
      this._hoverWidget = null;
      this._hoverTab = null;
      return;
    }

    const cx = this._cursor.x;
    const cy = this._cursor.y;

    // Force continuous redraws to evaluate dynamic options hover since options are not distinct widgets
    if (this._activeCombobox || this._overlay === 'combobox') {
      this._hoverWidget = null;
      this._hoverTab = null;
      this._needsRedraw = true;
      this._requestDraw();
      return;
    }

    // 0. Priority Blocking: Overlay OR Active Combobox
    if (this._overlay) {
      // If Overlay is 'menu', we might want to highlight buttons inside it?
      // YES, handled by _updateOverlayHover.

      // 0a. Check if we are physically OVER the overlay box
      let isOverOverlay = false;
      if (this._overlayData) {
        // Calculate the Visual Bounds of the Overlay
        // Logic must match _drawOverlay transforms:
        // Translate(pivot), Scale(1.13), Translate(-pivot)
        // Or simplified: relative to pivot, scale applied.

        // However, simple Bounds Check:
        // The overlay is drawn at this._overlayData.x/y (Pivot) with Scaling.
        // Let's use the same inverse math as _updateOverlayHover to see if we are "inside".
        // In _updateOverlayHover:
        // const pivot = { x: data.x, y: data.y };
        // const scx = (cx - pivot.x) * invScale + pivot.x;
        // rx = scx - pivot.x => (cx - pivot.x) * invScale
        //
        // So 'rx' is the unscaled relative X.
        // If rx is within [0, data.w], we are inside horizontally.

        const data = this._overlayData;
        const pivotX = data.x;
        const pivotY = data.y;
        const invScale = 1 / OVERLAY_SCALE; // 1 / 1.13

        // Transform Cursor to Overlay Local Space
        const localX = (cx - pivotX) * invScale;
        const localY = (cy - pivotY) * invScale;

        if (localX >= 0 && localX <= data.w && localY >= 0 && localY <= data.h) {
          isOverOverlay = true;
        }
      }

      if (isOverOverlay) {
        // We are hitting the overlay. Block Tab Hover.
        if (this._hoverTab) {
          this._hoverTab = null;
          this._needsRedraw = true;
        }
        this._hoverWidget = null;
        this._updateOverlayHover();
        return; // Consume event
      }

      // If NOT over overlay, we allow fall-through to Header/Tab check.
      // But we still update overlay hover (to handle "Mouse off" state clearing?)
      // Actually _updateOverlayHover handles "mouse off" internally if we call it?
      // If we DON'T call it, highlighting might stick?
      // Let's call it, but ignore hits? 
      // No, if we are NOT over overlay, _updateOverlayHover will naturally find nothing (and clear highlight).
      this._updateOverlayHover();

      // FALL THROUGH to check Tabs (if cy < HEADER_HEIGHT)
    }

    if (this._activeCombobox) {
      this._hoverWidget = null;
      this._hoverTab = null;
      this._updateComboboxHover();
      return;
    }

    // 1. Check Tabs (Header Area)
    if (!this._isMiniHUD && !this._isPopupHUD && cy < HEADER_HEIGHT) {
      this._hoverWidget = null;

      const rW = CANVAS_SIZE / 3;
      const rowIndex = Math.floor(cy / TAB_HEIGHT);
      const colIndex = Math.floor(cx / rW);

      if (rowIndex >= 0 && rowIndex < 3 && colIndex >= 0 && colIndex < 3) {
        let tabIndex = rowIndex * 3 + colIndex;
        if (tabIndex < GLOBAL_TABS.length) {
          const tabLabel = GLOBAL_TABS[tabIndex];
          if (this._hoverTab !== tabLabel) {
            this._hoverTab = tabLabel;
            this._needsRedraw = true;
            this._requestDraw();
          }
          return;
        }
      }
      this._hoverTab = null;
      return;
    }
    this._hoverTab = null;

    // 2. Check Widgets AND Headers
    const widgets = this._getWidgets();
    let newHover = null;

    // Reverse Check? (Topmost first) - though currently we don't have overlaps usually.
    // Z-Order: Overlay > Combobox > Header > Widgets

    for (let wid of widgets) {
      // Check collision
      if (cx >= wid.x && cx <= wid.x + wid.w && cy >= wid.y && cy <= wid.y + wid.h) {
        newHover = wid;
        break;
      }
    }

    if (this._hoverWidget !== newHover) {
      this._hoverWidget = newHover;
      this._needsRedraw = true;
      this._requestDraw();
    }
  }

  _updateComboboxHover() {
    // Basic hit test for dropdown options to support highlighting?
    // Not critical but nice-to-have if user asked for it. 
    // "menu elements don't highlight" -> refers to Overlay Menu or Combobox? 
    // User said "combobox for tool ... elements behind ... highlight", then "open a menu ... don't highlight".
    // "Menu" likely means the top tabs ("Files", "Scene" etc) causing an Overlay.
    // So _updateOverlayHover is priority.
  }

  _updateOverlayHover() {
    if (!this._overlayData || !this._overlayData.widgets) return;

    const cx = this._cursor.x;
    const cy = this._cursor.y;

    const data = this._overlayData;
    const isToolPicker = data.isToolPicker;

    // Menus are scaled up by 1.13 (OVERLAY_SCALE), so we must invert the ray coordinate 
    // to map back to the unscaled 1:1 layout space used by the widgets.
    const invScale = 1.0 / OVERLAY_SCALE;

    const pivot = this._getOverlayPivot();

    // Transform Cursor to Local Overlay Space (Pivot Scale)
    const scx = (cx - pivot.x) * invScale + pivot.x;
    const scy = (cy - pivot.y) * invScale + pivot.y;

    // Offset relative to the overlay's origin
    const ox = data.x;
    const oy = data.y;
    const rx = scx - ox;
    const ry = scy - oy;

    let newHover = null;
    let hitWidget = null;

    // Debug log
    let logHit = false;
    if (Math.random() < 0.05 && isToolPicker) logHit = true;

    if (logHit && window.screenLog) {
      // window.screenLog(`[Hvr] cy:${cy.toFixed(0)} scy:${scy.toFixed(0)} ry:${ry.toFixed(0)} invScale:${invScale.toFixed(2)}`, 'orange');
    }

    for (const w of this._overlayData.widgets) {
      if (rx >= w.x && rx <= w.x + w.w && ry >= w.y && ry <= w.y + w.h) {
        if (!w.disabled && !w.header) {
          hitWidget = w;
          newHover = w;

          if (logHit && window.screenLog) {
            // window.screenLog(`[Hvr] HIT! ${w.id}`, 'lime');
          }

          break;
        }
      }
    }



    // Force Redraw if we have a hover but it wasn't updated? No.
    // Logic seems solid.
    // I will enable the log to see it in action.

    // New Property for Overlay Hover
    if ((this._hoverOverlayWidget ? this._hoverOverlayWidget.id : null) !== (newHover ? newHover.id : null)) {
      // Debug Logging for transition
      const oldId = this._hoverOverlayWidget ? (this._hoverOverlayWidget.id || this._hoverOverlayWidget.label) : 'null';
      const newId = newHover ? (newHover.id || newHover.label) : 'null';

      this._hoverOverlayWidget = newHover;
      this._needsRedraw = true;
      this._requestDraw();
    } else {
      // Even if same, if we moved significantly or just to be safe?
      // No, if same, no need to redraw.
    }
  }

  _getWidgets() {
    const main = this._main;
    const gens = this._widgetGenerators;

    if (this._isMiniHUD) {
      if (!this._tabWidgets['Sculpting & Painting'] && gens['Sculpting & Painting']) {
        this._tabWidgets['Sculpting & Painting'] = gens['Sculpting & Painting'](main, true);
      }
      const rawWidgets = this._tabWidgets['Sculpting & Painting'] || [];

      // Filter to only the core bare minimum controls for the Mini-HUD
      // And we use the 'tool_select' widget to popup the MAIN menu tools panel!
      const allowedIds = ['tool_select', 'radius', 'intensity', 'negative', 'wireframe', 'picker'];
      const filtered = rawWidgets.filter(w => allowedIds.includes(w.id));

      // Re-pack vertically and clamp width for the new 300x500 Mini-HUD canvas
      const paddingX = 15;
      const targetWidth = this._canvas.width - (paddingX * 2);

      let currentY = 20; // Start near the top
      filtered.forEach(w => {
        w.x = paddingX;        // Reset x to a small margin
        w.w = targetWidth;     // Clamp width

        if (w.id === 'picker') {
          let spaceLeft = this._canvas.height - currentY - 10;
          w.h = Math.min(spaceLeft, targetWidth); // make it square, but responsive to remaining space
        } else if (w.type === 'slider') {
          w.h = 40; // Compress sliders from default 60 to save height
        }

        w.y = currentY;        // Stack vertically
        let pad = (w.type === 'slider') ? 5 : 20; // tighter pad for sliders
        currentY += w.h + pad;  // Widget height + padding
      });

      return filtered;
    }

    if (this._viewMode === 'SIDEBAR') {
      let allWidgets = [];
      let currentY = HEADER_HEIGHT - this._scrollOffset;

      SECTIONS.forEach(secTitle => {
        const isOpen = this._sectionStates[secTitle];

        // Section Header Widget
        allWidgets.push({
          type: 'section_header',
          label: secTitle,
          x: 0,
          y: currentY,
          w: CANVAS_SIZE,
          h: 60,
          id: 'section_' + secTitle
        });
        currentY += 60;

        if (isOpen) {
          // Generate Fresh Widgets
          if (gens[secTitle]) {
            this._tabWidgets[secTitle] = gens[secTitle](main);
          }
          const secWidgets = this._tabWidgets[secTitle];

          if (secWidgets) {
            // Determine vertical range of this section's widgets to normalize them
            let minY = Infinity;
            let maxY = -Infinity;
            secWidgets.forEach(w => {
              if (w.y < minY) minY = w.y;
              if (w.y + w.h > maxY) maxY = w.y + w.h;
            });

            if (minY === Infinity) minY = 0;
            if (maxY === -Infinity) maxY = 0;

            const sectionHeight = maxY - minY + 20; // + padding

            // Clone and re-position widgets
            secWidgets.forEach(w => {
              allWidgets.push({
                ...w,
                y: w.y - minY + currentY + 10 // +10 padding top
              });
            });

            currentY += sectionHeight;
          }
        }
      });

      this._maxScroll = Math.max(0, currentY + this._scrollOffset - CANVAS_SIZE);
      return allWidgets;
    }

    // Regular View (Generic Scroll support)
    // Generate Fresh Widgets
    if (gens[this._viewMode]) {
      this._tabWidgets[this._viewMode] = gens[this._viewMode](main);
    }
    const widgets = this._tabWidgets[this._viewMode] || [];
    const currentY = HEADER_HEIGHT - this._scrollOffset;

    // Normalize generic view if needed, but usually they are absolute.
    // Let's assume absolute for now but apply scroll.
    // Let's assume absolute for now but apply scroll.
    const offsetWidgets = widgets.map(w => ({
      ...w,
      y: w.y + currentY // Start at Header Bottom
    }));

    return offsetWidgets;
  }

  onInteract(u, v, isPressed) {
    if (this._wasPressed === undefined) this._wasPressed = false;
    const isRisingEdge = (isPressed && !this._wasPressed);
    this._wasPressed = isPressed;

    if (!this._cursor.active) return;

    const cx = this._cursor.x;
    const cy = this._cursor.y;

    // 0.5. Active continuous interactions (High Priority)
    // Must run BEFORE everything else to prevent overlays from stealing the drag event
    if ((this._activeSlider || this._activeColorPicker) && !isPressed) {
      if (this._activeSlider) {
        if (this._activeSlider.id === 'stack_size' && this._main) {
          this._main.getStateManager().setNewMaxStack(Math.round(this._activeSlider.value));
        } else if (this._activeSlider.onRelease) {
          this._activeSlider.onRelease(this._activeSlider.value);
        }
        this._activeSlider = null;
      }
      if (this._activeColorPicker) {
        if (this._activeColorPicker.onRelease) {
          this._activeColorPicker.onRelease();
        }
        this._activeColorPicker = null;
        this._activeColorPickerRegion = null;
      }
      return;
    }

    if (this._activeSlider) {
      const targetWid = this._activeSlider;
      const sliderW = targetWid.w;
      const sliderX = targetWid.x;

      let scaledCx = cx;
      if (this._overlay) {
        const pivot = this._getOverlayPivot();
        const invScale = 1 / OVERLAY_SCALE;
        scaledCx = (cx - pivot.x) * invScale + pivot.x;
        // Also subtract data.x to make it relative to the menu box if it's a menu widget
        if (this._overlayData && this._overlayData.x !== undefined) {
          scaledCx -= this._overlayData.x;
        }
      }

      // Calculate normalized value
      let t = (scaledCx - sliderX) / sliderW;
      t = Math.max(0, Math.min(1, t));

      // Map to Min/Max
      let val = t;
      if (isFinite(targetWid.min) && isFinite(targetWid.max)) {
        val = targetWid.min + t * (targetWid.max - targetWid.min);
        if (targetWid.step) {
          const steps = Math.round((val - targetWid.min) / targetWid.step);
          val = targetWid.min + steps * targetWid.step;
          // Force integer UI strings for integer steps to avoid JS float precision issues (like 15.00000001)
          if (targetWid.step % 1 === 0) val = Math.round(val);
        }
      }

      // Update
      if (targetWid.value !== val) {
        targetWid.value = val;
        if (targetWid.onInput) targetWid.onInput(val);
        // Do not execute action continuously for stack size to prevent array reallocation lag
        if (targetWid.id !== 'stack_size') {
          this._executeAction(targetWid);
        }
        this._needsRedraw = true;
      }
      return;
    }

    const now = performance.now();

    // 0. Dropdown Interaction (High Priority)
    if (this._activeCombobox) {
      if (!isRisingEdge) return; // Only interact on PRESS explicitly
      if (now - this._inputDebounce < 250) return;
      this._inputDebounce = now;
      this._handleDropdownInteract(cx, cy);
      return;
    }

    // 0. Check Overlay (with Tab Switching Priority)
    if (this._overlay) {
      if (!isRisingEdge) return; // Only interact on press
      if (now - this._inputDebounce < 250) return;

      // PRIORITY: Check if clicking a TAB HEADER (Outside Overlay)
      // Only allowed if we are NOT clicking on the Overlay itself.

      let isOverOverlay = false;
      if (this._overlayData) {
        const data = this._overlayData;
        const pivotX = data.x;
        const pivotY = data.y;
        const invScale = 1 / OVERLAY_SCALE;

        const localX = (cx - pivotX) * invScale;
        const localY = (cy - pivotY) * invScale;

        if (localX >= 0 && localX <= data.w && localY >= 0 && localY <= data.h) {
          isOverOverlay = true;
        }
      }

      // If we are NOT over the overlay, AND we are in the header area, check tabs.
      if (!isOverOverlay && cy < TAB_HEIGHT * 3) {
        // We need to re-run the Tab Hit logic here because it's usually blocked by Overlay
        const w = this._canvas.width;
        if (this._viewMode === 'SIDEBAR' || GLOBAL_TABS.includes(this._viewMode)) {
          const row1 = GLOBAL_TABS.slice(0, 3);
          const row2 = GLOBAL_TABS.slice(3, 6);
          const row3 = GLOBAL_TABS.slice(6);

          let switched = false;
          // Row 1
          if (cy < TAB_HEIGHT) {
            const r1W = w / row1.length;
            const idx = Math.floor(cx / r1W);
            if (idx >= 0 && idx < row1.length) { this.switchTab(row1[idx]); switched = true; }
          }
          // Row 2
          else if (cy < TAB_HEIGHT * 2) {
            const r2W = w / row2.length;
            const idx = Math.floor(cx / r2W);
            if (idx >= 0 && idx < row2.length) { this.switchTab(row2[idx]); switched = true; }
          }
          // Row 3
          else if (cy < TAB_HEIGHT * 3) {
            const r3W = w / row3.length;
            const idx = Math.floor(cx / r3W);
            if (idx >= 0 && idx < row3.length) { this.switchTab(row3[idx]); switched = true; }
          }

          if (switched) {
            this._inputDebounce = now;
            return;
          }
        }
      }

      this._inputDebounce = now;
      this._handleOverlayInteract(cx, cy, isPressed);
      return;
    }



    // Find Target Widget for Debounce Logic
    let targetWid = null;
    const widgets = this._getWidgets();
    for (let wid of widgets) {
      if (cx >= wid.x && cx <= wid.x + wid.w && cy >= wid.y && cy <= wid.y + wid.h) {
        targetWid = wid;
        break;
      }
    }

    // Scrollbar Interaction Check (Needed for Debug Log)
    const canvasW = this._canvas.width;
    const isScrollInteraction = this._isDraggingScrollbar || (cx >= canvasW - 40 && cy > HEADER_HEIGHT);

    if (isPressed) {
    }

    // Dynamic Debounce
    let debounceTime = 250;
    // Faster interaction for continuous controls
    if (targetWid && (targetWid.type === 'slider' || targetWid.type === 'colorpicker_embedded' || targetWid.id === 'roughness' || targetWid.id === 'metallic')) {
      debounceTime = 16; // ~60fps for continuous controls
    }
    if (targetWid && targetWid.type === 'section_header') {
      debounceTime = 300; // prevent double toggle
    }

    // Check Tabs
    if (!targetWid && cy < TAB_HEIGHT) debounceTime = 250;

    if (isScrollInteraction || this._isDraggingContent || (!targetWid && cy > HEADER_HEIGHT)) {
      debounceTime = 0; // Immediate response for scrollbar & content drag
    } else {
      // Only execute widget clicks on a STRICT RISING EDGE to prevent double-firings
      // when holding the trigger for >250ms (unless it's a slider which needs continuous press)
      // STRIKT START CHECK: To start any interaction on this layer, we MUST have a rising edge.
      // This prevents "leakage" from overlays that close on the first frame of a press.
      const isDragging = !!(this._activeSlider || this._isDraggingScrollbar || this._isDraggingContent || this._activeColorPicker);

      if (isDragging) {
        if (!isPressed) return; // Continue drag
      } else {
        if (!isRisingEdge) return; // Block fall-through!
      }
    }

    if (now - this._inputDebounce < debounceTime) return;
    this._inputDebounce = now;

    const w = this._canvas.width;

    // 1. Scrollbar Interaction
    if (isScrollInteraction) {
      const trackW = 40;
      const trackX = w - trackW;

      // Check if we hit scrollbar (only if below header)
      if (cx >= trackX && cy > HEADER_HEIGHT) {
        if (!this._isDraggingScrollbar && isPressed) {
          this._isDraggingScrollbar = true;
          this._lastScrollY = cy;
          return;
        }
      }

      if (this._isDraggingScrollbar) {
        if (!isPressed) {
          this._isDraggingScrollbar = false;
          this._lastScrollY = undefined;
          return;
        }

        if (this._lastScrollY !== undefined) {
          const deltaY = cy - this._lastScrollY;
          const trackH = this._canvas.height - HEADER_HEIGHT;
          const contentH = trackH + this._maxScroll;
          const ratio = contentH / trackH;

          if (Math.abs(deltaY) > 0) {
            this._scrollOffset += deltaY * ratio;
            this._scrollOffset = Math.max(0, Math.min(this._scrollOffset, this._maxScroll));
            this._needsRedraw = true;
            this._requestDraw();
          }
        }
        this._lastScrollY = cy;
        return;
      }

    }

    // 2. Dropdown Interaction (Combobox) - Needs Scaling if it overlays
    // Dropdowns are treated as overlays in _drawCombobox but handled separately in input?
    // Wait, _handleDropdownInteract logic?
    // Let's modify _handleDropdownInteract to support scaling.
    // It's defined somewhere else?
    // I need to find _handleDropdownInteract definition.
    // Searching...
    // It is effectively an overlay.
    // But `this._activeCombobox` overrides input in `onInteract`.


    // 3. Check Tabs (Header) - PRIORITY over Widgets
    // Check this BEFORE widgets to ensure we can always click tabs even if widgets are scrolled 'under' them.
    if (!this._isMiniHUD && isPressed && cy < HEADER_HEIGHT) {
      const w = this._canvas.width;
      if (this._viewMode === 'SIDEBAR' || GLOBAL_TABS.includes(this._viewMode)) {
        const row1 = GLOBAL_TABS.slice(0, 3);
        const row2 = GLOBAL_TABS.slice(3, 6);
        const row3 = GLOBAL_TABS.slice(6);

        const r1W = w / row1.length;
        const r2W = w / row2.length;
        const r3W = w / row3.length;

        if (cy < TAB_HEIGHT) {
          const idx = Math.floor(cx / r1W);
          if (idx >= 0 && idx < row1.length) this.switchTab(row1[idx]);
        } else if (cy < TAB_HEIGHT * 2) {
          const idx = Math.floor(cx / r2W);
          if (idx >= 0 && idx < row2.length) this.switchTab(row2[idx]);
        } else if (cy < TAB_HEIGHT * 3) {
          const idx = Math.floor(cx / r3W);
          if (idx >= 0 && idx < row3.length) this.switchTab(row3[idx]);
        }
        return;
      }
    }

    // Active continuous interactions outside of targetWid bounds
    if (isPressed && this._lastScrollY === undefined) {
      if (this._activeSlider && (!targetWid || targetWid === this._activeSlider)) {
        this._handleWidgetClick(this._activeSlider);
        return;
      } else if (this._activeColorPicker && (!targetWid || targetWid === this._activeColorPicker)) {
        this._handleWidgetClick(this._activeColorPicker);
        return;
      }
    }

    // 4. Check Widgets
    if (targetWid && isPressed && this._lastScrollY === undefined) {
      if (targetWid.disabled) return;

      if (targetWid.type === 'slider') {
        this._activeSlider = targetWid;

        const sliderW = targetWid.w;
        const sliderX = targetWid.x;

        let t = (cx - sliderX) / sliderW;
        t = Math.max(0, Math.min(1, t));

        let val = t;
        if (isFinite(targetWid.min) && isFinite(targetWid.max)) {
          val = targetWid.min + t * (targetWid.max - targetWid.min);
          if (targetWid.step) {
            const steps = Math.round((val - targetWid.min) / targetWid.step);
            val = targetWid.min + steps * targetWid.step;
          }
        }

        if (targetWid.value !== val) {
          targetWid.value = val;
          if (targetWid.onInput) targetWid.onInput(val);
          this._executeAction(targetWid);
          this._needsRedraw = true;
        }
        return;
      }

      if (targetWid.type === 'section_header') {
        const sec = targetWid.label;
        this._sectionStates[sec] = !this._sectionStates[sec];
        this._needsRedraw = true;
        this.draw();
        return;
      }

      this._handleWidgetClick(targetWid);
      return;
    }



    // 4. Background Drag (Content Scrolling)
    // We allow drag if we started below header, OR if we are already dragging (even if we drifted up)
    if (this._isDraggingContent || (cy > HEADER_HEIGHT && !targetWid)) {
      if (isPressed) {
        if (!this._isDraggingContent) {
          // Start Drag
          this._isDraggingContent = true;
          this._lastScrollY = cy;
          return;
        }

        // Continue Drag
        if (this._lastScrollY !== undefined) {
          const deltaY = cy - this._lastScrollY;
          const trackH = this._canvas.height - HEADER_HEIGHT;
          const contentH = trackH + this._maxScroll;
          // Scale Factor: 1 pixel drag = 1 pixel scroll?
          // Or proportional?
          // Standard touch drag is 1:1 usually.
          // But our scrollOffset increases to scroll DOWN.
          // Dragging UP (deltaY < 0) should increase scrollOffset (scrolling down).
          // So we subtract deltaY.
          this._scrollOffset -= deltaY;
          this._scrollOffset = Math.max(0, Math.min(this._scrollOffset, this._maxScroll));
          this._needsRedraw = true;
          this._requestDraw();
        }
        this._lastScrollY = cy;
        return;
      } else {
        // Stop Drag
        this._isDraggingContent = false;
        this._lastScrollY = undefined;
      }
    }

    // Debug Log for Header Hover (Optional)
    if (this._lastScrollY !== undefined) {
      this._lastScrollY = undefined;
    }
  }

  _handleOverlayInteract(cx, cy, isPressed) {
    // Input Transform for Scale
    const data = this._overlayData;
    const isToolPicker = data && data.isToolPicker;

    // Menus are scaled up by 1.13 (OVERLAY_SCALE), so we must invert the ray coordinate 
    // to map back to the unscaled 1:1 layout space used by the widgets.
    const invScale = 1.0 / OVERLAY_SCALE;

    const pivot = this._getOverlayPivot();
    cx = (cx - pivot.x) * invScale + pivot.x;
    cy = (cy - pivot.y) * invScale + pivot.y;

    // Close if clicking outside box
    // Custom bounds for 'menu' which has variable size
    let ox = OVERLAY_X, oy = OVERLAY_Y, ow = OVERLAY_W, oh = OVERLAY_H;

    if (this._overlay === 'menu' && this._overlayData) {
      ox = this._overlayData.x;
      oy = this._overlayData.y;
      ow = this._overlayData.w;
      oh = this._overlayData.h;
    }

    if (isPressed) {
      if (cx < ox || cx > ox + ow || cy < oy || cy > oy + oh) {
        this.closeOverlay();
        return;
      }

      // Close Button (Top Right)
      const closeSize = 60;
      // Note: This logic assumes close button is always at top-right of the DEFINED overlay box
      if (cx > ox + ow - closeSize && cy < oy + closeSize) {
        this.closeOverlay();
        return;
      }
    }

    if (this._overlay === 'combobox') {
      this._handleComboboxInteract(cx, cy);
    } else if (this._overlay === 'colorpicker') {
      this._handleColorPickerInteract(cx, cy);
    } else if (this._overlay === 'menu') {
      this._handleMenuInteract(cx, cy);
    }
  }

  _handleComboboxInteract(cx, cy) {
    const data = this._overlayData;
    if (!data || !data.options) return;

    const itemHeight = 80;
    const listY = OVERLAY_Y + 100;

    const relY = cy - listY;
    if (relY < 0) return; // Clicked header area

    const index = Math.floor(relY / itemHeight);

    if (index >= 0 && index < data.options.length) {
      const opt = data.options[index];
      if (data.callback) data.callback(opt.id !== undefined ? opt.id : index);
      this.closeOverlay();
    }
  }

  _handleMenuInteract(cx, cy) {
    const t0 = performance.now();
    const data = this._overlayData;
    if (!data || !data.widgets) return;

    // Relativize coords
    const rx = cx - data.x;
    const ry = cy - data.y;

    if (data.isToolPicker && window.screenLog) {
      // window.screenLog(`[Click] cy:${cy.toFixed(0)} ry:${ry.toFixed(0)}`, 'pink');
    }

    if (this._activeSlider) {
      const w = this._activeSlider;
      let t = Math.max(0, Math.min(1, (rx - w.x) / w.w));
      let val = t;
      if (isFinite(w.min) && isFinite(w.max)) {
        val = w.min + t * (w.max - w.min);
        if (w.step) {
          const steps = Math.round((val - w.min) / w.step);
          val = w.min + steps * w.step;
          if (w.step % 1 === 0) val = Math.round(val);
        }
      }
      w.value = val;
      if (w.id !== 'stack_size') this._executeAction(w);
      this._needsRedraw = true;
      return;
    } else if (this._activeColorPicker) {
      this._handleEmbeddedColorPicker(this._activeColorPicker);
      return;
    }

    // Check click on menu widgets
    for (const w of data.widgets) {
      if (rx >= w.x && rx <= w.x + w.w && ry >= w.y && ry <= w.y + w.h) {
        if (!w.disabled && !w.header) {
          if (data.isToolPicker && window.screenLog) {
            // window.screenLog(`[Click] HIT! ${w.id}`, 'lime');
          }

          if (w.type === 'slider') {
            this._activeSlider = w;
            let t = Math.max(0, Math.min(1, (rx - w.x) / w.w));
            let val = t;
            if (isFinite(w.min) && isFinite(w.max)) {
              val = w.min + t * (w.max - w.min);
              if (w.step) {
                const steps = Math.round((val - w.min) / w.step);
                val = w.min + steps * w.step;
                if (w.step % 1 === 0) val = Math.round(val);
              }
            }
            w.value = val;
            if (w.id !== 'stack_size') {
              this._executeAction(w);
            }
            this._needsRedraw = true;
          } else if (w.type === 'checkbox') {
            w.value = !w.value;
            this._executeAction(w);
            this._needsRedraw = true;
          } else if (w.type === 'button') {
            this._executeAction(w);
            // Close menu on action? 
            // Keep open for specific actions like Undo/Redo or Tools
            // ALSO keep open for Voxel Mode buttons (vx_add, vx_sub, etc)
            const keepOpen = ['undo', 'redo', 'addSphere', 'addCube', 'addCylinder', 'addTorus', 'vx_add', 'vx_sub', 'vx_inf', 'vx_def'].includes(w.id);
            if (!keepOpen) this.closeOverlay();
            else this._needsRedraw = true;
          } else if (w.type === 'combobox') {
            this._executeAction(w); // Use active combobox system
            return;
          }
        }
        const t1 = performance.now();
        if (t1 - t0 > 2) console.log(`[Perf] GuiXR._handleMenuInteract took ${(t1 - t0).toFixed(2)}ms`);
        return;
      }
    }
    const t1 = performance.now();
    if (t1 - t0 > 2) console.log(`[Perf] GuiXR._handleMenuInteract took ${(t1 - t0).toFixed(2)}ms`);
  }

  _getWidgetValue(tab, id) {
    if (!this._tabWidgets[tab] || !this._tabWidgets[tab].widgets) return undefined;
    const w = this._tabWidgets[tab].widgets.find(w => w.id === id);
    return w ? w.value : undefined;
  }





  _handleColorPickerInteract(cx, cy) {
    const data = this._overlayData;
    const padding = 40;
    const startX = OVERLAY_X + padding;
    const startY = OVERLAY_Y + 100;
    const svSize = 500;

    // 1. SV Square Interaction
    if (cx >= startX && cx <= startX + svSize && cy >= startY && cy <= startY + svSize) {
      const s = Math.max(0, Math.min(1, (cx - startX) / svSize));
      const v = Math.max(0, Math.min(1, 1.0 - (cy - startY) / svSize));
      if (data.onSVChange) data.onSVChange(s, v);
      return;
    }

    // 2. Hue Strip Interaction
    const hueX = startX + svSize + 40;
    const hueW = 80;
    const hueH = svSize;
    if (cx >= hueX && cx <= hueX + hueW && cy >= startY && cy <= startY + hueH) {
      const h = Math.max(0, Math.min(1, (cy - startY) / hueH));
      if (data.onHueChange) data.onHueChange(h);
      return;
    }

    // 3. Confirm Button
    const btnY = startY + svSize + 40;
    const btnH = 80;
    if (cy >= btnY && cy <= btnY + btnH && cx >= startX && cx <= startX + svSize + 40 + hueW) {
      if (data.onConfirm) data.onConfirm();
      this.closeOverlay();
    }
  }

  openOverlay(type, data) {
    if (data && data.isToolPicker) {
      // This expands the dark background panel
      data.w = 500; // Original is 660

      let maxExt = 400;
      if (data.widgets) {
        data.widgets.forEach(w => {
          if (w.y + w.h + 20 > maxExt) maxExt = w.y + w.h + 20;
        });
      }
      data.h = maxExt;

      // Shift the entire block of buttons relative to the background
      if (data.widgets) {
        data.widgets.forEach(w => {
          w.x -= 80; // Nudge all buttons 80px left
          w.y -= 10; // Nudge all buttons 10px up
        });
      }
    }

    this._overlay = type;
    this._overlayData = data;
    this._overlayOpenTime = performance.now();
    this._needsRedraw = true;
    this.draw();
  }

  closeOverlay() {
    this._overlay = null;
    this._overlayData = null;
    this._needsRedraw = true;
    this.draw();
  }

  _handleWidgetClick(w) {
    if (w.type === 'slider') {
      let t = Math.max(0, Math.min(1, (this._cursor.x - w.x) / w.w));

      // Generic Min/Max Mapping
      let val = t;
      if (isFinite(w.min) && isFinite(w.max)) {
        val = w.min + t * (w.max - w.min);
        if (w.step) {
          const steps = Math.round((val - w.min) / w.step);
          val = w.min + steps * w.step;
          if (w.step % 1 === 0) val = Math.round(val);
        }
      }
      w.value = val;
      this._needsRedraw = true;
      this.draw();

      if (!this._lastSliderCallback) this._lastSliderCallback = 0;
      const now = performance.now();
      if (now - this._lastSliderCallback > 30) {
        this._lastSliderCallback = now;
        if (this._main) {
          // Use onInput if available (Preferred)
          if (w.onInput) {
            w.onInput(val);
          } else {
            // Legacy Fallbacks
            if (w.id === 'radius') this.updateRadius(val); // Should be covered by onInput now
            if (w.id === 'fov') { main.getCamera().setFov(val); main.render(); }
            if (w.id === 'intensity' && this._main.getSculptManager().getCurrentTool()) {
              this._main.getSculptManager().getCurrentTool().setIntensity(val);
            }
            // ... (keep other fallbacks if needed, or rely on adding onInput to them later)
            if (w.id === 'voxelRes') {
              var tool = this._main.getSculptManager().getTool(Enums.Tools.VOXEL);
              if (tool && tool.setResolution) tool.setResolution(Math.floor(32 + t * (256 - 32))); // voxelRes might rely on normalized t?
            }
            if (w.id === 'voxelRad') {
              var tool = this._main.getSculptManager().getTool(Enums.Tools.VOXEL);
              if (tool && tool.setRadiusMultiplier) tool.setRadiusMultiplier(1.0 + t * 99.0);
            }
            if (w.id === 'roughness' || w.id === 'metallic') {
              const tool = this._main.getSculptManager().getTool(Enums.Tools.PAINT);
              if (tool) {
                if (w.id === 'roughness') tool._material[0] = val; // Assuming these accept 0-1
                if (w.id === 'metallic') tool._material[1] = val;
              }
            }
          }
          this._main.render();
        }
      }
    } else if (w.type === 'colorpicker_embedded') {
      if (this._activeColorPicker !== w) {
        this._activeColorPicker = w;
        this._activeColorPickerRegion = null;
      }
      this._handleEmbeddedColorPicker(w);
    } else if (w.type === 'combobox') {
      let opts = [];
      let cb = null;

      const ShaderMatcap = Shader[Enums.Shader.MATCAP];
      const ShaderPBR = Shader[Enums.Shader.PBR];

      // Generic Support (Preferred)
      if (w.options) {
        opts = w.options;
        cb = w.onSelect;
      }
      // Legacy Hardcoded Support
      else if (w.id === 'matcap') {
        if (ShaderMatcap && ShaderMatcap.matcaps) {
          opts = ShaderMatcap.matcaps.map((m, i) => ({ label: m.name, id: i }));
        }
        cb = (id) => {
          if (this._main) {
            this._main.getMesh().setShaderType(Enums.Shader.MATCAP);
            this._main.getMesh().setMatcap(id);
            this._main.render();
          }
        };
      } else if (w.id === 'environment') {
        if (ShaderPBR && ShaderPBR.environments) {
          opts = ShaderPBR.environments.map((e, i) => ({ label: e.name, id: i }));
        }
        cb = (id) => {
          if (this._main) {
            this._main.getMesh().setShaderType(Enums.Shader.PBR);
            ShaderPBR.idEnv = id;
            this._main.render();
          }
        };
      }

      if (opts.length > 0) {
        // Toggle Dropdown
        w.options = opts;
        if (this._activeCombobox === w) {
          this._activeCombobox = null;
        } else {
          this._activeCombobox = w;
        }
        this._needsRedraw = true;
        this.draw();
      } else {
        console.warn("[GuiXR] No options for combobox: " + w.id);
      }

    } else if (w.type === 'color') {
      const tool = this._main.getSculptManager().getTool(Enums.Tools.PAINT);
      if (!tool) return;

      const rgb = tool._color;
      const hsv = [0, 0, 0];
      Utils.rgb2hsv(rgb[0], rgb[1], rgb[2], hsv);

      this.openOverlay('colorpicker', {
        hue: hsv[0],
        sat: hsv[1],
        val: hsv[2],
        onSVChange: (s, v) => {
          this._overlayData.sat = s;
          this._overlayData.val = v;
          const newRgb = Utils.hsv2rgb(this._overlayData.hue, s, v);
          tool._color[0] = newRgb[0];
          tool._color[1] = newRgb[1];
          tool._color[2] = newRgb[2];
          this._needsRedraw = true;
          this.draw();
        },
        onHueChange: (h) => {
          this._overlayData.hue = h;
          const newRgb = Utils.hsv2rgb(h, this._overlayData.sat, this._overlayData.val);
          tool._color[0] = newRgb[0];
          tool._color[1] = newRgb[1];
          tool._color[2] = newRgb[2];
          this._needsRedraw = true;
          this.draw();
        },
        onConfirm: () => { }
      });

    } else {
      this._needsRedraw = true;
      this.draw();
      this._executeAction(w);
    }
  }

  onClick() { }

  _executeAction(w) {
    const main = this._main;
    if (!main) return;

    const id = w.id;

    // Prefer onInteract if defined (New System)
    if (w.onInteract) {
      w.onInteract(w.value);
      return;
    }

    if (w.type === 'slider' || w.type === 'info' || w.type === 'combobox' || w.type === 'color') return;

    if (w.type === 'section_header') {
      // Toggle Section
      this._sectionStates[w.label] = !this._sectionStates[w.label];
      this._needsRedraw = true;
      this.forceDraw(); // Force redraw to recalc layout
      return;
    }

    // Generic Checkbox Handling (Restored)
    if (w.type === 'checkbox') {
      const val = w.value;
      const id = w.id;
      if (window.screenLog) window.screenLog(`Chk: ${id} = ${val}`, "white");

      if (id === 'grid') { main._showGrid = val; main.render(); }
      else if (id === 'contour') { main._showContour = val; main.render(); }
      else if (id === 'show_sym') { ShaderBase.showSymmetryLine = val; main.render(); }
      else if (id === 'darken') { ShaderBase.darkenUnselected = val; main.render(); }
      else if (id === 'camera_mode') {
        const mode = val ? Enums.CameraMode.ORTHOGRAPHIC : Enums.CameraMode.PERSPECTIVE;
        main.getCamera().setMode(mode);
        main.render();
      }
      else if (['export_all', 'export_zbrush', 'export_append', 'import_scale', 'import_srgb'].includes(id)) {
        const guiFiles = (main.getGui && main.getGui()) ? main.getGui()._ctrlFiles : null;
        if (guiFiles) {
          if (id === 'export_all') guiFiles._exportAll = val;
          else if (id === 'export_zbrush') guiFiles._objColorZbrush = val;
          else if (id === 'export_append') guiFiles._objColorAppended = val;
          else if (id === 'import_scale') main._autoMatrix = val;
          else if (id === 'import_srgb') main._vertexSRGB = val;
        }
      }
      return;
    }

    // Scene Actions
    if (w.id === 'addSphere') main.addSphere();
    if (w.id === 'addCube') main.addCube();
    if (w.id === 'addCylinder') main.addCylinder();
    if (w.id === 'addTorus') main.addTorus();
    if (w.id === 'undo') main.getStateManager().undo();
    if (w.id === 'redo') main.getStateManager().redo();

    // Tool Selection (Dynamic Updates)
    if (typeof w.id === 'number') {
      if (window.screenLog) window.screenLog(`Tool: ${w.id}`, "white");
      const sm = main.getSculptManager();
      sm.setToolIndex(w.id);
      this.refreshToolsWidget(); // Rebuild widgets for new tool
    }

    // Paint Tool Toggles
    if (w.id === 'paint_all') {
      const tool = main.getSculptManager().getTool(Enums.Tools.PAINT);
      if (tool && tool.paintAll) tool.paintAll();
    }
    if (w.id === 'pick_color') {
      const tool = main.getSculptManager().getTool(Enums.Tools.PAINT);
      if (tool) {
        tool._pickColor = !tool._pickColor;
        // Force cursor update if needed (main mostly uses mouse logic but we can manually sync)
        console.log("Pick Color toggled:", tool._pickColor);
      }
    }
    if (w.id === 'write_albedo' || w.id === 'write_roughness' || w.id === 'write_metalness') {
      const tool = main.getSculptManager().getTool(Enums.Tools.PAINT);
      if (tool) {
        if (w.id === 'write_albedo') tool._writeAlbedo = !tool._writeAlbedo;
        if (w.id === 'write_roughness') tool._writeRoughness = !tool._writeRoughness;
        if (w.id === 'write_metalness') tool._writeMetalness = !tool._writeMetalness;
      }
    }

    // View / Rendering Modes
    if (w.id === 'pbr') main.getMesh().setShaderType(Enums.Shader.PBR);
    if (w.id === 'matcap') main.getMesh().setShaderType(Enums.Shader.MATCAP);

    // Toggles (Modifiers)
    if (w.id === 'flat') {
      const val = !main.getMesh().getFlatShading();
      main.getMesh().setFlatShading(val);
      // Force update to ensure visual sync if needed
    }
    if (w.id === 'wireframe') {
      const val = !main.getMesh().getShowWireframe();
      main.getMesh().setShowWireframe(val);
    }

    // Toggles
    if (w.id === 'symmetry') {
      const sym = main.getPickingSymmetry();
      if (sym) {
        const val = !sym.getValue();
        sym.setValue(val);
        w.value = val; // Store state in widget for visual toggle?
        // Note: toggle rendering isn't fully wired to w.value yet in GuiXR draw() for standard toggles, but logic should work.
      }
    }

    // Passthrough (Placeholder)
    if (w.id === 'passthrough') {
      console.warn("AR Passthrough not yet implemented");
    }

    // Files (Delegated to GuiFiles)
    if (id === 'import_obj') {
      const fileInput = document.getElementById('fileopen');
      if (fileInput) fileInput.click();
    }
    else if (id === 'tex_size') {
      if (main.getGui && main.getGui()._ctrlFiles) main.getGui()._ctrlFiles.onTextureSize(w.value);
    }
    else if (id === 'save_diffuse') {
      if (main.getGui && main.getGui()._ctrlFiles) main.getGui()._ctrlFiles.saveColor();
    }
    else if (id === 'save_roughness') {
      if (main.getGui && main.getGui()._ctrlFiles) main.getGui()._ctrlFiles.saveRoughness();
    }
    else if (id === 'save_metalness') {
      if (main.getGui && main.getGui()._ctrlFiles) main.getGui()._ctrlFiles.saveMetalness();
    }
    else if (id === 'export_sgl') {
      if (main.getGui && main.getGui()._ctrlFiles) main.getGui()._ctrlFiles.saveFileAsSGL();
    }
    else if (id === 'export_obj') {
      if (main.getGui && main.getGui()._ctrlFiles) main.getGui()._ctrlFiles.saveFileAsOBJ();
    }
    else if (id === 'export_ply') {
      if (main.getGui && main.getGui()._ctrlFiles) main.getGui()._ctrlFiles.saveFileAsPLY();
    }
    else if (id === 'export_stl') {
      if (main.getGui && main.getGui()._ctrlFiles) main.getGui()._ctrlFiles.saveFileAsSTL();
    }
    else if (id === 'go_sketchfab') {
      if (main.getGui() && main.getGui().exportSketchfab) main.getGui().exportSketchfab();
    }

    // Background interaction
    else if (id === 'bg_reset') { main.getBackground().deleteTexture(); main.render(); }
    else if (id === 'bg_import') { const el = document.getElementById('backgroundopen'); if (el) el.click(); }
    else if (id === 'bg_fill') { main.getBackground()._fill = w.value; main.onCanvasResize(); }
    else if (id === 'bg_blur') { main.getBackground()._blur = w.value; main.render(); }
    else if (id === 'bg_type') {
      main.getBackground().setType(w.value);
      main.onCanvasResize();
      main.render();
    }

    // Camera
    else if (id === 'cam_reset') { main.getCamera().resetView(); main.render(); }
    else if (id === 'cam_front') { main.getCamera().toggleViewFront(); main.render(); }
    else if (id === 'cam_left') { main.getCamera().toggleViewLeft(); main.render(); }
    else if (id === 'cam_top') { main.getCamera().toggleViewTop(); main.render(); }
    else if (id === 'cam_proj') { main.getCamera().setProjectionType(w.value); main.render(); }
    else if (id === 'cam_mode') { main.getCamera().setMode(w.value); main.render(); }
    else if (id === 'cam_pivot') { main.getCamera().toggleUsePivot(); main.render(); }
    else if (id === 'cam_speed') { main._cameraSpeed = w.value; }

    // Tablet
    else if (id === 'tablet_radius') { Tablet.radiusFactor = w.value; }
    else if (id === 'tablet_intensity') { Tablet.intensityFactor = w.value; }

    // Language
    else if (id === 'language') {
      TR.select = w.value;
      // Ideally reload GUI but here just close overlay.
    }

    // Extra UI
    else if (id === 'extra_pixel_ratio') { main._pixelRatio = w.value; main.onCanvasResize(); }
    else if (id === 'extra_vox_res') {
      const tool = main.getSculptManager().getTool(Enums.Tools.VOXEL);
      if (tool && tool.setResolution) tool.setResolution(w.value);
    }
    else if (id === 'extra_vox_rad') {
      const tool = main.getSculptManager().getTool(Enums.Tools.VOXEL);
      if (tool && tool.setRadiusMultiplier) tool.setRadiusMultiplier(w.value);
    }

    // About
    else if (id === 'about_link') { window.open('http://stephaneginier.com', '_blank'); }

    // Visual Feedback
    this._clickedWidget = w;
    this._lastClick = performance.now();
    setTimeout(() => { this._needsRedraw = true; this.draw(); }, 250);
    this._needsRedraw = true;
    main.render();
  }

  forceDraw() {
    this._lastDraw = 0;
    this._needsRedraw = true;
    this.draw();
    this.updateTexture();
  }

  syncWidgetValues() {
    const main = this._main;
    if (!main) return;
    const sm = main.getSculptManager();
    const activeTool = sm ? sm.getCurrentTool() : null;

    if (!activeTool) return;

    // Fast-sync values from tool back to GuiXR widgets
    // so any external changes (like changing tool via popup) update the sliders.
    const widgets = this._getWidgets();
    let changed = false;

    // Special case for 'tool_select' label on Mini-HUD
    const activeToolDef = Tools[sm.getToolIndex()];

    for (const w of widgets) {
      if (w.id === 'radius') {
        if (w.value !== activeTool._radius) {
          w.value = activeTool._radius;
          changed = true;
        }
      } else if (w.id === 'intensity') {
        if (w.value !== activeTool._intensity) {
          w.value = activeTool._intensity;
          changed = true;
        }
      } else if (w.id === 'negative') {
        if (w.value !== activeTool._negative) {
          w.value = activeTool._negative;
          changed = true;
        }
      } else if (w.id === 'wireframe') {
        const mesh = this._main.getMesh();
        const showWire = mesh ? mesh.getShowWireframe() : false;
        if (w.value !== showWire) {
          w.value = showWire;
          changed = true;
        }
      } else if (w.id === 'culling') {
        if (w.value !== activeTool._culling) {
          w.value = activeTool._culling;
          changed = true;
        }
      } else if (w.id === 'accumulate') {
        if (w.value !== activeTool._accumulate) {
          w.value = activeTool._accumulate;
          changed = true;
        }
      } else if (w.id === 'tool_select' && w.type === 'button') {
        const newLabel = 'Tool: ' + (activeToolDef ? TR(activeToolDef.uiName) : '');
        if (w.label !== newLabel) {
          w.label = newLabel;
          changed = true;
        }
      }

      // Also force-update `lastValue` to trigger handle re-renders if the underlying value was reset by a new tool
      if (w.type === 'slider') {
        // Flame styling needs to manually catch up
        if (w.value !== undefined && w._lastDrawValue !== w.value) {
          w._lastDrawValue = w.value;
          changed = true;
        }
      }
    }

    if (changed) {
      this._needsRedraw = true;
    }
  }

  draw() {
    this.syncWidgetValues();
    // OPTIMIZATION: Early exit if no redraw needed
    if (!this._needsRedraw) return;
    this._needsRedraw = false;
    this._needsUpload = true; // Signal that we have a new texture to upload

    // Safety: If overlay is closed, clear hover
    if (!this._overlay) {
      this._hoverOverlayWidget = null;
    }

    let ctx = this._ctx;
    let w = this._canvas.width;
    let h = this._canvas.height;

    ctx.clearRect(0, 0, w, h);

    if (!this._isPopupHUD) {
      // BG
      ctx.fillStyle = '#202020';
      if (this._isMiniHUD) ctx.fillStyle = 'rgba(32,32,32,0.95)';
      ctx.fillRect(0, 0, w, h);

      // Draw Version Info (Debug)
      if (!this._isMiniHUD) {
        ctx.fillStyle = '#666';
        ctx.font = '16px sans-serif';
        ctx.textAlign = 'right';
        const vText = `SculptXR ${VERSION}`;
        ctx.fillText(vText, w - 10, 24);

        const buildDesc = "Voxel Slowdown Debugging";
        ctx.font = '12px sans-serif';
        ctx.fillText(buildDesc, w - 10, 42);
        ctx.textAlign = 'left';
      }
    }


    // --- DRAW HEADERS / TABS (FIRST - TO BE COVERED SROLLING) ---
    if (!this._isMiniHUD && !this._isPopupHUD) {
      // Header Background
      ctx.fillStyle = '#202020';
      ctx.fillRect(0, 0, w, HEADER_HEIGHT);
      // Bottom Border
      ctx.fillStyle = '#444';
      ctx.fillRect(0, HEADER_HEIGHT - 2, w, 2);

      const row1 = GLOBAL_TABS.slice(0, 3);
      const row2 = GLOBAL_TABS.slice(3, 6);
      const row3 = GLOBAL_TABS.slice(6);

      ctx.textAlign = 'center';
      ctx.font = '32px sans-serif';

      const drawRow = (row, rowIndex) => {
        const rW = w / row.length;
        const y = rowIndex * TAB_HEIGHT;
        row.forEach((t, i) => {
          const x = i * rW;
          const isActive = (t === this._viewMode);
          const isHovered = (t === this._hoverTab);

          // Minimal Styling
          ctx.fillStyle = isActive ? '#eee' : '#111';
          ctx.fillRect(x, y, rW, TAB_HEIGHT);

          // Hover Highlight
          if (isHovered) {
            ctx.fillStyle = '#333';
            ctx.fillRect(x, y, rW, TAB_HEIGHT);
          }

          ctx.strokeStyle = (isHovered) ? '#aaa' : '#333';
          ctx.lineWidth = (isHovered) ? 4 : 1;
          ctx.strokeRect(x, y, rW, TAB_HEIGHT);

          ctx.fillStyle = isActive ? '#000' : '#888';
          ctx.fillText(t, x + rW / 2, y + TAB_HEIGHT / 2 + 8);
        });
      };

      drawRow(row1, 0);
      drawRow(row2, 1);
      drawRow(row3, 2);
    }

    // --- DRAW WIDGETS ---
    // --- DRAW WIDGETS ---
    let widgets = [];
    if (!this._isPopupHUD) {
      widgets = this._getWidgets();
    }
    const mesh = this._main ? this._main.getMesh() : null;
    let activeTool = -1;
    if (this._main && this._main.getSculptManager) activeTool = this._main.getSculptManager().getToolIndex();

    // Clip to Widget Area (Prevent Header Overdraw)
    if (!this._isMiniHUD) {
      ctx.save();
      ctx.beginPath();
      // FIX: Allow slight overlap for Section Header highlight (startY - 4)
      ctx.rect(0, HEADER_HEIGHT - 4, w, h - HEADER_HEIGHT + 4);
      ctx.clip();
    } else {
      ctx.save();
    }

    for (let wid of widgets) {
      if (wid.disabled) ctx.fillStyle = '#222';

      // 1. SECTION HEADERS
      if (wid.type === 'section_header') {
        // Minimal Desktop-Style Section Header
        ctx.fillStyle = '#111';
        ctx.fillRect(wid.x, wid.y, wid.w, wid.h);

        // Arrow (Simple Text)
        const isOpen = this._sectionStates[wid.label];
        ctx.fillStyle = '#888';
        ctx.font = 'bold 30px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(isOpen ? 'v' : '>', wid.x + 20, wid.y + wid.h / 2 + 10);

        ctx.font = 'bold 36px sans-serif';
        ctx.fillStyle = '#eee';
        ctx.fillText(wid.label, wid.x + 60, wid.y + wid.h / 2 + 10);

        // Divider
        ctx.fillStyle = '#444';
        ctx.fillRect(wid.x, wid.y + wid.h - 2, wid.w, 2);

      }
      // 2. INFO / LABELS
      else if (wid.type === 'info') {
        ctx.fillStyle = '#888';
        ctx.font = 'italic 24px sans-serif';
        ctx.textAlign = wid.textAlign || 'left';
        ctx.fillText(wid.label, wid.x, wid.y + 24);
      }
      else {
        // GENERIC WIDGET HANDLING (Slider, Checkbox, Combobox, Button, ColorPicker)

        // Determine State (Global 'isActive' for this widget)
        let isActive = false;
        if (typeof wid.id === 'number') isActive = (wid.id === activeTool);
        if (wid.id === 'dynamic' && mesh) isActive = mesh.isDynamic;
        if (wid.id === 'wireframe' && mesh) isActive = mesh.getShowWireframe();
        if (wid.id === 'flat' && mesh) isActive = mesh.getFlatShading();
        if (wid.id === 'symmetry' && this._main.getSculptManager()) isActive = this._main.getSculptManager().getSymmetry();

        // Explicit Active State (e.g. Voxel Buttons)
        if (wid.data && wid.data.active) isActive = true;

        // Paint Toggles
        if (wid.id === 'pick_color') {
          const tool = this._main.getSculptManager().getTool(Enums.Tools.PAINT);
          isActive = tool ? tool._pickColor : false;
        }
        if (wid.id === 'write_albedo' || wid.id === 'write_roughness' || wid.id === 'write_metalness') {
          const tool = this._main.getSculptManager().getTool(Enums.Tools.PAINT);
          if (tool) {
            if (wid.id === 'write_albedo') isActive = tool._writeAlbedo;
            if (wid.id === 'write_roughness') isActive = tool._writeRoughness;
            if (wid.id === 'write_metalness') isActive = tool._writeMetalness;
          }
        }

        const isHovered = (this._hoverWidget === wid);

        // Base Styles
        ctx.textAlign = 'center';
        ctx.font = '24px sans-serif';

        // --- SLIDER (Main Panel) ---
        if (wid.type === 'slider') {
          // Flame Style Polish: Larger Text, Thin Bar at Bottom

          // 1. Text Info (Larger)
          // 1. Text Info (Larger)
          // 1. Text Info (Larger)
          ctx.font = '24px sans-serif';
          ctx.fillStyle = '#ccc';
          ctx.textAlign = 'left';
          // Move text up a bit or center it in the space above bar
          ctx.fillText(`${wid.label}`, wid.x + 2, wid.y + 28);

          let valStr = (wid.value !== undefined && wid.value !== null) ? wid.value.toFixed(wid.precision || 2) : 'ERR';
          ctx.textAlign = 'right';
          ctx.fillStyle = '#fff';
          ctx.fillText(valStr, wid.x + wid.w - 2, wid.y + 28);

          // 2. Slider Track (Thin, Bottom)
          const barH = 6;
          const barY = wid.y + wid.h - barH - 4; // 4px padding from bottom
          ctx.fillStyle = '#222';
          ctx.fillRect(wid.x + 2, barY, wid.w - 4, barH);

          // 3. Slider Fill (Value)
          let t = wid.value;
          if (isFinite(wid.min) && isFinite(wid.max)) {
            t = (wid.value - wid.min) / (wid.max - wid.min);
          }
          t = Math.max(0, Math.min(1, t));

          const fillW = (wid.w - 4) * t;
          ctx.fillStyle = '#00D0FF'; // Active Color
          ctx.fillRect(wid.x + 2, barY, fillW, barH);

          // Marker Line
          ctx.fillStyle = '#fff';
          ctx.fillRect(wid.x + 2 + fillW - 2, barY - 2, 4, barH + 4);

        }
          // --- CHECKBOX / TOGGLE ---
        else if (wid.type === 'checkbox' || wid.type === 'toggle') {
          // Solid Background, No Border
          ctx.fillStyle = wid.disabled ? '#2a2a2a' : (isActive ? '#444' : '#333');
          ctx.fillRect(wid.x, wid.y, wid.w, wid.h);

          ctx.fillStyle = wid.disabled ? '#555' : 'white';
          ctx.textAlign = 'left';
          ctx.font = '24px sans-serif';
          ctx.fillText(wid.label, wid.x + 20, wid.y + wid.h / 2 + 10);

          const checkW = 40;
          const checkX = wid.x + wid.w - checkW - 10;
          const checkY = wid.y + (wid.h - checkW) / 2;

          // Checkbox Frame
          ctx.fillStyle = '#111';
          ctx.fillRect(checkX, checkY, checkW, checkW);

          if (wid.value) {
            ctx.strokeStyle = '#00D0FF';
            ctx.lineWidth = 4;
            ctx.beginPath();
            const pad = 8;
            ctx.moveTo(checkX + pad, checkY + checkW * 0.5);
            ctx.lineTo(checkX + checkW * 0.4, checkY + checkW - pad);
            ctx.lineTo(checkX + checkW - pad, checkY + pad);
            ctx.stroke();
          }
        }
          // --- COMBOBOX ---
        else if (wid.type === 'combobox') {
          // Solid Background, No Border
          ctx.fillStyle = isHovered ? '#444' : '#333';
          ctx.fillRect(wid.x, wid.y, wid.w, wid.h);

          let displayLabel = wid.label;
          if (wid.options) {
            const opt = wid.options.find(o => o.id === wid.value || o === wid.value);
            if (opt) displayLabel = opt.label || opt;
          } else {
            // Environment
            if (wid.id === 'environment') {
              const ShaderPBR = Shader[Enums.Shader.PBR];
              if (ShaderPBR && ShaderPBR.environments && ShaderPBR.environments[ShaderPBR.idEnv]) {
                displayLabel = ShaderPBR.environments[ShaderPBR.idEnv].name;
              }
            }
            // Matcap
            else if (wid.id === 'matcap') {
              const ShaderMatcap = Shader[Enums.Shader.MATCAP];
              if (mesh && ShaderMatcap && ShaderMatcap.matcaps) {
                const matId = mesh.getMatcap();
                if (ShaderMatcap.matcaps[matId]) displayLabel = ShaderMatcap.matcaps[matId].name;
              }
            }
          }

          ctx.textAlign = 'left';
          ctx.font = '24px sans-serif';
          ctx.fillStyle = 'white';
          ctx.fillText(displayLabel, wid.x + 20, wid.y + wid.h / 2 + 10);

          ctx.textAlign = 'right';
          ctx.fillText('▼', wid.x + wid.w - 20, wid.y + wid.h / 2 + 10);
        }
          // --- COLOR PICKER EMBEDDED ---
        else if (wid.type === 'colorpicker_embedded') {
          this._drawEmbeddedColorPicker(ctx, wid);
        }
          // --- GENERIC BUTTON ---
        else if (wid.type === 'button') {
          ctx.fillStyle = isActive ? '#00A040' : '#333';
          if (wid.disabled) ctx.fillStyle = '#222';
          ctx.fillRect(wid.x, wid.y, wid.w, wid.h);

          let textColor = wid.disabled ? '#555' : 'white';
          if (wid.data && wid.data.tint && !wid.disabled) {
            textColor = wid.data.tint;
          }
          ctx.fillStyle = textColor;
          ctx.textAlign = 'center';
          ctx.font = '24px sans-serif';
          ctx.fillText(wid.label || '', wid.x + wid.w / 2, wid.y + wid.h / 2 + 10);
        }
      } // END ELSE (Generic Widgets)

      // --- GENERIC HOVER HIGHLIGHT (For ALL widgets, drawn LAST so it's ON TOP) ---
      const isHovered = (this._hoverWidget && this._hoverWidget.id === wid.id);
      if (isHovered && wid.type !== 'info') {
        const INSET = 2; // Reduced from 3
        ctx.strokeStyle = '#dfdfdf'; // Brighter Gray
        ctx.lineWidth = 4;           // Reduced from 6
        ctx.strokeRect(wid.x + INSET, wid.y + INSET, wid.w - INSET * 2, wid.h - INSET * 2);
      }
    }

    ctx.restore(); // End Clipping




    if (!this._isPopupHUD) {
      ctx.strokeStyle = '#00D0FF';
      ctx.lineWidth = 15;
      ctx.strokeRect(0, 0, w, h);

      // --- DRAW SCROLLBAR if needed ---
      if (this._viewMode === 'SIDEBAR' && this._maxScroll > 0) {
        // Draw Scroll Track
        const trackW = 40; // Increased width
        const trackX = w - trackW;
        const trackY = HEADER_HEIGHT;
        const trackH = h - HEADER_HEIGHT;

        ctx.fillStyle = '#111';
        ctx.fillRect(trackX, trackY, trackW, trackH);

        // Draw Scroll Thumb
        // Thumb Size proportional to content
        const contentH = trackH + this._maxScroll;
        const thumbH = Math.max(50, (trackH / contentH) * trackH);
        const thumbY = trackY + (this._scrollOffset / this._maxScroll) * (trackH - thumbH);

        // Draw Scrollbar visual
        ctx.fillStyle = '#666';
        if (this._isDraggingScrollbar) ctx.fillStyle = '#aaa'; // Highlight dragging
        ctx.fillRect(trackX + 2, thumbY, trackW - 4, thumbH);
      }
    }

    // --- DRAW OVERLAYS ---
    if (this._overlay) {
      ctx.save();

      const pivot = this._getOverlayPivot();
      ctx.translate(pivot.x, pivot.y);
      ctx.scale(OVERLAY_SCALE, OVERLAY_SCALE);
      ctx.translate(-pivot.x, -pivot.y);

      this._drawOverlay(ctx, w, h);
      ctx.restore();
    }

    if (this._activeCombobox) {
      ctx.save();

      // Apply scale ONLY if we are in an Overlay (Main Panel is unscaled)
      if (this._overlay) {
        const pivot = this._getOverlayPivot();
        ctx.translate(pivot.x, pivot.y);
        ctx.scale(OVERLAY_SCALE, OVERLAY_SCALE);
        ctx.translate(-pivot.x, -pivot.y);
      }

      this._drawActiveCombobox(ctx);
      ctx.restore();
    }

    // --- DRAW HUD LOG ---
    if (this._logLines && this._logLines.length > 0) {
      ctx.save();
      ctx.textAlign = 'left';
      ctx.font = 'bold 24px monospace';

      // Bottom left corner
      const startX = 20;
      let currentY = h - 20 - (this._logLines.length * 30);

      // Background dimming for readability
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(startX - 10, currentY - 30, 800, (this._logLines.length * 30) + 40);

      const now = performance.now();
      for (let i = this._logLines.length - 1; i >= 0; i--) {
        const line = this._logLines[i];
        if (now - line.time > 5000) {
          this._logLines.splice(i, 1);
          this._needsRedraw = true;
          continue;
        }

        ctx.fillStyle = line.color || '#fff';
        ctx.fillText(line.text, startX, currentY);
        currentY += 30;
      }
      ctx.restore();
    }
  }

  printLog(str, color = '#00ff00') {
    const lines = String(str).split('\n');
    const now = performance.now();
    for (let l of lines) {
      if (!l.trim()) continue;
      this._logLines.push({ text: l, color: color, time: now });
    }
    // Keep max 2 lines for the VR HUD
    if (this._logLines.length > 2) {
      this._logLines = this._logLines.slice(this._logLines.length - 2);
    }
    this._needsRedraw = true;
    this.draw();
  }

  _drawOverlay(ctx, w, h) {
    if (this._overlay !== 'menu') {
      ctx.fillStyle = OVERLAY_BG;
      ctx.fillRect(0, 0, w, h);

      ctx.fillStyle = '#222';
      ctx.fillRect(OVERLAY_X, OVERLAY_Y, OVERLAY_W, OVERLAY_H);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 4;
      ctx.strokeRect(OVERLAY_X, OVERLAY_Y, OVERLAY_W, OVERLAY_H);

      const closeSize = 60;
      ctx.fillStyle = '#c00';
      ctx.fillRect(OVERLAY_X + OVERLAY_W - closeSize, OVERLAY_Y, closeSize, closeSize);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 40px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('X', OVERLAY_X + OVERLAY_W - closeSize / 2, OVERLAY_Y + 45);

      ctx.textAlign = 'left';
      ctx.fillText(this._overlayData.title || this._overlay, OVERLAY_X + 20, OVERLAY_Y + 50);
    }

    // Draw OVERLAY if active
    if (this._overlay === 'menu' && this._overlayData) {

      // SCALING START
      const { x, y, w: mw, h: mh, widgets } = this._overlayData;

      // Dimmer / Background blocker for Tool Picker
      if (this._overlayData.isToolPicker) {
        // REMOVED: Background panel removed to prevent layout and alpha issues. Buttons float directly.
      }

      // Menu Box
      if (!this._overlayData.isToolPicker) {
        ctx.fillStyle = this.styles.overlayMenuBg;
        ctx.fillRect(x, y, mw, mh);

        ctx.strokeStyle = this.styles.overlayMenuBorder;
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, mw, mh);
      }

      // Draw Menu Widgets
      widgets.forEach(wid => {
        const wx = x + wid.x;
        const wy = y + wid.y;

        const isHover = (this._hoverOverlayWidget && this._hoverOverlayWidget.id === wid.id);

        if (this._overlayData.isToolPicker && isHover && window.screenLog && Math.random() < 0.05) {
          // window.screenLog(`[Draw] Hovering: ${wid.id}`, 'cyan'); // Debugging removed here
        }

        // Hover Background (Generic)
        if (isHover) {
          ctx.fillStyle = this.styles.colorWidgetHover;
          ctx.fillRect(wx, wy, wid.w, wid.h);
        }

        ctx.textAlign = 'left';

        // NOTE: Widgets in overlay come from GuiVRXXX files which hardcode size?
        // NO, GuiFiles.js returns { w: 800, h: ..., widgets: [...] }
        // If we scaled OVERLAY_W, we might need to rely on the *generators* or scale contexts.
        // But here we are drawing them.
        // Wait, the WIDGETS inside `data.widgets` have `x, y, w, h`.
        // If those are hardcoded 800-based, scaling the box won't scale the buttons!
        // We MUST scale the widgets on the fly OR update the generators.
        // Scaling on the fly during draw is easier for now to satisfy "Scale by 20%".
        // But `_updateHover` also uses these coordinates for hit testing.
        if (wid.header) {
          ctx.font = this.styles.fontOverlayHeader;
          ctx.fillStyle = '#aaa';
          ctx.fillText(wid.label, wx + 5, wy + wid.h - 10);
          // Separator line
          ctx.strokeStyle = this.styles.overlayMenuBorder;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(wx, wy + wid.h - 5);
          ctx.lineTo(wx + wid.w, wy + wid.h - 5);
          ctx.stroke();
        } else if (wid.type === 'info') {
          ctx.fillStyle = '#bbb';
          ctx.font = this.styles.fontOverlay;
          ctx.textAlign = wid.textAlign || 'left';
          ctx.fillText(wid.label, wx + (wid.textAlign === 'center' ? 0 : 5), wy + wid.h / 2 + 6);
        } else if (wid.type === 'checkbox') {
          // Checkbox logic - Solid BG
          ctx.fillStyle = isHover ? '#444' : '#333';
          ctx.fillRect(wx, wy, wid.w, wid.h);

          const boxSize = 24;
          const boxX = wx + wid.w - boxSize - 5;
          const boxY = wy + (wid.h - boxSize) / 2;

          ctx.fillStyle = '#111';
          ctx.fillRect(boxX, boxY, boxSize, boxSize);

          if (wid.value) {
            ctx.fillStyle = '#0f0'; // Checkmark
            ctx.fillRect(boxX + 4, boxY + 4, boxSize - 8, boxSize - 8);
          }

          ctx.font = this.styles.fontOverlay;
          ctx.fillStyle = '#ddd';
          ctx.textAlign = 'left';
          ctx.fillText(wid.label, wx + 5, wy + wid.h / 2 + 6);

        } else if (wid.type === 'slider') {
          // Flame Style Overlay Slider Polish

          // 1. Text Info (Larger)
          // 1. Text Info (Larger)
          // 1. Text Info (Larger)
          ctx.font = this.styles.fontOverlay;
          ctx.textAlign = 'left';
          ctx.fillStyle = '#ddd';
          ctx.fillText(wid.label, wx + 2, wy + 28);

          // Value
          let nVal = wid.value;
          let disp = nVal;
          // IMPORTANT: If w.value is ALREADY absolute (e.g. > 1.0), do NOT remap it!
          // We check if value looks un-normalized or if min/max exist
          if (wid.min !== undefined && wid.max !== undefined && nVal <= 1.0 && nVal >= 0.0) {
            disp = wid.min + nVal * (wid.max - wid.min);
          } else {
            disp = nVal;
          }

          ctx.textAlign = 'right';
          ctx.fillStyle = '#aaa';
          const precision = wid.precision !== undefined ? wid.precision : 2;
          ctx.fillText(disp.toFixed(precision), wx + wid.w - 2, wy + 28);

          // 2. Slider Track (Thin, Bottom)
          const barH = 6;
          const barY = wy + wid.h - barH - 4;
          ctx.fillStyle = '#111';
          ctx.fillRect(wx + 2, barY, wid.w - 4, barH); // Full Width Background

          // 3. Slider Fill
          // Calculate normalized ratio for the visual track
          let tRatio = wid.value;
          if (wid.min !== undefined && wid.max !== undefined && wid.value > 1.0) {
            tRatio = (wid.value - wid.min) / (wid.max - wid.min);
          }
          const knobX = (wid.w - 4) * Math.max(0, Math.min(1, tRatio)); 

          ctx.fillStyle = '#888';
          ctx.fillRect(wx + 2, barY, knobX, barH);

          // Marker
          ctx.fillStyle = '#ccc';
          ctx.fillRect(wx + 2 + knobX - 2, barY - 2, 4, barH + 4);

        } else if (wid.type === 'button') {
          const isActive = wid.data && wid.data.active;

          ctx.fillStyle = isActive ? '#00A030' : (isHover ? '#555' : '#333');

          if (wid.noBg && !isHover && !isActive) {
            // Main menu default transparent button
            ctx.strokeStyle = '#444';
            ctx.strokeRect(wx, wy, wid.w, wid.h);
          } else {
            // Fill background
            ctx.fillRect(wx, wy, wid.w, wid.h);

            // Draw hover border
            if (isHover) {
              const INSET = 2;
              ctx.strokeStyle = '#fff';
              ctx.lineWidth = 4;
              ctx.strokeRect(wx + INSET, wy + INSET, wid.w - INSET * 2, wid.h - INSET * 2);
              ctx.lineWidth = 1; // Reset
            } else if (isActive) {
              ctx.lineWidth = 1;
              ctx.strokeStyle = '#00f040';
              // Inset by 0.5 for crisp 1px inner border
              ctx.strokeRect(wx + 0.5, wy + 0.5, wid.w - 1, wid.h - 1);
            } else {
              ctx.lineWidth = 1;
              ctx.strokeStyle = '#222'; // Darker subtle separator instead of #444
              ctx.strokeRect(wx + 0.5, wy + 0.5, wid.w - 1, wid.h - 1);
            }
          }

          let textColor = '#eee'; // Strict white/gray text instead of cyan for active
          if (wid.data && wid.data.tint) {
            textColor = wid.data.tint;
          }
          if (isActive) {
            textColor = '#fff';
          }
          ctx.fillStyle = textColor; 
          ctx.textAlign = 'center';
          ctx.font = this.styles.fontOverlay;
          ctx.fillText(wid.label, wx + wid.w / 2, wy + wid.h / 2 + 6);

        } else if (wid.type === 'combobox') {
          ctx.fillStyle = isHover ? '#444' : '#333';
          ctx.fillRect(wx, wy, wid.w, wid.h);

          ctx.font = this.styles.fontOverlay;
          ctx.fillStyle = '#ddd';
          ctx.textAlign = 'left';
          ctx.fillText(wid.label, wx + 10, wy + wid.h / 2 + 6);

          let valLabel = wid.value;
          if (wid.options) {
            const opt = wid.options.find(o => o.id === wid.value);
            if (opt) valLabel = opt.label;
          }

          ctx.textAlign = 'right';
          ctx.fillStyle = '#fff';
          ctx.fillText(valLabel, wx + wid.w - 30, wy + wid.h / 2 + 6);

          // Triangle
          ctx.beginPath();
          ctx.moveTo(wx + wid.w - 20, wy + wid.h / 2 - 5);
          ctx.lineTo(wx + wid.w - 10, wy + wid.h / 2 - 5);
          ctx.lineTo(wx + wid.w - 15, wy + wid.h / 2 + 5);
          ctx.fill();

          // Combobox hover border
          if (isHover) {
            const INSET = 2;
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 4;
            ctx.strokeRect(wx + INSET, wy + INSET, wid.w - INSET * 2, wid.h - INSET * 2);
            ctx.lineWidth = 1;
          }
        }
      });

      // No restore needed (caller handles it)
      return;
    }

    if (this._overlay === 'combobox') {
      this._drawCombobox(ctx);
    } else if (this._overlay === 'colorpicker') {
      this._drawColorPicker(ctx);
    }
    // No restore needed (caller handles it)
  }

  _drawCombobox(ctx) {
    const data = this._overlayData;
    if (!data || !data.options) return;

    // Legacy Full-Screen Overlay Style
    const itemHeight = 80;
    const startX = (this._canvas.width - 400) / 2; // Centered-ish or fixed
    const startY = OVERLAY_Y + 100; // Match _handleComboboxInteract

    const listH = data.options.length * itemHeight;

    // Background
    ctx.fillStyle = '#222';
    ctx.fillRect(startX, startY, 400, listH);

    // Border
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 2;
    ctx.strokeRect(startX, startY, 400, listH);

    // Items
    ctx.textAlign = 'center';
    ctx.font = '30px sans-serif';

    // _cursor.x and _cursor.y are actually 0-1 UV coordinates! We need to map them back to canvas pixels
    // or compare using the mapped coordinates. Actually, according to _handleDropdownInteract,
    // input is transformed if overlay is active, or we just map UV back to canvas.
    // wait, where are cursor pixels derived?
    const pw = this._canvas.width;
    const ph = this._canvas.height;

    // In _handleDropdownInteract, cx and cy are passed in as absolute pixel coordinates from _handleWidgetClick -> onInteract.
    // BUT the stored this._cursor.x and this._cursor.y are set via setCursor(u, v) in GuiXR.js,
    // which DOES store them as u * width and v * height!
    //    setCursor(u, v) { this._cursor.x = u * this._canvas.width; ... }
    // Let's verify startX and startY.
    const cx = this._cursor.x;
    const cy = this._cursor.y;

    // Is the cursor bounded by the overlay popup?
    const pivot = this._getOverlayPivot();
    const invScale = 1 / OVERLAY_SCALE;

    // We must transform the cursor from canvas pixels into the scaled Overlay coordinate system!
    const localCursorX = (cx - pivot.x) * invScale + pivot.x;
    const localCursorY = (cy - pivot.y) * invScale + pivot.y;

    data.options.forEach((opt, i) => {
      const y = startY + i * itemHeight;
      const isHovered = (localCursorX >= startX && localCursorX <= startX + 400 && localCursorY >= y && localCursorY < y + itemHeight);

      // Highlight Background
      if (isHovered) {
        ctx.fillStyle = '#444';
        ctx.fillRect(startX, y, 400, itemHeight);
      }

      ctx.fillStyle = isHovered ? '#fff' : '#aaa';
      ctx.fillText(opt.label, startX + 200, y + itemHeight / 2 + 10);

      // Separator line
      if (i > 0) {
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(startX, y);
        ctx.lineTo(startX + 400, y);
        ctx.stroke();
        ctx.strokeStyle = '#555';
      }
    });
  }


  _drawColorPicker(ctx) {
    const data = this._overlayData;
    const startX = OVERLAY_X + 40;
    const startY = OVERLAY_Y + 100;
    const svSize = 500;

    // 1. SV Square
    // We need to draw a gradient. Canvas createLinearGradient is fast.
    // Horizontal: White -> Pure Color (Sat)
    // Vertical: Black -> Transparent (Val) handles the darkness?
    // standard SV square:
    // Top-Left: White (S=0, V=1)  Top-Right: HueColor (S=1, V=1)
    // Bottom-Left: Black (S=0, V=0) Bottom-Right: Black (S=1, V=0)

    // Easier: Draw S-gradient horizontal, then overlay V-gradient vertical (black transparent to opaque black)

    // Base Color from Hue
    const baseRgb = Utils.hsv2rgb(data.hue, 1, 1);
    const cssBase = `rgb(${baseRgb[0] * 255}, ${baseRgb[1] * 255}, ${baseRgb[2] * 255})`;

    // Saturation Gradient (Left to Right: White to Base)
    const grdS = ctx.createLinearGradient(startX, startY, startX + svSize, startY);
    grdS.addColorStop(0, 'white');
    grdS.addColorStop(1, cssBase);
    ctx.fillStyle = grdS;
    ctx.fillRect(startX, startY, svSize, svSize);

    // Value Gradient (Top to Bottom: Transparent to Black)
    // Wait, V=1 is Top (Color), V=0 is Bottom (Black)
    const grdV = ctx.createLinearGradient(startX, startY, startX, startY + svSize);
    grdV.addColorStop(0, 'rgba(0,0,0,0)');
    grdV.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = grdV;
    ctx.fillRect(startX, startY, svSize, svSize);

    // Cursor for SV
    const cx = startX + data.sat * svSize;
    const cy = startY + (1.0 - data.val) * svSize;
    ctx.strokeStyle = (data.val < 0.5) ? 'white' : 'black';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 10, 0, Math.PI * 2);
    ctx.stroke();

    // 2. Hue Strip
    const hueX = startX + svSize + 40;
    const hueW = 80;
    const hueH = svSize;
    const grdH = ctx.createLinearGradient(hueX, startY, hueX, startY + hueH);
    grdH.addColorStop(0.00, '#ff0000');
    grdH.addColorStop(0.17, '#ffff00');
    grdH.addColorStop(0.33, '#00ff00');
    grdH.addColorStop(0.50, '#00ffff');
    grdH.addColorStop(0.67, '#0000ff');
    grdH.addColorStop(0.83, '#ff00ff');
    grdH.addColorStop(1.00, '#ff0000');
    ctx.fillStyle = grdH;
    ctx.fillRect(hueX, startY, hueW, hueH);

    // Hue Cursor
    const hcy = startY + data.hue * hueH;
    ctx.fillStyle = 'white';
    ctx.fillRect(hueX - 5, hcy - 5, hueW + 10, 10);
    ctx.strokeStyle = 'black';
    ctx.strokeRect(hueX - 5, hcy - 5, hueW + 10, 10);

    // 3. Confirm / Preview
    const btnY = startY + svSize + 40;
    const btnH = 80;
    const btnW = svSize + 40 + hueW;

    // Preview Color
    const finalRgb = Utils.hsv2rgb(data.hue, data.sat, data.val);
    const cssFinal = `rgb(${Math.floor(finalRgb[0] * 255)}, ${Math.floor(finalRgb[1] * 255)}, ${Math.floor(finalRgb[2] * 255)})`;

    ctx.fillStyle = cssFinal;
    ctx.fillRect(startX, btnY, btnW, btnH);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 4;
    ctx.strokeRect(startX, btnY, btnW, btnH);

    ctx.fillStyle = (data.val < 0.5) ? '#fff' : '#000';
    ctx.font = 'bold 30px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText("OK", startX + btnW / 2, btnY + btnH / 2 + 10);
  }

  _handleEmbeddedColorPicker(w) {
    const tool = this._main.getSculptManager().getTool(Enums.Tools.PAINT);
    if (!tool) return;

    const rgb = tool._color;
    const hsv = [0, 0, 0];
    Utils.rgb2hsv(rgb[0], rgb[1], rgb[2], hsv);
    let [h, s, v] = hsv;

    const mx = this._cursor.x;
    const my = this._cursor.y;

    // --- 0. Check FG/BG Swatches and Swap Button (Top Left Corner) ---
    const swatchSize = 40; // Scale up 50%
    const pad = 10;

    // BG Swatch is trailing
    const bgX = w.x + pad + swatchSize * 0.5;
    const bgY = w.y + pad + swatchSize * 0.5;

    // FG Swatch is leading
    const fgX = w.x + pad;
    const fgY = w.y + pad;

    // Swap Button Hitbox (Top Right of Swatches)
    const swapBtnX = fgX + swatchSize + 5;
    const swapBtnY = fgY - 5;
    const swapBtnW = 30;
    const swapBtnH = 30;

    // Eyedropper Button Hitbox (Top Right of Picker)
    const eyeBtnX = w.x + w.w - pad - swatchSize - 5;
    const eyeBtnY = w.y + pad - 5;
    const eyeBtnW = 30;
    const eyeBtnH = 30;

    // Hitbox for the eyedropper
    if (mx >= eyeBtnX && mx <= eyeBtnX + eyeBtnW && my >= eyeBtnY && my <= eyeBtnY + eyeBtnH) {
      const now = performance.now();
      if (!this._lastEyeTime) this._lastEyeTime = 0;
      if (now - this._lastEyeTime > 300) {
        tool._pickColor = !tool._pickColor;
        this._lastEyeTime = now;
        this._needsRedraw = true;
        this.draw();
        this._main.render();
      }
      return;
    }

    // Hitbox for the swap button or the swatch area
    if ((mx >= fgX && mx <= bgX + swatchSize && my >= fgY && my <= bgY + swatchSize) ||
      (mx >= swapBtnX && mx <= swapBtnX + swapBtnW && my >= swapBtnY && my <= swapBtnY + swapBtnH)) {
      if (typeof tool.swapColors === 'function') {
        const now = performance.now();
        if (!this._lastSwapTime) this._lastSwapTime = 0;

        // Debounce swapping by checking time instead of hover exit
        if (now - this._lastSwapTime > 300) {
          tool.swapColors();
          this._lastSwapTime = now;
          this._needsRedraw = true;
          this.draw();
          this._main.render();
        }
      }
      return;
    }

    // Config (MUST MATCH DRAW LOGIC)
    const cx = w.x + w.w * 0.5;
    const cy = w.y + w.h * 0.5 + 20; // Shifted DOWN to make room for big swatches at the top
    // Calc max available radius from center to prevent overflow
    const maxR = Math.min(w.w * 0.5, w.h * 0.5 - 20) - 10; 
    const thickness = 20; // 50% thinner
    const outerRadius = maxR;
    const innerRadius = outerRadius - thickness;

    // Square fits INSIDE innerRadius
    const sqHalf = (innerRadius - 10) / Math.sqrt(2);
    const sqSize = sqHalf * 2;

    const dx = mx - cx;
    const dy = my - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // 1. SV Square Interaction Check
    let inSV = Math.abs(dx) <= sqHalf + 10 && Math.abs(dy) <= sqHalf + 10;

    // 2. Hue Ring Interaction Check
    let inHue = dist >= innerRadius - 10 && dist <= outerRadius + 10;

    // Apply strict interaction lock if dragging
    if (this._activeColorPickerRegion === 'sv') {
      inSV = true;
      inHue = false;
    } else if (this._activeColorPickerRegion === 'hue') {
      inSV = false;
      inHue = true;
    }

    // Priority to SV if both overlap (e.g. at corners)
    if (inSV) {
      this._activeColorPickerRegion = 'sv';
      const cDx = Math.max(-sqHalf, Math.min(sqHalf, dx));
      const cDy = Math.max(-sqHalf, Math.min(sqHalf, dy));

      s = (cDx + sqHalf) / sqSize;
      v = 1.0 - (cDy + sqHalf) / sqSize;

      s = Math.max(0, Math.min(1, s));
      v = Math.max(0, Math.min(1, v));

      const newRgb = Utils.hsv2rgb(h, s, v);
      vec3.copy(tool._color, newRgb);
      this._needsRedraw = true;
      this.draw();
      this._main.render();
      return;
    }

    if (inHue) {
      this._activeColorPickerRegion = 'hue';
      let angle = Math.atan2(dy, dx);
      if (angle < 0) angle += Math.PI * 2;
      h = angle / (Math.PI * 2);

      const newRgb = Utils.hsv2rgb(h, s, v);
      vec3.copy(tool._color, newRgb);
      this._needsRedraw = true;
      this.draw();
      this._main.render();
      return;
    }
  }

  _drawEmbeddedColorPicker(ctx, w) {
    const tool = this._main.getSculptManager().getTool(Enums.Tools.PAINT);
    if (!tool) return;

    // Background
    ctx.fillStyle = '#222';
    ctx.fillRect(w.x, w.y, w.w, w.h);

    const rgb = tool._color;
    const hsv = [0, 0, 0];
    Utils.rgb2hsv(rgb[0], rgb[1], rgb[2], hsv);
    const [hue, s, v] = hsv;

    const x = w.x;
    const y = w.y;

    // --- 1. Geometry Setup ---
    const cx = x + w.w * 0.5;
    const cy = y + w.h * 0.5 + 20; // Shift center down slightly to make room for bigger swatches
    const maxR = Math.min(w.w * 0.5, w.h * 0.5 - 20) - 10; 
    const thickness = 20; // 50% thinner (was ~40)
    const outerRadius = maxR;
    const innerRadius = outerRadius - thickness;

    // Square fits INSIDE innerRadius
    // diag = innerRadius * sqrt(2) / sqrt(2)? No.
    // square half-size = innerRadius / sqrt(2)
    // padding 10
    const sqHalf = (innerRadius - 10) / Math.sqrt(2);
    const sqSize = sqHalf * 2;
    const sqX = cx - sqHalf;
    const sqY = cy - sqHalf;

    // --- 2. Draw Hue Ring ---
    // User reported Pink vs Yellow mismatch -> Reversing gradient to match standard HSV
    // Standard Canvas 'hue' is Red(0) -> Yellow -> Green -> Cyan -> Blue -> Magenta -> Red
    // We want 0 at 3 o'clock or 12 o'clock?
    // Let's use standard order.
    // If we effectively rotate -90, 0 is Top.

    // We'll draw many segments for smooth gradient or use createConicGradient if available (Safari 15+, Chrome 99+)
    // Fallback to segments if conic not supported? Most modern browsers have it.
    // But check for "ctx.createConicGradient".

    if (ctx.createConicGradient) {
      ctx.save();
      ctx.beginPath();
      // Rotate -90 deg so Red is at Top? Or Right?
      // Standard HSV wheel usually has Red at Right (0 deg) or Top (90 deg).
      // Let's keep 0 at Right (Standard Math).
      // But Conic Gradient starts at 3 o'clock by default? No, usually 0 is 3 o'clock.
      // Wait, Conic Gradient starts at 0 (3 o'clock) going CLOCKWISE?
      // Let's test standard: Red->Yellow...
      // If I use the CSS colors above (Red, Magenta, Blue...) that is COUNTER-CLOCKWISE.
      // Standard H is Red(0), Yellow(60), Green(120), Cyan(180), Blue(240), Magenta(300).
      // So Red -> Yellow is increasing angle (Clockwise in Canvas? Y-down).
      // 0 is 3 o'clock.
      // So standard conic:
      // 0: Red
      // 1/6: Yellow
      // 2/6: Green
      // 3/6: Cyan
      // 4/6: Blue
      // 5/6: Magenta
      // 1: Red

      // Re-defining gradient for proper HSV Clockwise (Standard)
      const g2 = ctx.createConicGradient(0, cx, cy);
      g2.addColorStop(0, "red");
      g2.addColorStop(1 / 6, "yellow");
      g2.addColorStop(2 / 6, "lime"); // Green
      g2.addColorStop(3 / 6, "cyan");
      g2.addColorStop(4 / 6, "blue");
      g2.addColorStop(5 / 6, "magenta");
      g2.addColorStop(1, "red");

      ctx.fillStyle = g2;
      ctx.arc(cx, cy, outerRadius, 0, Math.PI * 2);
      ctx.arc(cx, cy, innerRadius, Math.PI * 2, 0, true);
      ctx.fill();
      ctx.restore();
    } else {
      // Fallback or simpler ring
      ctx.beginPath();
      ctx.arc(cx, cy, outerRadius, 0, Math.PI * 2);
      ctx.fillStyle = '#888';
      ctx.fill();
    }

    // --- 3. Sat/Val Square ---
    // Draw Square
    // 2D Gradient for SV
    // Top-Left: White (S=0, V=1)
    // Top-Right: Hue (S=1, V=1)
    // Bottom-Left: Black (S=0, V=0)
    // Bottom-Right: Black (S=1, V=0) -> actually V gradient is vertical.

    // Fill White
    ctx.fillStyle = 'white';
    ctx.fillRect(sqX, sqY, sqSize, sqSize);

    // Horizontal Gradient (White -> Hue)
    const gH = ctx.createLinearGradient(sqX, sqY, sqX + sqSize, sqY);
    gH.addColorStop(0, 'rgba(255,255,255,1)');
    gH.addColorStop(1, `hsl(${hue * 360}, 100%, 50%)`);
    ctx.fillStyle = gH;
    ctx.globalCompositeOperation = 'multiply'; // Multiply to blend? No.
    // Standard SV way: Layer 1: White. Layer 2: Linear-Horz transparent -> Hue. Layer 3: Linear-Vertical Black(0) -> Transparent? No.
    // Better:
    // Base: Hue
    // Overlay 1: Linear-Horz White -> Transparent
    // Overlay 2: Linear-Vert Transparent -> Black

    // Reset Composite
    ctx.globalCompositeOperation = 'source-over';

    // Draw Hue Base
    ctx.fillStyle = `hsl(${hue * 360}, 100%, 50%)`;
    ctx.fillRect(sqX, sqY, sqSize, sqSize);

    // Draw Saturation (White to Transparent) - Actually S goes Left(0) to Right(1).
    // So Left is White (desaturated), Right is Pure Hue.
    const gSat = ctx.createLinearGradient(sqX, sqY, sqX + sqSize, sqY);
    gSat.addColorStop(0, 'white');
    gSat.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gSat;
    ctx.fillRect(sqX, sqY, sqSize, sqSize);

    // Draw Value (Transparent to Black) - Top(1) to Bottom(0).
    // So Top is Transparent (Visible), Bottom is Black.
    const gVal = ctx.createLinearGradient(sqX, sqY, sqX, sqY + sqSize);
    gVal.addColorStop(0, 'rgba(0,0,0,0)');
    gVal.addColorStop(1, 'black');
    ctx.fillStyle = gVal;
    ctx.fillRect(sqX, sqY, sqSize, sqSize);


    // --- 4. Inputs & Interactions ---
    if (this._capturedWidget === w) {
      // Convert mouse coords to local
      // We use GuiXR's _lastInputX/Y relative to canvas?
      // This function is draw(), but let's assume update logic happens here or we use stored input.
      // Actually GuiXR handles input in _handleColorPickerInteract.
      // We should move logic there?
      // Currently `_handleColorPickerInteract` calls this... NO, `_handleEmbeddedColorPicker` handles interact.
      // `_drawEmbeddedColorPicker` assumes state is updated.
    }

    // --- 5. Indicators ---
    // Hue Ring Indicator
    // The hue value `h` is 0 at 3 o'clock and increases clockwise.
    const angle = hue * Math.PI * 2;
    // 0 is Right (Red).
    const rInd = (innerRadius + outerRadius) * 0.5;
    const indX = cx + Math.cos(angle) * rInd;
    const indY = cy + Math.sin(angle) * rInd;

    ctx.beginPath();
    ctx.arc(indX, indY, 6, 0, Math.PI * 2);
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = `hsl(${hue * 360}, 100%, 50%)`;
    ctx.fill();

    const svX = sqX + s * sqSize; // saturation
    const svY = sqY + (1 - v) * sqSize; // value

    ctx.beginPath();
    ctx.arc(svX, svY, 6, 0, Math.PI * 2);
    ctx.strokeStyle = (v > 0.5 && s < 0.5) ? 'black' : 'white'; // Contrast check
    ctx.lineWidth = 2;
    ctx.stroke();
    // Replaced solid fill with hollow
    // ctx.fillStyle = (v > 0.5) ? 'black' : 'white';
    // ctx.fill();

    // --- Draw FG/BG Swatches & Swap Button (Top Left) ---
    const swatchSize = 40; // Scale up 50%
    const pad = 10;

    // Background swatch (trailing/offset)
    const bgX = x + pad + swatchSize * 0.5;
    const bgY = y + pad + swatchSize * 0.5;
    ctx.fillStyle = `rgb(${(tool._colorSecondary[0] * 255) | 0}, ${(tool._colorSecondary[1] * 255) | 0}, ${(tool._colorSecondary[2] * 255) | 0})`;
    ctx.fillRect(bgX, bgY, swatchSize, swatchSize);
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 2;
    ctx.strokeRect(bgX, bgY, swatchSize, swatchSize);

    // Foreground swatch (leading/active)
    const fgX = x + pad;
    const fgY = y + pad;
    ctx.fillStyle = `rgb(${(tool._color[0] * 255) | 0}, ${(tool._color[1] * 255) | 0}, ${(tool._color[2] * 255) | 0})`;
    ctx.fillRect(fgX, fgY, swatchSize, swatchSize);
    ctx.strokeStyle = '#0ff';
    ctx.lineWidth = 2;
    ctx.strokeRect(fgX, fgY, swatchSize, swatchSize);

    // Swap Button (Top Right of swatches)
    const swapBtnX = fgX + swatchSize + 5;
    const swapBtnY = fgY - 5;

    // Draw simple swap arrows (aligned)
    ctx.strokeStyle = '#aaa';
    ctx.lineWidth = 2; // Thinner for precise alignment

    // Up-Left Arrow
    ctx.beginPath();
    ctx.moveTo(swapBtnX + 11, swapBtnY + 5); // arrow top horizontal start
    ctx.lineTo(swapBtnX + 5, swapBtnY + 5); // arrow tip
    ctx.lineTo(swapBtnX + 5, swapBtnY + 11); // arrow left vertical end
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(swapBtnX + 5, swapBtnY + 5); // arrow tip
    ctx.lineTo(swapBtnX + 13, swapBtnY + 13); // arrow line down-right
    ctx.stroke();

    // Down-Right Arrow
    ctx.beginPath();
    ctx.moveTo(swapBtnX + 14, swapBtnY + 20); // arrow bottom horizontal start
    ctx.lineTo(swapBtnX + 20, swapBtnY + 20); // arrow tip
    ctx.lineTo(swapBtnX + 20, swapBtnY + 14); // arrow right vertical end
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(swapBtnX + 20, swapBtnY + 20); // arrow tip
    ctx.lineTo(swapBtnX + 12, swapBtnY + 12); // arrow line up-left
    ctx.stroke();

    // --- Draw Eyedropper Button (Top Right) ---
    const eyeBtnX = x + w.w - pad - swatchSize - 5;
    const eyeBtnY = y + pad - 5;

    // Draw Eyedropper Icon (a small pipette)
    ctx.strokeStyle = tool._pickColor ? '#0ff' : '#aaa'; // Highlight if active
    ctx.lineWidth = 2;

    // Base/Bulb
    ctx.beginPath();
    ctx.arc(eyeBtnX + 22, eyeBtnY + 8, 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = tool._pickColor ? '#0ff' : 'transparent';
    ctx.fill();

    // Tube
    ctx.beginPath();
    ctx.moveTo(eyeBtnX + 19, eyeBtnY + 11);
    ctx.lineTo(eyeBtnX + 8, eyeBtnY + 22);
    ctx.lineTo(eyeBtnX + 11, eyeBtnY + 25);
    ctx.lineTo(eyeBtnX + 22, eyeBtnY + 14);
    ctx.stroke();

    // Tip
    ctx.beginPath();
    ctx.moveTo(eyeBtnX + 8, eyeBtnY + 22);
    ctx.lineTo(eyeBtnX + 5, eyeBtnY + 28);
    ctx.lineTo(eyeBtnX + 11, eyeBtnY + 25);
    ctx.stroke();
  }

  setVisibility(val) {
    if (this._isVisible !== val) {
      this._isVisible = val;
      this._needsRedraw = true;
    }
  }

  toggleVisibility() {
    this._isVisible = !this._isVisible;
    this._needsRedraw = true;
  }

  update() {
    // 1. Redraw if requested (Input/Hover changes)
    if (this._needsRedraw) {
      if (!this._needsUpload) this._needsUpload = true;
      // DO NOT draw immediately. Defer it to the throttled upload tick.
      this._pendingDraw = true;
      this._needsRedraw = false;
    }

    // 2. Upload Texture to GPU (Throttled)
    this.updateTexture();
  }

  updateTexture() {
    if (!this._needsUpload || !this._texture) return;

    // Force draw if pending (happens right before the throttled upload)
    if (this._pendingDraw) {
      this._needsRedraw = true; // Tell draw() it's allowed
      this.draw();             // This blocks for ~20-50ms max, but only 30 times a sec
      this._pendingDraw = false;
    }

    const t0 = performance.now();
    const gl = this._gl;
    // OPTIMIZATION: Removed gl.getParameter(TEXTURE_BINDING_2D)
    // Just bind and leave it. The next draw call will bind what it needs.
    gl.bindTexture(gl.TEXTURE_2D, this._texture);
    if (this._textureAllocated) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, this._canvas);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this._canvas);
      this._textureAllocated = true;
    }
    // if (prevTex) gl.bindTexture(gl.TEXTURE_2D, prevTex);
    this._needsUpload = false;

    const t1 = performance.now();
    if (t1 - t0 > 5) {
      console.log(`GuiXR Upload: ${(t1 - t0).toFixed(2)}ms`);
    }
  }

  getTexture() { return this._texture; }
  syncToolRadius() {
    var tool = this._main.getSculptManager().getCurrentTool();
    if (tool) tool.setRadius(this._radius * 100);
  }
  getCursorUV() {
    if (!this._cursor.active) return null;
    return { u: this._cursor.x / this._canvas.width, v: this._cursor.y / this._canvas.height };
  }
  updateRadiusWidget(val) {
    this.updateWidget('radius', val);
  }

  updateIntensityWidget(val) {
    this.updateWidget('intensity', val);
  }

  updateWidget(id, val) {
    const widgets = this._getWidgets();
    if (!widgets) return;
    const w = widgets.find(w => w.id === id);
    if (w) {
      w.value = val;
      this._needsRedraw = true;
      this.draw();
    }
  }
  _handleDropdownInteract(cx, cy) {
    // Input Transform for Scale (Only if Overlay is active)
    if (this._overlay) {
      const pivot = this._getOverlayPivot();
      const invScale = 1 / OVERLAY_SCALE;
      cx = (cx - pivot.x) * invScale + pivot.x;
      cy = (cy - pivot.y) * invScale + pivot.y;
    }

    const w = this._activeCombobox;
    const layout = this._getDropdownLayout(w);
    if (!layout) return;

    const { startX, startY, totalW, listH, numCols, rowsPerCol, itemHeight, ox, oy } = layout;

    // Check bounds with totalW
    // SCALE_FIX removed: Input is already transformed to overlay space.

    // Check bounds
    if (cx >= startX && cx <= startX + totalW && cy >= startY && cy <= startY + listH) {
      // Inside List

      const localX = (cx - startX);
      const localY = (cy - startY);

      // Verify Col/Row
      let col = Math.floor(localX / w.w);
      if (col >= numCols) col = numCols - 1;

      let row = Math.floor(localY / itemHeight);

      const index = col * rowsPerCol + row;

      if (w.options && w.options[index]) {
        const opt = w.options[index];
        const val = opt.id !== undefined ? opt.id : index;
        if (w.onSelect) w.onSelect(val);
        this._activeCombobox = null;
        this._needsRedraw = true;
        this.draw();
      }
      return;
    }

    // Check if inside Header (Toggle off)
    // w is the widget
    if (cx >= ox + w.x && cx <= ox + w.x + w.w && cy >= oy + w.y && cy <= oy + w.y + w.h) {
      this._activeCombobox = null;
      this._needsRedraw = true;
      this.draw();
      return;
    }

    // Clicked Outside
    this._activeCombobox = null;
    this._needsRedraw = true;
    this.draw();
  }

  _drawActiveCombobox(ctx) {
    const w = this._activeCombobox;
    const layout = this._getDropdownLayout(w);
    if (!layout) return;

    const { startX, startY, totalW, listH, numCols, rowsPerCol, itemHeight, ox, oy } = layout;

    // Check if we need to flip (draw above)
    // w.y is in Local Overlay Space (after Pivot Scale).
    // _drawActiveCombobox is called AFTER restore(), so it's in Global Canvas Space?
    // WAIT. draw() calls save(), transform(), drawOverlay(), restore().
    // Then checks _activeCombobox and calls _drawActiveCombobox().
    // So _drawActiveCombobox runs in GLOBAL IDENTITY SPACE (0,0 is top-left, unscaled).
    // BUT w.x / w.y are stored in widget-local coords usually relative to Overlay?
    // No, w.x/w.y are computed during layout. They are local to the overlay content.
    // If _drawActiveCombobox runs in Identity Space, we need to apply the SAME Transform!
    // OR we should call it INSIDE the transform block in draw().

    // Let's check draw().
    // If it's outside, w.x/w.y are meaningless without transform.
    // I bet draw() calls it OUTSIDE.
    // If so, we must manually transform w.x/w.y or move the call.
    // Moving the call is safer. I will check draw() in next tool call.
    // FIRST, I will assume it's OUTSIDE and apply transform here?
    // Applying transform manually is annoying (pivot logic).
    // Better to move the call inside draw().

    // For now, I will assume the user has the transform applied or I handle it.
    // Actually, looking at `_drawCombobox` (legacy), it didn't apply transform?
    // Wait, `_drawOverlay` is called INSIDE transform.
    // `_drawCombobox` was called from `_drawOverlay`.

    // `_drawActiveCombobox` is called at the end of `draw()`.
    // Let's check `draw()` again.


    // Shadow

    // Shadow removed

    // Background
    ctx.fillStyle = '#222';
    ctx.fillRect(startX, startY, totalW, listH);

    // Border
    ctx.strokeStyle = '#00D0FF';
    ctx.lineWidth = 2;
    ctx.strokeRect(startX, startY, totalW, listH);

    // Vertical Divider for 2-col
    if (numCols > 1) {
      ctx.beginPath();
      ctx.moveTo(startX + w.w, startY);
      ctx.lineTo(startX + w.w, startY + listH);
      ctx.stroke();
    }

    // Highlight hover
    if (this._cursor.active) {
      // Transform cursor to overlay space (since we are drawing in overlay space, IF active)
      let cx = this._cursor.x;
      let cy = this._cursor.y;

      if (this._overlay) {
        const pivot = this._getOverlayPivot();
        const invScale = 1 / OVERLAY_SCALE;
        cx = (cx - pivot.x) * invScale + pivot.x;
        cy = (cy - pivot.y) * invScale + pivot.y;
      }

      if (!this._logComboHover) this._logComboHover = 0;
      if (this._logComboHover++ % 60 === 0) {
        console.log(`[GuiXR] Combobox Hover - Cursor: ${cx.toFixed(1)},${cy.toFixed(1)} Box: X(${startX}..${startX + totalW}) Y(${startY}..${startY + listH}) overlay: ${!!this._overlay}`);
      }

      // Check bounds
      if (cx >= startX && cx <= startX + totalW && cy >= startY && cy <= startY + listH) {
        // Find Col / Row
        let col = Math.floor((cx - startX) / w.w);
        if (col >= numCols) col = numCols - 1;

        let row = Math.floor((cy - startY) / itemHeight);
        if (row >= rowsPerCol) row = rowsPerCol - 1;

        // Draw rect for that slot
        // Verify index valid?
        const idx = col * rowsPerCol + row;
        if (idx < w.options.length) {
          ctx.fillStyle = '#444';
          ctx.fillRect(startX + col * w.w, startY + row * itemHeight, w.w, itemHeight);
        }
      }
    }

    // Items
    ctx.textAlign = 'left';
    ctx.font = '24px sans-serif';
    ctx.fillStyle = 'white';

    w.options.forEach((opt, i) => {
      let col = 0;
      let row = i;
      if (numCols > 1) {
        col = (i >= rowsPerCol) ? 1 : 0;
        row = i % rowsPerCol; // Should be modulo rowsPerCol
      }

      const y = startY + row * itemHeight;
      const x = startX + col * w.w;

      const label = opt.label || opt;
      ctx.fillText(label, x + 20, y + itemHeight / 2 + 8);
    });
  }

  _getDropdownLayout(w) {
    if (!w || !w.options) return null;

    const itemHeight = 60;

    // 2-Column Logic (Main Menu Only)
    let numCols = 1;
    let rowsPerCol = w.options.length;

    if (!this._isMiniHUD && w.options.length > 10) {
      numCols = 2;
      rowsPerCol = Math.ceil(w.options.length / 2);
    }

    const totalW = w.w * numCols;
    const listH = rowsPerCol * itemHeight;

    const ox = this._overlayData ? this._overlayData.x : 0;
    const oy = this._overlayData ? this._overlayData.y : 0;

    const startX = ox + w.x;
    let startY = oy + w.y + w.h;

    // Smart Positioning (Slide Up if near bottom)
    // Bottom Limit Calculation
    let bottomLimit = this._canvas.height;
    if (this._overlayData) {
      // If we are in an overlay, we should fit WITHIN the overlay usually?
      // Or mainly ensure we don't go off screen bottom?
      // For Overlay Menus (Files, etc), layout is tricky.
      // But anchored comboboxes (Tools) are in Main Panel or Overlay.

      // Let's use Canvas Height as hard limit first.
      // Actually, if Overlay is active, oy + overlayData.h is the menu bottom.
      bottomLimit = oy + this._overlayData.h;
    }

    const mb = 20; // Margin Bottom
    if (startY + listH > bottomLimit - mb) {
      // Shift UP (Ensure it stays visible on narrow canvases, clamp to top if needed)
      startY = Math.max(10, bottomLimit - listH - mb);
    }

    // Safety check for right edge
    if (startX + totalW > this._canvas.width - mb) {
    // Only shift if it's the main menu, MiniHUD uses targetWidth/clamped x anyway
    // But good practice.
    }

    return { startX, startY, totalW, listH, numCols, rowsPerCol, itemHeight, ox, oy };
  }


}


