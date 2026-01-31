import Enums from 'misc/Enums';
import TR from 'gui/GuiTR';
import Export from 'files/Export';
import { saveAs } from 'file-saver';
import Shader from 'render/ShaderLib';

// Modular Imports
import getToolsWidgets from 'gui/vr/GuiVRTools';
import getSceneWidgets from 'gui/vr/GuiVRScene';
import getRenderingWidgets from 'gui/vr/GuiVRRendering';
import getFilesWidgets from 'gui/vr/GuiVRFiles';
import getHistoryWidgets from 'gui/vr/GuiVRHistory';

const TAB_HEIGHT = 100;
const CANVAS_SIZE = 1024;
const TABS = ['TOOLS', 'SCENE', 'VIEW', 'FILES', 'HISTORY'];

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
    this._radius = 0.20; // Expose for VR Scene

    // Initialize Widgets
    // We bind 'main' here, but note that main might not be fully ready in constructor.
    // However, the widget generators just return config objects, they don't execute logic yet.
    this._tabWidgets = {
      'TOOLS': getToolsWidgets(main),
      'SCENE': getSceneWidgets(main),
      'VIEW': getRenderingWidgets(main),
      'FILES': getFilesWidgets(main),
      'HISTORY': getHistoryWidgets(main)
    };

    // Sync initial radius to tool
    setTimeout(() => this.syncToolRadius(), 500); 
  }

  init(gl) {
    if (this._texture) return; // Already init
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
    // this.draw(); // DECOUPLED: Cursor is 3D now. No texture update needed just for motion.
  }

  _updateHover() {
    if (!this._cursor.active) {
      this._hoverWidget = null;
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

  _getWidgets() {
    return this._tabWidgets[this._activeTab] || [];
  }

  onInteract(u, v, isPressed) {
    if (!this._cursor.active || !isPressed) return;

    const cx = this._cursor.x;
    const cy = this._cursor.y;
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
        this._handleWidgetClick(wid);
        return;
      }
    }
  }

  _handleWidgetClick(w) {
    const now = performance.now();
    if (!this._lastClick) this._lastClick = 0;

    // Allow external force updates to bypass debounce if needed, or just handle slider drag
    if (now - this._lastClick < 200 && w.type !== 'slider') return; 

    if (w.type === 'slider') {
      const val = Math.max(0, Math.min(1, (this._cursor.x - w.x) / w.w));
      w.value = val;
      this._needsUpdate = true;
      this.draw();

      // Throttled Callback for sliders
      if (!this._lastSliderCallback) this._lastSliderCallback = 0;
      if (now - this._lastSliderCallback > 30) {
        this._lastSliderCallback = now;
        if (this._main) {
          if (w.id === 'radius') {
            this.updateRadius(val);
          }
          if (w.id === 'intensity') this._main.getSculptManager().getCurrentTool().setIntensity(val);

          // Voxel Specific Callbacks
          if (w.id === 'voxelRes') {
            var tool = this._main.getSculptManager().getTool(Enums.Tools.VOXEL);
            if (tool && tool.setResolution) {
              // Map 0..1 to 32..256
              var res = Math.floor(32 + val * (256 - 32));
              tool.setResolution(res);
            }
          }
          if (w.id === 'voxelRad') {
            var tool = this._main.getSculptManager().getTool(Enums.Tools.VOXEL);
            if (tool && tool.setRadiusMultiplier) {
              // Map 0..1 to 1..100
              var mult = 1.0 + val * 99.0;
              tool.setRadiusMultiplier(mult);
            }
          }

          // Force 3D Render for immediate feedback
          this._main.render();
        }
      }
    } else {
      // Buttons / Toggles: VISUAL ONLY (Action via onClick)
      this._lastClick = now;
      this._needsUpdate = true;
      this.draw();
      this.onClick(); // Immediate Action Trigger? Or wait? 
      // Original logic separated visual update from action, but here we can just call it.
      // Actually `onClick` calls _executeAction. 
      // But `onInteract` calls `_handleWidgetClick`.
      // The original `onInteract` for buttons fell through to `this.draw()`.
      // Then `onClick` (from `Scene.js`?) was called?
      // Wait, `Scene.js` calls `onInteract` with `isPressed`. 
      // It DOES NOT call `onClick` automatically.
      // I should call `_executeAction` here for buttons if pressed.
      this._executeAction(w);
    }
  }

  onClick() {
    // Re-implement if needed, but _handleWidgetClick seems to cover it
    // This was used for "Trusted" clicks?
  }

  _executeAction(w) {
    const main = this._main;
    if (!main) return;

    if (w.type === 'slider' || w.type === 'info') return;

    // --- GENERIC ACTIONS BY ID ---
    // Scene Actions
    if (w.id === 'addSphere') main.addSphere();
    if (w.id === 'addCube') main.addCube();
    if (w.id === 'addCylinder') main.addCylinder();
    if (w.id === 'addTorus') main.addTorus();
    if (w.id === 'reset') {
      if (confirm('Reset Scene?')) main.clearScene();
    }

    // Tools
    if (typeof w.id === 'number') { // Tool Enum
      main.getSculptManager().setToolIndex(w.id);
    }

    // Voxel
    if (w.id === 'bake') {
      const tool = main.getSculptManager().getTool(Enums.Tools.VOXEL);
      if (tool && tool.bakeToMesh) tool.bakeToMesh();
    }
    if (w.id === 'dynamic') {
      if (main._gui && main._gui._ctrlTopology) {
        main._gui._ctrlTopology.dynamicToggleActivate();
      }
    }

    // View / Rendering
    if (w.id === 'wireframe') {
      const mesh = main.getMesh();
      if (mesh) mesh.setShowWireframe(!mesh.getShowWireframe());
    }
    if (w.id === 'flat') {
      const mesh = main.getMesh();
      if (mesh) mesh.setFlatShading(!mesh.getFlatShading());
    }
    if (w.id === 'passthrough') {
      main.toggleXRSession();
    }
    if (w.id === 'symmetry') {
      const sm = main.getSculptManager();
      if (sm) sm._symmetry = !sm._symmetry;
    }
    if (w.id === 'pbr') {
      const mesh = main.getMesh();
      if (mesh) mesh.setShaderType(Enums.Shader.PBR);
    }
    if (w.id === 'matcap') {
      const mesh = main.getMesh();
      if (mesh) mesh.setShaderType(Enums.Shader.MATCAP);
    }

    // History
    if (w.id === 'undo') main.getStateManager().undo();
    if (w.id === 'redo') main.getStateManager().redo();
    if (w.id === 'max_resolution') {
      // Subdivide - Minimal implementation for now
      // main.addHistoryState(new main.getStateManager().StateDynamic(main));
      // Need access to Remesh or Topology?
      // Let's print info for now or try standard subdiv
      console.log("Subdivision not fully bridged yet");
    }

    // Files
    if (w.id === 'export_obj') {
        const meshes = main.getMeshes();
      const rawBlob = Export.exportOBJ(meshes, true, false);
        const blob = new Blob([rawBlob], { type: 'model/obj' });
      saveAs(blob, 'sculptgl_vr_export.obj');
    }
    if (w.id === 'export_stl') Export.exportSTL(main);
    if (w.id === 'import_obj') {
        const fileInput = document.getElementById('fileopen');
      if (fileInput) fileInput.click();
    }

    // Visual Feedback
    this._clickedWidget = w;
    this._lastClick = performance.now();
    setTimeout(() => { this._needsUpdate = true; this.draw(); }, 250);
    this._needsUpdate = true;
    main.render();
  }

  click() {
    // Debug helper? Or used by mouse interaction?
    if (!this._cursor.active) return;
    this.onInteract(this._cursor.x / this._canvas.width, this._cursor.y / this._canvas.height, true);
  }

  forceDraw() {
    this._lastDraw = 0;
    this._needsUpdate = true;
    this.draw();
    this.updateTexture(); 
  }

  draw() {
    // Throttle Draw (30fps)
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

      // Tab Border
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 2;
      ctx.strokeRect(tx, 0, tabWidth, TAB_HEIGHT);

      // Text
      ctx.fillStyle = isActive ? '#fff' : '#888';
      ctx.font = isActive ? 'bold 36px sans-serif' : '36px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(tab, tx + tabWidth / 2, TAB_HEIGHT / 2);

      // Active Indicator
      if (isActive) {
        ctx.fillStyle = '#00D0FF';
        ctx.fillRect(tx, TAB_HEIGHT - 6, tabWidth, 6);
      }
    });

    // --- DRAW WIDGETS ---
    const widgets = this._getWidgets();
    const mesh = this._main ? this._main.getMesh() : null;
    let activeTool = -1;
    if (this._main && this._main.getSculptManager && this._main.getSculptManager()) {
      activeTool = this._main.getSculptManager().getToolIndex();
    }

    for (let wid of widgets) {
      if (wid.type === 'info') {
        ctx.fillStyle = '#888';
        ctx.font = 'italic 28px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(wid.label, wid.x, wid.y);
        continue;
      }

      let isActive = false;
      // Determine active state for toggles/buttons
      if (wid.type === 'button' && typeof wid.id === 'number') {
        isActive = (wid.id === activeTool);
      }
      if (wid.id === 'dynamic' && mesh) isActive = mesh.isDynamic;
      if (wid.id === 'wireframe' && mesh) isActive = mesh.getShowWireframe();
      if (wid.id === 'flat' && mesh) isActive = mesh.getFlatShading();
      if (wid.id === 'symmetry' && this._main.getSculptManager()) isActive = this._main.getSculptManager().getSymmetry();
      if (wid.id === 'passthrough' && this._main) isActive = (this._main.getXRMode() === 'immersive-ar');
      if (wid.id === 'pbr' && mesh) isActive = (mesh.getShaderType() === Enums.Shader.PBR);
      if (wid.id === 'matcap' && mesh) isActive = (mesh.getShaderType() === Enums.Shader.MATCAP);

      // Draw active background
      ctx.fillStyle = isActive ? '#00A040' : '#444';
      if (wid.type === 'slider') ctx.fillStyle = '#555';

      // Click Flash
      if (this._clickedWidget === wid && this._lastClick && (performance.now() - this._lastClick < 200)) {
        ctx.fillStyle = '#fff';
      }

      ctx.fillRect(wid.x, wid.y, wid.w, wid.h);

      // Slider Fill
      if (wid.type === 'slider') {
        ctx.fillStyle = '#0070A0';
        ctx.fillRect(wid.x, wid.y, wid.w * wid.value, wid.h);
      }

      // Border
      ctx.strokeStyle = isActive ? '#fff' : '#888';
      ctx.lineWidth = isActive ? 4 : 2;
      ctx.strokeRect(wid.x, wid.y, wid.w, wid.h);

      // Label
      ctx.fillStyle = 'white';
      ctx.textAlign = 'center';
      ctx.font = '28px sans-serif';
      if (wid.type === 'slider') {
        ctx.textAlign = 'left';
        ctx.fillText(`${wid.label}: ${wid.value.toFixed(2)}`, wid.x + 20, wid.y + wid.h / 2 + 10);
      } else {
        ctx.fillText(wid.label, wid.x + wid.w / 2, wid.y + wid.h / 2 + 10);
      }
    }

    // Main Border
    ctx.strokeStyle = '#00D0FF';
    ctx.lineWidth = 15;
    ctx.strokeRect(0, 0, w, h);

    this._needsUpdate = true;
  }

  updateTexture() {
    if (!this._needsUpdate || !this._texture) return;

    // Throttle: Limit to 30fps
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

  getTexture() {
    return this._texture;
  }

  syncToolRadius() {
    var tool = this._main.getSculptManager().getCurrentTool();
    if (tool) tool.setRadius(this._radius * 100);
  }

  getCursorUV() {
    if (!this._cursor.active) return null;
    return {
      u: this._cursor.x / this._canvas.width,
      v: this._cursor.y / this._canvas.height
    };
  }

  updateRadius(val) {
    this._radius = val;
    // Update Widgets in ALL tabs where radius might appear?
    // In our case only TOOLS tab has radius.
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
