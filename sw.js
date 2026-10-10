/* Service worker: makes the app work offline after the first load.
   - app shell (page, manifest, icons): cache-first, precached on install
   - Google Fonts (CSS + font files): stale-while-revalidate at runtime
   - Pyodide from cdn.jsdelivr.net (runs ballot.py for "Vyfotit lístek", ~65 MB): cache-first once
     downloaded – the URLs carry the version, so photo recognition works offline after its first use
   Bump VERSION whenever index.html or the icons change, so phones pick up the new version. */
'use strict';
const VERSION = 'v8';
const SHELL_CACHE = `scitani-shell-${VERSION}`;
const FONT_CACHE = `scitani-fonts-${VERSION}`;
const PYODIDE_CACHE = 'scitani-pyodide-v0.26.4'; // not tied to VERSION: kept across app updates
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
const PYODIDE_PREFIX = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/';

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  const keep = new Set([SHELL_CACHE, FONT_CACHE, PYODIDE_CACHE]);
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('scitani-') && !keep.has(k)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function shellFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(request, { ignoreSearch: true });
  if (hit) return hit;
  try {
    const res = await fetch(request);
    if (res.ok && request.method === 'GET') cache.put(request, res.clone());
    return res;
  } catch (err) {
    // offline and not cached: for page loads fall back to the app itself
    if (request.mode === 'navigate') {
      const page = await cache.match('./index.html') || await cache.match('./');
      if (page) return page;
    }
    throw err;
  }
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(FONT_CACHE);
  const hit = await cache.match(event.request);
  const update = fetch(event.request)
    .then(res => {
      // opaque (no-cors) responses have status 0 but are still usable
      if (res.ok || res.type === 'opaque') return cache.put(event.request, res.clone()).then(() => res);
      return res;
    })
    .catch(() => hit);
  if (hit) {
    event.waitUntil(update.catch(() => {}));
    return hit;
  }
  return update.then(res => res || Response.error());
}

async function cacheFirst(request, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (FONT_HOSTS.includes(url.hostname)) { event.respondWith(staleWhileRevalidate(event)); return; }
  if (req.url.startsWith(PYODIDE_PREFIX)) { event.respondWith(cacheFirst(req, PYODIDE_CACHE)); return; }
  if (url.origin === self.location.origin) event.respondWith(shellFirst(req));
});
