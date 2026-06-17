const _fa  = (cp, size = 16) => `<i style="font-family:'Font Awesome 6 Free';font-weight:900;font-style:normal;font-size:${size}px">${cp}</i>`;

export const ICON_PIN   = _fa('', 13);
export const ICON_DOCK  = _fa('', 13);

export const TAB_ICONS = {
  scene:     _fa(''),
  rendering: _fa(''),
  topology:  _fa(''),
  sculpting: _fa(''),
  animation: _fa(''),
  blendshapes: _fa(''), // fa-layer-group
  timeline:  _fa(''), // fa-bezier-curve — same as graph editor
};
