// HOLM — page driver.
// Maps scroll position to the scene's 0..1 progress (piecewise-linear through per-section anchors so the
// keyframes line up with the text no matter how tall a section renders), wires the pill controls, nav
// state and the notify form. All rendering lives in scene.js.

import { createScene } from './scene.js';

const html = document.documentElement;
const canvas = document.getElementById('scene');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// --- WebGL availability -------------------------------------------------------------------------------
function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

let scene = null;
if (hasWebGL()) {
  try {
    scene = createScene(canvas, { reducedMotion });
  } catch (err) {
    console.warn('Scene failed to start; falling back to static plates.', err);
    scene = null;
  }
}
if (!scene) html.classList.add('no-webgl');

// --- Scroll → progress -------------------------------------------------------------------------------
const sections = [...document.querySelectorAll('[data-anchor]')];
let anchors = []; // [{ y, p }] sorted by y

function measure() {
  const maxY = Math.max(1, html.scrollHeight - innerHeight);
  anchors = sections.map((s, i) => {
    const p = Number(s.dataset.anchor);
    // The hero anchors at the very top; the others anchor when the section is centred in the viewport.
    const y = i === 0 ? 0 : clamp(s.offsetTop + s.offsetHeight / 2 - innerHeight / 2, 0, maxY);
    return { y, p };
  });
  // Guarantee monotonic y so interpolation is well-defined.
  for (let i = 1; i < anchors.length; i++) anchors[i].y = Math.max(anchors[i].y, anchors[i - 1].y + 1);
  anchors[anchors.length - 1].y = Math.max(anchors[anchors.length - 1].y, maxY);
}

function progressFor(y) {
  if (y <= anchors[0].y) return anchors[0].p;
  for (let i = 1; i < anchors.length; i++) {
    const a = anchors[i - 1], b = anchors[i];
    if (y <= b.y) return a.p + (b.p - a.p) * ((y - a.y) / (b.y - a.y));
  }
  return anchors[anchors.length - 1].p;
}

let target = 0, current = 0, raf = 0;
function onScroll() {
  target = progressFor(scrollY);
  html.classList.toggle('is-scrolled', scrollY > 24);
  if (!raf) raf = requestAnimationFrame(tick);
}
function tick() {
  raf = 0;
  // Ease towards the scroll target; reduced motion follows it exactly.
  current = reducedMotion ? target : current + (target - current) * 0.14;
  if (Math.abs(target - current) < 0.0005) current = target;
  scene?.setProgress(current);
  if (current !== target) raf = requestAnimationFrame(tick);
}

function onResize() {
  measure();
  scene?.resize(innerWidth, innerHeight, Math.min(devicePixelRatio || 1, 2));
  onScroll();
}

measure();
scene?.resize(innerWidth, innerHeight, Math.min(devicePixelRatio || 1, 2));
current = target = progressFor(scrollY);
scene?.setProgress(current);
scene?.start();
addEventListener('scroll', onScroll, { passive: true });
addEventListener('resize', onResize);
addEventListener('load', onResize);
document.fonts?.ready.then(measure);
document.addEventListener('visibilitychange', () => (document.hidden ? scene?.stop() : scene?.start()));

// --- Pointer parallax (subtle, desktop only) --------------------------------------------------------
if (scene && !reducedMotion && matchMedia('(pointer: fine)').matches) {
  addEventListener('pointermove', e => {
    scene.setPointer((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1);
  }, { passive: true });
}

// --- Nav: mark the section in view -------------------------------------------------------------------
const navLinks = [...document.querySelectorAll('.nav__links a')];
const byId = Object.fromEntries(navLinks.map(a => [a.getAttribute('href').slice(1), a]));
const seen = new Map();
{
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => seen.set(e.target.id, e.intersectionRatio));
    let best = null, ratio = 0;
    seen.forEach((r, id) => { if (r > ratio) { ratio = r; best = id; } });
    navLinks.forEach(a => a.removeAttribute('aria-current'));
    if (best && byId[best] && ratio > 0.25) byId[best].setAttribute('aria-current', 'true');
  }, { threshold: [0, 0.25, 0.5, 0.75, 1] });
  sections.forEach(s => io.observe(s));
}

// --- View pills (product section) --------------------------------------------------------------------
const viewButtons = [...document.querySelectorAll('[data-view]')];
let activeView = null;
function setView(name) {
  activeView = name;
  viewButtons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === name)));
  scene?.setViewOverride(name);
}
viewButtons.forEach(b => b.addEventListener('click', () => setView(activeView === b.dataset.view ? null : b.dataset.view)));
// Leaving the product section releases the override.
const product = document.getElementById('product');
if (product) new IntersectionObserver(([e]) => { if (!e.isIntersecting && activeView) setView(null); }, { threshold: 0 }).observe(product);

// --- Turntable ----------------------------------------------------------------------------------------
const spinButton = document.getElementById('spin');
let spinning = false;
spinButton?.addEventListener('click', () => {
  spinning = !spinning;
  spinButton.setAttribute('aria-pressed', String(spinning));
  scene?.setSpin(spinning);
});

// --- Notify form (no backend: this is a concept piece) ----------------------------------------------
const form = document.getElementById('notify');
form?.addEventListener('submit', e => {
  e.preventDefault();
  const input = form.querySelector('input');
  const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value.trim());
  if (!ok) { input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
  input.removeAttribute('aria-invalid');
  form.classList.add('is-done');
  form.querySelector('.field__done').textContent = 'Noted. Your number is held.';
});
