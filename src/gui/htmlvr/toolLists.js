// Single source of truth for tool NAMES and for the tool lists shown in the HTML menu
// (MainMenuPanel) AND the VR ToolPickerPanel. Add a tool here once — it appears in both.
// (Tool classes are registered separately in src/editing/tools/Tools.js.)
import Enums from '../../misc/Enums.js';

// ── EVERY TOOL'S NAME, IN ONE PLACE ──────────────────────────────────────────
//
// THE NAME AND THE LIST ARE DIFFERENT QUESTIONS, and conflating them is what broke. The lists
// below say which tools appear in a picker; this map says what a tool is CALLED. A tool can be
// named and not listed (Voxel, which you enter by adding a voxel object; the transforms, which
// other code switches to) — and before this map those tools had no name at all in half the app.
//
// It went wrong the ordinary way: the wrist panel kept its own private copy of the names, so
// SELECT — appended to Enums last — was added to the lists and not to that copy, and the wrist
// panel showed "Tool 35". matt: "surely the names should just be assigned from a central
// location? how has that one entry got out of sync?"
//
// Scene's quick-swap toast had the same fault from the other direction: it looked the name up in
// SCULPT_TOOLS only, so every mesh-edit tool toasted as a bare "Tool".
//
// KEYED ON THE ENUM, not on an array position, and toollabels_test asserts that every value in
// Enums.Tools has an entry — so the next tool appended to the enum fails a harness rather than
// surfacing as "Tool 36" on a wrist panel in a headset.
export const TOOL_LABELS = {
  [Enums.Tools.BRUSH]:            'Brush',
  [Enums.Tools.INFLATE]:          'Inflate',
  [Enums.Tools.TWIST]:            'Twist',
  [Enums.Tools.SMOOTH]:           'Smooth',
  [Enums.Tools.FLATTEN]:          'Flatten',
  [Enums.Tools.PINCH]:            'Pinch',
  [Enums.Tools.CREASE]:           'Crease',
  [Enums.Tools.DRAG]:             'Drag',
  [Enums.Tools.RELAX]:            'Relax',
  [Enums.Tools.PAINT]:            'Paint',
  [Enums.Tools.MOVE]:             'Move',
  [Enums.Tools.MASKING]:          'Masking',
  [Enums.Tools.LOCALSCALE]:       'Scale',
  [Enums.Tools.TRANSFORM]:        'Transform',
  [Enums.Tools.VOXEL]:            'Voxel',
  [Enums.Tools.GRAB]:             'Grab',
  [Enums.Tools.TRANSFORM_VR]:     'Transform',
  [Enums.Tools.SLIDE]:            'Slide',
  [Enums.Tools.DELETE_FACE]:      'Del Face',
  [Enums.Tools.FILL_HOLE]:        'Fill Hole',
  [Enums.Tools.DISSOLVE_EDGE]:    'Dis Edge',
  [Enums.Tools.SPLIT_FACE]:       'Split Face',
  [Enums.Tools.SPIN_EDGE]:        'Spin Edge',
  [Enums.Tools.COLLAPSE_EDGE]:    'Col Edge',
  [Enums.Tools.DISSOLVE_VERTEX]:  'Dis Vert',
  [Enums.Tools.WELD]:             'Weld',
  [Enums.Tools.SNAP_WELD_CENTER]: 'Weld Center',
  [Enums.Tools.SPLIT_EDGE]:       'Split Edge',
  [Enums.Tools.EDGE_CREATE]:      'Create Edge',
  [Enums.Tools.CUT_TOOL]:         'Cut',
  [Enums.Tools.EXTRUDE]:          'Extrude',
  [Enums.Tools.INSET]:            'Inset',
  [Enums.Tools.GEODESIC_POSE]:    'Pose',
  [Enums.Tools.PAINT_GROUP]:      'Groups',
  [Enums.Tools.BONE_DRAW]:        'Bones',
  [Enums.Tools.SELECT]:           'Select',
};

// The fallback still exists, because a name is not worth throwing over — but it now means "a
// tool id that is not in Enums at all", which is a different and much louder kind of wrong than
// "somebody forgot to update the second copy".
export function toolLabel(id) {
  return TOOL_LABELS[id] ?? `Tool ${id}`;
}

// A list entry is just an id now: the label comes from the map above, so a tool cannot be
// called one thing in the grid and another on the wrist.
const entry = (id) => ({ id: id, label: toolLabel(id) });

export const SCULPT_TOOLS = [
  entry(Enums.Tools.BRUSH),
  entry(Enums.Tools.INFLATE),
  entry(Enums.Tools.FLATTEN),
  entry(Enums.Tools.PINCH),
  entry(Enums.Tools.CREASE),
  entry(Enums.Tools.SMOOTH),
  entry(Enums.Tools.RELAX),
  entry(Enums.Tools.PAINT),
  entry(Enums.Tools.PAINT_GROUP),
  entry(Enums.Tools.MOVE),
  entry(Enums.Tools.SELECT),
  entry(Enums.Tools.GRAB),
  entry(Enums.Tools.DRAG),
  entry(Enums.Tools.SLIDE),
  entry(Enums.Tools.TWIST),
  // POSE (GeodesicPoseTool) IS HIDDEN, NOT REMOVED. Rig-free two-anchor bending with a geodesic
  // falloff -- drop A and B on the surface and the band between them rotates, with distance
  // measured ACROSS the mesh so a bent arm does not drag the torso it rests against.
  //
  // Its last feature work was v3.2.0; the whole rigging system landed after it, and that is how
  // matt poses now: "i think we can safely hide it for now, i'd use bones these days". It also
  // shared the word Pose with the Bones tool's own Pose mode, which meant two different things
  // under one name in the same UI.
  //
  // Restoring it is putting this line back: the tool class, its registration in Tools.js, its
  // name above and Scene.js's laser-aim picking case are all left alone. src/editing/Geodesic.js
  // stays regardless -- it is the substrate the release notes describe as "reused toward auto
  // skin-weights in the rigging phase".
  //
  //   entry(Enums.Tools.GEODESIC_POSE),
  entry(Enums.Tools.BONE_DRAW),
  entry(Enums.Tools.TRANSFORM_VR),
  entry(Enums.Tools.MASKING),
];

export const MESH_TOOLS = [
  entry(Enums.Tools.CUT_TOOL),
  entry(Enums.Tools.EXTRUDE),
  entry(Enums.Tools.INSET),
  entry(Enums.Tools.DELETE_FACE),
  entry(Enums.Tools.FILL_HOLE),
  entry(Enums.Tools.DISSOLVE_EDGE),
  entry(Enums.Tools.SPLIT_FACE),
  entry(Enums.Tools.SPIN_EDGE),
  entry(Enums.Tools.COLLAPSE_EDGE),
  entry(Enums.Tools.DISSOLVE_VERTEX),
  entry(Enums.Tools.WELD),
];
