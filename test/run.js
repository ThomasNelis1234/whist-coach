/* Tests zonder afhankelijkheden: `node test/run.js` (of `npm test`). */
const assert = require('assert');
const E = require('../engine.js');
const D = require('../detector.js');

const S = { c: 0, d: 1, h: 2, s: 3 };
const R = { A: 14, K: 13, Q: 12, J: 11, T: 10 };
const hand = str => str.trim().split(/\s+/).map(t => E.mk(S[t[0]], R[t[1]] || parseInt(t.slice(1), 10)));
const sim = (h, extra) => {
  const res = E.simulate(Object.assign({ hand: hand(h), tableTrump: 3, position: 0, n: 400, seed: 7 }, extra));
  const by = {}; for (const c of res.contracts) by[c.id] = c;
  return { res, by };
};
let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

/* ---------- rekenmotor ---------- */
test('solo-hand haalt alles', () => {
  const { by, res } = sim('sA sK sQ sJ sT s9 s8 s7 s6 hA hK hQ dA');
  assert.strictEqual(by.solo.p, 1); assert.strictEqual(by.slim.p, 1); assert.strictEqual(by.ab12.p, 1);
  assert.strictEqual(by.miserie.p, 0); assert.strictEqual(res.troel, true);
});
test('sterke abondance: 9 en 10 zeker, 11 zelden', () => {
  const { by } = sim('sA sK sQ sJ sT s9 s8 hA hK dA c7 c5 c3');
  assert.strictEqual(by.ab9.p, 1); assert.strictEqual(by.ab10.p, 1);
  assert.ok(by.ab11.p < 0.25, 'ab11 ' + by.ab11.p); assert.ok(by.alleen.ev > 15);
});
test('lage hand is een goede miserie', () => {
  const { by } = sim('s2 s3 s5 h2 h4 h6 h7 d3 d5 d8 c2 c4 c6');
  assert.ok(by.miserie.p > 0.7, 'miserie ' + by.miserie.p); assert.ok(by.open.p > 0.7); assert.ok(by.alleen.p < 0.05);
});
test('lange harten met A en H is géén miserie (verdediging vermijdt renonces)', () => {
  for (const position of [0, 3]) {
    const { by } = sim('hA hK hT h9 h8 h7 h4 h2 d9 d5 d4 cK c5', { position, n: 600 });
    assert.ok(by.miserie.p < 0.12, 'miserie ' + by.miserie.p); assert.ok(by.open.p < 0.12, 'open ' + by.open.p);
  }
});
test('doorsnee hand: alles onder de passen-lijn, meegaan beter dan vragen', () => {
  const { by, res } = sim('sK s9 s4 hQ hJ h8 h3 dA d7 d2 cT c6 c5');
  for (const c of res.contracts) assert.ok(c.ev < 0, c.id + ' ' + c.ev);
  assert.ok(by.meegaan.p > by.vragen.p);
});
test('kansverdelingen sommeren tot 1', () => {
  const { res } = sim('sK s9 s4 hQ hJ h8 h3 dA d7 d2 cT c6 c5');
  for (const c of res.contracts) assert.ok(Math.abs(c.dist.reduce((a, b) => a + b, 0) - 1) < 1e-9, c.id);
});
test('elk spel verdeelt precies 13 slagen', () => {
  const deck = Array.from({ length: 52 }, (_, i) => i);
  const hands = [deck.slice(0, 13), deck.slice(13, 26), deck.slice(26, 39), deck.slice(39)];
  for (const mode of ['tricks', 'misere']) {
    const tr = E.playGame(hands, { mode, trump: mode === 'tricks' ? 2 : -1, sides: [0, 1, 1, 1], leader: 0, declarer: 0 });
    assert.strictEqual(tr.reduce((a, b) => a + b, 0), 13);
  }
});

/* ---------- kaartherkenning (zuivere functies; het model zelf draait enkel in de browser) ---------- */
test('parseCode', () => {
  assert.deepStrictEqual(D.parseCode('10C'), { suit: 0, rank: 10 });
  assert.deepStrictEqual(D.parseCode('AS'), { suit: 3, rank: 14 });
  assert.deepStrictEqual(D.parseCode('td'), { suit: 1, rank: 10 });
  assert.deepStrictEqual(D.parseCode('2H'), { suit: 2, rank: 2 });
  assert.strictEqual(D.parseCode('joker'), null);
});
test('normalizeClasses aanvaardt lijst, index→code, code→index en {names}', () => {
  assert.deepStrictEqual(D.normalizeClasses(['10C', 'AS']), ['10C', 'AS']);
  assert.deepStrictEqual(D.normalizeClasses({ 0: '10C', 1: 'AS' }), ['10C', 'AS']);
  assert.deepStrictEqual(D.normalizeClasses({ '10C': 0, AS: 1 }), ['10C', 'AS']);
  assert.deepStrictEqual(D.normalizeClasses({ names: { 0: '10C', 1: 'AS' } }), ['10C', 'AS']);
});
test('decode: standaard YOLO-uitvoer [1, 4+nc, N] met NMS en twee hoeken per kaart', () => {
  const nc = 52, N = 5, C = 4 + nc, data = new Float32Array(C * N);
  const put = (i, cx, cy, w, h, cls, score) => { data[0 * N + i] = cx; data[1 * N + i] = cy; data[2 * N + i] = w; data[3 * N + i] = h; data[(4 + cls) * N + i] = score; };
  put(0, 100, 100, 20, 30, 7, 0.9);    // kaart 7, linkerbovenhoek
  put(1, 101, 100, 20, 30, 7, 0.6);    // zelfde hoek, overlapt -> weg door NMS
  put(2, 300, 400, 20, 30, 7, 0.8);    // kaart 7, andere hoek -> blijft als detectie, wordt één kaart
  put(3, 500, 100, 20, 30, 12, 0.5);
  put(4, 50, 500, 20, 30, 3, 0.1);     // onder de drempel
  const dets = D.decode(data, [1, C, N], nc, 0.3);
  assert.strictEqual(dets.length, 3);
  const classes = Array.from({ length: 52 }, (_, i) => ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'][i % 13] + 'CDHS'[(i / 13) | 0]);
  const cards = D.toCards(dets, classes);
  assert.deepStrictEqual(cards.map(c => c.code), ['9C', 'AC']);
  assert.ok(Math.abs(cards[0].score - 0.9) < 1e-6);
});
test('decode: getransponeerde uitvoer [1, N, 4+nc] en NMS-export [1, N, 6]', () => {
  const nc = 52, C = 4 + nc, N = 2, t = new Float32Array(N * C);
  t[0] = 10; t[1] = 10; t[2] = 4; t[3] = 4; t[4 + 5] = 0.7;
  assert.deepStrictEqual(D.decode(t, [1, N, C], nc, 0.3).map(d => d.cls), [5]);
  const e2e = new Float32Array([0, 0, 10, 10, 0.8, 51, 0, 0, 5, 5, 0.1, 3]);
  assert.deepStrictEqual(D.decode(e2e, [1, 2, 6], nc, 0.3).map(d => d.cls), [51]);
});

console.log('\n' + n + ' tests geslaagd');
