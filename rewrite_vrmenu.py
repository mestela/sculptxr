import re

with open('src/drawables/VRMenu.js', 'r') as f:
    orig = f.read()

# I want to rewrite VRMenu so it returns a Three mesh but keeps the exact same intersect(origin, direction) math
new_content = """import { mat4, vec3, mat3 } from 'gl-matrix';
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
    
    const material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthTest: true,
      depthWrite: false, 
      side: THREE.DoubleSide
    });

    this.mesh = new THREE.Mesh(geometry, material);

    this._cacheWorld = mat4.create();

    // Default configuration
    this._rotation = vec3.fromValues(Math.PI / 2, 0, 0);
    this._offset = vec3.fromValues(0.15, 0.0, 0.0);

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
    // This function used to be called to manually push the physical controller matrix.
    // NATIVELY IN THREE.JS: The scene graph handles the transform hierarchy automatically.
    // However, our old tool logic (handleXRInput) uses `this._cacheWorld` to do raw Math.
    // We just read what Three.js calculated!
    this.mesh.updateMatrixWorld(true);
    for (let i = 0; i < 16; i++) {
        this._cacheWorld[i] = this.mesh.matrixWorld.elements[i];
    }
  }

  intersect(origin, direction) {
    if (!this._cacheWorld) return null;

    // Invert World Matrix to transform Ray to Local Space
    const invWorld = mat4.create();
    mat4.invert(invWorld, this._cacheWorld);

    // Transform Origin
    const localOrigin = vec3.create();
    vec3.transformMat4(localOrigin, origin, invWorld);

    // Transform Direction
    const p1 = vec3.create();
    vec3.add(p1, origin, direction);
    const localP1 = vec3.create();
    vec3.transformMat4(localP1, p1, invWorld);
    
    const localDir = vec3.create();
    vec3.sub(localDir, localP1, localOrigin);
    vec3.normalize(localDir, localDir);

    // Intersect with Plane Z=0
    if (Math.abs(localDir[2]) < 1e-6) return null; // Parallel

    const t = -localOrigin[2] / localDir[2];
    if (t < 0) return null; // Behind ray

    // Intersection Point
    const lx = localOrigin[0] + localDir[0] * t;
    const ly = localOrigin[1] + localDir[1] * t;

    // Check bounds
    const w = this._w;
    const h = this._h;
    if (lx < -w || lx > w || ly < -h || ly > h) return null;

    // Map to UV [0,1]
    const u = (lx + w) / (2 * w);
    const v = (ly + h) / (2 * h);

    return { uv: [u, v], distance: t };
  }

  intersectPoint(point) {
    if (!this._cacheWorld) return null;

    const invWorld = mat4.create();
    mat4.invert(invWorld, this._cacheWorld);

    const localPoint = vec3.create();
    vec3.transformMat4(localPoint, point, invWorld);

    // Check Z distance (Generous 3cm in front, 5cm behind)
    if (localPoint[2] > 0.03 || localPoint[2] < -0.05) return null; 

    // Add padding to hit area
    const lx = localPoint[0];
    const ly = localPoint[1];
    const w = this._w;
    const h = this._h;
    const pad = 0.01; 
    
    if (lx < -(w + pad) || lx > (w + pad) || ly < -(h + pad) || ly > (h + pad)) return null;

    // Clamp UVs to strict bounds so edge padding doesn't stretch coordinates
    const clx = Math.max(-w, Math.min(w, lx));
    const cly = Math.max(-h, Math.min(h, ly));

    const u = (clx + w) / (2 * w);
    const v = (cly + h) / (2 * h);

    return { uv: [u, v], distance: localPoint[2] };
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
"""

with open('src/drawables/VRMenu.js', 'w') as f:
    f.write(new_content)

print("Replacement complete.")
