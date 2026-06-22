// Single source of truth for the tool lists shown in the HTML menu (MainMenuPanel) AND
// the VR ToolPickerPanel. Add a tool here once — it appears in both. (Tool classes are
// registered separately in src/editing/tools/Tools.js.)
import Enums from '../../misc/Enums.js';

export const SCULPT_TOOLS = [
  { id: Enums.Tools.BRUSH,         label: 'Brush'     },
  { id: Enums.Tools.INFLATE,       label: 'Inflate'   },
  { id: Enums.Tools.FLATTEN,       label: 'Flatten'   },
  { id: Enums.Tools.PINCH,         label: 'Pinch'     },
  { id: Enums.Tools.CREASE,        label: 'Crease'    },
  { id: Enums.Tools.SMOOTH,        label: 'Smooth'    },
  { id: Enums.Tools.RELAX,         label: 'Relax'     },
  { id: Enums.Tools.PAINT,         label: 'Paint'     },
  { id: Enums.Tools.MOVE,          label: 'Move'      },
  { id: Enums.Tools.GRAB,          label: 'Grab'      },
  { id: Enums.Tools.DRAG,          label: 'Drag'      },
  { id: Enums.Tools.SLIDE,         label: 'Slide'     },
  { id: Enums.Tools.TWIST,         label: 'Twist'     },
  { id: Enums.Tools.GEODESIC_POSE, label: 'Pose'      },
  { id: Enums.Tools.TRANSFORM_VR,  label: 'Transform' },
  { id: Enums.Tools.MASKING,       label: 'Masking'   },
];

export const MESH_TOOLS = [
  { id: Enums.Tools.CUT_TOOL,        label: 'Cut'        },
  { id: Enums.Tools.EXTRUDE,         label: 'Extrude'    },
  { id: Enums.Tools.INSET,           label: 'Inset'      },
  { id: Enums.Tools.DELETE_FACE,     label: 'Del Face'   },
  { id: Enums.Tools.FILL_HOLE,       label: 'Fill Hole'  },
  { id: Enums.Tools.DISSOLVE_EDGE,   label: 'Dis Edge'   },
  { id: Enums.Tools.SPLIT_FACE,      label: 'Split Face' },
  { id: Enums.Tools.SPIN_EDGE,       label: 'Spin Edge'  },
  { id: Enums.Tools.COLLAPSE_EDGE,   label: 'Col Edge'   },
  { id: Enums.Tools.DISSOLVE_VERTEX, label: 'Dis Vert'   },
  { id: Enums.Tools.WELD,            label: 'Weld'       },
];
