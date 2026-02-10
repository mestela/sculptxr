import { mat4, vec3 } from 'gl-matrix';
import MeshStatic from '../mesh/meshStatic/MeshStatic.js?v=fix_3';
import Enums from '../misc/Enums.js?v=fix_3';
import Primitives from './Primitives.js?v=fix_3';

class Gnomon {

  constructor(gl) {
    this._gl = gl;
    this._meshes = [];

    // Dimensions for "sticks"
    const len = 0.1; // 10cm
    const thick = 0.005; // 5mm

    // Helper to create an axis box
    const createAxis = (size, offset, color) => {
      const mesh = new MeshStatic(gl);
      mesh.setUseDrawArrays(true);

      // Box Geometry
      // Primitives.createCube gives non-indexed vertices if we ask? 
      // Actually Primitives returns indexed geometry usually.
      // Let's just use a simple unindexed box builder or transform Primitives.createCube.

      // Primitives.createCube(gl) returns formatted object for Multimesh usually?
      // Let's use Primitives but we need to flatten it for MeshStatic if we manually handle it.
      // Or just use multimesh?
      // Multimesh is easiest if available.
      // But we want to avoid importing Multimesh if we can just use MeshStatic.
      // Let's stick to MeshStatic and simple buffers.

      // Simple Box: 36 vertices (6 faces * 2 tris * 3 verts)
      // Or just reuse Primitives.createCube's buffers?
      // Let's rely on Primitives for vertices and scale/translate them manually?
      // Too much math.

      // Let's just use 3 lines for the Gnomon? User asked for "sticks".
      // Let's try MultiMesh approach?
      // A Gnomon is 3 Meshes.

      // Let's just create 3 MeshStatic with cube geometry.
      // Cube: [-1,1].

      const base = Primitives.createCube(gl);
      // base is a MeshStatic instance
      const v = base.getVertices(); // Float32Array
      if (!v) {
        console.error("Gnomon: No vertices in base cube");
        return new MeshStatic(gl);
      }

      const tV = new Float32Array(v.length);
      for (let i = 0; i < v.length; i += 3) {
        let x = v[i] * size[0] + offset[0];
        let y = v[i + 1] * size[1] + offset[1];
        let z = v[i + 2] * size[2] + offset[2];
        tV[i] = x;
        tV[i + 1] = y;
        tV[i + 2] = z;
      }

      mesh.setVertices(tV);
      const indices = base.getFaces();
      if (indices) mesh.setFaces(indices);

      mesh.init();
      // mesh.initRender(); // RenderData is already created in constructor? 
      // But initRender() creates GL buffers from RAM data.
      mesh.initRender();

      mesh.setFlatColor(color);
      mesh.setShaderType(Enums.Shader.FLAT);
      return mesh;
    };

    // X Axis (Red) - Length along X
    this._meshes.push(createAxis([len, thick, thick], [len, 0, 0], [1.0, 0.0, 0.0]));
    // Wait, createCube is center based? [-1, 1]. Size should be half-extents?
    // If I want 0 to 1?
    // base is -1 to 1.
    // v * len + len -> 0 to 2*len.
    // Correct logic: v * (len/2) + (len/2). Range 0 to len.

    const mkAxis = (axisIdx, color) => {
      const size = [thick, thick, thick];
      size[axisIdx] = len * 0.5; // Half-extent
      const offset = [0, 0, 0];
      offset[axisIdx] = len * 0.5; // Shift so it starts at 0
      return createAxis(size, offset, color);
    };

    this._meshes.push(mkAxis(0, [1, 0, 0])); // X
    this._meshes.push(mkAxis(1, [0, 1, 0])); // Y
    this._meshes.push(mkAxis(2, [0, 0, 1])); // Z

    // Center Cube (Controller Body)
    // 4cm cube? 
    const centerSize = [0.02, 0.02, 0.02]; // Half-extents for 4cm? No, 2cm half -> 4cm full
    // Primitive cube is 1.0 (so -0.5 to 0.5).
    // if size is 0.02, range is -0.02 to 0.02 (4cm).
    // User asked for "red controller cube".
    this._meshes.push(createAxis(centerSize, [0, 0, 0], [1.0, 0.0, 0.0]));
  }

  updateMatrices(camera, parentMatrix) {
    for (let m of this._meshes) {
      const mat = m.getMatrix();
      mat4.copy(mat, parentMatrix);
      m.updateMatrices(camera);
    }
  }

  render(main) {
    for (let m of this._meshes) {
      m.render(main);
    }
  }
}

export default Gnomon;
