// Generates the app icons from the owl's idle pose. Dependency-free (node:zlib
// only): shapes are sampled into polygons, scan-converted at a supersampled
// resolution, outlined with an exact Euclidean distance transform, box-filtered
// down and written as PNG. icon.ico holds PNG-encoded 16–256 px entries, and
// icon.icns (macOS) PNG-encoded 16–1024 px entries.
//
// Geometry and colours mirror src/baykus/owl.ts (owl units: the body box is
// 100 × 100 centred on the origin, y down). Each size is rendered on its own so
// small icons get their own detail level and a crisp outline.
//
//   node scripts/gen-icons.mjs

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src-tauri", "icons");

// ── Palette (see OWL_COLORS in src/baykus/owl.ts) ───────────────────────────

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const C = {
  outline: hex("#1B110A"),
  headTop: hex("#6E4428"),
  headBottom: hex("#8E5C36"),
  bodyTop: hex("#7C4D2D"),
  bodyBottom: hex("#C08952"),
  belly: hex("#D8AC72"),
  bellyMark: hex("#9B683B"),
  wing: hex("#5E3921"),
  wingTip: hex("#7A4B2B"),
  tuftInner: hex("#4A2B17"),
  disc: hex("#F3E3C6"),
  discRim: hex("#A9753F"),
  irisRim: hex("#2A170B"),
  iris: hex("#F7B52F"),
  pupil: hex("#140B05"),
  white: hex("#FFFFFF"),
  beak: hex("#DE8C45"),
  feet: hex("#D7934C"),
};

const mix = (a, b, t) => {
  t = Math.max(0, Math.min(1, t));
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
};

// ── Shape sampling (owl units) ──────────────────────────────────────────────

const TAU = Math.PI * 2;

function ellipse(cx, cy, rx, ry, n = 96) {
  const p = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    p.push(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry);
  }
  return p;
}

/** Tiny path builder that flattens quadratic / cubic curves. */
class Path {
  constructor(tf = (x, y) => [x, y]) {
    this.p = [];
    this.tf = tf;
    this.x = 0;
    this.y = 0;
  }
  moveTo(x, y) {
    this.x = x;
    this.y = y;
    this.p.push(...this.tf(x, y));
    return this;
  }
  lineTo(x, y) {
    return this.moveTo(x, y);
  }
  quad(cx, cy, x, y, n = 24) {
    const { x: x0, y: y0 } = this;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const m = 1 - t;
      this.p.push(...this.tf(m * m * x0 + 2 * m * t * cx + t * t * x, m * m * y0 + 2 * m * t * cy + t * t * y));
    }
    this.x = x;
    this.y = y;
    return this;
  }
  cubic(c1x, c1y, c2x, c2y, x, y, n = 32) {
    const { x: x0, y: y0 } = this;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const m = 1 - t;
      const a = m * m * m;
      const b = 3 * m * m * t;
      const c = 3 * m * t * t;
      const d = t * t * t;
      this.p.push(...this.tf(a * x0 + b * c1x + c * c2x + d * x, a * y0 + b * c1y + c * c2y + d * y));
    }
    this.x = x;
    this.y = y;
    return this;
  }
}

/** Canvas-style transform: translate(tx, ty) · scale(mirror, 1) · rotate(ang). */
function place(tx, ty, ang, mirror = 1) {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return (x, y) => [tx + mirror * (x * c - y * s), ty + x * s + y * c];
}

/** Thick polyline as round-capped segments (each its own polygon). */
function strokePolyline(pts, w) {
  const out = [];
  const r = w / 2;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const [x0, y0, x1, y1] = [pts[i], pts[i + 1], pts[i + 2], pts[i + 3]];
    const len = Math.hypot(x1 - x0, y1 - y0) || 1;
    const nx = (-(y1 - y0) / len) * r;
    const ny = ((x1 - x0) / len) * r;
    out.push([x0 + nx, y0 + ny, x1 + nx, y1 + ny, x1 - nx, y1 - ny, x0 - nx, y0 - ny]);
  }
  for (let i = 0; i < pts.length; i += 2) out.push(ellipse(pts[i], pts[i + 1], r, r, 16));
  return out;
}

// ── Scene: idle owl, facing forward ─────────────────────────────────────────

const HEAD_CY = -15;
const HEAD_A = 36;
const HEAD_B = 27;
const HEAD_N = 2.4;
const EYE_X = 13.8;
const EYE_Y = -15;
const EYE_R = 10.4;
const DISC_R = 16.6;

const headTopY = (x) => {
  const u = Math.min(1, Math.abs(x) / HEAD_A);
  return HEAD_CY - HEAD_B * Math.pow(1 - Math.pow(u, HEAD_N), 1 / HEAD_N);
};

function scene(size) {
  const small = size <= 32;
  const detail = size >= 48;
  const fine = size >= 128;
  const L = []; // { polys, color, alpha, sil }
  const add = (polys, color, alpha = 1, sil = false) => L.push({ polys, color, alpha, sil });

  // Feet.
  if (detail) {
    const feet = [];
    for (const side of [-1, 1]) for (const k of [-1, 0, 1]) feet.push(ellipse(side * 10 + k * 3.6, 48, 2.5, 2.1, 24));
    add(feet, C.feet, 1, true);
  }

  // Body (egg).
  const body = [];
  for (let i = 0; i < 128; i++) {
    const a = (i / 128) * TAU;
    body.push(30.5 * Math.cos(a) * (1 + 0.1 * Math.sin(a)), 16 + 32 * Math.sin(a));
  }
  add([body], (x, y) => mix(C.bodyTop, C.bodyBottom, (y + 2) / 50), 1, true);
  add([ellipse(0, 31, 19.5, 15.5)], C.belly, small ? 0.55 : 0.8);
  if (fine) {
    const marks = [];
    for (let r = 0; r < 3; r++) {
      const y = 23.5 + r * 7.5;
      const cnt = r % 2 === 0 ? 3 : 4;
      for (let k = 0; k < cnt; k++) {
        const x = (k - (cnt - 1) / 2) * 8;
        marks.push(...strokePolyline([x - 2.6, y - 1.3, x, y + 1.1, x + 2.6, y - 1.3], 1.3));
      }
    }
    add(marks, C.bellyMark);
  }

  // Wings (the right one mirrors the left).
  for (const side of [-1, 1]) {
    const w = new Path(place(side * 25, 12, 0.12, side < 0 ? 1 : -1));
    w.moveTo(0, -3).cubic(-9.5, 1, -10, 19, -1.5, 30.5).cubic(4.5, 22, 6, 5, 0, -3);
    add([w.p], (x, y) => mix(C.wing, C.wingTip, (y - 12) / 30), 1, true);
  }

  // Ear tufts, leaning outwards from the head's top corners.
  const tuftL = 15 * (small ? 1.25 : 1);
  for (const side of [-1, 1]) {
    const phi = side * 0.74;
    const bx = HEAD_A * Math.sin(phi);
    const by = headTopY(bx) + 3;
    const hw = 7.4 * (0.55 + 0.45 * Math.cos(phi));
    const tf = place(bx, by, 0.42, side);
    const outer = new Path(tf);
    outer.moveTo(-hw, 4).quad(-hw * 0.3, -tuftL * 0.5, hw * 0.15, -tuftL).quad(hw * 0.95, -tuftL * 0.42, hw, 4);
    add([outer.p], C.headTop, 1, true);
    if (detail) {
      const inner = new Path(tf);
      inner
        .moveTo(-hw * 0.05, 1)
        .quad(hw * 0.05, -tuftL * 0.5, hw * 0.13, -tuftL * 0.9)
        .quad(hw * 0.62, -tuftL * 0.42, hw * 0.55, 1);
      add([inner.p], C.tuftInner);
    }
  }

  // Head (superellipse).
  const head = [];
  const e = 2 / HEAD_N;
  for (let i = 0; i < 160; i++) {
    const a = (i / 160) * TAU;
    const c = Math.cos(a);
    const s = Math.sin(a);
    head.push(HEAD_A * Math.sign(c) * Math.pow(Math.abs(c), e), HEAD_CY + HEAD_B * Math.sign(s) * Math.pow(Math.abs(s), e));
  }
  add([head], (x, y) => mix(C.headTop, C.headBottom, (y + 44) / 56), 1, true);

  // Facial disc (heart shape: two circles and a chin wedge), with a rim.
  const disc = (R) => [
    ellipse(-EYE_X, EYE_Y, R, R),
    ellipse(EYE_X, EYE_Y, R, R),
    [EYE_X - R * 0.62, EYE_Y + R * 0.78, 0, EYE_Y + R + 4.5, -EYE_X + R * 0.62, EYE_Y + R * 0.78],
  ];
  if (detail) add(disc(DISC_R + 1.8), C.discRim);
  add(disc(DISC_R), C.disc);

  // Eyes. Below 32 px a dark iris rim fuses both eyes into one band, so the
  // tray sizes rely on the cream disc for contrast instead.
  const rim = size <= 24 ? 0 : small ? 0.9 : 1.6;
  const pr = EYE_R * (size <= 24 ? 0.62 : small ? 0.58 : 0.54);
  for (const side of [-1, 1]) {
    const x = side * EYE_X;
    if (rim > 0) add([ellipse(x, EYE_Y, EYE_R + rim, EYE_R + rim)], C.irisRim);
    add([ellipse(x, EYE_Y, EYE_R, EYE_R)], C.iris);
    add([ellipse(x, EYE_Y + 0.4, pr, pr)], C.pupil);
    const hr = EYE_R * (small ? 0.25 : 0.21);
    add([ellipse(x - EYE_R * 0.27, EYE_Y - EYE_R * 0.3 + 0.4, hr, hr, 32)], C.white);
    if (fine) add([ellipse(x + EYE_R * 0.2, EYE_Y + EYE_R * 0.22 + 0.4, EYE_R * 0.09, EYE_R * 0.09, 24)], C.white, 0.8);
  }

  // Beak.
  const bw = small ? 5 : 4.5;
  const beak = new Path();
  beak.moveTo(-bw, -9).quad(0, -11.4, bw, -9).quad(bw * 0.78, -3.4, 0, 1.2).quad(-bw * 0.78, -3.4, -bw, -9);
  add([beak.p], C.beak);

  return L;
}

// ── Rasteriser ──────────────────────────────────────────────────────────────

/** Nonzero scanline fill of one polygon (pixel coords); calls visit(index). */
function fillPoly(poly, M, visit) {
  const n = poly.length / 2;
  let ymin = Infinity;
  let ymax = -Infinity;
  for (let i = 1; i < poly.length; i += 2) {
    ymin = Math.min(ymin, poly[i]);
    ymax = Math.max(ymax, poly[i]);
  }
  const r0 = Math.max(0, Math.floor(ymin));
  const r1 = Math.min(M - 1, Math.ceil(ymax));
  const xs = [];
  for (let row = r0; row <= r1; row++) {
    const y = row + 0.5;
    xs.length = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const y0 = poly[2 * i + 1];
      const y1 = poly[2 * j + 1];
      if (y0 === y1) continue;
      if ((y >= y0 && y < y1) || (y >= y1 && y < y0)) {
        const x0 = poly[2 * i];
        const x1 = poly[2 * j];
        xs.push({ x: x0 + ((y - y0) * (x1 - x0)) / (y1 - y0), d: y1 > y0 ? 1 : -1 });
      }
    }
    xs.sort((a, b) => a.x - b.x);
    let wind = 0;
    for (let k = 0; k < xs.length - 1; k++) {
      wind += xs[k].d;
      if (wind === 0) continue;
      const c0 = Math.max(0, Math.ceil(xs[k].x - 0.5));
      const c1 = Math.min(M - 1, Math.ceil(xs[k + 1].x - 0.5) - 1);
      for (let c = c0; c <= c1; c++) visit(row * M + c);
    }
  }
}

/** Felzenszwalb–Huttenlocher 1-D squared distance transform. */
function dt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

function distance2(mask, M) {
  const f = new Float64Array(M * M);
  for (let i = 0; i < f.length; i++) f[i] = mask[i] ? 0 : 1e20;
  const col = new Float64Array(M);
  const d = new Float64Array(M);
  const v = new Int32Array(M);
  const z = new Float64Array(M + 1);
  for (let x = 0; x < M; x++) {
    for (let y = 0; y < M; y++) col[y] = f[y * M + x];
    dt1d(col, M, d, v, z);
    for (let y = 0; y < M; y++) f[y * M + x] = d[y];
  }
  for (let y = 0; y < M; y++) {
    for (let x = 0; x < M; x++) col[x] = f[y * M + x];
    dt1d(col, M, d, v, z);
    for (let x = 0; x < M; x++) f[y * M + x] = d[x];
  }
  return f;
}

function render(size) {
  const ss = size <= 32 ? 8 : size <= 128 ? 6 : size <= 256 ? 4 : 3;
  const M = size * ss;
  const outline = size <= 16 ? 1 : 0.85 + size / 64; // output px
  const margin = Math.max(0.5, size * 0.02);
  // Owl spans roughly y −52..50 and x −38..38 units.
  const k = ((size - 2 * (outline + margin)) / 103) * ss;
  const cx = M / 2;
  const cy = M / 2 + 1 * k;
  const toPx = (poly) => {
    const out = new Float64Array(poly.length);
    for (let i = 0; i < poly.length; i += 2) {
      out[i] = cx + poly[i] * k;
      out[i + 1] = cy + poly[i + 1] * k;
    }
    return out;
  };

  const layers = scene(size);
  const rgba = new Float32Array(M * M * 4); // premultiplied, 0..1

  // Outline: every pixel within `outline` of the silhouette.
  const sil = new Uint8Array(M * M);
  for (const L of layers) if (L.sil) for (const p of L.polys) fillPoly(toPx(p), M, (i) => (sil[i] = 1));
  const d2 = distance2(sil, M);
  const r2 = (outline * ss) ** 2;
  const [or, og, ob] = C.outline;
  for (let i = 0; i < M * M; i++) {
    if (d2[i] <= r2) {
      rgba[4 * i] = or / 255;
      rgba[4 * i + 1] = og / 255;
      rgba[4 * i + 2] = ob / 255;
      rgba[4 * i + 3] = 1;
    }
  }

  // Layers, back to front (source-over).
  for (const L of layers) {
    const a = L.alpha;
    const flat = typeof L.color === "function" ? null : L.color;
    for (const p of L.polys) {
      fillPoly(toPx(p), M, (i) => {
        let c = flat;
        if (c === null) {
          const x = ((i % M) + 0.5 - cx) / k;
          const y = (Math.floor(i / M) + 0.5 - cy) / k;
          c = L.color(x, y);
        }
        const j = 4 * i;
        const inv = 1 - a;
        rgba[j] = rgba[j] * inv + (c[0] / 255) * a;
        rgba[j + 1] = rgba[j + 1] * inv + (c[1] / 255) * a;
        rgba[j + 2] = rgba[j + 2] * inv + (c[2] / 255) * a;
        rgba[j + 3] = rgba[j + 3] * inv + a;
      });
    }
  }

  // Box-filter down to the target size.
  const out = Buffer.alloc(size * size * 4);
  const n = ss * ss;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let al = 0;
      for (let sy = 0; sy < ss; sy++) {
        let j = 4 * ((y * ss + sy) * M + x * ss);
        for (let sx = 0; sx < ss; sx++, j += 4) {
          r += rgba[j];
          g += rgba[j + 1];
          b += rgba[j + 2];
          al += rgba[j + 3];
        }
      }
      const o = 4 * (y * size + x);
      if (al > 0) {
        out[o] = Math.round((r / al) * 255);
        out[o + 1] = Math.round((g / al) * 255);
        out[o + 2] = Math.round((b / al) * 255);
      }
      out[o + 3] = Math.round((al / n) * 255);
    }
  }
  return out;
}

// ── PNG / ICO encoders ──────────────────────────────────────────────────────

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function ico(entries) {
  const head = Buffer.alloc(6 + 16 * entries.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2); // icon
  head.writeUInt16LE(entries.length, 4);
  let offset = head.length;
  entries.forEach(({ size, data }, i) => {
    const o = 6 + 16 * i;
    head[o] = size >= 256 ? 0 : size;
    head[o + 1] = size >= 256 ? 0 : size;
    head[o + 2] = 0; // palette
    head[o + 3] = 0;
    head.writeUInt16LE(1, o + 4); // planes
    head.writeUInt16LE(32, o + 6); // bpp
    head.writeUInt32LE(data.length, o + 8);
    head.writeUInt32LE(offset, o + 12);
    offset += data.length;
  });
  return Buffer.concat([head, ...entries.map((e) => e.data)]);
}

/** macOS .icns: a "icns" header, then (type, length, PNG) entries. */
function icns(entries) {
  const parts = entries.map(({ type, data }) => {
    const head = Buffer.alloc(8);
    head.write(type, 0, "ascii");
    head.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([head, data]);
  });
  const head = Buffer.alloc(8);
  head.write("icns", 0, "ascii");
  head.writeUInt32BE(8 + parts.reduce((n, b) => n + b.length, 0), 4);
  return Buffer.concat([head, ...parts]);
}

// ── Main ────────────────────────────────────────────────────────────────────

mkdirSync(OUT, { recursive: true });
const cache = new Map();
const pngOf = (size) => {
  if (!cache.has(size)) cache.set(size, png(size, render(size)));
  return cache.get(size);
};

const files = [
  ["32x32.png", 32],
  ["128x128.png", 128],
  ["128x128@2x.png", 256],
  ["icon.png", 512],
];
for (const [name, size] of files) {
  writeFileSync(join(OUT, name), pngOf(size));
  console.log(`${name.padEnd(16)} ${size}×${size}`);
}
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
writeFileSync(join(OUT, "icon.ico"), ico(icoSizes.map((size) => ({ size, data: pngOf(size) }))));
console.log(`icon.ico         ${icoSizes.join("/")}`);

// Every slot macOS looks for, plain and @2x.
const icnsEntries = [
  ["icp4", 16],
  ["icp5", 32],
  ["icp6", 64],
  ["ic07", 128],
  ["ic08", 256],
  ["ic09", 512],
  ["ic10", 1024],
  ["ic11", 32],
  ["ic12", 64],
  ["ic13", 256],
  ["ic14", 512],
];
writeFileSync(join(OUT, "icon.icns"), icns(icnsEntries.map(([type, size]) => ({ type, data: pngOf(size) }))));
console.log(`icon.icns        ${[...new Set(icnsEntries.map(([, size]) => size))].sort((x, y) => x - y).join("/")}`);
