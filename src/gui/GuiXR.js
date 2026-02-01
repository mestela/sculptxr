import Enums from 'misc/Enums';
import TR from 'gui/GuiTR';
import Export from 'files/Export';
import { saveAs } from 'file-saver';
import Shader from 'render/ShaderLib';
import Utils from 'misc/Utils';
import { vec3 } from 'gl-matrix';

// Modular Imports
import getToolsWidgets from 'gui/vr/GuiVRTools.js';
import getSceneWidgets from 'gui/vr/GuiVRScene.js';
import getRenderingWidgets from 'gui/vr/GuiVRRendering.js';
import getFilesWidgets from 'gui/vr/GuiVRFiles.js';
import getHistoryWidgets from 'gui/vr/GuiVRHistory.js';
import getBackgroundWidgets from 'gui/vr/GuiVRBackground.js';
import getCameraWidgets from 'gui/vr/GuiVRCamera.js';
import getTabletWidgets from 'gui/vr/GuiVRTablet.js';
import getLanguageWidgets from 'gui/vr/GuiVRLanguage.js';
import getExtraUIWidgets from 'gui/vr/GuiVRExtraUI.js';
import getAboutWidgets from 'gui/vr/GuiVRAbout.js';
import getTopologyWidgets from 'gui/vr/GuiVRTopology.js';
import Tablet from 'misc/Tablet';

// Direct access for property setters
import MeshDynamic from 'mesh/dynamic/MeshDynamic';
import Remesh from 'editing/Remesh';
import ShaderBase from 'render/shaders/ShaderBase';
import StateManager from 'states/StateManager';

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
const GLOBAL_TABS = ['Files', 'Scene', 'History', 'Background', 'Camera', 'Tablet pressure', 'Language', 'Extra UI', 'About & Help'];
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
const OVERLAY_W = 800;
const OVERLAY_H = 800;
const OVERLAY_X = (CANVAS_SIZE - OVERLAY_W) / 2;
const OVERLAY_Y = (CANVAS_SIZE - OVERLAY_H) / 2;

class GuiXR {

  constructor(main, canvas) {
    this._main = main;
    this._gl = main._gl;

    if (canvas) {
      this._canvas = canvas;
      this._ctx = canvas.getContext('2d');
    } else {
      this._canvas = document.createElement('canvas');
      this._canvas.width = CANVAS_SIZE;
      this._canvas.height = CANVAS_SIZE;
      this._ctx = this._canvas.getContext('2d');
    }

    this._uiSettings = {
      resolution: 256, // Voxel Resolution
      radius: 1.0 // Voxel Radius
    };

    // Preload Dropper Icon
    this._dropperIcon = new Image();
    this._dropperIcon.src = 'resources/dropper.png';

    this._needsRedraw = true; // Request Canvas Redraw
    this._needsUpload = true; // Request GPU Upload (formerly _needsUpdate)
    this._textureAllocated = false;
    this._activeTab = 'Sculpting & Painting'; // Default section open?
    // Actually if they are collapsible, we need a map of open/closed states.
    this._sectionStates = {
      'Rendering': true,
      'Topology': true,
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
      'Sculpting & Painting': (main) => getToolsWidgets(main, main.getSculptManager().getToolIndex()),
      'Background': getBackgroundWidgets,
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

    setTimeout(() => this.syncToolRadius(), 500);

    // Desktop Preview Toggle (Dev Tool)
    window.addEventListener('keydown', (e) => {
      if (e.shiftKey && e.altKey && e.code === 'KeyV') {
        this.togglePreview();
      }
    });

    this._pendingDraw = false;
  }

  _requestDraw() {
    this._needsRedraw = true;
  }

  // Synchronous Update Loop (CALLED BY SCENE.JS ON XR FRAME)
  update() {
    const start = performance.now();

    // 1. Redraw if requested (Input/Hover changes)
    if (this._needsRedraw) {
      if (!this._needsUpdate) this._needsRedraw = true; // Ensure texture uploads if we draw

      const t0 = performance.now();
      this.draw();
      const t1 = performance.now();

      // Log Draw Time if slow (>4ms)
      if (t1 - t0 > 4 && window.screenLog && this._logThrottle % 60 === 0) {
        console.warn(`GuiXR Draw Slow: ${(t1 - t0).toFixed(2)}ms`);
      }

      this._needsRedraw = false;
    }

    // 2. Upload Texture to GPU (Throttled)
    this.updateTexture();

    const total = performance.now() - start;
    if (total > 8 && window.screenLog && this._logThrottle % 60 === 0) {
      console.warn(`GuiXR Total Update Slow: ${total.toFixed(2)}ms`);
    }
  }

  // Console Helper for Tab Switching
  switchTab(tabName) {
    const tabIdx = GLOBAL_TABS.indexOf(tabName);

    // Check if it's one of our dropdown tabs
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
      if (tabName === 'Files') data = getFilesWidgets(this._main);
      else if (tabName === 'Scene') data = getSceneWidgets(this._main);
      else if (tabName === 'History') data = getHistoryWidgets(this._main);
      else if (tabName === 'Background') data = getBackgroundWidgets(this._main);
      else if (tabName === 'Camera') data = getCameraWidgets(this._main);
      else if (tabName === 'Tablet pressure') data = getTabletWidgets(this._main);
      else if (tabName === 'Language') data = getLanguageWidgets(this._main);
      else if (tabName === 'Extra UI') data = getExtraUIWidgets(this._main);
      else if (tabName === 'About & Help') data = getAboutWidgets(this._main);

      if (data) {
        let overlayX = x;
        // Clamp overlayX
        if (overlayX + data.width > this._canvas.width) {
          overlayX = this._canvas.width - data.width;
        }

        // Determine Y based on which row this tab belongs to
        // Row 1: 0..2 (3 tabs)
        // Row 2: 3..5 (3 tabs)
        // Row 3: 6..8 (3 tabs)
        const rowCount = 3;
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

    console.log("[GuiXR] Desktop Preview Visible (Interactive).");

    // Attach Events
    const mapEventToNormalized = (e) => {
      const rect = this._canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      return { u: x, v: y };
    };

    const onPointerDown = (e) => {
      if (e.button !== 0) return; // Only left click
      e.preventDefault();
      const { u, v } = mapEventToNormalized(e);
      this.setCursor(u, v);
      this.onInteract(u, v, true);
    };
    const onPointerMove = (e) => {
      e.preventDefault();
      const { u, v } = mapEventToNormalized(e);
      this.setCursor(u, v);
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
  refreshToolsWidget() {
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
      return;
    }

    // If overlay is open, hover logic
    if (this._overlay) {
      this._hoverWidget = null; // Clear main widget hover
      this._updateOverlayHover();
      return;
    }

    const cx = this._cursor.x;
    const cy = this._cursor.y;
    // Check Widgets
    const widgets = this._getWidgets();
    let newHover = null;
    for (let wid of widgets) {
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

  _updateOverlayHover() {
    // Only redraw if we change hovered element in the overlay
    if (!this._overlayData || !this._overlayData.widgets) return;

    const cx = this._cursor.x;
    const cy = this._cursor.y;
    // Overlay coords
    const ox = this._overlayData.x;
    const oy = this._overlayData.y;
    const rx = cx - ox;
    const ry = cy - oy;

    let newHover = null;
    for (const w of this._overlayData.widgets) {
      if (rx >= w.x && rx <= w.x + w.w && ry >= w.y && ry <= w.y + w.h) {
        if (!w.disabled && !w.header) {
          newHover = w;
          break;
        }
      }
    }

    // We don't store overlay hover in _hoverWidget (main), but maybe we should?
    // For now let's just use a separate property or assume if we are strictly in overlay mode
    // we just need to know if we need to redraw.
    // Actually GuiXR doesn't seem to store overlay hover explicitly in a property used by draw()
    // except strictly for highlighting?
    // Let's check draw(). draw() just draws.
    // If draw() doesn't highlight overlay buttons, then hover does nothing visually!
    // I recall checking drawOverlay... it didn't seem to highlight buttons on hover?
    // Just checked lines 1558+. It loops widgets.
    // Wait, if overlay buttons don't highlight, then we DON'T need to redraw on hover!
    // I should check if they highlight.
    // Assuming they MIGHT, let's play safe but optimized.

    // If we don't have a property to track hover, draw() can't highlight it.
    // So if draw() has no highlight logic, we can skip update.
    // But let's assume I might add it or it exists (I didn't see it).
    // Let's just return for now to save FPS. Interaction works via Click.
    // If user complains "Buttons don't highlight", I'll add it.
    // BUT cursor moving over overlay is useful?
    // Actually, I'll just remove the unconditional update.
  }

  _getWidgets() {
    const main = this._main;
    const gens = this._widgetGenerators;

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
    const offsetWidgets = widgets.map(w => ({
      ...w,
      y: w.y + currentY - 130 // 130 was original offset
    }));

    return offsetWidgets;
  }

  onInteract(u, v, isPressed) {
    /*
    if (window.screenLog && this._logThrottle++ % 30 === 0) {
      window.screenLog(`Interact: ${u.toFixed(2)},${v.toFixed(2)} Active:${this._cursor.active} Press:${isPressed}`, 'yellow');
    }
    */

    if (!this._cursor.active) return;

    const cx = this._cursor.x;
    const cy = this._cursor.y;

    const now = performance.now();

    // 0. Dropdown Interaction (High Priority)
    if (this._activeCombobox) {
      if (!isPressed) return; // Only interact on press
      if (now - this._inputDebounce < 250) return;
      this._inputDebounce = now;
      this._handleDropdownInteract(cx, cy);
      return;
    }

    // 0. Check Overlay
    if (this._overlay) {
      if (!isPressed) return; // Only interact on press
      if (now - this._inputDebounce < 250) return;
      this._inputDebounce = now;
      this._handleOverlayInteract(cx, cy, isPressed);
      return;
    }

    // 0.5. Active Slider Lock (High Priority)
    // Must run BEFORE !isPressed check (to allow clearing lock on release)
    if (this._activeSlider) {
      if (!isPressed) {
        this._activeSlider = null;
        return;
      }

      const targetWid = this._activeSlider;
      const sliderW = targetWid.w;
      const sliderX = targetWid.x;

      // Calculate normalized value
      let t = (cx - sliderX) / sliderW;
      t = Math.max(0, Math.min(1, t));

      // Map to Min/Max
      let val = t;
      if (isFinite(targetWid.min) && isFinite(targetWid.max)) {
        val = targetWid.min + t * (targetWid.max - targetWid.min);
        if (targetWid.step) {
          const steps = Math.round((val - targetWid.min) / targetWid.step);
          val = targetWid.min + steps * targetWid.step;
        }
      }

      // Update
      if (targetWid.value !== val) {
        targetWid.value = val;
        if (targetWid.onInput) targetWid.onInput(val);
        this._executeAction(targetWid);
        this._needsRedraw = true;
      }
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

    // Dynamic Debounce
    let debounceTime = 250;
    // Faster interaction for continuous controls
    if (targetWid && (targetWid.type === 'slider' || targetWid.type === 'colorpicker_embedded' || targetWid.id === 'roughness' || targetWid.id === 'metallic' || targetWid.type === 'section_header')) {
      if (targetWid.type === 'section_header') debounceTime = 300; // prevent double toggle
      else debounceTime = 16; 
    }

    // Check Tabs
    if (!targetWid && cy < TAB_HEIGHT) debounceTime = 250;

    // Scrollbar Debounce Override
    const canvasW = this._canvas.width;
    const isScrollInteraction = this._isDraggingScrollbar || (cx >= canvasW - 40 && cy > HEADER_HEIGHT);

    if (isScrollInteraction) {
      debounceTime = 0; // Immediate response for scrollbar
    } else {
      // For all other widgets, if we are NOT pressing, we shouldn't consume the debounce timer
      // preventing the subsequent PRESS from registering.
      if (!isPressed) {
        // Special case: we might need "Hover" events for some things? 
        // Currently GuiXR mainly uses Hover for highlights (handled in setCursor/draw) 
        // and Scroll Drag (handled above).
        // So we can largely ignore !isPressed here for debounce purposes.
        return;
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

    // 1. Check Tabs (Header)
    if (isPressed && (this._viewMode === 'SIDEBAR' || GLOBAL_TABS.includes(this._viewMode))) {
      const row1 = GLOBAL_TABS.slice(0, 3);
      const row2 = GLOBAL_TABS.slice(3, 6);
      const row3 = GLOBAL_TABS.slice(6);

      // Row 1
      if (cy < TAB_HEIGHT) {
        const r1W = w / row1.length;
        const idx = Math.floor(cx / r1W);
        if (idx >= 0 && idx < row1.length) this.switchTab(row1[idx]);
        return;
      }
      // Row 2
      if (cy < TAB_HEIGHT * 2) {
        const r2W = w / row2.length;
        const idx = Math.floor(cx / r2W);
        if (idx >= 0 && idx < row2.length) this.switchTab(row2[idx]);
        return;
      }
      // Row 3
      if (cy < TAB_HEIGHT * 3) {
        const r3W = w / row3.length;
        const idx = Math.floor(cx / r3W);
        if (idx >= 0 && idx < row3.length) this.switchTab(row3[idx]);
        return;
      }
    } else {
      // Fallback logic if needed, but above covers all GLOBAL_TABS interaction
      if (cy < HEADER_HEIGHT) {
        // Just reset to sidebar?
        console.log("Clicked header in unknown mode");
        return;
      }
    }


    // 2. Active Slider Lock (Moved to top)

    // 3. Check Widgets
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
    // 4. Background Drag (Content Scrolling) - DISABLED BY USER REQUEST
    // Only Scrollbar (handled above) is allowed for scrolling now.

    // Debug Log for Header Hover (Optional)
    if (this._lastScrollY !== undefined) {
      this._lastScrollY = undefined;
    }
  }

  _handleOverlayInteract(cx, cy, isPressed) {
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
        console.log("[GuiXR] Closing overlay (clicked outside)");
        this.closeOverlay();
        return;
      }

      // Close Button (Top Right)
      const closeSize = 60;
      // Note: This logic assumes close button is always at top-right of the DEFINED overlay box
      if (cx > ox + ow - closeSize && cy < oy + closeSize) {
        console.log("[GuiXR] Closing overlay (close button)");
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
    console.log(`[GuiXR] Combobox Click relY=${relY} index=${index}`);

    if (index >= 0 && index < data.options.length) {
      const opt = data.options[index];
      console.log(`[GuiXR] Selected option ${index}: ${opt.label}`);
      if (data.callback) data.callback(opt.id !== undefined ? opt.id : index);
      this.closeOverlay();
    }
  }

  _handleMenuInteract(cx, cy) {
    const data = this._overlayData;
    if (!data || !data.widgets) return;

    // Relativize coords
    const rx = cx - data.x;
    const ry = cy - data.y;

    // Check click on menu widgets
    for (const w of data.widgets) {
      if (rx >= w.x && rx <= w.x + w.w && ry >= w.y && ry <= w.y + w.h) {
        if (!w.disabled && !w.header) {
          // console.log(`[GuiXR] Menu Click: ${w.id}`);

          if (w.type === 'slider') {
            const val = Math.max(0, Math.min(1, (rx - w.x) / w.w));
            w.value = val;
            this._executeAction(w);
            this._needsRedraw = true;
          } else if (w.type === 'checkbox') {
            w.value = !w.value;
            this._executeAction(w);
            this._needsRedraw = true;
          } else if (w.type === 'button') {
            this._executeAction(w);
            // Close menu on action? 
            // Keep open for specific actions like Undo/Redo or Tools
            const keepOpen = ['undo', 'redo', 'addSphere', 'addCube', 'addCylinder', 'addTorus'].includes(w.id);
            if (!keepOpen) this.closeOverlay();
            else this._needsRedraw = true;
          } else if (w.type === 'combobox') {
            this.openOverlay('combobox', {
              options: w.options,
              callback: (val) => {
                w.value = val;
                this._executeAction(w);
                // We close the overlay automatically when selecting option.
                // If we want to re-open the menu, we'd need to know which menu it was.
                // For now, let's just close it, similar to desktop dropdowns.
              }
            });
            return;
          }
        }
        return;
      }
    }
  }

  _getWidgetValue(tab, id) {
    if (!this._tabWidgets[tab] || !this._tabWidgets[tab].widgets) return undefined;
    const w = this._tabWidgets[tab].widgets.find(w => w.id === id);
    return w ? w.value : undefined;
  }

  _executeAction(w) {
    const main = this._main;
    const id = w.id;

    if (w.type === 'slider') {
      if (id === 'symmetryOffset') {
        const mesh = main.getMesh();
        if (mesh) {
          mesh.setSymmetryOffset(w.value);
          main.render();
        }
      } else if (isFinite(w.min) && isFinite(w.max)) {
        // Generic Min/Max Slider Support
        const mapped = w.min + w.value * (w.max - w.min);
        let val = mapped;
        if (w.step) {
          const steps = Math.round((mapped - w.min) / w.step);
          val = w.min + steps * w.step;
        }

        if (id === 'stack_size') main.getStateManager().setNewMaxStack(Math.round(val));
        else if (id === 'fov') { main.getCamera().setFov(val); main.render(); }
        // Add other generic sliders here
      }
      return;
    }

    if (w.type === 'checkbox') {
      const val = w.value;
      if (id === 'grid') { main._showGrid = val; main.render(); }
      else if (id === 'contour') { main._showContour = val; main.render(); }
      else if (id === 'show_sym') { ShaderBase.showSymmetryLine = val; main.render(); }
      else if (id === 'darken') { ShaderBase.darkenUnselected = val; main.render(); }
      else if (id === 'camera_mode') {
        const mode = val ? Enums.CameraMode.ORTHOGRAPHIC : Enums.CameraMode.PERSPECTIVE;
        main.getCamera().setMode(mode);
        main.render();
      }
      else if (id === 'import_scale') main._autoMatrix = val;
      else if (id === 'import_srgb') main._vertexSRGB = val;
      else if (['export_all', 'export_zbrush', 'export_append'].includes(id)) {
        const guiFiles = (main.getGui && main.getGui()) ? main.getGui()._guiFiles : null;
        if (guiFiles) {
          if (id === 'export_all') guiFiles._exportAll = val;
          else if (id === 'export_zbrush') guiFiles._objColorZbrush = val;
          else if (id === 'export_append') guiFiles._objColorAppended = val;
        }
      }
      return;
    }

    // Files
    if (id === 'import_obj') {
      const fileInput = document.getElementById('fileopen');
      if (fileInput) fileInput.click();
    }
    else if (id === 'export_sgl') {
      const exportAll = this._getWidgetValue('Files', 'export_all');
      const meshes = (exportAll === true) ? main.getMeshes() : main.getSelectedMeshes();
      if (meshes.length) saveAs(Export.exportSGL(meshes, main), 'yourMesh.sgl');
    }
    else if (id === 'export_obj') {
      const exportAll = this._getWidgetValue('Files', 'export_all');
      const colorZbrush = this._getWidgetValue('Files', 'export_zbrush');
      const colorAppend = this._getWidgetValue('Files', 'export_append');
      const meshes = (exportAll === true) ? main.getMeshes() : main.getSelectedMeshes();
      if (meshes.length) saveAs(Export.exportOBJ(meshes, colorZbrush, colorAppend), 'yourMesh.obj');
    }
    else if (id === 'export_ply') {
      const exportAll = this._getWidgetValue('Files', 'export_all');
      const meshes = (exportAll === true) ? main.getMeshes() : main.getSelectedMeshes();
      if (meshes.length) saveAs(Export.exportBinaryPLY(meshes), 'yourMesh.ply');
    }
    else if (id === 'export_stl') {
      const exportAll = this._getWidgetValue('Files', 'export_all');
      const meshes = (exportAll === true) ? main.getMeshes() : main.getSelectedMeshes();
      if (meshes.length) saveAs(Export.exportBinarySTL(meshes), 'yourMesh.stl');
    }
    else if (id === 'go_sketchfab') {
      if (this._main && this._main.getGui() && this._main.getGui().exportSketchfab) {
        this._main.getGui().exportSketchfab();
      }
    }

    if (id === 'undo') { main.getStateManager().undo(); main.render(); }
    else if (id === 'redo') { main.getStateManager().redo(); main.render(); }
    else if (id === 'reset') { if (window.confirm('Reset Scene?')) main.clearScene(); }
    else if (id === 'addSphere') main.addSphere();
    else if (id === 'addCube') main.addCube();
    else if (id === 'addCylinder') main.addCylinder();
    else if (id === 'addTorus') main.addTorus();
    else if (id === 'duplicateSelection') main.duplicateSelection();
    else if (id === 'deleteSelection') main.deleteCurrentSelection();
    else if (id === 'merge') {
      const sel = main.getSelectedMeshes();
      if (sel.length >= 2) {
        const newMesh = Remesh.mergeMeshes(sel, main.getMesh() || sel[0]);
        main.removeMeshes(sel);
        main.getStateManager().pushStateAddRemove(newMesh, sel.slice());
        main.getMeshes().push(newMesh);
        main.setMesh(newMesh);
      }
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
    console.log(`[GuiXR] Opening overlay: ${type}`);
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
      const val = Math.max(0, Math.min(1, (this._cursor.x - w.x) / w.w));
      w.value = val;
      this._needsRedraw = true;
      this.draw();

      if (!this._lastSliderCallback) this._lastSliderCallback = 0;
      const now = performance.now();
      if (now - this._lastSliderCallback > 30) {
        this._lastSliderCallback = now;
        if (this._main) {
          if (w.id === 'radius') this.updateRadius(val);
          if (w.id === 'intensity' && this._main.getSculptManager().getCurrentTool()) {
            this._main.getSculptManager().getCurrentTool().setIntensity(val);
          }
          if (w.id === 'voxelRes') {
            var tool = this._main.getSculptManager().getTool(Enums.Tools.VOXEL);
            if (tool && tool.setResolution) tool.setResolution(Math.floor(32 + val * (256 - 32)));
          }
          if (w.id === 'voxelRad') {
            var tool = this._main.getSculptManager().getTool(Enums.Tools.VOXEL);
            if (tool && tool.setRadiusMultiplier) tool.setRadiusMultiplier(1.0 + val * 99.0);
          }

          if (w.id === 'roughness' || w.id === 'metallic') {
            const tool = this._main.getSculptManager().getTool(Enums.Tools.PAINT);
            if (tool) {
              if (w.id === 'roughness') tool._material[0] = val;
              if (w.id === 'metallic') tool._material[1] = val;
            }
          }

          this._main.render();
        }
      }
    } else if (w.type === 'colorpicker_embedded') {
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
    if (w.type === 'slider' || w.type === 'info' || w.type === 'combobox' || w.type === 'color') return;

    if (w.type === 'section_header') {
      // Toggle Section
      this._sectionStates[w.label] = !this._sectionStates[w.label];
      this._needsRedraw = true;
      this.forceDraw(); // Force redraw to recalc layout
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
      const sm = main.getSculptManager();
      sm.setToolIndex(w.id);
      this.refreshToolsWidget(); // Rebuild widgets for new tool

      // Inject Pick Callback if Paint
      if (w.id === Enums.Tools.PAINT) {
        const tool = sm.getTool(Enums.Tools.PAINT);
        if (tool) {
          tool.setPickCallback((color, roughness, metallic) => {
            // Update Tool Internal State
            vec3.copy(tool._color, color);
            tool._material[0] = roughness;
            tool._material[1] = metallic;

            // Update UI
            this._needsRedraw = true;
            this.draw();

            // Auto-Exit Pick Mode? User might want multiple picks? 
            // Standard behavior is usually one pick then switch back to paint.
            tool._pickColor = false;
            console.log("Pick Color: ", color, roughness, metallic);
          });
        }
      }
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

    if (w.id === 'export_obj') {
      const blob = new Blob([Export.exportOBJ(main.getMeshes(), true, false)], { type: 'model/obj' });
      saveAs(blob, 'sculptgl_vr_export.obj');
    }
    if (w.id === 'export_stl') Export.exportSTL(main);
    if (w.id === 'import_obj') document.getElementById('fileopen')?.click();

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

  draw() {
    // OPTIMIZATION: Early exit if no redraw needed
    if (!this._needsRedraw) return;
    this._needsRedraw = false;
    this._needsUpload = true; // Signal that we have a new texture to upload

    const ctx = this._ctx;
    const w = CANVAS_SIZE;
    const h = CANVAS_SIZE;

    // BG
    ctx.fillStyle = '#202020';
    ctx.fillRect(0, 0, w, h);

    // --- DRAW HEADERS / TABS (FIRST - TO BE COVERED SROLLING) ---
    // User requested minimal "fluff" - Flat colors, no shadows.

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

        // Minimal Styling
        ctx.fillStyle = isActive ? '#eee' : '#111';
        ctx.fillRect(x, y, rW, TAB_HEIGHT);

        ctx.strokeStyle = '#333';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, rW, TAB_HEIGHT);

        ctx.fillStyle = isActive ? '#000' : '#888';
        ctx.fillText(t, x + rW / 2, y + TAB_HEIGHT / 2 + 8);
      });
    };

    drawRow(row1, 0);
    drawRow(row2, 1);
    drawRow(row3, 2);

    // --- DRAW WIDGETS ---
    const widgets = this._getWidgets();
    const mesh = this._main ? this._main.getMesh() : null;
    let activeTool = -1;
    if (this._main && this._main.getSculptManager) activeTool = this._main.getSculptManager().getToolIndex();

    // Clip to Widget Area (Prevent Header Overdraw)
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, HEADER_HEIGHT, w, h - HEADER_HEIGHT);
    ctx.clip();

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
        continue;
      }

      // 2. INFO / LABELS
      if (wid.type === 'info') {
        ctx.fillStyle = '#888';
        ctx.font = 'italic 24px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(wid.label, wid.x, wid.y + 24); 
        continue;
      }

      // Determine State
      let isActive = false;
      if (typeof wid.id === 'number') isActive = (wid.id === activeTool);
      if (wid.id === 'dynamic' && mesh) isActive = mesh.isDynamic;
      if (wid.id === 'wireframe' && mesh) isActive = mesh.getShowWireframe();
      if (wid.id === 'flat' && mesh) isActive = mesh.getFlatShading();
      if (wid.id === 'symmetry' && this._main.getSculptManager()) isActive = this._main.getSculptManager().getSymmetry();

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

      // Base Styles
      ctx.textAlign = 'center';
      ctx.font = '32px sans-serif';

      // --- SLIDER ---
      if (wid.type === 'slider') {
        // Track
        ctx.fillStyle = '#222';
        ctx.fillRect(wid.x, wid.y + wid.h * 0.4, wid.w, wid.h * 0.2);

        // Knob
        const val = Math.max(0, Math.min(1, wid.value)); // Clamp for safety
        const knobX = wid.x + val * wid.w;
        ctx.fillStyle = '#00D0FF';
        ctx.fillRect(knobX - 10, wid.y, 20, wid.h);

        // Label (Left)
        ctx.fillStyle = '#eee';
        ctx.textAlign = 'left';
        ctx.fillText(`${wid.label}: ${wid.value.toFixed(2)}`, wid.x + 20, wid.y + wid.h / 2 + 10);

        // Mapped Value (Right) if applicable
        if (!wid.noValue && isFinite(wid.min) && isFinite(wid.max)) {
          const mapped = wid.min + wid.value * (wid.max - wid.min);
          const valStr = mapped.toFixed(wid.precision || 2);
          ctx.textAlign = 'right';
          ctx.fillStyle = '#aaa';
          ctx.fillText(valStr, wid.x + wid.w - 10, wid.y + wid.h / 2 + 10);
        }
        continue;
      }

      // --- CHECKBOX / TOGGLE ---
      if (wid.type === 'checkbox' || wid.type === 'toggle') {
        // Draw Box
        ctx.fillStyle = '#222'; // BG
        ctx.fillRect(wid.x, wid.y, wid.w, wid.h);

      // Border
        ctx.strokeStyle = isActive ? '#fff' : '#888';
        ctx.lineWidth = isActive ? 4 : 2;
        ctx.strokeRect(wid.x, wid.y, wid.w, wid.h);

        // Text
        ctx.fillStyle = wid.disabled ? '#555' : 'white';
        ctx.textAlign = 'left';
        ctx.fillText(wid.label, wid.x + 20, wid.y + wid.h / 2 + 10);

        // Checkmark Box (Right Aligned)
        const checkW = 40;
        const checkX = wid.x + wid.w - checkW - 10;
        const checkY = wid.y + (wid.h - checkW) / 2;

        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.strokeRect(checkX, checkY, checkW, checkW);

        if (wid.value) {
          ctx.fillStyle = '#00D0FF';
          ctx.fillRect(checkX + 5, checkY + 5, checkW - 10, checkW - 10);
        }
        continue;
      }

      // --- COMBOBOX ---
      if (wid.type === 'combobox') {
        // Box
        ctx.fillStyle = '#222';
        ctx.fillRect(wid.x, wid.y, wid.w, wid.h);
        ctx.strokeStyle = '#888';
        ctx.lineWidth = 2;
        ctx.strokeRect(wid.x, wid.y, wid.w, wid.h);

        // Label (Current Value)
        let displayLabel = wid.label; // Fallback

        // Generic Support
        if (wid.options) {
          const opt = wid.options.find(o => o.id === wid.value || o === wid.value);
          if (opt) displayLabel = opt.label || opt;
        }
        // Legacy Support
        else {
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
        ctx.fillStyle = 'white';
        ctx.fillText(displayLabel, wid.x + 20, wid.y + wid.h / 2 + 10);

        // Arrow
        const arrowX = wid.x + wid.w - 30;
        const arrowY = wid.y + wid.h / 2;
        ctx.fillStyle = '#aaa';
        ctx.beginPath();
        ctx.moveTo(arrowX - 10, arrowY - 5);
        ctx.lineTo(arrowX + 10, arrowY - 5);
        ctx.lineTo(arrowX, arrowY + 10);
        ctx.fill();
        continue;
      }

      // --- COLOR PICKER EMBEDDED ---
      if (wid.type === 'colorpicker_embedded') {
        this._drawEmbeddedColorPicker(ctx, wid);
        continue;
      }

      // --- GENERIC BUTTON ---
      // BG
      ctx.fillStyle = isActive ? '#00A040' : '#444';
      if (wid.disabled) ctx.fillStyle = '#222';
      ctx.fillRect(wid.x, wid.y, wid.w, wid.h);

      // Border
      ctx.strokeStyle = isActive ? '#fff' : '#888';
      ctx.lineWidth = isActive ? 4 : 2;
      ctx.strokeRect(wid.x, wid.y, wid.w, wid.h);

      // Text
      ctx.fillStyle = wid.disabled ? '#555' : 'white';
      ctx.textAlign = 'center';
      ctx.fillText(wid.label || '', wid.x + wid.w / 2, wid.y + wid.h / 2 + 10);
    }

    ctx.restore(); // End Clipping





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

    // --- DRAW OVERLAYS ---
    if (this._overlay) {
      this._drawOverlay(ctx, w, h);
    }

    if (this._activeCombobox) {
      this._drawActiveCombobox(ctx);
    }

    this._needsRedraw = true;
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

      // Shadow / Dimmer for background?
      // ctx.fillStyle = 'rgba(0,0,0,0.5)';
      // ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

      // Menu Box
      // Menu Box
      // Shadow removed
      ctx.fillStyle = '#222'; // Dark Menu BG
      ctx.fillRect(x, y, mw, mh);

      ctx.strokeStyle = '#444';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, mw, mh);

      // Draw Menu Widgets
      widgets.forEach(wid => {
        const wx = x + wid.x;
        const wy = y + wid.y;

        ctx.textAlign = 'left';

        if (wid.header) {
          ctx.font = 'bold 18px sans-serif';
          ctx.fillStyle = '#aaa';
          ctx.fillText(wid.label, wx + 5, wy + wid.h - 10);
          // Separator line?
          ctx.strokeStyle = '#444';
          ctx.beginPath();
          ctx.moveTo(wx, wy + wid.h - 5);
          ctx.lineTo(wx + wid.w, wy + wid.h - 5);
          ctx.stroke();
        } else if (wid.type === 'checkbox') {
          // Checkbox logic
          const boxSize = 24;
          const boxX = wx + wid.w - boxSize - 5;
          const boxY = wy + (wid.h - boxSize) / 2;

          ctx.fillStyle = '#111';
          ctx.fillRect(boxX, boxY, boxSize, boxSize);
          ctx.strokeStyle = '#555';
          ctx.strokeRect(boxX, boxY, boxSize, boxSize);

          if (wid.value) {
            ctx.fillStyle = '#0f0'; // Checkmark
            ctx.fillRect(boxX + 4, boxY + 4, boxSize - 8, boxSize - 8);
          }

          ctx.font = '18px sans-serif';
          ctx.fillStyle = '#ddd';
          ctx.textAlign = 'left';
          ctx.fillText(wid.label, wx + 5, wy + wid.h / 2 + 6);

        } else if (wid.type === 'slider') {
          // Slider Logic
          ctx.font = '18px sans-serif';
          ctx.fillStyle = '#ddd';
          ctx.fillText(wid.label, wx + 5, wy + wid.h / 2 + 6);

          // Draw Slider Bar
          const sliderW = 120;
          const sliderH = 6;
          const sliderX = wx + wid.w - sliderW - 10;
          const sliderY = wy + wid.h / 2 - sliderH / 2;

          ctx.fillStyle = '#111';
          ctx.fillRect(sliderX, sliderY, sliderW, sliderH);

          // Knob
          // Value normalized 0..1
          let nVal = wid.value;
          // Ensure it is normalized if we have min/max ? 
          // Actually existing widgets seem to carry normalized value mostly?
          // If not, we might need normalizing logic.
          // For now assuming 0..1 as per existing render.

          const knobX = sliderX + sliderW * Math.max(0, Math.min(1, nVal));
          ctx.fillStyle = '#888';
          ctx.fillRect(knobX - 5, sliderY - 5, 10, 16);

          // Display actual value text
          let disp = nVal;
          if (wid.min !== undefined && wid.max !== undefined) {
            disp = wid.min + nVal * (wid.max - wid.min);
          }

          ctx.fillStyle = '#aaa';
          ctx.textAlign = 'right'; 
          ctx.fillText(disp.toFixed(2), sliderX - 10, wy + wid.h / 2 + 6);

        } else if (wid.type === 'button') {
          ctx.fillStyle = '#333';
          ctx.fillRect(wx, wy, wid.w, wid.h);

          // Hover effect? Need hover state.

          ctx.font = '18px sans-serif';
          ctx.fillStyle = wid.disabled ? '#666' : '#fff';
          ctx.fillText(wid.label, wx + 10, wy + wid.h / 2 + 6);

        } else if (wid.type === 'combobox') {
          ctx.fillStyle = '#252525';
          ctx.fillRect(wx, wy, wid.w, wid.h);
          ctx.strokeStyle = '#444';
          ctx.strokeRect(wx, wy, wid.w, wid.h);

          ctx.font = '18px sans-serif';
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
        }
      });
      ctx.restore();
      return; // Skip other overlays if Menu is open? Or draw on top? 
      // Usually Menu is top.
    }

    if (this._overlay === 'combobox') {
      this._drawCombobox(ctx);
    } else if (this._overlay === 'colorpicker') {
      this._drawColorPicker(ctx);
    }
  }

  _drawCombobox(ctx) {
    const data = this._overlayData;
    if (!data || !data.options) return;

    const itemHeight = 80;
    const startY = OVERLAY_Y + 100;
    const startX = OVERLAY_X + 20;

    // Calculate hover index from cursor (if available)
    let hoverIndex = -1;
    if (this._cursor.active) {
      const relY = this._cursor.y - startY;
      if (relY >= 0) hoverIndex = Math.floor(relY / itemHeight);
    }

    data.options.forEach((opt, i) => {
      const y = startY + i * itemHeight;
      if (y > OVERLAY_Y + OVERLAY_H - itemHeight) return;

      if (i === hoverIndex) ctx.fillStyle = '#666'; // Hover Highlight
      else ctx.fillStyle = '#444';

      ctx.fillRect(startX, y, OVERLAY_W - 40, itemHeight - 10);

      ctx.fillStyle = '#fff';
      ctx.font = '32px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(opt.label, startX + 20, y + itemHeight / 2 + 10);
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



    // Config (MUST MATCH DRAW LOGIC)
    const cx = w.x + w.w * 0.5;
    const cy = w.y + w.h * 0.5;
    const maxR = Math.min(w.w, w.h) * 0.5 - 10;
    const thickness = 20; // 50% thinner
    const outerRadius = maxR;
    const innerRadius = outerRadius - thickness;

    // Square fits INSIDE innerRadius
    const sqHalf = (innerRadius - 10) / Math.sqrt(2);
    const sqSize = sqHalf * 2;

    const dx = mx - cx;
    const dy = my - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // 1. Hue Ring Interaction (Annulus)
    // Give some padding for touch/click: +/- 10px
    if (dist >= innerRadius - 10 && dist <= outerRadius + 10) {
      // Angle -> Hue
      // atan2(y, x) -> -PI to PI
      let angle = Math.atan2(dy, dx);
      if (angle < 0) angle += Math.PI * 2;
      // Map 0..2PI to 0..1
      h = angle / (Math.PI * 2);

      const newRgb = Utils.hsv2rgb(h, s, v);
      vec3.copy(tool._color, newRgb);
      this._needsRedraw = true;
      this.draw();
      this._main.render();
      return;
    }

    // 2. SV Square Interaction
    if (Math.abs(dx) <= sqHalf + 10 && Math.abs(dy) <= sqHalf + 10) {
      // Map dx, dy relative to square center to s, v
      // Clamp to exact square bounds for value
      const cDx = Math.max(-sqHalf, Math.min(sqHalf, dx));
      const cDy = Math.max(-sqHalf, Math.min(sqHalf, dy));

      // dx from -sqHalf to +sqHalf -> s from 0 to 1
      // dy from -sqHalf to +sqHalf -> v from 1 to 0 (top is V=1, bottom is V=0)
      s = (cDx + sqHalf) / sqSize;
      v = 1.0 - (cDy + sqHalf) / sqSize;

      // Clamp just in case floating point errors
      s = Math.max(0, Math.min(1, s));
      v = Math.max(0, Math.min(1, v));

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
    const cy = y + w.h * 0.5;
    // Fit within bounds, padding 10
    const maxR = Math.min(w.w, w.h) * 0.5 - 10;
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

    // SV Square Indicator
    // S = x, V = y (inverted? Top is V=1, Bottom V=0)
    // S: 0 (Left) -> 1 (Right)
    // V: 0 (Bottom) -> 1 (Top) => y = (1-V)*size
    const svX = sqX + s * sqSize; // saturation
    const svY = sqY + (1.0 - v) * sqSize; // value (1=top, 0=bottom)

    ctx.beginPath();
    ctx.arc(svX, svY, 6, 0, Math.PI * 2);
    ctx.strokeStyle = (v < 0.5) ? 'white' : 'black';
    ctx.lineWidth = 2;
    ctx.stroke();

    const cssFinal = `rgb(${Math.floor(rgb[0] * 255)}, ${Math.floor(rgb[1] * 255)}, ${Math.floor(rgb[2] * 255)})`;
    ctx.fillStyle = cssFinal;
    ctx.fill();
  }

  update() {
    // 1. Redraw if requested (Input/Hover changes)
    if (this._needsRedraw) {
      if (!this._needsUpload) this._needsUpload = true;
      this.draw();
    }

    // 2. Upload Texture to GPU (Throttled)
    this.updateTexture();
  }

  updateTexture() {
    // Force draw if pending (Fix for VR where window.RAF is throttled)
    if (this._pendingDraw) {
      this._needsRedraw = true;
      this.draw();
      this._pendingDraw = false;
    }

    if (!this._needsUpload || !this._texture) return;
    const now = performance.now();
    if (!this._lastUpload) this._lastUpload = 0;
    // Throttle to 30fps (33ms) to improve responsiveness while respecting VR bandwidth
    if (now - this._lastUpload < 33) {
      return;
    }

    this._lastUpload = now;

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
  updateRadius(val) {
    this._radius = val;
    const tools = this._tabWidgets['TOOLS'];
    if (tools) {
      const w = tools.find(w => w.id === 'radius');
      if (w) w.value = val;
    }
    this.syncToolRadius();
    this.forceDraw();
  }
  _handleDropdownInteract(cx, cy) {
    const w = this._activeCombobox;
    // Check if inside Dropdown List
    const itemHeight = 60; // Standard layout
    const startY = w.y + w.h;
    const listH = (w.options ? w.options.length : 0) * itemHeight;

    if (cx >= w.x && cx <= w.x + w.w && cy >= startY && cy <= startY + listH) {
      // Inside List
      const index = Math.floor((cy - startY) / itemHeight);
      if (w.options && w.options[index]) {
        const opt = w.options[index];
        const val = opt.id !== undefined ? opt.id : index;
        console.log(`[GuiXR] Dropdown select index=${index} optId=${opt.id} val=${val}`);
        if (w.onSelect) w.onSelect(val);
        this._activeCombobox = null;
        this._needsRedraw = true;
        this.draw();
      }
      return;
    }

    // Check if inside Header (Toggle off)
    if (cx >= w.x && cx <= w.x + w.w && cy >= w.y && cy <= w.y + w.h) {
      this._activeCombobox = null;
      this._needsRedraw = true;
      this.draw();
      return;
    }

    // Clicked Outside
    console.log("[GuiXR] Closing dropdown (clicked outside)");
    this._activeCombobox = null;
    this._needsRedraw = true;
    this.draw();
  }

  _drawActiveCombobox(ctx) {
    const w = this._activeCombobox;
    if (!w || !w.options) return;

    const itemHeight = 60;
    const startX = w.x;
    const startY = w.y + w.h; // Below button

    const listH = w.options.length * itemHeight;

    // Shadow
    // Shadow removed

    // Background
    ctx.fillStyle = '#222';
    ctx.fillRect(startX, startY, w.w, listH);

    // Border
    ctx.strokeStyle = '#00D0FF';
    ctx.lineWidth = 2;
    ctx.strokeRect(startX, startY, w.w, listH);

    // Highlight hover
    if (this._cursor.active) {
      const cy = this._cursor.y;
      if (this._cursor.x >= startX && this._cursor.x <= startX + w.w && cy >= startY && cy <= startY + listH) {
        const idx = Math.floor((cy - startY) / itemHeight);
        ctx.fillStyle = '#444';
        ctx.fillRect(startX, startY + idx * itemHeight, w.w, itemHeight);
      }
    }

    // Items
    ctx.textAlign = 'left';
    ctx.font = '24px sans-serif';
    ctx.fillStyle = 'white';

    w.options.forEach((opt, i) => {
      const y = startY + i * itemHeight;
      ctx.fillText(opt.label, startX + 20, y + itemHeight / 2 + 8);
    });
  }
}

export default GuiXR;
