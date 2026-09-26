/* =========================================================
   RIFTLINE custom map loader
   - Parses a .glb (binary glTF) file entirely in the browser
   - Bakes node transforms, groups geometry by material
   - Builds a 2.5D walkable grid (floors, walls, cover) from the mesh
   - Auto-places spawns, bomb sites, mid and site entries
   The model file never leaves the player's computer.
   ========================================================= */
'use strict';

const GLBMap = (() => {
  const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
  const tick = () => new Promise(r => setTimeout(r, 0));

  function parse(buf) {
    const dv = new DataView(buf);
    if (dv.getUint32(0, true) !== 0x46546C67) throw new Error('That file is not a .glb model');
    let off = 12, json = null, bin = null;
    while (off + 8 <= buf.byteLength) {
      const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
      if (type === 0x4E4F534A) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, off + 8, len)));
      else if (type === 0x004E4942) bin = new DataView(buf, off + 8, len);
      off += 8 + len;
    }
    if (!json) throw new Error('GLB has no JSON chunk');
    return { json, bin };
  }

  function readAccessor(g, i) {
    const a = g.json.accessors[i];
    const n = NC[a.type], cnt = a.count, out = new Float32Array(cnt * n);
    if (a.bufferView === undefined) return out;
    const bv = g.json.bufferViews[a.bufferView];
    const size = { 5126: 4, 5125: 4, 5123: 2, 5122: 2, 5121: 1, 5120: 1 }[a.componentType];
    const stride = bv.byteStride || n * size, base = (bv.byteOffset || 0) + (a.byteOffset || 0), dv = g.bin;
    const norm = a.normalized;
    const rd = {
      5126: o => dv.getFloat32(o, true),
      5125: o => dv.getUint32(o, true),
      5123: o => norm ? dv.getUint16(o, true) / 65535 : dv.getUint16(o, true),
      5122: o => norm ? Math.max(dv.getInt16(o, true) / 32767, -1) : dv.getInt16(o, true),
      5121: o => norm ? dv.getUint8(o) / 255 : dv.getUint8(o),
      5120: o => norm ? Math.max(dv.getInt8(o) / 127, -1) : dv.getInt8(o),
    }[a.componentType];
    for (let k = 0; k < cnt; k++) { const o = base + k * stride; for (let c = 0; c < n; c++) out[k * n + c] = rd(o + c * size); }
    return out;
  }

  function nodeMatrix(n) {
    const m = M4.create();
    if (n.matrix) { m.set(n.matrix); return m; }
    const t = n.translation || [0, 0, 0], q = n.rotation || [0, 0, 0, 1], s = n.scale || [1, 1, 1];
    const [x, y, z, w] = q;
    const r = [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w),
      2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w),
      2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)];
    m[0] = r[0] * s[0]; m[1] = r[1] * s[0]; m[2] = r[2] * s[0];
    m[4] = r[3] * s[1]; m[5] = r[4] * s[1]; m[6] = r[5] * s[1];
    m[8] = r[6] * s[2]; m[9] = r[7] * s[2]; m[10] = r[8] * s[2];
    m[12] = t[0]; m[13] = t[1]; m[14] = t[2]; m[15] = 1;
    return m;
  }

  /* ---------- triangle / box overlap (Akenine-Möller SAT) ---------- */
  function triBox(bc, bh, v0, v1, v2) {
    const a = [v0[0] - bc[0], v0[1] - bc[1], v0[2] - bc[2]], b = [v1[0] - bc[0], v1[1] - bc[1], v1[2] - bc[2]], c = [v2[0] - bc[0], v2[1] - bc[1], v2[2] - bc[2]];
    for (let k = 0; k < 3; k++) {
      if (Math.min(a[k], b[k], c[k]) > bh[k] || Math.max(a[k], b[k], c[k]) < -bh[k]) return false;
    }
    const e = [[b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - b[0], c[1] - b[1], c[2] - b[2]], [a[0] - c[0], a[1] - c[1], a[2] - c[2]]];
    const V = [a, b, c];
    for (const ed of e) for (let ax = 0; ax < 3; ax++) {
      // axis = unit[ax] x ed
      const L = ax === 0 ? [0, -ed[2], ed[1]] : ax === 1 ? [ed[2], 0, -ed[0]] : [-ed[1], ed[0], 0];
      let mn = Infinity, mx = -Infinity;
      for (const v of V) { const p = v[0] * L[0] + v[1] * L[1] + v[2] * L[2]; if (p < mn) mn = p; if (p > mx) mx = p; }
      const r = bh[0] * Math.abs(L[0]) + bh[1] * Math.abs(L[1]) + bh[2] * Math.abs(L[2]);
      if (mn > r || mx < -r) return false;
    }
    const n = [e[0][1] * e[1][2] - e[0][2] * e[1][1], e[0][2] * e[1][0] - e[0][0] * e[1][2], e[0][0] * e[1][1] - e[0][1] * e[1][0]];
    const d = n[0] * a[0] + n[1] * a[1] + n[2] * a[2];
    const r = bh[0] * Math.abs(n[0]) + bh[1] * Math.abs(n[1]) + bh[2] * Math.abs(n[2]);
    return Math.abs(d) <= r;
  }

  /* ---------- main entry ---------- */
  async function load(buf, opts = {}, progress = () => { }) {
    progress('Reading model…'); await tick();
    const g = parse(buf), J = g.json;
    const mats = (J.materials || []).map(m => {
      const pbr = m.pbrMetallicRoughness || {};
      return {
        name: m.name || '', color: pbr.baseColorFactor || [1, 1, 1, 1],
        tex: pbr.baseColorTexture ? J.textures[pbr.baseColorTexture.index].source : -1,
        alphaCut: m.alphaMode === 'MASK' ? (m.alphaCutoff ?? 0.5) : 0.01, blend: m.alphaMode === 'BLEND',
        emis: m.emissiveFactor || [0, 0, 0],
      };
    });
    mats.push({ name: 'default', color: [0.8, 0.8, 0.8, 1], tex: -1, alphaCut: 0.01, blend: false, emis: [0, 0, 0] });
    const defMat = mats.length - 1;

    // ---- gather primitives in world space ----
    const prims = []; let nodeCount = 0;
    const scene = J.scenes ? J.scenes[J.scene || 0] : { nodes: J.nodes.map((_, i) => i) };
    const walk = (ni, parent, hidden) => {
      const n = J.nodes[ni], m = M4.create(); M4.mul(m, parent, nodeMatrix(n)); nodeCount++;
      const hide = /collision|collider|trigger|navmesh|blocker|shadow_?proxy/i.test(n.name || '');
      if (n.mesh !== undefined) {
        for (const p of J.meshes[n.mesh].primitives) {
          if (p.mode !== undefined && p.mode !== 4) continue;
          if (p.attributes.POSITION === undefined) continue;
          const mi = p.material ?? defMat;
          prims.push({ p, m: new Float32Array(m), mat: mi, hide: hide || /collision|collider/i.test(mats[mi].name) });
        }
      }
      for (const c of n.children || []) walk(c, m, hide);
    };
    for (const r of scene.nodes) walk(r, M4.create(), false);

    progress(`Processing ${prims.length} mesh parts…`); await tick();
    const parts = []; let triCount = 0;
    for (let k = 0; k < prims.length; k++) {
      const { p, m } = prims[k];
      const P = readAccessor(g, p.attributes.POSITION);
      const N = p.attributes.NORMAL !== undefined ? readAccessor(g, p.attributes.NORMAL) : null;
      const U = p.attributes.TEXCOORD_0 !== undefined ? readAccessor(g, p.attributes.TEXCOORD_0) : null;
      const I = p.indices !== undefined ? readAccessor(g, p.indices) : null;
      const vc = P.length / 3;
      for (let v = 0; v < vc; v++) {
        const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
        P[v * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
        P[v * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
        P[v * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
        if (N) {
          const a = N[v * 3], b = N[v * 3 + 1], c = N[v * 3 + 2];
          let nx = m[0] * a + m[4] * b + m[8] * c, ny = m[1] * a + m[5] * b + m[9] * c, nz = m[2] * a + m[6] * b + m[10] * c;
          const l = Math.hypot(nx, ny, nz) || 1; N[v * 3] = nx / l; N[v * 3 + 1] = ny / l; N[v * 3 + 2] = nz / l;
        }
      }
      const idx = I ? Uint32Array.from(I) : Uint32Array.from({ length: vc }, (_, i) => i);
      triCount += idx.length / 3;
      parts.push({ P, N, U, idx, mat: prims[k].mat, hide: prims[k].hide });
      if (k % 50 === 0) { progress(`Processing mesh parts ${k}/${prims.length}…`); await tick(); }
    }

    // ---- robust extents & scale ----
    const samp = [];
    for (const pt of parts) { const step = Math.max(1, Math.floor(pt.P.length / 3 / 400)); for (let v = 0; v < pt.P.length / 3; v += step) samp.push([pt.P[v * 3], pt.P[v * 3 + 1], pt.P[v * 3 + 2]]); }
    const pct = (arr, q) => { const s = arr.slice().sort((a, b) => a - b); return s[Math.floor(q * (s.length - 1))]; };
    const xs = samp.map(v => v[0]), zs = samp.map(v => v[2]);
    const rx0 = pct(xs, 0.02), rx1 = pct(xs, 0.98), rz0 = pct(zs, 0.02), rz1 = pct(zs, 0.98);
    const ext = Math.max(rx1 - rx0, rz1 - rz0) || 1;
    let scale = opts.scale;
    if (!scale) scale = (ext >= 40 && ext <= 400) ? 1 : 120 / ext;
    const margin = ext * 0.08;
    const ox = rx0 - margin, oz = rz0 - margin;
    const W = (ext + margin * 2) * scale, Wx = (rx1 - rx0 + margin * 2) * scale, Wz = (rz1 - rz0 + margin * 2) * scale;

    for (const pt of parts) for (let v = 0; v < pt.P.length / 3; v++) {
      pt.P[v * 3] = (pt.P[v * 3] - ox) * scale; pt.P[v * 3 + 1] *= scale; pt.P[v * 3 + 2] = (pt.P[v * 3 + 2] - oz) * scale;
    }

    // ---- collision grid ----
    const CELL = opts.cell || 0.75;
    const COLS = Math.ceil(Wx / CELL), ROWS = Math.ceil(Wz / CELL), NCELL = COLS * ROWS;
    progress(`Building collision grid ${COLS}×${ROWS}…`); await tick();
    // flatten triangles
    // invisible helper meshes (vehicle collision hulls, triggers) don't block players on foot
    const solid = parts.filter(pt => !pt.hide);
    const solidTris = solid.reduce((a, pt) => a + pt.idx.length / 3, 0);
    const T = new Float32Array(solidTris * 9); let t = 0;
    for (const pt of solid) {
      for (let i = 0; i < pt.idx.length; i += 3) for (let k = 0; k < 3; k++) { const v = pt.idx[i + k]; T[t++] = pt.P[v * 3]; T[t++] = pt.P[v * 3 + 1]; T[t++] = pt.P[v * 3 + 2]; }
    }
    const nT = t / 9;
    // bin (CSR)
    const cnt = new Uint32Array(NCELL + 1);
    const range = i => {
      const o = i * 9, x0 = Math.min(T[o], T[o + 3], T[o + 6]), x1 = Math.max(T[o], T[o + 3], T[o + 6]);
      const z0 = Math.min(T[o + 2], T[o + 5], T[o + 8]), z1 = Math.max(T[o + 2], T[o + 5], T[o + 8]);
      return [Math.max(0, Math.floor(x0 / CELL)), Math.min(COLS - 1, Math.floor(x1 / CELL)), Math.max(0, Math.floor(z0 / CELL)), Math.min(ROWS - 1, Math.floor(z1 / CELL))];
    };
    for (let i = 0; i < nT; i++) { const [c0, c1, r0, r1] = range(i); if (c1 < c0 || r1 < r0) continue; for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) cnt[r * COLS + c + 1]++; }
    for (let i = 0; i < NCELL; i++) cnt[i + 1] += cnt[i];
    const bins = new Uint32Array(cnt[NCELL]), fill = cnt.slice(0, NCELL);
    for (let i = 0; i < nT; i++) { const [c0, c1, r0, r1] = range(i); if (c1 < c0 || r1 < r0) continue; for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) bins[fill[r * COLS + c]++] = i; }

    // vertical ray hits at cell centre -> floor candidates
    progress('Finding floors…'); await tick();
    const cand = new Array(NCELL), maxY = new Float32Array(NCELL).fill(-1e9);
    for (let ci = 0; ci < NCELL; ci++) {
      const c = ci % COLS, r = (ci / COLS) | 0, px = (c + 0.5) * CELL, pz = (r + 0.5) * CELL;
      const hits = [];
      for (let b = cnt[ci]; b < cnt[ci + 1]; b++) {
        const o = bins[b] * 9;
        const ax = T[o], ay = T[o + 1], az = T[o + 2], bx = T[o + 3], by = T[o + 4], bz = T[o + 5], cx = T[o + 6], cy = T[o + 7], cz = T[o + 8];
        const mY = Math.max(ay, by, cy); if (mY > maxY[ci]) maxY[ci] = mY;
        const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz); if (Math.abs(d) < 1e-9) continue;
        const l1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / d, l2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / d, l3 = 1 - l1 - l2;
        if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
        const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, nl = Math.hypot(nx, ny, nz) || 1;
        hits.push([l1 * ay + l2 * by + l3 * cy, Math.abs(ny / nl) > 0.4]);
      }
      if (!hits.length) { cand[ci] = null; continue; }
      hits.sort((a, b) => a[0] - b[0]);
      const cs = [];
      for (let h = 0; h < hits.length; h++) {
        if (!hits[h][1]) continue;
        let above = Infinity; for (let k = h + 1; k < hits.length; k++) if (hits[k][0] > hits[h][0] + 0.05) { above = hits[k][0]; break; }
        if (above - hits[h][0] >= 1.95) cs.push(hits[h][0]);
      }
      cand[ci] = cs.length ? cs : null;
      if (ci % 4000 === 0) { progress(`Finding floors ${Math.round(ci / NCELL * 100)}%…`); await tick(); }
    }
    // seed = most common floor height near the middle
    const hist = new Map();
    for (let ci = 0; ci < NCELL; ci++) if (cand[ci]) for (const y of cand[ci]) { const k = Math.round(y / 0.5); hist.set(k, (hist.get(k) || 0) + 1); }
    let modeK = 0, modeN = -1; for (const [k, n] of hist) if (n > modeN) { modeN = n; modeK = k; }
    if (modeN < 0) throw new Error('No walkable floor found in this model');
    const slabFree = (ci, f) => {
      const c = ci % COLS, r = (ci / COLS) | 0, grow = 0.04;
      const bc = [(c + 0.5) * CELL, f + 1.15, (r + 0.5) * CELL], bh = [CELL / 2 + grow, 0.62, CELL / 2 + grow];
      for (let b = cnt[ci]; b < cnt[ci + 1]; b++) {
        const o = bins[b] * 9;
        if (triBox(bc, bh, [T[o], T[o + 1], T[o + 2]], [T[o + 3], T[o + 4], T[o + 5]], [T[o + 6], T[o + 7], T[o + 8]])) return false;
      }
      return true;
    };
    const bandTop = (ci, y0, y1) => { // highest geometry inside [y0,y1] in this cell, or -Infinity
      const c = ci % COLS, r = (ci / COLS) | 0;
      const bc = [(c + 0.5) * CELL, (y0 + y1) / 2, (r + 0.5) * CELL], bh = [CELL / 2 + 0.04, (y1 - y0) / 2, CELL / 2 + 0.04];
      let top = -Infinity;
      for (let b = cnt[ci]; b < cnt[ci + 1]; b++) {
        const o = bins[b] * 9;
        if (triBox(bc, bh, [T[o], T[o + 1], T[o + 2]], [T[o + 3], T[o + 4], T[o + 5]], [T[o + 6], T[o + 7], T[o + 8]])) top = Math.max(top, Math.min(y1, Math.max(T[o + 1], T[o + 4], T[o + 7])));
      }
      return top;
    };
    let seed = -1, best = Infinity;
    const midC = COLS / 2, midR = ROWS / 2;
    for (let ci = 0; ci < NCELL; ci++) if (cand[ci] && cand[ci].some(y => Math.round(y / 0.5) === modeK)) {
      const d = Math.hypot(ci % COLS - midC, ((ci / COLS) | 0) - midR);
      if (d < best) { const f = cand[ci].find(y => Math.round(y / 0.5) === modeK); if (slabFree(ci, f)) { best = d; seed = ci; } }
    }
    if (seed < 0) throw new Error('Could not find open ground in this model');
    const midSeed = seed;

    // flood fill connected walkable surfaces (can hop over obstacles up to ~1.1 m); keep the biggest
    progress('Tracing walkable area…'); await tick();
    const H = new Float32Array(NCELL).fill(NaN), WALK = new Uint8Array(NCELL), COMP = new Int32Array(NCELL).fill(-1);
    const MAXSTEP = 0.55, HOP = 1.1;
    const flood = (s0, y0, id) => {
      const q = [s0]; H[s0] = y0; WALK[s0] = 1; COMP[s0] = id;
      const take = (ni, y) => { WALK[ni] = 1; H[ni] = y; COMP[ni] = id; q.push(ni); };
      for (let qi = 0; qi < q.length; qi++) {
        const ci = q[qi], c = ci % COLS, r = (ci / COLS) | 0, f = H[ci];
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nc = c + dc, nr = r + dr; if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
          const ni = nr * COLS + nc; if (WALK[ni]) continue;
          let pickY = null, bd = Infinity;
          if (cand[ni]) for (const y of cand[ni]) { const d = Math.abs(y - f); if (d <= MAXSTEP && d < bd) { bd = d; pickY = y; } }
          if (pickY !== null && slabFree(ni, pickY)) { take(ni, pickY); continue; }
          // step up onto a low ledge / box (needs a jump)
          let up = null; if (cand[ni]) for (const y of cand[ni]) if (y > f + MAXSTEP && y <= f + HOP && (up === null || y < up)) up = y;
          if (up !== null && slabFree(ni, up)) { take(ni, up); continue; }
          // hop over a thin low barrier onto the floor beyond it
          const bc2 = nc + dc, br2 = nr + dr; if (bc2 < 0 || br2 < 0 || bc2 >= COLS || br2 >= ROWS) continue;
          const n2 = br2 * COLS + bc2; if (WALK[n2] || !cand[n2]) continue;
          if (bandTop(ni, f + 1.15, f + 2.2) > -Infinity) continue; // too tall to hop
          const top = bandTop(ni, f + 0.05, f + 1.15); if (top === -Infinity) continue;
          let land = null, ld = Infinity; for (const y of cand[n2]) { const d = Math.abs(y - f); if (d <= MAXSTEP && d < ld) { ld = d; land = y; } }
          if (land === null || !slabFree(n2, land)) continue;
          take(ni, Math.max(top, f + MAXSTEP + 0.05)); take(n2, land);
        }
        if (qi % 6000 === 0) { progress(`Tracing walkable area (${q.length} cells)…`); }
      }
      return q.length;
    };
    let compId = 0, bestComp = -1, bestSize = 0;
    // try seeds on the dominant floor level, biggest area wins
    const seeds = [];
    for (let ci = 0; ci < NCELL; ci++) if (cand[ci] && cand[ci].some(y => Math.round(y / 0.5) === modeK)) seeds.push(ci);
    seeds.sort((a, b) => Math.hypot(a % COLS - midC, ((a / COLS) | 0) - midR) - Math.hypot(b % COLS - midC, ((b / COLS) | 0) - midR));
    for (const s0 of seeds) {
      if (WALK[s0]) continue;
      const y0 = cand[s0].find(y => Math.round(y / 0.5) === modeK);
      if (!slabFree(s0, y0)) continue;
      const n = flood(s0, y0, compId);
      if (n > bestSize) { bestSize = n; bestComp = compId; seed = s0; }
      compId++;
      if (compId % 20 === 0) { progress(`Tracing walkable area (${compId} regions)…`); await tick(); }
    }
    for (let ci = 0; ci < NCELL; ci++) if (WALK[ci] && COMP[ci] !== bestComp) { WALK[ci] = 0; H[ci] = NaN; }
    // crop huge empty fields: keep the region where walls/buildings actually are
    {
      const B = Math.max(4, Math.round(6 / CELL)), BC = Math.ceil(COLS / B), BR = Math.ceil(ROWS / B);
      const dens = new Uint16Array(BC * BR);
      for (let ci = 0; ci < NCELL; ci++) {
        if (WALK[ci]) continue; const c = ci % COLS, r = (ci / COLS) | 0;
        let adj = false; for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nc = c + dc, nr = r + dr; if (nc >= 0 && nr >= 0 && nc < COLS && nr < ROWS && WALK[nr * COLS + nc]) { adj = true; break; } }
        if (adj) dens[((r / B) | 0) * BC + ((c / B) | 0)]++;
      }
      const xs = [], zs = [];
      for (let i = 0; i < BC * BR; i++) if (dens[i] >= B) { xs.push(i % BC); zs.push((i / BC) | 0); }
      if (xs.length > 8) {
        xs.sort((a, b) => a - b); zs.sort((a, b) => a - b);
        const q = (a, t) => a[Math.floor(t * (a.length - 1))];
        const c0 = (q(xs, 0.03) - 1) * B, c1 = (q(xs, 0.97) + 2) * B, r0 = (q(zs, 0.03) - 1) * B, r1 = (q(zs, 0.97) + 2) * B;
        let cut = 0;
        for (let ci = 0; ci < NCELL; ci++) { const c = ci % COLS, r = (ci / COLS) | 0; if (WALK[ci] && (c < c0 || c >= c1 || r < r0 || r >= r1)) { WALK[ci] = 0; cut++; } }
        // keep the largest connected piece
        if (cut) {
          const comp = new Int32Array(NCELL).fill(-1); let bestC = -1, bestN = 0, id = 0;
          for (let s0 = 0; s0 < NCELL; s0++) {
            if (!WALK[s0] || comp[s0] >= 0) continue;
            const qq = [s0]; comp[s0] = id;
            for (let k = 0; k < qq.length; k++) { const ci = qq[k], c = ci % COLS, r = (ci / COLS) | 0; for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nc = c + dc, nr = r + dr; if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue; const ni = nr * COLS + nc; if (WALK[ni] && comp[ni] < 0 && Math.abs(H[ni] - H[ci]) <= HOP + 0.05) { comp[ni] = id; qq.push(ni); } } }
            if (qq.length > bestN) { bestN = qq.length; bestC = id; } id++;
          }
          for (let ci = 0; ci < NCELL; ci++) if (WALK[ci] && comp[ci] !== bestC) WALK[ci] = 0;
          if (!WALK[seed]) { for (let ci = 0; ci < NCELL; ci++) if (WALK[ci]) { seed = ci; break; } }
        }
      }
    }
    // obstacle heights for everything else
    const baseY = H[seed];
    for (let ci = 0; ci < NCELL; ci++) {
      if (WALK[ci]) continue;
      const c = ci % COLS, r = (ci / COLS) | 0;
      let nf = -Infinity;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const nc = c + dc, nr = r + dr; if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
        const ni = nr * COLS + nc; if (WALK[ni] && H[ni] > nf) nf = H[ni];
      }
      if (nf === -Infinity) { H[ci] = maxY[ci] > -1e8 ? Math.max(maxY[ci], baseY) : baseY; continue; }
      if (!isNaN(H[ci])) { H[ci] = nf + 12; continue; } // cropped boundary: invisible wall
      // highest geometry between knee height and 12m above the neighbouring floor
      let top = -Infinity;
      const bc = [(c + 0.5) * CELL, nf + 6.3, (r + 0.5) * CELL], bh = [CELL / 2 - 0.05, 5.95, CELL / 2 - 0.05];
      for (let b = cnt[ci]; b < cnt[ci + 1]; b++) {
        const o = bins[b] * 9;
        if (!triBox(bc, bh, [T[o], T[o + 1], T[o + 2]], [T[o + 3], T[o + 4], T[o + 5]], [T[o + 6], T[o + 7], T[o + 8]])) continue;
        top = Math.max(top, Math.min(Math.max(T[o + 1], T[o + 4], T[o + 7]), nf + 12));
      }
      H[ci] = top === -Infinity ? nf + 12 : Math.max(top, nf + 0.6);
    }
    // shift so the main floor sits at y = 0
    for (let ci = 0; ci < NCELL; ci++) H[ci] -= baseY;
    for (const pt of parts) for (let v = 1; v < pt.P.length; v += 3) pt.P[v] -= baseY;

    progress('Placing spawns and sites…'); await tick();
    const layout = autoLayout({ COLS, ROWS, CELL, H, WALK });

    // ---- merge render geometry per material ----
    const byMat = new Map();
    for (const pt of parts) {
      if (pt.hide) continue;
      if (!byMat.has(pt.mat)) byMat.set(pt.mat, []);
      byMat.get(pt.mat).push(pt);
    }
    const meshes = [];
    for (const [mi, list] of byMat) {
      let nv = 0, ni = 0; for (const pt of list) { nv += pt.P.length / 3; ni += pt.idx.length; }
      // split into chunks to keep buffers reasonable
      const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), col = new Float32Array(nv * 3).fill(1), idx = new Uint32Array(ni);
      let vo = 0, io = 0;
      for (const pt of list) {
        const n = pt.P.length / 3; pos.set(pt.P, vo * 3);
        if (pt.U) uv.set(pt.U, vo * 2);
        if (pt.N) nrm.set(pt.N, vo * 3);
        else { // flat normals from faces
          for (let i = 0; i < pt.idx.length; i += 3) {
            const a = pt.idx[i], b = pt.idx[i + 1], c = pt.idx[i + 2], P = pt.P;
            const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
            const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
            let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
            for (const v of [a, b, c]) { nrm[(vo + v) * 3] = nx; nrm[(vo + v) * 3 + 1] = ny; nrm[(vo + v) * 3 + 2] = nz; }
          }
        }
        for (let i = 0; i < pt.idx.length; i++) idx[io + i] = pt.idx[i] + vo;
        vo += n; io += pt.idx.length;
      }
      meshes.push({ geo: { p: pos, n: nrm, u: uv, c: col, i: idx }, mat: mats[mi] });
    }
    // images as blobs
    const images = (J.images || []).map(im => {
      if (im.bufferView === undefined) return null;
      const bv = J.bufferViews[im.bufferView];
      return new Blob([new Uint8Array(g.bin.buffer, g.bin.byteOffset + (bv.byteOffset || 0), bv.byteLength)], { type: im.mimeType || 'image/png' });
    });
    const info = J.asset && J.asset.extras ? J.asset.extras : {};
    return { meshes, images, grid: { COLS, ROWS, CELL, H, WALK }, layout, scale, info,
      stats: { tris: nT, parts: parts.length, walk: WALK.reduce((a, b) => a + b, 0), cells: NCELL } };
  }

  /* ---------- automatic spawns / sites ---------- */
  function autoLayout({ COLS, ROWS, CELL, H, WALK }) {
    const N = COLS * ROWS;
    const nb = (ci, fn) => {
      const c = ci % COLS, r = (ci / COLS) | 0;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dc, nr = r + dr; if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
        const ni = nr * COLS + nc; if (WALK[ni] && Math.abs(H[ni] - H[ci]) <= 1.16) fn(ni);
      }
    };
    const bfs = (src, limit = Infinity) => {
      const d = new Int32Array(N).fill(-1), par = new Int32Array(N).fill(-1), q = [];
      for (const s of [].concat(src)) { d[s] = 0; q.push(s); }
      for (let i = 0; i < q.length; i++) { const ci = q[i]; if (d[ci] >= limit) continue; nb(ci, ni => { if (d[ni] < 0) { d[ni] = d[ci] + 1; par[ni] = ci; q.push(ni); } }); }
      return { d, par, q };
    };
    const roomy = ci => { let n = 0; const c = ci % COLS, r = (ci / COLS) | 0; for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const ni = (r + dr) * COLS + c + dc; if (ni >= 0 && ni < N && WALK[ni] && Math.abs(H[ni] - H[ci]) < 0.3) n++; } return n === 9; };
    // keep spawns & sites away from the outer edges of the playable area
    let c0 = COLS, c1 = 0, r0 = ROWS, r1 = 0;
    for (let i = 0; i < N; i++) if (WALK[i]) { const c = i % COLS, r = (i / COLS) | 0; if (c < c0) c0 = c; if (c > c1) c1 = c; if (r < r0) r0 = r; if (r > r1) r1 = r; }
    const inner = (ci, k) => { const c = ci % COLS, r = (ci / COLS) | 0, mx = (c1 - c0) * k, mz = (r1 - r0) * k; return c >= c0 + mx && c <= c1 - mx && r >= r0 + mz && r <= r1 - mz; };
    let start = -1, sd = Infinity; const mc = (c0 + c1) / 2, mr = (r0 + r1) / 2;
    for (let i = 0; i < N; i++) if (WALK[i]) { const d = Math.hypot(i % COLS - mc, ((i / COLS) | 0) - mr); if (d < sd) { sd = d; start = i; } }
    const farInner = (b, k) => { for (let i = b.q.length - 1; i >= 0; i--) if (inner(b.q[i], k) && roomy(b.q[i])) return b.q[i]; return b.q[b.q.length - 1]; };
    const b0 = bfs(start); let P = farInner(b0, 0.1);
    const bP = bfs(P); let Q = farInner(bP, 0.1);
    const bQ = bfs(Q);
    const L = bP.d[Q];
    const xy = ci => [ci % COLS, (ci / COLS) | 0];
    // spawns: roomy cells near each end
    const spawnOf = (s, bs) => {
      // move spawn centre slightly inwards to a roomy area
      let ctr = s; for (const ci of bs.q) { if (bs.d[ci] > 8) break; if (roomy(ci)) { ctr = ci; if (bs.d[ci] >= 3) break; } }
      const area = bfs(ctr, Math.max(5, Math.round(4 / CELL)));
      return area.q.filter(roomy).length >= 6 ? area.q.filter(roomy) : area.q;
    };
    const Tspawn = spawnOf(P, bP), Dspawn = spawnOf(Q, bQ);
    // site candidates: closer to defenders, on reasonable routes, roomy
    const [px, pz] = xy(P), [qx, qz] = xy(Q), lx = qx - px, lz = qz - pz, ll = Math.hypot(lx, lz) || 1;
    const cands = [];
    for (let ci = 0; ci < N; ci++) {
      if (!WALK[ci] || bP.d[ci] < 0 || bQ.d[ci] < 0) continue;
      const dt = bP.d[ci], dd = bQ.d[ci], ratio = dd / (dt + dd);
      if (ratio < 0.18 || ratio > 0.42 || dt + dd > L * 1.45 || !roomy(ci) || !inner(ci, 0.07)) continue;
      // want some cover nearby (walls/crates within ~5 m), not an empty field
      let cover = 0; const cc0 = ci % COLS, rr0 = (ci / COLS) | 0, rad = Math.round(5 / CELL);
      for (let dr = -rad; dr <= rad; dr += 2) for (let dc = -rad; dc <= rad; dc += 2) { const nc = cc0 + dc, nr = rr0 + dr; if (nc >= 0 && nr >= 0 && nc < COLS && nr < ROWS && !WALK[nr * COLS + nc]) cover++; }
      if (cover < 3) continue;
      const [x, z] = xy(ci); const side = ((x - px) * lz - (z - pz) * lx) / ll;
      cands.push({ ci, side, ratio });
    }
    let A = null, B = null;
    if (cands.length) {
      A = cands.reduce((a, b) => b.side > a.side ? b : a);
      const bA = bfs(A.ci);
      B = cands.reduce((a, b) => (bA.d[b.ci] > bA.d[a.ci] ? b : a));
      if (bA.d[B.ci] < 12) B = null;
    }
    if (!A || !B) { // fallback: thirds along the diameter path
      const path = []; let c = Q; while (c >= 0) { path.push(c); c = bP.par[c]; }
      A = { ci: path[Math.floor(path.length * 0.3)] }; const bA = bfs(A.ci);
      let far = A.ci; for (const ci of bQ.q) { if (bQ.d[ci] > L * 0.45) break; if (bA.d[ci] > bA.d[far]) far = ci; }
      B = { ci: far };
    }
    const siteOf = ci => bfs(ci, Math.max(6, Math.round(5 / CELL))).q;
    const siteA = siteOf(A.ci), siteB = siteOf(B.ci);
    // mid: near the middle of the diameter, far from both sites
    let mid = P, mb = -Infinity; const bA2 = bfs(A.ci), bB2 = bfs(B.ci);
    for (let ci = 0; ci < N; ci++) { if (!WALK[ci] || bP.d[ci] < 0) continue; const ratio = bQ.d[ci] / (bP.d[ci] + bQ.d[ci] || 1); if (ratio < 0.4 || ratio > 0.62) continue; const s = Math.min(bA2.d[ci], bB2.d[ci]) - Math.abs(bP.d[ci] + bQ.d[ci] - L) * 0.5; if (s > mb) { mb = s; mid = ci; } }
    // entries: where attacker paths enter each site
    const entryOf = (siteCells, fromB) => {
      const set = new Set(siteCells), out = [];
      for (const b of fromB) {
        let c = siteCells[0]; const trail = [];
        while (c >= 0) { trail.push(c); c = b.par[c]; }
        // trail goes site -> source; first cell outside site + a few more
        let k = trail.findIndex(ci => !set.has(ci)); if (k < 0) continue;
        out.push(trail[Math.min(trail.length - 1, k + 3)]);
      }
      return out;
    };
    return {
      spawnT: Tspawn, spawnD: Dspawn, siteA, siteB, mid,
      entries: { A: entryOf(siteA, [bP, bB2]), B: entryOf(siteB, [bP, bA2]) },
      length: L,
    };
  }

  return { load };
})();
