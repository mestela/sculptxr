import Tablet from '../../misc/Tablet.js';
import SculptBase from './SculptBase.js';

// BRUSH A BLENDSHAPE BACK TOWARDS REST. Each step takes a fraction of the ACTIVE LAYER'S OWN
// delta off the vertices under the brush, so the layer fades out where it is brushed and nothing
// else moves: other layers, idle and jiggle are all left alone because the step is the layer's
// delta, not "back to the Base". The capture in Mesh.updateGeometry then writes the smaller delta.
// matt: the cartoon head's mouthFunnel "is too exaggerated and needs to be reduced".
//
// Only on a layer: on the Base there is no rest to go back to, so the press is refused.
class Revert extends SculptBase {

  constructor(main) {
    super(main);
    this._radius = 50;
    this._intensity = 0.3;
    this._culling = false;
    this._idAlpha = 0;
    this._lockPosition = false;
  }

  _layerDelta() {
    const mesh = this.getMesh();
    const track = mesh && window._animationRegistry?.tracks?.get(mesh.getID());
    const name = track?.editingBlendshape;
    const d = name && track.blendshapes?.get(name);
    return d && d.length === track.baseShape?.length ? d : null;
  }

  start(ctrl) {
    if (!this._layerDelta()) {
      window._blendshapeStackPanel?.flash?.();
      window.screenLog?.('Revert: select a blendshape layer to brush back to rest');
      return false;
    }
    return super.start(ctrl);
  }

  stroke(picking) {
    const delta = this._layerDelta();
    if (!delta) return;
    let iVerts = picking.getPickedVertices();
    const intensity = this._intensity * Tablet.getPressureIntensity();
    this._main.getStateManager().pushVertices(iVerts);
    if (this._culling) iVerts = this.getFrontVertices(iVerts, picking.getEyeDirection());
    picking.updateAlpha(this._lockPosition);
    picking.setIdAlpha(this._idAlpha);

    const mesh = this.getMesh();
    const vAr = mesh.getVertices(), mAr = mesh.getMaterials();
    const vProxy = this._accumulate === false && this._lockPosition === false ? mesh.getVerticesProxy() : vAr;
    const c = picking.getIntersectionPoint(), radius = Math.sqrt(picking.getLocalRadius2());
    const n = delta.length / 3;
    for (let i = 0; i < iVerts.length; ++i) {
      const v = iVerts[i];
      if (v >= n) continue;
      const ind = v * 3;
      const dx = vProxy[ind] - c[0], dy = vProxy[ind + 1] - c[1], dz = vProxy[ind + 2] - c[2];
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) / radius;
      if (dist >= 1) continue;
      let f = dist * dist;
      f = 3 * f * f - 4 * f * dist + 1;
      f *= intensity * mAr[ind + 2] * picking.getAlpha(vAr[ind], vAr[ind + 1], vAr[ind + 2]);
      vAr[ind] -= delta[ind] * f;
      vAr[ind + 1] -= delta[ind + 1] * f;
      vAr[ind + 2] -= delta[ind + 2] * f;
    }
    mesh.updateGeometry(mesh.getFacesFromVertices(iVerts), iVerts);
  }
}

export default Revert;
