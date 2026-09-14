import Utils from '../misc/Utils.js';
import MeshStatic from '../mesh/meshStatic/MeshStatic.js';
import Remesh from '../editing/Remesh.js';

var Primitives = {};

var createPlaneArray = function (
  lx = -0.5, ly = 0.0, lz = -0.5,
  wx = 1.0, wy = 0.0, wz = 0.0,
  hx = 0.0, hy = 0.0, hz = 1.0
) {

  var faces = new Float32Array(4);
  faces[0] = 0;
  faces[1] = 1;
  faces[2] = 2;
  faces[3] = 3;

  var v = new Float32Array(12);
  v[0] = lx;
  v[1] = ly;
  v[2] = lz;

  v[3] = lx + wx;
  v[4] = ly + wy;
  v[5] = lz + wz;

  v[6] = lx + wx + hx;
  v[7] = ly + wy + hy;
  v[8] = lz + wz + hz;

  v[9] = lx + hx;
  v[10] = ly + hy;
  v[11] = lz + hz;

  return {
    faces: faces,
    vertices: v
  };
};

var createCubeArray = function (side = 1.0) {
  var v = new Float32Array(24);
  v[1] = v[2] = v[4] = v[6] = v[7] = v[9] = v[10] = v[11] = v[14] = v[18] = v[21] = v[23] = -side * 0.5;
  v[0] = v[3] = v[5] = v[8] = v[12] = v[13] = v[15] = v[16] = v[17] = v[19] = v[20] = v[22] = side * 0.5;

  var uv = new Float32Array(28);
  uv[0] = uv[6] = uv[8] = uv[10] = uv[11] = uv[13] = uv[16] = uv[23] = uv[25] = 0.5;
  uv[1] = uv[3] = 1.0;
  uv[2] = uv[4] = uv[9] = uv[12] = uv[14] = uv[15] = uv[18] = 0.25;
  uv[5] = uv[7] = uv[21] = uv[24] = uv[26] = uv[27] = 0.75;
  uv[17] = uv[19] = uv[20] = uv[22] = 0.0;

  var f = new Uint32Array(24);
  var ft = new Uint32Array(24);
  f[0] = f[8] = f[21] = ft[0] = 0;
  f[1] = f[11] = f[12] = ft[1] = 1;
  f[2] = f[15] = f[16] = ft[2] = ft[15] = ft[16] = 2;
  f[3] = f[19] = f[22] = ft[3] = ft[19] = ft[22] = 3;
  f[4] = f[9] = f[20] = ft[4] = ft[9] = 4;
  f[7] = f[10] = f[13] = ft[5] = ft[18] = ft[23] = 5;
  f[6] = f[14] = f[17] = ft[6] = ft[14] = ft[17] = 6;
  f[5] = f[18] = f[23] = ft[7] = ft[10] = 7;
  ft[8] = 8;
  ft[11] = 9;
  ft[12] = 10;
  ft[13] = 11;
  ft[20] = 12;
  ft[21] = 13;

  return {
    vertices: v,
    uv: uv,
    faces: f,
    facesUV: ft
  };
};

var createCylinderArray = function (
  radiusTop = 0.5, radiusBottom = 0.5, height = 2.0,
  radSegments = 64, heightSegments = 64, topCap = true, lowCap = true
) {

  var isSingularTop = topCap && radiusTop === 0.0;
  var isSingularBottom = lowCap && radiusBottom === 0.0;
  var heightHalf = height * 0.5;

  var nbVertices = (heightSegments + 1) * radSegments;
  // Sides need 8 indices per quad (2 tris + separators), Caps need 4 per tri
  var sideFaces = heightSegments * radSegments;
  var capFaces = (topCap ? radSegments : 0) + (lowCap ? radSegments : 0);

  if (topCap) nbVertices += 1;
  if (lowCap) nbVertices += 1;

  if (isSingularTop || isSingularBottom) {
    nbVertices -= radSegments;
    // Singular caps don't add faces in this logic, handled by capFaces reduction? 
    // Wait, original logic reduced nbFaces.
    if (isSingularTop) capFaces -= radSegments;
    if (isSingularBottom) capFaces -= radSegments;
  }

  var vAr = new Float32Array(nbVertices * 3);
  var fAr = new Uint32Array(sideFaces * 8 + capFaces * 4);

  var id = 0;
  var k = 0;
  var i = 0;
  var j = 0;
  var startHeight = isSingularTop ? 1 : 0;
  var endHeight = isSingularBottom ? heightSegments - 1 : heightSegments;
  for (i = startHeight; i <= endHeight; i++) {
    var v = i / heightSegments;
    var radius = v * (radiusBottom - radiusTop) + radiusTop;
    for (j = 0; j < radSegments; j++) {
      var u = Math.PI * 2 * j / radSegments;
      k = 3 * id++;
      vAr[k] = radius * Math.sin(u);
      vAr[k + 1] = -v * height + heightHalf;
      vAr[k + 2] = radius * Math.cos(u);
    }
  }

  id = 0;
  for (j = 0; j < radSegments; j++) {
    var off = j === radSegments - 1 ? 0 : j + 1;
    for (i = startHeight; i < endHeight; i++) {
      k = 8 * id++; // 8 indices per side face
      var first = radSegments * i + j;
      var second = radSegments * (i + 1) + j;
      var third = radSegments * (i + 1) + off;
      var fourth = radSegments * i + off;

      // Tri 1
      fAr[k] = first;
      fAr[k + 1] = second;
      fAr[k + 2] = fourth;
      fAr[k + 3] = Utils.TRI_INDEX;

      // Tri 2
      fAr[k + 4] = second;
      fAr[k + 5] = third;
      fAr[k + 6] = fourth;
      fAr[k + 7] = Utils.TRI_INDEX;
    }
  }

  // Continue 'id' from previous loop (it equals sideFaces)
  // But our buffer position 'k' needs to account for the fact that previous faces took 8 indices each.
  // Current 'id' assumes 1 unit per face.
  // Side faces used 8 indices. Caps use 4.
  // We can track exact offset.
  var offset = sideFaces * 8;

  // Reset id? No, we can just use relative count.
  // Actually, easiest is just to maintain 'k'.
  // But the loop uses 'k = 4 * id++' pattern.
  // we can change it to 'k = offset + 4 * (id - sideFaces)'.

  var last;
  if (topCap) {
    last = (lowCap ? vAr.length - 6 : vAr.length - 3) / 3;
    vAr[last * 3 + 1] = heightHalf;
    for (j = 0; j < radSegments; j++) {
      k = offset + 4 * (id++ - sideFaces);
      fAr[k] = j;
      fAr[k + 1] = j === radSegments - 1 ? 0 : j + 1;
      fAr[k + 2] = last;
      fAr[k + 3] = Utils.TRI_INDEX;
    }
  }

  if (lowCap) {
    last = (vAr.length - 3) / 3;
    vAr[last * 3 + 1] = -heightHalf;
    if (isSingularTop) --i;
    var end = radSegments * i;
    for (j = 0; j < radSegments; j++) {
      k = offset + 4 * (id++ - sideFaces);
      fAr[k] = j === radSegments - 1 ? end : end + j + 1;
      fAr[k + 1] = end + j;
      fAr[k + 2] = last;
      fAr[k + 3] = Utils.TRI_INDEX;
    }
  }

  return {
    vertices: vAr,
    faces: fAr
  };
};

// An ALL-QUAD cylinder. `createCylinderArray` above fans each cap to a single pole vertex and
// splits every side quad into two tris, so it can never be reversed: Reversion.computeReverse
// only works on a mesh that IS the subdivision of a coarser one, and a triangle fan is not.
//
// Here the sides are a ring grid and each cap is a square lattice whose PERIMETER IS THE RING
// (no pole), so the whole thing is quads with only the four lattice corners extraordinary --
// exactly the cube's situation, which reverses fine. Subdivide it and Reverse walks it back
// down to a clean low-poly cylinder.
//
// radSegments is rounded to a multiple of 4, because a lattice with capSegments per side has
// 4*capSegments perimeter points and those points have to BE the ring's vertices.
var createCylinderQuadArray = function (radius = 0.5, height = 1.0, radSegments = 32, heightSegments = 2) {
  var m = Math.max(1, Math.round(radSegments / 4)); // cap lattice segments per side
  var N = m * 4;                                    // actual radial segments
  var H = Math.max(1, Math.round(heightSegments));
  var heightHalf = height * 0.5;

  var nbInner = (m - 1) * (m - 1);                  // cap lattice vertices NOT on the ring
  var topBase = (H + 1) * N;
  var botBase = topBase + nbInner;
  var nbVertices = botBase + nbInner;
  var nbFaces = H * N + 2 * m * m;

  var vAr = new Float32Array(nbVertices * 3);
  var fAr = new Uint32Array(nbFaces * 4);

  var i = 0;
  var j = 0;
  var a = 0;
  var b = 0;
  var k = 0;

  // Rings, top (i = 0) to bottom (i = H). Same parametrisation as the tri cylinder:
  // x = sin(u), z = cos(u), so increasing j runs +z -> +x -> -z, counter-clockwise seen
  // from above, which is what makes the cap winding below point outwards.
  for (i = 0; i <= H; ++i) {
    var y = heightHalf - i * height / H;
    for (j = 0; j < N; ++j) {
      var u = Math.PI * 2 * j / N;
      k = 3 * (i * N + j);
      vAr[k] = radius * Math.sin(u);
      vAr[k + 1] = y;
      vAr[k + 2] = radius * Math.cos(u);
    }
  }

  // Lattice point (a, b) -> index into the ring, or -1 when it is an interior point.
  // The four edges are walked in one loop, (0,0) -> (m,0) -> (m,m) -> (0,m), so the walk
  // circulates the same way the ring does.
  var perim = function (aa, bb) {
    if (bb === 0 && aa < m) return aa;
    if (aa === m && bb < m) return m + bb;
    if (bb === m && aa > 0) return 2 * m + (m - aa);
    if (aa === 0 && bb > 0) return 3 * m + (m - bb);
    return -1;
  };

  var capVert = function (isTop, aa, bb) {
    var p = perim(aa, bb);
    if (p >= 0) return (isTop ? 0 : H) * N + p;
    return (isTop ? topBase : botBase) + (bb - 1) * (m - 1) + (aa - 1);
  };

  // Interior lattice points by Coons interpolation of the four boundary edges. The boundary
  // is a circle, so this fills the disc smoothly for any m; for m = 2 it is just the centre.
  var px = function (isTop, aa, bb) { return vAr[capVert(isTop, aa, bb) * 3]; };
  var pz = function (isTop, aa, bb) { return vAr[capVert(isTop, aa, bb) * 3 + 2]; };
  for (var t = 0; t < 2; ++t) {
    var isTop = t === 0;
    var yCap = isTop ? heightHalf : -heightHalf;
    for (b = 1; b < m; ++b) {
      for (a = 1; a < m; ++a) {
        var s = a / m;
        var q = b / m;
        var x = (1 - q) * px(isTop, a, 0) + q * px(isTop, a, m) + (1 - s) * px(isTop, 0, b) + s * px(isTop, m, b) -
          ((1 - s) * (1 - q) * px(isTop, 0, 0) + s * (1 - q) * px(isTop, m, 0) + (1 - s) * q * px(isTop, 0, m) + s * q * px(isTop, m, m));
        var z = (1 - q) * pz(isTop, a, 0) + q * pz(isTop, a, m) + (1 - s) * pz(isTop, 0, b) + s * pz(isTop, m, b) -
          ((1 - s) * (1 - q) * pz(isTop, 0, 0) + s * (1 - q) * pz(isTop, m, 0) + (1 - s) * q * pz(isTop, 0, m) + s * q * pz(isTop, m, m));
        k = 3 * ((isTop ? topBase : botBase) + (b - 1) * (m - 1) + (a - 1));
        vAr[k] = x;
        vAr[k + 1] = yCap;
        vAr[k + 2] = z;
      }
    }
  }

  var id = 0;

  // Sides. Down the wall first, then around: (i, j) -> (i+1, j) -> (i+1, j+1) -> (i, j+1)
  // is the order that points outwards; the reverse of it faces into the tube.
  for (i = 0; i < H; ++i) {
    for (j = 0; j < N; ++j) {
      var jn = j === N - 1 ? 0 : j + 1;
      k = 4 * id++;
      fAr[k] = i * N + j;
      fAr[k + 1] = (i + 1) * N + j;
      fAr[k + 2] = (i + 1) * N + jn;
      fAr[k + 3] = i * N + jn;
    }
  }

  // Caps. The lattice order is already counter-clockwise seen from +y, so the top takes it
  // as-is and the bottom takes it reversed.
  for (b = 0; b < m; ++b) {
    for (a = 0; a < m; ++a) {
      k = 4 * id++;
      fAr[k] = capVert(true, a, b);
      fAr[k + 1] = capVert(true, a + 1, b);
      fAr[k + 2] = capVert(true, a + 1, b + 1);
      fAr[k + 3] = capVert(true, a, b + 1);

      k = 4 * id++;
      fAr[k] = capVert(false, a, b);
      fAr[k + 1] = capVert(false, a, b + 1);
      fAr[k + 2] = capVert(false, a + 1, b + 1);
      fAr[k + 3] = capVert(false, a + 1, b);
    }
  }

  return {
    vertices: vAr,
    faces: fAr
  };
};

var createSphereArray = function (radius = 0.5, latSegments = 32, longSegments = 32) {
  var vAr = new Float32Array((latSegments + 1) * (longSegments + 1) * 3);
  // EACH quad produces 2 triangles (8 indices including TRI_INDEX separators)
  var fAr = new Uint32Array(latSegments * longSegments * 8);

  var k = 0;
  var i = 0;
  var j = 0;
  for (i = 0; i <= latSegments; i++) {
    var theta = i * Math.PI / latSegments;
    var sinTheta = Math.sin(theta);
    var cosTheta = Math.cos(theta);

    for (j = 0; j <= longSegments; j++) {
      var phi = j * 2 * Math.PI / longSegments;
      var sinPhi = Math.sin(phi);
      var cosPhi = Math.cos(phi);

      var x = cosPhi * sinTheta;
      var y = cosTheta;
      var z = sinPhi * sinTheta;

      vAr[k++] = radius * x;
      vAr[k++] = radius * y;
      vAr[k++] = radius * z;
    }
  }

  k = 0;
  for (i = 0; i < latSegments; i++) {
    for (j = 0; j < longSegments; j++) {
      var first = (i * (longSegments + 1)) + j;
      var second = first + longSegments + 1;

      fAr[k++] = first;
      fAr[k++] = second;
      fAr[k++] = first + 1;
      fAr[k++] = Utils.TRI_INDEX;

      fAr[k++] = second;
      fAr[k++] = second + 1;
      fAr[k++] = first + 1;
      fAr[k++] = Utils.TRI_INDEX;
    }
  }

  return {
    vertices: vAr,
    faces: fAr
  };
};

var createTorusArray = function (radiusOut = 0.5, radiusWidth = 0.1, arc = Math.PI * 2, nbRadial = 32, nbTubular = 128) {
  var isFull = Math.PI * 2 - arc < 1e-2;

  var nbVertices = nbRadial * nbTubular;
  var nbFaces = nbVertices;
  if (!isFull) {
    nbVertices += 2;
    nbFaces += nbRadial;
  }
  var endTubular = isFull ? nbTubular : nbTubular - 1;

  var vAr = new Float32Array(nbVertices * 3);
  var fAr = new Uint32Array(nbFaces * 4);
  var id = 0;
  var k = 0;
  var i = 0;
  var j = 0;
  for (i = 0; i < nbTubular; ++i) {
    for (j = 0; j < nbRadial; ++j) {
      var u = i / endTubular * arc;
      var v = j / nbRadial * Math.PI * 2;
      k = 3 * id++;
      vAr[k] = (radiusOut + radiusWidth * Math.cos(v)) * Math.cos(u);
      vAr[k + 1] = radiusWidth * Math.sin(v);
      vAr[k + 2] = (radiusOut + radiusWidth * Math.cos(v)) * Math.sin(u);
    }
  }

  id = 0;
  for (i = 0; i < endTubular; ++i) {
    var offi = i === nbTubular - 1 ? 0 : i + 1;
    for (j = 0; j < nbRadial; ++j) {
      k = 4 * id++;
      fAr[k] = nbRadial * i + j;
      var offj = j === nbRadial - 1 ? 0 : j + 1;
      fAr[k + 1] = nbRadial * i + offj;
      fAr[k + 2] = nbRadial * offi + offj;
      fAr[k + 3] = nbRadial * offi + j;
    }
  }

  if (!isFull) {
    var last = (vAr.length - 6) / 3;
    vAr[last * 3] = radiusOut;
    for (j = 0; j < nbRadial; j++) {
      k = 4 * id++;
      fAr[k] = last;
      fAr[k + 1] = j === nbRadial - 1 ? 0 : j + 1;
      fAr[k + 2] = j;
      fAr[k + 3] = Utils.TRI_INDEX;
    }

    ++last;
    vAr[last * 3] = radiusOut * Math.cos(arc);
    vAr[last * 3 + 2] = radiusOut * Math.sin(arc);
    var end = nbRadial * i;
    for (j = 0; j < nbRadial; j++) {
      k = 4 * id++;
      fAr[k] = last;
      fAr[k + 1] = end + j;
      fAr[k + 2] = j === nbRadial - 1 ? end : end + j + 1;
      fAr[k + 3] = Utils.TRI_INDEX;
    }
  }

  return {
    vertices: vAr,
    faces: fAr
  };
};

var createGridArray = function (
  cx = -0.5, cy = 0.0, cz = -0.5,
  wx = 1.0, wy = 0.0, wz = 0.0,
  hx = 0.0, hy = 0.0, hz = 1.0,
  res1 = 20, res2 = res1
) {

  res1 += 2;
  res2 += 2;

  var vAr = new Float32Array((res1 + res2) * 2 * 3);
  var i = 0;
  var j = 0;
  var sx = wx / (res1 - 1);
  var sy = wy / (res1 - 1);
  var sz = wz / (res1 - 1);
  var ux = cx + wx + hx;
  var uy = cy + wy + hy;
  var uz = cz + wz + hz;
  for (i = 0; i < res1; ++i) {
    j = i * 6;
    vAr[j] = cx + sx * i;
    vAr[j + 1] = cy + sy * i;
    vAr[j + 2] = cz + sz * i;
    vAr[j + 3] = ux - sx * (res1 - i - 1);
    vAr[j + 4] = uy - sy * (res1 - i - 1);
    vAr[j + 5] = uz - sz * (res1 - i - 1);
  }

  sx = hx / (res2 - 1);
  sy = hy / (res2 - 1);
  sz = hz / (res2 - 1);
  for (i = 0; i < res2; ++i) {
    j = (res1 + i) * 6;
    vAr[j] = cx + sx * i;
    vAr[j + 1] = cy + sy * i;
    vAr[j + 2] = cz + sz * i;
    vAr[j + 3] = ux - sx * (res2 - i - 1);
    vAr[j + 4] = uy - sy * (res2 - i - 1);
    vAr[j + 5] = uz - sz * (res2 - i - 1);
  }

  return {
    vertices: vAr
  };
};

var createPlaneGridArray = function (nx = 3, ny = 3, width = 1.0, height = 1.0) {
  var nbVertices = (nx + 1) * (ny + 1);
  var nbFaces = nx * ny;
  
  var vAr = new Float32Array(nbVertices * 3);
  var uvAr = new Float32Array(nbVertices * 2);
  var fAr = new Uint32Array(nbFaces * 4);
  var ftAr = new Uint32Array(nbFaces * 4);
  
  var id = 0;
  for (var j = 0; j <= ny; j++) {
    for (var i = 0; i <= nx; i++) {
      var k = 3 * id;
      vAr[k] = (i / nx - 0.5) * width;
      vAr[k + 1] = 0.0;
      vAr[k + 2] = (j / ny - 0.5) * height;
      
      var ku = 2 * id;
      uvAr[ku] = i / nx;
      uvAr[ku + 1] = j / ny;
      
      id++;
    }
  }
  
  id = 0;
  for (var j = 0; j < ny; j++) {
    for (var i = 0; i < nx; i++) {
      var k = 4 * id;
      var v0 = j * (nx + 1) + i;
      var v1 = v0 + 1;
      var v2 = (j + 1) * (nx + 1) + i + 1;
      var v3 = (j + 1) * (nx + 1) + i;
      
      fAr[k] = v0;
      fAr[k + 1] = v1;
      fAr[k + 2] = v2;
      fAr[k + 3] = v3;
      
      ftAr[k] = v0;
      ftAr[k + 1] = v1;
      ftAr[k + 2] = v2;
      ftAr[k + 3] = v3;
      
      id++;
    }
  }
  
  return {
    vertices: vAr,
    uv: uvAr,
    faces: fAr,
    facesUV: ftAr
  };
};

var createMesh = function (gl, arr) {
  var mesh = new MeshStatic(gl);
  mesh.setVertices(arr.vertices);
  if (arr.faces) mesh.setFaces(arr.faces);
  if (arr.uv && arr.facesUV) mesh.initTexCoordsDataFromOBJData(arr.uv, arr.facesUV);

  mesh.init();
  if (gl) mesh.initRender();
  return mesh;
};

var slice = Array.prototype.slice;

Primitives.createGrid = function (gl) {
  var mesh = createMesh(gl, createGridArray.apply(this, slice.call(arguments, 1)));
  if (gl) {
    mesh.setMode(gl.LINES);
    mesh.setUseDrawArrays(true);
    mesh.setAlreadyDrawArrays();
  }
  return mesh;
};

Primitives.createCube = function (gl) {
  return createMesh(gl, createCubeArray.apply(this, slice.call(arguments, 1)));
};

Primitives.createCylinder = function (gl) {
  return createMesh(gl, createCylinderArray.apply(this, slice.call(arguments, 1)));
};

Primitives.createCylinderQuad = function (gl) {
  return createMesh(gl, createCylinderQuadArray.apply(this, slice.call(arguments, 1)));
};

Primitives.createSphere = function (gl) {
  return createMesh(gl, createSphereArray.apply(this, slice.call(arguments, 1)));
};

Primitives.createTorus = function (gl) {
  return createMesh(gl, createTorusArray.apply(this, slice.call(arguments, 1)));
};

Primitives.createPlane = function (gl) {
  return createMesh(gl, createPlaneArray.apply(this, slice.call(arguments, 1)));
};

Primitives.createPlaneGrid = function (gl, nx, ny) {
  return createMesh(gl, createPlaneGridArray(nx, ny));
};

Primitives.createArrow = function (gl, thick = 0.5, height = 2.0, rConeT = 5.0, rConeH = 0.2, radSegments = 4, heightSegments = 1) {
  var base = createMesh(null, createCylinderArray(thick, thick, height, radSegments, heightSegments));
  var cone = createMesh(null, createCylinderArray(0.0, thick * rConeT, height * rConeH, radSegments, heightSegments));
  cone.getMatrix()[13] = height * 0.5;

  var arrow = {
    vertices: null,
    faces: null
  };
  Remesh.mergeArrays([base, cone], arrow);
  return createMesh(gl, arrow);
};

Primitives.createLine2D = function (gl, lx = 0.0, ly = 0.0, ux = 0.0, uy = 0.0) {
  var mesh = createMesh(gl, {
    vertices: new Float32Array([lx, ly, 0.0, ux, uy, 0.0])
  });
  if (gl) {
    mesh.setMode(gl.LINES);
    mesh.setUseDrawArrays(true);
    mesh.setAlreadyDrawArrays();
  }
  return mesh;
};

export default Primitives;
