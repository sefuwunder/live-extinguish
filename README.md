# LIVE/EXTINGUISH — a game as poetry

*Shenmue realism meets zen earth puzzle. Two 16×16 plots of living land — rural Fishkill, urban Brooklyn — fed by gifts falling from the sky.*

## How to play

1. `bun server.ts` (or `bun --hot server.ts`), open http://127.0.0.1:3022
2. Read the opening haiku, press **begin**.
3. Items fall from the sky into two staging trays. **Tap a gift, then tap the earth** where it belongs — either grid.
4. Grow grass 🌱, flowers 🌸, and trees 🌳. Tend water, clear smog, put out fires.
5. The round ends the moment any tree reaches full crown (growth 100) — a celebration naming the winning plot and the time it took. If no tree crowns within 20 minutes, the round closes wistfully. Best live score and fastest fruition are kept in localStorage.

**Goal:** raise a tree to its full crown. A dedicated, watering player earns one in about 5–8 minutes. Brooklyn's concrete is stubborn — convert it with 🟤 soil and terraform patiently. Fishkill is generous but fire still visits.

## The gifts

| sky-fall | what it does |
|---|---|
| 🌱 grass seed | plant on soil; spreads when mature |
| 🌸 flower seed | mature blooms boost neighbors (pollinators) |
| 🌳 tree seed | slow, worth the most |
| ☁️ fresh oxygen | clears pollution in 3×3 |
| 🌫️ smog | +pollution in 3×3 (a burden; expires from tray in 45s) |
| 🪰 flies | harms flowers/seedlings, may scatter flower seeds (expires in 45s) |
| 🔥 fire | sets a tile alight |
| 💧 water | soaks a tile; extinguishes fire |
| 🟤 soil | turns concrete into plantable soil, forever |
| ☀️ sunburst | growth burst + dries soil in 3×3 |
| ❄️ cold snap | growth pauses grid-wide 20s; tender flowers suffer |
| 💨 wind gust | dries the grid; carries seeds to random tiles |

Trays hold 12 each — a full tray lets new gifts fade away (impermanence).

## The simulation (tick ≈ 800ms)

Each tile tracks ground (soil/concrete), water 0–100, pollution 0–100, **soil fertility 0–100**, a plant (kind + growth 0–100), fire intensity, and ash memory.

- Plants grow when water > 30, pollution < 60, and no cold snap. Fishkill ×1.3, Brooklyn ×0.7.
- Water evaporates; rain soaks and kills all fire; heat ignites dry planted tiles.
- Fire spreads to dry neighbors, destroys plants, leaves **ash** that feeds what comes next. Slash-and-burn has a purpose.
- Grass spreads to adjacent empty soil at maturity. Trees are slow and precious.
- **Tree shade:** each tree casts an organic canopy blob — 15 tiles at growth 100 (a Manhattan diamond of 13 plus 2 seeded-irregular ring-3 tiles, unique per tree), a 5-tile plus at 60–99, none below. Shaded soil evaporates slower (×(1 − 0.25 × shade)) and grass/flowers grow slower under canopy (×(1 − 0.12 × shade), capped at 3 overlapping canopies); trees don't mind the shade.
- **Soil fertility:** rich loam in Fishkill (60–80), thin urban soil in Brooklyn (20–40), near-sterile under concrete (10). Mature grass builds it (+0.5/tick, worm casts); growing plants drink from it (0.1 × growth gained); death by fire, cold, or flies composts it (+15). Flowers only germinate above 30, trees above 50 — grass pioneers, flowers follow, trees crown the arc. Brooklyn terraforms over a season.
- **Thirst:** plants drink each tick (grass 0.3, flower 0.5, tree 0.8 × growth/100). Below 15 water a plant **wilts** — growth pauses, the model droops and desaturates — and recovers when watered. Zen, never punishing.
- **Crowding:** germination is halved when 4+ neighboring tiles hold mature plants.
- **Bees:** where 3+ mature flowers bloom within radius 3, bees arrive (max 6 per plot). They wander toward blossoms, boost nearby growth ×1.2, and leave when the patch is gone.
- **Birds:** every 45–90s a bird glides across a plot and drops 1–2 tree seeds under its path (marked briefly by a white speck) — long-distance dispersal, the main way trees travel now.
- **Growth is an event:** seeds burst into 6–10 rising green motes plus a soft ring pulse; crossing a growth stage pops the plant to 1.25× scale, settling with an easeOutBack bounce over 0.5s. Young growth is pale yellow-green, maturity a deep saturated green.
- **LIVE score:** grass ×1 + flowers ×3 + trees ×5 per grid (half value while young).
- **EXTINGUISH:** fires put out, counted with quiet pride.

## Architecture

- `server.ts` — Bun.serve static file server, port 3022, zero dependencies.
- `app.js` — game state, simulation core, and UI. The sim (`createGrid`, `tickGrid`, `applyItem`, `scoreGrid`, …) is pure and DOM-free, exported for tests and **unchanged by the 3D conversion**; UI/render/audio boot only when `document` exists.
- `models3d.js` — procedural 3D model builders (no assets): boxes, cones, cylinders, low-poly spheres, plus grass tufts, flowers, trees, flames, smoke, clouds, sun, rain streaks, sky-dome, and per-item falling tokens. A `Batcher` merges everything into opaque + transparent draw layers.
- `engine3d.js` — native WebGL1 engine (raw WebGL, no Three.js): one shader (vertex colors + normals, single directional light + ambient, fog, per-vertex emissive), orbit/zoom camera, ray-plane tile picking, and the `Scene3D` orchestrator (static terrain layer, per-tick plant layer, per-frame FX layer).
- `index.html` / `styles.css` — layout and the zen earth palette (paper, terracotta, sage, bark). One full-width WebGL canvas holds both plots; masthead, trays, haiku overlays, and counters are unchanged DOM.
- The 2D canvas functions (`renderGrid`/`renderSky`) remain in app.js as the tested legacy renderer; the game itself renders in 3D.
- WebAudio: soft pentatonic plucks on placement, a low drum on ignition, rain patter. 🔔 mutes. 🍃 toggles reduced motion (also honors `prefers-reduced-motion`).
- `?seed=` query param gives a deterministic RNG for testing.
- No build step, no database (in-memory; best scores in localStorage).

## 3D controls

- **Drag** to orbit (azimuth + clamped elevation) · **scroll / pinch** to zoom · **tap** a tray gift, then **tap the earth** to place it.
- Hover highlights the tile under the cursor (mouse). A gentle idle sway moves the camera (off under reduced motion).
- If WebGL is unavailable (or the context is lost), a quiet message appears with a reload button instead of the canvas.

## Tests

`bun test` — 66 tests: 41 original (34 simulation unit tests — growth rules, fire spread/extinguish, grass spreading, smog stunting, seed-on-concrete, scoring math, tray caps, hazard expiry — plus 7 legacy 2D render smoke tests, all unmodified and passing) + 25 new 3D engine tests (world↔tile mapping, picking round-trips, matrix math, camera clamps, model-builder geometry validity, batching, graceful WebGL fallback, scene orchestration on a stubbed renderer).
