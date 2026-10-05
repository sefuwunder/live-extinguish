/* LIVE/EXTINGUISH — a game as poetry.
 * Simulation core is pure (no DOM) and exported for tests.
 * UI/render/audio only boot when `document` exists. */
"use strict";

/* ---------------- seeded RNG ---------------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function rngFromQuery() {
  let seed = (Date.now() ^ (Math.random() * 1e9)) >>> 0;
  try {
    const q = new URLSearchParams(typeof location !== "undefined" ? location.search : "");
    if (q.has("seed")) seed = parseInt(q.get("seed"), 10) >>> 0;
  } catch (e) { /* non-browser */ }
  return { seed, rand: mulberry32(seed) };
}

/* ---------------- constants ---------------- */
const SIZE = 16;
const TICK_MS = 800;
const SEASON_MS = 5 * 60 * 1000;

const ITEMS = {
  grass_seed:  { icon: "🌱", cat: "seed",  label: "grass seed" },
  flower_seed: { icon: "🌸", cat: "seed",  label: "flower seed" },
  tree_seed:   { icon: "🌳", cat: "seed",  label: "tree seed" },
  oxygen:      { icon: "☁️", cat: "cloud", label: "fresh oxygen", radius: 1 },
  smog:        { icon: "🌫️", cat: "cloud", label: "smog", radius: 1, hazard: true },
  flies:       { icon: "🪰", cat: "cloud", label: "flies", hazard: true },
  fire:        { icon: "🔥", cat: "stuff", label: "fire" },
  water:       { icon: "💧", cat: "stuff", label: "water" },
  soil:        { icon: "🟤", cat: "stuff", label: "soil" },
  sunburst:    { icon: "☀️", cat: "force", label: "sunburst", radius: 1 },
  cold_snap:   { icon: "❄️", cat: "force", label: "cold snap", gridWide: true },
  wind_gust:   { icon: "💨", cat: "force", label: "wind gust", gridWide: true },
};
const ITEM_KEYS = Object.keys(ITEMS);

const PLANTS = {
  grass:  { matureAt: 60,  value: 1, baseRate: 2.6, waterNeed: 20 },
  flower: { matureAt: 80,  value: 3, baseRate: 1.6, waterNeed: 30 },
  tree:   { matureAt: 100, value: 5, baseRate: 0.85, waterNeed: 40 },
};

const ENVS = {
  fishkill: {
    key: "fishkill", name: "fishkill", growthMult: 1.3,
    concreteChance: 0.05, pollMin: 0, pollMax: 10,
    rainChance: 0.005, smogChance: 0.001, heatChance: 0.0025,
  },
  brooklyn: {
    key: "brooklyn", name: "brooklyn", growthMult: 0.7,
    concreteChance: 0.75, pollMin: 20, pollMax: 50,
    rainChance: 0.003, smogChance: 0.007, heatChance: 0.005,
  },
};

/* ---------------- tiles & grids ---------------- */
function createTile(env, rand) {
  const concrete = rand() < env.concreteChance;
  return {
    ground: concrete ? "concrete" : "soil",
    water: concrete ? 5 + rand() * 10 : 30 + rand() * 30,
    pollution: env.pollMin + rand() * (env.pollMax - env.pollMin),
    plant: null,       // { kind, growth }
    fire: 0,           // 0-100 intensity
    ash: 0,            // fertility memory after fire (0-1)
    shade: rand(),     // static organic variation for rendering
  };
}

function createGrid(envKey, rand) {
  const env = ENVS[envKey];
  const tiles = [];
  for (let y = 0; y < SIZE; y++) {
    const row = [];
    for (let x = 0; x < SIZE; x++) row.push(createTile(env, rand));
    tiles.push(row);
  }
  return {
    envKey, env,
    tiles,
    coldUntil: 0,      // timestamp ms — growth paused while Date.now() < coldUntil
    rainUntil: 0,
    extinguished: 0,   // fires put out on this grid
  };
}

function eachTile(grid, fn) {
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) fn(grid.tiles[y][x], x, y);
}
function inBounds(x, y) { return x >= 0 && y >= 0 && x < SIZE && y < SIZE; }
function neighbors(x, y) {
  const out = [];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      if (inBounds(x + dx, y + dy)) out.push([x + dx, y + dy]);
    }
  return out;
}
function radiusTiles(x, y, r) {
  const out = [];
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++)
      if (inBounds(x + dx, y + dy)) out.push([x + dx, y + dy]);
  return out;
}

/* ---------------- simulation tick ---------------- */
function hasMatureFlowerNeighbor(grid, x, y) {
  return neighbors(x, y).some(([nx, ny]) => {
    const p = grid.tiles[ny][nx].plant;
    return p && p.kind === "flower" && p.growth >= PLANTS.flower.matureAt;
  });
}

// Returns events: [{type:'ignite'|'rain'|'smog', x, y}] for sound/UI hooks.
function tickGrid(grid, rand, now) {
  const events = [];
  const cold = now < grid.coldUntil;
  const raining = now < grid.rainUntil;

  // global weather rolls
  if (rand() < grid.env.rainChance && !raining) {
    grid.rainUntil = now + 5000;
    events.push({ type: "rain" });
  }
  if (rand() < grid.env.smogChance) {
    const cx = 3 + Math.floor(rand() * (SIZE - 6));
    const cy = 3 + Math.floor(rand() * (SIZE - 6));
    for (const [x, y] of radiusTiles(cx, cy, 2))
      grid.tiles[y][x].pollution = Math.min(100, grid.tiles[y][x].pollution + 22);
    events.push({ type: "smog", x: cx, y: cy });
  }
  if (rand() < grid.env.heatChance) {
    // random ignition on a dry planted tile
    for (let tries = 0; tries < 6; tries++) {
      const x = Math.floor(rand() * SIZE), y = Math.floor(rand() * SIZE);
      const t = grid.tiles[y][x];
      if (t.fire <= 0 && t.plant && t.water < 18) {
        t.fire = 55;
        events.push({ type: "ignite", x, y });
        break;
      }
    }
  }

  const isRaining = now < grid.rainUntil;
  eachTile(grid, (t, x, y) => {
    // rain: soak + extinguish
    if (isRaining) {
      t.water = Math.min(100, t.water + 9);
      if (t.fire > 0) { t.fire = 0; grid.extinguished++; }
    }
    // fire burns
    if (t.fire > 0) {
      t.fire = Math.max(0, t.fire - 14 - t.water * 0.12);
      if (t.fire > 25 && t.plant) {
        t.plant = null;
        t.ash = Math.min(1, t.ash + 0.5); // ash remembers: fertility after the burn
      }
      if (t.fire <= 0) { t.fire = 0; }
      else {
        // spread to adjacent dry tiles
        for (const [nx, ny] of neighbors(x, y)) {
          const n = grid.tiles[ny][nx];
          if (n.fire <= 0 && n.water < 22 && rand() < 0.16) {
            n.fire = 45;
            events.push({ type: "ignite", x: nx, y: ny });
          }
        }
      }
    }
    // evaporation
    t.water = Math.max(0, t.water - (isRaining ? 0 : 1.6));
    // pollution drifts slowly down
    t.pollution = Math.max(0, t.pollution - 0.25);

    // plant growth
    const p = t.plant;
    if (p && !cold) {
      const spec = PLANTS[p.kind];
      const waterOk = t.water > 30;
      const airOk = t.pollution < 60;
      if (waterOk && airOk && t.fire <= 0) {
        let rate = spec.baseRate * grid.env.growthMult;
        rate *= 1 + t.ash * 0.6;                       // ash-fed soil
        if (hasMatureFlowerNeighbor(grid, x, y)) rate *= 1.15; // pollinators
        if (t.water < spec.waterNeed + 10) rate *= 0.6; // thirsty
        p.growth = Math.min(100, p.growth + rate);
      }
    }
  });

  // grass spreads after the growth pass (uses updated maturity)
  eachTile(grid, (t, x, y) => {
    const p = t.plant;
    if (p && p.kind === "grass" && p.growth >= PLANTS.grass.matureAt && !cold) {
      for (const [nx, ny] of neighbors(x, y)) {
        const n = grid.tiles[ny][nx];
        if (!n.plant && n.ground === "soil" && n.fire <= 0 && rand() < 0.05) {
          n.plant = { kind: "grass", growth: 8 };
        }
      }
    }
  });

  return events;
}

/* ---------------- item application ---------------- */
// Returns { ok: bool, reason?: string }. Mutates grid.
function applyItem(grid, x, y, itemKey, rand, now) {
  if (!inBounds(x, y)) return { ok: false, reason: "out of bounds" };
  const t = grid.tiles[y][x];
  const cold = now < grid.coldUntil;

  switch (itemKey) {
    case "grass_seed":
    case "flower_seed":
    case "tree_seed": {
      const kind = itemKey.replace("_seed", "");
      if (t.ground !== "soil") return { ok: false, reason: "needs soil" };
      if (t.plant) return { ok: false, reason: "occupied" };
      if (t.fire > 0) return { ok: false, reason: "burning" };
      t.plant = { kind, growth: 5 };
      return { ok: true };
    }
    case "water": {
      t.water = Math.min(100, t.water + 45);
      if (t.fire > 0) { t.fire = 0; grid.extinguished++; return { ok: true, extinguished: true }; }
      return { ok: true };
    }
    case "soil": {
      t.ground = "soil"; // concrete → plantable, permanently
      if (t.water < 25) t.water = 25;
      return { ok: true };
    }
    case "fire": {
      if (t.fire > 0) return { ok: false, reason: "already burning" };
      t.fire = 60;
      return { ok: true };
    }
    case "oxygen": {
      for (const [ax, ay] of radiusTiles(x, y, 1))
        grid.tiles[ay][ax].pollution = Math.max(0, grid.tiles[ay][ax].pollution - 55);
      return { ok: true };
    }
    case "smog": {
      for (const [ax, ay] of radiusTiles(x, y, 1))
        grid.tiles[ay][ax].pollution = Math.min(100, grid.tiles[ay][ax].pollution + 40);
      return { ok: true };
    }
    case "flies": {
      // damage flowers/seedlings on the tile; may scatter flower seeds nearby
      const p = t.plant;
      if (p && (p.kind === "flower" || p.growth < 40)) {
        p.growth -= 28;
        if (p.growth <= 0) t.plant = null;
      }
      for (const [nx, ny] of neighbors(x, y)) {
        const n = grid.tiles[ny][nx];
        if (!n.plant && n.ground === "soil" && n.fire <= 0 && rand() < 0.22) {
          n.plant = { kind: "flower", growth: 8 };
        }
      }
      return { ok: true };
    }
    case "sunburst": {
      for (const [ax, ay] of radiusTiles(x, y, 1)) {
        const at = grid.tiles[ay][ax];
        if (at.plant && !cold) at.plant.growth = Math.min(100, at.plant.growth + 12);
        at.water = Math.max(0, at.water - 25);
      }
      return { ok: true };
    }
    case "cold_snap": {
      grid.coldUntil = now + 20000;
      eachTile(grid, (ct) => {
        const p = ct.plant;
        if (p && p.kind === "flower" && p.growth < 50) {
          p.growth -= 15;
          if (p.growth <= 0) ct.plant = null;
        }
      });
      return { ok: true };
    }
    case "wind_gust": {
      eachTile(grid, (ct) => { ct.water = Math.max(0, ct.water - 15); });
      // seeds ride the wind to random tiles
      eachTile(grid, (ct, cx, cy) => {
        const p = ct.plant;
        if (p && (p.kind === "grass" || p.kind === "flower") && p.growth >= PLANTS[p.kind].matureAt && rand() < 0.05) {
          const tx = Math.floor(rand() * SIZE), ty = Math.floor(rand() * SIZE);
          const dest = grid.tiles[ty][tx];
          if (!dest.plant && dest.ground === "soil" && dest.fire <= 0) {
            dest.plant = { kind: p.kind, growth: 8 };
          }
        }
      });
      return { ok: true };
    }
    default:
      return { ok: false, reason: "unknown item" };
  }
}

/* ---------------- scoring ---------------- */
function scoreGrid(grid) {
  let grass = 0, flowers = 0, trees = 0;
  eachTile(grid, (t) => {
    if (!t.plant) return;
    const spec = PLANTS[t.plant.kind];
    const mature = t.plant.growth >= spec.matureAt;
    const v = spec.value * (mature ? 1 : 0.5);
    if (t.plant.kind === "grass") grass += v;
    else if (t.plant.kind === "flower") flowers += v;
    else trees += v;
  });
  const total = grass + flowers + trees;
  return { grass, flowers, trees, total };
}
function countPlants(grid) {
  let n = 0;
  eachTile(grid, (t) => { if (t.plant) n++; });
  return n;
}

/* ---------------- falling items ---------------- */
const TRAY_CAP = 12;
const HAZARD_TTL_MS = 45000;
const FALL_MS = 6000;

function pickFallingItem(rand) {
  const r = rand() * 100;
  if (r < 20) return "grass_seed";
  if (r < 35) return "flower_seed";
  if (r < 45) return "tree_seed";
  if (r < 60) return "water";
  if (r < 70) return "soil";
  if (r < 78) return "oxygen";
  if (r < 83) return "fire";
  if (r < 88) return "smog";
  if (r < 93) return "flies";
  if (r < 96) return "sunburst";
  if (r < 98) return "cold_snap";
  return "wind_gust";
}
function makeTrayItem(itemKey, now) {
  const item = { id: Math.random().toString(36).slice(2, 9), type: itemKey, bornAt: now };
  if (ITEMS[itemKey].hazard) item.expiresAt = now + HAZARD_TTL_MS;
  return item;
}

/* ---------------- haikus (pre-written, no generation) ---------------- */
const OPENING_HAIKU = [
  "first rain on concrete —\neven brooklyn dreams in green",
  "sixteen feet of earth —\nthe sky keeps dropping small gifts",
  "dawn over fishkill —\na seed does not ask permission",
  "two small fields of maybe —\nchoose where the sky should fall",
  "morning, and the wind\ncarries seeds it cannot name —\nplant them anyway",
];
const CLOSING_HAIKU = [
  "the season closes —\n{winner} keeps the warmer soil.\n{total} green, breathing.",
  "five minutes of sky —\n{winner} sang, {loser} hummed along.\n{total} lives took root.",
  "dusk on sixteen feet —\nwhat you tended, tended you.\n{total} green, still growing.",
];
function fillHaiku(tpl, winner, loser, total) {
  return tpl.replace("{winner}", winner).replace("{loser}", loser).replace("{total}", String(total));
}
const SEASON_NAMES = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/* ---------------- audio (WebAudio, tiny, quiet) ---------------- */
const Sound = {
  ctx: null, muted: false, rainTimer: null,
  ensure() {
    if (this.ctx || typeof window === "undefined") return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.07;
      this.master.connect(this.ctx.destination);
    } catch (e) { this.ctx = null; }
  },
  pluck() {
    if (this.muted || !this.ctx) return;
    this.ensure();
    const scale = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25];
    const f = scale[Math.floor(Math.random() * scale.length)];
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = "triangle"; o.frequency.value = f;
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 1.2);
  },
  thud() { // low drum on ignition
    if (this.muted || !this.ctx) return;
    this.ensure();
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = "sine"; o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.35);
    g.gain.setValueAtTime(1.0, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.45);
  },
  fail() {
    if (this.muted || !this.ctx) return;
    this.ensure();
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = "sine"; o.frequency.value = 160;
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.3);
  },
  rainStart() {
    if (this.muted || !this.ctx || this.rainTimer) return;
    this.ensure();
    const patter = () => {
      if (this.muted) return;
      const t = this.ctx.currentTime;
      const len = this.ctx.sampleRate * 0.06;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = this.ctx.createBufferSource(); src.buffer = buf;
      const f = this.ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 4000;
      const g = this.ctx.createGain(); g.gain.value = 0.12;
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start(t);
    };
    this.rainTimer = setInterval(patter, 180);
  },
  rainStop() {
    if (this.rainTimer) { clearInterval(this.rainTimer); this.rainTimer = null; }
  },
};

/* ---------------- rendering ---------------- */
const TILE_PX = 24, GRID_PX = SIZE * TILE_PX; // 384

function shade(hex, amt) {
  // amt -1..1 darken/lighten
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (amt >= 0) { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
  else { r *= 1 + amt; g *= 1 + amt; b *= 1 + amt; }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}
function lerp(a, b, t) { return a + (b - a) * t; }
function mixHex(h1, h2, t) {
  const n1 = parseInt(h1.slice(1), 16), n2 = parseInt(h2.slice(1), 16);
  const r = lerp((n1 >> 16) & 255, (n2 >> 16) & 255, t) | 0;
  const g = lerp((n1 >> 8) & 255, (n2 >> 8) & 255, t) | 0;
  const b = lerp(n1 & 255, n2 & 255, t) | 0;
  return `rgb(${r},${g},${b})`;
}

const FLOWER_COLORS = ["#d96a8b", "#e8b4c8", "#c9704a", "#e3c878", "#b678c9"];

function renderGrid(ctx, grid, now, opts) {
  const cold = now < grid.coldUntil;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const t = grid.tiles[y][x];
      const px = x * TILE_PX, py = y * TILE_PX;
      // ground
      const base = t.ground === "soil" ? "#8a6a48" : "#a3a099";
      ctx.fillStyle = shade(base, (t.shade - 0.5) * 0.25);
      ctx.fillRect(px, py, TILE_PX, TILE_PX);
      // water sheen
      if (t.water > 60) {
        ctx.fillStyle = `rgba(120,160,190,${0.12 + (t.water - 60) / 40 * 0.22})`;
        ctx.fillRect(px, py, TILE_PX, TILE_PX);
      }
      // plant
      const p = t.plant;
      if (p) {
        const g = p.growth / 100, cx = px + TILE_PX / 2, cy = py + TILE_PX / 2;
        if (p.kind === "grass") {
          ctx.fillStyle = mixHex("#9ab86a", "#3f7038", g);
          const h = 4 + g * 14;
          for (let b = 0; b < 3; b++) {
            const bx = px + 6 + b * 6 + (t.shade - 0.5) * 4;
            ctx.fillRect(bx, py + TILE_PX - h, 2.5, h);
          }
        } else if (p.kind === "flower") {
          ctx.fillStyle = "#4f7a3c";
          ctx.fillRect(cx - 1, cy - 2, 2, 10);
          const col = FLOWER_COLORS[(x * 7 + y * 13) % FLOWER_COLORS.length];
          ctx.fillStyle = col;
          const r = 2 + g * 4;
          for (let pet = 0; pet < 5; pet++) {
            const a = pet / 5 * Math.PI * 2 + t.shade;
            ctx.beginPath();
            ctx.arc(cx + Math.cos(a) * r, cy - 4 + Math.sin(a) * r, r * 0.62, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.fillStyle = "#e8c84a";
          ctx.beginPath(); ctx.arc(cx, cy - 4, r * 0.5, 0, Math.PI * 2); ctx.fill();
        } else { // tree
          ctx.fillStyle = "#5d4a36";
          const trunkH = 4 + g * 8;
          ctx.fillRect(cx - 1.5, py + TILE_PX - trunkH, 3, trunkH);
          ctx.fillStyle = mixHex("#7a9a5a", "#33582c", g);
          const cr = 5 + g * 8;
          ctx.beginPath(); ctx.arc(cx, py + TILE_PX - trunkH - cr * 0.5, cr, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = mixHex("#8aa868", "#3f6b34", g);
          ctx.beginPath(); ctx.arc(cx - cr * 0.3, py + TILE_PX - trunkH - cr * 0.7, cr * 0.55, 0, Math.PI * 2); ctx.fill();
        }
      }
      // smog haze
      if (t.pollution > 50) {
        ctx.fillStyle = `rgba(128,128,120,${(t.pollution - 50) / 50 * 0.42})`;
        ctx.fillRect(px, py, TILE_PX, TILE_PX);
      }
      // fire overlay
      if (t.fire > 0) {
        const flick = opts.reducedMotion ? 0.65 : 0.45 + Math.random() * 0.35;
        ctx.fillStyle = `rgba(226,112,58,${flick * Math.min(1, t.fire / 50)})`;
        ctx.fillRect(px, py, TILE_PX, TILE_PX);
        ctx.fillStyle = `rgba(240,180,80,${flick * 0.5})`;
        const fr = 4 + Math.random() * 5;
        ctx.beginPath(); ctx.arc(px + 12, py + 12, fr, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
  if (cold) {
    ctx.fillStyle = "rgba(170,200,220,0.22)";
    ctx.fillRect(0, 0, GRID_PX, GRID_PX);
  }
  // soft tile seams
  ctx.strokeStyle = "rgba(93,74,54,0.10)";
  ctx.lineWidth = 1;
  for (let i = 1; i < SIZE; i++) {
    ctx.beginPath(); ctx.moveTo(i * TILE_PX + 0.5, 0); ctx.lineTo(i * TILE_PX + 0.5, GRID_PX); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * TILE_PX + 0.5); ctx.lineTo(GRID_PX, i * TILE_PX + 0.5); ctx.stroke();
  }
}

function renderSky(ctx, w, h, progress, falling, clouds, now, opts) {
  // day arc: dawn -> midday -> dusk
  const top = progress < 0.5
    ? mixHex("#f2cfa4", "#e8e0cd", progress * 2)
    : mixHex("#e8e0cd", "#dd9a5e", (progress - 0.5) * 2);
  const bot = progress < 0.5
    ? mixHex("#f7e8d2", "#f2ecdd", progress * 2)
    : mixHex("#f2ecdd", "#e8b06a", (progress - 0.5) * 2);
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, top); grad.addColorStop(1, bot);
  ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
  // sun on its arc
  const sx = 20 + progress * (w - 40);
  const sy = h - 8 - Math.sin(progress * Math.PI) * (h - 20);
  ctx.fillStyle = "rgba(230,150,70,0.9)";
  ctx.beginPath(); ctx.arc(sx, sy, 10, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "rgba(240,190,110,0.35)";
  ctx.beginPath(); ctx.arc(sx, sy, 16, 0, Math.PI * 2); ctx.fill();
  // drifting clouds
  ctx.fillStyle = "rgba(255,253,246,0.75)";
  for (const c of clouds) {
    let cx = c.x;
    if (!opts.reducedMotion) cx = (c.x + now / 1000 * c.speed) % (w + 80) - 40;
    ctx.beginPath();
    ctx.ellipse(cx, c.y, 22, 8, 0, 0, Math.PI * 2);
    ctx.ellipse(cx + 14, c.y + 2, 15, 6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // falling items
  ctx.font = "20px serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (const f of falling) {
    const p = opts.reducedMotion ? 1 : Math.min(1, (now - f.startT) / 1800);
    const fy = 8 + p * (h - 18);
    ctx.globalAlpha = p >= 1 ? 0 : 1;
    ctx.fillText(ITEMS[f.itemKey].icon, f.x, fy);
    ctx.globalAlpha = 1;
  }
}

/* ---------------- game state & UI ---------------- */
const IS_BROWSER = typeof document !== "undefined" && typeof window !== "undefined";

const Game = {
  rand: null, seed: 0,
  grids: {},
  trays: [[], []],
  falling: [],          // { itemKey, trayIdx, x, startT }
  clouds: { fishkill: [], brooklyn: [] },
  selected: null,       // { trayIdx, itemId }
  season: 1,
  endsAt: 0,
  running: false,
  reducedMotion: false,
  nextFallTray: 0,
  els: {},
};

function newClouds(rand, w) {
  const cs = [];
  for (let i = 0; i < 3; i++)
    cs.push({ x: rand() * w, y: 10 + rand() * 30, speed: 4 + rand() * 8 });
  return cs;
}

function resetSeason() {
  const { rand } = Game;
  Game.grids.fishkill = createGrid("fishkill", rand);
  Game.grids.brooklyn = createGrid("brooklyn", rand);
  Game.trays = [[], []];
  Game.falling = [];
  Game.selected = null;
  Game.nextFallTray = 0;
  Game.clouds.fishkill = newClouds(rand, 384);
  Game.clouds.brooklyn = newClouds(rand, 384);
  Game.endsAt = Date.now() + SEASON_MS;
  // seed each tray with a couple of gifts so the player isn't waiting
  for (let i = 0; i < 3; i++) {
    landItem(0, makeTrayItem(pickFallingItem(rand), Date.now()));
    landItem(1, makeTrayItem(pickFallingItem(rand), Date.now()));
  }
  if (Game.scene3d) Game.scene3d.syncTerrain(Game.grids, rand, Date.now());
  renderTrays();
}

function landItem(trayIdx, item) {
  const tray = Game.trays[trayIdx];
  if (tray.length >= TRAY_CAP) return false; // impermanence: the full tray lets it fade
  tray.push(item);
  if (item.expiresAt) {
    const id = item.id;
    setTimeout(() => {
      const ti = Game.trays[trayIdx].findIndex((it) => it.id === id);
      if (ti >= 0) {
        Game.trays[trayIdx].splice(ti, 1);
        if (IS_BROWSER) renderTrays();
      }
    }, Math.max(0, item.expiresAt - Date.now()));
  }
  return true;
}

function dropFromSky() {
  if (!Game.running) return;
  const now = Date.now();
  const trayIdx = Game.nextFallTray;
  Game.nextFallTray = 1 - Game.nextFallTray;
  const itemKey = pickFallingItem(Game.rand);
  if (Game.reducedMotion) {
    landItem(trayIdx, makeTrayItem(itemKey, now));
    renderTrays();
    return;
  }
  // 3D token descent target: a random plot + tile (purely presentational)
  const plot = Game.rand() < 0.5 ? "fishkill" : "brooklyn";
  Game.falling.push({
    itemKey, trayIdx, x: 40 + Game.rand() * 300, startT: now,
    plot, tx: Math.floor(Game.rand() * SIZE), ty: Math.floor(Game.rand() * SIZE),
  });
  // land after the fall animation
  setTimeout(() => {
    const fi = Game.falling.findIndex((f) => f.itemKey === itemKey && f.trayIdx === trayIdx);
    if (fi >= 0) Game.falling.splice(fi, 1);
    landItem(trayIdx, makeTrayItem(itemKey, Date.now()));
    renderTrays();
  }, 1850);
}

function renderTrays() {
  if (!IS_BROWSER) return;
  ["A", "B"].forEach((letter, ti) => {
    const box = Game.els["slots" + letter];
    box.innerHTML = "";
    for (let s = 0; s < TRAY_CAP; s++) {
      const d = document.createElement("div");
      d.className = "slot";
      d.setAttribute("role", "option");
      const item = Game.trays[ti][s];
      if (item) {
        d.classList.add("filled");
        if (ITEMS[item.type].hazard) d.classList.add("hazard");
        d.textContent = ITEMS[item.type].icon;
        d.title = ITEMS[item.type].label;
        d.setAttribute("aria-selected", Game.selected && Game.selected.itemId === item.id ? "true" : "false");
        if (Game.selected && Game.selected.itemId === item.id) d.classList.add("selected");
        d.addEventListener("click", () => selectItem(ti, item.id));
      } else {
        d.setAttribute("aria-selected", "false");
      }
      box.appendChild(d);
    }
  });
}

function selectItem(trayIdx, itemId) {
  Sound.ensure();
  if (Game.selected && Game.selected.itemId === itemId) Game.selected = null;
  else Game.selected = { trayIdx, itemId };
  renderTrays();
}

function consumeSelected() {
  if (!Game.selected) return null;
  const { trayIdx, itemId } = Game.selected;
  const tray = Game.trays[trayIdx];
  const i = tray.findIndex((it) => it.id === itemId);
  Game.selected = null;
  if (i < 0) return null;
  return tray.splice(i, 1)[0];
}

function placeAt(envKey, x, y) {
  if (!Game.running || !Game.selected) return;
  if (!inBounds(x, y)) return;
  const item = Game.trays[Game.selected.trayIdx].find((it) => it.id === Game.selected.itemId);
  if (!item) { Game.selected = null; renderTrays(); return; }
  const grid = Game.grids[envKey];
  const res = applyItem(grid, x, y, item.type, Game.rand, Date.now());
  if (res.ok) {
    consumeSelected();
    Sound.pluck();
    if (res.extinguished) Sound.rainStop();
  } else {
    Sound.fail();
    const canvas = Game.els.scene;
    if (canvas) {
      canvas.classList.remove("flash-fail");
      void canvas.offsetWidth;
      canvas.classList.add("flash-fail");
    }
  }
  renderTrays();
  drawGrids(Date.now());
}

// ---- 3D pointer controls: drag = orbit, wheel/pinch = zoom, tap = pick/place ----
function pickFromEvent(ev) {
  const E3 = globalThis.Engine3D;
  if (!E3 || !Game.scene3d) return null;
  const canvas = Game.els.scene;
  const rect = canvas.getBoundingClientRect();
  const cx = ev.clientX - rect.left, cy = ev.clientY - rect.top;
  if (cx < 0 || cy < 0 || cx > rect.width || cy > rect.height) return null;
  return E3.pickTile(cx, cy, rect.width, rect.height, Game.scene3d.camera, 0);
}

function wireScenePointer(canvas) {
  const pointers = new Map();
  let pdown = null;   // {x, y, moved}
  let pinchDist = 0;
  canvas.addEventListener("pointerdown", (e) => {
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) pdown = { x: e.clientX, y: e.clientY, moved: false };
    pinchDist = 0;
  });
  canvas.addEventListener("pointermove", (e) => {
    const prev = pointers.get(e.pointerId);
    if (prev && Game.scene3d) {
      const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        if (pdown && Math.hypot(e.clientX - pdown.x, e.clientY - pdown.y) > 8) pdown.moved = true;
        if (pdown && pdown.moved) Game.scene3d.camera.orbit(dx, dy);
      } else if (pointers.size === 2) {
        const pts = [...pointers.values()];
        const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (pinchDist > 0 && d > 0) Game.scene3d.camera.zoom(pinchDist / d);
        pinchDist = d;
        if (pdown) pdown.moved = true;
      }
    } else if (!prev && e.pointerType === "mouse" && Game.scene3d) {
      // hover highlight (mouse only)
      Game.scene3d.hoverTile = pickFromEvent(e);
    }
  });
  const up = (e) => {
    const wasTap = pointers.size === 1 && pdown && !pdown.moved;
    pointers.delete(e.pointerId);
    if (pointers.size === 0) {
      if (wasTap) {
        const hit = pickFromEvent(e);
        if (hit) placeAt(hit.plot, hit.x, hit.y);
      }
      pdown = null;
      pinchDist = 0;
    }
  };
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size === 0) { pdown = null; pinchDist = 0; }
  });
  canvas.addEventListener("pointerleave", () => {
    if (Game.scene3d) Game.scene3d.hoverTile = null;
  });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (Game.scene3d) Game.scene3d.camera.zoom(1 + Math.sign(e.deltaY) * 0.09);
  }, { passive: false });
}

function fmtClock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function updateScores() {
  if (!IS_BROWSER) return;
  let totalExt = 0;
  for (const key of ["fishkill", "brooklyn"]) {
    const grid = Game.grids[key];
    const s = scoreGrid(grid);
    totalExt += grid.extinguished;
    const el = Game.els["score" + key];
    el.innerHTML = `${Math.round(s.total)} live <span class="detail">🌱${Math.round(s.grass)} 🌸${Math.round(s.flowers)} 🌳${Math.round(s.trees)}</span>`;
  }
  Game.els.extinguish.textContent = String(totalExt);
}

function seasonProgress(now) {
  return Math.min(1, Math.max(0, 1 - (Game.endsAt - now) / SEASON_MS));
}

function endSeason() {
  Game.running = false;
  Sound.rainStop();
  const sf = scoreGrid(Game.grids.fishkill), sb = scoreGrid(Game.grids.brooklyn);
  const total = Math.round(sf.total + sb.total);
  const winner = sf.total >= sb.total ? "fishkill" : "brooklyn";
  const loser = winner === "fishkill" ? "brooklyn" : "fishkill";
  const tpl = CLOSING_HAIKU[Math.floor(Game.rand() * CLOSING_HAIKU.length)];
  // archive best
  try {
    const prev = JSON.parse(localStorage.getItem("live-extinguish-best") || "null");
    if (!prev || total > prev.total)
      localStorage.setItem("live-extinguish-best", JSON.stringify({ total, fishkill: Math.round(sf.total), brooklyn: Math.round(sb.total), season: Game.season }));
  } catch (e) { /* storage unavailable */ }
  const best = (() => { try { return JSON.parse(localStorage.getItem("live-extinguish-best") || "null"); } catch (e) { return null; } })();
  showHaiku(
    fillHaiku(tpl, winner, loser, total),
    `fishkill ${Math.round(sf.total)} · brooklyn ${Math.round(sb.total)}` +
    (best ? ` · best ${best.total}` : ""),
    "again"
  );
}

function showHaiku(text, resultLine, btnLabel) {
  Game.els.haikuText.innerHTML = "";
  Game.els.haikuText.appendChild(document.createTextNode(text));
  if (resultLine) {
    const sp = document.createElement("span");
    sp.className = "result";
    sp.textContent = resultLine;
    Game.els.haikuText.appendChild(sp);
  }
  Game.els.haikuBtn.textContent = btnLabel;
  Game.els.haiku.hidden = false;
}

function initSceneWithRetry(attemptsLeft) {
  if (Game.scene3d) return;
  const E3 = globalThis.Engine3D, M3 = globalThis.Models3D;
  let renderer = null;
  if (E3 && M3 && Game.els.scene) {
    try { renderer = E3.createRenderer(Game.els.scene); } catch (err) { renderer = null; }
  }
  if (renderer) {
    Game.scene3d = new E3.Scene3D(renderer, M3);
    Game.scene3d.resize();
    if (Game.grids.fishkill) Game.scene3d.syncTerrain(Game.grids, Game.rand, Date.now());
    wireScenePointer(Game.els.scene);
    window.addEventListener("resize", () => { if (Game.scene3d) Game.scene3d.resize(); });
    Game.els.scene.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      Game.scene3d = null;
      showGlFallback("the sky has gone dark — the dream needs its light back.");
    });
    return;
  }
  if (attemptsLeft > 0) {
    setTimeout(() => initSceneWithRetry(attemptsLeft - 1), 1500);
  } else {
    showGlFallback("the sky could not wake — this dream needs WebGL to grow.");
  }
}

function showGlFallback(msg) {
  if (!Game.els.glFallback) return;
  const p = Game.els.glFallback.querySelector("p");
  if (p) p.textContent = msg;
  Game.els.glFallback.hidden = false;
}

function hideHaiku() { Game.els.haiku.hidden = true; }

function beginSeason() {
  hideHaiku();
  Game.season = (Game.season || 0) + 1;
  resetSeason();
  Game.running = true;
  Game.els.seasonLabel.textContent = "season " + (SEASON_NAMES[Game.season - 1] || Game.season);
  Sound.ensure();
}

/* per-tick + render loops */
function gameTick() {
  if (!Game.running) return;
  const now = Date.now();
  if (now >= Game.endsAt) { endSeason(); return; }
  for (const key of ["fishkill", "brooklyn"]) {
    const grid = Game.grids[key];
    const evs = tickGrid(grid, Game.rand, now);
    for (const e of evs) {
      if (e.type === "ignite") Sound.thud();
      if (e.type === "rain") Sound.rainStart();
    }
    if (now >= grid.rainUntil) Sound.rainStop();
  }
  // hazard expiry sweep (safety net beside per-item timeouts)
  for (let ti = 0; ti < 2; ti++)
    Game.trays[ti] = Game.trays[ti].filter((it) => !it.expiresAt || it.expiresAt > now);
  updateScores();
  if (Game.scene3d) {
    Game.scene3d.syncPlants(Game.grids, Game.rand, now);
    Game.scene3d.refreshTerrainColors(Game.grids, now);
  }
  drawGrids(now);
}

function drawGrids(now) {
  if (!Game.scene3d) return;
  Game.scene3d.resize();
  Game.scene3d.renderFrame({
    grids: Game.grids,
    falling: Game.falling,
    now,
    reducedMotion: Game.reducedMotion,
    seasonProgress: seasonProgress(now),
    rand: Game.rand,
  });
}

function frame(nowMs) {
  if (Game.running) {
    const now = Date.now();
    Game.els.clock.textContent = fmtClock(Game.endsAt - now);
    drawGrids(now);
  }
  requestAnimationFrame(frame);
}

function boot() {
  const { seed, rand } = rngFromQuery();
  Game.rand = rand; Game.seed = seed;
  Game.reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (id) => document.getElementById(id);
  Game.els = {
    slotsA: $("slotsA"), slotsB: $("slotsB"),
    scene: $("scene"), glFallback: $("glFallback"),
    scorefishkill: $("score-fishkill"), scorebrooklyn: $("score-brooklyn"),
    extinguish: $("extinguishCount"), clock: $("clock"),
    seasonLabel: $("seasonLabel"), haiku: $("haiku"),
    haikuText: $("haikuText"), haikuBtn: $("haikuBtn"),
    muteBtn: $("muteBtn"), motionBtn: $("motionBtn"),
  };
  // 3D scene (graceful fallback when WebGL is unavailable; retry a few times
  // because software GL can still be initializing on the first attempt)
  initSceneWithRetry(3);
  Game.els.haikuBtn.addEventListener("click", beginSeason);
  Game.els.muteBtn.addEventListener("click", () => {
    Sound.muted = !Sound.muted;
    Game.els.muteBtn.setAttribute("aria-pressed", String(Sound.muted));
    Game.els.muteBtn.textContent = Sound.muted ? "🔕" : "🔔";
    if (Sound.muted) Sound.rainStop();
  });
  Game.els.motionBtn.addEventListener("click", () => {
    Game.reducedMotion = !Game.reducedMotion;
    Game.els.motionBtn.setAttribute("aria-pressed", String(Game.reducedMotion));
  });
  Game.els.motionBtn.setAttribute("aria-pressed", String(Game.reducedMotion));
  Game.season = 0;
  resetSeason();
  updateScores();
  drawGrids(Date.now());
  showHaiku(OPENING_HAIKU[Math.floor(rand() * OPENING_HAIKU.length)], null, "begin");
  setInterval(gameTick, TICK_MS);
  setInterval(dropFromSky, FALL_MS);
  requestAnimationFrame(frame);
  // debug/testing hook (UI layer only)
  globalThis.__leGame = Game;
}

if (IS_BROWSER) boot();

/* test exports (CJS interop for bun test) */
if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
  module.exports = {
    mulberry32, rngFromQuery, ITEMS, ITEM_KEYS, PLANTS, ENVS, SIZE, TICK_MS, SEASON_MS,
    createTile, createGrid, eachTile, inBounds, neighbors, radiusTiles,
    tickGrid, applyItem, scoreGrid, countPlants,
    pickFallingItem, makeTrayItem, TRAY_CAP, HAZARD_TTL_MS,
    OPENING_HAIKU, CLOSING_HAIKU, fillHaiku, Sound, Game, landItem, resetSeason,
    renderGrid, renderSky, TILE_PX, GRID_PX, selectItem, placeAt,
    // renderGrid/renderSky: legacy 2D renderer, kept for tests; the game uses WebGL.
  };
}
