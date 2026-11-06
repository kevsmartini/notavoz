// Whisper corre aquí, en segundo plano (Web Worker)
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3';

let asr = null;

// Siempre CPU (WASM, cuantizado q8). WebGPU en móvil se colgaba en algunos
// navegadores (p. ej. Brave en Android), así que no lo usamos.
// threads > 1 solo funciona si la página está aislada (crossOriginIsolated);
// el número de hilos no se puede cambiar después: para cambiarlo hay que crear otro worker.
async function load(model, threads) {
  env.backends.onnx.wasm.numThreads = threads;
  asr = await pipeline('automatic-speech-recognition', 'onnx-community/' + model, {
    device: 'wasm', dtype: 'q8',
    progress_callback: p => postMessage({ type: 'progress', data: p })
  });
  // Calentamiento: la primera transcripción tarda unos segundos más porque el motor
  // prepara sus cálculos. La hacemos ya, con 1 s de silencio, para que la primera
  // nota real vaya igual de rápida que las demás. El resultado se descarta.
  postMessage({ type: 'warming' });
  try { await asr(new Float32Array(16000), { language: 'spanish', task: 'transcribe' }); } catch (e) {}
  postMessage({ type: 'ready', model, threads });
}

function fail(err) {
  postMessage({ type: 'error', message: String((err && err.message) || err) });
}
// Errores que escapan a los try/catch: que no se pierdan en silencio
self.addEventListener('unhandledrejection', e => fail(e.reason));

self.onmessage = async (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'load') await load(msg.model, msg.threads);
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
