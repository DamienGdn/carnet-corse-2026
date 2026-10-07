const CACHE = 'carnet-corse-v21'; // même nom que dans index.html
const CORE = ['./', './index.html', './manifest.json', './icon.svg',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

const put = (req, res) => {
  if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
  return res;
};

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // Fichiers du site : réseau d'abord (toujours la dernière version), cache si hors ligne
  if (new URL(e.request.url).origin === location.origin) {
    e.respondWith(fetch(e.request).then(res => put(e.request, res)).catch(() => caches.match(e.request)));
    return;
  }
  // Météo : réseau d'abord (données fraîches), cache si hors ligne
  if (e.request.url.startsWith('https://api.open-meteo.com/')) {
    e.respondWith(fetch(e.request).then(res => put(e.request, res)).catch(() => caches.match(e.request)));
    return;
  }
  // Tuiles carte, photos, Leaflet : cache d'abord
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(res => put(e.request, res))));
});
