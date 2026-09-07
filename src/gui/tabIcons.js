import { faIcon } from './htmlvr/faIcons.js';

// These were FontAwesome GLYPHS -- a private-use codepoint in an <i> with the FA family on it --
// which meant every panel that showed a tab icon dragged the whole 206KB base64 woff2 into its
// rasterised SVG. Same icons, drawn as paths. See faIcons.js for the measurement.
const _fa = (name, size = 16) => faIcon(name, { size });

export const ICON_PIN   = _fa('thumbtack', 13);
export const ICON_DOCK  = _fa('arrow-left', 13);

export const TAB_ICONS = {
  scene:     _fa('sitemap'),
  rendering: _fa('photo-film'),
  topology:  _fa('draw-polygon'),
  sculpting: _fa('toolbox'),
  properties: _fa('sliders'),   // fa-sliders
  animation: _fa('film'),
  blendshapes: _fa('layer-group'), // fa-layer-group
  timeline:  _fa('bezier-curve'), // fa-bezier-curve — same as graph editor
};
