# notavoz

Notas por voz para el móvil. Transcribe con Whisper **en el propio dispositivo** (transformers.js, WebGPU o WASM): el audio no sale del teléfono. Mientras el modelo no está descargado usa el dictado del navegador.

- Solo para móvil: en ordenador muestra un aviso.
- Funciona sin conexión (PWA con service worker) tras el primer uso.
- Las notas se guardan en el navegador (`localStorage`).

## Uso

Hay que servirla por HTTPS (GitHub Pages, Netlify…) y abrirla en el móvil; después, "Añadir a pantalla de inicio".

En local: `python3 -m http.server` y abrir `http://localhost:8000` con el modo dispositivo de las herramientas de desarrollo.

Al cambiar archivos de la app, sube `VERSION` en `sw.js`.
