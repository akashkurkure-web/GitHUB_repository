'use strict';
// Service worker: makes Bazaario installable as an app (Android, Windows, macOS) and keeps the
// storefront shell available on a flaky connection. API responses are never cached: prices,
// stock, carts and orders always come live from the server.
const VERSION = 'bazaario-v2';
const SHELL = ['/', '/styles.css', '/app.js', '/favicon.svg', '/manifest.webmanifest', '/offline.html',
  '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // Pages: always try the network first so a deploy shows up at once; offline page as a fallback.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('/offline.html')));
    return;
  }

  // Static files (styles, script, fonts, icons): serve from cache, refresh in the background.
  event.respondWith(caches.open(VERSION).then(async (cache) => {
    const cached = await cache.match(req);
    const fresh = fetch(req).then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    });
    if (cached) { fresh.catch(() => {}); return cached; }
    return fresh;
  }));
});
