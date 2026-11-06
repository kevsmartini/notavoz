# notavoz

Notas por voz para el móvil, **100 % en el dispositivo**. Transcribe con Whisper en el propio teléfono (transformers.js 3.8.1, CPU/WASM con 4 hilos).

## Privacidad

- **Tu voz y tus notas no salen del móvil.** El audio solo vive en memoria mientras se transcribe; las notas se guardan en el navegador (`localStorage`).
- **Sin terceros.** La librería (`vendor/`) y los modelos (`models/`) se sirven desde esta misma web, con versión fija. No se usa ningún CDN ni Hugging Face.
- **El navegador lo impide.** Una Content-Security-Policy (`connect-src 'self'`) prohíbe a la página y al worker conectarse a cualquier otro sitio.
- **Cero conexiones al abrirla.** El service worker sirve todo desde la caché; solo se actualiza al pulsar *Buscar actualización* en ⚙. (El navegador puede comprobar por su cuenta si `sw.js` cambió; eso no envía datos.)
- **Sin dictado de terceros.** No se usa el dictado del navegador (en Chrome envía el audio a Google).

## Estructura

- `index.html`, `styles.css`, `detect.js` (solo móvil), `app.js`, `worker.js` (Whisper)
- `sw.js`: caché sin conexión + cabeceras CSP/COOP/COEP (GitHub Pages no permite configurarlas)
- `vendor/transformers-3.8.1/`: transformers.js y ONNX Runtime (Apache-2.0)
- `models/onnx-community/whisper-{base,tiny}/`: modelos q8 ([onnx-community](https://huggingface.co/onnx-community), MIT)

## Uso

Servir por HTTPS (GitHub Pages) y abrir en el móvil → "Añadir a pantalla de inicio".
En local: `python3 -m http.server` y abrir `http://localhost:8000` con el modo dispositivo.

Al cambiar archivos de la app, sube `VERSION` en `sw.js`.
