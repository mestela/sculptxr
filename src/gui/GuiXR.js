import Enums from 'misc/Enums';
import TR from 'gui/GuiTR';
import Export from 'files/Export';
import { saveAs } from 'file-saver';
import Shader from 'render/ShaderLib';
import Utils from 'misc/Utils';

// Modular Imports
import getToolsWidgets from 'gui/vr/GuiVRTools';
import getSceneWidgets from 'gui/vr/GuiVRScene';
import getRenderingWidgets from 'gui/vr/GuiVRRendering';
import getFilesWidgets from 'gui/vr/GuiVRFiles';
import getHistoryWidgets from 'gui/vr/GuiVRHistory';

const TAB_HEIGHT = 100;
const CANVAS_SIZE = 1024;
const TABS = ['TOOLS', 'SCENE', 'VIEW', 'FILES', 'HISTORY'];

const OVERLAY_BG = 'rgba(0, 0, 0, 0.8)';
const OVERLAY_W = 800;
const OVERLAY_H = 800;
const OVERLAY_X = (CANVAS_SIZE - OVERLAY_W) / 2;
const OVERLAY_Y = (CANVAS_SIZE - OVERLAY_H) / 2;

class GuiXR {

  constructor(main) {
    this._main = main;
    this._gl = main._gl;

    this._canvas = document.createElement('canvas');
    this._canvas.width = CANVAS_SIZE;
    this._canvas.height = CANVAS_SIZE;
    this._ctx = this._canvas.getContext('2d');

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
      'TOOLS': getToolsWidgets(main),
      'SCENE': getSceneWidgets(main),
      'VIEW': getRenderingWidgets(main),
      'FILES': getFilesWidgets(main),
      'HISTORY': getHistoryWidgets(main)
    };

    setTimeout(() => this.syncToolRadius(), 500);
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

    // Global Debounce (prevent double-firing across frames)
    const now = performance.now();
    if (now - this._inputDebounce < 250) return;
    this._inputDebounce = now;

    const cx = this._cursor.x;
    const cy = this._cursor.y;

    // 0. Check Overlay
    if (this._overlay) {
      this._handleOverlayInteract(cx, cy);
      return;
    }

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
    const widgets = this._getWidgets();
    for (let wid of widgets) {
      if (cx >= wid.x && cx <= wid.x + wid.w && cy >= wid.y && cy <= wid.y + wid.h) {
        console.log(`[GuiXR] Interacted with widget: ${wid.id} (${wid.type})`);
        this._handleWidgetClick(wid);
        return;
      }
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
    const padding = 40;
    const startX = OVERLAY_X + padding;
    const startY = OVERLAY_Y + 100;

    const svSize = 500;
    if (cx >= startX && cx <= startX + svSize && cy >= startY && cy <= startY + svSize) {
      const s = (cx - startX) / svSize;
      const v = 1.0 - (cy - startY) / svSize;
      if (this._overlayData.onSVChange) this._overlayData.onSVChange(s, v);
      this._needsUpdate = true;
      this.draw();
      return;
    }

    const hueX = startX + svSize + 40;
    const hueW = 80;
    const hueH = svSize;
    if (cx >= hueX && cx <= hueX + hueW && cy >= startY && cy <= startY + hueH) {
      const h = (cy - startY) / hueH;
      if (this._overlayData.onHueChange) this._overlayData.onHueChange(h);
      this._needsUpdate = true;
      this.draw();
      return;
    }

    const btnY = startY + svSize + 40;
    const btnH = 80;
    if (cy >= btnY && cy <= btnY + btnH) {
      if (this._overlayData.onConfirm) this._overlayData.onConfirm();
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
          this._main.render();
        }
      }
    } else if (w.type === 'combobox') {
      let opts = [];
      let cb = null;

      const ShaderMatcap = Shader[Enums.Shader.MATCAP];
      const ShaderPBR = Shader[Enums.Shader.PBR];

      if (w.id === 'matcap') {
        if (ShaderMatcap && ShaderMatcap.matcaps) {
          opts = ShaderMatcap.matcaps.map((m, i) => ({ label: m.name, id: i }));
        } else {
          console.error("[GuiXR] ShaderMatcap.matcaps not found!", ShaderMatcap);
        }
        cb = (id) => {
          this._main.getMesh().setShaderType(Enums.Shader.MATCAP);
          this._main.getMesh().setMatcap(id);
          this._main.render();
        };
      } else if (w.id === 'environment') {
        if (ShaderPBR && ShaderPBR.environments) {
          opts = ShaderPBR.environments.map((e, i) => ({ label: e.name, id: i }));
        } else {
          console.error("[GuiXR] ShaderPBR.environments not found!", ShaderPBR);
        }
        cb = (id) => {
          this._main.getMesh().setShaderType(Enums.Shader.PBR);
          ShaderPBR.idEnv = id;
          this._main.render();
        };
      }

      if (opts.length > 0) {
        this.openOverlay('combobox', { title: w.label || 'Select', options: opts, callback: cb });
      } else {
        console.warn("[GuiXR] No options for combobox: " + w.id);
      }

    } else if (w.type === 'color') {
      let hue = 0.0;
      let sat = 1.0;
      let val = 1.0;

      this.openOverlay('colorpicker', {
        hue, sat, val,
        onSVChange: (s, v) => { },
        onHueChange: (h) => { },
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
    if (w.id === 'reset') if (confirm('Reset Scene?')) main.clearScene();
    if (typeof w.id === 'number') main.getSculptManager().setToolIndex(w.id);
    if (w.id === 'bake') main.getSculptManager().getTool(Enums.Tools.VOXEL)?.bakeToMesh();
    if (w.id === 'dynamic') main._gui?._ctrlTopology?.dynamicToggleActivate();
    if (w.id === 'wireframe') main.getMesh()?.setShowWireframe(!main.getMesh().getShowWireframe());
    if (w.id === 'flat') main.getMesh()?.setFlatShading(!main.getMesh().getFlatShading());
    if (w.id === 'passthrough') main.toggleXRSession();
    if (w.id === 'symmetry') main.getSculptManager()._symmetry = !main.getSculptManager()._symmetry;
    if (w.id === 'pbr') main.getMesh()?.setShaderType(Enums.Shader.PBR);
    if (w.id === 'matcap') main.getMesh()?.setShaderType(Enums.Shader.MATCAP);
    if (w.id === 'undo') main.getStateManager().undo();
    if (w.id === 'redo') main.getStateManager().redo();

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
    const now = performance.now();
    if (!this._lastDraw) this._lastDraw = 0;
    if (now - this._lastDraw < 30) return;
    this._lastDraw = now;

    const ctx = this._ctx;
    const w = this._canvas.width;
    const h = this._canvas.height;

    // Background
    ctx.fillStyle = '#222';
    ctx.fillRect(0, 0, w, h);

    // --- DRAW TABS ---
    const tabWidth = w / TABS.length;
    TABS.forEach((tab, i) => {
      const isActive = (tab === this._activeTab);
      const tx = i * tabWidth;
      ctx.fillStyle = isActive ? '#444' : '#333';
      ctx.fillRect(tx, 0, tabWidth, TAB_HEIGHT);
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 2;
      ctx.strokeRect(tx, 0, tabWidth, TAB_HEIGHT);
      ctx.fillStyle = isActive ? '#fff' : '#888';
      ctx.font = isActive ? 'bold 36px sans-serif' : '36px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(tab, tx + tabWidth / 2, TAB_HEIGHT / 2);
      if (isActive) {
        ctx.fillStyle = '#00D0FF';
        ctx.fillRect(tx, TAB_HEIGHT - 6, tabWidth, 6);
      }
    });

    // --- DRAW WIDGETS ---
    const widgets = this._getWidgets();
    const mesh = this._main ? this._main.getMesh() : null;
    let activeTool = -1;
    if (this._main?.getSculptManager) activeTool = this._main.getSculptManager().getToolIndex();

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
      if (wid.id === 'passthrough' && this._main) isActive = (this._main.getXRMode() === 'immersive-ar');
      if (wid.id === 'pbr' && mesh) isActive = (mesh.getShaderType() === Enums.Shader.PBR);
      if (wid.id === 'matcap' && mesh) isActive = (mesh.getShaderType() === Enums.Shader.MATCAP);

      ctx.fillStyle = isActive ? '#00A040' : '#444';
      if (wid.type === 'slider') ctx.fillStyle = '#555';
      if (wid.type === 'combobox') ctx.fillStyle = '#334455';
      if (wid.type === 'color') ctx.fillStyle = '#111';

      if (this._clickedWidget === wid && this._lastClick && (performance.now() - this._lastClick < 200)) ctx.fillStyle = '#fff';

      ctx.fillRect(wid.x, wid.y, wid.w, wid.h);

      if (wid.type === 'slider') {
        ctx.fillStyle = '#0070A0';
        ctx.fillRect(wid.x, wid.y, wid.w * wid.value, wid.h);
      }

      if (wid.type === 'color') {
        ctx.fillStyle = 'red';
        ctx.fillRect(wid.x + 10, wid.y + 10, wid.w - 20, wid.h - 20);
      }

      ctx.strokeStyle = isActive ? '#fff' : '#888';
      ctx.lineWidth = isActive ? 4 : 2;
      ctx.strokeRect(wid.x, wid.y, wid.w, wid.h);

      ctx.fillStyle = 'white';
      ctx.textAlign = 'center';
      ctx.font = '28px sans-serif';
      if (wid.type === 'slider') {
        ctx.textAlign = 'left';
        ctx.fillText(`${wid.label}: ${wid.value.toFixed(2)}`, wid.x + 20, wid.y + wid.h / 2 + 10);
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
    ctx.fillStyle = '#888';
    ctx.font = '30px sans-serif';
    ctx.fillText('Color Picker Implementation Pending', startX, startY + 50);
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
