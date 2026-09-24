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
function makeWoodCanvases(size, floor) {
  const [c, ctx] = makeCanvas(size, size, true);
  const R = rng(1917);
  ctx.fillStyle = '#3a2416';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 18; i++) {                      // broad tonal drift
    const g = ctx.createRadialGradient(R() * size, R() * size, 0, R() * size, R() * size, size * (0.25 + R() * 0.35));
    g.addColorStop(0, R() > 0.5 ? 'rgba(92,59,34,0.22)' : 'rgba(36,21,12,0.28)');
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
    grainPath(y, k); ctx.lineWidth = 1.5 + h3 * 6 * strength; ctx.strokeStyle = `rgba(36,21,12,${0.22 + 0.45 * strength})`; ctx.stroke();
    if (h1 > 0.45) { grainPath(y + 1.5, k); ctx.lineWidth = 0.8 + R() * 1.2; ctx.strokeStyle = `rgba(20,11,6,${(0.2 + R() * 0.3) * strength})`; ctx.stroke(); }
    grainPath(y + sp * 0.5, k); ctx.lineWidth = 5 + R() * 12; ctx.strokeStyle = `rgba(92,59,34,${0.08 + R() * 0.18})`; ctx.stroke();
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
    ctx.strokeStyle = light ? `rgba(110,72,42,${0.15 + R() * 0.25})` : `rgba(28,16,9,${0.18 + R() * 0.3})`;
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

  const geo = new THREE.LatheGeometry(P, 192);
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  const n = pos.count;
  const uvPlanar = new Float32Array(n * 2), col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const j = Math.round(uv.getY(i) * (N - 1));
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
  return { geo, floor };
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

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, premultipliedAlpha: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(VOID, 6, 16);                            // near/far follow the camera distance
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 60);
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
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.015;
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
  const wood = new THREE.MeshPhysicalMaterial({
    map: woodMap, vertexColors: true,
    roughness: 1.0, roughnessMap: woodData, metalness: 0,          // three reads roughness from .g
    bumpMap: woodData, bumpScale: 0.0048,                          // and bump height from .x
    clearcoat: 0.04, clearcoatRoughness: 0.65, envMapIntensity: 0.55,
    sheen: 0.1, sheenRoughness: 0.85, sheenColor: new THREE.Color('#6a4d38'),
  });
  const tray = new THREE.Mesh(T.geo, wood);
  tray.castShadow = true;
  trayGroup.add(tray);
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
  coin(0.117, 0.028, brassP, -0.28, 0.12, 0.3); coin(0.11, 0.026, nickel, 0.08, -0.30, 1.1); coin(0.10, 0.026, brassP, 0.36, 0.24, 2.0);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.095, 0.014, 16, 48), brassP);
  ring.rotation.x = Math.PI / 2; ring.position.set(-0.22, FLOOR_Y + 0.014, -0.44); ring.castShadow = true; coinGroup.add(ring);
  coinGroup.visible = false;
  scene.add(coinGroup);
  tray.receiveShadow = true;
  const groundMat = deskMat.clone(); groundMat.opacity = 0;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(DESK, DESK), groundMat);
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.034; ground.receiveShadow = true; ground.visible = false;
  scene.add(ground);
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
  const _A = { elev: 0, width: 0, nx: 0, ny: 0, vd: 0 }, _B = { elev: 0, width: 0, nx: 0, ny: 0, vd: 0 };
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
    f1:     { elev: 22,   width: 0.40, nx: 0.30, ny: 0, pnx: 0, pny: 0.26, props: true },   // coins land in the pocket
    f2:     { elev: 7,    width: 0.40, nx: 0.30, ny: 0, pnx: 0, pny: 0.26, ground: true },  // on a lit desk, shadow tight underneath
    f3:     { elev: 89.5, width: 0.38, nx: 0.30, ny: 0, pnx: 0, pny: 0.26, age: true },    // the walnut deepens and recovers on a slow cycle
    // Later beats: the underside flip, a macro across the rim, a small 3/4 between review columns, and 'away'
    // (tray hidden) for sections that paint their own ground or carry the tray as plates.
    flip:   { elev: -42,  width: 0.36, nx: 0, ny: 0, pwidth: 0.44, pnx: 0, pny: -0.42 },   // portrait: below the centred copy
    flipTop:{ elev: 89.5, width: 0.30, nx: 0, ny: 0, pwidth: 0.40, pnx: 0, pny: -0.42 },
    statement: { elev: 89.5, width: 0.28, nx: 0, ny: 0, pwidth: 0.44, pnx: 0, pny: 0.10 },
    // The tray is the thread through the whole page, so nothing ever hides it: it perches above the gallery,
    // becomes the O in HOLM (dynamic: the page passes the letter's on-screen rect), floats over the cream
    // ground of the longevity section and sits inside the cream tile of "Always on".
    perch:  { elev: 89.5, width: 0.085, nx: 0, ny: 0.86, pwidth: 0.13, pnx: 0.62, pny: 0.72 },   // portrait: beside the kicker, above the plates
    light:  { elev: 34,   dynamic: true },   // pinned to a layout slot in the longevity hero so it scrolls with its text
    letterO:{ elev: 89.5, dynamic: true },
    tile:   { elev: 89.5, dynamic: true },
    photo:  { elev: 83,   dynamic: true },   // sits exactly on the printed tray in the gallery's photograph
    macro:  { elev: 9,    width: 1.35, nx: 0.10, ny: -0.10, pnx: 0.05, pny: 0, pointerYaw: 22, pointerElev: 5, raw: true },   // the pointer sweeps along the rim; width passes through untouched
    quarter:{ elev: 35,   width: 0.34, nx: 0, ny: 0, pwidth: 0.40, pnx: 0.70, pny: 0.62 },   // portrait: the reviews stack over the centre, so the tray sits top-right
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
    out.nx = track(K.nx, p); out.ny = track(K.ny, p); out.vd = track(K.vd, p);
    if (blend.a || blend.b) {
      stateOf(blend.a, out, _A); stateOf(blend.b, out, _B);
      const f = smooth(blend.f);
      out.elev = lerp(_A.elev, _B.elev, f); out.width = lerp(_A.width, _B.width, f);
      out.nx = lerp(_A.nx, _B.nx, f); out.ny = lerp(_A.ny, _B.ny, f); out.vd = lerp(_A.vd, _B.vd, f);
    }
    return out;
  }
  // A named view's camera state; null means "whatever the scroll keyframes say" (the base already in `out`).
  function stateOf(name, base, dst) {
    const o = name && PRESETS[name];
    if (!o) { dst.elev = base.elev; dst.width = base.width; dst.nx = base.nx; dst.ny = base.ny; dst.vd = base.vd; return dst; }
    dst.elev = o.elev; dst.vd = 1;
    const portrait = aspect < 1;
    if (o.dynamic) { const fo = focus[name] || { nx: 0, ny: 0, width: 0.2 }; dst.width = fo.width; dst.nx = fo.nx; dst.ny = fo.ny; }
    else {
      dst.width = portrait && o.pwidth != null ? o.pwidth / 1.75 : o.width;   // pre-compensates the portrait multiplier
      dst.nx = portrait && o.pnx != null ? o.pnx : o.nx; dst.ny = portrait && o.pny != null ? o.pny : o.ny;
    }
    return dst;
  }

  const _dir = new THREE.Vector3(), _right = new THREE.Vector3(), _up = new THREE.Vector3();
  const sph = (out, az, el, d) => out.set(target.x + d * Math.cos(el) * Math.sin(az), target.y + d * Math.sin(el), target.z + d * Math.cos(el) * Math.cos(az));

  function applyCamera(v) {
    let frac = v.width;
    if (aspect < 1 && frac <= 1) frac = Math.min(frac * 1.75, 0.72);   // portrait: the tray owns the width (macro shots pass through)
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
    sph(key.position, yaw + lerp(135, 55, lift) * DEG, lerp(lerp(52, 46, lift), -42, below) * DEG, 6);
    sph(spot.position, yaw + 135 * DEG, 58 * DEG, 7.5);
    sph(rim.position, yaw + 135 * DEG, lerp(24, -18, below) * DEG, 6);
    sph(front.position, yaw - 40 * DEG, 42 * DEG, 6);
    sph(bounce.position, yaw - 35 * DEG, -10 * DEG, 6);
    key.intensity = lerp(0.75, 3.0, lift);                    // the spot carries the hero; the key carries the void
    spot.intensity = 150 * (1 - lift);
    rim.intensity = lerp(1.2, 2.0, lift);
    front.intensity = lerp(0.25, 0.9, lift);
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
    const oCam = override && PRESETS[override];
    const aCam = snap ? 1 : 1 - Math.exp(-dt * (oCam && oCam.dynamic ? 10 : 6.5));   // targets are scroll-linked, so the camera follows closely; rect-pinned views keep up
    for (const f of FIELDS) cur[f] += (tgt[f] - cur[f]) * (f === 'vd' ? a : aCam);   // the set's fade always runs at the quick rate
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
    const drift = reduced ? 0 : Math.sin(elapsed * 0.35) * 4.5 * vd;
    const driftEl = reduced ? 0 : Math.sin(elapsed * 0.23 + 1.0) * 1.6 * vd;
    const bob = reduced ? 0 : Math.sin(elapsed * 0.6 + 0.4) * 0.012 * vd;
    // Drag inertia and relaxation. While the visitor drags, offsets follow the hand; on release they coast with
    // friction; and whenever the page scrolls the offsets ease back so the choreography regains the wheel.
    if (!isStatic) {
      if (!drag.active) { drag.yaw += drag.vYaw * dt; drag.elev += drag.vElev * dt; }
      const fr = Math.exp(-dt * 3.2); drag.vYaw *= fr; drag.vElev *= fr;
      const scrollSpeed = dt > 0 ? Math.abs(progress - lastProgress) / dt : 0;
      const relax = 1 - Math.exp(-dt * clamp(scrollSpeed * 40, 0, 1) * 4);
      drag.yaw -= drag.yaw * relax; drag.elev -= drag.elev * relax;
      drag.elev = clamp(drag.elev, -70, 70);
    }
    lastProgress = progress;
    const oNow = override && PRESETS[override];
    const pgY = (oNow && oNow.pointerYaw) || 4.0, pgE = (oNow && oNow.pointerElev) || 3.0;
    view.elev = clamp(cur.elev + driftEl - pointerCur.y * pgE + drag.elev, -60, 89.9);
    view.yaw = cur.yaw + spinAngle + drift + pointerCur.x * pgY + drag.yaw;
    // Pointer parallax: a gentle pan across the photograph in the hero, a nudge of the object in the void.
    view.width = cur.width;
    view.nx = cur.nx + pointerCur.x * (0.006 * vd + 0.014 * (1 - vd));
    view.ny = cur.ny + bob - pointerCur.y * (0.006 * vd + 0.010 * (1 - vd));
    view.vd = vd;
    // Dropped coins: fall, bounce twice, settle with a small wobble; they share the beat's coin materials so they
    // fade with it. Oldest coins leave first once the pocket is busy.
    if (!isStatic) for (let i = dropped.length - 1; i >= 0; i--) {
      const c = dropped[i]; const m = c.mesh;
      if (!c.settled) {
        c.vy -= 5.5 * dt; m.position.y += c.vy * dt;
        m.position.x += c.vx * dt; m.position.z += c.vz * dt;
        if (m.position.y <= c.rest) {
          m.position.y = c.rest; c.vy = -c.vy * 0.32; c.vx *= 0.5; c.vz *= 0.5; c.bounces++;
          if (Math.abs(c.vy) < 0.25 || c.bounces > 3) { c.vy = 0; c.settled = true; }
        }
        const air = clamp((m.position.y - c.rest) / 1.2, 0, 1);
        m.rotation.x = c.tiltX * air; m.rotation.z = c.tiltZ * air; m.rotation.y += c.spin * dt;
        const rr = Math.hypot(m.position.x, m.position.z);           // stay inside the pocket wall
        if (rr > 0.72) { m.position.x *= 0.72 / rr; m.position.z *= 0.72 / rr; c.vx = -c.vx * 0.4; c.vz = -c.vz * 0.4; }
      }
    }
    applyCamera(view);
    applySet(vd);
    const o = override && PRESETS[override];
    // FEATURES props: ease in and out with the beat.
    coinT += ((o && o.props ? 1 : 0) - coinT) * a; groundT += ((o && o.ground ? 1 : 0) - groundT) * a;
    coinGroup.visible = coinT > 0.01; ground.visible = groundT > 0.01;
    brassP.opacity = nickel.opacity = coinT; groundMat.opacity = groundT;
    const ageTarget = o && o.age && !reduced ? (1 - Math.cos(elapsed * (Math.PI * 2 / 9))) / 2 : (o && o.age ? 0.5 : 0);
    ageT += (ageTarget - ageT) * (snap ? 1 : Math.min(1, a * 1.5));
    wood.color.setRGB(lerp(1, 0.56, ageT), lerp(1, 0.50, ageT), lerp(1, 0.46, ageT));
    key.castShadow = matGroup.visible || ground.visible || coinGroup.visible;
    key.shadow.intensity = Math.max(1 - vd, groundT, coinT);
  }

  function renderNow() {
    if (disposed) return;
    const dt = clock.running ? Math.min(clock.getDelta(), 0.25) : 0;   // long frames (software GL, tab switches) still converge quickly
    update(dt);
    renderer.render(scene, camera);
  }
  function requestRender() {
    if (disposed || running || pending) return;
    pending = requestAnimationFrame(() => { pending = 0; renderNow(); });
  }
  function loop() {
    if (!running) return;
    renderNow();
    raf = requestAnimationFrame(loop);
  }
  const onContextLost = (e) => { e.preventDefault(); };
  const onContextRestored = () => { requestRender(); };
  canvas.addEventListener('webglcontextlost', onContextLost, false);
  canvas.addEventListener('webglcontextrestored', onContextRestored, false);

  const api = {
    setProgress(p) { progress = clamp(Number(p) || 0, 0, 1); requestRender(); },
    setPointer(nx, ny) { pointer.x = clamp(Number(nx) || 0, -1, 1); pointer.y = clamp(Number(ny) || 0, -1, 1); requestRender(); },
    setViewOverride(name) { const n = (name && PRESETS[name]) ? name : null; blend = { a: n, b: n, f: 1 }; override = n; requestRender(); },
    // Scroll-linked transition: f in [0,1] from view a to view b (either may be null for the scroll keyframes).
    setViewBlend(a, b, f) {
      const A = (a && PRESETS[a]) ? a : null, B = (b && PRESETS[b]) ? b : null;
      blend = { a: A, b: B, f: clamp(Number(f) || 0, 0, 1) };
      override = blend.f >= 0.5 ? B : A;
      requestRender();
    },
    getAge() { return ageT; },
    // Interaction ---------------------------------------------------------------------------------------
    getBounds() { return { x: bounds.x, y: bounds.y, r: bounds.r, visible: cur.vd > 0.5 }; },
    // Screen-space target for a dynamic view: centre (css px) and diameter (css px). Pre-compensated for the
    // portrait multiplier so the diameter lands exactly.
    setFocus(name, x, y, d) { focus[name] = { nx: (x / W - 0.5) * 2, ny: -(y / H - 0.5) * 2, width: clamp(d / W, 0.02, 1) / (aspect < 1 ? 1.75 : 1) }; requestRender(); },
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
    dropCoin() {
      if (reduced && isStatic) return;
      const brass = Math.random() < 0.6;
      const mesh = new THREE.Mesh(brass ? coinGeoA : coinGeoB, brass ? brassP : nickel);
      const h = brass ? 0.026 : 0.024, ang = Math.random() * Math.PI * 2, rad = 0.15 + Math.random() * 0.45;
      mesh.position.set(Math.cos(ang) * rad, FLOOR_Y + 1.5, Math.sin(ang) * rad);
      mesh.rotation.y = Math.random() * Math.PI; mesh.castShadow = true;
      coinGroup.add(mesh);
      dropped.push({ mesh, vy: -0.4, vx: (Math.random() - 0.5) * 0.5, vz: (Math.random() - 0.5) * 0.5, rest: FLOOR_Y + h / 2, settled: false, bounces: 0,
        tiltX: (Math.random() - 0.5) * 1.6, tiltZ: (Math.random() - 0.5) * 1.6, spin: (Math.random() - 0.5) * 6 });
      while (dropped.length > 10) { const old = dropped.shift(); coinGroup.remove(old.mesh); }
      requestRender();
    },
    setSpin(on) { spinning = !!on; if (!spinning && (isStatic || reduced)) spinAngle = 0; requestRender(); },
    resize(width, height, dpr = 1) {
      W = Math.max(1, width | 0); H = Math.max(1, height | 0); aspect = W / H;
      const heroCap = Math.min(0.38, 0.6 / aspect);           // hero: never taller than 60% of the viewport
      widthKeys[0][1] = widthKeys[1][1] = heroCap;
      layoutProps(aspect < 1);
      renderer.setPixelRatio(Math.min(dpr || 1, 2));
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
