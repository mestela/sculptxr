// TOPO TRANSFER ONTO A POSED SCULPT. A character often reads best sculpted in an expression -- mouth
// open, brows down -- but GNM's Base is closed lips, neutral. Wrapped onto such a sculpt as it is,
// the open jaw becomes part of the face's SHAPE: the teeth sit wrong and every retargeted
// expression lands off.
//
// So GNM is posed to match first (Face tool or the pad), and:
//   HOLD POSE   bakes the shown pose into the Base and zeroes the weights (looks the same), so Wrap
//               and Snap fit a posed GNM to the posed sculpt, open mouth to open mouth.
//   UN-POSE     takes the wrapped Base back to the sculpt's own neutral (ShapeRetarget.unpose:
//               the template's posed -> neutral change, carried onto it) and puts the weights back.
//               Retarget Shapes then rebuilds the shapes for that neutral, and the held pose shows
//               the sculpt again.
// Each one undo step. The held pose lives in memory only (not saved in .sxr).
import { triangles, unpose as unposeBase } from './ShapeRetarget.js';
import { sourceMesh, refreshMarkers, meshLabel } from './TopoTransfer.js';

// { meshId, ref (the neutral the pose was made on), D (the pose as one offset), preview (the
// weights as they were) }
export const held = { pose: null };

const say = (msg, colour) => { console.log('[TopoPose] ' + msg); window.screenLog?.(msg, colour); };
const reg = () => window._animationRegistry;

// The shapes' part of the composite as it is shown: applyBlendshapes' loop without the lids,
// jiggle and teeth pushes (those follow the composite, they are not the pose).
function poseOffset(track) {
  const R = reg(), D = new Float32Array(track.baseShape.length), n = D.length;
  let any = false;
  track.blendshapes.forEach((d, name) => {
    const bTrack = track.blendshapeTracks.get(name);
    const previewing = track.blendshapePreview && track.blendshapePreview.has(name);
    if ((!bTrack || bTrack.times.length === 0) && !previewing && !R.isBlendshapeCombo(track, name) && !R._idleMoves(track, name)) return;
    if (track.blendshapeMuted && track.blendshapeMuted.has(name)) return;
    const w = R.shownWeight(track, name, bTrack);
    if (w === 0) return;
    for (const [dd, k] of R.shapeTerms(track, name, d, w)) {
      if (!k) continue;
      for (let i = 0, m = Math.min(n, dd.length); i < m; i++) if (dd[i]) { D[i] += k * dd[i]; any = true; }
    }
  });
  return any ? D : null;
}

function put(main, s, track, st) {
  track.baseShape.set(st.base);
  track.shapeRef = st.ref;
  track.blendshapePreview = new Map(st.preview);
  held.pose = st.held;
  track._bsRev = (track._bsRev | 0) + 1;
  reg().applyBlendshapes(s);
  reg()._refreshBlendPanels(s);
  refreshMarkers(main);
  window._refreshTopo?.();
  main.render();
}

function step(main, s, track, after, label) {
  const before = { base: track.baseShape.slice(), ref: track.shapeRef, preview: new Map(track.blendshapePreview || []), held: held.pose };
  put(main, s, track, after);
  main.getStateManager?.()?.pushStateCustom(() => put(main, s, track, before), () => put(main, s, track, after), false, label);
}

export function holdPose(main) {
  const s = sourceMesh(main), track = s && reg()?.tracks.get(s.getID());
  if (!track) return say('No GNM head in the scene', 'yellow');
  if (held.pose) return say('A pose is already held: Un-pose first', 'yellow');
  const D = poseOffset(track);
  if (!D) return say('Pose GNM to match the sculpt first (Face tool or the blendshape pad)', 'yellow');
  const ref = (track.shapeRef || track.baseShape).slice();
  const base = track.baseShape.map((b, i) => b + D[i]);
  // Every shown shape to 0 as a preview (combos follow their drivers).
  const preview = new Map(track.blendshapePreview || []);
  for (const name of track.blendshapes.keys()) {
    if (!reg().isBlendshapeCombo(track, name) && reg().shownWeight(track, name, track.blendshapeTracks.get(name)) !== 0) preview.set(name, 0);
  }
  step(main, s, track, { base, ref: track.shapeRef, preview, held: { meshId: s.getID(), ref, D, preview: new Map(track.blendshapePreview || []) } }, 'Hold Pose');
  say(`Holding ${meshLabel(s)}'s pose in its Base: Wrap and Snap now fit it as posed, then Un-pose`);
}

export function unposeToNeutral(main) {
  const s = sourceMesh(main), track = s && reg()?.tracks.get(s.getID());
  const h = held.pose;
  if (!track || !h || h.meshId !== s.getID()) return say('No pose held: Hold Pose before Wrap', 'yellow');
  if (h.D.length !== track.baseShape.length) return say('The topology changed since Hold Pose', 'yellow');
  const t0 = performance.now(), nv = track.baseShape.length / 3;
  const { base, miss } = unposeBase(h.ref, h.D, track.baseShape, triangles(s.getFaces(), s.getNbFaces()), nv);
  // The shapes were made on h.ref, so that is what Retarget Shapes carries them from.
  step(main, s, track, { base, ref: h.ref, preview: h.preview, held: null }, 'Un-pose to Neutral');
  say(`Un-posed to the sculpt's neutral in ${(performance.now() - t0).toFixed(0)} ms (round trip within ${miss.toPrecision(2)}). Retarget Shapes next, and the pose shows the sculpt again`);
}
