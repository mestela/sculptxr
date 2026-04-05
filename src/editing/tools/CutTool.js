import Utils from '../../misc/Utils.js';
import SculptBase from './SculptBase.js';
import * as THREE from 'three';
import { vec3 } from 'gl-matrix';

class CutTool extends SculptBase {
  constructor(main) {
    super(main);
    this._continuous = true; // We want continuous strokes!
    this._cutPoints = [];
    this._currentFace = -1;
    this._previewMesh = null;
  }

  findClosestEdgeOrVertex(picking, faceIdx) {
    const mesh = this.getMesh();
    const activeMesh = mesh.getCurrentMesh ? mesh.getCurrentMesh() : mesh;
    const faces = activeMesh.getFaces();
    const vertices = activeMesh.getVertices();
    
    const idf = faceIdx * 4;
    
    const vIdxs = [
      faces[idf],
      faces[idf + 1],
      faces[idf + 2],
      faces[idf + 3]
    ];
    
    const numVerts = vIdxs[3] === Utils.TRI_INDEX ? 3 : 4;
    const hitPoint = picking.getIntersectionPoint(); // local
    
    let closestEdge = -1;
    let minDistSq = Infinity;
    let closestT = 0;
    
    const getPointToSegmentDistSq = (p, a, b) => {
      const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
      const abLenSq = ab[0]*ab[0] + ab[1]*ab[1] + ab[2]*ab[2];
      if (abLenSq === 0) return { distSq: ap[0]*ap[0] + ap[1]*ap[1] + ap[2]*ap[2], t: 0 };
      
      let t = (ap[0]*ab[0] + ap[1]*ab[1] + ap[2]*ab[2]) / abLenSq;
      t = Math.max(0, Math.min(1, t));
      
      const closest = [
        a[0] + t * ab[0],
        a[1] + t * ab[1],
        a[2] + t * ab[2]
      ];
      const dx = p[0] - closest[0];
      const dy = p[1] - closest[1];
      const dz = p[2] - closest[2];
      return { distSq: dx*dx + dy*dy + dz*dz, t: t };
    };
    
    for (let i = 0; i < numVerts; i++) {
      const vA = vIdxs[i];
      const vB = vIdxs[(i + 1) % numVerts];
      
      if (vA === undefined || vB === undefined) continue;
      
      const pA = [vertices[vA * 3], vertices[vA * 3 + 1], vertices[vA * 3 + 2]];
      const pB = [vertices[vB * 3], vertices[vB * 3 + 1], vertices[vB * 3 + 2]];
      
      const result = getPointToSegmentDistSq(hitPoint, pA, pB);
      
      if (result.distSq < minDistSq) {
        minDistSq = result.distSq;
        closestEdge = i;
        closestT = result.t;
      }
    }
    
    if (closestEdge === -1) return null;
    
    const vA = vIdxs[closestEdge];
    const vB = vIdxs[(closestEdge + 1) % numVerts];
    
    const threshold = 0.1;
    if (closestT < threshold) {
      return { type: 'vertex', vIdx: vA };
    } else if (closestT > (1 - threshold)) {
      return { type: 'vertex', vIdx: vB };
    }
    
    return { type: 'edge', vA, vB, t: 0.5 };
  }

  getPointToSegmentDistSq(p, a, b) {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
    const abLenSq = ab[0]*ab[0] + ab[1]*ab[1] + ab[2]*ab[2];
    if (abLenSq === 0) return { distSq: ap[0]*ap[0] + ap[1]*ap[1] + ap[2]*ap[2], t: 0 };
    
    let t = (ap[0]*ab[0] + ap[1]*ab[1] + ap[2]*ab[2]) / abLenSq;
    t = Math.max(0, Math.min(1, t));
    
    const closest = [
      a[0] + t * ab[0],
      a[1] + t * ab[1],
      a[2] + t * ab[2]
    ];
    const dx = p[0] - closest[0];
    const dy = p[1] - closest[1];
    const dz = p[2] - closest[2];
    return { distSq: dx*dx + dy*dy + dz*dz, t: t };
  }

  getFacesForFeature(activeMesh, feature) {
    const vrfStartCount = activeMesh.getVerticesRingFaceStartCount();
    const vertRingFace = activeMesh.getVerticesRingFace();
    
    if (feature.type === 'vertex') {
      const v = feature.vIdx;
      const start = vrfStartCount[v * 2];
      const count = vrfStartCount[v * 2 + 1];
      const faces = [];
      for (let i = 0; i < count; i++) {
        faces.push(vertRingFace[start + i]);
      }
      return faces;
    } else if (feature.type === 'edge') {
      const vA = feature.vA;
      const vB = feature.vB;
      
      const startA = vrfStartCount[vA * 2];
      const countA = vrfStartCount[vA * 2 + 1];
      const facesA = [];
      for (let i = 0; i < countA; i++) {
        facesA.push(vertRingFace[startA + i]);
      }
      
      const startB = vrfStartCount[vB * 2];
      const countB = vrfStartCount[vB * 2 + 1];
      const facesB = [];
      for (let i = 0; i < countB; i++) {
        facesB.push(vertRingFace[startB + i]);
      }
      
      return facesA.filter(f => facesB.includes(f));
    }
    return [];
  }

  updateXR(picking, isPressed, origin, dir, options) {
    if (!isPressed) {
      this.updatePreselection(picking);
      this.updatePreviewMesh();
    }
    super.updateXR(picking, isPressed, origin, dir, options);
  }

  updatePreselection(picking) {
    const mesh = this.getMesh();
    const activeMesh = mesh.getCurrentMesh ? mesh.getCurrentMesh() : mesh;
    let faceIdx = picking.getPickedFace();
    
    if (faceIdx === undefined || faceIdx === -1) {
      this._preselectedFeature = null;
      this.updateHighlightSphere(null);
      return;
    }
    
    if (faceIdx >= activeMesh.getNbFaces()) {
      const hitPoint = picking.getIntersectionPoint();
      const candidateFaces = activeMesh.intersectSphere(hitPoint, 0.05 * 0.05);
      
      if (candidateFaces.length === 0) {
        this._preselectedFeature = null;
        this.updateHighlightSphere(null);
        return;
      }
      
      let bestFeature = null;
      let minDistSq = Infinity;
      
      for (const f of candidateFaces) {
        const feat = this.findClosestEdgeOrVertex(picking, f);
        if (feat) {
          const vertices = activeMesh.getVertices();
          let featPos = [0, 0, 0];
          if (feat.type === 'vertex') {
            const v = feat.vIdx;
            featPos = [vertices[v * 3], vertices[v * 3 + 1], vertices[v * 3 + 2]];
          } else if (feat.type === 'edge') {
            const vA = feat.vA;
            const vB = feat.vB;
            const pA = [vertices[vA * 3], vertices[vA * 3 + 1], vertices[vA * 3 + 2]];
            const pB = [vertices[vB * 3], vertices[vB * 3 + 1], vertices[vB * 3 + 2]];
            featPos = [(pA[0] + pB[0]) / 2, (pA[1] + pB[1]) / 2, (pA[2] + pB[2]) / 2];
          }
          
          const dx = hitPoint[0] - featPos[0];
          const dy = hitPoint[1] - featPos[1];
          const dz = hitPoint[2] - featPos[2];
          const distSq = dx*dx + dy*dy + dz*dz;
          
          if (distSq < minDistSq) {
            minDistSq = distSq;
            bestFeature = feat;
          }
        }
      }
      
      if (bestFeature) {
        this._preselectedFeature = bestFeature;
      } else {
        this._preselectedFeature = null;
        this.updateHighlightSphere(null);
        return;
      }
    } else {
      const feature = this.findClosestEdgeOrVertex(picking, faceIdx);
      if (feature) {
        this._preselectedFeature = feature;
      } else {
        this._preselectedFeature = null;
        this.updateHighlightSphere(null);
        return;
      }
    }
    
    if (this._cutPoints.length > 0 && this._preselectedFeature) {
      const lastPt = this._cutPoints[this._cutPoints.length - 1];
      const facesLast = this.getFacesForFeature(activeMesh, lastPt);
      const facesCandidate = this.getFacesForFeature(activeMesh, this._preselectedFeature);
      
      const sharesFace = facesLast.some(f => facesCandidate.includes(f));
      if (!sharesFace) {
        this._preselectedFeature = null;
        this.updateHighlightSphere(null);
        return;
      }
    }
    
    const feature = this._preselectedFeature;
    if (feature) {
        this._preselectedFeature = feature;
        const vertices = activeMesh.getVertices();
        let snapPos = [0, 0, 0];
        
        if (feature.type === 'vertex') {
          const v = feature.vIdx;
          snapPos = [vertices[v * 3], vertices[v * 3 + 1], vertices[v * 3 + 2]];
        } else if (feature.type === 'edge') {
          const vA = feature.vA;
          const vB = feature.vB;
          const pA = [vertices[vA * 3], vertices[vA * 3 + 1], vertices[vA * 3 + 2]];
          const pB = [vertices[vB * 3], vertices[vB * 3 + 1], vertices[vB * 3 + 2]];
          // Snap to midpoint as requested
          snapPos = [(pA[0] + pB[0]) / 2, (pA[1] + pB[1]) / 2, (pA[2] + pB[2]) / 2];
        }
        
        // Transform to world coordinates
        const worldPos = [0, 0, 0];
        const mat = activeMesh.getMatrix();
        vec3.transformMat4(worldPos, snapPos, mat);
        
        this.updateHighlightSphere(worldPos);
        return;
      }
    
    this._preselectedFeature = null;
    this.updateHighlightSphere(null);
  }

  updateHighlightSphere(pos) {
    if (!this._highlightSphere) {
      this._highlightSphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.1, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xffff00, depthTest: false, transparent: true, opacity: 0.8 })
      );
      this._highlightSphere.renderOrder = 10000;
      this._highlightSphere.isPickable = false;
      const sceneApp = this._main.getScene ? this._main.getScene() : this._main._scene;
      let targetScene = sceneApp;
      if (sceneApp && sceneApp._scene) targetScene = sceneApp._scene;
      
      let parentNode = targetScene;
      if (this._main._worldGroup) parentNode = this._main._worldGroup;
      
      parentNode.add(this._highlightSphere);
    }
    
    if (pos) {
      this._highlightSphere.position.set(pos[0], pos[1], pos[2]);
      this._highlightSphere.visible = true;
    } else {
      this._highlightSphere.visible = false;
    }
  }

  findSharedEdge(fIdx1, fIdx2) {
    const mesh = this.getMesh();
    const activeMesh = mesh.getCurrentMesh ? mesh.getCurrentMesh() : mesh;
    const faces = activeMesh.getFaces();
    
    const idf1 = fIdx1 * 4;
    const idf2 = fIdx2 * 4;
    
    const v1 = [faces[idf1], faces[idf1 + 1], faces[idf1 + 2], faces[idf1 + 3]].filter(v => v !== Utils.TRI_INDEX);
    const v2 = [faces[idf2], faces[idf2 + 1], faces[idf2 + 2], faces[idf2 + 3]].filter(v => v !== Utils.TRI_INDEX);
    
    const shared = v1.filter(v => v2.includes(v));
    
    return null;
  }

  findSharedVertex(fIdx1, fIdx2) {
    const mesh = this.getMesh();
    const activeMesh = mesh.getCurrentMesh ? mesh.getCurrentMesh() : mesh;
    const faces = activeMesh.getFaces();
    
    const idf1 = fIdx1 * 4;
    const idf2 = fIdx2 * 4;
    
    const v1 = [faces[idf1], faces[idf1 + 1], faces[idf1 + 2], faces[idf1 + 3]].filter(v => v !== Utils.TRI_INDEX);
    const v2 = [faces[idf2], faces[idf2 + 1], faces[idf2 + 2], faces[idf2 + 3]].filter(v => v !== Utils.TRI_INDEX);
    
    const shared = v1.filter(v => v2.includes(v));
    
    if (shared.length >= 1) {
      return shared[0];
    }
    return -1;
  }

  updatePreviewMesh(currentHitPoint) {
    const mesh = this.getMesh();
    const activeMesh = mesh.getCurrentMesh ? mesh.getCurrentMesh() : mesh;
    const vertices = activeMesh.getVertices();
    const mat = activeMesh.getMatrix();
    
    const points = [];
    
    for (const cp of this._cutPoints) {
      let pLocal = [0, 0, 0];
      if (cp.type === 'vertex') {
        pLocal = [vertices[cp.vIdx * 3], vertices[cp.vIdx * 3 + 1], vertices[cp.vIdx * 3 + 2]];
      } else if (cp.type === 'edge') {
        const pA = [vertices[cp.vA * 3], vertices[cp.vA * 3 + 1], vertices[cp.vA * 3 + 2]];
        const pB = [vertices[cp.vB * 3], vertices[cp.vB * 3 + 1], vertices[cp.vB * 3 + 2]];
        pLocal = [
          pA[0] + cp.t * (pB[0] - pA[0]),
          pA[1] + cp.t * (pB[1] - pA[1]),
          pA[2] + cp.t * (pB[2] - pA[2])
        ];
      }
      
      const pWorld = [0, 0, 0];
      vec3.transformMat4(pWorld, pLocal, mat);
      points.push(new THREE.Vector3(pWorld[0], pWorld[1], pWorld[2]));
    }
    
    // Add rubber-banding to hover marker (yellow sphere) if available
    if (this._highlightSphere && this._highlightSphere.visible && this._cutPoints.length > 0) {
      points.push(this._highlightSphere.position.clone());
    }
    
    if (points.length < 2) {
      if (this._previewMesh) {
        this._previewMesh.visible = false;
      }
      return;
    }
    
    if (this._previewMesh) {
      this._previewMesh.visible = true;
    }
    
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const colors = [];
    const isHovering = this._highlightSphere && this._highlightSphere.visible;
    for (let i = 0; i < points.length; i++) {
      if (isHovering && i === points.length - 1) {
        colors.push(1, 1, 0); // Yellow for the hover point
      } else {
        colors.push(1, 0, 0); // Red for confirmed points
      }
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    
    if (!this._previewMesh) {
      const material = new THREE.LineBasicMaterial({ 
        vertexColors: true, 
        linewidth: 1, 
        depthTest: false, 
        transparent: true, 
        depthWrite: false, 
        opacity: 0.4 
      });
      this._previewMesh = new THREE.Line(geometry, material);
      this._previewMesh.renderOrder = 9999;
      this._previewMesh.isPickable = false;
      
      const sceneApp = this._main.getScene ? this._main.getScene() : this._main._scene;
      let targetScene = sceneApp;
      if (sceneApp._scene) targetScene = sceneApp._scene;
      
      let parentNode = targetScene;
      if (this._main._worldGroup) parentNode = this._main._worldGroup;
      parentNode.add(this._previewMesh);
    } else {
      this._previewMesh.geometry.dispose();
      this._previewMesh.geometry = geometry;
    }
    
    // Add spheres at cut points!
    const sceneApp = this._main.getScene ? this._main.getScene() : this._main._scene;
    let targetScene = sceneApp;
    if (sceneApp._scene) targetScene = sceneApp._scene;
    let parentNode = targetScene;
    if (this._main._worldGroup) parentNode = this._main._worldGroup;
    
    if (!this._sphereGeometry) {
      this._sphereGeometry = new THREE.SphereGeometry(0.02, 8, 8);
      this._sphereMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000, depthTest: false, transparent: true, depthWrite: false });
    }
    
    if (this._indicatorSpheres) {
      for (const s of this._indicatorSpheres) {
        parentNode.remove(s);
      }
    }
    this._indicatorSpheres = [];
    
    for (const p of points) {
      const s = new THREE.Mesh(this._sphereGeometry, this._sphereMaterial);
      s.position.copy(p);
      s.renderOrder = 9999;
      s.isPickable = false;
      parentNode.add(s);
      this._indicatorSpheres.push(s);
    }
  }

  start(ctrl) {
    console.log("[CutTool] start called");
    const picking = this._main.getPicking();
    if (!this._isCutting) {
      this.clearPreview();
      this._cutPoints = [];
      this._isCutting = true;
      this._strokeFrameCount = 0;
    }
    this._currentFace = picking.getPickedFace();
    const hitPoint = picking.getIntersectionPoint();
    console.log("[CutTool] Initial face from picking:", this._currentFace);
    
    const mesh = this.getMesh();
    const activeMesh = mesh.getCurrentMesh ? mesh.getCurrentMesh() : mesh;
    
    if (this._currentFace === undefined || this._currentFace === -1) {
      console.log("[CutTool] No face hit on start.");
      return;
    }
    
    if (this._currentFace >= activeMesh.getNbFaces()) {
      console.log(`[CutTool] Face out of bounds (${this._currentFace}), trying sphere fallback at hitPoint:`, hitPoint);
      // Search in a 5cm radius bubble
      const candidateFaces = activeMesh.intersectSphere(hitPoint, 0.05 * 0.05);
      console.log("[CutTool] IntersectSphere candidates:", candidateFaces.length);
      
      if (candidateFaces.length > 0) {
        let closestFace = -1;
        let minDistSq = Infinity;
        const faces = activeMesh.getFaces();
        const vertices = activeMesh.getVertices();
        
        for (const f of candidateFaces) {
          const id = f * 4;
          const idx1 = faces[id] * 3;
          const idx2 = faces[id+1] * 3;
          const idx3 = faces[id+2] * 3;
          
          const v1 = [vertices[idx1], vertices[idx1+1], vertices[idx1+2]];
          const v2 = [vertices[idx2], vertices[idx2+1], vertices[idx2+2]];
          const v3 = [vertices[idx3], vertices[idx3+1], vertices[idx3+2]];
          
          const centroid = [(v1[0]+v2[0]+v3[0])/3, (v1[1]+v2[1]+v3[1])/3, (v1[2]+v2[2]+v3[2])/3];
          const distSq = (hitPoint[0]-centroid[0])**2 + (hitPoint[1]-centroid[1])**2 + (hitPoint[2]-centroid[2])**2;
          
          if (distSq < minDistSq) {
            minDistSq = distSq;
            closestFace = f;
          }
        }
        
        if (closestFace !== -1) {
          console.log(`[CutTool] Fallback found closest face ${closestFace}`);
          this._currentFace = closestFace;
        }
      } else {
        console.log("[CutTool] intersectSphere returned no faces.");
      }
    }
    
    if (this._currentFace !== undefined && this._currentFace >= 0) {
      console.log(`[CutTool] Proceeding with face ${this._currentFace}`);
      
      const feature = this._preselectedFeature || this.findClosestEdgeOrVertex(picking, this._currentFace);
      
      if (feature) {
        console.log("[CutTool] Found feature:", feature);
        // Check for double click (open path complete)
        const lastPt = this._cutPoints[this._cutPoints.length - 1];
        if (lastPt && this.areFeaturesEqual(lastPt, feature)) {
          console.log("[CutTool] Double click detected. Completing cut.");
          this.completeCut();
          return;
        }
        
        // Check for loop closure
        const firstPt = this._cutPoints[0];
        if (firstPt && this._cutPoints.length > 2 && this.areFeaturesEqual(firstPt, feature)) {
          console.log("[CutTool] Loop closed. Completing cut.");
          // Push a clone of the first point to ensure exact match!
          this._cutPoints.push(Object.assign({}, firstPt));
          this.completeCut();
          return;
        }
        
        console.log(`[CutTool] Added point:`, feature);
        this._cutPoints.push(feature);
        console.log(`[CutTool] Total points now: ${this._cutPoints.length}`);
        this.updatePreviewMesh(picking.getIntersectionPoint());
        
        this._preselectedFeature = null; // Clear to force fresh preselection
      }
    }
  }

  stroke(picking) {
    const hitPoint = picking.getIntersectionPoint();
    this.updatePreviewMesh(hitPoint);
  }

  doesFaceContainPoint(faceVerts, cp) {
    // Direct check (handles new faces that already list the new vertex)
    if (cp.vertexIndex !== undefined && faceVerts.includes(cp.vertexIndex)) {
      return true;
    }
    // Feature check (handles original faces)
    if (cp.type === 'vertex') {
      return faceVerts.includes(cp.vIdx);
    } else if (cp.type === 'edge') {
      return faceVerts.includes(cp.vA) && faceVerts.includes(cp.vB);
    }
    return false;
  }

  splitFaceWithPoints(activeMesh, fIdx, cp1, cp2) {
    const faces = activeMesh.getFaces();
    const idf = fIdx * 4;
    const fv = [faces[idf], faces[idf + 1], faces[idf + 2], faces[idf + 3]].filter(v => v !== Utils.TRI_INDEX);
    
    // Construct augmented list!
    const aug = [];
    
    const isPointOnEdge = (cp, vA, vB) => {
      if (cp.type !== 'edge') return false;
      return (cp.vA === vA && cp.vB === vB) || (cp.vA === vB && cp.vB === vA);
    };
    
    for (let k = 0; k < fv.length; k++) {
      const vA = fv[k];
      const vB = fv[(k + 1) % fv.length];
      aug.push(vA);
      
      if (isPointOnEdge(cp1, vA, vB)) aug.push(cp1.vertexIndex);
      if (isPointOnEdge(cp2, vA, vB)) aug.push(cp2.vertexIndex);
    }
    
    // Find indices in augmented list!
    const idx1 = aug.indexOf(cp1.vertexIndex);
    const idx2 = aug.indexOf(cp2.vertexIndex);
    
    if (idx1 === -1 || idx2 === -1) {
      console.log("[CutTool] Points not found in augmented list.");
      return false;
    }
    
    const i = Math.min(idx1, idx2);
    const j = Math.max(idx1, idx2);
    
    const len1 = j - i;
    const len2 = aug.length - len1;
    
    console.log(`[CutTool] splitFaceWithPoints: idx1=${idx1}, idx2=${idx2}, len1=${len1}, len2=${len2}, aug.length=${aug.length}`);
    
    // Check for 5+3 split in a quad (aug length 6)
    if (aug.length === 6 && (len1 === 2 || len2 === 2)) {
      console.log("[CutTool] 5+3 split detected! Converting to 3 quads.");
      
      let v_mid_idx, cp1_idx, cp2_idx;
      if (len1 === 2) {
        v_mid_idx = i + 1;
        cp1_idx = i;
        cp2_idx = j;
      } else {
        v_mid_idx = (j + 1) % 6;
        cp1_idx = j;
        cp2_idx = i;
      }
      
      const v_mid = aug[v_mid_idx];
      const cp1_vert = aug[cp1_idx];
      const cp2_vert = aug[cp2_idx];
      
      const o_prev = aug[(v_mid_idx - 2 + 6) % 6];
      const o_next = aug[(v_mid_idx + 2) % 6];
      const o_opp = aug[(v_mid_idx + 3) % 6];
      
      // Calculate center vertex position
      const vertices = activeMesh.getVertices();
      const p_mid = [vertices[v_mid * 3], vertices[v_mid * 3 + 1], vertices[v_mid * 3 + 2]];
      const p_opp = [vertices[o_opp * 3], vertices[o_opp * 3 + 1], vertices[o_opp * 3 + 2]];
      
      const p_center = [
        (p_mid[0] + p_opp[0]) / 2,
        (p_mid[1] + p_opp[1]) / 2,
        (p_mid[2] + p_opp[2]) / 2
      ];
      
      // Add center vertex
      const nextVertIdx = activeMesh.getNbVertices();
      const newVertices = new Float32Array(vertices.length + 3);
      newVertices.set(vertices);
      newVertices[nextVertIdx * 3] = p_center[0];
      newVertices[nextVertIdx * 3 + 1] = p_center[1];
      newVertices[nextVertIdx * 3 + 2] = p_center[2];
      activeMesh.setVertices(newVertices);
      activeMesh.setNbVertices(nextVertIdx + 1);
      
      // Copy colors and materials if present
      const colors = activeMesh.getColors();
      if (colors) {
        const newColors = new Float32Array(colors.length + 3);
        newColors.set(colors);
        newColors[nextVertIdx * 3] = colors[v_mid * 3];
        newColors[nextVertIdx * 3 + 1] = colors[v_mid * 3 + 1];
        newColors[nextVertIdx * 3 + 2] = colors[v_mid * 3 + 2];
        activeMesh.setColors(newColors);
      }
      
      const materials = activeMesh.getMaterials();
      if (materials) {
        const newMats = new Float32Array(materials.length + 3);
        newMats.set(materials);
        newMats[nextVertIdx * 3] = materials[v_mid * 3];
        newMats[nextVertIdx * 3 + 1] = materials[v_mid * 3 + 1];
        newMats[nextVertIdx * 3 + 2] = materials[v_mid * 3 + 2];
        activeMesh.setMaterials(newMats);
      }
      
      // Construct 3 quads!
      const q1 = [v_mid, cp2_vert, nextVertIdx, cp1_vert];
      const q2 = [cp1_vert, nextVertIdx, o_opp, o_prev];
      const q3 = [cp2_vert, o_next, o_opp, nextVertIdx];
      
      // Replace face fIdx with q1, append q2 and q3!
      const newFaces = new Uint32Array(faces.length + 8);
      newFaces.set(faces);
      
      // Replace fIdx with q1
      newFaces[idf] = q1[0];
      newFaces[idf + 1] = q1[1];
      newFaces[idf + 2] = q1[2];
      newFaces[idf + 3] = q1[3];
      
      // Append q2
      const nextFIdx = faces.length / 4;
      let nid = nextFIdx * 4;
      newFaces[nid] = q2[0];
      newFaces[nid + 1] = q2[1];
      newFaces[nid + 2] = q2[2];
      newFaces[nid + 3] = q2[3];
      
      // Append q3
      nid += 4;
      newFaces[nid] = q3[0];
      newFaces[nid + 1] = q3[1];
      newFaces[nid + 2] = q3[2];
      newFaces[nid + 3] = q3[3];
      
      activeMesh.setFaces(newFaces);
      activeMesh.setNbFaces(nextFIdx + 2);
      
      return true;
    }
    
    // Fallback to simple split
    const f1 = aug.slice(i, j + 1);
    const f2 = aug.slice(j).concat(aug.slice(0, i + 1));
    
    console.log("[CutTool] Split face into", f1, "and", f2);
    
    const newFaces = new Uint32Array(faces.length + 4);
    newFaces.set(faces);
    
    newFaces[idf] = f1[0];
    newFaces[idf + 1] = f1[1];
    newFaces[idf + 2] = f1[2];
    newFaces[idf + 3] = f1.length === 4 ? f1[3] : Utils.TRI_INDEX;
    
    const nextFIdx = faces.length / 4;
    const nid = nextFIdx * 4;
    newFaces[nid] = f2[0];
    newFaces[nid + 1] = f2[1];
    newFaces[nid + 2] = f2[2];
    newFaces[nid + 3] = f2.length === 4 ? f2[3] : Utils.TRI_INDEX;
    
    activeMesh.setFaces(newFaces);
    activeMesh.setNbFaces(nextFIdx + 1);
    
    return true;
  }

  areFeaturesEqual(f1, f2) {
    if (f1.type !== f2.type) return false;
    if (f1.type === 'vertex') return f1.vIdx === f2.vIdx;
    if (f1.type === 'edge') return (f1.vA === f2.vA && f1.vB === f2.vB) || (f1.vA === f2.vB && f1.vB === f2.vA);
    return false;
  }

  end() {
    console.log("[CutTool] end called");
  }

  perform3QuadSplit(activeMesh, fIdx, cp1, cp2) {
    const faces = activeMesh.getFaces();
    const vertices = activeMesh.getVertices();
    const idf = fIdx * 4;
    
    const fv = [faces[idf], faces[idf + 1], faces[idf + 2], faces[idf + 3]];
    
    const vA1 = cp1.vA;
    const vB1 = cp1.vB;
    const vA2 = cp2.vA;
    const vB2 = cp2.vB;
    
    let vShared = -1;
    let v1 = -1;
    let v2 = -1;
    
    if (vA1 === vA2) { vShared = vA1; v1 = vB1; v2 = vB2; }
    else if (vA1 === vB2) { vShared = vA1; v1 = vB1; v2 = vA2; }
    else if (vB1 === vA2) { vShared = vB1; v1 = vA1; v2 = vB2; }
    else if (vB1 === vB2) { vShared = vB1; v1 = vA1; v2 = vA2; }
    
    if (vShared === -1) return false;
    
    const vOpposite = fv.find(v => v !== vShared && v !== v1 && v !== v2);
    
    if (vOpposite === undefined) return false;
    
    let p1 = cp1.vertexIndex;
    let p2 = cp2.vertexIndex;
    
    const idxShared = fv.indexOf(vShared);
    const nextV = fv[(idxShared + 1) % 4];
    
    if (v1 !== nextV) {
      console.log(`[CutTool] Swapping v1/v2 and p1/p2 to maintain CCW order`);
      const tmpV = v1; v1 = v2; v2 = tmpV;
      const tmpP = p1; p1 = p2; p2 = tmpP;
    }
    
    const pShared = [vertices[vShared * 3], vertices[vShared * 3 + 1], vertices[vShared * 3 + 2]];
    const pOpp = [vertices[vOpposite * 3], vertices[vOpposite * 3 + 1], vertices[vOpposite * 3 + 2]];
    
    const pCenter = [
      (pShared[0] + pOpp[0]) * 0.5,
      (pShared[1] + pOpp[1]) * 0.5,
      (pShared[2] + pOpp[2]) * 0.5
    ];
    const nextVertIdx = activeMesh.getNbVertices();
    const newVertices = new Float32Array(vertices.length + 3);
    newVertices.set(vertices);
    newVertices[nextVertIdx * 3] = pCenter[0];
    newVertices[nextVertIdx * 3 + 1] = pCenter[1];
    newVertices[nextVertIdx * 3 + 2] = pCenter[2];
    activeMesh.setVertices(newVertices);
    activeMesh.setNbVertices(nextVertIdx + 1);
    
    const colors = activeMesh.getColors();
    if (colors) {
      const newColors = new Float32Array(colors.length + 3);
      newColors.set(colors);
      newColors[nextVertIdx * 3] = colors[vShared * 3];
      newColors[nextVertIdx * 3 + 1] = colors[vShared * 3 + 1];
      newColors[nextVertIdx * 3 + 2] = colors[vShared * 3 + 2];
      activeMesh.setColors(newColors);
    }
    
    const materials = activeMesh.getMaterials();
    if (materials) {
      const newMats = new Float32Array(materials.length + 3);
      newMats.set(materials);
      newMats[nextVertIdx * 3] = materials[vShared * 3];
      newMats[nextVertIdx * 3 + 1] = materials[vShared * 3 + 1];
      newMats[nextVertIdx * 3 + 2] = materials[vShared * 3 + 2];
      activeMesh.setMaterials(newMats);
    }
    
    const texCoords = activeMesh.getTexCoords();
    if (texCoords) {
      const newTexCoords = new Float32Array(texCoords.length + 2);
      newTexCoords.set(texCoords);
      
      const facesUV = activeMesh.getFacesTexCoord();
      const idxShared = fv.indexOf(vShared);
      const idxOpp = fv.indexOf(vOpposite);
      const uvShared = facesUV[idf + idxShared];
      const uvOpp = facesUV[idf + idxOpp];
      
      const uShared = texCoords[uvShared * 2];
      const vSharedUV = texCoords[uvShared * 2 + 1];
      const uOpp = texCoords[uvOpp * 2];
      const vOppUV = texCoords[uvOpp * 2 + 1];
      
      const uCenter = (uShared + uOpp) * 0.5;
      const vCenter = (vSharedUV + vOppUV) * 0.5;
      
      newTexCoords[nextVertIdx * 2] = uCenter;
      newTexCoords[nextVertIdx * 2 + 1] = vCenter;
      
      activeMesh.setTexCoords(newTexCoords);
    }
    
    // Corrected Winding Order
    const q1 = [vShared, p1, nextVertIdx, p2];
    const q2 = [v1, vOpposite, nextVertIdx, p1];
    const q3 = [v2, p2, nextVertIdx, vOpposite];
    
    const newFaces = new Uint32Array(faces.length + 8);
    newFaces.set(faces);
    
    newFaces[idf] = q1[0];
    newFaces[idf + 1] = q1[1];
    newFaces[idf + 2] = q1[2];
    newFaces[idf + 3] = q1[3];
    
    const nextFIdx = faces.length / 4;
    let nid = nextFIdx * 4;
    newFaces[nid] = q2[0];
    newFaces[nid + 1] = q2[1];
    newFaces[nid + 2] = q2[2];
    newFaces[nid + 3] = q2[3];
    
    newFaces[nid + 4] = q3[0];
    newFaces[nid + 5] = q3[1];
    newFaces[nid + 6] = q3[2];
    newFaces[nid + 7] = q3[3];
    
    activeMesh.setFaces(newFaces);
    
    const facesUV = activeMesh.getFacesTexCoord();
    if (facesUV) {
      const idxShared = fv.indexOf(vShared);
      const idx1 = fv.indexOf(v1);
      const idx2 = fv.indexOf(v2);
      const idxOpp = fv.indexOf(vOpposite);
      
      const uvShared = facesUV[idf + idxShared];
      const uv1 = facesUV[idf + idx1];
      const uv2 = facesUV[idf + idx2];
      const uvOpp = facesUV[idf + idxOpp];
      
      const q1UV = [uvShared, p1, nextVertIdx, p2];
      const q2UV = [uv1, uvOpp, nextVertIdx, p1];
      const q3UV = [uv2, p2, nextVertIdx, uvOpp];
      
      const newFacesUV = new Uint32Array(facesUV.length + 8);
      newFacesUV.set(facesUV);
      
      newFacesUV[idf] = q1UV[0];
      newFacesUV[idf + 1] = q1UV[1];
      newFacesUV[idf + 2] = q1UV[2];
      newFacesUV[idf + 3] = q1UV[3];
      
      let nuid = nextFIdx * 4;
      newFacesUV[nuid] = q2UV[0];
      newFacesUV[nuid + 1] = q2UV[1];
      newFacesUV[nuid + 2] = q2UV[2];
      newFacesUV[nuid + 3] = q2UV[3];
      
      nuid += 4;
      newFacesUV[nuid] = q3UV[0];
      newFacesUV[nuid + 1] = q3UV[1];
      newFacesUV[nuid + 2] = q3UV[2];
      newFacesUV[nuid + 3] = q3UV[3];
      
      activeMesh.setFacesTexCoord(newFacesUV);
    }
    
    activeMesh.setNbFaces(nextFIdx + 2);
    
    return true;
  }


  completeCut() {
    this._isCutting = false;
    
    if (this._cutPoints.length < 2) {
      this.clearPreview();
      return;
    }
    
    try {
      const mesh = this.getMesh();
      const activeMesh = mesh.getCurrentMesh ? mesh.getCurrentMesh() : mesh;
    const vertices = activeMesh.getVertices();
    const colors = activeMesh.getColors();
    const materials = activeMesh.getMaterials();
    let nbVertices = activeMesh.getNbVertices();
    const newVerts = [];
    
    for (let i = 0; i < this._cutPoints.length; i++) {
      const cp = this._cutPoints[i];
      
      // Feature Weld: If this is the closing point of a loop, reuse the start vertex!
      if (i === this._cutPoints.length - 1 && this._cutPoints.length > 2) {
        if (this.areFeaturesEqual(this._cutPoints[0], cp)) {
          cp.vertexIndex = this._cutPoints[0].vertexIndex;
          continue;
        }
      }

      if (cp.type === 'edge') {
        const vA = cp.vA;
        const vB = cp.vB;
        const pA = [vertices[vA * 3], vertices[vA * 3 + 1], vertices[vA * 3 + 2]];
        const pB = [vertices[vB * 3], vertices[vB * 3 + 1], vertices[vB * 3 + 2]];
        
        const pNew = [
          pA[0] + cp.t * (pB[0] - pA[0]),
          pA[1] + cp.t * (pB[1] - pA[1]),
          pA[2] + cp.t * (pB[2] - pA[2])
        ];
        
        const facesUV = activeMesh.getFacesTexCoord();
        const texCoordsST = activeMesh.getTexCoords();
        let uvNew = [0, 0];
        if (facesUV && texCoordsST) {
          const uvA = vA;
          const uvB = vB;
          const uA = texCoordsST[uvA * 2];
          const vA_uv = texCoordsST[uvA * 2 + 1];
          const uB = texCoordsST[uvB * 2];
          const vB_uv = texCoordsST[uvB * 2 + 1];
          
          uvNew = [
            uA + cp.t * (uB - uA),
            vA_uv + cp.t * (vB_uv - vA_uv)
          ];
        }
        
        newVerts.push({
          pos: pNew,
          color: colors ? [colors[vA * 3], colors[vA * 3 + 1], colors[vA * 3 + 2]] : [1, 1, 1],
          material: materials ? [materials[vA * 3], materials[vA * 3 + 1], 1.0] : [0.5, 0.5, 1.0],
          uv: uvNew,
          index: nbVertices
        });
        
        cp.vertexIndex = nbVertices;
        nbVertices++;
      } else if (cp.type === 'vertex') {
        cp.vertexIndex = cp.vIdx;
      }
    }
    


    if (newVerts.length > 0) {
      const oldNb = activeMesh.getNbVertices();
      const newVertices = new Float32Array((oldNb + newVerts.length) * 3);
      newVertices.set(vertices.subarray(0, oldNb * 3));
      
      let newColors = null;
      if (colors) {
        newColors = new Float32Array((oldNb + newVerts.length) * 3);
        newColors.set(colors.subarray(0, oldNb * 3));
      }
      
      let newMaterials = null;
      if (materials) {
        newMaterials = new Float32Array((oldNb + newVerts.length) * 3);
        newMaterials.set(materials.subarray(0, oldNb * 3));
      }
      
      let newTexCoords = null;
      const texCoordsST = activeMesh.getTexCoords();
      if (texCoordsST) {
        newTexCoords = new Float32Array((oldNb + newVerts.length) * 2);
        newTexCoords.set(texCoordsST.subarray(0, oldNb * 2));
      }

      for (const nv of newVerts) {
        const id = nv.index * 3;
        newVertices[id] = nv.pos[0];
        newVertices[id + 1] = nv.pos[1];
        newVertices[id + 2] = nv.pos[2];
        
        if (newColors) {
          newColors[id] = nv.color[0];
          newColors[id + 1] = nv.color[1];
          newColors[id + 2] = nv.color[2];
        }
        
        if (newMaterials) {
          newMaterials[id] = nv.material[0];
          newMaterials[id + 1] = nv.material[1];
          newMaterials[id + 2] = nv.material[2];
        }
        
      }
      
      activeMesh.setVertices(newVertices);
      if (newColors) activeMesh.setColors(newColors);
      if (newMaterials) activeMesh.setMaterials(newMaterials);
      if (newTexCoords) activeMesh.setTexCoords(newTexCoords);
      
      activeMesh.setNbVertices(nbVertices);
    }
    
    // 2. Process path segments
    console.log(`[CutTool] Processing ${this._cutPoints.length} cut points.`);
    let failCount = 0;
    
    for (let i = 0; i < this._cutPoints.length - 1; i++) {
      const cp1 = this._cutPoints[i];
      const cp2 = this._cutPoints[i + 1];
      
      const p1 = cp1.vertexIndex;
      const p2 = cp2.vertexIndex;
      
      if (p1 === p2) continue; // Skip duplicate points
      
      // Find shared face
      let foundFaceIdx = -1;
      let fv = [];
      const faces = activeMesh.getFaces();
      
      for (let f = 0; f < faces.length / 4; f++) {
        const idf = f * 4;
        fv = [faces[idf], faces[idf+1], faces[idf+2], faces[idf+3]].filter(v => v !== Utils.TRI_INDEX);
        if (this.doesFaceContainPoint(fv, cp1) && this.doesFaceContainPoint(fv, cp2)) {
          foundFaceIdx = f;
          break;
        }
      }
      
      if (foundFaceIdx === -1) {
        console.warn(`[CutTool] Failed to find shared face for segment ${i} to ${i+1}`);
        failCount++;
        continue;
      }
      
      const isQuad = fv.length === 4;
      
      // Case 1: Quad & Edge-to-Edge (Corner Case)
      if (isQuad && cp1.type === 'edge' && cp2.type === 'edge') {
        const sharesVertex = (cp1.vA === cp2.vA || cp1.vA === cp2.vB || cp1.vB === cp2.vA || cp1.vB === cp2.vB);
        if (sharesVertex) {
          const success = this.perform3QuadSplit(activeMesh, foundFaceIdx, cp1, cp2);
          if (success) continue;
        } else {
          let M1 = cp1.vertexIndex;
          let M2 = cp2.vertexIndex;
          
          let e1 = -1, e2 = -1;
          for(let k=0; k<4; k++) {
            if ((fv[k] === cp1.vA && fv[(k+1)%4] === cp1.vB) || (fv[k] === cp1.vB && fv[(k+1)%4] === cp1.vA)) e1 = k;
            if ((fv[k] === cp2.vA && fv[(k+1)%4] === cp2.vB) || (fv[k] === cp2.vB && fv[(k+1)%4] === cp2.vA)) e2 = k;
          }
          
          if (e1 !== -1 && e2 !== -1) {
            if (e1 > e2) {
              const tmp = e1; e1 = e2; e2 = tmp;
              const tmpM = M1; M1 = M2; M2 = tmpM;
            }
            
            const v0 = fv[e1];
            const v1 = fv[(e1+1)%4];
            const v2 = fv[e2];
            const v3 = fv[(e2+1)%4];
            
            const quad1 = [v0, M1, M2, v3];
            const quad2 = [M1, v1, v2, M2];
            
            const idf = foundFaceIdx * 4;
            faces[idf] = quad1[0]; faces[idf+1] = quad1[1]; faces[idf+2] = quad1[2]; faces[idf+3] = quad1[3];
            
            const nextFIdx = faces.length / 4;
            const newFaces = new Uint32Array(faces.length + 4);
            newFaces.set(faces);
            const nid = nextFIdx * 4;
            newFaces[nid] = quad2[0]; newFaces[nid+1] = quad2[1]; newFaces[nid+2] = quad2[2]; newFaces[nid+3] = quad2[3];
            
            activeMesh.setFaces(newFaces);
            
            const facesUV = activeMesh.getFacesTexCoord();
            if (facesUV) {
              const uv0 = facesUV[idf + e1];
              const uv1 = facesUV[idf + (e1+1)%4];
              const uv2 = facesUV[idf + e2];
              const uv3 = facesUV[idf + (e2+1)%4];
              
              const uvM1 = M1;
              const uvM2 = M2;
              
              const quad1UV = [uv0, uvM1, uvM2, uv3];
              const quad2UV = [uvM1, uv1, uv2, uvM2];
              
              facesUV[idf] = quad1UV[0]; facesUV[idf+1] = quad1UV[1]; facesUV[idf+2] = quad1UV[2]; facesUV[idf+3] = quad1UV[3];
              
              const newFacesUV = new Uint32Array(facesUV.length + 4);
              newFacesUV.set(facesUV);
              newFacesUV[nid] = quad2UV[0]; newFacesUV[nid+1] = quad2UV[1]; newFacesUV[nid+2] = quad2UV[2]; newFacesUV[nid+3] = quad2UV[3];
              
              activeMesh.setFacesTexCoord(newFacesUV);
            }
            
            activeMesh.setNbFaces(nextFIdx + 1);
            continue;
          }
        }
      }
      
      // Case 2: Quad & Vertex-to-Vertex
      if (isQuad && cp1.type === 'vertex' && cp2.type === 'vertex') {
        const idx1 = fv.indexOf(p1);
        const idx2 = fv.indexOf(p2);
        if (idx1 !== -1 && idx2 !== -1) {
          const isOpposite = Math.abs(idx1 - idx2) === 2;
          if (isOpposite) {
            let tri1, tri2;
            if ((idx1 === 0 && idx2 === 2) || (idx1 === 2 && idx2 === 0)) {
              tri1 = [fv[0], fv[1], fv[2], Utils.TRI_INDEX];
              tri2 = [fv[0], fv[2], fv[3], Utils.TRI_INDEX];
            } else {
              tri1 = [fv[1], fv[2], fv[3], Utils.TRI_INDEX];
              tri2 = [fv[1], fv[3], fv[0], Utils.TRI_INDEX];
            }
            const idf = foundFaceIdx * 4;
            faces[idf] = tri1[0]; faces[idf+1] = tri1[1]; faces[idf+2] = tri1[2]; faces[idf+3] = tri1[3];
            
            const nextFIdx = faces.length / 4;
            const newFaces = new Uint32Array(faces.length + 4);
            newFaces.set(faces);
            const nid = nextFIdx * 4;
            newFaces[nid] = tri2[0]; newFaces[nid+1] = tri2[1]; newFaces[nid+2] = tri2[2]; newFaces[nid+3] = tri2[3];
            
            activeMesh.setFaces(newFaces);
            
            const facesUV = activeMesh.getFacesTexCoord();
            if (facesUV) {
              let tri1UV, tri2UV;
              if ((idx1 === 0 && idx2 === 2) || (idx1 === 2 && idx2 === 0)) {
                tri1UV = [facesUV[idf], facesUV[idf+1], facesUV[idf+2], Utils.TRI_INDEX];
                tri2UV = [facesUV[idf], facesUV[idf+2], facesUV[idf+3], Utils.TRI_INDEX];
              } else {
                tri1UV = [facesUV[idf+1], facesUV[idf+2], facesUV[idf+3], Utils.TRI_INDEX];
                tri2UV = [facesUV[idf+1], facesUV[idf+3], facesUV[idf], Utils.TRI_INDEX];
              }
              facesUV[idf] = tri1UV[0]; facesUV[idf+1] = tri1UV[1]; facesUV[idf+2] = tri1UV[2]; facesUV[idf+3] = tri1UV[3];
              
              const newFacesUV = new Uint32Array(facesUV.length + 4);
              newFacesUV.set(facesUV);
              newFacesUV[nid] = tri2UV[0]; newFacesUV[nid+1] = tri2UV[1]; newFacesUV[nid+2] = tri2UV[2]; newFacesUV[nid+3] = tri2UV[3];
              
              activeMesh.setFacesTexCoord(newFacesUV);
            }
            
            activeMesh.setNbFaces(nextFIdx + 1);
            continue;
          }
        }
      }
      
      // Case 3: Quad & Vertex-to-Edge
      if (isQuad && ((cp1.type === 'vertex' && cp2.type === 'edge') || (cp1.type === 'edge' && cp2.type === 'vertex'))) {
        const vPt = cp1.type === 'vertex' ? cp1 : cp2;
        const ePt = cp1.type === 'edge' ? cp1 : cp2;
        
        const idxV = fv.indexOf(vPt.vIdx);
        const idxEA = fv.indexOf(ePt.vA);
        const idxEB = fv.indexOf(ePt.vB);
        
        if (idxV !== -1 && idxEA !== -1 && idxEB !== -1) {
          if (vPt.vIdx !== ePt.vA && vPt.vIdx !== ePt.vB) {
            const M = ePt.vertexIndex;
            const V = vPt.vIdx;
            
            let eIdx = -1;
            for(let k=0; k<4; k++) {
              if (fv[k] === ePt.vA && fv[(k+1)%4] === ePt.vB) { eIdx = k; break; }
              if (fv[k] === ePt.vB && fv[(k+1)%4] === ePt.vA) { eIdx = k; break; }
            }
            
            if (eIdx !== -1) {
              const vStart = fv[eIdx];
              const vEnd = fv[(eIdx+1)%4];
              const vOther1 = fv[(eIdx+2)%4];
              const vOther2 = fv[(eIdx+3)%4];
              
              let tri, quad;
              if (V === vOther2) {
                tri = [V, vStart, M, Utils.TRI_INDEX];
                quad = [V, M, vEnd, vOther1];
              } else if (V === vOther1) {
                tri = [V, M, vEnd, Utils.TRI_INDEX];
                quad = [V, vOther2, vStart, M];
              }
              
              if (tri && quad) {
                const idf = foundFaceIdx * 4;
                faces[idf] = tri[0]; faces[idf+1] = tri[1]; faces[idf+2] = tri[2]; faces[idf+3] = tri[3];
                
                const nextFIdx = faces.length / 4;
                const newFaces = new Uint32Array(faces.length + 4);
                newFaces.set(faces);
                const nid = nextFIdx * 4;
                newFaces[nid] = quad[0]; newFaces[nid+1] = quad[1]; newFaces[nid+2] = quad[2]; newFaces[nid+3] = quad[3];
                
                activeMesh.setFaces(newFaces);
                
                const facesUV = activeMesh.getFacesTexCoord();
                if (facesUV) {
                  const uvStart = facesUV[idf + eIdx];
                  const uvEnd = facesUV[idf + (eIdx+1)%4];
                  const uvOther1 = facesUV[idf + (eIdx+2)%4];
                  const uvOther2 = facesUV[idf + (eIdx+3)%4];
                  
                  const uvM = M; // New vertex uses its index as UV index
                  const uvV = facesUV[idf + idxV];
                  
                  let triUV, quadUV;
                  if (V === vOther2) {
                    triUV = [uvV, uvStart, uvM, Utils.TRI_INDEX];
                    quadUV = [uvV, uvM, uvEnd, uvOther1];
                  } else if (V === vOther1) {
                    triUV = [uvV, uvM, uvEnd, Utils.TRI_INDEX];
                    quadUV = [uvV, uvOther2, uvStart, uvM];
                  }
                  
                  facesUV[idf] = triUV[0]; facesUV[idf+1] = triUV[1]; facesUV[idf+2] = triUV[2]; facesUV[idf+3] = triUV[3];
                  
                  const newFacesUV = new Uint32Array(facesUV.length + 4);
                  newFacesUV.set(facesUV);
                  newFacesUV[nid] = quadUV[0]; newFacesUV[nid+1] = quadUV[1]; newFacesUV[nid+2] = quadUV[2]; newFacesUV[nid+3] = quadUV[3];
                  
                  activeMesh.setFacesTexCoord(newFacesUV);
                }
                
                activeMesh.setNbFaces(nextFIdx + 1);
                continue;
              }
            }
          }
        }
      }
      // Case 4: Triangle & Vertex-to-Edge
      if (!isQuad && ((cp1.type === 'vertex' && cp2.type === 'edge') || (cp1.type === 'edge' && cp2.type === 'vertex'))) {
        const vPt = cp1.type === 'vertex' ? cp1 : cp2;
        const ePt = cp1.type === 'edge' ? cp1 : cp2;
        
        const idxV = fv.indexOf(vPt.vIdx);
        const idxEA = fv.indexOf(ePt.vA);
        const idxEB = fv.indexOf(ePt.vB);
        
        if (idxV !== -1 && idxEA !== -1 && idxEB !== -1) {
          const M = ePt.vertexIndex;
          const V = vPt.vIdx;
          
          let eIdx = -1;
          for(let k=0; k<3; k++) {
            if (fv[k] === ePt.vA && fv[(k+1)%3] === ePt.vB) { eIdx = k; break; }
            if (fv[k] === ePt.vB && fv[(k+1)%3] === ePt.vA) { eIdx = k; break; }
          }
          
          if (eIdx !== -1) {
            const vStart = fv[eIdx];
            const vEnd = fv[(eIdx+1)%3];
            
            const tri1 = [V, vStart, M, Utils.TRI_INDEX];
            const tri2 = [V, M, vEnd, Utils.TRI_INDEX];
            
            const idf = foundFaceIdx * 4;
            faces[idf] = tri1[0]; faces[idf+1] = tri1[1]; faces[idf+2] = tri1[2]; faces[idf+3] = tri1[3];
            
            const nextFIdx = faces.length / 4;
            const newFaces = new Uint32Array(faces.length + 4);
            newFaces.set(faces);
            const nid = nextFIdx * 4;
            newFaces[nid] = tri2[0]; newFaces[nid+1] = tri2[1]; newFaces[nid+2] = tri2[2]; newFaces[nid+3] = tri2[3];
            
            activeMesh.setFaces(newFaces);
            
            const facesUV = activeMesh.getFacesTexCoord();
            if (facesUV) {
              const uvStart = facesUV[idf + eIdx];
              const uvEnd = facesUV[idf + (eIdx+1)%3];
              const uvV = facesUV[idf + idxV];
              
              const uvM = M;
              
              const tri1UV = [uvV, uvStart, uvM, Utils.TRI_INDEX];
              const tri2UV = [uvV, uvM, uvEnd, Utils.TRI_INDEX];
              
              facesUV[idf] = tri1UV[0]; facesUV[idf+1] = tri1UV[1]; facesUV[idf+2] = tri1UV[2]; facesUV[idf+3] = tri1UV[3];
              
              const newFacesUV = new Uint32Array(facesUV.length + 4);
              newFacesUV.set(facesUV);
              newFacesUV[nid] = tri2UV[0]; newFacesUV[nid+1] = tri2UV[1]; newFacesUV[nid+2] = tri2UV[2]; newFacesUV[nid+3] = tri2UV[3];
              
              activeMesh.setFacesTexCoord(newFacesUV);
            }
            
            activeMesh.setNbFaces(nextFIdx + 1);
            continue;
          }
        }
      }
      
      // Case 5: Triangle & Edge-to-Edge
      if (!isQuad && cp1.type === 'edge' && cp2.type === 'edge') {
        const idxEA1 = fv.indexOf(cp1.vA);
        const idxEB1 = fv.indexOf(cp1.vB);
        const idxEA2 = fv.indexOf(cp2.vA);
        const idxEB2 = fv.indexOf(cp2.vB);
        
        if (idxEA1 !== -1 && idxEB1 !== -1 && idxEA2 !== -1 && idxEB2 !== -1) {
          const M1 = cp1.vertexIndex;
          const M2 = cp2.vertexIndex;
          
          let vShared = -1;
          if (cp1.vA === cp2.vA) vShared = cp1.vA;
          else if (cp1.vA === cp2.vB) vShared = cp1.vA;
          else if (cp1.vB === cp2.vA) vShared = cp1.vB;
          else if (cp1.vB === cp2.vB) vShared = cp1.vB;
          
          if (vShared !== -1) {
            const v1 = cp1.vA === vShared ? cp1.vB : cp1.vA;
            const v2 = cp2.vA === vShared ? cp2.vB : cp2.vA;
            
            const tri = [vShared, M2, M1, Utils.TRI_INDEX];
            const quad = [v1, M1, M2, v2];
            
            const idf = foundFaceIdx * 4;
            faces[idf] = tri[0]; faces[idf+1] = tri[1]; faces[idf+2] = tri[2]; faces[idf+3] = tri[3];
            
            const nextFIdx = faces.length / 4;
            const newFaces = new Uint32Array(faces.length + 4);
            newFaces.set(faces);
            const nid = nextFIdx * 4;
            newFaces[nid] = quad[0]; newFaces[nid+1] = quad[1]; newFaces[nid+2] = quad[2]; newFaces[nid+3] = quad[3];
            
            activeMesh.setFaces(newFaces);
            
            const facesUV = activeMesh.getFacesTexCoord();
            if (facesUV) {
              const uvShared = facesUV[idf + fv.indexOf(vShared)];
              const uv1 = facesUV[idf + fv.indexOf(v1)];
              const uv2 = facesUV[idf + fv.indexOf(v2)];
              
              const uvM1 = M1;
              const uvM2 = M2;
              
              const triUV = [uvShared, uvM2, uvM1, Utils.TRI_INDEX];
              const quadUV = [uv1, uvM1, uvM2, uv2];
              
              facesUV[idf] = triUV[0]; facesUV[idf+1] = triUV[1]; facesUV[idf+2] = triUV[2]; facesUV[idf+3] = triUV[3];
              
              const newFacesUV = new Uint32Array(facesUV.length + 4);
              newFacesUV.set(facesUV);
              newFacesUV[nid] = quadUV[0]; newFacesUV[nid+1] = quadUV[1]; newFacesUV[nid+2] = quadUV[2]; newFacesUV[nid+3] = quadUV[3];
              
              activeMesh.setFacesTexCoord(newFacesUV);
            }
            
            activeMesh.setNbFaces(nextFIdx + 1);
            continue;
          }
        }
      }
      
      // Points already share an edge
    }
    
    if (failCount > 0) {
      console.warn(`[CutTool] Cut completed with ${failCount} failed segments.`);
    }
    

    
    // Update topology and buffers
    const tcoords = activeMesh.getTexCoords();
    
    activeMesh.allocateArrays();
    activeMesh.initTopology();
    activeMesh.updateOctree();
    activeMesh.updateGeometry();
    activeMesh.updateBuffers();
    activeMesh.initRender();
    
    // Invalidate wireframe caches
      if (activeMesh._meshData) {
        activeMesh._meshData._drawElementsWireframe = null;
        activeMesh._meshData._drawArraysWireframe = null;
      }
    } catch (e) {
      console.error("[CutTool] Error in completeCut:", e);
    }
    
    this._cutPoints = [];
    this.clearPreview();
  }


  clearPreview() {
    const sceneApp = this._main.getScene ? this._main.getScene() : this._main._scene;
    let targetScene = sceneApp;
    if (sceneApp._scene) targetScene = sceneApp._scene;
    
    let parentNode = targetScene;
    if (this._main._worldGroup) parentNode = this._main._worldGroup;

    if (this._previewMesh) {
      parentNode.remove(this._previewMesh);
      this._previewMesh.geometry.dispose();
      this._previewMesh.material.dispose();
      this._previewMesh = null;
    }
    
    if (this._indicatorSpheres) {
      for (const s of this._indicatorSpheres) {
        parentNode.remove(s);
      }
      this._indicatorSpheres = null;
    }

    if (this._highlightSphere) {
      parentNode.remove(this._highlightSphere);
      this._highlightSphere.geometry.dispose();
      this._highlightSphere.material.dispose();
      this._highlightSphere = null;
    }

    this._cutPoints = [];
    this._isCutting = false;
    
    if (this._sphereGeometry) {
      this._sphereGeometry.dispose();
      this._sphereGeometry = null;
    }
    
    if (this._sphereMaterial) {
      this._sphereMaterial.dispose();
      this._sphereMaterial = null;
    }
  }
}

export default CutTool;
