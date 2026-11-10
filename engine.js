/* Wiezen rekenmotor — Monte Carlo met heuristische spelers.
   Kaart-id: suit*13 + (rank-2); suits 0=♣ 1=♦ 2=♥ 3=♠ ; rank 2..14 (14=Aas).
   Zetels: 0 = speler na de deler (komt uit bij vragen/alleen/miserie), 3 = deler. */
(function (root) {
  'use strict';

  const SUIT_SYM = ['♣', '♦', '♥', '♠'];
  const SUIT_NAME = ['klaveren', 'ruiten', 'harten', 'schoppen'];
  const RANK_SYM = { 11: 'B', 12: 'V', 13: 'H', 14: 'A' };

  const suitOf = c => (c / 13) | 0;
  const rankOf = c => (c % 13) + 2;
  const mk = (s, r) => s * 13 + r - 2;
  const cardStr = c => SUIT_SYM[suitOf(c)] + (RANK_SYM[rankOf(c)] || rankOf(c));

  /* ---------- puntentabel (International World Whist Association, IWWA, versie 1 01-10-2025) ---------- */
  // score van de speler; tegenspelers delen het tegengestelde door 3
  const ALLEEN = [-36, -30, -24, -18, -12, 6, 9, 12, 15, 18, 21, 24, 27, 60];
  // per speler (jij én je partner krijgen dit)
  const VRAGEN = [-20, -18, -16, -14, -12, -10, -8, -6, 2, 3, 4, 5, 6, 14];
  const ABONDANCE = { 9: 15, 10: 18, 11: 24, 12: 27 };
  const MISERIE = 21, OPEN_MISERIE = 42, SOLO = 75, SOLOSLIM = 90;

  /* ---------- hulpfuncties ---------- */
  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(a, rand) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = (rand() * (i + 1)) | 0;
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function lowest(cards) { let b = cards[0]; for (const c of cards) if (rankOf(c) < rankOf(b)) b = c; return b; }
  function highest(cards) { let b = cards[0]; for (const c of cards) if (rankOf(c) > rankOf(b)) b = c; return b; }
  function bySuit(hand) { const g = [[], [], [], []]; for (const c of hand) g[suitOf(c)].push(c); return g; }

  // hoogste nog niet gespeelde rang in kleur s die NIET in mijn hand zit (0 als geen)
  function highestOutside(out, hand, s) {
    for (let r = 14; r >= 2; r--) {
      if (out[s][r]) continue;
      let mine = false;
      for (const c of hand) if (suitOf(c) === s && rankOf(c) === r) { mine = true; break; }
      if (!mine) return r;
    }
    return 0;
  }
  function countOutside(out, hand, s, below) { // aantal ongespeelde kaarten in kleur s buiten mijn hand (optioneel: lager dan 'below')
    let n = 0;
    for (let r = 2; r <= 14; r++) {
      if (out[s][r]) continue;
      if (below !== undefined && r >= below) continue;
      let mine = false;
      for (const c of hand) if (suitOf(c) === s && rankOf(c) === r) { mine = true; break; }
      if (!mine) n++;
    }
    return n;
  }
  function beats(c, best, leadSuit, trump) {
    const sc = suitOf(c), sb = suitOf(best);
    if (sc === sb) return rankOf(c) > rankOf(best);
    return sc === trump;
  }
  function currentBest(trick, trump) {
    let best = trick[0]; const lead = suitOf(best.card);
    for (let i = 1; i < trick.length; i++) if (beats(trick[i].card, best.card, lead, trump)) best = trick[i];
    return best;
  }

  /* ---------- heuristiek: slagen halen (vragen, alleen, abondance, solo) ---------- */
  function chooseTricks(seat, hand, trick, st) {
    const { trump, sides, out, voidKnown } = st;
    const groups = bySuit(hand);
    const mySide = sides[seat];
    const isDecl = mySide === 0;
    const oppSeats = [0, 1, 2, 3].filter(s => sides[s] !== mySide);
    const anyOppVoid = s => oppSeats.some(o => voidKnown[o][s]);

    if (trick.length === 0) {
      const trumps = trump >= 0 ? groups[trump] : [];
      const sideCards = hand.filter(c => suitOf(c) !== trump);
      const oppTrumps = trump >= 0 ? countOutside(out, hand, trump) : 0;

      if (isDecl && trump >= 0 && trumps.length > 0 && oppTrumps > 0) {
        const top = highest(trumps);
        if (rankOf(top) > highestOutside(out, hand, trump)) return top;          // troef trekken met zekere winnaar
        if (trumps.length >= 2 && trumps.length >= oppTrumps) return lowest(trumps); // lange troef: toch trekken
      }
      // zekere winnaars in bijkleuren incasseren
      const winners = sideCards.filter(c =>
        rankOf(c) > highestOutside(out, hand, suitOf(c)) &&
        !(oppTrumps > 0 && anyOppVoid(suitOf(c))));
      if (winners.length) {
        let best = winners[0];
        for (const w of winners) if (groups[suitOf(w)].length > groups[suitOf(best)].length) best = w;
        return best;
      }
      if (trump >= 0 && trumps.length && oppTrumps === 0 && sideCards.length === 0) return highest(trumps);
      // lange bijkleur laag uitkomen (om te ontwikkelen); tegenspelers vermijden kleuren waar de speler renonce is
      let cand = sideCards.filter(c => !(trump >= 0 && anyOppVoid(suitOf(c))));
      if (!cand.length) cand = sideCards;
      if (cand.length) {
        const g = bySuit(cand);
        let bestSuit = -1;
        for (let s = 0; s < 4; s++) if (g[s].length && (bestSuit < 0 || g[s].length > g[bestSuit].length)) bestSuit = s;
        return lowest(g[bestSuit]);
      }
      return isDecl ? highest(trumps) : lowest(trumps);
    }

    const leadSuit = suitOf(trick[0].card);
    const best = currentBest(trick, trump);
    const winnerIsPartner = sides[best.seat] === mySide;
    const isLast = trick.length === 3;
    const behindOpp = []; // tegenspelers die nog moeten spelen
    for (let i = trick.length + 1; i < 4; i++) { const s = (trick[0].seat + i) % 4; if (sides[s] !== mySide) behindOpp.push(s); }
    const partnerSure = winnerIsPartner && suitOf(best.card) === leadSuit &&
      rankOf(best.card) > highestOutside(out, hand, leadSuit) &&
      !(trump >= 0 && leadSuit !== trump && behindOpp.some(o => voidKnown[o][leadSuit]));

    const legal = groups[leadSuit];
    if (legal.length) {
      if (partnerSure) return lowest(legal);
      const canWin = legal.filter(c => beats(c, best.card, leadSuit, trump));
      if (!canWin.length) return lowest(legal);
      if (isLast) return lowest(canWin);
      const hi = highest(legal);
      if (rankOf(hi) > highestOutside(out, hand, leadSuit) && !(trump >= 0 && leadSuit !== trump && behindOpp.some(o => voidKnown[o][leadSuit]))) return hi;
      if (winnerIsPartner) return lowest(legal);
      if (trick.length === 2) return hi;          // derde hand hoog
      return lowest(legal);                        // tweede hand laag
    }

    // renonce
    const trumps = (trump >= 0 && leadSuit !== trump) ? groups[trump] : [];
    if (!winnerIsPartner && trumps.length) {
      const over = trumps.filter(c => beats(c, best.card, leadSuit, trump));
      if (over.length) return lowest(over);
    }
    // afgooien, liefst geen zekere winnaar.
    // speler: laagste kaart uit de kortste bijkleur (renonces maken om te kunnen troeven)
    // tegenspeler: eerst uit een kleur waar de speler renonce is, anders uit de langste kleur (korte kleuren gedekt houden)
    let pool = hand.filter(c => suitOf(c) !== trump);
    if (!pool.length) return lowest(hand);
    const notWinner = pool.filter(c => rankOf(c) <= highestOutside(out, hand, suitOf(c)));
    if (notWinner.length) pool = notWinner;
    if (!isDecl) {
      const safe = pool.filter(c => anyOppVoid(suitOf(c)));
      if (safe.length) return lowest(safe);
    }
    const g = bySuit(pool);
    let bs = -1;
    for (let s = 0; s < 4; s++) {
      if (!g[s].length) continue;
      if (bs < 0) { bs = s; continue; }
      if (isDecl ? g[s].length < g[bs].length : g[s].length > g[bs].length) bs = s;
    }
    return lowest(g[bs]);
  }

  /* ---------- heuristiek: miserie (geen troef) ---------- */
  function chooseMisere(seat, hand, trick, st) {
    const { out, voidKnown, declarer, open, hands } = st;
    const groups = bySuit(hand);
    const isDecl = seat === declarer;
    const dHand = open ? hands[declarer] : null;
    const danger = c => countOutside(out, hand, suitOf(c), rankOf(c)); // ongespeelde lagere kaarten buiten mijn hand

    if (isDecl) {
      if (trick.length === 0) {
        let best = hand[0], bd = danger(best);
        for (const c of hand) {
          const d = danger(c);
          if (d < bd || (d === bd && (rankOf(c) < rankOf(best) ||
            (rankOf(c) === rankOf(best) && groups[suitOf(c)].length > groups[suitOf(best)].length)))) { best = c; bd = d; }
        }
        return best;
      }
      const leadSuit = suitOf(trick[0].card);
      const legal = groups[leadSuit];
      if (legal.length) {
        const cur = rankOf(currentBest(trick, -1).card);
        const under = legal.filter(c => rankOf(c) < cur);
        return under.length ? highest(under) : highest(legal);
      }
      // afgooien: gevaarlijkste kaart
      let best = hand[0], bd = -1;
      for (const c of hand) { const d = danger(c); if (d > bd || (d === bd && rankOf(c) > rankOf(best))) { best = c; bd = d; } }
      return best;
    }

    // tegenspeler
    // Tegenspelers weten (open) of schatten goed in (gesloten: ervaren spelers lezen kleurlengtes uit het bieden en de eerste slagen)
    // in welke kleuren de miseriespeler nog kaarten heeft; een kleur waar hij renonce is geeft hem een gratis afgooi.
    const dHas = s => hands[declarer].some(c => suitOf(c) === s);
    const dMin = s => { let m = 99; for (const c of dHand) if (suitOf(c) === s && rankOf(c) < m) m = rankOf(c); return m; };
    const dMax = s => { let m = 0; for (const c of dHand) if (suitOf(c) === s && rankOf(c) > m) m = rankOf(c); return m; };

    if (trick.length === 0) {
      // Kies de kleur waarin de miseriespeler het meest kwetsbaar is. Nooit een kleur waar hij renonce is
      // (dat is een gratis afgooi). Open: exacte kennis. Gesloten: kleuren die hij al bekende, anders de
      // kleur waarin ik zelf kort ben (daar zit hij waarschijnlijk lang).
      let bestCard = null, bestScore = -Infinity;
      for (let s = 0; s < 4; s++) {
        if (!groups[s].length || !dHas(s)) continue;
        let score, card;
        if (open) {
          const m = dMin(s);
          const below = groups[s].filter(c => rankOf(c) < m);
          if (below.length) { score = 100 + m + dMax(s) / 20; card = lowest(groups[s]); }   // dwing hem erboven, de rest duikt eronder
          else { score = -2 * rankOf(lowest(groups[s])) - 1.5 * groups[s].length + dMax(s) / 10; card = lowest(groups[s]); }
        } else {
          // een echt lage kaart (2, 3, 4) dwingt hem erboven; een kleur waarin ik lang ben heeft hij wellicht niet
          score = (st.seen[declarer][s] ? 8 : 0) - 2 * rankOf(lowest(groups[s])) - 1.5 * groups[s].length;
          card = lowest(groups[s]);
        }
        if (score > bestScore) { bestScore = score; bestCard = card; }
      }
      return bestCard !== null ? bestCard : lowest(hand);
    }

    const leadSuit = suitOf(trick[0].card);
    const legal = groups[leadSuit];
    const bestP = currentBest(trick, -1);
    const cur = rankOf(bestP.card);
    const dPlayed = trick.some(p => p.seat === declarer);
    if (legal.length) {
      if (dPlayed) {
        if (bestP.seat === declarer) {
          const under = legal.filter(c => rankOf(c) < cur);
          return under.length ? highest(under) : highest(legal);
        }
        return highest(legal); // speler wint toch niet meer: hoge kaart kwijtspelen
      }
      if (!dHas(leadSuit)) return highest(legal);
      return lowest(legal); // laag blijven zodat hij erboven moet
    }
    return highest(hand); // renonce: hoogste kaart kwijt
  }

  /* ---------- één spel uitspelen ---------- */
  function playGame(hands0, opts) {
    const hands = hands0.map(h => h.slice());
    const out = [0, 1, 2, 3].map(() => new Array(15).fill(false));
    const voidKnown = [0, 1, 2, 3].map(() => [false, false, false, false]);
    const seen = [0, 1, 2, 3].map(() => [false, false, false, false]); // heeft deze kleur bekend (dus had ze)
    const st = { trump: opts.trump, sides: opts.sides, out, voidKnown, seen, declarer: opts.declarer, open: !!opts.open, hands };
    const tricks = [0, 0, 0, 0];
    let leader = opts.leader;
    const choose = opts.mode === 'misere' ? chooseMisere : chooseTricks;
    for (let t = 0; t < 13; t++) {
      const trick = [];
      for (let i = 0; i < 4; i++) {
        const seat = (leader + i) % 4;
        const card = choose(seat, hands[seat], trick, st);
        hands[seat].splice(hands[seat].indexOf(card), 1);
        if (trick.length && suitOf(card) !== suitOf(trick[0].card)) voidKnown[seat][suitOf(trick[0].card)] = true;
        else seen[seat][suitOf(card)] = true;
        out[suitOf(card)][rankOf(card)] = true;
        trick.push({ seat, card });
      }
      const w = currentBest(trick, opts.trump).seat;
      tricks[w]++; leader = w;
    }
    return tricks;
  }

  /* ---------- simulatie ---------- */
  // params: { hand:[13 ids], tableTrump:0..3, position:0..3 (3 = deler), n, seed }
  function createSimulation(params) {
    const { hand, tableTrump, position } = params;
    const n = params.n || 500;
    const rand = rng(params.seed || 12345);
    const me = position;
    const others = [0, 1, 2, 3].filter(s => s !== me);
    const rest = []; for (let c = 0; c < 52; c++) if (!hand.includes(c)) rest.push(c);

    const configs = [];
    for (let s = -1; s < 4; s++) configs.push({ key: 'own' + s, mode: 'tricks', trump: s, leader: me, alone: true });
    configs.push({ key: 'alleen', mode: 'tricks', trump: tableTrump, leader: 0, alone: true });
    configs.push({ key: 'vragen', mode: 'tricks', trump: tableTrump, leader: 0, partner: true });
    configs.push({ key: 'meegaan', mode: 'tricks', trump: tableTrump, leader: 0, partner: true, strong: true });
    configs.push({ key: 'miserie', mode: 'misere', trump: -1, leader: 0, alone: true });
    configs.push({ key: 'open', mode: 'misere', trump: -1, leader: 0, alone: true, open: true });
    const dist = {}; for (const c of configs) dist[c.key] = new Array(14).fill(0);
    let done = 0;

    function deal() {
      shuffle(rest, rand);
      const hands = [[], [], [], []];
      hands[me] = hand.slice();
      let idx = 0;
      if (me !== 3) { // de deler heeft de keerkaart: minstens één troef
        const ti = rest.findIndex(c => suitOf(c) === tableTrump);
        if (ti >= 0) { hands[3].push(rest[ti]); rest.splice(ti, 1); rest.push(hands[3][0]); } // naar achteren, wordt niet opnieuw gedeeld
      }
      for (const s of others) {
        const need = 13 - hands[s].length;
        for (let k = 0; k < need; k++) hands[s].push(rest[idx++]);
      }
      return hands;
    }

    function step(k) {
      for (let i = 0; i < k && done < n; i++, done++) {
        const hands = deal();
        for (const cfg of configs) {
          const sides = [1, 1, 1, 1]; sides[me] = 0;
          let partner = -1, h = hands;
          if (cfg.partner) {
            let pool;
            if (cfg.strong) {
              // meegaan: de vrager heeft een echte troefhand (≥ 4 troeven, of 3 met aas of heer). Herdeel tot er zo iemand is.
              const asker = s => { const t = h[s].filter(c => suitOf(c) === tableTrump); return t.length >= 4 || (t.length === 3 && t.some(c => rankOf(c) >= 13)); };
              pool = others.filter(asker);
              for (let tries = 0; !pool.length && tries < 30; tries++) { h = deal(); pool = others.filter(asker); }
              if (!pool.length) pool = others.filter(s => h[s].some(c => suitOf(c) === tableTrump));
            } else {
              pool = others.filter(s => h[s].some(c => suitOf(c) === tableTrump));
            }
            if (!pool.length) pool = others;
            partner = pool[(rand() * pool.length) | 0];
            sides[partner] = 0;
          }
          const tr = playGame(h, { mode: cfg.mode, trump: cfg.trump, sides, leader: cfg.leader, declarer: me, open: cfg.open });
          const mine = tr[me] + (partner >= 0 ? tr[partner] : 0);
          dist[cfg.key][mine]++;
        }
      }
      return done;
    }

    function pAtLeast(d, k) { let s = 0; for (let i = k; i <= 13; i++) s += d[i]; return s / done; }
    function pExact(d, k) { return d[k] / done; }

    function result() {
      const aces = hand.filter(c => rankOf(c) === 14).length;
      const out = [];
      const norm = d => d.map(x => x / done);

      // vragen
      {
        const d = dist.vragen; const p = pAtLeast(d, 8);
        let ev = 0; for (let t = 0; t <= 13; t++) ev += (d[t] / done) * VRAGEN[t];
        out.push({ id: 'vragen', name: 'Vragen', sub: 'met partner, troef ' + SUIT_SYM[tableTrump] + ' · samen ≥ 8 slagen', p, ev, dist: norm(d), target: 8, type: 'tricks' });
      }
      {
        const d = dist.meegaan; const p = pAtLeast(d, 8);
        let ev = 0; for (let t = 0; t <= 13; t++) ev += (d[t] / done) * VRAGEN[t];
        out.push({ id: 'meegaan', name: 'Meegaan', sub: 'iemand vraagt in ' + SUIT_SYM[tableTrump] + ' (≥ 4 troeven of 3 met A/H) · samen ≥ 8 slagen', p, ev, dist: norm(d), target: 8, type: 'tricks' });
      }
      {
        const d = dist.alleen; const p = pAtLeast(d, 5);
        let ev = 0; for (let t = 0; t <= 13; t++) ev += (d[t] / done) * ALLEEN[t];
        out.push({ id: 'alleen', name: 'Alleen gaan', sub: 'troef ' + SUIT_SYM[tableTrump] + ' · ≥ 5 slagen', p, ev, dist: norm(d), target: 5, type: 'tricks' });
      }
      for (const k of [9, 10, 11, 12]) {
        let bestS = tableTrump, bestP = -1;
        for (const s of [tableTrump, 0, 1, 2, 3]) { const p = pAtLeast(dist['own' + s], k); if (p > bestP + 1e-9) { bestP = p; bestS = s; } }
        const w = ABONDANCE[k];
        out.push({ id: 'ab' + k, name: 'Abondance ' + k, sub: 'troef ' + SUIT_SYM[bestS] + (bestS === tableTrump ? ' (tafel)' : '') + ' · ≥ ' + k + ' slagen', p: bestP, ev: bestP * w - (1 - bestP) * w, dist: norm(dist['own' + bestS]), target: k, suit: bestS, type: 'tricks' });
      }
      {
        const p = pExact(dist.miserie, 0);
        out.push({ id: 'miserie', name: 'Miserie', sub: 'geen enkele slag', p, ev: p * MISERIE - (1 - p) * MISERIE, dist: norm(dist.miserie), target: 0, type: 'misere' });
        const po = pExact(dist.open, 0);
        out.push({ id: 'open', name: 'Miserie op tafel', sub: 'kaarten open · geen enkele slag', p: po, ev: po * OPEN_MISERIE - (1 - po) * OPEN_MISERIE, dist: norm(dist.open), target: 0, type: 'misere' });
      }
      {
        let bestS = tableTrump, bestP = -1;
        for (const s of [tableTrump, 0, 1, 2, 3, -1]) { const p = pExact(dist['own' + s], 13); if (p > bestP + 1e-9) { bestP = p; bestS = s; } }
        out.push({ id: 'solo', name: 'Solo', sub: (bestS < 0 ? 'zonder troef' : 'troef ' + SUIT_SYM[bestS]) + ' · alle 13 slagen', p: bestP, ev: bestP * SOLO - (1 - bestP) * SOLO, dist: norm(dist['own' + bestS]), target: 13, suit: bestS, type: 'tricks' });
        const ps = pExact(dist['own' + tableTrump], 13);
        out.push({ id: 'slim', name: 'Solo-slim', sub: 'troef ' + SUIT_SYM[tableTrump] + ' (tafel) · alle 13 slagen', p: ps, ev: ps * SOLOSLIM - (1 - ps) * SOLOSLIM, dist: norm(dist['own' + tableTrump]), target: 13, type: 'tricks' });
      }
      return { n: done, troel: aces >= 3, troela: aces === 4, aces, contracts: out };
    }

    return { step, result, get done() { return done; }, n };
  }

  function simulate(params) { const sim = createSimulation(params); sim.step(sim.n); return sim.result(); }

  const api = { createSimulation, simulate, playGame, mk, suitOf, rankOf, cardStr, SUIT_SYM, SUIT_NAME, RANK_SYM, ALLEEN, VRAGEN, ABONDANCE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.WiezenEngine = api;
})(typeof self !== 'undefined' ? self : this);
