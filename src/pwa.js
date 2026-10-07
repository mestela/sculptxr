// PWA: register the service worker (prod only; scripts/gen-sw.mjs writes it at deploy) and
// offer "Install" where the browser supports it. Meta Browser / Pico / Chrome on Android XR
// each have their own install menu too, which works without any of this button.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  // After load + idle, so the precache never competes with the app's own startup.
  const reg = () => navigator.serviceWorker.register('sw.js').catch(e => console.warn('[pwa] sw register failed', e));
  const idle = () => (window.requestIdleCallback ? requestIdleCallback(reg, { timeout: 10000 }) : setTimeout(reg, 3000));
  document.readyState === 'complete' ? idle() : addEventListener('load', idle);
}

// The install offer lives in Settings > Advanced (MainMenuPanel); window._sxrInstall is set only
// while the browser is offering one.
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  if (matchMedia('(display-mode: standalone)').matches) return;
  window._sxrInstall = async () => { e.prompt(); await e.userChoice; window._sxrInstall = null; };
});
window.addEventListener('appinstalled', () => { window._sxrInstall = null; });
