// ARKit 52 blendshape library, organised for sculpting.
//
// ARKit ships 52 named blendshapes (ARFaceAnchor.BlendShapeLocation). Many come as
// Left/Right pairs that are bilateral MIRRORS of one symmetric expression — the user
// should sculpt ONE symmetric shape (with X-symmetry), and we split it into the two
// ARKit halves later. So the picker presents a SHORTER list (34 entries) instead of 52.
//
// Three categories:
//   'symmetric'  — bilaterally-symmetric expression; sculpt once, split → {left,right}.
//                  e.g. eyeBlink → eyeBlinkLeft + eyeBlinkRight.
//   'center'     — inherently centred / whole-face; sculpt as-is, no split. e.g. jawOpen.
//   'directional'— an ASYMMETRIC single pose that LOOKS like half a pair but isn't
//                  (jawLeft is the whole jaw slid left; its mirror is the *separate*
//                  ARKit shape jawRight). Sculpt each on its own; a later "mirror to
//                  opposite" op can generate `opposite` from it. NOT collapsed.
//
// eyeLook* note: collapsed on the L/R (which-eye) axis only — eyeLookInLeft mirrors
// eyeLookInRight (both eyes converge = symmetric). The DIRECTION axis (In/Out, Up/Down)
// is opposite poses and stays as four separate symmetric shapes.

export const ARKIT_BLENDSHAPES = [
  // ── Eyes ──────────────────────────────────────────────────────────────────
  { name: 'eyeBlink',      category: 'symmetric', region: 'Eyes',  arkit: { left: 'eyeBlinkLeft',    right: 'eyeBlinkRight' } },
  { name: 'eyeSquint',     category: 'symmetric', region: 'Eyes',  arkit: { left: 'eyeSquintLeft',   right: 'eyeSquintRight' } },
  { name: 'eyeWide',       category: 'symmetric', region: 'Eyes',  arkit: { left: 'eyeWideLeft',     right: 'eyeWideRight' } },
  { name: 'eyeLookIn',     category: 'symmetric', region: 'Eyes',  arkit: { left: 'eyeLookInLeft',   right: 'eyeLookInRight' } },
  { name: 'eyeLookOut',    category: 'symmetric', region: 'Eyes',  arkit: { left: 'eyeLookOutLeft',  right: 'eyeLookOutRight' } },
  { name: 'eyeLookUp',     category: 'symmetric', region: 'Eyes',  arkit: { left: 'eyeLookUpLeft',   right: 'eyeLookUpRight' } },
  { name: 'eyeLookDown',   category: 'symmetric', region: 'Eyes',  arkit: { left: 'eyeLookDownLeft', right: 'eyeLookDownRight' } },

  // ── Brows ─────────────────────────────────────────────────────────────────
  { name: 'browDown',      category: 'symmetric', region: 'Brows', arkit: { left: 'browDownLeft',    right: 'browDownRight' } },
  { name: 'browOuterUp',   category: 'symmetric', region: 'Brows', arkit: { left: 'browOuterUpLeft', right: 'browOuterUpRight' } },
  { name: 'browInnerUp',   category: 'center',    region: 'Brows', arkit: ['browInnerUp'] },

  // ── Cheeks ────────────────────────────────────────────────────────────────
  { name: 'cheekSquint',   category: 'symmetric', region: 'Cheeks', arkit: { left: 'cheekSquintLeft', right: 'cheekSquintRight' } },
  { name: 'cheekPuff',     category: 'center',    region: 'Cheeks', arkit: ['cheekPuff'] },

  // ── Nose ──────────────────────────────────────────────────────────────────
  { name: 'noseSneer',     category: 'symmetric', region: 'Nose',  arkit: { left: 'noseSneerLeft',   right: 'noseSneerRight' } },

  // ── Jaw ───────────────────────────────────────────────────────────────────
  { name: 'jawOpen',       category: 'center',      region: 'Jaw', arkit: ['jawOpen'] },
  { name: 'jawForward',    category: 'center',      region: 'Jaw', arkit: ['jawForward'] },
  { name: 'jawLeft',       category: 'directional', region: 'Jaw', arkit: { self: 'jawLeft',  opposite: 'jawRight' } },
  { name: 'jawRight',      category: 'directional', region: 'Jaw', arkit: { self: 'jawRight', opposite: 'jawLeft' } },

  // ── Mouth ─────────────────────────────────────────────────────────────────
  { name: 'mouthSmile',     category: 'symmetric',  region: 'Mouth', arkit: { left: 'mouthSmileLeft',     right: 'mouthSmileRight' } },
  { name: 'mouthFrown',     category: 'symmetric',  region: 'Mouth', arkit: { left: 'mouthFrownLeft',     right: 'mouthFrownRight' } },
  { name: 'mouthDimple',    category: 'symmetric',  region: 'Mouth', arkit: { left: 'mouthDimpleLeft',    right: 'mouthDimpleRight' } },
  { name: 'mouthStretch',   category: 'symmetric',  region: 'Mouth', arkit: { left: 'mouthStretchLeft',   right: 'mouthStretchRight' } },
  { name: 'mouthPress',     category: 'symmetric',  region: 'Mouth', arkit: { left: 'mouthPressLeft',     right: 'mouthPressRight' } },
  { name: 'mouthLowerDown', category: 'symmetric',  region: 'Mouth', arkit: { left: 'mouthLowerDownLeft', right: 'mouthLowerDownRight' } },
  { name: 'mouthUpperUp',   category: 'symmetric',  region: 'Mouth', arkit: { left: 'mouthUpperUpLeft',   right: 'mouthUpperUpRight' } },
  { name: 'mouthClose',     category: 'center',     region: 'Mouth', arkit: ['mouthClose'] },
  { name: 'mouthFunnel',    category: 'center',     region: 'Mouth', arkit: ['mouthFunnel'] },
  { name: 'mouthPucker',    category: 'center',     region: 'Mouth', arkit: ['mouthPucker'] },
  { name: 'mouthRollLower', category: 'center',     region: 'Mouth', arkit: ['mouthRollLower'] },
  { name: 'mouthRollUpper', category: 'center',     region: 'Mouth', arkit: ['mouthRollUpper'] },
  { name: 'mouthShrugLower',category: 'center',     region: 'Mouth', arkit: ['mouthShrugLower'] },
  { name: 'mouthShrugUpper',category: 'center',     region: 'Mouth', arkit: ['mouthShrugUpper'] },
  { name: 'mouthLeft',      category: 'directional',region: 'Mouth', arkit: { self: 'mouthLeft',  opposite: 'mouthRight' } },
  { name: 'mouthRight',     category: 'directional',region: 'Mouth', arkit: { self: 'mouthRight', opposite: 'mouthLeft' } },

  // ── Tongue ────────────────────────────────────────────────────────────────
  { name: 'tongueOut',     category: 'center',     region: 'Tongue', arkit: ['tongueOut'] },
];

// Display order of regions in the picker.
export const ARKIT_REGIONS = ['Eyes', 'Brows', 'Cheeks', 'Nose', 'Jaw', 'Mouth', 'Tongue'];

// Picker list grouped by region, in ARKIT_REGIONS order.
export function arkitByRegion() {
  const groups = new Map(ARKIT_REGIONS.map((r) => [r, []]));
  for (const e of ARKIT_BLENDSHAPES) groups.get(e.region).push(e);
  return ARKIT_REGIONS.map((r) => ({ region: r, entries: groups.get(r) }));
}

// Look up an entry by its unified/display name.
export function arkitEntry(name) {
  return ARKIT_BLENDSHAPES.find((e) => e.name === name) || null;
}

// The ARKit export target names a sculpted shape splits into.
//   symmetric   → ['<name>Left', '<name>Right']  (split the delta along the symmetry plane)
//   directional → ['<self>', '<opposite>']       (self + its mirror)
//   center      → ['<name>']                     (no split)
// Returns null for non-ARKit (custom) names.
export function arkitSplitTargets(name) {
  const e = arkitEntry(name);
  if (!e) return null;
  if (e.category === 'symmetric')   return [e.arkit.left, e.arkit.right];
  if (e.category === 'directional') return [e.arkit.self, e.arkit.opposite];
  return [e.arkit[0]];
}

// Sanity: the library must cover exactly the ARKit 52.
export function arkitFlatCount() {
  return ARKIT_BLENDSHAPES.reduce((n, e) => {
    if (e.category === 'symmetric') return n + 2;
    if (e.category === 'directional') return n + 1; // self only (opposite is its own entry)
    return n + 1;
  }, 0);
}
