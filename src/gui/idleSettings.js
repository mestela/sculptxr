// The idle sliders' persistence, kept out of IdleFace.js for the same reason as jiggleSettings.js
// (the options module pulls in gl-matrix UMD and breaks the node harness).
import getOptionsURL from '../misc/getOptionsURL.js';
import { idle, IDLE_SLIDERS } from '../editing/IdleFace.js';

try {
  const saved = getOptionsURL()._rawSaved || {};
  for (const { key } of IDLE_SLIDERS) if (typeof saved['idle_' + key] === 'number') idle[key] = saved['idle_' + key];
} catch (_) { /* no storage: defaults */ }

export function setIdle(key, value) {
  idle[key] = value;
  getOptionsURL.saveOption('idle_' + key, value, 500);
}
