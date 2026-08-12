const CACHE_NAME = 'thai-boran-waiver-v8';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './shared.css',
  './app.js',
  './config.js',
  './shared.js',
  './sync.js',
  './printdoc.js',
  './backoffice.js',
  './manifest.json',

  './reception/',
  './reception/index.html',
  './reception/reception.js',

  './manager/',
  './manager/index.html',
  './manager/manager.js',

  './assets/thai_boran_logo.png',
  './assets/oval_frame.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Never intercept API traffic: the back office is online-first and must
  // see live data (and real failures) — not stale cached responses.
  if (url.pathname.startsWith('/api/') || url.pathname.includes('/api/')) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((resp) => {
        // Cache same-origin GET requests
        try {
          if (url.origin === self.location.origin && req.method === 'GET') {
            const copy = resp.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
        } catch (_) {}
        return resp;
      }).catch(() => cached);
    })
  );
});
