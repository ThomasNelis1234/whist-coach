# Whist Coach

Hulp bij het bieden in wiezen (Belgische whist, regels en puntentelling Federatie IWWA). Je geeft je 13 kaarten in
(foto of aantikken), de troef op tafel en je plaats ten opzichte van de deler. De app speelt honderden willekeurige
verdelingen van de overige 39 kaarten uit en toont per contract je slaagkans en verwachte punten.

Statische PWA zonder build-stap: geen npm-pakketten, geen server, geen API-sleutel.

## Eerst: het herkenningsmodel toevoegen

De fotoknop gebruikt een YOLO11-model dat in de browser draait. Het zit niet in deze map; download het één keer:

1. Ga naar https://huggingface.co/sroot/lgd-cards-gen3 → "Files and versions".
2. Download `model.onnx` en `model.classes.json`.
3. Zet beide in de map `model/`.

Zonder model werkt alles behalve de fotoknop (die meldt dan dat het model ontbreekt).

## Lokaal draaien

De pagina moet via een webserver geopend worden (niet door te dubbelklikken op index.html):

```
python -m http.server 5173
```

of `npm start`. Open daarna http://localhost:5173.

## Testen

```
npm test
```

Draait de rekenmotor op controlehanden en test de decodeerlogica van de herkenning. Het model zelf draait
enkel in de browser en wordt hier niet getest.

## Naar GitHub

```
git init -b main
git add .
git commit -m "Whist Coach: rekenmotor, PWA en kaartherkenning"
```

Maak op github.com een lege, **publieke** repository `whist-coach` aan (zie Licentie) en volg de twee regels
die GitHub toont onder "push an existing repository".

## Online zetten met Vercel

1. vercel.com → Add New → Project → kies de GitHub-repository.
2. Framework Preset: **Other**. Build Command en Output Directory leeg laten.
3. Deploy. Elke `git push` publiceert daarna automatisch.

## Op je iPhone

Open de Vercel-URL in Safari → deelknop → "Zet op beginscherm". De eerste foto downloadt het model
(eenmalig, enkele tientallen MB); daarna werkt de app ook offline.

## Structuur

| Bestand | Inhoud |
| --- | --- |
| `engine.js` | Rekenmotor: delen, heuristische spelers, puntentabel, Monte Carlo. Geen DOM, draait ook in Node. |
| `detector.js` | Kaartherkenning: foto → 640×640 → ONNX-model → lijst kaarten. |
| `app.js` | Interface: kaartkiezer, instellingen, resultaten. |
| `index.html`, `styles.css` | Pagina en opmaak (licht en donker thema). |
| `sw.js`, `manifest.webmanifest`, `icons/` | PWA: offline gebruik en installatie. |
| `model/` | Hier komen `model.onnx` en `model.classes.json`. |
| `test/run.js` | Tests zonder afhankelijkheden. |

## Wat de motor (nog) niet doet

- Spelers volgen vaste vuistregels, geen perfect spel. Tegenspelers trekken geen troef terug tegen abondance.
- Vragen/meegaan: de partner is willekeurig (vragen: minstens één troef; meegaan: de vrager heeft minstens
  4 troeven of 3 met aas of heer).
- Miserie: de tegenspelers weten in welke kleuren je renonce bent. Geen ruil van de keerkaart, geen
  meerdere miseriespelers tegelijk.
- Troel wordt gemeld (3 of 4 azen) maar niet doorgerekend.
- Het bieden zelf (wie overbiedt wie) zit er niet in: de app rekent elk contract apart door.

## Herkenning: wat je mag verwachten

Het model is getraind op beelden van casinotafels, niet op kaarten in de hand. Controleer daarom altijd de
herkende kaarten; twijfelgevallen blijven even oranje omrand. Tips: goed licht, en van elke kaart de hoek
met rang en kleur zichtbaar.

## Licentie

Het herkenningsmodel is AGPL-3.0 (afgeleid van Ultralytics YOLO11). Wie de app met dat model online
aanbiedt, moet de broncode beschikbaar stellen; een publieke GitHub-repository volstaat. Voeg een
`LICENSE`-bestand toe via GitHub (Add file → Create new file → `LICENSE` → kies "GNU AGPLv3").
