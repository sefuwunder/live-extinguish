// LIVE/EXTINGUISH round-structure tests — bun test
// Rounds end at first full tree crown (growth 100), with a 20-min backstop.
const {
  mulberry32, createGrid, tickGrid, applyItem, PLANTS, SIZE, TICK_MS, ROUND_CAP_MS,
  FRUITION_HAIKU, BACKSTOP_HAIKU, OPENING_HAIKU, fillHaiku,
  nearestCrown, fruitedPlot, Game, gameTick,
} = require("../app.js");
const { test, expect } = require("bun:test");

function setupGame(sharedStore) {
  Game.grids = {
    fishkill: createGrid("fishkill", mulberry32(1)),
    brooklyn: createGrid("brooklyn", mulberry32(2)),
  };
  Game.rand = mulberry32(99);
  Game.season = 1;
  Game.running = true;
  Game.startedAt = Date.now();
  Game.endsAt = Game.startedAt + ROUND_CAP_MS;
  Game.trays = [[], []];
  Game.falling = [];
  Game.selected = null;
  Game.scene3d = null;
  Game.reducedMotion = false;
  Game.clouds = { fishkill: [], brooklyn: [] };
  const kids = [];
  Game.els = {
    haikuText: { set innerHTML(v) {}, appendChild(c) { kids.push(c); } },
    haikuBtn: { textContent: "" },
    haiku: { hidden: true },
  };
  const store = sharedStore || {};
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  };
  globalThis.document = {
    createElement: () => ({}),
    createTextNode: (t) => ({ text: t }),
  };
  return {
    store,
    haikuText: () => kids.map((k) => k.text || k.textContent || "").join(""),
  };
}
function teardownGame() {
  delete globalThis.localStorage;
  delete globalThis.document;
  Game.running = false;
  Game.els = {};
}
// a tended tree tile, ready to grow
function tendedTree(grid, x, y, growth) {
  const t = grid.tiles[y][x];
  t.ground = "soil"; t.water = 80; t.pollution = 0; t.fire = 0;
  t.fertility = 70; t.wilted = false; t.ash = 0;
  t.plant = { kind: "tree", growth };
  return t;
}

test("ROUND_CAP_MS is 20 minutes", () => {
  expect(ROUND_CAP_MS).toBe(20 * 60 * 1000);
});

test("opening haikus set the new stakes (crown in each)", () => {
  expect(OPENING_HAIKU.length).toBeGreaterThanOrEqual(3);
  expect(OPENING_HAIKU.length).toBeLessThanOrEqual(4);
  for (const h of OPENING_HAIKU) expect(h).toMatch(/crown/);
});

test("fruition haikus name the plot; backstop haikus are wistful", () => {
  expect(FRUITION_HAIKU.length).toBeGreaterThanOrEqual(3);
  for (const h of FRUITION_HAIKU) expect(h).toContain("{plot}");
  expect(BACKSTOP_HAIKU.length).toBe(2);
});

test("round ends exactly when a tree hits 100", () => {
  const ctx = setupGame();
  try {
    tendedTree(Game.grids.fishkill, 8, 8, 99.9);
    expect(Game.running).toBe(true);
    gameTick();
    expect(Game.running).toBe(false); // round over
    expect(ctx.haikuText()).toMatch(/fishkill/); // winning plot named
  } finally { teardownGame(); }
});

test("round does not end early at 99", () => {
  const ctx = setupGame();
  try {
    const t = tendedTree(Game.grids.fishkill, 8, 8, 90);
    gameTick();
    expect(Game.running).toBe(true);
    expect(t.plant.growth).toBeGreaterThan(90);
  } finally { teardownGame(); }
});

test("backstop ends the round at 20:00 with the wistful path", () => {
  const ctx = setupGame();
  try {
    Game.endsAt = Date.now() - 1; // cap already passed
    gameTick();
    expect(Game.running).toBe(false);
    const text = ctx.haikuText();
    expect(text.includes("twenty minutes") || text.includes("slips away")).toBe(true);
  } finally { teardownGame(); }
});

test("crown attributes to the correct plot", () => {
  const ctx = setupGame();
  try {
    tendedTree(Game.grids.fishkill, 8, 8, 50);   // not there yet
    tendedTree(Game.grids.brooklyn, 8, 8, 99.9);  // about to crown
    gameTick();
    expect(Game.running).toBe(false);
    expect(ctx.haikuText()).toMatch(/brooklyn/);
  } finally { teardownGame(); }
});

test("fishkill wins ties when both crown on the same tick", () => {
  const ctx = setupGame();
  try {
    tendedTree(Game.grids.fishkill, 8, 8, 99.9);
    tendedTree(Game.grids.brooklyn, 8, 8, 99.9);
    gameTick();
    expect(Game.running).toBe(false);
    expect(ctx.haikuText()).toMatch(/fishkill/);
  } finally { teardownGame(); }
});

test("fruitedPlot finds crowns and nearestCrown reports the max", () => {
  const g = createGrid("fishkill", mulberry32(5));
  Game.grids = { fishkill: g, brooklyn: createGrid("brooklyn", mulberry32(6)) };
  expect(fruitedPlot()).toBe(null);
  expect(nearestCrown()).toBe(0);
  g.tiles[3][3].plant = { kind: "tree", growth: 42 };
  expect(nearestCrown()).toBe(42);
  Game.grids.brooklyn.tiles[4][4].plant = { kind: "tree", growth: 78 };
  expect(nearestCrown()).toBe(78);
  Game.grids.brooklyn.tiles[4][4].plant.growth = 100;
  expect(fruitedPlot()).toBe("brooklyn");
  Game.running = false;
});

test("seeded full round with a watering player crowns in 5-8 minutes", () => {
  const ctx = setupGame();
  try {
    // the player: plant a tree seed early, keep it watered and fed
    const g = Game.grids.fishkill;
    let planted = false;
    let ticks = 0;
    for (ticks = 0; ticks < 900; ticks++) {
      if (!planted) {
        const res = applyItem(g, 8, 8, "tree_seed", mulberry32(11), Date.now());
        if (res.ok) planted = true;
      }
      const t = g.tiles[8][8];
      if (t.plant) { t.water = Math.max(t.water, 70); t.fertility = Math.max(t.fertility, 60); }
      gameTick();
      if (!Game.running) break; // fruition ended the round
    }
    expect(planted).toBe(true);
    expect(Game.running).toBe(false); // round ended by fruition, not backstop
    const elapsedMin = (ticks * TICK_MS) / 60000;
    expect(elapsedMin).toBeGreaterThanOrEqual(5);
    expect(elapsedMin).toBeLessThanOrEqual(8);
  } finally { teardownGame(); }
}, 30000);

test("fastest fruition is recorded and never worsened", () => {
  const store = {};
  let ctx = setupGame(store);
  try {
    // slow round first: started 12 minutes ago
    Game.startedAt = Date.now() - 12 * 60 * 1000;
    tendedTree(Game.grids.fishkill, 8, 8, 99.9);
    gameTick();
    let rec = JSON.parse(store["live-extinguish-fastest"]);
    expect(rec.plot).toBe("fishkill");
    expect(rec.ms).toBeGreaterThanOrEqual(12 * 60 * 1000 - 5000);
    // fast round second: started 4 minutes ago — should improve the record
    ctx = setupGame(store);
    Game.startedAt = Date.now() - 4 * 60 * 1000;
    tendedTree(Game.grids.brooklyn, 8, 8, 99.9);
    gameTick();
    rec = JSON.parse(store["live-extinguish-fastest"]);
    expect(rec.plot).toBe("brooklyn");
    expect(rec.ms).toBeLessThan(12 * 60 * 1000);
    const fastMs = rec.ms;
    // slow round third: must not overwrite
    ctx = setupGame(store);
    Game.startedAt = Date.now() - 15 * 60 * 1000;
    tendedTree(Game.grids.fishkill, 8, 8, 99.9);
    gameTick();
    rec = JSON.parse(store["live-extinguish-fastest"]);
    expect(rec.ms).toBe(fastMs);
    expect(ctx.haikuText()).toMatch(/fastest crown/);
  } finally { teardownGame(); }
});
