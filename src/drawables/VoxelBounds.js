import { mat4 } from 'gl-matrix';
import * as THREE from 'three';

class VoxelBounds {

  constructor(main) {
    this._main = main;
    this._id = -1002;

    this._matrix = mat4.create();

    // Wireframe Unit Cube [-0.5, 0.5] mapped as 12 lines (24 vertices)
    const v = [
      // Bottom face
      -0.5, -0.5, -0.5, 0.5, -0.5, -0.5,
      0.5, -0.5, -0.5, 0.5, -0.5, 0.5,
      0.5, -0.5, 0.5, -0.5, -0.5, 0.5,
      -0.5, -0.5, 0.5, -0.5, -0.5, -0.5,

      // Top face
      -0.5, 0.5, -0.5, 0.5, 0.5, -0.5,
      0.5, 0.5, -0.5, 0.5, 0.5, 0.5,
      0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
      -0.5, 0.5, 0.5, -0.5, 0.5, -0.5,

      // Vertical edges
      -0.5, -0.5, -0.5, -0.5, 0.5, -0.5,
      0.5, -0.5, -0.5, 0.5, 0.5, -0.5,
      0.5, -0.5, 0.5, 0.5, 0.5, 0.5,
      -0.5, -0.5, 0.5, -0.5, 0.5, 0.5
    ];

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(v), 3));
    
    const material = new THREE.LineBasicMaterial({
      color: 0x00ff00, // Green for voxel bounds
      transparent: true,
      opacity: 0.5,
      depthTest: true,
      depthWrite: false
    });

    this._threeMesh = new THREE.LineSegments(geometry, material);
    this._threeMesh.frustumCulled = false;
    this._threeMesh.visible = true;

    if (main && main._worldGroup) {
      main._worldGroup.add(this._threeMesh);
    }
  }

  updateMatrices(size, matrix) {
    if (!size || !matrix || !this._threeMesh) return;

    mat4.identity(this._matrix);
    
    // Use a temporary matrix for the size-scale to avoid self-multiplication bugs in gl-matrix
    const tempScaleMatrix = mat4.create();
    mat4.scale(tempScaleMatrix, tempScaleMatrix, [size, size, size]);
    mat4.mul(this._matrix, matrix, tempScaleMatrix);

    // Convert gl-matrix mat4 to THREE.Matrix4
    const finalScaleX = this._matrix[0];
    const finalScaleY = this._matrix[5];
    const finalScaleZ = this._matrix[10];
    const finalPosX = this._matrix[12];
    const finalPosY = this._matrix[13];
    const finalPosZ = this._matrix[14];

    this._threeMesh.matrixAutoUpdate = true;
    this._threeMesh.scale.set(100.0, 100.0, 100.0);
    this._threeMesh.position.set(finalPosX, finalPosY, finalPosZ);
  }

  render(main, size, matrix) {
    this.updateMatrices(size, matrix);
    this.setVisible(true);
  }

  getThreeMesh() {
    return this._threeMesh;
  }

  setVisible(bool) {
    if (this._threeMesh) {
      this._threeMesh.visible = bool;
    }
  }
}

export default VoxelBounds;
