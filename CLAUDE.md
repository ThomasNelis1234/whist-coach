# Whist Coach

Static PWA (no build step, no dependencies) that advises on bidding in Belgian whist ("wiezen", IWWA federation
rules). UI text is Dutch; keep it Dutch.

## Commands

- `npm test` — runs `test/run.js` (plain Node asserts). Run after every change to `engine.js` or `detector.js`.
- `python -m http.server 5173` — serve locally; open http://localhost:5173.

## Layout

- `engine.js` — pure logic, UMD (works in browser as `WiezenEngine` and in Node via `require`). Card id =
  `suit*13 + rank-2`; suits 0=♣ 1=♦ 2=♥ 3=♠; rank 2..14. Seat 0 = player after the dealer, seat 3 = dealer.
  `createSimulation({hand, tableTrump, position, n, seed})` → `.step(k)` / `.result()`.
- `detector.js` — on-device card recognition with onnxruntime-web (loaded lazily from jsDelivr) and
  `model/model.onnx`. Pure helpers (`decode`, `toCards`, `parseCode`, `normalizeClasses`) are unit-tested;
  the browser part is not.
- `app.js` — DOM only. No logic that belongs in the engine.
- `sw.js` — network-first for app files, cache-first for model/CDN/fonts. Bump `SHELL` when the file list changes.

## Rules of thumb

- Keep `engine.js` free of DOM access so tests keep running in Node.
- Scoring tables at the top of `engine.js` come from the IWWA sheet (version 1, 01-10-2025); do not change them
  without the source.
- When tuning a heuristic, add or adjust a control hand in `test/run.js` first. The "long hearts with A and K is
  not a misère" test guards a past regression (defenders leading suits the declarer is void in).
- `model/model.onnx` and `model/model.classes.json` are committed on purpose (Vercel must serve them).
- Deployed on Vercel as a static site (preset "Other", no build command).
