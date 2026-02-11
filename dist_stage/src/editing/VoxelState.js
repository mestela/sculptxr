import { vec3 } from '../../lib/gl-matrix-wrapper.js';
import Utils from '../misc/Utils.js';
import SurfaceNets from './SurfaceNets.js';

class VoxelState {

  constructor(res = 128, size = 200.0) {
    console.log(`VoxelState: Constructor Start (Res=${res}, Size=${size})`);
    try {
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

      console.log("VoxelState: Constructor End");
    } catch (e) {
      console.error("VoxelState: Constructor Failed", e);
      throw e;
    }
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

  // Trilinear Sample
  sample(x, y, z) {
    const res = this._resolution;
    // Clamp to valid range (0..res-1) or return Far if out?
    // SDF is defined everywhere inside the box. Outside box = Far.
    if (x < 0 || y < 0 || z < 0 || x >= res - 1 || y >= res - 1 || z >= res - 1) return 10000.0;

    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);

    const fx = x - ix;
    const fy = y - iy;
    const fz = z - iz;

    const rx = res;
    const rxy = res * res;

    const idx = ix + iy * rx + iz * rxy;

    const d000 = this._distanceField[idx];
    const d100 = this._distanceField[idx + 1];
    const d010 = this._distanceField[idx + rx];
    const d110 = this._distanceField[idx + 1 + rx];

    const d001 = this._distanceField[idx + rxy];
    const d101 = this._distanceField[idx + 1 + rxy];
    const d011 = this._distanceField[idx + rx + rxy];
    const d111 = this._distanceField[idx + 1 + rx + rxy];

    // Lerp X
    const d00 = d000 + (d100 - d000) * fx;
    const d10 = d010 + (d110 - d010) * fx;
    const d01 = d001 + (d101 - d001) * fx;
    const d11 = d011 + (d111 - d011) * fx;

    // Lerp Y
    const d0 = d00 + (d10 - d00) * fy;
    const d1 = d01 + (d11 - d01) * fy;

    // Lerp Z
    return d0 + (d1 - d0) * fz;
  }

  resample(newRes) {
    console.log(`VoxelState: Resampling ${this._resolution} -> ${newRes}`);

    // 1. Setup New Grid
    const newCount = newRes * newRes * newRes;
    const newDist = new Float32Array(newCount);
    // const newCol = new Float32Array(newCount * 3);
    // const newMat = new Float32Array(newCount * 3);

    const newStep = this._size / newRes;
    const oldStep = this._step;
    // const ratio = newStep / oldStep; // Coordinate scaler?

    // Both grids share the same Physical MIN/MAX (Centered).
    // So WorldPos = Min + GridIndex * Step
    // OldGridIndex = (WorldPos - Min) / OldStep 
    //              = (Min + NewIndex * NewStep - Min) / OldStep
    //              = NewIndex * (NewStep / OldStep)

    const ratio = newStep / oldStep;

    // Bounds for loop
    // Ensure we don't go out of bounds of OLD grid?
    // sample() handles bounds checks.

    // Optimization: Multithread? Unroll?
    // For 256^3 -> 16M voxels. Main thread might hang.
    // We are in Worker, so it's fine.

    let ptr = 0;
    const rx = newRes;
    const rxy = newRes * newRes;

    // TODO: Only iterate Active Bounds? Not trivial because Active Bounds change with resolution.
    // But we could project OLD active bounds to new grid and iterate only there + padding.
    // For now, Full Sweep for correctness.

    for (let k = 0; k < newRes; ++k) {
      const oldZ = k * ratio;
      for (let j = 0; j < newRes; ++j) {
        const oldY = j * ratio;
        for (let i = 0; i < newRes; ++i) {
          const oldX = i * ratio;

          newDist[ptr++] = this.sample(oldX, oldY, oldZ);
        }
      }
    }

    // Swap Data
    this._resolution = newRes;
    this._count = newCount;
    this._distanceField = newDist;
    this._step = newStep;

    this._dims = [newRes, newRes, newRes];

    // Update Voxels Wrapper
    this._voxels.dims = this._dims;
    this._voxels.step = this._step;
    this._voxels.distanceField = this._distanceField;
    // Reset Color/Mat fields (or implement resampling for them too)
    this._voxels.colorField = new Float32Array(newCount * 3).fill(0.8);
    this._voxels.materialField = new Float32Array(newCount * 3).fill(0.2); // Roughness default

    // Recalculate Active Bounds
    // Full scan or just clear and let tightenBounds handle it?
    // tightenBounds needs an initial conservative box.
    this._activeMin.set([0, 0, 0]); // Reset to full
    this._activeMax.set([newRes, newRes, newRes]);
    // tightenBounds(); // Will run on next computeMesh
  }

  // Unified Edit Wrapper
  editSphere(center, radius, color, isNegative) {
    if (isNegative) {
      return this.subtractSphere(center, radius);
    } else {
      return this.addSphere(center, radius, color);
    }
  }

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

    var df = this._distanceField;
    var cf = this._voxels.colorField;

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

          if (dist < oldDist) {
            df[index] = dist;
            changed = true;

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

          // SUBTRACTION: dist = max(val, -d)
          // d = dist to sphere surface (negative inside).
          // We want the resulting distance to be at least -d (distance to the cutout surface).
          var val = -dist; // Inverted sphere distance
          if (val > oldDist) {
            df[index] = val;
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
    }

    return changed;
  }

  // Inflate/Deflate: df[i] -= strength * falloff
  inflateSphere(center, radius, strength) {
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
          var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

          if (dist < radius) {
            // Falloff (Linear for now, 1.0 at center, 0.0 at radius)
            var falloff = 1.0 - (dist / radius);
            // Smoothstep falloff?
            // falloff = falloff * falloff * (3 - 2 * falloff);

            var index = i + j * rx + k * rxy;
            // df[index] -= strength * falloff * step; // Was scaled by step
            df[index] -= strength * falloff; // World Units strength (stronger, resolution independent magnitude)

            changed = true;
          }
        }
      }
    }

    // Update Active Bounds (Conservative: expand if we inflated near edges?)
    // Actually inflate usually expands surface.
    // We should just expand bounds by radius to be safe if changed.
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

  tightenBounds() {
    // Scan inwards to find tighter Active Bounds
    // We only care about Negative Values (Solid) because Surface is around < 0.0
    // Optimisation: Scan Z first (contiguous slices)

    // Safety check - if already inverted, reset? Or assume correct?
    // Let's reset to full bounds if inverted, then tighten.
    // Or just clamp current bounds if valid.

    let minX = this._activeMin[0], minY = this._activeMin[1], minZ = this._activeMin[2];
    let maxX = this._activeMax[0], maxY = this._activeMax[1], maxZ = this._activeMax[2];

    const res = this._resolution;
    const df = this._distanceField;
    const strideY = res;
    const strideZ = res * res;

    // Bounds Check: If min > max, the grid is effectively empty. Reset to inverted so we can detect new content.
    if (minX > maxX || minY > maxY || minZ > maxZ) {
      this.clear(); // Resets activeMin/Max
      return;
    }

    // 1. Scan Z Min (Upwards)
    let found = false;
    for (let k = minZ; k <= maxZ; ++k) {
      const offsetK = k * strideZ;
      for (let j = minY; j <= maxY; ++j) {
        const offsetJ = offsetK + j * strideY;
        for (let i = minX; i <= maxX; ++i) {
          if (df[offsetJ + i] < 0.0) { found = true; break; }
        }
        if (found) break;
      }
      if (found) { minZ = k; break; }
    }
    if (!found) { // Empty Grid
      this.clear();
      return;
    }

    // 2. Scan Z Max (Downwards)
    found = false;
    for (let k = maxZ; k >= minZ; --k) {
      const offsetK = k * strideZ;
      for (let j = minY; j <= maxY; ++j) {
        const offsetJ = offsetK + j * strideY;
        for (let i = minX; i <= maxX; ++i) {
          if (df[offsetJ + i] < 0.0) { found = true; break; }
        }
        if (found) break;
      }
      if (found) { maxZ = k; break; }
    }

    // 3. Scan Y Min (Upwards)
    // Now restricted by new Z bounds!
    found = false;
    for (let j = minY; j <= maxY; ++j) {
      for (let k = minZ; k <= maxZ; ++k) {
        const offset = k * strideZ + j * strideY;
        for (let i = minX; i <= maxX; ++i) {
          if (df[offset + i] < 0.0) { found = true; break; }
        }
        if (found) break;
      }
      if (found) { minY = j; break; }
    }

    // 4. Scan Y Max (Downwards)
    found = false;
    for (let j = maxY; j >= minY; --j) {
      for (let k = minZ; k <= maxZ; ++k) {
        const offset = k * strideZ + j * strideY;
        for (let i = minX; i <= maxX; ++i) {
          if (df[offset + i] < 0.0) { found = true; break; }
        }
        if (found) break;
      }
      if (found) { maxY = j; break; }
    }

    // 5. Scan X Min (Upwards)
    found = false;
    for (let i = minX; i <= maxX; ++i) {
      for (let k = minZ; k <= maxZ; ++k) {
        const offsetK = k * strideZ;
        for (let j = minY; j <= maxY; ++j) {
          if (df[offsetK + j * strideY + i] < 0.0) { found = true; break; }
        }
        if (found) break;
      }
      if (found) { minX = i; break; }
    }

    // 6. Scan X Max (Downwards)
    found = false;
    for (let i = maxX; i >= minX; --i) {
      for (let k = minZ; k <= maxZ; ++k) {
        const offsetK = k * strideZ;
        for (let j = minY; j <= maxY; ++j) {
          if (df[offsetK + j * strideY + i] < 0.0) { found = true; break; }
        }
        if (found) break;
      }
      if (found) { maxX = i; break; }
    }

    // Verify bounds validity?
    // Clamp to [0, res]?
    // Typically loop indices are safe.

    this._activeMin[0] = minX; this._activeMin[1] = minY; this._activeMin[2] = minZ;
    this._activeMax[0] = maxX; this._activeMax[1] = maxY; this._activeMax[2] = maxZ;
  }

  computeMesh() {
    // 1. Attempt to tighten bounds (Cheap scan if object is small)
    this.tightenBounds();

    // Check if empty
    if (this._activeMin[0] > this._activeMax[0]) {
      return { vertices: new Float32Array(0), faces: new Uint32Array(0), colors: new Float32Array(0), materials: new Float32Array(0) };
    }

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
    // if (window.screenLog) window.screenLog(`VS.compute: Bounds [${bounds.min}] to [${bounds.max}]`, "cyan");

    // Use SurfaceNets (Dual Contouring style)
    const res = SurfaceNets.computeSurface(this._voxels, bounds, this._smooth); // Pass bounds!
    // const res = { vertices: new Float32Array(0), faces: new Uint32Array(0), colors: new Float32Array(0), materials: new Float32Array(0) }; // Mock result

    // Log Raw Stats
    // if (window.screenLog) window.screenLog(`VS: Generated ${res.vertices.length/3} verts, ${res.faces.length/4} quads`, "grey");

    this.sanitizeMesh(res);


    return res;
  }

  set smooth(val) { this._smooth = !!val; }
  get smooth() { return this._smooth; }

  sanitizeMesh(res) {
    const faces = res.faces;
    const vertices = res.vertices;
    const newFaces = [];
    let badFaces = 0;

    // Reuse temp vectors to avoid GC thrashing (for validation)
    const ab = vec3.create();
    const ac = vec3.create();
    const v1 = vec3.create();
    const v2 = vec3.create();
    const v3 = vec3.create();
    // const v4 = vec3.create(); // Unused for now
    const normal = vec3.create();

    // Loop over Quads (SurfaceNets produces Quads: 4 indices per face)
    for (let i = 0; i < faces.length; i += 4) {
      const i1 = faces[i];
      const i2 = faces[i + 1];
      const i3 = faces[i + 2];
      const i4 = faces[i + 3];

      // Quad?
      let isQuad = (i4 !== Utils.TRI_INDEX);

      // Start simple: Check for coincident vertices in the Quad/Tri
      let degenerate = false;
      if (i1 === i2 || i1 === i3) degenerate = true;
      if (isQuad) {
        if (i1 === i4 || i2 === i4 || i3 === i4) degenerate = true;
        if (i2 === i3) degenerate = true;
      } else {
        if (i2 === i3) degenerate = true;
      }

      if (!degenerate) {
        // Calculate area to be sure
        v1[0] = vertices[i1 * 3]; v1[1] = vertices[i1 * 3 + 1]; v1[2] = vertices[i1 * 3 + 2];
        v2[0] = vertices[i2 * 3]; v2[1] = vertices[i2 * 3 + 1]; v2[2] = vertices[i2 * 3 + 2];
        v3[0] = vertices[i3 * 3]; v3[1] = vertices[i3 * 3 + 1]; v3[2] = vertices[i3 * 3 + 2];

        // Normal of Tri 1 (i1, i2, i3)
        vec3.sub(ab, v2, v1);
        vec3.sub(ac, v3, v1);
        vec3.cross(normal, ab, ac);

        if (vec3.length(normal) < 1e-6) {
          degenerate = true;
        }

        if (!degenerate && isQuad) {
          // Quad Logic (Legacy) - SurfaceNets now outputs Triangles (padded with TRI_INDEX)
          // So this block is rarely reached unless Quads are re-introduced.

        }
      }

      if (!degenerate) {
        newFaces.push(i1, i2, i3, i4);
      } else {
        badFaces++;
      }
    }

    if (badFaces > 0) {
      console.warn(`Sanitized: Removed ${badFaces} degenerate faces`);
      res.faces = new Uint32Array(newFaces);
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

    // CRITICAL: Reset Active Bounds to full size
    // Otherwise 'tightenBounds' will only scan within the generic/previous bounds of the 'future' state,
    // potentially clipping the restored content.
    this._activeMin.set([0, 0, 0]);
    this._activeMax.set([this._resolution, this._resolution, this._resolution]);
  }

}

export default VoxelState;
