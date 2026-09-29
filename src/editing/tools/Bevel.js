import { vec3, mat4 } from 'gl-matrix';
import SculptBase from './SculptBase.js';
import { bevelEdges, keyVerts } from '../EdgeLoops.js';
import { getEdgeSelection, hideEdgeSelection, setEdgeSelection, showEdgeSelection } from '../EdgeSelection.js';

// BEVEL: press on the mesh and drag; the edges selected with Sel Loop are chamfered (one
// segment), the width following the drag. Release commits; a press with no drag changes nothing.
//
// Width: VR is 1:1 -- the hand's travel in the mesh's own space IS the width. Desktop has no
// such unit, so the drag spans the whole usable range: PX_FULL pixels = wMax, the widest the
// bevel can go before a slide passes 45% of its edge. (Scaling by the selected edges' length
// was tried first and is wrong: those run ALONG the loop, so on a tall cylinder a full drag
// barely opened it.)
//
// The topology is built ONCE on press (EdgeLoops.bevelEdges); the drag only moves the vertices
// that depend on the width, like Inset. UVs follow on release, at the final width. The whole
// edit is one undo step, and undoing it puts the edge selection back.
const PX_FULL = 300;

class Bevel extends SculptBase {
  constructor(main) {
    super(main);
    this._continuous = true;
    this._b = null;
  }

  // The single undo step is pushed in end().
  pushState() {}

  startSculpt() {
    const mesh = this.getMesh();
    if (!mesh) return;
    const m = mesh.getCurrentMesh ? mesh.getCurrentMesh() : mesh;
    const keys = [...getEdgeSelection(mesh)];
    if (!keys.length) {
      if (window.screenLog) window.screenLog('Bevel: select edges with Sel Loop first', '#f9e2af');
      return;
    }

    const before = this.captureMeshSnapshot(m);
    const r = bevelEdges({ ...before, uvs: before.texCoords, facesUV: before.facesTexCoord }, new Set(keys));
    if (!r) {
      if (window.screenLog) window.screenLog('Bevel: those edges cannot be bevelled (non-manifold?)', '#f38ba8');
      return;
    }
    const v = before.vertices;
    let total = 0;
    for (const k of keys) {
      const [a, b] = keyVerts(k);
      total += Math.hypot(v[a * 3] - v[b * 3], v[a * 3 + 1] - v[b * 3 + 1], v[a * 3 + 2] - v[b * 3 + 2]);
    }
    const main = this._main;
    this._b = {
      m, mesh, before, r, keys, unit: total / keys.length, w: 0,
      x0: main._mouseX, y0: main._mouseY,
      vr0: main._vrControllerPos ? vec3.clone(main._vrControllerPos) : null,
    };
    hideEdgeSelection();
    // A hair of width from the start: at exactly zero every new face has no area and no normal.
    this._apply(this._b, this._b.unit * 1e-3);
  }

  // Full rebuild at width w: topology, positions and (repacked) uvs. Returns the snapshot.
  // Takes the stroke state explicitly: end() has already cleared this._b when it commits.
  _apply(b, w) {
    const { m, r } = b;
    const { vertices, uvs } = r.place(w);
    const snap = {
      faces: r.faces, nbFaces: r.nbFaces, vertices, nbVertices: r.nbVertices,
      colors: r.colors, materials: r.materials, groups: r.groups,
      facesTexCoord: null, texCoords: null, dupStartCount: null,
    };
    if (uvs) {
      // Same repack as Cut Loop: the mesh's own OBJ importer reads the new faces and count.
      m.setFaces(r.faces); m.setNbFaces(r.nbFaces);
      m.setVertices(vertices); m.setNbVertices(r.nbVertices);
      m.initTexCoordsDataFromOBJData(uvs, new Uint32Array(r.facesUV));
      snap.texCoords = m.getTexCoords();
      snap.facesTexCoord = m.getFacesTexCoord();
      snap.dupStartCount = m.getVerticesDuplicateStartCount();
    }
    this.applyMeshSnapshot(m, snap);
    this._main.getGui?.()?.updateMeshInfo?.();
    return snap;
  }

  // Drag: move only the width-dependent vertices.
  _setWidth(w) {
    const b = this._b;
    b.w = Math.max(0, Math.min(w, b.r.wMax));
    const pos = b.r.place(b.w).vertices;
    const vAr = b.m.getVertices();
    for (const i of b.r.moved) {
      vAr[i * 3] = pos[i * 3]; vAr[i * 3 + 1] = pos[i * 3 + 1]; vAr[i * 3 + 2] = pos[i * 3 + 2];
    }
    const moved = new Uint32Array(b.r.moved);
    b.m.updateGeometry(b.m.getFacesFromVertices(moved), moved);
    this.updateRender();
  }

  sculptStroke() {
    const b = this._b;
    if (!b) return;
    const main = this._main;
    const px = Math.hypot(main._mouseX - b.x0, main._mouseY - b.y0);
    this._setWidth(b.r.wMax * px / PX_FULL);
  }

  updateXR(picking, isPressed, origin, dir, options) {
    const b = this._b;
    if (!isPressed || !b) {
      super.updateXR(picking, isPressed, origin, dir, options);
      return;
    }
    const cur = this._main._vrControllerPos;
    if (!cur || !b.vr0) return;
    // Controller positions are model space; the width is in the mesh's own.
    const inv = mat4.invert(mat4.create(), b.mesh.getModelSpaceMatrix());
    const p0 = vec3.transformMat4(vec3.create(), b.vr0, inv);
    const p1 = vec3.transformMat4(vec3.create(), cur, inv);
    this._setWidth(vec3.distance(p0, p1));
  }

  end() {
    super.end();
    const b = this._b;
    this._b = null;
    if (!b) return;
    const { m, mesh, before, keys } = b;
    const restore = () => {
      this.applyMeshSnapshot(m, before);
      setEdgeSelection(mesh, keys);
      showEdgeSelectionIfActive(this);
      this._main.getGui?.()?.updateMeshInfo?.();
    };
    // A press without a drag is a miss, not a zero-width bevel.
    if (b.w < b.unit * 1e-3) {
      restore();
      this._main.render();
      return;
    }
    const after = this._apply(b, b.w);
    this._main.getStateManager().pushStateCustom(restore, () => {
      this.applyMeshSnapshot(m, after);
      hideEdgeSelection();
      this._main.getGui?.()?.updateMeshInfo?.();
    });
    this._main.render();
    if (window.screenLog) window.screenLog(`[Bevel] ${keys.length} edges, width ${b.w.toFixed(3)}`, '#a6e3a1');
  }

  onActivate() {
    const mesh = this.getMesh();
    if (mesh) showEdgeSelection(mesh);
  }

  clearPreview() {
    hideEdgeSelection();
  }
}

// Undo can run under any tool; the selection is only drawn while an edge tool is up, and those
// are the tools with onActivate.
function showEdgeSelectionIfActive(tool) {
  tool._main.getSculptManager().getCurrentTool()?.onActivate?.();
}

export default Bevel;
