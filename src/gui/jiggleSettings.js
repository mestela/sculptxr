// The jiggle sliders' persistence (Jiggle.js holds the settings and the slider spec; it stays free
// of the options module so its harness runs under node). Saved values win over the defaults the
// first time a panel loads this; each slider saves its own.
import getOptionsURL from '../misc/getOptionsURL.js';
import { jiggle, JIGGLE_SLIDERS } from '../editing/Jiggle.js';
import { teeth, TEETH_SLIDERS, LIP_SLIDERS } from '../editing/TeethCollide.js';

try {
  const saved = getOptionsURL()._rawSaved || {};
  for (const { key } of JIGGLE_SLIDERS) if (typeof saved['jiggle_' + key] === 'number') jiggle[key] = saved['jiggle_' + key];
  for (const { key } of [...TEETH_SLIDERS, ...LIP_SLIDERS]) if (typeof saved['teeth_' + key] === 'number') teeth[key] = saved['teeth_' + key];
} catch (_) { /* no storage: defaults */ }

export function setJiggle(key, value) {
  jiggle[key] = value;
  getOptionsURL.saveOption('jiggle_' + key, value, 500);
}

// The teeth push's sliders (TeethCollide.js). `rev` moves so the next frame recomposites.
export function setTeeth(key, value) {
  teeth[key] = value;
  teeth.rev++;
  getOptionsURL.saveOption('teeth_' + key, value, 500);
}
