const CACHE_PREFIX = 'wallet-by-pina-shell-';
const RELEASE_HASH = '__RELEASE_HASH__';
const CACHE_NAME = `${CACHE_PREFIX}${RELEASE_HASH}`;
const SHELL_FILES = ['/', '/app.js', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'];
const NETWORK_FIRST_FILES = new Set(SHELL_FILES);

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_FILES)));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  const isNavigation = request.mode === 'navigate';
  const isShellFile = NETWORK_FIRST_FILES.has(url.pathname);
  if (!isNavigation && !isShellFile) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(request);
      if (response.ok) {
        const cacheKey = isNavigation ? '/' : request;
        await cache.put(cacheKey, response.clone());
      }
      return response;
    } catch {
      const cached = await cache.match(isNavigation ? '/' : request);
      if (cached) return cached;
      if (isNavigation) return new Response('Aplikasi belum tersedia offline. Buka Wallet BY pina saat tersambung ke internet terlebih dahulu.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      return Response.error();
    }
  })());
});
