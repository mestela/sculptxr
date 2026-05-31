import TR from './GuiTR.js';
import getOptionsURL from '../misc/getOptionsURL.js';
import Enums from '../misc/Enums.js';

class GuiCamera {

  constructor(guiParent, ctrlGui) {
    this._main = ctrlGui._main; // main application
    this._menu = null; // ui menu
    this._camera = this._main.getCamera(); // the camera
    this._cameraTimer = -1; // interval id (used for zqsd/wasd/arrow moves)
    this._cbTranslation = this.cbOnTranslation.bind(this);
    this.init(guiParent);
  }

  init(guiParent) {
    var camera = this._camera;

    // Camera fold
    var menu = this._menu = guiParent.addMenu(TR('cameraTitle'));

    // reset camera
    menu.addTitle(TR('cameraReset'));
    menu.addDualButton(TR('cameraCenter'), TR('cameraFront'), this.resetCamera.bind(this), this.resetFront.bind(this));
    menu.addDualButton(TR('cameraLeft'), TR('cameraTop'), this.resetLeft.bind(this), this.resetTop.bind(this));

    // camera type
    this._ctrlProjectionTitle = menu.addTitle(TR('cameraProjection'));
    var optionsType = [];
    optionsType[Enums.Projection.PERSPECTIVE] = TR('cameraPerspective');
    optionsType[Enums.Projection.ORTHOGRAPHIC] = TR('cameraOrthographic');
    this._ctrlProjection = menu.addCombobox('', camera.getProjectionType(), this.onCameraTypeChange.bind(this), optionsType);

    // camera fov
    this._ctrlFov = menu.addSlider(TR('cameraFov'), camera.getFov(), this.onFovChange.bind(this), 10, 90, 1);
    this._ctrlFov.setVisibility(camera.getProjectionType() === Enums.Projection.PERSPECTIVE);

    // camera mode
    menu.addTitle(TR('cameraMode'));
    var optionsMode = [];
    optionsMode[Enums.CameraMode.ORBIT] = TR('cameraOrbit');
    optionsMode[Enums.CameraMode.SPHERICAL] = TR('cameraSpherical');
    optionsMode[Enums.CameraMode.PLANE] = TR('cameraPlane');
    menu.addCombobox('', camera.getMode(), this.onCameraModeChange.bind(this), optionsMode);
    this._ctrlPivot = menu.addCheckbox(TR('cameraPivot'), camera.getUsePivot(), this.onPivotChange.bind(this));

    // Desktop canvas output during VR
    menu.addTitle('Desktop canvas (VR)');
    var optionsCanvas = [];
    optionsCanvas[0] = 'Blank (VR active indicator)';
    optionsCanvas[1] = 'Mirror (headset view)';
    optionsCanvas[2] = 'Desktop free camera';
    optionsCanvas[3] = 'Spectator (rotation-coupled)';
    var initialCanvas = typeof this._main._spectatorViewMode === 'number' ? this._main._spectatorViewMode : 0;
    menu.addCombobox('', initialCanvas, this.onDesktopCanvasModeChange.bind(this), optionsCanvas);

    // Spectator refresh rate (only relevant when mode 1 or 2 is active)
    var optionsFPS = [];
    optionsFPS[0] = 'Full rate';
    optionsFPS[1] = '½ rate';
    optionsFPS[2] = '¼ rate (default)';
    optionsFPS[3] = '⅛ rate';
    // _spectatorFrameSkip: 0=every frame, 1=every 2nd, 3=every 4th, 7=every 8th
    var skipToIndex = { 0: 0, 1: 1, 3: 2, 7: 3 };
    var initialFPS = skipToIndex[this._main._spectatorFrameSkip ?? 3] ?? 2;
    menu.addCombobox('Spectator FPS', initialFPS, this.onSpectatorFPSChange.bind(this), optionsFPS);

    // TR('CameraSpeed') ...
    menu.addSlider('speed', this._main, '_cameraSpeed', 0.05, 1.0, 0.001);
  }

  onCameraModeChange(value) {
    this._camera.setMode(value);
    this._main.render();
  }

  onDesktopCanvasModeChange(value) {
    this._main._spectatorViewMode = parseInt(value, 10);
    this._main._spectatorN = 0; // render next frame immediately after a mode switch
  }

  onSpectatorFPSChange(value) {
    // Map combobox index → _spectatorFrameSkip value
    const indexToSkip = [0, 1, 3, 7];
    this._main._spectatorFrameSkip = indexToSkip[parseInt(value, 10)] ?? 3;
    this._main._spectatorN = 0;
  }

  onCameraTypeChange(value) {
    this._camera.setProjectionType(value);
    this._ctrlFov.setVisibility(value === Enums.Projection.PERSPECTIVE);
    this._main.render();
  }

  onFovChange(value) {
    this._camera.setFov(value);
    this._main.render();
  }

  onKeyDown(event) {
    if (event.handled === true)
      return;

    event.stopPropagation();
    if (this._main._focusGui)
      return;

    event.preventDefault();
    var main = this._main;
    var camera = main.getCamera();
    event.handled = true;
    if (event.shiftKey && main._action === Enums.Action.CAMERA_ROTATE) {
      camera.snapClosestRotation();
      main.render();
    }

    switch (getOptionsURL.getShortKey(event.which)) {
    case Enums.KeyAction.STRIFE_LEFT:
      camera._moveX = -1;
      break;
    case Enums.KeyAction.STRIFE_RIGHT:
      camera._moveX = 1;
      break;
    case Enums.KeyAction.STRIFE_UP:
      camera._moveZ = -1;
      break;
    case Enums.KeyAction.STRIFE_DOWN:
      camera._moveZ = 1;
      break;
    default:
      event.handled = false;
    }

    if (event.handled === true && this._cameraTimer === -1) {
      this._cameraTimer = window.setInterval(this._cbTranslation, 16.6);
    }
  }

  cbOnTranslation() {
    var main = this._main;
    main.getCamera().updateTranslation();
    main.render();
  }

  /** Key released event */
  onKeyUp(event) {
    if (event.handled === true)
      return;

    event.stopPropagation();
    if (this._main._focusGui)
      return;

    event.preventDefault();
    event.handled = true;
    var camera = this._camera;

    switch (getOptionsURL.getShortKey(event.which)) {
    case Enums.KeyAction.STRIFE_LEFT:
    case Enums.KeyAction.STRIFE_RIGHT:
      camera._moveX = 0;
      break;
    case Enums.KeyAction.STRIFE_UP:
    case Enums.KeyAction.STRIFE_DOWN:
      camera._moveZ = 0;
      break;
    case Enums.KeyAction.CAMERA_RESET:
      this.resetCamera();
      break;
    case Enums.KeyAction.CAMERA_FRONT:
      this.resetFront();
      break;
    case Enums.KeyAction.CAMERA_TOP:
      this.resetTop();
      break;
    case Enums.KeyAction.CAMERA_LEFT:
      this.resetLeft();
      break;
    default:
      event.handled = false;
    }

    if (this._cameraTimer !== -1 && camera._moveX === 0 && camera._moveZ === 0) {
      clearInterval(this._cameraTimer);
      this._cameraTimer = -1;
    }
  }

  resetCamera() {
    this._camera.resetView();
    this._main.render();
  }

  resetFront() {
    this._camera.toggleViewFront();
    this._main.render();
  }

  resetLeft() {
    this._camera.toggleViewLeft();
    this._main.render();
  }

  resetTop() {
    this._camera.toggleViewTop();
    this._main.render();
  }

  onPivotChange() {
    this._camera.toggleUsePivot();
    this._main.render();
  }
}

export default GuiCamera;
