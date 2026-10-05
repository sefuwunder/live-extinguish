/* LIVE/EXTINGUISH — models3d.js
 * Procedural 3D model builders. Zero dependencies, no DOM, no WebGL.
 * Builders emit geometry chunks; Batcher merges them into draw layers.
 * Chunk format: { p:[x,y,z...], n:[nx,ny,nz...], c:[r,g,b(,a)...], e:[emis...]|emis, idx:[...] }
 * Layer format: { pos:Float32Array, nor:Float32Array, col:Float32Array(rgba), emi:Float32Array, idx:Uint16Array }
 */
"use strict";

/* ---------------- palette (linear-ish 0..1, zen earth) ---------------- */
const PAL = {
  soil: [0.52, 0.40, 0.27], soilDeep: [0.36, 0.27, 0.18],
  concrete: [0.62, 0.60, 0.56], concreteDeep: [0.48, 0.46, 0.43],
  ash: [0.23, 0.22, 0.21],
  grassA: [0.58, 0.70, 0.40], grassB: [0.24, 0.42, 0.20],
  wildGrass: [0.45, 0.55, 0.32],
  stem: [0.30, 0.46, 0.22],
  petals: [
    [0.84, 0.40, 0.53], [0.90, 0.70, 0.77], [0.78, 0.43, 0.28],
    [0.88, 0.77, 0.46], [0.70, 0.46, 0.78], [0.95, 0.93, 0.88],
  ],
  petalCenter: [0.90, 0.77, 0.28],
  trunk: [0.35, 0.28, 0.20], leafA: [0.46, 0.58, 0.33], leafB: [0.19, 0.33, 0.16],
  fireA: [0.95, 0.38, 0.10], fireB: [1.0, 0.72, 0.28],
  smoke: [0.52, 0.52, 0.50],
  water: [0.38, 0.58, 0.78],
  smog: [0.58, 0.58, 0.55],
  shadow: [0.16, 0.13, 0.09],
  cloud: [1.0, 0.99, 0.96], cloudShade: [0.82, 0.81, 0.77],
  sun: [1.0, 0.70, 0.32],
  rain: [0.45, 0.65, 0.86],
  cold: [0.62, 0.74, 0.86],
  ground: [0.90, 0.86, 0.76],
  skyTop: [0.72, 0.80, 0.79], skyHorizon: [0.95, 0.87, 0.75],
  highlight: [0.76, 0.43, 0.27],
};

function lerp(a, b, t) { return a + (b - a) * t; }
function mix3(c1, c2, t) { return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)]; }

/* ---------------- tiny mat4 (compose only) ---------------- */
function mIdent() { return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]; }
function mTranslate(x, y, z) { const m = mIdent(); m[12] = x; m[13] = y; m[14] = z; return m; }
function mScale(sx, sy, sz) { const m = mIdent(); m[0] = sx; m[5] = sy; m[10] = sz; return m; }
function mRotY(a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1];
}
// column-major multiply: out = a * b
function mMul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}
function xformPoint(m, x, y, z) {
  return [
    m[0]*x + m[4]*y + m[8]*z + m[12],
    m[1]*x + m[5]*y + m[9]*z + m[13],
    m[2]*x + m[6]*y + m[10]*z + m[14],
  ];
}
function xformNormal(m, x, y, z) {
  // upper 3x3, renormalized (ok for rotation + uniform scale)
  let nx = m[0]*x + m[4]*y + m[8]*z;
  let ny = m[1]*x + m[5]*y + m[9]*z;
  let nz = m[2]*x + m[6]*y + m[10]*z;
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}
function compose(x, y, z, sx, sy, sz, rotY) {
  let m = mIdent();
  if (rotY) m = mMul(mRotY(rotY), m);
  m = mMul(mScale(sx, sy, sz), m);
  m = mMul(mTranslate(x, y, z), m);
  return m;
}

/* ---------------- Batcher ---------------- */
function Batcher() {
  this.op = { p: [], n: [], c: [], e: [], idx: [] };
  this.tr = { p: [], n: [], c: [], e: [], idx: [] };
}
// chunk: {p,n,c,e,idx}; c may be [r,g,b] or [r,g,b,a] or per-vertex flat array;
// e may be a single number or per-vertex array. m: mat4|null. alpha<1 forces transparent pass.
Batcher.prototype.add = function (chunk, m, tint) {
  // Single-color chunks: [r,g,b] opaque, [r,g,b,a] transparent when a<1.
  // Per-vertex color chunks are always treated as opaque rgb.
  const nv = chunk.p.length / 3;
  const perVertC = chunk.c.length === nv * 3 || chunk.c.length === nv * 4;
  const alpha = perVertC ? 1 : (chunk.c.length === 4 ? chunk.c[3] : 1);
  const bucket = alpha < 0.999 ? this.tr : this.op;
  const base = bucket.p.length / 3;
  const perVertE = Array.isArray(chunk.e);
  const hasA = chunk.c.length === nv * 4;
  for (let i = 0; i < nv; i++) {
    let pt = [chunk.p[i*3], chunk.p[i*3+1], chunk.p[i*3+2]];
    let nr = [chunk.n[i*3], chunk.n[i*3+1], chunk.n[i*3+2]];
    if (m) { pt = xformPoint(m, pt[0], pt[1], pt[2]); nr = xformNormal(m, nr[0], nr[1], nr[2]); }
    bucket.p.push(pt[0], pt[1], pt[2]);
    bucket.n.push(nr[0], nr[1], nr[2]);
    let r, g, b, a;
    if (perVertC) { r = chunk.c[i*(hasA?4:3)]; g = chunk.c[i*(hasA?4:3)+1]; b = chunk.c[i*(hasA?4:3)+2]; a = hasA ? chunk.c[i*4+3] : 1; }
    else { r = chunk.c[0]; g = chunk.c[1]; b = chunk.c[2]; a = chunk.c.length === 4 ? chunk.c[3] : 1; }
    if (tint) { r *= tint[0]; g *= tint[1]; b *= tint[2]; }
    bucket.c.push(r, g, b, a);
    bucket.e.push(perVertE ? chunk.e[i] : (typeof chunk.e === "number" ? chunk.e : 0));
  }
  for (let i = 0; i < chunk.idx.length; i++) bucket.idx.push(base + chunk.idx[i]);
};
function toLayer(b) {
  return {
    pos: new Float32Array(b.p), nor: new Float32Array(b.n),
    col: new Float32Array(b.c), emi: new Float32Array(b.e),
    idx: new Uint16Array(b.idx), count: b.idx.length,
  };
}
Batcher.prototype.finish = function () {
  return { opaque: toLayer(this.op), trans: toLayer(this.tr) };
};
Batcher.prototype.opaqueCount = function () { return this.op.idx.length; };
Batcher.prototype.transCount = function () { return this.tr.idx.length; };

function chunk(p, n, c, idx, e) {
  return { p, n, c, idx, e: e === undefined ? 0 : e };
}

/* ---------------- primitives ---------------- */
// Box, y from 0..h, centered on x/z.
function box(w, h, d, color) {
  const x = w / 2, z = d / 2;
  const p = [], n = [], idx = [];
  const faces = [
    { n: [0,1,0],  v: [[-x,h,-z],[x,h,-z],[x,h,z],[-x,h,z]] },
    { n: [0,-1,0], v: [[-x,0,-z],[-x,0,z],[x,0,z],[x,0,-z]] },
    { n: [1,0,0],  v: [[x,0,-z],[x,0,z],[x,h,z],[x,h,-z]] },
    { n: [-1,0,0], v: [[-x,0,-z],[-x,h,-z],[-x,h,z],[-x,0,z]] },
    { n: [0,0,1],  v: [[-x,0,z],[x,0,z],[x,h,z],[-x,h,z]] },
    { n: [0,0,-1], v: [[-x,0,-z],[x,0,-z],[x,h,-z],[-x,h,-z]] },
  ];
  faces.forEach((f, fi) => {
    const base = fi * 4;
    f.v.forEach((v) => { p.push(v[0], v[1], v[2]); n.push(f.n[0], f.n[1], f.n[2]); });
    idx.push(base, base+1, base+2, base, base+2, base+3);
  });
  return chunk(p, n, color, idx);
}
// Cone, base y=0, apex y=h.
function cone(r, h, seg, color) {
  seg = seg || 7;
  const p = [], n = [], idx = [];
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const x0 = Math.cos(a0) * r, z0 = Math.sin(a0) * r;
    const x1 = Math.cos(a1) * r, z1 = Math.sin(a1) * r;
    const base = p.length / 3;
    // side triangle (apex, base0, base1) with rough normals
    p.push(0, h, 0, x0, 0, z0, x1, 0, z1);
    const nx = Math.cos((a0 + a1) / 2), nz = Math.sin((a0 + a1) / 2);
    const nl = Math.hypot(nx, h / r, nz) || 1;
    const sn = [nx / nl, (h / r) / nl, nz / nl];
    for (let k = 0; k < 3; k++) n.push(sn[0], sn[1], sn[2]);
    idx.push(base, base + 2, base + 1);
    // base cap triangle
    const b2 = p.length / 3;
    p.push(0, 0, 0, x1, 0, z1, x0, 0, z0);
    for (let k = 0; k < 3; k++) n.push(0, -1, 0);
    idx.push(b2, b2 + 1, b2 + 2);
  }
  return chunk(p, n, color, idx);
}
// Cylinder y 0..h, radius bottom r1 top r2.
function cyl(r1, r2, h, seg, color) {
  seg = seg || 7;
  const p = [], n = [], idx = [];
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
    const base = p.length / 3;
    p.push(c0*r1, 0, s0*r1, c1*r1, 0, s1*r1, c1*r2, h, s1*r2, c0*r2, h, s0*r2);
    const am = (a0 + a1) / 2, nx = Math.cos(am), nz = Math.sin(am);
    for (let k = 0; k < 4; k++) n.push(nx, 0, nz);
    idx.push(base, base+1, base+2, base, base+2, base+3);
  }
  // top cap
  const tb = p.length / 3;
  p.push(0, h, 0);
  n.push(0, 1, 0);
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    p.push(Math.cos(a)*r2, h, Math.sin(a)*r2); n.push(0, 1, 0);
    idx.push(tb, tb + 1 + i, tb + 1 + ((i + 1) % seg));
  }
  return chunk(p, n, color, idx);
}
// Low-poly sphere centered at origin.
function sphere(r, seg, color) {
  seg = seg || 8;
  const rings = Math.max(3, Math.floor(seg / 2));
  const p = [], n = [], idx = [];
  for (let ri = 0; ri <= rings; ri++) {
    const th = (ri / rings) * Math.PI;
    const y = Math.cos(th) * r, rr = Math.sin(th) * r;
    for (let si = 0; si <= seg; si++) {
      const ph = (si / seg) * Math.PI * 2;
      const x = Math.cos(ph) * rr, z = Math.sin(ph) * rr;
      p.push(x, y, z);
      const l = Math.hypot(x, y, z) || 1;
      n.push(x / l, y / l, z / l);
    }
  }
  for (let ri = 0; ri < rings; ri++) for (let si = 0; si < seg; si++) {
    const a = ri * (seg + 1) + si, b = a + seg + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  return chunk(p, n, color, idx);
}
// Flat disc in XZ plane at y=0 (for shadows, water sheen).
function disc(r, seg, color) {
  seg = seg || 10;
  const p = [0, 0, 0], n = [0, 1, 0], idx = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    p.push(Math.cos(a) * r, 0, Math.sin(a) * r); n.push(0, 1, 0);
  }
  for (let i = 1; i <= seg; i++) idx.push(0, i, i + 1);
  return chunk(p, n, color, idx);
}
// Thin vertical quad (rain streak), centered x/z, y -h/2..h/2.
function streak(w, h, color) {
  const x = w / 2, y = h / 2;
  return chunk(
    [-x,-y,0, x,-y,0, x,y,0, -x,y,0],
    [0,0,1, 0,0,1, 0,0,1, 0,0,1],
    color, [0,1,2, 0,2,3]
  );
}

/* ---------------- composite models ---------------- */
function grassTuft(rand, growth) {
  // growth 0..100 → g 0..1
  const g = Math.max(0.08, Math.min(1, growth / 100));
  const b = new Batcher();
  const blades = 4;
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2 + rand() * 0.8;
    const tilt = 0.12 + rand() * 0.22;
    const h = (0.30 + rand() * 0.25) * (0.35 + 0.65 * g);
    const m = compose(Math.cos(a) * 0.16, 0, Math.sin(a) * 0.16, 1, 1, 1, 0);
    const lean = mMul(mTranslate(Math.cos(a) * tilt * h * 0.5, 0, Math.sin(a) * tilt * h * 0.5), m);
    b.add(cone(0.07, h, 5, mix3(PAL.grassA, PAL.grassB, g * (0.4 + rand() * 0.6))), lean);
  }
  return b.finish();
}

function flower(rand, growth, colorIdx) {
  const g = Math.max(0.1, Math.min(1, growth / 100));
  const b = new Batcher();
  const stemH = 0.25 + 0.45 * g;
  b.add(cyl(0.025, 0.035, stemH, 6, PAL.stem), mTranslate(0, 0, 0));
  const petal = PAL.petals[colorIdx % PAL.petals.length];
  const pr = 0.09 + 0.10 * g;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rand() * 0.5;
    const m = compose(Math.cos(a) * pr, stemH, Math.sin(a) * pr, 1, 0.45, 1, 0);
    b.add(sphere(pr * 0.62, 6, petal), m);
  }
  b.add(sphere(pr * 0.45, 6, PAL.petalCenter), mTranslate(0, stemH + pr * 0.2, 0));
  return b.finish();
}

function tree(rand, growth) {
  const g = Math.max(0.12, Math.min(1, growth / 100));
  const b = new Batcher();
  const trunkH = 0.35 + 0.85 * g;
  b.add(cyl(0.07 + 0.05 * g, 0.10 + 0.06 * g, trunkH, 7, PAL.trunk), mTranslate(0, 0, 0));
  const cr = 0.32 + 0.55 * g;
  const leaf = mix3(PAL.leafA, PAL.leafB, 0.3 + rand() * 0.5);
  b.add(sphere(cr, 8, leaf), mTranslate(0, trunkH + cr * 0.75, 0));
  b.add(sphere(cr * 0.62, 7, mix3(leaf, PAL.leafA, 0.4)), mTranslate(-cr * 0.35, trunkH + cr * 0.35, cr * 0.2));
  b.add(sphere(cr * 0.5, 7, mix3(leaf, PAL.leafB, 0.3)), mTranslate(cr * 0.3, trunkH + cr * 1.15, -cr * 0.15));
  return b.finish();
}

// Flame: outer + inner cone. flicker 0..1 scales height (applied by scene per frame).
function flame(flicker) {
  const b = new Batcher();
  const f = 0.75 + 0.5 * flicker;
  b.add(cone(0.22, 0.85 * f, 7, PAL.fireA), mTranslate(0, 0, 0));
  b.add(cone(0.12, 0.55 * f, 6, PAL.fireB), mTranslate(0, 0.05, 0));
  // emissive so flames glow regardless of light
  const L = b.finish();
  L.opaque.emi.fill(0.85);
  return L;
}

function smokePuff(t) {
  // small grey box, alpha handled by color
  const c = PAL.smoke.concat([0.32]);
  return chunk(
    [-0.16,-0.16,-0.16, 0.16,-0.16,-0.16, 0.16,0.16,-0.16, -0.16,0.16,-0.16,
     -0.16,-0.16,0.16, 0.16,-0.16,0.16, 0.16,0.16,0.16, -0.16,0.16,0.16],
    [0,0,-1, 0,0,-1, 0,0,-1, 0,0,-1, 0,0,1, 0,0,1, 0,0,1, 0,0,1],
    c, [0,1,2, 0,2,3, 4,6,5, 4,7,6]
  );
}

function cloudCluster(rand, grey) {
  const b = new Batcher();
  const col = grey ? PAL.cloudShade : PAL.cloud;
  const n = 4 + Math.floor(rand() * 2);
  for (let i = 0; i < n; i++) {
    const r = 0.9 + rand() * 0.9;
    b.add(sphere(r, 7, i === 0 ? col : mix3(col, PAL.cloudShade, rand() * 0.5)),
      compose((i - n / 2) * 1.3 + rand(), rand() * 0.4, rand() * 1.2 - 0.6, 1.4, 0.75, 1.1, 0));
  }
  return b.finish();
}

function sunBall() {
  const L = new Batcher();
  L.add(sphere(2.0, 10, PAL.sun), mIdent());
  const out = L.finish();
  out.opaque.emi.fill(1);
  return out;
}

// Sky-dome: big sphere, vertex colors gradient zenith→horizon, emissive (no fog wash).
function skyDome() {
  const c = sphere(95, 12, [1, 1, 1]);
  const nv = c.p.length / 3;
  const cols = [];
  for (let i = 0; i < nv; i++) {
    const t = Math.max(0, Math.min(1, (c.p[i*3+1] / 95 + 1) / 2)); // 0 bottom → 1 top
    const col = mix3(PAL.skyHorizon, PAL.skyTop, Math.pow(t, 0.8));
    cols.push(col[0], col[1], col[2]);
  }
  c.c = cols;
  c.e = 1;
  return c;
}

// Falling-item tokens (small 3D glyphs).
function tokenFor(itemKey) {
  const b = new Batcher();
  switch (itemKey) {
    case "grass_seed": b.add(sphere(0.16, 6, PAL.grassB), mIdent()); break;
    case "flower_seed": b.add(sphere(0.16, 6, PAL.petals[0]), mIdent()); break;
    case "tree_seed": b.add(sphere(0.18, 6, PAL.leafB), mIdent()); break;
    case "oxygen": b.add(sphere(0.22, 7, PAL.cloud), mIdent()); break;
    case "smog": b.add(box(0.4, 0.28, 0.4, PAL.smog.concat([0.8])), mIdent()); break;
    case "flies": b.add(sphere(0.12, 5, [0.2,0.18,0.16]), mTranslate(-0.12, 0, 0));
      b.add(sphere(0.12, 5, [0.2,0.18,0.16]), mTranslate(0.12, 0.1, 0)); break;
    case "fire": { const f = flame(0.5); mergeLayer(b, f.opaque); break; }
    case "water": { // octahedron ≈ two cones
      const L = new Batcher();
      L.add(cone(0.18, 0.3, 4, PAL.water), mIdent());
      L.add(cone(0.18, 0.3, 4, PAL.water), mMul(mTranslate(0, 0.6, 0), mScale(1, -1, 1)));
      mergeLayer(b, L.finish().opaque); break; }
    case "soil": b.add(box(0.34, 0.3, 0.34, PAL.soil), mIdent()); break;
    case "sunburst": { const s = sunBall(); mergeLayer(b, s.opaque); break; }
    case "cold_snap": { // white octahedron
      const L = new Batcher();
      L.add(cone(0.2, 0.32, 4, [0.85,0.92,0.97]), mIdent());
      L.add(cone(0.2, 0.32, 4, [0.85,0.92,0.97]), mMul(mTranslate(0, 0.64, 0), mScale(1, -1, 1)));
      mergeLayer(b, L.finish().opaque); break; }
    case "wind_gust": b.add(cone(0.14, 0.5, 5, [0.75, 0.82, 0.80]), mIdent()); break;
    default: b.add(sphere(0.16, 6, PAL.cloud), mIdent());
  }
  return b.finish();
}

// copy a finished layer ({opaque, trans} or a single layer) into a batcher.
// Sub-layers are alpha-uniform in practice, so each is appended whole to one bucket.
function mergeLayer(batcher, finished) {
  const layers = finished.opaque ? [finished.opaque, finished.trans] : [finished];
  for (const layer of layers) {
    if (!layer || layer.pos.length === 0) continue;
    const n = layer.pos.length / 3;
    const a0 = layer.col.length >= 4 ? layer.col[3] : 1;
    const bucket = a0 < 0.999 ? batcher.tr : batcher.op;
    const base = bucket.p.length / 3;
    for (let i = 0; i < n; i++) {
      bucket.p.push(layer.pos[i*3], layer.pos[i*3+1], layer.pos[i*3+2]);
      bucket.n.push(layer.nor[i*3], layer.nor[i*3+1], layer.nor[i*3+2]);
      bucket.c.push(layer.col[i*4], layer.col[i*4+1], layer.col[i*4+2], layer.col[i*4+3]);
      bucket.e.push(layer.emi[i]);
    }
    for (let i = 0; i < layer.idx.length; i++) bucket.idx.push(base + layer.idx[i]);
  }
}

// Tile highlight ring: 4 thin boxes forming an outline, y≈0.16.
function highlightRing(topY) {
  const b = new Batcher();
  const t = 0.09, L = 1.0, y = topY;
  const c = PAL.highlight.concat([0.85]);
  b.add(box(L, 0.03, t, c), mTranslate(0, y, -L/2 + t/2));
  b.add(box(L, 0.03, t, c), mTranslate(0, y, L/2 - t/2));
  b.add(box(t, 0.03, L, c), mTranslate(-L/2 + t/2, y, 0));
  b.add(box(t, 0.03, L, c), mTranslate(L/2 - t/2, y, 0));
  return b.finish();
}

// translate a finished {opaque,trans} layer by (x,y,z); returns a new finished layer
function translateLayer(finished, x, y, z) {
  const out = {};
  for (const k of ["opaque", "trans"]) {
    const L = finished[k];
    const p = new Float32Array(L.pos.length);
    for (let i = 0; i < L.pos.length; i += 3) {
      p[i] = L.pos[i] + x; p[i+1] = L.pos[i+1] + y; p[i+2] = L.pos[i+2] + z;
    }
    out[k] = { pos: p, nor: L.nor, col: L.col, emi: L.emi, idx: L.idx };
  }
  return out;
}

function bboxOf(layer) {
  const p = layer.pos;
  let mnx=1e9, mny=1e9, mnz=1e9, mxx=-1e9, mxy=-1e9, mxz=-1e9;
  for (let i = 0; i < p.length; i += 3) {
    if (p[i] < mnx) mnx = p[i]; if (p[i] > mxx) mxx = p[i];
    if (p[i+1] < mny) mny = p[i+1]; if (p[i+1] > mxy) mxy = p[i+1];
    if (p[i+2] < mnz) mnz = p[i+2]; if (p[i+2] > mxz) mxz = p[i+2];
  }
  return { min: [mnx, mny, mnz], max: [mxx, mxy, mxz] };
}

function validIndices(layer) {
  const nv = layer.pos.length / 3;
  for (let i = 0; i < layer.idx.length; i++) {
    if (layer.idx[i] < 0 || layer.idx[i] >= nv) return false;
  }
  return true;
}

const Models3D = {
  PAL, lerp, mix3,
  mIdent, mTranslate, mScale, mRotY, mMul, compose, xformPoint, xformNormal,
  Batcher, chunk, box, cone, cyl, sphere, disc, streak,
  grassTuft, flower, tree, flame, smokePuff, cloudCluster, sunBall, skyDome,
  tokenFor, mergeLayer, translateLayer, highlightRing, bboxOf, validIndices,
};

if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
  module.exports = Models3D;
} else if (typeof globalThis !== "undefined") {
  globalThis.Models3D = Models3D;
}
