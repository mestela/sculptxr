import { vec3 } from '../../lib/gl-matrix-wrapper.js';
import Utils from '../misc/Utils.js';
import SurfaceNets from './SurfaceNets.js';

const intersectionRayTriangleEdges = (function () {
  var EPSILON = 1E-15;
  var ONE_PLUS_EPSILON = 1.0 + EPSILON;
  var ZERO_MINUS_EPSILON = 0.0 - EPSILON;
  var pvec = [0.0, 0.0, 0.0];
  var tvec = [0.0, 0.0, 0.0];
  var qvec = [0.0, 0.0, 0.0];
  return function (orig, dir, edge1, edge2, v1, vertInter) {
    vec3.cross(pvec, dir, edge2);
    var det = vec3.dot(edge1, pvec);
    if (det > -EPSILON && det < EPSILON) return -1.0;
    var invDet = 1.0 / det;
    vec3.sub(tvec, orig, v1);
    var u = vec3.dot(tvec, pvec) * invDet;
    if (u < ZERO_MINUS_EPSILON || u > ONE_PLUS_EPSILON) return -1.0;
    vec3.cross(qvec, tvec, edge1);
    var v = vec3.dot(dir, qvec) * invDet;
    if (v < ZERO_MINUS_EPSILON || u + v > ONE_PLUS_EPSILON) return -1.0;
    var t = vec3.dot(edge2, qvec) * invDet;
    if (t < ZERO_MINUS_EPSILON) return -1.0;
    if (vertInter) vec3.scaleAndAdd(vertInter, orig, dir, t);
    return t;
  };
})();

const distance2PointTriangleEdges = (function () {
  var diff = [0.0, 0.0, 0.0];
  return function (point, edge1, edge2, v1, a00, a01, a11, closest) {
    vec3.sub(diff, v1, point);
    var b0 = vec3.dot(diff, edge1);
    var b1 = vec3.dot(diff, edge2);
    var c = vec3.sqrLen(diff);
    var det = Math.abs(a00 * a11 - a01 * a01);
    var s = a01 * b1 - a11 * b0;
    var t = a01 * b0 - a00 * b1;
    var sqrDistance;
    var zone = 4;

    if (s + t <= det) {
      if (s < 0.0) {
        if (t < 0.0) {
          zone = 4;
          if (b0 < 0.0) {
            t = 0.0;
            if (-b0 >= a00) { s = 1.0; sqrDistance = a00 + 2.0 * b0 + c; }
            else { s = -b0 / a00; sqrDistance = b0 * s + c; }
          } else {
            s = 0.0;
            if (b1 >= 0.0) { t = 0.0; sqrDistance = c; }
            else if (-b1 >= a11) { t = 1.0; sqrDistance = a11 + 2.0 * b1 + c; }
            else { t = -b1 / a11; sqrDistance = b1 * t + c; }
          }
        } else {
          zone = 3; s = 0.0;
          if (b1 >= 0.0) { t = 0.0; sqrDistance = c; }
          else if (-b1 >= a11) { t = 1.0; sqrDistance = a11 + 2.0 * b1 + c; }
          else { t = -b1 / a11; sqrDistance = b1 * t + c; }
        }
      } else if (t < 0.0) {
        zone = 5; t = 0.0;
        if (b0 >= 0.0) { s = 0.0; sqrDistance = c; }
        else if (-b0 >= a00) { s = 1.0; sqrDistance = a00 + 2.0 * b0 + c; }
        else { s = -b0 / a00; sqrDistance = b0 * s + c; }
      } else {
        zone = 0;
        var invDet = 1.0 / det;
        s *= invDet; t *= invDet;
        sqrDistance = s * (a00 * s + a01 * t + 2.0 * b0) + t * (a01 * s + a11 * t + 2.0 * b1) + c;
      }
    } else {
      var tmp0, tmp1, numer, denom;
      if (s < 0.0) {
        zone = 2; tmp0 = a01 + b0; tmp1 = a11 + b1;
        if (tmp1 > tmp0) {
          numer = tmp1 - tmp0; denom = a00 - 2.0 * a01 + a11;
          if (numer >= denom) { s = 1.0; t = 0.0; sqrDistance = a00 + 2.0 * b0 + c; }
          else { s = numer / denom; t = 1.0 - s; sqrDistance = s * (a00 * s + a01 * t + 2.0 * b0) + t * (a01 * s + a11 * t + 2.0 * b1) + c; }
        } else {
          s = 0.0;
          if (tmp1 <= 0.0) { t = 1.0; sqrDistance = a11 + 2.0 * b1 + c; }
          else if (b1 >= 0.0) { t = 0.0; sqrDistance = c; }
          else { t = -b1 / a11; sqrDistance = b1 * t + c; }
        }
      } else if (t < 0.0) {
        zone = 6; tmp0 = a01 + b1; tmp1 = a00 + b0;
        if (tmp1 > tmp0) {
          numer = tmp1 - tmp0; denom = a00 - 2.0 * a01 + a11;
          if (numer >= denom) { t = 1.0; s = 0.0; sqrDistance = a11 + 2.0 * b1 + c; }
          else { t = numer / denom; s = 1.0 - t; sqrDistance = s * (a00 * s + a01 * t + 2.0 * b0) + t * (a01 * s + a11 * t + 2.0 * b1) + c; }
        } else {
          t = 0.0;
          if (tmp1 <= 0.0) { s = 1.0; sqrDistance = a00 + 2.0 * b0 + c; }
          else if (b0 >= 0.0) { s = 0.0; sqrDistance = c; }
          else { s = -b0 / a00; sqrDistance = b0 * s + c; }
        }
      } else {
        zone = 1; numer = a11 + b1 - a01 - b0;
        if (numer <= 0.0) { s = 0.0; t = 1.0; sqrDistance = a11 + 2.0 * b1 + c; }
        else {
          denom = a00 - 2.0 * a01 + a11;
          if (numer >= denom) { s = 1.0; t = 0.0; sqrDistance = a00 + 2.0 * b0 + c; }
          else { s = numer / denom; t = 1.0 - s; sqrDistance = s * (a00 * s + a01 * t + 2.0 * b0) + t * (a01 * s + a11 * t + 2.0 * b1) + c; }
        }
      }
    }
    if (sqrDistance < 0.0) sqrDistance = 0.0;
    if (closest) {
      closest[0] = v1[0] + s * edge1[0] + t * edge2[0];
      closest[1] = v1[1] + s * edge1[1] + t * edge2[1];
      closest[2] = v1[2] + s * edge1[2] + t * edge2[2];
      closest[3] = zone;
    }
    return sqrDistance;
  };
})();

class VoxelState {

  constructor(res = 128, size = 200.0) {
    // console.log(`VoxelState: Constructor Start (Res=${res}, Size=${size})`);
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
    this._distanceField = new Float32Array(this._count).fill(1.17); // Initialize as empty space

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
    this._voxels.colorField.fill(1.0); // Pure White default
    this._voxels.materialField.fill(0.0); // Pure Matte default

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
    const t0 = performance.now();
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

    const t1 = performance.now();
    if (t1 - t0 > 5) {
      console.log("[Performance] addSphere took:", t1 - t0, "ms, changed:", changed);
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
            
            // SKIP UNINITIALIZED CELLS (far exterior Infinity or deep interior -Infinity)
            if (df[index] === Infinity || df[index] === -Infinity || isNaN(df[index])) {
              continue;
            }

            // Average valid neighbors (skip Infinity/NaN from uninitialized far-exterior zone)
            var sum = 0;
            var neighborsCount = 0;
            
            const checkAndAdd = (idx) => {
              const v = df[idx];
              if (v !== Infinity && v !== -Infinity && !isNaN(v)) {
                sum += v;
                neighborsCount++;
              }
            };

            checkAndAdd(index - 1);
            checkAndAdd(index + 1);
            checkAndAdd(index - rx);
            checkAndAdd(index + rx);
            checkAndAdd(index - rxy);
            checkAndAdd(index + rxy);
            
            if (neighborsCount > 0) {
              var avg = sum / neighborsCount;
              
              var falloff = 1.0 - (dist / radius); // Linear falloff
              // Falloff smoothing (Smoothstep) for nicer blending at edges
              falloff = falloff * falloff * (3 - 2 * falloff);
              
              // Lerp towards average based on strength & falloff
              var mix = strength * falloff;
              
              // CLAMP displacement to prevent "topology skipping" (tearing holes)
              const delta = (avg - df[index]) * mix;
              const maxDelta = step * 0.5; // Max shift is 50% of a grid cell per frame
              const clampedDelta = Math.max(-maxDelta, Math.min(maxDelta, delta));
              
              let result = df[index] + clampedDelta;

              // NARROW-BAND SYSTEM (Clamp output distances to prevent runaway large numbers)
              const maxDistanceLimit = step * 5.0; // Standard 5-voxel band
              result = Math.max(-maxDistanceLimit, Math.min(maxDistanceLimit, result));

              if (isNaN(result) || result === Infinity || result === -Infinity) {
                console.error(`[Smooth Error] NaN/Inf! Result=${result} df[index]=${df[index]} avg=${avg} mix=${mix.toFixed(2)} count=${neighborsCount}`);
              } else if (Math.abs(result) > 1000) {
                console.warn(`[Smooth Large] Large Result=${result.toFixed(2)} df[index]=${df[index].toFixed(2)} avg=${avg.toFixed(2)}`);
              }

              tempField[i + j*sizeX + k*sizeX*sizeY] = result;
              changed = true;
            }
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

  warpSphere(center, radius, translation, rotation, steps, stepRotation) {
    if (!this._distanceField) return false;

    var step = this._step;
    var invStep = 1.0 / step;
    var rx = this._resolution;
    var ry = this._resolution; // cubic
    var rxy = rx * ry;

    var hasQuat = rotation && (rotation[0]!==0 || rotation[1]!==0 || rotation[2]!==0 || rotation[3]!==1);
    var vTemp = [0,0,0];

    // Union Bound box:
    // Need to cover the original sphere AND the displaced sphere.
    // Plus maximum rotational/translation bound.
    var mnx = Math.min(center[0], center[0] + translation[0]) - radius - step * 2;
    var mny = Math.min(center[1], center[1] + translation[1]) - radius - step * 2;
    var mnz = Math.min(center[2], center[2] + translation[2]) - radius - step * 2;

    var mxx = Math.max(center[0], center[0] + translation[0]) + radius + step * 2;
    var mxy = Math.max(center[1], center[1] + translation[1]) + radius + step * 2;
    var mxz = Math.max(center[2], center[2] + translation[2]) + radius + step * 2;

    var snapMinx = Math.max(0, Math.floor((mnx - this._min[0]) * invStep));
    var snapMiny = Math.max(0, Math.floor((mny - this._min[1]) * invStep));
    var snapMinz = Math.max(0, Math.floor((mnz - this._min[2]) * invStep));

    var snapMaxx = Math.min(rx - 1, Math.ceil((mxx - this._min[0]) * invStep));
    var snapMaxy = Math.min(ry - 1, Math.ceil((mxy - this._min[1]) * invStep));
    var snapMaxz = Math.min(this._resolution - 1, Math.ceil((mxz - this._min[2]) * invStep));

    var sizeX = snapMaxx - snapMinx + 1;
    var sizeY = snapMaxy - snapMiny + 1;
    var sizeZ = snapMaxz - snapMinz + 1;
    if (sizeX <= 0 || sizeY <= 0 || sizeZ <= 0) return false;
    
    var tempBuffer = new Float32Array(sizeX * sizeY * sizeZ);
    var tempM = new Float32Array(sizeX * sizeY * sizeZ * 3);
    var tempC = new Float32Array(sizeX * sizeY * sizeZ * 3);
    
    var idTemp = 0;
    for (var k = snapMinz; k <= snapMaxz; ++k) {
      for (var j = snapMiny; j <= snapMaxy; ++j) {
        for (var i = snapMinx; i <= snapMaxx; ++i) {
          var n = i + j * rx + k * rxy;
          tempBuffer[idTemp] = this._distanceField[n];
          tempM[idTemp * 3]     = this._voxels.materialField[n * 3];
          tempM[idTemp * 3 + 1] = this._voxels.materialField[n * 3 + 1];
          tempM[idTemp * 3 + 2] = this._voxels.materialField[n * 3 + 2];
          tempC[idTemp * 3]     = this._voxels.colorField[n * 3];
          tempC[idTemp * 3 + 1] = this._voxels.colorField[n * 3 + 1];
          tempC[idTemp * 3 + 2] = this._voxels.colorField[n * 3 + 2];
          idTemp++;
        }
      }
    }

    var cx = center[0];
    var cy = center[1];
    var cz = center[2];

    var tx = translation[0];
    var ty = translation[1];
    var tz = translation[2];
    
    // We expect 'steps' to be passed in from SculptVoxel, defaults to 1 for safety
    var stepsCount = steps || 1;
    var step_tx = tx / stepsCount;
    var step_ty = ty / stepsCount;
    var step_tz = tz / stepsCount;

    // Inverse the passed fractional rotation
    var hasQuat = rotation && (rotation[0]!==0 || rotation[1]!==0 || rotation[2]!==0 || rotation[3]!==1);
    var rx2 = 0, ry2 = 0, rz2 = 0, rw2 = 1;
    if (hasQuat && stepRotation) {
      rx2 = -stepRotation[0];
      ry2 = -stepRotation[1];
      rz2 = -stepRotation[2];
      rw2 = stepRotation[3];
    }

    // Advection Loop (Reverse ODE map each voxel P back to P_source)
    idTemp = 0;
    var changed = false;
    for (var k = snapMinz; k <= snapMaxz; ++k) {
      var z = this._min[2] + k * step;
      for (var j = snapMiny; j <= snapMaxy; ++j) {
        var y = this._min[1] + j * step;
        for (var i = snapMinx; i <= snapMaxx; ++i) {
          var x = this._min[0] + i * step;
          
          var px = x, py = y, pz = z;
          
          // Tracing backwards from the final brush center
          // The brush arrived at cx + tx. We trace back to cx.
          var cx_step = cx + tx;
          var cy_step = cy + ty;
          var cz_step = cz + tz;

          for (var s = 0; s < stepsCount; s++) {
            
            var px_guess = px;
            var py_guess = py;
            var pz_guess = pz;
            
            var prev_cx = cx_step - step_tx;
            var prev_cy = cy_step - step_ty;
            var prev_cz = cz_step - step_tz;
            
            for (var iter = 0; iter < 5; iter++) {
              var dx = px_guess - prev_cx;
              var dy = py_guess - prev_cy;
              var dz = pz_guess - prev_cz;
              var dist = Math.sqrt(dx*dx + dy*dy + dz*dz) / radius;
              
              if (dist >= 1.0) {
                 px_guess = px;
                 py_guess = py;
                 pz_guess = pz;
              } else {
                var fallOff = dist * dist;
                fallOff = 3.0 * fallOff * fallOff - 4.0 * fallOff * dist + 1.0;
                
                var offX = 0, offY = 0, offZ = 0;
                
                if (hasQuat && stepRotation) {
                  vTemp[0] = dx; vTemp[1] = dy; vTemp[2] = dz;
                  var ix = rw2 * vTemp[0] + ry2 * vTemp[2] - rz2 * vTemp[1];
                  var iy = rw2 * vTemp[1] + rz2 * vTemp[0] - rx2 * vTemp[2];
                  var iz = rw2 * vTemp[2] + rx2 * vTemp[1] - ry2 * vTemp[0];
                  var iw = -rx2 * vTemp[0] - ry2 * vTemp[1] - rz2 * vTemp[2];
                  vTemp[0] = ix * rw2 + iw * -rx2 + iy * -rz2 - iz * -ry2;
                  vTemp[1] = iy * rw2 + iw * -ry2 + iz * -rx2 - ix * -rz2;
                  vTemp[2] = iz * rw2 + iw * -rz2 + ix * -ry2 - iy * -rx2;
                  
                  offX += (dx - vTemp[0]) * fallOff;
                  offY += (dy - vTemp[1]) * fallOff;
                  offZ += (dz - vTemp[2]) * fallOff;
                }
                
                offX += step_tx * fallOff;
                offY += step_ty * fallOff;
                offZ += step_tz * fallOff;
                
                px_guess = px - offX;
                py_guess = py - offY;
                pz_guess = pz - offZ;
              }
            } // end iter
            
            px = px_guess;
            py = py_guess;
            pz = pz_guess;
            
            cx_step -= step_tx;
            cy_step -= step_ty;
            cz_step -= step_tz;
          } // end steps
          
          if (Math.abs(px - x) > 1e-4 || Math.abs(py - y) > 1e-4 || Math.abs(pz - z) > 1e-4) {
            // Convert world source back to grid space!
            var gridX = (px - this._min[0]) * invStep;
            var gridY = (py - this._min[1]) * invStep;
            var gridZ = (pz - this._min[2]) * invStep;
            
            tempBuffer[idTemp] = this.sample(gridX, gridY, gridZ);
            changed = true;
            
            // Nearest Neighbor for Material/Color
            var nnx = Math.round(gridX);
            var nny = Math.round(gridY);
            var nnz = Math.round(gridZ);
            if (nnx >= 0 && nny >= 0 && nnz >= 0 && nnx < rx && nny < ry && nnz < rx) {
              var nn_idx = nnx + nny * rx + nnz * rxy;
              tempM[idTemp * 3]     = this._voxels.materialField[nn_idx * 3];
              tempM[idTemp * 3 + 1] = this._voxels.materialField[nn_idx * 3 + 1];
              tempM[idTemp * 3 + 2] = this._voxels.materialField[nn_idx * 3 + 2];
              tempC[idTemp * 3]     = this._voxels.colorField[nn_idx * 3];
              tempC[idTemp * 3 + 1] = this._voxels.colorField[nn_idx * 3 + 1];
              tempC[idTemp * 3 + 2] = this._voxels.colorField[nn_idx * 3 + 2];
            }
          }
          
          idTemp++;
        }
      }
    }

    if (!changed) return false;

    // Write back
    idTemp = 0;
    for (var k = snapMinz; k <= snapMaxz; ++k) {
      for (var j = snapMiny; j <= snapMaxy; ++j) {
        for (var i = snapMinx; i <= snapMaxx; ++i) {
          var n = i + j * rx + k * rxy;
          this._distanceField[n] = tempBuffer[idTemp];
          this._voxels.materialField[n * 3]     = tempM[idTemp * 3];
          this._voxels.materialField[n * 3 + 1] = tempM[idTemp * 3 + 1];
          this._voxels.materialField[n * 3 + 2] = tempM[idTemp * 3 + 2];
          this._voxels.colorField[n * 3]     = tempC[idTemp * 3];
          this._voxels.colorField[n * 3 + 1] = tempC[idTemp * 3 + 1];
          this._voxels.colorField[n * 3 + 2] = tempC[idTemp * 3 + 2];
          idTemp++;
        }
      }
    }

    this._activeMin[0] = Math.min(this._activeMin[0], snapMinx);
    this._activeMin[1] = Math.min(this._activeMin[1], snapMiny);
    this._activeMin[2] = Math.min(this._activeMin[2], snapMinz);

    this._activeMax[0] = Math.max(this._activeMax[0], snapMaxx);
    this._activeMax[1] = Math.max(this._activeMax[1], snapMaxy);
    this._activeMax[2] = Math.max(this._activeMax[2], snapMaxz);

    return true;
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
      // Inverted bounds! Scan the entire volume to find content.
      minX = 0; minY = 0; minZ = 0;
      maxX = this._resolution - 1; maxY = this._resolution - 1; maxZ = this._resolution - 1;
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

  computeMesh(chunkBounds) {
    if (!chunkBounds) {
      this.tightenBounds();
      // Check if empty
      if (this._activeMin[0] > this._activeMax[0]) {
        return { vertices: new Float32Array(0), faces: new Uint32Array(0), colors: new Float32Array(0), materials: new Float32Array(0) };
      }
    }

    // Clamp Bounds (Ensure padding of 1 for correct gradients/iso-surface)
    // SurfaceNets needs to look at n-1 or n+1?
    // It creates faces for "current" voxel by looking back?
    // We should pad by 1 or 2.
    // Loop limits: 0 .. dims-1.
    // We should clamp the Active Bounds to [0, dims].

    // Pass bounds to SurfaceNets
    const bounds = chunkBounds || {
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
    let res = null;

    // TEMPORARILY DISABLE WASM TO TEST JS FALLBACK & DIAGNOSTICS
    if (false && globalThis.wasmModule) {
      try {
        const wasm = globalThis.wasmModule;
        const totalElems = this._dims[0] * this._dims[1] * this._dims[2];

        // 1. Persistent WASM Memory
        if (!this._wasmBuf || this._wasmBuf.totalElems !== totalElems) {
            if (this._wasmBuf) {
                wasm.dealloc(this._wasmBuf.dimsPtr, 3 * 4);
                wasm.dealloc(this._wasmBuf.boundsPtr, 6 * 4);
                wasm.dealloc(this._wasmBuf.distPtr, this._wasmBuf.totalElems * 4);
                wasm.dealloc(this._wasmBuf.colPtr, this._wasmBuf.totalElems * 3 * 4);
                wasm.dealloc(this._wasmBuf.matPtr, this._wasmBuf.totalElems * 3 * 4);
            }
            this._wasmBuf = {
                dimsPtr: wasm.alloc(3 * 4),
                boundsPtr: wasm.alloc(6 * 4),
                distPtr: wasm.alloc(totalElems * 4),
                colPtr: wasm.alloc(totalElems * 3 * 4),
                matPtr: wasm.alloc(totalElems * 3 * 4),
                totalElems: totalElems
            };
        }
        const wb = this._wasmBuf;

        // 2. Copy JS Buffers over to WASM Memory (Heavy .set(), but avoids detach risks)
        new Uint32Array(wasm.memory.buffer, wb.dimsPtr, 3).set(this._dims);
        new Uint32Array(wasm.memory.buffer, wb.boundsPtr, 6).set([...bounds.min, ...bounds.max]);
        new Float32Array(wasm.memory.buffer, wb.distPtr, totalElems).set(this._voxels.distanceField);
        new Float32Array(wasm.memory.buffer, wb.colPtr, totalElems * 3).set(this._voxels.colorField);
        new Float32Array(wasm.memory.buffer, wb.matPtr, totalElems * 3).set(this._voxels.materialField);

        // 3. Compute
        const meshPtr = wasm.compute_surface_wasm(wb.dimsPtr, wb.boundsPtr, wb.distPtr, wb.colPtr, wb.matPtr);

        if (meshPtr === 0) throw new Error("WASM returned null pointer");

        // 4. Extract
        const meta = new Uint32Array(wasm.memory.buffer, meshPtr, 10);
        const vPtr = meta[0], vLen = meta[1];
        const fPtr = meta[2], fLen = meta[3];
        const cPtr = meta[4], cLen = meta[5];
        const mPtr = meta[6], mLen = meta[7];

        const vertices = new Float32Array(wasm.memory.buffer, vPtr, vLen).slice();
        const faces = new Uint32Array(wasm.memory.buffer, fPtr, fLen).slice();
        const colors = new Float32Array(wasm.memory.buffer, cPtr, cLen).slice();
        const materials = new Float32Array(wasm.memory.buffer, mPtr, mLen).slice();

        // 5. Cleanup dynamic struct (leave input buffers alive)
        wasm.free_mesh_result(meshPtr);

        res = { vertices, faces, colors, materials, isWASM: true };

      } catch (err) {
        console.error("VoxelState: WASM Execution Failed, falling back to JS. Error:", err);
        // Expose error to worker console
        if (globalThis.postMessage) {
            globalThis.postMessage({ type: 'LOG', data: `WASM ERROR: ${err.message}` });
        }
      }
    }

    // Fallback if WASM failed or isn't loaded
    if (!res) {
      res = SurfaceNets.computeSurface(this._voxels, bounds, false); 
      res.isWASM = false;
    }

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
    this._voxels.colorField.fill(1.0); // Reset to Pure White default
    this._voxels.materialField = new Float32Array(this._count * 3);
    this._voxels.materialField.fill(0.0); // Reset to Pure Matte default


    // Reset Active Bounds to full
    this._activeMin = new Int32Array([0, 0, 0]);
    this._activeMax = new Int32Array([newRes, newRes, newRes]);
  }

  _floodFill(voxels) {
    var step = voxels.step;
    var rx = voxels.dims[0];
    var ry = voxels.dims[1];
    var rxy = rx * ry;

    var crossedEdges = voxels.crossedEdges;
    var distField = voxels.distanceField;
    var datalen = distField.length;
    var tagCell = new Uint8Array(datalen); // 0 interior, 1 exterior
    var stack = new Int32Array(datalen);

    stack[0] = 0;
    var curStack = 1;

    var dirs = [-1, 1, -rx, rx, -rxy, rxy];
    var dirsEdge = [0, 0, 1, 1, 2, 2];
    var nbDir = dirs.length;
    var i = 0;
    var idNext = 0;

    while (curStack > 0) {
      var cell = stack[--curStack];
      var cellDist = distField[cell];
      if (cellDist < step) {
        // border hit
        for (i = 0; i < nbDir; ++i) {
          var off = dirs[i];
          idNext = cell + off;
          if (idNext >= datalen || idNext < 0) continue; // range check
          if (tagCell[idNext] === 1) continue; // check if already tagged as exterior
          if (distField[idNext] === Infinity) continue; // check if we are in the far exterior zone
          if (crossedEdges[(off >= 0 ? cell : idNext) * 3 + dirsEdge[i]] === 0) {
            tagCell[idNext] = 1;
            stack[curStack++] = idNext;
          }
        }
      } else {
        // exterior
        for (i = 0; i < nbDir; ++i) {
          idNext = cell + dirs[i];
          if (idNext >= datalen || idNext < 0) continue; // range check
          if (tagCell[idNext] === 1) continue; // check if already tagged as exterior
          tagCell[idNext] = 1;
          stack[curStack++] = idNext;
        }
      }
    }

    for (var id = 0; id < datalen; ++id) {
      if (tagCell[id] === 0)
        distField[id] = -distField[id];
    }
  }

  addMeshSDF(vAr, cAr, mAr, fArSrc) {
    if (!vAr || vAr.length === 0) return false;

    if (globalThis.postMessage) {
      globalThis.postMessage({ type: 'LOG', data: `[VoxelWorker] addMeshSDF: cAr is ${cAr ? 'not null' : 'null'} len=${cAr ? cAr.length : 0}` });
    }

    // 1. Calculate Bounds of the incoming mesh
    var box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    var nbVertices = vAr.length / 3;
    for (var j = 0; j < nbVertices; ++j) {
      var id = j * 3;
      var x = vAr[id];
      var y = vAr[id + 1];
      var z = vAr[id + 2];
      if (x < box[0]) box[0] = x;
      if (y < box[1]) box[1] = y;
      if (z < box[2]) box[2] = z;
      if (x > box[3]) box[3] = x;
      if (y > box[4]) box[4] = y;
      if (z > box[5]) box[5] = z;
    }

    var iAr = fArSrc; 
    var nbTriangles = iAr ? iAr.length / 3 : 0;

    if (nbTriangles === 0) {
      console.warn(`[addMeshSDF] NO TRIANGLES PROVIDED! Aborting.`);
      return false;
    }

    var step = this._step;
    var stepBorder = step * 1.51; // Add padding to bounding box
    var min = [box[0] - stepBorder, box[1] - stepBorder, box[2] - stepBorder];
    var max = [box[3] + stepBorder, box[4] + stepBorder, box[5] + stepBorder];

    var rx = Math.ceil((max[0] - min[0]) / step);
    var ry = Math.ceil((max[1] - min[1]) / step);
    var rz = Math.ceil((max[2] - min[2]) / step);

    var datalen = rx * ry * rz;
    var distField = new Float32Array(datalen);
    var crossedEdges = new Uint8Array(datalen * 3);
    var colors = new Float32Array(datalen * 3);
    var materials = new Float32Array(datalen * 3);

    for (var idf = 0; idf < datalen; ++idf)
      distField[idf] = Infinity;
    
    for (var idc = 0, datalenc = datalen * 3; idc < datalenc; ++idc) {
      colors[idc] = 0.8;
      materials[idc] = 0.2;
    }

    var v1 = [0.0, 0.0, 0.0];
    var v2 = [0.0, 0.0, 0.0];
    var v3 = [0.0, 0.0, 0.0];
    var triEdge1 = [0.0, 0.0, 0.0];
    var triEdge2 = [0.0, 0.0, 0.0];
    var point = [0.0, 0.0, 0.0];
    var closest = [0.0, 0.0, 0.0, 0];
    var dirUnit = [
      [1.0, 0.0, 0.0],
      [0.0, 1.0, 0.0],
      [0.0, 0.0, 1.0]
    ];

    var inv3 = 1 / 3;
    var vminx = min[0]; var vminy = min[1]; var vminz = min[2];
    var invStep = 1.0 / step;
    var rxy = rx * ry;

    for (var iTri = 0; iTri < nbTriangles; ++iTri) {
      var idTri = iTri * 3;
      var iv1 = iAr[idTri] * 3;
      var iv2 = iAr[idTri + 1] * 3;
      var iv3 = iAr[idTri + 2] * 3;

      var v1x = v1[0] = vAr[iv1];
      var v1y = v1[1] = vAr[iv1 + 1];
      var v1z = v1[2] = vAr[iv1 + 2];
      var v2x = v2[0] = vAr[iv2];
      var v2y = v2[1] = vAr[iv2 + 1];
      var v2z = v2[2] = vAr[iv2 + 2];
      var v3x = v3[0] = vAr[iv3];
      var v3y = v3[1] = vAr[iv3 + 1];
      var v3z = v3[2] = vAr[iv3 + 2];

      var c1x, c1y, c1z, m1x, m1y, m1z;
      if (cAr) {
        c1x = (cAr[iv1] + cAr[iv2] + cAr[iv3]) * inv3;
        c1y = (cAr[iv1 + 1] + cAr[iv2 + 1] + cAr[iv3 + 1]) * inv3;
        c1z = (cAr[iv1 + 2] + cAr[iv2 + 2] + cAr[iv3 + 2]) * inv3;
      }
      if (mAr) {
        m1x = (mAr[iv1] + mAr[iv2] + mAr[iv3]) * inv3;
        m1y = (mAr[iv1 + 1] + mAr[iv2 + 1] + mAr[iv3 + 1]) * inv3;
        m1z = (mAr[iv1 + 2] + mAr[iv2 + 2] + mAr[iv3 + 2]) * inv3;
      }

      var xmin = v1x < v2x ? v1x < v3x ? v1x : v3x : v2x < v3x ? v2x : v3x;
      var xmax = v1x > v2x ? v1x > v3x ? v1x : v3x : v2x > v3x ? v2x : v3x;
      var ymin = v1y < v2y ? v1y < v3y ? v1y : v3y : v2y < v3y ? v2y : v3y;
      var ymax = v1y > v2y ? v1y > v3y ? v1y : v3y : v2y > v3y ? v2y : v3y;
      var zmin = v1z < v2z ? v1z < v3z ? v1z : v3z : v2z < v3z ? v2z : v3z;
      var zmax = v1z > v2z ? v1z > v3z ? v1z : v3z : v2z > v3z ? v2z : v3z;

      var e1x = triEdge1[0] = v2x - v1x;
      var e1y = triEdge1[1] = v2y - v1y;
      var e1z = triEdge1[2] = v2z - v1z;
      var e2x = triEdge2[0] = v3x - v1x;
      var e2y = triEdge2[1] = v3y - v1y;
      var e2z = triEdge2[2] = v3z - v1z;
      var a00 = e1x * e1x + e1y * e1y + e1z * e1z;
      var a01 = e1x * e2x + e1y * e2y + e1z * e2z;
      var a11 = e2x * e2x + e2y * e2y + e2z * e2z;

      var snapMinx = Math.floor((xmin - vminx) * invStep);
      var snapMiny = Math.floor((ymin - vminy) * invStep);
      var snapMinz = Math.floor((zmin - vminz) * invStep);
      var snapMaxx = Math.ceil((xmax - vminx) * invStep);
      var snapMaxy = Math.ceil((ymax - vminy) * invStep);
      var snapMaxz = Math.ceil((zmax - vminz) * invStep);

      for (var k = snapMinz; k <= snapMaxz; ++k) {
        for (var j = snapMiny; j <= snapMaxy; ++j) {
          for (var i = snapMinx; i <= snapMaxx; ++i) {
            var x = vminx + i * step;
            var y = vminy + j * step;
            var z = vminz + k * step;
            var n = i + j * rx + k * rxy;

            point[0] = x; point[1] = y; point[2] = z;
            var newDist = distance2PointTriangleEdges(point, triEdge1, triEdge2, v1, a00, a01, a11, closest);
            newDist = Math.sqrt(newDist);
            if (newDist < distField[n]) {
              distField[n] = newDist;
              var n3 = n * 3;
              if (cAr) { colors[n3] = c1x; colors[n3 + 1] = c1y; colors[n3 + 2] = c1z; }
              if (mAr) { materials[n3] = m1x; materials[n3 + 1] = m1y; materials[n3 + 2] = m1z; }
            }

            if (newDist > step) continue;

            for (var it = 0; it < 3; ++it) {
              var val = closest[it] - point[it];
              if (val < 0.0 || val > step) continue;
              var idEdge = n * 3 + it;
              if (crossedEdges[idEdge] === 1) continue;
              var dist = intersectionRayTriangleEdges(point, dirUnit[it], triEdge1, triEdge2, v1);
              if (dist < 0.0 || dist > step) continue;
              crossedEdges[idEdge] = 1;
            }
          }
        }
      }
    }

    // 2. Flood Fill
    var localVoxels = {
      dims: [rx, ry, rz],
      step: step,
      distanceField: distField,
      crossedEdges: crossedEdges
    };
    this._floodFill(localVoxels);

    // 3. Write generated SDF to Absolute Workspace
    var minX = localVoxels.min = min;
    var changed = false;
    
    // Global bounds expansion trackers
    var gMin_x = this._resolution, gMin_y = this._resolution, gMin_z = this._resolution;
    var gMax_x = 0, gMax_y = 0, gMax_z = 0;

    for (var k = 0; k < rz; ++k) {
      for (var j = 0; j < ry; ++j) {
        for (var i = 0; i < rx; ++i) {
          var n = i + j * rx + k * rxy;
          var localDist = distField[n];

          // Compute global grid coordinate
          var wX = minX[0] + i * step;
          var wY = minX[1] + j * step;
          var wZ = minX[2] + k * step;
          
          var gI = Math.round((wX - this._min[0]) / step);
          var gJ = Math.round((wY - this._min[1]) / step);
          var gK = Math.round((wZ - this._min[2]) / step);

          if (gI >= 0 && gI < this._resolution && 
              gJ >= 0 && gJ < this._resolution && 
              gK >= 0 && gK < this._resolution) {
            
            var globalId = gI + gJ * this._resolution + gK * (this._resolution * this._resolution);
            
            if (localDist < this._distanceField[globalId]) {
              this._distanceField[globalId] = localDist;
              changed = true;
              
              if (gI < gMin_x) gMin_x = gI;
              if (gJ < gMin_y) gMin_y = gJ;
              if (gK < gMin_z) gMin_z = gK;
              if (gI > gMax_x) gMax_x = gI;
              if (gJ > gMax_y) gMax_y = gJ;
              if (gK > gMax_z) gMax_z = gK;

              if (cAr) {
                this._voxels.colorField[globalId * 3] = colors[n * 3];
                this._voxels.colorField[globalId * 3 + 1] = colors[n * 3 + 1];
                this._voxels.colorField[globalId * 3 + 2] = colors[n * 3 + 2];
              }
            }
          }
        }
      }
    }

    if (changed) {
      this._activeMin[0] = Math.min(this._activeMin[0], gMin_x);
      this._activeMin[1] = Math.min(this._activeMin[1], gMin_y);
      this._activeMin[2] = Math.min(this._activeMin[2], gMin_z);
      this._activeMax[0] = Math.max(this._activeMax[0], gMax_x);
      this._activeMax[1] = Math.max(this._activeMax[1], gMax_y);
      this._activeMax[2] = Math.max(this._activeMax[2], gMax_z);
    }

    return changed;
  }
}

export default VoxelState;
