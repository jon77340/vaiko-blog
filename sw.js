const VERSION = 'vaiko-v4';
const ASSETS = ['/', '/index.html', '/styles.css', '/app.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS)));
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
  if (url.pathname.startsWith('/media/') || url.pathname.startsWith('/content/')) return;
  e.respondWith(caches.match(e.request).then(cached => cached || fetch(e.request)));
});

// Push notification
self.addEventListener('push', e => {
  const data = e.data?.json() ?? {};
  e.waitUntil(self.registration.showNotification(data.title || 'Vaïko 🐾', {
    body: data.body || 'Nouvelle photo !',
    icon: '/apple-touch-icon.png',
    badge: '/favicon.png',
    tag: 'vaiko-post',
    renotify: true
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window' }).then(all => {
    for (const c of all) { if (c.url.includes('vaiko') && 'focus' in c) return c.focus(); }
    return clients.openWindow('/');
  }));
});
