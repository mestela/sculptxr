// GNM's TOPO TRANSFER LANDMARKS: one skin vertex each, in pick order (the anchors that pin the
// head's size, turn and placement first). Derived 2026-10-26 on gnm_head_arkit.sxr from the region
// data (gnmRegionData.js), the lid loops (gnmLids.js) and the midline (+Z forward, +Y up, the
// left eye at +X): nose tip = most forward midline nose vertex, mouth corner = widest lip vertex,
// eye corners = the lid loops' ends, and so on. Every L/R pair mirrors to within 0.03 units.
// `mirror` names the other side's landmark, for symmetric picking. `core`: the anchors Wrap needs
// before it runs (TopoTransfer.coreProgress) -- a bare count let two eye-corner clicks (four picks,
// mirrored) through with the mouth and jaw unpinned.
//
// EARS AND NECK EDGE (2026-10-29, spork's elf ears and short capped neck never fitted): 'Ear root
// top' (2930) is where the rim leaves the head -- it was 'Ear top', and read that way on spork --
// so the rim itself had no landmark and a long pointed ear stayed GNM-sized with the snap unable
// to reach it. 'Ear tip' is the rim's top-back corner, where an elf ear grows from, and 'Ear back'
// the rim's back-most point (the blade between tip and lobe); the tragus pins the ear's front to
// the cheek so the tip does not drag the root with it. The NECK EDGE landmarks are vertices of
// GNM's open neck rim: click where the sculpt's neck should end (on a capped neck, where it turns
// under). Without them the rim kept GNM's long neck and shoulder flare.
// Measured on spork (matt's 30 picks + these 6): the neck rim 4.9 mean / 13.3 max world off the
// sculpt -> 0.05 / 0.25; the sculpt's ear to GNM 1.12 / 4.6 -> 0.20 / 1.08.
export const GNM_LANDMARKS = [
  { key: 'eyeInnerL', label: 'Inner eye corner L', v: 555, mirror: 'eyeInnerR', core: true },
  { key: 'eyeInnerR', label: 'Inner eye corner R', v: 6683, mirror: 'eyeInnerL', core: true },
  { key: 'eyeOuterL', label: 'Outer eye corner L', v: 1041, mirror: 'eyeOuterR', core: true },
  { key: 'eyeOuterR', label: 'Outer eye corner R', v: 7169, mirror: 'eyeOuterL', core: true },
  { key: 'noseTip', label: 'Nose tip', v: 12296, core: true },
  { key: 'mouthCornerL', label: 'Mouth corner L', v: 5155, mirror: 'mouthCornerR', core: true },
  { key: 'mouthCornerR', label: 'Mouth corner R', v: 11283, mirror: 'mouthCornerL', core: true },
  { key: 'chin', label: 'Chin', v: 12260, core: true },
  { key: 'noseBridge', label: 'Nose bridge', v: 12320 },
  { key: 'subnasale', label: 'Under the nose', v: 12298 },
  { key: 'alarL', label: 'Nostril wing L', v: 5170, mirror: 'alarR' },
  { key: 'alarR', label: 'Nostril wing R', v: 11298, mirror: 'alarL' },
  { key: 'upperLip', label: 'Upper lip', v: 12276 },
  { key: 'lowerLip', label: 'Lower lip', v: 12270 },
  { key: 'menton', label: 'Under the chin', v: 12342 },
  { key: 'upperLidL', label: 'Upper lid L', v: 1035, mirror: 'upperLidR' },
  { key: 'upperLidR', label: 'Upper lid R', v: 7163, mirror: 'upperLidL' },
  { key: 'lowerLidL', label: 'Lower lid L', v: 1022, mirror: 'lowerLidR' },
  { key: 'lowerLidR', label: 'Lower lid R', v: 7150, mirror: 'lowerLidL' },
  { key: 'browL', label: 'Brow L', v: 963, mirror: 'browR' },
  { key: 'browR', label: 'Brow R', v: 7091, mirror: 'browL' },
  { key: 'foreheadMid', label: 'Forehead', v: 12335 },
  { key: 'cheekboneL', label: 'Cheekbone L', v: 3880, mirror: 'cheekboneR' },
  { key: 'cheekboneR', label: 'Cheekbone R', v: 10008, mirror: 'cheekboneL' },
  { key: 'earTopL', label: 'Ear root top L', v: 2930, mirror: 'earTopR' },
  { key: 'earTopR', label: 'Ear root top R', v: 9058, mirror: 'earTopL' },
  { key: 'earTipL', label: 'Ear tip L', v: 2445, mirror: 'earTipR' },
  { key: 'earTipR', label: 'Ear tip R', v: 8573, mirror: 'earTipL' },
  { key: 'tragusL', label: 'Tragus L', v: 2989, mirror: 'tragusR' },
  { key: 'tragusR', label: 'Tragus R', v: 9117, mirror: 'tragusL' },
  { key: 'earBackL', label: 'Ear back L', v: 2374, mirror: 'earBackR' },
  { key: 'earBackR', label: 'Ear back R', v: 8502, mirror: 'earBackL' },
  { key: 'earLobeL', label: 'Ear lobe L', v: 2485, mirror: 'earLobeR' },
  { key: 'earLobeR', label: 'Ear lobe R', v: 8613, mirror: 'earLobeL' },
  { key: 'headTop', label: 'Top of head', v: 12398 },
  { key: 'headBack', label: 'Back of head', v: 12460 },
  { key: 'neckFront', label: 'Neck edge front', v: 12358 },
  { key: 'neckBack', label: 'Neck edge back', v: 12449 },
  { key: 'neckSideL', label: 'Neck edge side L', v: 5267, mirror: 'neckSideR' },
  { key: 'neckSideR', label: 'Neck edge side R', v: 11395, mirror: 'neckSideL' },
];
