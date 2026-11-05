// WHICH LEVEL OF A MULTIRES STACK A HEAD'S BLENDSHAPES BELONG TO, in a .sxr.
//
// The shapes index one level (AnimationRegistry.applyBlendshapes), but up to v28 the file wrote the
// base and read it back at the DISPLAYED level's size. Saved subdivided, the base came back padded
// with zeros, looked as if it belonged to the displayed level, and the first recomposite put every
// vertex the subdivision added at the origin. Saving again wrote that collapse into the level.

// The vertex count to save the shapes at. `shown` when the stack has no level that fits them.
export function shapeVertexCount(track, levelCounts, shown) {
  const nb = track && track.baseShape ? track._bsNbVertices || track.baseShape.length / 3 : 0;
  return levelCounts.includes(nb) ? nb : shown;
}

// A v28 base's real vertex count: the smallest lower level that holds everything before its zero
// padding. A base that is not padded keeps its own count.
export function paddedShapeCount(base, levelCounts) {
  const nv = base.length / 3;
  let last = nv - 1;
  while (last >= 0 && base[last * 3] === 0 && base[last * 3 + 1] === 0 && base[last * 3 + 2] === 0) last--;
  if (last < 0) return nv;
  const fits = levelCounts.filter((c) => c > last && c < nv);
  return fits.length ? Math.min(...fits) : nv;
}

// Did a save after the bad reload write the collapse in? Most of what a level added sits at the
// origin (a thousandth of the head's size, as what collapsed can carry float noise). A real surface
// can pass near the origin, never most of it.
export function isCollapsedLevel(verts, from, to, base) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < base.length; i++) {
    const k = i % 3;
    if (base[i] < mn[k]) mn[k] = base[i];
    if (base[i] > mx[k]) mx[k] = base[i];
  }
  const r = 1e-3 * Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]);
  let near = 0;
  for (let i = from; i < to; i++) {
    if (Math.hypot(verts[i * 3], verts[i * 3 + 1], verts[i * 3 + 2]) < r) near++;
  }
  return to > from && near > (to - from) / 2;
}
