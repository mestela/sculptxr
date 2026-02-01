import Enums from 'misc/Enums';
import TR from 'gui/GuiTR';
import Export from 'files/Export';
import { saveAs } from 'file-saver';
import Shader from 'render/ShaderLib';
import Utils from 'misc/Utils';
import { vec3 } from 'gl-matrix';

// Modular Imports
import getToolsWidgets from 'gui/vr/GuiVRTools';
import getSceneWidgets from 'gui/vr/GuiVRScene';
import getRenderingWidgets from 'gui/vr/GuiVRRendering';
import getFilesWidgets from 'gui/vr/GuiVRFiles';
import getHistoryWidgets from 'gui/vr/GuiVRHistory';
import getBackgroundWidgets from 'gui/vr/GuiVRBackground';
import getCameraWidgets from 'gui/vr/GuiVRCamera';
import getTabletWidgets from 'gui/vr/GuiVRTablet';
import getLanguageWidgets from 'gui/vr/GuiVRLanguage';
import getExtraUIWidgets from 'gui/vr/GuiVRExtraUI';
import getAboutWidgets from 'gui/vr/GuiVRAbout';
import getTopologyWidgets from 'gui/vr/GuiVRTopology';
import Tablet from 'misc/Tablet';

// Direct access for property setters
import MeshDynamic from 'mesh/dynamic/MeshDynamic';
import Remesh from 'editing/Remesh';
import ShaderBase from 'render/shaders/ShaderBase';
import StateManager from 'states/StateManager';

const TAB_HEIGHT = 40; // Reduced from 80
const TAB_ROWS = 2; // Rows of tabs
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

    this._needsUpdate = true;
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


    this._tabWidgets = {
      // Global Tabs (Overlay or separate view? For now let's just make them active "Tools" that swal layout?)
      // Actually standard desktop: clicking "Files" opens a modal or changes view?
      // In VR, switching "Tabs" usually replaces the main content.
      // But user wants "Top split into 2 rows".
      // Let's treat valid "Tabs" as the Top Row items.
      'Files': getFilesWidgets(main),
      'Scene': getSceneWidgets(main),
      'History': getHistoryWidgets(main),
      // 'Settings': No longer a global tab, decomposed

      // Sections
      'Rendering': getRenderingWidgets(main),
      'Topology': getTopologyWidgets(main),
      'Sculpting & Painting': getToolsWidgets(main, main.getSculptManager().getToolIndex())
    };

    // We need to know which "Mode" we are in.
    // If we click "FILES", does it replace the sidebar?
    // User says "Menus are at the top".
    // "Panel has collapsible sections".
    // This implies the MAIN VIEW is the Sidebar stack (Rendering + Topo + Sculpting).
    // And global tabs might just show overlays or switch context?
    // Let's assume "Sidebar Mode" is the default view.
    this._viewMode = 'SIDEBAR'; // vs 'FILES', 'SCENE', 'HISTORY', 'SETTINGS' ?
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
  }

  // Console Helper for Tab Switching
  switchTab(tabName) {
    const tabIdx = GLOBAL_TABS.indexOf(tabName);

    // Check if it's one of our dropdown tabs
    if (tabIdx !== -1) {
      const w = this._canvas.width;

      // Row Logic Match draw()
      const row1Count = 5;
      const isRow1 = tabIdx < row1Count;
      const countInRow = isRow1 ? row1Count : (GLOBAL_TABS.length - row1Count);
      const idxInRow = isRow1 ? tabIdx : (tabIdx - row1Count);

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
        // Row 1: 0..4 (5 tabs)
        // Row 2: 5..8 (4 tabs)
        const row1Count = 5;
        const rowIndex = (tabIdx < row1Count) ? 0 : 1;
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
    this._needsUpdate = true;
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
      this._needsUpdate = true;
      this.draw();
    };
    this._canvas.addEventListener('wheel', onWheel);

    this._previewCleanup = () => {
      this._canvas.removeEventListener('pointerdown', onPointerDown);
      this._canvas.removeEventListener('pointermove', onPointerMove);
      this._canvas.removeEventListener('pointerup', onPointerUp);
      this._canvas.removeEventListener('wheel', onWheel);
    };

    this._needsUpdate = true;
    this.draw();
  }

  // Reload widgets (e.g. when tool changes)
  refreshToolsWidget() {
    this._tabWidgets['Sculpting & Painting'] = getToolsWidgets(this._main, this._main.getSculptManager().getToolIndex());
    this._needsUpdate = true;
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
    this._needsUpdate = true;
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
    this._hoverWidget = null;
    for (let wid of widgets) {
      if (cx >= wid.x && cx <= wid.x + wid.w && cy >= wid.y && cy <= wid.y + wid.h) {
        this._hoverWidget = wid;
        return;
      }
    }
  }

  _updateOverlayHover() {
    // Just track cursor relative to overlay items
    this._needsUpdate = true;
  }

  _getWidgets() {
    if (this._viewMode === 'SIDEBAR') {
      return []; // We handle sidebar custom in draw() for now, or we merge all?
      // To reuse interaction logic, we should probably generate a FLAT list of visible widgets based on scroll offset.
      // OR we map interaction to the layout logic.
      // Standard _getWidgets logic relies on x,y.
      // If we implement scrolling, we need to offset Y.

      let allWidgets = [];
      let currentY = HEADER_HEIGHT - this._scrollOffset;

      SECTIONS.forEach(secTitle => {
        const isOpen = this._sectionStates[secTitle];
        // Header Button (Virtual)
        // We'll treat the header as a widget for interaction?
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
          const secWidgets = this._tabWidgets[secTitle];
          // Clone and Offset
          if (secWidgets) {
            secWidgets.forEach(w => {
              allWidgets.push({
                ...w,
                y: w.y + currentY - 130 // 130 was original offset in generator? We need to re-base.
                // Actually, the generators (getToolsWidgets) used absolute Y starting at 130.
                // We need to normalize them to relative 0 if possible, or subtract 130.
              });
            });

            // Update currentY by height of section
            // We need to know the max H of the section.
            // The widgets have y + h.
            if (secWidgets.length > 0) {
              const maxY = Math.max(...secWidgets.map(w => (isFinite(w.y) && isFinite(w.h)) ? w.y + w.h : 0));
              const minY = Math.min(...secWidgets.map(w => isFinite(w.y) ? w.y : 0));
              const sectionH = Math.max(0, maxY - minY + 20);
              currentY += sectionH;
            }
          }
        }
      });

      this._maxScroll = Math.max(0, currentY + this._scrollOffset - CANVAS_SIZE);
      return allWidgets;
    }


    // Regular View (Generic Scroll support)
    const widgets = this._tabWidgets[this._viewMode] || [];
    // Just apply scroll offset?
    // We need to calculate bounds to set _maxScroll
    // If not SIDEBAR, we treat it as a simple list?
    // Widgets usually have fixed Y.
    // If we want to scroll them, we need to offset Y.
    const hasScroll = true; // Always allow scroll?

    if (hasScroll) {
      const currentY = HEADER_HEIGHT - this._scrollOffset;
      const offsetWidgets = widgets.map(w => ({
        ...w,
        y: w.y + currentY - 130 // normalize ?
      }));

      // Calculate max scroll
      if (widgets.length > 0) {
        const maxY = Math.max(...widgets.map(w => (isFinite(w.y) && isFinite(w.h)) ? w.y + w.h : 0));
        const minY = Math.min(...widgets.map(w => isFinite(w.y) ? w.y : 0));
        const contentH = Math.max(0, maxY - minY + 20);
        // Total height needed
        const totalH = contentH + HEADER_HEIGHT + 130;  // approximate
        const calculatedMax = totalH - CANVAS_SIZE;
        this._maxScroll = Math.max(0, isFinite(calculatedMax) ? calculatedMax : 0);
      } else {
        this._maxScroll = 0;
      }
      return offsetWidgets;
    }

    return widgets;
  }

  onInteract(u, v, isPressed) {
    if (!this._cursor.active || !isPressed) return;

    const cx = this._cursor.x;
    const cy = this._cursor.y;
    const now = performance.now();

    // 0. Dropdown Interaction (High Priority)
    if (this._activeCombobox) {
      if (now - this._inputDebounce < 250) return;
      this._inputDebounce = now;
      this._handleDropdownInteract(cx, cy);
      return;
    }

    // 0. Check Overlay
    if (this._overlay) {
      if (now - this._inputDebounce < 250) return;
      this._inputDebounce = now;
      this._handleOverlayInteract(cx, cy);
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
    if (targetWid && (targetWid.type === 'slider' || targetWid.type === 'colorpicker_embedded' || targetWid.id === 'roughness' || targetWid.id === 'metallic')) {
      debounceTime = 16; // ~60fps for continuous controls
    }

    // Check Tabs
    if (!targetWid && cy < TAB_HEIGHT) debounceTime = 250;

    if (now - this._inputDebounce < debounceTime) return;
    this._inputDebounce = now;

    const w = this._canvas.width;

    // 1. Check Tabs (Header)
    if (this._viewMode === 'SIDEBAR' || GLOBAL_TABS.includes(this._viewMode)) {
      const row1Count = 5;
      const row1 = GLOBAL_TABS.slice(0, row1Count);
      const row2 = GLOBAL_TABS.slice(row1Count);

      // Row 1
      if (cy < TAB_HEIGHT) {
        const r1W = w / row1.length;
        const idx = Math.floor(cx / r1W);
        if (idx >= 0 && idx < row1.length) {
          console.log(`[GuiXR] Clicked Global Tab (Row 1): ${row1[idx]}`);
          this.switchTab(row1[idx]);
        }
        return;
      }
      // Row 2
      if (cy < HEADER_HEIGHT) {
        const r2W = w / row2.length;
        const idx = Math.floor(cx / r2W);
        if (idx >= 0 && idx < row2.length) {
          console.log(`[GuiXR] Clicked Global Tab (Row 2): ${row2[idx]}`);
          this.switchTab(row2[idx]);
        }
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


    // 2. Check Widgets
    if (targetWid) {
      if (targetWid.disabled) {
        console.log(`[GuiXR] Ignored disabled widget: ${targetWid.label}`);
        return;
      }
      // console.log(`[GuiXR] Interacted with widget: ${targetWid.id} (${targetWid.type})`);
      this._handleWidgetClick(targetWid);
      return;
    }
  }

  _handleOverlayInteract(cx, cy) {
    const now = performance.now();
    // Safety Lock: Prevent closing immediately after opening
    if (now - this._overlayOpenTime < 500) {
      console.log("[GuiXR] Ignoring overlay interaction (cooldown)");
      return;
    }

    // Close if clicking outside box
    // Custom bounds for 'menu' which has variable size
    let ox = OVERLAY_X, oy = OVERLAY_Y, ow = OVERLAY_W, oh = OVERLAY_H;

    if (this._overlay === 'menu' && this._overlayData) {
      ox = this._overlayData.x;
      oy = this._overlayData.y;
      ow = this._overlayData.w;
      oh = this._overlayData.h;
    }

    if (cx < ox || cx > ox + ow || cy < oy || cy > oy + oh) {
      console.log("[GuiXR] Closing overlay (clicked outside)");
      this.closeOverlay();
      return;
    }

    // Close Button (Top Right)
    const closeSize = 60;
    if (cx > OVERLAY_X + OVERLAY_W - closeSize && cy < OVERLAY_Y + closeSize) {
      console.log("[GuiXR] Closing overlay (close button)");
      this.closeOverlay();
      return;
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
            this._needsUpdate = true;
          } else if (w.type === 'checkbox') {
            w.value = !w.value;
            this._executeAction(w);
            this._needsUpdate = true;
          } else if (w.type === 'button') {
            this._executeAction(w);
            // Close menu on action? 
            // Keep open for specific actions like Undo/Redo or Tools
            const keepOpen = ['undo', 'redo', 'addSphere', 'addCube', 'addCylinder', 'addTorus'].includes(w.id);
            if (!keepOpen) this.closeOverlay();
            else this._needsUpdate = true;
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
    this._needsUpdate = true;
    this.draw();
  }

  closeOverlay() {
    this._overlay = null;
    this._overlayData = null;
    this._needsUpdate = true;
    this.draw();
  }

  _handleWidgetClick(w) {
    if (w.type === 'slider') {
      const val = Math.max(0, Math.min(1, (this._cursor.x - w.x) / w.w));
      w.value = val;
      this._needsUpdate = true;
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
        this._needsUpdate = true;
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
          this._needsUpdate = true;
          this.draw();
        },
        onHueChange: (h) => {
          this._overlayData.hue = h;
          const newRgb = Utils.hsv2rgb(h, this._overlayData.sat, this._overlayData.val);
          tool._color[0] = newRgb[0];
          tool._color[1] = newRgb[1];
          tool._color[2] = newRgb[2];
          this._needsUpdate = true;
          this.draw();
        },
        onConfirm: () => { }
      });

    } else {
      this._needsUpdate = true;
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
      this._needsUpdate = true;
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
            this._needsUpdate = true;
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
    setTimeout(() => { this._needsUpdate = true; this.draw(); }, 250);
    this._needsUpdate = true;
    main.render();
  }

  forceDraw() {
    this._lastDraw = 0;
    this._needsUpdate = true;
    this.draw();
    this.updateTexture();
  }

  draw() {
    if (!this._needsUpdate) return;
    this._needsUpdate = false;

    const ctx = this._ctx;
    const w = CANVAS_SIZE;
    const h = CANVAS_SIZE;

    // BG
    ctx.fillStyle = '#202020';
    ctx.fillRect(0, 0, w, h);

    // Header / Tabs
    if (true) {
      const row1Count = 5;
      const row1 = GLOBAL_TABS.slice(0, row1Count);
      const row2 = GLOBAL_TABS.slice(row1Count);

      ctx.textAlign = 'center';
      ctx.font = '18px sans-serif'; 

      // Row 1
      const r1W = w / row1.length;
      row1.forEach((t, i) => {
        const x = i * r1W;
        const y = 0;

        let isActive = (t === this._viewMode);
        // if (this._viewMode === 'SIDEBAR' && t === 'Tools') isActive = true;

        ctx.fillStyle = isActive ? '#0070A0' : '#111';
        ctx.fillRect(x, y, r1W, TAB_HEIGHT);
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, r1W, TAB_HEIGHT);

        ctx.fillStyle = isActive ? '#fff' : '#aaa';
        ctx.fillText(t, x + r1W / 2, y + TAB_HEIGHT / 2 + 6);
      });

      // Row 2
      const r2W = w / row2.length;
      row2.forEach((t, i) => {
        const x = i * r2W;
        const y = TAB_HEIGHT;

        let isActive = (t === this._viewMode);

        ctx.fillStyle = isActive ? '#0070A0' : '#111';
        ctx.fillRect(x, y, r2W, TAB_HEIGHT);
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, r2W, TAB_HEIGHT);

        ctx.fillStyle = isActive ? '#fff' : '#aaa';
        ctx.fillText(t, x + r2W / 2, y + TAB_HEIGHT / 2 + 6);
      });
    }

    // --- DRAW WIDGETS ---
    const widgets = this._getWidgets();
    const mesh = this._main ? this._main.getMesh() : null;
    let activeTool = -1;
    if (this._main && this._main.getSculptManager) activeTool = this._main.getSculptManager().getToolIndex();

    for (let wid of widgets) {
      // Special Section Header Handling
      if (wid.type === 'section_header') {
        // Draw Desktop-Style Section Header
        ctx.fillStyle = '#2A2A2A'; // Darker/Lighter?
        ctx.fillRect(wid.x, wid.y, wid.w, wid.h);

        // Triangle
        const isOpen = this._sectionStates[wid.label];
        ctx.fillStyle = '#ccc';
        ctx.beginPath();
        const triX = 30;
        const triY = wid.y + wid.h / 2;
        if (isOpen) {
          // Arrow Down
          ctx.moveTo(triX - 10, triY - 5);
          ctx.lineTo(triX + 10, triY - 5);
          ctx.lineTo(triX, triY + 10);
        } else {
          // Arrow Right
          ctx.moveTo(triX - 5, triY - 10);
          ctx.lineTo(triX - 5, triY + 10);
          ctx.lineTo(triX + 10, triY);
        }
        ctx.fill();

        ctx.font = 'bold 30px sans-serif';
        ctx.fillStyle = '#eee';
        ctx.textAlign = 'left';
        ctx.fillText(wid.label, wid.x + 60, wid.y + wid.h / 2 + 10);

        // Divider
        ctx.strokeStyle = 'black';
        ctx.beginPath();
        ctx.moveTo(wid.x, wid.y + wid.h);
        ctx.lineTo(wid.x + wid.w, wid.y + wid.h);
        ctx.stroke();

        continue;
      }

      if (wid.type === 'info') {
        ctx.fillStyle = '#888';
        ctx.font = 'italic 28px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(wid.label, wid.x, wid.y);
        continue;
      }

      let isActive = false;
      if (wid.type === 'button' && typeof wid.id === 'number') isActive = (wid.id === activeTool);
      if (wid.id === 'dynamic' && mesh) isActive = mesh.isDynamic;
      if (wid.id === 'wireframe' && mesh) isActive = mesh.getShowWireframe();
      if (wid.id === 'flat' && mesh) isActive = mesh.getFlatShading();
      if (wid.id === 'symmetry' && this._main.getSculptManager()) isActive = this._main.getSculptManager().getSymmetry();
      // Passthrough check might need generic handling
      // if (wid.id === 'passthrough' && this._main) isActive = (this._main.getXRMode() === 'immersive-ar');

      // Paint Toggles
      if (wid.id === 'pick_color') {
        const tool = this._main.getSculptManager().getTool(Enums.Tools.PAINT);
        isActive = tool ? tool._pickColor : false;
      }
      if (wid.id === 'write_albedo') {
        const tool = this._main.getSculptManager().getTool(Enums.Tools.PAINT);
        isActive = tool ? tool._writeAlbedo : false;
      }
      if (wid.id === 'write_roughness') {
        const tool = this._main.getSculptManager().getTool(Enums.Tools.PAINT);
        isActive = tool ? tool._writeRoughness : false;
      }
      if (wid.id === 'write_metalness') {
        const tool = this._main.getSculptManager().getTool(Enums.Tools.PAINT);
        isActive = tool ? tool._writeMetalness : false;
      }

      ctx.fillStyle = isActive ? '#00A040' : '#444';
      if (wid.type === 'slider') ctx.fillStyle = '#555';
      if (wid.disabled) ctx.fillStyle = '#222';

      // Checkbox style overrides logic below
      if (wid.type === 'button' || wid.type === 'toggle' || wid.type === 'checkbox' || wid.type === 'combobox') {
        ctx.fillRect(wid.x, wid.y, wid.w, wid.h);
      }

      ctx.strokeStyle = isActive ? '#fff' : '#888';
      ctx.lineWidth = isActive ? 4 : 2;
      // Standard Box Outline
      // Standard Box Outline
      if (wid.type !== 'slider' && wid.type !== 'info' && wid.type !== 'colorpicker_embedded') {
        ctx.strokeRect(wid.x, wid.y, wid.w, wid.h);
      }

      ctx.fillStyle = 'white';
      ctx.textAlign = 'center';
      ctx.font = '28px sans-serif';

      if (wid.disabled) {
        ctx.fillStyle = '#555'; // Dim text
      }

      if (wid.type === 'slider') {
        ctx.textAlign = 'left';
        ctx.fillText(`${wid.label}: ${wid.value.toFixed(2)}`, wid.x + 20, wid.y + wid.h / 2 + 10);
      } else if (wid.type === 'checkbox' || wid.type === 'toggle') {
        ctx.textAlign = 'left';
        ctx.fillText(wid.label, wid.x + 60, wid.y + wid.h / 2 + 10);
      } else {
        let displayLabel = wid.label;

        // Generic Combobox Label
        if (wid.type === 'combobox' && wid.options && wid.value !== undefined) {
          const opt = wid.options.find(o => o.id === wid.value) || wid.options[wid.value];
          if (opt) displayLabel = opt.label;
        }

        if (wid.id === 'environment' && wid.type === 'combobox') {
          const ShaderPBR = Shader[Enums.Shader.PBR];
          if (ShaderPBR && ShaderPBR.environments && ShaderPBR.environments[ShaderPBR.idEnv]) {
            displayLabel = ShaderPBR.environments[ShaderPBR.idEnv].name;
          }
        } else if (wid.id === 'matcap' && wid.type === 'combobox') {
          const ShaderMatcap = Shader[Enums.Shader.MATCAP];
          const mesh = this._main.getMesh();
          if (mesh && ShaderMatcap && ShaderMatcap.matcaps) {
            const matId = mesh.getMatcap();
            if (ShaderMatcap.matcaps[matId]) {
              displayLabel = ShaderMatcap.matcaps[matId].name;
            }
          }
        }
        ctx.fillText(displayLabel, wid.x + wid.w / 2, wid.y + wid.h / 2 + 10);
      }

      // Combobox Triangle
      if (wid.type === 'combobox') {
        const triX = wid.x + wid.w - 30;
        const triY = wid.y + wid.h / 2;
        ctx.fillStyle = '#aaa';
        ctx.beginPath();
        ctx.moveTo(triX - 10, triY - 5);
        ctx.lineTo(triX + 10, triY - 5);
        ctx.lineTo(triX, triY + 10);
        ctx.fill();

        ctx.strokeStyle = '#888';
        ctx.lineWidth = 2;
        ctx.strokeRect(wid.x, wid.y, wid.w, wid.h);
      }

      if (wid.type === 'colorpicker_embedded') {
        this._drawEmbeddedColorPicker(ctx, wid);
      }
    }

    ctx.strokeStyle = '#00D0FF';
    ctx.lineWidth = 15;
    ctx.strokeRect(0, 0, w, h);

    // --- DRAW SCROLLBAR if needed ---
    if (this._viewMode === 'SIDEBAR' && this._maxScroll > 0) {
      // Draw Scroll Track
      const trackW = 20;
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

      ctx.fillStyle = '#666';
      if (this._cursor.active && this._cursor.x >= trackX) ctx.fillStyle = '#888';
      ctx.fillRect(trackX + 2, thumbY, trackW - 4, thumbH);
    }

    // --- DRAW OVERLAYS ---
    if (this._overlay) {
      this._drawOverlay(ctx, w, h);
    }

    if (this._activeCombobox) {
      this._drawActiveCombobox(ctx);
    }

    this._needsUpdate = true;
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
      const { x, y, w, h, widgets } = this._overlayData;

      // Shadow / Dimmer for background?
      // ctx.fillStyle = 'rgba(0,0,0,0.5)';
      // ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

      // Menu Box
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 20;
      ctx.fillStyle = '#222'; // Dark Menu BG
      ctx.fillRect(x, y, w, h);
      ctx.shadowBlur = 0;

      ctx.strokeStyle = '#444';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, w, h);

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
          // Mock value? Use real value which is 0..1 usually in widget, but we have min/max support in _executeAction
          // The widget object might only have 'value' normalized or raw? 
          // getCameraWidgets sets 'value' to real value (e.g. 45 for fov).
          // But _handleMenuInteract normalizes slider interaction to 0..1?
          // Wait, _handleMenuInteract says: w.value = val (0..1).
          // _executeAction maps 0..1 to Min/Max.
          // BUT getCameraWidgets initializes 'value' to camera.getFov() (e.g. 45).
          // If interaction sets it to 0.5, we lose the previous State?
          // We need normalization in getCameraWidgets or handle normalized values.
          // GuiXR _handleMenuInteract assumes w.value is 0-1. 
          // If we pass raw value 45, the slider will draw at 4500% !
          // We should normalize input widgets?
          // OR handle raw values in slider drawing and interaction?
          // _handleMenuInteract sets 0..1. 
          // So if we start with real value, we need to normalize it for display only?
          // Or we normalize it during widget creation?
          // The widget creation functions (GuiVRCamera) put raw values.
          // We should probably normalize them in the widget creation OR handle min/max in drawing/interaction.
          // Since _executeAction handles min/max, it expects w.value to be 0..1 (from interaction).
          // So the initial value MUST be normalized.
          // I need to update GuiVRCamera.js etc to normalize?
          // Or I check min/max here?

          let normalized = wid.value;
          if (wid.min !== undefined && wid.max !== undefined) {
            // If value is raw (e.g. 45), normalize it.
            // But if value is 0.5 (from interaction), stick with it.
            // How do we distinguish? 
            // Maybe we assume 'value' on the widget OBJECT is always 0..1?
            // If so, getCameraWidgets is WRONG to pass raw value.
            // I'll assume I need to fix getCameraWidgets/GuiVRCamera.js etc or fix logic here.
            // Given I can edit this file easily:
            // Let's normalize here if min/max exist and value > 1 ? No, value can be 0.5 and be raw.

            // Safer: assume w.value IS the normalized value (0..1).
            // AND in getCameraWidgets, we should compute normalized value.
            // I'll update visual here to use 0..1.
            // And I will try to update GuiVRCamera separately or rely on 'init' normalization?
            // GuiXR doesn't have init normalization loop by default.

            // Let's just use wid.value for knob position (assuming 0..1).
            // And display the MAPPED value (using min/max).
          }

          const knobX = sliderX + sliderW * Math.max(0, Math.min(1, wid.value));
          ctx.fillStyle = '#888';
          ctx.fillRect(knobX - 5, sliderY - 5, 10, 16);

          // Value Text
          let displayVal = wid.value;
          if (wid.min !== undefined && wid.max !== undefined) {
            displayVal = wid.min + wid.value * (wid.max - wid.min);
          }

          ctx.fillStyle = '#aaa';
          ctx.textAlign = 'right';
          ctx.fillText(displayVal.toFixed(2), sliderX - 10, wy + wid.h / 2 + 6);


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
      this._needsUpdate = true;
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
      this._needsUpdate = true;
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

  updateTexture() {
    if (!this._needsUpdate || !this._texture) return;
    const now = performance.now();
    if (!this._lastUpload) this._lastUpload = 0;
    if (now - this._lastUpload < 30) return;
    this._lastUpload = now;
    const gl = this._gl;
    const prevTex = gl.getParameter(gl.TEXTURE_BINDING_2D);
    gl.bindTexture(gl.TEXTURE_2D, this._texture);
    if (this._textureAllocated) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, this._canvas);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this._canvas);
      this._textureAllocated = true;
    }
    if (prevTex) gl.bindTexture(gl.TEXTURE_2D, prevTex);
    this._needsUpdate = false;
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
        if (w.onSelect) w.onSelect(opt.id !== undefined ? opt.id : index);
        this._activeCombobox = null;
        this._needsUpdate = true;
        this.draw();
      }
      return;
    }

    // Check if inside Header (Toggle off)
    if (cx >= w.x && cx <= w.x + w.w && cy >= w.y && cy <= w.y + w.h) {
      this._activeCombobox = null;
      this._needsUpdate = true;
      this.draw();
      return;
    }

    // Clicked Outside
    console.log("[GuiXR] Closing dropdown (clicked outside)");
    this._activeCombobox = null;
    this._needsUpdate = true;
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
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 20;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 10;

    // Background
    ctx.fillStyle = '#222';
    ctx.fillRect(startX, startY, w.w, listH);

    ctx.shadowColor = 'transparent'; // Reset

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
