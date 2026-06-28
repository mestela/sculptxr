import '@fortawesome/fontawesome-free/css/all.min.css';
import SculptGL from './SculptGL.js';
import { installFontReadyRepaint } from './gui/htmlvr/fontReady.js';
import { VERSION } from './Version.js';

window.SculptGL = SculptGL;

// Re-rasterise panels once the FontAwesome web-font is loaded so icons don't
// intermittently bake blank on a cold load.
installFontReadyRepaint();

// ── Stale-build detection ────────────────────────────────────────────────────
// The deploy writes /version.json with the live version; VERSION is baked into the
// build. If a cached index.html (→ old hashed JS) is being served, the two differ —
// show a banner prompting a reload. (This only helps once a user is on a build that
// CONTAINS this check; a one-off hard refresh is still needed to escape an older
// cached build. The proper root fix is no-cache headers on index.html / version.json.)
function showUpdateBanner(deployed) {
  if (document.getElementById('sxr-update-banner')) return;
  const bar = document.createElement('div');
  bar.id = 'sxr-update-banner';
  bar.style.cssText =
    'position:fixed;top:0;left:0;right:0;z-index:99999;display:flex;align-items:center;' +
    'justify-content:center;gap:12px;padding:8px 12px;background:#89b4fa;color:#11111b;' +
    'font:600 13px sans-serif;box-shadow:0 2px 8px rgba(0,0,0,0.4);';
  const msg = document.createElement('span');
  msg.textContent = `New version ${deployed} available (you have ${VERSION}).`;
  const btn = document.createElement('button');
  btn.textContent = 'Reload';
  btn.style.cssText = 'padding:4px 12px;border:none;border-radius:4px;background:#1e1e2e;' +
    'color:#cdd6f4;font:600 13px sans-serif;cursor:pointer;';
  // Cache-bust the URL so the host serves a fresh index.html.
  btn.addEventListener('click', () => {
    location.href = location.pathname + '?v=' + encodeURIComponent(deployed);
  });
  bar.appendChild(msg); bar.appendChild(btn);
  document.body.appendChild(bar);
}

async function checkBuildVersion() {
  try {
    const r = await fetch('version.json?ts=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return;
    const deployed = ((await r.json()).version || '').trim();
    const loaded = (VERSION || '').trim();
    if (deployed && loaded && deployed !== loaded) showUpdateBanner(deployed);
  } catch (_) { /* offline / no version.json — ignore */ }
}

checkBuildVersion();
// Re-check periodically so a long-running session notices a deploy.
setInterval(checkBuildVersion, 5 * 60 * 1000);
