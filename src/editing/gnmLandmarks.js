// GNM's TOPO TRANSFER LANDMARKS: one skin vertex each, in pick order (the anchors that pin the
// head's size, turn and placement first). Derived 2026-10-26 on gnm_head_arkit.sxr from the region
// data (gnmRegionData.js), the lid loops (gnmLids.js) and the midline (+Z forward, +Y up, the
// left eye at +X): nose tip = most forward midline nose vertex, mouth corner = widest lip vertex,
// eye corners = the lid loops' ends, and so on. Every L/R pair mirrors to within 0.03 units.
// `mirror` names the other side's landmark, for symmetric picking.
export const GNM_LANDMARKS = [
  { key: 'eyeInnerL', label: 'Inner eye corner L', v: 555, mirror: 'eyeInnerR' },
  { key: 'eyeInnerR', label: 'Inner eye corner R', v: 6683, mirror: 'eyeInnerL' },
  { key: 'eyeOuterL', label: 'Outer eye corner L', v: 1041, mirror: 'eyeOuterR' },
  { key: 'eyeOuterR', label: 'Outer eye corner R', v: 7169, mirror: 'eyeOuterL' },
  { key: 'noseTip', label: 'Nose tip', v: 12296 },
  { key: 'mouthCornerL', label: 'Mouth corner L', v: 5155, mirror: 'mouthCornerR' },
  { key: 'mouthCornerR', label: 'Mouth corner R', v: 11283, mirror: 'mouthCornerL' },
  { key: 'chin', label: 'Chin', v: 12260 },
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
  { key: 'earTopL', label: 'Ear top L', v: 2930, mirror: 'earTopR' },
  { key: 'earTopR', label: 'Ear top R', v: 9058, mirror: 'earTopL' },
  { key: 'earLobeL', label: 'Ear lobe L', v: 2485, mirror: 'earLobeR' },
  { key: 'earLobeR', label: 'Ear lobe R', v: 8613, mirror: 'earLobeL' },
  { key: 'headTop', label: 'Top of head', v: 12398 },
  { key: 'headBack', label: 'Back of head', v: 12460 },
];
