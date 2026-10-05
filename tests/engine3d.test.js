// LIVE/EXTINGUISH 3D engine tests — no GPU. Pure math, model builders,
// batching, and a stubbed renderer for the scene orchestration.
const { test, expect } = require("bun:test");
const M = require("../models3d.js");
const E = require("../engine3d.js");
const { createGrid, applyItem, mulberry32, ITEM_KEYS, SIZE } = require("../app.js");

/* ---------- layout ---------- */
test("tileToWorld/worldToTile round-trip, both plots", () => {
  for (const plot of ["fishkill", "brooklyn"]) {
    for (const [x, y] of [[0, 0], [15, 15], [7, 3], [0, 15], [15, 0]]) {
      const w = E.tileToWorld(plot, x, y);
      const back = E.worldToTile(w.x, w.z);
      expect(back.plot).toBe(plot);
      expect(back.x).toBe(x);
      expect(back.y).toBe(y);
    }
  }
});

test("worldToTile: gap and outside return null", () => {
  expect(E.worldToTile(0, 0)).toBeNull();          // wild-grass gap
  expect(E.worldToTile(-1.5, 0)).toBeNull();      // gap between plots
  expect(E.worldToTile(1.9, 0)).toBeNull();       // gap, brooklyn edge
  expect(E.worldToTile(100, 100)).toBeNull();
  expect(E.worldToTile(-14.5, -9)).toBeNull();    // z out of range
  expect(E.worldToTile(-14.5, 9)).toBeNull();
});

test("plots do not overlap; brooklyn sits right of fishkill", () => {
  const f = E.tileToWorld("fishkill", 15, 8);
  const b = E.tileToWorld("brooklyn", 0, 8);
  expect(b.x).toBeGreaterThan(f.x);
  expect(b.x - f.x).toBeGreaterThan(2); // visible gap
});

/* ---------- matrices ---------- */
test("mInverse: (P*V) * inv ≈ identity", () => {
  const P = E.mPerspective(45, 16 / 9, 0.1, 200);
  const V = E.mLookAt([0, 23, 28], [0, 0.5, 0], [0, 1, 0]);
  const PV = E.mMul4(P, V);
  const inv = E.mInverse(PV);
  expect(inv).not.toBeNull();
  const id = E.mMul4(PV, inv);
  for (let i = 0; i < 16; i++) {
    const want = i % 5 === 0 ? 1 : 0;
    expect(Math.abs(id[i] - want)).toBeLessThan(1e-9);
  }
});

test("mLookAt maps the eye to the origin", () => {
  const eye = [3, 10, 20], tgt = [0, 0.5, 0];
  const V = E.mLookAt(eye, tgt, [0, 1, 0]);
  const p = E.xform4(V, eye[0], eye[1], eye[2], 1);
  expect(Math.abs(p[0])).toBeLessThan(1e-9);
  expect(Math.abs(p[1])).toBeLessThan(1e-9);
  expect(Math.abs(p[2])).toBeLessThan(1e-9);
  // ...and the target lands on -Z at the eye distance
  const q = E.xform4(V, tgt[0], tgt[1], tgt[2], 1);
  const dist = Math.hypot(eye[0]-tgt[0], eye[1]-tgt[1], eye[2]-tgt[2]);
  expect(Math.abs(q[0])).toBeLessThan(1e-9);
  expect(Math.abs(q[1])).toBeLessThan(1e-9);
  expect(Math.abs(q[2] + dist)).toBeLessThan(1e-9);
});

test("mPerspective has expected focal entries", () => {
  const P = E.mPerspective(90, 1, 0.1, 100);
  expect(Math.abs(P[0] - 1)).toBeLessThan(1e-9); // f/aspect, f=1 at 90°
  expect(P[11]).toBe(-1);
});

/* ---------- picking ---------- */
test("rayPlaneY: known ray hits known point; parallel misses", () => {
  const pt = E.rayPlaneY([0, 10, 5], [0, -1, 0], 0);
  expect(pt[0]).toBeCloseTo(0, 9);
  expect(pt[1]).toBe(0);
  expect(pt[2]).toBeCloseTo(5, 9);
  expect(E.rayPlaneY([0, 10, 5], [1, 0, 0], 0)).toBeNull();
  expect(E.rayPlaneY([0, 10, 5], [0, 1, 0], 0)).toBeNull(); // pointing away
});

test("pickTile: project-then-repick round-trips", () => {
  const cam = new E.Camera();
  const V = cam.viewMatrix(0), P = E.mPerspective(45, 1400 / 800, 0.1, 240);
  const VP = E.mMul4(P, V);
  for (const [plot, x, y] of [["fishkill", 3, 5], ["brooklyn", 12, 9], ["fishkill", 0, 0]]) {
    const w = E.tileToWorld(plot, x, y);
    const clip = E.xform4(VP, w.x, 0, w.z, 1);
    const sx = (clip[0] / clip[3] * 0.5 + 0.5) * 1400;
    const sy = (1 - (clip[1] / clip[3] * 0.5 + 0.5)) * 800;
    const hit = E.pickTile(sx, sy, 1400, 800, cam, 0);
    expect(hit).not.toBeNull();
    expect(hit.plot).toBe(plot);
    expect(hit.x).toBe(x);
    expect(hit.y).toBe(y);
  }
});

test("Camera orbit clamps elevation; zoom clamps radius", () => {
  const cam = new E.Camera();
  cam.orbit(0, 100000);
  expect(cam.elevation).toBeGreaterThanOrEqual(E.CAM.minElev);
  cam.orbit(0, -100000);
  expect(cam.elevation).toBeLessThanOrEqual(E.CAM.maxElev);
  cam.zoom(0.0001);
  expect(cam.radius).toBeGreaterThanOrEqual(E.CAM.minR);
  cam.zoom(100000);
  expect(cam.radius).toBeLessThanOrEqual(E.CAM.maxR);
});

/* ---------- model builders ---------- */
test("primitives have valid indices", () => {
  for (const L of [
    M.box(1, 1, 1, [1, 0, 0]).p ? batchOf(M.box(1, 1, 1, [1, 0, 0])) : null,
  ].filter(Boolean)) {
    expect(M.validIndices(L.opaque)).toBe(true);
  }
  const b = new M.Batcher();
  b.add(M.cone(0.2, 0.8, 6, [1, 0, 0]), null);
  b.add(M.cyl(0.1, 0.1, 0.5, 6, [0, 1, 0]), null);
  b.add(M.sphere(0.5, 7, [0, 0, 1]), null);
  b.add(M.disc(0.5, 8, [1, 1, 1]), null);
  const L = b.finish();
  expect(M.validIndices(L.opaque)).toBe(true);
});

function batchOf(chunk) {
  const b = new M.Batcher();
  b.add(chunk, null);
  return b.finish();
}

test("Batcher offsets indices across chunks; translate applies", () => {
  const b = new M.Batcher();
  b.add(M.box(1, 1, 1, [1, 0, 0]), M.mTranslate(5, 0, 0));
  b.add(M.box(1, 1, 1, [0, 1, 0]), M.mTranslate(-5, 0, 0));
  const L = b.finish();
  expect(L.opaque.pos.length / 3).toBe(48);
  expect(L.opaque.idx[36]).toBe(24); // second box starts at vert 24
  expect(M.validIndices(L.opaque)).toBe(true);
  expect(L.opaque.pos[0]).toBeCloseTo(4.5, 9);   // box centered → x -0.5+5
  expect(L.opaque.pos[24 * 3]).toBeCloseTo(-5.5, 9);
});

test("Batcher routes alpha<1 chunks to the transparent bucket", () => {
  const b = new M.Batcher();
  b.add(M.disc(0.5, 8, M.PAL.water.concat([0.42])), null);
  b.add(M.box(1, 1, 1, [1, 0, 0]), null);
  const L = b.finish();
  expect(L.trans.pos.length).toBeGreaterThan(0);
  expect(L.opaque.pos.length).toBeGreaterThan(0);
});

test("grassTuft fits in a tile and sits on the ground", () => {
  const L = M.grassTuft(mulberry32(3), 80);
  const bb = M.bboxOf(L.opaque);
  expect(bb.min[1]).toBeGreaterThanOrEqual(-0.01);
  expect(bb.max[0] - bb.min[0]).toBeLessThan(1.0);
  expect(bb.max[2] - bb.min[2]).toBeLessThan(1.0);
  expect(M.validIndices(L.opaque)).toBe(true);
});

test("tree grows taller with growth", () => {
  const small = M.bboxOf(M.tree(mulberry32(4), 20).opaque);
  const big = M.bboxOf(M.tree(mulberry32(4), 100).opaque);
  expect(big.max[1]).toBeGreaterThan(small.max[1] * 1.3);
});

test("flower petal color varies by colorIdx", () => {
  const a = M.flower(mulberry32(5), 100, 0);
  const b2 = M.flower(mulberry32(5), 100, 3);
  // find a petal vertex: blossom verts are past the stem; compare average color
  const avg = (L) => {
    const c = L.opaque.col; let r = 0, g = 0, bl = 0, n = 0;
    for (let i = 0; i < c.length; i += 4) { r += c[i]; g += c[i+1]; bl += c[i+2]; n++; }
    return [r / n, g / n, bl / n];
  };
  const ca = avg(a), cb = avg(b2);
  const diff = Math.abs(ca[0] - cb[0]) + Math.abs(ca[1] - cb[1]) + Math.abs(ca[2] - cb[2]);
  expect(diff).toBeGreaterThan(0.05);
});

test("tokenFor covers every item type with non-empty geometry", () => {
  for (const key of ITEM_KEYS) {
    const t = M.tokenFor(key);
    const n = t.opaque.pos.length + t.trans.pos.length;
    expect(n).toBeGreaterThan(0);
    expect(M.validIndices(t.opaque)).toBe(true);
  }
});

test("flame is emissive; highlightRing is transparent", () => {
  const f = M.flame(0.5);
  expect(f.opaque.emi[0]).toBeGreaterThan(0.5);
  const h = M.highlightRing(0);
  expect(h.trans.pos.length).toBeGreaterThan(0);
});

test("mergeLayer + translateLayer preserve geometry", () => {
  const b = new M.Batcher();
  const t = M.tokenFor("soil");
  M.mergeLayer(b, M.translateLayer(t, 10, 0, -3));
  const L = b.finish();
  expect(L.opaque.pos.length).toBe(t.opaque.pos.length);
  const bb = M.bboxOf(L.opaque);
  expect(bb.min[0]).toBeGreaterThan(9);
});

/* ---------- renderer graceful failure ---------- */
test("createRenderer returns null when WebGL is unavailable", () => {
  const bad = { getContext: () => null };
  expect(E.createRenderer(bad)).toBeNull();
  const throwing = { getContext: () => { throw new Error("nope"); } };
  expect(E.createRenderer(throwing)).toBeNull();
});

test("index.html ships the WebGL fallback path", () => {
  const fs = require("node:fs");
  const html = fs.readFileSync(__dirname + "/../index.html", "utf8");
  expect(html).toContain('id="glFallback"');
  expect(html).toContain("location.reload()");
});

/* ---------- scene orchestration (stubbed renderer) ---------- */
function stubRenderer() {
  return {
    makeLayer: () => ({}),
    upload: () => {},
    updateColors: () => {},
    draw: () => {},
    resize: () => {},
    clear: () => {},
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

test("Scene3D.buildTerrain covers 512 tiles with meta + heights", () => {
  const scene = new E.Scene3D(stubRenderer(), M);
  const grids = { fishkill: livelyGrid(), brooklyn: createGrid("brooklyn", mulberry32(7)) };
  const t = scene.buildTerrain(grids, mulberry32(8));
  expect(t.meta.length).toBe(512);
  expect(t.heights.length).toBe(512);
  expect(t.idxOf.length).toBe(512);
  // concrete tiles sit higher than soil tiles (brooklyn is mostly concrete)
  const soilH = t.heights[0]; // fishkill 0,0 → soil (forced)
  expect(soilH).toBeLessThan(0.15);
  const cols = scene.terrainColors(grids, false);
  expect(cols.length).toBe(512 * 24 * 4);
  expect(M.validIndices(t.geo.opaque)).toBe(true);
});

test("Scene3D.buildPlants emits plants, water sheen, smog; indices valid", () => {
  const scene = new E.Scene3D(stubRenderer(), M);
  const grids = { fishkill: livelyGrid(), brooklyn: createGrid("brooklyn", mulberry32(7)) };
  scene.buildTerrain(grids, mulberry32(8));
  const L = scene.buildPlants(grids, mulberry32(9), 1_000_000);
  expect(L.opaque.pos.length).toBeGreaterThan(0);
  expect(L.trans.pos.length).toBeGreaterThan(0); // water disc + smog box
  expect(M.validIndices(L.opaque)).toBe(true);
  expect(M.validIndices(L.trans)).toBe(true);
});

test("Scene3D.buildFx emits sky dome (emissive), sun, clouds", () => {
  const scene = new E.Scene3D(stubRenderer(), M);
  const grids = { fishkill: livelyGrid(), brooklyn: createGrid("brooklyn", mulberry32(7)) };
  scene.buildTerrain(grids, mulberry32(8));
  const L = scene.buildFx({
    grids, falling: [], now: 1_000_000, reducedMotion: true,
    seasonProgress: 0.5, rand: mulberry32(10),
  });
  expect(L.opaque.pos.length).toBeGreaterThan(500);
  expect(L.opaque.emi.some((v) => v > 0.9)).toBe(true); // sun/dome glow
});

test("sunPosition arcs dawn→dusk", () => {
  const dawn = E.sunPosition(0), noon = E.sunPosition(0.5), dusk = E.sunPosition(1);
  expect(dawn[0]).toBeLessThan(0);
  expect(dusk[0]).toBeGreaterThan(0);
  expect(noon[1]).toBeGreaterThan(dawn[1]);
  expect(noon[1]).toBeGreaterThan(dusk[1]);
});

test("mulberryLike is deterministic", () => {
  const a = E.mulberryLike(3.7), b = E.mulberryLike(3.7);
  expect(a()).toBe(b());
  expect(a()).toBe(b());
});
