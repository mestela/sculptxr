import SculptBase from './SculptBase.js';
import * as THREE from 'three';
import { buildAdjacency, cutRing, edgeKey, mirrorEdge, walkRing } from '../EdgeLoops.js';
import { hideEdgeHover, hoverAdjacency, lifted, pickEdge, showEdgeHover, vtx } from '../EdgeSelection.js';

// CUT LOOP: tap an edge; its edge ring is found and a new loop is cut across it, halfway along
// every ring edge. With symmetry on, the mirrored ring is cut too, unless the tap's ring is
// already its own mirror.
//
// Hovering lights the edge a tap would use and draws the line(s) the cut would make, mirror
// included. No line means no ring through that edge -- so a tap that will do nothing says so
// BEFORE you make it.
//
// The whole edit is computed as new arrays (EdgeLoops.cutRing) and applied through
// applyMeshSnapshot, the same path undo uses, so the forward edit and its undo cannot disagree.
class CutLoop extends SculptBase {
  constructor(main) {
    super(main);
    this._continuous = false;
    this._hoverKey = '';
  }

  start() {
    const hit = pickEdge(this._main);
    if (!hit) return false;
    const { m, edge: e } = hit;

    const before = this.captureMeshSnapshot(m);
    // The packed uv layout (seam duplicates after the vertices) is also valid OBJ-form input --
    // Mesh.copyData relies on the same thing -- so the cut works on it as-is and the mesh repacks.
    let data = { ...before, uvs: before.texCoords, facesUV: before.facesTexCoord };
    let adj = buildAdjacency(data.faces, data.nbFaces);
    const ring = walkRing(adj, e[0], e[1]);
    const cut = ring && cutRing(data, ring);
    if (!cut) {
      if (window.screenLog) window.screenLog('[CutLoop] no clean ring through that edge', '#f38ba8');
      return false;
    }
    data = cut;

    let mirrored = false;
    if (this._main.getSculptManager().getSymmetry()) {
      // Original vertex indices survive a cut (new ones are appended), so the tapped edge's
      // mirror is still found by position in the cut mesh -- unless the first ring already
      // crossed it, in which case that edge is gone and there is nothing more to do.
      adj = buildAdjacency(data.faces, data.nbFaces);
      const me = mirrorEdge(adj, data.vertices, before.nbVertices, e[0], e[1]);
      const own = new Set(ring.edges.map(([a, b]) => edgeKey(a, b)));
      if (me && !own.has(edgeKey(me[0], me[1]))) {
        const r2 = walkRing(adj, me[0], me[1]);
        const c2 = r2 && cutRing(data, r2);
        if (c2) { data = c2; mirrored = true; }
      }
    }

    const after = {
      faces: data.faces, nbFaces: data.nbFaces, vertices: data.vertices, nbVertices: data.nbVertices,
      colors: data.colors, materials: data.materials, groups: data.groups,
      facesTexCoord: null, texCoords: null, dupStartCount: null,
    };
    if (data.uvs) {
      // Repack through the mesh's own OBJ importer, which reads the NEW faces and vertex count.
      m.setFaces(data.faces); m.setNbFaces(data.nbFaces);
      m.setVertices(data.vertices); m.setNbVertices(data.nbVertices);
      m.initTexCoordsDataFromOBJData(data.uvs, data.facesUV);
      after.texCoords = m.getTexCoords();
      after.facesTexCoord = m.getFacesTexCoord();
      after.dupStartCount = m.getVerticesDuplicateStartCount();
    }
    // The top-bar vert/face count only refreshes itself for dynamic meshes.
    const apply = (snap) => { this.applyMeshSnapshot(m, snap); this._main.getGui?.()?.updateMeshInfo?.(); };
    apply(after);
    this._main.getStateManager().pushStateCustom(() => apply(before), () => apply(after));
    this._hoverKey = ''; // the mesh changed under the cursor: re-preview on the next move
    this._main.render();

    if (window.screenLog) {
      window.screenLog(`[CutLoop] cut ${ring.edges.length} edges${ring.closed ? ' (closed)' : ''}${mirrored ? ' + mirror' : ''}`, '#a6e3a1');
    }
    return true;
  }

  stroke() {}

  // Desktop hover runs through preUpdate on every mouse move; VR through updateXR every frame.
  // The ring walk only reruns when the hovered edge changes.
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
    const key = hit ? edgeKey(hit.edge[0], hit.edge[1]) + '@' + hit.m.getNbFaces() : '';
    if (key === this._hoverKey) return;
    this._hoverKey = key;
    if (!hit) { hideEdgeHover(); this._main.render(); return; }

    const { m, edge: e } = hit;
    const adj = hoverAdjacency(m);
    const v = m.getVertices();
    const h = vtx(v, e[0]).distanceTo(vtx(v, e[1])) * 0.02;
    const line = (ring) => ({
      pts: ring.edges.map(([a, b]) => new THREE.Vector3().addVectors(lifted(m, a, h), lifted(m, b, h)).multiplyScalar(0.5)),
      closed: ring.closed,
    });
    const paths = [];
    const ring = walkRing(adj, e[0], e[1]);
    if (ring) {
      paths.push(line(ring));
      if (this._main.getSculptManager().getSymmetry()) {
        const me = mirrorEdge(adj, v, m.getNbVertices(), e[0], e[1]);
        const own = new Set(ring.edges.map(([a, b]) => edgeKey(a, b)));
        const r2 = me && !own.has(edgeKey(me[0], me[1])) && walkRing(adj, me[0], me[1]);
        if (r2) paths.push(line(r2));
      }
    }
    showEdgeHover(hit.mesh, e, paths);
    this._main.render();
  }

  clearPreview() {
    hideEdgeHover();
    this._hoverKey = '';
  }
}

export default CutLoop;
