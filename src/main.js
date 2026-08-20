import '@fortawesome/fontawesome-free/css/all.min.css';
import SculptGL from './SculptGL.js';
import { installFontReadyRepaint } from './gui/htmlvr/fontReady.js';
import { VERSION } from './Version.js';
import './misc/whyNoPick.js'; // registers window._whyNoPick()

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
let _updateDismissed = false;
function showUpdateBanner(deployed) {
  if (_updateDismissed) return;                          // user dismissed this session
  if (document.getElementById('sxr-update-banner')) return;
  // Small pill, bottom-centre — out of the way of the topbar + right sidebar so it never
  // blocks mid-flow actions (save, menus). Manual + dismissible; never auto-reloads.
  const bar = document.createElement('div');
  bar.id = 'sxr-update-banner';
  bar.style.cssText =
    'position:fixed;bottom:14px;left:50%;transform:translateX(-50%);z-index:99999;' +
    'display:flex;align-items:center;gap:10px;padding:7px 12px;border-radius:9px;' +
    'background:rgba(30,30,46,0.94);color:#cdd6f4;font:500 12px sans-serif;' +
    'box-shadow:0 4px 14px rgba(0,0,0,0.45);max-width:92vw;pointer-events:auto;';
  const msg = document.createElement('span');
  msg.textContent = `New version ${deployed} available`;
  const reload = document.createElement('button');
  reload.textContent = 'Reload';
  reload.style.cssText = 'padding:3px 10px;border:none;border-radius:5px;background:#89b4fa;' +
    'color:#11111b;font:600 12px sans-serif;cursor:pointer;';
  // Confirm first (accidental click); cache-bust the URL so a fresh index.html is served.
  reload.addEventListener('click', () => {
    if (!window.confirm('Reload to update? Any unsaved changes will be lost.')) return;
    location.href = location.pathname + '?v=' + encodeURIComponent(deployed);
  });
  const dismiss = document.createElement('button');
  dismiss.textContent = 'Dismiss';
  dismiss.style.cssText = 'padding:3px 8px;border:none;border-radius:5px;background:transparent;' +
    'color:#a6adc8;font:500 12px sans-serif;cursor:pointer;';
  dismiss.addEventListener('click', () => { _updateDismissed = true; bar.remove(); });
  bar.appendChild(msg); bar.appendChild(reload); bar.appendChild(dismiss);
  document.body.appendChild(bar);
}

async function checkBuildVersion() {
  try {
    const r = await fetch('version.json?ts=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return;
    const deployed = ((await r.json()).version || '').trim();
    const loaded = (VERSION || '').trim();
    window._deployedVersion = deployed; // so _whyNoPick() can report it without a fetch
    if (deployed && loaded && deployed !== loaded) {
      showUpdateBanner(deployed);
      // The banner is a DOM element, and there is no DOM in an immersive session — so in the
      // headset, the one place a stale build is hardest to diagnose, it says nothing at all.
      // screenLog is the channel that survives into VR.
      if (window.screenLog) window.screenLog('Stale build: running ' + loaded + ', ' + deployed + ' is live', '#f9e2af');
    }
  } catch (_) { /* offline / no version.json — ignore */ }
}

checkBuildVersion();
// Re-check periodically so a long-running session notices a deploy.
setInterval(checkBuildVersion, 5 * 60 * 1000);
