/* Whist Coach — interface. Rekenlogica zit in engine.js, fotoherkenning in detector.js. */
(function () {
  const E = window.WiezenEngine;
  const SUIT_ORDER = [2, 3, 1, 0];            // altijd: harten, schoppen, ruiten, klaveren (rood en zwart wisselen af)
  const RANKS = [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2];
  const RL = { 14: 'A', 13: 'H', 12: 'V', 11: 'B' };
  const TXT = '︎';                       // dwingt het tekstsymbool af (geen emoji op iOS)
  const N_DEALS = 2500;                       // 95%-foutmarge op een kans: hoogstens ±2 procentpunt
  const isRed = s => s === 1 || s === 2;
  const state = { hand: new Set(), trump: 3, pos: 0, unsure: new Set(), loading: false, loadingText: '' };
  let sim = null, timer = null;

  const $ = id => document.getElementById(id);

  /* ---------- kaartkiezer (uitklapbaar) ---------- */
  const rows = $('rows');
  for (const s of SUIT_ORDER) {
    const row = document.createElement('div'); row.className = 'row';
    const lab = document.createElement('div'); lab.className = 'suit-label ' + (isRed(s) ? 'red' : 'black'); lab.textContent = E.SUIT_SYM[s] + TXT;
    const chips = document.createElement('div'); chips.className = 'chips';
    for (const r of RANKS) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.id = 'c' + E.mk(s, r);
      b.textContent = RL[r] || r; b.setAttribute('aria-label', E.SUIT_NAME[s] + ' ' + (RL[r] || r)); b.dataset.c = E.mk(s, r);
      b.addEventListener('click', () => {
        const c = +b.dataset.c;
        if (state.hand.has(c)) state.hand.delete(c); else if (state.hand.size < 13) state.hand.add(c);
        state.unsure.delete(c);
        changed();
      });
      chips.appendChild(b);
    }
    row.append(lab, chips); rows.appendChild(row);
  }
  function setEditor(open) {
    $('editor').hidden = !open;
    $('btnEdit').setAttribute('aria-expanded', String(open));
    $('btnEdit').textContent = open ? 'Klaar met aanpassen' : 'Kaarten aanpassen';
  }
  $('btnEdit').addEventListener('click', () => setEditor($('editor').hidden));

  /* ---------- weergave ---------- */
  function sortedHand() {
    return [...state.hand].sort((a, b) =>
      SUIT_ORDER.indexOf(E.suitOf(a)) - SUIT_ORDER.indexOf(E.suitOf(b)) || E.rankOf(b) - E.rankOf(a));
  }
  function render() {
    const n = state.hand.size;
    // de hand als echte kaarten: per kleur, van hoog naar laag
    const fan = $('fan'); fan.innerHTML = ''; fan.style.setProperty('--n', Math.max(2, n));
    for (const c of sortedHand()) {
      const s = E.suitOf(c), r = E.rankOf(c), sym = E.SUIT_SYM[s] + TXT;
      const el = document.createElement('div');
      el.className = 'pc' + (isRed(s) ? ' r' : '') + (state.unsure.has(c) ? ' unsure' : '');
      el.setAttribute('aria-label', E.SUIT_NAME[s] + ' ' + (RL[r] || r));
      el.innerHTML = '<span class="ix"><b>' + (RL[r] || r) + '</b><i>' + sym + '</i></span><span class="pip">' + sym + '</span>';
      fan.appendChild(el);
    }
    const empty = $('fanEmpty');
    fan.hidden = n === 0 || state.loading; empty.hidden = !fan.hidden;
    empty.classList.toggle('loading', state.loading);
    empty.textContent = state.loading ? (state.loadingText || 'Je kaarten worden gelezen…') : 'Nog geen kaarten. Neem een foto of kies ze zelf.';
    for (const b of rows.querySelectorAll('.chip')) b.classList.toggle('on', state.hand.has(+b.dataset.c));
    $('count').textContent = state.loading ? '' : n + '/13'; $('count').classList.toggle('ok', n === 13);
    $('btnRun').disabled = n !== 13 || state.loading;
    $('btnEdit').disabled = state.loading; $('btnPhoto').disabled = state.loading;
    $('status').textContent = state.loading ? 'Je kunt intussen al troef en plaats kiezen.'
      : n === 13 ? '' : 'Nog ' + (13 - n) + ' kaart' + (13 - n === 1 ? '' : 'en') + ' te kiezen.';
  }
  // Elke wijziging aan kaarten, troef of plaats maakt een eerder resultaat ongeldig: verberg het tot er opnieuw gerekend is.
  function changed() {
    if (timer) { clearTimeout(timer); timer = null; }
    $('progBox').hidden = true; $('resultsWrap').hidden = true;
    render();
  }

  function seg(id, key) {
    const el = $(id);
    const paint = () => { for (const b of el.querySelectorAll('button')) b.classList.toggle('on', +b.dataset.v === state[key]); };
    for (const b of el.querySelectorAll('button')) b.addEventListener('click', () => { state[key] = +b.dataset.v; paint(); changed(); });
    paint();
    return paint;
  }
  const paintTrump = seg('trump', 'trump'); seg('pos', 'pos');

  const EXAMPLE = [ [3,14],[3,13],[3,12],[3,11],[3,10],[3,9],[3,8],[2,14],[2,13],[1,14],[0,7],[0,5],[0,3] ];
  $('btnExample').addEventListener('click', () => { state.hand = new Set(EXAMPLE.map(([s, r]) => E.mk(s, r))); state.unsure.clear(); changed(); });
  $('btnClear').addEventListener('click', () => { state.hand.clear(); state.unsure.clear(); $('photoMsg').hidden = true; changed(); });
  $('btnRandom').addEventListener('click', () => {
    const deck = Array.from({ length: 52 }, (_, i) => i);
    for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    state.hand = new Set(deck.slice(0, 13)); state.unsure.clear();
    state.trump = E.suitOf(deck[13]);         // de 14e kaart, alsof de deler ze omdraait
    paintTrump(); changed();
  });

  /* ---------- berekenen: enkel op de knop ---------- */
  $('btnRun').addEventListener('click', () => {
    if (state.hand.size !== 13) return;
    if (timer) { clearTimeout(timer); timer = null; }
    setEditor(false);
    sim = E.createSimulation({ hand: [...state.hand], tableTrump: state.trump, position: state.pos, n: N_DEALS, seed: (Date.now() & 0xffff) + 1 });
    $('btnRun').disabled = true; $('resultsWrap').hidden = true;
    $('progBox').hidden = false; $('prog').style.width = '0%'; $('status').textContent = 'Aan het rekenen…';
    const tick = () => {
      const t0 = Date.now(); let done;
      do { done = sim.step(20); } while (done < N_DEALS && Date.now() - t0 < 40);   // ±40 ms rekenen, dan de pagina laten ademen
      $('prog').style.width = (100 * done / N_DEALS) + '%';
      if (done < N_DEALS) { timer = setTimeout(tick, 0); return; }
      timer = null; $('progBox').hidden = true; $('status').textContent = ''; $('btnRun').disabled = false;
      show(sim.result());
    };
    timer = setTimeout(tick, 0);
  });

  const fmtP = p => Math.round(p * 100) + '%';
  const fmtEV = v => (v > 0 ? '+' : '') + v.toFixed(1).replace('.', ',');

  // Eén rij per spel: naam, winstkans, verwachte punten. Gerangschikt op verwachte punten.
  function spelNaam(c) {
    if (c.suit === undefined) return c.name;
    if (c.suit < 0) return c.name + ' <span class="zt">zonder troef</span>';
    return c.name + '\u00A0<span class="' + (isRed(c.suit) ? 'red' : 'black') + '">' + E.SUIT_SYM[c.suit] + TXT + '</span>';
  }
  function show(res) {
    const list = res.contracts.slice().sort((a, b) => b.ev - a.ev);
    const body = $('results'); body.innerHTML = '';
    list.forEach((c, i) => {
      const tr = document.createElement('tr');
      if (i === 0 && c.ev > 0) tr.className = 'best';
      tr.innerHTML = '<th scope="row">' + spelNaam(c) + '</th><td>' + fmtP(c.p) + '</td><td class="' + (c.ev >= 0 ? 'pos' : 'neg') + '">' + fmtEV(c.ev) + '</td>';
      body.appendChild(tr);
    });
    $('resultsWrap').hidden = false;
    const aces = [...state.hand].filter(c => E.rankOf(c) === 14).length;
    const note = $('troel'); note.hidden = aces < 3;
    if (aces >= 3) note.textContent = 'Je hebt ' + aces + ' azen. Volgens de regels moet je dan ' + (aces === 4 ? 'troela' : 'troel') +
      ' melden zodra de troefkaart omgedraaid is. Dat is hierboven niet doorgerekend; de spellen tonen wat je kaarten los daarvan waard zijn.';
    $('resultsWrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- foto → kaarten via lokaal ONNX-model (detector.js, rekent in een worker) ---------- */
  (function () {
    const btn = $('btnPhoto'), input = $('photo'), msg = $('photoMsg');
    const say = t => { msg.hidden = false; msg.textContent = t; };
    btn.addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      input.value = '';
      // Toon meteen dat er gelezen wordt: de vorige hand en het vorige resultaat verdwijnen.
      const prev = { hand: state.hand, unsure: state.unsure };
      state.hand = new Set(); state.unsure = new Set();
      state.loading = true; state.loadingText = ''; msg.hidden = true; setEditor(false);
      changed();
      let after = '', openEditor = false;
      try {
        const found = (await window.WiezenDetector.detect(file, t => { state.loadingText = t; render(); })).slice(0, 13);
        if (!found.length) {
          state.hand = prev.hand; state.unsure = prev.unsure;
          after = 'Geen kaarten herkend. Probeer een scherpere foto waarop van elke kaart de hoek zichtbaar is.';
        } else {
          state.hand = new Set(found.map(f => E.mk(f.suit, f.rank)));
          state.unsure = new Set(found.filter(f => f.score < 0.5).map(f => E.mk(f.suit, f.rank)));
          const n = state.hand.size;
          if (n === 13 && !state.unsure.size) after = '13 kaarten herkend. Klopt er een niet? Tik op "Kaarten aanpassen".';
          else {
            after = n + ' kaart' + (n === 1 ? '' : 'en') + ' herkend' + (n === 13 ? '' : ', geen 13') +
              (state.unsure.size ? '; de oranje omrande kaarten zijn onzeker' : '') + '. Verbeter ze hieronder.';
            openEditor = true;
          }
        }
      } catch (e) {
        state.hand = prev.hand; state.unsure = prev.unsure;
        after = (e && e.userMessage) || 'Het lezen is mislukt. Probeer het opnieuw of kies de kaarten zelf.';
        console.error(e);
      } finally {
        state.loading = false;
        changed();
        say(after); if (openEditor) setEditor(true);
      }
    });
  })();

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  render();
})();
