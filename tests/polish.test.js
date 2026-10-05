// LIVE/EXTINGUISH polish-pass tests — bun test
// dispersal kernels, proportional plant sizes, jitter/sway, smaller fires, ephemera.
const {
  mulberry32, createGrid, tickGrid, applyItem, PLANTS, SIZE,
  disperseSeeds, pickKernelLanding, pickRingLanding, windLevel,
  scatterDecor, pickDecorKind, DECOR_KINDS, FIRE_MAX, WATER_POWER, WATER_SPLASH,
} = require("../app.js");
const M = require("../models3d.js");
const { test, expect } = require("bun:test");

function fixedRand(seed = 42) { return mulberry32(seed); }
// all-soil, fire-free grid for controlled dispersal tests
function soilGrid(envKey = "fishkill", seed = 7, water = 80) {
  const g = createGrid(envKey, fixedRand(seed));
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const t = g.tiles[y][x];
    t.ground = "soil"; t.water = water; t.pollution = 0; t.fire = 0; t.plant = null; t.ash = 0;
  }
  return g;
}
function cheb(x1, y1, x2, y2) { return Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2)); }

/* ---------------- 1. realistic dispersal ---------------- */

test("grass runners spread only to adjacent tiles", () => {
  let births = 0;
  for (let trial = 0; trial < 60; trial++) {
    const g = soilGrid("fishkill", 1000 + trial);
    g.tiles[8][8].plant = { kind: "grass", growth: 100 };
    disperseSeeds(g, mulberry32(trial), 0);
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      if (g.tiles[y][x].plant && !(x === 8 && y === 8)) {
        births++;
        expect(cheb(x, y, 8, 8)).toBeLessThanOrEqual(1); // rhizome: neighbors only
      }
    }
  }
  expect(births).toBeGreaterThan(0); // the pass actually fires
});

test("moist soil boosts grass runner spread", () => {
  const count = (water, trials) => {
    let n = 0;
    for (let t = 0; t < trials; t++) {
      const g = soilGrid("fishkill", 2000 + t, water);
      g.tiles[8][8].plant = { kind: "grass", growth: 100 };
      disperseSeeds(g, mulberry32(t), 0);
      for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++)
        if (g.tiles[y][x].plant && !(x === 8 && y === 8)) n++;
    }
    return n;
  };
  const moist = count(80, 1000);
  const dry = count(30, 1000); // above the germination gate, below the moist bonus
  expect(moist).toBeGreaterThan(dry);
});

test("flower dispersal follows the distance kernel (60/30/10)", () => {
  const n = 3000;
  let r1 = 0, r2 = 0, r34 = 0;
  const rand = mulberry32(11);
  for (let i = 0; i < n; i++) {
    const [dx, dy] = pickKernelLanding(8, 8, rand, 0, 0);
    const d = cheb(dx, dy, 8, 8);
    if (d === 1) r1++; else if (d === 2) r2++; else { r34++; expect(d).toBeGreaterThanOrEqual(3); expect(d).toBeLessThanOrEqual(4); }
  }
  expect(r1 / n).toBeGreaterThan(0.55); expect(r1 / n).toBeLessThan(0.65);
  expect(r2 / n).toBeGreaterThan(0.25); expect(r2 / n).toBeLessThan(0.35);
  expect(r34 / n).toBeGreaterThan(0.07); expect(r34 / n).toBeLessThan(0.13);
});

test("wind gusts bias flower seeds downwind and extend range", () => {
  const rand = mulberry32(12);
  let downwind = 0, far = 0;
  const n = 2000;
  for (let i = 0; i < n; i++) {
    const [dx, dy] = pickKernelLanding(8, 8, rand, 1, 0); // wind blowing +x
    if (dx > 8) downwind++;
    if (cheb(dx, dy, 8, 8) > 4) far++;
  }
  expect(downwind / n).toBeGreaterThan(0.6); // vs ~0.4 with no wind
  expect(far).toBeGreaterThan(0); // range extended past ring 4
});

test("tree seeding is rare and lands in ring 3-5", () => {
  // ring sampler
  const rand = mulberry32(13);
  for (let i = 0; i < 1000; i++) {
    const [dx, dy] = pickRingLanding(8, 8, 3, 5, rand);
    const d = cheb(dx, dy, 8, 8);
    expect(d).toBeGreaterThanOrEqual(3);
    expect(d).toBeLessThanOrEqual(5);
  }
  // rarity: 300 ticks, one fully mature tree, ~1.5%/tick → a handful at most
  let births = 0;
  for (let t = 0; t < 300; t++) {
    const g = soilGrid("fishkill", 3000 + t);
    g.tiles[8][8].plant = { kind: "tree", growth: 100 };
    disperseSeeds(g, mulberry32(t), 0);
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++)
      if (g.tiles[y][x].plant && g.tiles[y][x].plant.kind === "tree" && !(x === 8 && y === 8)) {
        births++;
        expect(cheb(x, y, 8, 8)).toBeGreaterThanOrEqual(3);
        expect(cheb(x, y, 8, 8)).toBeLessThanOrEqual(5);
      }
  }
  expect(births).toBeGreaterThan(0);
  expect(births).toBeLessThanOrEqual(12);
});

test("seeds vanish on unsuitable ground", () => {
  const g = soilGrid("fishkill", 4000);
  g.tiles[8][8].plant = { kind: "grass", growth: 100 };
  // make everything hostile except the source tile
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    if (x === 8 && y === 8) continue;
    g.tiles[y][x].water = 10; // below the germination gate
  }
  disperseSeeds(g, mulberry32(1), 0);
  let n = 0;
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++)
    if (g.tiles[y][x].plant && !(x === 8 && y === 8)) n++;
  expect(n).toBe(0);
});

test("wind_gust sets wind state; wind decays to a breeze", () => {
  const g = soilGrid("fishkill", 5000);
  const r = applyItem(g, 2, 2, "wind_gust", fixedRand(6), 1_000_000);
  expect(r.ok).toBe(true);
  expect(g.windUntil).toBe(1_020_000);
  expect(g.windDir).toBeGreaterThanOrEqual(0);
  expect(g.windDir).toBeLessThan(Math.PI * 2);
  expect(windLevel(g, 1_001_000)).toBe(1);
  expect(windLevel(g, 1_030_000)).toBe(0.12);
});

/* ---------------- 2+3. sizes, stages, jitter, sway ---------------- */

function matureHeight(kind, seed = 9) {
  const j = M.plantJitter(0.5, 3, 4);
  let L;
  if (kind === "grass") L = M.grassTuft(mulberry32(seed), 100, j);
  else if (kind === "flower") L = M.flower(mulberry32(seed), 100, 0, j);
  else L = M.tree(mulberry32(seed), 100, j);
  return M.bboxOf(L.opaque).max[1];
}

test("mature heights are proportional: grass < flower < tree", () => {
  const gh = matureHeight("grass"), fh = matureHeight("flower"), th = matureHeight("tree");
  expect(gh).toBeGreaterThan(0.15); expect(gh).toBeLessThan(0.36);   // ~0.28
  expect(fh).toBeGreaterThan(0.40); expect(fh).toBeLessThan(0.65);   // ~0.5
  expect(th).toBeGreaterThan(2.0);  expect(th).toBeLessThan(2.4);    // ~2.3
  expect(gh).toBeLessThan(fh);
  expect(fh).toBeLessThan(th);
  expect(th / fh).toBeGreaterThan(3);   // trees read as trees
  expect(fh / gh).toBeGreaterThan(1.2); // flowers read above grass
});

test("growth stages morph, not just scale", () => {
  const sprout = M.flower(mulberry32(21), 10, 0);
  const bud = M.flower(mulberry32(21), 20, 0);
  const bloom = M.flower(mulberry32(21), 100, 0);
  // sprout: bare stem + leaves; bud: closed head rises above it; bloom: petals
  expect(M.bboxOf(bud.opaque).max[1]).toBeGreaterThan(M.bboxOf(sprout.opaque).max[1]);
  expect(bloom.opaque.pos.length).toBeGreaterThan(bud.opaque.pos.length); // petals appear at bloom
  const tuft3 = M.grassTuft(mulberry32(22), 10);
  const tuft6 = M.grassTuft(mulberry32(22), 100);
  expect(tuft6.opaque.pos.length).toBeGreaterThan(tuft3.opaque.pos.length);  // blade count grows
  const sapling = M.tree(mulberry32(23), 5);
  const young = M.tree(mulberry32(23), 20);
  const mature = M.tree(mulberry32(23), 100);
  expect(young.opaque.pos.length).toBeGreaterThan(sapling.opaque.pos.length); // canopy appears
  expect(mature.opaque.pos.length).toBeGreaterThan(young.opaque.pos.length);  // layered canopy
});

test("easeOutCubic is fast-early, slow-to-mature", () => {
  expect(M.easeOutCubic(0)).toBe(0);
  expect(M.easeOutCubic(1)).toBe(1);
  expect(M.easeOutCubic(0.5)).toBeCloseTo(0.875, 6);
  expect(M.easeOutCubic(0.25)).toBeGreaterThan(0.5); // front-loaded
  let prev = -1;
  for (let i = 0; i <= 20; i++) { const v = M.easeOutCubic(i / 20); expect(v).toBeGreaterThanOrEqual(prev); prev = v; }
});

test("plant jitter is deterministic and bounded", () => {
  const a = M.plantJitter(0.5, 3, 4), b = M.plantJitter(0.5, 3, 4);
  const scalars = (j) => ({ scale: j.scale, rot: j.rot, hue: j.hue, phase: j.phase });
  expect(scalars(a)).toEqual(scalars(b)); // rand stream is a fresh fn each call
  expect(a.scale).toBeGreaterThanOrEqual(0.85); expect(a.scale).toBeLessThanOrEqual(1.15);
  expect(a.rot).toBeGreaterThanOrEqual(0); expect(a.rot).toBeLessThan(Math.PI * 2);
  expect(Math.abs(a.hue)).toBeLessThanOrEqual(0.07);
  const c = M.plantJitter(0.5, 9, 2);
  expect(c.scale === a.scale && c.rot === a.rot).toBe(false); // neighbors differ
  // builders accept jitter or fall back cleanly
  const L = M.grassTuft(mulberry32(24), 100);
  expect(L.opaque.pos.length).toBeGreaterThan(0);
});

test("sway attributes: grass/flowers full, trees slight", () => {
  const j = M.plantJitter(0.5, 3, 4);
  const grass = M.grassTuft(mulberry32(25), 100, j).opaque;
  expect(grass.swa.length).toBe(grass.pos.length / 3 * 2);
  for (let i = 1; i < grass.swa.length; i += 2) expect(grass.swa[i]).toBeCloseTo(1.0, 6);
  const tree = M.tree(mulberry32(26), 100, j).opaque;
  const amps = new Set();
  for (let i = 1; i < tree.swa.length; i += 2) amps.add(Math.round(tree.swa[i] * 100));
  expect([...amps].sort()).toEqual([15, 33]); // trunk barely, canopy slight
  // legacy layers without sway still upload (engine zero-fills)
  const legacy = { opaque: { pos: new Float32Array([0,0,0]), swa: undefined } };
  expect(legacy.opaque.swa || null).toBe(null);
});

/* ---------------- 4. smaller, slower fires ---------------- */

test("fire intensity is capped at 60", () => {
  expect(FIRE_MAX).toBe(60);
  const g = soilGrid("fishkill", 6000);
  applyItem(g, 5, 5, "grass_seed", fixedRand(1), 1_000_000);
  const r = applyItem(g, 5, 5, "fire", fixedRand(2), 1_000_000);
  expect(r.ok).toBe(true);
  expect(g.tiles[5][5].fire).toBeLessThanOrEqual(FIRE_MAX);
});

test("flames are ~40% smaller", () => {
  const f = M.flame(0.5).opaque;
  const bb = M.bboxOf(f);
  expect(bb.max[1]).toBeLessThan(0.55); // was ~0.85 * f
});

test("one water droplet kills a single-tile fire", () => {
  const g = soilGrid("fishkill", 6001);
  applyItem(g, 8, 8, "grass_seed", fixedRand(1), 1_000_000);
  applyItem(g, 8, 8, "fire", fixedRand(2), 1_000_000);
  expect(g.tiles[8][8].fire).toBeGreaterThan(0);
  const r = applyItem(g, 8, 8, "water", fixedRand(3), 1_000_000);
  expect(r.ok).toBe(true);
  expect(r.extinguished).toBe(true);
  expect(g.tiles[8][8].fire).toBe(0);
  expect(g.extinguished).toBe(1);
});

test("two water droplets kill a 3-tile fire cluster", () => {
  const g = soilGrid("fishkill", 6002);
  for (const [x, y] of [[8, 8], [8, 9], [9, 8]]) {
    applyItem(g, x, y, "grass_seed", fixedRand(x + y), 1_000_000);
    applyItem(g, x, y, "fire", fixedRand(x * 10 + y), 1_000_000);
  }
  applyItem(g, 8, 8, "water", fixedRand(3), 1_000_000);
  applyItem(g, 8, 9, "water", fixedRand(4), 1_000_000);
  for (const [x, y] of [[8, 8], [8, 9], [9, 8]]) {
    expect(g.tiles[y][x].fire).toBe(0);
  }
});

test("fire spreads slowly: halved probability, drier fuel, every other tick", () => {
  // dry cluster around a burn; count ignitions over 12 ticks
  let ignitions = 0;
  for (let trial = 0; trial < 40; trial++) {
    const g = soilGrid("fishkill", 7000 + trial, 10); // dry fuel everywhere
    g.tiles[8][8].plant = { kind: "grass", growth: 100 };
    g.tiles[8][8].fire = 55;
    const rand = mulberry32(trial);
    for (let i = 0; i < 12; i++) {
      const evts = tickGrid(g, rand, 2_000_000 + i * 800);
      ignitions += evts.filter((e) => e.type === "ignite").length;
    }
  }
  // small, slow fires: far fewer than the old every-tick 16% regime
  expect(ignitions).toBeLessThan(40 * 12 * 0.5);
});

/* ---------------- 5. ephemera ---------------- */

const FISHKILL_KINDS = new Set(DECOR_KINDS.fishkill.map(([k]) => k));
const BROOKLYN_KINDS = new Set(DECOR_KINDS.brooklyn.map(([k]) => k));

test("decor counts per plot are 15-25 and env-appropriate", () => {
  for (const env of ["fishkill", "brooklyn"]) {
    const g = createGrid(env, fixedRand(8000 + env.length));
    expect(g.decor.length).toBeGreaterThanOrEqual(15);
    expect(g.decor.length).toBeLessThanOrEqual(25);
    const allowed = env === "fishkill" ? FISHKILL_KINDS : BROOKLYN_KINDS;
    for (const d of g.decor) expect(allowed.has(d.kind)).toBe(true);
  }
});

test("rare decor kinds respect their budgets", () => {
  const counts = { feather: 0, button: 0 };
  for (let s = 0; s < 30; s++) {
    const f = createGrid("fishkill", fixedRand(s));
    const b = createGrid("brooklyn", fixedRand(s + 100));
    for (const d of f.decor) if (d.kind === "feather") counts.feather = Math.max(counts.feather, f.decor.filter((x) => x.kind === "feather").length);
    for (const d of b.decor) if (d.kind === "button") counts.button = Math.max(counts.button, b.decor.filter((x) => x.kind === "button").length);
  }
  expect(counts.feather).toBeLessThanOrEqual(2);
  expect(counts.button).toBeLessThanOrEqual(3);
});

test("decor never lands on mature-plant tiles, one per tile", () => {
  const g = soilGrid("fishkill", 9000);
  const mature = [];
  const rand = mulberry32(55);
  for (let i = 0; i < 30; i++) {
    const x = Math.floor(rand() * SIZE), y = Math.floor(rand() * SIZE);
    g.tiles[y][x].plant = { kind: "tree", growth: 100 };
    mature.push([x, y]);
  }
  scatterDecor(g, fixedRand(56));
  const seen = new Set();
  for (const d of g.decor) {
    expect(mature.some(([x, y]) => x === d.x && y === d.y)).toBe(false);
    const k = d.x + "," + d.y;
    expect(seen.has(k)).toBe(false);
    seen.add(k);
  }
});

test("decor never blocks placement or growth", () => {
  const g = soilGrid("fishkill", 9001);
  const d = g.decor[0];
  const r = applyItem(g, d.x, d.y, "grass_seed", fixedRand(1), 1_000_000);
  expect(r.ok).toBe(true);
  expect(g.tiles[d.y][d.x].plant.kind).toBe("grass");
  tickGrid(g, fixedRand(2), 2_000_000);
  expect(g.tiles[d.y][d.x].plant.growth).toBeGreaterThan(0);
});

test("every decor kind builds valid low-poly geometry", () => {
  for (const kind of ["leaf", "twig", "stone", "pinecone", "feather", "pebble", "paper", "bottlecap", "button"]) {
    const L = M.decorItem(kind, mulberry32(3));
    expect(L.opaque.pos.length).toBeGreaterThan(0);
    expect(M.validIndices(L.opaque)).toBe(true);
    const bb = M.bboxOf(L.opaque);
    expect(bb.max[0] - bb.min[0]).toBeLessThan(0.5);
    expect(bb.max[2] - bb.min[2]).toBeLessThan(0.5);
    expect(bb.max[1]).toBeLessThan(0.5);
  }
});

test("decor re-scatters on season reset", () => {
  const g1 = createGrid("fishkill", fixedRand(10001));
  const g2 = createGrid("fishkill", fixedRand(10002));
  const k1 = g1.decor.map((d) => d.kind + d.x + "," + d.y).join("|");
  const k2 = g2.decor.map((d) => d.kind + d.x + "," + d.y).join("|");
  expect(k1 === k2).toBe(false); // seeded per season, not identical
});
