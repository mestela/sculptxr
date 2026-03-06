import { vec3 } from 'gl-matrix';
import Tablet from '../../misc/Tablet.js';
import SculptBase from './SculptBase.js';

class Paint extends SculptBase {

  constructor(main) {
    super(main);

    this._radius = 50;
    this._hardness = 0.75;
    this._intensity = 0.75;
    this._culling = false;
    this._color = vec3.fromValues(1.0, 0.766, 0.336); // albedo
    this._material = vec3.fromValues(0.5, 0.0, 0.0); // roughness/metallic/masking

    this._colorSecondary = vec3.fromValues(1.0, 1.0, 1.0); // secondary albedo
    this._materialSecondary = vec3.fromValues(0.5, 0.0, 0.0); // secondary material

    this._onColorSwapped = null; // callback

    this._pickColor = false; // color picking
    this._pickCallbacks = []; // callback functions after picking a color
    this._idAlpha = 0;
    this._lockPosition = false;

    this._writeAlbedo = true;
    this._writeRoughness = true;
    this._writeMetalness = true;
  }

  end() {
    this._pickColor = false;
    super.end();
  }

  swapColors() {
    // swap fg/bg color
    var tempC = vec3.clone(this._color);
    vec3.copy(this._color, this._colorSecondary);
    vec3.copy(this._colorSecondary, tempC);

    // swap fg/bg material
    var tempM = vec3.clone(this._material);
    vec3.copy(this._material, this._materialSecondary);
    vec3.copy(this._materialSecondary, tempM);

    if (this._onColorSwapped) {
      this._onColorSwapped();
    }
  }

  pushState(force) {
    if (!this._pickColor || force)
      this._main.getStateManager().pushStateColorAndMaterial(this.getMesh());
  }

  startSculpt() {
    if (this._pickColor) {
      this._lastPickPressed = true;
      return this.pickColor(this._main.getPicking());
    }
    super.startSculpt();
  }

  update(contin) {
    if (this._pickColor === true)
      return this.updatePickColor();
    super.update(contin);
  }

  updateContinuous() {
    if (this._pickColor === true)
      return this.updatePickColor();
    super.updateContinuous();
  }

  updateMeshBuffers() {
    var mesh = this.getMesh();
    if (mesh.isDynamic) {
      mesh.updateBuffers();
    } else {
      mesh.updateColorBuffer();
      mesh.updateMaterialBuffer();
    }
  }

  updatePickColor() {
    var picking = this._main.getPicking();
    // In VR, picking is handled by Scene.js processVRSculpting
    var isVR = this._main._xrSession;
    if (!isVR && picking.intersectionMouseMesh()) {
      this.pickColor(picking);
      this._pickColor = false; // Desktop: Auto-exit on click
    }
  }

  addPickCallback(cb) {
    this._pickCallbacks.push(cb);
  }

  pickColor(picking) {
    var mesh = this.getMesh();
    // Ensure picking mesh matches active mesh (or use picking mesh)
    // If Picking (VR) hit a mesh, use that mesh for material lookup
    var hitMesh = picking.getMesh();
    if (hitMesh && hitMesh !== mesh) {
      // console.warn("Picking mesh mismatch, using hit mesh");
      mesh = hitMesh;
    }

    if (!hitMesh) return; // No functionality if no mesh hit

    var color = this._color;
    picking.polyLerp(mesh.getMaterials(), color);
    var roughness = color[0];
    var metallic = color[1];
    picking.polyLerp(mesh.getColors(), color);

    // console.log("Picked:", color, roughness, metallic);
    for (let i = 0; i < this._pickCallbacks.length; i++) {
      this._pickCallbacks[i](color, roughness, metallic);
    }
  }

  stroke(picking) {
    var iVertsInRadius = picking.getPickedVertices();
    // Remap the 0-1 linear GUI intensity to an exponential curve (squared)
    // This allows much finer control at low intensities (e.g. 0.1 slider = 1% opacity per frame)
    var intensity = (this._intensity * this._intensity) * Tablet.getPressureIntensity();

    // undo-redo
    this._main.getStateManager().pushVertices(iVertsInRadius);
    iVertsInRadius = this.dynamicTopology(picking);

    if (this._culling)
      iVertsInRadius = this.getFrontVertices(iVertsInRadius, picking.getEyeDirection());

    picking.updateAlpha(this._lockPosition);
    picking.setIdAlpha(this._idAlpha);
    this.paint(iVertsInRadius, picking.getIntersectionPoint(), picking.getLocalRadius2(), intensity, this._hardness, picking);

    var mesh = this.getMesh();
    mesh.updateDuplicateColorsAndMaterials(iVertsInRadius);
    if (mesh.isUsingDrawArrays())
      mesh.updateDrawArrays(mesh.getFacesFromVertices(iVertsInRadius));
  }

  paint(iVerts, center, radiusSquared, intensity, hardness, picking) {
    var mesh = this.getMesh();
    var vAr = mesh.getVertices();
    var cAr = mesh.getColors();
    var mAr = mesh.getMaterials();
    var color = this._color;
    var roughness = this._material[0];
    var metallic = this._material[1];
    var radius = Math.sqrt(radiusSquared);
    var cr = color[0];
    var cg = color[1];
    var cb = color[2];
    var cx = center[0];
    var cy = center[1];
    var cz = center[2];
    var softness = 2 * (1 - hardness);
    for (var i = 0, l = iVerts.length; i < l; ++i) {
      var ind = iVerts[i] * 3;
      var vx = vAr[ind];
      var vy = vAr[ind + 1];
      var vz = vAr[ind + 2];
      var dx = vx - cx;
      var dy = vy - cy;
      var dz = vz - cz;
      var dist = Math.sqrt(dx * dx + dy * dy + dz * dz) / radius;
      if (dist > 1) dist = 1.0;

      var fallOff = Math.pow(1 - dist, softness);
      fallOff *= intensity * mAr[ind + 2] * picking.getAlpha(vx, vy, vz);
      var fallOffCompl = 1.0 - fallOff;

      if (this._writeAlbedo) {
        cAr[ind] = cAr[ind] * fallOffCompl + cr * fallOff;
        cAr[ind + 1] = cAr[ind + 1] * fallOffCompl + cg * fallOff;
        cAr[ind + 2] = cAr[ind + 2] * fallOffCompl + cb * fallOff;
      }

      if (this._writeRoughness) {
        mAr[ind] = mAr[ind] * fallOffCompl + roughness * fallOff;
      }

      if (this._writeMetalness) {
        mAr[ind + 1] = mAr[ind + 1] * fallOffCompl + metallic * fallOff;
      }
    }
  }

  // WebXR Support
  updateXR(picking, isPressed) {
    // If the user releases the trigger, they are allowed to start a new stroke next time
    if (!isPressed) {
      this._blockNextStroke = false;
    }

    if (this._pickColor) {
      // Keep the cursor tracking the physical mesh visually but DO NOT paint
      this.sculptStrokeXR(picking, false);

      // If the trigger is pressed, sample the color continuously
      if (isPressed) {
        this.pickColor(picking);
        this._blockNextStroke = true; // Prevent painting if we exit eyedropper mode while still holding the trigger
      } else if (this._lastPickPressed) {
        // Trigger released: Commit the color and disable the eyedropper
        this.pickColor(picking);
        this._pickColor = false;
      }
      this._lastPickPressed = isPressed;
      return;
    }

    // Safety: if we drop out of Eyedropper mode (e.g. releasing secondary trigger) 
    // but the primary trigger is STILL held, DO NOT start an immediate paint stroke.
    if (this._blockNextStroke && isPressed) {
      this.sculptStrokeXR(picking, false);
      return;
    }

    // Normal Paint behavior
    this.sculptStrokeXR(picking, isPressed);
  }

  paintAll() {
    var mesh = this.getMesh();
    var iVerts = this.getUnmaskedVertices();
    if (iVerts.length === 0)
      return;

    this.pushState(true);
    this._main.getStateManager().pushVertices(iVerts);

    var cAr = mesh.getColors();
    var mAr = mesh.getMaterials();
    var color = this._color;
    var roughness = this._material[0];
    var metallic = this._material[1];
    var cr = color[0];
    var cg = color[1];
    var cb = color[2];
    for (var i = 0, nb = iVerts.length; i < nb; ++i) {
      var ind = iVerts[i] * 3;
      var fallOff = mAr[ind + 2];
      var fallOffCompl = 1.0 - fallOff;

      if (this._writeAlbedo) {
        cAr[ind] = cAr[ind] * fallOffCompl + cr * fallOff;
        cAr[ind + 1] = cAr[ind + 1] * fallOffCompl + cg * fallOff;
        cAr[ind + 2] = cAr[ind + 2] * fallOffCompl + cb * fallOff;
      }

      if (this._writeRoughness) {
        mAr[ind] = mAr[ind] * fallOffCompl + roughness * fallOff;
      }

      if (this._writeMetalness) {
        mAr[ind + 1] = mAr[ind + 1] * fallOffCompl + metallic * fallOff;
      }
    }

    mesh.updateDuplicateColorsAndMaterials();
    mesh.updateDrawArrays();
    this.updateRender();
  }
}

export default Paint;
