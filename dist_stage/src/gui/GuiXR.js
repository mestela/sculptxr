import Enums from 'misc/Enums';
import TR from 'gui/GuiTR';
import Export from 'files/Export';
import { saveAs } from 'file-saver';
import Shader from 'render/ShaderLib';

const TAB_HEIGHT = 60;
const TABS = ['TOOLS', 'VIEW', 'FILES', 'HISTORY'];

class GuiXR {

  constructor(main) {
    this._main = main;
    this._gl = main._gl;

    this._canvas = document.createElement('canvas');
    this._canvas.width = 512;
    this._canvas.height = 512;
    this._ctx = this._canvas.getContext('2d');

    this._needsUpdate = true;
    this._textureAllocated = false;
    this._activeTab = 'TOOLS';

    this._cursor = { x: -1, y: -1, active: false };
    this._radius = 0.20; // Expose for VR Scene

    this._tabWidgets = {
      'TOOLS': [
        // Sliders
        { type: 'slider', id: 'radius', x: 20, y: 80, w: 200, h: 30, label: 'Rad', value: 0.20 },
        { type: 'slider', id: 'intensity', x: 20, y: 120, w: 200, h: 30, label: 'Int', value: 0.5 },

        // Voxel Sliders
        { type: 'slider', id: 'voxelRes', x: 240, y: 80, w: 200, h: 30, label: 'Res', value: 0.5 }, // 32..256
        { type: 'slider', id: 'voxelRad', x: 240, y: 120, w: 200, h: 30, label: 'Mult', value: 0.5 }, // 1..100

        // Tools (Grid 2xN)
        { type: 'button', id: Enums.Tools.BRUSH, label: 'Brush', x: 20, y: 170, w: 100, h: 40 },
        { type: 'button', id: Enums.Tools.INFLATE, label: 'Inflate', x: 130, y: 170, w: 100, h: 40 },
        { type: 'button', id: Enums.Tools.SMOOTH, label: 'Smooth', x: 20, y: 220, w: 100, h: 40 },
        { type: 'button', id: Enums.Tools.FLATTEN, label: 'Flatten', x: 130, y: 220, w: 100, h: 40 },
        { type: 'button', id: Enums.Tools.PINCH, label: 'Pinch', x: 20, y: 270, w: 100, h: 40 },
        { type: 'button', id: Enums.Tools.CREASE, label: 'Crease', x: 130, y: 270, w: 100, h: 40 },
        { type: 'button', id: Enums.Tools.DRAG, label: 'Drag', x: 20, y: 320, w: 100, h: 40 },
        { type: 'button', id: Enums.Tools.MOVE, label: 'Move', x: 130, y: 320, w: 100, h: 40 },
        { type: 'button', id: Enums.Tools.PAINT, label: 'Paint', x: 20, y: 370, w: 100, h: 40 },
        { type: 'button', id: Enums.Tools.TRANSFORM, label: 'Transform', x: 130, y: 370, w: 100, h: 40 },

        // Voxel Tool Highlight
        { type: 'button', id: Enums.Tools.VOXEL, label: 'VOXEL', x: 240, y: 170, w: 200, h: 40 },

        { type: 'button', id: Enums.Tools.MASKING, label: 'Mask', x: 240, y: 220, w: 100, h: 40 },
        { type: 'button', id: Enums.Tools.LOCALSCALE, label: 'L.Scale', x: 350, y: 220, w: 90, h: 40 },

        // Voxel Actions
        { type: 'button', id: 'bake', label: 'BAKE TO MESH', x: 240, y: 270, w: 200, h: 40 },

        // Dynamic Topology Toggle
        { type: 'toggle', id: 'dynamic', label: 'Dynamic Topology', x: 20, y: 440, w: 210, h: 40 }
      ],
      'VIEW': [
        { type: 'toggle', id: 'flat', label: 'Flat Shading', x: 20, y: 150, w: 200, h: 50 },
        { type: 'toggle', id: 'wireframe', label: 'Wireframe', x: 20, y: 80, w: 200, h: 50 },
        { type: 'toggle', id: 'symmetry', label: 'Symmetry', x: 20, y: 430, w: 200, h: 50 },
        { type: 'toggle', id: 'passthrough', label: 'Passthrough', x: 20, y: 220, w: 200, h: 50 },
        { type: 'info', label: '(Blinks during switch)', x: 230, y: 250 },
        { type: 'button', id: 'pbr', label: 'PBR', x: 20, y: 290, w: 200, h: 50 },
        { type: 'button', id: 'matcap', label: 'Matcap', x: 20, y: 360, w: 200, h: 50 }
      ],
      'FILES': [
        { type: 'button', id: 'reset', label: 'Reset Scene', x: 20, y: 80, w: 200, h: 50 },
        { type: 'button', id: 'export_obj', label: 'Export OBJ', x: 20, y: 150, w: 200, h: 50 },
        { type: 'button', id: 'import_obj', label: 'Import OBJ', x: 220, y: 150, w: 200, h: 50 },
        { type: 'button', id: 'export_stl', label: 'Export STL', x: 20, y: 220, w: 200, h: 50 },
        { type: 'info', label: 'Files save to browser', x: 20, y: 300 }
      ],
      'HISTORY': [
        { type: 'button', id: 'undo', label: 'Undo', x: 20, y: 80, w: 200, h: 60 },
        { type: 'button', id: 'redo', label: 'Redo', x: 20, y: 160, w: 200, h: 60 },
        { type: 'button', id: 'max_resolution', label: 'Subdivide', x: 20, y: 240, w: 200, h: 60 }
      ]
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
      // this._executeAction(w); // DISABLE UNTRUSTED POLLING EXECUTION
      this._needsUpdate = true;
      this.draw();
    }
  }

  onClick() {
    // Trusted Event Trigger
    const w = this._hoverWidget;
    if (!w) return;

    if (w.type === 'slider') return; // Sliders handled by onInteract

    if (w.type === 'slider') return; // Sliders handled by onInteract

    this._executeAction(w);

    // VISUAL FEEDBACK
    this._lastClick = performance.now();
    this._clickedWidget = w;
    setTimeout(() => { this._needsUpdate = true; this.draw(); }, 250); // Redraw to clear flash

    this._needsUpdate = true;
    this.draw();

  }

  _executeAction(w) {
    const main = this._main;
    if (!main) return;

    // TOOLS TAB
    if (this._activeTab === 'TOOLS') {
      if (w.type === 'button') {
        if (w.id === 'bake') {
          // Trigger Voxel Bake
          const tool = main.getSculptManager().getTool(Enums.Tools.VOXEL);
          if (tool && tool.bakeToMesh) {
            tool.bakeToMesh();
            // Switch to Brush? Optional.
            main.getSculptManager().setToolIndex(Enums.Tools.BRUSH);
          } else {
            console.warn("Bake failed: Voxel tool not ready.");
          }
        } else {
          main.getSculptManager().setToolIndex(w.id);
        }
      }
      if (w.id === 'dynamic') {
        // Reuse existing GuiTopology logic
        if (main._gui && main._gui._ctrlTopology) {
          main._gui._ctrlTopology.dynamicToggleActivate();
        }
      }
    }

    // VIEW TAB
    if (this._activeTab === 'VIEW') {
      const mesh = main.getMesh();

      if (!mesh) return;

      if (w.id === 'wireframe') {
        mesh.setShowWireframe(!mesh.getShowWireframe());
      } else if (w.id === 'flat') {
        mesh.setFlatShading(!mesh.getFlatShading());
      } else if (w.id === 'passthrough') {
        // Toggle Session Mode (AR <-> VR)
        main.toggleXRSession();
      } else if (w.id === 'symmetry') {
        const sm = main.getSculptManager();
        if (sm) {
          sm._symmetry = !sm._symmetry;
          // Force re-render if needed or just wait for next frame
          main.render();
        }
      } else if (w.id === 'pbr') {
        mesh.setShaderType(Enums.Shader.PBR);
      } else if (w.id === 'matcap') {
        mesh.setShaderType(Enums.Shader.MATCAP);
      }
      main.render();
    }

    // HISTORY TAB
    if (this._activeTab === 'HISTORY') {
      if (w.id === 'undo') {
        if (window.screenLog) window.screenLog("GuiXR: Undo Pressed", "yellow");
        main.getStateManager().undo();
      }
      if (w.id === 'redo') {
        main.getStateManager().redo();
      }
      if (w.id === 'max_resolution') {
        // Subdivide
        // Dynamic import or check if available? 
        // Usually internal calls. Let's try direct GuiSculpting access or direct logic
        // Simple generic Subdivision for now if possible, else skip
        // accessing main.gui._ctrlTopology.subdivide() is hacky but might work if GUI exists
        // Better:
        main.addHistoryState(new main.getStateManager().StateDynamic(main));
        // Actually real subdivision is complex. sticky.
        // Let's stick to Undo/Redo for now being safe.
      }
    }

    // FILES TAB
    if (this._activeTab === 'FILES') {
      if (w.id === 'reset') {
        if (confirm('Reset Scene?')) {
          main.clearScene();
          }
        }
      if (w.id === 'export_obj') {
        if (window.screenLog) window.screenLog("Exporting OBJ...", "yellow");

        // Export.exportOBJ signature: (meshes, colorZbrush, colorAppend)
        const meshes = main.getMeshes();
        const rawBlob = Export.exportOBJ(meshes, true, false);
        // Reslice with correct type to avoid .txt extension
        const blob = new Blob([rawBlob], { type: 'model/obj' });
        saveAs(blob, 'sculptgl_vr_export.obj');
        if (window.screenLog) window.screenLog("Saved to Downloads", "lime");
      }
      if (w.id === 'export_stl') Export.exportSTL(main);
      if (w.id === 'import_obj') {
        if (window.screenLog) window.screenLog("Importing...", "yellow");
        // Trigger the hidden file input
        const fileInput = document.getElementById('fileopen');
        if (fileInput) fileInput.click();
        else if (window.screenLog) window.screenLog("ERR: #fileopen not found", "red");
      }
    }
  }

  click() {
    if (!this._cursor.active) return;
    this.onInteract(this._cursor.x / this._canvas.width, this._cursor.y / this._canvas.height, true);
  }

  // FORCE DRAW (Bypass Throttle)
  forceDraw() {
    this._lastDraw = 0;
    this._needsUpdate = true;
    this.draw();
    this.updateTexture(); // Immediate upload attempt
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
      ctx.lineWidth = 1;
      ctx.strokeRect(tx, 0, tabWidth, TAB_HEIGHT);

      // Text
      ctx.fillStyle = isActive ? '#fff' : '#888';
      ctx.font = isActive ? 'bold 18px sans-serif' : '18px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(tab, tx + tabWidth / 2, TAB_HEIGHT / 2);

      // Active Indicator
      if (isActive) {
        ctx.fillStyle = '#00D0FF';
        ctx.fillRect(tx, TAB_HEIGHT - 4, tabWidth, 4);
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
        ctx.font = 'italic 16px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(wid.label, wid.x, wid.y);
        continue;
      }

      let isActive = false;
      // Determine active state for toggles/buttons
      if (this._activeTab === 'TOOLS' && wid.type === 'button') {
        isActive = (wid.id === activeTool);
      }
      // Highlight Dynamic Toggle
      if (this._activeTab === 'TOOLS' && wid.id === 'dynamic') {
        isActive = (mesh && mesh.isDynamic);
      }
      if (this._activeTab === 'VIEW') {
        if (wid.id === 'wireframe' && mesh) isActive = mesh.getShowWireframe();
        if (wid.id === 'flat' && mesh) isActive = mesh.getFlatShading();
        if (wid.id === 'symmetry' && this._main.getSculptManager()) isActive = this._main.getSculptManager().getSymmetry();
        if (wid.id === 'passthrough' && this._main) isActive = (this._main.getXRMode() === 'immersive-ar');
        if (wid.id === 'pbr' && mesh) isActive = (mesh.getShaderType() === Enums.Shader.PBR);
        if (wid.id === 'matcap' && mesh) isActive = (mesh.getShaderType() === Enums.Shader.MATCAP);
      }

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
      ctx.lineWidth = isActive ? 3 : 1;
      ctx.strokeRect(wid.x, wid.y, wid.w, wid.h);

      // Label
      ctx.fillStyle = 'white';
      ctx.textAlign = 'center';
      if (wid.type === 'slider') {
        ctx.textAlign = 'left';
        // Add Value to Label
        ctx.fillText(`${wid.label}: ${wid.value.toFixed(2)}`, wid.x + 10, wid.y + 25);
      } else {
        ctx.fillText(wid.label, wid.x + wid.w / 2, wid.y + wid.h / 2);
      }
    }

    // Cursor is now drawn by VRMenu.js as 3D geometry
    // This reduces latency (no texture upload needed just for cursor)

    // Main Border
    ctx.strokeStyle = '#00D0FF';
    ctx.lineWidth = 10;
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
