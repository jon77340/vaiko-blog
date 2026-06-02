/* ===========================================
   VAÏKO - Service Worker
   Cache offline pour assurer la consultation
   même avec un réseau capricieux (Norvège).
   =========================================== */

const VERSION = 'vaiko-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js'
];

// Installation : on précache les assets statiques
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(VERSION).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Activation : on supprime les anciens caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Stratégie :
// - Pour les JSON (contenu dynamique) : network-first, fallback cache
// - Pour le reste (HTML, CSS, JS, images) : cache-first, fallback réseau
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Ignorer les requêtes externes (Leaflet tiles, fonts, etc.)
  if (url.origin !== location.origin) return;

  // JSON : network-first
  if (url.pathname.includes('/content/') && url.pathname.endsWith('.json')) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(VERSION).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Reste : cache-first
  e.respondWith(
    caches.match(e.request).then(cached => {
      return cached || fetch(e.request).then(res => {
        // On cache les médias qu'on rencontre
        if (res.ok && (url.pathname.includes('/images/') || url.pathname.includes('/media/'))) {
          const clone = res.clone();
          caches.open(VERSION).then(c => c.put(e.request, clone));
        }
        return res;
      });
    })
  );
});
