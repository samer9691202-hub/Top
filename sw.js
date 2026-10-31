/* LUBB v61 — versioned, update-safe offline cache */
const CACHE_PREFIX = 'lubb-v61-';
const CACHE = CACHE_PREFIX + 'core';
const BASE = self.registration.scope;
const CORE_FILES = [
  './', './index.html', './manifest.webmanifest', './sw.js',
  './icons/icon-192.png', './icons/icon-512.png',
  './icons/icon-maskable-512.png', './icons/lubb-logo-original.png',
  './icons/lubb-logo-2048.png', './icons/lubb-logo.svg'
].map(path => new URL(path, BASE).toString());

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(CORE_FILES);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => (key.startsWith('lubb-') || key.startsWith('nexora-')) && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Always check the network first for navigations so deployed updates are seen promptly.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request, {cache:'no-store'});
        if (response && response.ok) {
          const cache = await caches.open(CACHE);
          await cache.put(new URL('./index.html', BASE).toString(), response.clone());
        }
        return response;
      } catch (_) {
        return (await caches.match(request)) || (await caches.match(new URL('./index.html', BASE).toString()));
      }
    })());
    return;
  }

  // Cache-first for local static assets, with network fallback and cache refresh.
  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response && response.ok) {
        const cache = await caches.open(CACHE);
        await cache.put(request, response.clone());
      }
      return response;
    } catch (_) {
      return new Response('غير متاح دون اتصال', {status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});
    }
  })());
});
