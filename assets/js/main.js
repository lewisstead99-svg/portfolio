// HOLM — page driver.
// Maps scroll position to the scene's 0..1 progress (piecewise-linear through anchors), resolves which camera
// preset a section wants, runs the pinned features and the rolling gallery, the reveal choreography, the pill
// controls, nav state and the notify form. All rendering lives in scene.js.

import { createScene } from './scene.js';
import { createSound } from './sound.js';

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

// The turning beat: its scroll fraction is the carving progress; the readouts follow.
const turningEl = document.getElementById('turning');
const turnPct = document.getElementById('turnPct'), turnDia = document.getElementById('turnDia'), turnH = document.getElementById('turnH'), turnRpm = document.getElementById('turnRpm');
let turnShown = -1;
function trackTurning() {
  if (!turningEl) return;
  const r = turningEl.getBoundingClientRect();
  const t = clamp(-r.top / Math.max(1, turningEl.offsetHeight - innerHeight), 0, 1);
  scene?.setTurn(t);
  const pct = Math.round(31 * t);
  if (pct !== turnShown) {
    turnShown = pct;
    if (turnPct) turnPct.textContent = `${pct}%`;
    if (turnDia) turnDia.textContent = `Ø ${Math.round(210 - 10 * t)}`;
    if (turnH) turnH.textContent = String(Math.round(30 - 8 * t));
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
  trackTurning();
  trackSections();
  // No second easing stage: the wheel is eased already and touch is smooth by itself, so the camera reads the
  // scroll position of this very frame and the tray never trails the words around it.
  current = target;
  scene?.setProgress(current);
  scatter.forEach((l, i) => l.classList.toggle('is-on', !!scene && current > 0.19 + i * 0.03 && current < 0.34));
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
let cancelWheel = () => {};
if (smoothScroll) {
  let sTarget = scrollY, sCurrent = scrollY, sRaf = 0, sTimer = 0, sLast = 0, animating = false, steps = 0, sWritten = scrollY, tau = 140, lastWheelAt = 0;
  const maxY = () => html.scrollHeight - innerHeight;
  // The easing runs inside the scene's frame, before the scene updates, and the section tracking is re-read
  // straight after the scroll write: page and tray then agree within the same frame, instead of the tray
  // reading last frame's positions and trailing the words by a frame at speed.
  const ownLoop = !scene;
  const schedule = () => { if (!ownLoop) return; sRaf = requestAnimationFrame(step); };
  const step = () => {
    sRaf = 0; steps++;
    const now = performance.now();
    const dt = clamp(now - sLast, 0, 64); sLast = now;          // own clock: rAF timestamps can precede the wheel's
    sCurrent += (sTarget - sCurrent) * (1 - Math.exp(-dt / tau));
    if (Math.abs(sTarget - sCurrent) < 0.5) { sCurrent = sTarget; animating = false; }
    else schedule();
    sWritten = sCurrent;
    window.scrollTo({ top: sCurrent, behavior: 'instant' });   // bypass CSS scroll-behavior: smooth, which would restart its own animation every frame
    onScroll();                                              // same frame: the tray reads the new positions before it renders
  };
  if (scene) scene.onFrame = () => { if (animating) step(); };
  // A watchdog only for browsers that withhold frames mid-scroll: if no frame has stepped the easing for 90 ms, step it.
  const watchdog = () => { if (!animating) return; if (performance.now() - sLast > 90) step(); sTimer = setTimeout(watchdog, 100); };
  addEventListener('wheel', e => {
    if (e.ctrlKey || e.metaKey) return;                      // browser zoom
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1;
    const now = performance.now();
    // Trackpads send many small pixel deltas in quick succession and are already smooth: ease them less so the
    // page answers the fingers; notched wheels arrive in steps and get the longer glide.
    tau = e.deltaMode === 0 && Math.abs(e.deltaY) < 40 && now - lastWheelAt < 80 ? 70 : 140; lastWheelAt = now;
    if (!animating) { sTarget = sCurrent = scrollY; sLast = now; clearTimeout(sTimer); sTimer = setTimeout(watchdog, 100); }
    sTarget = clamp(sTarget + e.deltaY * unit, 0, maxY());
    animating = true;
    if (!sRaf) schedule();
  }, { passive: false });
  addEventListener('scroll', () => {
    // A scroll we did not write (anchor link, keyboard, script) takes over: stop easing and resync.
    if (animating && Math.abs(scrollY - sWritten) > 2) { cancelAnimationFrame(sRaf); clearTimeout(sTimer); sRaf = 0; animating = false; }
    if (!animating) sTarget = sCurrent = sWritten = scrollY;
  }, { passive: true });
  cancelWheel = () => { if (animating) { cancelAnimationFrame(sRaf); clearTimeout(sTimer); sRaf = 0; animating = false; } };
  addEventListener('keydown', cancelWheel);
  // Anchor links and hash changes must win over an in-flight wheel easing.
  document.addEventListener('click', e => { if (e.target.closest?.('a[href^="#"]')) cancelWheel(); }, true);
  addEventListener('hashchange', cancelWheel);
  if (new URLSearchParams(location.search).has('debug')) window.__smooth = () => ({ sTarget, sCurrent, animating, sRaf, steps, scrollY, maxY: maxY() });
}
if (new URLSearchParams(location.search).has('debug')) { window.__scene = scene; window.__track = () => trackSections(); window.__state = () => ({ featuresActive, currentStep, featureView, followWanted, section: sectionEl?.id, blend: [blendA, blendB, Number(blendF.toFixed(2))] }); }

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
const loaderPct = document.getElementById('loaderPct');
const pctStart = performance.now();
const tickPct = () => {
  if (!loaderPct || html.classList.contains('is-ready')) return;
  const t = Math.min(1, (performance.now() - pctStart) / 1400);
  loaderPct.textContent = Math.round(99 * (1 - Math.pow(1 - t, 3))) + '%';
  if (t < 1) requestAnimationFrame(tickPct);
};
tickPct();
const ready = () => { html.classList.add('is-ready'); if (loaderPct) loaderPct.textContent = '100%'; };
if (scene) requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(ready, reducedMotion ? 0 : 700)));
else ready();
setTimeout(ready, 3500);

// --- The hour: the photograph is lit for the visitor's own time of day ---------------------------------
{
  const d = new Date();
  scene?.setHour(d.getHours() + d.getMinutes() / 60);
  const heroTime = document.getElementById('heroTime');
  if (heroTime) heroTime.textContent = `Lit for ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}, your time`;
}

// --- Pointer parallax (desktop only) -----------------------------------------------------------------
if (scene && !reducedMotion && matchMedia('(pointer: fine)').matches) {
  addEventListener('pointermove', e => scene.setPointer((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1), { passive: true });
}

// --- Section reveals + light theme flag ---------------------------------------------------------------
{
  const els = document.querySelectorAll('.reveal, .pin, .divider, .statement, .beat, .letters, .light, .reviews, .always, .gallery, .foot, .turning');
  const io = new IntersectionObserver(entries => entries.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }), { threshold: 0.2 });
  els.forEach(el => io.observe(el));
  if (reducedMotion) els.forEach(el => el.classList.add('in'));
}

// --- Nav links (state is set by trackSections below) ------------------------------------------------
const navLinks = [...document.querySelectorAll('.nav__links a')];
const byId = Object.fromEntries(navLinks.map(a => [a.getAttribute('href').slice(1), a]));

// --- Sound: off until asked for; remembered per browser, resumed on the first gesture --------------------
const sound = createSound();
const soundButton = document.getElementById('sound');
function setSound(on) {
  soundButton?.setAttribute('aria-pressed', String(on));
  soundButton?.setAttribute('aria-label', on ? 'Sound on' : 'Sound off');
  const st = soundButton?.querySelector('.nav__sound-state'); if (st) st.textContent = on ? 'on' : 'off';
  sound.setEnabled(on);
  try { localStorage.setItem('holm-sound', on ? '1' : '0'); } catch {}
}
soundButton?.addEventListener('click', () => setSound(soundButton.getAttribute('aria-pressed') !== 'true'));
try { if (localStorage.getItem('holm-sound') === '1') addEventListener('pointerdown', () => setSound(true), { once: true }); } catch {}
if (scene) scene.onLand = (v, kind) => (kind === 'coin' ? sound.coin(v) : sound.knock(v));
document.addEventListener('click', e => { if (e.target.closest('.btn, .nav__links a, .foot__links a')) sound.tick(0.6); });

// --- Camera overrides: one resolver for section presets, feature beats and the product pills -----------
let sectionEl = null, featureView = null, featuresActive = false, pillView = null, pillsActive = false;
let blendA = null, blendB = null, blendF = 1;
let applyOverride = function (animate = false) {
  if (pillsActive && pillView) scene?.setViewOverride(pillView, animate);
  else scene?.setViewBlend(blendA, blendB, blendF, animate);
};

// Pinned features.
const markers = [...document.querySelectorAll('.pin-marker')];
const steps = [...document.querySelectorAll('.step')];
const gotoButtons = [...document.querySelectorAll('[data-goto]')];
// Scramble-in: glyphs resolve left to right into the target text, ORYZO-style.
const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789·—';
const scrambling = new WeakMap();
function scrambleTo(el, text, ms = 520) {
  if (reducedMotion) { el.textContent = text; return; }
  cancelAnimationFrame(scrambling.get(el) || 0);
  const t0 = performance.now(), n = text.length;
  const frame = now => {
    const p = clamp((now - t0) / ms, 0, 1), settled = Math.floor(p * n * 1.15);
    let out = '';
    for (let i = 0; i < n; i++) out += i < settled || text[i] === ' ' ? text[i] : GLYPHS[(i * 7 + Math.floor(now / 40)) % GLYPHS.length];
    el.textContent = out;
    if (p < 1) scrambling.set(el, requestAnimationFrame(frame)); else el.textContent = text;
  };
  scrambling.set(el, requestAnimationFrame(frame));
}
document.querySelectorAll('[data-scramble]').forEach(el => { el.dataset.text = el.textContent.trim(); });

function setStep(n) {
  currentStep = String(n);
  steps.forEach(s => s.classList.toggle('is-active', s.dataset.step === String(n)));
  document.querySelectorAll(`[data-scramble][data-step="${n}"]`).forEach(el => scrambleTo(el, el.dataset.text));
  gotoButtons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.goto === String(n))));
  featureView = markers.find(m => m.dataset.step === String(n))?.dataset.view || null;
  applyOverride();
}
let currentStep = '1';
if (markers.length) {
  // The ageing gauge follows the scene's darkening cycle while beat 3 is on.
  const marker = document.getElementById('ageMarker');
  let ageRaf = 0;
  const ageTick = () => { ageRaf = 0; if (!marker || !scene) return; marker.style.transform = `translateY(${(scene.getAge?.() ?? 0) * (marker.parentElement?.clientHeight || 0)}px)`; if (featuresActive && featureView === 'f3') ageRaf = requestAnimationFrame(ageTick); };
  const prevApply = applyOverride;
  applyOverride = (animate = false) => { prevApply(animate); if (featuresActive && featureView === 'f3' && !ageRaf) ageRaf = requestAnimationFrame(ageTick); };
  gotoButtons.forEach(b => b.addEventListener('click', () => {
    cancelWheel();
    markers.find(x => x.dataset.step === b.dataset.goto)?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' });
  }));
  setStep(1);
}

// Product view pills (statement section).
const pillButtons = [...document.querySelectorAll('[data-pill]')];
function setPill(name) {
  pillView = name;
  pillButtons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.pill === name)));
  applyOverride(true);
}
pillButtons.forEach(b => b.addEventListener('click', () => setPill(pillView === b.dataset.pill ? null : b.dataset.pill)));
const product = document.getElementById('product');
if (product) new IntersectionObserver(([e]) => { pillsActive = e.isIntersecting; if (!pillsActive && pillView) setPill(null); else applyOverride(true); }, { threshold: 0 }).observe(product);

// Flip beat: the button swaps the section's preset between top and the underside.
const flipButton = document.getElementById('flipButton');
const flipSection = document.getElementById('flip');
flipButton?.addEventListener('click', () => {
  done.flip = true;
  sound.whoosh();
  const on = flipButton.getAttribute('aria-pressed') !== 'true';
  flipButton.setAttribute('aria-pressed', String(on));
  flipSection.dataset.view = on ? (flipSection.dataset.flipView || 'flip') : 'flipTop';
  animateNext = true; trackSections();                         // re-resolve the beat with the new view, easing into it
});

// --- Scroll-linked beats ----------------------------------------------------------------------------
// Every section (and each feature marker) is a beat with a view. As the next beat's top edge crosses its
// line (half the viewport by default), the camera blends from the previous view to the next over half a
// viewport of scroll, so the tray travels with the page instead of hopping when a threshold is crossed.
// Read from geometry on every scroll: IntersectionObserver root margins are ignored in cross-origin iframes.
const revealEls = [...document.querySelectorAll('.reveal, .pin, .divider, .statement, .beat, .letters, .light, .reviews, .always, .gallery, .foot, .turning')];
const beats = [];
document.querySelectorAll('main > section').forEach(sec => {
  if (sec.id === 'features') { markers.forEach((m, i) => beats.push({ el: i === 0 ? sec : m, view: () => m.dataset.view || null, own: i === 0 ? 0.55 : 0.5 })); return; }   // the first beat is owned by the section itself, so the blend begins as the panel scrolls in
  beats.push({ el: sec, view: () => (innerWidth < 821 && sec.dataset.viewPortrait) || sec.dataset.view || null, own: Number(sec.dataset.own || 0.5) });
});
const navLinksById = byId;
const lightEl = document.querySelector('.light');
const letterO = document.querySelector('.letters__o');
const liveTile = document.querySelector('.always__tile--live');
const lightO = document.querySelector('.light__o');
const reviewsSlot = document.querySelector('.reviews__slot');
const footO = document.querySelector('.foot__o');
const mainSections = [...document.querySelectorAll('main > section')];
const chapterEl = document.getElementById('chapter');
let chapterIdx = -1;
const slotSections = [...document.querySelectorAll('section[data-view-portrait]')];
const photoImg = document.querySelector('.plate--photo img[data-tray]');
const photoFrac = photoImg ? photoImg.dataset.tray.split(',').map(Number) : null;
let navActive = null, animateNext = false;
function trackSections() {
  const vh = innerHeight, range = vh * 0.5;
  let a = null, b = null, f = 1, dom = beats[0];
  for (let k = 1; k < beats.length; k++) {
    const bt = beats[k];
    const fk = clamp(0.5 - (bt.el.getBoundingClientRect().top - bt.own * vh) / range, 0, 1);
    if (fk <= 0) break;
    a = beats[k - 1].view(); b = bt.view(); f = fk;
    if (fk >= 0.5) dom = bt;
    if (fk < 1) break;
  }
  blendA = a; blendB = b; blendF = f;
  const domView = dom.view();
  const section = dom.el.closest('section');
  sectionEl = section;
  html.classList.toggle('is-end', section?.id === 'foot');
  if (chapterEl && section) {
    const i = mainSections.indexOf(section);
    if (i >= 0 && i !== chapterIdx) { chapterEl.textContent = `${String(i + 1).padStart(2, '0')} / ${String(mainSections.length).padStart(2, '0')}`; if (chapterIdx >= 0) sound.tick(0.3); chapterIdx = i; }
  }
  featuresActive = section?.id === 'features';
  if (featuresActive) { const st = dom.el.dataset.step || '1'; if (st !== currentStep) setStep(st); }
  featureView = featuresActive ? domView : null;
  // Rect-pinned views: where the printed tray sits in the photograph, the O of HOLM, the longevity slot, the live tile.
  if (scene) {
    // The tray rides the photograph as the plates slide and holds at the left edge with a sliver still showing, so it
    // never fully leaves the frame and never sits doubled over another plate's printed tray.
    if (photoImg && photoFrac) { const r = photoImg.getBoundingClientRect(), d = photoFrac[2] * r.width; scene.setFocus('photo', Math.max(r.left + photoFrac[0] * r.width, -0.2 * d), r.top + photoFrac[1] * r.height, d); }
    if (letterO) { const r = letterO.getBoundingClientRect(); scene.setFocus('letterO', r.left + r.width / 2, r.top + r.height / 2, r.width * 0.96 / 1.05); }
    if (footO) { const r = footO.getBoundingClientRect(); scene.setFocus('footO', r.left + r.width / 2, r.top + r.height / 2, r.width * 0.96 / 1.05); }
    if (lightO) { const r = lightO.getBoundingClientRect(); scene.setFocus('light', r.left + r.width / 2, r.top + r.height / 2, r.width * 0.98); }
    if (reviewsSlot) { const r = reviewsSlot.getBoundingClientRect(); scene.setFocus('reviewsSlot', r.left + r.width / 2, r.top + r.height * 0.5, Math.min(r.width * 0.72, r.height * 0.9, innerHeight * 0.64)); }
    if (liveTile) { const r = liveTile.getBoundingClientRect(); scene.setFocus('tile', r.left + r.width / 2, r.top + r.height / 2, Math.min(r.width, r.height) * 0.68); }
    if (innerWidth < 821) for (const sec of slotSections) { const slot = sec.querySelector('.reveal__object'); if (!slot) continue; const r = slot.getBoundingClientRect(); scene.setFocus(sec.dataset.viewPortrait, r.left + r.width / 2, r.top + r.height / 2, Math.min(r.width * 0.72, r.height * 0.9)); }
    const grounds = [];
    for (const el of [lightEl, liveTile]) {
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom > 0 && r.top < vh) grounds.push(el === liveTile ? { top: r.top, bottom: r.bottom, left: r.left, right: r.right } : { top: r.top, bottom: r.bottom });
    }
    scene.setBackdrops(grounds);
  }
  // Reveal classes from geometry too, so they never wait on an observer callback (slow frames, iframes).
  for (const el of revealEls) if (!el.classList.contains('in')) { const r = el.getBoundingClientRect(); if (r.top < vh * 0.8 && r.bottom > vh * 0.2) el.classList.add('in'); }
  // In the gallery the tray is drawn in front of the page so it can sit on the photograph.
  html.classList.toggle('is-front', domView === 'photo' || domView === 'tile' || domView === 'code');
  applyOverride(animateNext); animateNext = false;
  const nav = dom.el.closest('[data-nav]')?.dataset.nav || null;
  if (nav !== navActive) {
    navActive = nav;
    navLinks.forEach(l => l.removeAttribute('aria-current'));
    if (nav && navLinksById[nav]) navLinksById[nav].setAttribute('aria-current', 'true');
  }
  if (lightEl) {
    const r = lightEl.getBoundingClientRect();
    html.classList.toggle('is-light', r.top <= vh * 0.15 && r.bottom > vh * 0.08);          // the nav band
    html.classList.toggle('is-light-mid', r.top <= vh * 0.5 && r.bottom > vh * 0.5);          // the serial label and progress thumb
    html.classList.toggle('is-light-low', r.top <= vh * 0.97 && r.bottom > vh * 0.9);         // the scroll cue
  }
}
trackSections();

// --- Followers: things that sit on the tray and must move with it every frame -----------------------
const handles = document.getElementById('handles');
const callouts = document.getElementById('callouts');
const hint = (() => {
  if (!scene || reducedMotion || !matchMedia('(pointer: fine)').matches) return null;
  const el = document.createElement('div'); el.className = 'hint'; el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '<svg class="hint__hand" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11V4.5a1.5 1.5 0 0 1 3 0V12M14 12V6.5a1.5 1.5 0 0 1 3 0V13M17 12.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.5a6 6 0 0 1-4.8-2.4L4.3 14.9a1.5 1.5 0 0 1 2.4-1.8L8 15"/></svg><span class="hint__line"></span><span class="hint__label"></span>';
  document.body.appendChild(el); return el;
})();
const done = { drag: false, drop: false, flip: false };
const heldEl = document.getElementById('heldWeight');
let heldLast = -1;
const HINT_TEXT = { drag: 'Try to drag', drop: 'Try to click', flip: 'Try to click' };
let followWanted = false;
function currentHint() {
  if (!hint || !sectionEl) return null;
  let m = sectionEl.dataset.cursor || null;
  if (m && sectionEl.id === 'features') m = currentStep === '1' ? 'drop' : 'drag';
  if (!m || done[m]) return null;
  if (m === 'drag' && !['intro', 'product', 'reviews'].includes(sectionEl.id)) return null;   // one nudge per idea is enough
  return m;
}
function follow() {
  followWanted = false;
  if (!scene) return;
  const b = scene.getBounds();
  let busy = false;
  if (handles) {
    const on = featuresActive && currentStep === '2' && b.visible;
    handles.style.opacity = on ? '1' : '0';
    if (on) { const size = b.r * 2 * 1.05 / 0.96; const px = size + 'px'; if (handles.style.width !== px) handles.style.width = handles.style.height = px; handles.style.transform = `translate3d(${b.x - size / 2}px, ${b.y - size / 2}px, 0)`; busy = true; }
  }
  if (callouts) {
    const on = sectionEl?.id === 'product' && b.visible && innerWidth > 820;
    callouts.classList.toggle('is-on', on);
    if (on) { const size = b.r * 2.4; const px = size + 'px'; if (callouts.style.width !== px) callouts.style.width = callouts.style.height = px; callouts.style.transform = `translate3d(${b.x - size / 2}px, ${b.y - size / 2}px, 0)`; busy = true; }
  }
  if (heldEl && scene.getHeld) {
    const on = featuresActive && currentStep === '1';
    if (on) { const h = scene.getHeld(); const g = Math.round(h.grams); if (g !== heldLast) { heldLast = g; heldEl.textContent = `${g} g`; } if (h.settling) busy = true; }
  }
  if (hint) {
    const m = currentHint();
    const on = !!m && b.visible && b.void > 0.5 && !document.body.classList.contains('is-dragging');
    hint.classList.toggle('is-on', on);
    hint.classList.toggle('hint--tap', m === 'drop' || m === 'flip');
    if (on) { const lbl = hint.querySelector('.hint__label'); if (lbl.textContent !== HINT_TEXT[m]) lbl.textContent = HINT_TEXT[m]; hint.style.transform = `translate3d(${b.x}px, ${b.y + b.r + 28}px, 0) translate(-50%, 0)`; busy = true; }
  }
  if (busy) followWanted = true;
}
// Followers run after each rendered frame, so they read this frame's bounds, not last frame's.
const kickFollow = () => { followWanted = true; if (!scene?.isRunning()) requestAnimationFrame(() => { if (followWanted) follow(); }); };
let rpmShown = -1;
if (scene) scene.afterFrame = () => {
  if (followWanted) follow();
  const tu = scene.getTurn();
  if (tu.active > 0.01 || rpmShown > 0) {
    sound.lathe(tu.active * (tu.eff < 0.995 ? 1 : 0.25), tu.cutting);
    const rpm = Math.round(640 * tu.spin / 20) * 20;
    if (rpm !== rpmShown && turnRpm) { rpmShown = rpm; turnRpm.firstChild.textContent = `${rpm} `; }
  }
};
addEventListener('scroll', kickFollow, { passive: true });
addEventListener('pointermove', kickFollow, { passive: true });
setTimeout(kickFollow, 1200);

// --- Made of code: the wireframe fades in with the section and the numbers come from the running scene ------
const codeSection = document.getElementById('code');
let statsFilled = false;
function trackCode() {
  if (!codeSection || !scene) return;
  const r = codeSection.getBoundingClientRect(), vh = innerHeight;
  const t = clamp(Math.min((vh * 0.85 - r.top) / (vh * 0.45), (r.bottom - vh * 0.15) / (vh * 0.45)), 0, 1);
  scene.setCode(t);
  if (t > 0.2 && !statsFilled) {
    statsFilled = true;
    const st = scene.getStats();
    const fmt = n => Number(n).toLocaleString('en-GB');
    document.querySelectorAll('[data-stat]').forEach(dd => { const k = dd.dataset.stat; if (k in st) dd.textContent = fmt(st[k]); });
  }
}
addEventListener('scroll', trackCode, { passive: true });

// --- Night sky behind "Always on." ---------------------------------------------------------------------
{
  const sky = document.getElementById('sky');
  if (sky) {
    const ctx = sky.getContext('2d');
    let stars = [], w = 0, h = 0, raf = 0, on = false;
    const seed = (() => { let x = 1234567; return () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648; })();
    const size = () => {
      const r = sky.getBoundingClientRect(); const d = Math.min(devicePixelRatio || 1, 2);
      w = Math.max(1, Math.round(r.width)); h = Math.max(1, Math.round(r.height));
      sky.width = w * d; sky.height = h * d; ctx.setTransform(d, 0, 0, d, 0, 0);
      stars = Array.from({ length: Math.round(w * h / 2600) }, () => ({ x: seed() * w, y: seed() * h, r: 0.4 + seed() * 1.1, p: seed() * 6.28, s: 0.4 + seed() * 1.2 }));
    };
    const draw = now => {
      raf = 0;
      ctx.clearRect(0, 0, w, h);
      for (const st of stars) {
        const tw = reducedMotion ? 1 : 0.55 + 0.45 * Math.sin(now / 1000 * st.s + st.p);
        ctx.globalAlpha = 0.35 + 0.55 * tw;
        ctx.fillStyle = '#ffedd7';
        ctx.beginPath(); ctx.arc(st.x, st.y, st.r, 0, 6.28); ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (on && !reducedMotion) raf = requestAnimationFrame(draw);
    };
    size(); draw(performance.now());
    addEventListener('resize', () => { size(); draw(performance.now()); });
    new IntersectionObserver(([e]) => { on = e.isIntersecting; if (on && !raf) raf = requestAnimationFrame(draw); }, { threshold: 0 }).observe(sky);
  }
}

// --- Typed statement ----------------------------------------------------------------------------------
{
  const el = document.getElementById('typed');
  if (el) {
    const text = el.dataset.type || el.textContent;
    if (reducedMotion) el.classList.add('is-done');
    else {
      el.setAttribute('aria-label', text);
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
dropButton?.addEventListener('click', () => { scene?.dropCoin(); done.drop = true; kickFollow(); });
setInterval(() => { if (featuresActive && currentStep === '1') kickFollow(); }, 300);   // the pocket weight follows the props as they land
if (scene && finePointer && !reducedMotion) {
  const cursor = document.createElement('div');
  cursor.className = 'cursor is-hidden'; cursor.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span'); label.className = 'cursor__label'; cursor.appendChild(label);
  document.body.appendChild(cursor);
  html.classList.add('has-cursor');
  const LABELS = { drag: 'Drag', drop: 'Drop', flip: 'Flip' };
  const pos = { x: innerWidth / 2, y: innerHeight / 2, cx: innerWidth / 2, cy: innerHeight / 2 };
  let mode = null, overControl = false, inTray = false, cursorRaf = 0, down = null, lastMove = 0, lastTarget = null;
  const refreshCursor = () => {
    if (down || !lastTarget || !lastTarget.isConnected) return;
    overControl = interactive(lastTarget);
    mode = overControl ? null : modeAt(pos.x, pos.y, lastTarget);
    cursor.classList.toggle('is-link', overControl);
    cursor.classList.toggle('is-tray', !!mode);
    label.textContent = mode ? LABELS[mode] : '';
  };
  addEventListener('scroll', refreshCursor, { passive: true });

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
    cursor.style.transform = `translate3d(${pos.cx}px, ${pos.cy}px, 0) translate(-50%, -50%)`;
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
      lastTarget = e.target;
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
    if (down.moved) done.drag = true;
    else if (down.mode === 'drop') done.drop = true;
    else if (down.mode === 'flip') done.flip = true;
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
  document.querySelectorAll('.plate:not(.plate--photo)').forEach(el => {
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
  const doneEl = form.querySelector('.field__done'); doneEl.tabIndex = -1;
  // Your number: one of the twelve, stamped onto the tray this second, and the tray turns over to show it.
  const n = 189 + Math.floor(Math.random() * 12), num = `Nº ${String(n).padStart(3, '0')}`;
  scene?.setNumber(n);
  html.classList.add('has-number');
  const contact = document.getElementById('contact');
  resplit(contact.querySelector('.heading'), 'Eleven numbers left.');
  const body = contact.querySelector('.body'); if (body) body.textContent = `Two hundred were made. A hundred and eighty-nine have found a desk. ${num} is yours: it is on the underside, in ink, by hand.`;
  const dot = edition?.children[n - 1]; if (dot) { dot.classList.remove('is-open'); dot.classList.add('is-yours'); dot.title = `${num} · yours`; }
  contact.dataset.view = 'flip'; contact.dataset.viewPortrait = 'flip'; animateNext = true; trackSections();
  doneEl.textContent = `${num} is yours.`;
  if (scene) {
    const save = document.createElement('button'); save.type = 'button'; save.className = 'btn btn--ghost btn--tiny'; save.textContent = 'Save the card';
    save.addEventListener('click', () => saveCard(n));
    doneEl.appendChild(save);
  }
  doneEl.focus();
  sound.tick(0.8);
});
// Re-split a word-revealed heading with new words; the section already has .in, so they rise in straight away.
function resplit(el, text) {
  if (!el) return;
  el.textContent = '';
  text.split(/\s+/).forEach((w, i, arr) => {
    const outer = document.createElement('span'); outer.className = 'w'; outer.style.setProperty('--i', i);
    const inner = document.createElement('span'); inner.textContent = w; outer.appendChild(inner); el.appendChild(outer);
    if (i < arr.length - 1) el.appendChild(document.createTextNode(' '));
  });
}
// The card: a frame of the tray as it is right now, with the number, composed on a 1200 × 630 canvas and saved.
function saveCard(n) {
  const snap = scene.snapshot();
  const img = new Image();
  img.onload = () => {
    const W = 1200, H = 630, c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#100904'; ctx.fillRect(0, 0, W, H);
    const s = snap.scale, size = snap.r * 2 * 1.25 * s, out = 540;
    ctx.drawImage(img, snap.x * s - size / 2, snap.y * s - size / 2, size, size, W - out - 60, (H - out) / 2, out, out);
    ctx.fillStyle = '#ffedd7'; ctx.textBaseline = 'top';
    ctx.font = '500 20px Inter, Arial, sans-serif'; ctx.fillText('HOLM', 72, 84);
    ctx.font = '500 96px Inter, Arial, sans-serif'; ctx.fillText(`Nº ${String(n).padStart(3, '0')}`, 68, 220);
    ctx.font = '500 16px Inter, Arial, sans-serif'; ctx.fillText('HELD FOR YOU · ONE OF TWO HUNDRED', 72, 340);
    ctx.fillStyle = '#6c5f51'; ctx.fillText('HAND TURNED · BLACK WALNUT · MADE IN DORSET', 72, 372);
    ctx.fillStyle = '#dc5000'; ctx.fillText('BUILT BY FABRICATR · FABRICATR.COM', 72, 520);
    const a = document.createElement('a'); a.href = c.toDataURL('image/png'); a.download = `holm-no-${String(n).padStart(3, '0')}.png`; document.body.appendChild(a); a.click(); a.remove();
    sound.tick(0.6);
  };
  img.src = snap.url;
}

// --- Keys: the page can be driven from the keyboard; ? shows the card ---------------------------------
const keysCard = document.getElementById('keys');
const showKeys = (on) => { if (keysCard) keysCard.hidden = !on; };
function gotoBeat(dir) {
  const i = Math.max(0, mainSections.indexOf(sectionEl)), next = mainSections[clamp(i + dir, 0, mainSections.length - 1)];
  if (!next) return;
  cancelWheel();
  window.scrollTo({ top: next.offsetTop, behavior: reducedMotion ? 'instant' : 'smooth' });
}
addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.('input, textarea, select, [contenteditable]')) return;
  const k = e.key;
  if (k === '?') { showKeys(keysCard?.hidden); sound.tick(0.5); return; }
  if (k === 'Escape') { showKeys(false); return; }
  if (k === 'ArrowDown' || k === 'j' || k === 'PageDown') { e.preventDefault(); gotoBeat(1); }
  else if (k === 'ArrowUp' || k === 'k' || k === 'PageUp') { e.preventDefault(); gotoBeat(-1); }
  else if (k === 'd' || k === 'D') { if (featuresActive && currentStep === '1') dropButton?.click(); else { cancelWheel(); markers[0]?.scrollIntoView({ behavior: reducedMotion ? 'instant' : 'smooth', block: 'center' }); } }
  else if (k === 'f' || k === 'F') { if (sectionEl?.id === 'flip') flipButton?.click(); else { cancelWheel(); document.getElementById('flip')?.scrollIntoView({ behavior: reducedMotion ? 'instant' : 'smooth' }); } }
  else if (k === 's' || k === 'S') soundButton?.click();
  else if (k === 't' || k === 'T') { if (scrollY > innerHeight * 0.5) { cancelWheel(); window.scrollTo({ top: 0, behavior: reducedMotion ? 'instant' : 'smooth' }); } spinButton?.click(); }
  else return;
  showKeys(false);
});

// --- Idle: left alone for a while, the page nudges itself once (a coin, a flip, a quarter turn) --------------
if (scene && !reducedMotion) {
  let idleAt = performance.now();
  const bump = () => { idleAt = performance.now(); };
  for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll']) addEventListener(ev, bump, { passive: true });
  setInterval(() => {
    if (document.hidden || !html.classList.contains('is-ready') || performance.now() - idleAt < 14000) return;
    idleAt = performance.now() - 6000;                          // the next nudge, if still idle, eight seconds on
    if (featuresActive && currentStep === '1') scene.dropCoin();
    else if (sectionEl?.id === 'flip') flipButton?.click();
    else scene.kick(35 * (Math.random() < 0.5 ? 1 : -1));
  }, 1000);
}

// The edition: two hundred dots, the last twelve open.
const edition = document.getElementById('edition');
if (edition) {
  const frag = document.createDocumentFragment();
  for (let i = 0; i < 200; i++) {
    const d = document.createElement('i'); d.style.setProperty('--i', i);
    if (i >= 188) d.className = 'is-open';
    d.title = `Nº ${String(i + 1).padStart(3, '0')}${i >= 188 ? ' · still here' : ''}`;
    frag.appendChild(d);
  }
  edition.appendChild(frag);
}

// Initial state for the followers and the closing beat (their definitions sit above).
trackCode();
kickFollow();
