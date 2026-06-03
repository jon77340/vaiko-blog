const VERSION = 'vaiko-v3';
const ASSETS = ['/', '/index.html', '/styles.css', '/app.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Ne cache pas les médias, JSON dynamiques et l'admin
  if (url.pathname.startsWith('/media/') ||
      url.pathname.startsWith('/content/') ||
      url.pathname.startsWith('/admin')) {
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
