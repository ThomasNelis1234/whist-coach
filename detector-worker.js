/* Whist Coach — herkenning in een aparte thread, zodat de pagina bruikbaar blijft terwijl het model rekent.
   detector.js maakt de beeldgegevens klaar en stuurt ze hierheen; deze worker laadt onnxruntime en het model
   en voert het model uit. Lukt hier iets niet, dan valt detector.js terug op rekenen in de pagina zelf. */
let session = null;

function fail(kind, err) { self.postMessage({ type: 'error', kind, message: String((err && err.message) || err) }); }

async function fetchWithProgress(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(url + ' → HTTP ' + res.status);
  const total = +res.headers.get('content-length') || 0;
  if (!res.body || !total) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader(); const chunks = []; let got = 0, last = -1;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.length;
    const pct = Math.round(100 * got / total);
    if (pct !== last) { last = pct; self.postMessage({ type: 'progress', text: 'Model downloaden… ' + pct + '% (eenmalig)' }); }
  }
  const buf = new Uint8Array(got); let o = 0;
  for (const c of chunks) { buf.set(c, o); o += c.length; }
  return buf;
}

self.onmessage = async e => {
  const m = e.data;
  if (m.type === 'init') {
    self.postMessage({ type: 'progress', text: 'Herkenningsmotor laden…' });
    try { importScripts(m.ortBase + 'ort.min.js'); } catch (err) { return fail('ort', err); }
    let bytes;
    try { bytes = await fetchWithProgress(m.modelUrl); } catch (err) { return fail('model', err); }
    self.postMessage({ type: 'progress', text: 'Model starten…' });
    try {
      self.ort.env.wasm.wasmPaths = m.ortBase;
      self.ort.env.wasm.numThreads = 1;
      session = await self.ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
    } catch (err) { return fail('session', err); }
    self.postMessage({ type: 'ready' });
  } else if (m.type === 'run') {
    try {
      const input = new self.ort.Tensor('float32', m.data, [1, 3, m.size, m.size]);
      const out = await session.run({ [session.inputNames[0]]: input });
      const t = out[session.outputNames[0]];
      const data = new Float32Array(t.data);            // kopie, zodat de buffer overgedragen mag worden
      self.postMessage({ type: 'result', id: m.id, data, dims: Array.from(t.dims) }, [data.buffer]);
    } catch (err) {
      self.postMessage({ type: 'runerror', id: m.id, message: String((err && err.message) || err) });
    }
  }
};
