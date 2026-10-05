# LIVE/EXTINGUISH — a game as poetry

*Shenmue realism meets zen earth puzzle. Two 16×16 plots of living land — rural Fishkill, urban Brooklyn — fed by gifts falling from the sky.*

## How to play

1. `bun server.ts` (or `bun --hot server.ts`), open http://127.0.0.1:3022
2. Read the opening haiku, press **begin**.
3. Items fall from the sky into two staging trays. **Tap a gift, then tap the earth** where it belongs — either grid.
4. Grow grass 🌱, flowers 🌸, and trees 🌳. Tend water, clear smog, put out fires.
5. After 5 minutes the season ends with a closing haiku and the totals. Best season is kept in localStorage.

**Goal:** the most living green on *both* lands. Brooklyn's concrete is stubborn — convert it with 🟤 soil. Fishkill is generous but fire still visits.

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

Each tile tracks ground (soil/concrete), water 0–100, pollution 0–100, a plant (kind + growth 0–100), fire intensity, and ash memory.

- Plants grow when water > 30, pollution < 60, and no cold snap. Fishkill ×1.3, Brooklyn ×0.7.
- Water evaporates; rain soaks and kills all fire; heat ignites dry planted tiles.
- Fire spreads to dry neighbors, destroys plants, leaves **ash** that feeds what comes next. Slash-and-burn has a purpose.
- Grass spreads to adjacent empty soil at maturity. Trees are slow and precious.
- **LIVE score:** grass ×1 + flowers ×3 + trees ×5 per grid (half value while young).
- **EXTINGUISH:** fires put out, counted with quiet pride.

## Architecture

- `server.ts` — Bun.serve static file server, port 3022, zero dependencies.
- `app.js` — the whole game. The simulation core (`createGrid`, `tickGrid`, `applyItem`, `scoreGrid`, …) is pure and DOM-free, exported for tests; UI/render/audio boot only when `document` exists.
- `index.html` / `styles.css` — layout and the zen earth palette (paper, terracotta, sage, bark).
- Canvas rendering: organic tiles, growth-staged plants, flickering fire, water sheen, smog haze, sky strips with falling gifts, drifting clouds, and a dawn→dusk sun arc across the season.
- WebAudio: soft pentatonic plucks on placement, a low drum on ignition, rain patter. 🔔 mutes. 🍃 toggles reduced motion (also honors `prefers-reduced-motion`).
- `?seed=` query param gives a deterministic RNG for testing.
- No build step, no database (in-memory; best scores in localStorage).

## Tests

`bun test` — 41 tests: 34 simulation unit tests (growth rules, fire spread/extinguish, grass spreading, smog stunting, seed-on-concrete, scoring math, tray caps, hazard expiry) + 7 stubbed-canvas render smoke tests.
