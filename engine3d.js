/* LIVE/EXTINGUISH — engine3d.js
 * Native WebGL1 engine: shaders, camera, picking math, scene orchestration.
 * Zero dependencies. Pure math (matrices, picking, layout) is DOM/GL-free
 * and exported for tests; GL calls live in createRenderer + Scene3D.
 */
"use strict";

/* ---------------- plot layout (world units; tile = 1) ---------------- */
const TILE = 1, SIZE16 = 16;
const PLOT = {
  fishkill: { x0: -18, z0: -8 },
  brooklyn: { x0: 2, z0: -8 },
  w: 16, d: 16,
};
function tileToWorld(plotKey, x, y) {
  const p = PLOT[plotKey];
  if (!p) return null;
  return { x: p.x0 + x + 0.5, z: p.z0 + y + 0.5 };
}
// Returns {plot:'fishkill'|'brooklyn', x, y} or null (gap / outside).
function worldToTile(wx, wz) {
  const y = Math.floor(wz - PLOT.fishkill.z0);
  if (y < 0 || y >= SIZE16) return null;
  for (const key of ["fishkill", "brooklyn"]) {
    const p = PLOT[key];
    if (wx >= p.x0 && wx < p.x0 + PLOT.w) {
      return { plot: key, x: Math.floor(wx - p.x0), y };
    }
  }
  return null;
}

/* ---------------- mat4 (column-major, WebGL style) ---------------- */
function mIdent4() { return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]; }
function mMul4(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c*4+r] = a[r]*b[c*4] + a[4+r]*b[c*4+1] + a[8+r]*b[c*4+2] + a[12+r]*b[c*4+3];
  }
  return o;
}
function mPerspective(fovyDeg, aspect, near, far) {
  const f = 1 / Math.tan((fovyDeg * Math.PI) / 360);
  const nf = 1 / (near - far);
  return [f/aspect,0,0,0, 0,f,0,0, 0,0,(far+near)*nf,-1, 0,0,2*far*near*nf,0];
}
function mLookAt(eye, target, up) {
  const zx = eye[0]-target[0], zy = eye[1]-target[1], zz = eye[2]-target[2];
  let l = Math.hypot(zx, zy, zz) || 1;
  const z = [zx/l, zy/l, zz/l];
  let xx = up[1]*z[2]-up[2]*z[1], xy = up[2]*z[0]-up[0]*z[2], xz = up[0]*z[1]-up[1]*z[0];
  l = Math.hypot(xx, xy, xz) || 1; xx/=l; xy/=l; xz/=l;
  const yx = z[1]*xz-z[2]*xy, yy = z[2]*xx-z[0]*xz, yz = z[0]*xy-z[1]*xx;
  return [
    xx, yx, z[0], 0,
    xy, yy, z[1], 0,
    xz, yz, z[2], 0,
    -(xx*eye[0]+xy*eye[1]+xz*eye[2]),
    -(yx*eye[0]+yy*eye[1]+yz*eye[2]),
    -(z[0]*eye[0]+z[1]*eye[1]+z[2]*eye[2]),
    1,
  ];
}
// General 4x4 inverse (Cramer's rule adjugate).
function mInverse(m) {
  const inv = new Array(16);
  inv[0] = m[5]*m[10]*m[15] - m[5]*m[11]*m[14] - m[9]*m[6]*m[15] + m[9]*m[7]*m[14] + m[13]*m[6]*m[11] - m[13]*m[7]*m[10];
  inv[4] = -m[4]*m[10]*m[15] + m[4]*m[11]*m[14] + m[8]*m[6]*m[15] - m[8]*m[7]*m[14] - m[12]*m[6]*m[11] + m[12]*m[7]*m[10];
  inv[8] = m[4]*m[9]*m[15] - m[4]*m[11]*m[13] - m[8]*m[5]*m[15] + m[8]*m[7]*m[13] + m[12]*m[5]*m[11] - m[12]*m[7]*m[9];
  inv[12] = -m[4]*m[9]*m[14] + m[4]*m[10]*m[13] + m[8]*m[5]*m[14] - m[8]*m[6]*m[13] - m[12]*m[5]*m[10] + m[12]*m[6]*m[9];
  inv[1] = -m[1]*m[10]*m[15] + m[1]*m[11]*m[14] + m[9]*m[2]*m[15] - m[9]*m[3]*m[14] - m[13]*m[2]*m[11] + m[13]*m[3]*m[10];
  inv[5] = m[0]*m[10]*m[15] - m[0]*m[11]*m[14] - m[8]*m[2]*m[15] + m[8]*m[3]*m[14] + m[12]*m[2]*m[11] - m[12]*m[3]*m[10];
  inv[9] = -m[0]*m[9]*m[15] + m[0]*m[11]*m[13] + m[8]*m[1]*m[15] - m[8]*m[3]*m[13] - m[12]*m[1]*m[11] + m[12]*m[3]*m[9];
  inv[13] = m[0]*m[9]*m[14] - m[0]*m[10]*m[13] - m[8]*m[1]*m[14] + m[8]*m[2]*m[13] + m[12]*m[1]*m[10] - m[12]*m[2]*m[9];
  inv[2] = m[1]*m[6]*m[15] - m[1]*m[7]*m[14] - m[5]*m[2]*m[15] + m[5]*m[3]*m[14] + m[13]*m[2]*m[7] - m[13]*m[3]*m[6];
  inv[6] = -m[0]*m[6]*m[15] + m[0]*m[7]*m[14] + m[4]*m[2]*m[15] - m[4]*m[3]*m[14] - m[12]*m[2]*m[7] + m[12]*m[3]*m[6];
  inv[10] = m[0]*m[5]*m[15] - m[0]*m[7]*m[13] - m[4]*m[1]*m[15] + m[4]*m[3]*m[13] + m[12]*m[1]*m[7] - m[12]*m[3]*m[5];
  inv[14] = -m[0]*m[5]*m[14] + m[0]*m[6]*m[13] + m[4]*m[1]*m[14] - m[4]*m[2]*m[13] - m[12]*m[1]*m[6] + m[12]*m[2]*m[5];
  inv[3] = -m[1]*m[6]*m[11] + m[1]*m[7]*m[10] + m[5]*m[2]*m[11] - m[5]*m[3]*m[10] - m[9]*m[2]*m[7] + m[9]*m[3]*m[6];
  inv[7] = m[0]*m[6]*m[11] - m[0]*m[7]*m[10] - m[4]*m[2]*m[11] + m[4]*m[3]*m[10] + m[8]*m[2]*m[7] - m[8]*m[3]*m[6];
  inv[11] = -m[0]*m[5]*m[11] + m[0]*m[7]*m[9] + m[4]*m[1]*m[11] - m[4]*m[3]*m[9] - m[8]*m[1]*m[7] + m[8]*m[3]*m[5];
  inv[15] = m[0]*m[5]*m[10] - m[0]*m[6]*m[9] - m[4]*m[1]*m[10] + m[4]*m[2]*m[9] + m[8]*m[1]*m[6] - m[8]*m[2]*m[5];
  let det = m[0]*inv[0] + m[1]*inv[4] + m[2]*inv[8] + m[3]*inv[12];
  if (Math.abs(det) < 1e-12) return null;
  det = 1 / det;
  for (let i = 0; i < 16; i++) inv[i] *= det;
  return inv;
}
function xform4(m, x, y, z, w) {
  return [
    m[0]*x + m[4]*y + m[8]*z + m[12]*w,
    m[1]*x + m[5]*y + m[9]*z + m[13]*w,
    m[2]*x + m[6]*y + m[10]*z + m[14]*w,
    m[3]*x + m[7]*y + m[11]*z + m[15]*w,
  ];
}

/* ---------------- camera ---------------- */
const CAM = {
  minElev: 15 * Math.PI / 180, maxElev: 80 * Math.PI / 180,
  minR: 20, maxR: 70,
};
function Camera() {
  this.target = [0, 0.5, 0];
  this.azimuth = 0;                 // radians, 0 = looking from +Z
  this.elevation = 42 * Math.PI / 180;
  this.radius = 36;
  this.swayPhase = Math.random() * Math.PI * 2;
}
Camera.prototype.eye = function (swayAmt) {
  const az = this.azimuth + (swayAmt || 0);
  const ce = Math.cos(this.elevation), se = Math.sin(this.elevation);
  return [
    this.target[0] + Math.sin(az) * ce * this.radius,
    this.target[1] + se * this.radius,
    this.target[2] + Math.cos(az) * ce * this.radius,
  ];
};
Camera.prototype.viewMatrix = function (swayAmt) {
  return mLookAt(this.eye(swayAmt), this.target, [0, 1, 0]);
};
Camera.prototype.orbit = function (dxPx, dyPx) {
  this.azimuth -= dxPx * 0.005;
  this.elevation = Math.min(CAM.maxElev, Math.max(CAM.minElev, this.elevation - dyPx * 0.004));
};
Camera.prototype.zoom = function (factor) {
  this.radius = Math.min(CAM.maxR, Math.max(CAM.minR, this.radius * factor));
};

/* ---------------- picking ---------------- */
// ndcX/ndcY in [-1,1]. Returns {origin:[x,y,z], dir:[x,y,z]} in world space.
function screenRay(ndcX, ndcY, viewMat, projMat) {
  const vp = mMul4(projMat, viewMat);
  const inv = mInverse(vp);
  if (!inv) return null;
  const near = xform4(inv, ndcX, ndcY, -1, 1);
  const far = xform4(inv, ndcX, ndcY, 1, 1);
  const n = [near[0]/near[3], near[1]/near[3], near[2]/near[3]];
  const f = [far[0]/far[3], far[1]/far[3], far[2]/far[3]];
  const d = [f[0]-n[0], f[1]-n[1], f[2]-n[2]];
  const l = Math.hypot(d[0], d[1], d[2]) || 1;
  return { origin: n, dir: [d[0]/l, d[1]/l, d[2]/l] };
}
// Intersect ray with the y=planeY plane. Returns [x,y,z] or null.
function rayPlaneY(origin, dir, planeY) {
  if (Math.abs(dir[1]) < 1e-9) return null;
  const t = (planeY - origin[1]) / dir[1];
  if (t < 0) return null;
  return [origin[0] + dir[0]*t, planeY, origin[2] + dir[2]*t];
}
// Full pick: client px → {plot, x, y} | null.
function pickTile(clientX, clientY, canvasW, canvasH, camera, swayAmt) {
  const ndcX = (clientX / canvasW) * 2 - 1;
  const ndcY = 1 - (clientY / canvasH) * 2;
  const view = camera.viewMatrix(swayAmt);
  const proj = mPerspective(45, canvasW / canvasH, 0.1, 220);
  const ray = screenRay(ndcX, ndcY, view, proj);
  if (!ray) return null;
  const pt = rayPlaneY(ray.origin, ray.dir, 0);
  if (!pt) return null;
  return worldToTile(pt[0], pt[2]);
}

/* ---------------- shaders ---------------- */
const VS_SRC = `
attribute vec3 aPos;
attribute vec3 aNor;
attribute vec4 aCol;
attribute float aEmi;
uniform mat4 uMVP;
uniform vec3 uLightDir;
uniform vec3 uAmbient;
varying vec4 vCol;
varying float vFog;
uniform vec2 uFogRange;
void main() {
  vec4 clip = uMVP * vec4(aPos, 1.0);
  gl_Position = clip;
  float diff = max(dot(normalize(aNor), normalize(uLightDir)), 0.0);
  vec3 lit = aCol.rgb * (uAmbient + diff * (vec3(1.0, 0.97, 0.92) - uAmbient));
  vec3 c = mix(lit, aCol.rgb, aEmi);
  vCol = vec4(c, aCol.a);
  float dist = clip.w;
  float f = smoothstep(uFogRange.x, uFogRange.y, dist) * (1.0 - aEmi);
  vFog = f;
}`;
const FS_SRC = `
precision mediump float;
varying vec4 vCol;
varying float vFog;
uniform vec3 uFogColor;
void main() {
  vec3 c = mix(vCol.rgb, uFogColor, vFog);
  gl_FragColor = vec4(c, vCol.a);
}`;

function compileShader(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error("shader compile failed: " + log);
  }
  return s;
}
function createProgram(gl) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, VS_SRC);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, FS_SRC);
  const pr = gl.createProgram();
  gl.attachShader(pr, vs);
  gl.attachShader(pr, fs);
  gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) {
    throw new Error("program link failed: " + gl.getProgramInfoLog(pr));
  }
  return pr;
}

/* ---------------- renderer (GL calls only) ---------------- */
function createRenderer(canvas) {
  let gl = null;
  try {
    gl = canvas.getContext("webgl", { antialias: true, alpha: false }) ||
         canvas.getContext("experimental-webgl", { antialias: true, alpha: false });
  } catch (e) { gl = null; }
  if (!gl) return null;
  let program;
  try { program = createProgram(gl); }
  catch (e) { return null; }
  gl.useProgram(program);
  const A = {
    pos: gl.getAttribLocation(program, "aPos"),
    nor: gl.getAttribLocation(program, "aNor"),
    col: gl.getAttribLocation(program, "aCol"),
    emi: gl.getAttribLocation(program, "aEmi"),
  };
  const U = {
    mvp: gl.getUniformLocation(program, "uMVP"),
    lightDir: gl.getUniformLocation(program, "uLightDir"),
    ambient: gl.getUniformLocation(program, "uAmbient"),
    fogColor: gl.getUniformLocation(program, "uFogColor"),
    fogRange: gl.getUniformLocation(program, "uFogRange"),
  };
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.disable(gl.CULL_FACE);
  gl.clearColor(0.957, 0.937, 0.894, 1.0); // warm paper
  // Uint32 indices when available (dense tree cover can exceed 65k verts)
  const uintExt = gl.getExtension("OES_element_index_uint");
  const IDX_ARR = uintExt ? Uint32Array : Uint16Array;
  const IDX_TYPE = uintExt ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;

  function makeLayer() {
    const bufs = {};
    for (const k of ["pos", "nor", "col", "emi", "idx"]) bufs[k] = gl.createBuffer();
    return { bufs, opaqueCount: 0, transCount: 0 };
  }
  function concatF32(a, b) {
    const o = new Float32Array(a.length + b.length);
    o.set(a, 0); o.set(b, a.length);
    return o;
  }
  // Upload a {opaque, trans} geometry into one layer: attributes concatenated,
  // trans indices appended after opaque with a vertex offset. Draw uses
  // drawElements offsets to separate the two passes.
  function upload(layer, geo) {
    const op = geo.opaque, tr = geo.trans;
    const vOff = op.pos.length / 3;
    const B = layer.bufs;
    gl.bindBuffer(gl.ARRAY_BUFFER, B.pos); gl.bufferData(gl.ARRAY_BUFFER, concatF32(op.pos, tr.pos), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, B.nor); gl.bufferData(gl.ARRAY_BUFFER, concatF32(op.nor, tr.nor), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, B.col); gl.bufferData(gl.ARRAY_BUFFER, concatF32(op.col, tr.col), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, B.emi); gl.bufferData(gl.ARRAY_BUFFER, concatF32(op.emi, tr.emi), gl.STATIC_DRAW);
    const idx = new IDX_ARR(op.idx.length + tr.idx.length);
    idx.set(op.idx, 0);
    for (let i = 0; i < tr.idx.length; i++) idx[op.idx.length + i] = tr.idx[i] + vOff;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, B.idx); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    layer.opaqueCount = op.idx.length;
    layer.transCount = tr.idx.length;
  }
  // Update only the color attribute (for per-tick terrain recoloring).
  function updateColors(layer, colorArray) {
    gl.bindBuffer(gl.ARRAY_BUFFER, layer.bufs.col);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, colorArray);
  }
  function bindAttribs(layer) {
    const B = layer.bufs;
    gl.bindBuffer(gl.ARRAY_BUFFER, B.pos);
    gl.enableVertexAttribArray(A.pos); gl.vertexAttribPointer(A.pos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, B.nor);
    gl.enableVertexAttribArray(A.nor); gl.vertexAttribPointer(A.nor, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, B.col);
    gl.enableVertexAttribArray(A.col); gl.vertexAttribPointer(A.col, 4, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, B.emi);
    gl.enableVertexAttribArray(A.emi); gl.vertexAttribPointer(A.emi, 1, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, B.idx);
  }
  function draw(layer, mvp, lightDir, ambient, fogColor, fogRange) {
    gl.uniformMatrix4fv(U.mvp, false, new Float32Array(mvp));
    gl.uniform3fv(U.lightDir, new Float32Array(lightDir));
    gl.uniform3fv(U.ambient, new Float32Array(ambient));
    gl.uniform3fv(U.fogColor, new Float32Array(fogColor));
    gl.uniform2fv(U.fogRange, new Float32Array(fogRange));
    bindAttribs(layer);
    if (layer.opaqueCount > 0) {
      gl.disable(gl.BLEND);
      gl.depthMask(true);
      gl.drawElements(gl.TRIANGLES, layer.opaqueCount, IDX_TYPE, 0);
    }
    if (layer.transCount > 0) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.drawElements(gl.TRIANGLES, layer.transCount, IDX_TYPE, layer.opaqueCount * (uintExt ? 4 : 2));
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  // NOTE: opaque and trans index ranges share one ELEMENT_ARRAY_BUFFER per layer,
  // with trans indices appended after opaque (see upload).
  return {
    gl, canvas, makeLayer, upload, updateColors, draw,
    resize(w, h) { gl.viewport(0, 0, w, h); },
    clear() { gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); },
  };
}

/* ---------------- scene ---------------- */
// Orchestrates Models3D builders over game state. No GL here except via renderer.
function Scene3D(renderer, Models) {
  this.r = renderer;
  this.M = Models;
  this.camera = new Camera();
  this.terrainLayer = renderer.makeLayer();
  this.gapLayer = renderer.makeLayer();
  this.plantLayer = renderer.makeLayer();
  this.fxLayer = renderer.makeLayer();
  // terrain static data (positions/normals/indices) + per-vertex meta for colors
  this.terrain = null; // {geo, meta, heights, idxOf}
  this.clouds = [];
  this.hoverTile = null;   // {plot,x,y}
  this.time = 0;
}

Scene3D.prototype.plotKeys = ["fishkill", "brooklyn"];

// Build static terrain geometry for a season. rand: seeded rng for jitter.
Scene3D.prototype.buildTerrain = function (grids, rand) {
  const M = this.M;
  const b = new M.Batcher();
  const meta = [];   // per tile: {ground, shade, topY}
  const heights = [];
  const idxOf = [];
  for (const key of this.plotKeys) {
    const grid = grids[key];
    for (let y = 0; y < SIZE16; y++) for (let x = 0; x < SIZE16; x++) {
      const t = grid.tiles[y][x];
      const w = tileToWorld(key, x, y);
      const concrete = t.ground === "concrete";
      const topY = concrete ? 0.10 + (rand() - 0.5) * 0.05 : (rand() - 0.5) * 0.12;
      // box from -0.6 to topY, centered at tile center
      const m = M.compose(w.x, -0.6, w.z, 1, 1, 1, 0);
      // scale box height: box() is 0..h; build unit then scale y
      const hgt = topY + 0.6;
      const m2 = M.mMul(m, M.mScale(1, hgt, 1));
      b.add(M.box(0.98, 1, 0.98, [1, 1, 1]), m2);
      meta.push({ ground: t.ground, shade: t.shade, concrete });
      heights.push(topY);
      idxOf.push({ key, x, y });
    }
  }
  // wild-grass gap strip between the plots + soft ground plane (static own layer)
  const gb = new M.Batcher();
  gb.add(M.box(3.6, 0.14, 16.6, M.PAL.wildGrass), M.mTranslate(0, -0.66, 0));
  gb.add(M.box(90, 0.1, 60, M.PAL.ground), M.mTranslate(0, -0.78, 0));
  for (let i = 0; i < 46; i++) {
    const gx = -1.6 + rand() * 3.2, gz = -8 + rand() * 16;
    M.mergeLayer(gb, M.translateLayer(M.grassTuft(rand, 55 + rand() * 45), gx, -0.52, gz));
  }
  const fin = b.finish();
  this.terrain = { geo: fin, gapGeo: gb.finish(), meta, heights, idxOf };
  return this.terrain;
};

// Terrain colors per tick (moisture darkening, ash). Returns Float32Array rgba.
Scene3D.prototype.terrainColors = function (grids, cold) {
  const M = this.M;
  const t = this.terrain;
  const nvTile = 24; // box() emits 24 verts
  const col = new Float32Array(t.meta.length * nvTile * 4);
  for (let i = 0; i < t.meta.length; i++) {
    const { key, x, y } = t.idxOf[i];
    const tile = grids[key].tiles[y][x];
    const m = t.meta[i];
    let c;
    if (tile.ash > 0.05) {
      c = M.mix3(M.PAL.ash, M.PAL.soil, Math.max(0, 1 - tile.ash * 1.4));
    } else if (m.ground === "concrete" && tile.ground === "concrete") {
      c = M.mix3(M.PAL.concrete, M.PAL.concreteDeep, m.shade * 0.7);
    } else if (tile.ground === "concrete") {
      c = M.mix3(M.PAL.concrete, M.PAL.concreteDeep, m.shade * 0.7);
    } else {
      // soil: darken with moisture, vary with static shade
      const moist = Math.min(1, tile.water / 100);
      c = M.mix3(M.PAL.soil, M.PAL.soilDeep, moist * 0.55 + m.shade * 0.25);
    }
    if (cold) c = M.mix3(c, M.PAL.cold, 0.25);
    for (let v = 0; v < nvTile; v++) {
      const o = (i * nvTile + v) * 4;
      col[o] = c[0]; col[o+1] = c[1]; col[o+2] = c[2]; col[o+3] = 1;
    }
  }
  return col;
};

// Plants + water sheen + smog + shadows → one layer (rebuilt per sim tick).
Scene3D.prototype.buildPlants = function (grids, rand, now) {
  const M = this.M;
  const b = new M.Batcher();
  for (const key of this.plotKeys) {
    const grid = grids[key];
    const cold = now < grid.coldUntil;
    for (let y = 0; y < SIZE16; y++) for (let x = 0; x < SIZE16; x++) {
      const tile = grid.tiles[y][x];
      const w = tileToWorld(key, x, y);
      const ti = (key === "fishkill" ? 0 : SIZE16 * SIZE16) + y * SIZE16 + x;
      const topY = this.terrain ? this.terrain.heights[ti] : 0;
      const p = tile.plant;
      if (p) {
        const g = p.growth;
        let m = M.mTranslate(w.x, topY, w.z);
        if (p.kind === "grass") {
          const L = M.grassTuft(rand, g);
          this._mergeAt(b, L, m, cold);
        } else if (p.kind === "flower") {
          const colorIdx = (x * 7 + y * 13) % M.PAL.petals.length;
          const L = M.flower(rand, g, colorIdx);
          this._mergeAt(b, L, m, cold);
        } else {
          const L = M.tree(rand, g);
          this._mergeAt(b, L, m, cold);
          if (g > 40) {
            // blob shadow
            b.add(M.disc(0.55 + g / 100 * 0.5, 10, M.PAL.shadow.concat([0.26])), M.mTranslate(w.x, topY + 0.015, w.z));
          }
        }
      }
      if (tile.water > 60 && tile.ground === "soil") {
        b.add(M.disc(0.46, 10, M.PAL.water.concat([0.42])), M.mTranslate(w.x, topY + 0.02, w.z));
      }
      if (tile.pollution > 50) {
        const h = 0.25 + (tile.pollution - 50) / 50 * 0.45;
        b.add(M.box(0.95, h, 0.95, M.PAL.smog.concat([0.28])), M.mTranslate(w.x, topY, w.z));
      }
    }
  }
  return b.finish();
};

Scene3D.prototype._mergeAt = function (batcher, finished, matrix, cold) {
  // merge a finished layer, applying matrix + optional cold desaturation tint
  const M = this.M;
  const layers = [finished.opaque, finished.trans];
  for (const layer of layers) {
    if (!layer || layer.pos.length === 0) continue;
    const n = layer.pos.length / 3;
    const pts = [], nrs = [];
    for (let i = 0; i < n; i++) {
      const pt = M.xformPoint(matrix, layer.pos[i*3], layer.pos[i*3+1], layer.pos[i*3+2]);
      const nr = M.xformNormal(matrix, layer.nor[i*3], layer.nor[i*3+1], layer.nor[i*3+2]);
      pts.push(pt[0], pt[1], pt[2]); nrs.push(nr[0], nr[1], nr[2]);
    }
    let cols = Array.from(layer.col);
    if (cold) {
      for (let i = 0; i < n; i++) {
        const c = M.mix3([cols[i*4], cols[i*4+1], cols[i*4+2]], M.PAL.cold, 0.35);
        cols[i*4] = c[0]; cols[i*4+1] = c[1]; cols[i*4+2] = c[2];
      }
    }
    M.mergeLayer(batcher, { pos: new Float32Array(pts), nor: new Float32Array(nrs),
      col: new Float32Array(cols), emi: layer.emi, idx: layer.idx });
  }
};

// Per-frame FX: fire flames, smoke, rain, clouds, sun, falling tokens, hover ring.
Scene3D.prototype.buildFx = function (state) {
  // state: {grids, falling, now, reducedMotion, seasonProgress, rand}
  const M = this.M;
  const b = new M.Batcher();
  const { grids, falling, now, reducedMotion, seasonProgress, rand } = state;
  const t = now / 1000;
  for (const key of this.plotKeys) {
    const grid = grids[key];
    for (let y = 0; y < SIZE16; y++) for (let x = 0; x < SIZE16; x++) {
      const tile = grid.tiles[y][x];
      if (tile.fire <= 0) continue;
      const w = tileToWorld(key, x, y);
      const ti = (key === "fishkill" ? 0 : SIZE16 * SIZE16) + y * SIZE16 + x;
      const topY = this.terrain ? this.terrain.heights[ti] : 0;
      const flick = reducedMotion ? 0.5 : (Math.sin(t * 13 + x * 3.1 + y * 1.7) * 0.5 + 0.5);
      const F = M.flame(flick);
      const m = M.mTranslate(w.x, topY, w.z);
      this._mergeAt(b, F, m, false);
      if (!reducedMotion) {
        // two smoke puffs rising, looping
        for (let s = 0; s < 2; s++) {
          const ph = ((t * 0.7 + s * 0.5 + x * 0.13 + y * 0.29) % 1);
          const sm = M.smokePuff(t);
          b.add(sm, M.mTranslate(w.x + Math.sin(t * 2 + s * 3) * 0.15, topY + 0.6 + ph * 1.6, w.z));
        }
      }
    }
    // rain streaks
    if (now < grid.rainUntil && !reducedMotion) {
      const p = PLOT[key];
      for (let i = 0; i < 70; i++) {
        const rx = p.x0 + rand() * PLOT.w, rz = PLOT.fishkill.z0 + rand() * PLOT.d;
        const fall = ((t * 9 + i * 0.37) % 7);
        b.add(M.streak(0.035, 0.8, M.PAL.rain.concat([0.5])), M.mTranslate(rx, 7 - fall, rz));
      }
    }
  }
  // clouds: 5 clusters drifting
  if (!this.clouds.length) {
    for (let i = 0; i < 5; i++) {
      this.clouds.push({ x: -20 + rand() * 40, y: 11 + rand() * 5, z: -14 + rand() * 20, speed: 0.5 + rand() * 0.8, grey: rand() < 0.3, seed: rand() * 10 });
    }
  }
  for (const c of this.clouds) {
    const cx = reducedMotion ? c.x : -24 + ((c.x + 24 + t * c.speed) % 48);
    // stable puff shape per cloud, rebuilt from its seed
    const cl = M.cloudCluster(mulberryLike(c.seed), c.grey);
    this._mergeRaw(b, cl.opaque, M.mTranslate(cx, c.y, c.z));
  }
  // sun on its arc
  const sunPos = sunPosition(seasonProgress);
  const S = M.sunBall();
  this._mergeRaw(b, S.opaque, M.mTranslate(sunPos[0], sunPos[1], sunPos[2]));
  // sky dome (emis=1: no light, no fog wash)
  b.add(M.skyDome(), null);
  // falling tokens
  for (const f of falling) {
    const key = f.plot === "brooklyn" ? "brooklyn" : "fishkill";
    const w = tileToWorld(key, f.tx == null ? 8 : f.tx, f.ty == null ? 8 : f.ty);
    const dur = 1800;
    const pr = reducedMotion ? 1 : Math.min(1, (now - f.startT) / dur);
    if (pr >= 1) continue;
    const yy = 13 - pr * 12.4;
    const tok = M.tokenFor(f.itemKey);
    const sc = 1 + Math.sin(pr * Math.PI) * 0.15;
    this._mergeAt(b, tok, M.compose(w.x, yy, w.z, sc, sc, sc, t * 1.5), false);
  }
  // hover highlight
  if (this.hoverTile) {
    const w = tileToWorld(this.hoverTile.plot, this.hoverTile.x, this.hoverTile.y);
    const ti = (this.hoverTile.plot === "fishkill" ? 0 : SIZE16 * SIZE16) + this.hoverTile.y * SIZE16 + this.hoverTile.x;
    const topY = this.terrain ? this.terrain.heights[ti] : 0;
    const H = M.highlightRing(0);
    this._mergeAt(b, H, M.mTranslate(w.x, topY + 0.16, w.z), false);
  }
  return b.finish();
};

// merge a single raw layer into a batcher with a matrix (fx helper; uses this.M)
Scene3D.prototype._mergeRaw = function (batcher, layer, matrix) {
  const M = this.M;
  if (!layer || !layer.pos || layer.pos.length === 0 || !matrix) return;
  const n = layer.pos.length / 3;
  const pts = [], nrs = [];
  for (let i = 0; i < n; i++) {
    const pt = M.xformPoint(matrix, layer.pos[i*3], layer.pos[i*3+1], layer.pos[i*3+2]);
    const nr = M.xformNormal(matrix, layer.nor[i*3], layer.nor[i*3+1], layer.nor[i*3+2]);
    pts.push(pt[0], pt[1], pt[2]); nrs.push(nr[0], nr[1], nr[2]);
  }
  M.mergeLayer(batcher, { pos: new Float32Array(pts), nor: new Float32Array(nrs),
    col: layer.col, emi: layer.emi, idx: layer.idx });
};

// ---- orchestration: upload + draw ----
Scene3D.prototype.syncTerrain = function (grids, rand, now) {
  this.buildTerrain(grids, rand);
  this.r.upload(this.terrainLayer, this.terrain.geo);
  this.r.upload(this.gapLayer, this.terrain.gapGeo);
  this.refreshTerrainColors(grids, now);
};
Scene3D.prototype.refreshTerrainColors = function (grids, now) {
  if (!this.terrain) return;
  const cold = ["fishkill", "brooklyn"].some((k) => now < grids[k].coldUntil);
  this.r.updateColors(this.terrainLayer, this.terrainColors(grids, cold));
};
Scene3D.prototype.syncPlants = function (grids, rand, now) {
  this.r.upload(this.plantLayer, this.buildPlants(grids, rand, now));
};
// Per-frame: rebuild fx, compute matrices, draw everything.
Scene3D.prototype.renderFrame = function (state) {
  // state: {grids, falling, now, reducedMotion, seasonProgress, rand, sway}
  const r = this.r;
  const fx = this.buildFx(state);
  r.upload(this.fxLayer, fx);
  const cam = this.camera;
  const sway = state.reducedMotion ? 0 : Math.sin(state.now / 9000 + cam.swayPhase) * 0.035;
  const view = cam.viewMatrix(sway);
  const canvas = r.canvas;
  const proj = mPerspective(45, canvas.width / canvas.height, 0.1, 240);
  const mvp = mMul4(proj, view);
  const sunDir = sunPosition(state.seasonProgress);
  const l = Math.hypot(sunDir[0], sunDir[1], sunDir[2]) || 1;
  const light = [sunDir[0]/l, sunDir[1]/l, sunDir[2]/l];
  const ambient = [0.55, 0.52, 0.48];
  const fogColor = [0.93, 0.90, 0.83];
  r.clear();
  r.draw(this.gapLayer, mvp, light, ambient, fogColor, [45, 120]);
  r.draw(this.terrainLayer, mvp, light, ambient, fogColor, [45, 120]);
  r.draw(this.plantLayer, mvp, light, ambient, fogColor, [45, 120]);
  r.draw(this.fxLayer, mvp, light, ambient, fogColor, [45, 120]);
};
Scene3D.prototype.resize = function () {
  const canvas = this.r.canvas;
  const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
  const w = Math.max(1, Math.floor(canvas.clientWidth * Math.min(2, dpr)));
  const h = Math.max(1, Math.floor(canvas.clientHeight * Math.min(2, dpr)));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w; canvas.height = h;
    this.r.resize(w, h);
  }
};

// deterministic pseudo-rand from a seed number (for stable cloud shapes)
function mulberryLike(seed) {
  let a = Math.floor(seed * 1000) >>> 0 || 1;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Sun world position for the current season progress (also the light dir source).
function sunPosition(seasonProgress) {
  return [
    -42 * Math.cos(Math.PI * seasonProgress),
    9 + 26 * Math.sin(Math.PI * seasonProgress),
    -30,
  ];
}

const Engine3D = {
  PLOT, TILE, tileToWorld, worldToTile,
  mIdent4, mMul4, mPerspective, mLookAt, mInverse, xform4,
  Camera, CAM, screenRay, rayPlaneY, pickTile,
  VS_SRC, FS_SRC, compileShader, createProgram, createRenderer,
  Scene3D, sunPosition, mulberryLike,
};

if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
  module.exports = Engine3D;
} else if (typeof globalThis !== "undefined") {
  globalThis.Engine3D = Engine3D;
}
