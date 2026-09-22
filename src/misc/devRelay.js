/**
 * The page half of the dev relay -- see tools/dev-relay-plugin.mjs for why it exists.
 *
 * Imported from main.js behind import.meta.env.DEV, so it is tree-shaken out of a build
 * entirely. Nothing here may throw into the app: a broken relay must cost a silent catch, never
 * a frame.
 */
const ENDPOINT = '/__relay';
const FLUSH_MS = 400;
const POLL_MS = 1200;

// A NAME PLUS A FINGERPRINT. The names alone collide: a GalaxyXR reports "X11; Linux x86_64"
// and a Vision Pro reports "Macintosh; Intel Mac OS X 10_15_7", so guessing from the UA put
// three different devices in one log file. The suffix guarantees they separate whatever the
// guess does.
function deviceLabel() {
  const ua = navigator.userAgent;
  const xr = 'xr' in navigator;
  let name = 'desktop';
  if (/Macintosh/.test(ua) && xr && !/Chrome/i.test(ua)) name = 'visionpro';
  else if (/iPad|iPhone/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) name = 'ipad';
  else if (/Android|Quest|X11/i.test(ua) && xr) name = 'headset';
  let h = 0;
  for (let i = 0; i < ua.length; i++) h = (h * 31 + ua.charCodeAt(i)) >>> 0;
  return name + '-' + h.toString(36).slice(0, 4);
}

export function installDevRelay() {
  if (typeof window === 'undefined' || window.__devRelay) return;
  const device = deviceLabel();
  window.__devRelay = { device };

  // CONSOLE MIRRORED, NOT REPLACED: the original still runs, so Safari's own inspector keeps
  // working for whoever is actually wearing the thing.
  let buf = [];
  const stamp = () => new Date().toISOString().slice(11, 23);
  for (const level of ['log', 'info', 'warn', 'error']) {
    const orig = console[level].bind(console);
    console[level] = (...args) => {
      try {
        buf.push(stamp() + ' [' + level + '] ' + args.map((a) => {
          if (typeof a === 'string') return a;
          try { return JSON.stringify(a); } catch (e) { return String(a); }
        }).join(' '));
        if (buf.length > 400) buf = buf.slice(-400);   // a compile burst must not eat memory
      } catch (e) { /* never break a log call */ }
      orig(...args);
    };
  }
  window.addEventListener('error', (e) => { try { buf.push(stamp() + ' [uncaught] ' + e.message); } catch (x) {} });

  const post = (path, body) => {
    try { fetch(ENDPOINT + path, { method: 'POST', body: JSON.stringify(body) }).catch(() => {}); }
    catch (e) { /* offline is not an error here */ }
  };
  setInterval(() => { if (buf.length) { const lines = buf; buf = []; post('/log', { device, lines }); } }, FLUSH_MS);

  // THE HALF THAT ACTUALLY SAVES THE ROUND TRIPS. A pending expression is fetched, evaluated
  // and answered -- so a question can be asked of a headset nobody is holding.
  let lastId = null;
  setInterval(async () => {
    let cmd = null;
    try {
      const r = await fetch(ENDPOINT + '/cmd', { cache: 'no-store' });
      if (r.status !== 200) return;
      cmd = await r.json();
    } catch (e) { return; }
    if (!cmd || cmd.id === lastId) return;
    lastId = cmd.id;
    let result;
    try {
      const v = await (0, eval)(cmd.expr);
      result = typeof v === 'string' ? v : JSON.stringify(v);
    } catch (e) { result = 'THREW: ' + (e && e.message ? e.message : String(e)); }
    post('/cmd', { id: cmd.id, device, result: result === undefined ? 'undefined' : result });
  }, POLL_MS);

  console.log('[devRelay] ' + device + ' reporting to the dev server');
}
