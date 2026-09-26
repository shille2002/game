/* =========================================================
   RIFTLINE mini engine — tiny WebGL2 renderer, no dependencies
   (lit + shadowed meshes, sky, fog, sprites, additive fx)
   ========================================================= */
'use strict';

/* ---------------- math ---------------- */
const M4 = {
  create() { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; },
  identity(m) { m.fill(0); m[0] = m[5] = m[10] = m[15] = 1; return m; },
  copy(o, a) { o.set(a); return o; },
  mul(o, a, b) {
    const t = M4._t;
    for (let c = 0; c < 4; c++) {
      const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
      t[c * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
      t[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
      t[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
      t[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
    }
    o.set(t); return o;
  },
  perspective(o, fovy, aspect, n, f) {
    const t = 1 / Math.tan(fovy / 2); o.fill(0);
    o[0] = t / aspect; o[5] = t; o[10] = (f + n) / (n - f); o[11] = -1; o[14] = 2 * f * n / (n - f); return o;
  },
  ortho(o, l, r, b, t, n, f) {
    o.fill(0); o[0] = 2 / (r - l); o[5] = 2 / (t - b); o[10] = -2 / (f - n);
    o[12] = -(r + l) / (r - l); o[13] = -(t + b) / (t - b); o[14] = -(f + n) / (f - n); o[15] = 1; return o;
  },
  lookAt(o, ex, ey, ez, cx, cy, cz, ux, uy, uz) {
    let zx = ex - cx, zy = ey - cy, zz = ez - cz; let l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l;
    let xx = uy * zz - uz * zy, xy = uz * zx - ux * zz, xz = ux * zy - uy * zx; l = Math.hypot(xx, xy, xz); xx /= l; xy /= l; xz /= l;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    o[0] = xx; o[1] = yx; o[2] = zx; o[3] = 0; o[4] = xy; o[5] = yy; o[6] = zy; o[7] = 0;
    o[8] = xz; o[9] = yz; o[10] = zz; o[11] = 0;
    o[12] = -(xx * ex + xy * ey + xz * ez); o[13] = -(yx * ex + yy * ey + yz * ez); o[14] = -(zx * ex + zy * ey + zz * ez); o[15] = 1; return o;
  },
  invert(o, a) {
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3], a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7],
      a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11], a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11,
      b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30,
      b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06; if (!det) return null; det = 1 / det;
    o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det; o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det; o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det; o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det; o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det; o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det; o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det; o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det; o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det; return o;
  },
  // in-place post-multiplications (like gl-matrix)
  translate(m, x, y, z) {
    m[12] += m[0] * x + m[4] * y + m[8] * z; m[13] += m[1] * x + m[5] * y + m[9] * z;
    m[14] += m[2] * x + m[6] * y + m[10] * z; m[15] += m[3] * x + m[7] * y + m[11] * z; return m;
  },
  scale(m, x, y, z) { for (let i = 0; i < 4; i++) { m[i] *= x; m[4 + i] *= y; m[8 + i] *= z; } return m; },
  rotateY(m, a) {
    const s = Math.sin(a), c = Math.cos(a);
    for (let i = 0; i < 4; i++) { const x = m[i], z = m[8 + i]; m[i] = x * c - z * s; m[8 + i] = x * s + z * c; } return m;
  },
  rotateX(m, a) {
    const s = Math.sin(a), c = Math.cos(a);
    for (let i = 0; i < 4; i++) { const y = m[4 + i], z = m[8 + i]; m[4 + i] = y * c + z * s; m[8 + i] = z * c - y * s; } return m;
  },
  rotateZ(m, a) {
    const s = Math.sin(a), c = Math.cos(a);
    for (let i = 0; i < 4; i++) { const x = m[i], y = m[4 + i]; m[i] = x * c + y * s; m[4 + i] = y * c - x * s; } return m;
  },
  _t: new Float32Array(16),
};

function hex(h, a = 1) { // sRGB hex -> linear rgba
  const f = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return [f((h >> 16) & 255), f((h >> 8) & 255), f(h & 255), a];
}

/* ---------------- geometry builder ---------------- */
class Geo {
  constructor() { this.p = []; this.n = []; this.u = []; this.c = []; this.i = []; }
  quad(v0, v1, v2, v3, n, uv, col = [1, 1, 1]) {
    const b = this.p.length / 3;
    for (const v of [v0, v1, v2, v3]) { this.p.push(v[0], v[1], v[2]); this.n.push(n[0], n[1], n[2]); this.c.push(col[0], col[1], col[2]); }
    for (const t of uv) this.u.push(t[0], t[1]);
    this.i.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  // uvf(faceNormal, vertex) -> [u,v]; default: 0..1 per face
  box(x0, y0, z0, x1, y1, z1, col, uvf, skipBottom = true) {
    const F = [
      [[1, 0, 0], [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]]],
      [[-1, 0, 0], [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]]],
      [[0, 1, 0], [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]]],
      [[0, -1, 0], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]],
      [[0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]],
      [[0, 0, -1], [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]]],
    ];
    const def = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (const [n, vs] of F) {
      if (skipBottom && n[1] === -1) continue;
      const uv = uvf ? vs.map(v => uvf(n, v)) : def;
      this.quad(vs[0], vs[1], vs[2], vs[3], n, uv, col);
    }
  }
  cylinder(r, h, seg = 16, col = [1, 1, 1]) { // along Y, centered at origin base y=0
    for (let s = 0; s < seg; s++) {
      const a0 = s / seg * Math.PI * 2, a1 = (s + 1) / seg * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const am = (a0 + a1) / 2;
      this.quad([c0 * r, 0, s0 * r], [c0 * r, h, s0 * r], [c1 * r, h, s1 * r], [c1 * r, 0, s1 * r],
        [Math.cos(am), 0, Math.sin(am)], [[s / seg, 0], [s / seg, 1], [(s + 1) / seg, 1], [(s + 1) / seg, 0]], col);
      this.quad([0, h, 0], [0, h, 0], [c1 * r, h, s1 * r], [c0 * r, h, s0 * r], [0, 1, 0], [[.5, .5], [.5, .5], [.5, .5], [.5, .5]], col);
    }
  }
}

/* ---------------- shaders ---------------- */
const VS_LIT = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNrm; layout(location=2) in vec2 aUv; layout(location=3) in vec3 aCol;
uniform mat4 uModel, uVP, uLightVP;
out vec3 vN; out vec2 vUv; out vec3 vCol; out vec3 vW; out vec4 vL;
void main(){ vec4 w = uModel*vec4(aPos,1.0); vW=w.xyz; vN=mat3(uModel)*aNrm; vUv=aUv; vCol=aCol; vL=uLightVP*w; gl_Position=uVP*w; }`;

const FS_LIT = `#version 300 es
precision highp float; precision highp sampler2DShadow;
in vec3 vN; in vec2 vUv; in vec3 vCol; in vec3 vW; in vec4 vL;
uniform sampler2D uTex; uniform sampler2DShadow uShadow;
uniform vec4 uColor; uniform vec3 uEmis; uniform vec3 uSunDir, uSunCol, uSky, uGround, uFog, uCam;
uniform vec2 uFogRange; uniform float uUseShadow, uUnlit, uFogOn, uAlphaCut;
out vec4 o;
vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.0,1.0); }
float shadowF(){
  vec3 p = vL.xyz/vL.w*0.5+0.5;
  if(p.z>1.0||p.x<0.0||p.x>1.0||p.y<0.0||p.y>1.0) return 1.0;
  vec2 ts = 1.0/vec2(textureSize(uShadow,0)); float s=0.0;
  for(int x=-1;x<=1;x++) for(int y=-1;y<=1;y++) s += texture(uShadow, vec3(p.xy+vec2(x,y)*ts, p.z-0.0009));
  return s/9.0;
}
void main(){
  vec4 base = texture(uTex, vUv) * uColor * vec4(vCol,1.0);
  if(base.a < uAlphaCut) discard;
  vec3 c;
  if(uUnlit > 0.5){ c = base.rgb; }
  else {
    vec3 n = normalize(vN);
    float d = max(dot(n, uSunDir), 0.0);
    float sh = uUseShadow > 0.5 ? shadowF() : 1.0;
    vec3 hemi = mix(uGround, uSky, n.y*0.5+0.5);
    c = base.rgb * (hemi + uSunCol*d*sh);
  }
  c += uEmis;
  if(uFogOn > 0.5){ float f = smoothstep(uFogRange.x, uFogRange.y, length(vW-uCam)); c = mix(c, uFog, f); }
  c = aces(c*0.95);
  o = vec4(pow(c, vec3(1.0/2.2)), base.a);
}`;

const VS_DEPTH = `#version 300 es
layout(location=0) in vec3 aPos; uniform mat4 uModel, uLightVP;
void main(){ gl_Position = uLightVP*uModel*vec4(aPos,1.0); }`;
const FS_DEPTH = `#version 300 es
precision mediump float; out vec4 o; void main(){ o=vec4(1.0); }`;

const VS_SKY = `#version 300 es
out vec2 vP; void main(){ vec2 p = vec2((gl_VertexID<<1)&2, gl_VertexID&2)*2.0-1.0; vP=p; gl_Position=vec4(p,0.9999,1.0); }`;
const FS_SKY = `#version 300 es
precision highp float; in vec2 vP; uniform mat4 uInvVP; uniform vec3 uCam, uSunDir; out vec4 o;
void main(){
  vec4 w = uInvVP*vec4(vP,1.0,1.0); vec3 d = normalize(w.xyz/w.w - uCam);
  vec3 zen = vec3(0.23,0.46,0.78), hor = vec3(0.96,0.84,0.72), gnd = vec3(0.55,0.5,0.45);
  float h = d.y;
  vec3 c = mix(hor, zen, pow(clamp(h,0.0,1.0),0.55));
  c = mix(c, gnd, clamp(-h*6.0,0.0,1.0));
  float s = max(dot(d,uSunDir),0.0);
  c += vec3(1.0,0.85,0.6)*(pow(s,600.0)*3.0 + pow(s,12.0)*0.25);
  o = vec4(c,1.0);
}`;

/* ---------------- renderer ---------------- */
class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: true, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 not supported');
    this.gl = gl; this.canvas = canvas;
    this.lit = this.program(VS_LIT, FS_LIT);
    this.depth = this.program(VS_DEPTH, FS_DEPTH);
    this.sky = this.program(VS_SKY, FS_SKY);
    this.skyVao = gl.createVertexArray();
    this.white = this.texture(null);
    this.queue = []; this.pool = [];
    this.vp = M4.create(); this.view = M4.create(); this.proj = M4.create(); this.invVP = M4.create();
    this.lightVP = M4.create(); this.cam = [0, 0, 0];
    this.sunDir = norm3([-0.42, 0.78, 0.46]);
    this.sunCol = [1.75, 1.55, 1.3]; this.skyCol = [0.36, 0.42, 0.52]; this.groundCol = [0.24, 0.21, 0.18];
    this.fog = [0.86, 0.78, 0.7]; this.fogRange = [70, 260];
    // shadow map
    this.shadowSize = 2048;
    this.shadowTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, this.shadowSize, this.shadowSize);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    this.shadowFb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowTex, 0);
    gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.loc = {};
    for (const n of ['uModel', 'uVP', 'uLightVP', 'uTex', 'uShadow', 'uColor', 'uEmis', 'uSunDir', 'uSunCol', 'uSky', 'uGround', 'uFog', 'uCam', 'uFogRange', 'uUseShadow', 'uUnlit', 'uFogOn', 'uAlphaCut'])
      this.loc[n] = gl.getUniformLocation(this.lit, n);
    this.dloc = { uModel: gl.getUniformLocation(this.depth, 'uModel'), uLightVP: gl.getUniformLocation(this.depth, 'uLightVP') };
    this.sloc = { uInvVP: gl.getUniformLocation(this.sky, 'uInvVP'), uCam: gl.getUniformLocation(this.sky, 'uCam'), uSunDir: gl.getUniformLocation(this.sky, 'uSunDir') };
    this.stats = { draws: 0 };
  }
  program(vs, fs) {
    const gl = this.gl, p = gl.createProgram();
    for (const [t, s] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
      const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
      gl.attachShader(p, sh);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }
  mesh(geo) {
    const gl = this.gl, vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const buf = (data, loc, size) => {
      const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    };
    buf(geo.p, 0, 3); buf(geo.n, 1, 3); buf(geo.u, 2, 2); buf(geo.c, 3, 3);
    const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    const big = geo.p.length / 3 > 65535;
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, big ? new Uint32Array(geo.i) : new Uint16Array(geo.i), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, count: geo.i.length, type: big ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT };
  }
  texture(src, { repeat = true, mips = true, srgb = true, flipY = true } = {}) {
    const gl = this.gl, t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flipY);
    if (!src) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    else gl.texImage2D(gl.TEXTURE_2D, 0, srgb ? gl.SRGB8_ALPHA8 : gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    const w = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, w); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, w);
    if (src && mips) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      const ext = gl.getExtension('EXT_texture_filter_anisotropic');
      if (ext) gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    } else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return t;
  }
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.floor(this.canvas.clientWidth * dpr), h = Math.floor(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
  }
  setCamera(pos, yaw, pitch, fovy, near = 0.05, far = 700) {
    const aspect = this.canvas.width / this.canvas.height;
    M4.perspective(this.proj, fovy, aspect, near, far);
    const v = M4.identity(this.view);
    M4.rotateX(v, -pitch); M4.rotateY(v, -yaw); M4.translate(v, -pos[0], -pos[1], -pos[2]);
    M4.mul(this.vp, this.proj, this.view); M4.invert(this.invVP, this.vp);
    this.cam = pos.slice();
    this.camYaw = yaw; this.camPitch = pitch;
  }
  setLight(cx, cz, half) {
    const d = this.sunDir, v = M4.create(), p = M4.create(), dist = half * 1.5 + 60;
    M4.lookAt(v, cx + d[0] * dist, d[1] * dist, cz + d[2] * dist, cx, 0, cz, 0, 1, 0);
    M4.ortho(p, -half, half, -half, half, 1, dist * 2 + 60);
    M4.mul(this.lightVP, p, v);
  }
  // queue a draw. opts: tex, color, emis, mode ('lit'|'unlit'|'add'|'alpha'), cast, layer ('world'|'vm'), fog
  draw(mesh, model, o = {}) {
    const it = this.pool.pop() || { m: new Float32Array(16) };
    it.mesh = mesh; it.m.set(model);
    it.tex = o.tex || this.white; it.color = o.color || WHITE4; it.emis = o.emis || ZERO3;
    it.mode = o.mode || 'lit'; it.cast = o.cast !== false && it.mode === 'lit'; it.layer = o.layer || 'world';
    it.fog = o.fog !== false; it.shadow = o.shadow !== false; it.depthWrite = o.depthWrite; it.cut = o.alphaCut || 0.01; it.noCull = !!o.noCull;
    this.queue.push(it);
  }
  render(vmProj, vmView) {
    const gl = this.gl, L = this.loc; this.stats.draws = 0;
    // shadow pass
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFb);
    gl.viewport(0, 0, this.shadowSize, this.shadowSize);
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
    gl.useProgram(this.depth); gl.uniformMatrix4fv(this.dloc.uLightVP, false, this.lightVP);
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(2, 4);
    for (const it of this.queue) if (it.cast && it.layer === 'world') {
      if (it.noCull) gl.disable(gl.CULL_FACE); else gl.enable(gl.CULL_FACE);
      gl.uniformMatrix4fv(this.dloc.uModel, false, it.m); gl.bindVertexArray(it.mesh.vao);
      gl.drawElements(gl.TRIANGLES, it.mesh.count, it.mesh.type, 0);
    }
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // sky
    gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
    gl.useProgram(this.sky);
    gl.uniformMatrix4fv(this.sloc.uInvVP, false, this.invVP); gl.uniform3fv(this.sloc.uCam, this.cam); gl.uniform3fv(this.sloc.uSunDir, this.sunDir);
    gl.bindVertexArray(this.skyVao); gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
    // lit program common uniforms
    gl.useProgram(this.lit);
    gl.uniform3fv(L.uSunDir, this.sunDir); gl.uniform3fv(L.uSunCol, this.sunCol); gl.uniform3fv(L.uSky, this.skyCol);
    gl.uniform3fv(L.uGround, this.groundCol); gl.uniform3fv(L.uFog, this.fog); gl.uniform2fv(L.uFogRange, this.fogRange);
    gl.uniformMatrix4fv(L.uLightVP, false, this.lightVP);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.shadowTex); gl.uniform1i(L.uShadow, 1);
    gl.uniform1i(L.uTex, 0);
    const pass = (layer, VP, camPos) => {
      gl.uniformMatrix4fv(L.uVP, false, VP); gl.uniform3fv(L.uCam, camPos);
      for (const phase of ['opaque', 'alpha', 'add']) {
        if (phase === 'opaque') { gl.disable(gl.BLEND); gl.depthMask(true); gl.enable(gl.CULL_FACE); }
        else if (phase === 'alpha') { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); gl.disable(gl.CULL_FACE); }
        else { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE); gl.depthMask(false); gl.disable(gl.CULL_FACE); }
        for (const it of this.queue) {
          if (it.layer !== layer) continue;
          const ph = (it.mode === 'lit' || it.mode === 'unlit') ? 'opaque' : it.mode;
          if (ph !== phase) continue;
          gl.uniformMatrix4fv(L.uModel, false, it.m);
          if (phase === 'opaque') { if (it.noCull) gl.disable(gl.CULL_FACE); else gl.enable(gl.CULL_FACE); }
          gl.uniform1f(L.uAlphaCut, it.cut);
          gl.uniform4fv(L.uColor, it.color); gl.uniform3fv(L.uEmis, it.emis);
          gl.uniform1f(L.uUnlit, it.mode === 'lit' ? 0 : 1);
          gl.uniform1f(L.uUseShadow, (layer === 'world' && it.shadow) ? 1 : 0);
          gl.uniform1f(L.uFogOn, (layer === 'world' && it.fog && it.mode !== 'add') ? 1 : 0);
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, it.tex);
          gl.bindVertexArray(it.mesh.vao); gl.drawElements(gl.TRIANGLES, it.mesh.count, it.mesh.type, 0);
          this.stats.draws++;
        }
      }
      gl.depthMask(true); gl.disable(gl.BLEND);
    };
    pass('world', this.vp, this.cam);
    if (vmProj) {
      gl.clear(gl.DEPTH_BUFFER_BIT);
      const vp = M4.create(); M4.mul(vp, vmProj, vmView);
      pass('vm', vp, this.cam);
    }
    for (const it of this.queue) this.pool.push(it);
    this.queue.length = 0;
  }
}
const WHITE4 = [1, 1, 1, 1], ZERO3 = [0, 0, 0];
function norm3(v) { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; }

/* ---------------- canvas textures ---------------- */
function makeCanvas(w, h, draw) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d'); draw(g, w, h); return cv;
}
function addNoise(g, w, h, amt) {
  const img = g.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * amt; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(img, 0, 0);
}
function blotches(g, w, h, n, col, rmin, rmax, alpha) {
  for (let i = 0; i < n; i++) {
    const x = Math.random() * w, y = Math.random() * h, r = rmin + Math.random() * (rmax - rmin);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, col.replace('A', alpha)); gr.addColorStop(1, col.replace('A', 0));
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
}
