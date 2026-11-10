/* Whist Coach — interface. Rekenlogica zit in engine.js, fotoherkenning in detector.js. */
(function () {
  const E = window.WiezenEngine;
  const SUIT_ORDER = [3, 2, 1, 0]; // ♠ ♥ ♦ ♣
  const RANKS = [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2];
  const RL = { 14: 'A', 13: 'H', 12: 'D', 11: 'B', 10: '10' };
  const state = { hand: new Set(), trump: 3, pos: 0, sort: 'ev' };
  let lastResult = null;
  let sim = null, timer = null;

  const $ = id => document.getElementById(id);
  const rows = $('rows');
  for (const s of SUIT_ORDER) {
    const row = document.createElement('div'); row.className = 'row';
    const lab = document.createElement('div'); lab.className = 'suit-label ' + (s === 1 || s === 2 ? 'red' : 'black'); lab.textContent = E.SUIT_SYM[s];
    const chips = document.createElement('div'); chips.className = 'chips';
    for (const r of RANKS) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.id = 'c' + E.mk(s, r);
      b.textContent = RL[r] || r; b.setAttribute('aria-label', E.SUIT_NAME[s] + ' ' + (RL[r] || r)); b.dataset.c = E.mk(s, r);
      b.addEventListener('click', () => toggle(+b.dataset.c));
      chips.appendChild(b);
    }
    row.append(lab, chips); rows.appendChild(row);
  }

  function toggle(c) {
    if (state.hand.has(c)) state.hand.delete(c);
    else if (state.hand.size < 13) state.hand.add(c);
    render();
  }
  function render() {
    for (const b of rows.querySelectorAll('.chip')) b.classList.toggle('on', state.hand.has(+b.dataset.c));
    const n = state.hand.size;
    $('count').textContent = n + '/13'; $('count').classList.toggle('ok', n === 13);
    $('btnRun').disabled = n !== 13;
    $('status').textContent = n === 13 ? 'Klaar om te berekenen.' : 'Nog ' + (13 - n) + ' kaart' + (13 - n === 1 ? '' : 'en') + ' te kiezen.';
    const aces = [...state.hand].filter(c => E.rankOf(c) === 14).length;
    const tb = $('troel'); tb.hidden = aces < 3;
    if (aces >= 3) {
      $('troelTitle').textContent = aces === 4 ? 'Troela!' : 'Troel!';
      $('troelText').textContent = aces === 4
        ? 'Met 4 azen moet je troel roepen zodra de troefkaart omgedraaid is. Hartenkoning is troef en zijn houder je partner; samen 9 slagen.'
        : 'Met 3 azen moet je troel roepen zodra de troefkaart omgedraaid is. De houder van de 4e aas is je partner en komt ermee uit; die kleur is troef. Samen 8 slagen.';
    }
  }
  function seg(id, key) {
    const el = $(id);
    for (const b of el.querySelectorAll('button')) {
      b.classList.toggle('on', +b.dataset.v === state[key]);
      b.addEventListener('click', () => { state[key] = +b.dataset.v; for (const x of el.querySelectorAll('button')) x.classList.toggle('on', x === b); });
    }
  }
  seg('trump', 'trump'); seg('pos', 'pos'); seg('sort', 'sort');
  $('sort').addEventListener('click', () => { if (lastResult) show(lastResult); });

  const EXAMPLE = [ [3,14],[3,13],[3,12],[3,11],[3,10],[3,9],[3,8],[2,14],[2,13],[1,14],[0,7],[0,5],[0,3] ];
  $('btnExample').addEventListener('click', () => { state.hand = new Set(EXAMPLE.map(([s, r]) => E.mk(s, r))); render(); });
  $('btnClear').addEventListener('click', () => { state.hand.clear(); $('resultsWrap').hidden = true; render(); });
  $('btnRandom').addEventListener('click', () => {
    const deck = Array.from({ length: 52 }, (_, i) => i);
    for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    state.hand = new Set(deck.slice(0, 13));
    // troef = de 14e kaart van het deck, alsof de deler ze omdraait
    state.trump = E.suitOf(deck[13]);
    for (const b of $('trump').querySelectorAll('button')) b.classList.toggle('on', +b.dataset.v === state.trump);
    $('resultsWrap').hidden = true;
    render();
    $('btnRun').click();
  });

  $('btnRun').addEventListener('click', () => {
    if (timer) { clearTimeout(timer); timer = null; }
    const n = +$('nsim').value;
    sim = E.createSimulation({ hand: [...state.hand], tableTrump: state.trump, position: state.pos, n, seed: (Date.now() & 0xffff) + 1 });
    $('btnRun').disabled = true; $('prog').style.width = '0%';
    $('status').textContent = 'Aan het spelen…';
    const tick = () => {
      const done = sim.step(40);
      $('prog').style.width = (100 * done / n) + '%';
      $('status').textContent = done + ' van ' + n + ' verdelingen uitgespeeld…';
      if (done < n) { timer = setTimeout(tick, 0); }
      else { timer = null; show(sim.result()); $('btnRun').disabled = false; }
    };
    timer = setTimeout(tick, 0);
  });

  const fmtP = p => Math.round(p * 100) + '%';
  const fmtEV = v => (v > 0 ? '+' : '') + v.toFixed(1);

  function show(res) {
    lastResult = res;
    const byP = state.sort === 'p';
    $('status').textContent = res.n + ' verdelingen uitgespeeld. ' + (byP ? 'Gesorteerd op slaagkans.' : 'Gesorteerd op verwachte punten; de stippellijn is passen (0 punten).');
    const list = res.contracts.slice().sort((a, b) => byP ? (b.p - a.p || b.ev - a.ev) : (b.ev - a.ev));
    const bestId = res.contracts.slice().sort((a, b) => b.ev - a.ev)[0];
    const box = $('results'); box.innerHTML = ''; $('resultsWrap').hidden = false;
    let passShown = byP;
    list.forEach((c, i) => {
      if (!passShown && c.ev <= 0) { const p = document.createElement('div'); p.className = 'pass'; p.textContent = 'Passen · 0 punten'; box.appendChild(p); passShown = true; }
      const isBest = c === bestId && c.ev > 0;
      const el = document.createElement('article'); el.className = 'res' + (isBest ? ' best' : '');
      const dist = c.dist.map((v, t) => `<b class="${hitClass(c, t)}" style="height:${Math.max(4, Math.round(v * 100))}%" title="${t} slagen: ${fmtP(v)}"></b>`).join('');
      el.innerHTML = `
        <div><div class="name">${c.name}${isBest ? '<span class="tag">Beste keuze</span>' : ''}</div><div class="sub">${c.sub}</div></div>
        <div class="nums"><div class="p ${c.p >= 0.5 ? 'pos' : ''}">${fmtP(c.p)}</div><div class="ev">verwacht <b class="${c.ev >= 0 ? 'pos' : 'neg'}">${fmtEV(c.ev)}</b> pt</div></div>
        <div class="bar"><i style="width:${c.p * 100}%"></i></div>
        <div class="dist">${dist}</div>
        <div class="dist-label"><span>0 slagen</span><span>${c.id === 'vragen' ? 'samen met partner' : 'kansverdeling van je slagen'}</span><span>13</span></div>`;
      box.appendChild(el);
    });
    if (!passShown) { const p = document.createElement('div'); p.className = 'pass'; p.textContent = 'Passen · 0 punten'; box.appendChild(p); }
  }
  function hitClass(c, t) {
    if (c.type === 'misere') return t === 0 ? 'hit' : '';
    return t >= c.target ? 'hit' : '';
  }

  /* ---------- foto → kaarten via lokaal ONNX-model (detector.js) ---------- */
  (function () {
    const btn = $('btnPhoto'), input = $('photo'), box = $('photoBox'), img = $('photoImg'), msg = $('photoMsg');
    btn.addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      input.value = '';
      box.hidden = false;
      try { img.src = URL.createObjectURL(file); } catch (e) {}
      btn.disabled = true;
      try {
        const found = await window.WiezenDetector.detect(file, t => { msg.textContent = t; });
        if (!found.length) { msg.textContent = 'Geen kaarten herkend. Probeer een scherpere foto waarop alle hoekindexen zichtbaar zijn.'; return; }
        state.hand = new Set(found.slice(0, 13).map(f => E.mk(f.suit, f.rank)));
        $('resultsWrap').hidden = true;
        render();
        const unsure = found.slice(0, 13).filter(f => f.score < 0.5).map(f => E.cardStr(E.mk(f.suit, f.rank)));
        const n = state.hand.size;
        msg.textContent = n + ' kaarten herkend.' + (n === 13 ? '' : ' Dat zijn er geen 13: vul aan of corrigeer.') +
          (unsure.length ? ' Twijfel bij: ' + unsure.join(', ') + '.' : '') + ' Controleer de selectie, kies dan troef en plaats.';
        for (const f of found.slice(0, 13)) {
          const b = $('c' + E.mk(f.suit, f.rank)); if (!b) continue;
          b.style.outline = '2px solid var(--warn)'; setTimeout(() => { b.style.outline = ''; }, f.score < 0.5 ? 6000 : 1600);
        }
      } catch (e) {
        msg.textContent = (e && e.userMessage) || 'Het lezen is mislukt; probeer het opnieuw of kies de kaarten handmatig.';
        console.error(e);
      } finally { btn.disabled = false; }
    });
  })();

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  render();
})();
