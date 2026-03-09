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
    this._distanceField.fill(10000.0, 0, this._count); // Safe far distance (avoid Infinity for interpolation)

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



  // Helper to rotate vector by quaternion
  _rotateVecByQuat(v, q) {
    var ix = q[3] * v[0] + q[1] * v[2] - q[2] * v[1];
    var iy = q[3] * v[1] + q[2] * v[0] - q[0] * v[2];
    var iz = q[3] * v[2] + q[0] * v[1] - q[1] * v[0];
    var iw = -q[0] * v[0] - q[1] * v[1] - q[2] * v[2];
    
    return [
      ix * q[3] + iw * -q[0] + iy * -q[2] - iz * -q[1],
      iy * q[3] + iw * -q[1] + iz * -q[0] - ix * -q[2],
      iz * q[3] + iw * -q[2] + ix * -q[1] - iy * -q[0]
    ];
  }

  // Unified Edit Wrapper
  editSphere(center, radius, color, isNegative, shape, brushRotation) {
    if (isNegative) {
      return this.subtractSphere(center, radius, shape, brushRotation);
    } else {
      return this.addSphere(center, radius, color, shape, brushRotation);
      self.postMessage({ type: "LOG", data: "addSphere R="+radius.toFixed(2)+" Cx="+cx.toFixed(1) });

    }
  }

  // Boolean Union: min(existing, new)
  // Distance to primitive
  addSphere(center, radius, color, shape = 0, brushRotation) {
    var res = this._resolution;
    var step = this._step;
    var min = this._min;

    // Center in Grid Coords (0 to res)
    var cx = (center[0] - min[0]) / step;
    var cy = (center[1] - min[1]) / step;
    var cz = (center[2] - min[2]) / step;

    // Grid Bounds
    var boundingRadius = (shape === 1) ? radius * 1.733 : radius; // sqrt(3) max corner dist
    var rGrid = Math.ceil(boundingRadius / step) + 1;
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
    var negCount = 0;

    for (var k = izMin; k < izMax; ++k) {
      for (var j = iyMin; j < iyMax; ++j) {
        for (var i = ixMin; i < ixMax; ++i) {

          // Voxel Position in World
          var valX = min[0] + i * step;
          var valY = min[1] + j * step;
          var valZ = min[2] + k * step;

          // Distance to primitive
          var dist = 0.0;
          if (shape === 1) {
            // Cube
            var dx = valX - center[0];
            var dy = valY - center[1];
            var dz = valZ - center[2];

            if (brushRotation) {
              var invQ = [-brushRotation[0], -brushRotation[1], -brushRotation[2], brushRotation[3]];
              var rot = this._rotateVecByQuat([dx, dy, dz], invQ);
              dx = rot[0]; dy = rot[1]; dz = rot[2];
            }

            var qx = Math.abs(dx) - radius;
            var qy = Math.abs(dy) - radius;
            var qz = Math.abs(dz) - radius;
            var dlx = Math.max(qx, 0.0);
            var dly = Math.max(qy, 0.0);
            var dlz = Math.max(qz, 0.0);
            dist = Math.sqrt(dlx * dlx + dly * dly + dlz * dlz) + Math.min(Math.max(qx, Math.max(qy, qz)), 0.0);
          } else {
            // Sphere
            var dx = valX - center[0];
            var dy = valY - center[1];
            var dz = valZ - center[2];
            dist = Math.sqrt(dx * dx + dy * dy + dz * dz) - radius;
          }

          var index = i + j * rx + k * rxy;
          var oldDist = df[index];

          if (dist < oldDist) {
            df[index] = dist;
            changed = true;
            if (dist < 0.0) negCount++;

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
  subtractSphere(center, radius, shape = 0, brushRotation) {
    var res = this._resolution;
    var step = this._step;
    var min = this._min;

    // Center in Grid Coords (0 to res)
    var cx = (center[0] - min[0]) / step;
    var cy = (center[1] - min[1]) / step;
    var cz = (center[2] - min[2]) / step;

    // Grid Bounds
    var boundingRadius = (shape === 1) ? radius * 1.733 : radius; 
    var rGrid = Math.ceil(boundingRadius / step) + 1;
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

          // Distance to primitive
          var dist = 0.0;
          if (shape === 1) {
            // Cube
            var dx = valX - center[0];
            var dy = valY - center[1];
            var dz = valZ - center[2];

            if (brushRotation) {
              var invQ = [-brushRotation[0], -brushRotation[1], -brushRotation[2], brushRotation[3]];
              var rot = this._rotateVecByQuat([dx, dy, dz], invQ);
              dx = rot[0]; dy = rot[1]; dz = rot[2];
            }

            var qx = Math.abs(dx) - radius;
            var qy = Math.abs(dy) - radius;
            var qz = Math.abs(dz) - radius;
            var dlx = Math.max(qx, 0.0);
            var dly = Math.max(qy, 0.0);
            var dlz = Math.max(qz, 0.0);
            dist = Math.sqrt(dlx * dlx + dly * dly + dlz * dlz) + Math.min(Math.max(qx, Math.max(qy, qz)), 0.0);
          } else {
            // Sphere
            var dx = valX - center[0];
            var dy = valY - center[1];
            var dz = valZ - center[2];
            dist = Math.sqrt(dx * dx + dy * dy + dz * dz) - radius;
          }

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
  inflateSphere(center, radius, strength, shape = 0, brushRotation) {
    var res = this._resolution;
    var step = this._step;
    var min = this._min;

    // Center in Grid Coords (0 to res)
    var cx = (center[0] - min[0]) / step;
    var cy = (center[1] - min[1]) / step;
    var cz = (center[2] - min[2]) / step;

    // Grid Bounds
    var boundingRadius = (shape === 1) ? radius * 1.733 : radius; 
    var rGrid = Math.ceil(boundingRadius / step) + 1;
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

          // Distance to primitive
          var dist = 0.0;
          if (shape === 1) {
            // Cube
            var dx = valX - center[0];
            var dy = valY - center[1];
            var dz = valZ - center[2];

            if (brushRotation) {
              var invQ = [-brushRotation[0], -brushRotation[1], -brushRotation[2], brushRotation[3]];
              var rot = this._rotateVecByQuat([dx, dy, dz], invQ);
              dx = rot[0]; dy = rot[1]; dz = rot[2];
            }

            var qx = Math.abs(dx) - radius;
            var qy = Math.abs(dy) - radius;
            var qz = Math.abs(dz) - radius;
            var dlx = Math.max(qx, 0.0);
            var dly = Math.max(qy, 0.0);
            var dlz = Math.max(qz, 0.0);
            dist = Math.sqrt(dlx * dlx + dly * dly + dlz * dlz) + Math.min(Math.max(qx, Math.max(qy, qz)), 0.0);
          } else {
            // Sphere
            var dx = valX - center[0];
            var dy = valY - center[1];
            var dz = valZ - center[2];
            dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          }

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

  // Localized 3D Blur (Averaging SDF values)
  smoothSphere(center, radius, strength, shape = 0, brushRotation) {
    var res = this._resolution;
    var step = this._step;
    var min = this._min;
    
    // Center in Grid Coords (0 to res)
    var cx = (center[0] - min[0]) / step;
    var cy = (center[1] - min[1]) / step;
    var cz = (center[2] - min[2]) / step;
    
    // Grid Bounds
    var boundingRadius = (shape === 1) ? radius * 1.733 : radius; 
    var rGrid = Math.ceil(boundingRadius / step) + 1;
    // Don't smooth the absolute boundary voxels (keep 1 voxel padding)
    var ixMin = Math.max(1, Math.floor(cx - rGrid));
    var ixMax = Math.min(res - 1, Math.ceil(cx + rGrid));
    var iyMin = Math.max(1, Math.floor(cy - rGrid));
    var iyMax = Math.min(res - 1, Math.ceil(cy + rGrid));
    var izMin = Math.max(1, Math.floor(cz - rGrid));
    var izMax = Math.min(res - 1, Math.ceil(cz + rGrid));

    var df = this._distanceField;
    var rx = res;
    var rxy = res * res;
    
    var changed = false;
    
    // We MUST write to a temporary array so we don't smear values mid-loop
    // To save allocation, we just create a temp array for the bounding box
    var sizeX = ixMax - ixMin;
    var sizeY = iyMax - iyMin;
    var sizeZ = izMax - izMin;
    
    // Skip if box is empty
    if (sizeX <= 0 || sizeY <= 0 || sizeZ <= 0) return false;
    
    var tempField = new Float32Array(sizeX * sizeY * sizeZ);
    // Initialize temporary buffer with current values
    for (var k = 0; k < sizeZ; ++k) {
      var gk = izMin + k;
      for (var j = 0; j < sizeY; ++j) {
        var gj = iyMin + j;
        for (var i = 0; i < sizeX; ++i) {
          var gi = ixMin + i;
          tempField[i + j*sizeX + k*sizeX*sizeY] = df[gi + gj * rx + gk * rxy];
        }
      }
    }
    
    // Apply Smoothing
    for (var k = 0; k < sizeZ; ++k) {
      var gk = izMin + k;
      for (var j = 0; j < sizeY; ++j) {
        var gj = iyMin + j;
        for (var i = 0; i < sizeX; ++i) {
          var gi = ixMin + i;
          
          // Voxel Position in World
          var valX = min[0] + gi * step;
          var valY = min[1] + gj * step;
          var valZ = min[2] + gk * step;
          
          var dist = 0.0;
          if (shape === 1) { // Cube
            var dx = valX - center[0];
            var dy = valY - center[1];
            var dz = valZ - center[2];
            if (brushRotation) {
              var invQ = [-brushRotation[0], -brushRotation[1], -brushRotation[2], brushRotation[3]];
              var rot = this._rotateVecByQuat([dx, dy, dz], invQ);
              dx = rot[0]; dy = rot[1]; dz = rot[2];
            }
            var qx = Math.abs(dx) - radius;
            var qy = Math.abs(dy) - radius;
            var qz = Math.abs(dz) - radius;
            dist = Math.sqrt(Math.max(qx, 0) * Math.max(qx, 0) + Math.max(qy, 0) * Math.max(qy, 0) + Math.max(qz, 0) * Math.max(qz, 0)) + Math.min(Math.max(qx, Math.max(qy, qz)), 0.0);
          } else { // Sphere
            var dx = valX - center[0];
            var dy = valY - center[1];
            var dz = valZ - center[2];
            dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          }
          
          if (dist < radius) {
            var index = gi + gj * rx + gk * rxy;
            
            // Average 6 neighbors
            var sum = df[index - 1] + df[index + 1] + 
                      df[index - rx] + df[index + rx] + 
                      df[index - rxy] + df[index + rxy];
            var avg = sum / 6.0;
            
            var falloff = 1.0 - (dist / radius); // Linear falloff
            // Falloff smoothing (Smoothstep) for nicer blending at edges
            falloff = falloff * falloff * (3 - 2 * falloff);
            
            // Lerp towards average based on strength & falloff
            var mix = strength * falloff;
            tempField[i + j*sizeX + k*sizeX*sizeY] = df[index] * (1.0 - mix) + avg * mix;
            changed = true;
          }
        }
      }
    }
    
    // Copy Back
    if (changed) {
      for (var k = 0; k < sizeZ; ++k) {
        var gk = izMin + k;
        for (var j = 0; j < sizeY; ++j) {
          var gj = iyMin + j;
          for (var i = 0; i < sizeX; ++i) {
            var gi = ixMin + i;
            df[gi + gj * rx + gk * rxy] = tempField[i + j*sizeX + k*sizeX*sizeY];
          }
        }
      }
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
      // self.postMessage({ type: 'LOG', data: `TightenBounds: Empty BBox [${minX}, ${maxX}]` });
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
    const res = SurfaceNets.computeSurface(this._voxels, bounds, false); // Pass computeNormals=false

    // Compute face-area-weighted normals on the worker thread
    this.computeGeometricNormals(res);

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
    const colors = res.colors;
    const materials = res.materials;
    const normals = res.normals;
    const newFaces = [];
    let badFaces = 0;

    // 1. Sanitize Colors & Initialize Materials
    if (colors && materials) {
      for (let i = 0; i < colors.length; i += 3) {
        // Fix NaN colors
        if (isNaN(colors[i]) || isNaN(colors[i + 1]) || isNaN(colors[i + 2])) {
          colors[i] = 0.0;
          colors[i + 1] = 0.0;
          colors[i + 2] = 0.0;
        }
        
        // Force valid materials (Roughness=0.5, Metallic=0.0, Mask=1.0)
        materials[i] = 0.5;
        materials[i + 1] = 0.0;
        materials[i + 2] = 1.0;
      }
    }

    // 2. Sanitize Normals (Fix NaNs and Zero-Length)
    if (normals) {
      for (let i = 0; i < normals.length; i += 3) {
        const x = normals[i];
        const y = normals[i + 1];
        const z = normals[i + 2];
        const len2 = x * x + y * y + z * z;
        if (isNaN(x) || isNaN(y) || isNaN(z) || len2 < 1e-6) {
          normals[i] = 0.0;
          normals[i + 1] = 1.0;
          normals[i + 2] = 0.0;
        }
      }
    }

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
          // Normal of Tri 2 (i1, i3, i4)
          v1[0] = vertices[i1 * 3]; v1[1] = vertices[i1 * 3 + 1]; v1[2] = vertices[i1 * 3 + 2];
          v2[0] = vertices[i3 * 3]; v2[1] = vertices[i3 * 3 + 1]; v2[2] = vertices[i3 * 3 + 2];
          v3[0] = vertices[i4 * 3]; v3[1] = vertices[i4 * 3 + 1]; v3[2] = vertices[i4 * 3 + 2];

          vec3.sub(ab, v2, v1);
          vec3.sub(ac, v3, v1);
          vec3.cross(normal, ab, ac);

          if (vec3.length(normal) < 1e-6) {
            degenerate = true;
          }
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

  computeGeometricNormals(res) {
    const vAr = res.vertices;
    const fAr = res.faces;
    const nAr = new Float32Array(vAr.length);
    const nbFaces = fAr.length / 4;
    const ab = vec3.create();
    const ac = vec3.create();
    const normal = vec3.create();
    const v1 = vec3.create();
    const v2 = vec3.create();
    const v3 = vec3.create();

    for (let i = 0; i < nbFaces; ++i) {
      const id = i * 4;
      const i1 = fAr[id];
      const i2 = fAr[id + 1];
      const i3 = fAr[id + 2];
      const i4 = fAr[id + 3];

      // Triangle 1 (v1-v2-v3)
      v1[0] = vAr[i1 * 3]; v1[1] = vAr[i1 * 3 + 1]; v1[2] = vAr[i1 * 3 + 2];
      v2[0] = vAr[i2 * 3]; v2[1] = vAr[i2 * 3 + 1]; v2[2] = vAr[i2 * 3 + 2];
      v3[0] = vAr[i3 * 3]; v3[1] = vAr[i3 * 3 + 1]; v3[2] = vAr[i3 * 3 + 2];

      vec3.sub(ab, v2, v1);
      vec3.sub(ac, v3, v1);
      vec3.cross(normal, ab, ac); // weighted by area

      if (vec3.length(normal) > 1e-6) {
        nAr[i1 * 3] += normal[0]; nAr[i1 * 3 + 1] += normal[1]; nAr[i1 * 3 + 2] += normal[2];
        nAr[i2 * 3] += normal[0]; nAr[i2 * 3 + 1] += normal[1]; nAr[i2 * 3 + 2] += normal[2];
        nAr[i3 * 3] += normal[0]; nAr[i3 * 3 + 1] += normal[1]; nAr[i3 * 3 + 2] += normal[2];
      }

      // Triangle 2 (v1-v3-v4) for Quads
      if (i4 !== Utils.TRI_INDEX) {
        const v4 = vec3.create();
        v4[0] = vAr[i4 * 3]; v4[1] = vAr[i4 * 3 + 1]; v4[2] = vAr[i4 * 3 + 2];

        vec3.sub(ab, v3, v1);
        vec3.sub(ac, v4, v1);
        vec3.cross(normal, ab, ac);

        if (vec3.length(normal) > 1e-6) {
          nAr[i1 * 3] += normal[0]; nAr[i1 * 3 + 1] += normal[1]; nAr[i1 * 3 + 2] += normal[2];
          nAr[i3 * 3] += normal[0]; nAr[i3 * 3 + 1] += normal[1]; nAr[i3 * 3 + 2] += normal[2];
          nAr[i4 * 3] += normal[0]; nAr[i4 * 3 + 1] += normal[1]; nAr[i4 * 3 + 2] += normal[2];
        }
      }
    }

    Utils.normalizeArrayVec3(nAr);
    res.normals = nAr;
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

  resample(newRes) {
    if (newRes === this._resolution) return;

    const oldRes = this._resolution;
    const oldStep = this._step;
    const oldMin = this._min;
    const oldDF = this._distanceField;

    const newStep = (oldStep * oldRes) / newRes; // Assuming same physical size
    const newDF = new Float32Array(newRes * newRes * newRes);
    newDF.fill(10000.0); // Default to Far

    // Helper to sample old grid
    // Helper to sample old grid (Clamped to prevent border shrinking)
    const getVal = (x, y, z) => {
      const cx = Math.max(0, Math.min(x, oldRes - 1));
      const cy = Math.max(0, Math.min(y, oldRes - 1));
      const cz = Math.max(0, Math.min(z, oldRes - 1));
      return oldDF[cx + cy * oldRes + cz * oldRes * oldRes];
    };

    // Trilinear Interpolation
    for (let k = 0; k < newRes; k++) {
      for (let j = 0; j < newRes; j++) {
        for (let i = 0; i < newRes; i++) {

          // World Pos
          const wx = oldMin[0] + i * newStep;
          const wy = oldMin[1] + j * newStep;
          const wz = oldMin[2] + k * newStep;

          // Old Grid Coord (Strictly bounded to avoid NaN)
          const ox = (wx - oldMin[0]) / oldStep;
          const oy = (wy - oldMin[1]) / oldStep;
          const oz = (wz - oldMin[2]) / oldStep;

          let x0 = Math.floor(ox); 
          let y0 = Math.floor(oy); 
          let z0 = Math.floor(oz); 

          // Clamp to valid range so x1 doesn't exceed oldRes-1
          x0 = Math.max(0, Math.min(x0, oldRes - 2));
          y0 = Math.max(0, Math.min(y0, oldRes - 2));
          z0 = Math.max(0, Math.min(z0, oldRes - 2));

          const x1 = x0 + 1;
          const y1 = y0 + 1;
          const z1 = z0 + 1;

          const tx = Math.max(0, Math.min(ox - x0, 1.0));
          const ty = Math.max(0, Math.min(oy - y0, 1.0));
          const tz = Math.max(0, Math.min(oz - z0, 1.0));

          // Sample 8 corners
          const c000 = getVal(x0, y0, z0);
          const c100 = getVal(x1, y0, z0);
          const c010 = getVal(x0, y1, z0);
          const c110 = getVal(x1, y1, z0);
          const c001 = getVal(x0, y0, z1);
          const c101 = getVal(x1, y0, z1);
          const c011 = getVal(x0, y1, z1);
          const c111 = getVal(x1, y1, z1);

          // Interpolate
          const nx00 = c000 * (1 - tx) + c100 * tx;
          const nx01 = c001 * (1 - tx) + c101 * tx;
          const nx10 = c010 * (1 - tx) + c110 * tx;
          const nx11 = c011 * (1 - tx) + c111 * tx;

          const ny0 = nx00 * (1 - ty) + nx10 * ty;
          const ny1 = nx01 * (1 - ty) + nx11 * ty;

          const val = ny0 * (1 - tz) + ny1 * tz;

          newDF[i + j * newRes + k * newRes * newRes] = val;
        }
      }
    }

    // Update State
    this._resolution = newRes;
    this._count = newRes * newRes * newRes; // CRITICAL: Fix stale count
    this._step = newStep;
    this._dims[0] = newRes;
    this._dims[1] = newRes;
    this._dims[2] = newRes;
    this._distanceField = newDF;
    this._voxels.distanceField = newDF;
    this._voxels.dims = this._dims;
    this._voxels.step = this._step;
    this._voxels.min = this._min;
    this._voxels.max = this._max;
    // Reallocate Color/Mat fields if they exist! (They do in constructor)
    this._voxels.colorField = new Float32Array(this._count * 3);
    this._voxels.colorField.fill(0.8);
    this._voxels.materialField = new Float32Array(this._count * 3);
    this._voxels.materialField.fill(0.2);


    // Reset Active Bounds to full
    this._activeMin = new Int32Array([0, 0, 0]);
    this._activeMax = new Int32Array([newRes, newRes, newRes]);
  }
}

export default VoxelState;
