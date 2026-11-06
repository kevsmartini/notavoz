// Whisper corre aquí, en segundo plano (Web Worker)
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3';

let asr = null;

// Por defecto todo en CPU (WASM, cuantizado q8).
// Con gpu = true (experimental) es híbrido: el codificador, que es la parte pesada
// (procesa siempre 30 s de audio), va en la gráfica en fp32; el decodificador sigue
// en CPU en q8. El decodificador q4 en WebGPU se colgaba en móvil, por eso no se usa.
// threads > 1 solo funciona si la página está aislada (crossOriginIsolated);
// el número de hilos no se puede cambiar después: para cambiarlo hay que crear otro worker.
async function load(model, threads, gpu) {
  env.backends.onnx.wasm.numThreads = threads;
  if (gpu && !(navigator.gpu && await navigator.gpu.requestAdapter())) {
    throw new Error('WebGPU no está disponible en este navegador');
  }
  const engine = gpu
    ? { device: { encoder_model: 'webgpu', decoder_model_merged: 'wasm' },
        dtype:  { encoder_model: 'fp32',   decoder_model_merged: 'q8' } }
    : { device: 'wasm', dtype: 'q8' };
  asr = await pipeline('automatic-speech-recognition', 'onnx-community/' + model, {
    ...engine,
    progress_callback: p => postMessage({ type: 'progress', data: p })
  });
  // Calentamiento: la primera transcripción tarda unos segundos más porque el motor
  // prepara sus cálculos. La hacemos ya, con 1 s de silencio, para que la primera
  // nota real vaya igual de rápida que las demás. El resultado se descarta.
  postMessage({ type: 'warming' });
  try { await asr(new Float32Array(16000), { language: 'spanish', task: 'transcribe' }); } catch (e) {}
  postMessage({ type: 'ready', model, threads, gpu });
}

function fail(err) {
  postMessage({ type: 'error', message: String((err && err.message) || err) });
}
// Errores que escapan a los try/catch: que no se pierdan en silencio
self.addEventListener('unhandledrejection', e => fail(e.reason));

self.onmessage = async (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'load') await load(msg.model, msg.threads, msg.gpu);
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
