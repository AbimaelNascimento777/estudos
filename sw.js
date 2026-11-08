// Guarda as telas do site para abrir sem internet. Os dados (Apps Script) nunca passam pelo cache.
const CACHE = 'estudos-v1';
const ARQUIVOS = ['./', 'index.html', 'app.js', 'style.css', 'manifest.json', 'icon.svg', 'demo.json'];

self.addEventListener('install', (e) => {
  // Arquivo ausente (ex.: demo.json removido) não impede o modo offline.
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(ARQUIVOS.map((f) => c.add(f).catch(() => {}))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Rede primeiro (pega atualizações); sem rede, usa o cache.
  e.respondWith(fetch(e.request).then((r) => {
    const copia = r.clone();
    caches.open(CACHE).then((c) => c.put(e.request, copia));
    return r;
  }).catch(() => caches.match(e.request)));
});
