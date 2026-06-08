var Tablet = {
  radiusFactor: 0.75,
  intensityFactor: 0.0,
  pressure: 0.5
};

// Restore saved values on load
try {
  const stored = localStorage.getItem('sculptxr_settings');
  if (stored) {
    const s = JSON.parse(stored);
    if (s.tabletRadiusFactor    !== undefined) Tablet.radiusFactor    = s.tabletRadiusFactor;
    if (s.tabletIntensityFactor !== undefined) Tablet.intensityFactor = s.tabletIntensityFactor;
  }
} catch (_) {}

Tablet.getPressureIntensity = function () {
  return 1.0 + Tablet.intensityFactor * (Tablet.pressure * 2.0 - 1.0);
};

Tablet.getPressureRadius = function () {
  return 1.0 + Tablet.radiusFactor * (Tablet.pressure * 2.0 - 1.0);
};

export default Tablet;
