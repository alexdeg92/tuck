export function serviceWorker(build, assets) {
  return `const BUILD = ${JSON.stringify(build)};
const CACHE = 'tuck-shell-' + BUILD;
const ASSETS = ${JSON.stringify(assets)};
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  // Retain older shells: a client deferring refresh may still need its lazy chunks.
  event.waitUntil(self.clients.claim());
});
self.addEventListener('message', event => {
  if (event.data === 'BUILD') event.ports[0]?.postMessage(BUILD);
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname === '/api' || url.pathname.startsWith('/api/') || event.request.method !== 'GET') return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.open(CACHE).then(cache => cache.match('/index.html'))));
  } else if (ASSETS.includes(url.pathname) || url.pathname.startsWith('/assets/')) {
    event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(url.pathname)) || (url.pathname.startsWith('/assets/') && await caches.match(event.request)) || fetch(event.request)));
  }
});`;
}
