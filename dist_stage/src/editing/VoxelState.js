import { vec3 } from 'gl-matrix';
import Utils from 'misc/Utils';
import MarchingCubes from 'editing/MarchingCubes';
import SurfaceNets from 'editing/SurfaceNets';

class VoxelState {

  constructor(res = 128, size = 200.0) {
    this._resolution = res;
    this._size = size; // Physical size of the box (200.0 meters)

    // Centered at (0, 0, 0) - full scene coverage
    this._min = [-size * 0.5, -size * 0.5, -size * 0.5];
    this._max = [size * 0.5, size * 0.5, size * 0.5];

    this._step = size / res;

    this._dims = [res, res, res];
    this._count = res * res * res;

    // Data
    // We only need distance field for now. Colors/Materials can be added later.
    this._distanceField = new Float32Array(this._count);

    // Active Bounds (Inclusive)
    this._activeMin = new Int32Array([res, res, res]);
    this._activeMax = new Int32Array([0, 0, 0]);

    this.clear(); // Init to 10000.0 (Far)

    // Cache helper objects
    this._voxels = {
      dims: this._dims,
      step: this._step,
      min: this._min,
      max: this._max,
      distanceField: this._distanceField,
      colorField: new Float32Array(this._count * 3), // Optional
      materialField: new Float32Array(this._count * 3) // Optional
    };

    // Init colors/mats to default
    this._voxels.colorField.fill(0.8); // Grey
    this._voxels.materialField.fill(0.2); // Rougness?
  }

  get min() { return this._min; }
  get max() { return this._max; }
  get step() { return this._step; }
  get dims() { return this._dims; }

  clear() {
    this._distanceField.fill(10000.0); // Safe far distance (avoid Infinity for interpolation)

    // Reset Bounds to Inverted
    this._activeMin.set([this._resolution, this._resolution, this._resolution]);
    this._activeMax.set([0, 0, 0]);
  }

  // Boolean Union: min(existing, new)
  // Sphere: dist = length(p - center) - radius
  // Boolean Union: min(existing, new)
  // Sphere: dist = length(p - center) - radius
  addSphere(center, radius, color) {
    var res = this._resolution;
    var step = this._step;
    var min = this._min;

    // Center in Grid Coords (0 to res)
    var cx = (center[0] - min[0]) / step;
    var cy = (center[1] - min[1]) / step;
    var cz = (center[2] - min[2]) / step;

    // Grid Bounds
    var rGrid = Math.ceil(radius / step) + 1;
    var ixMin = Math.max(0, Math.floor(cx - rGrid));
    var ixMax = Math.min(res, Math.ceil(cx + rGrid));
    var iyMin = Math.max(0, Math.floor(cy - rGrid));
    var iyMax = Math.min(res, Math.ceil(cy + rGrid));
    var izMin = Math.max(0, Math.floor(cz - rGrid));
    var izMax = Math.min(res, Math.ceil(cz + rGrid));

    if (window.screenLog && Math.random() < 0.1) {
      // Log sparse
      // window.screenLog(`VS.addSphere: C:${cx.toFixed(1)},${cy.toFixed(1)},${cz.toFixed(1)} R:${rGrid} Bounds: ${ixMin}..${ixMax}`, "grey");
    } else {
      // Force log for now
      // window.screenLog(`VS.addSphere: C:${cx.toFixed(1)},${cy.toFixed(1)},${cz.toFixed(1)} R:${rGrid}`, "grey");
    }

    var df = this._distanceField;
    var cf = this._voxels.colorField;

    var rx = res;
    var rxy = res * res;

    var changed = false;
    var hits = 0;

    for (var k = izMin; k < izMax; ++k) {
      for (var j = iyMin; j < iyMax; ++j) {
        for (var i = ixMin; i < ixMax; ++i) {

          // Voxel Position in World
          var valX = min[0] + i * step;
          var valY = min[1] + j * step;
          var valZ = min[2] + k * step;

          // Distance to Sphere Center
          var dx = valX - center[0];
          var dy = valY - center[1];
          var dz = valZ - center[2];
          var dist = Math.sqrt(dx * dx + dy * dy + dz * dz) - radius;

          var index = i + j * rx + k * rxy;
          var oldDist = df[index];

          if (dist < oldDist) {
            df[index] = dist;
            changed = true;
            hits++;

            // Simple Color splat (TODO: Mixing)
            if (color) {
              var id3 = index * 3;
              cf[id3] = color[0];
              cf[id3 + 1] = color[1];
              cf[id3 + 2] = color[2];
            }
          }
        }
      }
    }

    // if (window.screenLog && changed) window.screenLog(`VS: Mod ${hits} voxels`, "lime");

    // Update Active Bounds
    if (changed) {
      if (ixMin < this._activeMin[0]) this._activeMin[0] = ixMin;
      if (iyMin < this._activeMin[1]) this._activeMin[1] = iyMin;
      if (izMin < this._activeMin[2]) this._activeMin[2] = izMin;

      if (ixMax > this._activeMax[0]) this._activeMax[0] = ixMax;
      if (iyMax > this._activeMax[1]) this._activeMax[1] = iyMax;
      if (izMax > this._activeMax[2]) this._activeMax[2] = izMax;
    }

    return changed;
  }

  // Boolean Difference: max(existing, -new)
  subtractSphere(center, radius) {
    var res = this._resolution;
    var step = this._step;
    var min = this._min;

    // Center in Grid Coords (0 to res)
    var cx = (center[0] - min[0]) / step;
    var cy = (center[1] - min[1]) / step;
    var cz = (center[2] - min[2]) / step;

    // Grid Bounds
    var rGrid = Math.ceil(radius / step) + 1;
    var ixMin = Math.max(0, Math.floor(cx - rGrid));
    var ixMax = Math.min(res, Math.ceil(cx + rGrid));
    var iyMin = Math.max(0, Math.floor(cy - rGrid));
    var iyMax = Math.min(res, Math.ceil(cy + rGrid));
    var izMin = Math.max(0, Math.floor(cz - rGrid));
    var izMax = Math.min(res, Math.ceil(cz + rGrid));

    var df = this._distanceField;

    var rx = res;
    var rxy = res * res;

    var changed = false;

    for (var k = izMin; k < izMax; ++k) {
      for (var j = iyMin; j < iyMax; ++j) {
        for (var i = ixMin; i < ixMax; ++i) {

          // Voxel Position in World
          var valX = min[0] + i * step;
          var valY = min[1] + j * step;
          var valZ = min[2] + k * step;

          // Distance to Sphere Center
          var dx = valX - center[0];
          var dy = valY - center[1];
          var dz = valZ - center[2];
          var dist = Math.sqrt(dx * dx + dy * dy + dz * dz) - radius;

          var index = i + j * rx + k * rxy;
          var oldDist = df[index];

          if (-dist > oldDist) {
            df[index] = -dist;
            changed = true;
          }
        }
      }
    }

    // Update Active Bounds
    if (changed) {
      if (ixMin < this._activeMin[0]) this._activeMin[0] = ixMin;
      if (iyMin < this._activeMin[1]) this._activeMin[1] = iyMin;
      if (izMin < this._activeMin[2]) this._activeMin[2] = izMin;

      if (ixMax > this._activeMax[0]) this._activeMax[0] = ixMax;
      if (iyMax > this._activeMax[1]) this._activeMax[1] = iyMax;
      if (izMax > this._activeMax[2]) this._activeMax[2] = izMax;
      if (window.screenLog && Math.random() < 0.2) window.screenLog(`VS.add: Expanded [${ixMin},${iyMin},${izMin}]-[${ixMax},${iyMax},${izMax}]`, "grey");
    }

    return changed;
  }

  computeMesh() {
    // Clamp Bounds (Ensure padding of 1 for correct gradients/iso-surface)
    // SurfaceNets needs to look at n-1 or n+1?
    // It creates faces for "current" voxel by looking back?
    // We should pad by 1 or 2.
    // Loop limits: 0 .. dims-1.
    // We should clamp the Active Bounds to [0, dims].

    // Pass bounds to SurfaceNets
    const bounds = {
      min: [
        Math.max(0, this._activeMin[0] - 2),
        Math.max(0, this._activeMin[1] - 2),
        Math.max(0, this._activeMin[2] - 2)
      ],
      max: [
        Math.min(this._dims[0], this._activeMax[0] + 2),
        Math.min(this._dims[1], this._activeMax[1] + 2),
        Math.min(this._dims[2], this._activeMax[2] + 2)
      ]
    };
    if (window.screenLog) window.screenLog(`VS.compute: Bounds [${bounds.min}] to [${bounds.max}]`, "cyan");

    // Use SurfaceNets (Dual Contouring style)
    const res = SurfaceNets.computeSurface(this._voxels, bounds); // Pass bounds!

    // Log Raw Stats
    // if (window.screenLog) window.screenLog(`VS: Generated ${res.vertices.length/3} verts, ${res.faces.length/4} quads`, "grey");

    this.sanitizeMesh(res);


    return res;
  }

  sanitizeMesh(res) {
    const faces = res.faces;
    const vertices = res.vertices;
    const newFaces = [];
    let badFaces = 0;

    // Reuse temp vectors to avoid GC thrashing
    const ab = vec3.create();
    const ac = vec3.create();
    const v1 = vec3.create();
    const v2 = vec3.create();
    const v3 = vec3.create();
    const normal = vec3.create();

    for (let i = 0; i < faces.length; i += 3) { // Assume TRI_INDEX is removed or handled? 
      // Wait, MarchingCubes/SurfaceNets might produce [a, b, c, TRI_INDEX]?
      // Utils.TRI_INDEX is usually appended in SculptGL meshes?
      // Inspecting SurfaceNets.js: It pushes [a, b, c, d] for quads?
      // SurfaceNets.js: `faces.push(buffer[m], buffer[m - du], buffer[m - du - dv], buffer[m - dv]);`
      // It seems SurfaceNets produces QUADS (4 indices).
      // Constructing 2 triangles per quad?
      // Or does it push 4 indices and Mesh.js handles quads?
      // Let's check SurfaceNets.js again.
    }
    // Checking SurfaceNets.js again...
    // It pushes 4 indices per "Face".
    // "faces.push(buffer[m], buffer[m - du], buffer[m - du - dv], buffer[m - dv]);"
    // So 'faces' is a flat array of Quad indices? `[a,b,c,d, a,b,c,d...]`

    // BUT SculptGL `Mesh.setFaces` expects mixed tri/quads or just tris?
    // MarchingCubes.js Line 665: `faces.push(edges[f[l]], edges[f[l + 1]], edges[f[l + 2]], Utils.TRI_INDEX);`
    // So MarchingCubes uses 4 elements per face (3 indices + TRI_INDEX).

    // SurfaceNets.js passes 4 indices. Does it add a specific Quad flag?
    // It seems it just pushes 4 indices.
    // If the 4th is NOT TRI_INDEX, it's a quad.

    // We need to handle Quads in sanitization.
    // Calculate Normal/Area for Quad?
    // Split into 2 triangles and check both?

    // Let's just do a simple check: Are valid vertices distinct?

    // RE-READING SurfaceNets.js:
    // It pushes 4 ints.
    // VoxelState.js `computeMesh` returns `res`.
    // We should assume Quads for SurfaceNets.

    // Let's implement robust sanitization.
    // However, if we filter faces, we must maintain the structure (4 ints per face).

    for (let i = 0; i < faces.length; i += 4) {
      const i1 = faces[i];
      const i2 = faces[i + 1];
      const i3 = faces[i + 2];
      const i4 = faces[i + 3];

      // Quad?
      let isQuad = (i4 !== Utils.TRI_INDEX);

      // Start simple: Check for coincident vertices in the Quad/Tri
      // (Degenerate if any 2 vertices are same)
      // Note: SurfaceNets might produce T-junctions or singular edges, but coincident vertices are the main NaN source.

      let degenerate = false;
      if (i1 === i2 || i1 === i3) degenerate = true;
      if (isQuad) {
        if (i1 === i4 || i2 === i4 || i3 === i4) degenerate = true;
        // Check diagonal too?
        if (i2 === i3) degenerate = true; // wait i1=i2, i1=i3, i2=i3 covers triangle
      } else {
        if (i2 === i3) degenerate = true;
      }

      // Also check area?
      // Let's rely on coincident indices first, as that's the absolute zero case.
      // SurfaceNets can produce very small faces.

      if (!degenerate) {
        // Calculate area to be sure
        v1[0] = vertices[i1 * 3]; v1[1] = vertices[i1 * 3 + 1]; v1[2] = vertices[i1 * 3 + 2];
        v2[0] = vertices[i2 * 3]; v2[1] = vertices[i2 * 3 + 1]; v2[2] = vertices[i2 * 3 + 2];
        v3[0] = vertices[i3 * 3]; v3[1] = vertices[i3 * 3 + 1]; v3[2] = vertices[i3 * 3 + 2];

        // Create explicit output vector to avoid aliasing (ab = ab x ac) issues
        vec3.sub(ab, v2, v1);
        vec3.sub(ac, v3, v1);
        vec3.cross(normal, ab, ac);
        if (vec3.length(normal) < 1e-6) {
          degenerate = true;
        }

        if (!degenerate && isQuad) {
          // Check second triangle of quad
          v1[0] = vertices[i3 * 3]; v1[1] = vertices[i3 * 3 + 1]; v1[2] = vertices[i3 * 3 + 2];
          const v4 = vec3.create();
          v4[0] = vertices[i4 * 3]; v4[1] = vertices[i4 * 3 + 1]; v4[2] = vertices[i4 * 3 + 2];

          // Reuse v1(i3)
          // v3 var holds i3 coords? No, used as temp.
          // Let's re-fetch to be safe or reuse v1.
          // v1 has i3.
          // We need tri (i1, i3, i4)?
          // Original code: v1=i3. sub(ab, v3, v1). v3 was i3?
          // Wait, previous loop: v3=i3.
          // So sub(ab, v3, v1) -> sub(ab, i3, i3) = 0?
          // AH.
          // Original code:
          // v1 = i3.
          // vec3.sub(ab, v3, v1).
          // v3 was SET to i3 in previous block (lines 336).
          // So v3 is i3. v1 is i3.
          // So ab = 0.
          // Area = 0.
          // SECOND TRIANGLE WAS ALWAYS DEGENERATE because of logic error?
          // But First Triangle was also degenerate?
          // Line 340: vec3.cross(ab, ab, ac). Aliasing.

          // Let's fix FIRST triangle aliasing first.
          // Then checking Second triangle logic.
          // v1=i3.
          // v3 is still i3 from line 336.
          // So v1 == v3.
          // We need (i1, i3, i4).
          // i1 coords are in... wait, we overwrote v1/v2/v3?
          // We need fresh coords.

          // Let's fetch clean coords for Tri 2.
          const t1 = vec3.create(); // i1
          const t3 = vec3.create(); // i3
          const t4 = vec3.create(); // i4

          t1[0] = vertices[i1 * 3]; t1[1] = vertices[i1 * 3 + 1]; t1[2] = vertices[i1 * 3 + 2];
          t3[0] = vertices[i3 * 3]; t3[1] = vertices[i3 * 3 + 1]; t3[2] = vertices[i3 * 3 + 2];
          t4[0] = vertices[i4 * 3]; t4[1] = vertices[i4 * 3 + 1]; t4[2] = vertices[i4 * 3 + 2];

          vec3.sub(ab, t3, t1);
          vec3.sub(ac, t4, t1);
          vec3.cross(normal, ab, ac);
          if (vec3.length(normal) < 1e-6) {
            degenerate = true;
          }
        }
      }

      if (!degenerate) {
        newFaces.push(i1, i2, i3, i4);
      } else {
        if (badFaces < 5) {
          const vLog = `F${i / 4} R: v1=[${v1[0].toFixed(2)},${v1[1].toFixed(2)},${v1[2].toFixed(2)}] v2=[${v2[0].toFixed(2)},${v2[1].toFixed(2)},${v2[2].toFixed(2)}] Area=${vec3.length(normal).toExponential(2)}`;
          console.warn(vLog);
          if (window.screenLog) window.screenLog(vLog, "red");
        }
        badFaces++;
      }
    }

    if (badFaces > 0) {
      const msg = `Sanitized: Removed ${badFaces} degenerate faces (Total: ${faces.length / 4})`;
      console.warn(msg);
      if (window.screenLog) window.screenLog(msg, "orange");
      res.faces = new Uint32Array(newFaces); 
    } else {
      // console.log(`Sanitized: Clean mesh (0/${faces.length / 4} bad)`);
      // if (window.screenLog) window.screenLog(`Sanitized: Clean mesh (0/${faces.length / 4} bad)`, "grey");
    }
  }

  getDistanceField() {
    return this._distanceField;
  }

  setDistanceField(newField) {
    // Copy the data back
    if (newField.length !== this._distanceField.length) {
      console.error("State mismatch in Voxel Undo");
      return;
    }
    this._distanceField.set(newField);
  }
}

export default VoxelState;
