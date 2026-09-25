// HOLM — the page's 3D scene.
// One Three.js scene renders the hand-turned walnut valet tray for the whole editorial: it opens as a
// top-down photograph on a cutting mat with the tools of the craft (HERO), then the set falls away and
// the tray floats alone in warm darkness, turning through REVEAL, PROFILE and DETAIL before settling
// into the REST plate. Every surface is procedural — walnut colour / bump / roughness, the mat, the brass
// ruler and the maker's stamp are canvas textures drawn once from seeded noise — so nothing is downloaded
// and every run is pixel-identical. Public API and keyframe table: _panel/SCENE-CONTRACT.md.
//
//   import createScene from '/assets/js/scene.js';
//   const scene = createScene(canvas, { reducedMotion, static });
//   scene.setProgress(p) · setPointer(nx, ny) · setViewOverride(name) · setSpin(on)
//   scene.resize(w, h, dpr) · render() · start() · stop() · dispose()

import * as THREE from 'three';
import { RoomEnvironment } from './vendor/RoomEnvironment.js';

const DEG = Math.PI / 180;
const FOV = 30;              // long-ish lens: editorial product photography, little distortion
const MAX_H = 0.58;          // on landscape screens the tray never spans more than this fraction of the viewport height
const TRAY_D = 2.0;          // 1 unit = 100 mm → Ø 200 mm
const VOID = 0x100904;       // page background; fog fades the far rim toward it
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

// Piecewise eased interpolation over [p, value] keys (smoothstep between neighbours: no pops).
function track(keys, p) {
  if (p <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (p <= keys[i][0]) {
      const k0 = keys[i - 1], k1 = keys[i];
      return lerp(k0[1], k1[1], smooth((p - k0[0]) / (k1[0] - k0[0])));
    }
  }
  return keys[keys.length - 1][1];
}

// Deterministic PRNG / integer hash so every build of the textures is identical.
function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
function hash(i) {
  let x = Math.imul(i | 0, 374761393) + 668265263;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/* ------------------------------------------------------------------ canvases */

function makeCanvas(w, h, readback = false) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', readback ? { willReadFrequently: true } : undefined);
  return [c, ctx];
}

function tex(canvas, { srgb = true, repeat = null, anisotropy = 1 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  t.anisotropy = anisotropy;
  return t;
}

// American black walnut, hardwax-oiled. Planar-projected onto the tray (the grain of a turned board runs
// straight across the disc): base #3a2416, latewood lines toward #24150c, earlywood glow toward #5c3b22,
// open pores as short dashes. Growth rings get a per-ring hashed width/strength (many soft, a few strong)
// and a very slow spacing drift so the pattern never reads as a printed stripe.
// Returns { color, data }: `data` packs bump height (R) and roughness (G) derived from the SAME grain,
// plus concentric turning marks on the pocket floor (in planar space, so they are exactly concentric).
const WALNUT = { base: '#3a2416', glowLight: '92,59,34', glowDark: '36,21,12', late: '36,21,12', lateDark: '20,11,6', early: '92,59,34', poreLight: '110,72,42', poreDark: '28,16,9' };
const OAK = { base: '#c9a76e', glowLight: '232,205,150', glowDark: '150,112,62', late: '150,110,62', lateDark: '118,84,44', early: '236,212,158', poreLight: '196,160,104', poreDark: '124,90,50' };
function makeWoodCanvases(size, floor, pal = WALNUT) {
  const [c, ctx] = makeCanvas(size, size, true);
  const R = rng(1917);
  ctx.fillStyle = pal.base;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 18; i++) {                      // broad tonal drift
    const g = ctx.createRadialGradient(R() * size, R() * size, 0, R() * size, R() * size, size * (0.25 + R() * 0.35));
    g.addColorStop(0, R() > 0.5 ? `rgba(${pal.glowLight},0.22)` : `rgba(${pal.glowDark},0.28)`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const ph = [R() * 6.283, R() * 6.283, R() * 6.283, R() * 6.283];
  const cx = size * (0.3 + R() * 0.4);
  const wob = (x, k) => 10 * Math.sin(x / 300 + ph[0] + k * 0.12) + 4 * Math.sin(x / 85 + ph[1] + k * 0.25) + 1.6 * Math.sin(x / 27 + ph[2] + k * 0.7);
  const bend = (x, k) => (x - cx) * (x - cx) * 0.00003 * Math.sin(k * 0.045 + ph[3]);
  const grainPath = (y0, k) => {
    ctx.beginPath();
    for (let x = -30; x <= size + 30; x += 10) {
      const y = y0 + wob(x, k) + bend(x, k);
      if (x === -30) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
  };
  ctx.lineCap = 'round';
  let y = -60, k = 0;
  while (y < size + 60) {                              // growth rings: latewood line + earlywood glow
    k++;
    const h1 = hash(k), h2 = hash(k + 911), h3 = hash(k + 1777);
    const drift = 1 + 0.35 * Math.sin(y / (size * 0.31) + ph[3]);      // very-low-frequency spacing modulation
    const sp = (14 + h1 * 44) * drift;                                    // ≈ 2–9 mm between rings
    const strength = 0.3 + 0.7 * h2 * h2;                                // many soft rings, a few strong ones
    grainPath(y, k); ctx.lineWidth = 1.5 + h3 * 6 * strength; ctx.strokeStyle = `rgba(${pal.late},${0.22 + 0.45 * strength})`; ctx.stroke();
    if (h1 > 0.45) { grainPath(y + 1.5, k); ctx.lineWidth = 0.8 + R() * 1.2; ctx.strokeStyle = `rgba(${pal.lateDark},${(0.2 + R() * 0.3) * strength})`; ctx.stroke(); }
    grainPath(y + sp * 0.5, k); ctx.lineWidth = 5 + R() * 12; ctx.strokeStyle = `rgba(${pal.early},${0.08 + R() * 0.18})`; ctx.stroke();
    y += sp;
  }
  for (let i = 0; i < 9000; i++) {                     // open pores: short dashes along the grain
    const x0 = R() * size, y0 = R() * size, len = 8 + R() * 70, kk = y0 / 40;
    const light = R() > 0.75;
    ctx.beginPath();
    for (let x = x0; x <= x0 + len; x += 6) {
      const yy = y0 + wob(x, kk) - wob(x0, kk);
      if (x === x0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
    }
    ctx.lineWidth = 0.6 + R();
    ctx.strokeStyle = light ? `rgba(${pal.poreLight},${0.15 + R() * 0.25})` : `rgba(${pal.poreDark},${0.18 + R() * 0.3})`;
    ctx.stroke();
  }

  // packed data map from the same grain (before the film-grain noise goes on the colour)
  const img = ctx.getImageData(0, 0, size, size), d = img.data;
  const n = size * size;
  let mean = 0;
  for (let i = 0; i < d.length; i += 4) mean += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  mean /= n * 255;
  const [dc, dctx] = makeCanvas(size, size);
  const dimg = dctx.createImageData(size, size), dd = dimg.data;
  const { cu, cv, span } = floor;                      // planar-space centre of the pocket floor + units per uv
  const inv = 1 / size;
  for (let py = 0; py < size; py++) {
    const zz = ((1 - (py + 0.5) * inv) - cv) * span;   // canvas rows run top→bottom, texture v bottom→top
    for (let px = 0; px < size; px++) {
      const i = (py * size + px) * 4;
      const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255 - mean;
      const xx = ((px + 0.5) * inv - cu) * span;
      const r = Math.hypot(xx, zz);
      // concentric tool marks: 1.8 mm pitch, uneven passes, faded before the floor fillet
      const fade = smooth((0.78 - r) / 0.06) * smooth((r - 0.02) / 0.03);
      const env = 0.55 + 0.45 * Math.sin(r * 290 + 0.7) * Math.sin(r * 86);
      const mark = fade * env * Math.sin(r / 0.018 * Math.PI * 2);
      const bump = clamp(0.5 + lum * 3.2 + 0.09 * mark, 0, 1);            // latewood / pores sit below the surface
      const rough = clamp(0.575 - lum * 1.15 + 0.02 * mark, 0.5, 0.66);     // dark late-wood and pores are rougher
      dd[i] = bump * 255; dd[i + 1] = rough * 255; dd[i + 2] = 128; dd[i + 3] = 255;
    }
  }
  dctx.putImageData(dimg, 0, 0);
  for (let i = 0; i < d.length; i += 4) {              // fine noise so flat areas never band
    const nz = (R() - 0.5) * 14; d[i] += nz; d[i + 1] += nz * 0.8; d[i + 2] += nz * 0.6;
  }
  ctx.putImageData(img, 0, 0);
  return { color: c, data: dc };
}

// Maker's stamp (burnt-in / debossed): a thin ring, HOLM, and a piece number.
function makeStampCanvas(size, lines) {
  const [c, ctx] = makeCanvas(size, size);
  ctx.clearRect(0, 0, size, size);
  const cx = size / 2, cy = size / 2;
  const ink = 'rgba(22,11,5,0.92)', hi = 'rgba(150,105,66,0.55)';
  const drawAll = (dx, dy, style) => {
    ctx.strokeStyle = style; ctx.fillStyle = style;
    ctx.lineWidth = size * 0.012;
    ctx.beginPath(); ctx.arc(cx + dx, cy + dy, size * 0.44, 0, Math.PI * 2); ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    lines.forEach((ln) => {
      ctx.font = `${ln.weight || 500} ${size * ln.size}px Georgia, "Times New Roman", serif`;
      const yy = cy + dy + size * ln.y;
      if (ln.spacing) {
        const chars = [...ln.text]; const widths = chars.map(ch => ctx.measureText(ch).width);
        const total = widths.reduce((a, b) => a + b, 0) + size * ln.spacing * (chars.length - 1);
        let x = cx + dx - total / 2;
        chars.forEach((ch, j) => { ctx.fillText(ch, x + widths[j] / 2, yy); x += widths[j] + size * ln.spacing; });
      } else ctx.fillText(ln.text, cx + dx, yy);
    });
  };
  drawAll(-size * 0.006, size * 0.006, hi);   // lit lower-left edge of the deboss
  drawAll(0, 0, ink);
  return c;
}

// Dark olive self-healing cutting mat: fine surface mottle, faint 1 cm grid, slightly firmer 5 cm lines,
// cm ticks on the 10 cm lines, whisper-faint 45° guides and a border scale. Whole mat in one canvas.
// The fill is cooler than the spec #445231 on purpose: under the warm key + ACES it renders to spec.
function makeMatCanvas(size, matUnits) {
  const [c, ctx] = makeCanvas(size, size, true);
  const R = rng(2024);
  const cm = size / (matUnits * 10);                  // px per cm
  ctx.fillStyle = '#273a2c';
  ctx.fillRect(0, 0, size, size);
  const img = ctx.getImageData(0, 0, size, size), d = img.data;   // surface mottle
  for (let i = 0; i < d.length; i += 4) { const n = (R() - 0.5) * 9; d[i] += n; d[i + 1] += n; d[i + 2] += n * 0.8; }
  ctx.putImageData(img, 0, 0);
  for (let i = 0; i < 40; i++) {                                  // faint scuffs / cut marks
    ctx.strokeStyle = `rgba(${R() > 0.5 ? '62,84,64' : '30,44,34'},${0.10 + R() * 0.16})`;
    ctx.lineWidth = 0.6 + R() * 1.2;
    const x = R() * size, y = R() * size, a = R() * Math.PI, l = 40 + R() * 320;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
  }
  const G = '58,80,58', T = '70,94,68';                             // grid / tick inks (relative to the fill)
  const border = 2.5 * cm;                                        // printed border scale zone
  const inner = [border, size - border];
  const nCm = Math.round((inner[1] - inner[0]) / cm);
  ctx.lineCap = 'butt';
  for (let i = 0; i <= nCm; i++) {                                // grid
    const p = Math.round(inner[0] + i * cm) + 0.5;
    const major = i % 5 === 0, ten = i % 10 === 0;
    ctx.strokeStyle = `rgba(${G},${ten ? 0.5 : major ? 0.42 : 0.3})`;
    ctx.lineWidth = ten ? 1.6 : major ? 1.2 : 1;
    ctx.beginPath(); ctx.moveTo(p, inner[0]); ctx.lineTo(p, inner[1]); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(inner[0], p); ctx.lineTo(inner[1], p); ctx.stroke();
  }
  ctx.strokeStyle = `rgba(${T},0.6)`; ctx.lineWidth = 1.2;        // cm ticks along the 10 cm lines
  for (let i = 0; i <= nCm; i += 10) {
    const p = Math.round(inner[0] + i * cm) + 0.5;
    for (let j = 0; j <= nCm; j++) {
      if (j % 5 === 0) continue;
      const q = Math.round(inner[0] + j * cm) + 0.5, t = 0.18 * cm;
      ctx.beginPath(); ctx.moveTo(p - t, q); ctx.lineTo(p + t, q); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(q, p - t); ctx.lineTo(q, p + t); ctx.stroke();
    }
  }
  ctx.strokeStyle = `rgba(${T},0.14)`; ctx.lineWidth = 1;         // 45° guides
  ctx.beginPath(); ctx.moveTo(inner[0], inner[0]); ctx.lineTo(inner[1], inner[1]); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(inner[1], inner[0]); ctx.lineTo(inner[0], inner[1]); ctx.stroke();
  // border scale: mm ticks and numbers every 5 cm
  ctx.fillStyle = `rgba(${T},0.7)`; ctx.strokeStyle = `rgba(${T},0.7)`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `500 ${cm * 0.62}px Arial, Helvetica, sans-serif`;
  for (let i = 0; i <= nCm; i++) {
    const p = Math.round(inner[0] + i * cm) + 0.5, l = i % 5 === 0 ? 0.9 * cm : 0.45 * cm;
    ctx.lineWidth = i % 5 === 0 ? 1.6 : 1;
    ctx.beginPath(); ctx.moveTo(p, inner[0]); ctx.lineTo(p, inner[0] - l); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(p, inner[1]); ctx.lineTo(p, inner[1] + l); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(inner[0], p); ctx.lineTo(inner[0] - l, p); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(inner[1], p); ctx.lineTo(inner[1] + l, p); ctx.stroke();
    if (i % 5 === 0 && i > 0 && i < nCm) {
      ctx.fillText(String(i), p, inner[0] - 1.6 * cm);
      ctx.fillText(String(i), p, inner[1] + 1.6 * cm);
      ctx.fillText(String(i), inner[0] - 1.6 * cm, p);
      ctx.fillText(String(i), inner[1] + 1.6 * cm, p);
    }
  }
  return c;
}

// Alpha vignette for the mat: fully opaque out to r0 units from the tray, dissolving to nothing by r1,
// so the plane's geometric edge and corners can never resolve as a line against the void, whatever the
// camera elevation during the LIFT. Eased (smoothstep) so the falloff has no visible start.
function makeMatAlphaCanvas(size, matUnits, r0, r1) {
  const [c, ctx] = makeCanvas(size, size);
  const half = size / 2, upx = size / matUnits;         // px per unit
  const g = ctx.createRadialGradient(half, half, r0 * upx, half, half, r1 * upx);
  for (let i = 0; i <= 8; i++) { const t = i / 8, v = Math.round(255 * (1 - smooth(t))); g.addColorStop(t, `rgb(${v},${v},${v})`); }
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}

// Plaster wall for the hall-table beat: warm mottle, a soft fall-off towards the skirting.
function makePlasterCanvas(size) {
  const [c, ctx] = makeCanvas(size, size, true);
  const R = rng(77);
  ctx.fillStyle = '#c9b396'; ctx.fillRect(0, 0, size, size);
  const img = ctx.getImageData(0, 0, size, size), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (R() - 0.5) * 14; d[i] += n; d[i + 1] += n; d[i + 2] += n * 0.9; }
  ctx.putImageData(img, 0, 0);
  const g = ctx.createLinearGradient(0, 0, 0, size);
  g.addColorStop(0, 'rgba(255,240,220,0.10)'); g.addColorStop(0.55, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(40,20,8,0.28)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  return c;
}

// Soft radial contact shadow under the tray (supplements the shadow map).
function makeBlobCanvas(size) {
  const [c, ctx] = makeCanvas(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.30, size / 2, size / 2, size * 0.5);
  g.addColorStop(0, 'rgba(10,6,2,0.9)');
  g.addColorStop(0.55, 'rgba(10,6,2,0.35)');
  g.addColorStop(1, 'rgba(10,6,2,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}

// Brass ruler face: brushed metal with etched mm scale on both long edges and numbers.
function makeRulerCanvas(W, H) {
  const [c, ctx] = makeCanvas(W, H, true);
  const R = rng(77);
  ctx.fillStyle = '#8c7a4c';
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 2600; i++) {                        // brushed streaks along the length
    ctx.strokeStyle = `rgba(${R() > 0.5 ? '196,172,124' : '88,70,38'},${0.05 + R() * 0.12})`;
    ctx.lineWidth = 0.6 + R() * 1.4;
    const y = R() * H, x = R() * W, l = 60 + R() * 500;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + l, y + (R() - 0.5) * 1.5); ctx.stroke();
  }
  const mm = W / 150;                                     // 150 mm long
  const ink = 'rgba(44,32,18,0.95)';
  ctx.strokeStyle = ink; ctx.fillStyle = ink;
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.font = `500 ${H * 0.19}px Arial, Helvetica, sans-serif`;
  const edge = mm * 0.6;
  for (let i = 0; i <= 150; i++) {
    const x = Math.round(edge + i * (W - 2 * edge) / 150) + 0.5;
    const ten = i % 10 === 0, five = i % 5 === 0;
    const l = ten ? H * 0.30 : five ? H * 0.21 : H * 0.13;
    ctx.lineWidth = ten ? 2.2 : 1.3;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, l); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, H); ctx.lineTo(x, H - l * 0.75); ctx.stroke();
    if (ten && i > 0 && i < 150) ctx.fillText(String(i / 10), x, H * 0.30 + H * 0.20);
  }
  ctx.font = `500 ${H * 0.13}px Arial, Helvetica, sans-serif`;
  ctx.textAlign = 'left';
  ctx.fillText('cm', edge + 4 * mm, H * 0.78);                    // unit label on the lower row, clear of the numerals
  ctx.textAlign = 'right';
  ctx.fillText('HOLM WORKS · BRASS · 150', W - 8 * mm, H * 0.78);
  return c;
}

// Diamond knurl for the knife grip (bump map, repeated).
function makeKnurlCanvas(size) {
  const [c, ctx] = makeCanvas(size, size);
  ctx.fillStyle = 'rgb(128,128,128)';
  ctx.fillRect(0, 0, size, size);
  ctx.lineWidth = size * 0.11;
  for (const dir of [1, -1]) {
    for (let k = -2; k <= 2; k++) {
      ctx.strokeStyle = 'rgb(70,70,70)';
      ctx.beginPath(); ctx.moveTo(0, size * (k * 0.5 + 0.5)); ctx.lineTo(size, size * (k * 0.5 + 0.5) + dir * size); ctx.stroke();
    }
  }
  return c;
}

// Pencil body print: a faint lettering band so the pencils read as objects, not extrusions.
function makePencilPrintCanvas(W, H, text, fg) {
  const [c, ctx] = makeCanvas(W, H);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = fg;
  ctx.font = `500 ${H * 0.62}px Arial, Helvetica, sans-serif`;
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  ctx.fillText(text, W * 0.97, H * 0.5);
  return c;
}

/* ------------------------------------------------------------------ the tray */

// Profile in (radius, height), 1 unit = 100 mm. Traversed bottom-centre → out → up the flared outer wall →
// over the rounded lip → down the pocket → filleted floor edge → floor centre. Near-duplicate points keep
// the underside chamfer crisp (LatheGeometry averages normals at shared vertices).
const SHEAR = 0.8, SPAN = 2.8;   // planar grain projection: uv = ((x, z + SHEAR·y) + SPAN/2) / SPAN
const FLOOR_Y = 0.085;

function buildTrayGeometry() {
  const P = [];
  const marks = {};
  const add = (r, y, name) => { P.push(new THREE.Vector2(r, y)); if (name) marks[name] = P.length - 1; };
  const arc = (cx, cy, r, a0, a1, n, name) => {
    for (let i = 1; i <= n; i++) { const a = (a0 + (a1 - a0) * i / n) * DEG; add(cx + r * Math.cos(a), cy + r * Math.sin(a), i === n ? name : null); }
  };
  add(0, 0.02, 'bottomCentre');                       // shallow turned recess on the underside (2 mm)
  add(0.35, 0.02); add(0.70, 0.02); add(0.79, 0.02, 'recessEdge');
  arc(0.81, 0.02, 0.02, 180, 270, 4, 'footStart');    // recess fillet down to the foot ring (y = 0)
  add(0.9465, 0.0); add(0.947, 0.0, 'chamferStart'); add(0.9473, 0.0003);   // crisp corner
  add(0.9767, 0.0297); add(0.977, 0.03, 'chamferEnd'); add(0.97703, 0.0303); // 3 mm underside chamfer
  add(0.9938, 0.19, 'lipOuterStart');                 // outer wall, 6° outward flare
  arc(0.9638, 0.19, 0.03, 0, 90, 10);                 // lip: outer round r = 3 mm → (0.9638, 0.22)
  add(0.95, 0.22);                                    // 1.4 mm flat crown
  arc(0.95, 0.19, 0.03, 90, 180, 10, 'lipInnerEnd');  // lip: inner round → (0.92, 0.19)
  add(0.918, 0.165, 'innerWallEnd');                  // inner wall, whisper of draft
  arc(0.835, 0.165, 0.08, 0, -90, 12, 'floorStart');  // filleted pocket floor edge (r = 8 mm) → (0.835, 0.085)
  add(0.55, FLOOR_Y, 'floorMid'); add(0.25, FLOOR_Y); add(0, FLOOR_Y, 'floorCentre');

  const N = P.length;
  const s = [0];                                        // arc length along the profile
  for (let j = 1; j < N; j++) s[j] = s[j - 1] + P[j].distanceTo(P[j - 1]);

  // fake ambient occlusion along the profile: darker in the underside, the pocket crease and the inner wall
  const AO = [['bottomCentre', 0.62], ['recessEdge', 0.62], ['footStart', 0.72], ['chamferStart', 0.74], ['chamferEnd', 0.9],
    ['lipOuterStart', 1], ['lipInnerEnd', 1], ['innerWallEnd', 0.94], ['floorStart', 0.85], ['floorMid', 0.98], ['floorCentre', 1]];
  const ao = new Float32Array(N);
  for (let j = 0; j < N; j++) {
    let a = 0;
    while (a < AO.length - 2 && s[marks[AO[a + 1][0]]] < s[j]) a++;
    const s0 = s[marks[AO[a][0]]], s1 = s[marks[AO[a + 1][0]]];
    ao[j] = lerp(AO[a][1], AO[a + 1][1], clamp((s[j] - s0) / Math.max(1e-6, s1 - s0), 0, 1));
  }

  const SEGS = 192;
  const geo = new THREE.LatheGeometry(P, SEGS);
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  const n = pos.count;
  const uvPlanar = new Float32Array(n * 2), col = new Float32Array(n * 3);
  // The lathe beat: every vertex also knows where it sits on the raw blank (Ø 210 × 27, same arc-length
  // parametrisation) and when along the turning it is cut: underside, foot, chamfer and wall first, then the
  // blank comes round and the lip, inner wall and floor are cut down to the centre.
  const finished = new Float32Array(pos.array), blank = new Float32Array(n * 3), carve = new Float32Array(n);
  const sTot = s[N - 1], sLip = s[marks.lipOuterStart];
  const BR = 1.05, BH = 0.27, L1 = BR, L2 = BR + BH, L3 = 2 * BR + BH;
  const carveAt = (sj) => sj <= sLip ? 0.04 + 0.44 * (sj / sLip) : 0.54 + 0.42 * ((sj - sLip) / (sTot - sLip));
  const blankAt = (sj) => { const d = sj / sTot * L3; return d < L1 ? [d, 0] : d < L2 ? [BR, d - L1] : [BR - (d - L2), BH]; };
  const carveP = Array.from({ length: N }, (_, j) => carveAt(s[j])), blankP = Array.from({ length: N }, (_, j) => blankAt(s[j]));
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const j = i % N, seg = Math.floor(i / N), phi = seg / SEGS * Math.PI * 2;
    const [br, by] = blankP[j];
    blank[i * 3] = br * Math.sin(phi); blank[i * 3 + 1] = by; blank[i * 3 + 2] = br * Math.cos(phi);
    carve[i] = carveP[j];
    uvPlanar[i * 2] = (x + SPAN / 2) / SPAN;
    uvPlanar[i * 2 + 1] = (z + SHEAR * y + SPAN / 2) / SPAN;
    const lip = smooth((y - 0.15) / 0.07);              // a little warmer / lighter on the lip
    const o = ao[j];
    col[i * 3] = o * (1 + 0.16 * lip); col[i * 3 + 1] = o * (1 + 0.09 * lip); col[i * 3 + 2] = o * (1 + 0.02 * lip);
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uvPlanar, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  // where the pocket floor's centre lands in planar uv (for the concentric turning marks)
  const floor = { cu: 0.5, cv: (SHEAR * FLOOR_Y + SPAN / 2) / SPAN, span: SPAN };
  return { geo, floor, morph: { finished, blank, carve, carveP, blankP, P } };
}

/* ------------------------------------------------------------------ props */

function hexPencil({ bodyColor, natural, print, printColor }) {
  const g = new THREE.Group();
  const r = 0.04, bodyLen = 1.02;                         // a well-used pencil, ≈ 14.5 cm overall
  const flat = { flatShading: true, roughness: 0.62, metalness: 0 };
  const bodyMat = new THREE.MeshStandardMaterial({ color: bodyColor, ...flat });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r, bodyLen, 6, 1).rotateZ(-Math.PI / 2), bodyMat);
  g.add(body);
  if (print) {                                            // lettering on the top facet
    const pc = makePencilPrintCanvas(1024, 96, print, printColor);
    const pm = new THREE.MeshStandardMaterial({ map: tex(pc), transparent: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -1 });
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.7, r * 0.9), pm);
    plate.rotation.x = -Math.PI / 2;
    plate.position.set(-0.08, r * Math.cos(Math.PI / 6) + 0.0004, 0);
    g.add(plate);
  }
  const woodMat = new THREE.MeshStandardMaterial({ color: '#d2b385', ...flat, roughness: 0.8 });
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.009, r, 0.17, 6, 1).rotateZ(-Math.PI / 2), woodMat);
  cone.position.x = bodyLen / 2 + 0.085;
  g.add(cone);
  const graphite = new THREE.Mesh(new THREE.ConeGeometry(0.009, 0.05, 12, 1).rotateZ(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: '#2a2a2c', roughness: 0.45, metalness: 0.55 }));
  graphite.position.x = bodyLen / 2 + 0.17 + 0.025;
  g.add(graphite);
  if (natural) {                                          // brass ferrule + dusty eraser
    const ferrule = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.02, r * 1.02, 0.12, 24, 1).rotateZ(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: '#95793f', roughness: 0.45, metalness: 0.9 }));
    ferrule.position.x = -bodyLen / 2 - 0.06;
    g.add(ferrule);
    for (const dx of [-0.03, 0.03]) {                    // crimp grooves
      const groove = new THREE.Mesh(new THREE.TorusGeometry(r * 1.02, 0.004, 8, 32).rotateY(Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: '#5e4c2c', roughness: 0.5, metalness: 0.9 }));
      groove.position.x = -bodyLen / 2 - 0.06 + dx;
      g.add(groove);
    }
    const eraser = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.96, r * 0.96, 0.09, 24, 1).rotateZ(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: '#a4726a', roughness: 0.95, metalness: 0 }));
    eraser.position.x = -bodyLen / 2 - 0.12 - 0.045;
    g.add(eraser);
  } else {                                                // dipped end cap, cream
    const capMat = new THREE.MeshStandardMaterial({ color: '#c2af93', ...flat });
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.10, 6, 1).rotateZ(-Math.PI / 2), capMat);
    cap.position.x = -bodyLen / 2 - 0.05 + 0.0005;
    g.add(cap);
    const endcap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.98, r * 0.98, 0.001, 6, 1).rotateZ(-Math.PI / 2), capMat);
    endcap.position.x = -bodyLen / 2 - 0.10;
    g.add(endcap);
  }
  g.position.y = r * Math.cos(Math.PI / 6);               // rests on a flat
  return g;
}
function craftKnife() {
  const g = new THREE.Group();
  const r = 0.04, handleLen = 1.0;                        // No. 1 hobby knife: 10 cm handle + collet + #11 blade
  const alu = new THREE.MeshStandardMaterial({ color: '#8a867f', roughness: 0.42, metalness: 0.95 });
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(r, r, handleLen, 32, 1).rotateZ(-Math.PI / 2), alu);
  g.add(handle);
  const endCap = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2).rotateZ(Math.PI / 2), alu);
  endCap.position.x = -handleLen / 2;
  g.add(endCap);
  const knurlTex = tex(makeKnurlCanvas(128), { srgb: false, repeat: [10, 26] });
  const knurl = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.04, r * 1.04, 0.36, 32, 1).rotateZ(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: '#86827c', roughness: 0.55, metalness: 0.9, bumpMap: knurlTex, bumpScale: 0.6 }));
  knurl.position.x = handleLen / 2 - 0.30;
  g.add(knurl);
  const collet = new THREE.Mesh(new THREE.CylinderGeometry(0.016, r * 0.9, 0.16, 32, 1).rotateZ(-Math.PI / 2), alu);
  collet.position.x = handleLen / 2 + 0.08;
  g.add(collet);
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.06, r * 1.06, 0.03, 32, 1).rotateZ(-Math.PI / 2), alu);
  ring.position.x = handleLen / 2 + 0.005;
  g.add(ring);
  // #11 blade: straight back, cutting edge sweeping to a fine point; separate polished ground bevel.
  const blade = new THREE.Shape([new THREE.Vector2(0, -0.03), new THREE.Vector2(0.36, 0.03), new THREE.Vector2(0, 0.03)]);
  const bevel = new THREE.Shape([new THREE.Vector2(0, -0.03), new THREE.Vector2(0.36, 0.03), new THREE.Vector2(0.33, 0.03), new THREE.Vector2(0, -0.017)]);
  const steel = new THREE.MeshStandardMaterial({ color: '#b3b3ae', roughness: 0.3, metalness: 1 });
  const ground = new THREE.MeshStandardMaterial({ color: '#cfcfc9', roughness: 0.14, metalness: 1, polygonOffset: true, polygonOffsetFactor: -2 });
  const bladeGeo = new THREE.ExtrudeGeometry(blade, { depth: 0.006, bevelEnabled: false }).translate(0, 0, -0.003).rotateX(-Math.PI / 2);
  const bevelGeo = new THREE.ExtrudeGeometry(bevel, { depth: 0.0064, bevelEnabled: false }).translate(0, 0, -0.0032).rotateX(-Math.PI / 2);
  const bladeGroup = new THREE.Group();
  bladeGroup.add(new THREE.Mesh(bladeGeo, steel), new THREE.Mesh(bevelGeo, ground));
  bladeGroup.position.x = handleLen / 2 + 0.16 - 0.02;
  bladeGroup.rotation.z = -2.5 * DEG;                   // tip settles toward the mat
  g.add(bladeGroup);
  g.position.y = r;
  return g;
}

function brassRuler() {
  const face = tex(makeRulerCanvas(2048, 340), { anisotropy: 4 });
  const brass = new THREE.MeshStandardMaterial({ color: '#8c7a4c', roughness: 0.46, metalness: 1 });
  const top = new THREE.MeshStandardMaterial({ map: face, roughness: 0.46, metalness: 1 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.012, 0.25), [brass, brass, top, brass, brass, brass]);
  mesh.position.y = 0.006;
  return mesh;
}

function paperclip() {
  const pts = [];
  const add = (x, z) => pts.push(new THREE.Vector3(x, 0, z));
  const arc = (cx, cz, r, a0, a1, n) => { for (let i = 1; i <= n; i++) { const a = (a0 + (a1 - a0) * i / n) * DEG; add(cx + r * Math.cos(a), cz + r * Math.sin(a)); } };
  add(-0.04, -0.03); add(0.05, -0.03); add(0.13, -0.03);
  arc(0.13, 0, 0.03, -90, 90, 10);                        // small inner bend, right
  add(0.0, 0.03); add(-0.13, 0.03);
  arc(-0.13, -0.0075, 0.0375, 90, 270, 12);               // medium bend, left
  add(0.0, -0.045); add(0.155, -0.045);
  arc(0.155, 0, 0.045, -90, 90, 14);                      // big outer bend, right
  add(0.0, 0.045); add(-0.08, 0.045);
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5);
  const geo = new THREE.TubeGeometry(curve, 320, 0.0045, 10, false);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#7e7e7a', roughness: 0.38, metalness: 1 }));
  mesh.position.y = 0.0045;
  return mesh;
}

/* ------------------------------------------------------------------ scene */

export function createScene(canvas, options = {}) {
  const isStatic = !!options.static;
  const reduced = !!options.reducedMotion || isStatic;

  // MSAA only on low-density screens: at 1.5x and above the pixel density hides the edges and MSAA would just be fill cost.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: (window.devicePixelRatio || 1) < 1.5, alpha: true, premultipliedAlpha: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.localClippingEnabled = true;                            // the section cut clips the tray's materials only
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;                    // soft enough at 2048 with a radius; PCFSoft costs several times more per pixel
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(VOID, 6, 16);                            // near/far follow the camera distance
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 240);   // small rect-pinned views (the o of longevity on a phone) put the camera a long way back
  const target = new THREE.Vector3(0, 0.10, 0);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();                              // warm-tinted so reflections read as tungsten, not grey
  const warm = new THREE.Color('#ffd7ae');
  room.traverse((o) => { if (o.isMesh && o.material && o.material.color) o.material.color.multiply(warm); });
  const envRT = pmrem.fromScene(room, 0.04);                       // kept: only the target can free its GL texture
  room.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  pmrem.dispose();
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.42;

  // Light rig — every light is positioned relative to the camera yaw each frame, so the key stays
  // upper-right and the rim behind-right through the whole 84° yaw drift. Across the LIFT the key slides
  // from behind-right (hero: shadow falls lower-left) to front-right (void: near outer wall never black),
  // the hero spot pool fades out and the rim / bounce come up.
  const key = new THREE.DirectionalLight('#ffd7ae', 2.9);            // casts the hero contact shadow
  key.target.position.copy(target);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1; key.shadow.camera.far = 14;
  key.shadow.camera.left = -3.6; key.shadow.camera.right = 3.6; key.shadow.camera.top = 3.6; key.shadow.camera.bottom = -3.6;
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.015; key.shadow.radius = 3;
  scene.add(key, key.target);
  const spot = new THREE.SpotLight('#ffdcb8', 0, 0, 22 * DEG, 0.85, 2); // hero pool of light on the mat
  spot.target = key.target;
  scene.add(spot);
  const rim = new THREE.DirectionalLight('#ffe7cf', 1.7);            // behind-right: silhouette off the void
  rim.target = key.target;
  scene.add(rim);
  const front = new THREE.DirectionalLight('#ffd9b8', 0.9);          // soft camera-side fill, from camera-left, above
  front.target = key.target;
  scene.add(front);
  const bounce = new THREE.DirectionalLight('#ffc49a', 0);           // low warm bounce from below-left, void only
  bounce.target = key.target;
  scene.add(bounce);
  const hemi = new THREE.HemisphereLight('#6b5140', '#160b06', 0.6);
  scene.add(hemi);

  // ---- tray
  const trayGroup = new THREE.Group();
  const T = buildTrayGeometry();
  const woodCanvases = makeWoodCanvases(2048, T.floor);
  const woodMap = tex(woodCanvases.color, { anisotropy: Math.min(8, maxAniso) });
  const woodData = tex(woodCanvases.data, { srgb: false, anisotropy: Math.min(8, maxAniso) });
  const walnutMaps = { map: woodMap, data: woodData };
  const wood = new THREE.MeshPhysicalMaterial({
    map: woodMap, vertexColors: true,
    roughness: 1.0, roughnessMap: woodData, metalness: 0,          // three reads roughness from .g
    bumpMap: woodData, bumpScale: 0.0048,                          // and bump height from .x
    clearcoat: 0.04, clearcoatRoughness: 0.65, envMapIntensity: 0.55,
    sheen: 0.1, sheenRoughness: 0.85, sheenColor: new THREE.Color('#6a4d38'),
  });
  // "Made of code": a wireframe of the very same lathe, faded in over the wood for the closing beat.
  const wire = new THREE.LineSegments(new THREE.WireframeGeometry(T.geo), new THREE.LineBasicMaterial({ color: 0xffedd7, transparent: true, opacity: 0, depthWrite: false }));
  wire.visible = false; wire.renderOrder = 3;
  let codeT = 0, codeTarget = 0, extraYaw = 0;
  const tray = new THREE.Mesh(T.geo, wood);
  tray.castShadow = true;
  trayGroup.add(tray);
  trayGroup.add(wire);
  // maker's stamps: one in the pocket floor (visible in HERO / DETAIL), one in the underside recess.
  const stampMat = (canvas) => new THREE.MeshStandardMaterial({ map: tex(canvas), transparent: true, roughness: 0.75, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1 });
  const stampFloor = new THREE.Mesh(new THREE.CircleGeometry(0.095, 48), stampMat(makeStampCanvas(512, [
    { text: 'HOLM', size: 0.19, y: -0.07, spacing: 0.06 }, { text: 'Nº 014', size: 0.13, y: 0.14 }])));
  stampFloor.rotation.x = -Math.PI / 2;
  stampFloor.position.set(0.44, FLOOR_Y + 0.0005, 0.50);
  trayGroup.add(stampFloor);
  const stampUnder = new THREE.Mesh(new THREE.CircleGeometry(0.22, 64), stampMat(makeStampCanvas(512, [
    { text: 'HOLM', size: 0.17, y: -0.16, spacing: 0.07 }, { text: 'HAND TURNED', size: 0.07, y: 0.0, spacing: 0.02 },
    { text: 'BLACK WALNUT', size: 0.07, y: 0.10, spacing: 0.02 }, { text: 'Nº 014 · 2026', size: 0.08, y: 0.22 }])));
  stampUnder.rotation.x = Math.PI / 2;
  stampUnder.position.set(0, 0.0195, 0);
  trayGroup.add(stampUnder);
  scene.add(trayGroup);

  // ---- the lamp: a warm spot between the camera and the tray that follows the hand in the void
  const lamp = new THREE.SpotLight('#ffe3c4', 0, 0, 38 * DEG, 0.7, 2);
  lamp.target = key.target;
  scene.add(lamp);
  let lampOn = 0;
  // Time of day: the hero photograph is lit for the visitor's hour (cooler and higher in the morning, warm and
  // low in the evening). hourWarm 0..1, hourSwing in degrees of azimuth.
  let hourWarm = 0.4, hourSwing = 0;
  const _fwd = new THREE.Vector3();
  // Dust in the darkroom: a few hundred motes drifting in a box around the tray, only in the void, brighter
  // when the lamp is out. Additive, so they read as light, not particles.
  const MOTES = 240, moteGeo = new THREE.BufferGeometry(), motePos = new Float32Array(MOTES * 3), moteSeed = new Float32Array(MOTES * 2);
  for (let i = 0; i < MOTES; i++) { motePos[i * 3] = (Math.random() - 0.5) * 3.4; motePos[i * 3 + 1] = -0.3 + Math.random() * 1.8; motePos[i * 3 + 2] = (Math.random() - 0.5) * 3.4; moteSeed[i * 2] = Math.random() * 6.28; moteSeed[i * 2 + 1] = 0.4 + Math.random(); }
  moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
  const motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({ color: '#ffd9b0', size: 0.014, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  motes.frustumCulled = false; motes.visible = false; scene.add(motes);
  // The photograph develops: the first frames come up from black like a print in the bath.
  let devT = reduced ? 1 : 1, developing = false;
  // Timber: the tray is walnut. Oak exists only as a two-second answer to a question in the gallery.
  const timber = { walnut: { map: null, data: null }, oak: null }, timberSize = 1024;
  let timberNow = 'walnut';

  // ---- the lathe: the same geometry shown part-way between the blank and the finished tray, a chisel at the cut
  // and shavings flying off it. Everything here lives in a group that turns with the camera yaw, so the tool
  // stays front-right of the lens while the tray spins beneath it.
  const morph = T.morph, mPos = T.geo.attributes.position;
  let turnT = 1, latheT = 0, morphAt = 1, latheAngle = 0, cutRate = 0, lastEff = 1, spinF = 0;
  function applyMorph(eff) {
    const arr = mPos.array, { finished, blank, carve } = morph;
    for (let i = 0, n = carve.length; i < n; i++) {
      const k = smooth((eff - carve[i] + 0.08) / 0.08), o = i * 3;
      arr[o] = blank[o] + (finished[o] - blank[o]) * k;
      arr[o + 1] = blank[o + 1] + (finished[o + 1] - blank[o + 1]) * k;
      arr[o + 2] = blank[o + 2] + (finished[o + 2] - blank[o + 2]) * k;
    }
    mPos.needsUpdate = true; T.geo.computeVertexNormals(); T.geo.computeBoundingSphere();
    morphAt = eff;
  }
  const latheGroup = new THREE.Group(); latheGroup.visible = false; scene.add(latheGroup);
  const steelM = new THREE.MeshStandardMaterial({ color: '#b9b7b0', roughness: 0.3, metalness: 1 });
  const chisel = new THREE.Group();
  { const bar = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.028, 0.034), steelM); bar.position.x = 0.31; chisel.add(bar);
    const ferrule = new THREE.Mesh(new THREE.CylinderGeometry(0.031, 0.031, 0.05, 24).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#9a8352', roughness: 0.4, metalness: 1 })); ferrule.position.x = 0.645; chisel.add(ferrule);
    const prof = [new THREE.Vector2(0.03, 0), new THREE.Vector2(0.05, 0.08), new THREE.Vector2(0.06, 0.2), new THREE.Vector2(0.055, 0.32), new THREE.Vector2(0.04, 0.4), new THREE.Vector2(0.001, 0.43)];
    const handle = new THREE.Mesh(new THREE.LatheGeometry(prof, 28).rotateZ(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#5a3520', roughness: 0.55 })); handle.position.x = 0.67; chisel.add(handle); }
  latheGroup.add(chisel);
  const CHIPS = 140;
  const chips = new THREE.InstancedMesh(new THREE.BoxGeometry(0.055, 0.004, 0.02), new THREE.MeshStandardMaterial({ color: '#c39a6c', roughness: 0.85 }), CHIPS);
  chips.instanceMatrix.setUsage(THREE.DynamicDrawUsage); chips.frustumCulled = false;
  const chip = Array.from({ length: CHIPS }, () => ({ life: 0, max: 1, p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3() }));
  const _o3 = new THREE.Object3D(), _tmpC = new THREE.Color();
  for (let i = 0; i < CHIPS; i++) { chips.setColorAt(i, _tmpC.setHSL(0.075, 0.42, 0.42 + Math.random() * 0.22)); _o3.scale.setScalar(0); _o3.updateMatrix(); chips.setMatrixAt(i, _o3.matrix); }
  latheGroup.add(chips);
  let chipAcc = 0, chipHead = 0;
  // ---- Section A–A, live: a clipping plane facing the lens sweeps in and takes the near half away; the cut face is
  // the profile polygon, hatched like the drawing. Only the tray's own materials are clipped.
  const cutPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 2);
  let cutT = 0, cutTarget = 0, cutBound = false;
  const cutMats = [wood, stampFloor.material, stampUnder.material, wire.material];
  function bindCut(on) { if (on === cutBound) return; cutBound = on; for (const m of cutMats) { m.clippingPlanes = on ? [cutPlane] : null; m.needsUpdate = true; } }
  const capShape = new THREE.Shape();
  { const P = T.morph.P; capShape.moveTo(P[0].x, P[0].y); for (let j = 1; j < P.length; j++) capShape.lineTo(P[j].x, P[j].y); for (let j = P.length - 1; j >= 0; j--) capShape.lineTo(-P[j].x, P[j].y); capShape.closePath(); }
  const hatchTex = (() => {
    const [c, ctx] = makeCanvas(256, 256);
    ctx.fillStyle = '#5a3320'; ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = 'rgba(255,237,215,0.8)'; ctx.lineWidth = 2.5;
    for (let d = -256; d < 512; d += 64) { ctx.beginPath(); ctx.moveTo(d, 0); ctx.lineTo(d + 256, 256); ctx.stroke(); }
    const t = tex(c, { repeat: [3, 3] }); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 3); return t;
  })();
  const cap = new THREE.Mesh(new THREE.ShapeGeometry(capShape, 12), new THREE.MeshStandardMaterial({ map: hatchTex, roughness: 0.9, side: THREE.DoubleSide, transparent: true, opacity: 0, polygonOffset: true, polygonOffsetFactor: -2 }));
  cap.visible = false; cap.renderOrder = 2; scene.add(cap);

  // ---- For scale: a bank card (85.6 × 54 × 0.76) and a phone (147.6 × 71.6 × 7.8) beside the tray
  const scaleGroup = new THREE.Group(); scaleGroup.visible = false; scene.add(scaleGroup);
  let scaleT = 0, scaleTarget = 0;
  const roundedSlab = (w, d, h, r, mat) => {
    const sh = new THREE.Shape(); const x = -w / 2, y = -d / 2;
    sh.moveTo(x + r, y); sh.lineTo(x + w - r, y); sh.quadraticCurveTo(x + w, y, x + w, y + r); sh.lineTo(x + w, y + d - r); sh.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
    sh.lineTo(x + r, y + d); sh.quadraticCurveTo(x, y + d, x, y + d - r); sh.lineTo(x, y + r); sh.quadraticCurveTo(x, y, x + r, y);
    const g = new THREE.ExtrudeGeometry(sh, { depth: h, bevelEnabled: false, curveSegments: 10 }).rotateX(-Math.PI / 2).translate(0, 0, 0);
    const m = new THREE.Mesh(g, mat); m.castShadow = true; return m;
  };
  const scaleMats = [];
  const smat = (opts) => { const m = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0, ...opts }); scaleMats.push(m); return m; };
  const card = new THREE.Group();
  { card.add(roundedSlab(0.856, 0.54, 0.0076, 0.031, smat({ color: '#2a2c33', roughness: 0.55 })));
    const chipM = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.002, 0.09), smat({ color: '#9a8352', roughness: 0.35, metalness: 1 })); chipM.position.set(-0.24, 0.0086, -0.06); card.add(chipM);
    const emboss = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.0015, 0.05), smat({ color: '#3a3d46', roughness: 0.6 })); emboss.position.set(-0.05, 0.0083, 0.13); card.add(emboss); }
  const phone = new THREE.Group();
  { phone.add(roundedSlab(0.716, 1.476, 0.078, 0.11, smat({ color: '#15161a', roughness: 0.4, metalness: 0.6 })));
    const screen = roundedSlab(0.67, 1.43, 0.002, 0.09, smat({ color: '#07070a', roughness: 0.12, metalness: 0.3 })); screen.position.y = 0.078; phone.add(screen);
    const island = roundedSlab(0.30, 0.31, 0.012, 0.07, smat({ color: '#1e2026', roughness: 0.35, metalness: 0.5 })); island.position.set(-0.17, -0.012, -0.55); phone.add(island); }
  scaleGroup.add(card, phone);
  function layoutScale(portrait) {
    if (portrait) { card.position.set(-0.55, 0, -1.55); card.rotation.y = 0.12; phone.position.set(0.5, 0, 1.75); phone.rotation.y = -0.08; }
    else { card.position.set(-1.38, 0, 0.25); card.rotation.y = -0.18; phone.position.set(1.32, 0, -0.1); phone.rotation.y = 0.1; }
  }
  layoutScale(false);

  const CUT_AZ = 40 * DEG, X_AXIS = new THREE.Vector3(1, 0, 0), _tip = new THREE.Vector3(), _hdir = new THREE.Vector3();
  // A chip is a shaving: the lathe sprays them from the tool, and a claimed number bursts a handful from the pocket.
  function emitChip(px, py, pz, vx, vy, vz) {
    const c = chip[chipHead]; chipHead = (chipHead + 1) % CHIPS;
    c.life = c.max = 0.6 + Math.random() * 0.6;
    c.p.set(px, py, pz); c.v.set(vx, vy, vz);
    c.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    c.w.set((Math.random() - 0.5) * 24, (Math.random() - 0.5) * 24, (Math.random() - 0.5) * 24);
  }
  let chipsAlive = false;
  function updateChips(dt) {
    let alive = false;
    for (let i = 0; i < CHIPS; i++) {
      const c = chip[i];
      if (c.life <= 0) continue;
      c.life -= dt; alive = true;
      c.v.y -= 6.5 * dt; c.p.addScaledVector(c.v, dt);
      c.r.x += c.w.x * dt; c.r.y += c.w.y * dt; c.r.z += c.w.z * dt;
      const f = clamp(c.life / c.max, 0, 1), sc = c.life > 0 ? smooth(f / 0.35) : 0;
      _o3.position.copy(c.p); _o3.rotation.copy(c.r); _o3.scale.setScalar(sc); _o3.updateMatrix(); chips.setMatrixAt(i, _o3.matrix);
    }
    chips.instanceMatrix.needsUpdate = true;
    chipsAlive = alive;
  }
  const wrapPi = (a) => ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  function updateLathe(dt, eff, yawRad) {
    latheGroup.rotation.y = yawRad;
    // the point being cut now: the profile point whose carve time is nearest the current progress
    const { carveP, blankP, P } = morph; let jc = 0, best = 1e9;
    for (let j = 0; j < carveP.length; j++) { const d = Math.abs(carveP[j] - eff); if (d < best) { best = d; jc = j; } }
    const k = smooth((eff - carveP[jc] + 0.08) / 0.08);
    const r = lerp(blankP[jc][0], P[jc].x, k) + 0.012, y = lerp(blankP[jc][1], P[jc].y, k);
    _tip.set(r * Math.sin(CUT_AZ), y, r * Math.cos(CUT_AZ));
    const cutting = eff < 0.995;
    chisel.visible = cutting && !(y < 0.035 && r < 0.93);   // the underside is cut out of sight; the tool shows from the foot on
    if (cutting) {
      _hdir.set(0.9 * Math.sin(CUT_AZ), -0.22, 0.9 * Math.cos(CUT_AZ) + 0.55).normalize();
      chisel.position.copy(_tip);
      chisel.quaternion.setFromUnitVectors(X_AXIS, _hdir);
    }
    // shavings: a trickle while it spins, a spray while the cut advances
    const rate = cutting ? 8 + 110 * clamp(cutRate / 0.6, 0, 1) : 0;
    chipAcc += rate * dt;
    while (chipAcc >= 1) {
      chipAcc -= 1;
      const sp = 1.2 + Math.random() * 1.4;
      emitChip(_tip.x + (Math.random() - 0.5) * 0.04, _tip.y + Math.random() * 0.03, _tip.z + (Math.random() - 0.5) * 0.04,
        Math.cos(CUT_AZ) * sp + (Math.random() - 0.5) * 0.6, 0.9 + Math.random() * 1.1, -Math.sin(CUT_AZ) * sp + (Math.random() - 0.5) * 0.6 + 0.4);
    }
  }

  // ---- the hero set: mat, contact shadow, tools (only these fade + sink during LIFT)
  const matGroup = new THREE.Group();
  // The plane is far larger than any frame ever shows (the hero frames ≈ 5.3 × 3.3 units on desktop, the
  // portrait top-of-frame ray lands ≈ 3.5 units out) and its alpha dissolves to zero well inside its edge,
  // so no straight seam or corner of the "canvas" can slide into view while the camera drops through LIFT.
  // A desk under everything: the tray's own walnut canvas, tiled and lifted towards oak, dissolving to
  // nothing well inside its edge so no seam can slide into view while the camera drops through LIFT.
  const DESK = 14.0;
  const deskMap = woodMap.clone(); deskMap.wrapS = deskMap.wrapT = THREE.RepeatWrapping; deskMap.repeat.set(4, 4); deskMap.rotation = Math.PI / 2; deskMap.needsUpdate = true;
  const deskAlpha = tex(makeMatAlphaCanvas(512, DESK, 4.6, 6.6), { srgb: false });
  const deskMat = new THREE.MeshStandardMaterial({ map: deskMap, alphaMap: deskAlpha, color: new THREE.Color().setRGB(1.9, 1.55, 1.15), roughness: 0.72, metalness: 0, transparent: true, envMapIntensity: 0.3 });
  const desk = new THREE.Mesh(new THREE.PlaneGeometry(DESK, DESK), deskMat);
  desk.rotation.x = -Math.PI / 2; desk.position.y = -0.034; desk.receiveShadow = true;
  matGroup.add(desk);
  // The cutting mat itself: an A2-ish slab, 3 mm thick, laid at a slight angle so the desk shows at the
  // left third and the top-left corner where the wordmark sits.
  const MAT_W = 5.2, MAT_D = 3.6, MAT_T = 0.03;
  const matTex = tex(makeMatCanvas(3072, MAT_W), { anisotropy: Math.min(8, maxAniso) });    // ≈ 59 px/cm
  matTex.wrapS = matTex.wrapT = THREE.ClampToEdgeWrapping; matTex.repeat.set(1, MAT_D / MAT_W); matTex.needsUpdate = true;
  // colour multiplier calibrated from rendered pixels so the lit mat beside the tray measures ≈ #445231
  const matMat = new THREE.MeshStandardMaterial({ map: matTex, color: new THREE.Color().setRGB(1.12, 1.44, 1.62), roughness: 0.92, metalness: 0, transparent: true, envMapIntensity: 0.35 });
  const matEdge = new THREE.MeshStandardMaterial({ color: '#1d2b20', roughness: 0.95, metalness: 0, transparent: true });
  const mat = new THREE.Mesh(new THREE.BoxGeometry(MAT_W, MAT_T, MAT_D), [matEdge, matEdge, matMat, matEdge, matEdge, matEdge]);
  mat.position.set(0.35, -MAT_T / 2, 0.15); mat.rotation.y = -11 * DEG;
  mat.receiveShadow = true; mat.castShadow = true;
  matGroup.add(mat);
  const blobMat = new THREE.MeshBasicMaterial({ map: tex(makeBlobCanvas(256)), transparent: true, depthWrite: false, opacity: 0.42 });
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(2.45, 2.45), blobMat);
  blob.rotation.x = -Math.PI / 2;
  blob.position.set(-0.05, 0.0015, 0.04);
  blob.renderOrder = 1;
  matGroup.add(blob);

  const ruler = brassRuler();
  const pencilA = hexPencil({ bodyColor: '#ad8452', natural: true, print: 'HOLM  ·  HB', printColor: 'rgba(60,40,20,0.85)' });
  const pencilB = hexPencil({ bodyColor: '#1c1a18', natural: false, print: 'HOLM  ·  2B', printColor: 'rgba(210,196,170,0.7)' });
  const knife = craftKnife();
  const clip = paperclip();
  for (const p of [ruler, pencilA, pencilB, knife, clip]) { p.renderOrder = 2; matGroup.add(p); }
  scene.add(matGroup);

  // Screen frame at p = 0: right = +x, up = −z. Two arrangements: landscape keeps the left third and the
  // bottom-left clear for typography; portrait clusters the tools in the band beside/above the tray so
  // nothing is cropped at 390 px. NOTE for the page shell: in portrait the tray owns the width (≈ 66 % W,
  // centred at 60 % / 54 %) and the black pencil lies in the left band, so mobile hero copy must sit
  // above / below the tray, not beside it — the "left third free" rule holds on landscape only.
  const place = (obj, x, z, rotDeg) => { obj.position.x = x; obj.position.z = z; obj.rotation.y = rotDeg * DEG; };
  let portraitProps = null;
  function layoutProps(portrait) {
    if (portrait === portraitProps) return;
    portraitProps = portrait;
    if (portrait) {
      place(ruler, 0.05, -1.45, 2); place(knife, -0.22, -1.86, -4); place(clip, 0.62, -1.17, 14);
      place(pencilB, -1.45, 0.05, 94); place(pencilA, 0.05, 1.16, -6);  // tucked close to the rim so the page's hero card never half-covers it
    } else {
      place(ruler, 0.0, -1.48, 3); place(clip, 0.6, -1.14, 14); place(knife, 1.6, -0.25, -75);
      place(pencilB, 1.35, -1.12, -40); place(pencilA, 0.55, 1.27, -5);
    }
  }

  const fadeMats = [];
  matGroup.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = o !== desk && o !== blob;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (fadeMats.includes(m)) continue;
        m.transparent = true;
        m.userData.baseOpacity = m.opacity;
        fadeMats.push(m);
      }
    }
  });

  // ---- void props for the FEATURES beats: coins and a ring for "holds", a lit desk for "sits flat"
  const brassP = new THREE.MeshStandardMaterial({ color: '#9a8352', roughness: 0.38, metalness: 1, transparent: true, opacity: 0 });
  const nickel = new THREE.MeshStandardMaterial({ color: '#b9b7b0', roughness: 0.34, metalness: 1, transparent: true, opacity: 0 });
  const coinGroup = new THREE.Group();
  const coin = (r, h, m, x, z, rot) => { const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 48), m); c.position.set(x, FLOOR_Y + h / 2, z); c.rotation.y = rot; c.castShadow = true; coinGroup.add(c); return c; };
  coin(0.117, 0.028, brassP, -0.46, -0.30, 0.3); coin(0.10, 0.026, nickel, -0.30, -0.50, 1.1);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.095, 0.014, 16, 48), brassP);
  ring.rotation.x = Math.PI / 2; ring.position.set(0.52, FLOOR_Y + 0.014, 0.30); ring.castShadow = true; coinGroup.add(ring);
  coinGroup.visible = false;
  scene.add(coinGroup);
  tray.receiveShadow = true;
  const groundMat = deskMat.clone(); groundMat.opacity = 0;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(DESK, DESK), groundMat);
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.034; ground.receiveShadow = true; ground.visible = false;
  scene.add(ground);
  // A wall behind the tray for the hall-table beat. It rides a group that turns with the camera yaw so it is always
  // opposite the lens; plaster from a canvas (warm mottle, darker towards the skirting).
  const wallGroup = new THREE.Group(); scene.add(wallGroup);
  const wallMat = new THREE.MeshStandardMaterial({ map: tex(makePlasterCanvas(1024)), color: new THREE.Color().setRGB(1.0, 0.93, 0.82), roughness: 0.95, metalness: 0, transparent: true, opacity: 0, fog: false });
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(16, 7), wallMat);
  wall.position.set(0, 3.2, -3.4); wall.visible = false; wall.receiveShadow = true;
  wallGroup.add(wall);
  const skirt = new THREE.Mesh(new THREE.BoxGeometry(16, 0.28, 0.06), new THREE.MeshStandardMaterial({ color: '#e7dbc6', roughness: 0.6, metalness: 0, transparent: true, opacity: 0, fog: false }));
  skirt.position.set(0, 0.10, -3.38); skirt.visible = false; wallGroup.add(skirt);
  // Keys and a watch: they drop into the pocket when the beat arrives (materials fade with the beat like the coins).
  const darkP = new THREE.MeshStandardMaterial({ color: '#17120e', roughness: 0.35, metalness: 0.1, transparent: true, opacity: 0 });
  const leatherP = new THREE.MeshStandardMaterial({ color: '#3a2418', roughness: 0.8, metalness: 0, transparent: true, opacity: 0 });
  function makeKeys() {
    const g = new THREE.Group();
    const ringM = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.011, 10, 48), nickel); ringM.rotation.x = Math.PI / 2; g.add(ringM);
    for (const [ang, len, m] of [[0.35, 0.40, brassP], [-0.6, 0.34, nickel]]) {
      const k = new THREE.Group();
      const bow = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.02, 12, 36), m); bow.rotation.x = Math.PI / 2; bow.position.x = 0.11; k.add(bow);
      const shaft = new THREE.Mesh(new THREE.BoxGeometry(len, 0.018, 0.045), m); shaft.position.x = 0.11 + 0.075 + len / 2; k.add(shaft);
      for (const [dx, h] of [[len * 0.5, 0.035], [len * 0.66, 0.022], [len * 0.82, 0.04], [len * 0.94, 0.028]]) { const t = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.018, h), m); t.position.set(0.185 + dx, 0, 0.0225 + h / 2); k.add(t); }
      k.rotation.y = ang; g.add(k);
    }
    const fob = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 0.09), leatherP); fob.position.set(-0.19, 0, 0.02); fob.rotation.y = 0.5; g.add(fob);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return g;
  }
  function makeWatch() {
    const g = new THREE.Group();
    const caseM = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.20, 0.06, 64), nickel); g.add(caseM);
    const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.185, 0.014, 12, 64), nickel); bezel.rotation.x = Math.PI / 2; bezel.position.y = 0.03; g.add(bezel);
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.17, 64), darkP); face.rotation.x = -Math.PI / 2; face.position.y = 0.031; g.add(face);
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; const idx = new THREE.Mesh(new THREE.BoxGeometry(i % 3 === 0 ? 0.022 : 0.012, 0.002, 0.006), nickel); idx.position.set(Math.cos(a) * 0.145, 0.033, Math.sin(a) * 0.145); idx.rotation.y = -a; g.add(idx); }
    const hand = (len, w, rot) => { const h = new THREE.Mesh(new THREE.BoxGeometry(len, 0.003, w), nickel); h.position.set(Math.cos(rot) * len / 2, 0.035, -Math.sin(rot) * len / 2); h.rotation.y = rot; g.add(h); return h; };
    g.userData.hands = { h: hand(0.11, 0.012, 1.2), m: hand(0.15, 0.008, -0.6) };   // set to the visitor's clock every frame the watch is out
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.03, 16), nickel); crown.rotation.z = Math.PI / 2; crown.position.set(0.215, 0, 0); g.add(crown);
    for (const side of [1, -1]) { const strap = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.016, 0.30), leatherP); strap.position.set(0, -0.012, side * 0.34); strap.rotation.x = side * 0.18; g.add(strap); }
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return g;
  }
  const keysProp = makeKeys(), watchProp = makeWatch();
  keysProp.visible = watchProp.visible = false;
  coinGroup.add(keysProp, watchProp);
  let propsDropped = false;
  const queue = [];                                             // { at: elapsed seconds, fn }
  let coinT = 0, groundT = 0, ageT = 0, hideT = 0;
  // Interaction state: drag-to-rotate with inertia (offsets relax while the page scrolls, persist while it rests),
  // scroll-velocity kicks, and coins dropped into the pocket by the visitor.
  const drag = { yaw: 0, elev: 0, vYaw: 0, vElev: 0, active: false };
  const dropped = [];
  const coinGeoA = new THREE.CylinderGeometry(0.11, 0.11, 0.026, 48), coinGeoB = new THREE.CylinderGeometry(0.095, 0.095, 0.024, 48);
  let lastProgress = 0;
  const bounds = { x: 0, y: 0, r: 0 };
  const _proj = new THREE.Vector3();
  const focus = {};                                            // name → { nx, ny, width } screen-space targets for dynamic presets
  let blend = { a: null, b: null, f: 1 };                       // scroll-linked transition between two views (null = keyframes)
  const _A = { elev: 0, yaw: 0, width: 0, nx: 0, ny: 0, vd: 0, still: 0 }, _B = { elev: 0, yaw: 0, width: 0, nx: 0, ny: 0, vd: 0, still: 0 };
  // The camera is a pure function of scroll (the page eases the scroll itself), so scroll-linked targets are
  // followed exactly and a pinned tray never trails its rect. Discrete changes (a pill, the flip) add the
  // difference between old and new target here, and it decays away: that is the only temporal easing left.
  const jump = { elev: 0, yaw: 0, width: 0, nx: 0, ny: 0, vd: 0 };
  const _T0 = { elev: 0, yaw: 0, width: 0, nx: 0, ny: 0, vd: 0 }, _T1 = { elev: 0, yaw: 0, width: 0, nx: 0, ny: 0, vd: 0 };
  const wrap180 = (d) => ((d + 180) % 360 + 360) % 360 - 180;
  // Backdrops: cream grounds the scene paints behind the tray, pixel-aligned to DOM rects the page passes in
  // (the longevity section, the live tile). Camera-attached planes just beyond the tray, unlit and untouched
  // by tone mapping so they match the page's #ffedd7 exactly.
  const backdrops = [];
  const backdropMeshes = [0, 1].map(() => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xffedd7, toneMapped: false, fog: false }));
    m.visible = false; m.frustumCulled = false; camera.add(m); return m;
  });
  scene.add(camera);

  /* ------------------------------------------------------------ choreography */

  // Keyframes from the contract table. width = tray diameter as a fraction of viewport width (desktop);
  // nx/ny = tray centre offset from the viewport centre; vd = void amount (0 = photograph, 1 = void).
  const K = {
    // LIFT (0.18–0.26) drops the camera off the top-down photograph; the INTRO then TUMBLES the tray — up to
    // top-down, over the edge to the underside, back to a 3/4 rest at the section's anchor (0.40). FEATURES run
    // on presets, PRODUCT (≈0.82) is a clean top plateau, the DRAWING and CONTACT plates are small top-downs.
    elev:  [[0, 83], [0.18, 83], [0.26, 60], [0.31, 12], [0.35, -34], [0.40, 35], [0.50, 20], [0.70, 20], [0.78, 89.5], [0.86, 89.5], [0.92, 89.5], [1, 89.5]],
    yaw:   [[0, 0], [0.18, 0], [0.26, -10], [0.40, 110], [0.50, 130], [0.70, 160], [0.78, 270], [1, 270]],  // top plates square up: grain vertical
    width: [[0, 0.38], [0.18, 0.38], [0.26, 0.40], [0.46, 0.40], [0.54, 0.44], [0.66, 0.44], [0.74, 0.40], [0.86, 0.40], [0.92, 0.26], [1, 0.26]],
    nx:    [[0, 0.12], [0.18, 0.12], [0.30, 0], [1, 0]],
    ny:    [[0, -0.08], [0.18, -0.08], [0.30, 0], [1, 0]],
    vd:    [[0, 0], [0.18, 0], [0.26, 1], [1, 1]],   // the set is gone before the camera drops past ~50°
  };
  // View overrides keep the scroll yaw (so they never spin the long way) and always void the set.
  const PRESETS = {
    top:    { elev: 89.5, width: 0.40, nx: 0, ny: 0 },
    side:   { elev: 12,   width: 0.44, nx: 0, ny: 0 },
    detail: { elev: 55,   width: 0.46, nx: 0, ny: 0 },
    under:  { elev: -24,  width: 0.44, nx: 0, ny: 0 },   // the foot ring and chamfer from below
    lip:    { elev: 20,   width: 0.44, nx: 0, ny: 0 },   // low enough to read the pocket depth against the lip
    // FEATURES presets: the tray sits in the right two thirds beside a frosted panel (portrait: upper half, pnx/pny).
    f1:     { elev: 22,   width: 0.40, nx: 0.30, ny: 0, pwidth: 0.60, pnx: 0, pny: 0.40, props: true, ground: true, wall: true },   // the hall table: keys, a watch and coins land in the pocket
    f2:     { elev: 89.5, width: 0.36, nx: 0.30, ny: 0, pwidth: 0.56, pnx: 0, pny: 0.40, set: true },     // back on the cutting mat, top-down, under the measuring handles
    spinPlate: { elev: 30, width: 0.62, nx: 0, ny: 0, pwidth: 0.70, pnx: 0, pny: 0 },       // the turntable video plate
    code:   { elev: 32, width: 0.46, nx: 0, ny: -0.04, pwidth: 0.62, pnx: 0, pny: -0.2 },  // the closing beat: the lathe as wireframe
    f3:     { elev: 89.5, width: 0.38, nx: 0.30, ny: 0, pwidth: 0.58, pnx: 0, pny: 0.40, age: true },    // the walnut deepens and recovers on a slow cycle
    // Later beats: the underside flip, a macro across the rim, a small 3/4 between review columns, and 'away'
    // (tray hidden) for sections that paint their own ground or carry the tray as plates.
    flip:   { elev: -42,  width: 0.36, nx: 0, ny: 0, pwidth: 0.44, pnx: 0, pny: -0.42 },   // portrait: below the centred copy
    flipTop:{ elev: 89.5, width: 0.30, nx: 0, ny: 0, pwidth: 0.40, pnx: 0, pny: -0.42 },
    statement: { elev: 89.5, width: 0.28, nx: 0, ny: 0, pwidth: 0.44, pnx: 0, pny: 0.10 },
    // The tray is the thread through the whole page, so nothing ever hides it: it perches above the gallery,
    // becomes the O in HOLM (dynamic: the page passes the letter's on-screen rect), floats over the cream
    // ground of the longevity section and sits inside the cream tile of "Always on".
    light:  { elev: 89.5, dynamic: true },   // the tray is the o of "longevity": pinned to that glyph's box
    reviewsSlot: { elev: 35, dynamic: true },   // the top row of the reviews, between heading and body
    letterO:{ elev: 89.5, dynamic: true },
    footO:  { elev: 89.5, dynamic: true },
    lathe:  { elev: 28, width: 0.50, nx: 0, ny: -0.08, pwidth: 0.85, pnx: 0, pny: -0.22, lathe: true },
    section: { elev: 21, width: 0.46, nx: 0, ny: -0.02, pwidth: 0.82, pnx: 0, pny: -0.25, cut: true },      // the drawing's Section A–A, live: the near half clipped away, the face hatched
    scale:  { elev: 64, width: 0.31, nx: -0.04, ny: 0, pwidth: 0.50, pnx: 0, pny: -0.25, scale: true },          // a bank card and a phone beside it, both to size   // the turning beat: the blank becomes the tray with the scroll
    tile:   { elev: 89.5, dynamic: true },
    photo:  { elev: 83,   yaw: 0, still: true, dynamic: true },   // sits exactly on the printed tray in the gallery's photograph: same yaw as the render, no idle drift
    // Portrait: reveal sections pin the tray to their layout slot so it scrolls with the words instead of sitting under them.
    slotQuarter: { elev: 35, dynamic: true },
    slotTop:     { elev: 89.5, dynamic: true },
    macro:  { elev: 12,   width: 0.88, nx: 0, ny: -0.38, pwidth: 1.3, pnx: 0.05, pny: -0.30, pointerYaw: 22, pointerElev: 5, noCap: true },   // grain level in the lower third; the pointer sweeps along the rim
  };
  const FIELDS = ['elev', 'yaw', 'width', 'nx', 'ny', 'vd'];
  const widthKeys = K.width.map(([p, v]) => [p, v]);                  // hero entries re-capped on resize

  let W = 2, H = 2, aspect = 1;
  let progress = 0, override = null, spinning = false, spinAngle = 0;
  const pointer = { x: 0, y: 0 }, pointerCur = { x: 0, y: 0 };
  const cur = { elev: 83, yaw: 0, width: 0.38, nx: 0.2, ny: -0.08, vd: 0 };
  const tgt = { elev: 0, yaw: 0, width: 0, nx: 0, ny: 0, vd: 0 };
  const view = { elev: 0, yaw: 0, width: 0, nx: 0, ny: 0, vd: 0 };
  let first = true;
  const clock = new THREE.Clock(false);
  let elapsed = 0;

  function targetView(p, out) {
    out.elev = track(K.elev, p); out.yaw = track(K.yaw, p); out.width = track(widthKeys, p);
    if (aspect < 1) out.width = Math.min(out.width * 1.75, 0.72);              // portrait: the tray owns the width
    else out.width = Math.min(out.width, MAX_H / aspect);                        // wide screens: never taller than MAX_H of the viewport
    out.nx = track(K.nx, p); out.ny = track(K.ny, p); out.vd = track(K.vd, p);
    out.still = 0;
    if (blend.a || blend.b) {
      stateOf(blend.a, out, _A); stateOf(blend.b, out, _B);
      const f = smooth(blend.f);
      out.elev = lerp(_A.elev, _B.elev, f); out.width = lerp(_A.width, _B.width, f);
      out.nx = lerp(_A.nx, _B.nx, f); out.ny = lerp(_A.ny, _B.ny, f); out.vd = lerp(_A.vd, _B.vd, f);
      out.yaw = lerp(_A.yaw, _B.yaw, f); out.still = lerp(_A.still, _B.still, f);
      // A carried object arcs: mid-flight the tray comes a little toward the lens, lifts, and turns a few degrees,
      // then lands exactly where the next beat wants it. Nothing at either end, so pinned views stay exact.
      if (!reduced && f > 0 && f < 1) { const arc = Math.sin(Math.PI * f) * out.vd; out.width *= 1 + 0.09 * arc; out.ny += 0.02 * arc; out.yaw += 12 * arc; }
    }
    return out;
  }
  // A named view's camera state; null means "whatever the scroll keyframes say" (the base already in `out`).
  function stateOf(name, base, dst) {
    const o = name && PRESETS[name];
    dst.yaw = base.yaw; dst.still = 0;
    if (!o) { dst.elev = base.elev; dst.width = base.width; dst.nx = base.nx; dst.ny = base.ny; dst.vd = base.vd; return dst; }
    dst.elev = o.elev; dst.vd = o.set ? 0 : 1; dst.still = o.still ? 1 : 0;
    if (o.yaw != null) dst.yaw = o.yaw + Math.round((base.yaw - o.yaw) / 360) * 360;   // the nearest turn, never the long way round
    const portrait = aspect < 1;
    if (o.dynamic) { const fo = focus[name] || { nx: 0, ny: 0, width: 0.2 }; dst.width = fo.width; dst.nx = fo.nx; dst.ny = fo.ny; }
    else {
      dst.width = portrait ? (o.pwidth != null ? o.pwidth : Math.min(o.width * 1.75, 0.72)) : (o.noCap ? o.width : Math.min(o.width, MAX_H / aspect));
      dst.nx = portrait && o.pnx != null ? o.pnx : o.nx; dst.ny = portrait && o.pny != null ? o.pny : o.ny;
    }
    return dst;
  }

  const _dir = new THREE.Vector3(), _right = new THREE.Vector3(), _up = new THREE.Vector3();
  const sph = (out, az, el, d) => out.set(target.x + d * Math.cos(el) * Math.sin(az), target.y + d * Math.sin(el), target.z + d * Math.cos(el) * Math.cos(az));

  function applyCamera(v) {
    const frac = v.width;                                     // already a screen fraction (portrait sizing is applied in target space)
    const tanH = Math.tan(FOV / 2 * DEG);
    const dist = TRAY_D / (frac * aspect * 2 * tanH);
    const el = clamp(v.elev, -60, 89.5) * DEG, yaw = v.yaw * DEG;
    const below = smooth(clamp(-v.elev / 30, 0, 1));           // camera under the horizon: swing the key and rim down with it
    _dir.set(Math.cos(el) * Math.sin(yaw), Math.sin(el), Math.cos(el) * Math.cos(yaw));
    camera.position.copy(target).addScaledVector(_dir, dist);
    camera.up.set(0, 1, 0);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    const halfHw = dist * tanH, halfWw = halfHw * aspect;
    _right.setFromMatrixColumn(camera.matrixWorld, 0);
    _up.setFromMatrixColumn(camera.matrixWorld, 1);
    camera.position.addScaledVector(_right, -v.nx * halfWw).addScaledVector(_up, -v.ny * halfHw);
    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    _proj.copy(target).project(camera);
    bounds.x = (_proj.x + 1) / 2 * W; bounds.y = (1 - _proj.y) / 2 * H; bounds.r = frac * W / 2;
    // backdrop planes: a depth just beyond the tray's far rim, sized to the frustum slice at that depth
    const D = dist + 1.3, hf = 2 * D * tanH, wf = hf * aspect;
    for (let i = 0; i < backdropMeshes.length; i++) {
      const m = backdropMeshes[i], b = backdrops[i];
      if (!b) { m.visible = false; continue; }
      const l = b.left ?? 0, r = b.right ?? W, t = b.top, btm = b.bottom;
      const x0 = (l / W - 0.5) * wf, x1 = (r / W - 0.5) * wf, y0 = (0.5 - btm / H) * hf, y1 = (0.5 - t / H) * hf;
      m.position.set((x0 + x1) / 2, (y0 + y1) / 2, -D);
      m.scale.set(Math.max(0.001, x1 - x0), Math.max(0.001, y1 - y0), 1);
      m.visible = true;
    }
    scene.fog.near = dist + 0.3;                              // a whisper of depth on the far rim
    scene.fog.far = dist + 9.5;

    // light rig, relative to the camera yaw
    const lift = v.vd;
    sph(key.position, yaw + (lerp(135, 55, lift) + hourSwing * (1 - lift)) * DEG, lerp(lerp(52 - 14 * hourWarm, 46, lift), -42, below) * DEG, 6);
    sph(spot.position, yaw + (135 + hourSwing) * DEG, (58 - 16 * hourWarm) * DEG, 7.5);
    sph(rim.position, yaw + 135 * DEG, lerp(24, -18, below) * DEG, 6);
    sph(front.position, yaw - 40 * DEG, 42 * DEG, 6);
    sph(bounce.position, yaw - 35 * DEG, -10 * DEG, 6);
    key.intensity = lerp(0.75, 3.0, lift);                    // the spot carries the hero; the key carries the void
    spot.intensity = 150 * (1 - lift);
    rim.intensity = lerp(1.2, 2.0, lift);
    front.intensity = lerp(0.25, 0.9, lift) * (1 - 0.35 * lampOn * lift);
    bounce.intensity = 0.6 * lift;
    hemi.intensity = lerp(0.15, 0.65, lift);
  }

  function applySet(vd) {
    const op = 1 - vd;
    matGroup.visible = op > 0.01;
    spot.visible = matGroup.visible;
    matGroup.position.y = -0.3 * vd;
    for (const m of fadeMats) m.opacity = m.userData.baseOpacity * op;

  }

  let raf = 0, running = false, pending = 0, disposed = false;

  function update(dt) {
    targetView(progress, tgt);
    const snap = first || reduced || !running;               // static / reduced motion / on-demand frames: no damping
    const a = snap ? 1 : 1 - Math.exp(-dt * 6.5);
    const aj = snap ? 1 : 1 - Math.exp(-dt * 2.6);            // discrete retargets ease away at the cinematic rate
    for (const f of FIELDS) { jump[f] -= jump[f] * aj; cur[f] = tgt[f] + jump[f]; }
    const sw = clamp(tgt.still || 0, 0, 1);                   // 1 while the tray is meant to sit still on a photograph
    pointerCur.x += (pointer.x - pointerCur.x) * a; pointerCur.y += (pointer.y - pointerCur.y) * a;
    first = false;
    if (!isStatic) {
      elapsed += dt;
      if (spinning && !reduced) spinAngle += dt * (360 / 12);
      else if (spinAngle !== 0) {                              // glide home to the nearest full turn
        const home = Math.round(spinAngle / 360) * 360;
        spinAngle += (home - spinAngle) * a;
        if (Math.abs(home - spinAngle) < 0.02) spinAngle = 0;
      }
    }
    const vd = cur.vd;
    // Idle life, only in the void (the hero photograph stays still): a slow yaw wander, a slower nod and a
    // gentle float, plus a cursor tilt of a few degrees. Reduced motion switches all of it off.
    const live = vd * (1 - sw);                               // idle life pauses while the tray sits on a photograph
    const drift = reduced ? 0 : Math.sin(elapsed * 0.35) * 4.5 * live;
    const driftEl = reduced ? 0 : Math.sin(elapsed * 0.23 + 1.0) * 1.6 * live;
    const bob = reduced ? 0 : Math.sin(elapsed * 0.6 + 0.4) * 0.012 * live;
    // Drag inertia and relaxation. While the visitor drags, offsets follow the hand; on release they coast with
    // friction; and whenever the page scrolls the offsets ease back so the choreography regains the wheel.
    if (!isStatic) {
      if (!drag.active) { drag.yaw += drag.vYaw * dt; drag.elev += drag.vElev * dt; }
      const fr = Math.exp(-dt * 3.2); drag.vYaw *= fr; drag.vElev *= fr;
      const scrollSpeed = dt > 0 ? Math.abs(progress - lastProgress) / dt : 0;
      const relax = Math.max(1 - Math.exp(-dt * clamp(scrollSpeed * 40, 0, 1) * 4), sw * (1 - Math.exp(-dt * 3)));
      drag.yaw -= drag.yaw * relax; drag.elev -= drag.elev * relax;
      drag.elev = clamp(drag.elev, -70, 70);
    }
    lastProgress = progress;
    const oNow = override && PRESETS[override];
    const pgY = (oNow && oNow.pointerYaw) || 4.0, pgE = (oNow && oNow.pointerElev) || 3.0;
    view.elev = clamp(cur.elev + driftEl - pointerCur.y * pgE * (1 - sw) + drag.elev, -60, 89.9);
    view.yaw = cur.yaw + spinAngle + drift + pointerCur.x * pgY * (1 - sw) + drag.yaw + extraYaw;
    // Pointer parallax: a gentle pan across the photograph in the hero, a nudge of the object in the void.
    view.width = cur.width;
    view.nx = cur.nx + pointerCur.x * (0.006 * vd + 0.014 * (1 - vd)) * (1 - sw);
    view.ny = cur.ny + bob - pointerCur.y * (0.006 * vd + 0.010 * (1 - vd)) * (1 - sw);
    view.vd = vd;
    // Dropped coins: fall, bounce twice, settle with a small wobble; they share the beat's coin materials so they
    // fade with it. Oldest coins leave first once the pocket is busy.
    if (!isStatic) for (let i = dropped.length - 1; i >= 0; i--) {
      const c = dropped[i]; const m = c.mesh;
      if (!c.settled) {
        c.vy -= 5.5 * dt; m.position.y += c.vy * dt;
        m.position.x += c.vx * dt; m.position.z += c.vz * dt;
        if (m.position.y <= c.rest) {
          const impact = Math.abs(c.vy);
          if (api.onLand && impact > 0.3) { try { api.onLand(clamp(impact / 4, 0, 1), c.kind || 'coin'); } catch {} }
          m.position.y = c.rest; c.vy = -c.vy * 0.32; c.vx *= 0.5; c.vz *= 0.5; c.bounces++;
          if (Math.abs(c.vy) < 0.25 || c.bounces > 3) { c.vy = 0; c.settled = true; }
        }
        const air = clamp((m.position.y - c.rest) / 1.2, 0, 1);
        m.rotation.x = c.tiltX * air; m.rotation.z = c.tiltZ * air; m.rotation.y += c.spin * dt * air;
        const lim = c.bound || 0.72, rr = Math.hypot(m.position.x, m.position.z);   // stay inside the pocket wall
        if (rr > lim) { m.position.x *= lim / rr; m.position.z *= lim / rr; c.vx = -c.vx * 0.4; c.vz = -c.vz * 0.4; }
      }
    }
    // The lathe: the morph follows the beat's scroll progress while the beat is on, and eases back to the finished
    // tray when it is left; the tray spins while there is still wood to take off.
    const oL = oNow && oNow.lathe ? 1 : 0;
    cutTarget = oNow && oNow.cut ? 1 : 0; scaleTarget = oNow && oNow.scale ? 1 : 0;
    latheT += (oL - latheT) * (snap ? 1 : Math.min(1, a * 1.2));
    if (latheT < 0.001 && !oL) latheT = 0;
    const eff = 1 - latheT * (1 - turnT);
    cutRate += ((dt > 0 ? Math.abs(eff - lastEff) / dt : 0) - cutRate) * (snap ? 1 : Math.min(1, dt * 8)); lastEff = eff;
    if (Math.abs(eff - morphAt) > 0.0004 || (eff >= 1 && morphAt < 1)) applyMorph(Math.min(eff, 1.001));
    spinF = latheT * (1 - smooth((turnT - 0.9) / 0.1));
    if (!isStatic && !reduced) latheAngle = (latheAngle + 7.5 * spinF * dt) % (Math.PI * 2);
    trayGroup.rotation.y = latheT * wrapPi(latheAngle);
    latheGroup.rotation.y = view.yaw * DEG;
    if (latheT > 0.01) updateLathe(dt, eff, view.yaw * DEG); else chisel.visible = false;
    if (latheT > 0.01 || chipsAlive) updateChips(dt);
    latheGroup.visible = latheT > 0.01 || chipsAlive;
    // Section A–A: the plane faces the lens (the tray's yaw drifts, so it is set every frame) and sweeps in
    // from beyond the rim to the axis; the hatched face fades in over the last part of the sweep.
    cutT += (cutTarget - cutT) * (snap ? 1 : Math.min(1, a * 1.1));
    if (cutT < 0.001 && !cutTarget) cutT = 0;
    bindCut(cutT > 0.001);
    if (cutT > 0.001) {
      const yr = view.yaw * DEG, sy = Math.sin(yr), cy = Math.cos(yr);
      cutPlane.normal.set(-sy, 0, -cy); cutPlane.constant = lerp(1.25, 0, smooth(cutT));
      cap.rotation.y = yr; cap.material.opacity = smooth((cutT - 0.55) / 0.45); cap.visible = cap.material.opacity > 0.01;
    } else cap.visible = false;
    // For scale: the card and the phone settle onto the plane beside the tray and fade with the beat.
    scaleT += (scaleTarget - scaleT) * (snap ? 1 : Math.min(1, a * 1.1));
    if (scaleT < 0.001 && !scaleTarget) scaleT = 0;
    scaleGroup.visible = scaleT > 0.01;
    if (scaleGroup.visible) { const k = smooth(scaleT); scaleGroup.rotation.y = view.yaw * DEG; scaleGroup.position.y = (1 - k) * 0.5; for (const m of scaleMats) m.opacity = k; }   // laid out relative to the lens: card left, phone right
    // The watch keeps the visitor's time.
    if (coinGroup.visible && watchProp.visible) {
      const d = new Date(), hh = watchProp.userData.hands;
      const th = ((d.getHours() % 12) + d.getMinutes() / 60) / 12 * Math.PI * 2, tm = (d.getMinutes() + d.getSeconds() / 60) / 60 * Math.PI * 2;
      const set = (h, len, rot) => { h.position.set(Math.cos(rot) * len / 2, 0.035, -Math.sin(rot) * len / 2); h.rotation.y = rot; };
      set(hh.h, 0.11, Math.PI / 2 - th); set(hh.m, 0.15, Math.PI / 2 - tm);
    }
    // Dust: a slow drift, each mote on its own phase; fades with the lift and the lamp.
    if (!isStatic) {
      const mo = 0.32 * vd * (1 - sw) * (0.35 + 0.65 * lampOn);
      motes.material.opacity += (mo - motes.material.opacity) * a;
      motes.visible = motes.material.opacity > 0.01;
      if (motes.visible && !reduced) {
        const arr = moteGeo.attributes.position.array;
        for (let i = 0; i < MOTES; i++) { const o = i * 3, ph = moteSeed[i * 2], sp = moteSeed[i * 2 + 1]; arr[o] += Math.sin(elapsed * 0.31 * sp + ph) * 0.0012; arr[o + 1] += (0.010 + 0.006 * Math.sin(elapsed * 0.2 + ph)) * dt * sp; arr[o + 2] += Math.cos(elapsed * 0.27 * sp + ph) * 0.0012; if (arr[o + 1] > 1.55) arr[o + 1] = -0.3; }
        moteGeo.attributes.position.needsUpdate = true;
      }
    }
    if (developing) { devT += (1 - devT) * (snap ? 1 : 1 - Math.exp(-dt * 1.35)); if (devT > 0.999) { devT = 1; developing = false; } }
    applyCamera(view);
    // The lamp sits between the lens and the tray, offset toward the hand, and only lights the void.
    _fwd.setFromMatrixColumn(camera.matrixWorld, 2);
    lamp.position.copy(target).addScaledVector(_fwd, 2.2).addScaledVector(_right, pointerCur.x * 2.6).addScaledVector(_up, -pointerCur.y * 2.0 + 1.2);
    lamp.intensity = 30 * vd * (1 - sw) * lampOn;
    applySet(vd);
    const o = override && PRESETS[override];
    // FEATURES props: ease in and out with the beat.
    coinT += ((o && o.props ? 1 : 0) - coinT) * a; groundT += ((o && o.ground ? 1 : 0) - groundT) * a;
    const wallT = o && o.wall ? groundT : Math.max(0, groundT - (o && o.ground ? 0 : 0));
    coinGroup.visible = coinT > 0.01; ground.visible = groundT > 0.01;
    brassP.opacity = nickel.opacity = darkP.opacity = leatherP.opacity = coinT; groundMat.opacity = groundT;
    wallMat.opacity = skirt.material.opacity = (o && o.wall ? 1 : 0) * groundT;
    wall.visible = skirt.visible = wallMat.opacity > 0.01;
    wallGroup.rotation.y = view.yaw * DEG;
    // The keys and the watch drop in the first time the hall table appears; visitors add coins themselves.
    if (!isStatic) {
      if (coinT > 0.5 && !propsDropped) {
        propsDropped = true;
        queue.push({ at: elapsed + 0.05, fn: () => dropObject(keysProp, -0.30, 0.34, 0.02, 0.9, 46) });
        queue.push({ at: elapsed + 0.45, fn: () => dropObject(watchProp, 0.24, -0.16, 0.042, -0.5, 68) });
      }
      if (coinT < 0.05 && propsDropped && !(o && o.props)) { propsDropped = false; keysProp.visible = watchProp.visible = false; }
      for (let i = queue.length - 1; i >= 0; i--) if (elapsed >= queue[i].at) { const q = queue.splice(i, 1)[0]; q.fn(); }
    }
    // "Made of code": the wood thins to a ghost while the wireframe of the same lathe comes up.
    codeT += (codeTarget - codeT) * a;
    wood.transparent = codeT > 0.001; wood.opacity = 1 - codeT * 0.92; wood.depthWrite = codeT < 0.5;
    wire.visible = codeT > 0.01; wire.material.opacity = codeT * 0.8;
    stampFloor.material.opacity = stampUnder.material.opacity = 1 - codeT;
    stampFloor.visible = stampUnder.visible = codeT < 0.02;              // otherwise their depth write punches a hole in the wireframe
    const ageTarget = o && o.age && !reduced ? (1 - Math.cos(elapsed * (Math.PI * 2 / 9))) / 2 : (o && o.age ? 0.5 : 0);
    ageT += (ageTarget - ageT) * (snap ? 1 : Math.min(1, a * 1.5));
    wood.color.setRGB(lerp(1, 0.56, ageT), lerp(1, 0.50, ageT), lerp(1, 0.46, ageT));
    // The whole scene grades with the ageing: a touch under-exposed and warmer, like an evening ten years on.
    renderer.toneMappingExposure = lerp(1.08, 0.86, ageT) * lerp(0.06, 1, smooth(devT));
    const hg = lerp(lerp(0.90, 0.74, hourWarm), 0.843, vd), hb = lerp(lerp(0.80, 0.52, hourWarm), 0.682, vd);   // the hour tints the photograph, not the void
    key.color.setRGB(1.0, lerp(hg, 0.72, ageT), lerp(hb, 0.47, ageT));
    key.castShadow = matGroup.visible || ground.visible || coinGroup.visible;
    key.shadow.intensity = Math.max(1 - vd, groundT, coinT);
  }

  function renderNow() {
    if (disposed) return 0;
    const dt = clock.running ? Math.min(clock.getDelta(), 0.25) : 0;   // long frames (software GL, tab switches) still converge quickly
    update(dt);
    renderer.render(scene, camera);
    return dt;
  }
  // Adaptive resolution: the scene is fill-bound, so when frames run long the pixel ratio steps down a quarter at a
  // time (never below 1), and steps back up once frames have been comfortably short for a while.
  let baseDpr = 1, quality = 1, ftAcc = 0, ftN = 0, calm = 0;
  function applyPixelRatio() { renderer.setPixelRatio(Math.max(1, baseDpr * quality)); }
  function adapt(dt) {
    if (dt <= 0 || dt > 0.2 || clock.elapsedTime < 2.5) return;      // ignore the first frames and tab switches
    ftAcc += dt; ftN++;
    if (ftN < 30) return;
    const avg = ftAcc / ftN; ftAcc = 0; ftN = 0;
    if (avg > 1 / 45 && quality > 0.5) { quality = Math.max(0.5, quality - 0.25); calm = 0; applyPixelRatio(); }
    else if (avg < 1 / 58 && quality < 1 && ++calm >= 4) { quality = Math.min(1, quality + 0.25); calm = 0; applyPixelRatio(); }
  }
  function requestRender() {
    if (disposed || running || pending) return;
    pending = requestAnimationFrame(() => { pending = 0; renderNow(); });
  }
  // One frame, in order: the page's frame work (eased scroll, section tracking) → scene update → render → the
  // followers that read the tray's screen bounds. Everything the visitor sees in a frame agrees with itself.
  function loop() {
    if (!running) return;
    if (api.onFrame) { try { api.onFrame(); } catch (e) { console.warn(e); } }
    const dt = renderNow();
    adapt(dt);
    if (api.afterFrame) { try { api.afterFrame(); } catch (e) { console.warn(e); } }
    raf = requestAnimationFrame(loop);
  }
  const onContextLost = (e) => { e.preventDefault(); };
  const onContextRestored = () => { requestRender(); };
  canvas.addEventListener('webglcontextlost', onContextLost, false);
  canvas.addEventListener('webglcontextrestored', onContextRestored, false);

  // Drop any prop into the pocket: it falls from above, bounces once or twice and settles flat.
  function dropObject(mesh, x, z, restH, rotY, mass = 0) {
    mesh.visible = true;
    mesh.position.set(x, FLOOR_Y + 1.3, z); mesh.rotation.set(0, rotY, 0);
    dropped.push({ mesh, kind: 'prop', mass, vy: -0.3, vx: 0, vz: 0, rest: FLOOR_Y + restH, settled: false, bounces: 0, bound: 0.45, tiltX: (Math.random() - 0.5) * 0.5, tiltZ: (Math.random() - 0.5) * 0.5, spin: (Math.random() - 0.5) * 1.5 });
    requestRender();
  }

  function retarget(mutate, animate) {
    if (animate && !first && !isStatic) {
      targetView(progress, _T0); mutate(); targetView(progress, _T1);
      for (const f of FIELDS) jump[f] += _T0[f] - _T1[f];
      jump.yaw = wrap180(jump.yaw);
    } else mutate();
    requestRender();
  }

  const api = {
    setProgress(p) { progress = clamp(Number(p) || 0, 0, 1); requestRender(); },
    setPointer(nx, ny) { pointer.x = clamp(Number(nx) || 0, -1, 1); pointer.y = clamp(Number(ny) || 0, -1, 1); lampOn = 1; requestRender(); },
    // A named view, held (pills). animate = ease from the current target instead of cutting.
    setViewOverride(name, animate = true) {
      const n = (name && PRESETS[name]) ? name : null;
      retarget(() => { blend = { a: n, b: n, f: 1 }; override = n; }, animate);
    },
    // Scroll-linked transition: f in [0,1] from view a to view b (either may be null for the scroll keyframes).
    // Called on every scroll with animate = false so the camera tracks exactly; pass true for a discrete change.
    setViewBlend(a, b, f, animate = false) {
      const A = (a && PRESETS[a]) ? a : null, B = (b && PRESETS[b]) ? b : null;
      retarget(() => { blend = { a: A, b: B, f: clamp(Number(f) || 0, 0, 1) }; override = blend.f >= 0.5 ? B : A; }, animate);
    },
    getAge() { return ageT; },
    // Interaction ---------------------------------------------------------------------------------------
    getBounds() { return { x: bounds.x, y: bounds.y, r: bounds.r, visible: trayGroup.visible, void: cur.vd }; },
    // Screen-space target for a dynamic view: centre (css px) and diameter (css px), landed exactly.
    setFocus(name, x, y, d) { focus[name] = { nx: (x / W - 0.5) * 2, ny: -(y / H - 0.5) * 2, width: clamp(d / W, 0.02, 1.6) }; requestRender(); },
    // Cream grounds behind the tray, as css-px rects {top, bottom, left?, right?}; pass [] to clear.
    setBackdrops(list) { backdrops.length = 0; for (const b of (list || []).slice(0, 2)) if (b && b.bottom > b.top) backdrops.push(b); requestRender(); },
    dragStart() { drag.active = true; drag.vYaw = 0; drag.vElev = 0; requestRender(); },
    drag(dx, dy, dt = 1 / 60) {                            // css px deltas; ~0.35° per px of yaw, 0.25° per px of elevation
      if (reduced) return;
      const dYaw = dx * 0.35, dEl = -dy * 0.25;
      drag.yaw += dYaw; drag.elev = clamp(drag.elev + dEl, -70, 70);
      const k = 1 / Math.max(dt, 1 / 240);                  // velocity estimate for the coast after release
      drag.vYaw = drag.vYaw * 0.5 + (dYaw * k) * 0.5; drag.vElev = drag.vElev * 0.5 + (dEl * k) * 0.5;
      requestRender();
    },
    dragEnd() { drag.active = false; drag.vYaw = clamp(drag.vYaw, -540, 540); drag.vElev = clamp(drag.vElev, -240, 240); requestRender(); },
    kick(degPerSec) { if (!reduced) { drag.vYaw = clamp(drag.vYaw + degPerSec * cur.vd, -180, 180); requestRender(); } },
    setCode(t) { codeTarget = clamp(Number(t) || 0, 0, 1); requestRender(); },
    setYawOffset(deg) { extraYaw = Number(deg) || 0; requestRender(); },
    getStats() {
      const pos = T.geo.getAttribute('position');
      const tris = T.geo.index ? T.geo.index.count / 3 : pos.count / 3;
      let canvases = 0; const seenT = new Set();
      scene.traverse(ob => { const ms = ob.isMesh ? (Array.isArray(ob.material) ? ob.material : [ob.material]) : []; for (const m of ms) for (const k of Object.keys(m)) { const v = m[k]; if (v && v.isTexture && !seenT.has(v)) { seenT.add(v); canvases++; } } });
      return { triangles: Math.round(tris), wireSegments: wire.geometry.getAttribute('position').count / 2, canvases, drawCalls: renderer.info.render.calls, lights: [key, spot, rim, front, bounce, hemi].length };
    },
    onLand: null,                                                // (impact 0..1, 'coin' | 'prop') when something meets the pocket
    setTurn(t) { turnT = clamp(Number(t) || 0, 0, 1); requestRender(); },
    // The opening: the print comes up in the bath and the lens settles onto the photograph from a touch closer and to one side.
    open() {
      if (reduced || isStatic) return;
      devT = 0; developing = true;
      jump.width -= 0.045; jump.yaw += 9; jump.elev -= 4; jump.yaw = wrap180(jump.yaw);
      requestRender();
    },
    // Oak, prepared quietly in advance so the answer to the question is instant.
    prepareTimber(name) {
      if (name !== 'oak' || timber.oak) return Promise.resolve();
      return new Promise(res => setTimeout(() => {
        const cv = makeWoodCanvases(timberSize, T.floor, OAK);
        timber.oak = { map: tex(cv.color, { anisotropy: Math.min(8, maxAniso) }), data: tex(cv.data, { srgb: false, anisotropy: Math.min(8, maxAniso) }) };
        res();
      }, 0));
    },
    async setTimber(name) {
      if (name === timberNow) return;
      if (name === 'oak') await api.prepareTimber('oak');
      const m = name === 'oak' ? timber.oak : walnutMaps;
      wood.map = m.map; wood.roughnessMap = wood.bumpMap = m.data; wood.needsUpdate = true;
      timberNow = name; requestRender();
    },
    getTimber() { return timberNow; },
    // A photograph: the current frame at up to twice the pixel ratio, as a PNG data URL.
    photo(scale = 2) {
      const pr = renderer.getPixelRatio();
      renderer.setPixelRatio(Math.min(3, pr * scale)); renderNow();
      const url = canvas.toDataURL('image/png');
      renderer.setPixelRatio(pr); requestRender();
      return url;
    },
    burst(n = 60) {
      if (reduced && isStatic) return;
      for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, sp = 1.4 + Math.random() * 1.6; emitChip((Math.random() - 0.5) * 0.6, FLOOR_Y + 0.05, (Math.random() - 0.5) * 0.6, Math.cos(a) * sp * 0.6, 1.8 + Math.random() * 1.6, Math.sin(a) * sp * 0.6); }
      chipsAlive = true; latheGroup.visible = true; requestRender();
    },
    // The tray as a file: the finished lathe, its wood and its stamps, as a binary glTF. Textures are capped so the
    // file stays a few megabytes.
    async exportGLB() {
      const { GLTFExporter } = await import('./vendor/GLTFExporter.js');
      const g = new THREE.Group(); g.name = 'HOLM-1';
      const woodCopy = wood.clone(); woodCopy.clippingPlanes = null; woodCopy.transparent = false; woodCopy.opacity = 1; woodCopy.color.set(1, 1, 1);
      const mesh = new THREE.Mesh(T.geo, woodCopy); mesh.name = 'tray'; g.add(mesh);
      for (const st of [stampFloor, stampUnder]) { const c = st.clone(); c.material = st.material.clone(); c.material.clippingPlanes = null; g.add(c); }
      const buf = await new Promise((res, rej) => new GLTFExporter().parse(g, res, rej, { binary: true, maxTextureSize: 1024 }));
      return buf instanceof ArrayBuffer ? buf : new TextEncoder().encode(JSON.stringify(buf)).buffer;
    },
    getTurn() { return { t: turnT, active: latheT, eff: morphAt, cutting: clamp(cutRate / 0.6, 0, 1), spin: spinF }; },
    setHour(h) {
      h = ((Number(h) || 0) % 24 + 24) % 24;
      hourWarm = h < 6 || h >= 21 ? 1 : h < 10 ? lerp(0.85, 0.15, (h - 6) / 4) : h < 16 ? lerp(0.15, 0.45, (h - 10) / 6) : lerp(0.45, 1, (h - 16) / 5);
      hourSwing = clamp((h - 13) * 6, -40, 40);
      spot.color.setRGB(1, lerp(0.92, 0.76, hourWarm), lerp(0.84, 0.56, hourWarm));
      requestRender();
    },
    setNumber(n) {
      const num = `Nº ${String(n).padStart(3, '0')}`, year = String(new Date().getFullYear());
      const swap = (mesh, lines) => { const old = mesh.material.map; mesh.material.map = tex(makeStampCanvas(512, lines)); mesh.material.needsUpdate = true; if (old) old.dispose(); };
      swap(stampFloor, [{ text: 'HOLM', size: 0.19, y: -0.07, spacing: 0.06 }, { text: num, size: 0.13, y: 0.14 }]);
      swap(stampUnder, [{ text: 'HOLM', size: 0.17, y: -0.16, spacing: 0.07 }, { text: 'HAND TURNED', size: 0.07, y: 0.0, spacing: 0.02 },
        { text: 'BLACK WALNUT', size: 0.07, y: 0.10, spacing: 0.02 }, { text: `${num} · ${year}`, size: 0.08, y: 0.22 }]);
      requestRender();
    },
    snapshot() { renderNow(); return { url: canvas.toDataURL('image/png'), scale: renderer.getPixelRatio(), x: bounds.x, y: bounds.y, r: bounds.r }; },
    onFrame: null,                                               // called at the top of every rendered frame
    afterFrame: null,                                            // called after every rendered frame, bounds fresh
    isRunning() { return running; },
    getQuality() { return { quality, pixelRatio: renderer.getPixelRatio(), antialias: renderer.getContextAttributes().antialias }; },
    getHeld() {
      let grams = 0, settling = false;
      for (const c of dropped) { if (!c.mesh.visible) continue; if (c.bounces > 0) grams += c.mass || 0; if (!c.settled) settling = true; }
      return { grams, settling };
    },
    dropCoin() {
      if (reduced && isStatic) return;
      const brass = Math.random() < 0.6;
      const mesh = new THREE.Mesh(brass ? coinGeoA : coinGeoB, brass ? brassP : nickel);
      const h = brass ? 0.026 : 0.024, ang = Math.random() * Math.PI * 2, rad = 0.15 + Math.random() * 0.45;
      mesh.position.set(Math.cos(ang) * rad, FLOOR_Y + 1.5, Math.sin(ang) * rad);
      mesh.rotation.y = Math.random() * Math.PI; mesh.castShadow = true;
      coinGroup.add(mesh);
      dropped.push({ mesh, kind: 'coin', mass: brass ? 8.75 : 6.5, vy: -0.4, vx: (Math.random() - 0.5) * 0.5, vz: (Math.random() - 0.5) * 0.5, rest: FLOOR_Y + h / 2, settled: false, bounces: 0,
        tiltX: (Math.random() - 0.5) * 1.6, tiltZ: (Math.random() - 0.5) * 1.6, spin: (Math.random() - 0.5) * 6 });
      let coins = dropped.filter(d => d.mesh !== keysProp && d.mesh !== watchProp);
      while (coins.length > 10) { const old = coins.shift(); dropped.splice(dropped.indexOf(old), 1); coinGroup.remove(old.mesh); }
      requestRender();
    },
    setSpin(on) { spinning = !!on; if (!spinning && (isStatic || reduced)) spinAngle = 0; requestRender(); },
    resize(width, height, dpr = 1) {
      W = Math.max(1, width | 0); H = Math.max(1, height | 0); aspect = W / H;
      const heroCap = Math.min(0.38, 0.6 / aspect);           // hero: never taller than 60% of the viewport
      widthKeys[0][1] = widthKeys[1][1] = heroCap;
      layoutProps(aspect < 1); layoutScale(aspect < 1);
      baseDpr = Math.min(dpr || 1, W >= 1400 ? 1.5 : 2);            // a 1.5x tray is indistinguishable from 2x on a wide screen and 44% cheaper
      applyPixelRatio();
      renderer.setSize(W, H, false);
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      requestRender();
    },
    render() { if (pending) { cancelAnimationFrame(pending); pending = 0; } renderNow(); },
    start() {
      if (disposed || running) return;
      if (pending) { cancelAnimationFrame(pending); pending = 0; }   // the loop's first frame replaces any on-demand frame
      running = true;
      if (!isStatic) clock.start();
      raf = requestAnimationFrame(loop);
    },
    stop() { running = false; cancelAnimationFrame(raf); raf = 0; clock.stop(); },
    dispose() {
      if (disposed) return;
      disposed = true;                                           // setters / render / start become no-ops
      api.stop();
      if (pending) { cancelAnimationFrame(pending); pending = 0; }
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      const seen = new Set();
      scene.traverse((o) => {
        if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
        const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
        for (const m of mats) {
          if (seen.has(m)) continue;
          seen.add(m);
          for (const k of Object.keys(m)) { const v = m[k]; if (v && v.isTexture && !seen.has(v)) { seen.add(v); v.dispose(); } }
          m.dispose();
        }
        if (o.isLight && o.shadow && o.shadow.map) o.shadow.map.dispose();
      });
      envRT.dispose();                                           // frees the PMREM cubeUV target (texture.dispose() alone cannot)
      scene.environment = null;
      renderer.dispose();
      // Only drop the GL context when asked: a forced loss makes the canvas unusable for a later createScene().
      if (options.forceContextLoss) renderer.forceContextLoss();
    },
    // for the test page / debugging (not part of the contract)
    _internals: { scene, camera, renderer, wood, matMat },
  };

  api.resize(canvas.clientWidth || 2, canvas.clientHeight || 2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
  return api;
}

export default createScene;
