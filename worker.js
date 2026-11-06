// Whisper corre aquí, en segundo plano (Web Worker)
import { pipeline } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3';

const MODEL = 'onnx-community/whisper-base';
let asr = null;

async function load() {
  const progress_callback = p => postMessage({ type: 'progress', data: p });
  let device = 'wasm';
  // 1º intenta WebGPU (gráfica del móvil); si falla, CPU (WASM)
  try {
    if (navigator.gpu && await navigator.gpu.requestAdapter()) {
      asr = await pipeline('automatic-speech-recognition', MODEL, {
        device: 'webgpu',
        dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
        progress_callback
      });
      device = 'webgpu';
    }
  } catch (e) { asr = null; }
  if (!asr) {
    asr = await pipeline('automatic-speech-recognition', MODEL, {
      device: 'wasm', dtype: 'q8', progress_callback
    });
  }
  postMessage({ type: 'ready', device });
}

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
    postMessage({ type: 'error', message: String(err && err.message || err) });
  }
};
