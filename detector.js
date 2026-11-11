/* Whist Coach — kaartherkenning op het toestel.
   Model: sroot/lgd-cards-gen3 (YOLO11s, 52 klassen, AGPL-3.0), als model/model.onnx + model/model.classes.json.
   Runtime: onnxruntime-web (WASM), bij het eerste gebruik geladen van jsDelivr; het model draait in
   detector-worker.js zodat de pagina blijft reageren, met terugval op de pagina zelf.
   Het model detecteert hoekindexen (meestal twee per kaart); een kaart zit maar één keer in een hand,
   dus we houden per klasse de detectie met de hoogste score over. */
(function (root) {
  'use strict';

  const ORT_VERSION = '1.19.2';
  const ORT_BASE = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@' + ORT_VERSION + '/dist/';
  const MODEL_URL = 'model/model.onnx';
  const CLASSES_URL = 'model/model.classes.json';
  const SIZE = 640;      // invoer van het model (letterbox)
  const CONF = 0.30;     // minimale score voor een detectie
  const IOU = 0.5;       // NMS-drempel
  const HAND = 13;

  const SUITS = { C: 0, D: 1, H: 2, S: 3 };                 // zelfde nummering als engine.js
  const RANKS = { A: 14, K: 13, Q: 12, J: 11, T: 10 };

  let ready = null;      // Promise<{backend, classes}>

  function userError(message, cause) { const e = new Error(message); e.userMessage = message; e.cause = cause; return e; }

  /* ---------- pure hulpfuncties (getest in test/detector.test.js) ---------- */

  // "10C" / "AS" / "Td" -> {suit, rank} of null
  function parseCode(code) {
    const m = /^(10|[2-9TJQKA])([CDHS])$/i.exec(String(code).trim());
    if (!m) return null;
    const r = m[1].toUpperCase(), s = m[2].toUpperCase();
    return { suit: SUITS[s], rank: RANKS[r] || parseInt(r, 10) };
  }

  // model.classes.json kan een lijst zijn, {"0":"10C",...}, {"10C":0,...} of {names: ...}
  function normalizeClasses(json) {
    if (json && !Array.isArray(json) && typeof json === 'object' && json.names) json = json.names;
    if (json && !Array.isArray(json) && typeof json === 'object' && json.classes) json = json.classes;
    if (Array.isArray(json)) return json.map(String);
    const out = [];
    for (const [k, v] of Object.entries(json || {})) {
      if (/^\d+$/.test(k)) out[+k] = String(v);
      else if (typeof v === 'number') out[v] = String(k);
    }
    return out;
  }

  function iou(a, b) {
    const x1 = Math.max(a.x1, b.x1), y1 = Math.max(a.y1, b.y1), x2 = Math.min(a.x2, b.x2), y2 = Math.min(a.y2, b.y2);
    const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const ua = (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter;
    return ua > 0 ? inter / ua : 0;
  }

  // Ruwe modeluitvoer -> [{cls, score, x1, y1, x2, y2}] in modelpixels.
  // Ondersteunt [1, 4+nc, N] (standaard YOLO-export), [1, N, 4+nc] en [1, N, 6] (export met ingebouwde NMS).
  function decode(data, dims, nc, conf) {
    const dets = [];
    if (dims.length !== 3) throw new Error('Onverwachte modeluitvoer: ' + JSON.stringify(dims));
    const [, d1, d2] = dims;
    if (d2 === 6 && d1 !== 4 + nc) {
      for (let i = 0; i < d1; i++) {
        const o = i * 6, score = data[o + 4];
        if (score >= conf) dets.push({ x1: data[o], y1: data[o + 1], x2: data[o + 2], y2: data[o + 3], score, cls: Math.round(data[o + 5]) });
      }
      return dets;
    }
    const chFirst = d1 === 4 + nc || (d2 !== 4 + nc && d1 < d2);
    const C = chFirst ? d1 : d2, N = chFirst ? d2 : d1;
    const at = chFirst ? (c, i) => data[c * N + i] : (c, i) => data[i * C + c];
    for (let i = 0; i < N; i++) {
      let best = -1, bs = conf;
      for (let c = 4; c < C; c++) { const v = at(c, i); if (v >= bs) { bs = v; best = c - 4; } }
      if (best < 0) continue;
      const cx = at(0, i), cy = at(1, i), w = at(2, i), h = at(3, i);
      dets.push({ x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2, score: bs, cls: best });
    }
    // NMS binnen dezelfde klasse
    dets.sort((a, b) => b.score - a.score);
    const keep = [];
    for (const d of dets) if (!keep.some(k => k.cls === d.cls && iou(k, d) > IOU)) keep.push(d);
    return keep;
  }

  // Detecties (eventueel van meerdere beelduitsneden) -> unieke kaarten, hoogste score eerst.
  function toCards(dets, classes) {
    const best = new Map();
    for (const d of dets) {
      const code = classes[d.cls], card = code && parseCode(code);
      if (!card) continue;
      const cur = best.get(code);
      if (!cur || d.score > cur.score) best.set(code, { code, suit: card.suit, rank: card.rank, score: d.score });
    }
    return [...best.values()].sort((a, b) => b.score - a.score);
  }

  /* ---------- browsergedeelte ---------- */

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('script ' + src));
      document.head.appendChild(s);
    });
  }

  async function fetchWithProgress(url, onProgress) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(url + ' → HTTP ' + res.status);
    const total = +res.headers.get('content-length') || 0;
    if (!res.body || !total) return new Uint8Array(await res.arrayBuffer());
    const reader = res.body.getReader(); const chunks = []; let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); got += value.length; onProgress(got / total);
    }
    const buf = new Uint8Array(got); let o = 0;
    for (const c of chunks) { buf.set(c, o); o += c.length; }
    return buf;
  }

  /* Twee manieren om het model uit te voeren, met dezelfde interface run(Float32Array) -> {data, dims}:
     - in een worker (voorkeur): de pagina blijft reageren terwijl het model rekent;
     - in de pagina zelf (terugval): werkt overal, maar de pagina staat even stil per doorgang. */
  let report = function () {};   // statusmeldingen van de lopende detect()-oproep

  function workerBackend() {
    return new Promise((resolve, reject) => {
      let worker, settled = false, watchdog = null, nextId = 1;
      const pending = new Map();
      const stop = err => {
        clearTimeout(watchdog);
        for (const p of pending.values()) p.reject(err); pending.clear();
        try { worker && worker.terminate(); } catch (e) { /* al gestopt */ }
        if (!settled) { settled = true; reject(err); }
      };
      const alive = () => { clearTimeout(watchdog); if (!settled) watchdog = setTimeout(() => stop(new Error('worker reageert niet')), 30000); };
      try { worker = new Worker('detector-worker.js'); } catch (e) { return reject(e); }
      worker.onerror = e => stop(new Error('worker: ' + (e && e.message)));
      worker.onmessage = e => {
        const m = e.data; alive();
        if (m.type === 'progress') report(m.text);
        else if (m.type === 'ready') {
          settled = true; clearTimeout(watchdog);
          resolve({
            run: data => new Promise((res, rej) => {
              const id = nextId++; pending.set(id, { resolve: res, reject: rej });
              worker.postMessage({ type: 'run', id, data, size: SIZE }, [data.buffer]);
            }),
          });
        }
        else if (m.type === 'error') { const err = new Error(m.message); err.kind = m.kind; stop(err); }
        else if (m.type === 'result') { const p = pending.get(m.id); pending.delete(m.id); if (p) p.resolve({ data: m.data, dims: m.dims }); }
        else if (m.type === 'runerror') { const p = pending.get(m.id); pending.delete(m.id); if (p) p.reject(new Error(m.message)); }
      };
      alive();
      worker.postMessage({ type: 'init', ortBase: ORT_BASE, modelUrl: new URL(MODEL_URL, location.href).href });
    });
  }

  async function mainBackend() {
    if (!root.ort) {
      report('Herkenningsmotor laden…');
      try { await loadScript(ORT_BASE + 'ort.min.js'); }
      catch (e) { throw userError('De herkenningsmotor kon niet geladen worden. Controleer je internetverbinding (enkel de eerste keer nodig).', e); }
    }
    root.ort.env.wasm.wasmPaths = ORT_BASE;
    root.ort.env.wasm.numThreads = 1;
    let bytes;
    try { bytes = await fetchWithProgress(MODEL_URL, f => report('Model downloaden… ' + Math.round(f * 100) + '% (eenmalig)')); }
    catch (e) { throw userError(MODEL_MISSING, e); }
    report('Model starten…');
    let session;
    try { session = await root.ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] }); }
    catch (e) { throw userError('Het model kon niet gestart worden op dit toestel.', e); }
    return {
      run: async data => {
        const out = await session.run({ [session.inputNames[0]]: new root.ort.Tensor('float32', data, [1, 3, SIZE, SIZE]) });
        const t = out[session.outputNames[0]];
        return { data: t.data, dims: Array.from(t.dims) };
      },
    };
  }

  const MODEL_MISSING = 'Het herkenningsmodel is niet gevonden. Zet model.onnx en model.classes.json in de map model/ (zie README).';

  function init() {
    if (ready) return ready;
    ready = (async () => {
      let classes;
      try { classes = normalizeClasses(await (await fetch(CLASSES_URL)).json()); }
      catch (e) { throw userError(MODEL_MISSING, e); }
      if (!classes.some(parseCode)) throw userError('model.classes.json bevat geen kaartcodes zoals "AS" of "10C".');
      let backend;
      if (root.Worker) {
        try { backend = await workerBackend(); }
        catch (e) {
          if (e && e.kind === 'model') throw userError(MODEL_MISSING, e);
          console.warn('Herkenning in worker lukt niet, terugval op de pagina zelf:', e);
        }
      }
      if (!backend) backend = await mainBackend();
      return { backend, classes };
    })();
    ready.catch(() => { ready = null; });   // bij een fout mag een volgende poging opnieuw laden
    return ready;
  }

  async function loadBitmap(file) {
    if (root.createImageBitmap) {
      try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { /* val terug op <img> */ }
    }
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img); img.onerror = () => reject(userError('Deze foto kan niet geopend worden.'));
      img.src = URL.createObjectURL(file);
    });
  }

  // Uitsnede (sx, sy, sw, sh) van het beeld -> letterbox 640×640 -> Float32 CHW in [0,1]
  function toTensorData(bmp, sx, sy, sw, sh) {
    const canvas = document.createElement('canvas'); canvas.width = SIZE; canvas.height = SIZE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = 'rgb(114,114,114)'; ctx.fillRect(0, 0, SIZE, SIZE);
    const scale = Math.min(SIZE / sw, SIZE / sh), w = Math.round(sw * scale), h = Math.round(sh * scale);
    ctx.drawImage(bmp, sx, sy, sw, sh, (SIZE - w) >> 1, (SIZE - h) >> 1, w, h);
    const px = ctx.getImageData(0, 0, SIZE, SIZE).data, n = SIZE * SIZE, data = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) { data[i] = px[i * 4] / 255; data[n + i] = px[i * 4 + 1] / 255; data[2 * n + i] = px[i * 4 + 2] / 255; }
    return data;
  }

  async function runCrop(m, bmp, sx, sy, sw, sh) {
    await new Promise(r => setTimeout(r, 0));                 // laat de pagina eerst tekenen en tikken verwerken
    const out = await m.backend.run(toTensorData(bmp, sx, sy, sw, sh));
    return decode(out.data, out.dims, m.classes.length, CONF);
  }

  // file: File/Blob van de camera. progress(tekst) voor statusmeldingen.
  // Geeft [{code, suit, rank, score}] terug, hoogste score eerst.
  async function detect(file, progress) {
    report = progress = progress || function () {};
    const m = await init();
    const bmp = await loadBitmap(file);
    const W = bmp.width, H = bmp.height;
    progress('Kaarten zoeken…');
    let dets = await runCrop(m, bmp, 0, 0, W, H);
    let cards = toCards(dets, m.classes);
    if (cards.length < HAND) {
      // Kleine hoekindexen gaan verloren bij verkleinen naar 640 px: bekijk ook vier overlappende kwadranten.
      progress('Nog eens van dichterbij kijken…');
      const tw = Math.round(W * 0.6), th = Math.round(H * 0.6);
      for (const [sx, sy] of [[0, 0], [W - tw, 0], [0, H - th], [W - tw, H - th]]) {
        dets = dets.concat(await runCrop(m, bmp, sx, sy, tw, th));
      }
      cards = toCards(dets, m.classes);
    }
    if (bmp.close) bmp.close();
    return cards;
  }

  const api = { detect, parseCode, normalizeClasses, decode, toCards };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.WiezenDetector = api;
})(typeof self !== 'undefined' ? self : this);
