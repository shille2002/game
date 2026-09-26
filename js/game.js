/* =========================================================
   RIFTLINE — browser tactical shooter prototype (Stage 1)
   Attack / defend rounds, plant & defuse the Charge, buy phase,
   economy, recoil, bots. Runs on the mini engine in engine.js.
   ========================================================= */
'use strict';

/* ================= MAP =================
   # wall   . floor   c low crate   C tall crate
   A / B  bomb sites   T attacker spawn   D defender spawn */
const DEFAULT_MAP = [
  '########################################',
  '###############DDDDDDDDDD###############',
  '#########......DDDDDDDDDD......#########',
  '#.AAAAAAAAAA...DDDDDDDDDD...BBBBBBBBBB.#',
  '#.AAAAAAAAAA..####....####..BBBBBBBBBB.#',
  '#.AAcAAAAcAA..#..........#..BBcBBBBcBB.#',
  '#.AAcAAAAAAA..#...C......#..BBBBBBBcBB.#',
  '#.AAAAACCAAA..#..........#..BBBCCBBBBB.#',
  '#.AAAAACCAAA.......cc.......BBBCCBBBBB.#',
  '#.AAAAAAAAAA................BBBBBBBBBB.#',
  '#.AAAAAAAAAA..#..........#..BBBBBBBBBB.#',
  '#.AAAAAAAAAA..#.....C....#..BBBBBBBBBB.#',
  '##...############......###########...###',
  '##.....##########......##########.....##',
  '##.c...##########......##########...c.##',
  '##.....##########..cc..##########.....##',
  '##.................cc.................##',
  '##....................................##',
  '##.....##########......##########.....##',
  '##.....##########...c..##########.....##',
  '##..C..##########......##########..C..##',
  '##.....##########......##########.....##',
  '##..........#####......#####..........##',
  '##...c......#####......#####......c...##',
  '##..........#####......#####..........##',
  '##..........#####......#####..........##',
  '######......##............##......######',
  '######......TTTTTTTTTTTTTTTT......######',
  '######......TTTTTTTTTTTTTTTT......######',
  '###########TTTTTTTTTTTTTTTTTT###########',
  '########################################',
];
const CRATE_H = 1.1, TALL_H = 2.4;
// Map state (either the built-in grid map or a custom .glb map)
let CELL = 3, WALL_H = 6.5, MAP = DEFAULT_MAP, ROWS = 0, COLS = 0, MAP_W = 0, MAP_D = 0;
let HGT = null, WALK = null, REG = {}, SETS = {}, SITE_CELLS = {}, SPAWN_CELLS = {}, POI = {}, ENTRIES = {}, CUSTOM = null;
const hAt = (c, r) => (c < 0 || r < 0 || c >= COLS || r >= ROWS) ? WALL_H : HGT[r * COLS + c];
const isWalk = (c, r) => c >= 0 && r >= 0 && c < COLS && r < ROWS && WALK[r * COLS + c] === 1;
const cellOf = v => Math.floor(v / CELL);
const cc = (c, r) => ({ x: (c + 0.5) * CELL, z: (r + 0.5) * CELL });
const inSet = (key, x, z) => { const c = cellOf(x), r = cellOf(z); return c >= 0 && r >= 0 && c < COLS && r < ROWS && SETS[key].has(r * COLS + c); };
// open cells with a free neighbour ring (so bots don't hug walls)
const roomy = (c, r) => {
  if (!isWalk(c, r)) return false; const h = hAt(c, r); let n = 0;
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (isWalk(c + dc, r + dr) && Math.abs(hAt(c + dc, r + dr) - h) < 0.3) n++;
  return n >= 7;
};
function cellsOf(key, filter) {
  const out = [];
  for (const i of SETS[key]) { const c = i % COLS, r = (i / COLS) | 0; if (isWalk(c, r) && (!filter || filter(c, r))) out.push([c, r]); }
  return out;
}
function bboxOfSet(set) {
  let c0 = 1e9, c1 = -1, r0 = 1e9, r1 = -1;
  for (const i of set) { const c = i % COLS, r = (i / COLS) | 0; c0 = Math.min(c0, c); c1 = Math.max(c1, c); r0 = Math.min(r0, r); r1 = Math.max(r1, r); }
  return { c0, c1, r0, r1 };
}
function finishMapSetup() {
  MAP_W = COLS * CELL; MAP_D = ROWS * CELL;
  for (const k of ['A', 'B', 'T', 'D']) REG[k] = bboxOfSet(SETS[k]);
  SITE_CELLS = { A: cellsOf('A', roomy), B: cellsOf('B', roomy) };
  if (!SITE_CELLS.A.length) SITE_CELLS.A = cellsOf('A'); if (!SITE_CELLS.B.length) SITE_CELLS.B = cellsOf('B');
  SPAWN_CELLS = { atk: cellsOf('T'), def: cellsOf('D') };
}
function initDefaultMap() {
  CUSTOM = null; MAP = DEFAULT_MAP; CELL = 3; WALL_H = 6.5;
  ROWS = MAP.length; COLS = MAP[0].length;
  HGT = new Float32Array(ROWS * COLS); WALK = new Uint8Array(ROWS * COLS);
  SETS = { A: new Set(), B: new Set(), T: new Set(), D: new Set() };
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const ch = MAP[r][c], i = r * COLS + c;
    HGT[i] = ch === '#' ? WALL_H : ch === 'c' ? CRATE_H : ch === 'C' ? TALL_H : 0;
    WALK[i] = HGT[i] === 0 ? 1 : 0;
  }
  // sites include their crates (bounding box of the letters)
  for (const k of ['A', 'B', 'T', 'D']) {
    let c0 = 1e9, c1 = -1, r0 = 1e9, r1 = -1;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (MAP[r][c] === k) { c0 = Math.min(c0, c); c1 = Math.max(c1, c); r0 = Math.min(r0, r); r1 = Math.max(r1, r); }
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) SETS[k].add(r * COLS + c);
  }
  POI = { mid: [19, 17], midTop: [20, 9], aLink: [13, 9], bLink: [26, 9], aLobby: [6, 24], bLobby: [33, 24], aMain: [4, 15], bMain: [35, 15] };
  ENTRIES = { A: [[3, 12], [13, 8.5], [12, 2.5]], B: [[35, 12], [26, 8.5], [27, 2.5]] };
  finishMapSetup();
}
function initCustomMap(data) {
  const g = data.grid, L = data.layout;
  CUSTOM = data; MAP = null; CELL = g.CELL; COLS = g.COLS; ROWS = g.ROWS; HGT = g.H; WALK = g.WALK; WALL_H = 60;
  SETS = { A: new Set(L.siteA), B: new Set(L.siteB), T: new Set(L.spawnT), D: new Set(L.spawnD) };
  const xy = i => [i % COLS, (i / COLS) | 0];
  POI = { mid: xy(L.mid), midTop: xy(L.mid) };
  ENTRIES = { A: L.entries.A.map(xy), B: L.entries.B.map(xy) };
  finishMapSetup();
}
initDefaultMap();

/* ================= CONSTANTS ================= */
const R_AG = 0.36, STEP = 0.45, GRAV = 19, JUMP_V = 6.3;
const RUN = 6.75, WALK_SPD = 3.3, CROUCH_SPD = 2.4;
const EYE_STAND = 1.62, EYE_CROUCH = 1.1;
const WIN_ROUNDS = 7, HALF = 6;
const BUY_TIME = 15, FIRST_BUY = 22, ROUND_TIME = 100, CHARGE_TIME = 45, END_TIME = 5;
const PLANT_TIME = 4, DEFUSE_TIME = 7;
const COL = { ally: 0x35d6c5, enemy: 0xff4655, allyL: hex(0x35d6c5), enemyL: hex(0xff4655) };

const WEAPONS = {
  sidearm: { key: 'sidearm', name: 'Sidearm', type: 'pistol', slot: 'secondary', price: 0, mag: 12, reserve: 36, rate: 6.75, auto: false,
    dmg: [78, 26, 22], fall: [30, 0.85], spread: 0.006, move: 0.03, air: 0.12, kick: 0.02, kickMax: 0.08, sway: 0.012, reload: 1.5, equip: 0.5, botAcc: 0.8 },
  wasp: { key: 'wasp', name: 'Wasp', type: 'smg', slot: 'primary', price: 1600, mag: 30, reserve: 90, rate: 13.3, auto: true,
    dmg: [78, 26, 22], fall: [20, 0.8], spread: 0.01, move: 0.02, air: 0.1, kick: 0.009, kickMax: 0.06, sway: 0.02, reload: 2.25, equip: 0.6, botAcc: 0.8 },
  ranger: { key: 'ranger', name: 'Ranger', type: 'rifle', slot: 'primary', price: 2900, mag: 25, reserve: 75, rate: 9.75, auto: true,
    dmg: [160, 40, 34], fall: [999, 1], spread: 0.0025, move: 0.065, air: 0.15, kick: 0.013, kickMax: 0.11, sway: 0.03, reload: 2.5, equip: 1.0, botAcc: 1.0 },
  longbow: { key: 'longbow', name: 'Longbow', type: 'sniper', slot: 'primary', price: 4700, mag: 5, reserve: 20, rate: 0.65, auto: false,
    dmg: [255, 150, 127], fall: [999, 1], spread: 0.04, scoped: 0.0, move: 0.2, air: 0.3, kick: 0.07, kickMax: 0.07, sway: 0, reload: 3.7, equip: 1.25, zoom: 3.5, botAcc: 1.15 },
};
const ARMOR = { light: { name: 'Light Shield', price: 400, value: 25 }, heavy: { name: 'Heavy Shield', price: 1000, value: 50 } };
const DIFF = {
  easy: { acc: 0.26, react: [0.5, 0.85], head: 0.1, turn: 5 },
  normal: { acc: 0.42, react: [0.3, 0.55], head: 0.18, turn: 8 },
  hard: { acc: 0.6, react: [0.18, 0.34], head: 0.28, turn: 12 },
};
const BOT_NAMES = ['Kestrel', 'Nova', 'Rook', 'Vex', 'Juno', 'Sable', 'Onyx', 'Echo', 'Pike', 'Wren', 'Talon'];

/* ================= UTIL ================= */
const rand = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const fwd = (yaw, pitch) => ({ x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) });
const yawTo = (dx, dz) => Math.atan2(-dx, -dz);
const $ = id => document.getElementById(id);
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const fmtTime = t => { t = Math.max(0, Math.ceil(t)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };

/* ================= COLLISION & RAYS ================= */
function blocked(x, z, feet, r = R_AG) {
  const c0 = cellOf(x - r), c1 = cellOf(x + r), r0 = cellOf(z - r), r1 = cellOf(z + r);
  for (let rr = r0; rr <= r1; rr++) for (let c = c0; c <= c1; c++) if (hAt(c, rr) > feet + STEP) return true;
  return false;
}
function groundAt(x, z, feet, r = R_AG) {
  const c0 = cellOf(x - r), c1 = cellOf(x + r), r0 = cellOf(z - r), r1 = cellOf(z + r);
  let g = 0;
  for (let rr = r0; rr <= r1; rr++) for (let c = c0; c <= c1; c++) { const h = hAt(c, rr); if (h <= feet + STEP && h > g) g = h; }
  return g;
}
function moveXZ(a, dx, dz) {
  const p = a.pos;
  if (dx) {
    let nx = p.x + dx;
    if (blocked(nx, p.z, p.y)) {
      nx = dx > 0 ? cellOf(nx + R_AG) * CELL - R_AG - 0.001 : (cellOf(nx - R_AG) + 1) * CELL + R_AG + 0.001;
      if (blocked(nx, p.z, p.y) || Math.abs(nx - p.x) > Math.abs(dx) + 0.01) nx = p.x;
      a.vel.x = 0; a.bumped = true;
    }
    p.x = nx;
  }
  if (dz) {
    let nz = p.z + dz;
    if (blocked(p.x, nz, p.y)) {
      nz = dz > 0 ? cellOf(nz + R_AG) * CELL - R_AG - 0.001 : (cellOf(nz - R_AG) + 1) * CELL + R_AG + 0.001;
      if (blocked(p.x, nz, p.y) || Math.abs(nz - p.z) > Math.abs(dz) + 0.01) nz = p.z;
      a.vel.z = 0; a.bumped = true;
    }
    p.z = nz;
  }
}
// 3D ray vs grid. returns {t, n:[nx,ny,nz]}
function rayGrid(o, d, maxT) {
  let best = maxT, n = null;
  let c = cellOf(o.x), r = cellOf(o.z);
  const sc = d.x > 0 ? 1 : -1, sr = d.z > 0 ? 1 : -1;
  const tdx = d.x !== 0 ? Math.abs(CELL / d.x) : Infinity, tdz = d.z !== 0 ? Math.abs(CELL / d.z) : Infinity;
  let tmx = d.x !== 0 ? ((d.x > 0 ? (c + 1) * CELL : c * CELL) - o.x) / d.x : Infinity;
  let tmz = d.z !== 0 ? ((d.z > 0 ? (r + 1) * CELL : r * CELL) - o.z) / d.z : Infinity;
  let tIn = 0, side = -1;
  for (let i = 0; i < 4096; i++) {
    const h = hAt(c, r), tOut = Math.min(tmx, tmz);
    {
      const yIn = o.y + d.y * tIn;
      if (yIn < h) {
        if (tIn < best) { best = tIn; n = side === 0 ? [-sc, 0, 0] : side === 1 ? [0, 0, -sr] : [0, 1, 0]; }
        break;
      }
      if (d.y < 0) { const tt = (h - o.y) / d.y; if (tt >= tIn && tt <= tOut && tt < best) { best = tt; n = [0, 1, 0]; break; } }
    }
    if (tIn > best) break;
    if (tmx < tmz) { tIn = tmx; tmx += tdx; c += sc; side = 0; } else { tIn = tmz; tmz += tdz; r += sr; side = 1; }
    if (c < -1 || r < -1 || c > COLS || r > ROWS) break;
  }
  return { t: best, n };
}
function los(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, L = Math.hypot(dx, dy, dz);
  if (L < 0.01) return true;
  return rayGrid(a, { x: dx / L, y: dy / L, z: dz / L }, L).t >= L - 0.05;
}
// walkable straight line for path smoothing
function clearLine(ax, az, bx, bz, feet = 0) {
  const L = Math.hypot(bx - ax, bz - az), n = Math.ceil(L / 0.6);
  for (let i = 1; i <= n; i++) {
    const t = i / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
    if (blocked(x, z, feet, R_AG + 0.2)) return false;
  }
  return true;
}
// ray vs agent (head sphere + body cylinder)
function rayAgent(o, d, a, maxT) {
  const headY = a.pos.y + a.eyeH() + 0.02, hr = 0.2;
  let best = null;
  { // head sphere
    const ox = o.x - a.pos.x, oy = o.y - headY, oz = o.z - a.pos.z;
    const b = ox * d.x + oy * d.y + oz * d.z, c = ox * ox + oy * oy + oz * oz - hr * hr, disc = b * b - c;
    if (disc >= 0) { const t = -b - Math.sqrt(disc); if (t > 0 && t < maxT) best = { t, part: 0 }; }
  }
  { // body cylinder
    const cr = 0.34, ox = o.x - a.pos.x, oz = o.z - a.pos.z;
    const A = d.x * d.x + d.z * d.z, B = 2 * (ox * d.x + oz * d.z), C = ox * ox + oz * oz - cr * cr;
    const disc = B * B - 4 * A * C;
    if (A > 1e-6 && disc >= 0) {
      const s = Math.sqrt(disc);
      for (const t of [(-B - s) / (2 * A), (-B + s) / (2 * A)]) {
        if (t <= 0 || t >= maxT) continue;
        const y = o.y + d.y * t - a.pos.y;
        if (y >= 0 && y <= headY - a.pos.y - 0.18) {
          if (!best || t < best.t) best = { t, part: y < 0.78 ? 2 : 1 };
          break;
        }
      }
    }
  }
  return best;
}

/* ================= PATHFINDING (A*) ================= */
function findPath(sc, sr, gc, gr) {
  if (!isWalk(gc, gr)) return null;
  const N = ROWS * COLS, g = new Float32Array(N).fill(1e9), came = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
  const s = sr * COLS + sc, goal = gr * COLS + gc; g[s] = 0;
  const h = i => Math.hypot(i % COLS - gc, Math.floor(i / COLS) - gr);
  // binary heap of [f, idx]
  const hf = [], hi = [];
  const push = (f, i) => { hf.push(f); hi.push(i); let k = hf.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (hf[p] <= hf[k]) break; [hf[p], hf[k]] = [hf[k], hf[p]]; [hi[p], hi[k]] = [hi[k], hi[p]]; k = p; } };
  const pop = () => { const r = hi[0], lf = hf.pop(), li = hi.pop(); if (hf.length) { hf[0] = lf; hi[0] = li; let k = 0; for (; ;) { const l = 2 * k + 1, rr = l + 1; let m = k; if (l < hf.length && hf[l] < hf[m]) m = l; if (rr < hf.length && hf[rr] < hf[m]) m = rr; if (m === k) break; [hf[m], hf[k]] = [hf[k], hf[m]]; [hi[m], hi[k]] = [hi[k], hi[m]]; k = m; } } return r; };
  push(h(s), s);
  const stepOk = (a, b) => Math.abs(HGT[a] - HGT[b]) <= 1.16;
  while (hf.length) {
    const cur = pop();
    if (cur === goal) break;
    if (closed[cur]) continue; closed[cur] = 1;
    const cx = cur % COLS, cy = Math.floor(cur / COLS);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = cx + dx, ny = cy + dy;
      if (!isWalk(nx, ny)) continue;
      const ni = ny * COLS + nx; if (closed[ni] || (isWalk(cx, cy) && !stepOk(cur, ni))) continue;
      if (dx && dy && (!isWalk(cx + dx, cy) || !isWalk(cx, cy + dy))) continue;
      const ng = g[cur] + (dx && dy ? 1.414 : 1);
      if (ng < g[ni]) { g[ni] = ng; came[ni] = cur; push(ng + h(ni), ni); }
    }
  }
  if (came[goal] === -1 && goal !== s) return null;
  const path = []; let i = goal;
  while (i !== s && i !== -1) { path.push([i % COLS, Math.floor(i / COLS)]); i = came[i]; }
  return path.reverse();
}

/* ================= AUDIO (synthesized) ================= */
const Snd = {
  ctx: null, master: null, noise: null, vol: 0.6,
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    this.ctx = new AC(); this.master = this.ctx.createGain(); this.master.gain.value = this.vol;
    const comp = this.ctx.createDynamicsCompressor(); this.master.connect(comp); comp.connect(this.ctx.destination);
    const len = this.ctx.sampleRate; this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  },
  setVol(v) { this.vol = v; if (this.master) this.master.gain.value = v; },
  spatial(pos) {
    if (!pos) return { v: 1, pan: 0 };
    const L = G.listener, dx = pos.x - L.x, dz = pos.z - L.z, d = Math.hypot(dx, dz) || 0.001;
    const rx = Math.cos(L.yaw), rz = -Math.sin(L.yaw);
    return { v: 1 / (1 + d / 9), pan: clamp((dx * rx + dz * rz) / d, -1, 1) * Math.min(1, d / 3) * 0.8, d };
  },
  out(pos, gain) {
    const c = this.ctx, g = c.createGain(), sp = this.spatial(pos); g.gain.value = gain * sp.v;
    let node = g;
    if (c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = sp.pan; g.connect(p); p.connect(this.master); }
    else g.connect(this.master);
    return { g, sp, node };
  },
  burst(pos, { gain = 0.5, dur = 0.12, freq = 1800, q = 0.7, type = 'lowpass', thump = 0, thumpF = 110 }) {
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime;
    const { g, sp } = this.out(pos, gain);
    if (sp.v < 0.02) return;
    const src = c.createBufferSource(); src.buffer = this.noise; src.playbackRate.value = rand(0.9, 1.1);
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq * (sp.d > 25 ? 0.5 : 1); f.Q.value = q;
    const e = c.createGain(); e.gain.setValueAtTime(1, t); e.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(e); e.connect(g); src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
    if (thump) {
      const o = c.createOscillator(), oe = c.createGain(); o.frequency.setValueAtTime(thumpF, t); o.frequency.exponentialRampToValueAtTime(35, t + 0.12);
      oe.gain.setValueAtTime(thump, t); oe.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      o.connect(oe); oe.connect(g); o.start(t); o.stop(t + 0.2);
    }
  },
  tone(pos, { f = 880, dur = 0.08, gain = 0.2, type = 'sine', f2 }) {
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime;
    const { g } = this.out(pos, gain);
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const e = c.createGain(); e.gain.setValueAtTime(0.0001, t); e.gain.exponentialRampToValueAtTime(1, t + 0.005); e.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(e); e.connect(g); o.start(t); o.stop(t + dur + 0.02);
  },
  shot(type, pos, mine) {
    const k = mine ? 1 : 1.4;
    if (type === 'pistol') this.burst(pos, { gain: 0.45 * k, dur: 0.1, freq: 2600, thump: 0.5, thumpF: 160 });
    else if (type === 'smg') this.burst(pos, { gain: 0.35 * k, dur: 0.07, freq: 3200, thump: 0.3, thumpF: 180 });
    else if (type === 'rifle') this.burst(pos, { gain: 0.55 * k, dur: 0.13, freq: 2000, thump: 0.8, thumpF: 120 });
    else this.burst(pos, { gain: 0.8 * k, dur: 0.35, freq: 1400, thump: 1.2, thumpF: 90 });
  },
  hit(head) { head ? this.tone(null, { f: 1500, f2: 2200, dur: 0.12, gain: 0.35, type: 'triangle' }) : this.tone(null, { f: 520, dur: 0.05, gain: 0.25, type: 'square' }); },
  step(pos, mine) { this.burst(pos, { gain: mine ? 0.05 : 0.22, dur: 0.05, freq: 700, q: 1.5, type: 'bandpass' }); },
  impact(pos) { this.burst(pos, { gain: 0.12, dur: 0.05, freq: 4000, type: 'highpass' }); },
  ui() { this.tone(null, { f: 660, dur: 0.06, gain: 0.15, type: 'triangle' }); },
  denied() { this.tone(null, { f: 180, dur: 0.12, gain: 0.2, type: 'square' }); },
  beep(pos) { this.tone(pos, { f: 1250, dur: 0.09, gain: 0.35, type: 'square' }); },
  reload() { this.burst(null, { gain: 0.15, dur: 0.05, freq: 3000, q: 3, type: 'bandpass' }); },
  boom(pos) { this.burst(pos, { gain: 2.2, dur: 1.6, freq: 500, thump: 2, thumpF: 70 }); },
  announce(up) { this.tone(null, { f: up ? 440 : 520, f2: up ? 880 : 260, dur: 0.35, gain: 0.25, type: 'sawtooth' }); },
};

/* ================= GAME STATE ================= */
const G = {
  running: false, paused: false, phase: 'menu', timer: 0, time: 0, round: 0, timeScale: 1,
  score: [0, 0], lossStreak: [0, 0], agents: [], player: null, teamSize: 3, diff: DIFF.normal, diffName: 'normal',
  charge: { state: 'none', carrier: null, pos: { x: 0, y: 0, z: 0 }, timer: 0, site: null, beep: 0 },
  atkSite: 'A', listener: { x: 0, z: 0, yaw: 0 }, spec: 0, buyOpen: false, over: false,
  sens: 1, fov: 103, killfeed: [], fx: [], decals: [], tracers: [], flashes: [],
  deathCam: null,
};
const sideOf = team => ((G.round <= HALF) === (team === 0)) ? 'atk' : 'def';
const teamOfSide = side => sideOf(0) === side ? 0 : 1;

class Agent {
  constructor(name, team, isPlayer = false) {
    this.name = name; this.team = team; this.isPlayer = isPlayer;
    this.pos = { x: 0, y: 0, z: 0 }; this.vel = { x: 0, y: 0, z: 0 };
    this.yaw = 0; this.pitch = 0; this.onGround = true; this.crouch = 0; this.crouching = false;
    this.hp = 100; this.armor = 0; this.alive = true; this.deadT = 0;
    this.credits = 800; this.kills = 0; this.deaths = 0;
    this.primary = null; this.secondary = 'sidearm'; this.slot = 'secondary'; this.ammo = {};
    this.reloadT = 0; this.nextFire = 0; this.equipT = 0; this.recoil = { x: 0, y: 0 }; this.shots = 0; this.lastShot = -9;
    this.spotted = -9; this.stepT = 0; this.walkPhase = 0; this.flashT = 0; this.hitFlash = 0;
    this.action = null; // {type:'plant'|'defuse', t}
    this.ai = null;
    this.refill();
  }
  get wkey() { return this.slot === 'primary' && this.primary ? this.primary : this.secondary; }
  get w() { return WEAPONS[this.wkey]; }
  eyeH() { return EYE_STAND - (EYE_STAND - EYE_CROUCH) * this.crouch; }
  eye() { return { x: this.pos.x, y: this.pos.y + this.eyeH(), z: this.pos.z }; }
  chest() { return { x: this.pos.x, y: this.pos.y + this.eyeH() - 0.45, z: this.pos.z }; }
  refill() { for (const k of [this.primary, this.secondary]) if (k) this.ammo[k] = { mag: WEAPONS[k].mag, res: WEAPONS[k].reserve }; }
  give(key) {
    const w = WEAPONS[key];
    if (w.slot === 'primary') this.primary = key; else this.secondary = key;
    this.ammo[key] = { mag: w.mag, res: w.reserve };
    this.equip(w.slot);
  }
  equip(slot) {
    if (slot === 'primary' && !this.primary) return;
    if (this.slot === slot && this.equipT <= 0) return;
    this.slot = slot; this.equipT = this.w.equip; this.reloadT = 0; this.shots = 0;
    if (this.isPlayer) { G.scoped = false; }
  }
  get speed() { return Math.hypot(this.vel.x, this.vel.z); }
}

/* ================= RENDERER SETUP ================= */
const canvas = $('game');
let R;
try { R = new Renderer(canvas); } catch (e) { $('nogl').classList.remove('hidden'); throw e; }
R.resize();

const MESH = {};
const TEX = {};
function buildMeshes() {
  // unit cube (centered) & unit quad & cylinder
  let g = new Geo(); g.box(-0.5, -0.5, -0.5, 0.5, 0.5, 0.5, [1, 1, 1], null, false); MESH.cube = R.mesh(g);
  g = new Geo(); g.quad([-0.5, -0.5, 0], [0.5, -0.5, 0], [0.5, 0.5, 0], [-0.5, 0.5, 0], [0, 0, 1], [[0, 0], [1, 0], [1, 1], [0, 1]]); MESH.quad = R.mesh(g);
  g = new Geo(); g.cylinder(0.5, 1, 18); MESH.cyl = R.mesh(g);

  // ---- textures ----
  const floorCv = makeCanvas(512, 512, (x, w, h) => {
    x.fillStyle = '#bcae9a'; x.fillRect(0, 0, w, h);
    blotches(x, w, h, 40, 'rgba(120,100,80,A)', 20, 90, 0.12);
    blotches(x, w, h, 30, 'rgba(255,245,230,A)', 20, 70, 0.12);
    x.strokeStyle = 'rgba(70,60,50,0.35)'; x.lineWidth = 3;
    for (let i = 0; i <= 4; i++) { x.beginPath(); x.moveTo(i * 128, 0); x.lineTo(i * 128, h); x.stroke(); x.beginPath(); x.moveTo(0, i * 128); x.lineTo(w, i * 128); x.stroke(); }
    x.strokeStyle = 'rgba(255,255,255,0.12)'; x.lineWidth = 1;
    for (let i = 0; i <= 4; i++) { x.beginPath(); x.moveTo(i * 128 + 2, 0); x.lineTo(i * 128 + 2, h); x.stroke(); x.beginPath(); x.moveTo(0, i * 128 + 2); x.lineTo(w, i * 128 + 2); x.stroke(); }
    addNoise(x, w, h, 18);
  });
  TEX.floor = R.texture(floorCv);
  const wallTex = (base, accent, dark) => R.texture(makeCanvas(256, 512, (x, w, h) => {
    x.fillStyle = base; x.fillRect(0, 0, w, h);
    blotches(x, w, h, 25, 'rgba(90,70,50,A)', 20, 80, 0.10);
    blotches(x, w, h, 25, 'rgba(255,255,255,A)', 20, 80, 0.10);
    x.fillStyle = 'rgba(0,0,0,0.10)'; x.fillRect(w - 3, 0, 3, h); // panel seam
    x.fillStyle = dark; x.fillRect(0, h - h * 0.075, w, h * 0.075); // base band
    x.fillStyle = accent; x.fillRect(0, h - h * 0.17, w, h * 0.022); // accent stripe
    x.fillStyle = 'rgba(255,255,255,0.35)'; x.fillRect(0, 0, w, h * 0.02); // top cap
    x.fillStyle = 'rgba(0,0,0,0.12)'; x.fillRect(0, h * 0.02, w, h * 0.008);
    addNoise(x, w, h, 16);
  }));
  TEX.wallA = wallTex('#d9c29c', '#1fa99b', '#6d5a45');
  TEX.wallB = wallTex('#aeb8c6', '#e8743b', '#4b5361');
  TEX.wallM = wallTex('#d3cabc', '#ff4655', '#5e564c');
  TEX.wallS = wallTex('#c9bfae', '#e0b53c', '#56504a');
  TEX.crate = R.texture(makeCanvas(256, 256, (x, w, h) => {
    x.fillStyle = '#6f7a5a'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#5b654a'; for (let i = 0; i < 8; i++) x.fillRect(i * 32 + 4, 0, 6, h);
    x.strokeStyle = '#3e4533'; x.lineWidth = 14; x.strokeRect(7, 7, w - 14, h - 14);
    x.fillStyle = '#e0b53c'; x.fillRect(16, h - 40, 60, 14);
    x.fillStyle = 'rgba(255,255,255,.18)'; x.fillRect(0, 0, w, 5);
    addNoise(x, w, h, 20);
  }));
  TEX.glow = R.texture(makeCanvas(64, 64, (x, w, h) => {
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr; x.fillRect(0, 0, w, h);
  }), { repeat: false });
  TEX.flash = R.texture(makeCanvas(128, 128, (x, w, h) => {
    x.translate(64, 64);
    for (let i = 0; i < 6; i++) {
      x.rotate(Math.PI / 3); const gr = x.createLinearGradient(0, 0, 60, 0);
      gr.addColorStop(0, 'rgba(255,240,200,1)'); gr.addColorStop(1, 'rgba(255,160,40,0)');
      x.fillStyle = gr; x.beginPath(); x.moveTo(0, -7); x.lineTo(62, 0); x.lineTo(0, 7); x.fill();
    }
    const gr = x.createRadialGradient(0, 0, 0, 0, 0, 30); gr.addColorStop(0, 'rgba(255,255,230,1)'); gr.addColorStop(1, 'rgba(255,180,60,0)');
    x.fillStyle = gr; x.beginPath(); x.arc(0, 0, 30, 0, 7); x.fill();
  }), { repeat: false });
  TEX.hole = R.texture(makeCanvas(64, 64, (x) => {
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 30);
    gr.addColorStop(0, 'rgba(20,15,10,0.95)'); gr.addColorStop(0.3, 'rgba(40,30,25,0.7)'); gr.addColorStop(1, 'rgba(40,30,25,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
  }), { repeat: false });
  TEX.diamond = R.texture(makeCanvas(64, 64, (x) => {
    x.fillStyle = '#fff'; x.beginPath(); x.moveTo(32, 60); x.lineTo(12, 30); x.lineTo(32, 4); x.lineTo(52, 30); x.closePath(); x.fill();
  }), { repeat: false });
  const letter = (L, col) => R.texture(makeCanvas(512, 512, (x) => {
    x.strokeStyle = col; x.lineWidth = 10; x.globalAlpha = 0.9; x.strokeRect(10, 10, 492, 492);
    x.globalAlpha = 0.55; x.fillStyle = col; x.font = 'bold 300px Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(L, 256, 270);
  }), { repeat: false });
  TEX.siteA = letter('A', '#ffffff'); TEX.siteB = letter('B', '#ffffff');
  TEX.spawn = R.texture(makeCanvas(256, 256, (x) => {
    x.strokeStyle = '#fff'; x.lineWidth = 6; x.globalAlpha = 0.5;
    for (let i = -256; i < 512; i += 40) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + 256, 256); x.stroke(); }
  }));
  TEX.letterA = letterTex('A'); TEX.letterB = letterTex('B');
}
function letterTex(L) {
  return R.texture(makeCanvas(256, 256, (x) => {
    x.font = 'bold 200px Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.lineWidth = 14; x.strokeStyle = 'rgba(0,0,0,0.55)'; x.strokeText(L, 128, 138);
    x.fillStyle = '#fff'; x.fillText(L, 128, 138);
  }), { repeat: false });
}
// ---- built-in map geometry ----
function buildDefaultWorld() {
  const fl = new Geo();
  fl.quad([0, 0, MAP_D], [MAP_W, 0, MAP_D], [MAP_W, 0, 0], [0, 0, 0], [0, 1, 0], [[0, 0], [MAP_W / 6, 0], [MAP_W / 6, MAP_D / 6], [0, MAP_D / 6]]);

  // walls: greedy rectangles of '#', only those touching floor get geometry
  const used = new Uint8Array(ROWS * COLS);
  const touchesFloor = (c, r) => { for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const cc2 = c + dc, rr = r + dr; if (cc2 >= 0 && rr >= 0 && cc2 < COLS && rr < ROWS && HGT[rr * COLS + cc2] < WALL_H) return true; } return false; };
  const zones = { A: new Geo(), B: new Geo(), M: new Geo(), S: new Geo() };
  const wallUV = (n, v) => Math.abs(n[1]) > 0.5 ? [v[0] / 4, v[2] / 4] : [(Math.abs(n[0]) > 0.5 ? v[2] : v[0]) / 4, v[1] / WALL_H];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const i = r * COLS + c; if (used[i] || HGT[i] !== WALL_H || !touchesFloor(c, r)) continue;
    let c2 = c; while (c2 + 1 < COLS && HGT[r * COLS + c2 + 1] === WALL_H && !used[r * COLS + c2 + 1] && touchesFloor(c2 + 1, r)) c2++;
    let r2 = r; outer: while (r2 + 1 < ROWS) { for (let k = c; k <= c2; k++) { const j = (r2 + 1) * COLS + k; if (HGT[j] !== WALL_H || used[j] || !touchesFloor(k, r2 + 1)) break outer; } r2++; }
    for (let rr = r; rr <= r2; rr++) for (let k = c; k <= c2; k++) used[rr * COLS + k] = 1;
    const mx = (c + c2 + 1) / 2, mr = (r + r2 + 1) / 2;
    const zone = mr > 26 || mr < 2.5 ? 'S' : mx < 14 ? 'A' : mx > 26 ? 'B' : 'M';
    zones[zone].box(c * CELL, 0, r * CELL, (c2 + 1) * CELL, WALL_H, (r2 + 1) * CELL, [1, 1, 1], wallUV);
  }
  MESH.world = [{ mesh: R.mesh(fl), tex: TEX.floor, cast: false }];
  for (const [z, geo] of Object.entries(zones)) MESH.world.push({ mesh: R.mesh(geo), tex: TEX['wall' + z] });
  // crates
  const cr = new Geo();
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const h = HGT[r * COLS + c]; if (h !== CRATE_H && h !== TALL_H) continue;
    const x0 = c * CELL + 0.05, z0 = r * CELL + 0.05, x1 = (c + 1) * CELL - 0.05, z1 = (r + 1) * CELL - 0.05;
    const uv = (n, v) => Math.abs(n[1]) > 0.5 ? [(v[0] - x0) / (x1 - x0), (v[2] - z0) / (z1 - z0)] : [((Math.abs(n[0]) > 0.5 ? v[2] - z0 : v[0] - x0)) / (x1 - x0), v[1] / CRATE_H];
    const tint = 0.85 + Math.random() * 0.3;
    cr.box(x0, 0, z0, x1, h, z1, [tint, tint, tint * 0.95], uv);
  }
  MESH.world.push({ mesh: R.mesh(cr), tex: TEX.crate });
  // backdrop buildings outside the arena (depth & silhouette)
  const bd = new Geo();
  const bcol = [[0.5, 0.46, 0.42], [0.44, 0.45, 0.48], [0.55, 0.5, 0.44]];
  for (let i = 0; i < 46; i++) {
    const side = i % 4; let x, z;
    const t = Math.random();
    if (side === 0) { x = -30 + t * (MAP_W + 60); z = -rand(12, 45); }
    else if (side === 1) { x = -30 + t * (MAP_W + 60); z = MAP_D + rand(12, 45); }
    else if (side === 2) { x = -rand(12, 45); z = t * MAP_D; }
    else { x = MAP_W + rand(12, 45); z = t * MAP_D; }
    const w = rand(8, 22), d = rand(8, 22), h = rand(10, 34);
    bd.box(x - w / 2, 0, z - d / 2, x + w / 2, h, z + d / 2, pick(bcol));
  }
  bd.quad([-300, -0.05, 400], [MAP_W + 300, -0.05, 400], [MAP_W + 300, -0.05, -300], [-300, -0.05, -300], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], [0.62, 0.55, 0.47]);
  MESH.world.push({ mesh: R.mesh(bd), cast: false, shadow: false });
}
// ---- custom .glb map geometry ----
async function buildCustomWorld(data) {
  const texCache = new Map();
  const texFor = async (i) => {
    if (i < 0 || !data.images[i]) return null;
    if (texCache.has(i)) return texCache.get(i);
    let t = null;
    try {
      const bmp = await createImageBitmap(data.images[i], { imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      t = R.texture(bmp, { flipY: false });
    } catch (e) { console.warn('texture failed', e); }
    texCache.set(i, t); return t;
  };
  MESH.world = [];
  for (const m of data.meshes) {
    const mat = m.mat, tex = await texFor(mat.tex);
    const c = mat.color;
    const lin = v => v; // glTF factors are already linear
    MESH.world.push({
      mesh: R.mesh(m.geo), tex: tex || undefined, color: [lin(c[0]), lin(c[1]), lin(c[2]), c[3] ?? 1],
      alphaCut: mat.alphaCut, noCull: true, mode: mat.blend ? 'alpha' : 'lit', cast: !mat.blend,
      emis: mat.emis && (mat.emis[0] + mat.emis[1] + mat.emis[2]) > 0 ? mat.emis.map(v => v * 0.6) : undefined,
    });
  }
}
function applyMapLighting() {
  const S = Math.max(MAP_W, MAP_D);
  R.setLight(MAP_W / 2, MAP_D / 2, S * 0.62);
  R.fogRange = [Math.max(60, S * 0.6), Math.max(260, S * 2.2)];
}
buildMeshes();
buildDefaultWorld();
applyMapLighting();

/* ---- draw helpers ---- */
const _m = M4.create(), _m2 = M4.create();
function boxAt(x, y, z, sx, sy, sz, color, o = {}) {
  const m = M4.identity(_m); M4.translate(m, x, y, z); if (o.yaw) M4.rotateY(m, o.yaw); M4.scale(m, sx, sy, sz);
  R.draw(MESH.cube, m, { color, ...o });
}
function billboard(x, y, z, size, tex, color, mode = 'add', rot = 0, layer = 'world') {
  const m = M4.identity(_m); M4.translate(m, x, y, z); M4.rotateY(m, R.camYaw); M4.rotateX(m, R.camPitch); if (rot) M4.rotateZ(m, rot);
  M4.scale(m, size, size, size);
  R.draw(MESH.quad, m, { tex, color, mode, layer, cast: false });
}
function orient(m, d) { M4.rotateY(m, yawTo(d.x, d.z)); M4.rotateX(m, Math.asin(clamp(d.y, -1, 1))); }

/* ---- agent model ---- */
const SUIT = hex(0x2a2e37), SKIN = hex(0xd6b394), GUNC = hex(0x1c1f25), BOOT = hex(0x1a1b1f);
function drawAgent(a) {
  const ally = a.team === G.player.team;
  const tc = ally ? COL.allyL : COL.enemyL;
  const flash = a.hitFlash > 0 ? [0.6, 0.6, 0.6] : ZERO3;
  const root = M4.identity(_m2);
  M4.translate(root, a.pos.x, a.pos.y, a.pos.z); M4.rotateY(root, a.yaw);
  if (!a.alive) { const k = clamp(a.deadT / 0.45, 0, 1); M4.rotateX(root, k * k * 1.5); }
  const part = (ox, oy, oz, sx, sy, sz, col, rx = 0, piv = 0, emis = flash) => {
    const m = M4.copy(_m, root); M4.translate(m, ox, oy, oz); if (rx) M4.rotateX(m, rx); if (piv) M4.translate(m, 0, piv, 0);
    M4.scale(m, sx, sy, sz); R.draw(MESH.cube, m, { color: col, emis });
  };
  const sp = a.alive ? clamp(a.speed / RUN, 0, 1) : 0, sw = Math.sin(a.walkPhase) * 0.7 * sp;
  const crouchDrop = a.crouch * 0.35;
  part(-0.12, 0.88 - crouchDrop, 0, 0.17, 0.86, 0.2, SUIT, sw, -0.43);
  part(0.12, 0.88 - crouchDrop, 0, 0.17, 0.86, 0.2, SUIT, -sw, -0.43);
  part(-0.12, 0.06, -0.04, 0.18, 0.12, 0.3, BOOT);
  part(0.12, 0.06, -0.04, 0.18, 0.12, 0.3, BOOT);
  const ty = 1.2 - crouchDrop;
  part(0, ty, 0, 0.48, 0.62, 0.28, tc);
  part(0, ty + 0.02, 0.02, 0.5, 0.36, 0.3, SUIT);
  part(0, ty + 0.42, 0, 0.25, 0.27, 0.26, SKIN);
  part(0, ty + 0.58, 0.02, 0.28, 0.1, 0.3, tc);
  part(0, ty + 0.45, -0.13, 0.22, 0.06, 0.02, [0.05, 0.05, 0.05, 1], 0, 0, [tc[0] * 2, tc[1] * 2, tc[2] * 2]);
  // arms + gun (aim pitch)
  const m = M4.copy(_m, root); M4.translate(m, 0, ty + 0.18, 0); M4.rotateX(m, a.alive ? a.pitch : 0);
  const armPart = (ox, oy, oz, sx, sy, sz, col) => { const mm = M4.copy(M4.create(), m); M4.translate(mm, ox, oy, oz); M4.scale(mm, sx, sy, sz); R.draw(MESH.cube, mm, { color: col, emis: flash }); };
  armPart(0.24, -0.05, -0.2, 0.13, 0.13, 0.46, tc);
  armPart(-0.18, -0.06, -0.32, 0.12, 0.12, 0.44, tc);
  const gl = a.w.type === 'sniper' ? 1.0 : a.w.type === 'pistol' ? 0.3 : 0.7;
  armPart(0.1, 0.0, -0.35 - gl / 2 + 0.2, 0.08, 0.12, gl, GUNC);
  if (a.flashT > 0) { const p = agentMuzzle(a); billboard(p.x, p.y, p.z, 0.6, TEX.flash, [1, 0.8, 0.5, 1], 'add', Math.random() * 6); }
  if (G.charge.state === 'carried' && G.charge.carrier === a) {
    const mm = M4.copy(M4.create(), root); M4.translate(mm, 0, ty + 0.1, 0.24); M4.scale(mm, 0.3, 0.36, 0.2);
    R.draw(MESH.cube, mm, { color: hex(0x333840), emis: [0.6, 0.15, 0.1] });
  }
}
function agentMuzzle(a) {
  const f = fwd(a.yaw, a.pitch), rx = Math.cos(a.yaw), rz = -Math.sin(a.yaw);
  const gl = a.w.type === 'sniper' ? 1.1 : a.w.type === 'pistol' ? 0.55 : 0.85;
  const y = a.pos.y + 1.38 - a.crouch * 0.35;
  return { x: a.pos.x + rx * 0.1 + f.x * gl, y: y + f.y * gl, z: a.pos.z + rz * 0.1 + f.z * gl };
}

/* ---- viewmodel guns (camera space) ---- */
const VM_METAL = hex(0x3a3f49), VM_POLY = hex(0x9c958a), VM_GLOVE = hex(0x4a3f38), VM_SLEEVE = hex(0x2c3a4a);
const GUN_PARTS = {
  sidearm: [[0, 0.02, -0.12, 0.05, 0.06, 0.26, VM_METAL], [0, -0.06, -0.03, 0.045, 0.13, 0.06, VM_POLY, 0.25], [0, 0.056, -0.2, 0.012, 0.012, 0.03, VM_POLY]],
  wasp: [[0, 0, -0.18, 0.07, 0.1, 0.38, VM_METAL], [0, -0.1, -0.25, 0.04, 0.16, 0.05, VM_POLY], [0, -0.07, -0.02, 0.045, 0.12, 0.06, VM_METAL, 0.3], [0, 0.07, -0.18, 0.03, 0.03, 0.12, VM_POLY], [0, 0.0, -0.42, 0.035, 0.035, 0.12, VM_METAL]],
  ranger: [[0, 0, -0.2, 0.07, 0.1, 0.5, VM_METAL], [0, -0.01, -0.53, 0.03, 0.03, 0.3, VM_METAL], [0, -0.03, -0.38, 0.075, 0.08, 0.22, VM_POLY], [0, -0.13, -0.24, 0.045, 0.2, 0.07, VM_METAL, -0.25], [0, -0.03, 0.1, 0.06, 0.1, 0.2, VM_POLY], [0, 0.075, -0.2, 0.03, 0.04, 0.12, VM_METAL], [0.038, 0.0, -0.2, 0.004, 0.02, 0.3, [0.2, 0.9, 0.85, 1]]],
  longbow: [[0, 0, -0.2, 0.07, 0.1, 0.55, VM_METAL], [0, 0.0, -0.7, 0.035, 0.035, 0.5, VM_METAL], [0, 0.1, -0.2, 0.06, 0.06, 0.34, VM_METAL], [0, 0.1, -0.02, 0.07, 0.07, 0.03, VM_POLY], [0, 0.1, -0.37, 0.08, 0.08, 0.03, VM_POLY], [0, -0.03, 0.12, 0.07, 0.12, 0.24, VM_POLY], [0, -0.1, -0.12, 0.04, 0.12, 0.06, VM_METAL]],
};
const MUZZLE = { sidearm: -0.26, wasp: -0.5, ranger: -0.7, longbow: -0.96 };
const VM = { bob: 0, swayX: 0, swayY: 0, kick: 0, lastYaw: 0, lastPitch: 0 };
function camWorld() {
  const p = G.player, e = p.eye(), m = M4.create();
  M4.translate(m, e.x, e.y, e.z); M4.rotateY(m, p.yaw + p.recoil.x * 0.35); M4.rotateX(m, p.pitch + p.recoil.y * 0.4);
  return m;
}
function drawViewmodel(dt) {
  const p = G.player; if (!p.alive || G.scoped) return;
  const base = camWorld();
  const sp = clamp(p.speed / RUN, 0, 1);
  VM.bob += dt * (p.onGround ? 9 * sp : 0);
  const dy = angDiff(VM.lastYaw, p.yaw), dp = p.pitch - VM.lastPitch; VM.lastYaw = p.yaw; VM.lastPitch = p.pitch;
  VM.swayX = clamp(VM.swayX * Math.exp(-dt * 10) + dy * 0.25, -0.05, 0.05);
  VM.swayY = clamp(VM.swayY * Math.exp(-dt * 10) - dp * 0.25, -0.05, 0.05);
  VM.kick *= Math.exp(-dt * 14);
  let reloadK = 0; if (p.reloadT > 0) { const t = 1 - p.reloadT / p.w.reload; reloadK = Math.sin(clamp(t, 0, 1) * Math.PI); }
  const equipK = p.equipT > 0 ? p.equipT / p.w.equip : 0;
  const m = base;
  M4.translate(m, 0.115 + VM.swayX + Math.cos(VM.bob) * 0.012 * sp, -0.105 + VM.swayY - Math.abs(Math.sin(VM.bob)) * 0.014 * sp - reloadK * 0.12 - equipK * 0.25 - p.crouch * 0.01, -0.3 + VM.kick * 0.6);
  M4.rotateX(m, VM.kick * 1.4 - reloadK * 0.5 + equipK * -0.6);
  M4.rotateZ(m, reloadK * 0.5);
  M4.rotateY(m, 0.035);
  M4.scale(m, 0.5, 0.5, 0.5);
  const parts = GUN_PARTS[p.wkey];
  for (const [x, y, z, sx, sy, sz, col, rx] of parts) {
    const mm = M4.copy(M4.create(), m); M4.translate(mm, x, y, z); if (rx) M4.rotateX(mm, rx); M4.scale(mm, sx, sy, sz);
    R.draw(MESH.cube, mm, { color: col, layer: 'vm', shadow: false });
  }
  // hands
  const hand = (x, y, z, sx, sy, sz, col, rx = 0) => { const mm = M4.copy(M4.create(), m); M4.translate(mm, x, y, z); if (rx) M4.rotateX(mm, rx); M4.scale(mm, sx, sy, sz); R.draw(MESH.cube, mm, { color: col, layer: 'vm' }); };
  hand(0.012, -0.1, -0.01, 0.065, 0.075, 0.085, VM_GLOVE);
  hand(0.03, -0.2, 0.06, 0.075, 0.075, 0.2, VM_SLEEVE, 0.9);
  if (p.w.type !== 'pistol') {
    hand(-0.02, -0.06, -0.33, 0.07, 0.06, 0.09, VM_GLOVE);
    hand(-0.09, -0.16, -0.26, 0.075, 0.075, 0.22, VM_SLEEVE, 0.7);
  } else hand(-0.035, -0.085, 0.0, 0.05, 0.07, 0.08, VM_GLOVE);
  if (p.flashT > 0) {
    const mm = M4.copy(M4.create(), m); M4.translate(mm, 0, 0.01, MUZZLE[p.wkey] - 0.03); M4.rotateZ(mm, Math.random() * 6);
    const s = p.w.type === 'smg' ? 0.16 : p.w.type === 'pistol' ? 0.14 : 0.22; M4.scale(mm, s, s, s);
    R.draw(MESH.quad, mm, { tex: TEX.flash, color: [1, 0.85, 0.6, 1], mode: 'add', layer: 'vm' });
    M4.rotateY(mm, Math.PI / 2); R.draw(MESH.quad, mm, { tex: TEX.flash, color: [1, 0.85, 0.6, 0.8], mode: 'add', layer: 'vm' });
  }
}
function playerMuzzleWorld() {
  const m = camWorld(); M4.translate(m, 0.115, -0.1, -0.3 + MUZZLE[G.player.wkey] * 0.5);
  return { x: m[12], y: m[13], z: m[14] };
}

/* ================= FX ================= */
function addTracer(a, b, col = [1, 0.85, 0.5, 0.9]) {
  if (G.tracers.length > 60) G.tracers.shift();
  G.tracers.push({ a, b, t: 0, life: 0.07, col });
}
function addDecal(p, n) {
  if (G.decals.length > 90) G.decals.shift();
  G.decals.push({ p: { x: p.x + n[0] * 0.012, y: p.y + n[1] * 0.012, z: p.z + n[2] * 0.012 }, n, s: rand(0.08, 0.13), r: Math.random() * 6 });
}
function addPuff(p, col, size = 0.35, life = 0.35, vy = 0.8) {
  if (G.fx.length > 150) G.fx.shift();
  G.fx.push({ p: { ...p }, v: { x: rand(-0.5, 0.5), y: vy, z: rand(-0.5, 0.5) }, t: 0, life, size, col, r: Math.random() * 6 });
}
function updateFx(dt) {
  for (const f of G.fx) { f.t += dt; f.p.x += f.v.x * dt; f.p.y += f.v.y * dt; f.p.z += f.v.z * dt; }
  G.fx = G.fx.filter(f => f.t < f.life);
  for (const t of G.tracers) t.t += dt;
  G.tracers = G.tracers.filter(t => t.t < t.life);
}
function drawFx() {
  for (const d of G.decals) {
    const m = M4.identity(_m); M4.translate(m, d.p.x, d.p.y, d.p.z);
    M4.rotateY(m, Math.atan2(d.n[0], d.n[2])); M4.rotateX(m, Math.asin(-d.n[1])); M4.rotateZ(m, d.r); M4.scale(m, d.s, d.s, d.s);
    R.draw(MESH.quad, m, { tex: TEX.hole, color: [1, 1, 1, 0.9], mode: 'alpha', cast: false });
  }
  for (const f of G.fx) {
    const k = f.t / f.life, c = f.col;
    billboard(f.p.x, f.p.y, f.p.z, f.size * (0.6 + k), TEX.glow, [c[0], c[1], c[2], c[3] * (1 - k)], f.add ? 'add' : 'alpha', f.r);
  }
  for (const t of G.tracers) {
    const dx = t.b.x - t.a.x, dy = t.b.y - t.a.y, dz = t.b.z - t.a.z, L = Math.hypot(dx, dy, dz); if (L < 0.1) continue;
    const k = t.t / t.life, seg = Math.min(L, 6), start = (L - seg) * k;
    const d = { x: dx / L, y: dy / L, z: dz / L };
    const m = M4.identity(_m); M4.translate(m, t.a.x + d.x * start, t.a.y + d.y * start, t.a.z + d.z * start); orient(m, d);
    M4.translate(m, 0, 0, -seg / 2); M4.scale(m, 0.018, 0.018, seg);
    R.draw(MESH.cube, m, { color: [t.col[0] * 3, t.col[1] * 3, t.col[2] * 3, t.col[3] * (1 - k * 0.5)], mode: 'add', cast: false });
  }
}

/* ================= CHARGE ================= */
function drawCharge() {
  const C = G.charge; if (C.state === 'none' || C.state === 'carried') return;
  const p = C.pos, t = G.time;
  const pulse = C.state === 'planted' ? 0.5 + 0.5 * Math.sin(t * (6 + (1 - C.timer / CHARGE_TIME) * 20)) : 0.3;
  let m = M4.identity(_m); M4.translate(m, p.x, p.y, p.z); M4.scale(m, 0.5, 0.32, 0.5); R.draw(MESH.cyl, m, { color: hex(0x2c3038) });
  m = M4.identity(_m); M4.translate(m, p.x, p.y + 0.32, p.z); M4.scale(m, 0.36, 0.08, 0.36);
  R.draw(MESH.cyl, m, { color: hex(0xff4655), emis: [2 * pulse, 0.3 * pulse, 0.25 * pulse] });
  m = M4.identity(_m); M4.translate(m, p.x, p.y + 0.12, p.z); M4.scale(m, 0.54, 0.05, 0.54);
  R.draw(MESH.cyl, m, { color: [1, 1, 1, 1], emis: [1.2 * pulse, 0.2, 0.15] });
  if (C.state === 'planted') {
    m = M4.identity(_m); M4.translate(m, p.x, p.y, p.z); M4.scale(m, 0.3, 40, 0.3);
    R.draw(MESH.cyl, m, { color: [1, 0.25, 0.2, 0.08 + 0.12 * pulse], mode: 'add', cast: false });
  }
  billboard(p.x, p.y + 0.5, p.z, 1.2 + pulse * 0.5, TEX.glow, [1, 0.3, 0.2, 0.5 * pulse + 0.2], 'add');
}
function updateCharge(dt) {
  const C = G.charge;
  if (C.state === 'carried' && C.carrier && !C.carrier.alive) dropCharge();
  if (C.state === 'dropped') {
    for (const a of G.agents) if (a.alive && sideOf(a.team) === 'atk' && dist2(a.pos, C.pos) < 1.3 && Math.abs(a.pos.y - C.pos.y) < 1.5) {
      C.state = 'carried'; C.carrier = a;
      if (a.isPlayer) toast('You picked up the Charge');
      break;
    }
  }
  if (C.state === 'planted' && (G.phase === 'planted')) {
    C.timer -= dt; C.beep -= dt;
    if (C.beep <= 0) { Snd.beep(C.pos); C.beep = C.timer > 20 ? 1 : C.timer > 10 ? 0.5 : C.timer > 4 ? 0.25 : 0.12; }
    if (C.timer <= 0) detonate();
  }
}
function dropCharge() {
  const C = G.charge, a = C.carrier;
  C.state = 'dropped'; C.carrier = null;
  C.pos = { x: a.pos.x, y: groundAt(a.pos.x, a.pos.z, a.pos.y + 0.1, 0.1), z: a.pos.z };
  if (a.isPlayer || a.team === G.player.team) feedMsg('Charge dropped', COL.ally);
}
function detonate() {
  const C = G.charge; C.state = 'none';
  Snd.boom(C.pos);
  for (let i = 0; i < 40; i++) {
    G.fx.push({ p: { x: C.pos.x, y: C.pos.y + 1, z: C.pos.z }, v: { x: rand(-14, 14), y: rand(2, 16), z: rand(-14, 14) }, t: 0, life: rand(0.8, 1.6), size: rand(3, 7), col: [1, rand(0.3, 0.6), 0.15, 1], add: true, r: 0 });
  }
  G.shake = 1.2;
  for (const a of G.agents) if (a.alive && dist3(a.pos, C.pos) < 22) { a.alive = false; a.hp = 0; a.deadT = 0; a.deaths++; }
  endRound('atk', 'Charge detonated');
}

/* ================= COMBAT ================= */
function dmgFor(w, part, dist) {
  let d = w.dmg[part];
  if (dist > w.fall[0]) d *= w.fall[1];
  return d;
}
function applyDamage(victim, attacker, amount, part, weaponKey) {
  if (!victim.alive || G.phase === 'end' || G.phase === 'over') return;
  const absorbed = Math.min(victim.armor, amount * 0.66);
  victim.armor -= absorbed; victim.hp -= amount - absorbed;
  victim.hitFlash = 0.08;
  if (!victim.isPlayer && victim.ai) {
    victim.ai.alert = { x: attacker.pos.x, z: attacker.pos.z, t: G.time };
    if (!victim.ai.target && los(victim.eye(), attacker.eye())) acquire(victim, attacker);
  }
  if (victim.isPlayer) {
    G.dmgFlash = Math.min(1, (G.dmgFlash || 0) + amount / 80);
    G.dmgDir = { yaw: yawTo(attacker.pos.x - victim.pos.x, attacker.pos.z - victim.pos.z), t: 1.2 };
    G.aimPunch = 0.02;
  }
  if (victim.hp <= 0) kill(victim, attacker, part === 0, weaponKey);
}
function kill(v, k, head, wk) {
  v.alive = false; v.hp = 0; v.deadT = 0; v.deaths++; v.action = null;
  if (k && k !== v) { k.kills++; k.credits = Math.min(9000, k.credits + 200); }
  pushFeed(k, v, WEAPONS[wk].name, head);
  if (G.charge.carrier === v) dropCharge();
  if (v.isPlayer) {
    G.scoped = false; G.deathCam = { t: 0, killer: k };
    G.spec = 0;
    if (k) toast(`Killed by ${k.name}${head ? ' (headshot)' : ''}`);
  }
  if (k && k.isPlayer) { Snd.tone(null, { f: 900, f2: 1400, dur: 0.18, gain: 0.25, type: 'triangle' }); showKillBanner(head); }
  checkRoundEnd();
}
function aliveOn(side) { return G.agents.filter(a => a.alive && sideOf(a.team) === side); }
function checkRoundEnd() {
  if (G.phase !== 'live' && G.phase !== 'planted') return;
  const atk = aliveOn('atk').length, def = aliveOn('def').length;
  if (def === 0) return endRound('atk', 'Defenders eliminated');
  if (atk === 0 && G.phase === 'live') return endRound('def', 'Attackers eliminated');
}
function fireWeapon(a, dir, isPlayer) {
  const w = a.w, am = a.ammo[a.wkey];
  am.mag--; a.lastShot = G.time; a.shots++; a.flashT = 0.05;
  a.nextFire = G.time + 1 / w.rate;
  Snd.shot(w.type, isPlayer ? null : a.pos, isPlayer);
}
function playerShoot() {
  const p = G.player, w = p.w;
  // spread
  const sp = clamp(p.speed / RUN, 0, 1);
  let spread = (G.scoped ? (w.scoped || 0) : w.spread) + w.move * clamp((sp - 0.2) / 0.8, 0, 1);
  if (!p.onGround) spread += w.air;
  if (p.crouch > 0.5) spread *= 0.75;
  if (w.auto) spread += Math.min(p.shots, 10) * 0.0012;
  const yaw = p.yaw + p.recoil.x, pitch = p.pitch + p.recoil.y;
  const ang = Math.random() * Math.PI * 2, rr = spread * Math.sqrt(Math.random());
  const d = fwd(yaw + Math.cos(ang) * rr, pitch + Math.sin(ang) * rr);
  const o = p.eye();
  fireWeapon(p, d, true);
  VM.kick += w.type === 'sniper' ? 0.12 : 0.035;
  // recoil after the shot (first bullet accurate)
  if (p.shots > 2 || w.type !== 'rifle') p.recoil.y = Math.min(w.kickMax, p.recoil.y + w.kick * (p.shots < 3 ? 0.7 : 1));
  else p.recoil.y = Math.min(w.kickMax, p.recoil.y + w.kick * 0.5);
  if (p.recoil.y >= w.kickMax * 0.95) p.recoil.x = clamp(p.recoil.x + (Math.random() < 0.5 ? -1 : 1) * w.sway * rand(0.3, 1), -w.sway * 3, w.sway * 3);
  if (w.type === 'sniper') { G.scoped = false; }
  // trace
  const wall = rayGrid(o, d, 200);
  let best = null, target = null;
  for (const a of G.agents) {
    if (!a.alive || a.team === p.team) continue;
    const h = rayAgent(o, d, a, wall.t);
    if (h && (!best || h.t < best.t)) { best = h; target = a; }
  }
  const muz = playerMuzzleWorld();
  if (target) {
    const hp = { x: o.x + d.x * best.t, y: o.y + d.y * best.t, z: o.z + d.z * best.t };
    applyDamage(target, p, dmgFor(w, best.part, best.t), best.part, p.wkey);
    Snd.hit(best.part === 0);
    hitMarker(best.part === 0, !target.alive);
    for (let i = 0; i < 4; i++) addPuff(hp, [1, 0.25, 0.25, 0.8], 0.25, 0.3, rand(-0.5, 1));
    addTracer(muz, hp);
  } else {
    const hp = { x: o.x + d.x * wall.t, y: o.y + d.y * wall.t, z: o.z + d.z * wall.t };
    if (wall.n) { addDecal(hp, wall.n); for (let i = 0; i < 2; i++) addPuff(hp, [0.85, 0.8, 0.72, 0.6], 0.35, 0.4); if (wall.t < 60) Snd.impact(hp); }
    addTracer(muz, hp);
  }
}
function botShoot(b, t) {
  const w = b.w, d = dist3(b.pos, t.pos);
  const eye = b.eye();
  // hit probability
  let p = G.diff.acc * w.botAcc;
  p *= clamp(1.25 - d / 55, 0.3, 1.1);
  if (w.type === 'smg' && d > 20) p *= 0.65;
  if (w.type === 'pistol' && d > 25) p *= 0.7;
  if (t.speed > 3.5) p *= 0.72;
  if (t.crouch > 0.5) p *= 0.9;
  if (b.speed > 1.5) p *= 0.55;
  if (b.shots > 4 && w.auto) p *= 0.75;
  if (w.type === 'sniper') p = Math.min(0.85, p * 1.3);
  const aimT = t.chest();
  fireWeapon(b, null, false);
  if (Math.random() < p) {
    const r = Math.random(), part = r < G.diff.head * (w.type === 'sniper' ? 0.5 : 1) ? 0 : r < 0.88 ? 1 : 2;
    const hp = part === 0 ? t.eye() : part === 1 ? aimT : { x: t.pos.x, y: t.pos.y + 0.5, z: t.pos.z };
    applyDamage(t, b, dmgFor(w, part, d), part, b.wkey);
    addPuff(hp, [1, 0.25, 0.25, 0.8], 0.25, 0.3, 0.3);
    addTracer(agentMuzzle(b), hp);
    if (t.isPlayer && part === 0) Snd.tone(null, { f: 300, dur: 0.1, gain: 0.3, type: 'sawtooth' });
  } else {
    const miss = { x: aimT.x + rand(-1.2, 1.2), y: aimT.y + rand(-0.6, 1.0), z: aimT.z + rand(-1.2, 1.2) };
    const dx = miss.x - eye.x, dy = miss.y - eye.y, dz = miss.z - eye.z, L = Math.hypot(dx, dy, dz);
    const dir = { x: dx / L, y: dy / L, z: dz / L }, wall = rayGrid(eye, dir, 150);
    const hp = { x: eye.x + dir.x * wall.t, y: eye.y + dir.y * wall.t, z: eye.z + dir.z * wall.t };
    if (wall.n) addDecal(hp, wall.n);
    addTracer(agentMuzzle(b), hp);
    if (t.isPlayer && dist3(hp, t.eye()) < 3) Snd.burst(hp, { gain: 0.15, dur: 0.06, freq: 5000, type: 'highpass' });
  }
}
function startReload(a) {
  const am = a.ammo[a.wkey], w = a.w;
  if (a.reloadT > 0 || am.mag >= w.mag || am.res <= 0) return;
  a.reloadT = w.reload; if (a.isPlayer) { Snd.reload(); G.scoped = false; }
}
function updateWeapon(a, dt) {
  if (a.equipT > 0) a.equipT -= dt;
  if (a.flashT > 0) a.flashT -= dt;
  if (a.reloadT > 0) {
    a.reloadT -= dt;
    if (a.reloadT <= 0) {
      const am = a.ammo[a.wkey], need = a.w.mag - am.mag, take = Math.min(need, am.res);
      am.mag += take; if (a.isPlayer) am.res -= take; a.reloadT = 0; if (a.isPlayer) Snd.reload();
    }
  }
  // recoil recovery
  if (G.time - a.lastShot > 1 / a.w.rate + 0.06) {
    const k = Math.exp(-dt * 7);
    a.recoil.y *= k; a.recoil.x *= k;
    if (a.recoil.y < 0.004) a.shots = 0;
  }
}

/* ================= BOT AI ================= */
function acquire(b, t) {
  const ai = b.ai;
  if (ai.target !== t) { ai.target = t; ai.react = G.time + rand(G.diff.react[0], G.diff.react[1]); ai.burst = 0; }
  ai.lastSeen = G.time; ai.lastPos = { ...t.pos };
}
function setGoal(b, c, r) {
  const ai = b.ai; const sc = cellOf(b.pos.x), sr = cellOf(b.pos.z);
  if (ai.goal && ai.goal[0] === c && ai.goal[1] === r && ai.path) return;
  ai.goal = [c, r]; ai.path = findPath(sc, sr, c, r) || []; ai.pi = 0; ai.stuckT = 0; ai.stuckPos = { ...b.pos };
}
function atGoal(b) { const g = b.ai.goal; if (!g) return true; const p = cc(g[0], g[1]); return Math.hypot(b.pos.x - p.x, b.pos.z - p.z) < 0.9; }
function followPath(b, dt, speed) {
  const ai = b.ai; if (!ai.path || ai.pi >= ai.path.length) { return false; }
  // smoothing: skip ahead while there's a clear line
  for (let k = 0; k < 3 && ai.pi + 1 < ai.path.length; k++) {
    const n = cc(...ai.path[ai.pi + 1]); if (clearLine(b.pos.x, b.pos.z, n.x, n.z, b.pos.y)) ai.pi++; else break;
  }
  const n = cc(...ai.path[ai.pi]);
  const dx = n.x - b.pos.x, dz = n.z - b.pos.z, L = Math.hypot(dx, dz);
  if (L < 0.5) { ai.pi++; return true; }
  // hop over low barriers / onto ledges on the path
  const nh = hAt(ai.path[ai.pi][0], ai.path[ai.pi][1]);
  if (nh > b.pos.y + STEP && b.onGround && L < CELL * 1.6 + 0.5) { b.vel.y = JUMP_V; b.onGround = false; b.pos.y += 0.01; }
  const vx = dx / L * speed, vz = dz / L * speed;
  b.vel.x += (vx - b.vel.x) * Math.min(1, dt * 10); b.vel.z += (vz - b.vel.z) * Math.min(1, dt * 10);
  ai.moveYaw = yawTo(dx, dz);
  // stuck detection
  ai.stuckT += dt;
  if (ai.stuckT > 1.2) {
    if (dist2(b.pos, ai.stuckPos) < 0.4) { const g = ai.goal; ai.goal = null; ai.path = null; if (g) setGoal(b, g[0], g[1]); b.vel.x += rand(-3, 3); b.vel.z += rand(-3, 3); }
    ai.stuckT = 0; ai.stuckPos = { ...b.pos };
  }
  return true;
}
function botBuy(b) {
  const r = G.round, firstOfHalf = r === 1 || r === HALF + 1;
  if (!b.primary) {
    if (b.credits >= 4700 + 1000 && Math.random() < 0.18) buyItem(b, 'longbow');
    else if (b.credits >= 2900 + 400) buyItem(b, 'ranger');
    else if (!firstOfHalf && b.credits >= 1600 + 400 && Math.random() < 0.7) buyItem(b, 'wasp');
  }
  if (b.credits >= 1000 && b.armor < 50 && (b.primary || b.credits > 2500)) buyItem(b, 'heavy');
  else if (b.credits >= 400 && b.armor < 25 && (firstOfHalf ? Math.random() < 0.5 : true)) buyItem(b, 'light');
  b.equip(b.primary ? 'primary' : 'secondary'); b.equipT = 0;
}
function planBot(b, idx, teamBots) {
  const ai = b.ai = { goal: null, path: null, pi: 0, target: null, react: 0, lastSeen: -9, burst: 0, pauseT: 0, lookYaw: b.yaw, lookT: 0,
    hold: false, strafe: 0, strafeT: 0, alert: null, route: [], moveYaw: b.yaw, stuckT: 0, stuckPos: { ...b.pos }, delay: rand(0, 2.5), assigned: null };
  const side = sideOf(b.team);
  if (side === 'atk') {
    const site = G.atkSite, viaMid = Math.random() < 0.35;
    if (CUSTOM) ai.route = viaMid ? [POI.mid] : [];
    else {
      const lobby = site === 'A' ? POI.aLobby : POI.bLobby, main = site === 'A' ? POI.aMain : POI.bMain, link = site === 'A' ? POI.aLink : POI.bLink;
      ai.route = viaMid ? [POI.mid, POI.midTop, link] : [lobby, main];
    }
    ai.route.push(pick(SITE_CELLS[site]));
    ai.site = site;
  } else {
    let site;
    if (teamBots === 1) site = Math.random() < 0.5 ? 'A' : 'B';
    else if (teamBots >= 5 && idx === 4) site = 'mid';
    else site = idx % 2 === 0 ? 'A' : 'B';
    ai.assigned = site;
    ai.route = site === 'mid' ? [POI.midTop] : [pick(SITE_CELLS[site])];
    ai.delay = rand(0, 1.2);
  }
}
function botUpdate(b, dt) {
  const ai = b.ai; if (!ai) return;
  const side = sideOf(b.team), C = G.charge;
  const buy = G.phase === 'buy', live = G.phase === 'live' || G.phase === 'planted';
  let speed = 0, wantYaw = null, wantPitch = 0;
  // ---- perception ----
  ai.perceive = (ai.perceive || 0) - dt;
  if (ai.perceive <= 0 && live) {
    ai.perceive = 0.12;
    const eye = b.eye(); let best = null, bd = 1e9;
    for (const e of G.agents) {
      if (!e.alive || e.team === b.team) continue;
      const d = dist3(b.pos, e.pos); if (d > 80) continue;
      const toYaw = yawTo(e.pos.x - b.pos.x, e.pos.z - b.pos.z);
      const inFov = Math.abs(angDiff(b.yaw, toYaw)) < 1.2 || d < 4 || ai.target === e;
      if (!inFov) continue;
      if (los(eye, e.eye()) || los(eye, e.chest())) { if (d < bd) { bd = d; best = e; } }
    }
    if (best) {
      acquire(b, best);
      if (b.team === G.player.team) best.spotted = G.time + 1.2;
      // callout: teammates rotate toward seen enemy's site
      if (side === 'def' && G.phase === 'live') for (const s of ['A', 'B']) if (inSet(s, best.pos.x, best.pos.z)) G.callout = { site: s, t: G.time, team: b.team };
    } else if (ai.target && G.time - ai.lastSeen > 0.3) { ai.visible = false; }
    ai.visible = !!best && best === ai.target;
  }
  if (ai.target && (!ai.target.alive || G.time - ai.lastSeen > 2.5)) { ai.target = null; ai.visible = false; }

  // ---- actions (plant / defuse) ----
  if (b.action) {
    if (ai.visible || !live) b.action = null;
    else {
      b.action.t += dt; b.vel.x *= 0.5; b.vel.z *= 0.5;
      if (b.action.type === 'plant' && b.action.t >= PLANT_TIME) doPlant(b);
      else if (b.action.type === 'defuse' && b.action.t >= DEFUSE_TIME) doDefuse(b);
      integrate(b, dt, 0); return;
    }
  }

  // only duel inside the weapon's effective range (or when being shot at)
  let fighting = !!(ai.target && ai.visible && live);
  if (fighting) {
    const d = dist3(b.pos, ai.target.pos), range = { pistol: 30, smg: 34, rifle: 70, sniper: 90 }[b.w.type];
    const underFire = ai.alert && G.time - ai.alert.t < 2.5;
    const mustAct = (G.charge.state === 'planted' && sideOf(b.team) === 'def') || b.action;
    if (d > range && !underFire) fighting = false;
    if (mustAct && d > 25 && !underFire) fighting = false;
  }
  if (fighting) {
    // ---- combat ----
    const t = ai.target, tp = t.chest(), e = b.eye();
    wantYaw = yawTo(tp.x - e.x, tp.z - e.z);
    wantPitch = Math.atan2(tp.y - e.y, Math.hypot(tp.x - e.x, tp.z - e.z));
    ai.strafeT -= dt;
    if (ai.strafeT <= 0) { ai.strafe = Math.random() < 0.45 ? (Math.random() < 0.5 ? -1 : 1) : 0; ai.strafeT = rand(0.3, 0.8); }
    const aimed = Math.abs(angDiff(b.yaw, wantYaw)) < 0.12;
    if (ai.strafe && !(G.time > ai.react && aimed && ai.pauseT <= 0)) {
      const rx = Math.cos(b.yaw), rz = -Math.sin(b.yaw);
      b.vel.x += (rx * ai.strafe * 4 - b.vel.x) * Math.min(1, dt * 12); b.vel.z += (rz * ai.strafe * 4 - b.vel.z) * Math.min(1, dt * 12);
    } else { b.vel.x *= Math.exp(-dt * 16); b.vel.z *= Math.exp(-dt * 16); }
    ai.pauseT -= dt;
    const am = b.ammo[b.wkey];
    if (am.mag <= 0) { if (am.res > 0) startReload(b); else if (b.slot === 'primary') b.equip('secondary'); }
    else if (G.time > ai.react && aimed && ai.pauseT <= 0 && b.equipT <= 0 && b.reloadT <= 0 && G.time >= b.nextFire) {
      botShoot(b, t); ai.burst++;
      const w = b.w;
      if (w.auto && ai.burst >= (dist3(b.pos, t.pos) > 20 ? 3 : 6)) { ai.burst = 0; ai.pauseT = rand(0.18, 0.4); }
      if (!w.auto) ai.pauseT = w.type === 'sniper' ? 0 : rand(0.12, 0.3);
    }
  } else if (live || buy) {
    // ---- objective movement ----
    if (!buy && ai.delay > 0) ai.delay -= dt;
    const moving = !buy && ai.delay <= 0;
    if (ai.target && ai.visible && !speed && ai.lastPos) {
      wantYaw = yawTo(ai.lastPos.x - b.pos.x, ai.lastPos.z - b.pos.z);
    } else if (ai.target && ai.lastPos && !ai.visible && G.time - ai.lastSeen < 2.5) {
      wantYaw = yawTo(ai.lastPos.x - b.pos.x, ai.lastPos.z - b.pos.z);
    } else if (ai.alert && G.time - ai.alert.t < 2) {
      wantYaw = yawTo(ai.alert.x - b.pos.x, ai.alert.z - b.pos.z);
    }
    if (moving) {
      let dest = null;
      if (side === 'atk') {
        if (C.state === 'dropped' && isPicker(b)) dest = [cellOf(C.pos.x), cellOf(C.pos.z)];
        else if (C.state === 'carried' && C.carrier === b) {
          if (inSet(ai.site, b.pos.x, b.pos.z) && roomy(cellOf(b.pos.x), cellOf(b.pos.z)) && G.phase === 'live') {
            b.action = { type: 'plant', t: 0 }; b.vel.x = b.vel.z = 0;
          } else dest = ai.route.length ? ai.route[0] : pick(SITE_CELLS[ai.site]);
        } else if (C.state === 'planted') {
          if (!ai.postPlant) { ai.postPlant = true; ai.route = [nearCell(C.pos, 5)]; ai.hold = false; }
          dest = ai.route[0];
        } else dest = ai.route[0];
      } else {
        if (C.state === 'planted') {
          const dc = dist2(b.pos, C.pos);
          if (dc < 1.1) { b.action = { type: 'defuse', t: 0 }; b.vel.x = b.vel.z = 0; }
          else dest = [cellOf(C.pos.x), cellOf(C.pos.z)];
          ai.hold = false;
        } else {
          if (G.callout && G.callout.team === b.team && G.time - G.callout.t < 1 && ai.assigned !== G.callout.site && !ai.rotated && Math.random() < 0.6) {
            ai.rotated = true; ai.assigned = G.callout.site; ai.route = [pick(SITE_CELLS[G.callout.site])]; ai.hold = false;
          }
          dest = ai.route[0];
        }
      }
      if (dest && !b.action) {
        if (C.state === 'planted' && side === 'def' && dist2(b.pos, C.pos) < 3) {
          // final approach straight to the charge
          const dx = C.pos.x - b.pos.x, dz = C.pos.z - b.pos.z, L = Math.hypot(dx, dz);
          b.vel.x = dx / L * 3; b.vel.z = dz / L * 3; ai.moveYaw = yawTo(dx, dz);
        } else {
          setGoal(b, dest[0], dest[1]);
          if (atGoal(b) || !ai.path || !ai.path.length) {
            if (ai.route.length > 1) { ai.route.shift(); ai.goal = null; }
            else {
              ai.hold = true;
              // attackers wander the site a bit; defenders hold
              if (side === 'atk' && C.state !== 'planted' && Math.random() < dt * 0.15) { ai.route = [pick(SITE_CELLS[ai.site])]; ai.goal = null; ai.hold = false; }
            }
          }
          if (!ai.hold) speed = C.carrier === b ? RUN * 0.9 : RUN * 0.92;
          if (!ai.hold && !followPath(b, dt, speed)) speed = 0;
        }
      }
    }
    if (!speed && !(C.state === 'planted' && side === 'def' && dist2(b.pos, C.pos) < 3)) { b.vel.x *= Math.exp(-dt * 12); b.vel.z *= Math.exp(-dt * 12); }
    if (wantYaw === null) {
      if (speed > 0) wantYaw = ai.moveYaw;
      else {
        ai.lookT -= dt;
        if (ai.lookT <= 0) {
          ai.lookT = rand(1.5, 3.5);
          let tgt = null;
          if (side === 'def' && ai.assigned && ENTRIES[ai.assigned]) tgt = pick(ENTRIES[ai.assigned]);
          else if (side === 'atk' && ai.site) tgt = pick(ENTRIES[ai.site]);
          if (tgt) { const p = cc(tgt[0], tgt[1]); ai.lookYaw = yawTo(p.x - b.pos.x, p.z - b.pos.z) + rand(-0.3, 0.3); }
          else ai.lookYaw = b.yaw + rand(-1, 1);
        }
        wantYaw = ai.lookYaw;
      }
    }
    if (b.slot === 'primary' || b.primary) { const am = b.ammo[b.wkey]; if (am.mag < b.w.mag * 0.4 && am.res > 0) startReload(b); }
  }
  // ---- turn ----
  if (wantYaw !== null) {
    const turn = G.diff.turn * dt * (ai.visible ? 1.3 : 0.8);
    const d = angDiff(b.yaw, wantYaw); b.yaw += clamp(d, -turn, turn);
  }
  b.pitch += (wantPitch - b.pitch) * Math.min(1, dt * 8);
  integrate(b, dt);
}
function isPicker(b) {
  const C = G.charge; let best = null, bd = 1e9;
  for (const a of G.agents) if (a.alive && !a.isPlayer && sideOf(a.team) === 'atk') { const d = dist2(a.pos, C.pos); if (d < bd) { bd = d; best = a; } }
  return best === b;
}
function nearCell(p, rad) {
  const c0 = cellOf(p.x), r0 = cellOf(p.z), out = [];
  for (let r = r0 - 2; r <= r0 + 2; r++) for (let c = c0 - 2; c <= c0 + 2; c++) if (roomy(c, r) && Math.hypot(c - c0, r - r0) > 0.9) {
    const q = cc(c, r); if (los({ x: q.x, y: hAt(c, r) + 1.5, z: q.z }, { x: p.x, y: p.y + 0.4, z: p.z })) out.push([c, r]);
  }
  return out.length ? pick(out) : [c0, r0];
}
function integrate(a, dt) {
  // gravity + ground
  const g = groundAt(a.pos.x, a.pos.z, a.pos.y);
  if (a.pos.y > g + 0.001 || a.vel.y > 0) {
    a.vel.y -= GRAV * dt; a.pos.y += a.vel.y * dt;
    if (a.pos.y <= g) { a.pos.y = g; a.vel.y = 0; if (!a.onGround && a.isPlayer) Snd.step(null, true); a.onGround = true; } else a.onGround = false;
  } else { a.pos.y = g; a.vel.y = 0; a.onGround = true; }
  a.bumped = false;
  const px = a.pos.x, pz = a.pos.z;
  moveXZ(a, a.vel.x * dt, a.vel.z * dt);
  // buy-phase barrier: stay inside your spawn zone
  if (G.phase === 'buy') {
    const key = sideOf(a.team) === 'atk' ? 'T' : 'D';
    if (!inSet(key, a.pos.x, a.pos.z) && inSet(key, px, pz)) { a.pos.x = px; a.pos.z = pz; a.vel.x = a.vel.z = 0; }
  }
  const sp = a.speed;
  if (a.onGround && sp > 0.5) {
    a.walkPhase += dt * sp * 1.6;
    a.stepT -= dt * sp;
    if (a.stepT <= 0) { a.stepT = 2.3; if (sp > 4.5 && !a.isPlayer) Snd.step(a.pos, false); else if (a.isPlayer && sp > 4.5) Snd.step(null, true); }
  }
  if (a.hitFlash > 0) a.hitFlash -= dt;
  updateWeapon(a, dt);
}
function separate() {
  const al = G.agents.filter(a => a.alive);
  for (let i = 0; i < al.length; i++) for (let j = i + 1; j < al.length; j++) {
    const a = al[i], b = al[j], dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.7 && d > 0.0001 && Math.abs(a.pos.y - b.pos.y) < 1.5) {
      const push = (0.7 - d) / 2, nx = dx / d * push, nz = dz / d * push;
      moveXZ(a, -nx, -nz); moveXZ(b, nx, nz);
    }
  }
}

/* ================= PLANT / DEFUSE ================= */
function canPlant(a) {
  const C = G.charge;
  if (G.phase !== 'live' || C.state !== 'carried' || C.carrier !== a || !a.onGround) return null;
  for (const s of ['A', 'B']) if (inSet(s, a.pos.x, a.pos.z)) return s;
  return null;
}
function canDefuse(a) {
  const C = G.charge;
  return G.phase === 'planted' && C.state === 'planted' && sideOf(a.team) === 'def' && a.onGround && dist2(a.pos, C.pos) < 1.8;
}
function doPlant(a) {
  const C = G.charge; a.action = null;
  let site = null; for (const s of ['A', 'B']) if (inSet(s, a.pos.x, a.pos.z)) site = s;
  C.state = 'planted'; C.carrier = null; C.site = site; C.timer = CHARGE_TIME; C.beep = 0;
  C.pos = { x: a.pos.x, y: a.pos.y, z: a.pos.z };
  C.defuseHalf = false;
  G.phase = 'planted';
  for (const x of G.agents) if (sideOf(x.team) === 'atk') x.credits = Math.min(9000, x.credits + 300);
  announce('CHARGE PLANTED', `Site ${site}`, COL.enemy, 2);
  Snd.announce(true);
  // all attackers now defend the charge; defenders retake
  for (const b of G.agents) if (b.ai) { b.ai.goal = null; b.ai.postPlant = false; }
}
function doDefuse(a) {
  a.action = null; G.charge.state = 'none';
  endRound('def', `Charge defused by ${a.name}`);
}

/* ================= ROUNDS & ECONOMY ================= */
function buyItem(a, key) {
  if (G.phase !== 'buy') return false;
  if (ARMOR[key]) {
    const it = ARMOR[key]; if (a.credits < it.price || a.armor >= it.value) return false;
    a.credits -= it.price; a.armor = it.value; return true;
  }
  const w = WEAPONS[key]; if (!w) return false;
  const owned = w.slot === 'primary' ? a.primary === key : a.secondary === key;
  if (owned || a.credits < w.price) return false;
  a.credits -= w.price; a.give(key); a.equipT = 0.2; return true;
}
function spawnTeam(side) {
  const cells = shuffle(SPAWN_CELLS[side].slice());
  const members = G.agents.filter(a => sideOf(a.team) === side);
  members.forEach((a, i) => {
    const [c, r] = cells[i % cells.length], p = cc(c, r);
    const j = CELL > 2 ? 0.6 : 0; a.pos = { x: p.x + rand(-j, j), y: hAt(c, r), z: p.z + rand(-j, j) };
    a.vel = { x: 0, y: 0, z: 0 };
    a.yaw = side === 'atk' ? 0 : Math.PI; a.pitch = 0;
    if (CUSTOM) { const m = cc(...POI.mid); a.yaw = yawTo(m.x - a.pos.x, m.z - a.pos.z); }
  });
}
function startMatch(teamSize, diffName) {
  G.teamSize = teamSize; G.diff = DIFF[diffName]; G.diffName = diffName;
  G.agents = []; G.score = [0, 0]; G.lossStreak = [0, 0]; G.round = 0; G.over = false; G.time = 0;
  const names = shuffle(BOT_NAMES.slice());
  const p = new Agent('You', 0, true); G.player = p; G.agents.push(p);
  for (let i = 1; i < teamSize; i++) G.agents.push(new Agent(names.pop(), 0));
  for (let i = 0; i < teamSize; i++) G.agents.push(new Agent(names.pop(), 1));
  G.running = true; G.paused = false;
  $('menu').classList.add('hidden'); $('gameover').classList.add('hidden'); $('hud').classList.remove('hidden');
  startRound();
  lockPointer();
}
function startRound() {
  G.round++;
  if (G.round === HALF + 1) {
    for (const a of G.agents) { a.credits = 800; a.primary = null; a.secondary = 'sidearm'; a.armor = 0; a.slot = 'secondary'; a.alive = false; }
    G.lossStreak = [0, 0];
    announce('HALFTIME', 'Sides swapped', '#fff', 2.5);
  }
  G.phase = 'buy'; G.timer = (G.round === 1 || G.round === HALF + 1) ? FIRST_BUY : BUY_TIME;
  G.atkSite = Math.random() < 0.5 ? 'A' : 'B';
  G.decals = []; G.fx = []; G.tracers = []; G.callout = null;
  for (const a of G.agents) {
    if (!a.alive) { a.primary = null; a.secondary = 'sidearm'; a.armor = 0; a.slot = 'secondary'; }
    a.alive = true; a.hp = 100; a.deadT = 0; a.action = null; a.reloadT = 0; a.equipT = 0; a.recoil = { x: 0, y: 0 }; a.shots = 0; a.crouch = 0;
    a.refill(); if (a.primary) a.slot = 'primary';
    a.spotted = -9;
  }
  spawnTeam('atk'); spawnTeam('def');
  // charge to an attacker (player gets it if attacking)
  const atks = G.agents.filter(a => sideOf(a.team) === 'atk');
  const C = G.charge; C.state = 'carried'; C.carrier = atks.find(a => a.isPlayer) || pick(atks); C.timer = 0;
  for (const side of ['atk', 'def']) {
    const bots = G.agents.filter(a => !a.isPlayer && sideOf(a.team) === side);
    bots.forEach((b, i) => { botBuy(b); planBot(b, i, bots.length); });
  }
  G.scoped = false; G.deathCam = null; G.spec = 0;
  const side = sideOf(G.player.team);
  announce(`ROUND ${G.round}`, side === 'atk' ? 'ATTACK — plant the Charge' : 'DEFEND — stop the plant', side === 'atk' ? COL.enemy : COL.ally, 2.2);
  Snd.announce(true);
  if (side === 'atk') toast('You carry the Charge. Get to site A or B and hold F to plant.');
}
function endRound(winSide, reason) {
  if (G.phase === 'end' || G.phase === 'over') return;
  G.phase = 'end'; G.timer = END_TIME;
  const wt = teamOfSide(winSide), lt = 1 - wt;
  G.score[wt]++;
  G.lossStreak[wt] = 0; G.lossStreak[lt]++;
  for (const a of G.agents) {
    if (a.team === wt) a.credits += 3000;
    else a.credits += 1900 + 500 * Math.min(2, G.lossStreak[lt] - 1);
    a.credits = Math.min(9000, a.credits);
    a.action = null;
  }
  const won = wt === G.player.team;
  announce(won ? 'ROUND WON' : 'ROUND LOST', reason, won ? COL.ally : COL.enemy, 3);
  Snd.announce(won);
  G.scoped = false;
  if (G.score[wt] >= WIN_ROUNDS) G.pendingOver = true;
}
function gameOver() {
  G.phase = 'over'; G.running = false; G.over = true;
  document.exitPointerLock && document.exitPointerLock();
  const won = G.score[G.player.team] > G.score[1 - G.player.team];
  const p = G.player;
  $('goTitle').textContent = won ? 'VICTORY' : 'DEFEAT';
  $('goTitle').style.color = won ? '#35d6c5' : '#ff4655';
  $('goScore').textContent = `${G.score[p.team]} — ${G.score[1 - p.team]}`;
  $('goStats').textContent = `Your K/D: ${p.kills} / ${p.deaths}`;
  $('hud').classList.add('hidden'); $('gameover').classList.remove('hidden');
}
function updatePhase(dt) {
  G.timer -= dt;
  if (G.phase === 'buy' && G.timer <= 0) {
    G.phase = 'live'; G.timer = ROUND_TIME; closeBuy(false);
    announce('GO', '', '#fff', 0.8);
  } else if (G.phase === 'live' && G.timer <= 0) {
    endRound('def', 'Time expired');
  } else if (G.phase === 'end' && G.timer <= 0) {
    if (G.pendingOver) { G.pendingOver = false; gameOver(); }
    else startRound();
  }
}

/* ================= PLAYER ================= */
const keys = {};
let mouseDown = false, fireLatch = false;
function playerUpdate(dt) {
  const p = G.player;
  if (!p.alive) { p.deadT += dt; if (G.deathCam) G.deathCam.t += dt; return; }
  const canAct = G.phase !== 'end' && G.phase !== 'over';
  // crouch
  const crouching = !!(keys.ControlLeft || keys.KeyC || keys.ControlRight);
  p.crouch += ((crouching ? 1 : 0) - p.crouch) * Math.min(1, dt * 12);
  // move
  let mx = 0, mz = 0;
  if (!G.buyOpen && canAct && !p.action) {
    if (keys.KeyW) mz += 1; if (keys.KeyS) mz -= 1; if (keys.KeyD) mx += 1; if (keys.KeyA) mx -= 1;
  }
  const f = { x: -Math.sin(p.yaw), z: -Math.cos(p.yaw) }, r = { x: Math.cos(p.yaw), z: -Math.sin(p.yaw) };
  let wx = f.x * mz + r.x * mx, wz = f.z * mz + r.z * mx; const wl = Math.hypot(wx, wz); if (wl > 0) { wx /= wl; wz /= wl; }
  let spd = RUN; if (keys.ShiftLeft || keys.ShiftRight) spd = WALK_SPD; if (p.crouch > 0.5) spd = CROUCH_SPD;
  if (G.scoped) spd = Math.min(spd, RUN * 0.6);
  if (p.primary && p.slot === 'primary' && p.w.type === 'sniper') spd *= 0.93;
  const accel = p.onGround ? 14 : 2;
  p.vel.x += (wx * spd - p.vel.x) * Math.min(1, dt * accel);
  p.vel.z += (wz * spd - p.vel.z) * Math.min(1, dt * accel);
  if (keys.Space && p.onGround && canAct && !G.buyOpen && !p.action) { p.vel.y = JUMP_V; p.onGround = false; p.pos.y += 0.01; }
  integrate(p, dt);
  // plant / defuse (hold F)
  const holdF = !!keys.KeyF && canAct;
  const site = canPlant(p), df = canDefuse(p);
  if (holdF && (site || df)) {
    if (!p.action) { p.action = { type: site ? 'plant' : 'defuse', t: 0 }; Snd.ui(); }
    p.action.t += dt; p.vel.x = p.vel.z = 0;
    if (p.action.type === 'plant' && p.action.t >= PLANT_TIME) doPlant(p);
    else if (p.action.type === 'defuse') {
      if (!G.charge.defuseHalf && p.action.t >= DEFUSE_TIME / 2) { G.charge.defuseHalf = true; Snd.beep(null); }
      if (p.action.t >= DEFUSE_TIME) doDefuse(p);
    }
  } else p.action = null;
  // shooting
  const w = p.w, am = p.ammo[p.wkey];
  const allowFire = canAct && G.phase !== 'buy' && !G.buyOpen && !p.action && p.equipT <= 0 && p.reloadT <= 0;
  if (mouseDown && allowFire) {
    if (am.mag <= 0) { if (!fireLatch) { if (am.res > 0) startReload(p); else Snd.denied(); fireLatch = true; } }
    else if (G.time >= p.nextFire && (w.auto || !fireLatch)) { playerShoot(); fireLatch = true; }
  }
  if (!mouseDown) fireLatch = false;
  if (am.mag <= 0 && am.res > 0 && p.reloadT <= 0 && !mouseDown && G.time - p.lastShot > 0.25) startReload(p);
  // spotting enemies for minimap
  G.spotT = (G.spotT || 0) - dt;
  if (G.spotT <= 0) {
    G.spotT = 0.15; const e = p.eye();
    for (const a of G.agents) if (a.alive && a.team !== p.team) {
      const toYaw = yawTo(a.pos.x - p.pos.x, a.pos.z - p.pos.z);
      if (Math.abs(angDiff(p.yaw, toYaw)) < 1.0 && (los(e, a.eye()) || los(e, a.chest()))) a.spotted = G.time + 1.2;
    }
  }
}

/* ================= INPUT ================= */
function lockPointer() { try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => { }); } catch (e) { } }
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  if (!locked && G.running && !G.buyOpen && !G.over) { G.paused = true; $('pause').classList.remove('hidden'); mouseDown = false; }
  if (locked) { G.paused = false; $('pause').classList.add('hidden'); }
});
document.addEventListener('pointerlockerror', () => { if (G.running) { $('pause').classList.remove('hidden'); $('pauseMsg').textContent = 'Pointer lock was blocked. Open the game in its own browser tab (not inside a preview frame) and click to play.'; } });
$('pause').addEventListener('click', () => { Snd.init(); lockPointer(); });
document.addEventListener('mousemove', e => {
  if (document.pointerLockElement !== canvas || !G.player || !G.running) return;
  const p = G.player;
  let mx = e.movementX, my = e.movementY; if (Math.abs(mx) > 400 || Math.abs(my) > 400) return;
  const k = 0.0022 * G.sens * (G.scoped ? 1 / WEAPONS.longbow.zoom : 1);
  if (p.alive) { p.yaw -= mx * k; p.pitch = clamp(p.pitch - my * k, -1.5, 1.5); }
});
canvas.addEventListener('mousedown', e => {
  if (!G.running) return;
  if (document.pointerLockElement !== canvas) { if (!G.buyOpen) lockPointer(); return; }
  const p = G.player;
  if (!p.alive) { if (e.button === 0) G.spec++; return; }
  if (e.button === 0) mouseDown = true;
  if (e.button === 2 && p.w.type === 'sniper' && p.reloadT <= 0 && p.equipT <= 0) { G.scoped = !G.scoped; Snd.ui(); }
});
document.addEventListener('mouseup', e => { if (e.button === 0) mouseDown = false; });
document.addEventListener('contextmenu', e => { if (G.running) e.preventDefault(); });
document.addEventListener('wheel', e => {
  if (!G.running || !G.player.alive || document.pointerLockElement !== canvas) return;
  const p = G.player; p.equip(p.slot === 'primary' ? 'secondary' : 'primary');
}, { passive: true });
document.addEventListener('keydown', e => {
  if (!G.running) return;
  if (['Tab', 'Space', 'ControlLeft', 'KeyB'].includes(e.code)) e.preventDefault();
  if (e.repeat) { keys[e.code] = true; return; }
  keys[e.code] = true;
  const p = G.player;
  if (e.code === 'Digit1' && p.alive) p.equip('primary');
  if (e.code === 'Digit2' && p.alive) p.equip('secondary');
  if (e.code === 'KeyR' && p.alive) startReload(p);
  if (e.code === 'KeyB') { if (G.buyOpen) closeBuy(true); else openBuy(); }
  if (e.code === 'Tab') $('scoreboard').classList.remove('hidden'), renderScoreboard();
  if (e.code === 'Escape' && G.buyOpen) closeBuy(false);
});
document.addEventListener('keyup', e => {
  keys[e.code] = false;
  if (e.code === 'Tab') $('scoreboard').classList.add('hidden');
});
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouseDown = false; });
window.addEventListener('resize', () => R.resize());

/* ================= BUY MENU ================= */
function openBuy() {
  if (G.phase !== 'buy' || !G.player.alive) { toast('Buying is only available during the buy phase'); return; }
  G.buyOpen = true; document.exitPointerLock && document.exitPointerLock();
  $('buyMenu').classList.remove('hidden'); renderBuy();
}
function closeBuy(relock) {
  if (!G.buyOpen) return;
  G.buyOpen = false; $('buyMenu').classList.add('hidden');
  if (relock) lockPointer(); else if (G.running && document.pointerLockElement !== canvas) { G.paused = true; $('pause').classList.remove('hidden'); }
}
function renderBuy() {
  const p = G.player;
  $('buyCredits').textContent = '¤ ' + p.credits;
  const items = [
    ['secondary', 'sidearm', 'Sidearm', 0, 'Semi-auto pistol · 12 rounds'],
    ['primary', 'wasp', 'Wasp', 1600, 'SMG · 30 rounds · great on the move'],
    ['primary', 'ranger', 'Ranger', 2900, 'Rifle · one-tap headshots · 25 rounds'],
    ['primary', 'longbow', 'Longbow', 4700, 'Sniper · right-click to scope · 5 rounds'],
    ['armor', 'light', 'Light Shield', 400, '+25 shield'],
    ['armor', 'heavy', 'Heavy Shield', 1000, '+50 shield'],
  ];
  $('buyGrid').innerHTML = items.map(([cat, key, name, price, desc]) => {
    const owned = ARMOR[key] ? p.armor >= ARMOR[key].value : (WEAPONS[key].slot === 'primary' ? p.primary === key : p.secondary === key);
    const cant = !owned && p.credits < price;
    return `<button class="buyItem ${owned ? 'owned' : ''} ${cant ? 'cant' : ''}" data-key="${key}">
      <span class="bi-cat">${cat}</span><span class="bi-name">${name}</span><span class="bi-desc">${desc}</span>
      <span class="bi-price">${owned ? 'OWNED' : price ? '¤ ' + price : 'FREE'}</span></button>`;
  }).join('');
  $('buyGrid').querySelectorAll('.buyItem').forEach(b => b.onclick = () => {
    if (buyItem(G.player, b.dataset.key)) Snd.ui(); else Snd.denied();
    renderBuy();
  });
}
$('buyClose').onclick = () => closeBuy(true);

/* ================= HUD ================= */
const hudCache = {};
function setText(id, v) { if (hudCache[id] !== v) { hudCache[id] = v; $(id).textContent = v; } }
function announce(title, sub, color, dur = 2) {
  G.ann = { title, sub, color: typeof color === 'number' ? '#' + color.toString(16).padStart(6, '0') : color, t: dur };
  $('annTitle').textContent = title; $('annSub').textContent = sub; $('annTitle').style.color = G.ann.color;
  $('announce').classList.remove('hidden'); $('announce').style.opacity = 1;
}
let toastT = 0;
function toast(msg) { $('toast').textContent = msg; $('toast').style.opacity = 1; toastT = 3.5; }
function pushFeed(k, v, weapon, head) {
  const kc = k ? (k.team === G.player.team ? 'ally' : 'enemy') : '';
  const vc = v.team === G.player.team ? 'ally' : 'enemy';
  G.killfeed.push({ html: `<span class="${kc}">${k ? k.name : ''}</span> <span class="kfw">${weapon}${head ? ' ◉' : ''}</span> <span class="${vc}">${v.name}</span>`, t: 6, mine: k && k.isPlayer });
  if (G.killfeed.length > 6) G.killfeed.shift();
  renderFeed();
}
function feedMsg(text, col) { G.killfeed.push({ html: `<span style="color:#${col.toString(16)}">${text}</span>`, t: 4 }); renderFeed(); }
function renderFeed() { $('killfeed').innerHTML = G.killfeed.map(k => `<div class="kf ${k.mine ? 'mine' : ''}">${k.html}</div>`).join(''); }
function hitMarker(head, killed) {
  const h = $('hitmarker'); h.className = 'show' + (head ? ' head' : '') + (killed ? ' kill' : '');
  clearTimeout(hitMarker.t); hitMarker.t = setTimeout(() => h.className = '', killed ? 260 : 140);
}
function showKillBanner(head) {
  const k = $('killBanner'); k.textContent = head ? 'HEADSHOT' : 'ELIMINATED'; k.className = 'show';
  clearTimeout(showKillBanner.t); showKillBanner.t = setTimeout(() => k.className = '', 900);
}
function renderScoreboard() {
  const rows = team => G.agents.filter(a => a.team === team).sort((a, b) => b.kills - a.kills).map(a =>
    `<tr class="${a.alive ? '' : 'dead'} ${a.isPlayer ? 'me' : ''}"><td>${a.name}</td><td>${a.primary ? WEAPONS[a.primary].name : 'Sidearm'}</td><td>${a.kills}</td><td>${a.deaths}</td><td>${team === G.player.team ? '¤ ' + a.credits : '—'}</td></tr>`).join('');
  const t0 = G.player.team;
  $('scoreboard').innerHTML = `<div class="sb-head"><span class="ally">YOUR TEAM ${G.score[t0]}</span><span>ROUND ${G.round}</span><span class="enemy">${G.score[1 - t0]} ENEMY</span></div>
  <table><tr><th>Name</th><th>Weapon</th><th>K</th><th>D</th><th>Credits</th></tr>${rows(t0)}</table>
  <table class="enemyTable"><tr><th>Name</th><th>Weapon</th><th>K</th><th>D</th><th></th></tr>${rows(1 - t0)}</table>`;
}
function updateHud(dt) {
  const p = G.player, t0 = p.team;
  setText('allyScore', String(G.score[t0])); setText('enemyScore', String(G.score[1 - t0]));
  const pip = team => G.agents.filter(a => a.team === team).map(a => `<i class="${a.alive ? '' : 'dead'}"></i>`).join('');
  const pa = pip(t0), pe = pip(1 - t0);
  if (hudCache.pa !== pa) { hudCache.pa = pa; $('allyPips').innerHTML = pa; }
  if (hudCache.pe !== pe) { hudCache.pe = pe; $('enemyPips').innerHTML = pe; }
  let timerTxt = fmtTime(G.timer), timerCls = '';
  if (G.phase === 'planted') { timerTxt = '◆ ' + Math.max(0, G.charge.timer).toFixed(0); timerCls = 'planted'; }
  if (G.phase === 'buy') timerCls = 'buy';
  setText('timer', timerTxt); $('timer').className = timerCls;
  setText('roundLabel', G.phase === 'buy' ? 'BUY PHASE' : 'ROUND ' + G.round);
  const side = sideOf(t0); setText('sideLabel', side === 'atk' ? 'ATTACK' : 'DEFEND'); $('sideLabel').className = side;
  setText('hpVal', String(Math.max(0, Math.ceil(p.hp)))); setText('armorVal', String(Math.ceil(p.armor)));
  $('armorBox').style.opacity = p.armor > 0 ? 1 : 0.35;
  const am = p.ammo[p.wkey];
  setText('magVal', String(am.mag)); setText('resVal', String(am.res)); setText('weaponName', p.w.name.toUpperCase() + (p.reloadT > 0 ? ' · RELOADING' : ''));
  setText('credits', '¤ ' + p.credits);
  $('credits').style.display = G.phase === 'buy' ? 'block' : 'none';
  $('chargeIcon').style.display = (G.charge.state === 'carried' && G.charge.carrier === p) ? 'block' : 'none';
  // prompt
  let prompt = '';
  if (p.alive && p.action) prompt = '';
  else if (p.alive) {
    if (G.phase === 'buy') prompt = 'Press B to open the buy menu';
    else if (canPlant(p)) prompt = 'Hold F to plant the Charge';
    else if (canDefuse(p)) prompt = 'Hold F to defuse';
  } else prompt = 'You are dead — click to cycle spectate';
  setText('prompt', prompt);
  // progress
  const act = p.action;
  if (act) {
    $('progress').style.display = 'block';
    const tot = act.type === 'plant' ? PLANT_TIME : DEFUSE_TIME;
    $('progressFill').style.width = (clamp(act.t / tot, 0, 1) * 100) + '%';
    setText('progressLabel', act.type === 'plant' ? 'PLANTING' : 'DEFUSING');
  } else $('progress').style.display = 'none';
  // scope, crosshair
  $('scope').style.display = G.scoped && p.alive ? 'block' : 'none';
  $('crosshair').style.display = !G.scoped && p.alive ? 'block' : 'none';
  const gap = 4 + clamp(p.speed / RUN, 0, 1) * 8 + (p.onGround ? 0 : 8) + Math.min(p.shots, 8) * (p.w.auto ? 1.2 : 0) + p.recoil.y * 40;
  $('crosshair').style.setProperty('--gap', gap.toFixed(1) + 'px');
  // damage
  G.dmgFlash = Math.max(0, (G.dmgFlash || 0) - dt * 1.5);
  $('dmgVignette').style.opacity = G.dmgFlash;
  if (G.dmgDir && G.dmgDir.t > 0) {
    G.dmgDir.t -= dt; const rel = angDiff(p.yaw, G.dmgDir.yaw);
    $('dmgDir').style.opacity = clamp(G.dmgDir.t, 0, 1); $('dmgDir').style.transform = `translate(-50%,-50%) rotate(${-rel}rad)`;
  } else $('dmgDir').style.opacity = 0;
  // announce fade
  if (G.ann) { G.ann.t -= dt; if (G.ann.t < 0.5) $('announce').style.opacity = Math.max(0, G.ann.t / 0.5); if (G.ann.t <= 0) { $('announce').classList.add('hidden'); G.ann = null; } }
  if (toastT > 0) { toastT -= dt; if (toastT < 0.5) $('toast').style.opacity = Math.max(0, toastT / 0.5); }
  // killfeed decay
  let ch = false; for (const k of G.killfeed) { k.t -= dt; if (k.t <= 0) ch = true; }
  if (ch) { G.killfeed = G.killfeed.filter(k => k.t > 0); renderFeed(); }
  // spectate label
  $('spectate').style.display = p.alive ? 'none' : 'block';
  if (!p.alive && G.specTarget) setText('spectate', 'SPECTATING  ' + G.specTarget.name.toUpperCase());
  else if (!p.alive) setText('spectate', 'ELIMINATED');
  if (!$('scoreboard').classList.contains('hidden')) { G.sbT = (G.sbT || 0) - dt; if (G.sbT <= 0) { G.sbT = 0.5; renderScoreboard(); } }
  if (G.buyOpen) { G.buyT = (G.buyT || 0) - dt; if (G.buyT <= 0) { G.buyT = 0.5; $('buyTimer').textContent = Math.ceil(G.timer) + 's'; } }
  drawMinimap();
}
/* ---- minimap ---- */
const mm = $('minimap'), mctx = mm.getContext('2d');
let MM_S = 1, MM_OX = 0, MM_OY = 0, mmBase = null;
const mmx = x => MM_OX + x * MM_S, mmy = z => MM_OY + z * MM_S;
function siteCenter(k) { let x = 0, z = 0, n = 0; for (const i of SETS[k]) { x += (i % COLS + 0.5) * CELL; z += (((i / COLS) | 0) + 0.5) * CELL; n++; } return { x: x / n, z: z / n }; }
function buildMinimap() {
  // fit the playable area (walkable bounds) into the minimap
  let c0 = COLS, c1 = 0, r0 = ROWS, r1 = 0;
  for (let i = 0; i < WALK.length; i++) if (WALK[i]) { const c = i % COLS, r = (i / COLS) | 0; if (c < c0) c0 = c; if (c > c1) c1 = c; if (r < r0) r0 = r; if (r > r1) r1 = r; }
  const pw = (c1 - c0 + 3) * CELL, pd = (r1 - r0 + 3) * CELL;
  MM_S = Math.min(mm.width / pw, mm.height / pd);
  MM_OX = (mm.width - (c1 + c0 + 1) * CELL * MM_S) / 2; MM_OY = (mm.height - (r1 + r0 + 1) * CELL * MM_S) / 2;
  mmBase = makeCanvas(mm.width, mm.height, (x) => {
    x.fillStyle = 'rgba(12,16,22,0.85)'; x.fillRect(0, 0, mm.width, mm.height);
    const s = CELL * MM_S;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const i = r * COLS + c, walk = WALK[i], h = HGT[i];
      let col = null;
      if (walk) col = SETS.A.has(i) || SETS.B.has(i) ? 'rgba(210,190,160,0.6)' : `rgba(170,175,180,${0.3 + clamp(h / 8, -0.1, 0.3)})`;
      else if (!CUSTOM && h < WALL_H) col = 'rgba(120,130,140,0.9)';
      else if (CUSTOM) { let adj = false; for (let dr = -1; dr <= 1 && !adj; dr++) for (let dc = -1; dc <= 1; dc++) if (isWalk(c + dc, r + dr)) { adj = true; break; } if (adj) col = 'rgba(60,66,76,0.9)'; }
      if (!col) continue;
      x.fillStyle = col; x.fillRect(MM_OX + c * s, MM_OY + r * s, s + 0.5, s + 0.5);
    }
    x.font = 'bold 16px Rajdhani, Arial'; x.fillStyle = 'rgba(255,255,255,0.85)'; x.textAlign = 'center';
    for (const k of ['A', 'B']) { const p = siteCenter(k); x.fillText(k, mmx(p.x), mmy(p.z) + 6); }
  });
}
buildMinimap();
function drawMinimap() {
  const x = mctx, p = G.player; x.clearRect(0, 0, mm.width, mm.height); x.drawImage(mmBase, 0, 0);
  const C = G.charge;
  if (C.state === 'dropped' || C.state === 'planted') {
    x.fillStyle = C.state === 'planted' ? '#ff4655' : '#ffd166';
    x.save(); x.translate(mmx(C.pos.x), mmy(C.pos.z)); x.rotate(Math.PI / 4); x.fillRect(-4, -4, 8, 8); x.restore();
  }
  for (const a of G.agents) {
    if (a.isPlayer) continue;
    const ally = a.team === p.team;
    if (!ally && !(a.alive && a.spotted > G.time)) continue;
    x.globalAlpha = a.alive ? 1 : 0.35;
    x.fillStyle = ally ? '#35d6c5' : '#ff4655';
    x.beginPath(); x.arc(mmx(a.pos.x), mmy(a.pos.z), 3.5, 0, 7); x.fill();
    if (a.alive) { x.strokeStyle = x.fillStyle; x.lineWidth = 1.5; x.beginPath(); x.moveTo(mmx(a.pos.x), mmy(a.pos.z)); const f = fwd(a.yaw, 0); x.lineTo(mmx(a.pos.x + f.x * 3), mmy(a.pos.z + f.z * 3)); x.stroke(); }
    if (C.state === 'carried' && C.carrier === a && ally) { x.fillStyle = '#ffd166'; x.fillRect(mmx(a.pos.x) - 2, mmy(a.pos.z) - 8, 4, 4); }
  }
  x.globalAlpha = 1;
  // player arrow + view cone
  const px = mmx(p.pos.x), pz = mmy(p.pos.z);
  x.save(); x.translate(px, pz); x.rotate(-p.yaw);
  x.fillStyle = 'rgba(255,255,255,0.12)'; x.beginPath(); x.moveTo(0, 0); x.arc(0, 0, 40, -Math.PI / 2 - 0.6, -Math.PI / 2 + 0.6); x.closePath(); x.fill();
  x.fillStyle = p.alive ? '#fff' : '#888'; x.beginPath(); x.moveTo(0, -7); x.lineTo(5, 5); x.lineTo(0, 2); x.lineTo(-5, 5); x.closePath(); x.fill();
  x.restore();
}

/* ================= CAMERA & RENDER ================= */
function vfov() { const aspect = canvas.width / canvas.height, h = G.fov * Math.PI / 180; return 2 * Math.atan(Math.tan(h / 2) / aspect); }
function renderFrame(dt) {
  R.resize();
  const p = G.player;
  let pos, yaw, pitch, fov = vfov();
  if (!p || G.phase === 'menu') {
    const t = performance.now() / 1000 * 0.08;
    const S = Math.max(MAP_W, MAP_D); pos = [MAP_W / 2 + Math.sin(t) * S * 0.33, S * 0.28, MAP_D / 2 + Math.cos(t) * S * 0.25]; yaw = yawTo(MAP_W / 2 - pos[0], MAP_D / 2 - pos[2]); pitch = -0.6;
  } else if (p.alive) {
    const e = p.eye();
    pos = [e.x, e.y, e.z]; yaw = p.yaw + p.recoil.x * 0.35; pitch = p.pitch + p.recoil.y * 0.4;
    if (G.scoped) fov = fov / WEAPONS.longbow.zoom;
  } else {
    // death cam for 2s then spectate teammates
    const mates = G.agents.filter(a => a.alive && a.team === p.team && !a.isPlayer);
    if (G.deathCam && G.deathCam.t < 2 || !mates.length) {
      const k = G.deathCam ? G.deathCam.t : 3, e = p.eye();
      pos = [e.x, e.y + Math.min(k, 2) * 1.8 + 0.3, e.z]; yaw = p.yaw; pitch = -0.5 - Math.min(k, 2) * 0.3; G.specTarget = null;
      if (G.deathCam && G.deathCam.killer && G.deathCam.killer.alive) {
        const kk = G.deathCam.killer; yaw = yawTo(kk.pos.x - p.pos.x, kk.pos.z - p.pos.z); pitch = -0.35;
      }
    } else {
      const t = mates[((G.spec % mates.length) + mates.length) % mates.length]; G.specTarget = t;
      const f = fwd(t.yaw, 0), e = t.eye();
      let back = 3.2; const o = { x: e.x, y: e.y + 0.9, z: e.z }, dir = { x: -f.x, y: 0.25, z: -f.z }, dl = Math.hypot(dir.x, dir.y, dir.z);
      dir.x /= dl; dir.y /= dl; dir.z /= dl; back = Math.min(back, rayGrid(o, dir, back).t - 0.3);
      pos = [o.x + dir.x * back, o.y + dir.y * back, o.z + dir.z * back]; yaw = t.yaw; pitch = t.pitch * 0.5 - 0.2;
    }
  }
  if (G.shake > 0) { G.shake -= dt; pos[0] += rand(-1, 1) * G.shake * 0.2; pos[1] += rand(-1, 1) * G.shake * 0.2; }
  R.setCamera(pos, yaw, pitch, fov);
  G.listener = { x: pos[0], z: pos[2], yaw };
  // world
  const I = M4.create();
  for (const w of MESH.world) R.draw(w.mesh, I, w);
  // site & spawn markings
  if (CUSTOM) for (const k of ['A', 'B']) {
    const c = siteCenter(k), h = hAt(cellOf(c.x), cellOf(c.z));
    billboard(c.x, (isFinite(h) ? h : 0) + 4.5, c.z, 2.2, TEX['letter' + k], [1, 0.85, 0.6, 0.75], 'alpha');
  }
  if (!CUSTOM) for (const [s, tex] of [['A', TEX.siteA], ['B', TEX.siteB]]) {
    const g = REG[s], cx = (g.c0 + g.c1 + 1) / 2 * CELL, cz = (g.r0 + g.r1 + 1) / 2 * CELL;
    const m = M4.identity(_m); M4.translate(m, cx, 0.02, cz); M4.rotateX(m, -Math.PI / 2);
    M4.scale(m, (g.c1 - g.c0 + 1) * CELL - 1, (g.r1 - g.r0 + 1) * CELL - 1, 1);
    R.draw(MESH.quad, m, { tex, color: [1, 0.95, 0.85, 0.35], mode: 'alpha', cast: false });
  }
  if (G.phase === 'buy' && !CUSTOM) for (const k of ['T', 'D']) {
    const g = REG[k], cx = (g.c0 + g.c1 + 1) / 2 * CELL, cz = (g.r0 + g.r1 + 1) / 2 * CELL;
    const m = M4.identity(_m); M4.translate(m, cx, 0.03, cz); M4.rotateX(m, -Math.PI / 2);
    M4.scale(m, (g.c1 - g.c0 + 1) * CELL, (g.r1 - g.r0 + 1) * CELL, 1);
    const own = sideOf(G.player ? G.player.team : 0) === (k === 'T' ? 'atk' : 'def');
    R.draw(MESH.quad, m, { tex: TEX.spawn, color: own ? [0.2, 0.9, 0.8, 0.25] : [1, 0.3, 0.3, 0.2], mode: 'alpha', cast: false });
  }
  if (p && G.phase !== 'menu') {
    for (const a of G.agents) {
      if (a.isPlayer && a.alive) continue;
      drawAgent(a);
      // ally marker
      if (a.alive && a.team === p.team && !a.isPlayer) billboard(a.pos.x, a.pos.y + 2.25, a.pos.z, 0.28, TEX.diamond, [0.2, 0.85, 0.78, 0.9], 'alpha');
    }
    drawCharge();
    drawFx();
    drawViewmodel(dt);
  }
  let vmProj = null;
  if (p && p.alive && !G.scoped && G.phase !== 'menu') { vmProj = M4.create(); M4.perspective(vmProj, 58 * Math.PI / 180, canvas.width / canvas.height, 0.01, 10); }
  R.render(vmProj, R.view);
}

/* ================= MAIN LOOP ================= */
let last = performance.now();
function update(dt) {
  G.time += dt;
  updatePhase(dt);
  if (!G.running) return;
  playerUpdate(dt);
  for (const a of G.agents) {
    if (a.isPlayer) continue;
    if (a.alive) botUpdate(a, dt); else a.deadT += dt;
  }
  separate();
  updateCharge(dt);
  updateFx(dt);
}
function frame(now) {
  requestAnimationFrame(frame);
  if (G.noLoop) return;
  const raw = Math.min(0.05, (now - last) / 1000); last = now;
  const dt = raw * G.timeScale;
  if (G.running && !G.paused) {
    // substep when time-scaled (tests)
    const n = Math.ceil(dt / 0.034); for (let i = 0; i < n; i++) update(dt / n);
    updateHud(raw);
  }
  renderFrame(raw);
}
requestAnimationFrame(frame);

/* ================= MENU ================= */
const sel = { size: 3, diff: 'normal' };
document.querySelectorAll('[data-size]').forEach(b => b.onclick = () => { sel.size = +b.dataset.size; document.querySelectorAll('[data-size]').forEach(x => x.classList.toggle('on', x === b)); });
document.querySelectorAll('[data-diff]').forEach(b => b.onclick = () => { sel.diff = b.dataset.diff; document.querySelectorAll('[data-diff]').forEach(x => x.classList.toggle('on', x === b)); });
const loadSetting = (k, d) => { try { const v = localStorage.getItem('riftline.' + k); return v === null ? d : +v; } catch (e) { return d; } };
const saveSetting = (k, v) => { try { localStorage.setItem('riftline.' + k, v); } catch (e) { } };
G.sens = loadSetting('sens', 1); G.fov = loadSetting('fov', 103); Snd.vol = loadSetting('vol', 0.6);
$('sens').value = G.sens; $('sensVal').textContent = G.sens.toFixed(2);
$('fovIn').value = G.fov; $('fovVal').textContent = G.fov;
$('vol').value = Snd.vol; $('volVal').textContent = Math.round(Snd.vol * 100);
$('sens').oninput = e => { G.sens = +e.target.value; $('sensVal').textContent = G.sens.toFixed(2); saveSetting('sens', G.sens); };
$('fovIn').oninput = e => { G.fov = +e.target.value; $('fovVal').textContent = G.fov; saveSetting('fov', G.fov); };
$('vol').oninput = e => { Snd.setVol(+e.target.value); $('volVal').textContent = Math.round(Snd.vol * 100); saveSetting('vol', Snd.vol); };
$('playBtn').onclick = () => { Snd.init(); startMatch(sel.size, sel.diff); };
/* ---- map picker ---- */
MESH.defaultWorld = MESH.world;
const customMap = { buf: null, name: '', baseScale: 0, data: null };
function mapStatus(msg, cls = '') { $('mapStatus').textContent = msg; $('mapStatus').className = cls; }
function setMapButtons(custom) { $('mapDefault').classList.toggle('on', !custom); $('mapLoad').classList.toggle('on', custom); $('mapScaleRow').classList.toggle('hidden', !custom); }
function useDefaultMap() {
  initDefaultMap(); MESH.world = MESH.defaultWorld; applyMapLighting(); buildMinimap();
  setMapButtons(false); mapStatus('Built-in map. Or load your own .glb map (it stays on your computer).');
}
async function useCustomMap(scaleMul = 1) {
  $('playBtn').disabled = true;
  try {
    const opts = customMap.baseScale ? { scale: customMap.baseScale * scaleMul } : {};
    const data = await GLBMap.load(customMap.buf, opts, m => mapStatus(m));
    if (!customMap.baseScale) customMap.baseScale = data.scale;
    mapStatus('Uploading textures to GPU…'); await new Promise(r => setTimeout(r, 0));
    initCustomMap(data); await buildCustomWorld(data); applyMapLighting(); buildMinimap();
    customMap.data = data; setMapButtons(true);
    const who = data.info && data.info.author ? ` · model by ${data.info.author.replace(/\s*\(.*\)/, '')}` : '';
    const title = data.info && data.info.title ? data.info.title : customMap.name;
    mapStatus(`✓ ${title}${who} — ${Math.round(MAP_W)}×${Math.round(MAP_D)} m, ${data.stats.walk} walkable cells. Sites placed automatically.`, 'ok');
  } catch (e) {
    console.error(e); mapStatus('Could not load that map: ' + e.message, 'err'); useDefaultMap();
  } finally { $('playBtn').disabled = false; }
}
$('mapDefault').onclick = () => useDefaultMap();
$('mapLoad').onclick = () => $('mapFile').click();
$('mapFile').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  customMap.buf = await f.arrayBuffer(); customMap.name = f.name.replace(/\.glb$/i, ''); customMap.baseScale = 0;
  $('mapScale').value = 1; $('mapScaleVal').textContent = '×1.00';
  await useCustomMap(1);
  e.target.value = '';
};
$('mapScale').oninput = e => { $('mapScaleVal').textContent = '×' + (+e.target.value).toFixed(2); };
$('mapApply').onclick = () => { if (customMap.buf) useCustomMap(+$('mapScale').value); };
$('againBtn').onclick = () => { Snd.init(); startMatch(sel.size, sel.diff); };
$('menuBtn').onclick = () => { $('gameover').classList.add('hidden'); $('menu').classList.remove('hidden'); G.phase = 'menu'; G.player = null; };
if (matchMedia('(pointer: coarse)').matches) $('touchNote').classList.remove('hidden');

// debug / test hook
window.RIFT = { useCustomMap, customMap, useDefaultMap, get MAP_W() { return MAP_W; }, get CELL() { return CELL; }, G, WEAPONS, startMatch, setTimeScale: s => G.timeScale = s, rayGrid, findPath, endRound, R, update, renderFrame, updateHud };
