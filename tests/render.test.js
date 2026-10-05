// LIVE/EXTINGUISH render smoke tests — stubbed canvas 2d context, no DOM.
const {
  createGrid, applyItem, renderGrid, renderSky, mulberry32, SIZE, TILE_PX, ITEMS,
} = require("../app.js");
const { test, expect } = require("bun:test");

function stubCtx() {
  const calls = [];
  const grad = { addColorStop() {} };
  return {
    calls,
    fillStyle: "", strokeStyle: "", lineWidth: 1,
    font: "", textAlign: "", textBaseline: "",
    globalAlpha: 1,
    fillRect(x, y, w, h) { calls.push(["fillRect", x, y, w, h]); },
    strokeRect() {}, clearRect() {},
    beginPath() { calls.push(["beginPath"]); },
    arc(x, y, r) { calls.push(["arc", x, y, r]); },
    ellipse(x, y, rx, ry) { calls.push(["ellipse", x, y, rx, ry]); },
    fill() { calls.push(["fill"]); },
    stroke() { calls.push(["stroke"]); },
    moveTo(x, y) { calls.push(["moveTo", x, y]); },
    lineTo(x, y) { calls.push(["lineTo", x, y]); },
    fillText(t, x, y) { calls.push(["fillText", t, x, y]); },
    createLinearGradient() { return grad; },
  };
}

function livelyGrid() {
  const g = createGrid("fishkill", mulberry32(5));
  const rand = mulberry32(6), now = 1_000_000;
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const t = g.tiles[y][x];
    t.ground = "soil"; t.water = 80; t.pollution = 0;
  }
  applyItem(g, 2, 2, "grass_seed", rand, now); g.tiles[2][2].plant.growth = 100;
  applyItem(g, 4, 4, "flower_seed", rand, now); g.tiles[4][4].plant.growth = 100;
  applyItem(g, 6, 6, "tree_seed", rand, now); g.tiles[6][6].plant.growth = 100;
  applyItem(g, 8, 8, "fire", rand, now);
  g.tiles[10][10].pollution = 80;
  g.tiles[11][11].water = 95;
  return g;
}

test("renderGrid paints all 256 tiles", () => {
  const ctx = stubCtx();
  renderGrid(ctx, livelyGrid(), 1_000_000, { reducedMotion: false });
  const rects = ctx.calls.filter((c) => c[0] === "fillRect");
  // one ground rect per tile at minimum, plus seams/water/plants
  expect(rects.length).toBeGreaterThanOrEqual(256);
  // tile (0,0) ground rect present at expected position
  expect(rects.some((c) => c[1] === 0 && c[2] === 0 && c[3] === TILE_PX && c[4] === TILE_PX)).toBe(true);
});

test("renderGrid draws plants (arcs for canopies/flowers)", () => {
  const ctx = stubCtx();
  renderGrid(ctx, livelyGrid(), 1_000_000, { reducedMotion: true });
  expect(ctx.calls.some((c) => c[0] === "arc")).toBe(true);
  expect(ctx.calls.some((c) => c[0] === "fill")).toBe(true);
});

test("renderGrid does not throw on empty concrete grid", () => {
  const ctx = stubCtx();
  const g = createGrid("brooklyn", mulberry32(1));
  expect(() => renderGrid(ctx, g, 1_000_000, { reducedMotion: true })).not.toThrow();
});

test("renderGrid cold overlay paints full-grid rect", () => {
  const ctx = stubCtx();
  const g = livelyGrid();
  g.coldUntil = 1_000_000 + 5000;
  renderGrid(ctx, g, 1_000_000, { reducedMotion: true });
  expect(ctx.calls.some((c) => c[0] === "fillRect" && c[3] === 384 && c[4] === 384)).toBe(true);
});

test("renderSky paints gradient, sun, and falling items", () => {
  const ctx = stubCtx();
  const falling = [
    { itemKey: "grass_seed", x: 100, startT: 1_000_000 },
    { itemKey: "smog", x: 200, startT: 1_000_000 },
  ];
  const clouds = [{ x: 50, y: 20, speed: 5 }];
  renderSky(ctx, 384, 64, 0.5, falling, clouds, 1_000_500, { reducedMotion: false });
  const texts = ctx.calls.filter((c) => c[0] === "fillText").map((c) => c[1]);
  expect(texts).toContain(ITEMS.grass_seed.icon);
  expect(texts).toContain(ITEMS.smog.icon);
  expect(ctx.calls.some((c) => c[0] === "arc")).toBe(true); // sun
  expect(ctx.calls.some((c) => c[0] === "ellipse")).toBe(true); // cloud
});

test("renderSky with reduced motion still renders statically", () => {
  const ctx = stubCtx();
  expect(() => renderSky(ctx, 384, 64, 0.9, [], [], 1_000_000, { reducedMotion: true })).not.toThrow();
  expect(ctx.calls.length).toBeGreaterThan(0);
});

test("renderSky day arc moves sun across progress", () => {
  const dawn = stubCtx(), dusk = stubCtx();
  renderSky(dawn, 384, 64, 0.05, [], [], 1_000_000, { reducedMotion: true });
  renderSky(dusk, 384, 64, 0.95, [], [], 1_000_000, { reducedMotion: true });
  const sunX = (ctx) => ctx.calls.find((c) => c[0] === "arc")[1];
  expect(sunX(dusk)).toBeGreaterThan(sunX(dawn));
});
