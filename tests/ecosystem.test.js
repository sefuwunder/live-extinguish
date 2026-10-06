// LIVE/EXTINGUISH ecosystem tests — bun test
// soil fertility, water/wilt, crowding, bees, birds, succession arc.
const {
  mulberry32, createGrid, tickGrid, applyItem, PLANTS, SIZE,
  disperseSeeds, updateBees, updateBird, birdPos, beeBoostAt,
  countMatureFlowersNear, BEE_MAX, BIRD_MS, neighbors,
} = require("../app.js");
const M = require("../models3d.js");
const E = require("../engine3d.js");
const { test, expect } = require("bun:test");

function fixedRand(seed = 42) { return mulberry32(seed); }
// Clean soil grid with controlled fertility; weather silenced.
function ecoGrid(envKey = "fishkill", seed = 7, fertility = 60) {
  const g = createGrid(envKey, fixedRand(seed));
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const t = g.tiles[y][x];
    t.ground = "soil"; t.water = 80; t.pollution = 0; t.fire = 0;
    t.plant = null; t.ash = 0; t.fertility = fertility; t.wilted = false;
  }
  g.coldUntil = 0; g.rainUntil = 0; g.smogUntil = 0; g.windUntil = 0;
  return g;
}
function kindCounts(g) {
  const c = { grass: 0, flower: 0, tree: 0 };
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const p = g.tiles[y][x].plant;
    if (p) c[p.kind]++;
  }
  return c;
}

/* ---------------- 1. soil fertility init ---------------- */

test("fertility init: fishkill 60-80, brooklyn 20-40, concrete 10", () => {
  for (let s = 0; s < 10; s++) {
    const f = createGrid("fishkill", fixedRand(s));
    const b = createGrid("brooklyn", fixedRand(s));
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      const tf = f.tiles[y][x], tb = b.tiles[y][x];
      if (tf.ground === "concrete") expect(tf.fertility).toBe(10);
      else { expect(tf.fertility).toBeGreaterThanOrEqual(60); expect(tf.fertility).toBeLessThanOrEqual(80); }
      if (tb.ground === "concrete") expect(tb.fertility).toBe(10);
      else { expect(tb.fertility).toBeGreaterThanOrEqual(20); expect(tb.fertility).toBeLessThanOrEqual(40); }
    }
  }
});

/* ---------------- 2. succession gates ---------------- */

test("flower/tree seeds blocked below fertility thresholds; grass pioneers", () => {
  const g = ecoGrid();
  g.tiles[5][5].fertility = 20;
  expect(applyItem(g, 5, 5, "flower_seed", fixedRand(1), 1e9))
    .toEqual({ ok: false, reason: "soil too poor" });
  g.tiles[5][5].fertility = 31;
  expect(applyItem(g, 5, 5, "flower_seed", fixedRand(1), 1e9).ok).toBe(true);
  g.tiles[6][6].fertility = 45;
  expect(applyItem(g, 6, 6, "tree_seed", fixedRand(1), 1e9).ok).toBe(false);
  g.tiles[6][6].fertility = 51;
  expect(applyItem(g, 6, 6, "tree_seed", fixedRand(1), 1e9).ok).toBe(true);
  g.tiles[7][7].fertility = 5;
  expect(applyItem(g, 7, 7, "grass_seed", fixedRand(1), 1e9).ok).toBe(true);
});

test("natural dispersal respects succession gates", () => {
  // mature flower + mature tree parents on barren soil: nothing is born
  const g = ecoGrid("fishkill", 3, 10);
  g.tiles[7][7].plant = { kind: "flower", growth: 100 };
  g.tiles[9][9].plant = { kind: "tree", growth: 100 };
  for (let t = 0; t < 60; t++) disperseSeeds(g, fixedRand(100 + t), 1e9 + t * 800, []);
  const c = kindCounts(g);
  expect(c.flower).toBe(1); // only the parents
  expect(c.tree).toBe(1);
  // same parents on rich soil: children appear
  const h = ecoGrid("fishkill", 3, 80);
  h.tiles[7][7].plant = { kind: "flower", growth: 100 };
  h.tiles[9][9].plant = { kind: "tree", growth: 100 };
  let kids = 0;
  for (let t = 0; t < 120; t++) {
    const evs = [];
    disperseSeeds(h, fixedRand(100 + t), 1e9 + t * 800, evs);
    kids += evs.filter((e) => e.type === "germinate").length;
  }
  expect(kids).toBeGreaterThan(0);
});

/* ---------------- 3. fertility cycle ---------------- */

test("mature grass builds fertility +0.5/tick", () => {
  const g = ecoGrid();
  const t = g.tiles[5][5];
  t.plant = { kind: "grass", growth: 100 }; t.fertility = 40;
  tickGrid(g, fixedRand(1), 1e9);
  expect(t.fertility).toBeCloseTo(40.5, 9);
  expect(t.plant.growth).toBe(100); // capped: no consumption, only building
});

test("growing plants consume 0.1 x growth increment", () => {
  const g = ecoGrid();
  const t = g.tiles[5][5];
  t.plant = { kind: "grass", growth: 10 }; t.fertility = 60;
  tickGrid(g, fixedRand(1), 1e9);
  const gain = t.plant.growth - 10;
  expect(gain).toBeGreaterThan(0);
  expect(t.fertility).toBeCloseTo(60 - 0.1 * gain, 9); // young: no building yet
});

test("fire death composts +15 fertility (ash boost kept)", () => {
  const g = ecoGrid();
  const t = g.tiles[5][5];
  t.plant = { kind: "grass", growth: 100 }; t.fertility = 40; t.fire = 60;
  tickGrid(g, fixedRand(1), 1e9);
  expect(t.plant).toBe(null);
  expect(t.fertility).toBeCloseTo(55, 9);
  expect(t.ash).toBeGreaterThan(0); // existing ash mechanic untouched
});

test("cold/flies deaths compost too", () => {
  const g = ecoGrid();
  g.tiles[5][5].plant = { kind: "flower", growth: 10 };
  g.tiles[5][5].fertility = 40;
  applyItem(g, 5, 5, "cold_snap", fixedRand(1), 1e9);
  expect(g.tiles[5][5].plant).toBe(null);
  expect(g.tiles[5][5].fertility).toBeCloseTo(55, 9);
  const h = ecoGrid();
  h.tiles[6][6].plant = { kind: "flower", growth: 10 };
  h.tiles[6][6].fertility = 40;
  applyItem(h, 6, 6, "flies", fixedRand(2), 1e9);
  expect(h.tiles[6][6].plant).toBe(null);
  expect(h.tiles[6][6].fertility).toBeCloseTo(55, 9);
});

/* ---------------- 4. water & wilt ---------------- */

test("plants drink: grass 0.3 / flower 0.5 / tree 0.8 x growth/100", () => {
  for (const [kind, drink] of [["grass", 0.3], ["flower", 0.5], ["tree", 0.8]]) {
    const g = ecoGrid();
    const t = g.tiles[5][5];
    t.plant = { kind, growth: 100 };
    tickGrid(g, fixedRand(1), 1e9);
    // evaporation 1.6 x (1 - 0.25 x shade); only trees shade their own tile
    const evap = kind === "tree" ? 1.6 * 0.75 : 1.6;
    expect(t.water).toBeCloseTo(80 - evap - drink, 9);
  }
});

test("wilt pauses growth; watering recovers (no death)", () => {
  const g = ecoGrid();
  g.rainUntil = 1e15; // keep every other tile out of the way
  const t = g.tiles[5][5];
  t.plant = { kind: "grass", growth: 20 };
  t.water = 4; // rain soaks +9 first: 13 lands below the 15 wilt line
  tickGrid(g, fixedRand(1), 1e9);
  expect(t.wilted).toBe(true);
  expect(t.plant.growth).toBe(20); // paused
  expect(t.plant).not.toBe(null); // thirst never kills
  // rain soaks the tile; the plant recovers and resumes
  for (let i = 0; i < 3; i++) tickGrid(g, fixedRand(2 + i), 2e9 + i * 800);
  expect(t.wilted).toBe(false);
  expect(t.plant.growth).toBeGreaterThan(20);
});

test("wilted plants render drooped and desaturated", () => {
  const scene = new E.Scene3D(
    { makeLayer: () => ({}), upload: () => {}, updateColors: () => {}, canvas: { width: 8, height: 8 } },
    M
  );
  const grids = { fishkill: ecoGrid("fishkill", 5), brooklyn: ecoGrid("brooklyn", 6) };
  grids.fishkill.tiles[2][2].plant = { kind: "grass", growth: 80 };
  grids.fishkill.tiles[2][2].wilted = false;
  scene.buildTerrain(grids, fixedRand(8));
  const lush = scene.buildPlants(grids, fixedRand(9), 1_000_000);
  grids.fishkill.tiles[2][2].wilted = true;
  const wilt = scene.buildPlants(grids, fixedRand(9), 1_000_000);
  // same vertex count, different colors (desaturated) and positions (droop tilt)
  expect(wilt.opaque.pos.length).toBe(lush.opaque.pos.length);
  expect(wilt.opaque.col).not.toEqual(lush.opaque.col);
  expect(wilt.opaque.pos).not.toEqual(lush.opaque.pos);
});

/* ---------------- 5. crowding ---------------- */

test("crowding halves germination (statistical)", () => {
  // Identical grass seed sources; only the mature-neighbor count differs.
  // Extra counters are mature TREES: they count as mature but never seed
  // the destination (tree dispersal is ring 3-5 only).
  function meanTicksToPlant(crowded, trials) {
    let total = 0;
    for (let s = 0; s < trials; s++) {
      const g = ecoGrid("fishkill", s);
      g.rainUntil = 1e15; // water never gates germination
      g.tiles[8][7].plant = { kind: "grass", growth: 100 }; // seed sources
      g.tiles[8][9].plant = { kind: "grass", growth: 100 };
      if (crowded) {
        for (const [x, y] of [[7, 7], [9, 7], [7, 9], [9, 9]])
          g.tiles[y][x].plant = { kind: "tree", growth: 100 };
      }
      let ticks = 60;
      for (let t = 0; t < 60; t++) {
        tickGrid(g, fixedRand(5000 + s * 100 + t), 1e9 + t * 800);
        if (g.tiles[8][8].plant) { ticks = t + 1; break; }
      }
      total += ticks;
    }
    return total / trials;
  }
  const open = meanTicksToPlant(false, 60);
  const crowded = meanTicksToPlant(true, 60);
  // halved germination ≈ doubled wait; assert a clear slowdown
  expect(crowded).toBeGreaterThan(open * 1.4);
});

/* ---------------- 6. bees ---------------- */

test("bees arrive where flowers cluster (cap 6) and leave when patch is gone", () => {
  const g = ecoGrid();
  for (const [x, y] of [[7, 7], [7, 8], [8, 7], [8, 8]])
    g.tiles[y][x].plant = { kind: "flower", growth: 100 };
  let spawned = false;
  for (let t = 0; t < 80 && !spawned; t++) {
    tickGrid(g, fixedRand(50 + t), 1e9 + t * 800);
    if (g.bees.length > 0) spawned = true;
  }
  expect(spawned).toBe(true);
  // cap: a meadow of flowers never exceeds 6 bees
  const h = ecoGrid();
  for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++)
    h.tiles[y][x].plant = { kind: "flower", growth: 100 };
  for (let t = 0; t < 200; t++) tickGrid(h, fixedRand(900 + t), 2e9 + t * 800);
  expect(h.bees.length).toBeLessThanOrEqual(BEE_MAX);
  expect(h.bees.length).toBeGreaterThan(0);
  // patch gone: bees leave (clear the whole grid — flowers spread by now)
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) h.tiles[y][x].plant = null;
  for (let t = 0; t < 5; t++) tickGrid(h, fixedRand(300 + t), 3e9 + t * 800);
  expect(h.bees.length).toBe(0);
});

test("bees boost nearby growth x1.2", () => {
  const g = ecoGrid();
  g.rainUntil = 1e15;
  g.tiles[5][5].plant = { kind: "grass", growth: 10 };
  g.tiles[10][10].plant = { kind: "grass", growth: 10 };
  g.tiles[5][6].plant = { kind: "flower", growth: 100 }; // keeps the bee around
  g.bees.push({ x: 5, y: 5, phase: 1 });
  for (let t = 0; t < 5; t++) tickGrid(g, fixedRand(70 + t), 1e9 + t * 800);
  const near = g.tiles[5][5].plant.growth - 10;
  const far = g.tiles[10][10].plant.growth - 10;
  expect(near).toBeGreaterThan(far * 1.1);
  // helper agrees: boost only within chebyshev 2
  expect(beeBoostAt(g, 5, 5)).toBe(1.2);
  expect(beeBoostAt(g, 10, 10)).toBe(1);
});

test("bee geometry is valid", () => {
  for (const ph of [0, 1.3, 4.1]) {
    const L = M.bee(ph);
    expect(L.opaque.pos.length).toBeGreaterThan(0);
    expect(M.validIndices(L.opaque)).toBe(true);
    expect(M.validIndices(L.trans)).toBe(true); // translucent wings
  }
  const B = M.birdShape();
  expect(B.opaque.pos.length).toBeGreaterThan(0);
  expect(M.validIndices(B.opaque)).toBe(true);
});

/* ---------------- 7. birds ---------------- */

test("birdPos glides edge to edge with a wobble", () => {
  const b = { t0: 1000, until: 1000 + BIRD_MS, x0: -2, x1: 17, y0: 8, drops: [] };
  const p0 = birdPos(b, 1000);
  expect(p0.x).toBeCloseTo(-2, 9);
  const p1 = birdPos(b, 1000 + BIRD_MS);
  expect(p1.x).toBeCloseTo(17, 9);
  expect(p1.dir).toBe(1);
  const mid = birdPos(b, 1000 + BIRD_MS / 2);
  expect(Math.abs(mid.y - 8)).toBeGreaterThan(0.01); // sine wobble
});

test("bird drops plant tree seeds along its path + white specks", () => {
  const g = ecoGrid();
  g.bird = {
    t0: 1e9, until: 1e9 + BIRD_MS, x0: -2, x1: 17, y0: 8,
    drops: [
      { frac: 0.3, x: 5, y: 8, done: false },
      { frac: 0.7, x: 10, y: 7, done: false },
    ],
  };
  tickGrid(g, fixedRand(1), 1e9 + 1500); // pr 0.375: first drop fires
  expect(g.tiles[8][5].plant).not.toBe(null);
  expect(g.tiles[8][5].plant.kind).toBe("tree");
  expect(g.birdSpecks.length).toBe(1);
  expect(g.tiles[7][10].plant).toBe(null); // second drop not yet
  tickGrid(g, fixedRand(2), 1e9 + 3000); // pr 0.75: second drop fires
  expect(g.tiles[7][10].plant).not.toBe(null);
  expect(g.tiles[7][10].plant.kind).toBe("tree");
  expect(g.birdSpecks.length).toBe(2);
  tickGrid(g, fixedRand(3), 1e9 + BIRD_MS + 800); // crossing done
  expect(g.bird).toBe(null);
});

test("bird drops respect the tree succession gate", () => {
  const g = ecoGrid("fishkill", 9, 20); // poor soil everywhere
  g.bird = {
    t0: 1e9, until: 1e9 + BIRD_MS, x0: -2, x1: 17, y0: 8,
    drops: [{ frac: 0.3, x: 5, y: 8, done: false }],
  };
  tickGrid(g, fixedRand(1), 1e9 + 1500);
  expect(g.tiles[8][5].plant).toBe(null); // too poor: no tree
  expect(g.birdSpecks.length).toBe(1); // the speck still marks the attempt
});

test("bird render: silhouette + specks build valid geometry", () => {
  const scene = new E.Scene3D(
    { makeLayer: () => ({}), upload: () => {}, updateColors: () => {}, canvas: { width: 8, height: 8 } },
    M
  );
  const grids = { fishkill: ecoGrid("fishkill", 5), brooklyn: ecoGrid("brooklyn", 6) };
  const now = 1_000_000;
  grids.fishkill.bird = { t0: now - 1000, until: now + 3000, x0: -2, x1: 17, y0: 8, drops: [] };
  grids.fishkill.birdSpecks = [{ x: 5, y: 8, until: now + 2000 }];
  grids.fishkill.bees.push({ x: 4, y: 4, phase: 0 });
  scene.buildTerrain(grids, fixedRand(8));
  const L = scene.buildFx({ grids, falling: [], now, reducedMotion: false, seasonProgress: 0.5, rand: fixedRand(9) });
  expect(L.opaque.pos.length).toBeGreaterThan(0);
  expect(M.validIndices(L.opaque)).toBe(true);
  expect(M.validIndices(L.trans)).toBe(true);
});

/* ---------------- 8. succession arc ---------------- */

test("brooklyn succession arc completes in one season (grass -> flowers -> trees)", () => {
  const g = createGrid("brooklyn", mulberry32(1234));
  const r = mulberry32(99);
  // the player: plants grass early, tries flowers/trees as the soil allows,
  // waters regularly. 375 ticks = one season.
  for (let t = 0; t < 375; t++) {
    const now = 1e9 + t * 800;
    if (t % 5 === 0) {
      let planted = 0;
      for (let tries = 0; tries < 60 && planted < 4; tries++) {
        const x = Math.floor(r() * SIZE), y = Math.floor(r() * SIZE);
        const tile = g.tiles[y][x];
        if (tile.plant || tile.ground !== "soil") continue;
        // try the richest option the soil allows: tree > flower > grass
        const res =
          applyItem(g, x, y, "tree_seed", r, now).ok ? true :
          applyItem(g, x, y, "flower_seed", r, now).ok ? true :
          applyItem(g, x, y, "grass_seed", r, now).ok;
        if (res) planted++;
      }
      for (let w = 0; w < 25; w++) // water the plot
        applyItem(g, Math.floor(r() * SIZE), Math.floor(r() * SIZE), "water", r, now);
    }
    tickGrid(g, mulberry32(7000 + t), now);
  }
  const c = kindCounts(g);
  expect(c.grass).toBeGreaterThan(0);
  expect(c.flower).toBeGreaterThan(0);
  expect(c.tree).toBeGreaterThan(0);
}, 30000);
