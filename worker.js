// Whisper corre aquí, en segundo plano (Web Worker)
import { pipeline } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3';

const MODEL = 'onnx-community/whisper-base';
let asr = null;

// Siempre CPU (WASM, cuantizado q8). WebGPU en móvil se colgaba en algunos
// navegadores (p. ej. Brave en Android), así que no lo usamos.
async function load() {
  asr = await pipeline('automatic-speech-recognition', MODEL, {
    device: 'wasm', dtype: 'q8',
    progress_callback: p => postMessage({ type: 'progress', data: p })
  });
  postMessage({ type: 'ready', device: 'wasm', isolated: self.crossOriginIsolated === true });
}

function fail(err) {
  postMessage({ type: 'error', message: String((err && err.message) || err) });
}
// Errores que escapan a los try/catch: que no se pierdan en silencio
self.addEventListener('unhandledrejection', e => fail(e.reason));

self.onmessage = async (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'load') await load();
    if (msg.type === 'transcribe') {
      const out = await asr(msg.audio, {
        language: 'spanish', task: 'transcribe',
        chunk_length_s: 30, stride_length_s: 5
      });
      postMessage({ type: 'result', text: (out.text || '').trim() });
    }
  } catch (err) {
    fail(err);
  }
};
