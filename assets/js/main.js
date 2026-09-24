// HOLM — page driver.
// Maps scroll position to the scene's 0..1 progress (piecewise-linear through anchors), resolves which camera
// preset a section wants, runs the pinned features and the rolling gallery, the reveal choreography, the pill
// controls, nav state and the notify form. All rendering lives in scene.js.

import { createScene } from './scene.js';

const html = document.documentElement;
const canvas = document.getElementById('scene');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// --- WebGL availability -------------------------------------------------------------------------------
function hasWebGL() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}
let scene = null;
if (hasWebGL()) {
  try { scene = createScene(canvas, { reducedMotion }); }
  catch (err) { console.warn('Scene failed to start; falling back to static plates.', err); scene = null; }
}
if (!scene) html.classList.add('no-webgl');

// --- Text choreography: split headings into masked words ---------------------------------------------
document.querySelectorAll('[data-split]').forEach(el => {
  const words = el.textContent.trim().split(/\s+/);
  el.textContent = '';
  words.forEach((w, i) => {
    const outer = document.createElement('span'); outer.className = 'w'; outer.style.setProperty('--i', i);
    const inner = document.createElement('span'); inner.textContent = w;
    outer.appendChild(inner); el.appendChild(outer);
    if (i < words.length - 1) el.appendChild(document.createTextNode(' '));
  });
});

// --- Scroll → progress -------------------------------------------------------------------------------
const anchorEls = [...document.querySelectorAll('[data-anchor]')];
let anchors = [];
function measure() {
  const maxY = Math.max(1, html.scrollHeight - innerHeight);
  anchors = anchorEls.map((el, i) => {
    const p = Number(el.dataset.anchor);
    const slot = el.classList.contains('pin-marker') ? el : (el.querySelector('.reveal__object') || el);
    const r = slot.getBoundingClientRect();
    const y = i === 0 ? 0 : clamp(scrollY + r.top + r.height / 2 - innerHeight / 2, 0, maxY);
    return { y, p };
  }).sort((a, b) => a.y - b.y);
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

let target = 0, current = 0, raf = 0, last = 0;
const thumb = document.getElementById('progress');
const scatter = [...document.querySelectorAll('.scatter__l')];
const gallery = document.getElementById('gallery');
const marquee = document.getElementById('marquee');
const track = document.getElementById('track');

function layoutGallery() {
  if (!gallery) return;
  const r = gallery.getBoundingClientRect();
  const range = gallery.offsetHeight - innerHeight;
  const t = clamp(-r.top / Math.max(1, range), 0, 1);
  // First 45%: the giant line rolls right→left across the window. After that it hands over to the kicker and the
  // track slides by one plate width per step.
  const roll = clamp(t / 0.45, 0, 1);
  if (marquee) {
    const w = marquee.offsetWidth;
    marquee.style.transform = `translate(${innerWidth - roll * (innerWidth + w)}px, -50%)`;
  }
  gallery.classList.toggle('is-settled', t > 0.45);
  if (track) {
    const slide = clamp((t - 0.45) / 0.55, 0, 1);
    const plate = track.firstElementChild;
    const step = plate ? plate.offsetWidth + 24 : 0;
    const count = track.children.length;
    track.style.transform = `translate(calc(-1 * var(--plate-w) / 2 - ${slide * step * (count - 1)}px), -50%)`;
  }
}

function onScroll() {
  target = progressFor(scrollY);
  html.classList.toggle('is-scrolled', scrollY > 24);
  html.classList.toggle('is-end', scrollY > html.scrollHeight - innerHeight * 1.5);
  if (thumb) {
    const total = html.scrollHeight;
    thumb.style.height = Math.max(6, (innerHeight / total) * 100) + '%';
    thumb.style.transform = `translateY(${(scrollY / total) * innerHeight}px)`;
  }
  layoutGallery();
  if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); }
}
function tick(now) {
  raf = 0;
  const dt = Math.min(250, now - last); last = now;
  current = reducedMotion ? target : current + (target - current) * (1 - Math.exp(-dt / 110));
  if (Math.abs(target - current) < 0.0005) current = target;
  scene?.setProgress(current);
  scatter.forEach((l, i) => l.classList.toggle('is-on', !!scene && current > 0.19 + i * 0.03 && current < 0.34));
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
document.fonts?.ready.then(() => { measure(); onScroll(); });
document.addEventListener('visibilitychange', () => (document.hidden ? scene?.stop() : scene?.start()));
layoutGallery();

// Reveal the page once the first frame is on screen; the loader holds a beat so its hairline can fill.
const ready = () => html.classList.add('is-ready');
if (scene) requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(ready, reducedMotion ? 0 : 700)));
else ready();
setTimeout(ready, 6000);

// --- Pointer parallax (desktop only) -----------------------------------------------------------------
if (scene && !reducedMotion && matchMedia('(pointer: fine)').matches) {
  addEventListener('pointermove', e => scene.setPointer((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1), { passive: true });
}

// --- Section reveals + light theme flag ---------------------------------------------------------------
{
  const els = document.querySelectorAll('.reveal, .pin, .divider, .statement, .beat, .letters, .light, .reviews, .always, .gallery');
  const io = new IntersectionObserver(entries => entries.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }), { threshold: 0.2 });
  els.forEach(el => io.observe(el));
  if (reducedMotion) els.forEach(el => el.classList.add('in'));
  const light = document.querySelector('.light');
  if (light) new IntersectionObserver(([e]) => html.classList.toggle('is-light', e.isIntersecting), { rootMargin: '-8% 0px -85% 0px', threshold: 0 }).observe(light);
}

// --- Nav: mark the section in view -------------------------------------------------------------------
const navLinks = [...document.querySelectorAll('.nav__links a')];
const byId = Object.fromEntries(navLinks.map(a => [a.getAttribute('href').slice(1), a]));
{
  let active = null;
  const io = new IntersectionObserver(entries => {
    const hit = entries.filter(e => e.isIntersecting)[0];
    if (hit) active = hit.target.dataset.nav;
    navLinks.forEach(a => a.removeAttribute('aria-current'));
    if (active && byId[active]) byId[active].setAttribute('aria-current', 'true');
  }, { rootMargin: '-50% 0px -50% 0px', threshold: 0 });
  document.querySelectorAll('[data-nav]').forEach(s => io.observe(s));
}

// --- Camera overrides: one resolver for section presets, feature beats and the product pills -----------
let sectionEl = null, featureView = null, featuresActive = false, pillView = null, pillsActive = false;
let applyOverride = function () {
  const view = pillsActive && pillView ? pillView
    : featuresActive ? featureView
    : sectionEl ? (sectionEl.dataset.view || null)
    : null;
  scene?.setViewOverride(view);
};
{
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) sectionEl = e.target;
      else if (sectionEl === e.target) sectionEl = null;
    });
    applyOverride();
  }, { rootMargin: '-50% 0px -50% 0px', threshold: 0 });
  document.querySelectorAll('section[data-view]').forEach(s => io.observe(s));
}

// Pinned features.
const markers = [...document.querySelectorAll('.pin-marker')];
const steps = [...document.querySelectorAll('.step')];
const gotoButtons = [...document.querySelectorAll('[data-goto]')];
function setStep(n) {
  steps.forEach(s => s.classList.toggle('is-active', s.dataset.step === String(n)));
  gotoButtons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.goto === String(n))));
  featureView = markers.find(m => m.dataset.step === String(n))?.dataset.view || null;
  applyOverride();
}
if (markers.length) {
  const io = new IntersectionObserver(entries => {
    const hit = entries.filter(e => e.isIntersecting)[0];
    if (hit) setStep(hit.target.dataset.step);
  }, { rootMargin: '-50% 0px -50% 0px', threshold: 0 });
  markers.forEach(m => io.observe(m));
  new IntersectionObserver(([e]) => { featuresActive = e.isIntersecting; applyOverride(); }, { rootMargin: '-50% 0px -50% 0px', threshold: 0 }).observe(document.getElementById('features'));
  // The ageing gauge follows the scene's darkening cycle while beat 3 is on.
  const marker = document.getElementById('ageMarker');
  let ageRaf = 0;
  const ageTick = () => { ageRaf = 0; if (!marker || !scene) return; marker.style.top = (scene.getAge?.() ?? 0) * 100 + '%'; if (featuresActive && featureView === 'f3') ageRaf = requestAnimationFrame(ageTick); };
  const prevApply = applyOverride;
  applyOverride = () => { prevApply(); if (featuresActive && featureView === 'f3' && !ageRaf) ageRaf = requestAnimationFrame(ageTick); };
  gotoButtons.forEach(b => b.addEventListener('click', () => {
    markers.find(x => x.dataset.step === b.dataset.goto)?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' });
  }));
  setStep(1);
}

// Product view pills (statement section).
const pillButtons = [...document.querySelectorAll('[data-pill]')];
function setPill(name) {
  pillView = name;
  pillButtons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.pill === name)));
  applyOverride();
}
pillButtons.forEach(b => b.addEventListener('click', () => setPill(pillView === b.dataset.pill ? null : b.dataset.pill)));
const product = document.getElementById('product');
if (product) new IntersectionObserver(([e]) => { pillsActive = e.isIntersecting; if (!pillsActive && pillView) setPill(null); else applyOverride(); }, { threshold: 0 }).observe(product);

// Flip beat: the button swaps the section's preset between top and the underside.
const flipButton = document.getElementById('flipButton');
const flipSection = document.getElementById('flip');
flipButton?.addEventListener('click', () => {
  const on = flipButton.getAttribute('aria-pressed') !== 'true';
  flipButton.setAttribute('aria-pressed', String(on));
  flipSection.dataset.view = on ? (flipSection.dataset.flipView || 'flip') : 'flipTop';
  applyOverride();
});

// --- Typed statement ----------------------------------------------------------------------------------
{
  const el = document.getElementById('typed');
  if (el) {
    const text = el.dataset.type || el.textContent;
    if (reducedMotion) el.classList.add('is-done');
    else {
      el.textContent = '';
      const caret = document.createElement('span'); caret.className = 'caret'; el.appendChild(caret);
      let started = false;
      new IntersectionObserver(([e], io) => {
        if (!e.isIntersecting || started) return;
        started = true; io.disconnect();
        let i = 0;
        const step = () => {
          el.insertBefore(document.createTextNode(text[i++]), caret);
          if (i < text.length) setTimeout(step, 55 + Math.random() * 40);
          else setTimeout(() => el.classList.add('is-done'), 500);
        };
        setTimeout(step, 250);
      }, { threshold: 0.4 }).observe(el.closest('section') || el);
    }
  }
}

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
form?.querySelector('input')?.addEventListener('input', () => { form.classList.remove('is-invalid'); form.querySelector('input').removeAttribute('aria-invalid'); });
form?.addEventListener('submit', e => {
  e.preventDefault();
  const input = form.querySelector('input');
  const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value.trim());
  if (!ok) { input.setAttribute('aria-invalid', 'true'); form.classList.add('is-invalid'); input.focus(); return; }
  input.removeAttribute('aria-invalid'); form.classList.remove('is-invalid');
  form.classList.add('is-done');
  form.querySelector('.field__done').textContent = 'Noted. Your number is held.';
});
