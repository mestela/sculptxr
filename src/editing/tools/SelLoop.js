import SculptBase from './SculptBase.js';
import { buildAdjacency, edgeKey, mirrorEdge, walkLoop } from '../EdgeLoops.js';
import { getEdgeSelection, hideEdgeHover, hideEdgeSelection, pickEdge, showEdgeHover, showEdgeSelection } from '../EdgeSelection.js';

// SEL LOOP: tap an edge to add its whole edge loop to the edge selection; tap a selected edge
// to take its loop back out. (Tapping empty space does not reach a tool -- it orbits -- so
// there is no tap-to-clear.) A toggle rather than replace-on-tap,
// because there is no shift key in a headset and Bevel wants several loops at once.
//
// The edge under the cursor is preselected (lit), so you can see which one a tap will use.
//
// The selection belongs to the mesh (see EdgeSelection), so it survives switching tools; the
// highlight is shown only while this tool is up.
class SelLoop extends SculptBase {
  constructor(main) {
    super(main);
    this._continuous = false;
    this._hoverKey = '';
  }

  start() {
    const hit = pickEdge(this._main);
    if (!hit) return false;
    const { mesh, m, edge: e } = hit;

    const adj = buildAdjacency(m.getFaces(), m.getNbFaces());
    const sel = getEdgeSelection(mesh);
    const adding = !sel.has(edgeKey(e[0], e[1]));
    const apply = (a, b) => {
      for (const [u, v] of this._edgesFrom(adj, a, b)) {
        if (adding) sel.add(edgeKey(u, v)); else sel.delete(edgeKey(u, v));
      }
    };
    apply(e[0], e[1]);
    if (this._main.getSculptManager().getSymmetry()) {
      const me = mirrorEdge(adj, m.getVertices(), m.getNbVertices(), e[0], e[1]);
      if (me) apply(me[0], me[1]);
    }

    showEdgeSelection(mesh);
    this._main.render();
    if (window.screenLog) window.screenLog(`[SelLoop] ${sel.size} edges selected`, '#a6e3a1');
    return true;
  }

  // What one tap toggles: the whole loop. Sel Edge overrides this to just the edge.
  _edgesFrom(adj, a, b) {
    return walkLoop(adj, a, b).edges;
  }

  stroke() {}

  // Desktop hover runs through preUpdate on every mouse move; VR through updateXR every frame.
  preUpdate(canBeContinuous) {
    super.preUpdate(canBeContinuous);
    this._updateHover();
  }

  updateXR(picking, isPressed, origin, dir, options) {
    super.updateXR(picking, isPressed, origin, dir, options);
    this._updateHover();
  }

  _updateHover() {
    const hit = pickEdge(this._main);
    const key = hit ? edgeKey(hit.edge[0], hit.edge[1]) : '';
    if (key === this._hoverKey) return;
    this._hoverKey = key;
    if (hit) showEdgeHover(hit.mesh, hit.edge); else hideEdgeHover();
    this._main.render();
  }

  onActivate() {
    const mesh = this.getMesh();
    if (mesh) showEdgeSelection(mesh);
  }

  clearPreview() {
    hideEdgeSelection();
    hideEdgeHover();
    this._hoverKey = '';
  }
}

export default SelLoop;
