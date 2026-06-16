import * as THREE from 'three';

class VoxelDensityOverlay {
  constructor() {
    this._originalMaterial = null;
    this._overlayMaterial = this.createShaderMaterial();
    this._activeMesh = null;
    this._timer = null;
    this._held = false; // true while a slider is held down — suppresses auto-hide
  }

  // Keep the preview visible until release() — used while a resolution slider is
  // held, so pausing the drag (no input events) doesn't auto-hide it.
  holdOpen() {
    this._held = true;
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
  }

  release() {
    this._held = false;
    this.disable();
  }

  createShaderMaterial() {
    return new THREE.ShaderMaterial({
      vertexShader: `
        varying vec3 vWorldPos;
        varying vec3 vNormal;
        void main() {
          vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
          vNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vWorldPos;
        varying vec3 vNormal;
        uniform float uScale;

        void main() {
          float checkX = step(0.5, fract(vWorldPos.y * uScale));
          float checkY = step(0.5, fract(vWorldPos.x * uScale));
          float checkZ = step(0.5, fract(vWorldPos.z * uScale));

          float gridX = mod(checkY + checkZ, 2.0); // YZ plane
          float gridY = mod(checkX + checkZ, 2.0); // XZ plane
          float gridZ = mod(checkX + checkY, 2.0); // XY plane

          vec3 n = abs(vNormal);
          float b = n.x + n.y + n.z;
          n /= b; // normalize

          float c = gridX * n.x + gridY * n.y + gridZ * n.z;
          
          gl_FragColor = vec4(vec3(c * 0.3 + 0.6), 1.0); 
        }
      `,
      uniforms: {
        uScale: { value: 1.0 }
      }
    });
  }

  enable(mesh, resolution, worldExtentOverride = null) {
    if (!mesh) return;
    const threeMesh = mesh.getThreeMesh ? mesh.getThreeMesh() : mesh; // Fallback if plain Three mesh
    if (!threeMesh) return;

    if (!this._activeMesh) {
      this._activeMesh = threeMesh;
      this._originalMaterial = threeMesh.material;
      threeMesh.material = this._overlayMaterial;
    }

    let worldExtent = worldExtentOverride;

    if (!worldExtent) {
      // Compute bounding box extent
      threeMesh.geometry.computeBoundingBox();
      const box = threeMesh.geometry.boundingBox;
      const localExtent = Math.max(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z);

      // Decompose matrixWorld to account for parent scales
      const scaleVec = new THREE.Vector3();
      threeMesh.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), scaleVec);
      const maxScale = Math.max(Math.abs(scaleVec.x), Math.abs(scaleVec.y), Math.abs(scaleVec.z));
      
      worldExtent = localExtent * maxScale;
      // SculptManager applies a 30% padding to match the grid bounds
      worldExtent *= 1.30;
    }

    this._overlayMaterial.uniforms.uScale.value = resolution / worldExtent;
  }

  disable() {
    if (this._activeMesh && this._originalMaterial) {
      this._activeMesh.material = this._originalMaterial;
    }
    this._activeMesh = null;
    this._originalMaterial = null;
  }

  poke(mesh, resolution, worldExtentOverride = null) {
    this.enable(mesh, resolution, worldExtentOverride);

    // While a slider is held, stay visible until release() — don't arm the
    // auto-hide timer (otherwise pausing the drag hides the preview).
    if (this._held) return;

    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      this.disable();
    }, 250); // Release detection time (fallback for callers without hold/release)
  }
}

export default new VoxelDensityOverlay(); // Singleton
