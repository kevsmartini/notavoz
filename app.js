// notavoz: app principal
document.getElementById('desktopUrl').textContent = location.href.split('#')[0];

/* ---------- Notas ---------- */
const KEY = 'notavoz.notes.v1';
const MODEL_FLAG = 'notavoz.whisper.ok';
let notes = load();
let filter = 'pending';

const $ = id => document.getElementById(id);
const input = $('input'), clearBtn = $('clear'), saveBtn = $('save'), micBtn = $('mic'), hint = $('hint'), list = $('list');

function load(){
  try{
    // La app se llamaba "Apunta": recuperamos las notas guardadas con el nombre antiguo
    if(!localStorage.getItem(KEY) && localStorage.getItem('apunta.notes.v1')){
      localStorage.setItem(KEY, localStorage.getItem('apunta.notes.v1'));
      if(localStorage.getItem('apunta.whisper.ok')) localStorage.setItem(MODEL_FLAG, localStorage.getItem('apunta.whisper.ok'));
    }
    return JSON.parse(localStorage.getItem(KEY)) || [];
  }catch(e){ return []; }
}
function persist(){ try{ localStorage.setItem(KEY, JSON.stringify(notes)); }catch(e){} }
function flag(get, val){ try{ return get ? localStorage.getItem(MODEL_FLAG) : localStorage.setItem(MODEL_FLAG, val); }catch(e){ return null; } }

function dayLabel(ts){
  const d = new Date(ts), t = new Date();
  const start = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(t) - start(d)) / 864e5);
  if(diff === 0) return 'Hoy';
  if(diff === 1) return 'Ayer';
  return d.toLocaleDateString('es-ES', {weekday:'long', day:'numeric', month:'long'});
}

function render(){
  const shown = notes.filter(n => filter === 'all' || !n.done).sort((a,b) => b.ts - a.ts);
  if(!shown.length){ list.innerHTML = `<p class="empty">${filter==='pending' ? 'Nada pendiente 👌' : 'Sin notas todavía'}</p>`; return; }
  let html = '', last = '';
  for(const n of shown){
    const lbl = dayLabel(n.ts);
    if(lbl !== last){ html += `<div class="day">${lbl}</div>`; last = lbl; }
    const time = new Date(n.ts).toLocaleTimeString('es-ES', {hour:'2-digit', minute:'2-digit'});
    html += `<div class="note ${n.done?'done':''}" data-id="${n.id}">
      <button class="chk" data-act="toggle" aria-label="Hecho"></button>
      <div class="body"><div class="text"></div><div class="time">${time}</div></div>
      <button class="del" data-act="del" aria-label="Borrar">×</button></div>`;
  }
  list.innerHTML = html;
  list.querySelectorAll('.note').forEach(el => {
    el.querySelector('.text').textContent = notes.find(n => n.id === el.dataset.id).text;
  });
}

list.addEventListener('click', e => {
  const act = e.target.dataset.act; if(!act) return;
  const id = e.target.closest('.note').dataset.id;
  if(act === 'toggle'){ const n = notes.find(n => n.id === id); n.done = !n.done; }
  if(act === 'del'){ const n = notes.find(n => n.id === id); notes = notes.filter(n => n.id !== id); showUndo(n); }
  persist(); render();
});

/* Deshacer borrado */
const toast = $('toast');
let undoNote = null, undoTimer = null;
function showUndo(n){
  undoNote = n; toast.classList.add('show');
  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => { toast.classList.remove('show'); undoNote = null; }, 5000);
}
$('undo').onclick = () => {
  if(undoNote){ notes.push(undoNote); persist(); render(); }
  undoNote = null; clearTimeout(undoTimer); toast.classList.remove('show');
};

// Pide al navegador que no borre las notas (p. ej. Safari tras 7 días sin uso)
function askPersist(){ try{ navigator.storage && navigator.storage.persist && navigator.storage.persist(); }catch(e){} }

document.querySelectorAll('.filters button').forEach(b => b.onclick = () => {
  filter = b.dataset.f;
  document.querySelectorAll('.filters button').forEach(x => x.classList.toggle('on', x === b));
  render();
});

function autosize(){
  input.style.height = 'auto'; input.style.height = input.scrollHeight + 'px';
  saveBtn.disabled = !input.value.trim();
  clearBtn.hidden = !input.value;
}
clearBtn.onclick = () => {
  input.value = '';
  autosize();
  if(state === 'idle') idleHint();
};
input.addEventListener('input', autosize);

function setHint(t){ hint.textContent = t; }
function idleHint(){ setHint(input.value.trim() ? 'Revisa y pulsa Guardar' : 'Toca para dictar'); }

function saveNote(){
  const text = input.value.trim(); if(!text) return;
  notes.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2,6), text, ts: Date.now(), done: false });
  persist(); askPersist(); input.value = ''; autosize(); render();
  setHint('Guardada ✓'); setTimeout(() => { if(state === 'idle') idleHint(); }, 1500);
}
saveBtn.onclick = saveNote;

function appendText(t){
  if(!t) return;
  input.value = (input.value.trim() + ' ' + t).trim();
  autosize();
}

/* ---------- Whisper (worker) ---------- */
let worker = null, whisperReady = false, loading = false;
let files = {}, curThreads = 1, loadWatch = null;
// Si la carga pasa 45 s sin dar señales, la damos por colgada
function watchLoad(){ clearTimeout(loadWatch); loadWatch = setTimeout(() => failWhisper('se quedó colgado al cargar'), 45000); }

const MODELS = {
  'whisper-base': { name: 'Preciso', mb: 80 },
  'whisper-tiny': { name: 'Rápido', mb: 40 }
};
function getModel(){ try{ const m = localStorage.getItem('notavoz.model'); return MODELS[m] ? m : 'whisper-base'; }catch(e){ return 'whisper-base'; } }
function setModel(m){ try{ localStorage.setItem('notavoz.model', m); }catch(e){} }
// Varios núcleos solo si la página está aislada (lo hace sw.js) y no falló antes
function threadsOff(set){ try{ return set ? localStorage.setItem('notavoz.threads', 'off') : localStorage.getItem('notavoz.threads') === 'off'; }catch(e){ return false; } }
function wantThreads(){ return (self.crossOriginIsolated && !threadsOff()) ? 4 : 1; }
// La opción de usar la gráfica se quitó (daba texto sin sentido): limpiamos su ajuste
try{ localStorage.removeItem('notavoz.gpu'); }catch(e){}
// Cierra Whisper y lo vuelve a cargar con los ajustes actuales
function restartWhisper(){
  if(worker) worker.terminate();
  worker = null; whisperReady = false; loading = false; clearTimeout(loadWatch);
  startWhisper(); updateDiag();
}
const engTitle = $('engTitle'), engPill = $('engPill'), engSub = $('engSub'), dlBtn = $('dlBtn'), bar = $('bar'), barFill = $('barFill');

function startWhisper(){
  if(worker || loading) return;
  loading = true; files = {}; curThreads = wantThreads();
  $('engine').style.display = '';
  dlBtn.style.display = 'none';
  bar.style.display = 'block'; barFill.style.width = '0';
  engPill.textContent = 'cargando…';
  engSub.textContent = 'Preparando el modelo. Mientras tanto ' + fallbackHint() + '.';
  worker = new Worker('worker.js', {type:'module'});
  worker.onmessage = onWorker;
  worker.onerror = e => failWhisper(e.message || 'Error al iniciar Whisper');
  worker.postMessage({type:'load', model: getModel(), threads: curThreads});
  watchLoad();
}

function onWorker(e){
  const m = e.data;
  if((m.type === 'progress' || m.type === 'warming') && loading) watchLoad();
  if(m.type === 'warming'){
    barFill.style.width = '100%';
    engSub.textContent = 'Preparando el motor (unos segundos)… Mientras tanto ' + fallbackHint() + '.';
  }
  if(m.type === 'progress' && m.data.status === 'progress' && m.data.total){
    files[m.data.file] = m.data;
    let loaded = 0, total = 0;
    for(const f of Object.values(files)){ loaded += f.loaded; total += f.total; }
    const pct = Math.round(loaded / total * 100);
    barFill.style.width = pct + '%';
    engSub.textContent = `Descargando… ${(loaded/1048576).toFixed(0)} / ${(total/1048576).toFixed(0)} MB`;
  }
  if(m.type === 'ready'){
    whisperReady = true; loading = false; clearTimeout(loadWatch);
    flag(false, '1');
    askPersist(); // así el navegador tampoco borra el modelo
    bar.style.display = 'none';
    engPill.textContent = 'listo · local'; engPill.classList.add('local');
    engSub.textContent = `Listo · modelo ${MODELS[m.model].name.toLowerCase()} · ${coresText()}. Nada sale del dispositivo.`;
    updateDiag();
    dropOldModelFiles();
    setTimeout(() => { if(whisperReady) $('engine').style.display = 'none'; }, 2500);
  }
  if(m.type === 'result'){
    const secs = ((Date.now() - busyStart) / 1000).toFixed(1).replace('.', ',');
    endBusy();
    const text = cleanHallucinations(m.text);
    appendText(text);
    setHint(text ? `Transcrito en ${secs} s · revisa y pulsa Guardar` : 'No se entendió nada. Prueba a hablar más cerca.');
  }
  if(m.type === 'error'){
    if(!whisperReady) failWhisper(m.message);
    else { endBusy(); setHint('Error al transcribir: ' + m.message); }
  }
}

function failWhisper(msg){
  if(worker) worker.terminate();
  loading = false; worker = null; whisperReady = false;
  clearTimeout(loadWatch);
  if(state === 'busy'){ endBusy(); setHint('Whisper se cerró. Prueba otra vez en unos segundos.'); }
  // Si falló con varios núcleos, lo apagamos para siempre y reintentamos con uno
  if(curThreads > 1){ threadsOff(true); startWhisper(); return; }
  // Volvemos al dictado del navegador hasta que se reintente
  $('engine').style.display = '';
  bar.style.display = 'none';
  engPill.classList.remove('local');
  engPill.textContent = 'error';
  engSub.textContent = 'No se pudo cargar Whisper (' + msg + '). Mientras tanto ' + fallbackHint() + '.';
  dlBtn.textContent = 'Reintentar'; dlBtn.style.display = '';
}

// Whisper a veces "inventa" frases con silencio; las quitamos.
// Las coletillas de YouTube solo se quitan al final, para no tocar frases reales
// como "gracias por ver esto".
function cleanHallucinations(t){
  const tail = /[\s,.]*(gracias por ver(lo|nos)?( el v[ií]deo)?|suscr[ií]bete( al canal)?)[\s.!¡]*$/i;
  t = t.replace(/subt[ií]tulos? (realizados |creados |hechos )?por la comunidad de amara\.org\.?/gi, '');
  let prev;
  do { prev = t; t = t.replace(tail, ''); } while(t !== prev);
  return t.replace(/\s+/g, ' ').trim();
}

dlBtn.onclick = startWhisper;
engSub.textContent = `Transcribe en tu móvil, sin enviar audio. Descarga única de ~${MODELS[getModel()].mb} MB (mejor con WiFi).`;

/* ---------- Ajustes ---------- */
const gear = $('gear'), settings = $('settings');
function coresText(){ return curThreads > 1 ? `${curThreads} núcleos` : '1 núcleo'; }
function updateDiag(){
  let t = whisperReady ? `Usando ${coresText()} del procesador.` : 'Whisper no está cargado.';
  if(whisperReady && curThreads === 1)
    t += threadsOff() ? ' El modo multinúcleo falló en este móvil.'
       : !self.crossOriginIsolated ? ' El multinúcleo se activa al volver a abrir la app.' : '';
  $('diag').textContent = t;
}
gear.onclick = () => {
  settings.hidden = !settings.hidden;
  gear.classList.toggle('on', !settings.hidden);
  gear.setAttribute('aria-expanded', String(!settings.hidden));
  updateDiag();
};
document.querySelectorAll('input[name=model]').forEach(r => {
  r.checked = r.value === getModel();
  r.onchange = () => {
    if(state !== 'idle'){ r.checked = false; document.querySelector(`input[value="${getModel()}"]`).checked = true; setHint('Espera a que termine para cambiar de modelo'); return; }
    setModel(r.value);
    // Cambiar de modelo es una decisión explícita: lo cargamos (y descargamos si hace falta)
    restartWhisper();
  };
});


// ¿Siguen los archivos del modelo en la caché de transformers.js?
// true = sí, false = no, null = no se puede saber
async function modelCached(){
  try{
    if(!('caches' in window)) return null;
    // Vale tanto lo bajado de esta web como lo que se bajó antes de Hugging Face
    const keys = (await (await caches.open('transformers-cache')).keys()).map(r => r.url);
    const has = file => keys.some(u => u.includes('/onnx-community/' + getModel() + '/') && u.endsWith('/' + file));
    return has('encoder_model_quantized.onnx') && has('decoder_model_merged_quantized.onnx');
  }catch(e){ return null; }
}

// Borra archivos de la gráfica (WebGPU) que bajaron versiones anteriores (~35–100 MB).
// Los modelos q8 que se bajaron antes de Hugging Face NO se borran: son idénticos a los
// de esta web y transformers.js los reutiliza desde la caché, sin conectarse a nada.
async function dropOldModelFiles(){
  try{
    const re = /\/(encoder_model|decoder_model_merged_q4)\.onnx$/;
    const cache = await caches.open('transformers-cache');
    for(const req of await cache.keys())
      if(req.url.includes('/onnx-community/whisper-') && re.test(req.url)) await cache.delete(req);
  }catch(e){}
}

(async () => {
  if(!IS_MOBILE || flag(true) !== '1') return; // en ordenador no se carga el modelo
  if(await modelCached()){ startWhisper(); return; } // está en caché: carga sin red
  // El navegador borró el modelo: no lo bajamos otra vez sin preguntar
  flag(false, '0');
  const mobileData = navigator.connection && (navigator.connection.type === 'cellular' || navigator.connection.saveData);
  engPill.textContent = 'falta el modelo';
  engSub.textContent = `Hay que descargar el modelo otra vez (el navegador lo borró o la app lo ha cambiado). Ocupa ~${MODELS[getModel()].mb} MB y viene de esta misma web`
    + (mobileData ? ' y parece que estás con datos móviles.' : ' (mejor con WiFi).');
  dlBtn.textContent = 'Volver a descargar';
})();

/* ---------- Grabación ---------- */
let state = 'idle'; // idle | rec | busy
let mediaRec = null, chunks = [], stream = null, recStart = 0, timer = null;

async function startWhisperRec(){
  try{
    stream = await navigator.mediaDevices.getUserMedia({audio:{channelCount:1, echoCancellation:true, noiseSuppression:true}});
  }catch(e){ setHint('Permiso de micrófono denegado'); return; }
  chunks = [];
  mediaRec = new MediaRecorder(stream);
  mediaRec.ondataavailable = e => { if(e.data.size) chunks.push(e.data); };
  mediaRec.onstop = processAudio;
  mediaRec.start();
  state = 'rec'; recStart = Date.now();
  micBtn.classList.add('rec');
  timer = setInterval(() => {
    const s = Math.floor((Date.now() - recStart) / 1000);
    setHint(`Escuchando… ${Math.floor(s/60)}:${String(s%60).padStart(2,'0')} · micro: transcribir · ✕: descartar`);
  }, 250);
}

function stopWhisperRec(){
  clearInterval(timer);
  micBtn.classList.remove('rec');
  mediaRec.stop();
  stream.getTracks().forEach(t => t.stop());
}

let discardRec = false;
async function processAudio(){
  if(discardRec){ discardRec = false; chunks = []; state = 'idle'; setHint('Grabación descartada'); return; }
  const dur = Date.now() - recStart;
  const blob = new Blob(chunks, {type: mediaRec.mimeType});
  chunks = []; // el audio solo vive en memoria y se descarta
  if(dur < 600){ state = 'idle'; idleHint(); return; }
  if(!worker || !whisperReady){ state = 'idle'; setHint('Whisper no está disponible: ' + fallbackHint()); return; }
  startBusy(dur);
  let ctx = null;
  try{
    ctx = new (window.AudioContext || window.webkitAudioContext)({sampleRate:16000});
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    const audio = buf.getChannelData(0).slice();
    worker.postMessage({type:'transcribe', audio}, [audio.buffer]);
  }catch(e){
    endBusy(); setHint('No se pudo procesar el audio');
  }finally{
    if(ctx) ctx.close().catch(() => {});
  }
}

// Mientras transcribe: contador visible y límite de tiempo.
// En CPU tarda más o menos lo que dura la grabación (más la primera vez).
let busyTimer = null, busyStart = 0;
function startBusy(audioMs){
  state = 'busy'; micBtn.classList.add('busy'); busyStart = Date.now();
  const limit = Math.max(90, Math.ceil(audioMs / 1000) * 8); // segundos
  clearInterval(busyTimer);
  busyTimer = setInterval(() => {
    const s = Math.floor((Date.now() - busyStart) / 1000);
    if(s >= limit){
      abortTranscription('Tardó demasiado (' + s + ' s). Prueba con una grabación más corta.');
      return;
    }
    setHint(`Transcribiendo… ${s} s`);
  }, 250);
  setHint('Transcribiendo…');
}
function endBusy(){
  clearInterval(busyTimer); busyTimer = null;
  state = 'idle'; micBtn.classList.remove('busy');
}
// La única forma de parar Whisper a medias es cerrar el worker y cargarlo de nuevo (desde caché)
function abortTranscription(msg){
  endBusy(); clearTimeout(loadWatch);
  if(worker) worker.terminate();
  worker = null; whisperReady = false; loading = false;
  startWhisper();
  setHint(msg);
}

/* ---------- Micro ---------- */
// Solo Whisper (privado). Mientras carga, el dictado del teclado (p. ej. FUTO) es la alternativa.
// No se usa el dictado del navegador: en Chrome envía el audio a Google.
function fallbackHint(){ return 'puedes usar el micro del teclado'; }

micBtn.onclick = () => {
  if(state === 'busy'){ abortTranscription('Cancelado'); return; }
  if(state === 'rec'){ stopWhisperRec(); return; }
  if(whisperReady){ startWhisperRec(); return; }
  setHint(loading ? 'Whisper está cargando; ' + fallbackHint() : 'Descarga Whisper arriba para dictar; ' + fallbackHint());
};

// ✕: descarta la grabación en curso (sin transcribir) o cancela la transcripción
$('discard').onclick = () => {
  if(state === 'busy'){ abortTranscription('Transcripción cancelada'); return; }
  if(state === 'rec'){ discardRec = true; stopWhisperRec(); }
};

render();

/* ---------- Sin conexión ---------- */
if('serviceWorker' in navigator && location.protocol !== 'file:'){
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  // Las cabeceras que permiten usar varios núcleos las pone sw.js, así que solo valen
  // cuando la página se carga a través de él. Si no es así, recargamos (máx. 2 veces por sesión).
  const maybeReload = () => {
    if(self.crossOriginIsolated || !navigator.serviceWorker.controller || state !== 'idle') return;
    let n = 0; try{ n = +sessionStorage.getItem('notavoz.coi') || 0; }catch(e){}
    if(n >= 2) return;
    try{ sessionStorage.setItem('notavoz.coi', n + 1); }catch(e){ return; }
    location.reload();
  };
  navigator.serviceWorker.ready.then(maybeReload);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if(updateRequested && state === 'idle') location.reload(); else maybeReload();
  });
}

// Actualizar solo cuando tú lo pides (la app no comprueba nada por su cuenta)
let updateRequested = false;
const updMsg = $('updMsg');
$('updBtn').onclick = async () => {
  if(!('serviceWorker' in navigator)) return;
  if(!navigator.onLine){ updMsg.textContent = 'Sin conexión.'; return; }
  updMsg.textContent = 'Buscando…';
  try{
    const reg = await navigator.serviceWorker.getRegistration();
    if(!reg){ updMsg.textContent = 'No disponible.'; return; }
    updateRequested = true;
    await reg.update();
    if(reg.installing || reg.waiting){
      updMsg.textContent = 'Descargando la nueva versión…';
      // al activarse, controllerchange recarga la página
      if(state !== 'idle') updMsg.textContent = 'Se aplicará al volver a abrir la app.';
    } else {
      updateRequested = false;
      updMsg.textContent = 'Ya tienes la última versión.';
    }
  }catch(e){ updateRequested = false; updMsg.textContent = 'No se pudo comprobar.'; }
};
