
function quadCalcError(v1, v2, v3, v4) {
  let error = 0.0;

  // 1. Normal difference
  const normalTri = (p1, p2, p3) => {
    const ax = p2[0] - p1[0], ay = p2[1] - p1[1], az = p2[2] - p1[2];
    const bx = p3[0] - p1[0], by = p3[1] - p1[1], bz = p3[2] - p1[2];
    const nx = ay * bz - az * by;
    const ny = az * bx - ax * bz;
    const nz = ax * by - ay * bx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len > 0) return [nx / len, ny / len, nz / len];
    return [0, 0, 1];
  };

  const angleNorm = (n1, n2) => {
    let dot = n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2];
    if (dot > 1.0) dot = 1.0;
    if (dot < -1.0) dot = -1.0;
    return Math.acos(dot);
  };

  const n1A = normalTri(v1, v2, v3);
  const n2A = normalTri(v1, v3, v4);
  const angleA = angleNorm(n1A, n2A);

  const n1B = normalTri(v2, v3, v4);
  const n2B = normalTri(v4, v1, v2);
  const angleB = angleNorm(n1B, n2B);

  error += (angleA + angleB) / (Math.PI * 2);

  // 2. Co-linearity (Angle distortion)
  const edgeVecs = [
    [v2[0] - v1[0], v2[1] - v1[1], v2[2] - v1[2]],
    [v3[0] - v2[0], v3[1] - v2[1], v3[2] - v2[2]],
    [v4[0] - v3[0], v4[1] - v3[1], v4[2] - v3[2]],
    [v1[0] - v4[0], v1[1] - v4[1], v1[2] - v4[2]]
  ];

  for (let i = 0; i < 4; i++) {
    const len = Math.sqrt(edgeVecs[i][0] * edgeVecs[i][0] + edgeVecs[i][1] * edgeVecs[i][1] + edgeVecs[i][2] * edgeVecs[i][2]);
    if (len > 0) { edgeVecs[i][0] /= len; edgeVecs[i][1] /= len; edgeVecs[i][2] /= len; }
  }

  const pi_2 = Math.PI / 2;
  const dev1 = Math.abs(angleNorm(edgeVecs[0], edgeVecs[1]) - pi_2);
  const dev2 = Math.abs(angleNorm(edgeVecs[1], edgeVecs[2]) - pi_2);
  const dev3 = Math.abs(angleNorm(edgeVecs[2], edgeVecs[3]) - pi_2);
  const dev4 = Math.abs(angleNorm(edgeVecs[3], edgeVecs[0]) - pi_2);

  error += (dev1 + dev2 + dev3 + dev4) / (Math.PI * 2);

  // 3. Concavity (Area difference)
  const areaTri = (p1, p2, p3) => {
    const ax = p2[0] - p1[0], ay = p2[1] - p1[1], az = p2[2] - p1[2];
    const bx = p3[0] - p1[0], by = p3[1] - p1[1], bz = p3[2] - p1[2];
    const nx = ay * bz - az * by;
    const ny = az * bx - ax * bz;
    const nz = ax * by - ay * bx;
    return 0.5 * Math.sqrt(nx * nx + ny * ny + nz * nz);
  };

  const areaTriA = areaTri(v1, v2, v3) + areaTri(v1, v3, v4);
  const areaTriB = areaTri(v2, v3, v4) + areaTri(v4, v1, v2);

  const minArea = Math.min(areaTriA, areaTriB);
  const maxArea = Math.max(areaTriA, areaTriB);

  error += maxArea > 0 ? (1.0 - minArea / maxArea) : 1.0;

  return error;
}

// Test case for flat 1x1 quad (two triangles sharing edge)
const v1 = [0, 0, 0];
const v2 = [1, 0, 0];
const v3 = [1, 1, 0];
const v4 = [0, 1, 0];

console.log("Testing flat plane quad...");
console.log("Error:", quadCalcError(v1, v2, v3, v4));
