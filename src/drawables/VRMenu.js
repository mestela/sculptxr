import { mat4, vec3, mat3, quat } from 'gl-matrix';
import * as THREE from 'three';

class VRMenu {
  constructor(gl, guiXR) {
    this._gl = gl;
    this._guiXR = guiXR;

    const DENSITY = 1024 / 0.30;
    const canvasWidth = this._guiXR._canvas ? this._guiXR._canvas.width : 1024;
    const canvasHeight = this._guiXR._canvas ? this._guiXR._canvas.height : 1024;

    this._w = (canvasWidth / DENSITY) / 2.0;
    this._h = (canvasHeight / DENSITY) / 2.0;

    // Create Three.js Plane
    const geometry = new THREE.PlaneGeometry(this._w * 2, this._h * 2);
    
    // Create Texture
    this.texture = new THREE.CanvasTexture(this._guiXR._canvas);
    this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;
    
    // Automatically trigger Three.js texture upload when the raw canvas changes!
    if (this._guiXR.onTextureUpdated) {
        this._guiXR.onTextureUpdated(() => {
            this.texture.needsUpdate = true;
        });
    }
    
    const material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthTest: true,
      depthWrite: false, 
      side: THREE.DoubleSide
    });

    this.mesh = new THREE.Mesh(geometry, material);
    
    // OVERLAY_SCALE: The UI canvas is drawn dense (1024x1024) but scaled up physically for VR legibility.
    // We make it 10% bigger than before (0.904 * 1.1 = 0.9944)
    const OVERLAY_SCALE = 0.9944;
    this.mesh.scale.set(OVERLAY_SCALE, OVERLAY_SCALE, OVERLAY_SCALE);

    this._cacheWorld = mat4.create();

    // Default configuration (Main Menu)
    this._rotation = vec3.fromValues(-Math.PI / 2, 0, 0);
    this._offset = vec3.fromValues(0.1, 0.1, -0.05);

    this.rebuildMatrix();
  }

  rebuildMatrix() {
    this.mesh.position.set(this._offset[0], this._offset[1], this._offset[2]);
    this.mesh.rotation.set(this._rotation[0], this._rotation[1], this._rotation[2]);
    this.mesh.updateMatrix();
  }

  // Adjust Rotation (Delta in Radians)
  adjustRotation(dx, dy, dz) {
    this._rotation[0] += dx;
    this._rotation[1] += dy;
    this._rotation[2] += dz;
    this.rebuildMatrix();
    return this._rotation;
  }

  setRotation(x, y, z) {
    vec3.set(this._rotation, x, y, z);
    this.rebuildMatrix();
  }

  setOffset(x, y, z) {
    vec3.set(this._offset, x, y, z);
    this.rebuildMatrix();
  }

  updateMatrices(camera, controllerMatrix) {
    if (controllerMatrix) {
        // Build Local Transform Matrix
        const localMat = mat4.create();
        
        // Use Three.js quaternion to guarantee identical rotation order
        // this.mesh.quaternion is automatically updated by rebuildMatrix() when this._rotation changes
        const q = quat.fromValues(
            this.mesh.quaternion.x, 
            this.mesh.quaternion.y, 
            this.mesh.quaternion.z, 
            this.mesh.quaternion.w
        );

        // Build TRS matrix (Translation, Rotation, Scale=1 so raycast uses math base coords)
        mat4.fromRotationTranslationScale(localMat, q, this._offset, [1, 1, 1]);

        // Multiply into final _cacheWorld
        mat4.multiply(this._cacheWorld, controllerMatrix, localMat);
    } else {
        // Fallback to Three.js graph if standalone
        this.mesh.updateMatrixWorld(true);
        for (let i = 0; i < 16; i++) {
            this._cacheWorld[i] = this.mesh.matrixWorld.elements[i];
        }
    }
  }

  intersect(origin, direction) {
    if (!this.mesh) return null;
    
    // Explicitly update matrix world for safety before raycasting
    this.mesh.updateMatrixWorld(true);

    // We MUST use `_cacheWorld` because in `Scene.js`, the VR physical controller scale/matrix 
    // is manually pushed into _cacheWorld, but the Three.js scene graph might not inherit it correctly 
    // depending on where `main.add(vrMenu.mesh)` happened.
    const mat = this._cacheWorld;

    // 1. Extract Plane Origin and Normal from World Matrix
    const pO = vec3.fromValues(mat[12], mat[13], mat[14]);
    const pN = vec3.fromValues(mat[8], mat[9], mat[10]); // Z-axis is normal
    vec3.normalize(pN, pN);

    // 2. Validate Origin and Direction inputs
    const o = vec3.fromValues(origin[0], origin[1], origin[2]);
    const d = vec3.fromValues(direction[0], direction[1], direction[2]);

    // 3. Ray-Plane Intersection Math
    const denom = vec3.dot(pN, d);
    if (Math.abs(denom) < 0.0001) return null; // Ray is parallel to plane

    const diff = vec3.create();
    vec3.sub(diff, pO, o);
    const t = vec3.dot(pN, diff) / denom;
    
    if (t < 0) return null; // Intersects behind the controller

    // 4. Calculate World Hit Point
    const pHit = vec3.create();
    vec3.scaleAndAdd(pHit, o, d, t);

    // 5. Convert World Hit to Local Plane Space (using inverse cacheWorld)
    const invMat = mat4.create();
    mat4.invert(invMat, mat);
    const localHit = vec3.create();
    vec3.transformMat4(localHit, pHit, invMat);

    // 6. Check Bounds (with generous padding for VR fingers/lasers)
    const lx = localHit[0];
    const ly = localHit[1];
    const pad = 0.01;
    
    // OVERLAY_SCALE multiplier matching visual scale in constructor (10% bigger than 0.904)
    const OVERLAY_SCALE = 0.9944;
    const scaledW = this._w * OVERLAY_SCALE;
    const scaledH = this._h * OVERLAY_SCALE;
    
    if (lx < -(scaledW + pad) || lx > (scaledW + pad) || ly < -(scaledH + pad) || ly > (scaledH + pad)) {
        return null; // Hit the infinite plane, but missed the physical menu quad
    }

    // 7. Calculate UVs (Clamp to strict 0-1 bounds so padding doesn't stretch UI clicks)
    const clx = Math.max(-scaledW, Math.min(scaledW, lx));
    const cly = Math.max(-scaledH, Math.min(scaledH, ly));

    const u = (clx + scaledW) / (2 * scaledW);
    const v = (cly + scaledH) / (2 * scaledH);

    if (Math.random() < 0.02) {
       // console.log(`[VRMenu] MATH HIT! U:${u.toFixed(2)} V:${v.toFixed(2)} Dist:${t.toFixed(2)}`);
    }

    return { 
        uv: [u, v], 
        distance: t,
        object: this.mesh 
    };
  }

  intersectPoint(point) {
    if (!this.mesh) return null;
    this.mesh.updateMatrixWorld(true);

    // Convert world point to local space of the mesh
    const localPoint = new THREE.Vector3(point[0], point[1], point[2]);
    this.mesh.worldToLocal(localPoint);

    // Check Z distance (Generous 3cm in front, 5cm behind Menu plane)
    if (localPoint.z > 0.03 || localPoint.z < -0.05) return null; 

    // Add padding to hit area
    const lx = localPoint.x;
    const ly = localPoint.y;
    const w = this._w;
    const h = this._h;
    const pad = 0.01; 
    
    if (lx < -(w + pad) || lx > (w + pad) || ly < -(h + pad) || ly > (h + pad)) return null;

    // Clamp UVs to strict bounds so edge padding doesn't stretch coordinates
    const clx = Math.max(-w, Math.min(w, lx));
    const cly = Math.max(-h, Math.min(h, ly));

    const u = (clx + w) / (2 * w);
    const v = (cly + h) / (2 * h);

    return { uv: [u, v], distance: localPoint.z };
  }

  update() {
    this.render(); // Backwards compatibility for Scene.js calling menu.update() if aliased
  }

  render(main) {
    if (this._guiXR && this._guiXR._needsUpload) {
      this.texture.needsUpdate = true;
      this._guiXR._needsUpload = false;
    }
    
    // Natively toggle Three.js renderer visibility
    this.mesh.visible = (this._guiXR && this._guiXR._isVisible);
  }
}

export default VRMenu;
