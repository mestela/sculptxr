// DOES THIS HEADSET KNOW ANYTHING ABOUT THE ROOM?
//
// WebXR has a Lighting Estimation API: ask the session for a `light-estimation` feature, call
// `session.requestLightProbe()`, and each frame `frame.getLightEstimate(probe)` reports the room's
// primary light DIRECTION and intensity plus 9 spherical-harmonic coefficients for the ambient —
// and, where `XRWebGLBinding.getReflectionCubeMap()` is available, a live cube map of the room.
// three ships a ready-made wrapper (`examples/jsm/webxr/XREstimatedLight.js`) that turns all of
// that into a DirectionalLight + LightProbe + `.environment` texture.
//
// The catch is that none of it is guaranteed. It rides on the platform's own AR stack — ARCore on
// Android Chrome implements it; headset browsers vary; iOS Safari has no `immersive-ar` session at
// all, so on iPhone/iPad the environment probes ARKit can build are reachable only from a native
// app, not from the web. Which means the question "can we use it" is a question about the device
// in your hands, not about the API, and it cannot be answered from a desktop.
//
// So this answers it on the device. Run it from the headset console DURING an AR session:
//
//   await probeXRLighting()
//
// It reports what was granted, whether a probe could be created, what the first estimate contains,
// and whether reflection cube maps are offered. Read-only: it creates a probe and drops it.
export default async function probeXRLighting() {
  const app = window.app;
  const session = app && app._renderer && app._renderer.xr && app._renderer.xr.getSession
    ? app._renderer.xr.getSession() : null;

  const out = {
    inSession: !!session,
    mode: app ? app.getXRMode && app.getXRMode() : null,
    // Whether the session was even ASKED for it. SculptXR does not request it today, so this is
    // expected to be false until it is added to the optionalFeatures list in SculptGL.js.
    requested: session && session.enabledFeatures
      ? session.enabledFeatures.includes('light-estimation') : 'unknown',
    hasRequestLightProbe: !!(session && session.requestLightProbe),
    hasXRWebGLBinding: typeof window.XRWebGLBinding !== 'undefined',
    preferredReflectionFormat: session ? session.preferredReflectionFormat : null,
    probe: null,
    estimate: null,
    error: null,
  };

  if (!session) { out.error = 'not in an XR session — run this from the headset, in AR'; }
  else if (!session.requestLightProbe) { out.error = 'this browser has no requestLightProbe'; }
  else {
    try {
      const probe = await session.requestLightProbe();
      out.probe = 'created';
      // One frame is enough to see whether estimates actually arrive.
      out.estimate = await new Promise((resolve) => {
        let done = false;
        const t = setTimeout(() => { if (!done) { done = true; resolve('no frame within 2s'); } }, 2000);
        session.requestAnimationFrame((time, frame) => {
          if (done) return;
          done = true; clearTimeout(t);
          try {
            const e = frame.getLightEstimate(probe);
            if (!e) return resolve('getLightEstimate returned null');
            const d = e.primaryLightDirection, i = e.primaryLightIntensity;
            resolve({
              direction: d ? [+d.x.toFixed(3), +d.y.toFixed(3), +d.z.toFixed(3)] : null,
              intensity: i ? [+i.x.toFixed(3), +i.y.toFixed(3), +i.z.toFixed(3)] : null,
              sphericalHarmonics: e.sphericalHarmonicsCoefficients
                ? e.sphericalHarmonicsCoefficients.length : null,
            });
          } catch (err) { resolve('getLightEstimate threw: ' + err.message); }
        });
      });
    } catch (err) {
      out.error = 'requestLightProbe rejected: ' + err.message
        + (out.requested === false ? "  (expected — 'light-estimation' is not in the session's optionalFeatures yet)" : '');
    }
  }

  console.log('probeXRLighting:', out);
  if (window.screenLog) window.screenLog('lightProbe: ' + (out.probe || out.error), 'cyan');
  return out;
}
