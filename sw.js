// Offline support. Bump VERSION when you publish changes so phones pick up the new files.
const VERSION = 'map-mobile-v1';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'fonts.mjs', 'map-engine.mjs', 'map-places.mjs', 'map-video-export.mjs',
  'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'map-data/countries-50m.json', 'map-data/countries-110m.json'];

self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return; // fonts etc. go straight to the network
  const heavy = url.pathname.includes('/map-data/') || /icon-\d+\.png$/.test(url.pathname);
  if (heavy) { // big static files: cache first
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => { const copy = r.clone(); caches.open(VERSION).then(c => c.put(req, copy)); return r; })));
    return;
  }
  e.respondWith(fetch(req).then(r => { const copy = r.clone(); caches.open(VERSION).then(c => c.put(req, copy)); return r; }).catch(() => caches.match(req).then(hit => hit || caches.match('index.html'))));
});
