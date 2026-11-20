// Service worker : l'interface reste disponible sans connexion (les données, elles, viennent toujours du serveur).
const V = 'rt-v1.1.0';
const SHELL = ['./', './index.html', './config.js', './app.css', './icon.svg', './manifest.webmanifest', './js/app.js', './js/core.js', './js/icons.js', './js/menu.js', './js/print.js', './js/crudpage.js',
  './js/pages/accueil.js', './js/pages/hebergement.js', './js/pages/ventes.js', './js/pages/stocks.js', './js/pages/catalogue.js', './js/pages/finances.js', './js/pages/autres.js', './js/pages/admin.js'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== V).map((x) => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  // Réseau d'abord (toujours la dernière version), cache si pas de connexion
  e.respondWith(fetch(e.request).then((r) => { const copie = r.clone(); caches.open(V).then((c) => c.put(e.request, copie)); return r; })
    .catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html'))));
});
