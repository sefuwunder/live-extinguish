// LIVE/EXTINGUISH drama-pass tests — bun test
// tree shade (sim + visual), germination bursts, stage pops, built-environment ephemera.
const {
  mulberry32, createGrid, tickGrid, applyItem, PLANTS, SIZE,
  shadeBlobFor, computeShadeMap, scatterDecor, DECOR_KINDS,
} = require("../app.js");
const M = require("../models3d.js");
const E = require("../engine3d.js");
const { test, expect } = require("bun:test");

function fixedRand(seed = 42) { return mulberry32(seed); }
function soilGrid(envKey = "fishkill", seed = 7, water = 80) {
  const g = createGrid(envKey, fixedRand(seed));
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const t = g.tiles[y][x];
    t.ground = "soil"; t.water = water; t.pollution = 0; t.fire = 0; t.plant = null; t.ash = 0;
  }
  g.coldUntil = 0; g.rainUntil = 0;
  return g;
}
function cheb(x1, y1, x2, y2) { return Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2)); }

/* ---------------- 1. shade blob ---------------- */

test("shadeBlobFor: 15 tiles at 100, 5 at 60-99, none below; only trees", () => {
  expect(shadeBlobFor(0, 8, 8)).toEqual([]);
  expect(shadeBlobFor(59, 8, 8)).toEqual([]);
  expect(shadeBlobFor(60, 8, 8)).toEqual([[0,0],[1,0],[-1,0],[0,1],[0,-1]]);
  expect(shadeBlobFor(99, 8, 8).length).toBe(5);
  expect(shadeBlobFor(100, 8, 8).length).toBe(15);
});

test("mature blob = manhattan diamond of 13 + 2 seeded ring-3 tiles", () => {
  const blob = shadeBlobFor(100, 8, 8);
  const diamond = blob.filter(([dx, dy]) => Math.abs(dx) + Math.abs(dy) <= 2);
  const ring3 = blob.filter(([dx, dy]) => Math.max(Math.abs(dx), Math.abs(dy)) === 3);
  expect(diamond.length).toBe(13);
  expect(ring3.length).toBe(2);
  expect(ring3).toEqual([[2, 3], [3, -2]]); // seeded-deterministic for (8,8)
});

test("blob is deterministic per tile, and varies between tiles", () => {
  expect(shadeBlobFor(100, 5, 5)).toEqual(shadeBlobFor(100, 5, 5));
  const a = JSON.stringify(shadeBlobFor(100, 5, 5));
  const b = JSON.stringify(shadeBlobFor(100, 8, 8));
  expect(a).not.toBe(b); // irregular canopies differ
  // app.js and models3d.js must agree (sim ↔ render)
  expect(M.shadeBlobFor(100, 5, 5)).toEqual(shadeBlobFor(100, 5, 5));
  expect(M.shadeBlobFor(100, 8, 8)).toEqual(shadeBlobFor(100, 8, 8));
});

test("shade map marks the blob, not distant tiles", () => {
  const g = soilGrid();
  g.tiles[8][8].plant = { kind: "tree", growth: 100 };
  computeShadeMap(g);
  expect(g.tiles[8][8].canopyShade).toBeGreaterThan(0);   // own tile
  expect(g.tiles[9][9].canopyShade).toBeGreaterThan(0);   // manhattan 2 (diamond)
  expect(g.tiles[11][10].canopyShade).toBeGreaterThan(0); // ring-3 pick [2,3]
  expect(g.tiles[6][11].canopyShade).toBeGreaterThan(0);  // ring-3 pick [3,-2]
  expect(g.tiles[10][10].canopyShade).toBe(0);            // manhattan 4, outside blob
  expect(g.tiles[11][8].canopyShade).toBe(0);             // ring 3, not picked
  // exactly 15 shaded tiles (tree is centered, no edge clipping)
  let n = 0;
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++)
    if (g.tiles[y][x].canopyShade > 0) n++;
  expect(n).toBe(15);
});

test("young tree (growth 70) shades a plus-shape of 5", () => {
  const g = soilGrid();
  g.tiles[8][8].plant = { kind: "tree", growth: 70 };
  computeShadeMap(g);
  expect(g.tiles[9][8].canopyShade).toBeGreaterThan(0); // orthogonal
  expect(g.tiles[8][9].canopyShade).toBeGreaterThan(0);
  expect(g.tiles[9][9].canopyShade).toBe(0);            // diagonal: no shade
  expect(g.tiles[10][8].canopyShade).toBe(0);          // two away: no shade
  let n = 0;
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++)
    if (g.tiles[y][x].canopyShade > 0) n++;
  expect(n).toBe(5);
});

test("sapling casts no shade; overlapping canopies cap at 3", () => {
  const g = soilGrid();
  g.tiles[4][4].plant = { kind: "tree", growth: 30 };
  computeShadeMap(g);
  expect(g.tiles[4][4].canopyShade).toBe(0);
  expect(g.tiles[5][5].canopyShade).toBe(0);
  // four mature trees around one tile: each contributes, cap holds
  const h = soilGrid();
  h.tiles[7][7].plant = { kind: "tree", growth: 100 };
  h.tiles[7][9].plant = { kind: "tree", growth: 100 };
  h.tiles[9][7].plant = { kind: "tree", growth: 100 };
  h.tiles[9][9].plant = { kind: "tree", growth: 100 };
  computeShadeMap(h);
  expect(h.tiles[8][8].canopyShade).toBeLessThanOrEqual(3);
  expect(h.tiles[8][8].canopyShade).toBeGreaterThan(0);
});

/* ---------------- 2. shade mechanics ---------------- */

test("shaded soil evaporates slower", () => {
  const mk = (withTree) => {
    const g = soilGrid("fishkill", 99, 80);
    if (withTree) g.tiles[5][5].plant = { kind: "tree", growth: 100 };
    return g;
  };
  const a = mk(true), b = mk(false);
  tickGrid(a, fixedRand(1), 1e9);
  tickGrid(b, fixedRand(1), 1e9);
  // tile (6,6): manhattan 2 from the tree → shaded in a, open in b
  expect(a.tiles[6][6].water).toBeGreaterThan(b.tiles[6][6].water);
});

test("shade slows grass growth but not tree growth", () => {
  const mk = (kind) => {
    const g = soilGrid("fishkill", 99, 80);
    g.tiles[5][5].plant = { kind: "tree", growth: 100 }; // shade source
    g.tiles[6][6].plant = { kind, growth: 10 };
    return g;
  };
  // grass under shade vs open
  const ga = mk("grass"), gb = soilGrid("fishkill", 99, 80);
  gb.tiles[6][6].plant = { kind: "grass", growth: 10 };
  const g0 = 10;
  tickGrid(ga, fixedRand(5), 1e9);
  tickGrid(gb, fixedRand(5), 1e9);
  const shadedGain = ga.tiles[6][6].plant.growth - g0;
  const openGain = gb.tiles[6][6].plant.growth - g0;
  expect(shadedGain).toBeGreaterThan(0);
  expect(shadedGain).toBeLessThan(openGain);
  // tree under shade: unaffected
  const ta = mk("tree"), tb = soilGrid("fishkill", 99, 80);
  tb.tiles[6][6].plant = { kind: "tree", growth: 10 };
  tickGrid(ta, fixedRand(5), 1e9);
  tickGrid(tb, fixedRand(5), 1e9);
  const tShaded = ta.tiles[6][6].plant.growth - g0;
  const tOpen = tb.tiles[6][6].plant.growth - g0;
  expect(Math.abs(tShaded - tOpen)).toBeLessThan(1e-9);
});

/* ---------------- 3. germination bursts ---------------- */

test("germination burst spawns 6-10 motes plus one ring", () => {
  for (let s = 0; s < 20; s++) {
    const pool = [];
    const n = E.spawnGerminationBurst(pool, 320, 0, 0, 0, mulberry32(s));
    const motes = pool.filter((p) => p.kind === "mote").length;
    const rings = pool.filter((p) => p.kind === "ring").length;
    expect(motes).toBeGreaterThanOrEqual(6);
    expect(motes).toBeLessThanOrEqual(10);
    expect(rings).toBe(1);
    expect(n).toBe(motes + rings);
  }
});

test("burst pool evicts oldest when full", () => {
  const pool = [];
  const r = mulberry32(3);
  for (let i = 0; i < 40; i++) E.spawnGerminationBurst(pool, 20, 0, 0, 0, r);
  expect(pool.length).toBeLessThanOrEqual(20);
});

test("particles rise, drag, and die on schedule", () => {
  const pool = [];
  E.spawnGerminationBurst(pool, 320, 1, 2, 3, mulberry32(11));
  const mote = pool.find((p) => p.kind === "mote");
  const y0 = mote.y, vy0 = mote.vy;
  E.updateParticles(pool, 0.1);
  expect(mote.y).toBeGreaterThan(y0);      // rising
  expect(mote.vy).toBeLessThan(vy0);       // drag eases the rise
  expect(mote.life).toBeCloseTo(0.1, 9);
  E.updateParticles(pool, 5);              // far past maxLife
  expect(pool.length).toBe(0);             // everything faded
});

test("tickGrid emits germinate events for natural births", () => {
  const g = soilGrid("fishkill", 4242, 80);
  g.tiles[8][8].plant = { kind: "grass", growth: 100 };
  let found = null;
  for (let t = 0; t < 40 && !found; t++) {
    const evs = tickGrid(g, mulberry32(9000 + t), 1e9 + t * 800);
    found = evs.find((e) => e.type === "germinate") || null;
  }
  expect(found).not.toBe(null);
  expect(found.kind).toBe("grass");
  expect(cheb(found.x, found.y, 8, 8)).toBeLessThanOrEqual(1);
});

/* ---------------- 4. stage pop ---------------- */

test("plantStage boundaries match the model morphs", () => {
  // boundaries on eased growth: grass/tree at eoc(g/100)=0.35/0.7 → raw ≈13.38/33.06
  // flower at 0.3/0.65 → raw ≈11.21/29.53 (must match the builders' morph logic)
  expect(M.plantStage("grass", 0)).toBe(0);
  expect(M.plantStage("grass", 13)).toBe(0);
  expect(M.plantStage("grass", 14)).toBe(1);
  expect(M.plantStage("grass", 33)).toBe(1);
  expect(M.plantStage("grass", 34)).toBe(2);
  expect(M.plantStage("flower", 11)).toBe(0);
  expect(M.plantStage("flower", 12)).toBe(1);
  expect(M.plantStage("flower", 29)).toBe(1);
  expect(M.plantStage("flower", 30)).toBe(2);
  expect(M.plantStage("tree", 11)).toBe(0);
  expect(M.plantStage("tree", 12)).toBe(1);
  expect(M.plantStage("tree", 33)).toBe(1);
  expect(M.plantStage("tree", 34)).toBe(2);
});

test("popScale: 1.25 at t=0, settles to 1.0, with a bounce", () => {
  expect(M.popScale(0, 500)).toBeCloseTo(1.25, 9);
  expect(M.popScale(500, 500)).toBe(1);
  expect(M.popScale(9999, 500)).toBe(1);
  const mid = M.popScale(400, 500);
  expect(mid).toBeLessThan(1.0); // easeOutBack overshoot dips below 1
  expect(mid).toBeGreaterThan(0.9);
});

test("stage pop triggers exactly on boundary crossing", () => {
  const scene = new E.Scene3D(
    { makeLayer: () => ({}), upload: () => {}, updateColors: () => {}, canvas: { width: 8, height: 8 } },
    M
  );
  const grids = { fishkill: soilGrid("fishkill", 5, 80), brooklyn: soilGrid("brooklyn", 6, 80) };
  const T = grids.fishkill.tiles;
  T[3][3].plant = { kind: "grass", growth: 10 }; // stage 0
  expect(scene.updatePops(grids, 1000, false)).toBe(false); // first sight: no pop
  expect(scene.popScaleAt("fishkill", 3, 3, 1000)).toBe(1);
  T[3][3].plant.growth = 40; // crosses into stage 1
  expect(scene.updatePops(grids, 2000, false)).toBe(true);
  expect(scene.popScaleAt("fishkill", 3, 3, 2000)).toBeCloseTo(1.25, 9);
  expect(scene.updatePops(grids, 2600, false)).toBe(false); // pop finished
  expect(scene.popScaleAt("fishkill", 3, 3, 2600)).toBe(1);
  // same stage, more growth: no new pop
  T[3][3].plant.growth = 50;
  expect(scene.updatePops(grids, 3000, false)).toBe(false);
});

test("no pop under reduced motion; plant removal clears tracking", () => {
  const scene = new E.Scene3D(
    { makeLayer: () => ({}), upload: () => {}, updateColors: () => {}, canvas: { width: 8, height: 8 } },
    M
  );
  const grids = { fishkill: soilGrid("fishkill", 5, 80), brooklyn: soilGrid("brooklyn", 6, 80) };
  const T = grids.fishkill.tiles;
  T[3][3].plant = { kind: "flower", growth: 10 };
  scene.updatePops(grids, 1000, true);
  T[3][3].plant.growth = 40; // stage 0 → 1, but reduced motion
  expect(scene.updatePops(grids, 2000, true)).toBe(false);
  expect(scene.popScaleAt("fishkill", 3, 3, 2000)).toBe(1);
  // burn it down: tracking cleared
  T[3][3].plant = null;
  scene.updatePops(grids, 3000, false);
  expect(scene.popMap.has("fishkill:3:3")).toBe(false);
});

/* ---------------- 5. built-environment ephemera ---------------- */

test("new brooklyn kinds appear; new fishkill kinds appear", () => {
  const seenB = new Set(), seenF = new Set();
  for (let s = 0; s < 40; s++) {
    for (const d of createGrid("brooklyn", fixedRand(s)).decor) seenB.add(d.kind);
    for (const d of createGrid("fishkill", fixedRand(1000 + s)).decor) seenF.add(d.kind);
  }
  for (const k of ["sodacan", "cardboard", "brickchip", "glassshard"])
    expect(seenB.has(k)).toBe(true);
  for (const k of ["potshard", "straw", "fencepost"])
    expect(seenF.has(k)).toBe(true);
  expect(seenF.has("sodacan")).toBe(false); // urban litter stays urban
  expect(seenB.has("fencepost")).toBe(false);
  expect(seenB.has("potshard")).toBe(false);
});

test("fenceposts: 2-3 per fishkill plot, on edge tiles", () => {
  for (let s = 0; s < 20; s++) {
    const g = createGrid("fishkill", fixedRand(s));
    const posts = g.decor.filter((d) => d.kind === "fencepost");
    expect(posts.length).toBeGreaterThanOrEqual(2);
    expect(posts.length).toBeLessThanOrEqual(3);
    for (const p of posts)
      expect(p.x === 0 || p.x === SIZE - 1 || p.y === 0 || p.y === SIZE - 1).toBe(true);
  }
});

test("glassshard respects its rarity cap", () => {
  let max = 0;
  for (let s = 0; s < 30; s++) {
    const g = createGrid("brooklyn", fixedRand(s));
    max = Math.max(max, g.decor.filter((d) => d.kind === "glassshard").length);
  }
  expect(max).toBeLessThanOrEqual(4);
});

test("every new decor kind builds valid geometry", () => {
  for (const kind of ["sodacan", "cardboard", "brickchip", "glassshard", "potshard", "fencepost", "straw"]) {
    const L = M.decorItem(kind, mulberry32(77));
    expect(L.opaque.pos.length).toBeGreaterThan(0);
    expect(M.validIndices(L.opaque)).toBe(true);
  }
  // glass shards glint: high emissive
  const gl = M.decorItem("glassshard", mulberry32(77));
  expect(Math.max(...gl.opaque.emi)).toBeGreaterThan(0.5);
});

test("new decor never blocks planting", () => {
  const g = soilGrid("brooklyn", 31337, 80);
  let checked = 0;
  for (const d of g.decor) {
    if (["sodacan", "cardboard", "brickchip", "glassshard"].includes(d.kind)) {
      const t = g.tiles[d.y][d.x];
      t.plant = null;
      const res = applyItem(g, d.x, d.y, "grass_seed", fixedRand(1), 1e9);
      expect(res.ok).toBe(true);
      checked++;
    }
  }
  expect(checked).toBeGreaterThan(0);
});

test("shade disc geometry only for shading trees", () => {
  const scene = new E.Scene3D(
    { makeLayer: () => ({}), upload: () => {}, updateColors: () => {}, canvas: { width: 8, height: 8 } },
    M
  );
  const grids = { fishkill: soilGrid("fishkill", 5, 80), brooklyn: soilGrid("brooklyn", 6, 80) };
  grids.fishkill.tiles[2][2].plant = { kind: "tree", growth: 100 }; // shade 2
  grids.fishkill.tiles[4][4].plant = { kind: "tree", growth: 30 };  // no shade
  scene.buildTerrain(grids, mulberry32(8));
  const L = scene.buildPlants(grids, mulberry32(9), 1_000_000);
  expect(L.opaque.pos.length).toBeGreaterThan(0);
  expect(M.validIndices(L.opaque)).toBe(true);
});

test("terrain colors darken under canopy shade", () => {
  const scene = new E.Scene3D(
    { makeLayer: () => ({}), upload: () => {}, updateColors: () => {}, canvas: { width: 8, height: 8 } },
    M
  );
  const grids = { fishkill: soilGrid("fishkill", 5, 80), brooklyn: soilGrid("brooklyn", 6, 80) };
  grids.fishkill.tiles[8][8].plant = { kind: "tree", growth: 100 };
  computeShadeMap(grids.fishkill);
  scene.buildTerrain(grids, mulberry32(8));
  // force same ground/moisture for a fair comparison
  for (const [x, y] of [[8, 8], [0, 0]]) {
    const t = grids.fishkill.tiles[y][x];
    t.ground = "soil"; t.water = 50; t.ash = 0;
  }
  const cols2 = scene.terrainColors(grids, false);
  const lum = (x, y) => {
    const ti = y * SIZE + x, o = ti * 24 * 4;
    return cols2[o] + cols2[o + 1] + cols2[o + 2];
  };
  expect(lum(8, 8)).toBeLessThan(lum(0, 0));
});
