/**
 * toolTints.js — shared tool → colour maps.
 * Used by MiniPanel, MainMenuPanel for consistent per-category tinting.
 *
 * Two variants:
 *   TOOL_TINTS      — dark background fills (Catppuccin Mocha tones), for MiniPanel button bg
 *   TOOL_TEXT_TINTS — bright text colours (Catppuccin Mocha accent palette), for MainMenuPanel
 *
 * Categories:
 *   red    = sculpt deform (Brush, Inflate, Flatten, Pinch, Crease)
 *   blue   = smooth (Smooth, Relax)
 *   green  = move / transform (Move, Grab, Drag, Slide, Twist, Transform)
 *   purple = paint (Paint)
 *   orange = masking
 *   yellow = low-poly edit tools
 */
import Enums from '../../misc/Enums.js';

// ── Dark background tints (MiniPanel button fills) ───────────────────────────
export const TOOL_TINTS = {
  [Enums.Tools.BRUSH]:           '#6b4040',
  [Enums.Tools.INFLATE]:         '#6b4040',
  [Enums.Tools.FLATTEN]:         '#6b4040',
  [Enums.Tools.PINCH]:           '#6b4040',
  [Enums.Tools.CREASE]:          '#6b4040',
  [Enums.Tools.MASKING]:         '#6b5440',
  [Enums.Tools.SMOOTH]:          '#404d6b',
  [Enums.Tools.RELAX]:           '#404d6b',
  [Enums.Tools.MOVE]:            '#406b40',
  [Enums.Tools.GRAB]:            '#406b40',
  [Enums.Tools.DRAG]:            '#406b40',
  [Enums.Tools.SLIDE]:           '#406b40',
  [Enums.Tools.TWIST]:           '#406b40',
  [Enums.Tools.TRANSFORM_VR]:    '#406b40',
  [Enums.Tools.TRANSFORM]:       '#406b40',
  [Enums.Tools.LOCALSCALE]:      '#406b40',
  [Enums.Tools.PAINT]:           '#5a406b',
  [Enums.Tools.CUT_TOOL]:        '#5a5540',
  [Enums.Tools.EXTRUDE]:         '#5a5540',
  [Enums.Tools.INSET]:           '#5a5540',
  [Enums.Tools.DELETE_FACE]:     '#5a5540',
  [Enums.Tools.FILL_HOLE]:       '#5a5540',
  [Enums.Tools.DISSOLVE_EDGE]:   '#5a5540',
  [Enums.Tools.SPLIT_FACE]:      '#5a5540',
  [Enums.Tools.SPIN_EDGE]:       '#5a5540',
  [Enums.Tools.COLLAPSE_EDGE]:   '#5a5540',
  [Enums.Tools.DISSOLVE_VERTEX]: '#5a5540',
  [Enums.Tools.WELD]:            '#5a5540',
};

// ── Bright text tints (MainMenuPanel tool labels) ────────────────────────────
export const TOOL_TEXT_TINTS = {
  [Enums.Tools.BRUSH]:           '#f38ba8',  // red
  [Enums.Tools.INFLATE]:         '#f38ba8',
  [Enums.Tools.FLATTEN]:         '#f38ba8',
  [Enums.Tools.PINCH]:           '#f38ba8',
  [Enums.Tools.CREASE]:          '#f38ba8',
  [Enums.Tools.MASKING]:         '#fab387',  // orange/peach
  [Enums.Tools.SMOOTH]:          '#89b4fa',  // blue
  [Enums.Tools.RELAX]:           '#89b4fa',
  [Enums.Tools.MOVE]:            '#a6e3a1',  // green
  [Enums.Tools.GRAB]:            '#a6e3a1',
  [Enums.Tools.DRAG]:            '#a6e3a1',
  [Enums.Tools.SLIDE]:           '#a6e3a1',
  [Enums.Tools.TWIST]:           '#a6e3a1',
  [Enums.Tools.TRANSFORM_VR]:    '#a6e3a1',
  [Enums.Tools.TRANSFORM]:       '#a6e3a1',
  [Enums.Tools.LOCALSCALE]:      '#a6e3a1',
  [Enums.Tools.PAINT]:           '#cba6f7',  // purple/mauve
  [Enums.Tools.CUT_TOOL]:        '#f9e2af',  // yellow
  [Enums.Tools.EXTRUDE]:         '#f9e2af',
  [Enums.Tools.INSET]:           '#f9e2af',
  [Enums.Tools.DELETE_FACE]:     '#f9e2af',
  [Enums.Tools.FILL_HOLE]:       '#f9e2af',
  [Enums.Tools.DISSOLVE_EDGE]:   '#f9e2af',
  [Enums.Tools.SPLIT_FACE]:      '#f9e2af',
  [Enums.Tools.SPIN_EDGE]:       '#f9e2af',
  [Enums.Tools.COLLAPSE_EDGE]:   '#f9e2af',
  [Enums.Tools.DISSOLVE_VERTEX]: '#f9e2af',
  [Enums.Tools.WELD]:            '#f9e2af',
};

export const toolTint     = (id) => TOOL_TINTS[id]      ?? '#313244';
export const toolTextTint = (id) => TOOL_TEXT_TINTS[id] ?? '#a6adc8';
