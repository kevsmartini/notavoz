// Service worker de notavoz.
// - La app y la librería de Whisper se sirven SIEMPRE desde la caché del móvil:
//   abrir la app no hace ninguna petición. Solo se actualiza al pulsar
//   "Buscar actualización" en ⚙ (o cuando el navegador comprueba por su cuenta si
//   este archivo sw.js ha cambiado; eso no envía ningún dato tuyo).
// - Los modelos (models/) no pasan por aquí: transformers.js los guarda en su propia caché.
// - Añade a la app las cabeceras de seguridad:
//     · CSP: el navegador prohíbe a la app conectarse a cualquier sitio que no sea esta web.
//     · COOP/COEP: la página queda "aislada" y Whisper puede usar varios núcleos.
//   GitHub Pages no deja configurar cabeceras, por eso las pone el service worker.
// Sube VERSION cuando cambies archivos de la app.
const VERSION = 'v7';
const APP = 'notavoz-app-' + VERSION;
const VENDOR = 'notavoz-vendor-3.8.1'; // solo cambia si cambia la versión de la librería
const SHELL = [
  './', './index.html', './styles.css', './detect.js', './app.js', './worker.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png', './icons/apple-touch-icon.png'
];
const VENDOR_FILES = [
  './vendor/transformers-3.8.1/transformers.min.js',
  './vendor/transformers-3.8.1/ort-wasm-simd-threaded.jsep.mjs',
  './vendor/transformers-3.8.1/ort-wasm-simd-threaded.jsep.wasm'
];

// Misma política que la etiqueta <meta> de index.html (aquí cubre también al worker)
const CSP = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self'; " +
  "connect-src 'self' blob:; worker-src 'self' blob:; manifest-src 'self'; media-src 'self' blob:; " +
  "object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const fresh = u => new Request(u, { cache: 'reload' }); // sin pasar por la caché HTTP

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    await (await caches.open(APP)).addAll(SHELL.map(fresh));
    const vendor = await caches.open(VENDOR);
    for (const u of VENDOR_FILES) if (!await vendor.match(u)) await vendor.add(fresh(u));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys())
      if (k.startsWith('notavoz-') && k !== APP && k !== VENDOR) await caches.delete(k);
    await self.clients.claim();
  })());
});

function withHeaders(res) {
  if (!res || res.status === 0) return res;
  const h = new Headers(res.headers);
  h.set('Content-Security-Policy', CSP);
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Cross-Origin-Embedder-Policy', 'require-corp');
  h.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

// Primero la caché; solo si falta algo se pide a la red (y se guarda)
async function cacheFirst(req, key) {
  const hit = await caches.match(key);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok) (await caches.open(APP)).put(key, res.clone());
    return res;
  } catch (e) {
    return Response.error();
  }
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;              // la CSP ya lo bloquea
  if (url.pathname.includes('/models/')) return;            // lo cachea transformers.js
  const key = req.mode === 'navigate' ? './index.html' : req;
  e.respondWith(cacheFirst(req, key).then(withHeaders));
});
