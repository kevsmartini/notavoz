// Service worker de notavoz: permite abrir la app sin conexión.
// - La app (HTML, worker, iconos) se sirve desde caché y se actualiza en segundo plano.
// - La librería de transformers.js y el motor ONNX (cdn.jsdelivr.net) se cachean al usarlos.
// - El modelo de Hugging Face NO pasa por aquí: transformers.js ya lo guarda en su propia caché.
// Sube VERSION cuando cambies archivos de la app para limpiar cachés viejas.
const VERSION = 'v1';
const APP = 'notavoz-app-' + VERSION;
const LIBS = 'notavoz-libs-' + VERSION;
const SHELL = [
  './', './index.html', './worker.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png', './icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(APP).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for(const k of await caches.keys())
      if(k.startsWith('notavoz-') && k !== APP && k !== LIBS) await caches.delete(k);
    await self.clients.claim();
  })());
});

// Responde con la caché al momento y la refresca con la red cuando la haya
async function staleWhileRevalidate(req, cacheName, cacheKey = req){
  const cache = await caches.open(cacheName);
  const hit = await cache.match(cacheKey);
  const net = fetch(req).then(res => {
    if(res.ok) cache.put(cacheKey, res.clone());
    return res;
  }).catch(() => null);
  return hit || (await net) || Response.error();
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);

  if(url.origin === location.origin){
    // Cualquier navegación dentro de la app cae en index.html
    const key = req.mode === 'navigate' ? './index.html' : req;
    e.respondWith(staleWhileRevalidate(req, APP, key));
    return;
  }
  if(url.hostname === 'cdn.jsdelivr.net'){
    e.respondWith(staleWhileRevalidate(req, LIBS));
  }
  // Lo demás (huggingface.co, etc.) va directo a la red
});
