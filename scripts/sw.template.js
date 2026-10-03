// SculptXR service worker. Generated into dist/sw.js by scripts/gen-sw.mjs (which fills in
// VERSION and PRECACHE); never loaded in dev.
//
// index.html / version.json go network-first so a deploy is seen immediately (the stale-build
// banner in main.js depends on it); every other same-origin GET is cache-first, which is safe
// because Vite's bundle names are content-hashed and a new VERSION gets a new cache.
const VERSION = '__VERSION__';
const CACHE = 'sxr-' + VERSION;
const PRECACHE = __PRECACHE__;

self.addEventListener('install', e => {
  // Take over at once: a waiting worker would keep serving the old unhashed files (workers,
  // yagui.css) under a freshly fetched index.html.
  self.skipWaiting();
  // Best-effort per file: one 404 must not leave the app uninstallable.
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(PRECACHE.map(u => c.add(u).catch(() => {})))));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('sxr-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (req.headers.has('range')) return; // cache.match ignores Range; let the network answer
  const fresh = req.mode === 'navigate' || url.pathname.endsWith('/version.json');
  e.respondWith(fresh ? networkFirst(req) : cacheFirst(req));
});

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (res.ok && req.mode === 'navigate') (await caches.open(CACHE)).put(req, res.clone());
    return res;
  } catch (err) {
    // ignoreSearch: the update banner reloads with ?v=
    return (await caches.match(req, { ignoreSearch: true })) || (await caches.match('./')) || Promise.reject(err);
  }
}

async function cacheFirst(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
  return res;
}
