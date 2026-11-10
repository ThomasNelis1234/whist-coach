/* Whist Coach — service worker.
   App-bestanden: eerst netwerk (zodat een nieuwe deploy meteen zichtbaar is), offline uit de cache.
   Zware, onveranderlijke bestanden (model, onnxruntime, lettertypes): eerst cache. */
const SHELL = 'shell-v1';
const HEAVY = 'heavy-v1';
const SHELL_FILES = ['./', 'index.html', 'styles.css', 'engine.js', 'detector.js', 'app.js', 'manifest.webmanifest', 'icons/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== HEAVY).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isHeavy(url) {
  return (url.origin === self.location.origin && url.pathname.includes('/model/')) ||
    url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (isHeavy(url)) {
    e.respondWith(caches.open(HEAVY).then(async cache => {
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.status === 200) cache.put(req, res.clone());
      return res;
    }));
    return;
  }

  if (url.origin === self.location.origin) {
    e.respondWith(caches.open(SHELL).then(async cache => {
      try {
        const res = await fetch(req);
        if (res.status === 200) cache.put(req, res.clone());
        return res;
      } catch (err) {
        const hit = await cache.match(req, { ignoreSearch: true });
        if (hit) return hit;
        throw err;
      }
    }));
  }
});
