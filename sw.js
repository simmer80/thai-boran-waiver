// Service worker: offline shell + the one-tap update mechanism.
//
// BUILD is the single place a release is stamped. Bump it, push, and every
// iPad offers "Update available — tap to update" within the hour; one tap
// installs and reloads onto the new version. Nobody deletes an icon or
// reinstalls anything.
//
// The update is DELIBERATE, not automatic: a new worker installs in the
// background and then WAITS. It only takes over when the page tells it to
// (the TB_SKIP_WAITING message), which is what lets the app check for
// half-finished work first and let the receptionist finish the client in
// front of her before anything reloads.
//
// Nothing here ever touches IndexedDB, so captured waivers and anything not
// yet synced survive an update untouched — only the cached app files change.

const BUILD = '2026.08.20-02';
const CACHE_NAME = 'thai-boran-waiver-' + BUILD;

// The app cannot work offline without these, so a failure to cache them
// fails the install and the old version keeps running.
const CORE = [
  './',
  './index.html',
  './styles.css',
  './shared.css',
  './app.js',
  './config.js',
  './shared.js',
  './sync.js',
  './update.js',
  './manifest.json',
];

// Everything else: cached best-effort. One missing file must never leave the
// staff stuck on an old build with no way forward.
const EXTRAS = [
  './printdoc.js',
  './docfit.js',
  './sigpad.js',
  './idlelock.js',
  './records.js',
  './backoffice.js',

  './reception/',
  './reception/index.html',
  './reception/reception.js',

  './records/',
  './records/index.html',

  './manager/',
  './manager/index.html',
  './manager/manager.js',

  './assets/thai_boran_logo.png',
  './assets/oval_frame.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(CORE);
    await Promise.all(EXTRAS.map((url) => cache.add(url).catch(() => {})));
    // NOTE: no skipWaiting here on purpose — see the header comment.
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// The page drives the update and asks which version is running.
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'TB_SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (data.type === 'TB_VERSION') {
    const reply = { type: 'TB_VERSION', version: BUILD };
    if (event.ports && event.ports[0]) event.ports[0].postMessage(reply);
    else if (event.source) event.source.postMessage(reply);
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Never intercept API traffic: the back office is online-first and must
  // see live data (and real failures) — not stale cached responses.
  if (url.pathname.startsWith('/api/') || url.pathname.includes('/api/')) return;

  // The worker script itself must always come from the network, or a new
  // build could never be discovered.
  if (url.pathname.endsWith('/sw.js')) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((resp) => {
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
