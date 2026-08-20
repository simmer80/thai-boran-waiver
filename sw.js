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

const BUILD = '2026.08.20-08';
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

// How requests are answered.
//
// PAGES are network-first: if the iPad has WiFi it always gets the current
// screen, so a stale shell can never survive a launch. This is what went
// wrong before — everything was cache-first, so an old page could be served
// for as long as its worker stayed put, and reinstalling did not obviously
// help. Offline it falls straight back to the cached copy, so the waiver
// form keeps working with no connection.
//
// EVERYTHING ELSE is stale-while-revalidate: answered instantly from cache,
// refreshed in the background. Fast to launch, and never more than one
// launch behind even if the worker itself is somehow stuck.
const NAV_TIMEOUT_MS = 3000;

async function networkFirst(req, cache) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NAV_TIMEOUT_MS);
  try {
    const fresh = await fetch(req, { signal: controller.signal });
    clearTimeout(timer);
    if (fresh && fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch (_) {
    clearTimeout(timer);
    const cached = await cache.match(req);
    if (cached) return cached;
    // A page never visited, with no connection: the app shell is the
    // closest useful answer.
    return (await cache.match('./index.html')) || Response.error();
  }
}

async function staleWhileRevalidate(req, cache) {
  const cached = await cache.match(req);
  const network = fetch(req).then((resp) => {
    if (resp && resp.ok) cache.put(req, resp.clone());
    return resp;
  }).catch(() => null);
  return cached || (await network) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Never intercept API traffic: the back office is online-first and must
  // see live data (and real failures) — not stale cached responses.
  if (url.pathname.startsWith('/api/') || url.pathname.includes('/api/')) return;
  // Nor anything on another host.
  if (url.origin !== self.location.origin) return;
  // The worker script itself must always come from the network, or a new
  // build could never be discovered.
  if (url.pathname.endsWith('/sw.js')) return;

  const isPage = req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    return isPage ? networkFirst(req, cache) : staleWhileRevalidate(req, cache);
  })());
});