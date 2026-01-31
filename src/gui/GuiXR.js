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
import getTopologyWidgets from 'gui/vr/GuiVRTopology';
import getSettingsWidgets from 'gui/vr/GuiVRSettings';

// Direct access for property setters
import MeshDynamic from 'mesh/dynamic/MeshDynamic';
import Remesh from 'editing/Remesh';

const TAB_HEIGHT = 100;
const CANVAS_SIZE = 1024;
// Desktop Order: Topbar (Files, Scene, History/States, Settings/Config) -> Sidebar (Rendering, Topology, Tools/Sculpting)
// VR Tabs: FILES, SCENE, HISTORY, SETTINGS, VIEW, TOPOLOGY, TOOLS
const TABS = ['FILES', 'SCENE', 'HISTORY', 'SETTINGS', 'VIEW', 'TOPOLOGY', 'TOOLS'];

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
    this._activeTab = 'TOOLS';

    this._cursor = { x: -1, y: -1, active: false };
    this._radius = 0.20;

    // Overlay State
    this._overlay = null;
    this._overlayData = null;
    this._overlayOpenTime = 0; // Cooldown for accidental clicks

    this._inputDebounce = 0; // Debounce all interactions


    this._tabWidgets = {
      'TOOLS': getToolsWidgets(main, main.getSculptManager().getToolIndex()),
      'SCENE': getSceneWidgets(main),
      'TOPOLOGY': getTopologyWidgets(main),
      'VIEW': getRenderingWidgets(main),
      'FILES': getFilesWidgets(main),
      'HISTORY': getHistoryWidgets(main),
      'SETTINGS': getSettingsWidgets(main)
    };

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
    if (TABS.includes(tabName)) {
      this._activeTab = tabName;
      this._needsUpdate = true;
      this.draw();
      console.log(`[GuiXR] Switched to tab: ${tabName} `);
    } else {
      console.warn(`[GuiXR] Invalid tab: ${tabName}.Available: ${TABS.join(', ')} `);
    }
  }

  nextTab() {
    const idx = TABS.indexOf(this._activeTab);
    const nextIdx = (idx + 1) % TABS.length;
    this.switchTab(TABS[nextIdx]);
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

    this._previewCleanup = () => {
      this._canvas.removeEventListener('pointerdown', onPointerDown);
      this._canvas.removeEventListener('pointermove', onPointerMove);
      this._canvas.removeEventListener('pointerup', onPointerUp);
    };

    this._needsUpdate = true;
    this.draw();
  }

  // Reload widgets (e.g. when tool changes)
  refreshToolsWidget() {
    this._tabWidgets['TOOLS'] = getToolsWidgets(this._main, this._main.getSculptManager().getToolIndex());
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
    return this._tabWidgets[this._activeTab] || [];
  }

  onInteract(u, v, isPressed) {
    if (!this._cursor.active || !isPressed) return;

    const cx = this._cursor.x;
    const cy = this._cursor.y;
    const now = performance.now();

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
    if (cy < TAB_HEIGHT) {
      const tabWidth = w / TABS.length;
      const tabIndex = Math.floor(cx / tabWidth);
      if (tabIndex >= 0 && tabIndex < TABS.length) {
        this._activeTab = TABS[tabIndex];
        this._needsUpdate = true;
        this.draw();
      }
      return;
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
    if (cx < OVERLAY_X || cx > OVERLAY_X + OVERLAY_W || cy < OVERLAY_Y || cy > OVERLAY_Y + OVERLAY_H) {
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
        this.openOverlay('combobox', { title: w.label || 'Select', options: opts, callback: cb });
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
    const tabW = w / TABS.length;
    ctx.font = '30px sans-serif';
    ctx.textAlign = 'center';

    for (let i = 0; i < TABS.length; ++i) {
      const t = TABS[i];
      const isActive = t === this._activeTab;
      const x = i * tabW;

      ctx.fillStyle = isActive ? '#0070A0' : '#333';
      ctx.fillRect(x, 0, tabW, TAB_HEIGHT);

      ctx.strokeStyle = '#111';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, 0, tabW, TAB_HEIGHT);

      ctx.fillStyle = isActive ? '#fff' : '#888';

      // Auto-scale font if too long
      // ctx.font = (t.length > 8) ? '24px sans-serif' : '30px sans-serif';
      // Resetting font for each tab to be safe
      ctx.font = '30px sans-serif';
      ctx.fillText(t, x + tabW / 2, TAB_HEIGHT / 2 + 10);
    }

    // --- DRAW WIDGETS ---
    const widgets = this._getWidgets();
    const mesh = this._main ? this._main.getMesh() : null;
    let activeTool = -1;
    if (this._main && this._main.getSculptManager) activeTool = this._main.getSculptManager().getToolIndex();

    for (let wid of widgets) {
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

    if (this._overlay) {
      this._drawOverlay(ctx, w, h);
    }

    this._needsUpdate = true;
  }

  _drawOverlay(ctx, w, h) {
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
}

export default GuiXR;
