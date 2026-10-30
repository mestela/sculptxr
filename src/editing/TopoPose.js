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
// Each one undo step. The held pose is saved in the .sxr (files/TopoIO.js).
import { triangles, unpose as unposeBase } from './ShapeRetarget.js';
import { sourceMesh, refreshMarkers, meshLabel, LID_RINGS } from './TopoTransfer.js';
import { lipSeam, lidRegion, closeLips, seamRegion } from './GnmRegions.js';
import { neighbours, relaxRegion } from './TopoWrap.js';

// { meshId, ref (the neutral the pose was made on), D (the pose as one offset), preview (the
// previews as they were), weights ({ shape: shown weight }, as the Match pose) }
export const held = { pose: null };

// The held pose, if its head is still in the scene. Deleting the head left it "held": Hold Pose
// lit and refusing a new head ("already held"), Un-pose ignoring it (matt: copied the pose, swapped
// in a new GNM, pasted, and could not get back to Match). Not cleared here: undoing the delete
// brings the head back with its pose.
export function heldPose(main) {
  const h = held.pose;
  return h && main.getMeshes().some((m) => m.getID() === h.meshId) ? h : null;
}

const MATCH = 'Match';   // the pose library entry Hold Pose writes
const SEAM_RINGS = 2;   // rings round the lip seam re-solved to GNM's neutral (Un-pose)
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
  if (st.poses) { track.blendshapePoses = new Map(st.poses); window._refreshPoseLists?.(); }
  held.pose = st.held;
  track.partsSeated = !!st.seated;
  track._bsRev = (track._bsRev | 0) + 1;
  reg().applyBlendshapes(s);
  reg()._refreshBlendPanels(s);
  refreshMarkers(main);
  window._refreshTopo?.();
  main.render();
}

function step(main, s, track, after, label) {
  const before = { base: track.baseShape.slice(), ref: track.shapeRef, preview: new Map(track.blendshapePreview || []), poses: new Map(track.blendshapePoses || []), held: held.pose, seated: track.partsSeated };
  put(main, s, track, after);
  main.getStateManager?.()?.pushStateCustom(() => put(main, s, track, before), () => put(main, s, track, after), false, label);
}

export function holdPose(main) {
  const s = sourceMesh(main), track = s && reg()?.tracks.get(s.getID());
  if (!track) return say('No GNM head in the scene', 'yellow');
  if (heldPose(main)) return say('A pose is already held: Un-pose first', 'yellow');
  const D = poseOffset(track);
  if (!D) return say('Pose GNM to match the sculpt first (Face tool or the blendshape pad)', 'yellow');
  const ref = (track.shapeRef || track.baseShape).slice();
  const base = track.baseShape.map((b, i) => b + D[i]);
  // Every shown shape to 0 as a preview (combos follow their drivers). The weights are also kept
  // in the pose library as MATCH (matt): the expression the sculpt was made in, to go back to.
  const preview = new Map(track.blendshapePreview || []), match = {};
  for (const name of track.blendshapes.keys()) {
    if (reg().isBlendshapeCombo(track, name)) continue;
    const w = reg().shownWeight(track, name, track.blendshapeTracks.get(name));
    if (w === 0) continue;
    preview.set(name, 0);
    if (Math.abs(w) > 1e-4) match[name] = Math.round(w * 1e4) / 1e4;
  }
  const poses = new Map(track.blendshapePoses || []).set(MATCH, match);
  step(main, s, track, { base, ref: track.shapeRef, preview, poses, held: { meshId: s.getID(), ref, D, preview: new Map(track.blendshapePreview || []), weights: match } }, 'Hold Pose');
  say(`Holding ${meshLabel(s)}'s pose in its Base (saved as pose '${MATCH}'): Wrap and Snap now fit it as posed, then Un-pose`);
}

// TOP UP THE MOUTH. The pose is matched by eye, and the sculpt's mouth is usually open a little more
// than GNM was posed to (Snap then follows the sculpt's lips). Un-posing only the held pose left
// that extra opening in the NEUTRAL: on matt's spork the lips stayed 0.68 apart (GNM's own 0.12),
// so the teeth showed at rest and on every small shape. So the opening the wrap has beyond the held
// pose is put down to more of the mouth-opening shapes -- solved on the lip seam, the upper/lower
// lip vertex pairs that touch on GNM's neutral -- and un-posed with the rest. Only these shapes, held
// close to the matched weights: let every shape in and the seam is "explained" by cheek squints and
// nose sneers. On spork: jawOpen 0.29->0.37, upper lip up 0.16->0.30; neutral gap 0.68 -> 0.20.
const OPENERS = ['jawOpen', 'mouthLowerDownLeft', 'mouthLowerDownRight', 'mouthUpperUpLeft', 'mouthUpperUpRight', 'mouthClose'];
const STAY = 0.1;   // pull toward the matched weight, relative to each shape's own pull on the seam
function topUpOpening(track, h, W) {
  const ref = h.ref, pairs = lipSeam(ref);
  const np = pairs.length / 2, none = { D: h.D, changed: [] };
  if (!np) return none;
  const seam = (P, out, k = 1) => { for (let i = 0; i < np; i++) for (let x = 0; x < 3; x++) out[i * 3 + x] += k * (P[pairs[i * 2 + 1] * 3 + x] - P[pairs[i * 2] * 3 + x]); return out; };
  // What is left to explain: the wrap's seam beyond the held pose's.
  const r = seam(W, new Float64Array(np * 3));
  seam(ref, r, -1); seam(h.D, r, -1);
  const R = reg(), w0 = h.weights || {};
  const S = OPENERS.filter((n) => track.blendshapes.has(n) && !R.isBlendshapeCombo(track, n)).map((name) => {
    const g = seam(track.blendshapes.get(name), new Float64Array(np * 3));
    const rg = track.blendshapeRange && track.blendshapeRange.get(name);
    return { name, g, nn: g.reduce((a, x) => a + x * x, 0), w: w0[name] || 0, lo: rg ? rg.min : 0, hi: rg ? rg.max : 1, dw: 0 };
  }).filter((e) => e.nn > 1e-12);
  // Bounded coordinate descent on |r - sum dw g|^2 + STAY nn dw^2.
  for (let it = 0; it < 300; it++) for (const e of S) {
    let gr = 0;
    for (let i = 0; i < r.length; i++) gr += e.g[i] * r[i];
    const nd = Math.min(e.hi - e.w, Math.max(e.lo - e.w, (gr + e.nn * e.dw) / (e.nn * (1 + STAY))));
    const step = nd - e.dw;
    if (!step) continue;
    for (let i = 0; i < r.length; i++) r[i] -= step * e.g[i];
    e.dw = nd;
  }
  const moved = S.filter((e) => Math.abs(e.dw) > 1e-3);
  if (!moved.length) return none;
  const D = Float32Array.from(h.D);
  for (const e of moved) { const d = track.blendshapes.get(e.name); for (let i = 0; i < D.length; i++) D[i] += e.dw * (d[i] || 0); }
  return { D, changed: moved.map((e) => [e.name, e.w + e.dw]) };
}

export function unposeToNeutral(main) {
  const s = sourceMesh(main), track = s && reg()?.tracks.get(s.getID());
  const h = held.pose;
  if (!track || !h || h.meshId !== s.getID()) return say('No pose held: Hold Pose before Wrap', 'yellow');
  if (h.D.length !== track.baseShape.length) return say('The topology changed since Hold Pose', 'yellow');
  const t0 = performance.now(), nv = track.baseShape.length / 3;
  const open = topUpOpening(track, h, track.baseShape), tris = triangles(s.getFaces(), s.getNbFaces());
  const un = unposeBase(h.ref, open.D, track.baseShape, tris, nv), miss = un.miss;
  // THE EYELIDS COME BACK AS GNM's (matt, spork: "they aren't clean loops"). Taking a pose with the
  // eyes wide and the brows working back out kinks the lid rim -- bend per unit length 0.215 -> 0.235
  // (GNM 0.194), the plain subtraction no better -- so the lids and the rings round them are
  // re-solved to GNM's neutral shape, seated in the un-posed skin round them: 0.195, moving the
  // rim by at most 0.36. The sculpt's own lid shape goes with it: resculpt lids after.
  const nb = neighbours(tris, nv);
  const lidded0 = relaxRegion(un.base, h.ref, nb, lidRegion(nb, LID_RINGS), 100);
  // THE LIP LINE THE SAME WAY (matt, spork at rest: "kinks in the lip shape that i know will cause
  // issues downstream" -- a V in the middle of the upper lip, every pucker and funnel blew it up).
  // The lip line was clean through Wrap and Snap and kinked here: the pose taken out through the
  // thin triangles along the seam. The seam and SEAM_RINGS rings round it are re-solved to GNM's
  // neutral shape, seated in the lips round them, so Lip Fit's thinning further out stays.
  // Measured against GNM's neutral over that band: median 0.10 -> 0.02, worst 0.85 -> 0.44.
  const lidded = relaxRegion(lidded0, h.ref, nb, seamRegion(h.ref, nb, SEAM_RINGS), 100);
  // ...and the lips meet at rest, as GNM's do (GnmRegions.closeLips).
  const shut = closeLips(lidded, h.ref, nb, relaxRegion), base = shut.base;
  // The shapes were made on h.ref, so that is what Retarget Shapes carries them from. The topped-up
  // weights go back on the sliders and into the Match pose.
  const preview = new Map(h.preview), weights = { ...(h.weights || {}) };
  for (const [name, w] of open.changed) { preview.set(name, w); weights[name] = Math.round(w * 1e4) / 1e4; }
  const poses = new Map(track.blendshapePoses || []);
  if (open.changed.length && poses.has(MATCH)) poses.set(MATCH, weights);
  // THE TEETH STAY WHERE THE ROUND TRIP PUT THEM (matt, spork 'Match': lower teeth through the lip
  // and chin). Wrap carried them with the skin, Un-pose took the pose out of both together, so
  // they already sit right in the sculpt's mouth; Retarget's Fit Parts would re-seat them by the
  // ring of lips round them, and spork's lips (1.24x GNM's) put them where the jaw does not
  // follow. Measured in Match: lower teeth through the lip and chin 247 vertices -> 0, through
  // the mouth bag 202 -> 52, upper teeth through the lips 31 -> 20. So the next Retarget Shapes
  // only rebuilds the parts rigid where they are (track.partsSeated).
  step(main, s, track, { base, ref: h.ref, preview, poses, held: null, seated: true }, 'Un-pose to Neutral');
  const more = open.changed.map(([n, w]) => `${n} ${(h.weights?.[n] || 0).toFixed(2)}->${w.toFixed(2)}`).join(', ');
  say(`Un-posed to the sculpt's neutral in ${(performance.now() - t0).toFixed(0)} ms (round trip within ${miss.toPrecision(2)}; lips closed ${shut.before.toFixed(2)} -> ${shut.after.toFixed(2)} apart)${more ? `; the sculpt's mouth was open a little more than the pose: ${more}` : ''}. Retarget Shapes next, and the pose shows the sculpt again`);
}
