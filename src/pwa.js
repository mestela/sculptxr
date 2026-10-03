// PWA: register the service worker (prod only; scripts/gen-sw.mjs writes it at deploy) and
// offer "Install" where the browser supports it. Meta Browser / Pico / Chrome on Android XR
// each have their own install menu too, which works without any of this button.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  // After load + idle, so the precache never competes with the app's own startup.
  const reg = () => navigator.serviceWorker.register('sw.js').catch(e => console.warn('[pwa] sw register failed', e));
  const idle = () => (window.requestIdleCallback ? requestIdleCallback(reg, { timeout: 10000 }) : setTimeout(reg, 3000));
  document.readyState === 'complete' ? idle() : addEventListener('load', idle);
}

let _prompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  _prompt = e;
  if (matchMedia('(display-mode: standalone)').matches || document.getElementById('sxr-install')) return;
  const b = document.createElement('button');
  b.id = 'sxr-install';
  b.textContent = 'Install app';
  b.style.cssText = 'position:fixed;bottom:14px;right:14px;z-index:99998;padding:7px 12px;border:none;' +
    'border-radius:9px;background:#89b4fa;color:#11111b;font:600 12px sans-serif;cursor:pointer;' +
    'box-shadow:0 4px 14px rgba(0,0,0,0.45);';
  b.addEventListener('click', async () => { _prompt.prompt(); await _prompt.userChoice; b.remove(); _prompt = null; });
  document.body.appendChild(b);
});
window.addEventListener('appinstalled', () => document.getElementById('sxr-install')?.remove());
