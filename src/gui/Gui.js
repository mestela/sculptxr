import yagui from 'yagui';
import TR from './GuiTR.js';
import GuiBackground from './GuiBackground.js';
import GuiCamera from './GuiCamera.js';
import GuiConfig from './GuiConfig.js';
import GuiFiles from './GuiFiles.js';
import GuiMesh from './GuiMesh.js';
import GuiTopology from './GuiTopology.js';
import GuiRendering from './GuiRendering.js';
import GuiScene from './GuiScene.js';
import GuiSculpting from './GuiSculpting.js';
import GuiStates from './GuiStates.js';
import GuiTablet from './GuiTablet.js';
import GuiTimeline from './GuiTimeline.js';
import GuiAnimation from './GuiAnimation.js';
import GuiBlendshapes from './GuiBlendshapes.js';
import ShaderContour from '../render/shaders/ShaderContour.js';
import getOptionsURL from '../misc/getOptionsURL.js';

import Export from '../files/Export.js';

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

class Gui {

  constructor(main) {
    this._main = main;

    this._guiMain = null;
    this._sidebar = null;
    this._topbar = null;

    this._ctrlTablet = null;
    this._ctrlFiles = null;
    this._ctrlScene = null;
    this._ctrlStates = null;
    this._ctrlCamera = null;
    this._ctrlBackground = null;

    this._ctrlSculpting = null;
    this._ctrlTopology = null;
    this._ctrlRendering = null;
    this._ctrlAnimation = null;
    this._ctrlTimeline = null;

    this._ctrlNotification = null;

    this._ctrls = []; // list of controllers

    // upload
    this._notifications = {};
    this._xhrs = {};
  }

  initGui() {
    this.deleteGui();

    this._guiMain = new yagui.GuiMain(this._main.getViewport(), this._main.onCanvasResize.bind(this._main));

    var ctrls = this._ctrls;
    ctrls.length = 0;
    var idc = 0;

    // Initialize the topbar
    this._topbar = this._guiMain.addTopbar();
    ctrls[idc++] = this._ctrlFiles = new GuiFiles(this._topbar, this);
    // this.initPrint(this._topbar);
    ctrls[idc++] = this._ctrlScene = new GuiScene(this._topbar, this);
    ctrls[idc++] = this._ctrlStates = new GuiStates(this._topbar, this);
    ctrls[idc++] = this._ctrlBackground = new GuiBackground(this._topbar, this);
    ctrls[idc++] = this._ctrlCamera = new GuiCamera(this._topbar, this);
    // TODO find a way to get pressure event
    ctrls[idc++] = this._ctrlTablet = new GuiTablet(this._topbar, this);
    ctrls[idc++] = this._ctrlConfig = new GuiConfig(this._topbar, this);
    ctrls[idc++] = this._ctrlMesh = new GuiMesh(this._topbar, this);

    // Initialize the sidebar
    this._sidebar = this._guiMain.addRightSidebar();

    // Set a wider layout to perfectly house both the vertical tab strip and full width folders
    this._sidebar.domSidebar.style.width = '380px';
    this._sidebar.domResize.style.right = '380px';

    // Create Blender-inspired vertical tab group inside the sidebar
    const tabGroup = document.createElement('wa-tab-group');
    tabGroup.setAttribute('placement', 'start');
    tabGroup.className = 'sidebar-tab-group wa-dark';
    tabGroup.style.height = '100%';
    tabGroup.style.width = '100%';
    
    const tabStyle = document.createElement('style');
    tabStyle.innerHTML = `
      /* Override the default yagui sidebar overflow to prevent double scrollbars */
      .gui-sidebar {
        overflow: hidden !important;
        background-color: #121212 !important;
        padding-bottom: 0 !important;
        border-left: 1px solid #2d2d2d !important;
        border-right: none !important;
      }
      
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
      .sidebar-tab-group wa-tab wa-icon {
        font-size: 18px;
      }
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
      
      /* Hide folder headers inside the tab panels so widgets fill space beautifully */
      .sidebar-tab-group wa-tab-panel .gui-ul > label {
        display: none !important;
      }
      .sidebar-tab-group wa-tab-panel .gui-ul {
        margin: 0 !important;
        padding: 0 !important;
        border: none !important;
        background: transparent !important;
      }
      .sidebar-tab-group wa-tab-panel .gui-ul > li {
        border: none !important;
        background: transparent !important;
      }

      /* Ensure button grids and buttons inside tab-panels never cause horizontal overflows */
      .sidebar-tab-group wa-tab-panel .btn-grid {
        display: flex;
        gap: 4px;
        width: 100% !important;
        box-sizing: border-box;
      }
      .sidebar-tab-group wa-tab-panel .btn-grid wa-button {
        flex: 1;
        min-width: 0 !important;
      }
      .sidebar-tab-group wa-tab-panel .btn-grid wa-button::part(base) {
        padding: 0 !important;
        min-width: 0 !important;
      }

      /* Premium Tool Grid Buttons */
      .grid-tool-btn::part(base) {
        font-family: 'Inter', sans-serif;
        font-weight: 600;
        font-size: 10px;
        letter-spacing: 0.3px;
        border-radius: 4px;
        height: 32px;
        padding: 0 4px !important;
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
        white-space: normal !important;
        word-break: break-word;
        line-height: 1.1;
        background-color: var(--btn-bg) !important;
        border: 1px solid var(--btn-border) !important;
        color: var(--btn-color) !important;
        box-shadow: var(--btn-shadow) !important;
        transition: all 0.15s ease;
      }
      .grid-tool-btn:hover::part(base) {
        filter: brightness(1.2);
        cursor: pointer;
      }
    `;
    tabGroup.appendChild(tabStyle);

    const createTab = (panelName, iconName, tooltipText) => {
      const tab = document.createElement('wa-tab');
      tab.setAttribute('slot', 'nav');
      tab.setAttribute('panel', panelName);
      tab.setAttribute('title', tooltipText);
      
      const icon = document.createElement('wa-icon');
      icon.setAttribute('name', iconName);
      tab.appendChild(icon);
      return tab;
    };

    // Create tabs for Rendering, Topology, Sculpting, Animation
    const renderingTab = createTab('rendering', 'camera', TR('renderingTitle'));
    const topologyTab = createTab('topology', 'circle-nodes', TR('topologyTitle'));
    const sculptingTab = createTab('sculpting', 'paintbrush', TR('sculptTitle'));
    const animationTab = createTab('animation', 'bezier-curve', 'Animation');

    // Sculpting is the active panel on startup
    sculptingTab.setAttribute('active', '');

    tabGroup.appendChild(renderingTab);
    tabGroup.appendChild(topologyTab);
    tabGroup.appendChild(sculptingTab);
    tabGroup.appendChild(animationTab);

    // Create corresponding tab panels
    const renderingPanel = document.createElement('wa-tab-panel');
    renderingPanel.setAttribute('name', 'rendering');
    
    const topologyPanel = document.createElement('wa-tab-panel');
    topologyPanel.setAttribute('name', 'topology');
    
    const sculptingPanel = document.createElement('wa-tab-panel');
    sculptingPanel.setAttribute('name', 'sculpting');
    
    const animationPanel = document.createElement('wa-tab-panel');
    animationPanel.setAttribute('name', 'animation');

    tabGroup.appendChild(renderingPanel);
    tabGroup.appendChild(topologyPanel);
    tabGroup.appendChild(sculptingPanel);
    tabGroup.appendChild(animationPanel);

    this._sidebar.domSidebar.appendChild(tabGroup);

    // Routing helper to map widget creations dynamically to the appropriate panels using native Web Awesome controls
    const makeTabParent = (panelDom) => {
      return {
        domSidebar: panelDom,
        addMenu: (name) => {
          return new WebAwesomeFolderMock(name, panelDom, this._sidebar);
        }
      };
    };

    ctrls[idc++] = this._ctrlRendering = new GuiRendering(makeTabParent(renderingPanel), this);
    ctrls[idc++] = this._ctrlTopology = new GuiTopology(makeTabParent(topologyPanel), this);
    ctrls[idc++] = this._ctrlSculpting = new GuiSculpting(makeTabParent(sculptingPanel), this);
    ctrls[idc++] = this._ctrlAnimation = new GuiAnimation(animationPanel, this);
    ctrls[idc++] = this._ctrlBlendshapes = new GuiBlendshapes(this._ctrlAnimation._blendshapesContent, this);

    // Initialize custom timeline panel
    this._ctrlTimeline = new GuiTimeline(this._main);
    this._ctrlTimeline.setVisibility(false);

    // gui extra
    var extra = this._topbar.addExtra();
    // Extra : Настройка интерфейса
    extra.addTitle(TR('contour'));
    extra.addColor(TR('contourColor'), ShaderContour.color, this.onContourColor.bind(this));

    extra.addTitle(TR('resolution'));
    extra.addSlider('', this._main._pixelRatio, this.onPixelRatio.bind(this), 0.5, 2.0, 0.02);

    extra.addTitle('Voxel Settings');
    extra.addSlider('Res', 128, this.onVoxelRes.bind(this), 32, 256, 16);
    extra.addSlider('Rad Mult', 50.0, this.onVoxelRad.bind(this), 1.0, 100.0, 1.0);

    extra.addTitle('Advanced');
    const controllerOptions = ['Auto', 'meta-quest-touch-plus', 'meta-quest-touch-plus-v2', 'meta-quest-touch-pro', 'oculus-touch-v3', 'oculus-touch-v2', 'valve-index', 'htc-vive', 'samsung-galaxyxr', 'samsung-odyssey'];
    let currentIndex = controllerOptions.indexOf(window._xrControllerOverride);
    if (currentIndex === -1) currentIndex = 0;
    
    extra.addCombobox('Controller Model', currentIndex, (val) => {
      window._xrControllerOverride = controllerOptions[parseInt(val, 10)];
      if (window._scene) window._scene.render(); // Just trigger render to be safe
    }, controllerOptions);
    extra.addCheckbox('Force Grey Controllers', window._forceGreyControllers === true, (val) => {
      window._forceGreyControllers = val;
    });
    const opts = getOptionsURL();
    extra.addCheckbox('Show Debug Log', opts.debugMode, (val) => {
      window._showDebugLog = val;
      getOptionsURL.saveOption('debugMode', val);
      const log = document.getElementById('log');
      if (log) log.style.display = val ? 'block' : 'none';
      if (val && window.screenLog) window.screenLog("Debug Log Enabled", "lime");
    });

    extra.addCheckbox('Show Eruda Console', false, (val) => {
      if (val) {
        if (!window.eruda) {
          const script = document.createElement('script');
          script.src = 'https://cdn.jsdelivr.net/npm/eruda';
          script.onload = () => {
            window.eruda.init();
            window.eruda.show();
          };
          document.head.appendChild(script);
        } else {
          window.eruda.show();
          // Force show button if it was hidden
          const container = document.querySelector('.eruda-container');
          if (container && container.shadowRoot) {
            const btn = container.shadowRoot.querySelector('.eruda-entry-btn');
            if (btn) btn.style.setProperty('display', 'block', 'important');
          }
        }
      } else {
        if (window.eruda) {
          window.eruda.hide();
          // Hide button
          const container = document.querySelector('.eruda-container');
          if (container && container.shadowRoot) {
            const btn = container.shadowRoot.querySelector('.eruda-entry-btn');
            if (btn) btn.style.setProperty('display', 'none', 'important');
          }
        }
      }
    });
    
    const log = document.getElementById('log');
    if (log) log.style.display = opts.debugMode ? 'block' : 'none';

    extra.addButton('Clear Log', () => {
      const logContainer = document.getElementById('log');
      if (logContainer) {
        // Keep the first child if it's a button (the Copy Log button)
        while (logContainer.children.length > 1) {
          logContainer.removeChild(logContainer.lastChild);
        }
        if (window.screenLog) window.screenLog("Log Cleared", "lime");
      }
    });

    this.addAboutButton();

    this.updateMesh();
    this.setVisibility(true);

    if (window.postprocessGui) window.postprocessGui();
  }

  getNotification(notifName) {
    var notif = this._notifications[notifName];
    if (!notif) {
      notif = this._topbar.addMenu();
      notif.isVisible = function () {
        return !this.domContainer.hidden;
      };
      notif.setMessage = function (msg) {
        this.domContainer.innerHTML = msg;
        this.setVisibility(!!msg);
      };

      notif.domContainer.style.color = 'red';
      notif.setMessage('');

      this._notifications[notifName] = notif;
      return notif;
    }

    if (this._xhrs[notifName] && notif.isVisible()) {
      if (window.confirm('Abort ' + notifName + ' previous upload?')) {
        this._xhrs[notifName].abort();
        this._xhrs[notifName].isAborted = true;
        notif.setMessage(null);
      }
      return;
    }

    return notif;
  }

  initPrint(guiParent) {
    var menu = guiParent.addMenu('Print it!');
    // menu.addButton('with Sculpteo', this, 'exportSculpteo');
    menu.addButton('Go to Materialise!', this, 'exportMaterialise');
  }

  exportSculpteo() {
    this._export('sculpteo');
  }

  exportMaterialise() {
    if (window.confirm('A new webpage will be opened. Start upload?')) {
      this._export('materialise');
    }
  }

  exportSketchfab() {
    this._export('sketchfab');
  }

  _export(notifName) {
    var mesh = this._main.getMesh();
    if (!mesh) return;

    var notif = this.getNotification(notifName);
    if (!notif) return;

    var fName = 'export' + notifName.charAt(0).toUpperCase() + notifName.slice(1);
    this._xhrs[notifName] = Export[fName](this._main, notif);
  }

  onVoxelRes(val) {
    if (!this._main._sculptManager) return;
    var tool = this._main._sculptManager.getTool(13); // Enums.Tools.VOXEL = 13
    if (tool && tool.setResolution) tool.setResolution(val);
  }

  onVoxelRad(val) {
    if (!this._main._sculptManager) return;
    var tool = this._main._sculptManager.getTool(13);
    if (tool && tool.setRadiusMultiplier) tool.setRadiusMultiplier(val);
  }

  onPixelRatio(val) {
    this._main._pixelRatio = val;
    this._main.onCanvasResize();
  }

  onContourColor(col) {
    ShaderContour.color[0] = col[0];
    ShaderContour.color[1] = col[1];
    ShaderContour.color[2] = col[2];
    ShaderContour.color[3] = col[3];
    this._main.render();
  }

  addAboutButton() {
    var ctrlAbout = this._topbar.addMenu();
    ctrlAbout.domContainer.innerHTML = TR('about');
    ctrlAbout.domContainer.addEventListener('mousedown', function () {
      window.open('http://stephaneginier.com', '_blank');
    });
  }

  updateMesh() {
    if (!this._ctrlRendering) return;
    this._ctrlRendering.updateMesh();
    this._ctrlTopology.updateMesh();
    this._ctrlSculpting.updateMesh();
    this._ctrlScene.updateMesh();
    if (this._ctrlBlendshapes) this._ctrlBlendshapes.updateMesh();
    this.updateMeshInfo();
  }

  updateMeshInfo() {
    this._ctrlMesh.updateMeshInfo();
  }

  getFlatShading() {
    return this._ctrlRendering.getFlatShading();
  }

  getWireframe() {
    return this._ctrlRendering.getWireframe();
  }

  getShaderType() {
    return this._ctrlRendering.getShaderType();
  }

  addAlphaOptions(opts) {
    this._ctrlSculpting.addAlphaOptions(opts);
  }

  deleteGui() {
    if (!this._guiMain || !this._guiMain.domMain.parentNode)
      return;
    this.callFunc('removeEvents');
    this.setVisibility(false);
    
    if (this._ctrlTimeline && this._ctrlTimeline._container && this._ctrlTimeline._container.parentNode) {
      this._ctrlTimeline._container.parentNode.removeChild(this._ctrlTimeline._container);
    }
    
    this._guiMain.domMain.parentNode.removeChild(this._guiMain.domMain);
  }

  setVisibility(bool) {
    this._guiMain.setVisibility(bool);
  }

  callFunc(func, event) {
    for (var i = 0, ctrls = this._ctrls, nb = ctrls.length; i < nb; ++i) {
      var ct = ctrls[i];
      if (ct && ct[func])
        ct[func](event);
    }
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
    
    // Stop keyboard events from bubbling up to the main app
    this.container.addEventListener('keydown', (e) => e.stopPropagation());
    this.container.addEventListener('keyup', (e) => e.stopPropagation());
    
    this.panelDom.appendChild(this.container);
  }

  close() {}
  open() {}

  setVisibility(visible) {
    this.container.style.display = visible ? '' : 'none';
  }

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

    return {
      domTitle: title,
      setVisibility: (visible) => { title.style.display = visible ? '' : 'none'; }
    };
  }

  addSlider(name, valueOrObject, callbackOrProperty, min, max, step) {
    let initialVal = 0;
    let onChange = null;

    if (typeof callbackOrProperty === 'string' && typeof valueOrObject === 'object') {
      const obj = valueOrObject;
      const prop = callbackOrProperty;
      initialVal = parseFloat(obj[prop]);
      onChange = (val) => {
        obj[prop] = val;
      };
    } else {
      initialVal = parseFloat(valueOrObject);
      onChange = (val) => {
        if (typeof callbackOrProperty === 'function') {
          callbackOrProperty(val);
        }
      };
    }

    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.flexDirection = 'column';
    row.style.gap = '4px';

    const labelRow = document.createElement('div');
    labelRow.style.display = 'flex';
    labelRow.style.justifyContent = 'space-between';
    labelRow.style.fontSize = '12px';
    labelRow.style.color = '#bbb';

    const labelSpan = document.createElement('span');
    labelSpan.innerText = name;
    labelRow.appendChild(labelSpan);

    const valSpan = document.createElement('span');
    valSpan.style.fontWeight = 'bold';
    valSpan.style.color = '#3b82f6';
    valSpan.innerText = initialVal.toString();
    labelRow.appendChild(valSpan);

    row.appendChild(labelRow);

    const slider = document.createElement('wa-slider');
    slider.setAttribute('min', min.toString());
    slider.setAttribute('max', max.toString());
    slider.setAttribute('step', step.toString());
    slider.setAttribute('value', initialVal.toString());
    slider.style.width = '100%';
    row.appendChild(slider);

    const onInput = (e) => {
      const val = parseFloat(e.target.value);
      valSpan.innerText = val.toString();
      onChange(val);
    };
    
    slider.addEventListener('input', onInput);

    this.container.appendChild(row);

    const controller = {
      domSlider: slider,
      setValue: (val, silent) => {
        slider.value = val;
        valSpan.innerText = val.toString();
        if (!silent) {
          onChange(parseFloat(val));
        }
      },
      getValue: () => parseFloat(slider.value),
      setMin: (v) => slider.setAttribute('min', v.toString()),
      setMax: (v) => slider.setAttribute('max', v.toString()),
      setVisibility: (visible) => { row.style.display = visible ? '' : 'none'; },
      setEnable: (enabled) => {
        if (enabled) slider.removeAttribute('disabled');
        else slider.setAttribute('disabled', '');
      }
    };

    return controller;
  }

  addCheckbox(name, valueOrObject, callbackOrProperty) {
    let isChecked = false;
    let onChange = null;

    if (typeof callbackOrProperty === 'string' && typeof valueOrObject === 'object') {
      const obj = valueOrObject;
      const prop = callbackOrProperty;
      isChecked = !!obj[prop];
      onChange = (checked) => {
        obj[prop] = checked;
      };
    } else {
      isChecked = !!valueOrObject;
      onChange = (checked) => {
        if (typeof callbackOrProperty === 'function') {
          callbackOrProperty(checked);
        }
      };
    }

    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.justifyContent = 'space-between';
    row.style.fontSize = '12px';

    const checkbox = document.createElement('wa-checkbox');
    checkbox.innerText = name;
    checkbox.checked = isChecked;
    checkbox.style.flex = '1';
    row.appendChild(checkbox);

    checkbox.addEventListener('change', (e) => {
      onChange(e.target.checked);
    });

    this.container.appendChild(row);

    return {
      domCheckbox: checkbox,
      setValue: (val, silent) => {
        checkbox.checked = !!val;
        if (!silent) {
          onChange(!!val);
        }
      },
      getValue: () => checkbox.checked,
      setVisibility: (visible) => { row.style.display = visible ? '' : 'none'; },
      setEnable: (enabled) => {
        if (enabled) checkbox.removeAttribute('disabled');
        else checkbox.setAttribute('disabled', '');
      }
    };
  }

  addCombobox(name, valueOrObject, callbackOrProperty, options) {
    let initialVal = '';
    let onChange = null;

    if (typeof callbackOrProperty === 'string' && typeof valueOrObject === 'object') {
      const obj = valueOrObject;
      const prop = callbackOrProperty;
      initialVal = obj[prop];
      onChange = (val) => {
        obj[prop] = val;
      };
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
    row.style.display = 'flex';
    row.style.flexDirection = 'column';
    row.style.gap = '4px';
    row.style.fontSize = '12px';

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
    row.appendChild(select);

    select.addEventListener('change', (e) => {
      onChange(e.target.value);
    });

    this.container.appendChild(row);

    return {
      domSelect: select,
      setValue: (val, silent) => {
        select.value = val.toString();
        if (!silent) {
          onChange(val.toString());
        }
      },
      getValue: () => select.value,
      setVisibility: (visible) => { row.style.display = visible ? '' : 'none'; },
      setEnable: (enabled) => {
        if (enabled) select.removeAttribute('disabled');
        else select.setAttribute('disabled', '');
      },
      setOptions: (newOpts) => {
        populateOptions(newOpts);
      },
      addOptions: (newOpts) => {
        populateOptions(newOpts);
      }
    };
  }

  addToolGrid(name, valueOrObject, callbackOrProperty, options) {
    let initialVal = 0;
    let onChange = null;

    if (typeof callbackOrProperty === 'string' && typeof valueOrObject === 'object') {
      const obj = valueOrObject;
      const prop = callbackOrProperty;
      initialVal = obj[prop];
      onChange = (val) => {
        obj[prop] = val;
      };
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
    row.style.display = 'flex';
    row.style.flexDirection = 'column';
    row.style.gap = '4px';
    row.style.width = '100%';

    if (name) {
      const label = document.createElement('div');
      label.innerText = name;
      label.style.color = '#bbb';
      label.style.fontSize = '12px';
      row.appendChild(label);
    }

    const grid = document.createElement('div');
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'repeat(3, 1fr)';
    grid.style.gap = '4px';
    grid.style.width = '100%';

    const getToolColor = (idStr) => {
      const id = parseInt(idStr, 10);
      switch (id) {
        case 0:  // BRUSH
        case 1:  // INFLATE
        case 4:  // FLATTEN
        case 5:  // PINCH
        case 6:  // CREASE
        case 14: // VOXEL
          return '#ebc5c5'; // Red (bright)
        case 3:  // SMOOTH
        case 8:  // RELAX
          return '#c5d3eb'; // Blue (bright)
        case 7:  // DRAG
        case 10: // MOVE
        case 12: // LOCALSCALE
        case 13: // TRANSFORM
        case 15: // GRAB
        case 16: // TRANSFORM_VR
        case 17: // SLIDE
          return '#c5ebc5'; // Green (bright)
        case 9:  // PAINT
          return '#dec5eb'; // Purple (bright)
        case 11: // MASKING
          return '#ebdcc5'; // Orange (bright)
        
        // Low poly tools
        case 18: // DELETE_FACE
        case 19: // FILL_HOLE
        case 20: // DISSOLVE_EDGE
        case 21: // SPLIT_FACE
        case 22: // SPIN_EDGE
        case 23: // COLLAPSE_EDGE
        case 24: // DISSOLVE_VERTEX
        case 25: // WELD
        case 26: // SNAP_WELD_CENTER
        case 27: // SPLIT_EDGE
        case 28: // EDGE_CREATE
        case 29: // CUT_TOOL
        case 30: // EXTRUDE
        case 31: // INSET
          return '#dcd6a8'; // Desaturated Yellow

        default:
          return '#eeeeee';
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
      if (val === '-1') return; // Hide "None"
      
      const btn = document.createElement('wa-button');
      btn.innerText = text;
      btn.setAttribute('size', 'small');
      btn.className = 'grid-tool-btn';
      btn.style.width = '100%';

      btn.addEventListener('click', () => {
        const valStr = val.toString();
        Object.entries(buttonsMap).forEach(([k, b]) => {
          updateButtonStyles(k, b, k === valStr);
        });
        onChange(valStr);
      });

      buttonsMap[val] = btn;
      grid.appendChild(btn);
    });

    // Set initial values
    const initialStr = initialVal.toString();
    Object.entries(buttonsMap).forEach(([k, b]) => {
      updateButtonStyles(k, b, k === initialStr);
    });

    row.appendChild(grid);
    this.container.appendChild(row);

    return {
      domGrid: grid,
      setValue: (val, silent) => {
        const valStr = val ? val.toString() : '-1';
        Object.entries(buttonsMap).forEach(([k, b]) => {
          updateButtonStyles(k, b, k === valStr);
        });
        if (!silent) {
          onChange(valStr);
        }
      },
      getValue: () => {
        const activeKey = Object.entries(buttonsMap).find(([k, b]) => {
          const color = getToolColor(k);
          // Check active status by seeing if it currently has dark text on it
          return b.style.getPropertyValue('--btn-color') === '#111';
        });
        return activeKey ? activeKey[0] : '-1';
      },
      setVisibility: (visible) => { row.style.display = visible ? '' : 'none'; },
      setEnable: (enabled) => {
        Object.values(buttonsMap).forEach(b => {
          if (enabled) b.removeAttribute('disabled');
          else b.setAttribute('disabled', '');
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
      setVisibility: (visible) => { btn.style.display = visible ? '' : 'none'; },
      setEnable: (enabled) => {
        if (enabled) btn.removeAttribute('disabled');
        else btn.setAttribute('disabled', '');
      }
    };
  }

  addDualButton(name1, name2, callback1, callback2, method1, method2) {
    const row = document.createElement('div');
    row.className = 'btn-grid';
    row.style.display = 'flex';
    row.style.gap = '4px';
    row.style.width = '100%';
    
    const btn1 = document.createElement('wa-button');
    btn1.innerText = name1;
    btn1.setAttribute('variant', 'primary');
    btn1.className = 'compact-btn';
    btn1.style.flex = '1';
    
    const btn2 = document.createElement('wa-button');
    btn2.innerText = name2;
    btn2.setAttribute('variant', 'primary');
    btn2.className = 'compact-btn';
    btn2.style.flex = '1';

    const trigger = (cb, method) => {
      if (typeof cb === 'function') {
        cb();
      } else if (typeof cb === 'object' && typeof method === 'string' && typeof cb[method] === 'function') {
        cb[method]();
      }
    };

    btn1.addEventListener('click', () => trigger(callback1, method1));
    btn2.addEventListener('click', () => trigger(callback2, method2));

    row.appendChild(btn1);
    row.appendChild(btn2);
    this.container.appendChild(row);

    return [
      {
        domButton: btn1,
        setVisibility: (visible) => { btn1.style.display = visible ? '' : 'none'; },
        setEnable: (enabled) => {
          if (enabled) btn1.removeAttribute('disabled');
          else btn1.setAttribute('disabled', '');
        }
      },
      {
        domButton: btn2,
        setVisibility: (visible) => { btn2.style.display = visible ? '' : 'none'; },
        setEnable: (enabled) => {
          if (enabled) btn2.removeAttribute('disabled');
          else btn2.setAttribute('disabled', '');
        }
      }
    ];
  }

  addColor(name, color, callback) {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.justifyContent = 'space-between';
    row.style.fontSize = '12px';

    const label = document.createElement('span');
    label.innerText = name;
    label.style.color = '#bbb';
    row.appendChild(label);

    const colorWrapper = document.createElement('div');
    colorWrapper.style.position = 'relative';
    colorWrapper.style.width = '48px';
    colorWrapper.style.height = '24px';
    colorWrapper.style.borderRadius = '4px';
    colorWrapper.style.border = '1px solid #444';
    colorWrapper.style.overflow = 'hidden';
    colorWrapper.style.cursor = 'pointer';

    const colorInput = document.createElement('input');
    colorInput.setAttribute('type', 'color');
    
    const rgbToHex = (rgb) => {
      const toHex = (c) => {
        const hex = Math.round(c * 255).toString(16);
        return hex.length === 1 ? '0' + hex : hex;
      };
      return `#${toHex(rgb[0])}${toHex(rgb[1])}${toHex(rgb[2])}`;
    };

    const hexToRgb = (hex) => {
      const r = parseInt(hex.slice(1, 3), 16) / 255;
      const g = parseInt(hex.slice(3, 5), 16) / 255;
      const b = parseInt(hex.slice(5, 7), 16) / 255;
      return [r, g, b];
    };

    let hexVal = Array.isArray(color) ? rgbToHex(color) : color;
    colorInput.value = hexVal;
    
    colorInput.style.position = 'absolute';
    colorInput.style.top = '-5px';
    colorInput.style.left = '-5px';
    colorInput.style.width = '60px';
    colorInput.style.height = '34px';
    colorInput.style.border = 'none';
    colorInput.style.padding = '0';
    colorInput.style.margin = '0';
    colorInput.style.cursor = 'pointer';
    colorInput.style.background = 'transparent';

    colorWrapper.appendChild(colorInput);
    row.appendChild(colorWrapper);
    this.container.appendChild(row);

    const updateHandler = (val, silent) => {
      const hex = Array.isArray(val) ? rgbToHex(val) : val;
      colorInput.value = hex;
      if (!silent && typeof callback === 'function') {
        if (Array.isArray(color)) {
          callback(hexToRgb(hex));
        } else {
          callback(hex);
        }
      }
    };

    colorInput.addEventListener('input', (e) => {
      updateHandler(e.target.value, false);
    });

    return {
      domColor: colorInput,
      setValue: (val, silent) => {
        updateHandler(val, silent);
      },
      getValue: () => {
        const hex = colorInput.value;
        return Array.isArray(color) ? hexToRgb(hex) : hex;
      },
      setVisibility: (visible) => { row.style.display = visible ? '' : 'none'; },
      setEnable: (enabled) => {
        if (enabled) colorInput.removeAttribute('disabled');
        else colorInput.setAttribute('disabled', '');
      }
    };
  }
}

export default Gui;
