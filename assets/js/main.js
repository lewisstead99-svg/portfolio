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

let lastScrollY = scrollY;
function onScroll() {
  target = progressFor(scrollY);
  // A fast scroll gives the tray a little spin, which coasts and settles.
  const dy = scrollY - lastScrollY; lastScrollY = scrollY;
  if (Math.abs(dy) > 1) scene?.kick(clamp(dy * 0.06, -60, 60));
  html.classList.toggle('is-scrolled', scrollY > 24);
  html.classList.toggle('is-end', scrollY > html.scrollHeight - innerHeight * 1.5);
  if (thumb) {
    const total = html.scrollHeight;
    thumb.style.height = Math.max(6, (innerHeight / total) * 100) + '%';
    thumb.style.transform = `translateY(${(scrollY / total) * innerHeight}px)`;
  }
  layoutGallery();
  trackSections();
  if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); }
}
function tick(now) {
  raf = 0;
  const dt = Math.min(250, now - last); last = now;
  current = reducedMotion ? target : current + (target - current) * (1 - Math.exp(-dt / (smoothScroll ? 80 : 110)));
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

// --- Smooth wheel scrolling -----------------------------------------------------------------------------
// Mouse wheels arrive in steps; easing the page towards the wheel target gives the choreography a continuous
// input. Native positions are kept (no transform hijack), so sticky sections, anchors and observers all still
// work. Keyboard, scrollbar and touch scrolling stay native and simply resync the target.
const smoothScroll = matchMedia('(pointer: fine)').matches && !reducedMotion;
if (smoothScroll) {
  let sTarget = scrollY, sCurrent = scrollY, sRaf = 0, sTimer = 0, sLast = 0, animating = false, steps = 0;
  // Frames normally arrive every 16 ms; the timer only steps in if a browser withholds them mid-scroll.
  const schedule = () => { sRaf = requestAnimationFrame(step); clearTimeout(sTimer); sTimer = setTimeout(() => { if (sRaf) { cancelAnimationFrame(sRaf); step(); } }, 48); };
  const maxY = () => html.scrollHeight - innerHeight;
  const step = () => {
    sRaf = 0; clearTimeout(sTimer); steps++;
    const now = performance.now();
    const dt = clamp(now - sLast, 0, 64); sLast = now;          // own clock: rAF timestamps can precede the wheel's
    sCurrent += (sTarget - sCurrent) * (1 - Math.exp(-dt / 140));
    if (Math.abs(sTarget - sCurrent) < 0.5) { sCurrent = sTarget; animating = false; }
    else schedule();
    window.scrollTo({ top: sCurrent, behavior: 'instant' });   // bypass CSS scroll-behavior: smooth, which would restart its own animation every frame
  };
  addEventListener('wheel', e => {
    if (e.ctrlKey || e.metaKey) return;                      // browser zoom
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1;
    if (!animating) { sTarget = sCurrent = scrollY; sLast = performance.now(); }
    sTarget = clamp(sTarget + e.deltaY * unit, 0, maxY());
    animating = true;
    if (!sRaf) schedule();
  }, { passive: false });
  addEventListener('scroll', () => { if (!animating) sTarget = sCurrent = scrollY; }, { passive: true });
  addEventListener('keydown', () => { if (animating) { cancelAnimationFrame(sRaf); clearTimeout(sTimer); sRaf = 0; animating = false; } });
  if (new URLSearchParams(location.search).has('debug')) window.__smooth = () => ({ sTarget, sCurrent, animating, sRaf, steps, scrollY, maxY: maxY() });
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
}

// --- Nav links (state is set by trackSections below) ------------------------------------------------
const navLinks = [...document.querySelectorAll('.nav__links a')];
const byId = Object.fromEntries(navLinks.map(a => [a.getAttribute('href').slice(1), a]));

// --- Camera overrides: one resolver for section presets, feature beats and the product pills -----------
let sectionEl = null, featureView = null, featuresActive = false, pillView = null, pillsActive = false;
let applyOverride = function () {
  const view = pillsActive && pillView ? pillView
    : featuresActive ? featureView
    : sectionEl ? (sectionEl.dataset.view || null)
    : null;
  scene?.setViewOverride(view);
};

// Pinned features.
const markers = [...document.querySelectorAll('.pin-marker')];
const steps = [...document.querySelectorAll('.step')];
const gotoButtons = [...document.querySelectorAll('[data-goto]')];
function setStep(n) {
  currentStep = String(n);
  steps.forEach(s => s.classList.toggle('is-active', s.dataset.step === String(n)));
  gotoButtons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.goto === String(n))));
  featureView = markers.find(m => m.dataset.step === String(n))?.dataset.view || null;
  applyOverride();
}
let currentStep = '1';
if (markers.length) {
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

// --- Centre-line tracking ----------------------------------------------------------------------------
// Which section owns the camera, which feature beat is on, which nav item is current and whether the light
// interlude sits under the nav are all read from geometry on every scroll. (IntersectionObserver rootMargin
// is ignored inside cross-origin iframes, and this page may well be embedded in one.)
const viewSections = [...document.querySelectorAll('section[data-view]')];
const navSections = [...document.querySelectorAll('[data-nav]')];
const featuresEl = document.getElementById('features');
const lightEl = document.querySelector('.light');
const letterO = document.querySelector('.letters__o');
const liveTile = document.querySelector('.always__tile--live');
const lightSlot = document.querySelector('.light__slot');
let navActive = null;
function trackSections() {
  const mid = innerHeight / 2;
  const at = el => { const r = el.getBoundingClientRect(); return r.top <= mid && r.bottom > mid; };
  sectionEl = viewSections.find(at) || null;
  featuresActive = !!featuresEl && at(featuresEl);
  if (featuresActive) { const m = markers.find(at); if (m && m.dataset.step !== currentStep) setStep(m.dataset.step); }
  // Dynamic presets follow a DOM rect: the O of HOLM, and the cream tile in "Always on".
  if (scene) {
    if (sectionEl?.id === 'letters' && letterO) { const r = letterO.getBoundingClientRect(); scene.setFocus(r.left + r.width / 2, r.top + r.height / 2, r.width * 0.84); }
    else if (sectionEl?.id === 'always' && liveTile) { const r = liveTile.getBoundingClientRect(); scene.setFocus(r.left + r.width / 2, r.top + r.height / 2, Math.min(r.width, r.height) * 0.68); }
    else if (sectionEl?.id === 'longevity' && lightSlot) { const r = lightSlot.getBoundingClientRect(); scene.setFocus(r.left + r.width / 2, r.top + r.height / 2, Math.min(r.width, r.height) * 0.96); }
    // Cream grounds the scene paints behind the tray, aligned to the DOM rects they stand in for.
    const grounds = [];
    for (const el of [lightEl, liveTile]) {
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom > 0 && r.top < innerHeight) grounds.push(el === liveTile ? { top: r.top, bottom: r.bottom, left: r.left, right: r.right } : { top: r.top, bottom: r.bottom });
    }
    scene.setBackdrops(grounds);
  }
  applyOverride();
  const nav = navSections.find(at)?.dataset.nav || null;
  if (nav !== navActive) {
    navActive = nav;
    navLinks.forEach(a => a.removeAttribute('aria-current'));
    if (nav && byId[nav]) byId[nav].setAttribute('aria-current', 'true');
  }
  if (lightEl) { const r = lightEl.getBoundingClientRect(); html.classList.toggle('is-light', r.top <= innerHeight * 0.15 && r.bottom > innerHeight * 0.08); }
}
trackSections();

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

// --- Pointer interaction: cursor, drag-to-rotate, click-to-drop / click-to-flip, magnetic controls ----
const finePointer = matchMedia('(pointer: fine)').matches;
const dropButton = document.getElementById('dropCoin');
dropButton?.addEventListener('click', () => scene?.dropCoin());
if (scene && finePointer && !reducedMotion) {
  const cursor = document.createElement('div');
  cursor.className = 'cursor is-hidden'; cursor.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span'); label.className = 'cursor__label'; cursor.appendChild(label);
  document.body.appendChild(cursor);
  html.classList.add('has-cursor');
  const LABELS = { drag: 'Drag', drop: 'Drop', flip: 'Flip' };
  const pos = { x: innerWidth / 2, y: innerHeight / 2, cx: innerWidth / 2, cy: innerHeight / 2 };
  let mode = null, overControl = false, inTray = false, cursorRaf = 0, down = null, lastMove = 0;

  const interactive = el => !!el.closest?.('a, button, input, textarea, select, label, [role="button"]');
  function modeAt(x, y, el) {
    const section = el.closest?.('section');
    let m = section?.dataset.cursor || null;
    if (m && section.id === 'features') m = featuresActive && featureView === 'f1' ? 'drop' : 'drag';
    const b = scene.getBounds();
    inTray = !!m && b.visible && Math.hypot(x - b.x, y - b.y) < b.r * 1.08;
    return inTray ? m : null;
  }
  function paint() {
    cursorRaf = 0;
    pos.cx += (pos.x - pos.cx) * 0.35; pos.cy += (pos.y - pos.cy) * 0.35;
    cursor.style.left = pos.cx + 'px'; cursor.style.top = pos.cy + 'px';
    if (Math.abs(pos.x - pos.cx) + Math.abs(pos.y - pos.cy) > 0.3) cursorRaf = requestAnimationFrame(paint);
  }
  addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
    pos.x = e.clientX; pos.y = e.clientY;
    cursor.classList.remove('is-hidden');
    if (down) {
      const now = performance.now(), dt = Math.min(0.1, (now - lastMove) / 1000); lastMove = now;
      const dx = e.clientX - down.lx, dy = e.clientY - down.ly; down.lx = e.clientX; down.ly = e.clientY;
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) down.moved = true;
      scene.drag(dx, dy, dt);
    } else {
      overControl = interactive(e.target);
      mode = overControl ? null : modeAt(e.clientX, e.clientY, e.target);
      cursor.classList.toggle('is-link', overControl);
      cursor.classList.toggle('is-tray', !!mode);
      label.textContent = mode ? LABELS[mode] : '';
    }
    if (!cursorRaf) cursorRaf = requestAnimationFrame(paint);
  }, { passive: true });
  addEventListener('pointerdown', e => {
    if (e.button !== 0 || (e.pointerType !== 'mouse' && e.pointerType !== 'pen')) return;
    if (interactive(e.target) || !modeAt(e.clientX, e.clientY, e.target)) return;
    e.preventDefault();
    down = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, moved: false, mode };
    lastMove = performance.now();
    scene.dragStart();
    document.body.classList.add('is-dragging');
    cursor.classList.add('is-down');
  });
  const release = e => {
    if (!down) return;
    scene.dragEnd();
    document.body.classList.remove('is-dragging');
    cursor.classList.remove('is-down');
    if (!down.moved) {
      if (down.mode === 'drop') scene.dropCoin();
      else if (down.mode === 'flip') flipButton?.click();
    }
    down = null;
    if (e) { mode = modeAt(e.clientX, e.clientY, e.target); cursor.classList.toggle('is-tray', !!mode); label.textContent = mode ? LABELS[mode] : ''; }
  };
  addEventListener('pointerup', release);
  addEventListener('pointercancel', () => release());
  document.addEventListener('pointerleave', () => cursor.classList.add('is-hidden'));
  document.documentElement.addEventListener('mouseleave', () => cursor.classList.add('is-hidden'));
  addEventListener('blur', () => { cursor.classList.add('is-hidden'); release(); });

  // Magnetic controls: pills and nav links lean a few pixels toward the pointer.
  document.querySelectorAll('.btn, .nav__links a').forEach(el => {
    el.addEventListener('pointermove', e => {
      const r = el.getBoundingClientRect();
      const dx = (e.clientX - (r.left + r.width / 2)) / r.width, dy = (e.clientY - (r.top + r.height / 2)) / r.height;
      el.style.transform = `translate(${dx * 8}px, ${dy * 6}px)`;
    });
    el.addEventListener('pointerleave', () => { el.style.transform = ''; });
  });
  // Gallery plates tilt toward the pointer.
  document.querySelectorAll('.plate').forEach(el => {
    el.addEventListener('pointermove', e => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      el.style.transform = `perspective(900px) rotateX(${(-y * 8).toFixed(2)}deg) rotateY(${(x * 10).toFixed(2)}deg) translateZ(8px)`;
    });
    el.addEventListener('pointerleave', () => { el.style.transform = ''; });
  });
}

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
