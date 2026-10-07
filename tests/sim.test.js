// LIVE/EXTINGUISH simulation tests — bun test
const {
  mulberry32, createGrid, createTile, tickGrid, applyItem, scoreGrid, countPlants,
  pickFallingItem, makeTrayItem, TRAY_CAP, ITEMS, ITEM_KEYS, PLANTS, ENVS, SIZE,
  neighbors, radiusTiles, inBounds, fillHaiku, Game, landItem,
} = require("../app.js");
const { test, expect } = require("bun:test");

function fixedRand(seed = 42) { return mulberry32(seed); }
// all-soil grid for controlled tests
function soilGrid(envKey = "fishkill", seed = 7) {
  const rand = fixedRand(seed);
  const g = createGrid(envKey, rand);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const t = g.tiles[y][x];
    t.ground = "soil"; t.water = 80; t.pollution = 0; t.fire = 0; t.plant = null; t.ash = 0;
  }
  return g;
}
function tickN(grid, n, seed = 99) {
  const rand = fixedRand(seed);
  let now = 1_000_000;
  for (let i = 0; i < n; i++) { tickGrid(grid, rand, now); now += 800; }
}

test("grid is 16x16", () => {
  const g = createGrid("fishkill", fixedRand());
  expect(g.tiles.length).toBe(16);
  expect(g.tiles[0].length).toBe(16);
});

test("fishkill starts mostly soil, brooklyn mostly concrete", () => {
  const f = createGrid("fishkill", fixedRand(1));
  const b = createGrid("brooklyn", fixedRand(1));
  let fSoil = 0, bConc = 0;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    if (f.tiles[y][x].ground === "soil") fSoil++;
    if (b.tiles[y][x].ground === "concrete") bConc++;
  }
  expect(fSoil).toBeGreaterThan(220);
  expect(bConc).toBeGreaterThan(150);
});

test("grass grows under good conditions", () => {
  const g = soilGrid();
  applyItem(g, 5, 5, "grass_seed", fixedRand(), 1_000_000);
  const before = g.tiles[5][5].plant.growth;
  tickN(g, 20);
  expect(g.tiles[5][5].plant.growth).toBeGreaterThan(before);
});

test("seed on concrete fails", () => {
  const g = soilGrid();
  g.tiles[3][3].ground = "concrete";
  const r = applyItem(g, 3, 3, "tree_seed", fixedRand(), 1_000_000);
  expect(r.ok).toBe(false);
  expect(r.reason).toBe("needs soil");
  expect(g.tiles[3][3].plant).toBeNull();
});

test("seed on occupied tile fails", () => {
  const g = soilGrid();
  applyItem(g, 3, 3, "grass_seed", fixedRand(), 1_000_000);
  const r = applyItem(g, 3, 3, "flower_seed", fixedRand(), 1_000_000);
  expect(r.ok).toBe(false);
});

test("no growth when water is low", () => {
  const g = soilGrid();
  applyItem(g, 5, 5, "grass_seed", fixedRand(), 1_000_000);
  g.tiles[5][5].water = 10;
  const before = g.tiles[5][5].plant.growth;
  tickN(g, 10);
  // water 10 -> evaporates, stays < 30, no growth
  expect(g.tiles[5][5].plant.growth).toBe(before);
});

test("no growth when pollution is high", () => {
  const g = soilGrid();
  applyItem(g, 5, 5, "grass_seed", fixedRand(), 1_000_000);
  g.tiles[5][5].pollution = 80;
  g.tiles[5][5].water = 80;
  const before = g.tiles[5][5].plant.growth;
  tickN(g, 10);
  // pollution drifts down 0.25/tick but stays > 60 for 10 ticks
  expect(g.tiles[5][5].plant.growth).toBe(before);
});

test("fishkill grows faster than brooklyn", () => {
  const f = soilGrid("fishkill"), b = soilGrid("brooklyn");
  applyItem(f, 5, 5, "grass_seed", fixedRand(), 1_000_000);
  applyItem(b, 5, 5, "grass_seed", fixedRand(), 1_000_000);
  tickN(f, 30, 5); tickN(b, 30, 5);
  expect(f.tiles[5][5].plant.growth).toBeGreaterThan(b.tiles[5][5].plant.growth);
});

test("mature grass spreads to adjacent soil", () => {
  const g = soilGrid();
  g.tiles[8][8].plant = { kind: "grass", growth: 100 };
  const before = countPlants(g);
  tickN(g, 60, 1234);
  expect(countPlants(g)).toBeGreaterThan(before);
});

test("grass does not spread onto concrete", () => {
  const g = soilGrid();
  g.tiles[8][8].plant = { kind: "grass", growth: 100 };
  for (const [nx, ny] of neighbors(8, 8)) g.tiles[ny][nx].ground = "concrete";
  tickN(g, 60, 1234);
  expect(countPlants(g)).toBe(1);
});

test("trees grow slower than grass", () => {
  const g = soilGrid();
  applyItem(g, 2, 2, "tree_seed", fixedRand(), 1_000_000);
  applyItem(g, 4, 4, "grass_seed", fixedRand(), 1_000_000);
  // isolate: remove flower-boost adjacency effects by spacing; compare raw growth
  tickN(g, 40, 11);
  expect(g.tiles[2][2].plant.growth).toBeLessThan(g.tiles[4][4].plant.growth);
});

test("mature flower neighbor boosts growth", () => {
  const g = soilGrid();
  g.tiles[5][6].plant = { kind: "flower", growth: 100 };
  applyItem(g, 5, 5, "grass_seed", fixedRand(), 1_000_000);
  const g2 = soilGrid();
  applyItem(g2, 5, 5, "grass_seed", fixedRand(), 1_000_000);
  tickN(g, 25, 21); tickN(g2, 25, 21);
  expect(g.tiles[5][5].plant.growth).toBeGreaterThan(g2.tiles[5][5].plant.growth);
});

test("fire spreads to dry neighbors", () => {
  const g = soilGrid();
  g.tiles[8][8].plant = { kind: "grass", growth: 50 };
  for (const [nx, ny] of neighbors(8, 8)) {
    g.tiles[ny][nx].plant = { kind: "grass", growth: 50 };
    g.tiles[ny][nx].water = 5;
  }
  g.tiles[8][8].water = 5;
  applyItem(g, 8, 8, "fire", fixedRand(), 1_000_000);
  let spread = false;
  const rand = fixedRand(777);
  let now = 1_000_000;
  for (let i = 0; i < 40; i++) {
    tickGrid(g, rand, now); now += 800;
    if (neighbors(8, 8).some(([nx, ny]) => g.tiles[ny][nx].fire > 0)) { spread = true; break; }
  }
  expect(spread).toBe(true);
});

test("fire destroys plants and leaves ash", () => {
  const g = soilGrid();
  applyItem(g, 8, 8, "tree_seed", fixedRand(), 1_000_000);
  g.tiles[8][8].plant.growth = 90;
  applyItem(g, 8, 8, "fire", fixedRand(), 1_000_000);
  tickN(g, 8, 31);
  expect(g.tiles[8][8].plant).toBeNull();
  expect(g.tiles[8][8].ash).toBeGreaterThan(0);
});

test("water extinguishes fire and counts it", () => {
  const g = soilGrid();
  applyItem(g, 8, 8, "fire", fixedRand(), 1_000_000);
  expect(g.tiles[8][8].fire).toBeGreaterThan(0);
  const r = applyItem(g, 8, 8, "water", fixedRand(), 1_000_000);
  expect(r.ok).toBe(true);
  expect(r.extinguished).toBe(true);
  expect(g.tiles[8][8].fire).toBe(0);
  expect(g.extinguished).toBe(1);
});

test("rain extinguishes all fire", () => {
  const g = soilGrid();
  applyItem(g, 2, 2, "fire", fixedRand(), 1_000_000);
  applyItem(g, 9, 9, "fire", fixedRand(), 1_000_000);
  g.rainUntil = 1_000_000 + 5000;
  tickGrid(g, fixedRand(), 1_000_000 + 800);
  expect(g.tiles[2][2].fire).toBe(0);
  expect(g.tiles[9][9].fire).toBe(0);
});

test("smog item raises pollution in radius", () => {
  const g = soilGrid();
  applyItem(g, 8, 8, "smog", fixedRand(), 1_000_000);
  expect(g.tiles[8][8].pollution).toBeGreaterThan(30);
  expect(g.tiles[9][9].pollution).toBeGreaterThan(30);
  expect(g.tiles[0][0].pollution).toBe(0);
});

test("oxygen clears pollution", () => {
  const g = soilGrid();
  g.tiles[8][8].pollution = 90;
  applyItem(g, 8, 8, "oxygen", fixedRand(), 1_000_000);
  expect(g.tiles[8][8].pollution).toBeLessThan(40);
});

test("soil converts concrete permanently", () => {
  const g = soilGrid();
  g.tiles[4][4].ground = "concrete";
  const r = applyItem(g, 4, 4, "soil", fixedRand(), 1_000_000);
  expect(r.ok).toBe(true);
  expect(g.tiles[4][4].ground).toBe("soil");
  const s = applyItem(g, 4, 4, "grass_seed", fixedRand(), 1_000_000);
  expect(s.ok).toBe(true);
});

test("flies damage flowers", () => {
  const g = soilGrid();
  applyItem(g, 8, 8, "flower_seed", fixedRand(), 1_000_000);
  g.tiles[8][8].plant.growth = 60;
  applyItem(g, 8, 8, "flies", fixedRand(), 1_000_000);
  expect(g.tiles[8][8].plant.growth).toBeLessThan(60);
});

test("sunburst boosts growth and dries soil", () => {
  const g = soilGrid();
  applyItem(g, 8, 8, "grass_seed", fixedRand(), 1_000_000);
  g.tiles[8][8].plant.growth = 20;
  const wBefore = g.tiles[8][8].water;
  applyItem(g, 8, 8, "sunburst", fixedRand(), 1_000_000);
  expect(g.tiles[8][8].plant.growth).toBeGreaterThan(20);
  expect(g.tiles[8][8].water).toBeLessThan(wBefore);
});

test("cold snap pauses growth grid-wide", () => {
  const g = soilGrid();
  applyItem(g, 8, 8, "grass_seed", fixedRand(), 1_000_000);
  applyItem(g, 8, 8, "cold_snap", fixedRand(), 1_000_000);
  expect(g.coldUntil).toBeGreaterThan(1_000_000);
  const before = g.tiles[8][8].plant.growth;
  tickN(g, 10, 41); // ticks at now=1_000_000+... still within cold window
  expect(g.tiles[8][8].plant.growth).toBe(before);
});

test("cold snap damages tender flowers", () => {
  const g = soilGrid();
  applyItem(g, 8, 8, "flower_seed", fixedRand(), 1_000_000);
  g.tiles[8][8].plant.growth = 30; // tender
  applyItem(g, 8, 8, "cold_snap", fixedRand(), 1_000_000);
  expect(g.tiles[8][8].plant.growth).toBeLessThan(30);
});

test("wind gust dries tiles", () => {
  const g = soilGrid();
  const before = g.tiles[8][8].water;
  applyItem(g, 8, 8, "wind_gust", fixedRand(), 1_000_000);
  expect(g.tiles[8][8].water).toBe(before - 15);
});

test("water evaporates over time", () => {
  const g = soilGrid();
  g.tiles[8][8].water = 80;
  g.rainUntil = 0;
  tickN(g, 10, 51);
  expect(g.tiles[8][8].water).toBeLessThan(80);
});

test("pollution drifts down", () => {
  const g = soilGrid();
  g.tiles[8][8].pollution = 40;
  tickN(g, 10, 52);
  expect(g.tiles[8][8].pollution).toBeLessThan(40);
});

test("scoring math: mature plants full value, young half", () => {
  const g = soilGrid();
  g.tiles[0][0].plant = { kind: "grass", growth: 100 };   // 1
  g.tiles[0][1].plant = { kind: "grass", growth: 10 };    // 0.5
  g.tiles[0][2].plant = { kind: "flower", growth: 100 };  // 3
  g.tiles[0][3].plant = { kind: "tree", growth: 100 };   // 5
  g.tiles[0][4].plant = { kind: "tree", growth: 50 };    // 2.5
  const s = scoreGrid(g);
  expect(s.grass).toBeCloseTo(1.5);
  expect(s.flowers).toBeCloseTo(3);
  expect(s.trees).toBeCloseTo(7.5);
  expect(s.total).toBeCloseTo(12);
});

test("empty grid scores zero", () => {
  expect(scoreGrid(soilGrid()).total).toBe(0);
});

test("pickFallingItem only returns known items", () => {
  const rand = fixedRand(9);
  for (let i = 0; i < 2000; i++) {
    const k = pickFallingItem(rand);
    expect(ITEM_KEYS).toContain(k);
  }
});

test("falling mix favors seeds/water/soil", () => {
  const rand = fixedRand(13);
  let kind = 0;
  for (let i = 0; i < 2000; i++) {
    const k = pickFallingItem(rand);
    if (k.endsWith("_seed") || k === "water" || k === "soil") kind++;
  }
  expect(kind / 2000).toBeGreaterThan(0.6);
});

test("hazard items carry expiry", () => {
  const now = 5_000_000;
  expect(makeTrayItem("smog", now).expiresAt).toBe(now + 45000);
  expect(makeTrayItem("flies", now).expiresAt).toBe(now + 45000);
  expect(makeTrayItem("grass_seed", now).expiresAt).toBeUndefined();
});

test("tray cap refuses the 13th item", () => {
  Game.trays = [[], []];
  const now = Date.now();
  for (let i = 0; i < TRAY_CAP; i++) expect(landItem(0, makeTrayItem("water", now))).toBe(true);
  expect(landItem(0, makeTrayItem("water", now))).toBe(false);
  expect(Game.trays[0].length).toBe(TRAY_CAP);
  Game.trays = [[], []];
});

test("fillHaiku replaces tokens", () => {
  expect(fillHaiku("{winner} over {loser}, {total} green", { winner: "fishkill", loser: "brooklyn", total: 42 }))
    .toBe("fishkill over brooklyn, 42 green");
  expect(fillHaiku("{plot} raised it in {time}", { plot: "fishkill", time: "6:24" }))
    .toBe("fishkill raised it in 6:24");
  expect(fillHaiku("no tokens here", {})).toBe("no tokens here");
});

test("neighbors and radius stay in bounds", () => {
  expect(neighbors(0, 0).length).toBe(3);
  expect(neighbors(8, 8).length).toBe(8);
  expect(radiusTiles(0, 0, 1).length).toBe(4);
  expect(inBounds(15, 15)).toBe(true);
  expect(inBounds(16, 0)).toBe(false);
});
